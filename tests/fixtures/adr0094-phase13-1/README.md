# ADR-0094 Phase 13.1 — RVF binary migration fixtures

Real `.swarm/memory.rvf` + sidecar artifacts captured from a **live**
`@sparkleideas/cli memory store` round-trip against Verdaccio. Consumed
by `lib/acceptance-phase13-migration.sh` checks 7-8 (`migration_rvf_v1_retrieve`,
`migration_rvf_v1_search`).

Phase 13 (sibling dir `tests/fixtures/adr0094-phase13/`) covers hand-crafted
text fixtures (config.json, sessions/*.json). Phase 13.1 closes the deferral
for binary RVF: if the on-disk RVF format silently drifts between patch
bumps, these fixtures fail the acceptance checks and surface the regression.

## These are LIVE-seeded, not hand-crafted

Do NOT edit files under `v1-rvf/.swarm/` by hand. The RVF is a binary
format with internal offsets/hashes; any manual edit will either corrupt
it or go undetected until production. Refresh via the seed script
(`scripts/seed-phase13-1-fixtures.sh`) or not at all.

## Fixtures

| Dir | Tests | Seeded from | K/V pair |
|-----|-------|-------------|----------|
| `v1-rvf/` | checks 7-8 — current code retrieves + searches a RVF written by a prior published `-patch.N` | `@sparkleideas/cli@latest` on Verdaccio at the time of seeding | `{key: p13rvf-sentinel, value: migration-works-v1, namespace: p13rvf}` |

Each fixture directory contains:

- `.swarm/memory.rvf`        — the binary RVF snapshot
- `.swarm/memory.rvf.meta`   — RVF sidecar (header, offsets)
- `.swarm/memory.db`         — SQLite sidecar (when the build emits it)
- `.seed-manifest.json`      — provenance: CLI version, timestamp, K/V pair, per-file SHA-256 + byte size

Transient files (`memory.rvf.lock`, `memory.rvf.ingestlock`) are
**deliberately excluded** — they encode runtime state (PID, ingest phase)
not schema, and committing them would mislead debugging.

## Refreshing the fixtures

When the RVF on-disk format legitimately changes:

1. **Add a new dir** (`v2-rvf/`, etc.) — do NOT overwrite `v1-rvf/`.
   The whole point of Phase 13.1 is cross-version regression.
2. Run `bash scripts/seed-phase13-1-fixtures.sh` after adjusting the
   script to write into the new dir.
3. Add check functions in `lib/acceptance-phase13-migration.sh` targeting
   the new version. Keep the v1 checks.

## Why a dedicated seed script and not a test helper?

- Must run against a **published build** (Verdaccio), not against in-tree
  source. Live round-trip is the only way to capture a canonical RVF.
- Must run **once** and commit output. Re-generating per test run would
  defeat the regression signal — the fixture must be older than the code
  reading it.
- Seed script failure surfaces build/publish issues immediately (loud
  retrieval assertion) rather than producing a subtly-broken fixture.
