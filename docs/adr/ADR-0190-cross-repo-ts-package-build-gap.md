---
status: accepted
date: 2026-05-19
tags: [pipeline, publish, typescript]
supersedes: []
depends-on: [ADR-0082, ADR-0189]
implements: []
---

# Cross-repo TypeScript package build — codify the contract

## Context and Problem Statement

The 2026-05-19 dogfood session surfaced a real publish-pipeline gap:
`@sparkleideas/ruvector-ruvllm@2.5.5-patch.95` was published with
`main: "dist/cjs/index.js"` declared in its `package.json` — but the
tarball **did not contain `dist/`**. Every consumer's
`require('@sparkleideas/ruvector-ruvllm')` failed with
`MODULE_NOT_FOUND`, so `ruflo neural status` reported "ruvllm
Coordinator: Unavailable / Install @sparkleideas/ruvector-ruvllm"
even when the package WAS installed.

The cause:

* The source package at `forks/ruvector/npm/packages/ruvllm/`
  declares `scripts.prepublishOnly: "npm run build"` which runs `tsc`
  to produce `dist/cjs/`.
* Our publish pipeline (`scripts/publish-verdaccio.sh:168`) runs
  `npm publish --ignore-scripts --tag latest` — **the `--ignore-scripts`
  flag skips prepublishOnly**, so tsc never fires.
* `scripts/build-packages.sh` only builds `v3/@claude-flow/*` packages
  (the `_v3_packages` allowlist + the `publish-levels.json` filter at
  L200-220). Cross-repo packages under `forks/*/npm/packages/*` are
  silently expected to ship pre-built.
* Upstream's npm-published `@ruvector/ruvllm` works because upstream
  ran `npm run build` before publishing. Our copy-source pulls fork
  HEAD which has no `dist/` (it's in `.gitignore`).

The result is a classic **ADR-0082 silent-drop hazard**: the publish
pipeline produces a tarball that LOOKS published correctly (npm publish
exits 0, Verdaccio reports the version, the dist-tag advances) but is
structurally broken at consume-time.

**Today's stopgap** (commit on `forks/ruvector` main, force-added past
`.gitignore`): copied upstream's pre-built `dist/` (72 files) into
`forks/ruvector/npm/packages/ruvllm/dist/`. tsc output is deterministic
for matching source TS, so this is equivalent to building it ourselves.
Codemod renames `@ruvector/` → `@sparkleideas/ruvector-` inside
`dist/*.js` at publish time. Works for *this* package, doesn't scale.

## Decision Drivers

* **ADR-0082 spirit** — fail loud, not silent. A published package
  with a broken `main` is the same hazard ADR-0189's NAPI detector
  addresses for missing `.node` binaries.
* **ADR-0150 generalisation** — NAPI packages already have a
  uniform "must declare in `NAPI_PACKAGES`" contract enforced by
  `check-napi-coverage.mjs`. Cross-repo TS packages lack the
  equivalent.
* **Forks are upstream-tracking** — committing build artifacts to
  `forks/ruvector/main` couples our fork chain to build-time state.
  Upstream sync wave conflicts will hit `dist/` files first. Not
  ideal long-term.
* **`--ignore-scripts` is load-bearing** — `prepublishOnly`,
  `preinstall`, and friends can run arbitrary shell on the publishing
  host. Dropping `--ignore-scripts` reintroduces a supply-chain
  attack surface that the current flag exists to close.
* **Verdaccio is local-only** — the publish target is
  `http://localhost:4873`, so the supply-chain risk from
  `--ignore-scripts` is bounded. Public-npm consumers never see our
  per-package scripts because Verdaccio is the registry.
* **One-off vs systemic** — `ruvllm` is one package. The cli also
  references `@ruvector/core`, `@ruvector/graph-node`, and the
  general @ruvector/* surface. A solution that fixes just `ruvllm`
  leaves the rest landmined.

## Considered Options

1. **Per-package pre-built dist/ contract** (today's stopgap,
   generalised). Codify: every cross-repo TS package MUST ship a
   pre-built `dist/` in its source tree on `forks/*/main`. Enforce
   via a new `scripts/check-cross-repo-builds.mjs` (mirroring
   `check-napi-coverage.mjs`'s pattern) that flags any
   `forks/*/npm/packages/*/package.json` whose `main`/`exports`
   reference a path not present in the source tree. Wired into
   publish pre-flight; fails the release if a package's main is
   broken.

   *Tradeoff:* keeps `--ignore-scripts`, no new build infrastructure.
   Couples fork main to build artifacts; upstream sync waves will
   conflict on `dist/` content for every TS change. Manual rebuild
   step needed per upstream-source change.

2. **Extend `build-packages.sh` to build cross-repo TS packages**.
   Generalise the v3-package build loop to also discover and build
   `forks/*/npm/packages/*/package.json` entries with `scripts.build`
   that include `tsc`. Pipeline runs `npm install && npm run build`
   inside each cross-repo TS package's source dir (in
   `/tmp/ruflo-build`) before publish-verdaccio fires.

   *Tradeoff:* keeps fork main clean (no committed dist/). Adds
   meaningful pipeline complexity — needs `npm install` per package
   (cache strategy matters), needs dependency-order resolution if
   packages depend on each other, needs to handle `napi build` cases
   that mix Rust + TS. Slows `npm run release` by N × tsc time.

3. **Drop `--ignore-scripts` for cross-repo packages**. Modify
   `publish-verdaccio.sh` to omit `--ignore-scripts` when publishing
   from a `forks/*/npm/packages/*/` directory; keep it for everything
   else. `prepublishOnly` would then fire its tsc.

   *Tradeoff:* trusts upstream's package.json scripts. Verdaccio
   target makes this lower-risk than a public npm publish, but any
   upstream sync could quietly add a `prepublishOnly` that runs
   arbitrary shell during our release. Requires
   `feedback-trace-before-hypothesis`-grade review of upstream
   `prepublishOnly` content on every sync wave.

4. **Hybrid**: a build step (Option 2) + a coverage check
   (Option 1's detector). Pipeline builds where it can; the detector
   surfaces packages that slipped through (e.g. new upstream package
   with a different build shape). Fail loud either way.

## Decision Outcome

**Deferred — open question.** This ADR documents the gap and the
trade-off space; the decision belongs with whoever evaluates the
maintenance cost of each option against the project's expected sync
cadence.

Recommended-but-not-binding starting point: **Option 1 (pre-built
dist/ contract)** for the next 30 days. It matches today's stopgap,
adds the detector to make the contract enforceable, and keeps the
`--ignore-scripts` security stance. If upstream sync waves prove
painful (dist/ conflicts on every release), pivot to **Option 4**
(hybrid) — by then we'll know which packages need the build step and
which can stay pre-built.

The detector implementation can be ~150 LOC modeled after
`check-napi-coverage.mjs` (ADR-0189):

```javascript
// scripts/check-cross-repo-builds.mjs (sketch)
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

for (const fork of FORKS) {
  for (const pkgJsonPath of globPackageJsons(`forks/${fork}/npm/packages/*/package.json`)) {
    const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
    if (!pkg.main) continue;
    const pkgDir = dirname(pkgJsonPath);
    const mainPath = join(pkgDir, pkg.main);
    if (!existsSync(mainPath)) {
      console.error(`[CROSS-REPO-BUILD] ${pkgJsonPath}: main → ${pkg.main} (missing)`);
      missing.push(pkgJsonPath);
    }
    // Also walk `exports` and any other entry points referenced.
  }
}
// + same allowlist + run-from-pre-flight pattern as check-napi-coverage.mjs
```

### Consequences

* Neutral, because under Option 1 (pre-built dist + detector) every cross-repo TS package change requires a fork-main commit with refreshed `dist/` (cost: one extra `tsc` + commit per change); the detector catches new upstream packages that ship with `dist/` in `.gitignore` but `main` pointing at it (the exact ruvllm shape); and `forks/*/main` history accumulates build artifacts so merges with upstream become noisier.
* Neutral, because under Option 2 (pipeline build) fork main stays clean, but `npm run release` adds ~N × tsc time per cross-repo TS package (typically 30-180s each) and needs new build infrastructure: cross-repo `npm install` cache, build-order graph, `napi build` path handling.
* Neutral, because Option 3 (drop --ignore-scripts for cross-repo) needs zero new infrastructure (lowest implementation cost) but carries the highest ongoing review cost: every upstream sync needs a `prepublishOnly` audit per package, and if upstream adds an exfiltration script the release runs it.
* Neutral, because Option 4 (hybrid) combines Option 1's enforcement with Option 2's build-where-possible at the highest implementation cost but the clearest end-state.

This ADR closes when one option is implemented and the detector (or
build step) is wired into `scripts/ruflo-publish.sh`.

## More Information

Original status: accepted 2026-05-28, implemented 2026-05-28, completed. Original frontmatter recorded `methodology: [MADR]`, `decision-makers: [Henrik Pettersen]`, `audience: ai-executor`, and `related: [0038, 0082, 0150, 0189]`.

Status note (2026-05-28): Option 1 (recommended starting point) implemented. `scripts/check-cross-repo-builds.mjs` walks every `forks/*/npm/packages/*/package.json`, validates that `main`/`module`/`types`/`exports` entries exist as files in the source tree. Per-platform NAPI sub-packages (covered by ADR-0189's NAPI coverage gate) are excluded by substring allowlist. Wired into `scripts/ruflo-publish.sh` as `cross-repo-builds-advisory` (advisory-first per the ADR-0209/0242 pattern; `CROSS_REPO_BUILDS_ADVISORY=1` makes the script exit 0 while logging the count + first 10 violators).

Detector scoped to the publish set (2026-05-28 swarm verification). The first-pass "162 violations, each a ship-time hazard, remediate per-package" framing was WRONG on the load-bearing word *hazard*. A violation only ships a broken package if the package is actually PUBLISHED. The pipeline publishes exactly the names in `config/publish-levels.json` (enforced by `publish.mjs`'s `_publishableNamesSet`). Of the original 162: **161 were in never-published packages** (29 dev/example packages with no publish path — building dist/ for them remediates nothing — plus NAPI false-positives). The detector now (a) maps each source name through the codemod (`applyNameMapping`, exported from `codemod.mjs` — single source of truth) and skips names absent from the publish set, and (b) exempts NAPI parent wrappers (`napi` field / `napi build` script — their `index.js`/`.d.ts` are generated, e.g. `sona`). Scoped result: **7 published packages checked, 1 real hazard** — `@sparkleideas/ruvector` (root meta-pkg: `main: dist/index.js`, empty dist in tarball). The origin case (`ruvllm`) is already fixed.

The 1 remaining hazard needs a decision (NOT auto-made — it's a publish-set change): either (a) git-track `forks/ruvector/npm/packages/ruvector/dist/` (the `ruvllm` stopgap pattern), or (b) drop `@sparkleideas/ruvector` from `publish-levels.json` — the swarm verified **nothing in the publish set depends on it** (it's a standalone meta/CLI pkg), so (b) removes a broken tarball at low cost, but stops `npm i @sparkleideas/ruvector` from resolving for any direct consumer. Stays advisory (`CROSS_REPO_BUILDS_ADVISORY=1`, exit 0) until the 1 hazard is resolved; **promotable to fail-loud the moment it is** (non-advisory exit is 1 today on exactly that 1 package, 0 after).
