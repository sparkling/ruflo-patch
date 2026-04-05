// @tier unit
// ADR-0069 A2: Rate Limiter Config Chain Bypass Remediation
// London School TDD: tests that rate-limiter-config.ts reads from config chain
// and that each singleton site uses getRateLimitPreset() instead of hardcoded values.

import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

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
// Source file paths (relative to fork root)
// ============================================================================

const FORK_ROOT = '/Users/henrik/source/forks/agentic-flow';
// agentic-flow has a nested agentic-flow/ subdir for the main source
const AF_SRC = join(FORK_ROOT, 'agentic-flow', 'src');
const AGENTDB_SRC = join(FORK_ROOT, 'packages', 'agentdb', 'src');

// ============================================================================
// Test 1: rate-limiter-config.ts exists and exports expected functions
// ============================================================================

describe('ADR-0069 A2: rate-limiter-config.ts module', () => {
  const configFile = join(AF_SRC, 'config', 'rate-limiter-config.ts');

  it('exists at expected path', () => {
    assert.ok(existsSync(configFile), `Expected ${configFile} to exist`);
  });

  it('exports getRateLimiterPresets function', () => {
    const src = readFileSync(configFile, 'utf-8');
    assert.ok(
      src.includes('export function getRateLimiterPresets'),
      'Should export getRateLimiterPresets'
    );
  });

  it('exports getRateLimitPreset function', () => {
    const src = readFileSync(configFile, 'utf-8');
    assert.ok(
      src.includes('export function getRateLimitPreset'),
      'Should export getRateLimitPreset'
    );
  });

  it('defines all 5 fallback presets (default, auth, tools, memory, files)', () => {
    const src = readFileSync(configFile, 'utf-8');
    for (const key of ['default', 'auth', 'tools', 'memory', 'files']) {
      assert.ok(
        src.includes(`${key}:`),
        `Should define fallback preset for '${key}'`
      );
    }
  });

  it('reads from .claude-flow/config.json (project-level)', () => {
    const src = readFileSync(configFile, 'utf-8');
    assert.ok(
      src.includes('.claude-flow') && src.includes('config.json'),
      'Should reference .claude-flow/config.json in config chain'
    );
  });

  it('reads from ~/.claude-flow/config.json (user-level)', () => {
    const src = readFileSync(configFile, 'utf-8');
    assert.ok(
      src.includes('homedir()'),
      'Should use homedir() for user-level config lookup'
    );
  });

  it('has backward-compatible fallback values matching pre-A2 defaults', () => {
    const src = readFileSync(configFile, 'utf-8');
    // The FALLBACK_PRESETS should contain the original hardcoded values
    assert.ok(src.includes('maxRequests: 100'), 'default maxRequests should be 100');
    assert.ok(src.includes('maxRequests: 10'), 'tools/auth maxRequests should be 10');
    assert.ok(src.includes('maxRequests: 50'), 'files maxRequests should be 50');
    assert.ok(src.includes('windowMs: 60000'), 'windowMs should be 60000');
  });

  it('exports _resetRateLimiterCache for testing', () => {
    const src = readFileSync(configFile, 'utf-8');
    assert.ok(
      src.includes('export function _resetRateLimiterCache'),
      'Should export _resetRateLimiterCache for testing'
    );
  });
});

// ============================================================================
// Test 2: security/rate-limiter.ts uses config chain
// ============================================================================

describe('ADR-0069 A2: security/rate-limiter.ts config chain', () => {
  const file = join(AF_SRC, 'security', 'rate-limiter.ts');
  let src;

  beforeEach(() => {
    src = readFileSync(file, 'utf-8');
  });

  it('imports getRateLimitPreset from config module', () => {
    assert.ok(
      src.includes("import { getRateLimitPreset }"),
      'Should import getRateLimitPreset'
    );
  });

  it('has ADR-0069 A2 annotation', () => {
    assert.ok(
      src.includes('ADR-0069 A2'),
      'Should have ADR-0069 A2 annotation'
    );
  });

  it('orchestrationLimiter reads from config chain (tools preset)', () => {
    assert.ok(
      src.includes("getRateLimitPreset('tools')"),
      'orchestrationLimiter should use tools preset'
    );
    // Should NOT contain the old hardcoded pattern for this limiter
    const orchestrationBlock = src.slice(
      src.indexOf('orchestrationLimiter'),
      src.indexOf('memoryOperationLimiter')
    );
    assert.ok(
      orchestrationBlock.includes('_toolsPreset'),
      'Should use _toolsPreset variable'
    );
  });

  it('memoryOperationLimiter reads from config chain (memory preset)', () => {
    assert.ok(
      src.includes("getRateLimitPreset('memory')"),
      'memoryOperationLimiter should use memory preset'
    );
  });

  it('fileOperationLimiter reads from config chain (files preset)', () => {
    assert.ok(
      src.includes("getRateLimitPreset('files')"),
      'fileOperationLimiter should use files preset'
    );
  });
});

// ============================================================================
// Test 3: mcp/middleware/rate-limiter.ts uses config chain
// ============================================================================

describe('ADR-0069 A2: mcp/middleware/rate-limiter.ts config chain', () => {
  const file = join(AF_SRC, 'mcp', 'middleware', 'rate-limiter.ts');
  let src;

  beforeEach(() => {
    src = readFileSync(file, 'utf-8');
  });

  it('imports getRateLimitPreset from config module', () => {
    assert.ok(
      src.includes("import { getRateLimitPreset }"),
      'Should import getRateLimitPreset'
    );
  });

  it('constructor uses config chain for defaults', () => {
    assert.ok(
      src.includes("getRateLimitPreset('default')"),
      'Constructor should resolve defaults from config chain'
    );
  });

  it('defaultRateLimiter singleton uses config chain', () => {
    // The singleton block should reference config preset, not hardcoded 100
    const singletonBlock = src.slice(
      src.indexOf('defaultRateLimiter'),
      src.indexOf('criticalRateLimiter')
    );
    assert.ok(
      singletonBlock.includes('_defaultCfg'),
      'defaultRateLimiter should use _defaultCfg from config chain'
    );
  });

  it('criticalRateLimiter singleton uses config chain (auth preset)', () => {
    assert.ok(
      src.includes("getRateLimitPreset('auth')"),
      'criticalRateLimiter should use auth preset'
    );
    const criticalBlock = src.slice(src.indexOf('criticalRateLimiter'));
    assert.ok(
      criticalBlock.includes('_authCfg'),
      'criticalRateLimiter should use _authCfg from config chain'
    );
  });
});

// ============================================================================
// Test 4: sdk/security.ts uses config chain
// ============================================================================

describe('ADR-0069 A2: sdk/security.ts config chain', () => {
  const file = join(AF_SRC, 'sdk', 'security.ts');
  let src;

  beforeEach(() => {
    src = readFileSync(file, 'utf-8');
  });

  it('imports getRateLimitPreset from config module', () => {
    assert.ok(
      src.includes("import { getRateLimitPreset }"),
      'Should import getRateLimitPreset'
    );
  });

  it('getDefaultSecurityContext uses config chain for rateLimit', () => {
    assert.ok(
      src.includes("getRateLimitPreset('default')"),
      'getDefaultSecurityContext should use config chain for rateLimit defaults'
    );
  });

  it('does NOT hardcode maxRequests: 100 in getDefaultSecurityContext rateLimit', () => {
    // Find the getDefaultSecurityContext function body
    const fnStart = src.indexOf('getDefaultSecurityContext');
    const fnBody = src.slice(fnStart, src.indexOf('}', src.indexOf('rateLimit', fnStart) + 50));
    // The rateLimit property should use getRateLimitPreset, not literal 100
    assert.ok(
      fnBody.includes('getRateLimitPreset'),
      'rateLimit should use getRateLimitPreset, not hardcoded values'
    );
  });
});

// ============================================================================
// Test 5: QUICServer.ts aligned default
// ============================================================================

describe('ADR-0069 A2: QUICServer.ts config chain alignment', () => {
  const file = join(AGENTDB_SRC, 'controllers', 'QUICServer.ts');
  let src;

  beforeEach(() => {
    src = readFileSync(file, 'utf-8');
  });

  it('has ADR-0069 A2 annotation', () => {
    assert.ok(
      src.includes('ADR-0069 A2'),
      'Should have ADR-0069 A2 annotation'
    );
  });

  it('default maxRequestsPerMinute is 100 (aligned with other limiters)', () => {
    assert.ok(
      src.includes('maxRequestsPerMinute: 100'),
      'QUICServer should default to 100 requests/min (aligned with others)'
    );
    assert.ok(
      !src.includes('maxRequestsPerMinute: 60'),
      'Old default of 60 should be removed'
    );
  });
});

// ============================================================================
// Test 6: agentdb limits.ts has intentional-difference annotation
// ============================================================================

describe('ADR-0069 A2: agentdb limits.ts annotation', () => {
  const file = join(AGENTDB_SRC, 'security', 'limits.ts');
  let src;

  beforeEach(() => {
    src = readFileSync(file, 'utf-8');
  });

  it('has ADR-0069 A2 annotation explaining intentional difference', () => {
    assert.ok(
      src.includes('ADR-0069 A2'),
      'Should have ADR-0069 A2 annotation'
    );
    assert.ok(
      src.includes('intentionally per-second'),
      'Should explain that per-second granularity is intentional'
    );
  });
});

// ============================================================================
// Test 7: agentdb rate-limit.middleware.ts has intentional-difference annotation
// ============================================================================

describe('ADR-0069 A2: agentdb rate-limit.middleware.ts annotation', () => {
  const file = join(AGENTDB_SRC, 'middleware', 'rate-limit.middleware.ts');
  let src;

  beforeEach(() => {
    src = readFileSync(file, 'utf-8');
  });

  it('has ADR-0069 A2 annotation explaining intentional difference', () => {
    assert.ok(
      src.includes('ADR-0069 A2'),
      'Should have ADR-0069 A2 annotation'
    );
    assert.ok(
      src.includes('intentionally HTTP middleware'),
      'Should explain that HTTP middleware windows are intentional'
    );
  });
});
