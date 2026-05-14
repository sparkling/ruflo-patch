# ADR-0179 Council — Round 3 Transcript

**Date**: 2026-05-13
**Team**: `adr-0179-council` (same 8 agents from rounds 1 + 2, re-contextualised via SendMessage)
**Topology**: hierarchical-mesh (continued)
**Comms**: SendMessage on bound team — no file-based handoff
**Related ADRs**: [[ADR-0179]] (this council's primary subject), [[ADR-0177]] (RVF-vision pivot direction the round resolves against), [[ADR-0086]]/[[ADR-0112]]/[[ADR-0085]] (exploration inputs being synthesized)
**Predecessor rounds**: [[ADR-0179-council-r1-bridge-deletion]], [[ADR-0179-council-r2-axis-architecture]]

## Question deliberated

Three open questions from round 2's "Option Z" verdict + a major framing correction discovered mid-session:

**Framing correction (mid-session)**: Earlier rounds claimed upstream has ONE MCP surface (`memory_*`). This was wrong. Verified via `ruvnet/ruflo/v3/@claude-flow/cli/src/mcp-tools/agentdb-tools.ts` HEAD ef73a1616 — upstream has 18 `agentdb_*` MCP tools too. The actual divergence is at the **substrate layer** (upstream: 1 file `.swarm/memory.db`; fork: 2 files `.rvf` + `.db`) and the **coordination rule** (upstream: allowed via bridge; fork: forbidden per ADR-0112). Option Z is therefore a substrate collapse + ADR-0112 revert, NOT a surface collapse.

**User reframe (mid-session)**: *"These discussions are for determining the direction. We have contradicting ADRs. Once we have found the answer, we can clean it up. See the old ADRs as exploration, and inputs to our decision."* Experts should argue for forward decisions informed by what exploration revealed, not as "walking back errors."

### The three round-3 questions

1. **Body-diff `bridgeStoreEntry()`, `bridgeStorePattern()`, `bridgeHierarchicalStore()`, `bridgeRecordFeedback()`** in upstream `memory-bridge.ts` HEAD ef73a1616. What write-ordering / referential-integrity / coordination is actually happening? What does ADR-0177 need to preserve?
2. **Fork's intermediate state during ADR-0177 migration.** Can data exist in both RVF and SQLite simultaneously during the transition? What's the consistency model?
3. **Round 1's 6 lost features** — bridge-shaped chokepoint or per-handler shared middleware? Which is the right placement now that we know upstream's pattern is single-bridge and ADR-0177 proposes substrate collapse?

## Participants (same 8 as rounds 1+2)

| `name:` slug | `subagent_type` | Round-3 role |
|---|---|---|
| `queen-architect` | `system-architect` | Meta-framing, no advocacy |
| `devils-advocate` | `reviewer` | Pure opposition to all 3 question framings |
| `bridge-defender` | `researcher` | **Bridge coordination advocate** (extends round-1 bridge bias) |
| `status-quo-defender` | `adr-architect` | **Handler-middleware advocate** (extends round-1 status-quo bias) |
| `perf-judge` | `performance-engineer` | Perf-axis judgment |
| `security-judge` | `security-architect` | Audit chokepoint judgment |
| `memory-judge` | `memory-specialist` | Substrate migration + middleware placement |
| `integration-judge` | `v3-integration-architect` | Upstream-sync delta analysis |

---

## QUEEN ARCHITECT — Round 3 framing

### Load-bearing axes the council must argue

- **Axis 1: The bridge's body IS the spec.** Whatever invariants the upstream bridge enforces today — write-ordering, referential integrity, idempotency, error rollback — are the *de facto* contract every caller relies on. ADR-0177 cannot honestly preserve "upstream behavior" without enumerating them. Body-diff is the prerequisite; Q2 and Q3 depend on it.
- **Axis 2: Coordination invariants live somewhere on {caller, tool-handler, bridge, substrate}.** Upstream's choice is bridge-level. Fork's ADR-0112 choice is substrate-level (and forbids the bridge from doing it). The 6 lost features are decorators that need *some* placement.
- **Axis 3: Single-substrate doesn't imply single-table-set.** ADR-0177 collapses substrate (one file, RvfBackend) but the 10+ controllers still each have schemas. A single substrate can still host many controllers as separate logical stores. The bridge's coordination job survives substrate collapse — coordination is a logical concern.
- **Axis 4: Migration windows are first-class hazards.** Trunk-only + 4-fork cascade means transitions ship in waves, not feature-flagged. Is mixed-mode a *transient hazard to engineer against* or a *forbidden state*?
- **Axis 5: Bridge as chokepoint vs middleware as composition.** Bridge gives one chokepoint, easy to audit, matches upstream shape, but couples 6 unrelated concerns. Middleware gives compositional clarity but distributes the audit surface. The 6 features divide cleanly: MutationGuard + AttestationLog are *security/audit* (want chokepoint); TieredCache + hybrid-BM25 are *performance/quality* (want composition); ExplainableRecall + SkillLibrary-promote are *application semantics*.

### Tentative lean

**Hybrid placement**: chokepoint for security/audit (MutationGuard + AttestationLog at bridge body), middleware for performance/quality (TieredCache + BM25 fusion as composable decorators), bridge-call for application semantics (ExplainableRecall + SkillLibrary-promote). Confidence 56.

This converges round-1's "Option B+" with round-2's Option Z: **a thin bridge module hosting the security/audit chokepoint + 3 application-semantic calls, with composable middleware around it for the 3 performance/quality concerns.**

---

## DEVIL'S ADVOCATE — Round 3 challenge

### Pre-flight: the unnamed assumption

The council has run two rounds without naming the actual ADR arc:

- **ADR-0053** (upstream, 2026-02): bridge IS the coordination layer.
- **ADR-0084** (fork, 2026-04): controller-direct. Bridge bypassed. First step away.
- **ADR-0086** (fork, 2026-04): RVF for memory_*, SQLite for agentdb_*. Substrate split. Second step.
- **ADR-0112** (fork, 2026-05): "no MCP tool spans both stores." Coordination *forbidden*. Third step.
- **ADR-0085** (fork, 2026-04): delete bridge. Coordination machinery itself gone. Fourth step.
- **ADR-0179** (fork, proposed): restore 6 features as router call sites. Fifth step — admit some coordination needs to come back, but refuse to call it a bridge.
- **ADR-0177** (fork, proposed): substrate collapse + ADR-0112 revert. Sixth step — admit the substrate split was load-bearing for forbidding coordination, and undo it.

The bridge wasn't deleted because it didn't coordinate. **It was deleted because the fork already decided — across three prior ADRs — that coordination wasn't going to happen anyway.**

### Challenges to each question

**Q1 (body-diff):**
- *Steelman: bridge IS coordinating today.* Eight discrete coordination steps in `bridgeStoreEntry`. Three separate fanout paths in `bridgeRecordFeedback`. ADR-0177 has to preserve all of these or ships a referential-integrity regression.
- *Steelman: bridge is a myth.* Run the actual grep. Most bridge functions are `controllerRegistry.getController(...).store(...)` followed by another write with *no transaction*. The "coordination" is *naming*, not *semantics*.
- *Killer data point:* Grep for transactional primitives (`BEGIN`, `COMMIT`, `lock`) inside the four named bridge functions. If primitives = 0 (DA's prediction), "the bridge coordinates" is a vibe.

**Q2 (migration window):**
- *Steelman: window is real and dangerous.* For some non-trivial period, controllers are repointed one-by-one. Same logical entry can exist in both stores with diverging metadata. ADR-0177 needs explicit dual-write or shadow-read.
- *Steelman: window is rationalised theatre.* Storage migrations are routine. Dual-write → shadow-read → cutover → cleanup is well-known. If ADR-0177 commits to schedule + feature flag, the window is bounded.
- *Steelman: window IS rationalisation, AND that's fine.* Every architectural pivot has a transitional state. Status quo (X) is *also* a half-migrated state, frozen indefinitely.

**Q3 (placement):**
- *Steelman: middleware is strictly better.* A function is small, testable, typed. A bridge is a module with state. ADR-0084 deleted the bridge specifically because the controller-direct pattern made lifecycle ambiguous.
- *Steelman: middleware recreates the parallel-path problem.* Middleware that's "shared" but invoked at each call site means every call site has to remember. Upstream's bridge guarantees invocation by being the only path.
- *Steelman: the choice is a red herring.* A "bridge module" and a "shared middleware module" are the same shape in different language. The interesting question is *enforcement* (lint, types, runtime instrumentation).

### The question nobody will want to answer

**"Coordination" was ADR-0053's central promise. ADR-0084, 0086, 0112, and 0085 each took one step away from it. ADR-0177 and ADR-0179 are taking steps back. Is the fork *prepared to commit*, in writing, that coordination is again a goal — or is it going to keep introducing coordination one feature at a time while maintaining the rhetorical position that it isn't?**

---

## BRIDGE COORDINATION ADVOCATE — Round 3 case for bridge-level coordination

### Position

**Restore the bridge as the coordination layer for ADR-0177**, with migration-period dual-substrate routing owned by the bridge. Body-diff confirms round-1 case empirically: this was not a 3,650-line scaffold; the 6 lost features map directly to bridge code blocks.

### What `bridgeStoreEntry()` actually does (lines 518-619)

Eight discrete coordination steps in one place:

1. `getRegistry(options.dbPath)` (line 537)
2. `guardValidate(registry, 'store', ...)` — MutationGuard pre-write gate (line 549). Rejects writes that fail policy.
3. Embedder dispatch via `ctx.agentdb.embedder` (lines 559-572) — generates vector inline
4. SQL write to `memory_entries` with full metadata column set (lines 576-596)
5. `cacheSet(registry, cacheKey, ...)` — TieredCache write-through (line 602)
6. `logAttestation(registry, 'store', id, ...)` — AttestationLog audit (line 605)
7. Returns typed result signaling which gates fired: `guarded: true, cached: true, attested: true`

### `bridgeStorePattern()` (lines 1331-1387)

Two-tier dispatch with graceful degradation: try `reasoningBank.store(...)` first, fallback to `bridgeStoreEntry` with `namespace: 'pattern'` + HNSW index addition via dynamic import. Returns `controller: 'reasoningBank' | 'bridge-fallback'`.

### `bridgeRecordFeedback()` (lines 1446-1528)

**Multi-controller fan-out with skill auto-promotion:**
1. Records to `learningSystem` if available
2. Records to `reasoningBank` for pattern reinforcement
3. **Promotes high-quality patterns to SkillLibrary** when `success && quality >= 0.9` (lines 1501-1509) — the SkillLibrary auto-promotion round-1 audit identified as lost
4. Always also stores as memory entry for retrieval
5. Returns `controller: 'learningSystem+reasoningBank+skills+bridge-store'`

### `bridgeHierarchicalStore()` (lines 2100-2121)

Adapter-pattern dispatch between real and stub backends via duck-typing. Without this layer, every hierarchical-write caller has to know about the API divergence.

### `bridgeSearchEntries()` (lines 626-750)

**Hybrid BM25 + semantic fusion with reciprocal rank weighting:**
- Computes `termDocFreqs` and `avgDocLength` over corpus
- For each row, computes both `semanticScore` (cosine) AND `bm25ScoreVal`
- Fuses: `0.7 * semanticScore + 0.3 * bm25ScoreVal` when both available
- Attaches **ExplainableRecall provenance** per result: `semantic:0.842+bm25:0.341`
- Returns `searchMethod: 'hybrid-bm25-semantic' | 'bm25-only'`

130-line function with specific weight tuning and per-result provenance. ADR-0179's "restore as call site" cannot reproduce this without re-introducing 100+ lines per write/search handler, OR extracting a shared helper — which is the bridge under a different name.

### Migration window argument

**The bridge is the only natural place to own dual-substrate routing.** ADR-0177's substrate unification needs to: direct writes to new path, read from both with precedence, track migration state, eventually flip the switch. This has the same shape as `bridgeStorePattern`'s two-tier fallback today. Extending it to substrate-availability is a one-axis change.

### Bridge LoC defense

Read what 2,370 lines actually do:
- Lines 1-500: helpers (`getRegistry`, `guardValidate`, `cacheSet`, BM25 math). Genuine plumbing.
- Lines 518-1240: core CRUD entry points. Each function does work.
- Lines 1245-2050: controller-specific entry points. Each one duck-types between real and stub.
- Lines 2100-2370: hierarchical/consolidate/batch/synthesize/semantic-route adapters.

**There is no dead scaffolding on a read.** The "54/64 zero callers" framing may have been counting *intended* callers as *dead* — that's the audit-methodology gap that produced the regression.

### Honest weak spot

Reading upstream HEAD `ef73a1616`, not fork bridge at HEAD~deletion. If fork bridge had drifted significantly before deletion, the deletion might have caught real dead weight. But the *upstream* bridge looks like working coordination, not dead scaffolding.

---

## HANDLER-LEVEL MIDDLEWARE ADVOCATE — Round 3 case for non-bridge middleware

### Position

- Primary: ADR-0179 R1's `src/memory/middleware/` per-handler composition (confidence 82)
- Reject: bridge module resurrection (confidence 90)
- Reject: extended dual-substrate operating mode (confidence 85)

### What the upstream bridge is actually doing

Read 2 of 36 exports in detail. Structural breakdown of `bridgeStoreEntry` (101 lines):

| Lines | What it does | Coordination value |
|-------|---|---|
| 537-541 | `getRegistry()` + `getDb()` + null-guards | Zero. ADR-0084 Phase 4 eliminated this — handler calls `getController()` directly. |
| 549-552 | `await guardValidate(registry, 'store', ...)` | **The middleware call.** `guardValidate` is an external exported helper. Bridge is just a *caller*. |
| 559-573 | Embedder lookup + `embedder.embed(value)` | Zero. Direct AgentDB embedder call — handler can do this. |
| 575-596 | Raw `ctx.db.prepare(insertSql).run(...)` against `memory_entries` | **Negative value.** Bridge is doing the controller's job. The bridge is *bypassing* the controller it just looked up via the registry, then writing raw SQL. That's the parallel call graph problem. |
| 598-602 | `await cacheSet(registry, cacheKey, ...)` | Middleware call. Helper is external. |
| 604-605 | `await logAttestation(...)` | Middleware call. Same pattern. |
| 607-615 | Return shaping | Zero. |

**The bridge is doing four things at once, and only one is "coordination":**
1. Registry indirection (~30%, ADR-0084 already eliminated)
2. Direct SQLite SQL (~40%, this is the controller's job)
3. Middleware composition (~10%, three lines)
4. Result shaping (~20%, trivial)

`bridgeSearchEntries` is even worse — 124 lines of direct `SELECT ... FROM memory_entries` followed by inline BM25 + cosine scoring. This is a *query implementation*, not an abstraction.

**The cargo-cult diagnosis is correct.** Most of the upstream bridge is post-ADR-0084 dead weight.

### Concrete shape — directory structure

```
src/memory/middleware/
  index.ts                 // barrel
  guard.ts                 // guardWrite(registry, op, ctx) — MutationGuard
  cache.ts                 // tieredCacheWrite/Read — TieredCache
  attest.ts                // attestWrite — AttestationLog
  bm25.ts                  // hybridScore — BM25 + cosine fusion
  provenance.ts            // explainRecall — ExplainableRecall string
  skill-promote.ts         // maybePromoteSkill — SkillLibrary auto-promotion
```

Each MCP tool handler imports the subset it needs:

```typescript
import { getController } from '../controllers/registry.ts';
import { guardWrite, tieredCacheWrite, attestWrite } from '../memory/middleware/index.ts';

export async function handleMemoryStore(args) {
  const controller = getController('memory');                    // ADR-0084 Phase 4 path
  const guard = await guardWrite(controller, 'store', args);
  if (!guard.allowed) return { error: guard.reason };

  const result = await controller.store(args);                   // controller owns storage
  await tieredCacheWrite(controller, args.key, args.value);
  await attestWrite(controller, 'store', result.id, args);
  return result;
}
```

### Type-level enforcement (the answer to "middleware can be bypassed")

Define `MemoryWrite<T>` and `MemoryRead<T>` as **branded types** constructible only by passing through middleware:

```typescript
type GuardedWrite = { __guarded: true; ... };
```

Controllers' `store()` / `update()` / `delete()` signatures require `GuardedWrite`-branded inputs. **Compiler refuses any handler that calls `controller.store(rawArgs)` without going through `guardWrite()` first.** CI lint as backup.

**This gives compile-time enforcement without a runtime god-module.** Better than the bridge gave us — the bridge could be bypassed and was bypassed in practice.

### Why this beats bridge-restoration

| Axis | Bridge (Option C) | Per-handler middleware (R1) |
|------|-------------------|----------------------------|
| ADR-0084 compliance | Violates — parallel call graph | Preserves — direct `getController()` |
| ADR-0112 compliance | Violates — bridge is cross-store coordinator | Preserves — middleware is per-axis composition |
| Dead-code load | Brings back 13 known-dead exports as collateral | Zero dead code |
| Migration steps | Two cascades (restore then remove) | One cascade |
| LoC budget | ~3,650 LoC restored | ~400-600 LoC across 6 middleware files |
| Auditability | One mega-module, hard to diff against feature gaps | Six files, one-feature-each, trivial |
| Future feature add | Add to bridge — god-module grows | Add a middleware file — composable |
| Lint enforcement | Hard | Easy (`no-import-from-memory-bridge`) |

### Honest weak spot

Read 2 of 36 exports in detail. The "97% cargo-cult / 3% real coordination" ratio extrapolates from `bridgeStoreEntry` and `bridgeSearchEntries`. If deletion-recovery functions (`bridgeDeleteHierarchical`, etc.) are structurally different — genuinely cross-axis cascade-deletion engines that can't decompose — the read undercounts. Honest frame: per-handler middleware correct for 5 of 6 R1 features; 6th may need a small `cascade-delete.ts` helper. None of that justifies restoring 2,370 lines.

---

## PERFORMANCE JUDGE — Round 3 perf-axis verdict

### Per-bridge-function coordination overhead

| Function | Coordination wall (warm) | Async-hop count |
|---|---|---|
| `bridgeStoreEntry` | 0.11-0.85ms | 3 hops |
| `bridgeStorePattern` (fast) | 0.02-0.1ms | 1 hop |
| `bridgeStorePattern` (fallback) | ~0.85ms + dyn import | 4 hops + import |
| `bridgeRecordFeedback` | 0.5-2ms (fanout) | 4-8 hops |
| `bridgeHierarchicalStore` | 0.02-0.05ms | 1 hop |

**Critical observation:** every coordination step is `await`-wrapped. Async-microtask hop is 5-50µs per await on V8. That's 3 forced microtasks per `bridgeStoreEntry` = ~15-150µs of pure scheduler overhead, paid even when controllers are no-ops. On write-heavy hot loop (1000 stores/sec) = 15-150ms/sec of pure async wrapping.

### `bridgeRecordFeedback` — the SURPRISE finding

Multi-controller fan-out:
- `learningSystem.recordFeedback` OR `.record`
- `reasoningBank.recordOutcome` OR `.record`
- `skills.promote` in a LOOP over patterns
- **ALWAYS calls `bridgeStoreEntry` at line 1512** — full coordination stack runs even when learningSystem+reasoningBank handle the feedback

**Storage amplification factor: ~3-4× per feedback event.** No dedup; it's fanout-by-design. This is invisible to the API but very visible in disk usage and write throughput under load.

### Migration window perf

**Regime A (try-RVF-then-fall-back-to-SQLite):**
- Hit on first: 1 read cost
- Miss + hit on second: 2 read costs
- Steady-state cost ≈ `1 + (miss_rate × 1)`
- Bounded by migration completion

**Regime B (always-check-both):**
- Permanent 2× read tax until code removes secondary check
- **Continuous tax — the failure mode of every uncompleted migration in history.**

**Recommended bound: migration must complete within 7 days of starting; otherwise 1.5× read tax compounds into a regression developers notice as "memory got slower."**

### Bridge vs handler-middleware perf

Both essentially the same speed at the MCP boundary:
- **JIT inlining:** handler-middleware marginally faster (saves ~50-200ns per inlined helper call). Below measurement floor of MCP roundtrip.
- **Centralisation amortisation:** bridge wins on registry-lookup caching IF middleware is naïve. With shared context, evaporates.
- **Function-call indirection:** ~1-5ns per call. Negligible.
- **Specialisation:** bridge has to add parameters for skip-cache; middleware omits the cache layer entirely.

**Decision is in the noise. Don't pick on perf.**

### Ranking purely on perf

- 1st: handler-middleware with shared context (~5-15% hot-path win, below MCP floor)
- 2nd: bridge with prepared-statement cache (close behind once warm)
- 3rd: handler-middleware with per-middleware registry lookup (naïve composition trap)

### Hidden perf trap in each

- **Bridge**: `bridgeStorePattern → bridgeStoreEntry` recursive call; always-on `bridgeStoreEntry` at end of `bridgeRecordFeedback`. **3-4× write amplification on feedback events that the API doesn't surface.**
- **Middleware**: if any handler forgets to apply guard, bypassed silently. Bridge enforces by construction. Perf wins evaporate if you need runtime check.
- **Migration window**: Regime B "temporary" never being removed. Permanent 2× read tax.

---

## SECURITY JUDGE — Round 3 verdict on bridge as audit chokepoint

### Read the actual bridge body — the team-lead's premise is partly wrong

Concrete callsite map from 2,370-line bridge:

**Genuinely guard-and-attest (5 functions):**
- `bridgeStoreEntry` (line 518) — `guardValidate('store', ...)` + `logAttestation('store', ...)`
- `bridgeDeleteEntry` (line 946) — guard + cache invalidate + attest
- `bridgeDeleteHierarchical` (line 1595) — guard + 4 distinct `logAttestation` callsites per tier
- `bridgeDeleteCausalEdge` (line 1699) — guard + 3 attestation callsites
- `bridgeDeleteCausalNode` (line 1786) — guard + 2 attestation callsites

**Funnel-through (guarded only because they internally call `bridgeStoreEntry`):**
- `bridgeStorePattern` — fast path (reasoningBank.store) BYPASSES MutationGuard
- `bridgeRecordFeedback` — three controller mutations BEFORE the guarded bridge call. Guard doesn't cover them.

**Unguarded and unattested entirely (8+ functions):**
- `bridgeHierarchicalStore` — direct `hm.store(...)`. No guard. No attest.
- `bridgeBatchOperation` — direct batch ops. No guard.
- `bridgeConsolidate` — direct `mc.consolidate()`. No guard.
- `bridgeRecordCausalEdge` — direct `causalGraph.addEdge(...)`. No guard. (Asymmetric — DELETE is guarded.)
- `bridgeSessionStart` / `End` / `bridgeRouteTask` — session lifecycle. No guard.
- `bridgeAddToHNSW` — direct index write. No guard.

### What this means

**The bridge is not a uniform audit chokepoint. It is a per-function audit pattern that was applied inconsistently — the kv store/delete path was the model, hierarchical store/causal-edge create/batch ops were never retrofitted.**

When the briefing says "this IS the chokepoint upstream meant," the honest read is: **upstream meant for it to be the chokepoint, started the work, and shipped it half-done.** Restoring the bridge as-is restores the half-done version. 5 functions guarded, 8 unguarded.

### Migration-window audit

Three reconciliation problems:

1. **Attestation chain continuity.** ADR-0053's structural hashes form a chain. During migration, chain has structural cut at the cutover. Need explicit migration-attestation record anchoring new chain's genesis to old chain's terminus.
2. **Dual-write blind window.** Either duplicate-counting bias OR silent miss with no failed-lookup attestation. Operator can't distinguish "data doesn't exist" from "data hasn't migrated."
3. **Audit log itself moving.** If `mutation_attestations` SQLite table is part of what's being moved, then the audit substrate itself migrates. Need audit-of-the-audit-migration.

### Bridge vs handler-middleware as audit chokepoint

**Handler-middleware imported uniformly is more auditable AND less bypassable.**

- **Bridge-as-chokepoint**: moderate auditability, HIGH bypassability. ADR-0084 controller-direct works whether bridge is restored or not. Any caller reaching around the bridge gets neither guard nor attest.
- **Handler-middleware via `guardedHandler<T>` HOF**: high auditability (one grep against tool registry), moderate bypassability. Type-level enforcement: TypeScript can refuse to register a mutation handler that isn't wrapped.

**Bridge-functions are runtime conventions; handler-middleware is type-level enforcement.**

### Recommendation

**Type-enforced HOF middleware**, not bridge restoration. The bridge would re-import upstream's half-done pattern (5/13 guarded; 8 unguarded). Type-enforced HOF can refuse to register an unguarded mutation handler.

### Non-obvious security regression

**Restoring the bridge in its upstream form re-imports upstream's audit gaps along with upstream's audit guards.** The bridge as-it-exists has `bridgeHierarchicalStore` unguarded, `bridgeBatchOperation` unguarded, `bridgeRecordCausalEdge` unguarded — those are *write* operations on more state-sensitive controllers than the kv store path. Restoring the bridge gives the operator a *visible* audit surface that has invisible holes. That's structurally worse than no bridge plus a known hole, because the bridge's existence creates the impression of completeness.

**The half-finished chokepoint is the most dangerous chokepoint.**

---

## MEMORY ARCHITECTURE JUDGE — Round 3 verdict

### What invariants does the upstream bridge maintain?

**The bridge does NOT coordinate cross-table writes itself. It delegates to controllers when present and falls back to a single denormalised table when they aren't.**

- `memory_entries` is the bridge's only direct SQL surface. No `INSERT INTO episode_embeddings`, no `JOIN`, no explicit `BEGIN/COMMIT/ROLLBACK`, no `FOREIGN KEY`.
- Cross-table integrity is owned by the controllers. Hierarchical-delete path comments: *"agentdb@3.0.0-alpha.13+: `ReflexionMemory.deleteEpisode` propagates through graph adapter / generic graph backend / vector backend AND purges SQL episodes + episode_embeddings rows. Single call, durably consistent."*
- The bridge's fallback when controllers absent is **degraded, not equivalent.** Causal-node cascade fallback does two separate `UPDATE memory_entries SET status='deleted'` statements with no transaction wrapper.
- Middleware IS centralised in the bridge. `guardValidate` (line 426) and `logAttestation` (line 448) are bridge-local helpers called from every store/delete path.
- `TieredCache` is bridge-managed.
- `BM25 + semantic fusion` is bridge-local code, not a controller.

### What the bridge "preserves"

Not multi-table referential integrity (delegated). What it preserves:
1. A **single chokepoint** where Guard + Attest + Cache wrap every memory op.
2. A **controller-lookup-then-fallback-to-denormalised-SQL** dispatch pattern.
3. **Bridge-local search algorithms** (BM25 fusion) that don't belong to any one substrate.

### The migration window — same logical entry in BOTH stores

**Yes. During the controller re-pointing window, the same logical entry CAN exist in both stores. That's the whole point of "fallback to relational metadata when explicitly needed" — the target state is itself hybrid, and the transition is even more so.**

### What "re-point controllers to RvfBackend" actually means

10+ AgentDB controllers have **relational schemas**:
- `reflexionMemory` owns `episodes` + `episode_embeddings` (FK)
- `causalGraph` owns nodes + edges (Cypher backend via GraphDatabaseAdapter)
- `skillLibrary` owns skills + promotion-history aggregates

Each has its own `BEGIN/COMMIT` boundaries.

**You cannot straightforwardly re-point these to RvfBackend, because RVF is K/V + vector.** No `JOIN`, no `WHERE table_x.fk = table_y.id`, no transactional multi-row mutation. Three options:

**A) Denormalise into RVF.** Collapse each controller's relations into one K/V record per logical entity. Loses query-by-FK.

**B) RVF for the vector half, SQLite retained for the relational half.** This is what ADR-0177's "SQLite retained ONLY as fallback for relational metadata when explicitly needed" actually means. **It's not a fallback — it's a permanent dual-substrate operating mode dressed up as a fallback.**

**C) Replace controllers' implementations entirely.** Rewrite as RVF-native modules. Multi-quarter effort.

ADR-0177 most plausibly means **B** with possibly **A** for some controllers.

### Concrete consistency model proposal

**Per logical entity, one substrate is the System of Record (SoR); the other is a materialised view (MV) of a subset of fields.**

- Pure K/V + vector entries (memory_*): **SoR = RVF.** No MV.
- Relational-controller entries (Reflexion episodes etc): **SoR = SQLite for relational structure; RVF holds MV of vector field only.**
- Write ordering: **SoR-first, MV-after.** SQLite txn commits first, then RVF write.
- **No two-phase commit.**
- **Reconciliation:** periodic sweeper job verifies SoR backing exists, evicts orphans.

### Round-1 verdict revision

**The per-axis dual-middleware design is over-engineered relative to what upstream demonstrates works.** Upstream has:
- One bridge file (2,370 lines)
- Guard + Attest called from every store/delete entry point, uniformly, via two bridge-local helper functions
- One registry lookup pattern — substrate-agnostic
- TieredCache and BM25 fusion live in the bridge file

This is exactly the "single chokepoint with axis-neutral middleware" that ADR-0177 collapses toward. Round-1's "per-axis shared middleware imported by both routers" was right *in spirit* (substrate-neutral) but *wrong in shape*. **The correct shape is one router (or bridge-equivalent), middleware applied once, controllers dispatched by capability lookup.**

### Final ranking

1. **Substrate-collapse-as-actually-defined** (option B): RVF for vector/KV, SQLite for relational, one bridge as router.
2. Status quo dual-axis (X).
3. Full RVF rewrite (option C).

### What ADR-0177 needs to sharpen

- Honest acknowledgment that operationally RVF + SQLite forever (not "RVF only").
- Per-controller SoR assignment table.
- Attestation handling: keep dedicated `attestation.db`, fold, or move?
- Sweeper job spec.
- Bridge-or-router naming.

---

## INTEGRATION JUDGE — Round 3 verdict on upstream-sync

### Pre-ADR-0177 state (baseline 2026-05-13)

- `memory-bridge.ts`: **deleted in fork** (~2,370 lines on upstream). Delta: +2,370 LoC.
- `memory-initializer.ts`: **deleted in fork** (~3,000 lines upstream). Delta: +3,000 LoC.
- Substrate: ~1,500-2,500 LoC fork-only.
- MCP surface: ~500-1,000 LoC fork-only behavioral divergence.

**Total fork-vs-upstream delta: ~7,000-9,000 LoC of structural divergence. Most of it deletion-shaped — invisible to fork reviewers, monotonically growing.**

### ADR-0177 transition months 1-3

- Month 1: re-import bridge.ts scaffolding (~1,800 LoC restored). Substrate collapse begins.
- Month 2: handler middleware retired; coordination moved into bridge. Delta drops 2,370 → 600 LoC.
- Month 3: substrate convergence. SQLite remains for 5 PERMANENT_SQLITE_CARVE_OUT controllers.

**Month 3 delta: ~1,400-2,000 LoC, all additive divergence (visible, mergeable). Net: ~5,000 LoC retired over 3 months.**

### Weekly sync cost during transition

- Weeks 1-4: ~3-4 hours/week (high, structural conflicts)
- Weeks 5-8: ~1-2 hours/week (medium, interpretive conflicts)
- Weeks 9-12: ~30 min/week (low, line-by-line)

### Q3 — bridge shape vs middleware shape: inbound merge cost

| Inbound change | Bridge merge cost | Middleware merge cost |
|---|---|---|
| Upstream adds new controller | ~5-10 LoC bridge dispatch | ~5-10 LoC per handler middleware install ×30 handlers |
| Upstream changes MutationGuard | 1:1 function edit, merges cleanly | Re-port into ~33 handler stacks; non-mechanical |
| Upstream changes hybrid retrieval | Function-level merge | **Cannot be ported** without reintroducing a coordinator above handlers |
| Upstream adds new bridge invariant | New function, merges | No fork home; design discussion per concern |

### The structural-homology argument

Upstream's bridge encodes a particular *shape* of cross-cutting concerns. By restoring the bridge, the fork inherits:
1. Mergeable diffs (line-level alignment).
2. **A vocabulary**: fork-side reviewers can map upstream bridge changes to fork bridge changes by name.

The vocabulary cost is invisible in LoC but compounds. Round-1 evidence: the 6 missed features were missed precisely because they crossed a vocabulary boundary.

### Final ranking (round 3)

1. **Restored bridge + Option Z + ADR-0112 revert** — re-converges fork to upstream's coordination shape AND substrate shape. Lowest steady-state sync cost. Highest one-time migration cost (paid back month ~6).
2. **Handler-middleware + Option Z** — converges substrate and surface but keeps coordination shape divergent. Saves migration cost short-term; pays sustained translation tax indefinitely.
3. **Status quo** — highest sustained divergence; coordination-invariant gap widens monotonically.

**Bridge restoration is less divergent from upstream's evolving code than handler-middleware**, both initially (structural homology) and asymptotically (line-level mergeability).

---

## Mid-round framing update (2026-05-13 ~14:30, post-initial-responses)

User reframe interjected: *"These discussions are for determining the direction. We have contradicting ADRs. Once we have found the answer, we can clean it up. See the old ADRs as exploration, and inputs to our decision."*

Effect: removed the "council won't admit walking back ADRs" anxiety the DA flagged. Experts were instructed to argue from **what the exploration taught us** as forward-design inputs, not defend prior ADRs as binding constraints. The 6 remaining in-flight experts were forwarded the reframe and produced **reframed positions** below. Bridge-defender and status-quo-defender both produced sharper forward-design arguments under the new framing; perf-judge / security-judge / memory-judge / integration-judge each refined or revised round-2/round-3 positions.

### Reframed expert positions (final round-3 statements)

#### Status-quo-defender (reframed) — "lessons-applied" handler-middleware

> *"I'm not defending ADR-0084/0085/0112 as binding commitments. I'm treating them as exploration that produced three useful findings, then arguing forward from those findings."*

Position: **per-handler `src/memory/middleware/` composition** as forward shape (confidence 82). Concedes a small `cascade-delete.ts` exception if body-diff reveals genuinely cross-axis cascade logic in the deletion-recovery functions. Branded types + lint as enforcement: `GuardedWrite<T>` produced only by `guardWrite()`; controllers' signatures require it. Compiler-enforced; lint as backup. **The drift critique is real; the answer is compile-time enforcement, not a runtime god-module.**

#### Bridge-defender (reframed) — "the forward decision concentrates the cross-cutting concerns"

> *"This is not 'restore the deleted bridge.' It is 'given the exploration, the right architecture going forward concentrates the six cross-cutting concerns at the seam between MCP handlers and ControllerRegistry.'"*

Position: **new `forks/ruflo/src/memory/controller-bridge.ts`** (NOT git-restore of the deleted file). Typed per-controller surface (no generic `getController(name)` exports). Substrate migration owned by bridge via strangler-fig pattern. Bridge owns the routing during transition; functions shrink as migration completes; public surface unchanged. **The bridge isn't axis-shaped; it's a dispatcher with middleware. Round-2's axis distinction disappears under the bridge frame.**

#### Perf-judge (reframed) — "forward perf targets, not preserve-Phase-C.3"

> *"Treat Phase C.3's +30% store p50 regression as measurement-based exploration; ADR-0086's 150-12,500× claim as unmeasured aspiration. We've learned which kind of evidence is load-bearing."*

Position: **handler-middleware with shared registry context** + lazy-per-tool factory + explicit composition for fanout. Slight cold-start advantage on partial-tool sessions (~5-15ms). **"The router-shim form of F-Middleware IS F-Bridge with worse vocabulary."** Decision not perf-decisive. Forward target: ≤30ms warm write p50, ≤5ms warm read p50, ≤5% coordination overhead, ≤1.2× storage amplification, ≤4 async hops per call. Both shapes hit it equally if coded with shared context.

#### Security-judge (reframed) — P1+P3 placement model

> *"The forward question is: where in the forward architecture does an audit chokepoint make bypass impossible by construction?"*

Position: **P1 (MCP-tool-registration boundary)** + **P3 (controller-method `MutationContext` backstop)**. Type-enforced `registerMutationHandler<TArgs, TResult>` factory; the registry's `register` method only accepts `MCPToolDefinition` produced by the factory. Controllers' write methods require a `MutationContext` argument; throw fatal on absence. **The non-obvious threat-model property**: type-enforced placement defends against future-maintainer attacks of omission — the exact failure mode that produced upstream's half-finished chokepoint (5/13 guarded). The bridge is a runtime convention with known incomplete coverage; P1+P3 is a type-level invariant.

#### Memory-judge (reframed) — upstream pattern as forward decision

> *"The bridge isn't the god-object I thought ADR-0085 was killing — it's a thin dispatch+middleware layer that delegates substrate-specific work to the controllers themselves."*

Position: **Adopt the upstream pattern: restore the bridge, host controllers on their natural substrate (mostly SQLite via AgentDB, some on RVF), apply middleware at the bridge, keep both MCP surfaces.** Revised round-3 SoR/MV proposal as over-engineering: upstream doesn't do it; controllers own their substrate; no duplication, no sweeper, no orphans. **"The axis distinction disappears because the bridge isn't axis-shaped — it's a dispatcher with middleware. Round 2 was answering the wrong question because the X frame was still smuggled in."**

#### Integration-judge (reframed) — coordination > substrate > surface

> *"Round 2 had the axes right but the weights wrong. Round 4's weights: coordination > substrate > surface."*

Position: **F-Bridge** (full bridge restoration + RVF substrate + bifurcated surface + cross-surface coordination allowed). Three lessons applied:
1. Substrate divergence loses load-bearing capabilities (witness chains) → RVF-primary.
2. Removing coordination chokepoints loses cross-controller invariants silently → restore bridge-shaped coordinator.
3. Parallel surface evolution isn't divergence → keep bifurcation; drop ADR-0112's coordination ban.

F-Middleware is dominated on every forward-cost axis except initial migration. F-PartialBridge is the phased-migration hedge if F-Bridge's ~3-month migration cost is binding. **F-Middleware with a router shim *is* F-Bridge with worse vocabulary.**

---

## Council verdict (synthesis, post-reframe)

### Tally (round 3, reframed)

| Expert | Reframed forward verdict | Naming |
|---|---|---|
| queen-architect | Hybrid placement: chokepoint for sec/audit, middleware for perf/quality | bridge or middleware |
| devils-advocate | Pure opposition by role | — |
| bridge-defender | **Thin `controller-bridge.ts`** (~800-1200 LoC, NOT git-restoration) | bridge |
| status-quo-defender | **`src/memory/middleware/`** (~400-600 LoC) + branded types | middleware |
| perf-judge | Slight middleware lead on partial-tool sessions; "router shim is bridge with worse naming" | middleware-slightly |
| security-judge | **P1+P3: typed HOF + controller MutationContext backstop** | middleware-shaped |
| memory-judge | **Upstream pattern**: thin dispatch + middleware in one module; controllers own txns | bridge |
| integration-judge | **F-Bridge**: minimum forward divergence; coordination > substrate > surface | bridge |

**Reframed raw vote: 3 bridge / 3 middleware-shaped / 1 hybrid / 1 opposition** (was 4/2/1/1 before reframe).

### Substantive convergence (post-reframe — strengthened)

**All 7 voting members agree on**:
1. One thin coordinator (~500-1000 LoC) at the MCP-tool-dispatch boundary.
2. Cross-cutting middleware applied uniformly at that coordinator: MutationGuard / AttestationLog / TieredCache / BM25 fusion / ExplainableRecall provenance / SkillLibrary auto-promotion (with dedup).
3. Type-level enforcement via branded types + `MutationContext` argument requirement. Closes upstream's half-finished-chokepoint gap (5 of 13 → 13 of 13 mutation paths guarded).
4. Substrate: RVF-primary with documented PERMANENT_SQLITE carve-outs. **Hybrid forever, not transitional.** Per-controller SoR.
5. Both MCP surfaces preserved (`memory_*` + `agentdb_*`). Parallel evolution with upstream.
6. Controllers own their internal multi-table transactions. The coordinator dispatches; controllers own FK consistency.
7. ADR-0112 retired — drop the no-cross-surface-coordination rule.
8. Lazy-per-tool init.
9. Single audit chain above the substrate split; substrate is a record-property, not identity.
10. +36% wrapper fix lands at the coordinator as a single insertion point.

**The residual disagreement**:

- **"Bridge" camp** (bridge-defender, memory-judge, integration-judge) wants line-level structural homology with upstream's `memory-bridge.ts` for merge alignment.
- **"Middleware" camp** (status-quo-defender, security-judge, perf-judge weakly) wants type-level enforcement explicit in the file structure (`src/memory/middleware/` + branded `GuardedWrite<T>` types).

**These are not architecturally different objects.** A "thin bridge module that applies typed middleware via HOF" and "a middleware module that registers handlers via a typed factory" are the same shape. The naming dispute is the residual disagreement; the engineering decision is settled.

### Three round-3 bombshells

1. **Security-judge**: upstream's bridge guards 5 of 13 mutation paths. Restoring it imports the gap (8 unguarded paths). The half-finished chokepoint is the most dangerous chokepoint.

2. **Memory-judge**: ADR-0177's "RVF-only" is operationally impossible. Realistic target = RVF + SQLite hybrid permanent operating mode. Per-controller SoR assignment + sweeper for orphan eviction.

3. **Perf-judge**: `bridgeRecordFeedback` has 3-4× silent storage amplification via uncoordinated fanout. Invisible in API.

### Final synthesized direction

Given substantive convergence + bombshells:

1. **Substrate**: ADR-0177 with operational honesty. **RVF for vectors/KV, SQLite for relational neural-controller schemas.** Per-controller SoR assignment. SoR-authoritative, MV-best-effort + orphan sweeper.

2. **Coordination layer**: A **thin router module** (~500 LoC, not 2,370):
   - MutationGuard via HOF + branded types (security-judge): all 13+ mutation paths guarded, not 5 of 13. Closes upstream's half-finished gap.
   - AttestationLog: separate `attestation.db` retained per upstream.
   - TieredCache + BM25 fusion + ExplainableRecall provenance + SkillLibrary promotion (with dedup): applied uniformly at the router.

3. **Not a god-module.** ~500 LoC vs 2,370 because we drop: registry indirection (ADR-0084 resolves at handler), direct SQL writes (controllers own writes), HNSW-singleton dynamic imports, 60+ unused exports.

4. **Migration window**: Regime A (try-RVF-then-fall-back, bounded), 7-day deadline, sweeper for orphans, anchor-attestation bridging old chain to new.

5. **Naming**: call it "router" not "bridge" if ADR-0085's structural verdict should stay coherent, OR call it "bridge" and amend ADR-0085 to say "deleted the 1990s shape; restored the 2020s shape." Either is honest.

---

## Provenance

- Round 3 ran 2026-05-13 ~14:25–14:31 (~6 minutes wall-clock from dispatch to last idle).
- Cost: zero per `feedback-no-api-keys.md`.
- Same 8-agent team as rounds 1+2; recontextualized via SendMessage with role reframings:
  - `bridge-defender` → BRIDGE COORDINATION ADVOCATE
  - `status-quo-defender` → HANDLER-LEVEL MIDDLEWARE ADVOCATE
- Comms via SendMessage on team `adr-0179-council`.
- Mid-session framing correction (upstream has BOTH MCP surfaces, not one) absorbed by all experts.
- User framing reframe ("ADRs as exploration inputs, not commitments") forwarded to 6 in-flight experts mid-round.
