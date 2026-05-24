// @tier unit
// ADR-0088 (+ ADR-0207 supersession): Daemon Scope Alignment — dead code
// removal verification.
//
// ADR-0088 §Decision items 1-5 deleted:
//   1. DaemonIPCClient class (daemon-ipc.ts:208-302) — zero callers
//   2. DaemonIPCServer memory.{store,search,count,list,bulkInsert} registrations
//   3. tryDaemonIPC() and ipcCall() helpers in auto-memory-hook.mjs
//   4. "[Phase 4] Daemon IPC available" status print in auto-memory-hook.mjs
//   5. "IPC Socket: LISTENING" file-existence theatre in daemon status output
//
// ADR-0207 went further: the DaemonIPCServer class + the entire
// `services/daemon-ipc.ts` file are now removed too (zero handlers, zero
// clients, never present upstream). T1/T2 below assert the post-ADR-0207
// contract: the IPC file is GONE and worker-daemon.ts no longer references
// it. ADR-0207 also adds F-10-004 ("daemon restart") and the F-10-006
// aiMode-via-state-file fix.
//
// These tests read the FORK SOURCE (source of truth) — the published package
// may be stale in the pipeline order (unit tests run at step 3, build+publish
// at steps 7-8). The acceptance layer (acceptance-adr0088-checks.sh) verifies
// the same properties on the PUBLISHED package after the full pipeline.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';

const FORK_SRC = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src';
const PATCH_HELPERS = '/Users/henrik/source/ruflo-patch/.claude/helpers';

const DAEMON_IPC_PATH = `${FORK_SRC}/services/daemon-ipc.ts`;
const WORKER_DAEMON_PATH = `${FORK_SRC}/services/worker-daemon.ts`;
const CMD_DAEMON_PATH = `${FORK_SRC}/commands/daemon.ts`;
// ADR-0235: bundled-static .claude/helpers/ deleted; the generator is now
// the source of truth. Read from helpers-generator.ts and the patch's
// own copy (which serves as the in-tree probe).
const HELPERS_GENERATOR_PATH = `${FORK_SRC}/init/helpers-generator.ts`;
const PATCH_HOOK_PATH = `${PATCH_HELPERS}/auto-memory-hook.mjs`;

function readIfExists(path) {
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf-8');
}

// ============================================================================
// T1: daemon-ipc.ts file deleted entirely (ADR-0207 supersession)
// ============================================================================

describe('ADR-0088 + ADR-0207 T1: daemon-ipc.ts deleted from fork', () => {
  it('fork daemon-ipc.ts is GONE (ADR-0207)', () => {
    assert.ok(!existsSync(DAEMON_IPC_PATH),
      `${DAEMON_IPC_PATH} must be deleted per ADR-0207 (post-ADR-0088 supersession). ADR-0088 kept the empty DaemonIPCServer "for future RPC"; ADR-0207's swarm review found zero handlers ever registered, zero clients in-tree, and zero upstream history — Option C (delete) closes F-10-001 + F-10-002 by construction.`);
  });

  it('worker-daemon.ts does not import DaemonIPCServer or daemon-ipc', () => {
    const wd = readIfExists(WORKER_DAEMON_PATH);
    assert.ok(wd, `${WORKER_DAEMON_PATH} must exist`);
    assert.ok(!/['"][^'"]*daemon-ipc(?:\.js)?['"]/.test(wd),
      'worker-daemon.ts must not import from daemon-ipc.js (file deleted)');
  });

  it('worker-daemon.ts has no class-name reference to DaemonIPCServer', () => {
    const wd = readIfExists(WORKER_DAEMON_PATH);
    assert.ok(wd, `${WORKER_DAEMON_PATH} must exist`);
    assert.ok(!/\bDaemonIPCServer\b/.test(wd),
      'DaemonIPCServer symbol must be gone from worker-daemon.ts (class deleted)');
  });

  it('no surviving registerMethod call sites in cli source', () => {
    // ADR-0207 arch-test in the fork pins this too; replicating here so a
    // unit-test failure surfaces the regression at the patch tier.
    const wd = readIfExists(WORKER_DAEMON_PATH);
    assert.ok(wd, `${WORKER_DAEMON_PATH} must exist`);
    assert.ok(!/\bregisterMethod\b/.test(wd),
      'registerMethod must have zero callers (the verb that justified the layer is gone)');
  });

  it('worker-daemon.ts cites ADR-0207 in comments', () => {
    const wd = readIfExists(WORKER_DAEMON_PATH);
    assert.ok(wd.includes('ADR-0207'),
      'IPC-deletion site must cite ADR-0207 so future readers trace the decision');
  });
});

// ============================================================================
// T2: worker-daemon.ts memory.* IPC handlers removed (ADR-0088) +
//      no surviving IPC import (ADR-0207 supersession)
// ============================================================================

describe('ADR-0088 + ADR-0207 T2: worker-daemon.ts memory.* IPC handlers removed', () => {
  const source = readIfExists(WORKER_DAEMON_PATH);

  it('fork worker-daemon.ts exists', () => {
    assert.ok(source, `${WORKER_DAEMON_PATH} must exist`);
  });

  const methods = ['memory.store', 'memory.search', 'memory.count', 'memory.list', 'memory.bulkInsert'];
  for (const method of methods) {
    it(`registerMethod('${method}' absent from worker-daemon.ts`, () => {
      assert.ok(!source.includes(`registerMethod('${method}'`),
        `${method} IPC handler registration must be removed per ADR-0088`);
    });
  }

  it('DaemonIPCServer import REMOVED (ADR-0207 — entire layer deleted)', () => {
    // ADR-0088 originally kept the server import "for future methods";
    // ADR-0207 deletes the class + the import. The contract flipped.
    assert.ok(!source.includes('DaemonIPCServer'),
      'DaemonIPCServer must be absent from worker-daemon.ts (ADR-0207 superseded ADR-0088 "kept for future" rationale)');
  });

  it('capability detection method present', () => {
    assert.ok(source.includes('detectClaudeCapability'),
      'capability detection helper must be added per ADR-0088 item 6');
  });

  it('headless vs local startup log strings present', () => {
    assert.ok(source.includes('headless mode'),
      'headless startup log line must be present');
    assert.ok(source.includes('local mode'),
      'local startup log line must be present');
  });

  it('aiMode public getter present', () => {
    assert.ok(/get aiMode\(\)/.test(source),
      'public aiMode getter must be exposed for status command');
  });
});

// ============================================================================
// T3: auto-memory-hook.mjs daemon-IPC helpers deleted (both fork and patch)
// ============================================================================

describe('ADR-0088 T3: auto-memory-hook.mjs dead probe removed', () => {
  // ADR-0235: read from the GENERATOR (source of truth), not the deleted
  // bundled-static. The generator-emitted auto-memory-hook content is what
  // ships to users after Option B.
  const generatorSource = readIfExists(HELPERS_GENERATOR_PATH);
  const patchSource = readIfExists(PATCH_HOOK_PATH);

  it('helpers-generator.ts exists (source-of-truth for auto-memory-hook)', () => {
    assert.ok(generatorSource, `${HELPERS_GENERATOR_PATH} must exist`);
  });

  it('patch auto-memory-hook.mjs exists', () => {
    assert.ok(patchSource, `${PATCH_HOOK_PATH} must exist`);
  });

  const deadPatterns = [
    'async function tryDaemonIPC',
    'async function ipcCall',
    '[Phase 4] Daemon IPC available',
    'Daemon IPC:     ',
  ];

  for (const pat of deadPatterns) {
    it(`generator does not emit: ${pat}`, () => {
      assert.ok(!generatorSource.includes(pat),
        `${pat} must be removed from helpers-generator.ts (source of truth)`);
    });
    it(`patch hook does not contain: ${pat}`, () => {
      assert.ok(!patchSource.includes(pat),
        `${pat} must be removed from patch auto-memory-hook.mjs`);
    });
  }

  it('patch hook still has doImport function', () => {
    assert.ok(patchSource.includes('async function doImport'),
      'doImport must remain in patch hook — only the daemon probe is removed');
  });

  it('patch hook still has RvfBackend/createBackend reference', () => {
    assert.ok(patchSource.includes('createBackend'),
      'in-process backend creation stays in patch hook (ADR-0086 single data path)');
  });
});

// ============================================================================
// T4: commands/daemon.ts status output sanitized
// ============================================================================

describe('ADR-0088 T4: daemon status output sanitized', () => {
  const source = readIfExists(CMD_DAEMON_PATH);

  // Strip single-line comments so we can detect dead LIVE code while tolerating
  // explanatory "ADR-0088 replaced X" comments that legitimately mention the
  // removed strings.
  const stripComments = (src) =>
    src
      .split('\n')
      .map((line) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) return '';
        // Strip trailing // comment on code lines
        const commentIdx = line.indexOf('//');
        return commentIdx === -1 ? line : line.slice(0, commentIdx);
      })
      .join('\n');

  const live = source ? stripComments(source) : '';

  it('fork commands/daemon.ts exists', () => {
    assert.ok(source, `${CMD_DAEMON_PATH} must exist`);
  });

  it('AI Mode line present in status output', () => {
    assert.ok(live.includes('AI Mode:'),
      'daemon status must print the new "AI Mode:" line per ADR-0088 item 9');
  });

  it('"IPC Socket: LISTENING" removed from live code', () => {
    assert.ok(!live.includes('IPC Socket: LISTENING'),
      'fake file-existence probe line must be removed from live code (comments allowed)');
  });

  it('"Phase 4" reference absent from live code', () => {
    assert.ok(!live.includes('Phase 4'),
      'Phase 4 references removed from live code');
  });
});

// ============================================================================
// T5: ADR-0088 reference tags present in surviving modified files
// (daemon-ipc.ts dropped — that file was deleted by ADR-0207)
// ============================================================================

describe('ADR-0088 + ADR-0207 T5: ADR reference tags present', () => {
  for (const [name, path] of [
    ['worker-daemon.ts', WORKER_DAEMON_PATH],
    ['commands/daemon.ts', CMD_DAEMON_PATH],
  ]) {
    it(`${name} references ADR-0088 in comments`, () => {
      const source = readIfExists(path);
      assert.ok(source, `${path} must exist`);
      assert.ok(source.includes('ADR-0088'),
        `${name} must cite ADR-0088 so future readers can trace the decision`);
    });
  }
});
