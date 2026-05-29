# ADR-0051 Queen Ruling: The True Microkernel Boundary

## Status

**FINAL RULING** -- 2026-03-17

## Authority

This ruling resolves the debate between the 6-agent swarm analysis (which concluded upstream ADRs mandate core integrations) and the project owner's position ("we got it wrong -- these should have been plugins"). Five specialist debaters submitted position papers. The queen architect has read all primary source ADRs (004, 015, 017, 045, 048, 049, 050, 056), examined the fork codebase, and renders a binding verdict.

---

## Specialist Position Summaries

### Debater 1: Plugin Purist

ADR-004 drew a 5-item core boundary and the project immediately violated it. The revised ADR-0051 is too conservative -- marking `cli/src/ruvector/` as "DO NOT REMOVE" contradicts ADR-004's own list, because intelligence features are not lifecycle mechanisms. These should be a `@claude-flow/intelligence` plugin. ADR-0050's defect list proves that tight coupling between core and integrations produces wiring bugs; clean plugin interfaces would prevent them. The correct extraction scope is approximately 45,000 lines, not the 28,607 in the current proposal.

### Debater 2: Core Defender

Model routing is analogous to an OS scheduler -- the CLI cannot dispatch a single task without it. `defaultEnabled` is a leaky abstraction: if a plugin must always be enabled, it is core wearing a costume. The ADR-0050 bugs were 2-line wiring fixes, not evidence of architectural failure. Concedes that HiveMind, Maestro, RuVector PostgreSQL bridge, and SONA are properly plugins. Draws the line at routing, guidance, and memory bridges, arguing these are operational necessities that belong in core.

### Debater 3: Pragmatist

The principle of extraction is correct, but the scope is 50,000+ lines of churn. Plugin-based CLI command loading has never been tested in production in this codebase. Proposes a 5-rung migration ladder with deploy gates between each rung. Estimates 10-14 working days. Demands feature flags during transition so each extraction can be individually reverted. Each rung must pass `npm run deploy` 55/55 before the next one proceeds.

### Debater 4: User Advocate

Users care about four things: it works, it is fast, errors are clear, and it is customizable. Plugin extraction serves all four -- ruflo-patch can ship working features enabled and broken ones disabled. Demands lazy plugin initialization (do not load HiveMind if the user only runs a memory search). Error messages when a plugin is absent must be actionable ("install X to enable Y"), not merely clean ("plugin not found"). Progressive disclosure through plugins is better product design than a monolithic binary.

### Debater 5: Microkernel Theorist

ADR-004 already decided this debate. Quotes the specification verbatim: core = 5 items (agent lifecycle, task execution, memory management, basic coordination, MCP server). Applies the mechanism-vs-policy distinction from operating systems theory. "Tasks are routed to models" is mechanism and belongs in core. "Tasks are routed via Q-learning with flash attention" is policy and belongs in a plugin. ADRs 045/048/049/056 violated ADR-004 by hardwiring policy into the kernel. The plugin SDK (ADR-015) was built precisely to solve this problem but was then bypassed by every subsequent feature ADR.

---

## Assessment of Arguments

### Where the Purist (D1) and Theorist (D5) are right

D5's mechanism-vs-policy distinction is the intellectual backbone of this ruling. It resolves the apparent paradox that model routing "feels essential" while also belonging outside the kernel. The core needs a mechanism: "given a task, select a model." The core does not need a policy: "select a model using Q-learning reinforcement, AST complexity scoring, flash attention similarity, and mixture-of-experts load balancing." The mechanism is a 20-line interface. The policy is 8,385 lines of intelligence code.

D1 is correct that ADR-0050's defect list -- 5 failures, 7 degraded, 9 disabled -- is evidence of architectural coupling bugs, not just wiring mistakes. When core code directly imports integration modules, every refactor in either direction can break the other. Plugin interfaces create a stable contract boundary.

### Where the Core Defender (D2) is right

D2's "scheduler analogy" is partially valid. A microkernel still needs a scheduler -- it just needs a simple one. The Linux kernel's `SCHED_OTHER` (basic time-sharing) is built in; `SCHED_DEADLINE` is a separate scheduling class. The equivalent here: a simple round-robin or capability-match router belongs in core. Q-learning and flash attention do not.

D2 is also correct that `defaultEnabled` must not be a leaky abstraction. This ruling therefore imposes a hard requirement: the core must contain a complete, functional fallback implementation of every mechanism that plugins enhance. If the intelligence plugin is absent, routing still works -- it just uses round-robin. If the guidance plugin is absent, sessions still start -- they just skip governance checks. No feature flag gymnastics, no "plugin required" errors for basic operations.

### Where the Pragmatist (D3) is right

D3's 5-rung migration ladder with deploy gates is the correct execution strategy. This ruling adopts it. No phase proceeds until the previous phase passes `npm run deploy`. The estimated 10-14 working days is realistic and accepted. Feature flags are adopted for Phases 5-7 (the newly added extractions) so each can be individually rolled back if production issues arise.

D3's observation that plugin CLI command loading is untested in production is critical. Phase 1 (HiveMind + Maestro) therefore serves as the proof-of-concept for dynamic command loading. If Phase 1 reveals that the plugin command loader is unreliable, Phases 5-7 are deferred until the loader is hardened.

### Where the User Advocate (D4) is right

D4's demand for lazy initialization and actionable error messages is adopted as a hard requirement across all phases. Plugin loading must be lazy -- the `intelligence` plugin is not loaded until a routing decision is needed. Error messages must tell the user what to do, not just what failed. D4's progressive disclosure principle is the user-facing justification for the entire extraction.

---

## Verdicts

### Q1: Should guidance (ADR-045) have been a plugin?

**VERDICT: YES.**

Applying D5's mechanism-vs-policy test: the mechanism is "sessions have configuration" (core -- CLAUDE.md is read by the runtime). The policy is "configuration is compiled into constitutions, enforced through 4 gates, and audited with cryptographic proof envelopes" (plugin -- these are governance enhancements).

ADR-004 does not list guidance in the core. ADR-045 added it to core by fiat. Read ADR-045's own problem statement: "`@claude-flow/guidance` is a standalone package [...] NOT declared as a dependency [...] silently fails at runtime." The fix should have been declaring it as a defaultEnabled plugin that auto-loads, not wiring it as a hard dependency.

When absent, sessions proceed without governance enforcement -- degraded but functional. This is exactly the microkernel contract.

**Action**: Extract to `guidance` plugin. `defaultEnabled: true`. New ADR supersedes ADR-045. Feature flag `--no-guidance` available during transition.

### Q2: Should auto-memory (ADR-048) and learning memory (ADR-049) have been plugins?

**VERDICT: YES, with a sharp boundary.**

ADR-004 lists "memory management" as core. Applying the mechanism-vs-policy test:

- Mechanism (core): `IMemoryBackend` interface, `store()`, `retrieve()`, `search()` API, AgentDB adapter, HNSW index. These are memory management.
- Policy (plugin): AutoMemoryBridge (syncs Claude Code files with AgentDB), LearningBridge (connects insights to neural pipeline), MemoryGraph (PageRank knowledge graph), AgentMemoryScope (3-scope agent memory directories), intelligence loop (ADR-050). These are memory enhancement strategies.

ADR-048 itself confirms this: the bridge is triggered by hooks (`session-start`, `session-end`, `post-task`). A module that registers hook handlers to enhance a core subsystem is a plugin by definition.

ADR-049's LearningBridge has an optional dependency on `@claude-flow/neural` with dynamic import and no-op fallback. A module whose own ADR says "degrades to no-ops when dependency unavailable" is not core.

**Action**: Extract AutoMemoryBridge, LearningBridge, MemoryGraph, AgentMemoryScope, and the intelligence loop (ADR-050) into a `memory-intelligence` plugin. `defaultEnabled: true`. Core memory interfaces (`IMemoryBackend`, `MemoryEntry`, AgentDB adapter, HNSW index) stay in `@claude-flow/memory`. New ADR supersedes ADR-048 and ADR-049.

### Q3: Should agentic-flow (ADR-056) have been a plugin?

**VERDICT: YES. This is the easiest call.**

ADR-056's own integration surface table shows every import is `import('agentic-flow/...').catch(() => null)`. The ADR explicitly states: "the CLI functions correctly without agentic-flow installed." The existing `agentic-flow-bridge.ts` already has `isAvailable()` and `capabilities()` methods. This is a plugin that was never formally registered as one.

D2 argues the 150x speedup from Agent Booster makes it operationally required. But "faster" is not "required." The CLI routes tasks, generates embeddings, and runs agent coordination without agentic-flow. It does these things more slowly. That is the definition of an enhancement plugin.

**Action**: Extract `services/agentic-flow-bridge.ts` and related imports into an `agentic-flow` plugin. `defaultEnabled: true`. New ADR supersedes ADR-056.

### Q4: Should the RuVector core routing modules (cli/src/ruvector/) have been plugins?

**VERDICT: YES. This is the ruling that matters most.**

D2 says removing model routing is like removing the OS scheduler. D5 says the scheduler stays but Q-learning is a scheduling policy. D5 is correct. Here is the proof:

ADR-017 defines the integration architecture. Its first design principle is: **"Optional by Default -- ruvector is not required; all commands degrade gracefully."** ADR-017 specifies `checkRuVectorAvailability()`, `requireRuVector()`, and `getInstallInstructions()`. It describes lazy loading, availability checking, and graceful fallback. It describes a plugin architecture in explicit detail. The upstream architects themselves designed this as optional.

Applying mechanism-vs-policy:

| Mechanism (core) | Policy (plugin) |
|------------------|-----------------|
| Route task to a model | Route via Q-learning reinforcement |
| Classify change risk | Classify via AST complexity + diff heuristics |
| Select agent for task | Select via MoE load balancing + coverage routing |
| Compare embeddings | Compare via flash attention (150x speedup) |

The mechanism side requires approximately 30 lines of interface definition and 40 lines of fallback implementation (capability-match or round-robin routing). The policy side is the 14 files, 8,385 lines in `cli/src/ruvector/`.

D2's concern about the 25+ consumers is addressed by D3's migration ladder. Phase 7 (this extraction) runs last, after 6 prior phases prove the pattern. The `IIntelligenceRouter` abstraction is defined in Phase 8 but can be introduced earlier as a shim that delegates to the existing concrete implementations. The 25 consumers are updated to call through the interface. Then Phase 7 moves the implementations behind the plugin boundary.

**Action**: Define `IIntelligenceRouter` and `IAnalysisEngine` abstractions in core with round-robin/simple fallback implementations. Extract all 14 files from `cli/src/ruvector/` and all 9 files from `commands/ruvector/` into an `intelligence` plugin. `defaultEnabled: true`. Feature flag `--builtin-routing` available during transition to force the fallback router. New ADR supersedes the routing portions of ADR-017.

### Q5: What is the correct microkernel boundary?

**VERDICT: ADR-004 was right. Take it literally. But add one item: plugin infrastructure itself.**

D5 quotes ADR-004 verbatim: agent lifecycle, task execution, memory management, basic coordination, MCP server. This ruling adds a sixth item that ADR-004 implied but did not state: **plugin infrastructure**. The PluginRegistry, PluginBuilder SDK, dynamic loader, and defaultEnabled mechanism are core because without them, nothing else can load.

D2's scheduler argument is resolved by requiring that core contain **fallback mechanism implementations** for every interface that plugins enhance. This is the crucial difference between "defaultEnabled is a leaky abstraction" and "defaultEnabled is a deployment convenience." The core is complete without any plugins. Plugins improve it.

**The true microkernel boundary:**

```
CORE (always present, always functional without plugins):

  @claude-flow/shared       Types, interfaces, constants
  @claude-flow/memory       IMemoryBackend, store/retrieve/search, AgentDB
                            adapter, HNSW index
  @claude-flow/mcp          MCP server, tool registry, stdio/HTTP transport
  @claude-flow/cli          CLI framework, core commands (agent, task, session,
                            memory, config), plugin loader, fallback router
                            (round-robin), fallback classifier (pass-through)
  @claude-flow/plugins      PluginRegistry, PluginBuilder SDK, plugin types,
                            defaultEnabled mechanism, lazy loading

PLUGINS (defaultEnabled: true -- auto-load for full experience):

  guidance                  CLAUDE.md governance, enforcement gates, audit trails
  memory-intelligence       Auto-memory bridge, learning bridge, memory graph,
                            agent memory scope, intelligence loop
  intelligence              Model routing (Q-learning, MoE), diff classification,
                            AST analysis, coverage routing, flash attention,
                            graph analysis
  agentic-flow              ReasoningBank, Router, Agent Booster (WASM bridge)
  hive-mind                 Queen-led multi-agent coordination

PLUGINS (defaultEnabled: false -- opt-in):

  maestro                   SPARC methodology orchestration
  ruvector-upstream         PostgreSQL bridge, SQL migrations, provider
  sona                      Self-learning engine
  neural                    Neural training system
  domain-*                  Healthcare, financial, legal, etc.
```

The boundary test: **delete every defaultEnabled plugin. The CLI starts. It spawns agents. It executes tasks. It stores and retrieves memories. It serves MCP tools. It routes tasks to models (round-robin). It classifies diffs (pass-through). It just does all of these things less intelligently.** That is the microkernel contract. Intelligence is policy. Policy lives in plugins.

---

## Revised Scope for ADR-0051

The current ADR-0051 extracts 28,607 lines across 29 files. This ruling expands the scope to approximately 45,000 lines across 55+ files, organized as D3's 5-rung migration ladder extended to 9 phases with deploy gates.

### Rung 1: HiveMind + Maestro (SAFE -- unanimous agreement)

All five debaters agree these are plugins. ADR-004 lists them explicitly.

- Move HiveMind MCP tools into `hiveMindPlugin.mcpTools[]`
- Move HiveMind CLI command into `hiveMindPlugin.cliCommands[]`
- Delete shared/src/plugins/official/ duplicates (3 files, 862 lines)
- Delete cli/src/commands/hive-mind.ts (1,390 lines)
- Delete cli/src/mcp-tools/hive-mind-tools.ts (675 lines)
- **2,927 lines extracted.**
- **DEPLOY GATE: `npm run deploy` must pass 55/55.**

### Rung 2: RuVector PostgreSQL bridge + provider (SAFE -- unanimous agreement)

Already in the plugins directory. Has its own ARCHITECTURE.md describing it as a bridge.

- Move plugins/src/integrations/ruvector/ (22 files, 24,527 lines) to `ruvector-upstream` plugin
- Move providers/src/ruvector-provider.ts (721 lines) to same plugin
- Preserve SQL migrations in plugin package
- **25,248 lines extracted.**
- **DEPLOY GATE: `npm run deploy` must pass 55/55.**

### Rung 3: SONA integration (SAFE -- unanimous agreement)

Small module, coupled to RuVector provider. Extracted alongside it.

- Move neural/src/sona-integration.ts to `sona` built-in plugin
- **432 lines extracted.**
- **DEPLOY GATE: `npm run deploy` must pass 55/55.**

### Rung 4: agentic-flow bridge (LOW RISK -- D2 dissents)

Already has graceful fallback. D2 argues the 150x speedup makes it operationally required. Ruling: performance is not a core requirement; correctness is. The bridge is already 90% a plugin.

- Extract services/agentic-flow-bridge.ts to `agentic-flow` plugin
- defaultEnabled: true
- Feature flag: `CLAUDE_FLOW_DISABLE_AGENTIC_FLOW=1` to disable during transition
- **831 lines extracted.**
- **DEPLOY GATE: `npm run deploy` must pass 55/55.**

### Rung 5: Guidance system (MODERATE RISK -- D2 dissents, D3 demands feature flag)

D2 argues guidance is session-critical. Ruling: sessions function without governance enforcement. D3's feature flag demand is adopted.

- Change @claude-flow/guidance from hard dependency to plugin
- Register 6 CLI subcommands via `registerCLICommands()`
- Register MCP tools via `registerMCPTools()`
- Hook into session-start for CLAUDE.md compilation
- defaultEnabled: true
- Feature flag: `CLAUDE_FLOW_DISABLE_GUIDANCE=1`
- New ADR supersedes ADR-045
- **Dependency change (separate package stays intact; wiring changes only).**
- **DEPLOY GATE: `npm run deploy` must pass 55/55.**

### Rung 6: Memory intelligence (MODERATE RISK -- D2 dissents, D3 demands feature flag)

D2 argues memory bridges are core memory management. Ruling: IMemoryBackend and store/retrieve/search are core; bridges, graphs, and learning pipelines are policy.

- Extract AutoMemoryBridge, LearningBridge, MemoryGraph, AgentMemoryScope from @claude-flow/memory
- Core memory interfaces remain in @claude-flow/memory
- defaultEnabled: true
- Feature flag: `CLAUDE_FLOW_DISABLE_MEMORY_INTELLIGENCE=1`
- New ADR supersedes ADR-048 and ADR-049
- **~2,100 lines extracted.**
- **DEPLOY GATE: `npm run deploy` must pass 55/55.**

### Rung 7: RuVector intelligence routing (HIGHEST RISK -- D2 strongly dissents)

This is the most contested extraction. D2 argues it breaks 7 commands. The mitigation is threefold:

1. Define `IIntelligenceRouter` and `IAnalysisEngine` abstractions in core first (Phase 8 pulled forward as a prerequisite).
2. Implement fallback router (round-robin by capability match, ~40 lines) and fallback classifier (pass-through, ~20 lines) in core.
3. Update the 25+ consumers to call through the interface before moving files.

The extraction then becomes a package boundary change, not a functionality removal.

- Define IIntelligenceRouter abstraction in @claude-flow/shared (~30 lines)
- Implement FallbackRouter in @claude-flow/cli (~40 lines)
- Implement FallbackClassifier in @claude-flow/cli (~20 lines)
- Update 25+ consumers to use interface, not concrete imports
- Extract all 14 files from cli/src/ruvector/ to `intelligence` plugin
- Extract all 9 files from commands/ruvector/ to `intelligence` plugin
- defaultEnabled: true
- Feature flag: `CLAUDE_FLOW_BUILTIN_ROUTING=1` (force fallback router)
- New ADR supersedes routing portions of ADR-017
- **~13,082 lines extracted. ~90 lines of new abstraction/fallback code.**
- **DEPLOY GATE: `npm run deploy` must pass 55/55.**

### Rung 8: Dynamic plugin loading wiring

- Plugin-command-loader.ts (~50 lines)
- Startup integration: load defaultEnabled plugins, register tools/commands
- Lazy initialization: plugins loaded on first use, not at boot (per D4)
- Actionable error messages: "Run `npm install @claude-flow/intelligence` to enable Q-learning routing" (per D4)
- **~100 lines of new infrastructure code.**
- **DEPLOY GATE: `npm run deploy` must pass 55/55.**

### Rung 9: Final verification

- All MCP tool names resolve unchanged
- Plugin-absent startup is clean and functional
- defaultEnabled plugins auto-load and provide full functionality
- Each defaultEnabled plugin can be individually disabled via feature flag
- Disabling any single plugin degrades gracefully, never crashes
- Core-only mode (all plugins disabled) is functional for basic operations
- `npm run deploy` passes 55/55
- Performance regression test: startup time with all plugins < 200ms

### Revised totals

| Metric | Current ADR-0051 | This ruling |
|--------|-----------------|-------------|
| Lines extracted from core | 28,607 | ~44,620 |
| Source files moved/deleted | 29 | ~55 |
| New plugin packages | 1 | 6 |
| New abstraction/fallback code | ~50 lines | ~260 lines |
| Phases | 5 | 9 (with deploy gates) |
| Estimated effort (D3) | unstated | 10-14 working days |
| Feature flags | 0 | 4 (for Phases 4-7) |

---

## Items Reclassified from "DO NOT REMOVE" / "Out of Scope" to "EXTRACT"

| Item | Lines | Old status | New status | Rationale |
|------|------:|-----------|-----------|-----------|
| `cli/src/ruvector/` (14 files) | 8,385 | DO NOT REMOVE | EXTRACT (Rung 7) | ADR-017 says "optional by default"; mechanism-vs-policy: Q-learning is policy |
| `cli/src/commands/ruvector/` (9 files) | 4,697 | EVALUATE per-subcommand | EXTRACT (Rung 7) | All subcommands serve the intelligence routing policy |
| `plugins/src/integrations/agentic-flow.ts` | 831 | KEEP | EXTRACT (Rung 4) | Already has isAvailable() and catch(() => null) -- it is a plugin |
| Guidance system (ADR-045) | pkg | Out of scope (core by ADR) | EXTRACT (Rung 5) | ADR-045 violated ADR-004; governance is policy, not mechanism |
| AutoMemoryBridge + LearningBridge + MemoryGraph + AgentMemoryScope | ~2,100 | Out of scope (core by ADR) | EXTRACT (Rung 6) | Bridges and graphs are memory policy, not memory mechanism |

---

## Dissent Record

**D2 (Core Defender) dissents on Q1, Q2, Q4.** D2 argues that guidance, memory intelligence, and model routing are operationally inseparable from core. The ruling acknowledges the operational dependency but distinguishes operational convenience from architectural necessity. The `defaultEnabled: true` designation with fallback implementations addresses D2's concern that users must not experience degradation in the default configuration.

**D3 (Pragmatist) conditionally supports all verdicts** but demands the migration ladder with deploy gates and feature flags. This demand is adopted in full. D3's concern about untested plugin command loading is addressed by making Rung 1 (HiveMind + Maestro) the proof-of-concept gate. If dynamic command loading fails at Rung 1, Rungs 5-7 are deferred.

**D1 (Purist), D4 (User Advocate), and D5 (Theorist) support all verdicts.**

---

## Precedent Established

This ruling establishes two precedents for future ADRs:

1. **Feature ADRs cannot override the architecture ADR.** If a feature ADR says "add X as a core dependency" and ADR-004 says "core = 5 items," the feature ADR must explain why ADR-004's boundary should be redrawn, not silently bypass it. Future feature ADRs that add core dependencies without explicitly superseding ADR-004 are procedurally invalid.

2. **The mechanism-vs-policy test is the tiebreaker.** When debating whether a module belongs in core or in a plugin, ask: "Is this a mechanism (what the system must do) or a policy (how the system chooses to do it)?" Mechanisms live in core. Policies live in plugins. If a policy must always be active for a good user experience, it is a `defaultEnabled: true` plugin, not a core module.

---

## Ruling Authority

This ruling is final for the purpose of ADR-0051 scope definition. The current ADR-0051 text should be revised to incorporate Rungs 4-7. Separate superseding ADRs should be written for:

- ADR-045 (guidance) -- superseded by guidance plugin extraction
- ADR-048 + ADR-049 (memory bridges) -- superseded by memory-intelligence plugin extraction
- ADR-017 routing portions -- superseded by intelligence plugin extraction
- ADR-056 (agentic-flow) -- superseded by agentic-flow plugin extraction

The owner's position is upheld: **the direct integrations were architectural mistakes. The ADRs that mandated them hardwired policy into the kernel. The plugin system (ADR-004, ADR-015) was the correct answer all along. It was built, tested, and then bypassed. This ruling corrects that trajectory.**

Signed: Queen Architect, 2026-03-17
