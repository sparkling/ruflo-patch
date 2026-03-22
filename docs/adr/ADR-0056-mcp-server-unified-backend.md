# ADR-0056: MCP Server Unified Backend — RVF Primary, SQLite Fallback

**Status**: Proposed
**Date**: 2026-03-22
**Deciders**: System Architecture
**Methodology**: SPARC + MADR

---

## S - Specification

### Problem

The agentdb MCP server (`agentdb-mcp-server.ts`) uses `db-fallback.js` (sql.js WASM
SQLite) as its only storage backend. This was always intended as a fallback — the
codebase has a fully built `db-unified.ts` module that implements RuVector GraphDB
as primary with SQLite fallback, but the MCP server never adopted it.

Consequences of the current state:

1. **Brute-force vector search**: The server loads ALL embeddings from SQLite BLOBs,
   deserializes each Float32Array, computes cosine similarity in a JavaScript loop,
   sorts, returns top-k. O(n) per query. No HNSW indexing.

2. **No COW branching**: RVF provides native copy-on-write via `RvfDatabase.derive()`.
   SQLite has no equivalent. Consumers wanting branch/merge must implement it themselves.

3. **No graph queries**: The `db-unified.ts` module supports graph database operations
   via `@ruvector/graph-node`. The MCP server can't use them.

4. **Architectural gap**: Every other AgentDB consumer (CLI memory system, controller
   registry, tests) uses the backend factory or `db-unified.ts`. The MCP server is
   the only holdout on raw `db-fallback.js`.

### History

- `db-fallback.ts` was created as a fallback for **better-sqlite3** (native C++ bindings),
  eliminating the need for `python`/`make`/`g++` build tools.
- `db-unified.ts` was built later to transition from SQLite to RuVector GraphDB, with
  auto-detection by file extension (`.graph` vs `.db`), migration logic, and deprecation
  warnings for SQLite mode.
- The MCP server was written against `db-fallback.js` and never migrated.

### Goal

Adopt `db-unified.ts` in the MCP server so that:
- New databases use RuVector/RVF with HNSW vector search
- Existing `.db` files continue working via SQLite (backward compatible)
- COW branching becomes available through the graph backend
- Vector search uses HNSW when ruvector is installed, brute-force when not

---

## P - Pseudocode

### Current initialization (MCP server)

```
import { createDatabase } from '../db-fallback.js';
const db = await createDatabase(dbPath);
// All controllers get raw SQLite handle
const reflexion = new ReflexionMemory(db, embeddingService);
```

### Target initialization

```
import { createUnifiedDatabase } from '../db-unified.js';
import { createBackend } from '../backends/factory.js';
import { getEmbeddingConfig } from '../config/embedding-config.js';

const embCfg = getEmbeddingConfig();

// Unified database: auto-detects .graph vs .db, migrates if needed
const { db, graphDb, isGraphMode } = await createUnifiedDatabase(dbPath, {
  dimension: embCfg.dimension,
  embeddingService,
});

// Vector backend: auto-selects RuVector > RVF > HNSWLib > brute-force
const vectorBackend = await createBackend('auto', {
  dimension: embCfg.dimension,
  metric: 'cosine',
  storagePath: dbPath.replace(/\.(db|graph)$/, '.hnsw'),
});

// Controllers get both SQL handle AND vector backend
const reflexion = new ReflexionMemory(db, embeddingService, { vectorBackend });
const skills = new SkillLibrary(db, embeddingService, { vectorBackend });
// ... etc
```

### Branch operations (enabled by graph backend)

```
// When graphDb is available:
tool: agentdb_branch_create
  → graphDb.derive(branchName) or db.exec('INSERT INTO branches ...')

tool: agentdb_branch_query
  → search branch overlay first, fall back to parent

tool: agentdb_branch_merge
  → BEGIN IMMEDIATE; copy overlay → parent; DELETE branch; COMMIT
```

---

## A - Architecture

### Before (current)

```
MCP Server
    │
    └── db-fallback.js (sql.js WASM SQLite)
         └── Raw SQL for everything
              ├── episodes table (text + embedding BLOBs)
              ├── skills table
              ├── causal_edges table
              └── Vector search = brute-force JS loop
```

### After

```
MCP Server
    │
    ├── db-unified.js
    │    ├── .graph file → RuVector GraphDB (primary)
    │    │    ├── Graph queries
    │    │    ├── Native COW branching
    │    │    └── Structured storage
    │    │
    │    └── .db file → sql.js SQLite (fallback/legacy)
    │         └── Relational tables (episodes, skills, etc.)
    │
    └── backends/factory.js
         ├── RuVector backend → HNSW vector search (if installed)
         ├── RVF backend → .rvf file vector search
         ├── HNSWLib backend → Pure JS HNSW
         └── Brute-force fallback → cosine in JS loop
```

### What changes for consumers

| Consumer | Before | After |
|----------|--------|-------|
| New database | SQLite only | RuVector GraphDB + HNSW |
| Existing .db | SQLite | SQLite (unchanged, backward compatible) |
| Vector search | O(n) brute-force | HNSW O(log n) when ruvector installed |
| COW branching | Not available | Available via graph backend or SQLite tables |
| Relational queries | SQLite | SQLite (unchanged) |

---

## R - Refinement

### Files to change

**1. `agentdb-mcp-server.ts`** (primary change)

Replace the initialization block (~lines 220-280):

```typescript
// BEFORE:
import { createDatabase } from '../db-fallback.js';
const db = await createDatabase(dbPath);

// AFTER:
import { createUnifiedDatabase } from '../db-unified.js';
import { createBackend } from '../backends/factory.js';
import { getEmbeddingConfig } from '../config/embedding-config.js';

const embCfg = getEmbeddingConfig();
let db: any;
let vectorBackend: any = null;

try {
  const unified = await createUnifiedDatabase(dbPath, {
    dimension: embCfg.dimension,
  });
  db = unified.db;
} catch {
  // Fallback to raw SQLite if unified fails
  const { createDatabase } = await import('../db-fallback.js');
  db = await createDatabase(dbPath);
}

try {
  const { createBackend } = await import('../backends/factory.js');
  vectorBackend = await createBackend('auto', {
    dimension: embCfg.dimension,
    metric: 'cosine',
  });
} catch {
  // No vector backend available — brute-force fallback in controllers
}
```

Update controller initialization to pass `vectorBackend`:

```typescript
// Pass vectorBackend to controllers that support it
const reflexion = new ReflexionMemory(db, embeddingService, vectorBackend ? { vectorBackend } : undefined);
```

**2. Add 3 branch tools** (in the same file, tool array + switch cases):

- `agentdb_branch_create` — create named branch
- `agentdb_branch_query` — read from branch with parent fallback
- `agentdb_branch_merge` — atomic merge into parent

Branch implementation: SQLite-native with `branches` + `branch_entries` tables
when in SQLite mode, graph-native `derive()` when in graph mode.

**3. Branch schema** (inline in server, or separate SQL file):

```sql
CREATE TABLE IF NOT EXISTS branches (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  parent_id TEXT,
  created_at INTEGER DEFAULT (unixepoch()),
  status TEXT DEFAULT 'active',
  metadata TEXT
);

CREATE TABLE IF NOT EXISTS branch_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  branch_id TEXT NOT NULL REFERENCES branches(id),
  table_name TEXT NOT NULL,
  original_id INTEGER,
  content TEXT,
  embedding BLOB,
  created_at INTEGER DEFAULT (unixepoch())
);
```

### What NOT to change

- Do NOT remove `db-fallback.js` — it's still needed as the SQLite implementation
- Do NOT make `@ruvector/rvf` a required dependency — it stays optional
- Do NOT change the existing 32 tool definitions or handlers
- Do NOT change the SQL schema for existing tables (episodes, skills, etc.)

### Risk assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| `db-unified.ts` may have untested code paths | Medium | Wrap in try/catch, fall back to `db-fallback.js` |
| `createBackend` may fail if no vector packages installed | Low | Already handled — controllers fall back to brute-force |
| Existing `.db` files must keep working | High | `db-unified.ts` auto-detects and preserves SQLite mode |
| Branch merge atomicity | Medium | SQLite `BEGIN IMMEDIATE ... COMMIT` |
| `@ruvector/rvf` not installed in CI | Low | All changes are additive — brute-force fallback works without ruvector |

---

## C - Completion

### Implementation checklist

- [ ] Read `db-unified.ts` and `backends/factory.ts` to verify APIs
- [ ] Update MCP server initialization: `createDatabase` → `createUnifiedDatabase` with fallback
- [ ] Wire `vectorBackend` into controller constructors (ReflexionMemory, SkillLibrary, etc.)
- [ ] Add branch schema (CREATE TABLE IF NOT EXISTS)
- [ ] Add `agentdb_branch_create` tool + handler
- [ ] Add `agentdb_branch_query` tool + handler
- [ ] Add `agentdb_branch_merge` tool + handler
- [ ] Run `tsc --noEmit` on agentdb
- [ ] Run `npm run test:unit` (541/541)
- [ ] Run `npm run deploy` (56+/56+ acceptance)
- [ ] Push all repos

### Estimated effort

| Component | Lines |
|-----------|:-----:|
| Initialization refactor | ~30 |
| VectorBackend wiring | ~15 |
| Branch schema | ~20 |
| Branch tools (3 definitions) | ~60 |
| Branch handlers (3 cases) | ~120 |
| **Total** | **~245** |

### Success criteria

- Existing `.db` databases continue working unchanged
- New databases get HNSW vector search when ruvector is installed
- `agentdb_branch_create`, `agentdb_branch_query`, `agentdb_branch_merge` work
- 59/59 acceptance (56 existing + 3 new branch tests)
- No regressions on existing 32 MCP tools

---

## Consequences

### Positive

- Vector search goes from O(n) brute-force to O(log n) HNSW
- COW branching available via MCP for A/B experimentation
- MCP server aligns with the rest of the codebase (CLI, tests, controller-registry)
- The "db-fallback" name finally makes sense — it IS the fallback
- Consuming projects (Laika) get branch tools without implementing their own

### Negative

- More complex initialization (unified + fallback chain)
- RVF is optional — behavior differs depending on what's installed
- Branch tables add schema surface area
- Migration from `.db` to `.graph` happens automatically, which may surprise users

## Related

- **ADR-0052**: Config-driven embedding — provides `getEmbeddingConfig()` used for dimension
- **ADR-0055**: NightlyLearner + MCP tools — established the 41-tool pattern
- **ADR-0050**: Controller activation — established the deferred init pipeline
- **db-unified.ts**: The module that already implements this — just needs adoption
