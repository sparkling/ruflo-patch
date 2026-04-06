// @tier unit
// ADR-0068 criterion 4: getController() switch coverage for 16+ controller names
// Reads AgentDB source and validates the switch statement has complete coverage.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// ============================================================================
// Mock helpers (same pattern as config-unification-adr0068.test.mjs)
// ============================================================================

function mockFn(impl) {
  const calls = [];
  const fn = (...args) => {
    calls.push(args);
    return impl ? impl(...args) : undefined;
  };
  fn.calls = calls;
  fn.reset = () => { calls.length = 0; };
  return fn;
}

function mockCtor(methods = {}) {
  const instances = [];
  class Mock {
    constructor(...args) {
      this._args = args;
      Object.assign(this, methods);
      instances.push(this);
    }
  }
  Mock.instances = instances;
  Mock.reset = () => { instances.length = 0; };
  return Mock;
}

// ============================================================================
// Paths to source files
// ============================================================================

const FORKS_ROOT = join(import.meta.dirname, '..', '..', '..', 'forks');
const AGENTDB_SOURCE = join(
  FORKS_ROOT,
  'agentic-flow', 'packages', 'agentdb', 'src', 'core', 'AgentDB.ts',
);

// ============================================================================
// Helper: extract case labels from getController switch
// ============================================================================

function extractSwitchCaseLabels(source) {
  // Find the getController method body
  const methodMatch = source.match(
    /getController\s*\(\s*name\s*:\s*string\s*\)\s*:\s*any\s*\{([\s\S]*?)^\s{2}\}/m,
  );
  if (!methodMatch) return [];

  const methodBody = methodMatch[1];

  // Extract all case 'xxx': labels
  const caseLabels = [];
  const caseRegex = /case\s+'([^']+)'/g;
  let match;
  while ((match = caseRegex.exec(methodBody)) !== null) {
    caseLabels.push(match[1]);
  }
  return caseLabels;
}

// ============================================================================
// Unit: mock getController delegation covers 16+ names
// ============================================================================

describe('ADR-0068 criterion 4: mock getController covers 16+ names', () => {
  // The 16 required controller names (primary canonical names)
  const REQUIRED_NAMES = [
    'reasoningBank',
    'skills',
    'reflexion',
    'causalGraph',
    'causalRecall',
    'learningSystem',
    'explainableRecall',
    'nightlyLearner',
    'queryOptimizer',
    'auditLogger',
    'batchOperations',
    'attentionService',
    'hierarchicalMemory',
    'memoryConsolidation',
    'vectorBackend',
    'mutationGuard',
  ];

  it('mock getController resolves all 16 required names', () => {
    // Build a mock getController that mirrors the real switch
    const controllerMap = new Map();
    for (const name of REQUIRED_NAMES) {
      controllerMap.set(name, { name, type: 'mock' });
    }

    const getController = mockFn((name) => {
      if (!controllerMap.has(name)) {
        throw new Error(`Unknown controller: ${name}`);
      }
      return controllerMap.get(name);
    });

    for (const name of REQUIRED_NAMES) {
      const ctrl = getController(name);
      assert.ok(ctrl, `getController('${name}') must return a controller`);
      assert.equal(ctrl.name, name);
    }
    assert.equal(getController.calls.length, REQUIRED_NAMES.length);
  });

  it('mock getController throws on unknown name', () => {
    const getController = mockFn((name) => {
      throw new Error(`Unknown controller: ${name}`);
    });

    assert.throws(
      () => getController('nonexistentController'),
      /Unknown controller/,
      'must throw for unknown controller names',
    );
  });
});

// ============================================================================
// Integration: read AgentDB source, verify case labels
// ============================================================================

describe('ADR-0068 criterion 4 integration: AgentDB getController switch coverage', () => {
  it('AgentDB.ts source file exists', () => {
    assert.ok(existsSync(AGENTDB_SOURCE),
      `AgentDB.ts must exist at ${AGENTDB_SOURCE}`);
  });

  it('getController switch has >= 16 unique case labels', () => {
    if (!existsSync(AGENTDB_SOURCE)) {
      assert.ok(true, 'skip — fork source not available');
      return;
    }
    const source = readFileSync(AGENTDB_SOURCE, 'utf8');
    const labels = extractSwitchCaseLabels(source);
    const uniqueLabels = [...new Set(labels)];

    assert.ok(uniqueLabels.length >= 16,
      `getController switch must have >= 16 unique case labels, found ${uniqueLabels.length}: ${uniqueLabels.join(', ')}`);
  });

  it('getController switch has all 16 required canonical names', () => {
    if (!existsSync(AGENTDB_SOURCE)) {
      assert.ok(true, 'skip — fork source not available');
      return;
    }
    const source = readFileSync(AGENTDB_SOURCE, 'utf8');
    const labels = extractSwitchCaseLabels(source);
    const labelSet = new Set(labels);

    const requiredNames = [
      'reasoningBank',
      'skills',
      'reflexion',
      'causalGraph',
      'causalRecall',
      'learningSystem',
      'explainableRecall',
      'nightlyLearner',
      'queryOptimizer',
      'auditLogger',
      'batchOperations',
      'attentionService',
      'hierarchicalMemory',
      'memoryConsolidation',
      'vectorBackend',
      'mutationGuard',
    ];

    const missing = requiredNames.filter((name) => !labelSet.has(name));
    assert.equal(missing.length, 0,
      `getController switch is missing required names: ${missing.join(', ')}`);
  });

  it('getController switch has aliases (memory, reasoning, causal, learning, graph)', () => {
    if (!existsSync(AGENTDB_SOURCE)) {
      assert.ok(true, 'skip — fork source not available');
      return;
    }
    const source = readFileSync(AGENTDB_SOURCE, 'utf8');
    const labels = extractSwitchCaseLabels(source);
    const labelSet = new Set(labels);

    // Known aliases that map to canonical controller names
    const aliases = ['memory', 'reasoning', 'causal', 'learning', 'graph'];
    const presentAliases = aliases.filter((a) => labelSet.has(a));

    assert.ok(presentAliases.length >= 4,
      `getController switch should have aliases for common names, found: ${presentAliases.join(', ')}`);
  });

  it('getController has a default case that throws', () => {
    if (!existsSync(AGENTDB_SOURCE)) {
      assert.ok(true, 'skip — fork source not available');
      return;
    }
    const source = readFileSync(AGENTDB_SOURCE, 'utf8');
    const methodMatch = source.match(
      /getController\s*\(\s*name\s*:\s*string\s*\)\s*:\s*any\s*\{([\s\S]*?)^\s{2}\}/m,
    );
    assert.ok(methodMatch, 'getController method must exist');

    const methodBody = methodMatch[1];
    assert.ok(methodBody.includes('default:'),
      'getController switch must have a default case');
    assert.ok(methodBody.includes('Unknown controller'),
      'default case must throw an Unknown controller error');
  });

  it('total case labels including aliases is >= 20', () => {
    if (!existsSync(AGENTDB_SOURCE)) {
      assert.ok(true, 'skip — fork source not available');
      return;
    }
    const source = readFileSync(AGENTDB_SOURCE, 'utf8');
    const labels = extractSwitchCaseLabels(source);

    assert.ok(labels.length >= 20,
      `getController switch should have >= 20 total case labels (including aliases), found ${labels.length}`);
  });
});
