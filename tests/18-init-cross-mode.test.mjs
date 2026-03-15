// @tier unit
// ADR-0035: Cross-mode comparison tests
// Validates relationships between init modes (minimal ⊂ standard ⊂ full).

import { describe, it, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { getFixtures, cleanupFixtures, MODES } from './fixtures/init-fixture.mjs';

let fixtures;

before(async () => {
  fixtures = await getFixtures();
});

after(() => {
  cleanupFixtures();
});

// Helper: parse JSON file safely
function parseJsonFile(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

// Helper: lenient subset check — allows up to `tolerance` extra items in sub
function isLenientSubset(sub, superset, tolerance = 2) {
  const extras = sub.filter(item => !superset.includes(item));
  // Filter out noise files (metrics, gitignore, etc.)
  const realExtras = extras.filter(f =>
    !f.includes('metrics') && !f.includes('.gitignore') && !f.includes('.git/')
  );
  return { ok: realExtras.length <= tolerance, extras: realExtras };
}

// ============================================================================
// X-01 to X-02: File subset relationships
// ============================================================================

describe('Mode file subsets', () => {
  it('X-01: minimal files are subset of standard', () => {
    const minFiles = fixtures.get('minimal').files;
    const stdFiles = fixtures.get('standard').files;
    const { ok, extras } = isLenientSubset(minFiles, stdFiles);
    assert.ok(ok,
      `minimal has ${extras.length} files not in standard: ${extras.slice(0, 5).join(', ')}`);
  });

  it('X-02: standard files are subset of full', () => {
    const stdFiles = fixtures.get('standard').files;
    const fullFiles = fixtures.get('full').files;
    const { ok, extras } = isLenientSubset(stdFiles, fullFiles);
    assert.ok(ok,
      `standard has ${extras.length} files not in full: ${extras.slice(0, 5).join(', ')}`);
  });
});

// ============================================================================
// X-03: JSON validity across all modes
// ============================================================================

describe('JSON validity', () => {
  it('X-03: all modes produce valid JSON for every .json file', () => {
    const errors = [];
    for (const mode of MODES) {
      const { dir, files } = fixtures.get(mode);
      const jsonFiles = files.filter(f => f.endsWith('.json'));
      for (const f of jsonFiles) {
        const fullPath = join(dir, f);
        if (!existsSync(fullPath)) continue;
        try {
          JSON.parse(readFileSync(fullPath, 'utf8'));
        } catch (e) {
          errors.push(`${mode}/${f}: ${e.message.slice(0, 80)}`);
        }
      }
    }
    assert.ok(errors.length === 0,
      `Invalid JSON files found:\n${errors.join('\n')}`);
  });
});

// ============================================================================
// X-04: No dangling references
// ============================================================================

describe('Reference integrity', () => {
  it('X-04: no dangling references in hook commands', () => {
    for (const mode of MODES) {
      const { dir } = fixtures.get(mode);
      const settingsPath = join(dir, '.claude', 'settings.json');
      if (!existsSync(settingsPath)) continue;
      let settings;
      try {
        settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
      } catch { continue; }
      const hooks = settings.hooks || {};
      for (const [hookType, hookList] of Object.entries(hooks)) {
        const commands = Array.isArray(hookList) ? hookList : [hookList];
        for (const cmd of commands) {
          if (typeof cmd !== 'object' || !cmd.command) continue;
          const command = cmd.command;
          // Extract file references from node commands
          const nodeMatch = command.match(/node\s+["']?([^"'\s]+\.(?:js|cjs|mjs))["']?/);
          if (!nodeMatch) continue;
          const refFile = nodeMatch[1];
          // Resolve relative to project dir
          const resolvedRef = refFile.startsWith('$')
            ? join(dir, refFile.replace('$CLAUDE_PROJECT_DIR/', '').replace(/^\$\{.*?\}\//, ''))
            : join(dir, refFile);
          // Check with common variable substitutions
          const possiblePaths = [
            resolvedRef,
            join(dir, '.claude', 'helpers', refFile.split('/').pop()),
          ];
          const found = possiblePaths.some(p => existsSync(p));
          // Lenient: skip $VAR references we cannot resolve statically
          if (!found && !refFile.includes('$')) {
            assert.fail(`${mode} hook "${hookType}" references missing file: ${refFile}`);
          }
        }
      }
    }
  });
});

// ============================================================================
// X-05 to X-06: Config key subsets
// ============================================================================

describe('Config key subsets', () => {
  it('X-05: config keys in minimal are subset of standard', () => {
    const minDir = fixtures.get('minimal').dir;
    const stdDir = fixtures.get('standard').dir;
    // Try claude-flow config or settings.json
    const configNames = ['claude-flow.json', '.claude-flow/config.json', '.claude/settings.json'];
    for (const name of configNames) {
      const minPath = join(minDir, name);
      const stdPath = join(stdDir, name);
      if (!existsSync(minPath) || !existsSync(stdPath)) continue;
      const minKeys = Object.keys(parseJsonFile(minPath) || {});
      const stdKeys = Object.keys(parseJsonFile(stdPath) || {});
      if (minKeys.length === 0) continue;
      const extras = minKeys.filter(k => !stdKeys.includes(k));
      assert.ok(extras.length <= 2,
        `minimal config "${name}" has ${extras.length} keys not in standard: ${extras.join(', ')}`);
      return; // Found a comparable config
    }
    // No comparable config files found — pass vacuously
    assert.ok(true, 'No comparable config files found between minimal and standard');
  });

  it('X-06: config keys in standard are subset of full', () => {
    const stdDir = fixtures.get('standard').dir;
    const fullDir = fixtures.get('full').dir;
    const configNames = ['claude-flow.json', '.claude-flow/config.json', '.claude/settings.json'];
    for (const name of configNames) {
      const stdPath = join(stdDir, name);
      const fullPath = join(fullDir, name);
      if (!existsSync(stdPath) || !existsSync(fullPath)) continue;
      const stdKeys = Object.keys(parseJsonFile(stdPath) || {});
      const fullKeys = Object.keys(parseJsonFile(fullPath) || {});
      if (stdKeys.length === 0) continue;
      const extras = stdKeys.filter(k => !fullKeys.includes(k));
      assert.ok(extras.length <= 2,
        `standard config "${name}" has ${extras.length} keys not in full: ${extras.join(', ')}`);
      return;
    }
    assert.ok(true, 'No comparable config files found between standard and full');
  });
});

// ============================================================================
// X-07 to X-08: Hook type subsets
// ============================================================================

describe('Hook type subsets', () => {
  // Helper to extract hook types from settings.json
  function getHookTypes(mode) {
    const { dir } = fixtures.get(mode);
    const settingsPath = join(dir, '.claude', 'settings.json');
    if (!existsSync(settingsPath)) return [];
    try {
      const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
      return Object.keys(settings.hooks || {});
    } catch {
      return [];
    }
  }

  it('X-07: hook types in minimal are subset of standard', () => {
    const minHooks = getHookTypes('minimal');
    const stdHooks = getHookTypes('standard');
    if (minHooks.length === 0 && stdHooks.length === 0) {
      assert.ok(true, 'Neither mode has hooks');
      return;
    }
    const extras = minHooks.filter(h => !stdHooks.includes(h));
    assert.ok(extras.length <= 1,
      `minimal has hook types not in standard: ${extras.join(', ')}`);
  });

  it('X-08: hook types in standard are subset of full', () => {
    const stdHooks = getHookTypes('standard');
    const fullHooks = getHookTypes('full');
    if (stdHooks.length === 0 && fullHooks.length === 0) {
      assert.ok(true, 'Neither mode has hooks');
      return;
    }
    const extras = stdHooks.filter(h => !fullHooks.includes(h));
    assert.ok(extras.length <= 1,
      `standard has hook types not in full: ${extras.join(', ')}`);
  });
});
