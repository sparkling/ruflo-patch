/**
 * ADR-0006 follow-up (2026-04-21): CLAUDE.md template rebrand to `ruflo`.
 *
 * Asserts the built, post-codemod CLAUDE.md generator embeds short `ruflo <cmd>`
 * invocations rather than the verbose `npx @claude-flow/cli@latest <cmd>` form,
 * while preserving:
 *   - MCP server name `claude-flow` (different identifier)
 *   - MCP tool prefix `mcp__claude-flow__`
 *   - The one-time bootstrap `claude mcp add claude-flow -- npx -y ...` line
 *   - Header `# Claude Code Configuration - RuFlo V3`
 *
 * Strategy: prefer the built+codemod'd dist at
 *   /tmp/ruflo-build/v3/@claude-flow/cli/dist/src/init/claudemd-generator.js
 * (exercises the actual published output). Fall back to the fork TS source if
 * the build dir has not been materialised — fallback is documented, not silent.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Post-codemod built JS (preferred)
const BUILT_JS = '/tmp/ruflo-build/v3/@claude-flow/cli/dist/src/init/claudemd-generator.js';

// Fallback: pre-codemod TS source
const FORK_TS = join(
  __dirname,
  '../../../forks/ruflo/v3/@claude-flow/cli/src/init/claudemd-generator.ts'
);

describe('ADR-0006 follow-up: CLAUDE.md template — ruflo rebrand', () => {
  let content;
  let source;

  beforeAll(() => {
    if (existsSync(BUILT_JS)) {
      content = readFileSync(BUILT_JS, 'utf8');
      source = 'built+codemod dist';
    } else {
      // Explicit fallback — surfaced in test output, not silent.
      // The pre-codemod TS still has `@claude-flow/cli@latest` in the
      // bootstrap line; all other `npx` invocations were rewritten to `ruflo`.
      content = readFileSync(FORK_TS, 'utf8');
      source = 'pre-codemod fork TS source (fallback)';
      // eslint-disable-next-line no-console
      console.warn(
        `[rebrand-ruflo-claudemd] Using fallback source: ${source}. ` +
        `Run 'bash scripts/copy-source.sh && node scripts/codemod.mjs /tmp/ruflo-build' ` +
        `to exercise post-codemod output.`
      );
    }
  });

  it('contains at least 5 bare `ruflo ` command invocations', () => {
    const matches = content.match(/\bruflo [a-z]/g) ?? [];
    // Reports actual count to help debugging in CI.
    expect(matches.length, `source=${source}, matches=${matches.length}`).toBeGreaterThanOrEqual(5);
  });

  it('has NO `npx @claude-flow/cli@latest` invocations (pre-codemod gate only)', () => {
    // This assertion is meaningful when source === fork TS (fallback).
    // Post-codemod the scope is @sparkleideas, so the literal won't appear.
    if (source === 'pre-codemod fork TS source (fallback)') {
      const bareClaudeFlow = content.match(/npx @claude-flow\/cli@latest/g) ?? [];
      expect(bareClaudeFlow.length, 'body should have no @claude-flow/cli@latest except bootstrap').toBe(0);
    } else {
      // Post-codemod: no @claude-flow/cli should remain anywhere after codemod.
      expect(content).not.toMatch(/@claude-flow\/cli/);
    }
  });

  it('has NO `npx @sparkleideas/cli@latest <cmd>` body invocations (only bootstrap)', () => {
    // Only the bootstrap `claude mcp add claude-flow -- npx -y @sparkleideas/cli@latest`
    // should carry the verbose scoped form. Every other usage must be bare `ruflo`.
    // This assertion only runs when we have post-codemod content.
    if (source !== 'built+codemod dist') return;

    // Strip the bootstrap line, then assert no remaining scoped invocations.
    const withoutBootstrap = content
      .split('\n')
      .filter(line => !line.includes('claude mcp add'))
      .join('\n');

    const leftovers = withoutBootstrap.match(/npx @sparkleideas\/cli@latest/g) ?? [];
    expect(leftovers.length, 'no @sparkleideas/cli@latest invocations outside bootstrap').toBe(0);
  });

  it('preserves the one-time bootstrap `claude mcp add claude-flow` line', () => {
    expect(content).toMatch(/claude mcp add claude-flow -- npx -y @(claude-flow|sparkleideas)\/cli@latest/);
  });

  it('preserves `mcp__claude-flow__` tool prefixes (MCP server identifier is NOT rebranded)', () => {
    expect(content).toMatch(/mcp__claude-flow__/);
  });

  it('preserves `ToolSearch("claude-flow ...")` MCP discovery examples', () => {
    // The MCP server name `claude-flow` inside ToolSearch strings stays as-is.
    expect(content).toMatch(/ToolSearch\(['"]claude-flow/);
  });

  it('keeps the canonical RuFlo V3 header', () => {
    expect(content).toMatch(/Claude Code Configuration - RuFlo V3/);
  });
});
