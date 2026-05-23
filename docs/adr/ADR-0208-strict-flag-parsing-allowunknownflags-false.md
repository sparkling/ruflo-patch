---
status: implemented
date: 2026-05-19
implemented-date: 2026-05-22
tags: [cli, parser, flags, strictness, hooks, manifest-drift, lint, swarm-reviewed]
supersedes: []
depends-on: [0201]
implements: []
---

# Flip `allowUnknownFlags` to false — lint-first, flip-sequenced-last

> **Reframed after a 6-expert swarm review (2026-05-20).** The original draft made the global parser flip the headline fix and demoted the build-time lint to "Confirmation #3." The review established that (a) the flip's loud failure is *swallowed in the actual hook firing path* (`continueOnError: true` + `ruflo-hook.sh`'s `2>/dev/null` + `exit 0`), so it does little for the audited hook surface; (b) the build-time **lint** deterministically fixes the documented manifest-vs-CLI drift at zero blast radius; (c) the ADR under-scoped the inventory ~3×; (d) the proposed acceptance test is buggy (camelCase key) and the trip-wire it relies on does not exist. The decision is unchanged in *direction* (the flip is sound and is the end state) but **re-sequenced**: lint + surface cleanup first, global flip last, fuzzy-match decoupled. See [Swarm review evidence](#swarm-review-evidence-2026-05-20).
>
> **Second-pass validation (2026-05-20):** D′ confirmed; corrected-inventory + camelCase fix + `bin/cli.js` entrypoint empirically verified. Four corrections folded in below: **(1)** the lint cannot be pure grep — 4 alias commands build `options` by reference/spread (`commands/hooks.ts:4497/4516/4548/4557`), so it must extract from the *resolved* command tree (import `dist/src/commands/hooks.js` + walk `hooksCommand.subcommands`, or AST-resolve), JSON-parse the manifests and tokenize only `command` string values (raw grep mis-extracts `configuration` from a `"description"`), and resolve `-s/-e/-c/-f` short aliases. **(2)** The "flip is swallowed → residual" framing is overstated: `ruflo-hook.sh` is **upstream-only** (absent from the fork) and only `plugin/hooks/hooks.json` sets `continueOnError` — the other two fork manifests invoke the CLI directly with no swallow, so the flip genuinely surfaces RC≠0 on their un-cleaned Stop hooks (strengthening lint-first sequencing, weakening "residual"). **(3)** Add a "full unit+acceptance green *under the flip*" gate before step 4 — the lint scans manifests+docs only; the flip also affects TS/test callsites it never sees, so "breaks nothing of ours" needs that gate. **(4)** The lint is *decidable set-membership* (tokens vs declared options/subcommands/globals) — categorically unlike 0209/0210's rejected *undecidable* detectors; this is what makes it durable against the upstream merge-tax without rotting into an allowlist squelch. (Coordinate the `notify`-surface touch with siblings 0210/0211.)

## Context and Problem Statement

The ruflo CLI parser is a singleton at `forks/ruflo/v3/@claude-flow/cli/src/parser.ts:555`:

```ts
export const commandParser = new CommandParser({ allowUnknownFlags: true });
```

That one word makes every subcommand permissive: undeclared flags are kept in `result.flags`, passed into `ctx.flags`, and simply never read by the handler — no error. The 2026-05-19 soundness audit (ADR-0201, F-02-001/003) found undeclared flags silently swallowed across `hooks notify`, `post-edit`, `post-command`, `post-task`, and `session-end`. The most visible: `plugin/hooks/hooks.json` invokes `hooks notify --message '{}' --swarm-status`, but `notifyCommand.options` declares only `message`/`level`/`channel`; `--swarm-status` is consumed and discarded. The manifest declares an intent the implementation never honours.

This is a [[feedback-no-fallbacks]] violation: the product silently accepts mistyped flags, deprecated flags, and manifest-vs-implementation drift, surfacing none of it. Users see success exit codes for commands that did less than asked; manifests can claim features the CLI never delivers, invisible until someone reads both the JSON and the handler side by side.

### Mechanism — verified sound (the flip is NOT a no-op)

The swarm empirically confirmed, against the published binary, that flipping the default produces a real loud failure end-to-end:

* `allowUnknownFlags` is consumed in `validateFlags()` (`parser.ts:534-544`), not in `parse()`. When false, the unknown-flag branch pushes `Unknown option: --<key>` into an errors array.
* Dispatch inspects it: `index.ts:257-263` calls `validateFlags(flags, targetCommand)`, prints every error, and `process.exit(1)` **before** the handler runs — the same path the already-live `Required option missing` and `Invalid value … Must be one of` validators use (proven: `hooks notify` with no `--message` → RC=1; `--format bogus` → RC=1; unknown flag today → RC=0).
* Global flags (`help`, `version`, `verbose`, `quiet`, `config`, `format`, `no-color`, `interactive`, `non-interactive` — `parser.ts:42-112`) are always in `knownFlags`, so the flip will **not** reject them even though per-command option lists don't re-declare them. This removes the biggest false-positive class.
* The **class default is already `false`** (`parser.ts:34`); only the exported singleton overrides to `true`, with no commit message, ADR, or comment ever justifying it across ~4.5 months and 11 parser commits. The flip returns the singleton to the parser's own designed posture.

### Where the flip's loud failure actually lands — and where it is swallowed

The audited defect is *hook manifests* passing undeclared flags. But the real hook firing path suppresses the exit code:

* Only **`plugin/hooks/hooks.json`** sets `"continueOnError": true` (all 13 blocks) — Claude Code discards the non-zero exit there. ⚠️ **CORRECTED (2nd-pass):** the other two fork manifests — `.claude-plugin/hooks/hooks.json` and `plugins/ruflo-core/hooks/hooks.json` — set **no** `continueOnError` and invoke the CLI **directly**, so the flip's RC≠0 is **NOT** swallowed for them (e.g. the `.claude-plugin` `Stop` hook would surface the failure post-flip).
* ⚠️ **CORRECTED (2nd-pass):** `ruflo-hook.sh` (the `exec 2>/dev/null` + `exit 0` fail-soft shim) exists **only upstream** (`ruvnet/ruflo/plugin/scripts/ruflo-hook.sh`); it is **absent from the fork**, and **none** of the three fork manifests reference it — they call the CLI directly. The original citation of `forks/ruflo/plugin/scripts/ruflo-hook.sh` was wrong (that path does not exist).

⚠️ **CORRECTED (2026-05-22 council, grep-verified):** the flip reaches **exactly one** fork manifest, for a reason deeper than `continueOnError`. `plugin/hooks/hooks.json` and `plugins/ruflo-core/hooks/hooks.json` both invoke the **upstream `claude-flow@alpha` package**, *not* the fork CLI (`@sparkleideas/cli`), so the `parser.ts:555` flip cannot reach them at all (and `plugin/` also sets `continueOnError` on all 13 blocks). Only **`.claude-plugin/hooks/hooks.json`** invokes the fork directly (`@sparkleideas/cli`, no `continueOnError`), so the flip surfaces RC≠0 there. The flip's value is therefore: that one fork manifest's un-cleaned hooks, plus external/third-party scripts, interactive typists, and the acceptance trip-wire — narrower than the earlier "2 fork manifests" framing, but real and not a no-op. This *strengthens* lint-first sequencing (the flip really would break `.claude-plugin`'s un-cleaned Stop hook, so the surface MUST be clean first). (Bonus finding, out of scope: the two manifests invoking upstream `claude-flow@alpha` are a branding/canonicalization gap — see ADR-0223.)

### Corrected blast-radius inventory (the ADR's original table undercounted ~3×)

| Dimension | Original ADR | Swarm-verified |
|---|---|---|
| Distinct undeclared flags | 9 | **12** (adds `--cache-results`, `--include-explanation`, `--load-context`) |
| Manifest break sites | ~9 | **18** across **3** manifests (`.claude-plugin/hooks/hooks.json`, `plugin/hooks/hooks.json`, **`plugins/ruflo-core/hooks/hooks.json`** — the third was omitted from the migration table) |
| Shipped-doc flags | not counted | **~27 more** (recounted 2026-05-22) in `.claude/commands/hooks/*.md` (shipped via `files: [".claude/**"]`; user copy-paste sources) + breaking examples in fork `CLAUDE.md` |
| Distribution channels | 1 (manifests) | **3** (root npm `.claude-plugin/**` + `.claude/**`; marketplace `plugins/ruflo-core/**` + `plugin/**`; `@claude-flow/cli` ships neither) |
| Undefined subcommands | not mentioned | **6** (`pre-search`, `post-search`, `mcp-pre`, `mcp-post`, `modify-bash`, `modify-file`) — fall through to the `hooks` parent (`options:[]`) as silent no-ops; a *deeper* failure than flag-drop that "declare or delete the flag" cannot fix |

Two ADR mislabels the swarm corrected:

* **`--format` is a global flag** (`parser.ts:78`) with `choices:['text','json','table']`, so the `.claude-plugin` `post-edit --format true` invocation already errors **today** (Invalid value), flip or not. It is not an "undeclared flag to declare"; the real bug is the manifest passing `true` to a choices-constrained global.
* **`--train-patterns` is a real flag mis-targeted** — declared on `task-completed` (`hooks.ts:5056`), the manifest puts it on `post-edit`. Remediation = retarget, not declare/delete.

The drift is **upstream-inherited** (the singleton and all undeclared flags are byte-identical to `ruvnet/ruflo`; 7 of the flags have *zero* declaring commits — aspirational from the moment they were typed). *Corrected 2026-05-22: the parser file is NOT byte-identical (the fork adds a 12-line `non-interactive` global block, ADR-0104) and the manifests are NOT byte-identical (the fork stripped the upstream fail-soft shim refs + every `|| true`); only the singleton, class default, and the flag tokens themselves match upstream.* The init-emitted hooks invoke `.claude/helpers/hook-handler.mjs` directly, **not** the CLI parser, so the init path (F-02-008) is genuinely unaffected by the flip.

### The trip-wire the original ADR assumed does not exist

The original "the acceptance suite will catch remaining sites" claim is false today: the entire harness exercises only `hooks post-task --task-id X --success` and `hooks pre-task --description` — all *declared* flags. Zero undeclared flags appear anywhere in acceptance. The trip-wire must be **built**, not assumed — and the originally-proposed test is itself buggy (it greps for the kebab key `--definitely-not-a-real-flag`, but `validateFlags` emits the normalized camelCase key `--definitelyNotARealFlag`).

## Decision Drivers

* Loud-not-silent failure per [[feedback-no-fallbacks]] — flag drops mask bugs and ship features that don't work.
* **Build-time over runtime for the documented drift** — the audited problem (manifest-vs-CLI mismatch) is the fork's own shipped surface; a build-time lint catches 100% of it deterministically, before publish, at zero blast radius, and catches drift the runtime flip cannot (docs, undefined subcommands). The runtime flip's unique residual value is external/interactive callers.
* Manifest-vs-CLI parity — shipped manifests must be honoured by handlers, not silently truncated.
* Minimal-surface change — the flip is one word; but its *consequences* land across 3 channels and 30+ flag sites, so the surface cleanup is the real work.
* Migration realism — flipping lights up every undeclared flag at once; the surface must be clean *before* the flip, and the trip-wire must exist *before* the flip.
* Upstream-divergence cost — upstream is permissive **by design** (its fail-soft hook shim relies on it); a strict fork accepts a permanent merge tax in the most-synced files (`hooks.ts`, the 3 manifests). The lint mitigates this by keeping the parser byte-identical to upstream except the one-word singleton and by turning future upstream drift into a build-time signal.
* User error recovery — fuzzy "did you mean" is valuable but orthogonal; it can ship independently using the existing `suggest.ts`.

## Considered Options

* **Option A — Flip global default to false; bare `Unknown option:` error.**
* **Option B — Per-command opt-in strict mode; migrate hooks first.**
* **Option C — Warn-on-unknown globally; strict for hooks/MCP.**
* **Option D — Flip global default to false + fuzzy-match suggestion.**
* **Option E — Lint-only: fix the manifests + ship a build-time manifest-vs-`Command.options` lint; do NOT flip the runtime default.** (The audit's Recommendation #1(a), "minimal-blast-radius fix.")
* **Option D′ (chosen) — Sequenced D: Option E's lint + surface cleanup is the *primary, first-landed* fix; the global flip lands *last* after the surface is clean (residual external-caller protection); fuzzy-match is decoupled to its own change.**

## Decision Outcome

**Chosen: Option D′ — sequenced.** The global flip is the correct end state (it returns the singleton to the parser's own `false` default and prevents new commands from re-inheriting the permissive bug, which per-command Option B/C would allow), but it is **not** the load-bearing fix and must not land first.

Rationale, reconciling the swarm:

* **The lint is the real fix (Option E is necessary, not optional).** It deterministically catches all manifest/doc drift at build time — the exact defect the audit found — at zero runtime blast radius, and catches what the flip cannot (the ~20 doc flags, the 6 undefined subcommands). Confirmed: the documented user-visible problem is "manifests claim features the CLI never delivers," which is a build-time hygiene problem.
* **The flip is sound and worth doing — last.** The mechanism is proven (RC=1 via `index.ts:257-263`). Its residual value is loud failure for non-fail-soft callers (external scripts, interactive, the trip-wire). Sequencing it after the surface is clean means it breaks nothing of ours and only adds protection.
* **Global, not hooks-scoped.** Option B/C (per-command/hooks-only) lets new commands re-inherit the permissive default — the audit pattern recurs as the CLI grows — and the codebase already shows the per-command anti-pattern (`mcp.ts:638` hand-rolls a `knownFlags` allowlist because the global default is loose). The class default is already `false`; the global flip is the consistent end state. The upstream merge-tax this incurs is accepted and mitigated by the lint (it makes inbound upstream drift a build-time signal); **lint-only (Option E) is the documented fallback if the merge tax proves unsustainable — NOT hooks-scoped strictness.** (The upstream review showed hooks is the *worst* scope: it is exactly where upstream discards exit codes via the fail-soft shim + per-line `|| true` + `continueOnError`, so scoping strictness to hooks guards the one surface that ignores it.)
* **Fuzzy-match is decoupled.** `suggest.ts` already ships `levenshteinDistance`/`findSimilar`/`formatSuggestion` (used for unknown-*command* errors), so it costs ~5-8 lines, not the ADR's "~20 + a dependency" — but it carries a camelCase-candidate and false-positive hazard (`task`/`task-id`, `agent`/`agents`) and rides on the contested flip. Ship it as its own change, wired into the existing bare-error path, matching against and emitting the **original kebab** option names (not normalized keys), excluding single-char short forms.

### Implementation path (sequenced)

1. **Build the lint first** (release gate) — `scripts/check-manifest-flag-drift.mjs`, slotting into the existing zero-dep `check-*.mjs` / `preflight` family — which lives in **ruflo-patch** (`/Users/henrik/source/ruflo-patch/scripts/check-*.mjs`, `package.json:6`), NOT the fork (per the patches-in-fork split; the fork CLI's `scripts` has no `.mjs`). **NOT pure grep** (2nd-pass correction): JSON-parse all **three** manifests (`.claude-plugin/hooks/hooks.json`, `plugin/hooks/hooks.json`, `plugins/*/hooks/hooks.json`) and tokenize only the `command` string values (raw grep mis-extracts e.g. `configuration` from a `"description"`); also scan the shipped docs (`.claude/commands/hooks/*.md`). Cross-reference `--<flag>` (long + `-x` short aliases) and `<subcommand>` tokens against the **resolved** command tree — import the **codemod-built / freshly-installed** `dist/src/commands/hooks.js` (NOT the gitignored fork-root `dist/`, which lints a stale tree → false greens; resolve via the published / per-package dist, per the loadRvfBackend artifact-resolution lesson) and walk `hooksCommand.subcommands` **to depth 2** — real nested subcommands exist (`transfer[store,from-project]`, `worker[list,dispatch,…]`) — resolving subcommand aliases (`list→ls`) and each node's `options`, because 4 alias commands build `options` by reference/spread (`commands/hooks.ts:4497,4516,4548,4557`) that line-grep cannot see — plus globals (`parser.ts:42-112`). Fail the build on any undeclared flag OR undefined subcommand. This is the durable guard and the primary deliverable; it is *decidable set-membership* (unlike 0209/0210's rejected detectors), so it will not rot into an allowlist.
2. **Clean the shipped surface** the lint flags, *before* any parser change: for each of the 12 undeclared flags, declare-and-wire OR delete (`--analyze-performance`, `--generate-summary`, `--export-metrics`, `--swarm-status` describe features that don't exist → delete from manifest); **retarget** `--train-patterns` to its real command; **fix** the `--format true` global-value misuse; resolve the **6 undefined subcommands** (implement or delete); sweep `.claude/commands/hooks/*.md` and fork `CLAUDE.md`.
3. **Add the acceptance trip-wire** (it does not exist today): a check that fires a hook with a bogus flag through `bin/cli.js`/`_cli_cmd` (NOT `dist/src/index.js`, which does not self-execute) and asserts non-zero exit + the diagnostic.
4. **Before flipping, run the full unit+acceptance corpus WITH the flip applied locally** (2nd-pass gate). The lint (step 1) only covers manifests + docs; the flip at `parser.ts:555` also affects **TS internal callsites and the test harness** that the lint never scans — any of those passing an undeclared flag will newly hard-fail RC=1. Treat every new RC=1 as in-scope cleanup. ("Breaks nothing of ours" is only true for manifests/docs; this gate covers the rest.) **Known hit:** `__tests__/commands-deep.test.ts:847` asserts the permissive posture (`allowUnknownFlags` enabled / `unknownErrors == []`) — rename it and flip its assertion to the strict posture; do NOT delete it (deleting is a squelch). **Then flip** `parser.ts:555` to `allowUnknownFlags: false`. With the surface clean and the suite green under the flip, it breaks nothing of ours and adds loud failure for the one fork manifest that invokes the fork CLI without `continueOnError` (`.claude-plugin`) + external/interactive callers.
5. **Separately, optionally**, wire the fuzzy-match hint via `suggest.ts` into the bare-error path, kebab-matched, short-forms excluded.

### Out of scope

* The `--swarm-status` / `--analyze-performance` etc. *feature* implementations (F-02-005 follow-ups) — this ADR declares-or-deletes at the manifest, it does not build the features.
* Two-manifest reconciliation (F-02-002) — but the lint MUST glob all three manifests or it reproduces the asymmetry that caused the drift.
* Handler-side anti-patterns (F-02-004/006) — separate follow-ups.

### Confirmation

1. **Lint (primary gate)**: the build-time manifest+doc-vs-`Command.options` lint passes — i.e. every `--flag` and subcommand in all three manifests and `.claude/commands/hooks/*.md` resolves to a declaration. This is the release gate; it must exist and be green before step 4.
2. **Unit-level**: `commandParser.parse(['hooks','notify','--message','x','--bogus-flag'], hooksRoot)` then `validateFlags(...)` returns an error containing `Unknown option: --bogusFlag` (note: **camelCase** key — assert the form the parser actually emits, or first fix emission to echo the kebab original; do not assert `--bogus-flag` against the current code). Fuzzy path (if shipped): a near-miss typo returns `Did you mean: --<closest-kebab>?`.
3. **End-to-end acceptance** (fold into `bash scripts/test-acceptance-fast.sh --group adr0208`), invoked through `bin/cli.js`/`_cli_cmd`, NOT the dist module:
   ```bash
   set +e
   out=$($(_cli_cmd) hooks notify --message "test" --definitely-not-a-real-flag 2>&1)
   rc=$?
   set -e
   [[ $rc -ne 0 ]] || { echo "FAIL: parser silently accepted unknown flag"; exit 1; }
   # Assert the diagnostic in the form the parser emits (camelCase key):
   grep -q "Unknown option: --definitelyNotARealFlag" <<<"$out" \
     || { echo "FAIL: no Unknown option diagnostic"; exit 1; }
   ```
4. **Regression sweep** = the lint from #1, run in CI on every change, globbing all three manifests + the docs.

### Consequences

* Good, because the lint surfaces manifest-vs-CLI drift at build time — deterministically, before publish, at zero runtime blast radius — fixing the audited defect directly.
* Good, because the sequenced flip then adds loud failure for external/interactive callers without breaking the (now clean) shipped surface, aligning the parser with [[feedback-no-fallbacks]] and its own class default.
* Good, because resolving the 6 undefined subcommands closes a silent-failure deeper than flag-drop that the original ADR missed entirely.
* Good, because fuzzy-match (decoupled) reuses existing `suggest.ts` at ~5-8 lines.
* Bad, because on the one fork manifest that sets `continueOnError` (`plugin/hooks/hooks.json`) Claude Code discards the flip's non-zero exit — and that manifest invokes upstream `claude-flow@alpha` anyway, so the flip never reaches it — meaning the flip's benefit on the audited hook surface is limited to the stderr/transcript diagnostic; the lint, not the flip, is what protects that surface. (`ruflo-hook.sh`, the upstream fail-soft shim, is absent from the fork — see Context.)
* Bad, because the flip forks the parser default from upstream (permissive-by-design) — a permanent merge tax in the most-synced files; mitigated by the lint turning inbound drift into a build-time signal, with **lint-only (Option E)** — not hooks-scoped strictness — as the documented fallback.
* Bad, because the surface cleanup (12 flags + 6 subcommands + ~20 doc flags across 3 channels) is real work that must complete before the flip; bundling it all in one release maximizes miss-risk — hence the staged sequence.
* Neutral, because globals (`--help`, `--format`, …) are already in `knownFlags`, so the flip won't reject them.

## Pros and Cons of the Options

### Option A — Flip; bare error
* Good, because correct semantic direction at the parser boundary.
* Bad, because unhelpful for typos, and (as written) lands the flip before the surface is clean.

### Option B — Per-command opt-in strict
* Good, because risk-graduated.
* Bad, because permissive stays the default → new commands re-inherit the bug; same flag-declaration work either way.

### Option C — Warn-only globally
* Good, because surfaces unknowns without breaking scripts.
* Bad, because warnings are swallowed by `2>/dev/null`/`--quiet`/JSON consumers; no propagating channel; two parser code paths.

### Option D — Flip + fuzzy-match
* Good, because loud failure + helpful typo hint.
* Bad, because it makes the runtime flip the headline (the swallowed-in-hook-path surface) and demotes the lint that actually fixes the documented drift; bundles fuzzy-match with the contested flip.

### Option E — Lint-only
* Good, because deterministically fixes the documented drift at zero blast radius; keeps the parser byte-identical to upstream.
* Good, because catches what the flip cannot (docs, undefined subcommands).
* Bad, because it leaves external/interactive callers unprotected (no runtime guard) — the residual [[feedback-no-fallbacks]] gap the flip closes.

### Option D′ — Sequenced (chosen)
* Good, because takes Option E's deterministic, zero-blast-radius fix as primary, then adds the flip's residual runtime guard last, on a clean surface.
* Good, because reaches the consistent global end state (singleton = class default) without the flip-first breakage.
* Bad, because it is more work than a one-word flip — but the one-word flip was never the real cost; the surface cleanup is, and it is required under any flipping option.

## Swarm review evidence (2026-05-20)

Six-expert review; citations verified against fork HEAD and upstream `ruvnet/ruflo`.

* **Parser Architect** — mechanism SOUND, empirically proven (RC=1 via `validateFlags`→`index.ts:257-263`, same path as required/choices validators). Three ADR defects: the acceptance test greps the kebab key but the parser emits camelCase (`--definitelyNotARealFlag`); the third manifest (`plugins/ruflo-core`) omitted from the table; `--format` is a global (its `true` value already errors). Fuzzy-match infra already exists in `suggest.ts`. Verdict: adopt D with corrections.
* **Code Archaeologist** — the `true` singleton is an unexamined upstream wiring artifact beside a fully-built strict path (class default `false`); 7/8 flags have zero declaring commits (aspirational); flip fits the 0209/0210/0211 strictness program. Caveats: remediation has multiple shapes (declare/delete/retarget/fix-value); lint must glob both/all manifests.
* **Upstream Analyst** — parser byte-identical to upstream; all flags inherited; upstream permissive **by design** (`ruflo-hook.sh` exits 0); zero upstream demand for strictness; global flip = permanent merge tax → favors hooks-scoped.
* **Blast-Radius / DX** — 12 flags / 18 sites / 3 manifests / ~20 doc flags / 3 channels / 6 undefined subcommands; the acceptance trip-wire doesn't exist; the lint solves the documented problem risk-free; sequence lint→fix→trip-wire→flip-last; defer fuzzy.
* **Devil's Advocate** — flip not theatre but swallowed in the real hook path (`continueOnError` + `2>/dev/null` + `exit 0`); the argument that beat Option C ("only exit code propagates") also beats D for hooks; the lint is the real fix; keep permissive default or scope to hooks/mcp; decouple fuzzy. Reject Option D as headline.
* **Queen** — synthesis: flip is sound and the global end state, but lint-first + surface-cleanup is primary and the flip lands last (Option D′); inventory and test corrected; fuzzy decoupled.

### Second council re-validation (2026-05-22)

A fresh 6-expert council (code-verification, upstream-intent, ADR-corpus, MADR-template/consistency, implementation-feasibility, devil's advocate; queen synthesis) re-verified ADR-0208 against fork HEAD + upstream. **Direction (Option D′) re-affirmed**, mechanism empirically confirmed (the dist parser emits the camelCase `Unknown option: --definitelyNotARealFlag`; RC=1 via `index.ts`→`process.exit(1)`), the inventory (12 flags / 18 sites / 6 undefined subcommands) reconciled exactly, and the "decidable set-membership lint, unlike 0209/0210's rejected undecidable detectors" distinction verified to hold. Corrections folded into this revision:

* **Flip-reach corrected to ONE fork manifest** (grep-verified 2026-05-22): `plugin/` and `ruflo-core/` invoke upstream `claude-flow@alpha`, not the fork CLI, so the flip reaches only `.claude-plugin/` (`@sparkleideas/cli`). The earlier "2 fork manifests" framing was wrong.
* **Documented fallback corrected: lint-only (E), not hooks-scoped** — upstream discards hook exit codes by design (shim `2>/dev/null`+`exit 0`, per-line `|| true`, `continueOnError`), so hooks is the *worst* scope for strictness, not a safe retreat.
* **Two must-fix stale `ruflo-hook.sh` contradictions repaired** (Consequences + More Information) — the shim is upstream-only/absent from the fork; the prior text re-asserted the precise errors the 2nd-pass corrected.
* **"byte-identical" overclaims softened** — the parser file (fork adds the ADR-0104 `non-interactive` block) and the manifests (shim refs + `|| true` stripped) are NOT byte-identical; only the singleton, class default, and flag tokens match upstream.
* **Lint spec hardened (feasibility G1/G2)** — the `check-*.mjs` family lives in ruflo-patch, not the fork; the lint must import the codemod-built/installed dist (NOT the gitignored fork-root dist → false greens) and walk subcommands to depth 2 with alias resolution.
* **Named the one breaking unit test** (`commands-deep.test.ts:847`) for step 4 (rename + flip assertion, don't delete); fixed `bin/cli.js` citation (`:276-278`, not `:206-218`); `depends-on` → bare-number `[0201]`; doc-flag count recounted to ~27.

**Strong minority position (devil's advocate + upstream analyst):** because the flip reaches only one fork manifest (which the lint already covers) and its unique value (external/interactive callers) is unevidenced, the honest decision may be to **ship Option E (lint + cleanup + trip-wire) as the atomic, releasable unit and move the global flip to a separately-gated follow-up ADR** (entry criterion = the step-4 "full suite green under the flip" gate), rather than carry it as an in-ADR step that risks rotting into a perpetual TODO. The feasibility expert dissents (the flip is one word, reversible, and the strict path is pre-built, so rot-risk is low). Recorded for the batch-ratification decision; D′'s direction stands pending that call.

## More Information

* Source findings: F-02-001, F-02-003 + `00-README.md` #6 in `docs/audits/2026-05-19-soundness-audit/`; audit Recommendation #1(a) ("minimal-blast-radius fix") in `02-hooks-post-lifecycle.md:304`.
* Parser: singleton `forks/ruflo/v3/@claude-flow/cli/src/parser.ts:555`; `validateFlags`/unknown-check `:534-544`; globals `:42-112`; class default `:34`; key normalize `:362-365`.
* Dispatch: `forks/ruflo/v3/@claude-flow/cli/src/index.ts:257-263` (validate → `process.exit(1)`); real entrypoint `bin/cli.js:276-278` (`import('../dist/src/index.js')` + `new CLI().run()` — test through this, not `dist/src/index.js` directly. NB: `:206-218` is the unrelated MCP `tools/call` handler, not CLI dispatch).
* Fuzzy infra (reuse, decoupled): `forks/ruflo/v3/@claude-flow/cli/src/suggest.ts` (`levenshteinDistance`, `findSimilar`, `formatSuggestion`).
* Per-command-strictness precedent: `forks/ruflo/v3/@claude-flow/cli/src/commands/mcp.ts:638` (hand-rolled `knownFlags` allowlist).
* Manifests (all three): `forks/ruflo/.claude-plugin/hooks/hooks.json` (invokes the fork `@sparkleideas/cli` — the only one the flip reaches), `forks/ruflo/plugin/hooks/hooks.json` + `forks/ruflo/plugins/ruflo-core/hooks/hooks.json` (both invoke **upstream `claude-flow@alpha`**, so the flip cannot reach them). Shipped docs: `forks/ruflo/.claude/commands/hooks/*.md`. Fail-soft shim (**upstream-only, absent from the fork**): `ruvnet/ruflo/plugin/scripts/ruflo-hook.sh` — none of the three fork manifests reference it.
* Upstream parity: `ruvnet/ruflo/v3/@claude-flow/cli/src/parser.ts:543` (`allowUnknownFlags: true` singleton + class default `false` — both identical; but the fork parser adds a 12-line `non-interactive` global block per ADR-0104, so the *file* is not byte-identical). The undeclared *flags* are present upstream; the *manifests* diverge (fork stripped the fail-soft shim refs + every `|| true`).
* Related principle: [[feedback-no-fallbacks]]. Related: ADR-0201 (audit source); sibling strictness ADRs 0209 (no-fallbacks arch-test), 0210 (stub-honesty envelope), 0211 (init hook-handler gaps); [[feedback-corpus-evidence-before-feature-work]] (fuzzy-match deferred absent typo evidence); [[feedback-upstream-means-upstream]] (merge-tax).
* Follow-up ADRs likely needed: F-02-002 (two-manifest reconciliation), F-02-004/005/006/007 (handler-side), and the 6 undefined-subcommand dispositions surfaced by this review.

## Amendment — 2026-05-23 (Move A audit, implemented — runtime-flip portion)

Status flipped: **proposed → implemented** (runtime-flip portion).

**Shipped (Option D′ steps 2 + 4, narrow scope):**

- Fork commit `87cb68ae2` — flipped `parser.ts:565` singleton from `allowUnknownFlags: true` to `false`, returning the singleton to the parser's own class default (`parser.ts:34`). Companion test `commands-deep.test.ts:847` flipped (not deleted, per ADR step 4).
- Fork commit `32480dda2` — declared `--consensus` and `--topology` on `hive-mind spawn` (`commands/hive-mind.ts:146,180,181`), the surface-clean that the flip required for that command.
- Arch-test pin: `__tests__/arch/adr0208-strict-flag-parsing.arch.test.ts` asserts (1) class default rejects, (2) singleton rejects with `Unknown option: --<camelCaseKey>`, (3) no file in `cli/src/` constructs `CommandParser({ allowUnknownFlags: true })`. 3/3 passing on fork HEAD (vitest, 220ms).

**Outstanding from this ADR's Option D′ sequence (NOT shipped here — these invert the ADR's own lint-first sequencing and should be tracked as 0208 follow-up rows or split into discrete follow-up ADRs):**

- Step 1 — build-time lint `scripts/check-manifest-flag-drift.mjs` (the documented primary deliverable + upstream-merge-tax mitigation).
- Step 2 (broad) — clean the remaining 11 undeclared flags + 6 undefined subcommands across the 3 manifest channels and shipped docs.
- Step 3 — acceptance trip-wire through `bin/cli.js`/`_cli_cmd`.
- Step 5 — fuzzy-match via `suggest.ts` (explicitly decoupled).

Upstream parity check (2026-05-23): `ruvnet/ruflo` parser singleton still `allowUnknownFlags: true` (`parser.ts:543`). Permanent merge-tax begins now; resolution = build the step-1 lint.
