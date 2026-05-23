# Remediation implementation — handover (2026-05-23)

> Companion to [REMEDIATION-IMPLEMENTATION-PLAN.md](./REMEDIATION-IMPLEMENTATION-PLAN.md) and
> [COUNCIL-REVALIDATION-HANDOVER.md](./COUNCIL-REVALIDATION-HANDOVER.md). This is the
> **execution handover** — what landed, what blocks Wave 3, and what a fresh
> session needs to know to close it out.

## TL;DR

**18 / 18 ADRs implemented and validator-passed.** All 8 packages executed
with mutation-check rigor; every fix-forward was caught by an independent
validator (5 of 8 packages required at least one fix-forward — the pattern
held). Wave 2 integration cleanup landed 5 test-only commits closing 4
false-positive regressions caused by the batch's own documentary comments.

**Wave 3 (`npm run release`) blocked** at the `test:unit` step by 2 pre-batch
concurrent-writer failures (ADR-0090 A4 + ADR-0154 Phase 6b). These predate
the 0207-0224 batch and require ruvector / RVF concurrency investigation, not
test tightening.

The only deferred queen-patch in scope of this batch (the agentdb boot-crash
fix, ADR-0213 step 3) **has landed** as `forks/agentdb@d1b6145`.

## Wave 0–2 ledger (what's done)

### Implemented ADRs (18, all `proposed` → impl + validator-passed)

| Package | ADRs | Fork commits | Patch commits |
|---|---|---|---|
| A1 · controllers fail-loud | 0219, 0221 | agentdb `ebe9cc2` + `353079d` (fix-forward: vi.mock replaces prototype-override theatre) | — |
| A2 · learning honesty | 0220 | agentdb `ee5d98e` + `e54cf20` (fix-forward: F-05-003 propagation + F-05-009 order); ruflo `3880c2675` (queen-applied F-05-016 cross-fork patch) | — |
| A3 · federation cleanup | 0217 quarantine + 0222 delete | agentdb `d77d512` + `8b2863c` (fix-forward: VectorClock word-boundary regex + delete unreachable code); ruflo `5c2e43d6b` (queen-applied controller-registry.ts cleanup, 5 hunks) | `3b4c754` (INTEGRATION-LEDGER) |
| R3 · config | 0214, 0224 | ruflo `198d478e7` (23 substrate callsites + accessor + arch-test no-escape) | `6cceed6` (3 ledger rows) |
| R1 · daemon-dispatch | 0207, 0218 | ruflo `fe6f7f878` + `0799eb19f` | `9bb14f3` + `3d79688` (fix-forward: ADR-0207 state-shape + restart contract assertions) |
| R5 · hooks-cli-honesty | 0208, 0209, 0210, 0211 | ruflo `87cb68ae2` + `f9b38e85c` + `98d10e489` + `e4077b10f` (12 hook-handler dispositions + 21 self-mutations RED) | — |
| R2 · init-brand | 0212, 0213, 0223 | ruflo `3f726dcec` + `5015b016f` + `dfe8ea93a` (ADR-0213 correctly pin-the-negative; first attempt mis-stated by spawning prompt, agent flagged the spec mismatch — fresh spawn corrected) | `33997cd` + `a8e74b5` + `1fa33d6` + `328fcce` (ledger) |
| R4 · skills | 0215, 0216 | ruflo `cc3c27b41` (77 SKILL.md files reverted, 274 `$word$word` corruption tokens eliminated) + `34275c482` (`ruflo skill list` CLI + 39 SKILLS_MAP names pinned + `dual-mode/` whitelist) | `064e5da` (gate test) + `c3dc206` (acceptance group; `run_check_bg` AND `collect_parallel` parity verified) |

### Wave 0 precondition

- **ADR-0202** already implemented pre-session (`forks/ruflo@1423de031` + `80250f338`). Verified via `worker-daemon.ts:1072` calling `router.shutdownRouter()` per tick.

### Queen-applied cross-fork patches

- **A2 → ruflo F-05-016**: `forks/ruflo@3880c2675` — `learning-bridge.ts` `consolidate()` loop now logs + collects failed trajectoryIds (`ConsolidateResult.errors?`) instead of silently dropping.
- **A3 → ruflo controller-registry cleanup**: `forks/ruflo@5c2e43d6b` — 5 hunks removing dead `federatedLearningManager` references after agentdb-side `services/federated-learning.ts` deletion. Net: 61 → 60 TS errors (one `Cannot find module 'agentdb'` site removed).
- **ADR-0213 step 3 boot-fix**: `forks/agentdb@d1b6145` — `busy_timeout` added to `ALLOWED_PRAGMAS` `Set` in `src/security/input-validation.ts`. Closes the standalone `agentdb mcp start` boot crash documented in ADR-0213 (was fork-introduced via `668ce1a`, ADR-0069 A1).

### Wave 2 integration cleanup (test-only)

Five test commits resolving 4 false-positive failures the implementer agents introduced via documentary comments that tripped coarse source-grep regexes:

- `ruflo-patch@1d12e0a` — `tests/pipeline/daemon-queue-lifecycle.test.mjs` strips JS comments before the `getProjectCwd(` regex check. R5 added 2 comment-string mentions at `hooks-tools.ts:2606` + `:4032` documenting upstream's deprecated resolver; producer's actual call is `findProjectRoot()`.
- `ruflo-patch@3f2ebda` — `tests/unit/adr0084-router-phase{3,4}.test.mjs` (4 sites) skips comment lines before the `memory-bridge` import filter. Line 1900 of `hooks-tools.ts` says `// (routeMemoryOp); the upstream 'memory-bridge' import was deleted` — comment contains both `memory-bridge` AND the word `import`, tripping the bare filter. Same commit updates `adr0080-maxelements.test.mjs` P2 assertion from `provider: 'transformers.js'` to `provider: 'onnx'` per R3's ADR-0224 unification.
- `ruflo-patch@ce2d8fc` — `tests/unit/adr0181-sona-trajectory-semantics.test.mjs` tightens the silent-catch regex to single-line bodies. A2's F-05-005 catch at agentdb `SonaTrajectoryService.ts:257` has `// ...must not be silently swallowed` as documentary commentary alongside a real `console.error` call; the prior regex matched any catch containing "silent" anywhere before the closing brace. Updated to match the actual bad shape: `catch (e) { // ...silent... }` with no executable code.

All 5 commits include detailed rationale + the `// Strip comment lines — documentary references in comments are not...` pattern; future agents writing similar comment-doc tests should reuse it.

## Wave 3 blockers

Two unit-test failures halt the `npm run release` cascade at the `test:unit`
step (per ADR-0038 cascading pipeline discipline — `test:unit` fail → release
halts).

### Both pre-date the 0207-0224 batch

R1's validator (the first independent validator in the chain, with cleanest
pre-batch view) listed both failures in its pre-existing baseline. Last
touched by `forks/ruflo@5873bf6 adr-0163/0164/0165: full closure — RVF
concurrent-writer + cluster fixes`. Not introduced by this batch.

### Failure 1 — `tests/unit/adr0090-a4-rvf-concurrent.test.mjs`

```
✖ N=4 concurrent writers: lock invariants hold, at least 1 entry persists, no dangling lock
```

Spawns 4 concurrent writer processes against the same `.swarm/memory.rvf` and
asserts lock invariants hold + at least 1 entry persists + no dangling lock
file remains. Has `SKIP_ACCEPTED` for missing `RvfBackend` — the fact it
**fails** rather than **skips** means RvfBackend loads and the actual
concurrent-writer behaviour is failing. Real fork concurrency bug.

### Failure 2 — `tests/unit/adr0154-cross-process-concurrent.test.mjs`

```
✖ 6 writers × 100 entries each → 600 unique entries, no orphan numIds, no .meta
```

Spawns 6 cross-process concurrent writers ingesting 100 entries each;
asserts final count = 600, no orphan numIds (numId↔stringId map rebuilt
correctly at boot), no `.meta` artifact. Same `SKIP_ACCEPTED` pattern, same
"loads-then-fails" mode. Real fork concurrency bug.

### Investigation pointers (for the fresh session)

- These tests stress RVF's flock + native-segment loading semantics. The fix
  surface is in ruvector / RVF native code, not ruflo/agentdb JS/TS.
- Relevant ADRs to read first: 0090, 0095, 0154, 0163, 0164, 0165, 0202 (the
  per-op-lock that landed pre-session — could plausibly have shifted the
  failure mode even though the failures predate it).
- The "Phase 6b" naming on ADR-0154 + the prior series of recovery commits
  (`5873bf6`, `43e9a3f`, `93f0826`, `e543abf`, `3fac106`) suggest this is a
  long-tail concurrency issue that has been retried multiple times. A fresh
  session should expect this to be a multi-cycle investigation, not a quick
  fix.
- DO NOT mark either as `skip_accepted` — per [[feedback-skip-accepted-as-squelch]],
  these are not tool-not-found cases; they are real architectural gaps that
  must be either fixed or formally deferred to a tracked ADR.

## Wave 3 path forward

Three options, in increasing order of work:

1. **Defer Wave 3.** Treat the 2 concurrency failures as a separate ticket /
   future session. Document the implementation as complete-pending-release.
   The 18 ADRs are in source + validator-passed; the installed-artifact audit
   simply waits.
2. **Fix the 2 failures, then run Wave 3.** Real ruvector / RVF concurrency
   work in a fresh session. Then `npm run release` from `ruflo-patch` root
   per [[reference-pipeline-publish-paths]].
3. **Run Wave 3 anyway** via a deliberate test-bypass invocation. This would
   be **squelching** per [[feedback-skip-accepted-as-squelch]] / [[feedback-fix-all-tests]]
   and is **not recommended** — but if the user explicitly authorizes it for
   a snapshot release, the bypass is via the pipeline's own escape (not the
   model's unilateral choice).

### If proceeding with option 2, the Wave 3 audit checklist

Per the original plan's Wave 3 spec:

1. Confirm all forks committed (run `git -C /Users/henrik/source/forks/{agentdb,agentic-flow,ruflo,ruv-FANN,ruvector} status --short` — all should be clean of in-flight work).
2. `cd /Users/henrik/source/ruflo-patch && npm run release` — drives `scripts/ruflo-publish.sh`; rebuilds in dependency order (agentdb → agentic-flow → ruflo) from committed state, publishes to local Verdaccio, runs the acceptance suite.
3. **Per-ADR audit against the INSTALLED artifact** (fresh `ruflo init` project in `/tmp/...`, NEVER dev `node_modules` per [[feedback-inspect-installed-not-dev-nodemodules]]):
    - Every ADR's `### Confirmation` items green against the installed packages.
    - Every new acceptance check appears in BOTH `run_check_bg` AND the `collect_parallel` spec — per [[reference-acceptance-runcheck-vs-collect]], a check missing from the spec runs but is silently uncounted. R4's `skills-surface` group was verified in both during implementation; spot-check others (R5's hooks dispositions in particular).
    - Zero acceptance failures per [[feedback-fix-all-tests]].
    - No `skip_accepted` that dodges a real fix per [[feedback-skip-accepted-as-squelch]].
4. **INTEGRATION-LEDGER rows already added during implementation** — verify completeness one more time:
    - ADR-0212/0213/0223: R2 added 3 rows (commits `328fcce` + `33997cd` + `a8e74b5` + `1fa33d6`).
    - ADR-0214/0224: R3 added 3 rows (commit `6cceed6`).
    - ADR-0215/0216: R4 added 2 rows (rows 135 + 136 in commits `064e5da` + `c3dc206`).
    - ADR-0217/0222: A3 added 2 rows (commit `3b4c754`).
    - ADR-0218: R1 added 2 rows (one superseding row 94 with consumer-only finding, one new producer hand-port row; commit `9bb14f3`).
    - ADR-0219/0220/0221: no ledger rows (fork-originated; no upstream SHA to cite — A1/A2 noted this).
5. After audit passes, record each ADR's verdict to memory namespace
   `adr-batch-impl/adr-NNNN-validation` (completeness matrix + soundness
   verdict + mutation-check evidence) so "is it really done?" is answerable
   without re-deriving.
6. Move all 18 ADR statuses from `proposed` → `implemented` and update the
   `Status` line accordingly. The implementer agents did NOT flip ADR
   statuses; that's a Wave 3 finalization step.

## Validation pattern that worked (carry forward)

The mutation-check rule — **"a test that stays green under defect
reintroduction is theatre"** — caught real test theatre in 5 of 8 packages:

- **A1 ADR-0221 prototype-override theatre**: implementer monkey-patched
  `GraphDatabaseAdapter.prototype.initialize` with a hand-rolled
  re-implementation, then asserted against the override. Source was never
  exercised. Validator's mut-4 and mut-5 stayed GREEN. Fix-forward used
  `vi.mock('@ruvector/graph-node', ...)` at module scope; real `initialize()`
  runs, mock module resolves, mut-4 + mut-5 now RED.
- **A2 ADR-0220 F-05-003 + F-05-009**: tests pinned the "fix" direction only,
  not the regression direction. F-05-003 mut-3 (broaden catch to swallow all)
  stayed GREEN; F-05-009 mut-8 (move delete after UPDATE) stayed GREEN.
  Fix-forward added a `TypeError` spy injection + a call-order spy on
  `activeSessions.delete` vs `db.prepare`.
- **A3 ADR-0217 VectorClock + quicPush**: arch-tests used substring matching
  that didn't distinguish comment text from live code. Word-boundary regex
  + line-filter restored the trip-wire. Also caught 4 newly-introduced
  TS2532 errors from unreachable code below the new `throw` — deleted the
  dead bodies.
- **R1 ADR-0207 Confirmation #2 + #3 + #4**: validator caught the implementer's
  "moved coverage to pipeline test" claim was wrong — the pipeline test
  covered ADR-0218 only, not ADR-0207's state-file shape or `daemon restart`
  contract. Fix-forward added source-grep contract assertions at the
  pipeline layer (sidesteps the agentdb/archivist vitest import blocker).
- **R5 21-mutation gold standard**: implementer self-mutated every behavioural
  disposition before commit. Validator's independent re-run of 8 mutations
  found 0 theatre. This is the bar: the implementer's self-check should
  match the validator's independent check, not be a subset of it.

The pattern across all five: **implementers gravitate toward tests that pin
the fix direction; the regression direction needs explicit mutation-check
coverage**. A self-check that skips the trickier mutations leaks theatre.
The independent validator's mutation set is the soundness gate.

## File-system state at handover

All five forks (`forks/{agentdb, agentic-flow, ruflo, ruv-FANN, ruvector}`)
on `main`, working trees clean of in-flight work. `ruflo-patch` on `main`
with the in-flight pre-session dirty state (skill deletions, .swarm
artefacts, etc. — pre-batch, untouched by this work).

No pushes were made; all commits are local. Per
[[feedback-never-touch-hz-remote]] no `hz` remote was touched. Per
[[feedback-trunk-only-fork-development]] all work is on `main` (no feature
branches).

## Cross-references

- Plan: [REMEDIATION-IMPLEMENTATION-PLAN.md](./REMEDIATION-IMPLEMENTATION-PLAN.md)
- Review handover (previous phase): [COUNCIL-REVALIDATION-HANDOVER.md](./COUNCIL-REVALIDATION-HANDOVER.md)
- Sequencing memory: [[project-adr0201-remediation-impl-order]]
- Pipeline canonical paths: [[reference-pipeline-publish-paths]]
- Fork workflow: [[reference-fork-workflow]]
- Validation discipline: [[feedback-fix-all-tests]], [[feedback-skip-accepted-as-squelch]], [[feedback-no-fallbacks]], [[feedback-no-squelch-tests]]
- Per-ADR specs (with 2026-05-22 re-validation blocks):
  `docs/adr/ADR-{0207..0224}-*.md`.
