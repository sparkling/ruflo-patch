#!/usr/bin/env node
// scripts/regen-mcp-manifest.mjs — STUB
//
// Regenerate config/mcp-surface-manifest.json from the pinned Verdaccio
// tarball's actual surface list. Used by ADR-0094's two-number coverage
// metric and by preflight's rot-detection.
//
// Modes:
//   (default)    — regenerate. Queries the pinned CLI for `mcp list-tools`
//                  and `--help`, sorts, writes the manifest.
//   --verify     — read current manifest + live CLI surface list; exit
//                  non-zero if they diverge. Wired into preflight.
//   --show       — print the manifest summary to stdout.
//
// Contract (to be implemented — see ADR-0096):
//   manifest.mcp_tools            — sorted array of tool names from the
//                                   published CLI's `mcp list-tools` output.
//   manifest.cli_subcommands      — sorted array of CLI subcommand names
//                                   from the published CLI's `--help` output.
//   manifest._pinned_cli_version  — matches npm view @sparkleideas/cli@latest.
//   manifest._counts              — derived; total_surfaces is the denominator
//                                   for invoked_coverage / verified_coverage.
//
// ADR: ADR-0094 §Coverage Metric, ADR-0096 §Layer 3 (catalog integration).
// Status: STUB — full implementation lands with ADR-0096.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = resolve(__dirname, '..', 'config', 'mcp-surface-manifest.json');

const args = process.argv.slice(2);
const mode = args.includes('--verify') ? 'verify' :
             args.includes('--show')   ? 'show'   :
                                          'regen';

function loadManifest() {
  if (!existsSync(MANIFEST_PATH)) {
    console.error(`[regen-mcp-manifest] manifest not found: ${MANIFEST_PATH}`);
    process.exit(2);
  }
  return JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));
}

function showStub() {
  const m = loadManifest();
  console.log('[regen-mcp-manifest] --show');
  console.log(`  pinned_cli_version: ${m._pinned_cli_version ?? '<unpinned>'}`);
  console.log(`  mcp_tools:          ${m._counts?.mcp_tools ?? 0}`);
  console.log(`  cli_subcommands:    ${m._counts?.cli_subcommands ?? 0}`);
  console.log(`  total_surfaces:     ${m._counts?.total_surfaces ?? 0}`);
  console.log(`  generated_at:       ${m._generated_at ?? '<never>'}`);
  console.log(`  status:             STUB — full implementation in ADR-0096`);
}

function regenStub() {
  console.log('[regen-mcp-manifest] STUB — regeneration requires:');
  console.log('  1. npm view @sparkleideas/cli@latest version → pin');
  console.log('  2. install CLI in a fresh temp dir');
  console.log('  3. run `cli mcp list-tools --json` → enumerate mcp_tools');
  console.log('  4. parse `cli --help` → enumerate cli_subcommands');
  console.log('  5. sort both arrays; write manifest');
  console.log('See ADR-0096 acceptance criterion #1.');
  process.exit(0);
}

function verifyStub() {
  const m = loadManifest();
  const issues = [];
  if (!m._pinned_cli_version) issues.push('manifest has no _pinned_cli_version');
  if (!Array.isArray(m.mcp_tools)) issues.push('manifest.mcp_tools is not an array');
  if (!Array.isArray(m.cli_subcommands)) issues.push('manifest.cli_subcommands is not an array');
  // TODO: when implementation lands, diff against live CLI output.
  if (issues.length) {
    console.error('[regen-mcp-manifest] --verify failed (stub):');
    for (const i of issues) console.error(`  - ${i}`);
    process.exit(1);
  }
  console.log('[regen-mcp-manifest] --verify OK (stub — only structural checks; full diff in ADR-0096)');
}

if      (mode === 'show')   showStub();
else if (mode === 'regen')  regenStub();
else if (mode === 'verify') verifyStub();
