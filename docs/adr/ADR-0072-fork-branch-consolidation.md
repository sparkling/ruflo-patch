---
status: accepted
date: 2026-04-06
tags: [fork, branch, pipeline, consolidation]
supersedes: []
depends-on: []
implements: []
---

# Fork Branch Consolidation

## Context and Problem Statement

ruflo-patch builds from 4 forks. `copy-source.sh` rsyncs whatever branch is checked out — `upstream-branches.json` is advisory only.

### Branch Topology (discovered during investigation)

The ruflo fork's `fix/all-patches-clean` branch is NOT a parallel development line — it's an **earlier point on the same line**. Main has all of fix's commits plus 178 more on top.

```
upstream fork point (322b2ae52)
        |
        +── 20 commits (ADR-0059, ADR-0068, ADR-0069 config chain patches)
        |
        v
  fix/all-patches-clean (3bfbf25d9)  ← 148/148 baseline built here
        |
        +── 178 more commits (ADR-0040-0053, upstream merge, init refactor, version bumps)
        |
        v
  main (1f49241d6 pre-merge)
```

The 148/148 baseline was built from the fix branch tip. Main's 178 additional commits were **never in the published packages** — they are unreleased work that introduced regressions to the acceptance tests.

### ADR Supersession Chain

The hive analysis found that ~27 of main's 178 commits are **superseded** by the fix branch:

| Main's Approach (ADR-0052) | Fix Branch's Approach (ADR-0068/0069) |
|---------------------------|--------------------------------------|
| Per-package `embedding-constants.ts` files | Centralized `getEmbeddingConfig()` config chain |
| Static `EMBEDDING_DIM` imports in 23 files | Dynamic dimension from `embeddings.json` |
| Hardcoded `m:16, efConstruction:200` | Config-driven `m:23, efConstruction:100, efSearch:50` |
| Inconsistent model name prefixing | Canonical `Xenova/all-mpnet-base-v2` everywhere |

Main's ADR-0040–0053 controller work (ControllerInitError, fail-loud, deferred init, 45+ controllers) is **NOT superseded** — it's complementary and must be preserved.

## Decision Drivers

* Pipeline failure — patches on feature branches never merged to main.

## Considered Options

* **Fix forward on main, since the fix branch is already an ancestor of main (chosen)** — there is nothing to merge; the regressions are caused by main's 178 commits introducing incompatible patterns alongside the fix branch's config chain.

(No alternatives were recorded.)

## Decision Outcome

Chosen option: "Fix forward on main", because the fix branch is already an ancestor of main, so there is nothing to merge — the 15 regressions are caused by main's 178 commits introducing incompatible patterns alongside the fix branch's config chain.

### Baseline

Pre-merge acceptance: **148/148 passed, zero failures** (`accept-2026-04-06T102925Z`).

This is the target. Every acceptance check that passed in baseline must pass after fixes.

### Root Causes (all found and fixed)

| # | Root Cause | Impact | Fix | Commit |
|---|-----------|--------|-----|--------|
| 1 | Dead `SqlJsBackend` import in database-provider.ts | Build failure → memory cascade | Remove import | `97003ae7a` |
| 2 | Syntax error in auto-memory-hook.mjs (extra `}`) | Hook init crash | Remove extra brace | `97003ae7a` |
| 3 | `wizardCommand` not exported from init.ts | CLI crash on init | Add `export` keyword | `0e50f8f7b` (in merge) |
| 4 | Undefined `_lb` variable in memory-bridge.ts | ReferenceError → 11 memory failures | Use `cfgJson.memory?.learningBridge?.enabled` | `662324eb1` |
| 5 | Broken MCP tool registrations (quantize, healthReport, attentionCompute) | Bridge function not found errors | Remove registrations (baseline didn't have them) | `662324eb1` |
| 6 | Tool name `agentdb_causal_edge` (underscore) vs baseline `agentdb_causal-edge` (hyphen) | Tool not found | Restore hyphenated name | `662324eb1` |
| 7 | `similarityThreshold` default 0.25 in FULL_INIT_OPTIONS (should be 0.7) | Wrong config value generated | Fix to 0.7 | `662324eb1` |
| 8 | `embedding-constants.ts` present (ADR-0052, superseded by ADR-0069) | Dead code in build | Delete files + remove 11 imports | `662324eb1` |

### Non-regression (new check)

`f3-mech-count`: ADR-0069 F3 WASM mechanism count check — new, not in baseline. WASM packages need publish pipeline wiring.

### Consequences

* Good, because all forks build from `main` — policy aligned with reality.
* Good, because unit tests show 0 failures / 1465 passes.
* Good, because the acceptance target is 148/148 baseline (rebuild in progress).
* Good, because the ADR-0052 approach (embedding-constants) is officially superseded by the ADR-0069 config chain.
* Good, because `copy-source.sh` has non-blocking branch verification.
* Neutral, because ~27 superseded commits remain in history but their artifacts are removed from source.
* Neutral, because feature branches are historical (fully merged, can be deleted).

### Confirmation

Pre-merge acceptance baseline was 148/148 passed with zero failures (`accept-2026-04-06T102925Z`); every check that passed in baseline must pass after fixes. As of the post-sync update, acceptance was 157/159 passing with the 148/148 baseline fully restored, and unit tests showed 0 failures / 1502 passes.

## Implementation Log

### Phase 1: agentic-flow merge — DONE
- Merged `fix/agentdb-dotenv-lazy-require` → `main` (20 commits, zero conflicts)
- Commit: `f83b96d`, pushed to `sparkling/main`

### Phase 2: ruflo merge — DONE (with regression fixes)
- Merge: 99 conflicts resolved keeping both sides (`0e50f8f7b`)
- Post-merge fix 1: dead SqlJsBackend import + auto-memory-hook syntax (`97003ae7a`)
- Post-merge fix 2: 4 root causes, 15 files (`662324eb1`)
- All pushed to `sparkling/main`

### Phase 3: ruvector — DONE
- Reattached from detached HEAD to `main`

### Phase 4: copy-source.sh — DONE
- Branch verification warning added (`4d23109`)

### Phase 5: Refactor fragile tests (deferred)
- 3 test files read fork `.ts` source directly — should use mocks

## Divergence Analysis (from hive investigation)

### Main's 178 commits by category

| Category | Commits | Status |
|----------|---------|--------|
| ADR-0040–0053 controller work | ~40 | **Preserved** — complementary to fix branch |
| Upstream merges (v3.5.23–v3.5.51) | 2 | **Preserved** — essential for sync |
| Version bumps | ~37 | **Preserved** — pipeline depends on them |
| ADR-0052 embedding-constants | ~8 | **Superseded** — removed, replaced by config chain |
| Hardcoded dimensions/model names | ~19 | **Superseded** — replaced by config chain |
| Init system refactor | ~15 | **Preserved** — merged with fix's defaults |
| Bug fixes | ~57 | **Preserved** — independent of fix branch |

### Files both branches modified (63 total)

- 16 package.json — version strings (pipeline re-stamps)
- 29 source files — resolved in merge, fix's config chain + main's features
- 17 auto-merged cleanly
- 1 delete conflict (sqljs-backend.ts → deleted per fix branch, correct)

## Post-Sync Update (2026-04-06)

All 4 forks synced with upstream:
- ruflo: 11 commits merged (v3.5.52-v3.5.58, 15 conflicts resolved)
- ruvector: 68 commits merged (clean merge, pushed to sparkling)
- agentic-flow: already up to date (upstream stale since Feb 27)
- ruv-FANN: already up to date (upstream stale since Feb 9)

Acceptance: 157/159 passing. Baseline 148/148 fully restored.
Unit tests: 0 failures / 1502 passes.

## More Information

Original status: "Implemented (2026-04-06)." Recorded 2026-04-06. The driving cause was a pipeline failure where patches on feature branches were never merged to main. This decision officially supersedes the ADR-0052 embedding-constants approach in favor of the ADR-0068/0069 config chain (the artifacts were removed from source while the superseded commits remain in history).
