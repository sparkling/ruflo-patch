# ADR-0134: Native artifact rebuild program — generalise beyond ruvector napi-arm64

- **Status**: **Proposed (2026-05-03)** — follow-up to ADR-0133. Extend the narrow napi-arm64 fix into a general "any-fork, any-native-artifact, source-change-triggered rebuild" pipeline phase.
- **Date**: 2026-05-03
- **Deciders**: Henrik Pettersen
- **Depends on**: ADR-0133 (narrow fix landed in commit `bec5606` — covers ruvector napi-arm64 only via `scripts/napi-rebuild.sh`)
- **Related**: ADR-0086 (Layer 1 storage; stale binaries can mask storage regressions), ADR-0095 (RVF inter-process convergence; the canonical example of a fix masked by stale binary), ADR-0027 (fork-patch model; checked-in artifacts are part of the fork's source-of-truth)
- **Scope**: All 4 forks (`ruflo`, `agentic-flow`, `ruv-FANN`, `ruvector`). Local rebuild on dev host only (darwin-arm64 specifically). Cross-platform binaries handled by a separate CI-matrix design captured in §Out of scope.

## Context

ADR-0133 surfaced a **stale-native-artifact class of regression** where fork Rust source changes (e.g. cherry-picked d12 flock+refcount) were published as new package versions, but the .node binaries inside the published artifact stayed stale (April 6 2026 build), masking the fix and producing 0/5 trials passing on the inter-process convergence probe.

The narrow fix (`scripts/napi-rebuild.sh`) addresses this by detecting ruvector Rust source changes and rebuilding 8 napi crates' darwin-arm64 .node binaries before the existing `bump-versions` phase.

That fix is **scope-locked** to one fork × one binary class × one platform. The same regression mode is latent across multiple other artifact classes.

### Inventory of remaining stale-risk artifacts (audit 2026-05-03)

| Class | Examples | Source path | Build command | Currently rebuilt? |
|---|---|---|---|---|
| **ruvector WASM** | `crates/ruvector-attention-wasm/pkg/ruvector_attention_wasm_bg.wasm` (May 2), `crates/micro-hnsw-wasm/micro_hnsw.wasm` (Apr 3), `crates/ruvllm-wasm/pkg/ruvllm_wasm_bg.wasm` (Apr 18), `crates/ruvector-exotic-wasm/pkg/ruvector_exotic_wasm_bg.wasm` (Apr 3), `docs/cnn/ruvector_cnn_wasm_bg.wasm` (Apr 3) | `crates/<name>/src/**/*.rs` | `wasm-pack build --release --target nodejs` (or per-crate `bash build.sh`) | ✗ |
| **ruvector cross-platform .node** | `npm/{darwin-x64,linux-arm64-{gnu,musl},linux-x64-{gnu,musl},win32-x64-msvc}/*.node` per napi crate | Same Rust source as ADR-0133's darwin-arm64 case | `napi build --target <triple> --release` requires per-target toolchain | ✗ (architectural — see §Out of scope) |
| **agentic-flow native** | `packages/agentic-jujutsu/agentic-jujutsu.linux-x64-gnu.node`, `agentic-flow/wasm/reasoningbank/reasoningbank_wasm_bg.wasm`, `agentic-flow/wasm/quic/agentic_flow_quic_bg.wasm` | `packages/agentic-jujutsu/src/**/*.rs`, `reasoningbank/src/**/*.rs`, `quic/src/**/*.rs` | `napi build` (jujutsu), `wasm-pack build` (reasoningbank, quic) | ✗ |
| **ruv-FANN WASM** | `ruv-swarm/npm/wasm/ruv-fann.wasm`, `ruv_swarm_wasm_bg.wasm`, `ruv_swarm_simd.wasm`, `neuro-divergent.wasm`, `vector_add.wasm` | `ruv-swarm/crates/**/*.rs` (or whichever workspace owns each) | `wasm-pack build` per crate | ✗ |
| **ruflo WASM** | `v3/@claude-flow/guidance/wasm-pkg/guidance_kernel_bg.wasm`, `ruflo/src/ruvocal/static/wasm/rvagent_wasm_bg.wasm` | `v3/@claude-flow/guidance/wasm-src/**/*.rs`, `ruvocal/wasm-src/**/*.rs` | `wasm-pack build` | ✗ |

Each row's stale-risk is the same shape as ADR-0133's: source updates land in the fork, version bumps publish a new package, but the actual native binary inside the package is whatever was last manually rebuilt and committed. A regression in any of these crates can be silently masked by a stale binary indistinguishable in version metadata from the new code.

## Decision

**Generalise `napi-rebuild.sh` into `native-rebuild.sh`** — a single phase invoked before `bump-versions` that:

1. Per fork: detects source changes (`.rs`, `.cpp`, `.toml`, `Cargo.lock`) since `PREV_<FORK>_HEAD`
2. Per fork: enumerates native build targets via a manifest declaration (per-fork `.native-targets.yaml` or similar lightweight config)
3. Runs each affected target's build command
4. Verifies output mtimes refreshed
5. Commits + pushes refreshed binaries to fork main / sparkling

The ADR-0133 narrow `napi-rebuild.sh` becomes one of several "build target" implementations consumed by the general phase.

### Why a manifest, not auto-discovery

ADR-0133's script auto-discovered napi crates via `package.json` script greps. That works for one well-known pattern. Generalising means:
- Some targets use `wasm-pack build`, some `napi build`, some `bash build.sh`, some custom scripts
- Some targets produce one artifact, some produce many
- Some targets have implicit transitive dependencies (rvf-node depends on rvf-runtime)

A small per-fork manifest is more robust than per-pattern auto-discovery:

```yaml
# forks/ruvector/.native-targets.yaml (illustrative — design not finalised)
- target: rvf-node
  source: crates/rvf/rvf-runtime, crates/rvf/rvf-node
  build: cd crates/rvf/rvf-node && napi build --platform --release
  output: crates/rvf/rvf-node/*.darwin-arm64.node
- target: ruvector-attention-wasm
  source: crates/ruvector-attention-wasm
  build: cd crates/ruvector-attention-wasm && wasm-pack build --release --target nodejs
  output: crates/ruvector-attention-wasm/pkg/ruvector_attention_wasm_bg.wasm
```

The general script reads the manifest, computes affected targets via `git diff --name-only`, runs builds, verifies outputs.

## Out of scope

- **Cross-platform .node binaries** (linux-x64-gnu, linux-arm64-musl, win32-x64-msvc, darwin-x64). These cannot be rebuilt on a single darwin-arm64 dev host without a CI matrix (GitHub Actions per-OS runners) or QEMU emulation. **Separate ADR** (call it ADR-0135 if/when prioritised) should design that pipeline. For now, cross-platform binaries remain manually rebuilt — same posture as today, no regression.
- **Source-of-truth migration for native binaries.** Keeping artifacts in the fork (vs an artifact registry like GitHub Releases or a CDN) is a separate decision. This ADR preserves the current "binaries are checked-in fork artifacts" model.
- **Full clean rebuild.** This phase only triggers when source changed since last build state. A force-rebuild flag (e.g. `--force-native-rebuild`) is fine to add but not load-bearing.

## Implementation phases

### Phase 1 — Design + ADR-0133 generalisation (1 day)

- Finalise manifest schema (yaml/json/toml — pick one, document)
- Extract ADR-0133's `napi-rebuild.sh` detection/enumeration helpers into `lib/native-rebuild-helpers.sh`
- New `scripts/native-rebuild.sh` reads per-fork manifest, dispatches per target type
- ADR-0133's hardcoded `napi-rebuild.sh` becomes thin wrapper over Phase 1 helpers (or fully replaced)

### Phase 2 — ruvector WASM (1 day)

- Author `forks/ruvector/.native-targets.yaml` covering 5 wasm-pack crates
- Test: change a `.rs` in `ruvector-attention-wasm`, run release, confirm `.wasm` rebuilt + mtime refreshed
- Acceptance: `lib/acceptance-adr0134-ruvector-wasm.sh` asserts wasm mtime is newer than the source change commit

### Phase 3 — agentic-flow native (1 day)

- `.native-targets.yaml` for agentic-jujutsu (.node) + reasoningbank (.wasm) + quic (.wasm)
- agentic-jujutsu is `linux-x64-gnu` only — flag in manifest as "skip on darwin" until Phase 6 cross-platform design

### Phase 4 — ruv-FANN WASM (1 day)

- Audit which Rust source produces each of 5 .wasm files (need archaeology — ruv-swarm workspace has multiple crates)
- Manifest entries

### Phase 5 — ruflo WASM (0.5 day)

- guidance kernel WASM + rvagent WASM
- Smaller surface; mostly mechanical after Phase 1 lands

### Phase 6 — Cross-platform decision (separate ADR)

Defer. ADR-0135 if prioritised. Likely options:
- GitHub Actions matrix building per-target on per-OS runners, committing artifacts back to fork
- QEMU local rebuild for linux-x64 / linux-arm64 (slow but feasible)
- Leave as today: manual rebuild when cross-platform regressions surface

## Acceptance criteria

- [ ] Phase 1: `lib/native-rebuild-helpers.sh` extracted; `scripts/native-rebuild.sh` reads per-fork manifest; `scripts/napi-rebuild.sh` either replaced or thin shim
- [ ] Phase 1: manifest schema documented (probably in this ADR § appendix once finalised)
- [ ] Phase 2: ruvector WASM crates rebuild on source change; acceptance test passes
- [ ] Phase 3: agentic-flow rebuild integrated (with platform-skip handling); acceptance test passes
- [ ] Phase 4: ruv-FANN WASM rebuild integrated; acceptance test passes
- [ ] Phase 5: ruflo WASM rebuild integrated; acceptance test passes
- [ ] Phase 1-5 combined: zero stale-binary regressions surface in `npm run test:acceptance` over the next month of releases (proxy: ADR-0094 close-criterion 3 consecutive green runs holds)

## Risks

1. **Build time inflation.** Each new wasm-pack invocation adds 30-60s to the release pipeline cold-path. Mitigated by per-target source-change detection (only rebuild what changed) and per-target build cache (wasm-pack respects `target/` cache).
2. **Toolchain-sensitive failures.** `wasm-pack`, `napi-cli`, etc. need to be installed on the dev host. Surface clearly in pre-flight checks rather than fail at rebuild time.
3. **Per-fork manifest drift from upstream.** When upstream restructures a crate, the manifest goes stale. Mitigated by a "manifest dry-run" check in pre-flight (assert every declared target's source path still exists).
4. **Network dependency.** `wasm-pack build` may pull dependencies. Verdaccio is local but cargo registry is remote. Same as today's release; no new exposure.
5. **Generalisation scope creep.** This ADR could balloon into "rewrite all build infra." §Phases bound it: incremental, one fork at a time, each with its own acceptance gate.

## References

- ADR-0133: the narrow fix this generalises
- `scripts/napi-rebuild.sh`: the prototype implementation (commit `411cca1` + `bec5606`)
- Audit data (this conversation 2026-05-03): file paths + mtimes for each at-risk class
- `lib/fork-paths.sh`: per-fork dir resolution (ADR-0039) — the manifest needs to live alongside this
- `scripts/.last-build-state`: per-fork HEAD tracking; `native-rebuild.sh` uses this to compute `git diff --name-only $PREV $HEAD`
