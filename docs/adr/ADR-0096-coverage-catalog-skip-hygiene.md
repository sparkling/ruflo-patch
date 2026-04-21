# ADR-0096: Coverage Catalog + Skip Hygiene

- **Status**: Implemented — 2026-04-21
- **Date**: 2026-04-17
- **Scope**: `scripts/catalog-rebuild.mjs`, `scripts/skip-reverify.mjs`, `test-results/catalog.db`, `test-results/CATALOG.md`, acceptance JSON ingestion pipeline
- **Forked from**: ADR-0094 §D rows 4, 10 (hive synthesis)
- **Related**: ADR-0094 (parent), ADR-0082 (no silent fallbacks — skip rot IS a silent fallback), ADR-0086 (raw-JSON-is-canonical precedent)

## Context

ADR-0094 promotes "100% acceptance coverage" but ships with no per-check history, no flakiness metric, no skip-accepted re-verification, and no dashboard. 55 of 452 checks are `skip_accepted` today with no expiry, no owner, no re-probe. `lib/acceptance-browser-checks.sh` alone contributes 21 skips (Playwright absence); if Playwright later ships in the published package, those 21 checks stay skipped indefinitely unless a human notices.

The hive identified this as the next ADR-0082 violation class. This ADR defines the catalog + hygiene program.

## Decision (Proposed)

Three layers, borrowed from the ADR-0086 "raw-JSON-is-canonical, derived-layers-are-rebuildable" model:

### Layer 1: Raw (canonical)
`test-results/accept-<ts>/acceptance-results.json` — already produced by `scripts/test-acceptance.sh`. 179+ historical files exist. Append-only truth.

### Layer 2: Index (derived)
`test-results/catalog.db` — SQLite. Schema:
```sql
CREATE TABLE runs (run_id TEXT PRIMARY KEY, ts_utc TEXT, total INT, passed INT, failed INT, skipped INT, wall_ms INT);
CREATE TABLE check_history (run_id TEXT, check_id TEXT, status TEXT, duration_ms INT, output_excerpt TEXT, PRIMARY KEY(run_id, check_id));
CREATE TABLE fingerprints (fingerprint TEXT PRIMARY KEY, first_seen TEXT, last_seen TEXT, bug_id TEXT);
CREATE TABLE skip_streaks (check_id TEXT PRIMARY KEY, first_skip_ts TEXT, last_skip_ts TEXT, streak_days INT, reason_hash TEXT, bug_link TEXT);
```
Rebuildable from Layer 1 via `scripts/catalog-rebuild.mjs --from-raw`.

### Layer 3: View (presentation)
`test-results/CATALOG.md` (gitignored) — auto-regenerated. Section headers for `Dashboard`, `Flake Hotlist`, `Skip Rot Watch`, `Longest-Open Skip`, `7-Day Trend`.

### Update triggers
1. End of `scripts/test-acceptance.sh` — `node scripts/catalog-rebuild.mjs --append`.
2. Pre-push hook — `node scripts/catalog-rebuild.mjs --verify` (fails on drift).
3. Weekly cron (or CI scheduled job) — `node scripts/skip-reverify.mjs` attempts every `skip_accepted` against a fresh install; auto-flips to `fail` if the prereq has arrived.

### Skip hygiene rules
- `skip_streak_days > 30` → catalog marks as `SKIP_ROT`; the corresponding check's next acceptance-run bucket is `fail` with output `SKIP_ROT: streak exceeded 30-day threshold; re-probe via skip-reverify.mjs`.
- Re-verify probe runs **against a fresh E2E install**, not the acceptance test's shared install, to avoid prereq leakage.
- Flip-to-green auto-files an entry in `docs/bugs/coverage-ledger.md` under `state: regressed` (the skip was masking a feature arrival; that's a coverage regression).

### Flakiness metric
`fails_last_20 / runs_last_20`. Thresholds:
- `>= 0.05` — `FLAKY` warning in CATALOG.md.
- `>= 0.25` — `BROKEN` — check is gated off the "pass count" until fixed; failure count still reports loudly.

**Explicitly banned**: automatic retry. ADR-0082 forbids masking flakes via retry. A flaky check either gets fixed, bucketed as `deferred` with ledger entry, or folded into a behavior-invariant check that is deterministic.

## Alternatives

### A. JSONL-only (no SQLite)
`test-results/catalog.jsonl` as the only derived artifact; `jq`-based queries.
**Pros**: zero native deps; pure text.
**Cons**: queries slow at 500+ runs × 452 checks = 200K+ rows.

### B. Hand-maintained markdown table
Authors append to `CATALOG.md` by hand.
**Pros**: no tooling.
**Cons**: drifts instantly (the whole reason we're doing this).

### C. External tool (Grafana / Datadog)
Push metrics to a hosted service.
**Pros**: rich dashboards.
**Cons**: contradicts "local-first" project stance; adds credentials.

## Recommendation

Three-layer SQLite model (above). SQLite is already a project dep (`better-sqlite3`). Enables fast queries at 500-run depth without new infrastructure.

## Acceptance criteria

1. `scripts/catalog-rebuild.mjs --from-raw` produces `catalog.db` + `CATALOG.md` from any subset of historical run JSONs.
2. `scripts/catalog-rebuild.mjs --show` prints the dashboard block; output is pasteable into any ADR's Implementation Log.
3. `scripts/skip-reverify.mjs` runs for every `skip_accepted` and flips those whose prereq arrived; weekly cron or manual invocation.
4. `scripts/catalog-rebuild.mjs --verify` fails preflight if ADR-0094 quoted numbers disagree with catalog.
5. `docs/adr/ADR-0094.md` header's `invoked_coverage` / `verified_coverage` fields are populated from `catalog.db` (via a preflight template substitution or manual copy with the drift check).

## References

- ADR-0094 Open Item — Catalog creation (synthesis row 4)
- ADR-0094 Open Item — Skip hygiene (synthesis row 10)
- ADR-0086 (raw-JSON-is-canonical model)
- ADR-0082 (no silent fallbacks — applies to retry ban and skip rot)

## Status Update 2026-04-21

- **Old status**: Proposed (2026-04-17)
- **New status**: Implemented
- **Evidence**: `scripts/catalog-rebuild.mjs` (42.7 KB, +x, 2026-04-17) and `scripts/skip-reverify.mjs` (23.3 KB, 2026-04-19) both present. `test-results/catalog.db` (SQLite) populated with run history; 170+ `accept-<ts>` raw JSON artifacts under `test-results/` form the Layer-1 canonical truth. `docs/adr/ADR-0094-log.md:703` records: "ADR-0096 (catalog + skip hygiene) → Implemented (catalog.db populated, skip-reverify operational)". ADR-0094 parent acceptance criteria §700 satisfied: `skip_streak_days_max < 30`, preflight drift-detection passes. Three-layer raw/index/view model shipped; `CATALOG.md` is gitignored derived artifact (rebuildable) per design.
- **Rationale**: All five acceptance criteria (1: `--from-raw` rebuild, 2: `--show` dashboard, 3: `skip-reverify` probe, 4: `--verify` drift check, 5: ADR-0094 numbers sourced from catalog) are wired. The program is self-perpetuating — as ADR-0094-log §725 notes, "the coverage program's continuous catalog + skip hygiene side of the work (ADR-0096) continues indefinitely" as new MCP tools arrive, but the infrastructure itself is complete.
- **Remaining work**: None structural. Ongoing operation: weekly cron for `skip-reverify.mjs` is currently manual-invocation; if unattended cadence is wanted later, wire a scheduled trigger. Not a gap against this ADR's acceptance criteria.

