// @tier unit
// ADR-0127 T9 pre-flight stub — type-level `partitionDetected` field on `HealthReport`.
//
// Per /Users/henrik/source/ruflo-patch/docs/adr/ADR-0118-execution-plan.md
// §Pre-flight checks row 6 and ADR-0118-review-notes-triage.md row 46:
//
//   `partitionDetected` does NOT exist on the `HealthReport` interface.
//   T9 (ADR-0127, Wave 3) cannot pass its partition-asymmetric integration
//   test without this field. Wave 1 pre-flight adds a TYPE-LEVEL stub
//   only (no runtime detection logic) so that Wave 3's T9 implementer
//   has a stable interface to fill in.
//
// This test guards the contract:
//   1. The fork source file exists.
//   2. The `HealthReport` interface declaration contains a
//      `partitionDetected: boolean` member (required, not optional).
//   3. The single existing construction site in `monitorSwarmHealth`
//      default-initializes the field (T9 will replace `false` with real
//      detection logic; the stub MUST default-init or every other call
//      site that constructs a HealthReport breaks compilation).
//
// MUST FAIL if a future maintainer drops the field — per
// `feedback-no-squelch-tests.md`, this is a real string-grep assertion,
// not a no-op.

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

  it('monitorSwarmHealth construction site default-initializes partitionDetected to false', () => {
    // Find the `const report: HealthReport = { ... }` construction inside
    // monitorSwarmHealth (line ~1455). It is the ONLY HealthReport
    // construction site in this file (greppable via that exact prefix).
    const ctorIdx = src.indexOf('const report: HealthReport = {');
    assert.ok(
      ctorIdx >= 0,
      'expected `const report: HealthReport = {` construction site in monitorSwarmHealth',
    );
    // Slice the literal object — close brace marker `};` ends it.
    const ctorEnd = src.indexOf('};', ctorIdx);
    assert.ok(ctorEnd > ctorIdx, 'expected `};` closing the HealthReport literal');
    const ctorBody = src.slice(ctorIdx, ctorEnd);

    assert.match(
      ctorBody,
      /\bpartitionDetected\s*:\s*false\b/,
      'monitorSwarmHealth must default-init partitionDetected to false; T9 (Wave 3) replaces this with runtime detection',
    );
  });
});
