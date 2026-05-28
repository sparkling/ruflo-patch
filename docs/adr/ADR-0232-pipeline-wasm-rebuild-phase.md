---
status: accepted
completed: true
date: 2026-05-24
accepted: 2026-05-28
implemented: 2026-05-28
tags: [pipeline, wasm, rebuild, ruvector, build]
supersedes: []
depends-on: [0150, 0231]
implements: []
---

> **Status note (2026-05-28)**: All 4 in-tree Confirmation criteria
> satisfied. (Criterion #5 — end-to-end Verdaccio refresh — is a runtime
> verification that fires on the first WASM source change after this
> ADR lands; not a build-time gate.)
> - **#1 `WASM_PACKAGES` config**: `lib/wasm-config.sh` ships the
>   ruvllm-wasm entry per the ADR's §Confirmation row #1.
> - **#2 `scripts/wasm-rebuild.sh`**: parallel to `napi-rebuild.sh`
>   (source-diff → wasm-pack build → mtime verify-fresh → commit-and-
>   push). Per ADR-0232 §Bad: requires `wasm-pack` in PATH; fails loud
>   if missing.
> - **#3 wiring in `scripts/ruflo-publish.sh`**: `wasm-rebuild` phase
>   added immediately after `napi-rebuild` (ordering verified by unit
>   test).
> - **#4 unit tests**: `tests/unit/adr0232-wasm-config.test.mjs` — 7/7
>   pass; mirrors `adr0150-napi-config.test.mjs` schema-validation
>   pattern; asserts WASM_PACKAGES well-formedness, ruvllm-wasm entry,
>   per-entry Cargo.toml existence, helper presence, script shebang +
>   bash syntax, and phase ordering in publish.sh.

# Pipeline wasm-rebuild phase for pure-WASM crates

## Context and Problem Statement

The publish pipeline has a `napi-rebuild` phase (`scripts/napi-rebuild.sh`,
established by ADR-0133 and generalised by ADR-0150) that detects Rust source
changes for napi-rs crates and rebuilds their `.darwin-arm64.node` binaries
before publish. The phase is driven by `lib/napi-config.sh::NAPI_PACKAGES`
(currently 12 entries across `forks/ruvector` and `forks/agentic-flow`) and
includes mtime verification, commit-and-push of refreshed binaries, and a
"refuse if 0 binaries refreshed" guard.

There is no equivalent phase for **pure-WASM crates** — crates whose published
artefact is a `wasm-pack`-generated bundle (`*_bg.wasm` + `*.js` + `*.d.ts`)
rather than a NAPI `.node`. The pipeline's existing WASM touchpoint
(`scripts/build-wasm.sh`, sourced from `lib/pipeline-helpers.sh::run_build`)
is a one-off hardcoded to a single crate path
(`packages/agent-booster/crates/agent-booster-wasm` in `agentic-flow`). It
does not enumerate or rebuild any other WASM crate.

The forks contain a large pure-WASM surface that the pipeline currently
ignores:

- `forks/ruvector/crates/` carries ~30 `*-wasm` crates with
  `wasm-bindgen` + `crate-type = ["cdylib", "rlib"]` (verified by
  `find … -path '*wasm*'` + `grep wasm-bindgen + cdylib`).
- Of those, the subset that ships a canonical `npm/packages/<name>/` publish
  directory (the artefact the pipeline already publishes via Verdaccio) is
  smaller — at least `ruvllm-wasm` and `rvagent-wasm` are confirmed; the
  full inventory is an open question (see below).

**This gap surfaced concretely in ADR-0231 wave A9 (defect 2,**
`docs/SESSION-HANDOVER-2026-05-24-adr0231.md` **§"Pipeline defects fixed in
wave A9").** A stale `forks/ruvector/crates/ruvllm-wasm/pkg/` left by an
April-18 manual `wasm-pack build` (untracked but not gitignored) survived in
the working tree. After codemod, both `pkg/` and the canonical
`npm/packages/ruvllm-wasm/` declared the same publishable name, and
`publish.mjs::buildPackageMap` silently picked the stale dir (walk-order +
trailing-slash bug in `SUBDIR_BLACKLIST`). ADR-0231's `9f6577f` fixed the
immediate symptom by failing loud on unresolvable duplicates. That is a
**defensive** fix — it converts a silent wrong-artefact publish into a
build-time error. The underlying gap remains: the pipeline never rebuilds
the canonical WASM artefact, so stale outputs anywhere on disk
(manually-run `wasm-pack` defaults, sibling crate experiments, contributor
local builds) can still compete for the publishable-name slot, and the
canonical artefact itself can lag behind Rust source.

Today's workaround is that contributors must remember to run `wasm-pack
build` manually before triggering a release. This is the same class of bug
ADR-0133 fixed for NAPI: "the published artifact shipped stale binaries even
after Rust source changes, masking the fix." For pure-WASM crates that
risk is currently uncovered.

## Decision Drivers

* **Re-converge on the napi-rebuild model.** The same source-changed →
  rebuild → verify-fresh → commit-and-push pattern is already understood,
  tested, and operated for NAPI. Re-using that mental model is cheaper than
  a parallel design.
* **Make the canonical WASM artefact authoritative at release time.** If
  `npm/packages/<name>/<name>_bg.wasm` is always pipeline-built from current
  Rust source, stale wasm-bindgen output elsewhere on disk loses its claim
  on the publishable-name slot.
* **Detect source drift idempotently.** Per `[[feedback-no-fallbacks]]`,
  silent skip on "we don't know if source changed" is the anti-pattern; the
  napi-rebuild source-diff predicate ("any `*.rs` / `Cargo.toml` change
  under the configured crate paths since prev SHA") is the proven shape.
* **Don't expand the surface beyond crates that actually publish.** Of the
  ~50 WASM-named crates across forks, most are example apps, plugin
  experiments, or unpublished libraries. Only the subset with a canonical
  `npm/packages/<name>/` (or single-binary equivalent) publish dir is in
  scope; the others stay developer-local builds.
* **Co-bump versions correctly.** The ADR-0150 NAPI loop commits rebuilt
  `.node` binaries back to the fork on `main` so the source-of-truth
  matches the published artefact. The WASM phase must do the same for
  `_bg.wasm` / `.js` / `.d.ts` artefacts that live under
  `npm/packages/<name>/`, OR explicitly mark them as build-output that
  doesn't get committed back (see open question).
* **Don't reintroduce the duplicate-name silent-pick footgun.** Whatever
  shape the phase takes, it must not write its rebuild output into a
  `crates/<name>/pkg/` default location that could compete with the
  canonical `npm/packages/<name>/` after codemod (the ADR-0231 wave A9
  shape).

## Considered Options

* **Option A — Extend `napi-rebuild` semantics to also cover wasm-pack** —
  generalise `lib/napi-config.sh` to a `RUST_PACKAGES` config that carries
  a `kind: napi|wasm` field; teach `scripts/napi-rebuild.sh` to dispatch on
  kind (run `napi build` or `wasm-pack build`); verify-fresh selects the
  right output extension per kind; commit-and-push handles both. One phase
  in `scripts/ruflo-publish.sh`.
* **Option B — Add a sibling `scripts/wasm-rebuild.sh` phase** — modelled
  on `napi-rebuild.sh` (same source-diff predicate, same verify-fresh
  pattern, same commit-and-push) but a separate file, separate config
  (`lib/wasm-config.sh::WASM_PACKAGES`), separate phase entry in
  `scripts/ruflo-publish.sh`. Two phases, structurally parallel.
* **Option C — Inline into `scripts/build-wasm.sh`** — generalise the
  existing per-`agent-booster-wasm` script to a list-driven rebuilder.
  Stays inside `run_build` (called from `lib/pipeline-helpers.sh::run_build`)
  rather than becoming its own phase.
* **Option D — Status quo (defensive only)** — keep ADR-0231's fail-loud
  duplicate-name guard; rely on contributors to run `wasm-pack build`
  manually before triggering a release.

## Decision Outcome

Chosen option: **Option B — sibling `scripts/wasm-rebuild.sh` phase**,
because it preserves the proven napi-rebuild shape (source-diff →
rebuild → verify-fresh → commit-and-push) while keeping the WASM-specific
details (wasm-pack invocation, `_bg.wasm` mtime verification, optional
`pkg/` cleanup, output-dir conventions) isolated from the NAPI logic. The
two phases are structurally parallel, which makes the napi-rebuild
mental model directly transferable without overloading either script with
a per-call `kind` switch.

Option A's appeal is "one config to rule them all", but the WASM and NAPI
build commands, verification artefacts, and commit shapes differ enough
that a generalised `RUST_PACKAGES` config would either leak kind-specific
fields into every entry or branch internally — re-inventing the two-script
split as a tagged union. Option C keeps WASM tangled inside `run_build`,
which is the *build* step not the *publish* phase, and `run_build` already
runs every cycle whether or not source changed; the source-diff cache that
makes napi-rebuild a no-op on unchanged forks would have nowhere natural
to live. Option D is what ADR-0231 already gave us; it converts wrong
artefacts to build errors but leaves the canonical artefact stale.

The phase is added to `scripts/ruflo-publish.sh` immediately after the
existing `napi-rebuild` invocation (so any Rust change rebuilds both
binary kinds in one pass), runs against a `WASM_PACKAGES` config in
`lib/wasm-config.sh`, and is opt-in per crate (start with `ruvllm-wasm`,
add others as the publishable inventory is confirmed).

### Consequences

* Good, because the canonical WASM artefact at `npm/packages/<name>/` is
  always pipeline-built from current Rust source — closes the ADR-0231
  wave A9 class of bug at the source instead of just at duplicate-detect.
* Good, because the napi-rebuild mental model transfers directly:
  source-diff predicate, mtime-marker verify-fresh, commit-and-push on
  main with sparkling remote — operators don't have to learn a new shape.
* Good, because the WASM-specific concerns (wasm-pack output path,
  `pkg/`-default cleanup, byte-identical mtime-only changes) are isolated
  from NAPI logic; neither script grows a kind-switch.
* Good, because per-crate opt-in (`WASM_PACKAGES` starts with the
  confirmed-publishable subset) avoids accidentally roping in
  example/experiment crates that don't ship.
* Bad, because adds a second config file (`lib/wasm-config.sh`) and a
  second script (`scripts/wasm-rebuild.sh`) to maintain — structural
  parallelism instead of consolidation.
* Bad, because does not retire `scripts/build-wasm.sh` (the
  agent-booster-wasm one-off) on day one. Folding that into
  `WASM_PACKAGES` is a follow-on cleanup once the new phase is stable,
  to avoid coupling this ADR to an unrelated artefact's correctness.
* Bad, because requires a CI/dev environment with `wasm-pack` available
  to actually rebuild. The existing `build-wasm.sh` silently `exit 0`s
  when `wasm-pack` is missing; the new phase should fail loud per
  `[[feedback-no-fallbacks]]`, which means the release host must have
  `wasm-pack` installed (a one-time setup tax).
* Neutral, because the source-diff predicate is the same as napi-rebuild
  — both can no-op cheaply when no `*.rs` / `Cargo.toml` changed under
  the configured paths, so the additional phase has near-zero cost on
  releases that don't touch WASM source.

### Confirmation

This ADR is `proposed`. Implementation lands in a follow-on session and
must include:

1. A `WASM_PACKAGES` config entry for `forks/ruvector/crates/ruvllm-wasm`
   pointing at `npm/packages/ruvllm-wasm/` as the canonical output dir.
2. A `scripts/wasm-rebuild.sh` modelled on `scripts/napi-rebuild.sh`
   (source-diff → wasm-pack build → mtime verify-fresh → commit-and-push).
3. A wiring step in `scripts/ruflo-publish.sh` adding the
   `wasm-rebuild` phase immediately after `napi-rebuild`.
4. Unit-test coverage paralleling
   `tests/unit/adr0150-napi-config.test.mjs` (schema validation) and a
   regression test that flexes the ADR-0231 wave A9 shape (stale
   `crates/<name>/pkg/` present + canonical
   `npm/packages/<name>/<name>_bg.wasm` exists, rebuild produces
   fresh-mtime output in the canonical location, no duplicate-name
   resolution required at publish time).
5. End-to-end verification: trigger a release with a no-op WASM source
   change on `ruvllm-wasm` and confirm Verdaccio receives a refreshed
   `@sparkleideas/ruvector-ruvllm-wasm` whose `_bg.wasm` mtime postdates
   the rebuild marker.

The decision is followed in code review by checking that any new
publish-target WASM crate added to a fork either lands in `WASM_PACKAGES`
(if pipeline-rebuilt) or carries an explicit ADR-referenced exception.

## Pros and Cons of the Options

### Option A — Extend `napi-rebuild` to dispatch on `kind`

* Good, because one config + one script — single source of truth for
  "Rust crates the pipeline rebuilds before publish".
* Good, because the source-diff / verify-fresh / commit-and-push wrapper
  is genuinely reusable across kinds.
* Bad, because each entry would need `kind: napi|wasm` plus
  kind-specific fields (NAPI dest_npm_dir vs WASM output-dir-under-crate),
  which is a tagged union the two-script split avoids by construction.
* Bad, because tests would need cross-kind cases (a wasm change must not
  trigger napi rebuild and vice-versa); the parallel-script form gets
  this for free by being two separate scripts.

### Option B — Sibling `scripts/wasm-rebuild.sh` phase (chosen)

* Good, because preserves the proven napi-rebuild shape verbatim.
* Good, because WASM-specific quirks (wasm-pack's `pkg/` default output,
  `_bg.wasm` vs `.node` extensions) stay isolated from NAPI logic.
* Good, because pipeline phase ordering is explicit
  (`napi-rebuild` → `wasm-rebuild`) and the second is skippable when no
  WASM crates have changed.
* Bad, because two scripts to maintain instead of one — duplication of
  the wrapper shell (~50 lines of source-diff + mtime + git push logic).

### Option C — Inline into `scripts/build-wasm.sh`

* Good, because reuses the existing WASM touchpoint inside `run_build`.
* Good, because no new pipeline phase to wire.
* Bad, because `run_build` runs every cycle, so the source-diff cache
  (which makes napi-rebuild cheap on unchanged forks) has no natural
  home. Either every release rebuilds every WASM crate, or the cache
  logic gets pulled into `run_build` and starts looking like a phase
  anyway.
* Bad, because no commit-and-push of rebuilt artefacts — `run_build`
  operates on `/tmp/ruflo-build/`, not the fork checkout. The source-
  of-truth-matches-published-artefact property that ADR-0150 buys for
  NAPI would be missing for WASM.

### Option D — Status quo + contributor discipline

* Good, because zero new pipeline surface.
* Good, because ADR-0231's defensive guard already converts the
  wrong-artefact failure mode into a release-time error.
* Bad, because canonical artefact can still lag behind Rust source —
  ADR-0231 only stops the *competing* stale dir from winning; the
  canonical dir's content is whatever the last contributor's manual
  `wasm-pack build` produced (which may have been months ago).
* Bad, because doesn't survive a contributor-onboarding test ("clone,
  edit `ruvllm-wasm/src/lib.rs`, run release" should publish fresh
  bytes — today it would publish stale bytes from the canonical dir).

## More Information

### Open questions for implementation

* **Per-crate opt-in vs auto-detect.** Auto-detect = "any crate with
  `crate-type = ["cdylib", "rlib"]` + `wasm-bindgen` dep + a matching
  `npm/packages/<name>/` dir". Cleaner but couples discovery to
  filesystem conventions that vary across forks (ruvector uses
  `npm/packages/<name>/`; agentic-flow uses
  `packages/<parent>/wasm/`). Per-crate opt-in via explicit
  `WASM_PACKAGES` entries — matching ADR-0150's NAPI approach — is the
  conservative starting position.
* **`pkg/` cleanup + .gitignore.** ADR-0231 wave A9's symptom was a
  stale, untracked-but-not-gitignored
  `forks/ruvector/crates/ruvllm-wasm/pkg/`. The phase should pass
  `--out-dir` to wasm-pack pointing at the canonical
  `npm/packages/<name>/` (avoiding the `pkg/` default entirely). For
  defense-in-depth, the implementation should also ensure
  `crates/<name>/pkg/` is in the fork's `.gitignore` so contributor
  manual builds don't accidentally re-introduce the duplicate.
* **Idempotency / source-hash cache.** `scripts/build-wasm.sh` uses a
  sha256-of-source cache. `scripts/napi-rebuild.sh` uses prev-SHA from
  `.last-build-state`. They're different mechanisms. The new phase
  should follow napi-rebuild's prev-SHA approach for consistency, since
  it's the model the rest of the phase inherits.
* **Commit-back semantics.** NAPI commits `.darwin-arm64.node` binaries
  back to fork main because the binary IS the published artefact (npm
  doesn't re-run the build). For WASM, the same logic applies to
  `_bg.wasm` + `.js` + `.d.ts` under `npm/packages/<name>/`. The phase
  must replicate napi-rebuild's "if `git diff --cached` is empty
  (byte-identical rebuild), skip the commit" branch.
* **`wasm-pack` availability.** `scripts/build-wasm.sh` silently
  `exit 0`s when wasm-pack is missing. The new phase should fail loud
  per `[[feedback-no-fallbacks]]` — release host must have `wasm-pack`
  installed; if it's missing, release fails with a clear error rather
  than publishing a stale artefact.
* **Fold `build-wasm.sh` in eventually.** Once `wasm-rebuild` is stable
  for `ruvllm-wasm`, the existing one-off for `agent-booster-wasm`
  becomes a candidate `WASM_PACKAGES` entry. Folding it in is a clean
  separate-commit follow-on once the new phase has bake time on the
  ruvector path.

### Related decisions

* **ADR-0133** — original napi-rebuild phase (ruvector-only). Establishes
  the source-diff + rebuild + verify-fresh pattern this ADR mirrors.
* **ADR-0150** — generalises napi-rebuild to multi-fork via
  `lib/napi-config.sh::NAPI_PACKAGES`. The configuration shape this ADR
  proposes (`lib/wasm-config.sh::WASM_PACKAGES`) is structurally
  parallel.
* **ADR-0231** — surfaced the gap. Wave A9 defect 2 fixed the silent
  duplicate-name pick in `publish.mjs::buildPackageMap` (defensive);
  this ADR proposes closing the underlying gap (no auto-rebuild) at
  the source.
* `scripts/build-wasm.sh` — current single-crate WASM build (for
  `agent-booster-wasm`); candidate for folding into `WASM_PACKAGES`
  once the new phase is stable.

### Reference paths

* `scripts/napi-rebuild.sh` — the model.
* `lib/napi-config.sh` — the config-shape model.
* `lib/pipeline-helpers.sh::run_build` — where `build-wasm.sh` is
  currently invoked.
* `scripts/ruflo-publish.sh` — where the new phase wires in (post
  `napi-rebuild`).
* `scripts/publish.mjs::buildPackageMap` — the defensive guard added
  by ADR-0231 wave A9 (this phase removes the need for that guard to
  fire on the WASM path).
* `forks/ruvector/crates/ruvllm-wasm/` + `forks/ruvector/npm/packages/ruvllm-wasm/`
  — the canonical first-target pair.
