## ADR-0236 — CT-C: cross-registry scope/package-name lint

**Status**: proposed (post-swarm-review)
**Swarm**: 4 experts + devil's advocate, Weighted consensus (queen ×3; denominator `(N-1)+3 = 7`), hierarchical topology, tactical queen, queen-composed transport
**Triage rank**: 8 (per [[ADR-0233]] §Decision; wave 3 of 5)

### Decision (post-swarm-review)

Adopt **Option A — pipeline-start cross-registry pairwise lint at gate-0** as
originally drafted, with eight refinements applied. Weighted-vote **+7/7**
(queen +3, all 4 experts +1 each); devil's advocate **HOLDS** principled
dissent on hook 1 (lint-is-theatre) but accepts queen's commitment to schedule
Option B as the next-pass remediation (R6); WITHDRAWS hook 2 (gate-0 softness)
on the strength of R4's 2-commit TDD discipline. Per-site disposition table,
pairwise checks list, and gate-0 invocation ship as written. The today-live
`agentic-jujutsu` drift (verified: present in `codemod.mjs:53::UNSCOPED_MAP`,
absent from `fork-version.mjs:49-58::UNSCOPED_PUBLISHABLE`, real publishable
package at `forks/agentic-flow/packages/agentic-jujutsu/package.json`) ships
as the test's first asserted GREEN case in commit-2.

### Implementation steps

The ADR's concrete steps 1-5 stand, with these refinements applied:

1. **Step 1 (named exports)**: export `SCOPES` + `UNSCOPED_PUBLISHABLE` from
   `scripts/fork-version.mjs`. Preserve internal usage; named exports only.
2. **Step 2 amended (R5)**: create `scripts/lint-scope-registries.mjs`. Every
   fail-loud message MUST cite (a) offending registry's file:line + symbol,
   (b) the registry it should agree with (file:line + symbol), (c) suggested
   fix (e.g. "add `agentic-jujutsu` to `UNSCOPED_PUBLISHABLE`" or "remove
   from `UNSCOPED_MAP`"), (d) corpus rule citation
   (`[[feedback-no-fallbacks]]` + ADR-0231 wave-A9 §Lesson #2 quote).
   Self-resolving from message alone; no ADR re-read required at release time.
3. **Step 3 amended (R2)**: add gate-0 call as the FIRST executable line
   after `set -euo pipefail` + `lib/*` sourcing in `scripts/ruflo-publish.sh`
   — BEFORE Phase 0's `verify_fork_branches` step. Fail-fast: drift caught
   before any pipeline state change.
4. **Step 4 amended (R4)**: 2-commit TDD sequence — commit-1 lands the lint
   script + unit test at `tests/pipeline/lint-scope-registries.test.mjs`
   asserting current-state drift (test fails RED on the
   `agentic-jujutsu` miss); commit-2 lands the `UNSCOPED_PUBLISHABLE` fix
   adding `'agentic-jujutsu'` to the Set, test passes GREEN. Discipline
   surfaces the drift in git history for future audits; relies on
   `[[feedback-no-history-squash]]` (already corpus-enforced).
5. **Step 5 (documentation)**: update `[[reference-pipeline-publish-paths]]`
   to name the gate-0 invariant, and add a head comment in
   `lib/pipeline-helpers.sh` cross-referencing the lint.
6. **New pairwise check #6 (R1)**: `build-packages.sh::_v3_packages` bash
   literal at `:187-191` MUST equal the inline JS `v3set` at `:200-205`
   (intra-file drift, same shape as cross-file drift). Cheap (one extra
   parse pass in the lint script), closes the same-file drift class
   E1 surfaced.
7. **Option A rationale appended (R3)**: Decision §"Option A" explicitly
   names scope-rename-at-source as the wave-A9-lesson-#2 alternative and
   rejects it because 6 of 11 drift-prone unscoped names
   (`ruvector-core-*-{darwin,linux,win32}-*`,
   `ruvector-attention-{wasm,unified-wasm}`, `ruvllm-wasm`) come from
   `napi-rs` / `wasm-pack` generated `package.json` files — rename at
   source would require hand-editing or post-processing every regeneration.
   Lint catches drift without touching generator output.
8. **Option B re-eval cadence (R6)**: Decision §"Defer option B" amended
   to "next remediation pass — CT-C round 2", not the 90-day window. The
   two recorded drift instances (wave A9 `ruvllm-wasm` + today's
   `agentic-jujutsu`) already meet the implicit threshold. Queen commits
   to follow-up cadence as a soft commitment (Weighted-vote pipeline-owner
   authority).
9. **INTEGRATION-LEDGER row not needed (R7)**: fork-local pipeline
   infrastructure with no upstream hand-port. Explicit note per
   `[[feedback-update-integration-ledger]]` to prevent "missing-row"
   audit at next sync.
10. **DA's recorded forcing function (R8)**: if `agentic-jujutsu` is the
    only drift the lint catches in the first 90 days, queen still owes
    Option B at the next pass regardless of lint-fire frequency. Recorded
    as soft commitment; not a Decision change.

### Dependencies

- [[ADR-0231]] wave A9 — defect-class origin. The eighth amendment (2026-05-24)
  fixed `publish.mjs::buildPackageMap` with the fail-loud-on-duplicate-name
  idiom; "Lessons for the corpus" #2 names this ADR's exact remit. ADR-0236
  is the systematic follow-up turning the lesson into a release gate.
- [[ADR-0215]] — codemod golden-master, the analogous test-gate for codemod
  output drift. Same shape: cheap read-only check at pipeline start, fail-loud
  on drift, no `UPDATE_GOLDEN`-style operator-accept path.
- [[ADR-0245]] (CT-L sibling) — adjacent pipeline-lint ADR on the same audit
  slice. CT-L took the registry-drift family's path-default cousin
  (R3 `lib/fork-paths.mjs` node-importable single-source); CT-C took the
  name-registry family. The two ADRs compose: both ship lints gating the
  same `ruflo-publish.sh` entrypoint.
- [[ADR-0233]] §CT-C — defect-class origin citing `F-02-001` (CRITICAL) +
  `F-02-004` (WARNING).
- [[ADR-0201]] — Remediation-ADR pre-flight checklist (all 4 checks pass per
  ADR §"Pre-flight verification": signal reaches pipeline operator at
  gate-0; upstream not decided — pipeline is fork-only infra; premise true
  at runtime per direct grep verification of today's `agentic-jujutsu`
  drift; no sibling-ADR overlap with the wave-A9 `buildPackageMap` fix
  which is narrowly publish.mjs-scoped).
- [[ADR-0095]] §amendment 2026-05-23 — same "fail-loud over silent fallback"
  idiom precedent (removed pure-TS fallback in `rvf-backend.ts`).
- [[ADR-0143]] — brand-rebrand archeology; the unscoped names this ADR
  catalogues (`ruflo`, `claude-flow`, etc.) intersect Pass 7 scope but
  belong to the publishability axis, not the brand axis.

### Validation

- **Source-shape (today's drift)**: `grep -n "agentic-jujutsu"
  scripts/fork-version.mjs scripts/codemod.mjs` returns exactly one hit
  (codemod.mjs:53), confirming the drift the lint catches.
- **Source-shape (post-fix)**: after commit-2, `grep "agentic-jujutsu"
  scripts/fork-version.mjs` returns one hit inside the
  `UNSCOPED_PUBLISHABLE` Set literal.
- **Source-shape (lint exists)**: `scripts/lint-scope-registries.mjs`
  exists, is `node --test`-importable, exports a `lintAll()` function
  returning `{ passes: [...], failures: [{ registry, expected, found, fix }] }`.
- **Source-shape (gate-0 wired)**: `grep -nB 2 -A 5 "lint-scope-registries"
  scripts/ruflo-publish.sh` returns a hit BEFORE the `verify_fork_branches`
  call (Phase 0).
- **Behavioural (acceptance-tier)**: a synthetic addition of `'demo-pkg':
  '@sparkleideas/demo'` to `codemod.mjs::UNSCOPED_MAP` followed by
  `bash scripts/ruflo-publish.sh --dry-run` exits non-zero with an error
  message naming both files, both line numbers, and the suggested fix.
- **Behavioural (TDD discipline)**: `git log --oneline scripts/lint-scope-registries.mjs
  scripts/fork-version.mjs` shows a 2-commit sequence (lint+test first,
  fix second) — not squashed.
- **Behavioural (acceptance check survives gate-0 regression)**: an
  acceptance-tier check independently invokes
  `node scripts/lint-scope-registries.mjs` against current state, so a
  future regression that removes the gate-0 call from
  `ruflo-publish.sh` still fails the release.
- No `skip_accepted` per `[[feedback-skip-accepted-as-squelch]]`.

### Top risk + mitigation

- **Risk**: same shape as ADR-0240 and ADR-0245
  (lint-without-acceptance-check pattern). The lint script exists, gate-0
  is wired, but a future regression — someone moves the lint call below
  Phase 0 or comments it out during a debug pass — silently de-activates
  the gate. Pre-flight #1 trap shape ("signal reaches audience").
  Compounded here because gate-0 is `ruflo-publish.sh`'s entrypoint —
  there's no upstream gate above it.
- **Mitigation**: per ADR-0240's accepted shape — register the lint as
  an acceptance-tier check (not just `ruflo-publish.sh` invocation). The
  acceptance check (a) boots `bash scripts/ruflo-publish.sh --dry-run` and
  confirms the gate-0 log line "lint-scope-registries: PASS" appears in
  output, AND (b) independently invokes
  `node scripts/lint-scope-registries.mjs` against current state. Belt +
  braces: gate-0 catches the operator at release time; acceptance check
  catches the gate-0 regression itself. Matches the [[ADR-0215]]
  golden-master pattern and the CT-G/CT-L mitigations.
- **Secondary risk**: the 2-commit TDD sequence (R4) requires discipline
  at fix-commit time. **Mitigation**: per `[[feedback-no-history-squash]]`,
  the project already forbids squash-to-clean-up; this risk is
  structurally bounded.
- **DA's principled-dissent forcing function (R8)**: if Option B is not
  scheduled at the next remediation pass — independent of how often the
  lint fires — the audit's "5 registries" structural finding survives
  unaddressed. Recorded; not a Decision change but a queen-side
  commitment.
