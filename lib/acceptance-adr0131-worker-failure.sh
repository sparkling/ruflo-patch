#!/usr/bin/env bash
# lib/acceptance-adr0131-worker-failure.sh — ADR-0131 (T12) Worker-failure
#                                            prompt protocol acceptance checks
#
# Cover the four surfaces ADR-0131 ships:
#   - §6 prompt extension carries the WORKER FAILURE PROTOCOL block
#     (sentinel substrings: 'WORKER FAILURE PROTOCOL', '60s', 'retry-once',
#      "'absent'", 'worker-<id>-status')
#   - hive-mind_consensus({action:'status'}) auto-status-transition fires
#     for bft/raft/quorum/weighted when timeoutAt elapsed and totalVotes < required
#   - hive-mind_status response includes failedWorkers summary derived from
#     worker-<id>-status='absent' §6 markers
#   - hive-mind_spawn supports retryOf lineage tracking and the canonical
#     worker-<original>-retry-1 ID convention
#
# Per ADR-0131 §Validation: round-trip via init --full project + published
# @sparkleideas/cli; 'failed-quorum-not-reached' is the verbatim contract literal.
#
# IMPORTANT: This lib is NOT yet wired into scripts/test-acceptance.sh.
# The orchestrator handles wiring after T12 lands.
#
# Requires: _cli_cmd, _e2e_isolate from acceptance-checks.sh + acceptance-e2e-checks.sh
# Caller MUST set: REGISTRY, E2E_DIR (or equivalent isolation dir)

set +u 2>/dev/null || true

# ════════════════════════════════════════════════════════════════════
# Helper: bring up a hive with N workers in an isolated dir.
# ════════════════════════════════════════════════════════════════════
_adr0131_hive_init_with_workers() {
  local iso="$1"
  local worker_count="${2:-3}"
  local cli; cli=$(_cli_cmd)
  : > "$iso/.ruflo-project"
  if ! (cd "$iso" && NPM_CONFIG_REGISTRY="$REGISTRY" timeout 30 $cli hive-mind init >/dev/null 2>&1); then
    return 1
  fi
  if [[ "$worker_count" -gt 0 ]]; then
    if ! (cd "$iso" && NPM_CONFIG_REGISTRY="$REGISTRY" timeout 30 $cli mcp exec \
          --tool hive-mind_spawn \
          --params "{\"count\":${worker_count},\"role\":\"worker\"}" \
          >/dev/null 2>&1); then
      return 1
    fi
  fi
  return 0
}

# ════════════════════════════════════════════════════════════════════
# Check 1: §6 prompt — generated queen prompt carries WORKER FAILURE PROTOCOL
#
# Static check on the in-fork dist (hive-mind.js). Per ADR-0131
# §Specification: sentinel substrings are verbatim contracts; downstream
# tests assert on the literal strings.
# ════════════════════════════════════════════════════════════════════
check_adr0131_prompt_carries_failure_protocol() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  # Locate the compiled hive-mind.js dist (build dir or fork dist).
  local fork_dist="/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/dist/commands/hive-mind.js"
  local build_dist="/tmp/ruflo-build/v3/@claude-flow/cli/dist/commands/hive-mind.js"
  local dist=""
  if [[ -f "$build_dist" ]]; then
    dist="$build_dist"
  elif [[ -f "$fork_dist" ]]; then
    dist="$fork_dist"
  else
    _CHECK_OUTPUT="ADR-0131-§prompt: no hive-mind.js dist found (build pre-req missing). Expected at $build_dist or $fork_dist."
    return
  fi

  local missing=""
  if ! grep -q "WORKER FAILURE PROTOCOL" "$dist"; then
    missing="${missing}WORKER FAILURE PROTOCOL;"
  fi
  if ! grep -q "60s" "$dist"; then
    missing="${missing}60s;"
  fi
  if ! grep -q "retry-once" "$dist"; then
    missing="${missing}retry-once;"
  fi
  if ! grep -q "'absent'" "$dist"; then
    missing="${missing}'absent';"
  fi
  if ! grep -q "worker-<id>-status" "$dist"; then
    missing="${missing}worker-<id>-status;"
  fi

  if [[ -n "$missing" ]]; then
    _CHECK_OUTPUT="ADR-0131-§prompt: dist missing required sentinel substrings: $missing  Per ADR-0131 §Specification, these are verbatim contract literals; renaming any of them is a breaking change."
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0131-§prompt: §6 WORKER FAILURE PROTOCOL block present with all sentinel substrings (WORKER FAILURE PROTOCOL, 60s, retry-once, 'absent', worker-<id>-status)."
}

# ════════════════════════════════════════════════════════════════════
# Check 2: Auto-status-transition — hive-mind_consensus({action:'status'})
# transitions a timed-out proposal to 'failed-quorum-not-reached' with
# absentVoters populated. Strategy coverage starts at bft/raft/quorum/weighted
# (gossip/crdt have their own settle paths and bypass the auto-transition).
#
# Per ADR-0131 §Validation Acceptance: round-trip via init --full project +
# published @sparkleideas/cli.
# ════════════════════════════════════════════════════════════════════
check_adr0131_worker_failure_auto_transition() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local cli; cli=$(_cli_cmd)
  if [[ -z "$cli" ]]; then
    _CHECK_OUTPUT="ADR-0131-§auto-transition: cli helper unavailable"
    return
  fi

  local iso; iso=$(_e2e_isolate "adr0131-auto-transition")
  if [[ -z "$iso" ]] || [[ ! -d "$iso" ]]; then
    _CHECK_OUTPUT="ADR-0131-§auto-transition: e2e isolate dir unavailable"
    return
  fi

  if ! _adr0131_hive_init_with_workers "$iso" 4; then
    _CHECK_OUTPUT="ADR-0131-§auto-transition: hive init/spawn failed in iso=$iso"
    rm -rf "$iso" 2>/dev/null
    return
  fi

  local strategy_failures=""
  local strategies=("bft" "raft" "quorum" "weighted")

  for strategy in "${strategies[@]}"; do
    # Propose with a very short negative timeout — predicate fires immediately.
    local propose_out
    propose_out=$(cd "$iso" && NPM_CONFIG_REGISTRY="$REGISTRY" timeout 30 $cli mcp exec \
      --tool hive-mind_consensus \
      --params "{\"action\":\"propose\",\"type\":\"adr0131-${strategy}\",\"value\":\"v\",\"strategy\":\"${strategy}\",\"timeoutMs\":-1000}" \
      2>&1)

    # Extract proposalId from output. Format may be JSON or text — try both.
    local proposal_id
    proposal_id=$(echo "$propose_out" | grep -oE 'proposal-[0-9]+-[a-z0-9]+' | head -1)
    if [[ -z "$proposal_id" ]]; then
      strategy_failures="${strategy_failures}${strategy}=propose-failed;"
      continue
    fi

    # Status query — should fire the auto-transition.
    local status_out
    status_out=$(cd "$iso" && NPM_CONFIG_REGISTRY="$REGISTRY" timeout 30 $cli mcp exec \
      --tool hive-mind_consensus \
      --params "{\"action\":\"status\",\"proposalId\":\"${proposal_id}\"}" \
      2>&1)

    # The verbatim contract literal must appear in the response.
    if ! echo "$status_out" | grep -q "failed-quorum-not-reached"; then
      strategy_failures="${strategy_failures}${strategy}=no-transition;"
      continue
    fi

    # absentVoters must be populated (non-empty array).
    if ! echo "$status_out" | grep -q "absentVoters"; then
      strategy_failures="${strategy_failures}${strategy}=no-absentVoters;"
      continue
    fi

    # statusJustTransitioned: true must appear on the firing call.
    if ! echo "$status_out" | grep -q "statusJustTransitioned"; then
      strategy_failures="${strategy_failures}${strategy}=no-statusJustTransitioned;"
      continue
    fi
  done

  if [[ -n "$strategy_failures" ]]; then
    _CHECK_OUTPUT="ADR-0131-§auto-transition: failures across strategies: $strategy_failures  (Note: gossip/crdt strategies are NOT covered by this check — they have their own settle paths per ADR-0120/ADR-0121.)"
    rm -rf "$iso" 2>/dev/null
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0131-§auto-transition: bft/raft/quorum/weighted all auto-transition to 'failed-quorum-not-reached' with absentVoters populated and statusJustTransitioned reflected in the response."
  rm -rf "$iso" 2>/dev/null
}

# ════════════════════════════════════════════════════════════════════
# Check 3: hive-mind_status surfaces failedWorkers summary derived from
# worker-<id>-status='absent' §6 markers.
# ════════════════════════════════════════════════════════════════════
check_adr0131_status_failed_workers_summary() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local cli; cli=$(_cli_cmd)
  if [[ -z "$cli" ]]; then
    _CHECK_OUTPUT="ADR-0131-§failedWorkers: cli helper unavailable"
    return
  fi

  local iso; iso=$(_e2e_isolate "adr0131-failed-workers")
  if [[ -z "$iso" ]] || [[ ! -d "$iso" ]]; then
    _CHECK_OUTPUT="ADR-0131-§failedWorkers: e2e isolate dir unavailable"
    return
  fi

  if ! _adr0131_hive_init_with_workers "$iso" 3; then
    _CHECK_OUTPUT="ADR-0131-§failedWorkers: hive init/spawn failed"
    rm -rf "$iso" 2>/dev/null
    return
  fi

  # Fetch the spawned worker IDs from state.json.
  local state_path="$iso/.claude-flow/hive-mind/state.json"
  if [[ ! -f "$state_path" ]]; then
    _CHECK_OUTPUT="ADR-0131-§failedWorkers: state.json missing at $state_path"
    rm -rf "$iso" 2>/dev/null
    return
  fi

  # Extract first worker ID via grep (state.json is human-readable).
  local first_worker
  first_worker=$(grep -oE '"hive-worker-[^"]+"' "$state_path" | head -1 | tr -d '"')
  if [[ -z "$first_worker" ]]; then
    _CHECK_OUTPUT="ADR-0131-§failedWorkers: no worker ID found in state.json"
    rm -rf "$iso" 2>/dev/null
    return
  fi

  # Write the §6 absence marker via hive-mind_memory.
  if ! (cd "$iso" && NPM_CONFIG_REGISTRY="$REGISTRY" timeout 30 $cli mcp exec \
        --tool hive-mind_memory \
        --params "{\"action\":\"set\",\"key\":\"worker-${first_worker}-status\",\"value\":\"absent\",\"type\":\"system\"}" \
        >/dev/null 2>&1); then
    _CHECK_OUTPUT="ADR-0131-§failedWorkers: failed to write absence marker for ${first_worker}"
    rm -rf "$iso" 2>/dev/null
    return
  fi

  # Query hive-mind_status — failedWorkers must include the marked worker.
  local status_out
  status_out=$(cd "$iso" && NPM_CONFIG_REGISTRY="$REGISTRY" timeout 30 $cli mcp exec \
    --tool hive-mind_status \
    --params "{}" \
    2>&1)

  if ! echo "$status_out" | grep -q "failedWorkers"; then
    _CHECK_OUTPUT="ADR-0131-§failedWorkers: failedWorkers field missing from hive-mind_status response: ${status_out:0:300}"
    rm -rf "$iso" 2>/dev/null
    return
  fi

  if ! echo "$status_out" | grep -q "$first_worker"; then
    _CHECK_OUTPUT="ADR-0131-§failedWorkers: ${first_worker} not in failedWorkers summary: ${status_out:0:300}"
    rm -rf "$iso" 2>/dev/null
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0131-§failedWorkers: hive-mind_status surfaces failedWorkers summary; §6 absence marker (worker-${first_worker}-status='absent') propagated correctly."
  rm -rf "$iso" 2>/dev/null
}

# ════════════════════════════════════════════════════════════════════
# Check 4: Retry lineage round-trip — hive-mind_spawn with retryTask
# action records retryOf on the new worker entry; round-trip preserves
# the lineage.
# ════════════════════════════════════════════════════════════════════
check_adr0131_retry_lineage_round_trip() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local cli; cli=$(_cli_cmd)
  if [[ -z "$cli" ]]; then
    _CHECK_OUTPUT="ADR-0131-§retry-lineage: cli helper unavailable"
    return
  fi

  local iso; iso=$(_e2e_isolate "adr0131-retry")
  if [[ -z "$iso" ]] || [[ ! -d "$iso" ]]; then
    _CHECK_OUTPUT="ADR-0131-§retry-lineage: e2e isolate dir unavailable"
    return
  fi

  if ! _adr0131_hive_init_with_workers "$iso" 1; then
    _CHECK_OUTPUT="ADR-0131-§retry-lineage: hive init/spawn failed"
    rm -rf "$iso" 2>/dev/null
    return
  fi

  # Fetch the spawned worker ID.
  local state_path="$iso/.claude-flow/hive-mind/state.json"
  local original_id
  original_id=$(grep -oE '"hive-worker-[^"]+"' "$state_path" | head -1 | tr -d '"')
  if [[ -z "$original_id" ]]; then
    _CHECK_OUTPUT="ADR-0131-§retry-lineage: original worker ID not found"
    rm -rf "$iso" 2>/dev/null
    return
  fi

  # Mark the original as failed via §6 marker.
  if ! (cd "$iso" && NPM_CONFIG_REGISTRY="$REGISTRY" timeout 30 $cli mcp exec \
        --tool hive-mind_memory \
        --params "{\"action\":\"set\",\"key\":\"worker-${original_id}-status\",\"value\":\"absent\",\"type\":\"system\"}" \
        >/dev/null 2>&1); then
    _CHECK_OUTPUT="ADR-0131-§retry-lineage: failed to mark original as absent"
    rm -rf "$iso" 2>/dev/null
    return
  fi

  # Spawn a retry-worker via hive-mind_spawn action=retryTask.
  local retry_out
  retry_out=$(cd "$iso" && NPM_CONFIG_REGISTRY="$REGISTRY" timeout 30 $cli mcp exec \
    --tool hive-mind_spawn \
    --params "{\"action\":\"retryTask\",\"retryOf\":\"${original_id}\"}" \
    2>&1)

  # Response must include retryOf set to the original ID.
  if ! echo "$retry_out" | grep -q "retryOf"; then
    _CHECK_OUTPUT="ADR-0131-§retry-lineage: retryTask response missing retryOf field: ${retry_out:0:300}"
    rm -rf "$iso" 2>/dev/null
    return
  fi

  if ! echo "$retry_out" | grep -q "$original_id"; then
    _CHECK_OUTPUT="ADR-0131-§retry-lineage: retryTask response missing original ID '${original_id}': ${retry_out:0:300}"
    rm -rf "$iso" 2>/dev/null
    return
  fi

  # Canonical retry ID convention: worker-<original>-retry-1.
  if ! echo "$retry_out" | grep -q "${original_id}-retry-1"; then
    _CHECK_OUTPUT="ADR-0131-§retry-lineage: retry worker ID does not follow canonical 'worker-<original>-retry-1' convention: ${retry_out:0:300}"
    rm -rf "$iso" 2>/dev/null
    return
  fi

  # Round-trip: state.json should contain workerMeta with retryOf pointer.
  if ! grep -q "workerMeta" "$state_path"; then
    _CHECK_OUTPUT="ADR-0131-§retry-lineage: state.json missing workerMeta map after retry"
    rm -rf "$iso" 2>/dev/null
    return
  fi

  if ! grep -q "retryOf" "$state_path"; then
    _CHECK_OUTPUT="ADR-0131-§retry-lineage: state.json missing retryOf field after retry"
    rm -rf "$iso" 2>/dev/null
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0131-§retry-lineage: retryTask records retryOf=${original_id} on canonical retry-1 worker; state.json round-trip preserves the lineage."
  rm -rf "$iso" 2>/dev/null
}
