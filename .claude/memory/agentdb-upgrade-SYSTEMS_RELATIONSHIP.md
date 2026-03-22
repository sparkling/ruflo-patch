# Memory Systems Relationship & Integration

## Three-Layer Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                          LAYER 1: SOURCE                       │
│                                                                 │
│  Claude Code Auto-Memory         Project Intelligence          │
│  ~/.claude/memory/               .claude/helpers/              │
│  (JSON files, session-scoped)    intelligence.cjs              │
└────────────┬──────────────────────────┬──────────────────────┘
             │                          │
             │ (session import/sync)    │ (continuous learning)
             │                          │
┌────────────▼─────────────────────────▼──────────────────────────┐
│                     LAYER 2: AGGREGATION                        │
│                                                                 │
│  HybridBackend (WM-001)                                        │
│  SQLiteBackend:     .swarm/hybrid-memory.db                    │
│  AgentDBBackend:    .swarm/agentdb-memory.rvf (v3 RVF format) │
│                                                                │
│  Features:                                                     │
│  • Key-value storage with TTL                                 │
│  • Float32 embeddings (384-1536 dims)                         │
│  • HNSW vector index                                          │
│  • Namespace-based partitioning                               │
│  • Semantic + keyword search fallback                         │
│  • Access counting & decay                                    │
│  • Self-learning via SelfLearningRvfBackend (v3)             │
└────────────┬──────────────────────────────────────────────────┘
             │
             │ (queries, storage, retrieval)
             │
┌────────────▼──────────────────────────────────────────────────────┐
│                      LAYER 3: CONSUMPTION                         │
│                                                                   │
│  MCP Tools                    Internal APIs                       │
│  ┌─────────────────────────┐  ┌──────────────────────────┐       │
│  │ memory_store()          │  │ recordEdit()             │       │
│  │ memory_search()         │  │ feedback(success/fail)   │       │
│  │ memory_retrieve()       │  │ consolidate()            │       │
│  │ memory_delete()         │  │ getContext()             │       │
│  │ memory_list()           │  │ stats()                  │       │
│  │ hooks_intelligence_*    │  │                          │       │
│  │ neural_*                │  │                          │       │
│  └─────────────────────────┘  └──────────────────────────┘       │
│                                                                   │
│  User Queries                 Learning Daemon                     │
│  (LLM prompt context)        (consolidation worker)               │
└───────────────────────────────────────────────────────────────────┘
```

---

## System 1: HybridBackend (WM-001)

### Role
**Central vector database** — All persistent memory flows through here

### Data Flow In
1. AutoMemoryBridge.importFromAutoMemory() → storeEntry()
2. MCP memory_store() → storeEntry()
3. Intelligence recordEdit() → storeEntry() (pattern capture)

### Data Flow Out
1. searchEntries() → MCP memory_search() → User query
2. listEntries() → Intelligence.getContext() → Consolidate
3. getEntry() → MCP memory_retrieve() → User/daemon

### Storage Model
```javascript
{
  id: uuid,
  namespace: 'default|patterns|solutions|context|...',
  key: string,                    // For retrieval
  content: string,                // The actual data
  embedding: Float32Array,        // For semantic search
  tags: string[],                 // Categorical metadata
  metadata: {},                   // Flexible extras
  references: string[],           // Citation tracking
  accessCount: number,            // For decay calculation
  createdAt/updatedAt/expiresAt: ISO8601
}
```

### Backends (Dual-Write)
| Backend | File | Purpose |
|---------|------|---------|
| SQLiteBackend | `.swarm/hybrid-memory.db` | Structured queries, metadata, access counts |
| AgentDBBackend | `.swarm/agentdb-memory.rvf` | Vector search via HNSW, self-learning |

### Configuration (from config.json)
- `memory.backend`: "hybrid" | "sqlite" | "sqljs" | "agentdb"
- `memory.cacheSize`: 256 (embeddings cache)
- `memory.enableHNSW`: true (vector indexing)
- `memory.agentScopes.defaultScope`: "default" (namespace default)

---

## System 2: AutoMemoryBridge (WM-003)

### Role
**Session-based sync layer** — Bridges Claude Code auto-memory ↔ HybridBackend

### Lifecycle

**On Session Start** (`hooks/session-start`):
```
auto-memory-hook.mjs: doImport()
    ↓
HybridBackend.initialize()
AutoMemoryBridge.importFromAutoMemory()
    ↓
Read ~/.claude/memory/*.json files
    ↓
Create entries with namespace: auto-memory
    ↓
storeEntry() → HybridBackend
    ↓
Result: { imported: count, durationMs }
```

**On Session End** (via MCP or manual sync):
```
auto-memory-hook.mjs: doSync()
    ↓
HybridBackend.initialize()
    ↓
listEntries() → All stored entries
    ↓
AutoMemoryBridge.syncToAutoMemory()
    ↓
Write to ~/.claude/memory/*.json
    ↓
Result: { synced: count, durationMs }
```

### Deduplication
- **minConfidence**: 0.7 (skip low-confidence entries during sync)
- **Namespace routing**: Entries tagged with "auto-memory" namespace
- **Similarity matching**: Prevent duplicate patterns on reimport

### Fallback Chain
1. Try HybridBackend (requires @claude-flow/memory)
2. Fallback: JsonFileBackend (JSON files in `.swarm/`)
3. Fallback: Console logging only

### Configuration (from config.json)
- `memory.backend`: Determines which backend to use
- `hooks.enabled`: Gate on auto-memory-hook execution

---

## System 3: Intelligence.cjs (IN-001)

### Role
**Learning coordinator & context engine** — Builds on HybridBackend, manages confidence & patterns

### Persistent State
```
.claude/data/
├── memory.json              # Key-value store
│   {
│     "key:namespace": { content, confidence, tags, ... },
│     ...
│   }
├── graph-state.json         # PageRank graph
│   {
│     "nodes": { "file:path": { rank, confidence, ... }, ... },
│     "edges": [ { from, to, weight }, ... ],
│     "lastRebuild": ISO8601,
│     "rankSum": 0.99
│   }
└── intelligence-snapshot.json  # Trend tracking (50 max)
    [
      { timestamp, nodeCount, edgeCount, avgConfidence, ... },
      ...
    ]
```

### Learning Cycle

**1. Record Phase** (on every edit):
```
recordEdit(file, { added, modified, deleted })
    ↓
Extract functions, classes, dependencies from AST
    ↓
Create/update graph nodes
    ↓
Track edit frequency
    ↓
Cache snapshot (max 50)
```

**2. Feedback Phase** (on user indication):
```
feedback(success: boolean, details: string)
    ↓
success: true
    → Boost confidence (+0.1) for accessed nodes
    → Increase accessCount
else
    → Decay confidence (-0.001) for incorrect suggestions
    → Mark for consolidation review
```

**3. Consolidation Phase** (daemon, periodic or manual):
```
consolidate()
    ↓
1. Rebuild PageRank graph (power iteration, damping=0.85)
2. Decay confidence for stale entries (-0.001/access without success)
3. Extract high-confidence patterns (threshold=0.7)
4. Store patterns in HybridBackend (namespace: "patterns")
5. Prune low-confidence nodes
6. Save updated graph-state.json
    ↓
Generate insights: "Hot files", "Trending patterns"
```

### Context Retrieval

```
getContext(topic: string, topK: number)
    ↓
1. PageRank top-K nodes
    (Filter by relevance score from recent activity)
    ↓
2. Trigram matching on query
    (Query words → split → filter stop words → match content)
    ↓
3. Combine: pageRank * trigramScore
    (Weighted blend: 60% graph, 40% keyword)
    ↓
4. Return: Top-K combined results
```

### Configuration (from config.json)
- `memory.memoryGraph.pageRankDamping`: 0.85 (convergence rate)
- `memory.memoryGraph.maxNodes`: 10000 (memory limit)
- `memory.memoryGraph.similarityThreshold`: 0.6 (edge cutoff)
- `memory.learningBridge.confidenceDecayRate`: 0.001
- `memory.learningBridge.accessBoostAmount`: 0.1
- `memory.learningBridge.consolidationThreshold`: 0.7
- `neural.modelPath`: `.claude-flow/neural` (for stats)

---

## Integration Points

### AutoMemoryBridge → HybridBackend
```
importFromAutoMemory()
    ↓
For each ~/.claude/memory/*.json:
    createDefaultEntry()
    set namespace = "auto-memory"
    set tags = ["session", "imported"]
    set confidence = 0.8 (bootstrap)
    ↓
HybridBackend.store(entry)
    ↓
Update access count, run embedding generation
```

### Intelligence → HybridBackend
```
consolidate()
    ↓
Extract high-confidence patterns
    (where confidence > 0.7)
    ↓
For each pattern:
    entry = createEntry()
    entry.namespace = "patterns"
    entry.confidence = patternConfidence
    entry.metadata.derivedFrom = [ file1, file2, ... ]
    ↓
HybridBackend.storeEntry(entry)
```

### User Query → All Systems
```
memory_search(query)
    ↓
1. HybridBackend.querySemantic()
    → Generate embedding for query
    → Search HNSW index
    → Return top-K by cosine similarity
    ↓
2. If results.length == 0:
    → HybridBackend.query(type: "structured")
    → Keyword matching on content
    ↓
3. Intelligence.getContext(query)
    → PageRank + trigram matching
    → Return high-confidence nodes
    ↓
4. Merge & rank all three
    → Return combined results
```

---

## Feedback Loops

### Positive (Success Path)
```
User: "This suggestion was helpful"
    ↓
feedback(success: true, "Used for X purpose")
    ↓
Intelligence:
    Boost confidence of source nodes (+0.1)
    Track in snapshot
    ↓
HybridBackend:
    accessCount += 1
    Update metadata
    ↓
On consolidate():
    Pattern becomes more stable (confidence > threshold)
    Ready for extraction to "patterns" namespace
```

### Negative (Failure Path)
```
User: "This suggestion was wrong"
    ↓
feedback(success: false, "Triggered false positive")
    ↓
Intelligence:
    Decay confidence of source nodes (-0.001)
    Mark nodes for review
    ↓
On consolidate():
    If confidence < consolidationThreshold (0.7):
    → Remove from active graph
    → Move to archive
```

### No Feedback (Default Decay)
```
Time passes (no feedback given)
    ↓
On consolidate():
    If (accessCount > 0 && no success feedback):
        confidence -= 0.001 * accessCount
    ↓
    If confidence < 0.2:
    → Prune node
```

---

## Configuration Consumption

### Before WM-007 (Broken)
```
config.json written:  ALL 19 KEYS
                      ├─ memory.*
                      ├─ neural.*
                      ├─ swarm.*
                      ├─ agentdb.*
                      └─ hooks.*

Runtime consumption:  ONLY 7 KEYS
                      ├─ memory.backend ✅
                      ├─ neural.enabled ✅
                      └─ ... (5 more)

Result: 12 KEYS DEAD ❌
```

### After WM-007 (Fixed)
```
All 19 keys read by their respective modules:

memory-initializer.js:
    ✅ memory.backend
    ✅ memory.cacheSize
    ✅ memory.enableHNSW
    ✅ memory.agentScopes.defaultScope

intelligence.js:
    ✅ memory.learningBridge.sonaMode
    ✅ memory.learningBridge.confidenceDecayRate
    ✅ memory.learningBridge.accessBoostAmount
    ✅ memory.learningBridge.consolidationThreshold
    ✅ memory.memoryGraph.pageRankDamping
    ✅ memory.memoryGraph.maxNodes
    ✅ memory.memoryGraph.similarityThreshold
    ✅ neural.modelPath

hooks-tools.js:
    ✅ hooks.enabled

start.js:
    ✅ swarm.coordinationStrategy

embeddings-tools.js:
    ✅ memory.cacheSize (reused)

Result: ALL 19 KEYS CONSUMED ✅
```

---

## Upstream vs Patched Summary

| System | Component | Upstream | Patched | Gap |
|--------|-----------|----------|---------|-----|
| **HybridBackend** | Import/init | ❌ Stub | ✅ Real | WM-001 |
| | Config reading | ⚠️ Hardcode | ✅ config.json | WM-007a |
| | HNSW support | ⚠️ sql.js | ✅ AgentDB v3 | WM-008 |
| **AutoMemoryBridge** | doImport() | ❌ Stub | ✅ Real | WM-003a |
| | doSync() | ❌ Stub | ✅ Real | WM-003b |
| | doStatus() | ⚠️ Fallback msg | ✅ Real | WM-003c |
| **Intelligence.cjs** | Full version | ❌ Generated | ✅ Copied | IN-001 |
| | PageRank loop | ⚠️ Hardcode | ✅ config.json | WM-007b |
| **Config.json** | 12 keys | ❌ Dead | ✅ Consumed | WM-007 |

