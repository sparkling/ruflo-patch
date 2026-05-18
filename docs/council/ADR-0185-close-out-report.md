---
adr: ADR-0185
status: closed
date: 2026-05-18
closed-on: 2026-05-18
tags: [hive-mind, consensus, cli-retirement, archivist, close-out]
---

# ADR-0185 close-out report — hive-mind consensus cli retirement

## Outcome

ADR-0185 is **closed**. The cli `hive-mind_consensus` handler is retired in favour of `archivist.dispatch('hive-mind_consensus', payload)` across all 4 action branches (propose / vote / status / list). Response shape is reconstructed via `buildConsensusResponse` from post-dispatch state. The 29-cell parity harness + the ruflo-patch wrapper gate are permanent regression guards.

| Concern | Pre-Wave-1 | Post-Wave-6 |
|---|---|---|
| Cli `hive-mind_consensus` handler LoC | ~870 | ~127 (thin dispatch) |
| Cli `withHiveStoreLock` wrapping the consensus tool | Yes (acquire-load-mutate-save-release) | **Deleted** (Wave 5) |
| Cli mutation-only consensus helpers | 3 reachable (`detectByzantineVoters`, `tryResolveProposal`, `maybeAdvanceGossipRoundOnTimeout`) | **Deleted** (Wave 6) |
| Strategy fan-out in cli | 6 strategies × 4 actions inline | 0 (all routed through agentdb dispatcher) |
| Response-shape contract | Implicit in cli call-sites | Explicit `ConsensusResponse` discriminated union + 29-cell parity harness |
| Acceptance gate | 672/681/0/9 (default) | 672/681/0/9 sustained across all 6 release patches; heavy gate cleared at close |

## Per-wave outcomes

| Wave | Scope | Fork (forks/ruflo) SHA(s) | ruflo-patch SHA | Release patch |
|---|---|---|---|---|
| **W1** | Additive `buildConsensusResponse` + 26-cell parity harness + wrapper gate test | `c81831164`, `425710868`, `b43e039f3`, `eeb26cd7f` | `ed141bf` | 190 |
| **W2a** | Harness shape-contract pivot (DA-mandated split): `toMatchObject` vs full `assertParity` per axis | `a20732b98` | `ada7f6c` | 192 |
| **W2b** | Flip `propose` action to `archivist.dispatch` | `7e06c8390` | `968ca06` | 193 |
| **W3** | Flip `vote` action; migrate 6 vote-handler source-greps cli → agentdb | `ca596e932` | `7250010` | 194 |
| **W4** | Flip `status` action (includes ADR-0131 inline-timing dispatch); update harness sentinel 28→29; migrate 4 status-side ADR-0131 assertions + 2 strategy-dispatch assertions cli → agentdb | `f4b9ffe12` | `d177cb7`, `10c9c85`, `dc31d13` | 197, 199 |
| **W5** | Flip `list` action + delete `withHiveStoreLock` wrapper around consensus tool entirely | `84defa083` | none (no test migration needed) | 202, 203 |
| **W6** | Delete 3 dead helpers + rewrite dangling comment refs + this close-out | `bf72ed19a` | (this commit) | (gate pending) |

**Cumulative LoC**:

- Cli handler `hive-mind_consensus`: 870 → 127 LoC (-743)
- Cli module-level helpers: 3 deletions, -128 LoC
- Cli `withHiveStoreLock` wrapper around consensus tool: deleted (-3 LoC, behavioural change)
- Response-builder + parity harness: +~1150 LoC (cli + test surface, permanent)
- Agentdb-side: untouched (ADR-0184 already shipped 6 per-strategy handlers)

## DA engagement per wave

DA's role across the 6 waves was structural: each wave received a numbered-axis plan; DA returned `Pass / Concern / Block` verdicts per axis. Implementation was held until all axes resolved.

| Wave | Plan axes | DA outcome | Notable interventions |
|---|---|---|---|
| W1 | 6 | 3 Pass + 3 Block (resolved) | Builder-emitted-false-for-undefined Block on `crdtTimedOut`; stale-CJS-artefacts blocking parity harness execution; harness wasn't truly green until execution verified by wrapper gate. |
| W2a/2b | 5 + 6 | Pass | DA mandated 2a/2b split: shape-contract harness pivot before the production flip. Singleton mock dispatch (`vi.hoisted({mockDispatch})`) introduced under W2b Block on `vi.mocked` factory binding. |
| W3 | 6 | Pass | `fs` mock writeSync no-op was masking dispatch state; resolved by fdToPath/fdBuffers capture pattern. |
| W4 | 7 | Pass | History-row response shape (`result` not `status`) verified via DA axis 3 trace; gossip-status `settleCheckGossip` re-invocation (Option A) confirmed safe. |
| W5 | 6 | Pass | `withHiveStoreLock` wrapper deletion confirmed safe (separate locks at `hive-mind_spawn` and `performSweep` unaffected). |
| W6 | 6 | Pass | **Helper-cleanup correction**: pre-Wave-6 plan listed 6 helpers; pre-emptive grep confirmed only 3 were truly unreachable (the other 3 have live callers in `hive-mind_status` + active test refs). Comment refs to deleted helpers rewritten past tense in `response.ts` (load-bearing rationale preserved). |

## Source-grep brittleness lesson

Across the 6 waves, 4 separate test-migration cycles were triggered by `assert.match(src, /identifier/)` assertions in `tests/unit/adr0131-*`, `adr0120-*`, `adr0121-*`. Every time an identifier relocated from cli to agentdb per-strategy handlers, the source-grep style assertion silently failed against the cli file and the migration had to be done by hand — locating the new home (typically 6 agentdb handler files instead of 1 cli file), confirming the assertion's intent still held there, and rewriting the assertion to grep either the agentdb dispatcher case-arm + per-strategy handler case-arm (the 2-step verification pattern).

**Recommendation for Wave 7+**: convert remaining `assert.match(src, ...)` style assertions to behavioural tests. Mock the dispatch, invoke the cli or agentdb tool, assert on the observable response shape and side-effects — not on the textual presence of an identifier in a source file. Source-grep assertions are an anti-pattern for code that moves between modules.

The user (team-lead) introduced a **pre-emptive scan technique** in W4 r1+ that mitigated the issue going forward: for each `assert.match(src, ...)` line in a test file, count occurrences of the searched identifier in cli vs agentdb. `cli=0 + agentdb>0` flagged the assertion as stale BEFORE the release attempt. This caught all remaining stale-grep issues in W5 + W6 with zero rework.

## Helper-cleanup correction (Wave 6)

Team-lead's pre-Wave-6 plan listed 6 helpers for deletion. Pre-emptive grep on `src/` + `__tests__/` revised this to 3:

| Helper | Status | Reason |
|---|---|---|
| `detectByzantineVoters` | **Deleted** | Zero callers, zero test refs |
| `tryResolveProposal` | **Deleted** | Zero callers (only a comment ref at hive-mind-tools.ts:652 — trimmed) |
| `maybeAdvanceGossipRoundOnTimeout` | **Deleted** | Zero callers |
| `selectGossipTargets` (exported) | **Kept** | 4 deterministic-gossip property tests in `mcp-tools-deep.test.ts:1239-1256` |
| `reconcileFailedFromStatusKeys` (exported) | **Kept** | Live caller in `hive-mind_status` handler (line 1803) — separate cli tool, ADR-0185 scope is `hive-mind_consensus` only |
| `workerMetaFor` (exported) | **Kept** | Live callers in `markWorkerFailed`, `registerWorkerRetry`, `reconcileFailedFromStatusKeys` (all ADR-0131 T12, load-bearing for `hive-mind_status`) |
| `calculateRequiredVotes` | **Kept** | Pure-read; called by `buildConsensusResponse` |
| `weightedTally` | **Kept** | Pure-read; called by `buildConsensusResponse` |
| `settleCheckGossip` | **Kept** | Pure-read; called by `buildConsensusResponse` |
| `gossipFanout` | **Kept** | Pure-read; called by `buildConsensusResponse` |
| `crdt-types.ts` (entire file) | **Kept** | Load-bearing for `buildConsensusResponse` (LWWRegister/ORSet/GCounter); imported directly by parity harness |

Per `feedback-no-squelch-tests` the 3 kept exported helpers retain their test refs unchanged.

## Parity harness lifecycle

Per ADR-0185 §Architecture the parity harness (`__tests__/hive-mind-consensus-parity.test.ts`, 29 cells) and the ruflo-patch wrapper gate (`tests/unit/adr-0185-parity-harness-gate.test.mjs`, 3 cells via `spawnSync('npx', ['vitest', 'run', ...])`) are **permanent regression guards**. No future wave may delete them. They lock in cli/agentdb response-shape parity for the lifetime of the dispatch pattern.

The harness's `vi.hoisted({mockDispatch, mockDispatchRead})` singleton pattern + `pushSyntheticProposal` / `pushSyntheticPostVoteProposal` direct-state-synthesis helpers are the load-bearing test infrastructure for any future work on `hive-mind_consensus`-related behaviour. Future contributors: extend the harness with new cells before flipping the production code.

## Carry-over

- `hive-mind_status` cli tool is **explicitly out of scope** for ADR-0185. Per the inline comment at `hive-mind-tools.ts:1784-1786`, status-tool retirement is deferred to a future ADR (the orchestration must first be broken into archivist read handlers — Phase 6+).
- `hive-mind_broadcast`, `hive-mind_shutdown`, `hive-mind_init`, `hive-mind_spawn` already flip through `archivist.dispatch` (per ADR-0181). No follow-up action.

## References

- [ADR-0185: Hive-Mind Consensus Cli Retirement](../adr/ADR-0185-hive-mind-consensus-cli-retirement.md) — parent ADR (now status: implemented, closed 2026-05-18)
- [ADR-0184: Hive-Mind Consensus Handler Port close-out](ADR-0184-close-out-report.md) — agentdb-side handlers (the precursor)
- [ADR-0181: Archivist Runtime Activation close-out](ADR-0181-close-out-report.md) — runtime activation program parent (Phase D)
- `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts` — cli host file
- `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hive-mind-consensus-response.ts` — `buildConsensusResponse` (W1 addition, ~470 LoC)
- `forks/ruflo/v3/@claude-flow/cli/__tests__/hive-mind-consensus-parity.test.ts` — parity harness (29 cells)
- `tests/unit/adr-0185-parity-harness-gate.test.mjs` — ruflo-patch wrapper gate
- `forks/agentdb/src/archivist/handlers/hive-mind/consensus/` — 6 per-strategy handlers (bft / raft / quorum / weighted / gossip / crdt)
