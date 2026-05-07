// @tier unit
// ADR-0148 C pattern (post-2026-05-07): every top-level command file at
// `forks/ruflo/v3/@claude-flow/cli/.claude/commands/*.md` MUST be listed
// in COMMANDS_MAP in `init/executor.ts`. Files that exist on disk but
// aren't in the map are dead-code-on-disk: `ruflo init` never copies
// them to user projects.
//
// This is the same bug class that ADR-0148 C fixed for SKILLS_MAP at
// fork commit 8e6e59f9, recurring for COMMANDS_MAP after fork commit
// 77e29b15b added /agentic-jujutsu without updating the map. Pin the
// invariant here so the next dead-code addition surfaces at unit-test
// time, not at "users report missing slash commands" time.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';

const FORK_CLI = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli';
const COMMANDS_DIR = `${FORK_CLI}/.claude/commands`;
const EXECUTOR_SRC = `${FORK_CLI}/src/init/executor.ts`;

assert.ok(existsSync(COMMANDS_DIR), `commands source dir missing at ${COMMANDS_DIR}`);
assert.ok(existsSync(EXECUTOR_SRC), `executor.ts missing at ${EXECUTOR_SRC}`);

const executorSrc = readFileSync(EXECUTOR_SRC, 'utf8');

// Extract the COMMANDS_MAP block as a string so we can grep within it.
function extractCommandsMap() {
  const start = executorSrc.indexOf('const COMMANDS_MAP');
  assert.ok(start >= 0, 'COMMANDS_MAP declaration must exist in executor.ts');
  const end = executorSrc.indexOf('};', start);
  assert.ok(end > start, 'COMMANDS_MAP block delimiters must be locatable');
  return executorSrc.slice(start, end + 2);
}

// Enumerate top-level .md files (NOT subdirectories — those are mapped
// by their dir name, not file-by-file).
function topLevelCommandFiles() {
  return readdirSync(COMMANDS_DIR)
    .filter((name) => {
      const full = `${COMMANDS_DIR}/${name}`;
      return statSync(full).isFile() && name.endsWith('.md');
    });
}

// Enumerate top-level subdirectories.
function topLevelCommandDirs() {
  return readdirSync(COMMANDS_DIR)
    .filter((name) => {
      const full = `${COMMANDS_DIR}/${name}`;
      return statSync(full).isDirectory();
    });
}

describe('init COMMANDS_MAP completeness (ADR-0148 C pattern, command surface)', () => {
  const mapBlock = extractCommandsMap();

  for (const file of topLevelCommandFiles()) {
    it(`COMMANDS_MAP lists top-level command file: ${file}`, () => {
      // The file must appear as a string literal somewhere in COMMANDS_MAP.
      // We use a strict substring check because the map shape is
      // `category: ['file.md', ...]` — file.md will appear quoted.
      assert.ok(
        mapBlock.includes(`'${file}'`) || mapBlock.includes(`"${file}"`),
        `${file} exists at ${COMMANDS_DIR}/${file} but is NOT in COMMANDS_MAP. ` +
        `Per ADR-0148 C, top-level command files must be wired into COMMANDS_MAP ` +
        `to be copied by 'ruflo init'. Add an entry under an existing or new category.`,
      );
    });
  }

  for (const dir of topLevelCommandDirs()) {
    it(`COMMANDS_MAP lists top-level command dir: ${dir}/`, () => {
      assert.ok(
        mapBlock.includes(`'${dir}'`) || mapBlock.includes(`"${dir}"`),
        `${dir}/ exists at ${COMMANDS_DIR}/${dir}/ but is NOT in COMMANDS_MAP. ` +
        `Per ADR-0148 C, top-level command directories must be wired into ` +
        `COMMANDS_MAP under a category that maps to their dir name.`,
      );
    });
  }

  it('every COMMANDS_MAP entry references an existing source file or directory', () => {
    // Inverse direction: catch stale map entries (file removed but map
    // entry stayed). Extract all string literals from the map block and
    // verify each maps to something on disk.
    const literals = [...mapBlock.matchAll(/'([^']+\.md|[a-z][a-z0-9-]+)'/g)].map((m) => m[1]);
    const missing = literals.filter((entry) => !existsSync(`${COMMANDS_DIR}/${entry}`));
    assert.equal(
      missing.length, 0,
      `COMMANDS_MAP references ${missing.length} entry/entries that don't exist on disk: ` +
      missing.map((e) => `'${e}'`).join(', ') +
      `. Either remove from the map (entry deleted) or restore the file.`,
    );
  });

  it('CommandsConfig type covers every COMMANDS_MAP category key', () => {
    const typesSrc = readFileSync(`${FORK_CLI}/src/init/types.ts`, 'utf8');
    const interfaceMatch = typesSrc.match(/export\s+interface\s+CommandsConfig\s*\{([\s\S]*?)\}/);
    assert.ok(interfaceMatch, 'CommandsConfig interface must be locatable');
    const interfaceBody = interfaceMatch[1];

    // Extract category keys from COMMANDS_MAP (the JS keys of the object).
    const keyMatches = [...mapBlock.matchAll(/^\s+([a-z][a-zA-Z0-9]+):\s*\[/gm)];
    const mapKeys = keyMatches.map((m) => m[1]);

    for (const key of mapKeys) {
      assert.ok(
        new RegExp(`\\b${key}\\b`).test(interfaceBody),
        `COMMANDS_MAP has category '${key}' but CommandsConfig type doesn't declare it. ` +
        `Add \`${key}?: boolean\` to CommandsConfig in init/types.ts.`,
      );
    }
  });

  it('copyCommands wires every COMMANDS_MAP category in the include filter', () => {
    // The `else` branch of copyCommands must check each category flag.
    // Find copyCommands and verify each category appears.
    const copyFnStart = executorSrc.indexOf('async function copyCommands');
    const copyFnEnd = executorSrc.indexOf('async function copyAgents', copyFnStart);
    assert.ok(copyFnStart >= 0, 'copyCommands function must be locatable');
    const copyFnBody = copyFnEnd > copyFnStart
      ? executorSrc.slice(copyFnStart, copyFnEnd)
      : executorSrc.slice(copyFnStart);

    const keyMatches = [...mapBlock.matchAll(/^\s+([a-z][a-zA-Z0-9]+):\s*\[/gm)];
    const mapKeys = keyMatches.map((m) => m[1]);

    for (const key of mapKeys) {
      assert.ok(
        new RegExp(`commandsConfig\\.${key}`).test(copyFnBody),
        `copyCommands's include filter doesn't reference commandsConfig.${key}. ` +
        `Without this, only --all (Object.values flatten) ships the ${key} category — ` +
        `category-specific flags will skip it. Add \`if (commandsConfig.${key}) ` +
        `commandsToCopy.push(...COMMANDS_MAP.${key});\` to copyCommands.`,
      );
    }
  });
});
