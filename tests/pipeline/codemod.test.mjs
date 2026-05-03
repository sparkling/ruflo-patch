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

    // bin — ADR-0006 follow-up 2026-04-21: bin keys are POSIX executable
    // names, NOT package names. npm rejects `/` in them, so
    // `@sparkleideas/claude-flow` would be an invalid bin entry. Keys
    // stay literal; regression-guarded by codemod-bin-preservation.test.mjs.
    assert.ok(result.bin['claude-flow'], 'bin key preserved literally');
    assert.ok(!result.bin['@sparkleideas/claude-flow'], 'bin key must not be scoped');

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

  // ADR-0111 W2 letter G — locks in the contract that the global SCOPED_RE
  // text-replace transforms `@claude-flow/` literals in non-import contexts.
  // Critical for upstream's f3cc99d8b plugin sandbox namespace gate at
  // `plugin-loader.ts: !plugin.name.startsWith('@claude-flow/')` — the
  // codemod must auto-rewrite this literal so plugins published from our
  // distribution (scoped `@sparkleideas/*`) pass the official trust check.
  it('transforms @claude-flow/ literal in non-import contexts (namespace gate, comments, template literals)', async () => {
    tmp = makeTmpDir();
    const source = [
      "// Plugins must be prefixed with @claude-flow/ to be official",
      "if (!plugin.name.startsWith('@claude-flow/')) {",
      "  trustLevel = 'unverified';",
      "}",
      "const officialNamespace = '@claude-flow/';",
      "const fullName = `${'@claude-flow/'}${pkgName}`;",
      "const namespaceCheck = name.includes('@claude-flow/utils');",
    ].join('\n');
    writeFileSync(join(tmp, 'plugin-loader.js'), source);

    await transform(tmp);

    const result = readFileSync(join(tmp, 'plugin-loader.js'), 'utf8');
    assert.ok(result.includes("startsWith('@sparkleideas/')"), 'startsWith literal transformed (f3cc99d8b namespace gate)');
    assert.ok(result.includes("officialNamespace = '@sparkleideas/'"), 'standalone string literal transformed');
    assert.ok(result.includes("'@sparkleideas/'}${pkgName}"), 'template literal placeholder transformed');
    assert.ok(result.includes("includes('@sparkleideas/utils')"), 'includes-with-suffix literal transformed');
    assert.ok(result.includes("@sparkleideas/ to be official"), 'comment also transformed (acceptable noise)');
    assert.ok(!result.includes('@claude-flow/'), 'no @claude-flow/ literals remain anywhere');
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

  // ADR-0111 W1 pre-flight: lock in prefix-rule coverage for the 3 new
  // @ruvector/* packages introduced by the upstream merge program.
  it('transforms ADR-0111 new ruvector packages (ruvllm, graph-node, rabitq-wasm, acorn-wasm)', async () => {
    tmp = makeTmpDir();
    const source = [
      "import { generate } from '@ruvector/ruvllm';",
      "import { GraphNode } from '@ruvector/graph-node';",
      "import { quantize } from '@ruvector/rabitq-wasm';",
      "import { acornFilter } from '@ruvector/acorn-wasm';",
      "const llm = require('@ruvector/ruvllm');",
      "const gn = require('@ruvector/graph-node/sub');",
      "const rab = require('@ruvector/rabitq-wasm');",
      "const acn = require('@ruvector/acorn-wasm');",
    ].join('\n');
    writeFileSync(join(tmp, 'adr0111.js'), source);

    await transform(tmp);

    const result = readFileSync(join(tmp, 'adr0111.js'), 'utf8');
    // Static imports
    assert.ok(result.includes("from '@sparkleideas/ruvector-ruvllm'"),
      '@ruvector/ruvllm → @sparkleideas/ruvector-ruvllm');
    assert.ok(result.includes("from '@sparkleideas/ruvector-graph-node'"),
      '@ruvector/graph-node → @sparkleideas/ruvector-graph-node');
    assert.ok(result.includes("from '@sparkleideas/ruvector-rabitq-wasm'"),
      '@ruvector/rabitq-wasm → @sparkleideas/ruvector-rabitq-wasm');
    assert.ok(result.includes("from '@sparkleideas/ruvector-acorn-wasm'"),
      '@ruvector/acorn-wasm → @sparkleideas/ruvector-acorn-wasm');
    // require() forms (incl. subpath)
    assert.ok(result.includes("require('@sparkleideas/ruvector-ruvllm')"),
      'require @ruvector/ruvllm transformed');
    assert.ok(result.includes("require('@sparkleideas/ruvector-graph-node/sub')"),
      'require @ruvector/graph-node subpath transformed');
    assert.ok(result.includes("require('@sparkleideas/ruvector-rabitq-wasm')"),
      'require @ruvector/rabitq-wasm transformed');
    assert.ok(result.includes("require('@sparkleideas/ruvector-acorn-wasm')"),
      'require @ruvector/acorn-wasm transformed');
    // Original scope must be gone
    assert.ok(!result.includes('@ruvector/'),
      'all @ruvector/* references rewritten');
  });

  it('transforms ADR-0111 new ruvector packages in package.json deps', async () => {
    tmp = makeTmpDir();
    const pkg = {
      name: '@claude-flow/example',
      version: '1.0.0',
      dependencies: {
        '@ruvector/ruvllm': '^0.5.0',
        '@ruvector/graph-node': '~0.2.1',
        '@ruvector/rabitq-wasm': '0.1.0-beta.3',
        '@ruvector/acorn-wasm': '^0.1.0',
      },
      peerDependencies: {
        '@ruvector/ruvllm': '>=0.5.0',
      },
    };
    writeFileSync(join(tmp, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');

    await transform(tmp);

    const result = JSON.parse(readFileSync(join(tmp, 'package.json'), 'utf8'));
    // Keys renamed, version ranges preserved (ADR-0027)
    assert.equal(result.dependencies['@sparkleideas/ruvector-ruvllm'], '^0.5.0',
      'ruvllm dep key renamed, range preserved');
    assert.equal(result.dependencies['@sparkleideas/ruvector-graph-node'], '~0.2.1',
      'graph-node dep key renamed, range preserved');
    assert.equal(result.dependencies['@sparkleideas/ruvector-rabitq-wasm'], '0.1.0-beta.3',
      'rabitq-wasm dep key renamed, prerelease range preserved');
    assert.equal(result.dependencies['@sparkleideas/ruvector-acorn-wasm'], '^0.1.0',
      'acorn-wasm dep key renamed, range preserved');
    assert.equal(result.peerDependencies['@sparkleideas/ruvector-ruvllm'], '>=0.5.0',
      'ruvllm peerDep renamed');
    // Old keys removed
    assert.ok(!result.dependencies['@ruvector/ruvllm']);
    assert.ok(!result.dependencies['@ruvector/graph-node']);
    assert.ok(!result.dependencies['@ruvector/rabitq-wasm']);
    assert.ok(!result.dependencies['@ruvector/acorn-wasm']);
    assert.ok(!result.peerDependencies['@ruvector/ruvllm']);
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

// ADR-0113 Fix 2: codemod processes .md files and rewrites mcp__claude-flow__*
// tool prefixes. These tests lock in the contract that markdown plugin docs
// (`forks/ruflo/plugins/**/*.md`, `forks/ruflo/.claude-plugin/**/*.md`) get
// the same scope rewrites .ts/.json files do, plus the MCP-tool prefix gate.
describe('codemod: ADR-0113 — markdown extension and MCP tool prefix', () => {
  let tmp;
  afterEach(() => { if (tmp) rmSync(tmp, { recursive: true, force: true }); });

  it('rewrites @claude-flow/cli@latest install commands in .md files', async () => {
    tmp = makeTmpDir();
    const source = [
      "## Install",
      "",
      "```",
      "npx -y @claude-flow/cli@latest swarm init",
      "```",
      "",
      "Run `npx -y @claude-flow/cli@latest doctor` to diagnose issues.",
    ].join('\n');
    writeFileSync(join(tmp, 'README.md'), source);

    await transform(tmp);

    const result = readFileSync(join(tmp, 'README.md'), 'utf8');
    assert.ok(result.includes('npx -y @sparkleideas/cli@latest swarm init'),
      'code-fence install command rewritten');
    assert.ok(result.includes('npx -y @sparkleideas/cli@latest doctor'),
      'inline install command rewritten');
    assert.ok(!result.includes('@claude-flow/cli@latest'),
      'no @claude-flow/cli@latest references remain in .md');
  });

  it('rewrites mcp__claude-flow__* tool prefix to mcp__ruflo__*', async () => {
    tmp = makeTmpDir();
    const source = [
      "Use `mcp__claude-flow__memory_store` to persist patterns.",
      "Tools: mcp__claude-flow__swarm_init, mcp__claude-flow__agent_spawn",
      "Some helpers like mcp__claude-flow__hooks_route_v2 also exist.",
      // Phase C addendum: glob-style references in plugin docs.
      "All tools must use the `mcp__claude-flow__*` prefix.",
    ].join('\n');
    writeFileSync(join(tmp, 'tools.md'), source);

    await transform(tmp);

    const result = readFileSync(join(tmp, 'tools.md'), 'utf8');
    assert.ok(result.includes('mcp__ruflo__memory_store'), 'memory_store rewritten');
    assert.ok(result.includes('mcp__ruflo__swarm_init'), 'swarm_init rewritten');
    assert.ok(result.includes('mcp__ruflo__agent_spawn'), 'agent_spawn rewritten');
    assert.ok(result.includes('mcp__ruflo__hooks_route_v2'),
      'mixed alphanumeric+underscore suffix rewritten');
    assert.ok(result.includes('mcp__ruflo__*'),
      'glob-style mcp__claude-flow__* rewritten (Phase C — plugin doc form)');
    assert.ok(!result.includes('mcp__claude-flow__'),
      'no mcp__claude-flow__ references remain');
  });

  it('does NOT rewrite [claude-flow-mcp] log tags (negative case)', async () => {
    tmp = makeTmpDir();
    const source = [
      "Logs look like: `[claude-flow-mcp] tool called`",
      "Process name `claude-flow-mcp-server` stays untouched.",
      "Compare with old name `claude-flow-mcp-wrapper`.",
    ].join('\n');
    writeFileSync(join(tmp, 'logs.md'), source);

    await transform(tmp);

    const result = readFileSync(join(tmp, 'logs.md'), 'utf8');
    assert.ok(result.includes('[claude-flow-mcp]'),
      '[claude-flow-mcp] log tag survives');
    assert.ok(result.includes('claude-flow-mcp-server'),
      'claude-flow-mcp-server hostname survives');
    assert.ok(result.includes('claude-flow-mcp-wrapper'),
      'claude-flow-mcp-wrapper survives');
    assert.equal(result, source, 'log-tag-only file unchanged');
  });

  it('does NOT touch .md files inside node_modules/ (negative case)', async () => {
    tmp = makeTmpDir();
    const nmDir = join(tmp, 'node_modules', 'some-pkg');
    mkdirSync(nmDir, { recursive: true });
    const nmFile = join(nmDir, 'README.md');
    const original = "Run `npx -y @claude-flow/cli@latest swarm` to start.\n";
    writeFileSync(nmFile, original);

    // Sibling file outside node_modules/ verifies codemod still runs
    writeFileSync(join(tmp, 'app.md'),
      "Run `npx -y @claude-flow/cli@latest swarm` to start.\n");

    await transform(tmp);

    assert.equal(readFileSync(nmFile, 'utf8'), original,
      'node_modules/**/*.md must not be transformed');
    const appResult = readFileSync(join(tmp, 'app.md'), 'utf8');
    assert.ok(appResult.includes('@sparkleideas/cli@latest'),
      'sibling .md outside node_modules was transformed');
  });

  it('rewrites code-fence content identically to prose', async () => {
    tmp = makeTmpDir();
    const source = [
      "Prose: install with `npx -y @claude-flow/cli@latest init` first.",
      "",
      "```bash",
      "npx -y @claude-flow/cli@latest init",
      "```",
      "",
      "Prose tool: `mcp__claude-flow__memory_store`.",
      "",
      "```",
      "mcp__claude-flow__memory_store",
      "```",
    ].join('\n');
    writeFileSync(join(tmp, 'mixed.md'), source);

    await transform(tmp);

    const result = readFileSync(join(tmp, 'mixed.md'), 'utf8');
    // Both prose and fenced occurrences are rewritten
    const proseInstall = (result.match(/Prose: install with `npx -y @sparkleideas\/cli@latest init`/g) || []).length;
    const fenceInstall = (result.match(/```bash\nnpx -y @sparkleideas\/cli@latest init\n```/g) || []).length;
    assert.equal(proseInstall, 1, 'prose install command rewritten');
    assert.equal(fenceInstall, 1, 'fenced install command rewritten');
    const proseMcp = (result.match(/Prose tool: `mcp__ruflo__memory_store`/g) || []).length;
    const fenceMcp = (result.match(/```\nmcp__ruflo__memory_store\n```/g) || []).length;
    assert.equal(proseMcp, 1, 'prose MCP tool rewritten');
    assert.equal(fenceMcp, 1, 'fenced MCP tool rewritten');
    assert.ok(!result.includes('@claude-flow/cli@latest'),
      'no @claude-flow/cli@latest remains in either prose or fences');
    assert.ok(!result.includes('mcp__claude-flow__'),
      'no mcp__claude-flow__ remains in either prose or fences');
  });
});

// ADR-0117 Pass 5: rewrite the unscoped `claude-flow@alpha` package
// reference in marketplace surfaces (.claude-plugin/** and plugins/**) so
// upstream-merge regressions don't reintroduce the broken public-npm
// invocation. Source code and docs/adr/** prose are explicitly out of scope.
describe('codemod: ADR-0117 Pass 5 — claude-flow@alpha in marketplace surfaces', () => {
  let tmp;
  afterEach(() => { if (tmp) rmSync(tmp, { recursive: true, force: true }); });

  it('rewrites claude-flow@alpha in .claude-plugin/plugin.json args', async () => {
    tmp = makeTmpDir();
    const cpDir = join(tmp, '.claude-plugin');
    mkdirSync(cpDir, { recursive: true });
    const pluginJson = {
      name: 'fork-marketplace',
      mcpServers: {
        ruflo: {
          command: 'npx',
          args: ['claude-flow@alpha', 'mcp', 'start'],
        },
      },
    };
    writeFileSync(join(cpDir, 'plugin.json'), JSON.stringify(pluginJson, null, 2) + '\n');

    await transform(tmp);

    const result = readFileSync(join(cpDir, 'plugin.json'), 'utf8');
    assert.ok(result.includes('"@sparkleideas/cli@latest"'),
      'args[0] rewritten to @sparkleideas/cli@latest');
    assert.ok(!result.includes('claude-flow@alpha'),
      'no claude-flow@alpha remains');
  });

  it('rewrites claude-flow@alpha in .claude-plugin/hooks/hooks.json shellouts', async () => {
    tmp = makeTmpDir();
    const hooksDir = join(tmp, '.claude-plugin', 'hooks');
    mkdirSync(hooksDir, { recursive: true });
    const hooks = {
      hooks: {
        PreToolUse: [
          { matcher: 'Bash', hooks: [{ type: 'command', command: 'cat | npx claude-flow@alpha hooks pre-bash' }] },
        ],
        Stop: [
          { hooks: [{ type: 'command', command: 'npx claude-flow@alpha hooks session-end' }] },
        ],
      },
    };
    writeFileSync(join(hooksDir, 'hooks.json'), JSON.stringify(hooks, null, 2) + '\n');

    await transform(tmp);

    const result = readFileSync(join(hooksDir, 'hooks.json'), 'utf8');
    const matches = (result.match(/@sparkleideas\/cli@latest/g) || []).length;
    assert.equal(matches, 2, 'both shellouts rewritten');
    assert.ok(!result.includes('claude-flow@alpha'),
      'no claude-flow@alpha remains');
  });

  it('rewrites claude-flow@alpha in plugins/<plugin>/SKILL.md', async () => {
    tmp = makeTmpDir();
    const skillDir = join(tmp, 'plugins', 'ruflo-foo', 'skills', 'bar');
    mkdirSync(skillDir, { recursive: true });
    const source = [
      'Use this skill via:',
      '',
      '```bash',
      'npx claude-flow@alpha mcp start',
      '```',
    ].join('\n');
    writeFileSync(join(skillDir, 'SKILL.md'), source);

    await transform(tmp);

    const result = readFileSync(join(skillDir, 'SKILL.md'), 'utf8');
    assert.ok(result.includes('npx @sparkleideas/cli@latest mcp start'),
      'SKILL.md command rewritten');
    assert.ok(!result.includes('claude-flow@alpha'),
      'no claude-flow@alpha remains');
  });

  it('does NOT rewrite claude-flow@alpha in docs/adr/** prose (negative case)', async () => {
    tmp = makeTmpDir();
    const adrDir = join(tmp, 'docs', 'adr');
    mkdirSync(adrDir, { recursive: true });
    const original = [
      '# ADR-0117',
      '',
      'The legacy invocation `claude-flow@alpha` is documented here for posterity.',
      'Pass 5 rewrites this string in `.claude-plugin/**` and `plugins/**` only.',
    ].join('\n');
    writeFileSync(join(adrDir, 'ADR-0117-test.md'), original);

    await transform(tmp);

    const result = readFileSync(join(adrDir, 'ADR-0117-test.md'), 'utf8');
    assert.ok(result.includes('claude-flow@alpha'),
      'docs/adr/** must keep claude-flow@alpha references for historical accuracy');
  });

  it('does NOT rewrite claude-flow@alpha in source code outside scope (negative case)', async () => {
    tmp = makeTmpDir();
    const srcDir = join(tmp, 'v3', '@claude-flow', 'cli', 'src');
    mkdirSync(srcDir, { recursive: true });
    const source = [
      '// Wrapper that historically required claude-flow@alpha',
      "const PKG = 'claude-flow@alpha';",
      'export { PKG };',
    ].join('\n');
    writeFileSync(join(srcDir, 'wrapper.ts'), source);

    await transform(tmp);

    const result = readFileSync(join(srcDir, 'wrapper.ts'), 'utf8');
    assert.ok(result.includes('claude-flow@alpha'),
      'source code outside .claude-plugin/** and plugins/** must keep claude-flow@alpha');
  });

  it('rewrites claude-flow@alpha in v3/@claude-flow/cli/.claude/skills/<skill>/SKILL.md (init-bundled)', async () => {
    tmp = makeTmpDir();
    const skillDir = join(tmp, 'v3', '@claude-flow', 'cli', '.claude', 'skills', 'sparc-methodology');
    mkdirSync(skillDir, { recursive: true });
    const original = [
      '# SPARC Methodology',
      '',
      'Run with: `npx claude-flow@alpha sparc run dev "task"`',
      'Hook: `npx claude-flow@alpha hooks pre-task --description "..."`',
    ].join('\n');
    writeFileSync(join(skillDir, 'SKILL.md'), original);

    await transform(tmp);

    const result = readFileSync(join(skillDir, 'SKILL.md'), 'utf8');
    assert.ok(result.includes('@sparkleideas/cli@latest'),
      'Pass 5 should rewrite to @sparkleideas/cli@latest in init-bundled skills');
    assert.ok(!result.includes('claude-flow@alpha'),
      'no claude-flow@alpha should remain in init-bundled skill files');
  });

  it('rewrites claude-flow@alpha in v3/@claude-flow/cli/.claude/agents/<agent>.md (init-bundled)', async () => {
    tmp = makeTmpDir();
    const agentDir = join(tmp, 'v3', '@claude-flow', 'cli', '.claude', 'agents');
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(
      join(agentDir, 'researcher.md'),
      '---\nname: researcher\n---\nUse `npx claude-flow@alpha memory search ...`\n',
    );

    await transform(tmp);

    const result = readFileSync(join(agentDir, 'researcher.md'), 'utf8');
    assert.ok(result.includes('@sparkleideas/cli@latest'),
      'Pass 5 should rewrite agent templates');
    assert.ok(!result.includes('claude-flow@alpha'),
      'no claude-flow@alpha in init-bundled agent file');
  });

  it('rewrites claude-flow@alpha in v3/@claude-flow/cli/.claude/commands/<cmd>.md (init-bundled)', async () => {
    tmp = makeTmpDir();
    const cmdDir = join(tmp, 'v3', '@claude-flow', 'cli', '.claude', 'commands');
    mkdirSync(cmdDir, { recursive: true });
    writeFileSync(
      join(cmdDir, 'status.md'),
      '---\nname: status\n---\nRun: `npx claude-flow@alpha status`\n',
    );

    await transform(tmp);

    const result = readFileSync(join(cmdDir, 'status.md'), 'utf8');
    assert.ok(!result.includes('claude-flow@alpha'),
      'init-bundled commands should be rewritten');
  });

  it('does NOT rewrite claude-flow@alpha in v3/@claude-flow/cli/.claude/helpers/<file> (out of scope)', async () => {
    // Pass 5 only covers agents/, commands/, skills/ — not helpers/, settings.json, etc.
    tmp = makeTmpDir();
    const helperDir = join(tmp, 'v3', '@claude-flow', 'cli', '.claude', 'helpers');
    mkdirSync(helperDir, { recursive: true });
    writeFileSync(
      join(helperDir, 'README.md'),
      'Hooks reference claude-flow@alpha for migration notes.\n',
    );

    await transform(tmp);

    const result = readFileSync(join(helperDir, 'README.md'), 'utf8');
    assert.ok(result.includes('claude-flow@alpha'),
      '.claude/helpers/ is not a templated tree shipped to user; out of Pass 5 scope');
  });

  it('does NOT rewrite claude-flow@alpha in v3/.../src/.claude/<anything> (only the cli .claude/ tree)', async () => {
    // Make sure the path filter is anchored — other packages’ .claude trees
    // (e.g. v3/@claude-flow/memory/.claude/) shouldn't get rewritten.
    tmp = makeTmpDir();
    const memDir = join(tmp, 'v3', '@claude-flow', 'memory', '.claude', 'skills', 'foo');
    mkdirSync(memDir, { recursive: true });
    writeFileSync(join(memDir, 'SKILL.md'), 'Run npx claude-flow@alpha test.\n');

    await transform(tmp);

    const result = readFileSync(join(memDir, 'SKILL.md'), 'utf8');
    assert.ok(result.includes('claude-flow@alpha'),
      'only v3/@claude-flow/cli/.claude/{agents,commands,skills}/ is in scope');
  });

  it('does NOT rewrite claude-flow@alpha in root package.json (negative — wrong scope)', async () => {
    tmp = makeTmpDir();
    const pkg = {
      name: '@claude-flow/cli',
      // Some package.jsons reference @alpha tags as keywords or descriptions.
      description: 'Successor of claude-flow@alpha',
    };
    writeFileSync(join(tmp, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');

    await transform(tmp);

    const result = readFileSync(join(tmp, 'package.json'), 'utf8');
    assert.ok(result.includes('claude-flow@alpha'),
      'root package.json (no .claude-plugin/ or plugins/ ancestor) must not be rewritten');
  });

  it('is byte-stable on consecutive runs (Pass 5 idempotency)', async () => {
    tmp = makeTmpDir();
    const cpDir = join(tmp, '.claude-plugin');
    mkdirSync(cpDir, { recursive: true });
    const original = JSON.stringify({
      mcpServers: { ruflo: { command: 'npx', args: ['claude-flow@alpha', 'mcp', 'start'] } },
    }, null, 2) + '\n';
    writeFileSync(join(cpDir, 'plugin.json'), original);

    await transform(tmp);
    const after1 = readFileSync(join(cpDir, 'plugin.json'), 'utf8');
    await transform(tmp);
    const after2 = readFileSync(join(cpDir, 'plugin.json'), 'utf8');

    assert.equal(after1, after2, 'consecutive runs produce identical output');
    assert.ok(!after1.includes('claude-flow@alpha'),
      'first run already replaced claude-flow@alpha');
  });
});
