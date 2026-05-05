// @tier unit
// Bug-2 (2026-05-05): causal_query returns "Internal error" while causal_edge
// writes succeed via router-fallback. Asymmetry: write goes through
// routeCausalOp ladder (controller → namespace fallback); read called
// getController('causalGraph') directly with no fallback.
// Fix: add 'query' arm to routeCausalOp mirroring the edge fallback;
// agentdb_causal_query handler now delegates to it. Pin the source-level
// contract so the asymmetry can't regress silently.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';

const ROUTER_SRC = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/memory/memory-router.ts';
const HANDLER_SRC = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/agentdb-tools.ts';

describe("Bug-2: causal_query write/read symmetry (source contract pins)", () => {
  it("CausalOpType union includes 'query'", () => {
    const src = readFileSync(ROUTER_SRC, 'utf8');
    assert.match(src, /CausalOpType\s*=\s*['"]edge['"]\s*\|\s*['"]recall['"]\s*\|\s*['"]query['"]/,
      "CausalOpType must include 'query' so the read path can route through the same dispatcher as the write path");
  });

  it("routeCausalOp has a 'query' case that reads from causal-edges namespace", () => {
    const src = readFileSync(ROUTER_SRC, 'utf8');
    assert.match(src, /case\s+['"]query['"]\s*:/, "routeCausalOp must dispatch on type 'query'");
    // The query arm must consult the causal-edges namespace (where the write fallback persists)
    const queryArmStart = src.indexOf("case 'query'");
    const queryArmEnd = src.indexOf("case 'recall'", queryArmStart);
    assert.ok(queryArmStart > 0 && queryArmEnd > queryArmStart, "query arm must precede recall arm");
    const queryArmBody = src.slice(queryArmStart, queryArmEnd);
    assert.match(queryArmBody, /['"]causal-edges['"]/,
      "query arm must read from the 'causal-edges' namespace where the write fallback persists");
    assert.match(queryArmBody, /router-fallback/,
      "query arm must mark router-fallback controller so write/read share the same provenance marker");
  });

  it("agentdb_causal_query handler delegates to routeCausalOp (no direct getController)", () => {
    const src = readFileSync(HANDLER_SRC, 'utf8');
    // Find the agentdbCausalQuery export region
    const handlerStart = src.indexOf('agentdbCausalQuery');
    assert.ok(handlerStart > 0, 'agentdbCausalQuery export must exist');
    const handlerEnd = src.indexOf('\n};\n', handlerStart);
    const handler = src.slice(handlerStart, handlerEnd);
    assert.match(handler, /routeCausalOp/,
      "Bug-2 fix: handler must delegate to routeCausalOp instead of calling getController('causalGraph') directly");
    // The pre-fix branches that bypassed the router are gone:
    assert.ok(!/getController<any>\(['"]causalGraph['"]\)/.test(handler),
      "Pre-fix direct controller bypass must NOT be in the handler — write/read paths diverged here");
  });

  it("routeCausalOp 'edge' fallback uses upsert:true (Bug-3 collateral)", () => {
    const src = readFileSync(ROUTER_SRC, 'utf8');
    const edgeArmStart = src.indexOf("case 'edge'");
    const edgeArmEnd = src.indexOf("case 'query'", edgeArmStart);
    const edgeArm = src.slice(edgeArmStart, edgeArmEnd);
    assert.match(edgeArm, /upsert:\s*true/,
      "Bug-3 fix: edge fallback must set upsert:true so re-recording shared (src,dst) edges with different relation/weight succeeds via overwrite (avoids ADR-0094 RC-2 idempotency rejection that gets laundered into 'AgentDB not available' sentinel)");
  });
});

describe("Bug-2: causal_query 'Internal error' source string is no longer the default fail mode", () => {
  it("sanitizeError 'Internal error' default still exists (defensive)", () => {
    const src = readFileSync(HANDLER_SRC, 'utf8');
    // We're NOT removing the sanitizeError default — but the new handler
    // delegates through the router so non-Error throws inside the controller
    // probe path no longer reach this default for the common-case write/read
    // round-trip.
    assert.match(src, /['"]Internal error['"]/,
      "sanitizeError default 'Internal error' should still exist — but should not surface for common write/read round-trips after the router-delegation fix");
  });
});
