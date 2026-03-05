# ADR-0008: Skip Ruvector Rebuild

## Status

Accepted

## Context

### Specification (SPARC-S)

The ruvector ecosystem (`ruvnet/ruvector`) consists of 22+ npm packages including:

- Native `.node` binaries compiled via napi-rs for 7 platforms (linux-x64, darwin-arm64, win32-x64, etc.)
- WASM modules compiled via wasm-pack
- 42 platform-specific binary distribution packages (e.g., `@ruvector/ruvector-linux-x64-gnu`)

Building ruvector from source requires:

- Rust toolchain (rustc, cargo)
- napi-rs CLI (`@napi-rs/cli`)
- wasm-pack
- Cross-compilation targets for all 7 platforms
- 2-4 hours for a full first build

The build pipeline defined in ADR-0005 rebuilds upstream TypeScript packages and publishes them under `@claude-flow-patch`. This ADR decides whether ruvector packages should be included in that rebuild.

### Pseudocode (SPARC-P)

```
FOR each upstream package:
  IF package is in @ruvector/* scope:
    SKIP — depend on published version from public npm
  ELSE IF package is TypeScript (@claude-flow/*, agentdb, agentic-flow, ruv-swarm):
    REBUILD — apply codemod, build, publish under @claude-flow-patch/*

RESULT:
  package.json dependencies reference @ruvector/* from public npm
  package.json dependencies reference @claude-flow-patch/* from our builds
```

## Decision

### Architecture (SPARC-A)

Do NOT rebuild ruvector packages. Depend on the published `@ruvector/*` packages from public npm. Do not rename them.

Our rebuilt `@claude-flow-patch/*` packages list `@ruvector/*` as standard npm dependencies. When a user installs `ruflo-patch`, npm resolves `@ruvector/*` from public npm automatically. No special configuration is needed.

### Rationale

1. **Ruvector is the most current part of the ecosystem.** Latest publish: March 3, 2026 -- 2 days before this analysis. Only 172 commits behind vs 933 for ruflo. The staleness problem that motivates this entire effort does not apply to ruvector.

2. **The stale packages causing actual problems are all TypeScript.** `@claude-flow/*`, `agentdb`, `agentic-flow` -- these are the packages with 540-933 unpublished commits. Ruvector is not in this category.

3. **Eliminating the Rust toolchain makes the build pipeline Node.js-only.** Build time drops from hours to minutes. No cross-compilation CI is needed for 7 platforms. The entire pipeline can run with `node`, `npm`, and `pnpm` only.

4. **42 platform-specific binary packages are a maintenance burden.** Each platform target requires a CI runner or cross-compilation setup. Failures in native compilation are harder to debug than TypeScript build failures. This complexity adds no value when the published packages work.

### Considered Alternatives

1. **Rebuild everything including ruvector** -- Rejected. Adds 2-4 hours to the build, requires Rust toolchain and cross-compilation CI, and solves no problem (ruvector is current). Effort estimate for the full fork project increases from ~1 week to 4-6 weeks.

2. **Fork ruvector but use published binaries** -- Rejected. Forking without rebuilding creates a repo we maintain but never use. If we need ruvector changes in the future, we can fork then.

3. **Vendor ruvector tarballs** -- Rejected. Downloading `.tgz` files and committing them adds 200+ MB to the repo. Standard npm dependency resolution handles this automatically.

## Consequences

### Refinement (SPARC-R)

**Positive:**

- Build pipeline is Node.js-only: `pnpm install && pnpm build` with no Rust, napi-rs, or wasm-pack
- Build time measured in minutes, not hours
- No cross-compilation CI matrix (7 platforms x multiple architectures)
- Fork + publish effort drops from 4-6 weeks to ~1 week
- Ruvector updates are picked up automatically via standard npm semver resolution

**Negative:**

- If ruvector publishes a breaking change, our packages pick it up automatically. This is mitigated by pinning ruvector versions in `package.json` (exact versions or narrow ranges) rather than using `*` or `latest`.
- If ruvector becomes stale (it is currently active), we would need to revisit this decision and add Rust toolchain support to the build pipeline.
- The 2 RED semver conflicts involving ruvector (`@ruvector/ruvllm ^0.2.3` vs published `2.5.1`) remain unresolved. These conflicts exist in upstream source code and are not introduced by our approach. They manifest as peer dependency warnings but do not cause runtime failures.

**Trade-offs and edge cases:**

- `@ruvector/ruvector` uses native binaries. If a user is on an unsupported platform (e.g., linux-arm64 without a prebuilt binary), they get a runtime error from ruvector, not from our packages. This is the same behavior as upstream.
- Ruvector's `better-sqlite3` dependency requires `npm rebuild` on Node v24 (`node-v137-linux-x64`). This is a known issue documented in the project memory and affects upstream identically.
- If we later need to patch ruvector code (not just use it), we would need to either (a) add the Rust rebuild to our pipeline, or (b) patch the compiled `.node` files at the JavaScript wrapper level. Option (b) is viable for small changes.

**Neutral:**

- The codemod (ADR-0005) explicitly skips `@ruvector/*` in its rename rules
- `npm ls` shows `@ruvector/*` as standard dependencies resolved from public npm -- no special handling visible to users
- ruvector is MIT-licensed, so forking remains an option if circumstances change

### Completion (SPARC-C)

- [ ] `@ruvector/*` packages resolve correctly from public npm when `ruflo-patch` is installed
- [ ] No Rust toolchain is required to run the build pipeline
- [ ] Codemod does not rename any `@ruvector/*` references in source files
- [ ] `package.json` files in rebuilt packages list `@ruvector/*` with pinned or narrow version ranges
- [ ] Build completes in under 15 minutes without ruvector compilation
- [ ] Runtime functionality that depends on ruvector (vector search, embeddings) works with published ruvector packages
