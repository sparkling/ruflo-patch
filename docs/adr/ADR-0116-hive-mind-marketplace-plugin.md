# ADR-0116: Hive-mind marketplace plugin (`ruflo-hive-mind`)

- **Status**: **Plugin shipped 2026-05-02 (packaging Phases 1-2 landed); MCP-resolution gated on ADR-0117 Revision 2026-05-03 (Phase R1)** — verified 2026-05-03: `forks/ruflo/plugins/ruflo-hive-mind/` tree exists with all 31 files (2 skills + 16 agents + 11 commands + README + plugin.json); marketplace.json contains the entry. The plugin manifests correctly follow the service-method pattern (no `mcpServers`, no `npx` in plugin.json) — identical shape to the other 32 marketplace plugins. Tools referenced as `mcp__ruflo__hive-mind_*` resolve once ADR-0117's revised init-side `ruflo` server-key registration lands.
- **Date**: 2026-05-02
- **Deciders**: Henrik Pettersen
- **Depends on**: ADR-0104 (hive-mind queen orchestration), ADR-0113 (plugin system integration), ADR-0114 (swarm/hive-mind architectural model)
- **Related**: ADR-0117 (marketplace MCP server registration — Revision 2026-05-03 switches from parallel umbrella-plugin registration to init service-method; this plugin's `mcp__ruflo__*` references resolve once Phase R1 lands), ADR-0118 (hive-mind runtime gaps tracker — owns the implementation work surfaced by this ADR's verification matrix)
- **Scope**: Fork-side artifact for the sparkling marketplace. Per `feedback-no-upstream-donate-backs.md`, this stays on `sparkling/main`; we do not file a PR against `ruvnet/ruflo`. **Packaging only** — runtime gaps are tracked separately in ADR-0118.

## Implementation status (2026-05-03)

The plugin packaging is complete and shipped. Verified by file inspection:

| Asset | State | Path |
|---|---|---|
| Plugin tree (31 files) | ✓ exists | `forks/ruflo/plugins/ruflo-hive-mind/` |
| `plugin.json` (minimal manifest, service-method pattern) | ✓ matches §plugin.json template | `forks/ruflo/plugins/ruflo-hive-mind/.claude-plugin/plugin.json` |
| 2 skills (`hive-mind`, `hive-mind-advanced`) | ✓ shipped | `skills/*/SKILL.md` |
| 16 agents (5 hive + 1 v3-queen + 7 consensus + 3 topology) | ✓ shipped | `agents/*.md` |
| 11 commands | ✓ shipped | `commands/hive-mind*.md` |
| `marketplace.json` entry | ✓ present | `forks/ruflo/.claude-plugin/marketplace.json` (`ruflo-hive-mind` entry) |
| `lib/acceptance-adr0116-checks.sh` | ⚠ unverified — check existence; AC #1-#16 may be partial | `lib/` |
| End-to-end install test (AC #13) | ⚠ unverified | requires Phase R1 of ADR-0117 to land first for `mcp__ruflo__hive-mind_*` to resolve |

**Why the plugin doesn't need rework even though ADR-0117 was wrong**: this ADR's plugin scope (manifests only — no MCP server registration, no npx commands at the plugin.json level) matches the service-method pattern. The plugin has been correct all along; it was only ADR-0117's separate wiring decision (parallel umbrella-plugin server registration) that needed to be unwound. ruflo-hive-mind's `plugin.json` is structurally identical to ruflo-swarm/ruflo-rag-memory/etc. — minimal `name/description/version/author/license/keywords`, no `mcpServers`, no `command`/`args`.

What's still pending: ADR-0117 Phase R1 (init flip to `ruflo` server-key) must land before this plugin's 524-collective-ref `mcp__ruflo__*` tool calls actually resolve in a Claude Code session. Until then, the plugin installs cleanly and registers its skills/agents/commands, but the MCP tool calls inside those assets fail at invocation time.

## Context

Investigation of the upstream `ruvnet/ruflo@HEAD` skill-installation paths surfaced a concrete gap: the `hive-mind-advanced` skill is documented, recommended, and bundled, but **never installed into a Claude Code project by any automated path**.

Specifically:

| Surface | `hive-mind-advanced` available? | Source |
|---------|:-:|---|
| `docs/USERGUIDE.md` line 4053 promises `/hive-mind-advanced` as a built-in | ✓ | doc |
| `mcp__ruflo__guidance_*` recommends it for the `hive-mind` domain | ✓ | `v3/@claude-flow/cli/src/mcp-tools/guidance-tools.ts:122` |
| Bundled in the published `@claude-flow/cli` npm package | ✓ | `v3/@claude-flow/cli/.claude/skills/hive-mind-advanced/SKILL.md` |
| `npx ruflo init --full` (Claude Code) copies it | ✗ **gap** | `SKILLS_MAP` in `v3/@claude-flow/cli/src/init/executor.ts:35-80` lists 34 skills across 7 categories; `hive-mind-advanced` is in none of them |
| `npx ruflo init upgrade --add-missing` adds it | ✗ **same gap** | Same `SKILLS_MAP` consumed at `executor.ts:632` |
| `npx ruflo init --codex --full` (Codex CLI) copies it | ✓ | Different code path: `v3/@claude-flow/codex/src/initializer.ts:284` copies every skill in `.agents/skills/` when template is `full`/`enterprise` |
| Any of the 32 marketplace plugins ships it | ✗ | `grep -rln hive-mind-advanced plugins/` → 0 results |

The plain `hive-mind` skill is in worse shape — only `.agents/skills/hive-mind/SKILL.md` exists (no Claude Code copy, no bundled-in-cli copy). It reaches Claude Code users via no path at all.

The same investigation found the related agents (5 files in `.claude/agents/hive-mind/`) and commands (11 files in `.claude/commands/hive-mind/`) are bundled in the cli package (`v3/@claude-flow/cli/.claude/{agents,commands}/hive-mind/`) and do get copied by `init --full` via `AGENTS_MAP.hiveMind` (executor.ts:103) and standard command-discovery — so the issue is **isolated to the skills tier**.

## Decision

Ship a new file-based marketplace plugin **`ruflo-hive-mind`** in our fork's marketplace (`sparkling/ruflo`). The plugin scope is **packaging only**: it materialises the existing upstream files (skills, agents, commands) into a `/plugin install ruflo-hive-mind@ruflo`-compatible layout, applies codemod, and ships via GitHub.

The verification matrix below catalogues which advertised features have real runtime behaviour vs. which are documentation-only. **Closing those runtime gaps is out of scope for this ADR** — that work is owned by **ADR-0118 (hive-mind runtime gaps tracker)**, where each gap row becomes a discrete task that can be picked up independently. This ADR is shippable as packaging now, even while runtime gaps remain.

The plugin lives at `forks/ruflo/plugins/ruflo-hive-mind/` and is added to `forks/ruflo/.claude-plugin/marketplace.json`. After codemod, it ships to users as part of the `sparkling/ruflo` GitHub marketplace.

### USERGUIDE-vs-implementation verification matrix

Before specifying what to ship, audit which advertised features have actual upstream implementations vs. which are documentation-only. Evidence sourced from `/Users/henrik/source/ruvnet/ruflo/v3/`. **This matrix is the audit artifact for ADR-0118** — every ⚠/✗ row becomes a tracked gap task there.

| USERGUIDE claim | Status | Implementation evidence (or absence) |
|---|---|---|
| **3 Queen types: Strategic / Tactical / Adaptive** | ⚠ **prompt metadata only** | `commands/hive-mind.ts:75` reads `flags.queenType`, defaults `'strategic'`; line 88 substitutes `👑 Queen Type: ${queenType}` into the prompt string. Zero branching: `grep -nE "queenType === \|case 'strategic'\|case 'tactical'\|case 'adaptive'"` returns nothing across `commands/hive-mind.ts`, `mcp-tools/hive-mind-tools.ts`, `swarm/src/queen-coordinator.ts`. |
| **8 Worker types: researcher / coder / analyst / tester / architect / reviewer / optimizer / documenter** | ⚠ **display grouping + minor scoring** | `commands/hive-mind.ts:199` calls `groupWorkersByType`; line 95 emits `${type}: ${workerGroups[type].length} agents` into the prompt. Real branching exists only in `swarm/src/queen-coordinator.ts:1248-1251` (4 small scoring nudges for `coding`/`review`/`testing`/`coordination` task matches). Six of the eight worker types have no differentiated runtime behaviour; they're labels for Claude to read off the prompt. |
| **3 Consensus voting modes: Majority / Weighted (Queen 3x) / Byzantine** | ✗ **partial** — `Majority` and `Byzantine` real; `Weighted (Queen 3x)` **not implemented** | `mcp-tools/hive-mind-tools.ts:35` defines `type ConsensusStrategy = 'bft' \| 'raft' \| 'quorum'` (no `'weighted'`). `calculateRequiredVotes` at line 70+ implements BFT (2/3+1) and quorum presets (unanimous/majority/supermajority). No queen-3x weighting anywhere. |
| **5 Consensus protocols: Byzantine (PBFT) / Raft / Gossip / CRDT / Quorum** | ✗ **3 of 5** — Byzantine, Raft, Quorum real; **Gossip and CRDT entirely missing** | `ConsensusStrategy` enum only has `bft`/`raft`/`quorum`. The `hive-mind_consensus` MCP tool's `strategy` enum (line 518) is `['bft', 'raft', 'quorum']`. The `gossip-coordinator.md` and `crdt-synchronizer.md` agent files exist as markdown prompts but no runtime engine consumes them. |
| **8 Collective Memory types with TTL** (knowledge perm, context 1h, task 30min, result perm, error 24h, metric 1h, consensus perm, system perm) | ✗ **completely unimplemented** | `mcp-tools/hive-mind-tools.ts:937-1010` (`hive-mind_memory` MCP tool): only supports `get`/`set`/`delete`/`list` against a flat `state.sharedMemory[key]` dict. No memory-type discriminator, no TTL field, no LRU, no SQLite WAL. AgentDB persistence is a best-effort try/catch wrapper around `bridgeStoreEntry`. |
| **Session management: checkpoint/resume, export/import, progress tracking** | ✗ **no implementation in hive-mind layer** | `grep -nE "checkpoint\|exportSession\|importSession\|resumeSession\|saveSession"` returns zero matches in `commands/hive-mind.ts` and `mcp-tools/hive-mind-tools.ts`. State is persisted via `loadHiveState`/`saveHiveState` (flat JSON file) but no checkpoint or import/export tooling. The `hive-mind-sessions.md` and `hive-mind-resume.md` command files exist as documentation. |
| **Adaptive topology: load-based optimization, auto-scaling** | ⚠ **flag exists, no scaling logic** | `swarm/src/unified-coordinator.ts:585` sets `autoScaling: config.autoScaling ?? true` as a config flag. No load-based topology mutation seen. |
| **6 swarm topologies: hierarchical / mesh / hierarchical-mesh / ring / star / adaptive** | ⚠ **prompt metadata only** | `commands/hive-mind.ts:77` reads `flags.topology`, line 90 substitutes `🔗 Topology: ${topology}` into the prompt. No code branches on topology choice. CLI's `TOPOLOGIES` constant at lines 30-35 only enumerates 4 values (`hierarchical`, `mesh`, `hierarchical-mesh`, `adaptive`); `ring` and `star` are USERGUIDE-only — see ADR-0128 §Topology count reconciliation. |
| **9 hive-mind MCP tools** | ✓ **real, all 9 wired** | `mcp-tools/hive-mind-tools.ts` defines: `hive-mind_spawn` (219), `_init` (290), `_status` (337), `_join` (438), `_leave` (474), `_consensus` (506), `_broadcast` (824), `_shutdown` (872), `_memory` (937). |
| **Hive state persistence (RVF + AgentDB)** | ✓ **real** | `loadHiveState`/`saveHiveState` in `mcp-tools/hive-mind-tools.ts`. Best-effort AgentDB sync via `memory-bridge.ts`. ADR-0104 §5 file lock applied. |
| **Queen process spawn (`child_process.spawn('claude', ...)`)** | ✓ **real** | `commands/hive-mind.ts` invokes the user's local `claude` binary with the generated Queen prompt. ADR-0104 §6 contract documented. |
| **7 Consensus & Distributed agent .md files** | ✓ **markdown exists** ⚠ **runtime engines partial** | All 7 files present in `.claude/agents/consensus/`. They're agent-prompt definitions for Claude Code's `Task` tool, not connected to runtime consensus engines. Of the 5 protocols those agents represent, only 3 (BFT, Raft, Quorum) have runtime backing. |
| **3 swarm topology coordinator .md files** (adaptive, hierarchical, mesh) | ✓ **markdown exists** ⚠ **no runtime topology behaviour** | All 3 files present in `.claude/agents/swarm/`. Pure prompt definitions; topology flag is metadata only (see above). |
| **5 hive-mind agent .md files** (queen-coordinator + 4 others) | ✓ **markdown exists** | All 5 files present in `.claude/agents/hive-mind/`. v3 also ships `v3/@claude-flow/cli/.claude/agents/v3/v3-queen-coordinator.md`. |
| **11 hive-mind command .md files** | ✓ **markdown exists** ⚠ **handlers partial** | All 11 files present. The CLI dispatch in `commands/hive-mind.ts` covers the wired subcommands; `sessions`/`resume` lack runtime backing per the row above. |

**Summary of gaps** (advertised but not implemented) — these become T1-T10 in ADR-0118:
- Weighted consensus (Queen 3x voting power) — missing from `ConsensusStrategy` enum (T1)
- Gossip consensus protocol (T2)
- CRDT consensus protocol (T3)
- 8 Memory types and TTLs (T4)
- LRU + SQLite WAL for collective memory (T5)
- Session checkpoint/resume/export/import (T6)
- Differentiated Queen-type behaviour (T7)
- Differentiated Worker-type behaviour beyond display grouping + 4 scoring nudges (T8)
- Adaptive topology — load-based scaling, auto-scaling (T9)
- Differentiated swarm topology runtime behaviour (T10)

**Implication for this plugin**: ship the full markdown surface as-is per `feedback-no-value-judgements-on-features.md` (don't curate), but **annotate the known gaps in the plugin README and per-command frontmatter** so users aren't surprised when they configure `--consensus gossip` and get nothing. As each Tn lands in ADR-0118, the corresponding annotation is removed from this plugin's shipped files.

### USERGUIDE inventory — the contract this plugin must satisfy

The plugin scope is anchored to the upstream USERGUIDE Hive Mind sections. Acceptance checks below use **substring anchors** (e.g. `<summary>👑 <strong>Hive Mind</strong>`, `**Worker Specializations (8 types):**`) rather than line ranges, which would break on any USERGUIDE re-flow.

The §Hive Mind block (anchor: `<summary>👑 <strong>Hive Mind</strong>`) promises:
- 3 Queen types: `Strategic`, `Tactical`, `Adaptive`
- 8 Worker specializations: `researcher`, `coder`, `analyst`, `tester`, `architect`, `reviewer`, `optimizer`, `documenter`
- 3 Voting modes: `Majority`, `Weighted` (Queen 3x), `Byzantine` (2/3 supermajority, f < n/3)
- 8 Collective Memory types with TTL: `knowledge` (perm), `context` (1h), `task` (30min), `result` (perm), `error` (24h), `metric` (1h), `consensus` (perm), `system` (perm)
- 7 CLI commands: `init`, `spawn` (with `--queen-type`, `--consensus`), `status`, `metrics`, `memory`, `sessions`

The §Hive-Mind Coordination block additionally promises:
- Queen-led topology with unlimited agents + sub-workers
- Specialist spawning (security, performance, etc.)
- Adaptive topology (load-based optimization, auto-scaling)
- Session management (checkpoint/resume, export/import, progress tracking)
- `/hive-mind-advanced` skill as the canonical entrypoint

The §Consensus & Distributed agents block promises:
- 7 agents in this category: `byzantine-coordinator`, `raft-manager`, `gossip-coordinator`, `crdt-synchronizer`, `quorum-manager`, `performance-benchmarker`, `security-manager`

The §Consensus Strategies block enumerates 5 distributed agreement protocols:
- `Byzantine (PBFT)`, `Raft`, `Gossip`, `CRDT`, `Quorum`

The plugin must materialise every advertised piece into installable form. Anything missing constitutes a delivery gap against the USERGUIDE.

### Plugin layout

```
forks/ruflo/plugins/ruflo-hive-mind/
├── .claude-plugin/
│   └── plugin.json                     # name, description, version, author, license, keywords
├── skills/
│   ├── hive-mind/
│   │   └── SKILL.md                    # copied from .agents/skills/hive-mind/SKILL.md
│   └── hive-mind-advanced/
│       └── SKILL.md                    # copied from v3/@claude-flow/cli/.claude/skills/hive-mind-advanced/SKILL.md
├── agents/
│   # — Hive coordination tier (5 agents from .claude/agents/hive-mind/) —
│   ├── queen-coordinator.md
│   ├── collective-intelligence-coordinator.md
│   ├── scout-explorer.md
│   ├── swarm-memory-manager.md
│   ├── worker-specialist.md
│   # — V3 queen variant (1 agent from .claude/agents/v3/) —
│   ├── v3-queen-coordinator.md
│   # — Consensus tier (7 agents from .claude/agents/consensus/) —
│   ├── byzantine-coordinator.md
│   ├── raft-manager.md
│   ├── gossip-coordinator.md
│   ├── crdt-synchronizer.md
│   ├── quorum-manager.md
│   ├── performance-benchmarker.md
│   ├── security-manager.md
│   # — Topology coordinators (3 agents from .claude/agents/swarm/) —
│   ├── adaptive-coordinator.md
│   ├── hierarchical-coordinator.md
│   └── mesh-coordinator.md
├── commands/
│   # — All 11 hive-mind commands (from .claude/commands/hive-mind/) —
│   ├── hive-mind.md
│   ├── hive-mind-init.md
│   ├── hive-mind-spawn.md           # supports --queen-type, --consensus flags
│   ├── hive-mind-status.md
│   ├── hive-mind-stop.md
│   ├── hive-mind-resume.md
│   ├── hive-mind-memory.md
│   ├── hive-mind-metrics.md
│   ├── hive-mind-consensus.md
│   ├── hive-mind-sessions.md
│   └── hive-mind-wizard.md
└── README.md                            # documents the full advertised capability set with a USERGUIDE cross-ref
```

**Total assets**: 2 skills + 16 agents + 11 commands + 1 README + 1 `plugin.json` manifest = 31 files.

### `plugin.json`

```json
{
  "name": "ruflo-hive-mind",
  "description": "Queen-led hive-mind collective intelligence — skills, agents, and commands for Byzantine/Raft/Gossip consensus, collective memory, and worker specialization",
  "version": "0.1.0",
  "author": { "name": "Henrik Pettersen", "url": "https://github.com/sparkling" },
  "homepage": "https://github.com/sparkling/ruflo",
  "license": "MIT",
  "keywords": ["ruflo", "hive-mind", "queen-worker", "consensus", "collective-intelligence", "byzantine"]
}
```

Per `ruflo-plugin-creator/skills/create-plugin/SKILL.md` rules: NO `skills`/`commands`/`agents` arrays in `plugin.json` — Claude Code auto-discovers them from the directory structure.

### `marketplace.json` entry

Append to `forks/ruflo/.claude-plugin/marketplace.json:.plugins[]` (existing list is not in alphabetical order, so position is not load-bearing — append at end is fine):

```json
{
  "name": "ruflo-hive-mind",
  "source": "./plugins/ruflo-hive-mind",
  "description": "Queen-led hive-mind collective intelligence with consensus mechanisms"
}
```

### Plugin README skeleton

The shipped `README.md` MUST contain the following sections in order. The materialise script (P1) generates this file from the verification matrix and embedded boilerplate:

```markdown
# ruflo-hive-mind

Queen-led collective intelligence with consensus mechanisms for sparkling/ruflo.

## Install

    /plugin marketplace add sparkling/ruflo
    /plugin install ruflo-hive-mind@ruflo

## What's in the box

- 2 skills: `hive-mind`, `hive-mind-advanced`
- 16 agents (hive coordination, consensus, topology)
- 11 slash commands

## USERGUIDE contract

This plugin materialises everything the upstream USERGUIDE advertises for hive-mind. See `docs/USERGUIDE.md` (upstream) §Hive Mind for the full surface.

## Known gaps vs. USERGUIDE

The following USERGUIDE-advertised features ship as documentation only — runtime support is partial or missing. Tracked in ADR-0118.

| Feature | Status | Evidence | Tracker |
|---|---|---|---|
| Weighted consensus (Queen 3x) | ✗ missing from `ConsensusStrategy` enum | `mcp-tools/hive-mind-tools.ts:35` | ADR-0118 T1 |
| Gossip consensus | ✗ missing from `ConsensusStrategy` enum | `mcp-tools/hive-mind-tools.ts:35,518` | ADR-0118 T2 |
| CRDT consensus | ✗ missing from `ConsensusStrategy` enum | `mcp-tools/hive-mind-tools.ts:35,518` | ADR-0118 T3 |
| 8 Memory types + TTLs | ✗ flat dict, no TTL | `mcp-tools/hive-mind-tools.ts:937-1010` | ADR-0118 T4 |
| LRU + SQLite WAL backend | ✗ JSON file persistence | `loadHiveState`/`saveHiveState` | ADR-0118 T5 |
| Session checkpoint/resume/export/import | ✗ command surfaces only | `commands/hive-mind/{sessions,resume}.md` | ADR-0118 T6 |
| Queen-type behaviour | ⚠ prompt-string substitution only | `commands/hive-mind.ts:75,88` | ADR-0118 T7 |
| Worker-type behaviour | ⚠ display grouping + 4 scoring nudges | `swarm/src/queen-coordinator.ts:1248-1251` | ADR-0118 T8 |
| Adaptive topology (auto-scaling) | ⚠ config flag only | `swarm/src/unified-coordinator.ts:585` | ADR-0118 T9 |
| 6 swarm topologies | ⚠ prompt-string substitution only | `commands/hive-mind.ts:77,90` | ADR-0118 T10 |

When ADR-0118 closes a row, the materialise script removes the row from this README and the corresponding annotation from the relevant command file.
```

### Distribution path

1. **Build branch**: per `reference-fork-workflow.md`, work on `forks/ruflo` build branch and push to `sparkling/main`
2. **Codemod**: scope rename in `plugin.json`/SKILL.md/agent files (`@claude-flow/cli@latest` → `@sparkleideas/cli@latest`, `mcp__claude-flow__*` → `mcp__ruflo__*` per ADR-0113)
3. **Ship**: marketplace is GitHub-served, so a push to `sparkling/main` is the publish action. No npm publish involvement; codemod still requires Verdaccio for `@sparkleideas/cli@latest` resolution during acceptance tests.
4. **Install**: user runs `/plugin marketplace add sparkling/ruflo` (already required for any sparkling plugin per README.md:74), then `/plugin install ruflo-hive-mind@ruflo`. MCP references resolve once **ADR-0117** lands.

### Source-of-truth strategy

Every shipped asset already exists in upstream — this plugin is a **packaging change**, not a content change. The build pipeline copies from these canonical upstream paths at codemod time:

| Plugin path | Upstream source | Notes |
|---|---|---|
| `skills/hive-mind/SKILL.md` | `.agents/skills/hive-mind/SKILL.md` | Codex-only upstream; only path Claude Code users can reach via this plugin |
| `skills/hive-mind-advanced/SKILL.md` | `v3/@claude-flow/cli/.claude/skills/hive-mind-advanced/SKILL.md` | 16,723 B; bundled in cli pkg, byte-identical to `.claude/skills/` and `.agents/skills/` copies; **enumerates all 8 worker types** |
| `agents/queen-coordinator.md` | `.claude/agents/hive-mind/queen-coordinator.md` | |
| `agents/collective-intelligence-coordinator.md` | `.claude/agents/hive-mind/collective-intelligence-coordinator.md` | |
| `agents/scout-explorer.md` | `.claude/agents/hive-mind/scout-explorer.md` | |
| `agents/swarm-memory-manager.md` | `.claude/agents/hive-mind/swarm-memory-manager.md` | |
| `agents/worker-specialist.md` | `.claude/agents/hive-mind/worker-specialist.md` | Generic executor; the 8-worker-type enumeration lives in the SKILL.md, not here |
| `agents/v3-queen-coordinator.md` | `.claude/agents/v3/v3-queen-coordinator.md` | V3 queen variant |
| `agents/byzantine-coordinator.md` | `.claude/agents/consensus/byzantine-coordinator.md` | PBFT, 2/3 supermajority |
| `agents/raft-manager.md` | `.claude/agents/consensus/raft-manager.md` | Leader election + log replication |
| `agents/gossip-coordinator.md` | `.claude/agents/consensus/gossip-coordinator.md` | Epidemic protocol (markdown only — runtime tracked T2) |
| `agents/crdt-synchronizer.md` | `.claude/agents/consensus/crdt-synchronizer.md` | Conflict-free replicated types (markdown only — runtime tracked T3) |
| `agents/quorum-manager.md` | `.claude/agents/consensus/quorum-manager.md` | Configurable read/write quorums |
| `agents/performance-benchmarker.md` | `.claude/agents/consensus/performance-benchmarker.md` | Consensus protocol benchmarks |
| `agents/security-manager.md` | `.claude/agents/consensus/security-manager.md` | Distributed security mechanisms |
| `agents/adaptive-coordinator.md` | `.claude/agents/swarm/adaptive-coordinator.md` | Auto-scaling topology (markdown only — runtime tracked T9) |
| `agents/hierarchical-coordinator.md` | `.claude/agents/swarm/hierarchical-coordinator.md` | Default hive topology |
| `agents/mesh-coordinator.md` | `.claude/agents/swarm/mesh-coordinator.md` | Peer-to-peer alternative |
| `commands/hive-mind*.md` (11 files) | `.claude/commands/hive-mind/` | `README.md` excluded — only the 11 user-facing commands |

To prevent drift, extend `lib/codemod-plugin-skills.sh` (or new `lib/build-hive-mind-plugin.sh`) to materialise the plugin directory from these upstream paths before codemod runs. **Hand-editing the shipped copies is forbidden** — fix at the upstream source and re-run the materialise step.

## Why a marketplace plugin (vs. patching upstream init)

Considered three alternatives:

| Approach | Pros | Cons |
|---|---|---|
| **A: Patch `SKILLS_MAP` in `executor.ts`** to add `hive-mind-advanced` to a new `hiveMind` category | Single line of fork code; fixes `init --full` for everyone | Touches upstream-maintained file; merge-conflict risk every upstream sync; requires re-applying after every `npm run sync`; doesn't help users who chose `init --minimal` and want hive-mind opt-in |
| **B: Create marketplace plugin** (this ADR) | Aligns with the existing 32-plugin pattern; opt-in install matches how niche capabilities ship; survives upstream syncs untouched; works for both `--minimal` and `--full` users | Requires user to know the plugin exists and run `/plugin install`; relies on the marketplace path the user already adopted |
| **C: Both A and B** | Defense in depth | Doubles the maintenance surface |

**Choose B.** Rationale:
1. Per `feedback-no-value-judgements-on-features.md`, the user wants the full surface available; a marketplace plugin makes both skills installable without taking a position on whether they should be in everyone's `init --full`.
2. Per `feedback-patches-in-fork.md`, fork patches are for **bug fixes**. The init-skills omission is a real upstream bug, but it's also reasonable for upstream to consider hive-mind-advanced an opt-in skill — so reframing as "ship as a plugin" sidesteps the policy question.
3. The plugin pattern is the documented v3-era distribution mechanism (per ADR-0113 plugin-system completion, USERGUIDE §Plugin Marketplace). Building a hive-mind plugin exercises the path our other sparkling plugins also use.

If user feedback later shows that opt-in is the wrong default, we can revisit option A in a follow-up ADR.

## Acceptance criteria

A new acceptance check `lib/acceptance-adr0116-checks.sh` covering:

**Pre-check (gates downstream USERGUIDE-anchor checks #6-#11)**: every substring anchor cited below resolves in the cached upstream USERGUIDE.md. Anchors checked: `<summary>👑 <strong>Hive Mind</strong>`, `**Queen Types:**`, `**Worker Specializations (8 types):**`, `**Consensus Mechanisms:**`, `<summary>🤝 <strong>Consensus Strategies</strong>`, `**Collective Memory Types:**`, `**CLI Commands:**`. If any anchor is absent (e.g. upstream re-flowed the doc), this check fails fast with a clear "USERGUIDE drift detected" message rather than letting downstream checks emit confusing partial-match failures.

**Note on command counts**: the plugin ships 11 command files (per §Plugin layout). USERGUIDE's `**CLI Commands:**` block names 6 (init/spawn/status/metrics/memory/sessions); the `stop` subcommand is documented in the §Hive-Mind Coordination block separately. AC #5 verifies the full 11-file set; AC #11 verifies the USERGUIDE-named subset.

1. **Marketplace lists the plugin**: `marketplace.json` parses, `.plugins[].name` contains `ruflo-hive-mind`, `.source` resolves to an existing directory under `plugins/`
2. **`plugin.json` is valid**: required fields (`name`, `description`, `version`) present; FORBIDDEN fields (`skills`, `commands`, `agents`) absent (per `ruflo-plugin-creator/skills/validate-plugin/SKILL.md` check #2)
3. **Both skills present + frontmatter-valid**: `skills/hive-mind/SKILL.md` AND `skills/hive-mind-advanced/SKILL.md` exist; each has frontmatter with `name`, `description`, `allowed-tools`
4. **All 16 agents present + frontmatter-valid**: every agent .md from the source-of-truth table exists with `name`, `description`, `model` frontmatter
5. **All 11 commands present + frontmatter-valid**: each command .md exists with `name`, `description`; `hive-mind-spawn.md` documents `--queen-type` and `--consensus` flags
6. **USERGUIDE contract — Queen types**: anchored on substring `**Queen Types:**` in upstream USERGUIDE; `skills/hive-mind-advanced/SKILL.md` enumerates all 3 (`Strategic`, `Tactical`, `Adaptive`); `hive-mind-spawn.md` documents the `--queen-type` flag with `Strategic|Tactical|Adaptive` allowed values (full enumeration not required at the command file)
7. **USERGUIDE contract — Worker types**: anchored on substring `**Worker Specializations (8 types):**`; `skills/hive-mind-advanced/SKILL.md` enumerates all 8 case-insensitively (`researcher`, `coder`, `analyst`, `tester`, `architect`, `reviewer`, `optimizer`, `documenter`). The shipped `worker-specialist.md` is a generic executor agent and is **not** required to enumerate the 8.
8. **USERGUIDE contract — Consensus algorithms**: anchored on substring `**Consensus Mechanisms:**` (3 voting modes) and `<summary>🤝 <strong>Consensus Strategies</strong>` block (5 protocols); the shipped corpus mentions all 5 protocols (`Byzantine`, `Raft`, `Gossip`, `CRDT`, `Quorum`) plus the 3 voting modes (`Majority`/`Weighted`/`Byzantine`)
9. **USERGUIDE contract — Memory types**: anchored on substring `**Collective Memory Types:**`; `hive-mind-memory.md` enumerates all 8 types with TTLs: `knowledge` (perm), `context` (1h), `task` (30min), `result` (perm), `error` (24h), `metric` (1h), `consensus` (perm), `system` (perm)
10. **USERGUIDE contract — Consensus & Distributed agents tier**: all 7 agents from `.claude/agents/consensus/` are shipped (`byzantine-coordinator`, `raft-manager`, `gossip-coordinator`, `crdt-synchronizer`, `quorum-manager`, `performance-benchmarker`, `security-manager`)
11. **USERGUIDE contract — CLI command coverage**: two anchors. (a) Substring `**CLI Commands:**` block names 6 commands — verify each ships: `hive-mind-init.md`, `hive-mind-spawn.md`, `hive-mind-status.md`, `hive-mind-metrics.md`, `hive-mind-memory.md`, `hive-mind-sessions.md`. (b) `stop` is documented elsewhere — verify `hive-mind-stop.md` ships and contains the substring `hive-mind stop` (its own anchor in the §Hive-Mind Coordination block, not the `**CLI Commands:**` block).
12. **Codemod applied**: no remaining `@claude-flow/cli@latest` strings (must be `@sparkleideas/cli@latest`); no `mcp__claude-flow__*` (must be `mcp__ruflo__*`)
13. **End-to-end install in test project**: from `/tmp/ruflo-e2e-*`, the check is mechanical:

    ```bash
    # Skill registration check
    claude --bare --plugin-dir "$FORK/plugins/ruflo-hive-mind" \
      --append-system-prompt "List loaded skills as one-per-line." \
      -p "list skills" 2>&1 | grep -q "hive-mind-advanced"

    # Command registration check (each of 11 names must appear in /help output)
    output=$(claude --bare --plugin-dir "$FORK/plugins/ruflo-hive-mind" -p "/help" 2>&1)
    for cmd in hive-mind hive-mind-init hive-mind-spawn hive-mind-status hive-mind-stop \
               hive-mind-resume hive-mind-memory hive-mind-metrics hive-mind-consensus \
               hive-mind-sessions hive-mind-wizard; do
      echo "$output" | grep -q "/$cmd" || fail "$cmd not registered"
    done
    ```

    `--bare` skips hooks/auto-memory per `claude --help`, keeping the test deterministic. `--plugin-dir` flag verified to exist in current `claude` CLI.
14. **Source-of-truth drift detector**: re-run the materialise script (P1) into a temp directory and `diff -r` against the checked-in plugin tree. Zero diff after codemod normalisation. (SHA-256 comparisons against pre-codemod upstream paths are NOT used — codemod string substitutions make hash-based comparison impossible.)
15. **Plugin README contains the gap matrix**: `README.md` MUST contain a `## Known gaps vs. USERGUIDE` heading and a table with one row per ⚠/✗ entry from §Verification matrix. Each row MUST include a `Tracker` column citing `ADR-0118 T<n>`. Materialise script (P1) generates the README from the matrix; check asserts row count matches matrix row count.
16. **Per-command implementation-status frontmatter**: every command file whose runtime support is partial or missing MUST carry frontmatter:

    ```yaml
    ---
    name: hive-mind-consensus
    description: ...
    implementation-status: partial   # one of: implemented | partial | missing
    gap-tracker: [ADR-0118-T1, ADR-0118-T2, ADR-0118-T3]
    ---
    ```

    Files that need this annotation: `hive-mind-consensus.md` (T1/T2/T3), `hive-mind-memory.md` (T4/T5), `hive-mind-sessions.md` (T6), `hive-mind-resume.md` (T6). Acceptance check parses frontmatter, asserts `implementation-status` field is present and value matches the matrix verdict, and `gap-tracker` lists at least one ADR-0118 task ID.

    **Parser tolerance assumption**: this AC assumes Claude Code's command-frontmatter parser ignores unknown fields (`implementation-status`, `gap-tracker`) rather than rejecting them. This is the typical YAML-frontmatter contract and matches the parser used by Claude Code as of 2026-05-02. If a future Claude Code release schema-locks command frontmatter, fall back to (a) inline-body annotations under a `## Implementation status` H2, or (b) a side-car `IMPLEMENTATION_STATUS.md` per command. AC #13's E2E install check would catch a parser rejection (commands would fail to register).

The acceptance suite is wired into `scripts/test-acceptance.sh` and runs as part of `npm run test:acceptance` per the cascading-pipeline rules in CLAUDE.md.

## Open questions

1. **Plain `hive-mind` skill scope**: `.agents/skills/hive-mind/SKILL.md` is the only copy upstream. Default in this ADR is to ship it as-is to preserve upstream content; revisit if frontmatter validation fails.
2. **Plugin name collision**: `ruflo-swarm` is the closest existing plugin and overlaps conceptually (queen-led swarms vs. plain swarms). No collision — they coexist as separate plugins per the upstream marketplace pattern.
3. **Consensus-agent overlap with future `ruflo-consensus` plugin**: this plugin ships all 7 consensus-tier agents because the USERGUIDE advertises them as part of the hive-mind capability. If a separate `ruflo-consensus` plugin is later created, agents will be duplicated across both — acceptable per `feedback-no-value-judgements-on-features.md`. Revisit if duplication causes Claude Code agent-name collisions.
4. **Versioning cadence**: **Resolved.** Semver, starting at `0.1.0`. Bump minor on any source-of-truth materialise drift (drift detector trips during build). Bump patch only for materialise-script bug fixes that don't change shipped content. No date-based versioning.
5. **Should the plugin also install slash-command shortcuts for the 8 worker types?** USERGUIDE doesn't promise `/researcher`, `/coder`, etc. as standalone commands. Out of scope unless explicitly requested in a follow-up.

## Implementation plan

Scope is packaging only. P1 (materialise script) precedes P2/P3 because the script *generates* both — hand-editing the shipped tree is forbidden per §Source-of-truth strategy. Three commits, then acceptance wiring.

### Commit 1 — `lib/build-hive-mind-plugin.sh` (P1) in fork

**Behaviour**:
- Reads upstream paths from §Source-of-truth strategy table (hardcoded — upstream path drift surfaces as a fail, not silent corruption)
- Copies skill/agent/command files to `forks/ruflo/plugins/ruflo-hive-mind/`
- Inline codemod: `@claude-flow/cli@latest` → `@sparkleideas/cli@latest`, `mcp__claude-flow__*` → `mcp__ruflo__*`
- Generates `plugin.json` from the §plugin.json template
- Generates `README.md` from §Plugin README skeleton; filters `## Known gaps vs. USERGUIDE` rows by reading ADR-0118 §Status (only `open` / `in-progress` / `escalated-to-adr` Tns retain a row)
- Generates per-command frontmatter for the 4 annotated files per AC #16 schema, value derived from §Status

**Determinism (AC #14)**: no timestamps, no random suffixes, no locale-dependent sort. Two consecutive runs MUST produce byte-identical trees.

**Pre-flight**: `forks/ruflo` on build branch per `reference-fork-workflow.md`; ADR-0118 §Status populated; upstream USERGUIDE cached.

### Commit 2 — First materialise run + marketplace entry in fork

After running P1, commit the generated tree (31 files) plus the new entry in `forks/ruflo/.claude-plugin/marketplace.json`. Push to `sparkling/main`.

### Commit 3 — Acceptance check in `ruflo-patch`

- `lib/acceptance-adr0116-checks.sh` (new) — implements all 16 ACs + the USERGUIDE-anchor pre-check
- Register in `scripts/test-acceptance.sh`

### Verification gates

| Gate | Command | Pass criterion |
|---|---|---|
| Determinism (AC #14) | run P1 twice; `diff -r` | empty diff |
| USERGUIDE anchors | pre-check in acceptance script | all 7 substrings resolve in cached USERGUIDE |
| Plugin layout (AC #1-#5) | `bash lib/acceptance-adr0116-checks.sh` | green |
| Codemod (AC #12) | `grep -r "@claude-flow/cli@latest" plugins/ruflo-hive-mind` | zero matches |
| End-to-end (AC #13) | `claude --bare --plugin-dir … -p "/help"` grep loop | `/hive-mind-advanced` + 11 commands registered |

### Rollback

If acceptance fails: revert the marketplace.json entry, delete `forks/ruflo/plugins/ruflo-hive-mind/`, revert the acceptance check + `test-acceptance.sh` registration. No npm/Verdaccio rollback — distribution is GitHub-only.

### Cross-Tn lifecycle (after ADR-0118 lands a Tn)

1. ADR-0118 §Status row flips to `complete`
2. Re-run `bash lib/build-hive-mind-plugin.sh` on `forks/ruflo` build branch
3. Diff shows: corresponding README row removed; per-command frontmatter `implementation-status` flipped to `implemented` (or field removed if all Tns annotated on that file are complete)
4. Commit + push to `sparkling/main`; `npm run test:acceptance` re-runs against the new state

## Out of scope

- Patching upstream `executor.ts` (option A above) — addressed only as an alternative considered
- Filing the gap as an issue on `ruvnet/ruflo` — forbidden by `feedback-no-upstream-donate-backs.md`
- Creating a parallel SDK plugin (`@sparkleideas/plugin-hive-mind`) — the SDK-plugin tier (per ADR-0113 / USERGUIDE §Plugin SDK) targets MCP server extension, not skill distribution; not the right tool for this gap
- Auto-installing the plugin during `init --full` — the marketplace pattern is opt-in by design
- **Implementing any of the runtime gaps surfaced in the verification matrix** — owned by ADR-0118

## References

- Investigation transcript: this conversation 2026-05-02
- USERGUIDE.md `/hive-mind-advanced` claim: `/Users/henrik/source/ruvnet/ruflo/docs/USERGUIDE.md:4053`
- USERGUIDE Hive Mind block (substring anchor): `<summary>👑 <strong>Hive Mind</strong>` in `docs/USERGUIDE.md`
- `SKILLS_MAP` gap: `/Users/henrik/source/ruvnet/ruflo/v3/@claude-flow/cli/src/init/executor.ts:35-80`
- Codex-side install path: `/Users/henrik/source/ruvnet/ruflo/v3/@claude-flow/codex/src/initializer.ts:284`
- Plugin authoring contract: `/Users/henrik/source/ruvnet/ruflo/plugins/ruflo-plugin-creator/skills/create-plugin/SKILL.md`
- Plugin validation contract: `/Users/henrik/source/ruvnet/ruflo/plugins/ruflo-plugin-creator/skills/validate-plugin/SKILL.md`
- Existing similar plugin reference: `/Users/henrik/source/ruvnet/ruflo/plugins/ruflo-swarm/`
- Marketplace registry: `/Users/henrik/source/ruvnet/ruflo/.claude-plugin/marketplace.json`
- Runtime gap tracker: ADR-0118
- MCP reference resolution: ADR-0117
