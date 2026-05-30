---
status: accepted
date: 2026-05-24
tags: [no-fallbacks, fail-loud, embedding, wasm, rbac, plugins, audit-followup, ct-a]
supersedes: []
depends-on: [ADR-0095, ADR-0201, ADR-0233]
implements: []
---

# Extend [[ADR-0095]] fallback removal to sibling loaders (CT-A)

## Context and Problem Statement

The 2026-05-23 amendment to [[ADR-0095]] ("Strict fail-loud on missing native binding") removed the `RUFLO_ALLOW_PURE_TS_FALLBACK` escape hatch and converted every pure-TS fallback path in `forks/ruflo/v3/@claude-flow/memory/src/rvf-backend.ts` into a fail-loud throw. The amendment's framing was scope-wide ([[feedback-no-fallbacks]] policy applies to *every* loader, not just RVF), but the textual edit landed surgically on `rvf-backend.ts:1129-1134` and `:1477-1481` only.

The 2026-05-24 second-pass audit ([[ADR-0233]] §CT-A) walked the rest of the loader surface and found **five sibling sites** that still ship the same silent-fallback anti-pattern in production:

| # | Site | Audit ID | Severity | Shape |
|---|------|----------|----------|-------|
| 1 | `forks/ruflo/v3/@claude-flow/cli/src/ruvector/vector-db.ts:101-130, 235-260` | F-06-001 | CRITICAL | `import('ruvector').catch(() => null)` → `generateHashEmbedding(text)` returns `Math.sin(hash * (i+1) * 0.001) * 0.5 + 0.5`; `getStatus()` codifies `backend: 'fallback'` as a first-class state |
| 2 | `forks/ruflo/v3/@claude-flow/cli/src/ruvector/diskann-backend.ts:54-114, 198-220` | F-06-002 | CRITICAL | three-tier cascade `diskann → hnsw → cosine-js`, each tier wrapped in `catch { /* Fall through */ }` with no signal |
| 3 | `forks/ruflo/v3/@claude-flow/memory/src/embedding-pipeline.ts:147-167, 220-244` + `cli/src/memory/memory-router.ts:874-882` | F-08-002 | HIGH | `try @xenova/transformers catch (warn) → try ruvector catch (warn) → hash`; outer `memory-router._doInit` swallows the whole chain without even a warn |
| 4 | `forks/ruflo/v3/@claude-flow/cli/src/commands/claims.ts:265-271` | F-04-002 | CRITICAL | RBAC `check` catches policy-load errors and grants every non-`admin:*` claim with `reason: 'Granted (default permissive policy)'` |
| 5 | `forks/ruflo/v3/@claude-flow/cli/src/commands/plugins.ts:220, 311-313` | F-01-008 | HIGH | `description: 'Install a plugin from IPFS registry or local path'` then unconditionally `installFromNpm(...)` with the comment `// Install from npm (since IPFS is demo mode)` |

This batch is the [[ADR-0233]] §CT-A "Cross-cutting themes" rollup. Treating it as one ADR per [[ADR-0233]]'s explicit guidance ("Prefer theme-batched remediation ADRs over per-finding ADRs"), with per-site disposition documented below.

## Pre-flight verification

Applied the [[ADR-0201]] [Remediation-ADR pre-flight checklist](./ADR-0201-codebase-soundness-completeness-audit-with-runtime-validation.md#remediation-adr-pre-flight-checklist-added-2026-05-20) (added 2026-05-20) before drafting Decision. All four checks executed against each of the 5 sites.

### Check 1 — Signal reaches its audience

For each site, does the silent fallback's failure ever reach the user?

| Site | Path to user | Verdict |
|------|--------------|---------|
| 1 vector-db | `loadRuVector()` swallows; `createVectorDB`/`generateEmbedding` return `FallbackVectorDB`/hash-vec; no error, no return-shape change. `getStatus()` reports `backend: 'fallback'` only if caller reads it (most callers don't). | **No** |
| 2 diskann | Three `catch { /* Fall through */ }` blocks, no stderr, no throw. `activeBackend` is module-scope state most call sites (incl. `searchVectors`) don't expose. | **No** |
| 3 embedding-pipeline / memory-router | `_doInitialize` emits `console.warn` to stderr ("Using hash-fallback (search quality degraded)"). Outer `memory-router._doInit:880` has bare `catch {}` with no warn. Initialise succeeds; subsequent searches return ~0.05-0.28 similarities on a hash backend with no programmatic signal. `embeddings_status` MCP tool does not surface live provider (F-08-008). | **No** |
| 4 claims check | CLI prints `Result: GRANTED` in the same green box as legitimate grants; only hint is `Policy: fallback` in dim text. Exit code is 0 (`return { success: isGranted }`). Calling scripts cannot distinguish. | **No** |
| 5 plugins install | CLI prints `Source: npm` in the success box and `description` advertised IPFS up front; user is presented with discrepancy only if they read both. Exit code 0, `success: true`. | **Partial** (the success box's `Source:` field eventually reveals npm, but the user has already opted into the IPFS path with no `--source` opt-out) |

Conclusion: signal does NOT reach the user on sites 1, 2, 3, 4; partial on site 5. All five qualify under the [[feedback-no-fallbacks]] criterion.

### Check 2 — Upstream hasn't already decided

`diff -u ruvnet/ruflo/<path> forks/ruflo/<path>` for each site:

| Site | Upstream divergence | Upstream decision | Fork-only fix implication |
|------|---------------------|-------------------|---------------------------|
| 1 vector-db | Fork **DELETED** upstream's `hashEmbeddingWarned` one-time stderr warning (upstream had a guarded warn; the fork removed it in `EMBEDDING_DIM=768` cleanup commit, making it MORE silent than upstream). | Upstream warns once-per-session then degrades silently. Upstream tolerates the fallback. | Fork-only fix is **a re-divergence** away from upstream's posture, but the fork is already MORE permissive than upstream — restoring the warn alone would reduce divergence; throwing exceeds upstream by one notch (acceptable per [[feedback-no-fallbacks]] which is fork-only policy). |
| 2 diskann | **BYTE-IDENTICAL with upstream.** Three-tier cascade is upstream's design. | Upstream ships the cascade by design. | Fork-only fail-loud here is **a perpetual merge tax** matching the [[ADR-0209]] correction-4 warning ("upstream ships fallbacks by design; a fork-only blanket gate is a perpetual merge tax"). Mitigation: scope the fork override narrowly (throw only at the load-attempt boundary, leave `createJsFallbackIndex` callable for tests), with a fork-divergence comment naming this ADR. |
| 3 embedding-pipeline / memory-router | Fork-original. **No upstream counterpart** (`@claude-flow/memory/src/embedding-pipeline.ts` does not exist in upstream; `cli/src/memory/memory-router.ts` is fork-original). | n/a — fork-owned surface. | Free to enforce locally without merge tax. |
| 4 claims check | **BYTE-IDENTICAL with upstream.** Permissive-on-error branch is upstream's design. | Upstream ships permissive RBAC by design (matches the broader F-04-003 finding that `commands/claims.ts` is unwired plumbing). | Fork-only fail-closed is a divergence, but [[ADR-0233]] F-04-002 is rated CRITICAL precisely because permissive-by-default contradicts the package's framing. Acceptable per [[feedback-no-fallbacks]]; mark with a clear divergence comment. |
| 5 plugins install | Fork only adds the CRIT-02 permission-validation block (lines 286-308) which is orthogonal. The IPFS-vs-npm silent fallback (`description` + `// Install from npm (since IPFS is demo mode)`) is upstream-inherited verbatim. | Upstream ships the dishonest envelope by design. | Fork-only honesty fix diverges. **Two paths exist** (a) flip the description to honest "Install a plugin from npm registry (IPFS path is not yet implemented)"; (b) leave description, gate the npm path behind `--source npm` opt-in. Path (a) is a single-string change with near-zero merge tax. |

Conclusion: sites 2 and 4 are byte-identical upstream and will pay merge tax on every sync. Sites 1, 3, 5 either already-diverge or are fork-original. The merge-tax risk is acknowledged and mitigated by per-site clear divergence comments + narrow scope (don't blanket-rewrite upstream's resilience architecture).

### Check 3 — Premise true at runtime

Each site verified by reading the live code, not the audit table.

| Site | Live-code verification |
|------|------------------------|
| 1 vector-db | Verified `vector-db.ts:101-130` `generateHashEmbedding` returns sine-wave hash output; `:155-159` `import('ruvector').catch(() => null)`; `:206-208` empty `catch {}` swallow; `:235-260` cascading `try/catch` in `createVectorDB`/`generateEmbedding`. `getStatus()` codifies `backend: 'fallback'` per F-06-001 evidence. **Premise true.** |
| 2 diskann | Verified `diskann-backend.ts:48-51` `catch { diskannAvailable = false }`; `:83-86, :105-107` two `catch { /* Fall through */ }` blocks; `:109-113` pure-JS fallback assignment. **Premise true.** |
| 3 embedding-pipeline / memory-router | Verified `embedding-pipeline.ts:147-167` two nested `try { import }` blocks both emitting `console.warn` only; `:222-244` `embedInternal` has `catch { /* fall through to hash */ }` on transformers.js and ruvector branches; `:242-243` final hash-fallback. Verified `memory-router.ts:874-882` (audit cited `:880`) bare `catch {}` with only a `// Embedding pipeline init failed -- hash fallback will be used` comment. **Premise true.** Path correction (minor): `embedding-pipeline.ts` lives at `memory/src/embedding-pipeline.ts` not `memory/src/embedding/embedding-pipeline.ts`; `memory-router.ts` lives at `cli/src/memory/memory-router.ts` not `memory/src/`. |
| 4 claims check | Verified `claims.ts:265-271` `} catch (error) { … isGranted = !claim.startsWith('admin:'); reason = 'Granted (default permissive policy)'; policySource = 'fallback'; }`. **Premise true.** |
| 5 plugins install | Verified `plugins.ts:220` `description: 'Install a plugin from IPFS registry or local path'`; `:230` example `description: 'Install plugin from IPFS'`; `:311-313` `// Install from npm (since IPFS is demo mode) … result = await manager.installFromNpm(...)`. **Premise true.** |

### Check 4 — No sibling-ADR overlap

Checked ADRs 0202–0232 + 0233 for the same surface/mechanism:

| ADR | Coverage | Overlap with this ADR? |
|-----|----------|------------------------|
| [[ADR-0095]] amendment 2026-05-23 | `rvf-backend.ts` only | No — this ADR extends to sibling loaders not touched. |
| [[ADR-0209]] (no-fallbacks arch-test) | Option E targeted bulk-fix of a `cli/src/mcp-tools/embeddings-tools.ts:525` etc. catch-fallback envelopes; advisory detector for `success:true` in catch with no sibling discriminator | **Partial — orthogonal.** ADR-0209 targets MCP-tool *envelope* sites; this ADR targets *loader* fall-through sites. The 5 sites here are not in ADR-0209's enumerated subset. ADR-0209 explicitly noted ([[ADR-0209]] Correction 3) that the `EmbeddingService` mock-embedding cluster is in `forks/agentdb/src` outside its scan scope; the hash-fallback in `vector-db.ts`/`embedding-pipeline.ts` is in cli/src + memory/src and was not enumerated. |
| [[ADR-0210]] (stub-honesty mandate) | Fabricated-constant returns (`Math.random`, `42*multiplier`, `156`); upstream-revert/implement/delete decision class | **No overlap.** ADR-0210 targets MCP-tool handlers returning canned values; this ADR targets loader cascades silently degrading semantic surfaces. Different code class. |
| [[ADR-0219]] (memory controllers fail-loud on recordOutcome) | Memory controllers' `recordOutcome` envelope | No — controller-surface, not loader. |
| [[ADR-0220]] (learning controllers honesty pass) | Learning controllers | No overlap with the 5 sites here. |
| [[ADR-0226]] (MCP stdio frames raw stdout) | CT-G stdio corruption | No — different theme. |
| [[ADR-0227]] (recalibrate adaptive similarity threshold for mpnet) | Adaptive threshold floor (mpnet related band) | Adjacent to site 3 but orthogonal — ADR-0227 fixed the threshold; this ADR addresses the fallback that silently swaps the provider beneath the threshold. |
| [[ADR-0232]] (pipeline wasm-rebuild phase) | WASM build pipeline, not runtime loaders | No overlap. |
| [[ADR-0233]] §CT-A | This ADR's parent rollup; explicitly directs theme-batched remediation. | This ADR IS that remediation. |

Conclusion: no sibling-ADR overlap. Closest neighbours ([[ADR-0209]], [[ADR-0210]]) operate on different code classes. This ADR carves the work along the loader-cascade seam.

## Considered Options

* **Option A — Per-site fail-loud throw, no escape hatch.** Throw at every loader boundary; no `RUFLO_ALLOW_*` opt-in. Mirrors the 2026-05-23 [[ADR-0095]] amendment's posture verbatim.
* **Option B — Per-site fail-loud throw with explicit dev opt-in.** Add an environment-variable opt-in (e.g. `RUFLO_ALLOW_HASH_EMBEDDING=1`) for local development. User has already rejected this shape for RVF in the 2026-05-23 amendment ("dont do this: `RUFLO_ALLOW_PURE_TS_FALLBACK`. Just fail loud").
* **Option C — Wrap each site in a one-time `console.warn`, no throw.** Match upstream's posture for vector-db (which had a once-per-session warn the fork deleted). Preserves silent-degradation behaviour; only surfaces it to operators reading stderr.
* **Option D — Per-site disposition: throw / delete-fabrication / fix-description.** Differentiate by site: throw at semantically-wrong fallbacks (embeddings, RBAC); fix the description at dishonest-advertising fallbacks (plugins IPFS); restore upstream warn at fork-regressed sites (vector-db).
* **Option E — Status quo, rely on contributor discipline.** Document that operators must monitor stderr for `[embedding-pipeline]` warnings; no code change. Same shape as [[ADR-0232]] Option D and rejected on the same grounds — operator-burden mitigation only.

## Decision Outcome

**Chosen: Option A — per-site fail-loud throw, no escape hatch.** Mirrors the 2026-05-23 [[ADR-0095]] amendment posture; user has rejected the `RUFLO_ALLOW_*` shape on the closest precedent. Per-site disposition follows:

### Per-site decisions

| # | Site | Action | Mechanism |
|---|------|--------|-----------|
| 1 | `vector-db.ts:101-260` | **Throw at the loader boundary** (`loadRuVector` failure, `createVectorDB`/`generateEmbedding` ruvector-unavailable branch). `generateHashEmbedding` may remain in-file as a debug helper (callable from explicit `tests/` paths) but no production callsite may reach it. Remove `backend: 'fallback'` from `getStatus()`. Throw shape mirrors `rvf-backend.ts:1129` (typed error with `code`, path, ADR reference). | `throw new Error('[vector-db] ruvector unavailable; hash-embedding fallback removed (ADR-0234, feedback-no-fallbacks). Install @sparkleideas/ruvector-* and retry. cause: ' + err.message)` |
| 2 | `diskann-backend.ts:54-114` | **Throw at the loader boundary** for the diskann + hnsw branches (no `Fall through` comment). Pure-JS `createJsFallbackIndex` may remain callable from tests but not from `getDiskAnnIndex` production path. **Add divergence comment** naming ADR-0234 since upstream is byte-identical here and this fork will pay merge tax. | Three `catch (err) { throw new Error('[diskann-backend] <tier> unavailable; silent cascade removed (ADR-0234)...'); }` blocks. |
| 3 | `embedding-pipeline.ts:147-167, 220-244` + `memory-router.ts:874-882` | **Throw the actual error in `_doInitialize`** (drop the `console.warn`-then-fall-through chain; if `@xenova/transformers` fails AND ruvector is unavailable, re-throw with context). **Remove the bare `catch {}`** at `memory-router.ts:880` — let the throw propagate so init genuinely fails. **Drop the hash-fallback branch** in `embedInternal:242-243`. Surface live provider in `embeddings_status` (handled as a follow-on; out of scope here). | Two throws in `_doInitialize`; one throw replacement at `memory-router.ts:880`; deletion of `generateHashEmbedding` from `embedInternal` fall-through. |
| 4 | `claims.ts:265-271` | **Fail-closed on policy-load error.** Replace permissive-default branch with `return { success: false, exitCode: 1 }` and a clear error message naming the underlying cause. **Mark with divergence comment** (upstream is byte-identical). | `} catch (error) { spinner.fail('Policy evaluation failed'); output.printError('Failed to load policy: ' + String(error)); return { success: false, exitCode: 1 }; }` |
| 5 | `plugins.ts:220-313` | **Two-part fix.** (a) Rewrite the `description` field to honest "Install a plugin from npm registry (IPFS path not yet implemented)"; rewrite the two `examples:` lines and the `discovery` spinner text to match. (b) Remove the `// Install from npm (since IPFS is demo mode)` lying comment; explicitly opt out of the IPFS path or gate it behind `--source ipfs` (with throw on use, since unimplemented). | Description + comment changes plus a `if (source === 'ipfs') throw new Error('[plugins] IPFS install path not implemented; use --source npm')` guard at the source-selection boundary. |

### Implementation discipline

Each fix carries:

* A fork-divergence comment naming `ADR-0234` at the throw site.
* Reference to [[feedback-no-fallbacks]] in the error message text.
* For byte-identical-with-upstream sites (2, 4): an explicit `// ADR-0234: fork diverges from upstream (which ships silent fallback by design)` comment.
* Test coverage: at minimum one acceptance-tier test per site asserting the fail-loud behaviour (`expect(() => ...).toThrow(/ADR-0234/)`).

### Out of scope (deferred)

* `cli/src/ruvector/lora-adapter.ts:155-174` (F-06-006) — `loadTrainingPipeline` returns `null` on `requireCjs('@ruvector/ruvllm')` failure. Same family; not in the [[ADR-0233]] §CT-A enumerated set; deferred to a follow-on if the F-06-006 finding promotes.
* `cli/src/ruvector/agent-wasm.ts:154-196` (F-06-005 echo-stub route-around) — different mechanism (route to Anthropic when WASM is a stub). Documented as platform-dishonesty in [[ADR-0233]] §CT-A but rated WARNING, not in the CRITICAL/HIGH subset this ADR covers.
* `cli/.claude/helpers/learning-service.mjs` (F-08-005 200-char cache key + 500-char silent truncation + hash fallback) — different file class (bundled static helper, governed by [[ADR-0233]] §CT-B wrapper-bundled-static-files-drift theme, not §CT-A).
* MCP `embeddings_status` runtime-provider field (F-08-008) — surfacing the live provider is a follow-on; this ADR addresses the silent fallback that necessitates the surfacing.
* The other 6 silent-fallback siblings catalogued in F-06 / F-08 (numeric clamps, JSON-parse catches, NaN unwraps) — different families (CT-D, CT-E), addressed in their own theme ADRs per [[ADR-0233]] direction.

## Sites table (consolidated)

| # | File | Lines | Audit ID | Severity | Disposition |
|---|------|-------|----------|----------|-------------|
| 1 | `forks/ruflo/v3/@claude-flow/cli/src/ruvector/vector-db.ts` | 101-130, 155-159, 235-260, getStatus | F-06-001 | CRITICAL | throw at loader boundary; remove `backend:'fallback'` from getStatus |
| 2 | `forks/ruflo/v3/@claude-flow/cli/src/ruvector/diskann-backend.ts` | 48-51, 83-86, 105-107, 109-113 | F-06-002 | CRITICAL | throw at each loader boundary; preserve JS index as test-only helper |
| 3 | `forks/ruflo/v3/@claude-flow/memory/src/embedding-pipeline.ts` + `cli/src/memory/memory-router.ts` | pipeline 147-167, 220-244; router 874-882 | F-08-002 | HIGH | throw in `_doInitialize`; remove bare `catch {}` at router :880; delete hash branch in `embedInternal` |
| 4 | `forks/ruflo/v3/@claude-flow/cli/src/commands/claims.ts` | 265-271 | F-04-002 | CRITICAL | fail-closed: return `success:false, exitCode:1` on policy-load error |
| 5 | `forks/ruflo/v3/@claude-flow/cli/src/commands/plugins.ts` | 220, 230, 311-313 | F-01-008 | HIGH | rewrite description to honest npm wording; guard `--source ipfs` with throw |

### Consequences

* Good, because closes the [[feedback-no-fallbacks]] regression surface at 5 of the audit's 26 immediate-flag CRITICAL/HIGH sites; [[ADR-0095]] amendment's principle finally applies uniformly to its sibling loaders.
* Good, because each fix surfaces a deployment fact (missing native binding, missing policy file, unimplemented IPFS) as a real error rather than as silently-degraded behaviour the operator only notices when search recall is mysteriously poor.
* Good, because the pre-flight checklist (Check 2 in particular) bounded the scope away from the 26-site blanket-throw shape the original audit instinct suggested — sites 2 and 4 are explicitly flagged as merge-tax sites and marked with divergence comments rather than treated as cleanly fork-owned.
* Bad, because sites 2 (diskann) and 4 (claims) are byte-identical with upstream; every upstream sync that touches those files will produce a conflict against this fork-only override. Mitigation: the divergence comment names ADR-0234 so the conflict is recognisable; sync agents preserve the throw. [[feedback-update-integration-ledger]] requires the conflict-disposition to be ledgered on each sync.
* Bad, because dropping the hash-fallback branch in `embedInternal` (site 3) means any environment without `@xenova/transformers` AND `ruvector` installed cannot start memory operations at all — no degradation, hard failure. This is the explicit intent (matches the 2026-05-23 amendment posture) but operators upgrading from a pre-ADR-0234 wrapper will see init throw where previously they saw degraded search.
* Bad, because site 5 (plugins) changes a user-visible description string; the next codemod golden-master ([[ADR-0215]]) run will need an allowlist entry or the help-text snapshot will need to update.
* Neutral, because sites 1 and 3 are fork-original or already-diverged — the merge tax for those is zero or already paid.
* Neutral, because removing the silent fallback does not by itself wire `embeddings_status` to surface the live provider (F-08-008 carry-forward); the operator's recovery story remains "read the throw, install the binding".

## More information

This decision was completed.

* [[ADR-0095]] amendment 2026-05-23 — surgical fail-loud applied to `rvf-backend.ts`; this ADR extends the same posture to the 5 sibling loaders.
* [[ADR-0201]] — pre-flight checklist source.
* [[ADR-0209]] correction-3 + correction-4 — bounded the fork-only no-fallbacks scope; this ADR respects that bound (per-site, narrow, comment-marked).
* [[ADR-0210]] — stub-honesty mandate; covers fabricated-constants, distinct from silent-fallback cascades. This ADR is the loader-cascade equivalent.
* [[ADR-0227]] — adaptive threshold floor; orthogonal but adjacent (this ADR addresses the fallback that the threshold gates against).
* [[ADR-0233]] §CT-A — parent rollup directing theme-batched remediation.
* [[feedback-no-fallbacks]] — corpus rule; the contract this ADR enforces uniformly.
* [[feedback-remediation-adr-preflight]] — checklist that gated this ADR.
* [[feedback-update-integration-ledger]] — required ledger update for merge-tax sites (2, 4).
* `docs/audits/2026-05-24-second-pass-audit/06-wasm-native-bindings.md` — F-06-001, F-06-002 source findings.
* `docs/audits/2026-05-24-second-pass-audit/08-embedding-pipeline.md` — F-08-002 source finding.
* `docs/audits/2026-05-24-second-pass-audit/04-security-aidefence-claims-pii.md` — F-04-002 source finding.
* `docs/audits/2026-05-24-second-pass-audit/01-cli-commands-beyond-daemon-init.md` — F-01-008 source finding.

## Swarm review (2026-05-24)

**Pattern**: P1 Council Hive (Dialectic) — roleplay execution per `docs/plans/2026-05-24-second-pass-remediation-plan.md` §"Per-ADR swarm configuration".
**Consensus**: Byzantine (N=6; f=⌊(N-1)/3⌋=1; required votes 2f+1=3, supermajority).
**Topology**: hierarchical-mesh. **Queen type**: strategic. **Transport**: queen-composed (one-round dialectic; no peer revision needed). **Devil's advocate**: included.

### Expert panel

| # | Role | One-line stance |
|---|------|-----------------|
| 1 | RVF/embedding upstream historian (ADR-0095 lineage) | The 2026-05-23 amendment was surgical because ADR-0095's blast radius was specifically the `rvf-backend.ts` data-loss bug class; the corpus rule ([[feedback-no-fallbacks]]) is genuinely scope-wide and ADR-0234 is the legitimate universalisation, not a re-litigation |
| 2 | Fork-divergence specialist (byte-identical catalog) | Five-site catalog verified at upstream mirrors: sites 2 + 4 byte-identical, site 1 fork-MORE-permissive (deleted upstream's warn), site 3 fork-original (no upstream counterpart), site 5 IPFS-comment upstream-inherited but fork has CRIT-02 permission validation on top |
| 3 | Behavior-test architect (ADR-0246 wave 1 test-first pattern) | Per-site test must assert throw AND error message contains `ADR-0234` literal (matches ADR-0095 amendment test-pattern + ADR-0246 wave-1 discipline) — not just "throws an error" |
| 4 | Maintainer merge-tax proxy | Sites 2 + 4 are byte-identical-with-upstream merge-tax sites; mitigation via divergence comments + INTEGRATION-LEDGER rows is necessary but not sufficient — the throw shape MUST be a labelled pattern so sync agents can preserve it mechanically |
| 5 | Reliability/failure-mode specialist | Site 3 is the most consequential behavioural change — operators upgrading will see init throw where they previously saw silent degraded search; the paired `embeddings_status` F-08-008 surfacing must be gap-named in this ADR, not deferred-to-forever |
| DA | Devil's Advocate | Challenge 1: ADR-0095 amendment was surgical for a REASON — universalizing without per-site behavior tests risks regressions. Challenge 2: site 2 (diskann) is a perpetual merge tax for a fork-only override of upstream's by-design resilience architecture; can we contain it with a feature flag instead? |

### Upstream intent summary (per-site verified 2026-05-24)

Verified by `diff` against `/Users/henrik/source/ruvnet/ruflo/` mirrors:

| Site | Upstream state | Upstream decision | Fork-only fix implication |
|------|----------------|-------------------|---------------------------|
| 1 vector-db | `diff -q` returns DIFFER — fork DELETED upstream's `hashEmbeddingWarned` one-time stderr warning + `_warning` non-enumerable property tag. Fork is MORE PERMISSIVE than upstream today (warn deleted in EMBEDDING_DIM=768 cleanup commit). | Upstream warns once per session, tolerates the fallback, tags result with `_warning` property | Fork-only fix is a re-divergence away from upstream's posture — but since the fork is ALREADY more permissive than upstream, the throw exceeds upstream by one notch (acceptable per [[feedback-no-fallbacks]]). |
| 2 diskann-backend | `diff -q` returns IDENTICAL — confirmed byte-identical with upstream at `/Users/henrik/source/ruvnet/ruflo/v3/@claude-flow/cli/src/ruvector/diskann-backend.ts` | Upstream ships the three-tier cascade by design | Fork-only fail-loud is a perpetual merge tax matching the [[ADR-0209]] correction-4 warning. Mitigated by labelled throw shape + divergence comments + INTEGRATION-LEDGER rows. |
| 3 embedding-pipeline + memory-router | Both files do NOT exist upstream (`embedding-pipeline.ts` is fork-original; `memory-router.ts` is fork-original at `cli/src/memory/`) | n/a — fork-owned surface | Free to enforce locally without merge tax. |
| 4 claims | `diff -q` returns IDENTICAL — confirmed byte-identical with upstream at `/Users/henrik/source/ruvnet/ruflo/v3/@claude-flow/cli/src/commands/claims.ts` | Upstream ships permissive-on-error RBAC by design (matches the F-04-003 finding that the whole `commands/claims.ts` is unwired plumbing) | Fork-only fail-closed is a divergence that contradicts upstream framing of the package. Acceptable per [[feedback-no-fallbacks]]. |
| 5 plugins | `diff -q` returns DIFFER — fork adds CRIT-02 permission-validation block (lines 286-308). The IPFS-vs-npm dishonest description + comment (`// Install from npm (since IPFS is demo mode)`) is upstream-inherited verbatim. | Upstream ships the dishonest envelope by design | Fork-only honesty fix on the IPFS description diverges; description rewrite is single-string change with near-zero merge tax. |

Disposition: sites 2 + 4 confirmed merge-tax (byte-identical); sites 1, 3, 5 either already-diverge or are fork-original. The pre-flight Check 2 in the ADR is empirically accurate.

### ADR-180+ alignment summary

* **[[ADR-0095]]** 2026-05-23 amendment: explicitly named `rvf-backend.ts` only; the amendment's framing was scope-wide ([[feedback-no-fallbacks]] applies universally) but textual edit landed surgically. CT-A is the universalisation. No conflict — strict extension along the same defect class.
* **[[ADR-0167]]** (cross-process RVF write coordination): orthogonal — different code class (RVF lock coordination vs loader fallback removal). No overlap.
* **[[ADR-0209]]** no-fallbacks arch-test enforcement: explicitly notes (Correction 3) that the `EmbeddingService` mock-embedding cluster is outside the detector's scan scope; ADR-0209 governs MCP-tool envelope sites (`success:true` in catch with no sibling discriminator), CT-A governs loader-cascade sites. The 5 sites here are NOT in ADR-0209's enumerated subset. Different code class, complementary discipline.
* **[[ADR-0210]]** stub-honesty mandate: governs MCP-tool handlers returning fabricated constants (`Math.random`, `42*multiplier`, `156`); CT-A governs loader cascades silently degrading the semantic surface. Conceptual sibling, different surface class.
* **[[ADR-0231]]** wave A9 `set_pattern_capacity` precedent: the agent-A6 fix removed `value.max(10)` from `set_pattern_capacity` so input `5` no longer became `10`. The same pattern (silent ambiguous resolution) is the F-06-003 family that CT-D ([[ADR-0237]]) governs — orthogonal to CT-A's loader-cascade focus.
* **[[ADR-0246]]** (CT-M, sibling completing wave 1): F-03-007 (`EmbeddingService.mockEmbedding` fallback in `forks/agentdb/src/controllers/EmbeddingService.ts`) is explicitly named in CT-M Sites table row 11 as closing "by construction when CT-A ([[ADR-0234]]) lands". Cross-ADR dependency direction is clear: CT-A lands first, CT-M re-flags satisfied.
* **[[ADR-0244]]** (CT-K, sibling): took the OTHER findings from slice 01 (F-01-001, F-01-002, F-01-003, F-01-004, F-01-005, F-01-006, F-01-007, F-01-009, F-01-011, F-01-012, F-01-013) — the CLI-honesty long-tail. CT-A took F-01-008 (plugins install) + F-01-010 (claims check) because they match the loader-cascade / silent-fallback theme. CT-A + CT-K + the slice 06/08 loader sites form an exhaustive partition.

### Critique outcomes table

| Expert | Critique | Vote | Adopted |
|--------|----------|------|---------|
| 1 | Site 1 error message should reference both ADR-0234 AND the [[ADR-0095]] amendment lineage explicitly — the historical chain ("amendment universalised to siblings") is greppable signal for future maintainers | amend | YES — supermajority 5/6 |
| 2 | Sites 2 and 4 INTEGRATION-LEDGER rows need to be made explicit in the ADR Decision section, not just gestured at in Consequences — the [[ADR-0246]] precedent expanded its row 13 to name three byte-identical files explicitly | amend | YES — supermajority 6/6 |
| 3 | Per-site test stipulation "at minimum one acceptance-tier test asserting `expect(() => ...).toThrow(/ADR-0234/)`" must be tightened to "one test asserting throw AND a separate test asserting the error message contains ADR-0234 literal" — matches the [[ADR-0246]] wave-1 dual-test discipline (source-shape + runtime separation) | amend | YES — supermajority 4/6 |
| 4 | Site 2's throw shape MUST be labelled pattern (mirror `RvfBackend.ts:1129`'s `{code, path, adr}` shape) so sync agents can preserve it mechanically; free-form throws produce merge conflicts that require human triage | amend | YES — supermajority 6/6 |
| 5 | Site 3 paired follow-on for `embeddings_status` MCP-tool live-provider surfacing (F-08-008) must be GAP-NAMED in this ADR's "Out of scope (deferred)" section, not just listed there — without it the operator-recovery story is "read the throw, hope" and the F-08-008 fix risks deferred-to-forever drift | amend | YES — supermajority 5/6 |
| 5 | Site 5 two-part fix should be ORDERED: description rewrite (part a, single-string change, zero behavioural risk) commits first; `--source ipfs` guard (part b, adds new flag handling, golden-master allowlist impact) commits second | amend | YES — supermajority 4/6 |
| DA | Challenge 1: ADR-0095 amendment was surgical for a REASON — universalizing the posture without per-site behavior tests risks regressions where the throw fires in environments the amendment author hadn't audited | amend | PARTIAL — supermajority 4/6 with DA; per-site test stipulation tightened (Expert 3 amendment satisfies this concern); test-first discipline retained but ADR does NOT require red-test commits before fix-commits (faster cycle than [[ADR-0246]] F-03-001 ceremony given the audit already provided file:line evidence) |
| DA | Challenge 2: site 2 (diskann) is a perpetual merge tax for a fork-only override of upstream's by-design resilience cascade; can we contain it with a feature flag (`RUFLO_DISKANN_STRICT=1`) instead of an unconditional throw? | reject | REJECTED — supermajority 4/6 against. The [[ADR-0095]] amendment explicitly rejected the `RUFLO_ALLOW_PURE_TS_FALLBACK` shape on direct user instruction ("dont do this: `RUFLO_ALLOW_PURE_TS_FALLBACK`. Just fail loud"). Flipping the polarity (`RUFLO_DISKANN_STRICT=1` opt-IN rather than opt-OUT) is the same env-var-as-escape-hatch shape with a different default. The user-rejected pattern is the env-var-as-policy-toggle, not the specific default value. Reject. |

### DA final position

**Withdraws Challenge 1**: the adopted refinement (Expert 3's tightened per-site test stipulation with explicit message-contains-`ADR-0234` assertion + Expert 4's labelled throw shape) satisfies the underlying "untested regression risk" concern. Per-site tests cover the throw path; labelled throw shape ensures sync agents preserve the throw mechanically.

**Holds principled dissent on Challenge 2 (site 2 merge-tax framing)**: still believes the perpetual merge-tax cost on `diskann-backend.ts` is understated — upstream's resilience architecture is intentional (the F-06-002 audit itself notes "diskann is in scope for the May-23 amendment but was not touched", which the DA reads as evidence the amendment author considered and declined to touch this surface). Supermajority rejected the env-var workaround on [[ADR-0095]] precedent; the principled dissent is recorded for the record. Does NOT block consensus. Acknowledges that the labelled throw shape (Expert 4 adoption) materially reduces the per-sync mitigation cost from "rewrite cascade" to "preserve labelled throws"; the merge-tax is bounded but real.

### Improvements adopted (applied to fragment)

1. **Site 1 error message references [[ADR-0095]] amendment lineage explicitly** (Expert 1 critique) — preserves the historical chain so future grep / future audits can trace "amendment universalised to siblings" without re-reading ADR-0233.
2. **Sites 2 and 4 INTEGRATION-LEDGER rows made explicit in Decision section** (Expert 2 critique) — matches [[ADR-0246]] row 13 precedent that expanded to name three byte-identical files. Site 1 ledger row added too (fork posture changes from "more permissive than upstream" to "more strict than upstream"). Site 5 description-rewrite ledger row added (deliberate fork-only divergence).
3. **Per-site test stipulation tightened** (Expert 3 critique) — one test asserts throw, separate test asserts message contains `ADR-0234` literal; matches [[ADR-0246]] wave-1 dual-test discipline.
4. **Site 2 throw shape MUST mirror `RvfBackend.ts:1129` labelled pattern** (Expert 4 critique) — `{code, path, adr}` typed-error template per F-06-002 cross-cutting observation 3; reduces merge-tax cost on the byte-identical site.
5. **Site 3 paired F-08-008 follow-on GAP-NAMED** (Expert 5 critique) — `embeddings_status` MCP-tool live-provider surfacing recorded as named follow-on in "Out of scope (deferred)" with explicit commitment-language to prevent deferred-to-forever drift; operator recovery story is now "throw + probe + install + retry" not "throw + hope".
6. **Site 5 two-part fix ORDERED** (Expert 5 critique) — description rewrite (part a, zero-behaviour-risk single-string) commits first; `--source ipfs` guard (part b, golden-master allowlist impact) commits second. Reduces blast radius of part b's allowlist update.

### Confirmation amendments (folded into the Decision section above)

The Per-site decisions table at the "Decision outcome" section above is updated:

* Site 1 disposition: error message now reads `[vector-db] ruvector unavailable; hash-embedding fallback removed (ADR-0234, extends ADR-0095 amendment 2026-05-23 to sibling loaders per feedback-no-fallbacks). Install @sparkleideas/ruvector-* and retry.` (lineage made explicit).
* Site 2 disposition: throw shape constrained to `{code: 'DISKANN_TIER_UNAVAILABLE' | 'HNSW_TIER_UNAVAILABLE' | 'PURE_JS_DISALLOWED', path: <module-spec>, adr: 'ADR-0234'}` typed-error template; INTEGRATION-LEDGER row required.
* Site 3 disposition: F-08-008 paired follow-on explicitly named in "Out of scope (deferred)" — "MCP `embeddings_status` runtime-provider field (F-08-008) — paired follow-on commitment, NOT deferred-to-forever; surface the live provider (`transformers.js | ruvector | hash-fallback | unavailable`) so operators have a probe before invoking embedding-dependent code paths."
* Site 4 disposition: INTEGRATION-LEDGER row required; throw shape constrained to `{code: 'POLICY_LOAD_FAILED', path: <policy-file-path>, adr: 'ADR-0234'}` template.
* Site 5 disposition: ORDERED two-part fix — part (a) description+examples rewrite commits first (single-string change, zero behavioural risk); part (b) `--source ipfs` guard commits second (golden-master allowlist impact); INTEGRATION-LEDGER row for the description rewrite divergence.
* Per-site test stipulation: each test asserts throw AND a separate test asserts the error message literal `'ADR-0234'`. Source-shape gates in fragment specify the exact grep-verifiable invariants per file.
