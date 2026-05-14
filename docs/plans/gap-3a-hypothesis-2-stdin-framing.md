# ADR-0140 Piece 3a — Hypothesis 2 (stdin framing corruption) verdict

**Status**: REFUTED (with one latent defect noted)
**Date**: 2026-05-04
**Scope**: Hypothesis 2 only — does the shared-stdio MCP server's `\n`-split parser corrupt sub-agent `tools/call` frames carrying multi-line `value` payloads?

## Verdict

**REFUTED** as the cause of the 600s sub-agent hang.

A latent design defect *does* exist (silent parse failures are not reported back to the caller), but it cannot be the root cause of the sub-agent-specific hang because the symmetry argument does not hold.

## Evidence

### 1. The parser is correct *if* the client conforms to JSON-RPC stdio framing

`forks/ruflo/v3/@claude-flow/cli/src/mcp-server.ts:381-416`

- Line 397: `let lines = buffer.split('\n');`
- Line 398: `buffer = lines.pop() || '';` — keeps the trailing partial frame, correctly handling chunk boundaries.
- Line 400-414: each complete line is `JSON.parse`d.

This is the canonical newline-delimited JSON-RPC framing prescribed by the MCP stdio transport spec. Per JSON syntax (RFC 8259 §7), a literal `\n` (0x0A) inside a string value is a **syntax error** — clients MUST escape it as `\\n`. So a spec-conformant client cannot put a raw newline inside a `value` field on the wire.

### 2. The same parser serves both main-thread and sub-agent calls

There is exactly one `process.stdin.on('data', ...)` handler (line 381) per MCP server subprocess. Claude Code spawns one MCP subprocess per session — the same subprocess handles `tools/call` frames from the main thread *and* from any Agent-tool sub-agent. The Agent-tool sub-agent's MCP client is the same Claude Code client implementation as the main thread (per Anthropic's stdio transport, sub-agents do not own a private MCP subprocess; they marshal calls back through the parent's MCP client).

If literal-newline corruption were happening on the wire, main-thread `hive-mind_memory set` with multi-line `value` would also fail. The investigation note (`gap-3a-hive-mind-memory-investigation.md` §Root-cause hypothesis) explicitly states the main-thread call works. **No asymmetry. Hypothesis 2 cannot explain the sub-agent-specific symptom.**

### 3. No log evidence of parse failures

```
$ grep -rn "Failed to parse message" {ruflo-patch,forks/ruflo}/...
forks/ruflo/v3/@claude-flow/cli/src/mcp-server.ts:410   # the log line itself
forks/ruflo/v3/@claude-flow/cli/dist/.../mcp-server.js:317  # built artifact
forks/ruflo/v3/@claude-flow/{mcp,shared}/.../stdio.ts       # alt transport, unused here
```

Zero hits in `/Users/henrik/source/ruflo-patch/logs/`, `.claude-flow/logs/daemon.log`, or `test-results/`. Recent daemon logs contain no parse-error entries. If sub-agent calls were dropping frames at the parser, we'd see one stderr line per dropped call.

### 4. The `notifications/initialized` reduction does not help Hypothesis 2 either

`mcp-server.ts:525-530` returns `null` for client-init notifications — that's normal and only affects connection setup, not per-call framing.

## Latent defect (worth tracking, but not this bug)

`mcp-server.ts:408-413` swallows parse errors with stderr-only logging. There is **no** `-32700 Parse error` JSON-RPC response sent back, unlike the alternate transport at `@claude-flow/shared/src/mcp/transport/stdio.ts:198` which does `await this.sendError(null, -32700, 'Parse error')`. If a malformed frame ever did arrive (truncation, write-amid-rotation, hostile client), the caller's `id`-correlated promise would hang indefinitely until its watchdog fired — exactly the 600s symptom shape, but only triggered by malformed input, which spec-conformant clients don't produce.

This is a defensive-coding miss, not the root cause. Worth a separate small fix (mirror the shared/stdio.ts pattern) but unrelated to the sub-agent hang.

## What the hypothesis fails to explain

1. **Why sub-agent calls would frame differently from main-thread calls.** Both use Claude Code's MCP client → same JSON.stringify → same write to the same pipe. JSON serialization is deterministic.
2. **Why no `Failed to parse message` ever appears in stderr/logs.** A real framing failure in a 600s-hang scenario would log; it doesn't.
3. **Why the 600s figure matches Claude Code's Agent watchdog cap exactly,** not a "frame drop + indefinite wait" timeline (which has no fixed upper bound).

## Pointers for adjacent investigations

- Hypothesis 1 (deferred-tool-load deadlock at the Agent boundary) remains open and is a much better fit for the asymmetry: sub-agents inherit a different tool-resolution context (ToolSearch defers schemas), and a never-arriving `tools/list` response inside the sub-agent's MCP wrapper would produce exactly a per-call hang capped by the watchdog, with zero stderr from the fork-side.
- Recommend the parent investigation focus on Hypothesis 1; ship Option C (Bash-CLI fallback) per the parent doc.
