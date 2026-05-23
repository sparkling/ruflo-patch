# 16 — Gap analysis: what the 2026-05-19 audit did NOT cover

**Parent**: [ADR-0201](../../adr/ADR-0201-codebase-soundness-completeness-audit-with-runtime-validation.md)
**Companion**: [00-README.md](00-README.md)

The user's scope explicitly named: hooks, controllers, skills, MCP functions, daemon, MCP servers installed by `ruflo init`. The 15-agent dispatch added: config soundness + test coverage + runtime validation in a real test project.

This document lists everything **not** in that scope. Each gap names the surface, the risk if unaudited, and a suggested next-pass approach.

---

## Risk ranking

* **HIGH** — gap touches a production-load-bearing path or a published-user-visible behaviour.
* **MEDIUM** — gap is significant but failure mode is recoverable.
* **LOW** — gap is housekeeping / quality / nice-to-have.

---

## A. Production-load-bearing surfaces NOT audited

### G-16-001 [HIGH] CLI commands beyond `daemon` and `init`

* What we covered: only the `daemon` family + `init`.
* Out of scope: every other `ruflo` subcommand — `swarm`, `agent`, `task`, `memory`, `mcp`, `plugin`, `hive-mind`, `claims`, `autopilot`, `doctor`, `config`, `intelligence`, `learn`, `route`, `worker`, `transfer`, `notify`, `goal`, `embeddings`, `neural`, `ruvllm`, `marketplace`, `hooks` (as CLI commands; the hook MCP tools were audited), and ~20 others.
* Risk: a working `daemon` + `init` doesn't prove the user-facing CLI works. Each command has its own argument-parsing, validation, error handling, output formatting. The `allowUnknownFlags: true` pattern (F-02 finding) likely affects every command.
* Approach: single-agent sweep with `ruflo <cmd> --help` enumeration + grep for stub-shaped handlers. Likely yields the same stub-vs-real ratio as the MCP tool handler audit (~3% stubs).

### G-16-002 [HIGH] Plugin contents — what each plugin actually does

* What we covered: plugin **MCP registration** (audited as "prose-only") and plugin **skills** (audited as part of skills inventory).
* Out of scope: plugin code itself — `forks/ruflo/plugins/ruflo-core`, `ruflo-agentdb`, `ruflo-wasm`, `ruflo-goals`, `plugin-agent-federation`, `plugin-iot-cognitum`. Each plugin has its own hooks, agents, scripts, marketplace.json.
* Risk: plugins are user-installable surface — bugs land in customer hands without acceptance gates.
* Approach: per-plugin audit; one agent per plugin.

### G-16-003 [HIGH] Build pipeline soundness (ruflo-patch itself)

* What we covered: nothing in this repo's `scripts/` or `lib/` (other than skim from agent 15 for acceptance harness inventory).
* Out of scope: `ruflo-publish.sh`, `copy-source.sh`, `codemod.mjs`, `fork-version.mjs`, `acceptance-harness.sh`, `check-skip-accepted.mjs`, the entire publish pipeline.
* Risk: the codemod bug already found (F-07-H4 `>$dev$null` corruption in 20 SKILL.md files) is a pipeline bug, not a fork bug. Other pipeline bugs likely lurk — fork-version edge cases, scope-rename misses, build-order assumptions, `state.last-build-state` consistency.
* Approach: single agent walks `scripts/` + `lib/` for soundness; one runtime agent does a dry-run release in a worktree and checks invariants.

### G-16-004 [HIGH] AgentDB internals: storage layer, query engine, RVF format

* What we covered: controllers (memory / learning / graph / federation) which sit ON TOP of the storage.
* Out of scope: RVF binary format readers/writers, HNSW index implementation, vector backend, mutation context propagation, audit-log infrastructure, archivist sub-modules (delegates / handlers / hive-mind), SQLite WAL/journal handling, agentdb's own tests.
* Risk: F-13-001 (daemon RVF lock) was a storage-layer concurrency issue; more lurk. RVF being the primary backend per [[project-rvf-primary]] makes this a single point of failure.
* Approach: dedicated agent on `forks/agentdb/src/archivist/` + `forks/agentdb/src/{rvf,hnsw,storage}/`; cross-reference with ADR-0180 charter conformance.

### G-16-005 [HIGH] Security: aidefence (AIMDS), prompt injection, PII, claims authorization

* What we covered: nothing.
* Out of scope: the `aidefence_*` MCP tool family was lightly sampled by agent 08 (counted as a category) but the actual AIMDS implementation, the prompt-injection model, the PII detector, the claims-based access control across MCP tools (ADR-0010) — all unaudited.
* Risk: security surfaces fail silently. Any "PASS" in production is a non-answer until adversarial input is tested.
* Approach: dedicated security audit; explicit adversarial-input runtime probe (note: [[feedback-no-adversarial-review]] applies to *planning* critique only, not security testing of written code).

### G-16-006 [HIGH] Telemetry / observability — does the system know what it's doing?

* What we covered: nothing.
* Out of scope: `agentdb_telemetry_metrics`, `agentdb_telemetry_spans`, OpenTelemetry integration, span propagation across IPC, metrics surfaced to the daemon, health probes, error reporting.
* Risk: F-13-001 succeeded silently because nothing emitted an error metric. Observability is the early-warning system; if it's broken, every silent fallback becomes invisible too.
* Approach: trace one happy-path operation end-to-end and verify telemetry emission at each layer.

### G-16-007 [HIGH] WASM modules + native bindings

* What we covered: nothing.
* Out of scope: ruv-FANN crates, ruvector crates (other than agent 05's EWC trace), the NAPI bridges, the WASM build outputs in `forks/ruflo/v3/@claude-flow/wasm/`, the `agentdb-napi` binary, NAPI coverage detection (ADR-0189).
* Risk: NAPI binary regen is a known fragile surface (per ADR-0186 — large fraction of upstream churn). Mismatch between WASM/NAPI ABI and TS consumers causes runtime explosions.
* Approach: dedicated agent for WASM + NAPI surface; runtime probe should `node -e 'require("@sparkleideas/agentdb-napi")'` in the sandbox.

### G-16-008 [MEDIUM] Embedding pipeline: model loading, batching, caching, queue

* What we covered: brief touch by agent 04 (memory controllers) — `EmbeddingService` mock-fallback flagged.
* Out of scope: model download, persistence to `.claude-flow/cache/`, batch sizing, queue management, GPU acceleration paths, Xenova model integrity, alternative model support.
* Risk: embedding generation is on the hot path for every memory store / pattern store / trajectory step. A single bad batch silently mis-classifies state forever.
* Approach: dedicated agent; runtime probe inserts then searches a known-vector.

### G-16-009 [MEDIUM] Neural / ruvLLM beyond controller interface

* What we covered: SONA / MicroLoRA controllers from a TS interface view; agent 05 did some Rust spot-checking.
* Out of scope: the ruvLLM crate itself (inference, attention, batching), tiny-dancer-neural model details, HNSW routing parameters, neural compression / optimization paths, neural network templates.
* Risk: routing decisions made by these subsystems shape every downstream action.

### G-16-010 [MEDIUM] CRDT + consensus protocols referenced by agent types

* What we covered: brief presence-check by agent 06 — CRDT primitives "exported, zero callers".
* Out of scope: Byzantine consensus, gossip protocols, Raft, mesh coordination, quorum management — the actual mathematical correctness and replay behaviour. Agents `byzantine-coordinator`, `gossip-coordinator`, `raft-manager`, `mesh-coordinator`, `quorum-manager` are advertised types.
* Risk: distributed-systems primitives are correctness-load-bearing; "exported, zero callers" doesn't mean unused — they're advertised behaviours users may rely on.
* Approach: dedicated consensus audit; per-primitive correctness proofs or test inventory.

### G-16-011 [MEDIUM] Plugin marketplace + IPFS transfer system

* What we covered: nothing (only that plugin marketplace MCP registration is "prose-only").
* Out of scope: `transfer_*` MCP tools, IPFS resolution, store search / download / install paths, plugin signing / verification.
* Risk: download-and-execute path = critical security surface.

### G-16-012 [MEDIUM] External integrations

* What we covered: nothing.
* Out of scope: GitHub MCP tools (`github_*`), Gamma, Gmail, Google Calendar / Drive, Flow Nexus (`mcp__flow-nexus__*`).
* Risk: cross-system integration failures pop in user environments; auth tokens, OAuth flows, rate-limit handling.

---

## B. Methodology gaps

### G-16-013 [MEDIUM] Adversarial input / fuzz testing

* What we covered: zero adversarial probes.
* Risk: silent fallbacks turn adversarial inputs into successful operations with no side-effect.
* Note: per [[feedback-no-adversarial-review]], adversarial review of *planning* is off; adversarial testing of *written code* — especially MCP tool input handling — is fair game and recommended.

### G-16-014 [MEDIUM] Performance / memory leak / FD leak

* What we covered: nothing functional.
* Risk: F-13-001 (daemon holds RVF lock) is in the perf-correctness boundary; other leaks possible.
* Approach: long-running stress test (≥1h) with daemon + hooks + MCP; monitor RSS, FDs, lock counters.

### G-16-015 [MEDIUM] Concurrency correctness — race conditions, double-spawn, lock ordering

* What we covered: F-10 caught the double-spawn refusal on daemon; F-13 caught the RVF lock; otherwise nothing.
* Risk: TLA-style invariants on shared state.

### G-16-016 [MEDIUM] Cross-version compatibility — current upstream vs frozen tags

* What we covered: nothing.
* Risk: ruflo-patch reads upstream HEAD; if upstream changes signatures, our fork compiles but breaks at runtime. We have ADR-0186's INTEGRATION-LEDGER but no compatibility test.

### G-16-017 [LOW] Error taxonomy — error classes, codes, retry policies

* What we covered: nothing.
* Risk: inconsistent error handling means consumers can't tell transient vs fatal vs malformed.

### G-16-018 [LOW] Schema / type definitions — shared types between packages

* What we covered: nothing.
* Risk: type drift between packages causes silent data corruption.

---

## C. Methodology decisions intentionally NOT taken

These were considered and intentionally deferred:

* **Running the full acceptance harness** — `npm run release` is a separate workflow. The audit is read-only + sandboxed runtime. Per CLAUDE.md, running release is a deliberate operation by the user, not an audit step.
* **Filing GitHub issues for findings** — per [[feedback-no-upstream-donate-backs]], findings are not upstreamed to `ruvnet/*`. Recommendations are recorded in the audit docs for the maintainer to act on.
* **Modifying source to fix findings** — the audit deliverable is the findings markdown set. Implementation is a separate decision.

---

## D. Suggested next-pass audit scope

If a second pass is run:

| Priority | Scope | Approach |
|----------|-------|----------|
| 1 | CLI commands beyond daemon/init | Single agent; enumerate + sample 5-10 commands |
| 2 | Build pipeline (`scripts/` + `lib/`) | One static + one runtime dry-run-release agent |
| 3 | AgentDB internals (RVF, HNSW, archivist) | One dedicated agent |
| 4 | Security (aidefence, claims, PII) | One agent + adversarial probe runtime |
| 5 | Telemetry + observability | Trace one operation end-to-end |
| 6 | WASM + NAPI | Static + runtime require() probe |
| 7 | Plugin contents (4 plugins) | One agent per plugin OR single sweep |
| 8 | Embedding pipeline | Dedicated agent |
| 9 | Consensus protocols (Byzantine, Raft, etc.) | Dedicated agent |
| 10 | Performance / leaks | Long-running runtime stress test |

---

## E. Cross-cutting risks not bound to any single surface

* **The "two parallel implementations, wrong one wired" pattern** found in the audit is likely not exhaustive. A whole-tree dead-code scan would surface more (e.g. `v3/mcp/` 1112 LOC dead-tree). Suggested: ESLint `no-unused-exports` + cross-package import audit.
* **Codemod scope** — the `>$dev$null` corruption is one bug; the codemod itself transforms 41 packages × N files. A codemod audit (golden-master test on representative files) would catch the next corruption.
* **Init template fidelity** — F-02 found init-emitted hook handler doesn't implement subcommands the manifest claims. Likely the same fidelity issue exists for other init-emitted files. Generalisation: every file `ruflo init` writes should have a golden-master test.
