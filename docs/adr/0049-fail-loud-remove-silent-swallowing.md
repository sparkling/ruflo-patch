# ADR-0049: Fail Loud — Remove Silent Error Swallowing

## Status

Accepted

## Date

2026-03-17

## Deciders

sparkling team

## Methodology

SPARC + MADR

## Context

A swarm audit of ADR-0040 through ADR-0047 (8 agents, 29 bugs found) revealed a systemic problem: **every controller factory and bridge function silently swallows errors, returning `null` or fallback data**. This hides 13 constructor mismatches, 2 missing exports, 4 unwired integrations, and 6 missing features. All 240 unit tests pass, but the system runs entirely on legacy fallback paths at runtime.

### The numbers

| Layer | Silent catch blocks | Null-guard returns | Effect |
|-------|:-------------------:|:------------------:|--------|
| controller-registry.ts | 27 `catch { return null }` | ~40 | Broken factories return `null`, caller never knows why |
| memory-bridge.ts | 105 catch blocks | 84 | Broken controllers silently fall back to legacy path |
| **Total** | **132** | **~124** | **Every bug is invisible** |

### Why this matters

The graceful degradation pattern was designed for *optional* controllers that may not be installed. But it's being applied to *mandatory* integration points where failure means the feature doesn't work at all. The result:

1. Constructor mismatches (A1-A3, A5, A6, B5, B6, B9) silently return `null` — the controller appears "not available" instead of "broken"
2. Missing exports (D3, A11) silently return `null` — same symptom as a broken constructor
3. The CircuitBreaker (D6) exists but `wrap()` is never called — there's no error to even swallow
4. ResourceTracker (D4) `record(bytes)` is never called — usage is permanently 0
5. Developers can't distinguish "not installed" from "wiring bug" from "upstream API changed"

### Prior art

ADR-0048 (lazy controller initialization) added deferred init but preserved the silent swallowing. This ADR supersedes that approach for the factory and bridge layers.

## Decision: Specification (SPARC-S)

### Fail-loud mode

Add a `CLAUDE_FLOW_STRICT` environment variable (default: `true` in development, `false` in production). When strict mode is on:

1. **Controller factories** throw on construction failure instead of returning `null`
2. **Bridge functions** throw on controller absence instead of returning fallback data
3. **Init-level errors** are collected and reported as a single summary error after all levels complete
4. All errors include the controller name, factory line, and upstream class expected

When strict mode is off (production), the existing graceful degradation is preserved — but errors are **logged with full context** instead of silently swallowed.

### What changes

| Current | Strict mode ON | Strict mode OFF (production) |
|---------|---------------|------------------------------|
| `catch { return null }` | `catch (e) { throw new ControllerInitError(name, e) }` | `catch (e) { this.logInitError(name, e); return null }` |
| `if (!ctrl) return fallback` | `if (!ctrl) throw new ControllerNotAvailable(name)` | `if (!ctrl) { this.logMissing(name); return fallback }` |
| `catch () {}` (fire-and-forget) | Same (fire-and-forget is intentional) | Same |

### What does NOT change

- Fire-and-forget patterns (safeguard 4) — these are intentionally async/detached
- Health check aggregation — still collects per-controller status
- MCP tool error responses — still return `{ success: false, error }` to callers
- The `withBridgeSafeguards` timeout wrapper — still returns fallback on timeout

## Decision: Pseudocode (SPARC-P)

### controller-registry.ts changes

```
// New error classes
class ControllerInitError extends Error {
  constructor(name, cause) {
    super(`Controller '${name}' failed to initialize: ${cause.message}`)
    this.controllerName = name
    this.cause = cause
  }
}

// Replace: catch { return null }
// With:
catch (e) {
  const err = new ControllerInitError(name, e)
  if (this.strictMode) throw err
  this.emit('controller:init-error', { name, error: err })
  return null
}

// After all init levels complete, if strict mode:
if (this.strictMode && this.initErrors.length > 0) {
  const summary = this.initErrors.map(e => `  ${e.controllerName}: ${e.message}`).join('\n')
  throw new Error(`${this.initErrors.length} controller(s) failed to initialize:\n${summary}`)
}
```

### memory-bridge.ts changes

```
// New error class
class ControllerNotAvailable extends Error {
  constructor(name, bridgeFn) {
    super(`Controller '${name}' not available (called from ${bridgeFn})`)
    this.controllerName = name
    this.bridgeFunction = bridgeFn
  }
}

// Replace: if (!ctrl) return null
// With:
if (!ctrl) {
  const err = new ControllerNotAvailable(name, 'bridgeFilteredSearch')
  if (strictMode) throw err
  logMissing(name, 'bridgeFilteredSearch')
  return fallback
}
```

## Decision: Architecture (SPARC-A)

### Strict mode detection

```
const STRICT = process.env.CLAUDE_FLOW_STRICT !== 'false'
```

Default is `true` (strict). Production deployments set `CLAUDE_FLOW_STRICT=false` to preserve graceful degradation. This means development and testing always fail loud.

### Error event bus

All swallowed errors (in non-strict mode) emit events on the registry's EventEmitter:
- `controller:init-error` — factory threw during construction
- `controller:missing` — bridge function couldn't find expected controller
- `controller:api-mismatch` — controller exists but method call failed

These events can be collected by D1 TelemetryManager (when it works) or by a simple console logger.

### Init error collection

During `initializeControllers()`, errors are collected per-level rather than thrown immediately. After all levels complete, the collected errors are:
- **Strict mode**: thrown as a single summary error
- **Non-strict mode**: emitted as `controller:init-summary` event and logged to console

This preserves the level-based init ordering — Level 2 controllers still init even if a Level 1 controller fails.

## Decision: Refinement (SPARC-R)

### Scope

This ADR patches TWO files:
1. `controller-registry.ts` — 27 catch blocks + init summary
2. `memory-bridge.ts` — key bridge functions (not all 105 catch blocks; only the ones for ADR-0040 through ADR-0047 controllers)

### Bridge functions to patch (Phase 1)

| Bridge function | Controller | ADR |
|----------------|-----------|-----|
| `bridgeFilteredSearch` | B5 MetadataFilter | 0043 |
| `bridgeOptimizedSearch` | B6 QueryOptimizer | 0043 |
| `bridgeAttentionSearch` | A3 MultiHead | 0044 |
| `bridgeFlashConsolidate` | A5 AttentionService | 0044 |
| `bridgeMoERoute` | A5 AttentionService | 0044 |
| `bridgeGraphRoPESearch` | A5 AttentionService | 0044 |
| `bridgeSelfLearningSearch` | A6 SelfLearningRvf | 0046 |
| `bridgeRecordFeedback` | A6 SelfLearningRvf | 0046 |
| `bridgeEmbed` | A9 EnhancedEmbedding | 0045 |
| `bridgeAuditEvent` | D3 AuditLogger | 0045 |
| `bridgeSelectBackend` | B9 QuantizedVector | 0047 |
| `bridgeHealthReport` | B3 IndexHealth | 0047 |
| `bridgeFederatedRound` | A11 FederatedLearning | 0047 |

### What we are NOT changing

- The 20+ bridge functions for pre-ADR-0040 controllers (reasoningBank, skills, reflexion, etc.) — these work and aren't broken
- MCP tool handler error responses — these already surface errors to callers
- The `withBridgeSafeguards` timeout pattern — legitimate fire-and-forget

### Effort

- controller-registry.ts: ~2h (replace 27 catch blocks with error class + emit)
- memory-bridge.ts: ~2h (patch 13 bridge functions)
- Error classes + strict mode detection: ~30min
- Tests: ~1h (verify strict mode throws, non-strict mode emits events)

## Decision: Completion (SPARC-C)

### Checklist

- [ ] Define `ControllerInitError` and `ControllerNotAvailable` error classes
- [ ] Add `strictMode` property to ControllerRegistry (reads `CLAUDE_FLOW_STRICT` env)
- [ ] Replace 27 `catch { return null }` blocks in controller factories with error-aware catch
- [ ] Add `initErrors` collection array and post-init summary
- [ ] Emit `controller:init-error` events on all caught factory errors
- [ ] Add `strictMode` detection to memory-bridge.ts
- [ ] Patch 13 bridge functions to throw or log on missing controllers
- [ ] Add unit tests: strict mode throws on broken factory
- [ ] Add unit tests: non-strict mode emits events and returns fallback
- [ ] Add unit tests: init summary collects errors across levels
- [ ] Verify existing 240 tests still pass (non-strict mode)

### Testing

```js
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

describe('ADR-0049: fail-loud mode', () => {
  it('strict mode: factory error throws ControllerInitError', () => {
    const strictMode = true;
    const factory = () => { throw new Error('wrong constructor args'); };
    const name = 'selfAttention';

    if (strictMode) {
      assert.throws(
        () => { try { factory(); } catch (e) { throw new ControllerInitError(name, e); } },
        (err) => err.controllerName === 'selfAttention'
      );
    }
  });

  it('non-strict mode: factory error emits event and returns null', () => {
    const events = [];
    const emit = (type, data) => events.push({ type, ...data });
    const factory = () => { throw new Error('missing quantizationType'); };
    const name = 'quantizedVectorStore';

    let result;
    try { result = factory(); } catch (e) {
      emit('controller:init-error', { name, error: e });
      result = null;
    }
    assert.strictEqual(result, null);
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].name, 'quantizedVectorStore');
  });

  it('init summary collects all errors across levels', () => {
    const errors = [];
    const levels = [
      { level: 0, results: [{ name: 'telemetry', ok: true }] },
      { level: 2, results: [
        { name: 'selfAttention', ok: false, error: 'ctor mismatch' },
        { name: 'crossAttention', ok: false, error: 'ctor mismatch' },
      ]},
    ];
    for (const lvl of levels) {
      for (const r of lvl.results) {
        if (!r.ok) errors.push({ level: lvl.level, name: r.name, error: r.error });
      }
    }
    assert.strictEqual(errors.length, 2);
    assert.strictEqual(errors[0].name, 'selfAttention');
  });

  it('bridge strict mode: missing controller throws', () => {
    const strictMode = true;
    const registry = { get: () => null };
    const name = 'metadataFilter';

    assert.throws(
      () => {
        const ctrl = registry.get(name);
        if (!ctrl && strictMode) throw new Error(`Controller '${name}' not available`);
      },
      /metadataFilter/
    );
  });

  it('bridge non-strict mode: missing controller logs and returns fallback', () => {
    const warnings = [];
    const registry = { get: () => null };
    const name = 'metadataFilter';
    const strictMode = false;

    const ctrl = registry.get(name);
    if (!ctrl) {
      if (strictMode) throw new Error('unreachable');
      warnings.push(name);
    }
    assert.strictEqual(ctrl, null);
    assert.deepStrictEqual(warnings, ['metadataFilter']);
  });
});
```

### Success Criteria

- `CLAUDE_FLOW_STRICT=true npm run test:unit` surfaces all 13 constructor mismatches as thrown errors
- `CLAUDE_FLOW_STRICT=false npm run test:unit` passes all 240 existing tests (backward compatible)
- Init summary reports exact count and names of failed controllers
- Every swallowed error includes: controller name, bridge function name, original error message
- Zero silent `catch { return null }` blocks remain in factory methods

## Consequences

### Positive

- Every constructor mismatch becomes immediately visible during development
- Missing exports produce clear "FederatedLearningManager not found in agentdb" errors
- Developers can distinguish "not installed" from "wiring bug" from "API changed"
- Init summary gives a single dashboard of what's broken after startup
- Production graceful degradation preserved via `CLAUDE_FLOW_STRICT=false`

### Negative

- Strict mode will break CI until the 29 bugs from ADR-0040–0047 audit are fixed
- Adds ~50 lines of error class boilerplate
- Non-strict mode adds console noise (logged errors instead of silence)

### Risks

- Teams may set `CLAUDE_FLOW_STRICT=false` permanently to avoid fixing bugs (mitigated: CI defaults to strict)
- Event-based error reporting requires a listener to be useful (mitigated: console.warn fallback when no listener)

## Related

- **ADR-0040 through ADR-0047**: The 8 ADRs whose implementations are hidden by silent swallowing
- **ADR-0048**: Lazy controller initialization (preserved, not modified)
- **Swarm audit 2026-03-17**: 8-agent analysis that discovered 29 bugs hidden by graceful degradation
