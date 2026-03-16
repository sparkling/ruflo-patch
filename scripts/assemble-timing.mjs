#!/usr/bin/env node
// scripts/assemble-timing.mjs — Assemble pipeline timing JSON (extracted from pipeline-utils.sh)
//
// Reads phase timings, per-command JSONL, per-package JSONL, publish timing,
// and verify-phase JSONL, then writes a consolidated pipeline-timing.json.
//
// Usage:
//   node scripts/assemble-timing.mjs \
//     --phase-timings "merge-detect:2341 bump:5123" \
//     --cmds-file /tmp/ruflo-timing-cmds.jsonl \
//     --build-pkgs-file /tmp/ruflo-timing-build-pkgs.jsonl \
//     --project-dir /home/claude/src/ruflo-patch \
//     --timestamp 20260316T012345Z \
//     --version 3.5.15-patch.39 \
//     --total-ms 45678 \
//     --output /path/to/output.json

import { readFileSync, writeFileSync } from 'node:fs';

// ---------------------------------------------------------------------------
// CLI arg parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const key = argv[i];
    const val = argv[i + 1] ?? '';
    switch (key) {
      case '--phase-timings':   args.phaseTimings = val; i++; break;
      case '--cmds-file':       args.cmdsFile = val; i++; break;
      case '--build-pkgs-file': args.buildPkgsFile = val; i++; break;
      case '--project-dir':     args.projectDir = val; i++; break;
      case '--timestamp':       args.timestamp = val; i++; break;
      case '--version':         args.version = val; i++; break;
      case '--total-ms':        args.totalMs = parseInt(val, 10) || 0; i++; break;
      case '--output':          args.output = val; i++; break;
      default:
        process.stderr.write(`Unknown flag: ${key}\n`);
        process.exit(1);
    }
  }
  return args;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Read a JSONL file, returning an array of parsed objects (empty on error). */
function readJsonl(path) {
  try {
    return readFileSync(path, 'utf-8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line));
  } catch {
    return [];
  }
}

/** Read a JSON file, returning parsed value (fallback on error). */
function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const args = parseArgs(process.argv);

// Phase timings from space-separated "name:ms" pairs
const phases = (args.phaseTimings || '')
  .trim()
  .split(/\s+/)
  .filter(Boolean)
  .map(entry => {
    const i = entry.lastIndexOf(':');
    return { name: entry.slice(0, i), duration_ms: parseInt(entry.slice(i + 1), 10) };
  });

// Per-command timing
const commands = readJsonl(args.cmdsFile || '');

// Per-package build timing
const buildPkgs = readJsonl(args.buildPkgsFile || '');

// Publish timing
const publishPkgs = readJson(
  `${args.projectDir || '.'}/config/.publish-timing.json`,
  []
);

// Verify sub-phases (Verdaccio publish + acceptance)
const verifyPhases = [
  '/tmp/ruflo-publish-verdaccio-timing.jsonl',
  '/tmp/ruflo-acceptance-timing.jsonl',
].flatMap(f => readJsonl(f));

const result = {
  timestamp: args.timestamp || '',
  version: args.version || 'unknown',
  total_duration_ms: args.totalMs || 0,
  acceptance_passed: true,
  phases,
  commands,
  verify_phases: verifyPhases,
  packages: {
    build: buildPkgs,
    publish: publishPkgs.map(p => ({
      name: p.name,
      duration_ms: p.duration_ms || 0,
      version: p.version || '',
      tag: p.tag || '',
    })),
  },
};

writeFileSync(args.output, JSON.stringify(result, null, 2) + '\n');
