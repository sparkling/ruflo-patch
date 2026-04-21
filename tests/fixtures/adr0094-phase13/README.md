# ADR-0094 Phase 13 — Migration fixtures (v1)

Hand-crafted text fixtures consumed by `lib/acceptance-phase13-migration.sh`.
They verify the current CLI can read configs / sessions that were written
under an older schema without panicking or silently resetting.

## Scope cut (2026-04-20)

These are **not** snapshots captured from a pinned earlier build — we don't
yet ship vN-1 artifacts. This first Phase 13 pass verifies forward- and
backward-compatibility on the JSON/text surfaces the CLI reads directly
(`.claude-flow/config.json`, `.claude-flow/sessions/*.json`). RVF binary
fixtures, SQLite fixtures, and real vN-1 round-trips are deferred to a
future Phase 13.1 pass that will need a pinned Verdaccio-published build
to capture the originals.

## Fixtures

| Dir | Tests | Shape |
|-----|-------|-------|
| `v1-config/` | current code reads a minimal v1 config correctly | `.claude-flow/config.json` with `schema:1`, `memory.backend`, `telemetry.enabled` |
| `v1-store/` | current code reads a v1 session file (sessions are per-file JSON under `.claude-flow/sessions/<id>.json`; there is no single `store.json`) | `.claude-flow/sessions/p13-fixture-session.json` with the fields `saveSession()` writes (`sessionId`, `name`, `savedAt`, `stats`, `data`) |
| `v1-forward-compat/` | current code tolerates an unknown future key at config root | same as `v1-config/` + `unknownFutureKey:{x:42}` |
| `v1-backward-compat/` | current code defaults gracefully when an optional block was not written by the older writer | `v1-config/` minus the `telemetry` block |

## Refreshing the fixtures

When the schema legitimately changes:

1. **Add a new directory** (`v2-config/`, `v2-store/`, ...) with the new shape
2. **Keep the old `v1-*` directories** as historical regression fixtures — they
   are the whole point of Phase 13. Removing them defeats the check.
3. Add check functions in `lib/acceptance-phase13-migration.sh` targeting the
   new version, keeping the existing v1 checks.

## Session-file shape note

`session_list` reads `.claude-flow/sessions/*.json` (one file per session),
not a consolidated `.swarm/store.json`. The shape was confirmed from
`session-tools.js` `saveSession()` in the fork build at 2026-04-20 —
`{sessionId, name, description, savedAt, stats:{...,totalSize}, data}`.
Sort defaults to date, so `savedAt` must be a valid ISO string.
