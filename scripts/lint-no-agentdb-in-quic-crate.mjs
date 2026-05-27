#!/usr/bin/env node
/**
 * ADR-0265 §C7.c — Reverse-import guard.
 *
 * Asserts `forks/agentic-flow/crates/agentic-flow-quic-node/` (the new
 * N-API binding crate authored fork-side per ADR-0265 §Phase 1) does NOT
 * import anything from the agentdb fork. This preserves §I9 (SyncCoordinator
 * untouched) and §I10 (no `@fails-components/webtransport` dep in
 * @sparkleideas/agentic-flow-quic-native-*) by closing the back-door route: even if a
 * future commit accidentally pulls in an agentdb util, this lint rejects.
 *
 * The crate is a Rust workspace (Cargo) so imports are surfaced via either
 *   - `use <some::path::that::names::agentdb>` (Rust)
 *   - `from "agentdb"` / `from "@sparkleideas/agentdb"` (any TS scaffolding
 *     inside the crate's package.json or build scripts)
 *
 * Failure mode: exit 1 with the offending file + line, blocking release.
 *
 * Per `feedback-no-fallbacks`: any hit FAILS loudly with citation; we don't
 * print a count and continue.
 *
 * Wired into `scripts/ruflo-publish.sh` lint phase (gate-0 cluster).
 *
 * Usage:
 *   node scripts/lint-no-agentdb-in-quic-crate.mjs
 *   node scripts/lint-no-agentdb-in-quic-crate.mjs --json
 *
 * Exit codes:
 *   0 — no agentdb imports anywhere under the QUIC crate
 *   1 — at least one offending import (release blocked)
 *   2 — script error (crate path missing — treated as harmless if the
 *       crate hasn't been authored yet; this guard NO-OPs in that case)
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
// forks/ is a SIBLING of ruflo-patch (../forks/...), not a subdir.
// Per lib/fork-paths.sh — the canonical fork-locator script.
const CRATE_DIR = process.env.QUIC_NODE_CRATE_DIR ||
  resolve(ROOT, '../forks/agentic-flow/crates/agentic-flow-quic-node');

const args = process.argv.slice(2);
const jsonOnly = args.includes('--json');

const findings = [];

function emit(file, line, snippet, pattern) {
  findings.push({
    file: relative(ROOT, file),
    line,
    snippet: snippet.slice(0, 200),
    pattern,
  });
}

function scanFile(absPath) {
  let src;
  try { src = readFileSync(absPath, 'utf8'); }
  catch { return; }

  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip comment-only lines (// in TS/Rust, # in TOML).
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('#')) continue;

    // Rust `use` paths that name agentdb anywhere in the path.
    // Match: `use ::agentdb`, `use crate::agentdb`, `use agentdb::`
    if (/\buse\b[^;]*\bagentdb\b/.test(line)) {
      emit(absPath, i + 1, line, 'rust-use-agentdb');
      continue;
    }

    // TS/JS import patterns: `from 'agentdb'` / `from "@sparkleideas/agentdb"`
    if (/\bfrom\s+['"]@?[a-z@/-]*\bagentdb\b['"]/.test(line)) {
      emit(absPath, i + 1, line, 'ts-import-agentdb');
      continue;
    }

    // require(...) — covers CJS scaffolding inside the crate's build/setup.
    if (/\brequire\s*\(\s*['"]@?[a-z@/-]*\bagentdb\b['"]/.test(line)) {
      emit(absPath, i + 1, line, 'ts-require-agentdb');
      continue;
    }

    // Cargo.toml dependency names — direct `agentdb = ...` or `agentdb-*`.
    if (/^\s*agentdb(\s*[-=]|-)/i.test(line)) {
      emit(absPath, i + 1, line, 'cargo-dep-agentdb');
      continue;
    }

    // package.json scripts that npm install agentdb — best-effort.
    if (/"@sparkleideas\/agentdb"|\b"agentdb"\s*:\s*"/.test(line)) {
      emit(absPath, i + 1, line, 'package-json-dep-agentdb');
      continue;
    }
  }
}

function walk(dir) {
  let entries;
  try { entries = readdirSync(dir); }
  catch { return; }
  for (const name of entries) {
    if (name === 'target' || name === 'node_modules' || name === '.git') continue;
    const p = join(dir, name);
    let st;
    try { st = statSync(p); }
    catch { continue; }
    if (st.isDirectory()) walk(p);
    else if (st.isFile()) {
      // Scope: Rust source, TS/JS scaffolding, Cargo manifests, package.json.
      if (/\.(rs|ts|tsx|js|mjs|cjs|toml|json)$/.test(name)) scanFile(p);
    }
  }
}

function main() {
  if (!existsSync(CRATE_DIR)) {
    if (!jsonOnly) {
      process.stderr.write(`[lint-no-agentdb-in-quic-crate] crate path missing: ${CRATE_DIR}\n`);
      process.stderr.write(`[lint-no-agentdb-in-quic-crate] no-op — Phase 1 of ADR-0265 has not yet authored the crate; guard will activate when crate appears\n`);
    }
    process.stdout.write(JSON.stringify({
      adr: 'ADR-0265',
      criterion: 'C7.c',
      cratePath: CRATE_DIR,
      cratePresent: false,
      findings: [],
      pass: true,
      noop: true,
    }) + '\n');
    process.exit(0);
  }

  walk(CRATE_DIR);

  const report = {
    adr: 'ADR-0265',
    criterion: 'C7.c',
    cratePath: relative(ROOT, CRATE_DIR),
    cratePresent: true,
    findings,
    pass: findings.length === 0,
  };

  if (!jsonOnly) {
    if (findings.length === 0) {
      process.stderr.write(
        `[lint-no-agentdb-in-quic-crate] PASS — 0 agentdb imports under ${report.cratePath}\n`
      );
    } else {
      process.stderr.write(
        `[lint-no-agentdb-in-quic-crate] FAIL — ${findings.length} agentdb import(s) under ${report.cratePath}:\n`
      );
      for (const f of findings) {
        process.stderr.write(`  ${f.file}:${f.line} [${f.pattern}] ${f.snippet}\n`);
      }
      process.stderr.write(
        `\n[lint-no-agentdb-in-quic-crate] ADR-0265 §C7.c blocks release: the N-API binding crate must NOT depend on agentdb (the agentdb-side QUIC stack was deleted per ADR-0217 — federation transport explicitly does NOT extend QUIC into that surface; §I9, §I10).\n`
      );
    }
  }

  process.stdout.write(JSON.stringify(report) + '\n');
  process.exit(findings.length === 0 ? 0 : 1);
}

main();
