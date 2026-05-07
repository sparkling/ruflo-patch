# ADR-0154: RVF storage unification — remove `.meta` sidecar, align with upstream ADR-029

- **Status**: Proposed 2026-05-07
- **Date**: 2026-05-07
- **Deciders**: Henrik Pettersen
- **Related**: ADR-0095 (RVF inter-process convergence — superseded for the dual-write portion), ADR-0057 fork (original single-file plan), upstream `ruvnet/RuVector` ADR-029 (canonical RVF format), upstream ADR-001 (superseded prior split design)

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
