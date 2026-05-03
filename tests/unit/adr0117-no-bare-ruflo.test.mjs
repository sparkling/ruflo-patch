// @tier unit
// ADR-0117 follow-up — fork source must not reference bare `ruflo@latest`.
//
// `ruflo@latest` is published on public npm by upstream. When init's
// mcp-generator emits .mcp.json args containing `ruflo@latest`, npx
// resolves it from public npm — bypassing the fork CLI entirely. This
// test guards against the regression of bare `ruflo@latest` strings
// reappearing in fork source after upstream merges.
//
// Scope: TS source only (not docs or build output). The codemod owns
// versioning/scope renames; this test enforces the fork-source patch.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';

const FORK_ROOT = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src';

const PATCHED_FILES = [
  `${FORK_ROOT}/init/mcp-generator.ts`,
  `${FORK_ROOT}/init/executor.ts`,
  `${FORK_ROOT}/init/helpers-generator.ts`,
  `${FORK_ROOT}/mcp-tools/guidance-tools.ts`,
  `${FORK_ROOT}/appliance/rvfa-builder.ts`,
  `${FORK_ROOT}/commands/doctor.ts`,
];

describe('ADR-0117 fork source — no bare ruflo@latest', () => {
  for (const path of PATCHED_FILES) {
    it(`${path.split('/').slice(-2).join('/')}: zero \`ruflo@latest\` references`, () => {
      assert.ok(existsSync(path), `expected fork source file to exist: ${path}`);
      const src = readFileSync(path, 'utf8');

      const matches = src.match(/ruflo@(latest|alpha)/g) || [];
      assert.equal(
        matches.length,
        0,
        `${path} still contains ${matches.length} bare \`ruflo@latest\` ref(s) — should be \`@sparkleideas/cli@latest\``,
      );
    });
  }

  it('mcp-generator.createRufloEntry fallback uses @sparkleideas/cli@latest', () => {
    const src = readFileSync(`${FORK_ROOT}/init/mcp-generator.ts`, 'utf8');
    assert.match(
      src,
      /createMCPServerEntry\(\['@sparkleideas\/cli@latest', 'mcp', 'start'\]/,
      'createRufloEntry fallback should call createMCPServerEntry with @sparkleideas/cli@latest',
    );
  });
});
