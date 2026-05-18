// @tier integration
// Placeholder test for the integration tier (tests/integration/).
//
// This file's job is purely to validate that the test runner picks up
// files from this directory + that node:test works here. Real
// cross-module integration tests get added as they're identified.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

describe('integration tier — scaffold', () => {
  it('the integration runner reaches this test', () => {
    // If you're reading the result of this test, the integration tier is wired.
    assert.equal(1 + 1, 2);
  });

  it('node:test is available in this tier', () => {
    assert.ok(typeof describe === 'function');
    assert.ok(typeof it === 'function');
  });
});
