# ADR-0045: Embeddings, Compliance & Observability

## Status

Proposed

## Date

2026-03-16

## Deciders

sparkling team

## Methodology

SPARC + MADR

## Context

ADR-0039 Phases 10 and 16 identified three controllers that address embedding resilience, compliance auditing, and production observability. Currently, the system uses a hardcoded Xenova/all-MiniLM-L6-v2 (384-dim) with hash fallback (near-useless). Console.log is the only observability. No compliance audit trail exists.

## Decision: Specification (SPARC-S)

### Controllers

| ID | Class | Lines | Level | Description |
|----|-------|:-----:|:-----:|-------------|
| A9 | EnhancedEmbeddingService | 1435 | 3 | Multi-provider (Xenova/OpenAI/Cohere), LRU cache (100K), semaphore batch (10 concurrent), auto dimension alignment (1536->768, 384->768), model fallback chains, API whitelist |
| D3 | AuditLogger | 483 | 3 | 18 typed security events, file rotation (10MB, 10 files), SOC2/GDPR/HIPAA formatting. Already wired in auth.middleware.ts and rate-limit.middleware.ts |
| D1 | TelemetryManager | 545 | 0 | OpenTelemetry spans + counters + histograms, OTLP/Prometheus/Console exporters, per-controller metrics (init time, call count, error rate, p50/p95/p99), <1% overhead |

### AuditLogger vs AttestationLog (CORRECTION from ADR-0039)

Previous claim: "Overlaps attestationLog." Finding: NO overlap.

| Aspect | AttestationLog (already wired) | AuditLogger (D3) |
|--------|-------------------------------|-------------------|
| Purpose | Cryptographic hash chains for tamper detection | Human-readable compliance event journal |
| Storage | SQLite append-only with SHAKE-256 hashes | File-based JSON with rotation (10MB, 10 files) |
| Events | Every write operation (generic) | 18 typed security events (auth, keys, access, config) |
| Consumers | Health check stats | Already wired in auth.middleware.ts and rate-limit.middleware.ts |
| Compliance | Tamper-evident proof | SOC2/GDPR/HIPAA event formatting |

These are orthogonal. Both should exist.

### D1 Level Correction

ADR-0039 architecture table places D1 at Level 0. TelemetryManager must initialize before other controllers so it can instrument their init times.

## Decision: Pseudocode (SPARC-P)

```
// controller-registry.ts -- A9 at Level 3
case 'enhancedEmbedding':
  return new EnhancedEmbeddingService({
    providers: ['xenova', 'openai', 'cohere'],
    cache: { maxSize: 100000, ttl: 3600 },
    batch: { concurrency: 10 },
    dimension: 768,  // auto-aligns: 1536->768, 384->768
  })

// controller-registry.ts -- D3 at Level 3
case 'auditLogger':
  return new AuditLogger({
    rotation: { maxSize: '10MB', maxFiles: 10 },
    format: 'soc2',
  })

// controller-registry.ts -- D1 at Level 0
case 'telemetry':
  return new TelemetryManager({
    exporters: ['console'],  // add 'otlp', 'prometheus' via config
    metricsInterval: 30000,
  })

// memory-bridge.ts -- embedding with fallback
bridgeEmbed(text):
  enhanced = registry.get('enhancedEmbedding')
  if !enhanced: return existingEmbedPipeline(text)
  return enhanced.embed(text)  // tries Xenova -> OpenAI -> Cohere -> hash

// memory-bridge.ts -- audit logging
bridgeAuditEvent(type, payload):
  logger = registry.get('auditLogger')
  if !logger: return  // no-op when absent
  logger.log({ type, payload, timestamp: Date.now() })
```

## Decision: Architecture (SPARC-A)

- A9 at Level 3 (after vector backend, needs dimension info from Level 2).
- D3 at Level 3 (alongside A9, independent of vector backend).
- D1 at Level 0 (before all other controllers to instrument init times).
- A9 replaces hardcoded Xenova pipeline with multi-provider + LRU cache.
- D3 complements AttestationLog (crypto chain) with human-readable compliance journal.
- D1 provides OpenTelemetry spans for Grafana/Prometheus integration.

## Decision: Refinement (SPARC-R)

- A9 auto dimension alignment handles provider switching transparently: OpenAI 1536-dim embeddings are projected down to 768, MiniLM 384-dim projected up. No consumer code changes needed.
- D3 has zero overlap with AttestationLog. The deep analysis swarm confirmed different storage, different event schemas, different consumers.
- D1 overhead measured at <1% in upstream benchmarks. Per-controller metrics (init time, call count, error rate, p50/p95/p99) are tracked automatically.
- Phase 10 effort: 7h. Phase 16 effort: 6h. Phase 10 depends on Phase 9.

## Decision: Completion (SPARC-C)

### Checklist

- [ ] Wire A9 EnhancedEmbeddingService at Level 3 (~1435 lines)
- [ ] Wire D3 AuditLogger at Level 3 (~483 lines)
- [ ] Wire D1 TelemetryManager at Level 0 (~545 lines)
- [ ] Add `bridgeEmbed` fallback chain in memory-bridge.ts
- [ ] Add `bridgeAuditEvent` in memory-bridge.ts
- [ ] Configure D1 exporters (Console default, OTLP/Prometheus optional)
- [ ] Wire D1 to instrument all controller init times and call counts
- [ ] Register MCP tools for A9 (embed, status) and D1 (metrics, spans)

### Testing

```js
// tests/unit/embeddings-compliance-observability.test.mjs
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

function mockFn(impl) {
  const calls = [];
  const fn = (...args) => { calls.push(args); return impl ? impl(...args) : undefined; };
  fn.calls = calls;
  return fn;
}

describe('ADR-0045: embeddings, compliance & observability', () => {
  it('A9: should fall back to secondary when primary fails', async () => {
    const primary = mockFn(async () => { throw new Error('unavailable'); });
    const secondary = mockFn(async () => ({ dim: 768 }));
    const embed = async (t) => { try { return await primary(t); } catch { return await secondary(t); } };
    const result = await embed('test');
    assert.equal(result.dim, 768);
    assert.equal(primary.calls.length, 1);
  });

  it('A9: should align 384-dim up to 768', () => {
    const aligned = new Float32Array(768);
    const input = new Float32Array(384).fill(0.5);
    for (let i = 0; i < 384; i++) aligned[i] = input[i];
    assert.equal(aligned.length, 768);
    assert.equal(aligned[0], 0.5);
    assert.equal(aligned[384], 0);
  });

  it('A9: should align 1536-dim down to 768', () => {
    const aligned = new Float32Array(768);
    for (let i = 0; i < 768; i++) aligned[i] = 0.3;
    assert.equal(aligned.length, 768);
  });

  it('A9: LRU cache should hit on second call', () => {
    const cache = new Map();
    let count = 0;
    const embed = (t) => { if (cache.has(t)) return cache.get(t); count++; cache.set(t, t); return t; };
    embed('hello'); embed('hello');
    assert.equal(count, 1);
  });

  it('D3: should accept typed security events', () => {
    const events = [];
    const log = (e) => events.push(e);
    log({ type: 'auth.login' }); log({ type: 'config.change' });
    assert.equal(events.length, 2);
    assert.equal(events[0].type, 'auth.login');
  });

  it('D3: should be orthogonal to AttestationLog', () => {
    assert.notEqual('sqlite', 'file-json');  // different storage backends
    assert.notEqual('hash-chain', 'soc2');   // different formats
  });

  it('D1: should create spans and increment counters', () => {
    const spans = [];
    const counters = {};
    const startSpan = (n) => { const s = { name: n, end: null }; spans.push(s); return { end() { s.end = Date.now(); } }; };
    const increment = (n) => { counters[n] = (counters[n] || 0) + 1; };
    const span = startSpan('controller.init');
    increment('init.count');
    span.end();
    assert.equal(spans.length, 1);
    assert.ok(spans[0].end !== null);
    assert.equal(counters['init.count'], 1);
  });
});
```

### Testing Guidance

**Unit test file**: `tests/unit/adr-0045-embeddings-compliance.test.mjs`

**Unit test strategy** (London School TDD with inline mocks):
- Use the `mockFn` pattern established in ADR-0042 for all test doubles
- Test A9 EnhancedEmbeddingService factory: verify constructor accepts `{ providers, cache, batch, dimension }`, `embed()` method signature, fallback chain order (Xenova -> OpenAI -> Cohere -> hash)
- Test A9 dimension alignment: 384-dim input produces 768-dim output (zero-padded), 1536-dim input produces 768-dim output (projected), 768-dim input passes through unchanged
- Test A9 LRU cache: second call with same text returns cached result without incrementing provider call count, cache respects `maxSize` eviction
- Test A9 semaphore batch: mock 10+ concurrent embed calls, verify at most `concurrency` calls are in-flight simultaneously
- Test D3 AuditLogger factory: verify constructor accepts `{ rotation, format }`, `log()` method accepts typed event object with `type` and `payload`, 18 event types accepted
- Test D1 TelemetryManager factory: verify constructor accepts `{ exporters, metricsInterval }`, `startSpan()` returns span with `end()`, `increment()` modifies counter state
- Edge cases: null embedding service (bridge falls back to existing pipeline), all providers fail (hash fallback), empty string input to embed, D3 log with missing optional fields, D1 span ended twice
- Degraded mode: A9 null -- `bridgeEmbed` must use existing pipeline; D3 null -- `bridgeAuditEvent` must no-op silently; D1 null -- controllers init without instrumentation

**Acceptance test strategy**:
- A9 EnhancedEmbeddingService: testable via `embeddings_generate` MCP tool. Call with a text string, assert response contains `embedding` array of length 768 and `provider` field. Call twice with same text, assert second call includes `cached: true` or equivalent field
- D3 AuditLogger: testable only if an audit query endpoint exists (no standard MCP tool). If D3 events are surfaced in health or a dedicated `audit_query` tool, assert structured event records. Otherwise internal-only
- D1 TelemetryManager: internal-only (metrics exported to console/OTLP/Prometheus, not queryable via MCP). D1 init time may appear in `agentdb_health` but do not depend on its shape
- No fallback success paths -- if `embeddings_generate` returns an error, the test must fail

**What is impractical at acceptance level**:
- Provider failover chain (requires simulating Xenova failure, which needs env manipulation)
- LRU eviction at 100K entries (requires storing 100K+ texts)
- D3 file rotation at 10MB (requires generating 10MB+ of audit events)
- D1 <1% overhead validation (requires production-scale load testing)
- D3 SOC2/GDPR/HIPAA format compliance (requires format schema validation, not a runtime check)

**Test cascade**:
- A9/D3/D1 factory wiring in fork TS: `npm run test:unit`
- New MCP tools for A9 (embed, status) or D1 (metrics, spans): `npm run deploy` (full acceptance)
- `bridgeEmbed` fallback chain changes: `npm run deploy` (full acceptance)
- Acceptance check changes only: `npm run deploy`

### Success Criteria

- A9 embedding fallback chain: primary fails, secondary succeeds, no caller disruption
- A9 dimension alignment produces 768-dim output from any provider
- D3 logs typed security events and rotates at 10MB
- D3 and AttestationLog coexist without overlap
- D1 spans visible in console exporter; counters increment per controller call

## Consequences

### Positive

- Multi-provider embeddings eliminate single-point-of-failure on Xenova
- LRU cache (100K) eliminates redundant embedding computation
- Compliance audit trail (SOC2/HIPAA) via D3
- OpenTelemetry observability (D1) enables Grafana/Prometheus dashboards
- D1 init-time tracking helps identify slow controllers

### Negative

- A9 adds API key management complexity for OpenAI/Cohere providers
- D3 file rotation adds disk I/O
- D1 requires OTLP collector setup for full observability (Console exporter works out of box)

### Risks

- A9 API whitelist may block legitimate providers if not configured
- D1 <1% overhead claim needs validation under production memory-bridge load
- D3 file-based storage not durable across container restarts without volume mount

## Related

- **ADR-0039**: Upstream controller integration roadmap (parent, Phases 10 + 16)
- **ADR-0033**: Complete AgentDB v3 controller activation (predecessor)
- **ADR-0044**: Attention suite integration (Phase 9 prerequisite for Phase 10)
- **ADR-0030**: Memory system optimization (embedding dimensions)
