#!/usr/bin/env node
/**
 * Smoke: ADR-0266 C7 — Each SAFE_MCP_TOOLS allowlist name resolves to a
 * real fork tool. Per ADR-0259 §Step 2 verification.
 *
 * Pure source-grep — does NOT require any cli install. Greps the fork's
 * `wasm-agent-tools.ts` for the 29-entry `SAFE_MCP_TOOLS` Set then asserts
 * each name produces ≥1 hit when greped against the sibling registry files
 * `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/*-tools.ts` using the
 * pattern `name: '<name>'` (the canonical MCP-tool registration shape).
 *
 * FAILs loudly if any allowlist entry doesn't resolve — drift safety net.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

// Try both fork checkout layouts (sibling vs ../forks)
const CANDIDATES = [
  resolve(REPO_ROOT, '..', 'forks', 'ruflo', 'v3', '@claude-flow', 'cli', 'src', 'mcp-tools'),
  resolve(REPO_ROOT, 'forks', 'ruflo', 'v3', '@claude-flow', 'cli', 'src', 'mcp-tools'),
];

function log(msg) { process.stderr.write(`${msg}\n`); }

function findMcpToolsDir() {
  for (const c of CANDIDATES) {
    try {
      const entries = readdirSync(c);
      if (entries.some(f => f === 'wasm-agent-tools.ts')) return c;
    } catch {}
  }
  return null;
}

function main() {
  log(`[ADR-0266 C7 smoke] allowlist resolution`);
  const dir = findMcpToolsDir();
  if (!dir) {
    log(`[smoke] FATAL: could not locate forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/`);
    log(`        candidates checked: ${CANDIDATES.join(', ')}`);
    process.exit(1);
  }
  log(`[smoke] mcp-tools dir: ${dir}`);

  // 1. Load the wasm-agent-tools.ts source and extract SAFE_MCP_TOOLS entries.
  const wasmAgentToolsPath = join(dir, 'wasm-agent-tools.ts');
  const wasmAgentToolsSrc = readFileSync(wasmAgentToolsPath, 'utf8');

  // Slice the SAFE_MCP_TOOLS Set literal — find the line `const SAFE_MCP_TOOLS = new Set([`
  // then read until the matching `])`.
  const setStartMatch = wasmAgentToolsSrc.match(/const SAFE_MCP_TOOLS = new Set\(\[([\s\S]*?)\]\);/);
  if (!setStartMatch) {
    log(`[smoke] FAIL: SAFE_MCP_TOOLS Set literal not found in wasm-agent-tools.ts`);
    process.exit(1);
  }
  const setBody = setStartMatch[1];
  // Extract every string literal inside the Set body — `'foo_bar-baz'`.
  const names = [...setBody.matchAll(/'([^']+)'/g)].map(m => m[1]);
  log(`[smoke] extracted ${names.length} SAFE_MCP_TOOLS entries`);

  if (names.length !== 29) {
    log(`[smoke] FAIL: expected 29 allowlist entries (ADR-0259 final spec), got ${names.length}`);
    log(`        entries: ${names.join(', ')}`);
    process.exit(1);
  }

  // 2. Build a registry corpus: concat all *-tools.ts files under mcp-tools/.
  const toolFiles = readdirSync(dir).filter(f => f.endsWith('-tools.ts'));
  log(`[smoke] scanning ${toolFiles.length} registry files: ${toolFiles.join(', ')}`);
  let corpus = '';
  for (const f of toolFiles) {
    corpus += readFileSync(join(dir, f), 'utf8') + '\n';
  }

  // 3. Each name must produce ≥1 hit when grepped as `name: '<name>'`.
  const misses = [];
  for (const n of names) {
    // Escape regex special chars: `_` is safe, `-` is safe outside char classes.
    const pat = new RegExp(`name:\\s*['"]${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`, 'g');
    const matches = corpus.match(pat);
    if (!matches || matches.length === 0) {
      misses.push(n);
    }
  }

  if (misses.length > 0) {
    log(`[smoke] FAIL: ${misses.length} allowlist names do NOT resolve to any registered tool:`);
    for (const m of misses) log(`         - ${m}`);
    log(`        Either the allowlist drifted OR the fork hasn't shipped these handlers yet.`);
    process.exit(1);
  }

  log(`[smoke] PASS: all ${names.length} allowlist names resolve to ≥1 registered tool`);
  process.exit(0);
}

main();
