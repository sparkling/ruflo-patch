// ADR-0167 Amendment 2026-05-22 — regression guard.
//
// The `memory_search` MCP tool must default the similarity threshold with
// NULLISH coalescing (`input.threshold ?? 0.3`), NOT logical-OR
// (`input.threshold || 0.3`). The `||` form coerces an explicit `threshold: 0`
// (caller means "no minimum") into `0.3`, which drops every legitimately
// related hit (document embeddings score ~0.2-0.5 cosine) and surfaces only
// near-exact (~1.0) matches — the root cause of `memory_search` returning
// `total: 0` and the swarm dialectic failing to recall its own memories.
// Upstream uses `?? 0.3` at the same line; this re-converges (forks/ruflo
// `a02e561ac`). The earlier "RVF snapshot staleness" diagnosis (Phase 3) was
// wrong and was reverted (`bf71e2bd3`).
//
// Reads the codemod-built dist (ADR-0225 build → test-ci ordering); skips if a
// build is absent (standalone dev run without `npm run build`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const DIST =
  '/tmp/ruflo-build/v3/@claude-flow/cli/dist/src/mcp-tools/memory-tools.js';

test('memory_search threshold default uses nullish ?? (honors threshold:0) — ADR-0167 2026-05-22', () => {
  if (!existsSync(DIST)) {
    console.log(
      `SKIP_BUILD_ABSENT: ${DIST} not built — run after \`npm run build\` (test-ci builds first per ADR-0225)`,
    );
    return;
  }
  const src = readFileSync(DIST, 'utf8');
  assert.match(
    src,
    /input\.threshold\s*\?\?\s*0\.3/,
    'memory_search threshold must be `input.threshold ?? 0.3` (nullish), so an explicit threshold:0 is honored — matches upstream',
  );
  assert.doesNotMatch(
    src,
    /input\.threshold\s*\|\|\s*0\.3/,
    'memory_search threshold must NOT use `|| 0.3` (falsy): it coerces explicit threshold:0 -> 0.3 and drops related hits. See ADR-0167 Amendment 2026-05-22.',
  );
});
