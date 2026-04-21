/**
 * ADR-0006 follow-up (2026-04-21): CLI bin map rebrand to `ruflo`.
 *
 * Asserts the fork-source package.json at
 *   forks/ruflo/v3/@claude-flow/cli/package.json
 * exposes `ruflo`, `ruflo-mcp`, `cli`, `claude-flow`, `claude-flow-mcp`.
 *
 * The `cli` alias was re-added on 2026-04-21 (reversing the earlier removal)
 * because `npx @sparkleideas/cli@latest ...` derives the executable name from
 * the unscoped package name (`cli`) and fails with "could not determine
 * executable to run" when that bin entry is missing. The rebrand goal was to
 * make the CLI *easier* to invoke, so forcing users onto the clunky
 * `npx -p @sparkleideas/cli@latest ruflo ...` form was the wrong trade.
 * `ruflo` stays the primary; `cli` is an npx-bootstrap alias only.
 *
 * This test reads the pre-codemod fork source. The codemod bin-preservation
 * contract is covered separately in `codemod-bin-preservation.test.mjs`
 * (post-codemod assertion: bin keys stay literal, never get scoped).
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FORK_PKG = join(__dirname, '../../../forks/ruflo/v3/@claude-flow/cli/package.json');

describe('ADR-0006 follow-up: CLI bin map — ruflo rebrand', () => {
  const pkg = JSON.parse(readFileSync(FORK_PKG, 'utf8'));

  it('bin map exists', () => {
    assert.equal(typeof pkg.bin, 'object');
    assert.ok(pkg.bin !== null);
  });

  it('exposes `ruflo` pointing at ./bin/cli.js', () => {
    assert.equal(pkg.bin.ruflo, './bin/cli.js');
  });

  it('exposes `ruflo-mcp` pointing at ./bin/mcp-server.js', () => {
    assert.equal(pkg.bin['ruflo-mcp'], './bin/mcp-server.js');
  });

  it('keeps `claude-flow` as backwards-compat alias for ./bin/cli.js', () => {
    assert.equal(pkg.bin['claude-flow'], './bin/cli.js');
  });

  it('keeps `claude-flow-mcp` as backwards-compat alias', () => {
    assert.equal(pkg.bin['claude-flow-mcp'], './bin/mcp-server.js');
  });

  it('exposes `cli` as a backwards-compat alias for npx auto-invocation', () => {
    // npx derives the bin to run from the unscoped package name
    // (`@sparkleideas/cli` → `cli`). Without this entry, `npx @sparkleideas/cli@latest`
    // fails with "could not determine executable to run". Re-added 2026-04-21
    // after the original removal broke the primary npx UX path.
    assert.equal(pkg.bin.cli, './bin/cli.js');
  });

  it('name stays @claude-flow/cli in fork source (codemod rewrites at publish)', () => {
    assert.equal(pkg.name, '@claude-flow/cli');
  });
});
