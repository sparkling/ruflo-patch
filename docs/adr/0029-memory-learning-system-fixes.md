# ADR-0029: Memory & Learning System Fixes

## Status

Proposed

## Date

2026-03-15

## Context

Diagnostic testing of `@sparkleideas/cli` v3.5.15-patch.24 revealed 7 issues in the memory, neural/learning, and initialization subsystems. While core memory operations (store, retrieve, search, delete) work correctly, several components are operating in fallback mode, one critical feature (`neural predict`) is broken, and the initialization pipeline has gaps that cause first-run failures.

These issues were discovered by running `init --full --force` on a clean project and exercising every memory and learning CLI command. See `docs/reports/memory-learning-diagnostic-2026-03-15.md` for the full diagnostic report.

### Problem Summary

| ID | Severity | Component | Issue |
|----|----------|-----------|-------|
| ML-001 | P0 | neural predict | Returns no patterns despite 100 trained patterns in ReasoningBank |
| ML-002 | P0 | init --full | Does not chain `memory init`, causing "Database not initialized" on first use |
| ML-003 | P1 | FlashAttention | `attention.FlashAttention is not a constructor` — training falls back |
| ML-004 | P1 | memory init | 2/6 ADR-053 controllers fail silently, no names logged |
| ML-005 | P2 | init --full | All 26 hooks registered but disabled — no automated learning |
| ML-006 | P2 | init --full | graph-state.json bootstrapped with 195MB of unrelated project data |
| ML-007 | P3 | neural patterns | 2.1MB pattern file, Int8 quantization available but not applied |

## Decision

### SPARC Specification

**Scope**: Fix all 7 issues in the ruflo fork's TypeScript source, following the fork patch model (ADR-0027).

**Constraints**:
- All fixes are patches to upstream ruflo fork at `~/src/forks/ruflo`
- Each fix gets a GitHub issue in `sparkling/ruflo-patch` with label `patch`
- Fixes must not break existing memory operations (store/retrieve/search/delete all pass)
- Fixes target the published `@sparkleideas/cli` package

### SPARC Pseudocode

#### ML-001: Fix `neural predict` search path
```
// Problem: predict command searches but finds no matches
// Root cause: prediction uses a different embedding/comparison path than training
1. Locate neural predict handler in ruflo fork
2. Trace how it loads patterns.json
3. Compare embedding generation between train and predict paths
4. Fix similarity comparison to use same vector space
5. Add threshold fallback (lower default from 0.9 to 0.5)
```

#### ML-002: Chain `memory init` into `init --full`
```
// Problem: init --full creates dirs but skips database init
1. Locate init command handler (--full flag path)
2. After directory scaffolding, call memoryInit()
3. Handle idempotent re-init (--force should re-init)
```

#### ML-003: Fix FlashAttention constructor
```
// Problem: attention.FlashAttention is not a constructor
1. Locate FlashAttention import in neural training code
2. Check export format (default vs named export)
3. Fix import to match actual WASM module export
4. If @ruvector/core unavailable, use graceful degradation (not crash + fallback)
```

#### ML-004: Log failed controller names
```
// Problem: "Activated: 4, Failed: 2" but no names
1. Locate ADR-053 controller registry initialization
2. Add failed controller names to output table
3. Log failure reasons at WARN level
```

#### ML-005: Enable core hooks by default
```
// Problem: 26 hooks registered, all disabled
1. Locate hook registration in init --full
2. Enable: session-start, session-end, route, metrics, post-task
3. Keep intelligence hooks opt-in (they have performance cost)
```

#### ML-006: Scope graph-state bootstrap to project
```
// Problem: 195MB graph from unrelated ~/.claude/projects/ memories
1. Locate auto-memory bootstrap in init
2. Filter to only current project directory memories
3. Skip cross-project memory import on fresh init
```

#### ML-007: Apply Int8 quantization to patterns
```
// Problem: 2.1MB for 100 patterns, quantization available but unused
1. Locate pattern serialization in neural train
2. Apply Int8 quantization to embedding vectors before persist
3. Add --quantize flag (default on for new projects)
```

### SPARC Architecture

All fixes target the ruflo fork (`~/src/forks/ruflo`). Key source locations to investigate:

- `v3/@claude-flow/cli/src/commands/` — CLI command handlers (init, neural, memory)
- `v3/@claude-flow/core/src/` — Core memory and neural engine
- `v3/@claude-flow/memory/src/` — Memory backend, HNSW integration
- `v3/@claude-flow/neural/src/` — Neural training, prediction, FlashAttention

### SPARC Refinement

After initial fixes:
1. Re-run the full diagnostic battery from the report
2. Verify all 7 issues resolved
3. Run `npm run preflight && npm run test:unit` in ruflo-patch
4. Confirm no regressions in existing memory operations

### SPARC Completion

- Each fix committed as a separate patch on the fork
- GitHub issues created for tracking
- PR to ruflo-patch main with all fixes
- `npm run deploy:dry-run` to validate publish pipeline

## Consequences

### Positive
- `neural predict` becomes functional — enables real pattern-based recommendations
- First-run experience improved — no "Database not initialized" error
- FlashAttention either works natively or degrades gracefully with clear logging
- Hooks provide automated learning out of the box
- Fresh projects get clean, project-scoped graph state

### Negative
- 7 patches increase fork maintenance surface
- Enabling hooks by default adds ~10ms overhead per operation
- Int8 quantization trades ~2% accuracy for 4x memory reduction

### Risks
- ML-001 root cause may be deeper than threshold tuning (could be embedding dimension mismatch)
- ML-006 bootstrap filtering may miss legitimate cross-project memories

## Related

- ADR-0027: Fork migration and version overhaul
- ADR-0028: Build type safety
- Diagnostic report: `docs/reports/memory-learning-diagnostic-2026-03-15.md`
