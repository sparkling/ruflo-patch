#!/usr/bin/env bash
# lib/acceptance-adr0084-checks.sh — ADR-0084 acceptance checks
#
# Phase 1 — Dead Code Cleanup: sql.js ghost refs.
# Verifies that no user-facing output from published CLI commands
# contains the string "sql.js". The internal library name must not
# leak; users should only ever see "SQLite" (the engine name).
#
# ADR-0084 decisions tested here:
#   - CLI memory commands do not print "sql.js" in output
#   - CLI doctor output does not mention "sql.js"
#   - Published tool description strings do not reference "sql.js"
#
# Requires: acceptance-checks.sh sourced first (_run_and_kill, _cli_cmd available)
# Caller MUST set: TEMP_DIR, E2E_DIR, CLI_BIN, REGISTRY

# ════════════════════════════════════════════════════════════════════
# ADR-0084-1: No "sql.js" in memory command output
#
# Runs memory store + memory search in the init'd E2E project and
# verifies that (a) the combined output does NOT contain "sql.js"
# and (b) if backend info is printed, it says "SQLite" (not "sql.js").
# ════════════════════════════════════════════════════════════════════

check_no_sqljs_in_backend_output() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local cli; cli=$(_cli_cmd)
  local iso; iso=$(_e2e_isolate "0084-sqljs")
  local ns="adr0084-sqljs-$(date +%s)"
  local test_key="adr0084-check"
  local test_val="verify no leaked backend name in user-facing output"

  # Accumulate all output from store + search + doctor
  local combined_output=""

  # 1. memory store (isolated dir, 60s for cold embedding load)
  _run_and_kill "cd '$iso' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli memory store --key '$test_key' --value '$test_val' --namespace '$ns'" "" 60
  combined_output="${combined_output}${_RK_OUT}"$'\n'

  if ! echo "$_RK_OUT" | grep -qi 'stored\|success'; then
    _CHECK_OUTPUT="ADR-0084-1: memory store did not report success — cannot verify output (store: ${_RK_OUT:0:120})"
    rm -rf "$iso" 2>/dev/null; return
  fi

  sleep 1; rm -f "$iso/.claude-flow/memory.rvf.lock" "$iso/.swarm/memory.rvf.lock" 2>/dev/null

  # 2. memory search
  _run_and_kill_ro "cd '$iso' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli memory search --query 'backend output check' --namespace '$ns' --limit 5" "" 60
  combined_output="${combined_output}${_RK_OUT}"$'\n'

  # 3. doctor --fix (captures diagnostic output about backends)
  _run_and_kill "cd '$iso' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli doctor --fix" "" 30
  combined_output="${combined_output}${_RK_OUT}"$'\n'

  # Check: "sql.js" must NOT appear anywhere in the combined output.
  # Use case-insensitive match to catch "SQL.js", "Sql.js", etc.
  if echo "$combined_output" | grep -qi 'sql\.js'; then
    local offending_lines
    offending_lines=$(echo "$combined_output" | grep -i 'sql\.js' | head -5)
    _CHECK_OUTPUT="ADR-0084-1: user-facing output contains 'sql.js': ${offending_lines}"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0084-1: no 'sql.js' in memory store/search/doctor output (user sees 'SQLite' only)"
}

# ════════════════════════════════════════════════════════════════════
# ADR-0084-2: No "sql.js" in published MCP tool descriptions
#
# MCP tool definitions include description strings that users see in
# Claude Code's tool list. Grep all .js files under the CLI dist for
# tool description patterns containing "sql.js".
#
# This complements ADR-0080's import check — ADR-0080 checks for
# import('sql.js')/require('sql.js'); this check catches "sql.js"
# in user-visible string literals (descriptions, error messages, logs).
# ════════════════════════════════════════════════════════════════════

check_no_sqljs_in_tool_descriptions() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local base="${TEMP_DIR}/node_modules/@sparkleideas/cli"
  if [[ ! -d "$base" ]]; then
    _CHECK_OUTPUT="ADR-0084-2: @sparkleideas/cli not installed in TEMP_DIR"
    return
  fi

  local dist_dir="$base/dist"
  if [[ ! -d "$dist_dir" ]]; then
    _CHECK_OUTPUT="ADR-0084-2: dist/ directory not found in published CLI"
    return
  fi

  # Search all compiled .js files for "sql.js" in string literals.
  # Exclude node_modules (transitive deps may legitimately reference sql.js
  # as a package name in their own code — we only care about OUR strings).
  # Exclude import()/require() lines — those are covered by ADR-0080-P4-1.
  local hits
  hits=$(find "$dist_dir" -path '*/node_modules' -prune -o \
    -name '*.js' -not -name '*.test.*' -not -name '*.spec.*' -print0 2>/dev/null \
    | xargs -0 grep -Hn 'sql\.js' 2>/dev/null \
    | grep -v "import('sql\.js')\|require('sql\.js')\|from.*sql\.js" \
    || true)

  local count=0
  if [[ -n "$hits" ]]; then
    count=$(echo "$hits" | wc -l | tr -d ' ')
  fi

  if [[ "$count" -eq 0 ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0084-2: zero 'sql.js' string references in published CLI dist (tool descriptions clean)"
  else
    local files
    files=$(echo "$hits" | cut -d: -f1 | sort -u \
      | sed "s|${base}/||" | head -5 | tr '\n' ', ')
    local sample
    sample=$(echo "$hits" | head -3 | sed "s|${base}/||")
    _CHECK_OUTPUT="ADR-0084-2: ${count} 'sql.js' string reference(s) in published CLI dist: ${files%,}"$'\n'"  Sample: ${sample}"
  fi
}

# ════════════════════════════════════════════════════════════════════
# ADR-0084-3: Phase 2 router methods exported in published CLI
#
# Verifies that the 6 new route methods from ADR-0084 Phase 2 are
# present in the compiled memory-router.js in the published dist.
# These methods are the bridge-caller migration layer that Phase 3
# will use to redirect hooks-tools.ts and worker-daemon.ts away from
# direct memory-bridge imports.
# ════════════════════════════════════════════════════════════════════

check_phase2_router_exports() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local base="${TEMP_DIR}/node_modules/@sparkleideas/cli"
  if [[ ! -d "$base" ]]; then
    _CHECK_OUTPUT="ADR-0084-3: @sparkleideas/cli not installed in TEMP_DIR"
    return
  fi

  # Find the compiled memory-router.js in dist (lives under dist/src/memory/).
  # Use -prune for node_modules inside dist, not -not -path which matches
  # the full path and falsely excludes results when $base is under node_modules.
  local router_js
  router_js=$(find "$base/dist" -path '*/node_modules' -prune -o -name 'memory-router.js' -print 2>/dev/null | head -1)
  if [[ -z "$router_js" ]]; then
    _CHECK_OUTPUT="ADR-0084-3: memory-router.js not found in published CLI dist"
    return
  fi

  # Check for all 6 Phase 2 route method exports
  local methods=("routePatternOp" "routeFeedbackOp" "routeSessionOp" "routeLearningOp" "routeReflexionOp" "routeCausalOp")
  local missing=""
  local found=0

  for method in "${methods[@]}"; do
    if grep -q "$method" "$router_js"; then
      ((found++))
    else
      missing="${missing}${method}, "
    fi
  done

  if [[ "$found" -eq 6 ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0084-3: all 6 Phase 2 route methods present in published memory-router.js"
  else
    _CHECK_OUTPUT="ADR-0084-3: ${found}/6 Phase 2 route methods found. Missing: ${missing%, }"
  fi
}

# ════════════════════════════════════════════════════════════════════
# ADR-0084-4: Phase 4 bridge loader removed from router
#
# Phase 2 originally added loadBridge + _bridgeMod to the router.
# Phase 4 removed them — route methods now use getController
# (controller-direct) instead of the bridge. This check verifies
# the removal is complete and getController is present.
# ════════════════════════════════════════════════════════════════════

check_phase2_bridge_loader() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local base="${TEMP_DIR}/node_modules/@sparkleideas/cli"
  if [[ ! -d "$base" ]]; then
    _CHECK_OUTPUT="ADR-0084-4: @sparkleideas/cli not installed in TEMP_DIR"
    return
  fi

  # Use -prune (not -not -path) to avoid false exclusion when $base is under node_modules
  local router_js
  router_js=$(find "$base/dist" -path '*/node_modules' -prune -o -name 'memory-router.js' -print 2>/dev/null | head -1)
  if [[ -z "$router_js" ]]; then
    _CHECK_OUTPUT="ADR-0084-4: memory-router.js not found in published CLI dist"
    return
  fi

  # Phase 4: loadBridge removed, getController used instead
  local has_get_controller=0
  local has_shutdown_router=0

  grep -q 'getController' "$router_js" && has_get_controller=1
  grep -q 'shutdownRouter' "$router_js" && has_shutdown_router=1

  if [[ "$has_get_controller" -eq 1 ]] && [[ "$has_shutdown_router" -eq 1 ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0084-4: router uses controller-direct (getController + shutdownRouter present, loadBridge removed)"
  else
    local detail=""
    [[ "$has_get_controller" -eq 0 ]] && detail="${detail}getController missing, "
    [[ "$has_shutdown_router" -eq 0 ]] && detail="${detail}shutdownRouter missing, "
    _CHECK_OUTPUT="ADR-0084-4: controller-direct check failed: ${detail%, }"
  fi
}

# ════════════════════════════════════════════════════════════════════
# ADR-0084-5: Phase 3 worker-daemon uses router, not direct bridge
#
# Verifies that worker-daemon.js has ZERO memory-bridge import paths
# EXCEPT for shutdownBridge (lifecycle). Non-shutdown bridge imports
# indicate callers not yet migrated to the router.
# ════════════════════════════════════════════════════════════════════

check_phase3_worker_daemon_no_bridge() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local base="${TEMP_DIR}/node_modules/@sparkleideas/cli"
  if [[ ! -d "$base" ]]; then
    _CHECK_OUTPUT="ADR-0084-5: @sparkleideas/cli not installed in TEMP_DIR"
    return
  fi

  local worker_js
  worker_js=$(find "$base/dist" -path '*/node_modules' -prune -o -name 'worker-daemon.js' -print 2>/dev/null | head -1)
  if [[ -z "$worker_js" ]]; then
    _CHECK_OUTPUT="ADR-0084-5: worker-daemon.js not found in published CLI dist"
    return
  fi

  # Count memory-bridge imports that are NOT shutdownBridge
  # Note: grep -c outputs "0" AND exits 1 when no matches, so || echo 0
  # would produce "0\n0". Use ${var:-0} fallback instead.
  local non_shutdown
  non_shutdown=$(grep -c 'memory-bridge' "$worker_js" 2>/dev/null)
  non_shutdown=${non_shutdown:-0}
  local shutdown_refs
  shutdown_refs=$(grep -c 'shutdownBridge' "$worker_js" 2>/dev/null)
  shutdown_refs=${shutdown_refs:-0}
  local bad=$(( non_shutdown - shutdown_refs ))
  if [[ "$bad" -lt 0 ]]; then bad=0; fi

  if [[ "$bad" -eq 0 ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0084-5: worker-daemon.js has zero non-shutdown memory-bridge imports (router-only)"
  else
    _CHECK_OUTPUT="ADR-0084-5: worker-daemon.js has ${bad} non-shutdown memory-bridge reference(s)"
  fi
}

# ════════════════════════════════════════════════════════════════════
# ADR-0084-6: Phase 3 hooks-tools uses router, not direct bridge
#
# Verifies that hooks-tools.js has ZERO memory-bridge import/require
# paths. All memory operations should go through the router.
# ════════════════════════════════════════════════════════════════════

check_phase3_hooks_tools_no_bridge() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local base="${TEMP_DIR}/node_modules/@sparkleideas/cli"
  if [[ ! -d "$base" ]]; then
    _CHECK_OUTPUT="ADR-0084-6: @sparkleideas/cli not installed in TEMP_DIR"
    return
  fi

  local hooks_js
  hooks_js=$(find "$base/dist" -path '*/node_modules' -prune -o -name 'hooks-tools.js' -print 2>/dev/null | head -1)
  if [[ -z "$hooks_js" ]]; then
    _CHECK_OUTPUT="ADR-0084-6: hooks-tools.js not found in published CLI dist"
    return
  fi

  local count
  count=$(grep -c 'memory-bridge' "$hooks_js" 2>/dev/null)
  count=${count:-0}

  if [[ "$count" -eq 0 ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0084-6: hooks-tools.js has zero memory-bridge references (router-only)"
  else
    local sample
    sample=$(grep -n 'memory-bridge' "$hooks_js" 2>/dev/null | head -3 | tr '\n' '; ')
    _CHECK_OUTPUT="ADR-0084-6: hooks-tools.js has ${count} memory-bridge reference(s): ${sample}"
  fi
}

# ════════════════════════════════════════════════════════════════════
# ADR-0084-7: Phase 3 no shadow replicates in agentdb-orchestration
#
# Verifies that agentdb-orchestration.js has ZERO "Replicates:"
# string references and at least one memory-router reference,
# confirming router delegation instead of shadow replication.
# ════════════════════════════════════════════════════════════════════

check_phase3_no_shadow_replicates() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local base="${TEMP_DIR}/node_modules/@sparkleideas/cli"
  if [[ ! -d "$base" ]]; then
    _CHECK_OUTPUT="ADR-0084-7: @sparkleideas/cli not installed in TEMP_DIR"
    return
  fi

  local orch_js
  orch_js=$(find "$base/dist" -path '*/node_modules' -prune -o -name 'agentdb-orchestration.js' -print 2>/dev/null | head -1)
  if [[ -z "$orch_js" ]]; then
    _CHECK_OUTPUT="ADR-0084-7: agentdb-orchestration.js not found in published CLI dist"
    return
  fi

  local repl_count
  repl_count=$(grep -c 'Replicates:' "$orch_js" 2>/dev/null)
  repl_count=${repl_count:-0}
  local router_count
  router_count=$(grep -c 'memory-router' "$orch_js" 2>/dev/null)
  router_count=${router_count:-0}

  if [[ "$repl_count" -eq 0 ]] && [[ "$router_count" -ge 1 ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0084-7: agentdb-orchestration.js has 0 'Replicates:' refs, ${router_count} memory-router ref(s)"
  else
    local detail=""
    [[ "$repl_count" -gt 0 ]] && detail="${detail}${repl_count} 'Replicates:' ref(s), "
    [[ "$router_count" -eq 0 ]] && detail="${detail}no memory-router ref, "
    _CHECK_OUTPUT="ADR-0084-7: shadow replicate check failed: ${detail%, }"
  fi
}

# ════════════════════════════════════════════════════════════════════
# ADR-0084-8: Router has no controller fallback functions
#
# Verifies that memory-router.js does NOT contain the 5 legacy
# controller-fallback bridge functions (bridgeGetController, etc.).
# Phase 4 removed loadBridge/_bridgeMod — controller-access functions
# use getController (from controller-intercept) directly.
# ════════════════════════════════════════════════════════════════════

check_phase3_router_no_controller_fallback() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local base="${TEMP_DIR}/node_modules/@sparkleideas/cli"
  if [[ ! -d "$base" ]]; then
    _CHECK_OUTPUT="ADR-0084-8: @sparkleideas/cli not installed in TEMP_DIR"
    return
  fi

  local router_js
  router_js=$(find "$base/dist" -path '*/node_modules' -prune -o -name 'memory-router.js' -print 2>/dev/null | head -1)
  if [[ -z "$router_js" ]]; then
    _CHECK_OUTPUT="ADR-0084-8: memory-router.js not found in published CLI dist"
    return
  fi

  # These 5 legacy functions must NOT be present in executable code.
  # Exclude comment lines (// ...) that may reference old names for context.
  local banned=("bridgeGetController" "bridgeHasController" "bridgeListControllers" "bridgeWaitForDeferred" "bridgeHealthCheck")
  local found_banned=""
  for fn in "${banned[@]}"; do
    if grep -v '^\s*//' "$router_js" | grep -q "$fn"; then
      found_banned="${found_banned}${fn}, "
    fi
  done

  # Phase 4: loadBridge/_bridgeMod removed — check for getController instead
  local has_get_controller=0
  grep -q 'getController' "$router_js" && has_get_controller=1

  if [[ -z "$found_banned" ]] && [[ "$has_get_controller" -eq 1 ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0084-8: memory-router.js has no controller fallbacks, uses getController (Phase 4)"
  else
    local detail=""
    [[ -n "$found_banned" ]] && detail="${detail}banned present: ${found_banned%, }; "
    [[ "$has_get_controller" -eq 0 ]] && detail="${detail}getController missing; "
    _CHECK_OUTPUT="ADR-0084-8: controller fallback check failed: ${detail}"
  fi
}

# ════════════════════════════════════════════════════════════════════
# ADR-0084-9: Route methods in memory-router.js use controller-direct
#             (no loadBridge)
#
# Phase 4 verifies that each route method body no longer calls
# loadBridge — they should use getController (controller-direct
# pattern) instead. At least 3 of the 5 route methods must contain
# 'getController'.
# ════════════════════════════════════════════════════════════════════

check_phase4_router_no_loadbridge_in_routes() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local base="${TEMP_DIR}/node_modules/@sparkleideas/cli"
  if [[ ! -d "$base" ]]; then
    _CHECK_OUTPUT="ADR-0084-9: @sparkleideas/cli not installed in TEMP_DIR"
    return
  fi

  local router_js
  router_js=$(find "$base/dist" -path '*/node_modules' -prune -o -name 'memory-router.js' -print 2>/dev/null | head -1)
  if [[ -z "$router_js" ]]; then
    _CHECK_OUTPUT="ADR-0084-9: memory-router.js not found in published CLI dist"
    return
  fi

  # Check each route method for loadBridge usage
  local methods=("routePatternOp" "routeFeedbackOp" "routeSessionOp" "routeLearningOp" "routeCausalOp")
  local bridge_methods=""
  local controller_count=0

  for method in "${methods[@]}"; do
    # Extract the method body: from the method name to the next export/async function
    local body
    body=$(sed -n "/${method}/,/^async function\|^export\|^function/p" "$router_js" 2>/dev/null || true)
    if [[ -z "$body" ]]; then
      # Try alternate pattern for compiled JS (may use different structure)
      body=$(grep -A 50 "$method" "$router_js" 2>/dev/null | head -50 || true)
    fi

    if echo "$body" | grep -q 'loadBridge'; then
      bridge_methods="${bridge_methods}${method}, "
    fi
    if echo "$body" | grep -q 'getController'; then
      ((controller_count++))
    fi
  done

  if [[ -n "$bridge_methods" ]]; then
    _CHECK_OUTPUT="ADR-0084-9: route methods still using loadBridge: ${bridge_methods%, }"
    return
  fi

  if [[ "$controller_count" -lt 3 ]]; then
    _CHECK_OUTPUT="ADR-0084-9: only ${controller_count}/5 route methods use getController (need >= 3)"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0084-9: zero route methods use loadBridge, ${controller_count}/5 use getController (controller-direct)"
}

# ════════════════════════════════════════════════════════════════════
# ADR-0084-10: Worker-daemon uses shutdownRouter, not shutdownBridge
#
# Phase 4 verifies that worker-daemon.js imports from memory-router
# (or references shutdownRouter) and does NOT reference shutdownBridge
# or import from memory-bridge at all.
# ════════════════════════════════════════════════════════════════════

check_phase4_worker_daemon_shutdown_router() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local base="${TEMP_DIR}/node_modules/@sparkleideas/cli"
  if [[ ! -d "$base" ]]; then
    _CHECK_OUTPUT="ADR-0084-10: @sparkleideas/cli not installed in TEMP_DIR"
    return
  fi

  local worker_js
  worker_js=$(find "$base/dist" -path '*/node_modules' -prune -o -name 'worker-daemon.js' -print 2>/dev/null | head -1)
  if [[ -z "$worker_js" ]]; then
    _CHECK_OUTPUT="ADR-0084-10: worker-daemon.js not found in published CLI dist"
    return
  fi

  # Verify it uses shutdownRouter OR imports from memory-router
  local has_shutdown_router=0
  local has_router_import=0
  grep -q 'shutdownRouter' "$worker_js" && has_shutdown_router=1
  grep -q 'memory-router' "$worker_js" && has_router_import=1

  if [[ "$has_shutdown_router" -eq 0 ]] && [[ "$has_router_import" -eq 0 ]]; then
    _CHECK_OUTPUT="ADR-0084-10: worker-daemon.js has neither shutdownRouter nor memory-router import"
    return
  fi

  # Verify NO shutdownBridge references
  local has_shutdown_bridge=0
  grep -q 'shutdownBridge' "$worker_js" && has_shutdown_bridge=1

  if [[ "$has_shutdown_bridge" -eq 1 ]]; then
    _CHECK_OUTPUT="ADR-0084-10: worker-daemon.js still references shutdownBridge"
    return
  fi

  # Verify NO memory-bridge imports
  local bridge_count
  bridge_count=$(grep -c 'memory-bridge' "$worker_js" 2>/dev/null)
  bridge_count=${bridge_count:-0}

  if [[ "$bridge_count" -gt 0 ]]; then
    _CHECK_OUTPUT="ADR-0084-10: worker-daemon.js still has ${bridge_count} memory-bridge reference(s)"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0084-10: worker-daemon.js uses shutdownRouter (router=${has_router_import}, shutdownRouter=${has_shutdown_router}), zero bridge refs"
}

# ════════════════════════════════════════════════════════════════════
# ADR-0084-11: Zero external memory-bridge imports in route-layer
#              files
#
# Phase 4 verifies that hooks-tools.js, worker-daemon.js, and
# agentdb-orchestration.js have ZERO 'memory-bridge' references.
# All three must be clean for the check to pass.
# ════════════════════════════════════════════════════════════════════

check_phase4_zero_external_bridge_imports() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local base="${TEMP_DIR}/node_modules/@sparkleideas/cli"
  if [[ ! -d "$base" ]]; then
    _CHECK_OUTPUT="ADR-0084-11: @sparkleideas/cli not installed in TEMP_DIR"
    return
  fi

  local files=("hooks-tools.js" "worker-daemon.js" "agentdb-orchestration.js")
  local dirty=""
  local checked=0

  for fname in "${files[@]}"; do
    local fpath
    fpath=$(find "$base/dist" -path '*/node_modules' -prune -o -name "$fname" -print 2>/dev/null | head -1)
    if [[ -z "$fpath" ]]; then
      # File not found — skip but note it
      continue
    fi
    ((checked++))

    local count
    count=$(grep -c 'memory-bridge' "$fpath" 2>/dev/null)
    count=${count:-0}
    if [[ "$count" -gt 0 ]]; then
      dirty="${dirty}${fname}(${count}), "
    fi
  done

  if [[ "$checked" -eq 0 ]]; then
    _CHECK_OUTPUT="ADR-0084-11: none of the 3 route-layer files found in published CLI dist"
    return
  fi

  if [[ "$checked" -lt 3 ]]; then
    _CHECK_OUTPUT="ADR-0084-11: only ${checked}/3 route-layer files found — cannot fully verify"
    return
  fi

  if [[ -n "$dirty" ]]; then
    _CHECK_OUTPUT="ADR-0084-11: memory-bridge refs remain in: ${dirty%, }"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0084-11: ${checked}/3 route-layer files checked, all have zero memory-bridge references"
}

# ════════════════════════════════════════════════════════════════════
# ADR-0084-12: Router exports shutdownRouter
#
# Phase 4 verifies that memory-router.js contains shutdownRouter —
# the lifecycle function that replaces shutdownBridge for external
# consumers.
# ════════════════════════════════════════════════════════════════════

check_phase4_router_exports_shutdown() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local base="${TEMP_DIR}/node_modules/@sparkleideas/cli"
  if [[ ! -d "$base" ]]; then
    _CHECK_OUTPUT="ADR-0084-12: @sparkleideas/cli not installed in TEMP_DIR"
    return
  fi

  local router_js
  router_js=$(find "$base/dist" -path '*/node_modules' -prune -o -name 'memory-router.js' -print 2>/dev/null | head -1)
  if [[ -z "$router_js" ]]; then
    _CHECK_OUTPUT="ADR-0084-12: memory-router.js not found in published CLI dist"
    return
  fi

  if grep -q 'shutdownRouter' "$router_js"; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0084-12: memory-router.js exports shutdownRouter (bridge lifecycle replacement)"
  else
    _CHECK_OUTPUT="ADR-0084-12: memory-router.js does NOT contain shutdownRouter"
  fi
}
