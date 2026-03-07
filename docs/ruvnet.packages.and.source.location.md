# ruvnet Packages and Source Locations

Comprehensive map of all packages across the 3 upstream GitHub repositories owned by `ruvnet`, their publish status, and repackaging integration status.

**Last updated**: 2026-03-07

---

## Repository Overview

| Repository | GitHub URL | Primary Purpose | Published Packages | Total Packages |
|-----------|-----------|----------------|-------------------|---------------|
| **ruflo** | `github.com/ruvnet/ruflo` | CLI monorepo — V3 modular agent orchestration | 22 core + 14 plugins + 1 ruvector-upstream | 60 |
| **agentic-flow** | `github.com/ruvnet/agentic-flow` | Agent orchestration platform + AgentDB | 4 (incl. agent-booster, agentdb-onnx) | 30 |
| **ruv-FANN** | `github.com/ruvnet/ruv-FANN` | Neural network WASM runtime | 2 (incl. cuda-wasm) | 8 |

---

## Matrix 1: Package Directories by Repository

### ruflo (`github.com/ruvnet/ruflo`)

| Directory | Contains | Package Count |
|-----------|----------|--------------|
| `v3/@claude-flow/` | V3 core modules (cli, memory, hooks, etc.) | 22 |
| `v3/plugins/` | Plugin packages (QE, code-intel, healthcare, etc.) | 13 |
| `v3/` (root) | V3 monorepo root `package.json` | 1 |
| `v2/` | V2 legacy `claude-flow` package | 1 |
| `v2/examples/` | Example apps (blog-api, chat-app, etc.) | 11 |
| `v2/src/` | Internal modules (migration, consciousness-symphony) | 3 |
| `packages/` | `coflow` shorthand CLI | 1 |

### agentic-flow (`github.com/ruvnet/agentic-flow`)

| Directory | Contains | Package Count |
|-----------|----------|--------------|
| `/` (root) | `agentic-flow` main package | 1 |
| `agentic-flow/` | Nested `agentic-flow` sub-package | 1 |
| `packages/agentdb/` | AgentDB vector database | 1 |
| `packages/agent-booster/` | Prompt optimization engine | 2 |
| `packages/agentic-jujutsu/` | Jujutsu VCS integration + WASM builds | 5 |
| `packages/agentdb-onnx/` | AgentDB with ONNX embeddings | 1 |
| `agentic-flow/wasm/` | WASM modules (QUIC, ReasoningBank) | 2 |
| `reasoningbank/crates/` | Rust ReasoningBank WASM | 1 |
| `test/`, `tests/`, `bench/`, `benchmarks/` | Test and benchmark suites | 10 |
| `examples/` | Example apps and configs | 4 |
| `src/` | Internal modules (medai backend, e2b tests) | 2 |

### ruv-FANN (`github.com/ruvnet/ruv-FANN`)

| Directory | Contains | Package Count |
|-----------|----------|--------------|
| `ruv-swarm/npm/` | `ruv-swarm` main package | 1 |
| `ruv-swarm/npm/wasm-unified/` | Unified WASM bindings (`@ruv/ruv-swarm-wasm`) | 1 |
| `ruv-swarm/npm/wasm/` | WASM bindings (`ruv-swarm-wasm`) | 1 |
| `cuda-wasm/` | CUDA-to-WASM transpiler | 1 |
| `cuda-wasm/examples/` | CUDA example projects | 1 |
| `tests/` | Test apps | 2 |
| `ruv-swarm/npm/test-npm-install-v106/` | Install compatibility test | 1 |

---

## Matrix 2: Published Packages — Upstream vs Repackaged

### Core Packages (Published by ruvnet AND repackaged by us)

| Upstream Package | npm (ruvnet) | Source Repo | Source Path | @sparkleideas Version | Publish Level |
|-----------------|-------------|------------|-------------|----------------------|--------------|
| `@claude-flow/cli` | 3.5.14 | ruflo | `v3/@claude-flow/cli/` | 3.1.0-alpha.25 | L5 |
| `claude-flow` | 3.5.14 | ruflo | `v2/` + `package.json` | 2.7.59 | L5 |
| `@claude-flow/shared` | 3.0.0-alpha.1 | ruflo | `v3/@claude-flow/shared/` | 3.0.0-alpha.9 | L2 |
| `@claude-flow/memory` | 3.0.0-alpha.11 | ruflo | `v3/@claude-flow/memory/` | 3.0.0-alpha.10 | L2 |
| `@claude-flow/embeddings` | 3.0.0-alpha.1 | ruflo | `v3/@claude-flow/embeddings/` | 3.0.0-alpha.17 | L2 |
| `@claude-flow/codex` | 3.0.0-alpha.9 | ruflo | `v3/@claude-flow/codex/` | 3.0.0-alpha.14 | L2 |
| `@claude-flow/aidefence` | 3.0.2 | ruflo | `v3/@claude-flow/aidefence/` | 3.0.6 | L2 |
| `@claude-flow/neural` | 3.0.0-alpha.7 | ruflo | `v3/@claude-flow/neural/` | 3.0.0-alpha.10 | L3 |
| `@claude-flow/hooks` | 3.0.0-alpha.1 | ruflo | `v3/@claude-flow/hooks/` | 3.0.0-alpha.10 | L3 |
| `@claude-flow/browser` | 3.0.0-alpha.1 | ruflo | `v3/@claude-flow/browser/` | 3.0.0-alpha.9 | L3 |
| `@claude-flow/plugins` | 3.0.0-alpha.1 | ruflo | `v3/@claude-flow/plugins/` | 3.0.0-alpha.10 | L3 |
| `@claude-flow/providers` | 3.0.0-alpha.1 | ruflo | `v3/@claude-flow/providers/` | 3.0.0-alpha.9 | L3 |
| `@claude-flow/claims` | 3.0.0-alpha.8 | ruflo | `v3/@claude-flow/claims/` | 3.0.0-alpha.11 | L3 |
| `@claude-flow/guidance` | 3.0.0-alpha.1 | ruflo | `v3/@claude-flow/guidance/` | 3.0.0-alpha.4 | L4 |
| `@claude-flow/mcp` | 3.0.0-alpha.8 | ruflo | `v3/@claude-flow/mcp/` | 3.0.0-alpha.11 | L4 |
| `@claude-flow/integration` | 3.0.0-alpha.1 | ruflo | `v3/@claude-flow/integration/` | 3.0.3 | L4 |
| `@claude-flow/deployment` | 3.0.0-alpha.1 | ruflo | `v3/@claude-flow/deployment/` | 3.0.0-alpha.10 | L4 |
| `@claude-flow/swarm` | 3.0.0-alpha.1 | ruflo | `v3/@claude-flow/swarm/` | 3.0.0-alpha.9 | L4 |
| `@claude-flow/security` | 3.0.0-alpha.1 | ruflo | `v3/@claude-flow/security/` | 3.0.0-alpha.9 | L4 |
| `@claude-flow/performance` | 3.0.0-alpha.1 | ruflo | `v3/@claude-flow/performance/` | 3.0.0-alpha.9 | L4 |
| `@claude-flow/testing` | 3.0.0-alpha.1 | ruflo | `v3/@claude-flow/testing/` | 3.0.0-alpha.9 | L4 |
| `agentdb` | 3.0.0-alpha.10 | agentic-flow | `packages/agentdb/` | 3.0.0-alpha.6 | L1 |
| `agentic-flow` | 2.0.7 | agentic-flow | `package.json` (root) | 2.0.2-alpha.5 | L1 |
| `ruv-swarm` | 1.0.20 | ruv-FANN | `ruv-swarm/npm/` | 1.0.29 | L1 |
| `agent-booster` | — | agentic-flow | `packages/agent-booster/` | (ADR-0022) | L1 |
| `agentdb-onnx` | — | agentic-flow | `packages/agentdb-onnx/` | (ADR-0022) | L1 |
| `cuda-wasm` | — | ruv-FANN | `cuda-wasm/` | (ADR-0022) | L1 |
| `@claude-flow/ruvector-upstream` | — | ruflo | `v3/plugins/ruvector-upstream/` | (ADR-0022) | L3 |
| `@claude-flow/plugin-gastown-bridge` | 0.1.3 | ruflo | `v3/plugins/gastown-bridge/` | (ADR-0022) | L4 |
| `@claude-flow/plugin-agentic-qe` | 3.0.0-alpha.4 | ruflo | `v3/plugins/agentic-qe/` | (ADR-0022) | L4 |
| `@claude-flow/plugin-code-intelligence` | 3.0.0-alpha.1 | ruflo | `v3/plugins/code-intelligence/` | (ADR-0022) | L4 |
| `@claude-flow/plugin-cognitive-kernel` | 3.0.0-alpha.1 | ruflo | `v3/plugins/cognitive-kernel/` | (ADR-0022) | L4 |
| `@claude-flow/plugin-financial-risk` | 3.0.0-alpha.1 | ruflo | `v3/plugins/financial-risk/` | (ADR-0022) | L4 |
| `@claude-flow/plugin-healthcare-clinical` | 3.0.0-alpha.1 | ruflo | `v3/plugins/healthcare-clinical/` | (ADR-0022) | L4 |
| `@claude-flow/plugin-hyperbolic-reasoning` | 3.0.0-alpha.1 | ruflo | `v3/plugins/hyperbolic-reasoning/` | (ADR-0022) | L4 |
| `@claude-flow/plugin-legal-contracts` | 3.0.0-alpha.1 | ruflo | `v3/plugins/legal-contracts/` | (ADR-0022) | L4 |
| `@claude-flow/plugin-neural-coordination` | 3.0.0-alpha.1 | ruflo | `v3/plugins/neural-coordination/` | (ADR-0022) | L4 |
| `@claude-flow/plugin-perf-optimizer` | 3.0.0-alpha.1 | ruflo | `v3/plugins/perf-optimizer/` | (ADR-0022) | L4 |
| `@claude-flow/plugin-prime-radiant` | 0.1.5 | ruflo | `v3/plugins/prime-radiant/` | (ADR-0022) | L4 |
| `@claude-flow/plugin-quantum-optimizer` | 3.0.0-alpha.1 | ruflo | `v3/plugins/quantum-optimizer/` | (ADR-0022) | L4 |
| `@claude-flow/plugin-test-intelligence` | 3.0.0-alpha.1 | ruflo | `v3/plugins/test-intelligence/` | (ADR-0022) | L4 |
| `@claude-flow/teammate-plugin` | 1.0.0-alpha.1 | ruflo | `v3/plugins/teammate-plugin/` | (ADR-0022) | L4 |

### Packages Published by ruvnet but NOT Repackaged

| Upstream Package | npm Version | Source Repo | Source Path | Description | Recommendation |
|-----------------|-------------|------------|-------------|-------------|---------------|
| `ruflo` | 3.5.14 | — | Published separately | Wrapper package — proxies to `@claude-flow/cli` | N/A — we publish `@sparkleideas/ruflo` from our own repo |

> **Note**: All 13 plugin packages, `teammate-plugin`, and `gastown-bridge` were moved to the "Core Packages" table above per ADR-0022 (Full Ecosystem Repackaging).

---

## Matrix 3: Packages NOT Published on npm (Source-Only)

### ruflo repo — Unpublished

| Package | Source Path | Description | Recommendation |
|---------|-----------|-------------|---------------|
| `@claude-flow/migration` | `v2/src/migration/` | Migration system for V2 → V3 projects | **Skip** — V2 migration utility, no runtime dependency. Not published upstream either. |
| ~~`@claude-flow/ruvector-upstream`~~ | `v3/plugins/ruvector-upstream/` | RuVector WASM package bridges for plugins | **Moved to Matrix 2** — now published per ADR-0022 as `@sparkleideas/ruvector-upstream` (L3). |
| `@claude-flow/v3-monorepo` | `v3/package.json` | Workspace root for V3 monorepo | **Skip** — workspace root, not a distributable package. |
| `coflow` | `packages/coflow/` | Shorthand CLI wrapper for claude-flow | **Skip** — convenience alias, not part of the dependency tree. |
| `guidance-kernel` | `v3/@claude-flow/guidance/wasm-pkg/` | Rust WASM kernel for `@claude-flow/guidance` | **Skip** — compiled WASM artifact, bundled into `@claude-flow/guidance` at build time. |
| `claude-optimized-template` | `v2/src/templates/claude-optimized/` | SPARC methodology template | **Skip** — template, not a runtime dependency. |
| `consciousness-symphony` | `v2/src/consciousness-symphony/` | Experimental consciousness simulation | **Skip** — experimental, no dependents. |
| `publish-registry` | `v3/@claude-flow/cli/cloud-functions/publish-registry/` | IPFS plugin registry publisher | **Skip** — infrastructure tool, not a runtime dependency. |
| `claude-flow-browser-dashboard` | `v2/examples/browser-dashboard/` | Browser swarm monitoring PoC | **Skip** — example app. |
| `claude-flow-parallel-test` | `v2/examples/parallel-2/` | Parallel agent testing | **Skip** — test harness. |
| 6x `app` / `swarm-app` | `v2/examples/*/` | Example apps (blog-api, chat-app, auth-service, etc.) | **Skip** — example apps. |
| 4x `rest-api*` / `notes-cli` / `hello-world-example` | `v2/examples/*/` | Example REST APIs and demos | **Skip** — example apps. |
| `safla-model-training` | `v2/docs/reasoningbank/models/safla/` | SAFLA model training script | **Skip** — training utility, not a runtime dependency. |

### agentic-flow repo — Unpublished

| Package | Source Path | Description | Recommendation |
|---------|-----------|-------------|---------------|
| ~~`agent-booster`~~ | `packages/agent-booster/` | Ultra-fast code editing engine (52x faster than Morph LLM) | **Moved to Matrix 2** — now published per ADR-0022 as `@sparkleideas/agent-booster` (L1). |
| `agent-booster-cli` | `packages/agent-booster/npm/agent-booster-cli/` | CLI for agent-booster | **Skip** — CLI frontend for agent-booster. |
| ~~`agentdb-onnx`~~ | `packages/agentdb-onnx/` | AgentDB with optimized ONNX embeddings | **Moved to Matrix 2** — now published per ADR-0022 as `@sparkleideas/agentdb-onnx` (L1). |
| `agentic-jujutsu` | `packages/agentic-jujutsu/` | Jujutsu VCS integration with quantum-ready architecture | **Skip** — alternative VCS system, not in the dependency tree. Includes WASM builds. |
| `agentic-flow` (nested) | `agentic-flow/` | Sub-package of main agentic-flow | **Skip** — bundled into root `agentic-flow` via `files` array. Not independently published. |
| `agentic-flow-quic` | `agentic-flow/wasm/quic/` | QUIC transport layer WASM module | **Skip** — bundled into `agentic-flow` via `files` array. |
| `reasoningbank-wasm` (×2) | `agentic-flow/wasm/reasoningbank/`, `reasoningbank/crates/*/` | WASM bindings for ReasoningBank | **Skip** — bundled into `agentic-flow`. |
| `@agentdb/benchmarks` | `packages/agentdb/benchmarks/` | AgentDB performance benchmarks | **Skip** — test/benchmark suite. |
| 7x `@agentic-flow/*` test packages | `test/`, `tests/`, `bench/`, `benchmarks/` | Test suites, E2B benchmarks, economics tests | **Skip** — test infrastructure. |
| `@agentic-jujutsu/e2b-tests` | `src/controller/test/e2e/` | Jujutsu E2B sandbox tests | **Skip** — test suite. |
| `research-swarm` | `examples/research-swarm/` | Local SQLite research agent swarm | **Skip** — example application. |
| `nova-medicina` | `examples/nova-medicina/` | AI medical analysis system | **Skip** — example application. |
| `analysis` | `analysis/` | Analysis utilities | **Skip** — internal tooling. |
| `@medai/backend` | `src/utils/` | Medical AI backend | **Skip** — example/research code. |

### ruv-FANN repo — Unpublished

| Package | Source Path | Description | Recommendation |
|---------|-----------|-------------|---------------|
| `@ruv/ruv-swarm-wasm` | `ruv-swarm/npm/wasm-unified/` | Unified WASM bindings for ruv-swarm | **Monitor** — may be needed if `ruv-swarm` starts depending on it for browser support. Currently optional. |
| `ruv-swarm-wasm` | `ruv-swarm/npm/wasm/` | WASM bindings for ruv-swarm | **Skip** — older WASM package, superseded by `@ruv/ruv-swarm-wasm`. |
| ~~`cuda-wasm`~~ | `cuda-wasm/` | CUDA-to-WebAssembly/WebGPU transpiler | **Moved to Matrix 2** — now published per ADR-0022 as `@sparkleideas/cuda-wasm` (L1). |
| `cuda-rust-wasm-basic-vector-ops` | `cuda-wasm/examples/projects/basic-vector-ops/` | CUDA example | **Skip** — example project. |
| `ruv-swarm-test-app` | `tests/init-test/test-swarm/` | ruv-swarm feature test app | **Skip** — test fixture. |
| `test-wasm-loading` | `tests/test-wasm-loading/` | WASM loading test | **Skip** — test fixture. |
| `test-npm-install-v106` | `ruv-swarm/npm/test-npm-install-v106/` | Node v106 install compatibility test | **Skip** — test fixture. |

---

## Matrix 4: Integration Recommendations Summary

### Priority: Integrate — DONE (ADR-0022)

| Package | Status | Notes |
|---------|--------|-------|
| `@claude-flow/plugin-gastown-bridge` | **Integrated** | Now published as `@sparkleideas/plugin-gastown-bridge` (L4). |
| `@claude-flow/teammate-plugin` | **Integrated** | Now published as `@sparkleideas/teammate-plugin` (L4). |
| `agent-booster` | **Integrated** | Now published as `@sparkleideas/agent-booster` (L1). |
| `agentdb-onnx` | **Integrated** | Now published as `@sparkleideas/agentdb-onnx` (L1). |
| `cuda-wasm` | **Integrated** | Now published as `@sparkleideas/cuda-wasm` (L1). |
| `@claude-flow/ruvector-upstream` | **Integrated** | Now published as `@sparkleideas/ruvector-upstream` (L3). |
| 13 plugin packages | **Integrated** | All now published as `@sparkleideas/plugin-*` (L4). |

### Priority: Monitor

| Package | Trigger for Integration |
|---------|----------------------|
| `@ruv/ruv-swarm-wasm` | `ruv-swarm` adds WASM bindings as a dependency for browser support. |

### Priority: Skip (No Integration Needed)

| Category | Count | Reason |
|----------|-------|--------|
| Example apps | ~15 | Demo code, not distributable packages. |
| Test/benchmark suites | ~12 | Development infrastructure. |
| WASM build artifacts | 5 | Bundled into parent packages at build time. |
| Internal/legacy modules | 6 | V2 migration, workspace roots, infrastructure tools. |
| Research/experimental | 3 | Not part of any dependency tree. |

---

## Matrix 5: Repackaging Pipeline Coverage

| What Changes Upstream | Codemod | Publish | Integration Test | Action Needed |
|----------------------|---------|---------|-----------------|--------------|
| New commit in existing package | Auto | Auto | Auto | None |
| Version bump in existing package | Auto | Auto (next > upstream) | Auto | None |
| New `@claude-flow/*` core package | Auto rename | **MISSING** — not in `LEVELS` | **Catches it** — Phase 8 install fails | Add to `LEVELS` or implement auto-discovery |
| New plugin package | Auto rename | Not needed (dynamic load) | N/A | None |
| New unscoped package (e.g. `agentdb-v2`) | No rename needed | **MISSING** — not in `LEVELS` | **Catches it** if depended on | Add to `LEVELS` if any package depends on it |
| Package removed upstream | N/A | Publishes stale version | N/A | Remove from `LEVELS` |
| Dependency added between existing packages | Auto | Auto | Auto | May need `LEVELS` reorder |
| New external dependency (e.g. `zod`) | Pass-through | Pass-through | Auto (Verdaccio proxies) | None |

### Key Gap

The static `LEVELS` array in `publish.mjs` must be manually updated when upstream adds a new package. The integration test (Phase 8) catches this before publish to npm, but the fix requires a code change. Auto-discovery with topological sort would eliminate this manual step entirely.
