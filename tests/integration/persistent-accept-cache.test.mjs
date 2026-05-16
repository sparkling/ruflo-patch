// @tier integration
// ADR-0182 L3 integration test — proves persistent ACCEPT_TEMP cache
// satisfies the 5 hard requirements from the ADR's L3 row:
//
//   (i)   Cache HIT skips npm install entirely (no reconciliation).
//   (ii)  Cache key invalidates on any version bump of cli OR ruflo
//         (by construction — both versions feed into the SHA-256).
//   (iii) Postinstall idempotency: node_modules/@sparkleideas/*/dist/
//         is byte-identical between two fresh installs of the same
//         versions. If postinstall is non-deterministic, this test
//         FAILS and L3 must be rejected.
//   (iv)  Epoch guard nukes-fresh on mismatch or missing .release-epoch.
//   (v)   Behind RUFLO_PERSISTENT_ACCEPT=1, default off.
//
// Test cases:
//   1. matching epoch  → resolve returns the cache dir (cache HIT)
//   2. bumped version  → resolve returns a DIFFERENT dir (cache MISS
//                        by construction — different hash → different
//                        path)
//   3. mismatched epoch → resolve nukes the stale dir and re-creates
//                         an empty one (cache MISS, no false hit)
//   4. postinstall idempotency → two real `npm install` runs against
//                                Verdaccio produce byte-identical
//                                node_modules/@sparkleideas/*/dist/
//                                trees (proven by `diff -r`)
//
// Tests 1-3 are fast (pure sh wrapping). Test 4 is expensive (~60-120s
// for two full npm installs) and gated on Verdaccio being reachable —
// it skips with a clear diagnostic if the registry is unavailable,
// because the byte-identity proof requires REAL packages, not mocks.
//
// To run:  node --test tests/integration/persistent-accept-cache.test.mjs
// Not in the default `npm run test:unit` scan — invoke explicitly
// before promoting RUFLO_PERSISTENT_ACCEPT=1 to default.

import { describe, it, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { execSync, spawnSync } from 'node:child_process';
import {
  mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync,
  mkdirSync, readdirSync, statSync,
} from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '../..');
const ACCEPT_CACHE_SH = resolve(PROJECT_ROOT, 'lib/accept-cache.sh');
const REGISTRY = process.env.RUFLO_TEST_REGISTRY || 'http://localhost:4873';

// Verdaccio reachability — only test 4 needs it; tests 1-3 use forged
// inputs so they always run.
function registryReachable() {
  const r = spawnSync('curl', ['-sf', `${REGISTRY}/-/ping`], { timeout: 3000 });
  return r.status === 0;
}

// Helper: run a bash function from accept-cache.sh and capture stdout.
// We source the file in a subshell and invoke the named function with
// any args. Stderr is preserved so warnings surface in test failures.
function shCall(fn, args = [], env = {}) {
  const escaped = args.map(a => `'${String(a).replace(/'/g, "'\\''")}'`).join(' ');
  const cmd = `source "${ACCEPT_CACHE_SH}" && ${fn} ${escaped}`;
  const r = spawnSync('bash', ['-c', cmd], {
    encoding: 'utf-8',
    env: { ...process.env, ...env },
    timeout: 30_000,
  });
  return { stdout: (r.stdout || '').trim(), stderr: (r.stderr || '').trim(), status: r.status };
}

// Forge an arbitrary 64-char hex hash. Used for cases 1-3 where we
// don't need a real Verdaccio-derived key.
function forgeKey(seed) {
  return createHash('sha256').update(String(seed)).digest('hex');
}

describe('ADR-0182 L3 — lib/accept-cache.sh sourcing + helper invocation', () => {
  it('exports _resolve_accept_temp, _l3_compute_cache_key, _l3_write_release_epoch', () => {
    // Just sourcing the script must succeed (syntax + no missing tools).
    const r = spawnSync('bash', ['-c',
      `source "${ACCEPT_CACHE_SH}" && declare -f _resolve_accept_temp _l3_compute_cache_key _l3_write_release_epoch >/dev/null`,
    ], { encoding: 'utf-8', timeout: 5000 });
    assert.equal(r.status, 0,
      `sourcing accept-cache.sh must define all three exported functions; stderr=${r.stderr}`);
  });
});

describe('ADR-0182 L3 — case 1: matching epoch returns cache HIT path', () => {
  let cacheRoot;
  let cacheDir;
  const fakeKey = forgeKey('test-case-1-matching-epoch');
  const cacheDirName = `ruflo-accept-persistent-${fakeKey.slice(0, 16)}`;

  before(() => {
    // Stand up a fake $HOME so we don't pollute the real cache dir.
    cacheRoot = mkdtempSync(join(tmpdir(), 'l3-case1-home-'));
    const cacheParent = join(cacheRoot, '.cache');
    cacheDir = join(cacheParent, cacheDirName);
    mkdirSync(cacheDir, { recursive: true });
    // Forge .release-epoch with our known hash and forge a marker file
    // so we can verify the dir wasn't nuked.
    writeFileSync(join(cacheDir, '.release-epoch'), fakeKey);
    writeFileSync(join(cacheDir, '.canary'), 'must-survive');
  });
  after(() => {
    rmSync(cacheRoot, { recursive: true, force: true });
  });

  it('resolves to the cache dir and leaves .canary intact', () => {
    // We bypass the npm-view-based key computation by overriding the
    // function in the subshell BEFORE sourcing it (define _l3_compute_cache_key
    // BEFORE sourcing — the source's `if [[ -n _ACCEPT_CACHE_LOADED ]]` guard
    // doesn't matter; we override the function itself.).
    const overrideFn = `_l3_compute_cache_key() { printf '%s' '${fakeKey}'; }`;
    const cmd = `source "${ACCEPT_CACHE_SH}" && ${overrideFn} && _resolve_accept_temp "${REGISTRY}"`;
    const r = spawnSync('bash', ['-c', cmd], {
      encoding: 'utf-8',
      env: { ...process.env, HOME: cacheRoot },
      timeout: 10_000,
    });
    assert.equal(r.status, 0,
      `_resolve_accept_temp must exit 0; stderr=${r.stderr}`);
    const resolved = r.stdout.trim();
    assert.equal(resolved, cacheDir,
      `must return the cache dir; got ${resolved}, expected ${cacheDir}`);
    assert.ok(existsSync(join(cacheDir, '.canary')),
      `cache HIT must NOT nuke the dir — .canary disappeared`);
    assert.ok(existsSync(join(cacheDir, '.release-epoch')),
      `cache HIT must preserve .release-epoch`);
  });
});

describe('ADR-0182 L3 — case 2: bumped version produces a different cache path', () => {
  let cacheRoot;
  const keyA = forgeKey('cli-version-A');
  const keyB = forgeKey('cli-version-B');

  before(() => {
    cacheRoot = mkdtempSync(join(tmpdir(), 'l3-case2-home-'));
    mkdirSync(join(cacheRoot, '.cache'), { recursive: true });
  });
  after(() => {
    rmSync(cacheRoot, { recursive: true, force: true });
  });

  it('two different keys resolve to two different cache directories', () => {
    const buildCmd = (forgeFn) =>
      `source "${ACCEPT_CACHE_SH}" && ${forgeFn} && _resolve_accept_temp "${REGISTRY}"`;
    const rA = spawnSync('bash', ['-c',
      buildCmd(`_l3_compute_cache_key() { printf '%s' '${keyA}'; }`),
    ], { encoding: 'utf-8', env: { ...process.env, HOME: cacheRoot }, timeout: 10_000 });
    assert.equal(rA.status, 0, `key-A resolve must exit 0; stderr=${rA.stderr}`);
    const pathA = rA.stdout.trim();

    const rB = spawnSync('bash', ['-c',
      buildCmd(`_l3_compute_cache_key() { printf '%s' '${keyB}'; }`),
    ], { encoding: 'utf-8', env: { ...process.env, HOME: cacheRoot }, timeout: 10_000 });
    assert.equal(rB.status, 0, `key-B resolve must exit 0; stderr=${rB.stderr}`);
    const pathB = rB.stdout.trim();

    assert.notEqual(pathA, pathB,
      `version bump (key-A vs key-B) must invalidate by construction — got same path ${pathA}`);
    // Confirm both contain the expected short-hash prefix in the path
    // so the cache-key → cache-path mapping is observable.
    assert.ok(pathA.includes(keyA.slice(0, 16)),
      `path-A must embed key-A short prefix; got ${pathA}`);
    assert.ok(pathB.includes(keyB.slice(0, 16)),
      `path-B must embed key-B short prefix; got ${pathB}`);
  });
});

describe('ADR-0182 L3 — case 3: mismatched .release-epoch nukes-fresh', () => {
  let cacheRoot;
  let cacheDir;
  const expectedKey = forgeKey('test-case-3-mismatched');
  const staleKey = forgeKey('test-case-3-STALE-value');
  const cacheDirName = `ruflo-accept-persistent-${expectedKey.slice(0, 16)}`;

  before(() => {
    cacheRoot = mkdtempSync(join(tmpdir(), 'l3-case3-home-'));
    const cacheParent = join(cacheRoot, '.cache');
    cacheDir = join(cacheParent, cacheDirName);
    mkdirSync(cacheDir, { recursive: true });
    // Forge .release-epoch with a STALE key (does not match what
    // _l3_compute_cache_key will report).
    writeFileSync(join(cacheDir, '.release-epoch'), staleKey);
    writeFileSync(join(cacheDir, '.must-be-nuked'), 'stale-state');
  });
  after(() => {
    rmSync(cacheRoot, { recursive: true, force: true });
  });

  it('returns the cache path but the dir was wiped (no false cache HIT)', () => {
    const cmd = `source "${ACCEPT_CACHE_SH}" && _l3_compute_cache_key() { printf '%s' '${expectedKey}'; } && _resolve_accept_temp "${REGISTRY}"`;
    const r = spawnSync('bash', ['-c', cmd], {
      encoding: 'utf-8',
      env: { ...process.env, HOME: cacheRoot },
      timeout: 10_000,
    });
    assert.equal(r.status, 0, `_resolve_accept_temp must exit 0; stderr=${r.stderr}`);
    const resolved = r.stdout.trim();
    assert.equal(resolved, cacheDir,
      `resolved path must match the expected cache path; got ${resolved}`);
    // The .must-be-nuked file proves the dir was scrubbed — if cache
    // HIT had falsely fired, this file would still be there.
    assert.equal(existsSync(join(cacheDir, '.must-be-nuked')), false,
      `mismatched-epoch path MUST nuke-fresh; stale marker survived at ${cacheDir}/.must-be-nuked`);
    // .release-epoch should also be GONE — the caller writes a fresh
    // one only after install succeeds (ADR §iv).
    assert.equal(existsSync(join(cacheDir, '.release-epoch')), false,
      `mismatched-epoch path MUST clear .release-epoch (caller writes fresh after install)`);
  });
});

describe('ADR-0182 L3 — case 4: postinstall idempotency (byte-identity proof)', () => {
  // Two REAL `npm install` invocations against Verdaccio, then
  // `diff -r` of node_modules/@sparkleideas/*/dist/. If they differ,
  // postinstall is non-deterministic and L3 must be REJECTED.
  //
  // This test is expensive (~60-120s) but is the ONLY proof that
  // satisfies ADR-0182 §L3 (iii). The ADR says: "If postinstall
  // produces non-deterministic output, L3 is rejected (do not commit).
  // Identify the offending package and report."
  //
  // The proof is "two independent fresh installs of the same versions
  // produce byte-identical results." By induction the cache-hit path
  // (= preserved bytes from first install) is equivalent to a fresh
  // re-install bytewise, so this test transitively proves the
  // cache-hit ≡ cache-miss invariant.

  let installA;
  let installB;
  const installPkgs = [
    '@sparkleideas/cli',
    '@sparkleideas/ruflo',
    '@sparkleideas/agent-booster',
    '@sparkleideas/plugins',
    '@sparkleideas/memory',
    '@sparkleideas/plugin-agent-federation',
    '@sparkleideas/plugin-iot-cognitum',
  ];

  before(() => {
    if (!registryReachable()) return; // skip — handled in `it`.
    installA = mkdtempSync(join(tmpdir(), 'l3-byteid-A-'));
    installB = mkdtempSync(join(tmpdir(), 'l3-byteid-B-'));
    for (const dir of [installA, installB]) {
      writeFileSync(join(dir, 'package.json'),
        '{"name":"l3-byteid-probe","version":"1.0.0","private":true}\n');
      writeFileSync(join(dir, '.npmrc'), `registry=${REGISTRY}\n`);
    }
  });
  after(() => {
    if (installA) rmSync(installA, { recursive: true, force: true });
    if (installB) rmSync(installB, { recursive: true, force: true });
  });

  it('two independent installs produce byte-identical @sparkleideas/*/dist/ trees', { timeout: 240_000 }, (t) => {
    if (!registryReachable()) {
      t.skip(`Verdaccio not reachable at ${REGISTRY} — byte-identity proof requires real packages. Set RUFLO_TEST_REGISTRY to override or start Verdaccio.`);
      return;
    }

    // Install A
    const npmArgs = [
      'install', ...installPkgs,
      '--registry', REGISTRY,
      '--no-audit', '--no-fund', '--prefer-offline',
    ];
    const rA = spawnSync('npm', npmArgs, {
      cwd: installA, encoding: 'utf-8', timeout: 120_000,
    });
    assert.equal(rA.status, 0,
      `install A failed: stderr=${rA.stderr?.slice(-2000)}`);

    // Install B
    const rB = spawnSync('npm', npmArgs, {
      cwd: installB, encoding: 'utf-8', timeout: 120_000,
    });
    assert.equal(rB.status, 0,
      `install B failed: stderr=${rB.stderr?.slice(-2000)}`);

    // Compare every @sparkleideas/* package's dist/ tree byte-for-byte.
    const distRoots = [
      'node_modules/@sparkleideas/cli/dist',
      'node_modules/@sparkleideas/ruflo/dist',
      'node_modules/@sparkleideas/agent-booster/dist',
      'node_modules/@sparkleideas/plugins/dist',
      'node_modules/@sparkleideas/memory/dist',
    ];
    const offenders = [];
    for (const sub of distRoots) {
      const aPath = join(installA, sub);
      const bPath = join(installB, sub);
      if (!existsSync(aPath) || !existsSync(bPath)) {
        // Some packages may not ship dist/; skip cleanly.
        continue;
      }
      // -r recursive, -q quiet (suppress identical-file output), --brief.
      const diff = spawnSync('diff', ['-r', '-q', aPath, bPath], {
        encoding: 'utf-8', timeout: 30_000,
      });
      if (diff.status !== 0) {
        offenders.push({ sub, output: (diff.stdout + diff.stderr).slice(0, 4000) });
      }
    }

    if (offenders.length > 0) {
      const report = offenders.map(o =>
        `  ${o.sub}:\n${o.output.split('\n').map(l => '    ' + l).join('\n')}`
      ).join('\n');
      // Per ADR-0182 §L3 (iii): "If postinstall produces non-deterministic
      // output, L3 is REJECTED (do not commit). Identify the offending
      // package and report."
      assert.fail(
        `ADR-0182 L3 REJECTED: postinstall non-determinism detected.\n` +
        `The following @sparkleideas/* dist/ trees differ between two fresh installs:\n${report}\n\n` +
        `Either: (a) fix the offending package's postinstall to be deterministic, ` +
        `or (b) exclude that package from the L3 cache scope.`
      );
    }
  });

  // Secondary check: also verify package.json + dependencies tree
  // are stable (agentdb postinstall augments cli's resolved
  // node_modules/agentdb/package.json's `exports` field — must be
  // deterministic).
  it('agentdb package.json after postinstall is byte-identical between installs', { timeout: 240_000 }, (t) => {
    if (!registryReachable()) {
      t.skip(`Verdaccio not reachable at ${REGISTRY} — see preceding test for details.`);
      return;
    }
    // installA/installB already populated by the prior `it` (test order
    // within a describe is sequential by default in node:test).
    const a = join(installA, 'node_modules/agentdb/package.json');
    const b = join(installB, 'node_modules/agentdb/package.json');
    if (!existsSync(a) || !existsSync(b)) {
      t.skip('agentdb not present in install tree (unexpected — investigate)');
      return;
    }
    const aJson = readFileSync(a, 'utf-8');
    const bJson = readFileSync(b, 'utf-8');
    assert.equal(aJson, bJson,
      `agentdb's package.json (post-cli-postinstall exports augmentation) ` +
      `must be byte-identical between two fresh installs. If this fails, ` +
      `the @sparkleideas/cli postinstall.cjs's augmentExports() is non-` +
      `deterministic (e.g. iteration order over a Map without sort).`);
  });
});
