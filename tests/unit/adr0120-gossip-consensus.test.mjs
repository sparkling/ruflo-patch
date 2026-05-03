// @tier unit
// ADR-0120 (T2) — Hive-mind Gossip consensus protocol.
//
// Per /Users/henrik/source/ruflo-patch/docs/adr/ADR-0120-hive-mind-gossip-consensus.md:
//
//   - Extend `ConsensusStrategy` enum with 'gossip' at hive-mind-tools.ts:46
//   - Extend `_consensus` MCP tool's JSON-schema strategy enum with 'gossip'
//   - Update tool description to mention "Gossip"
//   - Add gossipRound, lastVoteChangedRound, totalNodes, currentRoundBroadcastSet
//     to ConsensusProposal
//   - Settle predicate: gossipRound >= ceil(log2(N)) AND
//     (gossipRound > lastVoteChangedRound OR totalNodes == 1)
//   - Hard budget: gossipRound > 2 * ceil(log2(N)) → { settled: false, exhausted: true }
//   - Per-round timeout: roundTimeoutMs (default 5000ms)
//
// This file asserts STATIC CONTRACTS via string-grep (the runtime + handler
// behaviour is verified end-to-end by the deep-test suite in the fork's
// __tests__/mcp-tools-deep.test.ts and the acceptance check below). MUST FAIL
// loudly if a future change drops or weakens any of the listed surface areas
// (per `feedback-no-squelch-tests.md`).

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';

const FORK_SRC = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts';
const AGENT_FILE = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/.claude/agents/consensus/gossip-coordinator.md';

describe('ADR-0120 (T2) — gossip consensus runtime surface', () => {
  it('fork source file exists', () => {
    assert.ok(existsSync(FORK_SRC), `expected ${FORK_SRC}`);
  });

  const src = existsSync(FORK_SRC) ? readFileSync(FORK_SRC, 'utf8') : '';

  // ────────────────────────────────────────────────────────────────────
  // 1. Type-level enum extension
  // ────────────────────────────────────────────────────────────────────
  it('ConsensusStrategy union includes "gossip"', () => {
    // Match the type alias literal — `'gossip'` must appear in the union.
    // Allow other strategies (bft, raft, quorum, weighted, gossip, plus future
    // additions like crdt) but require gossip be present.
    assert.match(
      src,
      /type\s+ConsensusStrategy\s*=[^;]*'gossip'/,
      'ConsensusStrategy type alias must include "gossip"',
    );
  });

  // ────────────────────────────────────────────────────────────────────
  // 2. JSON-schema enum extension on the MCP tool
  // ────────────────────────────────────────────────────────────────────
  it('hive-mind_consensus strategy enum includes "gossip"', () => {
    // Find the hive-mind_consensus tool's strategy property.
    const toolStart = src.indexOf("name: 'hive-mind_consensus'");
    assert.ok(toolStart >= 0, 'expected hive-mind_consensus tool definition');
    // Slice forward enough to include the schema enum.
    const slice = src.slice(toolStart, toolStart + 4000);
    assert.match(
      slice,
      /strategy:\s*\{\s*type:\s*'string',\s*enum:\s*\[[^\]]*'gossip'[^\]]*\]/,
      'hive-mind_consensus.strategy schema enum must include "gossip"',
    );
  });

  // ────────────────────────────────────────────────────────────────────
  // 3. Tool description mentions Gossip
  // ────────────────────────────────────────────────────────────────────
  it('hive-mind_consensus tool description mentions Gossip', () => {
    const toolStart = src.indexOf("name: 'hive-mind_consensus'");
    const slice = src.slice(toolStart, toolStart + 1000);
    assert.match(
      slice,
      /description:\s*'[^']*Gossip[^']*'/,
      'hive-mind_consensus description must mention Gossip',
    );
  });

  // ────────────────────────────────────────────────────────────────────
  // 4. ConsensusProposal carries the four gossip-only fields
  // ────────────────────────────────────────────────────────────────────
  it('ConsensusProposal interface declares gossipRound', () => {
    const ifaceStart = src.indexOf('interface ConsensusProposal');
    assert.ok(ifaceStart >= 0, 'expected ConsensusProposal interface');
    const ifaceEnd = src.indexOf('\n}', ifaceStart);
    const body = src.slice(ifaceStart, ifaceEnd);
    assert.match(body, /gossipRound\?\s*:\s*number/);
  });

  it('ConsensusProposal interface declares lastVoteChangedRound', () => {
    const ifaceStart = src.indexOf('interface ConsensusProposal');
    const ifaceEnd = src.indexOf('\n}', ifaceStart);
    const body = src.slice(ifaceStart, ifaceEnd);
    assert.match(body, /lastVoteChangedRound\?\s*:\s*number/);
  });

  it('ConsensusProposal interface declares totalNodes', () => {
    const ifaceStart = src.indexOf('interface ConsensusProposal');
    const ifaceEnd = src.indexOf('\n}', ifaceStart);
    const body = src.slice(ifaceStart, ifaceEnd);
    assert.match(body, /totalNodes\?\s*:\s*number/);
  });

  it('ConsensusProposal interface declares currentRoundBroadcastSet', () => {
    const ifaceStart = src.indexOf('interface ConsensusProposal');
    const ifaceEnd = src.indexOf('\n}', ifaceStart);
    const body = src.slice(ifaceStart, ifaceEnd);
    assert.match(body, /currentRoundBroadcastSet\?\s*:\s*string\[\]/);
  });

  // ────────────────────────────────────────────────────────────────────
  // 5. Fanout helper exists with O(log N) shape
  // ────────────────────────────────────────────────────────────────────
  it('gossipFanout helper computes ceil(log2(N))', () => {
    assert.match(
      src,
      /function\s+gossipFanout\s*\(/,
      'expected gossipFanout function definition',
    );
    // Verify the math: must reference Math.log2 and Math.ceil for non-trivial N.
    const fnIdx = src.search(/function\s+gossipFanout\s*\(/);
    const fnSlice = src.slice(fnIdx, fnIdx + 400);
    assert.match(fnSlice, /Math\.log2/);
    assert.match(fnSlice, /Math\.ceil/);
    // N=1 short-circuit must return 0 (no peers).
    assert.match(fnSlice, /totalNodes\s*<=\s*1/);
  });

  // ────────────────────────────────────────────────────────────────────
  // 6. Settle predicate: both clauses + N=1 short-circuit + hard budget
  // ────────────────────────────────────────────────────────────────────
  it('settleCheckGossip implements both predicate clauses', () => {
    assert.match(
      src,
      /function\s+settleCheckGossip\s*\(/,
      'expected settleCheckGossip function definition',
    );
    const fnIdx = src.search(/function\s+settleCheckGossip\s*\(/);
    const fnSlice = src.slice(fnIdx, fnIdx + 2000);
    // First clause: gossipRound >= bound.
    assert.match(fnSlice, /gossipRound\s*>=\s*bound/);
    // Second clause: gossipRound > lastVoteChangedRound (strictly greater).
    assert.match(fnSlice, /gossipRound\s*>\s*lastVoteChangedRound/);
    // N=1 short-circuit (per ADR §Specification): totalNodes === 1 disjunction.
    assert.match(fnSlice, /totalNodes\s*===\s*1/);
  });

  it('settleCheckGossip surfaces hard-budget exhaustion explicitly (no silent coercion)', () => {
    const fnIdx = src.search(/function\s+settleCheckGossip\s*\(/);
    const fnSlice = src.slice(fnIdx, fnIdx + 2000);
    // Must check gossipRound > 2 * bound (per §Specification "Round budget")
    // and return exhausted: true. Per feedback-no-fallbacks, NEVER coerce
    // exhaustion to settled.
    assert.match(fnSlice, /gossipRound\s*>\s*2\s*\*\s*bound/);
    assert.match(fnSlice, /exhausted:\s*true/);
  });

  it('settleCheckGossip rejects no-vote tally (per feedback-no-fallbacks.md)', () => {
    // §Acceptance criterion: settle_check on a proposal with zero votes
    // returns { settled: false, gossipRound: 0 }, NEVER settled.
    const fnIdx = src.search(/function\s+settleCheckGossip\s*\(/);
    const fnSlice = src.slice(fnIdx, fnIdx + 2000);
    assert.match(fnSlice, /noVotes:\s*true/);
  });

  // ────────────────────────────────────────────────────────────────────
  // 7. Per-round timeout helper
  // ────────────────────────────────────────────────────────────────────
  it('maybeAdvanceGossipRoundOnTimeout helper exists', () => {
    assert.match(
      src,
      /function\s+maybeAdvanceGossipRoundOnTimeout\s*\(/,
      'expected per-round-timeout helper',
    );
  });

  it('GOSSIP_ROUND_TIMEOUT_MS_DEFAULT constant exists with 5000ms default', () => {
    assert.match(
      src,
      /GOSSIP_ROUND_TIMEOUT_MS_DEFAULT\s*=\s*5000/,
      'expected default round timeout of 5000ms per ADR-0120 §Specification',
    );
  });

  // ────────────────────────────────────────────────────────────────────
  // 8. Deterministic-per-round target selection (canonical sort + seeded shuffle)
  // ────────────────────────────────────────────────────────────────────
  it('selectGossipTargets canonicalises voter set before shuffle', () => {
    // ADR-0120 §Risks: canonical sort BEFORE seeded shuffle is the
    // determinism contract. Skip this and the O(log N) bound doesn't hold.
    const fnIdx = src.search(/function\s+selectGossipTargets\s*\(/);
    assert.ok(fnIdx >= 0, 'expected selectGossipTargets function');
    const fnSlice = src.slice(fnIdx, fnIdx + 2000);
    // .sort() invocation on the voter set is required for canonicalisation.
    assert.match(fnSlice, /\.sort\(\)/);
    // Must derive seed from (proposalId, gossipRound) per §Specification.
    assert.match(fnSlice, /proposalId.*gossipRound|gossipRound.*proposalId/);
  });

  // ────────────────────────────────────────────────────────────────────
  // 9. Vote action wires gossip strategy through the propagation path
  // ────────────────────────────────────────────────────────────────────
  it('vote action handles strategy === "gossip" branch', () => {
    // The vote handler must distinguish gossip from non-gossip strategies
    // (separate settle path via settleCheckGossip, not tryResolveProposal).
    assert.match(
      src,
      /proposalStrategy\s*===\s*'gossip'/,
      'expected vote-action gossip branch',
    );
  });

  it('vote action updates lastVoteChangedRound on tally mutation', () => {
    // Per ADR §Pseudocode "on vote": the lastVoteChangedRound field tracks
    // the round number when the tally last mutated. Drives the strict-greater
    // clause of the settle predicate.
    assert.match(src, /lastVoteChangedRound\s*=/);
  });

  // ────────────────────────────────────────────────────────────────────
  // 10. Gossip-coordinator agent file annotated with allowed-tools
  // ────────────────────────────────────────────────────────────────────
  it('gossip-coordinator.md has allowed-tools frontmatter', () => {
    assert.ok(existsSync(AGENT_FILE), `expected ${AGENT_FILE}`);
    const md = readFileSync(AGENT_FILE, 'utf8');
    // Per ADR-0120 §Implementation §5: this commit adds allowed-tools but
    // NOT implementation-status (post-CI materialise pass adds that).
    assert.match(
      md,
      /allowed-tools:\s*\n\s*-\s*mcp__ruflo__hive-mind_consensus/,
      'gossip-coordinator.md must declare allowed-tools: [mcp__ruflo__hive-mind_consensus]',
    );
  });

  it('gossip-coordinator.md body shows strategy: "gossip" example', () => {
    const md = readFileSync(AGENT_FILE, 'utf8');
    // Per ADR-0120 §Implementation §5: body gains a short example showing
    // strategy: 'gossip' flowing through mcp__ruflo__hive-mind_consensus.
    assert.match(md, /strategy[":\s]+gossip/);
    assert.match(md, /mcp__ruflo__hive-mind_consensus/);
  });

  // ────────────────────────────────────────────────────────────────────
  // 11. Behavioural assertions via direct fanout math + settle-check
  // ────────────────────────────────────────────────────────────────────
  it('fanout math: assertion-by-source-grep on key edge cases', () => {
    // Cannot import the fork module directly from ruflo-patch (different
    // module graph), so we sanity-check the implementation via grep.
    // The deep-test in the fork covers numeric assertions.
    // Static check: gossipFanout returns 0 for N <= 1.
    const fnIdx = src.search(/function\s+gossipFanout\s*\(/);
    const fnSlice = src.slice(fnIdx, fnIdx + 400);
    assert.match(fnSlice, /return\s+0/);
  });

  // ────────────────────────────────────────────────────────────────────
  // 12. No silent fallback when gossip is unrecognised at the wire
  // ────────────────────────────────────────────────────────────────────
  it('calculateRequiredVotes still throws on unknown strategy (no silent fallback)', () => {
    // ADR-0120 doesn't add gossip to calculateRequiredVotes (gossip uses
    // settleCheckGossip, not threshold-based resolution). The default arm
    // continues to throw per ADR-0119 §Decision Drivers.
    const fnIdx = src.search(/function\s+calculateRequiredVotes\s*\(/);
    const fnSlice = src.slice(fnIdx, fnIdx + 2000);
    assert.match(fnSlice, /throw\s+new\s+Error\(`?Unknown consensus strategy/);
  });
});
