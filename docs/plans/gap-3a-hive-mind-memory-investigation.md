# ADR-0140 Piece 3a — `hive-mind_memory` sub-agent hang investigation

**Status**: Investigation only — no code changed.
**Date**: 2026-05-04
**Bug**: `mcp__ruflo__hive-mind_memory` hangs ~600s when invoked from inside an Agent-tool sub-agent, gets watchdog-killed. Same tool works from the main thread.

## Suspect code path

| Layer | File | Lines | Role |
|---|---|---|---|
| Tool handler | `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts` | `2769-2929` | `hive-mind_memory` get/set/list/delete; all 4 paths wrap their body in `withHiveStoreLock`. |
| Cross-process lock | same file | `1171-1217` | `withHiveStoreLock` — `O_EXCL` sentinel at `<getHivePath()>.lock`, `MAX_WAIT_MS = 5000`, `STALE_LOCK_MS = 30_000`. After 5s it **throws** `Timeout waiting for hive-state lock`. |
| State load/save | same file | `loadHiveState 1066-1107`, `saveHiveState 1131-1165` | LRU cache in-process, fsync+atomic-rename to `.claude-flow/hive-mind/state.json`. Pure synchronous fs. |
| Project root | `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/types.ts` | `50-73` | `findProjectRoot()` walks up from `CLAUDE_FLOW_CWD ?? process.cwd()`; per-invocation, never cached. |
| MCP transport | `forks/ruflo/v3/@claude-flow/cli/src/mcp-server.ts` | `381-416, 447-560` | Single stdio process for the whole Claude Code session; `process.stdin.on('data', async ...)` dispatches `tools/call` JSON-RPC frames into `callMCPTool` concurrently (no per-message serialization above the lock). |

## Root-cause hypothesis

The 600s figure is Claude Code's per-Agent execution watchdog cap, **not** the fork's lock timeout (which is 5s and throws loudly). That fact alone rules out the obvious "RVF concurrent-write deadlocks" story — if `withHiveStoreLock` were stuck, we'd see a thrown `Timeout waiting for hive-state lock after 5000ms`, not a 600s silent stall.

The handler at lines 2791–2929 is straightforward: validate input → acquire `O_EXCL` sentinel → `JSON.parse(readFileSync(...))` → mutate → `fsync` → atomic rename → release. Nothing in this path can block for 600s without hitting either the 5s `MAX_WAIT_MS` deadline or a synchronous fs error. There is no network I/O, no RVF backend call, no embedding model load — `state.sharedMemory` is plain JSON in `.claude-flow/hive-mind/state.json`.

That leaves the layer **above** the handler. The single shared-stdio MCP server (one subprocess per Claude Code session) handles main-thread and sub-agent `tools/call` frames over the same pipe. Two non-fork-side mechanics are plausible:

1. **Deferred-tool-load deadlock at the Agent boundary.** The user's session uses ToolSearch-deferred MCP tools — sub-agents inherit a different tool-resolution context than the main thread. The 600s stall matches a tool-resolution phase that never receives its `tools/list` response inside the sub-agent's MCP wrapper, not a handler that runs and blocks. The `reference-hive-runtime-crosstalk-pattern.md` file already names this as the working hypothesis.
2. **Stdin pipe contention / framing corruption.** Multiple concurrent sub-agents all calling `mcp__ruflo__hive-mind_memory` concurrently push `tools/call` frames into the same stdin. The server's parser splits on `\n` (line 397) — if any sub-agent's serialized `value` payload contains an embedded newline that the client serializer didn't escape, the buffer parse fails silently (line 408–411 logs to stderr but the response that the sub-agent is awaiting never arrives → 600s watchdog). The fork-side handler is fine; the framing is the choke.

Either way, **the choke point is not in the fork-side handler.** It's in the MCP transport / Claude Code Agent boundary.

## Recommended fix

Three options, ranked.

### Option C (recommended): document the limitation, route sub-agent calls through Bash CLI

Memory `reference-hive-runtime-crosstalk-pattern.md` already documents the working alternative — `npx @sparkleideas/cli@latest hive-mind memory -a set/get` from inside the sub-agent's Bash tool. Each invocation gets its own short-lived process, its own lock-acquire/release lifecycle, and bypasses the shared-stdio MCP path entirely. Validated 2026-05-04 (iter4).

This is what the rewritten SKILL.md (ADR-0140 Piece 1) already prescribes (§Calling Convention, §Cross-talk Transports row (c)). Effort: documentation only, ~0 lines of fork code.

### Option B: bypass — make the MCP handler delegate to a child process

Replace the in-process handler at `hive-mind-tools.ts:2791-2929` with a thin `child_process.spawn('npx', ['ruflo', 'hive-mind', 'memory', ...])` shell. Each MCP call becomes a fresh process, which is exactly what Option C does manually but invisible to the caller. Removes the "DO NOT call from sub-agent" caveat from Piece 1's SKILL.md.

Cost: spawn + Node startup per call (~150-300ms), and the published wrapper's CLI must already be available on PATH (which it is, post-ADR-0143). ~30-60 lines of fork code. Loses the in-process LRU cache benefit.

### Option A (NOT recommended without separate ADR): fix the actual transport

Investigate whether the ToolSearch-deferred-tool resolution or the stdin pipe framing is the real root cause. Likely involves adding request-correlation IDs the handler can use to multiplex, or moving from stdio to HTTP (mcp-server.ts:565-594 already supports HTTP transport).

This is a substantial change with unknown surface area. Not a 100-line fix.

## Verdict

**Not fixable in <100 lines as a true bug fix.** The hang is in the MCP transport / Claude Code sub-agent boundary, not in `hive-mind-tools.ts`. Per Option A, properly diagnosing the framing/deferred-load issue and patching it requires a separate ADR (likely fork + Claude Code coordination).

**However**, Option C (documentation + already-validated Bash-CLI fallback) is **0 lines of fork code** and is already the canonical guidance in ADR-0140's Piece 1 SKILL.md template. Option B (delegating handler) is **~30-60 lines** and removes the user-visible caveat at the cost of per-call latency.

**Recommended posture for ADR-0140 Piece 3a**: ship Option C — document the limitation in the rewritten SKILL.md (already drafted), point sub-agents at `npx ruflo hive-mind memory -a set/get`, and leave the underlying transport bug for a separate future ADR if/when it blocks something Option C can't.
