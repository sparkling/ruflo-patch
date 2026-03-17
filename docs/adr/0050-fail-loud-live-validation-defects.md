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
- **Root cause**: The route handler calls `.toLowerCase()` on an input field that is undefined. Missing input validation at handler boundary.
- **ADR**: 0040

#### F2: `agentdb_filtered_search` — bridge not available

- **Error**: `"Bridge not available"`
- **Controller**: B5 metadataFilter (depends on learningBridge)
- **Root cause**: `learningBridge` controller is disabled at Level 1 (no backend configured). The filtered search bridge function requires learningBridge, but this dependency isn't documented — B5 MetadataFilter should work independently of learningBridge.
- **ADR**: 0043

#### F3: `agentdb_attention_metrics` — D2 not active

- **Error**: `"AttentionMetrics (D2) not active"`
- **Controller**: D2 attentionMetrics
- **Root cause**: D2 factory passes `{ attentionService, selfAttention, crossAttention, multiHeadAttention }` to constructor, but `AttentionMetricsCollector` takes no constructor arguments. The constructor silently ignores the config, but the controller may fail for a different reason at Level 4 (deferred init timing or import failure).
- **ADR**: 0044

#### F4: `agentdb_quantize_status` — B9 not active

- **Error**: `"QuantizedVectorStore not active"`
- **Controller**: B9 quantizedVectorStore
- **Root cause**: Factory passes `{ dimension, innerBackend }` but `QuantizedVectorStore` constructor requires `{ dimension, quantizationType }`. The `quantizationType` field (`'scalar8bit' | 'scalar4bit' | 'product'`) is never provided. Controller silently fails during deferred init.
- **ADR**: 0047

#### F5: `agentdb_health_report` — B3 not available

- **Error**: `"indexHealthMonitor not available"`
- **Controller**: B3 indexHealthMonitor
- **Root cause**: B3 is at Level 4 (deferred). During a single CLI `mcp exec` invocation, deferred init (levels 2+) runs in the background and does not complete before the tool handler executes. The controller is structurally correct (no constructor mismatch) but never ready in time.
- **ADR**: 0047

### 7 Degradations (tools that succeed with empty/wrong data)

#### D1: `agentdb_attention_compute` — empty results

- **Symptom**: `success: true`, `results: []`
- **Root cause**: Handler schema accepts `query`/`namespace`/`limit` but ignores the `entries` parameter from ADR-0044 spec. It performs a memory search against an empty namespace, returning nothing. Schema mismatch with spec.
- **ADR**: 0044

#### D2: `agentdb_attention_benchmark` — wrong dimensions

- **Symptom**: `success: true`, hardcoded `dim=64` instead of requested `768`
- **Root cause**: Handler schema defines `entryCount`/`blockSize`, not `dimensions`. The `dimensions` parameter is silently dropped. Flash output is 64 JS-fallback floats.
- **ADR**: 0044

#### D3: `agentdb_attention_configure` — read-only, ignores mechanism

- **Symptom**: `success: true`, `engine: "fallback"`, `initialized: false`
- **Root cause**: Handler schema has empty `properties: {}` — the `mechanism` parameter is silently ignored. The tool is read-only despite its name. No NAPI/WASM available, so engine is permanently "fallback".
- **ADR**: 0044

#### D4: `agentdb_embed` — zero-dimension embedding

- **Symptom**: `success: true`, `embedding: []`, `dimension: 0`, `provider: "unknown"`
- **Root cause**: Registry imports `agentdb.EnhancedEmbeddingService` which resolves to the 143-line WASM wrapper (controllers/), not the 1436-line full implementation (services/). The wrapper has no multi-provider support, no LRU cache, no dimension alignment. Returns zeroed data.
- **ADR**: 0045 (swarm bug #9)

#### D5: `agentdb_embed_status` — contradicts health

- **Symptom**: `active: false`, `"EnhancedEmbeddingService not active"`
- **Root cause**: Health report shows `enhancedEmbeddingService` as `enabled: true` at Level 3, but `bridgeHasController()` returns false. Inconsistent readiness signals — the controller is registered but the bridge checks a different readiness flag.
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
| 1 | learningBridge | 0040 | No backend configured; blocks filtered_search |
| 2 | selfLearningRvfBackend | 0046 | Factory calls `new SLRB(config)` but private ctor expects `(RvfBackend, config)` — needs `SelfLearningRvfBackend.create()` |
| 2 | nativeAccelerator | 0046 | `@ruvector/*` packages not installed — expected, JS fallbacks work |
| 2 | quantizedVectorStore | 0047 | Missing required `quantizationType` field in constructor config |
| 3 | auditLogger | 0045 | `AuditLogger` not exported from `agentdb/src/index.ts` — factory always gets `undefined` |
| 4 | indexHealthMonitor | 0047 | Deferred init (Level 4) doesn't complete during single CLI invocation |
| 4 | federatedLearningManager | 0047 | `FederatedLearningManager` not exported from `agentdb/src/index.ts` |
| 4 | attentionMetrics | 0044 | D2 constructor mismatch or import failure at Level 4 |
| 2 | gnnService (anomaly) | — | `enabled: true` but `available: false` internally — inconsistent status |

### 3 Cross-cutting issues

#### X1: CLI `--args` flag silently dropped

The `mcp exec` subcommand accepts `--params` / `-p` for tool parameters. The `--args` flag is silently ignored with no warning, causing tools to receive `{}` input and produce misleading "namespace required" errors. Unknown flags should produce an error.

#### X2: `success: false` returns exit code 0

Tools returning `{ success: false, error: "..." }` still exit with code 0. Under fail-loud mode, MCP tools that detect controller failures should propagate as exit code 1 so CI/scripts can catch them.

#### X3: 3 attention tool schemas don't match ADR-0044 spec

- `attention_compute`: spec uses `entries`, schema has `query`/`namespace`/`limit`
- `attention_benchmark`: spec uses `dimensions`, schema has `entryCount`/`blockSize`
- `attention_configure`: spec uses `mechanism`, schema has empty `properties: {}`

## Decision: Pseudocode (SPARC-P)

No pseudocode — this ADR is a defect catalog, not an implementation plan. Fixes are tracked individually below.

## Decision: Architecture (SPARC-A)

### Defect categories and fix owners

| Category | Count | Fix approach |
|----------|:-----:|-------------|
| Constructor mismatch (registry passes wrong args) | 3 | Update factory in controller-registry.ts |
| Not exported from agentdb barrel | 2 | Add export lines to agentic-flow fork |
| Schema/spec mismatch (MCP handler ignores params) | 3 | Update handler schemas in agentdb-tools.ts |
| Wrong class imported | 1 | Change import target in registry factory |
| Deferred init timing | 1 | Either lower B3 to Level 1 or await deferred in handler |
| Missing input validation | 1 | Add null check in hooks_route handler |
| Undocumented dependency | 1 | Remove learningBridge dependency from filtered_search bridge |
| No instrumentation wired | 2 | Wire telemetry calls into controller init and bridge ops |
| CLI UX (silent flag drop) | 1 | Reject unknown flags in mcp exec command parser |
| Exit code propagation | 1 | Return exit code 1 when tool result has `success: false` |

## Decision: Refinement (SPARC-R)

### Priority tiers

**Tier 1 — Fix immediately (blocks core functionality)**

| ID | Defect | Effort |
|----|--------|--------|
| F1 | hooks_route null deref | ~10 lines |
| F2 | filtered_search depends on learningBridge | ~15 lines |
| F4 | B9 missing `quantizationType` | ~2 lines |
| D4 | A9 imports wrong EnhancedEmbeddingService class | ~3 lines (change import) |

**Tier 2 — Fix soon (features inert but not crashing)**

| ID | Defect | Effort |
|----|--------|--------|
| F3 | D2 attentionMetrics constructor/import | ~5 lines |
| D5 | A9 embed_status contradicts health | ~10 lines (align readiness check) |
| X1 | CLI `--args` silent drop | ~10 lines (reject unknown flags) |
| X3 | 3 attention schema/spec mismatches | ~30 lines (update handler schemas) |

**Tier 3 — Fix later (improvements, not broken)**

| ID | Defect | Effort |
|----|--------|--------|
| F5 | B3 deferred init timing | Architecture decision: move level or add await |
| D6/D7 | Telemetry empty (no instrumentation) | ~50 lines (wire spans into init + bridge) |
| X2 | Exit code propagation | ~15 lines in mcp exec handler |
| — | Export D3 AuditLogger from agentdb | ~1 line in agentic-flow fork |
| — | Export A11 FederatedLearningManager from agentdb | ~1 line in agentic-flow fork |

## Decision: Completion (SPARC-C)

### Checklist

- [ ] Tier 1: Fix hooks_route null deref (F1)
- [ ] Tier 1: Remove learningBridge dependency from bridgeFilteredSearch (F2)
- [ ] Tier 1: Add `quantizationType: 'scalar8bit'` to B9 factory (F4)
- [ ] Tier 1: Change A9 factory to import services-level EnhancedEmbeddingService (D4)
- [ ] Tier 2: Fix D2 attentionMetrics factory (F3)
- [ ] Tier 2: Align A9 embed_status readiness check with health (D5)
- [ ] Tier 2: Reject unknown flags in `mcp exec` (X1)
- [ ] Tier 2: Update 3 attention tool handler schemas (X3)
- [ ] Tier 3: Resolve B3 deferred init timing (F5)
- [ ] Tier 3: Wire D1 telemetry into controller init and bridge ops (D6/D7)
- [ ] Tier 3: Propagate `success: false` as exit code 1 (X2)
- [ ] Tier 3: Export AuditLogger from agentdb (D3 disabled)
- [ ] Tier 3: Export FederatedLearningManager from agentdb (A11 disabled)
- [ ] Run `npm run deploy` after each tier — verify 55/55 acceptance
- [ ] Run full MCP tool validation against ~/src/test after all tiers

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
- Total fix effort estimated at ~150 lines across 3 files + 2 fork export lines

### Risks

- Tier 1 fixes may introduce new failures if constructor signatures aren't carefully verified
- B3 deferred init timing (F5) may require architectural change to ADR-0048's deferred init strategy
- Attention schema fixes (X3) may break existing callers that rely on current parameter names

## Related

- **ADR-0049**: Fail-loud mode (prerequisite — made these defects visible)
- **ADR-0040 through ADR-0047**: The 8 ADRs whose implementations contain these defects
- **ADR-0048**: Lazy controller initialization (deferred init causes F5)
- **Swarm audit 2026-03-17**: 8-agent code analysis that found 29 bugs; this ADR confirms 7 at runtime
