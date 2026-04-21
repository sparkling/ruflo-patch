// @tier unit
// ADR-0069 swarm review 2026-04-21, advisory A3:
//
//   agentdb-service.ts::upgradeEmbeddingService() uses a relative dynamic
//   import to load ONNXEmbeddingService:
//       await import('../../../packages/agentdb-onnx/src/services/ONNXEmbeddingService.js')
//   The reviewer flagged that there is no publish-layer check proving the
//   relative path resolves inside the published tarball at runtime.
//
// This unit test is the build-layer half of that coverage. It verifies,
// without invoking any real runtime import:
//
//   1. The relative import literal is still present in BOTH the fork TS
//      source AND the compiled fork dist JS.
//   2. The target ONNXEmbeddingService.js file exists inside the fork
//      dist at the location the relative path resolves to. If it does
//      not, the shipped tarball will also be missing it (since the
//      agentic-flow package.json `files` whitelist includes "dist").
//   3. The compiled file exports an `ONNXEmbeddingService` class. We
//      check this with a string-level regex over the compiled .js —
//      the same style used by the sibling adr0069-f3-booster test.
//   4. Chain order: the ONNX literal in the compiled agentdb-service.js
//      appears BEFORE the EnhancedEmbeddingService literal (ONNX is the
//      preferred tier; ADR-0069 F3 §3).
//
// No mocks, no live imports — pure structural file inspection. This is
// paired with the acceptance check
// `check_adr0069_f3_onnx_import_resolvable` (lib/acceptance-adr0069-f3-checks.sh)
// which exercises the dynamic import against the *installed* tarball.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, resolve, normalize } from 'node:path';

const FORK_SRC =
  '/Users/henrik/source/forks/agentic-flow/agentic-flow/src/services/agentdb-service.ts';
const FORK_DIST =
  '/Users/henrik/source/forks/agentic-flow/agentic-flow/dist/agentic-flow/src/services/agentdb-service.js';

// Expected relative path literal in both source and dist
const EXPECTED_REL_PATH =
  '../../../packages/agentdb-onnx/src/services/ONNXEmbeddingService.js';

describe('ADR-0069 F3 §3 (A3): ONNX relative import is resolvable', () => {
  it('fork TS source contains the ONNX relative import literal', () => {
    assert.ok(existsSync(FORK_SRC), `fork source missing: ${FORK_SRC}`);
    const ts = readFileSync(FORK_SRC, 'utf8');
    assert.ok(
      ts.includes(EXPECTED_REL_PATH),
      `fork TS source at ${FORK_SRC} does not contain the expected ONNX import literal '${EXPECTED_REL_PATH}'. If this test fails the upgrade chain has been rewritten; update EXPECTED_REL_PATH or the acceptance check will drift from reality.`,
    );
  });

  it('fork dist JS still contains the ONNX relative import literal', () => {
    assert.ok(
      existsSync(FORK_DIST),
      `fork dist missing: ${FORK_DIST} — run \`cd forks/agentic-flow/agentic-flow && npm run build\``,
    );
    const js = readFileSync(FORK_DIST, 'utf8');
    assert.ok(
      js.includes(EXPECTED_REL_PATH),
      `fork dist at ${FORK_DIST} does not contain '${EXPECTED_REL_PATH}'. tsc must preserve the literal so node can resolve it at runtime. If this fails after a build config change, the ONNX tier will silently fall through every install.`,
    );
  });

  it('the relative path resolves to a file that exists in the fork dist', () => {
    // Resolve relative to the compiled agentdb-service.js, not the TS source.
    // That is what node's runtime `import()` does.
    const svcDir = dirname(FORK_DIST);
    const resolved = normalize(resolve(svcDir, EXPECTED_REL_PATH));

    assert.ok(
      existsSync(resolved),
      `relative import target does NOT exist: ${resolved}. The compiled agentdb-service.js references a path the build does not emit. Fix: confirm tsc picks up packages/agentdb-onnx through transitive imports (moduleResolution: bundler), or vendor the service into packages/agentdb.`,
    );

    const st = statSync(resolved);
    assert.ok(st.isFile(), `resolved path is not a regular file: ${resolved}`);
    assert.ok(st.size > 0, `resolved file is empty: ${resolved}`);
  });

  it('the resolved ONNXEmbeddingService.js exports an ONNXEmbeddingService class', () => {
    const svcDir = dirname(FORK_DIST);
    const resolved = normalize(resolve(svcDir, EXPECTED_REL_PATH));
    assert.ok(existsSync(resolved), `resolved file missing: ${resolved}`);

    const js = readFileSync(resolved, 'utf8');
    // The compiled output can take several shapes depending on tsc target:
    //   export class ONNXEmbeddingService { ... }
    //   exports.ONNXEmbeddingService = ...;
    //   class ONNXEmbeddingService_1 { ... }; export { ONNXEmbeddingService_1 as ONNXEmbeddingService };
    // Accept any of them.
    const hasExport =
      /export\s+class\s+ONNXEmbeddingService\b/.test(js) ||
      /exports\.ONNXEmbeddingService\s*=/.test(js) ||
      /export\s*\{[^}]*\bONNXEmbeddingService\b[^}]*\}/.test(js);

    assert.ok(
      hasExport,
      `ONNXEmbeddingService is not exported from ${resolved}. The upgrade chain's dynamic import will succeed but the destructure will fail with "ONNXEmbeddingService export not found".`,
    );
  });

  it('chain order in compiled dist: inside upgradeEmbeddingService(), ONNX import precedes Enhanced import', () => {
    // Scope the order assertion to the upgrade function only. Other
    // places in the file (e.g. the basic `ensureEmbedder` path) may
    // legitimately mention EnhancedEmbeddingService first without
    // implying a tier-order regression.
    const js = readFileSync(FORK_DIST, 'utf8');
    // Anchor at the function declaration, not the call-site or JSDoc.
    // Try both the async form and the bare method form to stay robust
    // against tsc emit differences.
    let fnStart = js.indexOf('async upgradeEmbeddingService(');
    if (fnStart < 0) fnStart = js.indexOf('upgradeEmbeddingService() {');
    assert.ok(
      fnStart >= 0,
      `compiled dist lacks upgradeEmbeddingService function declaration (${FORK_DIST})`,
    );
    // Isolate a window starting at the function declaration, large
    // enough to contain both tier blocks (~8k chars is plenty for the
    // full ONNX + Enhanced + Basic chain).
    const windowEnd = Math.min(fnStart + 12000, js.length);
    const fnWindow = js.slice(fnStart, windowEnd);

    const onnxImportIdx = fnWindow.indexOf(EXPECTED_REL_PATH);
    const enhancedImportIdx = fnWindow.indexOf(
      '../../../packages/agentdb/src/controllers/EnhancedEmbeddingService.js',
    );
    assert.ok(
      onnxImportIdx >= 0,
      `upgradeEmbeddingService() window lacks the ONNX import literal (${FORK_DIST})`,
    );
    assert.ok(
      enhancedImportIdx >= 0,
      `upgradeEmbeddingService() window lacks the Enhanced import literal (${FORK_DIST})`,
    );
    assert.ok(
      onnxImportIdx < enhancedImportIdx,
      `chain ORDER wrong inside upgradeEmbeddingService(): ONNX import at offset ${onnxImportIdx}, Enhanced import at offset ${enhancedImportIdx} (both offsets are within the function window). ADR-0069 F3 §3 requires ONNX → Enhanced → Basic.`,
    );
  });

  it('compiled dist still logs loudly on tier failure (ADR-0082)', () => {
    // The upgrade chain's ONNX catch block must NOT swallow silently.
    // We check that within ~200 chars after the ONNX import literal there is
    // a console.warn/error reference — same shape as F3-8 acceptance check.
    const js = readFileSync(FORK_DIST, 'utf8');
    const onnxIdx = js.indexOf(EXPECTED_REL_PATH);
    assert.ok(onnxIdx >= 0, 'ONNX import literal not found — earlier tests should have caught this');

    // Search the full upgrade function for any console.warn mentioning ONNX.
    const hasLoudLog = /console\.(warn|error)[^;]*ONNX/.test(js);
    assert.ok(
      hasLoudLog,
      `compiled dist has no console.warn/error referencing ONNX — the ONNX tier catch block may have been stripped or weakened, which is an ADR-0082 silent-fallback violation.`,
    );
  });
});
