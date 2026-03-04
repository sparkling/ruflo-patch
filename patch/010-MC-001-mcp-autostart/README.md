# MC-001: MCP claude-flow server fails to start due to autoStart: false

**Severity**: High

## Root Cause

The init system defaults `autoStart` to `false` in `init/types.js` (lines 119, 246).
`init/mcp-generator.js` unconditionally spreads `{ autoStart: config.autoStart }` into
the `.mcp.json` entry for claude-flow. This causes Claude Code to skip launching the
MCP server, which the user sees as "claude-flow: failed" in the /mcp dialog.

## Fix

Remove the `autoStart` property from the MCP server entry when it is `false`,
since Claude Code's default (absent key) is to auto-start. Only emit the key
when explicitly set to `false` would be intentional, but the init wizard has no
UI to control this — so the safe fix is to strip it entirely.

## Files Patched

- `dist/src/init/mcp-generator.js` — stop spreading autoStart into claude-flow entry

## Ops

1 op in fix.py
