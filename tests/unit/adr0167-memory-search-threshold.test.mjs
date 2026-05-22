// ADR-0167 (2026-05-22) → superseded by ADR-0227 (2026-05-22) — memory_search
// threshold regression guard (dist marker).
//
// History:
//   - Original bug: `input.threshold || 0.3` (logical-OR) coerced an explicit
//     `threshold: 0` ("no minimum") into 0.3, dropping related hits.
//   - ADR-0167 fix: `?? 0.3` (nullish) — honored threshold:0, kept 0.3 default.
//   - ADR-0227: removed the hardcoded default ENTIRELY. memory_search now passes
//     the caller's threshold THROUGH (possibly undefined) so the router resolves
//     it via getAdaptiveThreshold (FB-004 adaptive layer; ONNX floor 0.15, since
//     measured mpnet related content scores ~0.25-0.65 and 0.3 cut into recall).
//     An explicit `threshold: 0` is still honored end-to-end. Hardcoding `?? 0.3`
//     defeated the adaptive layer for the MCP path.
//
// Enduring guards (both must hold in the compiled dist):
//   - NO `input.threshold || 0.3` (the original falsy-zero bug — ADR-0167).
//   - NO hardcoded `input.threshold ?? 0.3` (superseded by adaptive routing — ADR-0227).
//
// Reads the codemod-built dist (ADR-0225 build → test-ci ordering); skips if absent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const DIST =
  '/tmp/ruflo-build/v3/@claude-flow/cli/dist/src/mcp-tools/memory-tools.js';

test('memory_search threshold: no `|| 0.3` (ADR-0167) and no hardcoded `?? 0.3` (ADR-0227 routes through adaptive)', () => {
  if (!existsSync(DIST)) {
    console.log(
      `SKIP_BUILD_ABSENT: ${DIST} not built — run after \`npm run build\` (test-ci builds first per ADR-0225)`,
    );
    return;
  }
  const src = readFileSync(DIST, 'utf8');
  assert.doesNotMatch(
    src,
    /input\.threshold\s*\|\|\s*0\.3/,
    'memory_search must NOT use `|| 0.3` (falsy): it coerces explicit threshold:0 -> 0.3 and drops related hits (ADR-0167).',
  );
  assert.doesNotMatch(
    src,
    /input\.threshold\s*\?\?\s*0\.3/,
    'memory_search must NOT hardcode `?? 0.3` — ADR-0227 passes the threshold through to getAdaptiveThreshold (adaptive ONNX floor 0.15); hardcoding defeated the adaptive layer for the MCP path.',
  );
});
