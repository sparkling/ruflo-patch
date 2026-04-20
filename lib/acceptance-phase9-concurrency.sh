#!/usr/bin/env bash
# lib/acceptance-phase9-concurrency.sh — ADR-0094 Phase 9: Concurrency matrix
#
# One race-safety check per mutation-capable surface family. Proves exactly-
# one-winner semantics (or last-writer-wins with no interleaved corruption)
# under N parallel writers against the SAME key/name/id. Pairs with Phase 8
# (cross-tool invariants) and Phase 10 (idempotency) per ADR-0094 §Phases 8–10.
#
# Phase 9 matrix (4 checks):
#   P9-1  check_adr0094_p9_rvf_concurrent_writes_delegated
#           RVF concurrency — delegated to ADR-0095's check_t3_2_rvf_concurrent_writes.
#           This check returns skip_accepted with a pointer — a duplicate race here
#           would be wasted wall-clock and risk diverging acceptance criteria.
#
#   P9-2  check_adr0094_p9_claims_single_winner
#           6 parallel claims_claim against the SAME issueId. Exactly-one-winner:
#           successful_claims MUST == 1. 0 = nobody won (lock acquisition broken).
#           >1 = race allowed duplicate claims (mutex broken).
#
#   P9-3  check_adr0094_p9_session_no_interleave
#           2 parallel session_save with the SAME name and DISTINCT values.
#           After `wait`, session_info MUST return a body whose `value` matches
#           one of the two writers' distinct values. Last-writer-wins is fine;
#           interleaved corruption (null, garbled, or a mix) is FAIL.
#
#   P9-4  check_adr0094_p9_workflow_concurrent_start
#           4 parallel workflow_create against the SAME name. Exactly-one-winner:
#           workflow_list output MUST contain `<name>` exactly once. 0 = all
#           creates failed. >1 = race allowed duplicate workflows with the same
#           user-visible name.
#
# Verdict buckets (ADR-0090 Tier A2 — three-way):
#   PASS            — exactly-one-winner (or last-writer-wins for session) confirmed.
#   FAIL            — 0 or >1 winners, OR interleaved corruption, OR unexpected
#                     aggregator failure (ADR-0082: loud-fail, no silent pass).
#   SKIP_ACCEPTED   — tool is not in the build (aggregated log scan detected
#                     `not found|unknown tool|no such tool|not in build`).
#
# Budget: ≤30s total wall-clock (ADR-0094 Phase 9 budget). All four checks
# parallel-safe when each is given its own `_with_iso_cleanup` iso dir.
#
# Requires: acceptance-harness.sh (_mcp_invoke_tool, _with_iso_cleanup,
#           _cli_cmd, _e2e_isolate, _run_and_kill*).
# Caller MUST set: E2E_DIR, TEMP_DIR, REGISTRY, PKG.

# ════════════════════════════════════════════════════════════════════
# Shared helper — exactly-one-winner verdict evaluator
# ════════════════════════════════════════════════════════════════════

# _p9_expect_single_winner <label> <successes> <total>
#
# Phase 9's analog to Phase 11's `_p11_expect_fuzz_rejection`. Reads caller-
# supplied counts and sets:
#   _CHECK_PASSED  — "true" iff successes == 1, "false" otherwise.
#   _CHECK_OUTPUT  — diagnostic naming the 0-winner vs >1-winner failure mode.
#
# This does NOT touch _CHECK_PASSED when successes == 1 AND total >= 1 — it
# sets it to "true" explicitly. Callers that need skip_accepted handling must
# set _CHECK_PASSED BEFORE calling this helper (and then simply not invoke it).
_p9_expect_single_winner() {
  local label="${1:-p9}"
  local successes="${2:-0}"
  local total="${3:-0}"

  # Guard against unreadable inputs — a missing count is an ADR-0082 smell.
  if ! [[ "$successes" =~ ^[0-9]+$ ]] || ! [[ "$total" =~ ^[0-9]+$ ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="${label} FAIL: non-numeric winner counts (successes='$successes' total='$total')"
    return
  fi

  if (( successes == 1 )); then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="${label} OK: exactly one winner of ${total} concurrent writers"
    return
  fi

  _CHECK_PASSED="false"
  if (( successes == 0 )); then
    _CHECK_OUTPUT="${label} FAIL: 0 winners out of ${total} concurrent writers — mutex broken (lock acquisition rejected every writer)"
  else
    _CHECK_OUTPUT="${label} FAIL: ${successes} winners out of ${total} concurrent writers — race allowed dup (mutex did not serialize mutators)"
  fi
}

# _p9_any_tool_not_found <label> <log_dir>
#
# Scans every `*.log` in <log_dir> for the standard tool-not-found shapes
# the harness itself recognizes (mirrors acceptance-harness.sh:305). If any
# log matches, sets _CHECK_PASSED="skip_accepted" with a SKIP_ACCEPTED-prefixed
# output and returns 0. Otherwise returns 1 (no skip signal — caller proceeds).
_p9_any_tool_not_found() {
  local label="${1:-p9}"
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
# P9-1: RVF concurrent writes — DELEGATED to ADR-0095's t3-2 check
# ════════════════════════════════════════════════════════════════════
# Rationale: ADR-0095 already defines check_t3_2_rvf_concurrent_writes
# (lib/acceptance-adr0079-tier3-checks.sh) as the canonical RVF concurrency
# probe. Duplicating the race here would waste wall-clock AND create two
# independent acceptance criteria for the same surface — if the real one
# regresses, this copy could mask the regression via skip_accepted noise.
# So this check is a NAMED POINTER only.
check_adr0094_p9_rvf_concurrent_writes_delegated() {
  _CHECK_PASSED="skip_accepted"
  _CHECK_OUTPUT="SKIP_ACCEPTED: P9/rvf: delegated to t3-2-concurrent (ADR-0095). See lib/acceptance-adr0079-tier3-checks.sh:check_t3_2_rvf_concurrent_writes"
}

# ════════════════════════════════════════════════════════════════════
# P9-2: claims_claim exactly-one-winner
# ════════════════════════════════════════════════════════════════════
# Spawn 6 parallel claims_claim against the SAME issueId. claimant format
# is "agent:<id>:coder" (matches Phase 8 INV-4's verified shape — see
# forks/ruflo/v3/.../claims-tools.ts parseClaimant).
_p9_claims_single_winner_body() {
  local iso="$1"
  local _saved="${E2E_DIR:-}"
  E2E_DIR="$iso"

  local cli; cli=$(_cli_cmd)
  if [[ -z "$cli" ]]; then
    _CHECK_OUTPUT="P9/claims FAIL: _cli_cmd returned empty — no CLI binary found in \$TEMP_DIR"
    _CHECK_PASSED="false"; E2E_DIR="$_saved"; return
  fi

  local issue_id="p9-claims-$$-$(date +%s)"
  local log_dir; log_dir=$(mktemp -d /tmp/p9-claims-XXXXX)
  local N=6

  # Launch N parallel claims_claim — true concurrency via background PIDs.
  local pids=() i
  for i in $(seq 1 "$N"); do
    local claimant="agent:p9c${i}$$:coder"
    local params="{\"issueId\":\"$issue_id\",\"claimant\":\"$claimant\"}"
    (
      cd "$iso" && NPM_CONFIG_REGISTRY="$REGISTRY" timeout 20 "$cli" mcp exec \
        --tool claims_claim --params "$params" \
        > "$log_dir/claim-$i.log" 2>&1
    ) &
    pids+=($!)
  done

  # Wait for every writer (even ones that crash — `|| true` keeps us going).
  local pid
  for pid in "${pids[@]}"; do
    wait "$pid" 2>/dev/null || true
  done

  # Early-out: aggregated tool-not-found → skip_accepted.
  if _p9_any_tool_not_found "P9/claims" "$log_dir"; then
    rm -rf "$log_dir" 2>/dev/null
    E2E_DIR="$_saved"; return
  fi

  # Count successful claims vs rejected claims. Successful markers come from
  # the body `{success:true,claimed:true,...}`; rejections carry
  # `already claimed|taken|held|denied` in the error string.
  local successes=0 rejections=0 i_log
  for i in $(seq 1 "$N"); do
    local log="$log_dir/claim-$i.log"
    [[ -f "$log" ]] || continue
    local body
    body=$(awk '/^Result:/{f=1;next}f' "$log" 2>/dev/null)
    # If "Result:" never appeared, fall back to the raw log.
    if [[ -z "$body" ]]; then
      body=$(cat "$log" 2>/dev/null)
    fi
    if echo "$body" | grep -qiE '"claimed"[[:space:]]*:[[:space:]]*true|"success"[[:space:]]*:[[:space:]]*true'; then
      # Successful claim — but only if NOT also carrying an explicit rejection
      # (defensive: some builds return {success:true, alreadyClaimed:true}).
      if echo "$body" | grep -qiE 'already|taken|held|denied|"claimed"[[:space:]]*:[[:space:]]*false'; then
        rejections=$((rejections + 1))
      else
        successes=$((successes + 1))
      fi
    elif echo "$body" | grep -qiE 'already|taken|held|denied|"success"[[:space:]]*:[[:space:]]*false'; then
      rejections=$((rejections + 1))
    fi
  done

  # ADR-0082 loud-fail: if neither successes nor rejections registered,
  # every writer was silently no-op'd — that is worse than losing a race.
  local total_resolved=$((successes + rejections))
  if (( total_resolved == 0 )); then
    _CHECK_OUTPUT="P9/claims FAIL: ${N} writers produced no recognizable success OR rejection bodies — silent no-op suspected (ADR-0082). log_dir=$log_dir (first log): $(head -5 "$log_dir/claim-1.log" 2>/dev/null | tr '\n' ' ')"
    _CHECK_PASSED="false"
    rm -rf "$log_dir" 2>/dev/null
    E2E_DIR="$_saved"; return
  fi

  _p9_expect_single_winner "P9/claims (issue=$issue_id; rejections=$rejections)" "$successes" "$N"
  rm -rf "$log_dir" 2>/dev/null
  E2E_DIR="$_saved"
}
check_adr0094_p9_claims_single_winner() {
  _with_iso_cleanup "p9-claims" _p9_claims_single_winner_body
}

# ════════════════════════════════════════════════════════════════════
# P9-3: session_save no-interleave (last-writer-wins acceptable)
# ════════════════════════════════════════════════════════════════════
# Spawn 2 parallel session_save against the SAME name with DISTINCT values.
# After `wait`, session_info MUST return a body whose `value` matches one of
# the two writers' distinct values. Interleaved corruption (null, a mix, or
# a mangled string that matches neither) is a FAIL.
_p9_session_no_interleave_body() {
  local iso="$1"
  local _saved="${E2E_DIR:-}"
  E2E_DIR="$iso"

  local cli; cli=$(_cli_cmd)
  if [[ -z "$cli" ]]; then
    _CHECK_OUTPUT="P9/session FAIL: _cli_cmd returned empty — no CLI binary found in \$TEMP_DIR"
    _CHECK_PASSED="false"; E2E_DIR="$_saved"; return
  fi

  local sess="p9-sess-$$-$(date +%s)"
  local val_a="p9sessA$$"
  local val_b="p9sessB$$"
  local log_dir; log_dir=$(mktemp -d /tmp/p9-session-XXXXX)

  # Two writers, SAME name, DISTINCT values. Use the `value` field so
  # a post-save session_info can disambiguate which writer landed last.
  (
    cd "$iso" && NPM_CONFIG_REGISTRY="$REGISTRY" timeout 20 "$cli" mcp exec \
      --tool session_save --params "{\"name\":\"$sess\",\"value\":\"$val_a\"}" \
      > "$log_dir/save-a.log" 2>&1
  ) &
  local pid_a=$!
  (
    cd "$iso" && NPM_CONFIG_REGISTRY="$REGISTRY" timeout 20 "$cli" mcp exec \
      --tool session_save --params "{\"name\":\"$sess\",\"value\":\"$val_b\"}" \
      > "$log_dir/save-b.log" 2>&1
  ) &
  local pid_b=$!

  wait "$pid_a" 2>/dev/null || true
  wait "$pid_b" 2>/dev/null || true

  # Early-out: aggregated tool-not-found across save logs → skip.
  if _p9_any_tool_not_found "P9/session" "$log_dir"; then
    rm -rf "$log_dir" 2>/dev/null
    E2E_DIR="$_saved"; return
  fi

  # Observation step: session_info. This runs AFTER both writers finished,
  # so it must return a coherent snapshot — no interleave tolerated.
  _mcp_invoke_tool "session_info" "{\"name\":\"$sess\"}" \
    "$sess|sessionId|value|createdAt|path" "P9/session/info" 20 --ro

  if [[ "${_CHECK_PASSED:-}" == "skip_accepted" ]]; then
    # session_info not in build but session_save was — still a skip overall.
    _CHECK_OUTPUT="SKIP_ACCEPTED: P9/session: session_info not in build"
    rm -rf "$log_dir" 2>/dev/null
    E2E_DIR="$_saved"; return
  fi
  if [[ "${_CHECK_PASSED:-}" != "true" ]]; then
    _CHECK_OUTPUT="P9/session FAIL: session_info did not return coherent body post-race — session missing or unparseable. Body: $(echo "${_MCP_BODY:-}" | head -5 | tr '\n' ' ')"
    _CHECK_PASSED="false"
    rm -rf "$log_dir" 2>/dev/null
    E2E_DIR="$_saved"; return
  fi

  # Reset — we re-decide below based on which writer's value landed.
  local body="${_MCP_BODY:-}"
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  # Ensure the body parses as some kind of structured response (not a bare
  # error string). grep is enough for bash-level sanity; real JSON parsing
  # via node would be overkill for this single field.
  if [[ -z "$body" ]]; then
    _CHECK_OUTPUT="P9/session FAIL: session_info body empty post-race (name=$sess)"
    rm -rf "$log_dir" 2>/dev/null
    E2E_DIR="$_saved"; return
  fi

  # Verify the response references the session name — otherwise session_info
  # returned an unrelated body (e.g. default placeholder).
  if ! echo "$body" | grep -q "$sess"; then
    _CHECK_OUTPUT="P9/session FAIL: session_info body does not reference name=$sess — got: $(echo "$body" | head -5 | tr '\n' ' ')"
    rm -rf "$log_dir" 2>/dev/null
    E2E_DIR="$_saved"; return
  fi

  # Look for ONE of the two distinct writer values. Must match exactly one.
  local saw_a="no" saw_b="no"
  if echo "$body" | grep -qF "$val_a"; then saw_a="yes"; fi
  if echo "$body" | grep -qF "$val_b"; then saw_b="yes"; fi

  if [[ "$saw_a" == "yes" && "$saw_b" == "yes" ]]; then
    # Both values in the same body = interleaved corruption.
    _CHECK_OUTPUT="P9/session FAIL: session_info body contains BOTH writers' values ($val_a AND $val_b) — interleaved corruption (mutex broken). Body: $(echo "$body" | head -5 | tr '\n' ' ')"
    rm -rf "$log_dir" 2>/dev/null
    E2E_DIR="$_saved"; return
  fi

  if [[ "$saw_a" == "no" && "$saw_b" == "no" ]]; then
    # Neither value landed. The session exists but its value is null/garbled.
    _CHECK_OUTPUT="P9/session FAIL: session_info has name=$sess but value matches NEITHER writer ($val_a / $val_b) — interleaved corruption or silent no-op. Body: $(echo "$body" | head -5 | tr '\n' ' ')"
    rm -rf "$log_dir" 2>/dev/null
    E2E_DIR="$_saved"; return
  fi

  # Exactly one winner's value present — last-writer-wins.
  local winner
  if [[ "$saw_a" == "yes" ]]; then winner="A($val_a)"; else winner="B($val_b)"; fi
  _CHECK_PASSED="true"
  _CHECK_OUTPUT="P9/session OK: last-writer-wins — winner=$winner, no interleave (sess=$sess)"
  rm -rf "$log_dir" 2>/dev/null
  E2E_DIR="$_saved"
}
check_adr0094_p9_session_no_interleave() {
  _with_iso_cleanup "p9-session" _p9_session_no_interleave_body
}

# ════════════════════════════════════════════════════════════════════
# P9-4: workflow_create exactly-one-winner
# ════════════════════════════════════════════════════════════════════
# Spawn 4 parallel workflow_create against the SAME name. Then call
# workflow_list once and count occurrences of the name. Exactly-one-winner
# semantics: PASS iff count == 1. 0 = all creates failed. >1 = duplicates.
_p9_workflow_concurrent_start_body() {
  local iso="$1"
  local _saved="${E2E_DIR:-}"
  E2E_DIR="$iso"

  local cli; cli=$(_cli_cmd)
  if [[ -z "$cli" ]]; then
    _CHECK_OUTPUT="P9/workflow FAIL: _cli_cmd returned empty — no CLI binary found in \$TEMP_DIR"
    _CHECK_PASSED="false"; E2E_DIR="$_saved"; return
  fi

  local name="p9-wf-$$-$(date +%s)"
  local log_dir; log_dir=$(mktemp -d /tmp/p9-workflow-XXXXX)
  local N=4

  local pids=() i
  for i in $(seq 1 "$N"); do
    local params="{\"name\":\"$name\",\"steps\":[{\"name\":\"s\",\"action\":\"log\"}]}"
    (
      cd "$iso" && NPM_CONFIG_REGISTRY="$REGISTRY" timeout 20 "$cli" mcp exec \
        --tool workflow_create --params "$params" \
        > "$log_dir/create-$i.log" 2>&1
    ) &
    pids+=($!)
  done

  local pid
  for pid in "${pids[@]}"; do
    wait "$pid" 2>/dev/null || true
  done

  # Aggregated tool-not-found across create logs → skip.
  if _p9_any_tool_not_found "P9/workflow" "$log_dir"; then
    rm -rf "$log_dir" 2>/dev/null
    E2E_DIR="$_saved"; return
  fi

  # Observation: workflow_list. Count occurrences of the shared name.
  _mcp_invoke_tool "workflow_list" '{}' 'workflows|list|\[|name' \
    "P9/workflow/list" 20 --ro

  if [[ "${_CHECK_PASSED:-}" == "skip_accepted" ]]; then
    _CHECK_OUTPUT="SKIP_ACCEPTED: P9/workflow: workflow_list not in build"
    rm -rf "$log_dir" 2>/dev/null
    E2E_DIR="$_saved"; return
  fi
  if [[ "${_CHECK_PASSED:-}" != "true" ]]; then
    _CHECK_OUTPUT="P9/workflow FAIL: workflow_list did not return coherent body post-race (exit=${_MCP_EXIT:-?}). Body: $(echo "${_MCP_BODY:-}" | head -5 | tr '\n' ' ')"
    _CHECK_PASSED="false"
    rm -rf "$log_dir" 2>/dev/null
    E2E_DIR="$_saved"; return
  fi

  local body="${_MCP_BODY:-}"
  if [[ -z "$body" ]]; then
    _CHECK_OUTPUT="P9/workflow FAIL: workflow_list returned empty body post-race (name=$name)"
    _CHECK_PASSED="false"
    rm -rf "$log_dir" 2>/dev/null
    E2E_DIR="$_saved"; return
  fi

  # Count occurrences of the shared name in the list body. `grep -c` counts
  # *lines* matching, not total matches — a JSON list that inlines all
  # entries on a single line would undercount. Use `grep -oF ... | wc -l`
  # for total-match count. Defensive pattern from CLAUDE.md applies:
  # `grep -c pat || echo 0` produces "0\n0" on no-match, so capture + default.
  local occur
  occur=$(echo "$body" | grep -oF "$name" 2>/dev/null | wc -l | tr -d ' ')
  occur="${occur:-0}"

  _p9_expect_single_winner "P9/workflow (name=$name)" "$occur" "$N"
  rm -rf "$log_dir" 2>/dev/null
  E2E_DIR="$_saved"
}
check_adr0094_p9_workflow_concurrent_start() {
  _with_iso_cleanup "p9-workflow" _p9_workflow_concurrent_start_body
}
