# ADR-0002: Instrument silent fallback paths with diagnostic logging

## Status

Accepted

## Context

### Specification (SPARC-S)

The `@claude-flow/cli` runtime and its local helper files contain numerous fallback code paths that silently degrade functionality. These paths use empty `catch {}` blocks, bare `.catch(() => null)` handlers, and fall-through logic with no diagnostic output. When features degrade — ONNX embeddings fall back to hash-based, HNSW search falls back to brute-force SQL scans, ControllerRegistry initialization fails, agentic-flow modules load as null — operators have no way to determine what degraded, when, or why.

This affects two distinct layers:

1. **Upstream package files** (FB-001): Core `@claude-flow/cli` modules in the npx cache — `memory-initializer.js`, `memory-bridge.js`, `agentic-flow-bridge.js`, `embeddings-tools.js`
2. **Local helper files** (FB-002): Project-local `.claude/helpers/` files — `intelligence.cjs`, `auto-memory-hook.mjs`, `learning-service.mjs`, `hook-handler.cjs`

The problem was discovered during investigation of memory and learning system failures where no logs existed to explain why the system was operating in degraded mode.

### Pseudocode (SPARC-P)

```
FOR each file with silent fallback paths:
  FOR each catch/fallback block:
    REPLACE empty catch with catch(e) that emits:
      console.warn('[RUFLO-FALLBACK] {ID}: {description}',
        JSON.stringify({ ts, primary, fallback, error, impact }))
    PRESERVE original fallback behavior unchanged
```

## Decision

### Architecture (SPARC-A)

Add `console.warn('[RUFLO-FALLBACK] FB-0XX-NN: ...')` instrumentation at every silent fallback point across both layers. Each log line includes structured JSON with:

- `ts` — ISO 8601 timestamp
- `primary` — what was attempted
- `fallback` — what activated instead
- `error` — the swallowed error message (where applicable)
- `impact` — severity assessment (CRITICAL / MEDIUM / LOW)

The instrumentation is **observation-only**: no control flow, return values, or error propagation is changed. The original fallback behavior is preserved exactly.

### Considered Alternatives

1. **External monitoring agent** — Rejected. Adds runtime dependency and complexity for what is fundamentally a logging gap.
2. **Debug flag gating** (`if (DEBUG) console.warn(...)`) — Rejected. The whole point is that these paths are invisible in production; gating behind a flag preserves the problem for anyone who hasn't set it.
3. **Structured logging framework** (winston, pino) — Rejected. These are upstream files in an npx cache; adding dependencies is not viable for a patch system.
4. **Patch only upstream OR only local** — Rejected. Both layers have the same problem and share helper code that gets copied during init. Patching one without the other leaves blind spots.

### Scope

| Defect | Layer | Files | Ops |
|--------|-------|-------|-----|
| FB-001 | Upstream (`@claude-flow/cli` dist) | 4 files | 10 |
| FB-002 | Local (`.claude/helpers/`) | 4 files (x2 targets each) | 16 |

**FB-001 instrumentation points (10 ops):**

| ID | File | Fallback |
|----|------|----------|
| FB-001-01 | memory-initializer.js | ONNX model unavailable, hash embedding activated |
| FB-001-02 | memory-initializer.js | ONNX runtime inference failure |
| FB-001-02b | memory-initializer.js | Hash-fallback embedding generation |
| FB-001-03 | memory-initializer.js | HNSW to brute-force SQLite search |
| FB-001-04 | memory-initializer.js | Vector similarity below threshold, keyword matching |
| FB-001-05 | memory-bridge.js | ControllerRegistry initialization failure |
| FB-001-06 | memory-bridge.js | Path traversal protection triggered |
| FB-001-07 | agentic-flow-bridge.js | ReasoningBank module unavailable |
| FB-001-08 | agentic-flow-bridge.js | Router module unavailable |
| FB-001-09 | agentic-flow-bridge.js | Orchestration module unavailable |
| FB-001-10 | embeddings-tools.js | ONNX embedding unavailable |

**FB-002 instrumentation points (16 ops):**

| ID | File | Fallback |
|----|------|----------|
| FB-002-01 | intelligence.cjs | readJSON parse failure |
| FB-002-02 | intelligence.cjs | sessionGet failure |
| FB-002-03 | intelligence.cjs | sessionSet failure |
| FB-002-04 | intelligence.cjs | Bootstrap project directory scan failure |
| FB-002-05 | intelligence.cjs | parseMemoryDir failure |
| FB-002-06 | intelligence.cjs | Consolidate malformed insight line |
| FB-002-07 | auto-memory-hook.mjs | JsonFileBackend init parse failure |
| FB-002-08 | auto-memory-hook.mjs | _persist write failure |
| FB-002-09 | auto-memory-hook.mjs | loadMemoryPackage local dist import failure |
| FB-002-10 | auto-memory-hook.mjs | loadMemoryPackage npm import failure |
| FB-002-11 | auto-memory-hook.mjs | loadMemoryPackage CLI memory import failure |
| FB-002-12 | auto-memory-hook.mjs | readConfig YAML parse failure |
| FB-002-13 | learning-service.mjs | EmbeddingService agentic-flow not found |
| FB-002-14 | learning-service.mjs | EmbeddingService ONNX embed failure |
| FB-002-15 | learning-service.mjs | embedBatch failure, sequential fallback |
| FB-002-16 | hook-handler.cjs | Keyword-fallback routing activation |

## Consequences

### Refinement (SPARC-R)

**Positive:**

- Every silent degradation now produces a structured log line filterable by `[RUFLO-FALLBACK]`
- Operators can diagnose cascading failures (e.g., ONNX unavailable causing hash fallback causing low similarity scores causing keyword matching)
- The `impact` field in each log provides immediate severity triage
- FB-002 patches both upstream source copies and local project copies, so instrumentation survives `repair-post-init.sh` rehydration

**Negative:**

- Adds `console.warn` calls to hot paths (e.g., FB-001-04 fires per-result during search) — minor performance cost
- Log volume may be high in environments where fallbacks are the norm (no ONNX runtime)
- Upstream patches will be overwritten on `@claude-flow/cli` version upgrades; must be reapplied

**Neutral:**

- No behavioral changes — all fallback logic remains identical
- No new dependencies introduced
- Patches are idempotent via `patch()` infrastructure

### Completion (SPARC-C)

- Both patches implemented and verified via `bash patch-all.sh --global`
- Idempotency confirmed (second apply reports "already present")
- `bash check-patches.sh` passes
- `npm run preflight` passes

## Patch Reference

- **Defect IDs**: FB-001, FB-002
- **Patch directories**: `patch/020-FB-001-fallback-instrumentation/`, `patch/021-FB-002-local-helper-instrumentation/`
- **Target files**: See scope table above
- **Log prefix**: `[RUFLO-FALLBACK]`
- **Patches**: `patch/020-FB-001-fallback-instrumentation/`, `patch/021-FB-002-local-helper-instrumentation/`
