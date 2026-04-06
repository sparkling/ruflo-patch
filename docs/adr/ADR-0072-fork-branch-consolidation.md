# ADR-0072: Fork Branch Consolidation

- **Status**: Accepted
- **Date**: 2026-04-06
- **Driver**: Pipeline failure — 55 unit tests fail because ADR-0068/0069 patches exist on feature branches, not main

## Context

ruflo-patch builds from 4 forks. The user's policy is "all forks build from main." But patches accumulated on feature branches that were never merged:

| Fork | Build Branch | Patch Branch | Patches | Merge Risk |
|------|-------------|-------------|---------|------------|
| agentic-flow | `main` | `fix/agentdb-dotenv-lazy-require` | 20 commits (ADR-0068/0069) | **Zero conflicts** |
| ruflo | `main` | `fix/all-patches-clean` | 20 commits | **~40 conflicts** (HIGH) |
| ruv-FANN | `main` | — | — | N/A |
| ruvector | `main` (detached HEAD) | — | — | Reattach only |

The pipeline (`copy-source.sh`) rsyncs whatever branch is checked out — it does NOT read `upstream-branches.json` to checkout a branch. So the "build branch" config is advisory only.

3 test files read fork `.ts` source directly via `readFileSync` and assert ADR patches exist. These are the sole source of the 55 failures.

## Decision

### Phase 1: Merge agentic-flow patches to main (immediate)

Merge `fix/agentdb-dotenv-lazy-require` → `main`. Zero conflicts verified. This is 20 commits containing:
- ADR-0068 Wave 1: AgentDB singleton wiring, dimension/model unification
- ADR-0069 A1-A10: config chain remediation (rate limiters, sqlite pragmas, HNSW, learning rates, etc.)
- ADR-0069 F3: WASM fallback chain (already on main via cherry-pick)

### Phase 2: Cherry-pick ruflo patches (selective)

Do NOT merge `fix/all-patches-clean` → `main` (40 conflicts). Instead:
1. Run tests after Phase 1 to identify which ruflo failures remain
2. Cherry-pick only the specific commits that fix those failures
3. Resolve conflicts per-commit (smaller scope, lower risk)

### Phase 3: Fix ruvector detached HEAD

`git checkout main` in ruvector fork. Commit any uncommitted build artifacts.

### Phase 4: Harden copy-source.sh

Add a branch verification step to `copy-source.sh` that reads `upstream-branches.json` and warns (non-blocking) if the checked-out branch doesn't match the configured build branch.

### Phase 5: Refactor fragile tests (deferred)

The 3 test files that read fork source directly should be refactored to use mocks (matching the pattern of the other 27 ADR test files that already pass). Fork source validation belongs at acceptance level, not unit level.

## Consequences

- All forks build from main (policy aligned with reality)
- 55 test failures resolved
- Feature branches become historical (can be deleted after merge)
- `copy-source.sh` gains a safety check
- No more implicit dependency on which branch happens to be checked out

## Files Changed

### Phase 1
- Fork: `agentic-flow` — merge 20 commits to main
- Push: `sparkling/main`

### Phase 2
- Fork: `ruflo` — cherry-pick specific ADR-0068/0069 commits to main
- Push: `sparkling/main`

### Phase 3
- Fork: `ruvector` — `git checkout main`, commit artifacts

### Phase 4
- `scripts/copy-source.sh` — add branch verification warning

### Phase 5 (deferred)
- `tests/unit/rate-limiter-config-adr0069.test.mjs` — refactor to mocks
- `tests/unit/config-centralization-adr0065.test.mjs` — refactor to mocks
- `tests/unit/sqlite-pragma-adr0069.test.mjs` — refactor to mocks
