# 2026-05-25 — INTEGRATION-LEDGER superseded-by-adr audit (6 rows)

Audit of all `| superseded-by-adr |` rows in
`docs/upstream/INTEGRATION-LEDGER.md`. Each row claims a local ADR's
§Decision substantively covers the upstream commit's surface. The
audit-pending agent earlier flagged these as never spot-checked
(ADR-0257 item #9). Read-only against forks AND ruvnet repos.

## Summary

- **adr-fully-covers: 1** (the ADR-0203 standing rule)
- **adr-partial: 5** (all 5 ADR-126 neural-trader phase rows — `8d9e20f0c`,
  `d9bd4e6ad`, `9c075a3c3`, `48cb0a7ee`, `11c1ad974`)
- **adr-mismatch: 0**
- **adr-drifted: 0**

### Top finding (M=5 partial)

ADR-0248 + ADR-0251 (cited via ADR-0252 row in the ledger) **explicitly
cover ONLY the marketplace `plugin.json` description-field rewrite**.
ADR-0248 §"Decision" Row 6 (F-07-007) text:

> "Hand-edit `forks/ruflo/plugins/ruflo-neural-trader/.claude-plugin/plugin.json`
> description to drop "112+ MCP tools" framing in favour of "neural
> trading orchestration via `npx neural-trader` ..."

ADR-0251 §"Decision Outcome" reaffirms the description rewrite by
inspection. **Neither ADR excises** SKILL.md content, README content,
smoke.sh, src/ files, namespace claims, TTL/dedup features, signed
artifacts, sublinear CG, or PageRank attribution — all the surfaces the
5 upstream phases actually touch.

The ledger rationale in ADR-0252 §"Per-family disposition" Row 1
("Upstream Phases 1-4+6 targeted SKILL.md content the fork no longer
maintains in upstream's framing") is **stronger than the cited ADRs
authorise**:

- **Phase 1** (`8d9e20f0c`) — bug fix; fork still has the bug
  (`trader-train/SKILL.md` writes to undeclared `trading-models`
  namespace, `smoke.sh` step 8 still asserts 4 namespaces). Not
  "overclaim re-introduction" — it's a real namespace consistency
  defect that ADR-0248/0251 never addressed.
- **Phase 2** (`d9bd4e6ad`) — wires the plugin into ADR-125 memory
  lifecycle (TTL on signals, inline dedup on backtests). Fork has 0
  occurrences of `expiresAt` / `memory_delete` / `MemoryConsolidator`
  in trader-signal+trader-backtest SKILL.md. Not "overclaim
  re-introduction" — a feature addition orthogonal to the description
  rewrite.
- **Phase 3** (`9c075a3c3`) — adds new skill `trader-portfolio-cg/` +
  new src/ files (`sublinear-adapter.ts`/.mjs) for CG portfolio solve.
  Fork has no `trader-portfolio-cg/` skill and no `sublinear-adapter.*`
  in `src/`. Adding a 7th skill *would* conflict with the fork's
  "6 skills" framing in the description; this is the only phase where
  the supersede claim has a partial colour of authority, but ADR-0248
  doesn't pin the count to 6, only excises the "112+" framing.
- **Phase 4** (`48cb0a7ee`) — adds Ed25519-signed backtest artifacts
  (new `src/signed-artifact.{ts,mjs}` + edits to trader-backtest +
  trader-cloud-backtest SKILL.md). Fork has 0 occurrences of
  Ed25519/signature/signing in `trader-backtest/SKILL.md`. Not
  "overclaim re-introduction" — a security feature addition.
- **Phase 6** (`11c1ad974`) — adds feature attribution via PageRank
  (new `src/signed-attribution.{ts,mjs}` + new `trader-explain/`
  skill). Fork has no `trader-explain/` skill, no
  `signed-attribution.*`. Not "overclaim re-introduction" — a
  regulatory/interpretability feature addition.

The 5 phases are a **mix of bug fix (Phase 1), lifecycle integration
(Phase 2), and three substantive feature additions** (Phases 3, 4, 6).
The cited ADRs cover only the description-honesty layer; the surface
deferrals would be more honestly classified as a separate disposition
category (e.g., "deferred-feature-add" or "selective-defer"), not as
"superseded by ADR-0248 + ADR-0251."

## Per-row findings

| # | Upstream SHA | Subject | Cited ADR | ADR §Decision covers? | Verdict |
|---|---|---|---|---|---|
| 1 | _standing rule_ | SHAs touching `v3/@claude-flow/hooks/` | ADR-0203 | YES — ADR-0203 §"CI guard + ledger" + §"Files to change" both explicitly mandate the standing rule (`superseded-by-adr` referencing ADR-0203 for any future SHA touching `v3/@claude-flow/hooks/`). | **adr-fully-covers** |
| 2 | `8d9e20f0c` | feat(neural-trader): Phase 1 — canonical 5-namespace alignment (bug fix) | ADR-0252 → ADR-0248 + ADR-0251 | NO — Phase 1 fixes a real namespace consistency bug (fork's `trader-train/SKILL.md:28` still writes to undeclared `trading-models`, fork's `smoke.sh` step 8 still asserts 4 namespaces). ADR-0248 only rewrote `plugin.json` description; ADR-0251 only re-affirmed that description rewrite. Neither addresses namespace alignment. | **adr-partial** (gap: real bug not excised) |
| 3 | `d9bd4e6ad` | feat(neural-trader): Phase 2 — ADR-125 memory lifecycle (TTL + dedup) | ADR-0252 → ADR-0248 + ADR-0251 | NO — Phase 2 wires the plugin into ADR-125 memory lifecycle. Fork has 0 occurrences of `expiresAt`/`memory_delete`/`MemoryConsolidator` in trader-signal+trader-backtest SKILL.md. Cited ADRs only address description honesty. | **adr-partial** (gap: lifecycle integration not excised) |
| 4 | `9c075a3c3` | feat(neural-trader): Phase 3 — portfolio CG via sublinear/solve | ADR-0252 → ADR-0248 + ADR-0251 | NO (mostly) — Phase 3 adds new skill `trader-portfolio-cg/` + new `src/sublinear-adapter.*`. ADR-0248's description references "6 skills (backtest/portfolio/regime/risk/signal/train)"; adding `trader-portfolio-cg` as a 7th would require updating the description, so there's a thin overlap. But ADR-0248 §Decision Row 6 does not pin the skill count nor forbid skill additions; it only excises the "112+ MCP tools" framing. | **adr-partial** (gap: feature add not excised; only the description count is implicit) |
| 5 | `48cb0a7ee` | feat(neural-trader): Phase 4 — Ed25519-signed backtest artifacts | ADR-0252 → ADR-0248 + ADR-0251 | NO — Phase 4 adds Ed25519 signing (new `src/signed-artifact.*` + SKILL.md edits). Fork has 0 occurrences of Ed25519/signature/signing in trader-backtest. Cited ADRs don't address signing. | **adr-partial** (gap: security feature not excised) |
| 6 | `11c1ad974` | feat(neural-trader): Phase 6 — feature attribution via PageRank | ADR-0252 → ADR-0248 + ADR-0251 | NO — Phase 6 adds `trader-explain/` skill + `src/signed-attribution.*`. Adding a new skill conflicts with the description's "6 skills" enumeration (same shape as Phase 3). Cited ADRs do not address regulator-grade interpretability. | **adr-partial** (gap: feature add not excised; only the description count is implicit) |

## Detailed analysis

### Row 1 (ADR-0203 standing rule) — adr-fully-covers

ADR-0203 §"Swarm review evidence" (lines 199-214) and §"More
Information" §"Files to change" Row 17 (lines 363-369 of the ADR's
ledger-update spec) both explicitly establish the standing rule:

> "future upstream-sync waves classify all SHAs touching
> `v3/@claude-flow/hooks/` as `superseded-by-adr` referencing
> ADR-0203 (per C-10 — disposition word differs from ADR-0187's
> `superseded-by-local` because ADR-0203 is the 'local ADR explicitly
> replaces upstream content' case per INTEGRATION-LEDGER vocab, not the
> 'fork already moved past independently' case)."

The cited ADR substantively delivers the standing rule the ledger row
references. Mechanism: rsync-exclude on `copy-source.sh:93` +
`config/publish-levels.json:51` deletion keep the dead-package tree
byte-identical to upstream (zero merge-tax) while preventing
republication. Verdict: **adr-fully-covers**.

### Rows 2-6 (5 ADR-126 neural-trader phases) — adr-partial

The 5 ledger rows are uniform: each cites ADR-0252 (which in turn
cites ADR-0248 + ADR-0251) and asserts that those ADRs "supersede ADR-126
neural-trader Phase N SKILL.md content."

**Evidence from cited ADRs:**

- ADR-0248 §Decision Row 6 (the F-07-007 row, line 333 of the ADR) is
  the *only* substantive disposition for `ruflo-neural-trader`:
  hand-edit `.claude-plugin/plugin.json` description to drop "112+ MCP
  tools" framing. **No other neural-trader surface is excised.**
- ADR-0251 §"Decision Outcome" verifies the description rewrite stuck
  (`be780856f`) by inspection: skills compose CLI invocations + MCP
  storage in a workflow scaffold pattern. **No fresh excisions are
  added; the ADR closes the DA dissent on the prior rewrite.**
- ADR-0252 §"Per-family disposition" Row 1 *asserts* the supersede
  mapping in its rationale prose ("Upstream Phases 1-4+6 targeted
  SKILL.md content the fork no longer maintains in upstream's
  framing") but **does not itself excise any new surface** — it's a
  derived-disposition ADR that depends on ADR-0248 + ADR-0251 having
  done the work.

**Evidence from the fork's current state:**

Direct grep against `forks/ruflo/plugins/ruflo-neural-trader/`:

```
plugins/ruflo-neural-trader/src/
  pipeline-messages.ts                 (only file)
plugins/ruflo-neural-trader/skills/
  trader-backtest/                     (no Phase 2 dedup, no Phase 4 signing)
  trader-portfolio/                    (no Phase 3 CG variant)
  trader-regime/
  trader-risk/
  trader-signal/                       (no Phase 2 TTL)
  trader-train/                        (still uses `trading-models` — Phase 1 bug)
plugins/ruflo-neural-trader/scripts/
  smoke.sh                             (step 8 asserts 4 namespaces — Phase 1 bug)
```

Specifically:

- **Phase 1**: `trader-train/SKILL.md:28` writes `namespace: "trading-models"`
  (the Phase 1 upstream commit fixed this to `"trading-analysis"`).
  `scripts/smoke.sh:line` step 8 asserts only 4 namespaces (Phase 1
  fixed to 5). **The fork has the underlying bug Phase 1 fixed.**
- **Phase 2**: 0 occurrences of `expiresAt`/`memory_delete`/
  `MemoryConsolidator` in `trader-signal/SKILL.md` +
  `trader-backtest/SKILL.md`.
- **Phase 3**: No `src/sublinear-adapter.{ts,mjs}`; no
  `skills/trader-portfolio-cg/`; no `benchmarks/portfolio-cg.bench.mjs`;
  no Phase 3 smoke script.
- **Phase 4**: No `src/signed-artifact.{ts,mjs}`; no signing references
  in `trader-backtest/SKILL.md`; no `skills/trader-cloud-backtest/`.
- **Phase 6**: No `src/signed-attribution.{ts,mjs}`; no
  `skills/trader-explain/`; no Phase 6 smoke script.

**Why "partial" not "mismatch":**

The supersede claim has a *thin* basis for Phases 3 and 6 (adding new
skills conflicts with the description's "6 skills (backtest/portfolio/
regime/risk/signal/train)" enumeration), but ADR-0248 §Decision Row 6
does not pin the skill count nor declare new skills out-of-scope; it
only excises the "112+ MCP tools" overclaim. The supersede claim has
*no* basis for Phases 1, 2, 4 — those don't touch the description
field at all.

The honest classification is "selective-defer of substantive features
behind a description-only ADR." ADR-0252 packaging this as "supersede"
overstates the cited ADRs' authority.

## Proposed actions

### Row 1 (ADR-0203 standing rule) — no action needed

ADR-0203 fully substantively covers the ledger row. No drift, no gap.

### Rows 2-6 (5 ADR-126 phase rows) — propose disposition correction

Three options, in order of cost and fidelity:

**Option A (lowest cost) — rephrase the ledger rationale prose:**
Update the rationale columns in the 5 rows from "ADR-0248 + ADR-0251
cover neural-trader SKILL.md surface" to a more accurate
"description-only excision; substantive Phase N features (namespace
fix / TTL+dedup / CG / signing / attribution) deferred without
specific ADR coverage. Re-eval on next upstream sync." Keep the
`superseded-by-adr` disposition class but make the rationale honest.

**Option B (medium cost) — author a new ADR explicitly excising the
Phase 1-4+6 surfaces:** A new ADR (e.g., ADR-0258) would document
*why* each substantive feature was deferred (decision drivers:
substrate scope, plugin complexity vs scaffolding role, trust model).
Update ledger to cite the new ADR. This is the disposition the
"feedback-skip-accepted-as-squelch" memory pattern would prefer —
defer-with-reason rather than carry-on-an-overstatement.

**Option C (highest cost) — re-disposition to a different class:**
Change the disposition class from `superseded-by-adr` to either
`deferred-pending-decision` (acknowledging no ADR currently covers
these surfaces) or pick the substantive phases individually
(`Phase 1` is a real bug fix and probably warrants `cherry-picked`
treatment; Phases 3/4/6 are feature additions; Phase 2 is a lifecycle
binding).

**Recommendation:** Option A as immediate hygiene; Option B if the
substantive surfaces will stay deferred long-term and the deferral
rationale deserves durable documentation. **Critically: Phase 1 is a
real bug fix and the fork's `trader-train/SKILL.md` + `smoke.sh`
should be patched independently regardless of disposition choice** —
the current fork state has signal data landing in an undeclared
namespace (`trading-models`) that no downstream consumer reads, per
the Phase 1 commit message.

## Counts per classification

- adr-fully-covers: **1**
- adr-partial: **5**
- adr-mismatch: **0**
- adr-drifted: **0**

## Files cross-referenced

- `/Users/henrik/source/ruflo-patch/docs/upstream/INTEGRATION-LEDGER.md`
  (lines 130, 168-172 — the 6 superseded-by-adr rows audited)
- `/Users/henrik/source/ruflo-patch/docs/adr/ADR-0203-hooks-codebase-consolidation.md`
  (§Decision + §Files to change row 17 + §CI guard + ledger section
  establishes the standing rule)
- `/Users/henrik/source/ruflo-patch/docs/adr/ADR-0248-plugin-marketplace-integrity-and-honesty.md`
  (§Decision Row 6 / F-07-007 is the *only* neural-trader-touching
  decision in the ADR)
- `/Users/henrik/source/ruflo-patch/docs/adr/ADR-0251-close-f-07-007-da-dissent-on-ruflo-neural-trader.md`
  (§Decision Outcome closes the DA dissent; no fresh excisions)
- `/Users/henrik/source/ruflo-patch/docs/adr/ADR-0252-batch-s-source-conflict-deferral-re-disposition.md`
  (§Per-family disposition Row 1 asserts the supersede claim)
- `/Users/henrik/source/forks/ruflo/plugins/ruflo-neural-trader/` (current
  fork state — confirmed bug presence for Phase 1; absence of Phase
  2/3/4/6 feature surfaces)
- `/Users/henrik/source/ruvnet/ruflo` upstream commits
  `8d9e20f0c` `d9bd4e6ad` `9c075a3c3` `48cb0a7ee` `11c1ad974` (verified
  via `git show --stat` to confirm what each phase touches)
