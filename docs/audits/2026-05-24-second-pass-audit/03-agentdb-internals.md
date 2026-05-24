# 03 — AgentDB internals second-pass audit

**Parent**: [ADR-0201](../../adr/ADR-0201-codebase-soundness-completeness-audit-with-runtime-validation.md)
**Slice**: 03/12 — AgentDB internals (G-16-004 [HIGH]).
**Scope**: `forks/agentdb/src/` (canonical agentdb, ADR-0161 consolidated 2026-05-08). Sub-surfaces audited: RVF format / persistence layer, HNSW indexing, archivist (audit layer), substrate seam.
**Predecessor**: [04-controllers-memory.md (May-19)](../2026-05-19-soundness-audit/04-controllers-memory.md) — fork-only controllers, ReasoningBank, MemoryConsolidation, EmbeddingService, HNSWIndex (controller class, not backend), MemoryController, RVFOptimizer, CausalRecall, ReflexionMemory.
**Memory provenance**: `project-agentdb-parallel-extraction`, `reference-embedding-model`, `reference-agentdb-unscoped-name`, `project-fork-only-controllers`, `project-deprecated-controllers`, `project-rvf-test-artifact-resolution`.

## Summary

- Files inventoried: package layout 8 top-level dirs under `src/` (`backends/`, `archivist/`, `controllers/`, `core/`, `optimizations/`, `quantization/`, `services/`, `simd/`); slice deep-scored: 14 files across the RVF persistence layer (`backends/rvf/`), HNSW backend (`backends/hnswlib/`), archivist dispatch + invariants + substrates + audit-writer.
- Findings: **9 total / 3 critical / 4 warning / 2 note**.
- Soundness verdict: **FAIL** — three independent classes of silent-correctness drift: (a) RVF metric-not-persisted-on-reopen trap survives ADR-0073 in this fork (F-03-001); (b) archivist invariants are evaluated AFTER the substrate write commits, so the documented "abort BEFORE applied" charter (MODULE.md line 45) does not hold (F-03-002); (c) the canonical HNSW 23/100/50 contract is enforced in `@claude-flow/memory` callers but the `backends/factory.ts → HNSWLibBackend` path uses static 16/200/100 defaults when callers omit them (F-03-003).
- Completeness verdict: **PASS-WITH-DEBT** — handler registry covers the ADR-0180 Phase 5/6/7 surface (50+ handlers across 22 domain families); ADR-0231 wave A9 `microlora-adapt` payload-shape work landed correctly. Gaps are in cross-layer contract enforcement, not handler coverage.
- Bottom line: the layer is structurally well-shaped (substrate-seam discipline, registry-keyed dispatch, charter-tagged file headers, branded SubstrateAccess) but three documented contracts are aspirational — the code does not currently enforce them. The most consequential is F-03-002 (invariants-after-commit): the dispatch flow writes the substrate first, then evaluates invariants, then writes `state: rejected` to the audit log without rolling the substrate back. Audit replay would see `rejected` for an entry whose data is in the substrate. F-03-001 is the second wave of the post-ADR-0073 `2cos−1` trap, in a different code path (RVF reopen instead of agentic-flow RVF backend). F-03-003 means a direct caller bypassing `@claude-flow/memory`'s `resolve-config.ts` gets the wrong HNSW params silently.

## Findings

### F-03-001 [CRITICAL] RVF metric is not re-probed on reopen — `distanceToSimilarity` uses constructor-supplied metric, persisting the post-ADR-0073 `2cos−1` trap pattern

- **File**: `/Users/henrik/source/forks/agentdb/src/backends/rvf/RvfBackend.ts:128–129, 142–196, 269–281, 605–637, 739–746`
- **Sound**: NO — opening an existing `.rvf` store inherits `this.metricType` from the constructor config (default `'cosine'`), NOT from the persisted store. `distanceToSimilarity()` then uses that constructor value to convert distances to similarity. If the store was created with one metric and reopened with another (or the default), the conversion is wrong.
- **Complete**: PARTIAL — the underlying N-API `db.metric()` IS exposed via `RvfBackend.metric()` (line 542–549), and the CLI surface in `cli/commands/rvf.ts:364` consults it. But `initialize()`, `load()`, and `openReadonly()` never use it to seed `this.metricType`.
- **Evidence**:
  ```typescript
  // RvfBackend.ts:128–129 (constructor — locked at construction)
  this.metricType = config.metric ?? 'cosine';

  // :161 (open — no metric handshake)
  this.db = await RvfDatabase.open(storagePath, rvfBackendType);

  // :276 (load — same)
  this.db = await RvfDatabase.open(path, rvfBackendType);

  // :612 (openReadonly — same, but probes `dimension` only)
  const db = await RvfDatabase.openReadonly(path, backendType);
  // ... lines 614–620 probe `dim = await db.dimension()` — but NOT metric

  // :739–746 (the score-conversion site that consumes the stale metricType)
  private distanceToSimilarity(distance: number): number {
    switch (this.metricType) {
      case 'cosine': return 1 - distance;
      case 'l2': return Math.exp(-distance);
      case 'ip': return -distance;
      default: return 1 - distance;
    }
  }
  ```

  This is exactly the post-ADR-0073 pattern: the persistence layer drops the metric on reopen, the consumer keeps using a guess, and the `1 − distance` math runs against a distance produced under a different metric. Per memory `project-memory-search-rvf-snapshot-isolation`, the agentic-flow-side variant produced `2cos−1` similarity offsets that are invisible to rank-only checks (`embeddings_compare` would catch it; ordering tests will not).

  `SqlJsRvfBackend.ts:339–342` makes this worse — its `createSchema()` writes `dimension` and `metric` to an `rvf_meta` SQLite table (comment: "Store dimension and metric for validation on load"), but `load()` (line 200–201) calls `createSchema()` again, which OVERWRITES the stored metric with `this.metricType` (the wrong one) via `INSERT OR REPLACE`. The "validation on load" never happens. Read-back of the persisted metric is dead code today.

- **Suggestion**: In `RvfBackend.initialize()` / `load()` / `openReadonly()`, after `RvfDatabase.open`, call `this.metricType = (await this.db.metric()) as 'cosine' | 'l2' | 'ip'` and fail-loud if the constructor metric was supplied and disagrees (`feedback-no-fallbacks` — if a caller passes `cosine` and the store says `l2`, that is a real schema mismatch that should fail at boot, not silently produce wrong similarity scores). Same shape for `SqlJsRvfBackend.load()`: read back `(SELECT value FROM rvf_meta WHERE key='metric')`, fail-loud on mismatch, and DO NOT re-call `createSchema()` (it's an `INSERT OR REPLACE` that clobbers the verification surface).

### F-03-002 [CRITICAL] Archivist invariants are evaluated AFTER the substrate write commits — charter `mutation-invariants` says "BEFORE applied", code says "after"

- **File**: `/Users/henrik/source/forks/agentdb/src/archivist/index.ts:986–1013` and `MODULE.md:45`
- **Sound**: NO — the documented contract is "evaluated at write-time BEFORE the audit entry transitions to `applied`; violation aborts the write and records `state: 'rejected', reason: 'invariant_violation'`". The implementation runs the handler (which calls `ctx.substrate.withWrite` and commits the data) FIRST, then evaluates invariants. The audit transition is correct (`applied` vs `rejected`), but the substrate write is not aborted.
- **Complete**: NO — when an invariant violates, the substrate has the data, the audit log says `rejected`, and there is no rollback. Audit replay would diverge from substrate state at that auditId. `substrateStateBefore` / `substrateStateAfter` invariant inputs are hardcoded to `undefined` (lines 997–998), so state-pair invariants — the only kind that could meaningfully gate on the substrate transition — cannot be expressed.
- **Evidence**:
  ```typescript
  // index.ts:986–1013 (dispatchMutationInternal — the live dispatch path)
  try {
    await (handler as MutationHandlerFn<unknown>)(ctx, payload);  // ← substrate write commits here
  } catch (err) {
    await writeAudit({ ...baseEntry, state: 'failed' });
    throw err;
  }

  const invariantVerdicts: InvariantVerdict[] = invariants.map((inv) => {
    const verdict = inv({
      callerIntent: payload,
      recordedPayload: payload,
      substrateStateBefore: undefined,  // ← always undefined, no state available
      substrateStateAfter: undefined,   // ← always undefined, no state available
    });
    return { name: inv.name || 'anonymous', verdict };
  });

  const violation = invariantVerdicts.find(
    (v) => typeof v.verdict === 'object' && (v.verdict as { violated: true }).violated === true,
  );
  if (violation) {
    await writeAudit({ ...baseEntry, state: 'rejected', invariantVerdicts });  // ← audit says rejected
    const detail = (violation.verdict as { detail: string }).detail;
    throw new Error(`archivist: invariant '${violation.name}' violated: ${detail}`);
    // ← throws AFTER substrate is written; no rollback
  }
  ```

  Compare to charter at `MODULE.md:45`:
  > "Per-handler declared predicates over `(callerIntent, recordedPayload, substrateStateBefore, substrateStateAfter)`. Evaluated at write-time BEFORE the audit entry transitions to `applied`; violation aborts the write and records `state: 'rejected', reason: 'invariant_violation'`."

  The "BEFORE" + "aborts the write" wording is unsatisfied. ADR-0231 wave A9's `microlora-adapt` handler is a concrete reproduction: `inputIsNotAllZero` invariant (`invariants/ruvllm/microlora-adapt.ts:86–102`) is documented as the "Q-3 root-cause guard" against the pre-fork zero-input no-op bug. If a caller passes an all-zero input via `archivist.dispatch('ruvllm_microlora_adapt', payload)`, the handler runs `instance.journal.push({op:'adapt', input: <zeros>, ...})` AND `handle.write({storeId, key:'root', payload: store})` (handler lines 73–82) — the FS-JSON file is now persisted with the all-zero entry. The invariant then fires, audit writes `rejected`, throw propagates. Next dispatch's `handle.read()` will see the all-zero entry in the journal. The fail-loud throws but does not protect the substrate.

  The test fixture at `test/archivist/handlers/ruvllm/microlora-adapt.test.ts:43–44` invokes invariants directly with `substrateStateBefore: undefined, substrateStateAfter: undefined` — tests are consistent with the runtime, both leave the substrate-state surfaces unwired.

- **Suggestion**: Either (a) implement transactional substrate writes (FS-JSON: write to `.tmp`, evaluate invariants, then atomic rename; RVF: use `freeze()` epoch + rollback via re-open at the prior epoch — currently `freeze()` is called nowhere in the dispatch path) so the charter's "abort BEFORE applied" can hold; or (b) amend MODULE.md `mutation-invariants` to say "invariants are post-write payload checks" and remove the `substrateStateBefore/After` from the `Invariant<T>` arg shape (registration.ts:24–29), since they are dead parameters today. Option (a) is the charter-faithful path; option (b) is the honest one.

### F-03-003 [CRITICAL] `backends/factory.ts → HNSWLibBackend` does not derive HNSW params from `deriveHNSWParams`; uses static 16/200/100 defaults divergent from canonical 23/100/50

- **File**: `/Users/henrik/source/forks/agentdb/src/backends/factory.ts:155–160, 232, 265, 279` and `/Users/henrik/source/forks/agentdb/src/backends/hnswlib/HNSWLibBackend.ts:87–94`
- **Sound**: NO — `deriveHNSWParams(dim)` is re-exported from `src/index.ts:30` (and the canonical impl lives at `core/config-chain.ts:38–46`); for `dim=768` it returns `{M:23, efConstruction:100, efSearch:50, maxElements:100000}` per `reference-embedding-model`. The factory `createHNSWLibBackend(config)` passes the caller's `VectorConfig` straight through. `HNSWLibBackend`'s constructor (line 87–94) applies static defaults `{maxElements:100000, M:16, efConstruction:200, efSearch:100}` when the caller omits them.
- **Complete**: NO — for the question "is the canonical HNSW contract enforced when callers go through `createBackend('hnswlib', {dimension:768})`?", the answer is no. `forks/ruflo/v3/@claude-flow/memory/src/agentdb-backend.ts:213, 291` and `resolve-config.ts:328` DO call `deriveHNSWParams` and pass derived M/efC/efS through `VectorConfig` — so the documented memory-layer callers get the right params. But a direct consumer of agentdb that imports `createBackend` from `agentdb/dist/src/backends/factory.js` (e.g. a plugin author, a benchmark, or a future controller) gets the wrong params silently. `controllers/HNSWIndex.ts:146–148` has the same divergence (already flagged as F-04-005 in the May-19 audit).
- **Evidence**:
  ```typescript
  // backends/factory.ts:155–160 (no derivation)
  async function createHNSWLibBackend(config: VectorConfig): Promise<VectorBackend> {
    const { HNSWLibBackend } = await import('./hnswlib/HNSWLibBackend.js');
    return new HNSWLibBackend(config);  // ← passes config straight through
  }

  // hnswlib/HNSWLibBackend.ts:87–94 (static defaults when caller omits)
  this.config = {
    maxElements: 100000,
    M: 16,             // ← canonical is 23 for dim=768
    efConstruction: 200,  // ← canonical is 100
    efSearch: 100,        // ← canonical is 50
    ...config,
    dimension,
  };
  ```

  The 100K `maxElements` cap (ADR-0080) IS aligned. The M/efC/efS divergence is the concrete defect.

  `MutationGuard.ts:55, 175, 287` enforces the `maxElements` cap as a precondition (`this.vectorCount + items.length <= this.config.maxElements`); this is structurally correct but the limit value is whatever the backend was constructed with — if a benchmark passes `maxElements: 50000` (as `benchmark/BenchmarkSuite.ts:446` does), the MutationGuard rejects writes earlier than 100K. That's intentional, not a defect.

- **Suggestion**: In `factory.ts:createHNSWLibBackend` (and `createRvfBackend` if HNSW params apply there too — they do, RvfBackend.ts:167–168 reads `config.M` and `config.efConstruction`), call `deriveHNSWParams(config.dimension)` and merge into config when the caller omits M/efC/efS. This makes "create backend, dim=768, no other params" deterministically produce the canonical configuration regardless of caller path. Alternatively, fail-loud when the caller omits M/efC/efS — the test in `feedback-no-fallbacks` shape — forcing all callers to go through `resolve-config.ts` or `deriveHNSWParams` explicitly.

### F-03-004 [WARNING] `archivist/hot-path-writer.ts::enqueue` busy-spins at queue capacity instead of awaiting drain — comment promises "bounded µs-scale block" but code does fire-and-forget loop

- **File**: `/Users/henrik/source/forks/agentdb/src/archivist/hot-path-writer.ts:21–33`
- **Sound**: PARTIAL — at queue capacity, the producer runs `while (this.count >= CAP) { void this.drainOne(); }`. `drainOne` is `async`; `void` discards its promise. The `while` loop re-evaluates `this.count` synchronously, but `drainOne`'s decrement of `this.count` happens on a microtask — so the loop body is `void this.drainOne(); void this.drainOne(); ...` queueing N+ writes against the same audit-fd before any complete.
- **Complete**: PARTIAL — the audit entries DO eventually get written (because `drainOne` synchronously decrements `this.count` at line 43, BEFORE awaiting `writeThroughEntry`). So the loop terminates when count drops below CAP. But the comment at line 5 says "at-capacity producer blocks for bounded µs-scale time (never drops)" — that's an `await` contract; the code does fire-and-forget spin.
- **Evidence**:
  ```typescript
  enqueue(entry: AuditEntry): void {
    while (this.count >= CAP) {
      void this.drainOne();   // ← async, returns Promise<void>; void discards
    }
    // ...
  }

  private drainOne(): Promise<void> {
    const entry = this.buf[this.tail];
    this.buf[this.tail] = undefined;
    this.tail = (this.tail + 1) & MASK;
    this.count--;              // ← sync decrement, loop terminates
    if (!entry) return Promise.resolve();
    return writeThroughEntry(entry).catch(/* re-throw on microtask */);
  }
  ```

  The `count--` happens synchronously so the loop does terminate. But the `enqueue` method returns sync after potentially dispatching N+ `writeThroughEntry` calls in flight, none awaited. If the consumer is `setImmediate`-throttled (the documented hot-path discipline), then ordering is reasonably maintained. But the documented invariant "producer blocks" is not actually held. Under sustained over-capacity pressure, `enqueue` can return with 256 fire-and-forget writes queued against a single audit-fd, each calling `auditFd.write(line)` without serialization (acquireWriteLock at audit-writer.ts:135 is a documented no-op).

- **Suggestion**: Convert `enqueue` to `async` and `await this.drainOne()` at capacity; or use a back-pressure primitive (a `Promise<void>` resolved on drain). The current behavior is correct under low load but the comment-vs-code mismatch is misleading and the unbounded in-flight-write count is a future contention site. The audit-writer's lack of a real advisory lock (audit-writer.ts:125–134 documents the TODO) is a separate but related gap — hot-path entries from 256 in-flight writes rely on PIPE_BUF atomicity for ordering.

### F-03-005 [WARNING] `RvfBackend.indexStats()` fallback returns hardcoded `m:16, efConstruction:200` — same wrong-default-on-error pattern as F-03-003

- **File**: `/Users/henrik/source/forks/agentdb/src/backends/rvf/RvfBackend.ts:552–572`
- **Sound**: PARTIAL — when `this.db.indexStats()` succeeds, returns the live HNSW stats. When it throws, returns a fabricated default with `m:16, efConstruction:200, layers:0, needsRebuild:false`. A caller consuming `indexStats()` to decide whether to rebuild the index gets a misleading "no rebuild needed" answer on probe failure.
- **Complete**: NO — for the slice question "per-controller divergence on HNSW params", this is one of the divergence sites: even if the underlying store IS constructed with `M=23, efC=100`, an `indexStats()` failure returns the wrong static defaults. A consumer can't tell whether it's looking at canonical or fallback values.
- **Suggestion**: Re-throw the error instead of returning a fabricated default (`feedback-no-fallbacks`). An `indexStats()` failure on an initialized store is a real failure, not "use defaults".

### F-03-006 [WARNING] `RvfBackend.remove()` is fire-and-forget — sync interface cannot await, but the failure path only logs

- **File**: `/Users/henrik/source/forks/agentdb/src/backends/rvf/RvfBackend.ts:242–251`
- **Sound**: PARTIAL — the sync `remove(id)` queues a delete via `this.db.delete([id]).catch(...)` and returns `true` unconditionally. The caller cannot tell whether the delete actually happened, succeeded, or failed.
- **Complete**: NO — returns `true` even for IDs that don't exist (because the delete is fire-and-forget, no result inspection). Callers that branch on the boolean return are mis-informed. The async `removeAsync()` (line 396–406) is correct and returns the actual result; sync `remove()` is the broken one.
- **Suggestion**: Either (a) throw an explicit "sync remove not supported, use removeAsync" error (matching the pattern at `search()` line 234–240), or (b) return `false` always since the sync surface cannot report success. The current `return true` is the worst option — it lies.

### F-03-007 [WARNING] `EmbeddingService` `mockEmbedding` fallback on init failure (F-04-004 from May-19 audit) — still present, still produces zero-signal vectors when model load fails

- **File**: `/Users/henrik/source/forks/agentdb/src/controllers/EmbeddingService.ts:87–102` (from prior audit)
- **Sound**: NO — fallback path produces deterministic hash-based vectors with zero semantic meaning; downstream callers (ReasoningBank.searchPatterns, ReflexionMemory.retrieveRelevant, HierarchicalMemory.recall) silently return garbage results.
- **Status note**: Listed in May-19 audit as F-04-004 [MEDIUM]. Re-flagging in this slice because the archivist `embeddingScorerFactory` capability (`ArchivistInitConfig.embeddingScorerFactory`, `index.ts:290`) wraps `EmbeddingService` — handlers reaching `ctx.capabilities.embeddingScorer.embed(text)` get the mock under the same failure mode. The new exposure surface (archivist handlers for `agentdb_embed`, `agentdb_skill_search`, `agentdb_reflexion_retrieve`) inherits the bug. Not duplicated in counts, recorded here for cross-audit traceability.

### F-03-008 [NOTE] `mutation-invariants` charter parameter `substrateStateBefore` / `substrateStateAfter` is dead — registry stores `Invariant<T>` shape with state args, dispatch path passes `undefined`

- **File**: `/Users/henrik/source/forks/agentdb/src/archivist/registration.ts:24–29`
- **Note**: The `Invariant<T>` type (line 24–29) declares four args: `callerIntent`, `recordedPayload`, `substrateStateBefore`, `substrateStateAfter`. The dispatch site at `index.ts:993–1001` passes `substrateStateBefore: undefined, substrateStateAfter: undefined` always. Tests follow the same convention (`test/archivist/handlers/ruvllm/microlora-adapt.test.ts:43–44`). The state-pair surface is therefore type-shape-only; no invariant in the tree consumes it (verified via grep `substrateStateBefore` across `src/archivist/invariants/**` — zero consumers). Recommend removing the two dead params from `Invariant<T>` and from `dispatchMutationInternal`'s call, OR plumbing state through (which would require substrate snapshot semantics — same dependency as F-03-002). Not a defect today; flagged as documented charter drift.

### F-03-009 [NOTE] `controllers/HNSWIndex` is exported but unused — same divergence flagged in May-19 F-04-005, plus this audit confirms `wasm-loader.ts` excludes it deliberately

- **File**: `/Users/henrik/source/forks/agentdb/src/controllers/HNSWIndex.ts`, exported in `controllers/index.ts:11` and `src/index.ts:73`; explicitly NOT exported in `src/wasm-loader.ts:40`.
- **Note**: The May-19 audit (F-04-005) called this unwired. This slice confirms: no memory controller imports `HNSWIndex`. The WASM-only entry point (`wasm-loader.ts:40`) carries an explicit comment `// Note: HNSWIndex is NOT exported here - use the main entry point if you need it`, treating it as a hnswlib-node-only path even though the controller itself does not import hnswlib-node directly — it just defaults to native-HNSW backends. The "documented orphan" reading from the May-19 audit holds. No new defect.

## Cross-cutting

- **Charter / code drift** (F-03-002, F-03-008): two of three charter contracts in `archivist/MODULE.md` are aspirational. The `mutation-invariants` responsibility section claims invariants gate the `applied` transition; the implementation gates only the audit-log state field. The `Invariant<T>` type carries state-pair params that no caller populates. Either tighten the implementation OR weaken the charter — running with both diverged is the silent-correctness shape `feedback-best-effort-must-rethrow-fatals` warns against.
- **Reopen-time validation** (F-03-001 + the SqlJsRvfBackend variant): both RVF backends store enough metadata to verify a reopen against the supplied config, neither does. The `SqlJsRvfBackend` case is worse — it has explicit "validation on load" intent in comments and SQL, but `load()` calls `createSchema()` which `INSERT OR REPLACE`s the validation surface with the wrong value. Same root cause across both: no caller checks the persisted metric on reopen, both fall back to the constructor value.
- **`feedback-no-fallbacks` violations** (F-03-001, F-03-005, F-03-006, F-03-007): four sites where the audited code returns a fabricated success value (or silently degrades to a non-functional fallback) instead of failing loud. The May-19 audit's F-04-004 (EmbeddingService.mockEmbedding) is the architectural precedent; this audit found three more in the RVF backend layer.
- **`reference-embedding-model` divergence** (F-03-003): canonical contract is M=23, efC=100, efS=50, mpnet-768, 100K maxElements. The contract is held when callers route through `@claude-flow/memory`'s `resolve-config.ts`; the contract is NOT held when callers route through `agentdb/backends/factory.ts::createBackend(...)`. Two parallel paths into the same backend, one canonical, one with old static defaults.
- **`project-deprecated-controllers` is partially stale**: the memory note says "only `federatedSession` and `federatedLearningManager` can be removed". `FederatedSessionManager` IS wired today — lazy-loaded by `SelfLearningRvfBackend.initComponents()` (line 402) when `config.federated === true`, and re-exported from `wasm-loader.ts:200`. `FederatedLearningManager` does not appear in `forks/agentdb/src/`. The memory note appears outdated; recommend re-checking before acting on "can be removed".
- **`project-fork-only-controllers` confirmation**: the 8 fork-only files from ADR-0178 restoration (`HierarchicalMemory`, `MemoryConsolidation`, `RVFOptimizer`, 4 services, `StreamingEmbeddingService`) are exported from `src/index.ts:58–96` with documented provenance comments. The slice did not find any orphan that should be re-dropped. Upstream-sync agents should preserve these.

## Out of scope (slice scope clarification)

- **Controllers** (`src/controllers/**`): audited in May-19 slice 04. This slice confirms the controller-side findings still hold and noted F-03-007 (EmbeddingService) as cross-exposure into the archivist capability layer, but did not re-score them.
- **CLI** (`src/cli/**`): out of scope per slice spec.
- **MCP tools** (`src/mcp/**`): out of scope (covered by slices 08/09 of the May-19 audit).
- **WASM bindings** (`src/wasm-loader.ts`, `src/simd/**`): WASM rebuild + native binding integration is slice 06 of this second-pass audit (already present in the dir).
- **Benchmarks** (`src/benchmark/**`): noted that benchmark `maxElements` values (20K–150K) intentionally diverge from the 100K canonical for stress testing; not a defect.
- **Quantization** (`src/quantization/**`): not in slice spec sub-surfaces; not audited.
- **Reasoning bank `recordOutcome` deleted-pattern silent loss** (F-04-001 from May-19): not re-scored here; still applies.

## Audit coverage notes

- Read in full: `RvfBackend.ts` (753 lines), `SelfLearningRvfBackend.ts` (491 lines), `HNSWLibBackend.ts` (449 lines), `SqlJsRvfBackend.ts` (first 460 lines / full), `backends/factory.ts` (348 lines), `archivist/index.ts` (lines 1–200 + 820–1015), `archivist/registration.ts` (227 lines), `archivist/guards.ts` (105 lines), `archivist/audit-writer.ts` (180 lines), `archivist/audit-rotation.ts` (65 lines), `archivist/hot-path-writer.ts` (80 lines), `archivist/mutation-context.ts` (131 lines), `archivist/substrates/rvf-store.ts` (242 lines).
- Read partially: `controllers/HNSWIndex.ts` (skim for re-confirmation of May-19 F-04-005), `controllers/EmbeddingService.ts` (skim for F-03-007 cross-exposure).
- Header-scan only: `core/config-chain.ts` (47 lines — short), `core/AgentDB.ts` (handler list), `archivist/handlers/ruvllm/microlora-adapt.ts` + `invariants/ruvllm/microlora-adapt.ts` (full read, ADR-0231 wave A9 surface).
- Greps: cosine/distance score-conversion sites across `src/`; `deriveHNSWParams` callers across forks; `FederatedSessionManager` / `FederatedLearningManager` usage; `maxElements` callsites; archivist `catch` blocks; `substrateStateBefore` / `substrateStateAfter` consumers.
- Cross-reference: `forks/ruflo/v3/@claude-flow/memory/src/resolve-config.ts` line 328 + `agentdb-backend.ts` lines 60, 213, 291 (the canonical HNSW-derivation path); confirmed `archivist/MODULE.md` lines 18–49 against `archivist/index.ts` dispatch implementation.
