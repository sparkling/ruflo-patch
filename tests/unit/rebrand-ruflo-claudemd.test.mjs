/**
 * ADR-0006 follow-up (2026-04-21): CLAUDE.md template rebrand to `ruflo`.
 *
 * Asserts the built, post-codemod CLAUDE.md generator embeds short `ruflo <cmd>`
 * invocations rather than the verbose `npx @claude-flow/cli@latest <cmd>` form,
 * while preserving MCP server name + tool prefix + bootstrap line + header.
 *
 * Prefers post-codemod built dist at
 *   /tmp/ruflo-build/v3/@claude-flow/cli/dist/src/init/claudemd-generator.js
 * and falls back to fork TS source if the build dir is absent.
 */
import { describe, it, before } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUILT_JS = '/tmp/ruflo-build/v3/@claude-flow/cli/dist/src/init/claudemd-generator.js';
const FORK_TS = join(__dirname, '../../../forks/ruflo/v3/@claude-flow/cli/src/init/claudemd-generator.ts');

describe('ADR-0006 follow-up: CLAUDE.md template — ruflo rebrand', () => {
  let content;
  let source;

  before(() => {
    if (existsSync(BUILT_JS)) {
      content = readFileSync(BUILT_JS, 'utf8');
      source = 'built+codemod dist';
    } else {
      content = readFileSync(FORK_TS, 'utf8');
      source = 'pre-codemod fork TS source (fallback)';
      console.warn(`[rebrand-ruflo-claudemd] Using fallback source: ${source}.`);
    }
  });

  it('contains at least 5 bare `ruflo ` command invocations', () => {
    const matches = content.match(/\bruflo [a-z]/g) ?? [];
    assert.ok(matches.length >= 5, `source=${source}, matches=${matches.length}`);
  });

  it('has NO `npx @claude-flow/cli@latest` invocations (pre-codemod gate only)', () => {
    if (source === 'pre-codemod fork TS source (fallback)') {
      const bareClaudeFlow = content.match(/npx @claude-flow\/cli@latest/g) ?? [];
      assert.equal(bareClaudeFlow.length, 0, 'body should have no @claude-flow/cli@latest except bootstrap');
    } else {
      assert.ok(!/@claude-flow\/cli/.test(content), 'post-codemod should not contain @claude-flow/cli');
    }
  });

  it('has NO `npx @sparkleideas/cli@latest <cmd>` body invocations (only bootstrap)', () => {
    if (source !== 'built+codemod dist') return;
    const withoutBootstrap = content.split('\n').filter(line => !line.includes('claude mcp add')).join('\n');
    const leftovers = withoutBootstrap.match(/npx @sparkleideas\/cli@latest/g) ?? [];
    assert.equal(leftovers.length, 0, 'no @sparkleideas/cli@latest invocations outside bootstrap');
  });

  it('preserves the one-time bootstrap `claude mcp add claude-flow` line', () => {
    assert.match(content, /claude mcp add claude-flow -- npx -y @(claude-flow|sparkleideas)\/cli@latest/);
  });

  it('preserves `mcp__claude-flow__` tool prefixes (MCP server identifier NOT rebranded)', () => {
    assert.match(content, /mcp__claude-flow__/);
  });

  it('preserves `ToolSearch("claude-flow ...")` MCP discovery examples', () => {
    assert.match(content, /ToolSearch\(['"]claude-flow/);
  });

  it('keeps the canonical RuFlo V3 header', () => {
    assert.match(content, /Claude Code Configuration - RuFlo V3/);
  });
});
