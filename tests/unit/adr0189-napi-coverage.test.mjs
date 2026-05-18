// @tier unit
// ADR-0189: scripts/check-napi-coverage.mjs — fail-loud NAPI coverage gate.
//
// The detector walks each fork's Cargo.toml tree, flags any crate with a
// `napi-derive` dependency outside [workspace.dependencies], and cross-checks
// against lib/napi-config.sh NAPI_PACKAGES. A missing entry means the pipeline
// will silently skip building/shipping that crate's .node binary
// (ADR-0082 silent-drop hazard).
//
// This test exercises the script's logic against synthetic fixtures so we
// don't depend on the live state of forks/* — the fixtures cover:
//   - covered case (consumer in allowlist) → exit 0
//   - uncovered case (consumer missing from allowlist) → exit 1
//   - workspace.dependencies declaration is NOT a consumer
//   - target.'cfg(...)'.dependencies declaration IS a consumer

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const SCRIPT = '/Users/henrik/source/ruflo-patch/scripts/check-napi-coverage.mjs';

// Spin up a self-contained sandbox project that mirrors ruflo-patch layout:
//   sandbox/
//     scripts/check-napi-coverage.mjs       (copy of real script)
//     lib/napi-config.sh                    (fixture allowlist)
//     config/upstream-branches.json         (points at sandbox forks dir)
//     forks/<name>/...                      (synthetic Cargo.tomls)
//
// We don't actually copy the script — we spawn it from its real path with
// PROJECT_DIR overridden via a symlink/path swap. Simpler: spawn the script
// from a sandbox that has its own scripts/ + lib/ + config/ tree.
function buildSandbox({ allowlist, forks }) {
  const sandbox = mkdtempSync(join(tmpdir(), 'adr0189-'));
  mkdirSync(join(sandbox, 'scripts'), { recursive: true });
  mkdirSync(join(sandbox, 'lib'), { recursive: true });
  mkdirSync(join(sandbox, 'config'), { recursive: true });
  mkdirSync(join(sandbox, 'forks'), { recursive: true });

  // Copy the real script into the sandbox so `resolve(__dirname, '..')` lands
  // at the sandbox root.
  const realScript = readFileSync(SCRIPT, 'utf8');
  writeFileSync(join(sandbox, 'scripts', 'check-napi-coverage.mjs'), realScript);

  // Build NAPI_PACKAGES allowlist file.
  const entries = allowlist.map(e => `  "${e}"`).join('\n');
  const napiConfig = `#!/usr/bin/env bash\nNAPI_PACKAGES=(\n${entries}\n)\n`;
  writeFileSync(join(sandbox, 'lib', 'napi-config.sh'), napiConfig);

  // Build upstream-branches.json pointing at sandbox/forks/<name>.
  const upstream = {};
  for (const fork of forks) {
    const forkDir = join(sandbox, 'forks', fork.name);
    mkdirSync(forkDir, { recursive: true });
    upstream[fork.name] = {
      dir: forkDir,
      branch: 'main',
      url: `https://example.com/${fork.name}.git`,
    };
    // Lay down each crate's Cargo.toml.
    for (const crate of fork.crates) {
      const crateDir = join(forkDir, crate.path);
      mkdirSync(crateDir, { recursive: true });
      writeFileSync(join(crateDir, 'Cargo.toml'), crate.cargoToml);
    }
  }
  writeFileSync(join(sandbox, 'config', 'upstream-branches.json'), JSON.stringify(upstream, null, 2));

  return sandbox;
}

function runCheck(sandbox) {
  const script = join(sandbox, 'scripts', 'check-napi-coverage.mjs');
  const res = spawnSync('node', [script], { encoding: 'utf8' });
  return { exit: res.status, stdout: res.stdout, stderr: res.stderr };
}

describe('ADR-0189: check-napi-coverage.mjs — covered case', () => {
  it('exits 0 when every consumer is in NAPI_PACKAGES', () => {
    const sandbox = buildSandbox({
      allowlist: [
        'FORK_DIR_RUVECTOR:crates/ruvector-node:npm/packages/core',
      ],
      forks: [
        {
          name: 'ruvector',
          crates: [
            {
              path: 'crates/ruvector-node',
              cargoToml: `[package]\nname = "ruvector-node"\n\n[dependencies]\nnapi-derive = "2"\n`,
            },
            {
              path: 'crates/pure-rust-lib',
              cargoToml: `[package]\nname = "pure-rust-lib"\n\n[dependencies]\nserde = "1"\n`,
            },
          ],
        },
      ],
    });
    try {
      const res = runCheck(sandbox);
      assert.equal(res.exit, 0, `expected exit 0, got ${res.exit}; stderr=${res.stderr}`);
      assert.match(res.stdout, /\[NAPI-COVERAGE\] OK: 1 NAPI crates/);
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });
});

describe('ADR-0189: check-napi-coverage.mjs — uncovered case', () => {
  it('exits 1 and names the unlisted crate', () => {
    const sandbox = buildSandbox({
      allowlist: [
        // Empty allowlist — every consumer is unlisted.
      ],
      forks: [
        {
          name: 'ruvector',
          crates: [
            {
              path: 'crates/unlisted-node',
              cargoToml: `[package]\nname = "unlisted-node"\n\n[dependencies]\nnapi-derive = "2"\n`,
            },
          ],
        },
      ],
    });
    try {
      const res = runCheck(sandbox);
      assert.equal(res.exit, 1, `expected exit 1, got ${res.exit}; stdout=${res.stdout}`);
      assert.match(res.stderr, /Unlisted NAPI crate found: forks\/ruvector\/crates\/unlisted-node/);
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });
});

describe('ADR-0189: check-napi-coverage.mjs — workspace.dependencies is NOT a consumer', () => {
  it('ignores napi-derive declared only in [workspace.dependencies]', () => {
    const sandbox = buildSandbox({
      allowlist: [],
      forks: [
        {
          name: 'ruvector',
          crates: [
            {
              // Workspace root: declares napi-derive in workspace.dependencies
              // (just a version pin), not a real consumer.
              path: '_workspace_root',
              cargoToml: `[workspace]\nmembers = []\n\n[workspace.dependencies]\nnapi-derive = "2.16"\n`,
            },
          ],
        },
      ],
    });
    try {
      const res = runCheck(sandbox);
      assert.equal(res.exit, 0, `workspace.dependencies should not be flagged; stderr=${res.stderr}`);
      assert.match(res.stdout, /OK: 0 NAPI crates/);
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });
});

describe('ADR-0189: check-napi-coverage.mjs — target.cfg dependencies are consumers', () => {
  it('flags crates whose napi-derive is under [target.\'cfg(...)\'.dependencies]', () => {
    const sandbox = buildSandbox({
      allowlist: [],
      forks: [
        {
          name: 'ruvector',
          crates: [
            {
              path: 'crates/cfg-target-node',
              cargoToml: `[package]\nname = "cfg-target-node"\n\n[target.'cfg(target_os = "linux")'.dependencies]\nnapi-derive = { workspace = true, optional = true }\n`,
            },
          ],
        },
      ],
    });
    try {
      const res = runCheck(sandbox);
      assert.equal(res.exit, 1, `target.cfg.dependencies should be flagged; stdout=${res.stdout}`);
      assert.match(res.stderr, /cfg-target-node/);
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });
});

describe('ADR-0189: check-napi-coverage.mjs — script file is present', () => {
  it('the script exists and is executable as ESM', () => {
    assert.ok(existsSync(SCRIPT), 'scripts/check-napi-coverage.mjs must exist');
  });
});
