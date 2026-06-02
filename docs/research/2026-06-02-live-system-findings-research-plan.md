# Live-System Findings & Research Plan — 2026-06-02

Source: manual testing of the live ruflo stack in `ruflo-patch` (memory, learning,
neural, routing, daemon, MCP). Tested via the live npx-cache bin
(`@sparkleideas/ruflo@latest`, patch.408 — the same build the running MCP daemon
uses), **not** the acceptance harness. The dev `node_modules/.bin/ruflo` is stale
(patch.213) and must not be trusted for live checks.

## What is active and working

- **Memory** — full round-trip: store → retrieve-by-key → semantic search → stats.
  Store emits a 768-dim vector; retrieve returns the value intact (access count
  bumped); semantic search for the exact phrase returns the entry at **0.91**
  (scoring healthy — no `2cos−1` metric bug). Stats: **1,226 entries / 72.69 MB /
  Xenova/all-mpnet-base-v2 (768-dim) / HNSW active**.
- **Learning / neural** (`neural status` → all *Active*): SONA Coordinator,
  RuVector Training (WASM), SONA Engine, ReasoningBank (7 patterns), Flash
  Attention ops, Int8 quant, ruvllm Coordinator, Training Pipeline. `neural
  patterns`: 7 persisted patterns, **715 trajectories** (`.claude-flow/neural/patterns.json`).
- **Hooks** — firing every turn: `[INTELLIGENCE]` pattern suggestions per prompt,
  `[AutoMemory]` import at session start ("148 patterns, 144 edges, Backend 130").
- **Embeddings** — mpnet-768 loaded; enhanced-tier WASM acceleration (ONNX tier
  unavailable, clean fallback).
- `ruflo doctor`: **15 passed, 6 warnings**.

## Degraded / open findings

| # | Finding | Evidence |
|---|---------|----------|
| F1 | **No `mcp__ruflo__*` tools registered in session** | MCP log: `Connection timeout … after 30000ms`; successes at 18132ms / 24440ms. Server answers `initialize` with `hasTools:true`. |
| F2 | `resources/list` returns `-32601 Method not found` though server advertises `hasResources:true` | MCP log: `Failed to fetch resources: MCP error -32601` every connect |
| F3 | **Hook-time router unavailable** every prompt; CLI router untrained | `[INFO] Router not available, using default routing`; `route` → Q-value 0.000, exploration, wrong agent |
| F4 | **Daemon process not running** despite healthy worker history | `doctor`: "Daemon Status: Not running"; `daemon status`: workers idle, last run ~1h ago, all `Next Run = -` |
| F5 | **9/41 controllers inactive**; Phase-2 "Unknown controller" | init log: `Unknown controller: gnnLearning / semanticRouter / graphAdapter / sonaService`; yet native SONA/GNN init fine |
| F6 | **Cross-process write-visibility lag** in semantic search | fresh write absent from new reader's HNSW snapshot for 1 generation; by-key retrieve immediate |
| F7 | Discrepant pattern/graph stores | intelligence 148/144 vs neural 7/715 vs GNN graph 0/0 vs HNSW 1226 |
| F8 | Cosmetic / fallback | `neural status` "HNSW 0-dim" (stats say 768); config.json+config.yaml collision; `agentdb-onnx` missing → enhanced WASM tier; contrastive trainer optional-missing |

## Root cause (F1) — established

Claude Code's hard **30s MCP connection timeout** is exceeded by
`npx -y @sparkleideas/ruflo@latest mcp start` cold-start, **intermittently**. The
dominant cost is npx re-verifying/repairing a large, partially-extracted native
dep cache (`_npx/906e6debb112be6d` — agentic-flow, agentdb, node-llama-cpp,
onnx-proto) — the failed attempts' stderr is a storm of
`npm warn tar TAR_ENTRY_ERROR ENOENT`. The server also eagerly initializes the
full AgentDB/learning stack before answering `initialize`. Warm cache → fast;
cold/dirty cache → >30s → client aborts → **zero tools**. `MCP_TIMEOUT` is unset
(default 30000ms). Constraint: `feedback-always-npx-for-ruflo` mandates `npx
@latest` for freshness (ADR-0104 §4a perf opt deferred).

## Research items

### P0 — MCP tools not connecting (disables the whole MCP surface)
- **R1. Cold-start latency distribution.** Measure time-to-`initialize` across
  cold/warm npx cache; isolate npm-cache-repair vs server-init. Quantify >30s rate.
- **R2. npx cache repair storm.** Why does `_npx/906e6debb112be6d` trigger
  `TAR_ENTRY_ERROR` repairs on spawn? A clean/fully-extracted cache may stay under
  30s without dropping `@latest`.
- **R3. Server-side lazy init.** Defer AgentDB/learning bootstrap until *after* the
  MCP `initialize` handshake so the server reports ready in <5s. Check conflict with
  hooks/archivist bootstrap (`project-two-hook-paths`, `project-mcp-daemon-runs-sqljs-fallback`).
- **R4. Timeout escape hatch.** Evaluate `MCP_TIMEOUT`/`MCP_TOOL_TIMEOUT` in
  `.mcp.json` `env` as a freshness-preserving stopgap vs the npx-freshness rule.
- **R5. `resources/list -32601`.** Implement `resources/list` or stop advertising
  the resources capability.

### P1 — Learning/routing not actually learning
- **R6. Hook-time router unavailable.** Trace why every prompt logs "Router not
  available" while CLI `route` works. Map the two router surfaces.
- **R7. Untrained Q-table.** Q-value 0.000 everywhere despite 715 trajectories +
  148 intelligence patterns + ReasoningBank 7. Do trajectories feed the Q-table?
  Why does `learn` have only 12 runs vs map's 3677?

### P2 — Controller & store reconciliation
- **R8. 9/41 controllers inactive.** Resolve Phase-2 `Unknown controller` against
  native SONA/GNN init succeeding — registry-name mismatch or retired controllers
  (`graphAdapter` retired ADR-0170 Phase D)?
- **R9. Map the pattern/graph stores.** Document the four surfaces; confirm each is
  authoritative for its purpose; explain the empty GNN graph.

### P3 — Eventual consistency & cosmetics
- **R10. Cross-process write-visibility window.** Quantify the one-generation HNSW
  search lag; confirm it is expected ADR-0274/0284 behavior, not a missing refresh.
- **R11. Cosmetic/fallback audit.** Classify "HNSW 0-dim", config collision, ONNX
  tier fallback, contrastive trainer missing as intended-fallback vs shipping-gap.
- **R12. Daemon lifecycle.** Is the worker daemon meant to be persistent? Are the 6
  disabled workers intended?

## Method notes

- Use the live npx-cache bin (`/Users/henrik/.npm/_npx/906e6debb112be6d/node_modules/.bin/ruflo`)
  and the Claude Code MCP logs (`~/Library/Caches/claude-cli-nodejs/-Users-henrik-source-ruflo-patch/mcp-logs-ruflo/`),
  **not** the stale dev `node_modules` bin (patch.213 vs published 408).
- Fork source: `/Users/henrik/source/forks/{agentdb,agentic-flow,ruflo,ruvector,ruv-FANN}`.
- Read-only investigation; no edits during research.
