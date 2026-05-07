// @tier unit
// ADR-0155 (2026-05-07): init's `.mcp.json` must invoke ruflo via
// `npx -y @sparkleideas/ruflo@latest mcp start`, never via a directly
// resolved global binary path.
//
// Supersedes ADR-0104 §4a — the freshness guarantee beats the
// ~5-8s cold-start optimisation. Pinned-to-global-wrapper has the same
// staleness shape as HM's pinned-npx-cache .mcp.json motivated by
// ADR-0154's "Operational recovery applied" section.
//
// These tests pin the post-ADR-0155 contract by:
//   1. Reading mcp-generator.ts source (structural assertions on the
//      shape of createRufloEntry).
//   2. Importing generateMCPConfig() and asserting the produced
//      .mcp.json object has the expected command/args.
//
// Per `feedback-always-npx-for-ruflo`.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync, statSync } from 'node:fs';

const MCP_GEN_SRC = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/init/mcp-generator.ts';

assert.ok(existsSync(MCP_GEN_SRC), `mcp-generator.ts missing at ${MCP_GEN_SRC}`);

const src = readFileSync(MCP_GEN_SRC, 'utf8');

describe('ADR-0155 — init .mcp.json defaults to npx -y @sparkleideas/ruflo@latest', () => {
  it('createRufloEntry calls createMCPServerEntry with @sparkleideas/ruflo@latest', () => {
    assert.match(
      src,
      /createMCPServerEntry\(\['@sparkleideas\/ruflo@latest', 'mcp', 'start'\]/,
      'createRufloEntry must use the user-facing wrapper @sparkleideas/ruflo@latest (ADR-0143)',
    );
  });

  it('createRufloEntry has no conditional branch for global-binary path', () => {
    // The post-ADR-0155 createRufloEntry is a single-statement return.
    // No `if (rufloPath)`, no `detectRufloPath()` call, no `command: <abs-path>`
    // composition. Match the function body directly.
    const fnMatch = src.match(/function createRufloEntry\([^)]*\)[^{]*\{([\s\S]*?)\n\}/);
    assert.ok(fnMatch, 'createRufloEntry function not found in mcp-generator.ts');
    const body = fnMatch[1];
    assert.doesNotMatch(body, /\bif\s*\(/,
      'createRufloEntry must have no conditional branches per ADR-0155 (single unconditional npx form)');
    assert.doesNotMatch(body, /\bdetectRufloPath\b/,
      'createRufloEntry must not call detectRufloPath per ADR-0155 (function removed)');
    assert.doesNotMatch(body, /command:\s*rufloPath/,
      'createRufloEntry must not return a command: <resolved-path> shape per ADR-0155');
  });

  it('mcp-generator does not run `which`/`where ruflo` at any point', () => {
    // ADR-0104 §4a's detection mechanism is fully removed, not just
    // gated. Match string-literal invocation forms, not bare substrings
    // (which legitimately appear in supersession comments).
    assert.doesNotMatch(src, /['"]which ruflo['"]|['"]where ruflo['"]/,
      'mcp-generator must not invoke `which ruflo` / `where ruflo` per ADR-0155');
    assert.doesNotMatch(src, /from\s+['"]node:child_process['"]/,
      'mcp-generator should not import child_process — execSync was only used by detectRufloPath, which is removed');
  });

  it('generateMCPConfig produces a .mcp.json with command=npx and @sparkleideas/ruflo@latest in args', async (t) => {
    // End-to-end behavioral check: import the dist build and call
    // generateMCPConfig with claudeFlow: true. The resulting object must
    // satisfy ADR-0155's contract.
    const distPath = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/dist/src/init/mcp-generator.js';
    if (!existsSync(distPath)) {
      t.skip('dist not built — structural source assertions above cover the contract');
      return;
    }
    // Skip if dist is older than source — pipeline rebuilds before
    // publishing, but local dev may have a stale dist between source
    // edits. The structural tests above are the primary contract;
    // skipping here avoids false failures when running unit tests after
    // a source edit but before a build.
    if (statSync(distPath).mtimeMs < statSync(MCP_GEN_SRC).mtimeMs) {
      t.skip('dist stale (older than source) — structural tests cover the contract; pipeline rebuilds before publish');
      return;
    }
    const mod = await import(distPath);
    const config = mod.generateMCPConfig({
      mcp: { claudeFlow: true, ruvSwarm: false, flowNexus: false, autoStart: true },
      runtime: { topology: 'mesh', maxAgents: 8, memoryBackend: 'rvf' },
    });

    const ruflo = config.mcpServers.ruflo;
    assert.ok(ruflo, 'mcpServers.ruflo must exist when claudeFlow: true');
    assert.equal(ruflo.command, 'npx',
      'ruflo MCP entry must use command: "npx" per ADR-0155');
    assert.ok(Array.isArray(ruflo.args) && ruflo.args.includes('@sparkleideas/ruflo@latest'),
      'ruflo MCP entry args must include @sparkleideas/ruflo@latest per ADR-0155');
    assert.ok(ruflo.args.includes('-y'),
      'ruflo MCP entry args must include -y (npx auto-confirm)');
    assert.ok(ruflo.args.includes('mcp') && ruflo.args.includes('start'),
      'ruflo MCP entry args must include mcp + start');
  });

  it('regression guard: command field is never an absolute path on Unix', async (t) => {
    // Sanity check: the ADR-0104 §4a footgun was that `command` could be
    // any directly-resolved binary path. Post-ADR-0155, only `npx` (or
    // `cmd` on Windows for the wrapped-npx form) is acceptable.
    const distPath = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/dist/src/init/mcp-generator.js';
    if (!existsSync(distPath)) {
      t.skip('dist not built');
      return;
    }
    if (statSync(distPath).mtimeMs < statSync(MCP_GEN_SRC).mtimeMs) {
      t.skip('dist stale — pipeline rebuilds before publish');
      return;
    }
    const mod = await import(distPath);
    const config = mod.generateMCPConfig({
      mcp: { claudeFlow: true, ruvSwarm: false, flowNexus: false, autoStart: true },
      runtime: { topology: 'mesh', maxAgents: 8, memoryBackend: 'rvf' },
    });

    const ruflo = config.mcpServers.ruflo;
    assert.ok(!ruflo.command.startsWith('/'),
      `ruflo MCP command must not be an absolute path (got "${ruflo.command}") — pinning to a directly-resolved binary is the staleness footgun ADR-0155 closes`);
  });
});
