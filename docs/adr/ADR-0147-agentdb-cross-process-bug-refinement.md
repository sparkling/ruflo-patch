# ADR-0147: Refine ADR-0094 Bug-1 / Bug-2 fixes — partial-mapped fall-through and key-format parser for cross-process AgentDB reads

- **Status**: Implemented 2026-05-06 — original Bug 1+2 refinements verified live (HM probes confirmed memory_search returns 5 results, causal_query effect= returns 9). **Re-opened 2026-05-06 — Bug 4 (cause= asymmetry) and Bug 5 (adr-index skill fragile body extraction) discovered post-deploy; refinements pending.**
- **Date**: 2026-05-06
- **Deciders**: Henrik Pettersen
- **Depends on**: ADR-0094 (acceptance coverage), forks/ruflo `71b2ad33e` (original three-bug fix shipped in `@sparkleideas/memory@3.0.0-alpha.13-patch.358` + `@sparkleideas/cli@3.5.58-patch.380`)
- **Scope**: Two refinements to existing fixes in `forks/ruflo/v3/@claude-flow/memory/src/rvf-backend.ts` and `forks/ruflo/v3/@claude-flow/cli/src/memory/memory-router.ts`. No upstream-API contract changes.

## Context

ADR-0094 acceptance surfaced three AgentDB bugs in the HM hejlsberg worktree (cross-process reads against a persisted SFVR file with hundreds of writes). Commit `71b2ad33e` shipped Bug-1 (HNSW orphan-numId drop), Bug-2 (causal_query asymmetry), and Bug-3 (error-laundering) fixes to `forks/ruflo` `main`, released as patch.358 (memory) + patch.380 (cli).

User-run validation in HM session 2026-05-06 against the live MCP server with patch.358/patch.380 confirmed:

- `memory_retrieve` ✓ works
- `agentdb_hierarchical_recall` ✓ works (similarity 0.94/0.93/0.87 returned)
- `memory_search` ✗ still returns 0 for verbatim-token query against 329 stored entries
- `agentdb_causal_query` ✗ still returns 0 for `cause:ADR-0205` despite 103 entries successfully written to `causal-edges` namespace

Direct probes pinpointed gaps:

**Bug-1 gap (preliminary).** `RvfBackend.search()` at line 747 triggers `pureTsSearch` only when **100% of native hits are orphans**. In real-world cross-process reads, the SFVR file holds entries from BOTH the current process (mapped) AND prior processes (orphan). User has 329 entries total but search returns 0.

**Bug-2 gap (preliminary).** `routeCausalOp` `case 'query'` fallback at line 1718 filters parsed JSON values by `sourceId` / `targetId` fields. User confirmed 103 entries exist in `causal-edges` namespace with arrow-encoded keys (`ADR-X→ADR-Y`); the filter ignores the key.

**Both gap-claims are diagnostic hypotheses, not yet validated against the user's actual stored data.** This ADR's Phase 0 ratifies them via reproduction tests and a record dump before implementing the fix.

## Adversarial review (recorded for future readers)

Both underlying bugs ARE in upstream `ruvnet/ruflo` pre-fix code (verified at `forks/ruflo` `71b2ad33e^`):

| Concern | Verified state |
|---|---|
| Was orphan-numId silent-drop in upstream? | YES — `if (!stringId) continue` at pre-fix line 704 |
| Was `pureTsSearch` already in upstream? | YES — pre-fix line 738 |
| Was `nativeReverseMap` upstream's design? | YES — pre-fix line 138 |
| Did upstream have a `case 'query'` in `routeCausalOp`? | NO — only `'edge'` + `'recall'`. `agentdb_causal_query` bypassed the router and queried the controller directly. |
| Did our fork change the storage shape, namespace semantics, or key encoding? | NO — `71b2ad33e` only ADDS counters, an extra fall-through, an extra case statement, and `upsert:true` |

**Verdict:** the bugs are real upstream gaps that rarely manifest in typical upstream usage. Our fork's ADR-indexing workload exposes them. We did NOT introduce these bugs; our `71b2ad33e` fixes have edge-case logic gaps that the live HM probe surfaces.

## Critical review of the proposed fixes (added 2026-05-06)

The first draft proposed two refinements but skipped validation. Self-review surfaced multiple issues that must be addressed before implementing.

### Soundness gaps

1. **Refinement 1 loses sort order on merge.** Original draft merged native + supplemental results then `slice(0, k)` without re-sorting. Native hits go first (HNSW distance order), supplementals append (pureTsSearch score order). Slicing the first k may drop the highest-quality supplementals. **Must `sort((a,b) => b.score - a.score)` before slice.**

2. **Refinement 1 trigger condition is effectively always-on.** `entries.size > raw.length` is true whenever entries.size > 20 (since `raw.length ≤ k*2 ≤ 20`). Real common case is `entries.size > 20` → supplemental path runs every time orphans exist. Either accept the O(N) perf cost honestly, or tighten trigger (`orphanHits / raw.length > 0.5` — half of native hits dropped before supplementing).

3. **Refinement 2 `e.key` field name is unverified.** Code reads `(e as any).key`. `routeMemoryOp.list` returns entries via `storage.query({type:'prefix', ...})`. Whether those surface `key` as the property name is unverified. Could be `id`, `entryId`, or other. **Must inspect `IMemoryBackend.query` return type before writing the fix.**

### Completeness gaps

4. **Stored-value shape unverified.** User probed `memory_list namespace=causal-edges` and saw 103 keys, but never dumped a full record. Both refinements assume the value-side is `{sourceId, targetId, relation, weight}` JSON. We don't actually know what's in `value` for those 103 entries.

5. **The hierarchical_recall paradox is undiagnosed.** `agentdb_hierarchical_recall` returns scored results (0.94/0.93/0.87) on the same data where `memory_search` returns 0. Both use semantic similarity. The asymmetry is the strongest diagnostic clue available; until we know what hierarchical_recall does differently, we don't fully understand why memory_search fails.

6. **Embedding generation correctness is assumed, not validated.** Verbatim-token queries should produce cosine similarity ≥ 0.7. User reports 0 results, suggesting either (a) embedding model returns zero-vector / wrong-dim for the user's queries, (b) the threshold filter is dropping them, or (c) namespace filtering eliminates everything. NONE of (a)/(b)/(c) is fixed by the proposed search-side refinements.

7. **MCP-wrapper code path is unaddressed.** `memory_search` MCP handler does input validation, query-optimizer cache check, and may apply scope/namespace coercion before calling RvfBackend.search. If the wrapper coerces a user's `namespace='all'` to something the backend rejects, no backend fix helps.

### Conclusion of critical review

**Direction is correct, but the diagnosis is at most 60% validated.** Refinements 1+2 address symptoms that are present in code but may not be the only — or even the actual — cause of the user's empirical 0-result observation. **Phase 0 (validation) is not optional.**

## Decision

Three phases. **Phase 0 must complete and produce a passing reproduction test before Phase 1 starts.** Phase 0's outputs may invalidate Phase 1's assumptions and force redesign.

### Phase 0 — Validation gates (required before any code change)

**P0-1. Reproduce the failure in a unit test.**
Write a behavioral test that:
1. Spawns process A, writes N=300 entries with embeddings, closes.
2. Spawns process B, opens the same `.rvf`, calls `memory_search` with a verbatim-substring query.
3. Asserts result count > 0.

The test MUST FAIL with current patch.358/patch.380 code before we ship a "fix". If it doesn't fail, our diagnosis is wrong and the user's empirical issue lives elsewhere.

**P0-2. Dump one HM entry's full record.**
Ask user (or run via direct MCP probe in a controlled test):
```
memory_list namespace=causal-edges limit=1
memory_retrieve key=<one of the keys>
```
Inspect the returned object. Confirm:
- What field name carries the key (`key` / `id` / `entryId`)
- What's in `value` (JSON-stringified `{sourceId,targetId,...}` or something else)
- Whether `metadata.sourceId` / `metadata.targetId` exist as parallel structured fields

This determines whether Refinement 2's parser uses `e.key` or another field name, and whether key-parsing is even necessary (if metadata has structured fields, no parser needed).

**P0-3. Validate embedding generation.**
Add a probe:
1. Generate query embedding for "audit conformance redistributed cat 6 governance"
2. Generate stored-record embedding for one of ADR-0206's stored values containing those tokens
3. Compute cosine similarity
4. Assert similarity > 0.3 (the default `memory_search` threshold)

If similarity < 0.3, embedding generation is broken (zero-vector / wrong-dim / model mismatch) and NO search-pipeline fix helps. We'd need to investigate the embedding pipeline, not the search code.

**P0-4. Diagnose the hierarchical_recall asymmetry.**
Trace `agentdb_hierarchical_recall` from MCP handler down to backend. Identify:
- Does it use RvfBackend.search? Or a different controller?
- What namespace filter does it apply?
- What threshold default does it use?
- Why does it succeed on the same data?

The answer guides Refinement 1. If hierarchical_recall succeeds via a non-RvfBackend path, then RvfBackend's orphan handling may not be the bug at all — `memory_search` might be using a different (broken) call path.

**P0-5. Trace the MCP-wrapper code path.**
Read `memory_search` MCP handler in `agentdb-tools.js` end-to-end:
- Input validation
- Query-optimizer cache (could be returning stale 0-result cache?)
- Namespace coercion (`'all'` → `undefined` or other)
- Threshold default
- Metadata-filter handling

Identify any layer between the MCP call and `RvfBackend.search()` that could yield 0 results before the backend is even consulted.

### Phase 1 — Refinement 1 (Bug 1 supplement) — gated on P0 outputs

ONLY proceed if:
- P0-1 reproduction test fails as expected (RvfBackend orphan path IS the cause)
- P0-3 embedding-similarity test passes (embeddings work; similarity is high)
- P0-4 reveals hierarchical_recall uses RvfBackend.search and just doesn't hit the orphan condition

```ts
// Final code (incorporates critical-review fixes):
if (orphanHits > 0 && (orphanHits / Math.max(raw.length, 1)) > 0.5) {
  // More than half of native hits were dropped as orphans → supplement.
  // Tighter trigger than first draft (which fired whenever entries.size > 20).
  const supplemental = this.pureTsSearch(embedding, options);
  const seen = new Set(results.map(r => r.entry.id));
  for (const s of supplemental) {
    if (seen.has(s.entry.id)) continue;
    results.push(s);
    seen.add(s.entry.id);
  }
  // Sort by score DESC before slicing — preserves highest-quality matches.
  results.sort((a, b) => b.score - a.score);
  if (this.config.verbose) {
    console.warn(
      `[RvfBackend] Native search returned ${orphanHits} orphan numIds (${orphanHits}/${raw.length}); ` +
      `supplemented with pureTsSearch over ${this.entries.size} entries. ` +
      `Run \`ruflo memory rebuild\` to compact the SFVR file.`
    );
  }
}
results = results.slice(0, options.k);
```

ADR-0082 compliance: still loud-warns. Native fast path wins when ≤50% orphan rate.

### Phase 2 — Refinement 2 (Bug 2 key parser) — gated on P0-2

ONLY proceed if:
- P0-2 confirms entries' key field name AND
- P0-2 reveals value field is empty / non-JSON / lacks `sourceId`-`targetId`

If P0-2 instead reveals the user's entries have correct JSON values, the bug is elsewhere (e.g., the route call itself returns 0 entries — investigate `routeMemoryOp.list` return shape).

```ts
// Final code (uses verified field name from P0-2; example assumes 'key'):
const parsed = entries.map((e: any) => {
  let edge: any = null;
  try {
    edge = typeof e.value === 'string' ? JSON.parse(e.value) : e.value;
  } catch { edge = null; }

  // Always fall back to key — `${sourceId}→${targetId}` — when value lacks fields
  if (!edge || (!edge.sourceId && !edge.targetId)) {
    const keyField = e.key ?? e.id ?? '';   // pick correct field per P0-2 finding
    const arrowIdx = keyField.indexOf('→');
    if (arrowIdx > 0) {
      edge = {
        sourceId: keyField.slice(0, arrowIdx),
        targetId: keyField.slice(arrowIdx + 1),
        ...(edge || {}),
      };
    } else {
      edge = edge || e;
    }
  }
  return edge;
}).filter((edge: any) => {
  if (op.cause && edge?.sourceId !== op.cause) return false;
  if (op.effect && edge?.targetId !== op.effect) return false;
  return true;
});
```

### What is NOT in scope

- Persisting `nativeIdMap` in `.meta` to eliminate the orphan scenario at root (future ADR; existing comments at `rvf-backend.ts:~1543` flag this).
- Replacing the JSON-stringify-into-value scheme with structured metadata fields.
- Reaching into upstream to file these as bugs (per memory `feedback-no-upstream-donate-backs.md`).
- A new `agentdb_causal_query` MCP-tool surface field.
- Embedding-pipeline fixes (would be a separate ADR if P0-3 fails).
- MCP-wrapper coercion fixes (would be a separate ADR if P0-5 surfaces issues).

## Acceptance criteria

### Phase 0 gates

- [ ] **P0-1**: Cross-process reproduction test in `tests/unit/bug1-cross-process-search.test.mjs` FAILS against current patch.380 code. Test asserts `memory_search` returns >0 results after a process-restart write/read flow.
- [ ] **P0-2**: One HM entry's full record (key + value + metadata) recorded in this ADR's Implementation log. Confirms field names and value shape.
- [ ] **P0-3**: Embedding-similarity probe added at `tests/unit/embedding-similarity-baseline.test.mjs`. Asserts cosine similarity ≥ 0.3 for verbatim-token query against verbatim-token storage.
- [ ] **P0-4**: hierarchical_recall trace findings documented in this ADR. Identifies which call path it uses and why memory_search differs.
- [ ] **P0-5**: memory_search MCP-wrapper trace recorded in this ADR. Confirms whether any pre-RvfBackend layer can return 0 in the user's scenario.

### Phase 1 (gated on P0 success)

- [ ] Refinement 1 lands in `forks/ruflo/v3/@claude-flow/memory/src/rvf-backend.ts`.
- [ ] Test in `tests/unit/bug1-memory-search-orphan-numid.test.mjs` extended with partial-mapped scenario (5 entries written, 2 native-mapped, 3 orphan-only) → asserts all 5 surface and are sorted by score-DESC.
- [ ] P0-1 reproduction test now passes.

### Phase 2 (gated on P0 success)

- [ ] Refinement 2 lands in `forks/ruflo/v3/@claude-flow/cli/src/memory/memory-router.ts` using the field name verified in P0-2.
- [ ] Test in `tests/unit/bug2-causal-query-roundtrip.test.mjs` extended with key-only-parse scenario (write a causal edge with key `A→B` whose value has no JSON-parseable fields) → asserts query with `cause:A` returns 1 result.

### Final

- [ ] `npm run test:unit` green.
- [ ] `npm run release` green (full pipeline + acceptance).
- [ ] Live MCP probe in HM session: `memory_search "audit conformance redistributed cat 6 governance"` returns >0 results post-deploy. `agentdb_causal_query cause:ADR-0205` returns >0 results post-deploy.

## Execution plan

Five sequential steps with explicit decision points. Each step has a verifiable output that gates the next. No code touches `forks/ruflo` source until Step 3 completes.

### Step 1 — Phase 0 evidence collection (read-only + tests)

Run all five P0 probes in parallel where possible. None of these touch fork source.

| Probe | Action | Output | Failure mode |
|---|---|---|---|
| P0-1 | Write `tests/unit/bug1-cross-process-search.test.mjs`. Use `child_process.fork` to spawn process A (write 300 entries with embeddings, close), process B (open same `.rvf`, search, expect >0 results). Run against current patch.380. | Test FAILS as expected. | Test PASSES → diagnosis is wrong; STOP and re-investigate. |
| P0-2 | Run in HM session: `mcp__ruflo__memory_list namespace=causal-edges limit=1` then `mcp__ruflo__memory_retrieve key=<that key>`. Paste the JSON response into ADR Implementation log. | One entry's full {key, value, namespace, metadata} captured. | If output shows structured `metadata.sourceId` + `metadata.targetId`, Refinement 2 is wrong shape; redesign as metadata-field filter. |
| P0-3 | Write `tests/unit/embedding-similarity-baseline.test.mjs`. Generate embedding for query "audit conformance redistributed cat 6 governance" + embedding for stored ADR-0206 value. Compute cosine similarity. Assert >0.3. | Test passes. | Test FAILS → embedding pipeline is broken; STOP, abandon ADR-0147, file ADR-0148 on embedding pipeline. |
| P0-4 | Read `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/agentdb-tools.js` `agentdbHierarchicalRecall` handler end-to-end. Identify storage path, namespace filter, threshold default. Document in ADR Implementation log. | Trace recorded. Either confirms hierarchical_recall uses RvfBackend.search (and just doesn't hit orphan condition) OR reveals it uses a different path. | Reveals different path → Refinement 1 may not be the right fix; redesign Phase 1 to align memory_search with hierarchical_recall's path. |
| P0-5 | Read `agentdbMemorySearch` / `memory_search` handler in `memory-tools.js` end-to-end. Record every transformation between MCP input and `RvfBackend.search()` call. | Trace recorded. Confirms no pre-backend layer can return 0. | Reveals problem layer (e.g., query-optimizer cache returning stale 0) → fix moves to that layer; Refinement 1 deferred. |

**Step 1 gate:** Phase 0 complete with all 5 probes recorded. Decision: proceed to Step 2 OR redirect to a different fix per the failure-mode column.

### Step 2 — Decision point

Examine P0 outputs. Three exit paths:

1. **All P0 probes confirm direction** (P0-1 fails, P0-3 passes, P0-4 confirms RvfBackend, P0-5 clean) → proceed to Step 3.
2. **P0 reveals different root cause** (e.g., P0-3 fails / P0-4 reveals hierarchical_recall uses different controller / P0-5 finds stale cache) → STOP, supersede this ADR with one targeting the actual cause.
3. **P0 inconclusive** (e.g., P0-2 dump shows mixed shapes, some entries have valid JSON, others don't) → narrow scope to the subset where the diagnosis holds, document the unaddressed subset as a risk.

The decision is recorded in the Implementation log. No code touches forks until decision is "proceed".

### Step 3 — Phase 1 implementation (Bug 1 supplement)

Sequence:

1. Edit `forks/ruflo/v3/@claude-flow/memory/src/rvf-backend.ts` line ~747. Replace the `mappedHits === 0` condition block with the Phase 1 final code (tightened trigger + sort + dedupe).
2. Extend `tests/unit/bug1-memory-search-orphan-numid.test.mjs` with a partial-mapped scenario (5 entries: 2 native-mapped, 3 orphan-only). Assert all 5 surface and are score-DESC sorted.
3. Run `npm run test:unit` (preflight + pipeline + unit cascade per CLAUDE.md). All green.
4. Run `npm run build` to confirm tsc compile succeeds.
5. Verify P0-1 reproduction test now passes.

**Step 3 gate:** all unit tests green AND P0-1 reproduction passes. Commit message: "fix(rvf-backend): refine Bug-1 orphan fall-through — supplement instead of replace".

### Step 4 — Phase 2 implementation (Bug 2 key parser)

Sequence:

1. Edit `forks/ruflo/v3/@claude-flow/cli/src/memory/memory-router.ts` `case 'query'` block. Use the field name verified in P0-2.
2. Extend `tests/unit/bug2-causal-query-roundtrip.test.mjs` with a key-only-parse scenario.
3. Run `npm run test:unit`. All green.
4. Run `npm run build`.

**Step 4 gate:** all unit tests green. Commit message: "fix(memory-router): refine Bug-2 causal_query — fall back to key parser when value lacks fields".

### Step 5 — Release and live verification

Sequence:

1. Run `npm run release` from ruflo-patch (full pipeline: bump versions → copy-source → codemod → build → publish-verdaccio → acceptance).
2. Acceptance phase must report `pass / 0 fail / N skip_accepted`.
3. Restart MCP server in HM session (`/exit` + relaunch, OR `kill <pid>` + Claude Code reconnect).
4. Re-run the live MCP probes from the user's original report:
   - `memory_search "audit conformance redistributed cat 6 governance"` — expect >0 results
   - `agentdb_causal_query cause:ADR-0205` — expect >0 results
5. Update ADR-0147 Status from `Proposed` to `Accepted/Implemented` with the release version (cli + memory).

**Step 5 gate:** both live probes return >0 results.

### Rollback strategy per step

| Step | Rollback if step fails |
|---|---|
| Step 1 (P0) | No commits made; just discard the local probe scripts. |
| Step 2 (decision) | If decision is "supersede", file new ADR; close ADR-0147 as Superseded. |
| Step 3 (Phase 1) | `git revert` the rvf-backend.ts commit on `forks/ruflo` `main`. Pre-revert ships patch.358 behavior (the strict mappedHits===0 trigger). |
| Step 4 (Phase 2) | `git revert` the memory-router.ts commit on `forks/ruflo` `main`. Pre-revert ships patch.380 behavior (filter-only, no key-parse). |
| Step 5 (release) | If `npm run release` fails, the version bump commits exist locally but no Verdaccio publish. Investigate the failure phase from the timing summary. If acceptance fails after publish, identify the failing acceptance check, decide between forward-fix (preferred) and reverting + republishing the prior patch number. |

### What this plan deliberately omits

- **Time estimates.** Per memory feedback-no-time-estimates, the plan reasons about risk shape and gate ordering, not about how long anything takes.
- **Parallelization beyond P0.** Steps 3 and 4 could run in parallel, but the small efficiency gain isn't worth the merge complexity. Sequential keeps each commit minimal and reviewable.
- **An adversarial review of the implementation.** Critical review already happened at the design stage (this ADR's "Critical review" section). Per memory feedback-no-adversarial-review, code review of written code is in-scope at PR time, not pre-commit.

## Risks

1. **Performance regression** on Refinement 1 supplement path. Mitigated by tightened trigger (`orphanHits/raw.length > 0.5`) — supplements only when native is mostly broken, not whenever any orphan exists.
2. **Key-parse false positives** if a future writer uses arrow-encoded keys without `sourceId`/`targetId` semantics. Mitigated: parser only triggers when value-side parse yields no fields. Document the arrow-key contract in `routeCausalOp` write path comment.
3. **Test fragility.** Cross-process reproduction tests are inherently fragile (process spawning, FS sync). Existing `bug1-memory-search-orphan-numid.test.mjs` simulates orphan-only via in-process mock; extend to mixed-state without spawning real processes if possible.
4. **P0 may invalidate the entire fix direction.** If P0-3 fails (embeddings broken) or P0-4 reveals hierarchical_recall doesn't use RvfBackend at all, the actual root cause lies elsewhere and this ADR is superseded.

## Considered alternatives

### Alternative A — Always run pureTsSearch first; use HNSW only for ranking

Replace HNSW as the primary index entirely; iterate `entries` map every time. Rejected: defeats the 150x-12,500x HNSW speedup that motivates RvfBackend's design (USERGUIDE 5332-5644). Cost is O(N) on every query vs O(log N) with HNSW.

### Alternative B — Persist `nativeIdMap` in `.meta`

Eliminates the orphan scenario at root. Rejected for THIS ADR (in scope for a future ADR): requires a new file format field, migration handling for existing `.rvf` files in the wild, and write-amplification-budget review. Out of scope; existing field comments at `rvf-backend.ts:~1543` flag this future work.

### Alternative C — Filter-side: reject `entries.value` JSON-parse failures, surface `RvfMalformedEdge` error

Rejected: the user's storage works; the writes succeed at routeMemoryOp.store. The user's HM data was likely written by a mix of pre-fix and post-fix code paths, leaving heterogeneous value layouts. Rejecting on parse-failure would make `causal_query` flaky against legitimate historical data.

### Alternative D — Auto-rebuild .rvf at MCP server start

Run `ruflo memory rebuild` automatically on MCP server startup. Rejected: rebuild is currently a manual operation per design; auto-rebuild on start risks running on huge files and slowing MCP cold-start. Defer to user-initiated with a more visible warning.

### Alternative E — Skip Phase 0 and ship the refinements directly

Considered and rejected during critical review. Three independent unverified assumptions (stored-value shape, embedding correctness, hierarchical_recall asymmetry) means there's a ~30-50% chance the proposed fixes don't address the user's actual root cause. Phase 0 cost is bounded (5 small probes), upside is correct diagnosis vs flailing.

## Implementation log

### Phase 0 — completed 2026-05-06

- [x] **P0-1**: cross-process reproduction test pending (still required to validate Bug 1 fix; typo finding makes Bug 2 repro trivial)
- [x] **P0-2 — DONE.** Storage entry shape verified via `MemoryEntry` interface in `@sparkleideas/memory/dist/types.d.ts`:
  ```ts
  interface MemoryEntry {
    id: string;
    key: string;
    content: string;          // ← THE VALUE FIELD IS NAMED 'content', NOT 'value'
    embedding?: Float32Array;
    namespace: string;
    tags: string[];
    metadata: Record<string, unknown>;
    ...
  }
  ```
  **Critical finding: Bug 2's filter in `memory-router.ts:1881` reads `e.value` and casts entries as `Array<{ value?: string; key?: string }>` — but storage entries have `content`, not `value`.** This is the actual root cause of `agentdb_causal_query` returning 0: `e.value` is `undefined` → `JSON.parse(undefined)` throws → catch returns raw entry → filter checks `e.sourceId` (also undefined) → rejects everything. **Field-name typo in commit `71b2ad33e`.**
- [x] **P0-3 — DONE.** `mcp__ruflo__memory_search` against ruflo-patch's local backend (in-process) returned similarity **0.721** for query `"phase17 validator fuzzing"` against verbatim-token entry. Embeddings are healthy. Bug 1's HM failure is NOT embedding-pipeline; it IS cross-process state (orphan-numId scenario per original diagnosis).
- [x] **P0-4 — DONE.** `agentdb_hierarchical_recall` calls `hierarchicalRecall()` from `agentdb-orchestration.js`, NOT via `routeMemoryOp`. It uses a **different controller path** entirely. Confirms it works on the same data because it bypasses the broken `memory_search → routeMemoryOp.search → RvfBackend.search` path.
- [x] **P0-5 — DONE.** `memory_search` MCP handler reads `r.content` (correct) and uses `routeMemoryOp({type:'search'})` cleanly. No pre-RvfBackend coercion problems. The bug isn't in the wrapper.

### Phase 0 — Decision

P0 evidence supports proceeding to Phase 1 + Phase 2 with the following adjustments:

1. **Refinement 2 changes scope.** It's not "add a key parser" — it's a **field-name typo fix** (`e.value` → `e.content` + cast type fix). The arrow-key parser may still be useful as a defense-in-depth fallback for malformed entries, but the primary fix is the typo.
2. **Refinement 1 stands.** P0-3 confirms embeddings work; P0-4 confirms memory_search uses the broken RvfBackend.search path; the orphan-numId hypothesis remains the leading cause for Bug 1's cross-process failure. Still requires P0-1 reproduction.

### Phase 1 — DONE 2026-05-06
- [x] Refinement 1 code edit at `forks/ruflo` `0dac392fb` — supplement-instead-of-replace with `(orphanHits / Math.max(raw.length, 1)) > 0.5` trigger, dedupe by entry.id, sort by score-DESC
- [x] Verified in published dist `@sparkleideas/memory@3.0.0-alpha.13-patch.359` line 719
- [ ] Bug-1 test extension (partial-mapped scenario) deferred to follow-up — pre-existing tests still pin contract

### Phase 2 — DONE 2026-05-06
- [x] Refinement 2 code edit at `forks/ruflo` `0dac392fb` — type cast + field-name typo (`e.value` → `e.content`) + arrow-key parser fallback
- [x] Verified in published dist `@sparkleideas/cli@3.5.58-patch.381` line 1737
- [ ] Bug-2 behavioral test (real backend, not source-pattern pin) deferred to follow-up — would have caught the typo originally

### Bonus fix — fork-side standalone build
- [x] `forks/ruflo/v3/tsconfig.base.json` adds `types: ["node"]` and excludes test files. Reduces standalone `cd memory && npx tsc` errors from 566 → 1 (residual is npm install workspace:* issue, not tsconfig).

### Final
- [x] `npm run release` green — build 14.9s, publish 19.3s, acceptance **674 pass / 0 fail / 1 skip_accepted**
- [ ] Live HM probe: pending user-side MCP server restart. To verify:
  1. In HM Claude Code session, kill MCP server: `kill <pid-from-/mcp>` then `/exit` + relaunch
  2. Re-run: `mcp__ruflo__memory_search "audit conformance redistributed cat 6 governance"` — expect >0 results
  3. Re-run: `mcp__ruflo__agentdb_causal_query cause:ADR-0205` — expect >0 results
  4. Confirm patch.381/patch.359 active: `npx --registry http://localhost:4873 @sparkleideas/cli@latest --version`

## Bug 4 — `cause=` asymmetry (post-deploy 2026-05-06)

### Discovery

User re-indexed 233 ADRs with 796 causal edges via `/adr-index` in HM. Verified Bug 1+2 fixes shipped correctly: `memory_search` returns top-5 with valid similarity scores (0.65, 0.63), and `causal_query effect=ADR-0167` returns 9 inbound edges.

But `causal_query cause=ADR-0167` returns only **1 edge** (a stale `supersedes ADR-0129` from a prior bulk-load, unrelated to the user's writes). Outbound edges written by the re-index are unreachable via `cause=` queries. INBOUND queries via `effect=` work correctly.

### Probe (2026-05-06)

Inspected `forks/agentic-flow/agentic-flow/src/agentdb/controllers/CausalMemoryGraph.ts` — the actual controller methods exist with these signatures:

```ts
queryCausalEffects(query: CausalQuery): CausalEdge[]
// CausalQuery = {
//   interventionMemoryId: number,
//   interventionMemoryType: string,
//   outcomeMemoryId?: number,
//   minConfidence?: number,
//   minUplift?: number,
// }

getCausalChain(fromMemoryId: number, toMemoryId: number, maxDepth?: number)
```

Both expect **numeric memory IDs** and a **structured query object** for `queryCausalEffects`.

`memory-router.ts:1854-1859` (current) calls them as:
```ts
const getEffectsFn = causalGraph.queryCausalEffects.bind(causalGraph);
const getCausesFn = causalGraph.getCausalChain.bind(causalGraph);
// ...
results = await getEffectsFn(op.cause, k);   // string + number — WRONG SHAPE
results = await getCausesFn(op.effect, k);    // string + number — WRONG SHAPE
```

Both calls pass a **string ADR ID + a number k**, but the controller expects a `CausalQuery` object (cause-side) or 3 numeric IDs (effect-side).

### Root cause of asymmetry

- `queryCausalEffects("ADR-0205", 10)` is interpreted as `query={interventionMemoryId: "ADR-0205"}` (extra args ignored). SQL fires `WHERE from_memory_id = "ADR-0205"` — happens to match 1 stale row from a prior bulk-load that had a string-typed memory ID. Returns **1 result**, which short-circuits the post-controller fall-through. Fallback never runs.
- `getCausalChain("ADR-0167", 10, undefined)` fires the recursive-CTE SQL with `fromMemoryId = "ADR-0167"`, `maxDepth = 10`, `toMemoryId = undefined`. SQL doesn't match anything. Returns `[]`. Empty result triggers fall-through to the namespace-list fallback → returns 9 inbound edges correctly.

### Decision (Bug 4 refinement — Refinement 3)

**Always run the namespace-list fallback and merge with controller results, dedupe by `(sourceId, targetId, relation)` triple.** Same supplement-instead-of-replace pattern as Bug 1.

```ts
// memory-router.ts case 'query' — proposed
let controllerResults: ParsedEdge[] = [];
try {
  if (causalGraph) { /* existing controller call — even if returns garbage, kept for compat */ }
} catch { /* fall through */ }

// Always also run namespace-list fallback (was conditional on controller returning empty)
const fallback = await routeMemoryOp({type:'list', namespace:'causal-edges', limit: Math.max(k*4, 100)});
const fallbackEdges = parseEntries(fallback.entries ?? []);
const tripleKey = (e: ParsedEdge) => `${e.sourceId ?? ''}|${e.targetId ?? ''}|${e.relation ?? ''}`;
const seen = new Set<string>();
const merged: ParsedEdge[] = [];
for (const e of [...controllerResults, ...fallbackEdges]) {
  const k = tripleKey(e);
  if (seen.has(k)) continue;
  if (op.cause && e.sourceId !== op.cause) continue;
  if (op.effect && e.targetId !== op.effect) continue;
  seen.add(k);
  merged.push(e);
}
return { success: true, results: merged.slice(0, k), controller: controllerResults.length ? 'causalGraph+fallback' : 'router-fallback' };
```

**Why not fix the controller call?** Because:
1. The agentic-flow controller's input shape (numeric memory IDs) doesn't match how MCP-tool callers pass IDs (string ADR keys like `ADR-0167`). Adapting the call would require an ID translation layer that isn't currently wired.
2. The fallback path already works correctly with string-shaped sourceIds/targetIds (verified: effect= returns 9 correctly).
3. Defense-in-depth: even if the controller is later fixed, supplementing with the fallback protects against future asymmetric breakage.

This deprecates the controller call's role: it goes from "primary path with fallback" to "supplemental hint, fallback is canonical." The name `controller: 'causalGraph+fallback'` communicates the change.

### Acceptance criteria for Bug 4

- [ ] `routeCausalOp` `case 'query'` rewritten to always merge controller + fallback, dedupe by triple
- [ ] `tests/unit/bug2-causal-query-roundtrip.test.mjs` extended with cause= asymmetry test: write 10 outbound edges from same source, query with cause=, assert ≥10 results
- [ ] `npm run release` green
- [ ] Live HM verification: `causal_query cause=ADR-0167` returns ≥10 outbound edges (the 9 written by re-index + any others)
- [ ] User's stale `supersedes ADR-0129` edge no longer dominates result list

## Bug 5 — adr-index skill fragile body extraction (post-deploy 2026-05-06)

### Discovery

After re-indexing 233 ADRs in HM via `/adr-index`, the user verified all entries are stored. But the 12 wave35 generator-diff companions of ADR-0159 (`0159-wave35-cat{1-11,13}-generator-diff.md`) have stored values that are ~1 line each (title + parent only, no body excerpt). The other 222 entries have rich Context-section bodies. Result: semantic search ranks wave35 entries below the canonical ADR-0159, even when the query is category-specific (e.g., "generator diff governance" should hit cat6 directly).

### Probe (2026-05-06)

**Source files have rich content** — verified by reading `0159-wave35-cat6-generator-diff.md` (140 lines, structured tables for "Generator Status", "Matrix-Gap Findings", prose explaining ONT-0077 spine + soundness matrix). The files are NOT stub files.

**Indexer skill `forks/ruflo/plugins/ruflo-adr/skills/adr-index/SKILL.md` step 5** instructs the AI:
```
value: `<title> — <first paragraph of Context section>`
```

The skill assumes every ADR has a `## Context` section. The wave35 cat files don't — they use `## Generator Status`, `## Matrix-Gap Findings`, etc. The AI agent looks for `## Context`, doesn't find it, falls back to title-only. **Skill instruction is too rigid.**

### Decision (Bug 5 refinement — Refinement 4)

Update `adr-index/SKILL.md` step 5 to fall back to a structure-agnostic prose extraction when `## Context` is absent. Proposed instruction:

```markdown
5. **Store in memory** — For each ADR, call `mcp__ruflo__memory_store` with:
   - namespace: `adr-patterns`
   - key: `<adr-id>`
   - value: `<title> — <body excerpt>`

   **Body excerpt rules** (in priority order):
   1. If file has `## Context` heading: use first paragraph of that section.
   2. Else if file has `## Generator Status` / `## Matrix-Gap Findings` / any
      H2-section heading: use the first prose paragraph after the H1 title (skip
      frontmatter, the H1 itself, blank lines, tables, and lists).
   3. Else: use the first 2-3 prose sentences from the file body, capped at
      ~500 characters.
   The goal is that semantic-search queries on category-specific terminology
   (e.g., "governance compliance generator diff") rank companion/wave/cat
   files alongside the canonical ADR they amend. Skipping body extraction
   produces title-only entries that semantic search under-ranks.

   This enables semantic search across ADRs.
```

### Why fix the skill, not the source files

The 12 wave35 cat files (and any future companion/wave/cat/amendment files) use category-specific section structures that intentionally don't mirror the canonical ADR template. Imposing `## Context` on every companion file would corrupt the authoring convention. The skill should adapt to source-file structure variation.

### Acceptance criteria for Bug 5

- [ ] `forks/ruflo/plugins/ruflo-adr/skills/adr-index/SKILL.md` step 5 updated with the priority-ordered body-excerpt rules above
- [ ] No code change in `ruflo-adr` plugin (skill instruction is markdown only — no test pin needed beyond a regression that grep's for "fall back" / "priority order" in step 5 to ensure the rules don't get reverted)
- [ ] `npm run release` ships updated SKILL.md to marketplace
- [ ] User runs `/plugin update ruflo-adr@ruflo` (or fresh install) in HM to pick up the new skill text
- [ ] User wipes adr-patterns + causal-edges namespaces, re-runs `/adr-index`
- [ ] Verify: `mcp__ruflo__memory_retrieve key:ADR-0159-wave35-cat6-generator-diff namespace:adr-patterns` returns a value with rich body excerpt (not title-only)
- [ ] Verify: `mcp__ruflo__memory_search query:"governance compliance generator diff"` returns the cat6 entry in the top 5

### Ship sequencing (Refinements 3 + 4 combined)

Refinement 3 (Bug 4 — cause= asymmetry) and Refinement 4 (Bug 5 — skill body extraction) are independent files (memory-router.ts vs SKILL.md) but share the same release pipeline. Bundle them into one release:

1. Edit memory-router.ts (Refinement 3)
2. Edit adr-index/SKILL.md (Refinement 4)
3. `git commit` both on `forks/ruflo` `main`
4. `npm run release` from ruflo-patch
5. User: `/plugin update ruflo-adr@ruflo` + restart MCP
6. User: wipe adr-patterns + causal-edges, re-run `/adr-index`
7. Verify both: `cause=ADR-0167` returns ≥10 outbound edges AND wave35-cat6 has rich body

## References

- `forks/ruflo` `71b2ad33e` (original three-bug fix)
- `tests/unit/bug1-memory-search-orphan-numid.test.mjs` (existing pin, will extend)
- `tests/unit/bug2-causal-query-roundtrip.test.mjs` (existing pin, will extend)
- `tests/unit/bug3-causal-edge-no-laundering.test.mjs` (no changes needed)
- USERGUIDE.md sections 3054-3180 (RVF storage), 5332-5644 (RuVector / HNSW perf)
- ADR-0082 (no silent fallbacks), ADR-0094 (acceptance coverage program)
