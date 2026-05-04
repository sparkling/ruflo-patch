# ADR-0141: Generalize codemod Pass 5 — broaden tag filter + path scope for `claude-flow@<ver>` rewrite

- **Status**: **Proposed (2026-05-04)**
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

## Implementation plan

Single PR (or single commit), staged as:

1. **Update `scripts/codemod.mjs`**:
   - Replace `CLAUDE_FLOW_ALPHA_RE` with `CLAUDE_FLOW_VERSIONED_RE` (rename for clarity)
   - Extend `isPlugin5Scope()` predicate with the 3 new path patterns
   - Update Pass 5 comment block to reflect the broadened scope
2. **Add tests** to `tests/pipeline/codemod.test.mjs` (under existing `describe('codemod: ADR-0117 Pass 5 …')` block):
   - 3 positive cases (one per new path pattern; one per new tag form)
   - 2 negative cases (ADR archive immutability; word-boundary)
3. **Run `npm run test:unit`** — must show 174→181 (or similar) passing pipeline tests, no new unit failures
4. **Run `npm run release`** — verify the build's `/tmp/ruflo-build/` shows zero gap-pattern hits in the new scope
5. **Commit** with message `fix(codemod): generalize Pass 5 — broader tags + path scope (ADR-0141)`

No fork-side changes, no acceptance-script additions (the existing `lib/acceptance-adr0117-marketplace-mcp.sh` already validates the published artifact contains zero offending tokens; broadening Pass 5 just reduces the fork-source population it has to validate against).

## Reference

- Original Pass 5: `scripts/codemod.mjs:228-269` (`CLAUDE_FLOW_ALPHA_RE`, `isPlugin5Scope`, `applyPass5`)
- Pass 5 tests: `tests/pipeline/codemod.test.mjs:735-980` (the entire `describe('codemod: ADR-0117 Pass 5 …')` block — extend in place, don't fork)
- Pass 6 (analog prior art): commit `8aba0ad`, `scripts/codemod.mjs:228-256` (`NPX_RUFLO_RE`, `NPX_ARGS_RUFLO_RE`)
- Survey output: see chat 2026-05-04 — *"Pass 5 already covers these scopes (will be rewritten on next release): 215; Pass 5 gap (NOT in scope; would still ship broken): 125 files"*
