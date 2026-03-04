#!/usr/bin/env node
// Test runner — runs all test files in tests/ directory.
//
// Usage: node scripts/test-runner.mjs
//        npm test

import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

const MAX_SKIPS = parseInt(process.env.SKIP_THRESHOLD || '8', 10);

const testsDir = resolve(import.meta.dirname, '..', 'tests');

let allFiles;
try {
  allFiles = readdirSync(testsDir)
    .filter(f => f.endsWith('.test.mjs'))
    .map(f => join(testsDir, f));
} catch {
  console.log('No test files found.');
  process.exit(0);
}

if (allFiles.length === 0) {
  console.log('No test files found.');
  process.exit(0);
}

console.log(`test-runner — ${allFiles.length} files`);

function runTests(args) {
  return new Promise((resolve) => {
    const child = spawn('node', args, { stdio: ['inherit', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf-8');
    child.stderr.setEncoding('utf-8');
    child.stdout.on('data', (d) => { stdout += d; process.stdout.write(d); });
    child.stderr.on('data', (d) => { stderr += d; process.stderr.write(d); });
    const timer = setTimeout(() => { child.kill('SIGTERM'); }, 600_000);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code: code ?? 1, stdout, stderr }); });
  });
}

const t0 = Date.now();
const args = ['--test', ...allFiles];
const result = await runTests(args);
const elapsed = Date.now() - t0;

console.log(`\ntotal: ${(elapsed / 1000).toFixed(1)}s`);

// Skip threshold enforcement
let skipCount = 0;
const allOutput = (result.stdout || '') + (result.stderr || '');
const tapSkips = allOutput.match(/^ok \d+.*# SKIP/gm);
if (tapSkips) skipCount = tapSkips.length;

if (skipCount > MAX_SKIPS) {
  console.error(`\nERROR: ${skipCount} tests skipped (max ${MAX_SKIPS}).`);
  process.exit(1);
}

process.exit(result.code);
