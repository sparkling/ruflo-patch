#!/usr/bin/env node
// bin/ruflo.mjs — CLI entry point for ruflo
//
// Drop-in replacement for ruflo / @claude-flow/cli (ADR-0007).
// Proxies all commands to @sparkleideas/cli, with additional
// legacy patch commands (apply, check, repair).

import { execSync, execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const [,, command, ...args] = process.argv;

// Legacy patch commands — handled locally
const PATCH_COMMANDS = new Set(['apply', 'check', 'repair']);

function runBash(script, extraArgs = '') {
  const cmd = `bash "${ROOT}/${script}" ${extraArgs}`.trim();
  try {
    execSync(cmd, { stdio: 'inherit' });
  } catch (e) {
    process.exit(e.status || 1);
  }
}

function showHelp() {
  console.log(`ruflo — Drop-in replacement for ruflo / @claude-flow/cli

Usage:
  ruflo <command> [options]        Run any ruflo/claude-flow command
  ruflo init                      Initialize a new project
  ruflo agent spawn -t coder      Spawn an agent
  ruflo mcp start                 Start the MCP server
  ruflo doctor                    Diagnose issues

Patch commands (legacy):
  ruflo apply [--global] [--target <dir>]   Apply runtime patches
  ruflo check [--global] [--target <dir>]   Verify patches are applied
  ruflo repair [--target <dir>]             Repair post-init helpers

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

// Legacy patch commands
if (PATCH_COMMANDS.has(command)) {
  const passthrough = args.join(' ');
  switch (command) {
    case 'apply':
      runBash('patch-all.sh', passthrough || '--global');
      break;
    case 'check':
      runBash('check-patches.sh', passthrough || '--global');
      break;
    case 'repair':
      runBash('repair-post-init.sh', passthrough);
      break;
  }
  process.exit(0);
}

// All other commands: proxy to @sparkleideas/cli
try {
  // Resolve the CLI package entry via ESM import.meta.resolve (works with exports maps)
  const cliEntry = import.meta.resolve('@sparkleideas/cli');
  const cliSrc = new URL(cliEntry).pathname;
  // Navigate from dist/src/index.js up to the package root, then to bin/cli.js
  const cliDir = resolve(dirname(cliSrc), '..', '..');
  const cliBin = resolve(cliDir, 'bin', 'cli.js');

  // Re-exec with the CLI binary, passing all original args
  execFileSync(process.execPath, [cliBin, command, ...args], {
    stdio: 'inherit',
    env: process.env,
  });
} catch (e) {
  if (e.code === 'ERR_MODULE_NOT_FOUND' || e.code === 'MODULE_NOT_FOUND' || e.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED') {
    console.error('Error: @sparkleideas/cli not found. Run: npm install @sparkleideas/ruflo');
    process.exit(1);
  }
  // execFileSync throws on non-zero exit
  process.exit(e.status || 1);
}
