---
status: proposed
date: 2026-05-08
tags: [adr, odr, migration, hm]
supersedes: []
depends-on: []
implements: []
---

# HM project decision-records refactor — migrate 217 ADRs to MADR+SPARC + add `methodology` to ~30 ODRs + index council sessions

## Context and Problem Statement

<!-- SPARC: S — Specification -->

ADR-0157 establishes MADR+SPARC as the canonical ADR format. ADR-0158 establishes the parallel `odr-*` skill family at `~/.claude/skills/`. Both are upstream skill-side decisions. **This ADR (0159) covers the downstream project work**: applying both decisions to HM's actual decision-record corpus.

HM (`/Users/henrik/source/hm/semantic-modelling/`) is the principal real-world consumer of these decisions. Its current state:

| Document type | Location | Count | Format compliance |
|---|---|---|---|
| ADRs | `docs/adr/` | 217 files | ~75% MADR-shaped already (DACI fields + canonical sections in 156-178 of 217); ~7% (12 files) declare `**Methodology**: SPARC + MADR`; the rest are legacy era |
| ODRs | `docs/ontology/ODR/` | ~30 files | ONT-0029 compliant by construction (HM's own format authority, council-ratified) |
| Council sessions | `docs/ontology/ODR/council/` | ~50+ files | varied; some structured, some free-form |

Three concrete migrations needed:

1. **ADR migration**: 217 files → MADR+SPARC canonical. Bullet-list frontmatter → YAML. Section heading sweeps for legacy `## Context` → `## Context and Problem Statement`. Add `methodology: [SPARC, MADR]` to YAML. Add `amends:` to ~13 companion files (`0159-wave35-cat*-generator-diff.md` family).
2. **ODR upgrade**: ~30 files → confirm `methodology: [SPARC, MADR]` declared in YAML alongside `Format: ONT-0029`. ODRs already follow ONT-0029 structure; this is mostly metadata clarification, not structural change.
3. **Council session indexing**: ~50+ files → adopt a minimal frontmatter convention so the future `odr-index` / `adr-index` skills (per ADR-0158) can index them as related-to-decision-record artifacts. This is the smallest change scope but new ground (no current convention).

This ADR scopes the whole migration as ONE coordinated effort: scripted conversion + manual review + phased rollout + link-update sweep + validation.

## Decision Drivers

- **One coordinated effort, not three uncoordinated migrations.** Cross-document links (ADR ↔ ODR ↔ council) must update in lockstep. Doing ADRs alone, then ODRs later, then council later, would break references mid-migration.
- **Don't break existing link targets across 217+30+50 files.** Internal cross-references must update with the migration; broken links are the worst possible regression.
- **Phased rollout with early validation.** Phase A (5-file pilot) validates the script before Phase B (25 files) before Phase C (full corpus). Errors caught early are cheaper to fix.
- **Idempotency and rollback safety.** The migration script must be idempotent (re-running on already-migrated files is a no-op) AND rollback-safe (atomic writes + backup snapshot + git-revert path).
- **Manual-review escape valves are first-class.** A script that can't auto-resolve a case must FLAG, not GUESS. Per `feedback-data-loss-zero-tolerance` — never silently overwrite.
- **HM is the primary validation target for ADR-0157 and ADR-0158.** Bugs in those upstream ADRs surface here. The migration script's first job is forcing exercise of every parsing path; the second job is actually migrating the corpus.

## Considered Options

<!-- SPARC: P — Pseudocode -->

### Option 1 — Manual migration, file-by-file

Touch each file by hand. No script. Slow (~1 file every 5 min × 297 files = 25 hours of focused work) but maximally controlled.

### Option 2 — Single big-bang scripted migration

One Node script that walks all 297 files in one run. Backup → transform → write → re-validate. Either succeeds entirely or rolls back.

### Option 3 — Phased scripted migration with manual-review gates (RECOMMENDED)

One Node script with phases A-E (5 files → 25 → full → link sweep → README/CONVENTIONS update). Each phase has acceptance gates before the next phase runs. Manual-review report per phase; humans triage flagged cases before proceeding.

### Option 4 — Staged migration, type-by-type

First migrate ADRs only (Phase 1, 217 files). Then ODRs (Phase 2, ~30 files). Then council sessions (Phase 3, ~50 files). Each stage validates separately.

## Decision Outcome

<!-- SPARC: A — Architecture -->

**Chosen: Option 3 (phased scripted migration with manual-review gates)**, because it (a) scales to 297 files via automation, (b) catches errors at Phase A before they propagate to Phase C, (c) preserves cross-document link integrity by handling ADRs+ODRs+sessions in lockstep within each phase, (d) makes manual-review cases first-class output rather than silent overwrites.

### Why Option 3 over the alternatives

- **vs Option 1**: 25 hours of manual work is unsustainable and error-prone. Three weeks part-time. Mechanical changes are exactly what scripts are good at.
- **vs Option 2**: big-bang has no early-validation gate. If the script has a bug at Phase A's level of complexity, it'll have the same bug for all 297 files; rollback covers content but not the sunk-cost time of running it.
- **vs Option 4**: ADRs and ODRs reference each other via cross-document links. Migrating ADRs first leaves ADR-side references to ODR slugs that haven't been confirmed yet (and vice versa). Lockstep migration via Option 3's phases keeps the reference graph consistent across types.

### Refactor script architecture

Single Node script lives at `<HM-repo>/.scripts/migrate-decision-records.mjs` (NOT in `docs/`; never indexed; never accidentally migrated). Walks three roots in parallel (`docs/adr/`, `docs/ontology/ODR/`, `docs/ontology/ODR/council/`). Per-file pipeline:

1. **Read + parse** — detect format era (legacy bullet vs YAML; pre-MADR era vs MADR-aligned; existing methodology declaration); extract all metadata fields
2. **Classify** — assign one of: `OK auto-migrate`, `OK auto-migrate companion`, `MANUAL review` (with reason), `SKIP already-target-shape`
3. **Compute target** — frontmatter as YAML; section heading rewrites where unambiguous; `methodology: [SPARC, MADR]` added if absent; `amends:` derived from filename for companion files
4. **Backup** — atomic copy of original to `docs/<type>/.backup-<TS>/<file>` before any write
5. **Write** — atomic via temp + rename; skip if dry-run; per-file report row emitted
6. **Validate** — re-read just-written file; assert YAML parseable; assert required fields present; assert no `methodology:` collision

After all per-file passes complete, a SECOND pass walks all files for cross-reference link updates (separate from per-file content rewrites because link targets aren't known until all primary writes complete).

### Per-file classification matrix

| Source shape | Target action | Auto / Manual |
|---|---|---|
| ADR with bullet frontmatter, no methodology field | bullet→YAML; add `methodology: [SPARC, MADR]` | Auto |
| ADR with bullet frontmatter, methodology declared | bullet→YAML preserving methodology line | Auto |
| ADR with `## Context` (no Problem Statement) | rename → `## Context and Problem Statement` | Auto |
| ADR with both `## Context` AND `## Context and Problem Statement` | flag — ambiguous; human picks which to keep | MANUAL |
| ADR companion file (filename pattern matches) | add `amends: NNNN` to YAML | Auto |
| ADR companion with multi-parent hint in filename (e.g. `0159-0160-bridging.md`) | flag — multi-parent inference unsafe | MANUAL |
| ADR with `## Decision` heading containing all the Outcome content | promote to `## Decision Outcome` with `### Consequences` subsection | MANUAL (judgment call on subsection placement) |
| ADR with broken internal link (target not found in resolved repo) | flag link for sweep | MANUAL |
| ADR already in MADR+SPARC target shape | no change | SKIP |
| ODR per ONT-0029 (already canonical) | add `methodology: [SPARC, MADR]` to YAML alongside `Format: ONT-0029` | Auto |
| ODR with `Format:` field missing | flag — could be a non-ONT-0029 ODR | MANUAL |
| ODR exceeds 200-line cap | flag — ONT-0029 violation, surface for cleanup decision | MANUAL |
| Council session with no frontmatter | add minimal frontmatter (Session number, Date, Topic, Produces, Devil's Advocate) inferred from H1 + body where possible; flag remainder for manual fill | Auto + MANUAL |
| Council session with existing structured frontmatter | normalize to bullet-list with sentinel field names | Auto |

### Companion file inference rule (ADR side)

For each ADR file `NNNN-<some-extra>-<slug>.md`:
1. If a sibling file `NNNN-<canonical-slug>.md` exists with the same numeric prefix, this is a companion of `NNNN`
2. Specifically, the `0159-wave35-cat*-generator-diff.md` family (13 files) all become companions of `ADR-0159` because `0159-two-schema-split-and-stage-2-5-transform.md` exists alongside as the canonical
3. The script adds `amends: 0159` to the companion file's YAML
4. Multi-parent candidates (filename contains multiple ADR numbers, e.g. `0159-0160-*`) are NEVER auto-resolved — always flagged

### Internal-link sweep (Pass 2)

After all per-file content writes complete, a second pass walks all 297 files for cross-references:

| Link form | Action |
|---|---|
| Wikilink `[[ADR-0099]]` | rewrite to `[ADR-0099](0099-<slug>.md)` if slug unambiguous; flag otherwise |
| Markdown link `[ADR-0099](old-path.md)` | check target path exists in current corpus; flag if stale |
| Bare body-text reference `ADR-0099` | leave as-is (free-form text reference) |
| Status line `superseded by ADR-NNN` | normalize to `superseded by [NNNN](NNNN-<slug>.md)` per MADR canonical |
| ODR `## Amendments` table cells naming ADRs | rewrite if ADR slug changed during refactor |

### Backup and rollback

Per-type backup directories at:
- `docs/adr/.backup-<TS>/` (ADRs)
- `docs/ontology/ODR/.backup-<TS>/` (ODRs)
- `docs/ontology/ODR/council/.backup-<TS>/` (council sessions)

Each backup directory contains `ROLLBACK.md` with the exact restore command. Migration is committed as ONE git commit so `git revert <sha>` is the canonical rollback path; the backup directories provide secondary recovery if git history is unavailable.

### Phased rollout

| Phase | Scope | Files | Validation gate |
|---|---|---|---|
| **A — Pilot** | 5 files: 1 canonical ADR (auto), 2 companions (one auto, one manual), 1 legacy-era ADR, 1 already-migrated ADR | 5 | Hand-validate every output; iterate script until pilot is clean before Phase B |
| **B — Small batch** | First 25 ADRs alphabetically | 25 | Run `/adr-index` post-refactor; assert zero collisions, zero dangling `amends:` |
| **C — Full ADR corpus** | All remaining 187 ADRs | 192 (running total) | Same gates as Phase B + manual review of all `MANUAL`-flagged cases |
| **D — ODR pass** | All ~30 ODRs | 222 | Run `/odr-index` post-refactor; assert ONT-0029 compliance + `methodology` field added |
| **E — Council session pass** | All ~50 council sessions | 272 | Run frontmatter-completeness check |
| **F — Link sweep** | Cross-reference Pass 2 across all 297 files | 297 | Manual review of flagged stale links |
| **G — README/CONVENTIONS update** | HM `docs/adr/README.md`, `docs/ontology/ODR/README.md` (if exists), new `docs/adr/CONVENTIONS.md` | 3-4 docs | Tighten README declarations to reference ADR-0157 + ADR-0158 + ONT-0029 as authorities |

Each phase has explicit acceptance gates per the §"Validation pass" below. Phase A surfaces ~80% of edge cases by exercising every parser path.

### Validation pass (post-refactor, per phase)

After each phase's writes complete:

1. Run `/adr-index` (post-ADR-0157) against `docs/adr/` — assert zero collisions, zero dangling `amends:`
2. Run `/odr-index` (post-ADR-0158) against `docs/ontology/ODR/` — assert ONT-0029 compliance (200-line cap, 9 sections, `Format:` field present)
3. Spot-check 10 random files manually for SPARC marker placement + section heading correctness
4. Re-run any HM-internal scripts that depend on ADR/ODR file shape (none currently identified, but a fresh `grep` for relevant patterns is part of validation)
5. Cross-reference link sweep — verify no broken `[ADR-NNN](path)` links

If any test fails: rollback the phase, fix the script, re-run.

<!-- SPARC: R — Refinement -->

### Consequences

- **Good** — HM's full decision-record corpus (217 ADRs + ~30 ODRs + ~50 sessions) converges on canonical formats with explicit per-type authority preserved
- **Good** — Cross-document links update in lockstep; no broken-link regression
- **Good** — `/adr-index` and `/odr-index` work end-to-end against HM's real corpus, validating ADR-0157 + ADR-0158 implementations
- **Good** — Phased rollout catches script bugs early; rollback is git-revert
- **Bad** — Migration script is non-trivial (~500 LoC + tests). Acceptable: amortizes across 297 files
- **Bad** — Manual-review backlog (10-20% of files likely) requires sustained human attention. Mitigated: Phase A surfaces edge cases early; later phases mostly auto-migrate
- **Bad** — Migration time touches every file's git mtime. Acceptable: no HM tooling currently depends on stable mtime, but the validation pass includes a fresh sweep
- **Neutral** — Council session frontmatter convention is new ground; some legacy sessions may be stubs that need human flesh-out for the indexer to handle them properly

<!-- SPARC: C — Completion -->

### Confirmation

This decision is implemented when:

1. The migration script exists at `<HM-repo>/.scripts/migrate-decision-records.mjs` and passes its own self-tests against synthetic fixtures. (Acceptance Criterion #1.)
2. Phases A-G complete in order, each with acceptance-gate validation passing. (Acceptance Criteria #2-#7.)
3. Post-migration `/adr-index` against `docs/adr/` produces 217 distinct entries with zero collisions. (Acceptance Criterion #8.)
4. Post-migration `/odr-index` against `docs/ontology/ODR/` produces ~30 entries with ONT-0029 compliance + new `methodology: [SPARC, MADR]` field present. (Acceptance Criterion #9.)
5. HM's `docs/adr/README.md` (and any sibling READMEs) reference ADR-0157 + ADR-0158 + ONT-0029 as the authoritative format docs. (Acceptance Criterion #10.)

## Pros and Cons of the Options

### Option 1 (manual)

- Good — maximum control per file
- Bad — 25 hours of focused human work
- Bad — error-prone (humans miss edges)

### Option 2 (big bang)

- Good — single script, single run
- Bad — no early validation; bugs propagate to all 297 files
- Bad — rollback covers content but not time

### Option 3 (phased + manual-review gates) — CHOSEN

- Good — early validation at Phase A
- Good — manual-review cases first-class
- Good — atomic rollback per phase
- Bad — script complexity (manageable)
- Bad — multiple phases require sustained attention

### Option 4 (type-by-type stages)

- Good — focused scope per stage
- Bad — cross-document links break mid-migration
- Bad — three smaller validation gates instead of one comprehensive one

## Acceptance criteria

Per `feedback-no-squelch-tests`, every criterion observable from a test, pipeline output, or graph query — never code-review-only.

1. **Migration script exists** at `<HM-repo>/.scripts/migrate-decision-records.mjs`. Verified by file existence in HM's repo.
2. **Phase A (5-file pilot) clean**: pilot output reviewed by hand; script iterated until all 5 emit expected target shape. Verified by per-file diff inspection.
3. **Phase B (25 files) clean**: `/adr-index` against post-Phase-B `docs/adr/` shows zero collisions, zero dangling `amends:`. Verified via `mcp__ruflo__agentdb_hierarchical-query path-prefix=adr/`.
4. **Phase C (full ADR corpus, 217 files) clean**: same as Phase B, but full corpus. All `MANUAL`-flagged files have human review notes.
5. **Phase D (ODR pass, ~30 files) clean**: `/odr-index` against post-Phase-D `docs/ontology/ODR/` shows all entries have `methodology: [SPARC, MADR]` field. ONT-0029 compliance preserved (200-line cap, 9 sections).
6. **Phase E (council sessions, ~50 files) clean**: minimal frontmatter present in every session file; manual review notes for all flagged stubs.
7. **Phase F (link sweep) clean**: zero broken `[ADR-NNN](path)` links across all 297 files.
8. **Final corpus integrity**: 217 ADRs + ~30 ODRs + ~50 sessions all parse correctly under `/adr-index` and `/odr-index`. Cross-type causal edges (council→ADR/ODR; ADR↔ODR amends) emit correctly. Verified via `mcp__ruflo__agentdb_causal-query`.
9. **Companion edges**: the 13 `0159-wave35-*` companion files all emit `amends → 0159` causal edges. Verified via causal-query.
10. **README updates**: HM's `docs/adr/README.md` and any sibling docs reference ADR-0157 + ADR-0158 + ONT-0029 as authoritative format specs. Verified by grep.

## More Information

Original status: "**[RECONCILED 2026-05-29 → OBSOLETE/DORMANT; see ADR-0270]** The specified migration script (`.scripts/migrate-decision-records.mjs`) was never built; HM's decision-record corpus converged on the **DCAP** model (a fixed frontmatter subset with no `methodology:` field), which contradicts this ADR's ONT-0029-preserving plan. Nothing should be built as specced; any residual is governed by HM's own DCAP/Council process, outside this corpus. Original status preserved below. — Proposed 2026-05-08." Methodology: SPARC + MADR.

This decision relates to ADR-0157 (MADR+SPARC ADR template — defines the target format), ADR-0158 (ODR skill family in `~/.claude/skills/` + ONT-0029 bootstrap), HM ONT-0029 (ODR Format and Audience Separation, 9-expert council ratified), and the reconciliation reference ADR-0270.

### Out of scope (deferred)

- **ruflo-patch's own ADR refactor**: this repo's 163+ ADRs would also benefit from MADR+SPARC alignment. Separate ADR if/when needed; not blocking ADR-0159.
- **External tool reindexing**: log4brains, adr-tools, etc. — out of scope. HM doesn't currently use them.
- **Migration of historical commit messages or PR descriptions**: links in git history pointing at old ADR slugs/IDs are immutable. Out of scope.
- **Pre-emptive migration of new ADRs added during the migration window**: the migration is a one-shot snapshot. New ADRs created after Phase G should follow ADR-0157 from day one (via the updated `adr-create` skill).

### Implementation order

1. **Land ADR-0157 + ADR-0158 first** — both upstream skill changes must exist for `/adr-index` and `/odr-index` to validate the migration output.
2. **Write the migration script** at `<HM-repo>/.scripts/migrate-decision-records.mjs`.
3. **Run Phase A** (5-file pilot). Iterate script until clean.
4. **Run Phase B** (25-file batch). Iterate if needed.
5. **Run Phase C** (full ADR corpus). Address `MANUAL` flags.
6. **Run Phase D** (ODR pass). Verify ONT-0029 compliance preserved.
7. **Run Phase E** (council session pass). Manual flesh-out for stubs.
8. **Run Phase F** (link sweep). Fix flagged stale links.
9. **Run Phase G** (README/CONVENTIONS). Tighten declarations.
10. **Final validation**: full `/adr-index` + `/odr-index` runs. Causal-query spot-checks. Sample manual review.
11. **Commit + push** the migration as a single labelled commit (e.g. `migrate(decision-records): apply ADR-0157 + ADR-0158 to 297 files`).

### References

- ADR-0157 (this repo): MADR + SPARC + multi-file ADRs via YAML `amends:` (the target ADR format)
- ADR-0158 (this repo): ODR skill family + ONT-0029 bootstrap (the target ODR tooling)
- HM ONT-0029 (HM `docs/ontology/ODR/`): ODR Format and Audience Separation (preserved as-is by this migration; only `methodology` field added)
- HM `docs/adr/README.md`: declares "MADR-format" — to be tightened with explicit ADR-0157 reference in Phase G
- HM `docs/ontology/ODR/`: ~30 ODR files; ONT-0029-compliant by construction
- HM `docs/ontology/ODR/council/`: ~50+ council session files
