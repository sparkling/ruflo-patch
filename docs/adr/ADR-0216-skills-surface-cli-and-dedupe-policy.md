---
status: proposed
date: 2026-05-19
tags: [skills, cli, dedupe, init, acceptance, runtime, swarm-reviewed]
supersedes: []
depends-on: [0201]
implements: []
---

# Skills surface — add minimal CLI + acceptance check (init-time dedupe rejected)

> **Reframed after a 6-expert swarm review (2026-05-20).**
> The original draft chose **Option C**: a minimal CLI (`skills list` +
> `skills validate`) **plus an init-time precedence-aware dedupe rule** plus
> an acceptance check. A 6-expert adversarial swarm found the **dedupe half
> is dead code**: `copySkills()` resolves a *single* source directory
> (`.claude/skills/`) and emits **0 duplicates** (verified: a real
> `ruflo init` emits 30 unique skills, `sparc-methodology` already resolving
> to the 1106-line version with no precedence rule). `.agents/skills/` is
> **never** an init candidate, so there is no name collision for a
> precedence rule to arbitrate. Upstream already solved the duplicate-skills
> problem by **pruning** (PR #1836, *already cherry-picked into the fork* as
> `6902716f6`), and deliberately keeps `.agents/skills/` as a separate,
> security-governed namespace — so a fork-only "precedence winner" rule is a
> perpetual merge tax against an upstream-by-design layout. Pre-flight
> checks #2 (upstream-already-decided), #3 (premise-true-at-runtime), and #4
> (sibling-overlap with ADR-0215) all fired (see
> [[feedback-remediation-adr-preflight]]).
>
> **Second-pass validation (2026-05-20).** Every structural claim re-verified
> against live fork source: `copySkills()` is single-source (`findSourceDir('skills')`,
> `executor.ts:949`) and dedupes by name (`[...new Set(skillsToCopy)]`, `:957`) — so
> **0 emitted duplicates is structurally guaranteed**, the precedence rule is provably
> dead code; `findSourceDir` has 0 `.agents/skills` references; the advertised
> `skill list` appears in exactly **5** places (`init.ts:525,883`,
> `claudemd-generator.ts:154,167,179`); #1836 convergence holds (`cli/.claude/skills`
> + `mcp/.claude/skills` absent; `archive/v2/_v2_claude_snapshot/` present);
> `sparc-methodology` = 4 source copies at exactly 118/1106/1115/46 lines, the
> `.claude/skills/` copy being the 1106-line one. **One implementation gotcha
> surfaced for the corpus-shape check:** `SKILLS_MAP` has **39** flattened entries
> but `.claude/skills/` ships **38 SKILL.md files** — the 39th dir, `dual-mode/`,
> has helper `.md` files (`dual-collect.md`, `README.md`, …) but **no `SKILL.md`**.
> It is excluded from the default `--yes` path (`dualMode:false`, `init.ts:973`), so
> the 30-floor is correct *as a SKILL.md-file count*. **But `--full` does NOT exclude
> it**: `FULL_INIT_OPTIONS` sets `dualMode:true` (`types.ts`), and `copySkills`
> copies by *dir existence* (`:960`), so the SKILL.md-less `dual-mode/` dir **is**
> emitted on the very `--full` run the 38-floor assertion uses — it would
> **false-fail** a naive "every emitted skill dir has a `SKILL.md`" check. The check
> must therefore **pin the expected SKILLS_MAP name-set and whitelist `dual-mode/`
> explicitly** — *not* blanket-skip dirs lacking a `SKILL.md`, which would also hide
> a real future missing-`SKILL.md` regression — and express the floor as a
> SKILL.md-file count (38), not a dir count (39). Decision (Option E) unaffected.
>
> **Chosen now: Option E** — keep the genuinely-needed read-side CLI
> (`skill list`, which `ruflo init` *already advertises* but does not
> implement) + the corpus-shape acceptance check (honestly scoped as a
> shipped-tree regression guard); **cut the precedence rule, the
> dedupe-warning emission, and `skills validate`** (a redundant
> reimplementation of the acceptance check). Original Option C is retained
> under *Considered Options* with its steelman.

## Context and Problem Statement

The 2026-05-19 soundness audit (ADR-0201) surfaced skills as a weak surface.
The original draft identified three converging defects; the swarm re-derived
each from the live code/tree and upstream:

1. **No CLI for skills — and it is actively advertised.** `ruflo --help`
   lists `plugins` but no `skills`/`skill` command. Confirmed empirically:
   `ruflo skills`, `ruflo skills list`, `ruflo skill ls` all exit 1
   ("Unknown command"). This is **worse than a passive gap**: every
   `ruflo init` prints `Discover skills:  ruflo skill list`
   (`forks/ruflo/v3/@claude-flow/cli/src/commands/init.ts:525,883`) and the
   generated CLAUDE.md tells users/Claude to run `ruflo skill list`
   (`src/init/claudemd-generator.ts:154,167,179`). The fork ships a
   **documented-but-nonexistent command** today. (F-15-001.) Note the
   advertised spelling is `skill list` (singular); the original draft
   proposed `skills` (plural) — these must be reconciled.

2. **Duplicate skill names — but they never reach a user project, and
   upstream already pruned the ones that mattered.** The audit reported
   "41 duplicate names / 280 files / `sparc-methodology` 3-way divergence."
   Re-derived at runtime: the fork SOURCE tree has **306 SKILL.md / 238
   unique / 39 duplicate names** across `.claude/skills/` (38),
   `.agents/skills/` (132), `archive/v2/_v2_claude_snapshot/skills/` (26),
   33 `plugins/ruflo-*` roots, and package-bundled subsets.
   `sparc-methodology` exists in 4 source copies (118 / 1106 / 1115 / 46
   lines). **But `ruflo init` emits a flat 30 SKILL.md / 30 unique / 0
   duplicates** (`--yes`; 38 on `--full`), and `sparc-methodology` resolves
   to the 1106-line `.claude/skills/` playbook — *today, with no precedence
   rule*. The "3rd copy" the draft named (`ruflo-patch/.claude/skills/...`)
   is in the ruflo-patch repo, not the fork init source. Upstream PR #1836
   (MERGED 2026-05-07, closes #1834 "Skill listing context overflow — 367
   SKILL.md, 5x duplicates") **pruned** the duplicate `.claude/skills/`
   sources (`v3/@claude-flow/{cli,mcp}/.claude/skills/`) and renamed
   `archive/v2/.claude/` → `archive/v2/_v2_claude_snapshot/` to drop it from
   discovery — and this is **already in the fork** (`6902716f6`, re-applied
   from `02976fcb9`; plus Henrik's regression fix `a1561222a`). Upstream
   left `.agents/skills/` (132 files) untouched — a separate agent-as-skill
   namespace #1836 did not prune. (The security reports against it,
   #1130/#1461, were closed as Windows-Defender false positives, not a
   governance policy; #1834 itself calls these bridges "likely safe to
   consolidate" — so "untouched" means "not yet consolidated upstream," not
   "sacred by design.") (F-07-003 / F-07-006.)

3. **Zero acceptance coverage for skills.** No `lib/acceptance-*.sh` walks
   the emitted `.claude/skills/` tree to validate per-skill shape (F-15-102).
   This gap is real and unaddressed.

The original draft's framing — that init "discovers two source locations
with the same skill name" and needs a precedence rule to pick a winner — is
**false at runtime**. There is no init-time collision to resolve.

## Decision Drivers

* **Premise true at runtime** ([[feedback-remediation-adr-preflight]] #3) —
  remedies must match what the code actually does. `copySkills()` copies a
  fixed `SKILLS_MAP` allow-list from a single resolved source dir; it is
  structurally incapable of emitting duplicate names.
* **Re-converge with upstream, don't diverge** ([[feedback-remediation-adr-preflight]]
  #2) — upstream chose prune over precedence and keeps `.agents/skills/` as
  a deliberate namespace. A fork-only precedence rule fights every future
  upstream skills change (esp. the active #1054/#1587/#1938 name-slug work).
* **Close the advertised-but-missing command** — `ruflo init` promises
  `skill list`; shipping a command that exits 1 is a broken promise to the
  user (the signal's audience).
* **No sibling overlap** (#4) — ADR-0215 owns `.agents/skills/` + build-tree
  content integrity; this ADR stays on the user-facing `.claude/skills/`
  init surface.
* **Minimum code that solves the problem** (global "Simplicity First",
  [[feedback-corpus-evidence-before-feature-work]]) — don't build a
  precedence arbiter before any multi-source merge that needs it, and don't
  ship a `validate` command that re-implements the acceptance check.
* **Inspect-installed-not-dev** ([[feedback-inspect-installed-not-dev-nodemodules]])
  — the acceptance check runs against a fresh init'd project.
* **Loud-not-silent** ([[feedback-no-fallbacks]]) — corpus-shape failures
  fail the acceptance gate.

## Considered Options

* **Option C — Minimal CLI (`list`+`validate`) + init-time precedence-aware
  dedupe + acceptance check (original draft, REJECTED).** Rejected because
  the dedupe half is dead code (single-source `copySkills`, 0 emitted
  duplicates), the precedence rule diverges from upstream's prune over an
  upstream-by-design namespace, and `validate` reimplements the acceptance
  check. Full pros/cons retained below.
* **Option E — Minimal read-side CLI (`skill list`) + corpus-shape
  acceptance check; NO init-time dedupe (chosen).** Build only the
  already-advertised `skill list`; add the acceptance corpus-shape check
  scoped as a shipped-tree regression guard; cut the precedence rule,
  dedupe-warning, multi-location lint, and `validate`. Add the missing
  INTEGRATION-LEDGER row for the #1834/#1835/#1836 cherry-picks.
* **Option A — Full CLI + dedupe + acceptance.** Over-scoped; `show`=`cat`,
  `install`=`ruflo init skills` (which already exists, `init.ts:939`).
  Rejected (unchanged).
* **Option B — Native-only; no CLI.** Leaves the advertised `skill list`
  broken. Rejected.
* **Option D — Defer CLI; dedupe + acceptance only.** Closest to chosen, but
  keeps the dead dedupe and drops the CLI that closes a live broken-promise.
  Superseded by Option E.

## Decision Outcome

**Chosen: Option E — minimal read-side CLI (`skill list`) + corpus-shape
acceptance check; init-time dedupe rejected.**

### (1) CLI: `skill list` only

* Add a `skill`/`skills` command exposing `list` (read-side: enumerate the
  init'd `.claude/skills/` tree with name + description). Reuse
  `SKILLS_MAP` + `findSourceDir` read-side logic
  (`executor.ts:37`, `:2172`).
* **Reconcile the spelling**: `ruflo init` and the generated CLAUDE.md
  already advertise `ruflo skill list` (singular) in 5 places. Implement the
  command to match what is already shipped (register `skill` with a `skills`
  alias, or update the 5 references to one canonical spelling) so the
  advertised command resolves. This is the load-bearing fix for F-15-001 —
  it closes a broken promise the product already makes.
* **Cut `skills validate`.** It checked `MISSING_FRONTMATTER` /
  `MISSING_SKILL_MD` / `MISSING_SCRIPTS` — the *identical* three checks the
  shell acceptance corpus-shape walk performs, so it is a redundant TS twin
  that adds unaudited CLI surface (G-16-001). The CI-reachable validation
  path is the acceptance check, not a new command. A user-facing validator
  *is* justified for diagnosing drift in an *existing* project (not just
  fresh init) — scope it to the **upstream-aligned #1054 invariant**
  (`name:` frontmatter matches the directory slug — the correctness bug
  upstream is actively fixing via PRs #1587/#1938), which is *not* redundant
  with the acceptance check. Track it as a concrete follow-up gated on
  #1587/#1938 landing in the fork; do not build it here.

### (2) Acceptance: corpus-shape regression guard

* Add `_run_skills_corpus_shape` to `lib/acceptance-init-generated-checks.sh`
  (model: the existing `check_p5_*` pattern reading a pre-init'd tree). It
  walks the **emitted** `${TEST_TMP}/.claude/skills/` tree in a fresh init'd
  project (per [[feedback-inspect-installed-not-dev-nodemodules]]) and
  asserts, in pure shell: every skill dir has a `SKILL.md`; frontmatter
  parses and has `name:`; (convergence-friendly) `name:` matches the
  directory slug (#1054); referenced scripts under the copied skill dir
  exist.
* Add `_run_skills_cli_surface`: run `ruflo skill list`, assert exit 0,
  assert it lists the emitted skills, and that each maps to an existing
  `${TEST_TMP}/.claude/skills/<name>/SKILL.md`. **The floor is 30** (a
  default `--yes` init emits exactly 30; `--full` 38) — not "~32". Express
  the floor as a **SKILL.md-file count**, not an emitted-dir count: `SKILLS_MAP`
  has 39 flattened entries, but `dual-mode/` is a source dir with **no `SKILL.md`**
  (only `dual-*.md` + `README.md`). It is excluded from the default `--yes` path
  (`dualMode:false`, `init.ts:973`) **but emitted on `--full`** (`FULL_INIT_OPTIONS`
  sets `dualMode:true`), and `copySkills` copies by dir-existence
  (`executor.ts:960`). So the corpus-shape walk must **pin the expected SKILLS_MAP
  name-set and whitelist `dual-mode/` as a known SKILL.md-less category** — NOT
  blanket-skip every dir lacking a `SKILL.md`, which would silently hide a real
  future missing-`SKILL.md` regression behind the floor count.
* **Honest scope:** this is a *regression guard on the shipped corpus*, not
  a detector for F-07-001 (broken `.agents/scripts` refs) or F-07-002
  (`$dev$null`) — those live in `.agents/skills/`, which init never emits
  and which ADR-0215's source content-invariant gate owns. Do not claim this
  check closes F-07-001/002.
* Per [[reference-cli-cmd-helper]] the new checks invoke `$(_cli_cmd)`,
  never `npx @sparkleideas/cli@latest`. New acceptance group:
  `--group skills-surface`.

### (3) Dedupe: cut entirely; record the upstream convergence

* **Remove** the precedence rule, the dedupe-warning emission, the
  dedupe-emission acceptance gate, and the multi-location CI lint. There is
  no init-time collision: `copySkills()` resolves one source dir
  (`executor.ts:949,956-957`) and `.claude/skills/` has zero intra-source
  name collisions.
* **Do not add a new prune action (in this ADR).** The fork is already
  converged with #1836: `v3/@claude-flow/{cli,mcp}/.claude/skills/` are gone.
  Note `archive/v2/_v2_claude_snapshot/` does **not** match upstream HEAD —
  upstream later deleted `archive/` wholesale (#1882/#1885, `5f0c8455c`),
  which the fork has not yet cherry-picked. Not removing it here is a *scope*
  decision (0216 owns the `.claude/skills/` init surface, not `archive/`
  cleanup); the snapshot is in any case already non-discoverable (not named
  `.claude/`), so it does not affect the Claude-Code listing budget. Adopting
  upstream's `archive/` deletion is a clean future cherry-pick, out of scope
  here.
* **Leave `.agents/skills/` alone** — #1836 did not prune it. If its
  fork-dev-session content needs guarding (corruption / broken refs), that
  is ADR-0215's source/build-tree lane, not an init-layer rule.
* **Add the missing INTEGRATION-LEDGER row** for the #1834/#1835/#1836
  cherry-picks (`6902716f6`/`e6da5c863`), per
  [[feedback-update-integration-ledger]] — currently absent.

### Relationship to ADR-0215 (no overlap)

* **This ADR (0216):** user-facing `.claude/skills/` init surface — the
  `skill list` CLI + a shipped-tree corpus-shape acceptance check.
* **ADR-0215:** `.agents/skills/` + build-tree content integrity (the
  slash→dollar corruption class). The original draft's precedence tier #4
  ("`.agents/skills/` NEVER beats `.claude/skills/`") reached into 0215's
  lane; cutting the dedupe rule removes the overlap.

### Consequences

* Good, because `skill list` makes the command `ruflo init` already
  advertises actually work — closes F-15-001 at the seam where the promise
  is made.
* Good, because the acceptance corpus-shape check closes F-15-102 (the
  audit's highest-value, cheapest item, R-15-A) against the published path.
* Good, because cutting the dead dedupe removes a fork-only divergence from
  an upstream-by-design layout and a perpetual merge tax.
* Good, because adding the #1054 name-slug assertion converges with the
  invariant upstream is actively enforcing.
* Good, because no sibling overlap with ADR-0215.
* Bad, because adding even one CLI command grows the `ruflo` surface
  (G-16-001). Mitigation: `list` is read-only and ships with an acceptance
  check; `validate`/`show`/`install` are all cut.
* Bad, because dropping `validate` leaves *existing* drifted user projects
  without a one-command diagnostic. Mitigation: native Claude Code loading +
  `skill list` surface most of it; a scoped #1054 validator can follow if
  evidence warrants.
* Neutral, because runtime invocation is unchanged — Claude Code still loads
  `.claude/skills/` natively.

### Confirmation

* `ruflo skill list` (the advertised spelling) exits 0 and lists the
  emitted skills; the 5 advertised references resolve to a real command.
* `npm run release` runs `--group skills-surface`: `_run_skills_corpus_shape`
  + `_run_skills_cli_surface` pass against a fresh init'd project; the floor
  assertion is ≥30 (default) / 38 (`--full`).
* The corpus-shape check fails loud if a shipped skill is missing `SKILL.md`,
  has unparseable/`name:`-less frontmatter, has `name:` ≠ dir slug, or
  references a missing script.
* No precedence rule, dedupe-warning, or multi-location lint is added.
* `docs/upstream/INTEGRATION-LEDGER.md` has a row for #1834/#1835/#1836
  (`6902716f6`/`e6da5c863`).

## Pros and Cons of the Options

### Option E — Minimal CLI (`skill list`) + acceptance; no dedupe (chosen)

* Good, because every surviving piece maps to a runtime-true gap
  (advertised-but-missing command; zero acceptance coverage).
* Good, because it re-converges with upstream rather than diverging.
* Good, because it is the smallest change that closes the live gaps.
* Bad, because no `validate` for existing-project drift diagnosis (deferred,
  scoped to #1054 if revived).

### Option C — Minimal CLI (`list`+`validate`) + init dedupe + acceptance (rejected)

Retained with its steelman because the CLI + acceptance instincts were
sound; only the dedupe half and `validate` redundancy are fatal.

* Good, because it bundles CLI symmetry with `plugins`, a dedupe policy, and
  an acceptance gate into one coordinated change.
* Good, because the precedence rule *would* be necessary if `copySkills()`
  ever became multi-source (e.g. merging plugin skills into `.claude/skills/`).
* Bad (fatal), because `copySkills()` is single-source today
  (`executor.ts:949,956-957`); the precedence rule, the
  "drop losers with a warning" mechanism, and the dedupe-emission gate guard
  a code path that cannot produce duplicates. A real `ruflo init` emits 0
  duplicates and the 1106-line `sparc-methodology` already wins with no rule
  — the confirmation gates validate the status quo.
* Bad, because the rule diverges from upstream #1836 (prune, already in
  fork) and imposes a fork opinion (`.agents/skills/` "NEVER beats") on a
  namespace upstream deliberately keeps separate — a perpetual merge tax.
* Bad, because two of the rule's five precedence tiers (`plugin/skills/`,
  `v3/@claude-flow/cli/.claude/skills/`) now reference *empty* directories
  (#1836 deleted them).
* Bad, because `skills validate` reimplements the shell acceptance check's
  three checks — a redundant TS twin that expands the unaudited CLI surface
  the draft itself flags twice (G-16-001).
* Bad, because init-time dedupe does nothing for existing drifted projects
  and cannot reduce the fork-tree file count the `skillListingBudgetFraction`
  knob actually operates on (the draft conflates an init-time policy with a
  session-start listing budget).

### Option A — Full CLI + dedupe + acceptance (rejected)

* Good, because four subcommands cover every CLI use-case.
* Bad, because `show`=`cat`, `install`=the existing `ruflo init skills`
  (`init.ts:939`); over-scoped.

### Option B — Native-only; no CLI (rejected)

* Good, because zero new CLI surface.
* Bad, because it leaves the advertised `ruflo skill list` broken and
  F-15-001 open.

### Option D — Defer CLI; dedupe + acceptance only (superseded by E)

* Good, because smallest scope.
* Bad, because it keeps the dead dedupe and skips the CLI that closes the
  live broken-promise; Option E is strictly better (drops dedupe, keeps the
  CLI that matters).

## Swarm review evidence

Reviewed 2026-05-20 by a 6-expert adversarial swarm (queen + domain
architect + runtime/feasibility + code archaeologist + upstream analyst +
devil's advocate), applying [[feedback-remediation-adr-preflight]]. Surfaces
judged separately:

* **Pre-flight #3 (premise true at runtime) — FAILED for dedupe.** Code
  trace + a real `ruflo init`: `copySkills()` (`executor.ts:919`) copies a
  fixed `SKILLS_MAP` set from a single `findSourceDir('skills')`
  (`:949,956-957`); `.agents/skills/` is never a candidate
  (`findSourceDir`, `:2172-2233`). A default init emits **30 SKILL.md / 30
  unique / 0 duplicates**; `sparc-methodology` = 1106 lines, no rule needed.
  The precedence rule, dedupe-warning, and gates #2/#3 guard an impossible
  path.
* **Pre-flight #2 (upstream already decided) — FIRED.** Upstream PR #1836
  (MERGED 2026-05-07, closes #1834) chose **prune, not precedence**, and is
  **already in the fork** (`6902716f6` re-applying `02976fcb9`; #1835 as
  `e6da5c863`; regression fix `a1561222a`). Upstream deliberately kept
  `.agents/skills/` (132 files, security-governed, #1130/#1461). A fork-only
  precedence rule is a perpetual merge tax. The audit's own remediation
  (`07-skills.md:352-355`) also said "pick a canonical location, delete the
  others, align with #1834" — i.e. prune, the opposite of the draft.
* **Pre-flight #4 (sibling overlap) — FIRED.** The draft's precedence tiers
  reached into `.agents/skills/`, which ADR-0215 owns. Cutting dedupe
  resolves it.
* **Pre-flight #1 (signal reaches audience) — inverted finding.** `ruflo
  init` and generated CLAUDE.md advertise `ruflo skill list` in 5 places
  (`init.ts:525,883`; `claudemd-generator.ts:154,167,179`) but the command
  exits 1. The audience is told to run a command that does not exist —
  strengthening the case to build `list` and reconcile the `skill`/`skills`
  spelling.
* **Inventory re-derivation.** Fork source = 306/238/39 (draft said
  280/239/41); emitted = 30/30/0; `sparc-methodology` = 4 source copies. The
  draft's "3rd copy" was in the ruflo-patch repo, not the fork.
* **Acceptance check.** Feasible and worth keeping, but **vacuous against
  the cited corruption** (F-07-001/002 live in `.agents/skills/`, never
  shipped) — honestly a shipped-tree regression guard. The `validate`
  command duplicates its three checks → cut as redundant.
* **Reconciled disagreement.** The devil's advocate proposed deleting the
  fork's `archive/v2/_v2_claude_snapshot/skills` to "converge with #1836".
  The 2026-05-22 re-validation corrected the 05-20 reconciliation: upstream
  did **not** keep the rename — it later deleted `archive/` wholesale
  (#1882/#1885, `5f0c8455c`, not yet in the fork), so deleting the snapshot
  would actually *converge* with upstream HEAD, not diverge. The queen still
  sides with no prune action **in this ADR** on scope grounds (0216 owns the
  `.claude/skills/` init surface) and because the snapshot is already
  non-discoverable; the `archive/` deletion is a clean future cherry-pick.

### Second council re-validation (2026-05-22)

Re-reviewed by a second 6-expert dialectic council (S2: queen-led, shared-memory,
with the corpus lens tasked to cross-check the validated sibling ADR-0215).
**Verdict: 6× accept-with-edits, 0 needs-rework — Option E stands.** The
archaeologist's words: "notably clean ADR — zero numeric claims off" (every count
re-derived at runtime: SKILLS_MAP=39, 38 SKILL.md, 39 dirs at fork-root
`.claude/skills/`, `copySkills` single-source, 5 advertised `skill list` refs,
sparc-methodology 118/1106/1115/46, INTEGRATION-LEDGER row genuinely absent). The
C→E flip (cut init-time dedupe + `validate`) survived adversarial steelmanning —
dead-code verdict airtight across **both** copy paths (`copySkills` + the
add-missing loop); no multi-source merge on any roadmap. Corrections folded in:

* **Two upstream rationale claims were false (conclusion survives, like 0215's
  over-match finding).** (a) The "Reconciled disagreement" + Decision (3) said
  "upstream HEAD also carries the `_v2_claude_snapshot` rename, so deleting it
  diverges." Verified false: upstream **deleted `archive/` wholesale**
  (#1882/#1885, `5f0c8455c`, *not* an ancestor of fork HEAD), so deleting the
  snapshot would *converge*. The no-prune-here call stands on scope +
  non-discoverability. (b) "`.agents/skills/` is security-governed by design
  (#1130/#1461)" — both issues are CLOSED Windows-Defender **false positives**,
  and #1834 calls the bridges "likely safe to consolidate." Softened to "untouched
  by #1836," not "sacred." Neither claim is load-bearing — the dead-dedupe verdict
  rests on single-source `copySkills` + zero `agent-*` in SKILLS_MAP.
* **The SKILL.md-less `dual-mode/` edge fires on plain `--full`, not a
  hypothetical `--all`.** `FULL_INIT_OPTIONS` sets `dualMode:true`, and the ADR's
  own `--full` confirmation gate exercises the path. The ADR's "excluded from
  `--yes`/`--full`" was wrong for `--full`. Hardened the remedy: **pin the expected
  SKILLS_MAP name-set + whitelist `dual-mode/` explicitly** rather than blanket-skip
  dirs lacking a `SKILL.md` (which would hide a real future missing-`SKILL.md`
  regression behind the floor count).
* **`validate` deferral tightened** from soft ("if evidence warrants") to a
  concrete follow-up gated on #1587/#1938 landing — the one objection that landed
  (cutting `validate` drops an existing-project diagnostic) is real, and the
  non-redundant #1054 validator is the right home for it.
* **`depends-on: [ADR-0201]` → `[0201]`** (the prefixed-form outlier; bare-number
  is the cohort convention — unanimous across lenses).
* **Coupled back-edit to ADR-0215:** its Relationship/Related-ADRs/Option-F text
  still described 0216 as owning `skills validate` + the dedupe/precedence policy
  (both cut by Option E). Updated 0215 to "`skill list` CLI + corpus-shape check."
* **Minor:** `new Set` dedupe is at `executor.ts:956` (ADR cites `:957`); the
  shipping source is fork-root `.claude/skills/`, not `cli/.claude/skills` (#1836
  pruned that); `skill list` should enumerate the emitted `${cwd}/.claude/skills`
  directly rather than reuse `findSourceDir`'s source resolution.

**Held under re-check:** #1836 = prune-not-precedence (verified: the PR diff touches
**zero `.ts` files**); the 0215↔0216 lane separation (bidirectionally consistent on
the zero-`agent-*`-in-SKILLS_MAP fact); MADR structure (`### Consequences` correctly
nested, no stale Option-C-as-chosen); state not stale (`skill list` genuinely
unimplemented, LEDGER row absent).

## More Information

* `docs/audits/2026-05-19-soundness-audit/15-runtime-skills-and-test-coverage.md`
  — F-15-001 (no CLI), F-15-102 (no acceptance check), R-15-A (corpus walk,
  adopted), R-15-B (CLI symmetry, adopted as `list` only).
* `docs/audits/2026-05-19-soundness-audit/07-skills.md` — F-07-001 (broken
  `.agents/scripts` refs), F-07-002 (`$dev$null`, owned by ADR-0215),
  F-07-003 (duplicates), F-07-006 (134 `.agents/skills/` agent-skills),
  remediation `:352-355` ("prune, align with #1834").
* `docs/audits/2026-05-19-soundness-audit/16-gap-analysis.md` — G-16-001
  (CLI beyond daemon/init mostly unaudited).
* Upstream issue **#1834** (CLOSED) + PR **#1836** (MERGED 2026-05-07,
  `02976fcb9`) — prune duplicate skill sources + drop archive discovery; in
  fork as `6902716f6`. #1835 (`e6da5c863`). Related upstream skills work:
  **#1054** (name ≠ dir slug; PRs #1587/#1938, OPEN) — the convergence-
  friendly `validate` target if revived; #1504 / #994 (corpus shrink);
  #1130/#1461 (`.agents/skills/` is governed, not cruft).
* `forks/ruflo/v3/@claude-flow/cli/src/init/executor.ts` — `SKILLS_MAP`
  (`:37`), `copySkills()` single-source (`:919,949,956-957`),
  `findSourceDir()` (`:2172-2233`).
* `forks/ruflo/v3/@claude-flow/cli/src/commands/init.ts:525,883,939` — the
  advertised `skill list` strings + the existing `init skills` installer.
* `forks/ruflo/v3/@claude-flow/cli/src/init/claudemd-generator.ts:154,167,179`
  — generated CLAUDE.md advertises `skill list`.
* `docs/adr/ADR-0215-codemod-golden-master-test.md` — sibling; owns
  `.agents/skills/` content integrity (lane split).
* `docs/upstream/INTEGRATION-LEDGER.md` — needs a row for #1834/#1835/#1836.

### Memory references shaping the decision

* [[feedback-remediation-adr-preflight]] — checks #1 (inverted), #2, #3, #4
  all fired.
* [[feedback-update-integration-ledger]] — the missing #1836 row.
* [[feedback-inspect-installed-not-dev-nodemodules]] — acceptance check runs
  on a fresh init'd project.
* [[feedback-corpus-evidence-before-feature-work]] — don't build a
  precedence arbiter before a multi-source merge exists.
* [[feedback-no-fallbacks]] — corpus-shape failures fail loud.
* [[reference-cli-cmd-helper]] — `$(_cli_cmd)` for the new acceptance group.
* [[reference-claude-plugin-install]] — `ruflo plugins` (IPFS) is distinct
  from `ruflo skill` (Claude Code skills).
