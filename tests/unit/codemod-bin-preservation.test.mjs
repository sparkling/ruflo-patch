// @tier unit
// Codemod must NOT rewrite `bin` keys via UNSCOPED_MAP.
// Bin keys are POSIX executable names (e.g., `ruflo`, `claude-flow`) and npm
// rejects `/` in them. Rewriting `ruflo` -> `@sparkleideas/ruflo` as a bin key
// produces an invalid executable that `npm i -g` silently skips.
// See: ADR-0006 follow-up 2026-04-21 (CLI bin rebrand to ruflo) and the
// ADR-0069 swarm review (rebrand agent findings).

import { describe, it, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { writeFileSync, readFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

const { transform } = await import(resolve(ROOT, 'scripts', 'codemod.mjs'));

function makeTmpDir() {
  return mkdtempSync(join(tmpdir(), 'cfp-bin-'));
}

function writePkg(dir, pkg) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
}

function readPkg(dir) {
  return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
}

describe('codemod: bin keys are never rewritten via UNSCOPED_MAP', () => {
  let tmp;
  afterEach(() => { if (tmp) rmSync(tmp, { recursive: true, force: true }); });

  it('ruflo bin key stays literal `ruflo` (not `@sparkleideas/ruflo`)', async () => {
    tmp = makeTmpDir();
    writePkg(tmp, {
      name: '@claude-flow/cli',
      version: '1.0.0',
      bin: {
        ruflo: './bin/cli.js',
        'ruflo-mcp': './bin/mcp-server.js',
      },
    });
    await transform(tmp);
    const pkg = readPkg(tmp);
    assert.equal(pkg.name, '@sparkleideas/cli', 'package name rewritten correctly');
    assert.ok(pkg.bin.ruflo, 'bin.ruflo preserved');
    assert.ok(pkg.bin['ruflo-mcp'], 'bin.ruflo-mcp preserved');
    assert.ok(!('@sparkleideas/ruflo' in pkg.bin), 'no scoped bin key introduced');
  });

  it('claude-flow bin key stays literal (not scoped)', async () => {
    tmp = makeTmpDir();
    writePkg(tmp, {
      name: '@claude-flow/cli',
      version: '1.0.0',
      bin: {
        'claude-flow': './bin/cli.js',
        'claude-flow-mcp': './bin/mcp-server.js',
      },
    });
    await transform(tmp);
    const pkg = readPkg(tmp);
    assert.ok(pkg.bin['claude-flow'], 'bin.claude-flow preserved');
    assert.ok(pkg.bin['claude-flow-mcp'], 'bin.claude-flow-mcp preserved');
    assert.ok(!('@sparkleideas/claude-flow' in pkg.bin), 'no scoped bin key introduced');
  });

  it('mixed rebrand bin map survives codemod with every key literal', async () => {
    tmp = makeTmpDir();
    writePkg(tmp, {
      name: '@claude-flow/cli',
      version: '1.0.0',
      bin: {
        ruflo: './bin/cli.js',
        'ruflo-mcp': './bin/mcp-server.js',
        'claude-flow': './bin/cli.js',
        'claude-flow-mcp': './bin/mcp-server.js',
      },
    });
    await transform(tmp);
    const keys = Object.keys(readPkg(tmp).bin).sort();
    assert.deepEqual(
      keys,
      ['claude-flow', 'claude-flow-mcp', 'ruflo', 'ruflo-mcp'],
      'all 4 literal bin names preserved; no scoped keys',
    );
    for (const k of keys) {
      assert.ok(!k.includes('/'), `bin key "${k}" must not contain slash`);
      assert.ok(!k.startsWith('@'), `bin key "${k}" must not start with @`);
    }
  });
});

describe('codemod: exports object keys untouched (subpaths, not package names)', () => {
  let tmp;
  afterEach(() => { if (tmp) rmSync(tmp, { recursive: true, force: true }); });

  it('conditional exports subpaths survive verbatim', async () => {
    tmp = makeTmpDir();
    writePkg(tmp, {
      name: '@claude-flow/memory',
      version: '1.0.0',
      exports: {
        '.': { import: './dist/index.js', types: './dist/index.d.ts' },
        './bm25': { import: './dist/bm25.js', types: './dist/bm25.d.ts' },
      },
    });
    await transform(tmp);
    const pkg = readPkg(tmp);
    assert.equal(pkg.name, '@sparkleideas/memory');
    assert.ok(pkg.exports['.'], 'root export preserved');
    assert.ok(pkg.exports['./bm25'], 'subpath export preserved');
  });
});
