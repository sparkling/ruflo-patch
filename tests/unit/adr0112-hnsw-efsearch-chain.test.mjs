// @tier unit
// ADR-0112 follow-up: HNSW efSearch config-chain plumbing
//
// Pre-fix bug (closed by today's RVF-track commit ffa9de5f8 + this upper-chain
// patch): native query was passing `efConstruction` where `efSearch` belongs;
// `hnswEfSearch` had no plumbing through StorageConfig / ResolvedConfig; and
// resolve-config silently overwrote any file-set hnsw.{M,efC,efS} with derivation.
//
// These tests pin the contract structurally (London-style source reads, same
// pattern as adr0076-resolve-config-contract.test.mjs).

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';

const MEMORY_SRC      = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/memory/src';
const RVF_PATH        = `${MEMORY_SRC}/rvf-backend.ts`;
const FACTORY_PATH    = `${MEMORY_SRC}/storage-factory.ts`;
const RESOLVE_PATH    = `${MEMORY_SRC}/resolve-config.ts`;

assert.ok(existsSync(RVF_PATH),     `rvf-backend.ts not found at ${RVF_PATH}`);
assert.ok(existsSync(FACTORY_PATH), `storage-factory.ts not found at ${FACTORY_PATH}`);
assert.ok(existsSync(RESOLVE_PATH), `resolve-config.ts not found at ${RESOLVE_PATH}`);

const rvfSrc     = readFileSync(RVF_PATH,     'utf-8');
const factorySrc = readFileSync(FACTORY_PATH, 'utf-8');
const resolveSrc = readFileSync(RESOLVE_PATH, 'utf-8');

describe('ADR-0112 hnswEfSearch — RvfBackend (lower chain)', () => {
  it('declares hnswEfSearch?: number on its config interface', () => {
    assert.match(
      rvfSrc,
      /hnswEfSearch\s*\?\s*:\s*number/,
      'rvf-backend.ts must declare hnswEfSearch?: number',
    );
  });

  it('resolves hnswEfSearch from config or derived.efSearch', () => {
    assert.match(
      rvfSrc,
      /hnswEfSearch\s*:\s*config\.hnswEfSearch\s*\?\?\s*derived\.efSearch/,
      'rvf-backend.ts must resolve hnswEfSearch via `config.hnswEfSearch ?? derived.efSearch`',
    );
  });

  it('passes hnswEfSearch (NOT hnswEfConstruction) to native query', () => {
    // The original bug: efSearch was being set from this.config.hnswEfConstruction.
    assert.match(
      rvfSrc,
      /efSearch\s*:\s*this\.config\.hnswEfSearch/,
      'rvf-backend.ts native query must pass `efSearch: this.config.hnswEfSearch`',
    );
    assert.doesNotMatch(
      rvfSrc,
      /efSearch\s*:\s*this\.config\.hnswEfConstruction/,
      'rvf-backend.ts must NOT pass `efSearch: this.config.hnswEfConstruction` (the original bug)',
    );
  });
});

describe('ADR-0112 hnswEfSearch — StorageConfig + factory (upper chain)', () => {
  it('StorageConfig declares hnswEfSearch?: number', () => {
    assert.match(
      factorySrc,
      /hnswEfSearch\s*\?\s*:\s*number/,
      'storage-factory.ts StorageConfig must declare hnswEfSearch?: number',
    );
  });

  it('createStorage destructures hnswEfSearch from config', () => {
    assert.match(
      factorySrc,
      /\bhnswEfSearch\b\s*,/,
      'createStorage must destructure hnswEfSearch from its config arg',
    );
  });

  it('createStorage forwards hnswEfSearch to RvfBackend when defined', () => {
    assert.match(
      factorySrc,
      /\.\.\.\(hnswEfSearch\s*!==\s*undefined\s*&&\s*\{\s*hnswEfSearch\s*\}\)/,
      'createStorage must conditionally spread { hnswEfSearch } into RvfBackend config',
    );
  });

  it('createStorageFromConfig wires resolved.hnsw.efSearch → hnswEfSearch', () => {
    assert.match(
      factorySrc,
      /hnswEfSearch\s*:\s*resolved\.hnsw\.efSearch/,
      'createStorageFromConfig must set hnswEfSearch from resolved.hnsw.efSearch',
    );
  });
});

describe('ADR-0112 hnswEfSearch — resolve-config file-set overrides', () => {
  it('declares hnswEfSearchOverride state in resolveConfig()', () => {
    assert.match(
      resolveSrc,
      /let\s+hnswEfSearchOverride\s*:\s*number\s*\|\s*undefined/,
      'resolve-config.ts must declare `let hnswEfSearchOverride: number | undefined`',
    );
  });

  it('reads hnsw.efSearch from embeddings.json file config', () => {
    assert.match(
      resolveSrc,
      /typeof\s+hnsw\.efSearch\s*===\s*['"]number['"]\s*\)\s*hnswEfSearchOverride\s*=\s*hnsw\.efSearch/,
      'resolve-config.ts must read fileConfig.hnsw.efSearch into hnswEfSearchOverride',
    );
  });

  it('drops hnsw overrides when ADR-0069 384→768 safety gate fires', () => {
    // The gate must reset all three HNSW overrides — geometry tied to 384 must
    // not leak into the rewritten 768-dim index.
    const gateBlock = resolveSrc.match(
      /if\s*\(\s*dimension\s*===\s*384\s*\)\s*\{[\s\S]*?\}/,
    );
    assert.ok(gateBlock, 'resolve-config.ts must contain `if (dimension === 384) { ... }` gate');
    const body = gateBlock[0];
    assert.match(body, /dimension\s*=\s*768/,        'gate must rewrite dimension to 768');
    assert.match(body, /hnswMOverride\s*=\s*undefined/,            'gate must drop hnswMOverride');
    assert.match(body, /hnswEfConstructionOverride\s*=\s*undefined/, 'gate must drop hnswEfConstructionOverride');
    assert.match(body, /hnswEfSearchOverride\s*=\s*undefined/,     'gate must drop hnswEfSearchOverride');
  });

  it('final ResolvedConfig.hnsw.efSearch uses override-or-derived', () => {
    assert.match(
      resolveSrc,
      /const\s+hnswEfSearch\s*=\s*hnswEfSearchOverride\s*\?\?\s*hnswParams\.efSearch/,
      'resolve-config.ts must define `const hnswEfSearch = hnswEfSearchOverride ?? hnswParams.efSearch`',
    );
  });

  it('emits efSearch in the deepFrozen ResolvedConfig.hnsw block', () => {
    assert.match(
      resolveSrc,
      /hnsw\s*:\s*\{\s*M\s*:\s*hnswM\s*,\s*efConstruction\s*:\s*hnswEfConstruction\s*,\s*efSearch\s*:\s*hnswEfSearch\s*\}/,
      'ResolvedConfig.hnsw must emit { M: hnswM, efConstruction: hnswEfConstruction, efSearch: hnswEfSearch }',
    );
  });
});
