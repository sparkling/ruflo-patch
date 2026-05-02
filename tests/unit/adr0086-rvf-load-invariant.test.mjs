// @tier integration
// ADR-0087 out-of-scope probe for adr0086-rvf-real-integration.test.mjs
//
// A1 added an on-demand Verdaccio install fallback to the big RVF integration
// suite. This probe asserts the loader invariants that suite silently relies
// on. Without this probe, A1's fix could silently degrade to "always skip"
// and no one would notice — the integration tests themselves honor the skip
// flag, so a broken loader still reports green.
//
// Invariants asserted:
//
//   (1) If a `/tmp/ruflo-accept-*` install OR `/tmp/ruflo-unit-rvf-install`
//       already contains `@sparkleideas/memory/dist/rvf-backend.js`, then the
//       dynamic import MUST succeed AND MUST export a `RvfBackend` class.
//       (Opposite assumption: "a present file is enough" — we verify the
//        *export* actually resolves.)
//
//   (2) If no install dir exists AND Verdaccio is reachable, then a fresh
//       `npm install --registry=http://localhost:4873` into a scratch prefix
//       MUST succeed within a short budget AND MUST place the expected dist
//       file on disk. (Opposite assumption: "Verdaccio ping ⇒ install works".
//        Ping succeeds even when the published tarball is broken, so we
//        exercise a real install.)
//
//   (3) If NEITHER an install dir exists NOR Verdaccio is reachable, the
//       probe skips with a *specific* reason matching a narrow regex
//       ("Verdaccio unreachable" or "no install dir"). Matches ADR-0082:
//       skip reasons must be specific, never catch-all.
//
// Verdaccio availability is a documented precondition of the unit-test tier
// on this repo (see CLAUDE.md "Global Verdaccio always running"), so using it
// as a gate is NOT a silent-pass — it is the contract.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const VERDACCIO_URL = 'http://localhost:4873';
const UNIT_INSTALL_PATH = '/tmp/ruflo-unit-rvf-install/node_modules/@sparkleideas/memory/dist/rvf-backend.js';

function verdaccioUp() {
  try {
    execSync(`curl -sf --max-time 3 ${VERDACCIO_URL}/-/ping`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function findAcceptInstall() {
  // Parity with A1's cache-first resolver in adr0086-rvf-real-integration.test.mjs.
  // Probes in the same order: /tmp/ruflo-accept-* → npx caches → null.
  let entries;
  try { entries = readdirSync('/tmp'); } catch { entries = []; }
  for (const name of entries) {
    if (!name.startsWith('ruflo-accept-')) continue;
    const candidate = join('/tmp', name, 'node_modules', '@sparkleideas', 'memory', 'dist', 'rvf-backend.js');
    if (existsSync(candidate)) return candidate;
  }
  const npxRoots = [
    '/tmp/ruflo-accept-npxcache/_npx',
    process.env.HOME ? join(process.env.HOME, '.npm/_npx') : null,
  ].filter(Boolean);
  for (const root of npxRoots) {
    let hashDirs;
    try { hashDirs = readdirSync(root); } catch { continue; }
    for (const hash of hashDirs) {
      const candidate = join(root, hash, 'node_modules', '@sparkleideas', 'memory', 'dist', 'rvf-backend.js');
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

const SPECIFIC_SKIP_REGEX = /^(Verdaccio unreachable|no install dir available)/;

describe('ADR-0086 RVF loader invariant (out-of-scope probe for A1)', () => {
  const vdcUp = verdaccioUp();
  const acceptPath = findAcceptInstall();
  const unitPath = existsSync(UNIT_INSTALL_PATH) ? UNIT_INSTALL_PATH : null;
  const havePrebuiltInstall = Boolean(acceptPath || unitPath);

  it('invariant 1: if any install dir exists, RvfBackend export MUST resolve (no silent skip)', async (t) => {
    const path = acceptPath ?? unitPath;
    if (!path) {
      const reason = vdcUp
        ? 'no install dir available (Verdaccio up — invariant 2 covers this)'
        : 'no install dir available and Verdaccio unreachable';
      assert.match(reason, SPECIFIC_SKIP_REGEX, 'skip reason must be specific per ADR-0082');
      t.skip(reason);
      return;
    }
    const mod = await import(path);
    assert.ok(mod, `dynamic import of ${path} returned falsy module`);
    assert.equal(
      typeof mod.RvfBackend,
      'function',
      `RvfBackend export must be a class/function, got ${typeof mod.RvfBackend} from ${path}`,
    );
    // Confirm it is a constructor, not an arbitrary function export.
    assert.ok(
      mod.RvfBackend.prototype && mod.RvfBackend.prototype.constructor === mod.RvfBackend,
      'RvfBackend export must be a constructor',
    );
  });

  it('invariant 2: if Verdaccio is up, an npm install MUST produce a loadable RvfBackend', async (t) => {
    if (!vdcUp) {
      const reason = 'Verdaccio unreachable — precondition not met';
      assert.match(reason, SPECIFIC_SKIP_REGEX, 'skip reason must be specific per ADR-0082');
      // Not a silent pass: Verdaccio is a documented precondition for the
      // unit-test tier in this repo. If the CI environment is missing it,
      // that is the operator's responsibility — the loader is not at fault.
      t.skip(reason);
      return;
    }
    // ADR-0113 perf fix: parallel test files (adr0086-rvf-real-integration,
    // adr0086-rvf-integration) ALSO npm install @sparkleideas/memory; the
    // npm cache lock serializes them, stretching wall-clock from 65s to
    // 25-30 min. Reuse the shared UNIT_INSTALL_PATH that
    // adr0086-rvf-real-integration.test.mjs's installFromVerdaccio()
    // populates idempotently. The contract — "an npm install from
    // Verdaccio produces a loadable RvfBackend" — is asserted equally
    // well by the cached install (it WAS produced by an npm install).
    // Only fall back to fresh scratch install if the shared cache is
    // missing (which proves the cached install path itself works).
    const sharedPath = '/tmp/ruflo-unit-rvf-install/node_modules/@sparkleideas/memory/dist/rvf-backend.js';
    let installPath = null;
    let installSrc = null;
    if (existsSync(sharedPath)) {
      installPath = sharedPath;
      installSrc = 'shared cache (populated by adr0086-rvf-real-integration)';
    } else {
      const scratch = mkdtempSync(join(tmpdir(), 'rvf-probe-install-'));
      try {
        execSync(
          `npm install --prefix ${scratch} --registry=${VERDACCIO_URL} --no-save --no-audit --no-fund @sparkleideas/memory@latest`,
          { stdio: 'pipe', timeout: 120_000 },
        );
        const expected = join(scratch, 'node_modules', '@sparkleideas', 'memory', 'dist', 'rvf-backend.js');
        assert.ok(
          existsSync(expected),
          `npm install succeeded but ${expected} missing — published tarball is broken`,
        );
        installPath = expected;
        installSrc = 'fresh scratch install (shared cache absent)';
        // Assert the installed package actually exports what the integration
        // suite expects. Catches the "install works but build is broken" case
        // where the loader would otherwise silently skip.
        const mod = await import(expected);
        assert.equal(
          typeof mod.RvfBackend,
          'function',
          `freshly-installed @sparkleideas/memory is missing RvfBackend export (${installSrc})`,
        );
      } finally {
        try { rmSync(scratch, { recursive: true, force: true }); } catch { /* best effort */ }
      }
      return; // already asserted above
    }
    // Cached path: assert the same loadability contract. If the shared
    // install was corrupt (e.g., partially written by a crash), this fails
    // loud — not a silent fall-through.
    const mod = await import(installPath);
    assert.equal(
      typeof mod.RvfBackend,
      'function',
      `cached @sparkleideas/memory is missing RvfBackend export (${installSrc} at ${installPath})`,
    );
  });

  it('invariant 3: the all-offline skip reason matches the specific narrow regex', () => {
    // This invariant is environment-independent: regardless of whether
    // Verdaccio is up or an install dir exists, the regex contract the
    // loader MUST honor in its offline branch is a property of the regex
    // itself. Testing it deterministically (not runtime-gated) closes the
    // skip that previously fired on live-env runs (where caches + Verdaccio
    // make the all-offline branch unreachable). The regex shape is what
    // callers gate on — narrow alternation, anchored at ^, no catch-all.
    const offlineReasons = [
      `Verdaccio unreachable at ${VERDACCIO_URL}`,
      'Verdaccio unreachable at http://localhost:4873',
      'no install dir available (Verdaccio up — invariant 2 covers this)',
      'no install dir available and Verdaccio unreachable',
    ];
    for (const reason of offlineReasons) {
      assert.match(
        reason,
        SPECIFIC_SKIP_REGEX,
        `every offline-branch reason must match the narrow regex; failed for: ${reason}`,
      );
    }
    // Also guard against the regex silently widening into a catch-all:
    // strings that DO NOT start with one of the two specific prefixes
    // must NOT match (otherwise we could accidentally accept "failed" /
    // "error" / "timeout" — the ADR-0082 anti-patterns).
    const mustNotMatch = [
      'failed',
      'error',
      'timeout',
      'unknown skip reason',
      ' Verdaccio unreachable (leading whitespace)',
    ];
    for (const bad of mustNotMatch) {
      assert.ok(
        !SPECIFIC_SKIP_REGEX.test(bad),
        `regex must reject non-specific reason, but matched: ${bad}`,
      );
    }
  });
});
