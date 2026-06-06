/**
 * ADR-0212 (2026-05-22, supersedes ADR-0006's CLI-`ruflo`-bin clause):
 * CLI bin map MUST NOT contain a `ruflo` key. Option B (remove from CLI)
 * was chosen so the wrapper (`@sparkleideas/ruflo`) becomes the sole
 * declarer of `ruflo` — converges with upstream (whose CLI is `ruflo`-free
 * by design) and ends the recurring `--theirs` merge tax on the `ruflo` key.
 *
 * This is the merge-re-add catcher: it reads the *real* fork source
 * (`forks/ruflo/v3/@claude-flow/cli/package.json`), so a future upstream
 * `--theirs` merge that re-introduces `ruflo` fails this test
 * immediately. The synthetic-input `codemod-bin-preservation.test.mjs`
 * cannot catch a real-source re-add — it only proves the codemod doesn't
 * inject `ruflo`.
 *
 * Settled KEEP: `ruflo-mcp` stays — it has an active acceptance consumer
 * (`lib/acceptance-adr0113-plugin-checks.sh` spawns the bin directly).
 * Only `ruflo` is removed by ADR-0212.
 *
 * The `cli` alias stays because `npx @sparkleideas/cli@latest ...`
 * derives the executable name from the unscoped package name (`cli`)
 * and fails with "could not determine executable to run" otherwise.
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Fork dir from config/upstream-branches.json (single source of truth) —
// a relative ../../../ escape resolves wrongly under .claude/worktrees/.
const _branches = JSON.parse(
  readFileSync(join(__dirname, '../../config/upstream-branches.json'), 'utf8'),
);
const FORK_PKG = join(_branches.ruflo.dir, 'v3/@claude-flow/cli/package.json');

describe('ADR-0212: CLI bin map — `ruflo` removed (wrapper owns it)', () => {
  const pkg = JSON.parse(readFileSync(FORK_PKG, 'utf8'));

  it('bin map exists', () => {
    assert.equal(typeof pkg.bin, 'object');
    assert.ok(pkg.bin !== null);
  });

  it('does NOT expose `ruflo` (ADR-0212 Option B — wrapper-only)', () => {
    assert.ok(
      !('ruflo' in pkg.bin),
      'bin.ruflo must NOT be present — ADR-0212 removed it so `.bin/ruflo` ' +
      'resolves deterministically to the wrapper (@sparkleideas/ruflo). ' +
      'If you see this fail after a `--theirs` merge: re-remove the key.',
    );
  });

  it('keeps `ruflo-mcp` pointing at ./bin/mcp-server.js (settled KEEP — active acceptance consumer)', () => {
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
    // fails with "could not determine executable to run".
    assert.equal(pkg.bin.cli, './bin/cli.js');
  });

  it('name stays @claude-flow/cli in fork source (codemod rewrites at publish)', () => {
    assert.equal(pkg.name, '@claude-flow/cli');
  });
});
