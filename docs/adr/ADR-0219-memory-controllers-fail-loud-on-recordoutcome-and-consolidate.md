---
status: proposed
date: 2026-05-20
tags: [memory, controllers, fail-loud, no-fallbacks, agentdb, audit-followup]
supersedes: []
depends-on: [0201]
implements: []
---

# Memory controllers fail-loud on `recordOutcome` and `consolidate`

> **Reviewed directly (2026-05-22).** Drafted from the ADR-0201 audit's
> `04-controllers-memory.md` findings cluster that the original 0202–0218
> batch did not cover. All three findings were verified against the live
> agentdb source and Option A confirmed, with minor precision corrections;
> see *Direct review* below.

## Context and Problem Statement

The ADR-0201 audit's slice 04 (`docs/audits/2026-05-19-soundness-audit/04-controllers-memory.md`)
found three independent silent-fallback / partial-report bugs inside the
otherwise-sound memory-controller layer (`forks/agentdb/src/controllers/`).
None of these were addressed by the 0202–0218 remediation batch — they
share a [[feedback-best-effort-must-rethrow-fatals]] / [[feedback-no-fallbacks]]
shape but live on a surface (memory controllers) the original batch did not cover.

The three findings, with file:line evidence:

- **F-04-001 [HIGH]** — `forks/agentdb/src/controllers/ReasoningBank.ts:559-578`
  + `:534-541`. `recordOutcome` calls `updatePatternStats(patternId, …)`
  (void-returning) and then `getPattern(patternId)`. If the row was deleted,
  the `UPDATE` matches 0 rows, `getPattern` returns null, and the learning
  sample is silently skipped — `recordOutcome` returns `Promise<void>` with
  no signal. The audit ruled out the "success_rate formula bug" rumour (SQL
  evaluates RHS pre-update; the running mean is correct); the real defect is
  the missing precondition check.
- **F-04-002 [HIGH]** — `forks/agentdb/src/controllers/MemoryConsolidation.ts:380-384`.
  `createSemanticMemory` computes `weightedImportance / totalAccess` with no
  zero guard. With a default `minAccessCount: 3` the filter prevents the
  divide today; lowering it via `ConsolidationConfig` (tests, manual
  consolidation) trips a `NaN` into the stored importance and corrupts all
  downstream retention/sorting math.
- **F-04-003 [HIGH]** — `forks/agentdb/src/controllers/MemoryConsolidation.ts:252-256`.
  `consolidate` wraps all of steps 1–7 in a single outer `try { … } catch (error) { console.error(…); report.executionTimeMs = …; return report; }`.
  Any fatal (DB lock, embedding-service crash, vector-backend unavailable)
  returns a partially-filled `ConsolidationReport` that the caller treats as
  success — direct violation of [[feedback-best-effort-must-rethrow-fatals]].

These three are surface manifestations of the same pattern: best-effort
wrappers that do not discriminate fatal from recoverable. They share the
deletion-target-missing / divide-by-zero / catch-all-and-return shapes that
the audit's other clusters (hooks F-01/F-02/F-03, federation F-06) also
expose, and that the existing batch (ADR-0210 stub-honesty mandate, ADR-0209
no-fallbacks gate) addressed at those surfaces.

## Decision Drivers

- [[feedback-no-fallbacks]] — silent fallbacks mask broken features at the data layer.
- [[feedback-best-effort-must-rethrow-fatals]] — best-effort wrappers must discriminate fatal from warning.
- ADR-0210's per-handler discipline (Option B′) is the established pattern for "audit found a stub-shaped bug; decide per call-site" and should apply here too.
- Memory layer is the broadest blast radius — `ReasoningBank.recordOutcome` is on the learning hot path (ADR-0112); `MemoryConsolidation.consolidate` is invoked by the nightly learner. Silent failure here propagates as bad learning + corrupted retention.
- These three are CRITICAL/HIGH per the audit; the README assigns CRITICAL #16/#17 (F-04-001, F-04-003) and HIGH H1 (F-04-002).

## Considered Options

- **Option A — Per-handler fail-loud fix (chosen).** Three surgical edits:
  (a) `updatePatternStats` returns `{ changes: number }`; `recordOutcome`
  throws (or returns `Result.err`) when `changes === 0`; (b) divide-by-zero
  guard in `createSemanticMemory` (fall back to the already-computed simple
  average at line 335); (c) move `consolidate`'s outer catch INSIDE the
  per-cluster loop so a single failed `createSemanticMemory` is caught
  locally but a fatal at the orchestration level re-throws. Mirrors ADR-0210's
  shape: targeted, no new abstraction.
- **Option B — Typed `Result` discriminator across all three return types.**
  Introduce `MemoryOpResult<T> = { ok: true; value: T } | { ok: false; error: MemoryFatal | MemoryRecoverable }`.
  Refactor all three call-sites + all consumers to handle the discriminator.
  Rejected: re-shapes the public surface for a fix that doesn't need it; the
  three call-sites have different consumers and a unified type would force
  rewrites of ReasoningBank's learning-backend dispatch, the nightly learner,
  and the controller-registry forwarding.
- **Option C — Document as known-limitations, add `_stub`/`_note` markers**
  on the swallowed branches (the ADR-0210 marker-only fallback). Rejected:
  marker-only is the disposition for surfaces with no real fix (e.g.
  `hooks_notify` with no delivery backend); these three have obvious real
  fixes (Option A). Markers would be theatre.
- **Option D — Defer to a broader "memory controller fail-loud sweep"
  covering F-04-001 through F-04-009.** Rejected scope-creep: bundles HIGH
  + LOW findings with different shapes (F-04-005 unwired HNSWIndex,
  F-04-009 CausalRecall SQL fallback by-recency-not-similarity are
  different problems). The three HIGH findings are the focused unit; the
  MEDIUM/LOW siblings (F-04-004 EmbeddingService mock fallback, F-04-006
  MemoryController.search ignores VectorBackend) belong in their own ADRs
  or as scope-extensions during the dialectic.

## Decision Outcome

**Chosen: Option A — per-handler surgical fail-loud edits, mirroring ADR-0210's per-handler discipline.**

The three findings share a pattern (best-effort wrapper swallows fatal) but
not a fix shape — each call-site needs a different micro-change:

1. **F-04-001 fix** — `updatePatternStats` signature change to return
   `{ changes: number }` (better-sqlite3's RunResult exposes this directly);
   `recordOutcome` throws `PatternNotFoundError` when `changes === 0`. The
   learning-backend `recordOutcome` consumer (ReasoningBank line 568-577) is
   already wrapped in a `try { … } catch { … }` by its caller in the live
   learning loop, so the loud failure propagates without breaking the
   caller's batch tolerance. Per [[feedback-no-fallbacks]].
2. **F-04-002 fix** — Guard
   `const meanImportance = totalAccess === 0 ? cluster.avgImportance : weightedImportance / totalAccess;`
   reusing `cluster.avgImportance` (the simple mean already computed during
   clustering at `:335`), NOT a bare local `avgImportance`. One-line change.
3. **F-04-003 fix** — Move the outer try/catch from the orchestration
   wrapper into the per-cluster loop inside `consolidate`. A single failed
   `createSemanticMemory` for one cluster is caught and reported as a
   per-cluster error in the report; an outer fatal (`embedder.embed` throws,
   DB lock, etc.) re-throws so the caller sees `Promise.reject` rather than
   a half-filled report. Per [[feedback-best-effort-must-rethrow-fatals]].

### Consequences

- Good, because three silent-corruption paths at the learning + retention
  hot path become observable failures.
- Good, because the pattern matches ADR-0210's discipline — the codebase
  gains one more surface where "fail loud or document the limitation
  explicitly" is the rule.
- Good, because no new abstraction (no Result type, no error taxonomy) —
  uses idiomatic `throw` + `Promise.reject`.
- Bad, because consumers that previously silently absorbed the lost
  outcome / NaN importance / partial report will now see thrown errors and
  may need defensive handling. Mitigated by the audit's evidence that the
  ReasoningBank learning path's outer caller already wraps in try/catch.
- Neutral, because the three fixes are independent and can ship as one PR
  or three.

### Confirmation

1. **Unit test (F-04-001):** delete a pattern; call `recordOutcome` against
   its ID; assert `PatternNotFoundError` is thrown (or `Result.err` returned).
2. **Unit test (F-04-002):** construct a cluster with all members at
   `accessCount: 0`; call `createSemanticMemory`; assert the stored
   importance is the simple `avgImportance`, NOT `NaN`.
3. **Unit test (F-04-003):** inject a forced throw inside the loop body
   (per-cluster) and assert the report carries a per-cluster error but
   completes; inject a forced throw at the orchestration boundary (e.g.
   `embedder.embed` throws) and assert `consolidate` rejects.
4. **Grep guard:** the existing `check-fabrication.mjs` advisory (ADR-0210
   §Confirmation) should NOT fire on these three files post-fix; they were
   not the original target, but the fix should pass the same hygiene.
5. **`npm run release`** acceptance group `p3` and any agentdb-side
   memory/consolidation tests pass unchanged.

## Pros and Cons of the Options

### Option A — per-handler fail-loud fix

- Good, because each fix is local and minimal.
- Good, because mirrors ADR-0210's already-validated discipline.
- Bad, because three call-sites — three reviews, three test cases.

### Option B — typed `Result` discriminator

- Good, because consumers gain compile-time fatal-vs-recoverable
  discrimination across the memory layer.
- Bad, because the refactor blast radius extends far beyond the audit's
  three findings.
- Bad, because two of the three fixes (the divide-by-zero guard, the loop
  scope change) don't need a Result type at all.

### Option C — marker-only

- Bad, because the fix is obvious; markers would be theatre.
- Bad, because ADR-0210's marker disposition is reserved for surfaces with
  no real backend (e.g. `hooks_notify` cross-agent delivery); these three
  have real fixes.

### Option D — broader sweep including F-04-004 / F-04-006 / etc.

- Bad, because mixing the HIGH cluster with LOW siblings dilutes review
  focus and bundles different fix shapes.
- Bad, because the [[project-adr0201-remediation-impl-order]] rule has been
  "one ADR per cluster pattern" — F-04-004 (EmbeddingService mock fallback)
  is its own different-shape decision (mock-as-fallback policy), F-04-006
  (MemoryController.search ignores VectorBackend) is an
  incomplete-wiring fix.

## Direct review (2026-05-22)

Reviewed directly by the reviewer (not via swarm) against the live agentdb
source. **Verdict: Option A confirmed; minor precision corrections.** All three
findings reproduce exactly:

- **F-04-001** verified — `updatePatternStats` (`ReasoningBank.ts:529-547`) is
  void and runs the `UPDATE` with no rows-affected check; `recordOutcome`
  (`:559-578`) then calls `getPattern` → if the row was deleted the UPDATE
  matches 0 rows, `pattern?.approach` short-circuits, the sample is dropped,
  and `Promise<void>` returns with no signal. The audit's "formula-bug ruled
  out" also holds: the UPDATE's RHS references pre-update `uses`, so the
  incremental mean is correct. The `{changes}` fix is feasible —
  `RunResult.changes` is already used in this file (`:655`).
- **F-04-002** verified — `createSemanticMemory` (`:380-384`) divides
  `weightedImportance / totalAccess` with no zero guard; `minAccessCount:3`
  (`:112`) masks it today via the candidate query (`:269`). Correction folded
  in: the fallback is `cluster.avgImportance` (set at `:335`), not a bare local
  `avgImportance`.
- **F-04-003** verified — `consolidate` (`:166`) wraps all steps in one outer
  `try` (`:182`) whose `catch` (`:252-255`) returns a partial
  `ConsolidationReport`; a fatal (DB lock, `embedder.embed` throw) is reported
  as success. The fix (per-cluster `try` around `createSemanticMemory` at
  `:208`; outer fatal re-throws) is sound.

The decision (per-handler fail-loud, mirroring ADR-0210) is the right call — no
new abstraction, each fix local. Options B (Result type), C (marker-only), and D
(broad sweep) are correctly rejected; the scope boundary (F-04-004/006 deferred)
is appropriate. Note: the ADR's `:534-541` citation for F-04-001 points at the
inner `UPDATE` SQL; the enclosing `updatePatternStats` is `:529-547`.

## More Information

- **Audit source:** `docs/audits/2026-05-19-soundness-audit/04-controllers-memory.md`
  findings F-04-001 / F-04-002 / F-04-003 (HIGH cluster); README
  `00-README.md` CRITICAL #16 / #17 / HIGH H1.
- **Memory references:** [[feedback-no-fallbacks]],
  [[feedback-best-effort-must-rethrow-fatals]],
  [[project-adr0201-remediation-impl-order]].
- **Related ADRs:** ADR-0201 (parent audit), ADR-0210 (stub-honesty
  envelope — same per-handler discipline), ADR-0209 (no-fallbacks
  arch-test — runtime smoke test pattern), ADR-0112 (ReasoningBank
  explicit-target — the learning consumer of `recordOutcome`).
- **Adjacent findings (out of this ADR's scope — flagged for separate
  decision):** F-04-004 (EmbeddingService mock-fallback on init failure,
  HIGH README H6), F-04-006 (MemoryController.search ignores VectorBackend,
  HIGH README H7). Both share the silent-fallback shape but have different
  fix shapes (mock-policy decision; backend-delegation refactor); they
  belong in their own ADRs or scope-extensions during this ADR's dialectic.
