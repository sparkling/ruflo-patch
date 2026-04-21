// @tier unit
// ADR-0069 Appendix A5 (post-A4 hoist): config-chain EWC lambda residual
//
// As of A4 hoist, readEwcLambdaFromConfig lives in the shared module
//   packages/agentdb/src/config/embedding-config.ts
// and the two A5 call sites (intelligence-tools.ts + SonaLearningBackend.ts)
// import from it rather than defining a local helper. This test asserts the
// post-A4 world: both files import the shared helper, invoke it at the
// right feature site, and do NOT re-define it locally.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const FORK_ROOT = '/Users/henrik/source/forks/agentic-flow';
const AF_SRC    = join(FORK_ROOT, 'agentic-flow', 'src');
const ADB_SRC   = join(FORK_ROOT, 'packages', 'agentdb', 'src');

const INTEL_TOOLS_PATH   = join(AF_SRC, 'mcp', 'fastmcp', 'tools', 'hooks', 'intelligence-tools.ts');
const SONA_BACKEND_PATH  = join(ADB_SRC, 'backends', 'rvf', 'SonaLearningBackend.ts');
const SHARED_HELPER_PATH = join(ADB_SRC, 'config', 'embedding-config.ts');

// ============================================================================
// 0. Shared module contract
// ============================================================================

describe('ADR-0069 A5 (post-A4): shared embedding-config module', () => {
  it('exists', () => {
    assert.ok(existsSync(SHARED_HELPER_PATH), `Expected ${SHARED_HELPER_PATH}`);
  });

  it('exports readEwcLambdaFromConfig', () => {
    const src = readFileSync(SHARED_HELPER_PATH, 'utf-8');
    assert.match(
      src,
      /export\s+function\s+readEwcLambdaFromConfig\s*\(/,
      'shared module must export readEwcLambdaFromConfig'
    );
  });
});

// ============================================================================
// 1. intelligence-tools.ts — imports from shared, no local definition
// ============================================================================

describe('ADR-0069 A5 (post-A4): intelligence-tools.ts', () => {
  it('exists', () => {
    assert.ok(existsSync(INTEL_TOOLS_PATH), `Expected ${INTEL_TOOLS_PATH}`);
  });

  it('imports readEwcLambdaFromConfig from the shared embedding-config module', () => {
    const src = readFileSync(INTEL_TOOLS_PATH, 'utf-8');
    assert.match(
      src,
      /import[^;]*\breadEwcLambdaFromConfig\b[^;]*from\s*['"][^'"]*embedding-config[^'"]*['"]/s,
      'must import readEwcLambdaFromConfig from an embedding-config module path'
    );
  });

  it('does NOT redefine readEwcLambdaFromConfig locally', () => {
    const src = readFileSync(INTEL_TOOLS_PATH, 'utf-8');
    const localDef = src.match(/^function\s+readEwcLambdaFromConfig\s*\(/m);
    assert.equal(localDef, null, 'no local redefinition of the hoisted helper');
  });

  it('uses readEwcLambdaFromConfig(2000) at the ewcLambda feature site (ADR-0069 A5 spec fallback)', () => {
    const src = readFileSync(INTEL_TOOLS_PATH, 'utf-8');
    assert.match(
      src,
      /ewcLambda\s*:\s*readEwcLambdaFromConfig\(\s*2000\s*\)/,
      'intelligence-tools stats feature block must call readEwcLambdaFromConfig(2000) per ADR-0069 A5 table (fallback 1000→2000 closure)'
    );
  });

  it('has no inline IIFE fallback reading config.json for ewcLambda', () => {
    const src = readFileSync(INTEL_TOOLS_PATH, 'utf-8');
    // Match the legacy `(() => { try { const c = JSON.parse(require('fs')...` shape
    assert.ok(
      !/ewcLambda[^,]*\(\s*\(\s*\)\s*=>\s*\{[^}]*JSON\.parse[^}]*catch[^}]*return\s+2000/s.test(src),
      'legacy inline IIFE must be gone'
    );
  });
});

// ============================================================================
// 2. SonaLearningBackend.ts — imports from shared, no local definition
// ============================================================================

describe('ADR-0069 A5 (post-A4): SonaLearningBackend.ts', () => {
  it('exists', () => {
    assert.ok(existsSync(SONA_BACKEND_PATH), `Expected ${SONA_BACKEND_PATH}`);
  });

  it('imports readEwcLambdaFromConfig from the shared embedding-config module', () => {
    const src = readFileSync(SONA_BACKEND_PATH, 'utf-8');
    assert.match(
      src,
      /import[^;]*\breadEwcLambdaFromConfig\b[^;]*from\s*['"][^'"]*embedding-config[^'"]*['"]/s,
      'must import readEwcLambdaFromConfig from an embedding-config module path'
    );
  });

  it('does NOT redefine readEwcLambdaFromConfig locally', () => {
    const src = readFileSync(SONA_BACKEND_PATH, 'utf-8');
    const localDef = src.match(/^function\s+readEwcLambdaFromConfig\s*\(/m);
    assert.equal(localDef, null, 'no local redefinition of the hoisted helper');
  });

  it('uses readEwcLambdaFromConfig(2000) in the ewcLambda nullish chain (ADR-0069 A5 spec fallback)', () => {
    const src = readFileSync(SONA_BACKEND_PATH, 'utf-8');
    assert.match(
      src,
      /config\.ewcLambda\s*\?\?\s*readEwcLambdaFromConfig\(\s*2000\s*\)/,
      'SonaLearningBackend must use config.ewcLambda ?? readEwcLambdaFromConfig(2000) per ADR-0069 A5 table (fallback 1000→2000 closure)'
    );
  });

  it('has no bare `?? 2000` fallback for ewcLambda (must go through helper)', () => {
    const src = readFileSync(SONA_BACKEND_PATH, 'utf-8');
    // After A5 closure, fallback is inside readEwcLambdaFromConfig(2000), not bare `?? 2000`
    assert.ok(
      !/config\.ewcLambda\s*\?\?\s*2000\b/.test(src),
      'legacy bare numeric fallback `?? 2000` must be gone (must go through readEwcLambdaFromConfig)'
    );
  });
});
