# ADR-0135: Skill + plugin enumeration vs ADR coverage audit — USERGUIDE skills, all plugin distribution channels, and skill↔plugin cross-index against fork ADRs

- **Status**: **Proposed (2026-05-03)** — descriptive audit + gap tracker. **Revised 2026-05-03** with (a) full plugin enumeration across all distribution channels (Claude Code marketplace, npm optional, WASM bundled, IPFS registry, undocumented on-disk), (b) skill↔plugin cross-index, and (c) **verification appendix** with parallel-swarm cross-reference results against actual implementation (5 follow-up ADRs identified). No implementation work; subsequent ADRs will reference this matrix when adding fork-side coverage to currently-uncovered surfaces.
- **Date**: 2026-05-03
- **Deciders**: Henrik Pettersen
- **Related**: ADR-0103 (readme-claims-investigation-roadmap — closest existing tracker, but scoped to README claims, not full skill+plugin coverage matrix), ADR-0051 (remove-direct-integrations-use-plugins), ADR-0113 (plugin-system-integration-completion), ADR-0116 (hive-mind-marketplace-plugin), ADR-0117 (marketplace-mcp-server-registration), ADR-078/3-digit (agent-llm-federation-plugin), ADR-079/3-digit (iot-cognitum-plugin)
- **Scope**: (1) All 37 skills enumerated in upstream `ruvnet/ruflo` USERGUIDE `Skills System` section (3992–4115). (2) All plugins mentioned anywhere in USERGUIDE: 8 Claude Code marketplace plugins (504–520), 14 npm optional plugins (1796–1894), 6 RuVector WASM plugins (1918–1929), 19 IPFS-registry plugins (3594–3634, names not enumerated). (3) All 32 plugin directories under upstream `plugins/`. (4) All 142 fork ADRs.
- **Sources**: `ruvnet/ruflo` USERGUIDE.md `main` @ 2026-05-03 (7,557 lines), upstream `.claude/skills/` (38 dirs), upstream `plugins/` (32 dirs), `docs/adr/` (142 ADRs)

## Context

A prior session denied the existence of `/hive-mind-advanced` despite three USERGUIDE references and 11 SKILL.md files across upstream repos (memory `feedback-hive-mind-advanced-exists.md`). That denial exposed a broader problem: there is no canonical mapping from upstream skill surface → fork ADR coverage, so it is easy to lose track of what we have implemented, partially implemented, or carry as upstream-only.

This ADR is the cross-reference matrix. It is intentionally **descriptive, not prescriptive** — it records the current state so future ADRs can target specific gaps without re-deriving the audit.

### USERGUIDE skill-count inconsistencies (real, in upstream doc itself)

| Source in USERGUIDE | Claimed count |
|---|---|
| Section header line 3992 | "All 42 Skills by Category" |
| Section table enumeration (lines 3995–4115) | **37 skills actually enumerated** |
| Architecture diagram line 54 | "Skills - 130+" |
| Comparison table line 777 | "42+ pre-built" |
| Codex section line 655 | "137+ Skills" *(Codex-namespaced sub-skills; filtered per project standing rule)* |
| Upstream `.claude/skills/` directory | 38 directories |

The "130+" / "137+" counts include namespaced sub-skills (`sparc:architect`, `sparc:coder`, `sc:*`, `github:*`, `hooks:*`, etc.) visible in any active Claude Code session's available-skills list. The "42" is the canonical primary-skill count. The 5-skill gap between "42" claimed and "37" enumerated is undocumented in upstream.

## Decision

**Adopt the matrices below as the canonical fork-side audit of upstream skill surface vs ADR coverage.** Future ADRs that affect a skill listed here MUST update the corresponding row's "Fork ADR" column rather than introducing a parallel mapping.

## Matrix A — 37 USERGUIDE-enumerated skills × USERGUIDE 7-category × Fork ADR mapping

| # | Skill | USERGUIDE category | Fork ADR mapping | Impl status |
|---|---|---|---|---|
| 1 | `agentdb-vector-search` | AgentDB & Memory | ADR-0044 attention-suite, ADR-0102 unified-embedding-index | partial |
| 2 | `agentdb-memory-patterns` | AgentDB & Memory | ADR-0058 memory-storage-analysis, ADR-0086 layer1-storage | impl |
| 3 | `agentdb-learning` | AgentDB & Memory | ADR-0046 self-learning-pipeline-native, ADR-0029 memory-learning-fixes | impl |
| 4 | `agentdb-optimization` | AgentDB & Memory | ADR-0047 quantization-federated, ADR-0030 memory-system-optimization | impl |
| 5 | `agentdb-advanced` | AgentDB & Memory | — (QUIC sync / multi-DB not in fork) | gap |
| 6 | `github-code-review` | GitHub & DevOps | — | upstream-only |
| 7 | `github-project-management` | GitHub & DevOps | — | upstream-only |
| 8 | `github-multi-repo` | GitHub & DevOps | — | upstream-only |
| 9 | `github-release-management` | GitHub & DevOps | — | upstream-only |
| 10 | `github-workflow-automation` | GitHub & DevOps | — | upstream-only |
| 11 | `flow-nexus-platform` | Flow Nexus | — | upstream-only |
| 12 | `flow-nexus-swarm` | Flow Nexus | — | upstream-only |
| 13 | `flow-nexus-neural` | Flow Nexus | — | upstream-only |
| 14 | `reasoningbank-agentdb` | Intelligence & Learning | ADR-0034 pi-brain-collective-intelligence | partial |
| 15 | `reasoningbank-intelligence` | Intelligence & Learning | ADR-0034 pi-brain-collective-intelligence | partial |
| 16 | **`hive-mind-advanced`** | **Intelligence & Learning** | **ADR-0104, 0114, 0115, 0119, 0120, 0121, 0122, 0123, 0124, 0125, 0126, 0127, 0128, 0131, 0132 (15 ADRs)** | **active impl — most ADR'd skill in fork** |
| 17 | `v3-ddd-architecture` | V3 Implementation | ADR-0076 architecture-consolidation | partial |
| 18 | `v3-security-overhaul` | V3 Implementation | ADR-0042 security-reliability | partial |
| 19 | `v3-memory-unification` | V3 Implementation | ADR-0073, 0085, 0086, 0091, 0092, 0102, 0110 (7 ADRs) | impl |
| 20 | `v3-performance-optimization` | V3 Implementation | ADR-0099 performance-testing | partial |
| 21 | `v3-swarm-coordination` | V3 Implementation | ADR-0098 swarm-init-sprawl, ADR-0114 architectural-model | partial |
| 22 | `v3-mcp-optimization` | V3 Implementation | ADR-0117 marketplace-mcp-server-registration, ADR-0056 mcp-unified-backend | partial |
| 23 | `v3-core-implementation` | V3 Implementation | ADR-0076 architecture-consolidation, ADR-0067 original-vision-wiring | partial |
| 24 | `v3-integration-deep` | V3 Implementation | ADR-0032 patch-adoption-analysis | partial |
| 25 | `v3-cli-modernization` | V3 Implementation | — | upstream-only |
| 26 | `pair-programming` | Development Workflow | — | upstream-only |
| 27 | `verification-quality` | Development Workflow | ADR-0082 test-integrity-no-fallbacks | partial |
| 28 | `stream-chain` | Development Workflow | — | upstream-only |
| 29 | `skill-builder` | Development Workflow | — | upstream-only |
| 30 | `hooks-automation` | Development Workflow | ADR-0053 worktree-safe-hook-paths | partial |
| 31 | `sparc-methodology` | Development Workflow | — | upstream-only |
| 32 | `swarm-orchestration` | Development Workflow | ADR-0098 swarm-init-sprawl | partial |
| 33 | `swarm-advanced` | Development Workflow | ADR-0098, ADR-0114 architectural-model | partial |
| 34 | `performance-analysis` | Development Workflow | ADR-0099 performance-testing-program | partial |
| 35 | `agentic-jujutsu` | Specialized | — | upstream-only |
| 36 | `worker-benchmarks` | Specialized | — | upstream-only |
| 37 | `worker-integration` | Specialized | — | upstream-only |

**38th on disk:** one additional skill exists in upstream `.claude/skills/` that is filtered from this matrix per a project-standing exclusion rule (memory `feedback-no-codex-mentions.md`). It is not part of the canonical 37-skill USERGUIDE enumeration either.

## Matrix B — 8 USERGUIDE-mentioned marketplace plugins × shipped skills × Fork ADR mapping

USERGUIDE lines 504–520 explicitly highlight 8 marketplace plugins via `/plugin install ruflo-<name>@ruflo`.

| # | Plugin | USERGUIDE one-liner | Skills it ships | Fork ADR |
|---|---|---|---|---|
| 1 | `ruflo-core` | MCP server + base agents | discover-plugins, init-project, ruflo-doctor | ADR-0113 plugin-system-integration |
| 2 | `ruflo-swarm` | Swarm coordination + Monitor | monitor-stream, swarm-init | ADR-0098 swarm-init-sprawl |
| 3 | `ruflo-autopilot` | Autonomous /loop completion | autopilot-loop, autopilot-predict | — |
| 4 | `ruflo-loop-workers` | Background workers + CronCreate | cron-schedule, loop-worker | — |
| 5 | `ruflo-security-audit` | Security scanning | dependency-check, security-scan | ADR-0042 security-reliability |
| 6 | `ruflo-rag-memory` | HNSW memory + AgentDB | memory-bridge, memory-search | ADR-0073, ADR-0086, ADR-0102 |
| 7 | `ruflo-testgen` | Test gap detection + TDD | tdd-workflow, test-gaps | ADR-0079 acceptance-test-completeness |
| 8 | `ruflo-docs` | Doc generation + drift detection | api-docs, doc-gen | — |

**Fork-specific marketplace plugin** (documented only in fork ADRs, not in upstream USERGUIDE):

| Plugin | Skills shipped | Fork ADR |
|---|---|---|
| `ruflo-hive-mind` | hive-mind-advanced (via plugin layer) | ADR-0116 hive-mind-marketplace-plugin, ADR-0117 marketplace-mcp-server-registration |

## Matrix C — 24 plugin directories present in upstream `plugins/` but NOT mentioned in USERGUIDE

These plugin directories ship 60+ additional skills that the USERGUIDE does not document. They are reachable through `/plugin install` but invisible to a user reading the official guide.

| Plugin | Skills shipped (count) | Fork ADR mapping |
|---|---|---|
| `ruflo-adr` | 3 (adr-create, adr-index, adr-review) | — |
| `ruflo-agentdb` | 2 (agentdb-query, vector-search) | ADR-0078 bridge-elimination-agentdb-tools |
| `ruflo-aidefence` | 2 (pii-detect, safety-scan) | — |
| `ruflo-browser` | 2 (browser-scrape, browser-test) | — |
| `ruflo-cost-tracker` | 2 (cost-optimize, cost-report) | — |
| `ruflo-daa` | 2 (cognitive-pattern, daa-agent) | — |
| `ruflo-ddd` | 3 (ddd-aggregate, ddd-context, ddd-validate) | ADR-0076 architecture-consolidation |
| `ruflo-federation` | 3 (federation-audit, federation-init, federation-status) | ADR-078 (3-digit, predates renumbering) agent-llm-federation-plugin |
| `ruflo-goals` | 4 (deep-research, goal-plan, horizon-track, research-synthesize) | — |
| `ruflo-intelligence` | 2 (intelligence-route, neural-train) | ADR-0034 pi-brain-collective-intelligence |
| `ruflo-iot-cognitum` | 5 (iot-anomalies, iot-firmware, iot-fleet, iot-register, iot-witness-verify) | ADR-079 (3-digit) iot-cognitum-plugin |
| `ruflo-jujutsu` | 2 (diff-analyze, git-workflow) | — |
| `ruflo-knowledge-graph` | 2 (kg-extract, kg-traverse) | — |
| `ruflo-market-data` | 2 (market-ingest, market-pattern) | — |
| `ruflo-migrations` | 2 (migrate-create, migrate-validate) | — |
| `ruflo-neural-trader` | 6 (trader-backtest, trader-portfolio, trader-regime, trader-risk, trader-signal, trader-train) | — |
| `ruflo-observability` | 2 (observe-metrics, observe-trace) | — |
| `ruflo-plugin-creator` | 2 (create-plugin, validate-plugin) | — |
| `ruflo-ruvector` | 3 (vector-cluster, vector-embed, vector-hyperbolic) | ADR-0054 ruvector-patch-pipeline, ADR-0059 rvf-native-storage |
| `ruflo-ruvllm` | 2 (chat-format, llm-config) | — |
| `ruflo-rvf` | 2 (rvf-manage, session-persist) | ADR-0073, ADR-0086, ADR-0095, ADR-0130, ADR-0133 |
| `ruflo-sparc` | 3 (sparc-implement, sparc-refine, sparc-spec) | — |
| `ruflo-wasm` | 2 (wasm-agent, wasm-gallery) | — |
| `ruflo-workflows` | 2 (workflow-create, workflow-run) | — |

## Matrix D — 14 npm optional plugins (USERGUIDE 1796–1894)

These are **NOT** in the Claude Code marketplace and **NOT** under upstream `plugins/`. They are separate npm packages installed via `npm install @claude-flow/plugin-X` or `npx ruflo plugins install -n <pkg>`. USERGUIDE groups them into 4 sub-categories.

### D.1 — General optional (USERGUIDE 1800–1805) — 4 plugins

| # | Plugin | Version | What it ships | Install | Fork ADR |
|---|---|---|---|---|---|
| 1 | `@claude-flow/plugin-agentic-qe` | 3.0.0-alpha.2 | 58 AI agents across 12 DDD contexts (TDD, coverage, security, chaos, a11y) | `npm install` | — |
| 2 | `@claude-flow/plugin-prime-radiant` | 0.1.4 | 6 math interpretability engines (sheaf cohomology, spectral analysis, causal inference, quantum topology, category theory, HoTT proofs) | `npm install` | — |
| 3 | `@claude-flow/plugin-gastown-bridge` | 0.1.0 | Gas Town orchestrator integration with 20 MCP tools (WASM formula parsing, Beads sync, convoy mgmt, graph analysis) | `npx ruflo plugins install -n` | — |
| 4 | `@claude-flow/teammate-plugin` | 1.0.0-alpha.1 | Native TeammateTool integration for Claude Code 2.1.19+; 21 MCP tools (BMSSP WASM, rate limiting, circuit breaker, semantic routing) | `npx ruflo plugins install -n` | — |

### D.2 — Domain-Specific (USERGUIDE 1809–1813) — 3 plugins

| # | Plugin | Version | What it ships | Compliance | Fork ADR |
|---|---|---|---|---|---|
| 5 | `@claude-flow/plugin-healthcare-clinical` | 0.1.0 | Clinical decision support, FHIR/HL7, symptom analysis, drug interactions | HIPAA | — |
| 6 | `@claude-flow/plugin-financial-risk` | 0.1.0 | Portfolio optimization, fraud detection, regulatory compliance, market simulation | PCI-DSS / SOX | — |
| 7 | `@claude-flow/plugin-legal-contracts` | 0.1.0 | Contract analysis, clause extraction, compliance verification | Attorney-client privilege | — |

### D.3 — Development Intelligence (USERGUIDE 1817–1821) — 3 plugins

| # | Plugin | Version | What it ships | Fork ADR |
|---|---|---|---|---|
| 8 | `@claude-flow/plugin-code-intelligence` | 0.1.0 | GNN-based code analysis, security vuln detection, refactoring suggestions, architecture analysis | — |
| 9 | `@claude-flow/plugin-test-intelligence` | 0.1.0 | AI test generation, coverage analysis, mutation testing, flaky test detection | — |
| 10 | `@claude-flow/plugin-perf-optimizer` | 0.1.0 | Memory leak detection, CPU bottleneck analysis, I/O optimization, caching | — |

### D.4 — Advanced AI / Reasoning (USERGUIDE 1825–1830) — 4 plugins

| # | Plugin | Version | What it ships | Fork ADR |
|---|---|---|---|---|
| 11 | `@claude-flow/plugin-neural-coordination` | 0.1.0 | Multi-agent SONA learning, agent specialization, knowledge transfer, collective decision making | ADR-0034 pi-brain-collective-intelligence (related) |
| 12 | `@claude-flow/plugin-cognitive-kernel` | 0.1.0 | Working memory, attention control, meta-cognition, task scaffolding (Miller's Law 7±2) | — |
| 13 | `@claude-flow/plugin-quantum-optimizer` | 0.1.0 | Quantum-inspired optimization (QAOA, VQE, quantum annealing, Grover search, tensor networks) | — |
| 14 | `@claude-flow/plugin-hyperbolic-reasoning` | 0.1.0 | Poincaré embeddings, tree-like structure analysis, taxonomic inference | — |

**Skills shipped by these 14 plugins:** USERGUIDE does not enumerate skills per optional plugin. They primarily ship MCP tools (e.g. agentic-qe ships 58 *agents*, gastown-bridge ships 20 *MCP tools*, teammate-plugin ships 21 *MCP tools*) — not skills in the `.claude/skills/` sense. Verifying skill counts requires installing each plugin and inspecting their package contents (deferred — out of scope for this audit).

## Matrix E — 6 RuVector WASM plugins (USERGUIDE 1918–1929)

Bundled inside the `@claude-flow/plugins` package (Plugin SDK). Pre-built WASM extensions, not separately installable.

| # | Plugin class | What it does | Performance claim | Fork ADR |
|---|---|---|---|---|
| 1 | `SemanticCodeSearchPlugin` | Semantic code search with vector embeddings | Real-time indexing | ADR-0044 attention-suite, ADR-0102 unified-embedding-index |
| 2 | `IntentRouterPlugin` | Routes user intents to optimal handlers | 95%+ accuracy | — |
| 3 | `HookPatternLibraryPlugin` | Pre-built patterns (security, testing, performance) | — | — |
| 4 | `MCPToolOptimizerPlugin` | Context-aware MCP tool selection | — | — |
| 5 | `ReasoningBankPlugin` | Vector-backed pattern storage with HNSW | 150x faster search | ADR-0034 pi-brain, ADR-0086 layer1-storage |
| 6 | `AgentConfigGeneratorPlugin` | Generates optimized agent configs from pretrain data | — | — |

These are accessed programmatically via `import { ... } from '@claude-flow/plugins'` — not via slash command or `/plugin install`.

## Matrix F — IPFS plugin registry (USERGUIDE 3594–3634)

A separate distribution channel from the Claude Code marketplace. **19 official plugins** with Ed25519 signature verification, live community ratings via Cloud Function. Plugin names are NOT individually enumerated in USERGUIDE; only listed by reference.

| Discovery command | Purpose |
|---|---|
| `npx ruflo plugins list` | List with live ratings |
| `npx ruflo plugins list --type integration` | Filter by type |
| `npx ruflo plugins rate --name X --rating 5` | Rate community plugins |
| `npx ruflo transfer plugin-search --type "mcp-tool" --verified` | Search by type |
| `npx ruflo transfer plugin-info --name X` | Plugin details + dependencies |
| `npx ruflo transfer plugin-featured` | Browse featured |
| `npx ruflo transfer plugin-official` | List 19 official/verified plugins |

USERGUIDE references two specific plugins by name in this registry context: `semantic-code-search`, `@claude-flow/embeddings`. The remaining 17 of the 19 are not named in USERGUIDE — discoverable only via the live registry CLI.

**Live registry CID** (per memory `reference-ruflo-userguide.md` line 28): `bafkreiahw4ufxwycbwwswt7rgbx6hkgnvg3rophhocatgec4bu5e7tzk2a`. Pre-trained models CID: `QmNr1yYMKi7YBaL8JSztQyuB5ZUaTdRMLxJC1pBpGbjsTc` (40 patterns / 8 categories).

**Fork ADR mapping:** None. The fork has no ADR specifically about the IPFS plugin registry surface.

## Plugin discovery / management infrastructure (USERGUIDE 2151, 3596–3624)

Cross-cutting machinery shared across all distribution channels:

| Component | What it provides | Fork ADR |
|---|---|---|
| `plugins` CLI command (5 subcommands) | list, install, uninstall, enable, disable | ADR-0113 plugin-system-integration |
| `transfer plugin-*` commands | IPFS marketplace operations | — |
| `/reload-plugins` slash command | Reload after install | ADR-0113 |
| `PluginBuilder` API (USERGUIDE 1781–1794) | Fluent builder for MCP tools, hooks, workers, providers | ADR-0051 remove-direct-integrations-use-plugins |
| Performance budget | Load <20ms, hook exec <0.5ms, worker spawn <50ms | — |
| `@claude-flow/plugins` package | Plugin SDK (`PluginBuilder`, `createPlugin`); also bundles 6 RuVector WASM plugins | — |

## Plugin → skill cross-index (skills shipped per plugin)

This is a complete map of which plugin ships which skill, derived from on-disk plugin/skills enumeration. **Only Claude Code marketplace plugins (Matrix B) and on-disk plugins (Matrix C) ship skills in the `.claude/skills/` sense.** npm optional plugins (Matrix D), WASM bundled plugins (Matrix E), and IPFS registry plugins (Matrix F) ship MCP tools / agents / programmatic APIs, not skills.

### Plugins that ship skills — 32 plugins, 79 skills total

| Plugin | Skills shipped | Count |
|---|---|---|
| `ruflo-adr` | adr-create, adr-index, adr-review | 3 |
| `ruflo-agentdb` | agentdb-query, vector-search | 2 |
| `ruflo-aidefence` | pii-detect, safety-scan | 2 |
| `ruflo-autopilot` | autopilot-loop, autopilot-predict | 2 |
| `ruflo-browser` | browser-scrape, browser-test | 2 |
| `ruflo-core` | discover-plugins, init-project, ruflo-doctor | 3 |
| `ruflo-cost-tracker` | cost-optimize, cost-report | 2 |
| `ruflo-daa` | cognitive-pattern, daa-agent | 2 |
| `ruflo-ddd` | ddd-aggregate, ddd-context, ddd-validate | 3 |
| `ruflo-docs` | api-docs, doc-gen | 2 |
| `ruflo-federation` | federation-audit, federation-init, federation-status | 3 |
| `ruflo-goals` | deep-research, goal-plan, horizon-track, research-synthesize | 4 |
| `ruflo-intelligence` | intelligence-route, neural-train | 2 |
| `ruflo-iot-cognitum` | iot-anomalies, iot-firmware, iot-fleet, iot-register, iot-witness-verify | 5 |
| `ruflo-jujutsu` | diff-analyze, git-workflow | 2 |
| `ruflo-knowledge-graph` | kg-extract, kg-traverse | 2 |
| `ruflo-loop-workers` | cron-schedule, loop-worker | 2 |
| `ruflo-market-data` | market-ingest, market-pattern | 2 |
| `ruflo-migrations` | migrate-create, migrate-validate | 2 |
| `ruflo-neural-trader` | trader-backtest, trader-portfolio, trader-regime, trader-risk, trader-signal, trader-train | 6 |
| `ruflo-observability` | observe-metrics, observe-trace | 2 |
| `ruflo-plugin-creator` | create-plugin, validate-plugin | 2 |
| `ruflo-rag-memory` | memory-bridge, memory-search | 2 |
| `ruflo-ruvector` | vector-cluster, vector-embed, vector-hyperbolic | 3 |
| `ruflo-ruvllm` | chat-format, llm-config | 2 |
| `ruflo-rvf` | rvf-manage, session-persist | 2 |
| `ruflo-security-audit` | dependency-check, security-scan | 2 |
| `ruflo-sparc` | sparc-implement, sparc-refine, sparc-spec | 3 |
| `ruflo-swarm` | monitor-stream, swarm-init | 2 |
| `ruflo-testgen` | tdd-workflow, test-gaps | 2 |
| `ruflo-wasm` | wasm-agent, wasm-gallery | 2 |
| `ruflo-workflows` | workflow-create, workflow-run | 2 |

**79 plugin-shipped skills** vs **37 USERGUIDE-enumerated standalone skills** (Matrix A) — the plugin layer roughly doubles the actual on-disk skill surface beyond what USERGUIDE catalogs in its main Skills System section.

## Cross-reference findings

### Finding 1 — USERGUIDE has internal count inconsistencies
"42 Skills" header vs "37 enumerated" table is a 5-skill gap that exists in upstream documentation itself. No fork ADR currently tracks USERGUIDE accuracy for the skill enumeration; ADR-0103 (README claims) is the closest analog but scoped to README, not USERGUIDE.

### Finding 2 — `hive-mind-advanced` is the most heavily ADR'd skill in the fork
15 dedicated ADRs (0104, 0114, 0115, 0119–0128, 0131, 0132). The naming overlap (queen-type, worker-type, memory-types-ttl, memory-lru-wal) is direct and intentional — these ADRs are the fork's runtime implementation of the upstream `/hive-mind-advanced` skill spec. This is documented in memory `feedback-hive-mind-advanced-exists.md`.

### Finding 3 — `v3-memory-unification` is the second-most ADR'd
7 ADRs (0073, 0085, 0086, 0091, 0092, 0102, 0110). Storage subsystem is the fork's second-largest ADR cluster after hive-mind.

### Finding 4 — 15 of 37 USERGUIDE-enumerated skills (41%) have ZERO fork ADR coverage
github-* (5), flow-nexus-* (3), pair-programming, stream-chain, skill-builder, sparc-methodology, agentic-jujutsu, worker-benchmarks, worker-integration, v3-cli-modernization. These are upstream surface we ship as-is via fork-patch versioning but make no fork-side decisions about.

### Finding 5 — 24 of 32 upstream plugin directories (75%) are undocumented in USERGUIDE
USERGUIDE marketplace section enumerates 8 plugins; on-disk has 32. The 24 invisible plugins ship 60+ skills total. ADR-078 (3-digit predecessor) and ADR-079 (3-digit) cover two of them (federation, iot-cognitum). The other 22 have no fork ADR.

### Finding 6 — Fork's only marketplace-space ADRs are hive-mind-specific
ADR-0116 (hive-mind-marketplace-plugin) and ADR-0117 (marketplace-mcp-server-registration) are the only fork ADRs explicitly in the marketplace plugin space, and both target only `ruflo-hive-mind`. None of the 8 USERGUIDE-listed marketplace plugins (ruflo-core, ruflo-swarm, ruflo-autopilot, ruflo-loop-workers, ruflo-security-audit, ruflo-rag-memory, ruflo-testgen, ruflo-docs) have a fork-side marketplace-layer ADR refining or extending them.

### Finding 7 — The plugin surface is far larger than USERGUIDE's "marketplace section" suggests
USERGUIDE's marketplace section (504–520) shows 8 plugins. The full plugin surface across all distribution channels is:

| Channel | Count | Documented in USERGUIDE? | Fork ADR coverage |
|---|---:|---|---|
| Claude Code marketplace (`/plugin install`) | 8 | yes (lines 504–520) | 1/8 = 12.5% (only ruflo-hive-mind via ADR-0116/0117) |
| npm optional general | 4 | yes (1800–1805) | 0/4 = 0% |
| npm optional domain-specific | 3 | yes (1809–1813) | 0/3 = 0% |
| npm optional dev-intelligence | 3 | yes (1817–1821) | 0/3 = 0% |
| npm optional advanced AI | 4 | yes (1825–1830) | 1/4 = 25% (neural-coordination via ADR-0034) |
| RuVector WASM bundled | 6 | yes (1918–1929) | 2/6 = 33% (SemanticCodeSearch + ReasoningBank) |
| IPFS registry (named) | 19 | partial (count only; 2 named) | 0/19 = 0% |
| Upstream `plugins/` undocumented | 24 | **no** | 4/24 = 17% (ddd via 0076, federation via 078, intelligence via 0034, iot-cognitum via 079, ruvector via 0054/0059, rvf via multiple) |
| Fork-specific (ruflo-hive-mind) | 1 | no | 1/1 = 100% (ADR-0116, 0117) |
| **Total enumerated** | **72** | — | **9/72 = 12.5%** |

**12.5% fork ADR coverage of the total documented plugin surface.** Of the 8 distribution channels, 5 have zero fork ADR coverage entirely.

### Finding 8 — npm optional plugins are entirely outside the fork's ADR universe
14 npm optional plugins, 0 dedicated fork ADRs. ADR-0034 (pi-brain-collective-intelligence) is the only related ADR, and it predates the optional-plugin enumeration — it's a parallel initiative, not coverage. The fork has made no decisions about: agentic-qe (58 agents), prime-radiant (math interpretability), gastown-bridge (20 MCP tools), teammate-plugin (21 MCP tools), 3 healthcare/financial/legal compliance plugins, 3 dev-intelligence plugins (code/test/perf), 3 of 4 advanced AI plugins (cognitive-kernel, quantum-optimizer, hyperbolic-reasoning).

### Finding 9 — IPFS registry is fork-side dark
USERGUIDE references 19 official IPFS-registry plugins but enumerates only 2 by name (`semantic-code-search`, `@claude-flow/embeddings`). The fork has no ADR about: the IPFS registry surface, the Ed25519 verification model, the `transfer plugin-*` commands, the `plugins rate` system, or the live registry CID. ADR-0113 covers plugin system integration generically but doesn't engage with the IPFS distribution layer specifically.

### Finding 10 — Skill ↔ plugin distribution split: roughly 1/3 standalone, 2/3 plugin-shipped
- 37 USERGUIDE-enumerated standalone skills in `.claude/skills/`
- 79 plugin-shipped skills across 32 on-disk plugin directories
- **116 total skills** (116 = 37 + 79)
- Plugin-shipped skills are ~68% of the actual skill surface but USERGUIDE's "Skills System" section enumerates only the 37 standalone ones — the 79 plugin-shipped skills are discoverable only via individual plugin install + `.claude/skills/` inspection.

## Open questions (deferred to follow-up ADRs, not decided here)

1. **Should the fork upstream a USERGUIDE patch correcting "42 Skills" → "37 Skills" or adding the 5 missing entries?** Memory `feedback-no-upstream-donate-backs.md` says no — fork-only fix. So either: fork-side USERGUIDE correction, or accept the upstream inaccuracy.
2. **Should the 24 undocumented `plugins/` dirs be enumerated in fork docs?** They ship via `/plugin install` whether documented or not. Discoverability gap, not a functional gap.
3. **Should "upstream-only" status (15 of 37 skills + 5 of 8 distribution channels with zero fork ADR coverage) be treated as a problem?** Memory `feedback-no-value-judgements-on-features.md` says default-to-WIRE; no curating. So upstream-only is not a problem in itself, but the absence of fork ADRs means the fork has made no explicit decisions about those surfaces — which can become a problem if upstream changes break fork users. **Particularly acute for the 14 npm optional plugins (Matrix D), where 0% fork ADR coverage means no acceptance tests, no version pinning policy, no compatibility decisions.**
4. **Should the 79 plugin-shipped skills be enumerated alongside the 37 standalone skills in fork-side discoverability tooling?** Currently a user invoking `npx ruflo skill list` likely sees only standalone skills, missing 68% of the actual skill surface.
5. **Should the IPFS registry surface (Matrix F) be brought under fork ADR coverage?** 19 official plugins with Ed25519 signature verification is a security-relevant distribution layer the fork has made no decisions about.

## Consequences

- **Positive**: Future ADRs that touch a skill have a single canonical place to update mapping. Reduces risk of denying a skill's existence (the trigger for this audit).
- **Positive**: Gaps are visible — 41% of skills with no fork-side ADR is now a number, not a vague feeling.
- **Negative**: Matrix becomes stale when upstream USERGUIDE evolves or new ADRs land. Re-running the audit requires re-fetching USERGUIDE + re-listing ADRs. No automation provided in this ADR.

## Re-audit procedure (when needed)

```bash
# Refresh upstream USERGUIDE
gh api repos/ruvnet/ruflo/contents/docs/USERGUIDE.md --jq '.content' | base64 -d > /tmp/USERGUIDE.md

# Matrix A — re-derive 37-skill 7-category enumeration
sed -n '3992,4115p' /tmp/USERGUIDE.md

# Matrix B — re-list 8 Claude Code marketplace plugins
sed -n '504,520p' /tmp/USERGUIDE.md

# Matrix C — re-list 32 on-disk plugins (24 undocumented)
ls /Users/henrik/source/ruvnet/ruflo/plugins/

# Matrix D — re-list 14 npm optional plugins
sed -n '1796,1894p' /tmp/USERGUIDE.md

# Matrix E — re-list 6 RuVector WASM plugins
sed -n '1918,1929p' /tmp/USERGUIDE.md

# Matrix F — re-fetch IPFS registry plugin list (live data)
npx ruflo plugins list

# Plugin → skill cross-index — re-enumerate skills shipped per plugin
for p in /Users/henrik/source/ruvnet/ruflo/plugins/*/skills/; do echo "=== $p ==="; ls "$p" 2>/dev/null; done

# Re-list fork ADRs
ls /Users/henrik/source/ruflo-patch/docs/adr/
```

Compare deltas against the matrices above; update rows in place; bump ADR status to "Superseded by ADR-NNNN" if a re-audit ADR replaces this one.

## Verification appendix — parallel-swarm cross-reference results (2026-05-03)

A 4-agent parallel swarm (`swarm-1777841762100-93o6of`, mesh topology, specialized strategy) verified every concrete claim in this ADR against actual implementation. Findings below; matrix narrative numbers above already corrected to match these results.

### V1 — Matrix A: ADR mapping integrity (13 STRONG / 7 WEAK / 0 MISMATCH out of 20 rows verified)

All 51 claimed ADR files exist. No mapping points to a non-existent ADR.

**STRONG mappings (13)** — ADR clearly implements the skill's domain:
agentdb-vector-search (0044, 0102) · agentdb-memory-patterns (0058, 0086) · agentdb-learning (0046, 0029) · agentdb-optimization (0047, 0030) · hive-mind-advanced (15 ADRs, 1:1 match) · v3-memory-unification (7 ADRs, layered match) · v3-mcp-optimization (0117, 0056) · v3-core-implementation (0076, 0067) · v3-swarm-coordination (0098, 0114) · swarm-orchestration (0098) · swarm-advanced (0098, 0114) · verification-quality (0082) · hooks-automation (0053).

**WEAK mappings (7)** — ADR is topically adjacent but doesn't fully implement the skill:
- `reasoningbank-agentdb → 0034` — ADR-0034 is π.ruv.io collective-intelligence MCP bridge (`brain_search`/`brain_share`), NOT the AgentDB ReasoningBank impl (which is actually ADR-0046). **Should be re-mapped to 0046.**
- `reasoningbank-intelligence → 0034` — same; should re-map.
- `v3-ddd-architecture → 0076` — 0076 is consolidation-plan; mentions DDD only in passing. Skill's "decompose god objects" framing isn't the ADR's center.
- `v3-security-overhaul → 0042` — 0042 is reliability foundation (CircuitBreaker/RateLimiter/ResourceTracker), not CVE remediation. **No ADR exists for actual CVE-1/2/3 patches.**
- `v3-performance-optimization → 0099` — 0099 is proposed (not implemented), explicitly scoped down to 3 lightweight probes. Skill's 2.49x–7.47x targets are aspirational.
- `performance-analysis → 0099` — same.
- `v3-integration-deep → 0032` — 0032 is patch-adoption analysis from claude-flow-patch repo; skill is agentic-flow@alpha integration. Adjacent but different codebase scope.

All 7 WEAK rows already carried `partial` status, which is consistent with the mapping fragility.

### V2 — Matrix B + C: plugin and skill existence (32/32 plugins confirmed, 79 skills total)

- All 8 Matrix B marketplace plugin directories exist; all claimed skills present; no extras.
- All 24 Matrix C undocumented plugin directories exist; every per-plugin skill name + count matches the ADR exactly.
- **Total skill count was wrong: claimed 76, actual 79.** Per-row counts in Matrix B+C summed to 79 all along; narrative arithmetic was off. Corrected throughout (76→79, 113→116, 67%→68%).
- None of the 8 Matrix B plugins contain a `package.json` or `plugin.json`. Layout is `agents/ commands/ skills/ README.md`. MCP tool / agent counts must be derived from individual `.md` files, not a manifest.

### V3 — Matrix D: 14 npm optional plugins (CRITICAL caveats)

**Caveat 1 (large):** All 14 packages resolved against **localhost Verdaccio** (`http://localhost:4873/`), NOT the public npm registry. Tarball URLs all begin with `http://localhost:4873/`. **These packages are unverified to exist on `registry.npmjs.org`.** USERGUIDE marketplace surface may be entirely fork-internal.

**Caveat 2 (version mismatches):** 10 of 14 plugins have wrong version pins. D.2/D.3/D.4 plugins all claimed `0.1.0` but only ship `3.0.0-alpha.1`. The `0.1.0` versions do not exist for these 10:
healthcare-clinical · financial-risk · legal-contracts · code-intelligence · test-intelligence · perf-optimizer · neural-coordination · cognitive-kernel · quantum-optimizer · hyperbolic-reasoning.

**Caveat 3 (functional claims falsified):**
- `agentic-qe`: USERGUIDE claims "58 AI agents". Package description says "51 agents". Tarball ships only 5 YAML agent files. README explicitly states: **"Agent Definitions: 0/58 YAML files Not Started"**. The package contradicts the USERGUIDE claim.
- `teammate-plugin`: USERGUIDE claims "21 MCP tools". Package README says "16 MCP tools".

**Confirmed (2):** prime-radiant 6 engines · gastown-bridge 20 MCP tools.

**Staleness:** 13 of 14 last published 2026-01-23/24/25 (~3.3 months stale as of audit). Only `gastown-bridge` updated 2026-02-13.

### V4 — Matrix E: 0 of 6 RuVector WASM class names actually match; 1 fabricated

The classes exist but **without the `Plugin` suffix the ADR claims**. The `Plugin`-suffixed identifiers are lowercase `const` PluginBuilder instances, not classes:

| Claimed (in ADR) | Real class | Real const | File |
|---|---|---|---|
| `SemanticCodeSearchPlugin` | `SemanticCodeSearch` | `semanticCodeSearchPlugin` | `examples/ruvector-plugins/semantic-code-search.ts` |
| `IntentRouterPlugin` | `IntentRouter` | `intentRouterPlugin` | `intent-router.ts` |
| `HookPatternLibraryPlugin` | `HookPatternLibrary` | `hookPatternLibraryPlugin` | `hook-pattern-library.ts` |
| `MCPToolOptimizerPlugin` | `MCPToolOptimizer` | `mcpToolOptimizerPlugin` | `mcp-tool-optimizer.ts` |
| `ReasoningBankPlugin` | `ReasoningBank` | `reasoningBankPlugin` | `reasoning-bank.ts` |
| **`AgentConfigGeneratorPlugin`** | — | — | **WHOLLY FABRICATED — no file, no class, no const, no reference** |

Bonus 7th sibling **`SONALearning`** exists at `sona-learning.ts` that the ADR doesn't mention.

Real path: `/Users/henrik/source/ruvnet/ruflo/v3/@claude-flow/plugins/examples/ruvector-plugins/`. Re-exported via package subpath `./examples/ruvector`. **Not the package root.**

### V4 — Matrix F: IPFS registry exists but specifics are wrong

- `npx ruflo plugins list` returned **20 plugins** (not 19). Resolved via Pinata gateway in 4.3s.
- `npx ruflo transfer plugin-official` returned: **error — "Unknown command: transfer".** The MCP tool `mcp__claude-flow__transfer_plugin-official` exists but no CLI subcommand wires it.
- **ADR's CID is stale/wrong.** Registry resolved a *different* CID (`QmXbfEAaR7D2Ujm4GAkbwcGZQMHqAMpwDoje4583uNP834`), not ADR's `bafkreiahw4ufxwycbwwswt7rgbx6hkgnvg3rophhocatgec4bu5e7tzk2a`.
- Manifest's `totalPlugins: 19`; CLI surfaces 20. The extra is `teammate-plugin` (omitted from manifest's `official: [...]` array but listed by CLI).
- Registry plugin names enumerated: `@claude-flow/embeddings, security, plugin-agentic-qe, plugin-prime-radiant, claims, plugin-gastown-bridge, neural, plugins, performance, teammate-plugin, plugin-healthcare-clinical, plugin-financial-risk, plugin-legal-contracts, plugin-code-intelligence, plugin-test-intelligence, plugin-perf-optimizer, plugin-neural-coordinator, plugin-cognitive-kernel, plugin-quantum-optimizer, plugin-hyperbolic-reasoning`.
- **Note:** registry has `plugin-neural-coordinator`; Matrix D claims `plugin-neural-coordination`. Name mismatch — one of the two is wrong.
- **None of the 6 Matrix-E RuVector classes appear in the registry.** Registry plugins are entirely disjoint.

### Aggregate verification verdict

| Matrix | Existence | Naming | Counts | Versions | Functional claims |
|---|---|---|---|---|---|
| A (37 skills + 51 ADR refs) | ✓ all exist | ✓ | ✓ | n/a | 7 of 20 ADR mappings WEAK; 2 should re-map (reasoningbank → 0046) |
| B (8 marketplace plugins) | ✓ | ✓ | ✓ | n/a | ✓ |
| C (24 undocumented plugins) | ✓ | ✓ | ✓ (after 76→79 fix) | n/a | ✓ |
| D (14 npm plugins) | ⚠ Verdaccio-only | ✓ | n/a | ✗ 10 mismatches | ✗ 2 falsified (58→51, 21→16); 1 admits "0/58 not started" |
| E (6 RuVector WASM) | ⚠ 5 of 6 exist with wrong names | ✗ 0/6 match; 1 fabricated | n/a | n/a | n/a |
| F (19 IPFS plugins) | ✓ registry live | ⚠ count is 20 not 19 | ⚠ | n/a | CID stale; named CLI command broken |

**The ADR's strongest claims** (Matrix A skill→ADR mapping, Matrix B/C on-disk plugin enumeration) **survived verification largely intact.** **The ADR's weakest claims** (Matrix D version pins, Matrix E class names, Matrix F specifics) **substantially failed.** The fork-internal skill+plugin surface (A/B/C) is real; the upstream-claimed npm/WASM/IPFS surface (D/E/F) has significant USERGUIDE-vs-reality drift that this ADR was uncritically restating.

## Follow-up ADRs needed

1. **ADR-NNNN — re-map reasoningbank skills**: re-point `reasoningbank-agentdb` and `reasoningbank-intelligence` to ADR-0046 (self-learning-pipeline-native), not ADR-0034. Update Matrix A row 14, 15.
2. **ADR-NNNN — `v3-security-overhaul` has no fork ADR**: ADR-0042 is reliability, not security/CVE patches. Either author a real CVE-remediation ADR or remove the false claim from Matrix A row 18.
3. **ADR-NNNN — npm plugin name and version pin reconciliation**: 10 D.2/D.3/D.4 plugins have wrong versions; `plugin-neural-coordination` vs `plugin-neural-coordinator` name mismatch. Either fix USERGUIDE upstream (banned per memory `feedback-no-upstream-donate-backs.md`) or fork-side acceptance test that pins to actual published versions.
4. **ADR-NNNN — RuVector WASM class export contract**: rename classes to add `Plugin` suffix OR update USERGUIDE to use the actual class names. Currently the docs and code disagree. Also enumerate the 7th sibling `SONALearning`.
5. **ADR-NNNN — IPFS registry CID drift policy**: the registry CID changes when plugins are added (CID is content-addressed). USERGUIDE pinned a specific CID that's already stale. Either refresh on each release or remove the CID claim and reference the live registry only.
