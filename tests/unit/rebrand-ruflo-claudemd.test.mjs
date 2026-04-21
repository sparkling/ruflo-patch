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

  // ADR-0079 scope + T2-6 structure guards (paired with
  // lib/acceptance-structure-checks.sh:check_scope and
  // lib/acceptance-adr0079-tier2-checks.sh:check_t2_6_claudemd_structure).
  //
  // The rebrand replaced every `npx @sparkleideas/cli@latest <cmd>` body
  // invocation with bare `ruflo <cmd>`. The only surviving @sparkleideas
  // reference in the emitted CLAUDE.md is the post-codemod bootstrap line
  // inside `setupAndBoundary()`, so every template MUST include that
  // section — otherwise the acceptance Scope check regresses to 0 hits.
  it('every template wires setupAndBoundary into TEMPLATE_SECTIONS', () => {
    if (source === 'built+codemod dist') {
      // dist JS has the entries inline; accept either bare or arrow-wrapped form
      const templates = ['minimal', 'standard', 'full', 'security', 'performance', 'solo'];
      for (const t of templates) {
        const re = new RegExp(`${t}:\\s*\\[[^\\]]*setupAndBoundary`, 's');
        assert.match(content, re, `template '${t}' must include setupAndBoundary`);
      }
    } else {
      // TS source: assert each template literal key contains setupAndBoundary before its closing ']'
      const templates = ['minimal', 'standard', 'full', 'security', 'performance', 'solo'];
      for (const t of templates) {
        const re = new RegExp(`${t}:\\s*\\[[^\\]]*setupAndBoundary`, 's');
        assert.match(content, re, `template '${t}' must include setupAndBoundary`);
      }
    }
  });

  // Paired with check_scope in lib/acceptance-structure-checks.sh:35-63
  it('full-template output contains >=1 @sparkleideas reference (check_scope invariant)', async () => {
    if (source !== 'built+codemod dist') return;
    const mod = await import(BUILT_JS);
    const out = mod.generateClaudeMd({ runtime: { claudeMdTemplate: 'full' } }, 'full');
    const hits = (out.match(/@sparkleideas/g) ?? []).length;
    assert.ok(hits >= 1, `full template must emit >=1 @sparkleideas ref (codemod proof); got ${hits}`);
  });

  // Paired with check_t2_6_claudemd_structure in lib/acceptance-adr0079-tier2-checks.sh
  it('full-template output satisfies T2-6 structural asserts', async () => {
    if (source !== 'built+codemod dist') return;
    const mod = await import(BUILT_JS);
    const out = mod.generateClaudeMd({ runtime: { claudeMdTemplate: 'full' } }, 'full');
    assert.match(out, /## Behavioral Rules/, 'missing Behavioral Rules');
    assert.match(out, /## File Organization/, 'missing File Organization');
    assert.match(out, /## Build( & Test)?/, 'missing Build section');
    assert.match(out, /@sparkleideas/, 'missing @sparkleideas scope marker');
    assert.ok(!/Task tool/.test(out), 'should NOT contain "Task tool" (should be Agent tool)');
  });

  // Every non-security-focused template should also satisfy scope invariant
  it('every template emits >=1 @sparkleideas reference', async () => {
    if (source !== 'built+codemod dist') return;
    const mod = await import(BUILT_JS);
    for (const tmpl of ['minimal', 'standard', 'full', 'security', 'performance', 'solo']) {
      const out = mod.generateClaudeMd({ runtime: { claudeMdTemplate: tmpl } }, tmpl);
      const hits = (out.match(/@sparkleideas/g) ?? []).length;
      assert.ok(hits >= 1, `template '${tmpl}' must emit >=1 @sparkleideas ref; got ${hits}`);
    }
  });
});
