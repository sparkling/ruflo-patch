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

run_check_bg() {
  local id="$1" name="$2" fn="$3" group="$4"
  (
    set +u  # disable strict unset — check functions may leave vars unset in helper chains
    _CHECK_PASSED="false"; _CHECK_OUTPUT=""
    local c_start c_end c_ms=0
    c_start=$(_ns)
    "$fn" || true  # don't let function failure crash subshell
    c_end=$(_ns)
    c_ms=$(_elapsed_ms "$c_start" "$c_end")
    local escaped; escaped=$(_escape_json "${_CHECK_OUTPUT:-${_OUT:-}}")
    echo "${_CHECK_PASSED:-false}|${c_ms:-0}|${escaped}" > "${PARALLEL_DIR}/${id}"
  ) &
  BG_PIDS+=($!)
}

collect_parallel() {
  local group="$1"; shift
  wait "${BG_PIDS[@]}"
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

  local iso; iso=$(_e2e_isolate "$check_id")
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
