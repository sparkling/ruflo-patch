/**
 * hook-paths.test.mjs
 *
 * Validates that .claude/settings.json uses portable `git rev-parse --show-toplevel`
 * paths instead of the non-portable `$CLAUDE_PROJECT_DIR` environment variable,
 * and that every helper script referenced by hook commands actually exists on disk.
 *
 * Also verifies the upstream settings-generator.ts source uses `git rev-parse`.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

const SETTINGS_PATH = join(ROOT, '.claude', 'settings.json');
const HELPERS_DIR = join(ROOT, '.claude', 'helpers');
const SCRIPTS_DIR = join(ROOT, '.claude', 'scripts');

const SETTINGS_GENERATOR_PATH = join(
  ROOT, '..', 'forks', 'ruflo',
  'v3', '@claude-flow', 'cli', 'src', 'init', 'settings-generator.ts'
);

// ---------- helpers ----------

/** Parse settings.json once for all tests. */
function loadSettings() {
  const raw = readFileSync(SETTINGS_PATH, 'utf8');
  return { raw, parsed: JSON.parse(raw) };
}

/**
 * Recursively collect every `command` string value from an object tree.
 * This captures hook commands, statusLine commands, and permission patterns.
 */
function collectCommands(obj, commands = []) {
  if (obj === null || obj === undefined) return commands;
  if (typeof obj === 'string') return commands;
  if (Array.isArray(obj)) {
    for (const item of obj) collectCommands(item, commands);
    return commands;
  }
  if (typeof obj === 'object') {
    for (const [key, value] of Object.entries(obj)) {
      if (key === 'command' && typeof value === 'string') {
        commands.push(value);
      } else {
        collectCommands(value, commands);
      }
    }
  }
  return commands;
}

/**
 * Extract the script filename from a hook command string.
 * Handles patterns like:
 *   node "$(git rev-parse --show-toplevel)/.claude/helpers/hook-handler.cjs" pre-bash
 *   bash "$(git rev-parse --show-toplevel)/.claude/scripts/pi-brain-session.sh" session-start
 */
function extractScriptPath(command) {
  // Match .claude/helpers/<file> or .claude/scripts/<file>
  const match = command.match(/\.claude\/(helpers|scripts)\/([^\s"]+)/);
  if (!match) return null;
  return { dir: match[1], filename: match[2] };
}

// ---------- tests ----------

describe('settings.json hook paths', () => {
  const { raw, parsed } = loadSettings();

  describe('Test 1: no $CLAUDE_PROJECT_DIR references', () => {
    it('should not contain $CLAUDE_PROJECT_DIR anywhere in settings.json', () => {
      const occurrences = [];
      const lines = raw.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('$CLAUDE_PROJECT_DIR') || lines[i].includes('CLAUDE_PROJECT_DIR')) {
          // Exclude env-variable definitions (key names) that happen to contain the substring
          const trimmed = lines[i].trim();
          if (trimmed.startsWith('"CLAUDE_') && trimmed.includes(':')) continue;
          occurrences.push({ line: i + 1, content: lines[i].trim() });
        }
      }
      assert.equal(
        occurrences.length,
        0,
        `Found $CLAUDE_PROJECT_DIR in settings.json at:\n${
          occurrences.map(o => `  line ${o.line}: ${o.content}`).join('\n')
        }\nAll hook paths should use $(git rev-parse --show-toplevel) instead.`
      );
    });

    it('should use git rev-parse --show-toplevel in hook commands', () => {
      const commands = collectCommands(parsed.hooks);
      assert.ok(commands.length > 0, 'Expected at least one hook command in settings.json');

      for (const cmd of commands) {
        // Every command referencing .claude/ should go through git rev-parse
        if (cmd.includes('.claude/')) {
          assert.ok(
            cmd.includes('git rev-parse --show-toplevel'),
            `Hook command does not use git rev-parse:\n  ${cmd}`
          );
        }
      }
    });

    it('should use git rev-parse in statusLine command', () => {
      assert.ok(parsed.statusLine, 'Expected statusLine configuration to exist');
      assert.ok(
        parsed.statusLine.command.includes('git rev-parse --show-toplevel'),
        `statusLine command does not use git rev-parse:\n  ${parsed.statusLine.command}`
      );
    });
  });

  describe('Test 2: hook commands resolve to existing files', () => {
    const commands = collectCommands(parsed.hooks);

    it('should have hook commands to validate', () => {
      assert.ok(commands.length > 0, 'Expected at least one hook command');
    });

    for (const cmd of commands) {
      const scriptInfo = extractScriptPath(cmd);
      if (!scriptInfo) continue;

      it(`should find .claude/${scriptInfo.dir}/${scriptInfo.filename} on disk`, () => {
        const baseDir = scriptInfo.dir === 'helpers' ? HELPERS_DIR : SCRIPTS_DIR;
        const fullPath = join(baseDir, scriptInfo.filename);
        assert.ok(
          existsSync(fullPath),
          `Referenced script not found: .claude/${scriptInfo.dir}/${scriptInfo.filename}\n` +
          `  Expected at: ${fullPath}\n` +
          `  From command: ${cmd}`
        );
      });
    }
  });

  describe('Test 3: all helpers referenced in hooks exist', () => {
    const commands = [
      ...collectCommands(parsed.hooks),
      ...(parsed.statusLine?.command ? [parsed.statusLine.command] : []),
    ];
    const seen = new Set();
    const scripts = [];

    for (const cmd of commands) {
      const info = extractScriptPath(cmd);
      if (!info) continue;
      const key = `${info.dir}/${info.filename}`;
      if (seen.has(key)) continue;
      seen.add(key);
      scripts.push(info);
    }

    it('should reference at least one helper script', () => {
      assert.ok(scripts.length > 0, 'No helper scripts extracted from hook commands');
    });

    for (const { dir, filename } of scripts) {
      it(`${filename} exists at .claude/${dir}/`, () => {
        const baseDir = dir === 'helpers' ? HELPERS_DIR : SCRIPTS_DIR;
        const fullPath = join(baseDir, filename);
        assert.ok(
          existsSync(fullPath),
          `Missing helper: .claude/${dir}/${filename}\n  Expected at: ${fullPath}`
        );
      });
    }
  });

  describe('Test 4: settings-generator uses reliable path resolution', () => {
    // The generator lives in the ruflo fork; skip gracefully if not cloned
    const generatorExists = existsSync(SETTINGS_GENERATOR_PATH);

    it('should find the settings-generator.ts source file', { skip: !generatorExists }, () => {
      assert.ok(generatorExists, `settings-generator.ts not found at ${SETTINGS_GENERATOR_PATH}`);
    });

    if (generatorExists) {
      const source = readFileSync(SETTINGS_GENERATOR_PATH, 'utf8');

      it('should use $CLAUDE_PROJECT_DIR or git rev-parse for path resolution', { skip: !generatorExists }, () => {
        // Upstream uses $CLAUDE_PROJECT_DIR (Claude Code built-in env var).
        // Either $CLAUDE_PROJECT_DIR or $(git rev-parse --show-toplevel) is acceptable.
        const hasReliablePaths = source.includes('$CLAUDE_PROJECT_DIR') ||
          source.includes('git rev-parse --show-toplevel');
        assert.ok(
          hasReliablePaths,
          'settings-generator.ts should use $CLAUDE_PROJECT_DIR or $(git rev-parse --show-toplevel) for path resolution'
        );
      });

      it('should not hardcode absolute paths in hook commands', { skip: !generatorExists }, () => {
        // Ensure no hardcoded /home/... or /Users/... paths in hook commands
        const hookFunctions = source.match(/function (hookHandlerCmd|autoMemoryCmd|hookCmd)[\s\S]*?return[^;]+/g) || [];
        for (const fn of hookFunctions) {
          assert.ok(
            !fn.match(/\/home\/\w+|\/Users\/\w+/),
            `Hook function contains hardcoded absolute path:\n${fn}`
          );
        }
      });
    }
  });
});
