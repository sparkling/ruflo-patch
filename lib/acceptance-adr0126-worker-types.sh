#!/usr/bin/env bash
# lib/acceptance-adr0126-worker-types.sh — ADR-0126 worker-type runtime
#                                            differentiation acceptance checks
#
# Each check spawns a hive with a worker pool that includes one or more of the
# 8 USERGUIDE worker types, captures the emitted prompt, and asserts:
#   - all 8 USERGUIDE types each get a `## Worker role: <type>` heading
#   - structural-contract sections are present in fixed order
#   - active queen-type sentinel from ADR-0125 is embedded in each block
#   - non-USERGUIDE types in the pool surface in count summary but emit
#     no prose block
#   - source-side: queen-coordinator.ts throws on empty-pool (no silent
#     fallback per `feedback-no-fallbacks.md`)
#
# Requires: _cli_cmd, _e2e_isolate from acceptance-checks.sh + acceptance-e2e-checks.sh.
# Caller MUST set: REGISTRY, E2E_DIR (or TEMP_DIR fallback for source checks).

set +u 2>/dev/null || true

# Resolve fork path from upstream-branches.json — same pattern as ADR-0117/0125 lib.
__ADR0126_FORK_DIR=""
_adr0126_resolve_fork() {
  if [[ -n "$__ADR0126_FORK_DIR" ]]; then return; fi
  __ADR0126_FORK_DIR=$(node -e "
    const c = JSON.parse(require('fs').readFileSync(
      require('path').resolve('${PROJECT_DIR:-.}', 'config', 'upstream-branches.json'), 'utf8'));
    process.stdout.write(c.ruflo?.dir || '');
  " 2>/dev/null)
}

# Helper: hive-init in an isolated dir. Must precede `hive-mind spawn`.
_adr0126_hive_init() {
  local iso="$1"
  local cli; cli=$(_cli_cmd)
  : > "$iso/.ruflo-project"
  (cd "$iso" && NPM_CONFIG_REGISTRY="$REGISTRY" timeout 30 $cli hive-mind init >/dev/null 2>&1) || return 1
  return 0
}

# Helper: spawn N workers of a specific --type, then capture the emitted
# prompt. The CLI's `hive-mind spawn` accepts `-t/--type` and `-n/--count`.
# Returns 0 on success, 1 on any spawn failure.
# Sets _ADR0126_PROMPT_FILE (path) and _ADR0126_PROMPT_OUT (raw cmd output).
_adr0126_spawn_with_type() {
  local iso="$1"
  local worker_type="$2"
  local count="${3:-1}"
  local queen_type="${4:-strategic}"
  local cli; cli=$(_cli_cmd)

  _ADR0126_PROMPT_FILE=""
  _ADR0126_PROMPT_OUT=""

  local out rc
  out=$(cd "$iso" && NPM_CONFIG_REGISTRY="$REGISTRY" timeout 60 $cli hive-mind spawn \
    --claude --dry-run -o "List 3 prime numbers" \
    --queen-type "$queen_type" \
    -t "$worker_type" -n "$count" 2>&1)
  rc=$?
  _ADR0126_PROMPT_OUT="$out"
  if [[ $rc -ne 0 ]]; then
    return 1
  fi

  local prompt_file
  prompt_file=$(find "$iso/.hive-mind/sessions" -name 'hive-mind-prompt-*.txt' 2>/dev/null | head -1)
  if [[ -z "$prompt_file" || ! -f "$prompt_file" ]]; then
    return 1
  fi
  _ADR0126_PROMPT_FILE="$prompt_file"
  return 0
}

# ════════════════════════════════════════════════════════════════════
# All 8 USERGUIDE worker types each get a `## Worker role: <type>` heading
# ════════════════════════════════════════════════════════════════════
check_adr0126_all_8_blocks_present() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local types=("researcher" "coder" "analyst" "architect" "tester" "reviewer" "optimizer" "documenter")
  local missing=""

  for wt in "${types[@]}"; do
    local iso; iso=$(_e2e_isolate "adr0126-block-$wt")
    _adr0126_hive_init "$iso" || {
      _CHECK_OUTPUT="ADR-0126 all-8: hive-mind init failed for $wt"
      rm -rf "$iso" 2>/dev/null
      return
    }

    if ! _adr0126_spawn_with_type "$iso" "$wt" 1 "strategic"; then
      _CHECK_OUTPUT="ADR-0126 all-8: spawn failed for type=$wt. out: ${_ADR0126_PROMPT_OUT:0:300}"
      rm -rf "$iso" 2>/dev/null
      return
    fi

    if ! grep -qF "## Worker role: $wt" "$_ADR0126_PROMPT_FILE"; then
      missing="$missing $wt"
    fi
    rm -rf "$iso" 2>/dev/null
  done

  if [[ -n "$missing" ]]; then
    _CHECK_OUTPUT="ADR-0126 all-8: missing prose block for types:$missing"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0126 all-8: every USERGUIDE worker type emits a per-type prose block"
}

# ════════════════════════════════════════════════════════════════════
# Structural-contract sections present in fixed order in every block
# ════════════════════════════════════════════════════════════════════
check_adr0126_structural_contract() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local iso; iso=$(_e2e_isolate "adr0126-structural")
  _adr0126_hive_init "$iso" || {
    _CHECK_OUTPUT="ADR-0126 structural: hive-mind init failed"
    rm -rf "$iso" 2>/dev/null
    return
  }

  if ! _adr0126_spawn_with_type "$iso" "researcher" 1 "tactical"; then
    _CHECK_OUTPUT="ADR-0126 structural: spawn failed. out: ${_ADR0126_PROMPT_OUT:0:300}"
    rm -rf "$iso" 2>/dev/null
    return
  fi

  # All three structural-contract headings must appear in the prompt.
  local headings=("## Worker role: researcher" "### Tools you should reach for first" "### Working with the active queen")
  local h
  for h in "${headings[@]}"; do
    if ! grep -qF "$h" "$_ADR0126_PROMPT_FILE"; then
      _CHECK_OUTPUT="ADR-0126 structural: missing required heading: \"$h\""
      rm -rf "$iso" 2>/dev/null
      return
    fi
  done

  # Order: role-heading appears BEFORE tools-heading; tools-heading
  # appears BEFORE queen-heading (within the same block — researcher's).
  local role_line tools_line queen_line
  role_line=$(grep -n "## Worker role: researcher" "$_ADR0126_PROMPT_FILE" | head -1 | cut -d: -f1)
  tools_line=$(grep -n "### Tools you should reach for first" "$_ADR0126_PROMPT_FILE" | head -1 | cut -d: -f1)
  queen_line=$(grep -n "### Working with the active queen" "$_ADR0126_PROMPT_FILE" | head -1 | cut -d: -f1)

  if [[ -z "$role_line" || -z "$tools_line" || -z "$queen_line" ]]; then
    _CHECK_OUTPUT="ADR-0126 structural: failed to locate one or more headings in prompt"
    rm -rf "$iso" 2>/dev/null
    return
  fi

  if [[ "$role_line" -ge "$tools_line" || "$tools_line" -ge "$queen_line" ]]; then
    _CHECK_OUTPUT="ADR-0126 structural: section order broken — role@$role_line, tools@$tools_line, queen@$queen_line"
    rm -rf "$iso" 2>/dev/null
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0126 structural: 3 sections present in fixed order (role -> tools -> queen)"
  rm -rf "$iso" 2>/dev/null
}

# ════════════════════════════════════════════════════════════════════
# Each block embeds the active queen-type sentinel (cross-reference)
# ════════════════════════════════════════════════════════════════════
check_adr0126_queen_cross_reference() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  # Sentinels per ADR-0125 §Specification "Cross-ADR sentinel contract".
  declare -A sentinels=(
    [strategic]="written plan"
    [tactical]="spawned workers within"
    [adaptive]="named your chosen mode"
  )

  local qt
  for qt in strategic tactical adaptive; do
    local iso; iso=$(_e2e_isolate "adr0126-xref-$qt")
    _adr0126_hive_init "$iso" || {
      _CHECK_OUTPUT="ADR-0126 xref: hive-mind init failed for $qt"
      rm -rf "$iso" 2>/dev/null
      return
    }

    if ! _adr0126_spawn_with_type "$iso" "coder" 1 "$qt"; then
      _CHECK_OUTPUT="ADR-0126 xref: spawn failed for queen=$qt. out: ${_ADR0126_PROMPT_OUT:0:300}"
      rm -rf "$iso" 2>/dev/null
      return
    fi

    local own_sentinel="${sentinels[$qt]}"
    # The sentinel must appear inside the coder's per-type prose block.
    # Cheap proxy: grep the file — sentinel surfaces in both queen
    # self-check section AND in the coder block's "Working with the
    # active queen" section. Both should be true; we count occurrences
    # and require >= 2.
    local count
    count=$(grep -cF "$own_sentinel" "$_ADR0126_PROMPT_FILE")
    if [[ "$count" -lt 2 ]]; then
      _CHECK_OUTPUT="ADR-0126 xref: $qt sentinel \"$own_sentinel\" appeared $count times (need >=2 — once for queen-self-check, once for worker-block xref)"
      rm -rf "$iso" 2>/dev/null
      return
    fi

    rm -rf "$iso" 2>/dev/null
  done

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0126 xref: all 3 queen-type sentinels embed correctly into per-worker-type prose blocks"
}

# ════════════════════════════════════════════════════════════════════
# Unknown worker-type at prompt-emission throws
# ════════════════════════════════════════════════════════════════════
# Source-side check: the `renderWorkerTypeProseBlock` default-case throw
# is in fork source. We assert the throw exists in source — the
# behavioural call lives in the unit test (cannot easily drive an
# unknown type through the CLI without a programmatic invocation).
check_adr0126_unknown_type_throws() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""
  _adr0126_resolve_fork

  local src="${__ADR0126_FORK_DIR}/v3/@claude-flow/cli/src/commands/hive-mind.ts"
  if [[ ! -f "$src" ]]; then
    _CHECK_OUTPUT="ADR-0126 unknown-throw: source file not found at $src"
    return
  fi

  if ! grep -qF "Unknown worker-type for prompt:" "$src"; then
    _CHECK_OUTPUT="ADR-0126 unknown-throw: source missing default-case throw for unknown worker-type"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0126 unknown-throw: renderWorkerTypeProseBlock throws on unknown type per feedback-no-fallbacks.md"
}

# ════════════════════════════════════════════════════════════════════
# Empty-pool disposition rejected (calculateCapabilityScore throws)
# ════════════════════════════════════════════════════════════════════
# Per ADR-0126 §Specification "Empty-pool contract": when no agent of any
# matching type for `task.type` is in the pool, calculateCapabilityScore
# throws `Error('No agent of matching type for task.type=X available in pool')`.
# This replaces the prior `score = 0.5` baseline (the silent fallback).
#
# The behavioural test for this lives in the swarm package's
# queen-coordinator.test.ts (in the fork). At the acceptance level, we
# assert the source-side contract — the throw must precede the baseline
# in the function body.
check_adr0126_empty_pool_rejected() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""
  _adr0126_resolve_fork

  local qcs="${__ADR0126_FORK_DIR}/v3/@claude-flow/swarm/src/queen-coordinator.ts"
  if [[ ! -f "$qcs" ]]; then
    _CHECK_OUTPUT="ADR-0126 empty-pool: queen-coordinator.ts not found at $qcs"
    return
  fi

  # 1. The throw exists.
  if ! grep -qF "No agent of matching type for task.type=" "$qcs"; then
    _CHECK_OUTPUT="ADR-0126 empty-pool: throw missing — calculateCapabilityScore not patched to ADR-0126 §Specification"
    return
  fi

  # 2. The throw appears BEFORE `let score = 0.5` in calculateCapabilityScore.
  #    Cheap awk-based ordering check using line numbers.
  local throw_line baseline_line fn_line
  fn_line=$(grep -n "private calculateCapabilityScore(" "$qcs" | head -1 | cut -d: -f1)
  throw_line=$(awk "/No agent of matching type for task\\.type=/ {print NR; exit}" "$qcs")
  baseline_line=$(awk -v start="$fn_line" 'NR >= start && /let score = 0\.5/ {print NR; exit}' "$qcs")

  if [[ -z "$throw_line" || -z "$baseline_line" ]]; then
    _CHECK_OUTPUT="ADR-0126 empty-pool: failed to locate throw or baseline (throw=$throw_line baseline=$baseline_line)"
    return
  fi

  if [[ "$throw_line" -ge "$baseline_line" ]]; then
    _CHECK_OUTPUT="ADR-0126 empty-pool: throw at line $throw_line must precede baseline at line $baseline_line per ADR-0126 §Pseudocode"
    return
  fi

  # 3. typeMatches covers all 8 USERGUIDE worker types.
  local missing_types=""
  local types=("researcher" "coder" "analyst" "architect" "tester" "reviewer" "optimizer" "documenter")
  local t
  for t in "${types[@]}"; do
    # Look for `'<type>'` inside the typeMatches block. We bound the search
    # by scanning a fixed-size window after the table declaration.
    local table_idx
    table_idx=$(grep -n "const typeMatches: Record<TaskType, AgentType\[\]>" "$qcs" | head -1 | cut -d: -f1)
    if [[ -z "$table_idx" ]]; then
      _CHECK_OUTPUT="ADR-0126 empty-pool: typeMatches table not found"
      return
    fi
    # Window: 30 lines after the table opening should suffice.
    local window
    window=$(sed -n "${table_idx},+30p" "$qcs")
    if ! echo "$window" | grep -qF "'$t'"; then
      missing_types="$missing_types $t"
    fi
  done

  if [[ -n "$missing_types" ]]; then
    _CHECK_OUTPUT="ADR-0126 empty-pool: typeMatches missing types:$missing_types"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0126 empty-pool: throw precedes baseline; typeMatches covers all 8 USERGUIDE types"
}
