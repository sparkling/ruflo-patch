# ADR-0132: Hive-mind sub-queen failure escalation in hierarchical-mesh topology (R8 follow-up)

- **Status**: Proposed (2026-05-03)
- **Date**: 2026-05-03
- **Deciders**: Henrik Pettersen
- **Depends on**: ADR-0109 (parent — original R8 paragraph identified this gap), ADR-0131 (T12 worker-failure prompt protocol — sibling shape this ADR extends), ADR-0128 (T10 hierarchical-mesh topology runtime — owns the sub-queen instantiation surface this ADR fails-handles)
- **Scope**: Fork-side runtime work in `forks/ruflo/v3/@claude-flow/swarm/src/queen-coordinator.ts` (sub-queen-failure handler + reassignment logic) and `forks/ruflo/v3/@claude-flow/cli/src/commands/hive-mind.ts` (queen-prompt §6 WORKER FAILURE PROTOCOL extension covering sub-queen-failure escalation paths). Closes ADR-0109 R8 only; does not generalise to multi-level recursion or cross-hive sub-queen migration.

## Context

ADR-0128 (T10) wired `hierarchical-mesh` topology: workers partition into sub-hives, each with a sub-queen; sub-hives run `mesh` internally; sub-queens coordinate `hierarchical`-ly upward to the top-level queen. ADR-0128 §Refinement explicitly noted sub-queen failure as a new failure mode introduced by this topology and surfaced — but did not decide — three options: (a) promote a worker in the affected sub-hive to interim sub-queen, (b) fail the sub-hive's task and propagate absence to the top-tier queen, (c) absorb the orphaned workers into the top tier and continue.

ADR-0109 R8 documented the gap. ADR-0131 (T12) shipped the worker-failure prompt protocol but explicitly carved sub-queen failure out of scope: T12's flat retry-once-then-mark-absent policy is for direct-queen-spawned workers only.

Empirical state today: a sub-queen crash, Task error, or silent absence isolates its sub-hive from the top-level queen. The top-tier queen has no escalation handler — the sub-hive's workers continue executing (or stall waiting for sub-queen direction) but their results have no path upward. T12's WORKER FAILURE PROTOCOL detects worker absence; nothing detects sub-queen absence.

This ADR exists to (1) extend ADR-0131's protocol with sub-queen escalation semantics and (2) add a runtime handler in `queen-coordinator.ts` that the top-level queen can trigger when it detects sub-queen non-response.

## Decision Drivers

- **ADR-0109 R8 carry-forward** — the parent ADR explicitly deferred this decision; ADR-0132 is the named follow-up.
- **ADR-0128 §Refinement deferral** — T10 surfaces sub-queen failure as a distinct event but does not auto-recover. ADR-0132 owns the recovery path.
- **`feedback-no-fallbacks.md`** — sub-queen failure must be a loud, named event; no silent collapse into the worker-absence path. ADR-0131's `WorkerAlreadyFailedError` precedent applies.
- **ADR-0131 protocol shape reuse** — the §6 prompt-protocol pattern (detect → mark → decide retry-vs-proceed → record audit trail) is the right shape for sub-queen failure too. ADR-0132 extends rather than replaces.
- **Trusted-clique trust model (ADR-0106 / ADR-0109)** — sub-queens are Task-spawned by the top queen in the same `claude` session. Same model, same auth. "Sub-queen failure" means crashed/silent/errored, not "lying" — adversarial framing does not apply.
- **One nesting level cap (ADR-0128)** — `hierarchical-mesh` recursion is capped at one level (top queen + sub-queens; no sub-sub-queens). ADR-0132 inherits this cap; cascading sub-queen failures across multiple nesting levels are out of scope.

## Considered Options

- **Option (a) — Promote a worker in the affected sub-hive to interim sub-queen.** The top-level queen detects sub-queen non-response, picks one of the sub-hive's workers (election strategy TBD — round-robin, longest-running, or topology-driven), re-spawns it via Task with a sub-queen prompt template, transfers the sub-queen's `state.consensus.pending` proposals to the new sub-queen, and records lineage (`subQueenRetryOf: <originalSubQueenId>`).
- **Option (b) — Escalate to the top-level queen, which reassigns the subtree.** The top-level queen marks the sub-hive's task as `'sub-queen-absent'`, absorbs the orphaned workers into the top tier (effectively flattening that sub-hive's workers into direct-queen-spawned workers), and re-routes their result-key-write contracts to the top queen. Sub-hive's pending consensus proposals are either re-issued at the top tier or marked failed-quorum-not-reached per ADR-0131's auto-transition.
- **Option (c) — Hybrid: try (a) once, fall back to (b).** First-attempt promote-worker-to-sub-queen with a 60s window; if the new sub-queen also fails, escalate to top-tier absorption per (b). Preserves sub-hive boundary when possible; degrades gracefully otherwise.

Decision deferred to implementation; this ADR's scope is to commit to *adding* an escalation protocol and to define the surfaces it touches. Pseudocode and implementation choice land when work begins.

## Decision Outcome

**Decision: ship a sub-queen failure escalation protocol; option choice (a/b/c) deferred to implementation commit.**

The decision this ADR makes today is binary: the runtime *will* handle sub-queen failure with a named escalation path, not silently strand the sub-hive. Which of the three options materialises is an implementation-time decision informed by:

1. Whether the sub-hive's pending work is mid-consensus (favors (a) — preserves consensus context) vs early-stage (favors (b) — simpler).
2. Whether the topology cap (one nesting level) leaves room to instantiate a fresh sub-queen without violating ADR-0128's recursion cap (favors (a) — same level, replacement only) vs not (favors (b)).
3. Empirical data from acceptance smoke tests once T10 + T12 are deployed in real hives.

Lineage tracking follows ADR-0131's pattern: `subQueenFailedAt: number | null` and `subQueenRetryOf: string | null` (or equivalent for absorption case) added to the sub-queen entry in `state.workers[]` (sub-queens are workers tagged with a `role: 'sub-queen'` field per ADR-0128's data model). One-way transition: `subQueenFailedAt: null → number` only.

## Out of scope

- **Cascading failures beyond a single sub-queen.** If a sub-queen and its replacement both fail, treat as escalation to (b) regardless of which Option above ships; no third-attempt promotion. Multi-failure cascades within a single hive are a separate ADR.
- **Cross-hive sub-queen migration.** Moving a sub-queen between independent hives (federated sub-queen rebalancing) is a federation concern; out of scope until cross-hive identity exists per ADR-0109's federation framing.
- **Sub-sub-queen failure.** ADR-0128 caps recursion at one nesting level. Sub-sub-queens do not exist; their failure mode does not exist.
- **Adversarial sub-queen detection** (sub-queen lies about sub-hive results). Trusted-clique model per ADR-0106; "lying sub-queen" is a federation concern.
- **Topology promotion** (promoting `hierarchical-mesh` to a deeper nesting level when sub-queens fail). The cap holds.

## Acceptance criteria

- [ ] Prompt-protocol extension at `forks/ruflo/v3/@claude-flow/cli/src/commands/hive-mind.ts` §6 WORKER FAILURE PROTOCOL block documents sub-queen failure detection (top-level queen's responsibility) and escalation paths (one of (a)/(b)/(c) chosen at implementation time, with sentinel substrings asserted by acceptance tests)
- [ ] `forks/ruflo/v3/@claude-flow/swarm/src/queen-coordinator.ts` adds a `subQueenFailed(id)` handler with reassignment logic implementing the chosen Option from §Decision Outcome
- [ ] `state.workers[]` shape gains optional `subQueenFailedAt: number | null` and `subQueenRetryOf: string | null` (or absorption-equivalent fields) on sub-queen entries; existing state files load with defaults
- [ ] `subQueenFailed(id)` handler is one-way: `subQueenFailedAt: null → number` only; reverse transitions throw
- [ ] Integration test simulates sub-queen failure in a `hierarchical-mesh` swarm (e.g., sub-queen Task returns error, or sub-queen never writes its sub-hive-summary memory key within 60s); verifies the chosen escalation path runs end-to-end
- [ ] Unit test asserts the prompt-protocol sentinel substrings and the `subQueenFailed` handler's reassignment logic against mocked I/O
- [ ] Acceptance check (new file `lib/acceptance-adr0132-sub-queen-failure.sh` wired into `scripts/test-acceptance.sh`) round-trips the behaviour via `init --full` project + published `@sparkleideas/cli`
- [ ] ADR-0109 R8 paragraph cross-references ADR-0132 as the closure ADR; ADR-0131 §Risks "Promote scope expansion" sub-bullet on sub-queen semantics drops once ADR-0132 ships

## Risks

**Medium — option choice premature.** This ADR commits to *an* escalation protocol but defers (a)/(b)/(c). If implementation begins before the deferred drivers (mid-consensus state, recursion cap interaction, smoke data) are observable, the choice is theoretical. Mitigation: deploy T10 + T12 to a live hive, observe a real sub-queen failure once, then choose. If no real failure occurs, default to Option (b) (top-tier absorption) as the lowest-blast-radius option.

**Medium — cross-ADR coupling with ADR-0131.** ADR-0132 reuses ADR-0131's prompt-protocol sentinel pattern (`60s`, named-error-on-rejection, `failedAt` field) but adds a new sentinel set (sub-queen-specific). If ADR-0131's sentinels rename, ADR-0132's tests break. Mitigation: cross-reference at closure; both ADRs' acceptance tests live in the same harness and break together loudly.

**Low — `state.workers[]` shape grows again.** ADR-0131 added `failedAt`/`retryOf`. ADR-0132 adds `subQueenFailedAt`/`subQueenRetryOf` (or absorption-equivalent). Optional fields with load-time defaults; no migration. Five total optional fields per worker entry once both land. Acceptable.

**Low — `queen-coordinator.ts` is currently orphaned in the swarm package.** Per ADR-0111, `swarm/src/` classes are wired one at a time. If `queen-coordinator.ts` has not yet been wired by the time ADR-0132 implementation begins, the wire-up is a prerequisite. Mitigation: ADR-0111's per-class wire-up plan tracks `queen-coordinator.ts` independently; ADR-0132 implementation depends on that wire-up completing first.

**Promote scope expansion if any of**: cascading multi-failure cascades become a real need (currently single-failure escalation only); sub-queen identity-verification across hives becomes a real need (federation prerequisite, already out of scope); two-level recursion (`sub-sub-queens`) becomes a real need (currently capped at one level per ADR-0128). Each is a separate follow-up ADR.

## References

- ADR-0109 — Worker failure handling (parent; R8 paragraph identifies this gap; carries forward to here)
- ADR-0131 — Worker-failure prompt protocol + auto-status-transitions (T12; sibling shape this ADR extends; sub-queen failure was explicitly out-of-scope of T12)
- ADR-0128 — Hive-mind topology runtime (T10; introduces `hierarchical-mesh` and sub-queen instantiation; surfaces sub-queen failure as new mode without deciding recovery)
- ADR-0106 — Consensus algorithm enforcement (trusted-clique trust model; sub-queens are Task-spawned by top queen in same session)
- ADR-0111 — Upstream merge program (orphaned `swarm/src/` per-class wire-up — `queen-coordinator.ts` wire-up is prerequisite for this ADR's implementation)
- ADR-0114 — Substrate/protocol/execution layering (escalation prompt extension lives at execution layer; `subQueenFailed` handler at protocol layer; `state.workers[]` shape widening at substrate layer, additive only)
- Implementation surface (forecast): `forks/ruflo/v3/@claude-flow/swarm/src/queen-coordinator.ts` and `forks/ruflo/v3/@claude-flow/cli/src/commands/hive-mind.ts` §6 WORKER FAILURE PROTOCOL block
