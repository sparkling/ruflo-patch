#!/usr/bin/env node
// lint-node-pin-parity.mjs — ADR-0302: every node pin in this repo must agree.
//
// Single source of truth: `.tool-versions` `nodejs <major>` at the repo root.
// This lint asserts every `node-version:` in `.github/workflows/*.yml`
// matches that major. Rationale: workflows construct their environment with
// actions/setup-node, and any workflow that runs the pipeline or loads
// ABI-bound natives (better-sqlite3) under a different major produces
// artifacts/verdicts the workstation pin can't reproduce (2026-06-07
// incident: brew's node 26 vs mise-pinned 24 — see ADR-0302, ADR-0287).
//
// Deliberate exceptions go in ALLOWLIST with a reason; an empty allowlist is
// the desired steady state.
//
// Exit 0 = parity holds. Exit 1 = drift (or unparseable pin), with file:line.

import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

// file basename -> reason. Entries here are still REPORTED, just not fatal.
const ALLOWLIST = new Map([
  // (none — keep it that way)
]);

function pinnedMajor() {
  const tv = readFileSync(join(ROOT, '.tool-versions'), 'utf8');
  const m = tv.match(/^nodejs\s+(\d+)/m);
  if (!m) {
    console.error('lint-node-pin-parity: FATAL — no `nodejs <major>` line in .tool-versions');
    process.exit(1);
  }
  return m[1];
}

function main() {
  const pin = pinnedMajor();
  const wfDir = join(ROOT, '.github', 'workflows');
  let files = [];
  try {
    files = readdirSync(wfDir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
  } catch {
    console.log(`lint-node-pin-parity: no workflows dir — pin ${pin} vacuously consistent`);
    return;
  }

  const drift = [];
  let checked = 0;
  for (const f of files) {
    const lines = readFileSync(join(wfDir, f), 'utf8').split('\n');
    lines.forEach((line, i) => {
      const m = line.match(/^\s*node-version:\s*['"]?([^'"\s#]+)['"]?/);
      if (!m) return;
      checked++;
      const val = m[1];
      // Expression values (e.g. ${{ env.NODE_VERSION }}) can't be checked
      // statically here — resolve a literal `NODE_VERSION:` env in the same
      // file, else treat as drift (opaque pins defeat the lint's purpose).
      let effective = val;
      if (val.startsWith('${{')) {
        const env = lines.map((l) => l.match(/^\s*NODE_VERSION:\s*['"]?(\d+)/)).find(Boolean);
        effective = env ? env[1] : `(unresolvable: ${line.trim()})`;
      }
      const major = String(effective).split('.')[0];
      if (major !== pin) {
        drift.push({ file: f, line: i + 1, found: effective });
      }
    });
  }

  const fatal = drift.filter((d) => !ALLOWLIST.has(d.file));
  for (const d of drift) {
    const allowed = ALLOWLIST.has(d.file) ? ` [allowlisted: ${ALLOWLIST.get(d.file)}]` : '';
    console.error(
      `lint-node-pin-parity: ${allowed ? 'note' : 'DRIFT'} — .github/workflows/${d.file}:${d.line} node-version ${d.found} != pinned ${pin}${allowed}`,
    );
  }
  if (fatal.length > 0) {
    console.error(`lint-node-pin-parity: FAIL — ${fatal.length} workflow pin(s) drift from .tool-versions nodejs ${pin}`);
    process.exit(1);
  }
  console.log(`lint-node-pin-parity: OK — ${checked} node-version pin(s) across ${files.length} workflows match nodejs ${pin}`);
}

main();
