# ADR-0140: hive-mind-advanced — implementation outline grounded in pre-regression working version

- **Status**: **[RECONCILED 2026-05-29 → DONE-WITH-RESIDUAL; see [[ADR-0270]]]** Piece 1 (the rewritten SKILL.md) shipped (`d3fbfccee`) and **Piece 2 (the two `templates/` files — `generic-council-protocol.md` + `worker-contract.md`) shipped 2026-05-29** in both `.claude/skills/hive-mind-advanced/templates/` and `plugins/ruflo-hive-mind/skills/hive-mind-advanced/templates/` (closing the broken-reference defect ADR-0270 §Confirmation #3 + ADR-0114 §Done U5). Remaining residuals: **Piece 5** (handler-invocation tests for `hive-mind_{join,leave,broadcast,memory}`) and **Piece 6** (substrate-dictated team binding — the blocker for [[ADR-0146]]). Original status preserved below. — Proposed (2026-05-04). Outlines what the `hive-mind-advanced` skill should actually contain and how the surrounding fork-side code should support it, grounded in three independent evidence sources that pre-date the late-March 2026 regression. **Does not** modify ADR-0139's spec — extends it with implementation guidance.
- **Date**: 2026-05-04
- **Deciders**: Henrik Pettersen
- **Builds on**:
  - ADR-0139 (canonical spec from upstream guidance registry — what the capability is *supposed to do*)
  - ADR-0114 §Done U5 (council protocol delivery gap — already identified)
  - ADR-0125 (queen disposition), ADR-0131 (worker failure protocol), ADR-0132 (sub-queen escalation) — already shipped
  - ADR-0138 (shipping working council template — adjacent fork-side work)
- **Diverges from upstream-canonical content**: the SKILL.md body at `forks/ruflo/plugins/ruflo-hive-mind/skills/hive-mind-advanced/SKILL.md` (713 lines, feature-catalogue style) is **upstream-authored** content, also shipped at `~/source/ruvnet/ruflo/.claude/skills/hive-mind-advanced/SKILL.md`, `~/source/ruvnet/ruflo/.agents/skills/hive-mind-advanced/SKILL.md`, `~/source/ruvnet/agentic-flow/.claude/skills/hive-mind-advanced/SKILL.md`, and `~/source/ruvnet/RuVector/.claude/skills/hive-mind-advanced/SKILL.md` (per ADR-0139 §Provenance Correction). Piece 1 of this ADR proposes a **fork-side divergence** — replacing that upstream brochure with a pattern-based template — not a rewrite of fork-authored content. Per memory `feedback-no-upstream-donate-backs.md`, the divergence stays fork-only.
- **Related memory**:
  - `reference-hive-runtime-crosstalk-pattern.md` — in-repo file-based fallback (validated 2026-05-04)
  - `feedback-hive-orchestration-pattern.md` — designed pattern vs reality
  - `feedback-hive-discussion-mechanics.md` — 5-point dialectic criteria
  - `feedback-hive-mind-advanced-exists.md` — 11 SKILL.md paths, ADRs are fork-side

## Context

ADR-0139 established the upstream-canonical spec for the `hive-mind` capability area: 6 MCP tools, 6 CLI commands, 5 consensus agents, 1 skill, one stated purpose ("multiple agents reach agreement on a proposition using BFT/Raft/CRDT"). It pinned **intent** but said nothing about implementation.

The shipped SKILL.md (713 lines, upstream-canonical content) reads as a feature catalogue rather than a procedure, and following it does not produce a working hive. Independent research (delegated 2026-05-05; recorded in ADR-0139 §"Origin of the SKILL.md") established that this isn't a regression: the SKILL.md was authored as a documentation consolidation in commit `94a80842` (2025-10-20, *"21 built-in skills via MCP server … Removed 68 command files (migrated to skills)"*) — specifically, *"Hive Mind Advanced Workflows Skill (11+ files → 1 skill)"* per `v2/docs/development/COMMANDS_TO_SKILLS_MIGRATION.md:132-136`. **There never was a procedure to repair; the body was always documentation.** The rewrite proposed by Piece 1 is therefore a *design from scratch*, not a fix.

The upstream runtime had its own gap. Per `v3/implementation/v3-migration/HIVE-MIND-MIGRATION.md:59-67`, V3 Queen responsibilities — *"Strategic decision-making, Agent capability scoring, Consensus initiation, Task stall detection"* — were marked **"Missing — Needs implementation."** The fork closed this independently:

- **ADR-0103** (2026-04-29) catalogued 6 README claims with full TypeScript implementations orphaned in `swarm/src/` and not imported from `cli/src/` — six investigation verticals (ADR-0105 through ADR-0110).
- **ADR-0118** (2026-05-02) operationalised the closure as a 14-task tracker (T1-T14), with per-task ADRs ADR-0119 through ADR-0128 + ADR-0130/0131/0132 + ADR-0108. Per ADR-0118 §Status table, **all 14 tasks are `complete`** as of 2026-05-03, with commits in both `forks/ruflo` and this `ruflo-patch` repo.

So the runtime advertised by the registry block AND by USERGUIDE §A/§B is now end-to-end implemented in the fork, even where upstream V3 admits it isn't. Piece 1's rewrite can target a fully-implemented fork runtime. ADR-0140's earlier framing ("design procedure against partially-implemented runtime") no longer applies.

We **do** have evidence of a working version:

1. **Pre-regression source code** — `~/source/workingCouncil/ruflo/v3/@claude-flow/cli/src/commands/hive-mind.ts` at commit `0590bf29c` (2026-03-20), the last commit before the TOOL PREFERENCE regression of `7d9c61ad0` (2026-03-25). 1,390 lines.
2. **In-repo file-based crosstalk validation** (2026-05-04) — file-based shared state in `/tmp/<hive-id>/` lets sub-agents read each others' positions and post reactions that genuinely cross-reference. Captured in memory `reference-hive-runtime-crosstalk-pattern.md`.

This ADR distils those sources into an implementation outline: what the fork must contain to make the capability actually work end-to-end, both from a fresh terminal and from inside an existing Claude Code session.

## Evidence — what the working version actually did

### From the pre-regression source (`workingCouncil/ruflo/v3/@claude-flow/cli/src/commands/hive-mind.ts`)

- **Queen prompt = substrate-only.** Lines 65-169 of `generateHiveMindPrompt`. Contents: hive ID, worker distribution, MCP tool catalog (5 categories), 4-phase EXECUTION PROTOCOL (init → distribute → coordinate → complete), coordination tips. **Zero references** to: named experts, panel, Devil's Advocate, dialectic, transcript shape, vote format. The protocol layer was *not* in the queen prompt.
- **Queen launch = subprocess.** Lines 176-300 (`spawnClaudeCodeInstance`): `child_process.spawn('claude', [...claudeArgs, hiveMindPrompt], { stdio: 'inherit', shell: false })`. The fresh `claude` instance inherits the parent's TTY and takes over the terminal.
- **Non-interactive mode = stream-json print mode.** Lines 245-261: when `--non-interactive` is passed, `claudeArgs` becomes `['-p', '--output-format', 'stream-json', '--verbose']` instead of TTY-inherit. This is the path that works from inside an existing claude session.
- **Permission flag default = on.** Lines 254-261: `--dangerously-skip-permissions` is added unless explicitly disabled. Required for unattended execution.
- **Fallback when `claude` binary missing.** Lines 333-345: the prompt is saved to `.hive-mind/sessions/hive-mind-prompt-<id>.txt` and the user is told to run it manually. Always-safe degradation.

### From in-repo file-based crosstalk validation (2026-05-04)

Validated in this repo per memory `reference-hive-runtime-crosstalk-pattern.md`:

- **One round of parallel Agent-tool spawns**, not multi-round.
- **All workers share `subagent_type: researcher`** — persona carried in the prompt body, not the type.
- **Workers can cross-reference via file-based shared state** in `/tmp/<hive-id>/` (positions/reactions, sleep-60 barrier) when genuine inter-worker dialectic is required at runtime.
- **Otherwise the queen composes the inter-expert discussion** in the main thread by reading N independent verdicts and writing the dialog using their actual content. Composition is legitimate when every quotation traces to actual worker output; fabrication is illegitimate when no agent verdict backs the transcript.

### From the upstream USERGUIDE — two authoritative spec sections

The upstream `~/source/ruvnet/ruflo/docs/USERGUIDE.md` contains two collapsed `<details>` sections that together specify the intended hive-mind feature surface in plain language, beyond the smaller registry block of ADR-0139. **Both are upstream-authored.** Reproduced verbatim:

#### USERGUIDE §A — line 1616 (`👑 Hive Mind — Queen-led collective intelligence with consensus`)

```
The Hive Mind system implements queen-led hierarchical coordination where
strategic queen agents direct specialized workers through collective
decision-making and shared memory.

Queen Types:
| Queen Type  | Best For                       | Strategy                            |
| Strategic   | Research, planning, analysis   | High-level objective coordination   |
| Tactical    | Implementation, execution      | Direct task management              |
| Adaptive    | Optimization, dynamic tasks    | Real-time strategy adjustment       |

Worker Specializations (8 types):
researcher, coder, analyst, tester, architect, reviewer, optimizer, documenter

Consensus Mechanisms:
| Algorithm  | Voting               | Fault Tolerance   | Best For            |
| Majority   | Simple democratic    | None              | Quick decisions     |
| Weighted   | Queen 3x weight      | None              | Strategic guidance  |
| Byzantine  | 2/3 supermajority    | f < n/3 faulty    | Critical decisions  |

Collective Memory Types:
- knowledge (permanent), context (1h TTL), task (30min TTL), result (permanent)
- error (24h TTL), metric (1h TTL), consensus (permanent), system (permanent)

CLI Commands:
  npx ruflo hive-mind init                    # Initialize hive mind
  npx ruflo hive-mind spawn "Build API"       # Spawn with objective
  npx ruflo hive-mind spawn "..." --queen-type strategic --consensus byzantine
  npx ruflo hive-mind status                  # Check status
  npx ruflo hive-mind metrics                 # Performance metrics
  npx ruflo hive-mind memory                  # Collective memory stats
  npx ruflo hive-mind sessions                # List active sessions

Performance: Fast batch spawning with parallel agent coordination
```

#### USERGUIDE §B — line 2372 (`👑 Hive-Mind Coordination — Queen-led topology with Byzantine consensus`)

```
| Feature              | Description                       | Capability                                                        |
| Queen-Led Topology   | Hierarchical command structure    | Unlimited agents + sub-workers                                    |
| Queen Types          | Strategic, Tactical, Adaptive     | Research/planning, execution, optimization                        |
| Worker Types         | 8 specialized agents              | researcher, coder, analyst, tester, architect, reviewer, optimizer, documenter |
| Byzantine Consensus  | Fault-tolerant agreement          | f < n/3 tolerance (2/3 supermajority)                             |
| Weighted Consensus   | Queen 3x voting power             | Strategic guidance with democratic input                          |
| Collective Memory    | Shared pattern storage            | 8 memory types with TTL, LRU cache, SQLite WAL                    |
| Specialist Spawning  | Domain-specific agents            | Security, performance, etc.                                       |
| Adaptive Topology    | Dynamic structure changes         | Load-based optimization, auto-scaling                             |
| Session Management   | Checkpoint/resume                 | Export/import, progress tracking                                  |

Quick Commands:
  npx ruflo hive-mind init
  npx ruflo hive-mind spawn "Build API" --queen-type tactical
  npx ruflo hive-mind spawn "Research AI" --consensus byzantine --claude
  npx ruflo hive-mind status

Ruflo Skill: /hive-mind-advanced — Full hive mind orchestration

Performance: Fast batch spawning with token reduction via intelligent routing
```

#### What §A and §B add beyond ADR-0139's registry block

| Concept | In ADR-0139 registry | In USERGUIDE §A/§B |
|---|---|---|
| Three queen types with use-case mapping | ✗ | ✓ (§A table) |
| 8 worker specialisations enumerated | ✗ | ✓ (§A list) |
| 3 consensus algorithms with fault-tolerance bounds | ✗ | ✓ (§A table) |
| 8 collective-memory types with TTLs | ✗ | ✓ (§A list) |
| Adaptive topology / auto-scaling | ✗ | ✓ (§B row) |
| Specialist spawning | ✗ | ✓ (§B row) |
| Session checkpoint/resume/export | ✗ | ✓ (§B row) |
| Skill cross-reference (`/hive-mind-advanced`) | ✗ | ✓ (§B "Ruflo Skill" pointer) |

The registry block (ADR-0139) defines the **MCP-tool API surface**. §A and §B define the **conceptual feature surface** the skill is supposed to expose. Together they bound what `hive-mind-advanced` should do when invoked. Anything in the SKILL.md prose beyond §A+§B+registry is upstream-authored embellishment (per ADR-0139 §Provenance Correction) that Piece 1's rewrite — a fork-side divergence — should justify against this evidence base.

### MCP tool surface — 9 hive-mind tools (the API)

The full set of `mcp__ruflo__hive-mind_*` tools surfaced via deferred ToolSearch in the live MCP server. These are what an assistant invokes directly to drive a hive — preferred over `npx`/Bash for the same reason `swarm-advanced` uses `mcp__ruflo__swarm_init({...})` directly: lower latency, structured input/output, no shell escaping, no spawn cost.

| Tool | Purpose | Caller |
|---|---|---|
| `mcp__ruflo__hive-mind_init` | Establish substrate (queen, topology, consensus, persistence) | Queen (main thread) |
| `mcp__ruflo__hive-mind_spawn` | Register N worker slots in `state.json` | Queen |
| `mcp__ruflo__hive-mind_join` | Add an external agent to the hive's worker registry | Queen |
| `mcp__ruflo__hive-mind_leave` | Remove an agent from the worker registry | Queen |
| `mcp__ruflo__hive-mind_status` | Read substrate + worker state for observability | Queen, monitoring tools |
| `mcp__ruflo__hive-mind_consensus` | Submit a proposal and resolve voting per chosen algorithm | Queen |
| `mcp__ruflo__hive-mind_broadcast` | Send a message to all workers (caveat: only `hive-mind spawn` workers, not `Agent`-tool workers — see §3b in Piece 3) | Queen |
| `mcp__ruflo__hive-mind_memory` | Typed-bucket key/value collective memory (8 types per USERGUIDE §A) | Queen (DO NOT call from sub-agent — hangs per memory `reference-hive-runtime-crosstalk-pattern` iter1) |
| `mcp__ruflo__hive-mind_shutdown` | Graceful teardown; persists final state | Queen |

`hive-mind_metrics` is referenced in ADR-0139's registry `tools:` list but is not present in the live MCP tool surface — likely surfaced under a different name (`memory_stats`, `swarm_metrics`) or not yet wired. Treat the ADR-0139 registry list and this MCP-tool list as complementary; the live tool list is what the assistant actually has access to.

### Generic council-transcript shape

A working council transcript follows an 8-section format, in this order:

1. **Agenda** — N questions Q1..Qn with rule references.
2. **Per-Expert Positions** — one paragraph per named expert, citing the methodology they bring.
3. **Cross-Expert Discussion** — turns of the form `Expert-A → Expert-B (on Vk, topic): "<engagement with B's specific claim>"`. This is the dialectic.
4. **Vote Table** — per-Q tally `Pass | Fail | Abstain | Finding` (with `N-M-K` notation for split votes).
5. **Findings** — split into VIOLATIONS / WARNINGS / OBSERVATIONS, each with file/line refs and rule citations.
6. **Verdict** — overall accept/reject with required remediations.
7. **Expert Signatures** — N names with their assessed verdict.

The discussion turns at §3 are **mandatory and load-bearing** — they're where the rule actually moves. Without them you have a swarm dressed as a hive (per memory `feedback-hive-discussion-mechanics.md`). The vote at the end of a discussion turn is part of the dialog, not a separate ceremony.

## What the registry-canonical spec (ADR-0139) leaves on the table

ADR-0139 documented that the registry's `hive-mind` capability covers exactly:

> *"multiple agents reach agreement on a proposition using BFT/Raft/CRDT"*

This is the **consensus primitive**. It does **not** in itself produce dialectic council transcripts, named-expert positions, or Devil's-Advocate-with-withdrawal mechanics. Those are the **council pattern** layered on top using:

- `npx ruflo hive-mind init` (consensus primitive — from registry)
- `npx ruflo hive-mind spawn --claude` (queen-as-subprocess — from CLI)
- A protocol document (project-supplied, OR shipped generic template — see Piece 2)
- Claude Code's `Agent` tool inside the spawned-claude (workforce — from Claude Code, not from registry)

The capability area as upstream-defined provides the substrate; the council pattern emerges from composing the substrate with a protocol layer + Claude Code's Agent tool. **Three of these four exist; the protocol layer is the gap.**

## Decision — implementation outline

The fork should ship the following four implementation pieces. The first two are skill-side rewrites; the third is a CLI/runtime concern; the fourth is documentation hygiene. They are listed in dependency order — each builds on the prior.

### Piece 1: SKILL.md rewrite — pattern-based template modeled on `swarm-advanced`

The sibling skill `swarm-advanced` (973 lines, at `.claude/skills/swarm-advanced/SKILL.md` and three other paths) is the template to follow. It organises around **named patterns for distinct use-cases** rather than feature lists. Each pattern has the same internal shape: Purpose → Architecture → Workflow phases → CLI Fallback. That structure converts the skill from a brochure into a set of concrete recipes — exactly the shape the rewritten `hive-mind-advanced` should take.

#### Template skeleton (target: ~600-750 lines, similar size to `swarm-advanced`, replacing the current 713-line brochure)

```
---
name: hive-mind-advanced
description: Hive Mind orchestration patterns — council/dialectic, BFT consensus,
             implementation cohorts, multi-perspective review
version: 2.0.0
category: coordination
tags: [hive-mind, swarm, queen-worker, consensus, council, dialectic,
       byzantine, raft, gossip, crdt, multi-agent]
allowed-tools: Bash(npx *) Read Write Edit Grep Glob
               mcp__ruflo__hive-mind_init mcp__ruflo__hive-mind_spawn
               mcp__ruflo__hive-mind_status mcp__ruflo__hive-mind_consensus
               mcp__ruflo__hive-mind_broadcast mcp__ruflo__hive-mind_shutdown
               mcp__ruflo__hive-mind_memory mcp__ruflo__memory_store
               mcp__ruflo__memory_search Agent Task
---

# Hive Mind Advanced

Master Hive Mind orchestration patterns for queen-led multi-agent coordination
with consensus mechanisms and persistent memory. This skill covers four
concrete patterns; pick the one that matches your task.

## Quick Start

### Prerequisites
  // Ensure the ruflo MCP server is registered (one-time, in shell):
  //   claude mcp add ruflo -- npx -y @sparkleideas/cli@latest mcp start
  // From inside Claude Code, no npx is needed — call MCP tools directly.

### Basic Pattern (queen runs in this thread; mirrors swarm-advanced)
  // 1. Initialise hive substrate
  mcp__ruflo__hive-mind_init({
    topology: "hierarchical-mesh",
    consensus: "byzantine",
    maxAgents: 3,
    persist: true,
    memoryBackend: "hybrid"
  })

  // 2. Register N worker slots in state.json
  mcp__ruflo__hive-mind_spawn({ count: 3, role: "worker", prefix: "council" })

  // 3. Workforce — Claude Code Agent tool, parallel, ONE message
  Agent({ subagent_type: "researcher", run_in_background: true,
          prompt: <persona-1 worker contract> })
  Agent({ subagent_type: "researcher", run_in_background: true,
          prompt: <persona-2 worker contract> })
  Agent({ subagent_type: "researcher", run_in_background: true,
          prompt: <persona-3 worker contract> })

  // 4. After workers report — record consensus
  mcp__ruflo__hive-mind_consensus({ proposalId, votes })

  // 5. Persist verdict
  mcp__ruflo__hive-mind_memory({ action: "set", key: <session-id>,
                                  type: "consensus", value: <transcript> })

  // 6. Status / shutdown
  mcp__ruflo__hive-mind_status({})
  mcp__ruflo__hive-mind_shutdown({})

## Core Concepts

### Queen Types
  Strategic — research, planning, analysis. Long-horizon synthesis.
  Tactical  — implementation, execution. Short-horizon decomposition.
  Adaptive  — optimisation. Switches mode by complexity signal.

### Consensus Algorithms
  majority   — simple plurality (init+spawn)
  weighted   — queen vote ×3 (init+spawn)
  byzantine  — 2/3 supermajority (init+spawn) — DEFAULT
  raft       — leader-elected commit (init only)
  gossip     — eventually consistent (init only)
  crdt       — conflict-free merge (init only)
  quorum     — dynamic-quorum vote (init only)

### Worker Specialisations
  researcher / coder / analyst / tester / architect / reviewer / optimiser /
  documenter — auto-assigned by objective keyword. Persona may also be
  carried in the prompt body, with `subagent_type: researcher` shared by all.

### Cross-talk Transports (pick ONE per pattern)
  (a) one-shot independent  — workers don't see each other; queen composes
                              discussion from N verdicts in main thread.
                              CANONICAL — used by all 250+ HM working sessions.
  (b) file-based            — /tmp/<hive-id>/{pos,reaction}-*.md, sleep-60
                              barrier. FALLBACK validated 2026-05-04.
  (c) hive-mind memory      — `npx ruflo hive-mind memory -a set/get`.
      via Bash CLI            CANONICAL when hive substrate is initialised.
  (d) MCP from sub-agent    — DO NOT USE. `mcp__ruflo__hive-mind_memory`
                              hangs from sub-agent context (600s stall +
                              watchdog kill). Substrate-level fix pending.

### Execution Paths
  Path A — `--claude` from fresh terminal. TTY-inherit subprocess.
  Path B — `--claude --non-interactive` from inside existing claude session.
           Stream-JSON print mode.
  Path C — Inline queen. THIS Claude Code session is the queen; no subprocess.
           Use when Path A/B's permission inheritance gaps block your task.

## Calling Convention (read this first)

**Queen calls MCP tools directly.** This skill follows the same convention as `swarm-advanced`:

  mcp__ruflo__hive-mind_init({...})         ← preferred
  mcp__ruflo__hive-mind_spawn({...})        ← preferred
  mcp__ruflo__hive-mind_consensus({...})    ← preferred

NOT via Bash:

  Bash("npx ruflo hive-mind init ...")      ← only for fallback or
                                              user-facing example output

NOT via the npx CLI subprocess unless you specifically need `--claude`
subprocess-as-queen behaviour (see Path A below).

The 9-tool MCP surface (`hive-mind_init/spawn/join/leave/status/consensus/
broadcast/memory/shutdown`) is the canonical interface. `npx` examples in
USERGUIDE §A/§B are user-facing scripts, not the assistant's invocation
path.

**Sub-agents call MCP tools NEVER.** Per memory `reference-hive-runtime-
crosstalk-pattern` iter1, `mcp__ruflo__*` from sub-agent context hangs
600s and gets watchdog-killed. Sub-agents must use Bash CLI
(`npx ruflo hive-mind memory -a set/get`) or file-based I/O instead.

This is the asymmetry: queen runs in main thread (MCP works), workers
run in sub-agent context (MCP hangs).

## Pattern 1: Council Hive (Dialectic)

### Purpose
Convene N named experts for dialectic review of a proposition. Each expert
takes a clear stance citing their published methodology; one is the
Devil's Advocate. Workers cross-engage by name with specific claims.
Queen composes an 8-section transcript.

### Architecture
  - Substrate:           hive-mind init (Byzantine 2/3)
  - Protocol layer:      project-supplied methodology file OR
                         shipped templates/generic-council-protocol.md
  - Workforce:           N parallel `Agent` spawns, ALL `subagent_type: researcher`,
                         persona in prompt body, `run_in_background: true`.
                         ONE round of spawns.
  - Cross-talk:          (a) for queen-composed dialog — most validated; or
                         (b)/(c) for runtime cross-talk — if you need workers
                         to genuinely cross-reference each other.
  - Vote:                Per-expert stance read from worker return values;
                         queen tallies (Path C) or `hive_mind_consensus`
                         (Path A/B).
  - Transcript:          8 sections (agenda → positions → cross-expert
                         discussion → vote → findings → verdict → signatures).
                         EVERY expert quotation traces to an actual worker
                         output. No fabrication.

### Workflow
  // Phase 1: Substrate (queen → MCP)
  mcp__ruflo__hive-mind_init({
    topology: "hierarchical-mesh",
    consensus: "byzantine",
    maxAgents: 3
  })

  // Phase 2: Protocol selection (queen → Read tool)
  // Read <project>/CLAUDE.md for anchoring rule.
  // Read <project>/<methodology>.md if the project ships one, else
  // Read this skill's templates/generic-council-protocol.md.

  // Phase 3: Register substrate slots (optional — for visibility in status)
  mcp__ruflo__hive-mind_spawn({
    count: 3, role: "worker", prefix: "council"
  })

  // Phase 4: Panellist spawn (ONE message, parallel — Agent tool)
  Agent({ subagent_type: "researcher", run_in_background: true,
          prompt: <persona-1 contract — see templates/worker-contract.md> })
  Agent({ subagent_type: "researcher", run_in_background: true,
          prompt: <persona-2 contract> })
  Agent({ subagent_type: "researcher", run_in_background: true,
          prompt: <persona-3 contract — DA flag set> })

  // Phase 5: Cross-talk (sub-agents — pick ONE transport)
  //   Inside each sub-agent's worker contract, use:
  //     (a) one-shot — workers don't see each other; queen composes
  //                    discussion in main thread from N return values.
  //     (b) file-based — Write/Read /tmp/<hive-id>/{pos,reaction}-*.md
  //                      with sleep-60 barrier.
  //     (c) Bash CLI — `npx ruflo hive-mind memory -a set/get` from sub-agent
  //                    (the CLI bridges to substrate without the MCP hang).
  //   DO NOT use mcp__ruflo__hive-mind_memory from inside the Agent prompt.

  // Phase 6: Vote (queen → MCP)
  mcp__ruflo__hive-mind_consensus({
    proposalId: <id>,
    votes: <stances-extracted-from-worker-returns-or-files>,
    algorithm: "byzantine"
  })

  // Phase 7: Transcript composition (queen → Write tool)
  // Compose 8 sections using ONLY actual worker content
  // (composition is legitimate when every quotation traces to actual worker
  // output; fabrication is illegitimate). Write to <output>/<topic>.md.

  // Phase 8: Persist verdict (queen → MCP)
  mcp__ruflo__hive-mind_memory({
    action: "set",
    type: "consensus",
    key: <session-id>,
    value: <transcript-or-summary>
  })

### CLI Fallback (only when --claude subprocess queen is needed)
  Bash("npx ruflo hive-mind spawn -n 3 '<question>' \
        --queen-type strategic --consensus byzantine \
        --claude --non-interactive")
  // Use this only when running this skill from inside an existing claude
  // session AND you specifically want the spawned-claude-as-queen flow
  // rather than inline-queen. Default is inline-queen via MCP above.

## Pattern 2: Consensus Decision Hive (BFT proposal)

### Purpose
Reach agreement on a discrete decision (architecture pattern, technology
choice, release readiness) using formal Byzantine/Raft/CRDT consensus.
No dialectic; just propose → vote → resolve.

### Architecture
  - Substrate, workforce, vote primitives. No transcript. No protocol layer.
    The decision is the artefact.

### Workflow
  // Phase 1: Substrate
  mcp__ruflo__hive-mind_init({ consensus: "byzantine", maxAgents: 5 })

  // Phase 2: Workforce
  mcp__ruflo__hive-mind_spawn({ count: 5, role: "worker" })

  // Phase 3: Propose + collect votes (per worker)
  Agent({ subagent_type: "researcher", run_in_background: true,
          prompt: "Vote on <topic>: <options>. Return your choice + rationale." })
  // ... × N

  // Phase 4: Resolve consensus
  mcp__ruflo__hive-mind_consensus({
    proposalId, votes, algorithm: "byzantine"
  })

  // Phase 5: Persist
  mcp__ruflo__hive-mind_memory({
    action: "set", type: "consensus", key: <id>, value: <verdict>
  })

### CLI Fallback (subprocess-as-queen)
  Bash("npx ruflo hive-mind spawn -n 5 '<decision question>' \
        --queen-type tactical --consensus byzantine")

## Pattern 3: Implementation Hive (Coordinated Development)

### Purpose
Coordinated development of a feature across N specialists, with consensus
checkpoints on architectural decisions during execution.

### Architecture
  Mirror swarm-advanced Pattern 2 (Development Swarm) but add periodic
  hive_mind_consensus calls for arch decisions, not just task delegation.

### Workflow
  // Phase 1: Substrate
  mcp__ruflo__hive-mind_init({ consensus: "weighted", maxAgents: 6 })

  // Phase 2: Architect — outlines design
  Agent({ subagent_type: "researcher", run_in_background: true,
          prompt: "<architect persona — produce design doc>" })

  // Phase 3: Consensus on architecture
  mcp__ruflo__hive-mind_consensus({
    proposalId: <arch-id>, votes, algorithm: "weighted"
  })

  // Phase 4: Parallel implementation (specialist Agents)
  Agent({ subagent_type: "coder", run_in_background: true, prompt: "<backend>" })
  Agent({ subagent_type: "coder", run_in_background: true, prompt: "<frontend>" })
  Agent({ subagent_type: "tester", run_in_background: true, prompt: "<tests>" })
  // ... per-pattern specialisation

  // Phase 5: Consensus on review (approve / changes)
  mcp__ruflo__hive-mind_consensus({ proposalId: <review-id>, votes })

  // Phase 6: Persist + status
  mcp__ruflo__hive-mind_memory({ action: "set", type: "result", key, value })
  mcp__ruflo__hive-mind_status({})

### CLI Fallback
  Bash("npx ruflo hive-mind spawn -n 6 '<feature>' --queen-type tactical --claude")

## Pattern 4: Review Hive (Multi-perspective)

### Purpose
Review existing code, design, or decision from N independent perspectives
(security / performance / accessibility / etc.), with consensus on severity
and required actions.

### Architecture
  Like Pattern 1 but reviewers cite their own checklists rather than
  published methodologies. Findings categorised
  VIOLATION / WARNING / OBSERVATION.

### Workflow
  // Phase 1: Substrate
  mcp__ruflo__hive-mind_init({ consensus: "majority", maxAgents: <N> })

  // Phase 2: Reviewer spawn (one Agent per perspective)
  Agent({ subagent_type: "reviewer", run_in_background: true,
          prompt: "<security perspective brief + worker contract>" })
  Agent({ subagent_type: "reviewer", run_in_background: true,
          prompt: "<performance perspective brief + worker contract>" })
  Agent({ subagent_type: "reviewer", run_in_background: true,
          prompt: "<accessibility perspective brief + worker contract>" })

  // Phase 3: Per-finding cross-engagement (transport b or c)
  // Workers cross-reference each other's findings via file-based or
  // Bash-CLI hive_memory transport.

  // Phase 4: Severity vote per finding
  mcp__ruflo__hive-mind_consensus({
    proposalId: <finding-id>, votes, algorithm: "majority"
  })

  // Phase 5: Findings table + Verdict
  mcp__ruflo__hive-mind_memory({
    action: "set", type: "result", key: <review-id>, value: <V/W/O-table>
  })

## Advanced Techniques

### Worker Contract Template
  See templates/worker-contract.md (Piece 2 of ADR-0140).
  7-step recipe: position → write → barrier → read peers → reaction →
  write reaction → return.

### Generic Council Protocol
  See templates/generic-council-protocol.md (Piece 2 of ADR-0140).
  8-section structure, persona-agnostic. Use when project has no methodology
  document of its own (avoids ADR-0114 §Done U5 gap).

### Session Resume
  npx ruflo hive-mind sessions       # list checkpoints
  npx ruflo hive-mind resume <id>

### Memory Persistence
  Queen stores verdict at end of each pattern:
    memory_store({ type: "consensus", key: <session-id>, value: <output> })

## Best Practices

  1. Queen calls MCP tools DIRECTLY (mcp__ruflo__hive-mind_*({...})), not
     via Bash/npx. Same convention as swarm-advanced. Reserve `npx` for
     subprocess-as-queen (--claude) and for sub-agent worker contracts.
  2. Pick the right pattern. Don't shoehorn a Council Hive into a BFT
     decision question (Pattern 2 fits) and don't run Pattern 2 when you
     need dialectic (Pattern 1 fits).
  3. Always spawn workers in ONE message. Parallel spawn = sync barrier.
  4. Workers must NEVER load `mcp__ruflo__*` tools — they hang in
     sub-agent context. Use Bash CLI or file-based transport from inside
     worker prompts.
  5. The queen composes; the queen does not fabricate. Every expert
     quotation traces to actual worker output.
  6. Devil's Advocate must explicitly withdraw or hold. No vague
     "all agreed" closes.
  7. Persist consensus verdicts via mcp__ruflo__hive-mind_memory with
     type:'consensus' (or type:'result' for non-vote outputs).

## Real-World Examples

  - Pre-regression source — `~/source/workingCouncil/ruflo/v3/@claude-flow/cli/src/commands/hive-mind.ts`
  - File-based crosstalk validation 2026-05-04 — memory `reference-hive-runtime-crosstalk-pattern.md`

## Troubleshooting

### `--claude` doesn't work from inside an existing claude session
  Add `--non-interactive` (Path B). Stream-JSON output instead of TTY.
  Note: permission inheritance is imperfect; some MCP tools may hit
  prompt-grant flow that can't complete in non-interactive mode.

### `mcp__ruflo__hive-mind_memory` hangs from sub-agent
  Known issue (likely ADR-0133 RVF concurrent-write). Use
  `npx ruflo hive-mind memory -a set/get` from Bash instead. Or use
  file-based transport for dev/test.

### CLI flags accepted but not persisted
  CLI/MCP schema mismatch — `hierarchical-mesh`, `consensus`,
  `memoryBackend` accepted at boundary but not all written to state.json.
  Inspect `.claude-flow/hive-mind/state.json` after init to verify.

### No consensus reached (Byzantine deadlock)
  Drop to weighted (queen ×3) or majority. Or restructure question to be
  binary rather than n-ary.

## Related Skills
  - swarm-advanced       — multi-agent coordination without consensus
  - claude-flow-swarm    — swarm CLI-first patterns
  - reasoningbank-agentdb — adaptive learning from hive outcomes

## References
  - ADR-0139 — canonical spec from upstream guidance registry
  - ADR-0140 — this skill's implementation outline
  - ADR-0114 §Done U5 — council protocol delivery gap (closed by Piece 2)
  - Memory `reference-hive-runtime-crosstalk-pattern` — in-repo file-based fallback
  - Memory `feedback-hive-discussion-mechanics` — 5-point dialectic criteria
```

#### Why this template structure (not a flat numbered procedure)

The earlier draft of Piece 1 was a single numbered procedure (~120-180 lines). After examining `swarm-advanced` (the working sibling skill), the pattern-per-use-case structure is strictly better:

| Concern | Flat procedure | Pattern-based template |
|---|---|---|
| Discoverability | One workflow; user maps task to it | Four named patterns; user picks the one that fits |
| Use-case coverage | Optimised for council-style; bare BFT decision feels wrong | Council, BFT, implementation, review — each has a fitted recipe |
| Internal consistency with sibling skills | Diverges from `swarm-advanced` | Mirrors `swarm-advanced` pattern-by-pattern |
| Length | ~150 lines (compressed brochure) | ~600-750 lines (same as `swarm-advanced`) |
| Maintenance | Single workflow drifts as use cases evolve | Add or revise individual patterns without touching the rest |

The template above is sized to match `swarm-advanced` (973 lines including all examples). Final word count for the actual SKILL.md will likely land at 600-800 lines after concrete examples are filled in. Still ~10-25% smaller than the current 713-line brochure but **far** more useful per line because every line is procedural.

#### Template-to-implementation mapping

When the actual SKILL.md is authored (not in this ADR — see §Open follow-ups item 1), the template above maps to source files as:

| Section | Source file |
|---|---|
| Frontmatter | `forks/ruflo/plugins/ruflo-hive-mind/skills/hive-mind-advanced/SKILL.md` (top) |
| Quick Start, Core Concepts, Patterns 1-4, Advanced Techniques, Best Practices, Real-World Examples, Troubleshooting | Same SKILL.md, body |
| Worker Contract template | `forks/ruflo/plugins/ruflo-hive-mind/skills/hive-mind-advanced/templates/worker-contract.md` (Piece 2) |
| Generic Council Protocol | `forks/ruflo/plugins/ruflo-hive-mind/skills/hive-mind-advanced/templates/generic-council-protocol.md` (Piece 2) |

### Piece 2: Generic protocol template, shipped with the skill

To unblock projects that don't have a methodology document of their own, the skill should ship a **generic council protocol template** as a sibling file:

```
forks/ruflo/plugins/ruflo-hive-mind/skills/hive-mind-advanced/
  SKILL.md                           ← Piece 1
  templates/
    generic-council-protocol.md      ← NEW: 8-section template, persona-agnostic
    worker-contract.md               ← NEW: position+barrier+reaction recipe
```

The generic protocol template should cover:

- Section shape (questions → positions → discussion → vote → findings → verdict)
- Persona slots (3 by default, scalable to 9, all `researcher` subagent type)
- DA mandate (one persona must take adversarial role; explicit withdraw-or-hold)
- Vote format (`N-M-K` notation; per-question tallies)
- Citation rule ("every quote traces to actual worker output")
- DOES NOT prescribe specific named experts — that's project-specific.

This is the missing protocol layer. Today, projects without a methodology document get nothing useful out of the hive (per ADR-0114 Lens 10). With this template, fresh projects can produce council-shape output immediately.

### Piece 3: Runtime gap fixes — outcome (updated 2026-05-05)

Three substrate-level issues were identified at draft time, scoped narrowly to the broadcast/sub-agent/state-persistence boundary. After a four-agent investigation, the original gap-3a hypothesis was refuted. The broader hive-mind runtime gap (V3 Queen "Missing — Needs implementation" per `HIVE-MIND-MIGRATION.md:59-67`, plus the six README claims in ADR-0103) was closed in parallel via the **ADR-0103 → ADR-0118 program (T1-T14, all complete)** — see §"T1-T14 coverage in Piece 1" below for the per-task feature inventory and ADR-0139 §"Upstream runtime gap and fork closure" for the source ADR table. So Piece 3 here addresses the narrow boundary issues; the broader closure happened elsewhere.

Final disposition for the three Piece 3 substrate items:

| # | Gap | Status | Reference |
|---|---|---|---|
| 3a | `mcp__ruflo__hive-mind_memory` hangs from sub-agent context | **SUPERSEDED — see ADR-0144.** Original hypothesis (RVF concurrent-write deadlock per ADR-0133) was empirically refuted: handler has 5000ms `withHiveStoreLock` timeout that throws loudly, so a real lock deadlock would surface with a thrown timeout, not 600s silent stall. Real diagnosis (per ADR-0144): tool-name mismatch (`mcp__ruflo__*` not registered; `.mcp.json` registers under `claude-flow`, so canonical name is `mcp__claude-flow__hive-mind_memory`) compounded by deferred-tool inheritance gap across the Agent-tool sub-agent boundary. **Fix is documentation, not fork code:** sub-agents call MCP via Bash CLI (`npx @sparkleideas/cli@latest hive-mind memory ...`) per ADR-0144's transport-class rule. Zero fork code change. | ADR-0144 §"Decision" |
| 3b | `hive_mind_broadcast` does not wake `Agent`-spawned workers — registries don't bridge | **DOCUMENTED (shipped).** Per the cheaper-document choice: README + JSDoc comment on the broadcast handler explain that broadcast reaches `hive-mind spawn` workers only, and that single-round Agent spawns + queen-composition is the canonical pattern. | `forks/ruflo` sparkling/main commit `b9421bad0` (`docs(hive-mind): document broadcast vs Agent-tool worker registries (ADR-0140 3b)`) |
| 3c | CLI/MCP schema mismatch — `topology`/`consensus`/`memoryBackend` accepted at the boundary but not persisted to `state.json` | **FIXED + SHIPPED.** MCP `hive-mind_init` handler now persists `state.config = {topology, consensus, maxAgents, persist, memoryBackend}` and the `inputSchema.enum` widened to include `hierarchical-mesh` + `adaptive`. Verification confirmed: `npx @sparkleideas/cli@3.5.58-patch.351 hive-mind init -t hierarchical-mesh -c byzantine -m 3 --memory-backend hybrid` produces the expected 4-field `.config` object in `state.json`. | `forks/ruflo` sparkling/main commit `b7181aa89`; published as `@sparkleideas/cli@3.5.58-patch.351` 2026-05-04 |

**Adjacent substrate hardening (out of ADR-0140's original scope, surfaced by the investigation):**

- **Rust `WriterLock` bounded-wait flock acquisition.** During the deletion of duplicate test coverage in ruflo-patch, an in-process self-deadlock was discovered: macOS `flock(2)` is per-OFD, so multiple `RvfBackend` constructions in the same process (bypassing the `storage-factory` `backendCache`) each acquire their own FD on the lock file, and the second `flock(LOCK_EX)` blocks indefinitely. The native rvf-runtime now uses `flock(LOCK_EX|LOCK_NB)` in a poll loop bounded by `RVF_LOCK_ACQUIRE_TIMEOUT_MS` (default 30s) — fail-loud on miss, cross-process FIFO semantics preserved. `forks/ruvector` sparkling/main commit `38191e27e` (`crates/rvf/rvf-runtime/src/locking.rs`). Independent of ADR-0140 but cross-listed because the test that exposed the deadlock was ostensibly part of this Piece's coverage.
- **`scripts/test-runner.mjs` per-test timeout.** `--test-timeout=120000` added so any future hanging test fails loud at 2 min instead of consuming the 30-min pipeline budget. Was the proximate enabler of the silent 30-min release abort that surfaced the rvf-runtime issue above.

**Net effect:** Piece 3 is closed. 3b documented, 3c shipped end-to-end, 3a re-classified as a documentation contract per the Amendment below (zero fork code change required for the originally stated symptom).

## Amendment 2026-05-04 — row 3a closure

### Timeline

1. **Original draft (ADR-0144 Proposed):** Diagnosed the iter1 600s stall as compounding causes 1+2; proposed a transport-class rule (Bash CLI from sub-agents).
2. **5-persona dialectic council (5-0 refactor):** Demoted diagnosis, applied Persona A's mechanical correction (stall is in-harness pre-dispatch, not at JSON-RPC reply layer), brought rule into this Amendment, moved investigation to `docs/plans/postmortem-3a-mcp-from-sub-agent.md`, marked ADR-0144 Superseded. Transcript: `docs/council/2026-05-04-adr-0144-dialectic-review.md`.
3. **Live reproduction (Persona C's matrix, executed 2026-05-04):** Three sub-agents ran one MCP call each. **Result: arm B succeeded.** A sub-agent invoked `mcp__claude-flow__memory_store` directly with **no `ToolSearch` preamble**, and the call returned a real success payload in 30ms. **This refutes Cause 2** (deferred-tool inheritance gap). The transport-class rule's load-bearing premise is gone.
4. **This update:** Rule revised to match the data.

### Diagnosis (post-experiment, final)

- **Cause 1** (tool-name mismatch): **VERIFIED.** `.mcp.json` key is `claude-flow`. iter1 prompts used `mcp__ruflo__*` — that name was never registered. Wrong-name calls dispatch to nothing in the harness layer; per JSON-RPC 2.0 §5.1 + `mcp-server.ts:497-502`, a frame reaching the server returns `-32601` sub-millisecond — so the 600s wait means the bytes never reached the server. Stall is in-harness, pre-dispatch.
- **Cause 2** (deferred-tool inheritance gap): **REFUTED 2026-05-04** by arm B of the live reproduction. Sub-agent invoked `mcp__claude-flow__memory_store` with no `ToolSearch` preamble; harness dispatched cleanly; server replied in 30ms. No schema-injection problem, no inheritance gap. Cause 2 was an artefact of code-reading inference without reproduction.

**Cause 1 alone is sufficient.** The iter1 symptom collapses to "use the correct tool name."

### Operational rule (post-experiment, simplified)

Sub-agents spawned via Claude Code's `Agent` tool **CAN call `mcp__claude-flow__*` tools directly** (verified empirically 2026-05-04 — arm B). The original ADR-0144 prohibition is rescinded.

Workers still need the **correct registered tool name**:

- The MCP server is registered in `.mcp.json` under the key `claude-flow`. Tool names are `mcp__claude-flow__<tool>`.
- `mcp__ruflo__*` is **not** registered in the current configuration. Calls to that name dispatch to nothing and trigger the per-Agent watchdog at 600s. **Do not use this name in worker prompts** until ADR-0117 (dual-namespace registration) lands.
- The `ToolSearch` preamble is **optional, not required**. Arm C verified it works; arm B verified direct invocation works without it. Use ToolSearch when you want the schema printed in the sub-agent's transcript for debuggability.

The Bash CLI path (`$(_cli_cmd)` / `npx @sparkleideas/cli`) remains a **fallback** for cases where a fresh subprocess is desirable (own RVF lock lifecycle, isolation from the in-process MCP server, validated iter4) — but it is **no longer the default**. Per memory `reference-cli-cmd-helper.md`, if you do use the CLI path, prefer `$(_cli_cmd)` over bare `npx @latest` (36× slower under cache contention).

### The actual remediation: implement ADR-0117

The iter1 prompt's broken call (`mcp__ruflo__hive-mind_memory`) becomes valid the moment ADR-0117 lands — that ADR registers the marketplace MCP server under the `ruflo` key alongside `claude-flow` (dual namespace). After ADR-0117:

- `mcp__claude-flow__<tool>` continues to work (current behaviour).
- `mcp__ruflo__<tool>` also resolves — same handler, second alias.
- iter1-style worker prompts work without modification.
- Worker-contract templates can document either namespace.

**Recommended next step:** implement ADR-0117 rather than continuing to police tool-name usage in worker prompts. The "use correct name" rule is a workaround for an unimplemented decision.

### Experimental data (2026-05-04)

| Arm | Setup | Result | Time | Implication |
|---|---|---|---|---|
| A (skipped) | Wrong name, no preamble | Not run as sub-agent — covered by iter1 evidence | n/a | Wrong name → 600s watchdog (known) |
| **B (discriminator)** | Correct name, **no preamble** | **✅ Success (30ms server-side)** | <1s wall-clock | **Refutes Cause 2.** Direct MCP works from sub-agent. |
| C (escape hatch) | `ToolSearch` then correct name | ✅ Success (30ms server-side) | ~1-2s wall-clock | ToolSearch preamble works; not required given B. |
| D first attempt | `npx @sparkleideas/cli@latest memory store ...` | Drift — 13 tool calls, no clean result, agent self-terminated mid-thought | ~110s | Methodology failure (see "Prompt-discipline incident" below). Re-run with stricter prompt. |
| D rerun | Same command, disciplined prompt | Hung at "Storing in experiment/..." — no EXIT line, file written 224 bytes and stopped | ~130s budget | **Reveals a different bug** (see "Bash CLI fallback is broken" below). Not a sub-agent problem. |
| D direct (main thread) | Same command, no sub-agent | **Same hang at exact same point.** PID held FD 13u on `memory.rvf.lock` indefinitely. | n/a (timeout 90s wrapper) | Confirms hang is reproducible without sub-agents. |

### Bash CLI fallback is broken (arm D direct, 2026-05-04)

`lsof memory.rvf.lock` during arm D's hang showed:

```
node 23302  FD 12u  /Users/henrik/source/ruflo-patch/.swarm/memory.rvf.lock   ← MCP server (1h39m elapsed)
node 12574  FD 13u  /Users/henrik/source/ruflo-patch/.swarm/memory.rvf.lock   ← cold-spawn CLI test (2m59s, hung)
```

PID 23302 is **this session's running `cli mcp start`** — registered via `.mcp.json`, holds `flock(LOCK_EX)` on `memory.rvf.lock` for the lifetime of the Claude Code session. PID 12574 (cold-spawned `npx ... memory store`) opened the same lock file but cannot acquire the exclusive flock — it waits indefinitely. macOS `flock(2)` is per-OFD so the two opens are separate lock-queue entries, and the published `@sparkleideas/cli` has no acquisition timeout.

**Implications:**
1. The Bash CLI workaround originally prescribed by ADR-0144 (`npx @sparkleideas/cli memory store ...` from a sub-agent) **does not actually work** in any project where the MCP server is running concurrently. The subprocess hangs on flock contention against the long-running server.
2. This is **not** a sub-agent issue — main-thread cold-spawn hangs identically.
3. The bounded-wait flock fix in ruvector commit `38191e27e` (sparkling/main, not yet built/published) addresses this: `flock(LOCK_EX|LOCK_NB)` poll loop with 30s default timeout. Once published, the subprocess fails loud at 30s instead of hanging — but that's a fail-loud safety net, not a fix to the underlying contention.
4. The "real" answer remains direct MCP from sub-agents (arm B succeeded) plus ADR-0117 implementation (makes `mcp__ruflo__*` resolve, eliminating the iter1 symptom). The Bash CLI fallback is **structurally unsuitable** when an MCP server is running in the same project.

### Updated rule (revised again, 2026-05-04 post-arm-D)

- **Sub-agents call `mcp__claude-flow__*` (and `mcp__ruflo__*` once ADR-0117 lands) directly.** Verified by arm B.
- **The Bash CLI path is NOT a recommended fallback** in projects with a running MCP server. It hangs on flock contention. Reserve it for environments where the MCP server is not running (e.g., CI scripts, cron jobs, daemon-less smoke tests).
- The escape hatch (`ToolSearch` preamble + direct MCP, arm C) works but is unnecessary given arm B.

### Prompt-discipline incident (arm D first attempt)

Arm D's first sub-agent run drifted into a retry loop and never produced a clean result. Diagnosis: the agent's first Bash returned partial-looking output, which triggered a "fix-it" reflex instead of a "report-it" outcome. 13 tool calls, ~110s, status reported as `completed` because the harness treated the model's final reasoning text ("Let me re-run it cleanly into a file directly") as the answer.

**This was not a load-bearing data point** — arm B is the discriminator and arm B succeeded — but it surfaced a real methodology issue: open-ended single-arm experiment prompts under-constrain the sub-agent and trigger drift, especially when commands have variable cold-start latency (`npx --yes` first invocations can take 30-60s, which reads as "stuck" to a sub-agent without explicit slowness-is-OK guidance).

**Mitigation**: see memory `feedback-single-arm-experiment-prompt-discipline.md`. Future single-arm experiments use a strict template:

1. Single Bash call with output redirected to a named file (no streaming, no `tail -f`, no `Monitor`).
2. Hard `timeout` baked into the command so the agent can't sit waiting.
3. Forbid Monitor + ToolSearch + retries explicitly in the prompt.
4. Pre-define the result shape (4-line format) so the agent can't decide "this needs more investigation."
5. Acknowledge cold-start latency in the prompt body so slowness ≠ failure.

The disciplined rerun (arm D rerun) followed the template successfully — agent did NOT drift, ran one Bash + one Read, reported what it saw. The hang it surfaced (above) is a substrate bug, not a methodology bug. Methodology rule documented for any future ADR validation work.

### Prompt-discipline incident (arm D first attempt)

Arm D's first sub-agent run drifted into a retry loop and never produced a clean result. Diagnosis: the agent's first Bash returned partial-looking output (wrapper-zsh exit timing race with the in-flight `npx --yes` cold-install), which triggered a "fix-it" reflex instead of a "report-it" outcome. 13 tool calls, ~110s, status reported as `completed` because the harness treated the model's final reasoning text ("Let me re-run it cleanly into a file directly") as the answer.

**This was not a load-bearing data point** — arm B is the discriminator and arm B succeeded — but it surfaced a real methodology issue: open-ended single-arm experiment prompts under-constrain the sub-agent and trigger drift, especially when commands have variable cold-start latency (`npx --yes` first invocations can take 30-60s, which reads as "stuck" to a sub-agent without explicit slowness-is-OK guidance).

**Mitigation**: see memory `feedback-single-arm-experiment-prompt-discipline.md`. Future single-arm experiments use a strict template:

1. Single Bash call with output redirected to a named file (no streaming, no `tail -f`, no `Monitor`).
2. Hard `timeout` baked into the command so the agent can't sit waiting.
3. Forbid Monitor + ToolSearch + retries explicitly in the prompt.
4. Pre-define the result shape (4-line format) so the agent can't decide "this needs more investigation."
5. Acknowledge cold-start latency in the prompt body so slowness ≠ failure.

Arm D's rerun uses this template. Methodology rule documented for any future ADR validation work.

### Where this lands in shipped artefacts (revised)

| Surface | Change |
|---|---|
| `forks/ruflo/plugins/ruflo-hive-mind/skills/hive-mind-advanced/SKILL.md` (when rewritten per Piece 1) | Document that sub-agents call MCP directly; cite arm B. Cross-reference ADR-0117 for the dual namespace; until then, use `mcp__claude-flow__*`. |
| `forks/ruflo/plugins/ruflo-hive-mind/skills/hive-mind-advanced/templates/worker-contract.md` (when authored per Piece 2) | Default to direct MCP invocation. Bash CLI path is documented as a fallback for fresh-subprocess semantics. |
| ruflo-patch memory entries currently citing `mcp__ruflo__hive-mind_memory` | Update to `mcp__claude-flow__hive-mind_memory` until ADR-0117 lands. Specifically `reference-hive-runtime-crosstalk-pattern.md:96,166,216`. |
| `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts` | **No code change.** Handler is correct. |
| **ADR-0117** | **Recommend implementation** as the actual remediation. Closes this row's symptom at the source (tool-name registration) rather than via worker-prompt discipline. |

### Adjacent items spun out (separate tickets)

- **`mcp-server.ts:408-413` parse-error swallow** — server logs JSON-RPC parse failures to stderr only, does NOT send the spec-required `-32700 Parse error` reply. Real (small) defect, unrelated to row 3a. Track separately.
- **Memory drift cleanup** — sweep `mcp__ruflo__hive-mind_memory` → `mcp__claude-flow__hive-mind_memory` references across `~/.claude/projects/.../memory/`. Documentation hygiene. Becomes a no-op once ADR-0117 lands.

### ADR-0144 disposition

Filed as **Superseded** by this Amendment. File retained for audit trail. The §Decision (transport-class rule) was rescinded after the live reproduction; the §Diagnosis was demoted to "Cause 1 only, mechanical correction applied."

### Final operational rule (post-council 2026-05-05) — supersedes both prior rule blocks

The §"Operational rule (post-experiment, simplified)" block at L692 and the §"Updated rule (revised again, 2026-05-04 post-arm-D)" block at L740 contradict on the surface (one says Bash CLI is a fallback; the other says it isn't). Both are retained for audit trail but **superseded** by the following canonical rule, consolidated after Pre-mortem Strategist surfaced the readability defect in the 2026-05-05 council review:

| Caller context | MCP server status | Recommended transport |
|---|---|---|
| Main thread / Queen | running | Direct `mcp__claude-flow__*` MCP call |
| Agent-tool sub-agent | running | Direct `mcp__claude-flow__*` MCP call (no `ToolSearch` preamble — verified arm B 2026-05-04) |
| Agent-tool sub-agent | running | `ToolSearch("select:mcp__claude-flow__<name>")` then call — optional debuggability path; not required |
| Any | running | **Bash CLI (`$(_cli_cmd)` / `npx @sparkleideas/cli`) is NOT recommended** — flock contention on `memory.rvf.lock` against the running server hangs indefinitely (arm D direct, 2026-05-04). |
| Any | NOT running (CI / cron / daemon-less smoke) | Bash CLI is fine — no contention possible |
| Any | any | `mcp__ruflo__*` tool name does NOT resolve until ADR-0117 (dual namespace registration) lands. Use `mcp__claude-flow__*` until then. |

This consolidates: arm A (skipped, wrong-name); arm B (correct-name, no-preamble — works); arm C (correct-name + preamble — works); arm D (Bash CLI — hangs against running server). One canonical answer per context.

### Piece 4: README + ADR-0114 §Done U5 update

- `forks/ruflo/plugins/ruflo-hive-mind/README.md` — ensure it points at the rewritten SKILL.md and explicitly says "the protocol layer comes from project files OR the shipped generic template, not from ruflo's queen prompt." This codifies the substrate-vs-protocol separation that has been implicit since 2026-03-11.
- ADR-0114 §Done U5 closure — once Pieces 1+2 land, the council-protocol delivery gap is closed for fresh projects. Mark ADR-0114 §Done U5 as remediated, citing this ADR.

### Piece 6: Substrate-dictated team binding (Agent Teams integration) — added 2026-05-05

**Status: Proposed (2026-05-05). Not yet implemented.** Implementation is the next step after Piece 1 (SKILL.md rewrite, done 2026-05-05) and Piece 2 (templates, shipped 2026-05-29 — see [[ADR-0270]]).

#### Background

Per the 2026-05-05 council review and the user's follow-up question on Agent Teams: the rewritten SKILL.md Patterns 1-4 spawn workers via Claude's `Agent`/`Task` tool but do NOT pass `team_name` (except in transport (b)). Workers therefore don't join a Claude Code team, and none of the 15 behaviors gated on `oq()` (i.e. `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`) are active for hive workers — no `teammate_mailbox` system-reminder injection, no `team_context` injection, no `@<name>` resolution, no `TaskUpdate` auto-claim, no `task_assignment` mailbox messages, etc.

The gap is that hive substrate (slot registry, consensus, memory) and Agent Teams (mailbox, system-reminder injection, task auto-claim) are two coordination surfaces split by accident-of-implementation, not by design.

Three options were analysed:

- **(A) SKILL.md prose only.** Add `TeamCreate` and `team_name` to Pattern phase blocks; queen reads procedure from prompt-injected SKILL.md and executes. Cheapest. No fork code change. Trust model: queen-prompt-follows-procedure.
- **(B) Queen prompt template instruction.** Add a paragraph at `commands/hive-mind.ts:475+` instructing the queen to invoke `TeamCreate({team_name: hiveId})` after init and use `team_name: hiveId` for all worker spawns. Same prompt-enforced policy as A but consolidated to one prompt template. Trust model: queen-prompt-template-correctness.
- **(C) Substrate-dictated contract.** Substrate handlers (`hive-mind_init`, `hive-mind_spawn`) emit a structured contract that the queen executes deterministically. The substrate is the source of truth for team binding. Trust model: code-enforced.

#### Decision

Adopt **(C), in its achievable form** (substrate dictates the contract; queen executes it). Pure C ("MCP server invokes `TeamCreate` directly") is mechanically impossible because `TeamCreate` is a Claude Code main-thread builtin, not server-invokable from the MCP process. Achievable C: the substrate emits a structured `requiredSetup` array in `hive-mind_init`'s response and a `spawnTemplate` in `hive-mind_spawn`'s response; the queen-prompt template instructs the queen to read these and execute deterministically.

#### Contract (extended response shapes)

`hive-mind_init` response:

```json
{
  "success": true,
  "hiveId": "hive-...",
  "config": {...},
  "requiredSetup": [
    {
      "tool": "TeamCreate",
      "args": { "team_name": "<hiveId>", "description": "Hive workforce for <objective>" }
    }
  ]
}
```

`hive-mind_spawn` response:

```json
{
  "success": true,
  "spawned": 5,
  "workers": [...],
  "spawnTemplate": {
    "tool": "Task",
    "argsTemplate": {
      "subagent_type": "<placeholder>",
      "team_name": "<hiveId>",
      "name": "<placeholder>",
      "run_in_background": true,
      "prompt": "<placeholder>"
    },
    "perWorker": [
      { "agentId": "council-worker-1", "agentType": "researcher" }
    ]
  }
}
```

Queen prompt template (`commands/hive-mind.ts:475+`) gets one new paragraph:

> *"After init: execute every entry in `requiredSetup` from the init response before spawning workers. For worker spawning: use the `spawnTemplate` from the spawn response — substitute `<placeholder>` fields per worker, but do not change `team_name`, `argsTemplate` shape, or `tool`. If a tool in `requiredSetup` is not available in this environment (e.g., `TeamCreate` requires `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`), proceed without it and emit a `system-reminder`-class warning to the synthesis output. Do not fail."*

#### Why (C) over (B)

1. **Single source of truth.** `hiveId == teamName` invariant enforced by code, not by prompt-template correctness.
2. **Code-enforced.** Tests assert `init.response.requiredSetup` carries a `TeamCreate` directive; tests assert `spawn.response.spawnTemplate.argsTemplate.team_name === hiveId`. Prompt-template correctness is hard to test mechanically.
3. **Deletes a rule from an already-overloaded queen prompt.** The queen prompt template at `commands/hive-mind.ts` already carries ~80+ lines of behavioral rules (queen types per ADR-0125, worker types per ADR-0126, failure protocol per ADR-0131, sub-queen escalation per ADR-0132, per-topology dispatch per ADR-0128). Adding "remember to `TeamCreate` first" is one more thing to forget. Substrate-level binding deletes the rule.
4. **Substrate ownership matches ADR-0114's substrate/protocol/execution layering.** Team membership is a coordination primitive; coordination primitives belong to the substrate.
5. **Composes with future protocol additions.** If we later need workers to also `TaskCreate` to claim slots, that's an addition to `requiredSetup` — a substrate code change, not yet another prompt edit.

#### What this unlocks

After Piece 6 lands, hive workers gain (per ADR-0145 + the 2026-05-05 `oq()` research):

| Behavior gated on `oq()` | Active for hive workers post-Piece-6? |
|---|---|
| `teammate_mailbox` system-reminder injection | ✅ Yes |
| `team_context` system-reminder injection | ✅ Yes |
| `@<name>` resolution in queen input | ✅ Yes |
| Direct-message dispatch via `@<name>: ...` syntax | ✅ Yes |
| `TaskUpdate` auto-claim on `in_progress` transition | ✅ Yes |
| `task_assignment` mailbox message on `TaskUpdate` ownership change | ✅ Yes |
| Completion-message nudge ("call TaskList for next") | ✅ Yes |
| Permission-mode cycle for in-process teammates | ✅ Yes |
| Telemetry `team_name` tag | ✅ Yes |
| Mailbox attachment rendering | ✅ Yes |

10 of the 15 `oq()`-gated behaviors become active for hive workers. The remaining 5 (CLI flags, settings UI, prompt-suggestion auto-disable, plan-mode hint, iTerm session restoration) are queen-side-only and unaffected by team binding.

#### Graceful degradation when `oq()` is off

The substrate emits `requiredSetup` unconditionally — the MCP handler doesn't try to detect whether `oq()` is enabled in the queen's environment (the substrate runs in a separate process and doesn't have access to that env var). The queen, however, can detect it: when the queen tries to execute `TeamCreate` and gets a "tool not available" / "permission denied" / "tool not in dispatch list" response, it logs the gap and proceeds without team binding. Workers spawn without `team_name`; Agent Teams behaviors are inactive; the rest of the hive substrate (slot registry, consensus, memory) continues to work as today.

- `oq()` on → full Agent Teams integration, all 10 behaviors active
- `oq()` off → graceful degradation to current pre-Piece-6 behavior; one warning logged; no failure

#### File targets

| File | Change | Approx LOC |
|---|---|---|
| `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts:1470-1579` | Extend `hive-mind_init` handler return shape with `requiredSetup` | ~20 |
| `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts:1272-1468` | Extend `hive-mind_spawn` handler return shape with `spawnTemplate` | ~30 |
| `forks/ruflo/v3/@claude-flow/cli/src/commands/hive-mind.ts:475+` | Insert one paragraph in queen prompt template documenting the `requiredSetup` / `spawnTemplate` execution contract | ~15 |
| `forks/ruflo/v3/@claude-flow/cli/__tests__/mcp-tools-deep.test.ts` | 4-6 new `it()` blocks asserting contract shape + values | ~40 |
| `forks/ruflo/plugins/ruflo-hive-mind/skills/hive-mind-advanced/SKILL.md` | Patterns 1-4 §Workflow simplifications: replace explicit `Task({team_name})` shapes with "execute `spawnTemplate`" prose | ~30 net |

Total: ~135 LOC of fork-side code change. No upstream PR (per `feedback-no-upstream-donate-backs.md`).

#### Acceptance criteria

Piece 6 is complete when all of:

1. `hive-mind_init` test asserts `response.requiredSetup` is an array containing a `TeamCreate` directive with `args.team_name` matching the hiveId
2. `hive-mind_spawn` test asserts `response.spawnTemplate.argsTemplate.team_name === hiveId`
3. Queen prompt template carries the "execute `requiredSetup`; use `spawnTemplate`" instruction; verifiable by `grep -c "requiredSetup" commands/hive-mind.ts ≥ 1`
4. ≥1 council session runs end-to-end with the new pattern; queen invokes `TeamCreate`; workers join the team; verify `teammate_mailbox` reminder appears in worker turn boundaries via stream-json telemetry
5. ≥1 graceful-degradation case verified (run with `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` unset; confirm queen logs the gap and continues without team binding)
6. SKILL.md Patterns 1-4 updated to reference the contract execution path

#### Promote to own design ADR if

- The schemas for `requiredSetup` and `spawnTemplate` need to also serve a second substrate (e.g., swarm). When that happens, promote to a normative cross-substrate ADR. **This case has been pre-identified — see ADR-0146 (swarm-side application of the same pattern).** ADR-0146 references this Piece 6 as the canonical pattern definition.
- Tools beyond `TeamCreate` need to land in `requiredSetup` (e.g., `TaskListInit`, `MailboxConfigure`). If the directive list grows, separate ADR may be warranted.

## T1-T14 coverage in Piece 1 (added 2026-05-05)

The 14 runtime tasks closed by ADR-0118 are exercised by the rewritten SKILL.md (Piece 1 authored 2026-05-05) as follows. This matrix is a contract: if Piece 1 ships without exercising a T-task whose runtime lands in `forks/ruflo/v3/...`, that feature becomes invisible to users invoking `/hive-mind-advanced`.

| Tn | ADR | Runtime feature | SKILL.md location | Patterns that exercise it |
|---|---|---|---|---|
| T1 | ADR-0119 | Weighted consensus (Queen ×3, denominator `(N-1)+3`) | Core concepts §Consensus algorithms; Pattern 2 §Algorithm-selection guidance; Pattern 3 §Workflow `consensus:"weighted"` | **Pattern 3** (primary — Implementation Hive default); Pattern 1 (alt for queen-led councils) |
| T2 | ADR-0120 | Gossip consensus (rounds-based, `2·ceil(log₂N)` budget) | Core concepts §Consensus algorithms; Pattern 2 §Algorithm-selection guidance | Pattern 2 (advisory rounds for small N with voter dropouts) |
| T3 | ADR-0121 | CRDT consensus (mathematical convergence) | Core concepts §Consensus algorithms; Pattern 2 §Algorithm-selection guidance | Pattern 2 (re-broadcast safety, partition tolerance) |
| T4 | ADR-0122 | 8 typed memory buckets with TTL | Core concepts §Memory types — full 8-row table; Failure handling references typed-bucket persistence | **All 4 patterns** persist via `type:"consensus"` or `type:"result"` |
| T5 | ADR-0123 | LRU cache + RVF WAL backend | Core concepts §Memory types — LRU/WAL paragraph (`RUFLO_HIVE_CACHE_MAX=1024`, sweep `60s`) | Substrate (all patterns benefit; not directly invoked) |
| T6 | ADR-0124 | Session checkpoint/resume/export/import | §Session lifecycle — full section with archive schema v1 (`{schemaVersion, hiveState, queenPrompt, queenType?, workerManifest, timestamp}`) | Pattern 1 (long-running councils); referenced as available across all patterns |
| T7 | ADR-0125 | Queen-type runtime (3 verbatim prose blocks; sentinels `"written plan"` / `"spawned workers within"` / `"named your chosen mode"`) | Core concepts §Queen types — sentinel table; each Pattern §Workflow picks a `queenType` | **All 4 patterns** (P1 strategic; P2 tactical; P3 tactical; P4 strategic) |
| T8 | ADR-0126 | Worker-type runtime (8 verbatim prose blocks via `renderWorkerTypeBlocks` at `hive-mind.ts:240-345`) | Core concepts §Worker specialisations — 8-row table extracted from source | Pattern 3 (mixed-type spawn); reference for all |
| T9 | ADR-0127 | Adaptive topology autoscale | Core concepts §Topologies — adaptive paragraph + autoscale config (poll 5s, settle/dampen 30s, CoV 0.6/0.3, max 4 flips/hr, 3 dampening windows mid-task switch) | Available across all patterns via `topology:"adaptive"` |
| T10 | ADR-0128 | 6-topology runtime dispatch (`mesh` / `hierarchical` / `hierarchical-mesh` / `ring` / `star` / `adaptive`) | Core concepts §Topologies — 6-row table | Pattern 1 (`hierarchical-mesh`); Pattern 2 (`mesh`); Pattern 4 (`mesh`); Pattern 3 (`hierarchical-mesh`) |
| T11 | ADR-0130 | RVF WAL fsync durability (Linux 100%, macOS bounded by disk write cache) | Core concepts §Memory types — durability paragraph | Substrate; mentioned for power-loss survival expectations |
| T12 | ADR-0131 | Worker failure protocol (60s timeout, retry-once, `retryOf` lineage, auto-status transitions) | §Failure handling §WORKER FAILURE PROTOCOL — verbatim 4-step structure cited at `commands/hive-mind.ts:495-536` | All patterns (failure backstop; queen reads on launch) |
| T13 | ADR-0108 | Mixed-type worker spawns (`agentTypes: array<enum>` + round-robin `i % len` + mutex with `agentType`) | Pattern 3 §Workflow uses `agentTypes:["coder","coder","tester","documenter"]`; spawn schema documented in Quick Start | **Pattern 3** (primary); Pattern 1 / 4 with same-type arrays |
| T14 | ADR-0132 | Sub-queen failure escalation in hierarchical-mesh (data-driven hybrid: `promote-worker` if ≥1 healthy, else `escalate-to-root`) | §Failure handling §SUB-QUEEN FAILURE PROTOCOL — verbatim 4-step structure cited at `commands/hive-mind.ts:538-595` | Pattern 1 (`hierarchical-mesh` topology); Pattern 3 (same) |

**Coverage acceptance check** (verifiable via grep):

```bash
# 1. Each consensus algorithm appears in the SKILL.md body
grep -cEi "weighted|byzantine|raft|gossip|crdt|quorum" \
  forks/ruflo/plugins/ruflo-hive-mind/skills/hive-mind-advanced/SKILL.md
# Expected: ≥ 12 (each algorithm in Core Concepts table + at least one Pattern reference)

# 2. Each queen type appears
grep -cE "strategic|tactical|adaptive" \
  forks/ruflo/plugins/ruflo-hive-mind/skills/hive-mind-advanced/SKILL.md
# Expected: ≥ 6 (queen-type table + each Pattern picks a queenType)

# 3. All 8 worker types appear
grep -cE "researcher|coder|analyst|architect|tester|reviewer|optimizer|documenter" \
  forks/ruflo/plugins/ruflo-hive-mind/skills/hive-mind-advanced/SKILL.md
# Expected: ≥ 8 (worker-type table)

# 4. All 6 topologies appear
grep -cE "\\b(mesh|hierarchical|hierarchical-mesh|ring|star|adaptive)\\b" \
  forks/ruflo/plugins/ruflo-hive-mind/skills/hive-mind-advanced/SKILL.md
# Expected: ≥ 6 (topology table)

# 5. All 8 memory types appear
grep -cE "\\b(knowledge|context|task|result|error|metric|consensus|system)\\b" \
  forks/ruflo/plugins/ruflo-hive-mind/skills/hive-mind-advanced/SKILL.md
# Expected: ≥ 8 (memory type table)

# 6. Failure-protocol sentinels and source line refs
grep -cE "WORKER FAILURE PROTOCOL|SUB-QUEEN FAILURE PROTOCOL|hive-mind\\.ts:(495|538)" \
  forks/ruflo/plugins/ruflo-hive-mind/skills/hive-mind-advanced/SKILL.md
# Expected: ≥ 4 (both protocol headers + line refs)

# 7. Mixed-type spawn schema present
grep -cE "agentTypes:.*\\[" \
  forks/ruflo/plugins/ruflo-hive-mind/skills/hive-mind-advanced/SKILL.md
# Expected: ≥ 2 (Quick Start example + Pattern 3 mixed-type spawn)
```

If any check fails, the SKILL.md does not fully exercise T1-T14 and an authoring follow-up is needed. As of the 2026-05-05 authoring, all 7 checks pass.

## Council review findings (2026-05-05)

After Piece 1 was authored, a 4-persona council was convened via Pattern 1 (Council Hive) to dialectically review ADR-0140 + the rewritten SKILL.md. Personas: Pre-mortem Strategist (3-year hindsight lens), Implementation Realist (prose-vs-source verification), Spec Theorist (coherence with ADR-0139), Devil's Advocate (adversarial — must explicitly withdraw or hold). Transport: file-based crosstalk via `/tmp/hive-adr0140-council/` (validated 2026-05-04 per `reference-hive-runtime-crosstalk-pattern.md`).

**Verdict: substantively sound but incomplete.** Five findings surfaced, three actionable bugs:

### Finding 1 — Pattern 4 wire bug (Realist; corroborated by Theorist + DA)

**`forks/ruflo/plugins/ruflo-hive-mind/skills/hive-mind-advanced/SKILL.md:462`** declares `consensus: "majority"` as a valid `hive-mind_init` value. This is broken end-to-end:

- The init schema's `consensus` field is `type: 'string'` with description-only enum (`hive-mind-tools.ts:1493-1496`) — accepts arbitrary strings including `"majority"`.
- The `_consensus.strategy` enum (`hive-mind-tools.ts:1810`) is `['bft','raft','quorum','weighted','byzantine','gossip','crdt']` — `majority` is **not** a valid strategy.
- Per ADR-0119 §Decision (T1), the prior `default:` branch of `calculateRequiredVotes` returning `floor(N/2)+1` was replaced by a synchronous throw.

Net: `_init({consensus:"majority"})` persists `state.config.consensus = "majority"` silently; downstream `_consensus` calls throw or hit `calculateRequiredVotes`'s deliberate failure path.

**Remediation (applied 2026-05-05):** SKILL.md Pattern 4 §Architecture changed from `consensus: "majority"` to `consensus: "quorum"` with `quorumPreset: "majority"` for the Phase 5 vote — which is the registered, schema-validated path.

### Finding 2 — Handler-invocation test gap (DA; held)

`_join`, `_leave`, `_broadcast`, `_memory` have **no dedicated handler-invocation tests** (only `p3-hm-*` smoke + `p3-hm-lifecycle` chain integration), per D2's coverage matrix in ADR-0145. The rewritten SKILL.md cites all four in `allowed-tools` and Pattern workflows, but cannot point to a per-handler verification.

**Remediation (proposed):** add **Piece 5 — Handler-invocation tests for `_join/_leave/_broadcast/_memory`** to ADR-0140's outline. Each tool gets a dedicated `it()` block in `cli/__tests__/mcp-tools-deep.test.ts` parallel to the existing `_init/_status/_consensus/_spawn/_shutdown` blocks. Tracked in §Open follow-ups.

### Finding 3 — Lock-wrap inconsistency (Realist; corroborated by DA)

A2's research finding: `_init`, `_spawn`, `_memory` are wrapped in `withHiveStoreLock`; `_join`, `_leave`, `_broadcast`, `_shutdown` are NOT. This is a real correctness gap acknowledged in SKILL.md §Failure handling §Lock-wrap caveats but not fixed. Race window between `_join` and `_init`/`_spawn` can produce torn writes to `state.workers`.

**Remediation (proposed):** outside ADR-0140's scope (this ADR doesn't propose runtime fixes beyond Piece 3). Open follow-up tracked separately as a substrate hardening ticket.

### Finding 4 — Amendment readability defect (Strategist)

ADR-0140's §Amendment 2026-05-04 contains two rule blocks that contradict on the surface:
- §"Operational rule (post-experiment, simplified)" at L692-700 says *"The Bash CLI path... remains a fallback for cases where a fresh subprocess is desirable"*
- §"Updated rule (revised again, 2026-05-04 post-arm-D)" at L740-744 says *"The Bash CLI path is NOT a recommended fallback in projects with a running MCP server"*

The two are reconcilable (the second supersedes the first after arm D revealed flock contention), but a reader encountering L692 first will form a wrong mental model. Plus §"Piece 3 closed" at L674 vs §Open follow-ups still listing 3a at L947 is a documentation seam.

**Remediation (applied 2026-05-05):** added §"Final operational rule (post-council 2026-05-05)" at the end of the Amendment that consolidates both prior rules into the single canonical statement. The earlier "Operational rule" and "Updated rule" blocks are retained for audit trail but explicitly marked superseded.

### Finding 5 — Upstream-install invisibility (Theorist + DA, combined)

The fork's SKILL.md rewrite is invisible to anyone running ruflo against an upstream-only install — they still get the upstream brochure at `ruvnet/ruflo/.claude/skills/hive-mind-advanced/SKILL.md` (709 lines). Per `feedback-no-upstream-donate-backs.md`, this divergence stays fork-only. But the asymmetry is undocumented in ADR-0140 itself.

**Remediation (proposed):** add explicit Open follow-up. Not solvable without violating the no-donate-back policy; documenting it is the achievable bar.

### Bonus finding — Transport selection lesson

The council was conducted via file-based crosstalk transport (b). Reflection: this was over-cautious. For a one-shot one-round 4-agent dialectic, transport (a) "queen-composed default" — workers return positions; queen reads N returns; queen composes the discussion in main thread — would have been simpler, faster, and the canonical 250+ pre-regression pattern. File-based was warranted only if workers needed to *revise* their positions after seeing peers, which they didn't here.

**Remediation (proposed):** SKILL.md §Pattern 1 §Transports already lists all three options. **Add explicit guidance**: transport (a) is the default for one-round councils; transport (b) only when workers must revise; transport (c) when the validation entry exists (post-arm-B sustained crosstalk validation pending). Tracked as documentation polish in §Open follow-ups.

### Council process notes

- All 4 personas wrote positions and reactions; 60s barrier worked; cross-engagement by name with specific claims achieved on every reaction (per `feedback-hive-discussion-mechanics.md` §1).
- DA explicitly withdrew 2 of 5 arguments (Q3 swarm-vs-hive collapse; Q5 fork-divergence maintenance debt) on peer rebuttal; held 3 (Q1 Piece 3 closure post-hoc; Q2 grep-coverage shallow; Q4 test gap) with corroboration.
- Strategist softened Q1 (T1-T14 matrix is not bolted-on) after engaging with the actual matrix structure — dialectic genuinely advanced the position rather than just trading restated takes.
- Total wall time: ~2.5 minutes (4 agents in parallel).

## Rationale

- **The evidence sources converge on the same architecture.** The pre-regression source code and the in-repo file-based crosstalk validation describe the same flow: substrate-only queen prompt + protocol layer + one-round Agent spawn + queen-composed transcript. Implementing exactly that, no more, is the lowest-risk path.
- **Single-round + composition is empirically validated** by the in-repo file-based crosstalk validation on 2026-05-04 (memory `reference-hive-runtime-crosstalk-pattern.md`). Multi-round dialectic via broadcast is *aspirational* — it would be elegant but the bridge doesn't exist and there's no compelling reason to build it when single-round produces working council output.
- **Generic protocol template unblocks projects without a methodology document.** ADR-0114 Lens 10 noted that fresh-init projects produce parallel work delegation, not council format, when they lack a project-supplied methodology. Shipping a generic template with the skill closes that gap without forcing every project to invent its own.
- **Procedure-shaped skill > brochure-shaped skill.** Other working skills in the same plugin set (`ruflo-rag-memory:memory-search`, `frontend-design:frontend-design`) are concrete numbered procedures. The current `hive-mind-advanced` is the only one in catalog form. Aligning with the rest of the plugin set is the cheapest readability win.
- **Document-the-limitation > build-the-bridge for now.** Gap 3b (broadcast vs Agent-Teams) would take meaningful effort to fix and adds a runtime flow nobody has shipped a working version of. Documenting that single-round is canonical is honest, immediate, and matches every empirical working session.

## Consequences

### Positive

- The skill becomes a thing an assistant can actually follow. Removes the current trap where SKILL.md prose implies an autonomous runtime that doesn't exist.
- Fresh projects get usable council output without inventing a methodology.
- ADR-0114 §Done U5 closes.
- Substrate vs protocol separation is finally codified in plugin documentation.
- Memory entries (`reference-hive-runtime-crosstalk-pattern.md`, `feedback-hive-discussion-mechanics.md`) are reduced from "tribal knowledge" status to "implemented in shipped skill" status.

### Negative

- Piece 1 + Piece 2 are ~250-400 lines of new fork-side content + a 713 → ~150 line replacement. Real authoring effort, even though it's compression rather than expansion.
- Gap 3a is a real bug; if not fixed in Piece 3, Path 5(c) (CLI-bridged hive_memory cross-talk) is blocked and only Paths 5(a)/5(b) work. That's acceptable — we ship with the limitation documented and fix later.
- Some users may want the registry's "BFT consensus on a proposition" use case in isolation (without the council pattern). That's still possible — Path A/B with `--consensus byzantine` and no panellist personas. The rewritten SKILL.md should make this explicit so the consensus primitive isn't lost in the council pattern's larger surface.

### Neutral

- The fork formally takes on ownership of the council pattern as an extension of the registry's consensus primitive. Memory `feedback-no-upstream-donate-backs.md` says we don't push back to ruvnet — fine, this lives fork-side.

## Verification

When the four Pieces have landed, the following should pass:

```bash
# 1a. Skill follows pattern-based template (4 Pattern sections, mirroring swarm-advanced)
grep -cE '^## Pattern [1-4]:' forks/ruflo/plugins/ruflo-hive-mind/skills/hive-mind-advanced/SKILL.md
# Expected: 4

# 1b. Skill uses MCP tools directly, not Bash/npx in queen contexts
grep -cE 'mcp__ruflo__hive-mind_(init|spawn|consensus|memory|status|shutdown)' \
  forks/ruflo/plugins/ruflo-hive-mind/skills/hive-mind-advanced/SKILL.md
# Expected: ≥ 8 (each pattern uses init + spawn + consensus + memory at minimum)

# 1c. Bash/npx invocations only in CLI-Fallback subsections (not in primary Workflow)
awk '/^### CLI Fallback/,/^### |^## /' \
  forks/ruflo/plugins/ruflo-hive-mind/skills/hive-mind-advanced/SKILL.md | \
  grep -c 'npx ruflo'
# Expected: ≥ 4 (one per Pattern, in fallback section only)

awk '/^## Pattern/,/^### CLI Fallback/' \
  forks/ruflo/plugins/ruflo-hive-mind/skills/hive-mind-advanced/SKILL.md | \
  grep -cE 'Bash\("npx ruflo|npx ruflo hive-mind'
# Expected: 0 in primary Workflow (all queen calls are MCP-direct)

# 1d. Length in same order as swarm-advanced
wc -l forks/ruflo/plugins/ruflo-hive-mind/skills/hive-mind-advanced/SKILL.md
# Expected: ~600-800 (vs swarm-advanced's 973)

# 2. Generic template ships
ls forks/ruflo/plugins/ruflo-hive-mind/skills/hive-mind-advanced/templates/
# Expected: generic-council-protocol.md, worker-contract.md

# 3. Substrate flags persist correctly (Piece 3c)
npx ruflo hive-mind init -t hierarchical-mesh -c byzantine -m 3 --memory-backend hybrid
cat .claude-flow/hive-mind/state.json | jq '.topology, .config'
# Expected: hierarchical-mesh persisted; consensus/memoryBackend persisted in config

# 4. End-to-end run from inside Claude Code session, no project-supplied protocol
#    Should produce 8-section transcript using the shipped generic template
ToolSearch("select:mcp__ruflo__guidance_capabilities")
# Then invoke /ruflo-hive-mind:hive-mind-advanced with a 3-agent council args
# Expected: shipped generic-council-protocol.md drives the format; transcript file produced.

# 5. ADR-0114 §Done U5 marked closed with reference to ADR-0140 + this verification
grep -A 3 "Done U5" forks/ruflo/docs/adr/ADR-0114-*.md

# 6. Council-surfaced regression checks (added 2026-05-05)
# 6a. Pattern 4 wire bug — `consensus: "majority"` is not a valid _consensus.strategy enum value
#     (Majority removed per ADR-0119; survives only as Raft's formula). The bare token
#     `consensus: "majority"` should NOT appear in SKILL.md outside quorumPreset context.
grep -nE 'consensus:\s*"majority"' \
  forks/ruflo/plugins/ruflo-hive-mind/skills/hive-mind-advanced/SKILL.md
# Expected: no match (regression check; fixed 2026-05-05 in Pattern 4 §Architecture)

# 6b. Per Council Finding 2 — verify `_join/_leave/_broadcast/_memory` have dedicated
#     handler-invocation tests (Piece 5 acceptance check; not yet implemented).
grep -lE "describe.*hive-mind_(join|leave|broadcast|memory)" \
  forks/ruflo/v3/@claude-flow/cli/__tests__/*.test.ts | wc -l
# Expected after Piece 5: ≥ 4 (one describe block per tool)
# Currently: 0 (smoke + lifecycle only — see ADR-0145 §D2 coverage matrix)
```

## Open follow-ups

- **Piece 1 authoring** — actual rewrite of `forks/ruflo/plugins/ruflo-hive-mind/skills/hive-mind-advanced/SKILL.md`. Tracked separately. **Note (2026-05-05):** the rewrite now targets a fully-implemented fork runtime per ADR-0118 T1-T14 (all complete), not a partially-implemented one. Patterns 1-4's tool calls (`mcp__claude-flow__hive-mind_init`, `_spawn`, `_consensus`, `_memory`, etc.) all reach real fork-side runtime behaviour.
- **Piece 2 authoring** — `templates/generic-council-protocol.md` + `templates/worker-contract.md`. Tracked separately.
- **Piece 3a bug fix** — superseded; per the §Amendment 2026-05-04 (row 3a closure), real fix is ADR-0117 (dual namespace registration). Sub-agent direct MCP works empirically (arm B).
- **Piece 3b documentation decision** — closed (shipped via fork commit `b9421bad0` per Piece 3 §Status table).
- **Pieces 1-2 in upstream PR?** Memory `feedback-no-upstream-donate-backs.md` says no. But the `templates/` content is generic enough that upstream could legitimately benefit. Not for this ADR to decide.
- **Skill ↔ registry coupling automation** — if upstream's registry block changes the `skills` list, our SKILL.md must be re-aligned. No automation today (per ADR-0139 §Open follow-ups item 4). Still open.
- **Piece 1 should advertise the fork-side runtime closure.** The rewritten SKILL.md should explicitly call out (in §Real-World Examples or §Best Practices) that the fork's hive-mind runtime closes upstream's V3 Queen-implementation gap (per `HIVE-MIND-MIGRATION.md:59-67`) via ADR-0118 T1-T14. Without this anchor, users invoking `/hive-mind-advanced` against an upstream-only install will hit the gaps the fork has already closed and won't know why.

### Council-surfaced follow-ups (2026-05-05)

- **Pattern 4 wire bug — FIXED 2026-05-05.** SKILL.md Pattern 4 §Architecture replaced `consensus: "majority"` with `consensus: "quorum"` + `quorumPreset: "majority"`. See §Council review findings §Finding 1.
- **Piece 5 — handler-invocation tests for `_join/_leave/_broadcast/_memory` (NEW PIECE).** Per Finding 2, these four tools have no dedicated test in `cli/__tests__/mcp-tools-deep.test.ts`. Add per-tool `it()` blocks parallel to existing `_init/_status/_consensus/_spawn/_shutdown` coverage. **Action item; not yet executed.**
- **Lock-wrap inconsistency for `_join/_leave/_broadcast/_shutdown`.** Per Finding 3, these are not wrapped in `withHiveStoreLock` despite ADR-0129's rationale applying. Substrate hardening — outside ADR-0140 scope but tracked.
- **Amendment readability — FIXED 2026-05-05.** §Amendment now ends with §"Final operational rule (post-council 2026-05-05)" consolidating both prior rule blocks. Earlier blocks marked superseded for audit trail.
- **Upstream-install invisibility — DOCUMENTED 2026-05-05.** Per Finding 5: fork's rewrite is invisible to users running ruflo against an upstream-only install (they get the brochure at `ruvnet/ruflo/.claude/skills/hive-mind-advanced/SKILL.md`). Per `feedback-no-upstream-donate-backs.md`, the divergence stays fork-only. Documenting the asymmetry is the achievable bar.
- **SKILL.md §Pattern 1 §Transports — selection guidance — DONE 2026-05-05.** Per Bonus finding + the 2026-05-05 confirmation that `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` is always set in ruflo environments: §Transports rewritten with 4 ranked options. **(a) queen-composed default** for one-round councils. **(b) `SendMessage` via Agent Teams** as the canonical runtime cross-talk transport when workers must revise — replaces the prior "file-based" recommendation. **(c) Direct MCP `_memory`** for durable typed-bucket cross-session work. **(d) File-based** demoted to fallback for environments without Agent Teams + MCP. Selection cheat-sheet table added. §Calling convention also updated to document `SendMessage` as the upstream-blessed inter-agent messaging primitive (USERGUIDE L1683).
- **Validate sustained MCP crosstalk from sub-agent context.** Arm B (ADR-0144) verified single-call MCP works from sub-agent. No memory entry yet for sustained multi-call crosstalk via `mcp__claude-flow__hive-mind_memory` from sub-agent. A controlled experiment to fill that gap unblocks transport (c) as the default in future councils. Tracked separately.
- **Piece 6 — Substrate-dictated team binding (Agent Teams integration) — PROPOSED 2026-05-05.** Surfaced by user follow-up on the council finding. Added as §Piece 6 above. Status: Proposed, not yet implemented. Implements substrate-dictated `requiredSetup` + `spawnTemplate` contract that the queen executes deterministically, unlocking 10 of the 15 `oq()`-gated Agent Teams behaviors for hive workers. ~135 LOC fork-side. Sequence: implement after Piece 1/2 ratification stabilises. Cross-references ADR-0146 (swarm-side application of the same pattern, blocked on Piece 6 implementation + validation).
