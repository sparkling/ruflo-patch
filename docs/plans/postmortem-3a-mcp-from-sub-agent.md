# Postmortem — ADR-0140 row 3a (`mcp__ruflo__hive-mind_memory` 600s sub-agent stall)

**Date**: 2026-05-04
**Status**: Closed. Original hypothesis refuted in code-reading; corrected diagnosis tested via live reproduction 2026-05-04 — Cause 2 also refuted. Final diagnosis: **Cause 1 only (wrong tool name). Sub-agents CAN call MCP directly when given the correct registered name.** Arm D additionally exposed that the originally-proposed Bash CLI fallback is **structurally broken** (cold-spawn CLI hangs on flock contention against the long-running MCP server) — direct MCP is the only working path.
**Resulted in**: ADR-0140 §"Amendment 2026-05-04 — row 3a closure" (operational rule).
**Council review**: `docs/council/2026-05-04-adr-0144-dialectic-review.md` (5-0 refactor verdict).

## Original symptom (ADR-0140 row 3a draft)

`mcp__ruflo__hive-mind_memory` invoked from inside a Claude-Code-`Agent`-tool sub-agent context hangs ~600s and is watchdog-killed. Same call from the main thread succeeds. Iter1 evidence in `reference-hive-runtime-crosstalk-pattern.md`.

## Original hypothesis (ADR-0140 row 3a draft)

Fork-side bug in the RVF concurrent-write path (per ADR-0133). Severity: high — would block sub-agent cross-talk via collective memory.

## Investigation (four agents, 2026-05-04)

| Agent | Question | Verdict | Report |
|---|---|---|---|
| Initial | Is the fork-side handler the choke point? | **REFUTED** | `gap-3a-hive-mind-memory-investigation.md` |
| H1 | Deferred-tool deadlock at Agent boundary? | **CONFIRMED, with refinement** (see below) | `gap-3a-hypothesis-1-deferred-tool.md` |
| H2 | Stdin framing corruption? | **REFUTED** | `gap-3a-hypothesis-2-stdin-framing.md` |
| Scope | `hive-mind_memory`-specific or transport-wide? | **Transport-wide (inferred)** | `gap-3a-scope-narrowing.md` |

### Why fork code is exonerated

`withHiveStoreLock` (`forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts:1171-1217`) has `MAX_WAIT_MS = 5000` and **throws** `Timeout waiting for hive-state lock after 5000ms` on timeout. A real RVF lock deadlock would surface as a thrown 5s timeout, not a 600s silent stall. The 600s figure matches Claude Code's per-Agent watchdog cap — meaning the response **never arrives**, not that the handler is running and stuck. Handler is innocent.

### Why H2 (stdin framing) was refuted

Same shared-stdio MCP server handles main-thread and sub-agent `tools/call` frames through the same `process.stdin.on('data')` parser (`mcp-server.ts:381-416`). Main-thread multi-line writes don't fail. JSON-RPC 2.0 §5.1 specifies clients escape `\n`. Zero stderr evidence of `Failed to parse message` in any captured log. The hypothesis fails to explain the sub-agent-specific asymmetry.

## Corrected diagnosis (council-revised, 2026-05-04)

Two hypotheses fused into one narrative — each plausible, only one verified mechanically:

### Cause 1 (mechanically verified)

`.mcp.json` registers the MCP server under the key `claude-flow`. Claude Code derives the tool name from the `.mcp.json` key, **not** from the server's internal `serverInfo.name`. So the canonical tool name is `mcp__claude-flow__hive-mind_memory`. The iter1 worker prompt and several memory entries called `mcp__ruflo__hive-mind_memory` — a name that **does not exist** in the registry.

### Cause 2 (proposed, unverified — see "Council mechanical correction" below)

Sub-agents spawned via Claude Code's `Agent` tool inherit a fresh conversation context. The deferred-tool contract requires the tool's JSONSchema (`<function>{...}</function>` block) to be present in the conversation context — loaded via `ToolSearch`. Sub-agents start with **zero** `ToolSearch` loads from the parent. Without the schema block, the deferred MCP tool is named-only.

### Council mechanical correction (Persona A, 2026-05-04)

The original draft claimed: *"a non-existent name dispatches to nothing — the harness never receives a JSON-RPC reply, and the per-Agent watchdog kills at 600s."* This is **wrong as stated**. Per JSON-RPC 2.0 §5.1, a server receiving a request for an unknown method MUST respond with `-32601 Method not found`, sub-millisecond. The fork's MCP server (`mcp-server.ts:497-502`) complies. Therefore:

- If the JSON-RPC frame reached the server, we would observe `-32601` within milliseconds.
- We observe a 600s wait.
- Therefore the JSON-RPC frame **never reached the server**.
- Therefore the stall is **in-harness, pre-dispatch** — Claude Code's harness does not synthesize a JSON-RPC error and does not hand the call to the MCP transport. Different layer, same outcome.

This corrects the §Diagnosis text but does not change the §Decision.

### Persona B framing demotion

The deferred-tool inheritance contract is **observational, not specified** — the evidence is the system prompt's self-reference, not Anthropic-published documentation. **Cause 1 alone is sufficient** to explain the symptom; **Cause 2 is co-stated, not co-validated**. The investigation never tested `mcp__claude-flow__hive-mind_memory` (correct name) from a sub-agent — without that arm, we cannot distinguish "wrong-name only" from "wrong-name + missing-schema both contributing."

## Live reproduction (Persona C's matrix — executed 2026-05-04)

The discriminating call is **Sub-agent B**: invoke `mcp__claude-flow__memory_store` (correct registered name) from a sub-agent with **no `ToolSearch` preamble**. Three arms ran in parallel:

| Arm | Setup | Result | Time |
|---|---|---|---|
| A (skipped — covered by iter1 evidence) | Wrong name (`mcp__ruflo__*`), no preamble | iter1: 600s watchdog | n/a |
| **B (discriminator)** | Correct name (`mcp__claude-flow__memory_store`), **no preamble** | **✅ SUCCESS — `{success: true, stored: true, storeTime: "30.51ms"}`** | <1s wall-clock |
| C (escape hatch) | `ToolSearch("select:mcp__claude-flow__memory_store")` then invoke | ✅ SUCCESS — same response shape | ~1-2s wall-clock |
| D first attempt (Bash CLI) | Loose-prompted sub-agent runs `npx ... memory store` | ❌ Drift (retry loop, 13 tool calls, no clean result) | ~110s |
| D rerun (disciplined) | Strict-prompted sub-agent runs `npx ... memory store` | ❌ Hung mid-store ("Storing in experiment/..." / no EXIT line) | ~130s |
| **D direct (main thread)** | Same `npx ... memory store` from main thread, no sub-agent | **❌ Hangs identically** — `lsof memory.rvf.lock` shows running MCP server (PID 23302, 1h39m) holds `flock(LOCK_EX)`; cold-spawn CLI (PID 12574) waits forever | killed at 90s wrapper timeout |

**Arm B fired branch (ii)** of the predicted outcomes: "A hangs, B works → Cause 2 refuted; rule collapses to 'use correct tool name.'" Sub-agent harness dispatched the call cleanly with no schema-injection preamble; the server replied in 30ms with a real success payload, including embedding generation (768-dim, SQLite + HNSW backend).

### What this means

- The original ADR-0144 §"Cause 2" (deferred-tool inheritance gap across the Agent boundary) is **fiction**. Sub-agents inherit enough context to dispatch deferred MCP tools directly.
- The **transport-class rule** (Bash CLI from sub-agents) was unnecessary for the originally claimed reason. It was solving a problem that didn't exist.
- The actual fix is **tool-name correctness**, not transport selection. Implementing ADR-0117 (dual-namespace registration) makes both `mcp__ruflo__*` and `mcp__claude-flow__*` resolve, retroactively making iter1-style worker prompts work.
- **Bash CLI is NOT a viable fallback** in projects with a running MCP server — it deadlocks on flock contention against the long-running server. macOS `flock(2)` is per-OFD; the server holds `LOCK_EX` for the session lifetime; cold-spawn CLI subprocesses can't acquire the lock and (in the published `@sparkleideas/cli`, which lacks a flock acquisition timeout) wait forever. Reserve Bash CLI for environments without a running MCP server (CI scripts, cron jobs, daemon-less smoke tests).
- The bounded-wait flock fix in ruvector commit `38191e27e` (sparkling/main, **unpublished**) would make the cold-spawn fail loud at 30s instead of hanging — but that's a fail-loud safety net, not a fix to the underlying contention.

### Adjacent observability that wasn't needed

The plan included tailing `mcp-server.ts` stderr during arms A and B. Arm B's clean success made that unnecessary — the server received and replied to the call, evidence enough that Cause 2 was wrong.

## Outstanding (not closed by this postmortem)

- **`mcp-server.ts:408-413` parse-error swallow** — the server logs JSON-RPC parse failures to stderr only and does NOT send the spec-required `-32700 Parse error` reply. Latent defect, separate ticket.
- **Memory drift cleanup** — sweep `mcp__ruflo__hive-mind_memory` → `mcp__claude-flow__hive-mind_memory` across `~/.claude/projects/.../memory/`. Documentation hygiene; becomes a no-op once ADR-0117 lands.
- **ADR-0117 dual-namespace — RECOMMENDED.** Implementing this closes the iter1 symptom at the source: registering the marketplace MCP server under `ruflo` makes `mcp__ruflo__*` resolve to the same handlers as `mcp__claude-flow__*`. Combined with arm B's confirmation that direct MCP works from sub-agents, the original 600s stall scenario vanishes entirely without any worker-contract policing.

## What changed in the codebase as a result

- **ADR-0140 §"Piece 3" updated**: row 3a marked SUPERSEDED, row 3b documented (`b9421bad0`), row 3c shipped (`b7181aa89`, `@sparkleideas/cli@3.5.58-patch.351`).
- **Adjacent substrate hardening**: ruvector `crates/rvf/rvf-runtime/src/locking.rs` got bounded-wait flock acquisition (`38191e27e`). Surfaced incidentally during deduplication of test coverage.
- **`scripts/test-runner.mjs` per-test timeout** added (120s) — proximate enabler of the silent 30-min release abort that made the rvf-runtime issue debuggable.
- **`tests/unit/adr0086-rvf-integration.test.mjs`** — Group 6 + Group 7 deleted (cross-process race covered by acceptance `check_t3_2_rvf_concurrent_writes`; in-process variant was deadlock-prone by bypassing the factory it claimed to test).

## What did NOT change

- No fork code change for row 3a itself. The transport-class rule is documentation, not a substrate fix.
- ADR-0133 (RVF concurrent-write) was implicated but ruled out as the cause. Its surface is unchanged.
- Claude Code's Agent tool deferred-tool inheritance behaviour is unchanged — the rule lives in fork-side worker-contract templates, not in the harness.

## References

- ADR-0140 §"Piece 3" + §"Amendment 2026-05-04 — row 3a closure"
- ADR-0144 (now Superseded — kept for audit trail)
- `docs/council/2026-05-04-adr-0144-dialectic-review.md` (5-0 council vote)
- `docs/plans/gap-3a-{hive-mind-memory-investigation,hypothesis-1-deferred-tool,hypothesis-2-stdin-framing,scope-narrowing}.md`
- Memory `reference-hive-runtime-crosstalk-pattern.md` (iter1 evidence + iter4 Bash-CLI validation)
