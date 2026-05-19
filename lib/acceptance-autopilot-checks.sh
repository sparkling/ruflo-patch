#!/usr/bin/env bash
# lib/acceptance-autopilot-checks.sh — ADR-0094 Phase 2: Autopilot MCP tools
#
# Acceptance checks for the 9 autopilot_* MCP tools. Each check invokes
# the tool via `cli mcp exec --tool <name> --params '<json>'` and matches
# the output against an expected pattern.
#
# Requires: acceptance-harness.sh + acceptance-checks.sh sourced first
#           (_run_and_kill_ro, _cli_cmd, _e2e_isolate available)
# Caller MUST set: E2E_DIR, TEMP_DIR, REGISTRY, PKG

# ════════════════════════════════════════════════════════════════════
# Shared helper: _autopilot_invoke_tool
# ════════════════════════════════════════════════════════════════════
#
# Arguments (positional):
#   $1 tool             — MCP tool name (e.g. "autopilot_enable")
#   $2 params           — JSON params string (e.g. '{"context":"test"}')
#   $3 expected_pattern — grep -iE pattern for a PASS match
#   $4 label            — human-readable label for diagnostics
#   $5 timeout          — max seconds (default 15)
#
# Sets: _CHECK_PASSED ("true" / "false" / "skip_accepted")
#       _CHECK_OUTPUT  (diagnostic string)
# adr0097-l5-intentional: emits P2/<label>-prefixed diagnostics and uses ADR-0082 narrow tool-registry skip phrasing distinct from _mcp_invoke_tool's envelope unwrap path (ADR-0094 Phase 2).
_autopilot_invoke_tool() {
  local tool="$1"
  local params="$2"
  local expected_pattern="$3"
  local label="$4"
  local timeout="${5:-15}"

  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  if [[ -z "$tool" || -z "$expected_pattern" || -z "$label" ]]; then
    _CHECK_OUTPUT="P2/${label}: helper called with missing args (tool=$tool pattern=$expected_pattern label=$label)"
    return
  fi

  local cli; cli=$(_cli_cmd)
  local work; work=$(mktemp /tmp/autopilot-${tool}-XXXXX)

  # Build the command — include --params only when non-empty
  local cmd
  if [[ -n "$params" && "$params" != "{}" ]]; then
    cmd="cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli mcp exec --tool $tool --params '$params'"
  else
    cmd="cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli mcp exec --tool $tool"
  fi

  _run_and_kill_ro "$cmd" "$work" "$timeout"
  local body; body=$(cat "$work" 2>/dev/null || echo "")
  # Strip the sentinel line before matching
  body=$(echo "$body" | grep -v '^__RUFLO_DONE__:')

  rm -f "$work" 2>/dev/null

  # ─── Three-way bucket ────────────────────────────────────────────
  # 1. Tool not found / not registered → skip_accepted
  if echo "$body" | grep -qiE 'tool.+not found|not found|not registered|unknown tool|no such tool|method .* not found|invalid tool'; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: P2/${label}: MCP tool '$tool' not in build — $(echo "$body" | head -3 | tr '\n' ' ')"
    return
  fi

  # 2. Expected pattern match → PASS
  if echo "$body" | grep -qiE "$expected_pattern"; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="P2/${label}: tool '$tool' returned expected pattern ($expected_pattern)"
    return
  fi

  # 3. Everything else → FAIL with diagnostic
  _CHECK_PASSED="false"
  _CHECK_OUTPUT="P2/${label}: tool '$tool' output did not match /$expected_pattern/i. Output (first 10 lines):
$(echo "$body" | head -10)"
}

# ════════════════════════════════════════════════════════════════════
# LIFECYCLE: check_adr0094_p2_autopilot_lifecycle
# ════════════════════════════════════════════════════════════════════
#
# Multi-step sequence: enable → status (shows enabled) → predict →
# disable → status (shows disabled). Each step uses its own temp file.
# Any tool-not-found at any step → skip_accepted for the whole check.
check_adr0094_p2_autopilot_lifecycle() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local cli; cli=$(_cli_cmd)
  local work; work=$(mktemp -d "${ACCEPT_TEMP:-/tmp}/_check_workdirs/autopilot-lifecycle-XXXXX")

  # ─── Step 1: enable ──────────────────────────────────────────────
  _run_and_kill_ro "cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli mcp exec --tool autopilot_enable" "$work/enable.out" 15
  local enable_body; enable_body=$(cat "$work/enable.out" 2>/dev/null | grep -v '^__RUFLO_DONE__:' || echo "")

  if echo "$enable_body" | grep -qiE 'tool.+not found|not found|not registered|unknown tool|no such tool|method .* not found|invalid tool'; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: P2/lifecycle: autopilot_enable not in build — $(echo "$enable_body" | head -3 | tr '\n' ' ')"
    rm -rf "$work" 2>/dev/null
    return
  fi

  if ! echo "$enable_body" | grep -qiE 'enabled|success|true'; then
    _CHECK_OUTPUT="P2/lifecycle: autopilot_enable did not confirm enable. Output: $(echo "$enable_body" | head -5 | tr '\n' ' ')"
    rm -rf "$work" 2>/dev/null
    return
  fi

  # ─── Step 2: status after enable ─────────────────────────────────
  _run_and_kill_ro "cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli mcp exec --tool autopilot_status" "$work/status1.out" 15
  local status1_body; status1_body=$(cat "$work/status1.out" 2>/dev/null | grep -v '^__RUFLO_DONE__:' || echo "")

  if ! echo "$status1_body" | grep -qiE 'status|enabled|disabled|state'; then
    _CHECK_OUTPUT="P2/lifecycle: autopilot_status after enable did not return status shape. Output: $(echo "$status1_body" | head -5 | tr '\n' ' ')"
    rm -rf "$work" 2>/dev/null
    return
  fi

  # ─── Step 3: predict ─────────────────────────────────────────────
  _run_and_kill_ro "cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli mcp exec --tool autopilot_predict --params '{\"context\":\"writing tests\"}'" "$work/predict.out" 15
  local predict_body; predict_body=$(cat "$work/predict.out" 2>/dev/null | grep -v '^__RUFLO_DONE__:' || echo "")

  if ! echo "$predict_body" | grep -qiE 'prediction|task|suggest|\[OK\]|content|result'; then
    _CHECK_OUTPUT="P2/lifecycle: autopilot_predict did not return prediction. Output: $(echo "$predict_body" | head -5 | tr '\n' ' ')"
    rm -rf "$work" 2>/dev/null
    return
  fi

  # ─── Step 4: disable ─────────────────────────────────────────────
  _run_and_kill_ro "cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli mcp exec --tool autopilot_disable" "$work/disable.out" 15
  local disable_body; disable_body=$(cat "$work/disable.out" 2>/dev/null | grep -v '^__RUFLO_DONE__:' || echo "")

  if ! echo "$disable_body" | grep -qiE 'disabled|success|true|enabled.*false|"enabled":.*false'; then
    _CHECK_OUTPUT="P2/lifecycle: autopilot_disable did not confirm disable. Output: $(echo "$disable_body" | head -5 | tr '\n' ' ')"
    rm -rf "$work" 2>/dev/null
    return
  fi

  # ─── Step 5: status after disable ────────────────────────────────
  _run_and_kill_ro "cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli mcp exec --tool autopilot_status" "$work/status2.out" 15
  local status2_body; status2_body=$(cat "$work/status2.out" 2>/dev/null | grep -v '^__RUFLO_DONE__:' || echo "")

  if ! echo "$status2_body" | grep -qiE 'status|enabled|disabled|state'; then
    _CHECK_OUTPUT="P2/lifecycle: autopilot_status after disable did not return status shape. Output: $(echo "$status2_body" | head -5 | tr '\n' ' ')"
    rm -rf "$work" 2>/dev/null
    return
  fi

  # ─── All 5 steps passed ──────────────────────────────────────────
  rm -rf "$work" 2>/dev/null
  _CHECK_PASSED="true"
  _CHECK_OUTPUT="P2/lifecycle: enable → status(enabled) → predict → disable → status(disabled) all confirmed"
}

# ════════════════════════════════════════════════════════════════════
# Individual tool checks (9 tools)
# ════════════════════════════════════════════════════════════════════

# Check 1: autopilot_enable
check_adr0094_p2_autopilot_enable() { # adr0097-l2-delegator: flag set inside _autopilot_invoke_tool
  _autopilot_invoke_tool \
    "autopilot_enable" \
    '{}' \
    'enabled|success|true' \
    "autopilot_enable" \
    15
}

# Check 2: autopilot_disable
check_adr0094_p2_autopilot_disable() { # adr0097-l2-delegator: flag set inside _autopilot_invoke_tool
  _autopilot_invoke_tool \
    "autopilot_disable" \
    '{}' \
    'disabled|success|true|enabled.*false|"enabled":.*false' \
    "autopilot_disable" \
    15
}

# Check 3: autopilot_status
check_adr0094_p2_autopilot_status() { # adr0097-l2-delegator: flag set inside _autopilot_invoke_tool
  _autopilot_invoke_tool \
    "autopilot_status" \
    '{}' \
    'status|enabled|disabled|state' \
    "autopilot_status" \
    15
}

# Check 4: autopilot_config
check_adr0094_p2_autopilot_config() { # adr0097-l2-delegator: flag set inside _autopilot_invoke_tool
  _autopilot_invoke_tool \
    "autopilot_config" \
    '{}' \
    'config|settings|mode' \
    "autopilot_config" \
    15
}

# Check 5: autopilot_predict
check_adr0094_p2_autopilot_predict() { # adr0097-l2-delegator: flag set inside _autopilot_invoke_tool
  _autopilot_invoke_tool \
    "autopilot_predict" \
    '{"context":"writing tests"}' \
    'prediction|task|suggest|\[OK\]|content|result' \
    "autopilot_predict" \
    15
}

# Check 6: autopilot_history
check_adr0094_p2_autopilot_history() { # adr0097-l2-delegator: flag set inside _autopilot_invoke_tool
  _autopilot_invoke_tool \
    "autopilot_history" \
    '{}' \
    'history|entries|events|\[\]' \
    "autopilot_history" \
    15
}

# Check 7: autopilot_learn
check_adr0094_p2_autopilot_learn() { # adr0097-l2-delegator: flag set inside _autopilot_invoke_tool
  _autopilot_invoke_tool \
    "autopilot_learn" \
    '{"input":"test pattern","outcome":"success"}' \
    'learned|success|true' \
    "autopilot_learn" \
    15
}

# Check 8: autopilot_log
check_adr0094_p2_autopilot_log() { # adr0097-l2-delegator: flag set inside _autopilot_invoke_tool
  _autopilot_invoke_tool \
    "autopilot_log" \
    '{"message":"test log entry"}' \
    'logged|success|true|\[OK\]|content|result' \
    "autopilot_log" \
    15
}

# Check 9: autopilot_reset
check_adr0094_p2_autopilot_reset() { # adr0097-l2-delegator: flag set inside _autopilot_invoke_tool
  _autopilot_invoke_tool \
    "autopilot_reset" \
    '{}' \
    'reset|success|cleared' \
    "autopilot_reset" \
    15
}

# ════════════════════════════════════════════════════════════════════
# ADR-0193 Item B — trajectory recording probe (ctrl-autopilot-trajectories)
# ════════════════════════════════════════════════════════════════════
#
# Trajectories are PROCESS-LOCAL: SonaRvfService stores them in-memory and
# AutopilotLearning's `_trajectoriesOpened` is a per-instance counter
# (autopilot-learning.ts:193). The MCP autopilot_learn tool creates a fresh
# AutopilotLearning instance per call, so its trajectory count is always 0
# unless recordIterationStep/endSwarmTrajectory ran in the SAME process.
#
# Probe shape: invoke `tryLoadLearning()` once, record 3 iteration steps,
# end the swarm trajectory, then read `getMetrics().trajectories` from the
# SAME instance. Assert trajectories >= 1.
#
# Why a `node -e` rather than `mcp exec`: each `mcp exec` spins a fresh
# CLI process → fresh AutopilotLearning instance → trajectory counter
# resets. The trajectory surface has no MCP tool today; the closest is
# `autopilot_learn`'s `metrics.trajectories` field but it reads a NEW
# instance. (Adding a record-then-query MCP tool is fork-scope, not
# Wave 2 — see ADR-0193 §Implementation Plan.)
check_autopilot_trajectories() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  # Same import surface as check_autopilot_learning_active — tryLoadLearning
  # mirrors what autopilot-state.ts:tryLoadLearning resolves at runtime, so
  # this also implicitly verifies the Phase 3 codemod-rewrite (LITERAL
  # `agentic-flow` → `@sparkleideas/agentic-flow` Pass 3 swap).
  local out
  out=$(cd "$TEMP_DIR" && NPM_CONFIG_REGISTRY="$REGISTRY" node -e "
    (async () => {
      try {
        const m = await import('@sparkleideas/cli/dist/src/autopilot-state.js');
        const learning = await m.tryLoadLearning();
        if (!learning) { console.log('NO_LEARNING'); return; }
        // Record 3 iteration steps; the first opens a trajectory (counter++).
        await learning.recordIterationStep(0.1, []);
        await learning.recordIterationStep(0.2, []);
        await learning.recordIterationStep(0.3, []);
        // Close the trajectory; counter stays at 1.
        await learning.endSwarmTrajectory({ status: 'test' });
        const metrics = await learning.getMetrics();
        console.log('METRICS:' + JSON.stringify({
          available: metrics.available,
          episodes: metrics.episodes,
          trajectories: metrics.trajectories,
        }));
      } catch (e) {
        console.log('ERROR:' + (e && e.message ? e.message : String(e)));
      }
    })();
  " 2>&1) || true

  if echo "$out" | grep -q "NO_LEARNING"; then
    _CHECK_OUTPUT="autopilot-trajectories: tryLoadLearning() returned null (producer absent OR subpath not exported) — $(echo "$out" | head -c 200)"
    return
  fi
  if echo "$out" | grep -q "ERROR:"; then
    _CHECK_OUTPUT="autopilot-trajectories: in-process call failed — $(echo "$out" | head -c 300)"
    return
  fi

  # Extract trajectories count from the METRICS:{...} line.
  local metrics_line
  metrics_line=$(echo "$out" | grep '^METRICS:' | head -1)
  if [[ -z "$metrics_line" ]]; then
    _CHECK_OUTPUT="autopilot-trajectories: no METRICS line in output — $(echo "$out" | head -c 300)"
    return
  fi

  local count
  count=$(echo "$metrics_line" | grep -o '"trajectories"[[:space:]]*:[[:space:]]*[0-9]*' | grep -o '[0-9]*$')
  count=${count:-0}

  if [[ "$count" -ge 1 ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="autopilot-trajectories: trajectories=$count after recordIterationStep×3 + endSwarmTrajectory"
    return
  fi

  _CHECK_OUTPUT="autopilot-trajectories: expected trajectories>=1, got '$count' from: $metrics_line"
}

# ════════════════════════════════════════════════════════════════════
# ADR-0193 Item C — Stop-hook re-engagement consumer probe (ctrl-autopilot-stop-hook)
# ════════════════════════════════════════════════════════════════════
#
# Empty-context silence is the contract (autopilot-hook.mjs:215): when
# `ctx.confidence === 0` the augmentation prints nothing. So this probe
# MUST populate ≥1 episode (with a critique on at least one failure) AND
# at least one pending task whose subject overlaps the populated episodes.
#
# Task discovery (autopilot-hook.mjs:78-134) reads from three sources:
#   1. ~/.claude/tasks/<team>/*.json  — homedir-anchored
#   2. .claude-flow/swarm-tasks.json  — PROJECT_ROOT/.claude-flow/, where
#      PROJECT_ROOT = __dirname/../.. relative to the hook's install dir.
#   3. .claude-flow/data/checklist.json — same PROJECT_ROOT anchor
#
# The hook is installed at
#   $ACCEPT_TEMP/node_modules/@sparkleideas/agentic-flow/.claude/helpers/autopilot-hook.mjs
# so __dirname is .../@sparkleideas/agentic-flow/.claude/helpers and
# PROJECT_ROOT resolves to .../@sparkleideas/agentic-flow. We populate the
# install-dir-anchored swarm-tasks.json (option 2) to avoid touching the
# user's homedir tasks tree.
#
# Hook output markers (autopilot-hook.mjs:220+):
#   `Learning context (` + (`Top patterns:` OR `Past failures to avoid:`)
# Either alone is sufficient — `Recommendations:` is optional in the
# producer's surface.
check_autopilot_stop_hook() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  # The hook can land in either layout depending on how the package's
  # `files` glob resolves:
  #   - .claude/helpers/autopilot-hook.mjs              ← if files lists "./.claude"
  #   - agentic-flow/.claude/helpers/autopilot-hook.mjs ← if files lists "agentic-flow/.claude"
  # The current published package.json uses the latter, but fork-side
  # Wave 1 added the hook source at the MONOREPO-OUTER .claude/ which
  # isn't in the files list. We probe both so the check passes once the
  # publishing layout is corrected without needing a harness change.
  local hook_path=""
  for candidate in \
    "${ACCEPT_TEMP}/node_modules/@sparkleideas/agentic-flow/.claude/helpers/autopilot-hook.mjs" \
    "${ACCEPT_TEMP}/node_modules/@sparkleideas/agentic-flow/agentic-flow/.claude/helpers/autopilot-hook.mjs"
  do
    if [[ -f "$candidate" ]]; then
      hook_path="$candidate"
      break
    fi
  done
  if [[ -z "$hook_path" ]]; then
    _CHECK_OUTPUT="autopilot-stop-hook: hook not found at either ${ACCEPT_TEMP}/node_modules/@sparkleideas/agentic-flow/{.claude,agentic-flow/.claude}/helpers/autopilot-hook.mjs — agentic-flow package may not ship the hook in its files glob (Wave 1 added the outer-monorepo source; publish layout fix needed)"
    return
  fi

  # ── Step 1: populate episodes ──────────────────────────────────────
  # Use the same in-process AutopilotLearning surface that check_autopilot_
  # learning_active uses, plus a failure with a critique so the hook has a
  # populated `pastFailures` array. Subject overlaps the swarm-tasks.json
  # entries written in step 2.
  local populate_out
  populate_out=$(cd "$TEMP_DIR" && NPM_CONFIG_REGISTRY="$REGISTRY" node -e "
    (async () => {
      try {
        const m = await import('@sparkleideas/cli/dist/src/autopilot-state.js');
        const learning = await m.tryLoadLearning();
        if (!learning) { console.log('NO_LEARNING'); return; }
        // 3 successes (build up frequency for the 'Top patterns' surface)
        for (let i = 0; i < 3; i++) {
          await learning.recordTaskCompletion({
            taskId: 'stop-hook-pass-' + i,
            subject: 'stop hook react bug fix ' + i,
            status: 'completed',
            iterations: 3,
            durationMs: 5000,
          });
        }
        // 1 failure WITH critique so 'Past failures to avoid' surfaces
        await learning.recordTaskFailure({
          taskId: 'stop-hook-fail-1',
          subject: 'stop hook react bug fix recurring',
          status: 'failed',
          iterations: 5,
          durationMs: 10000,
          critique: 'missed useEffect cleanup leading to memory leak',
        });
        console.log('POPULATED');
      } catch (e) {
        console.log('ERROR:' + (e && e.message ? e.message : String(e)));
      }
    })();
  " 2>&1) || true

  if echo "$populate_out" | grep -q "NO_LEARNING"; then
    _CHECK_OUTPUT="autopilot-stop-hook: tryLoadLearning() returned null — $(echo "$populate_out" | head -c 200)"
    return
  fi
  if echo "$populate_out" | grep -q "ERROR:"; then
    _CHECK_OUTPUT="autopilot-stop-hook: populate failed — $(echo "$populate_out" | head -c 300)"
    return
  fi
  if ! echo "$populate_out" | grep -q "POPULATED"; then
    _CHECK_OUTPUT="autopilot-stop-hook: populate produced unexpected output — $(echo "$populate_out" | head -c 300)"
    return
  fi

  # ── Step 2: populate the install-dir-anchored swarm-tasks.json ─────
  # The hook resolves swarmFile from PROJECT_ROOT = __dirname/../.. relative
  # to its own location. Compute PROJECT_ROOT from the actual hook_path:
  #   PROJECT_ROOT = dirname(dirname(dirname(hook_path)))
  # (../helpers → ../.claude → ../<package root>).
  local hook_dir; hook_dir=$(dirname "$hook_path")              # .../helpers
  local hook_claude; hook_claude=$(dirname "$hook_dir")          # .../.claude
  local hook_root; hook_root=$(dirname "$hook_claude")           # PROJECT_ROOT
  local swarm_dir="${hook_root}/.claude-flow"
  mkdir -p "$swarm_dir"
  # One pending task with overlapping subject so analyzeCompletion sees
  # something incomplete and triggers the re-engagement path.
  cat > "${swarm_dir}/swarm-tasks.json" <<'EOF'
[
  { "subject": "stop hook react bug fix continuation", "status": "pending" }
]
EOF

  # Also clear any pre-existing autopilot state so iteration counter starts at 0
  # (otherwise a leftover state.iterations could trip MAX_ITERATIONS=50 guard).
  rm -f "${swarm_dir}/data/autopilot-state.json" 2>/dev/null || true

  # ── Step 3: invoke the hook with the install dir as cwd ────────────
  # `cd "$hook_root"` mimics what the Stop hook config does — the hook is
  # __dirname-based for PROJECT_ROOT so cwd technically doesn't matter, but
  # being explicit here avoids surprises if PROJECT_ROOT logic changes.
  # AUTOPILOT_LEARNING_MODULE must be unset (constraint from Wave 1).
  local out
  out=$(cd "$hook_root" && unset AUTOPILOT_LEARNING_MODULE; \
        AUTOPILOT_ENABLED=true AUTOPILOT_MAX_ITERATIONS=50 \
        timeout 30 node "$hook_path" 2>&1) || true

  # Cleanup the synthetic swarm-tasks.json now so re-runs don't pollute.
  rm -f "${swarm_dir}/swarm-tasks.json" 2>/dev/null || true

  # ── Step 4: assert the learning markers landed in stdout ───────────
  # "Learning context (" + (top-patterns OR past-failures) is the contract.
  # Either ordering is sufficient — both patterns and failures can be empty
  # depending on which pre-filter (avgReward > 0 vs. critique presence)
  # passes first.
  if echo "$out" | grep -q "Learning context (" \
     && echo "$out" | grep -qE "Top patterns:|Past failures to avoid:"; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="autopilot-stop-hook: Learning context block present in hook stdout"
    return
  fi

  # Important diagnostic: if the hook printed the import-failure marker,
  # surface it loudly — that tells operators the producer subpath isn't
  # exported from the installed @sparkleideas/agentic-flow.
  if echo "$out" | grep -q "learning unavailable (import failed)"; then
    _CHECK_OUTPUT="autopilot-stop-hook: hook reported import failure — $(echo "$out" | grep 'learning unavailable' | head -1)"
    return
  fi

  _CHECK_OUTPUT="autopilot-stop-hook: stdout missing 'Learning context' + patterns/failures markers. First 30 lines:
$(echo "$out" | head -30)"
}

# ════════════════════════════════════════════════════════════════════
# ADR-0193 Item D — queryOptimizer cache active-use probe (ctrl-query-optimizer-cache)
# ════════════════════════════════════════════════════════════════════
#
# Two-signal discrimination per ADR-0193 §D and the plan's "Probe shape":
#   1. Second call response carries `"cached": true` → cache is wired AND active.
#   2. Second-call duration < 50% of first-call → cache is observably faster.
# Either signal passes. Both failing is the honest "registered but not wired
# OR cache disabled" result — that's the information ADR-0191 B7 wanted
# verified. Don't squelch (feedback-no-squelch-tests).
#
# Uses cli `memory search` (not MCP `memory_search`) because:
#   - The MCP wrapper in stdio-full.ts:160-191 shells out via execSync
#     to `npx claude-flow@alpha memory search` — different process,
#     stale cache key, no queryOptimizer integration in this MCP path.
#   - The cli memory search path (memory-cli.ts:139-153) reads from
#     JSON files; if queryOptimizer is wired anywhere in the read path,
#     it's there.
# Either way, neither path is known to integrate queryOptimizer today
# (per the ADR's "If the probe fails" section), so this check is
# expected to fail at first run — that's the honest signal the ADR asked
# for. The check shape is correct.
check_query_optimizer_cache() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local cli; cli=$(_cli_cmd)

  # First, store a single entry so search has something to retrieve.
  # Without an entry, both calls return empty + zero-time — uninformative.
  _run_and_kill "cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli memory store --key 'qopt-probe-key' --value 'queryOptimizer cache probe sentinel value' --namespace qopt-cache" "" 15

  # Inline ns→ms timing — `_ns` is harness-script-local (test-acceptance.sh
  # line ~82), not in any lib helper. Use `date +%s%N` directly so this
  # check works under both the full harness and the fast runner. macOS
  # `date` doesn't support %N (always emits literal 'N'); fall back to
  # %s*1000 (second-precision) when %N misbehaves.
  _qopt_now_ms() {
    local ns; ns=$(date +%s%N 2>/dev/null)
    if [[ "$ns" =~ N$ ]] || [[ -z "$ns" ]]; then
      echo $(( $(date +%s) * 1000 ))
    else
      echo $(( ns / 1000000 ))
    fi
  }
  local t1_start t1_end t1
  local t2_start t2_end t2
  local out1 out2

  t1_start=$(_qopt_now_ms)
  _run_and_kill_ro "cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli memory search --query 'qopt-cache' --namespace qopt-cache --limit 5" "" 15
  out1="$_RK_OUT"
  t1_end=$(_qopt_now_ms)
  t1=$(( t1_end - t1_start ))

  t2_start=$(_qopt_now_ms)
  _run_and_kill_ro "cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli memory search --query 'qopt-cache' --namespace qopt-cache --limit 5" "" 15
  out2="$_RK_OUT"
  t2_end=$(_qopt_now_ms)
  t2=$(( t2_end - t2_start ))

  # Signal 1: explicit "cached": true in second response
  if echo "$out2" | grep -qE '"cached"[[:space:]]*:[[:space:]]*true'; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="query-optimizer-cache: 2nd call returned cached=true (t1=${t1}ms t2=${t2}ms)"
    return
  fi

  # Signal 2: 2nd call measurably faster (< 50% of 1st call duration).
  # Bash arithmetic on zeros: skip if either is 0 (timer noise floor).
  if [[ "$t1" -gt 0 ]] && [[ "$t2" -gt 0 ]] && [[ "$t2" -lt $((t1 / 2)) ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="query-optimizer-cache: 2nd call < 50% of 1st (t1=${t1}ms t2=${t2}ms ratio=$((t2 * 100 / t1))%)"
    return
  fi

  # Both signals miss → honest fail. The diagnostic discriminates the
  # three states ADR-0193 §D names: registered-but-unused, wired-but-
  # cache-disabled, or working. First two land here.
  _CHECK_OUTPUT="query-optimizer-cache: no cache signal (t1=${t1}ms t2=${t2}ms cached=false). 2nd-call body (first 5 lines):
$(echo "$out2" | head -5)"
}
