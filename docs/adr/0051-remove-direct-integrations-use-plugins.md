# ADR-0051: Consolidate Direct Integrations into Plugin System

## Status

Proposed (final ruling 2026-03-17 — hive-mind consensus 5-1)

## Date

2026-03-17

## Deciders

sparkling team, hive-mind queen-architect (binding ruling)

## Methodology

SPARC + MADR, with 6-agent swarm analysis and 5-specialist hive-mind deliberation

## Context

The upstream ruflo codebase contains direct, hardcoded integrations in core packages (`@claude-flow/cli`, `@claude-flow/shared`, `@claude-flow/plugins/src/integrations`, `@claude-flow/neural`, `@claude-flow/providers`) that violate the microkernel architecture established by ADR-004 and the unified plugin system specified by ADR-015.

### The foundational architecture (ADR-004)

ADR-004 (status: Implemented, 2026-01-03) states:

> "We will adopt a microkernel architecture with plugins for optional features."

Core is defined as 5 items: **agent lifecycle, task execution, memory management, basic coordination, MCP server.** Everything else — HiveMind, Maestro, Neural, Verification, Enterprise — is explicitly listed as a plugin. Subsequent ADRs (045, 048, 049, 056) violated this boundary by hardwiring features into core without superseding ADR-004.

### The mechanism-vs-policy test

The hive-mind ruling established the tiebreaker for all core/plugin boundary disputes, drawn from microkernel theory (Liedtke, Tannenbaum):

> **Mechanism** = what the system must do (core). **Policy** = how the system chooses to do it (plugin).

| Mechanism (core) | Policy (plugin) |
|------------------|-----------------|
| Route task to a model | Route via Q-learning with flash attention |
| Store and retrieve memory | Sync with Claude Code via AutoMemoryBridge |
| Classify change risk | Classify via AST complexity + diff heuristics |
| Sessions have configuration | Configuration compiled into constitutions with proof envelopes |

Mechanisms require ~260 lines of interface + fallback implementations. Policies are ~44,620 lines that belong behind plugin interfaces.

### Analysis trail

**6-agent swarm analysis** examined upstream ADRs, import chains, git history, documentation, plugin system readiness, and line counts. Findings:

| Agent | Key finding |
|-------|-------------|
| ADR Analyzer | ADR-045/048/049/056 mandate core deps, but these violate ADR-004 |
| Import Tracer | HiveMind/Maestro safe; RuVector routing has 25+ consumers but ADR-017 says "optional" |
| Git Historian | Direct integrations and plugins built simultaneously — coexistence by design, no planned extraction |
| Docs Analyzer | ADR-004/015 establish plugin-first; RuVector ARCHITECTURE.md is in plugins dir |
| Plugin System Analyzer | `registerMCPTools()` and `registerCLICommands()` fully implemented; only needs CLI startup wiring |
| Line Counter | Actual: 80 files / 64,339 lines total in scope |

**5-specialist hive-mind debate** (deliberation record: `docs/adr/0051-queen-ruling.md`):

| Debater | Position | Verdict |
|---------|----------|:------:|
| Plugin Purist | Everything outside ADR-004's 5 items = plugin | FOR |
| Core Defender | Model routing is like an OS scheduler — keep in core | AGAINST (Q1, Q2, Q4) |
| Pragmatist | Principle right, migrate in 9 gated rungs | FOR (conditional) |
| User Advocate | Users want lean installs, clear errors, progressive disclosure | FOR |
| Microkernel Theorist | ADR-004 already decided this; subsequent ADRs violated it | FOR |

**Consensus: 5-1.** Core Defender dissents on guidance, memory intelligence, and routing extraction. Dissent addressed by requiring complete fallback implementations in core.

### Verified line counts

| Category | Files | Lines |
|----------|------:|------:|
| HiveMind CLI + MCP tools | 2 | 2,065 |
| Shared official plugin duplicates | 3 | 862 |
| RuVector CLI commands (`commands/ruvector/`) | 9 | 4,697 |
| RuVector CLI routers (`cli/src/ruvector/`) | 14 | 8,385 |
| RuVector integration bridge (TS + SQL + MD) | 22 | 24,527 |
| AgenticFlow bridge | 2 | 831 |
| RuVector provider | 1 | 721 |
| SONA integration | 1 | 432 |
| Guidance system | pkg | ~2,000 (wiring) |
| Memory intelligence (bridges, graph, scope) | ~5 | ~2,100 |
| **Source subtotal** | **~59** | **~46,620** |
| Test files (fully removable) | 14 | 12,829 |
| Test files (need selective editing) | 12 | 8,990 |
| **Grand total** | **~85** | **~68,439** |

## Decision: Specification (SPARC-S)

Enforce ADR-004's microkernel boundary. Extract all policy modules to plugins. Core retains only mechanisms with minimal fallback implementations.

### The true microkernel boundary

```
CORE (always present, always functional without any plugins):

  @claude-flow/shared       Types, interfaces, constants
  @claude-flow/memory       IMemoryBackend, store/retrieve/search, AgentDB adapter,
                            HNSW index
  @claude-flow/mcp          MCP server, tool registry, stdio/HTTP transport
  @claude-flow/cli          CLI framework, core commands (agent, task, session,
                            memory, config), plugin loader, FallbackRouter
                            (round-robin), FallbackClassifier (pass-through)
  @claude-flow/plugins      PluginRegistry, PluginBuilder SDK, plugin types,
                            defaultEnabled mechanism, lazy loading

PLUGINS (defaultEnabled: true — auto-load for full experience):

  intelligence              Model routing (Q-learning, MoE), diff classification,
                            AST analysis, coverage routing, flash attention, graph analysis
  guidance                  CLAUDE.md governance, enforcement gates, audit trails
  memory-intelligence       Auto-memory bridge, learning bridge, memory graph,
                            agent memory scope, intelligence loop
  agentic-flow              ReasoningBank, Router, Agent Booster (WASM bridge)
  hive-mind                 Queen-led multi-agent coordination

PLUGINS (defaultEnabled: false — opt-in):

  maestro                   SPARC methodology orchestration
  ruvector-upstream         PostgreSQL bridge, SQL migrations, provider
  sona                      Self-learning engine
  neural                    Neural training system
  domain-*                  Healthcare, financial, legal, etc.
```

**Boundary test**: delete every defaultEnabled plugin. The CLI starts, spawns agents, executes tasks, stores memories, serves MCP tools, routes tasks (round-robin), and classifies diffs (pass-through). It just does all of these things less intelligently. Intelligence is policy. Policy lives in plugins.

### Requirements

1. **R1**: Core contains ~260 lines of fallback mechanism implementations (`IIntelligenceRouter` + `FallbackRouter`, `IAnalysisEngine` + `FallbackClassifier`, `IMemoryBridge` + no-op bridge)
2. **R2**: Every extracted feature becomes a `defaultEnabled: true` or `defaultEnabled: false` plugin
3. **R3**: Lazy plugin initialization — only load the plugin that owns the invoked command (User Advocate requirement)
4. **R4**: Actionable error messages — "Run `npx @sparkleideas/cli plugins enable X`" not "plugin not found"
5. **R5**: All MCP tool names preserved (backwards compatible)
6. **R6**: Feature flags for Rungs 4-7 so each extraction can be individually rolled back
7. **R7**: Each rung gated by `npm run deploy` 55/55 before proceeding
8. **R8**: If Rung 1 proves dynamic command loading unreliable, Rungs 5-7 defer

### Out of scope

- The 7 core MCP tool sets (agent, task, session, memory, swarm, hooks, config) — these are mechanisms
- `IMemoryBackend`, AgentDB adapter, HNSW index — core memory mechanisms
- CLI framework, MCP server, plugin registry — core infrastructure
- Changing plugin APIs or MCP tool schemas

## Decision: Pseudocode (SPARC-P)

### Plugin infrastructure (already implemented upstream)

```
// ALREADY EXISTS in plugin-interface.ts:
interface ClaudeFlowPlugin {
  registerMCPTools?(): MCPToolDefinition[]      // line 87
  registerCLICommands?(): CLICommandDefinition[] // line 93
  registerAgentTypes?(): AgentTypeDefinition[]   // line 75
  registerMemoryBackends?(): MemoryBackendDef[]  // line 99
}

// ALREADY EXISTS in plugin-registry.ts:
class PluginRegistry {
  getMCPTools(): MCPToolDefinition[]      // line 446
  getCLICommands(): CLICommandDefinition[] // line 450
}

// ALREADY EXISTS in sdk/index.ts:
class PluginBuilder {
  withMCPTools(tools)    // line 136
  withCLICommands(cmds)  // line 141
}
```

### New core abstractions (~260 lines total)

```
// IIntelligenceRouter — mechanism interface (~30 lines)
interface IIntelligenceRouter {
  routeTask(task: TaskInfo): Promise<ModelSelection>
  classifyDiff(diff: DiffInfo): Promise<RiskAssessment>
  selectAgent(task: TaskInfo): Promise<AgentSelection>
}

// FallbackRouter — round-robin implementation (~40 lines)
class FallbackRouter implements IIntelligenceRouter {
  routeTask(task): return { model: 'sonnet', reason: 'default' }
  classifyDiff(diff): return { risk: 'unknown', reviewers: [] }
  selectAgent(task): return roundRobinSelect(availableAgents)
}

// IMemoryBridge — mechanism interface (~20 lines)
interface IMemoryBridge {
  syncToExternal(): Promise<SyncResult>
  importFromExternal(): Promise<ImportResult>
}

// NoOpMemoryBridge — fallback (~15 lines)
class NoOpMemoryBridge implements IMemoryBridge {
  syncToExternal(): return { synced: 0 }
  importFromExternal(): return { imported: 0 }
}
```

### Dynamic plugin loading (~100 lines)

```
// plugin-command-loader.ts — lazy initialization
function registerPluginCommands(registry: PluginRegistry, program: Command):
  for cmd in registry.getCLICommands():
    program.addCommand(cmd.build())

function registerPluginTools(registry: PluginRegistry):
  for tool in registry.getMCPTools():
    TOOL_REGISTRY.set(tool.name, tool)

// Lazy: only initialize plugin on first use
function getRouter(): IIntelligenceRouter:
  if intelligencePlugin.isLoaded():
    return intelligencePlugin.getRouter()
  return FallbackRouter.instance
```

## Decision: Architecture (SPARC-A)

### Current state → Target state

```
CURRENT (hardcoded):                          TARGET (plugin-based):

@claude-flow/cli                              @claude-flow/cli
├── commands/hive-mind.ts    ← HARDCODED      ├── commands/        ← core only
├── commands/ruvector/       ← HARDCODED      ├── mcp-tools/       ← core only
├── mcp-tools/hive-mind-*   ← HARDCODED      ├── routing.ts       ← NEW: IIntelligenceRouter
├── ruvector/ (14 files)     ← HARDCODED      │                      + FallbackRouter (~70 lines)
└── mcp-client.ts            ← static         └── mcp-client.ts    ← dynamic from registry

@claude-flow/shared                           @claude-flow/shared
└── plugins/official/        ← DUPLICATE      └── plugins/types.ts ← interfaces only
    ├── hive-mind-plugin.ts
    └── maestro-plugin.ts

@claude-flow/plugins                          @claude-flow/plugins
└── src/integrations/        ← BRIDGE CODE    └── src/collections/ ← plugin definitions
    ├── agentic-flow.ts
    └── ruvector/ (22 files)

@claude-flow/guidance        ← CORE DEP       → guidance plugin (defaultEnabled: true)
@claude-flow/memory bridges  ← CORE CODE      → memory-intelligence plugin (defaultEnabled: true)
@claude-flow/providers/rv    ← CORE PROVIDER  → ruvector-upstream plugin (defaultEnabled: false)
@claude-flow/neural/sona     ← CORE CODE      → sona plugin (defaultEnabled: false)
```

### New plugin packages (6 total)

| Plugin | Source | Lines | defaultEnabled |
|--------|--------|------:|:-:|
| `intelligence` | `cli/src/ruvector/` + `cli/src/commands/ruvector/` | ~13,082 | true |
| `guidance` | `@claude-flow/guidance` wiring | ~2,000 | true |
| `memory-intelligence` | memory bridges, graph, scope, intelligence loop | ~2,100 | true |
| `agentic-flow` | `plugins/src/integrations/agentic-flow.ts` | 831 | true |
| `hive-mind` | CLI command + MCP tools (already exists as built-in) | 2,065 | true |
| `ruvector-upstream` | PostgreSQL bridge + provider + SONA + migrations | 25,680 | false |

## Decision: Refinement (SPARC-R)

### 9-rung migration ladder (each gated by `npm run deploy` 55/55)

Implementation hive (4-agent swarm, 2026-03-17) confirmed rung order must change: plugin loading infrastructure must be built FIRST, before any extraction. Current CLI has zero code paths calling `registry.getMCPTools()` or `registry.getCLICommands()`.

**Rung 1: Plugin loading infrastructure** (PREREQUISITE — must come first)

- NEW `cli/src/plugin-command-loader.ts` (~300 lines):
  - `loadPluginCommands(parser, registry)` — discovers and registers plugin CLI commands
  - `loadPluginTools(toolRegistry, pluginRegistry)` — discovers and registers plugin MCP tools
  - Lazy initialization: plugin `initialize()` defers until first invocation of its command/tool
  - Actionable error messages: "Run `npx @sparkleideas/cli plugins enable X`"
- Modify `bin/cli.js` — add 4 lines: init plugin registry + `loadPluginTools()` in MCP mode
- Modify `src/index.ts` — add async `loadPluginCommandsAsync()` in constructor
- `mcp-client.ts` unchanged — plugin tools integrated via existing `TOOL_REGISTRY` Map
- **~300 lines new. DEPLOY GATE.**
- **PROOF-OF-CONCEPT GATE**: test with a trivial example plugin before proceeding.

**Rung 2: HiveMind + Maestro** (SAFE — unanimous)

- **CRITICAL**: The built-in `hiveMindPlugin` in `collections/official/index.ts` has only 1 stub MCP tool (`collective-decide`). The hardcoded `hive-mind-tools.ts` has 9 real tools. Must port all 9 tools + 9 CLI subcommands into the built-in plugin BEFORE deleting the hardcoded files.
- Port 9 MCP tools into `hiveMindPlugin.withMCPTools()`: `hive-mind_spawn`, `hive-mind_init`, `hive-mind_status`, `hive-mind_join`, `hive-mind_leave`, `hive-mind_consensus`, `hive-mind_broadcast`, `hive-mind_shutdown`, `hive-mind_memory`
- Port 9 CLI subcommands into `hiveMindPlugin.withCLICommands()`: init, status, spawn, join, leave, consensus, broadcast, shutdown, memory
- Delete `shared/src/plugins/official/` (3 files, 862 lines)
- Delete `cli/src/commands/hive-mind.ts` (1,390 lines)
- Delete `cli/src/mcp-tools/hive-mind-tools.ts` (675 lines)
- Modify `cli/src/commands/index.ts` — remove 6 hiveMind references (lines 41, 132, 170, 195, 248, 274)
- Modify `cli/src/mcp-client.ts` — remove hiveMindTools import (lines 21, 63)
- Modify `shared/src/plugins/index.ts` — remove official/ re-exports (lines 21-34)
- **2,927 lines extracted. DEPLOY GATE.**

**Rung 3: RuVector PostgreSQL bridge + provider** (SAFE — unanimous)

- Move `plugins/src/integrations/ruvector/` (22 files, 24,527 lines) → `ruvector-upstream` plugin
- Move `providers/src/ruvector-provider.ts` (721 lines) → same plugin
- Preserve 7 SQL migrations in plugin package
- Modify `plugins/src/integrations/index.ts` — remove ~50 RuVector export lines (lines 33-77)
- Modify `providers/src/index.ts` — remove RuVectorProvider export (line 37)
- Modify `providers/src/provider-manager.ts` — remove RuVectorProvider registration
- **25,248 lines extracted. DEPLOY GATE.**

**Rung 4: SONA integration** (SAFE — unanimous)

- Delete `neural/src/sona-integration.ts` (432 lines)
- Modify `neural/src/index.ts` — remove 11 SONA export lines (lines 90-100)
- **432 lines extracted. DEPLOY GATE.**

**Rung 5: agentic-flow bridge** (LOW RISK — D2 dissents)

- Already has `loadAgenticFlow()` with `try/catch` fallback (`import().catch(() => null)`)
- AgentDBBridge has `this.agentDB = null` fallback path
- Extract `plugins/src/integrations/agentic-flow.ts` (743 lines) → `agentic-flow` plugin
- Modify `plugins/src/integrations/index.ts` — remove agentic-flow re-exports (lines 10-31)
- `defaultEnabled: true`
- Feature flag: `CLAUDE_FLOW_DISABLE_AGENTIC_FLOW=1`
- **831 lines extracted. DEPLOY GATE.**

**Rung 6: Guidance system** (MODERATE RISK — D2 dissents, D3 demands flag)

- Guidance is CLI-only (no MCP tools) — 7 subcommands: compile, retrieve, gates, status, optimize, ab-test, help
- All 7 subcommands use dynamic `import('@claude-flow/guidance/...')` — already lazy
- Register 7 CLI subcommands via `registerCLICommands()`
- Change `@claude-flow/cli/package.json` — remove hard dependency on `@claude-flow/guidance`
- Guidance package (37 sub-modules) stays intact as its own publishable package
- `defaultEnabled: true`
- Feature flag: `CLAUDE_FLOW_DISABLE_GUIDANCE=1`
- Supersedes ADR-045
- **Dependency wiring change. DEPLOY GATE.**

**Rung 7: Memory intelligence** (MODERATE RISK — D2 dissents, D3 demands flag)

- Extract 4 components from `@claude-flow/memory/src/`:
  - `auto-memory-bridge.ts` (956 lines) — has file I/O error handling
  - `learning-bridge.ts` (453 lines) — has `enabled?: boolean` no-op mode
  - `memory-graph.ts` (392 lines) — pure TS, no external deps
  - `agent-memory-scope.ts` (308 lines) — helper functions only
- Core `IMemoryBackend` + `UnifiedMemoryService` + `AgentDBAdapter` + `HNSWIndex` stays (~600 lines)
- Modify `memory/src/index.ts` — remove intelligence exports (lines 105-166)
- `defaultEnabled: true`
- Feature flag: `CLAUDE_FLOW_DISABLE_MEMORY_INTELLIGENCE=1`
- Supersedes ADR-048 and ADR-049
- **2,109 lines extracted. DEPLOY GATE.**

**Rung 8: RuVector intelligence routing** (HIGHEST RISK — D2 strongly dissents)

- Only 3 core routing classes have heavy usage (5+ consumers each): `ModelRouter`, `QLearningRouter`, `DiffClassifier`
- 4 secondary routers are lazy-loaded by 1 consumer each: MoERouter, FlashAttention, LoRAAdapter, SemanticRouter
- `commands/ruvector/` (9 files) are all PostgreSQL management — NOT consumers of routing modules

Prerequisites (done first within this rung):
1. Define `IIntelligenceRouter` and `IAnalysisEngine` in `@claude-flow/shared` (~30 lines)
2. Implement `FallbackRouter` (round-robin, ~40 lines) + `FallbackClassifier` (keyword-based, ~20 lines)
3. Update 25+ consumers to call through interface (5-7 high-traffic files: `route.ts`, `analyze.ts`, `agent-tools.ts`, `hooks-tools.ts`, `analyze-tools.ts`)

Then:
- Extract all 14 files from `cli/src/ruvector/` → `intelligence` plugin
- Extract all 9 files from `commands/ruvector/` → same plugin
- `defaultEnabled: true`
- Feature flag: `CLAUDE_FLOW_BUILTIN_ROUTING=1` (force fallback router)
- Supersedes routing portions of ADR-017
- **~13,082 lines extracted. ~90 lines new fallback code. DEPLOY GATE.**

**Rung 9: Final verification**

- All MCP tool names resolve unchanged
- Plugin-absent startup is clean and functional (core-only mode works)
- `defaultEnabled` plugins auto-load and provide full functionality
- Each plugin can be individually disabled via feature flag without crash
- Startup time with all plugins < 200ms
- `npm run deploy` 55/55
- Full MCP tool validation per ADR-0050

### Effort estimate

10-14 working days (Pragmatist estimate, adopted by queen). Each rung is a self-contained branch merged via PR. Rollback = `git revert` of that rung's commit set.

### Totals

| Metric | Value |
|--------|------:|
| Lines extracted from core | ~44,620 |
| Source files moved/deleted | ~55 |
| New plugin packages | 6 |
| New abstraction/fallback code | ~260 lines |
| Phases | 9 (with deploy gates) |
| Feature flags | 4 (Rungs 4-7) |

## Decision: Completion (SPARC-C)

### Checklist

- [ ] Rung 1: Implement `plugin-command-loader.ts` (~300 lines)
- [ ] Rung 1: Wire into `bin/cli.js` and `src/index.ts`
- [ ] Rung 1: **PROOF-OF-CONCEPT GATE** — test with trivial plugin
- [ ] Rung 1: DEPLOY GATE — 55/55
- [ ] Rung 2: Port 9 MCP tools + 9 CLI subcommands into hiveMindPlugin
- [ ] Rung 2: Delete `shared/src/plugins/official/` (3 files)
- [ ] Rung 2: Delete `cli/src/commands/hive-mind.ts` + `mcp-tools/hive-mind-tools.ts`
- [ ] Rung 2: Remove hiveMind refs from `commands/index.ts`, `mcp-tools/index.ts`, `mcp-client.ts`, `shared/plugins/index.ts`
- [ ] Rung 2: DEPLOY GATE — 55/55
- [ ] Rung 3: Move `plugins/src/integrations/ruvector/` to ruvector-upstream (22 files)
- [ ] Rung 3: Move `providers/src/ruvector-provider.ts` to ruvector-upstream
- [ ] Rung 3: Remove RuVector exports from `integrations/index.ts`, `providers/index.ts`, `provider-manager.ts`
- [ ] Rung 3: DEPLOY GATE — 55/55
- [ ] Rung 4: Delete `neural/src/sona-integration.ts`, remove 11 exports from `neural/src/index.ts`
- [ ] Rung 4: DEPLOY GATE — 55/55
- [ ] Rung 5: Extract agentic-flow bridge to plugin + feature flag
- [ ] Rung 5: Remove agentic-flow re-exports from `integrations/index.ts` (lines 10-31)
- [ ] Rung 5: DEPLOY GATE — 55/55
- [ ] Rung 6: Remove guidance hard dep from `cli/package.json`, register 7 subcommands via plugin
- [ ] Rung 6: DEPLOY GATE — 55/55
- [ ] Rung 7: Extract 4 memory intelligence files (auto-memory-bridge, learning-bridge, memory-graph, agent-memory-scope)
- [ ] Rung 7: Remove intelligence exports from `memory/src/index.ts` (lines 105-166)
- [ ] Rung 7: DEPLOY GATE — 55/55
- [ ] Rung 8: Define IIntelligenceRouter + FallbackRouter + FallbackClassifier (~90 lines)
- [ ] Rung 8: Update 5-7 high-traffic consumer files to use interface
- [ ] Rung 8: Extract `cli/src/ruvector/` (14 files) + `commands/ruvector/` (9 files) to intelligence plugin
- [ ] Rung 8: DEPLOY GATE — 55/55
- [ ] Rung 9: Core-only mode works (all plugins disabled)
- [ ] Rung 9: All MCP tool names resolve unchanged
- [ ] Rung 9: Startup < 200ms with all plugins
- [ ] Rung 9: Full MCP tool validation per ADR-0050
- [ ] Rung 9: FINAL DEPLOY GATE — 55/55
- [ ] Write superseding ADRs for 045, 048/049, 017 routing, 056

### Success criteria

- ~44,620 lines extracted from core (55 source files)
- 6 new plugin packages created
- ~260 lines of new fallback/abstraction code in core
- Core-only mode is functional (CLI starts, spawns agents, executes tasks, stores memories)
- All MCP tool names preserved (backwards compatible)
- Startup time < 200ms with all defaultEnabled plugins
- `npm run deploy` passes 55/55

## Consequences

### Positive

- **ADR-004 microkernel boundary enforced** — 6-item core, everything else is a plugin
- **~44,620 lines moved behind plugin interfaces** — clean contract boundaries prevent coupling bugs
- **ADR-0050 defect class eliminated** — constructor mismatches and missing exports cannot cross plugin boundaries
- **Progressive disclosure for users** — lean installs, advanced features opt-in
- **Each plugin independently testable, disableable, and version-bumpable**

### Negative

- **Largest single refactor in project history** — ~85 files, 10-14 working days
- **4 feature flags during transition** — temporary complexity
- **~260 lines of new fallback code** — must be maintained alongside plugin implementations
- **4 superseding ADRs required** (045, 048/049, 017 routing, 056)

### Risks

- Dynamic command loading is unproven in production (mitigated: Rung 1 builds and proves the infrastructure before any extraction begins)
- Plugin startup latency may exceed 200ms target (mitigated: lazy initialization per D4)
- RuVector routing extraction (Rung 7) has 25+ consumers (mitigated: interface-first migration, done last)
- Feature flags create temporary dual-path complexity (mitigated: remove after 3 clean deploys)

## Precedents Established

1. **Feature ADRs cannot override the architecture ADR.** ADR-004 defines the microkernel. Future ADRs that add core dependencies must explicitly supersede ADR-004, not silently bypass it.

2. **The mechanism-vs-policy test is the tiebreaker.** Mechanisms (what the system must do) live in core. Policies (how it chooses to do it) live in plugins. A policy that must always be active for good UX is a `defaultEnabled: true` plugin, not a core module.

## Related

- **ADR-004**: Plugin-Based Architecture — the foundational microkernel spec this ADR enforces
- **ADR-015**: Unified Plugin System — the SDK that enables extraction
- **ADR-017**: RuVector Integration — "optional by default" (superseded by Rung 7)
- **ADR-045**: Guidance System — superseded by Rung 5 (guidance becomes plugin)
- **ADR-048/049**: Memory bridges — superseded by Rung 6 (memory-intelligence plugin)
- **ADR-056**: agentic-flow — superseded by Rung 4 (agentic-flow plugin)
- **ADR-0049**: Fail-loud mode — exposed dual-path issues
- **ADR-0050**: Live validation defects — coupling bugs this ADR prevents
- **Deliberation record**: `docs/adr/0051-queen-ruling.md` — full hive-mind debate with 5 position papers, verdicts on Q1-Q5, and dissent record
