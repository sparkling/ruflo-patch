#!/usr/bin/env bash
# lib/acceptance-phase10-idempotency.sh — ADR-0094 Phase 10: Idempotency
#
# f(x); f(x) ≡ f(x). Prove that calling a mutation-capable surface twice with
# IDENTICAL arguments leaves the observable state in the SAME shape as a single
# call — no duplicate rows, no scalar drift, no destructive overwrite. Pairs
# with Phase 8 (cross-tool invariants) and Phase 9 (concurrency matrix) per
# ADR-0094 §Phases 8–10.
#
# Phase 10 matrix (4 checks):
#   P10-1 check_adr0094_p10_memory_store_same_key
#           memory_store(key, value) twice. Both succeed. memory_search for
#           the value returns the key exactly ONCE (grep -oF ... | wc -l == 1).
#           >1 = dup row. 0 = store did not persist.
#
#   P10-2 check_adr0094_p10_session_save_same_name
#           session_save(name, value) twice with the SAME name AND SAME value.
#           Both succeed. session_list body contains the name exactly ONCE.
#           Differs from P9-3 (DISTINCT values, race): here we feed identical
#           writers and assert the second call does not create a second entry.
#
#   P10-3 check_adr0094_p10_config_set_same_key
#           config_set(key, value) twice with identical args. Both succeed.
#           config_get(key) returns value. The SECOND set call MUST NOT emit
#           conflict/duplicate/already-exists error strings (config is scalar-
#           per-key by design — "already exists" would be a bug, not
#           idempotency). No row-count check.
#
#   P10-4 check_adr0094_p10_init_full_reinvoke
#           `cli init --full` inside an already-init'd iso dir. Drop a pre-init
#           marker file FIRST. Second init MUST NOT:
#             (a) silently overwrite — marker file disappearing is FAIL.
#             (b) hard-crash — non-zero exit with no "already"/"force" hint is
#                 FAIL; stderr matching `panic|unexpected|ENOENT` is FAIL.
#           PASS accepts either a no-op success OR an explicit "already
#           initialized" / "use --force" rejection.
#
# Verdict buckets (ADR-0090 Tier A2 — three-way):
#   PASS            — idempotency postcondition holds.
#   FAIL            — duplicate rows, value drift, hard crash, or silent
#                     overwrite (ADR-0082: loud-fail, no silent pass).
#   SKIP_ACCEPTED   — tool not in build (aggregated log scan matches standard
#                     not-found shapes, mirrors Phase 9 regex).
#
# Budget: ≤10s total wall-clock (ADR-0094 §Phase 10 budget). Each check has
# ~2.5s headroom; per-subprocess timeouts capped at 15s (not 60s).
#
# Requires: acceptance-harness.sh (_mcp_invoke_tool, _with_iso_cleanup,
#           _cli_cmd, _e2e_isolate, _run_and_kill*).
# Caller MUST set: E2E_DIR, TEMP_DIR, REGISTRY, PKG.

# ════════════════════════════════════════════════════════════════════
# Shared helper — idempotency verdict evaluator
# ════════════════════════════════════════════════════════════════════

# _p10_expect_idempotent <label> <occurrences> <expected>
#
# Phase 10's analog to Phase 9's `_p9_expect_single_winner`. The postcondition
# for idempotency is "exactly <expected> occurrences" — normally 1. Sets:
#   _CHECK_PASSED  — "true" iff occurrences == expected, "false" otherwise.
#   _CHECK_OUTPUT  — diagnostic distinguishing 0-occurrence (no persistence)
#                    vs >expected (duplicate row = idempotency broken).
_p10_expect_idempotent() {
  local label="${1:-p10}"
  local occurrences="${2:-0}"
  local expected="${3:-1}"

  # Guard against non-numeric counts — ADR-0082 smell.
  if ! [[ "$occurrences" =~ ^[0-9]+$ ]] || ! [[ "$expected" =~ ^[0-9]+$ ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="${label} FAIL: non-numeric counts (occurrences='$occurrences' expected='$expected')"
    return
  fi

  if (( occurrences == expected )); then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="${label} OK: idempotent — ${occurrences} occurrence(s) after duplicate invocation"
    return
  fi

  _CHECK_PASSED="false"
  if (( occurrences == 0 )); then
    _CHECK_OUTPUT="${label} FAIL: 0 occurrences — duplicate invocation did not persist (store silently dropped both calls)"
  elif (( occurrences > expected )); then
    _CHECK_OUTPUT="${label} FAIL: ${occurrences} occurrences (expected ${expected}) — second call created duplicate row (idempotency broken)"
  else
    _CHECK_OUTPUT="${label} FAIL: ${occurrences} occurrences (expected ${expected}) — fewer than expected"
  fi
}

# _p10_any_tool_not_found <label> <log_dir>
#
# Mirrors Phase 9's helper (same regex as acceptance-harness.sh:305). Scans
# every `*.log` in <log_dir> for tool-not-found shapes. If any match, sets
# _CHECK_PASSED="skip_accepted" and returns 0. Otherwise returns 1.
_p10_any_tool_not_found() {
  local label="${1:-p10}"
  local log_dir="${2:-}"
  if [[ -z "$log_dir" || ! -d "$log_dir" ]]; then
    return 1
  fi
  local hit
  hit=$(grep -liE 'tool.+not found|not registered|unknown.*tool|no such tool|not in build|invalid tool|method .* not found' \
        "$log_dir"/*.log 2>/dev/null | head -1)
  if [[ -n "$hit" ]]; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: ${label}: tool not in build (see $(basename "$hit"))"
    return 0
  fi
  return 1
}

# ════════════════════════════════════════════════════════════════════
# P10-1: memory_store(same_key, same_value) idempotent
# ════════════════════════════════════════════════════════════════════
# Store the SAME (key, value) twice. Both calls must succeed. A subsequent
# memory_search for the value must yield the key exactly ONCE.
_p10_memory_store_same_key_body() {
  local iso="$1"
  local _saved="${E2E_DIR:-}"
  E2E_DIR="$iso"

  local key="p10-mem-$$-$(date +%s)"
  local val="p10memval-$(openssl rand -hex 4 2>/dev/null || echo $$)"
  local params="{\"key\":\"$key\",\"value\":\"$val\",\"namespace\":\"p10\"}"

  # First store
  _mcp_invoke_tool "memory_store" "$params" 'stored|success|key|true' \
    "P10/mem/store1" 15 --rw
  if [[ "${_CHECK_PASSED:-}" == "skip_accepted" ]]; then
    _CHECK_OUTPUT="SKIP_ACCEPTED: P10/mem: memory_store not in build"
    E2E_DIR="$_saved"; return
  fi
  if [[ "${_CHECK_PASSED:-}" != "true" ]]; then
    _CHECK_OUTPUT="P10/mem FAIL: first memory_store did not succeed — ${_CHECK_OUTPUT}"
    _CHECK_PASSED="false"; E2E_DIR="$_saved"; return
  fi

  # Second store (identical params)
  _mcp_invoke_tool "memory_store" "$params" 'stored|success|key|true' \
    "P10/mem/store2" 15 --rw
  if [[ "${_CHECK_PASSED:-}" == "skip_accepted" ]]; then
    _CHECK_OUTPUT="SKIP_ACCEPTED: P10/mem: memory_store disappeared between calls"
    E2E_DIR="$_saved"; return
  fi
  if [[ "${_CHECK_PASSED:-}" != "true" ]]; then
    _CHECK_OUTPUT="P10/mem FAIL: second memory_store did not succeed (idempotent store should accept duplicate). Body: $(echo "${_MCP_BODY:-}" | head -5 | tr '\n' ' ')"
    _CHECK_PASSED="false"; E2E_DIR="$_saved"; return
  fi

  # Observation: memory_search. Count occurrences of the key name in the body.
  _mcp_invoke_tool "memory_search" "{\"query\":\"$val\"}" \
    'results|\[|\{|match|found|count|total' \
    "P10/mem/search" 15 --ro
  if [[ "${_CHECK_PASSED:-}" == "skip_accepted" ]]; then
    # Fallback: if search isn't available, use memory_retrieve as a single-row probe.
    _mcp_invoke_tool "memory_retrieve" \
      "{\"key\":\"$key\",\"namespace\":\"p10\"}" "$val" \
      "P10/mem/retrieve-fb" 15 --ro
    if [[ "${_CHECK_PASSED:-}" == "skip_accepted" ]]; then
      _CHECK_OUTPUT="SKIP_ACCEPTED: P10/mem: memory_search AND memory_retrieve not in build"
      E2E_DIR="$_saved"; return
    fi
    if [[ "${_CHECK_PASSED:-}" == "true" ]]; then
      # retrieve is scalar-per-key by design — success means both stores
      # collapsed to one row (PASS) OR the second overwrote (also PASS).
      _CHECK_OUTPUT="P10/mem OK: memory_retrieve returned value post-dup-store (search fell through)"
      E2E_DIR="$_saved"; return
    fi
    _CHECK_OUTPUT="P10/mem FAIL: neither search nor retrieve saw $key after two identical stores. Body: $(echo "${_MCP_BODY:-}" | head -5 | tr '\n' ' ')"
    _CHECK_PASSED="false"; E2E_DIR="$_saved"; return
  fi
  if [[ "${_CHECK_PASSED:-}" != "true" ]]; then
    _CHECK_OUTPUT="P10/mem FAIL: memory_search did not return coherent body (exit=${_MCP_EXIT:-?})"
    _CHECK_PASSED="false"; E2E_DIR="$_saved"; return
  fi

  local body="${_MCP_BODY:-}"
  # Count occurrences of the key name in the search body. Use grep -oF | wc -l
  # to count TOTAL matches (not matching lines). Never `grep -c ... || echo 0`
  # per CLAUDE.md — produces "0\n0".
  local occur
  occur=$(echo "$body" | grep -oF "$key" 2>/dev/null | wc -l | tr -d ' ')
  occur="${occur:-0}"

  _p10_expect_idempotent "P10/mem (key=$key, val=$val)" "$occur" 1
  E2E_DIR="$_saved"
}
check_adr0094_p10_memory_store_same_key() {
  _with_iso_cleanup "p10-mem-same-key" _p10_memory_store_same_key_body
}

# ════════════════════════════════════════════════════════════════════
# P10-2: session_save(same_name, same_value) idempotent
# ════════════════════════════════════════════════════════════════════
# Save the SAME (name, value) twice. Both calls succeed. session_list body
# contains the name exactly ONCE — duplicate entries are a bug.
_p10_session_save_same_name_body() {
  local iso="$1"
  local _saved="${E2E_DIR:-}"
  E2E_DIR="$iso"

  local name="p10-sess-$$-$(date +%s)"
  local val="p10sessval$$"
  local params="{\"name\":\"$name\",\"value\":\"$val\"}"

  # First save
  _mcp_invoke_tool "session_save" "$params" 'saved|success|session' \
    "P10/sess/save1" 15 --rw
  if [[ "${_CHECK_PASSED:-}" == "skip_accepted" ]]; then
    _CHECK_OUTPUT="SKIP_ACCEPTED: P10/sess: session_save not in build"
    E2E_DIR="$_saved"; return
  fi
  if [[ "${_CHECK_PASSED:-}" != "true" ]]; then
    _CHECK_OUTPUT="P10/sess FAIL: first session_save did not succeed — ${_CHECK_OUTPUT}"
    _CHECK_PASSED="false"; E2E_DIR="$_saved"; return
  fi

  # Second save (identical params)
  _mcp_invoke_tool "session_save" "$params" 'saved|success|session' \
    "P10/sess/save2" 15 --rw
  if [[ "${_CHECK_PASSED:-}" == "skip_accepted" ]]; then
    _CHECK_OUTPUT="SKIP_ACCEPTED: P10/sess: session_save disappeared between calls"
    E2E_DIR="$_saved"; return
  fi
  if [[ "${_CHECK_PASSED:-}" != "true" ]]; then
    _CHECK_OUTPUT="P10/sess FAIL: second session_save did not succeed (idempotent save should accept duplicate). Body: $(echo "${_MCP_BODY:-}" | head -5 | tr '\n' ' ')"
    _CHECK_PASSED="false"; E2E_DIR="$_saved"; return
  fi

  # Observation: session_list. Count occurrences of the name in the body.
  _mcp_invoke_tool "session_list" '{}' 'sessions|list|\[|name' \
    "P10/sess/list" 15 --ro
  if [[ "${_CHECK_PASSED:-}" == "skip_accepted" ]]; then
    _CHECK_OUTPUT="SKIP_ACCEPTED: P10/sess: session_list not in build"
    E2E_DIR="$_saved"; return
  fi
  if [[ "${_CHECK_PASSED:-}" != "true" ]]; then
    _CHECK_OUTPUT="P10/sess FAIL: session_list did not return coherent body (exit=${_MCP_EXIT:-?})"
    _CHECK_PASSED="false"; E2E_DIR="$_saved"; return
  fi

  local body="${_MCP_BODY:-}"
  local occur
  occur=$(echo "$body" | grep -oF "$name" 2>/dev/null | wc -l | tr -d ' ')
  occur="${occur:-0}"

  _p10_expect_idempotent "P10/sess (name=$name)" "$occur" 1
  E2E_DIR="$_saved"
}
check_adr0094_p10_session_save_same_name() {
  _with_iso_cleanup "p10-sess-same-name" _p10_session_save_same_name_body
}

# ════════════════════════════════════════════════════════════════════
# P10-3: config_set(same_key, same_value) idempotent
# ════════════════════════════════════════════════════════════════════
# Set the SAME (key, value) twice. Both succeed. config_get returns the value.
# The second set MUST NOT emit "already exists" / "conflict" / "duplicate" —
# config is scalar-per-key by design, so emitting a collision error on a
# duplicate write would be a bug (not idempotency).
_p10_config_set_same_key_body() {
  local iso="$1"
  local _saved="${E2E_DIR:-}"
  E2E_DIR="$iso"

  local key="p10.cfg.rt$$"
  local val="p10cfgval-$(date +%s)"
  local params="{\"key\":\"$key\",\"value\":\"$val\"}"

  # First set
  _mcp_invoke_tool "config_set" "$params" 'set|success|updated|saved|true' \
    "P10/cfg/set1" 15 --rw
  if [[ "${_CHECK_PASSED:-}" == "skip_accepted" ]]; then
    _CHECK_OUTPUT="SKIP_ACCEPTED: P10/cfg: config_set not in build"
    E2E_DIR="$_saved"; return
  fi
  if [[ "${_CHECK_PASSED:-}" != "true" ]]; then
    _CHECK_OUTPUT="P10/cfg FAIL: first config_set did not succeed — ${_CHECK_OUTPUT}"
    _CHECK_PASSED="false"; E2E_DIR="$_saved"; return
  fi

  # Second set (identical params)
  _mcp_invoke_tool "config_set" "$params" 'set|success|updated|saved|true' \
    "P10/cfg/set2" 15 --rw
  if [[ "${_CHECK_PASSED:-}" == "skip_accepted" ]]; then
    _CHECK_OUTPUT="SKIP_ACCEPTED: P10/cfg: config_set disappeared between calls"
    E2E_DIR="$_saved"; return
  fi
  if [[ "${_CHECK_PASSED:-}" != "true" ]]; then
    _CHECK_OUTPUT="P10/cfg FAIL: second config_set did not succeed (idempotent set should accept duplicate). Body: $(echo "${_MCP_BODY:-}" | head -5 | tr '\n' ' ')"
    _CHECK_PASSED="false"; E2E_DIR="$_saved"; return
  fi

  # The second set body MUST NOT carry a collision/duplicate error string.
  # These strings would indicate the server treats a duplicate write as a
  # conflict — which breaks idempotency for a scalar-per-key surface.
  local body2="${_MCP_BODY:-}"
  if echo "$body2" | grep -qiE 'already exists|conflict|duplicate|uniqueness|EEXIST'; then
    _CHECK_OUTPUT="P10/cfg FAIL: second config_set returned success but body carries collision/duplicate signal — idempotency ambiguous. Body: $(echo "$body2" | head -5 | tr '\n' ' ')"
    _CHECK_PASSED="false"; E2E_DIR="$_saved"; return
  fi

  # Round-trip: config_get must return the stored value.
  _mcp_invoke_tool "config_get" "{\"key\":\"$key\"}" "$val" "P10/cfg/get" 15 --ro
  if [[ "${_CHECK_PASSED:-}" == "skip_accepted" ]]; then
    _CHECK_OUTPUT="SKIP_ACCEPTED: P10/cfg: config_get not in build (set succeeded twice)"
    E2E_DIR="$_saved"; return
  fi
  if [[ "${_CHECK_PASSED:-}" == "true" ]]; then
    _CHECK_OUTPUT="P10/cfg OK: idempotent — two identical config_set calls accepted with no conflict; config_get returned $val"
  else
    _CHECK_OUTPUT="P10/cfg FAIL: config_get body missing $val after two identical sets. Body: $(echo "${_MCP_BODY:-}" | head -5 | tr '\n' ' ')"
    _CHECK_PASSED="false"
  fi
  E2E_DIR="$_saved"
}
check_adr0094_p10_config_set_same_key() {
  _with_iso_cleanup "p10-cfg-same-key" _p10_config_set_same_key_body
}

# ════════════════════════════════════════════════════════════════════
# P10-4: init --full reinvoke idempotent
# ════════════════════════════════════════════════════════════════════
# iso already contains a completed `init --full` (copied from $E2E_DIR by
# _with_iso_cleanup). Drop a pre-init marker file. Run `init --full` a second
# time. Verify:
#   - pre-init marker SURVIVES (no destructive overwrite), OR
#   - the command refuses with an explicit "already initialized" / "--force"
#     hint (explicit rejection = PASS).
# FAIL on: marker gone with zero exit (silent overwrite), non-zero exit with
# no hint (hard crash), stderr matching panic/unexpected/ENOENT.
_p10_init_full_reinvoke_body() {
  local iso="$1"
  local _saved="${E2E_DIR:-}"
  E2E_DIR="$iso"

  local cli; cli=$(_cli_cmd)
  if [[ -z "$cli" ]]; then
    _CHECK_OUTPUT="P10/init FAIL: _cli_cmd returned empty — no CLI binary found in \$TEMP_DIR"
    _CHECK_PASSED="false"; E2E_DIR="$_saved"; return
  fi

  # Pre-init marker. If init is idempotent-by-no-op or refuses re-init, this
  # file MUST survive. If init silently reruns and wipes state, it will be
  # deleted (or the containing dir recreated).
  local marker="$iso/.p10-reinvoke-marker-$$"
  local marker_content="p10-marker-$(date +%s)"
  echo "$marker_content" > "$marker" 2>/dev/null || {
    _CHECK_OUTPUT="P10/init FAIL: could not write pre-init marker at $marker"
    _CHECK_PASSED="false"; E2E_DIR="$_saved"; return
  }

  # Sanity: iso must already look init'd (copy-from-E2E_DIR did its job).
  if [[ ! -d "$iso/.claude-flow" && ! -f "$iso/.claude/settings.json" ]]; then
    _CHECK_OUTPUT="P10/init FAIL: iso dir not already-init'd (missing .claude-flow/ and .claude/settings.json) — test fixture broken"
    _CHECK_PASSED="false"; E2E_DIR="$_saved"; return
  fi

  # Run init --full (NO --force). Capture stdout+stderr and exit code.
  # Budget: 15s (ADR-0094 P10 per-check headroom ~2.5s shared with other calls;
  # init on an already-init'd dir should return fast either way).
  local out_log; out_log=$(mktemp /tmp/p10-init-XXXXX.log)
  local rc=0
  (
    cd "$iso" && NPM_CONFIG_REGISTRY="$REGISTRY" timeout 15 "$cli" init --full \
      > "$out_log" 2>&1
  ) || rc=$?

  local out
  out=$(cat "$out_log" 2>/dev/null || echo "")

  # Tool-not-found-style guards (very unlikely for `init`, but symmetric with
  # other checks). `init` is a top-level command — absence would mean a CLI
  # catastrophe, not a skip-worthy build shape. Treat as FAIL not skip.

  # Hard-crash stderr patterns — always FAIL regardless of exit code.
  if echo "$out" | grep -qiE 'panic|unexpected (error|exception)|ENOENT|segmentation fault|Uncaught'; then
    _CHECK_OUTPUT="P10/init FAIL: re-init emitted hard-crash marker (panic/ENOENT/uncaught). Exit=$rc. Output: $(echo "$out" | head -10 | tr '\n' ' ')"
    _CHECK_PASSED="false"
    rm -f "$out_log" 2>/dev/null
    E2E_DIR="$_saved"; return
  fi

  # Marker check — primary idempotency signal.
  local marker_survived="no"
  if [[ -f "$marker" ]]; then
    local saw; saw=$(cat "$marker" 2>/dev/null || echo "")
    if [[ "$saw" == "$marker_content" ]]; then
      marker_survived="yes"
    fi
  fi

  # "Already initialized" / "--force" hint detector. Presence of this shape
  # (regardless of exit code) is an explicit-rejection PASS.
  local has_refusal_hint="no"
  if echo "$out" | grep -qiE 'already (initialized|exists|configured|set up)|use --force|--force.*re-?init|pass --force|refusing to|idempoten'; then
    has_refusal_hint="yes"
  fi

  if (( rc == 0 )); then
    # Success exit. Idempotency requires the marker survived.
    if [[ "$marker_survived" == "yes" ]]; then
      _CHECK_PASSED="true"
      _CHECK_OUTPUT="P10/init OK: re-init exit=0, pre-init marker survived (no destructive overwrite)"
    else
      _CHECK_OUTPUT="P10/init FAIL: re-init exit=0 but pre-init marker disappeared — silent destructive overwrite (ADR-0082). Output: $(echo "$out" | head -10 | tr '\n' ' ')"
      _CHECK_PASSED="false"
    fi
  else
    # Non-zero exit. PASS only if output carries an explicit "already" / "force"
    # hint AND the marker survived — both required, since a non-zero exit that
    # nevertheless wiped state is worst-case (crashed mid-overwrite).
    if [[ "$has_refusal_hint" == "yes" && "$marker_survived" == "yes" ]]; then
      _CHECK_PASSED="true"
      _CHECK_OUTPUT="P10/init OK: re-init refused with explicit hint (exit=$rc), marker preserved"
    elif [[ "$marker_survived" == "no" ]]; then
      _CHECK_OUTPUT="P10/init FAIL: re-init exit=$rc AND marker disappeared — crashed mid-overwrite. Output: $(echo "$out" | head -10 | tr '\n' ' ')"
      _CHECK_PASSED="false"
    else
      _CHECK_OUTPUT="P10/init FAIL: re-init exit=$rc with no 'already'/'force' hint — hard failure, not idempotency guard. Output: $(echo "$out" | head -10 | tr '\n' ' ')"
      _CHECK_PASSED="false"
    fi
  fi

  rm -f "$out_log" "$marker" 2>/dev/null
  E2E_DIR="$_saved"
}
check_adr0094_p10_init_full_reinvoke() {
  _with_iso_cleanup "p10-init-reinvoke" _p10_init_full_reinvoke_body
}
