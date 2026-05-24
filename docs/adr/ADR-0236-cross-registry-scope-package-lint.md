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

## Swarm review (2026-05-24)

**Status**: proposed (post-swarm-review)
**Swarm**: 4 experts + devil's advocate, Weighted consensus (queen vote ×3 per `byzantine.ts` weighted scheme; denominator `(N-1)+3 = 6`; queen-led — pipeline owner authority), hierarchical topology, tactical queen, queen-composed transport
**Triage rank**: 8 (per [[ADR-0233]] §Decision; wave 3 of 5)

### Panel composition

* Expert 1 — Pipeline-script specialist (5 registries inventory)
* Expert 2 — ADR-0231 wave-A9 archeologist
* Expert 3 — Lint-DX specialist
* Expert 4 — Single-source-of-truth advocate
* Devil's Advocate — "Lint is theatre — single-source is the only real fix"; "Pipeline-start gate-0 will reject mid-release; need a softer warn-only first cycle"

### Upstream intent

**Confirmed zero merge tax.** `ls /Users/henrik/source/ruvnet/ruflo/scripts/` returns 13 audit/install/witness scripts (`audit-cli-mcp-tools.mjs`, `cleanup-v3.sh`, `install.sh`, `inventory-capabilities.mjs`, `sign-witness-from-inventory.mjs`, etc.). **None publish/fork-version/codemod/build-package equivalents.** `ls /Users/henrik/source/ruvnet/ruflo/lib/` returns "No such file or directory" — upstream has no `lib/` tree at all. The 5 registry sites this ADR targets (`fork-version.mjs::SCOPES`+`UNSCOPED_PUBLISHABLE`, `codemod.mjs::UNSCOPED_MAP`, `build-packages.sh::_v3_packages`, `preflight-discover.mjs::isInScope`, `codemod-symlink-workspace.mjs::EXTRA_WORKSPACE_DIRS`) are wholly fork-only infrastructure per `[[reference-pipeline-publish-paths]]`. Pre-flight #2 ("upstream hasn't already decided it") clears unambiguously — no merge-tax shape; the lint script + 5 registry edits never see upstream.

### Live-drift verification

`grep -n "agentic-jujutsu" scripts/fork-version.mjs scripts/codemod.mjs` confirms the audit claim:
* `scripts/codemod.mjs:53` — `'agentic-jujutsu': '@sparkleideas/agentic-jujutsu'` (present in `UNSCOPED_MAP`).
* `scripts/fork-version.mjs:49-58` — `UNSCOPED_PUBLISHABLE = new Set([...])` — 8 entries, NONE is `agentic-jujutsu` (`agentdb`, `agentic-flow`, `claude-flow`, `ruv-swarm`, `ruvector`, `agent-booster`, `agentdb-onnx`, `cuda-wasm`).
* `forks/agentic-flow/packages/agentic-jujutsu/package.json` exists — `"name": "agentic-jujutsu"`, `"version": "2.3.6"`, real publishable package.

Conclusion: `agentic-jujutsu` is the today-live drift the ADR cites. fork-version's bumpAll silently no-ops the `-patch.N` bookkeeping for it because `findPackages` walks past the unscoped name (matches no `SCOPES.startsWith` AND not in `UNSCOPED_PUBLISHABLE`). Same exact shape as ADR-0231 wave-A9 defect 1 (`UNSCOPED_PUBLISHABLE` missed `ruvllm-wasm`), one fork-package down the road.

### ADR-180+ intent

* **[[ADR-0231]] wave A9** — defect-class origin. The eighth amendment (2026-05-24) fixed `publish.mjs::buildPackageMap` with the fail-loud-on-duplicate-name idiom; "Lessons for the corpus" #2 names this ADR's exact remit ("`findPackages` SCOPES is the publishability allowlist. Unscoped names need `UNSCOPED_PUBLISHABLE` entry OR (cleaner) scope-rename to match sibling convention") but no enforcement gate was added. ADR-0236 is the systematic follow-up that turns the lesson into a release gate.
* **[[ADR-0215]]** — codemod golden-master as model for the lint-as-gate approach. Same shape: cheap read-only check at pipeline start, fail-loud on drift, no `UPDATE_GOLDEN`-style operator-accept path.
* **[[ADR-0245]] (CT-L sibling)** — adjacent pipeline-lint ADR on the same audit slice. CT-L's R3 refinement (`lib/fork-paths.mjs` node-importable single-source for path defaults) is the same "single source of truth at pipeline-script level" pattern. The two ADRs compose: CT-C covers name-registry drift, CT-L covers path-default drift; both ship lints that gate the same `ruflo-publish.sh` entrypoint.
* **[[ADR-0193]] (autopilot completion)** — kinship via `feedback-no-fallbacks`: the lint is a hard gate (no fallback), not a "consider these warnings" surface.
* **[[ADR-0210]] (stub-honesty mandate)** — not in conflict; ADR-0236 is a real pipeline gate, not a wire-or-remove surface decision.
* **[[ADR-0201]] §Remediation-ADR pre-flight checklist** — all four checks pass per §"Pre-flight verification" above.

### Critique outcomes

| Expert | Critique | Vote | Adopted? |
|---|---|---|---|
| E1 (Pipeline-script) | Sites table row 3 (`build-packages.sh::_v3_packages`) lists 22 entries from the bash literal at `:187-191`. The inline JS filter at `:200-205` ALSO declares its own v3 set, redundantly. Both must be the same set; today (verified) they match, but the lint should assert pairwise equality between bash literal AND inline JS filter (intra-file drift, not just cross-file). | amend | **ADOPTED** — append intra-file check #6 to the Sites-table pairwise list: "`build-packages.sh::_v3_packages` bash literal MUST equal the inline JS `v3set` at `:200-205`". Cheap (one extra parse pass), closes the same-file drift class. |
| E1 (Pipeline-script) | Step 3 ("add gate-0 call in `ruflo-publish.sh`") doesn't specify WHERE in the script. The script has phase markers (Phase 0, 1, 2…); the lint must run BEFORE `bump_fork_versions` (Phase 1) and BEFORE any codemod pass. Suggest an explicit "Phase 0.5" or "Phase 0" subsection so the placement is unambiguous. | amend | **ADOPTED** — step 3 now reads "add gate-0 call as the FIRST executable line after `set -euo pipefail` + `lib/*` sourcing in `ruflo-publish.sh`, before Phase 0 (the existing `verify_fork_branches` step)". Fail-fast: drift caught before any pipeline state change. |
| E2 (Wave-A9 archeologist) | The wave-A9 amendment's "Lessons for the corpus" #2 explicitly leaves the trade-off open between "lint" and "scope-rename to match sibling convention". This ADR picks lint; it should explicitly acknowledge the scope-rename alternative was considered. The unscoped names (`ruflo`, `agentic-jujutsu`, `ruvllm-wasm`, 6 platform binaries) exist because the upstream tooling (napi-rs, wasm-pack) generates unscoped names — rename-at-source would require fork-side hand-edit of generated files on every regeneration. Lint is the right call but the rationale should be in the ADR. | amend | **ADOPTED** — append note to Decision §"Option A" rationale: "scope-rename-at-source (the wave-A9 lesson #2 alternative) was considered but rejected because 6 of the 11 drift-prone unscoped names (`ruvector-core-*-{darwin,linux,win32}-*`, `ruvector-attention-{wasm,unified-wasm}`, `ruvllm-wasm`) come from `napi-rs`/`wasm-pack` generated package.json files; renaming at source would require hand-editing or post-processing every wasm-pack rebuild. Lint catches the drift without touching the generator output." |
| E2 (Wave-A9 archeologist) | The ADR's "Concrete steps" #4 says the test asserts current state passes EXCEPT for the `agentic-jujutsu` drift. The fix lands in the same commit. But the test commit-order matters: if the test ships first (RED) and the fix ships next (GREEN), that's TDD. If both in one commit, intent is lost. Prefer 2-commit sequence: (a) test added, fails red on the live drift; (b) fix added (`agentic-jujutsu` entry in `UNSCOPED_PUBLISHABLE`), test passes green. | amend | **ADOPTED** — step 4 amended to require 2-commit sequence: commit-1 lands the lint script + test asserting current-state drift (RED on `agentic-jujutsu` miss), commit-2 lands the `UNSCOPED_PUBLISHABLE` fix making it GREEN. TDD discipline; ALSO surfaces the drift in git history so future audits can grep for the fix. |
| E3 (Lint-DX) | Gate-0 fail-loud is the right shape, but the error message format matters. Today, `publish.mjs::buildPackageMap`'s fail-loud cites BOTH paths (per ADR-0231 wave-A9 §"Fix" bullet 3). The lint should match: every mismatch cites the offending registry (file:line) AND the registry it should agree with (file:line) AND the corpus rule (`feedback-no-fallbacks` + the wave-A9 lesson #2 quoted). A developer hitting the gate at release time should be able to fix it from the error message alone, without re-reading the ADR. | amend | **ADOPTED** — append to step 2 the error-message contract: "Every fail-loud message MUST cite (a) the offending registry's file:line + symbol, (b) the registry it should agree with (file:line + symbol), (c) the suggested fix (either 'add to UNSCOPED_PUBLISHABLE' or 'remove from UNSCOPED_MAP'), (d) the corpus rule citation (`feedback-no-fallbacks` + ADR-0231 wave-A9 §Lesson #2)." Lint failure is self-resolving from the message. |
| E4 (Single-source advocate) | Option B (single source-of-truth JSON) is technically correct but the ADR's deferral to "if drift fires >2 times in 90 days" is too lenient. The drift has ALREADY fired twice in the recorded corpus history: ADR-0231 wave-A9 defect 1 (`ruvllm-wasm` miss) and today's live drift (`agentic-jujutsu` miss). The threshold is already met TODAY. Should commit Option B as a near-term follow-up (next release cycle or two), not a hypothetical future. | amend | **ADOPTED (with queen scope-control)** — append to Decision §"Defer option B" a fixed re-evaluation trigger: "Option B re-evaluation is scheduled for the NEXT remediation pass (CT-C round 2), not the 90-day window. The two recorded drift instances (wave A9 + today's `agentic-jujutsu`) meet the implicit threshold. Option A ships first to close the immediate hole; Option B follows as a documented next-step ADR, NOT a hypothetical." Queen authority (Weighted-vote pipeline-owner) commits to follow-up cadence without forcing a single-commit big-bang. |
| DA (hook 1) | "Lint is theatre — single-source is the only real fix." Lint adds infrastructure without removing duplication; the 5 registries persist, and the lint becomes the 6th place to update on every new fork package. The cure adds to the disease. | amend | **REJECTED (with the partial concession to E4 above)** — lint is the FIRST step, not the only step. The ADR explicitly defers Option B as the structural follow-up; queen's amendment to E4 commits the next-pass schedule. Per `feedback-no-fallbacks`, the lint is a hard gate — once it catches the today-live `agentic-jujutsu` drift and produces a self-resolving error message, the operator burden is bounded. The "lint becomes the 6th place to update" framing collapses under the structural follow-up commitment: by the time the next pkg lands, Option B's single-source JSON should be the only edit site. Hook 1 was the strongest argument in the panel, but the partial concession to E4 disarms it. |
| DA (hook 2) | "Pipeline-start gate-0 will reject mid-release; need a softer warn-only first cycle to surface false-positives before fail-loud." A hard gate at gate-0 on a previously-untested invariant risks blocking a green release on day-1 for a drift the lint hadn't catalogued correctly. Suggest 1-cycle warn-only soak. | amend | **REJECTED** — the lint's logic is read-only enumeration with pairwise set-comparison; no I/O hazards, no flakiness shape. The today-live `agentic-jujutsu` drift IS the only failure expected on day-1, and the fix-commit ships in the same PR (per E2 critique adoption). False-positive risk is structurally low. Per `feedback-no-fallbacks`, soft-warn-then-fail is the precise anti-pattern the ADR rejects (`publish.mjs::buildPackageMap` ALSO shipped as hard-fail on day-one without a warn-soak — wave A9 amendment §Fix). One additional safety: per step 4's TDD discipline, the lint script + test ship in commit-1 BEFORE the fix in commit-2 — so the lint is functionally verified against real drift before the gate-0 wiring lands in the publish path. |

### Devil's Advocate final position

**WITHDRAWS** principled dissent on hook 2 (gate-0 softness) — accepts that the lint's read-only nature + the 2-commit TDD sequence (E2 adoption) provide adequate day-1 safety without a warn-only soak. **HOLDS** principled dissent on hook 1 (lint-is-theatre) but acknowledges the queen's commitment to schedule Option B as the next-pass remediation (E4 adoption) materially weakens the "infrastructure-without-removal" framing. DA explicitly notes: if the 90-day window passes with `agentic-jujutsu` as the only drift caught, queen MUST follow through on Option B regardless of lint-fire frequency — the structural fix is owed for the audit's "5 registries" finding even if the lint stays quiet. Recorded as a soft commitment from the queen, NOT a Decision change. Does NOT block adoption.

### Weighted vote tally

Per `byzantine.ts` weighted scheme (queen ×3; N=5 voters total → denominator `(N-1)+3 = 4+3 = 7`):

| Voter | Vote | Weight | Weighted contribution |
|---|---|---|---|
| Queen (pipeline owner) | YES | 3 | +3 |
| E1 (Pipeline-script) | YES | 1 | +1 |
| E2 (Wave-A9 archeologist) | YES | 1 | +1 |
| E3 (Lint-DX) | YES | 1 | +1 |
| E4 (Single-source advocate) | YES (with adopted scope-control) | 1 | +1 |
| DA | HOLD (no vote; principled dissent on hook 1 acknowledged) | 0 | 0 |

**Approval threshold**: queen-led Weighted requires queen (+3) AND ≥2 supporting experts (+2). **Achieved**: queen + 4 experts = +7/7 weighted approval. Decision **ADOPTED** with 6 refinements (E1-a, E1-b, E2-a, E2-b, E3, E4) and DA's hook-1 dissent recorded for the structural follow-up.

### Refinements applied

| # | Source | Refinement |
|---|--------|-----------|
| R1 | E1-a | Sites-table pairwise check #6 added: `build-packages.sh::_v3_packages` bash literal MUST equal the inline JS `v3set` at `:200-205` (intra-file drift). |
| R2 | E1-b | Step 3 placement made unambiguous: gate-0 = FIRST executable line after `set -euo pipefail` + `lib/*` sourcing in `ruflo-publish.sh`, before Phase 0's `verify_fork_branches`. |
| R3 | E2-a | Decision §"Option A" rationale appended: scope-rename-at-source (wave-A9 lesson #2 alternative) was considered but rejected because 6 of 11 drift-prone unscoped names come from `napi-rs`/`wasm-pack` generated `package.json` files. |
| R4 | E2-b | Step 4 amended to 2-commit TDD sequence: commit-1 lands lint + test (RED on `agentic-jujutsu`); commit-2 lands the `UNSCOPED_PUBLISHABLE` fix (GREEN). Drift surfaces in git history. |
| R5 | E3 | Step 2 error-message contract: cite (a) offending registry, (b) registry to agree with, (c) suggested fix, (d) corpus rule citation. Self-resolving without ADR re-read. |
| R6 | E4 | Option B re-eval moved from "if drift fires >2 in 90 days" to "next remediation pass — CT-C round 2"; threshold already met. Queen commits to follow-up cadence as soft commitment. |
| R7 | Queen | INTEGRATION-LEDGER discipline — no row needed (fork-local pipeline infrastructure, no upstream hand-port). Explicitly noted per `[[feedback-update-integration-ledger]]` to prevent the "missing-row" audit at next sync. |
| R8 | DA (recorded) | DA's hook-1 principled dissent retained as a release-gate forcing function: if `agentic-jujutsu` is the only drift the lint catches in the first 90 days, queen still owes Option B at the next pass regardless of lint-fire frequency. |

### Top risk + mitigation

* **Risk**: same shape ADR-0240 and ADR-0245 identified (lint-without-acceptance-check) — the lint script exists, but no pipeline step actually invokes it, so the next slip slips again. Worse here than CT-G/CT-L because the lint runs at gate-0 of `ruflo-publish.sh`, which is itself the canonical pipeline entrypoint — if the gate-0 invocation regresses (someone moves the lint call below Phase 0 or comments it out during debugging), the lint silently de-activates. Pre-flight #1 trap shape ("signal reaches audience").
* **Mitigation**: per ADR-0240's accepted shape — register the lint as an acceptance-tier check (not just `ruflo-publish.sh` invocation). The acceptance check boots `bash scripts/ruflo-publish.sh --dry-run` (or equivalent gate-0-only invocation), confirms the lint ran (greppable log line "lint-scope-registries: PASS" or "FAIL"), AND independently invokes `node scripts/lint-scope-registries.mjs` against current state. Belt + braces: gate-0 catches the operator at release time; acceptance check catches the gate-0 regression itself. Matches the [[ADR-0215]] golden-master pattern and the CT-G/CT-L mitigations.
* **Secondary risk**: the 2-commit TDD sequence (R4) requires discipline at fix-commit time — if the developer squashes commits before merge, the RED-GREEN history collapses. **Mitigation**: per `[[feedback-no-history-squash]]`, the project already forbids squash-to-clean-up; this risk is structurally bounded.

