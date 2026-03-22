# ruflo-patch Memory

## Plan Templates

- [Clean-Slate Reset + E2E Release](plan-template-clean-slate-release.md) — reset forks, re-apply patches, run full pipeline

## Reference Docs

- `docs/pipeline-reference.md` — how the pipeline works, phases, timing, publishing, caching, failure history, optimization opportunities

## Fork Purpose

- [Fork purpose correction](feedback-fork-purpose.md) — builds upstream HEAD (not tags), publishes as `{tag}-patch.N` with pinned deps

## Default Scope

- By default, ALL instructions target the **repackaged published version** (`@sparkleideas/*` packages that users install)
- Only target this repo's internal tooling when the user explicitly says so

## ADR Rules

- **Implemented ADRs are historical records — NEVER modify them.** Create a new ADR that references the old one.
- [ADR format requirement](feedback-adr-format.md) — ALL ADRs must use SPARC + MADR format (5 phases: S, P, A, R, C)

## Patch Rules (Fork Model — ADR-0027)

- Patches live in fork TypeScript source at `~/src/forks/{ruflo,agentic-flow,ruv-FANN}`
- NEVER modify the project CLAUDE.md unless explicitly asked
- NEVER reuse a defect ID
- ALWAYS use `gh` CLI for any GitHub operations
- ALWAYS run `npm run preflight` before staging
- ALWAYS commit often
- **New patch**: edit fork TS → `tsc --noEmit` → branch `patch/ID` → commit → push → create GitHub Issue (labeled `patch`) → create PR referencing the issue → `npm run deploy`
- **ALWAYS create a GitHub issue for every patch** — issues are the tracking record, PRs are the implementation
- **Direct-to-main**: for quick fixes, commit directly to fork main, push, let timer pick up
- **Track active patches**: `gh issue list --label patch` in each fork repo
- **ruflo fork**: no top-level tsconfig — use `--project v3/@claude-flow/<pkg>/tsconfig.json`
- **agentic-flow fork**: has root AND `agentic-flow/package.json` — patch both if needed
- **Patch propagation**: when changing a shared type, grep all consumers (fixtures, tests) and fix them too

## Active Patches (GitHub Issues)

### ruflo-patch tracker (`sparkling/ruflo-patch`) — 54 issues from full sweep (2026-03-14)

**Services (ruflo fork)**: HW-001 (#2), HW-002 (#3), HW-003 (#4), HW-004 (#5), DM-001 (#6), DM-002 (#7), DM-003 (#8), DM-004 (#9), DM-006 (#10), WM-108 (#11)
**MCP hooks-tools (ruflo)**: HK-002 (#18), HK-003 (#19), HK-004 (#20), HK-005 (#21), NS-003 (#22), WM-104 (#23), WM-106 (#24), WM-107 (#25), WM-114 (#26–28)
**MCP memory-tools (ruflo)**: NS-001 (#29), NS-002 (#30), WM-103 (#27 area), WM-105 (#28 area)
**Commands (ruflo)**: CF-002 (#12), CF-003 (#13), CF-004 (#14), CF-006 (#15), SG-005 (#16), SG-009 (#17)
**Init generators (ruflo)**: CF-009 (#42), SG-001 (#43), SG-003 (#44), SG-004 (#45), SG-006 (#46), SG-007 (#47), SG-008 (#48), SG-010 (#49), SG-011 (#50), SG-012 (#51), HK-001 (#52), HK-006 (#53), MM-001 (#54)
**Memory system (ruflo)**: EM-001 (#31), GV-001 (#32), MM-002 (#33), WM-102 (#34), WM-111 (#35), WM-115 (#36), WM-116 (#37), UI-002 (#38), WM-003 (#39), IN-003 (#40), IN-004 (#41)
**ruv-FANN fork**: RS-001 (#1)
**ruvector fork** (`sparkling/RuVector`, dir `~/src/forks/ruvector`): RV-001 (#55), RV-002 (#56), RV-003 (#57)

### Previous ruflo fork patches (`sparkling/ruflo` issues, all closed)
- **Closed 2026-03-13**: MC-001 (#1, PR #14), SG-004 (#13, PR #10), TS-001 (#11, PR #12), GB-001 (#15, PR #16), SG-003 (#4, not-needed)
- **Closed 2026-03-14**: FB-004 (#3, PR #17), DM-001 (#20, PR #21+direct), EM-001 (#23, direct), HN-001 (#24, direct)
- **agentic-flow fork** (`sparkling/agentic-flow`): AB-001 (#2, PR #3 + direct commit a83fc62)
- **Closed 2026-03-12**: FB-001, FB-002 (upstream absorbed)

## Project Structure (ADR-0039)

- `scripts/ruflo-publish.sh` — publish stage (detect merges, bump, build, publish) + flock guard
- `scripts/ruflo-sync.sh` — sync stage (fetch upstream, merge, build, test, PR)
- `scripts/copy-source.sh` — rsync 4 forks to /tmp/ruflo-build
- `scripts/build-packages.sh` — TypeScript compile (TSC only)
- `scripts/build-wasm.sh` — WASM compile (standalone, optional)
- `scripts/gen-tsconfig.mjs` — standalone tsconfig generator for build
- `scripts/deploy-finalize.sh` — save state, push forks, write timing
- `scripts/run-fork-version.sh` — bump -patch.N versions in forks
- `scripts/publish.mjs` — publish with topological ordering (5 levels)
- `scripts/promote.sh` — promote prerelease to @latest
- `scripts/fork-version.mjs` — version bumping
- `scripts/codemod.mjs` — scope rename (`@claude-flow/*` → `@sparkleideas/*`)
- `lib/fork-paths.sh` — centralized fork directory constants
- `lib/pipeline-helpers.sh` — shared build/test wrapper functions
- `lib/pipeline-utils.sh` — shared logging, state, timing
- `lib/email-notify.sh` — HTML email templates
- `lib/github-issues.sh` — failure issues, sync PRs
- `config/tsc-stubs/*.d.ts` — 16 static type stubs for TSC build
- `config/published-versions.json` — per-package version tracking (committed)

## Testing — When to Run What (ADR-0038 cascading)

| Change | Tests to run |
|--------|-------------|
| Fork TypeScript patch | `tsc --noEmit` in fork + `npm run test:unit` |
| Pipeline/script change | `npm run test:unit` |
| Acceptance/build changes | `npm run test:unit && npm run test:acceptance` |
| Deploy to Verdaccio | `npm run deploy` (full cascade) |

**MANDATORY**: Run tests BEFORE committing. This is the #1 recurring failure.

## Critical Pipeline Rules

- **NEVER force push forks to fix version state** — npm is immutable, work forward
- **NEVER clear published-versions.json without reconciling with npm**
- **NEVER manually set versions** — use fork-version.mjs
- **NEVER save pipeline state before publish succeeds**
- **FIX THE PIPELINE, don't hack the state**

See `docs/pipeline-reference.md` for full failure history and details.

## Full Sweep History

- [Full patch sweep 2026-03-14](project-full-sweep-2026-03-14.md) — ported 54/146 patches from claude-flow-patch to fork model

## Feedback

- [Never dismiss flaky tests](feedback-never-dismiss-flaky.md) — ALL test failures must be fixed, never called "pre-existing" or "flaky"

- [No dry-run](feedback-no-dry-run.md) — deploy:dry-run removed (ADR-0038), we are the only Verdaccio user, always run full deploy
- [Patch tracking via GitHub issues](feedback-patch-tracking.md) — every patch MUST have a GitHub issue as the tracking record
- [Always capture full output](feedback-full-output.md) — never truncate build/test output with tail/head, use `tee` to log files
- [Fix ALL TS errors](feedback-fix-all-ts-errors.md) — never leave pre-existing upstream TS errors unfixed, patch them in forks
- [Never hang on pipeline](feedback-never-hang.md) — run pipeline in foreground with timeout, poll if background, never passively wait
- [No L0-L4 test levels](feedback-no-test-levels.md) — never use L0/L1/L2/L3/L4 labels, use plain names (preflight, unit, acceptance)

## Infrastructure

- [Verdaccio local registry](reference-verdaccio.md) — systemd-managed, publish:$all, dummy _auth, NEVER start manually

## Architecture Decisions

- [Bash vs Node.js pipeline debate](project-bash-vs-nodejs.md) — 14 inline `node -e` snippets in shell; hybrid works but is awkward; prefer extracting to .mjs
- [Embedding config framework](project-embedding-framework.md) — config-driven model selection via `agentdb/src/config/embedding-config.ts`; changing models = editing embeddings.json

## Gotchas

- ruflo fork = `sparkling/ruflo` on GitHub (renamed 2026-03-10)
- Fork dirs at `~/src/forks/{ruflo,agentic-flow,ruv-FANN,ruvector}` (local names differ from GitHub)
- ruvector fork = `sparkling/RuVector` on GitHub, `bin/cli.js` is hand-written JS (no build step)
- Publish stage runs before Sync stage in the timer
- ESM-only codebase — never use `require()`, always `import`
- Global Verdaccio on port 4873 — NEVER kill it
- `flock` lock at `/tmp/ruflo-pipeline.lock` — check for orphaned holders with `fuser`
- MockInstance `>` in `=>` arrow: bracket-counting scripts must skip `>` preceded by `=` to avoid treating arrow operators as closing angle brackets
- Post-promote smoke test uses `npm view` (not `npx --version`) to avoid stderr deprecation warnings causing false failures

## Imported from predecessor projects

### claude-flow-patch (predecessor to ruflo-patch)
- [Dependency analysis](cfp-dependency-analysis.md) — package dependency graph analysis
- [Hook lifecycle analysis](cfp-hook-lifecycle-analysis.md) — how hooks execute and interact
- [Settings generator audit](cfp-settings-gen-audit.md) — settings.json generation analysis
- [WM-092 research](cfp-WM-092-research-findings.md) — memory system research findings

### gene-clean (server setup/patterns)
- [Debugging notes](gene-debugging.md) — common debugging patterns on gene server
- [Project patterns](gene-patterns.md) — V3 system architecture patterns (150+ tools, 93 agents, etc.)
- [Preferences](gene-preferences.md) — user preferences and project conventions
- [Self-awareness report](gene-self-awareness-report.md) — full V3 system self-analysis

### agentdb-upgrade worktree
- [Memory systems map](agentdb-upgrade-CLAUDE_FLOW_MEMORY_MAP.md) — HybridBackend, AutoMemoryBridge, Intelligence.cjs
- [Quick reference](agentdb-upgrade-QUICK_REFERENCE.md) — agentdb upgrade quick ref
- [Source file reference](agentdb-upgrade-SOURCE_FILE_REFERENCE.md) — key source files
- [Systems relationship](agentdb-upgrade-SYSTEMS_RELATIONSHIP.md) — how subsystems connect
