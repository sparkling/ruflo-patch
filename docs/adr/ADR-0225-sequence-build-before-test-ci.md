---
status: implemented
date: 2026-05-21
accepted-on: 2026-05-21
implemented-on: 2026-05-21
tags: [ci-cd, pipeline, build, testing, race-condition, ruflo-publish]
supersedes: []
depends-on: []
implements: []
---

# Sequence build before test-ci in the publish pipeline

## Context and Problem Statement

The publish pipeline (`scripts/ruflo-publish.sh`) ran the unit test phase **in parallel** with the build phase:

```sh
run_phase "copy-source" copy_source     # /tmp/ruflo-build ← fresh fork SOURCE (.ts)
run_phase "codemod" run_codemod          # scope-rename in place
run_phase "test-ci" run_tests_ci &       # preflight + unit tests — BACKGROUND
run_phase "build" run_build              # build-packages.sh compiles .ts → dist/.js IN PLACE
wait "$_test_pid"
```

But **~15 unit tests load the built `/tmp/ruflo-build` dist artifact** — e.g. `bug4-storage-init-concurrent.test.mjs` imports the compiled native `rvf-backend.js`; others resolve `/tmp/ruflo-build/dist/v3/@claude-flow/**/*.js`. Running `test-ci` concurrently with `build` means those tests read a tree the build is **simultaneously rewriting**: either the previous release's dist (stale), a half-written file (torn), or a mixed-vintage set of artifacts.

Two concrete failure modes:

1. **Stale-validation.** When `copy-source`'s incremental rsync preserves the prior release's dist, `test-ci` validates *last release's* compiled code, not the code being shipped. Green test-ci does not prove the artifact being published is correct.
2. **Chicken-and-egg (the forcing function).** When a fix changes compiled behavior AND ships its own regression test, that test can never go green: `test-ci` runs against the pre-build (old) dist, fails on the old behavior, and aborts the pipeline *before* `build` produces the fixed dist. The fix is structurally unshippable. This blocked the ADR-0167 `loadFromDisk` RVFR-prefix fix, whose `bug4` regression needs the newly-built `rvf-backend.js`.

This is independent of any single test — it is a pipeline-ordering defect: **a phase that consumes the build output was scheduled concurrently with the build that produces it.**

## Decision Drivers

* **Determinism** — tests must validate the exact artifact being published, not a stale or mid-build one.
* **No silent fallbacks** ([[feedback-no-fallbacks]]) — "usually passes because the prior dist happened to be fine" is luck, not correctness.
* **Shippability** — a correct fix plus its regression test must be able to go green in one pipeline run.
* **Minimal disruption** — keep the existing phases, helpers, and abort semantics; change only ordering.
* **Cost awareness** — the parallelism was a wall-clock optimization; the build is the long pole, so serializing adds only ~test-ci duration (~30s), an acceptable price for correctness.

## Considered Options

* **Option A — Sequence `build` before `test-ci`.** Remove the `&`; run build to completion, then test-ci against the finished dist.
* **Option B — Split the suite:** keep pure (mocked, source-introspection) unit tests parallel with build; move only artifact-dependent tests to a post-build phase.
* **Option C — Make artifact-dependent tests hermetic:** each builds its own minimal fixture instead of reading `/tmp/ruflo-build`.
* **Option D — Move artifact-dependent tests to the acceptance phase** (already post-build, against published packages).

## Decision Outcome

Chosen: **Option A — sequence `build` before `test-ci`.**

```sh
run_phase "copy-source" copy_source
run_phase "codemod" run_codemod
run_phase "build" run_build
write_build_manifest
run_phase "test-ci" run_tests_ci
```

Rationale: it fixes the defect for *all* artifact-dependent tests in one move, preserves every phase's behavior and the existing fail-fast abort, and costs only the lost build/test overlap (~30s; build is the long pole). Options B/C are larger refactors (15 tests / per-test fixtures) that can be pursued later if pipeline wall-clock becomes a constraint; Option D mis-files tests that are genuinely unit-scoped (they assert on a single compiled module, not an end-to-end install). A is the proportionate, correct fix; B/C/D are not precluded as future optimizations.

### Consequences

* Good, because `test-ci` now validates *this* release's complete, consistent dist — green means the published artifact is the tested one.
* Good, because a fix and its regression test can go green in a single run (chicken-and-egg removed).
* Good, because torn-read / mixed-vintage-artifact flakiness in the ~15 dist-loading tests is eliminated.
* Bad (minor), because total pipeline wall-clock increases by roughly the test-ci duration (the build/test overlap is lost). Acceptable per Decision Drivers.
* Neutral, because the `bug6` stale-`.tsbuildinfo` protection (rsync `--exclude='*.tsbuildinfo'` on the fork side + `--filter='P .tsbuildinfo'` protect on the dest) and per-package smart invalidation are unchanged — incremental builds still apply; only phase ordering changed.

### Confirmation

* `scripts/ruflo-publish.sh` contains no `run_tests_ci &` (no backgrounded test phase) and `run_phase "build"` precedes `run_phase "test-ci"`. (grep guard candidate for `preflight`.)
* A release in which a compiled-behavior fix ships with its regression test reaches `publish-verdaccio` green in one run (demonstrated by the ADR-0167 `loadFromDisk` fix + `bug4`/`adr0167-loadfromdisk-native-magic` tests).
* No `skip_accepted` on the affected tests ([[feedback-skip-accepted-as-squelch]]).

## Direct review (2026-05-22)

Verified shipped: `scripts/ruflo-publish.sh` runs `copy-source → codemod →
build → write_build_manifest → test-ci` with **no** backgrounded
`run_tests_ci &` (`:509-522`) — exactly the Option A ordering, so the build
completes before test-ci reads `/tmp/ruflo-build/dist`. Status `implemented`
is accurate; structure (nested `### Consequences`/`### Confirmation`) and the
Confirmation match the shipped pipeline. No corrections.

## More Information

* **Surfaced by** ADR-0167 amendment 2026-05-21 (JS `loadFromDisk` RVFR-prefix fix) — the fix that exposed the chicken-and-egg.
* **Pipeline cascade** — ADR-0038 (cascading test pipeline) defines the `preflight → pipeline → unit → … → acceptance` layering; this ADR refines *where* the build sits relative to the unit layer in the publish orchestration.
* **Related** — `bug6-tsc-incremental-cache-wipe` (stale `.tsbuildinfo`), `build-packages.sh` per-package smart invalidation.
* Memory: [[reference-pipeline-publish-paths]] (single entrypoint `npm run release`), [[feedback-no-fallbacks]], [[feedback-no-squelch-tests]].
