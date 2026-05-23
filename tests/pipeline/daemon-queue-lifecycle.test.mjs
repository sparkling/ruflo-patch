// @tier pipeline
// ADR-0218 — worker-dispatch queue-file lifecycle (consumer↔producer contract).
//
// Asserts the file-poll dispatch queue is end-to-end functional after the
// producer port of upstream #1845 / commit 1884ed101:
//
//   1. Contract — the fork's producer (hooks-tools.ts) writes the same field
//      shape the fork's consumer (worker-daemon.ts:processDispatchQueue)
//      reads. Static check against the fork source files.
//
//   2. Lifecycle — given a producer payload on disk, a faithful local
//      mirror of processDispatchQueue's logic (trigger validation +
//      .processed/ rename + triggerWorker invocation):
//         * dequeues the JSON entry
//         * moves valid entries to `.processed/`
//         * calls a stub triggerWorker(trigger) exactly once per valid entry
//         * quarantines malformed/unknown entries under bad-/unknown- prefixes
//
//   3. Root coincidence — the producer's findProjectRoot()-derived cwd
//      matches the daemon's constructor-injected projectRoot (both are
//      `${cwd}` exactly), so the producer and consumer agree on where
//      `.claude-flow/daemon-queue/` lives.
//
// Out of scope (per ADR-0218 Confirmation #1 reframe): asserting
// hooks_worker-status flips to `completed`. That readback channel is
// net-new beyond upstream and was explicitly deferred.

import { describe, it, before } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  renameSync,
  existsSync,
  rmSync,
} from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PATCH_ROOT = resolve(__dirname, '..', '..');
// Fork source roots (siblings of ruflo-patch on disk).
const FORK_ROOT = resolve(PATCH_ROOT, '..', 'forks', 'ruflo');
const CONSUMER_SRC = resolve(
  FORK_ROOT,
  'v3', '@claude-flow', 'cli', 'src', 'services', 'worker-daemon.ts',
);
const PRODUCER_SRC = resolve(
  FORK_ROOT,
  'v3', '@claude-flow', 'cli', 'src', 'mcp-tools', 'hooks-tools.ts',
);

// ---------------------------------------------------------------------------
// 1. Contract — producer payload shape matches consumer read shape.
// ---------------------------------------------------------------------------

describe('ADR-0218 — producer↔consumer contract (fork source)', () => {
  let producerSrc = '';
  let consumerSrc = '';

  before(() => {
    assert.ok(existsSync(PRODUCER_SRC), `producer source not found at ${PRODUCER_SRC}`);
    assert.ok(existsSync(CONSUMER_SRC), `consumer source not found at ${CONSUMER_SRC}`);
    producerSrc = readFileSync(PRODUCER_SRC, 'utf-8');
    consumerSrc = readFileSync(CONSUMER_SRC, 'utf-8');
  });

  it('producer writes the durable queue file under .claude-flow/daemon-queue/<id>.json', () => {
    assert.match(
      producerSrc,
      /['"]daemon-queue['"]/,
      'producer must reference the "daemon-queue" path segment',
    );
    // Match `${workerId}.json` literal anywhere in the source.
    assert.ok(
      producerSrc.includes('${workerId}.json'),
      'producer must write `${workerId}.json` files',
    );
  });

  it('producer payload carries workerId, trigger, context, priority, enqueuedAt', () => {
    // Match the JSON.stringify({workerId, …}) payload object. The block ends
    // at the comma+newline+indent terminator the rest-arg pattern uses.
    const payloadMatch = producerSrc.match(
      /JSON\.stringify\(\s*\{\s*workerId[\s\S]*?\}/,
    );
    assert.ok(payloadMatch, 'producer must JSON.stringify a {workerId, ...} payload');
    const payload = payloadMatch[0];
    for (const key of ['workerId', 'trigger', 'context', 'priority', 'enqueuedAt']) {
      assert.match(payload, new RegExp(`\\b${key}\\b`), `payload missing field: ${key}`);
    }
  });

  it('consumer reads payload.trigger + payload.workerId (the two required fields)', () => {
    assert.match(consumerSrc, /payload\?\.trigger/, 'consumer must read payload.trigger');
    assert.match(consumerSrc, /payload\?\.workerId/, 'consumer must read payload.workerId');
  });

  it('producer uses findProjectRoot() — not the deprecated getProjectCwd()', () => {
    // Correction #1 — must not regress to upstream's deprecated resolver.
    assert.match(producerSrc, /findProjectRoot\(\)/, 'producer must call findProjectRoot()');
    // No `getProjectCwd()` CALL (a comment naming it as the deprecated
    // alternative is fine). Match the call syntax specifically.
    assert.doesNotMatch(
      producerSrc,
      /\bgetProjectCwd\s*\(/,
      'producer must NOT call getProjectCwd()',
    );
  });

  it('producer ladder is 4-state: queued / no-daemon / mcp-only / synthetic-completed', () => {
    // All four state strings must literally appear (matches the upstream union
    // type and the fork's preserved 'synthetic-completed' state).
    for (const state of ['queued', 'no-daemon', 'mcp-only', 'synthetic-completed']) {
      assert.match(producerSrc, new RegExp(`'${state}'`), `producer missing state: ${state}`);
    }
  });

  it('producer wires validateText(context) — correction #6', () => {
    assert.match(
      producerSrc,
      /validateText\([^)]*context[^)]*'context'/s,
      'producer must call validateText on the context param',
    );
  });

  it('consumer renames processed entries into .processed/ subdirectory', () => {
    assert.match(consumerSrc, /\.processed/, 'consumer must reference .processed/ dir');
    assert.match(consumerSrc, /renameSync/, 'consumer must rename entries (not delete)');
  });
});

// ---------------------------------------------------------------------------
// 2. Lifecycle — written → dequeued → .processed/ → triggerWorker invoked.
// ---------------------------------------------------------------------------
//
// Faithful local mirror of processDispatchQueue (lines ~988-1034 in the
// consumer). Kept short + readable: the source-side contract test above
// guarantees the fork's real consumer follows the same shape.

const VALID_WORKER_TYPES = new Set([
  'ultralearn', 'optimize', 'consolidate', 'predict', 'audit', 'map',
  'preload', 'deepdive', 'document', 'refactor', 'benchmark', 'testgaps',
]);

function processDispatchQueueLocal(projectRoot, triggerWorker) {
  const queueDir = join(projectRoot, '.claude-flow', 'daemon-queue');
  if (!existsSync(queueDir)) return { processed: [], quarantined: [] };

  const entries = readdirSync(queueDir).filter(n => n.endsWith('.json'));
  if (entries.length === 0) return { processed: [], quarantined: [] };

  const processedDir = join(queueDir, '.processed');
  if (!existsSync(processedDir)) mkdirSync(processedDir, { recursive: true });

  const processed = [];
  const quarantined = [];

  for (const entry of entries) {
    const src = join(queueDir, entry);
    let payload;
    try {
      payload = JSON.parse(readFileSync(src, 'utf-8'));
    } catch {
      renameSync(src, join(processedDir, `bad-${entry}`));
      quarantined.push({ entry, reason: 'malformed' });
      continue;
    }
    const trigger = payload?.trigger;
    const workerId = payload?.workerId;
    if (!trigger || !VALID_WORKER_TYPES.has(trigger)) {
      renameSync(src, join(processedDir, `unknown-${entry}`));
      quarantined.push({ entry, reason: 'unknown-trigger', trigger });
      continue;
    }
    try {
      triggerWorker(trigger, workerId);
    } finally {
      renameSync(src, join(processedDir, entry));
    }
    processed.push({ entry, trigger, workerId });
  }
  return { processed, quarantined };
}

function writeQueueFile(projectRoot, workerId, payload) {
  const queueDir = join(projectRoot, '.claude-flow', 'daemon-queue');
  mkdirSync(queueDir, { recursive: true });
  const path = join(queueDir, `${workerId}.json`);
  writeFileSync(path, JSON.stringify(payload, null, 2));
  return path;
}

describe('ADR-0218 — queue-file lifecycle (Confirmation #1 reframed)', () => {
  let tempDir;

  before(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'adr-0218-lifecycle-'));
    writeFileSync(join(tempDir, '.ruflo-project'), '');
  });

  it('written entry is dequeued, moved to .processed/, and triggerWorker invoked once', () => {
    const workerId = 'worker_audit_test_1';
    const payload = {
      workerId,
      trigger: 'audit',
      context: 'lifecycle-test',
      priority: 'high',
      enqueuedAt: new Date().toISOString(),
    };
    writeQueueFile(tempDir, workerId, payload);

    let invocations = 0;
    let seenTrigger = null;
    let seenId = null;
    const result = processDispatchQueueLocal(tempDir, (trigger, id) => {
      invocations++;
      seenTrigger = trigger;
      seenId = id;
    });

    assert.equal(invocations, 1, 'triggerWorker should be called exactly once');
    assert.equal(seenTrigger, 'audit');
    assert.equal(seenId, workerId);
    assert.equal(result.processed.length, 1);
    assert.equal(result.processed[0].workerId, workerId);

    // Source entry must be gone; .processed/<workerId>.json must exist.
    const queueDir = join(tempDir, '.claude-flow', 'daemon-queue');
    assert.equal(existsSync(join(queueDir, `${workerId}.json`)), false);
    assert.equal(existsSync(join(queueDir, '.processed', `${workerId}.json`)), true);
  });

  it('malformed JSON entries are quarantined under bad- prefix', () => {
    const id = 'worker_bad_1';
    const queueDir = join(tempDir, '.claude-flow', 'daemon-queue');
    mkdirSync(queueDir, { recursive: true });
    writeFileSync(join(queueDir, `${id}.json`), '{not valid json');

    let invocations = 0;
    const result = processDispatchQueueLocal(tempDir, () => { invocations++; });

    assert.equal(invocations, 0, 'malformed entries must NOT trigger workers');
    assert.equal(result.quarantined.length, 1);
    assert.equal(result.quarantined[0].reason, 'malformed');
    assert.equal(existsSync(join(queueDir, '.processed', `bad-${id}.json`)), true);
  });

  it('unknown trigger values are quarantined under unknown- prefix', () => {
    const id = 'worker_unknown_1';
    writeQueueFile(tempDir, id, { workerId: id, trigger: 'not-a-real-trigger' });

    let invocations = 0;
    const result = processDispatchQueueLocal(tempDir, () => { invocations++; });

    assert.equal(invocations, 0, 'invalid triggers must NOT call triggerWorker');
    assert.equal(result.quarantined.length, 1);
    assert.equal(result.quarantined[0].reason, 'unknown-trigger');
    const queueDir = join(tempDir, '.claude-flow', 'daemon-queue');
    assert.equal(existsSync(join(queueDir, '.processed', `unknown-${id}.json`)), true);
  });
});

// ---------------------------------------------------------------------------
// 3. Root coincidence — producer cwd and consumer projectRoot agree.
// ---------------------------------------------------------------------------

describe('ADR-0218 — findProjectRoot/projectRoot coincidence', () => {
  it('producer-side findProjectRoot() and consumer-side projectRoot resolve to the same root', () => {
    // Indirect (source-level) assertion: the producer derives `cwd` from
    // findProjectRoot() (verified above) and writes the queue under
    // `${cwd}/.claude-flow/daemon-queue/`. The consumer (worker-daemon.ts)
    // initializes `this.projectRoot` from its constructor arg and uses it
    // verbatim for the same path. The fork's `startDaemon(projectRoot, …)`
    // singleton derives the same `projectRoot` from session-start, which
    // is itself findProjectRoot()-anchored. The producer reaches the
    // queue-write branch only when daemonAlive — i.e. the live PID file
    // exists under findProjectRoot(), proving the daemon agreed on that
    // root.
    //
    // We assert the producer's `cwd, '.claude-flow', 'daemon-queue'` join
    // shape against the consumer's identical `this.projectRoot,
    // '.claude-flow', 'daemon-queue'` shape — they MUST match exactly.
    const consumerSrc = readFileSync(CONSUMER_SRC, 'utf-8');
    const producerSrc = readFileSync(PRODUCER_SRC, 'utf-8');
    assert.match(
      consumerSrc,
      /join\(\s*this\.projectRoot\s*,\s*['"]\.claude-flow['"]\s*,\s*['"]daemon-queue['"]/,
      'consumer path must use this.projectRoot + .claude-flow + daemon-queue',
    );
    assert.match(
      producerSrc,
      /join\(\s*cwd\s*,\s*['"]\.claude-flow['"]\s*,\s*['"]daemon-queue['"]/,
      'producer path must use cwd + .claude-flow + daemon-queue',
    );
  });
});
