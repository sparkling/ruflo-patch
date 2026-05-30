---
status: accepted
date: 2026-03-15
tags: [memory, neural, learning, patches]
supersedes: []
depends-on: [ADR-0027, ADR-0028]
implements: []
---

# Memory & Learning System Fixes

## Context and Problem Statement

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

## Considered Options

* **Fix all 7 issues in the ruflo fork's TypeScript source, following the fork patch model (ADR-0027) (chosen)**.

(No alternatives were recorded.)

## Decision Outcome

Chosen option: "Fix all 7 issues in the ruflo fork's TypeScript source, following the fork patch model (ADR-0027)", because the issues are concrete diagnostic findings against the published `@sparkleideas/cli`, each with an identified root cause and source location, and the fork patch model gives type-checked, traceable remediation.

### SPARC Specification

**Scope**: Fix all 7 issues in the ruflo fork's TypeScript source, following the fork patch model (ADR-0027).

**Constraints**:
- All fixes are patches to upstream ruflo fork at `~/src/forks/ruflo`
- Each fix gets a GitHub issue in `sparkling/ruflo-patch` with label `patch`
- Fixes must not break existing memory operations (store/retrieve/search/delete all pass)
- Fixes target the published `@sparkleideas/cli` package

### SPARC Pseudocode (Updated with Root Cause Analysis)

#### ML-001: Fix `neural predict` — cosine similarity truncation + threshold
```
// File: v3/@claude-flow/cli/src/memory/intelligence.ts
// Lines 390-404: cosineSim() uses Math.min(a.length, b.length) which truncates
// Line 376: threshold 0.5 too high for truncated/padded vectors

Fix 1: Change Math.min → Math.max, pad shorter vector with 0s
Fix 2: Lower default threshold from 0.5 to 0.3
```

#### ML-002: Chain `memory init` into `init --full`
```
// File: v3/@claude-flow/cli/src/commands/init.ts
// Lines 245-459: --full flag path never calls memoryInit()
// Unlike --start-all which has memory init at lines 363-376

Fix: After executeInit() succeeds for --full, call memory init
```

#### ML-003: Fix FlashAttention constructor
```
// File: v3/@claude-flow/plugins/src/integrations/ruvector/attention.ts
// Line 675: FlashAttention extends BaseAttentionMechanism — no explicit constructor
// File: attention-executor.ts line 522: new FlashAttention() fails at runtime

Fix: Add explicit constructor(config?: Partial<AttentionConfig>) to FlashAttention
     and FlashAttentionV2 classes
```

#### ML-004: Log failed controller names
```
// File: v3/@claude-flow/cli/src/commands/memory.ts
// Lines 1348-1353: failed controllers only shown when verbose flag is set

Fix: Remove `&& verbose` condition so failed controllers always display
```

#### ML-005: Enable core hooks by default
```
// File: v3/@claude-flow/cli/src/mcp-tools/hooks-tools.ts
// Lines 1033-1079: hooksList returns hardcoded status:'active' but never reads settings
// File: v3/@claude-flow/cli/src/commands/hooks.ts lines 1398-1408: table shows enabled field

Fix: Read .claude/settings.json for actual enabled state
     Enable session-start, session-end, route, metrics, post-task by default in init --full
```

#### ML-006: Scope graph-state bootstrap to project
```
// File: v3/@claude-flow/cli/src/init/helpers-generator.ts
// Lines 663-670: bootstrapFromMemoryFiles() scans ALL ~/.claude/projects/
// Line 666: path.join(os.homedir(), ".claude", "projects") — no project filter

Fix: Replace with project-scoped path using path.basename(PROJECT_ROOT)
     Follow pattern from auto-memory-bridge.ts:751-766 (resolveAutoMemoryDir)
```

#### ML-007: Apply Int8 quantization to patterns
```
// File: v3/@claude-flow/memory/src/persistent-sona.ts
// Lines 169-190: storePattern() stores raw embedding: [...embedding]

Fix: Before storing, quantize to Int8: scale to [-128,127], store scale/offset metadata
     Apply same quantization in findSimilarPatterns before comparison
```

#### Bonus: Fix memory stats missing dates
```
// File: v3/@claude-flow/cli/src/mcp-tools/memory-tools.ts
// Lines 577-623: memory_stats handler never computes oldestEntry/newestEntry
// CLI at memory.ts:640-641 expects stats.oldestEntry, falls back to 'N/A'

Fix: Loop allEntries.entries, compute min/max createdAt timestamps, return as ISO strings
```

### SPARC Architecture

All fixes target the ruflo fork (`~/src/forks/ruflo`). Exact source locations:

| Fix | File | Lines |
|-----|------|-------|
| ML-001 | `cli/src/memory/intelligence.ts` | 357-405 (cosineSim + findSimilar) |
| ML-002 | `cli/src/commands/init.ts` | 245-459 (initAction --full path) |
| ML-003 | `plugins/src/integrations/ruvector/attention.ts` | 675, 744 (FlashAttention classes) |
| ML-004 | `cli/src/commands/memory.ts` | 1348-1353 (controller display) |
| ML-005 | `cli/src/mcp-tools/hooks-tools.ts` | 1033-1079 (hooksList handler) |
| ML-006 | `cli/src/init/helpers-generator.ts` | 663-670 (bootstrapFromMemoryFiles) |
| ML-007 | `memory/src/persistent-sona.ts` | 169-190 (storePattern) |
| Bonus | `cli/src/mcp-tools/memory-tools.ts` | 577-623 (memory_stats) |

All paths relative to `v3/@claude-flow/`.

### SPARC Refinement

After initial fixes:
1. Run `tsc --noEmit` in each affected package
2. Re-run the full diagnostic battery from the report
3. Verify all 7 issues resolved
4. Run `npm run preflight && npm run test:unit` in ruflo-patch
5. Confirm no regressions in existing memory operations

### SPARC Completion

- Each fix committed as a separate patch on the fork
- GitHub issues created for tracking (#66-#72)
- PR to ruflo-patch main with all fixes
- `npm run deploy:dry-run` to validate publish pipeline

### Consequences

* Good, because `neural predict` becomes functional — enables real pattern-based recommendations
* Good, because first-run experience improved — no "Database not initialized" error
* Good, because FlashAttention either works natively or degrades gracefully with clear logging
* Good, because hooks provide automated learning out of the box
* Good, because fresh projects get clean, project-scoped graph state
* Bad, because 7 patches increase fork maintenance surface
* Bad, because enabling hooks by default adds ~10ms overhead per operation
* Bad, because Int8 quantization trades ~2% accuracy for 4x memory reduction
* Neutral, because (risk) ML-001 root cause confirmed as cosine similarity truncation — fix is well-scoped
* Neutral, because (risk) ML-006 bootstrap filtering may miss legitimate cross-project memories

## More Information

This decision relates to ADR-0027 (fork migration and version overhaul) and ADR-0028 (build type safety). Tracking lives in GitHub issues #66-#72 (all labeled `patch`), and the originating diagnostic is `docs/reports/memory-learning-diagnostic-2026-03-15.md`.

Original status: "Accepted".
