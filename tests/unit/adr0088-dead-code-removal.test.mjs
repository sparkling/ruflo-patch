// @tier unit
// ADR-0088: Daemon Scope Alignment — dead code removal verification.
//
// ADR-0088 §Decision items 1-5 delete:
//   1. DaemonIPCClient class (daemon-ipc.ts:208-302) — zero callers
//   2. DaemonIPCServer memory.{store,search,count,list,bulkInsert} registrations
//   3. tryDaemonIPC() and ipcCall() helpers in auto-memory-hook.mjs
//   4. "[Phase 4] Daemon IPC available" status print in auto-memory-hook.mjs
//   5. "IPC Socket: LISTENING" file-existence theatre in daemon status output
//
// These tests read the FORK SOURCE (source of truth) — the published package
// may be stale in the pipeline order (unit tests run at step 3, build+publish
// at steps 7-8). The acceptance layer (acceptance-adr0088-checks.sh) verifies
// the same properties on the PUBLISHED package after the full pipeline.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';

const FORK_SRC = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src';
const FORK_HELPERS = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/.claude/helpers';
const PATCH_HELPERS = '/Users/henrik/source/ruflo-patch/.claude/helpers';

const DAEMON_IPC_PATH = `${FORK_SRC}/services/daemon-ipc.ts`;
const WORKER_DAEMON_PATH = `${FORK_SRC}/services/worker-daemon.ts`;
const CMD_DAEMON_PATH = `${FORK_SRC}/commands/daemon.ts`;
const FORK_HOOK_PATH = `${FORK_HELPERS}/auto-memory-hook.mjs`;
const PATCH_HOOK_PATH = `${PATCH_HELPERS}/auto-memory-hook.mjs`;

function readIfExists(path) {
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf-8');
}

// ============================================================================
// T1: DaemonIPCClient class deleted
// ============================================================================

describe('ADR-0088 T1: DaemonIPCClient class deleted from fork', () => {
  const source = readIfExists(DAEMON_IPC_PATH);

  it('fork daemon-ipc.ts exists', () => {
    assert.ok(source, `${DAEMON_IPC_PATH} must exist`);
  });

  it('class DaemonIPCClient declaration absent', () => {
    assert.ok(!source.includes('class DaemonIPCClient'),
      'DaemonIPCClient class declaration must be deleted per ADR-0088');
  });

  it('new DaemonIPCClient instantiations absent', () => {
    assert.ok(!source.includes('new DaemonIPCClient'),
      'zero instantiations — the class had no callers before deletion');
  });

  it('DaemonIPCServer class still present (preserved for future RPC)', () => {
    assert.ok(source.includes('class DaemonIPCServer'),
      'server class kept for future non-memory RPC methods');
  });

  it('ADR-0088 deletion comment present', () => {
    assert.ok(source.includes('ADR-0088'),
      'removal should be explained in a comment referring to ADR-0088');
  });
});

// ============================================================================
// T2: worker-daemon.ts memory.* IPC handlers removed
// ============================================================================

describe('ADR-0088 T2: worker-daemon.ts memory.* IPC handlers removed', () => {
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

  it('DaemonIPCServer import still present (server kept for future methods)', () => {
    assert.ok(source.includes('DaemonIPCServer'),
      'server class remains importable for future non-memory RPC');
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
  const forkSource = readIfExists(FORK_HOOK_PATH);
  const patchSource = readIfExists(PATCH_HOOK_PATH);

  it('fork auto-memory-hook.mjs exists', () => {
    assert.ok(forkSource, `${FORK_HOOK_PATH} must exist`);
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
    it(`fork hook does not contain: ${pat}`, () => {
      assert.ok(!forkSource.includes(pat),
        `${pat} must be removed from fork auto-memory-hook.mjs`);
    });
    it(`patch hook does not contain: ${pat}`, () => {
      assert.ok(!patchSource.includes(pat),
        `${pat} must be removed from patch auto-memory-hook.mjs`);
    });
  }

  it('fork hook still has doImport function', () => {
    assert.ok(forkSource.includes('async function doImport'),
      'doImport must remain — only the daemon probe is removed');
  });

  it('fork hook still has RvfBackend/createBackend reference', () => {
    assert.ok(forkSource.includes('createBackend'),
      'in-process backend creation stays (ADR-0086 single data path)');
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
// T5: ADR-0088 reference tags present in all modified files
// ============================================================================

describe('ADR-0088 T5: ADR reference tags present', () => {
  for (const [name, path] of [
    ['daemon-ipc.ts', DAEMON_IPC_PATH],
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
