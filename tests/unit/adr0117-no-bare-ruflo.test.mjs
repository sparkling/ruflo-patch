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
    it(`${path.split('/').slice(-2).join('/')}: zero bare \`ruflo@latest\` references`, () => {
      assert.ok(existsSync(path), `expected fork source file to exist: ${path}`);
      const src = readFileSync(path, 'utf8');

      // ADR-0155 (2026-05-07): mcp-generator now writes
      // `@sparkleideas/ruflo@latest` (user-facing wrapper, ADR-0143). The
      // negative lookbehind ensures the bare-ruflo regression guard
      // doesn't false-positive on the scoped `@sparkleideas/ruflo@latest`
      // form — only an unscoped `ruflo@latest` (which would resolve to
      // upstream's package on public npm) is flagged.
      const matches = src.match(/(?<!@sparkleideas\/)ruflo@(latest|alpha)/g) || [];
      assert.equal(
        matches.length,
        0,
        `${path} still contains ${matches.length} bare \`ruflo@latest\` ref(s) — should be \`@sparkleideas/ruflo@latest\` (ADR-0155)`,
      );
    });
  }

  it('mcp-generator.createRufloEntry uses @sparkleideas/ruflo@latest (ADR-0155)', () => {
    // ADR-0155 (2026-05-07) supersedes ADR-0104 §4a: createRufloEntry
    // unconditionally returns the npx form with the user-facing wrapper
    // package (@sparkleideas/ruflo, ADR-0143), not the internal
    // @sparkleideas/cli. The directly-resolved-global-path branch is
    // removed entirely; freshness beats cold-start optimisation per
    // `feedback-always-npx-for-ruflo`.
    const src = readFileSync(`${FORK_ROOT}/init/mcp-generator.ts`, 'utf8');
    assert.match(
      src,
      /createMCPServerEntry\(\['@sparkleideas\/ruflo@latest', 'mcp', 'start'\]/,
      'createRufloEntry should call createMCPServerEntry with @sparkleideas/ruflo@latest',
    );
    assert.doesNotMatch(
      src,
      /@sparkleideas\/cli@latest['"\s]*,\s*['"]mcp['"]/,
      'createRufloEntry must NOT use @sparkleideas/cli@latest (internal-only per ADR-0143)',
    );
  });
});
