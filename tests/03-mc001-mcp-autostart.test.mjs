// @tier unit
// Tests for patch/010-MC-001-mcp-autostart — removes autoStart: false from MCP config.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { writeFileSync, readFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPatch } from './helpers/run-python.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const FIX_PY = resolve(ROOT, 'patch', '010-MC-001-mcp-autostart', 'fix.py');

// Minimal mcp-generator.js content simulating the upstream bug
const MCP_GEN_UNPATCHED = `function generateMcpConfig(options, config) {
    const mcpServers = {};
    const npmEnv = { npm_config_update_notifier: 'false' };
    if (config.claudeFlow) {
        mcpServers['claude-flow'] = createMCPServerEntry(['@claude-flow/cli@latest', 'mcp', 'start'], {
            ...npmEnv,
            CLAUDE_FLOW_MODE: 'v3',
            CLAUDE_FLOW_HOOKS_ENABLED: 'true',
            CLAUDE_FLOW_TOPOLOGY: options.runtime.topology,
            CLAUDE_FLOW_MAX_AGENTS: String(options.runtime.maxAgents),
            CLAUDE_FLOW_MEMORY_BACKEND: options.runtime.memoryBackend,
        }, { autoStart: config.autoStart });
    }
    return { mcpServers };
}`;

const MCP_GEN_PATCHED = `function generateMcpConfig(options, config) {
    const mcpServers = {};
    const npmEnv = { npm_config_update_notifier: 'false' };
    if (config.claudeFlow) {
        mcpServers['claude-flow'] = createMCPServerEntry(['@claude-flow/cli@latest', 'mcp', 'start'], {
            ...npmEnv,
            CLAUDE_FLOW_MODE: 'v3',
            CLAUDE_FLOW_HOOKS_ENABLED: 'true',
            CLAUDE_FLOW_TOPOLOGY: options.runtime.topology,
            CLAUDE_FLOW_MAX_AGENTS: String(options.runtime.maxAgents),
            CLAUDE_FLOW_MEMORY_BACKEND: options.runtime.memoryBackend,
        });
    }
    return { mcpServers };
}`;

function createMcpFixture(content) {
  const tmp = mkdtempSync(join(tmpdir(), 'mc001-test-'));
  const base = join(tmp, 'dist', 'src');
  const initDir = join(base, 'init');
  mkdirSync(initDir, { recursive: true });
  writeFileSync(join(initDir, 'mcp-generator.js'), content);
  return { base, tmp, file: join(initDir, 'mcp-generator.js') };
}

describe('MC-001: MCP autoStart patch', () => {
  it('removes autoStart from unpatched mcp-generator.js', () => {
    const { base, tmp, file } = createMcpFixture(MCP_GEN_UNPATCHED);
    try {
      const r = runPatch(FIX_PY, base);
      assert.equal(r.status, 0, `python exited with ${r.status}: ${r.stderr}`);
      assert.match(r.stdout, /Applied: MC-001a/);

      const result = readFileSync(file, 'utf-8');
      assert.ok(!result.includes('autoStart: config.autoStart'), 'autoStart should be removed');
      assert.ok(result.includes('CLAUDE_FLOW_MEMORY_BACKEND: options.runtime.memoryBackend,\n        });'), 'closing should be clean');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('is idempotent — second run skips', () => {
    const { base, tmp } = createMcpFixture(MCP_GEN_UNPATCHED);
    try {
      const r1 = runPatch(FIX_PY, base);
      assert.match(r1.stdout, /1 applied/);

      const r2 = runPatch(FIX_PY, base);
      assert.match(r2.stdout, /0 applied, 1 already present/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('skips when already patched', () => {
    const { base, tmp } = createMcpFixture(MCP_GEN_PATCHED);
    try {
      const r = runPatch(FIX_PY, base);
      assert.match(r.stdout, /0 applied, 1 already present/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('does not corrupt other MCP server entries', () => {
    const content = MCP_GEN_UNPATCHED + `
    if (config.ruvSwarm) {
        mcpServers['ruv-swarm'] = createMCPServerEntry(['ruv-swarm', 'mcp', 'start'], { ...npmEnv }, { optional: true });
    }`;
    const { base, tmp, file } = createMcpFixture(content);
    try {
      runPatch(FIX_PY, base);
      const result = readFileSync(file, 'utf-8');
      assert.ok(result.includes("{ optional: true }"), 'ruv-swarm entry should be untouched');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
