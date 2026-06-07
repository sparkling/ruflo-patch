---
status: accepted
date: 2026-06-06
tags: [pipeline, publish, npm, ruvector, native, lint]
supersedes: []
depends-on: [ADR-0071, ADR-0236, ADR-0294]
implements: []
---

# Strip unresolvable @sparkleideas/* optional deps before publish

## Context and Problem Statement

On 2026-06-06 `npx -y @sparkleideas/ruflo@latest mcp start` began failing in
consumer projects with:

```
npm error Invalid Version:
  at new SemVer (.../semver/classes/semver.js:40:13)
  at Node.canDedupe (.../@npmcli/arborist/lib/node.js:1138:32)
  at PlaceDep.pruneDedupable (.../@npmcli/arborist/lib/place-dep.js:426:14)
```

Claude Code surfaced it as `Failed to reconnect to ruflo: -32000` — the MCP
server never started because its `npx` install aborted.

### Root cause (two layers)

**Latent defect.** The codemod rewrites `@ruvector/*` → `@sparkleideas/ruvector-*`
in every dependency field ([[ADR-0054]]), including:

1. napi **platform sub-packages** (`ruvector-attention-darwin-arm64`,
   `…-win32-x64-msvc`, and the same block for `router`, `ruvllm`, `gnn`,
   `graph-transformer`). [[ADR-0071]] deliberately **eliminated** these — it
   bundles the darwin-arm64 `.node` into the parent tarball instead of
   publishing ~80 platform packages. But the rewrite left the now-dangling
   `optionalDependencies` block in every napi wrapper's manifest.
2. **pure sub-packages** we do not publish (`ruvector-rvf-solver`,
   `ruvector-rvf-wasm`, `ruvector-diskann`).

All of these `@sparkleideas/*` names **404** — they were never published under
our scope (Verdaccio's `@sparkleideas/*` rule does not proxy npmjs). A full
graph walk from `@sparkleideas/ruflo@latest` found **38** such dangling
optional refs.

A lone unresolvable **optional** dependency is harmless — npm skips it. The
trap is npm/arborist's `pruneDedupable`: when a *peer* optional resolves, npm
places it, runs the dedup walk, and `canDedupe` calls `semver.eq(other.version,
this.version)` against the **empty-version placeholder** nodes left by the 404'd
platform optionals → `new SemVer('')` throws → the **entire install aborts**.

**Trigger.** [[ADR-0294]] R3 published the `@sparkleideas/ruvector-rabitq-wasm`
"discoverable stub" at 2026-06-04T19:42Z. `@sparkleideas/cli` had referenced
`ruvector-rabitq-wasm@^0.1.0` (optional) since 06-02; once the stub resolved,
that one optional flipped from 404 → 200, npm placed it, and the dedup walk hit
the pre-existing empty-version platform nodes. The release that shipped the
landmine PASSED acceptance hours earlier — because at release time *every* such
optional still 404'd, so nothing triggered the walk.

The crash is install-strategy-specific (the `npx` path triggers it; a plain
project `npm install` builds a tree shape that does not) and cache-state-
dependent, which is why it surfaced intermittently.

## Considered Options

* **Strip unresolvable `@sparkleideas/*` optional deps before publish (chosen).**
  Enforce the invariant "a published manifest must not reference an
  `@sparkleideas/*` package that does not resolve." Strip dangling **optionals**
  (provably zero-runtime-impact — 404 today, and "optional" means tolerated-
  absent); **fail loud** on an unresolvable **hard** dep (a real publish gap).
* **Revert/unpublish the rabitq-wasm stub** — un-breaks install today but only
  re-buries the latent defect; the next optional that resolves re-detonates it.
  Rejected (masks, does not fix).
* **Publish the missing platform/sub packages** — contradicts [[ADR-0071]]
  ([[ADR-0008]]: the ~80 platform packages are a maintenance burden adding no
  value; we build only darwin-arm64 and bundle it). We do not cross-compile
  win32/linux and do not use them. Rejected.
* **Name-pattern strip (only `-{darwin,linux,win32}-*`)** — misses the non-
  platform landmines (`rvf-solver`, `rvf-wasm`, `diskann` are 404 AND multi-site
  via the `ruvector-rvf` wrapper + `agentdb`) and would wrongly strip the
  agentic-flow-quic-native platform packages, which ARE published. Rejected —
  the correct predicate is **resolvability**, not name shape.

## Decision Outcome

A pre-publish pass (`scripts/sanitize-internal-optional-deps.mjs`, phase
`sanitize-optional-deps` in `ruflo-publish.sh`, between `test-ci` and
`publish-verdaccio`) walks the build tree's publishable manifests
(`buildPackageMap`) and, for every `@sparkleideas/*` dependency:

* resolvable ⇔ in this run's publish set **or** the registry returns anything
  other than a definitive 404 (network/5xx → keep, never strip on a blip);
* unresolvable **optionalDependency** → strip (logged);
* unresolvable **dependency** (hard) → fail the release loud (per
  `feedback-no-fallbacks`; none exist today, verified).

A timing-independent regression gate
(`sanitize-internal-optional-deps.mjs check-published @sparkleideas/ruflo@latest`)
runs in acceptance (`lib/acceptance-adr0300-checks.sh`, wired into
`test-acceptance.sh`) and fails on any unresolvable `@sparkleideas/*` ref in the
published graph — catching the dangling ref itself, not whether a trigger
optional is published yet. This is the "is it actually published" half that
[[ADR-0236]]'s cross-registry lint did not cover (that lint checks fork-source
registries against each other, not whether referenced `@sparkleideas/*` deps
resolve).

### Confirmation

- [x] Crash reproduced via `npx -y @sparkleideas/ruflo@latest` (the exact opda
      MCP invocation); root cause confirmed from the arborist stack in the npm
      debug log.
- [x] Sanitizer `check-published` detects all 38 dangling optional refs; `fix`
      strips exactly those, retains every resolvable dep (wrappers, `-wasm`
      packages, all hard deps), and is idempotent (re-run → 0 strips).
- [x] No unresolvable **hard** dep exists in the current graph → the fail-loud
      branch does not block the deploy.
- [ ] Post-deploy: republished `@latest` graph passes the gate, and a clean
      `npx @sparkleideas/ruflo@latest mcp start` boots.

### Consequences

* Good — `npx @sparkleideas/ruflo` installs are robust to which optionals are
  published; the empty-version dedup landmine cannot recur (no dangling node).
* Good — completes [[ADR-0071]]: the eliminated platform packages are no longer
  referenced by the manifests that the bundling step left dangling.
* Good — the gate is timing-independent, closing the "passed acceptance, blew up
  later" gap.
* Neutral — runtime is unchanged: stripped optionals 404'd (never installed);
  the bundled darwin-arm64 `.node` and the published `-wasm` fallbacks are
  untouched.
* Bad — a genuine future publish gap on an **optional** dep is stripped+logged
  rather than failing the release. Mitigation: hard deps fail loud, and
  `check-napi-coverage.mjs` independently gates napi-crate publish coverage.
