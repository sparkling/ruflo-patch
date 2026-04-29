// Verifies that lib/acceptance-harness.sh enforces a parallelism cap on the
// mega-parallel `run_check_bg` wave. Without a cap, scripts/test-acceptance.sh
// fans out ~150 checks × ~3-4 procs each = ~450 procs, causing load 106+ and
// near-OOM on an 18-core M5 (verified empirically 2026-04-29).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const HARNESS = join(import.meta.dirname, '..', '..', 'lib', 'acceptance-harness.sh');

test('auto-detect block sets a safe RUFLO_MAX_PARALLEL default', () => {
  const src = readFileSync(HARNESS, 'utf-8');

  // Auto-detect block must be present.
  assert.ok(/Default parallelism cap/.test(src),
    'harness should include "Default parallelism cap" header');
  assert.ok(/if \[\[ -z "\$\{RUFLO_MAX_PARALLEL\+x\}"/.test(src),
    'auto-detect must use unset-test (-z VAR+x) so RUFLO_MAX_PARALLEL=0 still disables cap');
  assert.ok(/sysctl -n hw\.ncpu/.test(src),
    'must probe macOS ncpu via sysctl');
  assert.ok(/\/proc\/cpuinfo/.test(src),
    'must fall back to Linux /proc/cpuinfo');
  assert.ok(/RUFLO_MAX_PARALLEL=\$\(\( _ncpu \/ 2 \)\)/.test(src),
    'default formula must be ncpu/2');
  assert.ok(/RUFLO_MAX_PARALLEL < 4/.test(src),
    'must enforce a minimum of 4 to keep at least some parallelism');
  assert.ok(/export RUFLO_MAX_PARALLEL/.test(src),
    'must export so child shells inherit the cap');
});

test('throttle enforces cap (lightweight runtime check)', () => {
  // Verifies the cap by observing how many slots BG_PIDS holds *while* a wave
  // is running (snapshot via the harness's own array, no external pgrep).
  // Resource-light (4 fake checks, 200ms each) so it survives running under
  // node --test --test-concurrency=8 inside the unit-test mega-batch where
  // free RAM drops to ~60MB and external probes (pgrep, kill -0) get killed
  // by OOM. A heavier integration test gated by env var lives below.
  const tmp = mkdtempSync(join(tmpdir(), 'ruflo-throttle-test-'));
  try {
    const cap = 2;
    const total = 4;
    const driver = `
PROJECT_DIR=${JSON.stringify(join(import.meta.dirname, '..', '..'))}
_ns()         { date +%s%N 2>/dev/null || echo 0; }
_elapsed_ms() { echo 0; }
log()         { :; }
run_timed()   { _OUT=""; _EXIT=0; _DURATION_MS=0; }
export RUFLO_MAX_PARALLEL=${cap}
source "$PROJECT_DIR/lib/acceptance-harness.sh"
PARALLEL_DIR=${JSON.stringify(tmp)}
fake_check() { sleep 0.2; _CHECK_PASSED="true"; _CHECK_OUTPUT="ok"; }

# Spawn checks one at a time, recording BG_PIDS depth. The throttle blocks
# inside run_check_bg before adding to BG_PIDS, so depth never exceeds cap.
max_depth=0
for i in $(seq 1 ${total}); do
  run_check_bg "fake-\$i" "Fake \$i" fake_check "test"
  d=\${#BG_PIDS[@]}
  (( d > max_depth )) && max_depth=\$d
done
for pid in "\${BG_PIDS[@]}"; do wait "\$pid" 2>/dev/null || true; done
echo "MAX_DEPTH=\$max_depth CAP=${cap} TOTAL=${total}"
# Verify result files were actually written (proves checks ran, not just
# that the throttle bookkeeping looked right).
written=$(ls -1 "$PARALLEL_DIR" 2>/dev/null | grep -c '^fake-' || true)
echo "FILES_WRITTEN=$written"
`;
    const driverPath = join(tmp, 'driver.sh');
    writeFileSync(driverPath, driver);

    const result = spawnSync('bash', [driverPath], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 15000,
    });

    if (result.status !== 0) {
      throw new Error(`driver failed (exit ${result.status}):\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
    }

    const depth = /MAX_DEPTH=(\d+)/.exec(result.stdout);
    const written = /FILES_WRITTEN=(\d+)/.exec(result.stdout);
    assert.ok(depth, `unexpected driver output:\n${result.stdout}`);
    assert.ok(written, `unexpected driver output:\n${result.stdout}`);
    assert.ok(Number(depth[1]) <= cap, `BG_PIDS depth ${depth[1]} exceeded cap ${cap}`);
    assert.equal(Number(written[1]), total, `expected ${total} result files, got ${written[1]}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('explicit RUFLO_MAX_PARALLEL=0 disables the cap (caller opt-out path preserved)', () => {
  // Some CI runners/larger servers may want unbounded behavior. The unset-test
  // ensures setting `0` is honored as "no cap" — needed so existing
  // RUFLO_MAX_PARALLEL=0 invocations don't get silently overridden by our new
  // auto-default.
  const out = execSync(
    `RUFLO_MAX_PARALLEL=0 bash -c 'source ${JSON.stringify(HARNESS)}; echo "AFTER=$RUFLO_MAX_PARALLEL"'`,
    { encoding: 'utf-8' }
  );
  const m = /AFTER=(\d+)/.exec(out);
  assert.ok(m);
  assert.equal(Number(m[1]), 0, `harness must respect explicit RUFLO_MAX_PARALLEL=0; got ${m[1]}`);
});

test('unset RUFLO_MAX_PARALLEL produces a sane positive default', () => {
  const out = execSync(
    `unset RUFLO_MAX_PARALLEL; bash -c 'source ${JSON.stringify(HARNESS)}; echo "DEFAULT=$RUFLO_MAX_PARALLEL"'`,
    { encoding: 'utf-8' }
  );
  const m = /DEFAULT=(\d+)/.exec(out);
  assert.ok(m, `unexpected harness output:\n${out}`);
  const def = Number(m[1]);
  assert.ok(def >= 4, `default=${def} below minimum 4`);
  assert.ok(def <= 64, `default=${def} above sanity ceiling 64 — ncpu probe likely returned a wild value`);
});
