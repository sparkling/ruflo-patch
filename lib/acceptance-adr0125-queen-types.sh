#!/usr/bin/env bash
# lib/acceptance-adr0125-queen-types.sh — ADR-0125 Queen-type runtime
#                                          differentiation acceptance checks
#
# For each queen type (strategic | tactical | adaptive):
#   - run `hive-mind spawn --claude --dry-run -o "..." --queen-type <type>`
#   - capture the emitted prompt file
#   - assert per-type sentinel substring is present
#   - assert wrong-type sentinels are absent
#
# Plus the README copy correction (Phase 5 / H4):
#   - forks/ruflo/README.md carries "Differentiation is prompt-shaped, not algorithmic"
#   - forks/ruflo/README.md no longer carries the bare "Strategic (planning),
#     Tactical (execution), Adaptive (optimization)" string
#
# Requires: _cli_cmd, _e2e_isolate from acceptance-checks.sh + acceptance-e2e-checks.sh
# Caller MUST set: REGISTRY, E2E_DIR (or TEMP_DIR fallback for the README check)

set +u 2>/dev/null || true

# Resolve fork path from upstream-branches.json — same pattern as ADR-0117 lib.
__ADR0125_FORK_DIR=""
_adr0125_resolve_fork() {
  if [[ -n "$__ADR0125_FORK_DIR" ]]; then return; fi
  __ADR0125_FORK_DIR=$(node -e "
    const c = JSON.parse(require('fs').readFileSync(
      require('path').resolve('${PROJECT_DIR:-.}', 'config', 'upstream-branches.json'), 'utf8'));
    process.stdout.write(c.ruflo?.dir || '');
  " 2>/dev/null)
}

# Helper: hive-init in an isolated dir. The `_e2e_isolate` snapshot copies
# .claude-flow / .swarm but not hive-mind state; every check that exercises
# `hive-mind spawn` must hive-init first or hit "Hive-mind not initialized".
# Mirrors ADR-0104's _adr0104_hive_init.
_adr0125_hive_init() {
  local iso="$1"
  local cli; cli=$(_cli_cmd)
  : > "$iso/.ruflo-project"
  (cd "$iso" && NPM_CONFIG_REGISTRY="$REGISTRY" timeout 30 $cli hive-mind init >/dev/null 2>&1) || return 1
  return 0
}

# Helper: spawn a hive with a given queen type, capture the prompt path.
# Sets _ADR0125_PROMPT_FILE (path) and _ADR0125_PROMPT_OUT (raw command output).
# Returns 0 on success, 1 on any spawn failure (so callers can fail loudly).
_adr0125_spawn_capture() {
  local iso="$1"
  local queen_type="$2"
  local cli; cli=$(_cli_cmd)

  _ADR0125_PROMPT_FILE=""
  _ADR0125_PROMPT_OUT=""

  local out rc
  out=$(cd "$iso" && NPM_CONFIG_REGISTRY="$REGISTRY" timeout 60 $cli hive-mind spawn --claude --dry-run -o "List 3 prime numbers" --queen-type "$queen_type" 2>&1)
  rc=$?
  _ADR0125_PROMPT_OUT="$out"

  if [[ $rc -ne 0 ]]; then
    return 1
  fi

  local prompt_file
  prompt_file=$(find "$iso/.hive-mind/sessions" -name 'hive-mind-prompt-*.txt' 2>/dev/null | head -1)
  if [[ -z "$prompt_file" || ! -f "$prompt_file" ]]; then
    return 1
  fi
  _ADR0125_PROMPT_FILE="$prompt_file"
  return 0
}

# ════════════════════════════════════════════════════════════════════
# Strategic queen — sentinel "written plan" present, wrong-type sentinels absent
# ════════════════════════════════════════════════════════════════════
check_adr0125_strategic_sentinel() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""
  local iso; iso=$(_e2e_isolate "adr0125-strategic")
  _adr0125_hive_init "$iso" || { _CHECK_OUTPUT="ADR-0125 strategic: hive-mind init failed in iso"; rm -rf "$iso" 2>/dev/null; return; }

  if ! _adr0125_spawn_capture "$iso" "strategic"; then
    _CHECK_OUTPUT="ADR-0125 strategic: spawn failed. out: ${_ADR0125_PROMPT_OUT:0:300}"
    rm -rf "$iso" 2>/dev/null; return
  fi

  if ! grep -qF "written plan" "$_ADR0125_PROMPT_FILE"; then
    _CHECK_OUTPUT="ADR-0125 strategic: own sentinel \"written plan\" missing from prompt"
    rm -rf "$iso" 2>/dev/null; return
  fi

  # Wrong-type sentinels must be absent. Each is a unique phrase scoped to
  # its variant — false positives indicate prompt-template drift.
  if grep -qF "spawned workers within" "$_ADR0125_PROMPT_FILE"; then
    _CHECK_OUTPUT="ADR-0125 strategic: tactical sentinel leaked into strategic prompt"
    rm -rf "$iso" 2>/dev/null; return
  fi
  if grep -qF "named your chosen mode" "$_ADR0125_PROMPT_FILE"; then
    _CHECK_OUTPUT="ADR-0125 strategic: adaptive sentinel leaked into strategic prompt"
    rm -rf "$iso" 2>/dev/null; return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0125 strategic: \"written plan\" present, wrong-type sentinels absent"
  rm -rf "$iso" 2>/dev/null
}

# ════════════════════════════════════════════════════════════════════
# Tactical queen — sentinel "spawned workers within" present, wrong-type absent
# ════════════════════════════════════════════════════════════════════
check_adr0125_tactical_sentinel() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""
  local iso; iso=$(_e2e_isolate "adr0125-tactical")
  _adr0125_hive_init "$iso" || { _CHECK_OUTPUT="ADR-0125 tactical: hive-mind init failed in iso"; rm -rf "$iso" 2>/dev/null; return; }

  if ! _adr0125_spawn_capture "$iso" "tactical"; then
    _CHECK_OUTPUT="ADR-0125 tactical: spawn failed. out: ${_ADR0125_PROMPT_OUT:0:300}"
    rm -rf "$iso" 2>/dev/null; return
  fi

  if ! grep -qF "spawned workers within" "$_ADR0125_PROMPT_FILE"; then
    _CHECK_OUTPUT="ADR-0125 tactical: own sentinel \"spawned workers within\" missing from prompt"
    rm -rf "$iso" 2>/dev/null; return
  fi
  if grep -qF "written plan" "$_ADR0125_PROMPT_FILE"; then
    _CHECK_OUTPUT="ADR-0125 tactical: strategic sentinel leaked into tactical prompt"
    rm -rf "$iso" 2>/dev/null; return
  fi
  if grep -qF "named your chosen mode" "$_ADR0125_PROMPT_FILE"; then
    _CHECK_OUTPUT="ADR-0125 tactical: adaptive sentinel leaked into tactical prompt"
    rm -rf "$iso" 2>/dev/null; return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0125 tactical: \"spawned workers within\" present, wrong-type sentinels absent"
  rm -rf "$iso" 2>/dev/null
}

# ════════════════════════════════════════════════════════════════════
# Adaptive queen — sentinel "named your chosen mode" present, wrong-type absent
# ════════════════════════════════════════════════════════════════════
check_adr0125_adaptive_sentinel() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""
  local iso; iso=$(_e2e_isolate "adr0125-adaptive")
  _adr0125_hive_init "$iso" || { _CHECK_OUTPUT="ADR-0125 adaptive: hive-mind init failed in iso"; rm -rf "$iso" 2>/dev/null; return; }

  if ! _adr0125_spawn_capture "$iso" "adaptive"; then
    _CHECK_OUTPUT="ADR-0125 adaptive: spawn failed. out: ${_ADR0125_PROMPT_OUT:0:300}"
    rm -rf "$iso" 2>/dev/null; return
  fi

  if ! grep -qF "named your chosen mode" "$_ADR0125_PROMPT_FILE"; then
    _CHECK_OUTPUT="ADR-0125 adaptive: own sentinel \"named your chosen mode\" missing from prompt"
    rm -rf "$iso" 2>/dev/null; return
  fi
  if grep -qF "written plan" "$_ADR0125_PROMPT_FILE"; then
    _CHECK_OUTPUT="ADR-0125 adaptive: strategic sentinel leaked into adaptive prompt"
    rm -rf "$iso" 2>/dev/null; return
  fi
  if grep -qF "spawned workers within" "$_ADR0125_PROMPT_FILE"; then
    _CHECK_OUTPUT="ADR-0125 adaptive: tactical sentinel leaked into adaptive prompt"
    rm -rf "$iso" 2>/dev/null; return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0125 adaptive: \"named your chosen mode\" present, wrong-type sentinels absent"
  rm -rf "$iso" 2>/dev/null
}

# ════════════════════════════════════════════════════════════════════
# Pairwise distinctness — three queen types produce three different prompts
# ════════════════════════════════════════════════════════════════════
check_adr0125_pairwise_distinct() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""
  local iso; iso=$(_e2e_isolate "adr0125-pairwise")
  _adr0125_hive_init "$iso" || { _CHECK_OUTPUT="ADR-0125 pairwise: hive-mind init failed in iso"; rm -rf "$iso" 2>/dev/null; return; }

  local prompts=()
  local qt
  for qt in strategic tactical adaptive; do
    if ! _adr0125_spawn_capture "$iso" "$qt"; then
      _CHECK_OUTPUT="ADR-0125 pairwise: spawn failed for $qt. out: ${_ADR0125_PROMPT_OUT:0:200}"
      rm -rf "$iso" 2>/dev/null; return
    fi
    # Copy each prompt to a per-type file so the next spawn doesn't
    # overwrite the prior one (the swarm-id is per-init, but to be safe
    # we snapshot here).
    cp "$_ADR0125_PROMPT_FILE" "$iso/captured-${qt}.txt"
    prompts+=("$iso/captured-${qt}.txt")
    # Wipe the sessions dir so the next spawn writes a fresh prompt file
    # (sessions accumulate; we want to compare the freshly-rendered three).
    rm -f "$iso/.hive-mind/sessions"/hive-mind-prompt-*.txt 2>/dev/null
  done

  # Pairwise diff — any two identical prompts is a hard fail (no per-type
  # differentiation). diff returns 0 if files are identical.
  if diff -q "${prompts[0]}" "${prompts[1]}" >/dev/null 2>&1; then
    _CHECK_OUTPUT="ADR-0125 pairwise: strategic prompt == tactical prompt (no differentiation)"
    rm -rf "$iso" 2>/dev/null; return
  fi
  if diff -q "${prompts[0]}" "${prompts[2]}" >/dev/null 2>&1; then
    _CHECK_OUTPUT="ADR-0125 pairwise: strategic prompt == adaptive prompt (no differentiation)"
    rm -rf "$iso" 2>/dev/null; return
  fi
  if diff -q "${prompts[1]}" "${prompts[2]}" >/dev/null 2>&1; then
    _CHECK_OUTPUT="ADR-0125 pairwise: tactical prompt == adaptive prompt (no differentiation)"
    rm -rf "$iso" 2>/dev/null; return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0125 pairwise: all three queen-type prompts pairwise-distinct"
  rm -rf "$iso" 2>/dev/null
}

# ════════════════════════════════════════════════════════════════════
# Section parity — every variant carries both section headings
# ════════════════════════════════════════════════════════════════════
check_adr0125_section_parity() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""
  local iso; iso=$(_e2e_isolate "adr0125-parity")
  _adr0125_hive_init "$iso" || { _CHECK_OUTPUT="ADR-0125 parity: hive-mind init failed in iso"; rm -rf "$iso" 2>/dev/null; return; }

  local qt missing
  for qt in strategic tactical adaptive; do
    if ! _adr0125_spawn_capture "$iso" "$qt"; then
      _CHECK_OUTPUT="ADR-0125 parity: spawn failed for $qt. out: ${_ADR0125_PROMPT_OUT:0:200}"
      rm -rf "$iso" 2>/dev/null; return
    fi
    missing=""
    if ! grep -qF "Tools you should reach for first" "$_ADR0125_PROMPT_FILE"; then
      missing="${missing}\"Tools you should reach for first\" "
    fi
    if ! grep -qF "Before declaring done, verify" "$_ADR0125_PROMPT_FILE"; then
      missing="${missing}\"Before declaring done, verify\" "
    fi
    if [[ -n "$missing" ]]; then
      _CHECK_OUTPUT="ADR-0125 parity: $qt prompt missing heading(s): $missing"
      rm -rf "$iso" 2>/dev/null; return
    fi
    rm -f "$iso/.hive-mind/sessions"/hive-mind-prompt-*.txt 2>/dev/null
  done

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0125 parity: all three variants carry both section headings"
  rm -rf "$iso" 2>/dev/null
}

# ════════════════════════════════════════════════════════════════════
# README copy correction (Phase 5 / H4) — fork-root README diff
# ════════════════════════════════════════════════════════════════════
check_adr0125_readme_copy_correction() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""
  _adr0125_resolve_fork

  local readme="${__ADR0125_FORK_DIR}/README.md"
  if [[ ! -f "$readme" ]]; then
    _CHECK_OUTPUT="ADR-0125 README: $readme not found"
    return
  fi

  # MUST carry the corrected prose-shaped framing.
  if ! grep -qF "Differentiation is prompt-shaped, not algorithmic" "$readme"; then
    _CHECK_OUTPUT="ADR-0125 README: corrected framing \"Differentiation is prompt-shaped, not algorithmic\" missing"
    return
  fi

  # MUST NOT carry the bare offending string.
  if grep -qF "Strategic (planning), Tactical (execution), Adaptive (optimization)" "$readme"; then
    _CHECK_OUTPUT="ADR-0125 README: bare offending copy \"Strategic (planning), Tactical (execution), Adaptive (optimization)\" still present"
    return
  fi

  # Sanity: the corrected relabels are in place.
  if ! grep -qF "Strategic (planning-first)" "$readme"; then
    _CHECK_OUTPUT="ADR-0125 README: corrected \"Strategic (planning-first)\" relabel missing"
    return
  fi
  if ! grep -qF "Tactical (execution-first)" "$readme"; then
    _CHECK_OUTPUT="ADR-0125 README: corrected \"Tactical (execution-first)\" relabel missing"
    return
  fi
  if ! grep -qF "Adaptive (mode-switching by complexity)" "$readme"; then
    _CHECK_OUTPUT="ADR-0125 README: corrected \"Adaptive (mode-switching by complexity)\" relabel missing"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0125 README: corrected copy present; bare offending string removed"
}
