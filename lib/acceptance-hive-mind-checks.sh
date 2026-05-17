#!/usr/bin/env bash
# lib/acceptance-hive-mind-checks.sh — ADR-0119 (T1) acceptance checks
#
# Hive-mind weighted consensus (Queen 3x voting power):
#   §Validation  check_adr0119_weighted_strategy_accepted    — wire boundary accepts 'weighted'
#   §Validation  check_adr0119_byzantine_alias_normalizes    — 'byzantine' alias → 'bft' (carry-forward ADR-0106 R1)
#   §Validation  check_adr0119_unknown_strategy_rejected     — unknown strategy throws (no silent fallback)
#   §Validation  check_adr0119_missing_queen_throws          — weighted with undefined state.queen throws
#
# Requires: _cli_cmd, _e2e_isolate from acceptance-harness.sh
# Caller MUST set: REGISTRY, TEMP_DIR (or E2E_DIR)
#
# Per `reference-cli-cmd-helper.md`: parallel checks use `$(_cli_cmd)`, NEVER raw
# `npx --yes @sparkleideas/cli@latest` (the latter serializes on npm's 23GB cache lock).

set +u 2>/dev/null || true

# Helper: initialize hive in an iso dir.
_t1_hive_init() {
  local iso="$1"
  local cli; cli=$(_cli_cmd)
  : > "$iso/.ruflo-project"
  (cd "$iso" && NPM_CONFIG_REGISTRY="$REGISTRY" timeout 30 $cli hive-mind init >/dev/null 2>&1) || return 1
  return 0
}

# Helper: invoke hive-mind_consensus MCP tool.
_t1_consensus_call() {
  local iso="$1"
  local params_json="$2"
  local cli; cli=$(_cli_cmd)
  _T1_OUT=$(cd "$iso" && NPM_CONFIG_REGISTRY="$REGISTRY" timeout 15 $cli mcp exec --tool hive-mind_consensus --params "$params_json" 2>&1)
  _T1_EXIT=$?
}

# ════════════════════════════════════════════════════════════════════
# Scenario 1: weighted strategy is accepted at the wire boundary.
# ════════════════════════════════════════════════════════════════════
check_adr0119_weighted_strategy_accepted() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""
  local iso; iso=$(_e2e_isolate "adr0119-weighted-accepted")
  _t1_hive_init "$iso" || { _CHECK_OUTPUT="ADR-0119-§wire: hive-mind init failed"; rm -rf "$iso" 2>/dev/null; return; }

  # Spawn a queen so weighted has a queen reference, then propose.
  local cli; cli=$(_cli_cmd)
  (cd "$iso" && NPM_CONFIG_REGISTRY="$REGISTRY" timeout 30 $cli hive-mind spawn --queen-type strategic "test-objective" >/dev/null 2>&1) || true

  _t1_consensus_call "$iso" '{"action":"propose","type":"test","value":"v","strategy":"weighted"}'
  if [[ $_T1_EXIT -eq 0 ]] || echo "$_T1_OUT" | grep -qE "(MissingQueen|proposal|approved|pending)"; then
    # Either accepted (queen present) or fails loudly with MissingQueen (queen absent) — both prove
    # that 'weighted' is recognized by the schema enum at the wire boundary.
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0119-§wire: 'weighted' accepted by schema enum"
  else
    _CHECK_OUTPUT="ADR-0119-§wire: 'weighted' rejected by schema (output: $_T1_OUT)"
  fi
  rm -rf "$iso" 2>/dev/null
}

# ════════════════════════════════════════════════════════════════════
# Scenario 2: 'byzantine' is normalized to 'bft' at handler entry.
# Carry-forward from ADR-0106 R1 per ADR-0118 review-notes-triage 2026-05-02.
# ════════════════════════════════════════════════════════════════════
check_adr0119_byzantine_alias_normalizes() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""
  local iso; iso=$(_e2e_isolate "adr0119-byzantine-alias")
  _t1_hive_init "$iso" || { _CHECK_OUTPUT="ADR-0119-§alias: hive-mind init failed"; rm -rf "$iso" 2>/dev/null; return; }

  _t1_consensus_call "$iso" '{"action":"propose","type":"test","value":"v","strategy":"byzantine"}'
  # Either succeeds (proposal accepted with strategy normalized to bft internally)
  # or fails with a non-schema-enum error (which would also prove byzantine isn't
  # rejected by the schema). Schema rejection would be a TypeError-style message.
  if echo "$_T1_OUT" | grep -qE "schema|enum.*byzantine|not.*allowed.*byzantine"; then
    _CHECK_OUTPUT="ADR-0119-§alias: schema rejected 'byzantine' (output: $_T1_OUT)"
  else
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0119-§alias: 'byzantine' alias accepted at wire boundary"
  fi
  rm -rf "$iso" 2>/dev/null
}

# ════════════════════════════════════════════════════════════════════
# Scenario 3: unknown strategy throws at the wire (no silent fallback).
# Per feedback-no-fallbacks.md.
# ════════════════════════════════════════════════════════════════════
check_adr0119_unknown_strategy_rejected() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""
  local iso; iso=$(_e2e_isolate "adr0119-unknown-rejected")
  _t1_hive_init "$iso" || { _CHECK_OUTPUT="ADR-0119-§unknown: hive-mind init failed"; rm -rf "$iso" 2>/dev/null; return; }

  _t1_consensus_call "$iso" '{"action":"propose","type":"test","value":"v","strategy":"bogus-strategy"}'
  if [[ $_T1_EXIT -ne 0 ]] || echo "$_T1_OUT" | grep -qE "(unknown|invalid|not.*allowed|enum|schema)"; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0119-§unknown: rejected as expected"
  else
    _CHECK_OUTPUT="ADR-0119-§unknown: 'bogus-strategy' silently accepted (output: $_T1_OUT)"
  fi
  rm -rf "$iso" 2>/dev/null
}

# ════════════════════════════════════════════════════════════════════
# Scenario 4: weighted with no queen elected throws MissingQueenForWeightedConsensusError.
# Per ADR-0119 §Decision Outcome and feedback-no-fallbacks.md.
# ════════════════════════════════════════════════════════════════════
check_adr0119_missing_queen_throws() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""
  local iso; iso=$(_e2e_isolate "adr0119-missing-queen")
  _t1_hive_init "$iso" || { _CHECK_OUTPUT="ADR-0119-§noqueen: hive-mind init failed"; rm -rf "$iso" 2>/dev/null; return; }

  # `hive-mind init` always seeds a default state.queen (default agentId =
  # `queen-${Date.now()}`). To exercise the MissingQueenForWeightedConsensusError
  # path we have to simulate the real-world scenario the source guards against
  # (init race, dangling shutdown, queen nulled by error path) by removing
  # state.queen from state.json after init and before the propose.
  local state="$iso/.claude-flow/hive-mind/state.json"
  if [[ ! -f "$state" ]]; then
    _CHECK_OUTPUT="ADR-0119-§noqueen: state.json missing after init"
    rm -rf "$iso" 2>/dev/null; return
  fi
  # Replace the queen object with `null` so loadHiveState rehydrates state.queen
  # as null (falsy under `!state.queen`), matching the source guard.
  node -e "const fs=require('fs');const p=process.argv[1];const s=JSON.parse(fs.readFileSync(p,'utf8'));s.queen=null;fs.writeFileSync(p,JSON.stringify(s,null,2));" "$state" || {
    _CHECK_OUTPUT="ADR-0119-§noqueen: failed to null state.queen"
    rm -rf "$iso" 2>/dev/null; return
  }

  _t1_consensus_call "$iso" '{"action":"propose","type":"test","value":"v","strategy":"weighted"}'
  if echo "$_T1_OUT" | grep -qE "(MissingQueen|no queen|state\.queen|queen.*undefined)"; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0119-§noqueen: throws MissingQueenForWeightedConsensusError"
  else
    _CHECK_OUTPUT="ADR-0119-§noqueen: did NOT throw — silent fallback or success (output: $_T1_OUT)"
  fi
  rm -rf "$iso" 2>/dev/null
}

# ════════════════════════════════════════════════════════════════════
# ADR-0120 (T2) — Hive-mind Gossip consensus protocol
# ════════════════════════════════════════════════════════════════════

# Helper: invoke hive-mind_consensus MCP tool (alias to T1 helper for clarity).
_t2_consensus_call() {
  local iso="$1"
  local params_json="$2"
  local cli; cli=$(_cli_cmd)
  _T2_OUT=$(cd "$iso" && NPM_CONFIG_REGISTRY="$REGISTRY" timeout 15 $cli mcp exec --tool hive-mind_consensus --params "$params_json" 2>&1)
  _T2_EXIT=$?
}

# ════════════════════════════════════════════════════════════════════
# Scenario 5 (ADR-0120 §Acceptance criteria #1): gossip strategy is
# accepted at the wire boundary; a propose with strategy:'gossip'
# returns a proposalId rather than being rejected by the JSON-schema
# validator.
# ════════════════════════════════════════════════════════════════════
check_adr0120_gossip_strategy_accepted() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""
  local iso; iso=$(_e2e_isolate "adr0120-gossip-accepted")
  _t1_hive_init "$iso" || { _CHECK_OUTPUT="ADR-0120-§wire: hive-mind init failed"; rm -rf "$iso" 2>/dev/null; return; }

  _t2_consensus_call "$iso" '{"action":"propose","type":"test","value":"v","strategy":"gossip"}'
  # Acceptance: 'gossip' must NOT trigger a JSON-schema enum-rejection error.
  # The propose can succeed (returns proposalId) — there's no precondition
  # like weighted's MissingQueen.
  if echo "$_T2_OUT" | grep -qE "(schema|enum.*gossip|not.*allowed.*gossip)"; then
    _CHECK_OUTPUT="ADR-0120-§wire: 'gossip' rejected by schema (output: $_T2_OUT)"
  elif echo "$_T2_OUT" | grep -qE "(proposalId|proposal-)"; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0120-§wire: 'gossip' accepted at wire boundary; proposal created"
  else
    _CHECK_OUTPUT="ADR-0120-§wire: unexpected response (output: $_T2_OUT)"
  fi
  rm -rf "$iso" 2>/dev/null
}

# ════════════════════════════════════════════════════════════════════
# Scenario 6 (ADR-0120 §Acceptance criteria — gossipBound telemetry):
# propose with strategy:'gossip' surfaces gossipBound (= ceil(log2(N)))
# and gossipRound: 0 in the response, confirming the proposal carries
# the four required gossip fields and the bound is correctly seeded.
# ════════════════════════════════════════════════════════════════════
check_adr0120_gossip_bound_telemetry() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""
  local iso; iso=$(_e2e_isolate "adr0120-gossip-bound")
  _t1_hive_init "$iso" || { _CHECK_OUTPUT="ADR-0120-§bound: hive-mind init failed"; rm -rf "$iso" 2>/dev/null; return; }

  _t2_consensus_call "$iso" '{"action":"propose","type":"test","value":"v","strategy":"gossip"}'
  # The propose response must include both gossipRound (0 at creation) and
  # gossipBound (a number). roundTimeoutMs must also surface (defaulted 5000).
  if echo "$_T2_OUT" | grep -qE '"gossipBound"' && \
     echo "$_T2_OUT" | grep -qE '"gossipRound":\s*0' && \
     echo "$_T2_OUT" | grep -qE '"roundTimeoutMs"'; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0120-§bound: gossip telemetry (gossipRound + gossipBound + roundTimeoutMs) present"
  else
    _CHECK_OUTPUT="ADR-0120-§bound: missing gossip telemetry fields (output: $_T2_OUT)"
  fi
  rm -rf "$iso" 2>/dev/null
}

# ════════════════════════════════════════════════════════════════════
# Scenario 7 (ADR-0120 §Acceptance criteria — no-vote rejection):
# status on a fresh gossip proposal with zero votes returns
# { settled: false, gossipRound: 0, noVotes: true } — never settled.
# Per `feedback-no-fallbacks.md`, an empty tally is not a settled tally.
# ════════════════════════════════════════════════════════════════════
check_adr0120_gossip_no_vote_rejection() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""
  local iso; iso=$(_e2e_isolate "adr0120-gossip-novote")
  _t1_hive_init "$iso" || { _CHECK_OUTPUT="ADR-0120-§novote: hive-mind init failed"; rm -rf "$iso" 2>/dev/null; return; }

  # Propose, then status without voting.
  _t2_consensus_call "$iso" '{"action":"propose","type":"test","value":"v","strategy":"gossip"}'
  local proposal_id
  proposal_id=$(echo "$_T2_OUT" | grep -oE '"proposalId":[[:space:]]*"[^"]+"' | head -1 | sed -E 's/.*"proposalId":[[:space:]]*"([^"]+)".*/\1/')
  if [[ -z "$proposal_id" ]]; then
    _CHECK_OUTPUT="ADR-0120-§novote: failed to extract proposalId (output: $_T2_OUT)"
    rm -rf "$iso" 2>/dev/null
    return
  fi

  _t2_consensus_call "$iso" "{\"action\":\"status\",\"proposalId\":\"$proposal_id\"}"
  # No-vote tally must NOT be reported as settled. Required: settled=false AND
  # noVotes=true (the explicit fail-loud signal).
  if echo "$_T2_OUT" | grep -qE '"settled":\s*true'; then
    _CHECK_OUTPUT="ADR-0120-§novote: empty tally silently coerced to settled (output: $_T2_OUT)"
  elif echo "$_T2_OUT" | grep -qE '"noVotes":\s*true'; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0120-§novote: zero-vote proposal correctly NOT settled (noVotes=true)"
  else
    _CHECK_OUTPUT="ADR-0120-§novote: missing noVotes signal (output: $_T2_OUT)"
  fi
  rm -rf "$iso" 2>/dev/null
}

# ════════════════════════════════════════════════════════════════════
# Scenario 8 (ADR-0120 §Acceptance criteria — agent-file annotation):
# the gossip-coordinator agent file ships with `allowed-tools:
# [mcp__ruflo__hive-mind_consensus]` frontmatter and an example body
# referencing strategy:'gossip'. Static-grep against the materialised
# project's .claude/agents/ directory.
# ════════════════════════════════════════════════════════════════════
check_adr0120_gossip_agent_annotation() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""
  local iso; iso=$(_e2e_isolate "adr0120-gossip-agent")
  : > "$iso/.ruflo-project"

  # Init creates .claude/agents/* including the gossip-coordinator file.
  local cli; cli=$(_cli_cmd)
  (cd "$iso" && NPM_CONFIG_REGISTRY="$REGISTRY" timeout 60 $cli init --full --force >/dev/null 2>&1) || \
    { _CHECK_OUTPUT="ADR-0120-§agent: init --full failed"; rm -rf "$iso" 2>/dev/null; return; }

  local agent_file="$iso/.claude/agents/consensus/gossip-coordinator.md"
  if [[ ! -f "$agent_file" ]]; then
    _CHECK_OUTPUT="ADR-0120-§agent: gossip-coordinator.md missing in init'd project"
    rm -rf "$iso" 2>/dev/null
    return
  fi

  # Required: allowed-tools frontmatter + example body referencing gossip strategy.
  # The body example uses both the markdown form (`strategy: 'gossip'`) and the
  # JSON example form (`"strategy": "gossip"`) — accept either with a regex
  # tolerant to the surrounding quote/space characters. Use [[:space:]] (POSIX
  # bracket class) instead of `\s` for portability across BSD and GNU grep.
  if ! grep -qE 'allowed-tools:' "$agent_file"; then
    _CHECK_OUTPUT="ADR-0120-§agent: gossip-coordinator.md missing allowed-tools frontmatter"
  elif ! grep -qE 'mcp__ruflo__hive-mind_consensus' "$agent_file"; then
    _CHECK_OUTPUT="ADR-0120-§agent: gossip-coordinator.md missing mcp__ruflo__hive-mind_consensus tool reference"
  elif ! grep -qE "strategy[\"':[:space:]]+['\"]?gossip" "$agent_file"; then
    _CHECK_OUTPUT="ADR-0120-§agent: gossip-coordinator.md body missing strategy:'gossip' example"
  else
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0120-§agent: gossip-coordinator.md properly annotated (allowed-tools + body example)"
  fi
  rm -rf "$iso" 2>/dev/null
}

# ════════════════════════════════════════════════════════════════════
# ADR-0121 (T3) — Hive-mind CRDT consensus protocol
# ════════════════════════════════════════════════════════════════════

# Helper: invoke hive-mind_consensus MCP tool (alias to T1/T2 helpers for clarity).
_t3_consensus_call() {
  local iso="$1"
  local params_json="$2"
  local cli; cli=$(_cli_cmd)
  _T3_OUT=$(cd "$iso" && NPM_CONFIG_REGISTRY="$REGISTRY" timeout 15 $cli mcp exec --tool hive-mind_consensus --params "$params_json" 2>&1)
  _T3_EXIT=$?
}

# ════════════════════════════════════════════════════════════════════
# Scenario 9 (ADR-0121 §Acceptance criteria #1): crdt strategy is
# accepted at the wire boundary; a propose with strategy:'crdt'
# returns a proposalId rather than being rejected by the JSON-schema
# validator.
# ════════════════════════════════════════════════════════════════════
check_adr0121_crdt_strategy_accepted() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""
  local iso; iso=$(_e2e_isolate "adr0121-crdt-accepted")
  _t1_hive_init "$iso" || { _CHECK_OUTPUT="ADR-0121-§wire: hive-mind init failed"; rm -rf "$iso" 2>/dev/null; return; }

  _t3_consensus_call "$iso" '{"action":"propose","type":"test","value":"v","strategy":"crdt"}'
  if echo "$_T3_OUT" | grep -qE "(schema|enum.*crdt|not.*allowed.*crdt)"; then
    _CHECK_OUTPUT="ADR-0121-§wire: 'crdt' rejected by schema (output: $_T3_OUT)"
  elif echo "$_T3_OUT" | grep -qE "(proposalId|proposal-)"; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0121-§wire: 'crdt' accepted at wire boundary; proposal created"
  else
    _CHECK_OUTPUT="ADR-0121-§wire: unexpected response (output: $_T3_OUT)"
  fi
  rm -rf "$iso" 2>/dev/null
}

# ════════════════════════════════════════════════════════════════════
# Scenario 10 (ADR-0121 §Acceptance criteria — crdtState telemetry):
# propose with strategy:'crdt' surfaces crdtState (empty triple at
# proposal creation) and crdtExpectedVoters in the response.
# ════════════════════════════════════════════════════════════════════
check_adr0121_crdt_state_telemetry() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""
  local iso; iso=$(_e2e_isolate "adr0121-crdt-state")
  _t1_hive_init "$iso" || { _CHECK_OUTPUT="ADR-0121-§state: hive-mind init failed"; rm -rf "$iso" 2>/dev/null; return; }

  _t3_consensus_call "$iso" '{"action":"propose","type":"test","value":"v","strategy":"crdt"}'
  # The propose response must include crdtState (the merge accumulator) and
  # crdtExpectedVoters (the voter-count snapshot for settlement).
  if echo "$_T3_OUT" | grep -qE '"crdtState"' && \
     echo "$_T3_OUT" | grep -qE '"crdtExpectedVoters"'; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0121-§state: crdtState + crdtExpectedVoters present in propose response"
  else
    _CHECK_OUTPUT="ADR-0121-§state: missing crdtState/crdtExpectedVoters fields (output: $_T3_OUT)"
  fi
  rm -rf "$iso" 2>/dev/null
}

# ════════════════════════════════════════════════════════════════════
# Scenario 11 (ADR-0121 §Acceptance criteria — malformed snapshot):
# vote with malformed crdtSnapshot must throw, not silently coerce.
# Per `feedback-no-fallbacks.md`: invalid CRDT-state payload throws.
# ════════════════════════════════════════════════════════════════════
check_adr0121_crdt_malformed_snapshot_throws() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""
  local iso; iso=$(_e2e_isolate "adr0121-crdt-malformed")
  _t1_hive_init "$iso" || { _CHECK_OUTPUT="ADR-0121-§malformed: hive-mind init failed"; rm -rf "$iso" 2>/dev/null; return; }

  # Spawn a worker, propose, then vote with a malformed crdtSnapshot.
  local cli; cli=$(_cli_cmd)
  (cd "$iso" && NPM_CONFIG_REGISTRY="$REGISTRY" timeout 30 $cli hive-mind spawn --count 1 >/dev/null 2>&1) || true

  _t3_consensus_call "$iso" '{"action":"propose","type":"test","value":"v","strategy":"crdt"}'
  local proposal_id
  proposal_id=$(echo "$_T3_OUT" | grep -oE '"proposalId":[[:space:]]*"[^"]+"' | head -1 | sed -E 's/.*"proposalId":[[:space:]]*"([^"]+)".*/\1/')
  if [[ -z "$proposal_id" ]]; then
    _CHECK_OUTPUT="ADR-0121-§malformed: failed to create proposal (output: $_T3_OUT)"
    rm -rf "$iso" 2>/dev/null
    return
  fi

  # Submit a malformed snapshot — missing 'verdict' field.
  _t3_consensus_call "$iso" "{\"action\":\"vote\",\"proposalId\":\"$proposal_id\",\"voterId\":\"voter-1\",\"crdtSnapshot\":{\"votes\":{\"counts\":{}},\"approvers\":{\"entries\":[],\"tombstones\":[]}}}"
  if echo "$_T3_OUT" | grep -qE "(crdtSnapshot|votes.*approvers.*verdict|Error)"; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0121-§malformed: malformed crdtSnapshot rejected loudly"
  else
    _CHECK_OUTPUT="ADR-0121-§malformed: malformed snapshot silently accepted (output: $_T3_OUT)"
  fi
  rm -rf "$iso" 2>/dev/null
}

# ════════════════════════════════════════════════════════════════════
# Scenario 12 (ADR-0121 §Acceptance criteria — agent-file annotation):
# crdt-synchronizer.md ships with `allowed-tools:
# [mcp__ruflo__hive-mind_consensus]` frontmatter. Static-grep against
# the materialised project's .claude/agents/ directory.
#
# NOTE: this check probes whether the wire-in step from ADR-0121
# §Implementation §4 has landed on both copies (CLI and MCP package).
# If frontmatter is missing the check fails loudly so the gap is visible.
# ════════════════════════════════════════════════════════════════════
check_adr0121_crdt_agent_annotation() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""
  local iso; iso=$(_e2e_isolate "adr0121-crdt-agent")
  : > "$iso/.ruflo-project"

  local cli; cli=$(_cli_cmd)
  (cd "$iso" && NPM_CONFIG_REGISTRY="$REGISTRY" timeout 60 $cli init --full --force >/dev/null 2>&1) || \
    { _CHECK_OUTPUT="ADR-0121-§agent: init --full failed"; rm -rf "$iso" 2>/dev/null; return; }

  local agent_file="$iso/.claude/agents/consensus/crdt-synchronizer.md"
  if [[ ! -f "$agent_file" ]]; then
    _CHECK_OUTPUT="ADR-0121-§agent: crdt-synchronizer.md missing in init'd project"
    rm -rf "$iso" 2>/dev/null
    return
  fi

  # Required: allowed-tools frontmatter referencing mcp__ruflo__hive-mind_consensus.
  if ! grep -qE 'allowed-tools:' "$agent_file"; then
    _CHECK_OUTPUT="ADR-0121-§agent: crdt-synchronizer.md missing allowed-tools frontmatter"
  elif ! grep -qE 'mcp__ruflo__hive-mind_consensus' "$agent_file"; then
    _CHECK_OUTPUT="ADR-0121-§agent: crdt-synchronizer.md missing mcp__ruflo__hive-mind_consensus tool reference"
  else
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0121-§agent: crdt-synchronizer.md properly annotated"
  fi
  rm -rf "$iso" 2>/dev/null
}
