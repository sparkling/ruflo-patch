# lib/acceptance-adr0238-checks.sh — ADR-0238 wire-or-remove trip-wires (6/8 surfaces).
#
# Wires Batch 3's ADR-0238 (wire-or-remove unused-surface remediation)
# trip-wires for the 6 actively-asserted surfaces. Surfaces 2 and 5 are
# omitted (closed by larger remediation tracks under ADR-0234 / ADR-0247).
#
# Per ADR-0233 second-pass §Per-ADR validation gates §Gate 3.

_FORK_RUFLO="/Users/henrik/source/forks/ruflo"

check_adr0238_surface1_aidefence_honest() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local f="${_FORK_RUFLO}/v3/@claude-flow/aidefence/src/index.ts"
  if [[ ! -f "$f" ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: aidefence/src/index.ts missing at ${f}"
    return
  fi

  if ! grep -q "Manual scan utility" "$f"; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: aidefence/src/index.ts missing 'Manual scan utility' honesty header"
    return
  fi

  local overclaims=("AI Manipulation Defense" "self-learning capabilities" "HNSW-indexed")
  local found=""
  for s in "${overclaims[@]}"; do
    if grep -qF "$s" "$f"; then
      found="${found} '${s}'"
    fi
  done
  if [[ -n "$found" ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: aidefence/src/index.ts still contains overclaim strings:${found}"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="aidefence/src/index.ts is honest (manual-scan utility; no overclaims)"
}

check_adr0238_surface3_telemetry_tools_deleted() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local cli_src="${_FORK_RUFLO}/v3/@claude-flow/cli/src"
  if [[ ! -d "$cli_src" ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: cli/src directory missing at ${cli_src}"
    return
  fi

  local hits
  hits=$(grep -rE "agentdb_telemetry_metrics|agentdb_telemetry_spans" "$cli_src" 2>/dev/null | wc -l | tr -d ' ')
  hits=${hits:-0}

  if [[ "$hits" -ne 0 ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: ${hits} reference(s) to deleted telemetry tools (agentdb_telemetry_metrics|_spans) still in cli/src"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="No references to deleted agentdb_telemetry_{metrics,spans} tools in cli/src"
}

check_adr0238_surface4_consensus_quarantine() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local f="${_FORK_RUFLO}/v3/@claude-flow/swarm/__tests__/no-new-consensus-imports.test.ts"
  if [[ ! -f "$f" ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: no-new-consensus-imports.test.ts arch-test missing"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="Consensus quarantine arch-test present (no-new-consensus-imports.test.ts)"
}

check_adr0238_surface6_paxos_removed() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local swarm_src="${_FORK_RUFLO}/v3/@claude-flow/swarm/src"
  if [[ ! -d "$swarm_src" ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: swarm/src directory missing at ${swarm_src}"
    return
  fi

  local hits
  hits=$(grep -rE "'paxos'" "$swarm_src" 2>/dev/null | wc -l | tr -d ' ')
  hits=${hits:-0}

  if [[ "$hits" -ne 0 ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: ${hits} 'paxos' literal(s) still present in swarm/src after ADR-0238 surface 6 removal"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="No 'paxos' string literals in swarm/src (per ADR-0238 surface 6)"
}

check_adr0238_surface7_weighted_consensus() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local f="${_FORK_RUFLO}/v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts"
  if [[ ! -f "$f" ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: hive-mind-tools.ts missing at ${f}"
    return
  fi

  if ! grep -q "'weighted'" "$f"; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: hive-mind-tools.ts consensus enum missing 'weighted' (ADR-0238 surface 7)"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="hive-mind-tools.ts consensus enum includes 'weighted'"
}

check_adr0238_surface8_advisory_frontmatter() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local dir="${_FORK_RUFLO}/v3/@claude-flow/cli/.claude/agents/consensus"
  if [[ ! -d "$dir" ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: consensus agents dir missing at ${dir}"
    return
  fi

  local count
  count=$(grep -lE "^advisory: true|^advisory:[[:space:]]+true" "$dir"/*.md 2>/dev/null | wc -l | tr -d ' ')
  count=${count:-0}

  if [[ "$count" -lt 6 ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: only ${count} of ≥6 consensus agent .md files carry 'advisory: true' frontmatter"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="${count} consensus agent .md files carry 'advisory: true' frontmatter (≥6 required)"
}
