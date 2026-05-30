---
status: accepted
date: 2026-05-29
tags: [adr, tooling, documentation, migration]
supersedes: []
depends-on: []
implements: [ADR-0157]
---

# Migrate the ADR corpus to canonical MADR shape by rename-and-sub-letter

## Context and Problem Statement

ADR-0157 ratified canonical MADR 4.x (plus two project extensions — a `tags:` field and the `supersedes:` / `depends-on:` / `implements:` typed-relation slots) as the project-wide ADR format, and the `adr-create` / `adr-index` skills now encode that template as a strict contract. The corpus itself was never migrated to it. A full scan of `docs/adr/` on 2026-05-29 found **only 1 of 276 files fully conformant**:

- 166 have no YAML frontmatter (legacy bullet-list metadata under H1).
- 109 carry disallowed frontmatter keys (30 of them DACI fields dropped by Council 415).
- 173 lack `## Context and Problem Statement`, 166 lack `## Considered Options`, 165 lack `## Decision Outcome`, 210 lack `### Consequences`.
- 195 H1 headings carry an `ADR-NNNN:` self-prefix that the template forbids.
- 58 files use the bare `NNNN-slug.md` filename instead of the project-canonical `ADR-NNNN-slug.md`.

The migration is not a mechanical reformat: most files need their body prose lifted into MADR sections, which is judgement-heavy and risks altering or losing the historical decision being recorded. Two structural hazards make a naive bulk-rewrite dangerous:

1. **Number collisions.** Ten numbers are shared by distinct records: eight are 4-digit (e.g. `ADR-0039-build-target-split` vs `ADR-0039a-upstream-controller-integration-roadmap`), two are 3-digit plugin ADRs (`ADR-078`, `ADR-079`) that pad onto existing `ADR-0078`/`ADR-0079`. The strict `adr-index` uniqueness check (step 2.5) aborts the whole graph build when two files map to one ID.
2. **Reference blast radius.** There are ~16,033 `ADR-NNNN` *number* references across `docs/`, but only ~8 markdown *path* links to bare-form filenames. Renaming (keep the number, add the `ADR-` prefix) touches ~8 links; **renumbering** would invalidate a slice of the 16k number references and is intractable to disambiguate on records this old.
3. **Non-decision companion docs.** ~18 files are logs/trackers/audits/plans/triage notes (`ADR-0094a-log`, `ADR-0118-execution-plan`, `-tracker`, `-roadmap`, `-triage`), not decision records. They have no "Considered Options" or "Consequences" to express; forcing them into full MADR sections means fabricating decision content that never existed.

The question: what migration strategy reaches template conformance — including a unique ID per record so `adr-index` builds clean — without renumbering away thousands of references or rewriting historical decisions into fiction?

## Decision Drivers

* Preserve referential integrity — the ~16k `ADR-NNNN` references must keep resolving.
* Preserve the recorded decisions verbatim where possible; never invent options or consequences that were not part of the original record.
* Reach the `adr-create` template contract AND a unique ID per record (the `adr-index` uniqueness bar) with no residual follow-up.
* Make the transformation auditable and reversible via git.

## Considered Options

* **Rename + uniform sub-letter (chosen)** — Add `ADR-` prefix / zero-pad every filename and update path links. Resolve every collision by sub-lettering: the *oldest* file in each group keeps the bare number (so historical `ADR-NNNN` references still resolve to it), and every later file becomes `ADR-NNNN<letter>` (e.g. `ADR-0039a`). Renumber nothing. Convert genuine decision ADRs fully into MADR sections from existing prose; companion docs get frontmatter + H1 + a real `## Context` only.
* **Rename + renumber collisions** — Reassign the later colliding ADRs new tail numbers and rewrite all references so IDs are unique.
* **Force every file into the full template** — Stub `## Considered Options` / `### Consequences` for log/tracker docs so 100% pass mechanically.
* **Frontmatter-only normalization** — Repair frontmatter + H1 only; leave body structure and collisions untouched.

## Decision Outcome

Chosen option: **"Rename + uniform sub-letter"**, because it reaches both bars — the `adr-create` template *and* the `adr-index` uniqueness check — with **no residual and no follow-up**, while holding the two non-negotiable lines: references keep resolving and history is not rewritten into fiction. Sub-lettering is preferred over renumbering because these records are old (March–May 2026) and a bare `ADR-NNNN` reference cannot be disambiguated to one of two collided files; keeping the oldest at the bare number and lettering the rest gives every record a unique, self-identifying ID while leaving the most-likely meaning of existing references intact. Companion docs are normalized to frontmatter + H1 + `## Context` (which is all `adr-index` requires — it hard-fails only on a missing Context section, not on missing Options/Consequences) rather than having decision content fabricated.

### Supersession scope

This ADR does not supersede any prior ADR; it migrates the format of the entire corpus, including ADR-0157 (itself non-conformant) and including this file.

### Consequences

* Good, because all ~16,033 `ADR-NNNN` number references continue to resolve (no renumber).
* Good, because every record gets a unique ID, so the strict `adr-index` uniqueness check passes — no residual collision is left behind.
* Good, because genuine decision ADRs reach the `adr-create` template contract.
* Good, because historical decisions are preserved — prose is lifted into sections, not rewritten.
* Good, because the sub-letter signals the satellite relationship for companion clusters (`ADR-0118a/b` are visibly part of the 0118 family).
* Bad, because companion docs reach only frontmatter + H1 + `## Context` (no Options/Consequences) — `adr-index`-clean, but not the *full* MADR body; this is the deliberate honest-over-complete tradeoff, not a deferred task.
* Neutral, because the sub-letter primary is assigned by first-commit date; same-day ties are broken by git log order (deterministic).

### Confirmation

Per-file, during conversion: each converted ADR is validated against the strict contract (frontmatter present, key-whitelist, `status` enum, ISO `date`, typed-slot shape, required `## Context and Problem Statement`, no `ADR-NNNN:` H1 prefix, no body-prose relations). A file that fails is fixed before the converter moves on.

Corpus-level, authoritative: the **`adr-index` skill (strict mode)** is the confirmation gate. It is run once after conversion completes and **fails loud** on any non-conformant record — a clean run is the proof of correctness. Before re-indexing, **all old ADR entries are purged** so no stale record survives the migration:

1. **Purge stale index state** — delete every `adr/*` hierarchical entry and every `adr-patterns` namespace memory entry. This is required, not optional: sub-lettering minted new IDs (`ADR-0039a`, `ADR-0118a/b`, …) and the pre-migration corpus had duplicate-number and 3-digit (`ADR-078`) entries; without a purge those orphaned IDs would linger in the graph.
2. **Rebuild from the migrated corpus** — run `adr-index` strict mode, which re-parses all `docs/adr/ADR-*.md`, validates each (aborting on any violation), and rebuilds record metadata, forward + derived-inverse typed edges, and `adr-patterns` memory.
3. **Verify** — the strict run confirms 277 unique IDs (zero uniqueness aborts), zero orphan typed-relation targets, and zero frontmatter/section violations. `git grep` for the old filenames confirms no dangling path links remain.

## Mapping

Collision resolution (oldest keeps bare number; later files sub-lettered). All renames are `git mv`; references updated in the same commit.

| Number | Bare ID (kept) | Sub-lettered |
|---|---|---|
| 0039 | `ADR-0039-build-target-split` | `ADR-0039a-upstream-controller-integration-roadmap` |
| 0040 | `ADR-0040-adr-0033-wiring-remediation` | `ADR-0040a-pipeline-build-optimizations` |
| 0051 | `ADR-0051-queen-ruling` | `ADR-0051a-remove-direct-integrations-use-plugins` |
| 0052 | `ADR-0052-embedding-model-optimization` | `ADR-0052a-config-driven-embedding-framework` |
| 0076 | `ADR-0076-architecture-consolidation-plan` | `ADR-0076a-ideal-state-implementation-plan` |
| 0078 | `ADR-0078-bridge-elimination-agentdb-tools` | `ADR-0078a-agent-llm-federation-plugin` |
| 0079 | `ADR-0079-acceptance-test-completeness` | `ADR-0079a-iot-cognitum-plugin` |
| 0094 | `ADR-0094-100-percent-acceptance-coverage-plan` | `ADR-0094a-log` |
| 0118 | `ADR-0118-execution-plan` | `ADR-0118a-hive-mind-runtime-gaps-tracker`, `ADR-0118b-review-notes-triage` |
| 0166 | `ADR-0166-agentdb-unified-database-architectural-gap` | `ADR-0166a-followup-rvf-substrate-assessment` |

Plus: 58 bare `NNNN-slug.md` files → `ADR-NNNN-slug.md` (number unchanged).

## Rules

Operational rules for executing the conversion (the bulk body-restructuring step):

- **Swarm size: 3 agents (reduced from 15).** The first attempt spawned 15 concurrent subagents and tripped a transient server-side Claude API rate limit (`API Error: Server is temporarily limiting requests · not your usage limit`) that killed 14 of 15 at launch; only one batch completed. High launch concurrency is the trigger, so the conversion runs **at most 3 concurrent agents**, each handling a proportionally larger batch.
- **Throttling is transient and server-side.** A rate-limit error that says "not your usage limit" is Anthropic capacity throttling, not account quota. It is retryable — never treat it as a hard failure or abandon the file.
- **Retry policy.** On a rate-limit error, the agent retries the *same* file with brief backoff rather than skipping it. If an agent dies mid-run, the coordinator re-runs only the remainder — never the whole corpus.
- **Idempotent re-runs.** Re-partition only the *un-converted* remainder: classify every file with the strict validator (decision mode, or `--companion` for known companion docs); a file that already PASSes is skipped. This makes any number of throttled restarts safe and convergent.
- **Back off concurrency if throttling persists.** If 3 agents still trip the limit, reduce further (2, then serial in the main thread). Convergence beats parallelism.
- **Never commit partial state.** Conversion edits stay in the working tree until the full corpus passes the `### Confirmation` gate; only then commit.

## More Information

- Implements ADR-0157 (canonical MADR adoption + migration path outline); ADR-0157 is itself one of the non-conformant files and is migrated under this plan.
- Template authority: `adr-create` SKILL.md (canonical MADR 4.x + project extensions).
- Strict conformance contract: `adr-index` SKILL.md (frontmatter whitelist, required sections, filename rules, uniqueness check; sub-letter IDs `ADR-NNNN<letter>` are explicitly supported, letters a–m).
- Conformance scan: `/tmp/adr-scan.mjs` (2026-05-29 baseline: 1/276 conformant).
- Related: ADR-0270 (2026-05-29 reconciliation of stale old-format status lines) — same-day corpus audit; this migration normalizes the format those status lines live in.
