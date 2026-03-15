# Memory & Learning Systems Diagnostic Report

**Date**: 2026-03-15
**CLI Version**: `@sparkleideas/cli@latest` v3.5.15-patch.24
**Test Environment**: `~/src/test` (initialized with `init --full --force`)

## Overall Status: Working with Fallbacks

### Summary Table

| System | Status | Issues |
|--------|--------|--------|
| **Swarm Init** | Working | Swarm created, no agents spawned yet |
| **Memory Store** | Working | 768-dim vectors, HNSW indexed |
| **Memory Retrieve** | Working | Key-based lookup, access counting |
| **Memory Search** | Working | Semantic search ~286ms, correct relevance ranking |
| **Memory Delete** | Working | Proper cleanup + HNSW sync |
| **Memory Stats** | Working | Missing oldest/newest dates (minor bug) |
| **Neural Training** | Working (fallback) | FlashAttention constructor fails, falls back |
| **Neural Predict** | Broken | "No similar patterns found" despite 100 trained patterns |
| **Neural Patterns** | Working | 100 patterns persisted, 110 trajectories |
| **HNSW Index** | Partial | File exists (572KB) but `neural status` says "Not loaded" |
| **Hooks** | All Disabled | 26 hooks registered, all `Enabled: No` |
| **Doctor** | 9 pass / 6 warn | See details below |

## Fallbacks Detected

1. **FlashAttention WASM fallback** — Every `neural train` call hits:
   ```
   WASM init failed: attention.FlashAttention is not a constructor - falling back
   ```
   Training still completes (50 epochs in ~0.7s) but without the advertised 2.49x-7.47x speedup. The `FlashAttention` class is likely not exported correctly from the WASM module or `@ruvector/core` isn't available.

2. **HNSW Index "Not loaded"** — `neural status` reports `@ruvector/core not available` for HNSW, yet memory search works via the sql.js + WASM fallback. The 150x-12,500x search speedup is not active — searches take ~286ms (still acceptable for 3 entries, but won't scale).

3. **RuVector WASM "Not loaded"** — `neural status` shows RuVector as not loaded after training. The training process initializes it temporarily but doesn't persist the loaded state.

4. **SONA Engine "Not loaded"** — Optional, needs `--sona` flag. Not a blocker.

5. **Embedding fallback** — `agentic-flow` not installed (doctor warning). Embeddings/routing using built-in fallbacks instead of the full pipeline.

6. **ADR-053 Controller Registry** — During `memory init`, **2 controllers failed** (4 activated, 2 failed). The failed controllers aren't identified — this is a silent degradation.

## Errors Found

| Error | Severity | Location |
|-------|----------|----------|
| `FlashAttention is not a constructor` | Medium | `neural train` — fallback works |
| `Database not initialized` on first `memory store` | UX bug | `init --full` should run `memory init` |
| `memory stats` missing oldest/newest dates | Low | Shows `N/A` despite 3 entries |
| `neural predict` finds no patterns | High | 100 patterns trained but prediction returns empty |
| 2/6 ADR-053 controllers failed | Medium | Silent — no error names logged |
| `ExperimentalWarning: WebAssembly` | Noise | Node.js 24 warning, harmless |
| All 26 hooks disabled | Config gap | `init --full` registers but doesn't enable |

## Optimization Gaps

1. **195MB `graph-state.json`** — Pre-populated from auto-memory bootstrap with 205 nodes from other projects (rml-project, MEMORY entries). For a fresh `init --full`, this is bloated. The graph contains nodes from `~/.claude/projects/` memory files that shouldn't be in a test project.

2. **2MB `auto-memory-store.json`** — Same issue: bootstrapped from unrelated project memories.

3. **Neural patterns file: 2.1MB** — 100 patterns x ~21KB each. The pattern data seems oversized for coordination/security patterns. Could benefit from quantization (Int8 is "Available" per status but not active).

4. **No hooks enabled** — The entire hooks intelligence system (routing, learning, session management) is registered but disabled. This means no automated learning from operations.

5. **`memory init` not run by `init --full`** — Users hit "Database not initialized" error on first memory operation. The `init --full --force` command should chain `memory init`.

6. **Daemon not running** — Doctor flagged this. The MCP server auto-starts but the daemon (for background task coordination) doesn't.

## Patches Assessment

- **Memory system patches** (EM-001, MM-002, WM-* series): Core store/retrieve/search/delete all working correctly. Vector embeddings generate proper 768-dim vectors. HNSW metadata syncs on store/delete.

- **Neural/learning patches**: Training works via fallback path. The prediction path appears broken — patterns are stored but not retrievable via `neural predict`. This suggests the similarity threshold or search method in the prediction code path doesn't match the training storage format.

- **Hook patches** (HK-001 through HK-006): Hooks are registered with correct types but none are enabled. The `init --full` flow doesn't activate them.

## Recommendations

1. **P0**: Fix `neural predict` — 100 patterns trained but prediction returns nothing
2. **P0**: Chain `memory init` into `init --full`
3. **P1**: Fix `FlashAttention` constructor export in the WASM module
4. **P1**: Log which 2 ADR-053 controllers failed during `memory init`
5. **P2**: Enable core hooks by default in `init --full`
6. **P2**: Don't bootstrap graph-state from unrelated project memories in a fresh init
7. **P3**: Add Int8 quantization to neural patterns to reduce the 2.1MB footprint
