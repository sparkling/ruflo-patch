// @tier unit
// MCP stdio JSON-RPC reply-channel integrity — SOURCE-SHAPE contracts (unit-tier).
//
// Regression guard for the "lost first-store reply" defect (2026-05-21):
//
//   The served MCP stdio loop (bin/cli.js + bin/mcp-server.js) wrote every
//   JSON-RPC frame via console.log. Controller-registry init
//   (@claude-flow/cli/src/memory/memory-router.ts ~:594) monkey-patches
//   console.log to a blanket no-op to keep controller noise (GNN/Sona/WASM/...)
//   off stdout during init. The FIRST memory_store triggers that patch — via
//   getController('memoryGraph') (mcp-tools/memory-tools.ts:328), run AFTER the
//   store's persist+embed+index work completes — and a timing race
//   (getController's fast-path returns before the ~500ms console restore) left
//   the reply frame swallowed. The store persisted, but the client hung with no
//   reply (and the embedding cold-load made it look like a hang). Subsequent
//   stores replied normally (console already restored). The race is why the
//   existing behavioural check passed in some runs and not others.
//
// The fix: JSON-RPC frames go to the RAW stdout channel via a `writeFrame`
// helper (process.stdout.write), which is immune to any in-process console
// reassignment — the same separation stderr already has via console.error. The
// console no-op keeps doing its job (controller noise off stdout) but can no
// longer eat a protocol frame.
//
// These assertions read the fork source directly and are fully deterministic
// (same pattern as rvf-concurrent-init.test.mjs). The BEHAVIOURAL round-trip
// lives in the acceptance tier (check_adr0204_archivist_rt in
// lib/acceptance-adr0204-checks.sh), which now FAILS if the first store's reply
// is MISSING rather than tolerating it.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const BINS = [
  ['bin/cli.js', '/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/bin/cli.js'],
  ['bin/mcp-server.js', '/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/bin/mcp-server.js'],
];

// `const writeFrame = (obj) => process.stdout.write(JSON.stringify(obj) + '\n');`
const WRITE_FRAME_DEF =
  /const writeFrame = \(obj\)\s*=>\s*process\.stdout\.write\(JSON\.stringify\(obj\)\s*\+\s*['"]\\n['"]\)/;

for (const [label, path] of BINS) {
  describe(`MCP stdio reply channel: ${label} writes JSON-RPC frames to raw stdout`, () => {
    it('defines a writeFrame helper backed by process.stdout.write', () => {
      const src = readFileSync(path, 'utf8');
      assert.match(src, WRITE_FRAME_DEF,
        `${label} must define writeFrame via process.stdout.write so JSON-RPC frames bypass console.log`);
    });

    it('writes the tool response via writeFrame, not console.log', () => {
      const src = readFileSync(path, 'utf8');
      assert.match(src, /writeFrame\(response\)/,
        `${label} must write the tool response via writeFrame(response)`);
      assert.ok(!src.includes('console.log(JSON.stringify(response))'),
        `${label} must NOT write the reply via console.log — it is monkey-patched to a no-op during controller-registry init (lost-reply regression)`);
    });

    it('writes no JSON-RPC frame via console.log(JSON.stringify(...)) in the stdio loop', () => {
      const src = readFileSync(path, 'utf8');
      // Scope to the stdio serving region: from the writeFrame definition to the
      // stdin 'end' handler. (The CLI's non-MCP command output is out of scope.)
      const start = src.indexOf('const writeFrame =');
      const end = src.indexOf("process.stdin.on('end'", start);
      assert.ok(start >= 0 && end > start,
        `${label}: could not locate the MCP stdio region (writeFrame .. stdin 'end')`);
      const region = src.slice(start, end);
      assert.ok(!/console\.log\(JSON\.stringify\(/.test(region),
        `${label}: JSON-RPC frames in the stdio loop must use writeFrame (raw stdout), never console.log`);
    });
  });
}
