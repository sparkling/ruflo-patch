# ADR-0141: Generalize codemod Pass 5 — broaden tag filter + path scope for `claude-flow@<ver>` rewrite

- **Status**: **Accepted (2026-05-04)** — implemented across 3 commits (`25aa5e5` tests-first + `558efb9` Pass 5 generalization impl + commit 3 release verification below). Combined with ADR-0143 Pass 7, all 348 surveyed hits in expanded scope eliminated. Highest-density file (verification-quality SKILL.md, 73 hits) now shows 0 `claude-flow@` + 73 `@sparkleideas/ruflo@` refs (full chain Pass 1 → Pass 5 → Pass 7 fired).
- **Date**: 2026-05-04
- **Deciders**: Henrik Pettersen
- **Related**: ADR-0117 (the original Pass 5 — `claude-flow@alpha` rewrite, scope-limited to `.claude-plugin/**` + `plugins/**` + `v3/@claude-flow/cli/.claude/{agents,commands,skills}/**`), commit `8aba0ad` on ruflo-patch (Pass 6 — `npx ruflo` rewrite, the `ruflo`-side analog of this gap; closed 2026-05-04 after a Verdaccio 404 on `GET /ruflo`)
- **Scope**: `scripts/codemod.mjs` Pass 5 only — broadens the regex tag filter and the path scope predicate. Does not touch any other codemod pass and does not patch fork source.

## Context

ADR-0117's Pass 5 rewrites `claude-flow@alpha` → `@sparkleideas/cli@latest` in marketplace + init-bundled trees. Its narrow scope was deliberate: avoid mutating historical ADR prose or upstream-source comments that legitimately reference the upstream tag.

Two surveys taken on 2026-05-04 against `forks/ruflo` revealed Pass 5 leaves 207 live `claude-flow@<ver>` tokens unrewritten in 125 files, all of which **ship to users**:

### Tag-filter gap

Pass 5's regex is `/claude-flow@alpha/g`. It does not match:

- `npx claude-flow@latest federation init` (5 hits in upstream README, inherited by fork)
- `claude-flow@2.x` / `claude-flow@1.5.13` (numeric semver pins)

When these surfaces ship to Verdaccio (which only hosts `@sparkleideas/cli`, not bare `claude-flow`), `npx` 404s — the same failure mode that motivated Pass 6 on the `ruflo` side.

### Path-scope gap

Pass 5 fires only inside `.claude-plugin/**`, `plugins/**`, and `v3/@claude-flow/cli/.claude/{agents,commands,skills}/**`. The 125-file gap concentrates in:

| Path pattern | Hit-density rationale |
|---|---|
| `v3/@claude-flow/mcp/.claude/skills/**/*.md` | **Sister tree** to `v3/@claude-flow/cli/.claude/skills/**` — same shipped templates, wrong workspace, missed by Pass 5 |
| `forks/ruflo/.claude/skills/**/*.md` | **Fork-root duplicate** of the same skill files (e.g. `verification-quality/SKILL.md` exists in both locations, 73 hits each) |
| `forks/ruflo/.claude/agents/**/*.md` | Fork-root agent templates (analyst, sona-learning-optimizer, sparc/*, etc.) |
| `forks/ruflo/.claude/commands/**/*.md` | Fork-root command templates (sparc/*, claude-flow-help.md, etc.) — these get copied into user `.claude/` on `init --full` |

Top hot spots:

| File | Hits |
|---|---:|
| `v3/@claude-flow/mcp/.claude/skills/verification-quality/SKILL.md` | 73 |
| `.claude/skills/verification-quality/SKILL.md` | 73 (duplicate of above) |
| `v3/@claude-flow/mcp/.claude/skills/github-release-management/SKILL.md` | 13 |
| `.claude/skills/github-release-management/SKILL.md` | 13 (duplicate) |
| `v3/@claude-flow/mcp/.claude/skills/github-workflow-automation/SKILL.md` | 12 |
| `v3/@claude-flow/codex/README.md` | 10 |
| Plus 119 more files | — |

### Why this matters now

Pass 6 (commit `8aba0ad`) closed the analogous `ruflo`-side gap by recognising that "anchored on `npx`" makes false-hit risk effectively zero. The same logic applies to `claude-flow@<ver>` — the `@<ver>` suffix itself is the anchor; literal `claude-flow@latest` only appears as a package reference, never as prose.

Per memory `feedback-data-loss-zero-tolerance.md` and the user's stated preference ("Zero failures is the only acceptable outcome"), shipping 207 broken commands is unacceptable when the codemod is the right enforcement layer.

## Decision

Generalize Pass 5 along two orthogonal axes. Both ship together as a single codemod change.

### Axis 1 — Tag filter broadening

Replace the literal `/claude-flow@alpha/g` with a tag-aware regex:

```js
const CLAUDE_FLOW_VERSIONED_RE = /\bclaude-flow@(alpha|latest|beta|next|[\d][\w.\-+]*)\b/g;
```

- **`alpha|latest|beta|next`** — npm dist-tag whitelist; explicit list (not `[a-z]+`) to avoid matching arbitrary strings like `claude-flow@example` in prose
- **`[\d][\w.\-+]*`** — semver: starts with digit (`1.5.13`, `2.0.0-rc.1`, `0.1.0+build`), forbids leading-letter to avoid catching `@somenamespace`
- **`\b` word boundaries** — avoid mid-word false-hits like `subclaude-flow@alpha`

Replacement remains `@sparkleideas/cli@latest` for all matches — the fork pins `@latest` regardless of upstream tag, deferring to Verdaccio's promote-to-latest invariant for actual version selection.

### Axis 2 — Path scope expansion

Extend `isPlugin5Scope()` to additionally match:

```
**/.claude/skills/**/*.{md,json}
**/.claude/agents/**/*.{md,json}
**/.claude/commands/**/*.{md,json}
```

The `**/` prefix is deliberate — a single predicate that covers:
- `forks/ruflo/.claude/{skills,agents,commands}/**` (fork-root templates)
- `forks/ruflo/v3/@claude-flow/cli/.claude/{skills,agents,commands}/**` (init-bundled, already in Pass 5)
- `forks/ruflo/v3/@claude-flow/mcp/.claude/{skills,agents,commands}/**` (mcp workspace duplicate)
- Any future `v3/@claude-flow/<other>/.claude/...` workspace that adds skill/agent/command markdown

Existing `.claude-plugin/**` and `plugins/**` scopes are kept verbatim — no behavior change for already-covered files.

### What stays out of scope

| Surface | Why excluded |
|---|---|
| `docs/adr/**` | Historical ADR prose may legitimately discuss `claude-flow@alpha` as a brand reference; per ADR-0117 §negative-test, must remain immutable |
| `v3/implementation/adrs/**` (in fork) | Same reason — fork-side ADR archive |
| `v3/@claude-flow/codex/README.md` | Package README; rewriting it changes the npm-rendered description in a way that may surprise users. Re-evaluate separately if/when we ship a fork README override |
| Bare `claude-flow` brand mentions (no `@<ver>`) | Out of scope — these are 3.1k brand prose mentions, not package references; addressed (or not) by separate brand-rebrand work |
| `npx claude-flow` shellouts without `@<ver>` | Subset of broader `npx <pkg>` pattern; defer to a Pass-6-equivalent for `claude-flow` if/when needed (currently uncovered, acknowledged debt) |

## Consequences

### Positive

- **~200 of 207 broken commands fixed** in a single codemod change
- **Future upstream merges auto-protected** — any new `claude-flow@latest` introduced by an upstream sync gets rewritten on next `npm run release`
- **No fork patches required** — pure codemod change, fork source stays untouched
- **No new test suite** — extends existing Pass-5 test set with new positive/negative cases under the same `describe` block

### Negative

- **Tag whitelist needs maintenance** if npm introduces new dist-tags (e.g. `canary`); easy to extend
- **Sister-tree duplication remains** — `forks/ruflo/.claude/skills/verification-quality/SKILL.md` and `v3/@claude-flow/mcp/.claude/skills/verification-quality/SKILL.md` are byte-identical; we rewrite both rather than dedupe at source. Dedup is a separate concern (out of scope per ADR-0117 ethos)

### Acceptance criteria

1. `tests/pipeline/codemod.test.mjs` adds:
   - Positive: `claude-flow@latest` rewrites in `.claude/skills/foo/SKILL.md`
   - Positive: `claude-flow@2.0.0-rc.1` rewrites (semver)
   - Positive: rewrites in `v3/@claude-flow/mcp/.claude/skills/**`
   - Negative: `claude-flow@alpha` in `docs/adr/**` still passes through
   - Negative: bare `claude-flow` (no `@`) untouched
   - Negative: `subclaude-flow@latest` (word-boundary) untouched
2. After running `npm run release`, `grep -rE 'claude-flow@(alpha|latest|beta|next|[0-9])'` against `/tmp/ruflo-build/` outside the negative-scope dirs returns 0 hits
3. `npm run test:unit` passes (codemod is product code per `tests/CLAUDE.md`)

## Alternatives considered

### Option A — Mirror Pass 6's "no path scoping" approach

Drop path scoping entirely, rely on the `@<ver>` anchor as the false-hit guard.

**Rejected** because Pass 5's path scope serves a real purpose Pass 6's doesn't: ADR archives DO contain literal `claude-flow@alpha` prose for historical accuracy (verified in `docs/adr/ADR-0117-marketplace-mcp-server-registration.md` and the existing Pass-5 negative test). Pass 6's regex anchors on `npx` which is also command-shape; Pass 5's regex anchors on `@<ver>` which can validly appear in prose.

### Option B — Patch each file in fork source

Hand-edit the 125 files in `forks/ruflo`, commit upstream of the codemod.

**Rejected** per memory `feedback-patches-in-fork.md` interpretation: this IS a scope rename (just outside import/require contexts), so the codemod is the right charter. Plus: fork patches don't survive upstream merges — the same regression returns next time we pull.

### Option C — Skip generalization; accept the gap

Leave Pass 5 as-is; users hit 404s when running shipped commands.

**Rejected** per memory `feedback-data-loss-zero-tolerance.md` ("Zero tolerance for silent data loss") and the user's audit prompt specifically calling out the gap. A 207-hit broken command surface is not "acceptable rate of loss".

## Pre-flight findings (verified 2026-05-04)

Direct grep against `forks/ruflo` confirmed the gap:

| Proposed-scope dir | Hit count |
|---|---:|
| `v3/@claude-flow/mcp/.claude/skills/**` | 107 |
| `.claude/skills/**` (fork-root duplicate) | 108 |
| `v3/@claude-flow/mcp/.claude/agents/**` | 59 |
| `.claude/commands/**` | 34 |
| `v3/@claude-flow/mcp/.claude/commands/**` | 33 |
| `.claude/agents/**` | 7 |
| **Total in proposed scope** | **348** |

Tag distribution across these 348 hits: **346 are `claude-flow@alpha`**, only 2 are `claude-flow@latest`. **Implication**: path-scope expansion is the dominant axis (~99% of hits); tag broadening is cheap insurance against future upstream tag-style changes but hits almost nothing today.

Earlier estimate of "207 hits in 125 files" was an undercount — actual gap is ~348 hits. ADR Acceptance Criteria #2 still applies: post-release, grep for residual `claude-flow@<ver>` in the new scope must return 0.

## Execution plan

Three-commit single PR. Each commit independently passes `npm run test:unit`.

### Commit 1: tests-first (TDD-style — guards before behaviour)

File modified: `tests/pipeline/codemod.test.mjs`

Add new cases under existing `describe('codemod: ADR-0117 Pass 5 — claude-flow@alpha in marketplace surfaces')` block (or new sibling `describe('codemod: ADR-0141 Pass 5 generalization …')`):

**Positive cases** (will fail before commit 2; pass after):
1. `claude-flow@alpha` in `v3/@claude-flow/mcp/.claude/skills/foo/SKILL.md` → rewrites to `@sparkleideas/cli@latest`
2. `claude-flow@latest` in `.claude/skills/bar/SKILL.md` (fork-root dup) → rewrites
3. `claude-flow@2.0.0-rc.1` in `.claude/agents/baz.md` (semver) → rewrites
4. `claude-flow@1.5.13` (numeric semver) → rewrites
5. `claude-flow@beta` and `claude-flow@next` (other dist-tags) → rewrite

**Negative cases** (must continue to pass before AND after commit 2):
1. `claude-flow@alpha` in `docs/adr/**/*.md` → unchanged (historical accuracy)
2. `claude-flow@alpha` in `v3/implementation/adrs/**/*.md` → unchanged
3. `subclaude-flow@latest` (word boundary — leading char) → unchanged
4. `claude-flow@example` (non-whitelisted tag, non-numeric) → unchanged
5. Bare `claude-flow` (no `@<ver>`) → unchanged

**Idempotency**: rewrite, then rewrite again — output identical.

After commit 1: 5 positive cases fail (regex doesn't match yet), all negative cases pass. Run `npm run test:unit` — expect 5 failures; document them in commit message as "regression-style guard tests, will go green in commit 2".

Note: this deliberately violates the "tests must pass before commit" preference for this single commit, but signals intent clearly. Alternative: skip the positive cases with `it.skip()` in commit 1 and unskip in commit 2. **Pick the unskip approach** to keep `npm run test:unit` green throughout.

### Commit 2: implement Pass 5 generalization

File modified: `scripts/codemod.mjs`

```diff
-const CLAUDE_FLOW_ALPHA_RE = /claude-flow@alpha/g;
-const PASS5_REPLACEMENT = '@sparkleideas/cli@latest';
+// ADR-0141: broaden Pass 5 to match all dist-tags + numeric semver.
+// Whitelist (alpha|latest|beta|next) chosen to avoid matching prose
+// like `claude-flow@example`. Numeric branch ([\d][\w.\-+]*) catches
+// semver pins. \b word boundaries prevent mid-word false-hits.
+const CLAUDE_FLOW_VERSIONED_RE = /\bclaude-flow@(alpha|latest|beta|next|[\d][\w.\-+]*)\b/g;
+const PASS5_REPLACEMENT = '@sparkleideas/cli@latest';
```

Update `isPlugin5Scope()`:

```diff
 const PASS5_INIT_BUNDLED_PREFIX = 'v3/@claude-flow/cli/.claude/';
 const PASS5_INIT_BUNDLED_SUBDIRS = ['agents/', 'commands/', 'skills/'];
+
+// ADR-0141: extend scope to sister mcp workspace + fork-root duplicates.
+// Single `**/.claude/{skills,agents,commands}/**` predicate catches:
+//   - v3/@claude-flow/mcp/.claude/{skills,agents,commands}/**
+//   - forks/ruflo/.claude/{skills,agents,commands}/**
+//   - any future v3/@claude-flow/<workspace>/.claude/... addition
+const PASS5_CLAUDE_DOT_SUBDIRS = ['.claude/skills/', '.claude/agents/', '.claude/commands/'];

 export function isPlugin5Scope(filePath, tempDir) {
   const rel = relative(tempDir, filePath).replace(/\\/g, '/');
   if (rel.startsWith('..') || rel === '') return false;
   const ext = effectiveExt(basename(filePath));
   if (ext !== '.json' && ext !== '.md') return false;
   if (rel.startsWith('.claude-plugin/') || rel.startsWith('plugins/')) return true;
   if (rel.startsWith(PASS5_INIT_BUNDLED_PREFIX)) {
     const sub = rel.slice(PASS5_INIT_BUNDLED_PREFIX.length);
     return PASS5_INIT_BUNDLED_SUBDIRS.some((d) => sub.startsWith(d));
   }
+  // ADR-0141: any path containing /.claude/{skills,agents,commands}/
+  // qualifies, regardless of which workspace it lives in.
+  for (const sub of PASS5_CLAUDE_DOT_SUBDIRS) {
+    if (rel.includes('/' + sub) || rel.startsWith(sub)) return true;
+  }
   return false;
 }
```

Update `applyPass5`:

```diff
 export function applyPass5(content) {
-  return content.replace(CLAUDE_FLOW_ALPHA_RE, PASS5_REPLACEMENT);
+  return content.replace(CLAUDE_FLOW_VERSIONED_RE, PASS5_REPLACEMENT);
 }
```

Update Pass 5 file-header comment to reflect broadened scope.

After commit 2: all 5 previously-skipped positive tests pass; all negative tests still pass. `npm run test:unit` green.

### Commit 3: full release verification

1. Run `npm run release` — full pipeline (preflight + unit + acceptance + Verdaccio publish + acceptance against published)
2. Post-release verification grep:
   ```bash
   grep -rE 'claude-flow@(alpha|latest|beta|next|[0-9])' /tmp/ruflo-build/v3/@claude-flow/mcp/.claude/ /tmp/ruflo-build/.claude/{skills,agents,commands}/ 2>/dev/null
   ```
   Expected: zero hits
3. Confirm acceptance script `lib/acceptance-adr0117-marketplace-mcp.sh` (which validates published artifact has no `claude-flow@<ver>` tokens) still passes
4. Commit message documents: pre-release hit count (348), post-release hit count (0), zero new test failures

After commit 3: ADR-0141 closes — flip Status to Accepted in a follow-up doc commit.

## Rollback plan

- **Commit 1 only landed**: tests with `it.skip()` — no behaviour change, no impact
- **Commits 1+2 landed**: codemod broadened. To revert, `git revert <commit-2>` restores `/claude-flow@alpha/g` regex + narrow scope. Tests in commit 1 stay (re-skipped or removed)
- **All landed, regression discovered**: `git revert <commit-2>` is sufficient; commits 1 and 3 are harmless without 2

## Reference

- Original Pass 5: `scripts/codemod.mjs:245-269` post-Pass-6 (`CLAUDE_FLOW_ALPHA_RE`, `isPlugin5Scope`, `applyPass5`)
- Pass 5 tests: `tests/pipeline/codemod.test.mjs:735-1029` (existing `describe('codemod: ADR-0117 Pass 5 …')` block — extend in place)
- Pass 6 (analog prior art): commit `8aba0ad`, `scripts/codemod.mjs:228-256` (`NPX_RUFLO_RE`, `NPX_ARGS_RUFLO_RE`)
- Pre-flight survey: 2026-05-04, see §"Pre-flight findings" above
