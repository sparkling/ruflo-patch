# claude-flow Memory & Learning Systems Map

**Status**: Comprehensive mapping of @claude-flow/cli v3.1.0-alpha.41+ memory infrastructure
**Date**: 2026-02-25
**Source**: Patch fixtures, fix.py code, and upstream source analysis

---

## Executive Summary

The claude-flow CLI has **three distinct memory/learning subsystems**, each using different backends and serving different purposes:

1. **HybridBackend** (WM-001) — Production vector database with AgentDB v3 + SQLite
2. **AutoMemoryBridge** (WM-003) — Session-based learning from Claude Code auto-memory
3. **Intelligence.cjs** (IN-001) — Legacy PageRank-based memory graph for context retrieval

**Key constraint**: None of these are wired by default in the upstream CLI. All three require patches to activate.

---

## 1. HybridBackend (WM-001)

### What It Stores

**Data**: Structured memory entries with vector embeddings
- **Key-value pairs**: `{ key, namespace, content, tags, metadata }`
- **Vector embeddings**: float32 embeddings (384-1536 dims depending on model)
- **Temporal tracking**: `createdAt`, `updatedAt`, `expiresAt` (TTL support)
- **Access counts**: `accessCount` incremented on retrieval

### Where It Stores

**Location**: `.swarm/` directory in project root
- **SQLite database**: `.swarm/hybrid-memory.db` (via better-sqlite3 native bindings)
- **AgentDB database**: `.swarm/agentdb-memory.rvf` (HNSW vectors + self-learning + witness chain via AgentDB v3)
- **Embedding model cache**: Lazy-loaded via @xenova/transformers (or user-provided)

**Storage mode**: Native SQLite with WAL (write-ahead logging) for durability. WASM sql.js used as fallback for `sqljs` backend option.

### Data Structure

```javascript
// Entry schema
{
  id: uuid,
  namespace: string,
  key: string,
  content: string,
  embedding: Float32Array,
  tags: string[],
  metadata: object,
  references: string[],
  accessCount: number,
  createdAt: ISO8601,
  updatedAt: ISO8601,
  expiresAt: ISO8601 (optional)
}

// Namespace support
'default' | 'patterns' | 'solutions' | 'context' | any custom namespace
```

### Runtime API

```javascript
// Initialization (in memory-initializer.js)
async initializeMemoryDatabase(options) {
  // Reads config.json for backend choice: 'hybrid' | 'sqlite' | 'sqljs' | 'agentdb'
  // Pre-loads embedding model, creates HybridBackend instance
  // Returns { success, backend, dbPath, features: {vectorEmbeddings, patternLearning, ...} }
}

// Storage operations
async storeEntry({ key, value, namespace, tags, ttl, upsert })
async getEntry({ key, namespace })
async deleteEntry({ key, namespace })
async listEntries({ namespace, limit, offset })

// Search
async searchEntries({ query, namespace, limit, threshold })
  // First: semantic search via HybridBackend.querySemantic()
  // Fallback: keyword matching via HybridBackend.query(type: 'structured')
```

### Configuration

**Config.json keys** (from WM-007):
```json
{
  "memory": {
    "backend": "hybrid|sqlite|sqljs|agentdb",
    "cacheSize": 256,
    "enableHNSW": true,
    "learningBridge": {
      "sonaMode": "instant|background",
      "confidenceDecayRate": 0.001,
      "accessBoostAmount": 0.1,
      "consolidationThreshold": 0.7
    },
    "memoryGraph": {
      "pageRankDamping": 0.85,
      "maxNodes": 10000,
      "similarityThreshold": 0.6
    },
    "agentScopes": {
      "defaultScope": "default"
    }
  }
}
```

### Embedding Support

**Default model**: `all-MiniLM-L6-v2` (384 dimensions)
**Alternative**: `all-mpnet-base-v2` (768 dimensions)
**Source**: @xenova/transformers (browser/Node compatible, downloads to `~/.cache/huggingface`)

**HNSW Configuration**:
- Vector dimensions: Match embedding model (384/768/1536)
- M (connections per node): 16
- efConstruction: 200
- efSearch: 100
- Index type: `hnsw` (Hierarchical Navigable Small World)

### Learning & Feedback

**SONA Integration** (from intelligence.js):
- `instantLoopEnabled`: Run learning updates on every memory change
- `backgroundLoopEnabled`: Separate learning worker process
- `loraLearningRate`: 0.001
- `ewcLambda`: Elastic Weight Consolidation coefficient for continual learning
- `maxTrajectorySize`: 100 (cap on learning trajectories)
- `patternThreshold`: 0.7 (confidence floor for pattern storage)

**Decay mechanism**:
```javascript
// From WM-007b: DEFAULT_SONA_CONFIG
{
  confidenceDecayRate: 0.001,    // Decay per access without success
  accessBoostAmount: 0.1,        // Confidence boost on successful use
  consolidationThreshold: 0.7    // Threshold for pattern consolidation
}
```

### Files Patched (WM-001)

- `memory/memory-initializer.js` (6 ops: module-level backend instance + 5 adapter functions)
- Configuration read from `.claude-flow/config.json` (WM-001a)
- Shutdown handlers for clean WAL flush (WM-001, lines 104-109)

---

## 2. AutoMemoryBridge (WM-003)

### What It Stores

**Data**: Session-based memory from Claude Code's auto-memory system
- **Location**: `~/.claude/memory/` (user home directory)
- **Format**: JSON files with semantic structure
- **Imported into**: HybridBackend via bridge adapter

### How It Works

**Session lifecycle**:
1. **Session start**: `auto-memory-hook.mjs` calls `doImport()` → `bridge.importFromAutoMemory()`
   - Reads `~/.claude/memory/*.json` files
   - Creates HybridBackend instance if not exists
   - Stores with namespace-based deduplication
   - Returns `{ imported: count, durationMs }`

2. **Session end**: `auto-memory-hook.mjs` calls `doSync()` → `bridge.syncToAutoMemory()`
   - Reads all stored entries from HybridBackend
   - Exports to `~/.claude/memory/` as JSON files
   - Deduplicates based on similarity
   - Returns `{ synced: count, durationMs }`

3. **Status**: `doStatus()` shows bridge status, entry count, last sync

### Bridge Configuration

```javascript
// From WM-003 patch
const bridgeConfig = {
  workingDir: PROJECT_ROOT,
  syncMode: 'on-session-end',
  minConfidence: 0.7,
};
```

### Backend Integration

**WM-003 uses HybridBackend** (same as WM-001):
```javascript
backend = new HybridBackend({
  sqlite: { databasePath: join(PROJECT_ROOT, '.swarm', 'hybrid-memory.db') },
  agentdb: { dbPath: join(PROJECT_ROOT, '.swarm', 'agentdb-memory.rvf'), vectorBackend: 'rvf', enableLearning: true },
  dualWrite: true,  // Write to both backends
});
```

**With JsonFileBackend fallback** (if HybridBackend unavailable):
```javascript
// Fallback for projects without @claude-flow/memory
backend = new JsonFileBackend(STORE_PATH);
```

### Files Modified (WM-003)

- `init/helpers-generator.js` (3 ops: doImport, doSync, doStatus stubs)
- `.claude/helpers/auto-memory-hook.mjs` (3 ops: source hook versions with HybridBackend)
- `.claude/helpers/auto-memory-hook.mjs` (2 ops: busy_timeout pragmas for SQLite backend)

---

## 3. Intelligence.cjs (IN-001)

### What It Stores

**Data**: File-level context graph and PageRank-weighted memory
- **Graph nodes**: Files, functions, classes, API endpoints
- **Graph edges**: Dependency relationships, edit patterns
- **PageRank scores**: Normalized importance weights (sum ≈ 1.0)
- **Confidence tracking**: Success/failure feedback per node
- **Snapshots**: Up to 50 historical snapshots for trend analysis

### Where It Stores

**Location**: `.claude/data/` directory (project root)
```
.claude/data/
  memory.json          # Main memory store (key-value entries)
  graph-state.json     # PageRank graph (nodes, edges, scores)
  intelligence-snapshot.json  # Historical snapshots
```

### How It Works

**Core functionality**:
```javascript
// Same API: { init, getContext, recordEdit, feedback, consolidate, stats }
export const intelligence = {
  async init()                      // Initialize from disk or bootstrap from MEMORY.md
  async getContext(topic, topK)     // PageRank + trigram matching
  async recordEdit(file, changes)   // Record file edits for pattern learning
  async feedback(success, details)  // Confidence boost/decay
  async consolidate()               // Graph rebuild, confidence decay, insights
  async stats()                     // Return graph metrics
}
```

**PageRank algorithm**:
- Power iteration with damping factor: 0.85 (from WM-007b)
- Convergence threshold: relative change < 1e-6
- Max iterations: 100
- Result: Normalized scores (sum to ~1.0)

**Context retrieval** (from getContext):
1. PageRank top-K nodes
2. Trigram matching on query (with stop-word filtering)
3. Combined scoring: `pageRank * trigramRelevance`
4. Return: Sorted by combined score

**Confidence feedback**:
```javascript
// From WM-007b config
confidenceDecayRate: 0.001,   // Per access without success
accessBoostAmount: 0.1,        // On successful use
consolidationThreshold: 0.7    // Min confidence for pattern storage
```

### Bootstrap & Migration

**Bootstrap from MEMORY.md**:
- On first run, scans project root for `.claude/MEMORY.md`
- Extracts key-value pairs and topics
- Seeds graph with file/topic nodes
- Initializes confidence at 0.5

**Upstream full version**:
- 916-line complete implementation shipped at:
  ```
  node_modules/@claude-flow/cli/.claude/helpers/intelligence.cjs
  ```
- Replaces 197-line stub when `findSourceHelpersDir()` succeeds
- IN-001 patches executor.js to try reading real file before falling back

### Files (IN-001)

- `init/executor.js` (2 ops: read real intelligence.cjs from package in both upgrade + fresh init paths)

---

## 4. Configuration & Wiring (WM-007)

### Dead Config Keys (Before WM-007)

| Key | Original Hardcode | Wired By WM-007 |
|-----|------------------|-----------------|
| `memory.cacheSize` | 256 in embeddings-tools.js | WM-007f |
| `memory.enableHNSW` | embeddings.json instead | WM-007a |
| `memory.learningBridge.*` | Never read | WM-007b |
| `memory.memoryGraph.*` | Never read | WM-007b |
| `memory.agentScopes.defaultScope` | 'default' hardcoded | WM-007a |
| `neural.modelPath` | `.claude-flow/neural` hardcoded | WM-007c |
| `hooks.enabled` | Never checked | WM-007e |
| `swarm.coordinationStrategy` | Never used | WM-007d |

### Neural System Path

**Before WM-007**: Hardcoded in intelligence.js
```javascript
function getDataDir() {
  const localDir = join(cwd, '.claude-flow', 'neural');
  const homeDir = join(homedir(), '.claude-flow', 'neural');
  // Prefer local if exists
  return existsSync(join(cwd, '.claude-flow')) ? localDir : homeDir;
}
```

**After WM-007c**: Reads from config.json
```json
{
  "neural": {
    "modelPath": ".claude-flow/neural"
  }
}
```

---

## 5. AgentDB Upgrade (WM-008)

### Version Migration: v2 → v3

**v2 characteristics** (before WM-008):
- 37 npm dependencies
- Native C++ bindings for HNSWlib
- SQLite backend via better-sqlite3
- Multiple `.db` files per index

**v3 characteristics** (active after WM-008):
- 5 npm dependencies (no native bindings)
- Unified `.rvf` single-file storage format
- sql.js WASM fallback (zero-dependency)
- Self-learning via `SelfLearningRvfBackend`
- SHAKE-256 witness chain for tamper detection

### WM-008 Changes

**Path updates** (v2 → v3):
```
.swarm/agentdb-memory.db   →   .swarm/agentdb-memory.rvf
```

**Config updates**:
```javascript
// v2
{
  vectorBackend: 'auto',
  dbPath: '.swarm/agentdb-memory.db'
}

// v3
{
  vectorBackend: 'rvf',
  dbPath: '.swarm/agentdb-memory.rvf',
  enableLearning: true,
  witnessChainEnabled: true,
  learningPositiveThreshold: 0.7,
  learningNegativeThreshold: 0.3,
  learningBatchSize: 32,
  learningTickInterval: 30000
}
```

**Learning integration**:
```javascript
// From WM-008 AgentDBBackend
async recordFeedback(entryId, feedback) {
  // Self-learning backend captures behavior patterns
  // Updates internal ranking via witness chain
}

async getWitnessChain() {
  // SHAKE-256 chain of all modifications
}
```

### Files Patched (WM-008)

| File | Changes |
|------|---------|
| `@claude-flow/memory/agentdb-backend.js` | Vector backend → 'rvf', add learning methods, witness chain |
| `@claude-flow/memory/package.json` | agentdb v2 → v3 |
| `@claude-flow/cli/memory/memory-initializer.js` | Path update, config.agentdb subsection |
| `@claude-flow/cli/init/executor.js` | Config template + version table |
| `@claude-flow/cli/init/helpers-generator.js` | Path + vector backend updates |
| `@claude-flow/neural/reasoning-bank.js` | Vector backend → 'rvf' |
| `@claude-flow/shared/defaults.js` | Add vectorBackend field |

---

## 6. Integrations & Feedback Loops

### Intelligence → HybridBackend Loop

```
intelligence.cjs (PageRank graph)
    ↓ recordEdit()
    ↓ feedback(success/failure)
    ↓ consolidate()
    ↓
HybridBackend (semantic search)
    ↓ storeEntry(confidence)
    ↓
Neural system learns patterns
```

### Daemon → Learning Loop

**Worker daemon** (from WM-004, WM-005):
- Preload worker: Cached embedding generation
- Consolidation worker: Graph rebuild, pattern extraction

**SONA cycle** (from intelligence.js):
1. `instantLoopEnabled`: Learn on every change (hot path)
2. `backgroundLoopEnabled`: Async learning worker
3. `consolidationThreshold`: Pattern filtering (0.7 default)

### Memory Decay

**Two-level decay**:

1. **Confidence decay** (WM-007b):
   - Rate: 0.001 per access without success
   - Triggers at consolidation
   - Below threshold: Pattern deleted

2. **TTL decay** (HybridBackend entry-level):
   - Entries can have `expiresAt` timestamp
   - Auto-cleaned on read

---

## 7. API Surface (MCP Tools)

### Memory Tools (mcp-tools/memory-tools.js)

```javascript
// Handlers for @claude-flow/memory-tools MCP
memory_store({ key, value, namespace, tags, ttl, upsert })
memory_retrieve({ key, namespace })
memory_delete({ key, namespace })
memory_search({ query, namespace, limit, threshold })
memory_list({ namespace, limit, offset })
```

### Hooks Tools (mcp-tools/hooks-tools.js)

```javascript
// Intelligence integration
hooks_intelligence_pattern_store({ pattern, type, confidence, metadata })
hooks_intelligence_pattern_search({ query, topK, minConfidence })

// Learning
hooks_intelligence_learn({ trajectoryIds, consolidate })
hooks_intelligence_trajectory_start({ task })
hooks_intelligence_trajectory_step({ trajectoryId, action, quality })
hooks_intelligence_trajectory_end({ trajectoryId, success, feedback })
```

### Neural Tools (mcp-tools/neural.js)

```javascript
neural_status()
neural_train({ data, epochs, learningRate, modelType })
neural_predict({ input, modelId })
neural_patterns({ action, name, query, ... })
```

---

## 8. Project Initialization (SG-001, SG-008, SG-009)

### Config.json Generation

**From SG-008**: Generate `.claude-flow/config.json` (not config.yaml)

**Template** (from executor.js):
```json
{
  "version": "3.1.0-alpha.41",
  "memory": {
    "backend": "hybrid",
    "cacheSize": 256,
    "enableHNSW": true,
    "learningBridge": {
      "sonaMode": "instant",
      "confidenceDecayRate": 0.001,
      "accessBoostAmount": 0.1,
      "consolidationThreshold": 0.7
    },
    "memoryGraph": {
      "pageRankDamping": 0.85,
      "maxNodes": 10000,
      "similarityThreshold": 0.6
    },
    "agentScopes": {
      "defaultScope": "default"
    }
  },
  "neural": {
    "enabled": true,
    "modelPath": ".claude-flow/neural"
  },
  "swarm": {
    "topology": "hierarchical",
    "maxAgents": 12,
    "autoScale": true,
    "coordinationStrategy": "consensus"
  },
  "agentdb": {
    "vectorBackend": "rvf",
    "vectorDimension": 1536,
    "enableLearning": true,
    "witnessChainEnabled": true
  },
  "hooks": {
    "enabled": true
  },
  "mcp": {
    "autoStart": true,
    "port": 3000
  }
}
```

### Default Presets

| Preset | Backend | Neural | Max Agents |
|--------|---------|--------|-----------|
| `FULL` (default) | hybrid + agentdb | enabled | 12 |
| `MINIMAL` (SG-009) | sqljs | disabled | 2 |
| `DUAL` | hybrid + sqlite | enabled | 6 |

---

## 9. Type Definitions (types.js)

### Entry Interface

```typescript
interface MemoryEntry {
  id: string;
  namespace: string;
  key: string;
  content: string;
  embedding?: Float32Array;
  tags: string[];
  metadata: Record<string, any>;
  references: string[];
  accessCount: number;
  createdAt: string;  // ISO8601
  updatedAt: string;
  expiresAt?: string; // TTL
}

interface HybridBackendConfig {
  sqlite?: {
    databasePath: string;
    inMemory?: boolean;
    wal?: boolean;
  };
  agentdb?: {
    dbPath: string;
    vectorDimension: number;
    indexType: 'hnsw' | 'flat';
    hnswM?: number;
    hnswEfConstruction?: number;
  };
  embeddingGenerator: (text: string) => Promise<Float32Array>;
  dualWrite?: boolean;
  defaultNamespace?: string;
  semanticThreshold?: number;
}
```

---

## 10. Status: Upstream vs Patched

### Upstream (@claude-flow/cli v3.1.0-alpha.41, unpatched)

| Component | Status | Issue |
|-----------|--------|-------|
| HybridBackend | Not wired | Memory system uses sql.js only (#829 - WM-001) |
| AutoMemoryBridge | Stubs only | Session hooks don't sync (#1102 - WM-003) |
| Intelligence.cjs | Stub generated | Full version not copied from package (#1154 - IN-001) |
| Config.json | Partially wired | 12 keys dead (never consumed) (#1204 - WM-007) |
| SONA learning | Hardcoded | Config values not read at runtime |
| AgentDB | v2 only | v3 not available (#1207 - WM-008) |

### With claude-flow-patch Applied

| Component | Status | Change |
|-----------|--------|--------|
| HybridBackend | ✅ Active | Imported + initialized early in memory-initializer.js |
| AutoMemoryBridge | ✅ Active | doImport/doSync stubs replaced with HybridBackend calls |
| Intelligence.cjs | ✅ Real version | Full PageRank implementation loaded from package |
| Config.json | ✅ Consumed | All 19 keys wired into runtime (WM-007) |
| SONA learning | ✅ Configurable | Reads sonaMode/decay/threshold from config.json |
| AgentDB | ✅ v3 active | WM-008 upgrade + WM-009 learning loop + WM-010 witness chain + WM-011 ReasoningBank + WM-012 proxy methods |

---

## 11. Critical Dependencies

### Package Requirements

| Package | Version | Why |
|---------|---------|-----|
| @claude-flow/memory | Latest | HybridBackend, AutoMemoryBridge, AgentDBBackend |
| agentdb | 3.0.0-alpha.3+ | Vector DB, RVF format, self-learning backend |
| @xenova/transformers | Latest | Embedding model (all-MiniLM-L6-v2, etc.) |
| better-sqlite3 | Latest | Native SQLite for HybridBackend |
| hnsw-lib | Latest | Vector search index |
| ruv-swarm | 1.0.20+ | Daemon management, worker coordination |

### Optional Fallbacks

- **JsonFileBackend**: If HybridBackend unavailable, auto-memory bridge uses JSON files
- **sql.js**: If better-sqlite3 fails, can use WASM SQLite (slower, but works)
- **Flat search**: If HNSW unavailable, falls back to brute-force cosine similarity

---

## 12. Debugging Checklist

### Memory system not responding

1. Check `.swarm/` exists and is writable
2. Check `config.json` has `memory.backend: 'hybrid'` (not 'sqljs')
3. Check `@claude-flow/memory` installed: `npm ls @claude-flow/memory`
4. Check agentdb version ≥ 3.0.0-alpha.3: `npm ls agentdb`
5. Check embedding model cached: `~/.cache/huggingface/models/...`

### Learning not persisting

1. Check `.claude/data/` exists and has write permissions
2. Check `memory.json`, `graph-state.json` updated after operations
3. Check `neural.enabled: true` in config.json
4. Check intelligence.cjs loaded (full version, 916 lines, not stub)

### Config changes not taking effect

1. Restart daemon: `npx @claude-flow/cli daemon stop && daemon start`
2. Verify config.json path: `.claude-flow/config.json` (not config.yaml)
3. Check for syntax errors: `node -c .claude-flow/config.json`
4. Reload: `npx @claude-flow/cli config get neural.enabled`

---

## 13. Architecture Diagram

```
┌─────────────────────────────────────────────────────────┐
│ Claude Code Auto-Memory (.claude/memory/*.json)          │
└────────────────────┬────────────────────────────────────┘
                     │ (on session start/end)
                     ↓
    ┌────────────────────────────────────┐
    │  AutoMemoryBridge (WM-003)          │
    │  (auto-memory-hook.mjs)             │
    └──────────────────┬──────────────────┘
                       │
        ┌──────────────┴──────────────┐
        ↓                             ↓
┌──────────────────────────┐  ┌─────────────────────────────┐
│ HybridBackend (WM-001)   │  │ Intelligence.cjs (IN-001)   │
│ ┌────────────────────┐   │  │ ┌─────────────────────────┐ │
│ │ SQLiteBackend      │   │  │ │ PageRank Graph          │ │
│ │ .swarm/*.db        │   │  │ │ .claude/data/*.json     │ │
│ └────────────────────┘   │  │ │ - memory.json           │ │
│ ┌────────────────────┐   │  │ │ - graph-state.json      │ │
│ │ AgentDB (v3) RVF   │   │  │ │ - snapshots.json        │ │
│ │ .swarm/*.rvf       │   │  │ └─────────────────────────┘ │
│ │ - HNSW vectors     │   │  │ ┌─────────────────────────┐ │
│ │ - Self-learning    │   │  │ │ Trigram Matching        │ │
│ │ - Witness chain    │   │  │ │ Confidence Decay/Boost  │ │
│ └────────────────────┘   │  │ └─────────────────────────┘ │
└──────────┬───────────────┘  └──────────┬───────────────────┘
           │                             │
           │ (semantic search)           │ (PageRank context)
           │                             │
           └──────────────┬──────────────┘
                          ↓
                 ┌─────────────────────┐
                 │  User Queries       │
                 │  (MCP Tools)        │
                 │  memory_search()    │
                 │  memory_store()     │
                 └─────────────────────┘
                          ↑
                          │
           ┌──────────────┴──────────────┐
           │                             │
    ┌──────────────────────┐     ┌──────────────────────┐
    │ Daemon/Workers       │     │ Neural Module        │
    │ (consolidation,      │     │ (pattern learning,   │
    │  preload, decay)     │     │  reasoning bank)     │
    └──────────────────────┘     └──────────────────────┘
```

---

## Summary Table: What Exists vs What's Wired

| System | Component | Upstream | Patched | Defect |
|--------|-----------|----------|---------|--------|
| **Memory** | HybridBackend import | ❌ No | ✅ Yes | WM-001 |
| | AutoMemoryBridge hooks | ⚠️ Stubs | ✅ Yes | WM-003 |
| | Config wiring | ⚠️ 12 dead keys | ✅ Yes | WM-007 |
| | AgentDB v3 support | ❌ v2 only | ✅ v3 | WM-008 |
| | Self-learning feedback | ❌ No callers | ✅ Yes | WM-009 |
| | Witness chain verify | ❌ No callers | ✅ Yes | WM-010 |
| | ReasoningBank | ❌ Not instantiated | ✅ Yes | WM-011 |
| | HybridBackend proxies | ❌ No proxy | ✅ Yes | WM-012 |
| **Learning** | Intelligence.cjs | ⚠️ Stub | ✅ Real | IN-001 |
| | SONA learning | ⚠️ Hardcoded | ✅ Config | IN-001 + WM-007 |
| | Trajectory tracking | ⚠️ Stub methods | ✅ RuVector | RV-001, RV-002, RV-003 |
| **Config** | Config.json generation | ⚠️ Partial | ✅ Full | SG-008 |
| | V3-mode removal | ⚠️ Flag present | ✅ Removed | SG-009, CF-009 |
| **Daemon** | Worker pool | ⚠️ Stub | ✅ Active | DM-004, DM-005 |
| | Log rotation | ❌ No | ✅ Yes | DM-006 |

