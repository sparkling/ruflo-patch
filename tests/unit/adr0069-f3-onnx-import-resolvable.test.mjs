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
// This unit test verified the post-migration shape (import literal, dep
// declaration, export surface, chain order, loud tier logging). ADR-0288
// Option C-prime (fork agentic-flow 8c5ec5d7, 2026-06-04) retired the
// consumer — agentdb-service.ts and upgradeEmbeddingService are deleted — so
// the consumer-side assertions flip to a retirement guard. What survives:
//
//   2. agentdb-onnx is declared as a dep of agentic-flow (consumer dep).
//   3. The agentdb-onnx source has ONNXEmbeddingService class export.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';

const FORK_SRC =
  '/Users/henrik/source/forks/agentic-flow/agentic-flow/src/services/agentdb-service.ts';
const ONNX_SRC =
  '/Users/henrik/source/forks/agentdb/packages/agentdb-onnx/src/services/ONNXEmbeddingService.ts';
const AGENTIC_PKG_JSON =
  '/Users/henrik/source/forks/agentic-flow/agentic-flow/package.json';

describe('ADR-0069 F3 §3 (A3): ONNX package surface (consumer retired per ADR-0288)', () => {
  it('agentdb-service.ts stays deleted (ADR-0288 Option C-prime)', () => {
    assert.ok(
      !existsSync(FORK_SRC),
      `${FORK_SRC} must stay deleted — the AgentDBService consumer was retired by ` +
        `ADR-0288 (fork 8c5ec5d7). If re-introduced, restore the import-literal / ` +
        `chain-order / loud-logging assertions this guard replaced (git log this file).`,
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

});
