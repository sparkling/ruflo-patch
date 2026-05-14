# Gap 3a — Scope Narrowing: is the hang `hive-mind_memory`-specific, namespace-specific, or transport-wide?

**Status**: Read-only archaeology. No tools invoked.
**Date**: 2026-05-04

## Verdict

**Transport-wide.** The hang is a Claude Code deferred-tool-load behavior at the Agent-tool sub-agent boundary, not a property of `hive-mind_memory`, the `hive-mind_*` namespace, or the fork-side handler. Any `mcp__claude-flow__*` tool name dropped into a sub-agent prompt without prior `ToolSearch` schema-load in that sub-agent's own context will exhibit the same 600s watchdog stall.

## Tool surface (fork side, single shared stdio server)

`forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/index.ts` re-exports 22 tool arrays into one server (`mcp-server.ts`, single `process.stdin.on('data', ...)`). All `mcp__claude-flow__*` tools share one transport, one registry (eager `Map` in `mcp-client.ts:60-104`), one dispatcher. There is no per-tool deferred mechanism on the fork side. The `withHiveStoreLock` 5s/throw path is unique to `hive-mind-tools.ts` but would surface as a thrown error within seconds, not a 600s silent stall — it is not the cause.

## Evidence-by-tool

### (a) Confirmed working from sub-agent
- **Bash** (built-in, not MCP/deferred) — validated iter4 2026-05-04 via `npx @sparkleideas/cli@latest hive-mind memory -a set/get` from sub-agents (`reference-hive-runtime-crosstalk-pattern.md:135-158`). Same `hive-mind-tools.ts` handler reached via fresh CLI subprocess; bypasses the deferred-MCP path entirely.
- **Write/Read** (built-in core tools) — validated iter2/iter3 file-based cross-talk works.

### (b) Confirmed hanging from sub-agent
- **`mcp__ruflo__hive-mind_memory`** — iter1 2026-05-04, all 3 sub-agents stalled 600s, watchdog-killed (`reference-hive-runtime-crosstalk-pattern.md:96-99,166-172`). Note: that literal name (`mcp__ruflo__*`) is **not registered** in this session's `.mcp.json` (key is `claude-flow`, surfacing as `mcp__claude-flow__*`) — see `gap-3a-hypothesis-1-deferred-tool.md` §2. The hang is consistent with a sub-agent attempting to dispatch a deferred tool whose schema was never loaded in its own prompt context.

### (c) Untested but mechanistically equivalent
Every other tool in `mcp__claude-flow__*` (200+ tools across `agentTools`, `memoryTools`, `swarmTools`, `coordinationTools`, `agentdbTools`, `hooksTools`, `embeddingsTools`, etc.) shares the same client code path. The deferred-load contract (system prompt: "Until fetched, only the name is known — there is no parameter schema, so the tool cannot be invoked") applies uniformly. No reason to expect `memory_store`, `swarm_init`, or any other MCP tool to behave differently from a sub-agent that has not run `ToolSearch select:<name>` in its own context.

The historical note in `reference-hive-pre-regression-pattern.md` that `mcp__ruflo__memory_search` was "blocked" in a `npx ... --claude` subprocess corroborates the broader scope, though that case is permission-inheritance not deferred-load.

## A→B comparison

| Path | Transport | Schema needed in caller context | Status from sub-agent |
|---|---|---|---|
| `mcp__claude-flow__hive-mind_memory` | stdio JSON-RPC, deferred client tool | YES (ToolSearch first) | hangs 600s |
| `Bash("npx ruflo hive-mind memory -a set ...")` | child_process to fresh CLI | NO (Bash is built-in) | works |
| `mcp__claude-flow__memory_store` (etc.) | same as hive-mind_memory | YES | untested but same code path → same expected hang |

The Bash CLI talks to the **same handler** through a different process. Same fork code, different client surface. This A/B isolates the fault to the Claude Code deferred-MCP client path crossing the Agent-tool boundary — independent of which `mcp__claude-flow__*` tool is targeted.

## Implications for the recommended fix

Option C from `gap-3a-hive-mind-memory-investigation.md` (document the limitation; route sub-agent calls through Bash CLI) **must be generalized**. The SKILL.md guidance "do NOT load `mcp__ruflo__*` tools from sub-agent context" is correct as written; it should NOT be narrowed to only `hive-mind_memory`. Specifically:

1. The Piece-1 SKILL.md already says "do NOT load mcp__ruflo__* tools" (plural) — keep it that way; do not regress to a hive-mind_memory-only caveat.
2. Any cross-talk pattern that wants to use ruflo MCP tools from sub-agents must either (a) pre-emit the relevant `ToolSearch` calls inside the sub-agent's own prompt, or (b) route through `Bash("npx @sparkleideas/cli@latest ...")` to the equivalent CLI subcommand. There is no `hive-mind_memory`-specific workaround needed.
3. Option B (handler delegating to `child_process`) would only fix one tool and leaves the broader transport-wide bug unaddressed — not worth shipping without the rest of the surface.
4. Option A (real transport fix) — if pursued — is a Claude Code Agent-tool / MCP deferred-load coordination change, not a fork change. Out of scope for ADR-0140.

## Files cited
- `/Users/henrik/source/ruflo-patch/docs/plans/gap-3a-hive-mind-memory-investigation.md`
- `/Users/henrik/source/ruflo-patch/docs/plans/gap-3a-hypothesis-1-deferred-tool.md`
- `/Users/henrik/source/ruflo-patch/docs/plans/gap-3a-hypothesis-2-stdin-framing.md`
- `/Users/henrik/.claude/projects/-Users-henrik-source-ruflo-patch/memory/reference-hive-runtime-crosstalk-pattern.md`
- `/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/index.ts`
- `/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts`
- `/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/mcp-server.ts`
