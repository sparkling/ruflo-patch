# ADR-0096 Implementation Sprint Plan

## Schema

Keep the 4 tables in §Layer 2, with deltas:

**Add to `check_history`:** `phase TEXT` (P1..P7), `fingerprint TEXT` nullable FK to `fingerprints`, `first_error_line TEXT` (audit trail for re-hashing).

**Indexes:** `ix_hist_check(check_id,run_id)` for flake math; `ix_hist_status(status,run_id)` for hotlist; `ix_skip_streak(streak_days DESC)`; `ix_fp_last(last_seen)`.

**FKs:** `PRAGMA foreign_keys=ON`; `check_history.run_id → runs ON DELETE CASCADE` — makes `--from-raw` truncate-rebuild safe.

**output_excerpt control-char fix:** Ingestor strips ANSI `\x1b\[[0-9;]*m`, replaces C0 `[\x00-\x08\x0b-\x1f\x7f]` with `?`, truncates to 500 chars. Plain TEXT, never nested JSON. If source JSON fails `JSON.parse` (the strict-mode crash seen earlier), mark that run `status='corrupt'`, 0 counts, log path+byte offset — never silent-skip (ADR-0082).

## Skip Reverify

Don't hand-write 55 probes. Every skip emits `SKIP_ACCEPTED: <phase>/<label>: <reason>`. Parse reason into 5 buckets, 5 generic probes:

| Bucket | Marker | Probe |
|---|---|---|
| missing_binary | "not installed", "not found" | `command -v <bin>` in fresh E2E install |
| missing_env | "unset", "not set" | `[ -n "$VAR" ]` |
| tool_not_in_build | "not in build", "Unknown tool" | `cli mcp list-tools --json \| jq -e '.[]\|select(.name=="X")'` |
| runtime_unavailable | "unavailable at runtime" | `cli mcp exec --tool X --params '{}'` exit 0, no "unavailable" in stderr |
| prereq_absent | fallthrough | reason-hash lookup in `docs/bugs/coverage-ledger.md` |

`scripts/skip-reverify.mjs` walks every `skip_accepted` latest, reads reason from `output_excerpt`, classifies, runs bucket probe against the **E2E sidecar install** (not the shared acceptance one — prereq leakage). Flip-to-pass reports `SKIP_ROT: prereq arrived, check <id> must now pass or be deleted`. All 21 browser skips collapse to one Playwright probe.

## Fingerprints

Lives in `catalog-rebuild.mjs` (ingest-time, rebuildable per ADR-0086), NOT `run-check.sh` (keep runner dumb).

Normalize BEFORE hashing or every run flakes:
1. Strip ANSI.
2. `/tmp/ruflo-[a-z]+-[A-Za-z0-9]+` → `<tmp>`
3. ISO timestamps → `<ts>`
4. `\b\d{5,}\b` → `<n>` (PIDs, ports, epoch ms)
5. Hex ≥10 chars → `<hash>`
6. First line matching `/^(Error|TypeError|RangeError|FAIL|AssertionError|expected|✗)/`, else first non-empty normalized line.

Hash: `sha256(seed).slice(0,12)`. Store seed in `first_error_line` so algorithm changes re-derive without re-ingest.

## Swarm

4 agents, not 7:

1. **catalog-impl** (coder) — schema.sql + `catalog-rebuild.mjs` all 4 modes + fingerprinting + dashboard render (one file).
2. **skip-reverify-impl** (coder) — `skip-reverify.mjs` + 5 bucket probes.
3. **manifest-impl** (coder) — `regen-mcp-manifest.mjs` 3 modes vs pinned CLI.
4. **adversarial-reviewer** (reviewer, LAST) — ADR-0082/0086 review + writes `lib/acceptance-catalog-checks.sh`.

Folded: schema-designer into catalog-impl (20-line schema). Dashboard renderer same file. Out-of-scope probes owned by skip-reverify-impl.

## Parallelism

3 independent tracks, 1 barrier:

```
[T1 catalog-impl]  ─┐
[T2 skip-reverify] ─┼── BARRIER ──→ [T4 adversarial + accept checks]
[T3 manifest]      ─┘
```

File-disjoint: `catalog-rebuild.mjs`, `skip-reverify.mjs`, `regen-mcp-manifest.mjs`. Spawn all three in ONE Task message, `run_in_background: true`. T2 needs schema for `check_history.output_excerpt` reads — bootstrap `schema.sql` synchronously FIRST (~5 min), then fan out. T1's `--verify` mode folded into T4 so T1 ships first.

## Gate

Implemented when all 5 ADR criteria plus:

1. `catalog-rebuild.mjs --from-raw` ingests 179 historical runs; corrupt runs bucket as `status=corrupt`, no throws.
2. `--show` counts match latest `acceptance-results.json` exactly.
3. `--verify` exits non-zero when ADR-0094 header numbers are mutated (regression test mandatory).
4. `skip-reverify.mjs` exits 0 when no prereq arrived; exits 1 + lists 21 browser checks when Playwright is temp-installed as synthetic flip.
5. `regen-mcp-manifest.mjs --verify` passes against `@sparkleideas/cli@latest`.
6. `lib/acceptance-catalog-checks.sh` ≥6 checks wired into `test-acceptance.sh`, all pass.
7. `grep -n 'retry\|retries\|attempts'` across the 3 scripts returns zero (ADR-0082 ban).
8. `test-results/CATALOG.md` gitignored, regenerates idempotently (two `--append` runs same input → identical output).
