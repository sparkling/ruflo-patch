#!/usr/bin/env node
// bin/ruflo.mjs — CLI entry point for ruflo
//
// Usage:
//   ruflo apply [--global] [--target <dir>]
//   ruflo check [--global] [--target <dir>]
//   ruflo repair [--target <dir>]
//   ruflo --help

import { execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const [,, command, ...args] = process.argv;
const passthrough = args.join(' ');

function run(script, extraArgs = '') {
  const cmd = `bash "${ROOT}/${script}" ${extraArgs}`.trim();
  try {
    execSync(cmd, { stdio: 'inherit' });
  } catch (e) {
    process.exit(e.status || 1);
  }
}

switch (command) {
  case 'apply':
    run('patch-all.sh', passthrough || '--global');
    break;
  case 'check':
    run('check-patches.sh', passthrough || '--global');
    break;
  case 'repair':
    run('repair-post-init.sh', passthrough);
    break;
  case '--help':
  case '-h':
  case undefined:
    console.log(`ruflo — Runtime patches for ruflo and related packages

Usage:
  ruflo apply [--global] [--target <dir>]   Apply all patches
  ruflo check [--global] [--target <dir>]   Verify patches are applied
  ruflo repair [--target <dir>]             Repair post-init helpers
  ruflo --help                              Show this help

Options:
  --global           Patch all global installs (npx cache + npm global)
  --target <dir>     Patch node_modules inside <dir>

If neither flag is given, --global is assumed.`);
    break;
  default:
    console.error(`Unknown command: ${command}`);
    console.error('Run: ruflo --help');
    process.exit(1);
}
