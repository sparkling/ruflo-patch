# ADR-0069 15-Agent Swarm — Independent Review (2026-04-21)

**Reviewer**: independent code-review agent (read-mostly, no primary impl).
**Scope**: in-flight 15-agent swarm working on ADR-0069 residuals (F3 booster, ONNX tier, Bug #3 memory persist, A5 ewcLambda, A6 ports, A1 WAL busy_timeout).
**Repos audited**: `ruflo-patch`, `forks/ruflo` (branch `main`), `forks/agentic-flow` (branch `main`).
**Preflight/acceptance not run** per task rules — trusted the swarm's own runs.

Informational under `docs/reviews/` per task step 7 (exceeds ADR-mapping scope).

---

## Summary — overall sign-off: **conditional GO**

The swarm's product fixes are substantive and well-documented. Three issues must be addressed before commit/publish (listed as blockers below); one is advisory. No ADR-0082 violations in the fork source, no weakened test asserts, no hardcoded `@claude-flow/*` scopes in new code.

---

## Files audited

Uncommitted fork work:
- `forks/ruflo` — 1 M (`v3/@claude-flow/plugins/src/integrations/ruvector/self-learning.ts` one-line `readLearningRate()` call for HIGH_ACCURACY config), 1 M (`v3/@claude-flow/cli/src/memory/memory-router.ts` Bug #3 fix, ~90 lines), 1 new (`v3/@claude-flow/memory/src/bm25.ts`), plus 39 `package.json` version bumps.
- `forks/agentic-flow` — 23 files; key impl changes in `config/ports.ts` (new), `cli/claude-code-wrapper.ts`, `cli/daemon-cli.ts`, `mcp/fastmcp/servers/http-sse.ts`, `mcp/fastmcp/servers/stdio-full.ts`, `mcp/fastmcp/tools/hooks/intelligence-tools.ts`, `proxy/anthropic-to-onnx.ts`, `services/agentdb-service.ts` (ONNX tier added, +86 lines), `packages/agentdb/src/backends/rvf/SonaLearningBackend.ts`, `packages/agentdb/src/controllers/NightlyLearner.ts` (schema change — see advisory #A1), `reasoningbank/db/queries.js` + research-swarm `db-utils.js` + `optimize-db.js` (WAL busy_timeout).

ruflo-patch: 67 files; mostly acceptance-check linter annotations + explicit `_run_and_kill*` timeouts. Two new acceptance libs: `acceptance-adr0069-bug3-checks.sh`, `acceptance-adr0069-f3-checks.sh` (F3 extension). Seven new tests under `tests/unit/adr0069-*.test.mjs`.

---

## Conflict scan (files potentially touched by 2+ agents)

No hard write-conflicts in the working tree (git diff applies cleanly per repo). Candidate shared surfaces:

- `self-learning.ts` — **single-line edit**, line 2407 (HIGH_ACCURACY_LEARNING_CONFIG) uses `readLearningRate(0.05)`. The helper itself was not retouched. One agent.
- `agentdb-service.ts` (agentic-flow) — 119-line diff, all in `upgradeEmbeddingService()`. Coherent single-author style. One agent.
- `stdio-full.ts` — only two line edits (import + register call + header log text). One agent.
- `ADR-0069-future-vision.md` in ruflo-patch — one status update block appended at line ~630. One agent. See blocker #B2 below for a self-contradiction issue.

---

## BLOCKERS

### B1. `adr0069-bug3-persist` and `adr0069-f3-onnx` are dispatched but never collected

`scripts/test-acceptance.sh` line 709 dispatches `run_check_bg "adr0069-bug3-persist" ...` and line 752 dispatches `run_check_bg "adr0069-f3-onnx" ...`, but **neither is listed in the `collect_parallel "all" ...` block** (only `adr0069-f3-booster` appears at line 1732). Effect: these checks run but their pass/fail result is never surfaced in the "all" report. This is a silent-pass regression of exactly the kind ADR-0097 was written to prevent. **Fix**: add both entries to the collect_parallel list (line 1729-1734 area) with the same `name|description` format.

### B2. ADR-0069 Status Update 2026-04-21 claims ONNX chain + registerEnhancedBoosterTools are NOT wired — source shows both ARE wired

The status update block says:
> `grep -r 'registerEnhancedBoosterTools' /Users/henrik/source/forks/` → zero matches.
> `upgradeEmbeddingService()` … imports only `EnhancedEmbeddingService`. No ONNX import, no ONNX path.

But the current fork source at `forks/agentic-flow/agentic-flow/src/mcp/fastmcp/servers/stdio-full.ts:31` imports `registerBoosterTools as registerEnhancedBoosterTools`, and line 882 invokes it. And `forks/agentic-flow/agentic-flow/src/services/agentdb-service.ts:568-605` has the full Tier-1 ONNX path.

Three possibilities: (a) ADR was drafted against a pre-swarm snapshot and the swarm completed the work without updating the ADR; (b) the audit text was copy-pasted from an earlier review; (c) the wiring is being reverted elsewhere and this reviewer saw a half-landed state. Any of these is a coordination failure.

**Fix**: rewrite the Status Update block to say F3 §2 and F3 §3 are Implemented (import + invocation verified at line numbers above), promote F3 to **Implemented**, and move the three "Remaining work" items into a Closed section. Keep the "remaining work (3)" acceptance check (#3) — it is still a good regression guard even after the work lands.

### B3. Forks are on `main`, not dedicated build branches

Both `forks/ruflo` and `forks/agentic-flow` are HEAD-on `main`. Per the `feedback-fork-commits.md` memory rule, commits to forks must land on the `build` branch and push to `sparkling`, not `main`/`origin` (ruvnet upstream is read-only). No commits exist yet (uncommitted work only), so this is a latent footgun rather than a landed regression. **Fix**: before any swarm agent calls `git commit` in a fork, it must check out the fork's build branch (`fix/all-patches-clean` exists on both forks) or create a dedicated ADR-0069 branch, and push to `sparkling`.

---

## ADVISORIES (non-blocking)

### A1. `NightlyLearner.ts` schema change is a CREATE TABLE IF NOT EXISTS

`packages/agentdb/src/controllers/NightlyLearner.ts` replaces the old `causal_experiments`/`causal_observations` column lists (ts, intervention_id, control_outcome, treatment_outcome, uplift, sample_size, metadata) with a much wider new schema (name, hypothesis, treatment_id, treatment_type, control_id, start_time, end_time, sample_size, status, uplift, confidence, metadata). The wrapper is `CREATE TABLE IF NOT EXISTS`, so existing installations with the old schema will NOT migrate — subsequent `INSERT`s using the new column names will fail. Pattern matches the old lessons in CLAUDE.md about schema migration diligence; needs a migration step or a `DROP TABLE` + recreate on version bump. **This change is also out of ADR-0069 scope** — looks like a P13 migration bleed-through; clarify owning ADR before commit.

### A2. `resolvePort` type-narrowing: daemon-cli passes array, others pass string

`config/ports.ts::resolvePort(name, envNames, explicit)` takes `envNames: string | string[]`. `http-sse.ts` passes `['MCP_SSE_PORT','HEALTH_PORT']` (array), `daemon-cli.ts` passes `['MCP_PORT']` (1-element array), `claude-code-wrapper.ts` + `anthropic-to-onnx.ts` pass scalars. Works, but the inconsistency is a readability smell — consider normalizing all call sites to arrays for grep-ability. Non-blocking.

### A3. ONNX dynamic import path is relative (`../../../packages/agentdb-onnx/...`)

`agentdb-service.ts:572` uses `await import('../../../packages/agentdb-onnx/src/services/ONNXEmbeddingService.js')`. This matches the established pattern at line 10 (`EnhancedEmbeddingService` via `../../../packages/agentdb/...`), so the codemod/build chain must already handle it. Worth adding a publish-layer acceptance check that the relative path still resolves inside the published tarball (check B1's acceptance lib already does surface-level grep but not resolve).

### A4. `readEwcLambdaFromConfig` helper duplicated at 4+ sites

The same `function readEwcLambdaFromConfig(fallback)` body appears in `intelligence-tools.ts` and `SonaLearningBackend.ts` as part of this swarm's work, and per the ADR-0069:380 note also in `RuVectorIntelligence.ts`, `sona-agentdb-integration.ts`, `learning-bridge.ts`. DRY is being violated — acceptable during a landing rush, but a natural ADR-0069-followup cleanup: hoist to a shared util in `packages/agentdb/src/config/embedding-config.ts` (where `getEmbeddingConfig` already lives).

---

## Positive findings

- **No silent `catch {}`** in any swarm-touched fork source. The three new `try { … } catch { … }` blocks in `agentdb-service.ts` (ONNX tier) log `${kind}: ${msg}` and push to a `tierFailures` trail that is dumped to stderr if basic is reached — ADR-0082 compliant.
- **No weakened test asserts**. `tests/unit/agentdb-service-f1-improvements.test.mjs` renames Group 2 to "(shape)" and adds a Group 2b "reality pin" — this is a *strengthening*, not a weakening.
- **F1 AC #3 reconciliation cites ADR-0089 by number** — verified in the ADR-0069 status update block (line referencing "ADR-0089's intercept pattern — a `getOrCreate()` controller pool wired through 16 call sites"). Satisfies task step 6.
- **No hardcoded `@claude-flow/*` scopes** in new fork source code that shouldn't be there (codemod will handle the ones that are).
- **Linter state** (`node scripts/lint-acceptance-checks.mjs`): 1 pre-existing error in `lib/acceptance-file-output-checks.sh:371` (`check_adr0094_p7_config_json`). This file was NOT touched by the ADR-0069 swarm, so not a regression. All L2 annotation comments added in this pass appear correctly placed.
- **Timeout hardening** across ~25 acceptance check files: explicit `"" 30` / `"" 60` args to `_run_and_kill*` consistent with the `reference-run-and-kill-exit-code.md` memory lesson.

---

## Recommendation

1. Fix **B1** (add 2 missing `collect_parallel` entries) — 5 lines, mechanical.
2. Fix **B2** (rewrite ADR-0069 status block to match source reality) — 1 ADR edit.
3. Note **B3** in swarm wrap-up — actual branch switch needed only at commit time; set expectation now.
4. Address **A1** (schema migration) before any fork publish — either add explicit migration, or defer the schema change to a separate ADR-P13-follow-up commit so ADR-0069 lands cleanly.
5. Land **A2/A3/A4** as post-ADR-0069 hygiene items. Not blockers.

No other agent's work was modified by this review. This document is advisory.
