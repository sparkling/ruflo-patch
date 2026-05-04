# ADR-0142: Replace npx-redirect wrapper with upstream-pattern ESM import — `@sparkleideas/ruflo` becomes a thin in-process proxy

- **Status**: **Proposed (2026-05-04)**
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

- **~10× warm-path latency reduction** for the wrapper layer (~600ms-1.5s → ~70-100ms)
- **Single-process invocation** — half the RSS, instant signal handling, cleaner stack traces
- **Hooks scenario fixed** — 30-tool-call session pays ~3s of wrapper overhead instead of ~30s
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

## Acceptance criteria

1. `bin/ruflo.mjs` rewritten per Decision §"New `bin/ruflo.mjs` shape"; header references commit `c76a727` and the three c76a727 bugs by name (Guard G4)
2. `package.json` adds exact-pin `dependencies['@sparkleideas/cli']`; `scripts/fork-version.mjs` updated to bump it alongside cli's version
3. `scripts/check-wrapper-cli-lockstep.mjs` written; `package.json` `prepublishOnly` script runs it; failing the lockstep check exits non-zero and aborts publish (Guard G1)
4. `tests/unit/wrapper-no-fallback.test.mjs` added; asserts `bin/ruflo.mjs` does not contain `v3/@claude-flow/cli` or any sibling dev-tree path; passes under `npm run test:unit` (Guard G2)
5. `lib/acceptance-adr0142-bin-path.sh` added; verifies `node_modules/@sparkleideas/cli/bin/cli.js` exists in a fresh `npx @sparkleideas/ruflo@latest` install; integrated into `scripts/test-acceptance.sh` parallel wave (Guard G3)
6. Wrapper-overhead benchmark: `time npx @sparkleideas/ruflo --version` measured before and after; documented in commit message; expected ~10× reduction
7. `npm run release` passes end-to-end (preflight + unit + acceptance) — including the new lockstep + no-fallback + bin-path checks
8. Manual smoke: `npx @sparkleideas/ruflo memory store …` works; `claude mcp add ruflo -- npx -y @sparkleideas/ruflo mcp start` registers cleanly and serves JSON-RPC

## Implementation plan

Single PR, sequenced as:

1. **Land the four guards first** (commits 1-3), each independently testable:
   - Commit 1: write `lockstep` check + `tests/unit/wrapper-no-fallback.test.mjs` + `lib/acceptance-adr0142-bin-path.sh`. Currently no-op (no dep yet); tests pass trivially
2. **Pivot the wrapper** (commit 4):
   - Rewrite `bin/ruflo.mjs` per Decision
   - Add exact-pin `dependencies['@sparkleideas/cli']` to root `package.json`
   - Update `scripts/fork-version.mjs` to keep the pin in lockstep
3. **Pipeline integration** (commit 5):
   - Wire `prepublishOnly` to run the lockstep check
   - Add bin-path acceptance to `test-acceptance.sh` parallel wave
4. **Run `npm run release`** — full verification end-to-end. Must pass.
5. **Benchmark commit** (commit 6): record before/after `time` measurements in commit message; close the ADR

Per memory `feedback-build-scripts-only`, the only invocation is `npm run release` for full verification — no piecemeal pipeline scripts.

## Reference

- Original choice: commit `c76a727` (2026-03-06) — "Eliminate staleness: zero-dependency wrapper invokes CLI at runtime"
- Upstream pattern: `/Users/henrik/source/ruvnet/ruflo/ruflo/bin/ruflo.js`
- Pipeline lockstep entry point: `scripts/fork-version.mjs`
- Wrapper publish entry point: `scripts/publish-verdaccio.sh:149` (Phase 4)
- Memory entries informing this decision: `feedback-no-fallbacks.md`, `feedback-data-loss-zero-tolerance.md`, `feedback-build-scripts-only.md`, `feedback-trunk-only-fork-development.md`
