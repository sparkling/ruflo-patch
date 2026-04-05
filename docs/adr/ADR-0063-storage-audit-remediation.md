# ADR-0063: Storage Audit Remediation

- **Status**: Accepted
- **Date**: 2026-04-05
- **Deciders**: 8-agent deep audit swarm
- **Supersedes**: ADR-0062 P0-2, P1-1 (implementation bugs found by audit)

## Context

An 8-agent swarm performed a deep audit of all storage settings, embedding configuration, HNSW parameters, cache/TTL values, SQLite tuning, WASM/native fallbacks, cross-component compatibility, and learning pipeline state across 4 forks (ruflo, agentic-flow, ruv-FANN, ruvector) — post-ADR-0062 implementation.

The audit found **3 critical**, **4 high**, and **8 medium** severity issues. Two of the critical issues are bugs in the ADR-0062 implementation itself (wrong import path, non-existent method).

### Agent Roles

| Agent | Focus | Key Finding |
|-------|-------|-------------|
| S1 | Storage settings | 35+ hardcoded values; three-way dimension split (384/768/1536) persists |
| S2 | Embedding engine | `getEmbeddingConfig()` is the canonical source (768 default), but 6 components bypass it |
| S3 | HNSW/vector config | `deriveHNSWParams()` wired in only 1 of 10 backends; `maxElements=10000` bottleneck in AgentDB |
| S4 | Cache/TTL/limits | RateLimiter parameter semantic mismatch (`windowMs` passed as `refillRate`); two CircuitBreaker impls |
| S5 | Cross-component compat | `getEmbeddingConfig` not exported from `@claude-flow/memory`; `AgentDB.getEmbeddingService()` doesn't exist |
| S6 | WASM/native | `@ruvector/rvf` not declared in any dep section; 13/15 loaders have safe fallbacks |
| S7 | SQLite/RVF | 5 connection points, only AgentDB native path applies full pragma set |
| S8 | Learning pipeline | Stale test at `controller-registry.test.ts:234`; learning-bridge 768-dim vs registry 384-dim mismatch |

## Decision

### Critical Fixes (C1–C3)

#### C1: Fix `getEmbeddingConfig` Import Path

ADR-0062 P0-2 added `require('@claude-flow/memory').getEmbeddingConfig` to `memory-bridge.ts`. But `getEmbeddingConfig` lives in `agentdb` (`packages/agentdb/src/config/embedding-config.ts`), not `@claude-flow/memory`. The require always fails, silently falling back to `384`.

**Fix**: Import from `agentdb` (which becomes `@sparkleideas/agentdb` post-codemod).

```typescript
// BEFORE (memory-bridge.ts line 94):
const { getEmbeddingConfig } = require('@claude-flow/memory');

// AFTER:
const { getEmbeddingConfig } = require('@claude-flow/agentdb');
```

**Location**: `ruflo` fork, `v3/@claude-flow/cli/src/memory/memory-bridge.ts`.

#### C2: Add `getEmbeddingService()` Accessor to AgentDB

ADR-0062 P1-1 calls `this.agentdb.getEmbeddingService?.()` in the controller registry. But `AgentDB` has no such method — `this.embedder` is private with no accessor. `realEmbedder` is always `null`, so controllers always get zero-vector stubs.

**Fix**: Add a public accessor to `AgentDB`:

```typescript
// In AgentDB class:
getEmbeddingService(): EmbeddingService | null {
  return this.embedder ?? null;
}
```

**Location**: `agentic-flow` fork, `packages/agentdb/src/core/AgentDB.ts`.

#### C3: Dimension Split Still Active

Even after C1 is fixed, the three-way split (384/768/1536) persists in legacy components:

| Component | Default Dim | Action |
|-----------|:-----------:|--------|
| `agentdb-backend.ts` | 1536 | Change to `getEmbeddingConfig().dimension` with 768 fallback |
| `agentdb-adapter.ts` | 1536 | Change to `getEmbeddingConfig().dimension` with 768 fallback |
| `hnsw-index.ts` (ruflo) | 1536 | Change to `getEmbeddingConfig().dimension` with 768 fallback |
| `rvf-backend.ts` (ruflo) | 1536 | Change `DEFAULT_DIMENSIONS` to 768 |
| `rvf-migration.ts` | 1536 | Change fallback to 768 |
| `memory/index.ts` | 1536 | Change exported helpers' default arg to 768 |
| `config-manager.ts` | 128 | Change to 384 (minimum viable) |
| `HNSWIndex.ts` (agentdb) | 1536 | Change hardcoded fallback to 768 |

**Location**: Multiple files in `ruflo` and `agentic-flow` forks.

### High Fixes (H1–H4)

#### H1: Fix RateLimiter Parameter Semantic Mismatch

The registry passes `windowMs` (milliseconds) as the second arg to agentdb's `RateLimiter(maxTokens, refillRate)`. Value `1000` is treated as 1000 tokens/sec (burst capacity), not a 1-second window.

**Fix**: Use the correct constructor semantics.

```typescript
// BEFORE (controller-registry.ts ~line 1174):
return new RL(rlCfg.maxRequests || 100, rlCfg.windowMs || 1000);

// AFTER — refillRate should match maxRequests for 1-second refill:
const maxTokens = rlCfg.maxRequests || 100;
const refillRate = maxTokens; // refill all tokens in 1 second
return new RL(maxTokens, refillRate);
```

**Location**: `ruflo` fork, `v3/@claude-flow/memory/src/controller-registry.ts`.

#### H2: Pass `maxElements` Through to AgentDB

`AgentDB.ts:135` defaults to `maxElements ?? 10000`. The registry never passes this field, so production swarms are capped at 10K vectors — 10–100x below what backends are designed for.

**Fix**: Add `maxElements` to `RuntimeConfig` and pass it to AgentDB:

```typescript
// In RuntimeConfig:
maxElements?: number;

// In initAgentDB():
const agentdb = new AgentDBClass({
  dbPath: this.config.dbPath,
  maxElements: this.config.maxElements || 100000,
});
```

**Location**: `ruflo` fork, `v3/@claude-flow/memory/src/controller-registry.ts`.

#### H3: Declare `@ruvector/rvf` in optionalDependencies

`RvfBackend.ts` imports `@ruvector/rvf` but it is not declared in any dependency section. Runtime fails with an install error.

**Fix**: Add to `packages/agentdb/package.json`:

```json
"@ruvector/rvf": "*"
```

**Location**: `agentic-flow` fork, `packages/agentdb/package.json`.

#### H4: Fix Stale Test in Upstream Fork

`controller-registry.test.ts:234` asserts `causalGraph` is in Level 4, but ADR-0062 P0-1 moved it to Level 3.

**Fix**: Update the test assertion:

```typescript
// BEFORE:
it('should include causal controllers in level 4', () => {
  const level4 = INIT_LEVELS.find((l) => l.level === 4);
  expect(level4?.controllers).toContain('causalGraph');

// AFTER:
it('should include causalGraph in level 3 (ADR-0062 P0-1)', () => {
  const level3 = INIT_LEVELS.find((l) => l.level === 3);
  expect(level3?.controllers).toContain('causalGraph');
```

**Location**: `ruflo` fork, `v3/@claude-flow/memory/src/controller-registry.test.ts`.

### Medium Fixes (M1–M8)

#### M1: Add `busy_timeout` to SQLiteBackend

`ruflo/memory/sqlite-backend.ts` applies WAL and synchronous but no `busy_timeout`. Under concurrent CLI+daemon access, SQLITE_BUSY errors propagate immediately.

**Fix**: Add `this.db.pragma('busy_timeout = 5000')` to `SQLiteBackend.initialize()`.

**Location**: `ruflo` fork, `v3/@claude-flow/memory/src/sqlite-backend.ts`.

#### M2: Apply Pragmas in WASM Fallback Path

`AgentDB.ts` lines 87–90 skip all pragmas when falling back to sql.js. WAL doesn't work in sql.js (in-memory only), but `cache_size` and `busy_timeout` should still be set.

**Fix**: Add pragma calls to the WASM branch (those supported by sql.js).

**Location**: `agentic-flow` fork, `packages/agentdb/src/core/AgentDB.ts`.

#### M3: Add Pragmas to Migration Runner

`apply-migration.ts` opens connections with only `foreign_keys=ON`. Concurrent processes get no busy_timeout protection.

**Fix**: Add WAL + busy_timeout pragmas after connection open.

**Location**: `agentic-flow` fork, `packages/agentdb/src/db/migrations/apply-migration.ts`.

#### M4: Wire `deriveHNSWParams()` into More Backends

Only `HNSWIndex.ts` calls it. `HNSWLibBackend`, `RuVectorBackend`, and ruflo backends all hardcode M=16/efC=200.

**Fix**: Import and call `deriveHNSWParams(dimension)` in each backend constructor, spreading before caller config (so explicit config still overrides).

**Locations**:
- `agentic-flow`: `HNSWLibBackend.ts`, `RuVectorBackend.ts`
- `ruflo`: `hnsw-index.ts`, `rvf-backend.ts`, `agentdb-backend.ts`

#### M5: Remove Dead `enableHNSW` Config Field

`RuntimeConfig.memory.enableHNSW` exists but is never read anywhere in the registry.

**Fix**: Remove the field from `RuntimeConfig` to avoid confusion.

**Location**: `ruflo` fork, `v3/@claude-flow/memory/src/controller-registry.ts`.

#### M6: Fix Learning-Bridge Hash Embedding Dimension

`createHashEmbedding()` hardcodes 768, but registry defaults to 384. Neural pattern matching fails silently.

**Fix**: Accept dimension from config:

```typescript
private createHashEmbedding(text: string, dimensions?: number): Float32Array {
  const dim = dimensions ?? this.config?.dimension ?? 768;
```

**Location**: `ruflo` fork, `v3/@claude-flow/memory/src/learning-bridge.ts`.

#### M7: Add Background Cleanup to QueryCache and ToolCache

Both caches rely on lazy expiry — expired entries only evict on access. Long-running daemons accumulate stale entries.

**Fix**: Add a `setInterval` cleanup timer (60s) matching `CacheManager`'s pattern. Clear in `destroy()`.

**Locations**:
- `agentic-flow`: `packages/agentdb/src/core/QueryCache.ts`
- `agentic-flow`: `packages/agentdb/src/optimizations/ToolCache.ts`

#### M8: Bridge `systemConfig.memory.maxSize` to `tieredCache`

`config-adapter.ts` maps `systemConfig.memory?.maxSize` but it never reaches `RuntimeConfig.memory.tieredCache.maxSize`. The tieredCache always defaults to 10,000 regardless of system config.

**Fix**: In `config-adapter.ts`, propagate to tieredCache:

```typescript
tieredCache: {
  maxSize: systemConfig.memory?.maxSize || 10000,
  ...runtimeConfig.memory?.tieredCache,
},
```

**Location**: `ruflo` fork, `v3/@claude-flow/memory/src/config-adapter.ts`.

## Inventory: Remaining Hardcoded Values (Post-Remediation)

After all fixes above, these intentional hardcodes remain:

| Location | Value | Rationale |
|----------|-------|-----------|
| `rvf-learning-store.ts` | dim=64 | Intentionally small for learning signals |
| `SECURITY_LIMITS` (agentdb) | MAX_DIM=4096, MAX_BATCH=10000 | Security ceiling — frozen by design |
| `MCPToolCaches` tiers | 4-tier config (15s–120s TTL) | Reasonable defaults, low priority to expose |
| `cache-manager.ts` cleanup | 60s interval | Operational constant |
| `ENABLE_FLASH_CONSOLIDATION` | false | Feature flag — enable when AttentionService is stable |
| `RuVectorBackend` adaptive params | M=8/16/32 tiers | Dead code — not called at init |

## Consequences

### Positive

- Resolves two critical bugs in ADR-0062 implementation (C1, C2)
- Unifies dimension default to 768 across the entire stack
- Fixes silent RateLimiter misconfiguration (H1)
- Raises maxElements from 10K to 100K (H2)
- Documents all remaining hardcoded values with rationale
- Prevents SQLITE_BUSY errors in concurrent scenarios (M1–M3)

### Negative

- C3 changes 1536→768 default in ruflo/memory legacy components — existing databases with 1536-dim vectors become incompatible
- H2 raises memory usage (100K vectors × 768 dims × 4 bytes = ~300MB ceiling vs ~30MB at 10K)

### Risks

- C1 fix changes the import from `@claude-flow/memory` to `@claude-flow/agentdb` — must verify `agentdb` is available as a runtime dependency of the CLI package
- `require()` in ESM context (memory-bridge.ts line 94) remains fragile — consider switching to `await import()` in a future pass
- M4 (wiring `deriveHNSWParams` everywhere) changes M values for existing indexes created with M=16 — the index format stores M in headers, so existing data remains readable but new inserts use different connectivity

### Migration Strategy

Same as ADR-0062: detect existing database dimension before applying defaults. For the 1536→768 change in legacy components:

1. Check if existing HNSW index has vectors
2. If yes, read stored dimension from index metadata
3. Use stored dimension (backward compat)
4. If new index, use `getEmbeddingConfig().dimension`

## Related

- **ADR-0062**: Storage & Configuration Unification (predecessor — this ADR fixes bugs found in its implementation)
- **ADR-0052**: Config-driven embedding framework (the intended single source of truth)
- **ADR-0040**: Shared singletons for NightlyLearner dependencies
- **ADR-0061**: Controller integration completion
