// @tier unit
// ADR-0087 Phase 1: Adversarial Prompting Before Implementation
//
// London School TDD: tests classify() and advisory() in isolation.
//
// Coverage:
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

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

// Direct require of CJS module from ESM
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { classify, advisory } = require('../../.claude/helpers/adversarial.cjs');

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
