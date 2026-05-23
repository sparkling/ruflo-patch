// @tier pipeline
// ADR-0215 — SKILL.md slash-to-dollar corruption invariant gate.
//
// Asserts the general slash-to-dollar corruption signature
// `\$<word>\$<word>` does NOT survive in any SKILL.md under the fork's
// `.agents/skills/` tree. The corruption is upstream-inherited (commits
// b65f27e63 / 87ba34854, 2026-02-07) from a one-off interactive
// find/replace slip that translated `/X/Y` path content into `$X$Y`
// across 75-77 SKILL.md files. ADR-0215 reverted those at source; this
// test is the producer-agnostic content invariant that catches any
// re-introduction (upstream re-sync, future codemod pass, hand-edit).
//
// Scope: ONLY `forks/ruflo/.agents/skills/` — the user-facing
// `.claude/skills/` corpus is covered by sibling ADR-0216 (init-time
// CLI + corpus-shape acceptance check), and the broader fork tree is
// clean of this signature (verified during ADR-0215 second-pass review).
//
// Gate signature: `\$<word>\$<word>` (general, as per ADR-0215 §(b)).
// NOT the 9-token alternation — the general signature catches the full
// observed class (the alternation only reaches 33 of 75 files in the
// pre-fix state; the general regex matched 75).
//
// FAIL LOUD — there is NO `UPDATE_GOLDEN`-style escape hatch. If the
// regex matches, the test fails with the file path and offending lines.
// The only way to make the test pass is to fix the corruption at source.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');

// Fork dir from upstream-branches.json (single source of truth).
const upstream = JSON.parse(
  readFileSync(resolve(ROOT, 'config', 'upstream-branches.json'), 'utf8'),
);
const FORK_RUFLO = upstream.ruflo.dir;
const AGENTS_SKILLS = join(FORK_RUFLO, '.agents', 'skills');

const skip = !existsSync(AGENTS_SKILLS)
  ? `forks/ruflo/.agents/skills/ not found at ${AGENTS_SKILLS}`
  : false;

// General slash-to-dollar corruption signature. The ADR's chosen gate per
// §(b): `\$<word>\$<word>` where <word> = `[a-zA-Z_]+`. This catches the
// full observed class (75 files in the pre-fix state) and is 0 on the
// clean `.claude/agents/`, `.claude/skills/`, and agentdb trees.
const GATE_RE = /\$[a-zA-Z_]+\$[a-zA-Z_]+/;

function* walkSkillFiles(dir) {
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
      yield* walkSkillFiles(full);
    } else if (e.isFile() && /\.md$/i.test(e.name)) {
      yield full;
    }
  }
}

describe('ADR-0215 — SKILL.md slash-to-dollar corruption invariant', { skip }, () => {
  it('zero \\$<word>\\$<word> hits in forks/ruflo/.agents/skills/**/*.md (whole file)', () => {
    const offenders = [];

    for (const path of walkSkillFiles(AGENTS_SKILLS)) {
      const content = readFileSync(path, 'utf8');
      // Whole-file scan: ADR §(b) — 17 of 20 $dev$null hits were in YAML
      // hooks: frontmatter, not fenced blocks. Whole-file is safe (clean
      // trees match 0).
      if (!GATE_RE.test(content)) continue;

      const rel = relative(FORK_RUFLO, path);
      const hits = [];
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(/\$[a-zA-Z_]+\$[a-zA-Z_]+/g);
        if (m) {
          hits.push(`  ${rel}:${i + 1}  ${m.slice(0, 3).join(', ')}${m.length > 3 ? ' ...' : ''}`);
        }
      }
      offenders.push(...hits);
    }

    assert.equal(
      offenders.length,
      0,
      `ADR-0215 gate: ${offenders.length} slash-to-dollar corruption line(s) in .agents/skills/\n` +
      offenders.slice(0, 40).join('\n') +
      (offenders.length > 40 ? `\n  ... and ${offenders.length - 40} more` : '') +
      `\n\nResolution: revert the affected lines (e.g. $dev$null -> /dev/null, ` +
      `$tmp$X -> /tmp/X, #!$bin$bash -> #!/bin/bash). See ADR-0215 for ` +
      `the full class. There is no UPDATE_GOLDEN escape hatch — fix at source.`,
    );
  });
});
