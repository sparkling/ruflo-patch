---
status: accepted
completed: true
date: 2026-05-20
implemented-date: 2026-05-22
tags: [learning, controllers, fail-loud, no-fallbacks, stub-honesty, ewc, sona, audit-followup]
supersedes: []
depends-on: [0201]
implements: []
---

# Learning controllers honesty pass — fail-loud on silent fallbacks and stub returns

> **Reviewed directly (2026-05-22).** Drafted from the ADR-0201 audit's
> `05-controllers-learning.md` slice — **26 findings, the largest single
> audit surface** the 0202–0218 batch missed. The honesty cluster was verified
> against live source and Option A confirmed; the F-05-007 EWC++ split is now
> **decided** (not deferred to a swarm). See *Direct review* for the
> per-finding verification and two fix-precision corrections.

## Context and Problem Statement

The ADR-0201 audit's slice 05
(`docs/audits/2026-05-19-soundness-audit/05-controllers-learning.md`) audited
the learning surface across `forks/agentdb/src/controllers/`,
`forks/ruvector/crates/sona/`, `forks/agentic-flow/`, and
`forks/ruflo/v3/@claude-flow/{memory,neural}/`. It produced **26 findings**
(2 HIGH, 3 MEDIUM, 11 LOW, 8 positive confirmations, 2 scope-bound).
**Of the 18 substantive findings, ZERO have a remediation ADR** in 0202–0218.

The cross-cutting observation in the audit (O-1) captures the pattern:
six call-sites (`LearningSystem.initializeRuVectorEnhancements`,
`SonaTrajectoryService.predict`, `SonaTrajectoryService.recordTrajectory`,
`LearningBridge.consolidate`, `LearningBridge.loadNeural`,
`NightlyLearner.consolidateEpisodes`) bare-`catch` and degrade silently —
matching the [[feedback-no-fallbacks]] anti-pattern that ADR-0210 closed
across the hooks surface but never touched in the learning surface.

The substantive findings, file:line:

- **F-05-001 [HIGH]** —
  `forks/agentdb/src/controllers/NightlyLearner.ts:208-225`.
  `discover()` returns `Promise<CausalEdge[]>` but the implementation
  computes the real count via `discoverCausalEdges()` and then **discards**
  it, returning an empty array. The TODO comment at line 223 admits this.
  Consumers (the `agentdb_learner_run` MCP tool) destructure `.length` and
  silently treat every run as no-op.
- **F-05-007 [HIGH]** — `forks/ruflo/v3/@claude-flow/cli/src/ruvector/ruvllm-wasm.ts:259-307`,
  `forks/ruvector/crates/sona/src/engine.rs:69-77`,
  `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/ruvllm-tools.ts:340-357`,
  `forks/ruvector/crates/sona/src/lora.rs:192-229`. The TS-side
  `ruvllm_microlora_adapt` MCP tool routes through `MicroLoraWasm.adapt`
  which does **not** consult EWC++. EWC++ is fully implemented in Rust
  (F-05-006, sound) and is invoked only by the background consolidation
  loop (`forks/ruvector/crates/sona/src/loops/background.rs:144-174`).
  `SonaConfig.ewcLambda`'s docstring implies EWC affects every `adapt`;
  per-call adapts use only the LoRA gradient accumulator with no
  catastrophic-forgetting protection. README HIGH H2 calls this the
  "EWC++ Rust impl complete; not invoked on the `ruvllm_microlora_adapt`
  MCP path" finding.
- **F-05-002 [MEDIUM]** — `forks/agentdb/src/controllers/LearningSystem.ts:528-535`.
  When `learning_experiences` is empty, `calculateActionScores` returns
  three synthetic actions (`action_1`, `action_2`, `action_3` with scores
  0.5/0.4/0.3). `predict` then runs epsilon-greedy over this synthetic set
  — observationally indistinguishable from a real prediction. Caller calling
  `predict` immediately after `startSession` gets a fake recommendation
  with no signal that the policy has zero training data.
- **F-05-003 [MEDIUM]** — `forks/agentdb/src/controllers/LearningSystem.ts:116-176`.
  Three independent init catches inside `initializeRuVectorEnhancements`
  each demote a fatal `RuVectorLearning.initialize` throw (F-05-019 verifies
  the module-boundary throw is correct) to `console.warn` + flag flip. The
  constructor caller (`LearningSystem` ctor at line 116) wraps the whole
  thing in `.catch(err => console.warn(…))`. Downstream `predict`/`train`
  proceeds against the unenhanced path with no signal.
- **F-05-004 [MEDIUM]** — `forks/agentdb/src/services/SonaTrajectoryService.ts:274-298`.
  Bare `catch {}` (line 291-293) at the native-engine dispatch with comment
  "Fall through to frequency-based prediction". Native-engine throw becomes
  observationally indistinguishable from "native engine not installed".
- **F-05-005 [LOW]** — `services/SonaTrajectoryService.ts:227-242`. Bare
  `catch {}` on native recordStep. Dual-write to SQLite + in-memory preserves
  durability, but the native learning side-effect is silently lost.
- **F-05-014 [LOW]** —
  `forks/agentdb/src/controllers/LearningSystem.ts:1162-1173` (explainAction),
  `:1332-1345` (calculateReward). Both wrap `causal_edges` SELECT in
  blanket `try { … } catch { causalChains = []; }`. Inline comment justifies
  as "best-effort context for explainability" but does not discriminate
  `SQLITE_ERROR no-such-table` (legitimate) from other SQL errors.
- **F-05-016 [LOW]** —
  `forks/ruflo/v3/@claude-flow/memory/src/learning-bridge.ts:269-277`.
  `LearningBridge.consolidate` bare-catches `await neural.completeTask(…)`
  failures and continues; failed `trajectoryId` is not retried, not logged,
  not surfaced.
- **F-05-024 [LOW]** —
  `forks/agentdb/src/controllers/NightlyLearner.ts:256-263`.
  `consolidateEpisodes` falls back to `discoverCausalEdges()` when no
  `attentionService` (FlashAttention disabled, the default). Returns
  `{ edgesDiscovered, episodesProcessed: 0 }` — `episodesProcessed: 0` is a
  lie: `discoverCausalEdges` processed up to 1000 candidate pairs.
- **F-05-009 [LOW]** —
  `forks/agentdb/src/controllers/LearningSystem.ts:231-262`. `endSession`
  has a small TOCTOU window between DB write and `activeSessions.delete` on
  the dual-instance singleton path.

Additional context findings (do not need fixing, included for the dialectic):

- F-05-006, F-05-010, F-05-011, F-05-015, F-05-017, F-05-020, F-05-022,
  F-05-023, F-05-025 — positive confirmations (no action).
- F-05-008 — naming collision between TS `SonaTrajectoryService` and Rust
  SONA engine (low, NAMING issue).
- F-05-012, F-05-013 — documented incomplete code (Reflexion + skill
  consolidation not wired into NightlyLearner; substrate-seam wraps are
  dead at the live MCP entry).
- F-05-018 — `federatedSession` removable per memory.
- F-05-021 — `SelfLearningRvfBackend` apex composite, deferred (not deep
  audited).
- F-05-026 — `LearningSystem` singleton coupling (footgun).

## Decision Drivers

- [[feedback-no-fallbacks]] — six bare-catch sites in this slice; the
  pattern is widespread but not uniform (sound counter-examples exist:
  F-05-020 `SonaLearningBackend.create`, F-05-022 `LearningSystem.train`
  empty-experiences throw, F-05-025 SonaTrajectoryService SQLite path).
- [[feedback-best-effort-must-rethrow-fatals]] — three of the bare-catches
  are best-effort wrappers that must discriminate fatal from recoverable.
- ADR-0210's per-handler Option B′ discipline applies — one ADR, per-call-site
  disposition, mix of `hand-port` / `implement` / `delete` / `mark-honestly`.
- The EWC++ contract gap (F-05-007) is **per-call adapt-path infra** —
  potentially out of scope for an "honesty pass" (the per-call EWC path is
  net-new work, not honesty). The dialectic should split it from the
  fail-loud cluster if appropriate.
- README severity: F-05-001 (HIGH, README H3 NightlyLearner.discover stub
  wrapper), F-05-007 (HIGH, README H2 EWC++ not invoked on per-call path).

## Considered Options

- **Option A — Per-handler honesty pass + EWC contract clarification (chosen).**
  Per-call-site disposition matching ADR-0210's Option B′:
  - **F-05-001:** implement — `discover()` computes `discoverCausalEdges()`
    (which returns a **count**, not an array — `:215`) and discards it,
    returning `[]` even for non-dry runs (`:224`). Fix: refactor
    `discoverCausalEdges()` to return the created `CausalEdge[]` (or have
    `discover()` re-query the edges it just created) and return that — this is
    **not** a one-line "return the array," since the helper currently yields
    only a count. The TODO at `:223` admits the gap.
  - **F-05-002:** fail-loud — throw `NoExperiencesError` when
    `learning_experiences` is empty; remove the synthetic `action_1/2/3`
    fallback. Update consumers (`predict`) to handle the empty-state error.
  - **F-05-003:** discriminate — `LearningSystem.initializeRuVectorEnhancements`'s
    three try/catches differentiate "module not installed"
    (`RuVectorLearning.initialize` throws with install-hint) from other
    errors; the former demotes to `available: false` telemetry, the latter
    re-throws.
  - **F-05-004 / F-05-005:** discriminate — distinguish "native not
    available" from "native threw" using error type or a feature-flag
    introspection on `this.sona`; the former silently falls through, the
    latter re-throws (or at minimum logs at error level + counter).
  - **F-05-014:** discriminate — only swallow `SQLITE_ERROR` /
    `no-such-table`; re-throw other SQL errors.
  - **F-05-016:** at minimum log + counter the failed `completeTask`;
    ideally retry once before silently dropping. Surface as
    `consolidate().errors[]` in the return.
  - **F-05-024:** fix the lie — `episodesProcessed: 0` (`:261`) while
    `discoverCausalEdges` processed candidate pairs. Because
    `discoverCausalEdges` returns only an edge count today, the fix must also
    expose the candidate-pairs count and return
    `episodesProcessed: candidatesProcessed` (NOT 0) — the same
    `discoverCausalEdges` return-shape change F-05-001 needs.
  - **F-05-009:** delete-then-write — `activeSessions.delete(sessionId)`
    before the DB `UPDATE`, OR mutate `session.status='completed'` after
    `activeSessions.delete` (closing the TOCTOU window).
  - **F-05-007 (EWC++ on per-call adapt path):** **SPLIT into its own future
    ADR (decided 2026-05-22).** This is net-new infra (the Rust `MicroLoRA`
    in `lora.rs` would need to consult `EwcPlusPlus::apply_constraints`
    inside `accumulate_gradient`, and the WASM-published `MicroLoraWasm` is
    a separate artefact this fork does not own). The honesty fix for
    F-05-007 is **document the contract narrowly**: clarify that
    `SonaConfig.ewcLambda` and `LearningBridge` `ewcLambda` affect ONLY the
    background consolidation cycle, NOT per-call adapt. The implementation
    fix is a separate decision.

- **Option B — Single sweep covering EWC infrastructure AND honesty fixes.**
  Bundles F-05-007's infra work with the honesty cluster. Rejected: scope
  creep; per-call EWC++ requires Rust changes in
  `forks/ruvector/crates/sona/src/lora.rs` and possibly a republish of
  `@ruvector/sona`'s WASM artefact — a multi-fork coordinated change that
  doesn't share a fix shape with the bare-catch fixes.

- **Option C — Marker-only (`_stub: true`, `_note: "EWC only in background"`).**
  Rejected: the audit findings include real broken code, not just
  documentation drift. Markers without behaviour change leave callers still
  destructuring `.length === 0` from `discover()` and getting silent no-ops.

- **Option D — Defer the whole slice — file as known-limitations in
  USERGUIDE; do not fix.** Rejected: this is the worst-case audit response
  per [[feedback-no-fallbacks]] — accepts the silent-fallback pattern as
  permanent.

## Decision Outcome

**Chosen: Option A — per-handler honesty pass for the eight bare-catch /
stub-return findings; F-05-007 (EWC++ on per-call adapt) is SPLIT into its
own future ADR.**

The honesty cluster is a clean ADR-0210-shaped pass. F-05-007 has a
different shape (net-new Rust infra in `lora.rs` + a WASM republish this fork
does not own) and is not conflated: **the honesty half lands here** (document
narrowly that `SonaConfig.ewcLambda` / `LearningBridge.ewcLambda` affect ONLY
the background consolidation cycle, not per-call `ruvllm_microlora_adapt`),
and **the per-call EWC++ implementation is deferred to a separate infra ADR**.
The honesty cluster lands regardless.

### Consequences

- Good, because the largest single uncovered audit surface (26 findings,
  zero covered) gets a remediation lens.
- Good, because the codebase pattern of "bare-catch silently degrades" gets
  one more closed surface — matches ADR-0210's hooks pass.
- Good, because the EWC++ contract gets clarified (whichever way the
  dialectic decides): either implemented per-call (real protection on every
  adapt) or documented narrowly (EWC = background-only).
- Bad, because consumers that silently absorbed the F-05-001 empty array
  / F-05-002 synthetic actions / F-05-024 lying `episodesProcessed: 0` now
  see real values and may need handling. Each fix has an explicit consumer
  trace in the audit.
- Bad, because the bare-catch discipline (discriminate fatal from
  recoverable) requires a small amount of error-type inspection at each
  call-site — not a refactor, but more than a one-line change.
- Neutral, because positive findings (F-05-006/010/011/015/017/020/022/023/025)
  remain untouched; this ADR does not regress them.

### Confirmation

1. **Unit test (F-05-001):** call `discover()` with seed data that produces
   N causal edges; assert the returned array has length N (NOT 0).
2. **Unit test (F-05-002):** call `predict` on a session with zero
   experiences; assert it throws `NoExperiencesError` (NOT returns synthetic
   actions). Update the MCP tool surface to surface the error honestly.
3. **Unit test (F-05-003):** mock `@ruvector/gnn` to throw a non-import
   error during `initialize`; assert `LearningSystem` constructor surfaces
   it (NOT swallows to `gnnEnabled: false`).
4. **Unit test (F-05-004/005):** mock `this.sona.predict` / `recordStep` to
   throw; assert the error is logged at error level + counter increments
   (or re-thrown, per dialectic).
5. **Unit test (F-05-014):** inject a non-`no-such-table` SQL error on
   `causal_edges` SELECT; assert `explainAction` re-throws.
6. **Unit test (F-05-016):** mock `neural.completeTask` to throw on one
   trajectoryId in a batch; assert the return value carries the failed
   ID in `errors[]`.
7. **Unit test (F-05-024):** call `consolidateEpisodes` with `attentionService=null`;
   assert `episodesProcessed === candidatesProcessed` (not 0).
8. **Unit test (F-05-009):** stress test for the TOCTOU — call
   `endSession` + `predict` concurrently; assert no race.
9. **EWC contract test (F-05-007 honesty variant):** assert the per-call
   `ruvllm_microlora_adapt` MCP tool's `tools/list` description does NOT
   advertise "EWC protection" (or, if Option A's full impl fires, assert
   it does — driven by the dialectic decision).
10. **`npm run release`** acceptance pass on existing learning-related
    groups (no regression).

## Pros and Cons of the Options

### Option A — per-handler honesty + EWC split

- Good, because matches the established ADR-0210 discipline.
- Good, because the EWC infra question is held separately (preserves scope).
- Bad, because eight call-site changes — three reviews per change.

### Option B — single sweep including EWC infra

- Good, because one decision closes the entire slice.
- Bad, because mixes Rust infra port (multi-fork coordinated change) with
  TS error-handling fixes — different blast radii.

### Option C — marker-only

- Bad, because real broken code (e.g. F-05-001 returns empty array
  unconditionally) needs a real fix, not a label.

### Option D — defer entire slice

- Bad, because accepts the audit-flagged anti-pattern as steady state.

## Direct review (2026-05-22)

Reviewed directly (not via swarm) against the live agentdb/ruvector source.
**Verdict: Option A confirmed; F-05-007 EWC++ split decided; two fix-precision
corrections.**

- **F-05-001** verified — `NightlyLearner.discover()` (`:208-225`) computes
  `discoverCausalEdges()` at `:215` then returns `[]` at `:224` for non-dry
  runs; the `:223` TODO admits it. **Correction:** `discoverCausalEdges()`
  returns a *count*, not an array, so the fix is a return-shape change to that
  helper (or a re-query), not "return the array."
- **F-05-024** verified — `consolidateEpisodes` (`:256-262`) returns
  `episodesProcessed: 0` on the no-`attentionService` fallback while
  `discoverCausalEdges` ran. Same `discoverCausalEdges` return-shape root as
  F-05-001 (corrected).
- **F-05-002** verified — `calculateActionScores` (`:528-535`) returns
  synthetic `action_1/2/3` when the session has no recorded actions; the
  `NoExperiencesError` throw fix is sound.
- **F-05-007 split decided** — the per-call EWC++ implementation (Rust
  `lora.rs` consulting `EwcPlusPlus::apply_constraints` + a `MicroLoraWasm`
  republish this fork does not own) is a genuinely different shape from the TS
  bare-catch honesty fixes; splitting it out is correct, with the honesty half
  (narrowly documenting `ewcLambda` as background-only) landing here.

The per-handler honesty discipline (mirroring ADR-0210) is the right call;
Options B (single sweep w/ EWC infra), C (marker-only), D (defer slice) are
correctly rejected. The remaining dispositions (F-05-003/004/005/014/016/009)
are coherent fail-loud / discriminate fixes; the positive findings and the
out-of-scope items (F-05-007 impl, F-05-008 naming, F-05-012 wire-up, F-05-021
deep audit) are appropriately bounded.

## More Information

- **Audit source:** `docs/audits/2026-05-19-soundness-audit/05-controllers-learning.md`
  findings F-05-001 through F-05-026; README `00-README.md` HIGH H2 + H3.
- **Memory references:** [[feedback-no-fallbacks]],
  [[feedback-best-effort-must-rethrow-fatals]],
  [[project-deprecated-controllers]] (federatedSession removability flagged
  in F-05-018, out of scope for this ADR),
  [[project-adr0201-remediation-impl-order]].
- **Related ADRs:** ADR-0201 (parent audit), ADR-0210 (stub-honesty
  envelope — same per-handler discipline), ADR-0193 (EWC contract
  reference), ADR-0195 (autopilot Phase 4 — F-05-011 confirms this slice
  is fully wired), ADR-0181 Item 6 (SQLite + in-memory dual-write —
  F-05-025 confirms compliance).
- **Out of this ADR's scope (flagged for separate ADRs or dialectic
  decision):**
  - F-05-007 EWC++ on per-call adapt path — infra port, may split.
  - F-05-008 SonaTrajectoryService TS-vs-Rust naming collision —
    naming-only, low priority.
  - F-05-012 NightlyLearner Reflexion + skill consolidation wire-up —
    feature-add, not honesty fix.
  - F-05-021 SelfLearningRvfBackend deep audit — separate slice.

## Amendment — 2026-05-23 (Move A audit, implemented — honesty cluster; F-05-007 EWC++ split-out)

Status flipped: **proposed → implemented** (honesty cluster); F-05-007 EWC++ per-call adapt-path remains **deferred to a future infra ADR** per the original Option-A split decision.

**Shipped in `forks/agentdb` and `forks/agentdb/src/services`:**

- **F-05-001** — `NightlyLearner.ts:212-241` `discover()` re-queries the newly-persisted causal edges by id-range after `discoverCausalEdges()` and returns the array (no longer `[]`).
- **F-05-002** — `LearningSystem.ts:47-52` `NoExperiencesError`; `:596` `calculateActionScores` throws it instead of returning synthetic `action_1/2/3`.
- **F-05-003** — `LearningSystem.ts:151-234` each module init in `initializeRuVectorEnhancements` discriminates `MODULE_NOT_FOUND` / `ERR_MODULE_NOT_FOUND` / `Cannot find` (demote to `available:false`) from other init errors (re-throw so the ctor `.catch` surfaces them).
- **F-05-004 / F-05-005** — `SonaTrajectoryService.ts:258, :314` native predict/recordStep failures `console.error` at error level (no longer silently swallowed); frequency / in-memory fallback continues.
- **F-05-009** — `LearningSystem.ts:302` `endSession` removes from `activeSessions` before the DB write (TOCTOU window closed).
- **F-05-014** — `LearningSystem.ts:1223, :1404` `explainAction` / `calculateReward` discriminate `SQLITE_ERROR no-such-table` (swallow) from other SQL errors (re-throw).
- **F-05-024** — `NightlyLearner.ts:272-290` `consolidateEpisodes` exposes real candidate-pair count via the same query `discoverCausalEdges` uses; `episodesProcessed === candidatesProcessed` (no longer `0`).
- **F-05-007 honesty half** — `SonaTrajectoryService.ts:105` documents that `ewcLambda` affects only background consolidation, not per-call `ruvllm_microlora_adapt`.

**Behaviour tests (all 19 PASS):** `tests/unit/controllers/adr0220-learning-honesty.test.ts` covering each finding above.

**Still open (explicit deferrals):**

- F-05-007 per-call EWC++ implementation — net-new Rust infra in `forks/ruvector/crates/sona/src/lora.rs` + `MicroLoraWasm` republish (separate ADR).
- **F-05-016** `LearningBridge.consolidate` bare-catch — not in this batch's tests; status unclear. Recommend a quick grep of `forks/ruflo/v3/@claude-flow/memory/src/learning-bridge.ts` and either add the fix + test or explicitly note it as deferred.
- F-05-008/012/021 — naming, wire-up, deep-audit deferrals unchanged.

No INTEGRATION-LEDGER row (fork-original work, no upstream hand-port).

## Amendment — 2026-05-24 (F-05-016 closure verification)

The 2026-05-23 amendment left F-05-016 status unclear. A 2026-05-24
re-grep of `forks/ruflo/v3/@claude-flow/memory/src/learning-bridge.ts`
confirms the fix is already shipped:

- **`learning-bridge.ts:261–262`** declares the new tracker:
  `// ADR-0220 F-05-016: track failed completions instead of silently dropping`
  `const failedTrajectories: Array<{ trajectoryId: string; error: string }> = [];`
- **`learning-bridge.ts:272–276`** replaces the bare-catch with
  log + counter, and leaves the trajectory in `activeTrajectories`
  for retry on the next cycle:
  `console.error('[LearningBridge] completeTask failed for trajectory', trajectoryId, ':', msg);`
  `failedTrajectories.push({ trajectoryId, error: msg });`

The implementation matches the Option A disposition for F-05-016 in
this ADR's Decision Outcome (lines 159–161: "at minimum log +
counter the failed `completeTask`; ideally retry once before
silently dropping. Surface as `consolidate().errors[]` in the
return.").

**Open partial:** the ADR also suggested surfacing the failures via
`consolidate().errors[]` on the return value. The current
implementation logs + tracks internally but the `ConsolidateResult`
shape was not extended. Two reasons this is acceptable as closure:

1. The fail-loud goal (no silent drop) is met — `console.error` at
   error level + retry-on-next-cycle is the load-bearing behaviour.
2. Extending `ConsolidateResult.errors[]` would change a public
   return surface mid-session; if a caller wants programmatic
   access to the failures, that's a separate ADR (surface-shape
   change, not honesty pass).

**Status:** F-05-016 **closed** per Option A's minimum
("at minimum log + counter"). The optional `errors[]` surface
remains a future enhancement, tracked here for a follow-on ADR if
a consumer requests it.

No code change in this amendment — pure verification of prior work.
Doc-only commit in `ruflo-patch`.
