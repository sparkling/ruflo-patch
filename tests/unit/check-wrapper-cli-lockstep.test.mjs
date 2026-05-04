// @tier unit
// ADR-0142 Guard G1 — tests for scripts/check-wrapper-cli-lockstep.mjs
//
// Covers: parseArgs, readWrapperPin, validatePinShape, main() across all
// three modes (no-pin transitional, default shape-only, --check-registry strict).

import { describe, it, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

const {
  parseArgs,
  readWrapperPin,
  validatePinShape,
  main,
} = await import(resolve(ROOT, 'scripts', 'check-wrapper-cli-lockstep.mjs'));

function makeTmpPkg(deps) {
  const dir = mkdtempSync(join(tmpdir(), 'lockstep-'));
  const pkg = { name: '@sparkleideas/ruflo', version: '1.0.0' };
  if (deps) pkg.dependencies = deps;
  const path = join(dir, 'package.json');
  writeFileSync(path, JSON.stringify(pkg, null, 2));
  return { dir, path };
}

describe('check-wrapper-cli-lockstep: parseArgs', () => {
  it('default flags', () => {
    const r = parseArgs([]);
    assert.equal(r.checkRegistry, false);
    assert.equal(r.registry, 'http://localhost:4873');
  });

  it('--check-registry sets the flag', () => {
    const r = parseArgs(['--check-registry']);
    assert.equal(r.checkRegistry, true);
  });

  it('--registry overrides the URL', () => {
    const r = parseArgs(['--check-registry', '--registry', 'http://example.com:9999']);
    assert.equal(r.registry, 'http://example.com:9999');
  });

  it('--registry without value falls back to default', () => {
    const r = parseArgs(['--registry']);
    assert.equal(r.registry, 'http://localhost:4873');
  });
});

describe('check-wrapper-cli-lockstep: readWrapperPin', () => {
  let tmp;
  afterEach(() => { if (tmp) rmSync(tmp.dir, { recursive: true, force: true }); });

  it('returns null when no dependencies block', async () => {
    tmp = makeTmpPkg();
    const pin = await readWrapperPin(tmp.path);
    assert.equal(pin, null);
  });

  it('returns null when @sparkleideas/cli is not in dependencies', async () => {
    tmp = makeTmpPkg({ 'lodash': '^4.0.0' });
    const pin = await readWrapperPin(tmp.path);
    assert.equal(pin, null);
  });

  it('returns the version string when pinned', async () => {
    tmp = makeTmpPkg({ '@sparkleideas/cli': '3.5.58-patch.342' });
    const pin = await readWrapperPin(tmp.path);
    assert.equal(pin, '3.5.58-patch.342');
  });
});

describe('check-wrapper-cli-lockstep: validatePinShape', () => {
  it('accepts well-formed -patch.N versions', () => {
    assert.deepEqual(validatePinShape('3.5.58-patch.342'), { ok: true });
    assert.deepEqual(validatePinShape('3.1.0-alpha.14-patch.15'), { ok: true });
    assert.deepEqual(validatePinShape('1.0.0-patch.1'), { ok: true });
    assert.deepEqual(validatePinShape('10.20.30-patch.999'), { ok: true });
  });

  it('rejects ranges (^/~)', () => {
    assert.equal(validatePinShape('^3.5.58-patch.342').ok, false);
    assert.equal(validatePinShape('~3.5.58-patch.342').ok, false);
  });

  it('rejects wildcards (*, x, X)', () => {
    assert.equal(validatePinShape('*').ok, false);
    assert.equal(validatePinShape('3.x.0-patch.1').ok, false);
    assert.equal(validatePinShape('3.X.0-patch.1').ok, false);
  });

  it('rejects versions without -patch.N suffix', () => {
    assert.equal(validatePinShape('3.5.58').ok, false);
    assert.equal(validatePinShape('latest').ok, false);
  });

  it('rejects empty/non-string', () => {
    assert.equal(validatePinShape('').ok, false);
    assert.equal(validatePinShape(null).ok, false);
    assert.equal(validatePinShape(undefined).ok, false);
  });
});

describe('check-wrapper-cli-lockstep: main() — no-pin mode', () => {
  let tmp;
  afterEach(() => { if (tmp) rmSync(tmp.dir, { recursive: true, force: true }); });

  it('exits 0 when wrapper has no @sparkleideas/cli pin (Phase 1 transitional)', async () => {
    tmp = makeTmpPkg();
    const code = await main([], tmp.path);
    assert.equal(code, 0);
  });
});

describe('check-wrapper-cli-lockstep: main() — default (shape-only) mode', () => {
  let tmp;
  afterEach(() => { if (tmp) rmSync(tmp.dir, { recursive: true, force: true }); });

  it('exits 0 when pin is well-formed', async () => {
    tmp = makeTmpPkg({ '@sparkleideas/cli': '3.5.58-patch.342' });
    const code = await main([], tmp.path);
    assert.equal(code, 0);
  });

  it('exits 1 when pin is malformed (range)', async () => {
    tmp = makeTmpPkg({ '@sparkleideas/cli': '^3.5.58-patch.342' });
    const code = await main([], tmp.path);
    assert.equal(code, 1);
  });

  it('exits 1 when pin is wildcard (the original c76a727 bug)', async () => {
    tmp = makeTmpPkg({ '@sparkleideas/cli': '*' });
    const code = await main([], tmp.path);
    assert.equal(code, 1);
  });
});

// Note: --check-registry strict mode requires a live registry. Tested via
// the inline pipeline integration in publish-verdaccio.sh + the bin-path
// acceptance check (lib/acceptance-adr0142-bin-path.sh), not as a unit test.
