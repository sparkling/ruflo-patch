// @tier unit
// ADR-0180 §Mutation invariants — source-level invariant authoring contract.
//
// The authoritative behavioural test for each invariant lives in the agentdb
// fork's vitest suite (src/archivist/invariants/* are pure functions; vitest
// can import them directly). This .mjs test is a belt-and-suspenders pipeline
// gate: it loads the FORK SOURCE files for each handler in the wired set
// (memory_store, agentdb_pattern_store, agentdb_feedback,
// agentdb_experience_record, agentdb_route, task_create) and asserts that:
//
//   1. The handler imports its invariants array from `../../invariants/<surface>/<handler>.js`.
//   2. The handler passes that array (NOT `[]`) to `registerMutationHandler`'s
//      `invariants:` opt — catches a future refactor that drops the wiring.
//   3. The invariant file exports the array under the expected name, and
//      contains the per-brief predicates (range checks, equality checks,
//      slug regex, length bounds).
//
// The test does not execute the invariants. Behavioural correctness is the
// agentdb fork's own vitest responsibility — this gate ensures the wiring
// survives a tsc refactor or a hand-edit that strips the import.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FORK_ROOT = '/Users/henrik/source/forks/agentdb';
const HANDLERS = join(FORK_ROOT, 'src/archivist/handlers');
const INVARIANTS = join(FORK_ROOT, 'src/archivist/invariants');

function read(p) {
  return readFileSync(p, 'utf8');
}

describe('ADR-0181 invariants — handlers wire their per-tool invariant arrays', () => {
  const wiring = [
    {
      tool: 'memory_store',
      handler: join(HANDLERS, 'memory/store.ts'),
      invariantsFile: join(INVARIANTS, 'memory/store.ts'),
      arrayExport: 'storeInvariants',
    },
    {
      tool: 'agentdb_pattern_store',
      handler: join(HANDLERS, 'agentdb/pattern-store.ts'),
      invariantsFile: join(INVARIANTS, 'agentdb/pattern-store.ts'),
      arrayExport: 'patternStoreInvariants',
    },
    {
      tool: 'agentdb_feedback',
      handler: join(HANDLERS, 'agentdb/feedback.ts'),
      invariantsFile: join(INVARIANTS, 'agentdb/feedback.ts'),
      arrayExport: 'feedbackInvariants',
    },
    {
      tool: 'agentdb_experience_record',
      handler: join(HANDLERS, 'agentdb/experience-record.ts'),
      invariantsFile: join(INVARIANTS, 'agentdb/experience-record.ts'),
      arrayExport: 'experienceRecordInvariants',
    },
    {
      tool: 'agentdb_route',
      handler: join(HANDLERS, 'agentdb/route.ts'),
      invariantsFile: join(INVARIANTS, 'agentdb/route.ts'),
      arrayExport: 'routeInvariants',
    },
    {
      tool: 'task_create',
      handler: join(HANDLERS, 'tasks/create.ts'),
      invariantsFile: join(INVARIANTS, 'tasks/create.ts'),
      arrayExport: 'createInvariants',
    },
  ];

  for (const w of wiring) {
    describe(`${w.tool}`, () => {
      it('handler imports the invariants array from invariants/', () => {
        const src = read(w.handler);
        const importRe = new RegExp(
          `import\\s*\\{\\s*${w.arrayExport}\\s*\\}\\s*from\\s*['"][^'"]*invariants/[^'"]+\\.js['"]`,
        );
        assert.match(src, importRe, `handler must import { ${w.arrayExport} } from invariants module`);
      });

      it('handler passes invariants array (not []) to registerMutationHandler', () => {
        const src = read(w.handler);
        // Match the opts literal — `invariants: <array-name>,` not `invariants: [],`
        const passRe = new RegExp(`invariants:\\s*${w.arrayExport}\\b`);
        assert.match(src, passRe, `registerMutationHandler must receive ${w.arrayExport} as the invariants opt`);
        assert.doesNotMatch(
          src,
          /invariants:\s*\[\s*\][^,]*,\s*\/\/\s*wired by invariants-author/,
          'placeholder `invariants: []` comment must be removed',
        );
      });

      it('invariants file exports the named array', () => {
        const src = read(w.invariantsFile);
        const exportRe = new RegExp(
          `export\\s+const\\s+${w.arrayExport}\\s*:\\s*ReadonlyArray<Invariant<[^>]+>>\\s*=\\s*\\[`,
        );
        assert.match(src, exportRe, `invariants file must export ${w.arrayExport} as ReadonlyArray<Invariant<...>>`);
      });

      it('invariants file declares charter', () => {
        const src = read(w.invariantsFile);
        assert.match(src, /^\/\/ charter: mutation-invariants/, 'must declare charter on first line');
      });
    });
  }
});

describe('ADR-0181 invariants — per-brief predicates are present', () => {
  it('memory_store: namespace non-empty / equality, ttl>=0, key/content/upsert equality', () => {
    const src = read(join(INVARIANTS, 'memory/store.ts'));
    assert.match(src, /namespaceNonEmpty/, 'must define namespaceNonEmpty predicate');
    assert.match(src, /namespaceEquality/);
    assert.match(src, /keyEquality/);
    assert.match(src, /contentEquality/);
    assert.match(src, /ttlNonNegative/);
    assert.match(src, /upsertEquality/);
    // Range check: the predicate must reject negative ttl
    assert.match(src, /ttl\s*<\s*0/, 'ttlNonNegative must compare ttl < 0');
  });

  it('agentdb_pattern_store: pattern non-empty + equality, type slug regex, confidence ∈ [0,1]', () => {
    const src = read(join(INVARIANTS, 'agentdb/pattern-store.ts'));
    assert.match(src, /patternNonEmpty/);
    assert.match(src, /patternEquality/);
    assert.match(src, /typeIsSlug/);
    assert.match(src, /confidenceInRange/);
    // Slug regex per brief: /[a-z0-9_-]+/i
    assert.match(src, /\/\^?\[a-z0-9_-\]\+\$?\/i?/);
    // Confidence range
    assert.match(src, /c\s*<\s*0\s*\|\|\s*c\s*>\s*1/);
  });

  it('agentdb_feedback: taskId non-empty (≤500), quality ∈ [0,1], agent ≤200', () => {
    const src = read(join(INVARIANTS, 'agentdb/feedback.ts'));
    assert.match(src, /taskIdWellFormed/);
    assert.match(src, /taskIdEquality/);
    assert.match(src, /qualityInRange/);
    assert.match(src, /agentLengthBounded/);
    assert.match(src, /TASK_ID_MAX\s*=\s*500/);
    assert.match(src, /AGENT_MAX\s*=\s*200/);
    assert.match(src, /q\s*<\s*0\s*\|\|\s*q\s*>\s*1/);
  });

  it('agentdb_experience_record: task non-empty, reward ∈ [0,1], input/output bounded', () => {
    const src = read(join(INVARIANTS, 'agentdb/experience-record.ts'));
    assert.match(src, /taskWellFormed/);
    assert.match(src, /taskEquality/);
    assert.match(src, /rewardInRange/);
    assert.match(src, /inputOutputBounded/);
    assert.match(src, /TASK_MAX\s*=\s*10_000/);
    assert.match(src, /r\s*<\s*0\s*\|\|\s*r\s*>\s*1/);
  });

  it('agentdb_route: task non-empty + equality, namespace equality', () => {
    const src = read(join(INVARIANTS, 'agentdb/route.ts'));
    assert.match(src, /taskNonEmpty/);
    assert.match(src, /taskEquality/);
    assert.match(src, /namespaceEquality/);
  });

  it('task_create: type non-empty + equality, description ≤10000, priority enum, taskId well-formed', () => {
    const src = read(join(INVARIANTS, 'tasks/create.ts'));
    assert.match(src, /typeNonEmpty/);
    assert.match(src, /typeEquality/);
    assert.match(src, /descriptionBounded/);
    assert.match(src, /priorityInEnum/);
    assert.match(src, /taskIdWellFormedWhenPresent/);
    assert.match(src, /DESCRIPTION_MAX\s*=\s*10_000/);
    assert.match(src, /VALID_PRIORITIES\s*=\s*new Set\(\[['"]low['"],\s*['"]normal['"],\s*['"]high['"],\s*['"]critical['"]\]\)/);
  });
});

describe('ADR-0181 invariants — barrels re-export per-handler arrays', () => {
  it('agentdb barrel re-exports the four wired invariants', () => {
    const src = read(join(INVARIANTS, 'agentdb/index.ts'));
    for (const name of ['patternStoreInvariants', 'feedbackInvariants', 'experienceRecordInvariants', 'routeInvariants']) {
      const re = new RegExp(`export\\s*\\{\\s*${name}\\s*\\}`);
      assert.match(src, re, `agentdb barrel must re-export ${name}`);
    }
  });

  it('tasks barrel re-exports createInvariants', () => {
    const src = read(join(INVARIANTS, 'tasks/index.ts'));
    assert.match(src, /export\s*\{\s*createInvariants\s*\}/);
  });

  it('memory barrel re-exports storeInvariants (pre-existing)', () => {
    const src = read(join(INVARIANTS, 'memory/index.ts'));
    assert.match(src, /export\s*\{\s*storeInvariants\s*\}/);
  });
});

describe('ADR-0181 invariants — return shape conforms to Invariant<T>', () => {
  // Spot-check that each invariants file uses the canonical "pass" | { violated: true, detail }
  // return shape — diverging from this shape (e.g., returning `{ violated: false }`) would
  // make the dispatch's `find(v => v.verdict.violated === true)` lookup miss real violations.
  for (const file of [
    'memory/store.ts',
    'agentdb/pattern-store.ts',
    'agentdb/feedback.ts',
    'agentdb/experience-record.ts',
    'agentdb/route.ts',
    'tasks/create.ts',
  ]) {
    it(`${file}: returns 'pass' on success, { violated: true, detail } on failure`, () => {
      const src = read(join(INVARIANTS, file));
      assert.match(src, /return 'pass';/, 'must use literal "pass" success return');
      assert.match(src, /return\s*\{\s*violated:\s*true,\s*detail:/, 'must use { violated: true, detail } violation shape');
      assert.doesNotMatch(src, /violated:\s*false/, 'must NOT use { violated: false } shape (off-spec)');
    });
  }
});
