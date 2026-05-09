// @tier pipeline
// Tests for scripts/codemod-symlink-workspace.mjs — ADR-0162 follow-up.
//
// Verifies the intra-workspace symlink pass that runs after codemod
// renames @claude-flow/* → @sparkleideas/*. The pass walks every
// v3/@claude-flow/<pkg>/package.json and creates relative symlinks at
// <pkg>/node_modules/@sparkleideas/<dep> for every dep whose source is
// in the same build tree. Externals (no in-tree source) are skipped —
// they resolve from Verdaccio at acceptance.

import { describe, it, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  writeFileSync, mkdtempSync, rmSync, mkdirSync, lstatSync, readlinkSync,
  existsSync, realpathSync,
} from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const { linkWorkspace } = await import(
  resolve(ROOT, 'scripts', 'codemod-symlink-workspace.mjs')
);

function makeTmpDir() {
  return mkdtempSync(join(tmpdir(), 'cfp-symlink-'));
}

/**
 * Build a fake post-codemod workspace tree mirroring
 * /tmp/ruflo-build/v3/@claude-flow/<pkg>/package.json layout.
 */
function seedWorkspace(buildDir, packages) {
  const wsRoot = join(buildDir, 'v3', '@claude-flow');
  mkdirSync(wsRoot, { recursive: true });
  for (const [shortName, pkgJson] of Object.entries(packages)) {
    const dir = join(wsRoot, shortName);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'),
      JSON.stringify(pkgJson, null, 2) + '\n');
  }
}

describe('codemod-symlink-workspace: intra-workspace deps', () => {
  let tmp;
  afterEach(() => { if (tmp) rmSync(tmp, { recursive: true, force: true }); });

  it('creates symlinks for cli-core, shared, mcp, neural under cli/node_modules', async () => {
    tmp = makeTmpDir();
    seedWorkspace(tmp, {
      cli: {
        name: '@sparkleideas/cli',
        version: '1.0.0',
        dependencies: {
          '@sparkleideas/cli-core': '^1.0.0',
          '@sparkleideas/shared': '^1.0.0',
          '@sparkleideas/mcp': '^1.0.0',
          '@sparkleideas/neural': '^1.0.0',
          'semver': '^7.0.0', // unscoped third-party — must be ignored
        },
      },
      'cli-core': { name: '@sparkleideas/cli-core', version: '1.0.0' },
      shared: { name: '@sparkleideas/shared', version: '1.0.0' },
      mcp: { name: '@sparkleideas/mcp', version: '1.0.0' },
      neural: { name: '@sparkleideas/neural', version: '1.0.0' },
    });

    const stats = await linkWorkspace(tmp);
    assert.equal(stats.linksCreated, 4, 'four in-tree deps linked');
    assert.equal(stats.externalsSkipped, 0, 'no externals in this tree');

    const cliNm = join(tmp, 'v3', '@claude-flow', 'cli', 'node_modules', '@sparkleideas');
    for (const dep of ['cli-core', 'shared', 'mcp', 'neural']) {
      const link = join(cliNm, dep);
      assert.ok(lstatSync(link).isSymbolicLink(),
        `${dep} symlink exists`);
      const target = readlinkSync(link);
      assert.ok(target.startsWith('..'),
        `${dep} target is relative (got: ${target})`);
      const resolved = realpathSync(link);
      const expectedDir = realpathSync(join(tmp, 'v3', '@claude-flow', dep));
      assert.equal(resolved, expectedDir,
        `${dep} symlink resolves to expected directory`);
    }
  });

  it('skips externals (rabitq-wasm, agentdb, agentic-flow — no source in tree)', async () => {
    tmp = makeTmpDir();
    seedWorkspace(tmp, {
      cli: {
        name: '@sparkleideas/cli',
        version: '1.0.0',
        dependencies: {
          '@sparkleideas/cli-core': '^1.0.0',
          '@sparkleideas/ruvector-rabitq-wasm': '^0.1.0',
        },
        optionalDependencies: {
          '@sparkleideas/agentdb': '^3.0.0',
          '@sparkleideas/agentic-flow': '^2.0.0',
        },
      },
      'cli-core': { name: '@sparkleideas/cli-core', version: '1.0.0' },
    });

    const stats = await linkWorkspace(tmp);
    assert.equal(stats.linksCreated, 1, 'only cli-core (in-tree) is linked');
    assert.equal(stats.externalsSkipped, 3,
      'rabitq-wasm, agentdb, agentic-flow are externals — left for Verdaccio');

    const nm = join(tmp, 'v3', '@claude-flow', 'cli', 'node_modules', '@sparkleideas');
    assert.ok(lstatSync(join(nm, 'cli-core')).isSymbolicLink(),
      'cli-core link present');
    for (const ext of ['ruvector-rabitq-wasm', 'agentdb', 'agentic-flow']) {
      assert.ok(!existsSync(join(nm, ext)),
        `${ext} is NOT linked (resolves from Verdaccio at acceptance)`);
    }
  });

  it('symlink targets point to existing directories', async () => {
    tmp = makeTmpDir();
    seedWorkspace(tmp, {
      a: {
        name: '@sparkleideas/a',
        version: '1.0.0',
        dependencies: { '@sparkleideas/b': '^1.0.0' },
      },
      b: { name: '@sparkleideas/b', version: '1.0.0' },
    });

    await linkWorkspace(tmp);
    const link = join(tmp, 'v3', '@claude-flow', 'a', 'node_modules',
      '@sparkleideas', 'b');
    const real = realpathSync(link);
    assert.ok(existsSync(real), 'symlink target dir exists');
    assert.ok(lstatSync(real).isDirectory(), 'symlink target is a directory');
  });

  it('is idempotent — second run reuses links, creates none', async () => {
    tmp = makeTmpDir();
    seedWorkspace(tmp, {
      a: {
        name: '@sparkleideas/a',
        version: '1.0.0',
        dependencies: { '@sparkleideas/b': '^1.0.0' },
      },
      b: { name: '@sparkleideas/b', version: '1.0.0' },
    });

    const first = await linkWorkspace(tmp);
    assert.equal(first.linksCreated, 1);
    assert.equal(first.linksReused, 0);

    const second = await linkWorkspace(tmp);
    assert.equal(second.linksCreated, 0, 'no new links on second run');
    assert.equal(second.linksReused, 1, 'existing link reused');
  });

  it('replaces stale symlinks when target changes', async () => {
    tmp = makeTmpDir();
    seedWorkspace(tmp, {
      a: {
        name: '@sparkleideas/a',
        version: '1.0.0',
        dependencies: { '@sparkleideas/b': '^1.0.0' },
      },
      b: { name: '@sparkleideas/b', version: '1.0.0' },
    });

    // Pre-create a stale symlink pointing to a wrong target.
    const nm = join(tmp, 'v3', '@claude-flow', 'a', 'node_modules', '@sparkleideas');
    mkdirSync(nm, { recursive: true });
    const { symlinkSync } = await import('node:fs');
    symlinkSync('../../../../nonexistent', join(nm, 'b'), 'dir');

    const stats = await linkWorkspace(tmp);
    assert.equal(stats.linksCreated, 1, 'stale link replaced');
    const target = readlinkSync(join(nm, 'b'));
    assert.ok(!target.includes('nonexistent'), 'stale target removed');
    const resolved = realpathSync(join(nm, 'b'));
    assert.equal(resolved, realpathSync(join(tmp, 'v3', '@claude-flow', 'b')));
  });

  it('refuses to overwrite a real directory at the link path (fails loud)', async () => {
    tmp = makeTmpDir();
    seedWorkspace(tmp, {
      a: {
        name: '@sparkleideas/a',
        version: '1.0.0',
        dependencies: { '@sparkleideas/b': '^1.0.0' },
      },
      b: { name: '@sparkleideas/b', version: '1.0.0' },
    });

    // Pre-create a REAL directory where the symlink would go — pipeline
    // must NOT silently overwrite (feedback-no-fallbacks).
    const nm = join(tmp, 'v3', '@claude-flow', 'a', 'node_modules', '@sparkleideas');
    mkdirSync(nm, { recursive: true });
    mkdirSync(join(nm, 'b'));
    writeFileSync(join(nm, 'b', 'real-file.txt'), 'do not delete');

    await assert.rejects(
      () => linkWorkspace(tmp),
      /Refusing to overwrite real entry/,
      'real directory triggers loud failure'
    );
    // Confirm the real file is untouched.
    assert.ok(existsSync(join(nm, 'b', 'real-file.txt')),
      'real file preserved after failed run');
  });

  it('handles multiple packages each with their own dep set', async () => {
    tmp = makeTmpDir();
    seedWorkspace(tmp, {
      cli: {
        name: '@sparkleideas/cli',
        version: '1.0.0',
        dependencies: {
          '@sparkleideas/cli-core': '^1.0.0',
          '@sparkleideas/shared': '^1.0.0',
        },
      },
      memory: {
        name: '@sparkleideas/memory',
        version: '1.0.0',
        dependencies: { '@sparkleideas/shared': '^1.0.0' },
      },
      'cli-core': { name: '@sparkleideas/cli-core', version: '1.0.0' },
      shared: { name: '@sparkleideas/shared', version: '1.0.0' },
    });

    const stats = await linkWorkspace(tmp);
    assert.equal(stats.packages, 4, 'four packages scanned');
    assert.equal(stats.linksCreated, 3,
      'cli→cli-core, cli→shared, memory→shared');

    assert.ok(lstatSync(join(tmp, 'v3', '@claude-flow', 'cli',
      'node_modules', '@sparkleideas', 'cli-core')).isSymbolicLink());
    assert.ok(lstatSync(join(tmp, 'v3', '@claude-flow', 'memory',
      'node_modules', '@sparkleideas', 'shared')).isSymbolicLink());
  });

  it('reproduces the post-codemod cli/cli-core resolution failure scenario', async () => {
    // This is the canonical regression test: simulate the exact ADR-0162
    // failure mode (cli's package.json declares @sparkleideas/cli-core,
    // cli-core lives as a sibling, no node_modules → ERR_MODULE_NOT_FOUND).
    tmp = makeTmpDir();
    seedWorkspace(tmp, {
      cli: {
        name: '@sparkleideas/cli',
        version: '3.7.0-alpha.10',
        dependencies: {
          '@sparkleideas/cli-core': '3.7.0-alpha.5-patch.3',
          '@sparkleideas/mcp': '3.0.0-alpha.8',
          '@sparkleideas/neural': '3.0.0-alpha.8',
          '@sparkleideas/shared': '3.0.0-alpha.7',
        },
        optionalDependencies: {
          '@sparkleideas/memory': '3.0.0-alpha.15',
          '@sparkleideas/agentdb': '3.0.0-alpha.14', // external
        },
      },
      'cli-core': { name: '@sparkleideas/cli-core', version: '3.7.0-alpha.5' },
      mcp: { name: '@sparkleideas/mcp', version: '3.0.0-alpha.8' },
      neural: { name: '@sparkleideas/neural', version: '3.0.0-alpha.8' },
      shared: { name: '@sparkleideas/shared', version: '3.0.0-alpha.7' },
      memory: { name: '@sparkleideas/memory', version: '3.0.0-alpha.15' },
    });

    const stats = await linkWorkspace(tmp);
    assert.equal(stats.linksCreated, 5,
      'cli-core + mcp + neural + shared + memory all linked');
    assert.equal(stats.externalsSkipped, 1, 'agentdb is external');

    // Verify the critical link: @sparkleideas/cli-core resolves from cli.
    const cliCoreLink = join(tmp, 'v3', '@claude-flow', 'cli',
      'node_modules', '@sparkleideas', 'cli-core');
    assert.ok(lstatSync(cliCoreLink).isSymbolicLink(),
      'cli-core link present (closes ADR-0162 regression)');
    const resolved = realpathSync(cliCoreLink);
    assert.equal(resolved,
      realpathSync(join(tmp, 'v3', '@claude-flow', 'cli-core')),
      'cli-core resolves to in-tree cli-core dir');
  });

  it('throws on missing build dir (feedback-no-fallbacks)', async () => {
    await assert.rejects(
      () => linkWorkspace('/nonexistent/path/should/not/exist'),
      /ENOENT|not a directory/i,
      'missing build dir fails loud'
    );
  });

  it('throws on invalid package.json (feedback-no-fallbacks)', async () => {
    tmp = makeTmpDir();
    const wsRoot = join(tmp, 'v3', '@claude-flow', 'broken');
    mkdirSync(wsRoot, { recursive: true });
    writeFileSync(join(wsRoot, 'package.json'), '{ not valid json');

    await assert.rejects(
      () => linkWorkspace(tmp),
      /Invalid package.json/,
      'invalid JSON fails loud, never silent'
    );
  });
});
