#!/usr/bin/env bash
# lib/acceptance-adr0314-checks.sh — ADR-0314 orphan-Chrome reaper checks.
#
# ADR-0314: the browser acceptance checks drive a headless Chrome via the
# third-party `agent-browser` daemon, which is orphaned to PPID 1 (busy-spinning
# on software-GL helpers) whenever the MCP server that spawned it is SIGKILLed.
# Option 4 = fork-side launch-site teardown (signal handlers + idempotent close)
# + a defensive reaper for the SIGKILL escape. This lib confirms the reaper.
#
# Two checks (per ADR-0314 §Confirmation):
#   adr0314-no-orphans : after the browser group, assert ZERO orphaned
#                        agent-browser-chrome PPID-1 processes AND zero leftover
#                        /var/folders/.../T/agent-browser-chrome-* temp profiles.
#   adr0314-neg-control: a LIVE-parented mock agent-browser-chrome process is
#                        NOT killed by the reaper (only PPID-1 orphans are) —
#                        proves the precision contract (never kill a live agent).
#
# Conventions mirror lib/acceptance-adr0312-checks.sh:
#   - self-contained; sets _CHECK_PASSED ("true"|"false"|"skip_accepted") +
#     _CHECK_OUTPUT (run_check_bg/_fast_run read these).
#   - counts via var=$(grep -c ...); var=${var:-0} (reference-grep-c-bash-trap).
#   - full output to a per-check log (feedback-no-tail-tests).
#   - NO raw npx; NO network; pure ps/kill/rm — fast (sub-second).
#
# Caller MUST have sourced lib/acceptance-adr0314-reaper.sh first (provides
# _adr0314_orphan_count / _adr0314_orphan_profile_dirs / _adr0314_reap_orphans).
# The runner sources both libs together (see scripts/test-acceptance.sh).

set +u 2>/dev/null || true

# Defensive: if the runner sourced this lib but not the reaper, pull it in by
# its sibling path so the fast-runner single-test mode also works standalone.
if ! declare -F _adr0314_reap_orphans >/dev/null 2>&1; then
  _adr0314_self_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  # shellcheck source=/dev/null
  [[ -f "$_adr0314_self_dir/acceptance-adr0314-reaper.sh" ]] && \
    source "$_adr0314_self_dir/acceptance-adr0314-reaper.sh"
fi

# ════════════════════════════════════════════════════════════════════
# Check A — POSITIVE: zero orphans + zero leftover temp profiles after
# the browser group. This runs AFTER the parallel all-wave (where the
# p4-br-* checks live), so by now every browser check has completed and
# any well-behaved session is closed. We reap (the SIGKILL backstop),
# then assert the post-reap state is clean.
# ════════════════════════════════════════════════════════════════════
check_adr0314_no_orphans() {
  _CHECK_PASSED="false"; _CHECK_OUTPUT=""

  if ! declare -F _adr0314_reap_orphans >/dev/null 2>&1; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: adr0314 reaper helper not sourced (lib/acceptance-adr0314-reaper.sh)"
    return
  fi

  local log; log=$(mktemp /tmp/adr0314-no-orphans-XXXXX)

  # Snapshot BEFORE the post-group reap (diagnostic only).
  local before_procs before_profiles
  before_procs=$(_adr0314_orphan_count)
  before_profiles=$(_adr0314_orphan_profile_dirs | grep -c .); before_profiles=${before_profiles:-0}
  {
    echo "== adr0314 no-orphans =="
    echo "before reap: orphan_procs=$before_procs orphan_profiles=$before_profiles"
    _adr0314_orphan_profile_dirs
  } >> "$log" 2>&1

  # The post-group reap: kill PPID-1 orphans + remove their temp profiles.
  _adr0314_reap_orphans "after browser group (acceptance assertion)" >> "$log" 2>&1

  # Assert the post-reap state is clean. The reaper is the source of truth
  # for "did the leak get cleaned"; a residual non-zero count here means an
  # orphan could not be killed (e.g. a zombie / permission), which is a real
  # finding worth a FAIL.
  local after_procs after_profiles
  after_procs=$(_adr0314_orphan_count)
  after_profiles=$(_adr0314_orphan_profile_dirs | grep -c .); after_profiles=${after_profiles:-0}
  echo "after reap:  orphan_procs=$after_procs orphan_profiles=$after_profiles" >> "$log"

  if [[ "$after_procs" -eq 0 && "$after_profiles" -eq 0 ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="adr0314: 0 orphaned agent-browser-chrome PPID-1 procs + 0 leftover temp profiles after browser group (reaped ${before_procs} proc / ${before_profiles} profile pre-existing)"
    rm -f "$log" 2>/dev/null
  else
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="adr0314 FAIL: after reap orphan_procs=$after_procs orphan_profiles=$after_profiles (expected 0/0) — see $log"
  fi
}

# ════════════════════════════════════════════════════════════════════
# Check B — NEGATIVE CONTROL: a LIVE-parented mock agent-browser-chrome
# must SURVIVE the reaper. Spawns `sleep` under the alias
# "agent-browser-chrome-NEGCTRL ..." (matches the char-class guard) but
# parented to THIS check process (PPID != 1). Runs the reaper, then
# asserts the mock is still alive. Proves we never kill a running agent.
# ════════════════════════════════════════════════════════════════════
check_adr0314_neg_control() {
  _CHECK_PASSED="false"; _CHECK_OUTPUT=""

  if ! declare -F _adr0314_reap_orphans >/dev/null 2>&1; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: adr0314 reaper helper not sourced (lib/acceptance-adr0314-reaper.sh)"
    return
  fi

  local log; log=$(mktemp /tmp/adr0314-neg-control-XXXXX)

  # Spawn a live-parented mock whose command matches the reaper's guard but
  # whose PPID is this shell (not 1). `exec -a` sets argv[0]; the renderer-ish
  # tail makes it look like a real Chrome helper.
  ( exec -a "agent-browser-chrome-NEGCTRL --type=renderer --enable-unsafe-swiftshader" sleep 10 ) &
  local mock_pid=$!
  # Give the exec a moment so `ps` sees the aliased command, not the subshell.
  sleep 0.4

  local mock_ppid
  mock_ppid=$(ps -o ppid= -p "$mock_pid" 2>/dev/null | tr -d ' ')
  {
    echo "== adr0314 neg-control =="
    echo "mock_pid=$mock_pid mock_ppid=$mock_ppid (this shell, NOT 1)"
    ps -o pid,ppid,command -p "$mock_pid" 2>/dev/null
  } >> "$log" 2>&1

  # Sanity: the mock must NOT be classified as an orphan (PPID-filter).
  local matched_as_orphan
  matched_as_orphan=$(_adr0314_orphan_pids | grep -c "^${mock_pid}$"); matched_as_orphan=${matched_as_orphan:-0}

  # Run the reaper — the live-parented mock must survive it.
  _adr0314_reap_orphans "neg-control (must not kill live mock)" >> "$log" 2>&1

  local survived="no"
  kill -0 "$mock_pid" 2>/dev/null && survived="yes"
  echo "after reap: mock survived=$survived matched_as_orphan=$matched_as_orphan mock_ppid=$mock_ppid" >> "$log"

  # Clean up the mock regardless of outcome.
  kill "$mock_pid" 2>/dev/null; wait "$mock_pid" 2>/dev/null

  if [[ "$survived" == "yes" && "$matched_as_orphan" -eq 0 && "$mock_ppid" != "1" ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="adr0314 neg-control: live-parented (PPID=$mock_ppid) agent-browser-chrome mock SURVIVED the reaper and was never matched as an orphan"
    rm -f "$log" 2>/dev/null
  else
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="adr0314 neg-control FAIL: survived=$survived matched_as_orphan=$matched_as_orphan mock_ppid=$mock_ppid (reaper killed a live session OR misclassified it) — see $log"
  fi
}
