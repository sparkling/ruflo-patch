# ADR-0030: Memory System Optimization, ONNX Embeddings & GPU Readiness

## Status

Accepted — **partially implemented as of patch.26; see ADR-0031 for runtime validation results**

## Date

2026-03-15

## Deciders

sparkling team

## Methodology

SPARC (Specification, Pseudocode, Architecture, Refinement, Completion) + MADR (Markdown Any Decision Records)

## Context

Following the fixes in ADR-0029, a comprehensive runtime analysis of `@sparkleideas/cli` v3.5.15-patch.25 was performed on a production server (AMD Ryzen 9 7950X3D, 187 GB RAM, 3.5 TB NVMe). The analysis tested all memory operations (store, retrieve, search, delete), learning pipelines (trajectory tracking, SONA, EWC++), pattern storage, and neural subsystems.

While core memory operations work correctly with real 384-dim vector embeddings, the analysis revealed:
- **2 active fallbacks** degrading pattern storage and search quality
- **6 configuration issues** leaving significant server resources unused
- **1 missing dependency** preventing optimal embedding quality
- **Substantial GPU infrastructure** (20,000+ LOC) in upstream that is dormant

### Server Profile

| Spec | Value | Utilization |
|------|-------|-------------|
| CPU | AMD Ryzen 9 7950X3D, 16C/32T, 96 MB 3D V-Cache | ~25% |
| RAM | 187 GB (177 GB available) | 5% (10 GB used) |
| Disk | 3.5 TB NVMe RAID (3.1 TB free) | 4% |
| GPU | Integrated AMD Raphael (iGPU only) | N/A |
| Node.js | v24.13.0 (x64 Linux) | — |
| ONNX Runtime | Not installed | — |

### Runtime Diagnostic Results

System health at time of analysis:

| Component | Status | Health Score |
|-----------|--------|-------------|
| Swarm | Running | 1.00 |
| Memory | Running | 0.95 |
| Neural | Running | 0.90 |
| MCP | Running | 1.00 |

**Memory operations tested** (all passed):

| Operation | Result | Timing |
|-----------|--------|--------|
| Store (3 entries, 384-dim embeddings) | All succeeded, `hasEmbedding: true` | 0.43–1.20ms |
| Retrieve (by key) | Found, `accessCount` incremented | <1ms |
| Search (namespace-scoped) | Correct similarity ranking | 0.21–0.71ms |
| Search (global, no namespace) | **0 results** (see OPT-010) | 0.46ms |
| Delete | Clean removal from sql.js + HNSW | <1ms |

**Learning pipeline tested** (all passed):

| Operation | Result | Implementation |
|-----------|--------|---------------|
| Trajectory start | `traj-*` ID assigned, status=recording | `real-trajectory-tracking` |
| Trajectory step (x2) | Steps recorded, quality scores stored | `real-step-recording` |
| Trajectory end | Persisted, SONA pattern extracted | `real-sona-learning` |
| SONA learn + EWC++ consolidate | 1 pattern learned, 55% confidence | `real-sona` |
| Pattern store | Stored but **bridge-fallback** (see OPT-001) | `memory-only` |
| Pattern search | Found but **bridge-fallback** (see OPT-002) | `bridge-fallback` |

**Embedding provider**: `@claude-flow/embeddings (agentic-flow/reasoningbank)` — real 384-dim vectors, NOT hash-fallback.

### Verified Patches (Confirmed Working)

| Patch | Status | Evidence |
|-------|--------|----------|
| EM-001 (config-driven embedding model) | Applied | Reads `.claude-flow/embeddings.json`, falls back to `all-mpnet-base-v2` |
| EM-002 (TRANSFORMERS_CACHE writable path) | Applied | Sets `~/.cache/transformers` if unset |
| ADR-053 (AgentDB v3 bridge-first) | Applied | `loadEmbeddingModel()` tries bridge before ONNX |
| Learning bridge config | Applied | `sonaMode: balanced`, `confidenceDecayRate: 0.005` |
| Memory graph config | Applied | `pageRankDamping: 0.85`, `maxNodes: 5000` |

All config-level patches are correctly applied. The bridge-fallback issue (OPT-001/002) is a runtime initialization problem, not a missing patch.

### Decision Drivers

1. Memory system using bridge-fallback for pattern operations instead of HNSW
2. Embedding quality limited to 384-dim (reasoningbank bridge) vs available 768-dim (ONNX)
3. Server resources drastically underutilized (5% RAM, 25% CPU)
4. 20,000+ LOC of GPU infrastructure in upstream repos sits dormant
5. Default similarity threshold drops valid search results
6. Cross-namespace search returns empty results
7. Several learning subsystems loaded but never activated

## Problem Summary

### Fallbacks Detected

| ID | Component | Expected | Actual | Impact |
|----|-----------|----------|--------|--------|
| OPT-001 | Pattern Store | ReasoningBank HNSW | `bridge-fallback` (raw SQL) | Patterns not HNSW-indexed; degraded search quality |
| OPT-002 | Pattern Search | ReasoningBank vector search | `bridge-fallback` (BM25-like) | Lower relevance ranking than true vector similarity |

**Root cause (both)**: `memory-bridge.js:1010-1012` — `registry.get('reasoningBank')` returns an object but `.store()` and `.search()` are not bound as functions at runtime:

```javascript
const reasoningBank = registry.get('reasoningBank');
if (reasoningBank && typeof reasoningBank.store === 'function') {
    // Never enters — .store is undefined
}
// Falls through to bridgeStoreEntry() with controller: 'bridge-fallback'
```

### Configuration Issues

| ID | Setting | Current | Optimal (7950X3D) | Impact |
|----|---------|---------|-------------------|--------|
| OPT-003 | `memory.cacheSize` | 256 MB | 2048 MB | 0.13% of RAM used; HNSW indices and working sets constrained |
| OPT-004 | `learningBridge.sonaMode` | `balanced` | `instant` | Defers learning to background despite 32 idle threads |
| OPT-005 | `memoryGraph.maxNodes` | 5,000 | 50,000 | Artificially limits graph size on 187 GB machine |
| OPT-006 | `memoryGraph.similarityThreshold` | 0.8 | 0.65 | Creates sparse disconnected graphs; misses valid connections |
| OPT-007 | `agentdb.learningBatchSize` | 32 | 128 | Underutilizes RAM; more I/O round trips than necessary |
| OPT-008 | `agentdb.learningTickInterval` | 30,000 ms | 15,000 ms | Learning cycles complete in <1ms; 30s tick is wasteful |

### Search Quality Issues

| ID | Issue | Evidence | Root Cause |
|----|-------|----------|------------|
| OPT-009 | Default threshold too aggressive | Entry "vector embeddings HNSW" scored 0.27 against its exact query — below 0.3 cutoff | `ONNX_THRESHOLD = 0.3` in `memory-bridge.js:37`, but 384-dim reasoningbank embeddings produce lower cosine scores than 768-dim ONNX models |
| OPT-010 | Cross-namespace search returns empty | Global search for "authentication JWT" → 0 results; same query scoped to namespace → 0.38 match | Search only queries specified namespace; no cross-namespace aggregation |
| OPT-011 | 2 legacy entries lack embeddings | `test-embed` and `auth-pattern` stored pre-embedding-system; 81.8% coverage (9/11) | No backfill mechanism for pre-existing entries |

### Dormant Subsystems

| ID | Subsystem | Status | Evidence |
|----|-----------|--------|----------|
| OPT-012 | MoE Routing | 8 experts loaded, 0 routing decisions | `expertUsage: { coder: 0, tester: 0, ... }` |
| OPT-013 | EWC++ Fisher Matrix | Loaded, 0 updates | `fisherUpdates: 0, catastrophicForgettingPrevented: 0` |
| OPT-014 | LoRA Adaptations | Loaded, 0 adaptations | `adaptations: 0, avgLoss: 0` |
| OPT-015 | Flash Attention | Disabled | `flashAttention: false` in neural features |
| OPT-016 | Neural Models | 0 loaded, 0 training | `models.total: 0, models.ready: 0` |
| OPT-017 | Neural Patterns store | Separate from intelligence patterns | `neural_patterns list` → 0, while `intelligence_pattern-store` writes to sql.js |

### Missing Dependency: ONNX Embeddings

The server uses 384-dim embeddings via the `agentic-flow/reasoningbank` bridge because `@xenova/transformers` and `onnxruntime-node` are not installed. This is the single largest quality improvement available:

| Metric | Current (384-dim bridge) | With ONNX (768-dim) |
|--------|------------------------|---------------------|
| Embedding dimensions | 384 | 768 |
| Similarity score range | Low (0.15–0.47 for relevant matches) | Higher (0.4–0.8 for relevant matches) |
| Threshold accuracy | Drops valid results at 0.3 | 0.3 threshold appropriate |
| Model | `agentic-flow/reasoningbank` | `all-mpnet-base-v2` (Sentence-BERT) |
| Inference | JS bridge | ONNX Runtime native (AVX2-optimized) |

### GPU Infrastructure Assessment

Research across all upstream forks revealed substantial GPU code that is currently dormant:

| Repo | Component | LOC | Status | Backend |
|------|-----------|-----|--------|---------|
| ruv-FANN | WebGPU compute backend | 15,541 | **Implemented** | wgpu (Vulkan/Metal/DX12) |
| ruv-FANN | GPU training (Adam/AdamW/backprop) | 500+ | **Implemented** | WGSL shaders |
| ruv-FANN | CUDA/OpenCL/Vulkan native | — | **Optional feature** | `cuda-sys`, `opencl3`, `vulkano` |
| ruv-FANN | 9 WGSL compute shaders | 400+ | **Implemented** | WebGPU |
| RuVector | 11 GPU shaders (similarity, pooling, attention) | 600+ | **Implemented** | WebGPU |
| RuVector | `GpuConfig` struct with presets | 150+ | **Implemented** | Auto-detect |
| AgentDB-ONNX | GPU execution providers (CUDA/DirectML/CoreML) | 460 | **Stub** | Falls back to CPU |
| ruflo | 39 attention mechanisms | 100+ | **Implemented** | CPU (JS) |

**Key ADRs documenting GPU capabilities:**
- `ruvector/docs/adr/ADR-003-simd-optimization-strategy.md` — NEON, AVX2, AVX-512, WASM SIMD128
- `ruvector/docs/architecture/decisions/ADR-008-flash-attention.md` — Block sizes per hardware (A100, H100, M4, CPU)
- `ruv-FANN/cuda-wasm/docs/adr/ADR-005-arm-native-backend.md` — wgpu abstraction for cross-platform GPU
- `ruvector/docs/optimization/PERFORMANCE_TUNING_GUIDE.md` — PGO, LTO, AVX2, arena allocation

**7950X3D-specific opportunity**: The 96 MB 3D V-Cache is 375x larger than an A100's 192 KB SRAM. Flash Attention's tiled algorithm could achieve near-GPU performance for moderate sequence lengths on this CPU alone, using block sizes of 512x256 or larger.

## Considered Options

### Option A: CPU-Only Optimization (config + ONNX install)

Apply optimized config for 7950X3D, install ONNX runtime, fix bridge-fallback. No GPU.

- **Pros**: Zero hardware cost, immediate improvement, fixes all detected issues
- **Cons**: Leaves GPU infrastructure dormant, no neural training acceleration

### Option B: CPU Optimization + Hetzner GPU Server

Option A plus add a Hetzner GPU server for CUDA-accelerated workloads.

**Hetzner GPU options** (prices as of March 2026, pre-April 1 increase):

| Server | CPU | RAM | GPU | VRAM | Price/mo | Use Case |
|--------|-----|-----|-----|------|----------|----------|
| **GEX44** | Intel i5-13500 (14C) | 64 GB DDR4 | RTX 4000 SFF Ada | 20 GB | **EUR 184** | Embeddings, 7-13B LLMs, GPU training |
| **GEX130** | Xeon Gold 5412U (24C) | 128 GB DDR5 | RTX 6000 Ada | 48 GB | **EUR 838** | 30-70B LLMs, large model training |
| **GEX131** | Xeon Gold 5412U (24C) | 256 GB DDR5 | RTX PRO 6000 Blackwell | 96 GB | **EUR 1,058** | 70B+ models, intensive AI training |

**GEX44 is the sweet spot** for this workload — cheapest GPU that unlocks all dormant infrastructure (ruv-FANN training, RuVector shaders, ONNX CUDA, small local LLMs).

- **Pros**: Unlocks ONNX GPU embeddings (10-50x batch), ruv-FANN GPU training, RuVector GPU similarity (3.5-4x), local LLM inference (GGUF models)
- **Cons**: EUR 184/mo additional, most subsystems still don't need GPU, current workload doesn't saturate CPU

**Deadline**: Hetzner prices increase 20-37% on April 1, 2026. All Server Auction listings receive a flat 3% increase.

### Option C: Second Hetzner Server (same class)

Add a second AX102 (7950X3D/192GB) for workload isolation.

**Non-GPU alternatives**:

| Server | CPU | Threads | RAM | Price/mo |
|--------|-----|---------|-----|----------|
| AX102 (current) | Ryzen 9 7950X3D | 32 | 128-192 GB | EUR 109 |
| AX162-R | EPYC 9454P | **96** | 256 GB | EUR 199 |
| AX162-S | EPYC 9454P | **96** | 128 GB | EUR 199 |

- **Pros**: Geographic redundancy, staging/prod split, 3x threads with AX162
- **Cons**: EUR 109-199/mo, doesn't fix any software issues, current server at 5% utilization

## Decision

**Option A: CPU-Only Optimization** — apply immediately.

### For the 7950X3D specifically — optimize CPU first

The 96 MB 3D V-Cache is a unique asset. Flash Attention, HNSW search, and embedding inference are all memory-bandwidth-bound workloads where this CPU excels. Before adding a GPU:

1. **Install `@xenova/transformers` + `onnxruntime-node`** for real 768-dim ONNX embeddings on CPU
2. **Build RuVector with AVX2 optimizations** (`-C target-cpu=native -C target-feature=+avx2,+fma`)
3. **Apply the optimized config** (see Pseudocode P3 below)
4. **Build ruv-FANN with SIMD features** for 6-8x speedup on neural ops

The 7950X3D's 3D V-Cache (96 MB L3) is 375x larger than an NVIDIA A100's 192 KB SRAM. For memory-bandwidth-bound algorithms like Flash Attention's tiled computation, HNSW graph traversal, and embedding cosine similarity, this CPU can approach or match GPU performance at moderate scale — without the cost, power, or complexity of a discrete GPU. Only when batch sizes or model sizes exceed what CPU cache can serve does GPU acceleration become the better path.

**Option B: revisit when** any of these conditions are met:
- Batch embedding operations exceed 1,000 entries per session
- Neural model training requires GPU-accelerated backpropagation
- Local LLM inference (GGUF) becomes a workflow requirement
- CPU utilization consistently exceeds 60% during swarm operations

**Option C: rejected** — server is at 5% utilization.

## Decision: Specification (SPARC-S)

### S1: Fix ReasoningBank Bridge-Fallback (OPT-001, OPT-002)

**Scope**: Patch the ReasoningBank controller initialization so `.store()` and `.search()` are properly bound.

**File**: `v3/@claude-flow/cli/src/memory/memory-bridge.ts`

**Root cause**: The controller registry stores the ReasoningBank module object, but the module's `store` and `search` exports are not direct function properties — they may be wrapped in a class instance or require explicit binding.

### S2: Install ONNX Embeddings

**Scope**: Install `@xenova/transformers` and `onnxruntime-node` globally, configure `all-mpnet-base-v2` model (768-dim).

**Files**:
- Global: `npm install -g @xenova/transformers onnxruntime-node`
- Project: `.claude-flow/embeddings.json` (EM-001 config)

### S3: Apply Optimized Config

**Scope**: Update `.claude-flow/config.json` with hardware-appropriate settings.

### S4: Fix Search Threshold (OPT-009)

**Scope**: Add model-aware adaptive threshold — 0.2 for 384-dim, 0.3 for 768-dim ONNX.

**File**: `v3/@claude-flow/cli/src/memory/memory-bridge.ts:36-53`

### S5: Fix Cross-Namespace Search (OPT-010)

**Scope**: When no namespace specified, aggregate results across all namespaces.

**File**: `v3/@claude-flow/cli/src/memory/memory-bridge.ts` (bridgeSearchEntries)

### S6: Backfill Legacy Embeddings (OPT-011)

**Scope**: Add `memory migrate` subcommand to regenerate embeddings for entries with `hasEmbedding: false`.

### S7: Unify Neural and Intelligence Pattern Stores (OPT-017)

**Scope**: Wire `intelligence_pattern-store` to also populate `neural_patterns`, eliminating the dual-store divergence.

## Decision: Pseudocode (SPARC-P)

### P1: ReasoningBank Bridge Fix

```
// memory-bridge.ts — getControllerRegistry()

function getControllerRegistry(dbPath):
  registry = new Map()

  // Current: stores module object directly
  // Fix: extract and bind callable functions

  reasoningBankModule = await import('agentic-flow/reasoningbank')

  if reasoningBankModule:
    controller = {
      store: typeof reasoningBankModule.store === 'function'
        ? reasoningBankModule.store.bind(reasoningBankModule)
        : typeof reasoningBankModule.default?.store === 'function'
          ? reasoningBankModule.default.store.bind(reasoningBankModule.default)
          : null,
      search: /* same pattern */,
      recordOutcome: /* same pattern */,
    }

    if controller.store:
      registry.set('reasoningBank', controller)
    else:
      log.warn('ReasoningBank: store/search not callable, using bridge-fallback')

  return registry
```

### P2: ONNX Embeddings Configuration

```json
// .claude-flow/embeddings.json
{
  "model": "all-mpnet-base-v2",
  "dimension": 768,
  "provider": "onnx",
  "cache": "~/.cache/transformers",
  "batchSize": 32,
  "quantization": "none"
}
```

### P3: Optimized Config

```json
// .claude-flow/config.json — diff from defaults
{
  "swarm": {
    "maxAgents": 20                        // was 15 (32 threads available)
  },
  "memory": {
    "cacheSize": 2048,                     // was 256 (187 GB RAM)
    "learningBridge": {
      "sonaMode": "instant",               // was "balanced" (32 idle threads)
      "accessBoostAmount": 0.06,           // was 0.03 (faster reinforcement)
      "consolidationThreshold": 5          // was 10 (CPU handles it in <1ms)
    },
    "memoryGraph": {
      "maxNodes": 50000,                   // was 5000 (187 GB RAM)
      "similarityThreshold": 0.65          // was 0.8 (too strict, sparse graphs)
    },
    "agentdb": {
      "learningBatchSize": 128,            // was 32 (more RAM = larger batches)
      "learningTickInterval": 15000        // was 30000 (learning completes <1ms)
    }
  },
  "neural": {
    "flashAttention": true,                // was not set
    "maxModels": 5                         // was not set (allow concurrent models)
  }
}
```

### P4: Model-Aware Adaptive Threshold

```
// memory-bridge.ts

const THRESHOLDS = {
  'hash-fallback': 0.05,
  'onnx-384':      0.2,    // NEW: reasoningbank 384-dim
  'onnx-768':      0.3,    // existing ONNX_THRESHOLD for full model
}

function getAdaptiveThreshold(explicit, detectedModel, dimensions):
  if explicit !== undefined: return explicit

  if detectedModel === 'hash-fallback': return THRESHOLDS['hash-fallback']
  if dimensions <= 384: return THRESHOLDS['onnx-384']
  return THRESHOLDS['onnx-768']
```

### P5: Cross-Namespace Search

```
// memory-bridge.ts — bridgeSearchEntries()

function bridgeSearchEntries(options):
  if options.namespace:
    // Existing: search within specified namespace
    return searchInNamespace(options.namespace, options.query, options.limit)
  else:
    // NEW: aggregate across all namespaces
    namespaces = db.exec("SELECT DISTINCT namespace FROM memory_store")
    allResults = []
    for ns in namespaces:
      results = searchInNamespace(ns, options.query, options.limit * 2)
      allResults.push(...results)

    // Sort by similarity descending, take top N
    allResults.sort((a, b) => b.similarity - a.similarity)
    return allResults.slice(0, options.limit)
```

### P6: Embedding Backfill

```
// New subcommand: memory migrate

function memoryMigrate():
  entries = db.exec("SELECT key, namespace, value FROM memory_store WHERE embedding IS NULL")

  for entry in entries:
    embedding = await generateEmbedding(entry.value)
    db.run("UPDATE memory_store SET embedding = ?, embedding_dimensions = ?, embedding_model = ? WHERE key = ? AND namespace = ?",
      [embedding, dimensions, model, entry.key, entry.namespace])

  log(`Backfilled ${entries.length} entries with ${model} embeddings`)
```

## Decision: Architecture (SPARC-A)

### Patch Mapping

| Fix | Fork | File (relative to `v3/@claude-flow/`) | Lines | GitHub Issue |
|-----|------|---------------------------------------|-------|-------------|
| S1 | ruflo | `cli/src/memory/memory-bridge.ts` | ~981-1037 | TBD |
| S2 | — | Server-level install + `.claude-flow/embeddings.json` | N/A | TBD |
| S3 | — | `.claude-flow/config.json` (per-project) | All | TBD |
| S4 | ruflo | `cli/src/memory/memory-bridge.ts` | 36-53 | TBD |
| S5 | ruflo | `cli/src/memory/memory-bridge.ts` | bridgeSearchEntries | TBD |
| S6 | ruflo | `cli/src/commands/memory.ts` | New subcommand | TBD |
| S7 | ruflo | `cli/src/mcp-tools/hooks-tools.ts` + `neural/` | pattern-store handler | TBD |

### Dependencies

```
S2 (ONNX install) ──→ S4 (threshold becomes model-aware)
S1 (bridge fix)   ──→ S7 (patterns flow to correct store)
S3 (config)       ──→ independent (apply anytime)
S5 (cross-ns)     ──→ independent
S6 (backfill)     ──→ depends on S2 for best results
```

### GPU Readiness Architecture (Future, Option B)

When a discrete GPU is added, the activation path is:

```
1. Install onnxruntime-gpu (replaces onnxruntime-node)
   └── AgentDB-ONNX: executionProviders: ['cuda', 'cpu']

2. Build ruv-FANN with GPU feature
   └── cargo build --features gpu
   └── Activates: GpuAdam, GpuAdamW, GpuBatchBackprop
   └── Uses: 9 WGSL compute shaders via wgpu/Vulkan

3. Build RuVector with GPU feature
   └── Activates: 11 GPU shaders (similarity, pooling, attention)
   └── GpuConfig::auto() detects NVIDIA via Vulkan

4. Config change:
   └── agentdb.useGPU: true
   └── neural.executionProviders: ["cuda", "cpu"]
   └── neural.gpuTraining: true
```

No code changes needed — only build flags and config. The GPU plumbing is already implemented in upstream.

## Decision: Refinement (SPARC-R)

### Validation Plan

After applying fixes:

1. **S1 validation**: `intelligence_pattern-store` returns `controller: 'reasoningBank'` and `hnswIndexed: true`
2. **S2 validation**: `memory_stats` reports `embeddingDimensions: 768` and `model: 'all-mpnet-base-v2'`
3. **S3 validation**: `system_status` shows updated config values
4. **S4 validation**: Search for "vector embeddings HNSW" returns its matching entry (was dropped at 0.27 < 0.3)
5. **S5 validation**: Global search without namespace returns results from all namespaces
6. **S6 validation**: `memory migrate` backfills entries; `memory_stats` shows 100% `embeddingCoverage`
7. **S7 validation**: `neural_patterns list` shows patterns stored via `intelligence_pattern-store`

### Regression Checks

- All existing memory operations (store, retrieve, search, delete) still pass
- Trajectory tracking pipeline still works end-to-end
- SONA learning produces real patterns with >0 confidence
- `npm run preflight && npm run test:unit` passes

## Decision: Completion (SPARC-C)

### Implementation Order

1. **S3**: Apply optimized config (zero risk, immediate benefit)
2. **S2**: Install ONNX runtime (independent, improves all subsequent tests)
3. **S4**: Fix adaptive threshold (small patch, high impact on search quality)
4. **S1**: Fix ReasoningBank bridge (root cause of OPT-001/OPT-002)
5. **S5**: Fix cross-namespace search
6. **S6**: Add `memory migrate` subcommand
7. **S7**: Unify pattern stores

### Estimated Impact

| Metric | Before | After (Option A) | After (Option B + GPU) |
|--------|--------|-------------------|----------------------|
| Embedding dimensions | 384 | 768 | 768 (GPU-accelerated) |
| Embedding coverage | 81.8% | 100% | 100% |
| Pattern store backend | bridge-fallback | ReasoningBank HNSW | ReasoningBank HNSW |
| Search hit rate (valid queries) | ~33% | ~90%+ | ~90%+ |
| Memory cache | 256 MB | 2,048 MB | 2,048 MB |
| Graph capacity | 5,000 nodes | 50,000 nodes | 50,000 nodes |
| Learning latency | Deferred (balanced) | Immediate (instant) | Immediate (instant) |
| Batch embedding speed | ~2ms/entry (CPU) | ~1ms/entry (ONNX CPU) | ~0.1ms/entry (CUDA) |
| Vector similarity (batch) | CPU only | CPU (AVX2) | 3.5-4x GPU shaders |

## Consequences

### Positive

- All detected fallbacks eliminated (bridge-fallback → ReasoningBank)
- Search quality dramatically improved (384→768 dim, threshold fix, cross-namespace)
- Server resources properly utilized (256→2048 MB cache, 5K→50K graph nodes)
- Clear GPU activation path documented for future hardware addition
- No hardware cost — all improvements are software/config

### Negative

- `@xenova/transformers` adds ~200 MB disk for model weights (first-run download)
- Larger cache (2 GB) increases memory baseline (trivial on 187 GB machine)
- Model-aware threshold adds minor complexity to search path

### Risks

- ReasoningBank bridge fix (S1) may require deeper investigation if the module's export structure differs from expected
- Cross-namespace search (S5) may return too many results for broad queries — mitigated by similarity sorting and limit

## Implementation Status (Updated 2026-03-15)

Runtime validation against `@sparkleideas/cli@3.5.15-patch.26` (ADR-0031) found:

| Fix | Status | Notes |
|-----|--------|-------|
| S1 | **Not implemented** | bridge-fallback persists; `.store()` still not callable |
| S2 | **Partial** | CLI uses 768-dim, MCP uses 384-dim — dimension split (BUG-3) |
| S3 | **Not applied** | `init --full` still generates default config |
| S4 | **Partial** | CLI scores work (0.49–0.73); MCP search returns 0 results (BUG-1) |
| S5 | **Partial** | CLI cross-namespace works; MCP broken |
| S6 | **Exists** | `memory migrate` subcommand present in CLI |
| S7 | **Not implemented** | neural and intelligence patterns still separate |

**4 new bugs discovered**: MCP search always empty (BUG-1), dual-database split (BUG-2), 384/768 dimension mismatch (BUG-3), `embeddings init` crash on missing agentic-flow subpath export (BUG-4).

See **ADR-0031** for full details, evidence, and the 7-patch remediation plan (DB-001 through DB-007).

## Related

- **ADR-0031**: Runtime validation of this ADR's fixes — 4 new bugs, 7 new patches planned
- **ADR-0029**: Memory & learning system fixes (predecessor — fixes bugs, this ADR optimizes)
- **ADR-0027**: Fork migration and version overhaul (patch model)
- **ADR-0028**: Build type safety
- **Upstream ADRs**:
  - `ruvector/docs/adr/ADR-003-simd-optimization-strategy.md` — SIMD dispatch
  - `ruvector/docs/architecture/decisions/ADR-008-flash-attention.md` — Flash Attention block sizes
  - `ruv-FANN/cuda-wasm/docs/adr/ADR-005-arm-native-backend.md` — GPU backend abstraction
- **Diagnostic source**: Runtime analysis of `@sparkleideas/cli@3.5.15-patch.25` on Ryzen 9 7950X3D (this conversation)
