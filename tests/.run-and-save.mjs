#!/usr/bin/env node
// One-shot test runner that writes output to /tmp/unit-test-run.txt
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { resolve } from 'node:path';

const projectRoot = resolve(import.meta.dirname, '..');
const outPath = '/tmp/unit-test-run.txt';
const out = createWriteStream(outPath);

out.write(`=== Test run started: ${new Date().toISOString()} ===\n`);
out.write(`Command: node --test tests/04-codemod.test.mjs tests/05-pipeline-logic.test.mjs tests/fork-version.test.mjs tests/06-publish-order.test.mjs\n`);
out.write(`CWD: ${projectRoot}\n\n`);

const proc = spawn(process.execPath, [
  '--test',
  'tests/04-codemod.test.mjs',
  'tests/05-pipeline-logic.test.mjs',
  'tests/fork-version.test.mjs',
  'tests/06-publish-order.test.mjs'
], {
  cwd: projectRoot,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, FORCE_COLOR: '0' }
});

proc.stdout.on('data', d => out.write(d));
proc.stderr.on('data', d => out.write(d));

proc.on('close', (code) => {
  out.write(`\n=== Test run finished: ${new Date().toISOString()} ===\n`);
  out.write(`Exit code: ${code}\n`);
  out.end(() => {
    process.exit(code ?? 1);
  });
});
