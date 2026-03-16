# ADR-0040: Pipeline Build Optimizations

## Status

Accepted (extends ADR-0038, ADR-0039)

## Date

2026-03-16

## Deciders

sparkling team

## Methodology

SPARC + MADR

## Context

The ruflo-patch pipeline already has 13 caching patterns (build manifest, WASM hash
cache, package checksums, selective builds, parallel group compilation, etc.). However,
four inline optimizations remain that can save 15-25 seconds per pipeline run without
adding any new files:

1. **TSC always does full recompile** (~20s). No `--incremental` flag is used, so every
   build recompiles all ~30 packages from scratch even when only 1-2 files changed.

2. **Codemod retransforms every file** (~3s). Even if source files haven't changed
   since the last codemod run, all files are read, checked, and potentially rewritten.

3. **TSC toolchain reinstalls every 24h**. The `find -mmin +1440` TTL is conservative
   for pinned deps (`--save-exact`), causing unnecessary 5-10s reinstalls weekly.

4. **Two separate `find` traversals** scan the build directory post-build. Combining
   them saves a small but measurable 200-300ms.

### Decision Drivers

1. Save 15-25s per pipeline run (currently ~2-3 min total)
2. Zero new files — inline modifications only
3. Build on existing caching patterns (WASM hash cache, build manifest)
4. No risk of stale builds — all caches self-invalidate on change

## Decision: Specification (SPARC-S)

Four optimizations targeting 3 existing files:

| # | Optimization | File(s) | Savings |
|---|---|---|---|
| 1 | TSC `--incremental` with `.tsbuildinfo` | build-packages.sh, copy-source.sh | 10-20s |
| 2 | Codemod per-file hash skip | codemod.mjs | 2-3s |
| 3 | Extend TSC toolchain TTL to 7 days + deps hash | build-packages.sh | 5-10s/week |
| 4 | Combine post-build `find` calls | build-packages.sh | 200-300ms |

## Pseudocode (SPARC-P)

### TSC Incremental

```
build_one_pkg():
  tsc -p tsconfig.build.json --incremental --tsBuildInfoFile .tsbuildinfo
  # On second run, TSC reads .tsbuildinfo and skips unchanged files
  # Do NOT delete tsconfig.build.json — .tsbuildinfo references it

copy_source rsync:
  --filter='P .tsbuildinfo'  # preserve across rsync --delete
```

### Codemod Hash Cache

```
transform(tempDir):
  cache = load /tmp/ruflo-build/.codemod-file-cache.json
  selfHash = sha256(codemod.mjs source)
  if cache._selfHash != selfHash: cache = {}  # invalidate all

processOneFile(path):
  content = readFile(path)
  hash = sha256(content)
  if cache[path] == hash: return  # skip — already transformed
  transformed = applyTransform(content)
  writeFile(path, transformed)
  cache[path] = sha256(transformed)

end of transform():
  prune cache to files scanned this run
  save cache with _selfHash
```

### Toolchain TTL + Deps Hash

```
deps_string = "typescript@5 zod@3 @types/express @types/cors @types/fs-extra"
deps_hash = sha256(deps_string)
stored_hash = read ${tsc_dir}/.deps-hash

if tsc exists AND age < 7 days AND deps_hash == stored_hash:
  skip install
else:
  install
  write deps_hash to ${tsc_dir}/.deps-hash
```

### Combined Find

```
# Before: two find traversals
dist_count = find -name "dist" -type d | wc -l
pkg_count  = find -name "package.json" ... | wc -l

# After: single traversal categorizing results
find TEMP_DIR \( -name dist -type d \) -o \( -name package.json ... \) -print0 |
  while read: categorize as dist or package.json
```

## Architecture (SPARC-A)

### Modified files

| File | Changes |
|------|---------|
| `scripts/build-packages.sh` | `--incremental` flags, toolchain TTL, combined find |
| `scripts/copy-source.sh` | Preserve `.tsbuildinfo` in rsync filters |
| `scripts/codemod.mjs` | Per-file hash cache with self-invalidation |

### No new files

All changes are inline modifications to existing scripts. Cache artifacts are written
to the existing `/tmp/ruflo-build/` and `/tmp/ruflo-tsc-toolchain/` directories.

## Refinement (SPARC-R)

### Risk: Stale `.tsbuildinfo`

If `.tsbuildinfo` becomes stale (e.g., file rename, tsconfig change), TSC silently
falls back to a full rebuild. This is TSC's built-in behavior — no breakage possible.
The `.tsbuildinfo` file is excluded from publish via `"files"` in package.json.

### Risk: Codemod cache invalidation

The cache stores a self-hash of `codemod.mjs` itself. Any change to the codemod logic
invalidates the entire cache automatically. The cache is also pruned to only files
scanned in the current run, preventing unbounded growth.

### Risk: Toolchain TTL too long

Deps are pinned with `--save-exact`, so version drift is impossible. A content hash
of the dep string provides a secondary check — if deps change in the script, the
toolchain reinstalls regardless of TTL. 7 days is safe for exact-pinned deps.

### Risk: tsconfig.build.json deletion

The previous cleanup removed `tsconfig.build.json` after each build. Since
`.tsbuildinfo` stores the tsconfig path, deleting it forces a full rebuild on the
next run, defeating incremental compilation. The fix: stop deleting the generated
tsconfig, which is harmless to leave in place.

## Completion (SPARC-C)

1. `npm run test:unit` passes
2. `npm run build` succeeds (first run — baseline)
3. `find /tmp/ruflo-build -name "*.tsbuildinfo" | wc -l` > 0
4. `/tmp/ruflo-build/.codemod-file-cache.json` exists with entries
5. `/tmp/ruflo-tsc-toolchain/.deps-hash` exists
6. `npm run build` again — second run measurably faster
7. No timing regression in pipeline

## Consequences

### Positive

- 10-20s saved per run from TSC incremental compilation
- 2-3s saved per run from codemod file caching
- 5-10s saved weekly from extended toolchain TTL
- Zero new files — all inline changes to 3 existing scripts
- All caches self-invalidate on change (no stale build risk)
- Patterns consistent with existing WASM hash cache (build-wasm.sh:52-73)

### Negative

- `.tsbuildinfo` files persist in `/tmp/ruflo-build` (~100KB total)
- `.codemod-file-cache.json` adds one more cache file to track
- Slightly more complex cleanup if build dir is manually wiped (but `rm -rf` still works)
