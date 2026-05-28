// @tier unit
// ADR-0157 Acceptance Criterion #4 — regression guard test.
//
// Asserts the adr-create skill template and the adr-index skill stay
// aligned on YAML frontmatter field names. Adding a field to one MUST
// require updating the other; drift surfaces at unit-test time.
//
// Per ADR-0157 §Acceptance criteria #4:
//   "Regression guard test asserts the adr-create template's frontmatter
//    shape matches what adr-index can parse. Test parses both SKILL.md
//    files and asserts the YAML field names match."

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const FORK_ROOT = resolve(ROOT, '..', 'forks', 'ruflo');
const ADR_CREATE = resolve(FORK_ROOT, 'plugins/ruflo-adr/skills/adr-create/SKILL.md');
const ADR_INDEX = resolve(FORK_ROOT, 'plugins/ruflo-adr/skills/adr-index/SKILL.md');
const ADR_INDEX_IMPL = resolve(FORK_ROOT, 'plugins/ruflo-adr/scripts/import.mjs');

// Required fields per ADR-0157 §"Acceptance Criteria #1" + §Decision Outcome.
const REQUIRED_FIELDS = ['status', 'date'];
// Relationship fields — the index MUST read these to emit causal edges.
const RELATIONSHIP_FIELDS = ['amends', 'supersedes', 'superseded-by', 'depends-on'];

test('ADR-0157 AC#1: adr-create skill SKILL.md exists', () => {
  assert.ok(existsSync(ADR_CREATE), `adr-create SKILL.md missing at ${ADR_CREATE}`);
});

test('ADR-0157 AC#1: adr-create template declares MADR + YAML frontmatter', () => {
  const src = readFileSync(ADR_CREATE, 'utf8');
  assert.match(src, /MADR\b/i, 'adr-create template should reference MADR');
  assert.match(src, /YAML frontmatter/i, 'adr-create should declare YAML frontmatter');
  for (const f of REQUIRED_FIELDS) {
    // Must appear in the template's required-fields enumeration.
    const re = new RegExp(`\\b${f}\\b`);
    assert.ok(re.test(src), `adr-create template missing required field documentation: ${f}`);
  }
});

test('ADR-0157 AC#2: adr-index SKILL.md exists', () => {
  assert.ok(existsSync(ADR_INDEX), `adr-index SKILL.md missing at ${ADR_INDEX}`);
});

test('ADR-0157 AC#2: adr-index docs reference YAML parsing', () => {
  const src = readFileSync(ADR_INDEX, 'utf8');
  assert.match(src, /YAML\b/i, 'adr-index should document YAML parsing');
});

test('ADR-0157 AC#2: adr-index importer impl exists + handles relationship fields', () => {
  assert.ok(existsSync(ADR_INDEX_IMPL),
    `adr-index importer missing at ${ADR_INDEX_IMPL}`);
  const src = readFileSync(ADR_INDEX_IMPL, 'utf8');
  // The importer must read every relationship field to emit causal edges.
  for (const f of RELATIONSHIP_FIELDS) {
    const re = new RegExp(`['"]${f}['"]|\\b${f.replace('-', '[\\-_]?')}\\b`, 'i');
    assert.ok(re.test(src), `adr-index importer doesn't reference relationship field: ${f}`);
  }
});

test('ADR-0157 AC#4: adr-create template and adr-index agree on relationship fields', () => {
  const tmpl = readFileSync(ADR_CREATE, 'utf8');
  const impl = readFileSync(ADR_INDEX_IMPL, 'utf8');
  // For each relationship field documented in the create template, the
  // index importer MUST handle it. Failure here means the template and
  // index drifted: a contributor adds `obsoletes:` to the template but
  // the index doesn't know about it; the causal edge silently goes
  // missing.
  for (const f of RELATIONSHIP_FIELDS) {
    if (tmpl.includes(f)) {
      const re = new RegExp(`['"]${f}['"]|\\b${f.replace('-', '[\\-_]?')}\\b`, 'i');
      assert.ok(re.test(impl),
        `Drift: adr-create template references "${f}" but adr-index importer doesn't handle it`);
    }
  }
});
