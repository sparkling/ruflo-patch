# lib/acceptance-adr0147-r6-causal-query.sh — ADR-0147 R6 + RVF symmetry
#
# Wraps the node:test acceptance test that verifies:
#   (a) R6 — causal_query returns canary edges past the broken first-100-cap
#       (read-arm fallback uses keyPrefix scan for cause=, namespace-size scan
#        for effect=)
#   (b) RVF symmetry — writes persist across MCP server processes (the test
#        spawns one `cli mcp exec` per insert; without symmetric metadataPath,
#        each fresh process loads stale `.meta` and writes are invisible)
#
# Runs against the freshly-published cli on Verdaccio (post-publish phase).
# Test self-skips with SKIP_ACCEPTED if Verdaccio unreachable.

# shellcheck disable=SC2034  # _CHECK_PASSED set as a side-effect of the check function

check_adr0147_r6_causal_query() {
  local start_ns end_ns
  start_ns=$(_ns)
  _CHECK_PASSED="false"

  local test_dir="${PROJECT_DIR}/tests/acceptance"
  local test_file="${test_dir}/adr0147-r6-causal-query-post-wipe.test.mjs"
  if [[ ! -f "$test_file" ]]; then
    _CHECK_OUTPUT="adr0147-r6: test file missing at ${test_file}"
    end_ns=$(_ns); _EXIT=1; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
    return
  fi

  # macOS BSD mktemp doesn't substitute X's unless they're the LAST chars of
  # the template. With ".log" suffix the X's are NOT last → mktemp returns
  # the literal filename, which collides on repeated pipeline runs ("File
  # exists" error and an empty log_file). Rename trick: mktemp with X's at
  # end, then add the .log suffix.
  local log_file _tmp
  _tmp=$(mktemp /tmp/adr0147-r6-acceptance-XXXXXX)
  log_file="${_tmp}.log"
  mv "$_tmp" "$log_file" 2>/dev/null || log_file="$_tmp"

  # Run via test-runner so any future tests/acceptance/*.test.mjs get picked
  # up automatically. The runner scans the directory and forwards to
  # `node --test` with --test-timeout=120000 (default), but each it() carries
  # its own {timeout:600_000} so the heavy E2E inserts/queries aren't truncated.
  if node "${PROJECT_DIR}/scripts/test-runner.mjs" "$test_dir" > "$log_file" 2>&1; then
    _CHECK_PASSED="true"
    local pass_count
    pass_count=$(grep -cE "^✔ " "$log_file" 2>/dev/null)
    pass_count=${pass_count:-0}
    _CHECK_OUTPUT="adr0147-r6 PASS — ${pass_count} test(s) green. Log: ${log_file}"
    end_ns=$(_ns); _EXIT=0; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
    return
  fi

  # Failure path — surface the assertion message + log path.
  local failure_excerpt
  failure_excerpt=$(grep -B 1 -A 8 "AssertionError\|^✖" "$log_file" 2>/dev/null | head -60)
  _CHECK_OUTPUT="adr0147-r6 FAIL — see ${log_file}
${failure_excerpt}"
  end_ns=$(_ns); _EXIT=1; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
}
