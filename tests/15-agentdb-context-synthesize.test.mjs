// @tier unit
// ADR-0033: agentdb_context-synthesize MCP tool -- activation contract tests
//
// London School TDD: bridge interactions are mocked with plain objects.

import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';

// ============================================================================
// Mock helpers
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

function asyncMock(value) {
  return mockFn(async () => value);
}

function rejectMock(err) {
  return mockFn(async () => { throw (typeof err === 'string' ? new Error(err) : err); });
}

function hangMock() {
  return mockFn(() => new Promise(() => {}));
}

// ============================================================================
// Simulated handler logic (mirrors agentdb-tools.ts wiring)
// ============================================================================

const TIMEOUT_MS = 2000;

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

function createContextSynthesizeHandler(bridge) {
  return async (params) => {
    if (!params.entries || !Array.isArray(params.entries) || params.entries.length === 0) {
      return { success: false, error: 'entries is required and must be a non-empty array' };
    }
    try {
      const controller = await bridge.getController('contextSynthesizer');
      if (!controller || typeof controller.synthesize !== 'function') {
        return { success: false, error: 'ContextSynthesizer not available' };
      }
      const result = await withTimeout(controller.synthesize(params.entries, params.options), TIMEOUT_MS);
      return { success: true, synthesis: result, entryCount: params.entries.length };
    } catch (e) {
      return { success: false, error: e.message };
    }
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('ADR-0033: agentdb_context-synthesize MCP tool', () => {
  let mockController;
  let bridge;

  beforeEach(() => {
    mockController = {
      synthesize: asyncMock({
        summary: 'Combined context from 3 entries',
        keyInsights: ['insight-1', 'insight-2'],
      }),
    };

    bridge = {
      getController: mockFn(async (name) => {
        if (name === 'contextSynthesizer') return mockController;
        return null;
      }),
    };
  });

  it('should synthesize context from provided entries', async () => {
    const handler = createContextSynthesizeHandler(bridge);
    const entries = [
      { key: 'e1', content: 'first' },
      { key: 'e2', content: 'second' },
      { key: 'e3', content: 'third' },
    ];

    const result = await handler({ entries });

    assert.equal(result.success, true);
    assert.deepEqual(result.synthesis, {
      summary: 'Combined context from 3 entries',
      keyInsights: ['insight-1', 'insight-2'],
    });
    assert.equal(result.entryCount, 3);
  });

  it('should validate entries param is required', async () => {
    const handler = createContextSynthesizeHandler(bridge);

    const result = await handler({});

    assert.equal(result.success, false);
    assert.ok(result.error.includes('entries is required'));
  });

  it('should validate entries is a non-empty array', async () => {
    const handler = createContextSynthesizeHandler(bridge);

    const result = await handler({ entries: [] });

    assert.equal(result.success, false);
    assert.ok(result.error.includes('entries is required and must be a non-empty array'));
  });

  it('should return error when controller unavailable', async () => {
    bridge.getController = asyncMock(null);
    const handler = createContextSynthesizeHandler(bridge);

    const result = await handler({ entries: [{ key: 'e1' }] });

    assert.equal(result.success, false);
    assert.equal(result.error, 'ContextSynthesizer not available');
  });

  it('should timeout after 2 seconds', async () => {
    mockController.synthesize = hangMock();
    const handler = createContextSynthesizeHandler(bridge);

    const result = await handler({ entries: [{ key: 'e1' }] });

    assert.equal(result.success, false);
    assert.ok(result.error.includes('timeout'));
  });

  it('should handle synthesize throwing', async () => {
    mockController.synthesize = rejectMock('synthesis failed');
    const handler = createContextSynthesizeHandler(bridge);

    const result = await handler({ entries: [{ key: 'e1' }] });

    assert.equal(result.success, false);
    assert.ok(result.error.includes('synthesis failed'));
  });

  it('should pass options to synthesizer', async () => {
    mockController.synthesize = asyncMock({ summary: 'ok', keyInsights: [] });
    const handler = createContextSynthesizeHandler(bridge);
    const entries = [{ key: 'e1' }];
    const options = { maxTokens: 500, format: 'brief' };

    await handler({ entries, options });

    assert.deepEqual(mockController.synthesize.calls[0], [entries, options]);
  });

  it('should return synthesis with entryCount', async () => {
    mockController.synthesize = asyncMock({ summary: 'two items', keyInsights: ['a'] });
    const handler = createContextSynthesizeHandler(bridge);
    const entries = [{ key: 'e1' }, { key: 'e2' }];

    const result = await handler({ entries });

    assert.equal(result.success, true);
    assert.equal(result.entryCount, 2);
    assert.deepEqual(result.synthesis, { summary: 'two items', keyInsights: ['a'] });
  });
});
