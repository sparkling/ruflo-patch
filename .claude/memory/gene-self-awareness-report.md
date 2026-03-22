# Claude Flow V3: Self-Awareness & Services Report

> Generated: 2026-02-13 | Source: 4-agent parallel deep analysis of codebase, docs, and source

## Executive Summary

Claude Flow V3 is a **self-aware, self-learning, self-optimizing** AI orchestration system with **12 distinct self-awareness mechanisms**, **150+ MCP tools** across **23 categories**, **26 CLI commands** with **140+ subcommands**, **93 agent definitions**, **27 hooks**, and **12 background workers**. It achieves self-awareness through introspection, learning feedback loops, neural pattern training, reinforcement-learned routing, memory self-management, session persistence, autonomous daemon workers, constitutional governance, performance self-monitoring, and intelligent agent spawning.

---

## Part 1: Self-Awareness Mechanisms (12 Categories)

### 1. System Introspection (Doctor + Status)

**Doctor** (`doctor.js`) runs **13 parallel health checks** via `Promise.allSettled`:
- Node.js version (20+), npm (9+), Git, config validity, daemon status
- Memory database, API keys, MCP servers, disk space, TypeScript, Claude Code CLI
- Auto-fix via `--fix` flag for common issues
- Outputs pass/warn/fail per check with remediation suggestions

**Status** (`status.js`) provides **real-time system state**:
- CPU/memory usage via `getProcessCpuUsage()` / `getProcessMemoryUsage()`
- Swarm topology, agent health, uptime
- MCP server status, memory entry count, cache performance
- Task queue depth (pending/running/completed/failed)
- Flash Attention speedup, HNSW search speed

**Monitoring** (`monitoring.js`) adds **production-grade observability**:
- Prometheus-style counters, gauges, histograms
- Request tracking with latency percentiles (p50, p95, p99)
- Error rate tracking by type
- Configurable alert thresholds (warning/critical)

### 2. Self-Learning Hooks (Pre/Post Lifecycle)

**6 core hooks** form a continuous learning feedback loop:

| Hook | Trigger | Self-Awareness Action |
|------|---------|----------------------|
| `pre-edit` | Before file modification | Gathers context, suggests agents, identifies risks, finds related files |
| `post-edit` | After file modification | Records outcome, updates pattern confidence, discovers new patterns |
| `pre-command` | Before shell execution | Assesses risk (critical/high/medium/low), suggests safe alternatives |
| `post-command` | After shell execution | Records execution metrics, tracks command success rates |
| `pre-task` | Before agent work | Routes via Q-Learning, recommends model tier, explores alternatives |
| `post-task` | After agent work | Trains neural patterns, stores results, triggers optimization workers |

Each hook records outcomes that feed back into the intelligence system, creating a **closed-loop learning cycle**.

### 3. Neural Pattern System (SONA + ReasoningBank)

**SONA (Self-Optimizing Neural Architecture)** (`intelligence.js:78-149`):
- Circular buffer for **O(1) signal recording** at <0.05ms per operation
- Max 10,000 signals, 100 trajectories
- Confidence updates: success `+= 0.1*(1-conf)`, failure `-= 0.15*conf`
- Temporal decay: `conf *= exp(-0.01 * days_since_use)`

**ReasoningBank** (`intelligence.js:155-322`):
- Persistent pattern storage in `.claude-flow/neural/patterns.json` (752KB)
- Cosine similarity search over stored embeddings
- Max 5,000 patterns with 0.7 similarity threshold
- Usage tracking: `usageCount`, `createdAt`, `lastUsedAt`
- Debounced disk persistence (100ms window)

**Learning Pipeline** (4 steps):
1. **RETRIEVE** - HNSW pattern search
2. **JUDGE** - Success/failure verdicts with confidence scoring
3. **DISTILL** - LoRA fine-tuning (r=8, 128x parameter reduction, scaling=2.0)
4. **CONSOLIDATE** - EWC++ memory preservation

### 4. Intelligence Routing (Q-Learning + MoE + 3-Tier)

**Q-Learning Router** (`q-learning-router.js`):
- 64-dimensional state space from task keyword hashing
- 8 actions (agent types): coder, tester, reviewer, architect, researcher, optimizer, debugger, documenter
- Learning rate 0.1, gamma 0.99, epsilon-greedy with exponential decay
- Experience replay buffer (1,000 entries, batch size 32)
- LRU cache (256 entries, 5-min TTL) for repeated patterns
- Model persistence in `.swarm/q-learning-model.json`

**MoE (Mixture of Experts)** (`moe-router.js`):
- 384-dim input -> Linear(384,128) + ReLU -> Linear(128,8) + Softmax
- 8 expert slots matching agent types
- Xavier initialization, 4x loop unrolling, pre-allocated Float32Arrays
- Top-2 expert selection with load balancing (entropy loss)
- REINFORCE-style online learning

**3-Tier Model Routing (ADR-026)** (`enhanced-model-router.js`):
- **Tier 1**: Agent Booster (<1ms, $0) - 6 intent types: var-to-const, add-types, add-error-handling, async-await, add-logging, remove-console. Confidence >= 0.7 triggers.
- **Tier 2**: Haiku (~500ms, $0.0002) - complexity < 0.3
- **Tier 3**: Sonnet (2s, $0.003) / Opus (5s, $0.015) - complexity >= 0.3 or Tier3 keywords (microservices, oauth2, byzantine, ML, etc.)

### 5. Memory Self-Management (HNSW + AgentDB)

**Multi-backend architecture**:
- `hybrid` (recommended): sql.js + AgentDB with HNSW indexing
- `agentdb`: Vector DB with HNSW (150x-12,500x faster search)
- `sqlite`: Lightweight local storage
- `memory`: In-memory (fast, non-persistent)

**Namespace isolation** for concern separation:
`patterns`, `solutions`, `tasks`, `preferences`, `debugging`, `architecture`, `security`, `swarm-results`

**Embedding generation**: 768-dim via all-mpnet-base-v2, with hyperbolic (Poincare ball) option

**Auto-memory system** (ADR-049):
- LearningBridge: connects insights to SONA (confidence +0.03 on access, -0.005/hr decay)
- MemoryGraph: PageRank knowledge graph (similarity 0.8, max 5,000 nodes)
- AgentMemoryScope: 3-level scopes (project/local/user), high-confidence transfer (>0.8)

### 6. Session Persistence (Cross-Conversation Learning)

**Session save/restore** (`session.js`):
- Captures: agent state, task queue, memory entries, session metadata
- Selective restoration: memory-only, agents-only, tasks-only, or full state
- Session hooks: `session-start` loads prior state, `session-end` consolidates learning

**Learning service** (`learning-service.mjs`):
- Short-term patterns (24h, max 500, fast access)
- Long-term patterns (promoted after 3 uses + quality > 0.6)
- 30-minute consolidation interval with EWC++ regularization
- Dedup at similarity threshold 0.95

### 7. Daemon Workers (12 Autonomous Background Processes)

The daemon (`worker-daemon.js`) runs **12 background workers** continuously:

| Worker | Interval | Priority | Purpose |
|--------|----------|----------|---------|
| `map` | 15m | normal | Codebase mapping and file analysis |
| `audit` | 30m | critical | Security vulnerability scanning |
| `optimize` | 60m | high | Performance optimization |
| `consolidate` | 30m | low | EWC++ memory consolidation |
| `testgaps` | 60m | normal | Test coverage gap analysis |
| `predict` | 10m | low | Predictive resource preloading |
| `document` | 60m | low | Auto-documentation generation |
| `ultralearn` | manual | normal | Deep knowledge acquisition |
| `deepdive` | 4h | low | Deep code analysis |
| `refactor` | 4h | low | Refactoring suggestions |
| `benchmark` | 2h | low | Performance benchmarking |
| `preload` | 10m | high | HNSW index preloading |

**Resource management**: max 2 concurrent, 5-min timeout, CPU threshold 28.0 (32-core), min 20% free memory.

**Telemetry** (from `daemon-state.json`): tracks runCount, successCount, failureCount, averageDurationMs per worker.

### 8. Guidance Control Plane (Constitutional AI)

**Compiler** (`guidance.js:7-77`):
- Compiles CLAUDE.md into constitution + shards + manifest
- Produces policy bundle with SHA-256 integrity hash

**Retriever** (`guidance.js:78-164`):
- Semantic search for task-relevant policy shards
- Intent detection from task description
- Returns top-5 most relevant shards + core constitution

**Enforcement Gates** (`guidance.js:166-291`):
- **Command gate**: blocks destructive commands (rm -rf, etc.)
- **Secret gate**: detects API keys, passwords, credentials
- **Tool allowlist gate**: ensures only approved tools used
- Decisions: ALLOW / BLOCK / REQUIRE-CONFIRMATION

### 9. Performance Self-Monitoring

**Metrics collection** (`benchmark.json`):
- Memory: RSS, heap used/total, external, array buffers
- CPU: user/system time
- Uptime tracking

**Flash Attention** (`flash-attention.js`):
- 2.49x-7.47x speedup via block-wise O(N) memory computation
- Two-stage screening: quick filter on 1/4 dims, full on top-K
- 8x loop unrolling, 32-block tiling for L1 cache

**EWC++ Consolidation** (`ewc-consolidation.js`):
- Fisher information diagonal for parameter importance
- Lambda=0.4, decay=0.01, importance threshold=0.3
- Prunes bottom 20% when exceeding 1,000 patterns
- Consolidation history (last 100 operations)

### 10. Agent Spawning Intelligence

**Capability matching** (`router.cjs`):
- 8 agent capability profiles (coder, tester, reviewer, researcher, architect, backend-dev, frontend-dev, devops)
- Pattern-based task routing with 0.8 confidence for matches, 0.5 default fallback

**Load balancing** (`worker-daemon.js:142-155`):
- CPU load check against threshold (28.0)
- Free memory percentage check (>20%)
- Pending worker queue for deferred execution

### 11. Coverage-Aware Routing

**Coverage Router** (`coverage-router.js`):
- Parses LCOV, Istanbul, Cobertura, JSON coverage formats
- Identifies uncovered critical files (auth, security, payment, core)
- Priority scoring: base 5 + low coverage +4 + critical uncovered +1 + changed files +2
- Impact calculation: potential gain, effort estimate (gap/10 * 0.5 hours)

### 12. ADR Compliance Self-Check

**Compliance script** (`adr-compliance.sh`):
- Checks 10 Architecture Decision Records (ADR-001 through ADR-010)
- Computes compliance score, saves to `adr-compliance.json`
- Runs on 15-minute throttle
- Covers: agentic-flow core, DDD, single coordination, plugins, MCP-first, unified memory, event sourcing, Vitest, hybrid memory, no Deno

---

## Part 2: Complete Service Catalog (150+ MCP Tools, 23 Categories)

### A. Agent Tools (7 ops)
`agent_spawn`, `agent_list`, `agent_status`, `agent_terminate`, `agent_pool`, `agent_health`, `agent_update`

### B. Memory Tools (7 ops)
`memory_store`, `memory_retrieve`, `memory_search` (HNSW), `memory_delete`, `memory_list`, `memory_stats`, `memory_migrate`

### C. Swarm Tools (7 ops)
`swarm_init`, `swarm_status`, `swarm_shutdown`, plus diagnostics: agents, memory, messaging, coordinator

### D. Task Tools (6 ops)
`task_create`, `task_list`, `task_status`, `task_update`, `task_complete`, `task_cancel`

### E. Browser Automation (23 ops)
Navigation: `open`, `back`, `forward`, `reload`, `close`
Inspection: `snapshot`, `screenshot`, `get-text`, `get-value`, `get-title`, `get-url`
Interaction: `click`, `fill`, `type`, `press`, `hover`, `select`, `check`, `uncheck`, `scroll`
Control: `wait`, `eval`, `session-list`

### F. Hooks Tools (37+ ops)
Pre/Post: `pre-edit`, `post-edit`, `pre-command`, `post-command`, `pre-task`, `post-task`
Session: `session-start`, `session-end`, `session-restore`, `notify`
Routing: `route`, `explain`, `metrics`, `list`
Intelligence: `intelligence` (status/reset/stats), `trajectory-start/step/end`, `pattern-store/search`, `learn`, `attention`
Model: `model-route`, `model-outcome`, `model-stats`
Workers: `worker-list/dispatch/status/detect/cancel`
Training: `pretrain`, `build-agents`, `transfer`

### G. Config Tools (7 ops)
`config_get`, `config_set`, `config_list`, `config_reset`, `config_export`, `config_import`

### H. Session Tools (5 ops)
`session_save`, `session_list`, `session_restore`, `session_info`, `session_delete`

### I. Hive-Mind Tools (9 ops)
`hive-mind_init`, `hive-mind_spawn`, `hive-mind_status`, `hive-mind_join`, `hive-mind_leave`, `hive-mind_consensus`, `hive-mind_broadcast`, `hive-mind_memory`, `hive-mind_shutdown`

### J. Workflow Tools (8 ops)
`workflow_create`, `workflow_execute`, `workflow_list`, `workflow_status`, `workflow_pause`, `workflow_resume`, `workflow_cancel`, `workflow_template`

### K. Claims/Auth Tools (11 ops)
`claims_claim`, `claims_release`, `claims_handoff`, `claims_accept-handoff`, `claims_status`, `claims_list`, `claims_load`, `claims_board`, `claims_mark-stealable`, `claims_steal`, `claims_stealable`

### L. Embeddings Tools (7 ops)
`embeddings_init`, `embeddings_generate`, `embeddings_compare`, `embeddings_search`, `embeddings_neural`, `embeddings_hyperbolic`, `embeddings_status`

### M. Security/AIDefence Tools (6 ops)
`aidefence_scan` (<10ms), `aidefence_analyze`, `aidefence_is_safe`, `aidefence_has_pii`, `aidefence_learn`, `aidefence_stats`

### N. Coordination Tools (7 ops)
`coordination_topology`, `coordination_load_balance`, `coordination_sync`, `coordination_node`, `coordination_consensus`, `coordination_orchestrate`, `coordination_metrics`

### O. DAA Tools (8 ops)
`daa_agent_create`, `daa_agent_adapt`, `daa_workflow_create`, `daa_workflow_execute`, `daa_knowledge_share`, `daa_learning_status`, `daa_cognitive_pattern`, `daa_performance_metrics`

### P. Neural Tools (6 ops)
`neural_train`, `neural_predict`, `neural_patterns`, `neural_compress`, `neural_optimize`, `neural_status`

### Q. Performance Tools (6 ops)
`performance_report`, `performance_benchmark`, `performance_profile`, `performance_bottleneck`, `performance_metrics`, `performance_optimize`

### R. System Tools (5+ ops)
`system_status`, `system_metrics`, `system_health`, `system_info`, `system_reset`

### S. Analyze Tools (6 ops)
`analyze_diff`, `analyze_diff-risk`, `analyze_diff-classify`, `analyze_diff-reviewers`, `analyze_diff-stats`, `analyze_file-risk`

### T. Progress Tools (4 ops)
`progress_check`, `progress_sync`, `progress_summary`, `progress_watch`

### U. Transfer/IPFS Tools (10 ops)
`transfer_store-search/info/download/featured/trending`, `transfer_plugin-search/info/featured/official`, `transfer_detect-pii`, `transfer_ipfs-resolve`

### V. GitHub Tools (5 ops)
`github_repo_analyze`, `github_pr_manage`, `github_issue_track`, `github_workflow`, `github_metrics`

### W. Terminal Tools (5 ops)
`terminal_create`, `terminal_execute`, `terminal_list`, `terminal_close`, `terminal_history`

---

## Part 3: Infrastructure & Architecture

### Agent Ecosystem (93 definitions across 20 categories)
- **Core**: coder, reviewer, tester, planner, researcher
- **Coordinators**: hierarchical, mesh, adaptive, collective-intelligence, swarm-memory-manager
- **Consensus**: byzantine, raft, gossip, crdt, quorum, security-manager
- **V3 Specialized**: v3-queen-coordinator, v3-memory-specialist, v3-performance-engineer, v3-security-architect, v3-integration-architect
- **SONA**: sona-learning-optimizer (LoRA, EWC++, 761 decisions/sec, 60% cost savings)
- **GitHub**: pr-manager, issue-tracker, release-manager, workflow-automation, project-board-sync, repo-architect, multi-repo-swarm, release-swarm, sync-coordinator
- **SPARC**: sparc-coord, sparc-coder, specification, pseudocode, architecture, refinement
- **Development**: backend-dev, mobile-dev, ml-developer, cicd-engineer, api-docs, system-architect, code-analyzer
- **Testing**: tdd-london-swarm, production-validator
- **Performance**: perf-analyzer, performance-benchmarker, task-orchestrator, memory-coordinator, smart-agent

### Consensus Protocols (5)
| Protocol | Fault Tolerance | Use Case |
|----------|-----------------|----------|
| Byzantine (BFT) | f < n/3 faulty | Untrusted environments |
| Raft | f < n/2 crash | Leader-based state management |
| Gossip | Eventual consistency | Large-scale dissemination |
| CRDT | Conflict-free | Concurrent state updates |
| Quorum | Configurable | Flexible voting |

### Swarm Topologies (6)
| Topology | Description | Best For |
|----------|-------------|----------|
| hierarchical | Queen controls workers | Anti-drift, small teams (6-8) |
| hierarchical-mesh | Queen + peer comms | V3 recommended (10-15 agents) |
| mesh | Fully connected | Collaborative exploration |
| ring | Circular communication | Sequential pipelines |
| star | Central coordinator | Hub-and-spoke workflows |
| adaptive | Dynamic switching | Variable workloads |

### Skills System (4 Codex skills)
1. **swarm-orchestration** - Multi-agent coordination for 3+ file tasks
2. **memory-management** - AgentDB with HNSW search
3. **sparc-methodology** - Spec->Pseudo->Arch->Refine->Complete workflow
4. **security-audit** - Scanning and CVE detection

### Performance Achievements
| Metric | Target | Achieved |
|--------|--------|----------|
| HNSW Search | 150x-12,500x faster | Implemented |
| Memory Reduction | 50-75% | 3.92x (Int8 quantization) |
| MCP Response | <100ms | Achieved |
| CLI Startup | <500ms | Achieved |
| Graph Build (1k) | <200ms | 2.78ms (71.9x headroom) |
| PageRank (1k) | <100ms | 12.21ms (8.2x headroom) |
| Insight Recording | <5ms/each | 0.12ms (41x headroom) |
| Consolidation | <500ms | 0.26ms (1,955x headroom) |
| Agent Booster | <1ms | <1ms, 352x faster than Tier 2 |

---

## Part 4: Intelligence Architecture (4-Layer Stack)

```
Layer 4: Guidance Control Plane
  Policy enforcement, constitutional gates, shard retrieval
  ↕
Layer 3: Adaptive Router Layer
  Agent Booster (Tier 1) | Model Router (Tier 2/3)
  Q-Learning (task→agent) | MoE (expert selection)
  SONA (trajectory learning) | Coverage Router (test routing)
  ↕
Layer 2: Learning & Consolidation Layer
  Trajectory Recording (<0.05ms) | Pattern Storage (ReasoningBank)
  EWC++ (anti-forgetting, lambda=0.4) | LoRA (r=8, 128x reduction)
  Flash Attention (2.49-7.47x speedup)
  ↕
Layer 1: Vector Search & Embeddings
  HNSW Index (150x-12,500x) | ONNX Embeddings (384/768-dim)
  Cosine Similarity | Hyperbolic (Poincare ball)
```

### Key Data Files
| File | Size | Purpose |
|------|------|---------|
| `auto-memory-store.json` | 7MB | Semantic memory entries |
| `neural/patterns.json` | 752KB | Learned neural patterns |
| `vectors.db` | 2.3MB | SQLite HNSW vector database |
| `daemon-state.json` | ~10KB | Worker telemetry |
| `metrics/learning.json` | ~5KB | Routing accuracy tracking |
| `metrics/v3-progress.json` | ~3KB | V3 implementation status |

---

## Summary Statistics

| Category | Count |
|----------|-------|
| Self-Awareness Mechanisms | 12 |
| MCP Tool Categories | 23 |
| Individual MCP Operations | 150+ |
| CLI Commands | 26 |
| CLI Subcommands | 140+ |
| Agent Definitions | 93 |
| Hooks | 27 |
| Background Workers | 12 |
| Consensus Protocols | 5 |
| Swarm Topologies | 6 |
| Codex Skills | 4 |
| Health Checks (Doctor) | 13 |
| Neural Patterns Trained | 39 trajectories |
| Memory Entries | 15 auto-imported |
