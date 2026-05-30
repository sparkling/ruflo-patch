---
status: accepted
date: 2026-05-19
tags: [packaging, npm-bin, user-facing-brand, collision]
supersedes: []
depends-on: [ADR-0201, ADR-0143]
implements: []
---

# Resolve `ruflo` bin collision — remove `ruflo` from the CLI bin (converge to upstream)

> **Decision changed after a 6-expert swarm review (2026-05-20).** The original draft chose **Option A — rename the CLI's `bin.ruflo` → `ruflo-cli`.** The review established, with empirical evidence, that: (a) the ADR's premise is false — bypassing the wrapper bypasses **zero runtime guards** (G1–G4 are publish/test/release/comment-time; the wrapper's success path is a silent `import(cliBin)`); (b) the collision is **deterministic, not flaky** (npm tie-breaks bins alphabetically → `@sparkleideas/cli` always wins); (c) **upstream's CLI is `ruflo`-free by design** — it puts `ruflo` on a separate wrapper package — so removing `ruflo` from the CLI **converges to upstream**, while `ruflo-cli` would be a fork-only divergent bin nobody requested; (d) the ADR's claim that `_cli_cmd` "uses the package path, not the `ruflo` bin" is **false** (`_cli_cmd` resolves `.bin/ruflo` first); (e) the change **conflicts with ADR-0006 + two enforcing tests** the ADR never mentions; (f) Acceptance Criterion #4 is **unimplementable** (no runtime "G4 marker" exists). The decision changes to **Option B — remove `ruflo` from the CLI bin map** — with the premise, severity framing, confirmation, and ADR-0006 reconciliation corrected. See [Swarm review evidence](#swarm-review-evidence-2026-05-20).
>
> **Second-pass validation (2026-05-20):** B confirmed **caller-safe** — all eight `.bin/ruflo` invokers (`_cli_cmd` `acceptance-checks.sh:28`; `CLI_BIN` `test-acceptance.sh:443`; `run-check.sh`/`seed-*`/`test-acceptance-fast.sh`; the diagnostic + ADR-0142/0143 checks) either resolve to the CLI today and route transparently through the wrapper's in-process `import(cliBin)` proxy post-removal (byte-identical), or already install wrapper-solo. The wrapper has **no subcommand allowlist** (full proxy); `claude-flow`+`cli` remain as a fall-through safety net; overhead is the ~70-100ms warm import (NOT the `npx @latest` cache penalty). Bin maps verified directly: fork CLI `{ruflo, ruflo-mcp, cli, claude-flow, claude-flow-mcp}`, upstream CLI `{cli, claude-flow, claude-flow-mcp}` (ruflo-free), wrapper `{ruflo}`, upstream wrapper pkg `{ruflo}`. **One disposition settled: KEEP `ruflo-mcp`** — it has an active consumer (`lib/acceptance-adr0113-plugin-checks.sh:364` spawns the published `ruflo-mcp` bin and asserts its `[ruflo-mcp]` log tag; no other caller; the wrapper declares no `ruflo-mcp`), so the parity-removal of `ruflo-mcp` is **OFF, not optional** — only `ruflo` is removed. ADR-0006 supersession scope is correct as written (clause-level, `## Supersession scope` subsection + `supersedes:[]` — matches the batch convention of 0202/0205/0213/0217). Cross-ADR clean: consistent with 0143 (wrapper user-facing), no conflict with 0204 (whose `.mcp.json` path is the wrapper's `mcp start`, untouched). Implementer note: the test line-offsets are `rebrand-ruflo-bin.test.mjs:38` (flip to absent; keep `:42` ruflo-mcp) and `codemod-bin-preservation.test.mjs:51-52/:79/:89` (drop `ruflo`, keep `ruflo-mcp`); and tidy the stale `lib/acceptance-diagnostic-checks.sh:56-58` comment (it describes the retired npx-redirect wrapper, not the current in-process import).

## Context and Problem Statement

Both `@sparkleideas/ruflo` (the user-facing wrapper, ADR-0142/0143; bin `{ruflo: bin/ruflo.mjs}` in ruflo-patch root `package.json`) and `@sparkleideas/cli` (`forks/ruflo/v3/@claude-flow/cli/package.json`; bin `{ruflo, ruflo-mcp, cli, claude-flow, claude-flow-mcp}`) declare a `ruflo` bin. When both co-install (the wrapper depends on the CLI), npm's `node_modules/.bin/ruflo` symlink has one winner. The 2026-05-19 audit (F-12-001) and a fresh `/tmp` Verdaccio install (2026-05-20) both show:

```
$ readlink node_modules/.bin/ruflo  →  ../@sparkleideas/cli/bin/cli.js   # the CLI wins; the wrapper is bypassed
```

### Correction 1 — the bypass is harmless at runtime (premise of the original draft was false)

The original draft argued the bypass is dangerous because "none of the wrapper's guards G1–G4 are in play." That is false on every guard:

* **G1 (lockstep)** — `scripts/check-wrapper-cli-lockstep.mjs`, runs at **publish time**.
* **G2 (no-fallback)** — `tests/unit/wrapper-no-fallback.test.mjs`, a **static source test**.
* **G3 (bin-path)** — `lib/acceptance-adr0142-bin-path.sh`, a **release-time** check.
* **G4 (header)** — a **source-code comment** (`bin/ruflo.mjs:30`), not a runtime emission.

The wrapper's success path is `await import(pathToFileURL(cliBin).href)` and nothing else; it prints to stderr only on FATAL. So `.bin/ruflo` → CLI vs → wrapper produces **byte-identical** behaviour and `--version` output (the audit's own evidence confirms). The bypass loses *nothing observable*. This is a **honesty/tidiness** defect (the wrapper is advertised as the canonical `ruflo` but is silently skipped), plus a **forward-compat hedge** (a future npm could change the tie-break) — **not a functional regression.** Severity is WARN-by-honesty, not CRITICAL.

### Correction 2 — the collision is deterministic, not flaky

The draft framed this as install-order non-determinism ("a passing CI run today may symlink the wrapper; tomorrow's may not"). Empirically (npm 11.x, reproduced 5×), npm resolves the `.bin` tie-break **alphabetically by package name**: `@sparkleideas/cli` < `@sparkleideas/ruflo`, so the **CLI wins every install, deterministically**. The correct framing is a *permanent, deterministic silent bypass* of the wrapper — which strengthens the [[feedback-no-fallbacks]] argument (it's a reliable bypass, not an intermittent race). The audit file itself disclaimed the reproducibility it couldn't test; this review confirmed determinism.

### Correction 3 — the CLI's `ruflo` bin is fork-added; upstream's CLI is `ruflo`-free by design

* Upstream `ruvnet/ruflo` CLI bin = `{cli, claude-flow, claude-flow-mcp}` — **no `ruflo`, no `ruflo-mcp`** (these keys have never existed in upstream's CLI `package.json`).
* Upstream puts `ruflo` on a **separate wrapper package** (`ruvnet/ruflo/ruflo/package.json` → `{"ruflo": "./bin/ruflo.js"}`) — i.e. *the exact "wrapper owns `ruflo`, CLI doesn't" division this ADR wants.*
* The fork added `bin.ruflo`/`ruflo-mcp` to the CLI in commit `c5006bf97` (2026-04-21, an **ADR-0006/0069 rebrand follow-up**), back when global-CLI-direct (`npm i -g @sparkleideas/cli && ruflo`) was the recommended path — a recommendation **ADR-0143 retired** in favour of the wrapper. The CLI's `ruflo` bin has already been silently dropped-and-restored across `--theirs` merges twice (`71826011b`, `c071ace70`) — i.e. the fork is *already* paying merge tax to keep a divergent key.

So **removing `ruflo` from the CLI converges the fork toward upstream** and ends that merge tax; adding `ruflo-cli` (Option A) would create a *new* fork-only key upstream will never have, perpetuating the divergence.

### Correction 4 — the ADR's "internal callers unaffected" reasoning is wrong (right conclusion, wrong mechanism), and conflicts with ADR-0006

* The draft claimed `_cli_cmd`/pipeline "use the package path, not the `ruflo` bin." **False:** `_cli_cmd()` (`lib/acceptance-checks.sh:23`) resolves `.bin/ruflo` *first* (`for cand in ruflo claude-flow cli`), and `test-acceptance.sh:366` installs both packages into a shared dir. Internal callers survive **only because the wrapper is a transparent proxy** — that is the real safety argument and must be stated. After removal, `.bin/ruflo` resolves to the wrapper (its sole declarer) and `_cli_cmd` routes through it transparently; nothing breaks.
* **Bonus:** the change *fixes* a latent test bug — `lib/acceptance-diagnostic-checks.sh:38` treats `.bin/ruflo` as the wrapper but today it resolves to the CLI; the fix aligns the check with its intent.
* **Undeclared conflict:** two fork tests *enforce the opposite* — `tests/unit/rebrand-ruflo-bin.test.mjs:37` asserts `bin.ruflo === './bin/cli.js'` (and `ruflo-mcp` present), and `tests/unit/codemod-bin-preservation.test.mjs` asserts both survive the codemod. Both encode ADR-0006's accepted decision. This ADR must reconcile that decision and rewrite both tests (below); the original draft's `supersedes:[]` and its "one edit + one codemod test" surface estimate omit this.

## Decision Drivers

* **Converge with upstream** — upstream's CLI is `ruflo`-free and the wrapper owns `ruflo`; matching that ends the recurring `--theirs` merge tax on the `ruflo` key. ([[feedback-upstream-means-upstream]])
* **Minimum surface** — per CLAUDE.md "minimum code; nothing speculative": remove the colliding key rather than invent a fifth CLI bin alias (`ruflo-cli`) with no caller and no upstream precedent.
* **Determinism + honesty** — the wrapper is *advertised* as the canonical `ruflo` (ADR-0143) but *deterministically* bypassed; remove the collision so the advertisement is true. (No functional bug exists; this is honesty, per [[feedback-no-fallbacks]].)
* **Wrapper-guard load-bearing only where it actually runs** — the guards are publish/test/release-time, so this is about packaging correctness, not protecting a runtime guard.
* **Decision-integrity** — reconcile ADR-0006 (which added the CLI `ruflo` bin, now obsolete per ADR-0143) and rewrite its two enforcing tests; do not ship a silent contradiction.

## Considered Options

* **Option A — Rename CLI `bin.ruflo` → `ruflo-cli`.** Original choice. Adds a fork-only divergent bin upstream lacks; `ruflo-cli` has zero callers; still requires the ADR-0006 test rewrites. Rejected.
* **Option B — Remove `ruflo` from the CLI bin map** (keep `cli`, `claude-flow`, `claude-flow-mcp`; `ruflo-mcp` per the parity note below). The wrapper becomes the sole `ruflo` declarer; converges to upstream. **Chosen.**
* **Option C — Accept the collision; document it.** Leaves the wrapper advertised-but-bypassed; honesty defect persists. Rejected (but its "harm is cosmetic" insight is now folded into the corrected severity framing).
* **Option D — Rename the wrapper bin.** Contradicts ADR-0143. Rejected.

## Decision Outcome

**Chosen: Option B — remove `bin.ruflo` from `@sparkleideas/cli`.** The wrapper (`@sparkleideas/ruflo`) becomes the only package declaring `ruflo`, so `.bin/ruflo` resolves to it deterministically and on every platform. This matches upstream's wrapper-owns-`ruflo` division and ends the merge tax.

### Implementation surface

1. **Fork edit:** `forks/ruflo/v3/@claude-flow/cli/package.json` — remove the `"ruflo"` key from `bin`. Keep `cli`, `claude-flow`, `claude-flow-mcp` (all upstream-native, providing CLI-direct discoverability). Commit to `forks/ruflo` `main` with a descriptive message before `npm run release`.
2. **Parity note on `ruflo-mcp` — KEEP (settled, not optional):** `ruflo-mcp` HAS an active consumer: the `adr0113-bin-selfid` acceptance check (`lib/acceptance-adr0113-plugin-checks.sh:~378`, in the descriptive block from `:364`) spawns `node_modules/.bin/ruflo-mcp` directly and hard-fails if absent. Therefore **keep `ruflo-mcp`** — the parity-removal of `ruflo-mcp` is OFF, not a follow-up. Only `ruflo` is removed by this ADR. (Upstream's CLI has no `ruflo-mcp`; this is an accepted, caller-justified fork divergence, distinct from the colliding `ruflo` key.)
3. **Reconcile ADR-0006 + rewrite its tests:** `tests/unit/rebrand-ruflo-bin.test.mjs` — flip from "`bin.ruflo` present → `./bin/cli.js`" to "`bin.ruflo` ABSENT; `cli`/`claude-flow` present." `tests/unit/codemod-bin-preservation.test.mjs` — update the expected bin map (no `ruflo`). See [Supersession scope](#supersession-scope).
4. **Regression guard:** add an assertion (semantic home: `tests/unit/codemod-bin-preservation.test.mjs`) that the built `@sparkleideas/cli` bin map has **no `ruflo` key** — catches an upstream `--theirs` merge re-adding it. (Codemod already excludes `bin` from key-rewriting — `scripts/codemod.mjs:138` — so this is a pure fork-source edit, no new codemod pass.)
5. **No user-facing-docs churn:** ADR-0143 already migrated user surfaces to `@sparkleideas/ruflo`.

### Supersession scope

This ADR partially reverses **ADR-0006**'s bin-rebrand decision: ADR-0006 (via the `c5006bf97` follow-up) added `ruflo`/`ruflo-mcp` to the CLI bin so global-CLI-direct invocation worked. ADR-0143 superseded that recommendation (the wrapper is now the user-facing `ruflo`), making the CLI's `ruflo` bin obsolete and the *cause* of F-12-001. This ADR removes it. Only ADR-0006's CLI-`ruflo`-bin clause is reversed; any other ADR-0006 content stands. The two tests enforcing the old clause (above) are rewritten accordingly. (Frontmatter `supersedes:` is left empty because this is a partial, clause-level reversal, not a wholesale supersession of ADR-0006.)

### Confirmation

* **Premise/severity corrected in the record:** F-12-001 reframed as a *deterministic silent bypass* (honesty/forward-compat), not a flaky functional regression.
* **Functional invariant (portable, cross-platform):** in a fresh Verdaccio `/tmp` install of `@sparkleideas/ruflo@latest`, `ruflo --version` routes through the wrapper and behaves identically to `cli`/`claude-flow --version`. (This is the platform-agnostic check; Windows uses `.cmd` shims, not symlinks.)
* **Symlink-target assertion (POSIX-only — stated explicitly, per the ADR-0208 cross-platform lesson):** `readlink node_modules/.bin/ruflo` → `../@sparkleideas/ruflo/bin/ruflo.mjs`, asserted **in the co-install dir** (`ACCEPT_TEMP` — where both `@sparkleideas/cli` *and* `@sparkleideas/ruflo` are installed, `test-acceptance.sh:366`). **Do NOT place this in `acceptance-adr0142-bin-path.sh`'s wrapper-solo path** (`WRAPPER_SOLO_TEMP`): there `.bin/ruflo` resolves to the wrapper *unconditionally, before and after the fix*, so the assertion would be green regardless of whether `ruflo` was removed — i.e. it would not exercise the regression at all. The collision and the fix only manifest in the co-install dir. Skip on non-POSIX (Windows uses `.cmd` shims).
* **Unit tests rewritten:** `rebrand-ruflo-bin.test.mjs` asserts `bin.ruflo` ABSENT; `codemod-bin-preservation.test.mjs` expects the `ruflo`-free CLI bin map. **The merge-re-add catcher is `rebrand-ruflo-bin.test.mjs`** — it reads the *real* fork source (`../../../forks/ruflo/.../cli/package.json`), so it actually fails if a `--theirs` merge re-adds `ruflo`. `codemod-bin-preservation.test.mjs` runs `transform()` on *synthetic* in-memory input, so it only proves the codemod does not *add* `ruflo` — it cannot catch a real-source re-add. Keep both, but the real-source read (or a built-dist read of `/tmp/ruflo-build/.../cli/package.json`, NOT the gitignored fork-root dist) is the load-bearing regression guard.
* **`_cli_cmd` still resolves:** `.bin/ruflo` now → wrapper (sole declarer); `_cli_cmd` routes through it transparently; the latent `diagnostic-checks.sh:38` bug is fixed (it finally tests the wrapper).
* **AC#4 dropped** — there is no runtime "G4 header marker"; the `readlink` + functional checks are sufficient.
* INTEGRATION-LEDGER row for the fork-source edit ([[feedback-update-integration-ledger]]).

### Consequences

* Good, because `ruflo` deterministically resolves to the wrapper (its sole declarer) on every platform — the wrapper's ADR-0143 canonical status becomes true, not advertised-then-bypassed.
* Good, because the fork's CLI bin map converges toward upstream (`ruflo`-free), ending the recurring `--theirs` merge tax on the `ruflo` key. (`ruflo-mcp` is retained — it has an active acceptance-check consumer — so it remains an accepted, caller-justified fork divergence.)
* Good, because it's the minimum-surface fix — removes a colliding key rather than inventing a fork-only `ruflo-cli` with no caller and no upstream precedent.
* Good, because it fixes the latent `diagnostic-checks.sh:38` test bug and aligns `_cli_cmd`'s `ruflo`-first resolution with the wrapper.
* Bad, because it reverses ADR-0006's CLI-`ruflo`-bin clause and requires rewriting two tests — necessary decision-integrity work the original draft omitted.
* Bad, because a user who scripted `ruflo` as a *CLI-direct* command (global `@sparkleideas/cli` install) must switch to `cli`/`claude-flow` — but ADR-0143 already retired that recommendation, and no such caller exists in-repo.
* Neutral, because the harm being fixed is honesty/tidiness, not a functional regression (the wrapper and CLI are behaviourally identical by construction); the value is correctness-of-advertisement + upstream convergence, not a bug fix.

## Pros and Cons of the Options

### Option B — remove `ruflo` from the CLI bin (chosen)
* Good, because converges to upstream (CLI `ruflo`-free), minimum surface, ends the merge tax, deterministic wrapper resolution.
* Bad, because reverses ADR-0006's clause + two tests (decision-integrity cost, unavoidable under any fix).

### Option A — rename CLI `bin.ruflo` → `ruflo-cli` (original)
* Good, because keeps a CLI-direct discoverable name and builds cleanly (codemod preserves bin keys).
* Bad, because adds a fork-only divergent bin upstream lacks (more merge tax, not less); `ruflo-cli` has zero callers; `cli`/`claude-flow` already give discoverability; still needs the ADR-0006 test rewrites. Solves the same collision as B at higher long-term cost.

### Option C — accept + document
* Good, because zero packaging change; the harm is genuinely cosmetic (the corrected premise).
* Bad, because the wrapper stays advertised-but-deterministically-bypassed — an honesty defect ADR-0143 should not tolerate; future audits re-find it.

### Option D — rename the wrapper bin
* Bad, because contradicts ADR-0143's accepted user-facing brand. Rejected.

## Swarm review evidence (2026-05-20)

Six-expert review; verified at fork HEAD + a fresh Verdaccio `/tmp` install.

* **Packaging Architect** — reproduced `readlink .bin/ruflo` → CLI (wrapper bypassed); the ADR's "`_cli_cmd` uses package path" claim is false (it resolves `.bin/ruflo` first; survives via the transparent proxy); the change fixes the latent `diagnostic-checks.sh:38` bug; Option B simpler (`ruflo-cli` has zero callers).
* **Code Archaeologist** — CLI `bin.ruflo` is fork-added (`c5006bf97`, ADR-0006/0069 follow-up); upstream puts `ruflo` on a separate wrapper package; the CLI `ruflo` bin has been dropped-and-restored twice across merges. Rename converges, but B is closer to upstream.
* **Upstream Analyst** — upstream CLI bin = `{cli, claude-flow, claude-flow-mcp}`, no `ruflo`/`ruflo-mcp`; collision is fork-only; **undeclared conflict with ADR-0006 + 2 tests**; prefer B (and remove `ruflo-mcp` for full parity).
* **Build/Cross-Platform** — codemod preserves `bin` keys by design (pure fork-source edit); **collision is deterministic** (alphabetical tie-break), not flaky; AC#4 unimplementable; `readlink` confirmation is POSIX-only.
* **Devil's Advocate** — the load-bearing premise is false (bypassing the wrapper bypasses **zero runtime guards**; G4 is a comment); F-12-001 is a victimless WARN; the wrapper's own justifications are now obsolete; prefer B or downgrade-to-INFO, never A.
* **Queen** — synthesis: reject A → Option B (remove, converge to upstream); correct the premise (zero runtime guards bypassed; deterministic-not-flaky); fix the `_cli_cmd` claim; drop AC#4; supersede ADR-0006's clause + rewrite its two tests.

### Second council re-validation (2026-05-22)

A fresh 6-expert council re-verified ADR-0212. **Option B re-affirmed (5 endorse; the one B-vs-C dissent refuted on measurement).** All load-bearing facts hold: the four bin maps are exact, the wrapper is a transparent in-process `import()` proxy (byte-identical bypass — the WARN-by-honesty severity is code-justified), `ruflo`/`ruflo-mcp` have **never** existed in upstream's CLI (pickaxe = 0; upstream routes `ruflo` through a separate wrapper package), and the merge tax is real (≥3 `--theirs` restore commits). `supersedes:[]` + `## Supersession scope` is the correct partial-supersession pattern, and `depends-on:[0201,0143]` is load-bearing.

* **Headline fix — the regression guard was collision-blind as placed:** the `readlink` assertion must run in the **co-install dir** (`ACCEPT_TEMP`), not the wrapper-solo path (`WRAPPER_SOLO_TEMP`), where `.bin/ruflo`→wrapper unconditionally before *and* after the fix (green regardless = theatre); and the merge-re-add catcher must read **real fork source** (`rebrand-ruflo-bin.test.mjs`), since `codemod-bin-preservation.test.mjs` runs on synthetic input and cannot catch a real-source re-add. Confirmation updated.
* **`## Consequences` demoted** to `### Consequences` under Decision Outcome (template nesting).
* **Devil's-advocate B-vs-C dissent (recorded, not adopted):** because the bypass is byte-identical/harmless, Option C (accept + document, downgrade F-12-001 to INFO) is the genuine minimum-surface floor, and B's decision-integrity cost (reversing an ADR-0006 clause + 2 test rewrites) is heavyweight for a victimless defect. **The dissent's strongest argument — a suite-wide proxy-hop regression across ~266 `_cli_cmd` sites — was refuted by the feasibility expert:** the CLI import cost is already paid today (callers resolve to the CLI), the wrapper's incremental cost is single-digit ms in-process, and the in-process import still exercises CLI-direct startup (no masking). B holds on honesty + real merge-tax + minimum-surface (remove a colliding key vs mint a new fork-only `ruflo-cli`). **Conditions:** add an `INTEGRATION-LEDGER` row recording the `ruflo`-bin merge-tax history (per [[feedback-update-integration-ledger]] — the tax is real but currently unledgered), and keep the "converge" framing scoped to the `ruflo` key (`ruflo-mcp` deliberately stays a caller-justified divergence).
* **Cosmetic:** the `-rename-cli-bin` filename slug lags the REMOVE decision (reference-stable; optional rename); `ruflo-mcp` consumer line is `~:378` (not `:364`); tidy the stale `diagnostic-checks.sh:~57` "execFileSync('npx')" comment.

## More Information

Lifecycle dates from the original record: accepted 2026-05-19, implemented 2026-05-22. This ADR was swarm-reviewed.

* **Evidence:** `docs/audits/2026-05-19-soundness-audit/12-runtime-init-and-mcp-server.md` (F-12-001; bottom line "end-to-end runtime: sound").
* **Upstream:** `ruvnet/ruflo/v3/@claude-flow/cli/package.json` (CLI bin, no `ruflo`); `ruvnet/ruflo/ruflo/package.json` (wrapper owns `ruflo`).
* **Fork:** `forks/ruflo/v3/@claude-flow/cli/package.json` (edit target); ruflo-patch root `package.json:43` (wrapper bin); `bin/ruflo.mjs` (transparent proxy — the real "safety" is that it's behaviourally identical to the CLI); origin commits `c5006bf97`, `c071ace70`.
* **Conflicting tests to rewrite:** `tests/unit/rebrand-ruflo-bin.test.mjs:37`, `tests/unit/codemod-bin-preservation.test.mjs:51-52,89`. Codemod bin-exclusion: `scripts/codemod.mjs:132-138`. `_cli_cmd`: `lib/acceptance-checks.sh:23-35`. Latent-bug check: `lib/acceptance-diagnostic-checks.sh:38`. Wrapper guards: `scripts/check-wrapper-cli-lockstep.mjs` (G1), `tests/unit/wrapper-no-fallback.test.mjs` (G2), `lib/acceptance-adr0142-bin-path.sh` (G3), `bin/ruflo.mjs:30` (G4 comment).
* **Related ADRs:** ADR-0143 (user-facing brand → wrapper; retired the global-CLI-direct recommendation that ADR-0006 served), ADR-0142 (wrapper G1-G4 — publish/test/release-time, not runtime), ADR-0006 (CLI bin rebrand — clause partially reversed here), ADR-0201 (audit; F-12-001).
* **Memory:** [[feedback-no-fallbacks]] (honesty: advertised-but-bypassed), [[feedback-upstream-means-upstream]] (CLI `ruflo`-free upstream), [[feedback-corpus-evidence-before-feature-work]] (`ruflo-cli` has no caller), [[feedback-inspect-installed-not-dev-nodemodules]] (reproduced via fresh `/tmp` install), [[feedback-remediation-adr-preflight]] (premise-true-at-runtime + sibling-overlap checks both fired).

## Amendment — 2026-05-23 (Move A audit, implemented)

Status flipped: **proposed → implemented**. Converges with upstream's CLI-`ruflo`-free + wrapper-owns-`ruflo` division.

**Landed:**

- `forks/ruflo/v3/@claude-flow/cli/package.json` bin = `{ruflo-mcp, cli, claude-flow, claude-flow-mcp}` (no `ruflo`) — fork commit `3f726dcec` ("fix(packaging): ADR-0212 remove `ruflo` from CLI bin map (Option B)").
- Wrapper retains sole `ruflo` declaration at ruflo-patch root `package.json` → `bin/ruflo.mjs`.
- Merge-re-add catcher: `tests/unit/rebrand-ruflo-bin.test.mjs` (reads real fork source) → 7/7 pass via `node --test`.
- In-package arch test: `forks/ruflo/v3/@claude-flow/cli/__tests__/arch/adr0212-cli-bin-no-ruflo.arch.test.ts`.
- INTEGRATION-LEDGER row already recorded at `docs/upstream/INTEGRATION-LEDGER.md:132` (superseded-by-local, cites `3f726dcec`, F-12-001 closed).

Upstream parity: `ruvnet/ruflo/v3/@claude-flow/cli/package.json` CLI bin is `ruflo`-free; `ruvnet/ruflo/ruflo/package.json` wrapper owns `ruflo`. ADR-0006 CLI-`ruflo`-bin clause partially reversed as planned.
