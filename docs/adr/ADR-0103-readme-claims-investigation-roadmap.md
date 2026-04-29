# ADR-0103: README claims investigation roadmap (post-ADR-0104)

- **Status**: Investigating
- **Date**: 2026-04-29
- **Scope**: meta-ADR. Tracks per-claim investigations spawned from
  ADR-0104's §Out-of-scope list. Does not itself decide implementations.

## Context

ADR-0104 made the hive-mind plumbing real (Queen launches, workers
coordinate via shared memory under a lock, end-to-end smoke verified
2026-04-29). Six README claims about the hive remain **unbacked by
runtime code in the hive-mind CLI execution path**.

A scout of `forks/ruflo/v3/@claude-flow/swarm/src/` reveals an important
twist: most of the missing behaviors **already have full TypeScript
implementations** in the swarm package — they're orphaned, not absent.
The hive-mind CLI command does not import them.

This roadmap allocates one ADR per claim and structures each
investigation as: upstream research → current state (with the
"runtime code exists but unused" verdict per item) → test plan →
implementation plan.

## The six items

| ADR | Claim | Code state | Estimated shape |
|---|---|---|---|
| ADR-0105 | **Topology behavior differentiation** (hierarchical / mesh / hierarchical-mesh / adaptive — distinct routing/visibility behavior) | `swarm/src/topology-manager.ts` (656 LOC) implements mesh/hierarchical/centralized/hybrid. Not imported by hive-mind command. | Wire-up |
| ADR-0106 | **Consensus algorithm enforcement** (Raft / Byzantine / Gossip / CRDT / Quorum — runtime fault-tolerant voting) | `swarm/src/consensus/{raft,gossip,index}.ts` exist as full implementations (Raft state machine, Gossip protocol). Byzantine missing? Not imported by hive-mind. | Wire-up + possibly fill Byzantine + CRDT + Quorum |
| ADR-0107 | **Queen type differentiation** (Strategic / Tactical / Adaptive — distinct leadership patterns) | `swarm/src/queen-coordinator.ts` (2030 LOC) — extent of per-type runtime branching unclear. Currently the hive-mind CLI substitutes type as a prompt string. | Wire-up + audit per-type code paths |
| ADR-0108 | **Mixed-type worker spawns** (8 worker types in one hive — researcher + coder + tester + … from one `spawn` call) | CLI accepts single `--type`. Worker prompt is `"You are a ${type} in the hive."` — no per-role specialization. | New CLI surface + per-role prompt enrichment |
| ADR-0109 | **Worker failure handling / fault tolerance** ("even when some agents fail", "Byzantine handles up to 1/3 failing agents") | No worker-failure detection, no contract-violation triage, no quorum checks. Queen prompt has no instructions for absent / malformed worker outputs. | Greenfield: failure model, detection, retry/skip, quorum-with-loss |
| ADR-0110 | **Collective memory backend reconciliation** ("SQLite persistence with WAL") | Memory `project-rvf-primary` says we use RVF as primary; SQLite is fallback. Functional surface is similar/better but doesn't match README copy. | Doc reconciliation OR add SQLite-WAL adapter behind feature flag |

## Per-ADR template

Each follow-up ADR follows this structure:

1. **Status** (Investigating / Proposed / Accepted / Implemented).
2. **Context** — what the README claims, what's in scope.
3. **Investigation findings**:
   - Upstream ADRs (forks/ruflo/v3/docs/adr/, forks/ruflo/ruflo/docs/adr/, forks/ruflo/ruflo/src/ruvocal/docs/adr/) cross-referenced.
   - Source archaeology: which files implement the behavior, are they imported anywhere, what's the call graph.
   - Commits / PRs that touched the area (`git log` on the relevant files).
   - User-facing docs (skills, agent definitions, quickstart).
4. **Current state verdict** — reality vs README claim, with citations.
5. **Test plan** — how to verify the behavior end-to-end (regression checks for the harness + live smoke).
6. **Implementation plan** — concrete edits + their sequence + dependencies on other ADRs in this roadmap.
7. **Risks / open questions**.
8. **Out of scope** — what this ADR explicitly does NOT cover.

## Rules of engagement (per CLAUDE.md + memory)

- All implementation lives in fork (`forks/ruflo`); ruflo-patch holds tests + ADRs.
- No API costs / cost gates / budget framing — ruflo orchestrates local
  `claude` CLI invocations against the developer's subscription
  (memory `feedback-no-api-keys.md`).
- No silent fallbacks; tests fail loudly (memory `feedback-no-fallbacks.md`).
- Every change ships unit + integration + acceptance tests
  (memory `feedback-all-test-levels.md`).
- Fork commits don't carry `Co-Authored-By: claude-flow <ruv@ruv.net>`
  (memory `feedback-fork-commit-attribution.md`).
- ADR-0097 paired-test rule: every behavioral change ships with a
  paired unit test in `tests/unit/`.

## Implementation log

### 2026-04-29 — Roadmap created

Six items allocated. Investigation order chosen by dependency depth:

1. ADR-0105 (Topology) — code exists, narrowest blast radius, foundation
   for cross-worker visibility used by other items.
2. ADR-0106 (Consensus) — code exists, depends on Topology for the
   network model.
3. ADR-0109 (Fault tolerance) — depends on Consensus quorum semantics.
4. ADR-0107 (Queen types) — orthogonal; can be done in parallel.
5. ADR-0108 (Mixed worker types) — orthogonal; CLI + prompt change.
6. ADR-0110 (Memory backend reconciliation) — doc-shaped, can be last.

### Investigation progress

All six per-claim ADRs investigated. Status: **Investigating** — recommendations made, no implementation choices ratified yet.

| ADR | Recommendation | LOC | Headline finding |
|---|---|---|---|
| ADR-0105 — Topology | Option C (hybrid): consume **both** `TopologyManager` (in-process swarm-state, currently orphaned in fork's swarm package — own it on next merge) **and** `graph-backend.ts` (NAPI persistent agent-relationship graph from upstream ADR-087). Complementary layers — TopologyManager for "who's leader, how nodes connect, when to rebalance"; graph-backend for "which agents have collaborated over time, causal edges between events." Earlier framing ("consume graph-backend, leave TopologyManager as `@internal`") was wrong — corrected per ADR-0111 §"Orphaned `swarm/src/` classes — per-class disposition" (2026-04-29 review). | ~280 | `TopologyManager` (656 LOC) + tests exist in swarm package; orphaned from CLI. Label mismatch: README's `hierarchical-mesh` / `adaptive` ≠ code's `centralized` / `hybrid`. |
| ADR-0106 — Consensus | **Option A** (full wire-up of `ConsensusEngine` + raft/gossip/byzantine into `hive-mind_consensus` MCP handler via daemon-resident pattern). Updated 2026-04-29 per memory `feedback-no-value-judgements-on-features.md` ("import ALL features") — flipped from earlier Option D. JSON-tally improvements (equivocation detection, absence-aware status) layer on top of `ConsensusEngine` rather than alongside it. Trust-model insight stays as documented context (informs future signature-verification work) but does NOT gate wiring. | ~260 (updated) | Three layers exist (swarm-pkg runtime, swarm tests, MCP-tool layer). Only the JSON-tally MCP layer was wired. Strategy mismatch across 5+ sources. |
| ADR-0107 — Queen types | Option D (per-type prompt prose + CLI enum validation + state persistence + README correction) **PLUS wire QueenCoordinator as daemon-resident advisor alongside ADR-0104's prompt-driven Queen** (composition pattern via `mcp__ruflo__queen_*` MCP tools). Updated 2026-04-29 per `feedback-no-value-judgements-on-features.md` — flipped from "park as @internal." | 299 (updated) | `QueenCoordinator` (2030 LOC) has zero queen-type branching but provides capability scoring, stall detection, recovery, per-topology coordination — all wired now. V2's per-type prose blocks (only real per-type runtime that ever shipped) ported. CLI validation closes `--queen-type banana` silent acceptance. |
| ADR-0108 — Mixed worker types | Option A (V2-parity `--worker-types` comma-separated flag + per-type prose) + Option C enum validation | 263 | 8-type enum already exists at `swarm/src/types.ts:78-91` matching README — **not imported** by hive-mind. V2 actually shipped this (`flags.workerTypes.split(',')`, modulo round-robin, per-type instructions for 6 of 8 types) — V2→V3 port lost all three without an explicit decision. V2's default was 4 types, not 8 — README's "8 worker types" was already aspirational in V2. Zero per-domain agent definition files for the 8 types. |
| ADR-0109 — Fault tolerance | Option E (hybrid A+B+D, defer C): worker-failure protocol in §6 prompt + auto-status transitions in `_consensus` + README rewrite. **PLUS wire all 4 consensus protocols** (`raft.ts` / `gossip.ts` / `byzantine.ts` / `consensus/index.ts`) into `hive-mind_consensus` MCP handler via daemon-resident pattern (per ADR-0111 §"Orphaned `swarm/src/` classes — per-class wire-up plan"). Updated 2026-04-29 per `feedback-no-value-judgements-on-features.md` — flipped from "preserve as @internal — federated cross-hive infrastructure." | 344 (updated) | `ByzantineConsensus` structural PBFT (vote-counting, equivocation detection, `requiredVotes = 2*f + 1`) is real value even with signatures unverified — wire it. Signature verification stays a *separate feature gap* annotated in code. V2's worker-failure model (retryTask + lineage + quorum_failed) ports as the prompt-side protocol. |
| ADR-0110 — Memory backend | Option D (README copy fix + claim split: hive-state vs general-memory) | 223 | **SQLite fallback is structurally unreachable** — `storage-factory.ts:80-179` is RVF-only-or-throw. The `storageProvider: 'better-sqlite3'` knob is plumbed but never honored at the factory branch. Two `RvfBackend` classes exist (memory-pkg pure-TS-fallback vs agentdb N-API/WASM). README's "Collective Memory" mashes hive shared-state (plain JSON under §5 lock) with general agent memory (RVF). RVF has its own WAL — README's "WAL" claim is correct in spirit but names the wrong backend. |

### Cross-cutting findings

Surfaced repeatedly across the six investigations:

1. **The "orphaned subsystem" pattern**: ADR-0105/0106/0107 all hit the same shape — full-featured TypeScript classes in `v3/@claude-flow/swarm/` (`TopologyManager`, `ConsensusEngine`, `QueenCoordinator`) with tests, never imported from `cli/src/`. Migration `HIVE-MIND-MIGRATION.md` documented `Queen.ts → Missing → ❌ Needs implementation`. The migration stalled. This ADR roadmap inherits the consequence.
2. **The V2→V3 regression pattern**: V2's `simple-commands/hive-mind.js` had real (if simple) per-feature runtime code for queen types, mixed worker types, worker-failure handling. V3's prompt-driven Queen path lost all three. The ADRs in this roadmap are largely **port-back from V2** rather than greenfield.
3. **Silent-fallback violations** (per `feedback-no-fallbacks.md`): `--queen-type banana`, `--type fizzbuzz`, `storageProvider: 'better-sqlite3'` all silently no-op or fall through. Each ADR's recommendation includes the validation fix.
4. **Trust-model honesty gap**: README claims Byzantine fault tolerance over hive workers that share auth, MCP boundary, and identity. Adversarial guarantees are theatrical for that boundary. Honest framing is "worker-unreliability tolerance" until cross-hive federation ships. ADR-0106 surfaces this; ADR-0109 makes it explicit.
5. **README claim drift**: number of consensus algorithms varies (3/4/5) across the same README; "Queen Types" listed in two places with different framings; "Collective Memory" mashes two distinct subsystems. Doc reconciliation is half the work for several items.

### Recommended ratification order

If implementations are to proceed, dependency-respecting order:

1. **ADR-0107 (Queen types)** + **ADR-0108 (Mixed worker types)** — prompt-only, no infra, lowest blast radius. Port V2 prose blocks; add CLI validation. Same-PR candidates.
2. **ADR-0109 (Worker failure handling)** — prompt + MCP-tool changes, depends on ADR-0106's auto-status-transition fix.
3. **ADR-0106 (Consensus)** — improve JSON-tally semantics, reframe README. Pairs with ADR-0109.
4. **ADR-0105 (Topology)** — state-tracking only (Option C); orthogonal to consensus.
5. **ADR-0110 (Memory backend)** — README copy fix; orthogonal to all of the above.

All six are **`Status: Investigating`** with recommendations. Each remains independently ratifiable; nothing in this roadmap is blocked on the others.
