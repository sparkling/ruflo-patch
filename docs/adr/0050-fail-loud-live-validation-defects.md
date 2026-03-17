# ADR-0050: Fail-Loud Live Validation — Defect Catalog

## Status

Accepted

## Date

2026-03-17

## Deciders

sparkling team

## Methodology

SPARC + MADR

## Context

ADR-0049 replaced 34 silent `catch { return null }` blocks with error-aware catch blocks and added `requireController()` guards to 14 bridge functions. A 3-agent swarm then ran every ADR-0040–0047 MCP tool against a fresh `@sparkleideas/cli` install at `~/src/test` (v3.5.15-patch.85) to catalog what's actually broken at runtime now that errors are no longer swallowed.

### Test environment

- **CLI Version**: v3.5.15-patch.85
- **Backend**: HNSW + sql.js (hybrid)
- **Controllers**: 43 registered, 34 enabled, 9 disabled
- **Native packages**: None installed (no NAPI, no WASM)

### Results overview

| Status | Count | Meaning |
|--------|:-----:|---------|
| PASS | 8 | Tool returned expected data |
| FAIL | 5 | Tool returned error or crashed |
| DEGRADED | 7 | Tool returned `success: true` but with empty/stub/wrong data |

## Decision: Specification (SPARC-S)

### 5 Failures (tools that error or crash)

#### F1: `hooks_route` — null dereference

- **Error**: `Cannot read properties of undefined (reading 'toLowerCase')`
- **Controller**: solverBandit route handler
- **Root cause**: The error originates in `search-memory.query.ts` line 127, not in the solverBandit handler itself. The code `input.textQuery!.toLowerCase()` uses an unsafe non-null assertion — when `textQuery` is undefined (optional field), the assertion passes TypeScript but crashes at runtime.
- **File**: `v3/@claude-flow/memory/src/application/queries/search-memory.query.ts:127`
- **ADR**: 0040

#### F2: `agentdb_filtered_search` — bridge not available

- **Error**: `"Bridge not available"`
- **Controller**: B5 metadataFilter
- **Root cause**: The error is NOT a learningBridge dependency. `bridgeFilteredSearch` (memory-bridge.ts:2699) calls `bridgeSearchEntries` (line 2714) which returns null when `getRegistry()` or `getDb()` returns null — i.e., when the base search engine is unavailable. B5 metadataFilter is at Level 1 and has no dependency on learningBridge (its constructor takes zero arguments, line 1603). The "Bridge not available" triggers when the entire registry/db layer fails to initialize, blocking all search operations.
- **File**: `v3/@claude-flow/cli/src/memory/memory-bridge.ts:2699-2724`
- **ADR**: 0043

#### F3: `agentdb_attention_metrics` — D2 not active

- **Error**: `"AttentionMetrics (D2) not active"`
- **Controller**: D2 attentionMetrics
- **Root cause**: Compound failure — import failure AND constructor mismatch. The factory (controller-registry.ts:1884) does `agentdbModule.AttentionMetrics` which resolves to the TypeScript **interface**, not the **class** `AttentionMetricsCollector`. Interfaces don't exist at runtime, so `AM` is `undefined` and the factory returns null at line 1885. Even if the import were fixed, the factory passes `{ attentionService, selfAttention, crossAttention, multiHeadAttention }` but `AttentionMetricsCollector` (attention-metrics.ts:31) has no constructor — config is silently ignored. Fix requires: (1) export `AttentionMetricsCollector` from agentdb barrel, (2) change factory to use `AttentionMetricsCollector`, (3) remove config object.
- **File**: `v3/@claude-flow/memory/src/controller-registry.ts:1884-1895`
- **ADR**: 0044

#### F4: `agentdb_quantize_status` — B9 not active

- **Error**: `"QuantizedVectorStore not active"`
- **Controller**: B9 quantizedVectorStore
- **Root cause**: Factory (controller-registry.ts:1696-1699) passes `{ dimension, innerBackend }` but `QuantizedVectorStore` constructor (Quantization.ts:628) requires `QuantizationConfig` with mandatory `type: QuantizationType` field (`'scalar-4bit' | 'scalar-8bit' | 'product'`). The `dimension` field doesn't even exist in `QuantizationConfig`. Controller silently fails during deferred init.
- **File**: `v3/@claude-flow/memory/src/controller-registry.ts:1696-1699`
- **ADR**: 0047

#### F5: `agentdb_health_report` — B3 not available

- **Error**: `"indexHealthMonitor not available"`
- **Controller**: B3 indexHealthMonitor
- **Root cause**: Compound bug — (1) `IndexHealthMonitor` is NOT exported from `agentdb/src/index.ts`, so the factory's `agentdbModule.IndexHealthMonitor` resolves to `undefined` and returns null regardless of timing. (2) Even if exported, B3 is at Level 4 (deferred) and `bridgeHealthReport()` does not call `waitForDeferred()` before checking the controller, unlike `bridgeEmbed()`, `bridgeListControllers()`, and `bridgeControllers()` which all await deferred init. Fix requires: (1) add barrel export, (2) add `await registry.waitForDeferred()` to `bridgeHealthReport()`.
- **File**: `v3/@claude-flow/cli/src/memory/memory-bridge.ts` (handler) + `agentdb/src/index.ts` (export)
- **ADR**: 0047

### 7 Degradations (tools that succeed with empty/wrong data)

#### D1: `agentdb_attention_compute` — empty results

- **Symptom**: `success: true`, `results: []`
- **Root cause**: Handler schema (agentdb-tools.ts:1134-1160) accepts `query`/`namespace`/`limit` which correctly matches ADR-0044 spec (line 75: `bridgeAttentionSearch(options)` takes `{ query, namespace, limit }`). The empty results are a logic issue — the handler performs a memory search against a namespace with no data, not a schema mismatch.
- **ADR**: 0044

#### D2: `agentdb_attention_benchmark` — wrong dimensions

- **Symptom**: `success: true`, hardcoded `dim=64` instead of requested `768`
- **Root cause**: Handler schema (agentdb-tools.ts:1164-1194) defines `entryCount`/`blockSize` which matches the ADR-0044 pseudocode (line 84-85). ADR-0044 does NOT specify a `dimensions` parameter. The real issue is that synthetic benchmark entries at line 1181 use hardcoded 64-dimensional vectors instead of a configurable dimension. Fix: add a `dimensions` parameter to the schema and use it when generating synthetic entries.
- **ADR**: 0044

#### D3: `agentdb_attention_configure` — read-only, ignores mechanism

- **Symptom**: `success: true`, `engine: "fallback"`, `initialized: false`
- **Root cause**: Handler schema (agentdb-tools.ts:1198-1219) has empty `properties: {}`. ADR-0044 does NOT specify a `mechanism` parameter for this tool — configuration happens at init-time via the AttentionService constructor. The tool is correctly read-only (queries engine type, info, stats). The degradation is that without NAPI/WASM, engine is permanently "fallback". Consider renaming to `agentdb_attention_status` to match read-only behavior.
- **ADR**: 0044

#### D4: `agentdb_embed` — zero-dimension embedding

- **Symptom**: `success: true`, `embedding: []`, `dimension: 0`, `provider: "unknown"`
- **Root cause**: Registry imports `agentdb.EnhancedEmbeddingService` which resolves to the 143-line WASM wrapper (controllers/), not the 1436-line full implementation (services/). The wrapper has no multi-provider support, no LRU cache, no dimension alignment. Returns zeroed data.
- **ADR**: 0045 (swarm bug #9)

#### D5: `agentdb_embed_status` — contradicts health

- **Symptom**: `active: false`, `"EnhancedEmbeddingService not active"`
- **Root cause**: Two different readiness checks disagree. Health report (memory-bridge.ts:1987) calls `registry.listControllers()` which uses `isControllerEnabled()` (controller-registry.ts:820-822) — returns `true` if AgentDB is available (configuration readiness). But `embed_status` handler (agentdb-tools.ts:1062-1087) calls `bridgeHasController()` (memory-bridge.ts:1450-1451) which checks `registry.get()` — returns null for deferred controllers not yet instantiated (instantiation readiness). For Level 3 controllers, there is a window where `enabled: true` but `get()` returns null.
- **File**: `v3/@claude-flow/cli/src/memory/memory-bridge.ts:1450-1451` vs `:1987`
- **ADR**: 0045

#### D6: `agentdb_telemetry_metrics` — empty counters

- **Symptom**: `success: true`, `counters: {}`, `histograms: {}`, `exporters: ["console"]`
- **Root cause**: D1 TelemetryManager is an in-memory stub (no real OpenTelemetry SDK). No controller init or operation calls `telemetryManager.startSpan()` or `increment()`. Data is always empty because nothing produces telemetry events.
- **ADR**: 0045

#### D7: `agentdb_telemetry_spans` — empty spans

- **Symptom**: `success: true`, `spans: []`
- **Root cause**: Same as D6 — no span instrumentation wired into any controller or bridge operation.
- **ADR**: 0045

### 9 Disabled controllers

| Level | Controller | ADR | Cause |
|:-----:|-----------|-----|-------|
| 1 | learningBridge | 0040 | No backend configured (does NOT block filtered_search — see F2 correction) |
| 2 | selfLearningRvfBackend | 0046 | Factory calls `new SLRB(config)` but private ctor expects `(RvfBackend, config)` — needs `SelfLearningRvfBackend.create()` |
| 2 | nativeAccelerator | 0046 | `@ruvector/*` packages not installed — expected, JS fallbacks work |
| 2 | quantizedVectorStore | 0047 | Missing required `quantizationType` field in constructor config |
| 3 | auditLogger | 0045 | `AuditLogger` not exported from `agentdb/src/index.ts` — factory always gets `undefined` |
| 4 | indexHealthMonitor | 0047 | Compound: not exported from agentdb barrel AND deferred init timing |
| 4 | federatedLearningManager | 0047 | Compound: not exported from agentdb barrel AND constructor mismatch (factory passes `{ backend, dimension }`, constructor expects `FederatedConfig` with required `agentId: string`) |
| 4 | attentionMetrics | 0044 | Compound: factory imports interface (undefined at runtime) not class, AND constructor mismatch |
| 2 | gnnService (anomaly) | — | `enabled: true` but `available: false` internally — inconsistent status |

### 3 Cross-cutting issues

#### X1: CLI `--args` flag silently dropped

The `mcp exec` subcommand accepts `--params` / `-p` for tool parameters. The `--args` flag is silently ignored with no warning, causing tools to receive `{}` input and produce misleading "namespace required" errors. Unknown flags should produce an error.

#### X2: `success: false` returns exit code 0

Tools returning `{ success: false, error: "..." }` still exit with code 0. Under fail-loud mode, MCP tools that detect controller failures should propagate as exit code 1 so CI/scripts can catch them.

#### X3: Attention tool schema issues

Original analysis claimed 3 schema/spec mismatches. Source verification against ADR-0044 found:

- `attention_compute`: Schema (`query`/`namespace`/`limit`) **matches** ADR-0044 spec (line 75). No mismatch — empty results are a data issue, not schema.
- `attention_benchmark`: Schema (`entryCount`/`blockSize`) **matches** ADR-0044 pseudocode (line 84-85). ADR-0044 does not specify a `dimensions` parameter. Real issue: hardcoded `dim=64` in synthetic entries (agentdb-tools.ts:1181). Fix: add `dimensions` parameter.
- `attention_configure`: Empty `properties: {}` is **correct** — ADR-0044 configures AttentionService at init-time, not via tool parameters. Tool is read-only by design. Consider renaming to `agentdb_attention_status`.

## Decision: Pseudocode (SPARC-P)

No pseudocode — this ADR is a defect catalog, not an implementation plan. Fixes are tracked individually below.

## Decision: Architecture (SPARC-A)

### Defect categories and fix owners

| Category | Count | Fix approach |
|----------|:-----:|-------------|
| Constructor mismatch (registry passes wrong args) | 3 | Update factory in controller-registry.ts (F4: `type` field, F3: remove config, FLM: `agentId`) |
| Not exported from agentdb barrel | 4 | Add export lines to agentic-flow fork (AttentionMetricsCollector, IndexHealthMonitor, AuditLogger, FederatedLearningManager) |
| Import resolves to wrong class | 1 | Change import target in registry factory (D4: controllers/ → services/ EnhancedEmbeddingService) |
| Unsafe non-null assertion | 1 | Add null guard in search-memory.query.ts:127 (F1: `textQuery!` → `textQuery ?? ''`) |
| Registry/db unavailability | 1 | Investigate why base search engine fails to init (F2: registry returns null) |
| Missing `waitForDeferred()` | 1 | Add await in bridgeHealthReport, matching pattern in 3 other bridge functions (F5) |
| Readiness check inconsistency | 1 | Align embed_status to check `isControllerEnabled` or report `enabled/initialized` separately (D5) |
| Hardcoded dimension | 1 | Add `dimensions` parameter to benchmark schema (D2: `dim=64` → configurable) |
| No instrumentation wired | 2 | Instrument controller init with spans; add notice field to empty responses (D6/D7) |
| CLI UX (silent flag drop) | 1 | Reject unknown flags in mcp exec command parser (X1) |
| Exit code propagation | 1 | Return exit code 1 when tool result has `success: false` (X2) |

## Decision: Refinement (SPARC-R)

### Priority tiers

**Tier 1 — Fix immediately (blocks core functionality)**

| ID | Defect | Effort |
|----|--------|--------|
| F1 | Unsafe `textQuery!.toLowerCase()` in search-memory.query.ts:127 | ~3 lines (null guard) |
| F2 | Registry/db unavailability blocks all bridgeFilteredSearch | ~10 lines (investigate init failure, improve error message) |
| F4 | B9 factory passes `{dimension, innerBackend}`, needs `{type: 'scalar-8bit'}` | ~2 lines |
| D4 | A9 imports 159-line WASM wrapper, not 1435-line full service | ~3 lines (change import) |

**Tier 2 — Fix soon (features inert but not crashing)**

| ID | Defect | Effort |
|----|--------|--------|
| F3 | D2 import failure (interface not class) + constructor mismatch; needs barrel export of `AttentionMetricsCollector` | ~8 lines (export + factory fix) |
| D5 | `isControllerEnabled` vs `registry.get()` readiness disagreement | ~10 lines (align readiness check) |
| X1 | `mcp exec` silently ignores unknown flags (no `--args` validation) | ~10 lines (reject unknown flags) |
| D2 | Benchmark hardcodes `dim=64`; add `dimensions` parameter to schema | ~8 lines |

**Tier 3 — Fix later (improvements, not broken)**

| ID | Defect | Approach | Effort |
|----|--------|----------|--------|
| F5 | B3 compound: missing barrel export + missing `waitForDeferred()` | Export `IndexHealthMonitor` from agentdb + add `await registry.waitForDeferred()` to `bridgeHealthReport()` (matches pattern in 3 other bridge functions) | ~5 lines |
| D6/D7 | Telemetry empty (no instrumentation) | Instrument `initController()` loop with spans; add `notice` field to empty telemetry responses. Defer runtime bridge spans until real backend exists. | ~20 lines |
| X2 | Exit code propagation | Always-on: check `result.success` after `callMCPTool()`, return `exitCode: 1` if falsy. Consistent with ADR-0049 fail-loud philosophy. | ~8 lines |
| — | Export AuditLogger from agentdb | No circular dep risk (imports only `fs`/`path`). | ~2 lines |
| — | Export FederatedLearningManager from agentdb + fix factory | No circular dep risk (type-only `@ruvector/sona` import). Also needs factory fix: constructor expects `FederatedConfig` with `agentId: string`, factory passes `{ backend, dimension }`. | ~5 lines |

## Decision: Completion (SPARC-C)

### Checklist

- [x] Tier 1: Add null guard to `input.textQuery!.toLowerCase()` in search-memory.query.ts:127 (F1)
- [x] Tier 1: Investigate registry/db init failure in bridgeFilteredSearch; improve error message (F2)
- [x] Tier 1: Fix B9 factory: pass `{type: 'scalar-8bit'}` instead of `{dimension, innerBackend}` (F4)
- [x] Tier 1: Change A9 factory import from controllers/EnhancedEmbeddingService to services/enhanced-embeddings (D4)
- [x] Tier 2: Export `AttentionMetricsCollector` from agentdb barrel + fix factory import + remove config (F3)
- [x] Tier 2: Align embed_status readiness check with health report (D5)
- [x] Tier 2: Reject unknown flags in `mcp exec` options (X1)
- [x] Tier 2: Add `dimensions` parameter to attention_benchmark schema (D2)
- [x] Tier 3: Export `IndexHealthMonitor` from agentdb barrel (F5 prerequisite)
- [x] Tier 3: Add `await registry.waitForDeferred()` to `bridgeHealthReport()` + pass default IndexStats (F5)
- [x] Tier 3: Add notice fields to empty telemetry responses (D6/D7)
- [x] Tier 3: Propagate `success: false` as exit code 1 in mcp exec handler (X2)
- [x] Tier 3: Export `AuditLogger` from agentdb barrel
- [x] Tier 3: Export `FederatedLearningManager` from agentdb barrel + fix factory constructor mismatch
- [x] Run `npm run deploy` — 55/55 acceptance (v3.5.15-patch.87, 2026-03-17)
- [ ] Run full MCP tool validation against ~/src/test after all tiers

### Dependency order

Barrel exports in agentic-flow fork must ship first (unblocks F3, F5, AuditLogger, FederatedLearningManager). All ruflo-side fixes are independent of each other.

### Success Criteria

- 0 FAIL results from MCP tool validation (all 5 failures fixed)
- Degraded tools return real data instead of empty stubs (at least D1-D5)
- 43/43 controllers show `enabled: true` in health (or explicitly documented as optional)
- `npm run deploy` passes 55/55

## Consequences

### Positive

- Complete defect catalog with root causes, not just symptoms
- Priority tiers enable incremental fixing without blocking deployment
- Mapping to swarm audit bugs (#9, #12, #13, #14, #15, #17) confirms code analysis with runtime evidence
- Fail-loud mode (ADR-0049) successfully surfaced 5 failures that were previously invisible

### Negative

- 5 MCP tools are broken for end users until Tier 1 fixes ship
- 7 tools return misleading `success: true` with empty data until Tier 2
- Total fix effort estimated at ~95 lines across 4 files + 4 fork barrel export lines

### Risks

- Tier 1 fixes may introduce new failures if constructor signatures aren't carefully verified
- B3 deferred init timing (F5) uses established `waitForDeferred()` pattern — low risk
- X3 attention schemas mostly match ADR-0044 spec; only D2 benchmark dimension needs a new parameter

## Related

- **ADR-0049**: Fail-loud mode (prerequisite — made these defects visible)
- **ADR-0040 through ADR-0047**: The 8 ADRs whose implementations contain these defects
- **ADR-0048**: Lazy controller initialization (deferred init causes F5)
- **Swarm audit 2026-03-17**: 8-agent code analysis that found 29 bugs; this ADR confirms 7 at runtime

## Revision History

- **2026-03-17 (rev 2)**: Source verification audit corrected 4 root causes:
  - F1: Error is in search-memory.query.ts:127, not solverBandit handler
  - F2: No learningBridge dependency — registry/db unavailability is the root cause
  - F3: Refined — import failure (interface not class) is the primary cause, not just constructor mismatch
  - X3: 2 of 3 claimed spec mismatches were wrong — schemas match ADR-0044; real issues are hardcoded dim and read-only behavior
  - F5: Compound bug discovered — missing barrel export AND missing waitForDeferred
  - FederatedLearningManager: Additional constructor mismatch found
  - Barrel exports needed: 4 (was 2) — added AttentionMetricsCollector and IndexHealthMonitor
  - Tier 2 updated: X3 removed (schemas correct), D2 benchmark dimension added
