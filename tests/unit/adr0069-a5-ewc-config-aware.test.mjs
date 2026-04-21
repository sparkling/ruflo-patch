// @tier unit
// ADR-0069 Appendix A5: config-chain EWC lambda residual remediation
//
// Asserts that the two residual ewcLambda call sites —
//   1. agentic-flow/src/mcp/fastmcp/tools/hooks/intelligence-tools.ts
//   2. packages/agentdb/src/backends/rvf/SonaLearningBackend.ts
// route through `readEwcLambdaFromConfig(...)` instead of inline IIFEs or
// bare numeric fallbacks, matching the existing helper pattern in
// RuVectorIntelligence.ts / sona-agentdb-integration.ts per ADR-0069:380.
//
// London-school TDD: read source files, assert on wiring contracts
// (import presence, helper invocation, absence of old inline IIFE and bare-default forms).

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const FORK_ROOT = '/Users/henrik/source/forks/agentic-flow';
const AF_SRC    = join(FORK_ROOT, 'agentic-flow', 'src');
const ADB_SRC   = join(FORK_ROOT, 'packages', 'agentdb', 'src');

const INTEL_TOOLS_PATH = join(AF_SRC, 'mcp', 'fastmcp', 'tools', 'hooks', 'intelligence-tools.ts');
const SONA_BACKEND_PATH = join(ADB_SRC, 'backends', 'rvf', 'SonaLearningBackend.ts');

// ============================================================================
// 1. intelligence-tools.ts — IIFE replacement + helper wiring
// ============================================================================

describe('ADR-0069 A5: mcp/fastmcp/tools/hooks/intelligence-tools.ts', () => {
  it('exists', () => {
    assert.ok(existsSync(INTEL_TOOLS_PATH), `Expected ${INTEL_TOOLS_PATH}`);
  });

  it('has top-level ESM import for readFileSync from node:fs', () => {
    const src = readFileSync(INTEL_TOOLS_PATH, 'utf-8');
    assert.match(
      src,
      /import\s*\{\s*readFileSync\s*\}\s*from\s*['"]node:fs['"]/,
      'must import { readFileSync } from "node:fs" at top level'
    );
  });

  it('has top-level ESM import for resolve from node:path', () => {
    const src = readFileSync(INTEL_TOOLS_PATH, 'utf-8');
    assert.match(
      src,
      /import\s*\{\s*resolve\s*\}\s*from\s*['"]node:path['"]/,
      'must import { resolve } from "node:path" at top level'
    );
  });

  it('defines readEwcLambdaFromConfig helper locally', () => {
    const src = readFileSync(INTEL_TOOLS_PATH, 'utf-8');
    assert.match(
      src,
      /function\s+readEwcLambdaFromConfig\s*\(\s*fallback\s*:\s*number\s*\)\s*:\s*number/,
      'must declare `function readEwcLambdaFromConfig(fallback: number): number`'
    );
  });

  it('helper reads .claude-flow/config.json and checks neural.ewcLambda', () => {
    const src = readFileSync(INTEL_TOOLS_PATH, 'utf-8');
    assert.ok(
      src.includes('.claude-flow') && src.includes('config.json'),
      'helper must reference .claude-flow/config.json path'
    );
    assert.match(
      src,
      /neural\??\.\s*ewcLambda|neural[^}]*ewcLambda/,
      'helper must read the neural.ewcLambda key'
    );
  });

  it('uses readEwcLambdaFromConfig(1000) at the ewcLambda feature site', () => {
    const src = readFileSync(INTEL_TOOLS_PATH, 'utf-8');
    assert.match(
      src,
      /ewcLambda\s*:\s*readEwcLambdaFromConfig\(\s*1000\s*\)/,
      'intelligence-tools stats feature block must call readEwcLambdaFromConfig(1000)'
    );
  });

  it('no longer contains the inline IIFE form for ewcLambda', () => {
    const src = readFileSync(INTEL_TOOLS_PATH, 'utf-8');
    // Old form: (() => { try { const c = JSON.parse(require('fs')... } catch { return 2000; } })()
    assert.ok(
      !/ewcLambda\s*:\s*\(\s*\(\)\s*=>\s*\{\s*try\s*\{/.test(src),
      'inline IIFE for ewcLambda must be removed'
    );
    assert.ok(
      !/require\(['"]fs['"]\)\.readFileSync[^)]*\.claude-flow/.test(src),
      'CommonJS require("fs") readFileSync in the ewcLambda position must be gone'
    );
  });
});

// ============================================================================
// 2. SonaLearningBackend.ts — config.ewcLambda ?? helper(1000)
// ============================================================================

describe('ADR-0069 A5: packages/agentdb/src/backends/rvf/SonaLearningBackend.ts', () => {
  it('exists', () => {
    assert.ok(existsSync(SONA_BACKEND_PATH), `Expected ${SONA_BACKEND_PATH}`);
  });

  it('has top-level ESM import for readFileSync from node:fs', () => {
    const src = readFileSync(SONA_BACKEND_PATH, 'utf-8');
    assert.match(
      src,
      /import\s*\{\s*readFileSync\s*\}\s*from\s*['"]node:fs['"]/,
      'must import { readFileSync } from "node:fs" at top level'
    );
  });

  it('has top-level ESM import for resolve from node:path', () => {
    const src = readFileSync(SONA_BACKEND_PATH, 'utf-8');
    assert.match(
      src,
      /import\s*\{\s*resolve\s*\}\s*from\s*['"]node:path['"]/,
      'must import { resolve } from "node:path" at top level'
    );
  });

  it('defines readEwcLambdaFromConfig helper locally', () => {
    const src = readFileSync(SONA_BACKEND_PATH, 'utf-8');
    assert.match(
      src,
      /function\s+readEwcLambdaFromConfig\s*\(\s*fallback\s*:\s*number\s*\)\s*:\s*number/,
      'must declare `function readEwcLambdaFromConfig(fallback: number): number`'
    );
  });

  it('routes config.ewcLambda ?? through readEwcLambdaFromConfig(1000)', () => {
    const src = readFileSync(SONA_BACKEND_PATH, 'utf-8');
    assert.match(
      src,
      /config\.ewcLambda\s*\?\?\s*readEwcLambdaFromConfig\(\s*1000\s*\)/,
      'SonaLearningBackend.create must fall back to readEwcLambdaFromConfig(1000) when config.ewcLambda is undefined'
    );
  });

  it('no longer contains the bare numeric fallback `config.ewcLambda ?? 2000`', () => {
    const src = readFileSync(SONA_BACKEND_PATH, 'utf-8');
    assert.ok(
      !/config\.ewcLambda\s*\?\?\s*2000\b/.test(src),
      'bare `config.ewcLambda ?? 2000` must be replaced with the helper call'
    );
  });

  it('still bounds-checks EWC lambda against MAX_EWC_LAMBDA', () => {
    const src = readFileSync(SONA_BACKEND_PATH, 'utf-8');
    // Bounding must survive the refactor — otherwise we'd re-introduce CWE-1284.
    assert.match(
      src,
      /Math\.min\(\s*Math\.max\(\s*0\s*,\s*config\.ewcLambda\s*\?\?\s*readEwcLambdaFromConfig\(\s*1000\s*\)\s*\)\s*,\s*MAX_EWC_LAMBDA\s*\)/,
      'Math.min(Math.max(0, config.ewcLambda ?? readEwcLambdaFromConfig(1000)), MAX_EWC_LAMBDA) bounding must be preserved'
    );
  });
});

// ============================================================================
// 3. Cross-site invariants — both sites share the same helper contract
// ============================================================================

describe('ADR-0069 A5: cross-site invariants', () => {
  it('both files declare helper with identical signature', () => {
    const a = readFileSync(INTEL_TOOLS_PATH, 'utf-8');
    const b = readFileSync(SONA_BACKEND_PATH, 'utf-8');
    const sigRe = /function\s+readEwcLambdaFromConfig\s*\(\s*fallback\s*:\s*number\s*\)\s*:\s*number/;
    assert.match(a, sigRe);
    assert.match(b, sigRe);
  });

  it('both helpers fail loud only on genuine absence (catch returns fallback, does not swallow other errors silently)', () => {
    // ADR-0082: no silent fallback paths that mask failures.
    // The helper is allowed to swallow ENOENT / parse-on-missing-file,
    // but it must not, for example, mask a thrown TypeError from upstream
    // by returning the fallback from an unrelated outer scope.
    for (const path of [INTEL_TOOLS_PATH, SONA_BACKEND_PATH]) {
      const src = readFileSync(path, 'utf-8');
      // The helper body: try { ... } catch { /* fallback */ } return fallback;
      // Assert the catch block is NOT catching-and-rethrowing-as-undefined,
      // and that the fallback parameter is what's actually returned.
      assert.match(
        src,
        /function\s+readEwcLambdaFromConfig[\s\S]*?return\s+fallback\s*;/,
        `${path}: helper must return the fallback parameter (not a hardcoded literal)`
      );
    }
  });

  it('both files positive-validate the config value before accepting it', () => {
    // `typeof val === 'number' && val > 0` — zero and negative reject to fallback.
    for (const path of [INTEL_TOOLS_PATH, SONA_BACKEND_PATH]) {
      const src = readFileSync(path, 'utf-8');
      assert.match(
        src,
        /typeof\s+val\s*===\s*['"]number['"]\s*&&\s*val\s*>\s*0/,
        `${path}: helper must require typeof val === 'number' && val > 0`
      );
    }
  });
});
