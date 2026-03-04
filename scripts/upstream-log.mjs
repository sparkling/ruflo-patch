#!/usr/bin/env node
// scripts/upstream-log.mjs — Show recent upstream releases of ruflo / @claude-flow/cli.
//
// Usage: node scripts/upstream-log.mjs [count]

import { execSync } from 'node:child_process';

const count = parseInt(process.argv[2] || '10', 10);

try {
  const output = execSync(`npm view ruflo versions --json`, { encoding: 'utf-8' });
  const versions = JSON.parse(output);
  const recent = versions.slice(-count);
  console.log(`Last ${recent.length} versions of ruflo:`);
  for (const v of recent) {
    console.log(`  ${v}`);
  }
} catch (e) {
  console.error('Failed to fetch upstream versions:', e.message);
  process.exit(1);
}
