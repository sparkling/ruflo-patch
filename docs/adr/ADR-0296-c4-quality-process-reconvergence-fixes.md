---
status: proposed
completed: false
date: 2026-06-04
tags: [quality, process, adr-tooling, jujutsu, testgen, doc-drift, re-convergence, c4, fixes]
supersedes: []
depends-on: [ADR-0292, ADR-0291, ADR-0294, ADR-0273, ADR-0271]
implements: []
---

# C4 re-convergence — repair the adr filename contract and the quality-tooling doc drift

## Context and Problem Statement

The ADR-0292 C4 review (executed 2026-06-04; evidence in `docs/research/c4-quality-process/01..04`,
raw drives in `/tmp/c4-evidence/`) proved every advertised upstream C4 feature works (jujutsu's
6-tool analyze family, REAL testgen/docs worker daemons, adr end-to-end via its scripts, sparc/ddd
substrate; zero UPSTREAM-BROKEN) and classified the fork's deltas. The devil's-advocate pass upheld
every load-bearing verdict, settled all open items (worker posture, detect, short-flags, useRuVector
— all PARITY/shared-drift), and contributed one material correction (N1, `graph_edges` dump-timing —
folded into ADR-0294 R1's premise).

C4's outcome is unique in the program so far: **no C4-originating runtime regression** (the one
regression observed is C2's R1 seen from its primary consumer) and a **fork-internal documentation
contract break** as the category's material finding. Premise hygiene continues: 21/21 audited fork
ADR premises demonstrated, zero assumed-broken.

**This ADR is `proposed`.** Its work items are doc/contract-only fork edits + one grep-contract
acceptance check; they run in the serial implementation lane under the standing per-category
pipeline (ratified 2026-06-04), bundle-able with the ADR-0295 batch.

## Decision Drivers

* A project following the plugin `adr-create` SKILL verbatim produces files the canonical
  `agentdb index` REFUSES (DA repro: skill-shaped `0001-use-postgres.md` → EXIT 1) — a fork-shipped
  skill defeating a fork-shipped tool.
* Seven LOW doc-drift items accumulate user-facing contract lies (args/flags/namespaces that don't
  exist or differ).
* The program's evidence: C4's dominant mistake class is doc-drift — the cheapest class to fix and
  to lint against recurrence.

## Considered Options

* **Fix the docs to the canonical tool contracts + add a grep-contract check** (this ADR). Chosen.
* Relax `agentdb index` to accept both filename forms — rejected: the corpus convention (`ADR-`
  prefix, 4-digit, ADR-0271 prefixing) is project-canonical and self-identifying cross-corpus;
  loosening the tool to match wrong docs inverts the spec relationship.
* Record-only — rejected: F1 actively breaks new corpora.

## Decision Outcome

Adopt the C4 dispositions table (`docs/research/c4-quality-process/04-dispositions.md`) verbatim.
Work items:

### Fixes (doc/contract only)

* **F1 — adr filename contract (two axes).** Plugin command `adr.md`: `ADR-NNN-<slug>` (3-digit) →
  `ADR-NNNN-<slug>.md` (4-digit, prefixed). Plugin skill `adr-create/SKILL.md`: "NNNN-<slug>.md …
  NO `ADR-` filename prefix" → require the `ADR-` prefix (matching the index glob, the corpus, and
  the project-local skill). *Acceptance:* grep-contract check — both plugin surfaces state the
  canonical `ADR-NNNN-<slug>.md` form; the no-prefix prescription string is absent; wired into
  `test-acceptance*.sh` (run_check_bg + collect_parallel) + CI path filter.
* **F2 — doc-drift batch:** jujutsu skill diff-arg prose → real `ref` arg; adr skill arg-shapes →
  live schema; adr-index skill → canonical `agentdb index` (import.mjs reference updated, and the
  script↔skill namespace lag reconciled: the script writes `adr-patterns` + `adr-edges`); testgen
  `coverage-gaps --limit` CLI-flag phantom removed (MCP `limit` is the real surface); fork help
  examples using `-t`/`-p` short flags — **premise corrected by the implementation DA (2026-06-04):**
  the parser does NOT reject short forms globally; `buildScopedAliases` only scopes to depth-1
  subcommands, so level-2 nested commands (`hooks worker dispatch -t/-c/-p`) hit a flat-global-map
  COLLISION (11 `short:'t'` declarations in hooks.ts) while level-1 commands (`hooks route -t`)
  work. Shared with upstream byte-for-byte; no donate-back. Re-scoped item: fix the `hooks worker
  dispatch` command's own `examples` (hooks.ts:2726-2728, 4006) to long flags (rider on the next
  batch); jujutsu README version pin refreshed; `useRuVector`
  documented as inert (dead flag both sides — param kept for surface parity).

### Cross-references (no work here)

* The category's one regression (adr/ddd causal edges starving the graph surface) is **owned by
  ADR-0294 R1** (implemented, in DA review). C4 adds the consumer-impact note and a post-release
  re-drive of the adr composition (`adr import → causal-query` + causal-edge → graph-query).
* DA correction N1 (the `graph_edges` dump-timing artifact) is recorded in ADR-0294's amended R1
  premise and the C2/C4 research errata.

### Fork-ahead justifications (recorded; no code change)

* **J1 — `agentdb_causal-query`/`hierarchical-query` registration: KEEP** — closes an upstream
  doc-drift (upstream's adr skills name tools its runtime lacks); end-to-end proven.
* **J2 — durable `hierarchical-recall`: KEEP with recorded limitation** — durable-but-non-semantic
  (all keys at fixed 0.5); optional future enhancement, not a re-convergence item.
* **J3 — `agentdb index` CLI (ADR-0273), `adr-verify`, MADR/`completed:`/cross-corpus lints: KEEP**
  — no upstream equivalent would suffice.

### Consequences

* Good, because the one way a new project can silently break its ADR tooling (following the shipped
  skill) is closed, with a lint against recurrence.
* Good, because C4 closes with zero runtime divergence work — the lightest category so far — keeping
  the serial implementation lane short.
* Neutral, because the shared upstream doc-drifts stay upstream-unfixed (house rule: no donate-backs).

### Confirmation

F1's grep-contract check + the F2 spot-greps land in `test-acceptance*.sh` + CI; the post-release C4
validation re-drives the adr composition against published packages. This ADR flips to
`accepted`/`completed:true` when F1+F2 ship and the checks are green in a release.

## More Information

* Evidence: `docs/research/c4-quality-process/01..04` (DA verdicts + errata folded 2026-06-04;
  `/tmp/c4-evidence/da/VERDICT-SUMMARY.txt`).
* Program tracking: ADR-0292 (C4 row links here). Siblings: ADR-0293 (C1), ADR-0294 (C2),
  ADR-0295 (C3).
* Program-level note: C4's mistake-class signature is **doc-drift** — with C1 (wrong-shape), C2
  (necessity-not-re-justified), C3 (un-merged paired fix), the four signatures are disjoint; the
  feared fabricated-brokenness class has appeared in exactly one citation (C1 F1, retracted).
* Method addition carried into the bar practice: **dump-timing** (N1) — end-state claims need a
  dump after the drive's last write, or a per-path claim.

## Amendments

### Implementation record (2026-06-04; DA: ZERO BLOCKERS; PUSHED with the ADR-0295 stack)

* **Fork commit `4d3afbe95`** (F1+F2): adr command → 4-digit `ADR-NNNN`; adr-create SKILL → require
  the `ADR-` prefix (DA both-ways repro: old shape → `agentdb index` EXIT 1; canonical → indexed);
  jujutsu `ref` arg; adr arg-shapes → live schemas; adr-index namespace lag corrected (`adr-edges`
  NOT retired — `adr-verify` reads it); testgen phantom `coverage-gaps --limit` removed (`--limit`
  on coverage-suggest is real, kept); jujutsu README pin → v3.7; `useRuVector` documented inert.
* **STOP correctly executed then DA-settled:** the F2 short-flags item's premise ("parser rejects
  short forms") was half-false — depth-1 commands work; level-2 nested (`hooks worker dispatch
  -t/-c/-p`) collide via the scoped-alias depth-1 limitation (shared upstream). Re-scoped rider on
  the next batch: fix the worker-dispatch `examples` to long flags.
* Acceptance: `lib/acceptance-adr0296-checks.sh` grep-contract (worktree `4bcbceb`); both-ways via
  `git show` (base FAILs, HEAD PASSes). Note (pre-existing, program-level): CI path filters
  reference `forks/ruflo/...` paths not tracked in ruflo-patch — the convention all sibling
  workflows share.
* Status stays `proposed`; flips with the release that turns `adr0296-c4-contract` green.
