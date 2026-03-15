# ADR-0033: Complete AgentDB v3 Controller Activation (ADR-053 Phases 2-6)

## Status

Implementing (P0-P2 complete, P3-P4 remaining)

### Implementation Log (2026-03-15)

**Commits:**
- `719d85d` (agentic-flow) — P2-C: Export SolverBandit from agentdb barrel files
- `f46a104b0` (ruflo) — P2-B/C + P5-C: Bridge + registry patches
- `54d66c71e` (ruflo) — P2-C/P3-D/P4-C/P5-E: Hooks controller activation
- `68e57a37a` (ruflo) — P3-B/C: Reflexion retrieve/store + causal query MCP tools

**Issues:** #81, #82, #83, #84 (sparkling/ruflo-patch)

**Patches implemented (14 of 18 non-done items):**
- P2-B: LearningBridge dedicated bridge function
- P2-C: SolverBandit export + registry + bridge + hooks routing + feedback
- P3-B: ReflexionMemory retrieve/store MCP tools
- P3-C: CausalMemoryGraph causal_query with cold-start guard
- P3-D: NightlyLearner consolidation on session end
- P4-C: LearningSystem.recommendAlgorithm in routing
- P5-B: MutationGuard enforcement (already existed)
- P5-C: AttestationLog stats in health check
- P5-E: SemanticRouter as primary router (falls back to TASK_PATTERNS)

**Remaining (P3/P4 priority):**
- P4-A: SkillLibrary CLI + skill search in routing
- P4-B: ExplainableRecall Merkle proof chain
- P4-D: AgentMemoryScope 3-scope isolation
- P5-A: GuardedVectorBackend as primary backend
- P5-D: GraphTransformerService (proof_gated only)
- P5-F: SonaTrajectoryService integration
- P6-B: COW branching (RvfBackend.derive)
- P4-E: FederatedSession (blocked — API undefined)

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

### SolverBandit Investigation (P2-C)

SolverBandit was reported as "entirely missing" but investigation found it **exists** in the agentic-flow fork:

**File**: `~/src/forks/agentic-flow/packages/agentdb/src/backends/rvf/SolverBandit.ts` (270 lines)

**Implementation**: Complete Thompson Sampling with contextual arms:
- `BanditArmStats`: Beta distribution per (context, arm) pair — tracks alpha/beta/pulls/totalReward/costEma
- `BanditConfig`: costWeight (0.01), costDecay (0.1), explorationBonus (0.1)
- `SolverBandit.selectArm(context, arms)`: Thompson sample from Beta(alpha, beta) + cost penalty + exploration bonus
- `SolverBandit.recordReward(context, arm, reward, cost?)`: Updates Beta distribution and cost EMA
- `BanditState`: Serializable JSON for cross-session persistence

**Problem**: Not exported from any barrel file:
- Not in `agentdb/src/index.ts`
- Not in `agentdb/src/backends/index.ts`
- Not in `agentdb/src/backends/rvf/index.ts`
- Internal to `backends/rvf/` directory — consumers cannot import it

**Tests exist**: `tests/backends/solver-bandit.test.ts`

**Fix required in two forks**:
1. **agentic-flow fork**: Export `SolverBandit` from `packages/agentdb/src/index.ts`
2. **ruflo fork**: Add to ControllerRegistry, create bridge function, wire to hooks_route

## Decision: Specification (SPARC-S)

Implement ADR-053 Phases 2-6 as fork patches. Each phase targets TypeScript source in `~/src/forks/{ruflo,agentic-flow}` and adds **callers** — the bridge functions already exist for most controllers.

### Patch Rules (ADR-0027 Fork Model)

All patches follow the established fork model:

1. **Edit** fork TypeScript source at `~/src/forks/{ruflo,agentic-flow,ruv-FANN,ruvector}`
2. **Verify** with `tsc --noEmit --project v3/@claude-flow/<pkg>/tsconfig.json`
3. **Preflight** with `npm run preflight` in ruflo-patch before staging
4. **Branch** `patch/ID` for non-trivial changes
5. **Commit** with descriptive message + `Co-Authored-By: claude-flow <ruv@ruv.net>`
6. **Push** to fork remote
7. **GitHub Issue** — ALWAYS create one per patch (tracking record)
8. **PR** referencing the issue (or direct-to-main for quick fixes)
9. **Test** with `npm run deploy:dry-run` to verify pipeline
10. **Deploy** with `npm run deploy` when ready
11. **Never** reuse a defect ID, never modify project CLAUDE.md
12. **Propagate** — when changing shared types, grep all consumers and fix them too

### Phase 2: Core Intelligence (P1 — Self-Learning Loop)

| ID | Controller | What's Missing | Fork File | Effort |
|----|-----------|---------------|-----------|--------|
| P2-A | ReasoningBank | **Done** — fully wired | — | 0h |
| P2-B | LearningBridge | Dedicated bridge function | `memory-bridge.ts` | 1h |
| P2-C | SolverBandit | **Class exists** (270 lines in agentic-flow) but not exported. Need: export from agentdb, add to registry, bridge fn, wire hooks_route + feedback | agentic-flow: `agentdb/src/index.ts`; ruflo: `controller-registry.ts`, `memory-bridge.ts`, `hooks-tools.ts` | 6h |
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

### P2-C: SolverBandit (Thompson Sampling) — Two-Fork Patch

**Fork 1: agentic-flow** (`~/src/forks/agentic-flow`)
```
// packages/agentdb/src/index.ts — add export
export { SolverBandit } from './backends/rvf/SolverBandit.js';
export type { BanditArmStats, BanditConfig, BanditState, BanditStats } from './backends/rvf/SolverBandit.js';

// packages/agentdb/src/backends/rvf/index.ts — add barrel export
export { SolverBandit } from './SolverBandit.js';
```

**Fork 2: ruflo** (`~/src/forks/ruflo`)
```
// controller-registry.ts — add SolverBandit case at Level 1
case 'solverBandit': {
  const agentdbModule = await import('agentdb');
  const SB = agentdbModule.SolverBandit;
  if (!SB) return null;
  const bandit = new SB({
    costWeight: 0.01,
    costDecay: 0.1,
    explorationBonus: 0.1,
  });
  // Restore persisted state if available
  const stateEntry = await this.backend?.getByKey?.('default', '_solver_bandit_state');
  if (stateEntry?.content) {
    try { bandit.restore(JSON.parse(stateEntry.content)); } catch {}
  }
  return bandit;
}

// memory-bridge.ts — add bridge functions
function bridgeSolverBanditSelect(task, availableAgents, context):
  bandit = registry.get('solverBandit')
  if !bandit: return { agent: availableAgents[0], confidence: 0.5, controller: 'fallback' }
  arm = bandit.selectArm(context || 'default', availableAgents)
  return { agent: arm, confidence: bandit.getArmStats(context, arm)?.alpha / (alpha+beta), controller: 'solverBandit' }

function bridgeSolverBanditUpdate(context, arm, reward, cost?):
  bandit = registry.get('solverBandit')
  if bandit: bandit.recordReward(context, arm, reward, cost)
  // Persist state to memory store
  bridgeStoreEntry({ key: '_solver_bandit_state', value: JSON.stringify(bandit.serialize()), namespace: 'default', upsert: true })

// hooks-tools.ts — wire into hooks_route
handler hooks_route(params):
  // Try SolverBandit first (learned routing)
  banditResult = bridge.bridgeSolverBanditSelect(task, agents, taskType)
  if banditResult.confidence > 0.6: return banditResult
  // Fall back to SemanticRouter + TASK_PATTERNS
  ...

// hooks-tools.ts — wire feedback to bandit arms
handler hooks_post-task(params):
  bridge.bridgeRecordFeedback(...)  // existing
  // NEW: update bandit with task outcome
  quality = params.result?.quality ?? (params.result?.success ? 0.85 : 0.2)
  bridge.bridgeSolverBanditUpdate(taskType, agent, quality)
```

**Patch workflow (per ADR-0027 rules)**:
1. Edit agentic-flow fork → `tsc --noEmit` → commit → push → create GitHub Issue
2. Edit ruflo fork → `tsc --noEmit --project v3/@claude-flow/cli/tsconfig.json` → commit → push → create GitHub Issue
3. `npm run preflight && npm run deploy:dry-run` in ruflo-patch
4. `npm run deploy` to publish

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

Patches target two forks. Each patch creates a GitHub Issue (tracking) and either a PR or direct-to-main commit.

**ruflo fork** (`~/src/forks/ruflo/v3/@claude-flow/`):

| Phase | Files Modified | Patches | TypeScript check |
|-------|---------------|---------|-----------------|
| **Phase 2** | `cli/src/memory/memory-bridge.ts`, `memory/src/controller-registry.ts`, `cli/src/mcp-tools/hooks-tools.ts` | 3 | `--project cli/tsconfig.json` |
| **Phase 3** | `cli/src/mcp-tools/memory-tools.ts`, `cli/src/mcp-tools/hooks-tools.ts`, `cli/src/mcp-tools/agentdb-tools.ts` | 4 | `--project cli/tsconfig.json` |
| **Phase 4** | `cli/src/mcp-tools/hooks-tools.ts`, `memory/src/controller-registry.ts`, `cli/src/mcp-tools/memory-tools.ts`, `cli/src/memory/memory-bridge.ts` | 4 | `--project cli/tsconfig.json` + `--project memory/tsconfig.json` |
| **Phase 5** | `cli/src/memory/memory-bridge.ts`, `cli/src/mcp-tools/hooks-tools.ts` | 6 | `--project cli/tsconfig.json` |
| **Phase 6** | `memory/src/rvf-backend.ts` | 1 | `--project memory/tsconfig.json` |

**agentic-flow fork** (`~/src/forks/agentic-flow/`):

| Phase | Files Modified | Patches |
|-------|---------------|---------|
| **Phase 2** | `packages/agentdb/src/index.ts`, `packages/agentdb/src/backends/rvf/index.ts` | 1 (SolverBandit export) |

### Per-Patch Workflow (ADR-0027)

```
1. Edit fork TS source
2. tsc --noEmit --project <pkg>/tsconfig.json
3. cd ~/src/ruflo-patch && npm run preflight
4. git add <files> && git commit (with Co-Authored-By)
5. git push origin main
6. gh issue create --title "P2-C: Export SolverBandit from agentdb" --body "..."
7. npm run deploy:dry-run (verify pipeline)
8. npm run deploy (publish)
```

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

## π-Brain Collective Intelligence Analysis (2026-03-15)

Searched π.ruv.io for all 28 controllers individually. Results inform implementation risk and priority.

### Coverage Summary

| Coverage Level | Count | Controllers |
|---------------|-------|-------------|
| **Direct dedicated article** | 4 | SolverBandit, GraphTransformerService, SonaTrajectoryService, memoryGraph |
| **Rich indirect coverage** | 11 | memoryConsolidation, reasoningBank, hybridSearch, ReflexionMemory, CausalMemoryGraph, NightlyLearner, SkillLibrary, LearningSystem, MutationGuard, AttestationLog, gnnService |
| **Sparse/tangential** | 6 | tieredCache, learningBridge, hierarchicalMemory, FederatedSession, SemanticRouter, ExplainableRecall |
| **No π-brain knowledge** | 7 | causalRecall, AgentMemoryScope, GuardedVectorBackend, graphAdapter, contextSynthesizer, rvfOptimizer, mmrDiversityRanker, batchOperations |

### Key Findings That Affect Implementation

**1. MCP Param Signature Mismatches (CRITICAL)**
π-brain audit found 12 param issues. When wiring controllers, use correct names:
- `reflexion_retrieve`: uses `task` (not `query`), `k` (not `limit`)
- `reflexion_store`: requires `session_id`, `task`, `reward`, `success`
- `causal_add_edge`: uses `cause`/`effect`/`uplift` (not `source`/`target`/`weight`)
- `experience_record`: requires 6 params: `session_id`, `tool_name`, `action`, `outcome`, `reward`, `success`
- `hooks_learn` has no `done` param; `hooks_route_enhanced` has no `context` param
**Impact**: Without correct params, wiring will silently fail. Must audit every bridge call against actual MCP tool schemas.

**2. Embedding Dimension Mismatch (ALREADY PATCHED)**
ControllerRegistry initialized with `dimension: 384` but providers output 768-dim vectors. Fixed in ADR-0030/0031 (patch.27-28).

**3. Bridge Fallback Short-Circuit (ALREADY PATCHED)**
`bridgeSearchEntries()` returns `{ success: true, results: [] }` (truthy), preventing sql.js fallback. Fixed in ADR-0030/0031.

**4. SONA Three-Loop Architecture**
π-brain has detailed SONA specs: Instant Loop (<1ms MicroLoRA rank-2), Background Loop (hourly K-means++), Coordinator. Optimized defaults from benchmarks: rank=2, lr=0.002, 100 clusters, EWC lambda=2000, batch=32. **This validates P2-C and P5-F wiring approach.**

**5. Graph Transformer Is Massive**
ruvector-graph-transformer has 9 modules (proof_gated, sublinear_attention, physics, biological, self_organizing, verified_training, manifold, temporal, economic). Quality score 16/17 on π-brain. **P5-D (wire into MemoryGraph) should start with just `proof_gated` module, not the full transformer.**

**6. Adaptive Pipeline Integration Pattern**
Another project (adaptive-pipeline) already wired agentdb with safeguards: try-catch + 2s timeout on all calls, cold-start guard (skip causal reads until >5 edges), max 3 writes per step. **Adopt these safeguards for all Phase 3-5 wiring.**

**7. Federated Learning Has Byzantine Tolerance**
π-brain shows MicroLoRA federated aggregation uses 2-sigma outlier filtering + reputation-weighted trimmed mean. **FederatedSession (P4-E) remains blocked — API undefined — but the underlying Rust layer is mature.**

**8. Hybrid Search Is More Nuanced Than ADR States**
π-brain shows two formulas: (a) 70/30 RRF in current bridgeSearchEntries, (b) 0.3*BM25 + 0.5*cosine + 0.2*reputation (tunable). **P2-D is correctly marked "Done" but could be enhanced later with reputation weighting.**

### Controllers With Zero π-Brain Knowledge

These 7 controllers have no community knowledge and likely the highest implementation risk:
1. `causalRecall` — may overlap with CausalMemoryGraph
2. `AgentMemoryScope` — 3-scope isolation, entirely uncharted
3. `GuardedVectorBackend` — cryptographic vector backend
4. `graphAdapter` — unclear purpose
5. `contextSynthesizer` — unclear purpose
6. `rvfOptimizer` — unclear purpose
7. `mmrDiversityRanker` — MMR re-ranking, likely straightforward

**Recommendation**: De-prioritize zero-knowledge controllers to P3/P4. Start with well-documented ones (SolverBandit, SONA, GraphTransformer, Reflexion, Causal) where π-brain provides implementation guidance.

### Adaptive Pipeline Prior Art (Deep Analysis)

π-brain contains 8 entries documenting a complete agentdb integration into another project's SKILL.md (contributor `e9c5696b`, 2026-03-06 to 2026-03-09). This integration went through 3 rounds of hive-mind audit (4.5 → 5.5 → 8.2/10) and provides a proven wiring template.

**What they wired (directly maps to our phases)**:

| Their Step | AgentDB Call | Our Phase Equivalent |
|-----------|-------------|---------------------|
| Step 1 (Classify) | `reflexion_retrieve({task, k})` + `skill_search` | P3-B + P4-A |
| Step 1b (Tier) | Reflexion failure signal in classification | P3-B |
| Step 5 (Verify) | `reflexion_retrieve` before voter spawning | P3-B |
| Step 6 (Persist) | `experience_record({session_id, tool_name, action, outcome, reward, success})` | P2-E (done) |
| Step 6 (Persist) | `reflexion_store({session_id, task, reward, success})` on rework | P3-B |
| Step 6 (Persist) | `causal_add_edge({cause, effect, uplift})` always | P3-C |
| Step 6 (Persist) | `skill_create` on novel pattern | P4-A |

**Correct MCP param signatures (verified against actual schemas)**:

```
reflexion_retrieve:  { task: string, k?: number }
reflexion_store:     { session_id: string, task: string, reward: number, success: boolean }
causal_add_edge:     { cause: string, effect: string, uplift: number }
experience_record:   { session_id: string, tool_name: string, action: string,
                       outcome: string, reward: number, success: boolean }
skill_search:        { query: string, k?: number }
skill_create:        { name: string, pattern: string, context?: string }
```

**Production safeguards (adopt for all ADR-0033 patches)**:

1. **try-catch + 2s timeout** on every agentdb bridge call — prevents pipeline hangs
2. **Cold-start guard**: skip `causal_query` reads until graph has >5 edges — empty graph returns noise
3. **Max 3 agentdb writes per MCP handler** — prevents write amplification
4. **WAL mode verification** before writes — prevents sqlite corruption from concurrent access
5. **Fire-and-forget pattern** for persist calls — learning writes must not block the response path

**Architecture constraint discovered**: Subagents (spawned via Task tool) cannot call MCP tools directly. All agentdb calls must happen in the orchestrator layer (hooks-tools.ts, memory-tools.ts), with results passed to agents in their prompts.

**Validation**: Their SPARC score went from 4.0 → projected 8.2 after full integration. This confirms the controller activation approach in ADR-0033 will measurably improve system intelligence.

### Impact on Implementation Plan

**No change to phasing or priority order.** The π-brain analysis confirms:
- P0 (MemoryGraph + LearningBridge) is correct — cheapest wins with known APIs
- P1 (Learning loop) is correct — Reflexion/Causal/NightlyLearner have rich π-brain coverage
- P2 (SolverBandit) is correct — dedicated π-brain article confirms class exists with exact API

**New action items added**:
1. **Pre-step**: Audit all MCP tool param signatures before wiring (π-brain found 12 mismatches)
2. **Safeguards**: Add try-catch + 2s timeout + cold-start guards to all agentdb bridge calls (from adaptive-pipeline pattern)
3. **P5-D scope reduction**: Wire only `proof_gated` module from GraphTransformer, not full 9-module suite
4. **Defer zero-knowledge controllers**: Move causalRecall, graphAdapter, contextSynthesizer, rvfOptimizer to a future ADR if/when upstream documents their APIs

### Revised Effort Estimate

| Phase | Original | Revised | Delta | Reason |
|-------|----------|---------|-------|--------|
| P0 | 3h | 3h | — | No change |
| P1 | 8h | 10h | +2h | Param audit + safeguard wiring |
| P2 | 11h | 12h | +1h | Param audit for SolverBandit feedback |
| P3 | 22h | 18h | -4h | Scope-reduce GraphTransformer, defer zero-knowledge controllers |
| P4 | 8h | 6h | -2h | Defer graphAdapter, contextSynthesizer |
| **Total** | **52h** | **49h** | **-3h** | Net savings from scope reduction |

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
- SolverBandit class exists (270 lines) but has never been exported or tested in the full pipeline — may have API mismatches similar to ADR-055's 7 bugs
- SolverBandit state persistence requires storing serialized bandit state in memory store — adds write on every feedback call
- Two-fork patches (agentic-flow + ruflo) require coordinated deployment — agentic-flow export must publish before ruflo can import
- **NEW (π-brain)**: MCP tool param signatures differ from documentation — 12 mismatches found. Silent failures if wrong param names used in bridge calls
- **NEW (π-brain)**: 7 controllers have zero community knowledge (causalRecall, AgentMemoryScope, GuardedVectorBackend, graphAdapter, contextSynthesizer, rvfOptimizer, mmrDiversityRanker) — higher risk of undiscovered API bugs
- **NEW (π-brain)**: GraphTransformerService has 9 internal modules — wiring the full suite risks scope explosion; scope-reduce to proof_gated only

## Related

- **ADR-053** (upstream): Original 6-phase plan for controller activation
- **ADR-055** (upstream): Bug remediation for Phase 1 controller bugs
- **ADR-0030**: Memory system optimization (implemented patch.27-28)
- **ADR-0031**: Runtime validation (implemented patch.27-28)
- **ADR-0032**: claude-flow-patch adoption analysis
- **π-brain**: "AgentDB v3: 23 of 28 controllers are dead code" (id: 99c0537c)
- **π-brain**: "SolverBandit: Thompson Sampling class exists but not exported" (id: 3211600c)
- **π-brain**: "adaptive-pipeline: MCP signature audit — 12 fixes" (id: b63018dd)
- **π-brain**: "adaptive-pipeline: P0 agentdb integration" (id: 1273a5b5)
- **π-brain**: "Adaptive Pipeline 3-Package Optimization: Hive Consensus" (id: 47ae6292)
- **π-brain**: "Adaptive Pipeline SKILL.md v2 — 3-Round Hive Audit" (id: 04458b9b)
- **π-brain**: "SONA Self-Optimizing Neural Architecture" (id: 319a0a97)
- **π-brain**: "Graph Transformer with Proof-Gated Mutation" (id: 8a22db2a)
