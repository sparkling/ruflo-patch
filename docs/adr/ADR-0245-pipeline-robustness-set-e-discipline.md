---
status: accepted
date: 2026-05-24
tags: [pipeline, publish, bash, set-e]
supersedes: []
depends-on: [ADR-0201, ADR-0231, ADR-0233, ADR-0236]
implements: []
---

# Pipeline robustness + `set -e` discipline (CT-L)

## Context and Problem Statement

[[ADR-0233]] §CT-C close-out landed in [[ADR-0236]] (cross-registry
scope/package-name lint at gate-0). CT-C closed the *registry-drift*
class — `F-02-001` (four hand-aligned scope registries) + `F-02-004`
(`EXTRA_WORKSPACE_DIRS` singleton).

The 02-build-pipeline-soundness audit slice has 14 total findings. After
CT-C's three covered findings (`F-02-001`/`F-02-002`/`F-02-004`), eleven
remain in the *pipeline-robustness* class — a different defect family
entirely:

1. **`F-02-003` [CRITICAL]** — `scripts/publish-verdaccio.sh:11` opens
   with `set -uo pipefail` (no `-e`). The wrapper publish at line 168
   uses `|| log "wrapper publish skipped (may already exist)"` and
   returns exit 0 even on genuine npm-publish failure (auth, network,
   malformed package.json — anything other than version-already-exists).
   Downstream acceptance pins `@sparkleideas/ruflo@latest`, which then
   tests against a stale wrapper. **This is the exact failure shape that
   `project-ruflo-wrapper-latest-regression` (MEMORY.md) burned a
   release on**, and the audit cites it as the [[ADR-0231]] wave A9
   release-regression shape.
2. **`F-02-005` [WARNING]** — `scripts/napi-rebuild.sh:242` runs
   `git pull --rebase sparkling main 2>&1 | tail -3 || true` before
   `git push sparkling main`. A swallowed rebase failure can produce a
   corrupted-but-clean tree that the push then commits to fork `main`.
   Pattern violates `feedback-best-effort-must-rethrow-fatals`.
3. **`F-02-006` [WARNING]** — three machine-pinned `/Users/henrik/...`
   absolute paths in `scripts/ruflo-publish.sh:116/131/146` (ADR-0180
   gates 2/3/4) bypass `lib/fork-paths.sh::FORK_DIR_AGENTDB` /
   `FORK_DIR_RUFLO`. Same class lives at ~9 other scripts
   (`scripts/lint-fail-loud.mjs:40`, `apply-codemod-to-fork-md.mjs:37`,
   `check-fetch-timeouts.mjs:32,34`, `check-silent-catches.mjs:41,42`,
   `check-undiscriminating-catches.mjs:44,45`,
   `check-manifest-flag-drift.mjs:51`, `check-archivist-charter.sh:18`,
   `lint-no-daemon-lock-cache.mjs:31`, `diag-rvf-inproc-race.mjs:49`,
   `assemble-timing.mjs:12`). One script
   (`scripts/audit-dynamic-imports.sh:16-18`) still uses the dead
   Hetzner `/home/claude/src/upstream/` paths — the script silently
   scans zero files today.
4. **`F-02-007` [WARNING]** — `scripts/test-acceptance.sh:285-318`
   `_cache_bust_bumped_packages` falls back to a hardcoded 5-package
   subset when `scripts/.last-bumped-packages` is missing/empty. The
   `log_error` call IS loud (audit acknowledges this), but the 5-entry
   set is itself a hardcoded subset of 60+ publishable names — any
   package outside this list with a corrupted ghost version on Verdaccio
   gets silently installed from cache on `--prefer-offline`
   standalone-acceptance runs.
5. **`F-02-008` [WARNING]** — `scripts/build-packages.sh:127` invokes
   `node "${SCRIPT_DIR}/gen-tsconfig.mjs" ... 2>/dev/null`. A
   gen-tsconfig regression looks like generic tsc fallback-level
   escalation in the build log; the actual stderr is lost.
6. **`F-02-009` [WARNING]** — `scripts/build-packages.sh:317-321`
   agentic-flow tsc tolerates non-zero exit via `--noCheck` + presence
   check on `dist/index.js`. The comment claims "256 pre-existing type
   errors" but no test asserts that count, so a real regression that
   adds error 257 (or causes partial-emit) is masked.
7. **`F-02-010` [WARNING]** — `scripts/install-runtime-externals.mjs:196-241`
   per-dep fallback collects a `skipped` array but never raises a
   non-zero exit. A real `import 'flow-nexus'` (the documented
   `aggregate.set` entry) consumer in fork source ships with no
   error-surface until runtime.
8. **`F-02-011` [NOTE]** — `scripts/copy-source.sh:53-74`
   `verify_fork_branches` explicitly documents "Non-blocking — warns on
   mismatch but never exits non-zero." A fork accidentally checked out
   to a feature branch keeps publishing whatever HEAD it's on.
9. **`F-02-012` [NOTE]** — `scripts/copy-source.sh:182` invokes
   `bundle-native-binaries.sh || log "WARN: bundle-native-binaries
   failed (non-fatal)"`. Boundary inconsistency vs napi-rebuild.sh,
   which treats NAPI commit-and-push as critical.
10. **`F-02-013` [NOTE]** — `scripts/publish.mjs:466-501`
    `publishOne` ghost-retry exhaustion returns `{ ok: false, error: ... }`
    per-package; the level collector assigns `levelFailed = result.error`,
    so multiple parallel exhaustions in the same level surface only the
    last via `createFailureIssue`. Aggregation issue, not a silent
    failure (release still fails-loud overall).
11. **`F-02-014` [NOTE]** — `scripts/ruflo-publish.sh:563-571`
    `verdaccio-gc.mjs` failure is explicitly non-fatal post-release
    (ADR-0182 L8). Documented + reasonable; listed for completeness.

[[ADR-0233]] §"Cross-cutting" §CC-02-B explicitly names "`set -e`
discipline is inconsistent" as the cross-cutting risk (15 of 17 shell
scripts use `set -euo pipefail`; two — `publish-verdaccio.sh` and
`test-acceptance.sh` — use `set -uo pipefail`). The audit recommends:

> documenting the convention in `lib/pipeline-helpers.sh` or extracting
> the manual-handling pattern into a `run_phase_norevert` helper.

§CC-02-C names the parallel machine-pinned-path problem and recommends
"A single grep + refactor pass would remove the entire class."

This ADR is the CT-L close-out for these 11 findings.

## Pre-flight verification

Per [[ADR-0201]] §"Remediation-ADR pre-flight checklist":

1. **Signal reaches its audience.** The signals fan out across three
   paths:
   - `F-02-003`: silent wrapper-publish failure surfaces eventually at
     acceptance (MCP tests against a stale wrapper), but the wrong
     stage gets blamed — operator sees acceptance regression, not a
     publish failure. **The audience for the real signal is the
     publish-stage exit code, which is dropped.** A `set -e` flip OR a
     manual `|| { log_error; exit 1 }` at line 168 reaches the right
     audience (pipeline operator) at the right phase.
   - `F-02-005`: rebase-failure → push-failure is partially audible (the
     push usually fails non-fast-forward), but the audit's "if by
     coincidence the rebase produces a clean state" path is silent. The
     audience (next-release-puller) sees a corrupted fork main commit
     with no indication of the source. A proper guard surfaces at the
     pull step, which is the right audience.
   - `F-02-006`: machine-pinned paths surface as "script silently
     scans zero files" or "directory not found" — both audible, but
     `audit-dynamic-imports.sh` (still on `/home/claude/`) PROVES the
     scan-zero-files outcome is silent in practice. Audience reached
     only if someone runs the script and notices the empty result.
   - `F-02-007` IS already loud (`log_error` with operator-actionable
     guidance). Signal already reaches audience; the fallback set is
     a code-smell, not a silent-fall.
   - `F-02-008`/`F-02-009`/`F-02-010`/`F-02-012`/`F-02-014`: each have
     `log "WARN: ..."` or `console.warn` — signal IS emitted, just
     non-fatal. Audience reached for diagnosis-after-the-fact; not
     reached for failed-release-detection.
   - `F-02-011`: branch-drift warning IS printed; operator reads on
     release. Audience reached at human-review level, not at gate
     level (which is the intent per the explicit comment).
   - `F-02-013`: error IS surfaced (single GitHub issue per level);
     just under-reported. Audience reached for the symptomatic
     package, not for all exhausted packages.

   Net: `F-02-003` + `F-02-005` + `F-02-006`/`audit-dynamic-imports.sh`
   line genuinely fail the "signal reaches audience" check. The other
   eight either reach the audience appropriately (already loud) or
   reach it at the wrong tier (warn-not-fatal) by intentional design.

2. **Upstream hasn't already decided it.** Upstream `ruvnet/ruflo/scripts/`
   has 13 scripts — none publish/verdaccio/napi/build-package equivalents
   (verified 2026-05-24). The `scripts/` tree in `ruflo-patch` IS the
   fork-only release infrastructure (`reference-pipeline-publish-paths`).
   No merge tax — upstream cannot "already-decided" how this fork
   publishes itself.

3. **Premise true at runtime.** Re-derived 2026-05-24 by direct
   `head`/`sed` of each cited file:
   - `publish-verdaccio.sh:11` — `set -uo pipefail` confirmed (no `-e`).
   - `publish-verdaccio.sh:166-170` — wrapper-publish `|| log "wrapper
     publish skipped"` confirmed.
   - `napi-rebuild.sh:242` — `git pull --rebase ... | tail -3 || true`
     confirmed.
   - `ruflo-publish.sh:116/131/146` — three `/Users/henrik/source/forks/...`
     literals confirmed.
   - `scripts/audit-dynamic-imports.sh:16-18` — still uses
     `/home/claude/src/upstream/` (the Hetzner-era path the user
     migrated away from per `feedback-never-touch-hz-remote`).
   - `test-acceptance.sh:268-318` — hardcoded 5-package fallback with
     loud `log_error` confirmed.
   - `build-packages.sh:127` — `gen-tsconfig.mjs ... 2>/dev/null`
     confirmed.
   - `build-packages.sh:317-321` — `--noCheck` + presence-check
     confirmed.
   - `install-runtime-externals.mjs:196-241` — per-dep fallback with
     `skipped` warn confirmed.
   - `copy-source.sh:53-74` (verify_fork_branches) + `:182`
     (bundle-native) confirmed.
   - `publish.mjs:466-501` — ghost-retry returns `{ok:false}` per
     package, aggregation in level collector confirmed.
   - `ruflo-publish.sh:563-571` — GC `|| log "[L8][warn] verdaccio-gc.mjs
     failed"` confirmed.
   - Survey of 28 shell scripts in `scripts/`: 19 use
     `set -euo pipefail`, 2 use `set -uo pipefail` (publish-verdaccio,
     test-acceptance — the audit's two deliberate exceptions), 1 uses
     `set -o pipefail` (run-check.sh), 1 uses `set -eu` (the wrapper
     install-git-hooks.sh). The audit's "15 of 17" is approximately
     correct; the actual count is "19 of 22 substantive scripts use
     `-euo pipefail`; 2 deliberately use `-uo pipefail` for per-phase
     manual handling; 1 lint-runner uses `-o pipefail` because it
     intentionally tolerates per-check non-zero exits and tallies; 1
     micro-installer uses `-eu` (legacy)."
   - `lib/pipeline-helpers.sh` header comment confirmed: "Sourceable
     library — no `set -euo pipefail` (caller provides)" — so a helper
     extraction is structurally feasible (the helper is already a
     sourceable library, not a subshell-executed script).

4. **No sibling-ADR overlap.** ADR-0236 (CT-C close-out) covers
   `F-02-001`/`F-02-002`/`F-02-004` (the registry-drift family). ADR-0232
   (pipeline WASM-rebuild phase) addresses `F-06-009` (a different
   slice). [[ADR-0243]] (CT-J) covers `F-10-*` long-lived process
   discipline; one finding (`F-10-002`) is conditional on CT-F
   (`v3/mcp/` deletion). No existing ADR proposes a `set -e` lint or a
   pipeline-wide path-portability check. The two deliberate
   `-uo pipefail` scripts (`publish-verdaccio.sh`,
   `test-acceptance.sh`) deserve named-exception status, not a forced
   `-e` flip.

   `feedback-best-effort-must-rethrow-fatals` (corpus rule) names the
   exact discrimination needed for `F-02-005`/`F-02-008`/`F-02-009`/
   `F-02-010`/`F-02-012` — best-effort wrappers MUST re-throw fatals.
   This ADR enforces that rule at the affected sites and pushes the
   broader cultural enforcement to a lint (option C below).

## Considered Options

### A. Per-site triage table + helper extraction in `lib/pipeline-helpers.sh`

Apply a per-site disposition row to each of the 11 findings (the same
shape [[ADR-0243]] used for CT-J). Extract a shared `run_phase_norevert`
helper into `lib/pipeline-helpers.sh` so scripts that *legitimately*
need the per-phase manual-handling pattern (`publish-verdaccio.sh`,
`test-acceptance.sh`) name their exception by sourcing the helper, not
by setting weaker shell options globally.

The helper looks like:

```bash
# lib/pipeline-helpers.sh (additions)
#
# run_phase_norevert <phase-name> <command...>
#
# Use when a phase is expected to be tolerant-of-known-soft-failures
# (e.g. "version already exists" on republish), where the CALLER will
# inspect output and decide. Re-raises any UNEXPECTED non-zero exit as
# a fatal (logs, then `return 1` so caller's set -e fires).
#
# Pattern: caller sets `set -euo pipefail`; phases that are NOT
# tolerant just run inline; phases that ARE tolerant wrap in this
# helper and pass an explicit allowlist of recoverable error strings.
run_phase_norevert() {
  local phase="$1"; shift
  local _out _rc=0
  _out="$("$@" 2>&1)" || _rc=$?
  printf '%s\n' "$_out"
  if (( _rc != 0 )) && ! _phase_error_is_recoverable "$phase" "$_out"; then
    log_error "phase ${phase} failed with non-recoverable error (rc=${_rc})"
    return "$_rc"
  fi
  return 0
}
```

**Pros:**

* Each of the 11 findings gets an explicit disposition row — operator
  can read the table and see exactly what changes.
* Helper extraction matches the audit's CC-02-B recommendation
  verbatim.
* The two deliberate `-uo pipefail` scripts get to keep their
  per-phase manual-handling, but each tolerant phase becomes an
  *explicit* `run_phase_norevert` call with a named allowlist instead
  of an implicit `|| log "..."` swallow. The discrimination
  `feedback-best-effort-must-rethrow-fatals` demands is enforced at
  the helper boundary.
* `F-02-003`'s critical wrapper-publish becomes
  `run_phase_norevert "publish-wrapper" npm publish ...` with the
  allowlist `("cannot publish over the previously published version")`
   — any other npm error fails the script.
* Low blast radius — extraction is mechanical, named-allowlist is
  per-site review.

**Cons:**

* Does NOT close the four [NOTE] findings without per-site decisions
  (which we'd have to make anyway). If we make those decisions,
  scope creeps.
* Helper adoption is opt-in until enforced — the 2 deliberate sites
  must be migrated, and future scripts must know to use it.
  (Mitigation: option C below enforces the convention via a lint.)
* Doesn't address machine-pinned paths (`F-02-006`); that's a
  separate dispatch.

### B. Restrict CT-L to CRITICAL + WARNING (6 findings); drop the 4 NOTE tail

Limit scope to `F-02-003` (CRITICAL) + `F-02-005`/`F-02-006`/`F-02-007`/
`F-02-008`/`F-02-009`/`F-02-010` (WARNING). The NOTE-tier findings
(`F-02-011`/`F-02-012`/`F-02-013`/`F-02-014`) get deferred-in-ADR per
the [[ADR-0233]] precedent for [NOTE]-tier findings.

**Pros:**

* Matches CT-A/CT-D/CT-J's pattern (cap at the WARNING tier; carry the
  NOTE-tier as "documented for completeness").
* Smaller per-site review surface; faster landing.
* The four NOTE findings have explicit comments
  (`F-02-011`: "Non-blocking", `F-02-014`: "L8 GC failure ... explicitly
  non-fatal") and are *documentation of intent*, not silent failures.
  Treating them as "no fix needed today" is honest.

**Cons:**

* `F-02-013` (ghost-retry aggregation) is a genuine diagnosability
  regression that the NOTE tier doesn't capture well — operator gets
  one GitHub issue when two packages exhausted in the same level.
* If CT-L doesn't list them at all, they leak past coverage. Deferring
  them inside the ADR (option A's approach) keeps them visible.

### C. Add `scripts/lint-set-e-discipline.mjs`

Asserts every `.sh` in `scripts/` opens with `set -euo pipefail` OR
declares its rationale via a header comment like:

```bash
# DELIBERATE: set -uo pipefail (no -e) — this script orchestrates
# per-phase manual exit-code handling; see lib/pipeline-helpers.sh
# run_phase_norevert.
set -uo pipefail
```

The lint runs at pipeline gate-0 (same surface as ADR-0236 today)
or as a `npm run lint` rider. Non-conforming scripts fail with a
citation pointing to the helper and the corpus rule.

**Pros:**

* Closes the entire class — no future script can re-introduce the
  `set -uo pipefail` deviation without acknowledging it.
* Cheap: single-file `.mjs` reading the first 10 lines of each script.
* Self-documenting: the rationale comment IS the audit trail.
* Composes with option A — the lint enforces the convention that
  option A's helper formalises.

**Cons:**

* Adds a pipeline-start lint gate; another thing to fail
  release-time. (Mitigated: lint runs in <1s; rationale comments are
  trivial to add for the 2-3 legitimate exceptions.)
* Doesn't help with non-`.sh` scripts (`F-02-008`'s `2>/dev/null`
  silencing of a `.mjs` invocation; `F-02-010`'s skipped externals are
  `.mjs`).
* On its own, doesn't fix any individual finding — it prevents *new*
  drift, doesn't remediate existing.

### D. Status quo + corpus-level reminder

Add `feedback-set-e-discipline` to memory; rely on review-time enforcement.
No code changes.

**Pros:** zero infrastructure.

**Cons:** the audit explicitly cites the wave-A9 release-regression
shape at `F-02-003`. Status quo means the next release that hits a
non-"already published" wrapper-publish failure repeats the
`project-ruflo-wrapper-latest-regression` cycle.

## Decision Outcome

Chosen option: "Option A (per-site disposition + helper extraction) + Option C (lint enforcement)", because it closes the pipeline-robustness findings per-site while a lint guards against future `set -e` regressions.

Adopt **option A (per-site disposition + helper extraction) + option C
(lint enforcement) for the CRITICAL/WARNING/NOTE set** (effectively
A+B+C, scope-merged).

This combines:

* **Per-site triage** for the 7 CRITICAL/WARNING findings — each gets
  an explicit row in the Sites table below.
* **Helper extraction** (`lib/pipeline-helpers.sh::run_phase_norevert`)
  so the two deliberate `-uo pipefail` scripts migrate their tolerant
  phases to a named-allowlist boundary.
* **Lint** (`scripts/lint-set-e-discipline.mjs`) so future `.sh`
  scripts cannot regress the convention without an explicit
  rationale comment.
* **Documented disposition** for the 4 NOTE findings — three remain
  "documented intent, no fix today"; `F-02-013` (ghost-retry
  aggregation) gets a small `createFailureIssue` per-failure tweak in
  the same commit as the helper extraction.

Option B (drop the NOTE tail entirely) was rejected because `F-02-013`
is a real diagnosability regression that the NOTE tier under-states;
the others remain in scope with explicit "documented intent" rows for
future-audit cross-reference.

The combined ADR follows `feedback-no-fallbacks` for `F-02-003` (the
wrapper-publish swallow becomes a fail-loud allowlist) and
`feedback-best-effort-must-rethrow-fatals` for `F-02-005`/`F-02-008`/
`F-02-009`/`F-02-010` (each best-effort wrapper either gains explicit
fatal re-raise or moves under `run_phase_norevert` with a named
recoverable-error allowlist).

### Concrete steps (informational, not normative)

1. Add `run_phase_norevert` + `_phase_error_is_recoverable` to
   `lib/pipeline-helpers.sh`. Migrate `publish-verdaccio.sh:166-170`
   wrapper-publish to call it with allowlist
   `("cannot publish over the previously published version")`. Same
   migration for the two other tolerant phases in that script
   (Phase 3 publish.mjs already uses manual `|| { exit 1 }`, so it's
   already explicit; Phase 6 `promote_packages || true` becomes
   `run_phase_norevert "promote-packages" "${SCRIPT_DIR}/promote-packages.sh"`
   with allowlist `("already exists")`).
2. `F-02-005`: replace `git pull --rebase sparkling main 2>&1 | tail -3 || true`
   with explicit guard:

   ```bash
   if ! git pull --rebase sparkling main 2>&1 | tail -3; then
     log_error "${fork_name}: rebase against sparkling/main failed; refusing to push"
     return 1
   fi
   ```

3. `F-02-006`: substitute `lib/fork-paths.sh::FORK_DIR_AGENTDB` /
   `FORK_DIR_RUFLO` at the 3 sites in `ruflo-publish.sh`. The 9 sibling
   sites in `check-*.mjs`/`lint-*.mjs`/`apply-codemod-to-fork-md.mjs`
   move to env-var override (`process.env.FORK_DIR_AGENTDB ?? "/Users/henrik/source/forks/agentdb"`)
   so they remain runnable on a default machine but become portable.
   The dead `audit-dynamic-imports.sh:16-18` Hetzner paths are
   re-pointed to `${FORK_DIR_RUFLO}`/`${FORK_DIR_AGENTIC}`/
   `${FORK_DIR_FANN}` (single-line bash fix).
4. `F-02-007`: out of scope — the hardcoded 5-package fallback already
   has a loud `log_error` and is documented as expected for first-ever
   releases / `--force` / standalone. Listed in Sites table as
   "documented intent (loud)". A follow-on ADR can move the fallback to
   read all `@sparkleideas/*` from Verdaccio at standalone-acceptance
   time, but that's optimization, not correctness.
5. `F-02-008`: drop the `2>/dev/null` on `gen-tsconfig.mjs` invocation
   so stderr surfaces in the build log. If a regression spams stderr,
   that's a gen-tsconfig regression worth seeing.
6. `F-02-009`: add a counter-line that runs `tsc --noEmit` (no
   `--noCheck`) against agentic-flow, captures the error count, and
   asserts `count <= 256`. If the assertion fails, the build emits
   `FAIL: agentic-flow type errors increased from 256 to N` with
   the new error count. The `--noCheck`+presence-check stays for the
   actual emit step.
7. `F-02-010`: aggregate `skipped` externals at the end of the run;
   compare against a known-unpublished allowlist
   (`config/runtime-externals-allowlist.json` — initially just
   `["flow-nexus"]` per the existing comment). Any skipped external
   NOT on the allowlist fails the install step. The allowlist is a
   thin one-key file checked into version control, reviewed when an
   external is added.
8. `F-02-011`: out of scope — already-documented "Non-blocking" per
   explicit comment and the user-stated trunk-only workflow
   (`feedback-trunk-only-fork-development`). Listed for completeness.
9. `F-02-012`: convert `bundle-native-binaries.sh || log "WARN: ..."`
   to a fatal failure. The native-binary bundle is critical (ADR-0071)
   — there's no reason to ship a release without bundled `.node` files
   and call it successful.
10. `F-02-013`: in `publish.mjs::level-collector`, change
    `levelFailed = result.error` to `levelFailures.push(result)`;
    after the level completes, iterate `levelFailures` calling
    `createFailureIssue` once per failure. Behaviour: N exhausted
    packages → N issues, not 1.
11. `F-02-014`: out of scope — explicitly non-fatal per ADR-0182 L8.
    Listed for completeness.
12. Add `scripts/lint-set-e-discipline.mjs`: read first 15 lines of
    each `scripts/*.sh`; assert one of `set -euo pipefail`,
    `set -eu`, OR (lines 1-15 contain `DELIBERATE:` AND a `set -uo` or
    `set -o pipefail` line). Fail loudly with citation otherwise.
    Wire into `npm run lint` and `ruflo-publish.sh::gate-0`.
13. Add unit test
    `tests/pipeline/lint-set-e-discipline.test.mjs` asserting current
    state passes (after migrations 1+); the test seeds a temp dir with
    a non-conforming `.sh` and asserts the lint fails on it.
14. Update `[[reference-pipeline-publish-paths]]` once helper + lint
    land.

### Consequences

* Good, because it closes the `F-02-003` CRITICAL — the exact failure shape that burned
  a release per `project-ruflo-wrapper-latest-regression`. A non-
  recoverable wrapper-publish failure now exits non-zero at the
  publish stage; downstream acceptance fails fast rather than testing
  against a stale wrapper.
* Good, because `F-02-005` rebase-then-corrupt-then-push class is eliminated.
* Good, because `F-02-006` portability bug closes at the ~12 affected sites;
  pipeline can run on a non-Henrik-MacBook machine again.
* Good, because `run_phase_norevert` helper formalises the "best-effort with named
  exceptions" pattern — future tolerant-phase additions get explicit
  allowlist review, not implicit `|| log` swallows.
* Good, because lint gates future regression at <1s pipeline cost.
* Good, because `F-02-013` aggregation fix means multi-exhaustion levels produce
  per-package issues; diagnosis is no longer truncated.
* Bad, because 12 sites touched across 6 files + 2 new files (helper extension +
  lint script). Larger diff than CT-C close-out.
* Bad, because `F-02-009` type-error baseline assertion (`<= 256`) is itself a
  hardcoded number; it's a code-smell that the audit notes
  (`reference-best-effort-must-rethrow-fatals` cautions against
  unverified counts). Defended: a CI-asserted baseline is strictly
  better than the current "comment claims 256, nothing verifies it"
  state, and the next agentic-flow upstream-sync re-baselines via
  pre-commit re-measure.
* Bad, because `run_phase_norevert` helper introduces a new abstraction; the next
  refactor wave may want to retire it if the two deliberate sites get
  per-phase `set -e` segments via subshell + `set -e` rather than
  helper indirection. (Defended: extraction is the lower-risk choice
  today; subshell-per-phase is a non-trivial restructure.)
* Bad, because allowlist file (`config/runtime-externals-allowlist.json`, single
  key today) is a new artifact; same singleton-list shape ADR-0236
  flagged for `EXTRA_WORKSPACE_DIRS`. (Defended: bounded by
  known-unpublished externals — `flow-nexus` is the only documented
  case; growth is reviewed.)
* Neutral, because the two deliberate `-uo pipefail` scripts keep their option, just
  get a header comment and migrate tolerant phases to the helper. The
  shape of the scripts doesn't change.
* Neutral, because the 4 NOTE-tier findings without a code fix remain documented in
  the Sites table for cross-reference (option A's table-row
  discipline applied).
* Neutral, because `lib/pipeline-helpers.sh` is already a sourceable library with no
  `set -euo pipefail` of its own (per its header comment); adding a
  new function is pattern-conformant.

## Sites table

| # | Finding | Sev | File:line | Disposition | Mechanism |
|---|---------|-----|-----------|-------------|-----------|
| 1 | F-02-003 | CRITICAL | `scripts/publish-verdaccio.sh:11,168` | **Fix** — wrap wrapper-publish in `run_phase_norevert` with named allowlist `("cannot publish over the previously published version")`. Same for Phase 6 promote. Keep `set -uo pipefail` + add `# DELIBERATE:` header comment. | Helper + per-phase migration |
| 2 | F-02-005 | WARNING | `scripts/napi-rebuild.sh:242` | **Fix** — replace `| tail -3 || true` with explicit `if ! pull; then log_error; return 1; fi` guard before push. | Inline guard |
| 3 | F-02-006 | WARNING | `scripts/ruflo-publish.sh:116,131,146` (+9 sibling sites) | **Fix** — substitute `lib/fork-paths.sh` exports at ruflo-publish.sh's 3 sites; switch 9 sibling scripts to `process.env.FORK_DIR_* ?? <default>`. Re-point dead `audit-dynamic-imports.sh:16-18` Hetzner paths. | Library substitution + env-var |
| 4 | F-02-007 | WARNING | `scripts/test-acceptance.sh:268-318` | **No fix today** — already loud (`log_error`), documented intent. Re-audit if standalone-acceptance bumps grow past the 5-set. | Documented intent (loud) |
| 5 | F-02-008 | WARNING | `scripts/build-packages.sh:127` | **Fix** — drop `2>/dev/null` on `gen-tsconfig.mjs` invocation. | One-line edit |
| 6 | F-02-009 | WARNING | `scripts/build-packages.sh:317-321` | **Fix** — add `--noEmit` pre-pass + baseline assertion (`<= 256`); keep `--noCheck` emit step. | Inline pre-pass |
| 7 | F-02-010 | WARNING | `scripts/install-runtime-externals.mjs:196-241` | **Fix** — aggregate `skipped`; assert against `config/runtime-externals-allowlist.json`; fail on non-allowlisted miss. | Allowlist + exit-code |
| 8 | F-02-011 | NOTE | `scripts/copy-source.sh:53-74` | **No fix today** — documented "non-blocking" + trunk-only workflow. | Documented intent |
| 9 | F-02-012 | NOTE | `scripts/copy-source.sh:182` | **Fix** — convert `|| log "WARN: ..."` to fatal; native binary bundle is critical (ADR-0071). | One-line edit |
| 10 | F-02-013 | NOTE | `scripts/publish.mjs:466-501` | **Fix** — accumulate `levelFailures`; one issue per package, not per level. | Aggregation change |
| 11 | F-02-014 | NOTE | `scripts/ruflo-publish.sh:563-571` | **No fix** — explicitly non-fatal per ADR-0182 L8. | Documented intent |
| 12 | CC-02-B | meta | All `scripts/*.sh` (28 files surveyed; 19/22/2/1/1 split) | **New lint** — `scripts/lint-set-e-discipline.mjs` enforces `set -euo pipefail` OR `# DELIBERATE:` header comment. | New lint + gate-0 wire |
| 13 | helper | meta | `lib/pipeline-helpers.sh` | **New helper** — `run_phase_norevert` + `_phase_error_is_recoverable` for explicit best-effort allowlists. | Helper extension |

Two scripts retain `set -uo pipefail` per their deliberate
per-phase manual handling — both gain `# DELIBERATE:` header comments
and migrate their tolerant phases to `run_phase_norevert`:

* `scripts/publish-verdaccio.sh` — Phase 4 wrapper-publish, Phase 6
  promote.
* `scripts/test-acceptance.sh` — `_cache_bust_bumped_packages` and
  the per-check tally loops (already use `|| true`; gain explicit
  named-recoverable list).

`scripts/run-check.sh` uses `set -o pipefail` deliberately — gains
`# DELIBERATE:` header comment, no other change.

## More information

* [[ADR-0201]] §"Remediation-ADR pre-flight checklist" — the four
  checks applied above.
* [[ADR-0231]] wave A9 release-regression shape — the exact failure
  mode `F-02-003` reproduces.
* [[ADR-0233]] §CC-02-B (`set -e` discipline cross-cutting) +
  §CC-02-C (machine-pinned paths) — the cross-cutting themes this
  ADR closes out.
* [[ADR-0236]] (CT-C close-out) — sibling: covered
  `F-02-001`/`F-02-002`/`F-02-004` (registry-drift family). This ADR
  takes the remaining 11 findings (pipeline-robustness family).
* `docs/audits/2026-05-24-second-pass-audit/02-build-pipeline-soundness.md`
  §F-02-003 (CRITICAL) + F-02-005..F-02-014 — the audit slice with
  every cited file:line.
* `feedback-best-effort-must-rethrow-fatals` — corpus rule the
  `run_phase_norevert` helper formalises (named allowlist vs.
  implicit swallow).
* `feedback-no-fallbacks` — corpus rule `F-02-003`/`F-02-010`
  enforce.
* `project-ruflo-wrapper-latest-regression` (MEMORY.md) — the
  release-burn that `F-02-003` reproduces; closing this finding
  closes that regression class.
* `feedback-never-touch-hz-remote` — corpus rule the
  `audit-dynamic-imports.sh:16-18` dead-Hetzner-path repoint honours.
* `reference-pipeline-publish-paths` — operator-facing reference to
  update once helper + lint land.
* `feedback-remediation-adr-preflight` — the pre-flight checklist
  itself.
* [[ADR-0243]] (CT-J) — sibling ADR using the same per-site-disposition
  + healthy-pattern-extraction shape (installSignalHandlersOnce, HiveLRU).
* [[ADR-0182]] §L8 — verdaccio-gc non-fatal documentation that
  `F-02-014` references.

## Swarm review (2026-05-24)

**Status**: proposed (post-swarm-review)
**Swarm**: 4 experts + devil's advocate, Quorum-majority consensus, hierarchical topology, tactical queen, queen-composed transport
**Triage rank**: 6 (per [[ADR-0233]] §Decision; wave 2 of 5)

### Decision (post-swarm-review)

Adopt the ADR as drafted (hybrid A+B+C, scope-merged) — Quorum-majority **4/4 in
favour**, devil's advocate **withdraws principled dissent** with one specific
proposal accepted by the queen. Four refinements added below; the ADR's
per-site disposition table, helper extraction, and lint gate ship as written.

### Expert positions

* **E1 — Bash set-e discipline specialist** (`set -euo pipefail` semantics; named-exception via `# DELIBERATE:`):
  votes **YES**. The "19/22 use `-euo pipefail`; 2 deliberate `-uo pipefail`; 1
  uses `-o pipefail`; 1 uses `-eu`" survey at pre-flight #3 closes the
  CC-02-B cross-cutting cleanly. Crucially, the ADR's lint template
  (`set -euo pipefail` OR `set -eu` OR `# DELIBERATE:` + `-uo`/`-o pipefail`)
  matches the actually-shipped set — the lint will pass on day one without
  refactoring the legitimate exceptions. One refinement (R1): the audit's
  "15 of 17" undercount became "19 of 22 substantive scripts" in pre-flight
  #3 only after re-scanning; the ADR's Sites-table row 12 says "28 files
  surveyed; 19/22/2/1/1 split" but doesn't enumerate the 5 scripts WITHOUT
  `set -e`. Re-grep confirms 5 scripts lack `set -e`:
  `check-no-cwd-in-handlers.sh`, `publish-verdaccio.sh`, `run-check.sh`,
  `test-acceptance-fast.sh`, `test-acceptance.sh`. The ADR names only 3
  (publish-verdaccio, test-acceptance, run-check). The lint
  implementation must whitelist `check-no-cwd-in-handlers.sh` and
  `test-acceptance-fast.sh` OR migrate them — pick one in step 12.

* **E2 — Pipeline-helper-extraction specialist** (`run_phase_norevert` in `lib/pipeline-helpers.sh`):
  votes **YES**. The helper is structurally sound: `lib/pipeline-helpers.sh`'s
  own header already declares "Sourceable library — no `set -euo pipefail`
  (caller provides)", so adding a new function is pattern-conformant — no
  set-option mutation, no nested-subshell hazard. The allowlist-based
  `_phase_error_is_recoverable` is the right shape: it forces an explicit
  decision about what "soft failure" means per phase rather than a blanket
  `|| true` swallow. Refinement (R2): the ADR's body shows
  `_phase_error_is_recoverable "$phase" "$_out"` but doesn't sketch how
  the allowlist is passed. Suggest a 3rd argument or a per-phase shell
  array (e.g. `RECOVERABLE_publish_wrapper=("cannot publish over...")`)
  resolved by name-mangling; concrete shape can be deferred to
  implementation, but the ADR should commit to "allowlist is per-call
  explicit, not a global lookup table" to prevent allowlist drift
  becoming the next ADR-0231-class registry.

* **E3 — Machine-pinned-path specialist** (Hetzner-path cleanup per `[[feedback-never-touch-hz-remote]]`):
  votes **YES**. The dead Hetzner paths in `audit-dynamic-imports.sh:16-18`
  are a textbook `feedback-never-touch-hz-remote` violation surviving as a
  latent silent-scan-zero-files bug — the script reports "audit passed"
  on a tree it never read. Re-pointing to `${FORK_DIR_*}` is unambiguously
  correct (the user migrated off Hetzner per
  `[[user_machine]]`/`[[feedback-never-touch-hz-remote]]`, no contention).
  The audit's "10 sibling sites" enumeration is faithful; the ADR's
  env-var-override pattern (`process.env.FORK_DIR_AGENTDB ??
  "/Users/henrik/source/forks/agentdb"`) preserves single-machine ergonomics
  while becoming portable. Refinement (R3): one open question — once the
  9 sibling `.mjs` lint scripts use `process.env.FORK_DIR_*`, the source
  of truth for those defaults silently shifts from `lib/fork-paths.sh`
  (bash) to per-script literal defaults. Suggest the ADR commit step 3
  to ALSO emit a node-importable `lib/fork-paths.mjs` re-export of the
  same values so the 9 sibling scripts can `import {FORK_DIR_AGENTDB}
  from '../lib/fork-paths.mjs'` rather than carry independent defaults —
  closes the registry-drift class (CT-C kinship) before it opens.

* **E4 — Lint-DX specialist** (`scripts/lint-set-e-discipline.mjs` developer friction):
  votes **YES**. The lint is genuinely cheap (<1s, reads 15 lines per
  script, ~28 scripts, ~420 lines parsed). The `# DELIBERATE:` escape
  hatch is well-shaped — it forces the deviation author to document the
  reason inline, which is the only credible long-term defence against
  "let's just remove `-e` because this `|| true` is too noisy". The
  rationale-comment IS the audit trail. Refinement (R4): suggest the
  lint also accept `# DELIBERATE-<id>:` linking back to a corpus memory
  or ADR (e.g. `# DELIBERATE-ADR-0245:`) so future audits can grep all
  exceptions and verify each still has a live justification. Cheap
  addition (one regex tweak); large long-term value. The lint's failure
  message must cite both the offending file:line AND the helper +
  corpus rule (`run_phase_norevert` +
  `feedback-best-effort-must-rethrow-fatals`) so a developer
  hitting it doesn't have to hunt for the resolution path.

* **DA — Devil's Advocate** ("Lint over discipline is more theatre — just
  fix the actual scripts" / "Helper extraction adds indirection; the
  19/22 already-conforming proves discipline works"):
  **WITHDRAWS** principled dissent with one accepted proposal. Initial
  hook 1 ("lint is theatre") was strongest argument: 19/22 conformance
  WITHOUT a lint suggests culture+review already enforce it. But the
  ADR's evidence breaks the argument — the 3 non-conforming scripts
  (publish-verdaccio, test-acceptance, run-check) PERSIST across the
  same period the 19 stayed clean, meaning culture+review is sufficient
  for greenfield scripts but insufficient for legacy carve-outs.
  Without the lint, the next time someone needs a "complex per-phase
  manual handler" they copy publish-verdaccio.sh's shape (no
  `# DELIBERATE:`, no `run_phase_norevert`), and the count quietly drifts
  to 4-of-23 then 5-of-24. The lint's <1s cost AND the
  `# DELIBERATE:` exemption-not-prohibition shape disarms the
  "theatre" framing.

  Initial hook 2 ("helper adds indirection") also withdrawn —
  `run_phase_norevert` is strictly less indirection than today's
  `|| { log "..."; }` scatter at 3-5 sites in publish-verdaccio.sh
  + 4-6 sites in test-acceptance.sh. Reading `run_phase_norevert
  "publish-wrapper" npm publish ...` at the call-site IS the
  documentation of intent; today's `|| log "wrapper publish skipped"`
  buries the intent in the error message.

  **ONE proposal held and accepted by queen (R5)**: the ADR's
  `F-02-009` baseline-error-count assertion (`tsc --noEmit` against
  agentic-flow, assert `<= 256`) is itself an
  `feedback-best-effort-must-rethrow-fatals`-adjacent code smell —
  a magic number with no test that asserts the count. Defended in
  the ADR's "Negative" consequences section, but DA's objection
  stands: when agentic-flow's next upstream-sync re-baselines via
  pre-commit re-measure, the developer might "fix" the assertion by
  just bumping the constant rather than addressing the regression.
  **Mitigation accepted**: commit step 6 also requires writing the
  current count to a checked-in `config/agentic-flow-type-error-baseline.json`
  file (single key: `{"count": 256}`) so any change to the number is a
  reviewable PR delta, not an invisible source-tree edit. The CI assertion
  reads from the JSON file. This matches the
  `config/runtime-externals-allowlist.json` shape the ADR already
  proposes for step 7 — one consistent pattern for "bounded baselines we
  re-measure on intent".

### Upstream intent

**Confirmed zero merge tax.** `ls /Users/henrik/source/ruvnet/ruflo/scripts/`
returns 13 scripts (`audit-cli-mcp-tools.mjs`, `audit-codex-integration.mjs`,
`audit-hook-commands.mjs`, `audit-plugin-packages.mjs`,
`audit-tool-descriptions.mjs`, `bulk-fix-tool-descriptions.mjs`,
`cleanup-v3.sh`, `install.sh`, `inventory-capabilities.mjs`,
`regen-witness.mjs`, `regenerate-witness.mjs`,
`sign-witness-from-inventory.mjs`, `verify-appliance.sh`).
**None publish/verdaccio/napi/build-package equivalents.**
`ls /Users/henrik/source/ruvnet/ruflo/lib/` returns "No such file or directory"
— upstream has no `lib/` tree at all. The pipeline IS fork-only infrastructure
per `[[reference-pipeline-publish-paths]]`; pre-flight #2 ("upstream hasn't
already decided it") holds unambiguously. The audit's "extracted from
test-verify.sh phases 1-5, 9" comment in `publish-verdaccio.sh:2-4` confirms
this is wholly fork-origin code.

### ADR-180+ intent

* **[[ADR-0231]] wave A9**: explicit precedent — the audit cites
  `F-02-003` as "exact failure shape that
  `project-ruflo-wrapper-latest-regression` (MEMORY.md) burned a release on"
  and references ADR-0231 wave A9 as the release-regression shape. ADR-0245
  closes the structural class wave A9 closed at a single site
  (`publish.mjs::buildPackageMap`), now extending to the publish-wrapper
  branch. Aligned.
* **[[ADR-0236]] (CT-C close-out)**: sibling — same 14-finding audit slice,
  different defect family. CT-C covered registry-drift (`F-02-001`/`F-02-002`/
  `F-02-004`); CT-L takes the remaining 11. Pre-flight #4 verified no overlap;
  ADR-0245's R3 refinement (node-importable `lib/fork-paths.mjs`) extends
  the CT-C "single source of truth" pattern to the cross-script path-default
  problem.
* **[[ADR-0226]] (writeFrame discipline)**: shape kinship — both ADRs
  formalise an idiom by giving it a named helper to prevent regression
  (`writeFrame` for stdio frames; `run_phase_norevert` for tolerant-phase
  shell calls). The "name + lint" pattern is the corpus-recommended approach
  for in-process discipline that survives author turnover.
* **[[ADR-0243]] (CT-J)**: shape sibling — both use the per-site disposition
  table + helper-extraction pattern. The ADR explicitly cites ADR-0243's
  shape as precedent.
* **[[ADR-0193]] (autopilot completion)**: kinship via the
  `feedback-best-effort-must-rethrow-fatals` rule the ADR enforces.
* **[[ADR-0186]] (INTEGRATION-LEDGER)**: not directly invoked because the
  changes are fork-local pipeline infrastructure with no upstream hand-port.
  R6 (below) addresses the bookkeeping question.

### Refinements applied

| # | Source | Refinement |
|---|--------|-----------|
| R1 | E1 | Lint scope clarification — implementation must explicitly handle the 5 scripts without `set -e` (not the 3 named in the ADR body): `check-no-cwd-in-handlers.sh`, `publish-verdaccio.sh`, `run-check.sh`, `test-acceptance-fast.sh`, `test-acceptance.sh`. Pick per-script: migrate to `-euo pipefail` OR add `# DELIBERATE:` header. Update step 12. |
| R2 | E2 | Helper allowlist contract — commit in step 1 that `run_phase_norevert`'s recoverable-error allowlist is per-call explicit (3rd argument or per-phase array), not a global lookup table. Prevents allowlist drift becoming a new registry-drift class. |
| R3 | E3 | Cross-script path-default unification — step 3 also emits a node-importable `lib/fork-paths.mjs` re-exporting `FORK_DIR_*` so the 9 sibling `.mjs` scripts import from one source instead of carrying independent defaults. Composes with CT-C's single-source-of-truth pattern. |
| R4 | E4 | Lint citation discipline — accept `# DELIBERATE-<id>:` (linking to ADR or corpus memory) so future audits can verify each exemption has a live justification. Lint failure messages MUST cite both file:line AND the helper + corpus rule. |
| R5 | DA | Baseline-as-data — step 6's `<= 256` agentic-flow type-error assertion reads from a checked-in `config/agentic-flow-type-error-baseline.json`, matching the `config/runtime-externals-allowlist.json` shape step 7 proposes. Any bump is a reviewable PR delta, not an invisible source-tree edit. |
| R6 | Queen | INTEGRATION-LEDGER discipline — no row needed (fork-local pipeline infra, no upstream hand-port). Explicitly noted per `[[feedback-update-integration-ledger]]` to prevent the "missing-row" audit at next sync. |

### Top risk + mitigation

* **Risk**: helper extraction + lint + 12 site fixes + 2 new files (~6 files
  touched, 2 created) is the largest single ADR in the CT-L/M/N batch.
  Landing this without a behavioural acceptance check means the lint
  passes day-one (current state IS conforming after the ADR's migrations)
  and the helper is invoked at exactly 2-3 sites (publish-verdaccio.sh
  phases 4 + 6) — a future revert that loosens `set -uo` somewhere else
  passes the lint via a copy-paste `# DELIBERATE:` header with no
  meaningful justification. Same failure shape ADR-0240 §"Top risk"
  identifies (lint-without-acceptance-check pattern).
* **Mitigation**: per ADR-0240's accepted shape — register the lint as
  an acceptance-tier check (not just `npm run lint` rider), and add a
  behavioural acceptance check that PROVES `run_phase_norevert` is
  actually invoked at the 2-3 expected sites (not bypassed via a
  copy-paste of the old `|| log "..."` pattern). Concrete: a
  source-shape acceptance check that greps the 2 deliberate scripts for
  zero remaining `|| log` swallows in their tolerant-phase blocks, and
  asserts each tolerant phase routes through `run_phase_norevert`. This
  matches the [[ADR-0215]] golden-master pattern and closes the
  copy-paste loophole the DA's first dissent hook surfaced.
