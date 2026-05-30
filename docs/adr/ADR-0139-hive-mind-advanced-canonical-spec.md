---
status: proposed
date: 2026-05-04
tags: [hive-mind, skills, guidance, spec]
supersedes: []
depends-on: []
implements: []
---

# hive-mind-advanced — canonical specification per upstream guidance registry

## Context and Problem Statement

We need a single, citable, **upstream-grounded** reference for what the `hive-mind-advanced` skill is supposed to do. Three problems forced this:

1. The shipped SKILL.md (713 lines) is a feature catalogue, not a procedure — it describes capabilities ("queen orchestrates", "auto-scales", "neural pattern training") in language that implies an autonomous runtime that does not exist in the form described.
2. The skill, the CLI, the MCP tools, and Claude Code's `Agent` tool are four overlapping layers whose bridges are partial. Memory entries (`feedback-hive-orchestration-pattern.md`, `reference-hive-runtime-crosstalk-pattern.md`) document specific empirical gaps but no ADR has yet pinned down the **intended** spec the implementation is supposed to satisfy.
3. Several earlier internal plan docs tried to specify hive behaviour from project-specific methodology documents rather than from the ruflo product's own spec. That conflated domain methodology with the product surface.

Before we can write the gap-analysis ADR ("here is what the skill *actually* does and where it falls short"), we need an authoritative "here is what it is *supposed* to do" record. That record is this ADR.

### Provenance — why we trust this as upstream-canonical

The data block in §Decision below is reproduced verbatim from the output of the `mcp__ruflo__guidance_capabilities` MCP tool, filtered to the `hive-mind` area. That tool's data source is a TypeScript object literal in:

```
v3/@claude-flow/cli/src/mcp-tools/guidance-tools.ts
```

Verification performed 2026-05-04:

| Check | Result |
|---|---|
| Upstream file present | `~/source/ruvnet/ruflo/v3/@claude-flow/cli/src/mcp-tools/guidance-tools.ts:116-124` |
| Fork file present | `~/source/forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/guidance-tools.ts:82-90` |
| Field-by-field diff of the `'hive-mind'` block | **Identical** (8 keys: `name`, `description`, `tools`, `commands`, `agents`, `skills`, `whenToUse` — all match character-for-character) |
| `git blame` on the block in fork (`forks/ruflo`) | Author `rUv`, commit `2287d8b616`, date `2026-03-25 20:36:05 +0000` — **upstream commit, no fork modification** |
| Latest commit touching the file in fork | `e047b99f9` (2026-05-03) — codemod string rewrite (`ruflo@latest` → `@sparkleideas/cli@latest`) only; does not alter capability data |
| Other diffs upstream vs fork in this file | ADR-0100 import refactor (centralised `findProjectRoot`) — scaffolding only, does not alter any capability block |

Conclusion: the `hive-mind` capability block in `guidance-tools.ts` is **upstream-canonical and unmodified by the fork**. Citing this block as "what upstream says the skill does" is sound.

#### Correction (2026-05-05): SKILL.md body is also upstream-canonical

An earlier draft of this ADR claimed the skill body at `plugins/ruflo-hive-mind/skills/hive-mind-advanced/SKILL.md` was fork-authored, on the grounds that no `plugins/ruflo-hive-mind/` directory exists in upstream `ruvnet/ruflo`. **That inference was wrong.** The plugin envelope path is fork-only, but the SKILL.md content lives upstream under different paths. Live inventory:

| Path | Lines | Frontmatter | Notes |
|---|---|---|---|
| `~/source/ruvnet/ruflo/.claude/skills/hive-mind-advanced/SKILL.md` | 709 | minimal (`name`, `description`) | Clean URLs |
| `~/source/ruvnet/ruflo/.agents/skills/hive-mind-advanced/SKILL.md` | 712 | rich (`version`, `tags`, `author`) | Corrupted `/` → `$` substitution in URLs/text |
| `~/source/ruvnet/agentic-flow/.claude/skills/hive-mind-advanced/SKILL.md` | 713 | rich (same as `.agents/`) | Clean URLs — closest upstream sibling to fork |
| `~/source/ruvnet/RuVector/.claude/skills/hive-mind-advanced/SKILL.md` | 730 | rich + `hooks:` (RuVector Q-learning) | +4-line "Self-Learning Intelligence" callout |
| `~/source/forks/ruflo/plugins/ruflo-hive-mind/skills/hive-mind-advanced/SKILL.md` | 713 | rich + one `allowed-tools:` line | Clean URLs (corruption fixed) |

All five copies share ~95% identical body content (timestamp "Last Updated: 2025-10-19"). The fork's delta against the closest upstream sibling (`agentic-flow/.claude/skills/...`, 713 lines) is:

1. The plugin envelope path itself (`plugins/ruflo-hive-mind/...`)
2. One `allowed-tools:` frontmatter line
3. Codemod brand-rename `npx claude-flow` → `npx @sparkleideas/cli@latest`
4. Two `/` typo restorations from the corrupted `.agents/` upstream copy

That's the entire fork delta. **The skill body is upstream-canonical**, shipped at 4 upstream paths across 3 upstream repos (`ruvnet/ruflo` × 3, `agentic-flow`, `RuVector`); the fork owns only the plugin packaging and a minor overlay.

The narrowly-true earlier observation — that no `plugins/ruflo-hive-mind/` directory exists in upstream `ruvnet/ruflo` — is about the **plugin envelope path**, not about the **SKILL.md content**. Conflating those two was the source of the original "fork-authored body" claim.

**Conclusion (corrected):** both the registry block AND the skill body are upstream-authored. There is no upstream/fork asymmetry to document. Earlier wording to that effect is hereby retracted.

## Considered Options

* **Pin the upstream guidance registry block as the canonical spec (chosen)** — treat the machine-readable registry as ground truth for what the capability is, with the SKILL.md body as implementation guidance that may be wrong.

(No alternatives were recorded.)

## Decision Outcome

Chosen option: "Pin the upstream guidance registry block as the canonical spec", because the registry is the smallest, most stable, most auditable, machine-readable description of what the hive-mind capability is — and intent must be pinned before any gap analysis can be done without circularity.

### The canonical spec, verbatim

The upstream `guidance_capabilities(area: "hive-mind", format: "detailed")` MCP tool response is:

```json
{
  "name": "Hive Mind Consensus",
  "description": "Queen-led Byzantine fault-tolerant distributed consensus with multiple strategies.",
  "whenToUse": "When multiple agents need to reach agreement on decisions using BFT, Raft, or CRDT.",

  "tools": [
    "hive_mind_init",
    "hive_mind_status",
    "hive_mind_propose",
    "hive_mind_vote",
    "hive_mind_consensus",
    "hive_mind_metrics"
  ],

  "commands": [
    "hive-mind init",
    "hive-mind status",
    "hive-mind consensus",
    "hive-mind sessions",
    "hive-mind spawn",
    "hive-mind stop"
  ],

  "agents": [
    "byzantine-coordinator",
    "raft-manager",
    "gossip-coordinator",
    "crdt-synchronizer",
    "quorum-manager"
  ],

  "skills": [
    "hive-mind-advanced"
  ]
}
```

### Reading the spec

- **Purpose: `whenToUse`.** The capability exists for one stated reason: *"multiple agents need to reach agreement on decisions using BFT, Raft, or CRDT."* This is **consensus-on-a-proposition**, not arbitrary multi-agent coordination. Free-form discussion, dialectic council transcripts, or "have a panel of experts argue" are use cases the registry does **not** claim to cover under this capability — they belong under `swarm-orchestration` per `guidance_recommend`'s priority order.

- **Architecture: 6 MCP tools form the consensus protocol.**
  | Tool | Role per consensus protocol |
  |---|---|
  | `hive_mind_init` | Establish substrate (state.json, queen, topology, consensus algorithm) |
  | `hive_mind_propose` | Submit a proposition to the hive |
  | `hive_mind_vote` | Per-voter ballot |
  | `hive_mind_consensus` | Resolve the vote per chosen algorithm; return the verdict |
  | `hive_mind_status` | Observability — substrate + worker state |
  | `hive_mind_metrics` | Observability — performance + queue depth |
  
  No tool in this list addresses *worker spawning*, *cross-talk between workers*, *broadcast wake-up of workers*, or *transcript composition*. Those concerns are handled either by the CLI (spawn) or by other capability areas (Agent Teams, swarm-orchestration).

- **CLI surface: 6 commands.** The user-visible surface is `init`, `status`, `consensus`, `sessions`, `spawn`, `stop`. Notably absent from the registry's command list: `pause`, `resume`, `metrics` (CLI subcommand), `memory` (CLI subcommand), `metrics --gc`, `import`/`export` — though SKILL.md documents these. The registry's command list is the **declared** surface; CLI may have superset.

- **Agent palette: 5 consensus-protocol agents.** `byzantine-coordinator`, `raft-manager`, `gossip-coordinator`, `crdt-synchronizer`, `quorum-manager`. These are the agents that implement the consensus algorithm itself — Byzantine 2/3 supermajority logic, Raft leader election, Gossip eventually-consistent propagation, CRDT merge, dynamic quorum adjustment. They are **not** worker personas (researcher / coder / etc. — those belong to `agent-management` and `swarm-orchestration`). The hive-mind capability area is the *consensus mechanism*, not the *workforce*.

- **Skills: 1.** `hive-mind-advanced` is the single skill associated with this capability. The skill body lives at `plugins/ruflo-hive-mind/skills/hive-mind-advanced/SKILL.md` in the fork (and at four upstream paths — see §Provenance Correction), and is the procedural guidance an assistant should follow to invoke the consensus mechanism for a real task.

### Origin of the SKILL.md (what it was, and was not, designed for)

Independent research (delegated 2026-05-05) established that the SKILL.md was **never designed as a procedure**. Three pieces of evidence:

1. **Commit `94a80842` (2025-10-20, rUv): `[release] v2.7.0-alpha.11 - Skills System Integration`** — body: *"21 built-in skills via MCP server … Commands → Skills migration … Removed 68 command files (migrated to skills)."*
2. **`v2/docs/development/COMMANDS_TO_SKILLS_MIGRATION.md:132-136`** is explicit: *"9. Hive Mind Advanced Workflows Skill (11+ files → 1 skill) — `/hive-mind/` comprehensive documentation — Multiple coordination patterns. Skill Name: `hive-mind-advanced`."*
3. **`v3/@claude-flow/cli/src/mcp-tools/guidance-tools.ts:1-7`** docblock — the registry's purpose is *"structured discovery of tools, commands, agents, skills, and recommended workflows"*, i.e. a discovery contract, not a procedural spec.

So the SKILL.md is a literal consolidation of 11+ existing command-folder docs into one skill file as part of a 68→21 migration. There never was a procedure to break; the body was always documentation. The registry is canonical for **what counts as in-scope of the capability** (the discovery contract), not for **how the capability behaves end-to-end** — that's a different layer.

### Upstream runtime gap and fork closure

The same research surfaced an upstream tension the registry block hides:

- **`v3/implementation/v3-migration/HIVE-MIND-MIGRATION.md:59-67`** flags V3 Queen responsibilities — *"Strategic decision-making, Agent capability scoring, Consensus initiation, Task stall detection"* — as **"Missing — Needs implementation."**
- The registry block advertises 5 consensus-protocol agents (`byzantine-coordinator`, `raft-manager`, `gossip-coordinator`, `crdt-synchronizer`, `quorum-manager`) plus queen-led coordination, but V3's source admits the Queen was a partial port from V2.

**Fork-side resolution: closed by the ADR-0103 → ADR-0118 program (T1-T14, all complete).** The roadmap in ADR-0103 enumerated six README claims with full TypeScript implementations orphaned in `swarm/src/` and not imported from `cli/src/`. ADR-0118 promoted that into a 14-task tracker; per ADR-0118 §Status table all 14 are `complete`:

| Tn | ADR | Closes |
|---|---|---|
| T1 | ADR-0119 | Weighted consensus (Queen 3× voting power) |
| T2 | ADR-0120 | Gossip consensus protocol |
| T3 | ADR-0121 | CRDT consensus protocol |
| T4 | ADR-0122 | 8 memory types with TTL |
| T5 | ADR-0123 | LRU cache + RVF WAL backend |
| T6 | ADR-0124 | Session checkpoint/resume/export/import |
| T7 | ADR-0125 | Queen-type runtime differentiation (Strategic/Tactical/Adaptive) |
| T8 | ADR-0126 | Worker-type runtime differentiation (8 types) |
| T9 | ADR-0127 | Adaptive topology autoscaling |
| T10 | ADR-0128 | Swarm topology runtime behaviour |
| T11 | ADR-0130 | RVF WAL fsync durability |
| T12 | ADR-0131 | Worker-failure prompt protocol |
| T13 | ADR-0108 | Mixed-type worker spawns (`--worker-types` CLI) |
| T14 | ADR-0132 | Sub-queen failure escalation (hierarchical-mesh) |

So the "registry advertises features V3 doesn't fully implement" tension exists in **upstream** but **not in the fork**. The fork's runtime is a superset of what upstream's V3 ships and matches the registry's declared surface end-to-end.

### What the spec does NOT promise

The registry block is small on purpose. It explicitly does not declare:

- Real-time inter-worker discussion
- Devil's Advocate / dissent / withdrawal mechanics
- A specific council transcript format
- Auto-scaling of workers
- Neural pattern training across sessions
- Multi-round dialectic
- Bridge between Hive-Mind workers and Claude Code's `Agent` tool spawns

Many of these appear in SKILL.md prose. None of them are part of the upstream registry's declared surface. When the SKILL.md and the registry disagree on what the capability does, **the registry is the spec; the skill body is implementation guidance and may be wrong**.

### Consequences

* Good, because a single, citable, upstream-grounded "this is what the capability is supposed to do" record exists. Future ADRs cite this one rather than re-deriving the spec from SKILL.md prose.
* Good, because the provenance check (§Provenance) is a template for future "is this upstream or fork?" questions. Same six-line check works for any capability area.
* Good, because it establishes the precedent that **the registry is the spec; the skill body is implementation guidance**. Resolves prior conflicts where SKILL.md prose diverged from registry data.
* Good, because it anchors all subsequent work — the gap ADR, any skill-rewrite, any ADR documenting fork-side runtime additions — to a fixed reference point that won't shift.
* Bad, because the registry block is intentionally small. Anyone expecting a full behavioural spec from this ADR will be disappointed; the spec is "consensus on a proposition, six tools, six commands, five agents, one skill." Everything beyond that is gap territory.
* Bad, because pinning to the registry gives upstream `ruvnet` veto power over what counts as "in spec." If the fork wants to extend the capability (e.g. add real inter-worker dialectic), that has to be either (a) registered as a fork-side capability extension with its own ADR, or (b) framed as out-of-scope of this capability area entirely.
* Neutral, because the earlier-claimed "upstream owns the registry, fork owns the skill body" asymmetry was retracted in §Provenance after the live inventory check. Both surfaces are upstream-authored. The fork owns only the plugin envelope and a minor overlay — see §Provenance Correction (2026-05-05).

### Confirmation

To re-confirm this ADR's claim that the spec is upstream-canonical, run:

```bash
# 1. Compare upstream and fork hive-mind blocks (should match)
diff \
  <(awk "/'hive-mind':/,/^  },/" \
      ~/source/ruvnet/ruflo/v3/@claude-flow/cli/src/mcp-tools/guidance-tools.ts) \
  <(awk "/'hive-mind':/,/^  },/" \
      ~/source/forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/guidance-tools.ts)
# Expected: no output

# 2. Confirm authorship in fork
git -C ~/source/forks/ruflo blame -L /\'hive-mind\':/,+10 \
  v3/@claude-flow/cli/src/mcp-tools/guidance-tools.ts | head
# Expected: commit 2287d8b616, author rUv, 2026-03-25

# 3. Live MCP query — output should match §Decision
ToolSearch("select:mcp__ruflo__guidance_capabilities")
mcp__ruflo__guidance_capabilities({ area: "hive-mind", format: "detailed" })
```

If any of those drift in future, this ADR is the trigger to either update the spec or open a sup­erseding ADR.

## Rationale

- The upstream guidance registry is the smallest, most stable, machine-readable description of what the hive-mind capability is. It backs four MCP tools (`guidance_capabilities`, `guidance_recommend`, `guidance_quickref`, `guidance_workflow`) that the rest of the system uses for self-description.
- Compared to the SKILL.md, the registry block has been touched only twice: original write (`2287d8b616`) and an unrelated codemod (`e047b99f9`). It is therefore the most auditable source of truth.
- Compared to memory entries documenting empirical behaviour, the registry expresses **intent** — what the substrate was designed to provide. We need both, but intent comes first; gap analysis only makes sense relative to a stated intent.
- Pinning intent now lets us write the gap ADR without circularity (the gap ADR was previously trying to be both the intent record and the gap record at once, which is why it kept drifting toward over-specification).

## Open follow-ups

These are explicitly **out of scope** of this ADR. Each warrants its own follow-up ADR:

1. **Gap analysis ADR.** What does the implementation actually do compared to the spec in §Decision? Cover: (a) `--claude` TTY-inheritance breakage from inside an existing claude session; (b) `mcp__ruflo__hive-mind_memory` hang in sub-agent context (per memory `reference-hive-runtime-crosstalk-pattern.md` iter1); (c) Hive-Mind ↔ Agent-Teams registry bridge gap (per memory `feedback-hive-orchestration-pattern.md`); (d) CLI/MCP schema mismatch — CLI flags `hierarchical-mesh`, `adaptive`, `consensus`, `memoryBackend` accepted at the boundary but not all persisted to `state.json`. Each is a fork-side fix candidate.

2. **SKILL.md rewrite ADR.** The upstream-canonical SKILL.md (713 lines in the fork's overlay copy, mostly feature description) does not function as a procedure for an assistant to follow. The fork-side options are: rewrite it as a real procedure (~80–120 lines, concrete numbered steps that pick working transports and warn about the gaps in §1), or rescope it to "reference card for the registry surface" (drop the orchestration claims). Pick one. Either choice is a fork-side divergence from upstream content (see ADR-0140).

3. **Capability extension ADR (optional).** If the fork wants to formally support free-form inter-worker dialectic / structured council transcripts, that's a new capability area (e.g. `hive-mind-council` or extending `swarm-orchestration`) with its own registry entry. Not a modification of `hive-mind`. Decision: do we want this, and if so, fork-side or upstream PR? (Memory `feedback-no-upstream-donate-backs.md` says fork-side.)

4. **Skill ↔ registry coupling.** Both the registry and the SKILL.md body are upstream-authored (per §Provenance Correction). The fork ships an overlay (plugin envelope + `allowed-tools:` + codemod brand-rename). If upstream bumps the registry's `skills` list or revises the SKILL.md body, the fork's overlay must be re-applied; no automation enforces this today.

## More Information

Original status: Proposed (2026-05-04). Documents the **intended** behaviour of the `hive-mind-advanced` skill / `hive-mind` capability area as defined by upstream `ruvnet/ruflo`. Does **not** describe what the implementation actually does today (gap analysis is deferred to a follow-up ADR — see §Open follow-ups).

This ADR relates to ADR-0114 §Done U5 (council protocol delivery gap), ADR-0131 (worker failure protocol), ADR-0132 (sub-queen failure escalation), ADR-0138 (shipping working council template), memory `feedback-hive-mind-advanced-exists.md` (skill is real, ADRs are fork-side), memory `feedback-hive-orchestration-pattern.md` (designed pattern vs empirical gap), and memory `reference-hive-runtime-crosstalk-pattern.md` (in-repo file-based fallback, validated 2026-05-04).

Scope: One capability area (`hive-mind`) and one skill (`hive-mind-advanced`) as enumerated by upstream `guidance-tools.ts`. Treats the upstream registry as ground truth.
