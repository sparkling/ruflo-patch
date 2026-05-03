# ADR-0105: Topology behavior differentiation

- **Status**: Accepted (Option C, 2026-05-02); behavioural dispatch superseded by ADR-0128 (T10 complete in ADR-0118 §Status, 2026-05-03). Original investigation residuals: none.
- **Date**: 2026-04-29 (promoted 2026-05-01)
- **Roadmap**: ADR-0103 item 1
- **Scope**: hive-mind topology semantics (`hierarchical` / `mesh` /
  `hierarchical-mesh` / `adaptive`).

### Implementation note (2026-05-03)

State layer wired and behavioural dispatch shipped via T10/ADR-0128. Wire points:

- `forks/ruflo/v3/@claude-flow/swarm/src/topology-manager.ts:1-656` — TopologyManager state layer (adjacency list, leader election, role-indexed maps)
- `forks/ruflo/v3/@claude-flow/swarm/src/unified-coordinator.ts:139,170` — TopologyManager imported and instantiated by UnifiedSwarmCoordinator
- `forks/ruflo/v3/@claude-flow/cli/src/commands/hive-mind.ts:91-137` — per-topology coordination-protocol blocks at the worker-spawn dispatch site (ADR-0128 ownership)

## Context

README §Swarm Coordination promises:
- "Coordination | Queen, Swarm, Consensus | Manages agent teams (Raft, Byzantine, Gossip)"
- "Comparison: Swarm Topologies: ✅ 4 types"
- "Hive Mind: Queen-led hierarchy, Collective memory | Strategic/tactical/adaptive queens coordinate workers"

ADR-0104 §Out-of-scope notes that today, `--topology hierarchical-mesh`
in `hive-mind spawn` is **prompt-string interpolation**: the topology
name lands in the Queen prompt header and the Queen reads it as
guidance. There is no per-topology cross-worker visibility, no ring-pass
semantics, no peer-to-peer routing.

## Investigation findings

### Upstream ADRs

- `forks/ruflo/v3/docs/adr/`: only a `README.md` index, no topology-specific ADR.
- `forks/ruflo/ruflo/docs/adr/`: empty.
- `forks/ruflo/ruflo/src/ruvocal/docs/adr/`: unrelated.
- `forks/ruflo/v3/README.md` line 13–28 + ADR-003 reference: declares "Single coordination engine (UnifiedSwarmCoordinator)".

### Source archaeology

A full topology runtime **exists** but is **orphaned** from the hive-mind CLI path:

| File | Lines | What it does |
|---|---|---|
| `v3/@claude-flow/swarm/src/topology-manager.ts` | 656 | `TopologyManager` class + `createTopologyManager()` factory. Implements add/remove/update node, leader election, rebalance. Maintains adjacency list + role-indexed maps. `EventEmitter`. |
| `v3/@claude-flow/swarm/src/types.ts` | — | `TopologyType = 'mesh' \| 'hierarchical' \| 'centralized' \| 'hybrid'`. (Note: not the same labels as the README's `hierarchical-mesh` / `adaptive`.) |
| `v3/@claude-flow/swarm/src/unified-coordinator.ts` | — | `UnifiedSwarmCoordinator` instantiates `TopologyManager` (line 170) and wires it through. |
| `v3/@claude-flow/swarm/src/index.ts` | — | Public re-export of `TopologyManager`. Header comment claims "Multiple topology support: mesh, hierarchical, centralized, hybrid". |
| `v3/@claude-flow/swarm/__tests__/topology.test.ts` | — | Full vitest suite: initialization per topology, node lifecycle, leader election. |

**Wire-up gap**: `grep -r 'TopologyManager' v3/@claude-flow/cli/` returns
nothing in TypeScript source. The CLI's `commands/hive-mind.ts` does not
import or instantiate any topology runtime. The `--topology` flag is read
into `result.topology` and substituted into the generated Queen prompt as
text — that's all.

### v3 migration doc

`v3/implementation/v3-migration/HIVE-MIND-MIGRATION.md` is candid about
the gap. Its feature-migration table lists:

| V2 Component | V3 Equivalent | Status |
|---|---|---|
| `HiveMind.ts` | `unified-coordinator.ts` | ⚠️ Partial |
| `Queen.ts` | Missing | ❌ Needs implementation |

The migration was **not completed**. There are two parallel "queen"
concepts in the codebase:
- The prompt-driven Queen launched by `hive-mind spawn --claude` (real,
  works after ADR-0104 — the path that orchestrates via `claude` CLI).
- The swarm-package `QueenCoordinator` (incomplete migration target,
  never reached production from CLI).

### Label mismatch

The README claims four topologies: `hierarchical`, `mesh`,
`hierarchical-mesh`, `adaptive`.

The code defines four (different) topologies: `'mesh' | 'hierarchical' | 'centralized' | 'hybrid'`.

Overlap: `mesh` and `hierarchical`. Mismatched: README's `hierarchical-mesh` ≈ code's `hybrid`; README's `adaptive` has no code counterpart.

## Current state verdict

- ✅ Code: well-tested topology engine exists (`TopologyManager` + tests).
- ❌ Wiring: hive-mind CLI does not use it.
- ❌ Label alignment: README claims four topologies that don't all match the code's four.
- ❌ Behavior: today, topology is a prompt string the Queen reads.

## Decision options

### Option A — Wire-up (substantive fix)

Make `hive-mind spawn --claude` instantiate `UnifiedSwarmCoordinator` so
the topology engine actually governs the hive. Specifically:

1. **CLI side** (`commands/hive-mind.ts`): when `--topology` is set,
   create a `UnifiedSwarmCoordinator` instance and persist its handle
   to `.claude-flow/hive-mind/state.json` so MCP tools can address it.
2. **MCP side** (`mcp-tools/hive-mind-tools.ts`): add a node-registration
   handler so workers register themselves with the topology on first
   `hive-mind_memory({action:'set'})` call.
3. **Worker contract** (in §6 prompt from ADR-0104): direct workers to
   call `mcp__ruflo__hive-mind_register` with their agentId before
   writing their result key.
4. **Topology-aware visibility**: `hive-mind_memory({action:'get'})` reads
   become topology-filtered — a worker in a `hierarchical` topology
   only sees its own subtree's keys; a worker in `mesh` sees all.
5. **Label reconciliation**: extend `TopologyType` to include
   `'hierarchical-mesh'` (= current `hybrid`) and `'adaptive'` (= dynamic
   reconfiguration based on load). OR: rename README labels to match
   code. OR: add a CLI translation layer.

Effort estimate: 2–3 ADR-shaped pieces of work. Touches 4–5 fork files,
needs new MCP tool, paired tests at all three levels.

### Option B — Doc correction (cheap, deflationary)

Acknowledge that hive-mind topology is metadata only. README is updated
to:

> "Topology metadata: `hierarchical`, `mesh`, `hierarchical-mesh`, `adaptive`
> are passed to the Queen as guidance text. The Queen's interpretation
> shapes its coordination style. Cross-worker routing semantics are
> not enforced at runtime; aggregation is via shared memory."

The `--topology` flag stays, the runtime stays prompt-driven. The orphaned
swarm package becomes documented as "future runtime, not yet wired".

Effort estimate: README diff + ADR-0101 fork-README delta prelude.

### Option C — Hybrid

Wire `TopologyManager` for the OBSERVABLE pieces (node registration,
leader election, adjacency list visible via `mcp__ruflo__hive-mind_status`)
but keep the Queen's prompt interpretation as the actual coordination
mechanism. Topology becomes a state-tracking layer alongside the prompt,
not a replacement.

This is what the swarm package was probably aiming at before the
migration stalled.

Effort estimate: between A and B.

## Test plan

For whichever option ships:

**Regression** (automated, runs in `test:acceptance`):

1. `--topology hierarchical` Queen prompt: header includes "Topology: hierarchical".
2. `--topology mesh` Queen prompt: header includes "Topology: mesh".
3. (Option A or C only) `mcp__ruflo__hive-mind_status` returns the topology type as an authoritative field, not just an echo of CLI flags.
4. (Option A only) `mcp__ruflo__hive-mind_memory({action:'get'})` from a worker in a hierarchical topology returns only its subtree's keys.
5. (Option A only) `mcp__ruflo__hive-mind_memory({action:'get'})` from a worker in mesh returns all peers' keys.

**Live smoke** (uses developer's `claude` CLI; per ADR-0104 §Verification):

For each of the 4 topology values, spawn a hive with 3 workers and a
small objective. Verify post-run:

- `hive-mind/state.json` reflects the chosen topology in its
  `coordination.topology` field (Option A or C).
- For `mesh`: each worker's result key references *all other workers'*
  arguments (cross-visibility).
- For `hierarchical`: each worker's result key only references the Queen's
  directives, not peer workers (subtree visibility).

**Unit** (in ruflo-patch `tests/unit/`):

- `acceptance-adr0105-topology-checks.test.mjs` — paired with the
  acceptance lib per ADR-0097.

## Implementation plan

If Option A is chosen:

1. Adopt `UnifiedSwarmCoordinator` as the source of truth for topology
   in `hive-mind` flow (no parallel state).
2. Extend `TopologyType` union to add `'hierarchical-mesh'` and
   `'adaptive'`. Update `TopologyManager.initialize()` to handle them.
3. Add MCP tool `hive-mind_register` with `agentId`, `role` parameters.
   Wire to `topology.addNode()`.
4. Add topology-filtered `get` to `hive-mind_memory`. Read the topology
   type, traverse adjacency list, filter visible keys.
5. Update Queen prompt (§6 contract) to instruct workers to call
   `hive-mind_register` first.
6. Tests at all three levels.
7. Fork commit with ADR-0105 reference; ruflo-patch companion commit
   with the acceptance lib + paired test.

If Option B (doc-only):

1. Add a "Topology semantics" subsection to the fork README explicitly
   stating metadata-only behavior.
2. Update CLAUDE.md hive-mind section to match.
3. Mark `TopologyManager` and `UnifiedSwarmCoordinator` as
   `// @internal — not yet wired into hive-mind, see ADR-0105`.
4. Close this ADR as Implemented (Option B).

## Risks / open questions

- **R1 — wire-up cost**: Option A is the most code. Bug surface in
  registration race conditions, leader election under churn, etc.
- **R2 — adaptive topology**: README claims `adaptive` (auto-reconfigure
  based on load). The code has no equivalent. Either implement it
  (more work) or drop the claim.
- **R3 — V2 prompt port**: The original V2 Queen prompt may already
  encode topology semantics in its prose. Worth checking before doing
  Option A — we may inherit a "topology X means do Y" style guide that
  the runtime engine then has to honor verbatim.
- **R4 — interaction with ADR-0106 (consensus)**: consensus protocols
  (Raft / Gossip) typically depend on a stable network model. Wiring
  topology and consensus separately may double the surface; doing them
  together may be cleaner.

## Out of scope

- Implementing `'adaptive'` topology beyond the simple "switch by load
  threshold" minimum (that's a separate ADR).
- Federated topology (cross-machine hives) — upstream doesn't claim it.
- Topology-aware scheduling (which worker gets which task based on
  position in topology) — Queen continues to assign by prompt.
- README rewrite of capabilities table — covered by ADR-0101.
- Whether to deprecate the orphaned `UnifiedSwarmCoordinator` — separate
  cleanup ADR if Option B wins.

## Recommendation

Ship **Option C (hybrid)** consuming **both** orphaned/upstream primitives. They sit at different abstraction layers and are complementary, not substitutes:

1. **`swarm/src/topology-manager.ts`** (656 LOC, currently orphaned in fork's swarm package — own it on next merge per ADR-0111 §"Orphaned `swarm/src/` classes — per-class disposition") — provides the **in-process swarm coordination state layer**: `addNode/removeNode/electLeader/rebalance` + adjacency list + role index over an EventEmitter. This is where "who's the current leader, how are nodes connected, when do we rebalance" live. Wire it as state-tracking only:
   - Instantiate per hive on the MCP server side
   - Persist state via `withHiveStoreLock` (the same primitive ADR-0098 + ADR-0104 §5 already use)
   - Workers register via `mcp__ruflo__hive-mind_memory({action:'set'})` — extend the §6 worker-coordination contract from ADR-0104 with a `hive-mind_register` step
   - `mcp__ruflo__hive-mind_status` returns the **authoritative** topology type + node list (not just an echo of CLI flags)
   - Estimated: ~50-80 LOC of glue + paired acceptance tests per ADR-0097

2. **`v3/@claude-flow/cli/src/ruvector/graph-backend.ts`** (upstream ADR-087, NAPI-RS via `@ruvector/graph-node`, 10× faster than WASM — adopt on the upstream merge per ADR-0111 §"Cross-fork merge order" step 2 group F) — provides the **persistent agent-relationship graph layer**: `addNode / addEdge / addHyperedge / getNeighbors(nodeId, hops) / recordCausalEdge / recordCollaboration / recordSwarmTeam`. This is where "which agents have collaborated, causal edges between events, swarm team membership over time" live.

**Why both, not one or the other**:

- TopologyManager is **per-hive runtime state** (resets between sessions, EventEmitter-driven, in-memory + JSON-persisted via our lock)
- `graph-backend.ts` is **cross-hive durable history** (NAPI-backed graph DB, persistent across sessions, query language for k-hop traversal)
- Picking one obscures a real layer. ADR-0107 (Queen types) and ADR-0109 (worker failure) both want pieces of each — Queen types want authoritative topology view (TopologyManager) and cross-collaboration history (graph-backend); worker-failure handling wants leader-election (TopologyManager) and "which workers historically completed similar tasks" (graph-backend).

**Earlier framing was wrong**: an earlier draft of this ADR + ADR-0111 said "consume `graph-backend.ts`, leave TopologyManager as `@internal`." That muddied the layers. Corrected here.

**Out-of-scope per-class items** (preserved from §Out of scope, restated for clarity):

- `swarm/src/queen-coordinator.ts` (2030 LOC) — **don't wire**. Conflicts with ADR-0104's working architecture (Queen IS a `claude` subprocess, not a TS class). Mark `// @internal — V2→V3 migration target, superseded by ADR-0104 prompt-driven Queen`.
- `swarm/src/consensus/{raft,gossip,index}.ts` + `byzantine.ts` (~3500-4500 LOC combined) — **don't wire intra-hive**; preserve as `@internal — federated cross-hive infrastructure (see ADR-0106 federation track)`. Trust model in a single hive doesn't justify them. Cross-machine federation will need them — re-implementing is wasteful when 4000+ tested LOC exists.

**Rationale for Option C with both primitives**:

- Low blast radius (state-tracking only; doesn't touch the working prompt-driven Queen)
- Makes the topology field **non-mendacious**: today `--topology hierarchical-mesh` is a prompt-string echo; after this ADR, it's an authoritative state-managed value with leader-election semantics
- Unblocks ADR-0107 (Queen types — authoritative topology view) and ADR-0109 (fault tolerance — leader-election + collaboration history) without committing to full Option A
- Provides the regression-test surface (`_status` returns authoritative topology) the harness needs to detect drift
- Honors ADR-0111's per-class disposition: TopologyManager wired, QueenCoordinator parked, ConsensusEngine reserved for federation

A follow-up ADR (ADR-0105b or similar) can decide whether to push to full Option A (per-topology routing semantics like ring-pass / mesh-broadcast / hierarchical-subtree-visibility) or accept the hybrid as the long-term shape.
