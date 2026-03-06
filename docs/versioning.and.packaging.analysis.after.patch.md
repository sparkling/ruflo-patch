# Versioning & Packaging Analysis: @sparkleideas/* Ecosystem (Post-Patch)

**Date**: 2026-03-06
**Source**: 6-agent swarm analysis (npm registry state, dependency resolution, upstream comparison, versioning scheme, cross-package conflicts, end-to-end installability testing)
**Baseline**: Compared against pre-patch analysis (`versioning.and.packaging.analysis.md`, 2026-03-05)

---

## 1. Executive Summary

The ruflo-patch project successfully forked 24 `@claude-flow/*` packages to `@sparkleideas/*` with a new versioning scheme (bump-last-segment, ADR-0012). However, **fresh installs of `@sparkleideas/cli` are currently broken** due to npm's prerelease semver range behavior causing ETARGET errors across the dependency tree.

| Metric | Before Patch | After Patch | Status |
|--------|-------------|-------------|--------|
| Packages published | 0 | 24 | Done |
| Version scheme | `-patch.N` (broken) | bump-last-segment | Fixed |
| `latest` dist-tag | N/A | `3.5.2-patch.1` (all pkgs) | Stale/broken |
| `prerelease` dist-tag | N/A | Correct per-package versions | Working |
| Fresh install (`npx`) | ETARGET | ETARGET | **Still broken** |
| Cached install | N/A | Works | OK |
| CLAUDE.md rewriting | `@claude-flow/cli` refs | `@sparkleideas/cli` (14 refs, 0 leaks) | Fixed |
| Per-package versioning | All stamped `3.5.2-patch.1` | Independent per-package | Fixed |
| Dependency conflicts (RED) | N/A | 8 of 24 | **Critical** |
| Test suite | N/A | 82/82 pass | Passing |

---

## 2. Published Package Status

### 2.1 Version Matrix

| Package | Latest Tag | Prerelease Tag | Upstream Version | Version Delta | Last Published |
|---------|-----------|----------------|------------------|---------------|----------------|
| `@sparkleideas/agentdb` | 3.0.0-alpha.3-patch.1 | 3.0.0-alpha.5 | 3.0.0-alpha.10 | -5 alpha behind | 2026-03-06 |
| `@sparkleideas/agentic-flow` | 2.0.2-alpha-patch.1 | 2.0.2-alpha.2 | 2.0.7 / 3.0.0-alpha.1 | Behind both tracks | 2026-03-06 |
| `@sparkleideas/ruv-swarm` | 1.0.18-patch.1 | 1.0.20 | 1.0.20 | Identical | 2026-03-06 |
| `@sparkleideas/shared` | 3.5.2-patch.1 | 3.0.0-alpha.8 | 3.0.0-alpha.1 | +7 alpha ahead | 2026-03-06 |
| `@sparkleideas/memory` | 3.5.2-patch.1 | 3.0.0-alpha.9 | 3.0.0-alpha.11 | -2 alpha behind | 2026-03-06 |
| `@sparkleideas/embeddings` | 3.5.2-patch.1 | 3.0.0-alpha.14 | 3.0.0-alpha.12 | +2 alpha ahead | 2026-03-06 |
| `@sparkleideas/codex` | 3.5.2-patch.1 | 3.0.0-alpha.13 | 3.0.0-alpha.9 | +4 alpha ahead | 2026-03-06 |
| `@sparkleideas/aidefence` | 3.5.2-patch.1 | 3.0.5 | 3.0.2 | +3 patch ahead | 2026-03-06 |
| `@sparkleideas/neural` | 3.5.2-patch.1 | 3.0.0-alpha.9 | 3.0.0-alpha.7 | +2 alpha ahead | 2026-03-06 |
| `@sparkleideas/hooks` | 3.5.2-patch.1 | 3.0.0-alpha.9 | 3.0.0-alpha.7 | +2 alpha ahead | 2026-03-06 |
| `@sparkleideas/browser` | 3.5.2-patch.1 | 3.0.0-alpha.6 | 3.0.0-alpha.2 | +4 alpha ahead | 2026-03-06 |
| `@sparkleideas/plugins` | 3.5.2-patch.1 | 3.0.0-alpha.9 | 3.0.0-alpha.2 | +7 alpha ahead | 2026-03-06 |
| `@sparkleideas/providers` | 3.5.2-patch.1 | 3.0.0-alpha.8 | 3.0.0-alpha.1 | +7 alpha ahead | 2026-03-06 |
| `@sparkleideas/claims` | 3.5.2-patch.1 | 3.0.0-alpha.10 | 3.0.0-alpha.8 | +2 alpha ahead | 2026-03-06 |
| `@sparkleideas/guidance` | 3.5.2-patch.1 | 3.0.0-alpha.3 | 3.0.0-alpha.1 | +2 alpha ahead | 2026-03-06 |
| `@sparkleideas/mcp` | 3.5.2-patch.1 | 3.0.0-alpha.10 | 3.0.0-alpha.8 | +2 alpha ahead | 2026-03-06 |
| `@sparkleideas/integration` | 3.5.2-patch.1 | 3.0.2 | 3.0.0-alpha.1 | Graduated to stable | 2026-03-06 |
| `@sparkleideas/deployment` | 3.5.2-patch.1 | 3.0.0-alpha.9 | 3.0.0-alpha.7 | +2 alpha ahead | 2026-03-06 |
| `@sparkleideas/swarm` | 3.5.2-patch.1 | 3.0.0-alpha.8 | 3.0.0-alpha.1 | +7 alpha ahead | 2026-03-06 |
| `@sparkleideas/security` | 3.5.2-patch.1 | 3.0.0-alpha.8 | 3.0.0-alpha.1 | +7 alpha ahead | 2026-03-06 |
| `@sparkleideas/performance` | 3.5.2-patch.1 | 3.0.0-alpha.8 | 3.0.0-alpha.1 | +7 alpha ahead | 2026-03-06 |
| `@sparkleideas/testing` | 3.5.2-patch.1 | 3.0.0-alpha.8 | 3.0.0-alpha.2 | +6 alpha ahead | 2026-03-06 |
| `@sparkleideas/cli` | 3.5.2-patch.1 | 3.1.0-alpha.18 | 3.5.14 | Behind (3.1 vs 3.5) | 2026-03-06 |
| `@sparkleideas/claude-flow` | 3.5.2-patch.1 | 2.7.49 | 3.5.14 | Behind (2.7 vs 3.5) | 2026-03-06 |

**Summary**: 16 of 21 scoped sub-packages are ahead of upstream. CLI and claude-flow trail significantly. ruv-swarm is perfectly synced.

### 2.2 Dist-Tag State

Every package has two dist-tags:
- **`latest`**: Points to `3.5.2-patch.1` for most packages — the original broken `-patch.N` publish. This is a prerelease version under semver rules, causing widespread resolution failures.
- **`prerelease`**: Points to the correct per-package version computed by the bump-last-segment scheme.

**Critical issue**: The `latest` tag still references the broken `3.5.2-patch.1` versions. Users running `npm install @sparkleideas/cli` get the broken version, not the fixed one.

---

## 3. Dependency Resolution Analysis

### 3.1 CLI Dependency Tree

```
@sparkleideas/cli@3.1.0-alpha.18
│
├── @noble/ed25519 ^2.1.0                              [OK]
├── semver ^7.6.0                                       [OK]
│
├── @sparkleideas/aidefence ^3.0.2                      [resolves -> 3.0.5]
│   └── (peer) @sparkleideas/agentdb >=2.0.0-alpha.1   [ETARGET: cross-tuple]
│
├── @sparkleideas/guidance ^3.0.0-alpha.1               [resolves -> 3.0.0-alpha.3]
│   ├── @sparkleideas/hooks ^3.0.0-alpha.7              [ETARGET: prerelease caret]
│   │   ├── @sparkleideas/memory ^3.0.0-alpha.2         [ETARGET: prerelease caret]
│   │   │   └── @sparkleideas/agentdb "alpha"           [ETARGET: no dist-tag]
│   │   ├── @sparkleideas/neural ^3.0.0-alpha.2         [ETARGET: prerelease caret]
│   │   │   └── @ruvector/sona "latest"                 [YELLOW: fragile]
│   │   └── @sparkleideas/shared ^3.0.0-alpha.1         [OK]
│   ├── @sparkleideas/memory (dedup)
│   └── @sparkleideas/shared (dedup)
│
├── @sparkleideas/mcp ^3.0.0-alpha.8                    [ETARGET: prerelease caret]
├── @sparkleideas/shared ^3.0.0-alpha.1                 [OK]
│
├── (optional) @ruvector/attention ^0.1.4               [OK]
├── (optional) @ruvector/learning-wasm ^0.1.29          [OK]
├── (optional) @ruvector/router ^0.1.27                 [OK]
├── (optional) @ruvector/sona ^0.1.5                    [OK]
├── (optional) @sparkleideas/codex >=3.0.0-alpha.8      [ETARGET: prerelease caret]
│   └── (peer) @sparkleideas/cli ^3.0.0-alpha.1        [ETARGET: cross-tuple]
├── (optional) @sparkleideas/embeddings >=3.0.0-alpha.12 [ETARGET: prerelease caret]
│   └── (peer) @sparkleideas/agentic-flow ^2.0.0       [ETARGET: no stable 2.x]
└── (optional) @sparkleideas/plugin-gastown-bridge ^0.1.2 [404: not published]

Legend:  ├── direct    (optional)    (peer)    [ETARGET] = fatal    [OK] = resolves
```

### 3.2 ETARGET Blockers (5 independent issues)

| # | Dep Spec | Available | Root Cause |
|---|----------|-----------|------------|
| 1 | `@sparkleideas/agentdb "alpha"` (dist-tag) | No `alpha` tag exists | memory declares dep as dist-tag reference |
| 2 | `@sparkleideas/agentdb >=2.0.0-alpha.1` (peerDep) | 3.0.0-alpha.5 | Prerelease `>=` locks to `2.0.0-alpha.*` tuple |
| 3 | `@sparkleideas/cli ^3.0.0-alpha.1` (codex peerDep) | 3.1.0-alpha.18 | Prerelease caret locks to `3.0.0-alpha.*` tuple |
| 4 | `@sparkleideas/mcp ^3.0.0-alpha.8` (CLI dep) | 3.0.0-alpha.9+ | `^alpha.8` = `[alpha.8, alpha.9)` — excludes alpha.9 |
| 5 | `@sparkleideas/plugin-gastown-bridge ^0.1.2` | N/A | Package never published |

### 3.3 Circular Dependencies

```
@sparkleideas/cli ──(optional)──> @sparkleideas/codex ──(peer)──> @sparkleideas/cli
```

One circular chain: CLI optionally depends on codex, which declares CLI as a peer dep.

---

## 4. Cross-Package Conflict Classification

### 4.1 Summary

| Classification | Count | Packages |
|---------------|-------|----------|
| **RED** (cannot resolve) | 8 | agentic-flow, memory, embeddings, codex, aidefence, browser, integration, claude-flow |
| **YELLOW** (resolves with issues) | 7 | neural, hooks, plugins, claims, guidance, performance, testing |
| **GREEN** (clean) | 9 | agentdb, ruv-swarm, shared, mcp, providers, deployment, swarm, security, cli |

### 4.2 All Problematic PeerDependencies

| Package | Peer Dependency | Range | Problem |
|---------|----------------|-------|---------|
| `embeddings` | `@sparkleideas/shared` | `^3.0.0-alpha.1` | Prerelease caret — won't match `3.5.2-patch.1` |
| `embeddings` | `@sparkleideas/agentic-flow` | `^2.0.0` | Stable range — won't match prereleases (only `2.0.2-alpha.*` exist) |
| `codex` | `@sparkleideas/cli` | `^3.0.0-alpha.1` | Prerelease caret — won't match `3.1.0-alpha.*` |
| `aidefence` | `@sparkleideas/agentdb` | `>=2.0.0-alpha.1` | Prerelease floor — won't match `3.0.0-alpha.*` |
| `hooks` | `@sparkleideas/shared` | `^3.0.0-alpha.1` | Prerelease caret — resolves old alphas only |
| `browser` | `@sparkleideas/cli` | `^3.0.0-alpha.140` | No `3.0.0-alpha.140+` exists |
| `plugins` | `@sparkleideas/hooks` | `^3.0.0-alpha.2` | Prerelease caret |
| `plugins` | `@sparkleideas/memory` | `^3.0.0-alpha.2` | Prerelease caret |
| `claims` | `@sparkleideas/shared` | `^3.0.0-alpha.1` | Prerelease caret |
| `integration` | `@sparkleideas/agentic-flow` | `^2.0.0-alpha` | Prerelease caret — `2.0.0-alpha.*` tuple, no match |
| `testing` | `@sparkleideas/swarm` | `^3.0.0-alpha.1` | Prerelease caret |
| `testing` | `@sparkleideas/memory` | `^3.0.0-alpha.2` | Prerelease caret |
| `testing` | `@sparkleideas/shared` | `^3.0.0-alpha.1` | Prerelease caret |
| `agentic-flow` | `flow-nexus` | `^1.0.0` | No `1.0.0` exists (max `0.2.0`) |
| `agentic-flow` | `@sparkleideas/claude-flow` | `^2.7.0` | Resolves to `2.7.49` — OK |
| `providers` | `@ruvector/ruvllm` | `^0.2.3` | OK — stable range |

### 4.3 Dist-Tag References in Dependencies

| Package | Dependency | Value | Risk |
|---------|-----------|-------|------|
| `memory` | `@sparkleideas/agentdb` | `"alpha"` | No `alpha` dist-tag exists → ETARGET |
| `neural` | `@ruvector/sona` | `"latest"` | Non-deterministic resolution |
| `performance` | `@ruvector/sona` | `"latest"` | Non-deterministic resolution |
| `performance` | `@ruvector/attention` | `"latest"` | Non-deterministic resolution |

---

## 5. Versioning Scheme Analysis

### 5.1 Scheme

**ADR-0012 (rewritten 2026-03-06)**: Bump-last-segment scheme.

```
next_version = bumpLastSegment( max(upstream_version, last_published) )
```

- `bumpLastSegment()` increments the trailing numeric segment by 1
- Edge case: versions ending in non-numeric (`2.0.2-alpha`) append `.1` → `2.0.2-alpha.1`
- Per-package tracking via `config/published-versions.json`
- `semverCompare()` handles core + prerelease comparison per spec

### 5.2 Publish Pipeline

| Phase | Action |
|-------|--------|
| 1 | Load state from `.last-build-state` |
| 2 | Check upstream HEADs via `git ls-remote` (3 repos) |
| 3 | Check local commits in `patch/` and `scripts/` |
| 4 | Pull upstream repos |
| 5 | Copy + merge 3 repos into temp build dir |
| 6 | Codemod: `@claude-flow/*` → `@sparkleideas/*` |
| 7 | Apply patches (`patch-all.sh`) |
| 8 | Build (`pnpm install` + `pnpm build`) |
| 9 | Test |
| 10 | Compute version (for logging/tags) |
| 11 | Publish via `publish.mjs` (5 levels, 2s rate limit) |
| 12 | Create GitHub release (`sparkleideas/v{version}`) |
| 13 | Save state |

### 5.3 Topological Publish Order (ADR-0014)

| Level | Packages | Count |
|-------|----------|-------|
| 1 | agentdb, agentic-flow, ruv-swarm | 3 |
| 2 | shared, memory, embeddings, codex, aidefence | 5 |
| 3 | neural, hooks, browser, plugins, providers, claims | 6 |
| 4 | guidance, mcp, integration, deployment, swarm, security, performance, testing | 8 |
| 5 | cli, claude-flow | 2 |
| **Total** | | **24** |

### 5.4 Known Pipeline Limitations

1. **State only persisted on full success** — partial failures leave stale `published-versions.json` (safe but retries on next run)
2. **Test helpers don't match real state format** — `pipeline-helpers.mjs` uses `AGENTIC_FLOW_HEAD` but `sync-and-build.sh` writes `AGENTIC_HEAD`
3. **Rate limiting is hardcoded** (2s) with no backoff on 429 responses
4. **Codemod doesn't fix peerDeps** — upstream prerelease caret ranges are preserved, causing the ETARGET issues documented in Section 3
5. **No rollback** for partially-published levels
6. **First-publish prerelease exception** — alpha packages go to `prerelease` tag, not `latest`, leaving `npm install @sparkleideas/shared` unresolvable until manual dist-tag fix

---

## 6. End-to-End Installability

### 6.1 Test Results

| Test | Version | Method | Result |
|------|---------|--------|--------|
| `npx --version` | 3.1.0-alpha.18 | Fresh install | **FAIL** — ETARGET |
| `npx --version` | 3.1.0-alpha.17 | Fresh install | **FAIL** — ETARGET |
| `npx --version` | 3.5.2-patch.1 | Fresh install | **FAIL** — ETARGET |
| `npx --version` | 3.1.0-alpha.17 | From npx cache | **PASS** — `claude-flow v3.1.0-alpha.17` |
| `npm install` | 3.1.0-alpha.18 | Fresh project | **FAIL** — ETARGET |
| `npm install --legacy-peer-deps` | 3.1.0-alpha.17 | Fresh project | **FAIL** — ETARGET (different blocker) |
| `npx init` | 3.1.0-alpha.17 | From cache | **PASS** — 111 files, 12 dirs |
| CLAUDE.md audit | N/A | grep | **PASS** — 14 `@sparkleideas/cli`, 0 `@claude-flow/cli` |

### 6.2 Package Size

| Version | Files | Unpacked Size |
|---------|-------|---------------|
| 3.1.0-alpha.17 | 993 | 8.4 MB (includes compiled dist/) |
| 3.1.0-alpha.18 | 360 | 2.6 MB (source-only, no dist/) |

**Note**: alpha.18 is missing the compiled `dist/` directory (69% smaller), meaning even if dependency resolution succeeded, the CLI binary would fail with `ERR_MODULE_NOT_FOUND`.

### 6.3 Verdict

**ALL versions of @sparkleideas/cli are currently uninstallable from a clean state.** The only working path is via a pre-existing npx cache from a previous successful install (e.g., alpha.17 was installable briefly before the automated republish cycle overwrote the fixed peerDeps).

---

## 7. Root Cause Analysis

### 7.1 The Core Problem: npm Prerelease Semver Behavior

npm's semver implementation treats prerelease ranges differently from what most developers expect:

| Range | Expected Behavior | Actual npm Behavior |
|-------|-------------------|---------------------|
| `^3.0.0-alpha.1` | Match any `>=3.0.0-alpha.1 <4.0.0` | Only matches `3.0.0-alpha.*` (same major.minor.patch tuple) |
| `>=3.0.0-alpha.1` | Match any version `>=3.0.0-alpha.1` | Only matches `3.0.0-alpha.*` (same tuple) |
| `^3.0.0-alpha.8` | Match `>=3.0.0-alpha.8 <4.0.0` | Matches `>=3.0.0-alpha.8 <3.0.0-alpha.9` only |
| `^2.0.0` (stable) | Match any `>=2.0.0 <3.0.0` | Does NOT match `2.0.2-alpha.1` (prereleases excluded from stable ranges) |

This means:
- `^3.0.0-alpha.1` will NOT match `3.1.0-alpha.18` or `3.5.2-patch.1`
- `^3.0.0-alpha.8` will NOT match `3.0.0-alpha.9` (alpha.9 is "next patch" in prerelease terms)
- `>=2.0.0-alpha.1` will NOT match `3.0.0-alpha.5`

### 7.2 Why the Automated Republish Broke Things

The manual peerDep fixes applied to alpha.17 (changing `^3.0.0-alpha.1` → `*`, etc.) were applied directly to the build directory, not to the upstream source. When the automated republish cycle ran (producing alpha.18), it:

1. Pulled fresh upstream source
2. Applied the codemod (`@claude-flow` → `@sparkleideas`)
3. **Did NOT fix peerDeps** — the codemod only changes package names, not version ranges
4. Published packages with the original broken peerDep ranges

### 7.3 Why `latest` Tag Points to `3.5.2-patch.1`

The initial (broken) publish used `npm publish --access public` with no `--tag` flag, which sets `latest` automatically. Subsequent publishes used `--tag prerelease`. The `latest` tag was never updated to point to the correct versions.

---

## 8. What Changed vs Pre-Patch Analysis

### 8.1 Problems Fixed

| Issue | Before | After |
|-------|--------|-------|
| Wrong versions (all stamped `3.5.2-patch.1`) | All 24 packages had same version | Each package has independent version |
| `-patch.N` suffix breaks caret ranges | `@sparkleideas/cli@^3.5.2` → ETARGET | Bump-last-segment produces valid semver |
| No per-package tracking | Single project-wide version | `config/published-versions.json` tracks 25 packages |
| Missing `dist/` in CLI | CLI alpha.17 has dist/ (993 files) | alpha.17 works (alpha.18 regressed) |
| CLAUDE.md references | `@claude-flow/cli` in generated files | `@sparkleideas/cli` (14 refs, 0 leaks) |
| No topological publish order | Manual publishing | 5-level automated pipeline (ADR-0014) |
| No version computation | Manual version selection | `bumpLastSegment(max(upstream, lastPublished))` |

### 8.2 Problems Introduced

| Issue | Description | Severity |
|-------|-------------|----------|
| Broken `latest` dist-tag | Points to `3.5.2-patch.1` for all packages | Critical |
| Codemod doesn't fix peerDeps | Upstream prerelease ranges preserved verbatim | Critical |
| alpha.18 missing `dist/` | Automated republish didn't build TypeScript | Critical |
| State file format mismatch | Test helpers don't match real `sync-and-build.sh` format | Medium |

### 8.3 Problems Inherited From Upstream (Unchanged)

| Issue | Description |
|-------|-------------|
| Prerelease peerDep ranges | `^3.0.0-alpha.1`, `>=2.0.0-alpha.1` etc. across 11 packages |
| Dist-tag references in deps | `memory` → `agentdb "alpha"`, `neural` → `sona "latest"` |
| `flow-nexus` peerDep mismatch | `agentic-flow` requires `^1.0.0` but max is `0.2.0` |
| Missing `plugin-gastown-bridge` | Referenced as optional dep of CLI but never published |
| Source-only packages | Most packages ship TypeScript source without compiled `dist/` |

---

## 9. Recommendations

### 9.1 Critical Fixes (Blocking Installability)

**P0-A: Add peerDep fixing to the codemod pipeline**

The codemod must rewrite problematic peerDep ranges, not just package names. For all `@sparkleideas/*` peerDeps and deps:
- Replace `^X.Y.Z-alpha.N` with `*` (or remove the peerDep entirely)
- Replace `>=X.Y.Z-alpha.N` with `*`
- Replace dist-tag references (`"alpha"`, `"latest"`) with `*` or pinned ranges

**P0-B: Fix the `latest` dist-tag**

For each package, run:
```bash
npm dist-tag add @sparkleideas/{pkg}@{prerelease-version} latest
```
This makes `npm install @sparkleideas/cli` resolve to the correct version.

**P0-C: Ensure TypeScript is compiled before publish**

The publish pipeline must run `tsc` (or copy upstream `dist/`) before publishing the CLI and any other TypeScript-only packages. Alpha.17 worked because dist/ was manually copied from upstream; alpha.18 regressed because the automated pipeline skipped the build step.

### 9.2 High Priority Fixes

**P1-A: Publish `@sparkleideas/plugin-gastown-bridge`** or remove it from CLI's optional deps.

**P1-B: Fix the `^3.0.0-alpha.8` caret range issue** in CLI's deps on mcp, codex, and embeddings. The caret range `^3.0.0-alpha.8` in npm means `[3.0.0-alpha.8, 3.0.0-alpha.9)` — it excludes the very next alpha. Either pin exact versions or use `>=` with `*` peerDeps.

**P1-C: Align test helpers with actual state format** — `pipeline-helpers.mjs` uses different key names than `sync-and-build.sh`.

### 9.3 Medium Priority

**P2-A: Consider publishing stable (non-prerelease) versions** for packages like `shared`, `memory`, `hooks` that are mature enough. This eliminates all prerelease semver edge cases.

**P2-B: Add a CI verification step** that does `npm install @sparkleideas/cli@{version}` in a clean environment after each publish cycle.

**P2-C: Track the `latest` dist-tag state** in `published-versions.json` or a separate file, and update it as part of the publish pipeline.

---

## 10. Comparison to Pre-Patch Analysis

### Issues Resolved

| Pre-Patch Issue | Status |
|-----------------|--------|
| 12 sub-packages stale (published Jan 6, never updated) | **Resolved** — all 24 packages republished |
| All stamped `3.5.2-patch.1` (wrong per-package versions) | **Resolved** — independent per-package versions |
| `-patch.N` suffix breaks semver caret ranges | **Resolved** — bump-last-segment scheme |
| No automated publish pipeline | **Resolved** — 13-phase pipeline with topological ordering |
| Missing git tags | **Resolved** — `sparkleideas/v{version}` tags |
| @claude-flow references in generated CLAUDE.md | **Resolved** — codemod rewrites to @sparkleideas |

### Issues Remaining

| Pre-Patch Issue | Current Status |
|-----------------|----------------|
| ControllerRegistry not exported (ADR-053) | Still missing in published memory package |
| @ruvector/ruvllm spec error (`^0.2.3` vs `2.5.1`) | Still present in providers peerDep |
| agentdb dual-track alpha | Partially resolved (both tracks forked) |
| Package size (35s cold start) | Unchanged |
| MCP server version display confusion | Unchanged |

### New Issues

| Issue | Severity |
|-------|----------|
| `latest` dist-tag points to broken `3.5.2-patch.1` | Critical |
| Codemod doesn't fix upstream peerDep ranges | Critical |
| alpha.18 missing compiled dist/ | Critical |
| 8 RED dependency conflicts | Critical |
| 4 dist-tag references in deps | High |

---

## 11. Summary Statistics

| Metric | Count |
|--------|-------|
| Total @sparkleideas/* packages published | 24 |
| Packages tracked in published-versions.json | 25 |
| Packages ahead of upstream | 16 |
| Packages behind upstream | 4 (agentdb, memory, cli, claude-flow) |
| Packages synced with upstream | 1 (ruv-swarm) |
| RED dependency conflicts | 8 |
| YELLOW dependency conflicts | 7 |
| GREEN (clean resolution) | 9 |
| Problematic peerDependencies | 16 ranges across 11 packages |
| Dist-tag references in deps | 4 |
| ETARGET blockers for CLI install | 5 |
| Fresh install working | No |
| Cached install working | Yes (alpha.17 only) |
| Test suite | 82/82 pass |
| GitHub releases | `sparkleideas/v3.1.0-alpha.17` |
