# ADR-0110: Collective memory backend reconciliation

- **Status**: Investigating (no implementation choice made)
- **Date**: 2026-04-29
- **Roadmap**: ADR-0103 item 6
- **Scope**: README "Collective Memory" claim — backend (SQLite WAL vs RVF),
  LRU cache, and the conflation between hive shared-state and general agent
  memory.

## Context

README §Hive Mind Capabilities, line 217:

> 🧠 **Collective Memory**: Shared knowledge, LRU cache, SQLite persistence with WAL

Other sites in the same README repeat the SQLite-WAL framing:

- Line 408 (capabilities table): "Shared knowledge base with LRU cache, SQLite persistence, 8 memory types"
- Line 2365 (hive-mind detailed table): "8 memory types with TTL, LRU cache, SQLite WAL"

Memory `project-rvf-primary.md` (canonical statement, refreshed
2026-04-11) says:

> RVF (Rust Vector Format) is the primary storage backend. SQLite is
> fallback only. New storage features should target RVF, not add more
> SQLite tables.

The fork's actual storage architecture (per ADR-0086 Phase 4 complete,
ADR-0095 inter-process convergence, embeddings.json template):

- **Primary**: RVF backend (`@ruvector/rvf-node` native HNSW + pure-TS
  fallback) at `.swarm/memory.rvf`.
- **Fallback**: SQLite backend (`better-sqlite3`) — code path exists
  but `storage-factory.createStorage()` does NOT route to it. The factory
  goes RVF or throws.

So the README documents the *fallback-only* backend as the primary
persistence story, and omits the actual primary entirely. The functional
surface is similar/better (RVF has native HNSW vector indexing, sub-ms
search, append-only WAL — see ADR-0086 §RvfBackend); the doc just doesn't
match the code.

## Investigation findings

### Memory subsystem inventory (`forks/ruflo/v3/@claude-flow/memory/src/`)

| File | Role |
|---|---|
| `rvf-backend.ts` | **Primary** — `RvfBackend` implements `IStorageContract`; native `@ruvector/rvf-node` HNSW with pure-TS `HnswLite` fallback. Append-only WAL (`DEFAULT_WAL_COMPACTION_THRESHOLD = 100`). |
| `storage-factory.ts` | `createStorage()` / `createStorageFromConfig()` — RVF-only path. Header: "The factory NEVER silently falls back to InMemoryStore — a failed initialization is always surfaced to the caller." |
| `sqlite-backend.ts` | `SQLiteBackend` exists, used by `database-provider.ts`, but NOT reachable through `storage-factory.ts`. Line 405 self-warning: `'SQLiteBackend.search(): Vector search not optimized. Use RvfBackend for semantic search.'` |
| `cache-manager.ts` | `CacheManager<T>` — O(1) LRU with TTL, memory-pressure eviction, stats. Defaults: `maxSize: 10000`, `ttl: 300000ms`. `TieredCacheManager` adds optional L2 loader/writer. |
| `agentdb-backend.ts` | AgentDB compatibility shim (per ADR-0059 — `.swarm/memory.db` for relational/controllers, NOT vector primary). |
| `resolve-config.ts` | Config chain. `DEFAULT_STORAGE_PROVIDER: 'rvf'`, `DEFAULT_DATABASE_PATH: '.claude-flow/memory.rvf'`. |

### What is the actual primary backend?

**RVF.** Three independent confirmations:

1. **Config chain default**: `resolve-config.ts:89` — `const DEFAULT_STORAGE_PROVIDER: 'rvf' | 'better-sqlite3' = 'rvf';`
2. **Init template**: `.claude-flow/embeddings.json` ships with `"storageProvider": "rvf"`, `"databasePath": ".swarm/memory.rvf"`.
3. **Factory routing**: `storage-factory.ts:80-179` — only path is `await import('./rvf-backend.js')` then `new RvfBackend(...)`. No SQLite branch.

The MCP `memory_store` / `memory_retrieve` / `memory_search` tools route through `memory-router.ts`, which calls `createStorage()` from the factory — so all general-memory writes land in RVF.

### SQLite WAL claim — verification

SQLite *does* enable WAL when invoked (`sqlite-backend.ts:118-122` — `journal_mode = WAL`, NORMAL sync, 64MB cache). But the WAL claim is structurally misleading: production callers route through `storage-factory.ts` (RVF-only), not `database-provider.ts` (where SQLite lives). The `.swarm/memory.db` file exists per ADR-0059 (AgentDB relational controllers, `memory_entries` table), but is NOT the vector/KV target for `memory_store`. RVF has its own WAL (`rvf-backend.ts:26` — append-only, compacted at threshold 100). Functionally equivalent durability, completely different on-disk layout.

### LRU cache claim — verification

✅ Real and load-bearing. `cache-manager.ts` is a textbook O(1) doubly-linked-list LRU with TTL, memory-pressure eviction, and statistics. Used by controllers and the auto-memory bridge.

### Hive shared-state vs general agent memory — the conflation

The README's "Collective Memory" sentence mixes two distinct subsystems:

| Subsystem | MCP tool | Storage | Persistence |
|---|---|---|---|
| **Hive shared-state** (workers under one Queen) | `mcp__ruflo__hive-mind_memory` | `state.sharedMemory: Record<string, unknown>` field in `.claude-flow/hive-mind/state.json` (plain JSON file, lock-protected per ADR-0104 §5) | JSON write under `withHiveStoreLock` |
| **General agent memory** (cross-session, semantic search) | `mcp__ruflo__memory_store` / `_retrieve` / `_search` | RVF (`.swarm/memory.rvf`) via `createStorage()` | RVF append-only WAL + native HNSW |

The hive-state JSON is intentionally simple — it's transient coordination
state for one objective's lifetime. The README's "8 memory types with TTL,
LRU cache, SQLite WAL" describes none of:

- The JSON `sharedMemory` field (no TTL, no LRU, no SQLite, no types).
- The RVF backend (HNSW + append-WAL + LRU cache, but not SQLite).
- The SQLite fallback (which exists but is unreachable from production paths).

### Upstream ADRs cross-referenced

- **ADR-0059 (Implemented)**: RVF Native Storage Backend. Establishes the two-store split: `.swarm/memory.rvf` for vectors/KV, `.swarm/memory.db` for relational AgentDB controllers only.
- **ADR-0086 (Complete)**: Layer 1 Storage Abstraction (RVF-First). Eliminated `memory-initializer.ts`, made RVF the single primary path.
- **ADR-0095**: RVF inter-process convergence — caches by resolved path so multiple processes share state.

The fork's ADR record is unanimous: RVF is primary, SQLite is fallback. The README is the only artifact that says otherwise.

## Current state verdict

| Claim | Reality | Status |
|---|---|---|
| "Collective Memory" exists | Two distinct subsystems (hive-state JSON + general RVF memory) | ⚠️ Conflated |
| "Shared knowledge" | Hive: JSON `sharedMemory` field. General: RVF KV+vector | ✅ Both real, different shapes |
| "LRU cache" | `CacheManager` is a real O(1) LRU with TTL | ✅ Accurate |
| "SQLite persistence with WAL" — for general memory | General memory writes go to RVF, not SQLite | ❌ Wrong backend named |
| "SQLite persistence with WAL" — for hive shared-state | Hive state is plain JSON file | ❌ Wrong backend named |
| "8 memory types" | Memory types enum exists in `types.ts` | ⚠️ Not verified per type — out of scope |
| "TTL" | `CacheManager` and SQLite backend support TTL; RVF stores TTL on entries | ✅ Accurate |

## Decision options

### Option A — Doc correction only (deflationary)

Update the three README sites to name RVF as primary:

- Line 217: "🧠 **Collective Memory**: Shared knowledge across agents, LRU cache (10k entries, 5-min TTL), RVF persistence with append-only WAL and native HNSW indexing."
- Line 408: "Shared knowledge base with LRU cache, RVF persistence (HNSW vector index), 8 memory types."
- Line 2365: "8 memory types with TTL, LRU cache, RVF + WAL."

No code change. Closes the doc-vs-code mismatch.

Effort: README diff + ADR-0101 fork-README delta prelude.

### Option B — Add a SQLite-WAL adapter behind a feature flag

Make the storage factory honor `storageProvider: 'better-sqlite3'` from
`embeddings.json`. Users who *want* SQLite specifically (operational
familiarity, external tooling, etc.) can opt in. Default stays RVF.

Effort: ~30 LOC in `storage-factory.ts` to branch on `config.storageProvider`,
plus paired tests. Risk: the SQLite backend's vector search is not optimized
(line 405 self-warning) — opt-in users would silently get worse semantic
search unless we surface that.

### Option C — Reorganize the README into two distinct claims

Split "Collective Memory" into:

1. **Hive shared-state** (workers under one Queen, single objective):
   "JSON-backed `sharedMemory` map under file lock per ADR-0104 §5; lifecycle
   tied to the hive run."
2. **General agent memory** (cross-session, semantic):
   "RVF persistence with HNSW vector index, LRU cache, native sub-ms
   semantic search."

Effort: README rewrite of the Hive Mind capabilities section + cross-link
to the Intelligence & Memory section.

### Option D — Hybrid (recommended): A + C

Fix the SQLite/RVF naming (A) AND clarify which subsystem is which (C).
This is the smallest set of edits that leaves no false claims and no
conflations. No code change.

The SQLite fallback path (Option B) stays a separate, deferrable decision
— the existing `storageProvider: 'better-sqlite3'` knob in resolve-config
is already plumbed; only the factory wiring is missing.

## Test plan

Per `feedback-all-test-levels.md`: unit + integration + acceptance.

**Regression** (automated, runs in `test:acceptance`):

1. `embeddings.json` from `init --full` reports `"storageProvider": "rvf"` and `"databasePath"` ends in `.rvf` (Phase 5 init validation surface — confirm explicit assertion in `lib/acceptance-*.sh`).
2. After `mcp__ruflo__memory_store({key,value,namespace})`, assert `.swarm/memory.rvf` exists and grew; NO `.db`-only write for general memory.
3. RVF WAL invariant: write 100+ entries, observe compaction threshold trigger.
4. Hive shared-state: `mcp__ruflo__hive-mind_memory({action:'set'})` writes to `.claude-flow/hive-mind/state.json` `sharedMemory`, NOT to `.swarm/memory.rvf`.

**Live smoke** (developer's `claude` CLI; no API costs):

1. Fresh `init --full`; `npx ruflo memory store key=foo value=bar namespace=test`; verify `.swarm/memory.rvf` byte size > 0.
2. Spawn a hive (`hive-mind spawn --claude "small objective" --max-workers 2`); verify `state.json` `sharedMemory` populated, no new `.rvf` writes from hive coordination.

**Unit** (in ruflo-patch `tests/unit/`, paired with acceptance lib per ADR-0097):

- `acceptance-adr0110-memory-backend-checks.test.mjs` paired with `lib/acceptance-adr0110-checks.sh`.
- Asserts embeddings.json template invariants and that `storage-factory.ts` rejects unknown `storageProvider` values (no silent fallback per `feedback-no-fallbacks.md`).

## Implementation plan

If Option D (recommended):

1. **Fork README edits** (lines 217, 408, 2365): replace "SQLite persistence with WAL" with "RVF persistence (native HNSW, append-only WAL)"; keep LRU cache + TTL framing.
2. **Hive Mind section restructure** (around line 213-218): split "Collective Memory" into two lines — hive shared-state (JSON, ADR-0104 §5 lock) and general agent memory (RVF, HNSW, ADR-0086).
3. **CLAUDE.md (fork)**: existing `Memory: hybrid (RVF primary; SQLite fallback only)` is already correct.
4. **Tests**: all three levels per `feedback-all-test-levels.md`.
5. **ADR-0101 fork-README delta prelude**: add reconciliation block so downstream forks pick it up.
6. **Companion ruflo-patch commit**: `lib/acceptance-adr0110-checks.sh` + paired test.

If Option B (feature-flag SQLite) is ever revisited, the wiring point is `storage-factory.ts:80-179` — branch on `config.storageProvider` before the `import('./rvf-backend.js')` call. Surface a clear warning when SQLite is chosen (vector search is brute-force O(n) per `sqlite-backend.ts:405`).

## Risks / open questions

- **R1 — Existing `.swarm/memory.db` users**: ADR-0059 documents the two-store split as intentional. SQLite still exists for AgentDB controllers and the `memory_entries` relational table. The doc fix must NOT imply we're removing SQLite — only that it's not the vector/KV primary.
- **R2 — SQLite fallback is currently unreachable**: per `feedback-no-fallbacks.md`, an unreachable fallback is worse than no fallback. Either wire `storageProvider: 'better-sqlite3'` to a real branch (Option B) or delete the fallback code (separate cleanup ADR).
- **R3 — RVF migration path**: not on the critical path. RVF has been primary since ADR-0086 completed; no SQLite-primary build ever shipped to migrate from.
- **R4 — "8 memory types" claim**: not verified here. Out of scope; covered separately if a discrepancy emerges.

## Out of scope

- Implementing Option B (feature-flag SQLite primary) — separate ADR if needed.
- Verifying the "8 memory types" claim — separate ADR if a discrepancy
  surfaces.
- Removing the SQLite backend code entirely — separate cleanup ADR; the
  AgentDB relational side still uses it per ADR-0059.
- Migration tooling for SQLite-primary → RVF-primary — not needed; RVF
  has been primary since ADR-0086.
- README rewrite of the broader capabilities table — covered by ADR-0101.

## Recommendation

Ship **Option D**. The SQLite-WAL claim is a doc bug, not a code bug —
RVF already provides everything the README promises (LRU cache, WAL
persistence, durable shared knowledge), plus native HNSW the README
doesn't mention. Fix the README copy in three places, split the
"Collective Memory" claim into hive-state vs general-memory, ship paired
tests asserting RVF is the actual write target.

Defer Option B (feature-flag SQLite primary) until a user actually asks
for it — speculative configurability is the kind of complexity CLAUDE.md
"Simplicity First" tells us to skip.
