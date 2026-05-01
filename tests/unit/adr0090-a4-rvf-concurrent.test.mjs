// @tier unit
// ADR-0090 Tier A4: check_t3_2_rvf_concurrent_writes — London School unit test.
//
// The acceptance check lives in lib/acceptance-adr0079-tier3-checks.sh. Its job
// is to spawn N concurrent `cli memory store` processes and then verify:
//   1. All N entries landed in the `.rvf` file (header entryCount >= N AND
//      namespace list finds all N keys).
//   2. No dangling `.rvf.lock` file remains after all writers exit.
//
// The old version only grepped stderr/stdout for SQLITE_BUSY — the wrong
// error shape for RVF (which uses a PID-based file lock, not SQLite
// busy-timeout). This test mocks out the CLI and file system via a
// stub $cli binary and stub RVF file, then sources the check function in
// isolation and asserts the four cases from the ADR-0090 A4 spec:
//
//   Case 1: all N writes succeed, all N entries in final file -> PASS
//   Case 2: .rvf missing some entries at end -> FAIL (partial writes)
//   Case 3: .rvf.lock still present after all writers done -> FAIL (cleanup regression)
//   Case 4: 0 writes succeeded at all -> FAIL (lock acquisition broken)
//
// Approach: instead of spawning a real CLI, we pre-build the .rvf file (or
// not) with a known header and namespace entries, then source the bash
// check with a stub $cli that no-ops the store commands and a stub
// memory list that prints whatever our pre-built file says. The check's
// file-system assertions (header parsing, .rvf.lock existence, namespace
// list parsing) are what we're validating.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { execSync, spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const TIER3_LIB = resolve(ROOT, 'lib', 'acceptance-adr0079-tier3-checks.sh');
const CHECKS_LIB = resolve(ROOT, 'lib', 'acceptance-checks.sh');

// ----------------------------------------------------------------------------
// Helpers: build an .rvf file with a given header + entries.
// RVF format: magic('RVF\0') + headerLen u32le + JSON header { entryCount }
//             + per-entry (entryLen u32le + JSON entry)
// This matches RvfBackend.persistToDiskInner() in
// forks/ruflo/v3/@claude-flow/memory/src/rvf-backend.ts.
// ----------------------------------------------------------------------------
function buildRvfFile(rvfPath, { entryCount, entries }) {
  const headerObj = {
    magic: 'RVF\0',
    version: 1,
    dimensions: 768,
    metric: 'cosine',
    quantization: 'none',
    entryCount,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  const headerBuf = Buffer.from(JSON.stringify(headerObj), 'utf-8');
  const magicBuf = Buffer.from([0x52, 0x56, 0x46, 0x00]);
  const headerLenBuf = Buffer.alloc(4);
  headerLenBuf.writeUInt32LE(headerBuf.length, 0);

  const entryBufs = [];
  for (const e of entries) {
    const js = Buffer.from(JSON.stringify(e), 'utf-8');
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32LE(js.length, 0);
    entryBufs.push(lenBuf, js);
  }

  mkdirSync(dirname(rvfPath), { recursive: true });
  writeFileSync(rvfPath, Buffer.concat([magicBuf, headerLenBuf, headerBuf, ...entryBufs]));
}

// ----------------------------------------------------------------------------
// Build a stub CLI binary that:
//   - for `memory store ...`: copies a pre-prepared blob (stagedRvfPath) into
//     the target .rvf path. This simulates the final state after N real
//     writers complete, without actually spawning real RvfBackend processes.
//     Multiple concurrent invocations all copy the same blob — end state is
//     deterministic. The stub creates/removes .rvf.lock atomically via a
//     separate stageLockPath file flag (for case 3).
//   - for `memory list --namespace X ...`: prints stubbed output from
//     listOutputFile.
//   - for anything else: no-op.
//
// The check function's pre-race cleanup (rm -f $p $p.lock ...) runs BEFORE
// these store stubs execute, so the stub's job is to re-establish the desired
// end state after the cleanup.
// ----------------------------------------------------------------------------
function writeStubCli({ stubCliPath, rvfTarget, stagedRvfPath, stagedLockPath, listOutputFile }) {
  const script = [
    '#!/usr/bin/env bash',
    '# Stub cli for ADR-0090 A4 unit test.',
    'case "$1 $2" in',
    '  "memory store")',
    `    mkdir -p "$(dirname '${rvfTarget}')"`,
    `    if [[ -f '${stagedRvfPath}' ]]; then cp '${stagedRvfPath}' '${rvfTarget}'; fi`,
    `    if [[ -f '${stagedLockPath}' ]]; then cp '${stagedLockPath}' '${rvfTarget}.lock'; fi`,
    '    echo "stored"',
    '    exit 0',
    '    ;;',
    '  "memory list")',
    `    cat '${listOutputFile}' 2>/dev/null || true`,
    '    exit 0',
    '    ;;',
    '  *)',
    '    exit 0',
    '    ;;',
    'esac',
  ].join('\n');
  writeFileSync(stubCliPath, script, { mode: 0o755 });
}

// ----------------------------------------------------------------------------
// Invoke the check function in a subshell with a stubbed CLI path and
// TEMP_DIR pointing at our fake isolated project. Returns { passed,
// output } parsed from the bash vars _CHECK_PASSED / _CHECK_OUTPUT.
// ----------------------------------------------------------------------------
function runCheck({ iso, stubCliPath, listOutputFile }) {
  // Build a driver script that:
  //  1. Shadows _cli_cmd and _e2e_isolate with mocks
  //  2. Sources acceptance-checks.sh for _run_and_kill_ro
  //  3. Sources acceptance-adr0079-tier3-checks.sh for the check
  //  4. Calls check_t3_2_rvf_concurrent_writes
  //  5. Prints _CHECK_PASSED + _CHECK_OUTPUT in a machine-readable form
  const driver = [
    '#!/usr/bin/env bash',
    'set +e',
    // Stubs for helpers the check depends on.
    'TEMP_DIR="/does/not/matter"',
    'PKG="@sparkleideas/cli"',
    'REGISTRY="http://localhost:4873"',
    // Override _cli_cmd to return our stub.
    `_cli_cmd() { echo "${stubCliPath}"; }`,
    // Override _e2e_isolate to return our prepared iso dir.
    `_e2e_isolate() { echo "${iso}"; }`,
    // Override _run_and_kill_ro since we don't need its sentinel dance —
    // just evaluate the command and capture output (the bash sed/mv dance
    // inside the real helper can flake on tiny commands in test harness).
    '_run_and_kill_ro() {',
    '  local cmd="$1"',
    '  _RK_OUT=$(eval "$cmd" 2>&1)',
    '  _RK_EXIT=$?',
    '}',
    '_run_and_kill() { _run_and_kill_ro "$@"; }',
    // Source the check file directly — it sets +u inside.
    `source "${TIER3_LIB}"`,
    // Run the check.
    'check_t3_2_rvf_concurrent_writes',
    // Report in a parseable form.
    'echo "::PASSED::$_CHECK_PASSED"',
    'echo "::OUTPUT::$_CHECK_OUTPUT"',
  ].join('\n');

  const driverPath = join(tmpdir(), `a4-driver-${Date.now()}-${Math.random().toString(36).slice(2)}.sh`);
  writeFileSync(driverPath, driver, { mode: 0o755 });

  try {
    const result = spawnSync('bash', [driverPath], {
      encoding: 'utf8',
      timeout: 15000,
    });
    const out = (result.stdout || '') + (result.stderr || '');
    const passedMatch = out.match(/::PASSED::(true|false)/);
    const outputMatch = out.match(/::OUTPUT::(.*)/);
    return {
      passed: passedMatch ? passedMatch[1] === 'true' : false,
      output: outputMatch ? outputMatch[1].trim() : '',
      raw: out,
    };
  } finally {
    try { rmSync(driverPath, { force: true }); } catch {}
  }
}

// ----------------------------------------------------------------------------
// Per-test setup: create an isolated fake project dir under tmp. The stub
// CLI is staged with paths to "blob" files that the test populates to
// simulate the final state after N concurrent writers completed.
//
// stagedRvfPath: the .rvf content the stub will write to .swarm/memory.rvf
//                on every `memory store` call. Tests populate this BEFORE
//                invoking runCheck. If absent, stub writes nothing (case 4a).
// stagedLockPath: if populated, stub will also write a .rvf.lock file
//                 alongside the .rvf (simulates the dangling-lock case).
// listOutputFile: content the stub's `memory list` returns.
// ----------------------------------------------------------------------------
function setupIso(label) {
  const iso = join(tmpdir(), `a4-iso-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(iso, '.swarm'), { recursive: true });
  mkdirSync(join(iso, '.claude-flow'), { recursive: true });
  const stubDir = join(iso, '.stubs');
  mkdirSync(stubDir, { recursive: true });
  const stubCliPath = join(stubDir, 'cli');
  const listOutputFile = join(stubDir, 'list-output.txt');
  const stagedRvfPath = join(stubDir, 'staged.rvf');
  const stagedLockPath = join(stubDir, 'staged.rvf.lock');
  const rvfTarget = join(iso, '.swarm', 'memory.rvf');
  writeFileSync(listOutputFile, '', 'utf-8');
  writeStubCli({ stubCliPath, rvfTarget, stagedRvfPath, stagedLockPath, listOutputFile });
  return { iso, stubCliPath, listOutputFile, stagedRvfPath, stagedLockPath, rvfTarget };
}

function teardown(iso) {
  try { rmSync(iso, { recursive: true, force: true }); } catch {}
}

// ============================================================================
// Sanity: the check function exists and TIER3_LIB is readable
// ============================================================================

describe('ADR-0090 A4: tier3 check file is present and exports the new function', () => {
  it('TIER3_LIB exists on disk', () => {
    assert.ok(existsSync(TIER3_LIB), `${TIER3_LIB} must exist`);
  });

  it('TIER3_LIB defines check_t3_2_rvf_concurrent_writes (not the old check_t3_2_concurrent_writes)', () => {
    const src = execSync(`grep -n '^check_t3_' "${TIER3_LIB}"`, { encoding: 'utf8' });
    assert.match(src, /check_t3_2_rvf_concurrent_writes/, 'new check name must be present');
    assert.doesNotMatch(
      src,
      /^check_t3_2_concurrent_writes\(\)/m,
      'old check name must NOT be defined (rename, not both)',
    );
  });

  it('new check does NOT scan for SQLITE_BUSY or "database is locked"', () => {
    // Scan just the check_t3_2_rvf_concurrent_writes block for forbidden strings.
    const src = execSync(
      `sed -n '/^check_t3_2_rvf_concurrent_writes() {/,/^}/p' "${TIER3_LIB}"`,
      { encoding: 'utf8' },
    );
    assert.ok(src.length > 0, 'could not extract check function body');
    assert.doesNotMatch(src, /SQLITE_BUSY/i, 'must not scan for SQLITE_BUSY');
    assert.doesNotMatch(src, /database is locked/i, 'must not scan for "database is locked"');
    // ADR-0095 amendment (2026-05-01): .rvf.lock no longer asserted as
    // "must be absent" (the flock-based WriterLock keeps the file by
    // design). The check still references the path in a comment block
    // explaining why the assertion was removed, which is fine — this
    // structural assertion just confirms the path is at least mentioned.
    assert.match(src, /\.rvf\.lock/, 'must reference .rvf.lock (in comment or code)');
    assert.match(src, /entryCount/, 'must parse RVF header entryCount');
  });

  it('test-acceptance.sh wires the new function name', () => {
    const wiringSrc = execSync(
      `grep -n 'check_t3_2_' "${resolve(ROOT, 'scripts', 'test-acceptance.sh')}"`,
      { encoding: 'utf8' },
    );
    assert.match(wiringSrc, /check_t3_2_rvf_concurrent_writes/, 'wiring must use new name');
    assert.doesNotMatch(
      wiringSrc,
      /check_t3_2_concurrent_writes(?!_)/,
      'wiring must not reference old name',
    );
  });
});

// ============================================================================
// Case 1: all N writes persisted, no dangling lock -> PASS
// ============================================================================

describe('ADR-0090 A4 Case 1: all N entries in .rvf, no dangling lock -> PASS', () => {
  it('check passes when header entryCount=N and namespace list returns all N keys', () => {
    const ctx = setupIso('case1');
    try {
      const N = 6;
      // Build .rvf with all 6 entries, correct header. Stage it so the
      // stub CLI copies this into .swarm/memory.rvf on each store call.
      const entries = [];
      for (let i = 1; i <= N; i++) {
        entries.push({
          id: `e-${i}`,
          key: `rvf-concurrent-${i}`,
          namespace: 'test-rvf-concurrent-$$',
          content: `rvf lock contention probe ${i}`,
          type: 'semantic',
          tags: [],
          metadata: {},
          accessLevel: 'private',
          ownerId: 'test',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          accessCount: 0,
          lastAccessedAt: Date.now(),
          version: 1,
        });
      }
      buildRvfFile(ctx.stagedRvfPath, { entryCount: N, entries });
      // ADR-0095 amendment (2026-05-01): the rvf-runtime WriterLock now
      // uses flock(LOCK_EX) on a never-unlinked sibling .lock file —
      // the file IS the inode holding the kernel queue, so persisting
      // it across processes is the correct behavior. The check no
      // longer asserts ".rvf.lock absent" (see lib/acceptance-adr0079-
      // tier3-checks.sh comment block on `dangling_lock`). This test
      // therefore just verifies the data-persisted invariant.
      writeFileSync(
        ctx.listOutputFile,
        [1, 2, 3, 4, 5, 6].map((i) => `rvf-concurrent-${i} rvf lock contention probe ${i}`).join('\n'),
        'utf-8',
      );

      const { passed, output, raw } = runCheck(ctx);
      assert.equal(passed, true, `expected PASS, got FAIL: ${output}\nraw:\n${raw}`);
      assert.match(output, /6\/6 RVF concurrent writers persisted/);
    } finally {
      teardown(ctx.iso);
    }
  });
});

// ============================================================================
// Case 2: partial writes -- only some entries in .rvf -> FAIL
// ============================================================================

describe('ADR-0090 A4 Case 2: .rvf missing some entries -> FAIL', () => {
  it('check fails when namespace list returns fewer than N keys', () => {
    const ctx = setupIso('case2');
    try {
      const N = 6;
      const persisted = 3; // only half landed

      // Stage an .rvf with only 3 of the 6 entries.
      const entries = [];
      for (let i = 1; i <= persisted; i++) {
        entries.push({
          id: `e-${i}`,
          key: `rvf-concurrent-${i}`,
          namespace: 'test-rvf-concurrent-$$',
          content: `rvf lock contention probe ${i}`,
          type: 'semantic',
          tags: [],
          metadata: {},
          accessLevel: 'private',
          ownerId: 'test',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          accessCount: 0,
          lastAccessedAt: Date.now(),
          version: 1,
        });
      }
      buildRvfFile(ctx.stagedRvfPath, { entryCount: persisted, entries });

      // Namespace list returns only the 3 persisted entries.
      writeFileSync(
        ctx.listOutputFile,
        [1, 2, 3].map((i) => `rvf-concurrent-${i}`).join('\n'),
        'utf-8',
      );

      const { passed, output, raw } = runCheck(ctx);
      assert.equal(passed, false, `expected FAIL, got PASS: ${output}\nraw:\n${raw}`);
      assert.match(output, /partial writes|lock serialization regression|only 3\/6/);
    } finally {
      teardown(ctx.iso);
    }
  });
});

// ============================================================================
// Case 3: dangling .rvf.lock -> FAIL (cleanup regression)
// ============================================================================

describe('ADR-0090 A4 Case 3: dangling .rvf.lock after writes (post-flock no-op)', () => {
  it('check tolerates .rvf.lock present (flock design persists it intentionally)', () => {
    const ctx = setupIso('case3');
    try {
      const N = 6;
      // Stage .rvf with all 6 entries successfully.
      const entries = [];
      for (let i = 1; i <= N; i++) {
        entries.push({
          id: `e-${i}`,
          key: `rvf-concurrent-${i}`,
          namespace: 'test-rvf-concurrent-$$',
          content: `rvf lock contention probe ${i}`,
          type: 'semantic',
          tags: [],
          metadata: {},
          accessLevel: 'private',
          ownerId: 'test',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          accessCount: 0,
          lastAccessedAt: Date.now(),
          version: 1,
        });
      }
      buildRvfFile(ctx.stagedRvfPath, { entryCount: N, entries });

      // Stage a `.rvf.lock` file. ADR-0095 amendment (2026-05-01): with
      // the rvf-runtime flock-based WriterLock the file is intentionally
      // kept around — it's the inode holding the kernel flock queue.
      // The check used to fail on its presence; under the new design
      // the check ignores it. This test asserts the new (more
      // permissive) behavior.
      writeFileSync(
        ctx.stagedLockPath,
        JSON.stringify({ pid: 99999, ts: Date.now() }),
        'utf-8',
      );

      writeFileSync(
        ctx.listOutputFile,
        [1, 2, 3, 4, 5, 6].map((i) => `rvf-concurrent-${i}`).join('\n'),
        'utf-8',
      );

      const { passed, output, raw } = runCheck(ctx);
      assert.equal(passed, true, `expected PASS (flock design ignores .rvf.lock presence): ${output}\nraw:\n${raw}`);
      assert.match(output, /6\/6 RVF concurrent writers persisted/);
    } finally {
      teardown(ctx.iso);
    }
  });
});

// ============================================================================
// Case 4: zero writes succeeded -> FAIL (lock acquisition broken)
// ============================================================================

describe('ADR-0090 A4 Case 4: zero entries persisted -> FAIL', () => {
  it('check fails when no .rvf file exists at all (all writers saw conflict and gave up)', () => {
    const ctx = setupIso('case4a');
    try {
      // No staged .rvf file — the stub's `cp` will no-op, so .swarm/memory.rvf
      // never materializes. Simulates every store giving up on lock acquisition.
      writeFileSync(ctx.listOutputFile, '', 'utf-8');

      const { passed, output, raw } = runCheck(ctx);
      assert.equal(passed, false, `expected FAIL, got PASS: ${output}\nraw:\n${raw}`);
      assert.match(output, /no \.rvf file written/);
    } finally {
      teardown(ctx.iso);
    }
  });

  it('check fails when .rvf exists but header entryCount=0 and namespace list is empty', () => {
    const ctx = setupIso('case4b');
    try {
      // Stage an empty .rvf file — valid header but entryCount=0.
      buildRvfFile(ctx.stagedRvfPath, { entryCount: 0, entries: [] });
      writeFileSync(ctx.listOutputFile, '', 'utf-8');

      const { passed, output, raw } = runCheck(ctx);
      assert.equal(passed, false, `expected FAIL, got PASS: ${output}\nraw:\n${raw}`);
      assert.match(output, /zero entries persisted|lock acquisition broken/);
    } finally {
      teardown(ctx.iso);
    }
  });

  it('check fails when .rvf header is garbage (bad magic)', () => {
    const ctx = setupIso('case4c');
    try {
      // Stage a garbage file with no RVF magic.
      writeFileSync(ctx.stagedRvfPath, Buffer.alloc(32, 0xaa));
      writeFileSync(ctx.listOutputFile, '', 'utf-8');

      const { passed, output, raw } = runCheck(ctx);
      assert.equal(passed, false, `expected FAIL, got PASS: ${output}\nraw:\n${raw}`);
      assert.match(output, /unable to parse RVF header|bad-magic/);
    } finally {
      teardown(ctx.iso);
    }
  });
});
