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

test('throttle enforces cap under contention (integration)', () => {
  const harnessSrc = readFileSync(HARNESS, 'utf-8');
  // The throttle is a polling busy-wait loop that holds new spawns when
  // BG_PIDS reaches the cap. We simulate by sourcing harness then invoking
  // run_check_bg N>cap times with a check fn that sleeps. Sample peak
  // concurrent subshells via /proc-equivalent ps grep.
  const tmp = mkdtempSync(join(tmpdir(), 'ruflo-throttle-test-'));
  try {
    const cap = 3;
    const total = 12;
    const sleepSec = '0.5';

    // Mock helpers expected by harness contract: _ns, _elapsed_ms, log,
    // run_timed (the harness sources lib/acceptance-harness.sh and expects
    // these from the caller per the file-header contract).
    const driver = `
set -eo pipefail
PROJECT_DIR=${JSON.stringify(join(import.meta.dirname, '..', '..'))}
_ns()         { date +%s%N 2>/dev/null || echo 0; }
_elapsed_ms() { echo 0; }
log()         { :; }
run_timed()   { _OUT=""; _EXIT=0; _DURATION_MS=0; }
export RUFLO_MAX_PARALLEL=${cap}
source "$PROJECT_DIR/lib/acceptance-harness.sh"
# Harness sets PARALLEL_DIR="" by contract; caller sets it after sourcing.
PARALLEL_DIR=${JSON.stringify(tmp)}
fake_check() {
  sleep ${sleepSec}
  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ok"
}
# Background the wave so we can sample concurrency from outside.
(
  for i in $(seq 1 ${total}); do
    run_check_bg "fake-$i" "Fake $i" fake_check "test"
  done
  # collect_parallel from harness — but we want to measure peak first.
  for pid in "\${BG_PIDS[@]}"; do wait "$pid" 2>/dev/null || true; done
) &
WAVE_PID=$!

# Sample peak concurrent subshells. Each run_check_bg spawns a bash
# subshell child of WAVE_PID. Sample every 50ms while the wave runs.
peak=0
while kill -0 $WAVE_PID 2>/dev/null; do
  # count live procs whose parent (or pgrp) is the wave
  alive=$(pgrep -P $WAVE_PID 2>/dev/null | wc -l | tr -d ' ')
  (( alive > peak )) && peak=$alive
  sleep 0.05
done
wait $WAVE_PID 2>/dev/null || true
echo "PEAK_CONCURRENT=$peak CAP=${cap} TOTAL=${total}"
`;
    const driverPath = join(tmp, 'driver.sh');
    writeFileSync(driverPath, driver);

    const result = spawnSync('bash', [driverPath], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30000,
    });

    if (result.status !== 0) {
      throw new Error(`driver failed (exit ${result.status}):\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
    }

    const m = /PEAK_CONCURRENT=(\d+) CAP=(\d+) TOTAL=(\d+)/.exec(result.stdout);
    assert.ok(m, `unexpected driver output:\n${result.stdout}`);
    const peak = Number(m[1]);
    const capObserved = Number(m[2]);
    assert.equal(capObserved, cap);

    // Peak concurrent subshells should not exceed cap by more than a small
    // race window (one extra in-flight while the throttle reaps). Allow +2.
    assert.ok(peak <= cap + 2, `peak=${peak} exceeded cap=${cap} +2 slack`);
    assert.ok(peak >= 2, `peak=${peak} too low — throttle may be running serial; expected concurrency`);
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
