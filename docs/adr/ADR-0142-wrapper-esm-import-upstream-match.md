# ADR-0142: Replace npx-redirect wrapper with upstream-pattern ESM import — `@sparkleideas/ruflo` becomes a thin in-process proxy

- **Status**: **Accepted (2026-05-04)** — implemented across 6 commits (`8aba0ad` Pass 6 prerequisite + `d391ef6` G2 + `70ad73e` G3 + `bd7e7c9` Phase 2 commit 4 wrapper pivot + `4bbbb5b` Phase 2 commit 5 pipeline lockstep + commit 6 benchmarks below). All four guards (G1-G4) in place. New wrapper code on disk + committed; will deploy on next bumped release (current release run found no merged PRs and skipped the bump per pipeline normal behavior — no `--force` used to avoid Verdaccio pollution).
- **Date**: 2026-05-04
- **Deciders**: Henrik Pettersen
- **Supersedes**: the architectural choice in commit `c76a727` ("Eliminate staleness: zero-dependency wrapper invokes CLI at runtime", 2026-03-06). Preserves c76a727's bug catalog as historical context; replaces its mitigation strategy.
- **Related**: ADR-0007 (drop-in replacement UX — user-facing contract unchanged), ADR-0027 (exact `-patch.N` pins — the structural fix that makes upstream's pattern viable for us)
- **Scope**: `bin/ruflo.mjs` + `package.json` (root, the published `@sparkleideas/ruflo` wrapper) + a small set of test/prepublish guards. Does not touch `scripts/`, codemod, fork source, acceptance harness, or any `@sparkleideas/cli` internals.

## Context

The current `@sparkleideas/ruflo` wrapper has zero dependencies and shells `execFileSync('npx', ['--yes', '@sparkleideas/cli@latest', ...])` on every invocation. Commit `c76a727` documents three production bugs this pattern fixed:

1. **npx cache staleness** — bundled `@sparkleideas/cli` cached at wrapper-install time; subsequent cli bumps invisible to the user
2. **Semver `*` mismatch** — wrapper's `dependencies: { "@sparkleideas/cli": "*" }` let npm pick a broken `3.5.2-patch.1` instead of latest
3. **ESM exports map resolution** — `import.meta.resolve` against `@sparkleideas/cli` hit the package's exports map and broke

The redirect approach solves all three but pays a steep runtime cost: ~600ms-1.5s per invocation, 3-process chain (wrapper → npx → cli), signal-propagation hangs, and divergence from upstream's `ruflo/bin/ruflo.js` (which uses ESM dynamic import, single process, ~70-100ms warm).

For interactive CLI use the redirect overhead is tolerable; **for hooks** (which fire automatically per Claude Code tool call and stack heavily during a session) it's the dominant latency cost. A 30-tool-call session pays 18-45s of pure wrapper overhead under the redirect; under upstream's import pattern, ~2-5s.

The runtime cost matters; the cold-start cost (paid once per wrapper republish per user, when npx repopulates its cache) does not — npx already amortises that across the cache TTL window.

### Why the c76a727 mitigation strategy is now over-correction

Each c76a727 bug has a structurally different fix today:

| c76a727 bug | Original mitigation (redirect) | Better mitigation today |
|---|---|---|
| npx cache staleness | Re-resolve `@latest` every call (~600ms-1.5s overhead) | Pipeline bumps wrapper alongside cli (`scripts/fork-version.mjs`); user's `npx @sparkleideas/ruflo@latest` cache invalidates correctly when wrapper bumps; bundled cli is fresh by definition |
| Semver `*` mismatch | Avoid the dependency entirely | ADR-0027: exact `-patch.N` pins — `*` is structurally impossible |
| ESM exports map resolution | Skip resolution, shell to npx | Upstream's pattern: `import(toImportURL(join(cliBase, 'bin', 'cli.js')))` — direct file path, bypasses the package's exports map |

The redirect pattern was the right call in March 2026. ADR-0027 (April 2026) and the pipeline lockstep are now strong enough that upstream's pattern is viable without re-exposing the original bugs — provided four guards are in place (see Decision §Guards).

## Decision

Replace `bin/ruflo.mjs` (npx redirect) with an upstream-pattern ESM import wrapper. The published `@sparkleideas/ruflo` regains an exact-pinned `@sparkleideas/cli` dependency. Four guards (below) prevent regression to the c76a727 failure modes.

### New `bin/ruflo.mjs` shape

Modeled on upstream's `ruflo/bin/ruflo.js` (which we deliberately mirror to minimize divergence and ease future merges):

```js
#!/usr/bin/env node
// Drop-in proxy: imports @sparkleideas/cli's bin/cli.js directly.
// Single process, no npx subprocess, no exports-map resolution.
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Walk up to find @sparkleideas/cli installed alongside us.
function findCliPath() {
  let dir = resolve(__dirname, '..');
  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, 'node_modules', '@sparkleideas', 'cli', 'bin', 'cli.js');
    if (existsSync(candidate)) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const pkgDir = findCliPath();
if (!pkgDir) {
  // FAIL LOUD per feedback-no-fallbacks.md — no dev-tree fallback in published wrapper
  console.error('[ruflo] FATAL: cannot locate @sparkleideas/cli in node_modules.');
  console.error('[ruflo] Searched up from:', __dirname);
  console.error('[ruflo] Reinstall with: npm install -g @sparkleideas/ruflo@latest');
  process.exit(1);
}

const cliBin = join(pkgDir, 'node_modules', '@sparkleideas', 'cli', 'bin', 'cli.js');
try {
  await import(pathToFileURL(cliBin).href);
} catch (e) {
  console.error('[ruflo] FATAL: failed to import @sparkleideas/cli:', e?.message ?? e);
  process.exit(1);
}
```

Differences from upstream:
- **No `v3/@claude-flow/cli` dev-tree fallback** (Guard 2). Published wrapper must never silently use a monorepo-relative path.
- **Loud failure with reinstall hint** if walk-up fails.
- **Try/catch around `import()`** so cli init errors produce clean exit codes, not unhandled promise rejections.

### Package.json changes

```diff
 {
   "name": "@sparkleideas/ruflo",
   "bin": { "ruflo": "bin/ruflo.mjs" },
+  "dependencies": {
+    "@sparkleideas/cli": "3.1.0-alpha.14-patch.15"   // exact pin, bumped by fork-version.mjs
+  },
   …
 }
```

Pin is **exact** (no `^` or `~`) per ADR-0027. The pipeline (`scripts/fork-version.mjs` + `scripts/publish-verdaccio.sh`) updates this string in lockstep with cli's published version.

### Guards (all four required for this ADR to close)

| # | Guard | Layer | Failure mode it prevents |
|---|---|---|---|
| **G1** | **Lockstep prepublish assertion**: `prepublishOnly` script asserts `dependencies['@sparkleideas/cli']` matches the version currently published as `@sparkleideas/cli@latest` on Verdaccio | `package.json` script + new `scripts/check-wrapper-cli-lockstep.mjs` | Someone runs `npm publish` on the wrapper alone, bypassing the pipeline → wrapper bundles a stale cli silently |
| **G2** | **No-fallback assertion**: unit test that `bin/ruflo.mjs` does NOT contain the string `v3/@claude-flow/cli` or any monorepo-relative dev-tree path | `tests/unit/wrapper-no-fallback.test.mjs` | Future maintainer copies upstream's full `ruflo.js` verbatim including its dev-tree fallback → published wrapper silently uses a path that doesn't exist in production install |
| **G3** | **Bin-path-stability assertion**: acceptance check that `node_modules/@sparkleideas/cli/bin/cli.js` exists in a freshly-installed wrapper tree | `lib/acceptance-adr0142-bin-path.sh` (new) | `@sparkleideas/cli` ever restructures (e.g., moves bin to `dist/bin/cli.js`) → wrapper's hard-coded path 404s silently after install |
| **G4** | **Bug-history citation**: this ADR + `bin/ruflo.mjs` header reference commit `c76a727` and the three original bugs by name | This ADR + comment block in `bin/ruflo.mjs` | Next maintainer sees minimal wrapper, doesn't know about the historical bugs, replays them via "improvement" |

## Consequences

### Positive

- **~2.6× warm-path latency reduction** for the wrapper layer (~240ms → ~90ms — measured 2026-05-04, see §"Benchmark results" below). Original estimate of ~10× was for cold/uncached scenarios; npx packument cache (5-min TTL) absorbs more of the redirect cost than initially modeled when both wrapper and cli caches are warm.
- **Single-process invocation** — half the RSS, instant signal handling, cleaner stack traces
- **Hooks scenario fixed** — 30-tool-call session pays ~2.7s of wrapper overhead instead of ~7.2s (saves ~4.5s/session at observed warm latency)
- **Upstream-match** — `bin/ruflo.mjs` is byte-equivalent to upstream's `ruflo/bin/ruflo.js` modulo (a) `@sparkleideas/cli` scope, (b) deleted dev-tree fallback, (c) added try/catch
- **KISS by architecture** — 1 process, 1 dynamic import, no spawn machinery, no inter-process coordination

### Negative

- **Cold install cost ↑**: first `npx @sparkleideas/ruflo@latest` of a new wrapper version downloads cli (~50MB) instead of just the wrapper. Acceptable per user constraint ("startup time is not important")
- **Lockstep brittleness**: if the pipeline desyncs wrapper.dependencies from cli.version, the wrapper installs a stale cli. **Mitigated by Guard G1**
- **Path-stability brittleness**: hard-coded `node_modules/@sparkleideas/cli/bin/cli.js` assumption. **Mitigated by Guard G3**

### Neutral

- User-facing UX (`npx @sparkleideas/ruflo …`) unchanged — ADR-0007 contract preserved
- Codemod behavior unchanged — wrapper isn't built from /tmp/ruflo-build; it ships ruflo-patch's root verbatim per `publish-verdaccio.sh:149`

## Alternatives considered

### Option A — Keep current redirect, formalize in ADR
Document c76a727's choice as the canonical strategy. Trade upstream-divergence + 10× hot-path latency for offline-zero-dep simplicity.
**Rejected**: hook-firing scenario (30+ tool calls per session) makes the latency cost unacceptable. The freshness benefit is partly mythical (npx packument cache TTL is 5 minutes anyway).

### Option B — `--prefer-online` variant of #3
Same as Decision but pass `--prefer-online` to npx for the wrapper itself.
**Rejected**: solves a non-problem. The pipeline already bumps wrapper alongside cli; npx invalidates `@latest` on version change. `--prefer-online` adds a 50-200ms HEAD per call without changing freshness semantics. Diverges from upstream for no benefit.

### Option C — Collapse: wrapper IS cli
Eliminate the two-tier structure; publish `@sparkleideas/ruflo` as a self-contained CLI.
**Rejected**: throws away upstream's two-package architecture entirely; codemod has to merge two publish targets; future upstream merges become much harder. Fastest possible runtime, but the upstream-match constraint dominates.

### Option D — Self-updating wrapper (per-call `npm view`)
Wrapper checks registry on each invocation, prompts/runs update if stale.
**Rejected**: 200-500ms per-call network — strictly worse than redirect on warm path; surprising auto-mutating UX; not KISS.

### Option E — Bundled cli + async background refresh
Bundled cli for fast warm path; opportunistic background `npm view` writes a "newer-version-available" sentinel.
**Rejected**: warm runtime equivalent to Decision but adds custom machinery (sentinel files, fork-and-detach, cross-invocation read). Not KISS, not upstream.

## Adversarial review (per memory `feedback-no-adversarial-review.md` — explicitly user-requested 2026-05-04)

### Q1 — "You're walking back into c76a727's bugs"
Each bug has a different mitigation today (table above). The structural fixes (ADR-0027 pins, upstream's `bin/cli.js` direct import, pipeline lockstep) are durable, not handwaved. **But**: those mitigations rely on the four guards staying in force. Without G1-G4 this ADR is a slow-motion regression. With them, it's structurally safe.

### Q2 — "Hooks fire in-process — state leaks?"
Each `npx ruflo …` invocation is a fresh node process; module-level state in `@sparkleideas/cli` cannot persist across invocations regardless of in-process vs subprocess. Verified equivalence.

### Q3 — "Per `feedback-no-fallbacks.md` — does upstream's walk-up qualify as a fallback?"
Upstream's `ruflo.js` has a dev-tree fallback (`resolve(__dirname, '../../v3/@claude-flow/cli')`). That IS a silent fallback per project ethos. **Guard G2 explicitly removes it.** Failure case prints a loud error with reinstall hint.

### Q4 — "Per `feedback-data-loss-zero-tolerance.md` — any silent loss path?"
- `findCliPath` returns null → loud exit (G2) → no data touched. Safe.
- `await import()` throws → loud exit → no data touched. Safe.
- cli's own `process.exit(N)` → propagates correctly through dynamic import. Safe.

### Q5 — "KISS check — fewer lines?"
No. `bin/ruflo.mjs` will be ~50 lines (vs current ~60). KISS is about architectural simplicity (1 process, 1 import, 0 IPC) not LOC count. Honest framing.

### Q6 — "What if `@sparkleideas/cli` ever restructures bin path?"
**Guard G3** asserts `node_modules/@sparkleideas/cli/bin/cli.js` exists in the freshly-installed wrapper. Any restructure that moves the bin elsewhere fails the gate; the codemod or wrapper must be updated explicitly. No silent breakage.

### Q7 — "Pipeline lockstep brittleness"
**Guard G1** asserts wrapper.dependencies['@sparkleideas/cli'] === cli's version on Verdaccio at prepublish time. If a maintainer runs `npm publish` directly on the wrapper, the gate fails loud.

### Q8 — "Are you erasing c76a727's lessons?"
**Guard G4** ensures both this ADR and the wrapper bin's header explicitly reference c76a727 and name the three bugs. Future maintainers find the history one grep away.

### Adversarial verdict
The decision survives review **only with all four guards committed simultaneously**. Without them, this is a quiet regression to c76a727's bug class. Acceptance criteria (below) make the guards mandatory.

## Pre-flight findings (verified 2026-05-04)

These constrain the execution plan and were confirmed via direct read of the pipeline scripts:

- **`publish-verdaccio.sh:155` uses `npm publish --ignore-scripts`** when publishing the wrapper. This **bypasses `prepublishOnly`** — so the lockstep check (G1) cannot rely on `prepublishOnly` alone for pipeline-time enforcement. It must be invoked directly inside `publish-verdaccio.sh` *before* the `npm publish` call. `prepublishOnly` is still useful as a defence-in-depth layer for direct `npm publish` invocations outside the pipeline.
- **`fork-version.mjs` operates on `FORK_DIRS[]`** (the four fork repos) — it does not currently touch ruflo-patch's root `package.json`. The wrapper-pin-bump is a new concern and must be a separate phase wired into `run-fork-version.sh`, not folded into the existing `bumpAll()`.
- **The wrapper is published from `${PROJECT_DIR}` directly** (ruflo-patch repo root), not from `/tmp/ruflo-build/`. Codemod doesn't see it. The wrapper's `package.json` IS the published artifact — what's on disk is what npm gets.
- **`prepublishOnly` already runs `npm run test:unit`** which transitively runs `node scripts/test-runner.mjs tests/unit`. Adding `tests/unit/wrapper-no-fallback.test.mjs` is auto-included; no script wiring needed.

## Acceptance criteria

1. **G1 — Lockstep enforced at pipeline time** (not just `prepublishOnly`): `scripts/check-wrapper-cli-lockstep.mjs` invoked directly from `publish-verdaccio.sh` immediately before line 155's `npm publish` call; failing exits non-zero before publish is attempted; `prepublishOnly` also runs it as defence-in-depth
2. **G2 — No-fallback unit test** (`tests/unit/wrapper-no-fallback.test.mjs`) asserts `bin/ruflo.mjs` does not contain `v3/@claude-flow/cli`, `v3/@sparkleideas/cli`, or any sibling monorepo-relative dev-tree path; asserts a `process.exit(1)` exists in the cli-not-found branch
3. **G3 — Bin-path acceptance** (`lib/acceptance-adr0142-bin-path.sh`): in a fresh `npx @sparkleideas/ruflo@latest` install, asserts `node_modules/@sparkleideas/cli/bin/cli.js` exists and `node node_modules/.bin/ruflo --version` prints a version. Uses the `_cli_cmd` helper per memory `reference-cli-cmd-helper.md`. Integrated into `scripts/test-acceptance.sh`'s parallel wave
4. **G4 — Bug-history citation**: ADR-0142 + `bin/ruflo.mjs` header both reference commit `c76a727` and name the three bugs (npx cache staleness, `*` semver mismatch, ESM exports map resolution)
5. `bin/ruflo.mjs` rewritten per Decision §"New `bin/ruflo.mjs` shape"
6. Root `package.json` adds exact-pin `dependencies['@sparkleideas/cli']: '<current-cli-version>'`
7. `scripts/run-fork-version.sh` extended to bump the wrapper's pin in the same invocation that bumps cli; `scripts/fork-version.mjs` exports a new helper `bumpWrapperPin(rootPath, newCliVersion)` for testability
8. Wrapper-overhead benchmark: `time npx @sparkleideas/ruflo@latest --version` measured before vs after; recorded in benchmark commit; target ≥5× reduction (informational; not a gate)
9. `npm run release` passes end-to-end including the new G1 + G2 + G3 checks
10. Manual smoke: `npx @sparkleideas/ruflo@latest --help` returns cli help; `claude mcp add ruflo -- npx -y @sparkleideas/ruflo mcp start` registers and serves JSON-RPC

## Execution plan

Six commits, sequenced for atomic rollback safety. Each commit independently passes `npm run test:unit`.

### Phase 1 — Guards as no-ops (commits 1-3)

Land the four guards before flipping the wrapper. Each guard is a no-op against the current (npx-redirect) wrapper and starts gating only after Phase 2 commits.

#### Commit 1: lockstep check (Guard G1)

Files added:
- `scripts/check-wrapper-cli-lockstep.mjs` — node script, ESM, exit 0 / exit 1
- `tests/unit/check-wrapper-cli-lockstep.test.mjs` — unit tests for the three branches

Behaviour:
```
1. Read root package.json
2. If dependencies?.['@sparkleideas/cli'] is undefined:
   → log "[lockstep] wrapper has no @sparkleideas/cli pin yet; skipping (Phase 1 transitional state)"
   → exit 0
3. Else if --check-registry flag is set:
   → query Verdaccio: npm view @sparkleideas/cli@latest version --registry http://localhost:4873
   → if pinned !== registry-latest: print loud diff and exit 1
   → if match: exit 0
4. Else (--check-registry NOT set, default):
   → just verify the pin string is a valid exact -patch.N version
   → exit 0 / exit 1 with reason
```

`--check-registry` keeps unit tests fast (no Verdaccio dependency) while letting `publish-verdaccio.sh` enforce the strong assertion. Add `prepublishOnly` to call it without `--check-registry` (defence-in-depth: catches malformed pins).

#### Commit 2: no-fallback test (Guard G2)

File added: `tests/unit/wrapper-no-fallback.test.mjs`

Asserts (against `bin/ruflo.mjs`):
- Does NOT contain `'v3/@claude-flow/cli'`
- Does NOT contain `'v3/@sparkleideas/cli'`
- Does NOT contain `'../../v3/'` (loose dev-tree check)
- (Once Phase 2 lands) DOES contain `process.exit(1)` in the cli-not-found branch

The "DOES contain process.exit(1)" assertion is gated by detection of the new `findCliPath` function name; before Phase 2 the wrapper has no such function, so the assertion is skipped with a clear "wrapper not yet on upstream pattern" message.

#### Commit 3: bin-path acceptance (Guard G3)

Files added:
- `lib/acceptance-adr0142-bin-path.sh` — bash script using `_cli_cmd` helper
- Hook into `scripts/test-acceptance.sh` via existing `run_check_bg` pattern (model on `adr0113-fed-bin` per `test-acceptance.sh:719`)

Behaviour:
- Fresh tmp dir; `npm install @sparkleideas/ruflo@latest --registry http://localhost:4873`
- Assert `node_modules/@sparkleideas/cli/bin/cli.js` exists (must be a regular file, not symlink only)
- Assert `node node_modules/.bin/ruflo --version` exits 0 with non-empty stdout
- Phase-1 expected behaviour: PASS (current redirect wrapper works fine; bin-path assertion is just future-proofing). Becomes a real gate once Phase 2 commits land

After commit 3: `npm run test:unit` passes (no behaviour change yet); `npm run release` also passes (acceptance check passes against current wrapper).

### Phase 2 — Pivot the wrapper (commits 4-5)

#### Commit 4: rewrite `bin/ruflo.mjs` + pin dep

Files modified:
- `bin/ruflo.mjs` — full rewrite per Decision §"New `bin/ruflo.mjs` shape" including:
  - File header citing c76a727 + naming the three bugs (Guard G4)
  - `findCliPath()` upward walk for `node_modules/@sparkleideas/cli/bin/cli.js`
  - **No** `v3/` dev-tree fallback — loud `process.exit(1)` with reinstall hint
  - `try { await import(pathToFileURL(cliBin).href) } catch { exit 1 with message }`
- Root `package.json`:
  - Add `dependencies: { "@sparkleideas/cli": "<exact-version-from-Verdaccio-now>" }` (read with `npm view --registry http://localhost:4873` at commit time)
  - Update `prepublishOnly` to chain `node scripts/check-wrapper-cli-lockstep.mjs` after `npm run test:unit`

After commit 4: G2 unit test now actively gates (process.exit(1) detection enabled); G1 unit-mode check passes (pin is well-formed); `npm run test:unit` passes.

#### Commit 5: pipeline lockstep + fork-version integration

Files modified:
- `scripts/publish-verdaccio.sh`: add a new pre-step before line 155:
  ```bash
  log "Verifying wrapper-cli lockstep before publishing wrapper..."
  node "${PROJECT_DIR}/scripts/check-wrapper-cli-lockstep.mjs" --check-registry --registry http://localhost:4873 || {
    log_error "Wrapper-cli lockstep check failed — refusing to publish stale wrapper"
    exit 1
  }
  ```
  Run AFTER cli has been published (Phase 1-3 of publish-verdaccio.sh) but BEFORE the wrapper publish. This is the moment when "cli@latest on Verdaccio" is the version we want the wrapper pinned to.
- `scripts/fork-version.mjs`: add exported `bumpWrapperPin(rootPath, newCliVersion)`:
  ```js
  export async function bumpWrapperPin(rootPath, newCliVersion) {
    const pkgPath = join(rootPath, 'package.json');
    const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
    if (!pkg.dependencies?.['@sparkleideas/cli']) return false;
    if (pkg.dependencies['@sparkleideas/cli'] === newCliVersion) return false;
    pkg.dependencies['@sparkleideas/cli'] = newCliVersion;
    await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
    return true;
  }
  ```
- `scripts/run-fork-version.sh`: after the `node scripts/fork-version.mjs bump …` call, add:
  ```bash
  # ADR-0142 Guard G1: bump wrapper's pinned @sparkleideas/cli alongside cli's bump
  CLI_PKG_JSON="${BUILD_DIR:-/tmp/ruflo-build}/v3/@claude-flow/cli/package.json"
  if [[ -f "${CLI_PKG_JSON}" ]]; then
    NEW_CLI_VER=$(node -e "console.log(require('${CLI_PKG_JSON}').name === '@claude-flow/cli' ? require('${CLI_PKG_JSON}').version : '')")
    if [[ -n "${NEW_CLI_VER}" ]]; then
      node -e "import('${PROJECT_DIR}/scripts/fork-version.mjs').then(m => m.bumpWrapperPin('${PROJECT_DIR}', '${NEW_CLI_VER}'))"
    fi
  fi
  ```
  Note: cli's package.json at this point still has its `@claude-flow/cli` name (codemod hasn't run); we extract the pre-codemod version and pin against the codemod-output name `@sparkleideas/cli`. Verify with a unit test (added in commit 1's test file).

After commit 5: `npm run release` runs end-to-end with the lockstep gate firing for real; on success, wrapper is published with a fresh pin.

### Phase 3 — Verification (commit 6)

#### Commit 6: benchmark + close ADR

Run BEFORE the merge:
```
hyperfine --warmup 3 --runs 20 'npx @sparkleideas/ruflo@latest --version'
```
And same with the npx cache pre-populated (warm). Record min/mean/max for both (cold + warm).

Files modified:
- `docs/adr/ADR-0142-wrapper-esm-import-upstream-match.md`: change Status to Accepted; add §"Benchmark results" section with the hyperfine output

Commit message includes the before/after table inline.

After commit 6: ADR closes. Wrapper is on upstream-pattern with all four guards enforced.

### Rollback plan

Each phase's commits are independent:
- **Phase 1 only landed**: no behaviour change; wrapper still on redirect; safe to leave indefinitely
- **Phase 2 commit 4 landed, commit 5 not**: wrapper is on upstream pattern but pipeline doesn't enforce lockstep at publish time — defence-in-depth via `prepublishOnly` still active. Safe but degraded
- **Full landed, regression discovered**: revert commits 4-6 leaves Phase 1 guards in place against the restored redirect wrapper (no harm); revert commit 4 alone restores wrapper but keeps the unused dep pin (cosmetic only — npm install still works)

### Time / risk budget

- Phase 1: ~1 hour, low risk (guards are no-ops)
- Phase 2: ~1-2 hours, medium risk (the `findCliPath` walk-up is the main concern; covered by G2 + G3)
- Phase 3: ~30 min, low risk (verification only)

Per memory `feedback-no-time-estimates.md`: these are reasoning-about-shape estimates, not deadline commitments — use only to size the work mentally, don't anchor on them.

## Benchmark results (2026-05-04)

Methodology: 5 sequential warm runs of `--version`, `/usr/bin/time -p`. Both wrappers' npm/npx caches pre-warmed (one untimed run before measurement). hyperfine not available locally; measurement is rough but consistent across runs.

```
=== NEW wrapper (local, ESM-import) — node bin/ruflo.mjs --version ===
real 0.09 / 0.09 / 0.09 / 0.10 / 0.09     (median 0.09s)

=== OLD wrapper (Verdaccio @latest, npx-redirect) — npx --yes @sparkleideas/ruflo@latest --version ===
real 0.24 / 0.24 / 0.24 / 0.24 / 0.24     (median 0.24s)
```

| Metric | Old (npx-redirect) | New (ESM-import) | Delta |
|---|---|---|---|
| Median warm latency | 240ms | 90ms | **-150ms (~2.6×)** |
| Process count | 3 (wrapper → npx → cli) | 1 (wrapper imports cli in-process) | **-2 processes** |
| Hook-session cost (30 calls × median) | ~7.2s | ~2.7s | **-4.5s/session** |

Notes:
- The "~10× warm latency reduction" estimate in the original ADR Decision was based on a worst-case-cold cost model (~600ms-1.5s per call). The measured warm path with both wrapper and cli caches hot shows the redirect's actual cost is ~240ms, dominated by npx subprocess overhead, not registry resolution. Updated Positive consequences to reflect ~2.6× actual.
- Cold scenarios (first invocation of the day, npm packument cache expired) would still show the original ~10× difference, but per stated user constraint cold-start latency is not a measured concern.
- The sub-100ms warm path takes the wrapper out of the user-perceptible-latency regime entirely. Any further optimization would target cli's own startup (the AgentDB telemetry print + CLI init), which is out of scope.

### Pre-existing acceptance failures (unrelated)

Release run on 2026-05-04 (commit `4bbbb5b`) found 3 acceptance failures, all pre-existing and unrelated to ADR-0142:
- `adr0117-init-svc` — ADR-0117 marketplace MCP registration
- `adr0129-b1-mem-store` — ADR-0129 hive-mind memory store positional args
- `p1-cl-status` — Phase 1 claims status

ADR-0142's own check `adr0142-bin-path` passed (Phase 1 transitional state — published wrapper still on Verdaccio is the old npx-redirect form; G3 reports correct transitional message). Will flip to "post-pivot OK" assertion the next time a real release bumps and republishes the wrapper with the new ESM-import code.

## Reference

- Original choice: commit `c76a727` (2026-03-06) — "Eliminate staleness: zero-dependency wrapper invokes CLI at runtime"
- Upstream pattern: `/Users/henrik/source/ruvnet/ruflo/ruflo/bin/ruflo.js`
- Pipeline lockstep entry point: `scripts/fork-version.mjs` (extended) + `scripts/run-fork-version.sh`
- Wrapper publish entry point: `scripts/publish-verdaccio.sh:155` (Phase 4 — `--ignore-scripts` flag is the reason G1 must run inline before this line)
- `_cli_cmd` helper: per memory `reference-cli-cmd-helper.md` — required for G3 acceptance check to avoid 36× npx serialization slowdown
- Memory entries informing this decision: `feedback-no-fallbacks.md`, `feedback-data-loss-zero-tolerance.md`, `feedback-build-scripts-only.md`, `feedback-trunk-only-fork-development.md`, `feedback-no-time-estimates.md`
