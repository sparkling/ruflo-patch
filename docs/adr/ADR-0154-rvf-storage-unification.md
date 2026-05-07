# ADR-0154: RVF storage unification — remove `.meta` sidecar, align with upstream ADR-029

- **Status**: **Accepted** 2026-05-07 — implementation underway. Aligns the fork with upstream rUv vision (RuVector ADR-029) and resumes the fork's own original ADR-0057 single-file plan that was deferred during the 2026-04-18 emergency workaround.
- **Date**: 2026-05-07
- **Deciders**: Henrik Pettersen
- **Decision**: Adopt **Option 1** from §"Real options" — implement single-file unification per upstream ADR-029. Native is the canonical implementation; pure-TS becomes a thin wrapper around native segment APIs; the `.meta` sidecar is deleted entirely. Options 2 (drop native) and 3 (status quo) explicitly rejected — Option 2 sacrifices alignment with the canonical ruvnet design without empirical justification; Option 3 leaves the bug class alive.
- **Related**: ADR-0095 (RVF inter-process convergence — superseded for the dual-write portion), ADR-0057 fork (original single-file plan, now resumed), upstream `ruvnet/RuVector` ADR-029 (canonical RVF format mandate), upstream ADR-001 (superseded prior split design)

## Context

A 4-agent adversarial swarm investigated the fork's current dual-file storage layout (`memory.rvf` SFVR + `memory.rvf.meta` RVF\0) against upstream design intent and the fork's own original plans. **Verdict: the dual-file design is implementation drift from a now-fixed bug, not architecture.**

### Forensic timeline

| Date | Event |
|---|---|
| upstream | RVF designed as ONE file; `META_SEG (0x07)` is a first-class segment for metadata inside `.rvf` (ADR-029, segment-model spec) |
| fork ADR-0057 | original plan also single-file: `memory.rvf` with VEC_SEG + KV_SEG |
| 2026-04-18 (ADR-0095 d5 amendment) | native `RvfStore::create` raced with `InvalidChecksum 0x0102` errors. **Workaround**: write JS-controlled `.meta` sidecar so data survived when native ingest failed. Fork-only. Documented in `rvf-backend.ts:147-163` as a "loud fallback". |
| 2026-05-01 (ADR-0095 d12+d13+d14) | underlying `RvfStore::create` race FIXED. 40/40 PASS at `@sparkleideas/cli@patch.302`. |
| today | `.meta` sidecar code still ships. Race-driven workaround outlived the race by 6+ days. Has accumulated its own bug class. |

### What the swarm found

**rUv's vision (Agent 2):** *"One file. Store vectors. Ship models. Boot services. Prove everything."* (`crates/rvf/README.md`). ADR-029 mandates *"All libraries MUST use RVF as their storage and interchange format"* — explicitly citing the dual-format pattern as **the fragmentation problem RVF solves**. The only `.meta.json` reference upstream is for examples-catalog tooling, unrelated to runtime storage. ADR-001 (which had a split design) carries an explicit superseded banner.

**Format spec (Agent 3):** the native binding **already supports metadata storage**:
- `rvf-types/src/segment_type.rs:24-25` — `SegmentType::Meta = 0x07` and `SegmentType::MetaIdx = 0x0D` reserved
- `rvf-runtime/src/options.rs:190-207` — `MetadataValue::Bytes(Vec<u8>)` carries arbitrary payloads
- `rvf-runtime/src/write_path.rs:102-111` — `write_meta_seg(metadata_payload: &[u8])`
- `rvf-node/src/lib.rs:476-480` — `ingestBatch(vectors, ids, metadata)` napi already accepts metadata
- `index.d.ts:178-180` — exposed to TypeScript

The current `rvf-backend.ts:496` calls `ingestBatch(vector, [numId])` — **third argument (metadata) omitted**. That's the entire reason the `.meta` sidecar exists.

**Adversarial review (Agent 4):**
- "10-100x faster" — **falsified**. The figure traces to vs simulated Python/brute-force, not vs pure-TS HnswLite. Native-vs-pure-TS HNSW unbenchmarked.
- Embeddings are **duplicated** in both files (2x write amplification at `rvf-backend.ts:2687-2696`).
- `.meta` is **authoritative**, not native. `rvf-backend.ts:707-727` — native search returns only `{id, distance}`; entry data comes from `this.entries` populated from `.meta`.
- Native is **structurally dependent** on `.meta`. Without `.meta`, `nativeReverseMap.get(id)` returns undefined, every result dropped as orphan. Line 745 explicitly admits *"Long-term fix is to persist nativeIdMap in .meta."*
- Native is a write-through cache; **`.meta` is the truth**.

### The fork-invented `RVF\0` magic

`rvf-backend.ts:54: const MAGIC = 'RVF\\0'` is **fork-only**. Upstream uses `SEGMENT_MAGIC: u32 = 0x5256_4653` → `b"RVFS"` BE / `b"SFVR"` LE (`RuVector/crates/rvf/rvf-types/src/constants.rs:3-4`). The dual-magic peek logic in `loadFromDisk` and `tryNativeInit` exists only because the fork invented its own format to write metadata that should have been in upstream's `META_SEG`.

## Decision

Align with upstream ADR-029 and the fork's own original ADR-0057 plan: **single `.rvf` file, metadata stored in `META_SEG` segments inside, sidecar removed entirely.**

### Migration path (concrete, ordered)

1. **Native crate extension** (~5 LoC) — `rvf-node/src/lib.rs:328-357` `parse_metadata_entry` is missing the `"bytes"` branch even though Rust supports `MetadataValue::Bytes`. Add it.
2. **Stable `field_id: u16` registry** — reserve IDs for MemoryEntry fields (`key=1`, `namespace=2`, `content=3`, `tags-json=4`, `metadata-json=5`, `entry-blob=99` for the full serialized record minus embedding). Pure config; no format change.
3. **Rework `rvf-backend.ts:persistToDiskInner`** — build `RvfMetadataEntry[]` per vector, pass to `ingestBatch` as 3rd arg at all 3 call sites (lines 496, 822, 1613).
4. **Rework `loadFromDisk`** — read entries from native segments via query/iteration. Delete the `.meta` parse path and the WAL replay path's role in metadata reconstruction.
5. **Delete dead code**:
   - `metadataPath` getter (the whole conditional construct that ADR-0153 just simplified)
   - `MAGIC = 'RVF\0'` constant + dual-magic peek logic in `loadFromDisk`
   - The pure-TS persist branch at lines 2673-2702
   - `_deferredCorruptReason` and the fallback machinery
   - The fork-only legacy fall-through (rvf-backend.ts:2293-2328) — redundant once metadata lives in segments
6. **Bump native dep** — `@ruvector/rvf-node` (or `@sparkleideas/ruvector-rvf-node` post-codemod) to a version that includes the `parse_metadata_entry` "bytes" branch from step 1.

### Acceptance criteria

- [ ] One file per project: `${project}/.swarm/memory.rvf` (no `.meta`, no `.wal` for metadata)
- [ ] `loadFromDisk` reads via native segment iteration; never touches a `.meta` path
- [ ] `persistToDiskInner` writes via `ingestBatch(vectors, ids, metadata)`; never serializes JSON to disk independently
- [ ] `MAGIC = 'RVF\0'` constant deleted; the only valid magic on disk is upstream's `SFVR`
- [ ] Test: write 200 entries, kill process, restart → 200 entries readable
- [ ] Test: cross-process concurrent write (the bug class that drove ADR-0095) → 100% durability
- [ ] Memory package size shrinks (deleted code path)
- [ ] No `.meta` file ever appears on disk for new projects

### Bug class eliminated

| Bug | Source |
|---|---|
| Orphan-numId in HNSW search | numId-vs-string ID split between native and `.meta` |
| Asymmetric writer/reader (ADR-0153 R6) | `metadataPath` returning different paths in different modes |
| Atomic-rename ENOENT (ADR-0153 R7) | shared `${path}.tmp` filename for parallel writers — disappears with single canonical write |
| HM-style legacy migration | only one format on disk; no migration to navigate |
| `RvfStore::create` race remnants | already fixed at patch.302; remaining workaround code goes away |

### HM hejlsberg case study (real-world manifestation of the bug class)

The `hm/semantic-modelling/.claude/worktrees/snappy-drifting-hejlsberg` project exhibited every failure mode the dual-file design produces. Capturing it here so future readers see the concrete impact and the remediation chain.

#### What happened

After ADR-0147 work (R6 read-arm fallback + RVF symmetric metadataPath) deployed via `@sparkleideas/cli@3.5.58-patch.388`, HM's storage state was:

```
memory.rvf       — 14MB, RVF\0 magic, header.entryCount = 863  (live, today 18:12)
memory.rvf.meta  — 5.5MB, RVF\0 magic, header.entryCount = 329  (stale, today 11:12)
```

The 863 entries represented a wipe-and-reindex session of all 231 ADRs (with hierarchical-store + causal-edge + memory_store per ADR producing ~611 derived edges) — the user's actual current work. The 329 was a 4-day-old stale snapshot.

User restarted Claude Code → MCP server reload → `loadFromDisk` ran the dual-magic peek logic → found `.meta` exists → preferred it → loaded 329 entries → **the 863-entry re-index session was invisible**. `agentdb_causal_query cause=ADR-0167` returned 0; `memory_search` showed 329 unrelated entries.

#### Mapping to the bug class ADR-0154 eliminates

| HM symptom | Root cause in dual-file design |
|---|---|
| `causal_query` returns 0 for known edges | Loader pulled stale `.meta` (329) instead of live `.rvf` (863) — the asymmetric writer/reader (ADR-0153 R6) gap |
| Re-index session work invisible across MCP restart | `metadataPath` getter returned different paths in different modes; old asymmetric writer wrote to main path, new loader preferred `.meta` |
| Recovery required moving `.meta` aside | Loader's pre-existing fall-through (`if no .meta, peek main path for RVF\\0`) is the only escape from the dual-file trap; that fall-through is itself dead-end code post-unification |
| Risk of further data loss on every restart | Each restart could trigger compactWal → overwrite the 14MB `.rvf` with 329-state in-memory snapshot → permanent loss of the 534 missing entries |
| Orphan MCP servers running stale binaries | The pinned `.mcp.json` path (`npx _npx/906e6debb112be6d/...`) referenced an old install; new fixes invisible until restart |

Every one of these is downstream of "two files, one of them stale, loader picks wrong one". Unification removes the trap entirely — there's no second file to be stale relative to.

#### Operational recovery applied 2026-05-07

(Not in the ADR's scope; documented here so the chain is complete.)

```bash
HM=/Users/henrik/source/hm/semantic-modelling/.claude/worktrees/snappy-drifting-hejlsberg
SWARM="$HM/.swarm"
TS=$(date +%s)

# 1. Backups
cp "$HM/.mcp.json"          "$HM/.mcp.json.bak-$TS"
cp "$SWARM/memory.rvf"      "$SWARM/memory.rvf.bak-$TS-live-863"
cp "$SWARM/memory.rvf.meta" "$SWARM/memory.rvf.meta.bak-$TS-stale-329"

# 2. Switch .mcp.json from pinned npx cache path to @latest resolution
#    (so future restarts always pick up current published cli)
python3 -c "..."   # rewrite mcpServers.ruflo to use 'npx -y @sparkleideas/ruflo@latest'

# 3. Move stale .meta out of loader's preferred path
mv "$SWARM/memory.rvf.meta" "$SWARM/memory.rvf.meta.disabled-$TS"

# 4. Kill orphan MCP servers (pinned to old binary)
pkill -KILL -f '@sparkleideas/cli/bin/cli.js mcp'

# 5. User re-enters Claude Code → fresh MCP loads from memory.rvf (863) →
#    first compactWal materializes a fresh memory.rvf.meta (post-fix
#    metadataPath always returns .meta) → 863 entries reachable.
```

This used **only pre-existing general code paths** (no HM-specific recovery logic added to `rvf-backend.ts`):
- The loader's "if no `.meta`, fall through to main path" branch (`rvf-backend.ts:2293-2328`)
- compactWal serializing in-memory `this.entries` → `metadataPath` (per ADR-0147 R6 fix)

#### Long-term migration (Phase 6c of the implementation tracking)

Once Phases 1-5 land, HM (and any other project with a legacy `.meta`) needs a one-shot migration:

```
scripts/migrate-meta-to-segments.mjs <project-root>

Reads:  ${project}/.swarm/memory.rvf.meta   (RVF\0 JSON entries with embeddings)
        ${project}/.swarm/memory.rvf        (legacy data if .meta absent)

Writes: ${project}/.swarm/memory.rvf        (fresh SFVR with META_SEG entries)

Steps:
  1. Open .meta (or fall through to .rvf), parse all MemoryEntry records.
  2. For each entry, build RvfMetadataEntry[] with the field-ID registry from Phase 2.
  3. RvfDatabase.openOrCreate(path-to-temp), ingestBatch(vectors, ids, metadata) in batches.
  4. Atomically replace .swarm/memory.rvf with the new file.
  5. Delete .swarm/memory.rvf.meta + any .meta.disabled-* + .meta.bak-* siblings.
  6. Print summary: N entries migrated, M segments written, file size change.
```

Idempotent: re-running on an already-migrated project (single SFVR file with segments) detects via header inspection and exits 0 with `already migrated` message.

Acceptance test for the migration tool itself: round-trip a known-shape `.meta` (synthetic 200 entries) → migrate → reopen via the new single-file path → assert all 200 entries present + searchable + embeddings intact.

For HM specifically (after Phase 1-5 deploy):
1. Stop MCP in HM
2. Run `node scripts/migrate-meta-to-segments.mjs /path/to/hm/.../.swarm`
3. Restart MCP — single `memory.rvf` with all 863 entries as native vectors + segment metadata
4. The `.meta.disabled-*` and `.bak-*` files are now redundant — can be archived or deleted

### Risks + mitigations

- **R1: native binding upgrade required.** The `"bytes"` branch addition to `parse_metadata_entry` lives in `rvf-node` (Rust + napi). Either (a) upstream PR + wait for release, (b) fork the binding under `@sparkleideas/ruvector-rvf-node` and ship the change ourselves. Per fork policy (`feedback-no-upstream-donate-backs`), option (b).
- **R2: existing `.meta` files in HM-style projects.** Need a one-shot migration tool: read existing `.meta`, ingestBatch into a fresh native file with metadata. Document explicitly; don't bake recovery into runtime.
- **R3: native binding now mandatory** (no pure-TS fallback for storage). Mitigated by: ruvector-rvf-node ships native binaries for all major platforms; pure-TS fallback was never benchmarked anyway and was creating more bugs than it solved.

### Considered + rejected alternatives

- **Drop native entirely, pure-TS only.** Tempting but (a) sacrifices any future native HNSW perf even though benchmark was never run; (b) doesn't align with upstream where native IS the canonical implementation. Rejected.
- **Keep dual-write but make it consistent.** Reduces some bugs but leaves the fragmentation pattern + write amplification. Doesn't match upstream design intent. Rejected.
- **Status quo with my recent fixes only.** Each future change still navigates two formats; bug class stays alive. Rejected per "fix root cause, never weaken assertions".

### What this ADR DOES NOT change

- ADR-0153 (acceptance phase fixes) stays as-is — those are independent.
- Existing HM-style projects keep working via the legacy fall-through during the migration window. The fall-through gets removed in the cleanup step (5).
- Pure-TS fallback for `:memory:` mode (in-memory testing) stays. That's separate from the disk persistence path.

## Implementation tracking

Each item below maps to a deliverable. Status updates in-place as work lands.

### Phase 1 — Native crate extension (in `forks/ruvector/crates/rvf/rvf-node/`)

- [ ] **1a.** Add `"bytes"` branch to `parse_metadata_entry` (`rvf-node/src/lib.rs:328-357`). Maps `RvfMetadataEntry { valueType: "bytes", value: ... }` → `MetadataValue::Bytes(Vec<u8>)`. ~5 LoC.
- [ ] **1b.** Confirm `ingestBatch` handles the new variant end-to-end through the napi boundary (TS → Rust → segment write). Add a Rust unit test.
- [ ] **1c.** Bump `rvf-node` patch version. Publish to Verdaccio under `@sparkleideas/ruvector-rvf-node` (codemod auto-renames the scope). Update peer-pin in `forks/ruflo/v3/@claude-flow/memory/package.json`.

### Phase 2 — Field-ID registry (in `forks/ruflo/v3/@claude-flow/memory/`)

- [ ] **2a.** New file `src/rvf-segment-fields.ts` reserving stable `field_id: u16` for the MemoryEntry shape:
  - `1` = `key` (string)
  - `2` = `namespace` (string)
  - `3` = `content` (string)
  - `4` = `tags-json` (string-encoded JSON array)
  - `5` = `metadata-json` (string-encoded JSON object)
  - `6` = `accessLevel` (string)
  - `7` = `ownerId` (string, optional)
  - `8` = `createdAt` (i64 ms)
  - `9` = `updatedAt` (i64 ms)
  - `10` = `version` (i64)
  - `11` = `references-json` (string-encoded JSON array)
  - `99` = `entry-blob` (bytes — full serialized MemoryEntry minus embedding, for forward-compat)
- [ ] **2b.** Add a doc comment block in the new file explaining: field_ids are wire format, never reorder/remove existing IDs, append-only.

### Phase 3 — Persistence rework (in `forks/ruflo/v3/@claude-flow/memory/src/rvf-backend.ts`)

- [ ] **3a.** Build `RvfMetadataEntry[]` per vector at all 3 `ingestBatch` call sites (lines 496, 822, 1613). Each entry array = the fixed-fields above for that MemoryEntry.
- [ ] **3b.** Pass the array as the third argument to `nativeDb.ingestBatch(vectors, [numId], metadata)`.
- [ ] **3c.** Confirm via `RVF_DEBUG=1` log that segments include `Meta` (0x07) entries with the expected field IDs.

### Phase 4 — Load rework (in `forks/ruflo/v3/@claude-flow/memory/src/rvf-backend.ts`)

- [ ] **4a.** Replace `.meta` JSON parse path in `loadFromDisk` with native segment iteration. Read all `Meta` segments, reconstruct `MemoryEntry` from field_id values, populate `this.entries`.
- [ ] **4b.** Delete the `RVF\0` magic peek + dual-magic dispatch logic.
- [ ] **4c.** Delete `_deferredCorruptReason` and the fallback machinery — with one format on disk, there's no "wrong magic" branch left to hit.

### Phase 5 — Code deletion (the cleanup)

- [ ] **5a.** Delete `MAGIC = 'RVF\0'` constant (`rvf-backend.ts:54`).
- [ ] **5b.** Delete `metadataPath` getter — the entire construct that ADR-0153 simplified is now redundant.
- [ ] **5c.** Delete `persistToDiskInner` pure-TS path (lines 2673-2702 — the `magicBuf + headerBuf + entryBuffers` Buffer.concat).
- [ ] **5d.** Delete legacy fall-through (`loadFromDisk` lines 2293-2328) — the SFVR-magic peek branch in pure-TS mode that was added for fork's pure-TS-only era.
- [ ] **5e.** Delete `_pendingNativeIngest` deferred-ingest path — with metadata in segments, native is authoritative on load. No deferred re-ingest needed.

### Phase 6 — Acceptance + migration

- [ ] **6a.** New acceptance test `tests/acceptance/adr0154-single-file-storage.test.mjs` — write 200 entries, kill process, restart, assert 200 entries readable. No `.meta` file appears on disk.
- [ ] **6b.** Cross-process concurrency test (the bug class that drove ADR-0095) — N=8 concurrent writers, 100% durability, no orphan-numIds.
- [ ] **6c.** One-shot migration tool (`scripts/migrate-meta-to-segments.mjs`) for existing HM-style projects: read `.meta` JSON, ingestBatch into a fresh native file with metadata. Document explicitly; not part of runtime.
- [ ] **6d.** Update ADR-0095 to mark the dual-write portion as Superseded by ADR-0154 (Implemented).

## Implementation order rationale

Phase 1 must land first (native binding can't accept bytes metadata until then). Phase 2 is pure config, can run concurrently with Phase 1. Phases 3-4 require Phase 1 published. Phase 5 cleanup runs only after Phases 3-4 are fully validated — deletion is irreversible and proves there's nothing relying on the dead code. Phase 6 is the integration verification.

Sequencing prevents a half-state where the binding has the new path but the TS doesn't use it (no harm), but blocks ever shipping a TS that requires bytes-metadata before the binding supports it.

## Out of scope (deliberate)

- Performance benchmarking of native HNSW vs pure-TS HnswLite. The unification ADR doesn't depend on it; even if pure-TS were faster, single-file storage via segments is still correct per upstream design.
- Cold-tier sharding (`data.rvf.cold.0`) per `RuVector/docs/research/rvf/spec/01-segment-model.md`. Useful future work; not blocking unification.
- Migrating existing test data sets. The acceptance tests use fresh fixtures; legacy data migrates via the one-shot tool in 6c.

## References

- Upstream ADR-029 (canonical RVF format): https://github.com/ruvnet/ruvector/blob/main/docs/adr/ADR-029-rvf-canonical-format.md
- Upstream segment-model spec: `RuVector/docs/research/rvf/spec/01-segment-model.md`
- Upstream `crates/rvf/README.md`: "One file. Store vectors. Ship models. Boot services. Prove everything."
- Fork ADR-0057 (original single-file plan): `forks/ruflo/v3/implementation/adrs/ADR-057-rvf-native-storage-backend.md:97-110, 686`
- Fork ADR-0095 (the workaround that became dead code): `docs/adr/ADR-0095-rvf-inter-process-convergence.md`
- 4-agent swarm artifacts: `/private/tmp/claude-501/.../tasks/{a821167da5f5b44ae,afffa51be88961261,a7a9bb5e2b9afc2e8,a377fcc304f66de0e}.output`
- `rvf-types/src/segment_type.rs:24-25` — `Meta` + `MetaIdx` segment types reserved
- `rvf-runtime/src/options.rs:190-207` — `MetadataValue::Bytes` enum variant
- `rvf-runtime/src/write_path.rs:102-111` — `write_meta_seg`
- `rvf-node/src/lib.rs:328-357` — `parse_metadata_entry` (the gap)
- `rvf-node/src/lib.rs:476-480` + `index.d.ts:178-180` — `ingestBatch(vectors, ids, metadata)` already accepts the third arg
- `forks/ruflo/v3/@claude-flow/memory/src/rvf-backend.ts:54, 496, 707-727, 745, 822, 1613, 2293-2328, 2673-2740` — current dual-write code paths to be removed
