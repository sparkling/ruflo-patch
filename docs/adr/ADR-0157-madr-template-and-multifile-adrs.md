# ADR-0157: Adopt canonical MADR + SPARC methodology + first-class multi-file ADRs via YAML `amends:` relationships

- **Status**: Proposed 2026-05-08
- **Date**: 2026-05-08
- **Deciders**: Henrik Pettersen
- **Methodology**: SPARC + MADR
- **Related**: ADR-0143 (user-facing brand), ADR-0148 (skill-mcp-tool-surface-audit), upstream `ruflo-adr` plugin (current ad-hoc template), HM `docs/adr/README.md` (project-level MADR declaration), https://adr.github.io/madr/ (MADR canonical spec), https://github.com/ruvnet/sparc (SPARC methodology)

## Context and Problem Statement

The fork ships an `adr-create` skill that emits a 4-section ad-hoc template (`## Context / ## Decision / ## Consequences / ## Links`) with `ADR-NNN-<slug>.md` filenames and 3-digit numbering. This template is **not MADR-compliant**, contradicting downstream projects (HM in particular) that use MADR semantics, 4-digit unprefixed filenames, DACI fields, and richer section structure (Decision Drivers, Considered Options, Decision Outcome, Pros and Cons of the Options). Three concrete failure modes have surfaced from this drift:

1. The `adr-index` skill's filename-extraction rules and section-extraction rules were brittle against any project that diverged from upstream's template — HM's 217 ADR files had **zero matches** under the original `docs/adr/ADR-*.md` glob (fixed in `forks/ruflo` `b0e28a764` for the current ad-hoc shape, but the deeper issue is that the template is non-MADR and the skill silently inherits that assumption).
2. HM's 14-file family for ADR-0159 (1 canonical + 13 companion `wave35-catN-generator-diff.md` files) collapses to a single AgentDB row under strict ID extraction — the failure was masked behind a vague "missing slash commands" symptom and required forensic investigation to surface.
3. There is **no authoritative format spec** anywhere in the toolchain. The template is implicitly defined by the `adr-create` skill's emit step; CLAUDE.md, USERGUIDE, init's `claudemd-generator.ts`, and `docs/adr/CONVENTIONS.md` are all silent. A human or AI reader of an existing ADR has no source-of-truth for what shape the next ADR should take.

This ADR locks in **canonical MADR** as the project-wide ADR template format, declares **first-class multi-file ADRs via YAML `amends:` relationships** as the resolution to the multi-file decomposition problem, and outlines the migration path for `adr-create`, `adr-index`, and HM's 217 existing files.

## Decision Drivers

- **Adopt a recognised standard, not invent one.** MADR is the most widely adopted ADR format with a public spec, examples, and tooling ecosystem. Inventing fork-specific conventions creates ongoing onboarding cost and silently breaks third-party tools (e.g. log4brains, adr-tools).
- **Couple the document format with a methodology.** A template alone produces inconsistently-filled ADRs because contributors don't know what depth of analysis is expected per section. Coupling MADR with **SPARC** (Specification → Pseudocode → Architecture → Refinement → Completion) gives contributors a process discipline that maps to MADR sections cleanly, and gives reviewers a checklist for evaluating whether an ADR is complete (e.g. did it surface alternatives during S→A, did it carry a Completion criterion to acceptance).
- **Don't break HM's 217 existing ADRs.** They are 75% MADR-shaped already (DACI fields, MADR section names where adopted). A migration that requires renaming files, restructuring frontmatter, and breaking link targets across 217 files is a destabilising rewrite. We need a refactor path that converges on MADR+SPARC without rebuilding the corpus.
- **Multi-file decomposition is real.** HM's `0159-wave35-catN-*` family is not a corner case — it's a deliberate decomposition pattern. Forcing decompositions into single files erodes editing comfort and review focus. Whatever convention we adopt MUST treat companions as first-class ADRs, not second-class material.
- **Machine-parseable structure beats inferred structure.** Filename-based parent inference (the heuristic the patched `adr-index` skill currently uses) is fragile against future filename conventions and hard for humans to verify. Explicit YAML metadata (`amends: 0159`) is robust under rename, copy, and refactor.
- **Failure must be loud, not silent.** The current pre-fix `adr-index` collapse-and-overwrite shape is the exact `feedback-data-loss-zero-tolerance` antipattern. Whatever convention we adopt must surface ambiguity at index time, not produce a corrupt graph.

## Considered Options

### Option 1 — Stay on upstream's ad-hoc template; document it as the spec

Document the current 4-section template (Context / Decision / Consequences / Links) in `CLAUDE.md` and `docs/adr/CONVENTIONS.md`. Add multi-file rules per filename pattern. Don't move to MADR.

### Option 2 — Adopt canonical MADR; one ADR = one file (strict)

Switch the `adr-create` template to MADR canonical. Treat all decompositions as internal subsections (`## More Information` links to non-ADR notes elsewhere). Companion files cease to exist; HM's 13 `0159-wave35-*` files get merged into the canonical `0159-*.md` or moved out of `docs/adr/` entirely.

### Option 3 — Adopt canonical MADR; multi-file via subdirectory-per-ADR

Switch to MADR. Decompositions live in subdirectories: `docs/adr/0159/decision.md` (the canonical ADR) plus `docs/adr/0159/wave35-cat6.md` (companions). The directory structure itself encodes the relationship; index walks subdirs.

### Option 4 — Adopt canonical MADR; multi-file via filename-suffix (current HM)

Switch to MADR. Companion files keep current shape (`0159-wave35-cat6-generator-diff.md` next to `0159-canonical.md`). The `adr-index` skill infers the parent-child relationship from filename pattern (the rule we just patched in `forks/ruflo` `b0e28a764`).

### Option 5 — Adopt canonical MADR; first-class multi-file via YAML `amends:` (RECOMMENDED)

Switch to MADR. Companion files keep filename + structure as first-class MADRs but add an explicit YAML `amends: 0159` (or `amends: [0159, 0160]` for multi-parent) to their frontmatter. The `adr-index` skill reads YAML, emits a causal edge `<child> -[amends]-> <parent>`, and validates that parents exist (dangling `amends:` references abort the index build with a diagnostic).

## Decision Outcome

**Chosen option: Option 5** — adopt canonical MADR + first-class multi-file ADRs via YAML `amends:`.

### Why Option 5 over the others

- **vs Option 1**: MADR alignment was the user's explicit ask in the conversation that motivated this ADR. Documenting the current template freezes a non-standard format and accumulates more divergence from MADR-using tools every cycle.
- **vs Option 2**: HM's 13 companion files for ADR-0159 represent ~7% of HM's ADR corpus. Forcing them into the canonical file destroys the topical decomposition that motivated their existence (per-category "wave35-catN-generator-diff" treatments). Rejected on data-preservation grounds.
- **vs Option 3**: Subdirectories require renaming and restructuring all 217 HM files. The benefit (clearer hierarchy) doesn't justify the cost — the same hierarchy is expressible via YAML `amends:` without any file moves.
- **vs Option 4**: Filename inference is fragile. Two equally-valid renames (`0159-foo.md` → `0159-bar-foo.md`) can flip a file's classification from canonical to companion under the inference rule. Explicit YAML metadata is rename-safe, copy-safe, and human-verifiable. The skill's filename-inference path (already shipped in `b0e28a764`) becomes the **fallback** for legacy files that haven't yet declared `amends:`, not the primary mechanism.

### Filename and structure decisions locked in

| Concern | Value | Rationale |
|---|---|---|
| Filename | `NNNN-<slug>.md` (no `ADR-` prefix) | matches MADR canonical + HM convention |
| Numeric padding | 4-digit zero-padded | future-proof past 999; matches HM |
| Frontmatter | YAML block (between `---` lines) | MADR canonical; machine-parseable; replaces bullet-list shape |
| Required frontmatter fields | `status`, `date`, `methodology: [SPARC, MADR]` | MADR minimums + explicit methodology declaration |
| Optional frontmatter fields | `decision-makers`, `consulted`, `informed` (DACI lists), `tags`, `amends` (NNNN or list), `supersedes` (NNNN or list), `superseded-by` (NNNN or list), `related` (NNNN or list) | full MADR DACI + multi-file relationships |
| Required H1 | `# {Title}` (NOT `# ADR-NNNN: {Title}` — MADR canonical doesn't repeat the number in the heading) | MADR canonical; reduces redundancy |
| Required sections | `## Context and Problem Statement`, `## Decision Outcome` (with `### Confirmation` subsection) | MADR minimum + SPARC requires explicit Completion criterion (Confirmation) |
| Recommended sections | `## Context and Problem Statement`, `## Decision Drivers`, `## Considered Options`, `## Decision Outcome`, `### Consequences` (under Outcome), `### Confirmation`, `## Pros and Cons of the Options`, `## More Information` | full MADR section set |
| SPARC phase markers | HTML comments `<!-- SPARC: S -->`, `<!-- SPARC: P -->`, `<!-- SPARC: A -->`, `<!-- SPARC: R -->`, `<!-- SPARC: C -->` placed at the start of the section corresponding to each phase | matches HM's older convention; visible to humans; ignored by markdown renderers; greppable |
| Status enum | `proposed`, `rejected`, `accepted`, `deprecated`, `superseded by [NNNN](NNNN-<slug>.md)` | MADR canonical |

### SPARC-to-MADR section mapping

SPARC's five phases map onto MADR's section structure as follows. Contributors follow SPARC during the work, then capture each phase's outputs in the matching MADR section. Reviewers use the mapping as a checklist to evaluate completeness.

| SPARC phase | MADR section(s) | What goes here |
|---|---|---|
| **S — Specification** | `## Context and Problem Statement` + `## Decision Drivers` | What problem are we solving? What forces shape the answer? Acceptance criteria framed as "we'll know we're done when …". |
| **P — Pseudocode** | `## Considered Options` | Each option's algorithmic / structural shape, NOT yet committed to a final design. Worked examples, not full implementations. |
| **A — Architecture** | `## Decision Outcome` (the "Chosen option: X, because Y" paragraph) + `## Pros and Cons of the Options` | The committed design. Explicit reasoning for choosing X over Y/Z. Trade-offs surfaced per option. |
| **R — Refinement** | `### Consequences` subsection under `## Decision Outcome` | What will change as a result? What ongoing trade-offs are accepted? What follow-up work is implied? |
| **C — Completion** | `### Confirmation` subsection under `## Decision Outcome` + `## Acceptance criteria` | How will the implementation be confirmed? What tests, metrics, or operational signals confirm "done"? Each criterion must be observable. |

The mapping is reflected in the template via HTML-comment phase markers (`<!-- SPARC: S -->` etc.) at the top of each section. Markers are invisible in rendered markdown but greppable from CLI / scripts.

### Template emitted by `adr-create` (post-this-ADR)

```markdown
---
status: proposed
date: <YYYY-MM-DD>
methodology: [SPARC, MADR]
decision-makers: [<author>]
consulted: []
informed: []
tags: []
# Optional relationship fields — uncomment as needed:
# amends: NNNN
# supersedes: NNNN
# superseded-by: NNNN
# related: [NNNN, NNNN]
---

# {Title}

<!-- SPARC: S — Specification -->

## Context and Problem Statement

{What is the issue that motivates this decision? Frame as a question the reader can answer "yes/no, that's what we're solving for".}

## Decision Drivers

- {force or constraint shaping the decision}
- {force or constraint shaping the decision}

<!-- SPARC: P — Pseudocode -->

## Considered Options

### Option 1 — {short name}

{Algorithmic / structural sketch. NOT a full implementation; just the shape.}

### Option 2 — {short name}

{...}

<!-- SPARC: A — Architecture -->

## Decision Outcome

**Chosen option: "{option}"**, because {justification — explicit comparison against alternatives}.

<!-- SPARC: R — Refinement -->

### Consequences

- Good, because {positive consequence}
- Bad, because {negative consequence; trade-off accepted}
- Neutral, because {neither helpful nor harmful but worth noting}

<!-- SPARC: C — Completion -->

### Confirmation

{How will this decision be confirmed as implemented? Each criterion must be observable from a test, metric, or operational signal.}

## Pros and Cons of the Options

### Option 1 — {short name}

- Good — {arg}
- Bad — {arg}
- Neutral — {arg}

### Option 2 — {short name}

- Good — {arg}
- Bad — {arg}

## More Information

- {related links, references, follow-up tasks, out-of-scope items}
```

### Multi-file ADR semantics (Pattern E specifics)

```yaml
---
status: accepted
date: 2026-05-08
methodology: [SPARC, MADR]
amends: 0159
decision-makers: [@henrik]
---

# Wave 35 Cat 6 — Generator Diff

<!-- SPARC: S — Specification -->

## Context and Problem Statement

Specific generator-diff treatment for cat6 under the parent two-schema-split decision (ADR-0159).

...
```

Companion files inherit the parent's high-level decision; their own SPARC arc covers only the cat-specific specification, options, and completion. They MAY omit `## Considered Options` and `## Pros and Cons` if no real alternatives existed at the companion level — the parent's arc covers those.

The `amends:` field can be:
- A single ID: `amends: 0159` (most common)
- A list: `amends: [0159, 0160]` (multi-parent companions, e.g. a decomposition that splits the difference between two parents)
- Absent for canonical ADRs that aren't companions of anything else

The `adr-index` skill reads `amends:` at Step 4 and emits a causal edge `from: <child-id> -> to: <parent-id>; relation: amends`. This replaces the current filename-inference companion detection at the skill's Step 4.5 (the filename-inference is preserved as a **fallback** for legacy files that pre-date this ADR's frontmatter requirement).

### Edge cases (resolutions)

| Edge case | Resolution |
|---|---|
| Multi-parent companion | `amends: [0159, 0160]` — list shape; two causal edges emitted |
| Companion-of-companion (`A` amends `B` amends `C`) | Each declares `amends: <its parent>`; graph traversal walks the chain naturally |
| Companion superseding its parent's earlier guidance | `amends: 0159` AND `supersedes: 0159` — both edges emitted, different relations |
| Dangling `amends:` (parent doesn't exist) | adr-index Step 2.5 (uniqueness/dangling check) ABORTS index build with diagnostic listing the dangling reference |
| Companion with NO `amends:` field | Treated as canonical (no parent assumed); legacy files use filename-inference fallback until migrated |
| Self-amendment (`amends: <self>`) | Aborted at Step 2.5 — sentinel for typos; never silently accepted |

## Pros and Cons of the Options

### Option 1 (stay ad-hoc; document)

- Bad — perpetuates fork-only template; future tools require fork-specific awareness.
- Bad — doesn't address HM's 13-companion-files data-loss case (still requires the filename-inference patch).
- Good — zero migration effort.
- Good — backwards compatible with all existing ad-hoc ADRs.

### Option 2 (MADR strict; one file = one ADR)

- Bad — destroys HM's decomposition pattern; forces 13 companions to merge into one file.
- Bad — high migration cost (manual review for each merge).
- Good — perfectly aligned with MADR canonical.
- Good — simplest indexing model.

### Option 3 (MADR + subdirectory)

- Bad — requires renaming + restructuring all 217 HM files.
- Bad — link-update sweep across the codebase to re-target subdirectory paths.
- Good — directory hierarchy is self-documenting.
- Neutral — neither better nor worse than Option 5 for indexing semantics.

### Option 4 (MADR + filename-suffix companions; current HM)

- Bad — filename-inference rule is fragile under rename.
- Bad — convention is implicit; cannot be machine-validated without parsing every filename.
- Good — zero file rename in HM.
- Good — already implemented in the patched `adr-index` skill at `forks/ruflo` `b0e28a764`.

### Option 5 (MADR + YAML `amends:`) — CHOSEN

- Good — explicit, machine-parseable parent-child relationship.
- Good — rename-safe, copy-safe, human-verifiable.
- Good — multi-parent and dangling-reference edge cases handled cleanly.
- Good — composable with `supersedes:` and `related:` for richer graph semantics.
- Good — MADR-aligned (uses YAML frontmatter; non-canonical fields are still valid YAML).
- Bad — requires 13+ HM companion files to add `amends:` field (mechanical, scriptable).
- Bad — adr-index skill needs YAML parser (small addition; standard library).
- Neutral — filename convention becomes documentation, not load-bearing structure.

### Confirmation

<!-- SPARC: C — Completion -->

This decision is implemented when:

1. The upstream `ruflo-adr` plugin's `adr-create` SKILL.md template emits canonical MADR + SPARC shape with the methodology field, SPARC phase markers, and optional `amends:` field. (Acceptance Criterion #1 below.)
2. The `adr-index` skill parses YAML frontmatter, reads `amends:` (and other relationship fields), validates `methodology: [SPARC, MADR]` declaration, emits matching causal edges, and aborts at Step 2.5 on dangling references. (Acceptance Criterion #2.)
3. HM's 217 ADRs are refactored to MADR+SPARC shape (script + manual review report) with companion files declaring `amends:` correctly and SPARC phase markers in place. (Acceptance Criterion #3.)
4. A regression unit test in `ruflo-patch/tests/unit/` enforces the template + skill alignment so future drift surfaces at unit-test time. (Acceptance Criterion #4.)
5. ruflo-patch's own `docs/adr/` is migrated to canonical MADR+SPARC shape (separate effort; tracked but not blocking this ADR).

## Acceptance criteria

Every criterion must be observable from a test, pipeline output, or graph query — never code-review-only (per `feedback-no-squelch-tests`).

1. **adr-create template** at `forks/ruflo/plugins/ruflo-adr/skills/adr-create/SKILL.md` emits:
   - YAML frontmatter with required `status`, `date`, `methodology: [SPARC, MADR]`
   - All five SPARC phase HTML comments (`<!-- SPARC: S -->` through `<!-- SPARC: C -->`) at the start of their mapped sections
   - The full MADR section set per the template in §"Template emitted by adr-create"
   - Verified by a unit test in `ruflo-patch/tests/unit/adr0157-create-template.test.mjs` that runs the skill in a temp dir and parses the emitted file: YAML frontmatter must validate against schema; all 5 SPARC markers must be present; required sections must exist.
2. **adr-index skill** at `forks/ruflo/plugins/ruflo-adr/skills/adr-index/SKILL.md`:
   - Parses YAML frontmatter as primary (bullet-list as legacy fallback)
   - Reads `amends` / `supersedes` / `superseded-by` / `related` and emits matching causal edges
   - Validates `methodology` field — if `[SPARC, MADR]` declared, also asserts presence of all 5 SPARC phase markers in the body and warns (does not abort) if any are missing
   - Aborts at Step 2.5 on dangling `amends:` references
   - Verified by a unit test running the skill against a synthetic MADR+SPARC fixture in `tests/fixtures/adr0157-test-corpus/` containing: 1 canonical, 2 companions, 1 multi-parent, 1 dangling-amends (must abort), 1 missing-SPARC-marker (must warn).
3. **HM refactor** is OUT OF SCOPE for this ADR — handled by ADR-0159. ADR-0157's acceptance criteria cover only the upstream skill + template surface.
4. **Regression guard test** asserts the adr-create template's frontmatter shape matches what adr-index can parse. Test parses both SKILL.md files and asserts the YAML field names match. Adding a field to one MUST require updating the other; drift surfaces at unit-test time.
5. **Pipeline acceptance suite** continues to pass at ≥ 675/675.

## More Information

### Out of scope (deferred to follow-up ADRs)

ADR-0157 is scoped narrowly to **upstream skill + template surface**: the format adopted by `adr-create`/`adr-index`/`adr-review` skills in `forks/ruflo/plugins/ruflo-adr/`. Three explicit out-of-scope concerns:

1. **ODR tooling** — handled by **ADR-0158** (parallel `odr-*` skill family living in `~/.claude/skills/`). ODRs follow ONT-0029's format authority, not ADR-0157's MADR+SPARC+amends.
2. **HM project refactor** — handled by **ADR-0159**. HM's 217 ADRs need a substantial migration script, manual-review workflow, link-update sweep, and phased rollout. That's its own scope; this ADR only establishes the target format.
3. **ruflo-patch's own ADR refactor** — this repo's 163+ ADRs would also benefit from MADR+SPARC alignment, but that's a separate effort. This ADR's deliverables are upstream-skill-side; downstream project migrations are independent ADRs.

Council session tooling and multi-project namespacing are handled within ADR-0158's scope where applicable.

- Migrating ruflo-patch's own 163 ADRs to MADR shape. ADR-0157 covers the template + skill change but ruflo-patch's own corpus is a separate refactor whose scope and value should be evaluated independently.
- Adding a `docs/adr/CONVENTIONS.md` declaring the format. Init's `claudemd-generator.ts` should reference it once it exists, but the doc itself is not part of this ADR's deliverables — the YAML schema in §"Filename and structure decisions" IS the spec.
- Switching frontmatter from bullet-list (current HM) to YAML for **legacy** files that haven't been migrated. The HM refactor script handles this in Phase 4; legacy bullet-list parsing remains a fallback in adr-index for any unmigrated file.
- Tooling integration with external MADR ecosystem (log4brains, adr-tools, etc.). Adoption of MADR canonical opens this door; pursuing it is its own scope.

### Implementation order

1. **Lock the spec** — this ADR (ADR-0157), Status: Proposed → Accepted on review.
2. **Update adr-index skill first** — parse YAML, read relationship fields, emit causal edges. This must exist before refactor #4 so the refactor can be validated end-to-end. Implementation in `forks/ruflo/plugins/ruflo-adr/skills/adr-index/SKILL.md`.
3. **Update adr-create template** — emit MADR canonical with optional `amends:`. Implementation in `forks/ruflo/plugins/ruflo-adr/skills/adr-create/SKILL.md`. Bump plugin.json minor version (e.g. 0.1.2 → 0.2.0 since it's a template-shape change).
4. **HM refactor script** — one-shot Node script in HM's `.scripts/` that reads each ADR file, converts bullet frontmatter to YAML, normalises section headings (`## Context` → `## Context and Problem Statement` for legacy era), adds `amends:` per filename inference (the rule we just patched), backs up originals to `docs/adr/.backup-<TS>/`, reports manual-review-needed cases.
5. **HM refactor execution** — run on a copy of HM first, validate against the updated adr-index skill, then run on real `docs/adr/` and re-run `/adr-index`.
6. **Update HM's `docs/adr/README.md`** — already declares MADR; tighten to declare canonical YAML + `amends:` after the refactor lands.

### References

- MADR canonical spec: https://adr.github.io/madr/
- HM `docs/adr/README.md`: declares "MADR-format Architecture Decision Records" (current authoritative project-level statement)
- ruflo-patch ADR pattern survey (this conversation): 12 of 163 ADRs declare `**Methodology**: SPARC + MADR`; rest use the upstream `adr-create` ad-hoc shape
- Upstream `ruflo-adr` plugin source: `/Users/henrik/source/ruvnet/ruflo/plugins/ruflo-adr/`
- Companion-file inference patch (interim solution, superseded by this ADR's Pattern E): `forks/ruflo` commit `b0e28a764` (2026-05-07)
