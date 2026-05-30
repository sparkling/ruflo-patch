---
status: accepted
date: 2026-03-08
tags: [testing, cache, pipeline, performance]
supersedes: []
depends-on: [ADR-0023, ADR-0024]
implements: []
---

# RQ Test Cache Optimization

## Context and Problem Statement

### Specification (SPARC-S)

`test-rq.sh` creates a brand-new `NPM_CONFIG_CACHE` tmpdir every run (line 168-169), forcing every `npx` and `npm install` call to start completely cold. External deps like `better-sqlite3` and `onnxruntime` are re-downloaded from Verdaccio uplinks on every run despite never changing.

Three cache-related costs per RQ run:

| Cost | Source | Impact |
|------|--------|--------|
| `npm cache clean --force` | Line 138 | Destroys global cache including external deps |
| Fresh `NPM_CONFIG_CACHE` tmpdir | Line 168 | Forces cold resolution of everything |
| `npm install` in temp dir | Line 143-150 | Re-downloads all transitive deps from scratch |

The fresh cache was originally added because npx hung ~77s resolving from cached real-npm registry entries. That problem is caused by stale entries in `~/.npm/_npx/` (npx resolution trees), not the tarball cache in `~/.npm/_cacache/`.

### Pseudocode (SPARC-P)

Before (every run):
```
1. npm cache clean --force         → nuke entire ~/.npm cache
2. clear @sparkleideas from _npx/  → clear npx resolution
3. create fresh NPM_CONFIG_CACHE   → empty tmpdir
4. npm install (cold)              → re-download ALL deps (~57s)
5. run RQ checks (each npx cold)   → slow resolution
6. delete tmpdir on exit           → cache lost
```

After:
```
1. clear @sparkleideas from _npx/          → prevent stale resolution hangs
2. clear changed packages from _cacache/   → force re-fetch of changed metadata
3. use ~/.npm (global cache)               → external deps already cached
4. npm install (warm)                      → only fetch changed packages (~5-10s)
5. run RQ checks (warm npx)               → fast resolution
6. cache persists for next run
```

## Decision Drivers

- RQ-1 takes ~57s due to cold npm cache on every run
- `npm cache clean --force` destroys external dep caches unnecessarily
- Fresh `NPM_CONFIG_CACHE` tmpdir forces re-download of all transitive deps
- Incremental build detection (ADR-0023 Decision 10) already tracks changed packages but cache clearing ignores it

## Considered Options

**Option A: Global `~/.npm` cache with selective clearing**
- Use the standard `~/.npm` cache instead of a fresh tmpdir
- Pro: Maximum speedup, external deps shared with normal npm
- Con: Stale real-npm metadata in global cache causes resolution failures (tested, rejected)

**Option B: Persistent `/tmp/ruflo-rq-npxcache` directory** (chosen)
- Stable path reused across runs, isolated from global npm cache
- Always clear ALL `@sparkleideas` from `_npx/` (cheap, prevents 77s hangs)
- Selectively clear only changed packages from `_cacache/` index (expensive part)
- Pro: Isolated from real-npm metadata — no stale resolution
- Pro: External deps persist across RQ runs
- Pro: Leverages existing `CHANGED_PACKAGES` from ADR-0023

**Option C: Keep fresh cache, skip `npm cache clean`**
- Only remove `npm cache clean --force`, keep fresh tmpdir
- Pro: Minimal change
- Con: Still creates cold cache every run, limited speedup

## Decision Outcome

Chosen option: "Option B: Persistent `/tmp/ruflo-rq-npxcache` directory", because it isolates the cache from stale real-npm metadata (avoiding 77s resolution hangs) while persisting external deps across RQ runs and leveraging the existing `CHANGED_PACKAGES` tracking from ADR-0023.

### Architecture (SPARC-A)

**Option B**: Use a stable persistent cache dir (`/tmp/ruflo-rq-npxcache`) with two-tier selective clearing.

| Cache | Scope cleared | Why |
|-------|--------------|-----|
| `/tmp/ruflo-rq-npxcache/_npx/` | ALL `@sparkleideas` (every run) | npx resolution trees are cheap; stale entries cause 77s hangs |
| `/tmp/ruflo-rq-npxcache/_cacache/index-v5/` | Only changed packages | Tarball re-download is expensive; unchanged packages stay cached |

Changes:

| File | Change |
|------|--------|
| `scripts/test-rq.sh` | Remove `npm cache clean --force`; add selective `_cacache` clearing; remove `NPM_CONFIG_CACHE` override; simplify cleanup |
| `lib/acceptance-checks.sh` | RQ-13 comment update (ADR-0025 reference) |

### Refinement (SPARC-R)

Cache clearing mirrors the existing Verdaccio selective-clear pattern (lines 95-109 of `test-rq.sh`):

- **Full mode** (`CHANGED_PACKAGES="all"`): clear all `@sparkleideas` from both `_npx/` and `_cacache/`
- **Incremental mode** (JSON array): clear all `@sparkleideas` from `_npx/`, clear only changed packages from `_cacache/`

RQ-13 (`check_latest_resolves`) detects RQ context via `NPM_CONFIG_CACHE` being set. In Layer 3, `test-rq.sh` exports it pointing to the stable cache. In Layer 4 (acceptance, real npm), it's unset, so a throwaway cache is created to avoid stale dist-tag entries.

### Consequences

#### Completion (SPARC-C)

* Good, because subsequent RQ runs drop from ~90s+ to ~30-40s (external deps cached)
* Good, because incremental builds even faster — only changed package metadata re-fetched
* Good, because no more `npm cache clean --force` polluting the global cache
* Good, because consistent with incremental build philosophy from ADR-0023
* Bad, because first run after `npm cache clean` is same speed as before
* Bad, because orphaned content blobs in `_cacache/content-v2/` accumulate (harmless, npm garbage collects)
* Neutral, because `_npx/` clearing is always full-scope for `@sparkleideas` — no incremental optimization there (but it's cheap)
* Neutral, because RQ timeout stays at 180s (increased from 120s for RQ-14)

## More Information

This decision relates to ADR-0023 (6-layer testing model, incremental build detection — Decision 10) and ADR-0024 (patch deployment model, `test-rq.sh` as standalone RQ runner).

This record originally used the SPARC + MADR methodology, with section headings (Specification / Pseudocode / Architecture / Refinement / Completion) remapped to the canonical MADR sections during the ADR-0271 migration, preserving all content. Original status: "Accepted".
