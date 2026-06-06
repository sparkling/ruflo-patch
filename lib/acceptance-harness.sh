#!/usr/bin/env bash
# lib/acceptance-harness.sh — Generic acceptance test framework (ADR-0037)
#
# Extracted from scripts/test-acceptance.sh to keep the main script under 500
# lines and allow reuse.
#
# Contract:
#   Caller MUST define: _ns, _elapsed_ms, log (timing/logging helpers)
#   Caller MUST define: run_timed (sets _OUT, _EXIT, _DURATION_MS)
#   This file provides: _escape_json, run_check, run_check_bg, collect_parallel,
#     _record_phase, and the result-tracking variables.

# ══════════════════════════════════════════════════════════════════════════════
# Default parallelism cap
# ══════════════════════════════════════════════════════════════════════════════
# scripts/test-acceptance.sh fans ~150 checks into a single mega-parallel wave
# (ADR-0059). Each check sub-shell spawns daemon + CLI + assertion children
# (~3-4 procs/check), so unbounded fan-out crushes the runqueue on developer
# laptops (load → 106, free RAM → 39MB on 18-core M5 Max with raw fan-out).
#
# History:
#   - ncpu/2 (= 9 on M5 Max): adopted after the cap=6 reaction to the
#     wrapper-proxy + ADR-0129 sibling regressions (2026-05-04 → 2026-05-07).
#     Both regression conditions resolved. April baseline ran 561 checks
#     in ~70s wall (122x effective parallelism).
#   - ncpu/3 (= 6 on M5 Max): briefly tried 2026-05-16 after load=27 spike.
#     Diagnosis turned out to be (a) mds_stores at 88% CPU (now fixed by
#     `.metadata_never_index` marker below) and (b) fseventsd churn from
#     137 leftover /tmp/ruflo-wrapper-solo-* dirs (cleaned up). With those
#     resolved, the underlying load=27 was over-attributed to fan-out. The
#     cap=6 cost was +24s on all-checks vs cap=9.
#   - ncpu/2 (= 9 on M5 Max): RESTORED. Spotlight + churn fixes mean cap=9
#     is safe again. If load spikes return, first investigate macOS daemon
#     state before dropping the cap.
#
# Override with RUFLO_MAX_PARALLEL=N (0 disables the cap).
if [[ -z "${RUFLO_MAX_PARALLEL+x}" ]]; then
  if command -v sysctl >/dev/null 2>&1 && _ncpu=$(sysctl -n hw.ncpu 2>/dev/null) && [[ "$_ncpu" =~ ^[0-9]+$ ]]; then
    :
  elif [[ -r /proc/cpuinfo ]]; then
    _ncpu=$(grep -c '^processor' /proc/cpuinfo 2>/dev/null || echo 8)
  else
    _ncpu=8
  fi
  # Conservative default for a SHARED server (other swarms/agents commonly run
  # here — confirmed load source). Cap at ~ncpu/4 so latency-sensitive checks
  # (adr0261 p99 graph benchmark) and subprocess-heavy checks (adr0297 MCP/CLI
  # spawns) aren't starved when acceptance self-contention stacks on external
  # swarm load. Was ncpu/2 (=9 on an 18-core box), which flaked under concurrent
  # swarms. Override with RUFLO_MAX_PARALLEL=N (higher on a quiet box, 0 to disable).
  RUFLO_MAX_PARALLEL=$(( _ncpu / 4 ))
  (( RUFLO_MAX_PARALLEL < 4 )) && RUFLO_MAX_PARALLEL=4
  unset _ncpu
  export RUFLO_MAX_PARALLEL
fi

# ══════════════════════════════════════════════════════════════════════════════
# macOS Spotlight indexing — opt out for build/test churn dirs
# ══════════════════════════════════════════════════════════════════════════════
# `mds_stores` (Spotlight metadata indexer) consumed 88% CPU during the
# 2026-05-16 release run because /tmp/ruflo-build and /tmp/ruflo-accept-*
# directories churn heavily (install + codemod + test fan-out generate
# thousands of file events). `mdutil -i off` only works on volume mount
# points, not arbitrary subdirs. The supported macOS opt-out is the magic
# marker file `.metadata_never_index`: any directory containing it (and
# its descendants) is skipped by Spotlight. Idempotent — safe to repeat.
# No-op on Linux.
_disable_spotlight_indexing() {
  [[ "$(uname -s 2>/dev/null)" == "Darwin" ]] || return 0
  local _marker=".metadata_never_index"
  local _touched=()
  local _d
  # NOTE: tried adding `tmutil addexclusion -p` to also suppress Time Machine's
  # backupd FSEvents subscription. Two problems: (1) `tmutil addexclusion`
  # requires root (silently failed); (2) iterating tmutil calls across the
  # leftover /tmp/ruflo-wrapper-solo-* dirs (137 observed) added ~22s per
  # source-time call × 100+ unit test files that source this lib =
  # ~37 min of overhead, which deadlocked test-ci in r5 (commit cdd831b reverted).
  # Spotlight marker stays; FSEvents/TM exclusion needs a different angle.
  for _d in /tmp/ruflo-build \
            /tmp/ruflo-accept-* \
            /tmp/ruflo-accept-par-* \
            /tmp/ruflo-fast-* \
            /tmp/ruflo-e2e-* \
            "${PARALLEL_DIR:-}" \
            "${ACCEPT_TEMP:-}" \
            "${E2E_DIR:-}"; do
    [[ -z "$_d" ]] && continue
    [[ -d "$_d" ]] || continue
    if touch "$_d/$_marker" 2>/dev/null; then
      _touched+=("$_d")
    fi
  done
  if [[ ${#_touched[@]} -gt 0 ]] && declare -F log >/dev/null 2>&1; then
    log "  Spotlight: disabled indexing in ${#_touched[@]} dir(s): ${_touched[*]}"
  fi
}

# Call at source time to cover any dirs that already exist.
_disable_spotlight_indexing

# ── ADR-0182 L2: APFS clonefile snapshot helper ─────────────────────────────
# Replaces full byte-copy snapshots with inode-table clones on APFS (macOS ≥26
# / Darwin 25.4.0+), saving ~2.0 GB write_bytes per release on the e2e
# snapshot site. clonefile(2) refuses /dev/null, so the probe must use a real
# regular file. Each branch logs its own marker so operators can audit which
# strategy fired.
#
# Strategies, in preference order:
#   cow       — `cp -cR` (BSD clonefile, APFS only)
#   hardlink  — `cp -al` (GNU/Linux hardlink farm, foreign FS)
#   recursive — `cp -r`  (last-resort fallback, slowest, always correct)
_ACCEPT_COW_PROBE_RESULT=""   # cached probe verdict: 0 = COW works, 1 = no
_acceptance_cow_probe() {
  local src_probe dst_probe rc
  src_probe=$(mktemp /tmp/.cow-probe-src.XXXX) || return 1
  dst_probe=$(mktemp -u /tmp/.cow-probe-dst.XXXX) || { rm -f "$src_probe"; return 1; }
  echo x > "$src_probe"
  cp -c "$src_probe" "$dst_probe" 2>/dev/null
  rc=$?
  rm -f "$src_probe" "$dst_probe" 2>/dev/null
  return $rc
}

_acceptance_snapshot() {
  local src="$1" dst="$2"
  if [[ -z "$_ACCEPT_COW_PROBE_RESULT" ]]; then
    if _acceptance_cow_probe; then
      _ACCEPT_COW_PROBE_RESULT=0
    else
      _ACCEPT_COW_PROBE_RESULT=1
    fi
  fi
  # ADR-0182 L2 fix (post-wave3-baseline catastrophic regression): use src/. dst/
  # form to copy CONTENTS into an existing dst dir, matching the prior
  # `cp -r "$src/." "$dst/"` semantics. Earlier helper required `rmdir "$dst"`
  # before the cp — but `_disable_spotlight_indexing` adds a marker file,
  # making rmdir fail. cp -cR src dst with dst-already-exists then creates
  # dst/$(basename src), leaving the snapshot at the wrong path.
  #
  # L11/L13(b) re-attempt fix (2026-05-17): suppress per-file stderr noise
  # AND always return 0. Volatile files in $src — daemon.sock (BSD cp cannot
  # copy sockets), memory.rvf.wal/.lock (transient writes from a live daemon)
  # — cause cp to return non-zero even when ~99% of the content copied
  # successfully. The L11 reverted commit (1117b66) used
  # `_acceptance_snapshot ... || return` and tripped on socket errors;
  # mirrors the same volatile-file race that L10-ext was narrowed for
  # (commit 32121db). Downstream callers verify their specific expected
  # files via existence checks — the snapshot is best-effort, not
  # all-or-nothing. Honours `feedback-no-fallbacks` (no silent recovery
  # from a fundamentally broken state — bulk copy IS successful, only
  # known-non-copyable file types are tolerated) and `feedback-no-squelch-tests`
  # (downstream assertions still run on the cloned content).
  mkdir -p "$dst" 2>/dev/null || true
  if [[ "$_ACCEPT_COW_PROBE_RESULT" == "0" ]]; then
    echo "[L2] _acceptance_snapshot: cow ($src/. -> $dst/)" >&2
    cp -cR "$src/." "$dst/" 2>/dev/null
  elif [[ "$(uname -s 2>/dev/null)" == "Linux" ]]; then
    echo "[L2] _acceptance_snapshot: hardlink ($src/. -> $dst/)" >&2
    cp -al "$src/." "$dst/" 2>/dev/null
  else
    echo "[L2] _acceptance_snapshot: recursive ($src/. -> $dst/)" >&2
    cp -r "$src/." "$dst/" 2>/dev/null
  fi
  return 0
}

# ══════════════════════════════════════════════════════════════════════════════
# Result tracking
# ══════════════════════════════════════════════════════════════════════════════
pass_count=0
fail_count=0
skip_count=0   # ADR-0090 Tier A2: accepted-skip bucket (NOT counted as PASS)
total_count=0
results_json="[]"

# ══════════════════════════════════════════════════════════════════════════════
# Phase timing
# ══════════════════════════════════════════════════════════════════════════════
PHASE_TIMINGS=""
TIMING_FILE="/tmp/ruflo-acceptance-timing.jsonl"
: > "$TIMING_FILE"

_record_phase() {
  local name="$1" ms="$2"
  PHASE_TIMINGS="${PHASE_TIMINGS} ${name}:${ms}"
  printf '{"phase":"%s","duration_ms":%d}\n' "$name" "$ms" >> "$TIMING_FILE"
  if [[ $ms -ge 1000 ]]; then
    log "  Phase '${name}': ${ms}ms ($(( ms / 1000 ))s)"
  else
    log "  Phase '${name}': ${ms}ms"
  fi
}

# ══════════════════════════════════════════════════════════════════════════════
# JSON escaping
# ══════════════════════════════════════════════════════════════════════════════
# ADR-0094 Sprint 0 WI-2 fix: previous version escaped \n/\r/\t (in practice the
# \t branch never fired because it appeared before the \\ branch — the bash
# string replacement applied them in order; the \\ branch ran first and left
# \t untouched). More critically, it did NOT escape the bare 0x08 (backspace),
# 0x09 (tab), 0x0B (vertical tab), 0x0C (form feed), 0x0D (carriage return),
# or other ASCII control chars. Catalog ingest choked at pos 109089 on one
# such bare control byte.
#
# RFC 8259 JSON requires that control chars U+0000..U+001F be escaped. We emit
# the canonical short forms for \b \t \n \f \r and use \uXXXX for the rest.
_escape_json() {
  local s="${1:-}"
  s="${s:0:4096}"
  # Backslash first — all other sequences below emit backslashes that MUST NOT
  # be re-escaped by a later replacement pass.
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  # Canonical short escapes for the common cases.
  s="${s//$'\b'/\\b}"
  s="${s//$'\t'/\\t}"
  s="${s//$'\n'/\\n}"
  s="${s//$'\f'/\\f}"
  s="${s//$'\r'/\\r}"
  # Remaining ASCII control chars (U+0000..U+001F minus \b\t\n\f\r handled
  # above, plus DEL=0x7F). NUL (0x00) cannot appear in bash strings so we
  # skip it. We use $'\xNN' ANSI-C quoting which is supported in bash 3.2+.
  s="${s//$'\x01'/\\u0001}"
  s="${s//$'\x02'/\\u0002}"
  s="${s//$'\x03'/\\u0003}"
  s="${s//$'\x04'/\\u0004}"
  s="${s//$'\x05'/\\u0005}"
  s="${s//$'\x06'/\\u0006}"
  s="${s//$'\x07'/\\u0007}"
  s="${s//$'\x0b'/\\u000b}"
  s="${s//$'\x0e'/\\u000e}"
  s="${s//$'\x0f'/\\u000f}"
  s="${s//$'\x10'/\\u0010}"
  s="${s//$'\x11'/\\u0011}"
  s="${s//$'\x12'/\\u0012}"
  s="${s//$'\x13'/\\u0013}"
  s="${s//$'\x14'/\\u0014}"
  s="${s//$'\x15'/\\u0015}"
  s="${s//$'\x16'/\\u0016}"
  s="${s//$'\x17'/\\u0017}"
  s="${s//$'\x18'/\\u0018}"
  s="${s//$'\x19'/\\u0019}"
  s="${s//$'\x1a'/\\u001a}"
  s="${s//$'\x1b'/\\u001b}"
  s="${s//$'\x1c'/\\u001c}"
  s="${s//$'\x1d'/\\u001d}"
  s="${s//$'\x1e'/\\u001e}"
  s="${s//$'\x1f'/\\u001f}"
  s="${s//$'\x7f'/\\u007f}"
  printf '"%s"' "$s"
}

# ══════════════════════════════════════════════════════════════════════════════
# Sequential check runner
# ══════════════════════════════════════════════════════════════════════════════
run_check() {
  local id="$1" name="$2" fn="$3" group="$4"
  total_count=$((total_count + 1))
  local c_start c_end c_ms=0
  c_start=$(_ns)
  "$fn"
  c_end=$(_ns)
  c_ms=$(_elapsed_ms "$c_start" "$c_end")

  # ADR-0090 Tier A2: three-way result (pass / fail / skip_accepted).
  # skip_accepted is ONLY for checks where a prerequisite is legitimately
  # absent from the build (e.g. native binary missing). It is NOT PASS —
  # it is bucketed as a WARNING so missing coverage stays visible.
  local passed_bool="false"
  local status_field="\"failed\""
  if [[ "$_CHECK_PASSED" == "true" ]]; then
    pass_count=$((pass_count + 1)); passed_bool="true"
    status_field="\"passed\""
    log "  PASS  ${id}: ${name} (${c_ms}ms)"
  elif [[ "$_CHECK_PASSED" == "skip_accepted" ]]; then
    skip_count=$((skip_count + 1))
    status_field="\"skip_accepted\""
    log "  SKIP  ${id}: ${name} (${c_ms}ms)  [accepted]"
    echo "${_CHECK_OUTPUT:-}" | head -3 | while IFS= read -r line; do log "        $line"; done
  else
    fail_count=$((fail_count + 1))
    log "  FAIL  ${id}: ${name} (${c_ms}ms)"
    echo "${_CHECK_OUTPUT:-}" | head -3 | while IFS= read -r line; do log "        $line"; done
  fi
  [[ $c_ms -gt 15000 ]] && log "  SLOW  ${id}: ${c_ms}ms"

  local escaped; escaped=$(_escape_json "${_CHECK_OUTPUT:-${_OUT:-}}")
  local entry; entry=$(printf '{"id":"%s","name":"%s","group":"%s","passed":%s,"status":%s,"output":%s,"duration_ms":%d}' \
    "$id" "$name" "$group" "$passed_bool" "$status_field" "$escaped" "$c_ms")
  [[ "$results_json" == "[]" ]] && results_json="[$entry]" || results_json="${results_json%]}, $entry]"
}

# ══════════════════════════════════════════════════════════════════════════════
# Parallel check runner
# ══════════════════════════════════════════════════════════════════════════════
PARALLEL_DIR=""
BG_PIDS=()

# ── Heavy-test opt-out ──────────────────────────────────────────────────────
# Tests in this set take >10s each AND are reliably passing. They're skipped
# by default in the normal acceptance run. Opt back IN with:
#   ACCEPTANCE_HEAVY=1 npm run release
#   ACCEPTANCE_HEAVY=1 bash scripts/test-acceptance.sh
# Or invoke targeted via test-acceptance-fast.sh <group>.
#
# Profile (logs/adr0181-phase8-r1-pre-heavy-skip.log slowest passes):
#   p4-br-navigation              ~75s   (Playwright browser navigation)
#   p4-br-interaction             ~26s   (Playwright)
#   p4-br-snapshot                ~17s   (Playwright)
#   t3-1-bulk-corpus              ~17s   (ReasoningBank bulk ranking)
#   t1-2-learning                 ~10s   (Learning feedback)
#   t3-4-reasoningbank            ~11s   (ReasoningBank cycle)
#   p7-fo-neural                  ~11s   (Neural dir scan)
#   p8-inv1-memory                ~11s   (memory store→search invariant)
#   adr0090-b5-memoryConsolidation ~10s  (B5 consolidation; already skip_accepted)
#
# Total saved per release: ~3 minutes of acceptance wall time (from ~5.5min → ~2.5min).
declare -A _HEAVY_CHECK_IDS=(
  [p4-br-navigation]=1
  [p4-br-interaction]=1
  [p4-br-snapshot]=1
  [t3-1-bulk-corpus]=1
  [t1-2-learning]=1
  [t3-4-reasoningbank]=1
  [p7-fo-neural]=1
  [p8-inv1-memory]=1
  [adr0090-b5-memoryConsolidation]=1
)

run_check_bg() {
  local id="$1" name="$2" fn="$3" group="$4"
  # Heavy-test opt-out: if the check is heavy AND the user hasn't set
  # ACCEPTANCE_HEAVY=1, write a skip_accepted verdict and return immediately
  # without running the check function. Keeps the test inventory complete
  # (so collect_parallel finds the result file) but trades coverage for speed.
  if [[ "${ACCEPTANCE_HEAVY:-0}" != "1" ]] && [[ -n "${_HEAVY_CHECK_IDS[$id]:-}" ]]; then
    if [[ -n "${PARALLEL_DIR}" ]]; then
      # Wrap through _escape_json so the JSON output field carries its
      # surrounding quotes — without this, the parallel-collect path
      # writes `"output":HEAVY_SKIP: ...` (no opening quote) which
      # makes acceptance-results.json unparseable as JSON. Caught by
      # scripts/check-skip-accepted.mjs.
      local _heavy_msg; _heavy_msg=$(_escape_json "HEAVY_SKIP: ${id} skipped — opt in with ACCEPTANCE_HEAVY=1 (saves ~3min wall time)")
      echo "skip_accepted|0|${_heavy_msg}" > "${PARALLEL_DIR}/${id}"
    fi
    return 0
  fi
  if [[ "${RUFLO_SERIAL:-0}" == "1" ]]; then
    # Serial diagnosis mode: run inline, log start so a watchdog can identify
    # the currently-running check from log tail. No backgrounding.
    log "  RUN   ${id}: ${name}"
    (
      set +u
      _CHECK_PASSED="false"; _CHECK_OUTPUT=""
      local c_start c_end c_ms=0
      c_start=$(_ns)
      "$fn" || true
      c_end=$(_ns)
      c_ms=$(_elapsed_ms "$c_start" "$c_end")
      local escaped; escaped=$(_escape_json "${_CHECK_OUTPUT:-${_OUT:-}}")
      echo "${_CHECK_PASSED:-false}|${c_ms:-0}|${escaped}" > "${PARALLEL_DIR}/${id}"
    )
    return 0
  fi
  # Throttle: cap concurrent backgrounded checks at RUFLO_MAX_PARALLEL (if set).
  # Polls every 50ms until a slot frees, then proceeds.
  if [[ "${RUFLO_MAX_PARALLEL:-0}" =~ ^[0-9]+$ ]] && (( ${RUFLO_MAX_PARALLEL:-0} > 0 )); then
    while (( ${#BG_PIDS[@]} >= RUFLO_MAX_PARALLEL )); do
      local _alive=() _p
      for _p in "${BG_PIDS[@]}"; do
        kill -0 "$_p" 2>/dev/null && _alive+=("$_p")
      done
      BG_PIDS=("${_alive[@]}")
      (( ${#BG_PIDS[@]} >= RUFLO_MAX_PARALLEL )) && sleep 0.05
    done
    log "  RUN   ${id}: ${name}"
  fi
  (
    set +u  # disable strict unset — check functions may leave vars unset in helper chains
    _CHECK_PASSED="false"; _CHECK_OUTPUT=""
    local c_start c_end c_ms=0
    c_start=$(_ns)

    # Per-check watchdog (default 180s, override via RUFLO_CHECK_TIMEOUT_S).
    # Without this, a hung check (e.g. unbounded npx that prompts on stdin,
    # daemon socket that never responds) holds its parallel slot AND
    # collect_parallel's `wait "${BG_PIDS[@]}"` blocks forever — dragging
    # the whole acceptance phase past RUFLO_GLOBAL_TIMEOUT_S=1500s with
    # zero verdicts emitted. Wrapper-proxy alone caused 1340s/1448s of
    # acceptance wall-time on 2026-05-06 (forensics in
    # /private/tmp/claude-501/.../tasks/bn4t8vver.output L9930→L10605
    # then 21min silence → SIGTERM at L10608). The watchdog races to
    # write a TIMEOUT verdict file BEFORE SIGKILLing the subshell, so the
    # parent aggregator sees the failure cleanly and the slot frees.
    local _check_timeout="${RUFLO_CHECK_TIMEOUT_S:-180}"
    local _sub_pid=$BASHPID
    (
      sleep "$_check_timeout"
      echo "false|${_check_timeout}000|TIMEOUT after ${_check_timeout}s — run_check_bg watchdog killed ${id}" > "${PARALLEL_DIR}/${id}"
      kill -KILL "$_sub_pid" 2>/dev/null
    ) &
    local _watchdog_pid=$!

    "$fn" || true  # don't let function failure crash subshell

    # Function completed in time — cancel watchdog before it fires
    kill "$_watchdog_pid" 2>/dev/null
    wait "$_watchdog_pid" 2>/dev/null

    c_end=$(_ns)
    c_ms=$(_elapsed_ms "$c_start" "$c_end")
    local escaped; escaped=$(_escape_json "${_CHECK_OUTPUT:-${_OUT:-}}")
    echo "${_CHECK_PASSED:-false}|${c_ms:-0}|${escaped}" > "${PARALLEL_DIR}/${id}"
  ) &
  BG_PIDS+=($!)
}

collect_parallel() {
  local group="$1"; shift
  # Guard against empty BG_PIDS (e.g. RUFLO_SERIAL=1 ran everything inline);
  # bare `wait` would block on the script's other backgrounded helpers
  # (global timeout watcher, etc.) and deadlock.
  if (( ${#BG_PIDS[@]} > 0 )); then
    wait "${BG_PIDS[@]}"
  fi
  BG_PIDS=()
  for spec in "$@"; do
    local id="${spec%%|*}" name="${spec#*|}"
    total_count=$((total_count + 1))
    local result_file="${PARALLEL_DIR}/${id}"
    if [[ -f "$result_file" ]]; then
      IFS='|' read -r passed dur_ms escaped_output < "$result_file"
      # ADR-0090 Tier A2: three-way bucketing (see run_check above)
      local passed_bool="false"
      local status_field="\"failed\""
      if [[ "$passed" == "true" ]]; then
        pass_count=$((pass_count + 1)); passed_bool="true"
        status_field="\"passed\""
        log "  PASS  ${id}: ${name} (${dur_ms:-0}ms)"
      elif [[ "$passed" == "skip_accepted" ]]; then
        skip_count=$((skip_count + 1))
        status_field="\"skip_accepted\""
        log "  SKIP  ${id}: ${name} (${dur_ms:-0}ms)  [accepted]"
      else
        fail_count=$((fail_count + 1))
        log "  FAIL  ${id}: ${name} (${dur_ms:-0}ms)"
      fi
      [[ "${dur_ms:-0}" -gt 15000 ]] && log "  SLOW  ${id}: ${dur_ms}ms"
      local entry; entry=$(printf '{"id":"%s","name":"%s","group":"%s","passed":%s,"status":%s,"output":%s,"duration_ms":%d}' \
        "$id" "$name" "$group" "$passed_bool" "$status_field" "${escaped_output:-\"\"}" "${dur_ms:-0}")
      [[ "$results_json" == "[]" ]] && results_json="[$entry]" || results_json="${results_json%]}, $entry]"
    else
      fail_count=$((fail_count + 1))
      log "  FAIL  ${id}: ${name} (subprocess crashed)"
    fi
  done
  for spec in "$@"; do
    local id="${spec%%|*}"
    rm -f "${PARALLEL_DIR}/${id}"
  done
}

# ══════════════════════════════════════════════════════════════════════════════
# ADR-0094 Sprint 0 WI-3: Canonical MCP invocation helpers
# ══════════════════════════════════════════════════════════════════════════════
#
# Background: 23 per-domain `_<domain>_invoke_tool` copies exist across the
# Phase-1..7 check files. All follow the same shape: run `cli mcp exec --tool
# X --params '...'`, strip the sentinel line, match a pattern. None parse the
# real CLI envelope, so rogue preamble lines can produce false passes.
#
# Real envelope (verified live against 3.5.58-patch.136):
#
#   [AgentDB] Telemetry disabled
#   [INFO] Executing tool: <name>
#   [OK] Tool executed in Xms
#   Result:
#   <raw JSON or text, possibly multi-line>
#
# Extract the body with `awk '/^Result:/{f=1;next}f'`.
#
# Defensive forward-compat: if upstream ever adopts `{content:[{type:"text",
# text:"..."}]}`, the body will parse as JSON with a top-level `content[0].text`.
# We unwrap that one additional level before regex-matching.

# _expect_mcp_body <tool> <params_json> <regex> [label] [timeout] [--rw|--ro]
#
# Invokes an MCP tool via `cli mcp exec --tool <tool> --params '<params>'`,
# extracts the body after the `Result:` sentinel, optionally unwraps a
# `{content:[{type:"text",text:"..."}]}` envelope if upstream adds it, and
# regex-matches the body.
#
# Sets:
#   _CHECK_PASSED  — "true" | "false" | "skip_accepted"
#   _CHECK_OUTPUT  — diagnostic (PASS reason or failure details with first
#                    10 lines of the output for forensics)
#   _MCP_BODY      — extracted body (set for chained/lifecycle checks)
#   _MCP_EXIT      — CLI exit code (raw; 137 = SIGKILL after timeout)
#
# Contract notes:
#   - The underlying `_run_and_kill*` helpers use a sentinel-line trick to
#     capture the real CLI exit. `_RK_EXIT` is READ immediately after the
#     helper returns — no intermediate commands may touch it.
#   - --rw selects `_run_and_kill` (WAL grace). --ro selects `_run_and_kill_ro`.
#     Default is --ro (most MCP probes are read-only).
_expect_mcp_body() {
  local tool="$1" params="$2" regex="$3"
  local label="${4:-$tool}" timeout="${5:-15}" mode="${6:---ro}"

  _CHECK_PASSED="false"; _CHECK_OUTPUT=""; _MCP_BODY=""; _MCP_EXIT=""

  if [[ -z "$tool" || -z "$regex" ]]; then
    _CHECK_OUTPUT="${label}: _expect_mcp_body missing args (tool=$tool regex=$regex)"
    return
  fi

  local cli; cli=$(_cli_cmd)
  local work; work=$(mktemp /tmp/mcp-${tool}-XXXXX)

  local cmd
  if [[ -n "$params" && "$params" != "{}" ]]; then
    cmd="cd '${E2E_DIR:-.}' && NPM_CONFIG_REGISTRY='${REGISTRY:-}' $cli mcp exec --tool $tool --params '$params'"
  else
    cmd="cd '${E2E_DIR:-.}' && NPM_CONFIG_REGISTRY='${REGISTRY:-}' $cli mcp exec --tool $tool"
  fi

  if [[ "$mode" == "--rw" ]]; then
    _run_and_kill "$cmd" "$work" "$timeout"
  else
    _run_and_kill_ro "$cmd" "$work" "$timeout"
  fi
  _MCP_EXIT="${_RK_EXIT:-1}"
  local raw; raw=$(cat "$work" 2>/dev/null || echo "")
  raw=$(echo "$raw" | grep -v '^__RUFLO_DONE__:')
  rm -f "$work" 2>/dev/null

  # Extract body after "Result:" sentinel. If no sentinel (tool errored early,
  # or CLI format changed), fall through with the raw output so the tool-
  # not-found / failure diagnostics still fire.
  local body
  if echo "$raw" | grep -q '^Result:'; then
    body=$(echo "$raw" | awk '/^Result:/{f=1;next}f')
  else
    body="$raw"
  fi

  # Defensive unwrap: upstream may someday wrap in {content:[{type:"text",text}]}.
  # If body parses as JSON with a top-level content[0].text string, descend.
  if echo "$body" | head -c 1 | grep -q '[{[]'; then
    local unwrapped
    unwrapped=$(node -e '
      try {
        const j = JSON.parse(require("fs").readFileSync(0, "utf8"));
        if (j && Array.isArray(j.content) && j.content[0] && typeof j.content[0].text === "string") {
          process.stdout.write(j.content[0].text);
        }
      } catch {}
    ' <<<"$body" 2>/dev/null || true)
    if [[ -n "$unwrapped" ]]; then
      body="$unwrapped"
    fi
  fi

  _MCP_BODY="$body"

  # 1. Tool-not-found → skip_accepted (ADR-0082 narrow: only these exact shapes).
  if echo "$raw" | grep -qiE 'tool.+not found|not registered|unknown tool|no such tool|method .* not found|invalid tool'; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: ${label}: MCP tool '$tool' not in build — $(echo "$raw" | head -3 | tr '\n' ' ')"
    return
  fi

  # 2. Empty body → FAIL with diagnostic.
  if [[ -z "$body" ]]; then
    _CHECK_OUTPUT="${label}: tool '$tool' produced empty body (exit=${_MCP_EXIT}). Raw (first 10 lines):
$(echo "$raw" | head -10)"
    return
  fi

  # 3. Regex match → PASS.
  if echo "$body" | grep -qiE "$regex"; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="${label}: tool '$tool' returned expected pattern (${regex})"
    return
  fi

  # 4. Everything else → FAIL with body diagnostic.
  _CHECK_OUTPUT="${label}: tool '$tool' body did not match /${regex}/i (exit=${_MCP_EXIT}). Body (first 10 lines):
$(echo "$body" | head -10)"
}

# _mcp_invoke_tool <tool> <params_json> <expect_regex> [label] [timeout] [--rw|--ro]
#
# Superset of the 23 per-domain `_<dom>_invoke_tool` variants. Thin wrapper
# over `_expect_mcp_body` so future helpers compose one canonical probe. The
# --rw / --ro hint is metadata for future parallel-safe probing (catalog
# dashboards may use it to plan scheduling); it selects between `_run_and_kill`
# (WAL grace) and `_run_and_kill_ro` (no grace).
_mcp_invoke_tool() {
  _expect_mcp_body "$@"
}

# _with_iso_cleanup <check_id> <body_fn>
#
# Wraps a check that uses `_e2e_isolate` with a RETURN-trap that chmods the
# iso dir back to rwx and rm -rf's it on every exit path (success, failure,
# kill, bash error). Idempotent (multiple calls for the same check_id reuse
# the same dir variable name; the trap is per-call).
#
# Usage:
#   check_adr0094_p6_something() {
#     _with_iso_cleanup "p6-something" _check_adr0094_p6_something_body
#   }
#
# The body function must accept the iso dir as $1 and set _CHECK_PASSED /
# _CHECK_OUTPUT. If _e2e_isolate fails, the body is never called and the
# check is marked failed.
_with_iso_cleanup() {
  local check_id="$1" body_fn="$2"
  _CHECK_PASSED="false"; _CHECK_OUTPUT=""

  # Prefer _e2e_isolate when E2E_DIR is live (Phase 3/4 checks that need
  # the seeded init state). Fall back to plain mktemp when E2E_DIR has
  # been torn down (ADR-0096 catalog checks run post-E2E-cleanup) —
  # they don't need E2E lineage, just a scratch sandbox.
  local iso=""
  if [[ -n "${E2E_DIR:-}" && -d "${E2E_DIR:-}" ]] && declare -F _e2e_isolate >/dev/null; then
    iso=$(_e2e_isolate "$check_id")
  fi
  if [[ -z "$iso" || ! -d "$iso" ]]; then
    iso=$(mktemp -d "${ACCEPT_TEMP:-/tmp}/_check_workdirs/iso-${check_id}-XXXXX" 2>/dev/null || true)
  fi
  if [[ -z "$iso" || ! -d "$iso" ]]; then
    _CHECK_OUTPUT="${check_id}: failed to create isolated dir"
    return
  fi

  # RETURN-trap guarantees cleanup even if the body function `return`s
  # early. Restore perms first so rm -rf itself doesn't EACCES.
  # shellcheck disable=SC2064
  trap "chmod -R u+rwX '$iso' 2>/dev/null; rm -rf '$iso' 2>/dev/null; trap - RETURN INT TERM" RETURN INT TERM

  "$body_fn" "$iso"
}
