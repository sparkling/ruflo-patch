# ADR-0150: Generalise napi-rebuild + bundle-native-binaries to support agentic-jujutsu (and other napi packages)

- **Status**: Implemented
- **Date**: 2026-05-06
- **Deciders**: Henrik Pettersen
- **Related**: ADR-0133 (napi-rebuild for ruvector), ADR-0071 (RuVector native binary management), ADR-0148 §"Findings — Category C" (ships agentic-jujutsu skill)
- **Scope**: `scripts/napi-rebuild.sh`, `scripts/bundle-native-binaries.sh`, `scripts/copy-source.sh`

## Context

The fork's pipeline has napi-binary infrastructure in two scripts:

1. **`napi-rebuild.sh`** — detects Rust source changes in `forks/ruvector/crates`, runs `npm run build` (which calls `napi build --release`) in 8 ruvector crates, commits the rebuilt `*.darwin-arm64.node` files back to `forks/ruvector` main. Hardcoded to ruvector.
2. **`bundle-native-binaries.sh`** — copies `*.darwin-arm64.node` files from build-tree crates into npm-package parent dirs so the NAPI loader's "step 1 local file check" finds them, eliminating the need to publish ~80 platform-specific packages. Hardcoded to 8 ruvector mappings.

Result: ruvector ships working darwin-arm64 binaries to Verdaccio; **agentic-jujutsu does NOT.**

ADR-0148 §"Findings — Category C" wired the `agentic-jujutsu` skill into init, but the runtime is broken on darwin-arm64:

```
Error: Cannot find module 'agentic-jujutsu-darwin-arm64'
```

Verified causes:
1. Upstream `agentic-jujutsu@2.3.6` package on public npm has `optionalDependencies` for 6 platforms — `darwin-arm64` is NOT in the list. Upstream packaging gap.
2. The fork's `forks/agentic-flow/packages/agentic-jujutsu` HAS a `Cargo.toml` and a `napi build` script, so the binary CAN be built locally.
3. But our pipeline's `copy-source.sh:98-99` actively excludes `*.node` files from the copy, AND `napi-rebuild.sh` doesn't trigger for agentic-jujutsu changes, AND `bundle-native-binaries.sh` doesn't have a mapping for it.

So all three pipeline scripts conspire to leave agentic-jujutsu without a working darwin-arm64 binary.

## Decision

Generalise the napi infrastructure to support multiple packages via a config-driven approach.

### Phase 1 — Extract config to a shared file

Create `scripts/napi-config.sh` (or JSON):

```bash
# scripts/napi-config.sh
NAPI_PACKAGES=(
  # fork_path:crate_path:dest_npm_package_dir
  "forks/ruvector:crates/ruvector-node:npm/packages/core"
  "forks/ruvector:crates/ruvector-graph-node:npm/packages/graph-node"
  "forks/ruvector:crates/ruvector-router-ffi:npm/packages/router"
  "forks/ruvector:crates/ruvector-tiny-dancer-node:npm/packages/tiny-dancer"
  "forks/ruvector:crates/sona:npm/packages/sona"
  "forks/ruvector:examples/ruvLLM:npm/packages/ruvllm"
  "forks/ruvector:crates/rvf/rvf-node:npm/packages/rvf-node"
  # ADR-0150: extend to agentic-jujutsu
  "forks/agentic-flow:packages/agentic-jujutsu:packages/agentic-jujutsu"
)
```

Both `napi-rebuild.sh` and `bundle-native-binaries.sh` source this config and iterate.

### Phase 2 — Generalise napi-rebuild.sh

Currently hardcoded to `FORK_RUVECTOR`. Refactor to:

1. For each entry in `NAPI_PACKAGES`, detect Rust source changes in that fork's crate path
2. If changed, run `napi build --release` in the crate dir
3. Verify `*.darwin-arm64.node` mtime updated
4. Stage + commit the binary back to the relevant fork (NOT just ruvector)

### Phase 3 — Generalise bundle-native-binaries.sh

Currently hardcoded `RUVECTOR_DIR`. Refactor to iterate `NAPI_PACKAGES` and copy binaries from each `crate_path` into the matching `dest_npm_package_dir` inside the build tree.

### Phase 4 — Fix copy-source.sh exclude

Line 98-99 currently excludes `packages/agentic-jujutsu/*.node` AND `packages/agentic-jujutsu/*.tgz`. The `.tgz` exclude stays (build artifacts shouldn't ship). The `.node` exclude needs to be:

- **Keep excluded**: stale arch-specific .node files OTHER than darwin-arm64 (since we only build darwin-arm64 in our pipeline)
- **Allow through**: the darwin-arm64 .node binary that bundle-native-binaries copies in

Practical fix: change exclude from `*.node` to `*.linux-*.node`, `*.win32-*.node`, `*.android-*.node` (etc.) — leaving `*.darwin-arm64.node` to flow through.

### Phase 5 — Verify end-to-end

After release with all 4 phase changes:
1. `forks/agentic-flow/packages/agentic-jujutsu/agentic-jujutsu.darwin-arm64.node` exists
2. Published `@sparkleideas/agentic-jujutsu@<version>` tarball contains the .node binary
3. `npx @sparkleideas/agentic-jujutsu --version` succeeds on darwin-arm64
4. The HM `/agentic-jujutsu` skill works end-to-end

## Acceptance criteria

- [ ] `scripts/napi-config.sh` (or `.json`) created with at least 9 entries (8 ruvector + 1 agentic-jujutsu)
- [ ] `napi-rebuild.sh` iterates the config; produces `forks/agentic-flow/packages/agentic-jujutsu/*.darwin-arm64.node` when Rust source changes
- [ ] `bundle-native-binaries.sh` iterates the config; copies the binary into the build tree
- [ ] `copy-source.sh` exclude is narrowed to NON-darwin-arm64 platform binaries
- [ ] `npm run release` produces a publish package containing the .node binary
- [ ] `npx @sparkleideas/agentic-jujutsu --version` succeeds (or routes through the wrapper successfully)
- [ ] Regression test: `tests/unit/adr0150-napi-config.test.mjs` validates config schema + presence of agentic-jujutsu entry
- [ ] No regression to ruvector binaries (they still build + bundle + publish correctly)

## Risks

1. **Build time** — adding 1 more napi build to napi-rebuild adds ~30-90s to the pipeline. Mitigation: napi-rebuild only runs when Rust source changes, so most releases skip it.
2. **Cross-platform shipping** — our pipeline only builds darwin-arm64. Linux/Windows users still hit the upstream gap. Mitigation: out of scope for THIS ADR; document that agentic-jujutsu only works on Apple Silicon via this fork. File a separate upstream issue at `ruvnet/agentic-flow`.
3. **Cargo.toml dependencies** — agentic-jujutsu may pull in Rust crates that need build-time tooling not present in the pipeline (cmake, openssl headers, etc.). Mitigation: do a dry-run `napi build` in `/tmp/agentic-jujutsu-build-test/` before committing the pipeline change to surface this.
4. **Quantum / cryptography native deps** — package description mentions ml-dsa, qudag, ML-DSA cryptography. These may need extra build flags. Mitigation: same as #3.

## Considered alternatives

### Alternative A — Just exclude agentic-jujutsu from the codepath that triggers the error

Replace the error-throwing `index.js` with a wrapper that returns "not available on this platform" gracefully. Rejected: hides the real problem, breaks the skill semantically (it shouldn't claim to work when it doesn't), and any user calling its API gets surprised.

### Alternative B — Patch the loader to find a fork-published binary

Override `index.js` in our codemod to first check Verdaccio for `@sparkleideas/agentic-jujutsu-darwin-arm64`. Rejected: doesn't solve the build problem (we still need to build the binary somewhere); just shifts the resolution.

### Alternative C — Use a pre-built Jujutsu binary directly, skip napi-rs

Replace the napi-rs binding with shell-out to a `jj` CLI installed via brew. Rejected: drops the Rust API surface that agentic-jujutsu provides (QuantumDAG consensus, AgentDB integration, signing). The skill's value is the Rust integration, not just `jj` access.

### Alternative D — File upstream issue and wait

Ask `ruvnet/agentic-flow` to ship darwin-arm64 in the next release. Rejected: per memory `feedback-no-upstream-donate-backs.md`, fork-side fixes stay on `sparkling/ruflo`. ALSO upstream cycle is unpredictable; user wants this working now.

## Implementation log

- **2026-05-18** — Config-driven generalization landed: `lib/napi-config.sh` (`NAPI_PACKAGES` + `napi_parse_entry`/`napi_unique_forks` helpers); `napi-rebuild.sh` + `bundle-native-binaries.sh` source it; `copy-source.sh` narrowed the agentic-jujutsu `*.node` exclude to non-darwin-arm64; regression test `tests/unit/adr0150-napi-config.test.mjs`. agentic-jujutsu darwin-arm64 binary ships.
- **2026-05-21** — Extended to `@ruvector/gnn` + `@ruvector/attention`. Their darwin-arm64 `.node` already existed prebuilt in `crates/ruvector-gnn-node` / `ruvector-attention-node` and the loaders local-check correctly, but the binaries never shipped: gnn was a stale publish, and attention's `.npmignore` had a blanket `*.node` that excluded the binary entirely (→ empty `@ruvector/attention` → "Cannot find module @ruvector/attention-darwin-arm64", silent JS fallback). Fix: added both crates to `NAPI_PACKAGES` (single-binary — crate == publish dir) and narrowed attention's `.npmignore` to non-darwin-arm64 arches. Republished via release; the gnn/attention native paths now load.

## References

- ADR-0133 (napi-rebuild origin)
- ADR-0071 (RuVector native binary mgmt)
- ADR-0148 §"Findings — Category C" (parent — wires the skill but runtime is broken)
- `forks/agentic-flow/packages/agentic-jujutsu/Cargo.toml` (build manifest)
- `scripts/napi-rebuild.sh` (current ruvector-only impl)
- `scripts/bundle-native-binaries.sh` (current ruvector-only impl)
- `scripts/copy-source.sh:98-105` (the .node exclude)
