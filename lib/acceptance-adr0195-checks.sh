#!/usr/bin/env bash
# lib/acceptance-adr0195-checks.sh — ADR-0195: AutopilotLearning Phase 4
# (cross-controller bridges via in-process event bus).
#
# ADR-0195 status is `accepted` as of 2026-05-19. Closure criteria are at
# the INTERNAL-API level: AgentDBService exposes a learning-event
# EventEmitter and an internal subscriber attaches LearningSystem to it.
# CLI surface is OUT OF SCOPE for ADR-0195 closure — deferred to a future
# ADR.
#
# Reason these probes are source-level greps: CLI surface deferred to
# future ADR; these greps validate that the source-level event-bus wiring
# and ADR-0197 Finding 1 (broken `learningSystem.predictAction?.(...)` call
# removal) are present in the published @sparkleideas/agentic-flow tarball.
#
# Caller MUST set: TEMP_DIR (the acceptance install root that contains
# `node_modules/@sparkleideas/agentic-flow`).
#
# Catalog naming: check_adr0195_* is L7-accepted via the adr-NNNN filename tag.

# ── (1) event-bus wiring: AgentDBService exposes the learning bus ───────────

# check_adr0195_subscribe_episode_recorded — assert the published source
# contains the three load-bearing event-bus wiring tokens in
# `agentic-flow/dist/services/agentdb-service.js`:
#   * getLearningEvents          — the public accessor returning the bus
#   * learningEvents             — the EventEmitter instance field
#   * _attachLearningSubscriber  — the internal hook that wires LearningSystem
#                                  onto the bus
# Reason: CLI surface deferred to future ADR; this probe validates source-
# level event-bus wiring per ADR-0195's "Three subscriber types" section.
check_adr0195_subscribe_episode_recorded() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local pkg_dir="${TEMP_DIR}/node_modules/@sparkleideas/agentic-flow"
  if [[ ! -d "$pkg_dir" ]]; then
    _CHECK_OUTPUT="adr0195-subscribe: @sparkleideas/agentic-flow not installed at ${pkg_dir}"
    return
  fi

  local target="$pkg_dir/agentic-flow/dist/services/agentdb-service.js"
  if [[ ! -f "$target" ]]; then
    _CHECK_OUTPUT="adr0195-subscribe: agentic-flow/dist/services/agentdb-service.js missing in installed package (${target})"
    return
  fi

  local missing=""
  for token in "getLearningEvents" "learningEvents" "_attachLearningSubscriber"; do
    if ! grep -qF "$token" "$target" 2>/dev/null; then
      missing="$missing $token"
    fi
  done

  if [[ -n "$missing" ]]; then
    _CHECK_OUTPUT="adr0195-subscribe: missing event-bus wiring tokens in agentic-flow/dist/services/agentdb-service.js:${missing}"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="adr0195-subscribe: PASS (event-bus wired — getLearningEvents accessor + learningEvents EventEmitter + _attachLearningSubscriber all present)"
}

# ── (2) ADR-0197 Finding 1: broken predictAction probe is gone ──────────────

# check_adr0195_predictAction_unreachable — assert the broken
# `learningSystem.predictAction(...)` optional-chain probe is NOT present
# as a CALL EXPRESSION in the canonical published source at
# `agentic-flow/dist/services/agentdb-service.js`. This is ADR-0197 Finding 1, which
# ADR-0195 §"Three additional observations" #1 names as load-bearing for
# Phase 4.
#
# Scope: ONLY the canonical export-resolved path `dist/services/`. The
# nested `dist/agentic-flow/src/services/` is a stale-build artifact that
# ships in the tarball but is unreachable from any export — it is
# intentionally NOT inspected here. Comments mentioning predictAction
# (e.g. the "removed broken probe" note) are filtered.
#
# Allowed: the legitimate `async predictAction(state) {` method declaration
# on AgentDBService itself (line 1048 of the current dist) — matched by
# its `async ` prefix, not by `learningSystem.predictAction(`, so it does
# not trip the grep.
#
# Reason: CLI surface deferred to future ADR; this probe validates source-
# level removal of the ADR-0197 Finding 1 broken call expression.
check_adr0195_predictAction_unreachable() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local pkg_dir="${TEMP_DIR}/node_modules/@sparkleideas/agentic-flow"
  if [[ ! -d "$pkg_dir" ]]; then
    _CHECK_OUTPUT="adr0195-predictAction: @sparkleideas/agentic-flow not installed at ${pkg_dir}"
    return
  fi

  local target="$pkg_dir/agentic-flow/dist/services/agentdb-service.js"
  if [[ ! -f "$target" ]]; then
    _CHECK_OUTPUT="adr0195-predictAction: canonical agentic-flow/dist/services/agentdb-service.js missing (${target})"
    return
  fi

  # Match call expressions only. After grep emits `<file>:<content>`, the
  # comment filter inspects what comes AFTER the colon (not start of the
  # whole line) so the file prefix doesn't defeat the `^\s*//` anchor.
  # Strategy: grep for the pattern, then strip everything up to and
  # including the first `:` so the content sits at column 0, and only
  # then apply the comment filter.
  local raw_matches
  raw_matches=$(grep -nE 'learningSystem\.predictAction(\?\.)?\(' "$target" 2>/dev/null || true)

  local call_expr_hits=""
  if [[ -n "$raw_matches" ]]; then
    # raw_matches lines are `LINENO:CONTENT`. Strip `LINENO:` then filter
    # comment-only lines (line/block) and lines where the match appears
    # only inside a string-quoted comment-style fragment.
    while IFS= read -r line; do
      [[ -z "$line" ]] && continue
      local content="${line#*:}"
      # Block comment line (` * ...`) or single-line comment (`// ...`),
      # tolerating leading whitespace.
      if [[ "$content" =~ ^[[:space:]]*// ]]; then continue; fi
      if [[ "$content" =~ ^[[:space:]]*\* ]]; then continue; fi
      # Lines like `   x; // y learningSystem.predictAction?.(z)` — inline
      # trailing comment. Detect `//` BEFORE the match position.
      # Simpler heuristic: if `//` appears before the match token on the
      # same line, treat as comment.
      if [[ "$content" == *"//"*"learningSystem.predictAction"* ]]; then
        # `//` precedes the match → comment.
        continue
      fi
      call_expr_hits+="${line}"$'\n'
    done <<<"$raw_matches"
  fi

  if [[ -n "$call_expr_hits" ]]; then
    local count
    count=$(echo "$call_expr_hits" | grep -c .)
    _CHECK_OUTPUT="adr0195-predictAction: ${count} call-expression(s) to learningSystem.predictAction still in canonical agentic-flow/dist/services/agentdb-service.js (want 0 per ADR-0197 Finding 1). First match: $(echo "$call_expr_hits" | head -1 | head -c 300)"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="adr0195-predictAction: PASS (0 call-expressions for learningSystem.predictAction in canonical agentic-flow/dist/services/agentdb-service.js — ADR-0197 Finding 1 honored)"
}
