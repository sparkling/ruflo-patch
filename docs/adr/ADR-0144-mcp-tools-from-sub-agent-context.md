---
status: superseded
date: 2026-05-04
tags: [mcp, hive-mind, sub-agent, transport]
supersedes: []
depends-on: []
implements: []
---

# MCP tools from Agent-tool sub-agent context — diagnosis, contract, mitigation

## Context and Problem Statement

> **SUPERSEDED 2026-05-04** by **ADR-0140 §"Amendment 2026-05-04 — row 3a closure"**.
>
> A 5-persona dialectic council (`docs/council/2026-05-04-adr-0144-dialectic-review.md`) voted **5-0 refactor**: dissolve this ADR back into ADR-0140 as an Amendment, move the four-agent investigation to `docs/plans/postmortem-3a-mcp-from-sub-agent.md`.
>
> **The §Decision (transport-class rule) was subsequently RESCINDED** — Persona C's 4-arm reproduction ran 2026-05-04 and refuted both halves of the original prescription:
>
> - **Arm B refuted Cause 2** (deferred-tool inheritance gap). A sub-agent invoked `mcp__claude-flow__memory_store` directly with no `ToolSearch` preamble — call dispatched cleanly, server replied in 30ms. The "sub-agents can't call MCP" claim was wrong.
> - **Arm D revealed the prescribed Bash CLI fallback is structurally broken.** Cold-spawn `npx @sparkleideas/cli memory store` deadlocks on flock contention against the long-running MCP server (`lsof memory.rvf.lock` confirms: PID 23302 = MCP server holds `LOCK_EX`; cold-spawn waits forever). Reproducible from main thread too — not a sub-agent issue. macOS per-OFD flock + no acquisition timeout in the published CLI = silent indefinite hang. The "use Bash CLI" rule didn't even work.
>
> **Final diagnosis: Cause 1 only (wrong tool name in iter1 — `mcp__ruflo__*` was never registered).** Recommended remediation: **implement ADR-0117** (dual-namespace registration) so `mcp__ruflo__*` and `mcp__claude-flow__*` both resolve. After that, the iter1 symptom vanishes without any worker-contract changes — and direct MCP from sub-agents is the working path (arm B confirmed). Bash CLI fallback is reserved for MCP-less environments (CI scripts, daemon-less smoke tests).
>
> **Read the Amendment + postmortem for the current authoritative content.** This file is retained for audit trail.

ADR-0140 cited a concrete runtime gap: `mcp__ruflo__hive-mind_memory` invoked from inside a Claude-Code-`Agent`-tool sub-agent context **hangs ~600s, then is watchdog-killed**. The same call from the main thread succeeds. The gap was hypothesised to be a fork-side bug in the RVF concurrent-write path (per ADR-0133).

A four-agent investigation (2026-05-04) refutes that hypothesis and reframes the symptom.

### Investigation summary (four agents, all read-only)

| Agent | Question | Verdict |
|---|---|---|
| Initial | Is the fork-side handler the choke point? | **REFUTED.** `withHiveStoreLock` has `MAX_WAIT_MS = 5000` and **throws** loudly. A real lock deadlock surfaces as `Timeout waiting for hive-state lock after 5000ms`, not a 600s silent stall. The 600s figure matches Claude Code's per-Agent watchdog cap — meaning the response **never arrives**, not that the handler is running and stuck. |
| H1 (deferred-tool deadlock) | Is the choke at the Agent-boundary tool-resolution layer? | **CONFIRMED** with refinement (see §Diagnosis). |
| H2 (stdin framing corruption) | Is the choke at the shared-stdio MCP server's `\n`-delimited frame parser? | **REFUTED.** One parser handles main-thread + sub-agent frames identically. Main-thread multi-line `value` writes don't fail. JSON-RPC clients escape `\n`. Zero stderr evidence of `Failed to parse message`. No asymmetry the hypothesis can explain. |
| Scope | Is this `hive-mind_memory`-specific, namespace-specific, or transport-wide? | **Transport-wide.** All `mcp__claude-flow__*` tools share the same client code path and the same deferred-load contract. Bash CLI works because it's a built-in (non-deferred) tool reaching the same fork handlers via fresh subprocess. |

Reports persisted at:
- `docs/plans/gap-3a-hive-mind-memory-investigation.md`
- `docs/plans/gap-3a-hypothesis-1-deferred-tool.md`
- `docs/plans/gap-3a-hypothesis-2-stdin-framing.md`
- `docs/plans/gap-3a-scope-narrowing.md`

### Diagnosis (validated)

Two compounding causes converge on the watchdog stall:

#### Cause 1 — Tool-name mismatch in the registered MCP namespace

`.mcp.json` registers the MCP server under the key `claude-flow`. Claude Code derives the tool name from the `.mcp.json` key, **not** from the server's internal `serverInfo.name` (`mcp-server.ts:367,471`). Therefore the canonical tool name is:

```
mcp__claude-flow__hive-mind_memory       ← actually registered
```

The iter1 worker prompt and several memory entries called:

```
mcp__ruflo__hive-mind_memory             ← never registered in this session
```

A non-existent name dispatches to nothing — the harness never receives a JSON-RPC reply, and the per-Agent watchdog kills at 600s.

(ADR-0117, when implemented, will register the marketplace MCP server under the `ruflo` key in `.mcp.json` and create dual `claude-flow` + `ruflo` namespaces. Until then, only `mcp__claude-flow__*` works.)

#### Cause 2 — Deferred-tool inheritance across the Agent boundary

Even with the correct tool name, sub-agents spawned via Claude Code's `Agent` tool inherit a fresh conversation context. The deferred-tool contract requires the tool's JSONSchema to be present in the conversation context (loaded via `ToolSearch`) before the harness can dispatch. Sub-agents start with **zero** `ToolSearch` loads from the parent. Without the schema block, the deferred MCP tool is named-only — invoking it produces the same dispatch failure as Cause 1 (no reply → 600s watchdog).

This is by design: 200+ MCP tools cannot be eagerly loaded into every conversation context without exhausting the budget. Per-context loading is the deliberate tradeoff.

### Why ADR-0140's original 3a fix path doesn't apply

ADR-0140 §"Piece 3 row 3a" listed three remediation options:
- (A) fix the actual transport
- (B) wrap `hive_mind_memory` handler with `child_process.spawn`
- (C) document the limitation; route sub-agents through Bash CLI

(A) targets a transport bug that does not exist in the form claimed (no parser bug, no lock deadlock).
(B) would fix one tool (`hive_mind_memory`) and leave 200+ other `mcp__claude-flow__*` tools still unreachable from sub-agent context for the same reasons. Wrong granularity.
(C) is generally correct but the `npx ruflo hive-mind memory ...` path it documented assumes the tool name was right and a transport fix would otherwise be possible. Both assumptions need updating.

## Considered Options

* **Adopt a transport-class rule for sub-agent ↔ MCP-tool interactions, not a per-tool patch (chosen at proposal time; later rescinded — see superseded note).**
* **ADR-0140 Option B — wrap `hive_mind_memory` handler with `child_process.spawn` (rejected)** — would fix one tool out of 200+. Wrong granularity.

(No other alternatives were recorded.)

## Decision Outcome

Chosen option: "Adopt a transport-class rule", because it applies uniformly to all 200+ MCP tools instead of being a per-tool patch — though this decision was subsequently rescinded after the 4-arm reproduction (see the superseded note at the top of this ADR and ADR-0140's Amendment).

Adopt a **transport-class rule** for sub-agent ↔ MCP-tool interactions, not a per-tool patch.

### Rule (worker-contract template, plugin SKILL.md, repo memory)

> Sub-agents spawned via Claude Code's `Agent` tool MUST NOT invoke `mcp__claude-flow__*` (or `mcp__ruflo__*` once ADR-0117 lands) tools directly. The deferred-tool contract requires JSONSchemas in the sub-agent's conversation context, which the parent does not transparently inject.
>
> Instead:
> - **For state changes** that need the substrate (hive memory, swarm coordination, agent registry): the sub-agent invokes `Bash("npx @sparkleideas/cli@latest <command> ...")`. The CLI runs the same handler in a fresh subprocess with its own RVF lock lifecycle.
> - **If a sub-agent absolutely needs direct MCP**: the sub-agent's first tool call MUST be `ToolSearch("select:mcp__claude-flow__<name>")` — this loads the schema into the sub-agent's context. The MCP call follows. This path is fragile across Claude Code versions; prefer Bash CLI.
>
> The queen (main thread) calls MCP tools directly — that is the validated working path. The asymmetry is structural, not a bug.

### What lands where

| Surface | Change |
|---|---|
| `forks/ruflo/plugins/ruflo-hive-mind/skills/hive-mind-advanced/SKILL.md` (when rewritten per ADR-0140 Piece 1) | §"Calling Convention" already states this; **add an explicit "ADR-0144 contract"** sub-heading with the rule body verbatim, plus the `mcp__claude-flow__*` vs `mcp__ruflo__*` note pointing at ADR-0117. |
| `forks/ruflo/plugins/ruflo-hive-mind/skills/hive-mind-advanced/templates/worker-contract.md` (when authored per ADR-0140 Piece 2) | Lead with the rule. The 7-step recipe in the template assumes Bash CLI for cross-talk transport (b) and (c). |
| ruflo-patch memory entries currently citing `mcp__ruflo__hive-mind_memory` | Update to `mcp__claude-flow__hive-mind_memory` (or add a second-name reference once ADR-0117 lands). Files affected: `reference-hive-runtime-crosstalk-pattern.md` (lines 96, 166, 216 per H1 agent's audit). |
| `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts` | **No code change.** The handler is correct. ADR-0140 row 3a previously implied a fork-side fix; this ADR closes that row with "no fork code change required." |

### What this ADR explicitly does NOT do

- Does **not** add a `child_process.spawn` wrapper around any MCP handler (ADR-0140 Option B). Wrong granularity — would fix one tool out of 200+.
- Does **not** open a Claude Code platform issue to expose deferred-tool injection across the Agent boundary. Possible future work; out of scope here.
- Does **not** modify the MCP transport (`mcp-server.ts:381-416`). H2 refuted no parser bug; existing transport is correct.
- Does **not** reproduce the failure interactively. The cumulative evidence (H1's tool-name+deferred-load reasoning + H2's clean refutation + Scope's transport-wide inference + iter4's validated Bash CLI path) is sufficient to act on, but a future small reproduction would harden the diagnosis. **Open follow-up.**

### Consequences

* Good, because it closes ADR-0140 row 3a with a validated diagnosis, not a fork-side bug fix.
* Good, because it establishes a **transport-class rule** that applies uniformly to all 200+ MCP tools instead of a per-tool patch path.
* Good, because it removes the false framing that this is an RVF / ADR-0133 regression. ADR-0133's surface is unchanged.
* Good, because it cleans up memory drift: aligns `reference-hive-runtime-crosstalk-pattern.md` and worker-contract templates with the actually-registered tool name.
* Bad, because sub-agents pay ~150-300ms Node startup per Bash-CLI MCP-equivalent call (vs in-process MCP). Acceptable cost given the stability gain.
* Bad, because the "first ToolSearch then call" escape hatch exists but is fragile — depends on future Claude Code Agent-tool deferred-load behaviour staying consistent. Not the primary recommendation.
* Neutral, because the documentation footprint is small: SKILL.md gains a §"ADR-0144 contract" block; worker-contract template leads with the rule; one memory entry gets updated. No code changes.

### Confirmation

```bash
# 1. The contract is documented in the rewritten SKILL.md (ADR-0140 Piece 1)
grep -c "ADR-0144" forks/ruflo/plugins/ruflo-hive-mind/skills/hive-mind-advanced/SKILL.md
# Expected: ≥ 1 (referenced in §Calling Convention or §ADR-0144 contract)

# 2. Worker-contract template prescribes Bash CLI for cross-talk transport b/c
grep -cE "Bash.*npx.*@sparkleideas/cli|npx ruflo " \
  forks/ruflo/plugins/ruflo-hive-mind/skills/hive-mind-advanced/templates/worker-contract.md
# Expected: ≥ 1

# 3. Memory drift fixed — no remaining bare `mcp__ruflo__hive-mind_memory` refs
grep -rE "mcp__ruflo__hive-mind_memory" \
  ~/.claude/projects/-Users-henrik-source-ruflo-patch/memory/
# Expected: 0 matches once memory updated, OR all matches accompanied by an
# ADR-0117 cross-reference noting the dual namespace.

# 4. The Bash-CLI fallback works from a real sub-agent (manual smoke)
#    Spawn a sub-agent via the Agent tool with this prompt:
#      'Run Bash("npx @sparkleideas/cli@latest hive-mind memory -a get -k test")
#       and report the exit code.'
#    Expected: sub-agent returns within seconds, NOT after 600s watchdog.

# 5. ADR-0140 row 3a marked closed/superseded by this ADR
grep -A 3 "row 3a\|3a " docs/adr/ADR-0140-hive-mind-advanced-implementation-outline.md
# Expected: row 3a annotated "see ADR-0144" or marked superseded.
```

## Latent defect surfaced (separate from this ADR)

H2 noted that `mcp-server.ts:408-413` swallows JSON-RPC parse errors with stderr-only logging — it does **not** send the spec-required `-32700 Parse error` reply back to the client. The shared transport at `@claude-flow/shared/src/mcp/transport/stdio.ts:198` does the right thing (`sendError(null, -32700, ...)`). This is a real (small) defect but unrelated to the sub-agent hang. **Track separately** as ADR-0145 or a focused fix; out of scope here.

## Adversarial review acknowledgement

A formal adversarial review (this session, 2026-05-04) raised eight concerns. The strongest two:

1. **No live reproduction was run.** All four investigations were code-reading; no agent invoked a deferred MCP tool from a sub-agent and observed the failure mode in the current Claude Code regime. The diagnosis is well-reasoned but not empirically re-confirmed in this conversation. Mitigation: see Open follow-ups.
2. **Scope verdict ("transport-wide, 200+ tools") is inference.** The scope agent extrapolated from `hive-mind_memory` to all `mcp__claude-flow__*` tools without testing adjacent tools. Plausible but unverified.

These are accepted limitations. The contract proposed (Bash CLI from sub-agents) is robust regardless of whether the diagnosis is exactly right at the platform layer — it sidesteps the deferred-tool contract entirely. So the prescription stands even if the precise mechanism is partially wrong.

## Open follow-ups

1. **Live reproduction.** Spawn one sub-agent via `Agent`, instrument it to call (a) `mcp__claude-flow__hive-mind_memory` with no preamble, (b) `mcp__claude-flow__hive-mind_memory` after a `ToolSearch` preamble, (c) `Bash("npx ... hive-mind memory ...")`. Observe which paths watchdog. Confirms or contradicts §Diagnosis empirically. ~5 minute task; do before publishing this ADR as Accepted.
2. **Latent defect.** Track `mcp-server.ts:408-413` parse-error swallowing as ADR-0145 or a small focused fix.
3. **Memory updates.** Sweep for `mcp__ruflo__hive-mind_memory` and adjacent miscitations once ADR-0117 lands; bridge to dual-namespace.
4. **ADR-0140 closure.** Annotate row 3a in ADR-0140 with "superseded by ADR-0144." Remediation list reduces from {3a, 3b, 3c} to {3b documented, 3c shipped, 3a re-classified as documentation contract}.
5. **Agent-tool deferred-tool injection.** Long-term: Claude Code's `Agent` tool API does not expose a way to inject MCP tool schemas into a spawned sub-agent's prompt. If/when that lands, revisit the "first ToolSearch then call" escape hatch and consider promoting it to canonical.

## More Information

Original status: Superseded by ADR-0140 §"Amendment 2026-05-04 — row 3a closure" (2026-05-04). Original status was Proposed; never advanced past Proposed before refactor.

This ADR was framed at proposal time as superseding ADR-0140 §"Piece 3" row 3a — keeping ADR-0140 as the strategic plan for `hive-mind-advanced` and treating this ADR as the operational diagnosis + remediation for sub-agent → MCP-tool calls. The relation later inverted: ADR-0140's Amendment supersedes this ADR after the 4-arm reproduction rescinded its transport-class rule.

This ADR relates to ADR-0117 (marketplace MCP server registration under the `ruflo` key — separate but adjacent: changes the canonical tool name and resolves part of the symptom history), ADR-0133 (RVF concurrent-write boundary — initially suspected; ruled out as the cause of this specific symptom), memory `reference-hive-runtime-crosstalk-pattern.md` (empirical iter1 observation + iter4 Bash-CLI validation), and memory `feedback-hive-orchestration-pattern.md` (designed-vs-empirical pattern).
