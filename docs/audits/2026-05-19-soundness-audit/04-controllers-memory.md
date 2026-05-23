# Memory Controllers Soundness Audit (Slice 04)

ADR-0201 read-only static audit. Scope: memory controllers in
`forks/agentdb/src/controllers/` (plus `forks/agentdb/src/optimizations/RVFOptimizer.ts`).
Cross-reference: `forks/ruflo/v3/@claude-flow/memory/src/`.

## Summary

The memory-controller layer is largely sound and complete. Restored fork-only
controllers from ADR-0178 (`HierarchicalMemory`, `MemoryConsolidation`,
`ReflexionMemory`, `StreamingEmbeddingService`, `RVFOptimizer`) are wired through
`forks/agentdb/src/index.ts` (lines 51–90) and consumed by ruflo's
`controller-registry.ts`. ReflexionMemory's `retrieveRelevant` and
`HierarchicalMemory`'s `recall` both implement explicit, comment-justified
"VectorBackend empty → SQL fallback" paths that are well-aligned with
`feedback-no-fallbacks` (the SQL path is the durable record, not a silent
mask). `EmbeddingService` correctly re-throws `EmbeddingDimensionMismatchError`
as a fatal at boot (line 88–90).

Real correctness issues exist:

1. **F-04-001 (HIGH)** — `ReasoningBank.updatePatternStats` (`ReasoningBank.ts:534-541`)
   computes the online success-rate / avg-reward average using a SQL statement
   that updates `uses = uses + 1` and `success_rate = (success_rate * uses + ?) / (uses + 1)`
   in the same `UPDATE`. With the original snake_case columns the divisor and
   the multiplied weight both read the **pre-increment** value (SQL evaluates
   RHS before applying updates), so the running mean is correct here. But on
   the *first* call (`uses = 0, success_rate = 0.0`) the formula reduces to
   `(0*0 + outcome) / (0+1)` = `outcome`, which is fine — and on subsequent
   calls `(rate * n + outcome) / (n+1)` is the correct online mean. The
   slice-spec note flagged "line ~530" as suspect, but the SQL semantics here
   are actually right. **Genuine bug: `recordOutcome` (line 559-578)
   ALWAYS calls `updatePatternStats` even when the pattern has been deleted.**
   If `patternId` no longer exists the UPDATE silently changes 0 rows, then
   the subsequent `getPattern(patternId)` returns null (line 570) and the
   learning sample is skipped — no error is raised, the caller never learns
   the outcome was lost.

2. **F-04-002 (HIGH)** — `MemoryConsolidation.createSemanticMemory`
   (`MemoryConsolidation.ts:380-384`) divides `weightedImportance` by
   `totalAccess` without a zero guard. If all `accessCount === 0` for cluster
   members (possible if the `minAccessCount` filter was lowered to 0 via
   `ConsolidationConfig`), `totalAccess === 0` → `weightedImportance = NaN`
   → store call records a NaN importance → all downstream retention /
   sorting math becomes NaN.

3. **F-04-003 (HIGH)** — `MemoryConsolidation.consolidate` (lines 252-256)
   catches all exceptions and returns a partially-filled report with a
   `console.error` log only. Per `feedback-best-effort-must-rethrow-fatals`
   this swallows fatal data-integrity errors silently (e.g. a failed
   `createSemanticMemory` for any cluster after the first leaves the report
   reporting partial success without surfacing the failure).

4. **F-04-004 (MEDIUM)** — `EmbeddingService.initialize` (lines 87-102)
   catches non-dimension-mismatch errors and sets `this.pipeline = null`,
   which causes subsequent `embed()` calls to silently return
   `mockEmbedding(text)` — a deterministic hash-based vector that has zero
   semantic meaning. Any operation that depends on real embeddings
   (recall, ReasoningBank search, ContextSynthesizer) will produce
   garbage results without any in-band error signal. This is exactly the
   pattern `feedback-no-fallbacks` warns against (a fallback that "succeeds"
   while the feature is broken).

5. **F-04-005 (MEDIUM)** — `HNSWIndex` is exported from `controllers/index.ts`
   line 11, but is **NOT instantiated by any controller in
   `forks/agentdb/src/controllers/`** (only `backends/README.md` references
   `new HNSWIndex(...)`). HNSW is wired in `forks/agentdb/src/backends/hnswlib/HNSWLibBackend.ts`
   (separate path used by VectorBackend), so the `controllers/HNSWIndex.ts`
   class is effectively unwired — it's a standalone facility. Reference
   `[reference-embedding-model]` calls out HNSW m=23/efC=100/efS=50, but
   `controllers/HNSWIndex.ts:146-148` defaults to M=16/efC=200/efS=100.
   The 23/100/50 contract lives in the HNSWLibBackend / config-chain layer,
   not this class.

6. **F-04-006 (MEDIUM)** — `MemoryController.ts:108-125` constructs three
   attention controllers (`SelfAttention`, `CrossAttention`,
   `MultiHeadAttention`) but its `search()` (line 222-270) only computes
   plain cosine similarity over the in-memory `Map<string, Memory>`. The
   `vectorBackend.insert()` happens (line 147) but `vectorBackend.search()`
   is never called. The class is a per-process Map cache that pretends to
   have a backend.

7. **F-04-007 (LOW)** — `ReflexionMemory.dualWriteEpisodeToSQL` (line
   1274-1283) explicitly swallows non-`no-such-table` errors with a
   `console.warn` and returns. This is the legitimate version of the
   pattern (primary write already succeeded) but the comment says
   "swallow" out loud — flagging because `feedback-best-effort-must-rethrow-fatals`
   says these wrappers should re-throw fatals; today this branch can't
   distinguish a transient SQL error from a disk-full or
   schema-mismatch fatal.

8. **F-04-008 (LOW)** — `ReflexionMemory.enhanceQueryWithGNN`
   (lines 1022-1025) returns the original `queryEmbedding` on any GNN
   error with a `console.warn`. This is reasonable degradation (GNN
   enhancement is non-essential), but the catch is overbroad and would
   hide a corrupted-vector fatal.

9. **F-04-009 (LOW)** — `CausalRecall.vectorSearch` (line 187-218) falls
   back to a brute-force SQL JOIN that uses `LIMIT k*2` *after*
   `ORDER BY e.ts DESC` (line 198) — it samples the most recent episodes,
   not the most similar ones, then computes similarity on that subset.
   On large corpora this produces poor recall (recent ≠ relevant).

10. **F-04-010 (INFO)** — `StreamingEmbeddingService` (`StreamingEmbeddingService.ts`)
    is exported but has "zero in-tree consumers today" per the index.ts
    comment (line 59). Restored as documented orphan per ADR-0178
    Follow-up #4. Not a defect; flagged for completeness.

## Findings

### F-04-001 [HIGH] ReasoningBank.recordOutcome silently loses outcomes for deleted patterns

- File: `/Users/henrik/source/forks/agentdb/src/controllers/ReasoningBank.ts:559-578` and `534-541`
- Sound: NO — `recordOutcome` proceeds even when the target row has been deleted; the SQL `UPDATE` matches 0 rows and the caller cannot tell.
- Complete: PARTIAL — the math at line 537-539 is actually correct (SQL evaluates RHS pre-update; first-call edge `uses=0` reduces to `outcome`); slice-spec note about "success_rate formula bug" did not reproduce on careful trace.
- Evidence:

```
async recordOutcome(patternId, success, reward?): Promise<void> {
  this.updatePatternStats(patternId, success, actualReward); // no return-value check
  if (this.learningBackend) {
    const pattern = this.getPattern(patternId);  // null if deleted
    if (pattern?.approach) { ... }               // silently skipped
  }
}
```

  `updatePatternStats` is `void` and never reports whether the UPDATE actually
  changed a row. Combined with the conditional `pattern?.approach` guard at
  559, a deleted patternId is a no-op the caller can't detect.

- Suggestion: `updatePatternStats` should return `result.changes`; `recordOutcome` should throw or return false when the row is missing. Both branches violate `feedback-no-fallbacks` by silently succeeding on a broken precondition.

### F-04-002 [HIGH] MemoryConsolidation.createSemanticMemory divides by zero on cold clusters

- File: `/Users/henrik/source/forks/agentdb/src/controllers/MemoryConsolidation.ts:380-384`
- Sound: NO — division by zero produces NaN; no guard.
- Complete: NO — the controller stores a NaN importance into HierarchicalMemory; all downstream retention math becomes NaN.
- Evidence:

```
const totalAccess = cluster.members.reduce((sum, m) => sum + m.accessCount, 0);
const weightedImportance = cluster.members.reduce(
  (sum, m) => sum + (m.importance * m.accessCount),
  0
) / totalAccess;
```

  The default config forces `minAccessCount = 3` (line 173) so
  `getConsolidationCandidates` filters out zero-access rows — but the
  field is configurable through `ConsolidationConfig`, and any caller
  passing `minAccessCount: 0` (e.g. tests, manual consolidation) hits the
  divide-by-zero.

- Suggestion: Guard `totalAccess === 0 ? cluster.avgImportance : weightedImportance / totalAccess`. Fall back to the simple average that was already computed at line 335.

### F-04-003 [HIGH] MemoryConsolidation.consolidate swallows fatal errors into a partial report

- File: `/Users/henrik/source/forks/agentdb/src/controllers/MemoryConsolidation.ts:252-256`
- Sound: NO — `feedback-best-effort-must-rethrow-fatals` says best-effort wrappers must discriminate fatals; this one swallows all.
- Complete: PARTIAL — happy path returns a complete report; failure path returns a half-filled report that downstream code treats as successful.
- Evidence:

```
} catch (error) {
  console.error('❌ Memory consolidation failed:', error);
  report.executionTimeMs = Date.now() - startTime;
  return report;     // partial report, no error signal
}
```

  Any fatal in steps 1-7 (DB lock, embedding service crash, vector backend
  unavailable) gets reported as a console.error and a partial report. The
  caller receives a `ConsolidationReport` object that looks like success
  except for some zero fields.

- Suggestion: Re-throw fatals; only catch error classes that represent recoverable conditions (e.g. a single failed `createSemanticMemory` should be caught inside the cluster loop, not at the outer scope).

### F-04-004 [MEDIUM] EmbeddingService falls back to mock embeddings on init failure

- File: `/Users/henrik/source/forks/agentdb/src/controllers/EmbeddingService.ts:87-102`
- Sound: NO — direct violation of `feedback-no-fallbacks`; the fallback path produces deterministic hash-based vectors with zero semantic meaning, but downstream callers cannot detect it.
- Complete: NO — recall/search/synthesis produces garbage results when the model fails to load.
- Evidence:

```
} catch (error) {
  if (error instanceof EmbeddingDimensionMismatchError) throw error;
  // ...
  console.warn(`Transformers.js initialization failed: ${errorMessage}`);
  console.warn('   Falling back to mock embeddings for testing');
  // ...
  this.pipeline = null;     // embed() now silently uses mockEmbedding
}
```

  This is exactly the "tests must FAIL loudly" rule from
  `feedback-no-fallbacks`: ReasoningBank.searchPatterns, ReflexionMemory.retrieveRelevant,
  HierarchicalMemory.recall — all of them silently produce uniform-random-looking
  results when the embedding model fails to download.

- Suggestion: Only mock when `provider === 'local'` or when a `mockEmbeddings: true` flag is passed explicitly. Otherwise re-throw. The dimension-mismatch path already does this correctly (line 88-90); extend to other init failures.

### F-04-005 [MEDIUM] HNSWIndex is exported but not wired through memory controllers

- File: `/Users/henrik/source/forks/agentdb/src/controllers/HNSWIndex.ts` (exported in `controllers/index.ts:11`)
- Sound: PARTIAL — class is well-formed, dimension defaults to 768 (line 150) which matches `reference-embedding-model`.
- Complete: NO for the slice question "HNSW wiring: actually used? Imports + hnsw.add()/search() calls" — searched all of `forks/agentdb/src/controllers/` and `forks/agentdb/src/backends/`; the only `new HNSWIndex(...)` reference is in `backends/README.md` (a documentation example). No memory controller (ReasoningBank, ReflexionMemory, HierarchicalMemory, MemoryConsolidation, CausalRecall) imports or instantiates `HNSWIndex`.
- HNSW IS wired through `backends/hnswlib/HNSWLibBackend.ts` and exposed via `VectorBackend.search()`, which the memory controllers do call. But the `controllers/HNSWIndex.ts` class is a separate, unwired implementation.
- HNSW params per `reference-embedding-model`: M=23, efC=100, efS=50. Defaults in `HNSWIndex.ts:146-148`: M=16, efC=200, efS=100. The contract isn't enforced here — must be set at the HNSWLibBackend / config-chain layer.
- Suggestion: Either wire `HNSWIndex` into a memory controller or remove it from the public export to avoid the false-affordance signal. Document the canonical HNSW entry point (HNSWLibBackend) in `controllers/index.ts`.

### F-04-006 [MEDIUM] MemoryController.search ignores its VectorBackend

- File: `/Users/henrik/source/forks/agentdb/src/controllers/MemoryController.ts:222-270`
- Sound: PARTIAL — constructor accepts a VectorBackend (line 105) and `store()` calls `vectorBackend.insert()` (line 147) — but `search()` iterates the in-memory `this.memories` Map and never calls `vectorBackend.search()`.
- Complete: NO — for any non-trivial corpus this devolves to O(N) linear scan of an in-process Map. The "150x faster RVF backend" promise from the comment header is unmet here.
- Evidence: lines 237-264 are pure `for (const [id, memory] of this.memories.entries())` loop with hand-rolled cosine similarity.
- Suggestion: When `vectorBackend` is present, delegate `search()` to `vectorBackend.search(query, topK, options)` and hydrate results from `this.memories.get(id)` — the same pattern ReasoningBank.searchPatternsV2 uses.

### F-04-007 [LOW] ReflexionMemory.dualWriteEpisodeToSQL swallows non-table errors

- File: `/Users/henrik/source/forks/agentdb/src/controllers/ReflexionMemory.ts:1274-1283`
- Sound: PARTIAL — the legitimate case (no-such-table) is correctly suppressed; the comment is explicit. But the catch-all branch above (line 1281-1282) downgrades any other error to a `console.warn`.
- Suggestion: Differentiate `SqliteError.code === 'SQLITE_READONLY'` / `SQLITE_FULL` etc. from "table not present" and re-throw the former. Per `feedback-best-effort-must-rethrow-fatals`.

### F-04-008 [LOW] ReflexionMemory.enhanceQueryWithGNN swallows all GNN errors

- File: `/Users/henrik/source/forks/agentdb/src/controllers/ReflexionMemory.ts:1022-1025`
- Sound: PARTIAL — falling back to the unenhanced embedding is reasonable when GNN is optional, but a corrupted vector / shape-mismatch fatal would be hidden.
- Suggestion: Discriminate "GNN not configured" from "GNN math threw" — the former is fine, the latter should propagate.

### F-04-009 [LOW] CausalRecall SQL fallback samples by recency, not similarity

- File: `/Users/henrik/source/forks/agentdb/src/controllers/CausalRecall.ts:188-218`
- Sound: NO — fallback path's `ORDER BY e.ts DESC LIMIT ?` picks the K most recent episodes, then computes similarity on that subset. For an old-but-highly-relevant episode the recency cutoff drops it.
- Complete: PARTIAL — works correctly when N < K*2; degrades silently above that.
- Suggestion: Drop the `ORDER BY e.ts DESC` from the candidate pull and sort by similarity over the full table (or paginate). Or use `pattern_embeddings` index if available.

### F-04-010 [INFO] StreamingEmbeddingService is a documented orphan

- File: `/Users/henrik/source/forks/agentdb/src/controllers/StreamingEmbeddingService.ts`
- Reference: `forks/agentdb/src/index.ts:59` ("Zero in-tree consumers today; documented as orphan in ADR-0171; restored to preserve future-wiring optionality per ADR-0178 Follow-up #4")
- Per `project-fork-only-controllers`, this class is intentionally kept; not a defect. No further action.

## Reference Soundness — Cross-Reference to Ruflo

- `forks/ruflo/v3/@claude-flow/memory/src/controller-registry.ts` imports
  `agentdb` (unscoped — per `reference-agentdb-unscoped-name` this is
  codemod-flipped to `@sparkleideas/agentdb` at publish time) and resolves:
  - `HierarchicalMemory` at line 1493 (with explicit `version mismatch` error)
  - `MemoryConsolidation` at line 1519 (with same version check)
  - `ContextSynthesizer` at line 1665 (static class — return-the-class semantics)
  - `ReasoningBank`, `ReflexionMemory`, `CausalRecall` — also imported through `agentdbModule` (lines 1023-1679)
- Two fallback stubs exist (`createTieredMemoryStub` line 2199, `createConsolidationStub` line 2246) for when agentdb import fails. These are well-bounded (size-limited, deterministic, marked-as-stubs) but mirror the F-04-004 issue — a downstream caller cannot tell whether they are talking to the real controller or the stub.

## Embedding Model & Dimension Conformance

- `EmbeddingService.ts:33` defaults to `'Xenova/all-mpnet-base-v2'` —
  matches `reference-embedding-model`.
- Dimension is pulled from the config chain (`chain.dimension`, line 34); no
  hard-coded 768 in EmbeddingService itself. The dimension probe at line
  76-86 throws `EmbeddingDimensionMismatchError` on mismatch — correct
  `feedback-best-effort-must-rethrow-fatals` behavior.
- `HNSWIndex.ts:150` defaults `dimension: 768` — matches the unified
  model.
- `StreamingEmbeddingService.ts:41` and `EnhancedEmbeddingService` —
  inherit from `EmbeddingService`, no hard-coded model.

## RVF-First Per [project-rvf-primary]

- `RVFOptimizer` (`forks/agentdb/src/optimizations/RVFOptimizer.ts`) is the
  RVF-side implementation — quantization, dedup, multi-level cache. It is
  imported into `forks/agentdb/src/index.ts:90` and exposed through the
  controller-registry (line 1721) as a stats-only wrapper.
- The memory controllers (HierarchicalMemory, ReflexionMemory) consistently
  put the **VectorBackend** in front of the **SQL** path (see
  `HierarchicalMemory.ts:351-381` and `ReflexionMemory.ts:270-286`). SQL is
  the durable record / cross-process fallback; VectorBackend is the fast
  in-memory index. That is the correct RVF-first shape — RVF is the
  primary search surface; SQLite is the disaster-recovery / durable
  record. No "SQLite-first" anti-pattern found in the audited controllers.

## Audit Coverage Notes

- Read in full: `HierarchicalMemory.ts` (843 lines), `ReasoningBank.ts`
  (687 lines), `MemoryConsolidation.ts` (686 lines), `ReflexionMemory.ts`
  (1404 lines), `EmbeddingService.ts` (212 lines), `MemoryController.ts`
  (462 lines), `ContextSynthesizer.ts` (286 lines), `CausalRecall.ts`
  (506 lines), `StreamingEmbeddingService.ts` (316 lines), `HNSWIndex.ts`
  (582 lines), `RVFOptimizer.ts` (first 120 lines + targeted greps).
- AttentionService and the `attention/` subdir were read at top-level
  (`AttentionService.ts` 1052 lines, full read) — out of scope of the
  memory-controller question but verified to be sound (NAPI → WASM →
  fallback discrimination, fatals re-thrown via `throw new Error(...)`
  with the original message).
- Cross-checked against `forks/ruflo/v3/@claude-flow/memory/src/controller-registry.ts`
  for ALL 10 audited controllers — references resolve.
