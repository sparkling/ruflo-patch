# ADR-0128: Differentiated swarm topology runtime behaviour (T10)

- **Status**: Implemented (2026-05-03) per ADR-0118 §Status (T10 complete)
- **Date**: 2026-05-02
- **Deciders**: Henrik Pettersen
- **Depends on**: ADR-0116 (verification matrix supplies the gap row), ADR-0118 (runtime gaps tracker — owns task T10)
- **Depended on by**: ADR-0127 (T9 adaptive control loop dispatches into the surface this ADR introduces); ADR-0126 (T8) cross-references topology-aware worker prompts but does not require this ADR to land first (see §Cross-task dependency posture)
- **Related**: ADR-0114 (substrate/protocol/execution layering), ADR-0105 (topology behavior differentiation — earlier framing, accepted as Option C: state layer wired, behavioural layer deferred — this ADR closes the deferred half)
- **Scope**: Fork-side runtime work in `forks/ruflo/v3/@claude-flow/cli/src/commands/hive-mind.ts` and `forks/ruflo/v3/@claude-flow/swarm/src/unified-coordinator.ts`. Closes ADR-0118 task T10 (one of 10 enumerated runtime gaps).

## Context

ADR-0116's verification matrix flagged a topology-runtime gap. The matrix row title reads "5 swarm topologies" but enumerates six values (`hierarchical / mesh / hierarchical-mesh / ring / star / adaptive`). The actual contract surfaces disagree — see §Topology count reconciliation below; that disagreement is resolved here, not deferred.

Empirical state in `forks/ruflo/v3/@claude-flow/cli/src/commands/hive-mind.ts` (verified against working tree, line numbers exact):

| Surface | Line | Current behaviour |
|---|---|---|
| `TOPOLOGIES` constant | `commands/hive-mind.ts:30-35` | Defines exactly four CLI choices: `hierarchical`, `mesh`, `hierarchical-mesh`, `adaptive`. **`ring` and `star` are not in the enum.** |
| CLI flag read | `commands/hive-mind.ts:77` | `const topology = (flags.topology as string) || 'hierarchical-mesh'` — value passed through unchanged |
| Prompt assembly | `commands/hive-mind.ts:90` | Template literal `🔗 Topology: ${topology}` substitutes the string into the queen's system prompt (ADR-0116's matrix row cites line 92; the correct line is 90) |
| Worker-spawn dispatch | `swarm/src/unified-coordinator.ts` (1844 LOC; `spawnAgent` at line 1574, `spawnFullHierarchy` at line 1455) | One incidental check at line 843 (`'mesh' ? 'peer' : 'worker'` for role label); no `switch (topology)` branch on the spawn path; all topologies execute the same coordination protocol |
| TopologyManager wiring | `swarm/src/unified-coordinator.ts:49,139,170,205` | `TopologyManager` IS instantiated (per ADR-0105 Option C), but it tracks adjacency/leader-election state only — it does not gate broadcast or memory-write behaviour |

Net effect: topology is prompt-string metadata plus state-layer bookkeeping (post-ADR-0105). Whether the user picks `mesh` or `hierarchical`, the underlying broadcast/memory protocol is identical — workers receive the same broadcast pattern, write to the same memory keys, and surface outputs through the same `hive-mind_status` flow. ADR-0105 closed the state half of this gap; T10 closes the behaviour half.

### Topology count reconciliation

Three contract surfaces disagree on the topology set:

| Surface | Topologies | Source |
|---|---|---|
| CLI `TOPOLOGIES` constant | 4: `hierarchical`, `mesh`, `hierarchical-mesh`, `adaptive` | `commands/hive-mind.ts:30-35` |
| USERGUIDE diagram (Swarm Topology section) | 4: `hierarchical`, `mesh`, `ring`, `star` | `USERGUIDE.md:1125-1158` |
| ADR-0116 matrix row | 6 (title says "5"): `hierarchical / mesh / hierarchical-mesh / ring / star / adaptive` | ADR-0116 §verification matrix |

The union of visible advertised surfaces is six: `hierarchical`, `mesh`, `hierarchical-mesh`, `ring`, `star`, `adaptive`. Per `feedback-no-value-judgements-on-features.md` (ship the full surface; do not curate), this ADR closes the gap by **wiring all six** rather than picking the intersection. `adaptive` is a meta-topology that resolves to one of the other five at spawn time — the runtime cardinality is therefore "five concrete plus one selector" (which is what the original ADR title tried to express; restated unambiguously in §Specification).

Concrete consequence: the `TOPOLOGIES` enum at `commands/hive-mind.ts:30-35` must add `ring` and `star` as part of T10's CLI work; without that addition the USERGUIDE diagram contract stays unmet.

Per ADR-0118 §T10, this gap is the natural completion point for the topology track. Cross-task posture: T9 (ADR-0127) explicitly depends on T10 (its `swarm.mutateTopology()` consumer needs five concrete dispatch targets); T8 (ADR-0126) cross-references T10 for fan-out but does not depend on it for landing — see §Cross-task dependency posture.

## Decision Drivers

- **USERGUIDE / CLI / matrix contracts disagree on the topology set**: CLI accepts 4, USERGUIDE diagram visualises 4 (different 4), ADR-0116 matrix row enumerates 6. Closing the gap requires picking one truth and aligning the others — see §Topology count reconciliation. Default per `feedback-no-value-judgements-on-features.md`: wire the union (6).
- **Prompt-only metadata is not behaviour**: `commands/hive-mind.ts:90` substitutes `${topology}` into a queen prompt; the queen's downstream broadcast/memory wiring is identical regardless of value, so the contract is satisfied only as documentation. ADR-0105 already wired the state layer (TopologyManager); T10 closes the behavioural layer.
- **T9 unblocking**: ADR-0127's adaptive autoscaling control loop calls `swarm.mutateTopology(target)` and assumes five concrete topologies are real runtime targets. T9 cannot operate on top of prompt-string metadata; T10 must land first or T9's mutation calls become no-ops.
- **T8 cross-reference (not a hard dependency)**: ADR-0126 differentiates worker prompts by type. ADR-0126 §Refinement explicitly assigns fan-out to T10. T8 worker prompts can mention topology context (per ADR-0126's template header), but T8 does not require T10 to ship its 8-worker enum; ordering between T8 and T10 is therefore symmetric — see §Cross-task dependency posture.
- **Fork-side patching** (`feedback-patches-in-fork.md`): runtime gaps are bugs; bugs land in `forks/ruflo`, not as a codemod.
- **ADR-0114 layering**: topology dispatch is a protocol-layer concern (broadcast/memory wiring); substrate (storage backend) stays topology-agnostic; execution layer (worker prompts) reads topology as context but does not implement coordination. Dispatch lives strictly in the protocol layer hand-off at the worker-spawn site in `unified-coordinator.ts`.
- **No silent fallback** (`feedback-no-fallbacks.md`): unknown topology must throw at the dispatch site; no implicit default to `hierarchical-mesh`.

## Considered Options

- **(a) Per-topology dispatch in `unified-coordinator.ts` worker-spawn path** [CHOSEN] — single `switch (topology)` site at the worker-spawn boundary that wires `hive-mind_broadcast` and `hive-mind_memory` permissions per branch.
- **(b) Topology-as-strategy-pattern with one class per topology** — extract `HierarchicalTopology`, `MeshTopology`, `RingTopology`, `StarTopology`, `HierarchicalMeshTopology`, `AdaptiveTopology` classes implementing a common `CoordinationStrategy` interface; coordinator delegates.
- **(c) Single coordinator with topology-aware broadcast filter** — coordinator broadcasts to all workers always; a downstream filter rewrites the worker visibility set per topology.

## Pros and Cons of the Options

### (a) Per-topology dispatch in worker-spawn path

- Pros: minimal surface area; single dispatch site colocated with the existing `spawnAgent`/`spawnFullHierarchy` flow; composes cleanly with T9 (adaptive delegation) by recursing into one of its own branches; preserves ADR-0114 layering with no new abstractions; fork-patch friendly.
- Cons: six branches in one switch will need to stay in sync — `hierarchical`, `mesh`, `hierarchical-mesh`, `ring`, `star`, `adaptive`. Adding a seventh topology touches one file but six call-sites in tests. Inline switch is easier to grep than scattered classes but harder to unit-test in isolation than (b).

### (b) Strategy-pattern classes

- Pros: each topology isolated; easier to unit-test in isolation; obvious extension point for a future seventh topology.
- Cons: six new classes plus a `CoordinationStrategy` interface for six branches of broadcast/memory wiring is OO ceremony. The CLAUDE.md guideline "no abstractions for single-use code" applies — each strategy class would have one consumer (the coordinator). The cardinality is fixed (USERGUIDE contract is exactly 6, not "≥ 6 with extension expected"); the speculative-flexibility argument fails. A switch with 6 branches in one file is grep-able and edit-local; six classes scatter the protocol across files. **The honest reason to skip (b) is not "switch is faster to write" — it's that the strategy pattern would buy isolation we don't need at the cost of grep-locality we do need.**

### (c) Topology-aware broadcast filter

- Pros: coordinator stays uniform; topology becomes a post-hoc visibility rule.
- Cons: the filter model breaks at the second non-trivial topology. `ring` is not a visibility filter on a mesh broadcast — it's a deterministic chain of memory reads where worker N reads worker (N-1)'s output key; there is no broadcast to filter. `hierarchical-mesh` requires sub-hive instantiation (a structural change), not filtering. `adaptive` cannot be expressed as a filter at all because it picks a topology rather than restricting one. The pattern survives `hierarchical` vs `mesh` and falls over for the rest.

## Decision Outcome

**Chosen option: (a) per-topology dispatch in `unified-coordinator.ts` worker-spawn path**, because it is the smallest change that promotes topology from prompt string + state-bookkeeping to runtime coordination behaviour. Driver trace: closes the "prompt-only metadata is not behaviour" driver by introducing a single `switch (topology)` at the spawn boundary; satisfies the "T9 unblocking" driver by giving `swarm.mutateTopology()` five concrete dispatch targets to recurse into; satisfies the "ADR-0114 layering" driver by keeping dispatch in the protocol layer (substrate stays agnostic, execution reads context only); satisfies the "no silent fallback" driver by throwing on unknown topology.

## Consequences

### Positive

- T9 adaptive autoscaling (ADR-0127) has five concrete dispatch targets to switch between at runtime; the `adaptive` branch recurses into one of them.
- USERGUIDE matrix row lifts (per the count-reconciled wording); ADR-0116 plugin README annotation drops on next materialise run.
- ADR-0105 Option C closed the state half (TopologyManager wired); this ADR closes the behavioural half (broadcast/memory wiring per topology).
- `TOPOLOGIES` enum in `commands/hive-mind.ts:30-35` expands from 4 to 6 (`ring` and `star` added), making the CLI surface match the USERGUIDE diagram.

### Negative

- Six branches to keep in sync. Adding a topology touches the switch + six paired test cases.
- **Scoped out: topology change during active task.** Open question with two defensible answers: (1) fail loud — `swarm.mutateTopology(target)` throws if any worker has a non-empty active task set; (2) defer — switch is queued until the current task drains. ADR-0127 §Refinement chose option (2) at the queen-decision layer ("Switch is deferred (not abandoned) until all workers report empty active task sets. Defer is bounded by 3 dampening windows; if a switch is deferred past the bound, the consumer abandons the switch attempt loudly"). T10 inherits that choice: the dispatch site does not re-check active tasks; T9's queen consumer is responsible for deferral and abandonment. If T9 lands with a different stance, T10's dispatch must be revisited. **Defensible because** ADR-0127 owns the runtime-mutation semantics and T10 owns the spawn-time dispatch — separating them keeps each ADR's surface narrow; not defensible if a non-T9 caller of `swarm.mutateTopology()` materialises (the surface is currently single-consumer).
- `hierarchical-mesh` adds sub-queen instantiation logic that does not exist for the other five topologies. Sub-hive failure modes are new code paths; see §Refinement for the sub-queen-failure case.
- T8 worker prompts: ADR-0128's earlier draft claimed "T8 workers see different peer-output shapes per topology" — but ADR-0126 (T8) §Refinement explicitly assigns fan-out to T10 and does not promise per-topology prompt rendering. The honest consequence: post-T10, worker peer-visibility is enforced at the protocol layer (broadcast/memory permissions) regardless of what the worker prompt says. If the worker prompt and the protocol disagree, the protocol wins and the prompt becomes misleading. Aligning the prompt with the active topology is a follow-up that lives in T8's surface, not T10's.

### How workers know which topology is active

The dispatch site in `unified-coordinator.ts` configures each worker's `hive-mind_broadcast` subscription set and `hive-mind_memory` permissions at spawn time. Workers do not query a runtime variable; the topology is enforced by what the protocol layer lets them subscribe to and write. The queen prompt continues to mention the topology as context (`commands/hive-mind.ts:90`), but that string is descriptive, not load-bearing. After T10, the load-bearing surface is the spawn-time wiring, not the prompt substring.

## Cross-task dependency posture

ADR-0118 §Dependency graph lists T10 as depending on T8 and T9. The dependency direction is more nuanced once each ADR's surface is read:

- **T9 → T10 (T9 depends on T10, hard).** ADR-0127 §Decision calls `swarm.mutateTopology(target)` and assumes `target ∈ {hierarchical, mesh}` are runtime dispatch targets. ADR-0127 §Refinement (`cov-high` handler) explicitly notes "Until T10 lands, `swarm.mutateTopology()` returns the not-implemented marker; consumer logs and continues" — confirming T9 already encodes T10 as a hard dep. ADR-0127 line 6 names ADR-0128 as a depended-on ADR. **T10 must land before T9.**
- **T8 ↔ T10 (symmetric).** ADR-0126 §Specification ("Multi-match disposition contract") explicitly defers fan-out to T10 ("multi-worker fan-out is a topology concern handled by T10 (ADR-0128), not this ADR") but does not promise per-topology rendering of worker prompts. T8's 8 worker prompts can land without T10 (they ship as topology-agnostic templates); T10's dispatch can land without T8 (it operates on broadcast/memory permissions, not prompt content). Whichever lands second tightens the cross-reference. **No hard ordering between T8 and T10.**
- **ADR-0118 dependency graph line 41** ("T10 → T8, T9") overstates T8 as a hard dep. Update ADR-0118 to read T10 → T9 only, with T8 as a soft cross-reference.

## Validation

- **Unit tests** (`tests/unit/`): one dispatch test per topology asserting the correct broadcast/memory wiring is selected for each `topology` flag value (six tests, named `adr0128_dispatch_<topology>_wires_correct_permissions`); one test `adr0128_unknown_topology_throws` verifying the default branch throws per `feedback-no-fallbacks.md`; one test `adr0128_adaptive_delegates_to_t9` verifying the `adaptive` branch invokes the ADR-0127 control-loop entry point and recurses into the returned topology.
- **Integration tests** (`tests/unit/*.test.mjs`, real I/O): per-topology broadcast-pattern assertions under a fixed objective and worker count, named:
  - `adr0128_hierarchical_zero_peer_broadcasts` — workers do not subscribe to each other.
  - `adr0128_mesh_full_peer_visibility_O_N_squared` — every worker sees every other worker's outputs.
  - `adr0128_ring_deterministic_N_step_chain` — worker N reads worker (N-1 mod N), writes for (N+1 mod N); zero broadcasts.
  - `adr0128_star_zero_worker_memory_writes` — only the queen writes to `hive-mind_memory`.
  - `adr0128_hierarchical_mesh_sub_hive_mesh_plus_subqueen_reports` — sub-hive internals are mesh; sub-queens report upward only.
  - `adr0128_adaptive_resolves_to_concrete_topology` — `adaptive` ends in one of the five via T9.
- **Acceptance tests** (`lib/acceptance-adr0128-checks.sh` wired into `scripts/test-acceptance.sh`): each of the six topologies exercised in a real init'd project against published `@sparkleideas/*` packages, asserting the peer-visibility shape via captured `hive-mind_broadcast` / `hive-mind_memory` traces. Per `feedback-all-test-levels.md`, all three levels ship in the same commit as the implementation; per `feedback-no-squelch-tests.md`, no assertion is weakened to mask flakiness.

## Decision

**Replace prompt-only topology metadata with topology-specific worker-coordination protocols, dispatched per-topology in the worker-spawn path.** Each of the six advertised topologies maps to a distinct coordination protocol that governs how workers see each other's outputs and how memory writes flow.

After this ADR lands, the `topology` flag stops being a prompt-decoration string and starts driving runtime behaviour at the `unified-coordinator.ts` worker-spawn site.

## Implementation plan

Per ADR-0118 §T10 — per-topology coordination protocols:

1. **Expand the CLI `TOPOLOGIES` constant at `commands/hive-mind.ts:30-35` from 4 to 6 entries** by adding `ring` and `star`. Without this step the USERGUIDE diagram contract stays unmet and `--topology ring` fails the existing `choices: TOPOLOGIES.map(t => t.value)` validation at line 399.

2. **Replace the prompt-only `🔗 Topology: ${topology}` substitution at `commands/hive-mind.ts:90`** (note: ADR-0116 cites line 92; the actual line is 90) with a topology-specific coordination-protocol block. The block is generated by the dispatch site in `unified-coordinator.ts` (step 3) and inlined into the queen prompt at render time, replacing the bare metadata line:
   - `hierarchical`: queen-only broadcast — workers receive instructions from the queen and surface outputs to the queen, but do not see each other's outputs
   - `mesh`: workers receive all peer outputs via `hive-mind_broadcast`; every worker sees every other worker's intermediate state
   - `hierarchical-mesh`: hybrid — workers cluster into sub-hives with sub-queens; each sub-hive runs `mesh` internally, sub-queens coordinate `hierarchical`-ly to the top-level queen
   - `ring`: workers pass intermediate state in a deterministic order via `hive-mind_memory` — worker N reads the output of worker N-1 (modulo ring size) and contributes the input to worker N+1
   - `star`: queen is the only memory writer; workers only read from `hive-mind_memory`, surfacing outputs back through `hive-mind_status` for the queen to aggregate and write
   - `adaptive`: chooses at runtime per ADR-0127 (T9) — delegates the topology selection to the autoscaling loop introduced there

3. **Add per-topology dispatch in `unified-coordinator.ts` worker-spawn path** (likely sites: `spawnAgent` at line 1574 and `spawnFullHierarchy` at line 1455 — exact insertion point chosen at implementation time, both call into the same wiring surface). Introduce a `dispatchByTopology(topology, workers)` branch that wires each worker's `hive-mind_broadcast` subscription set and `hive-mind_memory` permissions according to the protocol above. The existing line 843 incidental check (`'mesh' ? 'peer' : 'worker'`) stays as a role-label refinement; the new dispatch site is the protocol-layer enforcement point. ADR-0126 (T8) worker-type prompts and ADR-0125 (T7) queen-type prompts compose with the topology dispatch by reference but do not duplicate the switch.

4. **Tests at all three levels** (per `feedback-all-test-levels.md`): same objective across the six topologies producing six distinct observable coordination traces. Trace assertions per §Validation. Acceptance suite registered as `lib/acceptance-adr0128-checks.sh` in `scripts/test-acceptance.sh`.

## Specification

Per-topology coordination protocol surfaces — the contract each branch of the dispatch switch must satisfy:

- **`hierarchical`**: queen-only broadcast. Workers receive instructions from the queen via `hive-mind_broadcast` and surface outputs back through `hive-mind_status` to the queen. Workers have no peer visibility — they cannot read other workers' intermediate state from `hive-mind_memory` and cannot subscribe to peer broadcasts.
- **`mesh`**: full peer visibility. Every worker receives every other worker's outputs via `hive-mind_broadcast`; intermediate state written to `hive-mind_memory` is readable by all peers. Coordination protocol O(N²) in the number of workers.
- **`hierarchical-mesh`**: hybrid clustering. Workers partition into sub-hives, each with a sub-queen. Each sub-hive runs `mesh` internally (peer visibility within the cluster). Sub-queens coordinate `hierarchical`-ly upward to the top-level queen — the top-level queen sees only sub-queen reports, never raw worker outputs. Recursion capped at one nesting level (top queen + sub-queens; no sub-sub-queens).
- **`ring`**: deterministic ordered chain. Workers numbered 0..N-1 in a ring. Worker N reads worker (N-1 mod N)'s output from `hive-mind_memory` and writes its own output for worker (N+1 mod N) to consume. No broadcasts; coordination is strictly peer-to-peer along the ring edges.
- **`star`**: hub-and-spoke. The queen is the only memory writer; workers (spokes) only read from `hive-mind_memory`, surfacing their outputs back through `hive-mind_status` for the queen to aggregate and write. Zero worker-initiated memory writes.
- **`adaptive`**: dispatches based on the T9 control loop (ADR-0127). The T10 dispatch site delegates to T9's autoscaling decision and resolves to one of the five concrete topologies above at spawn time.

## Pseudocode

Per-topology dispatch at the `unified-coordinator.ts` worker-spawn path, in plain prose:

When the coordinator is about to spawn workers for a new task, read the `topology` flag from the spawn request. Branch on its value:

- For `hierarchical`: configure each worker's `hive-mind_broadcast` subscription set to `[queen]` only; gate `hive-mind_memory` writes to a worker-private namespace the queen can read but peers cannot. Peer-output visibility: none. Memory-write rule: queen-readable private only.
- For `mesh`: configure each worker's `hive-mind_broadcast` subscription set to `[queen, all_other_workers]`; grant read access to a shared peer-visible memory namespace. Peer-output visibility: full. Memory-write rule: shared peer-visible.
- For `hierarchical-mesh`: partition workers into sub-hives (cluster size capped to keep recursion at one level), instantiate one sub-queen per sub-hive, recurse the dispatch — sub-hive internals get the `mesh` branch, the sub-queen tier gets the `hierarchical` branch upward. Peer-output visibility: full within sub-hive, sub-queen-summarised across. Memory-write rule: peer-visible per sub-hive, sub-queen-summarised at the top.
- For `ring`: assign each worker a deterministic position 0..N-1, configure `hive-mind_memory` reads to point at position (N-1) mod N's output key and writes to position N's own key, disable `hive-mind_broadcast` subscriptions. Peer-output visibility: previous-neighbour only. Memory-write rule: own slot only.
- For `star`: configure all workers as memory readers only; revoke worker `hive-mind_memory` writes; route worker outputs through `hive-mind_status` to the queen, which is the sole writer. Peer-output visibility: none (only queen-aggregated state). Memory-write rule: queen-only.
- For `adaptive`: invoke the T9 control-loop entry point (ADR-0127), receive a concrete topology decision, recurse into the matching branch above.
- Default branch (unknown topology): throw a loud error per `feedback-no-fallbacks.md`. No silent fallback to `hierarchical-mesh`.

Each branch is responsible for both peer-output visibility (subscription set on `hive-mind_broadcast`) and memory-write rules (permission set on `hive-mind_memory`). The two are not separable — a worker with mesh broadcast but ring memory writes is incoherent. The dispatch site is the only place that knows about the topology enum; downstream worker prompts (T8) and queen prompts (T7) compose with it by reference but do not duplicate the switch.

## Architecture

Touched files:

- `forks/ruflo/v3/@claude-flow/cli/src/commands/hive-mind.ts:30-35` — `TOPOLOGIES` constant expands from 4 to 6 entries (add `ring` and `star`).
- `forks/ruflo/v3/@claude-flow/cli/src/commands/hive-mind.ts:90` — the prompt template currently substitutes `🔗 Topology: ${topology}` as bare metadata (ADR-0116 cites line 92; correct line is 90). After this ADR, the prompt no longer carries topology behaviour — it inlines a topology-specific coordination-protocol block sourced from the dispatch site. Prompt becomes descriptive; `unified-coordinator.ts` becomes the enforcement.
- `forks/ruflo/v3/@claude-flow/swarm/src/unified-coordinator.ts` (1844 LOC) — adds the `dispatchByTopology(topology, workers)` switch on the worker-spawn path. Likely insertion sites: `spawnAgent` at line 1574 and `spawnFullHierarchy` at line 1455. The `TopologyManager` already wired at lines 49 / 139 / 170 / 205 (per ADR-0105 Option C) provides adjacency state but does not gate behaviour; the new dispatch site is where behaviour gating lives.

Interaction with T8 (ADR-0126, per-worker-type prompts): worker prompts can mention topology context as descriptive material, but enforcement of peer visibility and memory-write rules lives in the protocol-layer dispatch added here, not in the prompt body. T8 does not need to render 48 (workerType × topology) templates; the protocol layer enforces topology orthogonally to prompt content.

Interaction with T9 (ADR-0127, adaptive autoscaling): the `adaptive` branch of the T10 dispatch calls into T9's control-loop entry point and receives a concrete topology decision back. T10 owns the spawn-time dispatch surface; T9 owns the runtime selection logic. **Bidirectional contract**: T9 (ADR-0127 line 6) names ADR-0128 as a depended-on ADR; T10 (this ADR) names ADR-0127 in §Cross-task dependency posture as a downstream consumer. Both directions are documented.

ADR-0114 layering is preserved: substrate (memory backend) stays topology-agnostic; protocol layer (broadcast/memory wiring) is where dispatch lives; execution layer (worker prompts) reads topology as descriptive context but does not implement coordination. No layer crosses.

## Refinement

Edge cases:

- **Topology change during active task**: out of scope for T10's dispatch site. The T10 dispatch fires at spawn time only. Per §Consequences, mid-task switch semantics live in T9 (ADR-0127): T9's queen consumer defers `swarm.mutateTopology(target)` until all workers report empty active task sets ("Switch is deferred (not abandoned) until all workers report empty active task sets. Defer is bounded by 3 dampening windows; if a switch is deferred past the bound, the consumer abandons the switch attempt loudly"). T10 trusts this contract; if T9 calls into T10 mid-task, the dispatch executes as if it were a fresh spawn — the T9 deferral is the only safety gate.
- **Ring with a single worker**: a one-element ring reads its own previous output (position 0 = position N-1 mod 1) and writes its next output to the same key. Behaviour is deterministic, idempotent, and trivial; no special-casing. The same applies to `hierarchical-mesh` where a single sub-hive degenerates to plain `mesh`.
- **Star with a single worker**: hub-and-spoke with one spoke is a queen-and-one-worker pair; queen still owns memory writes, worker still routes through `hive-mind_status`. Coherent.
- **`hierarchical` with a single worker**: queen-only broadcast to one worker; worker surfaces output through `hive-mind_status`. Coherent, equivalent to a degenerate `star`.
- **Topology-incompatible worker counts**: tests assert structural properties (zero peer broadcasts in `hierarchical`, O(N²) in `mesh`) which generalise across worker counts including N=1. No combination is rejected at dispatch.
- **Unknown topology value**: fail loudly. Default branch throws; no silent fallback to `hierarchical-mesh` (per `feedback-no-fallbacks.md`).
- **Sub-queen failure in `hierarchical-mesh`**: a sub-queen crash isolates the affected sub-hive from the top-level queen. Default behaviour: surface the sub-hive failure to the top-level queen's failure handler (the existing ADR-0109 path for worker failure) and let the top queen decide whether to promote a worker to sub-queen, fail the sub-hive's task, or absorb the sub-hive's workers into the top tier. Detailed promotion semantics are scoped to ADR-0109 follow-up. T10's dispatch does not auto-promote; it surfaces failure.
- **Star hub failure (queen crash)**: not specific to `star` — queen failure under any topology is the same path. ADR-0109 owns it. T10 has no incremental obligation here; the star case does not introduce a new failure mode.
- **`hierarchical-mesh` recursion**: capped at one level. Two-level nesting (sub-sub-queens) is rejected at dispatch time until a use case demands it. The cap is a dispatch-time check, not a prompt-level instruction.

Error paths: no silent fallbacks. Every dispatch branch either succeeds or throws. The default branch throws on unknown topology. Sub-queen instantiation failure in `hierarchical-mesh` throws rather than degrading to `mesh`.

Test list:

- **Unit**: six per-topology dispatch tests + one unknown-topology default-branch throw test + one `adaptive`-delegation test. Names per §Validation.
- **Integration**: per-topology broadcast-pattern assertion under fixed objective and worker count. Names per §Validation.
- **Acceptance**: six topologies exercised in a real init'd project against published `@sparkleideas/*` packages. Wired into `scripts/test-acceptance.sh` per `feedback-all-test-levels.md`.

## Completion

Annotation lift criterion: T10 marked `complete` in ADR-0118 §Status, with Owner/Commit columns naming a green-CI commit. Annotation lift fires on the next materialise run after that flip. (Per ADR-0118 §Annotation lifecycle.)

Acceptance wire-in: new `lib/acceptance-adr0128-checks.sh` covers the six topology cases, registered in `scripts/test-acceptance.sh` alongside existing ADR-0126/0127 checks. Required tier per CLAUDE.md "Required Tests Per Change Type" matrix: pre-publish verification → full cascade.

T9 adaptive delegation: the `adaptive` branch of the T10 dispatch calls into ADR-0127's control-loop entry point. Once both T9 and T10 are landed, end-to-end adaptive behaviour is exercisable; landing T10 alone leaves five topologies functional and `adaptive` fail-loud-pending-T9 (per `feedback-no-fallbacks.md`).

## Acceptance criteria

- [ ] `commands/hive-mind.ts:30-35` `TOPOLOGIES` constant expanded from 4 to 6 entries (`ring` and `star` added) so the CLI surface matches the USERGUIDE diagram
- [ ] `commands/hive-mind.ts:90` no longer substitutes `topology` as a bare string into the prompt; instead inlines a topology-specific coordination-protocol block (note: ADR-0116's matrix row cites line 92; the correct line is 90)
- [ ] `unified-coordinator.ts` worker-spawn path branches on `topology` and configures each worker's `hive-mind_broadcast` subscription set + `hive-mind_memory` permissions accordingly
- [ ] Six topologies produce six distinct observable coordination traces under a fixed objective (integration test assertions per §Validation)
- [ ] `hierarchical-mesh` sub-hive clustering: protocol-layer enforcement of mesh-within-cluster + hierarchical-across-clusters, recursion capped at one level
- [ ] `adaptive` topology defers to ADR-0127 (T9) autoscaling and resolves to one of the five concrete topologies at runtime
- [ ] Unknown topology throws at the dispatch site (no silent fallback to `hierarchical-mesh`)
- [ ] ADR-0114 architectural model preserved: topology dispatch lives strictly in the protocol layer; substrate and execution stay topology-agnostic
- [ ] ADR-0118 §Status table T10 row updated to `complete`; ADR-0116 plugin README topology-row annotation lifted by next materialise run
- [ ] ADR-0118 §Dependency graph corrected: T10 → T9 (T8 is a soft cross-reference, not a hard dependency) per §Cross-task dependency posture
- [ ] `npm run test:unit` and `npm run test:acceptance` green

## Risks

**Medium** — touches both CLI (`commands/hive-mind.ts`) and `unified-coordinator.ts`. New behaviours must respect ADR-0114 architectural model. Per ADR-0118 §T10 escalation criterion: **promote to a separate ADR if topology semantics conflict with ADR-0114's substrate/protocol/execution layering**. Specific risk vectors:

1. **Layering violation**: a topology choice that requires the substrate layer to know about coordination protocols (e.g., a memory backend that behaves differently in `mesh` than in `star`) breaks ADR-0114. Mitigation: implement topology dispatch entirely in the protocol layer; substrate stays topology-agnostic.
2. **Composition with T8 (worker types)**: 6 topologies × 8 worker types = 48 combinations. Not all may be coherent (does a `documenter` in `ring` make sense?). Mitigation: tests assert distinct coordination *patterns* at the protocol layer, not distinct prompt content for every (workerType, topology) pair.
3. **`hierarchical-mesh` recursion depth**: sub-hives with sub-queens could in principle recurse. Mitigation: cap recursion at one level (top-level queen + sub-queens, no sub-sub-queens). Cap is enforced at dispatch time.
4. **Test fragility**: trace-based assertions on broadcast counts can flap if call ordering varies. Mitigation: assert structural properties (zero, O(N), O(N²)) rather than exact call sequences.
5. **CLI enum expansion side effects**: adding `ring` and `star` to `TOPOLOGIES` at `commands/hive-mind.ts:30-35` changes the surface validated at line 399. Mitigation: parametric CLI test that accepts each of the 6 values and rejects unknown ones.

## References

- ADR-0116: hive-mind marketplace plugin (verification matrix; topology row title says "5", body lists 6 — see §Topology count reconciliation)
- ADR-0118: hive-mind runtime gaps tracker (T10 task definition; §Dependency graph line 41 needs correction per §Cross-task dependency posture)
- ADR-0126: T8 — differentiate worker-type runtime behaviour (soft cross-reference; T8 §Refinement defers fan-out to T10)
- ADR-0127: T9 — implement adaptive topology load-based optimization (hard dependency: T9 calls into T10's dispatch surface; ADR-0127 line 6 names this ADR as depended-on)
- ADR-0114: substrate/protocol/execution layering (architectural constraint preserved)
- ADR-0105: topology behavior differentiation (earlier framing; Option C accepted — state layer wired via TopologyManager; T10 closes the deferred behavioural half)
- ADR-0109: worker failure handling (sub-queen failure path, star-hub failure path)
- USERGUIDE Hive Mind topology contract: `<summary>🐝 <strong>Swarm Topology</strong>` diagram at `/Users/henrik/source/ruvnet/ruflo/docs/USERGUIDE.md:1125-1158` (visualises 4 topologies); `<summary>👑 <strong>Hive-Mind Coordination</strong>` block at line 2370 (names "Adaptive Topology")

## Review notes

Open questions for follow-up that this review surfaced but did not resolve. Triage stamps per `/docs/adr/ADR-0118-review-notes-triage.md`:

1. **CLI enum vs USERGUIDE diagram** (triage row 50 — DEFER-TO-FOLLOWUP-ADR: CLI side closes here via TOPOLOGIES expansion to 6; USERGUIDE diagram alignment is USERGUIDE-track concern): the CLI accepts 4 values, the USERGUIDE diagram visualises 4 values, and the two sets only overlap on `hierarchical` and `mesh`. ADR-0128 closes the union (6) per `feedback-no-value-judgements-on-features.md`, but the USERGUIDE diagram also needs to gain `hierarchical-mesh` and `adaptive` (or the CLI loses `hierarchical-mesh` — definitely the wrong direction). This ADR adds 2 to the CLI; whether the USERGUIDE diagram gains 2 is a USERGUIDE-track concern.
2. **ADR-0116 matrix row title vs body** — resolved (triage row 51: ADR-0116 lines 51 and 217 amended in earlier wave; "5 swarm topologies" → "6 swarm topologies"; line 92 → line 90 in summary row): title said "5 swarm topologies", body listed 6. ADR-0116 itself should be amended on the same lift run to either (a) correct the count to "6" or (b) drop the count and list the topologies. T10's annotation-lift work should not silently fix ADR-0116's count discrepancy without a separate edit there.
3. **ADR-0118 §Dependency graph (line 41)** — resolved (triage row 52: ADR-0118 §Dependency graph already corrected lines 41-48 with explicit direction note): listed "T10 → T8, T9". §Cross-task dependency posture above argues T8 is a soft cross-reference, not a hard dep. ADR-0118 should be updated when T10 lands.
4. **T8 prompt rendering vs protocol enforcement** (triage row 53 — DEFER-TO-IMPL: T8 implementer decides at code time): this ADR's earlier draft promised that worker prompts would render differently per topology. ADR-0126 §Refinement does not promise this. Aligning the worker prompt with the active topology is a follow-up that lives in T8's surface; T10 enforces visibility at the protocol layer regardless. If T8 lands without per-topology prompt rendering, the worker prompt may describe peer visibility that the protocol layer does not actually grant. Decide at T8 implementation time whether to render per-topology prompts or document the prompt as descriptive-only.
5. **Cross-cutting with ADR-0109 (worker failure)** — resolved (triage row 54: ADR-0109 §Risks gained R8 paragraph in earlier wave; T10 dispatch must surface sub-queen-absence as distinct event): sub-queen failure in `hierarchical-mesh` is the only T10-introduced new failure mode (queen failure under any topology and worker failure under any topology are both pre-existing ADR-0109 concerns). T10 surfaces sub-queen failure to ADR-0109's path; ADR-0109 needs a follow-up to decide between "promote a worker to sub-queen" vs "fail the sub-hive's task" vs "absorb workers into top tier". This ADR does not pre-decide that.
6. **`swarm.mutateTopology()` consumer count** (triage row 55 — DEFER-TO-FOLLOWUP-ADR: only T9 consumer today; revisit if manual operator command materialises): today only T9 (ADR-0127) calls into T10's dispatch surface as a runtime mutator. If a future caller materialises (e.g. a manual operator command), the §Consequences "T10 inherits T9's deferral choice" stance must be revisited — the deferral lives in T9's queen consumer, not in the dispatch site itself.
