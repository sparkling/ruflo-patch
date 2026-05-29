# ADR-0032: claude-flow-patch Memory/Learning Patch Adoption Analysis

## Status

Accepted

## Date

2026-03-15

## Context

The `claude-flow-patch` repo (`~/src/claude-flow-patch`) contains 146 runtime patches applied via Python scripts to npx-cached source files. The `ruflo-patch` fork model patches TypeScript source directly and publishes as `@sparkleideas/*`. This ADR analyzes which memory/learning patches from claude-flow-patch should be adopted via the fork approach.

### Patch Landscape

| Category | Count | Focus |
|----------|------:|-------|
| WM (Wiring/Memory) | 94 | Memory bridge, controllers, learning, AgentDB, HNSW |
| SG (Settings) | 11 | Init templates |
| HK (Hooks) | 6 | Post-edit callbacks |
| EM (Embeddings) | 2 | Model config, HNSW dims |
| MM (Memory Mgmt) | 3 | Cache, SQLite contention |
| IN (Intelligence) | 4 | CJS/ESM signal bridge |
| RV (RuVector) | 3 | Trajectory, learn tick |
| Other (CF,DM,HW,UI,NS,GV,RS,DOC) | 23 | Config, daemon, display |

### Architecture (ADR-068)

ADR-068 consolidated 81 patches into 16 replacement patches (WM-100 through WM-117) using a **bridge-first architecture**:

- **Old**: 81 patches (~10,300 lines) — fragile string-matching, brittle across upstream bumps
- **New**: 16 patches (~530 lines) — bridge-first via ControllerRegistry, version-resilient

All WM-063 through WM-083 (21 "activation" patches) are **retired** — superseded by WM-100–WM-117.

## Analysis Results

### Already Ported (10 of 18 bridge patches)

| Patch | Description | GitHub Issue |
|-------|------------|-------------|
| WM-102 | Config wiring to ControllerRegistry | #34 |
| WM-104 | CausalRecall in routing | #23 |
| WM-106 | LearningBridge activation | #24 |
| WM-107 | Feedback recording fixes | #25 |
| WM-108 | Consolidation interval 30→10min | #11 |
| WM-111 | EnhancedEmbeddingService activation | #35 |
| WM-114 | AttentionService integration | #26-28 |
| WM-115 | WASMVectorSearch JS fallback | #36 |
| WM-116 | AgentMemoryScope registry fix | #37 |
| WM-103/105 | MetadataFilter + MMR + MemoryGraph | #27-28 area |

### Infrastructure Already Ported (10 of 13)

| Patch | Description | Fork Commit |
|-------|------------|-------------|
| EM-001 | Config-driven embedding model + dims | `a87635849` |
| EM-002 | TRANSFORMERS_CACHE env var | `c0f859738` |
| GV-001 | HNSW ghost vector cleanup on delete | `a87635849` |
| MM-001 | Remove dead persistPath config | `0cd9c4a39` |
| MM-002 | setInterval .unref() for process exit | `c3c1f18dd` |
| IN-003 | CJS intelligence snapshot reader | `7eb7a2515` |
| IN-004 | CJS intelligence signal writer | `7eb7a2515` |
| RV-001 | Fix force-learn tick() method | `25dde49e` |
| RV-002 | Load activeTrajectories from file | `774c2852` |
| RV-003 | Sync stats counters on trajectory-end | `38dcdc50` |

### Retired — Do NOT Port (24 patches)

All WM-063 through WM-083 (21 patches) — superseded by bridge-first architecture.
MM-003, IN-001, IN-002 (3 patches) — superseded by ADR-068 refactor.

## Decision: Patches to Adopt

### Priority 1: Foundation (CRITICAL)

| Patch | Ops | Target | Description |
|-------|-----|--------|-------------|
| **WM-100** | 2 | `@claude-flow/memory/src/index.ts` | Export `ControllerRegistry` + `INIT_LEVELS` from barrel. Without this, `memory-bridge.ts` sets `bridgeAvailable=false` and all 43 bridge functions return stubs. **Root cause of bridge being dead code.** |
| **WM-101** | shell | `agentdb` package | AgentDB v2→v3 upgrade. Enables unified RVF storage, SelfLearningRvfBackend, SHAKE-256 witness chain. **Prerequisite for all WM-102+ patches.** |

**Impact**: Without WM-100, the ControllerRegistry import fails silently and the entire bridge layer degrades to stubs. This is the single biggest fix available — it unlocks all existing bridge wiring.

### Priority 2: ESM/CJS Bridge (HIGH)

| Patch | Ops | Target | Description |
|-------|-----|--------|-------------|
| **WM-112** | 2 | `.claude/helpers/intelligence.cjs` | CJS reads `agentdb-snapshot.json` (written by ESM auto-memory-hook.mjs) as primary data source. Bridges the ESM/CJS memory gap. |
| **WM-113** | 5 | `hook-handler.cjs` + `auto-memory-hook.mjs` | CJS writes signal files (route-reward, nightly-learner) at lifecycle points. ESM consumes signals via `consumeSignals()` at session start. Completes bidirectional bridge. |

**Impact**: Eliminates memory divergence between CJS hooks (intelligence.cjs, hook-handler.cjs) and ESM bridge (auto-memory-hook.mjs, memory-bridge.ts). Currently these two systems operate independently.

### Priority 3: Optimization (MEDIUM)

| Patch | Ops | Target | Description |
|-------|-----|--------|-------------|
| **WM-117** | 4 | `memory-bridge.ts` + `memory-tools.ts` | ProductQuantizer with lazy training (threshold: 256 vectors). Provides 8-16x vector compression with ADC for accelerated similarity search. |

**Impact**: Storage optimization for large memory stores. Not urgent at current scale but valuable as memory grows.

## Implementation Plan

### Phase 1: WM-100 (ControllerRegistry Export)

**Fork**: ruflo (`~/src/forks/ruflo`)
**File**: `v3/@claude-flow/memory/src/index.ts`
**Change**: Add re-export:
```typescript
export { ControllerRegistry, INIT_LEVELS } from './controller-registry.js';
```

**Validation**: After build+deploy, `memory_stats` MCP tool should show controllers loaded (not stubs).

### Phase 2: WM-101 (AgentDB v3 Upgrade)

**Fork**: ruflo
**Note**: This may already be at v3 in the fork. Verify `agentdb` version in the built package before patching.

### Phase 3: WM-112 + WM-113 (ESM/CJS Bridge)

**Fork**: ruflo
**Files**:
- `v3/@claude-flow/cli/.claude/helpers/intelligence.cjs` — read agentdb-snapshot.json
- `v3/@claude-flow/cli/.claude/helpers/hook-handler.cjs` — write signal files
- `v3/@claude-flow/cli/.claude/helpers/auto-memory-hook.mjs` — consume signals

### Phase 4: WM-117 (ProductQuantizer)

**Fork**: ruflo
**Files**: `memory-bridge.ts`, `memory-tools.ts`
**Gated on**: Vector count ≥ 256

## Estimated Impact

| Metric | Current | After WM-100 | After WM-112/113 | After WM-117 |
|--------|---------|-------------|------------------|-------------|
| Bridge functions active | Stubs (bridge unavailable) | All 43 live | All 43 + signals | All 43 + signals |
| Controller coverage | ~25% exercised | ~85% exercised | ~85% + CJS sync | ~90% |
| ESM/CJS data exchange | None (independent) | None | Bidirectional | Bidirectional |
| Vector storage | Uncompressed | Uncompressed | Uncompressed | 8-16x compressed |
| Learning feedback loop | Partial (SONA only) | Full (bridge+controllers) | Full + CJS signals | Full + CJS signals |

## Related

- **ADR-0030**: Memory system optimization (implemented patch.27-28)
- **ADR-0031**: Runtime validation (implemented patch.27-28)
- **ADR-068** (claude-flow-patch): Bridge-first architecture consolidation
- **ADR-053** (claude-flow-patch): Evaluate WM-089/084 upstream overlap
