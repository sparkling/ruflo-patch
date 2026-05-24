## ADR-0242 — CT-I: shared error library + MCP envelope honesty

**Status**: proposed (post-swarm-review)
**Swarm**: 6 experts + devil's advocate, Weighted consensus (queen ×3; 8 weighted points total, threshold 4)
**Triage rank**: 15 (lowest urgency per [[ADR-0233]] §Decision — long-term cultural debt; explicitly framed as not-a-migration)

### Decision (post-swarm-review)

Ratify **Option A + Option B as drafted** (extract `gastown-bridge/errors.ts` to shared `@claude-flow/errors`; advisory-first lint forbidding NEW `throw new Error(string)`; MCP-handler arch-test asserting fatals throw), with **4 improvements** surfaced by the panel and **2 substantive corrections** to load-bearing pre-flight claims. Long-term, scope-limited framing preserved. **Explicitly NOT** Option C (big-bang fix all ~1,994 throws) or Option D (status quo + document).

Improvements (folded into the ADR's §"Swarm review (2026-05-24)" section):

1. **(E2 + queen)** Explicit disjointness paragraph vs [[ADR-0247]] (CT-N F-04-009, client-side `callMCPTool` `isError`). Same protocol-boundary concern, opposite ends. Disjoint by artifact (handlers vs `callMCPTool`) and mechanism (arch-test on swallow-shape vs runtime `isError` inspection).
2. **(E3 + queen)** Explicit allowlist file names + content-keying convention in §Confirmation: `lib/throw-new-error-allowlist.txt` (content-keyed) + `lib/mcp-handler-fatal-throw-allowlist.txt` (handler-id-keyed). Both new check scripts register in BOTH `run_check_bg` AND `collect_parallel` per `[[reference-acceptance-runcheck-vs-collect]]`.
3. **(Queen)** INTEGRATION-LEDGER row commitment in §Confirmation. Disposition for both fork edits (new `@claude-flow/errors` package + `gastown-bridge/errors.ts` re-export shim): `convergence-with-upstream` (re-organization of upstream-derived content under a shared boundary).
4. **(E5 + DA-counter)** §"Erosion-vs-rot disposition" subsection: DA's "rot like dead retry libs" challenge structurally answered — (i) advisory-first lint creates review-time forcing function the retry libs never had; (ii) canon is minimum-viable (2 plugin families already adopt it). Mitigation invariant: cycle N+3 adoption-rate check.

DA (devil's advocate) holds **principled dissent on cultural debt acceptance**: argues lint-grandfathering is perpetual bifurcation and that an honest "accept the debt" disposition would be cleaner than an advisory-first detector that may never promote to `exit 1`. DA accepts the majority verdict (lint cost is small; canon enables future targeted migrations like F-13-006); records dissent for the [[ADR-0233]] follow-up tracker.

### Implementation steps

1. **Extract `@claude-flow/errors` package** at `forks/ruflo/v3/@claude-flow/errors/`:
   - `src/index.ts` re-exports the ~157-LOC base subset from `gastown-bridge/errors.ts` (`GasTownError` → renamed `RufloError`; `GasTownErrorCode` → renamed `RufloErrorCode`; `wrapError`, `getErrorMessage`, `isGasTownError` → renamed `isRufloError`, plus type guards).
   - Plugin-specific subclasses (`BeadsError`, `FormulaError`, `ConvoyError`, `CLIExecutionError`) stay in `gastown-bridge`.
   - Naming convention (`RUFLO_E*`, `RUFLO_ERR_*`, etc.) deferred to impl swarm per F-13-004; ADR commits only to existence of single convention in new package.
   - Add divergence-marker comment in `src/index.ts` per [[ADR-0234]] precedent: `// FORK: shared @claude-flow/errors extracted from upstream gastown-bridge/errors.ts; see ADR-0242.`
   - `README.md` documents canon: when to extend `RufloError` vs `Error`, when to set `cause:`, when to use `wrapError()`, naming convention.
   - Behavior test asserting `new RufloError(...)` round-trip + `wrapError(parent).cause === parent`.

2. **Plugin re-export shim** at `forks/ruflo/v3/plugins/gastown-bridge/src/errors.ts`:
   - Replace base subset with `export { RufloError as GasTownError, RufloErrorCode as GasTownErrorCode, wrapError, getErrorMessage } from '@claude-flow/errors';` shape.
   - Plugin-specific subclasses (`BeadsError`, etc.) updated to `extends GasTownError` (which is now the imported `RufloError`).
   - Arch-test asserts re-export round-trips: `new GasTownError('x') instanceof RufloError === true`.
   - Commit per `[[feedback-commit-forks-before-release]]`.

3. **INTEGRATION-LEDGER rows (2)**:
   - New `@claude-flow/errors` package: `convergence-with-upstream` (extracts upstream-derived content into shared boundary).
   - `gastown-bridge/errors.ts` re-export shim: `convergence-with-upstream` (refactor preserves byte-identical consumer call-site behavior; upstream's `ruvnet/ruflo/v3/plugins/gastown-bridge/src/errors.ts` is the seed).
   - Both per `[[feedback-update-integration-ledger]]`.

4. **Lint script** at `scripts/check-throw-new-error.mjs`:
   - Zero-dep, modelled on `scripts/check-silent-catches.mjs` + `scripts/check-undiscriminating-catches.mjs`.
   - Scans `forks/ruflo/v3/@claude-flow/cli/src` and `forks/agentic-flow/src` (matching existing checks' scan roots).
   - Detects `throw new Error("..."` (literal-string constructor argument; net-new sites only).
   - Reads `lib/throw-new-error-allowlist.txt` (content-keyed per the `fcab2bc` refactor pattern; baseline = today's ~1,994 sites).
   - Diagnostic: "throw an instance of `RufloError` (or subclass) from `@claude-flow/errors`, with a `code:` and `cause:` where applicable; see `forks/ruflo/v3/@claude-flow/errors/README.md`."
   - Advisory-first (`exit 0` with count); promotion to `exit 1` iff FP rate empirically `0` after baseline.

5. **MCP-handler arch-test** at `scripts/check-mcp-handler-fatal-throw.mjs`:
   - Scans `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/`.
   - Narrow shape only: handler-top-level `catch(e) { return { success: false, ...} }` (OR `{ available: false, ...}`) with no `instanceof` / `.name===` discriminator + no re-throw path.
   - Honest discriminated catches (`catch (e) { if (e instanceof OptionalModuleNotFound) return {available:false}; throw e; }`) explicitly allowed.
   - Reads `lib/mcp-handler-fatal-throw-allowlist.txt` (handler-id-keyed; baseline = today's ~56 sites).
   - Advisory-first per [[ADR-0209]] / [[ADR-0210]] settled approach.
   - Does NOT propose changing `mcp-server.ts:691-707` wrap (the wrap is correct — throw → JSON-RPC `-32603` frame).

6. **Acceptance check registration** per `[[reference-acceptance-runcheck-vs-collect]]`:
   - Both new checks registered in BOTH `run_check_bg` AND `collect_parallel` lists in `scripts/ruflo-publish.sh`.
   - Gate is `no-skip-accepted` per `[[feedback-skip-accepted-as-squelch]]` (advisory-first is NOT a squelch; modelled on ADR-0209's settled pattern).

### Dependencies

- [[ADR-0201]] — Remediation-ADR pre-flight checklist that cleared this draft (modulo the 2 corrections in this fragment: gastown-bridge upstream-derived provenance; retry-libs upstream parity confirmatory).
- [[ADR-0209]] — owns per-site bulk-fix of dishonest-success envelopes; this ADR owns the protocol-boundary mechanism (the lint + arch-test that says "fatals must throw"). Disjoint per ADR-0242 §pre-flight check #4.
- [[ADR-0210]] — second-pass council explicitly identified this micro-ADR as owed for the protocol-boundary signal; this ADR delivers the envelope-honesty half (server-side handler-rule).
- [[ADR-0233]] §CT-I — defect-class origin; priority 10 (lowest urgency); long-term framing consistent with that calibration.
- [[ADR-0234]] — divergence-marker comment precedent (applied to new `@claude-flow/errors/src/index.ts` provenance).
- [[ADR-0239]] (CT-F) — defers `gastown-bridge` deletion specifically because it's a published artifact (`@claude-flow/plugin-gastown-bridge@0.1.4` on Verdaccio) whose source is upstream; this ADR's extraction is therefore also not a delete.
- [[ADR-0247]] (CT-N) — client-side complement (`callMCPTool` `isError` propagation). Disjoint by artifact + mechanism per Improvement #1 above.
- [[ADR-0248]] (CT-O) — owns gastown-bridge per-plugin disposition; this ADR's extraction does not conflict (plugin runtime behavior preserved via re-export shim).

### Validation

- **Source-shape grep**: `forks/ruflo/v3/@claude-flow/errors/src/index.ts` exists, exports `RufloError` (or whatever name the swarm settles on), `RufloErrorCode`, `wrapError`, `getErrorMessage`, `isRufloError`.
- **Source-shape grep**: `forks/ruflo/v3/plugins/gastown-bridge/src/errors.ts` re-exports the base subset from `@claude-flow/errors` (so `class GasTownError extends RufloError` — preserving plugin-side API).
- **Source-shape grep**: `scripts/check-throw-new-error.mjs` exists, zero external deps, scans both fork TS roots, reads `lib/throw-new-error-allowlist.txt`, exits `0` advisory-first with count.
- **Source-shape grep**: `scripts/check-mcp-handler-fatal-throw.mjs` exists, scans `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/`, baseline allowlist = today's ~56 sites.
- **Source-shape grep**: `scripts/ruflo-publish.sh` invokes both new checks alongside `check-silent-catches.mjs` and `check-undiscriminating-catches.mjs`.
- **Source-shape grep**: `forks/ruflo/v3/@claude-flow/errors/README.md` exists, documents canon.
- **Behavioural acceptance**: `new RufloError('msg', RufloErrorCode.X, {ctx:1}, parent).cause === parent`; `.toJSON()` returns expected shape; `.code === 'RUFLO_E_X'` (or whatever scheme swarm picks).
- **Behavioural acceptance**: re-export round-trip — `import { GasTownError } from 'gastown-bridge/errors'; expect(new GasTownError('x') instanceof RufloError).toBe(true);`.
- **MCP-handler arch-test**: baseline count > 0 (the ~56 existing handlers); allowlist entries equal that baseline; FP count empirically measured; promote-to-`exit-1` gate firing iff new-code rate is `0` after baseline.
- **No `skip_accepted`** per `[[feedback-skip-accepted-as-squelch]]`. Advisory-first lint is NOT a squelch — it's the explicit cultural-shift instrument modelled on ADR-0209's "fixed regression assertion + permanently-advisory counter."
- **Post-release**: verify via fresh install in `/tmp` per `[[feedback-inspect-installed-not-dev-nodemodules]]`, NOT against dev `node_modules/`.

### Top risk + mitigation

- **Risk (DA)**: Shared error library rots like the dead retry libs — new code keeps adopting the naked `throw new Error(string)` pattern; canon adoption stays at 2 plugins forever; advisory lint plateaus and never promotes to `exit 1`.
- **Mitigation**: Erosion-vs-rot disposition (Improvement #4). Structural difference from retry libs is (i) advisory-first lint creates a review-time forcing function (engineer sees the warning at PR review; the retry libs never had this signal); (ii) canon is minimum-viable (extracts exactly what 2 plugin families already use, not a richer-than-needed design). **Mitigation invariant**: cycle N+3 adoption-rate check. If the lint advisory count is still > 0 in cycle N+3 AND canon adoption rate is zero across all new code, that's the "rotting" signal and the canon may need a "delete-and-accept-the-debt" follow-up ADR per DA's principled dissent. If canon adoption is non-zero, the canon is working as designed and the long-tail of existing throws is exactly the documented erosion-not-replacement path.
- **Secondary risk (E2)**: MCP-handler arch-test FP rate stays > 0 forever (never promotes to `exit 1`); the gate becomes documentation rather than enforcement. Mitigation: the *signal* is what matters (handler authors see the warning at review time); the gate is the icing. Per [[ADR-0209]]'s settled pattern, permanently-advisory counters are an accepted shape — not a regression.

### Weighted consensus tally (8 weighted points: queen ×3 + 5 worker votes; threshold 4)

| Voter | Weight | Vote | One-line position |
|-------|--------|------|-------------------|
| **Queen** (strategic) | 3 | **adopt-with-improvements** | The canon + lint + arch-test triple is the right shape; long-term framing pre-empts the "rot like dead retry libs" risk; improvements tighten structural claims without re-scoping. |
| E1 (error-class hierarchy) | 1 | adopt | `gastown-bridge/errors.ts` is the right gold standard (701 LOC hierarchy with `code`/`cause`/`context`/`timestamp`/`captureStackTrace`/`toJSON`/`toString`/type guards + `wrapError` adapter — every modern shape present). |
| E2 (MCP-envelope) | 1 | adopt-with-amendment | Arch-test rule (handler-top-level swallow w/o discriminator) is right narrow shape; ADR must note disjointness from [[ADR-0247]] (CT-N) — same protocol-boundary, opposite ends. |
| E3 (lint-grandfathering) | 1 | adopt-with-amendment | Advisory-first pattern matches existing precedent; FP-rate-zero promotion criterion sound; allowlist must be content-keyed (matching `fcab2bc` refactor); script names + acceptance-registration spec should be explicit. |
| E4 (retry-library consolidation) | 1 | adopt-as-out-of-scope | Correctly deferred per `feedback-corpus-evidence-before-feature-work`. Confirming: both retry libs exist in upstream too with zero production callers; F-13-001 deferral is upstream-aligned by omission. |
| E5 (migration-pace) | 1 | adopt | Long-term framing honest about what doesn't migrate; ~1,994 throws stay disclosure prevents future maintainers misreading ADR as migration commitment; cycle-1 scope (extract + ship advisory checks) fits one release cycle. |
| **DA** (devil's advocate) | 1 | **hold-principled-dissent** | "Shared error library will rot just like dead retry libs unless mandatory adoption is gated — but mandatory adoption is what ADR explicitly disclaims." AND: "Lint-grandfathering means perpetual bifurcation — accept the cultural debt instead." Both addressed by Improvement #4 (erosion-vs-rot) and the DA dissent record below. |

**Result**: queen (3) + 5 adopt-class votes = **8 weighted points adopt** (threshold `ceil(8/2) = 4` cleared). DA holds principled dissent (recorded; not a vote against). Decision ratified.

**DA position**: principled dissent held + recorded; no withdrawal. Vindication test: if after 3 cycles the lint hasn't promoted to `exit 1` AND canon adoption rate is non-zero AND advisory count is materially growing (not just plateauing), DA's "rot like retry libs" hypothesis is vindicated and a follow-up "delete-and-accept-the-debt" ADR may be owed.

### Key upstream finding (verification per assignment)

**`forks/ruflo/v3/plugins/gastown-bridge/src/errors.ts` is NOT fork-only — it IS upstream code**. Direct read on 2026-05-24:

- Fork `/Users/henrik/source/forks/ruflo/v3/plugins/gastown-bridge/src/errors.ts`: **701 LOC**.
- Upstream `/Users/henrik/source/ruvnet/ruflo/v3/plugins/gastown-bridge/src/errors.ts`: **700 LOC**.
- `diff -q` between fork and upstream returns no output → **byte-identical for the hierarchy subset this ADR proposes to extract**.
- Plugin is **published as `@claude-flow/plugin-gastown-bridge@0.1.4`** on Verdaccio (confirmed via `curl -s http://localhost:4873/@claude-flow/plugin-gastown-bridge` → `{"name":"@claude-flow/plugin-gastown-bridge","versions":{"0.1.4":...}}`).
- Listed in `featured/trending/official/newest` per `cli/scripts/publish-registry.ts:195` and `discovery.ts` (per [[ADR-0239]] cluster 5).

**Implication**: the prompt's hint that gastown-bridge is "fork-only per CT-O finding" is **incorrect**. CT-O ([[ADR-0248]]) treats `gastown-bridge` as a **published plugin** subject to per-plugin disposition; CT-F ([[ADR-0239]]) **explicitly defers** gastown-bridge's deletion specifically because it's a published artifact whose source is upstream. This makes the ADR-0242 extraction **easier, not harder**: the new `@claude-flow/errors` package re-exports code that originated upstream and is currently shipped via two upstream-aligned plugins (`gastown-bridge` itself and `agentic-qe` via inheritance). Merge-tax against future upstream syncs is structural (a new package boundary), not substantive (no upstream-divergent content). INTEGRATION-LEDGER disposition: `convergence-with-upstream` (re-organization of upstream-derived content under a shared boundary), NOT `superseded-by-local` (which would imply fork-divergent invention).

**Secondary upstream finding**: fork's `production/error-handler.ts` has **480 LOC**; upstream's has **398 LOC**. The fork has *extended* the dead facility by ~82 LOC without wiring any callers, deepening F-13-002. Minor drift; worth noting for the F-13-002 follow-up ADR's "wire-or-delete" calculus. If "delete" wins, deletion closes 480 fork-LOC; if "wire" wins, the wire must happen on the upstream-aligned 398-LOC version to minimize merge tax. **No change required to ADR-0242** — this is data for the F-13-002 follow-up.

**Tertiary upstream finding**: both retry libraries exist in upstream too (`ruvnet/ruflo/v3/@claude-flow/cli/src/production/retry.ts` and `ruvnet/ruflo/v3/@claude-flow/shared/src/resilience/retry.ts`), both with zero production callers in either fork or upstream. F-13-001 deferral is therefore **upstream-aligned by omission** — picking one library and deleting the other is a fork-only intervention that would carry permanent merge tax. The future F-13-001 micro-ADR will need to make that call explicitly.

### Cross-references

- [[ADR-0233]] §CT-I + §"Pre-flight inversions" — defect-class origin; CT-I is NOT a pre-flight inversion (the ADR correctly identifies the structural rule without needing flip).
- [[ADR-0201]] §"Remediation-ADR pre-flight checklist" — ran with the 2 corrections above applied.
- [[ADR-0209]] — Step 2 explicitly deferred the protocol-boundary mechanism to a future micro-ADR; this ADR is that mechanism. Disjoint.
- [[ADR-0210]] — second-pass council explicitly identified this micro-ADR as owed; ADR-0242 delivers the envelope-honesty half (server-side handler-rule).
- [[ADR-0234]] — divergence-marker comment precedent (applied to new `@claude-flow/errors/src/index.ts` provenance).
- [[ADR-0239]] (CT-F) — gastown-bridge deferred from deletion specifically because of published-artifact status; ADR-0242's extraction is also not a delete.
- [[ADR-0247]] (CT-N) — client-side complement; disjoint by artifact + mechanism per Improvement #1 (ADR-0247's own pre-flight already documents this disjointness).
- [[ADR-0248]] (CT-O) — owns gastown-bridge per-plugin disposition; no conflict with extraction.
- `[[feedback-best-effort-must-rethrow-fatals]]` — the corpus rule the MCP envelope-honesty arch-test operationalizes at the largest single cluster of violations.
- `[[feedback-no-fallbacks]]` — parent policy; envelope-honesty rule is a specific instance.
- `[[feedback-skip-accepted-as-squelch]]` — advisory-first lint is NOT a squelch.
- `[[feedback-corpus-evidence-before-feature-work]]` — why F-13-001/002/003/004 deferred to follow-up swarm reviews.
- `[[feedback-remediation-adr-preflight]]` — source of 4-check pre-flight; corrections #1 (gastown-bridge upstream-derived) and #2 (retry-libs upstream parity) sharpen pre-flight check #2 ("upstream hasn't already decided it").
- `[[feedback-update-integration-ledger]]` — INTEGRATION-LEDGER rows owed for both fork edits (both `convergence-with-upstream`).
- `[[feedback-commit-forks-before-release]]` — both fork edits commit BEFORE next `npm run release`.
- `[[feedback-inspect-installed-not-dev-nodemodules]]` — post-release verification uses fresh `/tmp` install.
- `[[reference-acceptance-runcheck-vs-collect]]` — both new check scripts register in BOTH lists per Improvement #2.
