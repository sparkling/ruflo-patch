# ADR-0143: Flip user-facing brand from `@sparkleideas/cli` to `@sparkleideas/ruflo` post-wrapper-pivot

- **Status**: **Accepted (2026-05-04)** — implemented across 3 commits (`9d594cf` tests-first + `4186399` Pass 7 impl + commit 3 release verification below). ADR-0142 prerequisite landed `fc96ef1`. Pass 7 contract verified post-release: **0** `@sparkleideas/cli` refs in user-facing scopes, **64** `@sparkleideas/ruflo` refs (the rebrand), **10** `@sparkleideas/cli` refs preserved in internal scopes (memory cross-package + cli's own `__tests__/`). New codemod runs ship in next bumped release.
- **Date**: 2026-05-04
- **Deciders**: Henrik Pettersen
- **Depends on**: ADR-0142 (wrapper rewrite — non-negotiable prerequisite). **Builds on**: ADR-0007 (drop-in UX), ADR-0117 (the original ruflo-namespace rebrand effort, scoped narrowly because of the wrapper perf cost), ADR-0141 (Pass 5 generalization — sister-codemod-pass design for path-scoped rewrites). Commit `8aba0ad` (Pass 6) provides analogous prior-art for an npx-context regex pass.
- **Scope**: Codemod adds a new path-scoped pass that rewrites `@sparkleideas/cli` → `@sparkleideas/ruflo` in user-facing contexts only. Internal pipeline, test infrastructure, and the wrapper's own dependency are explicitly out of scope.

## Context

Survey on 2026-05-04 found 415 `@sparkleideas/cli` references in active fork surfaces. Upstream's primary brand for the same use cases is `ruflo` (205× `npx ruflo@latest` in their README/USERGUIDE vs 5× `npx claude-flow@latest`). We diverged because the c76a727 redirect made the wrapper layer costly enough that recommending the direct-cli bypass was a meaningful UX choice.

ADR-0142 collapses the wrapper overhead from ~600ms-1.5s to ~70-100ms by switching to upstream's ESM-import pattern. The performance argument for the bypass disappears. Brand consistency with upstream becomes the dominant concern.

### Categorisation of the 415 refs

| Cat | Surface | Count (approx) | Action |
|---|---|---:|---|
| **A** | User-facing prose: `README.md`, `docs/USERGUIDE.md`, `scripts/install.sh`, `CHANGELOG.md` | ~40 | Flip to `@sparkleideas/ruflo` |
| **B** | Init-generated MCP config: `mcp-generator.ts`, `settings-generator.ts` | ~10 | Flip — see §Decision §B (MCP discussion) |
| **C** | Init-printed help text + ad-hoc command examples in `executor.ts` | ~50 | Flip to `@sparkleideas/ruflo` |
| **D** | Plugin/agent/skill markdown templates (`.claude/{skills,agents,commands}/**`, `plugins/**`) | ~200 | Flip to `@sparkleideas/ruflo` |
| **E** | Internal pipeline/test infrastructure (`_cli_cmd` helper, codemod, acceptance scripts, ruflo-patch's own `lib/`) | ~115 | **Stay** — direct cli use is intentional |
| **F** | Wrapper's `package.json` `dependencies['@sparkleideas/cli']` (added by ADR-0142) | 1 | **Stay** — wrapper depends on cli by design |

Categories A-D (~300 refs) flip; E + F (~116 refs) stay. The split is path-scoped, not regex-scoped, so the codemod can enforce it cleanly.

## Decision

Add codemod **Pass 7**: rewrite `@sparkleideas/cli` → `@sparkleideas/ruflo` in user-facing scopes only. Pass 7 is a sibling to Pass 5 (ADR-0117) and Pass 6 (commit `8aba0ad`) — same structural pattern, different content.

### Pass 7 regex

```js
// Rewrites @sparkleideas/cli@<ver> → @sparkleideas/ruflo@<ver>
// Also rewrites bare @sparkleideas/cli → @sparkleideas/ruflo (no version)
// Anchored to npm-package-name shape: not preceded by alphanumeric/dash
// Not followed by alphanumeric/dash (so @sparkleideas/cli-foo unaffected)
const SPARKLEIDEAS_CLI_RE = /(?<![\w-])@sparkleideas\/cli(?![\w-])/g;
const PASS7_REPLACEMENT = '@sparkleideas/ruflo';
```

The regex matches:
- `@sparkleideas/cli` (bare)
- `@sparkleideas/cli@latest`
- `@sparkleideas/cli@1.2.3-patch.4`
- `@sparkleideas/cli mcp start` (in shell command position)

The regex does NOT match:
- `@sparkleideas/cli-foo` (different package — followed by `-`)
- `@sparkleideas/clinical` (different package — followed by `nical`)

### Pass 7 path scope

Active in:
- `**/README.md`, `**/CHANGELOG.md`, `docs/**/*.md` (user-facing docs)
- `scripts/install.sh` (user-running script)
- `**/.claude/{skills,agents,commands}/**/*.{md,json}` (templates copied to user `.claude/`)
- `plugins/**/*.{md,json}` (marketplace plugin docs)
- `.claude-plugin/**/*.{md,json}` (umbrella manifest)
- `v3/@claude-flow/cli/src/init/**/*.{ts,js,mjs,cjs}` (init-time code that emits user-facing strings)

Inactive in:
- `lib/**`, `scripts/**` (except `install.sh`) — these are ruflo-patch's pipeline internals, NOT in the fork tree at all
- `tests/**` — test infrastructure references cli directly
- `forks/ruflo/v3/@claude-flow/{memory,mcp,hooks,…}/**` — internal cross-package code paths
- `forks/ruflo/v3/@claude-flow/cli/__tests__/**` — cli's own tests
- `docs/adr/**` (in fork) — historical ADRs reference `@sparkleideas/cli` for accuracy
- `docs/adr/**` (in ruflo-patch) — same reason

The path scope mirrors ADR-0141's design: a single predicate `isPlugin7Scope(filePath, tempDir)` that lists in/out scope explicitly. New files added to in-scope dirs get rewritten automatically; new out-of-scope code is unaffected.

### MCP config decision: B2 (route MCP through wrapper)

Two options for init-generated MCP config:

**B1 — keep MCP pointing at cli directly** (matches upstream README's anomaly):
```json
{ "command": "npx", "args": ["-y", "@sparkleideas/cli", "mcp", "start"] }
```

**B2 — MCP also goes through wrapper** (what we're choosing):
```json
{ "command": "npx", "args": ["-y", "@sparkleideas/ruflo", "mcp", "start"] }
```

**Choosing B2** because:
1. Upstream's `ruflo.js` explicitly handles MCP mode in-process: `if (isMCPMode) { await import(toImportURL(join(cliBase, 'bin', 'cli.js'))); }`. They designed for the unified entry point; only their README documentation lags. ADR-0142's wrapper inherits this pattern.
2. ADR-0142's G2 (no-fallback) + G3 (bin-path acceptance) make wrapper failure modes loud — the failure-isolation argument for B1 is significantly weaker
3. Single canonical entry point (`npx @sparkleideas/ruflo …`) is simpler user mental model
4. ~70ms wrapper overhead at MCP boot is one-time, not per-message. JSON-RPC hot path is unaffected

B1 documented in §Alternatives below as the conservative fallback if B2 turns out to have unforeseen MCP-startup failure modes.

### Surfaces deliberately left untouched

- **`bin/ruflo.mjs` itself**: contains `@sparkleideas/cli` in the import path comments + `findCliPath()` calls. These are correct as-is (ADR-0142 G4 requires citing the cli relationship explicitly).
- **`lib/acceptance-*.sh`**: acceptance tests probe the cli binary directly via `_cli_cmd` per memory `reference-cli-cmd-helper.md`. The 36× slowdown from npx serialization makes the redirect-via-wrapper unacceptable for parallel acceptance waves.
- **Pipeline scripts**: `scripts/test-acceptance.sh`, `scripts/publish-verdaccio.sh`, etc. invoke the cli's bin directly because they need precise version control, not `@latest` resolution.

## Consequences

### Positive

- **Brand consistency with upstream**: ~300 surfaces flip to match upstream's `ruflo` convention; 5 sister files (cli/ruflo/mcp/etc.) line up cleanly
- **Codemod-enforced**: future upstream merges that reintroduce `@claude-flow/cli` get auto-rewritten via Pass 1 (existing) → `@sparkleideas/cli` → Pass 7 (new) → `@sparkleideas/ruflo`. No fork-side maintenance
- **Composes with ADR-0142**: validates the wrapper-overhead reduction is real — if Pass 7 lands and users immediately complain about latency, ADR-0142's benchmarks were wrong
- **Eases Pass 5 work**: the 207 `claude-flow@<ver>` hits ADR-0141 targets become a smaller surface to think about, since Pass 7's brand flip happens at a different layer

### Negative

- **More codemod surface**: Pass 7 adds ~50 LOC to `scripts/codemod.mjs` plus its own test file. Acceptable per Pass 5/6 precedent
- **Acceptance-check brittleness**: any acceptance check that greps for `@sparkleideas/cli` in user-facing surfaces will fail after Pass 7 lands. Need to audit acceptance scripts for these greps and adjust
- **Documentation churn**: 40+ markdown files in user-facing docs change in one commit — large diff to review

### Neutral

- **User retraining**: any user with shell history of `npx @sparkleideas/cli …` keeps working (the cli package still exists; commands resolve fine). The flip is forward-compatible — old commands still work, new docs prefer the new form
- **Search-and-replace asymmetry**: users with internal scripts referencing `@sparkleideas/cli` won't have those auto-updated. Mitigated by leaving the cli package unchanged and functional

## Acceptance criteria

1. `scripts/codemod.mjs` adds Pass 7 with the regex + path-scope predicate from §Decision; exported `applyPass7()` and `isPlugin7Scope()` helpers for testability (mirroring Pass 5's structure)
2. `tests/pipeline/codemod.test.mjs` adds a new `describe('codemod: ADR-0143 Pass 7 …')` block with:
   - Positive: `npx @sparkleideas/cli@latest` in `README.md` rewrites
   - Positive: shell-token `@sparkleideas/cli mcp start` in `scripts/install.sh` rewrites
   - Positive: `args: ["-y", "@sparkleideas/cli", "mcp", "start"]` in init's `mcp-generator.ts` rewrites
   - Negative: `@sparkleideas/cli-foo` (different package) untouched
   - Negative: `@sparkleideas/cli` in `docs/adr/**` untouched
   - Negative: `@sparkleideas/cli` in `forks/ruflo/v3/@claude-flow/memory/**` untouched
   - Idempotency: second run produces identical output
3. After `npm run release`, grep for `@sparkleideas/cli` in `/tmp/ruflo-build/` user-facing scopes returns 0 hits; grep in internal scopes still returns the expected refs
4. Acceptance script audit: any acceptance check that asserts `@sparkleideas/cli` appears in user-facing files updated to assert `@sparkleideas/ruflo` instead
5. **Automated** init-MCP-config smoke (`adr0143-init-mcp` acceptance check, `lib/acceptance-adr0143-init-mcp.sh:check_adr0143_init_mcp_config`): fresh-installs the wrapper from Verdaccio, runs `ruflo init --yes --force` in a tmp dir, parses the generated `.mcp.json`, asserts the mcpServers entry uses the wrapper-canonical path (B2 — either `args: [..., "@sparkleideas/ruflo", ...]` for npx form OR `command: <local-bin>, args: ["mcp","start"]` for direct-bin form). Mirrors ADR-0117 AC#1's dual-path acceptance. Per project policy, no manual steps.
6. Wrapper-overhead benchmark from ADR-0142 must be in place — if MCP boot via wrapper exceeds 200ms in measurement, fall back to B1 documented in §Alternatives

## Alternatives considered

### Option B1 — Keep MCP pointing at cli directly
Init-generated MCP config stays `args: ["-y", "@sparkleideas/cli", …]` even though all other user surfaces flip to ruflo.

**Rejected** as primary choice; documented as fallback. Trade-offs are nearly even, and a single canonical entry point is the simpler design under ADR-0142's loud-failure guards. Reverting to B1 if MCP startup proves flaky is a one-line codemod tweak.

### Option B0 — Skip the rebrand entirely
Leave `@sparkleideas/cli` as the user-facing brand, accept divergence from upstream.

**Rejected**. The wrapper-overhead reason for the divergence disappears under ADR-0142. Maintaining a divergence with no benefit is pure cost. Upstream's `ruflo` brand is also better marketing.

### Option C — Flip via fork-side patches instead of codemod
Hand-edit each of the ~300 surfaces in `forks/ruflo`, commit upstream of the codemod.

**Rejected** per memory `feedback-patches-in-fork.md`: this IS a scope rename, the codemod's charter. Fork patches don't survive upstream merges; the same regression returns next sync.

### Option D — Bigger scope: also rebrand internals (Cat E + F)
Rewrite acceptance scripts, `_cli_cmd` helper, wrapper's own `package.json`, etc.

**Rejected**. Internal direct-cli invocation is intentional (perf, version-control, atomic fork-source assumptions). Rebranding internals would force the wrapper to depend on itself or break the parallel acceptance harness. The split is meaningful.

## Pre-flight findings (verified 2026-05-04)

Direct grep against `lib/acceptance-*.sh` (99 files total, 26 reference `@sparkleideas/cli`) found **all 78 non-path matches are either `node_modules/@sparkleideas/cli/...` path probes or error message strings like `"@sparkleideas/cli not installed in TEMP_DIR"`**. None assert against user-facing CLI output that would change after Pass 7. **Implication**: the "audit acceptance scripts" step in the original sketch is a verify-only no-op; no acceptance edits required.

This is the natural fallout from how internal/external use cleaves: acceptance scripts probe cli internals (the package itself isn't being renamed), while user-facing output probes were never grepping for the brand string in the first place.

Pass 7 scope summary (from §Decision):

| Source category | Approx hits | Pass 7 scope |
|---|---:|---|
| User-facing prose (README/USERGUIDE/install.sh) | ~40 | IN |
| Init-generated MCP config (`mcp-generator.ts`) | ~10 | IN |
| Init-printed help text (`executor.ts`) | ~50 | IN |
| Plugin/agent/skill markdown | ~200 | IN |
| Internal pipeline (`_cli_cmd`, codemod, lib/) | ~115 | OUT (ruflo-patch repo, not codemod input) |
| Wrapper's `package.json` dep | 1 | OUT (in ruflo-patch root) |

Net codemod surface: ~300 user-facing flips. All other refs untouched.

## Execution plan

Three-commit single PR, **after ADR-0142 closes**. Each commit independently passes `npm run test:unit`.

### Commit 1: tests-first (TDD-style — define expected behaviour before implementation)

File modified: `tests/pipeline/codemod.test.mjs`

New `describe('codemod: ADR-0143 Pass 7 — user-facing @sparkleideas/cli → @sparkleideas/ruflo')` block. All cases use `it.skip()` initially; unskipped in commit 2 atomically with the Pass 7 implementation (preserves green-on-every-commit per memory `feedback-fix-all-tests.md`).

**Positive cases**:
1. `npx @sparkleideas/cli@latest init` in `README.md` → rewrites to `npx @sparkleideas/ruflo@latest init`
2. `npx @sparkleideas/cli@latest doctor` in `scripts/install.sh` → rewrites
3. JSON args `["−y", "@sparkleideas/cli", "mcp", "start"]` in `v3/@claude-flow/cli/src/init/mcp-generator.ts` → rewrites the cli token (B2 decision)
4. `@sparkleideas/cli@3.5.0-patch.7` (semver pin) in skill markdown → rewrites
5. Bare `@sparkleideas/cli` (no version, no `@`) in user prose → rewrites
6. `@sparkleideas/cli` inside backticks in `.claude/agents/foo.md` → rewrites

**Negative cases**:
1. `@sparkleideas/cli-foo` (different package, trailing `-foo`) → unchanged
2. `@sparkleideas/clinical` (different package, trailing letters) → unchanged
3. `@sparkleideas/cli` in `docs/adr/**/*.md` (historical accuracy) → unchanged
4. `@sparkleideas/cli` in `forks/ruflo/v3/@claude-flow/memory/src/foo.ts` (internal cross-package) → unchanged
5. `@sparkleideas/cli` in `forks/ruflo/v3/@claude-flow/cli/__tests__/bar.test.ts` (cli's own tests) → unchanged

**Idempotency**: rewrite, then rewrite again — output identical.

After commit 1: all positive cases skipped; all negative cases pass (current codemod doesn't touch these). `npm run test:unit` green.

### Commit 2: implement Pass 7 + atomic test unskip

File modified: `scripts/codemod.mjs`

```diff
+// Pass 7 (ADR-0143, 2026-05-04): user-facing brand flip from
+// @sparkleideas/cli → @sparkleideas/ruflo. Path-scoped — only fires
+// in user-facing scopes (README/USERGUIDE/install.sh, init-emitted
+// strings, plugin/skill/agent markdown). Internal cross-package code
+// in v3/@claude-flow/<workspace>/src/** is explicitly NOT in scope —
+// the cli package itself isn't being renamed; only references to it
+// from places users see are.
+//
+// Lookbehind/lookahead protect against false-hits on
+// @sparkleideas/cli-foo or @sparkleideas/clinical.
+const SPARKLEIDEAS_CLI_RE = /(?<![\w-])@sparkleideas\/cli(?![\w-])/g;
+const PASS7_REPLACEMENT = '@sparkleideas/ruflo';
+
+// Pass 7 path scope. Mirrors Pass 5's predicate shape.
+const PASS7_USER_FACING_SUBDIRS = [
+  '.claude/skills/', '.claude/agents/', '.claude/commands/',
+  '.claude-plugin/', 'plugins/',
+];
+const PASS7_INIT_EMITTING_PREFIX = 'v3/@claude-flow/cli/src/init/';
+const PASS7_USER_DOC_FILES = new Set(['README.md', 'CHANGELOG.md', 'USERGUIDE.md']);
+
+export function isPlugin7Scope(filePath, tempDir) {
+  const rel = relative(tempDir, filePath).replace(/\\/g, '/');
+  if (rel.startsWith('..') || rel === '') return false;
+  // ADR-0143: never touch ADR archives (historical accuracy).
+  if (rel.startsWith('docs/adr/') || rel.includes('/docs/adr/')) return false;
+  if (rel.startsWith('v3/implementation/adrs/')) return false;
+  // Never touch cli's own tests or internal cross-package src.
+  if (rel.includes('__tests__/')) return false;
+  if (rel.startsWith('v3/@claude-flow/') && rel.includes('/src/') &&
+      !rel.startsWith('v3/@claude-flow/cli/src/init/')) return false;
+
+  // User-facing scopes:
+  const base = basename(filePath);
+  if (PASS7_USER_DOC_FILES.has(base)) return true;
+  if (rel === 'scripts/install.sh') return true;
+  if (rel.startsWith(PASS7_INIT_EMITTING_PREFIX)) return true;
+  for (const sub of PASS7_USER_FACING_SUBDIRS) {
+    if (rel.includes('/' + sub) || rel.startsWith(sub)) return true;
+  }
+  return false;
+}
+
+export function applyPass7(content) {
+  return content.replace(SPARKLEIDEAS_CLI_RE, PASS7_REPLACEMENT);
+}
```

Wire into `processOneFile`, after Pass 5/6:

```diff
   let transformed = transformSource(content);
   if (tempDir && isPlugin5Scope(filePath, tempDir)) {
     transformed = applyPass5(transformed);
   }
+  if (tempDir && isPlugin7Scope(filePath, tempDir)) {
+    transformed = applyPass7(transformed);
+  }
```

Update file-header pass count comment.

In `tests/pipeline/codemod.test.mjs`: change `it.skip(...)` → `it(...)` for all 6 positive cases.

After commit 2: all positive cases pass; all negative cases still pass; `npm run test:unit` green.

### Commit 3: full release verification + ADR closure

1. Run `npm run release` — full pipeline (preflight + unit + acceptance + Verdaccio publish)
2. **Post-release verification grep**:
   ```bash
   # User-facing scopes should have ZERO @sparkleideas/cli references after Pass 7
   grep -rE '@sparkleideas/cli([^-\w]|$)' \
     /tmp/ruflo-build/README.md /tmp/ruflo-build/scripts/install.sh \
     /tmp/ruflo-build/.claude/{skills,agents,commands}/ \
     /tmp/ruflo-build/v3/@claude-flow/cli/src/init/ \
     /tmp/ruflo-build/plugins/ /tmp/ruflo-build/.claude-plugin/ 2>/dev/null
   # Expected: 0 lines
   ```
   If any user-facing surface still contains `@sparkleideas/cli`, Pass 7 has a scope gap — fix in a follow-up
3. **Internal scopes still have refs** (sanity check that we didn't over-broaden):
   ```bash
   grep -rE '@sparkleideas/cli([^-\w]|$)' /tmp/ruflo-build/v3/@claude-flow/memory/ 2>/dev/null | wc -l
   # Expected: > 0 (these are internal cross-package refs, must stay)
   ```
4. **Automated smoke** (no manual steps — per project policy everything via build/deploy scripts):
   - `adr0142-bin-path` (G3) exercises `ruflo --version` end-to-end via fresh wrapper install
   - `adr0142-mcp-jsonrpc` (AC#10) exercises `ruflo mcp start` JSON-RPC initialize round-trip
   - `adr0143-init-mcp` (AC#5) exercises `ruflo init` and asserts the generated `.mcp.json` uses the wrapper-canonical path
   - All three run automatically in `npm run release`'s acceptance phase
5. **Update memory**: add `~/.claude/projects/-Users-henrik-source-ruflo-patch/memory/reference-user-facing-brand.md` noting the brand convention is now `@sparkleideas/ruflo` for user surfaces, `@sparkleideas/cli` only for internals
6. **Flip ADR-0143 Status to Accepted** in a follow-up doc commit

Commit 3 message documents: pre-release user-facing-scope hit count (~300), post-release count (0), MCP smoke result.

## Rollback plan

- **Commit 1 only landed**: tests skipped — no behaviour change. Safe indefinitely
- **Commits 1+2 landed**: codemod adds Pass 7. To revert, `git revert <commit-2>` removes the regex+predicate+wiring; tests in commit 1 stay (re-skip them)
- **Full landed, regression discovered**: `git revert <commit-2>` is sufficient. Commit 3 is verification-only — nothing to revert
- **MCP option B2 turns out flaky** (wrapper-startup bug crashes MCP): in-place codemod tweak — change `PASS7_USER_FACING_SUBDIRS` to exclude `v3/@claude-flow/cli/src/init/mcp-generator.ts` specifically, falling back to B1 (MCP keeps pointing at cli direct). One-line revert; documented as fallback in §Alternatives §Option B1

## Reference

- Wrapper-architecture prerequisite: ADR-0142 (must close first)
- Original brand-rebrand effort (narrowly scoped due to wrapper cost): ADR-0117
- Sister codemod passes for path-scoped rewrites: ADR-0141 (Pass 5 generalization), commit `8aba0ad` (Pass 6 — npx ruflo)
- Pre-flight survey: 2026-05-04, see §"Pre-flight findings" above

## Reference

- Wrapper-architecture prerequisite: ADR-0142 (must close first)
- Original brand-rebrand effort (narrowly scoped due to wrapper cost): ADR-0117
- Sister codemod passes for path-scoped rewrites: ADR-0141 (Pass 5 generalization), commit `8aba0ad` (Pass 6 — npx ruflo)
- Upstream brand convention reference: `/Users/henrik/source/ruvnet/ruflo/{README.md,docs/USERGUIDE.md}` — `npx ruflo@latest` is the primary user-facing pattern
- `_cli_cmd` helper: per memory `reference-cli-cmd-helper.md` — Cat E reason for staying on direct `@sparkleideas/cli`
- Memory entries informing this decision: `feedback-patches-in-fork.md` (codemod is the charter), `feedback-no-upstream-donate-backs.md` (fork stays fork), `reference-cli-cmd-helper.md` (internal direct-cli invocation is load-bearing)
