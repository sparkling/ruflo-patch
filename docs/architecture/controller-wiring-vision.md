# The Upstream Author's Solutions Architecture for Controller Wiring

**Date**: 2026-04-05
**Synthesized from**: ruvnet/ruflo (controller-registry.ts, memory-bridge.ts), ruvnet/agentic-flow (AgentDB.ts, embedding-config.ts), inline ADR comments, upstream issues #1228, #1516

---

## 1. The Upstream Author's Architectural Intent

The upstream codebase contains a two-tier controller model, documented explicitly in the controller-registry.ts module header (line 4): "Wraps the AgentDB class and adds CLI-specific controllers from @claude-flow/memory."

The type system encodes this intent precisely. Two disjoint union types partition the controller namespace:

- `AgentDBControllerName` (controller-registry.ts:34-49) lists 15 names for core data controllers: reasoningBank, skills, reflexion, causalGraph, causalRecall, learningSystem, explainableRecall, nightlyLearner, graphTransformer, mutationGuard, attestationLog, vectorBackend, graphAdapter, queryOptimizer, auditLogger.

- `CLIControllerName` (controller-registry.ts:54-85) lists 31 names for orchestration infrastructure: attention services, caching, routing, security, SONA, federated learning, and GNN services.

The `get<T>()` method (controller-registry.ts:422-440) implements the intended resolution order: check CLI-layer controllers first, then fall back to `agentdb.getController()`. This is delegation with override -- the registry can substitute its own instance for any AgentDB controller, but defaults to AgentDB's version if no override exists.

The initialization ordering is specified in `INIT_LEVELS` (controller-registry.ts:217-252) as seven levels (0-6). Level 0 is security infrastructure (resourceTracker, rateLimiter, circuitBreaker). Levels 1-2 are intelligence and graph services. Level 3 is specialization (skills, reflexion, causalGraph). Level 4 is routing and self-learning (nightlyLearner, learningSystem). Level 5 is advanced services. Level 6 is session management. The comment at level 3 (line 233) records a dependency fix: "causalGraph moved here from L4 -- ADR-0062 P0-1: nightlyLearner depends on it." This confirms the author intended careful dependency ordering across tiers.

The config design centers on `getEmbeddingConfig()` in agentdb's `embedding-config.ts` as the single source of truth for dimension and model. AgentDB.ts:97-100 calls it during initialization. The ADR-0064 comment at controller-registry.ts:293 states: "Resolved dimension from config -> getEmbeddingConfig() -> 768 fallback." The intent was a layered resolver: explicit config overrides environment variables overrides embeddings.json overrides hardcoded defaults.

## 2. Where the Design Was Incomplete

Three structural gaps exist where decisions were deferred or contradicted by subsequent implementation.

**Gap 1: AgentDB was never made lazy.** AgentDB.initialize() (AgentDB.ts:72-181) eagerly constructs all 8 domain controllers unconditionally at lines 153-160. There is no mechanism to suppress this, no lazy-init pattern, and no way for an outer container to inject pre-created instances. The ADR-0040 pattern (accept optional singletons in constructors) was applied to NightlyLearner and CausalRecall at the class level but never to AgentDB.initialize() itself. At lines 157 and 160, AgentDB constructs both CausalRecall and NightlyLearner WITHOUT passing the singletons it already holds (causalGraph at line 156, reflexion at line 153, skills at line 154). This is not a bug in the controller classes -- their constructors accept the singletons. It is a gap in the caller.

**Gap 2: The registry works around AgentDB rather than through it.** The comment at controller-registry.ts:883 acknowledges the constraint: "AgentDB.getController() only supports: reflexion/memory, skills, causalGraph/causal." For the remaining 5 AgentDB-tier controllers (reasoningBank, causalRecall, learningSystem, explainableRecall, nightlyLearner), the registry constructs fresh instances using `new X(this.agentdb.database, ...)` at lines 888-953. This creates a second copy of each controller. The registry's nightlyLearner case (lines 946-953) correctly passes singletons via `this.get()`, implementing ADR-0040 properly -- but the AgentDB-internal copy at AgentDB.ts:160 does not. Two NightlyLearners exist, one wired correctly and one not.

**Gap 3: Config is passed incompletely to AgentDB.** At controller-registry.ts:582-585, the registry constructs AgentDB with only `{ dbPath, maxElements }`. Dimension, embeddingModel, and HNSW parameters are NOT forwarded. AgentDB therefore resolves its own config independently via getEmbeddingConfig() at AgentDB.ts:97-100. Upstream commit `4d87fcd6c` (2026-04-04, "pass embedding config from ControllerRegistry to AgentDB") attempted to fix this for issue #1516, but the fix was incomplete -- the registry still resolves dimension separately at controller-registry.ts:320-330 and stores it in `this.resolvedDimension`, creating two independent resolution paths.

## 3. The Solutions Architecture Pattern

Distilling the intent from the type system, initialization levels, ADR comments, and the get() delegation pattern, the upstream design converges on a four-layer architecture:

```
Layer 4: Config Files
  config.json, embeddings.json
  Read by memory-bridge.ts, resolved once

Layer 3: Memory Bridge (CLI entry point)
  Assembles RuntimeConfig from files + env
  Owns the process-lifetime singleton of ControllerRegistry

Layer 2: ControllerRegistry (lifecycle manager)
  Sole controller factory for all 46 controllers
  Level-ordered initialization (0-6) with parallel init within levels
  get<T>() provides unified access with CLI-override-then-AgentDB-fallback

Layer 1: AgentDB (infrastructure container)
  Owns database handle, EmbeddingService, VectorBackend, GraphTransformerService
  Exposes infrastructure to Layer 2 for controller construction
  Does NOT own controller lifecycle
```

The key architectural decision is ownership inversion. AgentDB was originally designed as a self-contained unit that creates and owns its controllers. The registry was designed as the outer container that delegates to AgentDB. These two ownership models are structurally incompatible when both eagerly construct the same controllers.

The resolution visible in the ADR trail is: AgentDB becomes an infrastructure provider, not a controller owner. It initializes the database, embedder, and vector backend (AgentDB.ts:76-150), then exposes them. The registry uses that infrastructure to construct all controllers, passing singletons where the ADR-0040 pattern requires them. The `getController()` switch on AgentDB becomes a compatibility shim for direct AgentDB users (such as the MCP server at agentdb-mcp-server.ts:321-328, which correctly wires vectorBackend per ADR-0056).

The ADR-0040 singleton injection pattern is the correct wiring mechanism for controllers with shared dependencies. NightlyLearner's constructor demonstrates the pattern: it accepts optional causalGraph, reflexion, and skills parameters. When provided, it uses them; when omitted, it constructs its own. The registry's nightlyLearner case (controller-registry.ts:946-953) implements this correctly. The pattern should be applied universally: every controller that holds a reference to another controller should accept it as an optional constructor parameter.

## 4. Our Path Forward with ADR-0066

ADR-0066 should implement the upstream vision, not invent a replacement. Three changes complete the circuit:

**Change 1: Forward full config to AgentDB.** At controller-registry.ts:582-585, pass dimension, embeddingModel, and HNSW parameters from RuntimeConfig into AgentDBConfig. This eliminates the dual-resolution gap. Both layers receive config from the same source (memory-bridge's RuntimeConfig), and AgentDB's getEmbeddingConfig() call at AgentDB.ts:97 receives explicit values rather than falling back to its own file reads.

**Change 2: Make the registry the sole controller factory.** For the 5 AgentDB-tier controllers currently duplicated (reasoningBank, causalRecall, learningSystem, explainableRecall, nightlyLearner), the registry should call `agentdb.getController()` instead of constructing new instances. This requires extending AgentDB.getController() to cover all 8 controller names reliably, which upstream ADR-055 documented as incomplete. In the short term, the workaround at controller-registry.ts:883-953 is acceptable IF the registry suppresses AgentDB's eager construction or accepts that AgentDB's copies sit idle.

**Change 3: Wire singletons in AgentDB.initialize().** At AgentDB.ts:157, pass `controllerVB` to CausalRecall (matching the MCP server's correct pattern at agentdb-mcp-server.ts:321-328). At AgentDB.ts:160, pass the already-constructed causalGraph, reflexion, and skills to NightlyLearner. These are two-line fixes that complete the ADR-0040 intent within AgentDB itself, ensuring that even direct AgentDB users (without the registry) get correct wiring.

These three changes do not restructure the architecture. They complete the wiring that the upstream author designed but left partially connected across ADRs 040, 053, 055, 056, and 064.

## 5. The Third Layer: AgentDBService (discovered on feature/agentic-flow-v2)

The branch search revealed a critical finding: there are not two but **three** parallel controller wiring layers in the upstream codebase:

| Layer | File | Pattern | Instance count |
|-------|------|---------|---------------|
| **AgentDB core** | `packages/agentdb/src/core/AgentDB.ts` | `getController(name)` — 13 names, constructor injection | One set of 8 controllers |
| **AgentDBService facade** | `agentic-flow/src/services/agentdb-service.ts` | `getInstance()` singleton — 1,679 lines, phased init | **Second set** — re-instantiates every controller directly, does NOT call `getController()` |
| **ControllerRegistry** | `@claude-flow/memory/src/controller-registry.ts` | Level-based init, config-driven activation | **Third set** — creates yet more instances for most controllers |

`AgentDBService` is what all MCP tools in agentic-flow actually call. It has its own singleton (`static getInstance()`), its own phased initialization (Phase 1: attention/WASM/MMR, Phase 2: RuVector packages, Phase 4: Sync/NightlyLearner/QUIC), and its own in-memory fallback stores. It never calls `AgentDB.getController()` — it constructs every controller directly.

This means a fully wired system can have **three live copies** of ReasoningBank, CausalRecall, LearningSystem, etc. — one in AgentDB, one in AgentDBService, and one in ControllerRegistry. All three share the same SQLite database handle but maintain separate in-memory state.

### Implications for ADR-0066

The three-layer problem doesn't change the solution architecture — it reinforces it:

1. **AgentDB** should remain the infrastructure layer (db, embedder, vectorBackend) and become lazy about controller construction
2. **One of AgentDBService or ControllerRegistry** should be the authoritative controller factory — not both
3. The ruflo CLI uses ControllerRegistry (via memory-bridge). The agentic-flow MCP server uses AgentDBService. These are two different deployment contexts that should share a common controller ownership model but currently don't

For the ruflo-patch scope (our forks), the path forward is: ControllerRegistry delegates to AgentDB's `getController()`, and we do not touch AgentDBService (it's agentic-flow-internal). The key fix remains Change 3 above — wire singletons in `AgentDB.initialize()` — because that fix benefits ALL three layers.

## 6. Upstream Evidence: RVF as the Intended Single Format

RuVector's ADR-029 (RVF Canonical Format) explicitly states the cross-ecosystem interop problem:

> "agentdb, claude-flow, agentic-flow, ospipe, rvlite, and sona all invented their own serialization formats and cannot interoperate."

The intended migration:
- `agentdb`: Custom HNSW + JSON → RVF with RVText profile
- `claude-flow memory`: JSON + flat files → RVF with WITNESS_SEG for audit trails
- `agentic-flow`: Shared memory blobs → RVF streaming protocol

A `claude-flow-v3-ruvector` branch exists in the ruvector repo with a SPARC plan to replace AgentDB's JS vector layer with RuVector Rust-native storage (NAPI-RS primary, WASM fallback). Target: 150x pattern search, 500x batch. This is the long-term direction but has not been implemented.

## 7. Upstream ADR-053: Only Phase 1 Was Completed

The `feat/adr-053-controller-activation` branch (now merged to main) contains the full 545-line architecture document defining a 6-phase controller activation plan:

| Phase | Scope | Status |
|-------|-------|--------|
| Phase 1 (P0) | Eliminate dual memory system — bridge pattern | **Completed** |
| Phase 2 (P1) | Core intelligence loop (ReasoningBank, BM25, recordFeedback) | Not started |
| Phase 3 (P2) | Graph & episodic (MemoryGraph, CausalMemoryGraph, NightlyLearner) | Not started |
| Phase 4 (P3) | Skill & scope (SkillLibrary, FederatedSession, AgentMemoryScope) | Not started |
| Phase 5 (P3) | Proof-gated intelligence (GuardedVectorBackend wiring) | Not started |
| Phase 6 (P3) | MCP surface (agentdb_* tools, COW branching) | Not started |

Our ADR-0033 through ADR-0066 have been incrementally completing Phases 2-6. ADR-0066 is the final sweep that addresses the remaining gaps.

## 8. No Upstream Dimension Alignment Tracking

Neither ruvnet/ruflo nor ruvnet/RuVector has an issue or ADR tracking dimension alignment between the two projects. RuVector defaults to 384 (MiniLM) in `ruvector-core/src/types.rs` and `ruvector-cli/src/config.rs`. Ruflo's embeddings.json specifies 768 (mpnet/nomic). This mismatch is an open gap with no upstream plan to resolve it — making our ADR-0066 P3 the first formal proposal to align them.
