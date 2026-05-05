// @tier unit
// ADR-0136: Init-generated CLAUDE.md must be AI-instruction, not user-onboarding.
// Asserts the 6 content-shape acceptance criteria against the fork TS source.
// These are pre-codemod gates; the brand/codemod sweep is covered by
// rebrand-ruflo-claudemd.test.mjs.

import { describe, it, before } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FORK_TS = join(__dirname, '../../../forks/ruflo/v3/@claude-flow/cli/src/init/claudemd-generator.ts');

// Renders one of the post-codemod templates by extracting and concatenating the
// section function bodies referenced in the TEMPLATE_SECTIONS map for a given
// template name. We don't import the module (it's TS); we do a string-level
// extraction that's robust to template additions.
function renderTemplate(source, templateName) {
  // Find TEMPLATE_SECTIONS[templateName]: [...] block
  const re = new RegExp(`${templateName}:\\s*\\[([\\s\\S]*?)\\],`);
  const m = source.match(re);
  if (!m) throw new Error(`template ${templateName} not found in TEMPLATE_SECTIONS`);
  const block = m[1];
  // Pull out the bare identifiers / arrow-call expressions
  const fnNames = [...block.matchAll(/(?:^|[\s,])(?:\(_opts\)\s*=>\s*)?([a-zA-Z_]+)\(?(?:[^)]*\)?)?/gm)]
    .map(x => x[1])
    .filter(n => n && !['opts', 'options', '_opts'].includes(n));
  const out = [];
  for (const name of fnNames) {
    const bodyRe = new RegExp(`function ${name}\\s*\\([^)]*\\)\\s*:\\s*string\\s*\\{[\\s\\S]*?return\\s+\`([\\s\\S]*?)\`;\\s*\\}`);
    const bm = source.match(bodyRe);
    if (bm) {
      // Unescape backslash-escaped backticks/dollar-braces
      const txt = bm[1].replace(/\\`/g, '`').replace(/\\\$/g, '$');
      out.push(txt);
    }
  }
  return out.join('\n\n');
}

describe('ADR-0136: AI-relevance acceptance criteria for init-generated CLAUDE.md', () => {
  let source;
  let standardOut;
  let fullOut;

  before(() => {
    if (!existsSync(FORK_TS)) {
      throw new Error(`fork TS source missing at ${FORK_TS}`);
    }
    source = readFileSync(FORK_TS, 'utf8');
    standardOut = renderTemplate(source, 'standard');
    fullOut = renderTemplate(source, 'full');
  });

  it('AC1: marketplace / plugin install / npm install appear ONLY inside ## Plugin Installation Rule (standard)', () => {
    const sections = standardOut.split(/^## /m).map(s => '## ' + s);
    for (const sec of sections) {
      if (sec.startsWith('## Plugin Installation Rule')) continue;
      assert.ok(!/marketplace/i.test(sec), `marketplace appears outside install rule: section starts ${sec.slice(0, 60)}`);
      assert.ok(!/plugin install/i.test(sec), `plugin install appears outside install rule: ${sec.slice(0, 60)}`);
      assert.ok(!/npm install/i.test(sec), `npm install appears outside install rule: ${sec.slice(0, 60)}`);
    }
  });

  it('AC2: ZERO product-marketing language', () => {
    const banned = [/\bcomprehensive\b/i, /\bpowerful\b/i, /\bextensive\b/i, /\b\d+x\s+faster\b/i];
    for (const pat of banned) {
      assert.ok(!pat.test(standardOut), `standard contains banned marketing term: ${pat}`);
      assert.ok(!pat.test(fullOut), `full contains banned marketing term: ${pat}`);
    }
  });

  it('AC3: ZERO catalog enumerations longer than 5 items inline', () => {
    // A bullet-list under a heading whose body is ≥6 bare identifiers in code-spans
    // and no decision/comparison shape is a catalog. Approximation: count consecutive
    // `\`item\`` tokens not followed by | (table) within a single bullet.
    const lines = standardOut.split('\n');
    let inListBlock = false;
    let runIdent = 0;
    for (const ln of lines) {
      const isBullet = /^[\s-*]+/.test(ln);
      if (!isBullet) { inListBlock = false; runIdent = 0; continue; }
      const codeSpans = ln.match(/`[a-zA-Z][\w-]+`/g) ?? [];
      if (codeSpans.length >= 6 && !ln.includes('|')) {
        assert.fail(`AC3 violated: bullet line lists ${codeSpans.length} bare identifiers without decision shape: ${ln.slice(0, 100)}`);
      }
    }
  });

  it('AC4: contains at least one decision-tree table (When X → Use Y)', () => {
    // ADR-0136 Q1 resolved: whenToUseWhat() deleted. The remaining decision
    // tables are toolSelectionRules ("You need to...") and the new
    // agentOrchestration table ("Situation | Use | Never").
    const hasDecisionTable = /\|\s*You need to\.{3}\s*\|/m.test(standardOut)
      || /\|\s*Situation\s*\|\s*Use\s*\|\s*Never\s*\|/m.test(standardOut);
    assert.ok(hasDecisionTable, 'standard must contain at least one decision-tree table');
  });

  it('AC5: zero rules that restate tool JSONSchema descriptions', () => {
    // Heuristic: lines that appear to restate Skill/Grep/Bash usage rules
    // (the user-asked rules from previous review). We scan for specific phrases
    // already present in tool descriptions.
    const restated = [
      /never guess.*skill name/i,
      /skill (already|has been) loaded.*don.t (re-?invoke|call)/i,
      /search the codebase.*Grep|Glob/i,
    ];
    for (const pat of restated) {
      assert.ok(!pat.test(standardOut), `standard restates tool description rule: ${pat}`);
    }
  });

  it('AC6: standard reaches a working tool for "scan code for security issues" via discovery', () => {
    // The AI must be able to navigate to either a security agent OR a security
    // discovery command without USERGUIDE re-read. Acceptance: standard mentions
    // EITHER `security-auditor` agent name (for direct invoke) OR a `ruflo`
    // CLI/discovery command relevant to security.
    const hasAgentRoute = /security-architect|security-auditor/i.test(standardOut);
    const hasCliRoute = /ruflo security/i.test(standardOut);
    const hasPluginRoute = /ruflo plugins/i.test(standardOut);
    assert.ok(
      hasAgentRoute || hasCliRoute || hasPluginRoute,
      'standard must offer at least one navigable route for security-issue discovery'
    );
  });

  it('Plugin Install Rule section is present in standard and full', () => {
    assert.match(standardOut, /## Plugin Installation Rule/);
    assert.match(fullOut, /## Plugin Installation Rule/);
  });

  it('Tool Selection Rules section is present in standard and full', () => {
    assert.match(standardOut, /## Tool Selection Rules/);
    assert.match(fullOut, /## Tool Selection Rules/);
  });

  it('Reference Pointers section is present in standard and full', () => {
    assert.match(standardOut, /## Reference Pointers/);
    assert.match(fullOut, /## Reference Pointers/);
  });

  it('uses mcp__ruflo__ namespace (post ADR-0117), not mcp__claude-flow__', () => {
    assert.ok(!/mcp__claude-flow__/.test(standardOut), 'standard should not reference mcp__claude-flow__');
    assert.ok(!/mcp__claude-flow__/.test(fullOut), 'full should not reference mcp__claude-flow__');
    assert.match(standardOut, /mcp__ruflo__/);
  });

  it('dead agentTypes() and memoryCommands() functions are removed from source', () => {
    assert.ok(!/^function agentTypes\b/m.test(source), 'agentTypes() should be removed');
    assert.ok(!/^function memoryCommands\b/m.test(source), 'memoryCommands() should be removed');
  });

  it('Q1: whenToUseWhat() function deleted (rows redundant with agentOrchestration + toolSelectionRules)', () => {
    assert.ok(!/^function whenToUseWhat\b/m.test(source), 'whenToUseWhat() should be removed (ADR-0136 Q1)');
    // No template composer should wire it (matches `(_opts) => whenToUseWhat()`).
    assert.ok(!/=>\s*whenToUseWhat\(\)/.test(source), 'no template composer should wire whenToUseWhat');
    assert.ok(!/## When to Use What/.test(standardOut), 'standard must not contain "When to Use What" section');
    assert.ok(!/## When to Use What/.test(fullOut), 'full must not contain "When to Use What" section');
  });

  it('Q1: agentOrchestration is now a 4-row decision table (not prose)', () => {
    const agentSec = standardOut.split(/^## /m).find(s => s.startsWith('Agent Orchestration'));
    assert.ok(agentSec, 'standard must contain Agent Orchestration section');
    assert.match(agentSec, /\|\s*Situation\s*\|\s*Use\s*\|\s*Never\s*\|/, 'Agent Orchestration must be a Situation/Use/Never table');
    // Body should be terser than the old 22-line prose.
    const bodyLines = agentSec.split('\n').filter(l => l.trim()).length;
    assert.ok(bodyLines < 12, `Agent Orchestration should be ~6 lines, got ${bodyLines}`);
  });

  it('Q2: init CLI Next-steps block contains plugin and skill discovery hints', () => {
    const initPath = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/commands/init.ts';
    const initSrc = readFileSync(initPath, 'utf8');
    assert.match(initSrc, /Discover plugins:\s*\$\{output\.highlight\(['"]ruflo plugins --help/);
    assert.match(initSrc, /Discover skills:\s*\$\{output\.highlight\(['"]ruflo skill list/);
  });

  it('Q3: securitySection / performanceSection use --help pointers, not flag-syntax bash blocks', () => {
    // The fenced `ruflo security scan --depth full` block was the violation.
    // The replacement is a `ruflo security --help` pointer.
    assert.ok(!/ruflo security scan --depth full/.test(source),
      'flag-syntax bash block in securitySection should be replaced by --help pointer');
    assert.ok(!/ruflo performance benchmark --suite all/.test(source),
      'flag-syntax bash block in performanceSection should be replaced by --help pointer');
    assert.match(source, /Security CLI:.*ruflo security --help/);
    assert.match(source, /Performance CLI:.*ruflo performance --help/);
    // Agent lists + routing codes preserved (decision data, not catalogs).
    assert.match(source, /security-architect.*threat modeling/);
    assert.match(source, /agent routing code 9/);
  });

  it('Issue 2: hive-mind decision row uses mcp__ruflo__ prefix (not bare hive-mind_spawn)', () => {
    const tsr = standardOut.split(/^## /m).find(s => s.startsWith('Tool Selection Rules'));
    assert.ok(tsr, 'standard must contain Tool Selection Rules');
    assert.match(tsr, /mcp__ruflo__hive-mind_spawn/, 'hive-mind row must use mcp__ruflo__ prefix');
  });
});
