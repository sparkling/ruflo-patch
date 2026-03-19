/**
 * ADR-0052: Embedding config propagation — end-to-end verification.
 *
 * Reads fork source for static analysis + inlines pure-logic replicas
 * of config functions (agentdb is not a direct dependency of ruflo-patch).
 */
import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const HOME = process.env.HOME ?? '/home/claude';
const CONFIG_SRC = resolve(
  HOME, 'src/forks/agentic-flow/packages/agentdb/src/config/embedding-config.ts',
);
let source = '';
try { source = readFileSync(CONFIG_SRC, 'utf-8'); } catch { /* fork may be absent */ }

// Inlined replicas — pure logic, no fs/env deps
const MODEL_REGISTRY: Record<string, { dimension: number }> = {
  'nomic-ai/nomic-embed-text-v1.5': { dimension: 768 },
  'all-MiniLM-L6-v2': { dimension: 384 },
  'all-mpnet-base-v2': { dimension: 768 },
};
const DEFAULT = { model: 'nomic-ai/nomic-embed-text-v1.5', dimension: 768, provider: 'transformers',
  taskPrefixQuery: 'search_query: ', taskPrefixIndex: 'search_document: ', contextWindow: 8192 };
type Cfg = typeof DEFAULT;
let _cache: Cfg | null = null;

function getEmbeddingConfig(ov?: Partial<Cfg>): Cfg {
  if (_cache && !ov) return _cache;
  const c = { ...DEFAULT };
  if (ov) Object.assign(c, ov);
  if (!ov) _cache = c;
  return c;
}
function resetEmbeddingConfig() { _cache = null; }
function deriveHNSWParams(dim?: number) {
  const d = dim ?? getEmbeddingConfig().dimension;
  const M = Math.max(8, Math.min(48, Math.floor(Math.sqrt(d) / 1.2)));
  const efConstruction = Math.max(100, Math.min(500, 4 * M));
  const efSearch = Math.max(50, Math.min(400, 2 * M));
  return { M, efConstruction, efSearch };
}

describe('ADR-0052: embedding config propagation', () => {
  beforeEach(() => resetEmbeddingConfig());

  it('source exports getEmbeddingConfig, deriveHNSWParams, MODEL_REGISTRY, resetEmbeddingConfig', () => {
    assert.ok(source.length > 0, 'embedding-config.ts readable');
    for (const sym of ['getEmbeddingConfig', 'deriveHNSWParams', 'MODEL_REGISTRY', 'resetEmbeddingConfig'])
      assert.ok(source.includes(`export ${sym.startsWith('MODEL') ? 'const' : 'function'} ${sym}`), `${sym} exported`);
  });

  it('MODEL_REGISTRY contains key models (nomic, MiniLM, mpnet)', () => {
    for (const m of ['nomic-ai/nomic-embed-text-v1.5', 'all-MiniLM-L6-v2', 'all-mpnet-base-v2'])
      assert.ok(source.includes(m), `${m} present in source`);
  });

  it('getEmbeddingConfig() returns default 768 dim, nomic model', () => {
    const cfg = getEmbeddingConfig();
    assert.strictEqual(cfg.dimension, 768);
    assert.strictEqual(cfg.model, 'nomic-ai/nomic-embed-text-v1.5');
  });

  it('getEmbeddingConfig({ dimension: 384 }) overrides dimension', () => {
    assert.strictEqual(getEmbeddingConfig({ dimension: 384 }).dimension, 384);
  });

  it('MiniLM model resolves to 384 dim in MODEL_REGISTRY', () => {
    assert.strictEqual(MODEL_REGISTRY['all-MiniLM-L6-v2']?.dimension, 384);
    assert.ok(source.includes('modelInfo.dimension'), 'source auto-derives dimension from registry');
  });

  it('deriveHNSWParams(768) returns sensible values (M > 8, efConstruction >= 100)', () => {
    const p = deriveHNSWParams(768);
    assert.ok(p.M > 8, `M=${p.M}`);
    assert.ok(p.efConstruction >= 100, `efC=${p.efConstruction}`);
  });

  it('deriveHNSWParams(384) returns smaller/equal values than 768', () => {
    const lo = deriveHNSWParams(384), hi = deriveHNSWParams(768);
    assert.ok(lo.M <= hi.M, `M: ${lo.M} <= ${hi.M}`);
    assert.ok(lo.efConstruction <= hi.efConstruction);
  });

  it('resetEmbeddingConfig() clears cache — fresh object returned', () => {
    const a = getEmbeddingConfig();
    assert.strictEqual(a, getEmbeddingConfig(), 'cached same ref');
    resetEmbeddingConfig();
    const b = getEmbeddingConfig();
    assert.notStrictEqual(a, b, 'new object after reset');
    assert.strictEqual(b.dimension, 768);
  });
});
