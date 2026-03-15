// @tier unit
// Tests for scripts/fork-version.mjs — fork version bumping (ADR-0027 step 3.6).

import { describe, it, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { writeFileSync, readFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

const { bumpPatchVersion, findPackages, bumpAll } = await import(
  resolve(ROOT, 'scripts', 'fork-version.mjs')
);

// All bumpAll calls in tests use skipNpmCheck to avoid real npm queries.
const UNIT_OPTS = { skipNpmCheck: true };

/** Create a temp directory for a test case. */
function makeTmpDir() {
  return mkdtempSync(join(tmpdir(), 'cfp-forkver-'));
}

/** Write a package.json into a directory. */
function writePkg(dir, pkg) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
}

// ── bumpPatchVersion: version parsing and incrementing ──

describe('bumpPatchVersion: basic semver', () => {
  it('appends -patch.1 to a plain semver version', () => {
    assert.equal(bumpPatchVersion('3.1.0'), '3.1.0-patch.1');
  });

  it('increments an existing -patch.N suffix', () => {
    assert.equal(bumpPatchVersion('3.1.0-patch.1'), '3.1.0-patch.2');
  });

  it('increments high patch numbers', () => {
    assert.equal(bumpPatchVersion('1.0.0-patch.99'), '1.0.0-patch.100');
  });
});

describe('bumpPatchVersion: pre-release versions', () => {
  it('appends -patch.1 to an alpha pre-release', () => {
    assert.equal(bumpPatchVersion('3.0.0-alpha.6'), '3.0.0-alpha.6-patch.1');
  });

  it('increments patch on an alpha pre-release that already has -patch.N', () => {
    assert.equal(bumpPatchVersion('3.0.0-alpha.6-patch.1'), '3.0.0-alpha.6-patch.2');
  });

  it('appends -patch.1 to an rc pre-release', () => {
    assert.equal(bumpPatchVersion('2.0.0-rc.1'), '2.0.0-rc.1-patch.1');
  });

  it('increments patch on an rc pre-release with existing patch', () => {
    assert.equal(bumpPatchVersion('2.0.0-rc.1-patch.3'), '2.0.0-rc.1-patch.4');
  });

  it('appends -patch.1 to a beta pre-release', () => {
    assert.equal(bumpPatchVersion('1.5.0-beta.2'), '1.5.0-beta.2-patch.1');
  });

  it('handles multiple pre-release segments', () => {
    assert.equal(bumpPatchVersion('3.0.0-alpha.1.rc.2'), '3.0.0-alpha.1.rc.2-patch.1');
  });

  it('increments patch on multiple pre-release segments', () => {
    assert.equal(
      bumpPatchVersion('3.0.0-alpha.1.rc.2-patch.5'),
      '3.0.0-alpha.1.rc.2-patch.6',
    );
  });
});

describe('bumpPatchVersion: upstream version change resets patch', () => {
  it('new upstream version gets -patch.1 (reset behavior)', () => {
    assert.equal(bumpPatchVersion('3.2.0'), '3.2.0-patch.1');
  });

  it('new upstream pre-release gets -patch.1', () => {
    assert.equal(bumpPatchVersion('4.0.0-alpha.1'), '4.0.0-alpha.1-patch.1');
  });
});

describe('bumpPatchVersion: edge cases', () => {
  it('handles 0.0.0 version', () => {
    assert.equal(bumpPatchVersion('0.0.0'), '0.0.0-patch.1');
  });

  it('handles -patch.0 (zero patch)', () => {
    assert.equal(bumpPatchVersion('1.0.0-patch.0'), '1.0.0-patch.1');
  });
});

// ── findPackages: package discovery ──

describe('findPackages: scoped packages', () => {
  let tmp;
  afterEach(() => { if (tmp) rmSync(tmp, { recursive: true, force: true }); });

  it('finds @claude-flow/* packages', () => {
    tmp = makeTmpDir();
    writePkg(join(tmp, 'packages', 'cli'), { name: '@claude-flow/cli', version: '3.0.0' });
    writePkg(join(tmp, 'packages', 'memory'), { name: '@claude-flow/memory', version: '3.0.0' });

    const results = findPackages(tmp);
    assert.equal(results.length, 2);
    const names = results.map(r => r.pkg.name).sort();
    assert.deepEqual(names, ['@claude-flow/cli', '@claude-flow/memory']);
  });

  it('finds @sparkleideas/* packages', () => {
    tmp = makeTmpDir();
    writePkg(join(tmp, 'pkg'), { name: '@sparkleideas/cli', version: '1.0.0' });

    const results = findPackages(tmp);
    assert.equal(results.length, 1);
    assert.equal(results[0].pkg.name, '@sparkleideas/cli');
  });
});

describe('findPackages: unscoped publishable packages', () => {
  let tmp;
  afterEach(() => { if (tmp) rmSync(tmp, { recursive: true, force: true }); });

  it('finds unscoped publishable packages (agentdb, agentic-flow, etc.)', () => {
    tmp = makeTmpDir();
    writePkg(join(tmp, 'agentdb'), { name: 'agentdb', version: '2.0.0' });
    writePkg(join(tmp, 'agentic-flow'), { name: 'agentic-flow', version: '1.0.0' });
    writePkg(join(tmp, 'ruv-swarm'), { name: 'ruv-swarm', version: '1.0.0' });

    const results = findPackages(tmp);
    assert.equal(results.length, 3);
    const names = results.map(r => r.pkg.name).sort();
    assert.deepEqual(names, ['agentdb', 'agentic-flow', 'ruv-swarm']);
  });

  it('ignores unscoped packages not in UNSCOPED_PUBLISHABLE set', () => {
    tmp = makeTmpDir();
    writePkg(join(tmp, 'lodash'), { name: 'lodash', version: '4.0.0' });
    writePkg(join(tmp, 'express'), { name: 'express', version: '5.0.0' });

    const results = findPackages(tmp);
    assert.equal(results.length, 0);
  });
});

describe('findPackages: exclusions', () => {
  let tmp;
  afterEach(() => { if (tmp) rmSync(tmp, { recursive: true, force: true }); });

  it('skips node_modules directory', () => {
    tmp = makeTmpDir();
    writePkg(join(tmp, 'node_modules', '@claude-flow', 'cli'), {
      name: '@claude-flow/cli', version: '3.0.0',
    });
    writePkg(join(tmp, 'packages', 'cli'), {
      name: '@claude-flow/cli', version: '3.0.0',
    });

    const results = findPackages(tmp);
    assert.equal(results.length, 1);
    assert.ok(!results[0].path.includes('node_modules'));
  });

  it('skips .git directory', () => {
    tmp = makeTmpDir();
    writePkg(join(tmp, '.git', 'hooks'), {
      name: '@claude-flow/hooks', version: '1.0.0',
    });

    const results = findPackages(tmp);
    assert.equal(results.length, 0);
  });

  it('skips .tsc-toolchain directory', () => {
    tmp = makeTmpDir();
    writePkg(join(tmp, '.tsc-toolchain', 'pkg'), {
      name: '@claude-flow/core', version: '1.0.0',
    });

    const results = findPackages(tmp);
    assert.equal(results.length, 0);
  });

  it('skips malformed package.json files', () => {
    tmp = makeTmpDir();
    const badDir = join(tmp, 'broken');
    mkdirSync(badDir, { recursive: true });
    writeFileSync(join(badDir, 'package.json'), '{ invalid json');

    const results = findPackages(tmp);
    assert.equal(results.length, 0);
  });

  it('skips package.json without a name field', () => {
    tmp = makeTmpDir();
    writePkg(join(tmp, 'noname'), { version: '1.0.0' });

    const results = findPackages(tmp);
    assert.equal(results.length, 0);
  });

  it('returns empty array for nonexistent directory', () => {
    const results = findPackages('/tmp/does-not-exist-fork-version-test');
    assert.deepEqual(results, []);
  });
});

// ── bumpAll: version bumping across packages ──

describe('bumpAll: single package', () => {
  let tmp;
  afterEach(() => { if (tmp) rmSync(tmp, { recursive: true, force: true }); });

  it('bumps a single package version', async () => {
    tmp = makeTmpDir();
    writePkg(tmp, { name: '@claude-flow/cli', version: '3.1.0' });

    const { changes } = await bumpAll(tmp, { ...UNIT_OPTS, dryRun: true });
    assert.equal(changes.length, 1);
    assert.equal(changes[0].name, '@claude-flow/cli');
    assert.equal(changes[0].from, '3.1.0');
    assert.equal(changes[0].to, '3.1.0-patch.1');
  });

  it('writes updated version to disk when dryRun is false', async () => {
    tmp = makeTmpDir();
    writePkg(tmp, { name: '@claude-flow/cli', version: '3.1.0' });

    await bumpAll(tmp, UNIT_OPTS);

    const result = JSON.parse(readFileSync(join(tmp, 'package.json'), 'utf8'));
    assert.equal(result.version, '3.1.0-patch.1');
  });

  it('preserves trailing newline', async () => {
    tmp = makeTmpDir();
    writePkg(tmp, { name: '@claude-flow/cli', version: '1.0.0' });

    await bumpAll(tmp, UNIT_OPTS);

    const raw = readFileSync(join(tmp, 'package.json'), 'utf8');
    assert.ok(raw.endsWith('\n'), 'trailing newline must be preserved');
  });
});

describe('bumpAll: internal dependency updates', () => {
  let tmp;
  afterEach(() => { if (tmp) rmSync(tmp, { recursive: true, force: true }); });

  it('updates internal dependency versions to match bumped versions', async () => {
    tmp = makeTmpDir();
    writePkg(join(tmp, 'cli'), {
      name: '@claude-flow/cli',
      version: '3.1.0',
      dependencies: { '@claude-flow/memory': '3.1.0' },
    });
    writePkg(join(tmp, 'memory'), {
      name: '@claude-flow/memory',
      version: '3.1.0',
    });

    await bumpAll(tmp, UNIT_OPTS);

    const cli = JSON.parse(readFileSync(join(tmp, 'cli', 'package.json'), 'utf8'));
    assert.equal(cli.version, '3.1.0-patch.1');
    assert.equal(cli.dependencies['@claude-flow/memory'], '3.1.0-patch.1',
      'internal dep must be updated to new version');
  });

  it('updates peerDependencies and optionalDependencies too', async () => {
    tmp = makeTmpDir();
    writePkg(join(tmp, 'core'), {
      name: '@claude-flow/core',
      version: '2.0.0',
      peerDependencies: { '@claude-flow/hooks': '2.0.0' },
      optionalDependencies: { '@claude-flow/cuda': '2.0.0' },
    });
    writePkg(join(tmp, 'hooks'), { name: '@claude-flow/hooks', version: '2.0.0' });
    writePkg(join(tmp, 'cuda'), { name: '@claude-flow/cuda', version: '2.0.0' });

    await bumpAll(tmp, UNIT_OPTS);

    const core = JSON.parse(readFileSync(join(tmp, 'core', 'package.json'), 'utf8'));
    assert.equal(core.peerDependencies['@claude-flow/hooks'], '2.0.0-patch.1');
    assert.equal(core.optionalDependencies['@claude-flow/cuda'], '2.0.0-patch.1');
  });

  it('does not touch third-party dependencies', async () => {
    tmp = makeTmpDir();
    writePkg(tmp, {
      name: '@claude-flow/cli',
      version: '3.0.0',
      dependencies: { lodash: '^4.0.0', express: '~5.0.0' },
    });

    await bumpAll(tmp, UNIT_OPTS);

    const result = JSON.parse(readFileSync(join(tmp, 'package.json'), 'utf8'));
    assert.equal(result.dependencies.lodash, '^4.0.0');
    assert.equal(result.dependencies.express, '~5.0.0');
  });
});

describe('bumpAll: cross-scope alias resolution', () => {
  let tmp;
  afterEach(() => { if (tmp) rmSync(tmp, { recursive: true, force: true }); });

  it('resolves @sparkleideas/* refs to @claude-flow/* packages', async () => {
    tmp = makeTmpDir();
    writePkg(join(tmp, 'cli'), {
      name: '@claude-flow/cli',
      version: '3.0.0',
    });
    writePkg(join(tmp, 'wrapper'), {
      name: '@sparkleideas/ruflo',
      version: '3.0.0',
      dependencies: { '@sparkleideas/cli': '3.0.0' },
    });

    await bumpAll(tmp, UNIT_OPTS);

    const wrapper = JSON.parse(readFileSync(join(tmp, 'wrapper', 'package.json'), 'utf8'));
    assert.equal(wrapper.dependencies['@sparkleideas/cli'], '3.0.0-patch.1',
      'cross-scope alias must resolve @sparkleideas/cli to @claude-flow/cli version');
  });

  it('resolves scoped refs to unscoped publishable packages', async () => {
    tmp = makeTmpDir();
    writePkg(join(tmp, 'agentdb'), { name: 'agentdb', version: '2.0.0' });
    writePkg(join(tmp, 'consumer'), {
      name: '@claude-flow/core',
      version: '3.0.0',
      dependencies: {
        '@claude-flow/agentdb': '2.0.0',
        '@sparkleideas/agentdb': '2.0.0',
      },
    });

    await bumpAll(tmp, UNIT_OPTS);

    const consumer = JSON.parse(readFileSync(join(tmp, 'consumer', 'package.json'), 'utf8'));
    assert.equal(consumer.dependencies['@claude-flow/agentdb'], '2.0.0-patch.1',
      '@claude-flow/agentdb alias resolves to unscoped agentdb version');
    assert.equal(consumer.dependencies['@sparkleideas/agentdb'], '2.0.0-patch.1',
      '@sparkleideas/agentdb alias resolves to unscoped agentdb version');
  });
});

describe('bumpAll: multiple fork directories', () => {
  let tmp1, tmp2;
  afterEach(() => {
    if (tmp1) rmSync(tmp1, { recursive: true, force: true });
    if (tmp2) rmSync(tmp2, { recursive: true, force: true });
  });

  it('accepts an array of directories and bumps across all', async () => {
    tmp1 = makeTmpDir();
    tmp2 = makeTmpDir();
    writePkg(join(tmp1, 'cli'), { name: '@claude-flow/cli', version: '3.0.0' });
    writePkg(join(tmp2, 'swarm'), { name: 'ruv-swarm', version: '1.0.0' });

    const { changes } = await bumpAll([tmp1, tmp2], { ...UNIT_OPTS, dryRun: true });
    assert.equal(changes.length, 2);
    const names = changes.map(c => c.name).sort();
    assert.deepEqual(names, ['@claude-flow/cli', 'ruv-swarm']);
  });

  it('resolves cross-fork internal dependencies', async () => {
    tmp1 = makeTmpDir();
    tmp2 = makeTmpDir();
    writePkg(join(tmp1, 'cli'), {
      name: '@claude-flow/cli',
      version: '3.0.0',
      dependencies: { 'ruv-swarm': '1.0.0' },
    });
    writePkg(join(tmp2, 'swarm'), { name: 'ruv-swarm', version: '1.0.0' });

    await bumpAll([tmp1, tmp2], UNIT_OPTS);

    const cli = JSON.parse(readFileSync(join(tmp1, 'cli', 'package.json'), 'utf8'));
    assert.equal(cli.dependencies['ruv-swarm'], '1.0.0-patch.1',
      'cross-fork dep must be updated');
  });
});

describe('bumpAll: dryRun mode', () => {
  let tmp;
  afterEach(() => { if (tmp) rmSync(tmp, { recursive: true, force: true }); });

  it('does not write files when dryRun is true', async () => {
    tmp = makeTmpDir();
    writePkg(tmp, { name: '@claude-flow/cli', version: '3.0.0' });
    const before = readFileSync(join(tmp, 'package.json'), 'utf8');

    await bumpAll(tmp, { ...UNIT_OPTS, dryRun: true });

    const after = readFileSync(join(tmp, 'package.json'), 'utf8');
    assert.equal(before, after, 'file must not change in dryRun mode');
  });

  it('still returns correct changes in dryRun mode', async () => {
    tmp = makeTmpDir();
    writePkg(tmp, { name: '@claude-flow/cli', version: '3.0.0-patch.2' });

    const { changes } = await bumpAll(tmp, { ...UNIT_OPTS, dryRun: true });
    assert.equal(changes.length, 1);
    assert.equal(changes[0].from, '3.0.0-patch.2');
    assert.equal(changes[0].to, '3.0.0-patch.3');
  });
});

describe('bumpAll: empty directory', () => {
  let tmp;
  afterEach(() => { if (tmp) rmSync(tmp, { recursive: true, force: true }); });

  it('returns empty changes for directory with no matching packages', async () => {
    tmp = makeTmpDir();
    writePkg(tmp, { name: 'lodash', version: '4.0.0' });

    const { changes } = await bumpAll(tmp, UNIT_OPTS);
    assert.deepEqual(changes, []);
  });
});

describe('bumpAll: pre-release version handling', () => {
  let tmp;
  afterEach(() => { if (tmp) rmSync(tmp, { recursive: true, force: true }); });

  it('bumps alpha version correctly', async () => {
    tmp = makeTmpDir();
    writePkg(tmp, { name: '@claude-flow/core', version: '3.0.0-alpha.6' });

    const { changes } = await bumpAll(tmp, { ...UNIT_OPTS, dryRun: true });
    assert.equal(changes[0].to, '3.0.0-alpha.6-patch.1');
  });

  it('bumps rc version correctly', async () => {
    tmp = makeTmpDir();
    writePkg(tmp, { name: '@claude-flow/core', version: '2.0.0-rc.3' });

    const { changes } = await bumpAll(tmp, { ...UNIT_OPTS, dryRun: true });
    assert.equal(changes[0].to, '2.0.0-rc.3-patch.1');
  });

  it('bumps already-patched alpha version', async () => {
    tmp = makeTmpDir();
    writePkg(tmp, { name: '@claude-flow/core', version: '3.0.0-alpha.6-patch.4' });

    const { changes } = await bumpAll(tmp, { ...UNIT_OPTS, dryRun: true });
    assert.equal(changes[0].to, '3.0.0-alpha.6-patch.5');
  });
});

describe('bumpAll: idempotent version map', () => {
  let tmp;
  afterEach(() => { if (tmp) rmSync(tmp, { recursive: true, force: true }); });

  it('bumps twice produces sequential patch numbers', async () => {
    tmp = makeTmpDir();
    writePkg(tmp, { name: '@claude-flow/cli', version: '3.0.0' });

    await bumpAll(tmp, UNIT_OPTS);
    const after1 = JSON.parse(readFileSync(join(tmp, 'package.json'), 'utf8'));
    assert.equal(after1.version, '3.0.0-patch.1');

    await bumpAll(tmp, UNIT_OPTS);
    const after2 = JSON.parse(readFileSync(join(tmp, 'package.json'), 'utf8'));
    assert.equal(after2.version, '3.0.0-patch.2');
  });
});
