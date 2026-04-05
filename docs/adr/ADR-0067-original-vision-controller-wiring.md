# ADR-0067: The Original Vision -- How Controller Wiring Was Supposed to Work

**Status**: Analysis (informational)
**Date**: 2026-04-05
**Context**: Synthesized from upstream code evidence to guide future refactoring

---

## 1. The Intended Relationship Between AgentDB and ControllerRegistry

AgentDB was designed as a self-contained database wrapper. Its `initialize()` method (AgentDB.ts lines 72-181) creates exactly 8 domain controllers -- ReflexionMemory, SkillLibrary, ReasoningBank, CausalMemoryGraph, CausalRecall, LearningSystem, ExplainableRecall, NightlyLearner -- plus infrastructure objects (EmbeddingService, GraphTransformerService, vectorBackend, mutationGuard, attestationLog). Its `getController()` switch (lines 183-223) exposes 13 named accessors for these objects. That is the full extent of AgentDB's controller surface.

ControllerRegistry (controller-registry.ts) was added later under ADR-053 as a CLI-layer wrapper. Its header comment on line 4 is explicit: "Wraps the AgentDB class and adds CLI-specific controllers from @claude-flow/memory." The registry's type system declares two disjoint unions: `AgentDBControllerName` (15 names, lines 34-49) and `CLIControllerName` (31 names, lines 54-85). The design intent is a two-tier model:

- **Tier 1 (AgentDB)**: Core data controllers. Created by AgentDB.initialize(), accessed via `agentdb.getController(name)`.
- **Tier 2 (CLI-layer)**: Orchestration, caching, attention, security infrastructure. Created directly by the registry's `createController()` factory.

The registry's `get<T>()` method (lines 422-440) implements this correctly: check CLI-layer first, fall back to AgentDB's getController(). The *intent* was delegation for Tier 1 controllers.

**But that intent was never fully realized.** The registry's `createController()` factory (lines 753-1276) directly instantiates many controllers that AgentDB already creates internally. For example, ReasoningBank (line 888), CausalRecall (line 909), LearningSystem (line 919), ExplainableRecall (line 929), and NightlyLearner (line 939) are all constructed fresh by the registry using `new RB(this.agentdb.database, ...)` -- creating *second copies* that shadow the ones AgentDB already holds. Only three controllers (skills, reflexion, causalGraph at lines 897-904) actually delegate to `agentdb.getController()`.

This means the system runs with two copies of most domain controllers, each holding its own internal state. The original AgentDB copies sit idle inside the AgentDB instance, unreachable.

## 2. The Intended Config Flow

Two separate config resolution paths exist, and the evidence suggests this was originally a staged design that never converged.

**AgentDB's path**: `getEmbeddingConfig()` in `agentdb/src/config/embedding-config.ts` (lines 86-146) is a layered resolver: defaults, embeddings.json, env vars, MODEL_REGISTRY auto-derivation, explicit overrides. AgentDB.initialize() calls it at line 97-100 to resolve dimension and model. This is the authoritative source of truth for embedding configuration.

**The CLI's path**: `RuntimeConfig` in controller-registry.ts (lines 126-196) is the CLI's config surface. It accepts `dimension`, `embeddingGenerator`, and sub-configs for attention, rate limiting, etc. The memory-bridge (memory-bridge.ts lines 123-154) constructs this config by reading `.claude-flow/config.json` and `.claude-flow/embeddings.json` project files.

The critical gap: when the registry calls `new AgentDBClass({ dbPath, maxElements })` at line 582-585, it passes only `dbPath` and `maxElements`. It does NOT pass `dimension`, `embeddingModel`, or any embedding config. AgentDB therefore resolves its own config independently via `getEmbeddingConfig()`. Meanwhile, the registry resolves dimension separately at lines 320-330 and stores it in `this.resolvedDimension`. These two resolution paths *should* agree because they both read the same `embeddings.json` file, but there is no guarantee -- if one reads a stale cache or a different cwd, they diverge silently, and controllers created by the registry get a different dimension than controllers created by AgentDB.

The intended fix is visible in the ADR-0064 comment at line 293: "Resolved dimension from config -> getEmbeddingConfig() -> 768 fallback." The plan was to make the registry *call* AgentDB's getEmbeddingConfig() as the single source, which it does at lines 325-329, but this resolution happens *after* AgentDB has already initialized with its own independent resolution.

## 3. The Intended Singleton Pattern

Three distinct singleton strategies are visible in the codebase, indicating an incomplete migration:

**Strategy A -- Module-level singleton (getAccelerator)**: NativeAccelerator uses a `getAccelerator()` factory function (referenced in controller-registry.ts line 1190). The registry correctly calls this function rather than constructing a new instance. This is the cleanest pattern.

**Strategy B -- Constructor injection with fallback (ADR-0040)**: NightlyLearner (NightlyLearner.ts lines 86-95) and CausalRecall (CausalRecall.ts lines 72-82) accept optional pre-created singletons in their constructors. The ADR-0040 comment at line 92 reads: "accept pre-created singletons to avoid duplicate instances." If no singleton is provided, they create their own copies internally. The registry's NightlyLearner case (controller-registry.ts lines 946-953) correctly passes pre-created causalGraph, reflexion, and skills via `this.get()`. But AgentDB.initialize() at lines 160 does NOT -- it constructs NightlyLearner without passing pre-created singletons, so AgentDB's internal NightlyLearner creates its own CausalMemoryGraph, ReflexionMemory, and SkillLibrary. This means AgentDB's NightlyLearner runs with duplicates even without the registry.

**Strategy C -- No singleton at all (AttentionService)**: AttentionService has no singleton pattern. The registry creates one at level 2 (line 1143). NightlyLearner creates another internally at line 99 when `ENABLE_FLASH_CONSOLIDATION` is true. The LegacyAttentionAdapter (LegacyAttentionAdapter.ts) creates yet another as a compatibility wrapper. TelemetryManager, by contrast, uses a proper `getInstance()` class-level singleton (telemetry.ts line 107).

The duplication is partially accidental (AgentDB was written before the registry existed and never retrofitted) and partially a design gap (ADR-0040 solved the constructor injection pattern but was only applied to NightlyLearner and CausalRecall, not to AgentDB.initialize() itself).

## 4. What Went Wrong

Three architectural failures compound each other:

**Failure 1 -- AgentDB was never made registry-aware.** ADR-053 mandated that the registry wrap AgentDB, but AgentDB.initialize() still creates all its controllers unconditionally. The registry cannot suppress this. The correct fix would have been to either (a) make AgentDB accept pre-created controllers (extending the ADR-0040 pattern to all controllers) or (b) make AgentDB lazy, only creating controllers on first `getController()` call. Neither was done.

**Failure 2 -- The registry re-creates instead of reusing.** For 8 controllers (ReasoningBank, CausalRecall, LearningSystem, ExplainableRecall, NightlyLearner, GraphTransformer, MutationGuard, AttestationLog), the registry constructs new instances rather than fetching AgentDB's existing ones. The comment at line 883 acknowledges this: "AgentDB.getController() only supports: reflexion/memory, skills, causalGraph/causal". Rather than extending AgentDB's getController() to cover all 8 names, the registry worked around the gap by direct construction. This doubled the instance count. Only 3 controllers (skills, reflexion, causalGraph) actually delegate to `agentdb.getController()`. A third wiring layer — `AgentDBService` (1,679 lines in `agentic-flow/src/services/agentdb-service.ts`) — creates yet another full set of controller instances independently of both AgentDB core and the registry, meaning a fully wired system can have up to three copies of most domain controllers.

**Failure 3 -- Config flows were never unified.** RuntimeConfig and AgentDBConfig evolved independently. The memory-bridge assembles RuntimeConfig from project JSON files, but the subset passed to AgentDB's constructor is minimal (dbPath + maxElements). The rest (dimension, attention config, rate limiter config) is used only by the registry's own controller creation, not forwarded to AgentDB.

The relevant ADRs are: ADR-053 (registry introduction), ADR-0040 (singleton injection), ADR-0056 (AttentionService consolidation), ADR-0062 (attention suite wiring), ADR-0064 (config alignment). None of these were fully completed.

## 5. The Correct Solutions Architecture

Based on the author's documented intent across the ADR comments, the target architecture has three parts:

**Part A -- Wire singletons in AgentDB.initialize() (immediate fix).** At AgentDB.ts:157, pass `controllerVB` to CausalRecall and the already-constructed `causalGraph`/`explainableRecall` (matching the MCP server's correct pattern at agentdb-mcp-server.ts:321-328). At AgentDB.ts:160, pass `causalGraph`, `reflexion`, and `skills` to NightlyLearner. These are two-line fixes that complete the ADR-0040 intent within AgentDB itself, benefiting ALL three wiring layers (AgentDB core, AgentDBService, and ControllerRegistry).

**Part B -- The registry delegates to AgentDB for Tier 1 controllers.** For the 8 controllers that AgentDB already creates and manages (reasoningBank, causalRecall, learningSystem, explainableRecall, nightlyLearner, graphTransformer, mutationGuard, attestationLog), the registry calls `agentdb.getController(name)` instead of constructing duplicate instances. This requires extending AgentDB's `getController()` switch to cover all 8 names — upstream ADR-055 documented that only 5 names (reflexion, skills, causalGraph, vectorBackend, graphAdapter) were reliable. The extension is a prerequisite. For CLI-layer controllers (31 names), the registry continues to create and manage them directly.

**Part C -- Config merges into a single path.** RuntimeConfig should be the outer surface that feeds into AgentDBConfig. The registry should call `getEmbeddingConfig()` once, store the result, and pass dimension/model to AgentDB's constructor so both layers agree. The memory-bridge already assembles the right data (embeddings.json dimension, config.json controller settings) -- it just needs to pipe all of it through a single resolution.

**Note on architectural scope**: These changes complete the wiring that the upstream author designed but left partially connected. They do NOT restructure the architecture — AgentDB continues to eagerly construct its controllers, and the registry continues to wrap AgentDB. The long-term vision of making AgentDB a lazy container (constructing controllers on first `getController()` access) is a larger refactor that goes beyond completing the existing design.

**Where the intent is incomplete or contradictory**: The ADR-0040 pattern (accept pre-created singletons) and the ADR-053 pattern (registry wraps AgentDB) address the same problem from different directions. ADR-0040 improves AgentDB's internal wiring (pass singletons to constructors). ADR-053 improves the CLI's external wiring (delegate to AgentDB via getController). Both are needed — Part A fixes AgentDB internally, Part B fixes the registry externally. Together they ensure that whether controllers are accessed through AgentDB directly (MCP server path via AgentDBService) or through the registry (CLI path), the same correctly-wired instances are used.

## 6. Evidence: The Two Concrete ADR Violations in AgentDB.ts

The AgentDB expert found the smoking gun — two explicit ADR violations that prove the gap between intent and implementation:

### ADR-0040 Violation (lines 157, 160)

`NightlyLearner` and `CausalRecall` both have constructors with optional singleton params, annotated with `// ADR-0040: accept pre-created singletons to avoid duplicate instances`. But `AgentDB.initialize()` constructs them WITHOUT passing the already-created singletons:

```typescript
// Line 157 — CausalRecall gets NO singletons despite causalGraph being at line 156
this.causalRecall = new CausalRecall(this.db, this.embedder);

// Line 160 — NightlyLearner gets NO singletons despite all 3 being available
this.nightlyLearner = new NightlyLearner(this.db, this.embedder);
```

At this point, `this.causalGraph` (line 156), `this.explainableRecall` (line 159), `this.reflexion` (line 153), and `this.skills` (line 154) are all already constructed. The fix documented by ADR-0040 was to pass them in — but the code that does the construction never implemented this.

### ADR-0056 Violation (line 157)

`CausalRecall` accepts an optional `vectorBackend` parameter and uses it for "100x faster" vector search (per its own comment at line 155). The MCP server at `agentdb-mcp-server.ts:321-328` correctly passes `vectorBackend` per the `// ADR-0056` comment. But `AgentDB.ts` line 157 does NOT pass `controllerVB`, even though it's available and is passed to `reflexion`, `skills`, and `reasoning` on lines 153-155.

The MCP server has the CORRECT wiring pattern. `AgentDB.ts` has the BROKEN pattern. The fix was implemented in the wrong place and never backported.

## 7. The Consistent Upstream Pattern: Build Without Connecting

The ADR chain analyst found the same structural failure across ALL upstream ADRs:

| ADR | What was built | What was never connected |
|-----|---------------|------------------------|
| ADR-006 | `MemoryService` with pluggable backends | CLI never used it (kept raw sql.js) |
| ADR-009 | `HybridBackend` with routing | Never injected into CLI |
| ADR-001 (agentdb-v2) | `VectorBackend` interface | `ReasoningBank`/`SkillLibrary` never given a VectorBackend |
| ADR-028 | 39-mechanism `AttentionService` design | Package never built; only WASM stubs exist |
| ADR-053 | `ControllerRegistry` wrapping AgentDB | Only 3 of 13 controllers delegate; rest duplicated |
| ADR-055 | Bug fixes for ADR-053 | Documented `getController()` only reliable for 5 names |

The pattern is: components are designed, implemented, and exported — but the wiring layer that connects them to consumers is never completed. Each subsequent ADR (053→055→059→060→061→062→063→064→065) patches another subset of the gap, but none has completed the full circuit.

## 8. AttentionService Was Never Meant to Be a Singleton

ADR-028 (Neural Attention Mechanisms) explicitly designed `AttentionService` for multiple instances:

- `SONAWithAttention` creates TWO instances — one for Flash Attention (self-attention layers), one for MoE attention (expert routing)
- The intended `@claude-flow/attention` package (39 mechanism types) was designed as an instantiable class with per-use configuration
- The singleton pattern was a pragmatic narrowing introduced by the WIRING-PLAN (Section 1.2: `svc.getAttentionService()`), not the original design

However, the current 4 duplicate instances are NOT the intended multi-instance design either. They're accidental — each consumer creates its own because there's no injection mechanism. The correct architecture (per the evidence) is: multiple AttentionService instances are valid when intentionally configured for different use cases, but unintentional duplicates with identical config should be shared.

## 9. The Four-Layer Architecture (As Intended)

Based on all evidence, the author's intended architecture has four layers:

```
Layer 4: config.json / embeddings.json
          ↓ read by memory-bridge.ts
Layer 3: memory-bridge.ts (CLI entry point)
          ↓ constructs RuntimeConfig, owns singleton registry
Layer 2: ControllerRegistry (lifecycle manager)
          ↓ delegates to AgentDB for Tier 1, creates Tier 2 directly
Layer 1: AgentDB (infrastructure container)
          ↓ owns database, embedder, vector backend
          → controllers use shared infrastructure
```

**Layer 1 (AgentDB)** should be a lazy infrastructure container — database handle, embedder, vector backend — that does NOT eagerly create domain controllers.

**Layer 2 (ControllerRegistry)** should be the sole controller factory. For AgentDB-hosted controllers, it creates them using AgentDB's infrastructure and hands them back for storage. For CLI-layer controllers, it creates and manages them directly.

**Layer 3 (memory-bridge.ts)** is the forwarding layer that reads config files, constructs `RuntimeConfig`, and owns the process-lifetime singleton registry.

**Layer 4 (config files)** is the operator-facing control plane. Every runtime value traces back to one of these files or documented defaults.

## 10. What Must Change to Realize This Vision

The gap is not in the design — it's in the wiring. Three specific changes complete the circuit:

1. **AgentDB becomes lazy**: Move controller construction from `AgentDB.initialize()` to `AgentDB.getController()` (lazy-init on first access). Infrastructure (db, embedder, vectorBackend) stays eager.

2. **Registry delegates, never duplicates**: Every `AgentDBControllerName` case in `createController()` calls `this.agentdb.getController()`. The registry passes config (including singletons) through `AgentDBConfig` at construction time, not after.

3. **Config flows through one path**: `memory-bridge.ts` reads config files → constructs `RuntimeConfig` → passes dimension/model/HNSW params to both `ControllerRegistry.initialize()` AND `new AgentDB({ dimension, embeddingModel, ... })`. Both layers resolve the same values because they receive them from the same source.
