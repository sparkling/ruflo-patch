// @tier unit
// ADR-0033: memory-tools enhancements -- activation contract tests
//
// Converted from vitest: ruflo/v3/@claude-flow/cli/__tests__/memory-tools-activation.test.ts
//
// Tests wiring contracts for:
// - Scope prefix (AgentMemoryScope)
// - Context synthesis (ContextSynthesizer)
// - MMR diversity re-ranking (graceful degradation)
// - Scope filtering on search results
//
// London School TDD: all bridge + initializer calls are mocked with plain objects.

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

// ============================================================================
// Mock controllers
// ============================================================================

function createDefaultMocks() {
  const mockScopeController = {
    scopeKey: mockFn((key, scope, scopeId) =>
      scopeId ? `${scope}:${scopeId}:${key}` : `${scope}::${key}`,
    ),
    filterByScope: mockFn((results, scope, scopeId) =>
      results.filter(r => r.key.startsWith(`${scope}:${scopeId || ''}`)),
    ),
  };

  const mockContextSynthesizer = {
    synthesize: mockFn((results) => ({
      summary: 'Synthesized context from results',
      entryCount: results.length,
    })),
  };

  const mockMmrDiversity = {
    selectDiverse: mockFn((results) => results.slice(0, 2)),
  };

  const mockMemoryGraph = {
    addNode: mockFn(),
    getImportance: mockFn(() => 0),
  };

  return { mockScopeController, mockContextSynthesizer, mockMmrDiversity, mockMemoryGraph };
}

// ============================================================================
// Simulated handler logic (mirrors memory-tools.ts wiring)
// ============================================================================

function createMemoryStoreHandler(getController, storeEntry) {
  return async (params) => {
    let key = params.key;

    // Scope prefix
    if (params.scope) {
      try {
        const scopeCtrl = await getController('agentMemoryScope');
        if (scopeCtrl && typeof scopeCtrl.scopeKey === 'function') {
          key = scopeCtrl.scopeKey(params.key, params.scope, params.scope_id);
        }
      } catch (_) {
        // Graceful degradation: use original key
      }
    }

    const result = await storeEntry({ key, value: params.value, namespace: params.namespace });
    return { success: result.success, id: result.id };
  };
}

function createMemorySearchHandler(getController, searchEntries) {
  return async (params) => {
    const searchResult = await searchEntries({
      query: params.query,
      namespace: params.namespace,
      limit: params.limit || 10,
    });

    let results = searchResult.results || [];

    // Scope filtering
    if (params.scope) {
      try {
        const scopeCtrl = await getController('agentMemoryScope');
        if (scopeCtrl && typeof scopeCtrl.filterByScope === 'function') {
          results = scopeCtrl.filterByScope(results, params.scope, params.scope_id);
        }
      } catch (_) {
        // Graceful degradation
      }
    }

    // MMR diversity re-ranking (only when >1 result)
    if (results.length > 1) {
      try {
        const mmr = await getController('mmrDiversity');
        if (mmr && typeof mmr.selectDiverse === 'function') {
          const lambda = params.mmr_lambda ?? 0.5;
          const diverseResults = mmr.selectDiverse(results, params.query, { lambda, k: 10 });
          if (diverseResults && diverseResults.length > 0) {
            results = diverseResults;
          }
        }
      } catch (_) {
        // Graceful degradation: keep original results
      }
    }

    // Context synthesis
    let synthesis;
    if (params.synthesize && results.length > 0) {
      try {
        const synth = await getController('contextSynthesizer');
        if (synth && typeof synth.synthesize === 'function') {
          synthesis = synth.synthesize(results);
        }
      } catch (_) {
        // Graceful degradation
      }
    }

    return {
      results,
      searchTime: searchResult.searchTime,
      synthesis,
    };
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('ADR-0033: memory-tools enhancements', () => {
  let mocks;
  let getController;
  let mockStoreEntry;
  let mockSearchEntries;

  beforeEach(() => {
    mocks = createDefaultMocks();

    getController = mockFn(async (name) => {
      switch (name) {
        case 'agentMemoryScope': return mocks.mockScopeController;
        case 'contextSynthesizer': return mocks.mockContextSynthesizer;
        case 'mmrDiversity': return mocks.mockMmrDiversity;
        case 'memoryGraph': return mocks.mockMemoryGraph;
        case 'metadataFilter': return null;
        case 'attentionService': return null;
        default: return null;
      }
    });

    mockStoreEntry = asyncMock({
      success: true,
      id: 'mock-id',
      embedding: { dimensions: 384 },
    });

    mockSearchEntries = asyncMock({
      success: true,
      results: [
        { key: 'agent:a1:pattern-1', namespace: 'default', content: '"hello"', score: 0.9, tags: [] },
        { key: 'session:s1:pattern-2', namespace: 'default', content: '"world"', score: 0.7, tags: [] },
        { key: 'global::pattern-3', namespace: 'default', content: '"foo"', score: 0.5, tags: [] },
      ],
      searchTime: 1.5,
    });
  });

  // ---------- memory_store -- scope prefix ----------

  describe('memory_store -- scope prefix', () => {
    it('should prefix key with scope when scope param provided', async () => {
      const handler = createMemoryStoreHandler(getController, mockStoreEntry);

      await handler({
        key: 'pattern',
        value: 'data',
        namespace: 'patterns',
        scope: 'agent',
        scope_id: 'a1',
      });

      assert.deepEqual(mocks.mockScopeController.scopeKey.calls[0], ['pattern', 'agent', 'a1']);
      const storedKey = mockStoreEntry.calls[0][0].key;
      assert.equal(storedKey, 'agent:a1:pattern');
    });

    it('should use unscoped key when scope not provided', async () => {
      const handler = createMemoryStoreHandler(getController, mockStoreEntry);

      await handler({
        key: 'pattern',
        value: 'data',
        namespace: 'patterns',
      });

      assert.equal(mocks.mockScopeController.scopeKey.calls.length, 0);
      const storedKey = mockStoreEntry.calls[0][0].key;
      assert.equal(storedKey, 'pattern');
    });

    it('should gracefully degrade when scope controller unavailable', async () => {
      getController = asyncMock(null);
      const handler = createMemoryStoreHandler(getController, mockStoreEntry);

      const result = await handler({
        key: 'pattern',
        value: 'data',
        namespace: 'patterns',
        scope: 'agent',
        scope_id: 'a1',
      });

      const storedKey = mockStoreEntry.calls[0][0].key;
      assert.equal(storedKey, 'pattern');
      assert.equal(result.success, true);
    });
  });

  // ---------- memory_search -- scope filtering ----------

  describe('memory_search -- scope filtering', () => {
    it('should filter results by scope when scope param provided', async () => {
      const handler = createMemorySearchHandler(getController, mockSearchEntries);

      const result = await handler({
        query: 'test query',
        scope: 'agent',
        scope_id: 'a1',
      });

      assert.equal(mocks.mockScopeController.filterByScope.calls.length > 0, true);
      // Only agent:a1:* results should remain
      assert.ok(result.results.every(r => r.key.startsWith('agent:a1')));
    });

    it('should return all results when scope not provided', async () => {
      // Disable MMR so it does not trim results
      mocks.mockMmrDiversity.selectDiverse = mockFn(() => null);
      const handler = createMemorySearchHandler(getController, mockSearchEntries);

      const result = await handler({ query: 'test query' });

      assert.equal(mocks.mockScopeController.filterByScope.calls.length, 0);
      assert.equal(result.results.length, 3);
    });
  });

  // ---------- memory_search -- context synthesis ----------

  describe('memory_search -- context synthesis', () => {
    it('should include synthesis when synthesize=true', async () => {
      const handler = createMemorySearchHandler(getController, mockSearchEntries);

      const result = await handler({
        query: 'test query',
        synthesize: true,
      });

      assert.equal(mocks.mockContextSynthesizer.synthesize.calls.length > 0, true);
      assert.equal(result.synthesis.summary, 'Synthesized context from results');
      assert.equal(typeof result.synthesis.entryCount, 'number');
    });

    it('should NOT synthesize when synthesize=false', async () => {
      const handler = createMemorySearchHandler(getController, mockSearchEntries);

      const result = await handler({
        query: 'test query',
        synthesize: false,
      });

      assert.equal(mocks.mockContextSynthesizer.synthesize.calls.length, 0);
      assert.equal(result.synthesis, undefined);
    });

    it('should NOT synthesize when synthesize omitted', async () => {
      const handler = createMemorySearchHandler(getController, mockSearchEntries);

      const result = await handler({ query: 'test query' });

      assert.equal(mocks.mockContextSynthesizer.synthesize.calls.length, 0);
      assert.equal(result.synthesis, undefined);
    });

    it('should gracefully degrade when synthesizer unavailable', async () => {
      getController = mockFn(async (name) => {
        if (name === 'contextSynthesizer') return null;
        if (name === 'memoryGraph') return mocks.mockMemoryGraph;
        if (name === 'mmrDiversity') return mocks.mockMmrDiversity;
        if (name === 'attentionService') return null;
        return null;
      });
      const handler = createMemorySearchHandler(getController, mockSearchEntries);

      const result = await handler({
        query: 'test query',
        synthesize: true,
      });

      assert.ok(result.results.length > 0);
      assert.equal(result.synthesis, undefined);
    });

    it('should NOT synthesize when results are empty', async () => {
      mockSearchEntries = asyncMock({
        success: true,
        results: [],
        searchTime: 0.5,
      });
      const handler = createMemorySearchHandler(getController, mockSearchEntries);

      const result = await handler({
        query: 'no results',
        synthesize: true,
      });

      assert.equal(mocks.mockContextSynthesizer.synthesize.calls.length, 0);
      assert.equal(result.synthesis, undefined);
    });
  });

  // ---------- memory_search -- MMR diversity ----------

  describe('memory_search -- MMR diversity', () => {
    it('should apply MMR re-ranking when available', async () => {
      const handler = createMemorySearchHandler(getController, mockSearchEntries);

      await handler({
        query: 'test',
        mmr_lambda: 0.7,
      });

      assert.equal(mocks.mockMmrDiversity.selectDiverse.calls.length, 1);
      const callArgs = mocks.mockMmrDiversity.selectDiverse.calls[0];
      assert.ok(Array.isArray(callArgs[0]));
      assert.equal(callArgs[1], 'test');
      assert.deepEqual(callArgs[2], { lambda: 0.7, k: 10 });
    });

    it('should apply MMR with default lambda 0.5', async () => {
      const handler = createMemorySearchHandler(getController, mockSearchEntries);

      await handler({ query: 'test' });

      const callArgs = mocks.mockMmrDiversity.selectDiverse.calls[0];
      assert.equal(callArgs[2].lambda, 0.5);
    });

    it('should not throw on MMR failure (graceful degradation)', async () => {
      mocks.mockMmrDiversity.selectDiverse = mockFn(() => {
        throw new Error('MMR computation failed');
      });
      const handler = createMemorySearchHandler(getController, mockSearchEntries);

      const result = await handler({ query: 'test' });

      assert.ok(result.results.length > 0);
      assert.equal(result.error, undefined);
    });

    it('should not apply MMR when only 1 result', async () => {
      mockSearchEntries = asyncMock({
        success: true,
        results: [
          { key: 'only-one', namespace: 'default', content: '"single"', score: 0.9, tags: [] },
        ],
        searchTime: 0.5,
      });
      const handler = createMemorySearchHandler(getController, mockSearchEntries);

      await handler({ query: 'test' });

      assert.equal(mocks.mockMmrDiversity.selectDiverse.calls.length, 0);
    });

    it('should fall back to original results when MMR returns empty', async () => {
      mocks.mockMmrDiversity.selectDiverse = mockFn(() => []);
      const handler = createMemorySearchHandler(getController, mockSearchEntries);

      const result = await handler({ query: 'test' });

      assert.ok(result.results.length > 0);
    });
  });

  // ===========================================================================
  // memory_store -- scope edge cases
  // ===========================================================================

  describe('memory_store -- scope edge cases', () => {
    it('should handle global scope without scope_id', async () => {
      const handler = createMemoryStoreHandler(getController, mockStoreEntry);

      const result = await handler({
        key: 'test-key',
        value: 'hello',
        namespace: 'ns1',
        scope: 'global',
        // No scope_id
      });

      assert.equal(result.success, true);
      assert.equal(mocks.mockScopeController.scopeKey.calls[0][1], 'global');
    });

    it('should fall back to unscoped key when scope controller throws', async () => {
      const throwingGetController = mockFn(async () => {
        throw new Error('scope controller crashed');
      });
      const handler = createMemoryStoreHandler(throwingGetController, mockStoreEntry);

      const result = await handler({
        key: 'test-key',
        value: 'hello',
        namespace: 'ns1',
        scope: 'agent',
        scope_id: 'a1',
      });

      // Should still succeed with unscoped key
      assert.equal(result.success, true);
      const storedKey = mockStoreEntry.calls[mockStoreEntry.calls.length - 1][0].key;
      assert.equal(storedKey, 'test-key');
    });
  });

  // ===========================================================================
  // memory_search -- scope + MMR interaction
  // ===========================================================================

  describe('memory_search -- scope + MMR interaction', () => {
    it('should return unfiltered results when scope set but controller unavailable', async () => {
      const nullGetController = asyncMock(null);
      const handler = createMemorySearchHandler(nullGetController, mockSearchEntries);

      const result = await handler({
        query: 'test',
        scope: 'agent',
        scope_id: 'a1',
      });

      // No scope controller -> results returned unfiltered (MMR also null -> no re-ranking)
      assert.ok(result.results.length >= 1);
    });
  });

  // ===========================================================================
  // memory_search -- MMR regression (322b3e2f8)
  // ===========================================================================

  describe('memory_search -- MMR regression', () => {
    it('should degrade gracefully when selectDiverse returns null', async () => {
      const mmrNullGetController = mockFn(async (name) => {
        if (name === 'mmrDiversity') return { selectDiverse: mockFn(() => null) };
        return null;
      });
      const handler = createMemorySearchHandler(mmrNullGetController, mockSearchEntries);

      const result = await handler({ query: 'test' });

      // null from selectDiverse -> original results preserved
      assert.ok(result.results.length >= 1);
    });

    it('should degrade gracefully when selectDiverse returns undefined', async () => {
      const mmrUndefGetController = mockFn(async (name) => {
        if (name === 'mmrDiversity') return { selectDiverse: mockFn(() => undefined) };
        return null;
      });
      const handler = createMemorySearchHandler(mmrUndefGetController, mockSearchEntries);

      const result = await handler({ query: 'test' });

      assert.ok(result.results.length >= 1);
    });

    it('should degrade gracefully when selectDiverse throws', async () => {
      const mmrThrowGetController = mockFn(async (name) => {
        if (name === 'mmrDiversity') return {
          selectDiverse: mockFn(() => { throw new Error('MMR internal error'); }),
        };
        return null;
      });
      const handler = createMemorySearchHandler(mmrThrowGetController, mockSearchEntries);

      const result = await handler({ query: 'test' });

      // Should NOT throw -- original results preserved
      assert.ok(result.results.length >= 1);
    });
  });

  // ===========================================================================
  // memory_search -- context synthesis edge cases
  // ===========================================================================

  describe('memory_search -- context synthesis edge cases', () => {
    it('should not call synthesizer when synthesize=false', async () => {
      const synthMock = { synthesize: mockFn((results) => ({ summary: 'test' })) };
      const synthGetController = mockFn(async (name) => {
        if (name === 'contextSynthesizer') return synthMock;
        if (name === 'mmrDiversity') return mocks.mockMmrDiversity;
        return null;
      });
      const handler = createMemorySearchHandler(synthGetController, mockSearchEntries);

      const result = await handler({ query: 'test', synthesize: false });

      assert.equal(synthMock.synthesize.calls.length, 0);
    });

    it('should handle synthesizer throwing gracefully', async () => {
      const throwingSynth = {
        synthesize: mockFn(() => { throw new Error('synthesis failed'); }),
      };
      const synthThrowGetController = mockFn(async (name) => {
        if (name === 'contextSynthesizer') return throwingSynth;
        if (name === 'mmrDiversity') return mocks.mockMmrDiversity;
        return null;
      });
      const handler = createMemorySearchHandler(synthThrowGetController, mockSearchEntries);

      const result = await handler({ query: 'test', synthesize: true });

      // Should still return results even if synthesis fails
      assert.ok(result.results.length >= 1);
    });
  });
});
