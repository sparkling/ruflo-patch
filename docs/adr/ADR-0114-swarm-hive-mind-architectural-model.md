# ADR-0114: Swarm vs Hive-Mind — v3 architectural model

- **Status**: Proposed (2026-05-02). Investigation; no code changes yet. Frames the model that ADR-0103/0104/0105/0106/0107/0108/0109 should consolidate around. Marketplace gap surfaced by user follow-up to ADR-0113.
- **Date**: 2026-05-02
- **Deciders**: Henrik Pettersen
- **Methodology**: 4-agent parallel research swarm covering ADRs (`v3/implementation/adrs/`), code (`v3/@claude-flow/cli/src/commands/{swarm,hive-mind}.ts`, `mcp-tools/`), plugins (`forks/ruflo/.claude-plugin/marketplace.json`, `plugins/ruflo-swarm/`), and user-facing docs (`docs/USERGUIDE.md`). User-corrected with the v3-canonical mental model after agents reported pre-v3 framing.
- **Depends on**: ADR-0111 (W4 merge brought in current upstream architecture); ADR-0113 (marketplace coverage gap surfaced this question).
- **Related**: ADR-0103, ADR-0104, ADR-0105, ADR-0106, ADR-0107, ADR-0108, ADR-0109 (all of these touch hive-mind/swarm/topology/consensus and need a shared mental model — this ADR documents that model).

## Context

After ADR-0113 closed, a user question — "do we have a plugin for the hive config? if swarm is a plugin, is a hive a kind of swarm? what is the intention upstream?" — surfaced that the project does NOT have a coherent shared model for what swarm is, what hive-mind is, and how they relate. The marketplace ships `ruflo-swarm` (a plugin) but no `ruflo-hive-mind` plugin, and the README of `ruflo-swarm` mentions "Hive-Mind Consensus" while declaring `allowed-tools` for `mcp__ruflo__swarm_*` only — never `mcp__ruflo__hive-mind_*`.

Four parallel research agents over upstream sources returned four DIFFERENT framings of the same concept:

### Lens 1 — Old ADRs (v2-era, ADR-004 + ADR-003 in `v3/implementation/adrs/`)

ADR-003 enumerates four overlapping coordination systems in v2:

> "v2 has four overlapping coordination systems: 1. SwarmCoordinator (mesh, hierarchical, centralized) 2. Hive Mind (queen-led with consensus) 3. Maestro (SPARC methodology) 4. AgentManager (pools and clusters)"
> — `forks/ruflo/v3/implementation/adrs/v3-adrs.md:329-332`

ADR-004 proposed extracting hive-mind as an Official Plugin: `@claude-flow/hive-mind` (`ADR-004-PLUGIN-ARCHITECTURE.md:96-100`). The package was never created. The user rightly noted: ADR-004 is v2-era thinking that v3 walked away from.

### Lens 2 — User-facing USERGUIDE.md (canonical v3 framing)

`forks/ruflo/docs/USERGUIDE.md` organizes the "🐝 Swarm & Coordination" section into THREE sibling `<details>` blocks:

1. **🤖 Agent Ecosystem** — 16 specialized agent roles + custom types across 8 categories. `queen-coordinator` lives in "V3 Specialized" (10 agents); `byzantine-coordinator`, `raft-manager`, `gossip-coordinator` live in "Consensus & Distributed" (7 agents); `hierarchical-coordinator`, `mesh-coordinator`, `adaptive-coordinator` live in "Swarm Coordination" (5 agents).
2. **🐝 Swarm Topologies** — 6 connection patterns: hierarchical, mesh, ring, star, hybrid, adaptive (each with recommended-agent-count, best-for, latency, memory/agent metrics).
3. **👑 Hive Mind** — "Queen-led collective intelligence with consensus". 3 queen types (strategic/tactical/adaptive), 8 worker specializations, 3 consensus mechanisms (majority/weighted/byzantine), 8 collective-memory types with TTLs.

USERGUIDE describes invocation (`USERGUIDE.md:1645-1651`):

```
npx ruflo hive-mind init
npx ruflo hive-mind spawn "Build API"
npx ruflo hive-mind spawn "..." --queen-type strategic --consensus byzantine
```

Comment at `USERGUIDE.md:691` calls this "a hive-mind swarm" — the same coordination concept, different invocation entry point.

### Lens 3 — v3 architecture diagram (user-shared, conceptual)

The v3 architecture diagram groups modules:

```
Core         Memory       Security
Agents       AgentDB      AIDefence
Swarms       HNSW         Validation
Tasks        Cache        CVE Fixes

Integration         Coordination
agentic-flow        Consensus
MCP                 Hive-Mind
```

This presents Coordination as a separate conceptual module from Core. Hive-mind sits in Coordination alongside Consensus. NOT alongside Swarms (which are in Core).

### Lens 4 — Code reality

The diagram's modules are conceptual, not packaging. `ls forks/ruflo/v3/@claude-flow/` shows ONE package owns both diagram boxes' contents:

```
v3/@claude-flow/swarm/src/
├── agent-pool.ts          ← "Core: Agents"
├── workers/               ← "Core: Tasks"
├── unified-coordinator.ts ← "Core: Swarms"
├── queen-coordinator.ts   ← "Coordination: Hive-Mind"
├── consensus/             ← "Coordination: Consensus"
├── coordination/          ← "Coordination" subdir
├── topology-manager.ts
├── federation-hub.ts
└── ...
```

`@claude-flow/agents` is just YAML config (architect/coder/reviewer/security-architect/tester) — no runtime code.

CLI surface is split between `commands/swarm.ts` and `commands/hive-mind.ts`, but the underlying engine is shared. State files diverge:
- `swarm init` → `<projectRoot>/.swarm/swarm-state.json` (schema: `SwarmState{topology, agents, tasks}`)
- `hive-mind init` → `<projectRoot>/.claude-flow/hive-mind/state.json` (schema: `HiveState{topology, queen, workers, consensus, sharedMemory}`)

MCP tool surfaces diverge with **zero overlap**:
- `swarm_*` (4 tools): `swarm_init`, `swarm_status`, `swarm_shutdown`, `swarm_health`
- `hive-mind_*` (9 tools): `spawn`, `init`, `status`, `join`, `leave`, `consensus`, `broadcast`, `shutdown`, `memory`

Consensus implementation is split THREE ways:
- Real classes in `@claude-flow/swarm/src/consensus/{byzantine,raft,gossip}.ts` — proper algorithm implementations
- Inline reimplementation in `cli/src/mcp-tools/hive-mind-tools.ts:78-163` — quorum math, accepts only `'bft'|'raft'|'quorum'`
- Orphan `HiveMindPlugin` class in `shared/src/plugins/official/hive-mind-plugin.ts` — neither path uses it

The CLI advertises 5 consensus strategies (`byzantine`, `raft`, `gossip`, `crdt`, `quorum`); the MCP layer accepts only 3 (`bft`, `raft`, `quorum`). `gossip` and `crdt` are CLI-only labels with no backing handler.

### Lens 5 — Init-installed Claude Code skills (the missing surface)

`ruflo init --full` copies `.claude/skills/hive-mind-advanced/SKILL.md` plus 11 commands under `.claude/commands/hive-mind/` and 5 agents under `.claude/agents/hive-mind/` directly into the user's project. Marketplace plugins are additive ON TOP of these.

USERGUIDE explicitly names the skill: `Ruflo Skill: /hive-mind-advanced — Full hive mind orchestration` — this is the canonical skill identifier shipped via init. USERGUIDE's "🧠 Intelligence & Learning Skills" section categorizes the skill alongside reasoning, patterns, and adaptation skills (description: "Queen-led collective intelligence with consensus"; use case: "Complex multi-agent coordination"). The skill exists to give Claude itself the knowledge needed to orchestrate hive-mind sessions effectively — it's a teaching artifact for the LLM, not a runtime component.

`grep -rln "hive-mind"` across all 32 marketplace plugins returns empty. `ruflo-swarm` plugin's `allowed-tools` list `mcp__ruflo__swarm_init`, `swarm_status`, `swarm_health` — never the hive-mind tools.

### Lens 7 — CLI peer-command framing (the v3 user-facing reality)

USERGUIDE's "V3 CLI Commands — 26 commands with 140+ subcommands" enumerates `swarm` and `hive-mind` as PEER top-level commands:

| Command | Subcommands | Description |
|---|---|---|
| `swarm` | 6 | Multi-agent swarm coordination and orchestration |
| `hive-mind` | 6 | Queen-led Byzantine fault-tolerant consensus |

They sit alongside `init`, `agent`, `memory`, `mcp`, `task`, `session`, `config`, `status`, `start`, `workflow`, `hooks` — not as subset/superset, but as two alternative entry points into the same underlying coordination engine.

USERGUIDE also positions `hive-mind spawn` as the high-level entry point for everyday multi-agent dev tasks, not as some specialized coordination mode. The doc's use-case table includes refactoring, bug fixing, AND spec generation:

```
npx ruflo@latest hive-mind spawn "Refactor user service to repository pattern"
npx ruflo@latest hive-mind spawn "Fix race condition in checkout flow"
npx ruflo@latest hive-mind spawn "Create ADR for authentication system"
```

This is meaningful: hive-mind isn't reserved for "research-heavy" or "consensus-required" tasks. It's the **default high-level entry point** for any objective that benefits from multi-agent decomposition (queen plans, workers execute). Code refactoring, bug fixing, and spec/ADR generation are all framed as natural hive-mind workloads.

This means: from the user's CLI perspective, `swarm` and `hive-mind` are two doors into the same room. The CLI doesn't ask the user to pick "topology then preset" — it gives them direct entry points:
- `swarm <subcmd>` — "I want to manually compose topology + agent set"
- `hive-mind spawn "<objective>"` — "Give me a swarm with the queen-led preset, dispatched on this objective"

The peer-command framing is also why a separate `ruflo-hive-mind` marketplace plugin would feel wrong: it would imply hive-mind is somehow downstream of swarm, but the CLI treats them as siblings.

### Lens 8 — Exhaustive USERGUIDE enumeration (4-worker hive analysis 2026-05-02)

After the initial analysis, a formal `ruflo hive-mind` session was spawned (`hive-1777720269931-lrliqv`, hierarchical/byzantine, 4 worker slots) to do exhaustive enumeration of every hive/queen mention in `forks/ruflo/docs/USERGUIDE.md` (7,557 lines, byte-identical to `ruvnet/ruflo` upstream main since we don't codemod docs). Workers split: researcher (enumeration), analyst (capability matrix), architect (relationships), documenter (user narrative). Findings:

**Coverage**: 50 mentions across 24 distinct surface locations.

| Surface | Count | Loci |
|---|---|---|
| `<details>` summary headings | 2 | §1616 ("Hive Mind"), §2372 ("Hive-Mind Coordination") |
| Inline mentions | 11 | §166, §199, §208–211, §1618, §1620, §2386, §2394, §877 |
| Code blocks | 5 | 3 bash (§680–695, §1644–1652, §2387–2392) + 2 mermaid (§913, §1129) |
| Tables | 24 | Capability comparisons, queen types, consensus mechanisms, CLI summary, use cases (§2884–2924), skill catalog (§4053) |

**11 distinct use-case spawn examples** in 3 categories (per worker 4):

| Category | Count | Examples |
|---|---|---|
| Dev work | 5 | "Implement user authentication" (§691); "Build API" ×2 (§1646, §2389); "Refactor user service to repository pattern" (§2884); "Fix race condition in checkout flow" (§2885) |
| Research/planning | 2 | "Research AI" (§2390); "Create ADR for authentication system" (§2924) |
| Ops/GitHub | 4 | "Review open PRs" (§2915); "Triage new issues" (§2916); "Prepare v2.0 release" (§2917); "Optimize GitHub Actions workflow" (§2918) |

This refutes any framing of hive-mind as "specialized coordination for research-only / consensus-only tasks". The doc explicitly positions hive-mind as the default high-level entry point for everyday dev work, ops, and planning.

**3 internal contradictions in upstream's own doc** (surfaced by worker cross-checks):

1. **Consensus algorithm list disagrees with itself across 3 places:**
   - Hive section (§1635-1637): Majority / Weighted / Byzantine
   - Top-level table (§203, §397): Raft / Byzantine / Gossip
   - CLI advertises 5 (§hive-mind.ts CLI source): byzantine / raft / gossip / crdt / quorum
   - These three lists describe the same feature differently. Gossip and CRDT never appear at the hive layer of USERGUIDE.

2. **Topology relationship is constrained, NOT orthogonal:**
   - §1129 mermaid diagram labels hierarchical as the queen-worker pattern (Queen → Worker 1, 2, 3)
   - §2372 calls it "Queen-led topology"
   - §2376 says hive is "Hierarchical command structure"
   - §2383 lists "Adaptive Topology" inside hive's feature table — but this means auto-scaling within the hierarchical pattern, not topology choice
   - **USERGUIDE never shows hive-mind running on mesh, ring, or star topologies.** Hive-mind constrains topology to "hierarchical with queen at apex".

3. **Onboarding flow is inconsistent:**
   - Hive Mind block (§1645) tells users to `init` first, then `spawn`
   - Quickstart (§691) goes straight to `hive-mind spawn` with no prior init
   - Doc never reconciles whether `init` is a prerequisite or a setup step

**Doc gaps surfaced by worker 4:**
- No prose on when to pick `hive-mind` vs `swarm` vs solo `agent spawn`
- `--claude` flag behavior never described in user prose
- Cost/runtime expectations per spawn missing
- Queen-type → worker-routing logic undocumented (no "strategic queen routes researcher first; tactical queen routes coder first")
- `optimize-memory` subcommand named (§2145) but never explained
- Failure handling only via Byzantine-tolerance bullet (§211, §810); no troubleshooting prose for stuck spawns, blocked consensus, or divergent quorums

**Memory layering surfaced by worker 3:**
- Collective Memory uses **its own SQLite WAL store** with 8 typed buckets (§212, §1639–1641, §2381)
- General Memory uses **AgentDB / HNSW / ReasoningBank** (§222–230)
- These appear to be **parallel stores**, not layered. The doc never reconciles them. There's a `hive-mind memory` subcommand (§1650) separate from the top-level `memory` command (§2137 has 12 memory subcommands; §2145 has 6 hive-mind subcommands including its own `memory`).

### Lens 6 — Agent ecosystem reality (the user's structural insight)

The 16-agent ecosystem categorizes coordination work as AGENT ROLES, not as separate systems:

| Category (USERGUIDE) | Count | Coordinator agents listed |
|---|---|---|
| V3 Specialized | 10 | `queen-coordinator`, `security-architect`, `memory-specialist` |
| Swarm Coordination | 5 | `hierarchical-coordinator`, `mesh-coordinator`, `adaptive-coordinator` |
| Consensus & Distributed | 7 | `byzantine-coordinator`, `raft-manager`, `gossip-coordinator` |

The coordination work is done BY AGENTS, not by separate "coordination machinery". Hive-mind is the configuration where you spawn the queen-coordinator + consensus agents into a swarm. There's no architectural Coordination subsystem distinct from agents — there's a swarm with topology, and you spawn the agents that do the coordination work.

## Decision

Adopt one canonical v3 mental model and document it here. Future code work consolidates around this model.

### Canonical v3 model: substrate + agent presets

```
Swarm = substrate
  ├── topology (hierarchical | mesh | ring | star | hybrid | adaptive)
  └── agents[] (16 roles + custom)
       ├── workers (researcher, coder, analyst, tester, ...)
       └── coordinators (queen-coordinator, byzantine-coordinator,
                         raft-manager, gossip-coordinator,
                         hierarchical-coordinator, mesh-coordinator, ...)

Hive-Mind = preset of (substrate + agent set + persistence config):
  - Topology: HIERARCHICAL (constrained, not chosen) — queen at apex,
              workers below; "adaptive" inside the hive feature table
              means auto-scaling within hierarchical, not topology
              choice. USERGUIDE never shows hive-mind on mesh/ring/star.
  - Required agents: queen-coordinator (1, with strategy: strategic|tactical|adaptive)
                   + byzantine-coordinator (when consensus=byzantine)
                   + raft-manager (when consensus=raft)
                   + 8 worker specializations
                     (researcher, coder, analyst, tester, architect, reviewer,
                      optimizer, documenter)
                   + swarm-memory-manager (collective memory)
  - Default consensus: byzantine (2/3 supermajority, f < n/3 fault tolerance)
  - Alternatives: majority (simple democratic), weighted (queen 3x voting)
  - Collective memory: dedicated SQLite WAL store + LRU cache,
                       parallel to (not layered with) the general
                       AgentDB/HNSW/ReasoningBank memory.
                       8 typed namespaces (knowledge=permanent,
                       context=1h, task=30min, result=permanent,
                       error=24h, metric=1h, consensus=permanent,
                       system=permanent)
```

The preset is more than just a topology+agent set — it also pre-configures the persistence layer (SQLite WAL) and the typed memory namespaces. That's why the "preset" framing is precise: it's a **complete configuration recipe** for the substrate, not just an agent selection.

**Important refinement (post-hive-research 2026-05-02):** the earlier draft of this ADR implied hive-mind is "topology-orthogonal" — that you could compose `hive-mind on mesh` or `hive-mind on ring`. The exhaustive USERGUIDE enumeration (Lens 8) shows that's NOT what the doc encodes. Hive-mind **constrains** topology to hierarchical-with-queen. Mesh/ring/star are alternatives at the swarm layer, not modifiers of hive-mind. Treat the topology axis as "swarm picks topology; hive-mind picks the hierarchical-with-queen variant of swarm".

A "hive-mind" is **a swarm with a specific agent configuration**. NOT a separate system, NOT a kind of swarm — a preset of a swarm.

### What this resolves

1. **"Is hive a kind of swarm?"** — Cleaner: hive-mind is a *preset of* a swarm. The substrate is identical; the agent set differs. **Refinement post-Lens-8**: hive-mind ALSO constrains topology to hierarchical (not topology-agnostic).
2. **"Does hive-mind belong in the marketplace as a separate plugin?"** — No. The plugin surface is `ruflo-swarm`. Hive-mind commands belong inside that plugin as preset shortcuts (`/swarm-spawn-hive-mind`).
3. **"What is the Coordination box in the v3 diagram?"** — Conceptual grouping of agents that DO coordination work. Not a runtime subsystem.
4. **"What's all the parallel-silo code in `hive-mind-tools.ts`?"** — Technical debt. The CLI command `ruflo hive-mind spawn` should ultimately decompose to `ruflo swarm spawn --preset hive-mind --queen-type=strategic --consensus=byzantine`. The state should live in one place. Consensus should call the real classes in `@claude-flow/swarm/src/consensus/`, not the inline reimplementation.
5. **"How many consensus algorithms does hive-mind actually support?"** — USERGUIDE has THREE different lists: hive section says Majority/Weighted/Byzantine; top-level says Raft/Byzantine/Gossip; CLI advertises 5 (byzantine/raft/gossip/crdt/quorum). The architectural model says: the implementations live in `@claude-flow/swarm/src/consensus/`; the hive-mind CLI's `--consensus` flag should accept exactly those — Byzantine, Raft, Gossip (the three real implementations). Majority and Weighted are not separate algorithms; they're configurations of Byzantine (`--threshold=0.5+1` and `--queen-weight=3` respectively). CRDT and Quorum are aspirational — CLI advertises but no handler exists.
6. **"Is the Collective Memory the same as the regular memory system?"** — No. They're parallel stores: collective memory is SQLite-WAL with 8 typed buckets; general memory is AgentDB/HNSW/ReasoningBank. The doc never reconciles them. ADR-0110 (memory backend reconciliation) takes this on; this ADR notes the divergence.
7. **"Should `hive-mind init` be a required prerequisite or optional?"** — USERGUIDE is inconsistent (§691 skips init; §1645 requires it). The architectural model says `init` is OPTIONAL bookkeeping (it just creates the state file); `spawn` must auto-init if state is absent. ADR-0103 should track this UX inconsistency under "README claims investigation".

### What this does NOT decide

This ADR documents the model. It does not implement consolidation. The actual code work — collapsing the parallel silos, unifying state, removing the inline consensus reimpl, exposing presets through `ruflo-swarm` plugin commands — is split across:

- **ADR-0103** (README claims investigation roadmap)
- **ADR-0104** (Hive-Mind Queen orchestration — already addresses Queen-via-Task-tool)
- **ADR-0105** (Topology behavior differentiation)
- **ADR-0106** (Consensus algorithm enforcement)
- **ADR-0107** (Queen type differentiation)
- **ADR-0108** (Mixed-type worker spawns)
- **ADR-0109** (Worker failure handling)

Each of those should reference THIS ADR for the canonical model. When a new ADR talks about "swarm" vs "hive-mind", it's using the substrate + preset model — not the v2-era "two parallel systems" framing or the v3 "Coordination as separate module" diagram framing.

## Consequences

### Positive

- **Shared vocabulary** across ADR-0103 through ADR-0109. They're all describing different facets of the same swarm-substrate-with-presets model. Cross-ADR work doesn't have to re-establish the model each time.
- **Marketplace coverage gap is no longer a separate concern.** `ruflo-swarm` plugin is correctly scoped — it just needs to expose hive-mind as a preset alongside topology selection. No `ruflo-hive-mind` plugin needed.
- **Code consolidation has a clear target.** The three-way consensus split (real classes vs inline reimpl vs orphan plugin) is reducible to one source: `@claude-flow/swarm/src/consensus/`. The CLI command `hive-mind spawn` decomposes into `swarm spawn` + agent-set selection.
- **README marketing claim becomes true.** Currently `ruflo-swarm/README.md:18` mentions "Hive-Mind Consensus" but the plugin doesn't expose it. Under this model, hive-mind IS in the swarm plugin (as a preset), so the README is correct in advance of the code consolidation.
- **Init-installed `.claude/commands/hive-mind/` (11 commands) gets a clear path forward**: collapse to 2-3 (`hive-mind spawn|status|shutdown` as presets). The other 8 (`hive-mind-init`, `-consensus`, `-memory`, `-metrics`, `-resume`, `-sessions`, `-stop`, `-wizard`) become `swarm` operations parametrized by preset.

### Negative

- **Existing CLI users have muscle-memory for `ruflo hive-mind spawn`** as a distinct command. Code consolidation must keep that command working as a thin alias for `ruflo swarm spawn --preset hive-mind`. Tests, acceptance checks, and docs all need to verify the alias.
- **Three-way consensus split is well-entrenched.** ADR-0106 (Consensus algorithm enforcement) takes on the bulk of this. Until it lands, hive-mind's MCP-layer consensus accepts only 3 strategies while the CLI advertises 5 — that's a concrete user-facing inconsistency this ADR doesn't fix.
- **State-file divergence (`.swarm/swarm-state.json` vs `.claude-flow/hive-mind/state.json`) is a load-bearing wart.** Migration from two files to one is a breaking change for any consumer that reads either file directly. Migration plan needs to live in ADR-0110 (Memory backend reconciliation) or a follow-up.
- **The `HiveMindPlugin` class in `shared/src/plugins/official/hive-mind-plugin.ts`** (third orphan reimpl of consensus, in-memory only with `agent-0/1/2` dummy votes) needs explicit deletion or wiring. This ADR doesn't decide which.
- **ADR-004 is now formally superseded.** ADR-004 said `@claude-flow/hive-mind` should be a separate Official Plugin. This ADR says no separate plugin — hive-mind is a preset of `ruflo-swarm`. ADR-004 should be marked Superseded-by-0114.

### Neutral

- **The init-vs-marketplace boundary stays as documented in ADR-0113 §Status note.** Init bootstraps `.claude/{commands,agents,skills}/hive-mind/` directly into the user's workspace. Marketplace plugins extend on top. Under this ADR's model, `ruflo-swarm` plugin's hive-mind preset commands would be ADDITIONAL coverage, not replacing the init-installed content.
- **No urgent timeline.** The model exists; consolidation can happen incrementally as ADR-0103 through ADR-0109 ship. This ADR's status flips from Proposed → Implemented when those ADRs all reference it.

## Status note: relationship to ADR-0103/0104/0105/0106/0107/0108/0109

Each of those ADRs already touches a specific facet of the unified model:

| ADR | What facet |
|---|---|
| 0103 | Investigates README claims (e.g., "Hive-Mind Consensus" — directly resolved by this ADR's marketplace decision) |
| 0104 | Hive-Mind Queen orchestration mechanics (Queen as Task-tool host) |
| 0105 | Topology behavior differentiation (mesh vs hierarchical observable behavior) |
| 0106 | Consensus algorithm enforcement (the three-way consensus split this ADR diagnoses) |
| 0107 | Queen type differentiation (strategic/tactical/adaptive observable behavior) |
| 0108 | Mixed-type worker spawns (heterogeneous agent set within one swarm) |
| 0109 | Worker failure handling |

The action item: each of those ADRs gets a one-line update in their **Related** field pointing at ADR-0114 as the canonical model, so future work doesn't drift back to v2-era framing or the diagram-says-Coordination-is-a-module framing. This ADR's Status flips to Implemented when all 7 cross-references are in place.

## Implementation order

This ADR is a documentation artifact — no code changes. The "implementation" is:

1. **Cross-reference back** — add a one-line Related entry to ADR-0103 through ADR-0109 pointing at ADR-0114 as the canonical model. (~7 single-line edits.)
2. **Mark ADR-004 (upstream's v2-era plugin extraction proposal) as superseded** in our patch repo's reference to it — ADR-0113 §Implementation Log already cites ADR-004 obliquely; add a one-line note that ADR-004's plugin extraction is rejected in favor of the preset model in ADR-0114.
3. **Update `ruflo-swarm/README.md:18` (fork)** — the "Hive-Mind Consensus" mention there is now coherent under this model. No code change needed; the framing is already correct.
4. **Update README.md (patch repo) "Plugin marketplace" section** — say `ruflo-swarm` covers swarm topology + agent roles + hive-mind preset; `ruflo init` provides the bootstrap for `.claude/commands/hive-mind/`.
5. **Defer code consolidation to ADR-0103–0109.** This ADR doesn't trigger code work; it provides the shared model those ADRs build on.

## §Done

- [ ] **CR1**: ADR-0103 §Related field references ADR-0114.
- [ ] **CR2**: ADR-0104 §Related field references ADR-0114.
- [ ] **CR3**: ADR-0105 §Related field references ADR-0114.
- [ ] **CR4**: ADR-0106 §Related field references ADR-0114.
- [ ] **CR5**: ADR-0107 §Related field references ADR-0114.
- [ ] **CR6**: ADR-0108 §Related field references ADR-0114.
- [ ] **CR7**: ADR-0109 §Related field references ADR-0114.
- [ ] **U1**: README.md "Plugin marketplace" subsection clarifies that hive-mind is a swarm preset (not a separate plugin) — currently the README implies they're independent, which contradicts this ADR's model.
- [ ] **U2**: ADR-004 (upstream `v3/implementation/adrs/ADR-004-PLUGIN-ARCHITECTURE.md`) annotated as superseded-by-0114 in our patch repo's tracking — either via an ADR-0114-supersedes note in ADR-0113 §Implementation Log, OR by explicit mention here when we cite ADR-004.

## Revision history

- **2026-05-02 (initial draft)** — proposed by 4-agent research swarm + user-corrected mental model. Written immediately after ADR-0113 closed (Phase D++ pushed to public sparkling/ruflo). The ADR exists to give ADR-0103–0109 a shared model so they can stop disagreeing about what swarm and hive-mind are.
- **2026-05-02 (post-hive-research revision)** — formal `ruflo hive-mind` session (`hive-1777720269931-lrliqv`, hierarchical/byzantine, 4 worker slots) ran exhaustive enumeration of every hive/queen mention in `forks/ruflo/docs/USERGUIDE.md`. Updates applied:
  - Added **Lens 8** (USERGUIDE exhaustive enumeration): 50 mentions across 24 distinct surface locations; 11 use-case spawn examples in 3 categories (5 dev / 2 research / 4 ops); 3 internal contradictions documented (consensus list, topology framing, onboarding flow); 6 doc gaps surfaced.
  - Refined §Decision: hive-mind **constrains** topology to hierarchical-with-queen, NOT topology-orthogonal. The earlier draft said "Topology: hierarchical (queen at top)" which was ambiguous — the refinement makes explicit that mesh/ring/star are NOT options for hive-mind.
  - Refined §Decision: Collective Memory is a **parallel store** to general AgentDB/HNSW memory, not layered. Reconciliation tracked by ADR-0110.
  - §"What this resolves" extended from 4 to 7 questions (added: consensus algorithm count + memory layering + init prerequisite).
  - §Done unchanged — cross-references and documentation updates still pending.
  - The hive's worker slots stored as historical record: 4 workers (researcher kphm, analyst ytqk, architect reop, documenter gztu); shutdown clean post-synthesis. Methodology proves the architectural model: a `hive-mind` invocation IS just a swarm with a queen-led agent configuration — exactly what this ADR claims.
