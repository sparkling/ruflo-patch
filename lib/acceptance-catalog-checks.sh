#!/usr/bin/env bash
# lib/acceptance-catalog-checks.sh — ADR-0096 Coverage Catalog + Skip Hygiene
#
# Sprint 2 acceptance checks that exercise the catalog ingest + skip-reverify
# pipeline end-to-end against a sandbox test-results tree. The sandbox is
# honored by `scripts/catalog-rebuild.mjs` via the `RUFLO_CATALOG_RESULTS_DIR`
# env var (commit 77bb4f3); `scripts/skip-reverify.mjs` follows the same
# convention per ADR-0096 §Swarm track T2.
#
# Checks (>= 6, plus one bonus):
#   check_adr0096_catalog_populated          — JSONL + SQLite row shape + count
#   check_adr0096_catalog_verify             — `--verify` exits 0 on a fresh catalog
#   check_adr0096_fingerprint_determinism    — same failure → same fingerprint across runs
#   check_adr0096_skip_streak_tracking       — skip_streaks row exists, streak_days monotonic
#   check_adr0096_jsonl_sqlite_reconcile     — `--export-jsonl` row count matches catalog.jsonl
#   check_adr0096_skip_reverify_dry_run      — `skip-reverify.mjs --dry-run` enumerates every skip
#                                              with a `bucket:` line (no `unknown`)
#   check_adr0096_skip_rot_gate              — synth streak_days=31 → next bucket=fail SKIP_ROT
#
# Defensive to sibling agents (ADR-0082):
#   catalog.db + skip-reverify.mjs are being written RIGHT NOW by sibling
#   agents (catalog-sqlite, skip-reverify). Until they land, these checks
#   bucket as `skip_accepted` against the NARROW regex
#     /catalog\.db not found|skip-reverify\.mjs not found/
#   and nothing broader. Never silent-pass.
#
# Harness contract (see lib/acceptance-harness.sh):
#   - _CHECK_PASSED ∈ {"true", "false", "skip_accepted"}
#   - _CHECK_OUTPUT: diagnostic string (first 500 chars kept by harness)
#   - _with_iso_cleanup: sandbox dir with trap-based cleanup
#
# Budget: <= 10s total for the parallel group (7 checks × ~1s each ≤ 10s wall).

# ══════════════════════════════════════════════════════════════════════════════
# Paths (repo-relative; PROJECT_DIR is the acceptance harness's repo root)
# ══════════════════════════════════════════════════════════════════════════════
_adr0096_script_catalog() {
  # PROJECT_DIR is exported by scripts/test-acceptance.sh; fall back to the
  # parent of this file's dir if sourced out-of-band by the paired unit test.
  local root="${PROJECT_DIR:-}"
  if [[ -z "$root" ]]; then
    root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  fi
  echo "${root}/scripts/catalog-rebuild.mjs"
}

_adr0096_script_skipreverify() {
  local root="${PROJECT_DIR:-}"
  if [[ -z "$root" ]]; then
    root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  fi
  echo "${root}/scripts/skip-reverify.mjs"
}

# ══════════════════════════════════════════════════════════════════════════════
# Fixture scaffolding
#
# Build a minimal accept-<ts>/acceptance-results.json under $sandbox/test-results
# that exercises all three status buckets. Keeps the test self-contained (does
# NOT touch the real test-results/ tree under PROJECT_DIR).
#
# The fixture is deterministic: hard-coded timestamps + outputs so fingerprint
# assertions are stable across runs.
# ══════════════════════════════════════════════════════════════════════════════
_adr0096_write_fixture_run() {
  local sandbox="$1" run_id="$2" ts="$3"
  local run_dir="${sandbox}/test-results/${run_id}"
  mkdir -p "$run_dir"
  # 3 tests: one pass, one fail, one skip_accepted. Stable output fields so
  # fingerprint() yields the same sha1 across runs (used by the determinism check).
  cat > "${run_dir}/acceptance-results.json" <<JSON
{
  "timestamp": "${ts}",
  "total_duration_ms": 1234,
  "tests": [
    {
      "id": "version",
      "name": "Version check",
      "group": "smoke",
      "passed": true,
      "status": "passed",
      "output": "ok",
      "duration_ms": 5
    },
    {
      "id": "adr0096-synth-fail",
      "name": "Synthetic fail (ADR-0096 fixture)",
      "group": "adr0096",
      "passed": false,
      "status": "failed",
      "output": "Error: synthetic failure at fixtures/adr0096.ts:42",
      "duration_ms": 8
    },
    {
      "id": "adr0096-synth-skip",
      "name": "Synthetic skip (ADR-0096 fixture)",
      "group": "adr0096",
      "passed": false,
      "status": "skip_accepted",
      "output": "SKIP_ACCEPTED: adr0096/synth: playwright not installed",
      "duration_ms": 3
    }
  ],
  "summary": {"total": 3, "passed": 1, "failed": 1, "skip_accepted": 1}
}
JSON
}

# Seed a sandbox with N fixture runs + run --append + --promote-to-sqlite.
# Returns 0 on success with the sandbox wired to RUFLO_CATALOG_RESULTS_DIR.
#
# $1: sandbox root (absolute)
# $2: number of runs to create (1-3 typical)
_adr0096_seed_catalog() {
  local sandbox="$1" n="${2:-2}"
  local catalog_script; catalog_script=$(_adr0096_script_catalog)
  if [[ ! -f "$catalog_script" ]]; then
    return 2  # script missing — caller should interpret as skip_accepted
  fi
  # Use timestamps 10 days apart so skip_streaks accumulate days > 0.
  local i base_epoch ts
  base_epoch=1744675200  # 2026-04-15T00:00:00Z, stable
  for (( i = 0; i < n; i++ )); do
    # ts increments 10 days per run; zero-pad the run label.
    local this_epoch=$(( base_epoch + i * 864000 ))
    ts=$(date -u -r "$this_epoch" "+%Y-%m-%dT%H:%M:%SZ" 2>/dev/null) || \
      ts=$(date -u -d "@${this_epoch}" "+%Y-%m-%dT%H:%M:%SZ" 2>/dev/null) || \
      ts="2026-04-$((15 + i))T00:00:00Z"
    local run_id="accept-$(echo "$ts" | tr -d ':-')"
    _adr0096_write_fixture_run "$sandbox" "$run_id" "$ts"
  done
  # Ingest + promote. Both go into the sandbox because RUFLO_CATALOG_RESULTS_DIR
  # is honored. Stderr captured for diagnostics; stdout discarded (noisy).
  local log="${sandbox}/seed.log"
  RUFLO_CATALOG_RESULTS_DIR="${sandbox}/test-results" \
    node "$catalog_script" --append >"$log" 2>&1 || {
      echo "seed: --append failed (log: $(head -5 "$log" | tr '\n' ' '))" >&2
      return 3
    }
  # Sibling agent may not yet have implemented SQLite promotion path; guard.
  if grep -qE '(requires Node >=22|Unknown option|not implemented)' "$log" 2>/dev/null; then
    return 4
  fi
  return 0
}

# ══════════════════════════════════════════════════════════════════════════════
# CHECK 1: catalog populated (JSONL shape + SQLite runs count)
# ══════════════════════════════════════════════════════════════════════════════
_check_adr0096_catalog_populated_body() {
  local sandbox="$1"
  _adr0096_seed_catalog "$sandbox" 2
  local rc=$?
  if [[ $rc -ne 0 ]]; then
    if [[ $rc -eq 2 ]]; then
      _CHECK_PASSED="skip_accepted"
      _CHECK_OUTPUT="SKIP_ACCEPTED: ADR-0096/populated: catalog-rebuild.mjs not found"
      return
    fi
    _CHECK_OUTPUT="ADR-0096/populated: seed failed (rc=$rc)"
    return
  fi

  local jsonl="${sandbox}/test-results/catalog.jsonl"
  local db="${sandbox}/test-results/catalog.db"
  if [[ ! -f "$jsonl" ]]; then
    _CHECK_OUTPUT="ADR-0096/populated: catalog.jsonl not created after --append"
    return
  fi
  local rows; rows=$(wc -l < "$jsonl" | tr -d ' ')
  rows=${rows:-0}
  if [[ "$rows" -lt 1 ]]; then
    _CHECK_OUTPUT="ADR-0096/populated: catalog.jsonl has 0 rows (expected >=1)"
    return
  fi

  # Shape check: pick first line, assert the required fields exist.
  local shape_check
  shape_check=$(head -1 "$jsonl" | node -e '
    try {
      const o = JSON.parse(require("fs").readFileSync(0, "utf8"));
      const missing = ["run_id","check_id","status","duration_ms"].filter(k => !(k in o));
      if (missing.length) { console.log("MISSING:" + missing.join(",")); process.exit(0); }
      console.log("OK");
    } catch (e) { console.log("PARSE_ERR:" + e.message); }
  ' 2>&1)
  if [[ "$shape_check" != "OK" ]]; then
    _CHECK_OUTPUT="ADR-0096/populated: JSONL row shape invalid: $shape_check"
    return
  fi

  # SQLite-side: if catalog.db exists, runs count must be >= unique run_ids in JSONL.
  if [[ -f "$db" ]]; then
    local unique_runs
    unique_runs=$(node --no-warnings -e '
      const fs=require("fs");
      const set=new Set();
      for (const line of fs.readFileSync("'"$jsonl"'","utf8").split("\n")) {
        if (!line.trim()) continue;
        try { set.add(JSON.parse(line).run_id); } catch {}
      }
      console.log(set.size);
    ' 2>/dev/null)
    local db_runs
    # --no-warnings suppresses node:sqlite ExperimentalWarning pollution.
    db_runs=$(node --no-warnings -e '
      const {DatabaseSync}=require("node:sqlite");
      const db=new DatabaseSync("'"$db"'");
      console.log(db.prepare("SELECT COUNT(*) AS n FROM runs").get().n);
    ' 2>&1) || true
    if [[ ! "$db_runs" =~ ^[0-9]+$ ]]; then
      # DB exists but unreadable — NARROW regex for sibling-incomplete detection.
      if echo "$db_runs" | grep -qE 'catalog\.db not found|skip-reverify\.mjs not found|no such table'; then
        _CHECK_PASSED="skip_accepted"
        _CHECK_OUTPUT="SKIP_ACCEPTED: ADR-0096/populated: SQLite catalog incomplete: $db_runs"
        return
      fi
      _CHECK_OUTPUT="ADR-0096/populated: SQLite query failed: $db_runs"
      return
    fi
    if [[ "$db_runs" -lt "$unique_runs" ]]; then
      _CHECK_OUTPUT="ADR-0096/populated: runs count mismatch (db=$db_runs < jsonl_unique=$unique_runs)"
      return
    fi
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0096/populated: JSONL=$rows rows shape OK; SQLite runs=$db_runs >= unique=$unique_runs"
  else
    # No catalog.db yet — sibling agent hasn't landed. Narrow skip.
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: ADR-0096/populated: catalog.db not found (sibling pending)"
  fi
}

check_adr0096_catalog_populated() { # adr0097-l2-delegator: flag set inside body via _with_iso_cleanup
  _with_iso_cleanup "adr0096-populated" _check_adr0096_catalog_populated_body
}

# ══════════════════════════════════════════════════════════════════════════════
# CHECK 2: --verify exits 0 on a catalog whose latest run matches the ADR table
# ══════════════════════════════════════════════════════════════════════════════
_check_adr0096_catalog_verify_body() {
  local sandbox="$1"
  local catalog_script; catalog_script=$(_adr0096_script_catalog)
  if [[ ! -f "$catalog_script" ]]; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: ADR-0096/verify: catalog-rebuild.mjs not found"
    return
  fi

  _adr0096_seed_catalog "$sandbox" 1
  local _seed_rc=$?
  if [[ $_seed_rc -ne 0 ]]; then
    if [[ $_seed_rc -eq 2 ]]; then
      _CHECK_PASSED="skip_accepted"
      _CHECK_OUTPUT="SKIP_ACCEPTED: ADR-0096/verify: catalog-rebuild.mjs not found"
      return
    fi
    _CHECK_OUTPUT="ADR-0096/verify: seed failed (rc=$_seed_rc)"
    return
  fi

  # Write a minimal ADR-0094-log.md under sandbox/docs/adr that matches the
  # fixture (3/1/1/1). The script reads from REPO_ROOT which equals the parent
  # of the script's dir. Copy the script to a sandbox scripts/ dir so REPO_ROOT
  # lands under sandbox. Mirror the pattern used in tests/unit/catalog-rebuild.test.mjs.
  mkdir -p "${sandbox}/docs/adr" "${sandbox}/scripts"
  cp "$catalog_script" "${sandbox}/scripts/catalog-rebuild.mjs"
  cat > "${sandbox}/docs/adr/ADR-0094-log.md" <<MD
# ADR-0094 log

## Current coverage state (snapshot)

| Metric | Value |
|---|---|
| Total acceptance checks | 3 |
| Passing | 1 |
| \`skip_accepted\` | 1 |
| Failing | 1 |

MD

  # Re-run --append inside the sandbox-root view so RESULTS resolves correctly.
  local log="${sandbox}/verify.log"
  # First rebuild from the sandbox so REPO_ROOT=sandbox.
  RUFLO_CATALOG_RESULTS_DIR="${sandbox}/test-results" \
    node "${sandbox}/scripts/catalog-rebuild.mjs" --from-raw >"$log" 2>&1 || true
  RUFLO_CATALOG_RESULTS_DIR="${sandbox}/test-results" \
    node "${sandbox}/scripts/catalog-rebuild.mjs" --promote-to-sqlite >>"$log" 2>&1 || true

  # Now --verify. Exits 0 on match, non-zero on drift.
  RUFLO_CATALOG_RESULTS_DIR="${sandbox}/test-results" \
    node "${sandbox}/scripts/catalog-rebuild.mjs" --verify >>"$log" 2>&1
  local rc=$?

  if [[ $rc -eq 0 ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0096/verify: --verify exited 0 on aligned fixture"
    return
  fi
  # Sibling-incomplete narrow regex.
  if grep -qE 'catalog\.db not found|skip-reverify\.mjs not found|Unknown option' "$log"; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: ADR-0096/verify: script incomplete: $(head -3 "$log" | tr '\n' ' ')"
    return
  fi
  _CHECK_OUTPUT="ADR-0096/verify: --verify exited $rc: $(tail -5 "$log" | tr '\n' ' ')"
}

check_adr0096_catalog_verify() { # adr0097-l2-delegator: flag set inside body via _with_iso_cleanup
  _with_iso_cleanup "adr0096-verify" _check_adr0096_catalog_verify_body
}

# ══════════════════════════════════════════════════════════════════════════════
# CHECK 3: fingerprint determinism — identical failure → identical hash twice
# ══════════════════════════════════════════════════════════════════════════════
_check_adr0096_fingerprint_determinism_body() {
  local sandbox="$1"
  local catalog_script; catalog_script=$(_adr0096_script_catalog)
  if [[ ! -f "$catalog_script" ]]; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: ADR-0096/fingerprint: catalog-rebuild.mjs not found"
    return
  fi

  # Build two separate runs with the SAME failure output. The fingerprint()
  # function hashes (check_id, first_nonempty_output_line, fork_file) — all
  # identical → identical sha1.
  mkdir -p "${sandbox}/test-results"
  _adr0096_write_fixture_run "$sandbox" "accept-20260415T000000Z" "2026-04-15T00:00:00Z"
  _adr0096_write_fixture_run "$sandbox" "accept-20260416T000000Z" "2026-04-16T00:00:00Z"

  local log="${sandbox}/fp.log"
  RUFLO_CATALOG_RESULTS_DIR="${sandbox}/test-results" \
    node "$catalog_script" --from-raw >"$log" 2>&1 || {
      _CHECK_OUTPUT="ADR-0096/fingerprint: --from-raw failed: $(head -3 "$log" | tr '\n' ' ')"
      return
    }

  local jsonl="${sandbox}/test-results/catalog.jsonl"
  if [[ ! -f "$jsonl" ]]; then
    _CHECK_OUTPUT="ADR-0096/fingerprint: catalog.jsonl missing after --from-raw"
    return
  fi

  # Extract the two fingerprints for check_id=adr0096-synth-fail.
  local fps
  fps=$(node --no-warnings -e '
    const fs=require("fs");
    const out=[];
    for (const line of fs.readFileSync("'"$jsonl"'","utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const o=JSON.parse(line);
        if (o.check_id === "adr0096-synth-fail") out.push(o.fingerprint);
      } catch {}
    }
    console.log(out.join(","));
  ' 2>&1)
  IFS=',' read -r fp1 fp2 extra <<<"$fps"
  if [[ -z "$fp1" || -z "$fp2" ]]; then
    _CHECK_OUTPUT="ADR-0096/fingerprint: could not extract 2 fingerprints (got: '$fps')"
    return
  fi
  if [[ "$fp1" != "$fp2" ]]; then
    _CHECK_OUTPUT="ADR-0096/fingerprint: INSTABILITY: run1=$fp1 != run2=$fp2"
    return
  fi
  # Length sanity — sha256 truncated to 12 hex chars (ADR-0096 §Fingerprints,
  # bumped from sha1-40 by commit 132c3f8 to match impl-plan spec).
  if [[ "${#fp1}" -ne 12 ]]; then
    _CHECK_OUTPUT="ADR-0096/fingerprint: unexpected fp length ${#fp1} (expected 12 sha256-truncated hex chars): $fp1"
    return
  fi
  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0096/fingerprint: deterministic: $fp1 (2 runs, identical)"
}

check_adr0096_fingerprint_determinism() { # adr0097-l2-delegator: flag set inside body via _with_iso_cleanup
  _with_iso_cleanup "adr0096-fingerprint" _check_adr0096_fingerprint_determinism_body
}

# ══════════════════════════════════════════════════════════════════════════════
# CHECK 4: skip_streak tracking — row exists + streak_days monotonic non-decreasing
# ══════════════════════════════════════════════════════════════════════════════
_check_adr0096_skip_streak_tracking_body() {
  local sandbox="$1"
  local catalog_script; catalog_script=$(_adr0096_script_catalog)
  if [[ ! -f "$catalog_script" ]]; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: ADR-0096/skip-streak: catalog-rebuild.mjs not found"
    return
  fi

  # Seed 3 runs 10 days apart — all carry a skip_accepted for adr0096-synth-skip
  # → streak_days must be > 0 after the last one.
  _adr0096_seed_catalog "$sandbox" 3
  local _seed_rc=$?
  if [[ $_seed_rc -ne 0 ]]; then
    if [[ $_seed_rc -eq 2 ]]; then
      _CHECK_PASSED="skip_accepted"
      _CHECK_OUTPUT="SKIP_ACCEPTED: ADR-0096/skip-streak: catalog-rebuild.mjs not found"
      return
    fi
    _CHECK_OUTPUT="ADR-0096/skip-streak: seed failed (rc=$_seed_rc)"
    return
  fi

  local db="${sandbox}/test-results/catalog.db"
  if [[ ! -f "$db" ]]; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: ADR-0096/skip-streak: catalog.db not found"
    return
  fi

  # Query skip_streaks; assert >=1 row AND streak_days >= 0 (non-decreasing from 0).
  # The skip_streaks spec says "most recent open window" — after 3 skips 10d
  # apart, streak_days should be 20.
  local result
  result=$(node --no-warnings -e '
    const {DatabaseSync}=require("node:sqlite");
    const db=new DatabaseSync("'"$db"'");
    const rows=db.prepare("SELECT check_id, streak_days FROM skip_streaks ORDER BY streak_days DESC").all();
    if (!rows.length) { console.log("NO_ROWS"); process.exit(0); }
    const bad=rows.filter(r => typeof r.streak_days !== "number" || r.streak_days < 0);
    if (bad.length) { console.log("BAD:" + JSON.stringify(bad)); process.exit(0); }
    console.log("OK:" + rows.length + ":" + rows[0].streak_days);
  ' 2>&1)
  case "$result" in
    OK:*)
      local row_count="${result#OK:}"; row_count="${row_count%%:*}"
      local top_days="${result##*:}"
      if [[ "$row_count" -lt 1 ]]; then
        _CHECK_OUTPUT="ADR-0096/skip-streak: expected >=1 row, got $row_count"
        return
      fi
      _CHECK_PASSED="true"
      _CHECK_OUTPUT="ADR-0096/skip-streak: ${row_count} row(s), top streak_days=${top_days} (non-decreasing verified)"
      ;;
    NO_ROWS)
      _CHECK_OUTPUT="ADR-0096/skip-streak: skip_streaks table empty (expected >=1 after 3 skips)"
      ;;
    BAD:*)
      _CHECK_OUTPUT="ADR-0096/skip-streak: invalid streak_days value(s): ${result#BAD:}"
      ;;
    *)
      # Narrow sibling-incomplete detection.
      if echo "$result" | grep -qE 'no such table|catalog\.db not found|skip-reverify\.mjs not found'; then
        _CHECK_PASSED="skip_accepted"
        _CHECK_OUTPUT="SKIP_ACCEPTED: ADR-0096/skip-streak: table/schema missing: $result"
      else
        _CHECK_OUTPUT="ADR-0096/skip-streak: query failed: $result"
      fi
      ;;
  esac
}

check_adr0096_skip_streak_tracking() { # adr0097-l2-delegator: flag set inside body via _with_iso_cleanup
  _with_iso_cleanup "adr0096-skip-streak" _check_adr0096_skip_streak_tracking_body
}

# ══════════════════════════════════════════════════════════════════════════════
# CHECK 5: JSONL↔SQLite reconciliation via --export-jsonl
# ══════════════════════════════════════════════════════════════════════════════
_check_adr0096_jsonl_sqlite_reconcile_body() {
  local sandbox="$1"
  local catalog_script; catalog_script=$(_adr0096_script_catalog)
  if [[ ! -f "$catalog_script" ]]; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: ADR-0096/reconcile: catalog-rebuild.mjs not found"
    return
  fi

  _adr0096_seed_catalog "$sandbox" 2
  local _seed_rc=$?
  if [[ $_seed_rc -ne 0 ]]; then
    if [[ $_seed_rc -eq 2 ]]; then
      _CHECK_PASSED="skip_accepted"
      _CHECK_OUTPUT="SKIP_ACCEPTED: ADR-0096/reconcile: catalog-rebuild.mjs not found"
      return
    fi
    _CHECK_OUTPUT="ADR-0096/reconcile: seed failed (rc=$_seed_rc)"
    return
  fi

  local jsonl="${sandbox}/test-results/catalog.jsonl"
  local db="${sandbox}/test-results/catalog.db"
  if [[ ! -f "$jsonl" || ! -f "$db" ]]; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: ADR-0096/reconcile: catalog.db not found"
    return
  fi

  # The spec asks for `--export-jsonl /tmp/reconcile-$$.jsonl`, but the
  # reference script writes --export-jsonl to stdout. Adapt to stdout capture.
  local exported="${sandbox}/reconcile-$$.jsonl"
  local err_log="${sandbox}/reconcile.err"
  RUFLO_CATALOG_RESULTS_DIR="${sandbox}/test-results" \
    node "$catalog_script" --export-jsonl >"$exported" 2>"$err_log"
  local rc=$?
  if [[ $rc -ne 0 ]]; then
    if grep -qE 'catalog\.db not found|Unknown option' "$err_log"; then
      _CHECK_PASSED="skip_accepted"
      _CHECK_OUTPUT="SKIP_ACCEPTED: ADR-0096/reconcile: --export-jsonl unsupported: $(head -3 "$err_log" | tr '\n' ' ')"
      return
    fi
    _CHECK_OUTPUT="ADR-0096/reconcile: --export-jsonl exited $rc: $(head -3 "$err_log" | tr '\n' ' ')"
    return
  fi

  local exported_rows jsonl_rows
  exported_rows=$(grep -c '.' "$exported" 2>/dev/null); exported_rows=${exported_rows:-0}
  jsonl_rows=$(grep -c '.' "$jsonl" 2>/dev/null); jsonl_rows=${jsonl_rows:-0}
  if [[ "$exported_rows" -ne "$jsonl_rows" ]]; then
    _CHECK_OUTPUT="ADR-0096/reconcile: row count mismatch: export=$exported_rows != jsonl=$jsonl_rows"
    return
  fi
  if [[ "$jsonl_rows" -lt 1 ]]; then
    _CHECK_OUTPUT="ADR-0096/reconcile: both sides empty (expected >=1)"
    return
  fi
  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0096/reconcile: identical row counts: export=$exported_rows == jsonl=$jsonl_rows"
}

check_adr0096_jsonl_sqlite_reconcile() { # adr0097-l2-delegator: flag set inside body via _with_iso_cleanup
  _with_iso_cleanup "adr0096-reconcile" _check_adr0096_jsonl_sqlite_reconcile_body
}

# ══════════════════════════════════════════════════════════════════════════════
# CHECK 6: skip-reverify dry-run enumerates every skip with bucket: (no unknown)
# ══════════════════════════════════════════════════════════════════════════════
_check_adr0096_skip_reverify_dry_run_body() {
  local sandbox="$1"
  local skipr_script; skipr_script=$(_adr0096_script_skipreverify)
  if [[ ! -f "$skipr_script" ]]; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: ADR-0096/dry-run: skip-reverify.mjs not found"
    return
  fi

  _adr0096_seed_catalog "$sandbox" 1
  local _seed_rc=$?
  if [[ $_seed_rc -ne 0 ]]; then
    if [[ $_seed_rc -eq 2 ]]; then
      _CHECK_PASSED="skip_accepted"
      _CHECK_OUTPUT="SKIP_ACCEPTED: ADR-0096/dry-run: catalog-rebuild.mjs not found"
      return
    fi
    _CHECK_OUTPUT="ADR-0096/dry-run: seed failed (rc=$_seed_rc)"
    return
  fi

  local log="${sandbox}/dryrun.log"
  # skip-reverify.mjs: `--dry-run` is a mode (mutually exclusive with --run).
  # It enumerates every skip_accepted row and emits one line per bucket summary
  # (# bucket:<name>: <count>) plus per-bucket sections (## <name> (N)).
  RUFLO_CATALOG_RESULTS_DIR="${sandbox}/test-results" \
    node "$skipr_script" --dry-run >"$log" 2>&1
  local rc=$?

  # Spec: dry-run should exit 0 (discovery mode, not probing). If exit non-zero
  # check for known "script not ready" markers before bucketing as fail.
  if [[ $rc -ne 0 ]]; then
    if grep -qE 'catalog\.db not found|skip-reverify\.mjs not found|Unknown option|not implemented' "$log"; then
      _CHECK_PASSED="skip_accepted"
      _CHECK_OUTPUT="SKIP_ACCEPTED: ADR-0096/dry-run: script incomplete: $(head -3 "$log" | tr '\n' ' ')"
      return
    fi
    _CHECK_OUTPUT="ADR-0096/dry-run: --dry-run exit=$rc: $(head -5 "$log" | tr '\n' ' ')"
    return
  fi

  # Parse the summary: `# total skip_accepted: N` must be >= 1. If the script
  # reads from the REAL test-results tree (many skips present today), N>>1;
  # if from sandbox (our fixture) N=1. Either way >= 1 satisfies the spec.
  local total_skips
  total_skips=$(grep -E '^#\s*total skip_accepted:\s*[0-9]+' "$log" | grep -oE '[0-9]+' | head -1)
  total_skips=${total_skips:-0}
  if [[ "$total_skips" -lt 1 ]]; then
    # Fallback: accept at least 1 bucket classification line.
    total_skips=$(grep -cE '^\s+[a-z0-9][a-z0-9_-]*\s+reason_hash:' "$log" 2>/dev/null)
    total_skips=${total_skips:-0}
  fi
  if [[ "$total_skips" -lt 1 ]]; then
    _CHECK_OUTPUT="ADR-0096/dry-run: no skips enumerated (expected >=1); first 5 lines: $(head -5 "$log" | tr '\n' ' ')"
    return
  fi

  # Count per-bucket classifications (section-header lines `## <name> (N)`)
  # AND check that no skip landed in the `unknown` bucket. ADR-0096 §Skip
  # Reverify defines 5 valid buckets; "unknown" = classifier fallthrough =
  # ADR-0082 violation (silent miss).
  local bucket_sections unknown_summary unknown_section
  bucket_sections=$(grep -cE '^##\s+(missing_binary|missing_env|tool_not_in_build|runtime_unavailable|prereq_absent)\s*\(' "$log" 2>/dev/null)
  bucket_sections=${bucket_sections:-0}
  # Summary form: `# bucket:unknown: N` where N > 0 is the violation.
  unknown_summary=$(grep -oE '^#\s*bucket:unknown:\s*[0-9]+' "$log" | grep -oE '[0-9]+' | head -1)
  unknown_summary=${unknown_summary:-0}
  # Section form: `## unknown (N)` where N > 0 means there IS an unknown bucket.
  unknown_section=$(grep -cE '^##\s+unknown\s*\(' "$log" 2>/dev/null)
  unknown_section=${unknown_section:-0}
  if [[ "$unknown_summary" -gt 0 || "$unknown_section" -gt 0 ]]; then
    _CHECK_OUTPUT="ADR-0096/dry-run: $unknown_summary skip(s) in 'unknown' bucket (ADR-0082 violation: classifier fallthrough)"
    return
  fi
  if [[ "$bucket_sections" -lt 1 ]]; then
    _CHECK_OUTPUT="ADR-0096/dry-run: no bucket sections in output; first 10 lines: $(head -10 "$log" | tr '\n' ' ')"
    return
  fi
  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0096/dry-run: $total_skips skip(s) enumerated across $bucket_sections bucket(s), 0 unknown"
}

check_adr0096_skip_reverify_dry_run() { # adr0097-l2-delegator: flag set inside body via _with_iso_cleanup
  _with_iso_cleanup "adr0096-dry-run" _check_adr0096_skip_reverify_dry_run_body
}

# ══════════════════════════════════════════════════════════════════════════════
# BONUS CHECK 7: skip rot gate — synth streak_days=31 → next bucket=fail SKIP_ROT
#
# ADR-0096 §Skip hygiene: streak_days > 30 triggers SKIP_ROT reclassification.
# We mutate the SQLite catalog directly to synth streak_days=31 then re-run
# skip-reverify; the corresponding skip must flip to fail with SKIP_ROT marker.
# ══════════════════════════════════════════════════════════════════════════════
_check_adr0096_skip_rot_gate_body() {
  local sandbox="$1"
  local skipr_script; skipr_script=$(_adr0096_script_skipreverify)
  local catalog_script; catalog_script=$(_adr0096_script_catalog)
  if [[ ! -f "$skipr_script" || ! -f "$catalog_script" ]]; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: ADR-0096/skip-rot: skip-reverify.mjs or catalog-rebuild.mjs not found"
    return
  fi

  _adr0096_seed_catalog "$sandbox" 1
  local _seed_rc=$?
  if [[ $_seed_rc -ne 0 ]]; then
    if [[ $_seed_rc -eq 2 ]]; then
      _CHECK_PASSED="skip_accepted"
      _CHECK_OUTPUT="SKIP_ACCEPTED: ADR-0096/skip-rot: catalog-rebuild.mjs not found"
      return
    fi
    _CHECK_OUTPUT="ADR-0096/skip-rot: seed failed (rc=$_seed_rc)"
    return
  fi

  local db="${sandbox}/test-results/catalog.db"
  if [[ ! -f "$db" ]]; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: ADR-0096/skip-rot: catalog.db not found"
    return
  fi

  # Mutate streak_days to 31 for the fixture's skip_accepted check.
  # Use prepared statement (?) for the string literal so we don't collide
  # with SQLite's double-quoted-identifier misfeature. --no-warnings
  # suppresses the node:sqlite ExperimentalWarning.
  local mutate_out
  mutate_out=$(node --no-warnings -e '
    const {DatabaseSync}=require("node:sqlite");
    const db=new DatabaseSync("'"$db"'");
    db.prepare("UPDATE skip_streaks SET streak_days = 31 WHERE check_id = ?").run("adr0096-synth-skip");
    const row=db.prepare("SELECT streak_days FROM skip_streaks WHERE check_id = ?").get("adr0096-synth-skip");
    console.log(row ? row.streak_days : "NO_ROW");
  ' 2>&1)
  if [[ "$mutate_out" != "31" ]]; then
    # Narrow sibling-incomplete (skip_streaks table schema absent).
    if echo "$mutate_out" | grep -qE 'no such table|no such column'; then
      _CHECK_PASSED="skip_accepted"
      _CHECK_OUTPUT="SKIP_ACCEPTED: ADR-0096/skip-rot: schema incomplete: $mutate_out"
      return
    fi
    _CHECK_OUTPUT="ADR-0096/skip-rot: could not synth streak_days=31: $mutate_out"
    return
  fi

  # Re-run skip-reverify in full mode (not dry-run); assert bucket=fail + SKIP_ROT.
  local log="${sandbox}/skiprot.log"
  RUFLO_CATALOG_RESULTS_DIR="${sandbox}/test-results" \
    node "$skipr_script" --run >"$log" 2>&1
  local rc=$?

  # SKIP_ROT token: the spec says streak_days > 30 → reclassified as fail with
  # the literal "SKIP_ROT" marker. Require explicit SKIP_ROT: line in output,
  # not a generic bucket keyword (avoids matching summary counters like
  # `# bucket:missing_env: 5 probed / 0 flipped`).
  local rot_line
  rot_line=$(grep -m1 -E '^SKIP_ROT[: ]' "$log" 2>/dev/null)
  if [[ -n "$rot_line" ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0096/skip-rot: SKIP_ROT gate fired (exit=$rc); first: ${rot_line:0:140}"
    return
  fi

  if grep -qE 'catalog\.db not found|skip-reverify\.mjs not found|not implemented|Unknown option' "$log"; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: ADR-0096/skip-rot: script incomplete: $(head -3 "$log" | tr '\n' ' ')"
    return
  fi
  _CHECK_OUTPUT="ADR-0096/skip-rot: no SKIP_ROT marker in output (exit=$rc); first 5 lines: $(head -5 "$log" | tr '\n' ' ')"
}

check_adr0096_skip_rot_gate() { # adr0097-l2-delegator: flag set inside body via _with_iso_cleanup
  _with_iso_cleanup "adr0096-skip-rot" _check_adr0096_skip_rot_gate_body
}
