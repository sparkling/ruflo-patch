# ADR-0146: Substrate-dictated team binding for swarm coordination plugin

- **Status**: **[CLOSED 2026-05-29 → DECLINED; see [[ADR-0270]]]** The substrate-dictated mechanism (swarm MCP handlers emitting `requiredSetup`/`spawnTemplate`) is **declined**: it mutates the shared `swarm_*` MCP return surface (shared with the base swarm skill + upstream) — the boundary the swarm/hive split protects — for nothing the skill layer can't already provide. Team coordination is **already** a swarm capability at the skill layer (`plugins/ruflo-swarm/skills/swarm-init/SKILL.md` — `TeamCreate` + `Agent` + `SendMessage`, per §Context line 24 of this ADR); enriching that prose is a skill-layer enhancement, not a substrate change. **That enrichment LANDED 2026-05-29** (fork `ca6b4c3bf`): `swarm-init` now carries a full Agent-Teams coordination procedure (TeamCreate→spawn-with-`team_name`→SendMessage) + a swarm-vs-hive guardrail ("never team-bind a council"). The §Context "one sentence, no procedure" gap is closed at the right layer. Un-parented from ADR-0140 §Piece 6 (also declined — team comms is a swarm concern, not a hive one). Original status preserved below. — Proposed (2026-05-05). Blocked on ADR-0140 §Piece 6 ratification + first-running validation in fork. Not yet implemented.
- **Date**: 2026-05-05
- **Deciders**: Henrik Pettersen
- **Depends on**: (none — un-parented 2026-05-29; formerly listed ADR-0140 §Piece 6 as the "canonical pattern," but that piece was declined and team-binding is canonically a **swarm** concern, not a hive-derived one. See [[ADR-0270]].)
- **Related**: ADR-0140 (hive-mind-advanced implementation outline), ADR-0114 (substrate/protocol/execution layering), ADR-0145 (research collection — §D1 swarm-vs-hive comparison), ADR-0117 (marketplace MCP server registration)
- **Scope**: Apply the substrate-dictated team binding pattern (defined canonically in ADR-0140 §Piece 6 for hive-mind) to the swarm coordination plugin. Fork-side, per `feedback-no-upstream-donate-backs.md`.

## Context

ADR-0140 §Piece 6 defines a substrate-dictated team binding pattern for the hive-mind coordination plugin: `hive-mind_init` returns `requiredSetup` directives (e.g., `TeamCreate({team_name: hiveId})`); `hive-mind_spawn` returns `spawnTemplate` with `team_name` pre-bound; the queen prompt executes these contracts deterministically. The result: hive workers join a Claude Code team automatically, unlocking 10 of the 15 behaviors gated on `oq()` (i.e. `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`) — `teammate_mailbox` and `team_context` system-reminder injection, `@<name>` resolution, `TaskUpdate` auto-claim, `task_assignment` mailbox messages, etc.

Swarm has the same gap. Per ADR-0145 §D1 (the 15-agent research collection that informed ADR-0140 Piece 1) and a 2026-05-05 follow-up audit:

| Surface | Agent Teams refs |
|---|---|
| `swarm-advanced` SKILL.md (970 lines, the procedural template, 5+ copies fork+upstream) | **0** |
| `swarm-orchestration` SKILL.md (5+ copies) | **0** |
| `flow-nexus-swarm` SKILL.md (5+ copies including agentic-flow) | **0** |
| `v3-swarm-coordination` (4 copies) | 1 — but only a metric checklist line *"Communication Latency: <100ms inter-agent messaging"* (no protocol guidance) |
| `agent-coordinator-swarm-init` | 1 — *"Configures memory namespaces for inter-agent communication"* (memory-as-comms, not Agent Teams) |
| 8 other `agent-{swarm,*}-swarm` skills | **0** each |
| `forks/ruflo/plugins/ruflo-swarm/skills/swarm-init/SKILL.md:16` | 1 — *"Then create a Claude Code team via `TeamCreate` and spawn agents using the `Agent` tool with `isolation: \"worktree\"` for git-safe parallel work. Use `SendMessage` for inter-agent coordination."* (the only substantive reference; one sentence; no procedure) |

So: across 50+ swarm-related SKILL.md files (fork + upstream + agentic-flow + v2 + v3 copies), there is exactly one substantive Agent Teams reference, and it's a single sentence with no procedure, no example, no transport hierarchy, no `team_name` parameter shown on Agent spawn, and no mention of the `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` requirement.

The swarm runtime (per ADR-0145 §D1's reading of `swarm-advanced`) uses `parallel_execute + memory_usage + task_orchestrate` as its coordination primitives. None of these are inter-agent messaging — they're shared-memory and dispatch primitives. Swarm workers spawn without team membership; Agent Teams behaviors are inactive.

The architectural gap is identical to hive-mind's pre-Piece-6 state. The remediation pattern is identical too — only the file paths and substrate identifiers change.

## Decision

Apply the substrate-dictated team binding pattern (defined canonically in ADR-0140 §Piece 6) to the swarm coordination plugin. Specifically:

### 1. Extend swarm MCP handler responses

**File**: `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/swarm-tools.ts`

`swarm_init` handler returns:

```json
{
  "success": true,
  "swarmId": "swarm-...",
  "topology": "...",
  "config": {...},
  "requiredSetup": [
    {
      "tool": "TeamCreate",
      "args": { "team_name": "<swarmId>", "description": "Swarm workforce for <objective>" }
    }
  ]
}
```

`agent_spawn` handler returns:

```json
{
  "success": true,
  "agentId": "<id>",
  "type": "<role>",
  "spawnTemplate": {
    "tool": "Task",
    "argsTemplate": {
      "subagent_type": "<placeholder>",
      "team_name": "<swarmId>",
      "name": "<agentId>",
      "run_in_background": true,
      "prompt": "<placeholder>"
    },
    "perWorker": [
      { "agentId": "<id>", "agentType": "<role>" }
    ]
  }
}
```

**Schema for `requiredSetup` and `spawnTemplate` is identical to ADR-0140 §Piece 6.** Single source of truth across substrates.

### 2. Author fork-side `swarm-advanced` overlay

**Path**: `forks/ruflo/plugins/ruflo-swarm-advanced/skills/swarm-advanced/SKILL.md` (NEW)

The current `swarm-advanced` SKILL.md is upstream-canonical content (970 lines, identical body across upstream copies). Per `feedback-no-upstream-donate-backs.md`, the divergence stays fork-only — so the fork creates a plugin overlay parallel to `plugins/ruflo-hive-mind/`.

Overlay content adopts ADR-0140 §Piece 6's "execute `requiredSetup`; use `spawnTemplate`" instructions, spliced into Pattern 1-4 workflows of the swarm-advanced template. Explicit `Task({team_name})` calls in the source patterns are replaced with templated forms read from `spawnTemplate`.

Plugin manifest at `forks/ruflo/plugins/ruflo-swarm-advanced/plugin.json` (NEW), parallel to the existing `ruflo-hive-mind` plugin manifest. Registered with the marketplace MCP server (per ADR-0117 once that lands; until then, plugin path discovery via `.claude/skills/` overlay).

### 3. Update fork-side `swarm-init` plugin

**File**: `forks/ruflo/plugins/ruflo-swarm/skills/swarm-init/SKILL.md:16`

Replace the existing one-line *"Use SendMessage for inter-agent coordination"* with a procedural reference:

> *"After `swarm_init`, the response includes a `requiredSetup` directive list. Execute each entry (typically `TeamCreate({team_name: swarmId})`) before spawning workers. For worker spawning, use the `spawnTemplate` returned by `agent_spawn` — the `argsTemplate.team_name` is pre-bound to the `swarmId`. See ADR-0140 §Piece 6 for the canonical contract and ADR-0146 for swarm-specific application."*

### 4. Test coverage

**File**: `forks/ruflo/v3/@claude-flow/cli/__tests__/swarm-tools-deep.test.ts` (or equivalent existing test path)

Add `it()` blocks asserting:
- `swarm_init` response includes `requiredSetup` array with at least one `TeamCreate` directive
- `requiredSetup[0].args.team_name` equals the returned `swarmId`
- `agent_spawn` response includes `spawnTemplate` with the canonical shape
- `spawnTemplate.argsTemplate.team_name` equals the parent `swarmId`
- Round-trip: re-invoking `agent_spawn` with the same `swarmId` returns consistent `team_name` in the spawn template

## Sequencing

This ADR is **blocked on ADR-0140 §Piece 6** for two reasons:

1. **Schema stability.** ADR-0140 §Piece 6 defines the canonical schemas for `requiredSetup` and `spawnTemplate`. Implementing them in swarm before they are stable in hive risks two-substrate divergence at the contract level — hard to reconcile after the fact.
2. **Pattern validation.** ADR-0140 §Piece 6 is the proof point. Validate the pattern works end-to-end in production hive sessions before applying it to a second substrate. If Piece 6 surfaces unexpected friction (e.g., `TeamCreate` permission edge cases, `oq()`-off graceful degradation issues), swarm should inherit the fixes, not re-discover the bugs.

Recommended ratification order:
1. ADR-0140 §Piece 6 ratified, implemented, and validated in fork (≥3 successful real council sessions using the `requiredSetup`/`spawnTemplate` path with verified `teammate_mailbox` injection on workers)
2. Then this ADR (ADR-0146) ratified
3. Then swarm implementation lands

## File targets (summary)

| File | Status | Approx LOC |
|---|---|---|
| `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/swarm-tools.ts` | Existing — extend `swarm_init` and `agent_spawn` handler returns | ~50 |
| `forks/ruflo/v3/@claude-flow/cli/__tests__/swarm-tools-deep.test.ts` | Existing or new — 4-6 new `it()` blocks | ~40 |
| `forks/ruflo/plugins/ruflo-swarm-advanced/skills/swarm-advanced/SKILL.md` | **NEW** — fork-side overlay of upstream `swarm-advanced` | ~700-800 |
| `forks/ruflo/plugins/ruflo-swarm-advanced/plugin.json` | **NEW** — plugin manifest | ~30 |
| `forks/ruflo/plugins/ruflo-swarm/skills/swarm-init/SKILL.md` | Existing — replace L16 one-liner with procedural reference | ~10 |

Total: ~830 LOC fork-side. Larger than ADR-0140 §Piece 6 (~135 LOC) primarily because `swarm-advanced` requires a fresh fork overlay (the upstream skill body has to be reproduced or referenced).

## Acceptance criteria

The swarm-side application is "done" when all of:

1. `swarm_init` test asserts `response.requiredSetup` is an array containing a `TeamCreate` directive with `args.team_name` matching the swarmId
2. `agent_spawn` test asserts `response.spawnTemplate.argsTemplate.team_name === swarmId`
3. `swarm-advanced` fork overlay exists at `plugins/ruflo-swarm-advanced/skills/swarm-advanced/SKILL.md`, mirrors upstream procedural shape, and embeds the `requiredSetup`/`spawnTemplate` execution path in Pattern 1-4 workflows
4. `swarm-init` plugin one-liner replaced with procedural reference
5. ≥1 swarm session run end-to-end with the new pattern; verify Agent Teams behaviors active for swarm workers (`team_context` system reminder injects; teammates can `SendMessage` to peers)
6. ≥1 graceful-degradation case verified (run with `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` unset; confirm pattern logs the gap and continues without team binding)
7. Plugin manifest registered with the marketplace MCP server entry

## What this unlocks for swarm

Smaller per-message benefit than hive (swarm coordination is shared-memory-first, not message-passing-first) but real:

| Behavior | Hive value | Swarm value |
|---|---|---|
| `team_context` reminder injection | High (workers need to know hive composition) | High (workers need to know peer roles) |
| `teammate_mailbox` injection | High (queen↔worker handoffs) | Medium (mostly via shared memory today) |
| `@<name>` resolution | Medium | Medium |
| `TaskUpdate` auto-claim + `task_assignment` mailbox | Medium | **High** — swarm Pattern 1 (Research Swarm) has multiple workers grabbing from a task queue; auto-claim is exactly what that pattern needs |
| `SendMessage` between workers | High (council dialectic) | Medium (inter-specialist handoffs in Pattern 2 Development Swarm) |
| Telemetry `team_name` tag | Same | Same |

So swarm gets ~70% of hive's benefit at ~6× the implementation cost (mostly because of the SKILL.md overlay).

## Risks / open questions

1. **Upstream `swarm-advanced` drift.** Upstream may revise the `swarm-advanced` SKILL.md (it's actively maintained per session-log evidence and is referenced by 50+ sister skills). If upstream releases a new version while the fork overlay is in place, manual reconciliation is needed. No automation for this drift today (this is the same skill ↔ registry coupling automation gap noted in ADR-0139 §Open follow-ups item 4 and ADR-0140's Open follow-ups).
2. **Plugin marketplace impact.** Adding `ruflo-swarm-advanced` as a new fork plugin entry is a packaging change; coordinate with marketplace MCP registration (ADR-0117) so the plugin is discoverable. Until ADR-0117 lands, the overlay relies on `.claude/skills/` discovery.
3. **`agent_spawn` is called more frequently than `hive-mind_spawn`.** Swarm patterns may issue dozens of `agent_spawn` calls per session (one per worker). Each one returning a `spawnTemplate` adds bytes to the response. Negligible at expected scales but worth measuring on hot paths (e.g., 10-agent swarm × 4 phase blocks × 4 spawns = 160 spawn calls per session is plausible).
4. **Sister skill follow-on cost.** Once `swarm-advanced` adopts the pattern, the 8+ sibling swarm skills (`swarm-orchestration`, `flow-nexus-swarm`, `v3-swarm-coordination`, the `agent-*-swarm` set) become inconsistent — they still don't reference Agent Teams. Either accept inconsistency (some swarm skills are team-aware, others aren't) OR plan a follow-up to align all of them. Default: accept inconsistency for the initial swarm proof point; address sister-skill alignment in a separate ADR if needed.
5. **Ordering vs ADR-0140 §Piece 6.** This ADR is blocked. If it is ratified or implemented before its prerequisite, that is a process error.

## Promote to own design ADR if

- The schemas for `requiredSetup` and `spawnTemplate` need to diverge between substrates (e.g., topology-aware `spawnTemplate` for swarm vs. a flat one for hive). Currently both should use the same shape; if implementation reveals divergence, document the divergence in this ADR or split into a third ADR.
- A third coordination substrate (beyond hive and swarm) needs the same pattern. At that point, promote the schema definitions out of ADR-0140 §Piece 6 / this ADR into a normative cross-substrate ADR (tentatively ADR-0147+).
- The `swarm-advanced` overlay drifts substantially from the upstream procedural shape (e.g., adopts new patterns not in upstream). At that point, factor out the divergence into its own ADR rather than burying it here.

## Why this ADR exists separately from ADR-0140

Both ADRs apply the same pattern. They are kept separate because:

1. **Different ratification timelines.** ADR-0140 §Piece 6 should ratify and ship before this one. Co-locating them would force them to ratify together.
2. **Different file targets and scope.** ADR-0140's scope is hive-mind only (per its §Scope). Adding swarm to ADR-0140 would re-broaden the ADR after Piece 1 narrowed it.
3. **Different cost profiles.** ADR-0140 §Piece 6 is ~135 LOC; this ADR is ~830 LOC because of the SKILL.md overlay. Different review surfaces.
4. **Cross-reference rather than duplicate.** This ADR cites ADR-0140 §Piece 6 as the canonical pattern definition. Schemas are documented once (in ADR-0140 §Piece 6) and inherited here. If the schemas evolve, both ADRs reference the canonical source.

## References

- ADR-0140 §Piece 6 — canonical pattern definition (hive-mind), the prerequisite for this ADR
- ADR-0145 §D1 — swarm-advanced + sister-skills audit (no Agent Teams integration anywhere)
- ADR-0114 — substrate/protocol/execution layering rationale (substrate owns coordination primitives)
- ADR-0117 — marketplace MCP server registration (relevant for plugin discoverability)
- USERGUIDE L1683 — `Mailbox SendMessage` upstream documentation
- Memory `feedback-no-upstream-donate-backs.md` — divergence stays fork-only
- Memory `reference-ruflo-architecture.md` — orchestrator/executor distinction
