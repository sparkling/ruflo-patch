# Telemetry & Observability Soundness Audit (Slice 05)

Second-pass audit (G-16-006 [HIGH]). Scope: telemetry/logging/tracing/metrics
infrastructure across `forks/ruflo` + `forks/agentdb`. Verifies whether the
instrumentation behind the `ruflo-observability:observability-engineer` agent
and `observe-trace` / `observe-metrics` skills, plus the
`mcp__ruflo__agentdb_telemetry_*` and `mcp__ruflo__*_status` MCP tools,
actually produces real data, or is API-only.

## Summary

The observability surface is **structurally a stub**. There is an OpenTelemetry
scaffold (`forks/agentdb/src/observability/{telemetry,integration}.ts`,
~580 LOC, exporting `TelemetryManager`, `withTelemetry`, `withSpan`,
`recordMetric`, `recordCacheAccess`, `recordErrorWithContext`, and a `@traced`
decorator). The scaffold is exported from `forks/agentdb/src/index.ts:46`
**and has zero call sites in either fork's source tree.** Tracing the
end-to-end `memory_store` path:

```
mcp__ruflo__memory_store
  → cli/src/mcp-tools/memory-tools.ts:174   (no telemetry call)
    → archivist.dispatch('memory_store')    (no telemetry call)
      → agentdb/src/archivist/handlers/memory/store.ts:103 (no telemetry call)
        → ctx.substrate.withWrite(...)      (no telemetry call)
          → RvfHandle.insertAsync(...)      (no telemetry call)
```

No span starts, no histogram records, no counter increments anywhere on the
path. The `memory-tools.ts` handler captures `performance.now()` duration
(line 278, 301) and surfaces it as `storeTime: "Xms"` in the response
envelope — never recorded to a histogram.

`agentdb_telemetry_metrics` and `agentdb_telemetry_spans` (cli/src/mcp-tools/
agentdb-tools.ts:1589, 1618) resolve `getController('telemetryManager')`,
which the controller-registry binds to `agentdb.TelemetryManager.getInstance()`
(controller-registry.ts:2225-2236). **The bound class has no `getMetrics` or
`getSpans` method.** The MCP tools always fall through to the `getMetrics not
available` / `No span instrumentation wired` notice branch. The notice text is
honest, but the tools cannot ever return real data against this implementation.

The `observe-trace` / `observe-metrics` skills read from
`memory_search --namespace observability`. **No code writes to that
namespace.** The skill is an empty contract: the schema is documented in
`agents/observability-engineer.md`, but no producer exists.

The OpenTelemetry SDK is wired into `optionalDependencies`
(`@opentelemetry/sdk-node`, `@opentelemetry/resources`,
`@opentelemetry/semantic-conventions`). Even when `NODE_ENV=production` flips
`enabled=true` and the SDK loads, **no exporter, no SpanProcessor, no
MeterProvider, and no instrumentation are wired** (telemetry.ts:144-147 ships
`instrumentations: []`). Traces and metrics created by the API have no path
out of the process.

Real defects beyond "not wired":

1. **F-05-001 (HIGH)** — `mcp/server-entry.ts:140-162` `createLogger` uses
   `console.info` / `console.debug` for info/debug levels, with default
   `transport: stdio` and default `logLevel: info`. These log lines go to
   **stdout** of an stdio JSON-RPC transport. `server.on('tool:called', ...)`
   logs the entire `data` payload (memory key, value, namespace, tags,
   filter predicates) at debug level. Stdout pollution on stdio MCP is the
   exact failure mode `feedback-no-fallbacks` calls out ("agentdb
   diagnostics → stderr"), and the payload-as-data log field is PII
   leakage.

2. **F-05-002 (HIGH)** — `agentdb/src/mcp/agentdb-mcp-server.ts:2016` writes
   `console.log("🎓 Training session ${sessionId}...")` from an
   `StdioServerTransport` MCP server (line 2299). Single stdout corruption
   site, but unambiguous: `learning_train` calls produce non-JSON-RPC bytes
   on the protocol channel. The rest of the file uses `console.error`
   correctly (21 stderr sites vs 1 stdout site).

3. **F-05-003 (HIGH)** — `MCPTool` `agentdb_telemetry_metrics` /
   `agentdb_telemetry_spans` are dead surface. They surface a notice
   string that misrepresents the architecture: "Counters require explicit
   startSpan/increment calls from controller operations." This implies the
   wiring exists and just isn't called. It doesn't: the bound class has no
   `getMetrics` / `getSpans` methods, and the API design (counters with
   string keys, single-process spans) doesn't match what an OpenTelemetry
   `Meter` / `Tracer` can introspect anyway.

4. **F-05-004 (MEDIUM)** — `TelemetryManager.recordError`
   (telemetry.ts:282-286) accepts a free-text `message` and writes it as a
   metric label. Error messages from production callers commonly include
   formatted user input, file paths, key names, and content fragments.
   This is a **cardinality bomb** — every distinct error message creates a
   new metric series. Same pattern in `recordErrorWithContext`
   (integration.ts:185-189) which writes `error.message` to a counter
   label.

5. **F-05-005 (MEDIUM)** — `TelemetryManager.recordOperation`
   (telemetry.ts:295-299) labels the operation counter with
   `result_size: resultSize?.toString()`. Result sizes (byte counts, row
   counts) are effectively unbounded distinct values. Second cardinality
   bomb on the same metric instrument.

6. **F-05-006 (MEDIUM)** — `createSpanAttributes` (integration.ts:164-166)
   serializes arbitrary `context.filters` via `JSON.stringify` and attaches
   to `db.filters` as a span attribute. If callers pass user-derived filter
   predicates (e.g. metadata filters from `agentdb_filtered_search`), the
   filter object — which can include user keys, value patterns, or PII
   field expressions — lands verbatim in the trace. Latent risk because no
   caller exists, but the API surface is unsafe by design.

7. **F-05-007 (MEDIUM)** — `EmbeddingService` / `db-unified.ts` /
   `core/AgentDB.ts` / `backends/factory.ts` / `archivist/handlers/
   daemons/hooks-learning.ts` collectively contain 60+ `console.log` calls
   (28 in `db-unified.ts` alone). These run in the cli daemon process,
   which is **separate** from the MCP stdio transport — so they don't
   corrupt JSON-RPC. But they're unstructured, no level discriminator, no
   namespace, no correlation ID — they bypass the (already-unused)
   `TelemetryManager` entirely and write directly to whichever stream is
   default (`stdout` for `console.log`). If the daemon process is ever
   re-fronted with a stdio adapter (the agentdb-mcp-server pattern), they
   become protocol corruption.

8. **F-05-008 (MEDIUM)** — `withSpan` and `withTelemetry`
   (telemetry.ts:486-535, integration.ts:13-77) swallow `try/catch` errors
   on `span.setStatus`, `span.recordException`, and `span.end` with
   `// Ignore span errors` comments. This is reasonable for telemetry
   isolation, but the same wrapper also catches and **re-throws** the
   underlying operation's error in the `catch` block — meaning telemetry
   that fails to record an error still propagates the original. Sound,
   but `feedback-best-effort-must-rethrow-fatals` argues a span-close
   failure is itself a telemetry-correctness fatal that should surface.
   Lower priority because no caller exists.

9. **F-05-009 (LOW)** — `agentdb_resource_usage`, `agentdb_circuit_status`,
   `agentdb_rate_limit_status`, `agentdb_query_stats` (agentdb-tools.ts:
   1399, 1420, 1378, 1500) DO surface real data — these controllers
   (`resourceTracker`, `circuitBreakerController`, `rateLimiter`,
   `queryOptimizer`) maintain their own in-process stats and expose
   `getStats()` / `getCacheStats()`. The MCP tools wire correctly. But
   these are point-in-time controller status, not time-series telemetry
   — they cannot answer "what was the p95 query latency in the last
   hour", which is what the `observe-metrics` skill claims to answer.

10. **F-05-010 (LOW)** — `ObservabilitySpanAdapter`
    (plugins/ruflo-graph-intelligence/src/adapters/observability-span-adapter.ts:40)
    requires an `ObservabilitySpanSource` implementation. The only
    `listSpans` implementations are in
    `tests/phase3-adapters.test.ts:163, 182, 201` — three hand-rolled test
    fakes. No production code implements it. The adapter is wired into
    the registry (`adapters/index.ts:40`) as part of a sublinear graph
    analytics pipeline but cannot run.

11. **F-05-011 (INFO)** — `recordCacheHit` / `recordCacheMiss`
    (telemetry.ts:259-274) extract a `key_type` from cache keys via
    `getKeyType` (line 311), which only recognises prefixes `query:`,
    `skill:`, `episode:`. The agentdb cache keys observed elsewhere use
    `id` shapes like `${namespace}:${key}` and SHA hashes — they would
    all be bucketed as `'other'`. Cardinality-safe; usefulness-low. Not a
    defect; flagged for completeness.

## Findings

### F-05-001 [HIGH] mcp/server-entry.ts logger writes info/debug to stdout on stdio transport, with full tool payloads at debug

- File: `/Users/henrik/source/forks/ruflo/v3/mcp/server-entry.ts:140-162` and `:281-291`
- Sound: NO — `console.info` and `console.debug` write to stdout. The default `transport` is `stdio` (line 38) and default `logLevel` is `info` (line 42). The "tool:called" debug event (line 282) logs the entire `data` object, which for `memory_store` includes `key`, `value`, `namespace`, and `tags` — all user-controlled, possibly PII.
- Complete: NO — no PII redaction, no stream selection by transport, no opt-out for stdio.
- Evidence:

```
const formatMessage = (logLevel: string, msg: string, data?: unknown): string => {
  const timestamp = new Date().toISOString();
  const dataStr = data ? ` ${JSON.stringify(data)}` : '';
  return `[${timestamp}] [${logLevel.toUpperCase()}] ${msg}${dataStr}`;
};

return {
  // ...
  info: (msg, data) => { if (shouldLog('info')) console.info(formatMessage('info', msg, data)); },
  // ...
};

// then:
server.on('tool:called', (data) => { logger.debug('Tool called', data); });
```

  - `console.info` / `console.debug` are Node aliases for `console.log` — stdout.
  - At default `info` level the `tool:called` debug doesn't fire, but `info` events fire ("Session created", "MCP Server listening on..."). The MCP JSON-RPC initialize handshake competes with these `[ISO-timestamp] [INFO] Starting Claude-Flow MCP Server V3 {"transport":"stdio",...}` lines on the same fd.
  - At `logLevel: 'debug'` the `tool:called` line leaks every memory_store payload to stdout.

- Suggestion: For `stdio` transport, route all logger output to stderr (Node's `console.error` writes to stderr). Forbid `console.log` outside the JSON-RPC writer at line 273. Add a PII redaction step that drops `value` / `content` fields from log payloads regardless of transport.

### F-05-002 [HIGH] agentdb-mcp-server learning_train writes "Training session..." to stdout in stdio transport

- File: `/Users/henrik/source/forks/agentdb/src/mcp/agentdb-mcp-server.ts:2016` (single `console.log` site; transport confirmed stdio at line 9 / 2299)
- Sound: NO — `StdioServerTransport.connect()` (line 2299) treats stdout as the JSON-RPC channel; a `console.log` between request and response corrupts the framing.
- Complete: NO — this is the only `console.log` in the file (21 `console.error` sites elsewhere correctly use stderr). The slip looks like a missed lint pass.
- Evidence:

```
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
// ...
case 'learning_train': {
  // ...
  console.log(`🎓 Training session ${sessionId}...`);
  const result = await learningSystem.train(...);
```

- Suggestion: Replace with `console.error` (stderr) or remove. Add an ESLint rule `no-console.log` (allow `.error` / `.warn`) for `forks/agentdb/src/mcp/**` and `forks/ruflo/v3/mcp/**`.

### F-05-003 [HIGH] agentdb_telemetry_{metrics,spans} MCP tools are permanently dead — TelemetryManager has no getMetrics / getSpans

- File: `/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/agentdb-tools.ts:1589-1641` (tool handlers); `/Users/henrik/source/forks/agentdb/src/observability/telemetry.ts:78-344` (bound class, no getMetrics / getSpans methods exist); `/Users/henrik/source/forks/ruflo/v3/@claude-flow/memory/src/controller-registry.ts:2225-2236` (controller binds `TelemetryManager.getInstance()`).
- Sound: NO — `typeof ctrl.getMetrics === 'function'` is always false; the tools always return the "not available" notice.
- Complete: NO — there is no implementation behind the surface and no plan in the code to add one. The notice text ("Counters require explicit startSpan/increment calls from controller operations") implies wiring exists in some controllers and just isn't called — but **no controller in the audited tree calls `telemetryManager.startSpan()` or `recordMetric()`**.
- Evidence:

```
// agentdb-tools.ts:1596-1612
handler: async () => {
  const ctrl = await getController<any>('telemetryManager');
  if (!ctrl) return { success: false, error: 'TelemetryManager not available' };
  const result = typeof ctrl.getMetrics === 'function'
    ? { success: true, metrics: ctrl.getMetrics() }
    : { success: false, error: 'getMetrics not available' };  // <- always this branch
  // ...
}

// agentdb/src/observability/telemetry.ts class TelemetryManager has:
//   initialize, getTracer, startSpan, recordQueryLatency, recordCacheHit,
//   recordCacheMiss, recordError, recordOperation, getKeyType, shutdown,
//   isEnabled, resetStats
// — no getMetrics(), no getSpans().
```

- Suggestion: Either implement `getMetrics()` / `getSpans()` on TelemetryManager (would require adding an in-process span/metric ring buffer — OpenTelemetry's `Tracer` / `Meter` don't natively support introspection), or delete the two MCP tools and replace the agent/skill references with the controller-stat tools (`agentdb_resource_usage`, `agentdb_query_stats`, etc.) that DO surface real data.

### F-05-004 [MEDIUM] TelemetryManager.recordError writes error message as a metric label — unbounded cardinality

- File: `/Users/henrik/source/forks/agentdb/src/observability/telemetry.ts:279-287`; also `recordErrorWithContext` at `/Users/henrik/source/forks/agentdb/src/observability/integration.ts:185-189`.
- Sound: NO — every distinct error message creates a new metric series. OpenTelemetry metric backends (Prometheus, OTLP receivers) typically cap label cardinality and either drop series or OOM.
- Complete: PARTIAL — the `errorType` (Error class name) is bounded; the `operation` is bounded; only `message` is unsafe.
- Evidence:

```
public recordError(errorType: string, operation: string, message?: string): void {
  if (!this.config.enabled || !this.errorCounter) return;
  this.errorCounter.add(1, {
    error_type: errorType,
    operation,
    message: message || 'unknown',  // <- unbounded text as label
  });
}
```

- Suggestion: Drop `message` from labels. If a sample message is useful for debugging, attach it to a span exemplar instead. Document the cardinality contract in `TelemetryConfig` JSDoc.

### F-05-005 [MEDIUM] TelemetryManager.recordOperation uses result_size (toString) as label — second cardinality bomb

- File: `/Users/henrik/source/forks/agentdb/src/observability/telemetry.ts:292-306`
- Sound: NO — same pattern as F-05-004 but on the `operations` counter. Distinct byte counts or row counts each become their own metric series.
- Evidence:

```
this.operationCounter.add(1, {
  operation_type: operationType,
  table_name: tableName || 'unknown',
  result_size: resultSize?.toString() || '0',  // <- distinct numeric values as labels
});
```

- Suggestion: Use a histogram (`agentdb.operation.result_size`) for the magnitude, keep the operation counter labels bounded (`operation_type`, `table_name` only).

### F-05-006 [MEDIUM] createSpanAttributes JSON-stringifies arbitrary filter predicates into span attributes — latent PII leak

- File: `/Users/henrik/source/forks/agentdb/src/observability/integration.ts:149-175`
- Sound: NO — `JSON.stringify(context.filters)` serialises whatever predicate the caller passed. Memory queries with `$regex` over user content, or `$eq` over memory keys, embed the user-controlled value verbatim in the span.
- Complete: N/A — no production caller, so no realised PII exposure today. The helper is API design; the risk activates the moment any handler wires it.
- Evidence:

```
if (context.filters) {
  attributes['db.filters'] = JSON.stringify(context.filters);
}
```

- Suggestion: Drop `filters` from attributes. If filter shape is useful, write a structural hash (e.g. `Object.keys(filters).sort().join(',')`) instead of the values.

### F-05-007 [MEDIUM] db-unified.ts + core paths use console.log for emoji-decorated init banners (60+ sites)

- File: `/Users/henrik/source/forks/agentdb/src/db-unified.ts` (28 sites: `67, 75, 79, 85, 86, 91, 100, 104, 126-140, 162, 182, ...`), `/Users/henrik/source/forks/agentdb/src/core/AgentDB.ts:157, 191`, `/Users/henrik/source/forks/agentdb/src/backends/factory.ts:211, 216, 237, 250, 251`, and ~16 other files (`grep -rln "console\.log" forks/agentdb/src/` returns ~20 files).
- Sound: PARTIAL — these run in the cli daemon process (separate from the MCP stdio transport), so they don't corrupt JSON-RPC. But there's no transport guard: if these init paths are ever exercised inside the MCP server boot (e.g. archivist construction triggered by first MCP call), they go to stdout.
- Complete: NO — unstructured, no log level, no correlation ID, bypasses the TelemetryManager entirely. The `db-unified.ts` console.log noise has been observed surfacing in test stdout (per the prior `feedback-no-fallbacks` memory's "agentdb diagnostics → stderr" rule).
- Evidence (sample):

```
forks/agentdb/src/db-unified.ts:126-130
  console.log('✅ RuVector GraphDatabase ready (Primary Mode)');
  console.log('   - Cypher queries enabled');
  console.log('   - Hypergraph support active');
  console.log('   - ACID transactions available');
  console.log('   - 131K+ ops/sec batch inserts');
```

- Suggestion: Lift the rule from `feedback-no-fallbacks` ("agentdb diagnostics → stderr") into a fork-level lint: ban `console.log` in `forks/agentdb/src/**` except behind a transport guard. Convert to `console.error`. Long-term, route through a logger that respects `MCP_DEBUG` env.

### F-05-008 [MEDIUM] withSpan / withTelemetry swallow span lifecycle errors silently — telemetry-correctness fatals hidden

- File: `/Users/henrik/source/forks/agentdb/src/observability/telemetry.ts:425-477` (`traced` decorator + finally block), `:496-534` (`withSpan` finally); `/Users/henrik/source/forks/agentdb/src/observability/integration.ts:21-77` (`withTelemetry`).
- Sound: PARTIAL — the underlying operation error is correctly re-thrown. But `try { span.setStatus(...) } catch { /* Ignore span errors */ }` and `try { span.end() } catch { /* Ignore */ }` mean a broken telemetry SDK silently produces missing-data traces with no diagnostic.
- Complete: N/A — no production caller, so latent.
- Evidence:

```
} finally {
  if (span && span.end) {
    try { span.end(); } catch { /* Ignore span errors */ }
  }
}
```

- Suggestion: At minimum, increment a `telemetry.self_errors` counter (no labels) on each swallowed error. Per `feedback-best-effort-must-rethrow-fatals`, distinguish "span SDK broke" from "underlying op succeeded" — the former should warn on stderr.

### F-05-009 [LOW] agentdb_resource_usage / circuit_status / rate_limit_status / query_stats DO surface real data — but they're point-in-time controller stats, not time-series telemetry

- Files:
  - `/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/agentdb-tools.ts:1378-1395` (`agentdb_rate_limit_status` — `rateLimiter.getStats()`)
  - `:1399-1415` (`agentdb_resource_usage` — `resourceTracker.getStats()`)
  - `:1420-1436` (`agentdb_circuit_status` — `circuitBreakerController.getStats()`)
  - `:1500-1525` (`agentdb_query_stats` — `queryOptimizer.getCacheStats()`)
- Sound: YES — the four controllers expose real in-process stats and the MCP tools wire correctly.
- Complete: PARTIAL — these are snapshots, not time-series. They cannot answer "what was the p95 query latency over the last hour" (which the `observe-metrics` skill claims as its purpose). For that, the TelemetryManager histograms would need to be live AND a metric-pull endpoint (Prometheus or OTLP) would need to be reachable — neither is true (F-05-003).
- Suggestion: Document on the `observability-engineer.md` agent and `observe-metrics` skill that the realistic capability is "controller-stat snapshots", not "histogram aggregates". Or wire a polling helper that periodically dumps `getStats()` to the `observability` memory namespace, so the `observe-metrics` skill's `memory_search` actually has data to read.

### F-05-010 [LOW] ObservabilitySpanAdapter requires an ObservabilitySpanSource — only test fakes implement it

- File: `/Users/henrik/source/forks/ruflo/plugins/ruflo-graph-intelligence/src/adapters/observability-span-adapter.ts:40` (class; constructor at :49 takes `source: ObservabilitySpanSource`).
- Sound: PARTIAL — class implementation is correct; the interface contract is correct.
- Complete: NO — the only implementations of `ObservabilitySpanSource.listSpans` live in `tests/phase3-adapters.test.ts:163, 182, 201` (three hand-rolled fakes returning hardcoded span arrays). No production source exists.
- Suggestion: Wire `ObservabilitySpanSource` to the `agentdb_telemetry_spans` MCP tool — once that tool actually returns spans (F-05-003), the adapter becomes usable. Until then, document the adapter as test-only or remove from the public adapter registry.

### F-05-011 [INFO] recordCacheHit getKeyType only recognises three prefixes — all real cache keys bucket as 'other'

- File: `/Users/henrik/source/forks/agentdb/src/observability/telemetry.ts:259-274` + `:311-316`
- Sound: PARTIAL — function works; cardinality is safe.
- Complete: PARTIAL — recognises `query:`, `skill:`, `episode:`; real agentdb cache keys use `${namespace}:${key}` shapes or SHA hashes, so they all bucket as `'other'`. The metric label loses all discriminating information.
- Suggestion: Either expand the prefix list to match the actual cache-key conventions (`memory:`, `embedding:`, `pattern:`, `causal:`, `hierarchical:`, ...) or remove the `key_type` label entirely.

## Cross-cutting observations

1. **API surface vs instrumentation gap is total.** TelemetryManager exports
   `withSpan`, `withTelemetry`, `recordMetric`, `@traced` — none are imported
   outside `observability/integration.ts` itself. The agent
   (`observability-engineer.md`) and skills (`observe-trace`,
   `observe-metrics`) document an OpenTelemetry-compatible span/metric model
   and even publish a JSON schema for log entries — but the producer side is
   uninstrumented. The reader side
   (`memory_search --namespace observability`) reads from an empty namespace.
   The gap is API-vs-implementation in the strict ADR-0082 / `feedback-no-fallbacks`
   sense: the surface succeeds (skill runs, MCP tool responds), but the
   feature is broken (no real data).

2. **No structured logger anywhere.** No winston, no pino — confirmed by
   `grep -l winston|pino` returning only lockfiles. The closest is the
   inline `createLogger` in `v3/mcp/server-entry.ts:126` which is a thin
   `console.*` wrapper and routes the wrong streams (F-05-001). The cli's
   `mcp-server.ts:524-575` correctly puts JSON-RPC on stdout and
   diagnostics on stderr — but other paths (db-unified, core/AgentDB,
   backends/factory) use `console.log` indiscriminately.

3. **OpenTelemetry SDK is in `optionalDependencies` and `instrumentations: []`.**
   Even with the SDK installed and `NODE_ENV=production`, the
   `NodeSDK({ resource, instrumentations: [] })` call wires no exporter, no
   span processor, no metric exporter. Spans created via `tracer.startSpan`
   would be no-op spans; metric counters would record into thin air. The
   `prometheusEnabled: true` default at line 67 is not honoured — no
   PrometheusExporter is constructed. `otlpTraceEndpoint` / `otlpMetricsEndpoint`
   defaults exist but no OTLP exporter is plumbed.

4. **PII risk is API-shaped, not realised today.** `recordError(message)`,
   `recordOperation(result_size)`, and `createSpanAttributes(filters)` are
   each unsafe-by-design — they accept high-cardinality / user-content
   fields as metric labels or span attributes. Today no caller invokes them,
   so no PII actually escapes. The risk activates when someone implements
   instrumentation against the existing API.

5. **stdio JSON-RPC corruption surface is small but present.** Two confirmed
   sites: `mcp/server-entry.ts` createLogger info/debug (default-on, every
   tool call at debug; F-05-001) and `agentdb-mcp-server.ts:2016` learning_train
   stdout (rare path; F-05-002). 60+ `console.log` calls in agentdb cli
   paths (F-05-007) are daemon-side today — not corrupting MCP — but the
   pattern is unguarded and will corrupt if the daemon is re-fronted.

6. **The "real observability" today is controller-stat snapshots.**
   `agentdb_resource_usage`, `agentdb_circuit_status`,
   `agentdb_rate_limit_status`, `agentdb_query_stats` work. They report
   current bucket fills, failure counts, cache stats. They're sufficient
   for ops dashboards but cannot answer time-series questions. The
   `observe-metrics` skill should be re-pointed at these tools, with the
   caveat that "metric history" requires explicit polling-into-memory.

## Out-of-scope (not assessed in this slice)

- Cost-tracker plugin (`forks/ruflo/plugins/ruflo-cost-tracker/scripts/track.mjs`)
  — has its own metrics path, not in scope for telemetry.
- `forks/ruvector` and `forks/agentic-flow` — out of slice (memory says
  ruvnet/agentic-flow is canonical for RVF substrate logic but not for the
  ruflo-side observability layer).
- `archive/v2/benchmark/reports/metrics_*.json` — legacy benchmark output,
  not live telemetry.
- `forks/ruflo/v3/@claude-flow/plugin-iot-cognitum` (telemetry-ingest-worker
  + telemetry-ingestion-service) — a separate domain plugin that ingests
  external device telemetry, not internal observability.
- `forks/ruflo/scripts/track-clones.mjs` — npm download tracker, not
  runtime observability.
- Performance of the (unused) OpenTelemetry SDK initialisation cost — even
  if the SDK loaded successfully, it currently produces no data, so its
  perf cost is moot.
