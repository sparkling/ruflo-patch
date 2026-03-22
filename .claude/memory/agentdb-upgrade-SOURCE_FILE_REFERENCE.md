# Source File Reference

## Patch Fixtures (Tests)

These are **minimal but complete** code samples showing exactly what the patches modify:

### Memory System Fixtures
```
tests/fixtures/cli/dist/src/memory/
├── memory-initializer.js       # HybridBackend initialization + adapters (WM-001)
│                               # Config reading (WM-007a)
│                               # HNSW config (WM-007, WM-008)
│
└── intelligence.js             # V3 Intelligence module (fixture)
                                # DEFAULT_SONA_CONFIG (WM-007b)
                                # getDataDir() (WM-007c)

tests/fixtures/memory/dist/
└── agentdb-backend.js          # AgentDB v2 backend class (WM-008 starting point)
                                # EventEmitter with initialize/shutdown
                                # Store/get/query methods

tests/fixtures/shared/dist/core/config/
└── defaults.js                 # Shared config defaults (WM-008n target)

tests/fixtures/neural/dist/
└── reasoning-bank.js           # ReasoningBank with AgentDB (WM-008m target)
                                # vectorBackend: 'auto' → 'rvf'
```

### Init System Fixtures
```
tests/fixtures/cli/dist/src/init/
├── executor.js                 # Config template writing (WM-008h)
│                              # Helper copy logic (IN-001)
│
├── helpers-generator.js        # auto-memory-hook.mjs generator (WM-003)
│                              # Intelligence stub generator (IN-001)
│
├── types.js                    # Type definitions (reference)
│
├── settings-generator.js       # Settings generation
│
└── claudemd-generator.js       # CLAUDE.md generation

tests/fixtures/cli/dist/src/
├── index.js                    # Module exports
│
├── commands/
│   ├── config.js              # Config get/export (CF-004)
│   ├── doctor.js              # Native dependency checking (CF-003)
│   ├── init.js                # Init command
│   ├── daemon.js              # Daemon management
│   ├── start.js               # Swarm startup (WM-007d target)
│   ├── memory.js              # Memory CLI commands
│   ├── neural.js              # Neural commands
│   ├── hooks.js               # Hooks commands
│   └── index.js               # Command registry
│
└── mcp-tools/
    ├── memory-tools.js        # MCP handlers for memory ops
    ├── hooks-tools.js         # MCP handlers for learning (WM-007e target)
    ├── embeddings-tools.js    # Embedding cache config (WM-007f target)
    └── neural-tools.js        # Neural module MCP handlers
```

### Source Helpers (Copied to Projects)
```
.claude/helpers/
├── intelligence.cjs           # Full 916-line PageRank + learning (IN-001 target)
│                             # vs. 197-line stub
│
├── auto-memory-hook.mjs      # Session import/sync (WM-003 target)
│                             # doImport() + doSync() + doStatus()
│
├── hook-handler.cjs          # Hook event processors
├── session.cjs               # Session lifecycle
├── router.cjs                # Agent routing logic
├── memory.cjs                # Memory helper functions
└── pre-commit                # Git hook
```

---

## Key Patch Files

### Memory Wiring (WM-001)

**File**: `patch/350-WM-001-memory-wiring/fix.py`

**Changes to**: `memory/memory-initializer.js`

**What it does**:
```python
# Op 1: Module-level instance + HybridBackend early-return (WM-001a-e)
patch("WM-001a-e: HybridBackend early-return branch in initializeMemoryDatabase")
    # Before try block, add:
    # - _hybridBackend module variable
    # - HybridBackend import from @claude-flow/memory
    # - Config reading (absorbs WM-005)
    # - Embedding model pre-load
    # - PRAGMA busy_timeout
    # - Process shutdown handlers

# Op 2-6: Adapter functions (WM-001b)
patch("WM-001b: storeEntry HybridBackend adapter")
patch("WM-001b: searchEntries HybridBackend adapter")
patch("WM-001b: listEntries HybridBackend adapter")
patch("WM-001b: getEntry HybridBackend adapter")
patch("WM-001b: deleteEntry HybridBackend adapter")
```

### Auto-Memory Bridge (WM-003)

**File**: `patch/370-WM-003-auto-memory-bridge/fix.py`

**Changes to**:
- `init/helpers-generator.js` (3 ops)
- `.claude/helpers/auto-memory-hook.mjs` (5 ops)

**What it does**:
```python
# Ops 1-3: Template stub replacements in helpers-generator.js
patch("WM-003a: doImport() — full AutoMemoryBridge import")
    # Replace stub with HybridBackend initialization
    # Call bridge.importFromAutoMemory()

patch("WM-003b: doSync() — full AutoMemoryBridge sync")
    # Replace stub with HybridBackend initialization
    # Call bridge.syncToAutoMemory()

patch("WM-003c: doStatus() — real bridge status")
    # Replace status stub with real metrics

# Ops 4-6: Source hook file updates (.claude/helpers/auto-memory-hook.mjs)
patch("WM-003d/e/f: source hook doImport/doSync/doStatus — HybridBackend upgrade")
patch("WM-003g/h: source hook busy_timeout (createBackend variant)")
```

### Intelligence Fix (IN-001)

**File**: `patch/170-IN-001-intelligence-stub/fix.py`

**Changes to**: `init/executor.js`

**What it does**:
```python
# Op 1: Upgrade path (when findSourceHelpersDir() fails)
patch("IN-001a: upgrade fallback reads real intelligence.cjs")
    # Try reading real file from package path
    # Fall back to stub only if file not found

# Op 2: Fresh init path
patch("IN-001b: writeHelpers fallback reads real intelligence.cjs")
    # Try reading real file from package path
    # Fall back to stub only if file not found
```

### Config Wiring (WM-007)

**File**: `patch/530-WM-007-wire-dead-config-keys/fix.py`

**Changes to**: Multiple files
- `memory/memory-initializer.js` (op a)
- `memory/intelligence.js` (ops b, c)
- `commands/start.js` (op d)
- `mcp-tools/hooks-tools.js` (op e)
- `mcp-tools/embeddings-tools.js` (op f)

**What it does**:
```python
patch("WM-007a: memory-initializer reads cacheSize/enableHNSW from config.json")
patch("WM-007b: intelligence.js reads sonaMode/decay/threshold/pageRank from config")
patch("WM-007c: intelligence.js reads neural.modelPath from config")
patch("WM-007d: start.js reads swarm.coordinationStrategy from config")
patch("WM-007e: hooks-tools.js reads hooks.enabled from config")
patch("WM-007f: embeddings-tools.js reads memory.cacheSize from config")
```

### AgentDB v3 Upgrade (WM-008)

**File**: `patch/560-WM-008-agentdb-v3-upgrade/fix.py` + `fix.sh`

**Changes to**: Multiple packages/files
- `@claude-flow/memory/agentdb-backend.js` (ops A-F, J)
- `@claude-flow/memory/package.json` (op I)
- `@claude-flow/cli/memory/memory-initializer.js` (op G)
- `@claude-flow/cli/init/executor.js` (ops H, O)
- `@claude-flow/cli/init/helpers-generator.js` (op K)
- `@claude-flow/cli/.claude/helpers/auto-memory-hook.mjs` (op L)
- `@claude-flow/neural/reasoning-bank.js` (op M)
- `@claude-flow/shared/defaults.js` (op N)

**What it does**:
```python
# Op A: vectorBackend 'auto' → 'rvf'
patch("WM-008a: agentdb-backend.js vectorBackend 'auto' → 'rvf'")

# Op B: Add save() before close()
patch("WM-008b: agentdb-backend.js shutdown with save()")

# Ops C-F: Add learning methods
patch("WM-008c: agentdb-backend.js import SelfLearningRvfBackend")
patch("WM-008d: agentdb-backend.js create learning backend")
patch("WM-008e: agentdb-backend.js recordFeedback() method")
patch("WM-008f: agentdb-backend.js witness chain methods")

# Op G: memory-initializer paths + config
patch("WM-008g: memory-initializer .db → .rvf + vectorBackend config")

# Op H: executor config template
patch("WM-008h: executor.js config template + agentdb section")

# Op I: package.json version
patch("WM-008i: @claude-flow/memory package.json agentdb v2 → v3")

# Op J: Header comment
patch("WM-008j: agentdb-backend header version comment")

# Ops K-L: helpers and hooks paths/config
patch("WM-008k: helpers-generator.js .db → .rvf")
patch("WM-008l: auto-memory-hook.mjs .db → .rvf")

# Op M: reasoning-bank vectorBackend
patch("WM-008m: reasoning-bank.js vectorBackend 'auto' → 'rvf'")

# Op N: shared defaults
patch("WM-008n: shared defaults.js vectorBackend field")

# Op O: version table
patch("WM-008o: executor.js version table v2 → v3")
```

---

## Configuration Template (from executor.js)

Generated by `writeRuntimeConfig()` in executor.js:

```json
{
  "version": "3.1.0-alpha.41",
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
  },
  "neural": {
    "enabled": true,
    "modelPath": ".claude-flow/neural"
  },
  "swarm": {
    "topology": "hierarchical|mesh|ring|star",
    "maxAgents": 12,
    "autoScale": true,
    "coordinationStrategy": "consensus|raft|byzantine"
  },
  "agentdb": {
    "vectorBackend": "rvf|auto|hnsw",
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

---

## Runtime Entry Points

### Memory Initialization
```
commands/init.js
  → init/executor.js: executeInit()
    → init/settings-generator.js: generateRuntimeConfig()
    → EXECUTOR writes config.json

Later, on first run:
memory/memory-initializer.js: initializeMemoryDatabase()
  → Reads config.json
  → WM-001: HybridBackend import + init
  → Returns { success, backend, features: {...} }
```

### Session Lifecycle
```
.claude/settings.json: hooks.session_start
  → auto-memory-hook.mjs: doImport()
    → WM-003: HybridBackend + AutoMemoryBridge
    → bridge.importFromAutoMemory()

[user works]

.claude/settings.json: hooks.session_end (or manual call)
  → auto-memory-hook.mjs: doSync()
    → WM-003: HybridBackend + AutoMemoryBridge
    → bridge.syncToAutoMemory()
```

### Query Path
```
User query via MCP
  ↓
mcp-tools/memory-tools.js: memory_search(query)
  ↓
memory/memory-initializer.js: searchEntries()
  → WM-001: HybridBackend.querySemantic()
    → AgentDB HNSW vector search
  → Fallback: HybridBackend.query(type: 'structured')
    → Keyword matching
  ↓
Merge + return results
```

### Learning Path
```
Daemon consolidation worker (from worker-daemon.js)
  ↓
memory/intelligence.js: initializeIntelligence()
  → Load .claude/data/graph-state.json
  ↓
intelligence.consolidate()
  → Rebuild PageRank graph
  → Decay stale nodes
  → Extract patterns
  ↓
For each pattern:
  storeEntry(namespace: "patterns") → HybridBackend
```

---

## Data Files on Disk

### Project Root
```
.claude-flow/
├── config.json           # Runtime config (19 keys) — generated by init
├── neural/              # Neural module data
│   ├── data/
│   └── models/

.swarm/
├── hybrid-memory.db     # SQLite K-V store (WM-001, WM-008)
├── agentdb-memory.rvf   # AgentDB v3 vector index (WM-008)
├── memory.db           # Legacy sql.js database (fallback only)
└── [pid].log           # Daemon logs (one per worker)

.claude/
├── data/
│   ├── memory.json      # K-V store for intelligence.cjs
│   ├── graph-state.json # PageRank graph + scores
│   └── intelligence-snapshot.json # Trend tracking (max 50)
│
├── helpers/
│   ├── intelligence.cjs # Full PageRank (IN-001 target)
│   ├── auto-memory-hook.mjs # Session sync (WM-003 target)
│   ├── hook-handler.cjs
│   ├── session.cjs
│   ├── router.cjs
│   ├── memory.cjs
│   └── pre-commit
│
└── settings.json        # Hook configuration
```

### User Home
```
~/.claude/
└── memory/
    ├── *.json           # Auto-memory entries (synced by WM-003)
    └── index.json       # Metadata

~/.cache/huggingface/
└── models/              # Embedding model cache
    ├── all-MiniLM-L6-v2/
    │   ├── model.onnx
    │   ├── config.json
    │   └── tokenizer.json
    └── all-mpnet-base-v2/
        ├── model.onnx
        └── ...
```

---

## Patch Execution Order

```
010-IN-001    [IN-001 dependency: intelligence.cjs loaded]
...
170-IN-001    Read real intelligence.cjs from package
...
190-NS-001    [Memory namespace fixes]
200-NS-002
210-NS-003
...
230-RV-001    [RuVector trajectory fixes]
240-RV-002
250-RV-003
...
270-SG-003    [Init config generation — depends on IN-001]
...
350-WM-001    [Wire HybridBackend — core memory system]
360-WM-002    [Neural config gating]
370-WM-003    [AutoMemoryBridge hooks]
390-WM-004    [Source hook fail loud]
400-WM-005    (absorbed into WM-001)
410-WM-006    (absorbed into WM-002)
...
530-WM-007    [Wire dead config keys]
560-WM-008    [AgentDB v3 upgrade]
```

(Execution order determined by numeric prefix; dependencies expressed by numeric spacing)
