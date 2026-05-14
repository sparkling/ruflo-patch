# Gap 3a — Hypothesis 1 (deferred-tool-load deadlock at Agent boundary)

**Verdict:** **CONFIRMED** as the most likely root cause of the 600s sub-agent hang. The hang is not a fork-side bug — it is a Claude Code client-side tool-resolution behaviour interacting with how sub-agents are prompted.

## Evidence

### 1. Fork side has no deferred mechanism — eager registration

`forks/ruflo/v3/@claude-flow/cli/src/mcp-client.ts:60-104` — `TOOL_REGISTRY` is a plain `Map` populated at module load with every tool array (`hiveMindTools`, `agentdbTools`, etc.). `hasTool` (`:230-232`), `listMCPTools` (`:205-222`), and `callMCPTool` (`:144-171`) are pure synchronous lookups — no lazy load, no schema fetch, no per-call init. There is no state that "could be unset in sub-agent context" because the server is one process serving the whole Claude Code session; the registry is identical for every caller.

`mcp-server.ts:479-491` returns the full tool list in one `tools/list` response. `:493-523` dispatches `tools/call` directly via `callMCPTool` with no caching layer.

Conclusion: nothing on the fork side discriminates between main-thread and sub-agent callers. The hang is upstream of the JSON-RPC pipe.

### 2. The tool name in the iter1 hang report doesn't exist in this session

`.mcp.json:3` registers the server under key `claude-flow`, so tools surface as `mcp__claude-flow__*` (confirmed in this session's deferred-tool list — see `mcp__claude-flow__hive-mind_memory`). The user's prompt and `reference-hive-runtime-crosstalk-pattern.md:96-99,166-172` repeatedly say "`mcp__ruflo__hive-mind_memory`". **That literal name is not registered on the client.** A sub-agent instructed to call `mcp__ruflo__hive-mind_memory` would either (a) trigger a ToolSearch lookup that returns nothing, or (b) attempt to invoke a name the harness can't dispatch.

### 3. Deferred-tool contract requires schema in prompt context

This session's system prompt explicitly states deferred tools "appear by name in `<system-reminder>` messages... Until fetched, only the name is known — there is no parameter schema, so the tool cannot be invoked." Sub-agents spawned via the `Agent` tool inherit a **fresh** prompt context — they don't carry the parent's `<function>` blocks loaded from prior `ToolSearch` calls. If the worker contract (e.g. iter1 prompt) tells the agent to call `mcp__ruflo__hive-mind_memory` directly, the agent has neither the schema nor the correct name and will block until watchdog (~600s).

### 4. Bash-CLI fallback works because it bypasses the deferred-tool layer entirely

`reference-hive-runtime-crosstalk-pattern.md:135-158` documents that `npx @sparkleideas/cli@latest hive-mind memory ...` from sub-agent Bash works reliably (validated iter4). Bash is a built-in non-deferred tool — no schema fetch needed — and the CLI invocation reaches the same `hive-mind-tools.ts` handler via a fresh process. Same handler, different transport, no hang. This is a clean A/B that isolates the failure to the deferred-MCP-tool client path, not the handler.

## Where the fix lands

**Not the fork.** The handler at `hive-mind-tools.ts:2842-2929` is fine. Three tractable fixes, all client-side:

1. **Worker-contract template (cheapest, already partially done)** — explicitly forbid `mcp__*` tool calls from sub-agents, mandate the Bash-CLI path. `reference-hive-runtime-crosstalk-pattern.md:216` already says "Do NOT load mcp__ruflo__* tools." This guidance needs to land in ADR-0140 Piece 1 SKILL.md (which the prior investigation says is already drafted).

2. **Sub-agent prompt prefix** — when the parent spawns an Agent that legitimately needs an MCP tool, the parent must perform `ToolSearch("select:<exact-tool-name>")` and embed the resulting `<function>` block into the worker prompt. This is the only way a sub-agent can natively call a deferred MCP tool. The correct name is `mcp__claude-flow__hive-mind_memory` — not `mcp__ruflo__*`.

3. **Option B from the prior investigation** (delegate handler to child process) becomes unnecessary if (1) is enforced — sub-agents shell out via Bash anyway.

## What this rules out

- Fork-side concurrent-write deadlock — `withHiveStoreLock` would throw at 5s, not stall at 600s (`hive-mind-tools.ts:1171-1217`).
- Stdin framing corruption — would fail symmetrically on main-thread calls too; main-thread calls work.
- Per-tool lazy schema in fork — doesn't exist (mcp-client.ts:60-104).

## Residual uncertainty

The exact dispatch behaviour when a sub-agent emits a tool call for a name the harness can't resolve (silent drop vs. timeout vs. error) is Claude Code internal — not directly verifiable from this repo. But the asymmetry between main-thread success and sub-agent 600s timeout, combined with the wrong tool name in the iter1 prompt and the eager fork-side registry, is sufficient to attribute the hang to the deferred-tool client boundary rather than the fork.
