#!/usr/bin/env node
/**
 * In-process bulk hierarchical store/delete helper for smoke-adr0282.
 *
 * The G1 (ADR-0282) check needs >100 hierarchical-memory records to prove the
 * `limit > 100` clamp is gone. Storing/deleting them via 101 separate
 * `cli mcp exec` spawns cost ~202 Node cold-starts (~110s — the slowest check).
 * This helper does all 101 writes (or deletes) in a SINGLE process that boots
 * the controllers once, using the EXACT same entry point `cli mcp exec` uses:
 * `callMCPTool('agentdb_hierarchical-store' | '-delete', ...)` after
 * `initProcessArchivist()` (mirrors the cli bootstrap at index.ts:282). Running
 * the same handler with the same cwd guarantees the writes land in the SAME
 * `.swarm/memory.db` store the smoke's `cli mcp exec agentdb_hierarchical-query`
 * assertion reads — verified cross-process (in-process write 101 → fresh
 * `mcp exec` query 101; in-process delete → fresh query 0).
 *
 * Invoked once per phase from the smoke:
 *   node adr0282-hierarchical-bulk.mjs <store|delete> <pathPrefix> <count>
 *   (cwd = the smoke's install dir, so the archivist resolves the same store)
 *
 * Prints a single machine-parseable line to stdout: `BULK-<MODE> <ok>/<count>`.
 * Exits non-zero on a partial write/delete so the smoke fails loud (no silent
 * fallback) — a partial store must surface as G1-store FAIL.
 */
import { createRequire } from 'node:module';

const [mode, prefix, countStr] = process.argv.slice(2);
const count = Number(countStr);

if (!['store', 'delete'].includes(mode) || !prefix || !Number.isInteger(count) || count <= 0) {
  process.stderr.write(`usage: adr0282-hierarchical-bulk.mjs <store|delete> <pathPrefix> <count>\n`);
  process.exit(2);
}

const require = createRequire(`${process.cwd()}/package.json`);
// Same package + entry points `cli mcp exec` uses; the published cli is
// @sparkleideas/cli (the @sparkleideas/ruflo wrapper depends on it).
const client = await import(require.resolve('@sparkleideas/cli/dist/src/mcp-client.js'));
const archInit = await import(require.resolve('@sparkleideas/cli/dist/src/memory/archivist-init.js'));

// Mirror the cli bootstrap (index.ts:282): the SQLite carve-out substrate the
// hierarchical handlers need is wired by initProcessArchivist(). callMCPTool
// would otherwise throw "ensureSqliteWired called before initProcessArchivist".
await archInit.initProcessArchivist();

const ctx = { sessionId: `adr0282-bulk-${mode}`, requestId: `adr0282-bulk-${Date.now()}` };
const tool = mode === 'store' ? 'agentdb_hierarchical-store' : 'agentdb_hierarchical-delete';

let ok = 0;
for (let i = 0; i < count; i++) {
  const key = `${prefix}/${String(i).padStart(3, '0')}`;
  const params = mode === 'store' ? { key, value: `v${i}`, tier: 'working' } : { key };
  const r = await client.callMCPTool(tool, params, ctx);
  if (r && r.success === true) ok++;
  else if (i === 0) process.stderr.write(`[bulk] first ${mode} non-success: ${JSON.stringify(r).slice(0, 200)}\n`);
}

process.stdout.write(`BULK-${mode.toUpperCase()} ${ok}/${count}\n`);
// Loud failure on partial store; deletes are best-effort teardown (the original
// smoke ignored delete results) so a partial delete is reported but not fatal.
process.exit(mode === 'store' && ok < count ? 1 : 0);
