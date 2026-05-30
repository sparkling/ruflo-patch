---
status: accepted
date: 2026-05-26
tags: [adr-schema, completion-tracking, upstream-alignment, taxonomy]
supersedes: []
depends-on: []
implements: []
---

# Extend ADR schema with `completed` boolean; align status enum with upstream

## Context and Problem Statement

The fork's ADR corpus has drifted past the canonical schema defined in `ruflo-adr/skills/adr-create/SKILL.md`:

- 55 ADRs at `status: implemented` (not in the 5-value enum)
- 1 at `status: deferred`
- 1 at `status: assessment`
- 3 variants of `superseded by ADR-XXXX` magic-string (mixed case)
- 8 canonical `status: superseded` (within enum)

Two conflated dimensions explain the drift:

1. **Decision lifecycle** — the Nygard/MADR axis (proposed → accepted → deprecated/superseded)
2. **Implementation completeness** — orthogonal axis the corpus invented in-flight (`implemented`, `partially implemented`)

Decision-only ADRs (defer, close, disposition, findings, tracker) compound the problem by sitting at `accepted` indistinguishable from "code work in flight."

A 6-expert council deliberated three reconciliation paths (see Considered Options). Corpus evidence drove the conclusion: 55 ADRs voted for `implemented` organically, but zero invented `type:` or `implementation:` axes. The drift signal is one-dimensional.

Upstream `ruvnet/ruflo/plugins/ruflo-adr/skills/adr-create/SKILL.md` defines a 5-value enum (`proposed | accepted | rejected | deprecated | superseded`) with a single `Date` field. Sibling repos `ruvector` and `agentdb` use atomic values including `Implemented` and `Partially Implemented` in free-text bodies — but those are not plugin-defined.

## Considered Options

- **P0 (do nothing)** — Keep current strict enum; continue accumulating off-schema ADRs.
- **P1 (reclassify)** — Move decision-only items out of `/adr/` into `/decisions/`, `/audits/`.
- **P2 (add `type:` + `implementation:` axes)** — 3-axis schema with `type ∈ {build, defer, close, disposition, findings, tracker}` and `implementation ∈ {complete, partial, none, n/a}`.
- **P3 (multi-corpus)** — New `docs/decisions/` corpus mirroring the ADR/ODR split.
- **P0+ (extend enum with `implemented` and `partially-implemented`)** — Closer to ruvector convention.
- **P5 (chosen) — keep upstream's 5-value enum; add ONE boolean `completed:` flag** — Status stays Nygard-pure; implementation completeness is one orthogonal boolean; nuance lives in body prose; git log + file mtime carry the rest.

Rejection reasons:

- P0: corpus already at ~22% drift; status quo is the problem.
- P1: drops AgentDB graph relations; `adr-review` can't enforce against decisions outside `/adr/`.
- P2: corpus isn't voting for those axes; ADRs morph between types (single-value is lossy); `implementation: n/a` is dead air on ~80% of records; backfill mis-classification on ~30 records becomes load-bearing wrong-metadata; `type: tracker` legitimizes the ADRs-as-living-docs anti-pattern.
- P3: too heavy for a soft taxonomy mismatch; doubles indexer/lint surface.
- P0+: diverges from the formal upstream plugin enum; `partial` is a phase-state that mutates over time, violating ADR immutability (belongs in ledger, not frontmatter).

## Decision Outcome

**Chosen option: P5 — single boolean extension.**

The ADR frontmatter schema becomes:

```yaml
---
status: proposed | accepted | rejected | deprecated | superseded
completed: true | false        # NEW — informational; not used for graph edges or filtering
date: YYYY-MM-DD               # inception only; single date field
supersedes: [ADR-NNNN]
depends-on: [ADR-NNNN]
implements: [ADR-NNNN]
tags: [...]
---
```

Semantic rule: **`completed: true` means "this ADR's scope is fully closed; nothing more to do under this ADR's name."** Under this rule:

- Defer / close / disposition / findings ADRs are `completed: true` the moment the decision is recorded (decision IS the scope).
- Build ADRs with code shipped are `completed: true`.
- Build ADRs with partial work or named deferrals are `completed: false`, with phase nuance in body prose.
- Tracker ADRs are `completed: false` by design (never close — feature, not bug).
- Superseded / rejected ADRs are `completed: true` (no work owed).

### Consequences

- `adr-create` skill: template adds `completed: false` default for new ADRs.
- `adr-index` skill: whitelist extends 6 → 7 keys; `completed:` validates as boolean (true/false); no graph edges, no filtering — informational only.
- `adr-review` Phase A: boolean validation only; no semantic enforcement of `completed`.
- 57-record codemod normalizes existing drift:
  - 55 `status: implemented` → `status: accepted, completed: true`
  - 1 `status: deferred` → `status: accepted, completed: true`
  - 1 `status: assessment` → manual review (likely `status: accepted, completed: true`)
  - 3 magic-string `superseded by ADR-XXXX` → `status: superseded` (relation already on successor's `supersedes:` list)
- Implementation-state nuance (which phases shipped, what version) lives in body prose, exactly like upstream's `**Status**: Accepted — Implemented (...)` and `**Version**: ...` patterns.
- ADR immutability preserved: `completed: false → true` is one bounded transition, not phase-by-phase mutation.
- Loses (acceptable): filter-by-type queries (tags handle if needed); stale-build lint precision (use AgentDB ledger queries instead); first-class tracker recognition (anti-pattern, shouldn't be legitimized).

### Confirmation

- `adr-index` re-runs cleanly post-codemod with no fail-loud on `completed:` or remaining off-enum statuses.
- All 57 codemod records have audit trail in `docs/adr/_migration-audit.json` (per-record from→to mapping + signal).
- Sample 10 records post-codemod: status correctly normalized; `completed` flag matches intent; body unchanged.
- Skill files in `forks/ruflo/plugins/ruflo-adr/skills/{adr-create,adr-index,adr-review}/SKILL.md` reflect the new schema.

## More Information

- Council deliberation: session 2026-05-26 (6-expert swarm — schema designer, conventions historian, indexer/lint engineer, migration architect, devil's advocate, queen)
- Corpus drift evidence: 55 implemented / 30 accepted / 9 proposed / 8 superseded variants / 1 deferred / 1 assessment (270-record sweep)
- Upstream plugin source: `/Users/henrik/source/ruvnet/ruflo/plugins/ruflo-adr/skills/adr-create/SKILL.md`
- Sibling ADR conventions: `/Users/henrik/source/ruvnet/ruvector/docs/adr/`, `/Users/henrik/source/ruvnet/agentdb/docs/adrs/`
- Prior audit commit: 93b5400 (25 status reconciliations — partly re-touched by this codemod)
