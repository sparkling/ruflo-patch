# ADR-0071: RuVector Native Binary Management

- **Status**: Implemented
- **Date**: 2026-04-06
- **Implemented**: 2026-04-06
- **Depends on**: ADR-0069 (F1 consolidation, config chain)

## Context

The `@sparkleideas/*` packages depend on 13 `@ruvector/*` packages, 10 of which are NAPI-RS
native binaries requiring platform-specific `.node` files. Upstream (`ruvnet/RuVector`) publishes
these to npm, but:

1. **Version gaps**: parent packages declare binary versions in `optionalDependencies` that don't
   match the latest npm binary (e.g., router parent 0.1.29 declares binary 0.1.27).
2. **Unpublished binaries**: `@ruvector/ruvllm-darwin-arm64@2.3.0` was declared in commit
   `02cde183` but never tagged, built, or published to npm.
3. **No provenance**: npm binaries are opaque `.node` files with no embedded git SHA, Cargo
   version, or build manifest. We can't verify what source they were built from.
4. **Fork patches not in npm**: our fork has ADR-0068 Rust changes (dimension alignment in
   `ruvector-core` and `ruvector-graph-node`) that the npm binaries don't include.
5. **Missing build configs**: `ruvector-graph-node` and `sona` crates lacked `package.json` for
   NAPI-RS CLI. `rvf-node` was missing `build.rs` and `napi-build` dependency.
6. **Stale branches**: 56 upstream branches with unmerged Rust changes, but almost all include
   destructive repo restructuring (8K-144K lines deleted). No branch is safe to merge wholesale.

## Decision

### Build all NAPI-RS binaries from fork HEAD

Every binary is built from our fork's `main` HEAD using `napi build --platform --release`.
No npm binaries are used. Each binary's `package.json` uses a SHA-based version:

```json
{
  "version": "0.0.0-sha.0cce619a",
  "_upstreamDeclaredVersion": "0.1.27",
  "_gitSha": "0cce619a",
  "_builtAt": "2026-04-06T07:56:07Z"
}
```

This ensures:
- Our fork patches (ADR-0068 dimension alignment) are in every binary
- Every binary has traceable provenance (git SHA, build timestamp)
- No dependency on upstream's stale/missing npm publishes

### Installation script: `scripts/install-native-deps.sh`

Automates the full build for all 13 packages:

| Type | Count | Packages |
|------|-------|----------|
| Build from source | 10 | attention, core, gnn, graph-node, graph-transformer, router, ruvllm, rvf-node, sona, tiny-dancer |
| Pure JS (npm) | 4 | ruvllm (JS layer), rvf, rvf-solver, rvf-wasm |

Falls back to npm binaries if Rust toolchain is not available.

Usage: `npm run setup:native` or `bash scripts/install-native-deps.sh`

Requires: `cargo` (Rust), `napi` (`@napi-rs/cli`), ruvector fork at `/Users/henrik/source/forks/ruvector`

### Special cases

| Package | Issue | Resolution |
|---------|-------|-----------|
| `@ruvector/core` | Unscoped platform packages (`ruvector-core-darwin-arm64`, not `@ruvector/core-darwin-arm64`) | Script handles both scoped and unscoped naming |
| `@ruvector/ruvllm` | Binary `@2.3.0` never published; Cargo.toml stuck at `2.0.0` | Build from `examples/ruvLLM` with `-F napi`; version set to `0.0.0-sha.<SHA>` |
| `@ruvector/graph-node` | Missing `package.json` in crate dir | Created in fork |
| `@ruvector/sona` | Missing `package.json` in crate dir | Created in fork |
| `@ruvector/rvf-node` | Missing `build.rs` + `napi-build` dep | Added in fork |

### Upstream branch policy: cherry-pick only, never merge wholesale

56 branches analysed by 13-agent hive. Finding: every upstream feature branch includes
repo-wide cleanup (8K-144K lines of dead code deletion) alongside targeted changes.
Wholesale merges would delete source for binaries we ship.

**Actionable cherry-picks identified:**

| Priority | Branch | Files | What |
|----------|--------|-------|------|
| P1 | `fix/sona-persistence-273-274` | `crates/sona/src/reasoning_bank.rs`, `types.rs`, `loops/coordinator.rs` | **APPLIED** — persistence fix #274, cluster optimization |
| P2 | `feat/ruvltra-v2.4-ecosystem-training` | `crates/sona/src/napi.rs`, `napi_simple.rs` | **ALREADY ON MAIN** — merged upstream before fork sync |
| P3 | `feat/ruvltra-v2.4-ecosystem-training` | `crates/ruvector-core/src/simd_intrinsics.rs` | **SKIP** — branch only deletes AVX2 code, zero NEON additions. Main already has all NEON opts. |
| P4 | `feat/ruvltra-v2.4-ecosystem-training` | `examples/ruvLLM/src/`, `crates/ruvllm/src/` | **ALREADY ON MAIN** — all 8 security fixes from commit 7e61d76d present |

**Irrelevant branches (confirmed by hive):**
- 41 branches touch only unrelated crates (postgres, mincut, cognitum-gate, brain-server, etc.)
- 12 branches include destructive restructuring that would break our binaries
- 3 branches (sona fixes) have actionable cherry-picks listed above

## Binary Inventory (darwin-arm64)

| Package | NAPI Crate | Upstream Declares | Our Version | Tag? |
|---------|-----------|-------------------|-------------|------|
| attention | `ruvector-attention-node` | 0.1.31 | `sha.<HEAD>` | `v0.1.31` |
| core | `ruvector-node` | 0.1.29 | `sha.<HEAD>` | None |
| gnn | `ruvector-gnn-node` | 0.1.25 | `sha.<HEAD>` | `v0.1.25` |
| graph-node | `ruvector-graph-node` | 2.0.2 | `sha.<HEAD>` | None |
| graph-transformer | `ruvector-graph-transformer-node` | 2.0.4 | `sha.<HEAD>` | `v2.0.4` |
| router | `ruvector-router-ffi` | 0.1.27 | `sha.<HEAD>` | `v0.1.27` |
| ruvllm | `examples/ruvLLM` (+F napi) | 2.3.0 (never published) | `sha.<HEAD>` | None |
| rvf-node | `rvf/rvf-node` | 0.1.7 | `sha.<HEAD>` | None |
| sona | `sona` | 0.1.5 | `sha.<HEAD>` | `sona-v0.1.5` |
| tiny-dancer | `ruvector-tiny-dancer-node` | 0.1.15 | `sha.<HEAD>` | `v0.1.15` |

## Scope Rename: `@ruvector/*` → `@sparkleideas/ruvector-*`

Since we build these binaries from our fork (with our patches), shipping them under the
original `@ruvector/*` name is misleading — they're modified code under someone else's name.

### Current state (excluded from codemod — to be removed)

8 packages in `config/package-map.json` `excluded` array are passed through without renaming:
`ruvector`, `@ruvector/core`, `@ruvector/router`, `@ruvector/graph-transformer`,
`@ruvector/ruvllm`, `@ruvector/sona`, `@ruvector/memory`, `@ruvector/embeddings`.

**The `excluded` array should be removed entirely.** Every package we ship should be under
`@sparkleideas/*`. No exceptions — if we build it from our fork, it gets our scope.

### Target state (renamed in codemod)

Move all `@ruvector/*` from `excluded` to a new `ruvector` scope mapping:

```json
"ruvectorScope": {
  "from": "@ruvector/",
  "to": "@sparkleideas/ruvector-"
}
```

This renames `@ruvector/core` → `@sparkleideas/ruvector-core`, etc.

### Scope of change

- **1336 source file references** across `agentic-flow/src/` and `packages/`
- **~60 unique package names** including platform-specific binaries (`-darwin-arm64`, `-linux-x64-gnu`, etc.)
- Platform binary names in NAPI `index.js` loaders must also be updated
- `optionalDependencies` in all parent package.json files must be rewritten
- The `install-native-deps.sh` script must produce `@sparkleideas/ruvector-*` package names

### Implementation phases

**Phase 1: Cherry-pick upstream fixes into fork**

| Branch | Cherry-pick | Why |
|--------|-------------|-----|
| `fix/sona-persistence-273-274` | `crates/sona/src/reasoning_bank.rs`, `types.rs` | Persistence bug fix (#274) + cluster optimization |
| `feat/ruvltra-v2.4-ecosystem-training` | `crates/sona/src/napi.rs`, `napi_simple.rs` | `getStats()` JSON fix (was Debug-formatted) |
| `feat/ruvltra-v2.4-ecosystem-training` | `crates/ruvector-core/src/simd_intrinsics.rs` | NEON SIMD improvements (2.96-5.96x on M-series) |
| `feat/ruvltra-v2.4-ecosystem-training` | `examples/ruvLLM/src/`, `crates/ruvllm/src/` | Security: GGUF DoS cap, shell injection block, path traversal guard |

**Phase 2: Scope rename `@ruvector/*` → `@sparkleideas/ruvector-*`**
1. Remove `excluded` array from `config/package-map.json`
2. Add `ruvectorScope` mapping: `"from": "@ruvector/", "to": "@sparkleideas/ruvector-"`
3. Extend `scripts/codemod.mjs` to handle the new scope (1336 references, ~60 package names)
4. Rewrite NAPI `index.js` platform loaders to use `@sparkleideas/ruvector-*-darwin-arm64` names
5. Rewrite `optionalDependencies` in all parent package.json files
6. Update `install-native-deps.sh` to produce `@sparkleideas/ruvector-*` package names
7. Update unscoped `ruvector-core-darwin-arm64` to `@sparkleideas/ruvector-core-darwin-arm64`

**Phase 3: Rebuild + publish** (DONE 2026-04-06)
1. Rebuilt all 10 NAPI binaries from fork HEAD (sona includes persistence fix)
2. Verified 13/13 packages load, SIMD works
3. Published all 12 `@sparkleideas/ruvector-*` packages to Verdaccio
4. Increased Verdaccio `max_body_size` to 100mb (ruvector-core is 35MB with all platform binaries)
5. Updated publish-levels.json (level 1: 6 → 17 packages) and publish-order tests (42 → 53)
6. 1265 unit tests pass (0 fail)
7. Acceptance: 124/148 pass, 24 fail (all p5 — pre-existing init config issues from ADR-0070, not caused by ADR-0071)
8. Duplicate package issue: `npm/core` (0.1.17) vs `npm/packages/core` (0.1.30) — the ruvector repo
   has two copies. Publish script must use `npm/packages/*` (the correct versions). `npm/core` is stale.

## Consequences

### Positive
- Every binary has traceable provenance (SHA in package.json)
- Fork patches automatically included in every build
- No dependency on upstream npm publish cadence
- Missing/broken build configs fixed in fork
- Build is reproducible from any checkout of the fork

### Negative
- Requires Rust toolchain + NAPI-RS CLI for development setup
- First build takes ~5 minutes (subsequent builds use cargo cache, ~10s)
- Must rebuild after pulling fork changes (script is idempotent — only rebuilds if SHA changes)
- Linux/Windows binaries not built (only darwin-arm64 tested); cross-compilation needed for CI

### Risks
- Upstream Cargo.toml workspace changes could break our builds
- Some crates may gain new Rust dependencies that need native libs (e.g., Metal framework for ruvllm)
- The 4 packages with no upstream tag have no baseline to diff against
