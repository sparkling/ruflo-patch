---
status: proposed
date: 2026-06-11
tags: [agents, nested-subagents, plugins, orchestration, upstream-port, batch-u, branding]
supersedes: []
depends-on: [ADR-0098, ADR-0115, ADR-0301]
implements: []
---

# Nested Sub-Agent Infrastructure (depth=5) — stage-1 hand-port of upstream ADR-147

## Context and Problem Statement

On 2026-06-09 Boris Cherny announced nested sub-agent support in Claude Code
(agents that spawn agents, capped at depth=5), as a way to manage context: each
nesting level gets a fresh context window, so a deep tree never forces the lead
to read the inner chatter. Upstream `ruvnet/ruflo` captured this as **ADR-147**
and shipped commit `f5a180423` ("ADR-147 nested subagent depth=5 infrastructure
+ P2 stage 1"), adding nested-`*` agent definitions, a `nested-subagents` skill,
and the beginnings of `parent_agent_id` capture.

The Batch-U upstream-sync disposition
(`docs/upstream/batch-u/disposition-C-graph-rvagent.md`) marked `f5a180423` a
**HAND-PORT, Size M, FLAGGED, branding-coupled** — a genuine gap (no `nested-*`
agents, no ADR-147 doc in the fork) whose port is judgment-heavy because the
upstream agents reference `mcp__claude-flow__*` tool names, `swarm_init` /
`hive-mind_spawn`, and a CLAUDE.md queen-coordinator rewrite, all of which must
be reconciled with fork policy (ADR-0301 marketplace identity; ADR-0098
anti-reflexive-swarm; ADR-0115 hive-mind carve-out).

This ADR governs the fork's adoption: **what we port now (stage 1), what we
defer, and how the port is reconciled with existing fork governance.**

### Findings from inspecting the fork before porting

1. **`plugins/ruflo-agent/` does not exist on the fork's `main` branch.** Upstream
   commit `ef73a1616` (ADR-115) renamed `ruflo-wasm` → `ruflo-agent`; the fork
   **did not adopt that rename** and keeps its agent/WASM runtime under
   `plugins/ruflo-wasm/` (10 `wasm_*` MCP tools, `wasm-agent` / `wasm-gallery`
   skills). So the upstream port target plugin is absent here. (The `ruflo-agent`
   skills visible in this session's skill list come from other installed trees —
   `fork-restart`, upstream — not from this fork.)
2. **The nested capability is inert in the shipped Claude Code binary.** Upstream's
   own ADR-147 empirical block documents that CLI 2.1.169 *strips* `Task` (and
   `TodoWrite`) from any spawned sub-agent's tool list — a hardcoded/server-side
   denylist no flag defeats. The YAML `tools:` mechanism is confirmed honored (4
   of 6 declared tools propagate), so the agent files are declaratively correct,
   but **end-to-end nesting cannot run today**. The agents are "infrastructure
   preparation" that activate with zero code changes when the denylist lifts.
3. **No fork agent definition currently declares a `tools:` frontmatter field.**
   That omission is exactly why spawned children inherit `hasTaskTool=false`. The
   stage-1 mechanism is therefore precisely: *ship agent defs that declare
   `tools:` including `Task`.*
4. **Upstream's ADR numbers do not map to the fork's.** Upstream ADR-144 =
   "Authorization Propagation / AuthScope"; fork ADR-0144 = a *superseded* note on
   "MCP tools from sub-agent context". Upstream ADR-099/097/131/146 likewise map
   to unrelated fork ADRs. Cross-references in the ported files were therefore
   **stripped of upstream numbers** and re-pointed at this ADR + the real fork
   ADRs (0098/0115).
5. **Upstream's commit edits `v3/@claude-flow/cli/src/...` runtime files**
   (`hooks.ts`, `hooks-tools.ts`, `memory-bridge.ts`) for P2 `parent_agent_id`
   capture — and a probe script + a probe-output fixture. Those are **out of
   scope for this edit-only port** (no runtime code), and upstream's own ADR-147
   marks P2/P3 **blocked/deferred** until a working nested spawn exists to
   exercise them. So deferring them here matches upstream's own sequencing, not
   just our constraint.

## Decision

Adopt the nested-sub-agent capability as **stage-1 plugin/agent infrastructure
only**, re-homed and rebranded to the fork, governed by this fork-native ADR
(numbered in the fork's own sequence; we do **not** import the upstream "147").

### Stage 1 — what lands now (this port)

A new, purpose-scoped **`plugins/ruflo-agent/`** plugin containing **only** the
nested-orchestration surface (it is NOT a re-creation of upstream's full
`ruflo-agent` runtime plugin — the fork's agent/WASM runtime stays in
`ruflo-wasm`):

| File | Role |
|---|---|
| `.claude-plugin/plugin.json` | minimal manifest so the agent/skill defs are a loadable plugin |
| `agents/nested-coordinator.md` | generic deep-delegation orchestrator (`tools:` includes `Task`) |
| `agents/nested-researcher.md` | recursive research orchestrator (has `Task`) |
| `agents/nested-reviewer.md` | find→adversarial-verify reviewer (has `Task`) |
| `agents/nested-leaf.md` | leaf-worker template, deliberately **no** `Task` (the least-privilege boundary) |
| `skills/nested-subagents/SKILL.md` | when-to-nest-vs-fan-out, depth budget, child-summary contract |

These four agents are the **tier-1** (depth-only) set: they use **only native
Claude Code tools** (`Task`, `Read`, `Grep`, `Glob`, `TodoWrite`, `Bash`,
`WebFetch`, `WebSearch`). They do **not** touch any `mcp__ruflo__*` orchestration
surface — which is what keeps them clear of the ADR-0098/0115 guardrails (see
Reconciliation below).

The agent/skill prose is rebranded per ADR-0301:

- `mcp__claude-flow__*` → `mcp__ruflo__*` (only one such reference survives — the
  `wasm_agent_*` row in the nested-coordinator comparison table).
- `npx @claude-flow/cli@latest …` → `npx @sparkleideas/cli@latest …` (matching
  the fork's existing agent-def convention, e.g. `ruflo-swarm/agents/coordinator.md`).
- `CLAUDE_FLOW_STRICT_NESTING` env var is **kept verbatim** — it matches the
  fork's existing `CLAUDE_FLOW_*` env-var namespace, and it is the contract the
  deferred P3 guardrail will read; renaming now would create drift when P3 lands.
- Sibling-plugin references retargeted to **real fork agents**:
  `ruflo-goals:dossier-investigator`, `ruflo-core:reviewer`,
  `ruflo-core:coder` / `ruflo-core:tester`, `ruflo-sparc:sparc-orchestrator`,
  `v3-queen-coordinator` (all confirmed present in the fork).
- Every file carries an explicit **"activation status (inert today)"** note so no
  reader believes nesting currently runs.

### Stages deferred (not in this port)

| Upstream piece | Why deferred |
|---|---|
| **Tier-2 "queen" agents** (`nested-queen`, `nested-queen-researcher`, `nested-queen-reviewer`, `nested-queen-leaf`) | These wire each spawn into `swarm_init` + `hive-mind_spawn` (queen/raft) + `hive-mind_consensus` / `coordination_consensus` + the intelligence pipeline + claims/AIDefence/cost-budget. **They directly contradict fork policy** (ADR-0098, ADR-0115, `feedback-no-hive-ceremony-for-impl`) if shipped as-is. Porting them faithfully would mean either (a) shipping reflexive `swarm_init`/`hive-mind_spawn` wiring the fork has ratified against, or (b) stripping that wiring — which makes them not-faithful ports. Deferred pending a deliberate decision (see "Open question"). |
| **P2 — `parent_agent_id` / `depth` capture to AgentDB** (`hooks.ts`, `hooks-tools.ts`, `memory-bridge.ts`) | Runtime code (out of edit-only scope) **and** upstream itself marks P2 blocked until a working nested spawn can exercise it. The agent prose references tree-shape persistence via `memory store` as the interim path. |
| **P3 — depth-aware `pre-task` guardrail** (`NESTING_DEPTH_EXCEEDED`, cap=4 behind `CLAUDE_FLOW_STRICT_NESTING`) | Runtime hook code (out of scope) and upstream-deferred for the same reason. The agents/skill describe the cap and require self-enforcement until P3 lands. |
| **P4 — CLAUDE.md queen-coordinator rewrite** | Upstream rewrites root `CLAUDE.md` to make the queen spawn workers *nested*. The fork's `CLAUDE.md` orchestration block is the ADR-0098/0115-shaped "default to Agent fan-out, do not call `swarm_init`/`hive-mind_spawn` reflexively" guardrail. Rewriting it to promote nested spawning while the capability is inert would mislead — deferred until the runtime gate flips, and even then must preserve the anti-reflexive posture. |
| **Probe script + fixtures** (`scripts/probe-nested-spawn-depth.mjs`, `docs/probes/*.txt`) | A regression harness for re-checking the cap after each CLI upgrade. Useful but optional, and wiring a new test belongs with the standard CICD runner (`feedback-always-wire-tests-into-cicd`), not as a loose script. Deferred. |
| **marketplace.json registration of `ruflo-agent`** | Registering a new plugin in `.claude-plugin/marketplace.json` is a discoverability/distribution decision with session-persistent reach (akin to a plugin install). Left to a deliberate follow-up rather than bundled into the agent-def edit. The plugin.json makes the dir a *valid* plugin; the marketplace row makes it *offered*. |

## Reconciliation with fork governance (the FLAGGED part)

### ADR-0098 — Swarm-Init Sprawl (anti-reflexive `swarm_init`)

ADR-0098's durable rule: *"DO NOT call `swarm_init`, `hive-mind_spawn`, or
`ruflo swarm init` reflexively at the start of tasks. Only when (a) the user
explicitly asks, or (b) persistent cross-session coordination state is actually
required."*

**Reconciliation:** the stage-1 tier-1 agents use **only native Claude Code
tools** — there is **no `swarm_init` in any of them**. Nesting via `Task` spawns
sub-agents with *zero coordination state* (exactly the cheap path ADR-0098 steers
toward), so it does not produce orphan swarm records and does not trip the
guardrail. The SKILL's anti-pattern list explicitly says **do not reach for
`swarm_init`/`hive-mind_spawn` to drive a spawn tree**. The only place that wiring
would appear is the **deferred tier-2 queen** set, which is exactly why it is
deferred.

### ADR-0115 — Hive-mind carve-out

ADR-0115 records that `hive-mind_spawn` was *side-swiped* into ADR-0098's
prohibition without separate justification, and restores hive-mind as a
legitimate, deliberate council mechanism (not reflexive ceremony). The
fork-authored `hive-mind-advanced` skill is the sanctioned surface for that.

**Reconciliation:** stage-1 nesting and the hive-mind carve-out are orthogonal.
Stage-1 nested agents never invoke `hive-mind_*`. When the deferred tier-2 queen
work is reconsidered, any consensus step must route through the **existing**
hive-mind surface as a *deliberate* council (per ADR-0115), never as an automatic
per-branch vote inside a spawn tree. The `nested-reviewer` diverse-lens section
says exactly this: aggregate lens votes yourself; routing through
`hive-mind_consensus` is a deferred tier-2 behaviour.

### `feedback-no-hive-ceremony-for-impl`

User memory: the **default for all work** (including councils and multi-expert
review) is parallel `Agent` fan-out with queen synthesis by the lead — *not* a
hive ceremony — and a hive is convened only on explicit plain-text confirmation.

**Reconciliation:** stage-1 nested sub-agents are a *context-management* refinement
of plain `Agent` fan-out (each level gets its own window), not a coordination/
consensus apparatus. They add **no** ceremony, **no** consensus, **no** persistent
state — fully aligned with the "default = Agent fan-out" posture. The heavyweight
consensus-bearing variant stays deferred precisely to avoid contradicting this.

### ADR-0301 — Marketplace identity

All user-facing tool/CLI/marketplace references are rebranded to the fork
(`mcp__ruflo__*`, `@sparkleideas/cli`, ruflo prose). Plugin.json keeps `ruvnet`
as `author` / `homepage`, matching every other fork plugin (the fork rebrands the
*surfaces*, not the upstream attribution).

## No-codex constraint

Per `feedback-no-codex-mentions`: no `--codex` / dual-mode / AGENTS.md / `.agents`
content is introduced. The ported files are Claude-only.

## Consequences

**Positive**

- The fork gains the declaratively-correct nested-orchestration surface. When the
  Claude Code runtime denylist on `Task` lifts, the deepest fork orchestrators
  (`dossier-investigator`, `sparc-orchestrator`, `v3-queen-coordinator`) can nest
  with **zero further agent changes**.
- Closes the Batch-U HAND-PORT for `f5a180423` (the nested-agent arm) without
  importing upstream's branding, ADR numbers, or anti-reflexive-violating queen
  wiring.
- Establishes the `tools:` frontmatter pattern in the fork's agent registry (no
  prior fork agent declared one).

**Negative / risks**

- **Inert until the runtime gate flips.** These files consume a small always-on
  token cost (their availability in the registry) but change no behaviour today.
  This is acceptable as infrastructure prep (matches upstream's posture) but must
  not be mistaken for a working feature — hence the explicit per-file status note.
- **A new plugin the fork's `main` deliberately lacked.** Introducing
  `plugins/ruflo-agent/` (even scoped to nesting) re-creates a directory name the
  fork chose not to take from upstream's `ruflo-wasm` → `ruflo-agent` rename. The
  name collision with upstream's full `ruflo-agent` plugin is cosmetic here
  (different contents, fork keeps `ruflo-wasm`), but a future upstream merge that
  brings the *real* `ruflo-agent` runtime would need to reconcile the two. **An
  alternative considered was re-homing the nested agents into the existing
  `ruflo-swarm` plugin** (which already ships orchestration agents); the literal
  upstream/disposition path was followed instead, and this risk is flagged for the
  queen to ratify or redirect.
- **Tier-2 queen agents remain unported.** The richest part of the upstream
  feature (consensus-on-branch, tree-shape learning, per-hop scope reduction,
  AIDefence-gated returns) is absent. If that capability is wanted, it needs a
  deliberate follow-up that reconciles each `swarm_init`/`hive-mind_spawn`/
  `coordination_consensus` call with ADR-0098/0115 (likely: gate every such call
  behind explicit user opt-in, never reflexive).

## Open question (for ratification)

Two decisions are deferred to the queen/user, not made unilaterally here:

1. **Plugin home** — keep the nested agents in a new `plugins/ruflo-agent/`
   (as ported), or re-home into `plugins/ruflo-swarm/agents/`? And should
   `ruflo-agent` be registered in `marketplace.json`?
2. **Tier-2 queen agents** — port them with every swarm/hive/consensus call
   gated behind explicit user opt-in (ADR-0098/0115-compliant), or leave deep
   nesting to the tier-1 set only?

## Validation

This port is **edit-only** (no build/test/commit in this pass). Validation when
the queen builds:

- The four agent defs and SKILL parse cleanly under the plugin loader (YAML
  frontmatter valid; `tools:` field accepted — upstream confirmed the loader
  accepts it).
- No residual `claude-flow` / `mcp__claude-flow__` / `@claude-flow/cli` / `RuFlo`
  strings in the ported files (verified during the port; `CLAUDE_FLOW_STRICT_NESTING`
  intentionally retained as a fork `CLAUDE_FLOW_*` env var).
- End-to-end depth=5 verification **cannot** be performed against the current
  Claude Code build (runtime strips `Task`); the regression check is to re-run the
  (deferred) probe after each CLI upgrade and flip P2/P3 the day it reports a cap.

## References

- Upstream: `ruvnet/ruflo` commit `f5a180423` (ADR-147 nested subagent depth=5
  infrastructure + P2 stage 1)
- Disposition: `docs/upstream/batch-u/disposition-C-graph-rvagent.md` (HP-2 row)
- Fork governance: ADR-0098 (swarm-init sprawl), ADR-0115 (hive-mind carve-out),
  ADR-0301 (marketplace identity)
- User memory: `feedback-no-hive-ceremony-for-impl`, `feedback-no-codex-mentions`

## Amendment (2026-06-11): DEFERRED this cycle — files NOT committed

Status stays `proposed` as a design record; the fork plugin/agent/skill files
described above were **discarded, not committed**, in the Batch-U wave-2 release.
Two blockers surfaced during implementation:
1. **INERT** — CLI 2.1.169 strips `Task` from spawned children (server-side
   denylist), so nested subagents cannot function until that gate lifts. Shipping
   the agent defs now would be dormant scaffolding (`feedback-no-dormant-off-by-default-flags`).
2. **NAMING** — they were authored under `plugins/ruflo-agent/`, a plugin name the
   fork deliberately did NOT adopt (it kept `ruflo-wasm`). Home (`ruflo-agent` vs
   `plugins/ruflo-swarm/agents/`) is unresolved.
The tier-2 "queen" agents (per-spawn `swarm_init`/`hive-mind_spawn`) conflict with
[[ADR-0098]]/[[ADR-0115]] and were already scoped out. Revisit when the CLI
Task-strip gate lifts + the plugin-home is ratified.

### Verification (2026-06-11): inert-claim confirmed EMPIRICALLY on CLI 2.1.173

The "inert" deferral rationale was initially relayed from upstream's ADR-147
finding (tested on CLI **2.1.169**). On challenge, it was re-verified on the
running CLI **2.1.173** with a live probe: a spawned `general-purpose` subagent's
toolset was exactly `[Bash, Edit, Read, Skill, ToolSearch, Write]` — **no `Task`
/ `Agent` tool** — and `ToolSearch("select:Task,Agent")` returned "No matching
deferred tools found". So the native nested-`Task` capability that upstream's
ADR-147 depends on is still stripped from spawned children on 2.1.173 (the
denylist has NOT lifted across 2.1.169→2.1.173). The deferral stands, now
evidence-backed.

Caveat: spawned children DO retain the MCP spawn surfaces
(`mcp__ruflo__agent_spawn`, `mcp__ruflo__hive-mind_spawn`) — a *different*
mechanism the fork already ships. A nested-orchestration feature built on the MCP
surface (rather than upstream's native-`Task` ADR-147 design) could function
today; that would be a distinct design, not this hand-port.
