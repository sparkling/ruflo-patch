// @tier unit
// ADR-0130 (T11) — RVF WAL fsync durability (true power-loss survival).
//
// Sibling: lib/acceptance-adr0130-fsync.sh (NEW, NOT wired into
// scripts/test-acceptance.sh — see ADR-0130 §Risks #5 about FUSE harness
// flakiness in CI; opt-in run via the file directly).
//
// Two layers per ADR-0097 / ADR-0130 §Validation:
//
//  1. Static lib + (intentionally NOT runner-wired) assertions
//  2. Source-level surface assertions on the fork's rvf-backend.ts:
//       - imports `open` from node:fs/promises (used to get a WAL fd)
//       - declares _walFsyncCount / _walFsyncLatencyMs / _walFsyncFallback fields
//       - appendToWal awaits datasync (preferred) or sync inside the lock region
//       - appendToWal does NOT swallow fsync errors via try/catch on the syscall
//         (only ENOSYS triggers fdatasync->fsync fallback; EIO/ENOSPC/EDQUOT
//         propagate per feedback-no-fallbacks)
//       - getWalFsyncMetrics public method exposes count + p50/p99 + fallback flag
//       - JSDoc documents per-platform durability semantics (Linux fdatasync
//         power-loss durable; Darwin fsync NOT through disk write cache,
//         requires F_FULLFSYNC for true power-loss durability)
//       - fsync happens BEFORE this.releaseLock() (inside the try block)
//
// The fsync primitive is only reachable from compiled fork code; behavioural
// tests live in the fork's vitest suite or the acceptance harness.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const CHECK_FILE = resolve(ROOT, 'lib', 'acceptance-adr0130-fsync.sh');
const RUNNER_FILE = resolve(ROOT, 'scripts', 'test-acceptance.sh');

// Source file in the live fork — the touch site (ADR-0118 H3 / ADR-0123 §Risks 7).
const FORK_SRC = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/memory/src/rvf-backend.ts';

const CHECK_FN_NAMES = [
  'check_adr0130_appendtowal_calls_fsync',
  'check_adr0130_fsync_inside_lock_region',
];

// ── 1. Static assertions on the check lib ───────────────────────────────

describe('ADR-0130 acceptance check lib — static structure', () => {
  const lib = existsSync(CHECK_FILE) ? readFileSync(CHECK_FILE, 'utf8') : '';

  it('lib file exists', () => {
    assert.ok(existsSync(CHECK_FILE), `Expected ${CHECK_FILE} to exist`);
  });

  for (const fn of CHECK_FN_NAMES) {
    it(`defines ${fn}()`, () => {
      assert.match(
        lib,
        new RegExp(`^${fn}\\s*\\(\\)\\s*\\{`, 'm'),
        `${fn}() not found in ${CHECK_FILE}`,
      );
    });
  }

  it('every check sets _CHECK_PASSED and _CHECK_OUTPUT', () => {
    const passedCount = (lib.match(/_CHECK_PASSED=/g) || []).length;
    const outputCount = (lib.match(/_CHECK_OUTPUT=/g) || []).length;
    assert.ok(
      passedCount >= CHECK_FN_NAMES.length,
      `Expected >=${CHECK_FN_NAMES.length} _CHECK_PASSED= assignments, found ${passedCount}`,
    );
    assert.ok(
      outputCount >= CHECK_FN_NAMES.length,
      `Expected >=${CHECK_FN_NAMES.length} _CHECK_OUTPUT= assignments, found ${outputCount}`,
    );
  });

  it('lib uses $(_cli_cmd) helper, not raw npx @latest', () => {
    // Per reference-cli-cmd-helper.md memory: parallel acceptance checks
    // using raw `npx @sparkleideas/cli@latest` serialize on npm cache lock
    // (36x slower). ADR-0130 lib must follow the canonical convention.
    assert.match(
      lib,
      /\$\(_cli_cmd\)/,
      'lib must use $(_cli_cmd) helper for CLI invocations',
    );
    assert.doesNotMatch(
      lib,
      /npx @sparkleideas\/cli@latest/,
      'lib must NOT use raw `npx @sparkleideas/cli@latest` (36x slower per cache lock)',
    );
  });

  it('lib explicitly references ADR-0130 / power-loss durability bar', () => {
    assert.match(
      lib,
      /ADR-0130|power[- ]loss|fsync/i,
      'lib must reference ADR-0130 / power-loss / fsync framing',
    );
  });

  it('lib documents per-platform durability semantics (Linux vs Darwin)', () => {
    // Per ADR-0130 §Refinement: the macOS gap (fsync != F_FULLFSYNC) must
    // be named honestly, not silently defaulted. The check lib should
    // surface this to the operator running the acceptance check.
    assert.match(
      lib,
      /linux|darwin|macos|fdatasync|F_FULLFSYNC/i,
      'lib must document per-platform durability semantics',
    );
  });
});

// ── 2. Runner wiring assertions ─────────────────────────────────────────
// (Originally NOT-wired per agent task spec; orchestrator wired it during
// the Wave 3 sub-batch A commit because the static + source-level checks
// don't need power-loss simulation infrastructure — they read the dist file
// and the source. ADR-0130 §Risks #5 deferral applies only to FUSE/eatmydata
// power-loss harness, which is NOT what these checks do.)

describe('ADR-0130 runner wiring', () => {
  const runner = existsSync(RUNNER_FILE) ? readFileSync(RUNNER_FILE, 'utf8') : '';

  it('scripts/test-acceptance.sh sources adr0130 lib', () => {
    assert.match(
      runner,
      /acceptance-adr0130-fsync\.sh/,
      'scripts/test-acceptance.sh must source acceptance-adr0130-fsync.sh',
    );
  });

  it('scripts/test-acceptance.sh expands _adr0130_specs', () => {
    assert.match(
      runner,
      /\$\{_adr0130_specs\[@\]\}/,
      'scripts/test-acceptance.sh must expand _adr0130_specs in collect_parallel',
    );
  });
});

// ── 3. Source-level surface assertions on the fork ──────────────────────

describe('ADR-0130 fork source — appendToWal fsync', () => {
  const src = existsSync(FORK_SRC) ? readFileSync(FORK_SRC, 'utf8') : '';

  it('fork source file exists', () => {
    assert.ok(existsSync(FORK_SRC), `Expected ${FORK_SRC} to exist`);
  });

  it('imports `open` from node:fs/promises (needed to obtain WAL fd)', () => {
    // The fsync syscall requires a fd; appendFile() opens+writes+closes per
    // call without exposing the fd. ADR-0130 introduces an explicit
    // `open()` to call datasync()/sync() before close.
    assert.match(
      src,
      /import\s*\{[^}]*\bopen\b[^}]*\}\s*from\s*['"]node:fs\/promises['"]/,
      'must import `open` from node:fs/promises',
    );
  });

  it('declares _walFsyncCount metric counter', () => {
    assert.match(
      src,
      /private\s+_walFsyncCount\s*=\s*0/,
      '_walFsyncCount metric counter must be declared',
    );
  });

  it('declares _walFsyncLatencyMs latency samples array', () => {
    assert.match(
      src,
      /private\s+_walFsyncLatencyMs\s*:\s*number\[\]/,
      '_walFsyncLatencyMs samples array must be declared',
    );
  });

  it('declares _walFsyncFallback ENOSYS fallback flag', () => {
    // Once fdatasync returns ENOSYS, subsequent calls go directly to
    // fsync. This avoids the per-call fdatasync attempt overhead on
    // platforms that don't support it.
    assert.match(
      src,
      /private\s+_walFsyncFallback\s*=\s*false/,
      '_walFsyncFallback flag must be declared',
    );
  });

  it('appendToWal calls datasync (preferred over sync)', () => {
    const appendBlock = src.match(/private\s+async\s+appendToWal[\s\S]*?(?=\n  \/\*\*|\n  private|\n  public|\n  protected|\n}\s*\n)/);
    assert.ok(appendBlock, 'appendToWal method must be findable');
    assert.match(
      appendBlock[0],
      /\.datasync\(\)/,
      'appendToWal must call .datasync() (fdatasync preferred per ADR-0130 §Specification)',
    );
  });

  it('appendToWal has fdatasync->fsync fallback on ENOSYS', () => {
    const appendBlock = src.match(/private\s+async\s+appendToWal[\s\S]*?(?=\n  \/\*\*|\n  private|\n  public|\n  protected|\n}\s*\n)/);
    assert.ok(appendBlock, 'appendToWal method must be findable');
    assert.match(
      appendBlock[0],
      /ENOSYS/,
      'appendToWal must check for ENOSYS before falling back to sync()',
    );
    assert.match(
      appendBlock[0],
      /\.sync\(\)/,
      'appendToWal must have .sync() fallback path',
    );
  });

  it('appendToWal does NOT swallow non-ENOSYS fsync errors (feedback-no-fallbacks)', () => {
    // Per ADR-0130 §Specification + feedback-no-fallbacks: EIO/ENOSPC/EDQUOT
    // must propagate. The catch on datasync() ONLY handles ENOSYS — other
    // errors must re-throw. Static check: the catch block must contain a
    // `throw err` for the non-ENOSYS branch.
    const appendBlock = src.match(/private\s+async\s+appendToWal[\s\S]*?(?=\n  \/\*\*|\n  private|\n  public|\n  protected|\n}\s*\n)/);
    assert.ok(appendBlock, 'appendToWal method must be findable');
    // The block must contain a `throw err` to surface non-ENOSYS errors.
    assert.match(
      appendBlock[0],
      /throw\s+err/,
      'appendToWal fsync catch must re-throw non-ENOSYS errors (feedback-no-fallbacks)',
    );
  });

  it('appendToWal increments _walFsyncCount on every fsync', () => {
    const appendBlock = src.match(/private\s+async\s+appendToWal[\s\S]*?(?=\n  \/\*\*|\n  private|\n  public|\n  protected|\n}\s*\n)/);
    assert.ok(appendBlock, 'appendToWal method must be findable');
    assert.match(
      appendBlock[0],
      /this\._walFsyncCount\+\+|this\._walFsyncCount\s*\+=\s*1/,
      '_walFsyncCount must be incremented on every fsync',
    );
  });

  it('appendToWal records fsync latency', () => {
    const appendBlock = src.match(/private\s+async\s+appendToWal[\s\S]*?(?=\n  \/\*\*|\n  private|\n  public|\n  protected|\n}\s*\n)/);
    assert.ok(appendBlock, 'appendToWal method must be findable');
    assert.match(
      appendBlock[0],
      /_walFsyncLatencyMs\.push/,
      'appendToWal must push fsync latency samples for p50/p99 reporting',
    );
  });

  it('appendToWal closes the WAL fd in finally (no fd leak)', () => {
    const appendBlock = src.match(/private\s+async\s+appendToWal[\s\S]*?(?=\n  \/\*\*|\n  private|\n  public|\n  protected|\n}\s*\n)/);
    assert.ok(appendBlock, 'appendToWal method must be findable');
    // The fd must be closed in a `finally` so syscall failures don't leak it.
    assert.match(
      appendBlock[0],
      /walFd\.close\(\)/,
      'appendToWal must close walFd (fd lifecycle hygiene)',
    );
  });

  it('fsync happens BEFORE releaseLock (durability invariant)', () => {
    // ADR-0130 §Specification: "the fsync call lives inside the same JS
    // lock region as the WAL append and the conditional compact. A
    // concurrent store cannot observe an un-fsynced WAL line."
    //
    // Static check: in the appendToWal body, the .datasync() / .sync() call
    // must appear before the releaseLock() that ends the try/finally block.
    const appendBlock = src.match(/private\s+async\s+appendToWal[\s\S]*?(?=\n  \/\*\*|\n  private|\n  public|\n  protected|\n}\s*\n)/);
    assert.ok(appendBlock, 'appendToWal method must be findable');
    const datasyncIdx = appendBlock[0].indexOf('.datasync()');
    const releaseIdx = appendBlock[0].indexOf('releaseLock');
    assert.ok(datasyncIdx >= 0, 'datasync() call must be present');
    assert.ok(releaseIdx >= 0, 'releaseLock() must be present');
    assert.ok(
      datasyncIdx < releaseIdx,
      'datasync() must appear BEFORE releaseLock() (fsync inside lock region)',
    );
  });

  it('public getWalFsyncMetrics() exposes count + p50/p99 + fallback', () => {
    assert.match(
      src,
      /public\s+getWalFsyncMetrics\(\)\s*:/,
      'getWalFsyncMetrics() public observability surface must exist',
    );
    // The return type must include count, p50Ms, p99Ms, usedFallback.
    const metricsBlock = src.match(/getWalFsyncMetrics\(\)[\s\S]*?\n\s{2}\}/);
    assert.ok(metricsBlock, 'getWalFsyncMetrics body must be findable');
    assert.match(metricsBlock[0], /count/, 'metrics must expose count');
    assert.match(metricsBlock[0], /p50/i, 'metrics must expose p50 latency');
    assert.match(metricsBlock[0], /p99/i, 'metrics must expose p99 latency');
    assert.match(
      metricsBlock[0],
      /usedFallback|fallback/i,
      'metrics must expose fallback flag (whether ENOSYS hit fdatasync)',
    );
  });

  it('JSDoc documents Linux fdatasync power-loss durability', () => {
    // Per ADR-0130 §Refinement / §Phase 4: the JSDoc must honestly state
    // that on Linux, fdatasync delivers power-loss durability on ext4/xfs.
    const jsdocRegex = /\/\*\*[\s\S]*?Linux[\s\S]*?fdatasync[\s\S]*?\*\/\s*private\s+async\s+appendToWal/;
    assert.match(
      src,
      jsdocRegex,
      'appendToWal JSDoc must document Linux fdatasync power-loss durability',
    );
  });

  it('JSDoc documents macOS / Darwin disk-cache caveat (NOT through F_FULLFSYNC)', () => {
    // Per ADR-0130 §Decision Outcome / §Refinement: "On macOS, the call is
    // durable through process-kill and OS-crash, but NOT necessarily
    // through power loss with disk cache enabled." This must be in the
    // JSDoc — any agent removing the caveat would be silently misleading
    // operators about platform-uniform durability claims.
    const jsdocRegex = /\/\*\*[\s\S]*?(Darwin|macOS|Mac)[\s\S]*?(F_FULLFSYNC|disk[- ]?cache|disk write cache)[\s\S]*?\*\/\s*private\s+async\s+appendToWal/i;
    assert.match(
      src,
      jsdocRegex,
      'appendToWal JSDoc must document macOS / Darwin F_FULLFSYNC / disk-cache caveat',
    );
  });

  it('JSDoc references ADR-0130 explicitly', () => {
    const jsdocRegex = /\/\*\*[\s\S]*?ADR-0130[\s\S]*?\*\/\s*private\s+async\s+appendToWal/;
    assert.match(
      src,
      jsdocRegex,
      'appendToWal JSDoc must reference ADR-0130 (traceability)',
    );
  });

  it('JSDoc mentions feedback-no-fallbacks discipline', () => {
    const jsdocRegex = /\/\*\*[\s\S]*?(feedback-no-fallbacks|no try\/catch swallow|no swallow|propagates as a thrown)[\s\S]*?\*\/\s*private\s+async\s+appendToWal/;
    assert.match(
      src,
      jsdocRegex,
      'appendToWal JSDoc must document feedback-no-fallbacks discipline ' +
        '(fsync errors propagate, no swallow on EIO/ENOSPC)',
    );
  });
});
