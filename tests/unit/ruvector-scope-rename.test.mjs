// @tier unit
// Tests for @ruvector/* -> @sparkleideas/ruvector-* scope rename in codemod.
//
// The ruvector scope uses a DIFFERENT pattern from @claude-flow/*:
//   @ruvector/core  ->  @sparkleideas/ruvector-core   (hyphen-joined, not slash)
//   @ruvector/attention-darwin-arm64  ->  @sparkleideas/ruvector-attention-darwin-arm64
//
// Unscoped platform binaries also map:
//   ruvector-core-darwin-arm64  ->  @sparkleideas/ruvector-core-darwin-arm64

import { describe, it, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { writeFileSync, readFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

const { transform } = await import(resolve(ROOT, 'scripts', 'codemod.mjs'));

/** Create a temp directory for a test case. */
function makeTmpDir() {
  return mkdtempSync(join(tmpdir(), 'cfp-ruvector-'));
}

// ---------------------------------------------------------------------------
// 1. Package name mapping
// ---------------------------------------------------------------------------

describe('ruvector: package name mapping in package.json', () => {
  let tmp;
  afterEach(() => { if (tmp) rmSync(tmp, { recursive: true, force: true }); });

  it('@ruvector/core -> @sparkleideas/ruvector-core', async () => {
    tmp = makeTmpDir();
    const pkg = { name: '@ruvector/core', version: '0.1.0' };
    writeFileSync(join(tmp, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');

    await transform(tmp);

    const result = JSON.parse(readFileSync(join(tmp, 'package.json'), 'utf8'));
    assert.equal(result.name, '@sparkleideas/ruvector-core');
  });

  it('@ruvector/attention -> @sparkleideas/ruvector-attention', async () => {
    tmp = makeTmpDir();
    const pkg = { name: '@ruvector/attention', version: '0.1.0' };
    writeFileSync(join(tmp, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');

    await transform(tmp);

    const result = JSON.parse(readFileSync(join(tmp, 'package.json'), 'utf8'));
    assert.equal(result.name, '@sparkleideas/ruvector-attention');
  });

  it('@ruvector/sona -> @sparkleideas/ruvector-sona', async () => {
    tmp = makeTmpDir();
    const pkg = { name: '@ruvector/sona', version: '0.1.0' };
    writeFileSync(join(tmp, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');

    await transform(tmp);

    const result = JSON.parse(readFileSync(join(tmp, 'package.json'), 'utf8'));
    assert.equal(result.name, '@sparkleideas/ruvector-sona');
  });
});

// ---------------------------------------------------------------------------
// 2. Unscoped core platform binaries
// ---------------------------------------------------------------------------

describe('ruvector: unscoped platform binary names', () => {
  let tmp;
  afterEach(() => { if (tmp) rmSync(tmp, { recursive: true, force: true }); });

  it('ruvector-core-darwin-arm64 -> @sparkleideas/ruvector-core-darwin-arm64', async () => {
    tmp = makeTmpDir();
    const pkg = { name: 'ruvector-core-darwin-arm64', version: '0.1.0' };
    writeFileSync(join(tmp, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');

    await transform(tmp);

    const result = JSON.parse(readFileSync(join(tmp, 'package.json'), 'utf8'));
    assert.equal(result.name, '@sparkleideas/ruvector-core-darwin-arm64');
  });

  it('ruvector-core-darwin-x64 -> @sparkleideas/ruvector-core-darwin-x64', async () => {
    tmp = makeTmpDir();
    const pkg = { name: 'ruvector-core-darwin-x64', version: '0.1.0' };
    writeFileSync(join(tmp, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');

    await transform(tmp);

    const result = JSON.parse(readFileSync(join(tmp, 'package.json'), 'utf8'));
    assert.equal(result.name, '@sparkleideas/ruvector-core-darwin-x64');
  });

  it('ruvector-core-linux-x64-gnu -> @sparkleideas/ruvector-core-linux-x64-gnu', async () => {
    tmp = makeTmpDir();
    const pkg = { name: 'ruvector-core-linux-x64-gnu', version: '0.1.0' };
    writeFileSync(join(tmp, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');

    await transform(tmp);

    const result = JSON.parse(readFileSync(join(tmp, 'package.json'), 'utf8'));
    assert.equal(result.name, '@sparkleideas/ruvector-core-linux-x64-gnu');
  });

  it('ruvector-core-linux-arm64-gnu -> @sparkleideas/ruvector-core-linux-arm64-gnu', async () => {
    tmp = makeTmpDir();
    const pkg = { name: 'ruvector-core-linux-arm64-gnu', version: '0.1.0' };
    writeFileSync(join(tmp, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');

    await transform(tmp);

    const result = JSON.parse(readFileSync(join(tmp, 'package.json'), 'utf8'));
    assert.equal(result.name, '@sparkleideas/ruvector-core-linux-arm64-gnu');
  });

  it('ruvector-core-win32-x64-msvc -> @sparkleideas/ruvector-core-win32-x64-msvc', async () => {
    tmp = makeTmpDir();
    const pkg = { name: 'ruvector-core-win32-x64-msvc', version: '0.1.0' };
    writeFileSync(join(tmp, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');

    await transform(tmp);

    const result = JSON.parse(readFileSync(join(tmp, 'package.json'), 'utf8'));
    assert.equal(result.name, '@sparkleideas/ruvector-core-win32-x64-msvc');
  });
});

// ---------------------------------------------------------------------------
// 3. Platform binary names under @ruvector/ scope
// ---------------------------------------------------------------------------

describe('ruvector: scoped platform binary names', () => {
  let tmp;
  afterEach(() => { if (tmp) rmSync(tmp, { recursive: true, force: true }); });

  it('@ruvector/attention-darwin-arm64 -> @sparkleideas/ruvector-attention-darwin-arm64', async () => {
    tmp = makeTmpDir();
    const pkg = { name: '@ruvector/attention-darwin-arm64', version: '0.1.0' };
    writeFileSync(join(tmp, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');

    await transform(tmp);

    const result = JSON.parse(readFileSync(join(tmp, 'package.json'), 'utf8'));
    assert.equal(result.name, '@sparkleideas/ruvector-attention-darwin-arm64');
  });
});

// ---------------------------------------------------------------------------
// 4. Import statement rewrite
// ---------------------------------------------------------------------------

describe('ruvector: import statement rewrite', () => {
  let tmp;
  afterEach(() => { if (tmp) rmSync(tmp, { recursive: true, force: true }); });

  it("from '@ruvector/core' -> from '@sparkleideas/ruvector-core'", async () => {
    tmp = makeTmpDir();
    const source = "import { Vec } from '@ruvector/core';\n";
    writeFileSync(join(tmp, 'imports.js'), source);

    await transform(tmp);

    const result = readFileSync(join(tmp, 'imports.js'), 'utf8');
    assert.ok(result.includes("from '@sparkleideas/ruvector-core'"),
      `expected @sparkleideas/ruvector-core, got: ${result}`);
    assert.ok(!result.includes('@ruvector/'), 'old @ruvector/ scope must not remain');
  });

  it("from '@ruvector/attention' -> from '@sparkleideas/ruvector-attention'", async () => {
    tmp = makeTmpDir();
    const source = "import { flash } from '@ruvector/attention';\n";
    writeFileSync(join(tmp, 'attn.ts'), source);

    await transform(tmp);

    const result = readFileSync(join(tmp, 'attn.ts'), 'utf8');
    assert.ok(result.includes("from '@sparkleideas/ruvector-attention'"),
      `expected @sparkleideas/ruvector-attention, got: ${result}`);
  });

  it("deep import from '@ruvector/core/simd' -> from '@sparkleideas/ruvector-core/simd'", async () => {
    tmp = makeTmpDir();
    const source = "import { simdAdd } from '@ruvector/core/simd';\n";
    writeFileSync(join(tmp, 'deep.ts'), source);

    await transform(tmp);

    const result = readFileSync(join(tmp, 'deep.ts'), 'utf8');
    assert.ok(result.includes("from '@sparkleideas/ruvector-core/simd'"),
      `expected deep import rewrite, got: ${result}`);
  });
});

// ---------------------------------------------------------------------------
// 5. Require rewrite
// ---------------------------------------------------------------------------

describe('ruvector: require() rewrite', () => {
  let tmp;
  afterEach(() => { if (tmp) rmSync(tmp, { recursive: true, force: true }); });

  it("require('@ruvector/sona') -> require('@sparkleideas/ruvector-sona')", async () => {
    tmp = makeTmpDir();
    const source = "const sona = require('@ruvector/sona');\n";
    writeFileSync(join(tmp, 'req.cjs'), source);

    await transform(tmp);

    const result = readFileSync(join(tmp, 'req.cjs'), 'utf8');
    assert.ok(result.includes("require('@sparkleideas/ruvector-sona')"),
      `expected @sparkleideas/ruvector-sona, got: ${result}`);
  });

  it("require('@ruvector/core') -> require('@sparkleideas/ruvector-core')", async () => {
    tmp = makeTmpDir();
    const source = "const core = require('@ruvector/core');\n";
    writeFileSync(join(tmp, 'req2.cjs'), source);

    await transform(tmp);

    const result = readFileSync(join(tmp, 'req2.cjs'), 'utf8');
    assert.ok(result.includes("require('@sparkleideas/ruvector-core')"),
      `expected @sparkleideas/ruvector-core, got: ${result}`);
  });

  it("require('ruvector') -> require('@sparkleideas/ruvector') (unscoped)", async () => {
    tmp = makeTmpDir();
    const source = "const rv = require('ruvector');\n";
    writeFileSync(join(tmp, 'bare.cjs'), source);

    await transform(tmp);

    const result = readFileSync(join(tmp, 'bare.cjs'), 'utf8');
    assert.ok(result.includes("require('@sparkleideas/ruvector')"),
      `expected @sparkleideas/ruvector, got: ${result}`);
  });
});

// ---------------------------------------------------------------------------
// 6. Package.json optionalDependencies — keys AND values both renamed
// ---------------------------------------------------------------------------

describe('ruvector: optionalDependencies rename', () => {
  let tmp;
  afterEach(() => { if (tmp) rmSync(tmp, { recursive: true, force: true }); });

  it('renames @ruvector/* keys in optionalDependencies', async () => {
    tmp = makeTmpDir();
    const pkg = {
      name: '@ruvector/core',
      version: '0.1.0',
      optionalDependencies: {
        '@ruvector/attention-darwin-arm64': '0.1.0',
        '@ruvector/attention-darwin-x64': '0.1.0',
        'ruvector-core-darwin-arm64': '0.1.0',
        'ruvector-core-darwin-x64': '0.1.0',
      },
    };
    writeFileSync(join(tmp, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');

    await transform(tmp);

    const result = JSON.parse(readFileSync(join(tmp, 'package.json'), 'utf8'));
    const deps = result.optionalDependencies;

    // Scoped @ruvector/* keys renamed
    assert.ok(deps['@sparkleideas/ruvector-attention-darwin-arm64'],
      'scoped optionalDep key renamed');
    assert.ok(!deps['@ruvector/attention-darwin-arm64'],
      'old scoped key removed');

    assert.ok(deps['@sparkleideas/ruvector-attention-darwin-x64'],
      'second scoped optionalDep key renamed');
    assert.ok(!deps['@ruvector/attention-darwin-x64'],
      'old second scoped key removed');

    // Unscoped ruvector-core-* keys renamed
    assert.ok(deps['@sparkleideas/ruvector-core-darwin-arm64'],
      'unscoped platform key renamed');
    assert.ok(!deps['ruvector-core-darwin-arm64'],
      'old unscoped platform key removed');

    assert.ok(deps['@sparkleideas/ruvector-core-darwin-x64'],
      'second unscoped platform key renamed');
    assert.ok(!deps['ruvector-core-darwin-x64'],
      'old second unscoped platform key removed');
  });

  it('preserves version ranges for renamed ruvector deps', async () => {
    tmp = makeTmpDir();
    const pkg = {
      name: '@ruvector/attention',
      version: '0.1.0',
      optionalDependencies: {
        '@ruvector/attention-darwin-arm64': '^0.1.0',
        'ruvector-core-darwin-arm64': '>=0.1.0-alpha.1',
      },
    };
    writeFileSync(join(tmp, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');

    await transform(tmp);

    const result = JSON.parse(readFileSync(join(tmp, 'package.json'), 'utf8'));
    assert.equal(result.optionalDependencies['@sparkleideas/ruvector-attention-darwin-arm64'],
      '^0.1.0', 'caret range preserved');
    assert.equal(result.optionalDependencies['@sparkleideas/ruvector-core-darwin-arm64'],
      '>=0.1.0-alpha.1', 'gte-prerelease range preserved');
  });
});

// ---------------------------------------------------------------------------
// 7. No package excluded — all @ruvector/* packages are renamed
// ---------------------------------------------------------------------------

describe('ruvector: no excluded packages', () => {
  let tmp;
  afterEach(() => { if (tmp) rmSync(tmp, { recursive: true, force: true }); });

  it('transforms every @ruvector/* subpackage name without skipping any', async () => {
    tmp = makeTmpDir();
    const subpackages = ['core', 'attention', 'sona', 'hnsw', 'ewc', 'flash'];
    for (const sub of subpackages) {
      const dir = join(tmp, sub);
      mkdirSync(dir, { recursive: true });
      const pkg = { name: `@ruvector/${sub}`, version: '0.1.0' };
      writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
    }

    await transform(tmp);

    for (const sub of subpackages) {
      const result = JSON.parse(readFileSync(join(tmp, sub, 'package.json'), 'utf8'));
      assert.equal(result.name, `@sparkleideas/ruvector-${sub}`,
        `@ruvector/${sub} must be renamed, got: ${result.name}`);
    }
  });
});

// ---------------------------------------------------------------------------
// 8. No double-rename — @sparkleideas/ruvector-core must NOT become
//    @sparkleideas/sparkleideas-ruvector-core or @sparkleideas/ruvector-ruvector-core
// ---------------------------------------------------------------------------

describe('ruvector: no double-rename', () => {
  let tmp;
  afterEach(() => { if (tmp) rmSync(tmp, { recursive: true, force: true }); });

  it('already-transformed @sparkleideas/ruvector-core stays unchanged', async () => {
    tmp = makeTmpDir();
    const pkg = { name: '@sparkleideas/ruvector-core', version: '0.1.0' };
    writeFileSync(join(tmp, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');

    await transform(tmp);

    const result = JSON.parse(readFileSync(join(tmp, 'package.json'), 'utf8'));
    assert.equal(result.name, '@sparkleideas/ruvector-core',
      'must not double-rename');
  });

  it('already-transformed import stays unchanged in source', async () => {
    tmp = makeTmpDir();
    const source = "import { Vec } from '@sparkleideas/ruvector-core';\n";
    writeFileSync(join(tmp, 'already.js'), source);

    await transform(tmp);

    const result = readFileSync(join(tmp, 'already.js'), 'utf8');
    assert.equal(result, source, 'already-transformed source must not change');
  });

  it('already-transformed require stays unchanged', async () => {
    tmp = makeTmpDir();
    const source = "const sona = require('@sparkleideas/ruvector-sona');\n";
    writeFileSync(join(tmp, 'already.cjs'), source);

    await transform(tmp);

    const result = readFileSync(join(tmp, 'already.cjs'), 'utf8');
    assert.equal(result, source, 'already-transformed require must not change');
  });

  it('idempotent: two runs produce identical output', async () => {
    tmp = makeTmpDir();
    const pkg = {
      name: '@ruvector/core',
      version: '0.1.0',
      dependencies: { '@ruvector/attention': '^0.1.0' },
      optionalDependencies: { 'ruvector-core-darwin-arm64': '0.1.0' },
    };
    writeFileSync(join(tmp, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');

    const source = [
      "import { Vec } from '@ruvector/core';",
      "const sona = require('@ruvector/sona');",
      "const rv = require('ruvector');",
    ].join('\n') + '\n';
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

    assert.equal(afterFirst.pkg, afterSecond.pkg, 'package.json identical after second run');
    assert.equal(afterFirst.src, afterSecond.src, 'source file identical after second run');
  });
});

// ---------------------------------------------------------------------------
// 9. Mixed @claude-flow + @ruvector in same file
// ---------------------------------------------------------------------------

describe('ruvector: mixed with @claude-flow scope', () => {
  let tmp;
  afterEach(() => { if (tmp) rmSync(tmp, { recursive: true, force: true }); });

  it('transforms both scopes correctly in the same source file', async () => {
    tmp = makeTmpDir();
    const source = [
      "import { Memory } from '@claude-flow/memory';",
      "import { Vec } from '@ruvector/core';",
      "const db = require('agentdb');",
      "const rv = require('ruvector');",
    ].join('\n') + '\n';
    writeFileSync(join(tmp, 'mixed.js'), source);

    await transform(tmp);

    const result = readFileSync(join(tmp, 'mixed.js'), 'utf8');
    assert.ok(result.includes("from '@sparkleideas/memory'"),
      '@claude-flow/memory transformed');
    assert.ok(result.includes("from '@sparkleideas/ruvector-core'"),
      '@ruvector/core transformed');
    assert.ok(result.includes("require('@sparkleideas/agentdb')"),
      'agentdb transformed');
    assert.ok(result.includes("require('@sparkleideas/ruvector')"),
      'bare ruvector transformed');
  });

  it('transforms both scopes correctly in the same package.json', async () => {
    tmp = makeTmpDir();
    const pkg = {
      name: '@claude-flow/embeddings',
      version: '3.0.0',
      dependencies: {
        '@claude-flow/memory': '^3.0.0',
        '@ruvector/core': '^0.1.0',
        '@ruvector/attention': '^0.1.0',
      },
      optionalDependencies: {
        'ruvector-core-darwin-arm64': '0.1.0',
      },
    };
    writeFileSync(join(tmp, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');

    await transform(tmp);

    const result = JSON.parse(readFileSync(join(tmp, 'package.json'), 'utf8'));
    assert.equal(result.name, '@sparkleideas/embeddings');
    assert.ok(result.dependencies['@sparkleideas/memory'], '@claude-flow dep renamed');
    assert.ok(result.dependencies['@sparkleideas/ruvector-core'], '@ruvector dep renamed');
    assert.ok(result.dependencies['@sparkleideas/ruvector-attention'], '@ruvector attention renamed');
    assert.ok(result.optionalDependencies['@sparkleideas/ruvector-core-darwin-arm64'],
      'unscoped platform dep renamed');

    // Old keys gone
    assert.ok(!result.dependencies['@claude-flow/memory']);
    assert.ok(!result.dependencies['@ruvector/core']);
    assert.ok(!result.dependencies['@ruvector/attention']);
    assert.ok(!result.optionalDependencies['ruvector-core-darwin-arm64']);
  });
});
