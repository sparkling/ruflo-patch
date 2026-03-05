// tests/helpers/fixture-factory.mjs — Creates temp copies of test fixtures.
// Returns { base, cleanup } where base is the dist/src directory.

import { mkdtempSync, cpSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(__dirname, '..', 'fixtures', 'cli', 'dist', 'src');

export function createFixture() {
  const tmp = mkdtempSync(join(tmpdir(), 'ruflo-test-'));
  const base = join(tmp, 'dist', 'src');
  try {
    cpSync(FIXTURES, base, { recursive: true });
  } catch {
    // Fixtures may not exist yet — create minimal structure
    const { mkdirSync, writeFileSync } = await import('node:fs');
    mkdirSync(base, { recursive: true });
  }
  return {
    base,
    root: tmp,
    cleanup() {
      rmSync(tmp, { recursive: true, force: true });
    },
  };
}
