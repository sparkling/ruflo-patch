# 14 — Configuration soundness audit

## Summary

- Keys audited: 92 distinct config keys across `.claude-flow/config.json`,
  `.claude-flow/embeddings.json`, `.claude/settings.json`, `.mcp.json`, and
  process.env consumers.
- Env var prefixes audited: `CLAUDE_FLOW_*` (24 distinct names),
  `RUFLO_*` (1 name — `RUFLO_PROVIDER`), `AGENTDB_*` (12 names),
  `MCP_*` (2 names), plus 17 third-party / generic vars referenced in docs.
- Findings: 18 total / 6 critical / 8 warning / 4 note
- Soundness verdict: **FAIL**
- Completeness verdict: **FAIL**
- Bottom line: The `project-config-gaps` memory claim that the 11 ADR-0069
  dead keys are now wired holds up on the substrate side — every key in
  `getMinimalConfigTemplate()` + `getFullConfigTemplate()` resolves to a
  consumer reading `.claude-flow/config.json` directly via `JSON.parse`.
  But the env-var surface is incoherent: `.mcp.json` injects four
  CLAUDE_FLOW_* vars into the MCP server process that no code reads
  (`CLAUDE_FLOW_MODE`, `CLAUDE_FLOW_TOPOLOGY`, `CLAUDE_FLOW_MEMORY_BACKEND`,
  `CLAUDE_FLOW_HOOKS_ENABLED`); meanwhile the consumer at
  `shared/config/loader.ts` reads `CLAUDE_FLOW_SWARM_TOPOLOGY` and
  `CLAUDE_FLOW_MEMORY_TYPE`, neither of which init ever emits. USERGUIDE.md
  documents 11+ env vars (HNSW tuning, autopilot, tool-groups, log-level,
  security-mode) that have zero source consumers. The Zod-validated
  `ConfigLoader` path in `@claude-flow/shared/src/core/config/` is invoked
  by `cli/src/index.ts:loadConfig` but the 17 downstream consumers
  bypass it entirely with hand-rolled `JSON.parse(readFileSync(...))`
  — no schema validation reaches the substrate. Default-init projects
  emit ONLY the minimal template (no `controllers/rateLimiter/workers`
  block), so the consumers of those sections silently fall back to
  hardcoded defaults unless the user passed `--full`.

## Key inventory

| Key (config.json) | Source / writer | Default | Consumers | Init template (minimal / full) | Docs (USERGUIDE / CLAUDE.md) | Status |
|---|---|---|---|---|---|---|
| `version` | `config-template.ts:55` | `"3.0.0"` | — (informational) | both | — | sound, undocumented |
| `swarm.topology` | `config-template.ts:57` | `"hierarchical-mesh"` | `controller-registry.ts` (indirect via memory-router forwarding) | both | USERGUIDE 6975 (wrong default `hierarchical`) | sound, docs-default mismatch |
| `swarm.maxAgents` | `config-template.ts:58` | `15` | `controller-registry.ts`, `memory-router.ts:638-697` | both | USERGUIDE 6974 | sound |
| `swarm.autoScale.enabled` | `config-template.ts:59` | `true` | — (no consumer found) | both | — | dead key F-14-005 |
| `swarm.coordinationStrategy` | `config-template.ts:60` | `"consensus"` | — (no consumer found) | both | — | dead key F-14-005 |
| `memory.backend` | `config-template.ts:63` | `"hybrid"` | `memory-router.ts:430-465`, `controller-registry.ts` | both | USERGUIDE 6964 docs the alias `memory.type` instead | sound, alias-docs split |
| `memory.type` | `config-template.ts:64` | `"hybrid"` | `shared/config/loader.ts:107` (Zod path only) | both | USERGUIDE 6964 | sound (alias) |
| `memory.maxElements` | `config-template.ts:65` | `100000` | indirect via `resolve-config.ts:222` → `embeddings.json.maxEntries` | both | — | sound, undocumented |
| `memory.swarmDir` | `config-template.ts:66` | `".swarm"` | `memory-router.ts:431,635` | both | — | sound (ADR-0069 wired), undocumented |
| `memory.similarityThreshold` | `config-template.ts:67` | `0.7` | `search-memory.query.ts:22`, `threat-learning-service.ts:179` | both | — | sound (ADR-0069 wired), undocumented |
| `memory.dedupThreshold` | `config-template.ts:68` | `0.95` | `resolve-config.ts:227-232` | both | — | sound, undocumented |
| `memory.embeddingCacheSize` | `config-template.ts:69` | `1000` | `rvf-embedding-service.ts:53-58` | both | — | sound (ADR-0069 wired), undocumented |
| `memory.cleanupIntervalMs` | `config-template.ts:70` | `60000` | `worker-queue.ts:159`, `hooks/swarm/index.ts:182` | both | — | sound, undocumented |
| `memory.migrationBatchSize` | `config-template.ts:146` | `500` | `migration.ts:36` | full only | — | sound, full-only |
| `memory.sqlite.cacheSize` | `config-template.ts:148` | `-64000` | grep returns 0 non-test consumers | full only | — | dead key F-14-006 |
| `memory.sqlite.busyTimeoutMs` | `config-template.ts:149` | `5000` | grep returns 0 non-test consumers | full only | — | dead key F-14-006 |
| `memory.sqlite.journalMode` | `config-template.ts:150` | `"WAL"` | `resolve-config.ts:218` → `embeddings.json.walMode` (boolean, not the string) | full only | — | partial wiring F-14-007 |
| `memory.sqlite.synchronous` | `config-template.ts:151` | `"NORMAL"` | grep returns 0 non-test consumers | full only | — | dead key F-14-006 |
| `memory.storage.maxEntries` | `config-template.ts:153` | `100000` | indirect via `resolve-config.ts:222` | full only | — | sound, undocumented |
| `memory.learningBridge.enabled` | `config-template.ts:155` | `true` | `learning-bridge.ts:94` | full only | — | sound, full-only |
| `memory.learningBridge.sonaMode` | `config-template.ts:156` | `"balanced"` | `resolve-config.ts:255` (nested `learning.sonaMode`) | full only | — | sound, full-only |
| `memory.learningBridge.confidenceDecayRate` | `config-template.ts:157` | `0.0008` | `resolve-config.ts:256` | full only | — | sound |
| `memory.learningBridge.accessBoostAmount` | `config-template.ts:158` | `0.05` | `resolve-config.ts:257` | full only | — | sound |
| `memory.learningBridge.consolidationThreshold` | `config-template.ts:159` | `8` | `resolve-config.ts:258` | full only | — | sound |
| `memory.memoryGraph.enabled` | `config-template.ts:162` | `true` | `memory-graph.ts:65` | full only | — | sound |
| `memory.memoryGraph.pageRankDamping` | `config-template.ts:163` | `0.82` | `resolve-config.ts:263` | full only | — | sound |
| `memory.memoryGraph.maxNodes` | `config-template.ts:164` | `10000` | `resolve-config.ts:264` | full only | — | sound |
| `memory.memoryGraph.similarityThreshold` | `config-template.ts:165` | `0.25` | `resolve-config.ts:265` | full only | — | sound |
| `memory.embeddings.model` | `config-template.ts:171` | `"Xenova/all-mpnet-base-v2"` | mirror of `embedding.model` (top-level canonical) | full only | — | dual-write F-14-008 |
| `memory.embeddings.dimension` | `config-template.ts:172` | `768` | mirror of `embedding.dimension` | full only | — | dual-write F-14-008 |
| `memory.embeddings.provider` | `config-template.ts:173` | `"transformers.js"` | mirror; canonical = `embedding.provider` (`"onnx"`) — DIFFERENT VALUES | full only | — | inconsistent-default F-14-009 |
| `memory.embeddings.hnsw.*` | `config-template.ts:174-180` | various | mirror of `index.hnsw.*` | full only | — | dual-write F-14-008 |
| `neural.enabled` | `config-template.ts:73` | `true` | — (no top-level reader) | both | — | dead key F-14-005 |
| `neural.modelPath` | `config-template.ts:74` | `".claude-flow/neural"` | — (no consumer found) | both | — | dead key F-14-005 |
| `neural.ewcLambda` | `config-template.ts:75` | `2000` | `self-learning.ts:24,28,42` | both | — | sound |
| `neural.defaultLearningRate` | `config-template.ts:76` | `0.001` | `sona-adapter.ts:67-80` | both | — | sound |
| `neural.qualityThreshold` | `config-template.ts:77` | `0.5` | grep returns 0 non-test consumers | both | — | dead key F-14-005 |
| `neural.learningRates.qLearning` | `config-template.ts:186` | `0.1` | `q-learning-router.ts:25`, `q-learning.ts:23` | full only | — | sound (ADR-0069 wired) |
| `neural.learningRates.sarsa` | `config-template.ts:187` | `0.1` | `sarsa.ts:22` | full only | — | sound (ADR-0069 sarsa copy-paste bug verified fixed: line 21 comment "ADR-0069: fix copy-paste bug (was .qLearning)" + correct `cfg.neural.learningRates.sarsa` read) |
| `neural.learningRates.moe` | `config-template.ts:188` | `0.01` | `moe-router.ts:29` | full only | — | sound |
| `neural.learningRates.sona` | `config-template.ts:189` | `0.001` | `sona-manager.ts:73` (ADR-0069 wired) | full only | — | sound |
| `neural.learningRates.lora` | `config-template.ts:190` | `0.001` | `lora-adapter.ts:27,30` (ADR-0069 wired) | full only | — | sound |
| `embedding.provider` | `config-template.ts:85` | `"onnx"` | `config-chain/src/index.ts:174` (canonical singleton) | both | — | sound, canonical |
| `embedding.model` | `config-template.ts:86` | `"Xenova/all-mpnet-base-v2"` | `config-chain/src/index.ts:162` | both | — | sound |
| `embedding.dimension` | `config-template.ts:87` | `768` | `config-chain/src/index.ts:166` | both | — | sound |
| `embedding.allowPaidProvider` | `config-template.ts:88` | `false` | `config-chain/src/index.ts:179`, `validateBoot()` | both | — | sound |
| `index.hnsw.M` | `config-template.ts:94` | `23` | `resolve-config.ts:267-271` (via `embeddings.json.hnsw.M`); canonical source | both | — | sound |
| `index.hnsw.efConstruction` | `config-template.ts:95` | `100` | `resolve-config.ts:267-271` | both | — | sound |
| `index.hnsw.efSearch` | `config-template.ts:96` | `50` | `resolve-config.ts:267-271` | both | — | sound |
| `mcp.autoStart` | `config-template.ts:100` | `true` | grep returns 0 non-test consumers | both | — | dead key F-14-005 |
| `mcp.transport.port` | `config-template.ts:101` | `3000` | grep returns 0 non-test consumers; `mcp.ts` uses env / flag instead | both | — | dead key F-14-005 |
| `ports.mcp` | `config-template.ts:104` | `3000` | `memory-router.ts:698` | both | — | sound (ADR-0069 wired) |
| `ports.mcpWebSocket` | `config-template.ts:105` | `3001` | `memory-router.ts:699` | both | — | sound |
| `ports.quic` | `config-template.ts:106` | `4433` | `memory-router.ts:700` (forwarded into controllerRegistry config) | both | — | sound (ADR-0069 wired) |
| `ports.federation` | `config-template.ts:107` | `8443` | `memory-router.ts:701` | both | — | sound |
| `ports.health` | `config-template.ts:108` | `8080` | `memory-router.ts:702` | both | — | sound |
| `hooks.enabled` | `config-template.ts:111` | `true` | grep returns 0 non-test consumers (env var read instead) | both | — | dead key F-14-005 |
| `hooks.autoExecute` | `config-template.ts:112` | `true` | grep returns 0 non-test consumers | both | — | dead key F-14-005 |
| `controllers.enabled.*` (12 sub-keys) | `config-template.ts:194-214` | various booleans | `memory-router.ts:690` (`...cfgJson.controllers?.enabled`) → `controller-registry.ts:1116` | full only | — | sound, full-only F-14-010 |
| `controllers.nightlyLearner` | `config-template.ts:216-222` | tuning block | `memory-router.ts:692` | full only | — | sound |
| `controllers.causalRecall` | `config-template.ts:223-228` | tuning block | `memory-router.ts:693` | full only | — | sound |
| `controllers.queryOptimizer` | `config-template.ts:229-234` | tuning block | `memory-router.ts:694` | full only | — | sound (controller enabled-by-default per ADR-0191 follow-up) |
| `controllers.selfLearningRvfBackend` | `config-template.ts:235-240` | tuning block | `memory-router.ts:695` | full only | — | sound |
| `controllers.mutationGuard` | `config-template.ts:241-246` | tuning block | `memory-router.ts:696` | full only | — | sound |
| `controllers.attentionService` | `config-template.ts:248-253` | tuning block | `memory-router.ts:642` | full only | — | sound |
| `controllers.multiHeadAttention` | `config-template.ts:254-257` | tuning block | `memory-router.ts:643` | full only | — | sound |
| `controllers.selfAttention` | `config-template.ts:258-260` | tuning block | `memory-router.ts:644` | full only | — | sound |
| `controllers.rateLimiter` | `config-template.ts:261-263` | tuning block | `memory-router.ts:645` (fallback under `rateLimiter.default`) | full only | — | sound |
| `controllers.circuitBreaker` | `config-template.ts:264-267` | tuning block | `memory-router.ts:647` | full only | — | sound |
| `controllers.tieredCache` | `config-template.ts:268-271` | tuning block | `memory-router.ts:640` | full only | — | sound |
| `controllers.quantizedVectorStore` | `config-template.ts:272-274` | `"scalar-8bit"` | grep returns 0 consumers | full only | — | dead key F-14-005 |
| `controllers.solverBandit` | `config-template.ts:275-279` | tuning block | `memory-router.ts:648` | full only | — | sound |
| `rateLimiter.default` | `config-template.ts:282` | `{maxRequests:100,windowMs:60000}` | `memory-router.ts:645` | full only | — | sound (ADR-0069 wired) |
| `rateLimiter.auth/tools/memory/files` | `config-template.ts:283-286` | various | `guidance/src/memory-gate.ts:122` (only `rateLimiter.memory`) | full only | — | partial F-14-011: only `memory` preset consumed |
| `workers.triggers.*` (8 triggers) | `config-template.ts:289-297` | per-worker timeoutMs+priority | `worker-daemon.ts:246,442,1170` | full only | — | sound (ADR-0069 wired) |
| `daemon.maxConcurrent` | `config-template.ts:301` | `2` | grep returns 0 consumers in non-test source | full only | — | dead key F-14-005 |
| `daemon.workerTimeoutMs` | `config-template.ts:302` | `300000` | — | full only | — | dead key F-14-005 |
| `daemon.headless` | `config-template.ts:303` | `false` | env `CLAUDE_FLOW_HEADLESS` instead | full only | — | inconsistent F-14-012 |
| `daemon.resourceThresholds.*` | `config-template.ts:304-307` | block | — | full only | — | dead key F-14-005 |

### Env vars

| Env var | Reader | Default in code | Init / .mcp.json emits? | USERGUIDE / CLAUDE.md | Status |
|---|---|---|---|---|---|
| `CLAUDE_FLOW_MODE` | NO source consumer | — | `.mcp.json` env, settings.json env | USERGUIDE 6960 | **dead** F-14-001 |
| `CLAUDE_FLOW_HOOKS_ENABLED` | NO source consumer | — | `.mcp.json` env, settings.json env, executor.ts:342 | — | **dead** F-14-001 |
| `CLAUDE_FLOW_TOPOLOGY` | NO source consumer (loader reads `CLAUDE_FLOW_SWARM_TOPOLOGY`) | — | `.mcp.json` env (`options.runtime.topology`) | USERGUIDE 6975 | **dead — naming-skew** F-14-001 |
| `CLAUDE_FLOW_MAX_AGENTS` | `shared/config/loader.ts:80` (no NaN/bounds check) | `15` | `.mcp.json` env | USERGUIDE 6974, CLAUDE.md 825 | sound, unvalidated |
| `CLAUDE_FLOW_MEMORY_BACKEND` | NO source consumer (loader reads `CLAUDE_FLOW_MEMORY_TYPE`) | — | `.mcp.json` env, `rvfa-builder.ts:322` | USERGUIDE 3229, CLAUDE.md 830 | **dead — naming-skew** F-14-001 |
| `CLAUDE_FLOW_MEMORY_TYPE` | `shared/config/loader.ts:103` (allowed-set validated) | `"hybrid"` | NOT emitted | USERGUIDE 6964 | undocumented split F-14-002 |
| `CLAUDE_FLOW_SWARM_TOPOLOGY` | `shared/config/loader.ts:142` (allowed-set validated) | — | NOT emitted | NOT documented | undocumented split F-14-002 |
| `CLAUDE_FLOW_MCP_TRANSPORT` | `shared/config/loader.ts:115`, `mcp-server.ts:325`, `mcp.ts:367`, `system-tools.ts:505` | `"stdio"` | NOT emitted | USERGUIDE 6985 | sound, undocumented in init |
| `CLAUDE_FLOW_MCP_PORT` | `shared/config/loader.ts:128`, `system-tools.ts:506` | `3000` | NOT emitted | USERGUIDE 6983, CLAUDE.md 825 | sound |
| `CLAUDE_FLOW_MCP_HOST` | `system-tools.ts:520` only | `"localhost"` | NOT emitted | USERGUIDE 6984, CLAUDE.md 826 | sound (single-call) |
| `CLAUDE_FLOW_CONFIG` | `config-file-manager.ts:34` | — | NOT emitted | USERGUIDE 6967, CLAUDE.md 816 | sound |
| `CLAUDE_FLOW_DATA_DIR` | `shared/config/loader.ts:91` | — | NOT emitted | USERGUIDE 6962 | sound |
| `CLAUDE_FLOW_HEADLESS` | `runtime/headless.ts:355` | `false` | NOT emitted | USERGUIDE 6976 | sound |
| `CLAUDE_FLOW_DAEMON` | `daemon.ts:42,283,904,951` | — | self-injected when daemonised | — | sound, undocumented |
| `CLAUDE_FLOW_STRICT` | `controller-registry.ts:47` | `true` (`!== 'false'`) | NOT emitted | — | sound, undocumented |
| `CLAUDE_FLOW_DEBUG` | `init/executor.ts:684,694`, `intelligence.ts:773`, `neural-package-bridge.ts:50` | — | NOT emitted | — | sound, undocumented |
| `CLAUDE_FLOW_CWD` | `mcp-tools/types.ts:51,82`, `auto-memory-bridge.ts:171`, `mcp-server.ts:849`, `cli-core/types.ts:29` | `process.cwd()` | NOT emitted | — | sound, undocumented |
| `CLAUDE_FLOW_MEMORY_PATH` | `memory-router.ts:457`, `json-backend.ts:54` | — | NOT emitted | USERGUIDE 3230, CLAUDE.md 831 | sound |
| `CLAUDE_FLOW_HIVE_CACHE_MAX` | `hive-mind-tools.ts:934` | `1024` | NOT emitted | — | sound, undocumented |
| `CLAUDE_FLOW_HIVE_SWEEP_MS` | `hive-mind-tools.ts:2526` | `60000` | NOT emitted | — | sound, undocumented |
| `CLAUDE_FLOW_AUTO_UPDATE` | `update/rate-limiter.ts:72` | `true` | NOT emitted | USERGUIDE 7033 | sound |
| `CLAUDE_FLOW_FORCE_UPDATE` | `update/rate-limiter.ts:77`, `update.ts:65,143` | `false` | NOT emitted | USERGUIDE 7034 | sound |
| `CLAUDE_FLOW_MAX_EVAL_SCRIPT_LENGTH` | `browser/mcp-tools/browser-tools.ts:644` | constant | NOT emitted | — | sound, undocumented |
| `CLAUDE_FLOW_ENCRYPT_AT_REST` | `encryption/vault.ts:44`, `doctor.ts:758,770` | — | NOT emitted | — | sound, undocumented |
| `CLAUDE_FLOW_ENCRYPTION_KEY` | `encryption/vault.ts:45,65`, `doctor.ts:775` | — | NOT emitted | — | sound, undocumented |
| `CLAUDE_FLOW_LOG_LEVEL` | NO source consumer (written to subprocess env only) | — | `rvfa-builder.ts:322`, codex generators | USERGUIDE 6966, CLAUDE.md 817 | **dead** F-14-001 |
| `CLAUDE_FLOW_ENV` | NO source consumer | — | NOT emitted | USERGUIDE 6961 | **dead doc** F-14-003 |
| `CLAUDE_FLOW_SECURITY_MODE` | NO source consumer | — | NOT emitted | USERGUIDE 6965 | **dead doc** F-14-003 |
| `CLAUDE_FLOW_HNSW_M` | NO source consumer | — | NOT emitted | USERGUIDE 6991 | **dead doc** F-14-003 |
| `CLAUDE_FLOW_HNSW_EF` | NO source consumer | — | NOT emitted | USERGUIDE 6992 | **dead doc** F-14-003 |
| `CLAUDE_FLOW_EMBEDDING_DIM` | NO source consumer | — | NOT emitted | USERGUIDE 6993 | **dead doc** F-14-003 |
| `CLAUDE_FLOW_CONTEXT_AUTOPILOT` | NO source consumer | — | NOT emitted | USERGUIDE 3077 | **dead doc** F-14-003 |
| `CLAUDE_FLOW_CONTEXT_WINDOW` | NO source consumer | — | NOT emitted | USERGUIDE 3078 | **dead doc** F-14-003 |
| `CLAUDE_FLOW_AUTOPILOT_WARN` | NO source consumer | — | NOT emitted | USERGUIDE 3079 | **dead doc** F-14-003 |
| `CLAUDE_FLOW_AUTOPILOT_PRUNE` | NO source consumer | — | NOT emitted | USERGUIDE 3080 | **dead doc** F-14-003 |
| `CLAUDE_FLOW_COMPACT_RESTORE_BUDGET` | NO source consumer | — | NOT emitted | USERGUIDE 3081 | **dead doc** F-14-003 |
| `CLAUDE_FLOW_RETENTION_DAYS` | NO source consumer | — | NOT emitted | USERGUIDE 3082 | **dead doc** F-14-003 |
| `CLAUDE_FLOW_AUTO_OPTIMIZE` | NO source consumer | — | NOT emitted | USERGUIDE 3083 | **dead doc** F-14-003 |
| `CLAUDE_FLOW_TOOL_GROUPS` | NO source consumer | — | NOT emitted | USERGUIDE 1490 | **dead doc** F-14-003 |
| `CLAUDE_FLOW_TOOL_MODE` | NO source consumer | — | NOT emitted | USERGUIDE 1491 | **dead doc** F-14-003 |
| `RUFLO_PROVIDER` | `agent-execute-core.ts:95` | — | NOT emitted | — | sound (lone `RUFLO_*` var) F-14-004 |
| `AGENTDB_POSTGRES_URL` | `agentdb/.../PostgresBackend.ts:191` | — | NOT emitted | — | sound |
| `AGENTDB_PATH` | `agentdb/.../agentdb-cli.ts:1976`, `mcp-server.ts:241` | `"./agentdb.db"` | NOT emitted | — | sound (agentdb-internal) |
| `AGENTDB_DEV_BYPASS_SECRET` | `agentdb/middleware/auth.middleware.ts:82` | — | NOT emitted | — | sound (with self-warn) |
| `AGENTDB_HNSW_M/EF_CONSTRUCTION/EF_SEARCH` | `agentdb/cli/config-manager.ts:402-409` | — | NOT emitted | — | sound (agentdb CLI only) |
| `AGENTDB_ATTENTION_HEADS/DIM` | `agentdb/cli/config-manager.ts:413-417` | — | NOT emitted | — | sound (agentdb CLI only) |
| `AGENTDB_BEAM_WIDTH/TRAVERSAL_STRATEGY` | `agentdb/cli/config-manager.ts:421-425` | — | NOT emitted | — | sound (agentdb CLI only) |
| `MCP_PORT` | `mcp/server.ts:42`, `transport/index.ts:217`, `cli/mcp-server.ts:74`, `init/types.ts:537,677`, `memory-router.ts:698` | `3000` | NOT emitted | — | sound, undocumented (parallel to `CLAUDE_FLOW_MCP_PORT`) F-14-013 |
| `MCP_WS_PORT` | `mcp/transport/index.ts:226`, `memory-router.ts:699` | `3001` | NOT emitted | — | sound, undocumented |
| `QUIC_PORT` | `memory-router.ts:700` | `4433` | NOT emitted | — | sound, undocumented |
| `FEDERATION_PORT` | `memory-router.ts:701` | `8443` | NOT emitted | — | sound, undocumented |
| `HEALTH_PORT` | `memory-router.ts:702` | `8080` | NOT emitted | — | sound, undocumented |

## Findings

### F-14-001 [CRITICAL] `.mcp.json` injects four `CLAUDE_FLOW_*` env vars that no code reads

- **Location:** `forks/ruflo/v3/@claude-flow/cli/src/init/mcp-generator.ts:82-86`
  emits the env block; the entire ruflo/agentdb source tree contains zero
  `process.env.CLAUDE_FLOW_MODE`, `process.env.CLAUDE_FLOW_TOPOLOGY`,
  `process.env.CLAUDE_FLOW_MEMORY_BACKEND`, or `process.env.CLAUDE_FLOW_HOOKS_ENABLED`
  consumer outside dist/tests.
- **Evidence:**
  ```ts
  // mcp-generator.ts:82-86 — env block written to every user's .mcp.json
  CLAUDE_FLOW_MODE: 'v3',
  CLAUDE_FLOW_HOOKS_ENABLED: 'true',
  CLAUDE_FLOW_TOPOLOGY: options.runtime.topology,
  CLAUDE_FLOW_MAX_AGENTS: String(options.runtime.maxAgents),
  CLAUDE_FLOW_MEMORY_BACKEND: options.runtime.memoryBackend,
  ```

  ```bash
  grep -rn "process\.env\.\(CLAUDE_FLOW_MODE\|CLAUDE_FLOW_TOPOLOGY\|CLAUDE_FLOW_MEMORY_BACKEND\|CLAUDE_FLOW_HOOKS_ENABLED\)" \
    forks/ruflo/v3/ --include="*.ts" | grep -v __tests__ | grep -v "/dist/"
  # returns 0 hits
  ```

  `CLAUDE_FLOW_MAX_AGENTS` IS read by `shared/config/loader.ts:80` — but
  that's the Zod-validated path the substrate consumers don't go through.
  `CLAUDE_FLOW_LOG_LEVEL` is written by `rvfa-builder.ts:322` and codex
  generators with the same dead-emission pattern.
- **Impact:** The hook surface most-frequently demonstrated to users (their
  own `.mcp.json` injecting "operational config") is theatrical: the MCP
  server boots, ignores the vars, and reads `.claude-flow/config.json`
  instead. Changing `CLAUDE_FLOW_TOPOLOGY=mesh` in the injected env has no
  effect on the running swarm. This is `feedback-no-fallbacks`-shaped: not
  a fallback per se, but a configuration pretense.

### F-14-002 [CRITICAL] Init template emits `CLAUDE_FLOW_TOPOLOGY` / `CLAUDE_FLOW_MEMORY_BACKEND`; consumer reads `CLAUDE_FLOW_SWARM_TOPOLOGY` / `CLAUDE_FLOW_MEMORY_TYPE`

- **Location:**
  - Writer: `forks/ruflo/v3/@claude-flow/cli/src/init/mcp-generator.ts:84,86`
  - Reader: `forks/ruflo/v3/@claude-flow/shared/src/core/config/loader.ts:142` (`CLAUDE_FLOW_SWARM_TOPOLOGY`), `:103` (`CLAUDE_FLOW_MEMORY_TYPE`)
- **Evidence:**
  ```ts
  // loader.ts:103 — what the consumer expects
  if (process.env.CLAUDE_FLOW_MEMORY_TYPE) { ... }
  // loader.ts:142
  if (process.env.CLAUDE_FLOW_SWARM_TOPOLOGY) { ... }
  ```

  ```ts
  // mcp-generator.ts:84,86 — what init writes
  CLAUDE_FLOW_TOPOLOGY: options.runtime.topology,
  CLAUDE_FLOW_MEMORY_BACKEND: options.runtime.memoryBackend,
  ```

  The Zod loader IS reachable from `cli/src/index.ts:553`
  (`loadSystemConfig` import), but never sees the writer's keys.
- **Impact:** Even when the consumer chain were properly wired, the names
  differ — `TOPOLOGY` ≠ `SWARM_TOPOLOGY`, `MEMORY_BACKEND` ≠ `MEMORY_TYPE`.
  Adopting either pair would still need the OTHER side of the split fixed.
  USERGUIDE.md documents both: line 6964 (`MEMORY_TYPE`) and line 3229
  (`MEMORY_BACKEND`); line 6975 (`TOPOLOGY`) — none mention
  `SWARM_TOPOLOGY`. So docs lock in the broken name pair.

### F-14-003 [CRITICAL] USERGUIDE documents 12 env vars with zero source consumers

- **Location:** `forks/ruflo/docs/USERGUIDE.md` lines 1490-1491, 3077-3083, 6961, 6965, 6975, 6991-6993, 6976
- **Evidence:**

  | Documented env var | Line | Consumers found |
  |---|---|---|
  | `CLAUDE_FLOW_ENV` | 6961 | 0 |
  | `CLAUDE_FLOW_SECURITY_MODE` | 6965 | 0 |
  | `CLAUDE_FLOW_LOG_LEVEL` | 6966 | 0 (written only by emitters) |
  | `CLAUDE_FLOW_HNSW_M` | 6991 | 0 |
  | `CLAUDE_FLOW_HNSW_EF` | 6992 | 0 |
  | `CLAUDE_FLOW_EMBEDDING_DIM` | 6993 | 0 |
  | `CLAUDE_FLOW_CONTEXT_AUTOPILOT` | 3077 | 0 |
  | `CLAUDE_FLOW_CONTEXT_WINDOW` | 3078 | 0 |
  | `CLAUDE_FLOW_AUTOPILOT_WARN` | 3079 | 0 |
  | `CLAUDE_FLOW_AUTOPILOT_PRUNE` | 3080 | 0 |
  | `CLAUDE_FLOW_COMPACT_RESTORE_BUDGET` | 3081 | 0 |
  | `CLAUDE_FLOW_RETENTION_DAYS` | 3082 | 0 |
  | `CLAUDE_FLOW_AUTO_OPTIMIZE` | 3083 | 0 |
  | `CLAUDE_FLOW_TOOL_GROUPS` | 1490 | 0 |
  | `CLAUDE_FLOW_TOOL_MODE` | 1491 | 0 |
  | `CLAUDE_FLOW_TOPOLOGY` (default `hierarchical`) | 6975 | 0 (and default wrong, code uses `hierarchical-mesh`) |
- **Impact:** Users following the documented HNSW tuning workflow
  (`export CLAUDE_FLOW_HNSW_M=32`) see zero effect; same for autopilot
  thresholds; same for security mode. The configuration story the
  USERGUIDE tells is partial fiction. This is the docs-side analog of
  ADR-0094 dead surface.

### F-14-004 [WARNING] Inconsistent env prefix: 1 lone `RUFLO_PROVIDER` vs 24 `CLAUDE_FLOW_*`

- **Location:** `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/agent-execute-core.ts:95`
  (only `RUFLO_*` env var consumer in source); the canon is documented at
  `cli/src/mcp-tools/hive-mind-tools.ts:2515`:
  ```ts
  // ADR-0118 review-notes-triage row 19;
  // CLAUDE_FLOW_* is the runtime convention, NOT RUFLO_*
  ```
- **Impact:** Mild — but `RUFLO_PROVIDER` violates the documented runtime
  convention. Either rename to `CLAUDE_FLOW_PROVIDER` (and migrate users)
  or add a project-wide doc note that `RUFLO_PROVIDER` is the one
  acknowledged exception.

### F-14-005 [WARNING] Eight config keys with no consumer (dead in current state)

- **Location:** `forks/ruflo/v3/@claude-flow/cli/src/init/config-template.ts`
- **Evidence:** grep across `forks/ruflo/v3/`, `forks/agentdb/src/`,
  `forks/agentic-flow/` for the following keys returns zero non-test
  non-self-write consumers:

  | Key | Lines | Default |
  |---|---|---|
  | `swarm.autoScale.enabled` | 59 | `true` |
  | `swarm.coordinationStrategy` | 60 | `"consensus"` |
  | `neural.enabled` | 73 | `true` |
  | `neural.modelPath` | 74 | `".claude-flow/neural"` |
  | `neural.qualityThreshold` | 77 | `0.5` |
  | `mcp.autoStart` | 100 | `true` |
  | `mcp.transport.port` | 101 | `3000` |
  | `hooks.enabled` | 111 | `true` |
  | `hooks.autoExecute` | 112 | `true` |
  | `controllers.quantizedVectorStore` | 272-274 | `"scalar-8bit"` |
  | `daemon.maxConcurrent` | 301 | `2` |
  | `daemon.workerTimeoutMs` | 302 | `300000` |
  | `daemon.resourceThresholds.maxCpuLoad` | 304 | `28` |
  | `daemon.resourceThresholds.minFreeMemoryPercent` | 304 | `5` |
- **Impact:** The `project-config-gaps` memory says the 11 ADR-0069 dead
  keys are wired (they are — `swarmDir`, `embeddingCacheSize`,
  `similarityThreshold`, `ports.*`, `rateLimiter`, `workers.triggers`,
  `learningRates.sona/lora/sarsa` all verified). But a SECOND generation
  of dead keys is now in the template; they were added during ADR-0069
  T-series expansion without corresponding consumers. Listed in priority
  order: `swarm.autoScale.enabled`, `swarm.coordinationStrategy`,
  `neural.enabled`, and `mcp.autoStart` are the most user-visible.

### F-14-006 [WARNING] `memory.sqlite.cacheSize/busyTimeoutMs/synchronous` documented as wired but no consumer

- **Location:** Template lines 148, 149, 151 (full only)
- **Evidence:**
  ```bash
  grep -rn "memory\.sqlite\.\(cacheSize\|busyTimeoutMs\|synchronous\)" \
    forks/ruflo/v3/ --include="*.ts" | grep -v __tests__ | grep -v "/dist/"
  # returns 0 non-test consumers
  ```

  The `project-config-gaps` memory claim "`memory.sqlite.journalMode/synchronous` →
  bridge fallback expanded" lands only the `journalMode` half via
  `resolve-config.ts:218` (which reads `walMode` boolean, not the string
  `"WAL"` directly); the other three keys remain consumer-less.
- **Impact:** Users who write `memory.sqlite.busyTimeoutMs: 10000` in their
  config.json get no benefit — the SQLite open path uses hardcoded
  defaults. Same shape as F-14-005 but called out separately because the
  memory entry claims it's already fixed.

### F-14-007 [WARNING] `memory.sqlite.journalMode` (string) → `embeddings.json.walMode` (boolean) — type mismatch in the wiring

- **Location:** Writer is `config-template.ts:150` (string `"WAL"`); reader is
  `resolve-config.ts:218` (`typeof fileConfig.walMode === 'boolean'`).
- **Evidence:** The wiring is via `embeddings.json` (not `config.json`).
  `embeddings.json` is written by `executor.ts:1463` with hardcoded
  `walMode: true`. The string `journalMode: "WAL"` is never converted, so
  the config.json setting is silently ignored.
- **Impact:** Setting `memory.sqlite.journalMode: "DELETE"` in config.json
  has no effect — the embeddings.json still pins WAL. The "wired" claim
  from `project-config-gaps` is half-true: there's a consumer, but it
  reads a different file's boolean field with a different name.

### F-14-008 [WARNING] `memory.embeddings.*` mirrors the canonical `embedding.*` and `index.hnsw.*` — drift risk

- **Location:** `config-template.ts:170-181` mirrors `config-template.ts:84-98`
  (full template only).
- **Evidence:** Both blocks set `model`, `dimension`, `provider`, HNSW
  params. The canonical source for substrate readers is the top-level
  `embedding.*` / `index.hnsw.*` (per `config-chain/src/index.ts` and
  `resolve-config.ts`); the nested `memory.embeddings.*` mirror exists
  only for "source-inspection tooling (e.g., adr0080-maxelements)" per
  the inline comment at line 129. No automated drift check ties the two.
- **Impact:** Default values can drift; a user editing `embedding.model`
  but not `memory.embeddings.model` will get one writer's intent and
  another's stale value depending on which reader fires first.

### F-14-009 [CRITICAL] `memory.embeddings.provider` default = `"transformers.js"`; canonical `embedding.provider` default = `"onnx"`

- **Location:** Template lines 86 (`embedding.provider: "onnx"`) and 173
  (`memory.embeddings.provider: "transformers.js"`).
- **Evidence:** Same template, two writers, two different defaults for the
  same logical concept. `config-chain/src/index.ts:176` normalises
  `"transformers"` and `"transformers.js"` → `"onnx"`, so runtime resolves
  identically — but the on-disk config.json shows TWO DIFFERENT VALUES.
- **Impact:** Anyone reading config.json to verify configuration sees
  contradictory provider declarations. `ruflo config get embedding.provider`
  vs `ruflo config get memory.embeddings.provider` return different
  strings for the same conceptual key.

### F-14-010 [NOTE] Default-init users get NO `controllers/rateLimiter/workers/daemon` block

- **Location:** `cli/src/init/executor.ts:1390-1394` — the minimal template
  is chosen unless `options.full === true` or `options.skills?.all === true`.
- **Evidence:** `getMinimalConfigTemplate()` returns 8 top-level keys
  (`version/swarm/memory/neural/embedding/index/mcp/ports/hooks`). The
  `getFullConfigTemplate()` adds `controllers/rateLimiter/workers/daemon` +
  expands `memory/neural`. Default `init` produces the MINIMAL template.
- **Impact:** Consumers of `controllers.*`, `rateLimiter.*`,
  `workers.triggers.*`, `daemon.*` fall back to hardcoded defaults for
  default-init users. There's no documented way to "upgrade" a minimal
  config.json to full without `--force --full`. The
  `project-config-gaps` memory's "Init template integration is the
  remaining gap — new projects don't generate these keys yet" line
  remains accurate for the default-init path; only `--full` projects
  see the expanded template.

### F-14-011 [WARNING] Only 1 of 5 `rateLimiter` presets has a consumer

- **Location:** Template lines 282-287 define 5 presets (`default/auth/tools/memory/files`).
- **Evidence:** Only `rateLimiter.memory` is read (by
  `guidance/src/memory-gate.ts:122`); `rateLimiter.default` is read by
  `memory-router.ts:645` as a forward into `controllers.rateLimiter`;
  the `auth`, `tools`, `files` presets have zero consumers.
- **Impact:** Users adjusting auth/tools/files rate limits get no effect.
  Either wire the three remaining presets to their respective auth /
  tool-execution / file-IO paths, or drop them from the template.

### F-14-012 [WARNING] `daemon.headless` config key superseded by `CLAUDE_FLOW_HEADLESS` env without alignment

- **Location:** Template line 303 (`daemon.headless: false`) and reader
  `runtime/headless.ts:355`.
- **Evidence:** Daemon code uses the env var directly. `daemon.headless`
  is never read.
- **Impact:** Configuration mode-split: some daemon behaviours come from
  config.json, headless mode from env. Document one path or wire both.

### F-14-013 [NOTE] Parallel `MCP_PORT` and `CLAUDE_FLOW_MCP_PORT` env vars — neither emitted by init

- **Location:** `MCP_PORT` reader at `mcp/server.ts:42`, `transport/index.ts:217`,
  `cli/mcp-server.ts:74`, `memory-router.ts:698`; parallel
  `CLAUDE_FLOW_MCP_PORT` at `shared/config/loader.ts:128`,
  `system-tools.ts:506`.
- **Evidence:** Two env-var names for the same port. USERGUIDE 6983
  documents only `CLAUDE_FLOW_MCP_PORT`. Init writes neither.
- **Impact:** Setting `MCP_PORT=9000` works at the server-boot layer but
  not at the loader layer (port read from `loader.ts` won't pick it up).
  Standardise to one prefix.

### F-14-014 [WARNING] 17 substrate packages bypass the Zod-validated `ConfigLoader`; schema validation never reaches consumers

- **Location:** `forks/ruflo/v3/@claude-flow/shared/src/core/config/`
  defines the schema; `cli/src/index.ts:553` invokes it. But 17 packages
  re-read `.claude-flow/config.json` via direct `JSON.parse`:
  - `memory/src/memory-graph.ts:65`
  - `memory/src/persistent-sona.ts:47`
  - `memory/src/application/queries/search-memory.query.ts:22`
  - `memory/src/migration.ts:35`
  - `memory/src/learning-bridge.ts:94`
  - `memory/src/domain/services/memory-domain-service.ts:240`
  - `plugins/src/integrations/ruvector/self-learning.ts:42`
  - `plugins/src/workers/index.ts:44`
  - `integration/src/types.ts:448`
  - `integration/src/sona-adapter.ts:67,700`
  - `aidefence/src/domain/services/threat-learning-service.ts:179`
  - `cli/src/memory/memory-router.ts:430,465`
  - `cli/src/ruvector/q-learning-router.ts:23`
  - `cli/src/ruvector/lora-adapter.ts:30`
  - `cli/src/services/ruvector-training.ts:316`
  - `cli/src/services/worker-queue.ts:159`
  - `hooks/src/swarm/index.ts:182`
  - `neural/src/moe-router.ts:27`
  - `neural/src/algorithms/sarsa.ts:20`
  - `neural/src/algorithms/q-learning.ts:21`
  - `embeddings/src/rvf-embedding-service.ts:57`
- **Impact:** A malformed config.json (string where number expected,
  invalid enum) passes through silently; the substrate reader returns
  `undefined` and falls through to its fallback. Schema-as-defence is
  installed but unused. This is a `feedback-no-fallbacks`-shaped pattern
  at the configuration layer: invalid input never raises.

### F-14-015 [WARNING] `CLAUDE_FLOW_MAX_AGENTS` has no NaN / bounds validation

- **Location:** `shared/config/loader.ts:80-87`
- **Evidence:**
  ```ts
  if (process.env.CLAUDE_FLOW_MAX_AGENTS) {
    config.orchestrator = {
      ...
      maxConcurrentAgents: parseInt(process.env.CLAUDE_FLOW_MAX_AGENTS, 10),
    };
  }
  ```

  `parseInt("not-a-number", 10)` returns `NaN`; downstream comparisons
  with `NaN` are all `false`. `parseInt("-5", 10)` returns `-5` and is
  silently accepted. The wizard prompt at `init.ts:693-697` does enforce
  `n > 0 && n <= 50` — but only when interactive. The env var has no gate.
- **Impact:** `export CLAUDE_FLOW_MAX_AGENTS=foo` → swarm boots with NaN
  agents → either crashes downstream or silently zero-agents the swarm.
  Add Number.isFinite + range check.

### F-14-016 [NOTE] `mcp.port` parsed via `parseInt(process.env.MCP_PORT || '', 10) || 3000`

- **Location:** Same idiom at 6 sites: `mcp/server.ts:42`,
  `mcp/transport/index.ts:217`, `shared/mcp/server.ts:52`,
  `shared/mcp/transport/index.ts:278`, `cli/mcp-server.ts:74`,
  `init/types.ts:537,677`.
- **Evidence:** `parseInt('foo', 10) || 3000` evaluates to `NaN || 3000`
  → `3000`. So an invalid MCP_PORT silently degrades to 3000.
- **Impact:** Wins on robustness, loses on diagnosability. A misconfigured
  MCP_PORT will bind to 3000 with no warning. Acceptable for ports but
  the user expectation set by `feedback-no-fallbacks` favours an explicit
  error. Low-impact; flagged for awareness.

### F-14-017 [NOTE] `embeddings.json` validation gates `model` but not `dimension/provider/hnsw`

- **Location:** `config-chain/src/index.ts:218-234` (`validateBoot`)
- **Evidence:** Gates: empty model when file present (rejected), paid
  provider without `allowPaidProvider=true` (rejected). Does NOT gate:
  inconsistent (model, dimension) pairs, invalid HNSW M (`-1`, `999999`),
  non-numeric `efConstruction`, malformed `storageProvider` strings.
  `resolve-config.ts:319-324` has a single safety net for the
  384-vs-768 dimension drift but no generic typeof+range gate.
- **Impact:** A user-edited `embeddings.json` with `dimension: "768"`
  (string) silently falls through `asNumber()` to `undefined` → resolves
  to default 768. Edits with `dimension: 384, model: "Xenova/all-mpnet-base-v2"`
  trigger the safety net and reset dimension to 768. But
  `dimension: 1024, model: "Xenova/all-MiniLM-L6-v2"` (genuinely
  inconsistent) is silently accepted. Boot-time dimension probe at
  `EmbeddingDimensionMismatchError` catches it eventually, but only after
  the embedding pipeline has loaded.

### F-14-018 [NOTE] File sizes — ADR-0089 / line-limit exemption check

- **Location:** Three configuration-related files exceed 500 lines:
  - `cli/src/init/types.ts` — 719 lines
  - `cli/src/commands/init.ts` — 1414 lines
  - `cli/src/init/executor.ts` — 2295 lines
- **Evidence:** All three are upstream-maintained per the CLAUDE.md
  exception ("Keep files under 500 lines (exceptions: upstream-maintained
  files — see memory `project-adr0094-living-tracker` / ADR-0089)"). The
  pattern matches the documented anti-pattern at ADR-0089:124-192
  ("Deleting upstream-maintained files to satisfy the 500-line rule" is
  rejected). No action required, but flagged so the audit baseline
  records the current sizes for future drift detection.
- **Impact:** Compliant under the exception clause.
  `config-chain/src/index.ts` (255), `config-template.ts` (310),
  `config-file-manager.ts` (196), `resolve-config.ts` (357),
  `commands/config.ts` (441) all under limit.

## Method

- Read every file in `config-chain/src/`, `cli/src/init/`,
  `cli/src/services/config-file-manager.ts`, `cli/src/commands/config.ts`,
  `cli/src/commands/init.ts`, `memory/src/resolve-config.ts`,
  `shared/src/core/config/{schema.ts,loader.ts}` in full.
- Cross-walked every key in `getMinimalConfigTemplate()` /
  `getFullConfigTemplate()` against `grep -rn "<key>"` in
  `forks/ruflo/v3/`, `forks/agentdb/src/`, `forks/agentic-flow/`
  (excluding `__tests__`, `/tests/`, `/dist/`).
- For each env var: `grep -rn "process\.env\.<NAME>"` outside test +
  dist trees, then verified each match was a reader (`process.env.X || ...`)
  vs an emitter (`env: { X: ... }`).
- For docs, walked the two USERGUIDE env-var tables (lines 1488-1502
  and 6955-7060) plus the CLAUDE.md `env` mentions plus the
  `.mcp.json` env block plus init's `mcp-generator.ts` + `settings-generator.ts`
  emitters.
- For init template completeness: ran `getMinimalConfigTemplate()` vs
  `getFullConfigTemplate()` mentally side-by-side, listed the keys each
  emits, and noted which path is taken at `executor.ts:1390-1394`
  (`isFull = options.full === true || options.skills?.all === true`).
- For ADR-0089 file-size compliance: ran `wc -l` on the 8 audited files
  and cross-checked the documented exception clause in CLAUDE.md +
  ADR-0089:124-192.

## Recommendations

1. **Fix the env-var naming skew (F-14-001 + F-14-002)** — pick one prefix
   (`CLAUDE_FLOW_TOPOLOGY` or `CLAUDE_FLOW_SWARM_TOPOLOGY`) and align
   `init/mcp-generator.ts` with `shared/config/loader.ts`. Either:
   (a) update loader to read the names init emits; (b) update init to emit
   the names loader reads. (b) is safer because it doesn't break existing
   env-var docs; (a) requires a USERGUIDE rewrite. Same for
   `MEMORY_BACKEND` vs `MEMORY_TYPE`. Document the canonical name in one
   place and link from USERGUIDE.

2. **Either wire or delete the 12 dead-doc env vars (F-14-003)** —
   `CLAUDE_FLOW_HNSW_M/EF/EMBEDDING_DIM` should map to the existing
   `embeddings.json.hnsw.{M,efConstruction,efSearch}` + `dimension`;
   `CLAUDE_FLOW_LOG_LEVEL` should be picked up by the logger module;
   autopilot / context / tool-group / retention / auto-optimize vars
   should be wired to autopilot.ts / context.ts or removed from
   USERGUIDE. Until one or the other happens, the docs lie.

3. **Add a Zod-validated path for `.claude-flow/config.json` (F-14-014)** —
   the 17 hand-rolled `JSON.parse(readFileSync(config.json))` consumers
   should funnel through a single accessor that validates against the
   `config-template.ts` shape and throws on type errors. Pattern can
   match `config-chain/src/index.ts`'s validateBoot. This addresses the
   `feedback-no-fallbacks` pattern at the config layer.

4. **Promote `controllers/rateLimiter/workers/daemon` from full-only to
   minimal (F-14-010)** — these blocks are consumed unconditionally by
   memory-router for ALL projects; the current setup means default-init
   users get hardcoded defaults that diverge from anyone who ran `--full`.
   Either inline the safe defaults in the minimal template, or document
   that `--full` is required for those features.

5. **Validate `CLAUDE_FLOW_MAX_AGENTS` and similar numeric env vars
   (F-14-015)** — add `Number.isFinite(n) && n >= 1 && n <= 50` gates at
   parse time. Apply the same to `MCP_PORT`, `QUIC_PORT`, etc., raising
   on out-of-range rather than silently defaulting.

6. **Reconcile the dual-write of `memory.embeddings.*` ↔
   `embedding.*` / `index.hnsw.*` (F-14-008 + F-14-009)** — drop the
   `memory.embeddings.*` mirror from the full template OR add a
   regression test that asserts the values match. The current "kept here
   for source-inspection tooling" inline comment doesn't justify the
   provider-default mismatch (F-14-009: `"transformers.js"` vs `"onnx"`).

7. **Drop the 8 dead config keys from the template (F-14-005)** — none
   has a reader. Either wire them (e.g., `swarm.autoScale.enabled` →
   actual autoscale logic) or delete. Half the listed keys
   (`mcp.autoStart`, `hooks.enabled`, `hooks.autoExecute`,
   `swarm.coordinationStrategy`) suggest the intended consumers were
   never built; the other half (`daemon.maxConcurrent`,
   `daemon.workerTimeoutMs`, `daemon.resourceThresholds.*`) duplicate
   functionality available via daemon CLI flags.

8. **Either complete or remove the `memory.sqlite.*` block (F-14-006 +
   F-14-007)** — currently the template emits 4 SQLite keys; only
   `journalMode`'s boolean equivalent is read (via a different file).
   Either wire all 4 to the SQLite open call, or remove the block and
   document that journalMode comes from `embeddings.json.walMode`.

9. **Update the `project-config-gaps` memory** — the ADR-0069 11 dead
   keys are indeed wired (verified). But:
   - Add the new dead keys uncovered here (F-14-005, F-14-006).
   - Add the env-var naming-skew finding (F-14-001 + F-14-002).
   - Add the 17 packages-bypass-Zod finding (F-14-014).
   - The "Init template gap" note remains accurate for the minimal vs
     full split (F-14-010).
