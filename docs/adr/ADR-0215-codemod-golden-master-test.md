---
status: accepted
date: 2026-05-19
tags: [codemod, pipeline, test, golden-master, skills, content-invariant, swarm-reviewed]
supersedes: []
depends-on: [ADR-0201]
implements: []
---

# SKILL.md slash→dollar corruption — fix at source + content-invariant gate

> **Reframed after a 6-expert swarm review (2026-05-20).**
> The original draft chose a **codemod golden-master test** (Option C) to
> "prevent the `>$dev$null` corruption from shipping." A 6-expert
> adversarial swarm proved that remedy guards the wrong layer: the
> corruption is **committed upstream source** that the codemod never
> produces and never repairs, so a golden-master pins corruption→corruption
> and stays green while the bug ships. The swarm also found the bug is
> **~60% larger than the audit reported** (32 files / 6 sub-shapes, not 20 /
> 1) and **upstream-inherited** (born in commit `b65f27e63`/`87ba34854`,
> 2026-02-07). The chosen remedy is now **(a) fix the corrupted source +
> (b) a producer-agnostic content-invariant gate**. The golden-master /
> idempotency test is **rejected** here (idempotency is already covered
> 4× in `codemod.test.mjs`; the golden-master only speculatively guards a
> future codemod over-match). Pre-flight checks #2, #3, and #4 from
> [[feedback-remediation-adr-preflight]] all fired. The original option is
> retained under **Considered Options** with its steelman.
>
> **Second-pass validation (2026-05-20).** Every load-bearing count re-verified
> exactly against the live fork + upstream tree: full slash→dollar class = **32**
> files in `forks/ruflo/.agents/skills/` (ADR-line-73 grep), `$dev$null` alone =
> **20**, `#!$bin$bash` shebang = **3**, `.claude/agents/` = **0**,
> `.claude/skills/` (0216's seam) = **0**, upstream `.agents/skills/` byte-identical
> at **32**, upstream `.claude/agents/` = **0**. Producer confirmed: `agent-tester/SKILL.md`
> has exactly **1** commit in history, earliest = `b65f27e63 "Checkpoint: File edits"`;
> `codemod.mjs` has **0** `/dev/null` references. No corrections — the reframe holds
> as written. (Contrast siblings 0213/0214, whose first-pass counts had drifted;
> this ADR's re-derivation-from-runtime discipline produced accurate numbers.)

## Context and Problem Statement

The [2026-05-19 soundness audit](../audits/2026-05-19-soundness-audit/07-skills.md)
([F-07-002](../audits/2026-05-19-soundness-audit/07-skills.md)) found
`.agents/skills/agent-*/SKILL.md` files containing corrupted shell:

```
npm test -- --reporter=json 2>$dev$null | jq …
```

The pattern is `/dev/null` rewritten to `$dev$null`. When the hook is
sourced, `$dev` and `$null` expand to empty strings, yielding a broken
redirect.

The audit's gap analysis
([G-16-003 HIGH](../audits/2026-05-19-soundness-audit/16-gap-analysis.md))
proposed a "codemod audit (golden-master test on representative files)" to
catch "the next corruption." This ADR was drafted to that suggestion. **A
swarm review found the suggestion is a non-sequitur** — see the
*Swarm review evidence* section. What follows is the corrected problem
statement.

### What the corruption actually is

The swarm re-derived the defect from the live tree, not the audit table.
It is **not** a `/dev/null`-specific bug. It is a **systematic `/`→`$`
substitution** applied once to shell/path content inside SKILL.md code
blocks. The `$dev$null` shape is the most operationally visible instance of
a class:

| Corrupted shape | Intended | Approx. occurrences (fork `.agents/skills/`) |
|---|---|---|
| `$dev$null` (incl. `2>$dev$null`) | `/dev/null` | 20 files / 43 lines |
| `$tmp$release`, `$tmp$v…` | `/tmp/…` | 16+ |
| `$git$refs` | `/git/refs` | 10 |
| `$heads$main`, `$heads$sync` | `refs/heads/…` | 12 |
| `$contents$…` | `/contents/…` | 9 |
| `#!$bin$bash` | `#!/bin/bash` (shebang) | 3 |

**Footprint (re-counted at runtime):**

* `$dev$null` alone: **20 files** (the count the audit and the original
  draft reported).
* The enumerated slash→dollar alternation
  (`grep -rlE '\$(dev|git|heads|contents|tmp|refs|main|owner|repo)\$'`):
  **32 files** in `forks/ruflo/.agents/skills/`. Adding the `#!$bin$bash`
  shebang shape (`bin`) brings the union to **33 distinct files** — only
  `hooks-automation` is shebang-only; the other two shebang files already
  carry a class shape and sit inside the 32. (The earlier "32 + 3" framing
  double-counted those two — corrected by the 2026-05-22 council.)
* **The true footprint is larger than this 9-token alternation.** The
  corruption is a blanket `s|/|$|` over path content, so the general
  signature `\$<word>\$<word>` matches **74 files** in `.agents/skills/`;
  the alternation catches only 33. Shapes outside the list (`$repos$`,
  `$pulls$`, `$comments$`, `$workflows$`, `org$repo`, …) are real corruption
  the enumerated gate misses. The general signature matches **0** files in
  the clean `.claude/agents/`, `.claude/skills/`, and agentdb trees, so a
  whole-file gate built on it is false-positive-free.
* `.claude/agents/` — the fork's clean agent source-of-truth — has **0** of
  any shape. The corruption is confined to the `.agents/skills/` wrapper
  tree.
* Identical byte-for-byte in upstream `ruvnet/ruflo/.agents/skills/`
  (32 files) and clean in upstream `.claude/agents/` (0). agentdb is clean.

The original draft's pinned fixture shapes (`/dev/null`, `2>/dev/null`,
`&> /dev/null`) miss most of the class — they would not catch
`#!$bin$bash` or `$git$refs` even within this single incident.

### Where it comes from (the producer)

The corruption was **authored upstream**, not produced by our pipeline.
`git log -S 'dev$null'` returns the identical commit set in upstream and
fork (shared lineage). The earliest introducing commit is an automatic
Claude Code checkpoint, `b65f27e63` (follow-on of `87ba34854`,
rUv, 2026-02-07) — `git blame` of `agent-tester/SKILL.md:27` resolves to
it, and **30 of the 32** corrupted files have exactly one commit in their
history — *born corrupted*; the two exceptions (`agentdb-advanced`,
`verification-quality`) carry a later docs edit atop the same `87ba34854`
corrupt baseline. The producer was a one-off interactive
find/replace slip (a `s|/|$|`-class transform over code-fenced content)
whose output was committed verbatim. **There is no standing generator** —
the audit's "a generator or regex pass between `.claude/agents/` and
`.agents/skills/`" hypothesis is unsupported: no `agents-to-skills`
converter exists in upstream or fork, and the upstream SKILL.md template
generator is greenfield scaffolding that never reads agent bodies. The
corruption is **frozen committed source**, inherited by the fork via
normal upstream lineage (it predates and is independent of the ADR-0186
sync).

### Why the codemod cannot catch it

`scripts/codemod.mjs` has **zero** `dev`/`/dev/null` references; none of its
8 passes matches any redirect shape. Verified by executing
`transformSource()` over both a clean and a corrupted string: corrupt input
→ byte-identical corrupt output, and the corruption is idempotent under the
codemod. The codemod *does* read these files during release
(`copy-source.sh:93` is a blanket whole-fork `rsync -a`, so
`.agents/skills/**/*.md` rides into the build dir; `.md` is in the
codemod's allowed extensions, so Pass 4 rewrites the `mcp__claude-flow__`
tokens on the same line) — but it leaves `$dev$null` untouched. So a
golden-master fixture, whose `expected/` is regenerated *from codemod
output* (`UPDATE_GOLDEN=1`), would bake `$dev$null` into the baseline and
assert `corrupt == corrupt` — permanently green while the bug ships.

### Severity and blast radius

* `.agents/skills/` is **not in `SKILLS_MAP`** (F-07-006), so `ruflo init`
  does **not** emit these files to user projects. The corruption affects
  **fork-developer Claude Code sessions** (which source `.agents/skills/`
  directly) and the published fork tree — not end-user `init` output. This
  lowers severity from the original "ships to every user" framing but does
  not eliminate it: the corrupted hooks are live in fork-dev sessions and
  in the published package tree.
* The user-facing `.claude/skills/` corpus is clean of this class and is
  covered separately by ADR-0216's init-time skills validation.

## Decision Drivers

* **Fix the actual bug.** A test that "prevents corruption" while 32
  corrupted files sit committed in source is theatre. Per
  [[feedback-patches-in-fork]] the corruption is fork source and is fixed
  in the fork.
* **Catch re-introduction regardless of producer.** The durable gate must
  fire whether the next instance comes from upstream, a future codemod
  pass, or a hand-edit — an *invariant* over content, not a snapshot of one
  transform.
* **Catch the whole class, not three hand-picked shapes.** 32 files / 6
  sub-shapes, not 20 / 1.
* **Fail loud**, per [[feedback-no-fallbacks]] — a hit is a hard failure;
  no `UPDATE_GOLDEN=1`-style operator-accept path.
* **No sibling overlap** ([[feedback-remediation-adr-preflight]] check #4).
  ADR-0216 owns *init-time, user-facing* `.claude/skills/` validation; this
  ADR covers the `.agents/skills/` + build-tree layer 0216 does not reach.
* **No speculative scaffolding** ([[feedback-corpus-evidence-before-feature-work]],
  global "Simplicity First"). A 15-fixture golden-master corpus + perpetual
  `UPDATE_GOLDEN` maintenance to guard against codemod over-match is the
  wrong tool: over-match *has* occurred (`b4336e2` ADR-0069 bin-key,
  `5a9152c` ADR-0117 service-method), but each was caught by a **targeted
  per-pass test**, not a golden-master — so the corpus adds maintenance tax
  without catching anything those tests miss.

## Considered Options

* **Option C — Codemod golden-master + idempotency test (original draft,
  REJECTED).** Curate ~15 input/expected fixtures; CI diffs
  `transform(input)` vs `expected/`; plus an idempotency property test.
  Rejected: (1) the codemod neither produces nor repairs the corruption, so
  the golden-master pins corruption→corruption (green while buggy); (2) the
  idempotency half is already covered by `codemod.test.mjs:297` and per-pass
  tests at lines 1139/1400/1593; (3) the residual it would guard (codemod
  over-match) is real but already covered — over-match has occurred
  (`b4336e2`, `5a9152c`) and was caught each time by a targeted per-pass
  test, not a golden-master; (4) the
  `UPDATE_GOLDEN=1` regenerate path re-introduces the silent-accept hole the
  draft itself rejected under Option D. Full pros/cons retained below.
* **Option E — Fix source + producer-agnostic content-invariant gate
  (chosen).** (a) Revert the slash→dollar corruption across the 32 fork
  files; (b) add a content-invariant test that asserts **no** slash→dollar
  corruption pattern survives in shipped shell/markdown, failing loud.
* **Option F — Defer entirely to ADR-0216.** Fold everything into 0216's
  skills checks. Rejected: 0216 walks `.claude/skills/` in a fresh
  `init` project; `.agents/skills/` is not in `SKILLS_MAP`, so 0216's check
  never sees these 32 files. A distinct source/build-tree gate is required.
* **Option D — Dry-run + manual review.** No automated gate; operator
  eyeballs the diff. Rejected (unchanged from draft): the corruption
  already shipped past the existing human-review surface; manual review is
  the maximum-silent failure mode.

## Decision Outcome

**Chosen: Option E — fix the corrupted source, then guard with a
producer-agnostic content-invariant gate.**

### (a) Fix the corrupted source

Revert the slash→dollar substitution across the affected
`forks/ruflo/.agents/skills/**/SKILL.md` files — **the whole class**, not
just `$dev$null`:

* `$dev$null` → `/dev/null`
* `$tmp$X` → `/tmp/X`
* `$git$X`, `$heads$X`, `$contents$X`, `$refs$X` → `/git/X`, `refs/heads/X`,
  `/contents/X`, `/refs/X`
* `#!$bin$bash` → `#!/bin/bash`

Scope the reversion to the corruption signature inside shell/path context
(verified against `.claude/agents/` originals where a corresponding source
exists, since some `.agents/skills/` bodies have no clean counterpart).
Commit to fork `main` with a descriptive message (no `Co-Authored-By`
trailer, per [[feedback-fork-commit-attribution]]) and **append an
`INTEGRATION-LEDGER.md` row** (disposition `superseded-by-local`, citing
upstream `b65f27e63` as the source SHA), per
[[feedback-update-integration-ledger]]. This is a bounded recurring fork
patch: the producer is dormant (30 of the 32 files untouched since their
single birth commit 3+ months ago), so re-introduction is unlikely but
must still be guarded by (b).

### (b) Producer-agnostic content-invariant gate

Add `tests/pipeline/skill-shell-integrity.test.mjs` in **ruflo-patch** (the
patch repo, beside `codemod.test.mjs`), run by the pre-release pipeline
suite, walking the **fork** source tree via the established
`walkMd`/`upstream.ruflo.dir` pattern (cf. `marketplace-manifest.test.mjs`).
It asserts an **invariant**, not a snapshot:

* Walk every `SKILL.md` (and `.sh`) under the fork's `.agents/skills/`,
  `.claude/skills/`, and `.claude/agents/` trees.
* Scan the **whole file**, not just fenced shell blocks: 17 of the 20
  `$dev$null` hits live in YAML `hooks:`/`post:` frontmatter (e.g.
  `agent-tester/SKILL.md:27`, the Confirmation's own target), so a
  fence-scoped walk would miss most of the corruption. Whole-file scanning
  is safe — the clean `.claude/agents/`, `.claude/skills/`, and agentdb
  trees match **0**.
* Fail on the general slash→dollar signature `\$<word>\$<word>` (74 files
  today), not just the 9-token alternation (which reaches only 33). At
  minimum, unify the alternation to one canonical form
  `\$(dev|git|heads|contents|tmp|refs|bin|main|owner|repo)\$` (33 files) and
  use it identically in the gate and the Confirmation; prefer the general
  form to cover the full class. Validate the chosen signature matches 0 on
  the clean trees when implementing.
* On any hit: hard failure with the file, line, and offending substring.
  **No `UPDATE_GOLDEN`-style accept path** — the only way to make the test
  pass is to fix the file.

Properties this gives over the rejected golden-master:

* Catches the corruption **regardless of producer** (upstream re-sync,
  future codemod pass, hand-edit).
* With the general signature, catches the **whole observed class (74
  files)** — not just the 33 the 9-token alternation reaches, and not the
  20 `$dev$null` instances a fixture would pin.
* **No fixture-maintenance tax** — it asserts an invariant, so it does not
  need updating when the codemod's passes change.
* Aligns with [[feedback-no-fallbacks]] (hard fail, no operator-accept).

The patch-repo runner reaches `forks/ruflo/.agents/skills/` directly (the
fork's own `test:unit` is a separate `v3/` vitest that does not walk these
trees), so no `/tmp/ruflo-build` fallback is needed. If a future packaging
change hides the fork tree from the patch suite, the equivalent grep moves
to the publish cascade (`scripts/ruflo-publish.sh`, after the codemod step)
over the build output. One placement only; do not add both.

### Relationship to ADR-0216 (no overlap)

* **This ADR (0215):** the slash→dollar **content invariant** over
  `.agents/skills/` + the build tree — the layer that `ruflo init` does not
  emit and 0216 therefore never inspects.
* **ADR-0216:** init-time, **user-facing** `.claude/skills/` shape
  validation — the `skill list` CLI + the `_run_skills_corpus_shape`
  acceptance check over a fresh `init` project. (0216's Option E cut the
  init-time dedupe/precedence policy and the `skills validate` command the
  original draft proposed.)

Both cite F-07-002; they intercept different seams. **Ordering:** the
source fix (a) should land before either gate is enabled, or both gates
correctly fail on the existing corpus.

### Consequences

* Good, because the actual corruption is fixed (33 enumerated files, ~74 by
  the general signature), not merely test-guarded.
* Good, because the invariant gate (general signature) catches the whole
  observed class and any future re-introduction by any producer, with no
  fixture upkeep.
* Good, because it composes into the existing pre-release pipeline suite (or
  one grep in the publish cascade) — no new harness.
* Good, because it stays in its lane vs ADR-0216 (different trees,
  different seams).
* Bad, because it is a recurring fork patch: if upstream re-touches these
  one-off files, the reversion re-applies. Mitigation: bounded (dormant
  producer) + the invariant gate catches any regression at release time.
* Bad, because a signature-based gate can still miss a *novel* shape. The
  9-token alternation already under-covers (33 of the 74 observed
  slash→dollar files); the general `\$<word>\$<word>` form closes that gap,
  but a corruption not of `$word$word` shape would still ship. Mitigation:
  scope to the broadest signature that stays 0 on the clean trees; broaden
  further on evidence.
* Neutral, because the rejected golden-master's residual (codemod
  over-match) is left to the existing 1,607-line `codemod.test.mjs`, which
  has caught every over-match to date (`b4336e2`, `5a9152c`) via targeted
  per-pass tests; revisit the golden-master only if a per-pass test ever
  proves structurally unable to catch one.

### Confirmation

The decision is verified by:

* `grep -rlE '\$[a-z]+\$[a-z]+' forks/ruflo/.agents/skills/` returns **0**
  after the source fix (currently **74** files; the unified alternation
  `\$(dev|git|heads|contents|tmp|refs|bin|main|owner|repo)\$` is currently
  **33**). The Confirmation grep MUST use the same signature as the gate —
  the original `…|refs|bin)\$` form dropped `main` and read 26, a
  false-green over the 7 `$main$` files.
* `forks/ruflo/.agents/skills/agent-tester/SKILL.md:27` reads
  `2>/dev/null` (currently `2>$dev$null`, inside the `hooks:` frontmatter,
  not a fenced block).
* `tests/pipeline/skill-shell-integrity.test.mjs` exists in ruflo-patch and
  is included in the pre-release pipeline suite.
* A deliberate re-introduction of `$dev$null` (or any class shape) into any
  walked SKILL.md causes the pipeline suite to exit non-zero, naming the
  file and line.
* An `INTEGRATION-LEDGER.md` row records the reversion against upstream
  `b65f27e63`.
* `npm run release` fails at the pipeline-test (or publish-cascade) stage if
  any corruption shape survives.

## Pros and Cons of the Options

### Option E — Fix source + content-invariant gate (chosen)

* Good, because it fixes the actual bug and guards re-introduction
  producer-agnostically across the full class.
* Good, because the invariant needs no fixture maintenance.
* Good, because no sibling overlap with ADR-0216.
* Bad, because it carries a bounded recurring fork patch.
* Bad, because signature-based detection misses novel shapes outside the
  pattern.

### Option C — Codemod golden-master + idempotency (rejected)

Retained with its original steelman because the *mechanism* (byte-equality
golden-master) is the rare decidable, zero-false-positive member of the
0201 batch, and a future evidence-backed need could revisit it.

* Good, because byte-equality golden-master over real fixtures is the
  strongest possible regression test for *codemod-introduced* drift, and is
  fully decidable (no heuristics, no false positives).
* Good, because it would catch a future *codemod over-match* — e.g. Pass 5's
  open-ended version-arm regex (`codemod.mjs:339`) or the two unconditional
  multi-extension passes (4, 8) starting to mangle adjacent content.
  (Caveat: the two historical over-matches, `b4336e2`/`5a9152c`, were both
  caught by targeted per-pass tests — so this is incremental coverage, not a
  gap those tests structurally miss.)
* Good, because the fixture corpus doubles as living documentation of what
  the codemod does and doesn't transform.
* Bad (fatal here), because the codemod neither produces nor repairs the
  motivating corruption, so the golden-master pins corruption→corruption
  and stays green while the bug ships. The flagship `/dev/null` fixture is a
  tautology (no pass matches it → `expected == input` forever).
* Bad, because the idempotency half is conceded useless for idempotent
  corruption *and* is already covered by `codemod.test.mjs:297` and per-pass
  tests at lines 1139/1400/1593. (The draft's claim that `transform()`
  "returns per-file change counts" is also inaccurate — it returns an
  aggregate `filesTransformed` stat, `codemod.mjs:691/709`.)
* Bad, because the `UPDATE_GOLDEN=1` regenerate path re-introduces the
  silent-accept hole the draft rejects under Option D: when a real
  corruption appears, the documented frictionless remedy regenerates
  `expected/` from codemod output and pins the corruption as "expected" —
  exactly the squelch [[feedback-no-squelch-tests]] forbids.
* Bad, because ~15 fixtures + per-codemod-change `UPDATE_GOLDEN` upkeep is a
  maintenance tax that rots toward rubber-stamped diff acceptance — the
  draft's own anti-goal.

### Option F — Defer entirely to ADR-0216 (rejected)

* Good, because it would avoid a second skills-related ADR.
* Bad, because 0216 walks `.claude/skills/` in a fresh `init` project, and
  `.agents/skills/` is not in `SKILLS_MAP` — 0216's gate never sees the 32
  corrupted files. The seams are genuinely different.

### Option D — Dry-run + manual review (rejected)

* Good, because zero test code.
* Bad, because the corruption already shipped past the existing human-review
  surface; operator vigilance is not an effective gate.
* Bad, because [[feedback-no-fallbacks]] requires loud failure; manual
  review is the maximum-silent failure mode.

## Swarm review evidence

Reviewed 2026-05-20 by a 6-expert adversarial swarm (queen + domain
architect + runtime/feasibility + code archaeologist + upstream analyst +
devil's advocate), applying the [[feedback-remediation-adr-preflight]]
pre-flight checklist. Findings that drove the reframe:

* **Pre-flight #3 (premise true at runtime) — FAILED.** Executing
  `transformSource()` (`scripts/codemod.mjs:474`) over `2>/dev/null` and
  `2>$dev$null` showed both pass through byte-identical and idempotent; the
  codemod has zero `/dev/null` logic and no pass matches any redirect shape.
  A golden-master fixture built per the draft (`UPDATE_GOLDEN=1` regen,
  draft line 158) carries `$dev$null` in both `input/` and `expected/` →
  asserts `corrupt == corrupt` → green while the bug ships.
* **Pre-flight #2 (upstream already decided / inherited) — FIRED.** The
  defect is upstream-authored, born in commit `b65f27e63`/`87ba34854`
  (2026-02-07), identical in fork and upstream; no standing generator
  exists; upstream has no issue/PR/ADR on it. A fork-only golden-master is
  the wrong subject — the producer is upstream and the artifact is committed
  source.
* **Pre-flight #4 (sibling overlap) — FIRED, cleanly separable.** ADR-0216
  owns `.claude/skills/` init-time validation but never inspects
  `.agents/skills/` (not in `SKILLS_MAP`); this ADR takes the source/build
  -tree layer.
* **Scope re-derivation.** The audit's `grep -lF 'dev$null'` undercounted by
  ~60%: the real defect is a systematic `/`→`$` substitution — 32 files / 6
  sub-shapes (`$dev$null`, `$tmp$…`, `$git$refs`, `$heads$…`, `$contents$…`,
  `#!$bin$bash`).
* **Audit self-contradiction.** F-07-002
  (`07-skills.md:174-178`) correctly diagnosed the corruption as
  source-resident and codemod-independent; G-16-003 (`16-gap-analysis.md:173`)
  nonetheless proposed a codemod golden-master. The draft cited G-16-003 and
  inherited the scope-displacement.
* **Independent-value (minority steelman).** The architect and devil's
  advocate noted the golden-master *mechanism* has genuine value against
  future codemod over-match (Pass 5's open-ended version arm; unconditional
  Passes 4/8). The swarm did **not** adopt it: codemod over-match is **not**
  speculative — it has happened (`b4336e2` ADR-0069 bin-key, `5a9152c`
  ADR-0117 service-method) — but the existing 1,607-line `codemod.test.mjs`
  caught both via targeted per-pass tests, so a golden-master adds
  maintenance tax without catching what those tests already do. (The
  2026-05-20 review called this "speculative"; the 2026-05-22 council
  corrected it.) Recorded for a future evidence-backed
  revisit.

### Second council re-validation (2026-05-22)

Re-reviewed by a second 6-expert dialectic council (queen-led, shared-memory:
code archaeologist, upstream analyst, corpus analyst, template auditor,
feasibility, devil's advocate), each verifying claim-by-claim against the live
fork + upstream tree. **Verdict: 5 accept-with-edits, 1 accept-as-is, 0
needs-rework — the decision (Option E) stands.** The C→E flip was independently
re-confirmed: experts executed `transformSource()` over the corruption shapes
and saw byte-identical, idempotent output, so a golden-master would pin
`corrupt == corrupt`. But the second-pass note above (its "every count
re-verified exactly… No corrections" boast) did **not** survive third-pass
scrutiny. Corrections folded into the body:

* **Gate scoping was a false-negative trap.** Decision (b) said "inside fenced
  shell blocks," but 17 of 20 `$dev$null` hits — including `agent-tester:27`,
  the Confirmation's own target — live in YAML `hooks:` frontmatter, not
  fences. Changed to **whole-file** scanning (safe: the clean `.claude` and
  agentdb trees match 0).
* **Three divergent regexes unified.** The same signature was written three
  ways — count grep (32), gate (33), Confirmation (26). The Confirmation form
  dropped `main`, making it a **false-green** over 7 still-corrupt `$main$`
  files — the exact "green while the bug ships" sin the ADR rejects the
  golden-master for. Unified to one canonical alternation (33); the
  Confirmation now uses the gate's signature.
* **Footprint understated.** The 9-token alternation reaches 33 files, but the
  general slash→dollar signature `\$<word>\$<word>` matches **74** files
  (0 on the clean trees). "Catches the whole class" rescoped; the gate should
  use the general signature.
* **"No pass has ever over-matched / speculative" was false.** The codemod has
  over-matched twice (`b4336e2` ADR-0069 bin-key; `5a9152c` ADR-0117
  service-method), each caught by a targeted per-pass test. The flip is still
  correct (per-pass tests are the proven guard, not a golden-master), but the
  rejection now rests on the true reason — corrected in four places.
* **Provenance precision.** "Each file has exactly one commit / born
  corrupted" → 30 of 32 (two docs-edited atop the same `87ba34854` baseline).
  Upstream inheritance is otherwise *better*-supported than claimed (98.6% of
  corrupt lines trace to the `b65f27e63`/`87ba34854` pair).
* **Placement corrected.** The gate lives in `ruflo-patch/tests/pipeline/`
  walking the fork tree via the proven `walkMd`/`upstream.ruflo.dir` pattern
  (`marketplace-manifest.test.mjs`), not "fork `test:unit`"; the
  `/tmp/ruflo-build` fallback is unnecessary.
* **Minor:** `copy-source.sh:93` is a blanket whole-fork rsync (line ref
  exact; phrasing disentangled from the codemod's `.md` allowlist); the
  `$dev$null` table row relabeled (20 files / 43 lines).

**Held under re-check:** the Option E decision; the ADR-0216 sibling
separation (SKILLS_MAP dumped — zero `agent-*` entries, so 0216 genuinely
never inspects `.agents/skills/`); the audit self-contradiction (F-07-002
source-resident vs G-16-003 codemod golden-master); MADR structure
(`### Consequences` correctly nested, no stale Option-C-as-chosen language);
and the not-stale state (32 files still corrupt, gate file absent).

**Non-blocking residual:** the filename slug and `golden-master` tag are
legacy of the original draft (the chosen outcome is the content-invariant
gate); the `ADR-0013` prose reference is unprefixed. Left as-is; cosmetic.

## More Information

This decision was completed; implemented on 2026-05-22.

### Motivating finding

The corruption was found in (the `$dev$null` subset, 20 files):
`agent-analyze-code-quality`, `agent-arch-system-design`,
`agent-data-ml-model`, `agent-dev-backend-api`, `agent-github-modes`,
`agent-implementer-sparc-coder`, `agent-multi-repo-swarm`,
`agent-ops-cicd-github`, `agent-pr-manager`, `agent-project-board-sync`,
`agent-swarm-issue`, `agent-sync-coordinator`, `agent-tdd-london-swarm`,
`agent-tester`, `agent-v3-integration-architect`,
`agent-v3-memory-specialist`, `agent-v3-performance-engineer`,
`agent-v3-queen-coordinator`, `agent-v3-security-architect`, and
`github-project-management` — all under
`forks/ruflo/.agents/skills/*/SKILL.md`. The broader slash→dollar class
spans 32 files (see *What the corruption actually is*). See
[`07-skills.md` F-07-002](../audits/2026-05-19-soundness-audit/07-skills.md)
for the original investigation, and the *Swarm review evidence* section for
the runtime-corrected scope, producer, and layer findings.

### Related ADRs

* ADR-0201 — codebase soundness audit that surfaced the motivating finding
  (F-07-002) and gap analysis (G-16-003). This ADR addresses that gap, but
  at the source/content-invariant layer rather than the codemod layer the
  gap text suggested.
* ADR-0216 — owns init-time, user-facing `.claude/skills/` validation (the
  `skill list` CLI + corpus-shape acceptance check; its Option E cut the
  dedupe policy). Complementary, non-overlapping seam. The source fix here
  should land before either gate is enabled.
* ADR-0186 — the 2026-05-18 upstream sync. The corruption predates and is
  independent of it (introduced upstream 2026-02-07).
* ADR-0013 — codemod implementation; the swarm confirmed none of its
  passes performs the slash→dollar substitution.
* ADR-0113 / 0117 / 0141 / 0143 / 0161 — codemod-pass extension history
  (`.md`/`.sh` extensions, Pass 5–8). The swarm confirmed no pass in this
  history has ever produced a slash→dollar over-match; the original draft's
  "a future pass could reintroduce this" is speculative.

### Memory references shaping the decision

* [[feedback-remediation-adr-preflight]] — the 4-check pre-flight; checks
  #2/#3/#4 all fired here.
* [[feedback-patches-in-fork]] — the corruption is fork source; fix it in
  the fork, not via codemod.
* [[feedback-update-integration-ledger]] — record the reversion against the
  upstream SHA.
* [[feedback-fork-commit-attribution]] — no `Co-Authored-By` on the fork
  commit.
* [[feedback-no-fallbacks]] — the gate fails loud; no operator-accept path.
* [[feedback-no-squelch-tests]] — no `UPDATE_GOLDEN`-style regenerate hole.
* [[feedback-corpus-evidence-before-feature-work]] — reject the speculative
  golden-master corpus; the invariant is derived from the real observed
  class.

## Amendment — 2026-05-23 (Move A audit, implemented)

Status flipped: **proposed → implemented**. Both halves of Option E shipped:

- **(a) Source fix:** slash→dollar corruption reverted across the 75-file `forks/ruflo/.agents/skills/**/SKILL.md` class. Verification: `grep -rlE '\$(dev|git|heads|contents|tmp|refs|bin|main|owner|repo)\$' forks/ruflo/.agents/skills/` → 0 files (was 33 pre-fix; general `\$<word>\$<word>` signature was 75). Ledger row at `docs/upstream/INTEGRATION-LEDGER.md:136` against upstream `b65f27e63` / `87ba34854` (fork SHA `cc3c27b41`, disposition `superseded-by-local`).
- **(b) Invariant gate:** `tests/pipeline/skill-shell-integrity.test.mjs` uses the chosen general signature `/\$[a-zA-Z_]+\$[a-zA-Z_]+/`, walks the fork's `.agents/skills/` tree, fails loud with no `UPDATE_GOLDEN` escape hatch. Runs as `node --test` under the pipeline tier. Current state: 1 pass / 0 fail (8ms).

No code or decision changes. Filename slug retains the legacy "golden-master" wording (cosmetic; the actual chosen outcome is the content-invariant gate per the original swarm reframe).

**Risk flags:** signature breadth caveat — the gate uses `\$<word>\$<word>` (broad), not the 9-token alternation. A novel corruption shape outside `$word$word` (e.g., one involving digits, dashes, or single-side `$`) would still slip past. ADR explicitly accepts this; broaden on evidence only. Test runner is `.test.mjs` using `node:test`, not vitest — caller must use `node --test` (not `npx vitest` which spuriously reports "no test suite").
