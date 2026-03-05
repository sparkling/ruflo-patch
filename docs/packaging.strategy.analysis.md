# Packaging Strategy Analysis: 11 Approaches to Local Package Independence

**Date**: 2026-03-05
**Source**: 5-architect hive-mind analysis (mesh topology, Byzantine consensus)
**Context**: All upstream repos (`ruvnet/ruflo`, `ruvnet/ruvector`, `ruvnet/agentic-flow`, `ruvnet/ruv-FANN`, etc.) are public but not under our control. Maintainers are unresponsive to PRs and issues. npm packages are stale (60% of `@claude-flow/*` unpublished since January 6, 933 commits behind in ruflo alone). We want to use the latest code locally and share our solution publicly.

**Prerequisite reading**: [versioning.and.packaging.analysis.md](versioning.and.packaging.analysis.md) — full ecosystem inventory (48+ packages, 7 repos, version drift data)

---

## 1. Problem Statement

The ruvnet ecosystem spans 48+ npm packages across 7 public GitHub repositories. The npm-published versions are months behind the source repos:

| Repo | Unpublished Commits | Stale Packages |
|------|---------------------|----------------|
| `ruvnet/ruflo` | 933 | 12 of 20 `@claude-flow/*` |
| `ruvnet/agentic-flow` | 540 | `agentdb`, `agentic-flow` |
| `ruvnet/ruvector` | 172 | 10 of 22 `@ruvector/*` |
| `ruvnet/ruv-FANN` | 159 days stale | `ruv-swarm` |

We have no write access to these repos or npm packages. We need a way to use the latest code locally and distribute it publicly.

---

## 2. All 11 Approaches Enumerated

### Approach 1: Fork + Republish (New npm Scope)

Fork all 7 repos, republish every package under a new scope (e.g., `@ruflo-patch/cli`), rewriting all internal cross-references.

**Steps**:
1. Create GitHub org and npm scope
2. Fork all 7 repos
3. Rewrite `name` fields in ~261 `package.json` files
4. Rewrite import/require statements in ~4,136 source files
5. Fix 2 RED semver conflicts (`@ruvector/ruvllm` `^0.2.3` vs `2.5.1`, `agentdb` dual-track alpha)
6. Cross-compile 42 platform-specific ruvector native binaries (Rust/napi-rs)
7. Set up CI/CD for topological publish ordering (5 dependency levels)
8. Publish ~100 packages bottom-up

**Effort**: Huge (4-6 weeks for one person)
**Ongoing**: 1-3 days per upstream sync (merge conflicts on every rewritten file)

**Pros**:
- Complete independence — own the full stack
- All latest code, including never-published packages like `coflow`
- Public distribution under clear fork identity

**Cons**:
- 4,136+ source file rewrites for scope changes
- 42 platform-specific native binary packages require Rust cross-compilation CI
- Every upstream merge conflicts on name-rewritten files
- Highest initial effort of any approach

**License**: All repos are MIT — forking and republishing is explicitly permitted. Must preserve original LICENSE and copyright notices.

---

### Approach 2: Local Build from Source (npm link)

Clone all repos, build from HEAD, wire together with `npm link` or `pnpm link`. Never publish to npm.

**Steps**:
1. Clone all 4 primary repos
2. Install Rust toolchain + wasm-pack (for ruvector)
3. Build bottom-up: ruvector -> agentdb -> agentic-flow -> ruv-swarm -> `@claude-flow/*` -> CLI
4. `npm link` each package globally, then link into consumers
5. Create shell alias or global link for CLI access

**Effort**: Large (1-2 days)
**Ongoing**: 15-45 min per `git pull` + rebuild cycle

**Pros**:
- No registry needed, no publishing
- Full source-level debugging
- Standard npm feature

**Cons**:
- `npx @claude-flow/cli@latest` does NOT work — must change invocation to alias or absolute path
- `npm install` silently removes symlinks (must re-link after every install)
- pnpm strict `node_modules` causes phantom dependency failures
- Native builds (ruvector napi-rs, better-sqlite3) are platform-specific
- No guarantee HEAD across 4 independent repos is mutually compatible
- Not distributable to others without them repeating the entire process

---

### Approach 3: Expanded Patch Overlay (Inject into npx Cache)

Extend the current ruflo-patch system to replace entire compiled files in the npx cache rather than surgical string replacements.

**Steps**:
1. Clone upstream repos, build from source
2. Copy built `dist/` trees into npx cache locations, overwriting stale published files
3. Run existing `patch-all.sh` on top for ruflo-patch-specific customizations
4. Install any missing npm dependencies into the cache's `node_modules`

**Effort**: Large (8-15 days)
**Ongoing**: 0.5-1 day/month

**Pros**:
- `npx @claude-flow/cli@latest` continues to work
- Builds on existing patch infrastructure
- Captures all 933 commits in one copy operation

**Cons**:
- **Fundamentally the wrong abstraction** for 933 commits of divergence (architect consensus)
- npx cache invalidation destroys everything (npm cache clean, upstream publish, npm version upgrade)
- No version control of the patched output
- Every npm ecosystem tool (`npm ls`, `npm audit`, `npm outdated`) reports incorrect information
- Missing dependencies in the cache cause runtime `MODULE_NOT_FOUND` crashes
- Ruvector native packages cannot be file-replaced — must use published versions
- Functionally identical to `npm link` but without the tooling support

**Architect 3's verdict**: "When you need to backport 933 commits across 21 sub-packages and 1,074 JS files, you are not patching — you are maintaining a shadow fork. The patch abstraction obscures what is really happening."

---

### Approach 4: Private npm Registry (Verdaccio)

Run a local Verdaccio registry as a transparent proxy. Build from source, publish under original package names. npm/npx resolves from Verdaccio first, which proxies to public npm for packages you haven't overridden.

**Steps**:
1. Install Verdaccio: `npm install -g verdaccio` or `docker run verdaccio/verdaccio`
2. Configure `.npmrc`: `registry=http://localhost:4873`
3. Clone upstream repos, build from HEAD
4. `npm publish --registry http://localhost:4873` for each rebuilt package
5. Use version scheme higher than public (e.g., `3.5.3-ruflo.1`)

**Effort**: Medium (6-12 hours initial)
**Ongoing**: 30 min per rebuild + republish cycle

**Pros**:
- **Zero code changes** — packages keep their original names, all cross-references resolve correctly
- `npx @claude-flow/cli@latest` works unchanged via registry redirect
- Only publish stale packages; in-sync packages (8 of 20 `@claude-flow/*`) proxy through
- Can skip ruvector rebuild entirely — proxy through to published versions (relatively current)
- Dockerizable for portability and team sharing
- Standard npm workflow, no symlinks, no overrides
- Can coexist with existing ruflo-patch for additional targeted fixes

**Cons**:
- Must run a local service (lightweight — single process, file-based storage)
- `.npmrc` must be configured (project-level `.npmrc` mitigates this)
- Risk of accidentally pulling from public npm if `.npmrc` misconfigured
- Version confusion between private and public packages (mitigated by distinctive version tags)
- Still requires building from source (the ruvector Rust build is 2-4 hours first time)

**Registry options**:

| Registry | Scope Restrictions | Free Tier | Best For |
|----------|-------------------|-----------|----------|
| **Verdaccio** | None | Fully free, self-hosted | Single dev or small team |
| GitHub Packages | Must match GitHub org scope | Free for public | Disqualified (can't use original names) |
| GitLab Registry | None | Free for public | Alternative to Verdaccio |
| AWS CodeArtifact | None | $0.05/GB/month | Teams on AWS |

**Note on public distribution**: Verdaccio can be exposed publicly or its storage directory shared. For true public distribution, publishing to npm under a new scope (Approach 1) or using GitHub Packages under your own scope is more appropriate. Verdaccio excels as a local/team solution.

---

### Approach 5: Git Subtree Mega-Repo

Merge all 7 repos into a single monorepo using `git subtree add`. Set up a unified workspace build.

**Effort**: Large
**Ongoing**: Medium (subtree pulls are messy)

**Pros**:
- Single `git pull` per subtree keeps current
- Full source-level debugging, preserves git history
- Can build everything with one command once wired up

**Cons**:
- Subtrees create large merge commits and messy history
- Must harmonize 3 different workspace systems (pnpm, npm workspaces, Cargo)
- Ruvector Rust/WASM build is a separate universe from Node/TypeScript
- Must patch workspace configs for cross-repo paths
- Not npx compatible without additional steps

---

### Approach 6: esbuild/rollup Fat Bundle

Use esbuild to create a single fat bundle from all source, bypassing the package system entirely.

**Effort**: Medium-Large

**Pros**:
- Eliminates multi-package resolution entirely
- Extremely fast cold start (one file)
- esbuild rebuilds in seconds

**Cons**:
- **Dynamic imports break** — `memory-bridge.js` dynamically imports `@claude-flow/memory`, which bundlers cannot trace statically
- **Native addons cannot be bundled** — better-sqlite3, ruvector napi-rs
- **WASM modules need special treatment** — sql.js alone is 18MB
- Debugging harder with bundled source
- All-or-nothing — cannot patch individual packages

**Handles 48+ packages?**: Only the ~30 pure-JS/TS packages. The ~18 native/WASM packages require separate handling.

---

### Approach 7: npm pack + Local Tarballs

Build from source, `npm pack` each package into `.tgz` files, install from local tarballs.

**Effort**: Medium

**Pros**:
- Standard npm feature, fully supported
- Tarballs are portable — can be committed to a repo or shared
- No symlink issues (unlike npm link)
- Works with any npm/pnpm/yarn client

**Cons**:
- Must rebuild and repack on every upstream update
- Version specifiers in `package.json` must match tarball versions (may need overrides)
- 2 RED conflicts still need manual resolution in source
- Not npx compatible without additional steps

---

### Approach 8: pnpm/npm overrides

Use `package.json` `overrides` (npm) or `pnpm.overrides` to redirect dependency resolution to local paths.

**Effort**: Small-Medium

**Pros**:
- Surgical precision — override only the 12 stale packages, leave the rest alone
- Standard npm/pnpm feature
- Can mix `file:` protocol (tarballs) and `link:` protocol (directories)

**Cons**:
- `link:` creates symlinks with the usual fragility
- Must still build local packages from source
- Overrides apply globally — cannot split for packages needing different versions
- Only practical for a development workflow, not distribution

---

### Approach 9: Nix Flake Reproducible Build

Write a Nix flake that declares all 7 repos as inputs, builds everything hermetically.

**Effort**: Large

**Pros**:
- Fully reproducible — bit-identical output
- Binary caching means rebuilds only touch changed packages
- Handles Rust + Node + WASM in one unified system
- Pin to any commit across all 7 repos

**Cons**:
- Steep Nix learning curve
- pnpm workspaces + napi-rs + Nix is an unsolved problem
- Team members must install Nix
- Ongoing maintenance as upstream changes build systems

---

### Approach 10: Docker Container

Dockerfile that clones all repos, installs toolchains, builds everything, produces a complete image.

**Effort**: Medium

**Pros**:
- Completely self-contained
- No dependency on npm registry
- Easy to version and distribute (image tags)
- CI/CD friendly

**Cons**:
- Large image (2-4 GB with Rust toolchain + Node + 48 packages)
- Development workflow is awkward (volume mounts, rebuilds)
- Not suitable for `npx` invocation pattern
- Platform-specific native binaries (Linux container = Linux binaries only)

---

### Approach 11: npx Cache Snapshot

Build everything, then snapshot `~/.npm/_npx/` and distribute as a tarball.

**Effort**: Small

**Pros**:
- `npx @claude-flow/cli@latest` works with zero config
- Fastest setup on new machines (extract tarball, done)
- Existing ruflo-patches can be pre-applied

**Cons**:
- npx cache paths include content-addressable hashes that differ between npm versions
- Native addons are platform-specific — snapshot not portable
- npx may overwrite cache on detecting newer registry version
- npm internal cache format is not a stable API
- Most fragile option

---

## 3. The Ruvector Sub-Problem

Every approach shares one hard dependency: **ruvector requires a Rust toolchain** (napi-rs + wasm-pack) to build from source. The 22+ packages include:
- Native `.node` binaries (platform-specific, compiled via napi-rs)
- WASM modules (compiled via wasm-pack)
- 42 platform-specific binary distribution packages

**However**, ruvector's npm packages are the most current in the ecosystem (latest publish: March 3, 2026). The pragmatic shortcut for most approaches is to **keep the published ruvector packages** and only rebuild the TypeScript-only ecosystem (`@claude-flow/*`, `agentdb`, `agentic-flow`). This eliminates the Rust toolchain requirement entirely.

Only Approach 1 (Fork + Republish) absolutely requires ruvector rebuilds, because the packages must be renamed.

---

## 4. Comparative Matrix

| # | Approach | Effort | npx? | All 48? | Fragility | Public Dist? |
|---|----------|--------|------|---------|-----------|-------------|
| 1 | Fork + Republish | Huge (4-6 wk) | Yes | Yes | Low | **Yes (npm)** |
| 2 | Local Build + link | Large (1-2 d) | No | Yes | High | No |
| 3 | Expanded Patches | Large (8-15 d) | Yes | Partial | Very High | No |
| 4 | **Verdaccio Registry** | **Med (6-12 h)** | **Yes** | **Yes** | **Low** | **Partial** |
| 5 | Git Subtree Mega-Repo | Large | No | Yes | Medium | No |
| 6 | esbuild Fat Bundle | Med-Large | No | Partial | Medium | Possible |
| 7 | npm pack Tarballs | Medium | No | Yes | Medium | **Yes (tarballs)** |
| 8 | pnpm overrides | Small-Med | Partial | Targeted | Medium | No |
| 9 | Nix Flake | Large | No | Yes | Low | **Yes (flake)** |
| 10 | Docker Container | Medium | No | Yes | Low | **Yes (image)** |
| 11 | npx Cache Snapshot | Small | Yes | Yes | Very High | No |

---

## 5. Hive-Mind Consensus Ranking

### 1st: Verdaccio Private Registry (Approach 4)

The clear winner for local use. Zero code changes, full npx compatibility, lowest effort-to-value ratio. Can skip the ruvector Rust build entirely by proxying those packages through to public npm.

For **public distribution**, Verdaccio alone is insufficient — it is a local/team tool. Combine with Approach 7 (npm pack tarballs) or Approach 1 (fork + republish under new scope) for public sharing.

### 2nd: Verdaccio + Fork Hybrid (Approaches 4 + 1)

Use Verdaccio locally for development. For public distribution, maintain a fork under a new npm scope with only the TypeScript packages renamed (skip the 42 ruvector platform binaries — depend on the published versions). This cuts the Fork + Republish effort from 4-6 weeks to ~1 week by:
- Keeping `@ruvector/*` and `ruvector` as-is (depend on public npm versions)
- Only renaming the ~20 `@claude-flow/*` packages + `agentdb` + `agentic-flow` + `ruv-swarm`
- Skipping the Rust cross-compilation pipeline entirely

### 3rd: npm pack Tarballs (Approach 7)

Build from source, pack into `.tgz` files, distribute via GitHub Releases or a shared directory. Recipients install with `npm install ./package.tgz`. Standard, portable, no infrastructure needed.

---

## 6. Public Distribution Strategy

Since all upstream repos are MIT-licensed and we want to share publicly:

| Distribution Channel | Works With | Effort | Audience |
|---------------------|-----------|--------|----------|
| **npm under new scope** (e.g., `@ruflo-patch/*`) | `npx`, `npm install` | Medium-High | npm users worldwide |
| **GitHub Releases** (tarballs) | `npm install <url>` | Low | GitHub followers |
| **Docker Hub / ghcr.io** (pre-built image) | `docker run` | Medium | Container users |
| **Verdaccio storage export** (tarball of registry) | Self-hosted Verdaccio | Low | Power users |
| **Nix flake** | `nix run` | High | Nix users |

The most impactful public distribution is **npm under a new scope** because it integrates with the standard toolchain everyone already uses. The Verdaccio approach provides the development workflow; the fork + republish provides the distribution mechanism.

---

## 7. License Compliance

All source repos use MIT license:

| Repo | License | Permits Fork + Republish? |
|------|---------|--------------------------|
| `ruvnet/ruflo` | MIT | Yes |
| `ruvnet/ruvector` | MIT | Yes |
| `ruvnet/agentic-flow` | MIT | Yes |
| `ruvnet/ruv-FANN` | MIT | Yes |
| `ruvnet/dspy.ts` | MIT | Yes |
| `ruvnet/sublinear-time-solver` | MIT | Yes |
| `ruvnet/agenticsjs` | MIT | Yes |
| `ruv-swarm` (npm) | MIT OR Apache-2.0 | Yes |

**Requirements**: Preserve original LICENSE file and copyright notice in every republished package. No requirement to notify original author. May change package names, modify code, and redistribute commercially.

**Precedent**: `@sparkleideas/claude-flow-patch` (v3.1.0-alpha.44.patch.10) already exists on npm as a third-party fork — confirms this practice is accepted in the ecosystem.

---

## 8. Relationship to Existing ruflo-patch

The current patch system (MC-001, FB-001/002/003/004) remains valuable regardless of which approach is chosen:

| Patch | Still Needed? | Why |
|-------|--------------|-----|
| MC-001 (MCP autoStart) | Maybe | Independent CLI bug — check if fixed in HEAD |
| FB-001 (fallback instrumentation) | Yes | Our diagnostic logging, not an upstream fix |
| FB-002 (local helper instrumentation) | Yes | Our diagnostic logging |
| FB-003 (ControllerRegistry shim) | No (if building from HEAD) | ADR-053 fix exists in source |
| FB-004 (search threshold) | No (if building from HEAD) | Dynamic thresholds in source |

The patch system transitions from "compensating for publishing gaps" to "adding our own enhancements on top of a current codebase."

---

## 9. Recommended Implementation Order

1. **Now**: Set up Verdaccio locally for immediate development use
2. **Week 1**: Clone repos, build TypeScript packages, publish to Verdaccio
3. **Week 1-2**: Register npm scope, begin selective fork + republish for public distribution
4. **Week 2+**: Script the rebuild pipeline, automate upstream sync detection
5. **Ongoing**: ruflo-patch continues for enhancement patches; Verdaccio provides the current codebase

---

## 10. Summary Statistics

| Metric | Value |
|--------|-------|
| Approaches evaluated | 11 |
| Architects consulted | 5 |
| Recommended approach (local) | Verdaccio Private Registry |
| Recommended approach (public) | Verdaccio + Fork Hybrid |
| Packages needing rebuild (TypeScript only) | ~26 |
| Packages skippable (use published) | ~22 (ruvector ecosystem) |
| Estimated initial effort (Verdaccio) | 6-12 hours |
| Estimated initial effort (+ public fork) | 1-2 weeks |
| Ongoing maintenance | 30 min per sync cycle |
| License risk | None (all MIT) |
