---
status: proposed
date: 2026-05-24
tags: [pipeline, publish, lint, codemod, fork-version, scope-registry, audit-followup, ct-c]
supersedes: []
depends-on: [0201, 0231, 0233]
implements: []
---

# Cross-registry scope/package-name lint (CT-C close-out)

## Context

[[ADR-0231]] wave A9 (2026-05-24, eighth amendment) added a fail-loud branch to
`scripts/publish.mjs::buildPackageMap` that throws when two candidate
directories resolve to the same package name without a tie-breaker
(non-private vs. private; subdir vs. non-subdir). That fixed the
*downstream symptom* of the wave-A9 incident — `crates/ruvllm-wasm/pkg`
silently shadowing `npm/packages/ruvllm-wasm` and shipping a stale dist
to Verdaccio.

The *root defect* is unchanged at four sibling sites: the pipeline carries
multiple hand-aligned scope/package-name registries that MUST stay in
lockstep but have no cross-validation pass. The wave-A9 amendment itself
documents the lesson at §"Lessons for the corpus" #2 — "`findPackages`
SCOPES is the publishability allowlist. Unscoped names need
`UNSCOPED_PUBLISHABLE` entry OR (cleaner) scope-rename to match sibling
convention" — but no enforcement mechanism was put in place. The same
class of bug WILL recur the next time someone adds a fork package on the
codemod side and forgets the fork-version side (or vice versa).

[[ADR-0233]] §CT-C (Cross-cutting theme C, "Hardcoded list drift") names
this as the cross-cutting theme to remediate; this ADR is the carve-out
for that theme.

## Pre-flight verification

Per [[ADR-0201]] §"Remediation-ADR pre-flight checklist":

1. **Signal reaches its audience.** The discoverer
   (`scripts/preflight-discover.mjs`) already imports `UNSCOPED_MAP` from
   `codemod.mjs` and surfaces in-scope packages, but does NOT
   cross-validate against `fork-version.mjs::UNSCOPED_PUBLISHABLE` or
   `build-packages.sh::_v3_packages`. The drift signal exists in code but
   is split across three independent discovery passes that never compare
   notes. A lint that runs at pipeline start (before `bump_fork_versions`)
   would reach the pipeline operator before the bad publish.
2. **Upstream hasn't already decided it.** Upstream `ruvnet/*` does not
   maintain a multi-fork codemod or `UNSCOPED_PUBLISHABLE` set — this is
   fork-only infrastructure (`reference-pipeline-publish-paths`). No
   merge-tax risk.
3. **Premise true at runtime.** Verified 2026-05-24:
   - `scripts/fork-version.mjs:45` declares `SCOPES = ['@sparkleideas/',
     '@claude-flow/', '@ruvector/']`.
   - `scripts/fork-version.mjs:49-58` declares
     `UNSCOPED_PUBLISHABLE` with exactly 8 entries: `agentdb`,
     `agentic-flow`, `claude-flow`, `ruv-swarm`, `ruvector`,
     `agent-booster`, `agentdb-onnx`, `cuda-wasm`.
   - `scripts/codemod.mjs:38-68` declares `UNSCOPED_MAP` with 17 entries
     including `agentic-jujutsu` (line 53), `ruflo` (line 40),
     `ruvllm-wasm` (line 67), and six `ruvector-*` platform/wasm
     binaries. **`agentic-jujutsu` IS in `UNSCOPED_MAP` and IS NOT in
     `UNSCOPED_PUBLISHABLE`** — confirmed the audit's observable-drift
     claim. The fork has a real publishable package at
     `/Users/henrik/source/forks/agentic-flow/packages/agentic-jujutsu/
     package.json`, so fork-version is silently skipping its
     `-patch.N` bookkeeping today.
   - `scripts/build-packages.sh:187-191` declares the `_v3_packages`
     associative array literal with 22 short-name entries.
   - `scripts/preflight-discover.mjs:188-194` declares `isInScope`
     importing `UNSCOPED_MAP` (line 41).
   - `scripts/codemod-symlink-workspace.mjs:71` declares
     `EXTRA_WORKSPACE_DIRS = ['cross-repo/agentdb']` (F-02-004 — a
     hand-maintained singleton of the same class).
4. **No sibling-ADR overlap.** The wave-A9 buildPackageMap fail-loud
   covers ONLY publish.mjs's directory-resolution step; it does not
   look at fork-version, codemod, build-packages, preflight-discover,
   or codemod-symlink. No sibling ADR proposes a cross-registry
   reconciliation step. ADR-0215's codemod golden-master catches
   codemod-output drift but not codemod-vs-fork-version drift.

## Considered options

### A. Pipeline-start cross-registry pairwise lint (warn or fail)

A new script `scripts/lint-scope-registries.mjs` runs at `ruflo-publish.sh`
gate-1 (before `bump_fork_versions`). It reads:

* `SCOPES` + `UNSCOPED_PUBLISHABLE` from `fork-version.mjs` (already exported, or add a named export).
* `UNSCOPED_MAP` from `codemod.mjs` (already exported as of preflight-discover wiring).
* The v3 short-name set from `build-packages.sh` (currently bash literal — would need to be moved to a `config/build-groups.json` or extracted via a parser pass).
* `isInScope` from `preflight-discover.mjs` (the predicate, not the data).
* `EXTRA_WORKSPACE_DIRS` from `codemod-symlink-workspace.mjs`.

Then asserts pairwise:

* Every key in `UNSCOPED_MAP` that maps to a `@sparkleideas/*` target whose source has a `package.json` in any `FORK_DIR` (excluding the wrapper at `ruflo-patch`) MUST be in `fork-version.mjs::UNSCOPED_PUBLISHABLE`. (Catches today's `agentic-jujutsu` drift.)
* Every entry in `fork-version.mjs::UNSCOPED_PUBLISHABLE` MUST have a corresponding `UNSCOPED_MAP` entry. (Catches reverse drift.)
* Every fork-side `package.json` whose `name` field is unscoped and resolves via `UNSCOPED_MAP` to a `@sparkleideas/*` target MUST be discoverable by `fork-version.mjs::findPackages` (i.e. is in `UNSCOPED_PUBLISHABLE`).
* Every short-name in `build-packages.sh::_v3_packages` MUST appear in `config/publish-levels.json` (catches v3-set drift).
* Every `cross-repo/<dir>` mentioned in `EXTRA_WORKSPACE_DIRS` MUST resolve to a fork-source directory at codemod time.

On mismatch: throw with both registries cited (same fail-loud shape as
wave-A9 `buildPackageMap`).

**Pros:**

* Minimal code change — one new script + one gate invocation in
  `ruflo-publish.sh`. No existing data structures move.
* Reuses the existing exports (`UNSCOPED_MAP`) and adds two new exports
  (`SCOPES`, `UNSCOPED_PUBLISHABLE`). No semantic rewrite.
* Catches drift BEFORE any fork bump, BEFORE any codemod pass, BEFORE
  any npm publish. Operator sees the error in <1s of pipeline-start.
* Fits the project's stated preference (`feedback-no-fallbacks`) — the
  lint is a hard gate, not a "consider these warnings" surface.
* Lowest-risk introduction: a pure read-only lint can ship without
  touching any other invariant.

**Cons:**

* Doesn't fix the underlying duplication — five registries still exist,
  someone still has to update all of them on a new fork package.
* `build-packages.sh::_v3_packages` is bash-side; the lint would either
  need a bash parser or the v3 set would have to be moved to JSON
  (touches B/C territory).

### B. Single source-of-truth — one JSON file in `config/`, all sites read from it

Add `config/scope-registry.json`:

```json
{
  "scopes": ["@sparkleideas/", "@claude-flow/", "@ruvector/"],
  "scope_rewrites": {
    "@claude-flow/": "@sparkleideas/",
    "@ruvector/": "@sparkleideas/ruvector-"
  },
  "unscoped_publishable": [
    { "source": "agentdb", "target": "@sparkleideas/agentdb", "fork_dir": "agentdb" },
    { "source": "agentic-jujutsu", "target": "@sparkleideas/agentic-jujutsu", "fork_dir": "agentic-flow/packages/agentic-jujutsu" },
    { "source": "ruvllm-wasm", "target": "@sparkleideas/ruvector-ruvllm-wasm", "fork_dir": "ruvector/npm/packages/ruvllm-wasm" },
    // ... 14 more
  ],
  "v3_packages": [/* 22 entries */],
  "extra_workspace_dirs": ["cross-repo/agentdb"]
}
```

* `fork-version.mjs` loads it, derives `SCOPES` + `UNSCOPED_PUBLISHABLE`.
* `codemod.mjs` loads it, derives `UNSCOPED_MAP` + `RUVECTOR_PREFIX_FROM/TO`.
* `build-packages.sh` reads it via `jq` for `_v3_packages`.
* `preflight-discover.mjs` continues to import `UNSCOPED_MAP` from
  `codemod.mjs` (re-exported from JSON internally).
* `codemod-symlink-workspace.mjs` loads `extra_workspace_dirs` from JSON.

**Pros:**

* Eliminates the entire defect class — drift is structurally
  impossible after the migration.
* Single review surface: future maintainers add an entry to ONE file,
  not five.
* Composes well with [[ADR-0233]] CT-B (codemod golden-master) and the
  existing `config/publish-levels.json` discipline.

**Cons:**

* 5-site migration is a real refactor. Each site has existing
  comments, ADR provenance, and inline-validation that must be
  preserved or migrated.
* `RUVECTOR_PREFIX_FROM/TO` is a *transformation* (regex prefix
  rewrite), not a per-name lookup; encoding it in JSON makes
  `codemod.mjs` more indirect.
* The JSON file becomes a single-point-of-failure: a typo breaks
  every consumer at once (mitigated by JSON schema validation, but
  the schema is itself a new artifact).
* Test surface: every site that reads the JSON needs a "JSON missing
  → fail loud" branch (same as `publish.mjs::loadLevels`); the cost
  multiplies vs. option A's single lint script.

### C. Generator pattern — one file `lib/scope-config.sh` declares all, others source/import

Generate `lib/scope-config.sh` (bash-sourceable) + `lib/scope-config.mjs`
(ESM-importable) from a single declarative `scripts/scope-config.mjs`
master. Each consumer sources/imports its language-appropriate variant.

**Pros:**

* Bridges bash + JS without forcing JSON parsing in bash.
* Generator pattern matches what `lib/fork-paths.sh` already does.

**Cons:**

* Two output formats to keep in sync — same defect class moved one
  layer deeper.
* Master-file edit ⇒ regenerate-twice ⇒ commit-thrice; release-time
  forgetting-to-regenerate is the new ADR-0231-class bug.
* Strictly worse than B for the JS sites (still parsing a bash file
  conceptually).

### D. Status quo + improved fail-loud in more places

Add fail-loud branches at the remaining four sites, each on first
operation against an unknown name. No cross-registry validation.

**Pros:**

* Zero new infrastructure; matches the wave-A9 idiom exactly (catch at
  point of use).

**Cons:**

* Doesn't catch the drift until the bad operation; today's drift
  (`agentic-jujutsu` missing from `UNSCOPED_PUBLISHABLE`) wouldn't
  fire until someone tried to publish a `-patch.N` bump for it.
* Five-site fail-loud is five reviews, five test surfaces, five
  failure modes. Operator sees a different error message per drift.
* Does not address the "find drift before publishing" use case the
  wave-A9 amendment specifically called out as the next thing needed.

## Decision

Adopt **option A — pipeline-start cross-registry pairwise lint** as the
immediate close-out for CT-C.

Defer option B (single source-of-truth JSON) as a follow-up if the lint
proves to fire frequently in practice (signal: more than 2 drift
incidents caught in a 90-day window). Option C is rejected — it's
strictly worse than B for JS sites and the same shape as D for bash.
Option D is rejected — wave-A9 already established that fail-loud at
point-of-use is reactive, not preventive, for this defect class.

The lint is a pre-publish gate (not a warning), implementing the
`feedback-no-fallbacks` principle: "tests must FAIL when features are
broken, not pass via catch/fallback branches."

### Concrete steps (informational, not normative — the implementing ADR carries the binding plan)

1. Export `SCOPES` + `UNSCOPED_PUBLISHABLE` from `scripts/fork-version.mjs` (named exports; preserve internal usage).
2. Create `scripts/lint-scope-registries.mjs` performing the five pairwise checks above.
3. Add gate-0 (pre-`bump_fork_versions`) call in `scripts/ruflo-publish.sh`. Fail-loud on any mismatch with both registry citations.
4. Add unit test `tests/pipeline/lint-scope-registries.test.mjs` that asserts current state passes EXCEPT for the today-known `agentic-jujutsu` drift (proves the lint catches it). The fix for that single drift entry — adding `agentic-jujutsu` to `UNSCOPED_PUBLISHABLE` — lands in the same commit so the test passes after the fix.
5. Document the lint in `[[reference-pipeline-publish-paths]]` and in `lib/pipeline-helpers.sh` head comment.

The `build-packages.sh::_v3_packages` literal stays as bash for the
initial cut; the lint reads it via the same `jq`/`node -e` pattern
`build-packages.sh:197-215` already uses to filter
`publish-levels.json`. If extracting `_v3_packages` to JSON proves
cheap, that lands as a separate non-blocking PR.

`codemod-symlink-workspace.mjs::EXTRA_WORKSPACE_DIRS` gets a check
that every entry resolves to a real directory at lint time (the only
constraint currently is "the value is a path string").

## Consequences

### Positive

* Closes the wave-A9 defect class — adding a fork package to one
  registry without the other is caught at pipeline-start in <1s.
* The today-known `agentic-jujutsu` drift gets a single-commit fix
  with regression coverage.
* Establishes a pattern for future cross-cutting registry lints
  (CT-A silent fallbacks, CT-B wrapper-bundled drift, CT-H schema
  vs. handler) — the same "pairwise pre-publish lint" idiom can be
  reused.
* Honors `feedback-commit-forks-before-release` indirectly: lint runs
  before fork-version-bump, so a fork pkg.json edit that didn't make
  it into the registry surfaces before the bad bump.

### Negative

* Adds one more pipeline stage that can fail; legitimate-but-new fork
  packages now require two coordinated edits (`UNSCOPED_MAP` AND
  `UNSCOPED_PUBLISHABLE`) instead of being silently picked up by
  whichever discoverer happens to walk it. (Counter-argument: the
  silent-skip behaviour is precisely the defect this ADR addresses.)
* Bash-side `_v3_packages` parsing relies on `node -e` extraction;
  if the bash literal format changes, the lint becomes fragile. (Mitigation:
  the lint's own test asserts the format; if it changes, the test fails
  loud, not the production pipeline.)
* Doesn't eliminate the duplication; future audits may re-flag the
  same five-site shape as a code-smell. (Defended: option B remains
  on the table if the lint proves drift is frequent.)

### Neutral

* The lint runs at pipeline start, costing <1s. No measurable release
  time impact.
* Reuses existing module-export discipline; no new file format or
  toolchain.
* The `EXTRA_WORKSPACE_DIRS` directory-existence check is a separate
  invariant from the name-registry checks; the lint script will have
  two phases (name registries, then path registries) even though they
  ship in the same gate.

## Sites table

| # | Path | Symbol | Type | Today's content |
|---|------|--------|------|---|
| 1 | `scripts/fork-version.mjs:45` | `SCOPES` | array | 3 entries |
| 1 | `scripts/fork-version.mjs:49-58` | `UNSCOPED_PUBLISHABLE` | Set | 8 entries |
| 2 | `scripts/codemod.mjs:38-68` | `UNSCOPED_MAP` | object | 17 entries — `agentic-jujutsu` line 53, drift vs site 1 |
| 3 | `scripts/build-packages.sh:187-191` | `_v3_packages` | bash assoc array | 22 entries |
| 4 | `scripts/preflight-discover.mjs:188-194` | `isInScope` | predicate | Imports `UNSCOPED_MAP` from site 2 |
| 5 | `scripts/codemod-symlink-workspace.mjs:71` | `EXTRA_WORKSPACE_DIRS` | array | 1 entry (`cross-repo/agentdb`) (F-02-004) |

The lint asserts pairwise:

* `UNSCOPED_MAP` ∩ (fork-source-package-names) ⊆ `UNSCOPED_PUBLISHABLE` (catches today's `agentic-jujutsu` drift).
* `UNSCOPED_PUBLISHABLE` ⊆ `UNSCOPED_MAP` (reverse drift).
* Every fork-side unscoped `package.json` whose name resolves via `UNSCOPED_MAP` is in `UNSCOPED_PUBLISHABLE`.
* `_v3_packages` ⊆ `config/publish-levels.json` v3-package set.
* Every `EXTRA_WORKSPACE_DIRS` entry resolves to a real directory at lint time.

## More information

* [[ADR-0201]] §"Remediation-ADR pre-flight checklist" — the four checks applied above.
* [[ADR-0231]] §"Amendment — 2026-05-24 (eighth — wave A9 close-out)" — defect-class origin (defect 1 + defect 2). The wave-A9 lessons list this ADR as the systematic follow-up (lesson #2).
* [[ADR-0233]] §CT-C — the cross-cutting theme this ADR closes out.
* `docs/audits/2026-05-24-second-pass-audit/02-build-pipeline-soundness.md` §F-02-001 (CRITICAL) — the audit finding with the four-site enumeration and `agentic-jujutsu` evidence. Also §F-02-004 (`EXTRA_WORKSPACE_DIRS` singleton, same shape).
* [[reference-pipeline-publish-paths]] — operator-facing reference to update once the lint lands.
* `feedback-no-fallbacks` — corpus-level rule the lint enforces.
* `feedback-remediation-adr-preflight` — the checklist itself.
* [[ADR-0215]] — codemod golden-master, the analogous test-gate for codemod output drift.
* [[ADR-0095]] §amendment 2026-05-23 — sibling ADR that removed the pure-TS fallback; same "fail-loud over silent fallback" idiom.
