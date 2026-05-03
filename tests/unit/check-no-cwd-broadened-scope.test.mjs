// @tier unit
// Paired unit test for scripts/check-no-cwd-in-handlers.sh after the
// 2026-05-03 broadening (mcp-tools-only → init/commands/memory paths).
//
// Sibling: scripts/check-no-cwd-in-handlers.sh,
//          lib/acceptance-adr0100-checks.sh
//
// Three layers, mirroring the ADR-0104 unit test shape:
//
//  1. Static assertions on the script + lib wiring (ADR-0097 Tier Y rule)
//  2. Allowlist classification — feed the script a fixture FORK_DIR with a
//     curated mix of comment / string-literal / annotation / violation
//     lines and verify each is classified correctly
//  3. Scope coverage — verify the script enumerates files from all five
//     scope sections (mcp-tools, init, commands, cli-memory, pkg-memory)
//
// This test is decoupled from the real fork's current state — the gate
// will fail noisily until the fork-side anchor migration lands, but THIS
// test asserts the gate's machinery is correct regardless.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const GATE_SCRIPT = resolve(ROOT, 'scripts', 'check-no-cwd-in-handlers.sh');
const ACCEPTANCE_LIB = resolve(ROOT, 'lib', 'acceptance-adr0100-checks.sh');

// ─── Layer 1: static wiring ──────────────────────────────────────────────

describe('ADR-0100/G grep gate — static wiring', () => {
  it('script exists and is readable', () => {
    assert.ok(existsSync(GATE_SCRIPT), `missing: ${GATE_SCRIPT}`);
    const stat = readFileSync(GATE_SCRIPT, 'utf-8');
    assert.match(stat, /^#!\/usr\/bin\/env bash/);
  });

  it('script header documents broader scope', () => {
    const src = readFileSync(GATE_SCRIPT, 'utf-8');
    // Each of the five sections must appear in the header.
    for (const fragment of [
      'mcp-tools/*-tools.ts',
      'cli/src/init/**/*.ts',
      'cli/src/commands/**/*.ts',
      'cli/src/memory/**/*.ts',
      '@claude-flow/memory/src/**/*.ts',
    ]) {
      assert.ok(
        src.includes(fragment),
        `script header missing scope fragment: ${fragment}`,
      );
    }
  });

  it('script declares the three allowlist rules', () => {
    const src = readFileSync(GATE_SCRIPT, 'utf-8');
    assert.match(src, /Comment shape/i);
    assert.match(src, /String-literal shape/i);
    assert.match(src, /Explicit annotation/i);
    assert.match(src, /adr-0100-allow:/);
  });

  it('acceptance lib wires scenario G to the broader-scope success message', () => {
    const lib = readFileSync(ACCEPTANCE_LIB, 'utf-8');
    assert.match(lib, /check_adr0100_scenario_g_grep_gate/);
    // Success message must mention the broader scope, not just mcp-tools.
    assert.match(
      lib,
      /across CLI source.*mcp-tools.*init.*commands.*memory/,
      'success message should reference all four broadened scope categories',
    );
  });

  it('acceptance lib still calls the same gate script path', () => {
    const lib = readFileSync(ACCEPTANCE_LIB, 'utf-8');
    assert.match(lib, /check-no-cwd-in-handlers\.sh/);
  });
});

// ─── Helpers for layers 2 + 3 ────────────────────────────────────────────

/**
 * Build a fixture fork directory shaped like
 * `<root>/v3/@claude-flow/cli/src/{mcp-tools,init,commands,memory}/...`
 * and `<root>/v3/@claude-flow/memory/src/...`, with caller-supplied files.
 *
 * Returns the absolute fork dir path. Caller cleans up via `rmSync(fork)`.
 */
function buildFixtureFork(files) {
  const fork = mkdtempSync(join(tmpdir(), 'cwdgate-fix-'));
  for (const [relPath, content] of Object.entries(files)) {
    const abs = join(fork, relPath);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return fork;
}

/**
 * Run the gate script against a fixture fork dir.
 * Returns { exitCode, stdout, stderr }.
 */
function runGate(forkDir) {
  let exitCode = 0;
  let stdout = '';
  let stderr = '';
  try {
    stdout = execFileSync('bash', [GATE_SCRIPT], {
      env: {
        ...process.env,
        ADR0100_FORK_DIR: forkDir,
        ADR0100_LOG_DIR: join(forkDir, '.gate-log'),
        PROJECT_DIR: ROOT,
      },
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    exitCode = err.status ?? 1;
    stdout = err.stdout?.toString('utf-8') ?? '';
    stderr = err.stderr?.toString('utf-8') ?? '';
  }
  return { exitCode, stdout, stderr };
}

// ─── Layer 2: allowlist classification ───────────────────────────────────

describe('ADR-0100/G grep gate — allowlist classification', () => {
  it('comment lines are allowlisted', () => {
    const fork = buildFixtureFork({
      // Real //-prefixed comment line.
      'v3/@claude-flow/cli/src/init/foo.ts':
        '// teaching cue — process.cwd() is forbidden; use findProjectRoot()\n',
      // JSDoc continuation.
      'v3/@claude-flow/cli/src/commands/bar.ts':
        '/**\n * walks up from process.cwd() to the marker\n */\n',
      // Block-comment opener.
      'v3/@claude-flow/cli/src/memory/baz.ts':
        '/* note: process.cwd() drift is the bug */\n',
    });
    try {
      const { exitCode, stdout } = runGate(fork);
      assert.equal(exitCode, 0, `gate should pass with only comments;\nstdout:\n${stdout}`);
      assert.match(stdout, /violations:\s+0/);
    } finally {
      rmSync(fork, { recursive: true, force: true });
    }
  });

  it('string-literal containing process.cwd() is allowlisted', () => {
    const fork = buildFixtureFork({
      // process.cwd() inside a single-quoted string — generated subprocess code.
      'v3/@claude-flow/cli/src/init/exec.ts':
        "const code = '+ catch(e){r=process.cwd()}';\n",
      // process.cwd() inside a backtick template literal.
      'v3/@claude-flow/cli/src/init/exec2.ts':
        "const cmd = `node -e \"r = process.cwd()\"`;\n",
      // process.cwd() inside double-quoted string.
      'v3/@claude-flow/cli/src/init/exec3.ts':
        'const s = "process.cwd() returns startDir";\n',
    });
    try {
      const { exitCode, stdout } = runGate(fork);
      assert.equal(
        exitCode,
        0,
        `gate should pass with all process.cwd() inside string literals;\nstdout:\n${stdout}`,
      );
      assert.match(stdout, /total hits:\s+3/);
      assert.match(stdout, /allowlisted:\s+3/);
      assert.match(stdout, /violations:\s+0/);
    } finally {
      rmSync(fork, { recursive: true, force: true });
    }
  });

  it('explicit adr-0100-allow annotation suppresses violation', () => {
    const fork = buildFixtureFork({
      'v3/@claude-flow/cli/src/commands/disp.ts':
        "const cwd = process.cwd(); // adr-0100-allow: display-only banner\n",
    });
    try {
      const { exitCode, stdout } = runGate(fork);
      assert.equal(exitCode, 0, `annotation should suppress;\nstdout:\n${stdout}`);
      assert.match(stdout, /violations:\s+0/);
    } finally {
      rmSync(fork, { recursive: true, force: true });
    }
  });

  it('path-anchoring process.cwd() is flagged as violation', () => {
    const fork = buildFixtureFork({
      // The exact shape that caused adr0100-b/c: path.join(process.cwd(), '.swarm').
      'v3/@claude-flow/cli/src/memory/anchor.ts':
        "const swarmDir = path.resolve(process.cwd(), '.swarm');\n",
      // commands/ shape.
      'v3/@claude-flow/cli/src/commands/cfg.ts':
        "const cfg = path.join(process.cwd(), '.claude-flow', 'config.json');\n",
      // pkg-memory shape.
      'v3/@claude-flow/memory/src/cfg2.ts':
        "const dir = process.cwd();\n",
    });
    try {
      const { exitCode, stdout } = runGate(fork);
      assert.equal(exitCode, 1, `gate must fail on path-anchoring uses;\nstdout:\n${stdout}`);
      assert.match(stdout, /violations:\s+3/);
      assert.match(stdout, /anchor\.ts:1/);
      assert.match(stdout, /cfg\.ts:1/);
      assert.match(stdout, /cfg2\.ts:1/);
    } finally {
      rmSync(fork, { recursive: true, force: true });
    }
  });

  it('clean fork (no process.cwd() at all) passes', () => {
    const fork = buildFixtureFork({
      'v3/@claude-flow/cli/src/init/clean.ts':
        "import { findProjectRoot } from './types.js';\nconst root = findProjectRoot();\n",
      'v3/@claude-flow/cli/src/commands/clean.ts':
        "export const noop = () => undefined;\n",
      'v3/@claude-flow/cli/src/memory/clean.ts':
        "export const x = 1;\n",
      'v3/@claude-flow/memory/src/clean.ts':
        "export const y = 2;\n",
    });
    try {
      const { exitCode, stdout } = runGate(fork);
      assert.equal(exitCode, 0);
      assert.match(stdout, /total hits:\s+0/);
      assert.match(stdout, /violations:\s+0/);
    } finally {
      rmSync(fork, { recursive: true, force: true });
    }
  });
});

// ─── Layer 3: scope coverage ─────────────────────────────────────────────

describe('ADR-0100/G grep gate — scope coverage', () => {
  it('finds violations in all five scope sections', () => {
    const fork = buildFixtureFork({
      // Original mcp-tools scope: only *-tools.ts files in mcp-tools/ are scanned.
      'v3/@claude-flow/cli/src/mcp-tools/foo-tools.ts':
        "const x = path.join(process.cwd(), '.swarm');\n",
      // Init: recursive .ts (deep).
      'v3/@claude-flow/cli/src/init/sub/deep.ts':
        "const y = process.cwd();\n",
      // Commands: recursive .ts.
      'v3/@claude-flow/cli/src/commands/sub/cmd.ts':
        "const z = process.cwd();\n",
      // cli/src/memory: recursive .ts.
      'v3/@claude-flow/cli/src/memory/sub/m.ts':
        "const a = process.cwd();\n",
      // @claude-flow/memory/src: recursive .ts.
      'v3/@claude-flow/memory/src/sub/p.ts':
        "const b = process.cwd();\n",
    });
    try {
      const { exitCode, stdout } = runGate(fork);
      assert.equal(exitCode, 1, `gate must fail with violations across all scopes;\nstdout:\n${stdout}`);
      // Each section's header must appear.
      for (const section of [
        '── mcp-tools ──',
        '── init ──',
        '── commands ──',
        '── cli-memory ──',
        '── pkg-memory ──',
      ]) {
        assert.ok(stdout.includes(section), `missing section header: ${section}`);
      }
      // Total violations should be 5 (one per fixture file).
      assert.match(stdout, /total hits:\s+5/);
      assert.match(stdout, /violations:\s+5/);
    } finally {
      rmSync(fork, { recursive: true, force: true });
    }
  });

  it('mcp-tools section ignores non-tools.ts files (original scope rule)', () => {
    const fork = buildFixtureFork({
      // *-tools.ts: in scope.
      'v3/@claude-flow/cli/src/mcp-tools/foo-tools.ts':
        "const x = process.cwd();\n",
      // Non-tools.ts in mcp-tools/: NOT in scope (matches original gate rule).
      'v3/@claude-flow/cli/src/mcp-tools/types.ts':
        "const y = process.cwd();\n",
      'v3/@claude-flow/cli/src/mcp-tools/helper.ts':
        "const z = process.cwd();\n",
    });
    try {
      const { exitCode, stdout } = runGate(fork);
      assert.equal(exitCode, 1);
      // Only the foo-tools.ts hit should be counted, NOT types.ts or helper.ts.
      const mcpSectionMatch = stdout.match(/── mcp-tools ──[\s\S]*?total hits:\s+(\d+)/);
      assert.ok(mcpSectionMatch, 'mcp-tools section missing in output');
      assert.equal(mcpSectionMatch[1], '1', `expected 1 hit in mcp-tools (only *-tools.ts); got ${mcpSectionMatch[1]}`);
    } finally {
      rmSync(fork, { recursive: true, force: true });
    }
  });

  it('emits each .ts file exactly once (no double-counting from glob+find)', () => {
    // Regression: an earlier draft used `**/*.ts` plus `*.ts` and double-counted
    // files that lived directly under the scope dir.
    const fork = buildFixtureFork({
      'v3/@claude-flow/cli/src/init/shallow.ts':
        "const a = process.cwd();\n",
      'v3/@claude-flow/cli/src/init/sub/deep.ts':
        "const b = process.cwd();\n",
    });
    try {
      const { exitCode, stdout } = runGate(fork);
      assert.equal(exitCode, 1);
      const initSectionMatch = stdout.match(/── init ──[\s\S]*?total hits:\s+(\d+)/);
      assert.ok(initSectionMatch);
      assert.equal(
        initSectionMatch[1],
        '2',
        `expected 2 hits (one per file, no dup); got ${initSectionMatch[1]}`,
      );
    } finally {
      rmSync(fork, { recursive: true, force: true });
    }
  });
});
