// @tier unit
// ADR-0087 out-of-scope probe for adr0094-p12-error-quality.test.mjs
//
// P12's error-quality helper uses this hint regex:
//   required|must|invalid|expected|missing|type|string|array|number|schema|validation
// The agent-class field name 'type' overlaps this regex, making the
// 'names_field_no_shape' bucket structurally unreachable for agent-class
// checks. Agent A3 removed those bucket2 cases because they cannot pass.
//
// This probe fires if the hint regex changes in a way that breaks the
// overlap — at which point A3's deletion is no longer correct and the
// agent-class bucket2 cases must be reinstated.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CHECK_FILE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../..',
  'lib/acceptance-phase12-error-quality.sh',
);

describe('ADR-0094 Phase 12 — structural-hint regex invariant', () => {
  const src = readFileSync(CHECK_FILE, 'utf8');

  it('hint regex variable exists in lib file', () => {
    const match = src.match(/hint_regex=['"]([^'"]+)['"]/);
    assert.ok(match, 'hint_regex variable must exist in lib/acceptance-phase12-error-quality.sh');
  });

  it('hint regex contains literal word "type"', () => {
    const match = src.match(/hint_regex=['"]([^'"]+)['"]/);
    assert.ok(match, 'hint_regex variable must exist');
    const regex = match[1];
    const tokens = regex.split('|');
    assert.ok(
      tokens.includes('type'),
      `hint regex must contain 'type' — agent-class bucket2 deletion in adr0094-p12-error-quality.test.mjs depends on this overlap. Found: ${regex}`,
    );
  });

  it('hint regex contains all 11 expected tokens', () => {
    const expected = [
      'required',
      'must',
      'invalid',
      'expected',
      'missing',
      'type',
      'string',
      'array',
      'number',
      'schema',
      'validation',
    ];
    const match = src.match(/hint_regex=['"]([^'"]+)['"]/);
    assert.ok(match, 'hint_regex variable must exist');
    const tokens = match[1].split('|');
    for (const t of expected) {
      assert.ok(
        tokens.includes(t),
        `hint regex missing token '${t}' — A3's agent-class bucket2 deletion may need review. Current regex: ${match[1]}`,
      );
    }
  });
});
