---
status: accepted
date: 2026-06-11
tags: [mcp, runtime, leak, watchdog, fix, upstream-shared, batch-u-followup]
supersedes: []
depends-on: [ADR-0240, ADR-0314]
implements: []
---

# Orphaned `ruflo mcp start` server when the parent dies without a stdio EOF

## Context and Problem Statement

`ruflo mcp start` runs as a double-forked grandchild of Claude Code (`npx -y
ruflo … mcp start` → `npm exec …` → `node … mcp start`). When Claude Code exits,
only the `npm exec` shim is terminated; the `node` server can reparent to
`launchd`/`init` (`ppid === 1`) and linger — ~50 MB + an open DB handle per
restart, accumulating to ~1 GB and letting a stale server win the next stdio
handshake (upstream #2234).

The fork's inline MCP path (`bin/cli.js`) already exits on **stdin EOF** (parent
dies → stdio pipe closes), which closes the common case. But that path has **no
SIGTERM/SIGINT fallback**, so the **reparent-without-EOF tail** (the shim is
killed while the read end is held / not delivered EOF) has no exit mechanism.
[[ADR-0314]] independently confirmed PPID-1 orphaning is real on this machine —
but it is scoped to **agent-browser Chrome only**, not the MCP server. Surfaced +
verified as a Batch-U ([[ADR-0313]]) follow-up.

## Decision

Hand-port upstream `455152da0` (#2234), **fork-adapted**:

- New `src/runtime/parent-death-watchdog.ts` (near-verbatim; branding-neutral):
  an `unref`'d 2 s `process.ppid` poll that fires a cleanup hook + exits cleanly
  when ppid **transitions** to 1 (never fires if it started at 1 — already
  daemonised).
- Wire it into **`bin/cli.js` inline MCP block — NOT `mcp.ts`**. This is the
  load-bearing fork divergence: upstream wired the watchdog into `mcp.ts`
  startCommand, but `npx ruflo mcp start` in the fork runs `bin/cli.js` inline
  and short-circuits **before** the CLI dispatcher reaches `mcp.ts` — so a
  verbatim port would be dead code (cf. [[ADR-0267]], the prior "patched dead
  `mcp-server.ts`" lesson). `onOrphaned` logs to **stderr only** ([[ADR-0240]];
  stdout is the JSON-RPC channel) and exits 0.

## Consequences

- Good: closes the reparent-without-EOF leak tail that stdin-EOF misses; cheap
  (`unref`'d poll, no event-loop impact, no logging until it fires).
- Good: records the upstream-wired-into-dead-code correction (#2234 = ADAPT, not
  cherry-pick) for the ledger + future syncs.
- Neutral: the common case was already covered by stdin-EOF; this is
  defense-in-depth for a low-frequency tail (severity low; not empirically
  reproduced on this machine, but the mechanism is corpus-confirmed via
  ADR-0314 and the inline path genuinely lacks any SIGTERM/SIGINT fallback).

## Confirmation

Unit test `__tests__/parent-death-watchdog-2234.test.ts` (mocked ppid): fires +
exits 0 on ppid→1 transition; never fires when started at ppid=1; idempotent;
exit 1 when the hook throws. Rides the cli vitest suite (pipeline test-ci).
`tsc --noEmit` clean; `node --check bin/cli.js` clean. Shipped: forks/ruflo
`393ed7ee7`.

## More Information

Batch-U row in `docs/upstream/INTEGRATION-LEDGER.md`; upstream `455152da0` #2234.
Sibling leak-hygiene: [[ADR-0314]] (agent-browser Chrome).
