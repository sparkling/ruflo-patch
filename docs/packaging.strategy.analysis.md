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

Fork all 7 repos, republish every package under a new scope (e.g., `@claude-flow-patch/cli`), rewriting all internal cross-references.

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

| # | Approach | Effort | npx? | All 48? | Fragility | Public? | Update Ease |
|---|----------|--------|------|---------|-----------|---------|-------------|
| 1 | Fork + Republish | Huge (4-6 wk) | Yes | Yes | Low | **Yes** | **Poor** |
| 2 | Local Build + link | Large (1-2 d) | No | Yes | High | No | Good |
| 3 | Expanded Patches | Large (8-15 d) | Yes | Partial | Very High | No | **Very Poor** |
| 4 | **Verdaccio Registry** | **Med (6-12 h)** | **Yes** | **Yes** | **Low** | No | **Good** |
| 5 | Git Subtree Mega-Repo | Large | No | Yes | Medium | No | Medium |
| 6 | esbuild Fat Bundle | Med-Large | No | Partial | Medium | Possible | Good |
| 7 | npm pack Tarballs | Medium | No | Yes | Medium | **Yes** | **Good** |
| 8 | pnpm overrides | Small-Med | Partial | Targeted | Medium | No | Good |
| 9 | Nix Flake | Large | No | Yes | Low | **Yes** | Good |
| 10 | Docker Container | Medium | No | Yes | Low | **Yes** | Good |
| 11 | npx Cache Snapshot | Small | Yes | Yes | Very High | No | Poor |

### Update Ease — Detailed Breakdown

When upstream pushes new commits, how much work does each approach require to incorporate them?

| # | Approach | Update Mechanism | Time per Sync | What Breaks |
|---|----------|-----------------|---------------|-------------|
| 1 | Fork + Republish | `git fetch upstream && merge` | **Hours** — thousands of merge conflicts on renamed files | Every upstream change to any file with imports |
| 2 | Local Build + link | `git pull && rebuild` | 15-45 min | Build breakage at HEAD |
| 3 | Expanded Patches | Rewrite patches against new base | **Hours-days** — patches break on any changed line | Every upstream change to patched files |
| 4 | Verdaccio | `git pull && rebuild && npm publish` | 30 min | Build breakage at HEAD |
| 5 | Git Subtree Mega-Repo | `git subtree pull` per repo | 30-60 min — subtree merges are messy | Workspace config changes |
| 6 | esbuild Fat Bundle | `git pull && rebundle` | Minutes | New dynamic imports or native deps |
| 7 | npm pack Tarballs | `git pull && rebuild && npm pack` | 30 min | Build breakage at HEAD |
| 8 | pnpm overrides | `git pull && rebuild` | 15 min | Build breakage at HEAD |
| 9 | Nix Flake | `nix flake update` | Minutes (cached) | Nix derivation breakage |
| 10 | Docker Container | `docker build` | 15-30 min | Dockerfile assumptions |
| 11 | npx Cache Snapshot | Rebuild + re-snapshot | 30 min, but fragile | npm cache format, auto-overwrites |

**Critical insight**: Approaches that **don't modify source files** (2, 4, 6, 7, 8, 9, 10) have clean `git pull` with zero merge conflicts. Approaches that **commit changes into the fork** (1, 3) create ongoing merge pain proportional to how many files were modified.

Approach 1 (Fork + Republish) modifies ~4,136 files for the scope rename. Every upstream merge will conflict on any of those files that upstream also changed. With 933 unpublished commits and active development, this means **hundreds to thousands of merge conflicts per sync**. This is the worst update story of any approach despite being the best for public distribution.

---

## 5. The Core Tradeoff: Verdaccio vs npm Republish

The 11 approaches collapse into two real choices, depending on the goal:

### Why not both? Why not a hybrid?

Verdaccio's sole advantage is **avoiding the ~4,136-file import rewrite**. It achieves this by publishing packages under their **original names** (`@claude-flow/memory`, `agentdb`, etc.) to a local registry that shadows public npm. Since the names don't change, zero source files need editing.

But you can't publish `@claude-flow/memory` to **public** npm — you don't own that scope. Public npm requires a new scope (e.g., `@claude-flow-patch/memory`), which means rewriting all cross-references anyway.

This makes the two approaches **mutually exclusive solutions to the same problem**, not complementary layers:

| | Verdaccio (local registry) | npm Republish (new scope) |
|---|---|---|
| Package names | Keep originals | Must rename |
| Files to rewrite | **0** | **~4,136** |
| Who can use it | Only you / your team | Anyone with `npm install` |
| Infrastructure | Must run a service | None |
| `npx` compatible | Yes (via `.npmrc`) | Yes (new scope name) |

**If you want public distribution**: go straight to fork + republish under a new npm scope. Verdaccio adds nothing — the rename work is required regardless, and once done, you install from public npm like everyone else.

**If you only need local use**: Verdaccio saves weeks of effort by skipping the rename entirely. But the result is private — not shareable via npm.

**Sequencing (not hybrid)**: You could use Verdaccio *now* (6-12 hours) to get a working local setup immediately, then tackle the scope rename *later* for public npm. This is sequencing, not a hybrid — Verdaccio becomes unnecessary once the public packages exist.

### The Merge Conflict Problem with Fork + Republish

Approach 1 has the best public distribution story but the **worst update story**. If you commit the scope rename directly into your fork, every `git merge upstream/main` will conflict on any file that both you (for the rename) and upstream (for new features) touched. With ~4,136 renamed files and an active upstream (933+ commits), this means:

- First sync: hundreds of merge conflicts
- Every subsequent sync: more conflicts, compounding over time
- Eventually the fork becomes unmergeable and you are maintaining a permanent hard fork

This is the central tension of the entire analysis: **the only approach that enables public npm distribution is also the hardest to keep current**.

### Solution: Rename as a Build Step, Not a Commit

The merge conflict problem disappears if you **never commit the renamed files**. Instead:

1. Fork the repos and keep them as **clean mirrors** of upstream (no modifications)
2. `git pull` syncs cleanly — zero conflicts, ever
3. A **build script** performs the scope rename on-the-fly:
   - Copies source to a temp directory
   - Runs a codemod to rewrite all package names and imports
   - Builds the TypeScript
   - Publishes to npm under the new scope
4. The rename logic lives in your build tooling, not in the source tree

This gives you the update ease of Verdaccio (clean `git pull`) with the public distribution of Fork + Republish:

| | Naive Fork (rename committed) | Build-Step Rename | Verdaccio |
|---|---|---|---|
| Files modified in fork | ~4,136 | **0** | 0 |
| Merge conflicts on sync | Hundreds-thousands | **0** | 0 |
| Public npm distribution | Yes | **Yes** | No |
| Update mechanism | Painful merge | **`git pull && ./build-and-publish.sh`** | `git pull && rebuild && publish` |
| Time per sync | Hours | **30 min** | 30 min |

The build-step rename is essentially **Approach 4 (Verdaccio) plus Approach 1 (Republish)** done right — the fork stays clean, the rename is ephemeral, and the output goes to public npm.

### Revised Consensus Ranking

**For public distribution (our goal):**

1. **Fork + Build-Step Rename + npm Publish** — clean fork mirrors upstream, build script applies scope rename on-the-fly, publishes to npm. Combines best update ease with public distribution. Effort: ~1 week initial (build the codemod + publish pipeline), 30 min per sync.
2. **npm pack Tarballs via GitHub Releases** (Approach 7) — lower effort alternative. Build from source, `npm pack`, attach `.tgz` files to GitHub Releases. Recipients install with `npm install <url>`. No scope rename needed if distributing as tarballs. Effort: 1-2 days.
3. **Docker image** (Approach 10) — pre-built container with everything working. Effort: medium.

**For immediate local use while building the pipeline:**

1. **Verdaccio** (Approach 4) — zero code changes, working in hours. Use as a bridge.
2. **pnpm overrides** (Approach 8) — override only the 12 stale packages. No infrastructure.

---

## 6. Public Distribution Strategy

Since all upstream repos are MIT-licensed and we want to share publicly, **npm under a new scope is the primary distribution channel**, using the build-step rename approach:

| Channel | How Users Install | Effort | Reach |
|---------|------------------|--------|-------|
| **npm under new scope** | `npx @claude-flow-patch/cli@latest` | ~1 week | Widest — standard npm toolchain |
| **GitHub Releases (tarballs)** | `npm install https://github.com/.../releases/download/v1/pkg.tgz` | 1-2 days | GitHub users |
| **Docker image** | `docker run ghcr.io/ruflo-patch/cli` | Medium | Container users |

### The Codemod

The scope rename is a **build-time codemod**, not a committed change. It runs as part of the publish pipeline:

```
git pull (clean fork)  -->  copy to temp dir  -->  codemod renames  -->  build  -->  npm publish
```

The ~4,136 files break down as:
- ~261 `package.json` files (name, dependencies, peerDependencies, optionalDependencies fields)
- ~3,875 JS/TS source files (import/require statements)

The codemod is a script using `sed`, `jscodeshift`, or a custom Node.js transform. It maps:
- `@claude-flow/*` -> `@claude-flow-patch/*` (e.g., `@claude-flow/memory` -> `@claude-flow-patch/memory`)
- `claude-flow` -> `@claude-flow-patch/claude-flow`
- `ruflo` -> `@claude-flow-patch/ruflo` (wrapper stays consistent)
- `agentdb` -> `@claude-flow-patch/agentdb`
- `agentic-flow` -> `@claude-flow-patch/agentic-flow`
- `ruv-swarm` -> `@claude-flow-patch/ruv-swarm`

The `@claude-flow-patch` scope mirrors the upstream `@claude-flow` scope with `-patch` appended, making it immediately recognizable as a patched fork of the same ecosystem.

Packages we do NOT rename (depend on published versions):
- `ruvector`, `@ruvector/*` — relatively current, Rust rebuild not needed
- Third-party deps (`better-sqlite3`, `ws`, `uuid`, etc.) — obviously unchanged

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

## 8. What `ruflo-patch` Becomes

### The Role of This Repo

`ruflo-patch` is a **drop-in replacement for `ruflo`**. It is the patched version of ruflo, rebuilt from the latest upstream source with our enhancements baked in. Same CLI, same commands, same flags — just swap the package name.

### End User Experience

```bash
# Instead of:  npx ruflo init
npx ruflo-patch init

# Instead of:  npx claude-flow agent spawn -t coder
npx ruflo-patch agent spawn -t coder

# Instead of:  npx claude-flow memory search --query "auth"
npx ruflo-patch memory search --query "auth"
```

MCP configuration:
```json
"command": "npx",
"args": ["-y", "ruflo-patch", "mcp", "start"]
```

The user replaces one word and gets the latest upstream code plus our enhancements. No setup step, no configuration, no second command.

### What Lives Where

| Component | Where | What It Does |
|-----------|-------|-------------|
| `ruflo-patch` | npm as `ruflo-patch` | The package users install and run — drop-in replacement for `ruflo` |
| `@claude-flow-patch/*` | npm under `@claude-flow-patch` scope | Internal dependencies of `ruflo-patch` (users never type these) |
| Upstream forks | GitHub (clean mirrors, no modifications) | Source for the build pipeline |
| Build pipeline | `scripts/` in this repo | Codemod + patch + build + publish |
| Enhancement patches | `patch/` in this repo | Our additions, baked into builds |

### How Patches Integrate

Patches are **applied during the build** before publishing to npm. The published packages already contain all fixes — there is no runtime patching step.

```
git pull (clean fork) -> codemod renames -> apply patches -> build -> publish to npm
```

| Patch | Disposition |
|-------|------------|
| MC-001 (MCP autoStart) | Applied during build if not fixed in HEAD |
| FB-001 (fallback instrumentation) | Applied during build — our enhancement |
| FB-002 (local helper instrumentation) | Applied during build — our enhancement |
| FB-003 (ControllerRegistry shim) | Dropped — fixed in upstream HEAD |
| FB-004 (search threshold) | Dropped — fixed in upstream HEAD |

### Naming

| Thing | Name | Relationship |
|-------|------|-------------|
| Upstream packages | `ruflo` / `claude-flow` / `@claude-flow/*` | The originals (stale) |
| Our package | `ruflo-patch` | Drop-in replacement for `ruflo` |
| Our internal scope | `@claude-flow-patch/*` | Internal deps (users never see these) |
| This repo | `ruflo-patch` | Source, build pipeline, and patches |

---

## 9. Keeping Current with Upstream

### Build Pipeline

The build runs on this server (32 cores, 200GB RAM). No external CI. A systemd timer triggers a bash script that does everything:

```
systemd timer (every 6 hours)
  -> scripts/sync-and-build.sh
      -> check for changes:
          -> git ls-remote each upstream repo (compare to last-built commit)
          -> git -C ruflo-patch log --oneline LAST_BUILD..HEAD -- patch/ (local patch changes)
      -> if nothing changed: exit
      -> git pull upstream forks (clean, zero conflicts)
      -> git -C ruflo-patch pull (get latest patches)
      -> copy to temp dir
      -> codemod: rename @claude-flow/* -> @claude-flow-patch/*
      -> apply enhancement patches from ruflo-patch/patch/
      -> pnpm install && pnpm build
      -> npm test
      -> if tests fail: gh issue create (you get email notification)
      -> if tests pass: npm publish --tag prerelease
      -> gh release create --prerelease (you get email notification)
```

### Publish Gate: Prerelease + Promotion

Builds publish to npm automatically but under the `prerelease` dist-tag — not `latest`. Users on `@latest` are unaffected until you explicitly promote.

```
Automated:  npm publish --tag prerelease     # available as ruflo-patch@prerelease
Manual:     npm dist-tag add ruflo-patch@3.5.2-patch.2 latest   # promote to @latest
```

The flow:

1. **Timer fires every 6 hours** — checks upstream repos AND this repo's `patch/` directory for changes
2. **Changes found** (upstream commits OR new/updated patches) — pulls, codemods, patches, builds, tests
3. **Tests pass** — publishes to npm as `prerelease`, creates GitHub prerelease
4. **GitHub sends you an email** — prerelease notifications are on by default
5. **You review at your convenience** — check changelog, optionally test with `npx ruflo-patch@prerelease`
6. **You promote** — `npm dist-tag add ruflo-patch@X.Y.Z-patch.N latest` (2 seconds)

If tests fail, a GitHub Issue is created instead. You get an email, investigate the failure, update patches if needed, and re-trigger manually.

**When you push a new patch**: just `git push`. The next timer run (within 6 hours) detects the change and rebuilds automatically. If you want it faster, run the script manually: `./scripts/sync-and-build.sh`.

### What Triggers a New Build

| Event | Detection | Action |
|-------|-----------|--------|
| Upstream push to `ruvnet/ruflo` | `git ls-remote` HEAD changed | Full rebuild |
| Upstream push to `ruvnet/agentic-flow` | `git ls-remote` HEAD changed | Full rebuild |
| Upstream push to `ruvnet/ruv-FANN` | `git ls-remote` HEAD changed | Full rebuild |
| We push new/updated patches | `git log LAST_BUILD..HEAD -- patch/` has commits | Full rebuild |
| We push build pipeline changes | `git log LAST_BUILD..HEAD -- scripts/` has commits | Full rebuild |
| No changes anywhere | Timer exits early | Nothing |
| Manual trigger | `./scripts/sync-and-build.sh` | Full rebuild (bypass timer) |

Note: `ruvnet/ruvector` is not monitored — we use the published `@ruvector/*` packages from public npm as-is.

### Patch Breakage Detection

When upstream changes code that our patches target, the patch can't find its target string. The build script detects this and:

1. Fails the build (does not publish)
2. Opens a GitHub Issue with: which patch broke, what the old target was, what the file looks like now
3. You update the patch and re-trigger

The existing `sentinel` system verifies each patch took effect post-build.

### Version Numbering

Our versions track upstream:

```
upstream:  claude-flow@3.5.2
ours:      ruflo-patch@3.5.2-patch.1
                              ^^^^^^^ our patch iteration
```

- Upstream bumps to `3.5.3` → we publish `ruflo-patch@3.5.3-patch.1`
- We update a patch → we publish `ruflo-patch@3.5.2-patch.2`

### systemd Configuration

```ini
# /etc/systemd/system/ruflo-sync.timer
[Unit]
Description=Check upstream ruflo repos for changes

[Timer]
OnCalendar=*-*-* 00/6:00:00
Persistent=true

[Install]
WantedBy=timers.target
```

```ini
# /etc/systemd/system/ruflo-sync.service
[Unit]
Description=Sync and build ruflo-patch from upstream

[Service]
Type=oneshot
User=claude
WorkingDirectory=/home/claude/src/ruflo-patch
ExecStart=/home/claude/src/ruflo-patch/scripts/sync-and-build.sh
CPUQuota=800%
```

```bash
systemctl enable --now ruflo-sync.timer
journalctl -u ruflo-sync     # view build logs
```

---

## 10. Recommended Implementation Order

1. **Day 1**: Fork repos as clean mirrors, register npm scope (`@claude-flow-patch`)
2. **Days 2-5**: Write the scope-rename codemod and integrate patches into the build pipeline
3. **Days 5-7**: Build and publish first version to npm, test `npx ruflo-patch init` end-to-end
4. **Week 2**: Set up systemd timer, test the automated poll → build → prerelease flow
5. **Week 2**: Test the full cycle: upstream change → email notification → review → promote
6. **Ongoing**: Review prereleases as they arrive by email, promote with one command

---

## 11. Summary Statistics

| Metric | Value |
|--------|-------|
| Approaches evaluated | 11 |
| Architects consulted | 5 |
| Recommended approach | Fork + Build-Step Rename + npm Publish |
| Key innovation | Rename at build time, not in committed source — zero merge conflicts |
| User experience | `npx ruflo-patch init` — drop-in replacement, same CLI |
| Build infrastructure | systemd timer on local server (32 cores, 200GB RAM) |
| Upstream poll frequency | Every 6 hours |
| Publish gate | Prerelease on npm + GitHub prerelease email notification |
| Promotion | `npm dist-tag add ruflo-patch@X.Y.Z-patch.N latest` (2 seconds) |
| Packages needing scope rename (TypeScript) | ~26 |
| Packages skippable (use published ruvector) | ~22 |
| Files the codemod transforms per build | ~4,136 (never committed) |
| Enhancement patches baked into builds | 3 (MC-001, FB-001, FB-002) |
| Patches dropped (fixed in HEAD) | 2 (FB-003, FB-004) |
| Estimated effort (pipeline + first publish) | ~2 weeks |
| Ongoing effort per upstream sync | 0 (automated build) + 2 min (review + promote) |
| Merge conflicts per sync | 0 (fork is a clean mirror) |
| License risk | None (all MIT) |
