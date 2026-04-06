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
const ROOT = resolve(__dirname, '../..');

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
    assert.equal(result.name, '@sparkleideas/claude-flow');
    assert.equal(result.version, '1.0.0', 'version must not change');
    assert.ok(result.description.includes('claude-flow'), 'description must not be transformed');

    // dependencies
    assert.ok(result.dependencies['@sparkleideas/memory'], 'scoped dep renamed');
    assert.ok(!result.dependencies['@claude-flow/memory'], 'old scoped dep removed');
    assert.ok(result.dependencies['@sparkleideas/agentdb'], 'unscoped dep renamed');
    assert.ok(!result.dependencies['agentdb'], 'old unscoped dep removed');
    assert.ok(result.dependencies['lodash'], 'third-party dep untouched');

    // peerDependencies
    assert.ok(result.peerDependencies['@sparkleideas/core'], 'peer dep renamed');
    assert.ok(!result.peerDependencies['@claude-flow/core'], 'old peer dep removed');

    // optionalDependencies
    assert.ok(result.optionalDependencies['@sparkleideas/ruflo'], 'optional dep renamed');
    assert.ok(!result.optionalDependencies['ruflo'], 'old optional dep removed');

    // bin
    assert.ok(result.bin['@sparkleideas/claude-flow'], 'bin key renamed');
    assert.ok(!result.bin['claude-flow'], 'old bin key removed');

    // exports
    assert.ok(result.exports['@sparkleideas/memory'], 'exports key renamed');
    assert.ok(!result.exports['@claude-flow/memory'], 'old exports key removed');

    assert.equal(stats.packageJsonProcessed, 1);
    assert.equal(stats.filesTransformed, 1);
  });
});

describe('codemod: source file transform', () => {
  let tmp;
  afterEach(() => { if (tmp) rmSync(tmp, { recursive: true, force: true }); });

  it('transforms scoped @claude-flow/ and unscoped imports in import/require contexts', async () => {
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
    // Scoped @claude-flow/ references ARE transformed in source files
    assert.ok(result.includes("from '@sparkleideas/memory'"), 'scoped import transformed');
    assert.ok(result.includes("from '@sparkleideas/core/utils'"), 'scoped deep import transformed');
    // Unscoped names in import/require contexts ARE transformed
    assert.ok(result.includes("require('@sparkleideas/claude-flow')"), 'require claude-flow transformed');
    assert.ok(result.includes("require('@sparkleideas/ruflo')"), 'require ruflo transformed');
    assert.ok(result.includes("require('@sparkleideas/agentdb')"), 'require agentdb transformed');
    assert.ok(result.includes("require('@sparkleideas/agentic-flow')"), 'require agentic-flow transformed');
    assert.ok(result.includes("require('@sparkleideas/ruv-swarm')"), 'require ruv-swarm transformed');
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
    // Scoped must become @sparkleideas/memory
    assert.ok(result.includes("'@sparkleideas/memory'"), 'scoped transformed correctly');
    // Unscoped 'claude-flow' in a non-import context (const name = '...') is left alone
    assert.ok(result.includes("'claude-flow'"), 'non-import string left alone');
    // Must NOT contain double-patched strings
    assert.ok(!result.includes('@sparkleideas-patch'), 'no double-replacement');
    assert.ok(!result.includes('@sparkleideas/patch'), 'no corruption of already-transformed');
  });
});

describe('codemod: negative lookahead — no double-transform', () => {
  let tmp;
  afterEach(() => { if (tmp) rmSync(tmp, { recursive: true, force: true }); });

  it('does not transform an already-transformed @sparkleideas/memory reference', async () => {
    tmp = makeTmpDir();
    const source = "import { foo } from '@sparkleideas/memory';\n";
    writeFileSync(join(tmp, 'already.js'), source);

    await transform(tmp);

    const result = readFileSync(join(tmp, 'already.js'), 'utf8');
    assert.equal(result, source, 'already-transformed file must not change');
  });
});

describe('codemod: ruvector scopes', () => {
  let tmp;
  afterEach(() => { if (tmp) rmSync(tmp, { recursive: true, force: true }); });

  it('transforms @ruvector/core to @sparkleideas/ruvector-core (ADR-0071), and bare ruvector in imports', async () => {
    tmp = makeTmpDir();
    const source = [
      "import { vec } from '@ruvector/core';",
      "const rv = require('ruvector');",
    ].join('\n');
    writeFileSync(join(tmp, 'ruvector.js'), source);

    await transform(tmp);

    const result = readFileSync(join(tmp, 'ruvector.js'), 'utf8');
    // ADR-0071: @ruvector/* scope IS now renamed to @sparkleideas/ruvector-*
    assert.ok(result.includes("from '@sparkleideas/ruvector-core'"), '@ruvector/core → @sparkleideas/ruvector-core');
    // bare 'ruvector' in require IS renamed (it's in UNSCOPED_MAP)
    assert.ok(result.includes("require('@sparkleideas/ruvector')"), 'bare ruvector in require transformed');
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
      "const name = 'ruflo';",  // non-import context
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
    const original = "const x = require('@claude-flow/cli');\n";
    writeFileSync(gitFile, original);

    // Also add a transformable file to verify codemod still runs
    writeFileSync(join(tmp, 'app.js'), "const x = require('@claude-flow/cli');\n");

    await transform(tmp);

    assert.equal(readFileSync(gitFile, 'utf8'), original, '.git/ contents must not be transformed');
    const appResult = readFileSync(join(tmp, 'app.js'), 'utf8');
    assert.ok(appResult.includes('@sparkleideas/cli'), 'non-.git file was transformed');
  });

  it('does not transform files inside node_modules/ directory', async () => {
    tmp = makeTmpDir();
    const nmDir = join(tmp, 'node_modules', 'some-pkg');
    mkdirSync(nmDir, { recursive: true });
    const nmFile = join(nmDir, 'index.js');
    const original = "const x = require('@claude-flow/cli');\n";
    writeFileSync(nmFile, original);

    writeFileSync(join(tmp, 'app.js'), "const x = require('@claude-flow/cli');\n");

    await transform(tmp);

    assert.equal(readFileSync(nmFile, 'utf8'), original, 'node_modules/ contents must not be transformed');
  });
});

describe('codemod: ADR-0027 — @sparkleideas/* ranges preserved (no wildcard)', () => {
  let tmp;
  afterEach(() => { if (tmp) rmSync(tmp, { recursive: true, force: true }); });

  it('preserves @sparkleideas/* peerDep ranges after scope rename (ADR-0027)', async () => {
    tmp = makeTmpDir();
    const pkg = {
      name: '@claude-flow/core',
      version: '3.1.0',
      peerDependencies: {
        '@claude-flow/memory': '>=3.0.0-alpha.1',
        '@claude-flow/cli': '^2.0.0',
        'lodash': '>=4.0.0',
      },
    };
    writeFileSync(join(tmp, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');

    await transform(tmp);

    const result = JSON.parse(readFileSync(join(tmp, 'package.json'), 'utf8'));

    // ADR-0027: ranges preserved — fork sets correct versions directly
    assert.equal(result.peerDependencies['@sparkleideas/memory'], '>=3.0.0-alpha.1',
      '>=3.0.0-alpha.1 range preserved');
    assert.equal(result.peerDependencies['@sparkleideas/cli'], '^2.0.0',
      '^2.0.0 range preserved');
    assert.equal(result.peerDependencies['lodash'], '>=4.0.0',
      'third-party peerDep untouched');
  });
});

describe('codemod: source file transforms', () => {
  let tmp;
  afterEach(() => { if (tmp) rmSync(tmp, { recursive: true, force: true }); });

  it('transforms scoped @claude-flow/ references in source files', async () => {
    tmp = makeTmpDir();
    const source = [
      "const db = require('@claude-flow/agentdb');",
      "import { foo } from '@claude-flow/memory';",
    ].join('\n');
    writeFileSync(join(tmp, 'scoped.js'), source);

    await transform(tmp);

    const result = readFileSync(join(tmp, 'scoped.js'), 'utf8');
    assert.ok(result.includes("require('@sparkleideas/agentdb')"), 'scoped agentdb must be transformed');
    assert.ok(result.includes("from '@sparkleideas/memory'"), 'scoped memory must be transformed');
  });

  it('transforms unscoped imports but preserves variable names and property access', async () => {
    tmp = makeTmpDir();
    const source = [
      "const agentdb = require('agentdb');",
      "const x = agentdb.query();",
      "const name = 'my-agentdb-wrapper';",
      "console.log({ agentdb });",
    ].join('\n');
    writeFileSync(join(tmp, 'unscoped.js'), source);

    await transform(tmp);

    const result = readFileSync(join(tmp, 'unscoped.js'), 'utf8');
    // require('agentdb') IS transformed (import context)
    assert.ok(result.includes("require('@sparkleideas/agentdb')"), 'require agentdb transformed');
    // Variable names, property access, and non-import strings are NOT touched
    assert.ok(result.includes("const agentdb"), 'variable name preserved');
    assert.ok(result.includes("agentdb.query()"), 'property access preserved');
    assert.ok(result.includes("'my-agentdb-wrapper'"), 'unrelated string preserved');
    assert.ok(result.includes("{ agentdb }"), 'shorthand property preserved');
  });

  it('does not transform @sparkleideas/ruflo further', async () => {
    tmp = makeTmpDir();
    const source = "const x = require('@sparkleideas/ruflo');\n";
    writeFileSync(join(tmp, 'ruflo.js'), source);

    await transform(tmp);

    const result = readFileSync(join(tmp, 'ruflo.js'), 'utf8');
    assert.equal(result, source, '@sparkleideas/ruflo must not be double-transformed');
  });

  it('does NOT remove autoStart (MC-001 is handled by patch system, not codemod)', async () => {
    tmp = makeTmpDir();
    const source = [
      "CLAUDE_FLOW_MEMORY_BACKEND: options.runtime.memoryBackend,",
      "        }, { autoStart: config.autoStart });",
    ].join('\n');
    writeFileSync(join(tmp, 'mcp-generator.js'), source);

    await transform(tmp);

    const result = readFileSync(join(tmp, 'mcp-generator.js'), 'utf8');
    // autoStart removal is a behavioral fix — belongs in patch/, not codemod
    assert.ok(result.includes('autoStart'), 'codemod must NOT remove autoStart (patch system handles MC-001)');
  });
});

describe('codemod: ADR-0027 — dependency ranges preserved (no wildcard replacement)', () => {
  let tmp;
  afterEach(() => { if (tmp) rmSync(tmp, { recursive: true, force: true }); });

  it('preserves version ranges for @sparkleideas/* deps (ADR-0027)', async () => {
    tmp = makeTmpDir();
    const pkg = {
      name: '@claude-flow/core',
      version: '3.0.0',
      dependencies: {
        '@claude-flow/memory': '^3.0.0',
        '@claude-flow/cli': '>=2.0.0',
        '@claude-flow/utils': '~3.1.0',
        '@claude-flow/hooks': '3.0.0',
        'lodash': '^4.0.0',
      },
    };
    writeFileSync(join(tmp, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');

    await transform(tmp);

    const result = JSON.parse(readFileSync(join(tmp, 'package.json'), 'utf8'));
    // ADR-0027: ranges are preserved — fork sets correct versions directly
    assert.equal(result.dependencies['@sparkleideas/memory'], '^3.0.0', 'caret range preserved');
    assert.equal(result.dependencies['@sparkleideas/cli'], '>=2.0.0', 'gte range preserved');
    assert.equal(result.dependencies['@sparkleideas/utils'], '~3.1.0', 'tilde range preserved');
    assert.equal(result.dependencies['@sparkleideas/hooks'], '3.0.0', 'exact range preserved');
    assert.equal(result.dependencies['lodash'], '^4.0.0', 'third-party dep untouched');
  });

  it('leaves already-"*" ranges as-is', async () => {
    tmp = makeTmpDir();
    const pkg = {
      name: '@sparkleideas/core',
      version: '3.0.0',
      dependencies: { '@sparkleideas/memory': '*' },
    };
    writeFileSync(join(tmp, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');

    await transform(tmp);
    const result = JSON.parse(readFileSync(join(tmp, 'package.json'), 'utf8'));
    assert.equal(result.dependencies['@sparkleideas/memory'], '*');
  });

  it('renames scope but preserves prerelease ranges (ADR-0027)', async () => {
    tmp = makeTmpDir();
    const pkg = {
      name: '@claude-flow/embeddings',
      version: '3.0.0-alpha.1',
      peerDependencies: {
        '@claude-flow/agentic-flow': '^2.0.0',
        '@claude-flow/shared': '^3.0.0',
      },
      dependencies: {
        '@claude-flow/agentdb': '^3.0.0-alpha.1',
      },
    };
    writeFileSync(join(tmp, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');

    await transform(tmp);

    const result = JSON.parse(readFileSync(join(tmp, 'package.json'), 'utf8'));
    // ADR-0027: scope renamed, but version ranges preserved
    assert.equal(result.peerDependencies['@sparkleideas/agentic-flow'], '^2.0.0',
      '^2.0.0 range preserved after scope rename');
    assert.equal(result.peerDependencies['@sparkleideas/shared'], '^3.0.0',
      '^3.0.0 range preserved after scope rename');
    assert.equal(result.dependencies['@sparkleideas/agentdb'], '^3.0.0-alpha.1',
      'prerelease range preserved after scope rename');
  });
});

describe('codemod: unscoped dynamic import() — the agentdb bug', () => {
  let tmp;
  afterEach(() => { if (tmp) rmSync(tmp, { recursive: true, force: true }); });

  it('transforms import("agentdb") to import("@sparkleideas/agentdb")', async () => {
    tmp = makeTmpDir();
    const source = [
      "const agentdbModule = await import('agentdb');",
      'const mod = await import("agentic-flow");',
      "const sub = await import('agentdb/embeddings');",
    ].join('\n');
    writeFileSync(join(tmp, 'dynamic.js'), source);

    await transform(tmp);

    const result = readFileSync(join(tmp, 'dynamic.js'), 'utf8');
    assert.ok(result.includes("import('@sparkleideas/agentdb')"), 'dynamic import agentdb transformed');
    assert.ok(result.includes('import("@sparkleideas/agentic-flow")'), 'dynamic import agentic-flow transformed');
    assert.ok(result.includes("import('@sparkleideas/agentdb/embeddings')"), 'dynamic import with subpath transformed');
  });

  it('transforms from "agentdb" static imports', async () => {
    tmp = makeTmpDir();
    const source = [
      "import { SolverBandit } from 'agentdb';",
      'import type { Config } from "agentic-flow";',
    ].join('\n');
    writeFileSync(join(tmp, 'static.ts'), source);

    await transform(tmp);

    const result = readFileSync(join(tmp, 'static.ts'), 'utf8');
    assert.ok(result.includes("from '@sparkleideas/agentdb'"), 'static import agentdb transformed');
    assert.ok(result.includes('from "@sparkleideas/agentic-flow"'), 'static import agentic-flow transformed');
  });

  it('does NOT transform unscoped names outside import contexts', async () => {
    tmp = makeTmpDir();
    const source = [
      "const agentdb = getDB();",
      "if (agentdb) { agentdb.query(); }",
      "const config = { agentdb: true };",
      "// This uses agentdb internally",
    ].join('\n');
    writeFileSync(join(tmp, 'vars.js'), source);

    await transform(tmp);

    const result = readFileSync(join(tmp, 'vars.js'), 'utf8');
    assert.equal(result, source, 'non-import agentdb references must not change');
  });
});
