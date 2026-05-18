// @tier unit
// ADR-0131 (T12) — Worker-failure prompt protocol + auto-status-transitions
// in `_consensus`. Static-surface assertions on the fork source + acceptance
// lib + runner wiring. Behavioural tests live in-fork at
// /Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/__tests__/mcp-tools-deep.test.ts
// (T12 describe block).
//
// Sibling: lib/acceptance-adr0131-worker-failure.sh

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const CHECK_FILE = resolve(ROOT, 'lib', 'acceptance-adr0131-worker-failure.sh');

const FORK_ROOT = '/Users/henrik/source/forks/ruflo';
const FORK_HIVE_CMD = `${FORK_ROOT}/v3/@claude-flow/cli/src/commands/hive-mind.ts`;
const FORK_HIVE_TOOLS = `${FORK_ROOT}/v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts`;
const FORK_DEEP_TEST = `${FORK_ROOT}/v3/@claude-flow/cli/__tests__/mcp-tools-deep.test.ts`;

// ADR-0185 Wave 2b — cli's propose-action threshold-check logic moved into
// agentdb per-strategy handlers (bft/raft/quorum/weighted each set their own
// `timeoutAt` in their propose case). The ADR-0131 invariant "propose-time
// timeoutAt is set for ALL threshold-based strategies (not just raft)" still
// holds; the assertion now grep the per-strategy handlers rather than cli's
// (now-removed) `isThresholdBased` helper.
const AGENTDB_ROOT = '/Users/henrik/source/forks/agentdb';
const AGENTDB_BFT_HANDLER = `${AGENTDB_ROOT}/src/archivist/handlers/hive-mind/consensus/bft.ts`;
const AGENTDB_RAFT_HANDLER = `${AGENTDB_ROOT}/src/archivist/handlers/hive-mind/consensus/raft.ts`;
const AGENTDB_QUORUM_HANDLER = `${AGENTDB_ROOT}/src/archivist/handlers/hive-mind/consensus/quorum.ts`;
const AGENTDB_WEIGHTED_HANDLER = `${AGENTDB_ROOT}/src/archivist/handlers/hive-mind/consensus/weighted.ts`;
// ADR-0185 Wave 3 — gossip + crdt added: cli's vote-action throws of
// WorkerAlreadyFailedError + ProposalAlreadyFailedError moved to all 6
// agentdb per-strategy vote handlers (not just the 4 threshold-based ones).
const AGENTDB_GOSSIP_HANDLER = `${AGENTDB_ROOT}/src/archivist/handlers/hive-mind/consensus/gossip.ts`;
const AGENTDB_CRDT_HANDLER = `${AGENTDB_ROOT}/src/archivist/handlers/hive-mind/consensus/crdt.ts`;
const AGENTDB_VOTE_HANDLERS = [
  AGENTDB_BFT_HANDLER,
  AGENTDB_RAFT_HANDLER,
  AGENTDB_QUORUM_HANDLER,
  AGENTDB_WEIGHTED_HANDLER,
  AGENTDB_GOSSIP_HANDLER,
  AGENTDB_CRDT_HANDLER,
];
// ADR-0185 Wave 4 — status-side ADR-0131 auto-transition logic lives in
// the 4 threshold-strategy handlers only (bft/raft/quorum/weighted).
// Gossip and crdt have their own settle paths (gossip: settleCheckGossip
// per ADR-0120; crdt: timeout-driven force-settle per ADR-0121); neither
// emits a `failed-quorum-not-reached` auto-transition (they don't have
// `timeoutAt` set at propose-time).
const AGENTDB_THRESHOLD_STATUS_HANDLERS = [
  AGENTDB_BFT_HANDLER,
  AGENTDB_RAFT_HANDLER,
  AGENTDB_QUORUM_HANDLER,
  AGENTDB_WEIGHTED_HANDLER,
];
// ADR-0185 Wave 1 — the `statusJustTransitioned` field lives in the
// response-builder (created during Wave 1 to project post-dispatch state
// into the cli's pre-flip response shape). The builder emits it on the
// history-fallback path + pending-still path; agentdb's handler doesn't
// emit it (handler returns void; builder owns response shape).
const CLI_RESPONSE_BUILDER = `${FORK_ROOT}/v3/@claude-flow/cli/src/mcp-tools/hive-mind-consensus-response.ts`;

const CHECK_FN_NAMES = [
  'check_adr0131_worker_failure_auto_transition',
  'check_adr0131_status_failed_workers_summary',
  'check_adr0131_retry_lineage_round_trip',
  'check_adr0131_prompt_carries_failure_protocol',
];

// ── 1. Acceptance lib structure ─────────────────────────────────────────────

describe('ADR-0131 acceptance check lib — static structure', () => {
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

  it('uses _cli_cmd helper (per reference-cli-cmd-helper)', () => {
    assert.match(
      lib,
      /_cli_cmd/,
      'lib must use $(_cli_cmd) helper, not raw `npx @sparkleideas/cli@latest`',
    );
  });

  it('uses _e2e_isolate for per-check isolation', () => {
    assert.match(lib, /_e2e_isolate/, 'lib must use _e2e_isolate for parallel safety');
  });
});

// ── 2. Fork source — §6 prompt extension in hive-mind.ts ────────────────────

describe('ADR-0131 fork source — hive-mind.ts §6 prompt sentinels', () => {
  const src = existsSync(FORK_HIVE_CMD) ? readFileSync(FORK_HIVE_CMD, 'utf8') : '';

  it('hive-mind.ts contains the WORKER FAILURE PROTOCOL header', () => {
    assert.match(src, /WORKER FAILURE PROTOCOL/);
  });

  it('hive-mind.ts contains the 60s absence-threshold sentinel', () => {
    // Per ADR-0131 §Specification: '60s' is the verbatim contract
    // — downstream tests assert on the literal.
    assert.match(src, /60s/);
  });

  it('hive-mind.ts contains the retry-once policy sentinel', () => {
    assert.match(src, /retry-once/);
  });

  it("hive-mind.ts contains the 'absent' status literal", () => {
    assert.match(src, /'absent'/);
  });

  it('hive-mind.ts contains the worker-<id>-status memory-key shape', () => {
    assert.match(src, /worker-<id>-status/);
  });

  it('hive-mind.ts §6 block instructs Step 1 IMMEDIATE READBACK after Task returns', () => {
    // The contract requires immediate readback via hive-mind_memory get.
    assert.match(src, /IMMEDIATE READBACK/);
    assert.match(src, /worker-<id>-result/);
  });
});

// ── 3. Fork source — hive-mind-tools.ts ADR-0131 implementation ─────────────

describe('ADR-0131 fork source — hive-mind-tools.ts', () => {
  const src = existsSync(FORK_HIVE_TOOLS) ? readFileSync(FORK_HIVE_TOOLS, 'utf8') : '';

  it('exports WorkerAlreadyFailedError class', () => {
    assert.match(src, /export class WorkerAlreadyFailedError/);
  });

  it('exports ProposalAlreadyFailedError class', () => {
    assert.match(src, /export class ProposalAlreadyFailedError/);
  });

  it('exports WorkerMeta interface with failedAt + retryOf fields', () => {
    assert.match(src, /export interface WorkerMeta/);
    assert.match(src, /failedAt:\s*number\s*\|\s*null/);
    assert.match(src, /retryOf:\s*string\s*\|\s*null/);
  });

  it('exports workerMetaFor() lazy-default helper', () => {
    assert.match(src, /export function workerMetaFor/);
  });

  it('exports markWorkerFailed() forward-only marker', () => {
    assert.match(src, /export function markWorkerFailed/);
  });

  it('exports registerWorkerRetry() lineage helper', () => {
    assert.match(src, /export function registerWorkerRetry/);
  });

  it('exports reconcileFailedFromStatusKeys() §6-marker propagator', () => {
    assert.match(src, /export function reconcileFailedFromStatusKeys/);
  });

  it('HiveState includes optional workerMeta map', () => {
    assert.match(src, /workerMeta\?\:\s*Record<string,\s*WorkerMeta>/);
  });

  it('ConsensusProposal.status union includes failed-quorum-not-reached literal', () => {
    // Per ADR-0131 §Specification: verbatim contract literal.
    assert.match(src, /'pending'\s*\|\s*'approved'\s*\|\s*'rejected'\s*\|\s*'failed-quorum-not-reached'/);
  });

  it('ConsensusProposal includes optional absentVoters field', () => {
    assert.match(src, /absentVoters\?\:\s*string\[\]/);
  });

  it('ConsensusResult.result union includes failed-quorum-not-reached literal', () => {
    assert.match(src, /result:\s*'approved'\s*\|\s*'rejected'\s*\|\s*'failed-quorum-not-reached'/);
  });

  it('_consensus({action:status}) auto-transition predicate uses Date.now() and timeoutAt', () => {
    // ADR-0185 Wave 4: status-action auto-transition moved into agentdb
    // per-strategy handlers. Each of bft/raft/quorum/weighted handlers
    // tests `Date.now() >= new Date(proposal.timeoutAt).getTime()` as the
    // trigger predicate (verified: bft.ts:242, raft.ts:200, quorum.ts:186,
    // weighted.ts:217). Gossip + crdt have their own settle paths and
    // are correctly EXCLUDED (they don't set timeoutAt at propose-time).
    for (const path of AGENTDB_THRESHOLD_STATUS_HANDLERS) {
      const handlerSrc = existsSync(path) ? readFileSync(path, 'utf8') : '';
      assert.match(handlerSrc, /Date\.now\(\)\s*>=\s*new Date\(proposal\.timeoutAt\)\.getTime\(\)/, `auto-transition predicate missing in ${path}`);
    }
  });

  it('_consensus({action:status}) computes absentVoters from state.workers minus voted', () => {
    // ADR-0185 Wave 4: absentVoters computation moved to agentdb threshold
    // handlers (raft.ts:204, bft.ts:246, quorum.ts:190, weighted.ts:221).
    for (const path of AGENTDB_THRESHOLD_STATUS_HANDLERS) {
      const handlerSrc = existsSync(path) ? readFileSync(path, 'utf8') : '';
      assert.match(handlerSrc, /state\.workers\.filter\(\s*\([^)]*\)\s*=>\s*!\([^)]*\s*in\s+proposal\.votes\)/, `absentVoters filter missing in ${path}`);
    }
  });

  it('_consensus({action:status}) sets failed-quorum-not-reached on transition', () => {
    assert.match(src, /'failed-quorum-not-reached'/);
  });

  it('_consensus({action:status}) returns statusJustTransitioned in response', () => {
    // ADR-0185 Wave 4: `statusJustTransitioned` field is emitted by the
    // response-builder (Wave 1 introduced; agentdb's status handlers
    // return void and the builder projects post-dispatch state into the
    // response shape including this field). Builder emits it on both
    // the history-fallback path and the pending-still path.
    const builderSrc = existsSync(CLI_RESPONSE_BUILDER) ? readFileSync(CLI_RESPONSE_BUILDER, 'utf8') : '';
    assert.match(builderSrc, /statusJustTransitioned/, `statusJustTransitioned missing in ${CLI_RESPONSE_BUILDER}`);
  });

  it('_consensus({action:vote}) throws WorkerAlreadyFailedError on failed worker', () => {
    // ADR-0185 Wave 3: cli's vote-action throws of WorkerAlreadyFailedError
    // moved into agentdb per-strategy vote handlers (bft.ts:134, raft.ts:134,
    // quorum.ts:115, weighted.ts:140, gossip.ts:135, crdt.ts:145). The
    // ADR-0131 invariant "vote against a failed worker must throw
    // synchronously" still holds; the assertion grep each agentdb per-
    // strategy handler. Cli's `export class WorkerAlreadyFailedError`
    // remains for `instanceof` discrimination at the Wave 3 try/catch site.
    for (const path of AGENTDB_VOTE_HANDLERS) {
      const handlerSrc = existsSync(path) ? readFileSync(path, 'utf8') : '';
      assert.match(handlerSrc, /throw new WorkerAlreadyFailedError/, `WorkerAlreadyFailedError throw missing in ${path}`);
    }
  });

  it('_consensus({action:vote}) throws ProposalAlreadyFailedError on terminal proposal', () => {
    // ADR-0185 Wave 3: throws moved to agentdb per-strategy handlers (bft.ts:109,
    // raft.ts:113, quorum.ts:94, weighted.ts:114, gossip.ts:114, crdt.ts:124).
    for (const path of AGENTDB_VOTE_HANDLERS) {
      const handlerSrc = existsSync(path) ? readFileSync(path, 'utf8') : '';
      assert.match(handlerSrc, /throw new ProposalAlreadyFailedError/, `ProposalAlreadyFailedError throw missing in ${path}`);
    }
  });

  it('hive-mind_status response includes failedWorkers summary field', () => {
    assert.match(src, /failedWorkers/);
  });

  it('hive-mind_spawn supports retryTask action', () => {
    assert.match(src, /enum:\s*\[\s*'spawn',\s*'retryTask'\s*\]/);
  });

  it('hive-mind_spawn supports retryOf input parameter', () => {
    assert.match(src, /retryOf:\s*\{[^}]*type:\s*'string'/);
  });

  it('hive-mind_spawn retry uses canonical worker-<original>-retry-1 ID convention', () => {
    // Per ADR-0131 §Refinement edge case "Worker re-spawn with same ID":
    // canonical retry-ID convention is `worker-<original>-retry-1`.
    assert.match(src, /retry-1/);
  });

  it('propose-time timeoutAt is set for ALL threshold-based strategies (not just raft)', () => {
    // Per ADR-0131: auto-transition fires across bft/raft/quorum/weighted.
    // ADR-0185 Wave 2b: cli's `isThresholdBased` helper removed when propose
    // flipped to archivist.dispatch; the threshold-check logic now lives in
    // each agentdb per-strategy handler's propose case. Each of bft/raft/
    // quorum/weighted handlers sets `proposal.timeoutAt` at propose-time
    // (verified: bft.ts:81, raft.ts:85, quorum.ts:67, weighted.ts:86).
    // Gossip + crdt handlers do NOT set timeoutAt (their own per-round
    // settle paths handle timeout-driven resolution — pre-flip exclusion
    // preserved).
    const bftSrc = existsSync(AGENTDB_BFT_HANDLER) ? readFileSync(AGENTDB_BFT_HANDLER, 'utf8') : '';
    const raftSrc = existsSync(AGENTDB_RAFT_HANDLER) ? readFileSync(AGENTDB_RAFT_HANDLER, 'utf8') : '';
    const quorumSrc = existsSync(AGENTDB_QUORUM_HANDLER) ? readFileSync(AGENTDB_QUORUM_HANDLER, 'utf8') : '';
    const weightedSrc = existsSync(AGENTDB_WEIGHTED_HANDLER) ? readFileSync(AGENTDB_WEIGHTED_HANDLER, 'utf8') : '';
    assert.match(bftSrc, /timeoutAt:\s*new Date\(Date\.now\(\)\s*\+\s*timeoutMs\)/);
    assert.match(raftSrc, /timeoutAt:\s*new Date\(Date\.now\(\)\s*\+\s*timeoutMs\)/);
    assert.match(quorumSrc, /timeoutAt:\s*new Date\(Date\.now\(\)\s*\+\s*timeoutMs\)/);
    assert.match(weightedSrc, /timeoutAt:\s*new Date\(Date\.now\(\)\s*\+\s*timeoutMs\)/);
  });

  it('idempotency guard dedupes on proposalId before pushing to history', () => {
    // Per ADR-0131 §Refinement edge case "Concurrent transitions".
    // ADR-0185 Wave 4: idempotency guard moved to agentdb threshold handlers
    // (raft.ts:213, bft.ts:255, quorum.ts:199, weighted.ts:230 — each has
    // 2 hits: `const alreadyInHistory = ...some(...)` + `if (!alreadyInHistory)`).
    for (const path of AGENTDB_THRESHOLD_STATUS_HANDLERS) {
      const handlerSrc = existsSync(path) ? readFileSync(path, 'utf8') : '';
      assert.match(handlerSrc, /alreadyInHistory/, `alreadyInHistory guard missing in ${path}`);
    }
  });
});

// ── 4. In-fork test coverage ───────────────────────────────────────────────

describe('ADR-0131 in-fork test coverage', () => {
  it('mcp-tools-deep.test.ts carries an ADR-0131 (T12) describe block', () => {
    const src = existsSync(FORK_DEEP_TEST) ? readFileSync(FORK_DEEP_TEST, 'utf8') : '';
    assert.match(src, /describe\(['"`]ADR-0131 \(T12\)/);
  });

  it('in-fork tests cover §6 prompt sentinel substrings', () => {
    const src = existsSync(FORK_DEEP_TEST) ? readFileSync(FORK_DEEP_TEST, 'utf8') : '';
    assert.match(src, /t12_§6_prompt_carries_WORKER_FAILURE_PROTOCOL_block/);
  });

  it('in-fork tests cover auto-transition for bft/raft/quorum/weighted', () => {
    const src = existsSync(FORK_DEEP_TEST) ? readFileSync(FORK_DEEP_TEST, 'utf8') : '';
    // The auto-transition test parameterises over the four threshold-based
    // strategies via a for-of loop and a template literal in the test name.
    // Assert the parameterisation source exists (the strategies array + the
    // `t12_auto_transition_fires_for_${strategy}` template).
    assert.match(src, /t12_auto_transition_fires_for_\$\{strategy\}/);
    assert.match(src, /\['bft',\s*'raft',\s*'quorum',\s*'weighted'\]/);
  });

  it('in-fork tests cover absentVoters population correctness', () => {
    const src = existsSync(FORK_DEEP_TEST) ? readFileSync(FORK_DEEP_TEST, 'utf8') : '';
    assert.match(src, /t12_absentVoters_matches_state_workers_minus_voted/);
  });

  it('in-fork tests cover proposal pending → history transition', () => {
    const src = existsSync(FORK_DEEP_TEST) ? readFileSync(FORK_DEEP_TEST, 'utf8') : '';
    assert.match(src, /t12_transition_moves_proposal_pending_to_history/);
  });

  it('in-fork tests cover statusJustTransitioned semantics', () => {
    const src = existsSync(FORK_DEEP_TEST) ? readFileSync(FORK_DEEP_TEST, 'utf8') : '';
    assert.match(src, /t12_statusJustTransitioned_only_true_on_firing_call/);
  });

  it('in-fork tests cover ProposalAlreadyFailedError', () => {
    const src = existsSync(FORK_DEEP_TEST) ? readFileSync(FORK_DEEP_TEST, 'utf8') : '';
    assert.match(src, /t12_vote_against_failed_proposal_throws_ProposalAlreadyFailedError/);
  });

  it('in-fork tests cover WorkerAlreadyFailedError', () => {
    const src = existsSync(FORK_DEEP_TEST) ? readFileSync(FORK_DEEP_TEST, 'utf8') : '';
    assert.match(src, /t12_vote_from_failed_worker_throws_WorkerAlreadyFailedError/);
  });

  it('in-fork tests cover retryOf round-trip', () => {
    const src = existsSync(FORK_DEEP_TEST) ? readFileSync(FORK_DEEP_TEST, 'utf8') : '';
    assert.match(src, /t12_retryOf_round_trip_via_loadHiveState_saveHiveState/);
  });

  it('in-fork tests cover loadHiveState defaults on legacy state', () => {
    const src = existsSync(FORK_DEEP_TEST) ? readFileSync(FORK_DEEP_TEST, 'utf8') : '';
    assert.match(src, /t12_loadHiveState_defaults_workerMeta_on_legacy_state/);
  });

  it('in-fork tests cover failedWorkers status surface', () => {
    const src = existsSync(FORK_DEEP_TEST) ? readFileSync(FORK_DEEP_TEST, 'utf8') : '';
    assert.match(src, /t12_status_response_includes_failedWorkers_summary/);
  });

  it('in-fork tests cover concurrent-transition idempotency', () => {
    const src = existsSync(FORK_DEEP_TEST) ? readFileSync(FORK_DEEP_TEST, 'utf8') : '';
    assert.match(src, /t12_concurrent_status_calls_produce_one_history_row/);
  });

  it('in-fork tests cover §6-marker reconciliation', () => {
    const src = existsSync(FORK_DEEP_TEST) ? readFileSync(FORK_DEEP_TEST, 'utf8') : '';
    assert.match(src, /t12_reconcile_propagates_status_keys_into_workerMeta/);
  });
});
