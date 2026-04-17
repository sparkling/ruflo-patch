// tests/unit/regen-mcp-manifest.test.mjs
//
// Paired unit test for scripts/regen-mcp-manifest.mjs (ADR-0094 Sprint 0 WI-1).
// Covers the pure parser + sanity-guard surface. CLI probing is not exercised
// here — that's an integration concern handled by running `node scripts/regen-
// mcp-manifest.mjs --write` against a real Verdaccio tarball.
//
// London School style: fixture strings stand in for the real CLI output.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  parseMcpToolsJson,
  parseCliHelp,
  parseMcpToolsTable,
  assertToolCountSane,
} from '../../scripts/regen-mcp-manifest.mjs';

// ---- Fixtures ---------------------------------------------------------------

// Mirrors real stdout: `[AgentDB] Telemetry disabled` preamble on stdout,
// then the JSON array. Whitespace-preserved.
const HAPPY_JSON_STDOUT = `[AgentDB] Telemetry disabled
[
  { "name": "agent_spawn",       "category": "agent",   "description": "x", "enabled": true },
  { "name": "agent_list",        "category": "agent",   "description": "x", "enabled": true },
  { "name": "memory_store",      "category": "memory",  "description": "x", "enabled": true },
  { "name": "memory_retrieve",   "category": "memory",  "description": "x", "enabled": true },
  { "name": "hooks_intelligence_trajectory-start", "category": "hooks", "description": "x", "enabled": true }
]
`;

const PREAMBLE_NOISE_STDOUT = `[AgentDB] Telemetry disabled
[INFO] Starting CLI
[AgentDB] Telemetry disabled

[
  { "name": "a_tool", "category": "x", "description": "", "enabled": true },
  { "name": "b_tool", "category": "x", "description": "", "enabled": true }
]
`;

const EMPTY_STDOUT = '';

const NON_JSON_STDOUT = `[AgentDB] Telemetry disabled
Some other stuff, no brackets here at all
`;

const HELP_STDOUT = `[AgentDB] Telemetry disabled

ruflo v3.5.58-patch.136
RuFlo V3 - AI Agent Orchestration Platform

USAGE:
  ruflo <command> [subcommand] [options]

PRIMARY COMMANDS:
  init         Initialize RuFlo in the current directory
  start        Start the RuFlo orchestration system
  agent        Agent management commands
  mcp          MCP server management
  hooks        Self-learning hooks system

ADVANCED COMMANDS:
  neural       Neural pattern training
  security     Security scanning
  hive-mind    Queen-led consensus coordination

UTILITY COMMANDS:
  config       Configuration management
  doctor       System diagnostics
  daemon       Manage background worker daemon

ANALYSIS COMMANDS:
  analyze      Code analysis
  route        Intelligent task-to-agent routing
  progress     Check V3 implementation progress

MANAGEMENT COMMANDS:
  providers    Manage AI providers
  plugins      Plugin management
  deployment   Deployment management
  claims       Claims-based authorization
  issues       Collaborative issue claims
  cleanup      Remove project artifacts

GLOBAL OPTIONS:
  -h, --help                Show help information
  -v, --verbose             Enable verbose output

V3 FEATURES:
  - 15-agent hierarchical mesh coordination
`;

// ---- parseMcpToolsJson ------------------------------------------------------

describe('parseMcpToolsJson', () => {
  it('happy path: strips preamble, returns sorted unique names', () => {
    const names = parseMcpToolsJson(HAPPY_JSON_STDOUT);
    assert.deepEqual(names, [
      'agent_list',
      'agent_spawn',
      'hooks_intelligence_trajectory-start',
      'memory_retrieve',
      'memory_store',
    ]);
  });

  it('tolerates multi-line preamble noise before JSON', () => {
    const names = parseMcpToolsJson(PREAMBLE_NOISE_STDOUT);
    assert.deepEqual(names, ['a_tool', 'b_tool']);
  });

  it('preserves the full truncation-prone name (not the table-truncated stub)', () => {
    const names = parseMcpToolsJson(HAPPY_JSON_STDOUT);
    // The table output would show `hooks_intelligence_tra...`; JSON must keep the full name.
    assert.ok(names.includes('hooks_intelligence_trajectory-start'));
    assert.ok(!names.some(n => n.endsWith('...')), 'no truncated names should leak through');
  });

  it('throws on empty stdout', () => {
    assert.throws(() => parseMcpToolsJson(EMPTY_STDOUT), /no JSON payload/);
  });

  it('throws on non-JSON stdout', () => {
    assert.throws(() => parseMcpToolsJson(NON_JSON_STDOUT), /no JSON payload/);
  });

  it('throws when payload is not an array', () => {
    assert.throws(() => parseMcpToolsJson('{"name":"x"}'), /expected array/);
  });

  it('throws when an entry is missing a name', () => {
    assert.throws(
      () => parseMcpToolsJson('[{"name":"ok"},{"category":"x"}]'),
      /missing\/empty name/,
    );
  });

  it('throws on invalid JSON', () => {
    assert.throws(() => parseMcpToolsJson('[{"name":'), /JSON\.parse failed/);
  });
});

// ---- parseCliHelp -----------------------------------------------------------

describe('parseCliHelp', () => {
  it('extracts subcommands from all five section headers', () => {
    const names = parseCliHelp(HELP_STDOUT);
    // Spot-check one name from each of the five sections.
    assert.ok(names.includes('init'),       'PRIMARY section name missing');
    assert.ok(names.includes('neural'),     'ADVANCED section name missing');
    assert.ok(names.includes('config'),     'UTILITY section name missing');
    assert.ok(names.includes('analyze'),    'ANALYSIS section name missing');
    assert.ok(names.includes('providers'),  'MANAGEMENT section name missing');
  });

  it('does not leak GLOBAL OPTIONS flags (-h, --help, etc.) into subcommands', () => {
    const names = parseCliHelp(HELP_STDOUT);
    assert.ok(!names.some(n => n.startsWith('-')),      'flags must not be parsed as subcommands');
    assert.ok(!names.includes('V3'),                    'V3 FEATURES must be out of scope');
  });

  it('returns sorted + unique', () => {
    const names = parseCliHelp(HELP_STDOUT);
    const sorted = [...names].sort();
    assert.deepEqual(names, sorted, 'output must be sorted');
    assert.equal(new Set(names).size, names.length, 'output must be unique');
  });

  it('handles empty input without crashing', () => {
    assert.deepEqual(parseCliHelp(''), []);
  });

  it('ignores hyphens in name, but keeps hyphenated subcommand names like hive-mind', () => {
    const names = parseCliHelp(HELP_STDOUT);
    assert.ok(names.includes('hive-mind'));
  });
});

// ---- parseMcpToolsTable (fallback, plan-spec regex) -------------------------

describe('parseMcpToolsTable (fallback parser)', () => {
  it('extracts un-truncated names from table rows and filters the Tool header', () => {
    const table = `Agent
  Tool              Description                           Status
  agent_spawn       Spawn a new agent                     Enabled
  agent_terminate   Terminate an agent                    Enabled
  memory_store      Store a value                         Enabled
`;
    const names = parseMcpToolsTable(table);
    assert.ok(!names.includes('Tool'), 'header row must be filtered');
    assert.deepEqual(names, ['agent_spawn', 'agent_terminate', 'memory_store']);
  });

  it('demonstrates the truncation pitfall: rows like `foo_tra...` produce nothing because the regex boundary needs 2+ spaces after the name', () => {
    const table = `  hooks_intelligence_tra...   Begin SONA trajectory       Enabled\n`;
    const names = parseMcpToolsTable(table);
    // This is the whole point of preferring --format json: the table path
    // silently drops truncated rows. If a future CLI removes the `...` suffix
    // this assertion will flip and we can revisit the fallback regex.
    assert.deepEqual(names, [], 'table parser drops truncated rows — documented pitfall');
  });
});

// ---- assertToolCountSane ----------------------------------------------------

describe('assertToolCountSane', () => {
  it('accepts counts within bounds', () => {
    const tools = Array.from({ length: 250 }, (_, i) => `tool_${i}`);
    assert.strictEqual(assertToolCountSane(tools), true);
  });

  it('throws on undershoot (<150 default)', () => {
    const tools = Array.from({ length: 42 }, (_, i) => `tool_${i}`);
    assert.throws(() => assertToolCountSane(tools), /only 42 tools parsed/);
  });

  it('throws on overshoot (>300 default)', () => {
    const tools = Array.from({ length: 999 }, (_, i) => `tool_${i}`);
    assert.throws(() => assertToolCountSane(tools), /999 tools parsed/);
  });

  it('throws on empty tool list (undershoot is loud, not silent)', () => {
    assert.throws(() => assertToolCountSane([]), /only 0 tools parsed/);
  });

  it('throws when input is not an array', () => {
    assert.throws(() => assertToolCountSane(null), /expected array/);
    assert.throws(() => assertToolCountSane('not an array'), /expected array/);
  });

  it('honors custom min/max bounds when provided', () => {
    assert.strictEqual(
      assertToolCountSane(['a', 'b', 'c'], { min: 1, max: 10 }),
      true,
    );
    assert.throws(
      () => assertToolCountSane(['a'], { min: 5, max: 10 }),
      /only 1 tools parsed/,
    );
  });
});

// ---- end-to-end (parsers compose cleanly) -----------------------------------

describe('parsers compose to produce a manifest shape', () => {
  it('JSON tools + help subcommands can be combined into a counts object', () => {
    const tools = parseMcpToolsJson(HAPPY_JSON_STDOUT);
    const subs  = parseCliHelp(HELP_STDOUT);
    const counts = {
      mcp_tools: tools.length,
      cli_subcommands: subs.length,
      total_surfaces: tools.length + subs.length,
    };
    assert.equal(counts.mcp_tools, 5);
    assert.ok(counts.cli_subcommands >= 5);
    assert.equal(counts.total_surfaces, counts.mcp_tools + counts.cli_subcommands);
  });
});
