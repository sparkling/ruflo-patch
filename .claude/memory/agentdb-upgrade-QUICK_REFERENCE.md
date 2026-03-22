# Quick Reference: claude-flow Memory Systems

## What Stores What

| System | Stores | Where | Backend |
|--------|--------|-------|---------|
| **HybridBackend** | Key-value + vectors (384-1536 dims) | `.swarm/hybrid-memory.db` + `.rvf` | SQLite + AgentDB v3 |
| **AutoMemoryBridge** | Session entries (deduplicated) | `~/.claude/memory/` ↔ `.swarm/` | HybridBackend |
| **Intelligence.cjs** | PageRank graph + confidence scores | `.claude/data/memory.json` | JSON files |
| **Config.json** | All settings + learning parameters | `.claude-flow/config.json` | JSON |

## Critical Paths

```
USER QUERY
    ↓
memory_search() [MCP]
    ↓
HybridBackend.querySemantic()  [semantic search]
    ↓
→ AgentDB HNSW (vector index)
    ↓
intelligence.getContext()      [PageRank context]
    ↓
→ graph-state.json (PageRank scores)
    ↓
COMBINED RESULTS
```

## Configuration Keys (WM-007)

### Consumed

- `memory.backend` ✅ (memory-initializer.js)
- `memory.cacheSize` ✅ (embeddings-tools.js)
- `memory.enableHNSW` ✅ (memory-initializer.js)
- `memory.learningBridge.*` ✅ (intelligence.js)
- `memory.memoryGraph.*` ✅ (intelligence.js)
- `memory.agentScopes.defaultScope` ✅ (memory-initializer.js)
- `neural.modelPath` ✅ (intelligence.js)
- `neural.enabled` ✅ (hooks-tools.js)
- `hooks.enabled` ✅ (hooks-tools.js)
- `swarm.coordinationStrategy` ✅ (start.js)
- `agentdb.vectorBackend` ✅ (memory-initializer.js, WM-008)
- `agentdb.enableLearning` ✅ (agentdb-backend.js, WM-008)

## Learning Loops

### SONA Cycle (instant + background)

```
recordEdit() [file changes]
    ↓
feedback(success/failure) [boost/decay confidence]
    ↓
consolidate() [rebuild graph, decay stale]
    ↓
pattern extraction → HybridBackend.storeEntry()
```

### Decay Mechanisms

- **Confidence decay**: 0.001 per access without success
- **TTL decay**: expiresAt field on entries
- **Stale node cleanup**: Below consolidationThreshold (0.7)

## Embedding Model

- **Default**: all-MiniLM-L6-v2 (384 dims)
- **Alternative**: all-mpnet-base-v2 (768 dims)
- **Source**: @xenova/transformers
- **Cache**: `~/.cache/huggingface/models/`

## Status: Upstream vs Patched

| Component | Upstream | Patch |
|-----------|----------|-------|
| HybridBackend wired | ❌ | WM-001 |
| AutoMemoryBridge active | ❌ | WM-003 |
| Intelligence.cjs real | ❌ | IN-001 |
| Config keys consumed | ⚠️ (12 dead) | WM-007 |
| AgentDB v3 | ❌ | WM-008 |

## Files to Know

| File | Purpose | Patched By |
|------|---------|-----------|
| `.claude-flow/config.json` | Runtime config (19 keys) | SG-008, WM-007 |
| `.swarm/hybrid-memory.db` | SQLite K-V store | WM-001 |
| `.swarm/agentdb-memory.rvf` | Vector index (v3 RVF format) | WM-008 |
| `.claude/data/memory.json` | Intelligence K-V store | IN-001 |
| `.claude/data/graph-state.json` | PageRank graph + scores | IN-001 |
| `memory/memory-initializer.js` | Entry point for memory system | WM-001, WM-007, WM-008 |
| `memory/intelligence.js` | Learning module init | IN-001, WM-007 |
| `.claude/helpers/auto-memory-hook.mjs` | Session import/sync | WM-003 |
| `.claude/helpers/intelligence.cjs` | Full PageRank + learning | IN-001 |

## Debug Commands

```bash
# Check memory initialized
npx @claude-flow/cli memory list --namespace default

# Check intelligence graph
node .claude/helpers/intelligence.cjs stats

# Check config
npx @claude-flow/cli config get memory.backend

# Check embedding model
ls -la ~/.cache/huggingface/models/

# Check .swarm files
ls -la .swarm/*.db .swarm/*.rvf

# Check data dir
ls -la .claude/data/
```

## MCP Tools Surface

- `memory_store()` — HybridBackend.store()
- `memory_search()` — HybridBackend.querySemantic() + fallback
- `memory_retrieve()` — HybridBackend.getByKey()
- `memory_delete()` — HybridBackend.delete()
- `memory_list()` — HybridBackend.query(type: 'structured')
- `hooks_intelligence_learn()` — Trigger consolidation
- `hooks_intelligence_pattern_store()` — Store pattern with confidence
- `hooks_intelligence_pattern_search()` — Search patterns by similarity
