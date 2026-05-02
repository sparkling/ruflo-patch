# ADR-0114: Swarm vs Hive-Mind — v3 architectural model

- **Status**: Proposed (2026-05-02). Investigation; no code changes yet. Frames the model that ADR-0103/0104/0105/0106/0107/0108/0109 should consolidate around. Marketplace gap surfaced by user follow-up to ADR-0113. **Post-empirical-validation 2026-05-02**: substrate+preset model extended to 3 layers (Lens 10) — Layer 1 substrate (CLI, ships, works), Layer 2 protocol (council methodology, NOT shipped, project-specific), Layer 3 execution (Agent tool with personas). Most cross-ADR implementation work (0105/0106/0107/0109) is Layer 1 cleanup; doesn't deliver the hive's USERGUIDE promise. Layer 2 work would be a separate ADR.
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

### Lens 10 — The 3-layer hive architecture (post-empirical-validation 2026-05-02)

User pushback after the adversarial review: "I am still skeptical that we need this massive revision of the hive feature - it's a core part of ruflo, and I refuse to believe that the hive does not work for the millions of installs of ruflo."

Empirical validation in `/tmp/hive-validation-*` test projects + cross-reference with `~/source/hm/semantic-modelling/docs/ontology/odr/council/session-*.md` (374 council session transcripts) revealed that the substrate+preset model from earlier lenses is **incomplete**. The user-visible "hive" is a 3-layer composition, only Layer 1 of which the ruflo CLI delivers:

#### Layer 1 — Substrate (ruflo CLI provides)

The CLI generates session metadata: hive ID, topology, consensus algorithm, queen ID, worker registry. Concretely:

```
$ npx @sparkleideas/cli@3.5.58-patch.320 hive-mind init -t mesh -c raft
$ npx @sparkleideas/cli@3.5.58-patch.320 hive-mind spawn -n 3 -t coder
$ npx @sparkleideas/cli@3.5.58-patch.320 hive-mind status
```

State persists to `.claude-flow/hive-mind/state.json` + `.claude-flow/agents.json`. Empirically tested in fresh-init projects: works correctly. Topology field persists; worker types persist; queen records persist.

**This is what "millions of installs" use successfully.** The substrate layer is solid.

#### Layer 2 — Protocol (NOT shipped by ruflo; project-specific)

The conversational protocol that turns raw substrate into council-quality output. Looking at the semantic-modelling project's 374 sessions, the protocol includes:

- Named experts with consistent perspectives (e.g. ONT-0021 standing panel: Allemang, Hendler, Kendall, Cagle, Gandon, Baker, Davis, Guizzardi, Guarino — each with documented methodology)
- Per-question voting with rationale (READY / CONDITIONAL / REJECT / NEEDS-REWORK)
- Devil's Advocate role (ONT-0021 mandates one)
- Byzantine tally arithmetic (e.g. 4 READY / 3 CONDITIONAL / 1 REJECT)
- Verbatim quotes attributed to named experts
- Queen synthesis with named conditions (not "approved" — "NEEDS-REWORK with 3 conditions: ...")
- Decision table (Concern / Kind / Resolution / Affected §)
- Council transcript at canonical location (`docs/ontology/odr/council/session-NNN-*.md`)

**Empirical finding: ruflo's `hive-mind-advanced` skill (712 lines, ships in `@sparkleideas/cli/.claude/skills/hive-mind-advanced/SKILL.md`) does NOT contain this protocol.** It contains CLI documentation: configuration examples, queen-type tables, memory benchmarks, integration patterns. The skill teaches Claude "how to run the CLI", not "how to produce council output".

The 11 slash commands in `@sparkleideas/cli/.claude/commands/hive-mind/` total 147 lines across 11 files. `hive-mind-spawn.md` is 20 lines describing the `--queen-type` flag. None of them encode the protocol.

So **the protocol layer must be supplied by each project**. The semantic-modelling project supplies their own (ONT-0021 + Council Transcript Storage rule + named panel). Most ruflo users don't supply one — they get the substrate but not the protocol, and use hive-mind for simpler patterns (parallel research dispatch).

#### Layer 3 — Execution (Claude orchestrating; Agent tool, not `--claude`)

From the semantic-modelling project's session log Session 397 line 10820, the actual execution mechanism:

> "Ruflo orchestration per memory rule (`feedback_swarm_source_of_truth.md`) — swarm init via `npx @sparkleideas/cli@latest swarm init`; hive-mind tools loaded via ToolSearch; Agent tool with `run_in_background: true`; all spawns in one message; no status polling after spawn; six notifications awaited silently then synthesised."

The actual hive runs via:
- `ruflo swarm init` (or `hive-mind init`) — Layer 1 metadata
- Each panellist spawned via Claude Code's built-in `Agent` tool with persona-bearing prompt
- Persona mapping (Session 397 example): Martin Fowler → `system-architect`, John Ousterhout → `analyst`, Eric Evans → `ddd-domain-expert`, Rich Hickey → `researcher`, Kent Beck → `tdd-london-swarm`, Barbara Liskov → `architecture`
- Main thread synthesises six independent verdicts into council transcript

The `hive-mind spawn --claude` flag (which shells out via `child_process.spawn('claude', ...)`) is one execution path, but **the proven-in-production path is `Agent` tool with `run_in_background: true`**, NOT the `--claude` subprocess pattern.

#### Why this matters

1. **The "millions of installs" claim is true at Layer 1**: substrate works. Most users use hive-mind for parallel work delegation, simple consensus polls, or as a session-tracking primitive. They don't run real council sessions.
2. **The user pushback was right** about the hive not being broken — but it's incomplete. The hive's *substrate* isn't broken. The *protocol* isn't shipped — and the protocol is what makes the hive produce ONT-0021-quality output.
3. **The init delivery gap I documented in Lens 8** (no `/hive-mind-*` slash commands, no `hive-mind-advanced` skill installed) is sharper than I claimed: even if init DID install the skill, the skill is just CLI documentation. It wouldn't give users the protocol layer.
4. **Most ADR-0105/0106/0107/0109 implementation work is Layer 1 cleanup** (consolidating CLI implementations, wiring class-form alongside inline). It doesn't touch Layer 2 or Layer 3. So even after that work lands, users still won't get council-quality hive output without supplying their own protocol.

#### What "fixing" the hive would actually mean

If the goal is to deliver the hive's *promise* (USERGUIDE: "Queen-led collective intelligence with consensus"), the work is in Layer 2:

- Ship a council protocol skill — an ONT-0021-equivalent — that teaches Claude how to play named experts, do per-question voting, structure adversarial review, write council transcripts.
- Make the `/hive-mind-spawn` slash command embed the protocol in its prompt.
- Make `hive-mind spawn --claude` shell out with a Queen prompt that follows the protocol.

That's a content/template change, not a code change. The implementation work in ADR-0105/0106/0107/0109 doesn't move this needle.

#### Reframe of "What this resolves"

Question 8 in §"What this resolves" (USERGUIDE-vs-CLAUDE.md gating contradiction) gets a sharper answer:
- **CLAUDE.md says don't use hive-mind reflexively** — correct at Layer 1, because using the substrate without the protocol just produces parallel work delegation, not council quality
- **USERGUIDE pitches hive-mind as high-level entry** — overclaims because the protocol that would deliver "collective intelligence with consensus" isn't shipped
- The "gating contradiction" is actually a **delivery gap**: USERGUIDE describes what the hive could be with Layer 2; CLAUDE.md describes what it actually is without Layer 2.

### Lens 9 — Init-generated CLAUDE.md vs USERGUIDE (the gating contradiction)

The init-bootstrap path delivers TWO independently-developed surfaces into a fresh project, and they disagree about hive-mind:

**Surface A — `.claude/commands/hive-mind/*.md` + `.claude/skills/hive-mind-advanced/SKILL.md`** make hive-mind first-class. 11 slash commands (`/hive-mind-init`, `/hive-mind-spawn`, `/hive-mind-status`, ...) plus the deep skill at `.claude/skills/hive-mind-advanced/SKILL.md` describing it as "the pinnacle of multi-agent coordination". USERGUIDE reinforces this with 11 use-case spawn examples covering routine dev work.

**Surface B — `CLAUDE.md` (root, generated by `init/claudemd-generator.ts`)** tells Claude to AVOID hive-mind by default. Two mentions only:

- `agentOrchestration()` (`claudemd-generator.ts:75-78`):
  > "DO NOT call `swarm_init`, `hive-mind_spawn`, or `ruflo swarm init` reflexively at the start of tasks. Only when:
  >   (a) the user explicitly asks for claude-flow coordination, or
  >   (b) persistent cross-session coordination state is actually required."

- `antiDriftConfig()` (`claudemd-generator.ts:96`), gated on "Swarm Configuration (when explicitly required)":
  > "Use `raft` consensus for hive-mind (leader maintains authoritative state)"

What CLAUDE.md does NOT include:
- No `ruflo hive-mind spawn "<obj>"` syntax example
- No flag documentation (`--queen-type`, `--consensus`, `--claude`)
- No when-to-pick prose for hive-mind vs Agent tool vs solo agent spawn
- The "When to Use What" table (line 134-143) lists `ruflo swarm init` for "Persistent swarm coordination (rare, explicit)" but **doesn't mention hive-mind at all**
- No reference to `/hive-mind-advanced` skill or `.claude/commands/hive-mind/*`

**The contradiction is intentional but undocumented at the user level.** Per ADR-0098 (claude-flow swarm sprawl), the CLAUDE.md anti-sprawl posture is the deliberate runtime stance: most multi-agent work should use the Agent tool (zero coordination state), not a claude-flow swarm or hive (heavy coordination state). USERGUIDE was authored before/independently of ADR-0098 and pitches hive-mind as the high-level entry point.

A user who runs `ruflo init`, reads USERGUIDE, types `/hive-mind-spawn "Refactor my service"`, then watches Claude refuse to use hive-mind reflexively (because CLAUDE.md says not to) — gets confused.

This is **not an ADR-0114 model problem** — the model (substrate + preset) is correct. It's a **gating contradiction** between marketing (USERGUIDE) and runtime guidance (CLAUDE.md). Resolution belongs to ADR-0098 (or a successor).

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
4. **"What's all the parallel-silo code in `hive-mind-tools.ts`?"** — Likely **intentional specialization, not technical debt** (revised 2026-05-02 post-adversarial-review). The inline reimpl in `hive-mind-tools.ts:78-163` is ~85 lines of quorum math sufficient for the hive's actual deployment (in-process, small-N, friendly agents, synchronous returns). The 443+513+431 LOC "real" classes in `@claude-flow/swarm/src/consensus/` handle network partitions, message reordering, view changes, timeout escalation — designed for distributed cross-process consensus with adversarial conditions. These are different deployment models that warrant different implementations. Per `feedback-no-value-judgements-on-features` ("default to WIRE for any 'wire vs don't wire' decision"), the policy is to KEEP both: inline for in-process hive, real classes for federation/cross-hive use. Do NOT delete the inline reimpl; do wire the real classes for the federation surface that doesn't yet have them. The 3-way split (real classes + inline reimpl + orphan plugin) reduces to 2-way (real + inline) once the orphan `HiveMindPlugin` class in `shared/src/plugins/official/hive-mind-plugin.ts` is verified unused and removed.
5. **"How many consensus algorithms does hive-mind actually support?"** — USERGUIDE has THREE different lists: hive section says Majority/Weighted/Byzantine; top-level says Raft/Byzantine/Gossip; CLI advertises 5 (byzantine/raft/gossip/crdt/quorum). The architectural model says: the implementations live in `@claude-flow/swarm/src/consensus/`; the hive-mind CLI's `--consensus` flag should accept exactly those — Byzantine, Raft, Gossip (the three real implementations). Majority and Weighted are not separate algorithms; they're configurations of Byzantine (`--threshold=0.5+1` and `--queen-weight=3` respectively). CRDT and Quorum are aspirational — CLI advertises but no handler exists.
6. **"Is the Collective Memory the same as the regular memory system?"** — No. They're parallel stores: collective memory is SQLite-WAL with 8 typed buckets; general memory is AgentDB/HNSW/ReasoningBank. The doc never reconciles them. ADR-0110 (memory backend reconciliation) takes this on; this ADR notes the divergence.
7. **"Should `hive-mind init` be a required prerequisite or optional?"** — USERGUIDE is inconsistent (§691 skips init; §1645 requires it). The architectural model says `init` is OPTIONAL bookkeeping (it just creates the state file); `spawn` must auto-init if state is absent. ADR-0103 should track this UX inconsistency under "README claims investigation".
8. **"USERGUIDE pitches hive-mind as the high-level entry point for routine dev work; CLAUDE.md tells Claude to avoid hive-mind by default. Which is correct?"** — Per ADR-0098, **CLAUDE.md is correct at the runtime layer**: most multi-agent work should use the Agent tool (zero coordination state). USERGUIDE describes the available *capability surface* (yes, hive-mind exists; yes, it can do all 11 use cases listed); CLAUDE.md describes the *runtime gate* (don't reflexively reach for it). These are two different decisions. This ADR doesn't resolve the documentation contradiction — that's ADR-0098's territory. But: a fresh-init'd project ships both surfaces and the user has to reconcile manually. Surfaced by §U3 below.

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

## Adversarial review (2026-05-02)

User pushback after the initial draft: "I am still sceptical that we need this massive revision of the hive feature - it's a core part of ruflo, and I refuse to believe that the hive does not work for the millions of installs of ruflo. Do an adversarial review of all these ADRs."

The pushback exposed a systematic confusion in the original draft: **conflating "code organization could be cleaner" with "feature is broken in production".** They are not the same thing. Most of the implementation work in ADR-0105/0106/0107/0109 is code-cleanup work that the original ADR-0114 framed as bug-fix work.

### Where ADR-0114's earlier draft over-claimed

- §"What this resolves" #4 originally said "the parallel-silo code is technical debt; consensus should call the real classes in `@claude-flow/swarm/src/consensus/`, not the inline reimplementation." The "should" language assumed a single-correct-path that doesn't fit deployment reality. Inline = in-process hive; real classes = distributed federation. Both are valid for their use cases. Revised in-place above.
- The earlier framing of the 3-way consensus split as "technical debt" presumed code duplication is automatically bad. It isn't. Specialization to deployment context is appropriate engineering, not debt.
- The "Refinement to ADR-0114 §Decision needed" phrasing in worker 3's report assumed any difference between the doc's mental model and the code's organization was a code bug. That's backwards — sometimes the doc is incomplete; sometimes the code is more nuanced than the doc.

### Empirical evidence the hive works

- USERGUIDE has 11 specific use-case spawn examples. Users follow these successfully (otherwise issues would be flooding ruvnet/ruflo).
- The skill `/hive-mind-advanced` ships pre-installed via `init`. The 11 slash commands under `.claude/commands/hive-mind/` are user-facing entry points that work in fresh-init'd projects.
- npm download counts hold steady — if first-use of hive-mind broke, drop-off would be observable.
- Per `reference-ruflo-architecture`, the hive uses `child_process.spawn('claude', ...)` against the user's local subscription. This pattern works in production for thousands of users.
- ADR-0104 (Implemented 2026-04-28) verified queen-via-Task-tool end-to-end via live smoke tests. The hive DOES orchestrate as documented.

### What's actually broken vs what's aspirational cleanup

| Issue | Real or aspirational? |
|---|---|
| **USERGUIDE's 3-way consensus list disagrees with itself** | REAL — observable doc inconsistency. ADR-0103 territory. |
| **Onboarding flow inconsistent** (init-vs-direct-spawn) | REAL — observable doc inconsistency. ADR-0103 territory. |
| **CLAUDE.md tells Claude to avoid hive; USERGUIDE pitches hive-first** | REAL gating contradiction. ADR-0098's territory (per Lens 9 + §Done U3). |
| **Marketplace gap — no `ruflo-hive-mind` plugin** | NOT a real bug — ADR-0114 documents that no separate plugin is needed; init delivers hive-mind. |
| **`hive-mind-tools.ts:78-163` reimplements consensus inline** | ASPIRATIONAL CLEANUP — works fine for in-process hive. Wiring real classes is additive (federation), not corrective. |
| **`shared/src/plugins/official/hive-mind-plugin.ts` is orphan code** | POSSIBLY REAL — verify it's truly unused, then delete. Single grep + test scope. |
| **`queen-coordinator.ts` (2030 LOC) not wired** | ASPIRATIONAL CLEANUP — queen-type differentiation already exists via prompt content (§ADR-0104). Wiring the class adds deterministic capability scoring (additive), not missing differentiation. |
| **`topology-manager.ts` (656 LOC) not wired** | ASPIRATIONAL CLEANUP — topology choice IS observable through Queen prompt content + state-file routing. Wiring the class adds deterministic adjacency tracking (additive). |
| **V2's `--worker-types` flag missing in V3** | REAL but low priority — V2-parity. Auto-worker-selection works for the actual usage patterns. |

### Recommended scope reduction for the cross-ADR program

| ADR | Pre-adversarial scope | Post-adversarial scope |
|---|---|---|
| 0103 | "verify which README claims have backing code" | Same scope, but **success criterion is empirical** (does behavior match claim?) NOT structural (is class X imported into method Y?) |
| 0104 | bug fix | Unchanged. Implemented; honest. |
| 0105 | wire topology-manager (replace gap) | **Reframe as additive**: deterministic topology mechanism alongside prompt-driven differentiation that already works |
| 0106 | full wire + delete inline | **Trim**: wire real classes for federation surface; **KEEP** inline for in-process hive. Verify orphan `HiveMindPlugin` class unused, then delete. |
| 0107 | wire queen-coordinator (fix missing differentiation) | **Reframe as additive**: deterministic capability scoring + stall detection alongside working prompt-driven queen-type behavior |
| 0108 | port V2 `--worker-types` (V2-parity) | Lower priority. Real regression but rarely-used flag. |
| 0109 | wire all 4 consensus protocols (federation-grade) | **Match ADR-0106 trimmed scope**: 3 protocols real, CRDT/Quorum aspirational, no replacement of inline |
| 0110 | investigate SQLite shadow path | Unchanged. Modest scope. |

### What stays in ADR-0114's model

The substrate+preset model itself is correct. Hive-mind IS a preset of swarm (queen-led configuration with hierarchical topology + consensus + collective memory). What changes is the **framing** of the parallel implementations: they're appropriate specialization, not debt.

### Risk of the original draft's framing

If the cross-ADR program had proceeded under the original "consolidate the parallel silos" framing, it would have:
- Replaced working in-process consensus (~85 LOC) with distributed-grade consensus (~1400 LOC) for no user-visible benefit
- Added regression risk to the hive's working behavior
- Increased complexity and per-spawn latency (the real classes do view-change negotiation, leader election, message reordering — overhead the hive doesn't need)
- Burned engineering time on cleanup that doesn't ship user value

Per `feedback-no-value-judgements-on-features`: WIRE both, don't replace one with the other. The original draft violated this by recommending replacement.

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
- [ ] **U3**: Reconcile init-shipped surfaces. The fresh-init'd project receives BOTH (a) `.claude/commands/hive-mind/*` + `.claude/skills/hive-mind-advanced/SKILL.md` (hive-mind first-class) AND (b) `CLAUDE.md` saying "DO NOT call hive-mind reflexively". Resolution lives in ADR-0098 (anti-sprawl decision), not here. ADR-0114 just documents the gap and points at ADR-0098 as the canonical gate. Action: ADR-0098 §Status note adds a one-line acknowledgment that USERGUIDE/SKILL describes the capability surface (full feature set), CLAUDE.md describes the runtime gate (when to actually use it), and these are intentionally separate concerns. No code change to claudemd-generator.ts needed.
- [ ] **U4** (post-Lens-10 empirical): Init delivery gap — `executor.ts:826-893` `SKILLS_MAP`+`COMMANDS_MAP` missing `hiveMind` category. Source files exist in published `@sparkleideas/cli/.claude/{skills,commands}/hive-mind*/`; init code never copies them. Fix: add `hiveMind` entries to the two maps. Empirical evidence: `npx @sparkleideas/cli@latest init --full --force` on a fresh `mktemp -d` dir produces 33 skills (none named `hive-mind-advanced`) and 10 commands (no `hive-mind-*`). Single small fix in `forks/ruflo/v3/@claude-flow/cli/src/init/executor.ts`.
- [ ] **U5** (post-Lens-10 protocol gap): The shipped `hive-mind-advanced` skill (712 lines) is CLI documentation, not a council protocol. To deliver USERGUIDE's "queen-led collective intelligence with consensus" promise, the skill content needs to teach Claude the conversational protocol — named experts, per-question voting, byzantine tally, adversarial structure, decision tables. This is content/template work, not code. Could spawn a new ADR (ADR-0115?: "Hive-mind Layer 2 protocol skill"). Out of scope for ADR-0114, but referenced from §Done so it's not lost.

## Revision history

- **2026-05-02 (initial draft)** — proposed by 4-agent research swarm + user-corrected mental model. Written immediately after ADR-0113 closed (Phase D++ pushed to public sparkling/ruflo). The ADR exists to give ADR-0103–0109 a shared model so they can stop disagreeing about what swarm and hive-mind are.
- **2026-05-02 (3-layer architecture revision)** — user requested empirical validation of hive feature on a fresh-init project + cross-reference with `~/source/hm/semantic-modelling/docs/ontology/odr/council/session-*.md` (374 council transcripts) and the project's `docs/ontology/session-log.md` (11,528 lines). Findings:
  - Added **Lens 10**: the user-visible "hive" is a 3-layer composition. Layer 1 (substrate, CLI metadata) ships and works. Layer 2 (council protocol — named experts, voting, byzantine tally, decision tables, adversarial structure) is NOT shipped by ruflo; semantic-modelling supplies their own (ONT-0021). Layer 3 (Claude orchestrating Agent tool spawns per protocol) is the proven-in-production execution path — NOT `hive-mind spawn --claude`.
  - Empirical: `hive-mind-advanced` skill (712 lines in `@sparkleideas/cli/.claude/skills/`) is CLI documentation, not a council protocol. 11 slash commands total 147 lines across 11 files; `hive-mind-spawn.md` is a 20-line CLI flag reference. None encode the conversational protocol.
  - Empirical: published `init --full` doesn't install `/hive-mind-*` slash commands or the `hive-mind-advanced` skill anyway (Lens 9), but even if it did, the content is CLI docs not protocol.
  - Reframed "What this resolves" Q8: the USERGUIDE-vs-CLAUDE.md "contradiction" is actually a **delivery gap**. USERGUIDE describes the hive's promise (with Layer 2); CLAUDE.md describes its substrate-only reality. Neither is wrong.
  - Implication: ADR-0105/0106/0107/0109 implementation work is Layer 1 cleanup. It doesn't deliver the hive's *promise*. To do that requires shipping a Layer 2 protocol skill — content/template work, not code work. Out of scope for ADR-0114; could spawn a new ADR.

- **2026-05-02 (adversarial pushback revision)** — user pushed back on the original draft's framing of parallel implementations as "technical debt requiring consolidation." The hive feature works for the millions-of-installs production use; absence of complaint is empirical evidence that doc-described behavior matches user-visible behavior, even if not via the structural routes the ADRs preferred. Updates applied:
  - §"What this resolves" #4 reframed: parallel-silo code is **intentional specialization** (in-process inline + distributed-grade real classes), not debt. Per `feedback-no-value-judgements-on-features` "default to WIRE", policy is to KEEP both, not replace.
  - New §Adversarial review section (above §Consequences) distinguishes REAL fixes (doc inconsistencies, gating contradiction, V2-parity regression) from ASPIRATIONAL cleanup (parallel implementations, "real classes" wire-up). Most of ADR-0105/0106/0107/0109's implementation work is aspirational cleanup, not bug fixes.
  - New cross-ADR scope-reduction table: 0105/0106/0107/0109 reframed as ADDITIVE (federation surface, deterministic mechanisms alongside working prompt-driven approach), not CORRECTIVE.
  - Risk callout: original draft's framing would have replaced ~85 LOC working in-process consensus with ~1400 LOC distributed-grade consensus for no user benefit. Adversarial review caught this before any code was written.

- **2026-05-02 (CLAUDE.md-vs-USERGUIDE gating revision)** — user follow-up question: "what does the CLAUDE.md installed by init say about how to invoke a hive?" surfaced that the init-generated CLAUDE.md has only TWO hive-mind mentions, both restrictive (`agentOrchestration()` line 75-78 says "DO NOT call hive-mind_spawn reflexively"; `antiDriftConfig()` line 96 is a single configuration tip). USERGUIDE pitches hive-mind as the default high-level entry; CLAUDE.md says avoid by default. Updates applied:
  - Added **Lens 9** documenting the gating contradiction between init-shipped Surface A (commands + skill = hive-mind first-class) and Surface B (CLAUDE.md = anti-sprawl).
  - §"What this resolves" extended from 7 to 8 questions (added: USERGUIDE-vs-CLAUDE.md gating contradiction; resolution belongs to ADR-0098, not here).
  - §Done adds **U3** — point ADR-0098 §Status note at the gap; no code change to `claudemd-generator.ts` needed because the contradiction is intentional layering (capability surface vs runtime gate), not a bug.

- **2026-05-02 (post-hive-research revision)** — formal `ruflo hive-mind` session (`hive-1777720269931-lrliqv`, hierarchical/byzantine, 4 worker slots) ran exhaustive enumeration of every hive/queen mention in `forks/ruflo/docs/USERGUIDE.md`. Updates applied:
  - Added **Lens 8** (USERGUIDE exhaustive enumeration): 50 mentions across 24 distinct surface locations; 11 use-case spawn examples in 3 categories (5 dev / 2 research / 4 ops); 3 internal contradictions documented (consensus list, topology framing, onboarding flow); 6 doc gaps surfaced.
  - Refined §Decision: hive-mind **constrains** topology to hierarchical-with-queen, NOT topology-orthogonal. The earlier draft said "Topology: hierarchical (queen at top)" which was ambiguous — the refinement makes explicit that mesh/ring/star are NOT options for hive-mind.
  - Refined §Decision: Collective Memory is a **parallel store** to general AgentDB/HNSW memory, not layered. Reconciliation tracked by ADR-0110.
  - §"What this resolves" extended from 4 to 7 questions (added: consensus algorithm count + memory layering + init prerequisite).
  - §Done unchanged — cross-references and documentation updates still pending.
  - The hive's worker slots stored as historical record: 4 workers (researcher kphm, analyst ytqk, architect reop, documenter gztu); shutdown clean post-synthesis. Methodology proves the architectural model: a `hive-mind` invocation IS just a swarm with a queen-led agent configuration — exactly what this ADR claims.
