// @tier pipeline
// ADR-0235 — Umbrella plugin brand content-invariant lint (F-07-003).
//
// Scans forks/ruflo/.claude-plugin/**/*.{json,sh,md} for the 7 forbidden
// strings defined in _brand-forbidden.mjs. Any hit FAILS RED — there is
// NO operator-accept path. The only way to make the test pass is to fix
// the source content.
//
// The forbidden strings are the umbrella-plugin's pre-rebrand identity
// (upstream claude-flow / rUv / 2.5.0 / ruvnet repo URLs / npx
// claude-flow@alpha / mcp add claude-flow with trailing space). Pass 7
// of scripts/codemod.mjs already covers .claude-plugin/ at the path
// level but NOT at the regex level (Pass 7 rewrites @sparkleideas/cli
// → @sparkleideas/ruflo, not the brand strings here). Hence this is
// the durable gate.
//
// Confirmation:
//   #5 from ADR-0235 — test fails on pre-fix tree, passes after fix.
//   #6 from ADR-0235 — plugin.json + install.sh are clean.
//
// Pattern: node --test + recursive walk per ADR-0215
// (skill-shell-integrity.test.mjs walkSkillFiles pattern).

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve, dirname, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  UMBRELLA_FORBIDDEN_STRINGS,
  UMBRELLA_FORBIDDEN_DIR,
  UMBRELLA_FORBIDDEN_EXTENSIONS,
} from './_brand-forbidden.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');

// Fork dir from upstream-branches.json (single source of truth).
const upstream = JSON.parse(
  readFileSync(resolve(ROOT, 'config', 'upstream-branches.json'), 'utf8'),
);
const FORK_RUFLO = upstream.ruflo.dir;
const PLUGIN_DIR = join(FORK_RUFLO, UMBRELLA_FORBIDDEN_DIR);

const skip = !existsSync(PLUGIN_DIR)
  ? `${PLUGIN_DIR} not found — fork not checked out`
  : false;

function* walkFiles(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name === '.git' || e.name === 'node_modules' || e.name === 'dist') continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      yield* walkFiles(full);
    } else if (e.isFile() && UMBRELLA_FORBIDDEN_EXTENSIONS.has(extname(e.name))) {
      yield full;
    }
  }
}

describe('ADR-0235 — umbrella plugin brand content-invariant lint', { skip }, () => {
  for (const forbidden of UMBRELLA_FORBIDDEN_STRINGS) {
    it(`zero occurrences of ${JSON.stringify(forbidden)} in ${UMBRELLA_FORBIDDEN_DIR}/`, () => {
      const offenders = [];
      for (const file of walkFiles(PLUGIN_DIR)) {
        const content = readFileSync(file, 'utf8');
        if (content.includes(forbidden)) {
          // Collect ALL offending line numbers for actionable error messages.
          const lines = content.split('\n');
          const hits = lines
            .map((line, i) => (line.includes(forbidden) ? i + 1 : null))
            .filter((n) => n !== null);
          offenders.push({ file: relative(FORK_RUFLO, file), lines: hits });
        }
      }
      assert.equal(
        offenders.length,
        0,
        `Found ${offenders.length} file(s) containing forbidden string ${JSON.stringify(forbidden)}:\n` +
          offenders.map((o) => `  ${o.file}:${o.lines.join(',')}`).join('\n') +
          `\n\nADR-0235: umbrella-plugin brand strings must use sparkling/ruflo identity, ` +
          `not upstream claude-flow / rUv / ruvnet. Fix the source content; ` +
          `this lint is the durable gate (Pass 7 regex does not cover brand strings).`,
      );
    });
  }
});
