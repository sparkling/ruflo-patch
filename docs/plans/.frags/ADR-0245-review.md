## ADR-0245 — CT-L: pipeline robustness + set-e discipline

**Status**: proposed (post-swarm-review)
**Swarm**: 4 experts + devil's advocate, Quorum-majority consensus, hierarchical topology, tactical queen, queen-composed transport
**Triage rank**: 6 (per [[ADR-0233]] §Decision; wave 2 of 5)

### Decision (post-swarm-review)

Adopt hybrid **A+B+C, scope-merged** as originally drafted — per-site
disposition table for 11 findings, `run_phase_norevert` helper extracted into
`lib/pipeline-helpers.sh`, and `scripts/lint-set-e-discipline.mjs` gating
gate-0. Quorum-majority **4/4 in favour**; devil's advocate withdraws principled
dissent with one accepted proposal (R5 below). Six refinements applied to the
ADR; the per-site disposition table, helper shape, and lint gate ship as
written.

### Implementation steps

The ADR's concrete steps 1-14 stand, with these refinements applied:

1. **Step 1 amended (R2)**: `run_phase_norevert`'s recoverable-error allowlist
   is per-call explicit (3rd argument or per-phase shell array), not a global
   lookup table. Prevents allowlist drift becoming a new registry-drift class
   (the very anti-pattern CT-C's ADR-0236 closes for scope registries).
2. **Step 3 amended (R3)**: also emit a node-importable `lib/fork-paths.mjs`
   re-exporting `FORK_DIR_*` so the 9 sibling `.mjs` lint scripts import from
   one source rather than carry independent `process.env.X ?? "/Users/henrik/..."`
   defaults. Composes with CT-C's single-source-of-truth pattern; closes the
   path-default registry-drift class before it opens.
3. **Step 6 amended (R5)**: agentic-flow `tsc --noEmit` baseline assertion
   reads from a checked-in `config/agentic-flow-type-error-baseline.json`
   (single key: `{"count": 256}`). Any bump to the number is a reviewable PR
   delta, not an invisible source-tree edit. Matches the
   `config/runtime-externals-allowlist.json` shape step 7 proposes — one
   pattern for "bounded baselines re-measured on intent".
4. **Step 12 amended (R1)**: lint implementation must explicitly handle the 5
   scripts without `set -e` (not the 3 named in the ADR body):
   `check-no-cwd-in-handlers.sh`, `publish-verdaccio.sh`, `run-check.sh`,
   `test-acceptance-fast.sh`, `test-acceptance.sh`. Pick per-script: migrate to
   `set -euo pipefail` OR add `# DELIBERATE:` header comment with rationale.
5. **Step 12 also amended (R4)**: lint accepts `# DELIBERATE-<id>:` (linking
   to ADR or corpus memory) so future audits can grep all exemptions and
   verify each has a live justification. Lint failure messages cite both
   file:line AND the helper + corpus rule (`run_phase_norevert` +
   `feedback-best-effort-must-rethrow-fatals`).
6. **New step 15 (R6/queen)**: no INTEGRATION-LEDGER row needed — fork-local
   pipeline infrastructure with no upstream hand-port. Explicit note per
   `[[feedback-update-integration-ledger]]` to prevent "missing-row"
   audit at next upstream sync.
7. **New step 16 (mitigation per Top risk)**: register the lint as an
   acceptance-tier check (not just `npm run lint` rider), plus a behavioural
   acceptance check that greps the 2 deliberate `-uo pipefail` scripts for
   zero remaining `|| log` swallows in their tolerant-phase blocks, and
   asserts each tolerant phase routes through `run_phase_norevert`. Matches
   the [[ADR-0215]] golden-master pattern; closes the copy-paste loophole
   the DA's first dissent hook surfaced.

### Dependencies

- [[ADR-0231]] wave A9 — defect-class origin; this ADR closes the same
  release-regression shape extending to the publish-wrapper branch.
- [[ADR-0233]] §CC-02-B (`set -e` discipline cross-cutting) + §CC-02-C
  (machine-pinned paths) — the cross-cutting themes this ADR closes out.
- [[ADR-0236]] (CT-C close-out) — sibling on the same audit slice. CT-C took
  the registry-drift family (`F-02-001`/`F-02-002`/`F-02-004`); CT-L takes the
  remaining 11 pipeline-robustness findings. R3 (node-importable
  `lib/fork-paths.mjs`) extends CT-C's single-source-of-truth pattern to
  cross-script path defaults.
- [[ADR-0226]] (writeFrame discipline) — kinship: both ADRs formalise an
  idiom by giving it a named helper (`writeFrame`/`run_phase_norevert`) +
  lint to prevent regression.
- [[ADR-0243]] (CT-J) — shape sibling: same per-site disposition + helper
  extraction pattern.
- [[ADR-0201]] — Remediation-ADR pre-flight checklist (all 4 checks pass:
  signal reaches audience at the publish stage for `F-02-003`/`F-02-005`/
  `F-02-006/audit-dynamic-imports.sh`; upstream not decided; premise true
  at runtime per direct head/sed verification; no sibling-ADR overlap).
- [[ADR-0193]] — kinship via `feedback-best-effort-must-rethrow-fatals` rule.

### Validation

- **Source-shape (lint)**: `node scripts/lint-set-e-discipline.mjs` passes on
  current state after step 12's per-script migration; fails red on a
  deliberately inserted `.sh` file with `set -uo pipefail` but no
  `# DELIBERATE:` header.
- **Source-shape (helper adoption)**: `grep -c "run_phase_norevert" scripts/publish-verdaccio.sh`
  returns at least 2 (Phase 4 wrapper-publish, Phase 6 promote);
  `grep -c "|| log " scripts/publish-verdaccio.sh` in the tolerant-phase
  blocks (lines 160-210) returns 0.
- **Source-shape (paths)**: `grep -c "/Users/henrik/" scripts/ruflo-publish.sh`
  returns 0 (3 sites migrated to `${FORK_DIR_*}`);
  `grep -c "/home/claude/" scripts/audit-dynamic-imports.sh` returns 0
  (dead Hetzner paths re-pointed per `[[feedback-never-touch-hz-remote]]`).
- **Source-shape (baseline data)**: `cat config/agentic-flow-type-error-baseline.json`
  exists with `{"count": 256}` (or current re-measure);
  `config/runtime-externals-allowlist.json` exists with `["flow-nexus"]`.
- **Behavioural (acceptance)**: a synthetic `npm publish` failure (mock
  registry returning 500 for non-"already-exists" reason) on the wrapper
  exits non-zero at the publish stage — proves `F-02-003` regression
  guard works. Today: synthetic failure exits 0, masking through to
  acceptance against stale wrapper.
- **Behavioural (acceptance)**: a deliberate `audit-dynamic-imports.sh`
  invocation in a temp checkout reports scanning >0 files (today: 0 files
  scanned, silent pass).
- No `skip_accepted` per `[[feedback-skip-accepted-as-squelch]]`.

### Top risk + mitigation

- **Risk**: helper extraction + lint + 12 site fixes across 6 files + 2 new
  files is the largest single ADR in the CT-L/M/N batch. Landing without a
  behavioural acceptance check means the lint passes day-one (current state
  IS conforming after migrations) and the helper is invoked at exactly 2-3
  sites. A future revert that loosens `set -uo` somewhere else passes the
  lint via a copy-paste `# DELIBERATE:` header with no meaningful
  justification. Same failure shape ADR-0240 §"Top risk" identifies
  (lint-without-acceptance-check pattern).
- **Mitigation**: per ADR-0240's accepted shape and R4's citation
  discipline — register the lint as an acceptance-tier check (not just
  `npm run lint` rider). Add a behavioural acceptance check that PROVES
  `run_phase_norevert` is actually invoked at the 2-3 expected sites (not
  bypassed via copy-paste of the old `|| log` pattern). The
  `# DELIBERATE-<id>:` requirement makes every future exemption
  greppable + verifiable at the next audit.
- **DA's withdrawn proposal stands as commitment**: if `# DELIBERATE-*:`
  comments accumulate without a live ADR/memory ref backing them, that's
  the signal to escalate to Option B (single source-of-truth) for the
  set-e discipline. Today: 2-3 exemptions, all backed by this ADR;
  threshold check at next audit.
