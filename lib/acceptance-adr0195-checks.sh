#!/usr/bin/env bash
# lib/acceptance-adr0195-checks.sh — ADR-0195: AutopilotLearning Phase 4
# (cross-controller bridges via in-process event bus).
#
# ADR-0195 status is `accepted` as of 2026-05-19. Closure criteria the ADR
# names that map to acceptance probes:
#   * `episode:recorded` (and 3 other) events emitted via AgentDBService's
#     EventEmitter bus at the existing producer boundaries in autopilot-
#     learning.ts
#   * the LearningSystem subscriber translates each episode into a
#     `learning_experiences` row
#   * ADR-0197 Finding 1: the broken `learningSystem.predictAction?.(...)`
#     optional-chain call expression is removed from the published source
#     (ADR-0195 §"Three additional observations" #1; ADR-0197 §Finding 1)
#
# Until ADR-0195 lands, the event-bus checks FAIL (no surface to subscribe
# from). The published-source grep for the broken probe should already PASS
# once the codemod publishes a build that includes ADR-0197 Finding 1's
# removal — but if the published artifact is older than that fix, it FAILs,
# which is the right disposition.
#
# Caller MUST set: REGISTRY, TEMP_DIR, ACCEPT_TEMP, P5_DIR.
#
# Catalog naming: check_adr0195_* is L7-accepted via the adr-NNNN filename tag.

# ── helpers ─────────────────────────────────────────────────────────────────

# Drive an autopilot episode write via the CLI so the event bus has something
# to emit. The pre-ADR shape uses `memory store` writing into the
# `autopilot:episodes` namespace which ReflexionMemory listens to; the
# post-ADR shape may add `autopilot record` or similar. We use `memory store`
# as the stable producer trigger.
_adr0195_emit_episode() {
  local dir="$1"
  local cli; cli=$(_cli_cmd)
  _run_and_kill \
    "cd '${dir}' && NPM_CONFIG_REGISTRY='${REGISTRY}' ${cli} memory store --key 'adr0195-emit' --value 'phase 4 event-bus probe' --namespace autopilot:episodes" \
    "" 20
}

# Invoke `autopilot subscribe --event episode:recorded --json` against $dir.
# This subcommand does not exist pre-ADR-0195; we expect it to:
#   * print a JSON-shaped event line each time the bus fires
#   * print `{ "available": false, ... }` if AgentDBService is unwired
# Writes captured stdout to $out_file (caller inspects).
_adr0195_run_subscribe() {
  local dir="$1" out_file="$2"
  local cli; cli=$(_cli_cmd)
  # Short max-wait — subscribe should respond promptly even if the bus is
  # idle; for the populated probe it returns after observing 1 event.
  _run_and_kill_ro \
    "cd '${dir}' && NPM_CONFIG_REGISTRY='${REGISTRY}' ${cli} autopilot subscribe --event episode:recorded --json --limit 1 2>&1" \
    "$out_file" \
    30
}

# ── (1) event-bus closure: subscribe sees episode:recorded after a write ────

# check_adr0195_subscribe_episode_recorded — drive a write into
# autopilot:episodes, then subscribe and confirm the bus delivers a
# structured event with the expected payload shape (taskId, subject, status,
# reward, success, timestamp per ADR-0195 §Contract).
check_adr0195_subscribe_episode_recorded() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  if [[ -z "${P5_DIR:-}" || ! -d "$P5_DIR" ]]; then
    _CHECK_OUTPUT="adr0195-subscribe: \$P5_DIR not exported or missing"
    return
  fi

  local dir; dir=$(mktemp -d "${ACCEPT_TEMP:-/tmp}/_check_workdirs/ruflo-adr0195-sub-XXXXX")
  # shellcheck disable=SC2064
  trap "rm -rf '$dir' 2>/dev/null; trap - RETURN INT TERM" RETURN INT TERM
  _acceptance_snapshot "$P5_DIR" "$dir"
  : > "$dir/.ruflo-project"

  if [[ ! -f "${dir}/.claude-flow/config.json" ]]; then
    _CHECK_OUTPUT="adr0195-subscribe: clone from \$P5_DIR failed"
    return
  fi

  # Order matters: drive the write FIRST so the bus has fired, then ask the
  # subscriber for the historical event. ADR-0195 §"Risks → Subscriber
  # registered AFTER episodes have already been emitted misses those events"
  # documents that late subscribers don't see prior emits — so the
  # subcommand must support `--limit N` over a replay buffer or otherwise
  # cooperate with this ordering. The check fails informatively if it
  # doesn't.
  _adr0195_emit_episode "$dir"

  local out_file; out_file=$(mktemp "${ACCEPT_TEMP:-/tmp}/adr0195-sub-XXXXX")
  _adr0195_run_subscribe "$dir" "$out_file"
  local raw; raw=$(cat "$out_file" 2>/dev/null || echo "")
  rm -f "$out_file"
  raw=$(echo "$raw" | grep -v '^__RUFLO_DONE__:')

  if echo "$raw" | grep -qiE 'unknown command|unknown subcommand|no such command'; then
    _CHECK_OUTPUT="adr0195-subscribe: \`autopilot subscribe\` subcommand not present — ADR-0195 Phase 4 not yet implemented"
    return
  fi

  # Look for a JSON object that carries either the `event` field (subcommand
  # canonical shape) OR a payload signature distinctive to episode:recorded
  # (taskId + subject + reward).
  local body
  body=$(node -e '
    (() => {
      const raw = require("fs").readFileSync(0, "utf8");
      // Tolerate banner + multiple JSON lines; pick the first object that
      // has either `event` or {taskId,subject,reward} or matches.
      const lines = raw.split(/\r?\n/);
      for (const line of lines) {
        const s = line.indexOf("{");
        const e = line.lastIndexOf("}");
        if (s < 0 || e < s) continue;
        try {
          const j = JSON.parse(line.slice(s, e + 1));
          const hasEventField = typeof j.event === "string";
          const hasPayloadShape = (j.payload || j).taskId !== undefined
                                  && (j.payload || j).subject !== undefined;
          if (hasEventField || hasPayloadShape) {
            process.stdout.write(JSON.stringify(j));
            return;
          }
        } catch {}
      }
    })();
  ' <<<"$raw" 2>/dev/null)

  if [[ -z "$body" ]]; then
    _CHECK_OUTPUT="adr0195-subscribe: no structured event seen after write — bus did not deliver. Raw: $(echo "$raw" | head -10 | tr '\n' ' ' | head -c 600)"
    return
  fi

  # Assert the event name OR the payload signature matches episode:recorded.
  local event_name
  event_name=$(node -e "
    try {
      const j = JSON.parse(require('fs').readFileSync(0,'utf8'));
      process.stdout.write(String(j.event ?? ''));
    } catch {}
  " <<<"$body" 2>/dev/null)

  if [[ "$event_name" != "episode:recorded" ]]; then
    # Pre-ADR shape may omit `event` and just deliver the payload. Allow that
    # iff the payload signature matches.
    local sig_match
    sig_match=$(node -e "
      try {
        const j = JSON.parse(require('fs').readFileSync(0,'utf8'));
        const p = j.payload || j;
        const ok = typeof p.taskId !== 'undefined'
                && typeof p.subject !== 'undefined';
        process.stdout.write(ok ? 'yes' : 'no');
      } catch { process.stdout.write('no'); }
    " <<<"$body" 2>/dev/null)
    if [[ "$sig_match" != "yes" ]]; then
      _CHECK_OUTPUT="adr0195-subscribe: event shape mismatch — neither event:'episode:recorded' nor (taskId+subject) signature present. Body: $(echo "$body" | head -c 400)"
      return
    fi
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="adr0195-subscribe: bus delivered episode:recorded event (or matching payload signature) after a write"
}

# ── (2) ADR-0197 Finding 1: broken predictAction probe is gone ──────────────

# check_adr0195_predictAction_unreachable — assert the broken
# `learningSystem.predictAction(...)` optional-chain probe is NOT present in
# the published @sparkleideas/agentic-flow source. This is ADR-0197 Finding 1,
# which ADR-0195 §"Three additional observations" #1 names as load-bearing
# for Phase 4. The check greps the installed package's dist for the call-
# expression patterns:
#   learningSystem.predictAction(
#   learningSystem.predictAction?.(
#   this.learningSystem.predictAction(
#   this.learningSystem.predictAction?.(
#
# Comments mentioning predictAction are fine — only actual invocations fail
# the check. The legitimate `AgentDBService.predictAction` method declaration
# (agentdb-service.ts:1189) is also fine: it's a method declaration, not a
# call against a LearningSystem field.
check_adr0195_predictAction_unreachable() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local pkg_dir="${TEMP_DIR}/node_modules/@sparkleideas/agentic-flow"
  if [[ ! -d "$pkg_dir" ]]; then
    _CHECK_OUTPUT="adr0195-predictAction: @sparkleideas/agentic-flow not installed at ${pkg_dir}"
    return
  fi

  # Match call expressions, not declarations and not comment lines that
  # happen to contain the string. Strategy: ripgrep-style PCRE, but stick
  # to grep -E (BSD-grep on macOS) — match the literal `.predictAction(` or
  # `.predictAction?.(` preceded by `learningSystem` within the same line.
  # Skip lines whose first non-whitespace chars are `//` or `*` (comments).
  local matches
  matches=$(grep -rE 'learningSystem\.predictAction(\?\.)?\(' "$pkg_dir" \
    --include='*.js' --include='*.mjs' --include='*.cjs' 2>/dev/null \
    | grep -vE '^\s*//' \
    | grep -vE '^\s*\*' \
    | grep -vE ':\s*//' \
    || true)

  if [[ -n "$matches" ]]; then
    local count
    count=$(echo "$matches" | wc -l | tr -d ' ')
    _CHECK_OUTPUT="adr0195-predictAction: ${count} call(s) to learningSystem.predictAction still in published source (want 0 per ADR-0197 Finding 1). First match: $(echo "$matches" | head -1 | head -c 300)"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="adr0195-predictAction: 0 call-expression matches for learningSystem.predictAction in published @sparkleideas/agentic-flow (ADR-0197 Finding 1 honored)"
}
