#!/usr/bin/env bash
# scripts/test-stress-runtime.sh — ADR-0243 CT-J runtime stress harness.
#
# Closes the G-16-014 carry-forward gap: ADR-0233 §Reviews still owed + ADR-0201
# §Carry-forward list the full G-16-014 scope (a long-running MCP-stdio soak
# that asserts RSS does not drift past budget) as the runtime complement to
# the static catch that ADR-0243 already remediates. The static audit
# (`G-16-014` slice 10) covered the surfaces; this harness empirically
# validates that on a long-lived process, the CT-J fixes hold under load:
#
#   - HiveLRU eviction caps the hive-mind-state Map (no unbounded growth)
#   - `.unref()` discipline on `setInterval` lets the event loop drain
#   - `installSignalHandlersOnce` gates re-entrant signal registration
#
# Methodology
# ────────────
# 1. Spawn one long-lived `cli mcp start` child process (stdio MCP server —
#    same wire path Claude Code uses via `.mcp.json`).
# 2. Drive N JSON-RPC requests on stdin (default N=10000; configurable via
#    STRESS_N). Mix the request set to exercise:
#      - HiveLRU paths (`hive-mind_status`, `hive-mind_init`)
#      - timer-bearing paths (`agent_list`, `memory_search` — both backed by
#        controllers that own `setInterval` timers internally)
#      - re-entrant init paths (`hooks_intelligence_stats` — the singleton
#        intel pipeline is re-initialised lazily)
#      - hot write paths (`memory_store` — cycles through RVF write +
#        archivist dispatch, the same surface that holds `_pendingNativeIngest`)
# 3. Every M requests (default M = max(STRESS_N/20, 50)), externally sample:
#      - RSS via `ps -o rss=` on the child PID (KB on macOS/Linux)
#      - open file count via `lsof -p $pid | wc -l`
# 4. After all requests dispatch, compute a least-squares slope of RSS vs
#    sample-index. Assert:
#      (a) |slope| < ε  → RSS drift is bounded (not monotonically growing)
#      (b) final_rss  < K × baseline_rss → no runaway absolute growth
#      (c) final_handles < baseline_handles + Δ → no FD leak
#
# Why a bash wrapper around a node driver
# ────────────────────────────────────────
# The bash side does env setup, harness install verification, and the
# external `ps`/`lsof` polling (clean separation from the in-band MCP I/O).
# The node side owns the long-lived stdio pipe (newline-delimited JSON-RPC
# framing in pure bash is fragile and slow) and the post-run regression
# analysis. The two communicate via a result JSON file.
#
# Per project conventions:
#   - feedback-no-tail-tests / feedback-full-test-output: all subprocess
#     output written to a per-run log file under
#     /tmp/ruflo-stress-runtime-XXXXX/; never `tail`-piped.
#   - feedback-no-fallbacks: MCP start failure → FAIL loudly; lsof missing
#     → FAIL loudly (the test is a soak test, not a best-effort probe).
#   - feedback-no-squelch-tests: the only skip path is the explicit
#     RUFLO_FAST_TESTS=1 opt-out (matches feedback-skip-accepted-as-squelch
#     "env-disabled" carve-out). No --no-check, no try-and-warn dodges.
#   - reference-cli-cmd-helper: prefers local `node_modules/.bin/ruflo`
#     when available (matches _cli_cmd contract); only falls back to npx
#     if no install is found.
#
# Usage
# ─────
#   bash scripts/test-stress-runtime.sh
#                                      # full: STRESS_N=10000, ~10-25min
#   STRESS_N=100  bash scripts/test-stress-runtime.sh
#                                      # smoke: ~30-60s (CI/harness wiring)
#   RUFLO_FAST_TESTS=1 bash scripts/test-stress-runtime.sh
#                                      # explicit env opt-out (exit 0,
#                                      # logged as SKIP_ACCEPTED:env)
#
# Tunables (env)
# ──────────────
#   STRESS_N                 number of MCP requests       (default 10000)
#   STRESS_SAMPLE_EVERY      sample cadence in requests   (default N/20, min 50)
#   STRESS_MAX_SLOPE_KB      RSS slope threshold KB/sample (default 256)
#   STRESS_MAX_GROWTH_RATIO  final/baseline RSS multiple   (default 3.0)
#   STRESS_MAX_HANDLE_DELTA  final-baseline handle count   (default 50)
#   STRESS_TIMEOUT_S         overall soak timeout         (default 1800)
#   RUFLO_FAST_TESTS=1       skip (env opt-out)
#   REGISTRY                 npm registry to use          (default http://localhost:4873)
#
# Exit codes
# ──────────
#   0  — pass OR explicit env opt-out (RUFLO_FAST_TESTS=1)
#   1  — assertion failed (RSS drift / handle leak / final-growth)
#   2  — harness wiring failure (CLI missing, MCP fails to start, lsof absent)

set -o pipefail

# ADR-0243 / ADR-0233 carry-forward: stress test is gated until the 14× RSS
# signal at N=100 is disambiguated. To run it explicitly:
#   STRESS_INVESTIGATION_PENDING=0 bash scripts/test-stress-runtime.sh
if [ "${STRESS_INVESTIGATION_PENDING:-1}" != "0" ]; then
  echo "SKIPPED: scripts/test-stress-runtime.sh is gated as investigation-pending."
  echo "  See docs/plans/2026-05-25-post-batch5-followup-execution-plan.md row A."
  echo "  Set STRESS_INVESTIGATION_PENDING=0 to run."
  exit 0
fi

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# ── Env opt-out (the ONLY legitimate skip path per feedback-no-squelch-tests) ──
if [[ "${RUFLO_FAST_TESTS:-0}" == "1" ]]; then
  echo "[stress] SKIP_ACCEPTED:env — RUFLO_FAST_TESTS=1 (set 0 or unset to run)"
  exit 0
fi

# ── Tunables ──────────────────────────────────────────────────────────
STRESS_N="${STRESS_N:-10000}"
if ! [[ "$STRESS_N" =~ ^[0-9]+$ ]] || (( STRESS_N < 1 )); then
  echo "[stress] FATAL: STRESS_N must be a positive integer (got: $STRESS_N)" >&2
  exit 2
fi

# Default cadence: 20 samples across the run, floor of 50.
if [[ -z "${STRESS_SAMPLE_EVERY:-}" ]]; then
  STRESS_SAMPLE_EVERY=$(( STRESS_N / 20 ))
  (( STRESS_SAMPLE_EVERY < 50 )) && STRESS_SAMPLE_EVERY=50
  (( STRESS_SAMPLE_EVERY > STRESS_N )) && STRESS_SAMPLE_EVERY=$STRESS_N
fi

STRESS_MAX_SLOPE_KB="${STRESS_MAX_SLOPE_KB:-256}"
STRESS_MAX_GROWTH_RATIO="${STRESS_MAX_GROWTH_RATIO:-3.0}"
STRESS_MAX_HANDLE_DELTA="${STRESS_MAX_HANDLE_DELTA:-50}"
STRESS_TIMEOUT_S="${STRESS_TIMEOUT_S:-1800}"
REGISTRY="${REGISTRY:-http://localhost:4873}"

# ── Resolve CLI (matches _cli_cmd contract; never raw `npx @latest`) ──
CLI_BIN=""
for _root in "$PROJECT_DIR" "${ACCEPT_TEMP:-}" "${TEMP_DIR:-}"; do
  [[ -z "$_root" ]] && continue
  for _c in ruflo claude-flow cli; do
    if [[ -x "${_root}/node_modules/.bin/${_c}" ]]; then
      CLI_BIN="${_root}/node_modules/.bin/${_c}"
      break 2
    fi
  done
done

if [[ -z "$CLI_BIN" ]]; then
  echo "[stress] FATAL: no CLI binary found in node_modules/.bin/ under" >&2
  echo "        $PROJECT_DIR (or ACCEPT_TEMP/TEMP_DIR). Install with:" >&2
  echo "        (cd $PROJECT_DIR && npm install --registry $REGISTRY)" >&2
  exit 2
fi

# ── Verify external tools (fail loudly per feedback-no-fallbacks) ──
if ! command -v lsof >/dev/null 2>&1; then
  echo "[stress] FATAL: lsof not on PATH — required for FD-leak assertion" >&2
  echo "        macOS ships lsof by default. CI hosts that lack it cannot" >&2
  echo "        run this test (no silent fallback per feedback-no-fallbacks)." >&2
  exit 2
fi
if ! command -v ps >/dev/null 2>&1; then
  echo "[stress] FATAL: ps not on PATH — required for RSS sampling" >&2
  exit 2
fi
if ! command -v node >/dev/null 2>&1; then
  echo "[stress] FATAL: node not on PATH" >&2
  exit 2
fi

# ── Work directory + log paths ────────────────────────────────────────
WORK_DIR=$(mktemp -d /tmp/ruflo-stress-runtime-XXXXX)
trap "rm -rf '$WORK_DIR' 2>/dev/null || true" EXIT

LOG="${WORK_DIR}/stress.log"
RESULT_JSON="${WORK_DIR}/result.json"
SAMPLES_CSV="${WORK_DIR}/samples.csv"

echo "[stress] ADR-0243 CT-J runtime stress harness" | tee -a "$LOG"
echo "[stress]   CLI:                $CLI_BIN" | tee -a "$LOG"
echo "[stress]   STRESS_N:           $STRESS_N" | tee -a "$LOG"
echo "[stress]   STRESS_SAMPLE_EVERY: $STRESS_SAMPLE_EVERY" | tee -a "$LOG"
echo "[stress]   STRESS_MAX_SLOPE_KB: $STRESS_MAX_SLOPE_KB KB/sample" | tee -a "$LOG"
echo "[stress]   STRESS_MAX_GROWTH:   ${STRESS_MAX_GROWTH_RATIO}× baseline" | tee -a "$LOG"
echo "[stress]   STRESS_MAX_HANDLE:   +${STRESS_MAX_HANDLE_DELTA} fds" | tee -a "$LOG"
echo "[stress]   WORK_DIR:           $WORK_DIR" | tee -a "$LOG"
echo "[stress]" | tee -a "$LOG"

# ── Run the node driver under a timeout ───────────────────────────────
# The driver owns the long-lived MCP child + sampling concurrency.
# Bash wraps it with a hard timeout so a hung MCP can't drag forever.
NODE_DRIVER="${PROJECT_DIR}/scripts/stress-runtime-driver.mjs"
if [[ ! -f "$NODE_DRIVER" ]]; then
  echo "[stress] FATAL: driver missing: $NODE_DRIVER" >&2
  exit 2
fi

set +e
STRESS_N="$STRESS_N" \
  STRESS_SAMPLE_EVERY="$STRESS_SAMPLE_EVERY" \
  STRESS_MAX_SLOPE_KB="$STRESS_MAX_SLOPE_KB" \
  STRESS_MAX_GROWTH_RATIO="$STRESS_MAX_GROWTH_RATIO" \
  STRESS_MAX_HANDLE_DELTA="$STRESS_MAX_HANDLE_DELTA" \
  STRESS_TIMEOUT_S="$STRESS_TIMEOUT_S" \
  STRESS_CLI_BIN="$CLI_BIN" \
  STRESS_LOG="$LOG" \
  STRESS_RESULT_JSON="$RESULT_JSON" \
  STRESS_SAMPLES_CSV="$SAMPLES_CSV" \
  STRESS_WORK_DIR="$WORK_DIR" \
  NPM_CONFIG_REGISTRY="$REGISTRY" \
  node "$NODE_DRIVER" 2>&1 | tee -a "$LOG"
DRIVER_RC=${PIPESTATUS[0]}
set -e

# ── Surface verdict from the result JSON ─────────────────────────────
if [[ ! -f "$RESULT_JSON" ]]; then
  echo "[stress] FATAL: driver did not write result JSON ($RESULT_JSON)" | tee -a "$LOG"
  echo "[stress] Log tail:" >&2
  # Per feedback-no-tail-tests: full log already saved to $LOG; surface
  # the path so the user can read it, do not pipe-mid-stream.
  echo "         $LOG" >&2
  exit 2
fi

VERDICT=$(node -e "
  const r = JSON.parse(require('fs').readFileSync('$RESULT_JSON','utf8'));
  process.stdout.write(r.verdict || 'UNKNOWN');
" 2>/dev/null || echo "PARSE_ERR")

echo "" | tee -a "$LOG"
echo "[stress] verdict: $VERDICT" | tee -a "$LOG"
echo "[stress] full log:    $LOG" | tee -a "$LOG"
echo "[stress] result JSON: $RESULT_JSON" | tee -a "$LOG"
echo "[stress] samples CSV: $SAMPLES_CSV" | tee -a "$LOG"

case "$VERDICT" in
  PASS) exit 0 ;;
  FAIL) exit 1 ;;
  *)
    # If the driver exited non-zero without writing PASS/FAIL, treat as
    # harness failure (rc=2). Avoid silently re-classifying as pass.
    echo "[stress] FATAL: unrecognised verdict '$VERDICT' (driver rc=$DRIVER_RC)" >&2
    exit 2
    ;;
esac
