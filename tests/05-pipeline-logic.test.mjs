// @tier unit
// Tests for pipeline logic — version computation, state file handling,
// change detection, and first-publish bootstrap.
// ADRs: 0011 (dual build trigger), 0012 (version numbering — bump-last-segment), 0015 (first-publish).

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  computeVersion,
  parseState,
  serializeState,
  detectChanges,
  getPublishTag,
} from './helpers/pipeline-helpers.mjs';

// ---------------------------------------------------------------------------
// 1. Version computation (ADR-0012 — bump-last-segment scheme)
// ---------------------------------------------------------------------------

describe('computeVersion (ADR-0012)', () => {
  it('first build from upstream 3.0.2 -> 3.0.3', () => {
    const result = computeVersion('3.0.2', null);
    assert.equal(result.version, '3.0.3');
  });

  it('same upstream, last published 3.0.3 -> 3.0.4', () => {
    const result = computeVersion('3.0.2', '3.0.3');
    assert.equal(result.version, '3.0.4');
  });

  it('upstream bumps past last published -> upstream+1', () => {
    const result = computeVersion('3.0.5', '3.0.4');
    assert.equal(result.version, '3.0.6');
  });

  it('upstream jumps to equal last published -> bump from max', () => {
    const result = computeVersion('3.0.5', '3.0.5');
    assert.equal(result.version, '3.0.6');
  });

  it('first build from upstream 3.5.2 -> 3.5.3', () => {
    const result = computeVersion('3.5.2', null);
    assert.equal(result.version, '3.5.3');
  });

  it('upstream changes from 3.5.2 to 3.5.3, last published 3.5.3 -> 3.5.4', () => {
    const result = computeVersion('3.5.3', '3.5.3');
    assert.equal(result.version, '3.5.4');
  });

  it('upstream alpha 3.0.0-alpha.6 first build -> 3.0.0-alpha.7', () => {
    const result = computeVersion('3.0.0-alpha.6', null);
    assert.equal(result.version, '3.0.0-alpha.7');
  });

  it('subsequent build from alpha, last published 3.0.0-alpha.7 -> 3.0.0-alpha.8', () => {
    const result = computeVersion('3.0.0-alpha.6', '3.0.0-alpha.7');
    assert.equal(result.version, '3.0.0-alpha.8');
  });

  it('upstream alpha bumps, last published higher -> bump from max', () => {
    const result = computeVersion('3.0.0-alpha.7', '3.0.0-alpha.8');
    assert.equal(result.version, '3.0.0-alpha.9');
  });

  it('upstream 3.1.0-alpha.14 first build -> 3.1.0-alpha.15', () => {
    const result = computeVersion('3.1.0-alpha.14', null);
    assert.equal(result.version, '3.1.0-alpha.15');
  });

  it('upstream 1.0.18 first build -> 1.0.19', () => {
    const result = computeVersion('1.0.18', null);
    assert.equal(result.version, '1.0.19');
  });

  it('upstream 2.0.2-alpha (no trailing number) -> 2.0.2-alpha.1', () => {
    const result = computeVersion('2.0.2-alpha', null);
    assert.equal(result.version, '2.0.2-alpha.1');
  });

  it('upstream 2.0.2-alpha, last published 2.0.2-alpha.1 -> 2.0.2-alpha.2', () => {
    const result = computeVersion('2.0.2-alpha', '2.0.2-alpha.1');
    assert.equal(result.version, '2.0.2-alpha.2');
  });
});

// ---------------------------------------------------------------------------
// 2. State file parsing
// ---------------------------------------------------------------------------

describe('parseState', () => {
  const SAMPLE_STATE = [
    'RUFLO_HEAD=abc1234def5678',
    'AGENTIC_FLOW_HEAD=def5678abc1234',
    'RUV_FANN_HEAD=123abc456def',
    'LOCAL_COMMIT=789def012abc',
    'BUILD_TIMESTAMP=2026-03-05T00:00:00Z',
    'BUILD_VERSION=3.5.3',
  ].join('\n');

  it('parses all fields from valid state file', () => {
    const state = parseState(SAMPLE_STATE);
    assert.equal(state.rufloHead, 'abc1234def5678');
    assert.equal(state.agenticFlowHead, 'def5678abc1234');
    assert.equal(state.ruvFannHead, '123abc456def');
    assert.equal(state.localCommit, '789def012abc');
    assert.equal(state.buildTimestamp, '2026-03-05T00:00:00Z');
    assert.equal(state.buildVersion, '3.5.3');
  });

  it('returns null for empty content', () => {
    assert.equal(parseState(''), null);
    assert.equal(parseState(null), null);
    assert.equal(parseState(undefined), null);
  });

  it('ignores comment lines and blank lines', () => {
    const content = '# Comment\n\nRUFLO_HEAD=abc\n  # Another comment\nLOCAL_COMMIT=def\n';
    const state = parseState(content);
    assert.equal(state.rufloHead, 'abc');
    assert.equal(state.localCommit, 'def');
    assert.equal(state.agenticFlowHead, '');
  });

  it('handles values containing equals signs', () => {
    const content = 'BUILD_VERSION=3.5.3\nRUFLO_HEAD=abc=def\n';
    const state = parseState(content);
    assert.equal(state.buildVersion, '3.5.3');
    assert.equal(state.rufloHead, 'abc=def');
  });

  it('defaults missing keys to empty strings', () => {
    const content = 'RUFLO_HEAD=abc\n';
    const state = parseState(content);
    assert.equal(state.rufloHead, 'abc');
    assert.equal(state.agenticFlowHead, '');
    assert.equal(state.ruvFannHead, '');
    assert.equal(state.localCommit, '');
    assert.equal(state.buildTimestamp, '');
    assert.equal(state.buildVersion, '');
  });
});

// ---------------------------------------------------------------------------
// 3. State file serialization and round-trip
// ---------------------------------------------------------------------------

describe('serializeState', () => {
  it('produces KEY=VALUE format with trailing newline', () => {
    const state = {
      rufloHead: 'aaa',
      agenticFlowHead: 'bbb',
      ruvFannHead: 'ccc',
      localCommit: 'ddd',
      buildTimestamp: '2026-03-05T12:00:00Z',
      buildVersion: '3.5.3',
    };
    const output = serializeState(state);
    assert.ok(output.includes('RUFLO_HEAD=aaa'));
    assert.ok(output.includes('AGENTIC_FLOW_HEAD=bbb'));
    assert.ok(output.includes('RUV_FANN_HEAD=ccc'));
    assert.ok(output.includes('LOCAL_COMMIT=ddd'));
    assert.ok(output.includes('BUILD_TIMESTAMP=2026-03-05T12:00:00Z'));
    assert.ok(output.includes('BUILD_VERSION=3.5.3'));
    assert.ok(output.endsWith('\n'), 'should end with newline');
  });

  it('round-trips through parse -> serialize -> parse', () => {
    const original = {
      rufloHead: 'abc123',
      agenticFlowHead: 'def456',
      ruvFannHead: '789ghi',
      localCommit: 'jkl012',
      buildTimestamp: '2026-03-05T00:00:00Z',
      buildVersion: '3.5.3',
    };
    const serialized = serializeState(original);
    const reparsed = parseState(serialized);
    assert.deepEqual(reparsed, original);
  });

  it('updated state reflects new HEADs and version after build', () => {
    const before = {
      rufloHead: 'old_ruflo',
      agenticFlowHead: 'old_af',
      ruvFannHead: 'old_fann',
      localCommit: 'old_local',
      buildTimestamp: '2026-03-04T00:00:00Z',
      buildVersion: '3.5.3',
    };
    // Simulate a successful build updating the state
    const after = {
      ...before,
      rufloHead: 'new_ruflo',
      localCommit: 'new_local',
      buildTimestamp: '2026-03-05T12:00:00Z',
      buildVersion: '3.5.4',
    };
    const serialized = serializeState(after);
    const reparsed = parseState(serialized);
    assert.equal(reparsed.rufloHead, 'new_ruflo');
    assert.equal(reparsed.localCommit, 'new_local');
    assert.equal(reparsed.buildVersion, '3.5.4');
    // Unchanged fields preserved
    assert.equal(reparsed.agenticFlowHead, 'old_af');
    assert.equal(reparsed.ruvFannHead, 'old_fann');
  });
});

// ---------------------------------------------------------------------------
// 4. Change detection (ADR-0011)
// ---------------------------------------------------------------------------

describe('detectChanges (ADR-0011)', () => {
  const baseHeads = {
    rufloHead: 'aaa',
    agenticFlowHead: 'bbb',
    ruvFannHead: 'ccc',
    localCommit: 'ddd',
  };

  it('no previous state (first build) -> should build', () => {
    const result = detectChanges(baseHeads, null);
    assert.equal(result.shouldBuild, true);
    assert.ok(result.reasons.length > 0);
    assert.ok(result.reasons[0].includes('first build'));
  });

  it('upstream ruflo HEAD changed -> should build', () => {
    const current = { ...baseHeads, rufloHead: 'new_aaa' };
    const result = detectChanges(current, baseHeads);
    assert.equal(result.shouldBuild, true);
    assert.ok(result.reasons.some(r => r.includes('ruflo')));
  });

  it('upstream agentic-flow HEAD changed -> should build', () => {
    const current = { ...baseHeads, agenticFlowHead: 'new_bbb' };
    const result = detectChanges(current, baseHeads);
    assert.equal(result.shouldBuild, true);
    assert.ok(result.reasons.some(r => r.includes('agentic-flow')));
  });

  it('upstream ruv-FANN HEAD changed -> should build', () => {
    const current = { ...baseHeads, ruvFannHead: 'new_ccc' };
    const result = detectChanges(current, baseHeads);
    assert.equal(result.shouldBuild, true);
    assert.ok(result.reasons.some(r => r.includes('ruv-FANN')));
  });

  it('local commit changed (patch/ update) -> should build', () => {
    const current = { ...baseHeads, localCommit: 'new_ddd' };
    const result = detectChanges(current, baseHeads);
    assert.equal(result.shouldBuild, true);
    assert.ok(result.reasons.some(r => r.includes('Local commit')));
  });

  it('no changes -> should NOT build', () => {
    const result = detectChanges({ ...baseHeads }, { ...baseHeads });
    assert.equal(result.shouldBuild, false);
    assert.equal(result.reasons.length, 0);
  });

  it('multiple changes -> all reported in reasons', () => {
    const current = {
      rufloHead: 'new_aaa',
      agenticFlowHead: 'new_bbb',
      ruvFannHead: 'ccc',
      localCommit: 'new_ddd',
    };
    const result = detectChanges(current, baseHeads);
    assert.equal(result.shouldBuild, true);
    assert.equal(result.reasons.length, 3);
  });

  it('network error on git ls-remote -> caller passes last-known HEAD unchanged, no crash', () => {
    const lastKnownOnError = { ...baseHeads };
    const result = detectChanges(lastKnownOnError, baseHeads);
    assert.equal(result.shouldBuild, false);
  });
});

// ---------------------------------------------------------------------------
// 5. First-publish detection (ADR-0015)
// ---------------------------------------------------------------------------

describe('getPublishTag (ADR-0015)', () => {
  it('npm view returns E404 -> returns null (first publish, no tag)', async () => {
    const npmViewE404 = async () => {
      const err = new Error('E404 - Not Found');
      err.code = 'E404';
      throw err;
    };
    const tag = await getPublishTag(npmViewE404, 'ruflo');
    assert.equal(tag, null);
  });

  it('npm view returns a version -> returns "prerelease"', async () => {
    const npmViewOk = async () => '3.0.3';
    const tag = await getPublishTag(npmViewOk, 'ruflo');
    assert.equal(tag, 'prerelease');
  });

  it('npm view returns network error -> throws (not treated as first-publish)', async () => {
    const npmViewNetErr = async () => {
      const err = new Error('ETIMEDOUT - network error');
      err.code = 'ETIMEDOUT';
      throw err;
    };
    await assert.rejects(
      () => getPublishTag(npmViewNetErr, 'ruflo'),
      (err) => {
        assert.equal(err.code, 'ETIMEDOUT');
        return true;
      },
    );
  });

  it('npm view returns ECONNREFUSED -> throws (not treated as first-publish)', async () => {
    const npmViewConnRefused = async () => {
      const err = new Error('ECONNREFUSED');
      err.code = 'ECONNREFUSED';
      throw err;
    };
    await assert.rejects(
      () => getPublishTag(npmViewConnRefused, 'ruflo'),
      (err) => {
        assert.equal(err.code, 'ECONNREFUSED');
        return true;
      },
    );
  });

  it('npm view throws with no code -> throws (defensive)', async () => {
    const npmViewGenericErr = async () => {
      throw new Error('something unexpected');
    };
    await assert.rejects(
      () => getPublishTag(npmViewGenericErr, 'ruflo'),
      /something unexpected/,
    );
  });

  it('passes package name to the npm view function', async () => {
    let receivedName;
    const spy = async (name) => {
      receivedName = name;
      return '1.0.0';
    };
    await getPublishTag(spy, '@sparkleideas/cli');
    assert.equal(receivedName, '@sparkleideas/cli');
  });
});
