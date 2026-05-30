---
status: accepted
date: 2026-05-26
tags: [archivist, replay-verification, test-harness]
supersedes: []
depends-on: [ADR-0180, ADR-0181, ADR-0246]
implements: []
---

# Archivist replay-verification test harness (ADR-0181 Phase I successor)

## Context and Problem Statement

[[ADR-0181]] §Closure plan amendment 2026-05-17 named **Phase I — replay test wiring** as one of two deferred items (alongside Phase D, which went to [[ADR-0184]]). The closure-plan table recorded Phase I as `(none — deferred)` with no named successor:

> | **I** replay test wiring | Deferred to own ADR. Inventory found NO replay-verification implementation in `forks/agentdb/test/`. The closure-plan amendment language was stale — only `forks/agentdb/src/archivist/MODULE.md` §replay-verification describes the architecture, not the test. Implementing the tool from spec is Phase-7-class new test development, not pipeline-wiring. | (none — deferred) |

And separately:

> **ADR-0180 #19 Replay test harness wiring** → Phase I.

So Phase I inherits **ADR-0180 Open Follow-up #19** plus the MODULE.md `§replay-verification` design contract. The spec exists; the tool does not.

The ADR-0262 audit-driven schema sweep this session flagged the missing successor as a tracking gap. This ADR closes that gap by naming the successor (this file) and recording the deferral with explicit trigger conditions, per [[ADR-0257]]'s defer-with-trigger pattern.

## Decision Drivers

* **Spec exists, tool doesn't.** `forks/agentdb/src/archivist/MODULE.md §replay-verification` defines a tool that re-reads the audit log against a fresh substrate and asserts addressable-key set-equality. The inventory at ADR-0181 closure confirmed zero implementation in `forks/agentdb/test/`.
* **Phase-7-class scope.** Building the harness is new test development, not pipeline wiring — separate cost class from ADR-0181's main closure phases.
* **Concrete divergence concern surfaced by [[ADR-0246]] F-03-002.** Archivist invariants run AFTER the substrate write commits (no rollback) — a write that violates an invariant can leave the substrate in a state the audit log marks `rejected`. Replay would detect that divergence; without replay, audit-vs-substrate consistency relies on the invariants firing pre-commit (which they currently don't). The replay tool is the operational backstop.
* **No incident driving urgency today.** No production replay-divergence incident has been observed; the value is preventive.
* `[[feedback-no-fallbacks]]` — the deferral is explicit (this ADR), not an implicit "we'll get to it." A defer without a named successor is the same shape as a silent gap.

## Considered Options

* **Option A — Build the harness now.** Implement the replay tool from MODULE.md spec, wire into `forks/agentdb/test/` integration suite, gate on it for release. Rejected: scope = Phase-7-class new test development; no concrete divergence has been observed; cost-vs-benefit doesn't justify pre-emptive build.
* **Option B (chosen) — Defer with named successor + explicit trigger conditions.** This ADR is the named successor for ADR-0181 Phase I + ADR-0180 #19. Status stays `proposed, completed: false` so the ADR-index `accepted AND completed:false` query surfaces it as outstanding when the triggers fire.
* **Option C — Drop the requirement.** Remove MODULE.md `§replay-verification` from the architecture. Rejected: [[ADR-0246]] F-03-002 (invariant-after-commit) creates a real consistency concern that replay would catch; dropping the spec without a substitute would leave that concern unmonitored.
* **Option D — Fold into [[ADR-0246]] F-03-002 remediation.** Rejected: F-03-002's fix is to make invariants pre-commit (with rollback); replay is the orthogonal backstop. They're complementary, not the same work.

## Decision Outcome

Chosen: **Option B — defer with explicit trigger conditions.**

### Trigger conditions (any one promotes this ADR to `accepted` + build start)

1. **ADR-0246 F-03-002 fix lands** with a complete pre-commit invariant + rollback path. Replay then becomes the verification gate for the new behavior.
2. **Production replay-divergence incident** observed: an audit log entry marked `rejected` whose substrate still carries the rejected write (or any other audit-vs-substrate set-mismatch). Replay tool becomes the diagnostic.
3. **Operator request** for an audit-log integrity check (e.g. before a substrate migration or a federation snapshot per [[ADR-0200]]).
4. **MODULE.md §replay-verification spec changes** — if the architecture is amended, this ADR re-opens to reconcile.

### Consequences

* Good, because Phase I now has a named successor — the closure-plan table row updates from `(none — deferred)` to `(named: ADR-0263 — proposed)`.
* Good, because the deferral is queryable: `adr-index` filter `status:proposed AND completed:false AND tag:adr-0181-phase-i` surfaces this ADR when reviewing outstanding archivist work.
* Good, because the four trigger conditions are concrete — operator or audit can check whether any has fired without re-reading the ADR-0181 closure-plan amendment.
* Bad, because deferred work without a deadline tends to age. Mitigation: every ADR-0246 follow-up touching invariants must cite this ADR's Trigger #1 explicitly; that creates a forcing function at the next F-03-002 work.
* Neutral, because no code changes; the artifact is the decision + trigger spec.

### Confirmation

* `adr-index` records this ADR with `status: proposed, completed: false`.
* [[ADR-0181]] closure-plan table row for Phase I cites `ADR-0263` as the successor (paired commit).
* [[ADR-0180]] Open Follow-up #19 cross-reference resolved to `ADR-0263`.

## More Information

Original status: accepted 2026-05-26; amended and implemented 2026-05-28. Status note (2026-05-28): Ratified `proposed` → `accepted` (Track C of the post-ADR-0261 plan), then BUILT (per user directive "don't defer anything"). Implementation:

- **agentdb fork commit `ec3a2ab`**: `src/archivist/replay-verification.ts` (`verifyAuditLog({auditPath?, maxDepth?, maxFanout?}) → Promise<ReplayReport>`) + `test/archivist/replay-verification.test.ts` (10/10 unit tests pass via `node --import tsx --test`). Exposed from `src/archivist/index.ts`.
- **ruflo-patch commit `e78ec95` + smoke fix**: `scripts/smoke-adr0263-replay-verification.mjs` + `lib/acceptance-adr0263-checks.sh` wired into `test-acceptance.sh` + `test-acceptance-fast.sh`. Smoke drives the harness against a real audit log produced by `cli memory store` ops + a synthetic depth-4 negative test.
- **Local smoke run (2026-05-28)**: 4/4 PASS. Real audit log: 6 entries, 3 roots, depth=0, all 4 rules pass. Synthetic depth-4 → depth-ceiling FAIL as designed.

Tag `deferred-with-trigger` removed from frontmatter — the harness is now in-tree; future trigger conditions just exercise it via the wired smoke or directly via `verifyAuditLog`. The original Option B trigger conditions in §Decision Outcome are kept as historical record (they describe when ops *should run* the harness; they no longer gate implementation).

**Scope-honesty correction (2026-05-28 swarm):** the shipped harness implements **audit-log-internal structural checks only** — `depth-ceiling` (≤3), `no-fanout-amplification`, `state-progression`, `terminal-state`. It does **NOT** implement the MODULE.md §replay-verification headline property "replay against a freshly-initialized substrate and assert addressable-key **set-equality**." `VerifyOptions` has no substrate-handle param; `verifyAuditLog` never opens a fresh substrate or compares keys. The source doc-comment's "optional fourth check … when a live substrate handle is provided … weakened to cardinality" is **dead prose** — no such path is wired. So the honest claim is "verifies audit-log internal consistency," NOT "addressable-key set-equality." The substrate-replay half remains unimplemented and is the natural companion to Trigger #1's still-pending RVF-invariant enforcement (ADR-0246 F-03-002 RVF arm — `RvfBackend.freeze()` exists but is not wired into archivist dispatch). MODULE.md §replay-verification annotated to match. No trigger has silently fired; the only correction here is scope-truth, not behaviour.

* [[ADR-0181]] §Closure plan amendment 2026-05-17 — original Phase I deferral
* [[ADR-0180]] Open Follow-up #19 — replay test harness wiring
* `forks/agentdb/src/archivist/MODULE.md §replay-verification` — architecture spec
* [[ADR-0246]] F-03-002 — invariant-after-commit concern that justifies the backstop
* [[ADR-0257]] — defer-with-trigger pattern this ADR follows
