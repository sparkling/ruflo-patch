// @tier unit
// ADR-0232 §Confirmation #4 — schema validation for lib/wasm-config.sh.
// Paralleling tests/unit/adr0150-napi-config.test.mjs.
//
// Asserts:
//   - WASM_PACKAGES array exists + is well-formed
//   - Each entry has the shape "FORK_DIR_<NAME>:<crate>:<dest>"
//   - <fork_var> matches one of the known FORK_DIR_* names
//   - <crate_path> resolves under the fork (the Cargo.toml exists)
//   - The helpers wasm_parse_entry / wasm_unique_forks exist and behave

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const WASM_CONFIG = resolve(ROOT, 'lib', 'wasm-config.sh');
const FORK_PATHS = resolve(ROOT, 'lib', 'fork-paths.sh');
const FORKS_ROOT = resolve(ROOT, '..', 'forks');

const KNOWN_FORK_VARS = new Set([
  'FORK_DIR_RUFLO',
  'FORK_DIR_AGENTIC',
  'FORK_DIR_FANN',
  'FORK_DIR_RUVECTOR',
  'FORK_DIR_AGENTDB',
]);

function parseEntries() {
  const src = readFileSync(WASM_CONFIG, 'utf8');
  const m = src.match(/WASM_PACKAGES=\(([\s\S]*?)\n\)/);
  assert.ok(m, 'WASM_PACKAGES=( ... ) array not found in lib/wasm-config.sh');
  const body = m[1];
  const entries = [];
  const re = /"([^"]+)"/g;
  let n;
  while ((n = re.exec(body)) !== null) entries.push(n[1]);
  return entries;
}

test('ADR-0232: lib/wasm-config.sh exists', () => {
  assert.ok(existsSync(WASM_CONFIG), `${WASM_CONFIG} missing`);
});

test('ADR-0232: WASM_PACKAGES array is well-formed', () => {
  const entries = parseEntries();
  assert.ok(entries.length >= 1, 'WASM_PACKAGES must have at least one entry per ADR-0232 Confirmation #1');
  for (const e of entries) {
    const parts = e.split(':');
    assert.strictEqual(parts.length, 3,
      `entry "${e}" must have shape FORK_VAR:crate_path:dest_npm_dir`);
    const [forkVar, cratePath, destDir] = parts;
    assert.ok(KNOWN_FORK_VARS.has(forkVar),
      `entry "${e}" — fork var "${forkVar}" not in KNOWN_FORK_VARS`);
    assert.ok(cratePath.length > 0, `entry "${e}" — empty crate_path`);
    assert.ok(destDir.length > 0, `entry "${e}" — empty dest_npm_dir`);
  }
});

test('ADR-0232 Confirmation #1: ruvllm-wasm entry present', () => {
  const entries = parseEntries();
  const found = entries.find((e) =>
    e.includes('FORK_DIR_RUVECTOR') && e.includes('ruvllm-wasm'));
  assert.ok(found, 'WASM_PACKAGES must include ruvllm-wasm per ADR-0232 §Confirmation #1');
});

test('ADR-0232: each entry’s crate dir has Cargo.toml', () => {
  const entries = parseEntries();
  const forkPaths = readFileSync(FORK_PATHS, 'utf8');
  // Resolve FORK_DIR_* by parsing the export lines.
  const forkResolver = {};
  for (const m of forkPaths.matchAll(/FORK_DIR_(\w+)=["']([^"']+)["']/g)) {
    forkResolver[`FORK_DIR_${m[1]}`] = m[2];
  }
  // Fallback: standard layout under ../forks/<name>/
  for (const e of entries) {
    const [forkVar, cratePath] = e.split(':');
    let forkDir = forkResolver[forkVar];
    if (!forkDir) {
      // Fall back to the standard ../forks/<lowercase-suffix>/ layout
      const suffix = forkVar.replace('FORK_DIR_', '').toLowerCase();
      // FANN is special-cased — directory is ruv-FANN
      const dirName = suffix === 'fann' ? 'ruv-FANN' : suffix;
      forkDir = join(FORKS_ROOT, dirName);
    }
    const cargoPath = join(forkDir, cratePath, 'Cargo.toml');
    assert.ok(existsSync(cargoPath),
      `entry "${e}" — Cargo.toml not found at ${cargoPath}`);
  }
});

test('ADR-0232: wasm_parse_entry + wasm_unique_forks helpers exist', () => {
  const src = readFileSync(WASM_CONFIG, 'utf8');
  assert.match(src, /wasm_parse_entry\(\)/, 'wasm_parse_entry helper missing');
  assert.match(src, /wasm_unique_forks\(\)/, 'wasm_unique_forks helper missing');
});

test('ADR-0232: wasm-rebuild.sh exists + has correct shebang', () => {
  const script = resolve(ROOT, 'scripts', 'wasm-rebuild.sh');
  assert.ok(existsSync(script), `${script} missing`);
  const src = readFileSync(script, 'utf8');
  assert.ok(src.startsWith('#!/usr/bin/env bash'), 'wasm-rebuild.sh missing bash shebang');
  // bash -n syntax check
  execSync(`bash -n ${script}`, { stdio: 'pipe' });
});

test('ADR-0232: wasm-rebuild wired into ruflo-publish.sh after napi-rebuild', () => {
  const publishScript = resolve(ROOT, 'scripts', 'ruflo-publish.sh');
  const src = readFileSync(publishScript, 'utf8');
  const napiIdx = src.indexOf('run_phase "napi-rebuild"');
  const wasmIdx = src.indexOf('run_phase "wasm-rebuild"');
  assert.ok(napiIdx > 0, 'napi-rebuild phase not found in ruflo-publish.sh');
  assert.ok(wasmIdx > 0, 'wasm-rebuild phase not found in ruflo-publish.sh');
  assert.ok(wasmIdx > napiIdx, 'wasm-rebuild must run AFTER napi-rebuild per ADR-0232 §Decision Outcome');
});
