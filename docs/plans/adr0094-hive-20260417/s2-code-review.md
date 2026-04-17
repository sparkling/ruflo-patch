# Sprint 2 — Post-Implementation Code Review

**Reviewer**: post-impl reviewer (swarm `swarm-1776457824568-3hnqsy`)
**Date**: 2026-04-17
**Scope**: diffs only; not a plan critique.

## Signoff

| Agent | Verdict | Blocking issues |
|---|---|---|
| catalog-sqlite | CONDITIONAL-GO | 3 (fingerprint churn, layer drift, fake round-trip) |
| skip-reverify | NO-GO | DID NOT DELIVER — `scripts/skip-reverify.mjs` and `tests/unit/skip-reverify.test.mjs` absent; no hook in `scripts/test-acceptance.sh` |
| acceptance-catalog | NO-GO | DID NOT DELIVER — `lib/acceptance-catalog-checks.sh`, `tests/unit/acceptance-catalog-checks.test.mjs` absent; no source-in from `lib/acceptance-checks.sh` or `scripts/test-acceptance.sh` |

**Barrier gate**: fail. ADR-0096 impl-plan §Gate requires ≥6 catalog acceptance checks wired into `test-acceptance.sh` and a green `skip-reverify.mjs`. Sprint 2 cannot close with 1/3 siblings shipped.

## catalog-sqlite

Files reviewed:

- `scripts/catalog-rebuild.mjs` (modified — +548 lines vs committed HEAD)
- `tests/unit/catalog-sqlite.test.mjs` (new)
- `tests/unit/catalog-rebuild.test.mjs` (pre-existing, still exercises the JSONL paths)
- `tests/unit/catalog-malformed-json.test.mjs` (pre-existing)

Findings:

1. **Blocking — fingerprint churn** (`scripts/catalog-rebuild.mjs:210-216`)
   ADR-0096 impl-plan §Fingerprints explicitly requires normalization before hashing (strip ANSI, `/tmp/ruflo-*` → `<tmp>`, ISO timestamps → `<ts>`, `\b\d{5,}\b` → `<n>`, hex ≥10 → `<hash>`). The delivered `fingerprint()` hashes the raw first non-blank line: any error message containing a PID, temp-path, port, or hex hash produces a NEW fingerprint every run. This breaks `docs/bugs/coverage-ledger.md` cross-references (the stated consumer at `upsertRun:366-370`) and the `--verify` listing (`865-867`) reports churning sha1s. Also: spec says `sha256(seed).slice(0,12)`; code ships `sha1(...).digest('hex')` (40 chars). Fix: add normalization helper, switch to sha256 truncated to 12, store raw `first_error_line` alongside for re-hashing (ADR-0086 derived-layer rule).

2. **Blocking — `--export-jsonl` is not a round-trip** (`scripts/catalog-rebuild.mjs:579-603`)
   The docblock (line 27-28) advertises "round-trip verification" vs `catalog.jsonl`. Export emits 7 fields (`run_id, ts_utc, wall_ms, check_id, status, duration_ms, output`). Original JSONL rows from `flattenRun` (line 252-269) carry 12 (`name, group, passed, fork_file, fingerprint` omitted) AND `output` becomes the truncated 500-char ANSI-stripped `output_excerpt`. `tests/unit/catalog-sqlite.test.mjs:346-368` is lenient — only asserts row-count parity + `(run_id, check_id, status)` triples, silently accepting the data loss. Violates ADR-0086 "derived layers must round-trip to raw". Fix: either persist the missing columns in `check_history` (phase, passed, fork_file, fingerprint, name, group — the impl-plan §Schema explicitly calls for `phase`, `fingerprint`, `first_error_line`) or rename the mode and remove the round-trip promise.

3. **Blocking — layer drift on `--append` failure** (`scripts/catalog-rebuild.mjs:442-502`)
   `existing = ingestedRunIds(readCatalog())` (line 442) is computed from `catalog.jsonl` only. If SQLite holds a run the JSONL doesn't (the compensation path at 487-490 throws, e.g. from a second SQLite fault), subsequent `--append` runs re-insert because the JSONL never saw the row; the `INSERT OR REPLACE` then silently fixes the drift but the per-run numbers in `runs` are re-counted against a DIFFERENT `rows.length` (if raw JSON changed). Also the compensation `BEGIN IMMEDIATE` (line 487) is unguarded — if the DELETE throws, the outer `finally { db.close() }` leaves WAL-side files inconsistent. Fix: cross-check `ingestedRunIds(jsonl)` ∪ `db.runs` on entry, fail loudly on mismatch (ADR-0082), and wrap the compensation DELETE in try/catch that logs-and-exits-3 rather than bubble.

4. **Nit — missing indexes/columns vs impl-plan** (`scripts/catalog-rebuild.mjs:106-146`)
   ADR-0096 impl-plan §Schema lists: `ix_hist_check(check_id,run_id)` (flake math), `ix_hist_status(status,run_id)` (hotlist), `ix_skip_streak(streak_days DESC)`, `ix_fp_last(last_seen)`, plus columns `phase TEXT`, `first_error_line TEXT`, and `fingerprint` FK on `check_history`. Delivered: 3 indexes, no phase/first_error_line/fingerprint columns. `--flake-hotlist` (line 618-638) runs without the indexes — fine at 452×20 rows, slow at 500-run depth. Fix: add the missing indexes and 3 columns (phase derived from `check_id` prefix `p1_..p7_`).

5. **Nit — `last_seen` semantics wrong** (`scripts/catalog-rebuild.mjs:345-352` + test `catalog-sqlite.test.mjs:240`)
   SQL: `last_seen = excluded.last_seen` on UPSERT — overwrites with whatever the current call passes. Test asserts `last_seen = '2026-04-16T00:00:00Z'` after upserts in order r1(04-17)→r2(04-18)→r3(04-16); the test passes, but "last_seen" should semantically be MAX(ts_utc) not last-write-wins. Fix: `last_seen = MAX(last_seen, excluded.last_seen)` to match the `first_seen = MIN(...)` already in place, and update the test assertion to `'2026-04-18T00:00:00Z'`.

6. **Nit — silent fallback on ts_utc** (`scripts/catalog-rebuild.mjs:336`, `370-371`)
   `first.ts_utc ?? ''` and `r.ts_utc ?? ''` default missing timestamps to `''`. `rebuildSkipStreaks` then parses `Date.parse('')` → `NaN` → `days=0` (line 421-424). Empty-string timestamps pass the `first.ts_utc != null` check silently. ADR-0082 says no silent fallbacks. Fix: reject rows with missing `ts_utc`, fail loudly on ingest.

## skip-reverify

**NO DELIVERABLES.**

- `scripts/skip-reverify.mjs` — absent.
- `tests/unit/skip-reverify.test.mjs` — absent.
- `scripts/test-acceptance.sh` — unmodified; no `skip-reverify` invocation added.

Cannot review what was not written. Sibling did not produce the required artifacts in the working tree.

ADR-0096 impl-plan §Gate criterion 4 (skip-reverify exits 0/1 correctly) is unverifiable.
ADR-0096 impl-plan criterion 7 (`grep -n 'retry\|retries\|attempts'` across the 3 scripts returns zero) — cannot check all 3 because 1 is missing; the delivered `catalog-rebuild.mjs` is clean (grep returns zero).

## acceptance-catalog

**NO DELIVERABLES.**

- `lib/acceptance-catalog-checks.sh` — absent.
- `tests/unit/acceptance-catalog-checks.test.mjs` — absent.
- `lib/acceptance-checks.sh` — unmodified (no `source lib/acceptance-catalog-checks.sh`).
- `scripts/test-acceptance.sh` — unmodified (no catalog check-group wiring, no `RUFLO_CATALOG_RESULTS_DIR` scoping).

Cannot review what was not written.

ADR-0096 impl-plan §Gate criterion 6 (≥6 catalog checks wired into `test-acceptance.sh`) is unmet.
ADR-0097 L1/L2 compliance (every check sets `_CHECK_PASSED`, `_run_and_kill` has explicit timeout) is vacuously satisfied but uninformative.

## Non-blocking observations on the existing catalog code

- `process.emitWarning` monkey-patch at module load (`scripts/catalog-rebuild.mjs:64-70`) is global for the Node process lifetime. Fine for a standalone CLI, but any unit test that imports this file *before* another module that would emit its own `ExperimentalWarning` matching `/SQLite is an experimental feature/` will silently swallow that too. Low risk (narrow regex) but surface-area audit warranted.
- `const require` on line 89 is used inside `getDatabaseSync()` at line 77. TDZ-safe in practice (function body runs only after module eval completes) but brittle to refactoring. Move the `createRequire(import.meta.url)` call ABOVE the first use.
- `--promote-to-sqlite` exits 1 on reconciliation fail (line 568) — `--verify` also uses 1 (line 860). ADR-0094 distinguishes 1=drift vs 2=infra. Consider dedicated exit codes per mode to preserve the distinction.

## Verdicts summary

| Verdict | Meaning |
|---|---|
| GO | 0 blocking; ship. |
| CONDITIONAL-GO | ≤3 blocking, each fixable in <1 hour of focused work; re-review delta. |
| NO-GO | Deliverables missing or blocking requires architectural change. |

catalog-sqlite is CONDITIONAL-GO because the code that shipped is functional-enough to land behind a fix-it-forward train (all 3 blocking findings above are focused, localized patches). The other two siblings are NO-GO — they did not deliver at all, and the Sprint 2 barrier requires all three.
