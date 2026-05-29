# ADR-0158: Duplicate ODR skill family — `odr-create`, `odr-index`, `odr-review` parallel to the ADR family

- **Status**: **[RECONCILED 2026-05-29 → SHIPPED under a different format authority; see [[ADR-0270]]]** The `odr-{create,index,review}` skills exist at `~/.claude/skills/`, but built under the **DCAP / ODR-0095** model — NOT this ADR's ONT-0029 design (`.code.md` companions were explicitly retired). `adr-index` was correctly never turned into a single unified multi-type indexer (a symmetric `odr-index` writes the `odr/*` namespace instead). No engineering remains; this ADR's specified design is obsolete (doc-reconciliation only). Original status preserved below. — Proposed 2026-05-08
- **Date**: 2026-05-08
- **Methodology**: SPARC + MADR
- **Deciders**: Henrik Pettersen
- **Related**: ADR-0157 (ADR template format — MADR+SPARC+amends, ADR skills only), HM ONT-0029 (ODR Format and Audience Separation, 9-expert council ratified, authoritative for ODR format), upstream `ruflo-adr` plugin (current ADR-only skill family), `forks/ruflo` `b0e28a764` (filename-inference companion patch — superseded by ADR-0157)

## Context and Problem Statement

<!-- SPARC: S — Specification -->

The `ruflo-adr` plugin ships three ADR-focused skills: `adr-create`, `adr-index`, `adr-review`. They handle Architecture Decision Records under `docs/adr/` with the format established in ADR-0157 (MADR + SPARC + YAML `amends:` for multi-file).

HM also maintains **Ontology Decision Records (ODRs)** under `docs/ontology/ODR/`, governed by `ONT-0029` (a 9-expert-council-ratified format with 200-line cap, 9-section structure, mandatory `.code.md` companions, and `## Amendments` table semantics). HM has ~30 ODRs and 50+ associated council sessions. The current `adr-index` skill ignores them entirely; the broader `adr-create` / `adr-review` skills are inapplicable because ODRs have a different format.

Three structural reasons rule out a single unified "decision-records" skill that handles both:

1. **Format authority is different.** ADR format is governed by ADR-0157 (this fork's decision). ODR format is governed by `ONT-0029` (HM's 9-expert council, ratified 9-0). A unified skill imposes one schema or fragments per-type — fragmenting forces the skill to encode both, raising complexity and creating accidental coupling between two independently-governed formats.
2. **Slash-command UX**. `/adr-create` is muscle memory in HM. Adding a `--type=odr` flag (or auto-detecting from CWD) is opaque; users typing `/adr-create` expect an ADR, not "the system guessed an ODR because you were in a different dir". Explicit `/odr-create` is unambiguous.
3. **Per-type evolution.** `adr-review` and `odr-review` will likely diverge — ODR reviews involve the 9-expert council per ONT-0029, while ADR reviews are lighter-weight. Coupling them in one skill forces the simpler one to carry the complex one's machinery.

The user's decision (this conversation, 2026-05-08): create a parallel `odr-*` skill family. Don't unify under `decision-records-*`.

## Decision Drivers

- **Per-type format authority MUST be preserved.** ADRs follow ADR-0157. ODRs follow ONT-0029. Skill code must respect each format on its own terms.
- **Slash-command UX MUST be unambiguous.** `/adr-create` creates an ADR. `/odr-create` creates an ODR. No flag-based mode-switching, no dir-based auto-detection.
- **Per-type evolution MUST be independent.** ODR's council-driven review process should evolve without dragging ADR-review along, and vice versa.
- **Cross-type relationships ARE preserved at query time, not write time.** Each skill writes to its own AgentDB namespace. Cross-type queries (e.g. "which ADR references ONT-0029?") use AgentDB's path-prefix scan across namespaces — no new infrastructure needed.
- **Code duplication is acceptable.** Each skill's logic is small (~50-200 lines of MD). Two parallel implementations following per-format rules is cleaner than one polymorphic skill with a dispatcher.
- **ONT-0029's authority is sovereign.** The ODR skills must adapt to ONT-0029's format (bullet-list frontmatter, `## Amendments` table, `.code.md` companions, 200-line cap) without proposing changes to it.

## Considered Options

<!-- SPARC: P — Pseudocode -->

### Option 1 — Single unified skill family (`decision-records-*`)

One set of skills (`decision-records-create`, `decision-records-index`, `decision-records-review`) with a `--type=adr|odr` flag or auto-detection from CWD. Internal dispatcher selects per-type parser.

### Option 2 — Duplicate skill family (`odr-*` parallel to `adr-*`) (RECOMMENDED)

Three new skills (`odr-create`, `odr-index`, `odr-review`) parallel to existing ADR skills. Each operates on its own document type with its own format authority. Cross-type relationships handled at query time.

### Option 3 — Separate plugin (`ruflo-odr` parallel to `ruflo-adr`)

Two plugins: existing `ruflo-adr` (ADR skills) plus new `ruflo-odr` (ODR skills). Strongest isolation; per-plugin versioning; per-plugin install gate.

### Option 4 — Skills bundled into existing `ruflo-adr` plugin

`ruflo-adr` plugin gains `odr-*` skills alongside `adr-*` skills. Single plugin, broader scope, accepts that the plugin name no longer exactly matches its contents.

### Option 5 — User-level skills in `~/.claude/skills/` (RECOMMENDED, user choice 2026-05-08)

ODR skills live in `~/.claude/skills/odr-create/`, `~/.claude/skills/odr-index/`, `~/.claude/skills/odr-review/`. The `~/.claude/` directory is a separate git repo the user controls directly. Skills there are user-level (available across all projects on the machine) without per-project plugin install.

ADR skills stay in `forks/ruflo/plugins/ruflo-adr/skills/` (project-level, plugin-distributed).

## Decision Outcome

<!-- SPARC: A — Architecture -->

**Chosen: Option 2 (duplicate skill family) + Option 5 (ODR skills live in `~/.claude/skills/`)**, because the duplicate skill family resolves the format-authority and UX concerns, and locating ODR skills in `~/.claude/` keeps the existing `ruflo-adr` plugin literal-named (ADR-only) while making ODR support a user-level capability available across all projects on this machine without per-project plugin install gates.

### Why Option 2 over Option 1 (unified skill)

- **vs Option 1**: a `--type=` flag is opaque; auto-detection from CWD requires a discovery walk inside the skill body (and silently misclassifies if `docs/adr/` and `docs/ontology/ODR/` are both present in nearby dirs). Explicit per-type skill names are unambiguous and matched the user's stated preference.

### Why Option 5 over Options 3 and 4

- **vs Option 3** (separate `ruflo-odr` plugin): plugin install gates are per-project. A separate ODR plugin requires every project that wants ODR support to enable it. Locating ODR skills in `~/.claude/skills/` makes them user-level — install once, available everywhere on this machine. No per-project install gate to manage.
- **vs Option 4** (bundle in `ruflo-adr` plugin): the plugin name `ruflo-adr` is ADR-literal; bundling ODR skills there creates a name/contents mismatch. Plus the `ruflo-adr` plugin ships through the fork's publish pipeline (codemod, version coordination); ODR skills don't need that pipeline machinery.
- **`~/.claude/` is a git repo** the user controls directly. ODR skills get the same versioning + history + portability benefits as a plugin without going through a separate publish surface.

### Skill family layout (post-this-ADR)

The `adr-*` skills stay in their existing fork-side plugin location. The new `odr-*` skills live in `~/.claude/` (the user's claude-config repo), NOT in `forks/ruflo/plugins/ruflo-adr/`. Two locations, by design:

`forks/ruflo/plugins/ruflo-adr/skills/` (existing fork plugin — ADR family stays here):
```
adr-create/SKILL.md        ← existing; updated per ADR-0157 (MADR+SPARC+amends)
adr-index/SKILL.md         ← existing; updated per ADR-0157 (YAML parsing, collision checks)
adr-review/SKILL.md        ← existing; updated per ADR-0157 (review for MADR+SPARC compliance)
```

`~/.claude/skills/` (user-level claude-config repo — ODR family lives here):
```
odr-create/
  SKILL.md                 ← NEW; emits ONT-0029-shape ODRs; bootstraps ONT-0029 spec
  assets/
    ONT-0029.md            ← BUNDLED canonical format spec (the spec is part of the skill)
    ONT-0029.code.md       ← BUNDLED companion code appendix
odr-index/SKILL.md         ← NEW; indexes ODRs per ONT-0029
odr-review/SKILL.md        ← NEW; reviews ODRs per ONT-0029 (incl. 9-expert council protocol)
```

**Why two locations**:

- `~/.claude/` is a separate git repo the user controls directly (not part of the fork build/publish pipeline). Skills there ship as user-level Claude Code skills via the standard `~/.claude/skills/` mechanism — installed once, available across all projects on this machine without needing to install a plugin into each project's `enabledPlugins`.
- The `adr-*` skills stay in `forks/ruflo` because they're tied to the publish pipeline (codemod, marketplace publishing for `@ruflo` plugins, version coordination with ADR-0157's plugin updates).
- The two locations don't conflict — `~/.claude/skills/odr-*` and `forks/ruflo/plugins/ruflo-adr/skills/adr-*` are independently namespaced, independently versioned, independently distributed.
- This split also means `ruflo-adr` plugin name remains ADR-only-literal (no scope drift); ODR support is a user-level skill add-on rather than a plugin-bundled capability.

The ONT-0029 spec ships AS PART of the `odr-create` skill (not as external prior art the user must already have). On first invocation of `/odr-create` in a project that doesn't already have ONT-0029 in its `docs/ontology/ODR/`, the skill writes both `ONT-0029.md` and `ONT-0029.code.md` from its bundled assets — establishing the format spec as a first-class document in the user's project before the user's actual decision-record creation begins.

### Per-skill responsibilities

| Skill | Format authority | Filename pattern | Companion handling | Hierarchical-store path | Memory namespace |
|---|---|---|---|---|---|
| `adr-create` | ADR-0157 (MADR+SPARC+amends) | `NNNN-<slug>.md` | YAML `amends:` field | (creates only — index handles store) | (creates only) |
| `adr-index` | ADR-0157 | `NNNN-<slug>.md` (canonical), `NNNN-<disambig>-<slug>.md` (companion) | YAML `amends:` (primary) + filename-inference (legacy fallback) | `adr/<id>` | `adr-patterns` |
| `adr-review` | ADR-0157 | n/a (reviews existing files) | n/a | n/a | n/a |
| `odr-create` | ONT-0029 (bundled with skill — see §"ONT-0029 bootstrap"); 9-section, 200-line cap, `.code.md` mandatory | `ONT-NNNN-<slug>.md` | Always emits `.code.md` companion (skeleton); bootstraps ONT-0029 itself if missing | (creates only) | (creates only) |
| `odr-index` | ONT-0029 | `ONT-NNNN-<slug>.md` | `.code.md` files NOT separately indexed (referenced from parent's body excerpt) | `odr/<id>` | `odr-patterns` |
| `odr-review` | ONT-0029 (incl. 200-line cap enforcement, 9-section completeness, `.code.md` sync date check) | n/a | n/a | n/a | n/a |

### ONT-0029 bootstrap (the format spec ships with the skill)

The ONT-0029 spec is bundled inside the `odr-create` skill as `assets/ONT-0029.md` + `assets/ONT-0029.code.md`. This makes ONT-0029 a **first-class component of the skill itself**, not an external dependency the user is expected to have read or copied.

**Bootstrap behavior on `/odr-create` invocation**:

1. **Probe**: skill checks if `docs/ontology/ODR/` exists and contains a file matching `ONT-0029-*.md` (the format-spec sentinel).
2. **If absent**:
   - Create `docs/ontology/ODR/` if missing
   - Copy `assets/ONT-0029.md` → `docs/ontology/ODR/ONT-0029-odr-format-and-audience-separation.md` verbatim
   - Copy `assets/ONT-0029.code.md` → `docs/ontology/ODR/ONT-0029-odr-format-and-audience-separation.code.md` verbatim
   - Inform the user: "Bootstrapped ONT-0029 (ODR format spec). Your new ODR will follow this format."
3. **If present**: continue without modification — the project already has the spec.
4. **Continue with user's requested ODR creation** at the next available `ONT-NNNN` number AFTER 0029.

**Number-collision rule**: the bundled spec ships at fixed slot ONT-0029. If a project happens to already have an ODR at slot 0029 with a different content, the bootstrap aborts loudly: "ONT-0029 slot is occupied by a non-format-spec file. Refusing to overwrite. Either rename the existing file or skip the bootstrap with `--no-bootstrap`."

**Generalized vs HM-specific content**: the bundled `ONT-0029.md` is a generalized version of HM's actual ONT-0029, abstracted to remove HM-specific references (e.g., "H&M enterprise ontology", "162 OWL classes", specific facet names). The generalized version retains:
- The 9-section structure decision
- The 200-line cap rationale
- The `.code.md` companion convention
- The post-ODR sync protocol
- The 9-expert council mechanism (described as a pattern, not a specific historical event)

The HM-specific historical context in the original ONT-0029 (the council transcript, vote tallies, devil's-advocate dissent) is preserved in HM's actual file but is NOT included in the bundled generalized version — those are HM project-internal artifacts. The bundled version cites the HM original as one example implementation in its `## Rationale` section.

**Override capability**: a project that wants to adopt a custom ODR format different from ONT-0029 simply doesn't run the bootstrap (or invokes `/odr-create --no-bootstrap`). The `odr-create` skill then emits the user's new ODR following whatever format the project's existing ODRs use (best-effort detection from existing files, with a warning if no spec is found).

### ODR skill specifics (drawn from ONT-0029)

`odr-create` emits the ONT-0029-canonical 9-section template:

```markdown
# ONT-NNNN: {Title}

- Status: proposed
- Date: <YYYY-MM-DD>
- Format: ONT-0029
- Deciders: [{deciders}]
- Consulted: [{consulted}]
- Informed: [{informed}]
- Related: [{related ODRs}]

## Context and Decision

{1 paragraph: what question, why now, what was chosen}

## Options Rejected

- {Option name}: {1 sentence with fatal flaw}

## Rationale

{Why this option, citing evidence and authoritative sources}

## Rules

{Normative rules, patterns, definitional code examples — NOT illustrative}

## Consequences

### Good
-
### Bad
-
### Neutral
-

## Vote and Dissent

| Question | Position | Vote |
|---|---|---|

## Amendments

| ODR | Change |
|---|---|

## Verification

- [ ]
```

Plus a `.code.md` skeleton at `ONT-NNNN-<slug>.code.md`:
```markdown
# ONT-NNNN: {Title} — Code Appendix

> Companion to [ONT-NNNN](ONT-NNNN-<slug>.md) (core record)
> Last synced: <YYYY-MM-DD>

## {Code section title}
```

`odr-index` parses ONT-0029-shape:
- Bullet-list frontmatter (NOT YAML — ONT-0029's choice)
- `## Amendments` table → causal edges (each row's "ODR" column → from-id; "Change" column free-form text)
- `## Vote and Dissent` table → recorded as metadata (no edges)
- `Format:` field validation (warn if missing or != `ONT-0029`)
- `.code.md` files NOT separately indexed; `odr-index` reads parent's body excerpt only
- 200-line cap warning if exceeded (does not abort — historical artifacts may exceed)
- 9-section completeness check (warns if any section absent without explicit "N/A — uncontested" note)

`odr-review` runs ONT-0029 compliance checks:
- 200-line cap on core record (HARD FAIL above)
- 9 fixed sections present (warn on absence)
- Bullet-list frontmatter parseable
- `Format:` field present and = `ONT-0029` or named historical format
- `.code.md` companion exists if `## Rules` references code patterns
- `Last synced:` in `.code.md` is within 30 days of parent's mtime

### Council sessions (open question)

Council sessions live at `docs/ontology/ODR/council/` (per ONT-0029) and `docs/adr/council/` (per ADR-0157 §"Q2 ADR-driving council sessions"). They are PROCESS artifacts, not decision records — multi-round expert deliberation transcripts that PRODUCE ADRs/ODRs.

Two options for council session handling:

- **Option α**: extend `adr-index` and `odr-index` skills to ALSO scan `**/council/` adjacent to their respective decision-record dirs. Council sessions get hierarchical paths like `adr/council/session-NNN` and `odr/council/session-NNN`. Causal edges link sessions to the ADR/ODR they produced via a `Produces:` field in the session.
- **Option β**: leave council sessions out of indexing entirely. They're referenced from within ADRs/ODRs via `## Links` or `Council Transcript:` lines; semantic search across the document corpus still surfaces them via plain memory_search if needed.

**This ADR defers the council-session decision to a follow-up.** Both ADR-0157 and the new ODR skills do NOT auto-index council sessions. Implementing Option α as a follow-up if/when query patterns demand it is straightforward — the architecture supports it.

### Cross-type relationships at query time

Each skill writes to its own namespace. Cross-type queries use AgentDB's path-prefix scan:

```
# "Which ADRs reference ONT-0029?"
mcp__ruflo__memory_search namespace=adr-patterns query="ONT-0029"

# "Which ODRs reference ADR-0157?"
mcp__ruflo__memory_search namespace=odr-patterns query="ADR-0157"

# "All decision records mentioning 'facet classification'"
mcp__ruflo__memory_search namespace=adr-patterns query="facet classification"  
mcp__ruflo__memory_search namespace=odr-patterns query="facet classification"
# Combine results client-side
```

Cross-type causal edges DO work today via AgentDB's untyped `from`/`to` semantics — an ADR's YAML `references: ONT-0029` could emit `from: adr/0157, to: odr/0029, relation: references`. The edge is queryable via `agentdb_causal-query path-prefix=adr/`. So "no new infrastructure" is literally true: it just works.

<!-- SPARC: R — Refinement -->

### Consequences

- **Good** — clear separation of concerns; `adr-*` and `odr-*` skills evolve independently
- **Good** — slash-command UX is unambiguous (`/adr-create` vs `/odr-create`)
- **Good** — ONT-0029's authority is preserved; ODR skills adapt to its format
- **Good** — cross-type relationships work at query time without new infrastructure
- **Good** — bundle in existing `ruflo-adr` plugin avoids triple-install for users
- **Bad** — code duplication: similar logic in both `adr-index` and `odr-index` (parsing, hierarchical-store calls). Acceptable: each is small; per-type clarity beats DRY at this scale.
- **Bad** — plugin name `ruflo-adr` no longer exactly matches its contents (now also hosts ODR skills). Mitigated by README documentation and skill-level scoping.
- **Bad** — users wanting only ODR skills still install the full `ruflo-adr` plugin. Acceptable: plugin install gates are per-project; the cost is one entry in `enabledPlugins`, not actual loaded surface.
- **Neutral** — council session indexing deferred to a follow-up.

<!-- SPARC: C — Completion -->

### Confirmation

This decision is implemented when:

1. Three new skills exist at `forks/ruflo/plugins/ruflo-adr/skills/`: `odr-create/SKILL.md`, `odr-index/SKILL.md`, `odr-review/SKILL.md`. (Acceptance Criterion #1.)
2. `odr-create` emits the ONT-0029 9-section template + `.code.md` skeleton; verified by running it against a synthetic test fixture and asserting the output matches. (Acceptance Criterion #2.)
3. `odr-index` parses ONT-0029-shape ODRs (bullet frontmatter, `## Amendments` table) and writes to `odr/<id>` hierarchical path + `odr-patterns` memory namespace. Verified against HM's actual ODRs. (Acceptance Criterion #3.)
4. `odr-review` enforces ONT-0029's structural rules (200-line cap, 9-section completeness, `Format:` field, `.code.md` sync date). Verified against intentionally-broken fixtures. (Acceptance Criterion #4.)
5. Existing `adr-*` skills are unaffected — `adr-index` continues to scan `docs/adr/` only, write to `adr/<id>` only. Verified by running it against HM and confirming no entries appear at `odr/*`. (Acceptance Criterion #5.)

## Pros and Cons of the Options

### Option 1 (unified skill family)

- Good — single set of skills to maintain
- Bad — opaque slash-command UX (flag or auto-detect)
- Bad — couples ADR and ODR format evolution
- Bad — fights the user's stated preference for explicit per-type skills

### Option 2 (duplicate skill family) — CHOSEN

- Good — clear UX (`/adr-*` vs `/odr-*`)
- Good — independent evolution per type
- Good — each skill respects its own format authority
- Bad — code duplication (small skills; acceptable)
- Bad — discoverability cost (users need to know both families exist)

### Option 3 (separate plugin `ruflo-odr`)

- Good — strongest isolation
- Good — independent versioning
- Bad — doubles install surface (users want both → install both)
- Bad — cross-skill imports become cross-plugin references (more complex)

### Option 4 (bundled in `ruflo-adr` plugin) — CHOSEN (with Option 2)

- Good — single install gate for both ADR + ODR support
- Good — shared dependencies (frontmatter parsers, AgentDB calls) reused without cross-plugin imports
- Bad — plugin name no longer literal (mitigated by README documentation)
- Neutral — if upstream `ruflo-adr` diverges sharply, we revisit

## Acceptance criteria

Per `feedback-no-squelch-tests`, every criterion observable from a test or pipeline output, never code-review-only.

1. **Three new skills present in `~/.claude/skills/`**: `odr-create/SKILL.md`, `odr-index/SKILL.md`, `odr-review/SKILL.md`. The `odr-create/` directory also contains `assets/ONT-0029.md` and `assets/ONT-0029.code.md`. Verified by file existence in a unit test that runs against `~/.claude/skills/`.
2. **`odr-create` emits ONT-0029 shape**: in a temp dir, invoke the skill (or a structurally-equivalent test harness); resulting `ONT-NNNN-<slug>.md` has all 9 sections (Header / Context and Decision / Options Rejected / Rationale / Rules / Consequences / Vote and Dissent / Amendments / Verification), bullet-list frontmatter with required fields (`Status`, `Date`, `Format: ONT-0029`, `Deciders`, etc.), and a `.code.md` companion at the same numeric prefix. Verified by parsing the emitted file in a unit test.
3. **`odr-create` bootstraps ONT-0029 if absent**: in an empty test project, invoking the skill writes `docs/ontology/ODR/ONT-0029-odr-format-and-audience-separation.md` (and `.code.md`) verbatim from the bundled assets BEFORE creating the user's requested ODR. Verified by a unit test using a fresh temp project.
4. **`odr-create` does NOT clobber existing ONT-0029**: in a project that already has a different file at slot ONT-0029, the bootstrap aborts with a clear error message; no overwrite occurs. Verified by a unit test with a synthetic ONT-0029 placeholder.
5. **`odr-index` parses ONT-0029-shape**: against synthetic fixtures (`tests/fixtures/adr0158-odr-corpus/`), produces:
   - exactly the expected ODR count at hierarchical path `odr/ONT-NNNN`
   - causal edges from `## Amendments` tables resolved correctly
   - zero entries at `adr/*` or `council/*`
   - `.code.md` files NOT in the index (only their parent ODRs)
   Verified via `mcp__ruflo__agentdb_hierarchical-query path-prefix=odr/` post-index.
6. **`odr-review` catches ONT-0029 violations**: against synthetic fixtures including an over-cap ODR (300 lines), a missing-section ODR (no Vote and Dissent), and a stale `.code.md` (Last synced > 30 days), the review skill reports each violation by category. Verified by unit test.
7. **`adr-*` skills unaffected**: running `adr-index` against a project with BOTH `docs/adr/` and `docs/ontology/ODR/` produces only ADR entries (no leakage into `odr/*`). Verified by integration test.
8. **Pipeline acceptance suite** continues to pass at ≥ 675/675.

## More Information

### Out of scope (deferred)

- **Council session indexing**: deferred per §"Council sessions (open question)". Both `adr-index` and `odr-index` skip `**/council/` directories. A follow-up ADR can add it as Option α when query patterns demand.
- **Multi-project / monorepo namespacing**: deferred. The current scope assumes one project. If a user has two `docs/adr/` directories in the same repo, the skill flags ambiguity and requires manual resolution. Multi-project explicit support (via `.decision-records.yaml` config) is a future ADR.
- **External tool compatibility**: log4brains, adr-tools, etc. — out of scope. The skill is internal AgentDB-backed; users of external tools continue to use them independently.
- **Council ratification of ADR-0158**: this ADR proposes ODR skill duplication from outside HM's ontology council. Per ONT-0029's authority over ODR matters, the council MAY want to ratify or revise the `odr-*` skill's format adherence. ADR-0158 is upstream skill work; the council consultation happens at the HM project level if needed.

### Implementation order

1. **Land ADR-0157 first** — the `adr-*` skill updates establish the pattern that `odr-*` mirrors (in spirit; not in format).
2. **Generalize ONT-0029 from HM's version** — read HM's `docs/ontology/ODR/ONT-0029-*.md`; produce a generalized version that strips HM-specific historical context (council transcript, vote tallies, devil's advocate identity) while preserving the 9-section structure, 200-line cap, `.code.md` convention, post-ODR sync protocol. Save as `~/.claude/skills/odr-create/assets/ONT-0029.md` (and `.code.md`).
3. **Write `~/.claude/skills/odr-create/SKILL.md`** — emit ONT-0029 9-section template + `.code.md` skeleton + bootstrap logic (probe + copy from assets if absent + abort on slot conflict).
4. **Write `~/.claude/skills/odr-index/SKILL.md`** — parse ONT-0029-shape (bullet frontmatter, `## Amendments` table, `.code.md` companion handling). Hierarchical-store path `odr/ONT-NNNN`; memory namespace `odr-patterns`.
5. **Write `~/.claude/skills/odr-review/SKILL.md`** — enforce ONT-0029's hard rules (200-line cap, 9 sections, `Format:` field, `.code.md` sync).
6. **Synthetic fixtures** at `ruflo-patch/tests/fixtures/adr0158-odr-corpus/` covering: canonical ODR, over-cap ODR, missing-section ODR, valid `.code.md`, stale `.code.md`, slot-0029-occupied scenario.
7. **Commit `~/.claude/`** — the user controls this repo directly; commit the new `odr-*/` directories with their assets.
8. **Validate with HM**: per ADR-0159 (HM project refactor) — out of scope for this ADR.

### References

- ADR-0157 (this repo): MADR + SPARC + multi-file ADRs via YAML `amends:` (the `adr-*` skill family format)
- ONT-0029 (HM `docs/ontology/ODR/`): ODR Format and Audience Separation, 9-expert council ratified, 9-section structure with 200-line cap (the `odr-*` skill family format)
- HM `docs/ontology/ODR/` corpus (~30 ODRs): real-world target for `odr-index` validation
- Upstream `ruflo-adr` plugin: `/Users/henrik/source/ruvnet/ruflo/plugins/ruflo-adr/` (current ADR-only baseline)
