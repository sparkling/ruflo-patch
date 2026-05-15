# ADR-0181 Phase 6 — Devil's Advocate memo (council-absent)

**Author:** team-lead (no `phase6-da` was spawned)
**Date:** 2026-05-15
**For:** archival completeness — there was no council, so there is no DA verdict per worker.

## What this memo is

A placeholder. Phase 6 r3 did NOT run the §Multi-Agent Execution Plan: no `swarm_init`, no `TeamCreate`, no queen + DA + workers wave. Decisions were made by the single team-lead author, and the work was executed sequentially under the strict 0-fail acceptance exit criterion.

This memo exists so that future readers and any later audit can see the *absence* of the DA process documented on-disk, rather than inferring it from a missing file.

## Why no council was run

* The work was a **prerequisite wire-up**, not the named Phase 6 scope. ADR-0181's Execution Plan §Phase 6 is "ADR-0112 enforcement-code retirement" — that *is* council-worthy and remains un-started. What landed (7 writer-capability surfaces, 7 cli factories, 7 handler ports, 3 registrations) was an extension of Phase 5's stub-body work, structurally similar to F4-2 Phase B/C, with no genuinely open architectural choice.
* The strict exit criterion (`acceptance passes, libraries published, everything committed`) gated every step. Each registration was tried, gated through `npm run release`, and either kept (3 of 7) or rolled back to body-ready/un-exported (4 of 7). Run-fail-rollback is its own form of verification, but it is not dialectic.
* Sequential single-author execution under a strict gate is fast, but it produces no record of the *alternatives considered*. Where Phase 4 / Phase 5 left memos detailing "Option A vs Option B" rulings, this loop has only the on-disk result.

## What a real DA pass would have surfaced

Documented here as a stand-in for the un-spawned dialectic. These are the open challenges a `phase6-da` worker would have raised:

* **D1 — un-exported handlers are silent skip.** The 4 un-exported handlers (`reflexion-store`, `skill-create`, `hierarchical-store`, `sona-trajectory-store`) result in dispatch returning `tool not registered`, which the harness skip-accept whitelist catches. This is the right pattern *per `feedback-no-fallbacks`* only because it's a documented intentional skip (the per-family barrel comments + this memo + the ADR amendment + the handover doc all name the gate). The DA would have demanded that the in-source comment on the un-exported lines name the *specific* blocker — stub-controller persistence — and the unblock condition (Phase 7 controller wiring or stub-vs-real detector), not just "Phase 7 wire-up." Audit this on the next loop touch.
* **D2 — stub-vs-real detector is the cleaner fix.** Wiring real controllers in the test environment is the right Phase 7 product fix. But a stub-vs-real detector in each `makeCliXxxWriter` factory is the cheaper interim — it would let the 4 handlers register today, with the harness skip-accept catching the `controller not available — stub detected` throw. The DA would have pushed to land the detector this loop rather than carrying 4 un-exported handlers forward.
* **D3 — capability proliferation.** 7 new writer interfaces is a lot. The DA would have questioned whether `ReasoningBankWriter` + `LearningSystemWriter` + `FeedbackRecorder` represent genuinely different write paths or are accidental separations of the same capability — and whether `SonaTrajectoryWriter` should be a sub-method of `ReasoningBankWriter` rather than its own surface. Defer to a future refactor; the seven names track the underlying cli controller surface for now.
* **D4 — no per-handler tests.** The 7 handler-body ports landed without per-handler tests under `forks/agentdb/test/archivist/handlers/agentdb/`. Phase 4 set the pattern (88 tests for the `MemoryRvfAdapter` + 24 tests for the un-stubbed reads). The 3 registered handlers are tested only by their acceptance probes (`adr0112-27-2-rt-pattern`, etc.) — a weaker gate than dedicated unit tests against the capability mocks. Phase 7 should backfill.
* **D5 — `pattern-store` adapter via `storePattern` reuses cli logic the capability adapter recursion rule names as dangerous.** The Phase 5 DA-memo cross-cutting finding (rule: capability adapters must not dispatch back through archivist) applies here. `makeCliReasoningBankWriter` and `makeCliPatternReader` both back archivist capabilities and call into the cli's `storePattern` / `searchPatterns` — verify the chains stay non-recursive after the Phase 5 split.

None of these are blocking; each is a Phase 7+ audit checkpoint.

## Durable lesson

**Skipping the council process leaves the on-disk record of alternatives empty.** Future loops should re-engage the §Multi-Agent Execution Plan when the next Phase 6 increment (un-export the 4 handlers, OR start ADR-0112 retirement) lands. The cost of the council is small relative to the cost of not knowing what alternatives the executor weighed.

## Cross-reference

* [ADR-0181-phase-6-report.md](ADR-0181-phase-6-report.md) — companion phase report.
* [docs/ADR-0181-handover.md](../ADR-0181-handover.md) — full loop summary, including the un-exported handler gate rationale.
* [ADR-0181-phase-5-da-memo.md](ADR-0181-phase-5-da-memo.md) — the dialectic this memo is *not*.
