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

A small per-fork manifest is more robust than per-pattern auto-discovery.

## Trigger architecture — four-layer skip cascade

**Cost concern.** Naively rebuilding every native target every release is ~7 minutes minimum on darwin-arm64 (8 napi × ~30s + 5 wasm × ~60s, + commit+push). Most releases are version bumps with zero source changes — they should pay zero rebuild cost.

The pipeline must skip rebuild work at four progressively-finer layers, each cheaper than running the build:

| Layer | Check | Skip condition | Cost when skipped | Cost when triggered |
|---|---|---|---|---|
| **1. Per-fork HEAD** | `PREV_<FORK>_HEAD == NEW_<FORK>_HEAD` | Fork has no new commits at all | ~10ms (single git rev-parse) | proceed to layer 2 |
| **2. Per-target source-glob** | `git diff --name-only $PREV $HEAD -- <target.sources>` is empty | Target's source paths unchanged within the fork's diff | ~50ms (one git diff per target) | proceed to layer 3 |
| **3. Output-mtime cache** | all `<target.outputs>` have mtime newer than newest matched source mtime | Output already-built atop current source (e.g. another agent rebuilt locally) | ~20ms (stat + compare) | proceed to layer 4 |
| **4. Build-tool incremental** | cargo's `target/` cache + wasm-pack cache + tsc's `.tsbuildinfo` | Per-tool incremental compile | seconds (vs. minutes cold) | full cold rebuild |

These compound:
- **Steady-state release** (no fork changes): all 4 forks skip at layer 1 → ~50ms total overhead
- **Single-fork docs change**: 3 forks skip at layer 1; 1 fork has all targets skip at layer 2 → ~250ms
- **Single-target source change** (e.g. ADR-0133's rvf-runtime fix): 3 forks skip at layer 1; 1 fork has 7 targets skip at layer 2, 1 target rebuild at layer 4 with cargo incremental → ~30s
- **Cold first-run**: all targets at layer 4, cargo cache empty → ~7-10 min (acceptable for first build of the day)

**Key invariant**: skip decisions are conservative (false-positive skips would reproduce the ADR-0133 regression). Layer 2's source-glob match must enumerate transitive Rust dependencies explicitly. Layer 3's output-mtime check is a safety net, not a correctness guarantee.

## Manifest schema (bash-sourced for zero-dep parsing)

Manifest format: bash file with helper function calls. Avoids yaml/toml/json dependency — the pipeline is already bash, and a sourced file gives full validation control.

```bash
# forks/ruvector/.native-targets.sh
# Sourced by scripts/native-rebuild.sh.
# Each declare_native_target call appends one entry to global TARGETS state.

declare_native_target \
  --name        "rvf-node" \
  --sources     "crates/rvf/rvf-runtime/**/*.rs:crates/rvf/rvf-runtime/Cargo.toml:crates/rvf/rvf-node/**/*.rs:crates/rvf/rvf-node/Cargo.toml" \
  --cwd         "crates/rvf/rvf-node" \
  --command     "napi build --platform --release" \
  --outputs     "crates/rvf/rvf-node/*.darwin-arm64.node" \
  --platforms   "darwin-arm64,linux-x64-gnu" \
  --requires    "napi"

declare_native_target \
  --name        "ruvector-attention-wasm" \
  --sources     "crates/ruvector-attention-wasm/**/*.rs:crates/ruvector-attention-wasm/Cargo.toml" \
  --cwd         "crates/ruvector-attention-wasm" \
  --command     "wasm-pack build --release --target nodejs" \
  --outputs     "crates/ruvector-attention-wasm/pkg/*.wasm" \
  --platforms   "any" \
  --requires    "wasm-pack"
```

**Required fields:**
- `--name`: human-readable; appears in logs + acceptance assertions
- `--sources`: colon-separated glob list. Match against `git diff --name-only`. Must enumerate transitive Rust deps (e.g. rvf-node lists rvf-runtime sources). For workspace-wide deps, use `crates/<dep>/**`.
- `--cwd`: relative to fork root; build runs there
- `--command`: full build command, run via `bash -c` in `<cwd>`
- `--outputs`: file glob; mtimes verified post-build

**Optional fields:**
- `--platforms`: comma-separated host triples this target can build on. Defaults to `darwin-arm64`. Use `any` for portable builds (wasm). Targets requiring unavailable platforms are skipped silently with a log note.
- `--requires`: comma-separated tool names to verify in PATH before building. Fail loud at pre-flight if missing — don't crash mid-build.

**Validation** runs at manifest-load time:
- Every `--cwd` path exists relative to fork root
- Every `--sources` glob matches at least one file (catches typos)
- Every `--requires` tool is on PATH (or target is skipped per `--platforms`)

## Parallelism + concurrency

Targets that pass layers 1-3 and reach layer 4 can build in parallel — each target is independent at the build-tool level (cargo handles its own dep graph internally for transitive crates).

Concurrency cap: `N = max(2, $(nproc) / 2)` to avoid thrashing dev hosts. Implementable via:

```bash
echo "${affected_targets[@]}" | xargs -P "$N" -I {} bash -c '<build one>' _ {}
```

Per-target output is captured to per-target log file; aggregate to phase log only on completion. Per memory `feedback-no-tail-tests.md`: capture full output, grep after.

## Failure handling

- **Per-target failure**: build returns non-zero → mark target as failed, capture stderr, continue other targets. After all targets finish, fail the phase loudly with aggregated stderr per failed target.
- **Toolchain missing**: caught at manifest-load (per `--requires`), fail BEFORE any build runs.
- **Output not refreshed despite zero exit**: per memory `feedback-no-fallbacks.md` and `feedback-best-effort-must-rethrow-fatals.md` — treat as fatal. Build script lied; binary is stale; abort.
- **Commit/push failure**: rebase + retry once; second failure aborts with clear error. Don't squash or force.

## State tracking

`scripts/.last-build-state` already tracks per-fork HEAD. That's enough for layer 1 (per-fork skip) and layer 2 (source-glob diff). No new state needed.

For finer-grained per-target build-time tracking (e.g. "last time I successfully built rvf-node was at this hash"), could add `RUVECTOR_RVF_NODE_LAST_BUILT_AT=<sha>` to state file. Not strictly necessary — output-mtime check (layer 3) covers the same ground without state proliferation.

## Out of scope

- **Cross-platform .node binaries** (linux-x64-gnu, linux-arm64-musl, win32-x64-msvc, darwin-x64). These cannot be rebuilt on a single darwin-arm64 dev host without a CI matrix (GitHub Actions per-OS runners) or QEMU emulation. **Separate ADR** (call it ADR-0135 if/when prioritised) should design that pipeline. For now, cross-platform binaries remain manually rebuilt — same posture as today, no regression.
- **Source-of-truth migration for native binaries.** Keeping artifacts in the fork (vs an artifact registry like GitHub Releases or a CDN) is a separate decision. This ADR preserves the current "binaries are checked-in fork artifacts" model.
- **Full clean rebuild.** This phase only triggers when source changed since last build state. A force-rebuild flag (e.g. `--force-native-rebuild`) is fine to add but not load-bearing.

## Implementation phases

### Phase 1 — Design + ADR-0133 generalisation (1 day)

- Manifest format: bash-sourced (per §Manifest schema above) — no new toolchain dependency
- Extract ADR-0133's `napi-rebuild.sh` detection helpers into `lib/native-rebuild-helpers.sh`:
  - `_layer1_fork_unchanged()` — `PREV_<FORK>_HEAD == NEW_<FORK>_HEAD`
  - `_layer2_target_sources_unchanged()` — `git diff --name-only $PREV $HEAD -- <sources>` empty
  - `_layer3_outputs_fresh()` — all outputs newer than newest source mtime
  - `declare_native_target()` — manifest entry parser
  - `validate_target()` — sources exist, requires-tools on PATH, cwd dir exists
- New `scripts/native-rebuild.sh` orchestrates: per-fork manifest load → 4-layer skip cascade → parallel build → verify → commit + push
- ADR-0133's `napi-rebuild.sh` either replaced by `native-rebuild.sh` invocation OR ported to use the new helpers internally (decide during implementation; not load-bearing)
- Per-fork manifest written for ruvector ONLY in this phase (covers ADR-0133 + Phase 2's targets)
- Acceptance: `lib/acceptance-adr0134-phase1.sh` asserts:
  - All 4 skip layers correctly identified for a no-change release (verify ~50ms total overhead)
  - rvf-node rebuild triggered when crates/rvf/rvf-runtime/locking.rs changes (validates ADR-0133 path still works)
  - Output-mtime layer correctly skips when source unchanged but version was bumped

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
