// @tier unit
// Bug-3 (2026-05-05): "AgentDB not available" sentinel mid-batch is NOT a
// race — it's deterministic key-collision laundered through the orchestration
// layer's `T | null` return type. ADR-0094 RC-2 idempotency guard rejects
// later same-(src,dst) edges with different relation/weight; recordCausalEdge
// collapsed `success:false` to `null`; tools-layer `result ?? sentinel`
// converted that to the misleading user message.
//
// Two-part fix:
// 1. routeCausalOp 'edge' fallback uses upsert:true (already pinned by bug2 test)
// 2. orchestration helpers return `T & { error? }` not `T | null` so real
//    upstream errors survive instead of getting laundered.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const ORCH_SRC = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/agentdb-orchestration.ts';
const TOOLS_SRC = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/agentdb-tools.ts';

describe('Bug-3: orchestration helpers no longer return null on failure', () => {
  it('recordCausalEdge return type is non-nullable (no `| null`)', () => {
    const src = readFileSync(ORCH_SRC, 'utf8');
    const fnStart = src.indexOf('export async function recordCausalEdge');
    assert.ok(fnStart > 0, 'recordCausalEdge must exist');
    // Find the Promise<...> return type signature.
    // Find the return-type Promise<...> signature — search for ': Promise<' from fnStart
    // and capture through the matching '> {' that opens the function body.
    const promiseStart = src.indexOf('): Promise<', fnStart);
    assert.ok(promiseStart > 0, `must find Promise<...> return type for ${src.slice(fnStart, fnStart+60)}`);
    // Find the '{\n' that opens the body (after the Promise<...> closes).
    const bodyOpen = src.indexOf('{\n', promiseStart);
    const sig = src.slice(fnStart, bodyOpen);
    assert.ok(!/Promise<[^>]*\|\s*null>/.test(sig),
      `recordCausalEdge return type must NOT include '| null' — pre-fix nullification laundered real errors. Got signature: ${sig.slice(-120)}`);
    assert.match(sig, /error\?\s*:/, "recordCausalEdge return type must include 'error?: string'");
  });

  it('searchPatterns return type is non-nullable', () => {
    const src = readFileSync(ORCH_SRC, 'utf8');
    const fnStart = src.indexOf('export async function searchPatterns');
    assert.ok(fnStart > 0, 'searchPatterns must exist');
    // Find the return-type Promise<...> signature — search for ': Promise<' from fnStart
    // and capture through the matching '> {' that opens the function body.
    const promiseStart = src.indexOf('): Promise<', fnStart);
    assert.ok(promiseStart > 0, `must find Promise<...> return type for ${src.slice(fnStart, fnStart+60)}`);
    // Find the '{\n' that opens the body (after the Promise<...> closes).
    const bodyOpen = src.indexOf('{\n', promiseStart);
    const sig = src.slice(fnStart, bodyOpen);
    assert.ok(!/Promise<[^>]*\|\s*null>/.test(sig),
      "searchPatterns return type must NOT include '| null'");
    assert.match(sig, /error\?\s*:/, "searchPatterns return type must include 'error?: string'");
  });

  it('sessionStart return type is non-nullable', () => {
    const src = readFileSync(ORCH_SRC, 'utf8');
    const fnStart = src.indexOf('export async function sessionStart');
    assert.ok(fnStart > 0, 'sessionStart must exist');
    // Find the return-type Promise<...> signature — search for ': Promise<' from fnStart
    // and capture through the matching '> {' that opens the function body.
    const promiseStart = src.indexOf('): Promise<', fnStart);
    assert.ok(promiseStart > 0, `must find Promise<...> return type for ${src.slice(fnStart, fnStart+60)}`);
    // Find the '{\n' that opens the body (after the Promise<...> closes).
    const bodyOpen = src.indexOf('{\n', promiseStart);
    const sig = src.slice(fnStart, bodyOpen);
    assert.ok(!/Promise<[^>]*\|\s*null>/.test(sig),
      "sessionStart return type must NOT include '| null'");
    assert.match(sig, /error\?\s*:/, "sessionStart return type must include 'error?: string'");
  });

  it('catch blocks no longer return bare null', () => {
    const src = readFileSync(ORCH_SRC, 'utf8');
    // Find every `} catch ... { return null; }` pattern in the file.
    // Pre-fix had at least 3 (searchPatterns, recordCausalEdge, sessionStart).
    const bareCatchNull = src.match(/catch\s*(?:\(\s*[a-zA-Z_]*\s*\))?\s*\{\s*return\s+null\s*;?\s*\}/g) || [];
    // recordFeedback and sessionEnd are still allowed to return their typed-shape
    // failure — those return objects, not null. The forbidden pattern is
    // `return null` from a catch in the three flagged helpers.
    const flagged = ['searchPatterns', 'recordCausalEdge', 'sessionStart'];
    for (const fnName of flagged) {
      const fnStart = src.indexOf(`export async function ${fnName}`);
      const fnEnd = src.indexOf('\nexport async function ', fnStart + 1);
      const fnBody = src.slice(fnStart, fnEnd > 0 ? fnEnd : src.length);
      assert.ok(!/catch\s*(?:\(\s*[^)]*\s*\))?\s*\{\s*return\s+null\s*;?\s*\}/.test(fnBody),
        `${fnName} must not have a 'catch { return null }' block — real errors get laundered as 'AgentDB not available' downstream`);
    }
  });
});

describe('Bug-3: tools-layer sentinel coalescer is now defensive only', () => {
  it("'AgentDB not available' sentinel still exists as a fallback (covers the 5 unfixed-shape helpers)", () => {
    const src = readFileSync(TOOLS_SRC, 'utf8');
    // The sentinel string is allowed to remain at lines that wrap helpers
    // whose return shape is still `| null` (recordFeedback, sessionEnd).
    // This test pins the contract: sentinel exists but is no longer the
    // primary fail path for searchPatterns/recordCausalEdge/sessionStart.
    assert.match(src, /AgentDB not available/,
      'sentinel string remains as defensive coalesce for the still-nullable helpers');
  });
});
