// @tier unit
// ADR-0069 swarm review 2026-04-21, advisory A3 (post-ADR-0161 migration):
//
//   Pre-migration: agentdb-service.ts::upgradeEmbeddingService() used a
//   workspace-relative dynamic import for ONNXEmbeddingService:
//       await import('../../../packages/agentdb-onnx/src/services/ONNXEmbeddingService.js')
//   Post-ADR-0161 step 8: rewritten to npm-name import
//       await import('agentdb-onnx')  // codemod scopes to '@sparkleideas/agentdb-onnx' at publish
//   The relocated agentdb-onnx now lives at forks/agentdb/packages/agentdb-onnx/.
//
// This unit test verifies the post-migration shape:
//
//   1. The ONNX npm-name import literal is in the fork TS source.
//   2. agentdb-onnx is declared as a dep of agentic-flow (consumer dep).
//   3. The agentdb-onnx source has ONNXEmbeddingService class export.
//   4. Chain order: ONNX import precedes Enhanced import in the upgrade fn.
//   5. Tier-failure logging is loud (ADR-0082 no-silent-fallback).

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';

const FORK_SRC =
  '/Users/henrik/source/forks/agentic-flow/agentic-flow/src/services/agentdb-service.ts';
const ONNX_SRC =
  '/Users/henrik/source/forks/agentdb/packages/agentdb-onnx/src/services/ONNXEmbeddingService.ts';
const AGENTIC_PKG_JSON =
  '/Users/henrik/source/forks/agentic-flow/agentic-flow/package.json';

// Post-ADR-0161 expected import literal (codemod renames bare 'agentdb-onnx'
// to '@sparkleideas/agentdb-onnx' at publish, so we accept either form).
const ONNX_IMPORT_RE = /['"](?:@sparkleideas\/)?agentdb-onnx['"]/;
const ENHANCED_IMPORT_RE = /EnhancedEmbeddingService/;

describe('ADR-0069 F3 §3 (A3): ONNX import is wired (post-ADR-0161 npm-name shape)', () => {
  it('fork TS source contains the agentdb-onnx import literal', () => {
    assert.ok(existsSync(FORK_SRC), `fork source missing: ${FORK_SRC}`);
    const ts = readFileSync(FORK_SRC, 'utf8');
    assert.match(
      ts,
      ONNX_IMPORT_RE,
      `fork TS source must contain dynamic import of (@sparkleideas/)?agentdb-onnx — post-ADR-0161 step 8 the workspace-relative path was replaced with the npm name.`,
    );
  });

  it('agentic-flow declares agentdb-onnx as a dependency', () => {
    const pkg = JSON.parse(readFileSync(AGENTIC_PKG_JSON, 'utf8'));
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.optionalDependencies ?? {}) };
    const onnxDep = deps['agentdb-onnx'] || deps['@sparkleideas/agentdb-onnx'];
    assert.ok(
      onnxDep,
      `agentic-flow/package.json must declare agentdb-onnx (or @sparkleideas/agentdb-onnx) — post-ADR-0161 step 8.4. found deps: ${Object.keys(deps).join(', ')}`,
    );
  });

  it('agentdb-onnx source exports an ONNXEmbeddingService class', () => {
    assert.ok(existsSync(ONNX_SRC), `agentdb-onnx source missing: ${ONNX_SRC}`);
    const ts = readFileSync(ONNX_SRC, 'utf8');
    const hasExport =
      /export\s+class\s+ONNXEmbeddingService\b/.test(ts) ||
      /export\s*\{[^}]*\bONNXEmbeddingService\b/.test(ts);
    assert.ok(
      hasExport,
      `ONNXEmbeddingService class must be exported from ${ONNX_SRC}.`,
    );
  });

  it('chain order in fork TS: ONNX import precedes Enhanced reference inside upgradeEmbeddingService()', () => {
    const ts = readFileSync(FORK_SRC, 'utf8');
    const fnStart = ts.search(/private\s+async\s+upgradeEmbeddingService\s*\(/);
    assert.ok(fnStart >= 0, 'upgradeEmbeddingService not found');
    // 12000-char window covers the ONNX + Enhanced + Basic chain
    const fnWindow = ts.slice(fnStart, Math.min(fnStart + 12000, ts.length));
    const onnxIdx = fnWindow.search(ONNX_IMPORT_RE);
    const enhancedIdx = fnWindow.search(ENHANCED_IMPORT_RE);
    assert.ok(onnxIdx >= 0, 'ONNX import not found in upgradeEmbeddingService window');
    assert.ok(enhancedIdx >= 0, 'EnhancedEmbeddingService not found in upgradeEmbeddingService window');
    assert.ok(
      onnxIdx < enhancedIdx,
      `chain ORDER wrong: ONNX import at offset ${onnxIdx}, Enhanced at offset ${enhancedIdx}. ADR-0069 F3 §3 requires ONNX → Enhanced → Basic.`,
    );
  });

  it('compiled dist still logs loudly on tier failure (ADR-0082)', () => {
    const ts = readFileSync(FORK_SRC, 'utf8');
    const hasLoudLog = /console\.(warn|error)[^;]*ONNX/.test(ts);
    assert.ok(
      hasLoudLog,
      `fork TS has no console.warn/error referencing ONNX — ADR-0082 silent-fallback violation.`,
    );
  });
});
