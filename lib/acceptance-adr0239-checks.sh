#!/usr/bin/env bash
# lib/acceptance-adr0239-checks.sh
#
# ADR-0239 release-gate acceptance checks. Two layers per the ADR
# Decision §Cluster 8 + DA amendment:
#
#   (i)  Per-cluster arch-tests — already enforced by the fork test
#        suites (cluster1/cluster23/cluster4c/cluster5a/cluster7
#        *-arch.test.ts files). This file does NOT re-run them; the
#        per-fork `npm test` does.
#   (ii) Scoped unused-export counter — `ts-prune` over
#        forks/{ruflo,agentdb,ruvector}/**/src/, capped at
#        config/dead-code-cap.json's stored figure. Implemented in
#        scripts/lint-no-new-dead-code.mjs (uses Node's execFileSync
#        timeout = direct `timeout`-equivalent per E5 amendment;
#        NOT `_run_and_kill` whose `_RK_EXIT` is unreliable per
#        [[feedback-run-and-kill-exit-code]]).
#
# Functions exported (sourced by harness + fast-runner):
#   check_adr0239_arch_tests_present     — sanity check: arch-test files exist
#   check_adr0239_no_new_dead_code       — the counter-cap gate
#   check_adr0239_cap_file_committed     — cap file present + parseable
#
# Per [[reference-acceptance-runcheck-vs-collect]], the check_* names
# below must ALSO be registered in any caller's `collect_parallel`
# spec list — otherwise the check runs but is silently uncounted.

check_adr0239_arch_tests_present() {
  _CHECK_OUTPUT=""
  _CHECK_PASSED="false"

  local ruflo_dir="/Users/henrik/source/forks/ruflo"
  local agentdb_dir="/Users/henrik/source/forks/agentdb"

  local missing=""
  local expected=(
    "${ruflo_dir}/v3/@claude-flow/cli/__tests__/arch/adr0239-cluster1.arch.test.ts"
    "${ruflo_dir}/v3/@claude-flow/cli/__tests__/arch/adr0239-cluster23.arch.test.ts"
    "${ruflo_dir}/v3/@claude-flow/cli/__tests__/arch/adr0239-cluster4c.arch.test.ts"
    "${ruflo_dir}/v3/@claude-flow/cli/__tests__/arch/adr0239-cluster5a.arch.test.ts"
    "${ruflo_dir}/v3/@claude-flow/cli/__tests__/arch/adr0239-cluster7.arch.test.ts"
    "${ruflo_dir}/v3/@claude-flow/memory/src/adr0239-cluster4a-cve-loader.arch.test.ts"
    "${agentdb_dir}/tests/unit/adr0239-cluster4c.arch.test.ts"
  )

  for f in "${expected[@]}"; do
    if [[ ! -f "$f" ]]; then
      missing="${missing}${f}\n"
    fi
  done

  if [[ -n "$missing" ]]; then
    _CHECK_OUTPUT="missing arch-test files:\n${missing}"
    _CHECK_PASSED="false"
    return
  fi

  _CHECK_OUTPUT="7 per-cluster arch-tests present (cluster1/4a/4c/5a/7/23 in ruflo + cluster4c in agentdb)"
  _CHECK_PASSED="true"
}

check_adr0239_cap_file_committed() {
  _CHECK_OUTPUT=""
  _CHECK_PASSED="false"

  local cap_file="${PROJECT_DIR}/config/dead-code-cap.json"
  if [[ ! -f "$cap_file" ]]; then
    _CHECK_OUTPUT="config/dead-code-cap.json absent. Run: node scripts/lint-no-new-dead-code.mjs --baseline (and commit the result)."
    _CHECK_PASSED="false"
    return
  fi

  # Use node to parse (no jq dep). Fail if not valid JSON.
  local parsed
  parsed=$(node -e "const c = JSON.parse(require('fs').readFileSync('${cap_file}', 'utf-8')); if (!c.baselinedAt) { console.error('baselinedAt missing'); process.exit(1); } console.log('ok');" 2>&1)
  if [[ "$parsed" != "ok" ]]; then
    _CHECK_OUTPUT="cap file unparseable or missing baselinedAt: ${parsed}"
    _CHECK_PASSED="false"
    return
  fi

  _CHECK_OUTPUT="cap file present and parseable"
  _CHECK_PASSED="true"
}

check_adr0239_no_new_dead_code() {
  _CHECK_OUTPUT=""
  _CHECK_PASSED="false"

  local script="${PROJECT_DIR}/scripts/lint-no-new-dead-code.mjs"
  if [[ ! -x "$script" ]]; then
    _CHECK_OUTPUT="scanner script missing or not executable: ${script}"
    _CHECK_PASSED="false"
    return
  fi

  local cap_file="${PROJECT_DIR}/config/dead-code-cap.json"
  if [[ ! -f "$cap_file" ]]; then
    # First-run mode: baseline doesn't exist yet. Per ADR-0090 Tier A2
    # three-way discipline, this is a legit `skip_accepted` (no
    # baseline to compare against) — NOT a false PASS.
    _CHECK_OUTPUT="cap file not yet baselined; run --baseline once before enabling the gate"
    _CHECK_PASSED="skip_accepted"
    return
  fi

  # E5 amendment: direct `timeout` invocation (NOT _run_and_kill).
  local output exit_code
  output=$(timeout 180 node "$script" 2>&1)
  exit_code=$?

  if [[ $exit_code -eq 0 ]]; then
    # Extract the per-fork lines so the verdict is readable.
    local summary
    summary=$(echo "$output" | grep -E '^\s+(ruflo|agentdb|ruvector):' | tr '\n' ';' | sed 's/  */ /g')
    _CHECK_OUTPUT="cap-check passed; ${summary}"
    _CHECK_PASSED="true"
  elif [[ $exit_code -eq 1 ]]; then
    # Gate fail-red: new dead exports above cap.
    local fail_line
    fail_line=$(echo "$output" | grep -E '^\[adr0239-cluster8\] FAIL:' | head -1)
    _CHECK_OUTPUT="cap-check FAILED: ${fail_line}"
    _CHECK_PASSED="false"
  else
    # Scanner error (exit 2 or other).
    _CHECK_OUTPUT="scanner error (exit=${exit_code}): $(echo "$output" | tail -3 | tr '\n' '|')"
    _CHECK_PASSED="false"
  fi
}
