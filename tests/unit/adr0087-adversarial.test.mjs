// @tier unit
// ADR-0087: Adversarial Prompting Workflow
//
// London School TDD: tests classify(), advisory(), recommendSessions(),
// sessionAdvisory(), reviewChecklist(), and reviewAdvisory() in isolation.
//
// Phase 1 Coverage:
//   T1.1  classify — architectural prompts flagged
//   T1.2  classify — trivial prompts not flagged
//   T1.3  classify — edge cases (short, empty, no match)
//   T1.4  classify — precedence: architectural wins over trivial
//   T1.5  classify — new verbs: replace, split, move, introduce, deprecate
//   T1.6  classify — isolated pattern hits (data-model, api-change, phased-work)
//   T1.7  classify — case insensitive matching
//   T1.8  classify — 10-char boundary
//   T1.9  classify — collects all triggers, not just first
//   T1.10 advisory — single-line format with triggers
//   T1.11 advisory — null when not adversarial
//   T1.12 advisory — defensive: missing triggers array
//   T1.13 integration — hook-handler route emits advisory
//   T1.14 integration — hook-handler route survives without adversarial module
//
// Phase 2 Coverage:
//   T2.1  THINKING_SESSIONS — canonical list
//   T2.2  SESSION_MAP — all triggers mapped, all get 5 sessions
//   T2.3  recommendSessions — maps triggers to sessions
//   T2.4  recommendSessions — edge cases
//   T2.5  sessionAdvisory — format
//   T2.6  composition — classify → recommendSessions → sessionAdvisory
//   T2.7  integration — hook-handler emits session advisory
//   T2.8  integration — adversarial advisory precedes session advisory
//
// Phase 3 Coverage:
//   T3.1  REVIEW_CATEGORIES — canonical list
//   T3.2  TRIGGER_REVIEWS — all triggers mapped, valid categories, frozen
//   T3.3  reviewChecklist — maps triggers to review categories
//   T3.4  reviewChecklist — edge cases
//   T3.5  reviewAdvisory — format
//   T3.6  composition — classify → reviewChecklist → reviewAdvisory
//   T3.7  integration — hook-handler emits review advisory
//   T3.8  integration — advisory ordering (adversarial < session < review)

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

// Direct require of CJS module from ESM
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const {
  classify, advisory,
  recommendSessions, sessionAdvisory,
  reviewChecklist, reviewAdvisory,
  ARCHITECTURAL_PATTERNS, TRIVIAL_PATTERNS,
  THINKING_SESSIONS, SESSION_MAP,
  REVIEW_CATEGORIES, TRIGGER_REVIEWS,
} = require('../../.claude/helpers/adversarial.cjs');

// ============================================================================
// T1.1 classify — architectural prompts flagged
// ============================================================================

describe('ADR-0087 classify — architectural prompts', () => {
  const architecturalPrompts = [
    ['implement phase 1 of adr 87', ['adr-reference', 'phased-work']],
    ['build a new feature for user authentication', ['new-feature']],
    ['refactor the storage layer', ['refactor']],
    ['architect the new event system', ['architecture']],
    ['migrate the database schema change to v2', ['refactor', 'data-model']],
    ['implement a new module for logging', ['new-feature']],
    ['restructure the api interface change handling', ['refactor', 'api-change']],
    ['add a new service for notifications', ['new-feature']],
    ['delete module for legacy auth', ['removal']],
    ['rip out the old controller layer', ['removal']],
    ['cross-cutting concern for observability', ['cross-cutting']],
    ['multi-file refactor of the router', ['multi-scope', 'refactor']],
    ['implement ADR-0086 layer 1 storage abstraction', ['adr-reference']],
    ['system design for the new pipeline', ['architecture']],
  ];

  for (const [prompt, expectedTriggers] of architecturalPrompts) {
    it(`flags: "${prompt}"`, () => {
      const result = classify(prompt);
      assert.equal(result.adversarial, true, `expected adversarial=true for "${prompt}"`);
      assert.equal(result.reason, 'architectural');
      for (const trigger of expectedTriggers) {
        assert.ok(
          result.triggers.includes(trigger),
          `expected trigger "${trigger}" in [${result.triggers}] for "${prompt}"`,
        );
      }
    });
  }
});

// ============================================================================
// T1.2 classify — trivial prompts not flagged
// ============================================================================

describe('ADR-0087 classify — trivial prompts', () => {
  const trivialPrompts = [
    'fix typo in the readme',
    'update version to 3.1.0',
    'bump version for release',
    'run tests on the project',
    'check status of the build',
    'lint the codebase please',
    'format the source files',
    'config change for verdaccio',
    'update docs for the new flag',
    'commit the changes now',
    'push to remote origin',
    'merge the PR into main',
    'edit changelog entry for v2',
  ];

  for (const prompt of trivialPrompts) {
    it(`skips: "${prompt}"`, () => {
      const result = classify(prompt);
      assert.equal(result.adversarial, false, `expected adversarial=false for "${prompt}"`);
    });
  }
});

// ============================================================================
// T1.3 classify — edge cases
// ============================================================================

describe('ADR-0087 classify — edge cases', () => {
  it('returns false for empty string', () => {
    assert.equal(classify('').adversarial, false);
    assert.equal(classify('').reason, 'too-short');
  });

  it('returns false for null/undefined', () => {
    assert.equal(classify(null).adversarial, false);
    assert.equal(classify(undefined).adversarial, false);
  });

  it('returns false for short strings', () => {
    assert.equal(classify('hi').adversarial, false);
    assert.equal(classify('fix bug').adversarial, false);
  });

  it('returns false for prompts with no pattern match', () => {
    const result = classify('what is the meaning of life and everything in it');
    assert.equal(result.adversarial, false);
    assert.equal(result.reason, 'no-match');
  });
});

// ============================================================================
// T1.4 classify — precedence: architectural wins over trivial
// ============================================================================

describe('ADR-0087 classify — precedence (architectural wins)', () => {
  it('refactor + commit → architectural wins', () => {
    const result = classify('commit the refactored auth module to the repo');
    assert.equal(result.adversarial, true);
    assert.ok(result.triggers.includes('refactor'));
  });

  it('refactor + run tests → architectural wins', () => {
    const result = classify('run tests for the refactor of the storage layer');
    assert.equal(result.adversarial, true);
    assert.ok(result.triggers.includes('refactor'));
  });

  it('architecture + config → architectural wins', () => {
    const result = classify('config change for the new service architecture module');
    assert.equal(result.adversarial, true);
    assert.ok(result.triggers.includes('architecture'));
  });

  it('migrate + lint → architectural wins', () => {
    const result = classify('lint and then migrate the database schema change');
    assert.equal(result.adversarial, true);
    assert.ok(result.triggers.includes('refactor'));
  });

  it('adr-reference + push → architectural wins', () => {
    const result = classify('push the changes from ADR-0086 implementation');
    assert.equal(result.adversarial, true);
    assert.ok(result.triggers.includes('adr-reference'));
  });
});

// ============================================================================
// T1.5 classify — new verbs: replace, split, move, introduce, deprecate
// ============================================================================

describe('ADR-0087 classify — expanded verb coverage', () => {
  it('replace triggers refactor', () => {
    const result = classify('replace Express with Fastify across the app');
    assert.equal(result.adversarial, true);
    assert.ok(result.triggers.includes('refactor'));
  });

  it('split triggers refactor', () => {
    const result = classify('split this monolith into three packages');
    assert.equal(result.adversarial, true);
    assert.ok(result.triggers.includes('refactor'));
  });

  it('move triggers refactor', () => {
    const result = classify('move all the business logic into a domain layer');
    assert.equal(result.adversarial, true);
    assert.ok(result.triggers.includes('refactor'));
  });

  it('introduce triggers new-feature', () => {
    const result = classify('introduce a new service for dependency injection');
    assert.equal(result.adversarial, true);
    assert.ok(result.triggers.includes('new-feature'));
  });

  it('deprecate triggers refactor', () => {
    const result = classify('deprecate the v1 API and plan the migration path');
    assert.equal(result.adversarial, true);
    assert.ok(result.triggers.includes('refactor'));
  });
});

// ============================================================================
// T1.6 classify — isolated pattern hits
// ============================================================================

describe('ADR-0087 classify — isolated pattern hits', () => {
  it('data-model alone (no refactor overlap)', () => {
    const result = classify('the schema change for user table needs review');
    assert.equal(result.adversarial, true);
    assert.ok(result.triggers.includes('data-model'));
    assert.ok(!result.triggers.includes('refactor'));
  });

  it('api-change alone (no refactor overlap)', () => {
    const result = classify('the api breaking change affects all consumers');
    assert.equal(result.adversarial, true);
    assert.ok(result.triggers.includes('api-change'));
    assert.ok(!result.triggers.includes('refactor'));
  });

  it('phased-work alone (no adr overlap)', () => {
    const result = classify('phase 2 rollout plan needs work and thought');
    assert.equal(result.adversarial, true);
    assert.ok(result.triggers.includes('phased-work'));
    assert.ok(!result.triggers.includes('adr-reference'));
  });
});

// ============================================================================
// T1.7 classify — case insensitive matching
// ============================================================================

describe('ADR-0087 classify — case insensitive', () => {
  it('REFACTOR in caps', () => {
    assert.equal(classify('REFACTOR the entire auth system now').adversarial, true);
  });

  it('Mixed case Implement A New Feature', () => {
    assert.equal(classify('Implement A New Feature For Notifications').adversarial, true);
  });

  it('ADR uppercase', () => {
    assert.equal(classify('implement ADR-0055 recommendations soon').adversarial, true);
  });
});

// ============================================================================
// T1.8 classify — 10-char boundary
// ============================================================================

describe('ADR-0087 classify — length boundary', () => {
  it('9 chars → too-short', () => {
    const result = classify('refactor!');  // exactly 9
    assert.equal(result.adversarial, false);
    assert.equal(result.reason, 'too-short');
  });

  it('10 chars → proceeds to pattern matching', () => {
    const result = classify('refactor!!');  // exactly 10
    assert.equal(result.adversarial, true);
    assert.ok(result.triggers.includes('refactor'));
  });
});

// ============================================================================
// T1.9 classify — collects all triggers, not just first
// ============================================================================

describe('ADR-0087 classify — trigger collection', () => {
  it('prompt hitting 3+ patterns returns all labels', () => {
    const result = classify('refactor the multi-file architecture of the cross-module system');
    assert.equal(result.adversarial, true);
    assert.ok(result.triggers.includes('architecture'));
    assert.ok(result.triggers.includes('refactor'));
    assert.ok(result.triggers.includes('multi-scope'));
    assert.ok(result.triggers.includes('cross-cutting'));
    assert.ok(result.triggers.length >= 4, `expected >=4 triggers, got ${result.triggers.length}`);
  });

  it('adr + phased-work collected together', () => {
    const result = classify('implement phase 1 of adr 87');
    assert.ok(result.triggers.includes('adr-reference'));
    assert.ok(result.triggers.includes('phased-work'));
    assert.equal(result.triggers.length, 2);
  });
});

// ============================================================================
// T1.10 advisory — single-line format with triggers
// ============================================================================

describe('ADR-0087 advisory — format', () => {
  it('returns single-line advisory with triggers', () => {
    const result = advisory({ adversarial: true, triggers: ['architecture', 'new-feature'] });
    assert.ok(result.includes('[ADR-0087]'));
    assert.ok(result.includes('architecture, new-feature'));
    assert.ok(result.includes('3 flaws'));
    assert.ok(result.includes('hindsight'));
  });

  it('contains the core instruction keywords', () => {
    const result = advisory({ adversarial: true, triggers: ['refactor'] });
    assert.ok(result.includes('describe approach'));
    assert.ok(result.includes('implement'));
  });
});

// ============================================================================
// T1.11 advisory — null when not adversarial
// ============================================================================

describe('ADR-0087 advisory — null cases', () => {
  it('returns null for non-adversarial result', () => {
    assert.equal(advisory({ adversarial: false }), null);
  });

  it('returns null for null input', () => {
    assert.equal(advisory(null), null);
  });

  it('returns null for undefined input', () => {
    assert.equal(advisory(undefined), null);
  });
});

// ============================================================================
// T1.12 advisory — defensive: missing triggers array
// ============================================================================

describe('ADR-0087 advisory — defensive', () => {
  it('handles adversarial:true with no triggers array', () => {
    const result = advisory({ adversarial: true });
    assert.ok(result !== null);
    assert.ok(result.includes('[ADR-0087]'));
    assert.ok(result.includes('unknown'));
  });

  it('handles adversarial:true with empty triggers', () => {
    const result = advisory({ adversarial: true, triggers: [] });
    assert.ok(result !== null);
    assert.ok(result.includes('unknown'));
  });
});

// ============================================================================
// T1.13 integration — hook-handler route emits advisory
// ============================================================================

describe('ADR-0087 integration — hook-handler route', () => {
  const hookHandler = resolve(import.meta.dirname, '../../.claude/helpers/hook-handler.cjs');

  it('emits [ADR-0087] advisory for architectural prompt', () => {
    const output = execFileSync('node', [hookHandler, 'route'], {
      env: { ...process.env, PROMPT: 'implement phase 1 of adr 87' },
      encoding: 'utf8',
      timeout: 5000,
    });
    assert.ok(
      output.includes('[ADR-0087]'),
      `expected [ADR-0087] in output, got:\n${output}`,
    );
    assert.ok(output.includes('Adversarial review recommended'));
  });

  it('does NOT emit [ADR-0087] for trivial prompt', () => {
    const output = execFileSync('node', [hookHandler, 'route'], {
      env: { ...process.env, PROMPT: 'fix typo in the readme' },
      encoding: 'utf8',
      timeout: 5000,
    });
    assert.ok(
      !output.includes('[ADR-0087]'),
      `expected no [ADR-0087] in output, got:\n${output}`,
    );
  });

  it('does NOT emit [ADR-0087] for generic prompt', () => {
    const output = execFileSync('node', [hookHandler, 'route'], {
      env: { ...process.env, PROMPT: 'what files are in the src directory' },
      encoding: 'utf8',
      timeout: 5000,
    });
    assert.ok(
      !output.includes('[ADR-0087]'),
      `expected no [ADR-0087] in output, got:\n${output}`,
    );
  });

  it('architectural wins over trivial in hook output', () => {
    const output = execFileSync('node', [hookHandler, 'route'], {
      env: { ...process.env, PROMPT: 'commit the refactored auth module to the repo' },
      encoding: 'utf8',
      timeout: 5000,
    });
    assert.ok(
      output.includes('[ADR-0087]'),
      `expected [ADR-0087] for mixed prompt, got:\n${output}`,
    );
  });
});

// ============================================================================
// T1.14 integration — hook-handler route still works without adversarial
// ============================================================================

describe('ADR-0087 integration — graceful degradation', () => {
  const hookHandler = resolve(import.meta.dirname, '../../.claude/helpers/hook-handler.cjs');

  it('route handler does not crash on empty prompt', () => {
    const output = execFileSync('node', [hookHandler, 'route'], {
      env: { ...process.env, PROMPT: '' },
      encoding: 'utf8',
      timeout: 5000,
    });
    // Should still produce router output, no crash
    assert.ok(!output.includes('[ADR-0087]'));
  });
});

// ============================================================================
// Phase 2: Parallel Thinking Sessions
// ============================================================================

// ============================================================================
// T2.1 THINKING_SESSIONS — canonical list
// ============================================================================

describe('ADR-0087 Phase 2 — THINKING_SESSIONS constant', () => {
  it('exports exactly 5 session types in canonical order', () => {
    assert.deepStrictEqual(THINKING_SESSIONS, [
      'implementation',
      'adversarial-review',
      'test-generation',
      'documentation',
      'simplification',
    ]);
  });

  it('is frozen (immutable)', () => {
    assert.ok(Object.isFrozen(THINKING_SESSIONS));
  });
});

// ============================================================================
// T2.2 SESSION_MAP — all triggers mapped
// ============================================================================

describe('ADR-0087 Phase 2 — SESSION_MAP coverage', () => {
  it('every architectural trigger has a SESSION_MAP entry', () => {
    for (const [, label] of ARCHITECTURAL_PATTERNS) {
      assert.ok(
        SESSION_MAP[label],
        `SESSION_MAP missing entry for trigger "${label}"`,
      );
    }
  });

  it('all triggers get all 5 sessions', () => {
    for (const [, label] of ARCHITECTURAL_PATTERNS) {
      const sessions = SESSION_MAP[label];
      assert.equal(sessions.length, 5, `expected 5 sessions for "${label}"`);
      for (const s of THINKING_SESSIONS) {
        assert.ok(sessions.includes(s), `"${label}" missing session "${s}"`);
      }
    }
  });

  it('SESSION_MAP entries are independent arrays (no shared references)', () => {
    const entries = Object.values(SESSION_MAP);
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        assert.notStrictEqual(entries[i], entries[j],
          'SESSION_MAP entries must not share array references');
      }
      // Also verify no entry IS the THINKING_SESSIONS constant
      assert.notStrictEqual(entries[i], THINKING_SESSIONS,
        'SESSION_MAP entry must not be the THINKING_SESSIONS constant');
    }
  });

  it('SESSION_MAP and all entries are frozen (immutable)', () => {
    assert.ok(Object.isFrozen(SESSION_MAP), 'SESSION_MAP itself must be frozen');
    for (const [key, arr] of Object.entries(SESSION_MAP)) {
      assert.ok(Object.isFrozen(arr), `SESSION_MAP["${key}"] must be frozen`);
    }
  });
});

// ============================================================================
// T2.3 recommendSessions — maps triggers to sessions
// ============================================================================

describe('ADR-0087 Phase 2 — recommendSessions', () => {
  it('architecture trigger → all 5 sessions', () => {
    const result = recommendSessions({ adversarial: true, triggers: ['architecture'] });
    assert.deepStrictEqual(result, THINKING_SESSIONS);
  });

  it('refactor trigger → all 5 sessions', () => {
    const result = recommendSessions({ adversarial: true, triggers: ['refactor'] });
    assert.deepStrictEqual(result, THINKING_SESSIONS);
  });

  it('phased-work trigger → all 5 sessions', () => {
    const result = recommendSessions({ adversarial: true, triggers: ['phased-work'] });
    assert.deepStrictEqual(result, THINKING_SESSIONS);
  });

  it('multiple triggers de-duplicate and return canonical order', () => {
    // adr-reference (3) + architecture (5) → union = all 5
    const result = recommendSessions({
      adversarial: true,
      triggers: ['adr-reference', 'architecture'],
    });
    assert.deepStrictEqual(result, THINKING_SESSIONS);
  });

  it('refactor + phased-work → still all 5 (union of identical sets)', () => {
    const result = recommendSessions({
      adversarial: true,
      triggers: ['phased-work', 'refactor'],
    });
    assert.deepStrictEqual(result, THINKING_SESSIONS);
  });
});

// ============================================================================
// T2.4 recommendSessions — edge cases
// ============================================================================

describe('ADR-0087 Phase 2 — recommendSessions edge cases', () => {
  it('returns [] for non-adversarial result', () => {
    assert.deepStrictEqual(recommendSessions({ adversarial: false }), []);
  });

  it('returns [] for null input', () => {
    assert.deepStrictEqual(recommendSessions(null), []);
  });

  it('returns [] for undefined input', () => {
    assert.deepStrictEqual(recommendSessions(undefined), []);
  });

  it('returns [] for adversarial:true with empty triggers', () => {
    assert.deepStrictEqual(
      recommendSessions({ adversarial: true, triggers: [] }),
      [],
    );
  });

  it('returns [] for adversarial:true with no triggers array', () => {
    assert.deepStrictEqual(
      recommendSessions({ adversarial: true }),
      [],
    );
  });

  it('skips unknown triggers gracefully', () => {
    const result = recommendSessions({
      adversarial: true,
      triggers: ['unknown-trigger', 'refactor'],
    });
    // Should still return refactor's sessions, ignoring unknown
    assert.deepStrictEqual(result, [...THINKING_SESSIONS]);
  });

  it('returns [] for adversarial:true with only unknown triggers', () => {
    assert.deepStrictEqual(
      recommendSessions({ adversarial: true, triggers: ['totally-unknown', 'also-unknown'] }),
      [],
    );
  });
});

// ============================================================================
// T2.5 sessionAdvisory — format
// ============================================================================

describe('ADR-0087 Phase 2 — sessionAdvisory format', () => {
  it('returns single-line advisory with session list', () => {
    const result = sessionAdvisory(['implementation', 'adversarial-review', 'test-generation']);
    assert.equal(result, '[ADR-0087] Parallel sessions: implementation, adversarial-review, test-generation');
  });

  it('includes all 5 sessions when given full list', () => {
    const result = sessionAdvisory([...THINKING_SESSIONS]);
    assert.equal(
      result,
      '[ADR-0087] Parallel sessions: implementation, adversarial-review, test-generation, documentation, simplification',
    );
  });

  it('returns single-session advisory with no trailing comma', () => {
    assert.equal(
      sessionAdvisory(['implementation']),
      '[ADR-0087] Parallel sessions: implementation',
    );
  });

  it('returns null for empty array', () => {
    assert.equal(sessionAdvisory([]), null);
  });

  it('returns null for null', () => {
    assert.equal(sessionAdvisory(null), null);
  });

  it('returns null for undefined', () => {
    assert.equal(sessionAdvisory(undefined), null);
  });

  it('returns null for string input (not an array)', () => {
    assert.equal(sessionAdvisory('implementation'), null);
  });
});

// ============================================================================
// T2.6 composition — classify → recommendSessions → sessionAdvisory
// ============================================================================

describe('ADR-0087 Phase 2 — composition pipeline', () => {
  const expectedFullAdvisory =
    '[ADR-0087] Parallel sessions: implementation, adversarial-review, test-generation, documentation, simplification';

  it('architectural prompt → all 5 sessions → full advisory', () => {
    const cls = classify('architect the new event sourcing system');
    const sessions = recommendSessions(cls);
    assert.deepStrictEqual(sessions, [...THINKING_SESSIONS]);
    assert.equal(sessionAdvisory(sessions), expectedFullAdvisory);
  });

  it('refactor prompt → all 5 sessions → full advisory', () => {
    const cls = classify('refactor the storage layer completely');
    const sessions = recommendSessions(cls);
    assert.deepStrictEqual(sessions, [...THINKING_SESSIONS]);
    assert.equal(sessionAdvisory(sessions), expectedFullAdvisory);
  });

  it('trivial prompt → no sessions → null advisory', () => {
    const cls = classify('fix typo in the readme');
    const sessions = recommendSessions(cls);
    assert.deepStrictEqual(sessions, []);
    assert.equal(sessionAdvisory(sessions), null);
  });

  it('adr + phased-work prompt → all 5 sessions', () => {
    const cls = classify('implement phase 2 of adr 87');
    const sessions = recommendSessions(cls);
    assert.deepStrictEqual(sessions, [...THINKING_SESSIONS]);
    assert.equal(sessionAdvisory(sessions), expectedFullAdvisory);
  });
});

// ============================================================================
// T2.7 integration — hook-handler route emits session advisory
// ============================================================================

describe('ADR-0087 Phase 2 integration — hook-handler session advisory', () => {
  const hookHandler = resolve(import.meta.dirname, '../../.claude/helpers/hook-handler.cjs');

  it('emits parallel sessions advisory for architectural prompt', () => {
    const output = execFileSync('node', [hookHandler, 'route'], {
      env: { ...process.env, PROMPT: 'architect the new event sourcing system' },
      encoding: 'utf8',
      timeout: 5000,
    });
    assert.ok(
      output.includes('[ADR-0087] Parallel sessions:'),
      `expected session advisory in output, got:\n${output}`,
    );
    assert.ok(output.includes('implementation'));
  });

  it('emits BOTH adversarial advisory AND session advisory', () => {
    const output = execFileSync('node', [hookHandler, 'route'], {
      env: { ...process.env, PROMPT: 'refactor the entire storage layer now' },
      encoding: 'utf8',
      timeout: 5000,
    });
    assert.ok(output.includes('Adversarial review recommended'));
    assert.ok(output.includes('Parallel sessions:'));
  });

  it('does NOT emit session advisory for trivial prompt', () => {
    const output = execFileSync('node', [hookHandler, 'route'], {
      env: { ...process.env, PROMPT: 'fix typo in the readme' },
      encoding: 'utf8',
      timeout: 5000,
    });
    assert.ok(!output.includes('Parallel sessions:'));
  });

  it('does NOT emit session advisory for generic prompt', () => {
    const output = execFileSync('node', [hookHandler, 'route'], {
      env: { ...process.env, PROMPT: 'what files are in the src directory' },
      encoding: 'utf8',
      timeout: 5000,
    });
    assert.ok(!output.includes('Parallel sessions:'));
  });
});

// ============================================================================
// T2.8 integration — adversarial advisory precedes session advisory
// ============================================================================

describe('ADR-0087 Phase 2 integration — advisory ordering', () => {
  const hookHandler = resolve(import.meta.dirname, '../../.claude/helpers/hook-handler.cjs');

  it('adversarial advisory appears before session advisory', () => {
    const output = execFileSync('node', [hookHandler, 'route'], {
      env: { ...process.env, PROMPT: 'architect the new event sourcing system' },
      encoding: 'utf8',
      timeout: 5000,
    });
    const adversarialIdx = output.indexOf('Adversarial review recommended');
    const sessionIdx = output.indexOf('Parallel sessions:');
    assert.ok(adversarialIdx >= 0, 'adversarial advisory must be present');
    assert.ok(sessionIdx >= 0, 'session advisory must be present');
    assert.ok(
      adversarialIdx < sessionIdx,
      `adversarial advisory (pos ${adversarialIdx}) must precede session advisory (pos ${sessionIdx})`,
    );
  });
});

// ============================================================================
// Phase 3: AI-First Review
// ============================================================================

// ============================================================================
// T3.1 REVIEW_CATEGORIES — canonical list
// ============================================================================

describe('ADR-0087 Phase 3 — REVIEW_CATEGORIES constant', () => {
  it('exports exactly 6 review categories in canonical order', () => {
    assert.deepStrictEqual(REVIEW_CATEGORIES, [
      'conventions',
      'edge-cases',
      'architecture',
      'security',
      'test-coverage',
      'compatibility',
    ]);
  });

  it('is frozen (immutable)', () => {
    assert.ok(Object.isFrozen(REVIEW_CATEGORIES));
  });
});

// ============================================================================
// T3.2 TRIGGER_REVIEWS — all triggers mapped, valid categories, frozen
// ============================================================================

describe('ADR-0087 Phase 3 — TRIGGER_REVIEWS coverage', () => {
  it('every architectural trigger has a TRIGGER_REVIEWS entry', () => {
    for (const [, label] of ARCHITECTURAL_PATTERNS) {
      assert.ok(
        TRIGGER_REVIEWS[label],
        `TRIGGER_REVIEWS missing entry for trigger "${label}"`,
      );
    }
  });

  it('all entries contain only valid REVIEW_CATEGORIES ids', () => {
    for (const [label, cats] of Object.entries(TRIGGER_REVIEWS)) {
      for (const c of cats) {
        assert.ok(
          REVIEW_CATEGORIES.includes(c),
          `TRIGGER_REVIEWS["${label}"] contains unknown category "${c}"`,
        );
      }
    }
  });

  it('no entry has duplicate categories', () => {
    for (const [label, cats] of Object.entries(TRIGGER_REVIEWS)) {
      const unique = new Set(cats);
      assert.equal(unique.size, cats.length,
        `TRIGGER_REVIEWS["${label}"] has duplicate categories`);
    }
  });

  it('TRIGGER_REVIEWS and all entries are frozen (immutable)', () => {
    assert.ok(Object.isFrozen(TRIGGER_REVIEWS), 'TRIGGER_REVIEWS itself must be frozen');
    for (const [key, arr] of Object.entries(TRIGGER_REVIEWS)) {
      assert.ok(Object.isFrozen(arr), `TRIGGER_REVIEWS["${key}"] must be frozen`);
    }
  });
});

// ============================================================================
// T3.3 reviewChecklist — maps triggers to review categories
// ============================================================================

describe('ADR-0087 Phase 3 — reviewChecklist', () => {
  it('architecture trigger → conventions, architecture, security, test-coverage', () => {
    const result = reviewChecklist({ adversarial: true, triggers: ['architecture'] });
    assert.deepStrictEqual(result, ['conventions', 'architecture', 'security', 'test-coverage']);
  });

  it('new-feature trigger → conventions, edge-cases, security, test-coverage', () => {
    const result = reviewChecklist({ adversarial: true, triggers: ['new-feature'] });
    assert.deepStrictEqual(result, ['conventions', 'edge-cases', 'security', 'test-coverage']);
  });

  it('refactor trigger → conventions, architecture, test-coverage, compatibility', () => {
    const result = reviewChecklist({ adversarial: true, triggers: ['refactor'] });
    assert.deepStrictEqual(result, ['conventions', 'architecture', 'test-coverage', 'compatibility']);
  });

  it('removal trigger → test-coverage, compatibility', () => {
    const result = reviewChecklist({ adversarial: true, triggers: ['removal'] });
    assert.deepStrictEqual(result, ['test-coverage', 'compatibility']);
  });

  it('data-model trigger → edge-cases, security, test-coverage, compatibility', () => {
    const result = reviewChecklist({ adversarial: true, triggers: ['data-model'] });
    assert.deepStrictEqual(result, ['edge-cases', 'security', 'test-coverage', 'compatibility']);
  });

  it('api-change trigger → edge-cases, security, test-coverage, compatibility', () => {
    const result = reviewChecklist({ adversarial: true, triggers: ['api-change'] });
    assert.deepStrictEqual(result, ['edge-cases', 'security', 'test-coverage', 'compatibility']);
  });

  it('multi-scope trigger → conventions, architecture, test-coverage', () => {
    const result = reviewChecklist({ adversarial: true, triggers: ['multi-scope'] });
    assert.deepStrictEqual(result, ['conventions', 'architecture', 'test-coverage']);
  });

  it('cross-cutting trigger → conventions, architecture, test-coverage', () => {
    const result = reviewChecklist({ adversarial: true, triggers: ['cross-cutting'] });
    assert.deepStrictEqual(result, ['conventions', 'architecture', 'test-coverage']);
  });

  it('adr-reference trigger → conventions, architecture, test-coverage', () => {
    const result = reviewChecklist({ adversarial: true, triggers: ['adr-reference'] });
    assert.deepStrictEqual(result, ['conventions', 'architecture', 'test-coverage']);
  });

  it('phased-work trigger → conventions, test-coverage, compatibility', () => {
    const result = reviewChecklist({ adversarial: true, triggers: ['phased-work'] });
    assert.deepStrictEqual(result, ['conventions', 'test-coverage', 'compatibility']);
  });

  it('multiple triggers de-duplicate and return canonical order', () => {
    // architecture (conventions, architecture, security, test-coverage)
    // + new-feature (conventions, edge-cases, security, test-coverage)
    // = conventions, edge-cases, architecture, security, test-coverage
    const result = reviewChecklist({
      adversarial: true,
      triggers: ['architecture', 'new-feature'],
    });
    assert.deepStrictEqual(result, [
      'conventions', 'edge-cases', 'architecture', 'security', 'test-coverage',
    ]);
  });

  it('data-model + api-change → union with compatibility', () => {
    const result = reviewChecklist({
      adversarial: true,
      triggers: ['data-model', 'api-change'],
    });
    assert.deepStrictEqual(result, ['edge-cases', 'security', 'test-coverage', 'compatibility']);
  });
});

// ============================================================================
// T3.4 reviewChecklist — edge cases
// ============================================================================

describe('ADR-0087 Phase 3 — reviewChecklist edge cases', () => {
  it('returns [] for non-adversarial result', () => {
    assert.deepStrictEqual(reviewChecklist({ adversarial: false }), []);
  });

  it('returns [] for null input', () => {
    assert.deepStrictEqual(reviewChecklist(null), []);
  });

  it('returns [] for undefined input', () => {
    assert.deepStrictEqual(reviewChecklist(undefined), []);
  });

  it('returns [] for adversarial:true with empty triggers', () => {
    assert.deepStrictEqual(
      reviewChecklist({ adversarial: true, triggers: [] }),
      [],
    );
  });

  it('returns [] for adversarial:true with no triggers array', () => {
    assert.deepStrictEqual(
      reviewChecklist({ adversarial: true }),
      [],
    );
  });

  it('skips unknown triggers gracefully', () => {
    const result = reviewChecklist({
      adversarial: true,
      triggers: ['unknown-trigger', 'removal'],
    });
    assert.deepStrictEqual(result, ['test-coverage', 'compatibility']);
  });

  it('returns [] for adversarial:true with only unknown triggers', () => {
    assert.deepStrictEqual(
      reviewChecklist({ adversarial: true, triggers: ['totally-unknown'] }),
      [],
    );
  });
});

// ============================================================================
// T3.5 reviewAdvisory — format
// ============================================================================

describe('ADR-0087 Phase 3 — reviewAdvisory format', () => {
  it('returns single-line advisory with category list', () => {
    const result = reviewAdvisory(['conventions', 'architecture', 'test-coverage']);
    assert.equal(result, '[ADR-0087] AI-first review: conventions, architecture, test-coverage');
  });

  it('includes all 6 categories when given full list', () => {
    const result = reviewAdvisory([...REVIEW_CATEGORIES]);
    assert.equal(
      result,
      '[ADR-0087] AI-first review: conventions, edge-cases, architecture, security, test-coverage, compatibility',
    );
  });

  it('returns single-category advisory with no trailing comma', () => {
    assert.equal(
      reviewAdvisory(['test-coverage']),
      '[ADR-0087] AI-first review: test-coverage',
    );
  });

  it('returns null for empty array', () => {
    assert.equal(reviewAdvisory([]), null);
  });

  it('returns null for null', () => {
    assert.equal(reviewAdvisory(null), null);
  });

  it('returns null for undefined', () => {
    assert.equal(reviewAdvisory(undefined), null);
  });

  it('returns null for string input (not an array)', () => {
    assert.equal(reviewAdvisory('conventions'), null);
  });
});

// ============================================================================
// T3.6 composition — classify → reviewChecklist → reviewAdvisory
// ============================================================================

describe('ADR-0087 Phase 3 — composition pipeline', () => {
  it('architectural prompt → review checklist → advisory', () => {
    const cls = classify('architect the new event sourcing system');
    const checklist = reviewChecklist(cls);
    assert.deepStrictEqual(checklist, ['conventions', 'architecture', 'security', 'test-coverage']);
    assert.equal(
      reviewAdvisory(checklist),
      '[ADR-0087] AI-first review: conventions, architecture, security, test-coverage',
    );
  });

  it('new-feature prompt → review with edge-cases and security', () => {
    const cls = classify('build a new feature for authentication');
    const checklist = reviewChecklist(cls);
    assert.ok(checklist.includes('edge-cases'));
    assert.ok(checklist.includes('security'));
    assert.ok(reviewAdvisory(checklist).includes('[ADR-0087] AI-first review:'));
  });

  it('refactor prompt → review with compatibility', () => {
    const cls = classify('refactor the storage layer completely');
    const checklist = reviewChecklist(cls);
    assert.ok(checklist.includes('compatibility'));
    assert.ok(checklist.includes('architecture'));
  });

  it('trivial prompt → no checklist → null advisory', () => {
    const cls = classify('fix typo in the readme');
    const checklist = reviewChecklist(cls);
    assert.deepStrictEqual(checklist, []);
    assert.equal(reviewAdvisory(checklist), null);
  });

  it('multi-trigger prompt → union of review categories', () => {
    const cls = classify('implement phase 2 of adr 87');
    const checklist = reviewChecklist(cls);
    // adr-reference → conventions, architecture, test-coverage
    // phased-work → conventions, compatibility, test-coverage
    // union → conventions, architecture, test-coverage, compatibility
    assert.ok(checklist.includes('conventions'));
    assert.ok(checklist.includes('architecture'));
    assert.ok(checklist.includes('test-coverage'));
    assert.ok(checklist.includes('compatibility'));
  });
});

// ============================================================================
// T3.7 integration — hook-handler emits review advisory
// ============================================================================

describe('ADR-0087 Phase 3 integration — hook-handler review advisory', () => {
  const hookHandler = resolve(import.meta.dirname, '../../.claude/helpers/hook-handler.cjs');

  it('emits review advisory for architectural prompt', () => {
    const output = execFileSync('node', [hookHandler, 'route'], {
      env: { ...process.env, PROMPT: 'architect the new event sourcing system' },
      encoding: 'utf8',
      timeout: 5000,
    });
    assert.ok(
      output.includes('[ADR-0087] AI-first review:'),
      `expected review advisory in output, got:\n${output}`,
    );
    assert.ok(output.includes('conventions'));
    assert.ok(output.includes('test-coverage'));
  });

  it('emits ALL three advisories for architectural prompt', () => {
    const output = execFileSync('node', [hookHandler, 'route'], {
      env: { ...process.env, PROMPT: 'refactor the entire storage layer now' },
      encoding: 'utf8',
      timeout: 5000,
    });
    assert.ok(output.includes('Adversarial review recommended'));
    assert.ok(output.includes('Parallel sessions:'));
    assert.ok(output.includes('AI-first review:'));
  });

  it('does NOT emit review advisory for trivial prompt', () => {
    const output = execFileSync('node', [hookHandler, 'route'], {
      env: { ...process.env, PROMPT: 'fix typo in the readme' },
      encoding: 'utf8',
      timeout: 5000,
    });
    assert.ok(!output.includes('AI-first review:'));
  });

  it('does NOT emit review advisory for generic prompt', () => {
    const output = execFileSync('node', [hookHandler, 'route'], {
      env: { ...process.env, PROMPT: 'what files are in the src directory' },
      encoding: 'utf8',
      timeout: 5000,
    });
    assert.ok(!output.includes('AI-first review:'));
  });
});

// ============================================================================
// T3.8 integration — advisory ordering (adversarial < session < review)
// ============================================================================

describe('ADR-0087 Phase 3 integration — advisory ordering', () => {
  const hookHandler = resolve(import.meta.dirname, '../../.claude/helpers/hook-handler.cjs');

  it('adversarial < session < review in output', () => {
    const output = execFileSync('node', [hookHandler, 'route'], {
      env: { ...process.env, PROMPT: 'architect the new event sourcing system' },
      encoding: 'utf8',
      timeout: 5000,
    });
    const adversarialIdx = output.indexOf('Adversarial review recommended');
    const sessionIdx = output.indexOf('Parallel sessions:');
    const reviewIdx = output.indexOf('AI-first review:');
    assert.ok(adversarialIdx >= 0, 'adversarial advisory must be present');
    assert.ok(sessionIdx >= 0, 'session advisory must be present');
    assert.ok(reviewIdx >= 0, 'review advisory must be present');
    assert.ok(
      adversarialIdx < sessionIdx,
      `adversarial (pos ${adversarialIdx}) must precede session (pos ${sessionIdx})`,
    );
    assert.ok(
      sessionIdx < reviewIdx,
      `session (pos ${sessionIdx}) must precede review (pos ${reviewIdx})`,
    );
  });
});
