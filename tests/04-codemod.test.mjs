// @tier unit
// Tests for scripts/codemod.mjs — scope-rename codemod.

import { describe, it, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { writeFileSync, readFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// Import the codemod transform function under test.
const { transform } = await import(resolve(ROOT, 'scripts', 'codemod.mjs'));

/** Create a temp directory for a test case. */
function makeTmpDir() {
  return mkdtempSync(join(tmpdir(), 'cfp-codemod-'));
}

describe('codemod: package.json transform', () => {
  let tmp;
  afterEach(() => { if (tmp) rmSync(tmp, { recursive: true, force: true }); });

  it('transforms name, dependencies, peerDependencies, optionalDependencies, bin, and exports', async () => {
    tmp = makeTmpDir();
    const pkg = {
      name: 'claude-flow',
      version: '1.0.0',
      description: 'Should not change claude-flow in description',
      dependencies: {
        '@claude-flow/memory': '^1.0.0',
        'agentdb': '^2.0.0',
        'lodash': '^4.0.0',
      },
      peerDependencies: {
        '@claude-flow/core': '^1.0.0',
      },
      optionalDependencies: {
        'ruflo': '^1.0.0',
      },
      bin: {
        'claude-flow': './bin/cli.js',
      },
      exports: {
        '@claude-flow/memory': { import: './dist/memory.mjs' },
      },
    };
    writeFileSync(join(tmp, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');

    const stats = await transform(tmp);

    const result = JSON.parse(readFileSync(join(tmp, 'package.json'), 'utf8'));
    assert.equal(result.name, '@claude-flow-patch/claude-flow');
    assert.equal(result.version, '1.0.0', 'version must not change');
    assert.ok(result.description.includes('claude-flow'), 'description must not be transformed');

    // dependencies
    assert.ok(result.dependencies['@claude-flow-patch/memory'], 'scoped dep renamed');
    assert.ok(!result.dependencies['@claude-flow/memory'], 'old scoped dep removed');
    assert.ok(result.dependencies['@claude-flow-patch/agentdb'], 'unscoped dep renamed');
    assert.ok(!result.dependencies['agentdb'], 'old unscoped dep removed');
    assert.ok(result.dependencies['lodash'], 'third-party dep untouched');

    // peerDependencies
    assert.ok(result.peerDependencies['@claude-flow-patch/core'], 'peer dep renamed');
    assert.ok(!result.peerDependencies['@claude-flow/core'], 'old peer dep removed');

    // optionalDependencies
    assert.ok(result.optionalDependencies['ruflo-patch'], 'optional dep renamed');
    assert.ok(!result.optionalDependencies['ruflo'], 'old optional dep removed');

    // bin
    assert.ok(result.bin['@claude-flow-patch/claude-flow'], 'bin key renamed');
    assert.ok(!result.bin['claude-flow'], 'old bin key removed');

    // exports
    assert.ok(result.exports['@claude-flow-patch/memory'], 'exports key renamed');
    assert.ok(!result.exports['@claude-flow/memory'], 'old exports key removed');

    assert.equal(stats.packageJsonProcessed, 1);
    assert.equal(stats.filesTransformed, 1);
  });
});

describe('codemod: source file transform', () => {
  let tmp;
  afterEach(() => { if (tmp) rmSync(tmp, { recursive: true, force: true }); });

  it('transforms import and require patterns correctly', async () => {
    tmp = makeTmpDir();
    const source = [
      "import { foo } from '@claude-flow/memory';",
      "const bar = require('claude-flow');",
      "const baz = require('ruflo');",
      "const qux = require('agentdb');",
      "import x from '@claude-flow/core/utils';",
      "const af = require('agentic-flow');",
      "const rs = require('ruv-swarm');",
    ].join('\n');
    writeFileSync(join(tmp, 'source.js'), source);

    await transform(tmp);

    const result = readFileSync(join(tmp, 'source.js'), 'utf8');
    assert.ok(result.includes("from '@claude-flow-patch/memory'"), 'scoped import transformed');
    assert.ok(result.includes("require('@claude-flow-patch/claude-flow')"), 'unscoped claude-flow require transformed');
    assert.ok(result.includes("require('ruflo-patch')"), 'ruflo require transformed');
    assert.ok(result.includes("require('@claude-flow-patch/agentdb')"), 'agentdb require transformed');
    assert.ok(result.includes("from '@claude-flow-patch/core/utils'"), 'scoped deep import transformed');
    assert.ok(result.includes("require('@claude-flow-patch/agentic-flow')"), 'agentic-flow require transformed');
    assert.ok(result.includes("require('@claude-flow-patch/ruv-swarm')"), 'ruv-swarm require transformed');
  });
});

describe('codemod: ordering — scoped before unscoped', () => {
  let tmp;
  afterEach(() => { if (tmp) rmSync(tmp, { recursive: true, force: true }); });

  it('transforms a file with both @claude-flow/memory and claude-flow correctly', async () => {
    tmp = makeTmpDir();
    const source = [
      "import { foo } from '@claude-flow/memory';",
      "const name = 'claude-flow';",
    ].join('\n');
    writeFileSync(join(tmp, 'mixed.js'), source);

    await transform(tmp);

    const result = readFileSync(join(tmp, 'mixed.js'), 'utf8');
    // Scoped must become @claude-flow-patch/memory (not @claude-flow-patch-patch/memory or similar)
    assert.ok(result.includes("'@claude-flow-patch/memory'"), 'scoped transformed correctly');
    // Unscoped must become @claude-flow-patch/claude-flow
    assert.ok(result.includes("'@claude-flow-patch/claude-flow'"), 'unscoped transformed correctly');
    // Must NOT contain double-patched strings
    assert.ok(!result.includes('@claude-flow-patch-patch'), 'no double-replacement');
    assert.ok(!result.includes('@claude-flow-patch/patch'), 'no corruption of already-transformed');
  });
});

describe('codemod: negative lookahead — no double-transform', () => {
  let tmp;
  afterEach(() => { if (tmp) rmSync(tmp, { recursive: true, force: true }); });

  it('does not transform an already-transformed @claude-flow-patch/memory reference', async () => {
    tmp = makeTmpDir();
    const source = "import { foo } from '@claude-flow-patch/memory';\n";
    writeFileSync(join(tmp, 'already.js'), source);

    await transform(tmp);

    const result = readFileSync(join(tmp, 'already.js'), 'utf8');
    assert.equal(result, source, 'already-transformed file must not change');
  });
});

describe('codemod: ruvector untouched', () => {
  let tmp;
  afterEach(() => { if (tmp) rmSync(tmp, { recursive: true, force: true }); });

  it('does not transform @ruvector/core or ruvector references', async () => {
    tmp = makeTmpDir();
    const source = [
      "import { vec } from '@ruvector/core';",
      "const rv = require('ruvector');",
    ].join('\n');
    writeFileSync(join(tmp, 'ruvector.js'), source);

    await transform(tmp);

    const result = readFileSync(join(tmp, 'ruvector.js'), 'utf8');
    assert.equal(result, source, 'ruvector references must not be transformed');
  });
});

describe('codemod: idempotency', () => {
  let tmp;
  afterEach(() => { if (tmp) rmSync(tmp, { recursive: true, force: true }); });

  it('produces identical output when run twice', async () => {
    tmp = makeTmpDir();
    const pkg = {
      name: '@claude-flow/memory',
      dependencies: { 'claude-flow': '^1.0.0', 'agentdb': '^2.0.0' },
    };
    writeFileSync(join(tmp, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
    const source = [
      "import { foo } from '@claude-flow/memory';",
      "const bar = require('ruflo');",
    ].join('\n');
    writeFileSync(join(tmp, 'app.js'), source);

    // First run
    await transform(tmp);
    const afterFirst = {
      pkg: readFileSync(join(tmp, 'package.json'), 'utf8'),
      src: readFileSync(join(tmp, 'app.js'), 'utf8'),
    };

    // Second run
    await transform(tmp);
    const afterSecond = {
      pkg: readFileSync(join(tmp, 'package.json'), 'utf8'),
      src: readFileSync(join(tmp, 'app.js'), 'utf8'),
    };

    assert.equal(afterFirst.pkg, afterSecond.pkg, 'package.json must be identical after second run');
    assert.equal(afterFirst.src, afterSecond.src, 'source file must be identical after second run');
  });
});

describe('codemod: exclusions', () => {
  let tmp;
  afterEach(() => { if (tmp) rmSync(tmp, { recursive: true, force: true }); });

  it('does not transform files inside .git/ directory', async () => {
    tmp = makeTmpDir();
    const gitDir = join(tmp, '.git');
    mkdirSync(gitDir, { recursive: true });
    const gitFile = join(gitDir, 'config.js');
    const original = "const x = require('claude-flow');\n";
    writeFileSync(gitFile, original);

    // Also add a transformable file to verify codemod still runs
    writeFileSync(join(tmp, 'app.js'), "const x = require('claude-flow');\n");

    await transform(tmp);

    assert.equal(readFileSync(gitFile, 'utf8'), original, '.git/ contents must not be transformed');
    const appResult = readFileSync(join(tmp, 'app.js'), 'utf8');
    assert.ok(appResult.includes('@claude-flow-patch/claude-flow'), 'non-.git file was transformed');
  });

  it('does not transform files inside node_modules/ directory', async () => {
    tmp = makeTmpDir();
    const nmDir = join(tmp, 'node_modules', 'some-pkg');
    mkdirSync(nmDir, { recursive: true });
    const nmFile = join(nmDir, 'index.js');
    const original = "const x = require('claude-flow');\n";
    writeFileSync(nmFile, original);

    writeFileSync(join(tmp, 'app.js'), "const x = require('claude-flow');\n");

    await transform(tmp);

    assert.equal(readFileSync(nmFile, 'utf8'), original, 'node_modules/ contents must not be transformed');
  });
});

describe('codemod: unscoped word boundaries', () => {
  let tmp;
  afterEach(() => { if (tmp) rmSync(tmp, { recursive: true, force: true }); });

  it('does not transform agentdb-onnx to @claude-flow-patch/agentdb-onnx', async () => {
    tmp = makeTmpDir();
    const source = [
      "const onnx = require('agentdb-onnx');",
      "const db = require('agentdb');",
    ].join('\n');
    writeFileSync(join(tmp, 'boundary.js'), source);

    await transform(tmp);

    const result = readFileSync(join(tmp, 'boundary.js'), 'utf8');
    assert.ok(result.includes("require('agentdb-onnx')"), 'agentdb-onnx must NOT be transformed');
    assert.ok(result.includes("require('@claude-flow-patch/agentdb')"), 'bare agentdb must be transformed');
  });

  it('does not transform ruflo-patch to ruflo-patch-patch', async () => {
    tmp = makeTmpDir();
    const source = "const x = require('ruflo-patch');\n";
    writeFileSync(join(tmp, 'ruflo.js'), source);

    await transform(tmp);

    const result = readFileSync(join(tmp, 'ruflo.js'), 'utf8');
    assert.equal(result, source, 'ruflo-patch must not be double-transformed');
  });
});
