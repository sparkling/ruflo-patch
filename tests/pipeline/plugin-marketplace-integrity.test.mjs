// @tier pipeline
// ADR-0248 — Plugin marketplace integrity + honesty lint (CT-O).
//
// Sister to umbrella-plugin-brand.test.mjs (ADR-0235): that test
// scans .claude-plugin/ for umbrella-level brand drift. This test
// scans plugins/ for per-plugin integrity:
//
//   1. marketplace.json does NOT mention deleted plugins
//      (F-07-001 — `ruflo-graph-intelligence` removed 2026-05-24).
//   2. No plugin .md / .sh / .json mentions phantom MCP tools
//      (F-07-002 — `embeddings_rabitq_*` were never registered in
//      the central cli registry; removed 2026-05-24).
//   3. forks/ruflo/plugins/ruflo-core/scripts/ruflo-hook.sh exists,
//      is executable, and hooks.json invokes it via
//      ${CLAUDE_PLUGIN_ROOT}; no `claude-flow@alpha` leaks remain.
//      (F-07-004 — upstream shim adoption per ADR swarm review.)
//   4. No plugin .claude-plugin/plugin.json description carries
//      over-promising patterns (F-07-006 + F-07-007 description
//      honesty per ADR-0210 description-honesty principle).
//
// PLUS umbrella-brand reuse: import UMBRELLA_FORBIDDEN_STRINGS from
// the shared helper and apply to every plugin .md/.json — catches
// per-plugin brand drift in the same shape ADR-0235 catches at the
// umbrella level (Pass 7 codemod runs against build temp, not fork
// source; marketplace serves from fork source via git-relative
// `source:` paths in marketplace.json — so per-plugin brand drift
// reaches users directly).
//
// All assertions FAIL RED on any hit — there is NO operator-accept
// path (per [[feedback-no-fallbacks]] and [[feedback-no-squelch-tests]]).

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync, readdirSync, statSync, accessSync, constants } from 'node:fs';
import { join, resolve, dirname, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { UMBRELLA_FORBIDDEN_STRINGS } from './_brand-forbidden.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');

// Fork dir from upstream-branches.json (single source of truth).
const upstream = JSON.parse(
  readFileSync(resolve(ROOT, 'config', 'upstream-branches.json'), 'utf8'),
);
const FORK_RUFLO = upstream.ruflo.dir;
const PLUGINS_DIR = join(FORK_RUFLO, 'plugins');
const MARKETPLACE_JSON = join(FORK_RUFLO, '.claude-plugin', 'marketplace.json');

const skip = !existsSync(PLUGINS_DIR)
  ? `${PLUGINS_DIR} not found — fork not checked out`
  : false;

// === Orthogonal forbidden sets (per-test inline, NOT in shared helper) ===

// F-07-001: plugin tree was deleted 2026-05-24. The literal name in
// any user-facing surface is a regression signal.
const DELETED_PLUGIN_NAMES = ['ruflo-graph-intelligence'];

// F-07-002: phantom MCP tools that were never registered in the
// central cli registry. Substring match catches both bare tool name
// and `mcp__ruflo__<name>` qualified form.
// `embeddings_rabitq` removed per ADR-0294 R3 (2026-06-04): the 3
// embeddings_rabitq_* tools ARE now registered in the cli MCP registry
// (embeddings-tools.ts) and the WASM mirror ships (ADR-0294 B1), so the
// contract ADR / plugin surfaces legitimately name them — the phantom
// guard no longer applies. (Empty = no phantom substrings currently.)
const PHANTOM_TOOL_SUBSTRINGS = [];

// F-07-006 / F-07-007: over-promising patterns. These are forbidden
// in plugin .claude-plugin/plugin.json `description` field; reviewers
// caught them in slice-07 audit.
const OVERCLAIM_DESCRIPTION_PATTERNS = [
  // F-07-007: "112+ MCP tools" framing on neural-trader implied
  // MCP-callable surface that does not exist (the 112 tools are via
  // `npx neural-trader` CLI, not via MCP).
  '112+ MCP tools',
  // ADR-0251 Option D: regression protection for F-07-007 — count-claim
  // variants that the Batch 3 rewrite excised. The honest rewrite's
  // disclaimer ("this plugin does NOT expose neural-trader's CLI tools
  // as MCP-callable") is the contract; any of these phrases reappearing
  // signals the description has regressed.
  '112 MCP tools',
  '112+ tools',
  '112 tools',
  'exposes neural-trader',
  // F-07-006 sibling: "witness chain verification for ... hardware"
  // on iot-cognitum implied hardware-bound enforcement when the
  // plugin only composes memory_* primitives.
  'witness chain verification for Cognitum Seed hardware',
];

// === Walkers ===

function* walkFiles(dir, exts) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name === '.git' || e.name === 'node_modules' || e.name === 'dist') continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      yield* walkFiles(full, exts);
    } else if (e.isFile() && exts.has(extname(e.name))) {
      yield full;
    }
  }
}

function* walkPluginManifests() {
  // Walk every forks/ruflo/plugins/<plugin>/.claude-plugin/plugin.json
  const entries = readdirSync(PLUGINS_DIR, { withFileTypes: true });
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const manifest = join(PLUGINS_DIR, e.name, '.claude-plugin', 'plugin.json');
    if (existsSync(manifest)) yield manifest;
  }
}

// === Assertion 1: deleted-plugin removal ===

describe('ADR-0248 §1 — deleted plugins removed from marketplace + tree', { skip }, () => {
  for (const dead of DELETED_PLUGIN_NAMES) {
    it(`marketplace.json does not list "${dead}"`, () => {
      const raw = readFileSync(MARKETPLACE_JSON, 'utf8');
      assert.ok(
        !raw.includes(dead),
        `marketplace.json still references "${dead}" — F-07-001 regression. ` +
          `The plugin was deleted 2026-05-24 (DOA on marketplace install: cmd=0 sk=0 ag=0). ` +
          `If re-adding intentionally, also: (a) restore the tree at ` +
          `forks/ruflo/plugins/${dead}/, (b) ship at least one command/skill/agent, ` +
          `(c) wire its MCP tools into the central cli registry, (d) publish to ` +
          `Verdaccio, (e) remove this name from DELETED_PLUGIN_NAMES in the lint.`,
      );
    });

    it(`forks/ruflo/plugins/${dead}/ does not exist`, () => {
      const treePath = join(PLUGINS_DIR, dead);
      assert.ok(
        !existsSync(treePath),
        `Plugin tree at ${treePath} should not exist — F-07-001 regression. ` +
          `Re-adding the tree without re-adding the marketplace entry leaves dead ` +
          `directories; re-adding both requires per-plugin disposition per ADR-0210.`,
      );
    });
  }
});

// === Assertion 2: phantom MCP tools removed ===

describe('ADR-0248 §2 — phantom MCP tool references removed from plugin surface', { skip }, () => {
  const SURFACE_EXTS = new Set(['.md', '.sh', '.json']);

  for (const phantom of PHANTOM_TOOL_SUBSTRINGS) {
    it(`zero "${phantom}" substring hits in plugins/**/*.{md,sh,json}`, () => {
      const offenders = [];
      for (const file of walkFiles(PLUGINS_DIR, SURFACE_EXTS)) {
        const content = readFileSync(file, 'utf8');
        if (content.includes(phantom)) {
          const lines = content.split('\n');
          const hits = lines
            .map((line, i) => (line.includes(phantom) ? i + 1 : null))
            .filter((n) => n !== null);
          offenders.push({ file: relative(FORK_RUFLO, file), lines: hits });
        }
      }
      assert.equal(
        offenders.length,
        0,
        `Found ${offenders.length} file(s) referencing phantom MCP tool "${phantom}":\n` +
          offenders.map((o) => `  ${o.file}:${o.lines.join(',')}`).join('\n') +
          `\n\nADR-0248: "${phantom}" tools were never registered in the central ` +
          `cli MCP registry (verified zero hits in v3/@claude-flow/cli/src/mcp-tools/). ` +
          `Per ADR-0210 implement/restore/delete mandate, references were removed ` +
          `2026-05-24. If implementing the tools, also: (a) register them in ` +
          `cli/src/mcp-tools/, (b) remove this substring from PHANTOM_TOOL_SUBSTRINGS, ` +
          `(c) re-introduce skill workflow in vector-search/SKILL.md.`,
      );
    });
  }
});

// === Assertion 3: ruflo-core hook shim wired correctly ===

describe('ADR-0248 §3 — ruflo-core hooks use the resilient shim', { skip }, () => {
  const HOOKS_JSON = join(PLUGINS_DIR, 'ruflo-core', 'hooks', 'hooks.json');
  const SHIM_PATH = join(PLUGINS_DIR, 'ruflo-core', 'scripts', 'ruflo-hook.sh');

  it('scripts/ruflo-hook.sh exists', () => {
    assert.ok(
      existsSync(SHIM_PATH),
      `Resilient hook shim missing at ${SHIM_PATH} — copy from ` +
        `ruvnet/ruflo/plugins/ruflo-core/scripts/ruflo-hook.sh verbatim ` +
        `(F-07-004 adopts the upstream shim per ADR-0248 swarm review).`,
    );
  });

  it('scripts/ruflo-hook.sh is executable', () => {
    try {
      accessSync(SHIM_PATH, constants.X_OK);
    } catch (e) {
      assert.fail(
        `Resilient hook shim at ${SHIM_PATH} is not executable. ` +
          `Run: chmod +x forks/ruflo/plugins/ruflo-core/scripts/ruflo-hook.sh`,
      );
    }
  });

  it('hooks.json does not contain "claude-flow@alpha"', () => {
    const raw = readFileSync(HOOKS_JSON, 'utf8');
    assert.ok(
      !raw.includes('claude-flow@alpha'),
      `forks/ruflo/plugins/ruflo-core/hooks/hooks.json contains "claude-flow@alpha" — ` +
        `F-07-004 regression. The fork's [[ADR-0143]] rebrand requires the ` +
        `resilient shim invocation (\${CLAUDE_PLUGIN_ROOT}/scripts/ruflo-hook.sh) ` +
        `instead of bare \`npx claude-flow@alpha hooks ...\`. Fix: rewrite per the ` +
        `upstream shim invocation pattern.`,
    );
  });

  it('hooks.json invokes the shim via ${CLAUDE_PLUGIN_ROOT}', () => {
    const raw = readFileSync(HOOKS_JSON, 'utf8');
    // Per ADR-0248 Confirmation criterion #3: ≥3 invocations matching the
    // shim pattern (replaces the 3 `claude-flow@alpha` lines at 9, 18, 48).
    const matches = raw.match(/\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/ruflo-hook\.sh/g) || [];
    assert.ok(
      matches.length >= 3,
      `hooks.json must invoke \${CLAUDE_PLUGIN_ROOT}/scripts/ruflo-hook.sh at ` +
        `least 3 times (replacing the 3 brand-flipped hook commands at lines ` +
        `9/18/48). Found ${matches.length}. Apply the upstream shim invocation ` +
        `pattern from ruvnet/ruflo/plugins/ruflo-core/hooks/hooks.json.`,
    );
  });
});

// === Assertion 4: description honesty ===

describe('ADR-0248 §4 — plugin descriptions are honest (no overclaiming)', { skip }, () => {
  // ADR-0299 F1 (D-CROSS-1): the same patterns are forbidden in the
  // top-level .claude-plugin/marketplace.json plugin entries. The C7+C8
  // audit found the iot-cognitum overclaim surviving in marketplace.json
  // because this assertion walked only per-plugin manifests — marketplace
  // descriptions are read at the same install-decision time and must stay
  // synced to the per-plugin honest rewrites.
  for (const pattern of OVERCLAIM_DESCRIPTION_PATTERNS) {
    it(`marketplace.json: no plugin entry description contains "${pattern}"`, () => {
      let parsed;
      try {
        parsed = JSON.parse(readFileSync(MARKETPLACE_JSON, 'utf8'));
      } catch (e) {
        assert.fail(`Failed to parse ${MARKETPLACE_JSON}: ${e.message}`);
      }
      const offenders = [];
      for (const entry of parsed.plugins ?? []) {
        if (typeof entry.description === 'string' && entry.description.includes(pattern)) {
          offenders.push(entry.name ?? '(unnamed)');
        }
      }
      assert.equal(
        offenders.length,
        0,
        `marketplace.json plugin entr(ies) containing over-claiming pattern ` +
          `"${pattern}": ${offenders.join(', ')}\n\nADR-0299 F1 + ADR-0248/0251: ` +
          `sync the marketplace.json description to the plugin's own ` +
          `.claude-plugin/plugin.json honest rewrite.`,
      );
    });
  }

  for (const pattern of OVERCLAIM_DESCRIPTION_PATTERNS) {
    it(`no plugin.json description contains "${pattern}"`, () => {
      const offenders = [];
      for (const manifest of walkPluginManifests()) {
        let parsed;
        try {
          parsed = JSON.parse(readFileSync(manifest, 'utf8'));
        } catch (e) {
          assert.fail(`Failed to parse ${manifest}: ${e.message}`);
        }
        if (typeof parsed.description === 'string' && parsed.description.includes(pattern)) {
          offenders.push(relative(FORK_RUFLO, manifest));
        }
      }
      assert.equal(
        offenders.length,
        0,
        `Found ${offenders.length} plugin.json description(s) containing ` +
          `over-claiming pattern "${pattern}":\n` +
          offenders.map((o) => `  ${o}`).join('\n') +
          `\n\nADR-0248 + ADR-0210: marketplace manifest descriptions are read at ` +
          `install-decision time. The framing "${pattern}" implies a runtime ` +
          `surface the plugin does not deliver. Rewrite to name (i) the actual ` +
          `MCP tool families the skills compose, and (ii) "thought-template" or ` +
          `"workflow scaffold" framing when the implementation is a prose-only ` +
          `LLM scaffold.`,
      );
    });
  }
});

// === Assertion (bonus): umbrella brand drift in per-plugin surfaces ===

describe('ADR-0248 — umbrella brand strings absent from plugins/**', { skip }, () => {
  const SURFACE_EXTS = new Set(['.md', '.json', '.sh']);

  for (const forbidden of UMBRELLA_FORBIDDEN_STRINGS) {
    it(`zero occurrences of ${JSON.stringify(forbidden)} in plugins/`, () => {
      const offenders = [];
      for (const file of walkFiles(PLUGINS_DIR, SURFACE_EXTS)) {
        const content = readFileSync(file, 'utf8');
        if (content.includes(forbidden)) {
          const lines = content.split('\n');
          const hits = lines
            .map((line, i) => (line.includes(forbidden) ? i + 1 : null))
            .filter((n) => n !== null);
          offenders.push({ file: relative(FORK_RUFLO, file), lines: hits });
        }
      }
      assert.equal(
        offenders.length,
        0,
        `Found ${offenders.length} per-plugin file(s) containing forbidden ` +
          `brand string ${JSON.stringify(forbidden)}:\n` +
          offenders.map((o) => `  ${o.file}:${o.lines.join(',')}`).join('\n') +
          `\n\nADR-0248 extends [[ADR-0235]]'s umbrella brand lint to per-plugin ` +
          `paths. Codemod Pass 7 runs against the build temp dir, but the ` +
          `marketplace serves plugins via git-relative \`source: ./plugins/\` ` +
          `paths from fork source directly. So brand drift in per-plugin files ` +
          `reaches users; fix at fork source.`,
      );
    });
  }
});
