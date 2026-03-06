# Unpublished Source Packages

Comprehensive catalog of source-only packages across the three upstream repositories that are **not** published under the `@sparkleideas/*` scope. Each entry includes a description from its README, integration method, and recommendation.

**Published packages (24)** are documented in [ruvnet.packages.and.source.location.md](ruvnet.packages.and.source.location.md).
**Installable plugins (14)** are documented in [plugin-catalog.md](plugin-catalog.md).

---

## Summary

| Repository | Unpublished | Category Breakdown |
|-----------|-------------|-------------------|
| **ruflo** (`v3/`) | 13 core + 14 plugins | Core libraries, plugins |
| **agentic-flow** | 9 | Tools, examples, benchmarks |
| **ruv-FANN** | 3 projects (10 crates) | Rust/WASM libraries |
| **Total** | **36+ packages** | |

---

## Integration Decision Framework

| Recommendation | Meaning | Action |
|---------------|---------|--------|
| **Integrate** | Required by published packages or high user value | Add to publish pipeline |
| **Monitor** | Useful but no current demand or dependency | Watch for upstream changes |
| **Skip** | Internal tooling, examples, or different ecosystem (Rust/Python) | Do not integrate |

---

## Repository 1: ruflo (`v3/`)

### Core Libraries (13 packages)

#### 1. @claude-flow/browser

**Version:** 3.0.0-alpha.2
**Path:** `v3/@claude-flow/browser`
**Dependencies:** agent-browser, agentic-flow, zod

Browser automation for AI agents — integrates agent-browser with Claude Flow swarms. Provides 59 MCP browser tools with security-first design including PII scanning. Features trajectory learning for SONA integration, AI-optimized snapshots that achieve 93% context reduction compared to full DOM snapshots, swarm coordination for parallel browser tasks, and 9 workflow templates for common automation patterns (form filling, data extraction, testing, monitoring). The snapshot system converts complex browser state into structured, token-efficient representations that AI agents can reason about effectively.

**Integration method:** Add to `LEVELS` at Level 2 (depends on agentic-flow). Requires codemod scope rename. No build step needed (ships JS).
**Recommendation:** **Monitor** — Useful capability but no published package depends on it. Integration adds external dependency on `agent-browser`.

---

#### 2. @claude-flow/claims

**Version:** 3.0.0-alpha.8
**Path:** `v3/@claude-flow/claims`
**Dependencies:** zod

Issue claiming and work coordination module for Claude Flow V3. Provides 17 MCP tools for issue claiming, handoffs between humans and agents, work stealing, and load balancing. Enables multiple agents to coordinate on a shared task board without conflicts — agents claim issues before working on them, hand off partially-completed work to other agents, and steal unclaimed work when idle. The load balancing system monitors agent utilization and redistributes work to prevent bottlenecks. Designed for scenarios where a swarm of agents collaborates on a GitHub issue backlog or a shared task queue.

**Integration method:** Add to `LEVELS` at Level 1 (only depends on zod, which is external). Codemod handles scope rename.
**Recommendation:** **Monitor** — Standalone coordination module. Integrate when `@claude-flow/cli` adds it as a dependency or users request it.

---

#### 3. @claude-flow/codex

**Version:** 3.0.0-alpha.9
**Path:** `v3/@claude-flow/codex`
**Dependencies:** commander, fs-extra, chalk, inquirer, yaml, toml, @iarna/toml

OpenAI Codex CLI adapter for Claude Flow. Enables self-learning multi-agent orchestration across both Claude Code and OpenAI Codex CLI platforms. Generates AGENTS.md files for Codex CLI compatibility, provides MCP integration for 137+ skills, implements vector memory with HNSW search, and supports auto-registration of agent capabilities. The dual-platform support means the same agent definitions work in both Claude Code (via MCP) and Codex CLI (via AGENTS.md), enabling teams that use both platforms to share agent configurations. Self-learning patterns improve agent performance over time through trajectory tracking.

**Integration method:** Add to `LEVELS` at Level 1 (all external deps). Heavy dependency footprint (7 packages).
**Recommendation:** **Skip** — Codex CLI interop is a niche use case. Adds significant dependency weight for a cross-platform bridge most users won't need.

---

#### 4. @claude-flow/deployment

**Version:** 3.0.0-alpha.7
**Path:** `v3/@claude-flow/deployment`
**Dependencies:** @claude-flow/shared

Release management, CI/CD, and versioning module. Handles version bumping (semver-aware with prerelease support), changelog generation from conventional commits, git integration (tagging, branching), npm publishing with pre-release validation, and dry-run mode for testing release workflows without side effects. Designed to automate the release pipeline for Claude Flow packages. The validation step checks that all tests pass, dependencies resolve, and the package builds before allowing a publish.

**Integration method:** Add to `LEVELS` at Level 2 (depends on @claude-flow/shared → @sparkleideas/shared). Codemod handles internal dep rename.
**Recommendation:** **Skip** — We have our own publish pipeline (`publish.mjs`, `sync-and-build.sh`). This module serves upstream's release process, not ours.

---

#### 5. @claude-flow/embeddings

**Version:** 3.0.0-alpha.12
**Path:** `v3/@claude-flow/embeddings`
**Dependencies:** @xenova/transformers, sql.js

V3 Embedding Service supporting multiple providers: OpenAI API, Transformers.js (local), Agentic-Flow ONNX (75x faster), and a mock provider for testing. Features auto-install of embedding models on first use, smart fallback when a provider is unavailable, LRU and disk caching for repeated queries, batch processing for bulk embedding operations, document chunking with configurable overlap, and hyperbolic embeddings for hierarchical data. The neural substrate integration connects embeddings to the SONA learning system for pattern-aware similarity search. The ONNX provider delivers 75x faster inference than the default Transformers.js provider.

**Integration method:** Add to `LEVELS` at Level 1 (external deps only). Large dependency: `@xenova/transformers` pulls ~200MB of ONNX models.
**Recommendation:** **Monitor** — High-value module (embeddings power semantic search). But the large dependency footprint and the fact that the CLI already uses hash embeddings as a lightweight fallback means this is best deferred until users need higher-quality embeddings.

---

#### 6. @claude-flow/integration

**Version:** 3.0.0-alpha.1
**Path:** `v3/@claude-flow/integration`
**Dependencies:** None (optional: agentic-flow)

Deep agentic-flow@alpha integration module implementing ADR-001 compliance. Provides a SONA adapter for self-optimizing neural architecture, Flash Attention bridge delivering 2.49x-7.47x speedup, SDK bridge for agentic-flow APIs, feature flags for progressive rollout of new capabilities, runtime detection of available agentic-flow features, and graceful fallback when agentic-flow is not installed. This module is the glue layer between Claude Flow's higher-level orchestration and agentic-flow's lower-level neural/vector infrastructure.

**Integration method:** Add to `LEVELS` at Level 1 (zero required deps). Codemod handles scope rename.
**Recommendation:** **Monitor** — Important architectural module but currently the CLI works without it. Integrate when Flash Attention or deep SONA integration becomes a user-facing feature.

---

#### 7. @claude-flow/neural

**Version:** 3.0.0-alpha.7
**Path:** `v3/@claude-flow/neural`
**Dependencies:** @claude-flow/memory, @ruvector/sona

Neural module providing SONA learning integration and neural modes. Implements 5 learning modes (supervised, unsupervised, reinforcement, transfer, meta-learning) and 9 reinforcement learning algorithms (Q-Learning, SARSA, Actor-Critic, PPO, DQN, A3C, TD3, SAC, Decision Transformer). Features LoRA integration for parameter-efficient fine-tuning, EWC++ memory preservation to prevent catastrophic forgetting, trajectory tracking for learning from experience, and pattern recognition for recurring code and architecture patterns. The neural modes allow agents to learn from their interactions and improve over time.

**Integration method:** Add to `LEVELS` at Level 3 (depends on @claude-flow/memory → @sparkleideas/memory). Also needs @ruvector/sona (external).
**Recommendation:** **Monitor** — Core learning infrastructure. The CLI already exposes `neural train` and `neural patterns` commands that work with a simpler implementation. Integrate when the full SONA-backed neural system is needed.

---

#### 8. @claude-flow/performance

**Version:** 3.0.0-alpha.6
**Path:** `v3/@claude-flow/performance`
**Dependencies:** @ruvector/attention, @ruvector/sona

Performance module for benchmarking, Flash Attention validation, and optimization. Provides statistical benchmarking with configurable iterations and warmup, memory tracking to detect leaks during benchmarks, auto-calibration that adjusts iteration count for statistical significance, regression detection against baseline measurements, V3 performance target validation (e.g., <10ms vector search, <2ms memory insert), Flash Attention speedup verification, and multiple output formats (JSON, CSV, markdown tables). Useful for CI pipelines that need to gate on performance regressions.

**Integration method:** Add to `LEVELS` at Level 1 (external deps only — @ruvector packages).
**Recommendation:** **Skip** — Internal performance tooling. Users don't install a benchmarking module; it's for the development team. Our own test pipeline handles performance validation.

---

#### 9. @claude-flow/plugins

**Version:** 3.0.0-alpha.7
**Path:** `v3/@claude-flow/plugins`
**Dependencies:** events

Unified Plugin SDK for Claude Flow V3. Provides the plugin builder API, MCP tool builder for creating new MCP tools within plugins, hook system for intercepting Claude Flow lifecycle events, worker plugins for background task execution, provider pattern for abstracting external services, plugin registry for discovery and loading, and 8+ export entrypoints for granular imports. This is the framework that all `@claude-flow/plugin-*` packages are built on. Without it, plugins can't register their MCP tools or lifecycle hooks.

**Integration method:** Add to `LEVELS` at Level 1 (only depends on `events`). Codemod handles scope rename.
**Recommendation:** **Integrate** — This is the plugin SDK. If users install any plugin via `npx @sparkleideas/cli plugins install`, this SDK must be available. It's the foundation all 14 plugins depend on. Should be added to the publish pipeline as a prerequisite for plugin support.

---

#### 10. @claude-flow/providers

**Version:** 3.0.0-alpha.6
**Path:** `v3/@claude-flow/providers`
**Dependencies:** events

Multi-LLM provider system for Claude Flow V3. Supports 6+ LLM providers: Anthropic (Claude), OpenAI (GPT), Google (Gemini), Cohere, Ollama (local), and RuVector. Implements load balancing across providers, automatic failover when a provider is down or rate-limited, request caching to avoid duplicate API calls, cost optimization achieving 85%+ savings through intelligent routing, streaming support for real-time responses, tool calling abstraction across providers, health monitoring with provider status tracking, and cost tracking per request and per provider. Enables multi-model architectures where different agents in a swarm use different LLM providers based on task complexity and cost.

**Integration method:** Add to `LEVELS` at Level 1 (only depends on `events`). Codemod handles scope rename.
**Recommendation:** **Monitor** — High-value module for multi-model setups. Currently the CLI hardcodes Claude as the provider. Integrate when multi-provider support becomes a user-facing feature or upstream adds it as a dependency.

---

#### 11. @claude-flow/security

**Version:** 3.0.0-alpha.6
**Path:** `v3/@claude-flow/security`
**Dependencies:** bcrypt, zod

Security module implementing CVE fixes, input validation, and path security. Addresses specific CVEs (CVE-2, CVE-3, HIGH-1, HIGH-2) with bcrypt password hashing for stored credentials, cryptographic credential generation, safe command execution that prevents shell injection, path validation to block directory traversal attacks, input validation using Zod schemas at all system boundaries, and secure token generation for API authentication. This module hardens Claude Flow against the OWASP top 10 categories of vulnerabilities.

**Integration method:** Add to `LEVELS` at Level 1 (external deps: bcrypt, zod). Adds native dependency (bcrypt requires node-gyp compilation).
**Recommendation:** **Monitor** — Security hardening is important but `bcrypt` requires native compilation (node-gyp), which complicates cross-platform installs. Integrate when security audit identifies gaps in the published CLI.

---

#### 12. @claude-flow/swarm

**Version:** 3.0.0-alpha.6
**Path:** `v3/@claude-flow/swarm`
**Dependencies:** None

V3 Unified Swarm Coordination Module implementing ADR-003. Provides the UnifiedSwarmCoordinator as the single canonical coordination engine, QueenCoordinator for hive-mind intelligence with emergent behavior, AttentionCoordinator delivering 2.49x-7.47x speedup through Flash Attention, FederationHub for cross-swarm coordination, and three consensus protocols (Raft, Byzantine, Gossip). Supports 4 topology types (hierarchical, mesh, star, ring) and scales to 100+ agents with <100ms coordination latency. This is the core swarm engine that the CLI's `swarm init` command uses.

**Integration method:** Add to `LEVELS` at Level 1 (zero dependencies). Codemod handles scope rename.
**Recommendation:** **Monitor** — The CLI already bundles swarm coordination inline. This standalone module would be needed if swarm coordination is factored out of the CLI into a separate importable library. Integrate when upstream refactors the CLI to depend on this module.

---

#### 13. @claude-flow/testing

**Version:** 3.0.0-alpha.6
**Path:** `v3/@claude-flow/testing`
**Dependencies:** None (vitest as peer)

Testing module providing TDD London School framework, test utilities, fixtures, and mock services. Built on Vitest (per ADR-008), it provides London School TDD patterns emphasizing behavior verification over state verification, shared fixtures for agent, swarm, and MCP testing, mock services for external dependencies, and custom Vitest matchers for Claude Flow assertions. Designed as a devDependency for plugin and module authors writing tests against the Claude Flow API.

**Integration method:** Add to `LEVELS` at Level 1 (no required deps). Publish as a devDependency-only package.
**Recommendation:** **Skip** — Test utilities for upstream developers. End users don't install test frameworks. Our own test pipeline uses its own helpers.

---

### Plugins (14 packages)

Plugins are already cataloged in detail in [plugin-catalog.md](plugin-catalog.md). Below is a summary with integration recommendations.

| Plugin | Version | Deps | Recommendation | Rationale |
|--------|---------|------|---------------|-----------|
| `plugin-agentic-qe` | 3.0.0-alpha.4 | zod | **Monitor** | 58 QA agents; high value but no demand signal yet |
| `plugin-code-intelligence` | 3.0.0-alpha.1 | ruvector-upstream, zod | **Monitor** | Semantic code search; needs WASM packages |
| `plugin-cognitive-kernel` | 3.0.0-alpha.1 | zod | **Monitor** | Cognitive augmentation; niche use case |
| `plugin-financial-risk` | 3.0.0-alpha.1 | zod, WASM (optional) | **Skip** | Domain-specific (finance); not general-purpose |
| `plugin-healthcare-clinical` | 3.0.0-alpha.1 | zod, WASM (optional) | **Skip** | Domain-specific (healthcare); HIPAA scope |
| `plugin-hyperbolic-reasoning` | 3.0.0-alpha.1 | zod, WASM (optional) | **Monitor** | Exotic but useful for hierarchy modeling |
| `plugin-legal-contracts` | 3.0.0-alpha.1 | ruvector-upstream, zod | **Skip** | Domain-specific (legal) |
| `plugin-neural-coordination` | 3.0.0-alpha.1 | zod | **Monitor** | Multi-agent coordination; complements swarm |
| `plugin-perf-optimizer` | 3.0.0-alpha.1 | zod | **Monitor** | Performance analysis; useful for dev teams |
| `plugin-prime-radiant` | 0.1.5 | zod, WASM (optional) | **Monitor** | Hallucination prevention; high value |
| `plugin-quantum-optimizer` | 3.0.0-alpha.1 | zod, WASM (optional) | **Skip** | Exotic optimization; niche |
| `ruvector-upstream` | 3.0.0-alpha.1 | zod, WASM (optional) | **Integrate** | WASM bridge layer all plugins depend on |
| `teammate-plugin` | 1.0.0-alpha.1 | eventemitter3, bmssp | **Monitor** | See [ADR-0021](adr/0021-teammate-plugin-integration.md) |
| `plugin-test-intelligence` | 3.0.0-alpha.1 | zod | **Monitor** | Predictive test selection; high value for CI |

---

## Repository 2: agentic-flow

### Tools and Libraries (3 packages)

#### 14. agent-booster

**Version:** 0.2.2
**Path:** `packages/agent-booster/`
**Dependencies:** Rust/WASM compiled

Ultra-fast code editing engine — 52x faster than Morph LLM at $0 cost. A high-performance code transformation engine designed to eliminate the latency and cost bottleneck in AI coding agents. Built in Rust with WebAssembly, it applies code edits 350x faster than LLM-based alternatives while maintaining 100% accuracy. Provides sub-millisecond code transformations, 100% local processing with zero API costs, deterministic results with confidence scoring, MCP tools integration (Claude Desktop, Cursor, VS Code), an API server compatible with the Morph LLM protocol, and a WASM + Rust backend for native speed. The edit operations are AST-aware, meaning they understand code structure rather than treating code as plain text.

**Integration method:** Add to `LEVELS` at Level 1 (no internal deps). Ships pre-built WASM. Provides `agent-booster` and `agent-booster-server` binaries.
**Recommendation:** **Integrate** — Referenced by ADR-026 (3-Tier Model Routing) as the Tier 1 handler. The CLI already checks for `[AGENT_BOOSTER_AVAILABLE]`. Publishing this under `@sparkleideas/agent-booster` enables the zero-cost code transformation tier.

---

#### 15. agentdb-onnx

**Version:** 1.0.0
**Path:** `packages/agentdb-onnx/`
**Dependencies:** onnxruntime-node, @xenova/transformers

AgentDB with optimized ONNX embeddings — 100% local, GPU-accelerated AI agent memory. Extends the base AgentDB with high-quality ONNX-based embeddings instead of hash embeddings. Provides 100% local inference with no API calls and complete data privacy, GPU acceleration via CUDA, DirectML, and CoreML, batch processing that is 3-4x faster than sequential embedding, LRU caching with 80%+ hit rate, model warmup for consistent latency, ReasoningBank integration for pattern storage, and Reflexion Memory for self-improving episodic memory. Supports multiple Xenova embedding models (all-MiniLM-L6-v2, bge-small-en-v1.5, e5-small-v2, etc.) with automatic download on first use.

**Integration method:** Add to `LEVELS` at Level 1 (external deps). Large dependency: `onnxruntime-node` is ~100MB and platform-specific.
**Recommendation:** **Monitor** — Significant quality upgrade over hash embeddings (cosine similarity 0.6-0.95 vs 0.1-0.28). But the 100MB+ dependency footprint and platform-specific native binaries make it unsuitable for a lightweight CLI install. Better as an optional enhancement users install separately.

---

#### 16. agentic-llm

**Path:** `packages/agentic-llm/`
**Dependencies:** Python (PyTorch, Transformers, PEFT, TRL)

GPU-enabled Agentic LLM Training System for Phi-4 model optimization. A containerized Python training system (not an npm package) for fine-tuning the Phi-4 language model with MCP integration. Uses CUDA 12.1, PyTorch, and LoRA training (r=32, alpha=64, 5 epochs). Deploys to Google Cloud Run with 32GB RAM, 8 vCPUs, and L4 GPU (24GB VRAM). Includes automated health server monitoring, email notification for training completion, and quantization tools (ONNX, auto-gptq, bitsandbytes). Cost is approximately $25-30 per training run.

**Integration method:** N/A — Python/Docker project, not an npm package.
**Recommendation:** **Skip** — Different ecosystem (Python/CUDA). Cannot be published to npm.

---

### Examples (3 packages)

#### 17. nova-medicina

**Version:** 1.0.0
**Path:** `examples/nova-medicina/`
**Dependencies:** Various

AI-powered medical analysis system with anti-hallucination safeguards. An intelligent medical triage assistant that helps users understand symptoms and make informed healthcare decisions. Uses multi-model consensus for cross-validation, truth verification with anti-hallucination scoring (95%+ accuracy threshold), citation-backed medical claims from peer-reviewed sources, provider approval for critical recommendations, HIPAA-compliant data protection, automatic escalation for emergencies, and evidence-based recommendations with medical citations. Explicitly positioned as a supplement to professional healthcare, not a replacement.

**Integration method:** Publish as standalone example package.
**Recommendation:** **Skip** — Example/demo application. Not a library or tool that other packages consume.

---

#### 18. research-swarm

**Version:** 1.2.2
**Path:** `examples/research-swarm/`
**Dependencies:** Various (SQLite, web search providers)

Local SQLite-based AI research agent swarm with GOAP planning, multi-perspective analysis, and MCP server. Deploys 3-7 specialized research agents that collaborate using Goal-Oriented Action Planning (GOAP). Features adaptive swarm sizing based on research complexity, multi-provider web search (Google Gemini, Claude MCP, OpenRouter), 100% offline-capable SQLite persistence, Supabase federation for enterprise deployment, ReasoningBank integration with HNSW search (150x faster, 3,848 ops/sec), 5-phase recursive framework with 51-layer verification, memory distillation, and anti-hallucination protocols. Provides both stdio and HTTP/SSE MCP server modes.

**Integration method:** Publish as standalone tool package with CLI binary.
**Recommendation:** **Skip** — Example application demonstrating swarm capabilities. Not a dependency of any published package.

---

#### 19. analysis (Maternal Life-History Trade-Off Analysis)

**Version:** 1.0.0
**Path:** `analysis/`
**Dependencies:** AgentDB

Comprehensive AI-powered analysis of maternal health, environmental stress, and reproductive trade-offs using AgentDB's advanced learning capabilities. Uses 1536-dimensional vector embeddings, HNSW indexing (150x faster search), 8-bit quantization (4x memory reduction), and 9 reinforcement learning algorithms. Analyzes historical data from the Finnish Famine (1866-1868), Quebec Population (1621-1800), Dutch Hunger Winter (1944-1945), Siege of Leningrad (1941-1944), and Bangladesh Famines (1974-1975).

**Integration method:** N/A — Domain-specific research application.
**Recommendation:** **Skip** — Research demo, not a reusable library.

---

### Internal/Benchmarks (3 packages)

#### 20. @agentic-flow/benchmarks

**Version:** 2.0.0-alpha
**Path:** `benchmarks/`
**Dependencies:** vitest, agentic-flow

Performance benchmark suite for validating Agentic-Flow v2 targets. Measures vector search (1M vectors, <10ms P50), agent spawn (<10ms P50), memory insert (<2ms P50), task orchestration (<50ms P50), attention mechanisms (<20ms P50), and GNN forward pass (<50ms P50). Includes regression detection comparing v1.0 vs v2.0 performance.

**Integration method:** N/A — Internal dev tooling.
**Recommendation:** **Skip** — Development benchmarks, not user-facing.

---

#### 21. @agentic-flow/reasoningbank-benchmark

**Version:** 1.0.0
**Path:** `bench/`
**Dependencies:** vitest, agentic-flow

Benchmark suite for ReasoningBank's closed-loop learning capabilities. Evaluates the 4-phase learning loop (RETRIEVE, JUDGE, DISTILL, CONSOLIDATE) across coding, debugging, API design, and problem-solving tasks. Measures success rate transformation (0% to 100% over 20-30 iterations), token reduction (~32.3% via memory injection), retrieval latency (<500ms), memory deduplication (95%+), and learning velocity (2.8-4.4x faster than baseline).

**Integration method:** N/A — Internal dev tooling.
**Recommendation:** **Skip** — Benchmark suite for upstream development.

---

#### 22. @agentic-flow/quic-tests

**Version:** 1.0.0
**Path:** `tests/`
**Dependencies:** vitest

Test suite for QUIC protocol implementation. Covers transport layer (connection establishment, stream multiplexing, connection migration), proxy layer (agent communication, HTTP/2 fallback), and E2E workflows (swarm initialization, SPARC workflows, stress testing with 50-100 agents). Targets 90%+ coverage.

**Integration method:** N/A — Internal test suite.
**Recommendation:** **Skip** — Test infrastructure for upstream development.

---

## Repository 3: ruv-FANN

### CUDA/WASM (1 package)

#### 23. cuda-wasm

**Version:** 1.1.1
**Path:** `cuda-wasm/`
**Dependencies:** Rust toolchain

High-performance CUDA to WebAssembly/WebGPU transpiler with Rust safety. Enables GPU-accelerated computing in browsers and Node.js by transpiling CUDA kernels to WebAssembly and WebGPU shaders. Supports SIMD optimizations, compute kernels, and automatic optimization. Performance benchmarks show 2.5-4x faster training and 3-5x faster inference compared to Python implementations. Includes advanced profiling and automatic kernel optimization. Provides a CLI tool (`cuda-wasm`) for transpilation workflows.

**Integration method:** Publish as `@sparkleideas/cuda-wasm`. Ships compiled WASM.
**Recommendation:** **Skip** — Specialized GPU transpilation tool. Not a dependency of any Claude Flow package. Users who need CUDA-to-WASM transpilation would use the upstream package directly.

---

### Neural Forecasting (5 Rust crates)

#### 24. neuro-divergent (workspace)

**Path:** `neuro-divergent/`
**Language:** Rust

High-performance neural forecasting library for Rust with 100% API compatibility with Python's NeuralForecast. Implements 27+ neural forecasting models across 6 categories.

| Crate | Description |
|-------|-------------|
| `neuro-divergent-core` | Type-safe foundation with `BaseModel<T>`, `ForecastingEngine<T>`, `TimeSeriesDataFrame` (Polars-backed), `NetworkAdapter` for ruv-FANN integration |
| `neuro-divergent-data` | Data processing pipeline with scalers (Standard, MinMax, Robust, Quantile), transformations (Log, Box-Cox, Differencing), feature engineering (lag, rolling stats, Fourier), outlier detection (IQR, Z-score, Isolation Forest) |
| `neuro-divergent-models` | 27+ models: Basic (MLP, DLinear, NLinear), Recurrent (RNN, LSTM, GRU), Advanced (NBEATS, NHITS, TiDE), Transformer (TFT, Informer, PatchTST, iTransformer), Specialized (DeepAR, TCN, TimesNet, StemGNN, TimeLLM) |
| `neuro-divergent-registry` | Model factory with global registry, dynamic creation by string name, plugin system with security framework, performance profiling |
| `neuro-divergent-training` | Training infrastructure: optimizers (Adam, AdamW, SGD, RMSprop), loss functions (MAE, MSE, MAPE, Pinball, CRPS), schedulers (cosine, warmup, cyclic, seasonal) |

**Integration method:** N/A — Rust crates, not npm packages.
**Recommendation:** **Skip** — Rust ecosystem. Cannot be published to npm. No JavaScript/TypeScript interface.

---

### Computer Vision (4+ Rust crates)

#### 25. opencv-rust (workspace)

**Path:** `opencv-rust/`
**Language:** Rust

Complete, memory-safe, high-performance computer vision library in pure Rust with full OpenCV 4.x API compatibility and FANN integration.

| Crate | Description |
|-------|-------------|
| `opencv-core` | Core FFI bindings to OpenCV C/C++ |
| `opencv-sys` | Low-level system bindings |
| `opencv-wasm` | WebAssembly bindings for browser deployment |
| `opencv-sdk` | High-level SDK and developer API |

Features image processing, feature detection, object detection, video processing, 3D vision, camera calibration, FANN neural network integration, CUDA GPU acceleration, SIMD optimizations, and WebAssembly support. Drop-in replacement for OpenCV C++/Python APIs.

**Integration method:** N/A — Rust crates with C++ FFI. The `opencv-wasm` crate could theoretically be published to npm but would need a JS wrapper.
**Recommendation:** **Skip** — Rust/C++ ecosystem. The WASM output could be useful for browser-based vision but is far outside Claude Flow's scope.

---

## Integration Priority Matrix

### Integrate Now (2 packages)

| Package | Rationale | Level | Effort |
|---------|-----------|-------|--------|
| `@claude-flow/plugins` (Plugin SDK) | Foundation for all 14 plugins | L1 | Low — zero internal deps, ships JS |
| `agent-booster` | ADR-026 Tier 1 handler, CLI already checks for it | L1 | Low — ships pre-built WASM |

### Integrate When Triggered (2 packages)

| Package | Trigger | Level |
|---------|---------|-------|
| `ruvector-upstream` (WASM bridges) | Any plugin integrated that depends on WASM | L1 |
| `@claude-flow/embeddings` | Users need higher-quality search than hash embeddings | L1 |

### Monitor (11 packages)

| Package | Watch For |
|---------|-----------|
| `@claude-flow/browser` | CLI adds browser automation commands |
| `@claude-flow/claims` | CLI adds issue claiming features |
| `@claude-flow/integration` | Flash Attention becomes user-facing |
| `@claude-flow/neural` | Full SONA learning exposed in CLI |
| `@claude-flow/providers` | Multi-LLM provider support added to CLI |
| `@claude-flow/security` | Security audit identifies gaps |
| `@claude-flow/swarm` | CLI refactors swarm into separate module |
| `agentdb-onnx` | Users need high-quality local embeddings |
| `plugin-agentic-qe` | QA automation demand |
| `plugin-prime-radiant` | Hallucination prevention demand |
| `teammate-plugin` | See [ADR-0021](adr/0021-teammate-plugin-integration.md) |

### Skip (22 packages)

Internal tooling, examples, domain-specific applications, and non-JavaScript ecosystems. No integration path or user demand.

---

## References

- [Published packages (24)](ruvnet.packages.and.source.location.md)
- [Plugin catalog (14)](plugin-catalog.md)
- [ADR-0021: Teammate Plugin Integration](adr/0021-teammate-plugin-integration.md)
- [ADR-0014: Topological Publish Order](adr/0014-topological-publish-order.md)
- Upstream repos: [ruflo](https://github.com/ruvnet/ruflo), [agentic-flow](https://github.com/ruvnet/agentic-flow), [ruv-FANN](https://github.com/ruvnet/ruv-FANN)
