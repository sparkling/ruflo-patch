# 06 — Graph / Federation / Sync controllers soundness audit

## Summary

- Controllers audited: 10
  - `SyncCoordinator.ts` (980 LOC)
  - `CausalMemoryGraph.ts` (879 LOC)
  - `CausalRecall.ts` (505 LOC)
  - `QUICClient.ts` (625 LOC)
  - `QUICServer.ts` (550 LOC)
  - `QUICConnection.ts` (711 LOC — real Transport + simulation layer)
  - `QUICConnectionPool.ts` (335 LOC — unwired)
  - `QUICStreamManager.ts` (386 LOC — unwired)
  - `MincutService.ts` (434 LOC)
  - `SparsificationService.ts` (492 LOC)
  - Plus 3 cross-ref files audited: `GraphDatabaseAdapter.ts` (481 LOC, the canonical "graphAdapter"), `backends/rvf/FederatedSessionManager.ts` (526 LOC), `services/federated-learning.ts` (436 LOC)
- Findings: 13 total / 5 critical / 6 warning / 2 note
- Soundness verdict: **FAIL**
- Completeness verdict: **FAIL**
- Bottom line: ADR-0200 is wired correctly on the public surface, ADR-0199 real transport is wired, and the graphAdapter (`GraphDatabaseAdapter`) is intact + delete-API-extended per RuVector#427. But `SyncCoordinator.resolveConflicts()` is a counting stub that never writes back a resolution (the `merge` case is a one-line comment with no logic), the rich CRDT primitives in `types/quic.ts` (G-Counter, LWW-Register, OR-Set, merge functions) are exported but **never called inside the sync path** — federation has CRDT shapes on the wire but no merge runtime, `QUICConnectionPool` and `QUICStreamManager` are unwired (marked "no production wiring" in their own headers) and operate over the simulation half of `QUICConnection` (BBR/0-RTT/migration), `services/federated-learning.ts` has zero callers in src/ (dead code), `GraphDatabaseAdapter.initialize` silently swallows a corrupt-DB error and replaces it with a fresh empty database (`db-unified.ts` doesn't catch — but the adapter itself does), the prior recon claim about `graphAdapter` init catch is **confirmed in agentic-flow's `agentdb-service.ts:832-836`** where the catch demotes graph init failure to a `console.warn` and `graphEnabled = false`, and statistics in `CausalMemoryGraph` (`tInverse` returns hardcoded 1.96 ignoring `p`/`df`; `mean([])` returns `NaN`) are stub-quality. `CausalRecall` does not walk causal edges as a graph; it only joins `causal_edges` by `from_memory_id` in a single SQL hop — multi-hop graph-walk semantics live in `CausalMemoryGraph.getCausalChain` and are not exercised by `CausalRecall.recall`.

## Findings

### F-06-001 [CRITICAL] `SyncCoordinator.resolveConflicts` is a counting stub — no actual conflict resolution

- **Location:** `forks/agentdb/src/controllers/SyncCoordinator.ts:679-705`
- **Issue:** All four `conflictStrategy` branches just increment a counter or no-op. The `merge` branch is the literal comment `// Attempt to merge (simplified)` followed by `resolved++`. The `local-wins`/`remote-wins`/`latest-wins` branches never write back to either `conflict.local` or `conflict.remote`. The returned number is reported to the caller as `conflictsResolved` in the `SyncReport`, then `applyChanges()` proceeds to `INSERT OR REPLACE` the pulled remote data unconditionally — meaning `local-wins` is silently violated and the local copy is overwritten regardless of strategy. ADR-0200's `pullOnly()` inherits the same broken `resolveConflicts` call (line 350).
- **Evidence:**
  ```ts
  // SyncCoordinator.ts:679-705
  private async resolveConflicts(conflicts: any[]): Promise<number> {
    let resolved = 0;
    for (const conflict of conflicts) {
      switch (this.config.conflictStrategy) {
        case 'local-wins':
          // Keep local version
          break;
        case 'remote-wins':
          // Keep remote version
          resolved++;
          break;
        case 'latest-wins':
          // Keep version with latest timestamp
          if (conflict.remote.ts > conflict.local.ts) {
            resolved++;
          }
          break;
        case 'merge':
          // Attempt to merge (simplified)
          resolved++;
          break;
      }
    }
    return resolved;
  }
  ```

  Note that `applyChanges(ctx, pullResult.data)` (line 160) is called with the unmodified `pullResult.data` — there is no path by which conflict resolution influences which rows reach the database.
- **Impact:** Federation is silently lossy. Two peers with diverging local state will both overwrite each other on next sync regardless of `conflictStrategy`. The `SyncReport.conflictsResolved` count is a fiction. Data-integrity boundary violation per [[feedback-no-fallbacks]].

### F-06-002 [CRITICAL] CRDT primitives in `types/quic.ts` are unwired — sync path has CRDT shapes but no CRDT merge

- **Location:**
  - `forks/agentdb/src/types/quic.ts:101-188` (G-Counter, LWW-Register, OR-Set + `SkillSync`, `CausalEdgeSync` envelopes)
  - `forks/agentdb/src/types/quic.ts:566-702` (`mergeGCounter`, `mergeLWWRegister`, `mergeORSet`, `incrementGCounter`, `updateLWWRegister`, `addToORSet`, `removeFromORSet`)
  - `forks/agentdb/src/controllers/SyncCoordinator.ts:436-674` (`pushChanges` / `pullChanges` / `applyChanges`)
- **Issue:** `grep -rn "mergeGCounter|mergeLWWRegister|mergeORSet|incrementGCounter|updateLWWRegister|addToORSet|removeFromORSet" src` returns **only their own definitions in `types/quic.ts`** — no caller anywhere in src/. The `SyncCoordinator` push/pull/apply path serialises raw episode/skill/edge rows as plain SQL records (e.g. `SELECT * FROM skills`) and applies them via `INSERT OR REPLACE` — never converting to `SkillSync` shape, never invoking the CRDT merge functions for `uses` / `successRate` / `avgReward` / `sourceEpisodes`. The `SkillSync`, `CausalEdgeSync`, `EpisodeSync` envelopes exist on the wire-type level but the SyncCoordinator runtime ignores them.
- **Evidence:**
  ```bash
  # Only definitions, no callers:
  $ grep -rn "mergeGCounter\|mergeLWWRegister\|mergeORSet" src/ | grep -v types/quic.ts
  # (empty)

  # SyncCoordinator pushes raw rows:
  # SyncCoordinator.ts:416-428
  const episodes = this.db.prepare('SELECT * FROM episodes WHERE ts > ?').all(lastEpisodeSync);
  const skills = this.db.prepare('SELECT * FROM skills WHERE ts > ?').all(lastSkillSync);
  ```
- **Impact:** Federation lacks the convergence guarantees the type system advertises. Two skills updated concurrently on two peers cannot be merged correctly — instead one is `INSERT OR REPLACE`d over the other (see F-06-001 for the broken resolver). Comments in `types/quic.ts` (`"Skill synchronization (CRDT-based)"`) are documentation drift; the runtime has no CRDT layer. Worse, the public agentdb export surface re-exports `VectorClock` + `incrementVectorClock` + `mergeVectorClocks` etc. at top level (`src/index.ts:175-188`) suggesting they are part of the federation contract — but ADR-0196's adapter on the agentic-flow side cannot rely on these for actual merge semantics.

### F-06-003 [CRITICAL] `QUICConnectionPool` + `QUICStreamManager` are unwired and operate over the simulation half of `QUICConnection`

- **Location:**
  - `forks/agentdb/src/controllers/QUICConnectionPool.ts:1` — comment `// TODO: ADR required before activation — ADR-0161 lift, no production wiring`
  - `forks/agentdb/src/controllers/QUICStreamManager.ts:1` — same comment
  - `forks/agentdb/src/controllers/QUICConnection.ts:415-711` — simulation layer (BBR / 0-RTT / migration) gated only by synthetic `sleep()` calls
  - `forks/agentdb/src/controllers/index.ts:16-17` — only `QUICServer` + `QUICClient` are exported
- **Issue:** `grep -rn "new QUICConnectionPool|new QUICStreamManager" forks/agentdb` returns zero hits anywhere in src/, tests/, or examples. Both files are explicit no-production-wiring per their own header comments. `QUICStreamManager.sendOnStream` calls `this.connection.send(data)` where `connection: QUICConnection` is the simulation class (lines 558-575) — that simulation `send()` increments synthetic packet/byte counters and sleeps for `computeBBRPacingDelay(size)` ms; it never reaches an actual transport. The real federation path goes through `QUICClient.connect()` → `createClientTransport()` → either `WebTransportClientTransport` or `Http2ClientTransport` (lines 400-413 of `QUICConnection.ts`), which are wholly separate from the `QUICConnection` simulation class.
- **Evidence:**
  ```ts
  // QUICConnection.ts:415-422 — explicit boundary
  // ============================================================================
  // QUICConnection — BBR/0-RTT/migration metadata layer (unchanged interface)
  // ============================================================================
  //
  // The simulation logic below is preserved from the previous reference
  // implementation. It tracks BBR state and metrics ON TOP of whichever real
  // transport (WebTransport / HTTP/2) is in use. The transport itself handles
  // the actual congestion control; this layer reports the agentdb-side view.

  // But QUICStreamManager.ts:159 calls into the simulation:
  const result = await this.connection.send(data);  // simulation .send

  // QUICConnectionPool.ts:278 instantiates the simulation:
  const conn = new QUICConnection(connConfig);
  await conn.connect();  // simulation .connect — fakes 0-RTT lookup
  ```
- **Impact:** A reader scanning the surface (e.g. via the docstring "QUIC Connection Pooling for AgentDB Synchronization") would reasonably conclude the connection pool is the federation backbone. It is not. The federation backbone is the `createClientTransport()`/`createServerTransport()` factories in `QUICConnection.ts:400-413`, and they are used directly by `QUICClient`/`QUICServer` without any pool or stream-manager intermediation. The pool + stream-manager files have not been deleted because their unit tests still exist (`tests/unit/quic-client.test.ts`, `tests/unit/quic-server.test.ts`) but those test the wrapper classes, not the pool/manager. Two ways to read this: either ADR-0199 superseded the need for these and they should be deleted, or they are placeholders for a future multi-stream optimisation. The `// TODO: ADR required before activation` header is ambiguous — neither path has been chosen.

### F-06-004 [CRITICAL] `services/federated-learning.ts` is dead code — zero callers, but exported as if active

- **Location:**
  - `forks/agentdb/src/services/federated-learning.ts:52-436` (`EphemeralLearningAgent`, `FederatedLearningCoordinator`, `FederatedLearningManager`)
  - `forks/agentdb/CHANGELOG.md:13-55` (advertised as active)
  - `forks/agentdb/MIGRATION-LOG.md:118` (listed as net-new in ADR-0161 3-way merge)
- **Issue:** `grep -rn "FederatedLearningManager|FederatedLearningCoordinator|EphemeralLearningAgent" src` returns **zero hits outside the defining file** — no controller wires it, no MCP tool exposes it, no test exercises it. Compare with the *other* federated path (`backends/rvf/FederatedSessionManager.ts`) which IS wired into `SelfLearningRvfBackend.ts:402` (with its own silent-catch problem — see F-06-008). The two federated paths are semantically different (this one wraps `SonaEngine` from `@ruvector/sona`; the rvf one wraps `@ruvector/ruvllm`) but only the rvf one is reachable.
- **Evidence:**
  ```bash
  # Zero callers in src/:
  $ grep -rln "FederatedLearningManager\|FederatedLearningCoordinator\|EphemeralLearningAgent" forks/agentdb/src \
      | grep -v 'services/federated-learning.ts'
  # (empty)

  # But CHANGELOG.md advertises it as active feature:
  $ grep -A1 "FederatedLearning" forks/agentdb/CHANGELOG.md | head -3
  - `FederatedLearningCoordinator`: Central aggregation with quality-weighted consolidation
  - `FederatedLearningManager`: Multi-agent coordination with automatic aggregation
  ```
- **Impact:** Per memory [[project-deprecated-controllers]] — `federatedSession + federatedLearningManager` are flagged as CAN be removed. This audit confirms `FederatedLearningManager` (+ its `Coordinator` and `EphemeralLearningAgent` siblings) is removable. The other path (`FederatedSessionManager`) is not yet removable — see F-06-008. Recommend deleting `services/federated-learning.ts` outright; nothing depends on it. Until then, the CHANGELOG and MIGRATION-LOG entries are documentation drift.

### F-06-005 [CRITICAL] `GraphDatabaseAdapter.initialize` silently replaces a corrupt DB with a fresh empty one

- **Location:** `forks/agentdb/src/backends/graph/GraphDatabaseAdapter.ts:128-144`
- **Issue:** Inside the outer try, an inner try wraps `GraphDatabase.open(this.config.storagePath)`. The inner catch body is the comment `// Database doesn't exist or is corrupt, create new one` followed by silent fall-through to `new GraphDatabase({ ... storagePath })`. If the file exists but is corrupt (truncated, partial write, wrong format), the user's graph data is silently replaced by an empty database the next time the adapter initialises. Violation of [[feedback-no-fallbacks]] at a data-integrity boundary — the catch should at minimum re-throw with the corruption error wrapped, or move the corrupt file aside before creating new.
- **Evidence:**
  ```ts
  // GraphDatabaseAdapter.ts:128-144
  // Try to open existing database first
  try {
    if (require('fs').existsSync(this.config.storagePath)) {
      this.db = GraphDatabase.open(this.config.storagePath);
      console.log('✅ Opened existing RuVector graph database');
      return;
    }
  } catch (e) {
    // Database doesn't exist or is corrupt, create new one  ← silent data loss path
  }

  // Create new database
  this.db = new GraphDatabase({
    distanceMetric: this.config.distanceMetric || 'Cosine',
    dimensions: this.config.dimensions || 384,
    storagePath: this.config.storagePath
  });
  ```
- **Impact:** Whether the catch fires for an actual corrupt file or just a permission error, the user gets no signal and the next sync writes into a blank graph. Federation peers on this node would then push their full state into a fresh empty DB on the corrupt-side peer, effectively rolling that peer to genesis. This is the worst-case failure mode for a sync system. Note: the outer try-catch (lines 148-154) is correct — it re-throws with installation hint. Only the inner one is wrong.

### F-06-006 [WARNING] Prior recon claim CONFIRMED — agentic-flow's `agentdb-service.ts` swallows `graphAdapter.initialize()` errors via `console.warn`

- **Location:** `forks/agentic-flow/agentic-flow/src/services/agentdb-service.ts:811-836` (outside agentdb fork, cross-ref since audit context flagged the recon claim)
- **Issue:** Confirms the recon finding. Wrapping `await this.graphAdapter.initialize()` in `try { } catch (err) { console.warn(...); this.graphEnabled = false; }` means **any** initialise failure (missing `@ruvector/graph-node`, schema mismatch, file lock, version skew) silently degrades the graph runtime. The downstream `if (this.graphEnabled && this.graphAdapter)` gate (line 1645) then routes around the failure — no exception, no telemetry, no acceptance failure. Per [[feedback-no-fallbacks]]: defensive catches at data-integrity boundaries must re-throw fatals.
- **Evidence:**
  ```ts
  // agentic-flow/src/services/agentdb-service.ts:832-836
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[AgentDBService] Phase 2.3: Graph DB unavailable (${msg})`);
    this.graphEnabled = false;
  }
  ```

  The same pattern repeats for `routerEnabled` (line 803-807), `sonaEnabled` (line 854), `gnnEnabled` (other location). It is a copy-paste pattern across the file — graphAdapter is one instance of a broader anti-pattern in `agentdb-service.ts`.
- **Impact:** Out-of-scope to fix (the file lives in agentic-flow, not agentdb fork) but worth flagging here because the agentdb-side audit context expressly asked. Recommend a follow-up ADR enforcing that controller-init failures are fatal at the agentic-flow boundary.

### F-06-007 [WARNING] `CausalRecall.recall()` does NOT walk causal edges as a graph — single-hop SQL join only

- **Location:**
  - `forks/agentdb/src/controllers/CausalRecall.ts:222-258` (`loadCausalEdges`)
  - `forks/agentdb/src/controllers/CausalMemoryGraph.ts:489-549` (`getCausalChain` — the actual graph-walk method)
- **Issue:** Audit question 9 asks "CausalRecall walks them?" Answer: no. `CausalRecall.loadCausalEdges` runs one SQL prepare per candidate set:
  ```sql
  SELECT * FROM causal_edges WHERE from_memory_id IN (?, ?, ...) AND confidence >= ?
  ```
  That fetches **immediate outgoing edges only**, then `rerankByUtility` averages `uplift` across them. There is no recursive CTE, no multi-hop traversal, no chain reconstruction. The multi-hop `getCausalChain` lives in `CausalMemoryGraph` (uses recursive CTE) but `CausalRecall.recall()` never calls it. So "causal-aware ranking" in `CausalRecall` is single-hop uplift averaging, not graph walking.
- **Evidence:**
  ```ts
  // CausalRecall.ts:230-235 — single SQL fetch, no recursion
  const placeholders = candidateIds.map(() => '?').join(',');
  const edges = this.db.prepare(`
    SELECT * FROM causal_edges
    WHERE from_memory_id IN (${placeholders})
      AND confidence >= ?
  `).all(...candidateIds.map(id => parseInt(id)), this.config.minConfidence || 0.6);
  ```

  Compare `CausalMemoryGraph.getCausalChain` (lines 510-541) which IS recursive but isn't called from `CausalRecall`.
- **Impact:** Doc drift. `CausalRecall` docstring (line 3-8) advertises "causal uplift from CausalMemoryGraph" and "Utility-based reranking: U = α*similarity + β*uplift − γ*latencyCost" — that maths is honoured, but readers expect the uplift to reflect the full causal chain (multi-hop), not just immediate edges. The "graph" component is misleading.

### F-06-008 [WARNING] `SelfLearningRvfBackend.initComponents` swallows FederatedSessionManager init failures with `catch { /* skip */ }`

- **Location:** `forks/agentdb/src/backends/rvf/SelfLearningRvfBackend.ts:397-403`
- **Issue:** Lines 397-403 form a chain of `try { dynamic-import } catch { /* skip */ }` wrappers, including the FederatedSessionManager init at line 402:
  ```ts
  if (this.config.federated) {
    try {
      const { FederatedSessionManager: F } = await import('./FederatedSessionManager.js');
      if (await F.isAvailable()) this.federated = await F.create({ dimension: dim });
    } catch { /* skip */ }
  }
  ```

  Any failure inside the inner block — F.isAvailable throws, F.create's internal `await import('@ruvector/ruvllm')` fails, dimension validation rejects — is silently swallowed. The user opted in via `config.federated: true` but gets `this.federated = null` with no signal. The same pattern applies to `accelerator`, `sona`, `router`, `compressor`, `trainer`, `solver` on adjacent lines — federation is one of seven components silently disabled the same way.
- **Evidence:** All seven init lines in `initComponents()` use identical `try { } catch { /* skip */ }` form. Per [[feedback-best-effort-must-rethrow-fatals]], best-effort wrappers must discriminate — swallowing every error class equally is wrong.
- **Impact:** Two angles. (1) If federation is meant to be optional, then a "tried but not available" telemetry signal is the minimum acceptable behaviour. (2) If federation is meant to be mandatory when `config.federated: true`, then this is a feedback-no-fallbacks violation. Decide which, then either escalate the catch or remove the option silently.

### F-06-009 [WARNING] `CausalMemoryGraph` statistical methods are stub-quality

- **Location:** `forks/agentdb/src/controllers/CausalMemoryGraph.ts:842-877`
- **Issue:** Several private statistical helpers are explicitly simplified per their own comments:
  - `mean(values)` (line 842) divides by `values.length` — returns `NaN` on empty input. `calculateUplift` (line 306) has a length-guard early return, but other callers (e.g. `calculateCorrelation` line 867) do not.
  - `tInverse(p, df)` (line 861-865) ignores both arguments and returns hardcoded `1.96` (standard normal approximation). Comment: `// Approximation for 95% CI`. So *every* confidence interval is computed as ±1.96·SE regardless of sample size — wrong for small samples, fine for large.
  - `tCDF(t, df)` (line 855-859) uses an approximation that doesn't converge to 1 for large positive t and is non-monotonic for negative t. Comment: `// Simplified t-distribution CDF (use proper stats library in production)`.
  - `calculateCorrelation(id1, id2)` (line 867-877) counts shared session IDs — that's not correlation, it's co-occurrence count, clamped to 1.0. Used by `detectConfounders` (line 793-794) as if it were Pearson correlation.
- **Evidence:**
  ```ts
  // Hardcoded standard normal approximation, ignoring p and df:
  private tInverse(p: number, df: number): number {
    return 1.96;
  }

  // Non-monotonic for negative t, doesn't converge:
  private tCDF(t: number, df: number): number {
    return 0.5 + 0.5 * Math.sign(t) * (1 - Math.pow(1 + t * t / df, -df / 2));
  }
  ```
- **Impact:** `calculateUplift` results (p-value, confidence interval) are not statistically valid for small samples. The function returns numbers, and downstream code uses those numbers as if they were rigorous — but they are illustrative approximations. Either replace with a proper stats library (e.g. `simple-statistics`) or label every return path with a `# approximation` warning per the comment.

### F-06-010 [WARNING] `SyncCoordinator.pushOnly` / `pullOnly` are exposed and consumed by adapter, but agentdb-side has zero direct tests

- **Location:**
  - `forks/agentdb/src/controllers/SyncCoordinator.ts:227-403` (pushOnly + pullOnly)
  - `forks/agentdb/tests/` — no test file references `pushOnly` or `pullOnly`
  - `forks/agentic-flow/agentic-flow/tests/unit/adr0200-adapter-push-pull-only.test.ts:1-80` (covers adapter side with mocked agentdb)
- **Issue:** ADR-0200 §Confirmation says: "Unit + integration tests in `forks/agentdb/tests/integration/` cover: `pushOnly()` emits the push wire-traffic and `saveSyncState`s without ever calling `pullChanges`; `pullOnly()` emits the pull wire-traffic and runs `resolveConflicts` + `applyChanges` + `saveSyncState`, without ever calling `pushChanges`." Searching `forks/agentdb/tests/`:
  ```bash
  $ grep -rln "pushOnly\|pullOnly" forks/agentdb/tests
  # (empty)
  ```

  The ADR-0200 invariants are tested only through the adapter mock on the agentic-flow side. The agentdb-internal invariant ("pushOnly does NOT call pullChanges") is not directly verified — a future refactor of `pushOnly` could regress to also call `pullChanges()` and the adapter mock would never catch it.
- **Impact:** ADR-0200's §Confirmation list is partially aspirational. Recommend a `forks/agentdb/tests/integration/sync-coordinator-direction-only.test.ts` (or equivalent) that drives a real `SyncCoordinator.pushOnly()` against a stubbed `QUICClient` and asserts the call ledger. Until then, the adapter-mock coverage is sufficient end-to-end but doesn't lock the agentdb-side invariant.

### F-06-011 [WARNING] `CausalMemoryGraph.constructor` accepts five positional args (db, graphBackend, embedder, config, vectorBackend) — overload soup

- **Location:** `forks/agentdb/src/controllers/CausalMemoryGraph.ts:126-151`
- **Issue:** Constructor signature is `(db, graphBackend?, embedder?, config?, vectorBackend?)`. The combinatorial space of "what's provided" determines what runtime modes activate:
  - graphBackend present → `addCausalEdge` uses graph (line 172-205) instead of SQL (line 208-247)
  - embedder + `config.ENABLE_HYPERBOLIC_ATTENTION` → `attentionService` activates (line 143-150)
  - vectorBackend → `findSimilarCausalPatterns` works (line 439-441)
  - embedder + attentionService → `getCausalChain` uses HyperbolicAttention (line 499-501) instead of recursive CTE

  Production wiring in `AgentDB.ts:130-136` passes `(db, undefined, embedder, undefined, vectorBackend)` — so graphBackend is always undefined; HyperbolicAttention is always disabled (no config). `CausalRecall.ts:76` passes only `(db)` — so `embedder`, `vectorBackend` are missing on the internal CausalMemoryGraph inside CausalRecall, which means the `findSimilarCausalPatterns` fast path is unreachable from CausalRecall even when AgentDB has a vectorBackend.
- **Evidence:** Five-arg constructor is a code-smell in the [`anti-pattern: positional config blob`] family. A `CausalMemoryGraphOpts` interface with named fields would prevent the CausalRecall miswiring.
- **Impact:** Low — current production path works; just suggesting an ergonomic refactor. The functional finding is the CausalRecall internal CausalMemoryGraph being undernourished (no embedder, no vectorBackend, no graphBackend).

### F-06-012 [NOTE] `MincutService` + `SparsificationService` wired into `AttentionService`, NAPI-then-WASM-then-JS fallback chain

- **Location:**
  - `forks/agentdb/src/controllers/MincutService.ts:46-66`
  - `forks/agentdb/src/controllers/SparsificationService.ts:88-118`
  - `forks/agentdb/src/controllers/AttentionService.ts:75-81, 818, 954` (consumers)
- **Issue:** Both services follow the pattern: try NAPI binding → try WASM binding → JS fallback. When all three fail, the JS fallback runs (Stoer-Wagner heuristic for Mincut; degree-based for Sparsification). Fallback to JS is logged as `console.warn('⚠️  ... using JavaScript fallback')` and not surfaced upward. Per [[feedback-no-fallbacks]] this is technically a fallback chain, but it's an *acceleration* fallback (correctness preserved, throughput degrades) rather than a data-integrity fallback. Reasonable as long as the user sees the warning.
- **Evidence:** Both services pass through `AttentionService.ts:75-81` correctly:
  ```ts
  this.sparsificationService = new SparsificationService({
    method: 'ppr',
    topK: 50,
    ...this.config.sparsification,
  });
  this.mincutService = new MincutService({ ... });
  ```

  AttentionService wires the services but is itself only initialised when `config.enableAttention` is set — so the unused fallback ceremony in production is small.
- **Impact:** Low. Acceptable pattern for accel-bindings. The warning logs would be louder if surfaced through telemetry, but graceful degradation is the correct semantic for these algorithms.

### F-06-013 [NOTE] `graphAdapter` (GraphDatabaseAdapter) is intact + extended with delete API per RuVector#427

- **Location:**
  - `forks/agentdb/src/backends/graph/GraphDatabaseAdapter.ts:292-437` (delete API: `deleteNode`, `deleteEdge`, `deleteHyperedge`, `deleteEdgesByEndpoints`)
  - `forks/agentdb/src/db-unified.ts:123, 178` (wiring)
  - `forks/agentdb/src/controllers/CausalMemoryGraph.ts:172-205` (consumer when graphBackend provided)
- **Issue:** Per memory [[project-deprecated-controllers]] — graphAdapter must remain. Audit confirms: it remains. The class is well-typed, has proper escaping (`escapeId`, `escapeLabel`), and includes a thoughtful `firstNumeric` extractor for cross-binding-version compatibility. The delete API was added to close the RuVector#427 / ruflo#1784 gap mentioned in the inline comment. The only blemish is F-06-005's corrupt-DB silent path.
- **Evidence:** Adapter has a clean public surface: `initialize`, `storeEpisode`, `storeSkill`, `createCausalEdge`, `query`, `searchSimilarEpisodes`, `searchSkills`, `createNode`, `createEdge`, `deleteNode`, `deleteEdge`, `deleteHyperedge`, `deleteEdgesByEndpoints`, `getStats`, `beginTransaction`, `commitTransaction`, `rollbackTransaction`, `batchInsert`, `close`. All public methods are referenced by `CausalMemoryGraph`, `SkillLibrary`, `ReflexionMemory`, or directly by `db-unified.ts`. No unused public methods.
- **Impact:** Positive finding. `graphAdapter` is sound and complete on the agentdb side. The silent fallback risk is on the agentic-flow consumer side (F-06-006), not the agentdb adapter itself.

## Cross-references

- **ADR-0199** (`docs/adr/ADR-0199-quic-transport-binding-selection.md`) — Real transport binding via `@fails-components/webtransport` with HTTP/2 fallback. **Confirmed wired** at `QUICConnection.ts:400-413` (`createServerTransport`, `createClientTransport`). `QUICServer.start()` / `QUICClient.connect()` consume the abstraction (lines 124-148 of QUICServer; lines 133-153 of QUICClient). HTTP/2 fallback is exercised by `AGENTDB_QUIC_FORCE_FALLBACK=1` per ADR §Confirmation.

- **ADR-0200** (`docs/adr/ADR-0200-synccoordinator-push-only-pull-only-public-surface.md`) — `pushOnly()` + `pullOnly()` public methods. **Confirmed wired** at `SyncCoordinator.ts:227-306` (pushOnly) and `321-403` (pullOnly). Adapter prefers them when present per `sync-coordinator-federated-adapter.ts:230-273`. Gap: no agentdb-side direct tests (F-06-010).

- **Memory `project-deprecated-controllers`** — "Only `federatedSession + federatedLearningManager` can be removed." Audit confirms:
  - `services/federated-learning.ts` (containing `FederatedLearningManager`) — has zero callers, is removable (F-06-004).
  - `backends/rvf/FederatedSessionManager.ts` — has one caller (`SelfLearningRvfBackend`) with silent-catch, removability is gated on F-06-008 disposition.
  - `GraphDatabaseAdapter` (graphAdapter) — confirmed intact + wired (F-06-013).
  - `learningBridge` — out of audit scope (this audit covers graph/federation/sync, not learning bridge).

- **Memory `feedback-no-fallbacks`** — Violated by F-06-001 (resolveConflicts stub), F-06-005 (corrupt-DB silent path), F-06-006 (agentic-flow graphAdapter catch), F-06-008 (SelfLearningRvfBackend skip-catch chain).

- **Memory `feedback-best-effort-must-rethrow-fatals`** — F-06-008 directly violates: blanket `catch { /* skip */ }` doesn't discriminate fatal from non-fatal.

## Reference soundness — per-controller summary

| Controller | Public methods | Sound? | Notes |
|---|---|---|---|
| `SyncCoordinator` | `sync`, `pushOnly`, `pullOnly`, `stopAutoSync`, `getSyncState`, `getStatus` | ⚠ partial | F-06-001 (resolveConflicts stub), F-06-010 (test gap) |
| `CausalMemoryGraph` | `addCausalEdge`, `createExperiment`, `recordObservation`, `calculateUplift`, `queryCausalEffects`, `findSimilarCausalPatterns`, `getCausalChain`, `calculateCausalGain`, `detectConfounders`, `_resetSingleton` (static) | ⚠ partial | F-06-009 (stub stats), F-06-011 (overload soup) |
| `CausalRecall` | `recall`, `batchRecall`, `getStats`, `updateConfig`, `search` | ⚠ partial | F-06-007 (single-hop only, doc says "graph"), F-06-011 (constructor passes only db) |
| `QUICClient` | `connect`, `disconnect`, `sync`, `ping`, `push`, `pushAll`, `getStatus` | ✓ | ADR-0199 wired correctly |
| `QUICServer` | `start`, `stop`, `getBoundAddress`, `processSyncRequest`, `getStatus`, `getConnections` | ✓ | ADR-0199 wired correctly |
| `QUICConnection` | `connect`, `disconnect`, `send`, `migrate`, getters, plus `createServerTransport` / `createClientTransport` factories | ⚠ split-purpose | Simulation class for BBR/0-RTT/migration metrics + real Transport factories — same file, two semantic levels |
| `QUICConnectionPool` | `getConnection`, `releaseConnection`, `removeConnection`, `getPoolStats`, `getAllPoolStats`, `getTotalConnections`, `drainEndpoint`, `shutdown`, `cleanup` | ✗ unwired | F-06-003 (no production callers, file marked "no production wiring") |
| `QUICStreamManager` | `createStream`, `sendOnStream`, `sendMultiple`, `receiveOnStream`, `closeStream`, `resetStream`, `getStreamMetrics`, `getStats`, `updatePriority`, `closeAll`, `getActiveStreamCount` | ✗ unwired | F-06-003 (no production callers, runs over simulation QUICConnection) |
| `MincutService` | `initialize`, `stoerWagnerMincut`, `kargerMincut`, `flowBasedMincut`, `partition`, `getPartition`, `inSamePartition`, `getPartitionStats`, `clearCache`, `getCacheStats` | ✓ | F-06-012 (acceptable accel-fallback chain) |
| `SparsificationService` | `initialize`, `pprSparsification`, `randomWalkSparsification`, `spectralSparsification`, `sparsify`, `updateConfig`, `getConfig`, `resetConfig` | ✓ | F-06-012 (acceptable accel-fallback chain) |

## Completeness gaps

1. `SyncCoordinator.resolveConflicts` declares four strategies (`local-wins`, `remote-wins`, `latest-wins`, `merge`) but none of them actually transforms the data that reaches `applyChanges`. The conflict-resolution feature is announced but absent (F-06-001).

2. CRDT primitives (G-Counter, LWW-Register, OR-Set) are defined and exported but no production code calls their merge functions. The federation wire format announces CRDT semantics but the runtime is `INSERT OR REPLACE` (F-06-002).

3. ADR-0200 says agentdb-side `pushOnly`/`pullOnly` tests exist; they do not — only adapter-side tests on the agentic-flow side (F-06-010).

4. `CausalRecall` advertises "Combines 1. Vector similarity search 2. Causal uplift from CausalMemoryGraph 3. Utility-based reranking" — point 2 fires single-hop SQL only, never enters multi-hop graph walking despite `CausalMemoryGraph.getCausalChain` existing (F-06-007).

5. `QUICConnectionPool` and `QUICStreamManager` exist as full classes with tests, but are not wired into the production federation path (F-06-003). Either delete or wire — current limbo is misleading.

6. `services/federated-learning.ts` is dead. Either delete or wire (F-06-004).

7. Statistical methods in `CausalMemoryGraph` are stub-quality but used as if rigorous in `calculateUplift` (F-06-009). Production stats should not return illustrative-quality numbers.

## What's intact / sound

- ADR-0199 real transport (WebTransport + HTTP/2 fallback) is wired correctly through `createServerTransport` / `createClientTransport`.
- ADR-0200 `pushOnly` / `pullOnly` are exposed on `SyncCoordinator`, the adapter prefers them when present, and both correctly omit the unwanted half of the bidirectional flow.
- `GraphDatabaseAdapter` (graphAdapter) is intact, well-typed, has Cypher-injection-safe escaping, includes the post-ADR delete API for issue #150, and has no unused public methods.
- `CausalMemoryGraph.addCausalEdge` correctly routes through `graphBackend.createCausalEdge` when provided (line 172-205) and falls back to SQL only when no graph backend is wired — that's a legitimate "use richer storage when available" pattern, not a silent fallback.
- `QUICClient.sendRequest` throws explicitly if transport is not initialised (`QUICClient.ts:325-328`), explicitly noting "per feedback-no-fallbacks, no silent mock-response branch" — good discipline.
- `MutationContext` threading via `sync(ctx, ...)` and `applyChanges(ctx, ...)` preserves ADR-0180 guarantees through ADR-0200's new methods.
- The `SyncCoordinator` push/pull/apply path correctly uses `ctx.bulk(intent, payload)` once per table (episodes / skills / skill_edges / sync_state = 4 audit entries) per ADR-0180 §Bulk-write mode.
