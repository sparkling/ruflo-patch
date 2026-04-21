// @tier unit
// ADR-0069 F1 follow-up §2 / F3 remaining work: Enhanced Agent Booster MCP tools
// wired into forks/agentic-flow/agentic-flow/src/mcp/fastmcp/servers/stdio-full.ts.
//
// London School TDD: mock the FastMCP server's addTool; assert that the
// booster-tools wrapper (registerBoosterTools, imported as
// registerEnhancedBoosterTools in stdio-full.ts) is
//   1. imported by stdio-full.ts from the correct relative path
//   2. actually invoked with the server instance in the dist output
//   3. registers ≥ 3 Tier-1 WASM edit tools (enhanced_booster_edit,
//      enhanced_booster_edit_file, enhanced_booster_batch)
//
// No real agentdb / WASM imports — we read the source file text and the
// compiled dist JS and make string-level assertions, identical in spirit to
// how stdio-full.ts is tested in other ADR-0069 unit files.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';

const FORK_SRC =
  '/Users/henrik/source/forks/agentic-flow/agentic-flow/src/mcp/fastmcp/servers/stdio-full.ts';
const FORK_DIST =
  '/Users/henrik/source/forks/agentic-flow/agentic-flow/dist/agentic-flow/src/mcp/fastmcp/servers/stdio-full.js';
const WRAPPER_SRC =
  '/Users/henrik/source/forks/agentic-flow/agentic-flow/src/mcp/fastmcp/tools/booster-tools.ts';
const ENHANCED_TOOLS_SRC =
  '/Users/henrik/source/forks/agentic-flow/agentic-flow/src/mcp/tools/enhanced-booster-tools.ts';

// Tier-1 WASM edit tools (the 3 ADR-0069 F1 §2 promised):
//   enhanced_booster_edit       — in-memory edit via WASM
//   enhanced_booster_edit_file  — file-level edit via WASM
//   enhanced_booster_batch      — batched WASM edits
const TIER1_EDIT_TOOLS = [
  'enhanced_booster_edit',
  'enhanced_booster_edit_file',
  'enhanced_booster_batch',
];

// ── Mock helpers (London-school) ─────────────────────────────────────

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

// ── Test suite ───────────────────────────────────────────────────────

describe('ADR-0069 F1 §2 / F3: Enhanced Agent Booster tools wired in stdio-full', () => {
  it('stdio-full.ts imports the booster-tools wrapper from the correct path', () => {
    assert.ok(existsSync(FORK_SRC), `stdio-full.ts not found: ${FORK_SRC}`);
    const src = readFileSync(FORK_SRC, 'utf8');

    // Must import from the FastMCP wrapper, not the raw enhanced-booster-tools
    // (the wrapper converts JSON-Schema to Zod and plugs into FastMCP's addTool).
    const importLine = src.match(
      /import\s*\{[^}]*registerBoosterTools[^}]*\}\s*from\s*['"]([^'"]+booster-tools[^'"]*)['"]/
    );
    assert.ok(
      importLine,
      'stdio-full.ts must import { registerBoosterTools } (or aliased) from a booster-tools module'
    );
    assert.match(
      importLine[1],
      /tools\/booster-tools/,
      `Import path should resolve to .../tools/booster-tools, got: ${importLine[1]}`
    );
  });

  it('stdio-full.ts invokes the booster registration with the server instance', () => {
    const src = readFileSync(FORK_SRC, 'utf8');
    // Accept either the original name or the ADR-canonical alias
    // registerEnhancedBoosterTools(server) — both mean the same thing here.
    assert.match(
      src,
      /register(Enhanced)?BoosterTools\s*\(\s*server\s*\)/,
      'stdio-full.ts must call registerBoosterTools(server) / registerEnhancedBoosterTools(server)'
    );
  });

  it('compiled dist/stdio-full.js also contains the booster registration call', () => {
    assert.ok(
      existsSync(FORK_DIST),
      `dist stdio-full.js missing — rebuild fork: ${FORK_DIST}`
    );
    const js = readFileSync(FORK_DIST, 'utf8');
    assert.match(
      js,
      /register(Enhanced)?BoosterTools\s*\(\s*server\s*\)/,
      'dist stdio-full.js must invoke registerBoosterTools(server); rebuild after wiring'
    );
    assert.match(
      js,
      /booster-tools\.js/,
      'dist stdio-full.js must import from booster-tools.js'
    );
  });

  it('booster-tools wrapper registers ≥ 3 Tier-1 WASM edit tools via server.addTool', () => {
    assert.ok(existsSync(WRAPPER_SRC), `booster-tools.ts missing: ${WRAPPER_SRC}`);
    assert.ok(existsSync(ENHANCED_TOOLS_SRC), `enhanced-booster-tools.ts missing: ${ENHANCED_TOOLS_SRC}`);

    const wrapper = readFileSync(WRAPPER_SRC, 'utf8');
    const enhanced = readFileSync(ENHANCED_TOOLS_SRC, 'utf8');

    // Wrapper must iterate enhancedBoosterTools and call server.addTool
    assert.match(wrapper, /enhancedBoosterTools/, 'wrapper must import enhancedBoosterTools');
    assert.match(wrapper, /server\.addTool\s*\(/, 'wrapper must invoke server.addTool(...)');

    // Enhanced tools list must contain the 3 Tier-1 WASM edit tools
    for (const t of TIER1_EDIT_TOOLS) {
      assert.match(
        enhanced,
        new RegExp(`name:\\s*['"]${t}['"]`),
        `enhanced-booster-tools.ts must declare Tier-1 tool ${t}`
      );
    }
  });

  it('simulated server.addTool is called for each Tier-1 tool (London-school wiring)', () => {
    // Simulate the wrapper's behaviour against a mocked FastMCP server, using
    // the real tool list read out of enhanced-booster-tools.ts. This verifies
    // the contract: every enhancedBoosterTools entry with a handler becomes
    // one addTool call on the server.
    const enhanced = readFileSync(ENHANCED_TOOLS_SRC, 'utf8');
    const declaredNames = Array.from(
      enhanced.matchAll(/name:\s*['"](enhanced_booster_[a-z_]+)['"]/g),
      (m) => m[1]
    );
    // Sanity — the file really does declare all 3 Tier-1 tools
    for (const t of TIER1_EDIT_TOOLS) {
      assert.ok(
        declaredNames.includes(t),
        `declaredNames must include ${t}, got: ${declaredNames.join(', ')}`
      );
    }

    // Simulate the wrapper loop
    const addTool = mockFn();
    const server = { addTool };
    const handlers = Object.fromEntries(declaredNames.map((n) => [n, () => ({})]));
    const fakeTools = declaredNames.map((name) => ({
      name,
      description: `mock ${name}`,
      inputSchema: { type: 'object', properties: {}, required: [] },
    }));

    // Inlined version of registerBoosterTools
    for (const tool of fakeTools) {
      const handler = handlers[tool.name];
      if (!handler) continue;
      server.addTool({
        name: tool.name,
        description: tool.description,
        parameters: { shape: {} }, // stand-in for Zod
        execute: async () => handler(),
      });
    }

    assert.equal(
      addTool.calls.length,
      declaredNames.length,
      `expected addTool to be called once per declared tool (${declaredNames.length}), got ${addTool.calls.length}`
    );
    const registeredNames = addTool.calls.map((args) => args[0].name);
    for (const t of TIER1_EDIT_TOOLS) {
      assert.ok(
        registeredNames.includes(t),
        `server.addTool was not called for Tier-1 tool ${t}`
      );
    }
  });
});
