## ADR-0234 — CT-A: extend [[ADR-0095]] fallback removal to sibling loaders

**Status**: proposed (post-swarm-review)
**Swarm**: 6 experts + devil's advocate, Byzantine consensus (≥3/6 supermajority; f=⌊(N-1)/3⌋=1)
**Triage rank**: 4 (CT-A is the silent-fallback long-tail beyond [[ADR-0095]]'s surgical RVF amendment)

### Decision (post-swarm-review)

Option A (per-site fail-loud throw, no escape hatch) retained as the canonical shape — mirrors the [[ADR-0095]] 2026-05-23 amendment posture user explicitly affirmed ("dont do this: `RUFLO_ALLOW_PURE_TS_FALLBACK`. Just fail loud"). Six improvements adopted from the dialectic, none of which weaken the fail-loud posture: (1) site 1 (vector-db) error message names ADR-0095's amendment lineage explicitly (not just ADR-0234) so the historical chain is greppable; (2) site 2 (diskann) test must use the `RvfBackend.ts:1129` typed-error shape pattern (`{code, path, adr}`) rather than free-form throw, per F-06-002 cross-cutting observation 3; (3) site 3 (`embedding-pipeline`) gets a paired follow-on commitment to surface live provider in `embeddings_status` MCP response (F-08-008) — without it the operator's recovery story is "read the throw, find the cause" only; the ADR records the follow-on as a named gap, not a deferred-to-forever; (4) site 4 (claims) `INTEGRATION-LEDGER.md` row creation made explicit per `[[feedback-update-integration-ledger]]` — the byte-identical upstream means every sync touching `commands/claims.ts:265-271` will conflict; (5) site 5 (plugins) two-part fix retained but ordered: rewrite description+examples FIRST (single-string fix, zero behavioural risk), guard `--source ipfs` SECOND (adds new flag handling, golden-master snapshot impact); (6) per-site test coverage stipulation tightened from "at minimum one acceptance-tier test" to "one test asserting throw AND one test asserting throw includes ADR-0234 reference in message" — matches the [[ADR-0095]] amendment test pattern. DA holds principled dissent on site 2 (diskann) merge-tax framing — see DA final position.

### Implementation steps

1. **Site 1 fork-side fix** in `forks/ruflo/v3/@claude-flow/cli/src/ruvector/vector-db.ts:155-159, 235-260`: throw at `loadRuVector` failure point with typed error `{code: 'RUVECTOR_UNAVAILABLE', path: <module-spec>, adr: 'ADR-0234'}`. Remove `backend: 'fallback'` from `getStatus()` return shape. Keep `generateHashEmbedding` in-file but unreachable from production callsites; tests-only import allowed. Error message references both ADR-0234 and the [[ADR-0095]] amendment lineage. Commit per `[[feedback-commit-forks-before-release]]`.

2. **Site 2 fork-side fix** in `forks/ruflo/v3/@claude-flow/cli/src/ruvector/diskann-backend.ts:54-114`: three typed-error throws (one per cascade tier) using the `RvfBackend.ts:1129` pattern. Preserve `createJsFallbackIndex` as test-only helper (callable from `tests/` paths; unreachable from `getDiskAnnIndex` production path). Add `// ADR-0234: fork diverges from upstream (which ships silent cascade by design)` divergence comment naming this ADR. INTEGRATION-LEDGER row required (byte-identical with upstream confirmed at `/Users/henrik/source/ruvnet/ruflo/v3/@claude-flow/cli/src/ruvector/diskann-backend.ts`).

3. **Site 3 fork-side fix** in `forks/ruflo/v3/@claude-flow/memory/src/embedding-pipeline.ts:147-167, 220-244` + `forks/ruflo/v3/@claude-flow/cli/src/memory/memory-router.ts:874-882`: throw the actual error in `_doInitialize` (drop `console.warn`-then-fall-through); remove bare `catch {}` at `memory-router.ts:880`; delete hash branch in `embedInternal:242-243`. **Paired follow-on**: file a `embeddings_status` MCP-tool gap-mark naming F-08-008 (surface live provider — `transformers.js | ruvector | hash-fallback`) so the operator-recovery story is "read the throw + check `embeddings_status` for confirmation". Follow-on is gap-named, not deferred-to-forever.

4. **Site 4 fork-side fix** in `forks/ruflo/v3/@claude-flow/cli/src/commands/claims.ts:265-271`: replace permissive-default branch with `return { success: false, exitCode: 1 }` plus clear error message naming the underlying cause. Add `// ADR-0234: fork-only fail-closed (upstream is byte-identical permissive-by-design)` divergence comment. INTEGRATION-LEDGER row required.

5. **Site 5 fork-side fix** in `forks/ruflo/v3/@claude-flow/cli/src/commands/plugins.ts:220, 230, 311-313`: ORDERED two-part fix. Part (a) — rewrite `description`, two `examples:` lines, and `discovery` spinner text from "IPFS registry" to "Install a plugin from npm registry (IPFS path not yet implemented)". Single-string change. Part (b) — add `if (source === 'ipfs') throw new Error('[plugins] IPFS install path not implemented; use --source npm')` guard at source-selection boundary. Part (a) commits first (lowest risk); part (b) commits second (adds new flag handling). Golden-master snapshot allowlist entry per `[[ADR-0215]]` required for the help-text change.

6. **Per-site acceptance tests**: `tests/unit/adr0234-f06001-vector-db-throw.test.mjs`, `tests/unit/adr0234-f06002-diskann-throw.test.mjs`, `tests/unit/adr0234-f08002-embedding-pipeline-throw.test.mjs`, `tests/unit/adr0234-f04002-claims-fail-closed.test.mjs`, `tests/unit/adr0234-f01008-plugins-honest-description.test.mjs`. Each test asserts throw + error message contains the literal string `'ADR-0234'`.

7. **INTEGRATION-LEDGER rows** for sites 2 and 4 (the two byte-identical-with-upstream sites): two `superseded-by-local` disposition rows citing ADR-0234, with `cherry-pick -x`-able trailers. Site 1 is already-diverging from upstream (fork has more permissive behaviour today); the additional fork-only fail-loud throw is itself a new divergence, so a ledger row is required there too. Sites 3 and 5 are fork-original / partially-diverging — no new ledger row needed for the throw itself, but site 5's description rewrite is a deliberate fork-only divergence and warrants a ledger row.

### Dependencies

- [[ADR-0095]] — the 2026-05-23 amendment whose posture this ADR universalises. Without ADR-0095's "no escape hatch" precedent, Option B (env-var opt-in) would re-enter consideration; with it, Option A is the only consistent fork-policy.
- [[ADR-0201]] — Remediation-ADR pre-flight checklist that gated this draft. Verified 2026-05-24: signal reaches user on 4/5 sites (sites 1-4 no signal; site 5 partial visible-but-misleading); upstream byte-identical on sites 2 and 4 (merge-tax acknowledged); premise true at runtime on all 5 sites; no sibling-ADR overlap with [[ADR-0209]] (different code class — MCP-tool envelopes vs loader cascades), [[ADR-0210]] (fabricated-constants vs silent degradation), or [[ADR-0227]] (threshold tuning vs the score that the threshold gates).
- [[ADR-0210]] — stub-honesty mandate is the conceptual sibling: ADR-0210 governs MCP-tool handlers returning canned values; ADR-0234 governs loader cascades silently degrading the semantic surface. Different code class, same discipline.
- [[ADR-0227]] — adaptive threshold floor 0.3→0.15 assumed correct cosine score; ADR-0234 site 3 addresses the silent fallback that swaps the score generator underneath the threshold. Orthogonal but adjacent — closure of site 3 reinforces ADR-0227's recalibration.
- [[ADR-0233]] §CT-A — parent rollup explicitly directing theme-batched remediation. ADR-0234 IS that remediation.
- [[ADR-0244]] (CT-K, sibling) — took the other 2 slice-01 findings (F-01-008 actually consumed here at site 5; F-01-010 consumed here at site 4 + CT-K F-01-010 row 10). ADR-0234 + ADR-0244 exhaustively partition slice-01 + the loader sites from slice 06 / 08 / 04.
- [[ADR-0246]] (CT-M, sibling) — F-03-007 (`EmbeddingService.mockEmbedding` fallback) closes by construction when ADR-0234 lands (CT-M Sites table row 11). Cross-ADR dependency direction is clear.
- [[feedback-no-fallbacks]] / [[feedback-best-effort-must-rethrow-fatals]] — corpus rules that this ADR enforces uniformly across the 5 sibling loaders.
- [[feedback-update-integration-ledger]] — required for sites 2 and 4 (byte-identical upstream), site 1 (now-divergent fork posture), and site 5 description rewrite.

### Validation

- **Source-shape gates (deterministic)**:
  - `forks/ruflo/v3/@claude-flow/cli/src/ruvector/vector-db.ts` — zero callers of `generateHashEmbedding` outside `tests/`; `getStatus()` return shape contains no `backend: 'fallback'` literal.
  - `forks/ruflo/v3/@claude-flow/cli/src/ruvector/diskann-backend.ts` — zero `catch { /* Fall through */ }` blocks in `getDiskAnnIndex`; `createJsFallbackIndex` unreachable from production path (grep-verified).
  - `forks/ruflo/v3/@claude-flow/memory/src/embedding-pipeline.ts` — `_doInitialize` re-throws; no `console.warn`-then-continue; `embedInternal:242-243` hash fallback deleted.
  - `forks/ruflo/v3/@claude-flow/cli/src/memory/memory-router.ts:874-882` — no bare `catch {}` swallowing init failures.
  - `forks/ruflo/v3/@claude-flow/cli/src/commands/claims.ts:265-271` — `return { success: false, exitCode: 1 }` on policy-load error; no `'Granted (default permissive policy)'` reason string.
  - `forks/ruflo/v3/@claude-flow/cli/src/commands/plugins.ts:220, 230, 311-313` — `description` and `examples:` reference "npm registry" not "IPFS"; `--source ipfs` throws.

- **Behavioural acceptance**:
  - Boot CLI in a fresh sandbox with `ruvector` uninstalled; invoke `vector-db.createVectorDB(768)`; expect throw with `ADR-0234` in message (NOT silent degradation to hash-stretched-sine).
  - Boot CLI with `@xenova/transformers` AND `ruvector` both uninstalled; invoke `embedding-pipeline.initialize()`; expect throw (NOT `console.warn`-then-hash).
  - Invoke `cli claims check -c swarm:create -u bob` against a deliberately-unreadable policy file; expect exit 1 (NOT exit 0 with "Granted (default permissive policy)").
  - Invoke `cli plugins install --source ipfs <name>`; expect throw naming "IPFS install path not implemented".
  - Per-site test asserts error message contains literal `'ADR-0234'`.

- **No `skip_accepted`** per `[[feedback-skip-accepted-as-squelch]]`.

### Top risk + mitigation

- **Risk**: site 3 (`embedding-pipeline` + `memory-router`) is the most consequential behavioural change in this ADR — operators upgrading from a pre-ADR-0234 wrapper will see init throw where previously they saw degraded search. The pre-flight check 1 verdict was "no signal reaches user", which means today's operators may not even know they're running on hash fallback — so the throw is the FIRST signal they get, and it surfaces during init not at query time (longer feedback delay for operators reading their logs). This is the intended posture (matches [[ADR-0095]] amendment), but operators with no `@xenova/transformers` AND no `ruvector` installed will see immediate hard failure where they previously had silent degradation that "worked" by some weak metric.

- **Mitigation**: paired follow-on per step 3's commitment — `embeddings_status` MCP tool surfaces the live provider (`transformers.js | ruvector | hash-fallback | unavailable`) so operators can probe their installation state BEFORE invoking any embedding-dependent code path. The throw message names the missing dependencies explicitly (matching `RvfBackend.ts:1129`'s `[RvfBackend] Native binding @ruvector/rvf-node failed to load ... Install @ruvector/rvf-node to proceed.` pattern). Combined: operators have a probe (`embeddings_status`), an actionable throw (`Install @xenova/transformers and/or ruvector`), and a recovery path (npm install + retry). The follow-on F-08-008 fix is gap-named in this ADR's "Out of scope (deferred)" section so it doesn't disappear into the deferred-to-forever pile.

- **Secondary risk**: site 2 (diskann) is the highest merge-tax site — byte-identical with upstream and the upstream design explicitly ships the three-tier cascade. Every upstream sync that touches `cli/src/ruvector/diskann-backend.ts` will conflict. DA flagged this with two concrete challenges (see DA final position).

- **Secondary mitigation**: per the F-06-002 audit's cross-cutting observation 3 ("loader error messaging is uneven; `rvf-backend.ts:1129` does the right thing — include `code`, surface the path, name the ADR that removed the fallback"), site 2's throw shape MUST match the `RvfBackend.ts:1129` template precisely. This means a sync agent encountering the conflict can mechanically port the throw shape (it's a labelled pattern, not free-form), reducing the merge-tax cost from "rewrite the cascade" to "preserve the labelled throws". The divergence comment names ADR-0234 explicitly; `[[feedback-update-integration-ledger]]` requires per-sync disposition rows that name the ADR. Cost is bounded but real.
