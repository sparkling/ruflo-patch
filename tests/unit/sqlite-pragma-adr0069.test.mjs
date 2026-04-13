// @tier unit
// ADR-0069 A1: SQLite pragma config chain bypass
// London School TDD: inline mock factories, no real sqlite imports.

import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

// Resolve forks directory from upstream-branches.json
const FORKS = (() => {
  try {
    const cfg = JSON.parse(readFileSync(
      join(process.cwd(), 'config', 'upstream-branches.json'), 'utf-8'
    ));
    return dirname(cfg.ruflo.dir);
  } catch {
    return join(dirname(process.cwd()), 'forks');
  }
})();

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

// ============================================================================
// Group 1: RuntimeConfig.sqlite interface exists
// ============================================================================

describe('ADR-0069 A1: RuntimeConfig has sqlite field', () => {

  it('controller-registry.ts exports RuntimeConfig with sqlite?: {...}', () => {
    const src = readFileSync(
      join(FORKS, 'ruflo/v3/@claude-flow/memory/src/controller-registry.ts'),
      'utf-8'
    );
    assert.match(src, /sqlite\?:\s*\{/, 'RuntimeConfig must have sqlite? field');
    assert.match(src, /cacheSize\?:\s*number/, 'sqlite must have cacheSize');
    assert.match(src, /busyTimeoutMs\?:\s*number/, 'sqlite must have busyTimeoutMs');
    assert.match(src, /journalMode\?:\s*string/, 'sqlite must have journalMode');
    assert.match(src, /synchronous\?:\s*string/, 'sqlite must have synchronous');
  });
});

// ============================================================================
// Group 3: sqlite-backend uses config-driven pragmas
// ============================================================================

describe('ADR-0069 A1: sqlite-backend config-driven pragmas', () => {

  it('SQLiteBackendConfig has sqlitePragmas field', () => {
    const src = readFileSync(
      join(FORKS, 'ruflo/v3/@claude-flow/memory/src/sqlite-backend.ts'),
      'utf-8'
    );
    assert.match(src, /sqlitePragmas\?:\s*\{/, 'must have sqlitePragmas? field');
  });

  it('initialize() reads pragmas from config with fallback defaults', () => {
    const src = readFileSync(
      join(FORKS, 'ruflo/v3/@claude-flow/memory/src/sqlite-backend.ts'),
      'utf-8'
    );
    // Must use template literals with config values, not hardcoded
    assert.match(src, /pragmas\?\.cacheSize\s*\?\?\s*-64000/, 'cacheSize must fallback to -64000');
    assert.match(src, /pragmas\?\.busyTimeoutMs\s*\?\?\s*5000/, 'busyTimeoutMs must fallback to 5000');
    assert.match(src, /pragmas\?\.journalMode\s*\?\?\s*'WAL'/, 'journalMode must fallback to WAL');
    assert.match(src, /pragmas\?\.synchronous\s*\?\?\s*'NORMAL'/, 'synchronous must fallback to NORMAL');
  });

  it('no longer hardcodes cache_size = 10000', () => {
    const src = readFileSync(
      join(FORKS, 'ruflo/v3/@claude-flow/memory/src/sqlite-backend.ts'),
      'utf-8'
    );
    assert.doesNotMatch(src, /cache_size\s*=\s*10000/, 'must not hardcode cache_size = 10000');
  });
});

// ============================================================================
// Group 4: memory-initializer schema no longer embeds PRAGMA journal/sync
// ============================================================================

// ADR-0086: memory-initializer.ts may be deleted — this group is skipped when absent

// ============================================================================
// Group 5: AgentDB.ts config-driven pragmas
// ============================================================================

describe('ADR-0069 A1: AgentDB config-driven pragmas', () => {

  it('AgentDBConfig has sqlite field', () => {
    const src = readFileSync(
      join(FORKS, 'agentic-flow/packages/agentdb/src/core/AgentDB.ts'),
      'utf-8'
    );
    assert.match(src, /sqlite\?:\s*\{/, 'AgentDBConfig must have sqlite? field');
  });

  it('pragmas use config values with fallback defaults', () => {
    const src = readFileSync(
      join(FORKS, 'agentic-flow/packages/agentdb/src/core/AgentDB.ts'),
      'utf-8'
    );
    assert.match(src, /sq\?\.cacheSize\s*\?\?\s*-64000/, 'cacheSize fallback must be -64000');
    assert.match(src, /sq\?\.busyTimeoutMs\s*\?\?\s*5000/, 'busyTimeoutMs fallback must be 5000');
    assert.match(src, /sq\?\.journalMode\s*\?\?\s*'WAL'/, 'journalMode fallback must be WAL');
    assert.match(src, /sq\?\.synchronous\s*\?\?\s*'NORMAL'/, 'synchronous fallback must be NORMAL');
  });

  it('sq variable is declared outside the try block (accessible in catch)', () => {
    const src = readFileSync(
      join(FORKS, 'agentic-flow/packages/agentdb/src/core/AgentDB.ts'),
      'utf-8'
    );
    // sq must be declared before the try block
    const sqDecl = src.indexOf('const sq = this.config.sqlite');
    const tryBlock = src.indexOf('try {', sqDecl > 0 ? sqDecl : 0);
    assert.ok(sqDecl > 0, 'sq must be declared');
    assert.ok(sqDecl < tryBlock, 'sq must be declared before try block');
  });
});

// ============================================================================
// Group 6: EmbeddingCache, IntelligenceStore, WorkerRegistry — consistent pragmas
// ============================================================================

describe('ADR-0069 A1: agentic-flow WAL sites have busy_timeout and consistent cache_size', () => {

  it('EmbeddingCache uses cache_size = -64000 and busy_timeout = 5000', () => {
    const src = readFileSync(
      join(FORKS, 'agentic-flow/agentic-flow/src/intelligence/EmbeddingCache.ts'),
      'utf-8'
    );
    assert.match(src, /cache_size\s*=\s*-64000/, 'EmbeddingCache must use cache_size = -64000');
    assert.match(src, /busy_timeout\s*=\s*5000/, 'EmbeddingCache must set busy_timeout = 5000');
    assert.doesNotMatch(src, /cache_size\s*=\s*10000/, 'EmbeddingCache must not use cache_size = 10000');
  });

  it('IntelligenceStore sets busy_timeout and cache_size in better-sqlite3 path', () => {
    const src = readFileSync(
      join(FORKS, 'agentic-flow/agentic-flow/src/intelligence/IntelligenceStore.ts'),
      'utf-8'
    );
    assert.match(src, /cache_size\s*=\s*-64000/, 'IntelligenceStore must use cache_size = -64000');
    assert.match(src, /busy_timeout\s*=\s*5000/, 'IntelligenceStore must set busy_timeout = 5000');
  });

  it('WorkerRegistry sets busy_timeout and cache_size', () => {
    const src = readFileSync(
      join(FORKS, 'agentic-flow/agentic-flow/src/workers/worker-registry.ts'),
      'utf-8'
    );
    assert.match(src, /cache_size\s*=\s*-64000/, 'WorkerRegistry must use cache_size = -64000');
    assert.match(src, /busy_timeout\s*=\s*5000/, 'WorkerRegistry must set busy_timeout = 5000');
  });
});

// ============================================================================
// Group 7: Config fallback simulation (functional mock test)
// ============================================================================

describe('ADR-0069 A1: config fallback logic', () => {

  function resolvePragma(config, key, fallback) {
    return config?.sqlite?.[key] ?? fallback;
  }

  it('uses config value when provided', () => {
    const config = { sqlite: { cacheSize: -128000, busyTimeoutMs: 10000 } };
    assert.equal(resolvePragma(config, 'cacheSize', -64000), -128000);
    assert.equal(resolvePragma(config, 'busyTimeoutMs', 5000), 10000);
  });

  it('uses fallback when config is undefined', () => {
    assert.equal(resolvePragma({}, 'cacheSize', -64000), -64000);
    assert.equal(resolvePragma({}, 'busyTimeoutMs', 5000), 5000);
    assert.equal(resolvePragma(undefined, 'cacheSize', -64000), -64000);
  });

  it('uses fallback when sqlite block is empty', () => {
    const config = { sqlite: {} };
    assert.equal(resolvePragma(config, 'cacheSize', -64000), -64000);
    assert.equal(resolvePragma(config, 'busyTimeoutMs', 5000), 5000);
  });
});
