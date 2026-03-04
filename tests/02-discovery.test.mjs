// @tier unit
// Tests for lib/discover.mjs — patch directory scanning.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

describe('discover.mjs', () => {
  it('exports a discover() function', async () => {
    const mod = await import(resolve(ROOT, 'lib', 'discover.mjs'));
    assert.equal(typeof mod.discover, 'function');
  });

  it('returns valid structure with empty patch dir', async () => {
    const mod = await import(resolve(ROOT, 'lib', 'discover.mjs'));
    const result = mod.discover();
    assert.ok(Array.isArray(result.patches));
    assert.ok(typeof result.stats === 'object');
    assert.ok(typeof result.stats.total === 'number');
    assert.ok(typeof result.stats.categories === 'number');
  });
});
