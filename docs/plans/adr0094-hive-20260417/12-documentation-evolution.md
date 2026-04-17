# Documentation Evolution — 8 Sprints

Mechanical rules. No new prose formats.

## 1. Per-Sprint Doc Checklist (DoD gate)

Every sprint close produces ONE commit `docs: sprint-N close — <active ADR>`:

| File | Required |
|---|---|
| `ADR-0094-log.md` | Dated H3 at top: fork+patch SHAs, check_id transitions, catalog delta, next sprint's ADR. |
| `coverage-ledger.md` | New `BUG-NNNN` YAML per discovery; existing bugs updated in-place. `fingerprint` recomputed by `catalog-rebuild.mjs`. |
| Active ADR-009{5,6,7} | Status flipped per §2. Append to "Implementation notes" only, never Decision. |
| `CLAUDE.md` "What We Tried" | ONE bullet only if the sprint yielded a pattern-level lesson. Tactical fixes don't belong. |
| Cross-links | `ADR-0094` gains table row; child gains `Parent: ADR-0094` in frontmatter. Bidirectional. |

Enforcement: `preflight.mjs` gets a `docs-rot` subcheck (§7).

## 2. ADR Status State Machine

Frontmatter `status:` is single source of truth. Commit/grep-driven:

| From → To | Trigger |
|---|---|
| `Proposed` → `In Implementation` | First commit on any file in ADR `scope_globs:`. Auto-detected. |
| `In Implementation` → `Partially Implemented` | Sprint complete in log AND ≥1 gate criteria unmet. |
| `Partially Implemented` → `Implemented` | All gates met AND 3 consecutive full cascades green across ≥3 calendar days. Bot comments; human flips. |
| `Implemented` → `Archived` | 90 calendar days zero commits on `scope_globs` AND no owned-check regressions. Move to `docs/adr/archive/`. |
| any → `Withdrawn` | Human decision, dated log entry. |

`Partially Implemented` is load-bearing: t3-2 post-mortem in 0094-log shows why skipping it masks gaps.

## 3. Sibling Log File Policy

**Only ADR-0094 gets `-log.md`.** It coordinates 8 sprints — its log is cross-sprint state. ADR-0095/0096/0097 are narrow (1-2 sprints each); execution notes live in one "Implementation notes" H2 inside the ADR body (cap 200 lines; overflow prunes oldest). On `Implemented` the ADR body freezes; later observations go to `ADR-0094-log.md` under the sprint where they surfaced. `ADR-0094-log.md` is never merged back, never archived.

## 4. Bug Ledger Churn

Entries stay forever with `state: closed` + `closed_date`. Rationale: regression detection needs `fingerprint` lookups against historical bugs; pruning loses that. Archive split only when file exceeds **400 YAML blocks** into `coverage-ledger-archive-YYYY.md` by `closed_date`. Active ledger shows non-closed + last 90 days of closed.

## 5. Changelog Generation

`scripts/gen-changelog.mjs` (new) from two inputs:

1. `ADR-0094-log.md` dated H3 → one CHANGELOG section per sprint.
2. `coverage-ledger.md` transitions where `fix_commit` is in release range → "Bug fixes" with `BUG-NNNN → upstream file`.

Regenerates on each `fork-version` (pipeline step 4). No hand-edited changelog.

## 6. Documentation-as-Contract

"Numbers are pointers, not frozen" enforced at **preflight** (not post-sprint CI — too late). `preflight.mjs` runs `catalog-rebuild.mjs --check-only`: rebuild catalog from `lib/acceptance-*-checks.sh`, grep ADR-0094 for numbers, fail if catalog disagrees AND the ADR was touched in the last commit. Prevents stale numbers; allows intentional mid-sprint drift. Whoever edits 0094 last triggers the gate — no separate gatekeeper.

## 7. `scripts/adr-lifecycle-check.mjs` Stub

Part of `npm run preflight`. Parses all `docs/adr/ADR-*.md` frontmatter. Asserts:

- **(a)** Every `Implemented` ADR has zero unstruck `- [ ]` lines in body (struck = `- [x]` or `~~`).
- **(b)** Every `In Implementation` ADR has a log entry (in `ADR-0094-log.md` or its own Implementation notes) within last 14 calendar days.
- **(c)** Every `\bADR-\d{4}\b` reference resolves to a real file in `docs/adr/` or `docs/adr/archive/`.
- **(d)** Every `scope_globs:` entry matches ≥1 real file.
- **(e)** Status value is in §2 enum.

Non-zero exit on failure, grouped by ADR. Signature: `node scripts/adr-lifecycle-check.mjs [--adr ADR-NNNN] [--fix-transitions]`.

---

**Summary**: one log sibling (0094 only), lifetime-in-place ledger, mechanical status transitions, preflight-gated rot checks, auto-generated changelog. Zero hand-curated metadata.
