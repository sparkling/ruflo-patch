---
status: accepted
date: 2026-03-05
tags: [mcp, init, patch]
supersedes: []
depends-on: []
implements: []
---

# Remove autoStart: false from MCP claude-flow server entry

## Context and Problem Statement

The `@claude-flow/cli` init system generates a `.mcp.json` file that configures MCP servers for Claude Code. The `init/types.js` module defaults the `autoStart` property to `false` for MCP server entries. The `init/mcp-generator.js` module unconditionally spreads `{ autoStart: config.autoStart }` into the claude-flow MCP server entry via `createMCPServerEntry()`.

Claude Code's behavior when `autoStart` is absent from an MCP server entry is to auto-start the server. When `autoStart: false` is explicitly present, Claude Code skips launching the server entirely. This causes the claude-flow MCP server to appear as "failed" in the `/mcp` dialog, with no tools available.

The init wizard provides no UI to control this property, so every project initialized with `@claude-flow/cli` gets a broken MCP configuration out of the box.

## Considered Options

* Patch `init/mcp-generator.js` to stop passing `{ autoStart: config.autoStart }` as `additionalProps` to `createMCPServerEntry()` for the claude-flow server entry (chosen).

(No alternatives were recorded.)

## Decision Outcome

Chosen option: "Patch `init/mcp-generator.js` to stop passing `{ autoStart: config.autoStart }`", because this relies on Claude Code's default behavior (absent key = auto-start) rather than explicitly setting a value the init system defaults incorrectly.

Patch `init/mcp-generator.js` to stop passing `{ autoStart: config.autoStart }` as `additionalProps` to `createMCPServerEntry()` for the claude-flow server entry.

The patched line changes from:

```js
}, { autoStart: config.autoStart });
```

to:

```js
});
```

This relies on Claude Code's default behavior (absent key = auto-start) rather than explicitly setting a value the init system defaults incorrectly.

### Consequences

* Good, because new projects initialized after patching get a working claude-flow MCP server immediately.
* Good, because no user intervention required — the server starts automatically when Claude Code launches.
* Good, because the fix is minimal and idempotent — safe to apply multiple times.
* Bad, because projects initialized before the patch still have `"autoStart": false` in their `.mcp.json` and must be fixed manually or via `ruflo repair`.
* Bad, because if a user intentionally wants `autoStart: false`, they must add it manually after init. However, the init wizard never offered this option, so no existing workflow is broken.
* Neutral, because the `autoStart` property in `init/types.js` defaults remains unchanged. Only the MCP generator output is affected. A future upstream fix could correct the default in `types.js` instead.

## More Information

Patch reference:

- **Defect ID**: MC-001
- **Patch directory**: `patch/010-MC-001-mcp-autostart/`
- **Target file**: `dist/src/init/mcp-generator.js`
- **Sentinel**: `absent "autoStart: config.autoStart" init/mcp-generator.js`
- **Patch**: `patch/010-MC-001-mcp-autostart/`
