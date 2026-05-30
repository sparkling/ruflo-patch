---
status: accepted
date: 2026-05-24
tags: [agentdb, rvf, hnsw, archivist]
supersedes: []
depends-on: [ADR-0073, ADR-0080, ADR-0201, ADR-0227, ADR-0233]
implements: []
---

# AgentDB internals correctness (CT-M — 3 CRITICAL data-integrity)

## Context and Problem Statement

[[ADR-0233]] consolidated 165 findings from the 2026-05-24 second-pass audit into 10 cross-cutting themes (CT-A through CT-J) plus 5 new CTs (CT-K through CT-O) identified by the post-ADR-0233 coverage-matrix walk at `/tmp/coverage-matrix.md`. **CT-M is the most consequential of the new CTs**: the slice-03 audit (`docs/audits/2026-05-24-second-pass-audit/03-agentdb-internals.md`) returned 9 findings — **3 CRITICAL, 4 WARNING, 2 NOTE** — that the ADR-0233 headline list omitted and that no existing CT-A..J ADR covers. [[ADR-0239]] (CT-F) handles dead-code in this area only; the live-code correctness gaps are the CT-M scope.

The three CRITICALs are independent silent-correctness drifts in the canonical agentdb fork (`forks/agentdb`, ADR-0161 consolidated):

1. **F-03-001 — RvfBackend metric not re-probed on reopen.** `RvfBackend.distanceToSimilarity` (`forks/agentdb/src/backends/rvf/RvfBackend.ts:739-746`) uses the constructor-supplied `this.metricType` (defaulting to `cosine` at line 129), never re-probes the persisted store's metric on `initialize()` (:161), `load()` (:276), or `openReadonly()` (:612). `SqlJsRvfBackend.load()` is worse: it calls `createSchema()` which `INSERT OR REPLACE`s the `rvf_meta` table on every load (lines 339-342), destroying the validation surface by design. This is the **same shape** as the `2cos − 1` trap [[ADR-0073]] amended on 2026-05-22 — in a different code path (RVF reopen vs `@claude-flow/memory`'s `rvf-backend.ts`). ADR-0073's amendment explicitly names this site as a follow-up: *"`agentdb/src/backends/rvf/RvfBackend.ts` `distanceToSimilarity()` carries the same `case 'cosine': return 1 - distance` pattern; it is not on the `memory_search` path … but should get the same treatment if any agentdb-native search consumer thresholds on absolute cosine."* This ADR is that treatment.

2. **F-03-002 — Archivist invariants evaluated AFTER substrate write commits, no rollback.** `forks/agentdb/src/archivist/index.ts:986-1013` runs the handler (which calls `ctx.substrate.withWrite` and commits) FIRST, then evaluates invariants, then writes `state: 'rejected'` if an invariant violates. The substrate is NOT rolled back. Charter `forks/agentdb/src/archivist/MODULE.md:45` says: *"Evaluated at write-time **BEFORE** the audit entry transitions to `applied`; violation **aborts the write** and records `state: 'rejected', reason: 'invariant_violation'`."* The "BEFORE" + "aborts" wording is unsatisfied. `substrateStateBefore` / `substrateStateAfter` invariant args are hardcoded to `undefined` (:997-998). Concrete repro: [[ADR-0231]] wave A9's `microlora-adapt` invariant `inputIsNotAllZero` (the "Q-3 root-cause guard" against the pre-fork zero-input no-op bug) — an all-zero input dispatched through `archivist.dispatch('ruvllm_microlora_adapt', payload)` writes the zero entry to the FS-JSON store via `handle.write(...)` (handler :73-82), THEN the invariant fires, THEN audit writes `rejected`, THEN throw propagates. Next `handle.read()` will see the zero entry. Audit replay would diverge from substrate state.

3. **F-03-003 — `backends/factory.ts::createHNSWLibBackend` does not call `deriveHNSWParams`.** `forks/agentdb/src/backends/factory.ts:155-160` passes `VectorConfig` straight to `HNSWLibBackend`; the backend constructor (`forks/agentdb/src/backends/hnswlib/HNSWLibBackend.ts:87-94`) applies static defaults `{maxElements: 100000, M: 16, efConstruction: 200, efSearch: 100}` when the caller omits them. The canonical contract per memory `[[reference-embedding-model]]` (mpnet-768, M:23, efC:100, efS:50) is held by `@claude-flow/memory`'s `resolve-config.ts:328` callers who route through `deriveHNSWParams` (defined at `forks/agentdb/src/core/config-chain.ts:38-46`). A direct consumer of `agentdb/dist/src/backends/factory.js` (a plugin author, benchmark, or future controller) bypasses derivation and gets `M:16/efC:200/efS:100` silently. `RvfBackend.indexStats()` fabricated default (F-03-005) is the same wrong-default-on-error shape at a different line.

This ADR also handles the 4 WARNING and 2 NOTE siblings clustered in slice 03 (F-03-004 through F-03-009). Single CT-bundle preferred over per-finding ADRs per ADR-0233 Decision (avoid pre-flight check 4 trap; carve along bug-class seams).

## Pre-flight verification

Per [[ADR-0201]] §"Remediation-ADR pre-flight checklist (added 2026-05-20)" and memory `[[feedback-remediation-adr-preflight]]`. All four checks executed against live source 2026-05-24 before drafting Decision.

### 1. Signal reaches its audience

* **F-03-001**: `distanceToSimilarity` is called from `RvfBackend.searchAsync` (:379) and consumed by every agentdb-native `searchAsync` caller — `SelfLearningRvfBackend.search()`, `agentdb_filtered_search` MCP handler, `agentdb_pattern-search` MCP handler, archivist read-path `embeddingScorer` capability (per F-03-007 cross-exposure). The ADR-0073 amendment closed the `@claude-flow/memory` `memory_search` path; **this surface is not on that path** and IS a real audience. Long-lived processes (MCP server, daemon) reopen stores → drop metric → score `2cos − 1`. Same threshold-gate failure mode as [[project-memory-search-rvf-snapshot-isolation]].
* **F-03-002**: Audit replay (per `replay-verification` charter responsibility in `MODULE.md:48`) re-reads the audit log against a fresh substrate and asserts addressable-key set-equality. A `rejected` entry whose substrate write succeeded violates this contract — replay would diverge from live state. Real audience: the replay verifier (currently tooling, not gating, per ADR-0180 §Confirmation).
* **F-03-003**: Audience confirmed by walking direct importers — `forks/agentdb/src/benchmark/BenchmarkSuite.ts:446` is one; any plugin importing `createBackend` from `agentdb/dist/src/backends/factory.js` is another. The `@claude-flow/memory` path (the dominant audience today) goes through `resolve-config.ts` and is unaffected. Plugin-author audience is small but real; benchmark distortion is observable.

### 2. Upstream hasn't already decided

* **F-03-001**: `ruvnet/agentdb/src/backends/rvf/RvfBackend.ts:125, 735, 737-740` is byte-identical with our fork — same `metricType = config.metric ?? 'cosine'`, same `distanceToSimilarity` cases, same `1 - distance` default. The agentic-flow canonical (`ruvnet/agentic-flow/agentic-flow/src/optimizations/ruvector-backend.ts:22, 86`) takes a different shape (no `distance → similarity` conversion — scores cosine directly), confirming the ADR-0073 amendment's pattern. **Fix is fork-only → merge tax.** Per `[[feedback-update-integration-ledger]]`, every cherry-pick / hand-port gets an `INTEGRATION-LEDGER.md` row.
* **F-03-002**: `ruvnet/agentdb` has **NO `archivist/` directory at all**. `ls /Users/henrik/source/ruvnet/agentdb/src/` confirms: `backends/ controllers/ core/ mcp/ middleware/ model/ observability/ optimizations/ ...` — no `archivist/`. The archivist is **fork-only code** introduced by ADR-0180. There is **zero upstream merge tax** for either decision shape (fix the runtime to match the charter, OR amend the charter to match the runtime). Most surprising pre-flight finding — see note at end.
* **F-03-003**: `ruvnet/agentdb/src/backends/factory.ts:156` and `HNSWLibBackend.ts:88-91` are byte-identical with our fork (same `createHNSWLibBackend(config: VectorConfig)` straight pass-through; same `{maxElements: 100000, M: 16, efConstruction: 200, efSearch: 100}` static defaults). `deriveHNSWParams` lives in `forks/agentdb/src/core/config-chain.ts` and is **fork-only** (upstream `ruvnet/agentdb/src/core/` has no `config-chain.ts`). Fix is fork-only → merge tax for the factory edit only; the helper is already fork-only.

### 3. Premise true at runtime

All three CRITICAL cites verified at exact line numbers by reading the live source 2026-05-24:

* F-03-001: `RvfBackend.ts:129` (`metricType = config.metric ?? 'cosine'`), `:161` (`RvfDatabase.open(storagePath, rvfBackendType)` — no metric handshake), `:276` (`load` — same), `:541-549` (`metric()` method EXISTS but is never used to seed `metricType` on reopen), `:739-746` (`distanceToSimilarity` consumes the stale value). `SqlJsRvfBackend.ts:200` calls `createSchema()` which `:339-342` does `INSERT OR REPLACE INTO rvf_meta` — destroys read-back surface. CONFIRMED.
* F-03-002: `archivist/index.ts:987` (`await handler(ctx, payload)` — substrate commits here), `:993-1001` (invariants evaluated AFTER, with `substrateStateBefore/After: undefined`), `:1006-1010` (throw AFTER write, no rollback). `MODULE.md:45` (charter says "BEFORE applied"). `registration.ts:24-29` (`Invariant<T>` declares 4 args; dispatch passes 2 as undefined). CONFIRMED.
* F-03-003: `backends/factory.ts:155-160` (no `deriveHNSWParams` call), `HNSWLibBackend.ts:87-94` (`M: 16, efConstruction: 200, efSearch: 100` literal). `core/config-chain.ts:38-46` (`deriveHNSWParams(768)` returns `{M:23, efConstruction:100, efSearch:50}` — canonical). CONFIRMED.

### 4. No sibling-ADR overlap

* [[ADR-0073]] amendment 2026-05-22 covers `@claude-flow/memory/src/rvf-backend.ts` (the `memory_search` consumer) and explicitly names `agentdb/src/backends/rvf/RvfBackend.ts distanceToSimilarity()` as the next site. **CT-M extends that named follow-up to the agentdb surface.** No overlap — strict extension along the same defect class.
* [[ADR-0080]] (storage consolidation verdict) governs which backend the `auto` path selects, NOT the score-conversion correctness inside a chosen backend. No overlap.
* [[ADR-0227]] (adaptive similarity threshold for mpnet) tuned the floor from 0.3 → 0.15; assumed the score being thresholded is **correct cosine**. F-03-001 is the silent-corruption-of-the-score itself — orthogonal to threshold tuning, but the threshold cannot be recalibrated meaningfully while the underlying score may be `2cos − 1` instead of `cos`.
* [[ADR-0233]] CT-F ([[ADR-0239]]) handles dead-code cluster 4 (`agentdb/src/wrappers/`, `compatibility/`, `search/`, `observability/`). The CT-M sites are live code; no overlap.
* [[ADR-0234]] (CT-A) extends the [[ADR-0095]] fallback-removal amendment to `vector-db.ts`, `diskann-backend.ts`, `embedding-pipeline.ts`, `claims.ts`, `plugins.ts`. F-03-005 / F-03-006 / F-03-007 are also `feedback-no-fallbacks` violations in agentdb — CT-A explicitly scoped to ruflo and embedding-pipeline sites, not agentdb backends. No overlap; CT-M extends the rule to agentdb.

## Considered Options

* **A. Per-finding fix + amend `archivist/MODULE.md` charter to match implementation OR implement transactional substrate writes** for F-03-002. Per-site fix for the rest.
* **B. Split into two ADRs**: AgentDB substrate-correctness (F-03-001/002 + ADR-0073 alignment) vs HNSW-derivation enforcement (F-03-003/005). Two PRs, narrower review surface.
* **C. Behaviour-test-first**: write tests that capture the `2cos − 1` offset and the invariant-after-commit bug, then fix to pass (matches `[[feedback-trace-before-hypothesis]]`). Per-finding fix shape inherits from A.

## Decision Outcome

Chosen option: "C + A hybrid", because behaviour-test-first on the three CRITICALs plus a per-finding fix table for the rest keeps the shared defect family in one ADR without the sibling-overlap risk of splitting.

**Chosen: C + A hybrid.** Behaviour-test-first for the 3 CRITICAL (one source-shape guard + one runtime test per CRITICAL, written and red before fixing); then per-finding fix table for the rest. Single ADR — not split — per [[ADR-0233]] Decision ("theme-batched remediation ADRs … carve along bug-class seams") and pre-flight check 4 ("no sibling-ADR overlap"); splitting into 0246a/0246b would re-create the overlap risk the theme batching is meant to eliminate.

Rationale for rejecting B: the three CRITICALs share a common defect family — *the persistence/charter layer makes a claim the runtime doesn't enforce*. F-03-001 (persisted metric not read back); F-03-002 (charter "BEFORE" not honoured); F-03-003 (`deriveHNSWParams` contract not enforced at the factory). Splitting fragments the diagnosis across two ADRs.

Rationale for picking C over pure A: per `[[feedback-trace-before-hypothesis]]`, multi-check correctness regressions get a read-only trace agent FIRST, not a fix hypothesis. The audit already did the trace. The next discipline-preserving step is to write the test that captures the observed bug, watch it fail, then fix to pass. This matches the ADR-0073 amendment workflow (which wrote `tests/unit/adr0073-rvf-cosine-direct-scoring.test.mjs` as a source-shape guard).

### Per-finding disposition

| Finding | Sev | Decision | Test-first artifact |
|---|---|---|---|
| F-03-001 | CRITICAL | **Probe-and-reseat by default** (post-swarm-review refinement). In `initialize()` / `load()` / `openReadonly()`, after `RvfDatabase.open`, call `this.metricType = (await this.db.metric()) as 'cosine' \| 'l2' \| 'ip'`. **Fail-loud only when the caller explicitly passed `config.metric` (non-default) AND the persisted store metric disagrees** — re-converges with ADR-0073 amendment's "score cosine directly" intent rather than crashing default-cosine callers. For `SqlJsRvfBackend.load()`: read back `(SELECT value FROM rvf_meta WHERE key='metric')`, same probe-and-reseat default + fail-loud only on explicit-caller mismatch, do NOT re-call `createSchema()` (it's `INSERT OR REPLACE` and clobbers verification). | Source-shape guard test asserting `metric()` is read after every `open*` call; runtime test exercises real round-trip via temp path (create `metric:l2` store → close → reopen with default `cosine` config → store+search → assert `r.score` matches independent `cosineSimilarity` within ε=1e-6, NOT `2cos−1`). Mock-substrate tests rejected per swarm review (Expert 4). |
| F-03-002 | CRITICAL | **Path (a) mandatory for FS-JSON substrate** (post-swarm-review refinement). For FS-JSON substrate: snapshot the file BEFORE the handler call, run invariants with real `substrateStateBefore/After` args, run handler+rewrite only if invariants pass; on violation, no rewrite ever happens (the existing tmp+fsync+rename machinery at `substrates/fs-json-store.ts::saveJsonAtomic` is the atomic-commit primitive). **RVF substrate enforcement is named follow-up** (requires wiring `freeze()` + rollback into archivist dispatch path; `freeze()` exists at `RvfBackend.ts:594` but `grep "freeze" forks/agentdb/src/archivist/` returns zero hits today). Per `[[feedback-best-effort-must-rethrow-fatals]]`, the RVF-substrate gap is **honest dead-zone, not silent drift**: this ADR adds a footnote to `MODULE.md:45` clarifying "mutation-invariants enforced today for FS-JSON-backed substrates only; RVF-substrate enforcement pending `freeze()`+rollback wiring (named follow-up)". The charter sentence is **NOT weakened** (DA Challenge 1 adopted). Plumb real `substrateStateBefore` / `substrateStateAfter` for FS-JSON; remain `undefined` for RVF until follow-up lands; F-03-008 closes for FS-JSON only. | Runtime test using `archivist.dispatch('ruvllm_microlora_adapt', {input: <zeros>})` against a **real FS-JSON substrate at temp path** (per Expert 4 — no in-memory mock), asserting: (i) throw propagates, (ii) `handle.read()` afterward returns NO zero entry. Pre-fix: (ii) FAILS. Pair with a separate test asserting RVF-substrate dispatch still records `rejected` without rollback (documenting the named gap). |
| F-03-003 | CRITICAL | In `factory.ts::createHNSWLibBackend` AND `factory.ts::createRvfBackend` (RvfBackend reads `config.M`/`config.efConstruction` at `:167-168` — same divergence vector), merge `deriveHNSWParams(config.dimension)` into config when caller omits M/efC/efS. Static defaults in `HNSWLibBackend.ts:87-94` become unreachable from the factory path. Direct constructor callers (test fixtures, plugin authors) still hit the static defaults — accept this as a documented seam, since the factory is the public surface. **Fix and tests land in single commit** (post-swarm-review: mechanical change, no diagnostic value in separate red-test commit per Expert 3 / DA Challenge 2 partial). | Source-shape guard test asserting `factory.ts::createHNSWLibBackend` calls `deriveHNSWParams` before instantiation; runtime test calling `createBackend('hnswlib', {dimension: 768})` and asserting backend reports `M:23, efConstruction:100, efSearch:50`. |
| F-03-004 | WARNING | Convert `enqueue` to `async` and `await this.drainOne()` at capacity; tighten the JSDoc at `hot-path-writer.ts:5` to match. Audit-writer's lack of a real advisory lock (`audit-writer.ts:125-134`) is a separate, documented TODO — not in scope here. | Source-shape: no `void this.drainOne()` in busy loop. |
| F-03-005 | WARNING | Re-throw the underlying error from `RvfBackend.indexStats()` instead of returning fabricated `{m:16, efConstruction:200, layers:0, needsRebuild:false}` defaults per `[[feedback-no-fallbacks]]`. Same defect class as F-03-003 (wrong static defaults). | Source-shape: no fabricated-default literal in `indexStats()` catch arm. |
| F-03-006 | WARNING | `RvfBackend.remove()` (sync interface): match the pattern at `search()` lines 234-240 — throw `'RVF backend remove is async-only. Use removeAsync() or the VectorBackendAsync interface.'`. Caller-visible behaviour change; bounded blast radius (any sync-remove caller is already broken). | Source-shape: `remove()` throws; no fire-and-forget `.catch(...)`. |
| F-03-007 | WARNING | Cross-reference of May-19 F-04-004 (`EmbeddingService.mockEmbedding` fallback). The fix landed for F-04-004 (per ADR-0234 fall-through framing) covers this site by construction — the archivist `embeddingScorerFactory` reads through the same `EmbeddingService` instance. **No new fix in this ADR**; the closure is dependent on CT-A landing. Re-flag for cross-audit traceability. | None (covered by CT-A landing). |
| F-03-008 | NOTE | Closed by F-03-002 decision: if path (a) plumbs `substrateStateBefore/After` through, the params become live. If path (b), the params are deleted. Either way, this NOTE is resolved by the F-03-002 fix. | None (closed by F-03-002). |
| F-03-009 | NOTE | Confirmed orphan per May-19 F-04-005; `wasm-loader.ts:40` explicit comment. Per `[[project-fork-only-controllers]]`, the 8 fork-only controllers are intentionally retained. `HNSWIndex` is an unused export — recommend `// @internal` JSDoc + removal from `controllers/index.ts:11` `src/index.ts:73` exports (still accessible via deep import for the lone test that imports it). Defer if any sibling controller imports it. | None (documentation-only). |

### Test-first protocol for the 3 CRITICAL (post-swarm-review)

Per `[[feedback-trace-before-hypothesis]]` and the ADR-0073 amendment workflow:

1. **F-03-001 and F-03-002**: write tests RED first (source-shape + runtime for F-03-001; runtime for F-03-002). Land as one commit, all RED. Naming convention: `tests/unit/adr0246-<finding>-<defect>.test.mjs`. **F-03-003 fix+test fold into a single commit** (post-swarm-review per Expert 3 — mechanical change). Tests must use real substrates (FS-JSON for F-03-002; temp-path RVF round-trip for F-03-001); in-memory mocks rejected per Expert 4.
2. Implement the F-03-001 / F-03-002 fixes finding-by-finding. Each fix commit must turn its named test GREEN without touching other tests.
3. Per `[[feedback-commit-forks-before-release.md]]`: every fork edit gets committed before `npm run release`. The release rebuilds forks from committed state; uncommitted fork edits are silently discarded.
4. After all 3 CRITICAL fixes land green: re-run `embeddings_compare` (independent cosine baseline per `[[project-memory-search-rvf-snapshot-isolation]]`) on a reopened `metric:l2` store. Score should now match raw `cosine_similarity(a, b)` to within ε = 1e-6.

### Sequencing

* CRITICALs first (F-03-001, F-03-002, F-03-003) — three test commits, three fix commits.
* WARNINGs second (F-03-004, F-03-005, F-03-006) — simpler shape, one commit each.
* NOTEs last (F-03-008 closes with F-03-002 fix; F-03-009 is documentation).
* No deferrals other than F-03-002 path (b) fallback if path (a) overruns one ADR cycle.

### Consequences

* Good, because **Three silent-correctness vectors closed.** RVF metric mismatch on reopen, archivist invariants-after-commit, factory HNSW divergence.
* Good, because **Charter ↔ runtime re-aligned.** F-03-002 path (a) makes `MODULE.md:45` true at runtime, not aspirational. Closes the `feedback-best-effort-must-rethrow-fatals` shape ADR-0233 §03 calls out under "Charter / code drift".
* Good, because **F-03-001 closure unblocks meaningful F-03-005 fix.** Both are "wrong static defaults" — fixing the metric reprobe pattern naturally extends to `indexStats()`.
* Good, because **ADR-0073's named follow-up discharged.** "Should get the same treatment if any agentdb-native search consumer thresholds on absolute cosine" — done.
* Good, because **Plugin-author seam is honest.** F-03-003 fix makes `createBackend('hnswlib', {dimension: 768})` deterministically produce canonical 23/100/50.
* Bad, because **F-03-002 path (a) requires real transactional substrate semantics.** FS-JSON `.tmp`-then-rename is straightforward; RVF `freeze()` + rollback is non-trivial and currently `freeze()` is called nowhere in the dispatch path. If this is judged too large for one ADR cycle, path (b) (amend charter to honest "post-write checks") is the honest fallback — but it weakens the audit-replay guarantee.
* Bad, because **Three byte-identical-with-upstream files diverge.** `RvfBackend.ts`, `factory.ts`, `HNSWLibBackend.ts` all currently match `ruvnet/agentdb` exactly. Three new `INTEGRATION-LEDGER.md` rows; divergence-marker comments at each edit site naming this ADR. Per `[[feedback-update-integration-ledger]]`, this is the cost of fork-only fixes.
* Bad, because **F-03-006 throws on sync `remove()` callers** — caller-visible behaviour change. Any sync-remove caller is already broken (fire-and-forget returns `true` unconditionally), so the throw replaces a silent lie with a loud failure — but it WILL break callers that didn't notice the lie.
* Bad, because **F-03-003 fix is at the factory layer only.** Direct `new HNSWLibBackend(config)` constructor callers still hit the static defaults. Accepted as a documented seam (factory is the public surface); fully closing this would require deleting the static defaults from the constructor, breaking the standalone-test-fixture seam.
* Neutral, because **F-03-007 carries closure dependency on CT-A.** Cross-CT dependency, but the dependency direction is clear (CT-A lands first, CT-M re-flags satisfied).
* Neutral, because **No upstream donate-back per `[[feedback-no-upstream-donate-backs]]`** — fork-only fixes stay fork-only. The merge tax is accepted.

## Sites

| # | File | Line range | Defect class | Finding | Fix shape |
|---|------|-----------|--------------|---------|-----------|
| 1 | `forks/agentdb/src/backends/rvf/RvfBackend.ts` | 128-129, 161, 276, 612, 739-746 | metric-not-persisted-on-reopen | F-03-001 | Probe `db.metric()` on every `open*`; fail-loud on caller-vs-store mismatch |
| 2 | `forks/agentdb/src/backends/rvf/SqlJsRvfBackend.ts` | 200, 339-342 | metric-not-persisted-on-reopen + INSERT OR REPLACE destroys validation surface | F-03-001 (sibling) | `load()` reads back `rvf_meta`, does NOT re-call `createSchema()`; fail-loud on mismatch |
| 3 | `forks/agentdb/src/archivist/index.ts` | 986-1013 | invariants-after-commit, no rollback | F-03-002 | Path (a): re-order, snapshot, plumb `before/after`, rollback on violation. Path (b): amend charter |
| 4 | `forks/agentdb/src/archivist/MODULE.md` | 45 | charter ↔ runtime drift | F-03-002 | Match the runtime (path b) OR no change (path a) |
| 5 | `forks/agentdb/src/archivist/registration.ts` | 24-29 | `Invariant<T>` dead params | F-03-008 | Closes with F-03-002 fix (path a plumbs them; path b removes them) |
| 6 | `forks/agentdb/src/backends/factory.ts` | 155-160, 167-170 | HNSW params not derived | F-03-003 | Merge `deriveHNSWParams(config.dimension)` into config in BOTH `createHNSWLibBackend` and `createRvfBackend` |
| 7 | `forks/agentdb/src/backends/hnswlib/HNSWLibBackend.ts` | 87-94 | static defaults divergent | F-03-003 (downstream) | Unreachable from factory after fix; static defaults retained as constructor seam |
| 8 | `forks/agentdb/src/archivist/hot-path-writer.ts` | 5, 21-33 | busy-spin instead of awaiting drain | F-03-004 | `async enqueue` + `await drainOne()`; fix JSDoc |
| 9 | `forks/agentdb/src/backends/rvf/RvfBackend.ts` | 552-572 | `indexStats()` fabricated default | F-03-005 | Re-throw underlying error |
| 10 | `forks/agentdb/src/backends/rvf/RvfBackend.ts` | 242-251 | sync `remove()` fire-and-forget lies | F-03-006 | Throw `'async-only'` matching `search()` pattern |
| 11 | `forks/agentdb/src/controllers/EmbeddingService.ts` | 87-102 | mockEmbedding fallback (cross-exposure) | F-03-007 | Closed by CT-A ([[ADR-0234]]) landing |
| 12 | `forks/agentdb/src/controllers/HNSWIndex.ts` | exports in `controllers/index.ts:11`, `src/index.ts:73` | unused controller export | F-03-009 | `// @internal` JSDoc + remove from public exports |
| 13 | `docs/upstream/INTEGRATION-LEDGER.md` | new rows | fork-only fix tracking | F-03-001, F-03-003 | Add **3 explicit rows** (post-swarm-review per Expert 5) naming this ADR + the three byte-identical files: `forks/agentdb/src/backends/rvf/RvfBackend.ts`, `forks/agentdb/src/backends/rvf/SqlJsRvfBackend.ts`, `forks/agentdb/src/backends/factory.ts`. `HNSWLibBackend.ts` retains static defaults (constructor seam intentionally preserved) so no divergence-marker comment required there. |
| 14 | `forks/agentdb/src/archivist/MODULE.md` | 45 (footnote) | charter ↔ runtime drift (refined) | F-03-002 | Append footnote clarifying current RVF-substrate enforcement gap; charter sentence preserved verbatim. Post-swarm-review per DA Challenge 1 partial adoption. |

## More information

* [[ADR-0073]] — RVF storage upgrade + 2026-05-22 amendment that flagged `agentdb/src/backends/rvf/RvfBackend.ts distanceToSimilarity()` as the named follow-up CT-M is now discharging.
* [[ADR-0080]] — storage consolidation verdict; orthogonal to scoring correctness.
* [[ADR-0201]] — codebase soundness audit + Remediation-ADR pre-flight checklist applied above.
* [[ADR-0227]] — adaptive similarity threshold for mpnet; assumes score is correct cosine.
* [[ADR-0233]] — second-pass audit consolidation + cross-cutting themes. CT-M is the most consequential of the new CTs identified by the post-ADR-0233 coverage matrix.
* [[ADR-0239]] — CT-F dead-code triage; handles `agentdb/src/wrappers/`, `compatibility/`, `search/`, `observability/` — disjoint from CT-M's live-code scope.
* [[ADR-0234]] — CT-A silent-fallback fixes; closes F-03-007 (EmbeddingService cross-exposure) by construction when it lands.
* `docs/audits/2026-05-24-second-pass-audit/03-agentdb-internals.md` — slice-03 audit, all 9 findings with full file:line evidence.
* `forks/agentdb/src/archivist/MODULE.md:45` — charter that F-03-002 violates.
* `forks/agentdb/src/core/config-chain.ts:38-46` — `deriveHNSWParams` definition (fork-only helper).
* Memory `[[project-memory-search-rvf-snapshot-isolation]]` — the `2cos − 1` precedent; CT-M's F-03-001 is the agentdb-side sibling.
* Memory `[[reference-embedding-model]]` — canonical mpnet-768 → M:23, efC:100, efS:50.
* Memory `[[reference-ruvnet-upstream-repos]]` — agentdb provenance (thin 7-commit spin-off from agentic-flow).
* Memory `[[project-fork-only-controllers]]` — catalog of 8 fork-only files including the archivist surface.
* Memory `[[feedback-trace-before-hypothesis]]` — rationale for test-first ordering.
* Memory `[[feedback-no-fallbacks]]` — corpus rule that F-03-005 and F-03-006 violate.
* Memory `[[feedback-update-integration-ledger]]` — required INTEGRATION-LEDGER.md entries for every fork-only divergence.
* Memory `[[feedback-commit-forks-before-release]]` — fix landing order discipline.
* Memory `[[feedback-best-effort-must-rethrow-fatals]]` — informs the charter ↔ runtime alignment principle.

## Swarm review (2026-05-24)

**Pattern**: P1 Council Hive (Dialectic) — roleplay execution per `docs/plans/2026-05-24-second-pass-remediation-plan.md` §"Per-ADR swarm configuration".
**Consensus**: Byzantine (N=6; f=⌊(N-1)/3⌋=1; required votes 2f+1=3, supermajority).
**Topology**: hierarchical-mesh. **Queen type**: strategic. **Transport**: queen-composed (one-round dialectic; no peer revision needed). **Devil's advocate**: included.

### Expert panel

| # | Role | One-line stance |
|---|------|-----------------|
| 1 | RVF persistence specialist (ADR-0073 lineage) | F-03-001 is named extension of ADR-0073 amendment's own follow-up pointer; probe-and-reseat is safer default than probe-and-fail-loud |
| 2 | Archivist invariant-timing specialist (ADR-0180 charter) | Charter sentence is load-bearing; path (a) is materially asymmetric between FS-JSON (feasible today) and RVF (needs `freeze()` wiring) |
| 3 | HNSW-parameter derivation specialist | Fix is structurally simple; both `createHNSWLibBackend` AND `createRvfBackend` need `deriveHNSWParams` call |
| 4 | Behavior-test-first advocate (`feedback-trace-before-hypothesis`) | Hybrid C+A is correct shape; tests must use real substrate not in-memory mocks |
| 5 | Upstream-fork divergence specialist | F-03-002 is fork-only (zero merge tax); F-03-001/003 byte-identical with upstream (merge tax confirmed) |
| DA | Devil's Advocate | Challenge 1: don't amend charter to match buggy runtime. Challenge 2: test-first is theatre when audit already cited file:line |

### Upstream intent summary

The most consequential pre-flight finding survived re-derivation against live upstream source. Verified 2026-05-24:

* **F-03-001**: `ruvnet/agentdb/src/backends/rvf/RvfBackend.ts:735-740` is **byte-identical** with `forks/agentdb/src/backends/rvf/RvfBackend.ts:739-746` — same `metricType = config.metric ?? 'cosine'` (upstream `:125`, fork `:129`), same `distanceToSimilarity` switch with `case 'cosine': return 1 - distance`, same `default: return 1 - distance`. The agentic-flow canonical (`ruvnet/agentic-flow/agentic-flow/src/optimizations/ruvector-backend.ts:322`) scores `cosineSimilarity(a, b)` directly, confirming the ADR-0073 amendment's "re-converge with upstream pattern" reading. Fork-only fix → INTEGRATION-LEDGER row required.
* **F-03-002**: `ls /Users/henrik/source/ruvnet/agentdb/src/archivist` → `No such file or directory`. The archivist module is **entirely fork-only code** (introduced by ADR-0180). Zero upstream merge tax for either decision shape. This is the most consequential pre-flight finding because it removes the "merge cost" argument against path (a).
* **F-03-003**: `ruvnet/agentdb/src/backends/factory.ts:156-158` is **byte-identical** with `forks/agentdb/src/backends/factory.ts:157-159` (only line numbers differ by one due to a fork-only `getConfig` import at line 32). `HNSWLibBackend.ts` shows zero `diff` output between fork and upstream. `deriveHNSWParams` lives in `forks/agentdb/src/core/config-chain.ts` and is fork-only (upstream has no `config-chain.ts`). Fork-only factory edit → INTEGRATION-LEDGER row required.

Additional substrate finding (decisive for F-03-002 path choice): `forks/agentdb/src/archivist/substrates/rvf-store.ts:8` carries the explicit comment `"the JS layer must NOT add a tmp+rename dance or its [equivalent]"` — the Rust crate owns atomicity. `freeze()` is exposed at `RvfBackend.ts:594` but `grep "freeze" forks/agentdb/src/archivist/` returns zero hits — the dispatch path does not call it. FS-JSON substrate (`substrates/fs-json-store.ts`) by contrast has full tmp+fsync+rename machinery in `saveJsonAtomic` and `withFileLock`. Path (a) is materially feasible for FS-JSON today and materially harder for RVF-substrate today.

### ADR-180+ alignment summary

* **ADR-0073** (2026-05-22 amendment): explicitly names `agentdb/src/backends/rvf/RvfBackend.ts distanceToSimilarity()` as the follow-up site. CT-M's F-03-001 is the named discharge. No conflict — strict extension.
* **ADR-0080** (storage consolidation): governs backend selection, not score-conversion correctness inside a chosen backend. Orthogonal.
* **ADR-0180** (thin memory coordinator): charter at MODULE.md:45 is unambiguous on BEFORE/aborts. F-03-002 is a runtime drift from this charter. The path-(a)-vs-path-(b) decision is, in effect, "fix the runtime to match the spec" vs "weaken the spec to match the runtime". Original ADR defaulted to (a) with (b) fallback; supermajority adopts a refinement (below).
* **ADR-0227** (adaptive threshold 0.3→0.15): tuned the floor assuming the score being thresholded is **correct cosine**. F-03-001 is silent corruption of the score itself — downstream of ADR-0227's tuning but logically upstream of its correctness premise. Closure of F-03-001 reinforces ADR-0227's recalibration.
* **ADR-0231** wave A9: `inputIsNotAllZero` invariant for `microlora-adapt` is the concrete repro for F-03-002 path-(a) test. The ADR's chosen test target aligns with the existing invariant infrastructure.

### Critique outcomes table

| Expert | Critique | Vote | Adopted |
|--------|----------|------|---------|
| 1 | F-03-001 fix should be probe-and-reseat by default; fail-loud ONLY when caller passed an explicit non-default metric (re-converge with ADR-0073 amendment intent) | amend | YES — supermajority 4/6 |
| 2 | F-03-002 path (a) is asymmetric: feasible for FS-JSON today; needs `freeze()` wiring for RVF. ADR's "default (a) with (b) fallback" understates the split | amend | YES — supermajority 4/6 |
| 3 | F-03-003 fix and test can fold into single commit (mechanical change, no diagnostic value in separate red-test commit) | amend | YES — supermajority 4/6 (Expert 4 partial) |
| 4 | F-03-001 runtime test must exercise real round-trip via temp path (not in-memory mock); F-03-002 test must use real FS-JSON substrate | amend | YES — supermajority 5/6 |
| 5 | INTEGRATION-LEDGER plan in §Sites row 13 should explicitly add `SqlJsRvfBackend.ts` (currently lumped under F-03-001 row 2) | amend | YES — supermajority 6/6 |
| DA | Challenge 1: don't amend MODULE.md to "post-write payload checks" — the charter is load-bearing; if RVF can't do rollback today, gap-mark RVF-substrate handlers without weakening the charter sentence | amend | PARTIALLY — supermajority 4/6 with DA; charter sentence preserved, RVF-substrate enforcement explicitly gap-named |
| DA | Challenge 2: test-first for F-03-001/003 is theatre — audit already cited file:line; just fix-and-test in same commit | reject (F-03-001), partial adopt (F-03-003) | REJECTED for F-03-001 — supermajority 4/6 against. F-03-003 fold accepted per Expert 3 |

### DA final position

**Withdraws Challenge 1**: the adopted refinement (path (a) for FS-JSON mandatory; RVF-substrate enforcement gap-named without charter weakening) satisfies the underlying charter-authority concern.
**Holds principled dissent on Challenge 2** (F-03-001 specifically): still believes the source-shape test + runtime test for F-03-001 are over-ceremony when the audit already provided the file:line diagnosis. Supermajority rejected — the `[[project-memory-search-rvf-snapshot-isolation]]` precedent shows absolute-score offsets are invisible to rank-only checks; the dual test discipline is load-bearing for regression prevention. Dissent recorded; does not block consensus.

### Improvements adopted (applied below)

1. **F-03-001 fix shape refined**: probe `db.metric()` on every `open*` call. Default behaviour is **probe-and-reseat** (`this.metricType = (await this.db.metric()) as ...`). Fail-loud throw ONLY when the caller explicitly passed `config.metric` (non-default) AND the persisted store metric disagrees. SqlJs path: read back `(SELECT value FROM rvf_meta WHERE key='metric')`, same probe-and-reseat default + fail-loud on explicit mismatch. Still do NOT re-call `createSchema()` on load.
2. **F-03-002 fix shape refined**: path (a) mandatory for FS-JSON substrate this ADR cycle. RVF-substrate `mutation-invariants` enforcement is **gap-named** in this ADR (named follow-up requiring `freeze()`+rollback wiring in archivist dispatch path; per `[[feedback-best-effort-must-rethrow-fatals]]` the gap is honest dead-zone, not silent drift). MODULE.md:45 charter sentence is NOT weakened — instead a footnote is added clarifying current RVF-substrate enforcement gap. `substrateStateBefore/After` plumbed for FS-JSON; remain `undefined` for RVF until follow-up lands.
3. **Test discipline tightened**: F-03-001 runtime test exercises real round-trip via temp path (create `metric:l2` store → close → reopen with default config → search → assert correct cosine vs `2cos−1`). F-03-002 test uses real `makeFsJsonSubstrate` at temp path (not in-memory mock).
4. **F-03-003 commit ordering**: fix+test fold into one commit (mechanical change). F-03-001 retains separate red-test commit per `[[feedback-trace-before-hypothesis]]` precedent.
5. **INTEGRATION-LEDGER plan**: §Sites row 13 expanded to name three byte-identical files explicitly — `RvfBackend.ts`, `SqlJsRvfBackend.ts`, `factory.ts`. `HNSWLibBackend.ts` retains static defaults (constructor seam) so no divergence-marker required there.
