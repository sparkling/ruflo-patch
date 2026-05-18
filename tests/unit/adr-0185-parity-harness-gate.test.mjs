// @tier unit
// ADR-0185 Wave 1 — parity-harness release-gate wiring (DA Option A).
//
// The parity harness at
// `forks/ruflo/v3/@claude-flow/cli/__tests__/hive-mind-consensus-parity.test.ts`
// is the regression guard for ADR-0185 Waves 2-5 (per-action flips to
// `archivist.dispatch`). Without this runner test, the harness would run
// only when a developer manually invokes `npx vitest run` inside the fork —
// it is NOT discovered by ruflo-patch's `test-runner.mjs` (which only loads
// `.test.mjs` files in `tests/unit/`) nor by `ruflo-publish.sh`'s acceptance
// suite (which runs `scripts/test-acceptance.sh` against the published
// package, not the fork's vitest config).
//
// This file invokes the harness via `spawnSync('npx', ['vitest', 'run',
// '__tests__/hive-mind-consensus-parity.test.ts'])` inside the cli fork.
// If any of the 26 parity cells fail, this test fails, and `npm run
// test:unit` (which gates `npm run release`) aborts the publish.
//
// Pattern matches existing tests/fork/cli/*.test.ts files (cli activation
// tests that live in ruflo-patch but exercise fork source), promoted to
// `tests/unit/.test.mjs` so the runner picks it up.
//
// DA-mandated wiring before ADR-0185 Wave 2 starts. Per
// `feedback-trace-before-hypothesis` + the structural-finding from the
// patch.190 release log (parity harness was silently skipped because of
// stale CJS artefacts + missing gate-wiring).

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

// Cli fork location, relative to ruflo-patch root.
const CLI_FORK_DIR = resolve(ROOT, '../forks/ruflo/v3/@claude-flow/cli');
const HARNESS_REL = '__tests__/hive-mind-consensus-parity.test.ts';
const HARNESS_PATH = resolve(CLI_FORK_DIR, HARNESS_REL);

describe('ADR-0185 Wave 1 — parity-harness release-gate (DA Option A)', () => {
  it('cli fork directory exists', () => {
    assert.ok(
      existsSync(CLI_FORK_DIR),
      `cli fork dir not found: ${CLI_FORK_DIR} — adr-0185 parity harness cannot be gated`,
    );
  });

  it('parity harness file exists in the cli fork', () => {
    assert.ok(
      existsSync(HARNESS_PATH),
      `parity harness not found: ${HARNESS_PATH} — ADR-0185 Wave 1 commit chain may be missing`,
    );
  });

  it('parity harness passes all 29 cells under vitest', () => {
    // Drive vitest inside the cli fork. vitest's default exit code (0 on
    // pass, non-zero on any fail) is the gate signal. We capture stdout+
    // stderr for diagnostic output if any cell regresses.
    //
    // 3-minute timeout: the harness runs ~200ms locally; the 180s ceiling
    // covers cold-start (vitest first-run transform) + a generous margin
    // for the release pipeline's loaded shared host. If we exceed it, the
    // failure mode is the same (test:unit reports failure, release aborts).
    const result = spawnSync(
      'npx',
      ['vitest', 'run', HARNESS_REL, '--reporter=basic'],
      {
        cwd: CLI_FORK_DIR,
        encoding: 'utf8',
        timeout: 180_000,
        env: { ...process.env, CI: '1' },
      },
    );

    const stdout = result.stdout || '';
    const stderr = result.stderr || '';
    const combined = stdout + '\n' + stderr;

    // Hard-fail diagnostics with FULL output (no truncation, no
    // pipe-through-tail) per `feedback-full-test-output` and
    // `feedback-no-tail-tests`. The release log captures the entirety;
    // DA's grep for "ADR-0185 Wave 1 — parity" expects this output.
    if (result.status !== 0) {
      const diag = [
        `parity harness FAILED (exit ${result.status}):`,
        `  cwd: ${CLI_FORK_DIR}`,
        `  cmd: npx vitest run ${HARNESS_REL}`,
        '  --- stdout ---',
        stdout,
        '  --- stderr ---',
        stderr,
      ].join('\n');
      assert.fail(diag);
    }

    // Sentinel checks — confirm the harness actually executed (not silently
    // skipped via module-resolution failure as happened at patch.190).
    assert.match(
      combined,
      /hive-mind-consensus-parity\.test\.ts/,
      'vitest output missing parity harness file reference — file was skipped?',
    );
    // ADR-0185 cell count history:
    //   Wave 1: 26 cells (initial harness with cli-vs-builder parity).
    //   Wave 2a: 28 cells (+2 propose error-path reshape cells).
    //   Wave 3:  28 cells (vote pivot — 6 happy + 3 reshape new − 2 byz − 1
    //             crdt-snapshot dropped = net 0).
    //   Wave 4:  29 cells (+1 status × ProposalNotFound reshape cell).
    // Hardcode the count per DA's recommendation to catch accidental cell
    // add/remove during downstream waves; bump when adding cells in future
    // waves (Wave 5 list-flip, Wave 6 hardening).
    assert.match(
      combined,
      /(?:29 passed|Tests\s+29 passed)/,
      `vitest output missing "29 passed" — actual:\n${combined}`,
    );
  });
});
