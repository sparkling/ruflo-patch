// @tier unit
// ADR-0150 regression-pin: lib/napi-config.sh schema + critical entries.
//
// The napi-rebuild.sh + bundle-native-binaries.sh scripts source
// lib/napi-config.sh via NAPI_PACKAGES array. If the config file shape
// changes incompatibly OR a critical entry (agentic-jujutsu) is removed,
// the multi-fork pipeline silently falls back to single-fork behaviour
// (ADR-0133 pre-generalisation state) and napi binaries for non-ruvector
// packages stop shipping.
//
// This test pins:
//   1. The config file exists and is valid bash
//   2. NAPI_PACKAGES array is non-empty
//   3. Each entry has the canonical 3-part shape <fork_var>:<crate>:<dest>
//   4. agentic-jujutsu is present (ADR-0150 §"Findings — Category C")
//   5. All 7 ruvector entries are present (don't regress to fewer)

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const CONFIG = '/Users/henrik/source/ruflo-patch/lib/napi-config.sh';
const FORK_PATHS = '/Users/henrik/source/ruflo-patch/lib/fork-paths.sh';

describe('ADR-0150: napi-config.sh schema', () => {
  it('config file exists', () => {
    assert.ok(existsSync(CONFIG), `${CONFIG} must exist`);
  });

  it('NAPI_PACKAGES array is declared', () => {
    const src = readFileSync(CONFIG, 'utf8');
    assert.match(src, /^NAPI_PACKAGES=\(/m, 'NAPI_PACKAGES=( ... ) array declaration must be present');
  });

  it('exposes napi_parse_entry helper', () => {
    const src = readFileSync(CONFIG, 'utf8');
    assert.match(src, /napi_parse_entry\s*\(\)\s*\{/, 'napi_parse_entry() helper must be defined');
  });

  it('exposes napi_unique_forks helper', () => {
    const src = readFileSync(CONFIG, 'utf8');
    assert.match(src, /napi_unique_forks\s*\(\)\s*\{/, 'napi_unique_forks() helper must be defined');
  });
});

describe('ADR-0150: NAPI_PACKAGES content', () => {
  // Source the config under bash and emit the parsed entries one-per-line
  function loadEntries() {
    const cmd = `bash -c '
      source "${FORK_PATHS}"
      source "${CONFIG}"
      for entry in "\${NAPI_PACKAGES[@]}"; do
        echo "\$entry"
      done
    '`;
    return execSync(cmd).toString().trim().split('\n').filter(Boolean);
  }

  it('NAPI_PACKAGES has at least 8 entries (7 ruvector + 1 agentic-jujutsu)', () => {
    const entries = loadEntries();
    assert.ok(entries.length >= 8, `expected ≥8 entries, got ${entries.length}`);
  });

  it('every entry has 3 colon-separated parts', () => {
    const entries = loadEntries();
    for (const e of entries) {
      const parts = e.split(':');
      assert.equal(parts.length, 3, `entry "${e}" must have <fork_var>:<crate>:<dest> shape`);
      assert.match(parts[0], /^FORK_DIR_[A-Z_]+$/, `fork_var "${parts[0]}" must be FORK_DIR_*`);
      assert.ok(parts[1].length > 0, `crate path empty in "${e}"`);
      assert.ok(parts[2].length > 0, `dest path empty in "${e}"`);
    }
  });

  it('agentic-jujutsu entry is present (ADR-0150 critical)', () => {
    const entries = loadEntries();
    const found = entries.find(e => e.includes('packages/agentic-jujutsu'));
    assert.ok(found, 'NAPI_PACKAGES must include agentic-jujutsu (ADR-0150 §"Findings — Category C")');
    assert.match(found, /^FORK_DIR_AGENTIC:packages\/agentic-jujutsu:packages\/agentic-jujutsu$/,
      'agentic-jujutsu is single-binary (src == dest = packages/agentic-jujutsu)');
  });

  it('all 7 ruvector crates are present (no regression to fewer)', () => {
    const entries = loadEntries();
    const ruvectorPaths = [
      'crates/ruvector-graph-node:npm/packages/graph-node',
      'crates/ruvector-node:npm/packages/core',
      'crates/ruvector-router-ffi:npm/packages/router',
      'crates/ruvector-tiny-dancer-node:npm/packages/tiny-dancer',
      'crates/sona:npm/packages/sona',
      'examples/ruvLLM:npm/packages/ruvllm',
      'crates/rvf/rvf-node:npm/packages/rvf-node',
    ];
    for (const p of ruvectorPaths) {
      const found = entries.find(e => e === `FORK_DIR_RUVECTOR:${p}`);
      assert.ok(found, `ruvector entry missing: FORK_DIR_RUVECTOR:${p}`);
    }
  });
});

describe('ADR-0150: napi-rebuild.sh wiring', () => {
  const REBUILD = '/Users/henrik/source/ruflo-patch/scripts/napi-rebuild.sh';

  it('sources lib/napi-config.sh', () => {
    const src = readFileSync(REBUILD, 'utf8');
    assert.match(src, /source\s+["']?\$\{?ROOT_DIR\}?\/lib\/napi-config\.sh/,
      'napi-rebuild.sh must source lib/napi-config.sh');
  });

  it('iterates napi_unique_forks (multi-fork pattern)', () => {
    const src = readFileSync(REBUILD, 'utf8');
    assert.match(src, /napi_unique_forks/,
      'napi-rebuild.sh must iterate napi_unique_forks for multi-fork support');
  });

  it('accepts PREV_AGENTIC_HEAD as positional arg', () => {
    const src = readFileSync(REBUILD, 'utf8');
    assert.match(src, /PREV_AGENTIC_HEAD=/,
      'napi-rebuild.sh must accept PREV_AGENTIC_HEAD positional');
  });
});

describe('ADR-0150: bundle-native-binaries.sh wiring', () => {
  const BUNDLE = '/Users/henrik/source/ruflo-patch/scripts/bundle-native-binaries.sh';

  it('sources lib/napi-config.sh', () => {
    const src = readFileSync(BUNDLE, 'utf8');
    assert.match(src, /source\s+["']?\$\{?ROOT_DIR\}?\/lib\/napi-config\.sh/,
      'bundle-native-binaries.sh must source lib/napi-config.sh');
  });

  it('iterates NAPI_PACKAGES', () => {
    const src = readFileSync(BUNDLE, 'utf8');
    assert.match(src, /for entry in "\$\{NAPI_PACKAGES\[@\]\}"/,
      'bundle-native-binaries.sh must iterate NAPI_PACKAGES');
  });

  it('handles agentic-flow build path', () => {
    const src = readFileSync(BUNDLE, 'utf8');
    assert.match(src, /FORK_DIR_AGENTIC.*cross-repo\/agentic-flow/,
      'bundle-native-binaries.sh must map FORK_DIR_AGENTIC → cross-repo/agentic-flow');
  });
});

describe('ADR-0150: copy-source.sh narrowed exclude', () => {
  const COPY_SRC = '/Users/henrik/source/ruflo-patch/scripts/copy-source.sh';

  it('does NOT exclude *.node broadly for agentic-jujutsu', () => {
    const src = readFileSync(COPY_SRC, 'utf8');
    assert.doesNotMatch(src, /--exclude='packages\/agentic-jujutsu\/\*\.node'/,
      'broad *.node exclude must be removed (was blocking darwin-arm64 binary from shipping)');
  });

  it('excludes non-darwin-arm64 platforms specifically', () => {
    const src = readFileSync(COPY_SRC, 'utf8');
    assert.match(src, /agentic-jujutsu\/\*\.linux-\*\.node/,
      'must still exclude *.linux-*.node (we only ship darwin-arm64)');
    assert.match(src, /agentic-jujutsu\/\*\.win32-\*\.node/,
      'must still exclude *.win32-*.node');
  });
});

describe('ADR-0150: ruflo-publish.sh passes PREV_AGENTIC_HEAD to napi-rebuild', () => {
  const PUB = '/Users/henrik/source/ruflo-patch/scripts/ruflo-publish.sh';

  it('passes PREV_AGENTIC_HEAD as second positional', () => {
    const src = readFileSync(PUB, 'utf8');
    assert.match(src, /napi-rebuild\.sh"[\s\S]*?PREV_AGENTIC_HEAD/,
      'ruflo-publish.sh must pass PREV_AGENTIC_HEAD to napi-rebuild.sh');
  });
});
