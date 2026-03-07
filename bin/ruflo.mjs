#!/usr/bin/env node
// bin/ruflo.mjs — CLI entry point for ruflo
//
// Drop-in replacement for ruflo / @claude-flow/cli (ADR-0007).
// Proxies all commands to @sparkleideas/cli@latest via npx.
//
// Zero dependencies on @sparkleideas/cli — always resolves fresh at
// runtime. This eliminates npx cache staleness, semver range mismatches,
// and ESM exports map resolution issues.

import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const [,, command, ...args] = process.argv;

function showHelp() {
  console.log(`ruflo — Drop-in replacement for ruflo / @claude-flow/cli

Usage:
  ruflo <command> [options]        Run any ruflo/claude-flow command
  ruflo init                      Initialize a new project
  ruflo agent spawn -t coder      Spawn an agent
  ruflo mcp start                 Start the MCP server
  ruflo doctor                    Diagnose issues

Options:
  --help, -h                      Show this help
  --version, -V                   Show version`);
}

// Handle help and version
if (command === '--help' || command === '-h' || command === undefined) {
  showHelp();
  process.exit(0);
}

if (command === '--version' || command === '-V') {
  const { readFileSync } = await import('node:fs');
  const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8'));
  console.log(`ruflo ${pkg.version}`);
  process.exit(0);
}

// All commands: proxy to @sparkleideas/cli@latest via npx.
// No bundled dependency — always resolves the latest CLI at runtime.
try {
  execFileSync('npx', ['--yes', '@sparkleideas/cli@latest', command, ...args], {
    stdio: 'inherit',
    env: { ...process.env, npm_config_update_notifier: 'false' },
  });
} catch (e) {
  process.exit(e.status || 1);
}
