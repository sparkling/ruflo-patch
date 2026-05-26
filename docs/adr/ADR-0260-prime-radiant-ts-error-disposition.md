---
status: accepted
completed: true
date: 2026-05-25
tags: [tsconfig, build-system, fork-hygiene, prime-radiant, deferred-followup]
supersedes: []
depends-on: [ADR-0257]
implements: []
---

# prime-radiant TS error disposition (resolves ADR-0257 #17)

## Context and Problem Statement

[[ADR-0257]] row #17 deferred "388 pre-existing TS errors in fork — `plugins/prime-radiant/`, other outside-cli paths" with trigger condition: "a TS error in those paths blocks a release OR fork CI extends to those dirs." The user directive to work on deferred items has fired the trigger.

Investigation produced a different picture than the deferral row suggested:

1. **The 388 count is real but mis-attributed.** Running `npm run build` (i.e. `tsc`) at `forks/ruflo/` root with the previous `tsconfig.json` emits 388 errors. Only 12 of those land in `v3/plugins/prime-radiant/src/` — the other 376 are scattered across 23 paths (`v3/@claude-flow/plugins/examples/` 184, `v3/@claude-flow/security/__tests__/` 53, `v3/goal_ui/supabase/functions/` 19, `v3/@claude-flow/plugin-agent-federation/src/` 13, `v3/@claude-flow/memory/examples/` 11, `v3/plugins/gastown-bridge/src/` 9, `v3/@claude-flow/plugin-iot-cognitum/src/` 8, `v3/@claude-flow/neural/src/` 7, and the rest sub-10 each, plus 25 errors in the orphaned `v3/index.ts` aggregate re-export). The validator audit at `docs/audits/2026-05-25-picks-validation.md:38` reported this correctly; the ADR-0257 row #17 wording compressed it into a single path.

2. **The 12 prime-radiant errors are root-tsc-configuration artefacts, not source bugs.** Three (`prime-radiant-advanced-wasm` not found) resolve when the package's own deps are installed locally (`cd v3/plugins/prime-radiant && npm install && npm run typecheck` exits 0). Nine (`WebAssembly.compile`/`instantiate`/`Imports`/`ImportValue` not found) are absent from root tsc's `lib: ["ES2022"]` but present in the per-package `lib: ["ES2022", "DOM"]`. Both classes evaporate under the per-package tsconfig.

3. **No build path actually invokes root `tsc`.** The publish pipeline runs `scripts/build-packages.sh` (which calls `gen-tsconfig.mjs` to produce per-package `tsconfig.build.json` with `/tmp/ruflo-tsc-toolchain/stubs/` for optional WASM/native deps and sibling `dist/*.d.ts` paths for cross-workspace deps — verified at `scripts/gen-tsconfig.mjs:55-78`). Fork CI runs `npm run build:ts` which is `cd v3/@claude-flow/cli && npm run build || true` (`forks/ruflo/.github/workflows/ci.yml:147-150`). The v3 monorepo's `pnpm -r typecheck` (`forks/ruflo/v3/package.json:29`) iterates only the `@claude-flow/*` and `claude-flow` workspaces — `v3/plugins/*` and `v3/goal_ui/*` are excluded from that workspace set. `npm pack --dry-run` on the built TEMP_DIR (`/tmp/ruflo-build`) confirms the published package's `files:` whitelist ships only per-package `v3/@claude-flow/{cli,shared,guidance}/dist/` — the root `dist/v3/` produced by root `tsc` is never published.

4. **Trigger conditions for ADR-0257 #17 remain false.** "Blocks a release" — false; the pipeline doesn't run root `tsc`. "Fork CI extends to those dirs" — false; the only fork CI typecheck job (`.github/workflows/v3-ci.yml:281-284`) runs `pnpm typecheck` inside `v3/` (workspace-scoped, excludes plugins) with `continue-on-error: true`, and `npm run build:ts` is cli-scoped. The actual fork-CI surface area was already correct.

The root `tsconfig.json` had `include: ["v3/**/*.ts"]` from a long-superseded monolithic build era. It tries to compile the entire v3 tree under one `tsc` invocation, which can't work because each package has its own `node_modules` / `lib` / module resolution. The 388 errors are the visible artefact of that mismatch; they never reached any consumer because nothing observed them. They mis-signalled as "fork health debt" in the ADR-0257 deferral inventory.

## Decision Drivers

* **`feedback-no-fallbacks`** — do not pick a path that just makes the count go away. Each error must either be (a) a real bug that's fixed in source, or (b) explicitly documented as an artefact of stale tooling that no build path observes. The 388 are (b); the disposition must say so clearly.
* **`feedback-corpus-evidence-before-feature-work`** — the deferral row used a hypothetical premise ("might block a release later"). Evidence-walk shows neither trigger condition is met now and neither has a credible path to firing: the pipeline build (`build-packages.sh`) and fork CI (`build:ts` + workspace-scoped `pnpm typecheck`) both deliberately route around root `tsc`. Adding fork CI coverage of `v3/plugins/*` via root `tsc` would be a regression — those plugins have their own tsconfigs that already typecheck cleanly (verified: `cd v3/plugins/prime-radiant && npm install && npm run typecheck` exits 0).
* **Don't break IDE conventions.** A root `tsconfig.json` is conventional and IDE language servers may consult it. Removing it entirely creates a different problem. The replacement should be a sensible "solution-style" tsconfig that delegates to per-package builds via project references rather than a stale monolithic include.
* **Keep `npm run build` working.** The script convention `npm run build` at fork root should exit 0, not regress to a `TS18003` (no inputs found) error or a sentinel `echo "use build:ts"`. A solution tsconfig with `files: []` + `references: [...]` exits 0 cleanly on `tsc` (no-op) AND honours `tsc --build` semantics if anyone invokes it (delegating to per-package builds).

## Considered Options

* **Option A — Fix each of the 388 errors in source.** Touch 75 files across 23 paths. Most fixes would amount to adding `// @ts-expect-error` or changing source to compile under root tsc's narrower `lib`/missing-stubs context, which makes source worse to satisfy a tool nothing uses.
* **Option B — Add `exclude: ["v3/plugins/prime-radiant/**"]` to root tsconfig.** Addresses 12/388. Doesn't engage with the actual problem (root tsc include is misconfigured for the entire v3 tree).
* **Option C — Replace root `tsconfig.json` with a solution-style config (files: [] + project references to the v3 workspace packages).** Aligns with `v3/tsconfig.json`'s existing solution-style structure (`forks/ruflo/v3/tsconfig.json:18-29`). Root `tsc` exits 0 as a no-op; `tsc --build` properly delegates to per-package builds. The 388 errors disappear because root tsc no longer tries to compile code it can't compile.
* **Option D — Delete root `tsconfig.json` entirely; change `"build": "tsc"` to `"build": "npm run build:ts"`.** Simpler but breaks IDE conventions that expect a root tsconfig.

## Decision Outcome

Chosen option: **Option C** — replace root `tsconfig.json` with a solution-style config that documents the disposition inline and delegates to per-package builds via project references.

The replacement tsconfig:

* Sets `files: []` so plain `tsc` exits 0 as a no-op (TypeScript's solution-file semantics).
* Lists project references for the 10 v3 workspace packages that participate in the monorepo build, mirroring `v3/tsconfig.json`'s references. `tsc --build` at root now delegates to per-package builds.
* Carries a leading `//` documentation comment naming this ADR, explaining that root tsc is not a build entry, and pointing IDE/CLI users at the real build paths (per-package `tsconfig.json`, `scripts/build-packages.sh` via `gen-tsconfig.mjs`, fork CI's `npm run build:ts`, and `pnpm -r typecheck` inside `v3/`).
* Drops `outDir`, `rootDir`, `declaration`, `declarationMap`, `sourceMap`, the `@v3/*` path alias, and the v3 include glob — none were doing useful work given the root build was never observed.

The 12 prime-radiant errors do not require source changes: `cd v3/plugins/prime-radiant && npm install && npm run typecheck` is the actual typecheck path and exits 0. The pipeline build via `gen-tsconfig.mjs` succeeds (verified: `/tmp/ruflo-build/v3/plugins/prime-radiant/dist/` contains compiled `index.js`/`index.d.ts`/etc.).

### Consequences

* Good, because `npm run build` at fork root exits 0 cleanly instead of emitting 388 errors. The "fork has 388 TS errors" signal stops mis-firing in audits and validator reports.
* Good, because real build paths (`scripts/build-packages.sh`, `npm run build:ts`, per-package `npm run build`, `pnpm -r typecheck`) are unchanged — Option C is surgical to the root tsconfig only, no source files touched, no published artefact affected.
* Good, because `tsc --build` at root now does the right thing (delegate to per-package builds) instead of trying to compile a 75-file aggregate that can't possibly resolve.
* Good, because the inline `//` comment in `tsconfig.json` points future readers at the per-package build paths and at this ADR, reducing the chance someone re-introduces a monolithic `include` glob.
* Bad, because the orphaned `v3/index.ts` aggregate re-export (which contributes ~25 root-tsc errors via missing-module references to deleted paths) is not deleted by this ADR. Its disposition is deferred — it appears to be dead code (no importers found in the codebase via `grep -rn "from.*'./v3/index'\|from.*'./v3'\|require.*v3/index"`), but deletion is out of scope for this disposition. Trigger for follow-up: any signal that something does in fact import it (no current evidence), or a separate fork-hygiene pass that audits dead aggregate files. The file's broken state is now invisible (root tsc doesn't include it).
* Bad, because if a future fork CI job adds `tsc` at root scope, it will silently succeed (no-op) rather than catch regressions in the v3 packages. Mitigation: the existing per-package CI paths (`build:ts`, `pnpm -r typecheck`) already cover the packages that actually ship; the no-op `tsc` is documented in the inline comment.
* Neutral, because IDE language servers that consult root `tsconfig.json` now see a solution-style config — modern TypeScript-language-server / VS Code handle this via project references, but very old IDE configs might lose the "compile everything under v3/" view. No evidence that anyone relied on that view (the 388 errors would have been visible long ago if anyone had been running root tsc as a typecheck).

### Confirmation

* `cd forks/ruflo && npm run build` exits 0 with no TypeScript errors (verified at decision time).
* `cd forks/ruflo && npm run build:ts` continues to exit 0 (the CI path is unchanged; verified at decision time).
* `cd forks/ruflo/v3/plugins/prime-radiant && npm install && npm run typecheck` exits 0 (the per-package path is unchanged; verified at decision time).
* `cd forks/ruflo && npx tsc --build --dry --verbose` lists the 10 v3 workspace projects as candidates (verified at decision time).
* The publish pipeline (`scripts/build-packages.sh` → `gen-tsconfig.mjs`) continues to produce `dist/` for prime-radiant and other plugins. Verified before this disposition: `/tmp/ruflo-build/v3/plugins/prime-radiant/dist/index.js` exists.

## Pros and Cons of the Options

### Option A — Fix each of the 388 errors in source

* Good, because root `tsc` would actually compile after the work was done — restoring the original intent.
* Bad, because most fixes are configuration-shaped (root tsc's `lib`/stub/sibling-paths scope is wrong for the v3 tree), not source-shaped. Patching source to satisfy a tool that no build path observes is the inverse of what's needed.
* Bad, because the 388 number understates the actual surface: many of the 184 errors in `v3/@claude-flow/plugins/examples/` reference modules that no longer exist in fork (per the `ruvector-plugins/` examples calling APIs that the post-extraction `@ruvector/*` packages no longer expose). The "fix" would be to delete the examples, which is unrelated work.
* Bad, because once "fixed", every future drift in any of 75 source files would re-introduce errors and force a similar disposition again — the underlying tool/code mismatch isn't resolved.

### Option B — Exclude only `v3/plugins/prime-radiant/**` from root tsc

* Good, because it directly answers ADR-0257 #17's narrow framing.
* Bad, because the framing was wrong: only 12/388 errors land in prime-radiant. Excluding only prime-radiant leaves 376 root-tsc errors emitted by `npm run build`. The audit signal still mis-fires.
* Bad, because to get to 0 errors at root tsc you'd have to enumerate-and-exclude 23 paths — a long-tail maintenance burden every time a new plugin or example directory appears under v3.

### Option C — Solution-style root tsconfig with project references

* Good, because it aligns root tsconfig with the structure `v3/tsconfig.json` already uses successfully (project references, `files: []`, ten workspace projects).
* Good, because `tsc --build` at root now does something useful (delegate to per-package builds) instead of trying to compile a stale aggregate.
* Good, because the inline `//` doc comment carries the disposition into the file itself — future readers don't need to consult the ADR catalogue to understand why root tsc is a no-op.
* Bad, because someone reading "the root tsconfig has `files: []`" without the inline comment might assume the project is broken and "fix" it by re-adding an include glob. Mitigation: the comment explicitly warns against re-introducing the glob and points at the 388-errors-no-one-observed history.

### Option D — Delete root `tsconfig.json` entirely

* Good, because simpler — one fewer config file to maintain.
* Bad, because IDEs and some tools probe for `tsconfig.json` at the project root by convention. Removing it can degrade IDE experience (no fallback compiler options visible to the language server) and breaks tooling that walks up from a file location looking for the nearest config.
* Bad, because changing `"build": "tsc"` to `"build": "npm run build:ts"` ties the build script alias to one specific workspace (`cli`), which is fine today but bakes that coupling into the user-facing convention.

## More Information

* [[ADR-0257]] §Item 17 — the deferral row this ADR resolves.
* `forks/ruflo/.github/workflows/ci.yml:147-150` — fork CI build path (`npm run build:ts`, NOT `npm run build`).
* `forks/ruflo/.github/workflows/v3-ci.yml:257-284` — fork CI v3 typecheck path (`pnpm -r typecheck` in `v3/`, `continue-on-error: true`).
* `forks/ruflo/v3/package.json:29` — `pnpm -r typecheck` iterates only the `@claude-flow/*` workspaces (excludes `v3/plugins/*`).
* `scripts/build-packages.sh:43-456` (`run_build`) and `scripts/gen-tsconfig.mjs:27-117` — the publish pipeline's actual per-package build path with stub injection and sibling `dist/*.d.ts` resolution.
* `docs/audits/2026-05-25-picks-validation.md:38-44` — the validator audit that surfaced the 388-error count alongside the (correct) observation that the picks didn't introduce any of them.
* `forks/ruflo/v3/tsconfig.json:18-29` — the existing solution-style tsconfig that this ADR's root config mirrors.
* `forks/ruflo/v3/plugins/prime-radiant/tsconfig.json` — the per-package tsconfig that actually compiles the plugin (with `lib: ["ES2022", "DOM"]` for WebAssembly types and real `node_modules` for `prime-radiant-advanced-wasm`).
* `[[feedback-no-fallbacks]]` — the rule that forced rejecting Option B (silencing the count without engaging with the actual mismatch) and shaped the inline doc comment in the replacement tsconfig.
