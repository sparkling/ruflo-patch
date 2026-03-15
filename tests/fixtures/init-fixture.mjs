import { mkdtempSync, rmSync, readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

// Walk directory recursively, return relative paths
function walkSync(dir, base = dir) {
  const results = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      const rel = full.slice(base.length + 1);
      if (entry.isDirectory()) {
        results.push(...walkSync(full, base));
      } else {
        results.push(rel);
      }
    }
  } catch { /* permission error or symlink loop */ }
  return results;
}

const MODES = ['standard', 'minimal', 'full'];
const fixtures = new Map();
let initialized = false;

export async function getFixtures() {
  if (initialized) return fixtures;

  for (const mode of MODES) {
    const dir = mkdtempSync(join(tmpdir(), `init-test-${mode}-`));
    const flags = mode === 'minimal' ? '--minimal'
                : mode === 'full'    ? '--full'
                : '';
    try {
      execSync(
        `npx --yes @sparkleideas/cli init ${flags} --force`,
        { cwd: dir, timeout: 30000, stdio: 'pipe',
          env: { ...process.env, NPM_CONFIG_REGISTRY: 'http://localhost:4873', npm_config_update_notifier: 'false' } }
      );
    } catch (e) {
      // Init may exit non-zero but still produce files
      console.error(`[fixture] init ${mode} exited with error: ${e.message?.slice(0, 100)}`);
    }
    const files = walkSync(dir);
    fixtures.set(mode, { dir, files, mode });
  }
  initialized = true;
  return fixtures;
}

export function cleanupFixtures() {
  for (const { dir } of fixtures.values()) {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
  fixtures.clear();
  initialized = false;
}

export { MODES };
