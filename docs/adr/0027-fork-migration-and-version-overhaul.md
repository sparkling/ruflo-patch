# ADR-0027: Fork Migration and Version Overhaul

- **Status**: Proposed
- **Date**: 2026-03-08
- **Deciders**: ruflo-patch maintainers
- **Methodology**: SPARC + MADR

## Decision Drivers

- 6 active patches target compiled JS via string matching — silent failures when upstream changes patched files (3-6h/month maintenance)
- Upstream declares unresolvable dependency ranges — `@ruvector/ruvllm: "^0.2.3"` (actual: `2.5.2`), `ruvector: "^0.1.85"` (actual: `0.2.11`), `flow-nexus: "^1.0.0"` (actual: `0.1.128`), `agentdb: "2.0.0-alpha.3.7"` (nonexistent)
- Tag-to-HEAD drift: ruflo has 933 unpublished commits, agentic-flow 540 — dep ranges written for tag-time code don't match HEAD
- `"*"` wildcard replacement and `bumpLastSegment` versioning are workarounds that obscure the actual version relationship to upstream
- Patch system requires understanding 15-phase pipeline, compiled JS string matching, and 7 config files — high cognitive load for contributors

## Context and Problem Statement

### Specification (SPARC-S)

ruflo-patch repackages 3 upstream repos (ruflo, agentic-flow, ruv-FANN) as 24+ `@sparkleideas/*` npm packages. The current model clones upstream → codemods scope names → compiles TypeScript → patches compiled JS → publishes. This pipeline has accumulated 26 ADRs, 17 pipeline scripts, and 110 commits of infrastructure to work around fundamental fragility in the patch-compiled-JS approach.

**Current system inventory**:

| Metric | Value |
|--------|-------|
| Upstream repos | 3 (ruflo, agentic-flow, ruv-FANN) |
| Published packages | 24+ (`@sparkleideas/*`) |
| Active patches | 6 (targeting compiled JS) |
| Broken external dep ranges | 7 (across ruflo and agentic-flow) |
| Pipeline phases | 15 |
| Files with `@claude-flow/` in upstream | 380 |
| Upstream ruflo commits since last tag | 933 |

**External dependencies** (not forked, consumed from npm as-is):

| Package(s) | Source repo | Why not fork |
|------------|------------|-------------|
| `@ruvector/*` (14+ pkgs) | `ruvnet/ruvector` | ~50 packages, NAPI-RS/Rust/WASM build complexity |
| `flow-nexus` | `ruvnet/flow-nexus` | Source not public (GitHub repo is docs only) |
| `agentic-payments` | `agentic-catalog/agentic-payments` | Independent package, no issues |
| `ruvector` (unscoped) | `ruvnet/ruvector` | Same as `@ruvector/*` |

### Pseudocode (SPARC-P)

**Before** (current model):
```
every 6h:
  clone upstream → codemod scope rename → compile TypeScript
  → patch compiled JS (string matching, fragile)
  → version = bumpLastSegment(max(upstream, lastPublished))
  → replace all internal dep ranges with "*"
  → publish → test → promote
```

**After** (fork model):
```
every 6h:
  STAGE 3: check for merged PRs (SHA comparison)
    if new merges on main:
      version bump (fork-version.mjs) → tag → push
      codemod → build → Verdaccio L0-L3
      if pass: npm publish --tag prerelease → L4 → promote
  STAGE 1: check for upstream changes (SHA comparison)
    if new upstream commits:
      branch → merge → tsc --noEmit → codemod → build → Verdaccio L0-L3
      if pass: create PR (label: ready)
      if fail: create PR (label: conflict|compile-error|test-failure)
  manual: operator reviews PR → merges to main
```

### Considered Options

**Option A: Keep current model (build-time transform)**
- Continue patching compiled JS, `"*"` wildcards, `bumpLastSegment`
- Pro: No migration effort
- Con: 5-12h/month maintenance, silent failures, high cognitive load, fragile string matching

**Option B: Fork all repos, keep codemod for scope rename** (chosen)
- Fork ruflo, agentic-flow, ruv-FANN under `sparkling` GitHub account
- Apply patches to TypeScript source in forks (type-checked, compiler-validated)
- Fix dependency ranges directly in fork `package.json` files
- Use `{upstream}-patch.N` versioning with exact pinned deps
- Codemod still renames `@claude-flow/*` → `@sparkleideas/*` at build time
- Automate upstream sync with branch + PR gate
- Pro: Patches are type-checked, IDE-navigable, compiler-validated
- Pro: No merge conflicts from scope rename (stays `@claude-flow/` in fork)
- Pro: Eliminates patch infrastructure (6 scripts, 8 dirs, 3 test files)
- Pro: Standard git workflow — contributors productive in hours vs days
- Con: 2-3 day migration effort
- Con: Merge conflicts on upstream sync (estimated 1-4/week, mostly auto-resolvable)

**Option C: Fork all repos, rename scope in fork source**
- Apply scope rename directly in fork files (not via codemod)
- Con: 380+ file conflicts on every upstream sync — rejected

**Option D: Patch TypeScript source pre-compilation (no fork)**
- Patch `.ts` files instead of compiled `.js` in current pipeline
- Pro: More readable patches
- Con: Still fragile string matching, same pipeline complexity — rejected

## Decision

### Architecture (SPARC-A)

**Option B**: Fork all 3 repos, keep codemod for scope rename.

```
GitHub (sparkling account)
  sparkling/ruflo         ← fork of ruvnet/ruflo
  sparkling/agentic-flow  ← fork of ruvnet/agentic-flow
  sparkling/ruv-FANN      ← fork of ruvnet/ruv-FANN
     Patches applied to TypeScript source on main
     Scope stays @claude-flow/* (codemod renames at build time)
     Dep ranges fixed in fork package.json files

This server (systemd timer, every 6h) — sync-and-build.sh
  ~/src/forks/{ruflo,agentic-flow,ruv-FANN}

  STAGE 1 — Sync + test (automatic)
    For each fork: fetch upstream → merge on branch → compile check
    Then: codemod → build → Verdaccio tests (L0-L3)
    If pass: push branch, create PR with test results, email
    If fail: push branch, create PR with failure label, email

  STAGE 2 — Review (manual)
    Operator reviews PR on GitHub → merges to main

  STAGE 3 — Publish (automatic, on detecting merge to main)
    Version bump (fork-version.mjs) → commit → tag → push
    Re-test on main (L0-L3 against Verdaccio)
    Publish to npm --tag prerelease
    L4 acceptance tests → if pass: promote to @latest
    Email notification
```

**Key design decisions**:

1. **Forks keep `@claude-flow/` scope** — zero merge conflicts from scope rename. Codemod transforms at build time.
2. **Patches in TypeScript source** — type-checked, IDE-navigable. Silent failures become compile errors.
3. **All automation on this server** — Verdaccio, build tools, npm credentials, systemd timer are all here. Forks on GitHub are pushed to for PRs, review, and audit trail.
4. **Versions and deps live in the fork** — fork `package.json` files contain exact `-patch.N` versions and exact pinned dep versions. No version computation or dep rewriting at publish time.
5. **`{upstream}-patch.N` versioning** — base = upstream `version` field. `-patch.N` suffix increments per publish, resets when upstream bumps. Unambiguous for all formats including `-alpha`, `-alpha.N`, `-rc.N`.
6. **Don't fork ruvector** — ~50 packages, NAPI-RS/Rust/WASM build complexity. Consumed from npm as-is. Same for `flow-nexus` (source not public) and `agentic-payments`.
7. **Branch + PR gate** — nothing merges to fork `main` or publishes to npm without manual approval. Version bump happens post-merge (Stage 3), not pre-merge, so versions are never stale.

**Version scheme**:

```
Upstream X.Y.Z       → fork publishes X.Y.Z-patch.1, X.Y.Z-patch.2, ...
Upstream X.Y.W       → reset to X.Y.W-patch.1
3.0.0-alpha.6        → 3.0.0-alpha.6-patch.1, ...
3.0.0-alpha          → 3.0.0-alpha-patch.1, ...
```

**Patch tracking**: GitHub Issues labeled `patch` in each fork repo, replacing the `patch/` directory structure.

**CI/CD flowchart**:

```
╔═══════════════════════════════════════════════════════════════╗
║  STAGE 1 — Sync + Test  (automatic, systemd timer every 6h)  ║
╠═══════════════════════════════════════════════════════════════╣
║                                                               ║
║   ┌────────────┐   ┌──────────────┐   ┌────────────┐         ║
║   │   ruflo    │   │ agentic-flow │   │  ruv-FANN  │         ║
║   └─────┬──────┘   └──────┬───────┘   └─────┬──────┘         ║
║         └─────────────────┼──────────────────┘                ║
║                           ▼                                   ║
║              ┌─────────────────────┐                          ║
║              │ git fetch upstream  │                          ║
║              │ branch + merge      │                          ║
║              └──────────┬──────────┘                          ║
║                         │                                     ║
║                    conflict?                                  ║
║                    ╱        ╲                                  ║
║                 yes          no                               ║
║                  ▼            ▼                               ║
║           ┌───────────┐  ┌─────────────┐                      ║
║           │ PR:       │  │ tsc --noEmit │                      ║
║           │ conflict  │  └──────┬──────┘                      ║
║           │ + email   │         │                              ║
║           │ → STOP    │    compile ok?                         ║
║           └───────────┘    ╱        ╲                          ║
║                         yes          no                       ║
║                          ▼            ▼                       ║
║               ┌──────────────┐  ┌──────────────┐              ║
║               │ Codemod      │  │ PR:          │              ║
║               │ + Build      │  │ compile-error│              ║
║               └──────┬───────┘  │ + email      │              ║
║                      ▼          │ → STOP       │              ║
║               ┌──────────────┐  └──────────────┘              ║
║               │ Verdaccio    │                                ║
║               │ + L0-L3      │                                ║
║               └──────┬───────┘                                ║
║                      │                                        ║
║                 tests pass?                                   ║
║                 ╱         ╲                                    ║
║              yes           no                                 ║
║               ▼             ▼                                 ║
║        ┌───────────┐  ┌──────────────┐                        ║
║        │ PR: ready │  │ PR:          │                        ║
║        │ + email   │  │ test-failure │                        ║
║        └─────┬─────┘  │ + email     │                        ║
║              │        │ → STOP      │                        ║
║              │        └──────────────┘                        ║
╚══════════════╪════════════════════════════════════════════════╝
               │
               ▼
╔══════════════════════════════════════════════════════════════╗
║  STAGE 2 — Review  (manual)                                  ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║        ┌──────────────────────────┐                          ║
║        │ Operator reviews PR     │                          ║
║        │ on GitHub → merge main  │                          ║
║        └────────────┬─────────────┘                          ║
║                     │                                        ║
╚═════════════════════╪════════════════════════════════════════╝
                      │
                      ▼
╔══════════════════════════════════════════════════════════════╗
║  STAGE 3 — Publish  (automatic, on merge to main)            ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║        ┌──────────────────────────┐                          ║
║        │ fork-version.mjs bump   │                          ║
║        │ commit + tag + push     │                          ║
║        └────────────┬─────────────┘                          ║
║                     ▼                                        ║
║        ┌──────────────────────────┐                          ║
║        │ Codemod + Build         │                          ║
║        │ Verdaccio + L0-L3       │                          ║
║        └────────────┬─────────────┘                          ║
║                     │                                        ║
║                tests pass?                                   ║
║                ╱         ╲                                    ║
║             yes           no                                 ║
║              ▼             ▼                                 ║
║   ┌──────────────┐  ┌──────────────┐                         ║
║   │ npm publish  │  │ Email        │                         ║
║   │ --tag        │  │ → STOP       │                         ║
║   │ prerelease   │  │ (nothing on  │                         ║
║   └──────┬───────┘  │  npm)        │                         ║
║          ▼          └──────────────┘                         ║
║   ┌──────────────┐                                           ║
║   │ L4 acceptance│                                           ║
║   │ tests (live) │                                           ║
║   └──────┬───────┘                                           ║
║          │                                                   ║
║     tests pass?                                              ║
║     ╱         ╲                                               ║
║  yes           no                                            ║
║   ▼             ▼                                            ║
║  ┌───────────┐  ┌──────────────┐                              ║
║  │ Promote   │  │ Stays on     │                              ║
║  │ to        │  │ prerelease   │                              ║
║  │ @latest   │  │ + email      │                              ║
║  │ + email   │  └──────────────┘                              ║
║  └───────────┘                                                ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
```

**Patch change flow** (manual trigger, feeds into Stages 2+3):

```
Edit TypeScript in fork → tsc --noEmit → branch patch/ID → commit
→ npm run deploy:dry-run (L0-L3) → create PR + GitHub Issue (label: patch)
→ Stage 2 (review) → Stage 3 (publish)
```

**Timer run order**: Stage 3 first (publish already-reviewed code), then Stage 1 (sync new upstream).

**Branch naming**: `sync/upstream-YYYYMMDDTHHmmss` (includes hours/minutes/seconds to avoid collisions on multiple daily syncs).

**Manual trigger commands** (npm scripts in ruflo-patch):

| Command | What it does |
|---------|-------------|
| `npm run sync` | Stage 1 only — fetch upstream, merge on branch, test, create PR |
| `npm run publish:fork` | Stage 3 only — detect merged PRs, version bump, build, publish |
| `npm run deploy` | Full pipeline — Stage 3 then Stage 1 |
| `npm run deploy:dry-run` | Full pipeline, stop before npm publish |

### Refinement (SPARC-R)

**Behavioral patches to port** (all in ruflo fork):

| Patch | Files |
|-------|-------|
| MC-001 (MCP autostart) | `v3/@claude-flow/cli/src/init/mcp-generator.ts` |
| FB-001 (fallback instrumentation, 8 ops) | `v3/@claude-flow/cli/src/memory/memory-initializer.ts`, `v3/@claude-flow/integration/src/agentic-flow-bridge.ts`, `v3/@claude-flow/cli/src/mcp-tools/embeddings-tools.ts` |
| FB-002 (local helper instrumentation, 16 ops) | `v3/@claude-flow/cli/src/init/helpers-generator.ts` |
| FB-004 (search threshold 0.3→0.1) | `v3/@claude-flow/cli/src/memory/memory-initializer.ts` |
| SG-003 (init helpers) | `v3/@claude-flow/cli/src/commands/init.ts`, `v3/@claude-flow/cli/src/init/executor.ts` |

**Do not port** (retired): FB-001-05, FB-001-06, FB-004a — target `memory-bridge.ts` absent from upstream HEAD.

**Dependency fixes** (in fork `package.json` files):

| Problem | Fork | File | Fix |
|---------|------|------|-----|
| `@ruvector/ruvllm: "^0.2.3"` (actual: 2.5.2) | ruflo | `v3/@claude-flow/providers/package.json` | `"^2.5.1"` |
| `@ruvector/ruvllm: "^0.2.3"` | agentic-flow | `package.json` | `"^2.5.1"` |
| `@ruvector/ruvllm: "^0.2.4"` | agentic-flow | `agentic-flow/package.json` | `"^2.5.1"` |
| `ruvector: "^0.1.85"` (actual: 0.2.11) | agentic-flow | `agentic-flow/package.json` | `"^0.2.0"` |
| `flow-nexus: "^1.0.0"` (actual: 0.1.128) | agentic-flow | `package.json` | `"^0.1.128"` |
| `agentdb: "2.0.0-alpha.3.7"` (nonexistent) | ruflo | `v3/@claude-flow/memory/package.json` | exact `-patch.N` version |
| `agentdb: "^2.0.0-alpha.2.20"` | agentic-flow | `package.json` | exact `-patch.N` version |

**Pipeline changes in ruflo-patch**:

| File | Change |
|------|--------|
| `scripts/sync-and-build.sh` | Pull from `~/src/forks/` instead of `~/src/upstream/`; add Stage 1 (upstream sync + branch + PR), Stage 3 (SHA poll + version bump + publish); remove patch phases; add email notifications |
| `scripts/codemod.mjs` | Remove `"*"` wildcard replacement loop (lines 115-124) |
| `scripts/publish.mjs` | Remove `bumpLastSegment()`, `semverCompare()`, version computation; read version from `package.json` |
| `config/published-versions.json` | Clear (fork is version source of truth) |
| `package.json` | Add `sync`, `publish:fork` npm scripts |

**Delete patch infrastructure**:

```
patch/                  # all 8 dirs
patch-all.sh            # orchestrator
check-patches.sh        # sentinel verification
lib/common.py           # patch helpers
lib/discover.sh         # package discovery
lib/discover.mjs        # same (JS)
lib/categories.json     # patch categories
tests/01-common-library.test.mjs
tests/02-discovery.test.mjs
tests/03-mc001-mcp-autostart.test.mjs
```

**Update**: preflight (remove patch checks), test counts, add unit tests for `fork-version.mjs`, CLAUDE.md (fork patch rules), MEMORY.md.

## Consequences

### Completion (SPARC-C)

**Positive**:
- Patches are type-checked, IDE-navigable, and compiler-validated — eliminates silent "pattern not found" failures entirely
- Dependency ranges are correct and explicit — no `"*"` wildcards, no build-time version computation
- Version scheme (`-patch.N`) is unambiguous and traceable to upstream
- Pipeline simplified from 15 phases to ~10; patch infrastructure (6 scripts, 8 dirs, 3 test files) eliminated
- Contributor ramp-up drops from 1-2 days to 2-4 hours (standard git workflow)
- Failures are loud — merge conflicts, compile errors, and test failures all block publishing
- Branch + PR gate prevents accidental publishes; operator reviews every change
- Monthly maintenance estimated at 3-6h (down from 5-12h)

**Negative**:
- 2-3 day migration effort (one-time)
- Merge conflicts on upstream sync (1-4/week), though scope rename conflicts are eliminated
- Three git forks to maintain instead of zero
- Up to 6h delay between merging PR and auto-publish (systemd timer poll interval)

**Neutral**:
- Codemod still required for scope rename (`@claude-flow/*` → `@sparkleideas/*`)
- Topological publish ordering unchanged (5 levels)
- Verdaccio test gate unchanged
- Prerelease → acceptance → promote flow unchanged

**Break-even**: ~3-4 months (monthly savings ~4-6h, migration cost ~18h).

## Implementation Steps

1. Fork 3 repos on GitHub under `sparkling`
2. Clone forks to `~/src/forks/`, configure `upstream` + `origin` remotes
3. Tag `fork-base` at upstream HEAD in each fork
4. Port 5 active behavioral patches to TypeScript source in ruflo fork
5. Fix all broken dep ranges in fork `package.json` files (see Refinement table)
6. Set `-patch.1` versions and pin internal dep ranges in all fork `package.json` files
7. Tag initial versions (e.g., `v3.0.0-alpha.6-patch.1`) in each fork, push tags
8. Add `fork-version.mjs` script to each fork
9. Create GitHub Issue per patch (labeled `patch`) in the corresponding fork
10. Update `sync-and-build.sh`: Stage 1 + Stage 3 + email notifications
11. Delete patch infrastructure from ruflo-patch
12. Delete obsolete tests, update preflight
13. Update `publish.mjs`: remove version computation, read from `package.json`
14. Update `codemod.mjs`: remove `"*"` wildcard loop
15. Clear `config/published-versions.json`
16. Configure email notifications (`msmtp` or `sendmail`)
17. Run full test suite, deploy
18. Update CLAUDE.md: replace patch rules with fork patch rules, add manual trigger commands
19. Update MEMORY.md: replace patch workflow, version scheme, publish model, npm scripts

## Verification

1. Each fork: `tsc --noEmit` — patches compile
2. `npm run preflight && npm run test:unit` — L0+L1 pass
3. `npm test` — L0+L1+L2 pass
4. `npm run build --force && npm run test:rq` — L3 passes with `-patch.N` versions
5. Spot-check published `package.json`: deps show exact versions, no `"*"` wildcards

## Relates To

- **ADR-0006**: npm scope naming (`@sparkleideas/*`)
- **ADR-0010**: Prerelease → promote publishing gate
- **ADR-0012**: Version numbering (superseded by `-patch.N`)
- **ADR-0013**: Codemod implementation (scope rename kept, wildcard loop removed)
- **ADR-0014**: Topological publish ordering (unchanged)
- **ADR-0024**: Patch deployment model (superseded — patches move to fork)
- **ADR-0026**: Build stage decoupling (build caching unchanged)
