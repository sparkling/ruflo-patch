// tests/helpers/run-python.mjs — Runs common.py + fix.py against a fixture.

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const COMMON_PY = resolve(ROOT, 'lib', 'common.py');

/**
 * Run a fix.py against a temporary fixture.
 * @param {string} fixPyPath - Absolute path to fix.py
 * @param {string} base - dist/src directory (set as BASE env var)
 * @param {object} [opts] - Extra env vars
 * @returns {{ stdout: string, stderr: string, status: number }}
 */
export function runPatch(fixPyPath, base, opts = {}) {
  const commonPy = readFileSync(COMMON_PY, 'utf-8');
  const fixPy = readFileSync(fixPyPath, 'utf-8');
  const script = commonPy + '\n' + fixPy + '\nprint(f"Done: {applied} applied, {skipped} already present")';

  const result = spawnSync('python3', ['-c', script], {
    env: {
      ...process.env,
      BASE: base,
      RUVECTOR_CLI: opts.ruvectorCli || '',
      RUV_SWARM_ROOT: opts.ruvSwarmRoot || '',
      ...opts.env,
    },
    encoding: 'utf-8',
  });

  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    status: result.status,
  };
}
