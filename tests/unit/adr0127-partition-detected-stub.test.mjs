// @tier unit
// ADR-0127 T9 — `partitionDetected` field on `HealthReport`.
//
// History: Wave 1 (b45e8e471) added a type-level stub that
// default-initialized `partitionDetected: false` literally. Wave 3
// (this) replaced the stub with runtime computation via
// `detectPartitionFromHeartbeats` (from `adaptive-loop.ts`). The field
// is now populated from heartbeat asymmetry / quorum-loss signals per
// ADR-0127 §Refinement, NOT a hardcoded `false`.
//
// This test guards the post-Wave-3 contract:
//   1. The fork source file exists.
//   2. The `HealthReport` interface declaration contains a
//      `partitionDetected: boolean` member (required, not optional) —
//      unchanged from Wave 1.
//   3. The single existing construction site in `monitorSwarmHealth`
//      references the *computed* `partitionDetected` variable, NOT the
//      hardcoded `false` literal. The literal `partitionDetected: false`
//      is allowed in fallback / error-path code (e.g. when corrupt
//      heartbeats throw), but NOT in the unconditional ctor.
//
// MUST FAIL if a future maintainer drops the field OR reverts to the
// hardcoded literal — per `feedback-no-squelch-tests.md`, this is a
// real string-grep assertion, not a no-op.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';

const FORK_SRC = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/swarm/src/queen-coordinator.ts';

describe('ADR-0127 T9 pre-flight: HealthReport.partitionDetected interface stub', () => {
  it('fork source file exists', () => {
    assert.ok(existsSync(FORK_SRC), `expected ${FORK_SRC}`);
  });

  const src = existsSync(FORK_SRC) ? readFileSync(FORK_SRC, 'utf8') : '';

  it('HealthReport interface declares partitionDetected as required boolean', () => {
    // Slice from the interface declaration to its closing brace.
    const interfaceStart = src.indexOf('export interface HealthReport {');
    assert.ok(
      interfaceStart >= 0,
      'expected `export interface HealthReport {` declaration in queen-coordinator.ts',
    );
    const closingBrace = src.indexOf('\n}', interfaceStart);
    assert.ok(
      closingBrace > interfaceStart,
      'expected closing brace for HealthReport interface',
    );
    const interfaceBody = src.slice(interfaceStart, closingBrace);

    // Field must be present and required (no `?:`).
    assert.match(
      interfaceBody,
      /\bpartitionDetected\s*:\s*boolean\s*;/,
      'HealthReport must declare `partitionDetected: boolean` (required, not optional)',
    );
    assert.doesNotMatch(
      interfaceBody,
      /\bpartitionDetected\?\s*:/,
      'partitionDetected must be REQUIRED, not optional — T9 default-initializes at construction',
    );
  });

  it('monitorSwarmHealth construction site uses computed partitionDetected (Wave 3 contract)', () => {
    // Find the `const report: HealthReport = { ... }` construction inside
    // monitorSwarmHealth. It is the ONLY HealthReport construction site
    // in this file (greppable via that exact prefix).
    const ctorIdx = src.indexOf('const report: HealthReport = {');
    assert.ok(
      ctorIdx >= 0,
      'expected `const report: HealthReport = {` construction site in monitorSwarmHealth',
    );
    // Slice the literal object — close brace marker `};` ends it.
    const ctorEnd = src.indexOf('};', ctorIdx);
    assert.ok(ctorEnd > ctorIdx, 'expected `};` closing the HealthReport literal');
    const ctorBody = src.slice(ctorIdx, ctorEnd);

    // Wave 3 (post-T9): the ctor must use the computed `partitionDetected`
    // variable (set from `detectPartitionFromHeartbeats(...)`), NOT the
    // hardcoded `partitionDetected: false` literal that Wave 1 used.
    assert.match(
      ctorBody,
      /\bpartitionDetected,/,
      'Wave 3 contract: HealthReport ctor must reference computed `partitionDetected` variable, not a literal',
    );
    assert.doesNotMatch(
      ctorBody,
      /\bpartitionDetected\s*:\s*false\b/,
      'Wave 3 contract: hardcoded `partitionDetected: false` must NOT appear in the ctor — that is the Wave 1 stub which has been replaced by runtime detection',
    );
  });

  it('monitorSwarmHealth references detectPartitionFromHeartbeats (Wave 3)', () => {
    // The runtime path: monitorSwarmHealth must call into the loop's
    // pure helper (imported from adaptive-loop.js). Without this call,
    // the partition-asymmetric integration test for T9 cannot pass.
    assert.match(
      src,
      /detectPartitionFromHeartbeats\s*\(/,
      'Wave 3: monitorSwarmHealth must call detectPartitionFromHeartbeats from adaptive-loop.ts',
    );
  });
});
