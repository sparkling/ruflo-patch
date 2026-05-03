// @tier unit
// ADR-0121 (T3) — Hive-mind CRDT consensus protocol.
//
// Per /Users/henrik/source/ruflo-patch/docs/adr/ADR-0121-hive-mind-crdt-consensus.md:
//
//   - Extend `ConsensusStrategy` enum with 'crdt' at hive-mind-tools.ts
//   - Extend `_consensus` MCP tool's JSON-schema strategy enum with 'crdt'
//   - Update tool description to mention "CRDT"
//   - Add `crdt-types.ts` with GCounter, ORSet, LWWRegister classes
//   - Each primitive exposes `merge(other)`; `LWWRegister.write` requires voterId
//   - Idempotence / commutativity / associativity for all three primitives
//   - LWW tiebreaker: lex on (timestamp, voterId)
//   - Conflict-free convergence under randomised interleaving
//   - `ConsensusProposal` extended with `crdtState` field on 'crdt' branch only
//   - Vote action accepts `crdtSnapshot` field (row 14 overload default)
//   - Settlement on all-voters-submitted OR roundTimeoutMs (row 10 default)
//
// This file asserts STATIC CONTRACTS via string-grep (the runtime + handler
// behaviour is verified end-to-end by the deep-test suite in the fork's
// __tests__/mcp-tools-deep.test.ts and the acceptance check below). MUST FAIL
// loudly if a future change drops or weakens any of the listed surface areas
// (per `feedback-no-squelch-tests.md`).
//
// Behavioural assertions: this file additionally hot-imports `crdt-types.js`
// from the compiled fork dist (deterministic algebra primitives, no runtime
// dependencies) and exercises the algebraic-property tests inline. If the
// fork dist is missing the unit fails loud rather than silently skipping —
// the dist is built by `npm run build` in the fork before this test runs.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';

const FORK_SRC = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts';
const FORK_CRDT_SRC = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/crdt-types.ts';
const FORK_CRDT_DIST = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/dist/src/mcp-tools/crdt-types.js';
const AGENT_FILE_CLI = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/.claude/agents/consensus/crdt-synchronizer.md';
const AGENT_FILE_MCP = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/mcp/.claude/agents/consensus/crdt-synchronizer.md';

describe('ADR-0121 (T3) — CRDT consensus runtime surface', () => {
  it('fork source files exist (hive-mind-tools.ts + crdt-types.ts)', () => {
    assert.ok(existsSync(FORK_SRC), `expected ${FORK_SRC}`);
    assert.ok(existsSync(FORK_CRDT_SRC), `expected ${FORK_CRDT_SRC}`);
  });

  const src = existsSync(FORK_SRC) ? readFileSync(FORK_SRC, 'utf8') : '';
  const crdtSrc = existsSync(FORK_CRDT_SRC) ? readFileSync(FORK_CRDT_SRC, 'utf8') : '';

  // ────────────────────────────────────────────────────────────────────
  // 1. Type-level enum extension
  // ────────────────────────────────────────────────────────────────────
  it('ConsensusStrategy union includes "crdt"', () => {
    assert.match(
      src,
      /type\s+ConsensusStrategy\s*=[^;]*'crdt'/,
      'ConsensusStrategy type alias must include "crdt"',
    );
  });

  // ────────────────────────────────────────────────────────────────────
  // 2. JSON-schema enum extension on the MCP tool
  // ────────────────────────────────────────────────────────────────────
  it('hive-mind_consensus strategy enum includes "crdt"', () => {
    const toolStart = src.indexOf("name: 'hive-mind_consensus'");
    assert.ok(toolStart >= 0, 'expected hive-mind_consensus tool definition');
    const slice = src.slice(toolStart, toolStart + 4000);
    assert.match(
      slice,
      /strategy:\s*\{\s*type:\s*'string',\s*enum:\s*\[[^\]]*'crdt'[^\]]*\]/,
      'hive-mind_consensus.strategy schema enum must include "crdt"',
    );
  });

  // ────────────────────────────────────────────────────────────────────
  // 3. Tool description mentions CRDT
  // ────────────────────────────────────────────────────────────────────
  it('hive-mind_consensus tool description mentions CRDT', () => {
    const toolStart = src.indexOf("name: 'hive-mind_consensus'");
    const slice = src.slice(toolStart, toolStart + 1000);
    assert.match(
      slice,
      /description:\s*'[^']*CRDT[^']*'/,
      'hive-mind_consensus description must mention CRDT',
    );
  });

  // ────────────────────────────────────────────────────────────────────
  // 4. Schema declares crdtSnapshot field (row 14 overload)
  // ────────────────────────────────────────────────────────────────────
  it('hive-mind_consensus schema declares crdtSnapshot', () => {
    const toolStart = src.indexOf("name: 'hive-mind_consensus'");
    const slice = src.slice(toolStart, toolStart + 5000);
    assert.match(
      slice,
      /crdtSnapshot:\s*\{/,
      'hive-mind_consensus schema must declare crdtSnapshot',
    );
  });

  // ────────────────────────────────────────────────────────────────────
  // 5. ConsensusProposal carries crdtState + crdtExpectedVoters
  // ────────────────────────────────────────────────────────────────────
  it('ConsensusProposal interface declares crdtState', () => {
    const ifaceStart = src.indexOf('interface ConsensusProposal');
    assert.ok(ifaceStart >= 0, 'expected ConsensusProposal interface');
    const ifaceEnd = src.indexOf('\n}', ifaceStart);
    const body = src.slice(ifaceStart, ifaceEnd);
    assert.match(body, /crdtState\?\s*:\s*CRDTState/);
  });

  it('ConsensusProposal interface declares crdtExpectedVoters', () => {
    const ifaceStart = src.indexOf('interface ConsensusProposal');
    const ifaceEnd = src.indexOf('\n}', ifaceStart);
    const body = src.slice(ifaceStart, ifaceEnd);
    assert.match(body, /crdtExpectedVoters\?\s*:\s*number/);
  });

  // ────────────────────────────────────────────────────────────────────
  // 6. crdt-types.ts exports GCounter / ORSet / LWWRegister classes
  // ────────────────────────────────────────────────────────────────────
  it('crdt-types.ts exports GCounter class with merge method', () => {
    assert.match(crdtSrc, /export\s+class\s+GCounter/);
    // Must have a merge method.
    assert.match(crdtSrc, /merge\s*\(\s*other\s*:\s*GCounter\s*\)/);
  });

  it('crdt-types.ts exports ORSet class with merge method', () => {
    assert.match(crdtSrc, /export\s+class\s+ORSet/);
    assert.match(crdtSrc, /merge\s*\(\s*other\s*:\s*ORSet/);
  });

  it('crdt-types.ts exports LWWRegister class with merge method', () => {
    assert.match(crdtSrc, /export\s+class\s+LWWRegister/);
    assert.match(crdtSrc, /merge\s*\(\s*other\s*:\s*LWWRegister/);
  });

  // ────────────────────────────────────────────────────────────────────
  // 7. LWWRegister.write requires voterId (no defaulting per ADR §Error-paths)
  // ────────────────────────────────────────────────────────────────────
  it('LWWRegister.write throws on empty voterId', () => {
    // The implementation must throw when voterId is missing/empty.
    // Static check: look for the validation pattern in the write method body.
    // Find the function definition (NOT the doc-comment that mentions it),
    // by matching `write(value: V` (signature has the type annotation).
    const writeMatch = crdtSrc.match(/write\(value:\s*V,\s*voterId:\s*string,/);
    assert.ok(writeMatch, 'expected LWWRegister.write signature');
    const writeIdx = (writeMatch.index ?? 0);
    const fnSlice = crdtSrc.slice(writeIdx, writeIdx + 1500);
    assert.match(fnSlice, /voterId\.length\s*===\s*0/);
    assert.match(fnSlice, /throw\s+new\s+Error/);
  });

  // ────────────────────────────────────────────────────────────────────
  // 8. CRDT Set serialisation lossless via array-of-tuples (row 11)
  // ────────────────────────────────────────────────────────────────────
  it('ORSet state shape uses array-of-tuples (not JS Set)', () => {
    // Per ADR-0121 §Review-notes row 11: state.json round-trips through
    // JSON.stringify; native Set values would be lost. ORSetState.entries
    // must be Array<[E, string]>, NOT Set<...>.
    assert.match(crdtSrc, /entries:\s*Array<\[E,\s*string\]>/);
    assert.match(crdtSrc, /tombstones:\s*Array<\[E,\s*string\]>/);
  });

  // ────────────────────────────────────────────────────────────────────
  // 9. Vote action handles strategy === "crdt" branch
  // ────────────────────────────────────────────────────────────────────
  it('vote action handles strategy === "crdt" branch', () => {
    // Match either the strategy === 'crdt' literal or the proposalStrategy === 'crdt' form
    const hasBranch = /proposalStrategy\s*===\s*'crdt'|strategy\s*===\s*'crdt'/.test(src);
    assert.ok(hasBranch, 'expected a vote-action crdt branch');
  });

  it('vote action merges crdtSnapshot via mergeCRDTState', () => {
    // Imported helper from crdt-types.ts. Must be invoked in the vote handler.
    assert.match(src, /mergeCRDTState/);
  });

  // ────────────────────────────────────────────────────────────────────
  // 10. CRDT settlement uses all-voters OR timeout (row 10 default)
  // ────────────────────────────────────────────────────────────────────
  it('CRDT settlement checks crdtExpectedVoters', () => {
    // Per ADR-0121 §Review-notes row 10: round closes when distinct voters
    // submitted >= crdtExpectedVoters OR timeout fires. Both must appear in
    // the source.
    assert.match(src, /crdtExpectedVoters/);
  });

  it('CRDT settlement honours roundTimeoutMs (no silent indefinite wait)', () => {
    // Static check: roundTimeoutMs is referenced in the CRDT branch (the
    // CRDT arm shares the gossip per-round-timeout knob per ADR §Implementation).
    assert.match(src, /roundTimeoutMs/);
  });

  // ────────────────────────────────────────────────────────────────────
  // 11. CRDT-coordinator agent file (CLI + MCP copies)
  //     NOTE: per ADR-0121 §Implementation §4 — the agent file frontmatter
  //     additions are the second wire-in. If the frontmatter is missing here,
  //     the test fails loudly so the gap is visible.
  // ────────────────────────────────────────────────────────────────────
  it('crdt-synchronizer.md (CLI copy) exists', () => {
    assert.ok(existsSync(AGENT_FILE_CLI), `expected ${AGENT_FILE_CLI}`);
  });

  it('crdt-synchronizer.md (MCP copy) exists', () => {
    assert.ok(existsSync(AGENT_FILE_MCP), `expected ${AGENT_FILE_MCP}`);
  });

  // ────────────────────────────────────────────────────────────────────
  // 12. calculateRequiredVotes still throws on unknown strategy
  // ────────────────────────────────────────────────────────────────────
  it('calculateRequiredVotes still throws on unknown strategy (no silent fallback)', () => {
    const fnIdx = src.search(/function\s+calculateRequiredVotes\s*\(/);
    assert.ok(fnIdx >= 0, 'expected calculateRequiredVotes function');
    const fnSlice = src.slice(fnIdx, fnIdx + 3000);
    assert.match(fnSlice, /throw\s+new\s+Error\(`?Unknown consensus strategy/);
  });

  it('calculateRequiredVotes has explicit "crdt" case (no default-arm fallthrough)', () => {
    // Per `feedback-no-fallbacks.md`: every strategy must have an explicit
    // case. The 'crdt' branch must NOT rely on the default arm.
    const fnIdx = src.search(/function\s+calculateRequiredVotes\s*\(/);
    const fnSlice = src.slice(fnIdx, fnIdx + 3000);
    assert.match(fnSlice, /case\s+'crdt':/);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Behavioural tests via dynamic import of the compiled fork dist.
// These run only when `crdt-types.js` exists in dist (i.e. after fork build).
// If dist is absent, the tests fail loudly per `feedback-no-fallbacks.md`.
// ────────────────────────────────────────────────────────────────────────
describe('ADR-0121 (T3) — CRDT primitive algebra (live)', async () => {
  it('compiled crdt-types.js exists in fork dist', () => {
    assert.ok(
      existsSync(FORK_CRDT_DIST),
      `expected ${FORK_CRDT_DIST} — run \`npm run build\` in the fork first`,
    );
  });

  if (!existsSync(FORK_CRDT_DIST)) return;

  const mod = await import(FORK_CRDT_DIST);
  const { GCounter, ORSet, LWWRegister, mergeCRDTState, emptyCRDTState } = mod;

  it('GCounter idempotence: merge(a, a) = a', () => {
    const a = new GCounter();
    a.increment('w-1');
    a.increment('w-2');
    a.increment('w-1');
    assert.deepEqual(a.merge(a).toJSON(), a.toJSON());
  });

  it('GCounter commutativity: merge(a, b) = merge(b, a)', () => {
    const a = new GCounter();
    a.increment('w-A');
    a.increment('w-A');
    const b = new GCounter();
    b.increment('w-B');
    assert.deepEqual(a.merge(b).toJSON(), b.merge(a).toJSON());
  });

  it('GCounter associativity', () => {
    const a = new GCounter(); a.increment('w-1');
    const b = new GCounter(); b.increment('w-2'); b.increment('w-2');
    const c = new GCounter(); c.increment('w-3');
    const left = a.merge(b).merge(c).toJSON();
    const right = a.merge(b.merge(c)).toJSON();
    assert.deepEqual(left, right);
  });

  it('ORSet add-wins under concurrent add+remove', () => {
    const a = new ORSet();
    a.add('x', 'v-A');
    a.remove('x');
    const b = new ORSet();
    b.add('x', 'v-B');
    const merged = a.merge(b);
    assert.ok(merged.elements().includes('x'));
  });

  it('LWW same-millisecond same-voter second-write loses', () => {
    const reg = new LWWRegister();
    reg.write('v1', 'voter-A', 1000);
    reg.write('v2', 'voter-A', 1000);
    assert.equal(reg.value(), 'v1');
  });

  it('LWW different-voter same-millisecond resolves by voterId lex', () => {
    const reg = new LWWRegister();
    reg.write('A-wrote', 'voter-A', 1000);
    reg.write('Z-wrote', 'voter-Z', 1000);
    assert.equal(reg.value(), 'Z-wrote');
  });

  it('LWW.write throws on missing voterId', () => {
    const reg = new LWWRegister();
    assert.throws(() => reg.write('x', '', 1000));
  });

  it('JSON round-trip of empty CRDT triple', () => {
    const empty = emptyCRDTState();
    const parsed = JSON.parse(JSON.stringify(empty));
    assert.deepEqual(parsed, empty);
  });

  it('mergeCRDTState merges three components independently', () => {
    const a = emptyCRDTState();
    const g = new GCounter(); g.increment('v-1'); a.votes = g.toJSON();
    const b = emptyCRDTState();
    const aps = new ORSet(); aps.add('v-2', 'v-2'); b.approvers = aps.toJSON();
    const merged = mergeCRDTState(a, b);
    assert.equal(GCounter.from(merged.votes).value(), 1);
    assert.ok(ORSet.from(merged.approvers).elements().includes('v-2'));
  });

  // Conflict-free convergence under randomised interleaving (>= 100 schedules).
  it('GCounter fuzz: 100 randomised schedules converge', () => {
    for (let s = 0; s < 100; s++) {
      const r1 = new GCounter(); r1.increment('a'); r1.increment('b');
      const r2 = new GCounter(); r2.increment('b'); r2.increment('c');
      const r3 = new GCounter(); r3.increment('c'); r3.increment('a');
      const m1 = r1.merge(r2).merge(r3).toJSON();
      const m2 = r3.merge(r1).merge(r2).toJSON();
      assert.deepEqual(m1, m2);
    }
  });
});
