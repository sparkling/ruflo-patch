---
status: accepted
date: 2026-03-05
tags: [fork, codemod, pipeline, npm]
supersedes: []
depends-on: []
implements: []
---

# Fork + Build-Step Rename for Package Independence

## Context and Problem Statement

### Specification (SPARC-S)

The upstream ruvnet ecosystem spans 48+ npm packages across 7 public GitHub repositories. The npm-published versions are severely behind their source repos: 60% of `@claude-flow/*` packages have not been published since January 6, `ruflo` alone is 933 commits behind, `agentic-flow` is 540 commits behind, and `ruv-FANN` is 159 days stale. We have no write access to any of these repos or npm scopes. Maintainers are unresponsive to PRs and issues.

A 5-architect hive-mind (mesh topology, Byzantine consensus) evaluated 11 distinct approaches to achieving package independence with public distribution capability:

1. Fork + Republish (committed scope rename)
2. Local Build + `npm link`
3. Expanded Patch Overlay (inject into npx cache)
4. Private npm Registry (Verdaccio)
5. Git Subtree Mega-Repo
6. esbuild/rollup Fat Bundle
7. npm pack + Local Tarballs
8. pnpm/npm overrides
9. Nix Flake Reproducible Build
10. Docker Container
11. npx Cache Snapshot

The core tension: only approaches that publish to public npm under a new scope enable public distribution, but naive scope renaming (committed to the fork) creates thousands of merge conflicts on every upstream sync.

### Pseudocode (SPARC-P)

```
FORK each upstream repo as a clean mirror (no modifications)

ON build trigger:
  git pull upstream (0 conflicts — fork is unmodified)
  COPY source tree to temp directory
  RUN codemod on temp copy:
    FOR each package.json: rename @claude-flow/* -> @sparkleideas/*
    FOR each .ts/.js file: rewrite import/require references
  APPLY enhancement patches from ruflo/patch/
  pnpm install && pnpm build
  npm test
  IF tests pass: npm publish --tag prerelease
  IF tests fail: gh issue create
```

## Considered Options

* **Fork upstream repos as clean mirrors; apply scope rename as a build-time codemod, never committed (chosen).**
* **Verdaccio (private registry)** — Rejected. Zero code rewrites, but publishes under original package names to a local registry. Cannot publish to public npm under someone else's scope (`@claude-flow`). Suitable as a bridge for immediate local use, but does not solve public distribution.
* **Committed scope rename in fork** — Rejected. Modifies ~4,136 files in the fork's source tree. Every `git merge upstream/main` conflicts on any file that both we (for the rename) and upstream (for new features) touched. With 933+ unpublished commits and active development, this means hundreds to thousands of merge conflicts per sync. The fork eventually becomes unmergeable.
* **Expanded patches (inject into npx cache)** — Rejected. Architect consensus: "When you need to backport 933 commits across 21 sub-packages and 1,074 JS files, you are not patching -- you are maintaining a shadow fork. The patch abstraction obscures what is really happening." npx cache invalidation destroys everything. Fundamentally the wrong abstraction for this scale of divergence.
* **npm link** — Rejected. `npx` is incompatible with symlinked packages. `npm install` silently removes symlinks. Not distributable to others without them repeating the entire setup process. Symlink fragility in production workflows is unacceptable.
* **esbuild fat bundle** — Rejected. Dynamic imports in `memory-bridge.js` break bundling. Native addons (`better-sqlite3`, ruvector napi-rs) cannot be bundled. Only handles ~30 of 48 packages.
* **Git subtree mega-repo** — Rejected. Subtree merges create messy history. Must harmonize 3 different workspace systems (pnpm, npm workspaces, Cargo). Not npx compatible without additional steps.

## Decision Outcome

Chosen option: "Fork upstream repos as clean mirrors; apply scope rename as a build-time codemod, never committed to the fork", because the fork stays permanently syncable (no committed modifications) while public distribution is achieved via a build-time transform and standard npm publish.

### Architecture (SPARC-A)

Fork upstream repos as clean mirrors. Apply scope rename (`@claude-flow/*` to `@sparkleideas/*`) as a build-time codemod, never committed to the fork. Build TypeScript packages from source. Publish to npm under the `@sparkleideas` scope.

The codemod is the key asset. It transforms ~4,136 files per build:

- ~261 `package.json` files (name, dependencies, peerDependencies, optionalDependencies)
- ~3,875 JS/TS source files (import/require statements)

The pipeline is: `git pull` (0 conflicts) -> copy to temp -> codemod -> patches -> build -> publish. The fork stays permanently syncable because no modifications are ever committed to it.

### Consequences

* Good, because zero merge conflicts on upstream sync -- the fork is a clean mirror with no modifications.
* Good, because public distribution via standard npm toolchain -- anyone can `npm install ruflo`.
* Good, because enhancement patches (FB-001, FB-002) are baked into published packages -- no runtime patching.
* Good, because the build pipeline is Node.js-only (no Rust toolchain) because ruvector packages are used as-is from public npm.
* Good, because automated builds via systemd timer (every 6 hours) with prerelease gating.
* Bad, because ~4,136 files transformed per build adds build time (mitigated by running on 32-core server).
* Bad, because the codemod itself is a critical piece of infrastructure that must be maintained as upstream evolves.
* Bad, because if upstream adds new package names or changes import patterns, the codemod must be updated.
* Bad, because build failures from upstream breaking changes require manual investigation.
* Neutral, because all repos are MIT-licensed -- forking and republishing is explicitly permitted.
* Neutral, because precedent exists: `@sparkleideas/claude-flow-patch` already published on npm as a third-party fork.
* Neutral, because original LICENSE and copyright notices preserved in every republished package.

**Trade-offs and edge cases:**

- Dynamic `require()` calls with computed strings (e.g., `require('@claude-flow/' + name)`) cannot be statically transformed by the codemod -- these must be identified and handled specially
- Upstream may add new unscoped packages that need mapping rules added to the codemod
- The 2 RED semver conflicts (`@ruvector/ruvllm ^0.2.3` vs `2.5.1`, `agentdb` dual-track alpha) exist in upstream source and are not introduced or resolved by our approach
- If upstream eventually publishes current packages, our fork becomes unnecessary -- this is the desired outcome

### Confirmation

Completion (SPARC-C):

- [x] Upstream repos forked as clean mirrors on GitHub
- [x] npm scope `@sparkleideas` registered
- [x] Scope-rename codemod implemented and tested against current upstream HEAD
- [x] Build pipeline integrates codemod + patches + TypeScript build + npm publish
- [x] `npx @sparkleideas/cli init` works end-to-end with published packages
- [x] systemd timer configured for automated builds every 6 hours
- [x] Prerelease publish gate verified (auto-publish to `prerelease` tag, manual promotion to `latest`)
- [x] `git pull` on fork produces zero merge conflicts after upstream pushes new commits
