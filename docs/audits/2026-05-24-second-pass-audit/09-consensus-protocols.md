# 09 — Consensus protocols soundness audit

Second-pass audit closing **G-16-010 [MEDIUM]** from the 2026-05-19 gap
analysis. Read-only static audit; no edits. Covers the five `--consensus
<mode>` values surfaced by the `hive-mind` CLI/skill and the agent-type
catalog: `byzantine`, `raft`, `gossip`, `crdt`, `quorum`.

## Summary

- **CLI-advertised consensus modes**: 5 (`byzantine`, `raft`, `gossip`,
  `crdt`, `quorum`) — accepted by `hive-mind init --consensus`,
  `hive-mind_init` MCP tool, and the `hive-mind` interactive prompt.
- **Implementation locations**: THREE parallel implementations exist:
  1. **agentdb `archivist/handlers/hive-mind/consensus/*.ts`** — the live
     dispatch surface; 6 per-strategy handlers (bft/raft/quorum/weighted/
     gossip/crdt) plus a `byzantine→bft` normalisation in the parent
     dispatcher. Per-strategy invariants registered. Vendored
     `_crdt-types.ts` + `_shared.ts` helpers. **Honest, well-typed,
     bookkeeping-only (single-process state-merge).**
  2. **agentdb `archivist/handlers/coordination/consensus.ts`** — the
     `coordination_consensus` MCP tool surface. Only supports `bft/raft/
     quorum` (NO gossip, NO crdt). Same bookkeeping shape against a
     different store (`store.json` vs `hive-state.json`).
  3. **`@claude-flow/swarm/src/consensus/{raft,byzantine,gossip}.ts`**
     (1,425 LOC). Full PBFT three-phase / Raft leader-election / gossip
     fanout simulation in a single Node process. **Dead code on the
     hive-mind path** (`ConsensusEngine` only consumed by
     `unified-coordinator.ts` which itself has zero non-doc importers).
     No `crdt.ts`, no `quorum.ts`. Paxos silently falls through to Raft.
- **Findings**: 11 total (5 HIGH, 4 MEDIUM, 2 LOW)
- **Per-mechanism status**:

| Mode        | Live surface                   | Implementation kind               | Verdict |
|-------------|--------------------------------|-----------------------------------|---------|
| byzantine   | agentdb `consensus/bft.ts`     | Equivocation detection + 2N/3+1   | PARTIAL |
| raft        | agentdb `consensus/raft.ts`    | Term-bucketed majority (N/2+1)    | PARTIAL |
| gossip      | agentdb `consensus/gossip.ts`  | log₂N round bookkeeping           | PARTIAL |
| crdt        | agentdb `consensus/crdt.ts`    | G-Counter + OR-Set + LWW-Register | PASS    |
| quorum      | agentdb `consensus/quorum.ts`  | unanimous/majority/supermajority  | PASS    |

- **Soundness verdict**: PARTIAL — the live arithmetic (thresholds,
  byzantine detection, CRDT lattice math, quorum presets) is correct.
  But "consensus" is single-process state-merge, not distributed
  agreement; the names `byzantine` and `raft` overpromise PBFT and Raft
  guarantees that the surface cannot deliver.
- **Completeness verdict**: PARTIAL — all 5 modes route to real
  per-strategy handler bodies; no `_stub: true` surfaces; no string-only
  modes. But the swarm-side `RaftConsensus`/`ByzantineConsensus`/
  `GossipConsensus` classes (with simulated leader-election + PBFT
  phases) are **wired to nothing** — same May-19 parallel-impl pattern.
- **Bottom line**: The May-19 audit's "dishonest envelope" pattern does
  NOT apply at the handler level — `tryResolveProposal` actually fires
  on `votesFor >= required`, byzantine equivocation actually flags
  voters, the CRDT merge functions are mathematically sound. But the
  larger picture is: `--consensus byzantine` does NOT give a user PBFT
  fault-tolerance, and `--consensus raft` does NOT give Raft leader
  election; both deliver "boolean voting recorded against a JSON file
  with per-strategy threshold arithmetic." Per ADR-0210 stub-honesty
  pattern, names like `byzantine-coordinator` and `raft-manager` are
  prompt-only Markdown — there is no dispatch path from those agent
  names to any consensus enforcement.

## Implementation map

The `hive-mind --consensus <mode>` flag flows:

```
hive-mind init --consensus byzantine
  → cli `hive-mind init` action
     → callMCPTool('hive-mind_init', { consensus: 'byzantine', … })
        → cli `hive-mind_init` handler
           → withHiveStoreLock(loadHiveState → state.config.consensus = 'byzantine' → saveHiveState)
           → getProcessArchivist().dispatch('hive-mind_init', { state })

hive-mind_consensus({action:'propose', strategy:'byzantine', …})
  → cli `hive-mind_consensus` handler (still load-bearing until Wave 6 retirement)
     → buildConsensusResponse() shape contract
     → getProcessArchivist().dispatch('hive-mind_consensus', payload)
        → agentdb `consensusHiveMindHandler` (handlers/hive-mind/consensus.ts)
           → normalise 'byzantine' → 'bft' at entry
           → switch(strategy) → handleBftConsensus / handleRaftConsensus / handleQuorumConsensus / handleWeightedConsensus / handleGossipConsensus / handleCrdtConsensus
              → reconcileFailedFromStatusKeys + load → tryResolveProposal arithmetic → saveHiveStateToHandle
```

The `@claude-flow/swarm/src/consensus/{raft,byzantine,gossip}.ts` path
(real PBFT three-phase, leader election, gossip fanout) is *exported*
from the swarm package's `index.ts` but **no live code imports the swarm
package**: `grep -rn "from '@claude-flow/swarm'" forks/ruflo/v3/
@claude-flow/cli/src/` returns ZERO hits. The package's only consumer
inside the v3 tree is `swarm/src/unified-coordinator.ts` itself plus
doc files; `unified-coordinator.ts` has no production callsite either.

## Findings

### F-09-001 [HIGH] `@claude-flow/swarm/src/consensus/{raft,byzantine,gossip}.ts` are dead code on the hive-mind path

- **Location:**
  - `forks/ruflo/v3/@claude-flow/swarm/src/consensus/raft.ts` (443 LOC)
  - `forks/ruflo/v3/@claude-flow/swarm/src/consensus/byzantine.ts` (431 LOC)
  - `forks/ruflo/v3/@claude-flow/swarm/src/consensus/gossip.ts` (551 LOC)
  - `forks/ruflo/v3/@claude-flow/swarm/src/consensus/index.ts` (267 LOC — `ConsensusEngine` factory)
  - `forks/ruflo/v3/@claude-flow/swarm/src/unified-coordinator.ts:303` — only `ConsensusEngine` instantiation site
- **Issue:** 1,425 LOC of consensus simulation (PBFT three-phase
  pre-prepare/prepare/commit, Raft randomised election timeouts,
  gossip BoundedSet + fanout selection + anti-entropy) is unreachable
  from any user-facing path. `grep -rn "from '@claude-flow/swarm'"` in
  `cli/src/` returns zero. The swarm package's only in-tree importer
  is `unified-coordinator.ts` which has no live callsite — README and
  MIGRATION.md document `import { createUnifiedSwarmCoordinator }` as
  a public API, but no MCP tool, no CLI command, and no init wiring
  reaches it. The user-facing `hive-mind --consensus byzantine` flag
  routes through `cli/src/mcp-tools/hive-mind-tools.ts` →
  `agentdb/archivist/handlers/hive-mind/consensus/bft.ts`, bypassing
  the swarm-side `ByzantineConsensus` entirely.
- **Evidence:**
  ```bash
  $ grep -rln "import.*@claude-flow/swarm\|from '@claude-flow/swarm" \
      forks/ruflo/v3/@claude-flow/cli/src/ 2>/dev/null
  # (empty — zero CLI src/ imports)

  $ grep -rn "ConsensusEngine\|RaftConsensus\|ByzantineConsensus" \
      forks/ruflo/v3/ | grep -v dist | grep -v test \
      | grep -v swarm/src/consensus
  # only: swarm/src/unified-coordinator.ts:303
  #       swarm/src/index.ts:187-192 (re-exports)
  #       3 README/MIGRATION/ADR mentions
  ```
- **Impact:** Same May-19 parallel-impl anti-pattern (cf. F-01-* hooks
  package vs `hooks-tools.ts`, F-09-* MCP server vs CLI hand-rolled
  stdio). Users reading the swarm README see PBFT three-phase
  consensus; runtime serves single-process state-merge bookkeeping.
  Per ADR-0210 stub-honesty pattern, the swarm-side classes need
  either a real callsite or a `// DEAD CODE — not on user path` header
  to disambiguate from the agentdb handler set that IS live.

### F-09-002 [HIGH] swarm-side `RaftConsensus`/`ByzantineConsensus`/`GossipConsensus` are in-process simulations — "peers" are local Map entries

- **Location:**
  - `forks/ruflo/v3/@claude-flow/swarm/src/consensus/raft.ts:43,257-309` (peers Map + requestVote/appendEntries)
  - `forks/ruflo/v3/@claude-flow/swarm/src/consensus/byzantine.ts:45,354-361` (nodes Map + broadcastMessage)
  - `forks/ruflo/v3/@claude-flow/swarm/src/consensus/gossip.ts:84,316-376` (nodes Map + sendToNeighbor → processReceivedMessage)
- **Issue:** All three classes use a local `Map<string, PeerNode>` for
  peers and "communicate" by directly mutating peer state in the same
  Node process. `RaftConsensus.requestVote(peerId)` does
  `this.peers.get(peerId)` (lines 257-270) and grants based on the
  local in-memory term — no RPC, no message channel. `appendEntries`
  pushes directly into the peer's `log` array (lines 296-309).
  `ByzantineConsensus.broadcastMessage()` only `this.emit(...)`s
  events (lines 354-361) — peers' `handlePrePrepare` /
  `handlePrepare` / `handleCommit` are never called externally.
  `GossipConsensus.sendToNeighbor` calls
  `await this.processReceivedMessage(neighbor, deliveredMessage)`
  directly (line 335) — there is no wire, no serialisation, no
  network. ADR-0095 §F-09-001 already acknowledges this: "The handler
  underneath is still EventEmitter-based and runs in a single Node
  process. `byzantine-coordinator.ts`'s `verifySignature()` returns
  `true` unconditionally. `RaftConsensus.requestVotes()` does
  `this.emit('vote_request')` against a local emitter. There are no
  sockets, no gRPC, no inter-node transport."
- **Evidence:**
  ```ts
  // byzantine.ts:354-361 — "broadcast" is just emit
  private async broadcastMessage(message: ByzantineMessage): Promise<void> {
    this.emit('message.broadcast', { message });
    for (const node of this.nodes.values()) {
      this.emit('message.sent', { to: node.id, message });
    }
    // ↑ no peer.handlePrePrepare(message) call; peers never see this
  }

  // gossip.ts:335 — "send" is direct local call
  await this.processReceivedMessage(neighbor, deliveredMessage);

  // raft.ts:257-270 — vote-request is local lookup
  private async requestVote(peerId: string): Promise<boolean> {
    const peer = this.peers.get(peerId);
    if (this.node.currentTerm > peer.currentTerm) { ... }
  }
  ```
- **Impact:** Even on the dead path (F-09-001), the implementations
  cannot deliver Raft / PBFT / gossip guarantees because there is no
  multi-process or multi-node substrate. If anyone ever wires
  `ConsensusEngine` to a real callsite (e.g. via the documented
  `import { UnifiedSwarmCoordinator } from '@claude-flow/swarm'`
  USERGUIDE example), they will get distributed-consensus semantics
  the implementation cannot uphold — exactly the trap ADR-0095
  flagged.

### F-09-003 [HIGH] `ByzantineConsensus.canTolerate` exists but is never called from `propose()` / `vote()`

- **Location:**
  - `forks/ruflo/v3/@claude-flow/swarm/src/consensus/byzantine.ts:118-190` (propose + vote)
  - `forks/ruflo/v3/@claude-flow/swarm/src/consensus/byzantine.ts:416-423` (`getMaxFaultyNodes` + `canTolerate`)
  - `forks/ruflo/v3/@claude-flow/swarm/__tests__/consensus.test.ts:219-221` (only callers — tests)
- **Issue:** PBFT requires `N ≥ 3f+1` to tolerate `f` faulty nodes. The
  swarm-side `ByzantineConsensus.canTolerate(faultyCount)` correctly
  computes `faultyCount ≤ floor((N-1)/3)`, but no production code
  invokes it. `propose()` (line 118) and `vote()` (line 166) read
  `config.maxFaultyNodes ?? 1` and compute `requiredVotes = 2*f + 1`
  WITHOUT first checking `N ≥ 3f+1`. A 3-node cluster with
  `maxFaultyNodes: 2` will yield `requiredVotes = 5` — unreachable
  with 3 voters — and proposals will silently never resolve.
  `signature?: string` is declared on the `ByzantineMessage` type
  (line 25) but is never set on any broadcast (lines 141-251) and
  never verified on any receive (lines 221-337) — no cryptographic
  signing. The `computeDigest()` (line 363) is a `(hash << 5) - hash`
  multiplicative-cyclic-shift hash, not collision-resistant.
- **Evidence:**
  ```ts
  // byzantine.ts:166-190 — vote with no N≥3f+1 check
  async vote(proposalId: string, vote: ConsensusVote): Promise<void> {
    const f = this.config.maxFaultyNodes ?? 1;
    const n = this.nodes.size + 1;
    const requiredVotes = 2 * f + 1;
    // ← no check that n >= 3*f + 1
    ...
  }

  // computeDigest is xor-multiply, not crypto:
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  ```
- **Impact:** Dishonest envelope per May-19 pattern: PBFT semantics
  advertised, fault-tolerance precondition unenforced, signatures
  declared in the type but never present, digest unsuitable for
  byzantine-resistant message integrity. Even if someone wires up
  this dead code, mis-configuration silently breaks consensus.

### F-09-004 [HIGH] agentdb-side "Raft" handler has NO leader election and NO log replication

- **Location:**
  - `forks/agentdb/src/archivist/handlers/hive-mind/consensus/raft.ts:52-55` (queenTerm sourcing)
  - `forks/agentdb/src/archivist/handlers/hive-mind/consensus/raft.ts:58-103` (propose body)
  - `forks/agentdb/src/archivist/handlers/hive-mind/consensus/raft.ts:105-173` (vote body)
- **Issue:** The handler the user reaches with
  `--consensus raft` does NOT implement Raft. There is no candidate
  state, no election timeout, no `RequestVote` RPC, no `AppendEntries`
  RPC, no log, no commitIndex / lastApplied, no `votedFor` tracking.
  What it does:
  1. `term ← payload.term ?? state.queen?.term ?? 1` (line 59) — the
     queen IS the de facto leader, externally elected via
     `hive-mind_init`'s queen-assignment step.
  2. Single-pending-proposal-per-term guard
     (`RaftTermCollisionError`) — borrowed from Raft's
     append-entries serialisation.
  3. No double-vote: any prior vote in `proposal.votes[voterId]`
     throws `RaftVoteChangeError` (line 147).
  4. Simple majority threshold `floor(N/2)+1` via
     `calculateRequiredVotes('raft', N)` and
     `tryResolveProposal()` (line 154). On `votesFor >= required` →
     status='approved', move to history.
  This is **term-bucketed majority voting against a pre-elected
  queen** — useful, but not Raft. The skill doc line 136 calls it
  "Leader-elected single-decision rounds with term ordering" which
  is honest enough phrasing; the CLI hint at `commands/hive-mind.ts:
  146` ("Raft, Leader-based consensus") suggests leader election the
  surface does not perform.
- **Evidence:**
  ```ts
  // raft.ts:52-55 — term sourced from queen, no candidate state
  const queenTerm = (() => {
    const q = (state as { queen?: { term?: number } }).queen;
    return typeof q?.term === 'number' ? q.term : 1;
  })();

  // raft.ts:154 — resolution is plain N/2+1 majority
  const resolution = tryResolveProposal(proposal, totalNodes);
  // → calculateRequiredVotes('raft', N) = Math.floor(N/2)+1
  ```
- **Impact:** Honest fork (`feedback-no-fallbacks`-compliant arithmetic
  + typed errors + invariants registered) — but the *name* "Raft"
  oversells. A user pulling this for "leader-election-with-failover
  semantics" will not get them. Cf. ADR-0095 §C "ADR-093 F3 made
  hive-mind_init accept consensus: 'raft' | 'byzantine' | … the
  parameter is honest now" — parameter, yes; semantics, no.

### F-09-005 [HIGH] `coordination_consensus` MCP tool only supports `bft/raft/quorum` despite `coordination_topology` accepting `gossip/crdt`

- **Location:**
  - `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/coordination-tools.ts:170` (topology schema:
    `enum: ['raft', 'byzantine', 'gossip', 'crdt']`)
  - `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/coordination-tools.ts:558` (consensus schema:
    `enum: ['bft', 'raft', 'quorum']` — no gossip, no crdt)
  - `forks/agentdb/src/archivist/handlers/coordination/consensus.ts:58`
    (`CoordinationConsensusStrategy = 'bft' | 'raft' | 'quorum'`)
- **Issue:** `coordination_topology({action:'set', consensusAlgorithm:'gossip'})`
  is accepted at the boundary and persisted to
  `store.topology.consensusAlgorithm` — but no `coordination_*` tool
  ever consumes that field. The companion
  `coordination_consensus({action:'propose', strategy:'gossip'})`
  rejects with "must be one of bft/raft/quorum" because the input
  schema enum doesn't include gossip. Two adjacent tools, two
  disjoint consensus enums, neither boundary surfaces the mismatch.
- **Evidence:**
  ```ts
  // coordination-tools.ts:170 — topology accepts gossip+crdt
  consensusAlgorithm: { type: 'string',
    enum: ['raft', 'byzantine', 'gossip', 'crdt'], ... },

  // coordination-tools.ts:558 — consensus only accepts bft/raft/quorum
  strategy: { type: 'string',
    enum: ['bft', 'raft', 'quorum'], ... },
  ```
- **Impact:** Theatrical configuration at the `coordination_topology`
  surface (per May-19 H15 pattern — env vars no source reads). Users
  who set `consensusAlgorithm:'gossip'` via topology and later try
  `coordination_consensus` see a schema rejection. Skill doc line
  138 ("gossip supports 4-32 nodes") implies gossip is a valid
  coordination strategy — surface lies.

### F-09-006 [MEDIUM] `byzantine` is an alias for `bft` — silent normalisation hides the rename from caller logs

- **Location:**
  - `forks/agentdb/src/archivist/handlers/hive-mind/consensus.ts:186-191`
    (rawStrategy === 'byzantine' ? 'bft' : (rawStrategy ?? 'raft'))
  - `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts:73`
    (`ConsensusStrategyName = 'raft' | 'byzantine' | 'gossip' | 'crdt' | 'quorum'`)
  - `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts:313`
    (`ConsensusStrategy = 'bft' | 'raft' | 'quorum' | 'weighted' | 'gossip' | 'crdt'`)
- **Issue:** Two internal type unions co-exist: the user-facing
  `ConsensusStrategyName` carries `byzantine`; the internal
  `ConsensusStrategy` carries `bft` + the unadvertised `weighted`.
  Wire-boundary alias normalisation at the parent dispatcher
  (`consensus.ts:189`) silently rewrites `byzantine → bft`. The
  history-row's `strategy` field stores `'bft'`, not `'byzantine'` —
  so a status query against a proposal proposed with
  `strategy: 'byzantine'` returns `strategy: 'bft'`. Skill doc line
  135 makes the alias explicit ("byzantine (alias bft)") so this is
  documented, but the public consensus history surface drifts from
  the CLI flag.
- **Impact:** Audit / observability noise: `consensus.history[*].
  strategy === 'bft'` after a `--consensus byzantine` proposal.
  Per `feedback-no-fallbacks` the right shape is "expose both
  values and reject mid-stream renames", not silent normalisation.

### F-09-007 [MEDIUM] `weighted` strategy is internal-only — advertised in 4 places, missing from the user CLI enum

- **Location:**
  - `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts:73`
    (CLI enum: no `weighted`)
  - `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts:313`
    (internal enum: has `weighted`)
  - `forks/agentdb/src/archivist/handlers/hive-mind/consensus.ts:79`
    (handler enum: has `weighted`)
  - `forks/agentdb/src/archivist/handlers/hive-mind/consensus/weighted.ts`
    (277 LOC handler — queen-weighted denominator,
    `MissingQueenForWeightedConsensusError`)
  - `forks/ruflo/.claude/skills/hive-mind-advanced/SKILL.md:130`
    ("The fork supports 7 algorithms")
- **Issue:** `weighted` consensus is fully implemented in agentdb
  (calculateRequiredVotes returns `totalWorkers + queenWeight`,
  weightedTally awards `queenWeight=3` to the queen) and the skill
  doc advertises 7 algorithms — but the user-facing
  `ConsensusStrategyName` only exposes 5, and the
  `hive-mind --consensus` flag only accepts those 5. A user reaching
  `weighted` must hit the MCP tool directly with
  `{strategy: 'weighted'}` even though the CLI flag rejects it.
- **Impact:** Capability undeliverable from the documented surface;
  ADR-0119 implementation is reachable only by MCP-tool callers
  who bypass the CLI parser.

### F-09-008 [MEDIUM] `paxos` accepted in swarm `ConsensusAlgorithm` type but silently routes to Raft

- **Location:**
  - `forks/ruflo/v3/@claude-flow/swarm/src/types.ts:199`
    (`ConsensusAlgorithm = 'raft' | 'byzantine' | 'gossip' | 'paxos'`)
  - `forks/ruflo/v3/@claude-flow/swarm/src/consensus/index.ts:77-85`
    (`case 'paxos':` falls through to `createRaftConsensus(...)`)
- **Issue:** The swarm-side `ConsensusAlgorithm` type advertises
  `paxos`, but the `ConsensusEngine.initialize()` switch silently
  substitutes Raft with the comment "Fall back to Raft for Paxos
  (similar guarantees)." This is exactly the silent-fallback
  pattern `feedback-no-fallbacks` flags. (Mitigated by F-09-001:
  the swarm path is dead, so nobody actually reaches this — but
  the type system still claims Paxos support.)
- **Impact:** Even if the swarm path were live, a user passing
  `algorithm: 'paxos'` would get Raft behaviour with no warning.

### F-09-009 [MEDIUM] `gossip` and `crdt` "convergence" is single-process bookkeeping; the substrate file IS the wire

- **Location:**
  - `forks/agentdb/src/archivist/handlers/hive-mind/consensus/gossip.ts:158-243`
  - `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts:697-705`
    (header comment: "In a single-process MCP server, the 're-broadcast'
    is the bookkeeping itself — peers' state is shared via
    `state.consensus.pending`")
  - `forks/agentdb/src/archivist/handlers/hive-mind/consensus/crdt.ts:203-208`
    (`proposal.crdtState = mergeCRDTState(before, voterSnapshot)`)
- **Issue:** Both implementations are *internally* correct:
  - Gossip: `gossipFanout(N) = ceil(log₂ N)`, deterministic seeded
    target selection, settle predicate
    `round >= ceil(log₂N) AND (round > lastVoteChangedRound OR N==1)`,
    hard budget `2*ceil(log₂N)`. Fanout/round math matches the
    epidemic literature.
  - CRDT: G-Counter (slot-wise max), OR-Set (add-wins union with
    tombstones), LWW-Register (lex `(timestamp, voterId)` tiebreak)
    — merge ops genuinely commutative + associative + idempotent.
  But the "convergence" is fictional because there's only ONE node:
  every "voter" writes through the same MCP server, against the
  same `state.consensus.pending[*]` object, under the same substrate
  lock. There are no replicas to converge. The CRDT lattice math is
  exercised on a per-proposal accumulator; correctness of `merge` is
  proven but operationally vacuous.
- **Evidence:**
  ```ts
  // hive-mind-tools.ts:697-705 — header comment makes it explicit
  // "Push-style epidemic propagation. Each `vote` action where
  // strategy is 'gossip' triggers fanout-bounded re-broadcast
  // bookkeeping. In a single-process MCP server, the 're-broadcast'
  // is the bookkeeping itself — peers' state is shared via
  // `state.consensus.pending`, so target voters observe the merged
  // proposal on their next vote/status call."
  ```
- **Impact:** Honestly documented in the source comments, but the
  USERGUIDE / skill docs frame these as "eventually consistent for
  large-scale distributed systems" (gossip.ts:2) and "Conflict-free
  state-merging; re-broadcast safety dominates" (skill doc:139),
  which imply replicas the implementation does not have.

### F-09-010 [LOW] Agent type catalog `byzantine-coordinator` / `raft-manager` / `gossip-coordinator` / `crdt-synchronizer` / `quorum-manager` are prompt-only Markdown

- **Location:**
  - `forks/ruflo/v3/@claude-flow/cli/.claude/agents/consensus/*.md`
    (5 files, plus `consensus-builder.md`, `security-manager.md`)
  - `forks/ruflo/v3/@claude-flow/cli/src/init/executor.ts:1748`
    (CLAUDE.md template lists them as "Consensus & Distributed (7)")
- **Issue:** The 5 agent names users see in the catalog (and the 7
  the init template advertises) have NO source code in `src/`. They
  are Markdown prompt templates with frontmatter (`name`, `type`,
  `description`, `capabilities`, pre/post hooks) plus a body
  describing the role. When a user spawns
  `byzantine-coordinator`, Claude is given the prompt body and asked
  to roleplay; no dispatch path connects the agent to any of the
  per-strategy handlers from F-09-* above. Per ADR-0210 stub-honesty
  pattern, the agent name overpromises real consensus enforcement.
- **Impact:** Low because the prompt-only roleplay is consistent with
  Claude Code's broader agent-as-Markdown convention — but a user
  who reads the byzantine-coordinator description ("Deploy PBFT
  three-phase protocol… threshold signature schemes… zero-knowledge
  proofs for vote verification") will not get any of those from
  spawning that agent. The hive-mind dispatch path is the only way
  to reach actual byzantine voter-equivocation detection.

### F-09-011 [LOW] Three vendored CRDT-types copies + two parallel consensus surfaces

- **Location:**
  - `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/crdt-types.ts` (440 LOC, ADR-0121)
  - `forks/agentdb/src/archivist/handlers/hive-mind/consensus/_crdt-types.ts` (452 LOC, "vendored verbatim")
  - `forks/agentdb/src/types/quic.ts:101-188` (G-Counter / LWW-Register / OR-Set defined again, never wired — May-19 F-06-002)
- **Issue:** Three copies of essentially-the-same CRDT primitives
  exist. The cli copy is consumed by `hive-mind-tools.ts`
  (load-bearing); the agentdb `_crdt-types.ts` is consumed by the
  archivist's `crdt.ts` handler (also load-bearing); the
  `types/quic.ts` copy (which May-19 F-06-002 flagged as zero
  callers) is dead. Two surfaces, parallel:
  `hive-mind_consensus` (handlers/hive-mind/consensus/*) vs
  `coordination_consensus` (handlers/coordination/consensus.ts) —
  with overlapping `bft/raft/quorum` support but disjoint
  feature sets (gossip/crdt/weighted only on hive-mind side).
- **Impact:** Maintenance overhead — three locations to fix any
  CRDT-merge bug. Two surfaces is intentional per the handler
  comments (different stores, different lifecycle), but the
  cli vs vendored cli `crdt-types.ts` pair will drift; the
  agentdb-side comment ("Cli `crdt-types.ts` stays load-bearing
  through Wave 6 — same vendor pattern as Wave 2's `_shared.ts`")
  acknowledges this as known scaffolding.

## Cross-cutting patterns

1. **Parallel-implementation again** (cf. May-19 F-01/F-09/F-10): the
   swarm-side `RaftConsensus`/`ByzantineConsensus`/`GossipConsensus`
   (with simulated leader-election + PBFT phases) is dead code; the
   live path is agentdb's `archivist/handlers/hive-mind/consensus/*`
   (bookkeeping arithmetic). Same anti-pattern: rich dead-code +
   honest live-code that overpromises in naming.
2. **Single-process simulation labelled as distributed consensus.**
   Both the swarm-side dead code (F-09-002: peers are local Map) and
   the agentdb-side live code (F-09-009: substrate file IS the wire)
   are single-process. The arithmetic is correct; the *names*
   `byzantine`, `raft`, `gossip` overpromise the distributed
   guarantees that none of the surfaces can deliver.
3. **Type-union drift across the boundary.** Five enums for consensus
   strategy live in different files: cli `ConsensusStrategyName` (5
   modes for the user), cli `ConsensusStrategy` (6 modes for
   internal dispatch — adds `weighted`, renames `byzantine→bft`),
   agentdb `ConsensusStrategy` (7 modes — keeps both `bft` AND
   `byzantine`), agentdb `CoordinationConsensusStrategy` (3 modes —
   bft/raft/quorum only), and swarm `ConsensusAlgorithm` (4 modes —
   raft/byzantine/gossip/paxos with paxos→raft silent substitution).
   Aliases (`byzantine`↔`bft`) silently normalised at boundary.
4. **Stub-honesty pattern (ADR-0210):** none of the 5 live handlers
   are `_stub: true` and all do real arithmetic — but the wider
   surface (5 agent-type Markdown files + 1 dead consensus engine +
   declared-but-not-supported `paxos`) advertises capabilities the
   live code cannot deliver. The name `raft-manager` (agent) doesn't
   reach the handler that mostly-does-Raft (consensus/raft.ts) which
   itself is term-bucketed majority — three layers of overpromise.
5. **`feedback-no-fallbacks` compliance is high at the handler
   level**: per-strategy handlers throw typed errors
   (`RaftTermCollisionError`, `RaftVoteChangeError`,
   `DuplicateVoteError`, `ProposalAlreadyFailedError`,
   `ProposalNotFoundError`, `VoterIdRequiredError`,
   `WorkerAlreadyFailedError`, `MissingQueenForWeightedConsensusError`).
   `tryResolveProposal` deadlock arithmetic returns `'rejected'`
   when `votesFor + remaining < required` AND
   `votesAgainst + remaining < required`. Gossip exhaustion stays
   `'pending'` with `gossipExhausted=true` rather than silently
   settling. The arithmetic discipline is strong; the *naming* is
   where dishonesty lives.

## Out-of-scope (not audited per task constraints)

- Distributed-systems correctness of the **simulated** PBFT three-phase
  flow in swarm `byzantine.ts` (because it's dead code).
- Cryptographic verification of message signatures (the `signature?:
  string` field in `ByzantineMessage` is unused per F-09-003).
- View-change protocol in swarm `byzantine.ts:341-350` (dead code).
- Anti-entropy scheduling for `gossip.ts:antiEntropy()` (only test
  callers found; never scheduled in production).
- Multi-node correctness (no multi-node substrate exists).
- Test coverage depth — files exist
  (`agentdb/test/archivist/handlers/hive-mind/consensus/{bft,raft,
  quorum,weighted,gossip,crdt,dispatch}.test.ts` + cli
  `hive-mind-consensus-parity.test.ts` + swarm `consensus.test.ts`)
  but not inventoried for branch coverage.
- The `_consensus({action:'propose'})` race-fix path under
  `withHiveStoreLock` + archivist dispatch coexistence (covered by
  May-19 audit's runtime hooks slice).
- Agent runtime behaviour: when Claude spawns
  `byzantine-coordinator`, what does it actually do? (Markdown
  prompt body — not consensus enforcement, per F-09-010.)
- `mesh-coordinator` (referenced in G-16-010 brief but not a
  consensus mode — topology coordinator).
