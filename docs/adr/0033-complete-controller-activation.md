# ADR-0033: Complete AgentDB v3 Controller Activation (ADR-053 Phases 2-6)

## Status

Proposed

## Date

2026-03-15

## Deciders

sparkling team

## Methodology

SPARC (Specification, Pseudocode, Architecture, Refinement, Completion) + MADR

## Context

Upstream ADR-053 planned 6 phases to activate 28 AgentDB v3 controllers. Only Phase 1 (ControllerRegistry infrastructure) was completed. The remaining phases (2-6) were deferred as upstream pivoted to RVF storage (ADR-057/058) and bug triage (ADR-059/060).

### Current State (patch.28)

**Working controllers (5 of 28):**

| Controller | Init Level | Bridge Functions | MCP Tools | Hooks Callers |
|-----------|-----------|-----------------|-----------|---------------|
| `tieredCache` | 1 | Implicit (cacheGet/cacheSet) | — | Automatic |
| `memoryGraph` | 2 | **0** (enabled but never called) | — | — |
| `learningBridge` | 1 | 0 (indirect via getController) | — | 1 indirect |
| `hierarchicalMemory` | 1 | 3 (store/recall/consolidate) | 3 | — |
| `memoryConsolidation` | 3 | 1 (consolidate) | 1 | — |

**Dead controllers (23 of 28):** Not enabled in config, return null stubs, or have zero callers.

**Bridge infrastructure:** 30 exported functions exist in memory-bridge.ts. Many bridge functions exist for controllers that are instantiated but never called from MCP tools or hooks.

### Decision Drivers

1. 23 controllers are dead code — exported, instantiated, but never exercised
2. MCP intelligence_stats shows 0 routing decisions, 0 consolidations, 0 adaptations
3. The bridge layer has functions for most controllers but hooks/MCP tools don't call them
4. Phase 2's SolverBandit (Thompson Sampling for routing) is entirely missing (#1217)
5. MemoryGraph is enabled but has 0 callers — graph-aware ranking never activates

## Decision: Specification (SPARC-S)

Implement ADR-053 Phases 2-6 as fork patches in `~/src/forks/ruflo`. Each phase targets specific files in the TypeScript source and adds **callers** — the bridge functions already exist for most controllers.

### Phase 2: Core Intelligence (P1 — Self-Learning Loop)

| ID | Controller | What's Missing | Fork File | Effort |
|----|-----------|---------------|-----------|--------|
| P2-A | ReasoningBank | **Done** — fully wired | — | 0h |
| P2-B | LearningBridge | Dedicated bridge function | `memory-bridge.ts` | 1h |
| P2-C | SolverBandit | **Entirely missing** — no class, no export, no wiring | `controller-registry.ts`, `memory-bridge.ts`, `hooks-tools.ts` | 6h |
| P2-D | HybridSearch (BM25) | **Done** — implicit in bridgeSearchEntries (70/30 RRF) | — | 0h |
| P2-E | recordFeedback | **Done** — triple-redundancy callers | — | 0h |

### Phase 3: Advanced Memory (P2 — Graph & Episodic)

| ID | Controller | What's Missing | Fork File | Effort |
|----|-----------|---------------|-----------|--------|
| P3-A | MemoryGraph | **0 callers** despite being enabled. Need addNode on store, getImportance on search | `memory-tools.ts` | 2h |
| P3-B | ReflexionMemory | Session lifecycle wired but no MCP tool for recall | `agentdb-tools.ts` | 1h |
| P3-C | CausalMemoryGraph | Edge recording wired but no experiment tracking | `hooks-tools.ts` | 2h |
| P3-D | NightlyLearner | Not wired to daemon consolidate worker | `hooks-tools.ts` | 2h |

### Phase 4: Specialization (P3 — Skill & Scope)

| ID | Controller | What's Missing | Fork File | Effort |
|----|-----------|---------------|-----------|--------|
| P4-A | SkillLibrary | Promotion wired. Missing: skill creation CLI, skill search in routing | `hooks-tools.ts` | 3h |
| P4-B | ExplainableRecall | Only score provenance. Missing: Merkle proof chain | `memory-bridge.ts` | 4h |
| P4-C | LearningSystem (9-RL) | Feedback wired. Missing: recommendAlgorithm in routing | `hooks-tools.ts` | 3h |
| P4-D | AgentMemoryScope | Stub returns null. Missing: 3-scope isolation implementation | `controller-registry.ts`, `memory-tools.ts` | 4h |
| P4-E | FederatedSession | **Blocked** — API not defined upstream | — | blocked |
| P4-F | TieredCacheManager | **Done** — fully wired | — | 0h |

### Phase 5: Proof-Gated Intelligence (P3 — Cryptographic Integrity)

| ID | Controller | What's Missing | Fork File | Effort |
|----|-----------|---------------|-----------|--------|
| P5-A | GuardedVectorBackend | Not wired into HybridBackend as primary | `memory-bridge.ts` | 6h |
| P5-B | MutationGuard | Phase 2 helper exists but not enforced on all paths | `memory-bridge.ts` | 3h |
| P5-C | AttestationLog | No health check integration | `memory-bridge.ts` | 2h |
| P5-D | GraphTransformerService | Not wired into MemoryGraph | `memory-bridge.ts` | 4h |
| P5-E | SemanticRouter | Not used in hooks_route (still uses static TASK_PATTERNS) | `hooks-tools.ts` | 4h |
| P5-F | SonaTrajectoryService | Not integrated into intelligence.js | `hooks-tools.ts` | 4h |

### Phase 6: MCP Surface (P3 — Agent-Facing)

| ID | Controller | What's Missing | Fork File | Effort |
|----|-----------|---------------|-----------|--------|
| P6-A | agentdb_* MCP tools (15) | **Done** — 15 tools implemented in agentdb-tools.ts | — | 0h |
| P6-B | COW branching tool | RvfBackend.derive() not implemented | `rvf-backend.ts` | 5h |

## Decision: Pseudocode (SPARC-P)

### P2-C: SolverBandit (Thompson Sampling)

```
// controller-registry.ts — add SolverBandit case
case 'solverBandit':
  if (!agentdb) return null
  // Check if SolverBandit exported from agentdb
  SB = await import('agentdb').SolverBandit
  if (!SB) return null
  return new SB(agentdb.database, { arms: AGENT_TYPES })

// memory-bridge.ts — add bridge function
function bridgeSolverBanditSelect(task, availableAgents, context):
  bandit = registry.get('solverBandit')
  if bandit: return bandit.selectArm(task, availableAgents)
  return fallback: first agent, confidence 0.5

// hooks-tools.ts — wire into hooks_route
handler hooks_route(params):
  // Try SolverBandit first (learned routing)
  banditResult = bridge.bridgeSolverBanditSelect(task, agents)
  if banditResult.confidence > 0.6: return banditResult
  // Fall back to SemanticRouter + TASK_PATTERNS
  ...

// hooks-tools.ts — wire feedback to bandit
handler hooks_post-task(params):
  bridge.bridgeRecordFeedback(...)  // existing
  bridge.bridgeSolverBanditUpdate(taskId, agent, quality)  // new
```

### P3-A: MemoryGraph Callers

```
// memory-tools.ts — wire into memory_store
handler memory_store(input):
  result = storeEntry(...)
  // NEW: Register node in graph
  mg = bridgeGetController('memoryGraph')
  if mg: mg.addNode(key, { namespace, tags })

// memory-tools.ts — wire into memory_search
handler memory_search(input):
  results = searchEntries(...)
  // NEW: Boost by graph importance
  mg = bridgeGetController('memoryGraph')
  if mg:
    for r in results:
      importance = mg.getImportance(r.key)
      r.similarity += importance * 0.1
```

### P5-B: MutationGuard Enforcement

```
// memory-bridge.ts — enforce on all store/update/delete
function bridgeStoreEntry(options):
  // Phase 5: MutationGuard validation BEFORE write
  guardResult = guardValidate(registry, 'store', { key, namespace, size })
  if !guardResult.allowed:
    return { success: false, error: 'MutationGuard: ' + guardResult.reason }
  // Proceed with store...
  // Phase 5: Log attestation AFTER write
  logAttestation(registry, 'store', id, { key, namespace })
```

## Decision: Architecture (SPARC-A)

### Patch Mapping

All patches target the ruflo fork at `~/src/forks/ruflo/v3/@claude-flow/cli/src/`.

| Phase | Files Modified | Total Patches |
|-------|---------------|--------------|
| **Phase 2** | `memory-bridge.ts`, `controller-registry.ts`, `hooks-tools.ts` | 3 |
| **Phase 3** | `memory-tools.ts`, `hooks-tools.ts`, `agentdb-tools.ts` | 4 |
| **Phase 4** | `hooks-tools.ts`, `controller-registry.ts`, `memory-tools.ts`, `memory-bridge.ts` | 4 |
| **Phase 5** | `memory-bridge.ts`, `hooks-tools.ts` | 6 |
| **Phase 6** | `rvf-backend.ts` (in `@claude-flow/memory/src/`) | 1 |

### Dependencies

```
Phase 2 (Core Intelligence)
├─ P2-C SolverBandit ──→ depends on agentdb export (check first)
├─ P2-B LearningBridge ──→ independent
└─ P2-D, P2-E ──→ already done

Phase 3 (Advanced Memory) — can start in parallel with Phase 2
├─ P3-A MemoryGraph ──→ independent
├─ P3-B ReflexionMemory ──→ independent
├─ P3-C CausalMemoryGraph ──→ independent
└─ P3-D NightlyLearner ──→ depends on daemon wiring

Phase 4 (Specialization) — after Phase 2 for routing
├─ P4-A SkillLibrary ──→ needs Phase 2 feedback loop
├─ P4-C LearningSystem ──→ needs Phase 2 routing
├─ P4-B ExplainableRecall ──→ independent
└─ P4-D AgentMemoryScope ──→ independent

Phase 5 (Proof-Gated) — after Phase 3 for graph
├─ P5-A GuardedVectorBackend ──→ needs Phase 1 backend
├─ P5-B MutationGuard ──→ independent
├─ P5-D GraphTransformer ──→ needs P3-A MemoryGraph
└─ P5-E SemanticRouter ──→ after P2-C SolverBandit

Phase 6 (MCP Surface) — after Phase 5
└─ P6-B COW branching ──→ needs RvfBackend work
```

### Implementation Priority

| Priority | Items | Total Effort | Impact |
|----------|-------|-------------|--------|
| **P0** | P3-A (MemoryGraph callers), P2-B (LearningBridge wrapper) | 3h | Activates 2 enabled-but-unused controllers |
| **P1** | P3-B/C/D (Reflexion, Causal, NightlyLearner), P4-C (LearningSystem routing) | 8h | Closes self-learning feedback loop |
| **P2** | P2-C (SolverBandit), P5-B/C (MutationGuard, Attestation) | 11h | Learned routing + security |
| **P3** | P4-B/D (ExplainableRecall, AgentMemoryScope), P5-A/D/E/F | 22h | Advanced features |
| **P4** | P6-B (COW branching), P4-A (SkillLibrary CLI) | 8h | Optimization + tooling |
| **Blocked** | P4-E (FederatedSession) | — | Upstream API undefined |

**Total estimated effort: ~52 hours across all phases.**

## Decision: Refinement (SPARC-R)

### What to do first

**Start with P0 (3 hours):** MemoryGraph callers + LearningBridge wrapper. These are the cheapest wins — controllers already enabled and instantiated, just need callers added. Immediately observable in `intelligence_stats`.

**Then P1 (8 hours):** Close the learning loop. ReflexionMemory, CausalMemoryGraph, NightlyLearner, and LearningSystem routing are all partially wired with bridge functions. Adding callers in hooks-tools.ts completes the RETRIEVE→JUDGE→DISTILL→CONSOLIDATE pipeline.

**SolverBandit (P2-C) requires investigation first:** Check if `SolverBandit` is exported from the agentdb package in our fork. If not, we'd need to implement or find it. Do not start Phase 2-C until this is confirmed.

### Validation

After each phase, verify via MCP tools:
- `intelligence_stats` should show non-zero values for activated controllers
- `memory_search` should show graph-boosted scores (Phase 3)
- `hooks_route` should show learned routing decisions (Phase 2)
- `agentdb_health` should show all activated controllers in health report

### Regression guards

- `npm test` (120 unit tests) must pass after each phase
- `npm run test:verify` (16 acceptance) must pass before deploy
- `tsc --noEmit` for each fork must pass

## Decision: Completion (SPARC-C)

### Implementation as fork patches

Each phase creates patches in `~/src/forks/ruflo` (TypeScript source), committed to fork main, deployed via `npm run deploy`. No runtime patching.

### Estimated timeline

| Phase | Effort | Can parallelize with |
|-------|--------|---------------------|
| P0 (MemoryGraph + LearningBridge) | 3h | — |
| P1 (Learning loop) | 8h | — |
| P2 (SolverBandit + Security) | 11h | P1 |
| P3 (Advanced) | 22h | P2 |
| P4 (Optimization) | 8h | P3 |
| **Total** | **52h** | — |

### Success criteria

| Metric | Current | After P0 | After P1 | After All |
|--------|---------|----------|----------|-----------|
| Active controllers | 5/28 | 7/28 | 12/28 | 25/28 |
| MoE routing decisions | 0 | 0 | >0 | Learned |
| EWC++ consolidations | 0 | 0 | >0 | Regular |
| Graph nodes | 0 | >0 | >10 | All entries |
| Search quality (importance boost) | 0% | 5-10% | 10-15% | 15-25% |
| Controllers with 0 callers | 23 | 21 | 16 | 3 |

## Consequences

### Positive

- Activates $200K+ worth of upstream AgentDB engineering that's currently dead code
- Self-learning loop closes — system improves over sessions
- Graph-aware ranking improves search relevance
- Proof-gated mutations add security guarantees
- Learned routing replaces static pattern matching

### Negative

- 52 hours of integration work across 5 fork files
- Some controllers may have undiscovered API bugs (ADR-055 found 7 in Phase 1 alone)
- SolverBandit may not be exported from agentdb (blocker for learned routing)

### Risks

- Controller instantiation may fail silently (all have null fallbacks — by design)
- Performance impact of 28 active controllers unknown (may need lazy loading)
- FederatedSession API undefined upstream (blocked indefinitely)

## Related

- **ADR-053** (upstream): Original 6-phase plan for controller activation
- **ADR-055** (upstream): Bug remediation for Phase 1 controller bugs
- **ADR-0030**: Memory system optimization (implemented patch.27-28)
- **ADR-0031**: Runtime validation (implemented patch.27-28)
- **ADR-0032**: claude-flow-patch adoption analysis
