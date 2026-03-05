#!/usr/bin/env node
// Test runner — runs all test files in tests/ directory.
//
// Usage: node scripts/test-runner.mjs
//        node scripts/test-runner.mjs --save-results
//        SAVE_TEST_RESULTS=1 npm test

import { spawn, execSync } from 'node:child_process';
import { readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';

const MAX_SKIPS = parseInt(process.env.SKIP_THRESHOLD || '8', 10);
const saveResults = process.argv.includes('--save-results') ||
  process.env.SAVE_TEST_RESULTS === '1';

const projectRoot = resolve(import.meta.dirname, '..');
const testsDir = resolve(projectRoot, 'tests');

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

// Prepare results directory when saving
let resultsDir;
let tapFile;
if (saveResults) {
  const timestamp = new Date().toISOString().replace(/:/g, '-');
  resultsDir = resolve(projectRoot, 'test-results', timestamp);
  mkdirSync(resultsDir, { recursive: true });
  tapFile = join(resultsDir, 'unit-results.tap');
}

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

// When saving results, use dual reporters: spec to stdout, TAP to file
if (saveResults) {
  args.unshift(
    '--test-reporter=spec', '--test-reporter-destination=stdout',
    '--test-reporter=tap', `--test-reporter-destination=${tapFile}`,
  );
}

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

// Write manifest and print confirmation when saving results
if (saveResults && resultsDir) {
  const testFileNames = allFiles.map(f => basename(f));

  // Count pass/fail from summary lines (spec: "ℹ pass N", TAP: "# pass N")
  let passCount = 0;
  let failCount = 0;
  const summaryPass = allOutput.match(/(?:ℹ|#) pass (\d+)/);
  const summaryFail = allOutput.match(/(?:ℹ|#) fail (\d+)/);
  if (summaryPass || summaryFail) {
    passCount = summaryPass ? parseInt(summaryPass[1], 10) : 0;
    failCount = summaryFail ? parseInt(summaryFail[1], 10) : 0;
  } else {
    const tapOk = allOutput.match(/^ok \d+/gm);
    const tapNotOk = allOutput.match(/^not ok \d+/gm);
    passCount = tapOk ? tapOk.length : 0;
    failCount = tapNotOk ? tapNotOk.length : 0;
  }

  let gitHead = 'unknown';
  try { gitHead = execSync('git rev-parse HEAD', { cwd: projectRoot, encoding: 'utf-8' }).trim(); } catch {}

  let nodeVersion = process.version;

  const manifest = {
    timestamp: new Date().toISOString(),
    ruflo_patch_head: gitHead,
    node_version: nodeVersion,
    platform: `${process.platform}-${process.arch}`,
    test_files: testFileNames,
    test_count: passCount + failCount,
    pass_count: passCount,
    fail_count: failCount,
    duration_ms: elapsed,
  };

  writeFileSync(join(resultsDir, '.test-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Results saved to ${resultsDir.replace(projectRoot + '/', '')}/`);
}

process.exit(result.code);
