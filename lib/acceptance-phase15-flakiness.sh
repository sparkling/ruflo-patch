#!/usr/bin/env bash
# lib/acceptance-phase15-flakiness.sh — ADR-0094 Phase 15: Flakiness characterization
#
# Asserts serial-repetition determinism on read-only tools. For each check, the
# same tool is invoked N=3 times in a row with identical input; each response
# is mapped to a coarse "shape class" ∈ {success, failure, empty, exit_error};
# all N classes must be identical. Divergence across *serial* runs is "truly
# flaky" (deterministic non-determinism — a real defect). Load-induced
# divergence under concurrent callers is NOT what this phase measures; that is
# already covered by Phase 9 (concurrency matrix). Phase 15 isolates the
# baseline case — "does this tool behave the same way twice in a row, no other
# variables?" — so a failure here names a genuine flake, not a load anomaly.
#
# This is the discriminator the ADR-0094 plan asks for: "load-sensitive vs.
# deterministic". If Phase 15 PASSes on a tool but Phase 9 flakes on it, the
# flake is load-sensitive (queue / lock / scheduling). If Phase 15 FAILs, the
# tool is nondeterministic on its own — the expensive bug class.
#
# Tool matrix (6 read-only tools, chosen to cover different shape classes):
#   #  class      tool             params
#   1. memory     memory_search    {"query":"p15-stable"}
#   2. agent      agent_list       {}
#   3. config     config_get       {"key":"version"}
#   4. claims     claims_board     {}
#   5. workflow   workflow_list    {}
#   6. session    session_list     {}
#
# All targets are `--ro`. A WRITE tool in this phase would conflate "the tool
# is flaky" with "successive writes legitimately change state"; Phase 15
# deliberately excludes writes to keep the signal clean. Budget: 3 invocations
# × ~1-2s = 3-6s per check × 6 checks in parallel ≈ 10-15s wall clock.
#
# Shape class mapping (applied to each of the N runs):
#   - exit_error : _MCP_EXIT != 0 and body does NOT match the not-found regex.
#                  (not-found exits become SKIP_ACCEPTED at the check level.)
#   - empty      : body is empty or whitespace-only with exit 0.
#   - failure    : body matches /"success"[[:space:]]*:[[:space:]]*false/
#                  OR matches error-shape word (error|invalid|required|missing|
#                  malformed|unexpected|cannot).
#   - success    : body matches /"success"[[:space:]]*:[[:space:]]*true/ OR is
#                  non-empty and does not match the failure predicates.
#
# The fingerprint is the CLASS, not the full body — minor text drift (UUIDs,
# timestamps, ordering) must not flip the verdict. Only the coarse class
# changes count as flakiness. This is deliberate: if two successful calls
# carry different UUIDs, that is not flakiness, and any check that flagged
# it would generate constant false positives.
#
# PASS          : all N classes identical AND that class is `success`.
# PASS          : all N classes identical AND that class is `failure` (uniform
#                 failure is deterministic — this phase only measures variance;
#                 correctness is other phases' job). Output flags this as
#                 "deterministic-failure" for downstream dashboards.
# FAIL — flaky  : classes differ across the N runs (the headline defect).
# FAIL — all-empty : all N classes are `empty` (ADR-0082 silent-pass canary).
# FAIL — all-error : all N classes are `exit_error` (persistent infra fault,
#                 NOT flakiness — but also not useful coverage; flag distinctly
#                 so ops can fix).
# SKIP_ACCEPTED : the FIRST run returned tool-not-found. Skip the remaining
#                 runs — once is enough to prove the tool isn't in the build.
#
# Requires: acceptance-harness.sh (_mcp_invoke_tool, _with_iso_cleanup).
# Caller MUST set: E2E_DIR, TEMP_DIR, REGISTRY, PKG.

# ════════════════════════════════════════════════════════════════════
# Shared helpers — shape-class classifier + verdict evaluator.
# ════════════════════════════════════════════════════════════════════

# _p15_classify <body> <exit_code>
#
# Emits one of {success, failure, empty, exit_error} on stdout. Pure function
# (no globals read or written) so the repetition loop can call it N times
# without pipeline interference.
_p15_classify() {
  local body="$1"
  local exit_code="$2"

  # (1) Non-zero exit with a body that doesn't carry not-found (not-found is
  # handled one level up as SKIP_ACCEPTED) → exit_error.
  if [[ "$exit_code" != "0" ]]; then
    echo "exit_error"
    return
  fi

  # (2) Strip whitespace; empty body is its own class.
  local trimmed
  trimmed=$(echo "$body" | tr -d '[:space:]')
  if [[ -z "$trimmed" ]]; then
    echo "empty"
    return
  fi

  # (3) Explicit failure markers win over the error-shape word heuristic so a
  # body containing "success":false but also the word "cannot" classifies as
  # `failure`, not something else. (Both map to `failure` anyway — the
  # ordering just makes the intent explicit.)
  if echo "$body" | grep -qE '"success"[[:space:]]*:[[:space:]]*false'; then
    echo "failure"
    return
  fi
  if echo "$body" | grep -qiE 'error|invalid|required|missing|malformed|unexpected|cannot'; then
    echo "failure"
    return
  fi

  # (4) Everything else is `success` — either an explicit success marker or a
  # non-empty body with no failure-shaped content.
  echo "success"
}

# _p15_expect_deterministic <label> <class1> <class2> <class3>
#
# Post-condition evaluator. Compares the three shape classes and sets
# _CHECK_PASSED / _CHECK_OUTPUT. Assumes SKIP_ACCEPTED was already handled by
# the caller's repetition loop (caller only calls us when it has three real
# classes to compare).
_p15_expect_deterministic() {
  local label="${1:-p15}"
  local c1="${2:-}"
  local c2="${3:-}"
  local c3="${4:-}"

  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  # (a) Truly flaky — the headline defect this phase is built to catch.
  if [[ "$c1" != "$c2" || "$c2" != "$c3" ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="${label} FAIL: flaky across serial runs (classes: ${c1}, ${c2}, ${c3}). Same input, same process, three different shape classes — this is deterministic non-determinism, not load sensitivity."
    return
  fi

  # (b) All-empty — ADR-0082 silent-pass canary, applied three times.
  if [[ "$c1" == "empty" ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="${label} FAIL: all 3 runs returned empty body (ADR-0082 silent-pass canary — neutral body is suspect, not deterministic)."
    return
  fi

  # (c) All-error — persistent infra fault. Not flakiness per se, but we
  # refuse to PASS a uniformly-broken tool. Fail distinctly so ops can see
  # the signal without conflating it with (a).
  if [[ "$c1" == "exit_error" ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="${label} FAIL: all 3 runs exited non-zero (deterministic infra failure, NOT flakiness — fix the tool, then re-verify)."
    return
  fi

  # (d) Deterministic failure — the tool works the same way every time, and
  # that way happens to be `failure` shape. This phase passes (it only
  # measures variance); correctness is Phase 11/12's job. Flag the class in
  # the output so dashboards can slice on it.
  if [[ "$c1" == "failure" ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="${label} OK: deterministic-failure (all 3 runs produced the same failure shape — no flake, but downstream correctness checks still own the verdict)."
    return
  fi

  # (e) Deterministic success — the canonical PASS.
  _CHECK_PASSED="true"
  _CHECK_OUTPUT="${label} OK: deterministic (3/3 runs produced class=${c1})"
}

# _p15_run_three <label> <tool> <params_json> <timeout>
#
# Invokes <tool> three times with <params_json>, captures the shape class of
# each, and either (1) returns SKIP_ACCEPTED if the first run is tool-not-
# found, or (2) calls _p15_expect_deterministic to finalize the verdict. This
# is the shared body every check function delegates to.
_p15_run_three() {
  local label="$1" tool="$2" params="$3" timeout="${4:-15}"

  local classes=()
  local i
  for i in 1 2 3; do
    _mcp_invoke_tool "$tool" "$params" '.' "${label}/run${i}" "$timeout" --ro

    # First run: if _mcp_invoke_tool decided tool-not-found, the whole check
    # is SKIP_ACCEPTED. Bail early — no point invoking a missing tool twice
    # more.
    if [[ "$i" == "1" && "${_CHECK_PASSED:-}" == "skip_accepted" ]]; then
      _CHECK_OUTPUT="SKIP_ACCEPTED: ${label}: tool '${tool}' not in build"
      return
    fi

    local class
    class=$(_p15_classify "${_MCP_BODY:-}" "${_MCP_EXIT:-0}")
    classes+=("$class")
  done

  _p15_expect_deterministic "$label" "${classes[0]}" "${classes[1]}" "${classes[2]}"
}

# ════════════════════════════════════════════════════════════════════
# 1. memory_search — {"query":"p15-stable"}
# ════════════════════════════════════════════════════════════════════
_p15_flaky_memory_search_body() {
  local iso="$1"; local _saved="${E2E_DIR:-}"; E2E_DIR="$iso"
  _p15_run_three "P15/memory_search" "memory_search" \
    '{"query":"p15-stable"}' 15
  E2E_DIR="$_saved"
}
check_adr0094_p15_flaky_memory_search() {
  # adr0097-l2-delegator: _CHECK_PASSED= is set inside _with_iso_cleanup / body fn
  _with_iso_cleanup "p15-flaky-memory-search" _p15_flaky_memory_search_body
}

# ════════════════════════════════════════════════════════════════════
# 2. agent_list — {}
# ════════════════════════════════════════════════════════════════════
_p15_flaky_agent_list_body() {
  local iso="$1"; local _saved="${E2E_DIR:-}"; E2E_DIR="$iso"
  _p15_run_three "P15/agent_list" "agent_list" '{}' 15
  E2E_DIR="$_saved"
}
check_adr0094_p15_flaky_agent_list() {
  # adr0097-l2-delegator: _CHECK_PASSED= is set inside _with_iso_cleanup / body fn
  _with_iso_cleanup "p15-flaky-agent-list" _p15_flaky_agent_list_body
}

# ════════════════════════════════════════════════════════════════════
# 3. config_get — {"key":"version"}
# ════════════════════════════════════════════════════════════════════
_p15_flaky_config_get_body() {
  local iso="$1"; local _saved="${E2E_DIR:-}"; E2E_DIR="$iso"
  _p15_run_three "P15/config_get" "config_get" \
    '{"key":"version"}' 15
  E2E_DIR="$_saved"
}
check_adr0094_p15_flaky_config_get() {
  # adr0097-l2-delegator: _CHECK_PASSED= is set inside _with_iso_cleanup / body fn
  _with_iso_cleanup "p15-flaky-config-get" _p15_flaky_config_get_body
}

# ════════════════════════════════════════════════════════════════════
# 4. claims_board — {}
# ════════════════════════════════════════════════════════════════════
_p15_flaky_claims_board_body() {
  local iso="$1"; local _saved="${E2E_DIR:-}"; E2E_DIR="$iso"
  _p15_run_three "P15/claims_board" "claims_board" '{}' 15
  E2E_DIR="$_saved"
}
check_adr0094_p15_flaky_claims_board() {
  # adr0097-l2-delegator: _CHECK_PASSED= is set inside _with_iso_cleanup / body fn
  _with_iso_cleanup "p15-flaky-claims-board" _p15_flaky_claims_board_body
}

# ════════════════════════════════════════════════════════════════════
# 5. workflow_list — {}
# ════════════════════════════════════════════════════════════════════
_p15_flaky_workflow_list_body() {
  local iso="$1"; local _saved="${E2E_DIR:-}"; E2E_DIR="$iso"
  _p15_run_three "P15/workflow_list" "workflow_list" '{}' 15
  E2E_DIR="$_saved"
}
check_adr0094_p15_flaky_workflow_list() {
  # adr0097-l2-delegator: _CHECK_PASSED= is set inside _with_iso_cleanup / body fn
  _with_iso_cleanup "p15-flaky-workflow-list" _p15_flaky_workflow_list_body
}

# ════════════════════════════════════════════════════════════════════
# 6. session_list — {}
# ════════════════════════════════════════════════════════════════════
_p15_flaky_session_list_body() {
  local iso="$1"; local _saved="${E2E_DIR:-}"; E2E_DIR="$iso"
  _p15_run_three "P15/session_list" "session_list" '{}' 15
  E2E_DIR="$_saved"
}
check_adr0094_p15_flaky_session_list() {
  # adr0097-l2-delegator: _CHECK_PASSED= is set inside _with_iso_cleanup / body fn
  _with_iso_cleanup "p15-flaky-session-list" _p15_flaky_session_list_body
}
