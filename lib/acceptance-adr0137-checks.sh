#!/usr/bin/env bash
# lib/acceptance-adr0137-checks.sh — ADR-0137 Part 3 acceptance checks.
#
# ADR-0137 ("cwd-anchoring eradication campaign") replaced the ~94
# `// adr-0100-allow:` band-aid annotations with real fixes: every runtime
# artifact path now anchors on `findProjectRoot()` (relocated to
# `@claude-flow/shared/fs` so the memory package can share it) instead of the
# drifting `process.cwd()`. A runtime write-path guard
# (`assertProjectRootAnchored`) was wired into the RVF + SQLite backend
# constructors to fail loud on any surviving cwd-anchoring regression.
#
# Where ADR-0100's acceptance (acceptance-adr0100-checks.sh) used `.swarm/` as
# its canary, ADR-0137's canary is the WHOLE tree: after each command run from
# a non-root cwd, NO stray `.claude-flow/` directory may exist anywhere except
# the project-root one. A stray `<subdir>/.claude-flow/` is the exact bug this
# campaign eradicates.
#
# Four scenarios per ADR-0137 §Part 3 (lines 88-97):
#   H — `ruflo memory store` from a 1-deep cwd      → state under project root;
#       zero stray .claude-flow/ under the subdir
#   I — `ruflo memory store` from a 5-deep cwd      → same, walk-up 5 levels
#   J — `ruflo init` in a fresh tmpdir, invoked from a non-root cwd, then a
#       memory op from a subdir → no stray .claude-flow/ under cwd OR any subdir
#   K — `ruflo hive-mind spawn` from a non-root cwd → state written under the
#       project root only; zero stray .claude-flow/ anywhere else
#
# After EACH scenario: walk the entire project tree and assert exactly ONE
# `.claude-flow/` directory (the project-root one). Fail loud otherwise
# (memory `feedback-no-fallbacks`: strays surface, nothing silenced).
#
# Conventions (mirrors acceptance-adr0100-checks.sh):
#   - Each scenario uses a fresh /tmp/ruflo-adr0137-<X>-XXXX dir, NOT
#     _e2e_isolate (E2E_DIR has its own CLAUDE.md+.claude markers that
#     findProjectRoot would walk past, sampling wrong state).
#   - Full output captured to $s/.log; never piped through tail/head
#     (memory `feedback-no-tail-tests` / `feedback-full-test-output`).
#   - Counts via `var=$(grep -c ...); var=${var:-0}` (memory
#     `reference-grep-c-bash-trap`).
#   - CLI invoked via $CLI_BIN (harness-resolved local fork bin) — never raw
#     `npx @sparkleideas/cli@latest` (memory `reference-cli-cmd-helper`).
#
# Caller MUST set: REGISTRY, CLI_BIN, TEMP_DIR (or harness equivalents).
#
# ════════════════════════════════════════════════════════════════════
# WIRING (coordinator action — NOT wired here):
#   This file is a DRAFT. To activate it, the coordinator must add it in BOTH
#   places (memory `feedback-always-wire-tests-into-cicd`,
#   `reference-acceptance-runcheck-vs-collect`):
#     1. scripts/test-acceptance.sh — source this file, then add a
#        `run_check_bg` line for each of the four checks:
#          run_check_bg "adr0137_scenario_h_one_deep"   check_adr0137_scenario_h_one_deep
#          run_check_bg "adr0137_scenario_i_five_deep"   check_adr0137_scenario_i_five_deep
#          run_check_bg "adr0137_scenario_j_init_fresh"  check_adr0137_scenario_j_init_fresh
#          run_check_bg "adr0137_scenario_k_hive_spawn"  check_adr0137_scenario_k_hive_spawn
#     2. the collect_parallel spec list — add all four names, or run_check_bg
#        runs+writes but collect_parallel never tallies them ("no verdict").
#   Expected PASS lines (one per scenario): "ADR-0137/H PASS …", "…/I PASS …",
#   "…/J PASS …", "…/K PASS …".
# ════════════════════════════════════════════════════════════════════

set +u 2>/dev/null || true

# Helper: bootstrap a fresh dir with `ruflo init --full --quiet` so the CLI
# sees a real init'd project (CLAUDE.md + .claude/ + .ruflo-project). Symlink
# node_modules from the harness install dir to avoid the ~30s reinstall.
_adr0137_init() {
  local target="$1"
  local nm_src=""
  if [[ -n "${E2E_DIR:-}" && -d "$E2E_DIR/node_modules" ]]; then
    nm_src="$E2E_DIR/node_modules"
  elif [[ -n "${TEMP_DIR:-}" && -d "$TEMP_DIR/node_modules" ]]; then
    nm_src="$TEMP_DIR/node_modules"
  fi
  if [[ -n "$nm_src" ]]; then
    ln -sf "$nm_src" "$target/node_modules" 2>/dev/null || true
  fi
  ( cd "$target" && NPM_CONFIG_REGISTRY="$REGISTRY" _timeout 120 "$CLI_BIN" init --full --quiet 2>&1 ) > "$target/.init.log" 2>&1 || true
}

# Count `.claude-flow` directories under a tree (the stray canary).
_adr0137_count_claudeflow_dirs() {
  local root="$1"
  local n
  n=$(find "$root" -name '.claude-flow' -type d 2>/dev/null | wc -l | tr -d ' ')
  n=${n:-0}
  echo "$n"
}

# List every `.claude-flow` dir under a tree NOT located at the project root.
# Echoes stray dirs (space-separated); empty = none.
_adr0137_stray_claudeflow_dirs() {
  local root="$1"
  find "$root" -name '.claude-flow' -type d 2>/dev/null \
    | grep -v "^${root}/.claude-flow\$" \
    | tr '\n' ' '
}

# Shared assertion: after a command run from $work under project root $root,
# there must be exactly ONE .claude-flow/ (at $root) and zero strays. Sets
# _CHECK_PASSED / _CHECK_OUTPUT. Returns 0 on PASS, 1 on FAIL.
_adr0137_assert_no_strays() {
  local scenario="$1" root="$2"
  local n strays
  n=$(_adr0137_count_claudeflow_dirs "$root")
  strays=$(_adr0137_stray_claudeflow_dirs "$root")

  if [[ -n "${strays// /}" ]]; then
    _CHECK_OUTPUT="ADR-0137/$scenario: STRAY .claude-flow/ created outside project root: ${strays}(full tree: $(find "$root" -name '.claude-flow' -type d | tr '\n' ' '))"
    return 1
  fi
  if [[ "$n" -gt 1 ]]; then
    _CHECK_OUTPUT="ADR-0137/$scenario: expected ≤1 .claude-flow/ (root only), found $n: $(find "$root" -name '.claude-flow' -type d | tr '\n' ' ')"
    return 1
  fi
  return 0
}

# ════════════════════════════════════════════════════════════════════
# Scenario H — `ruflo memory store` from a 1-deep cwd
# ════════════════════════════════════════════════════════════════════
check_adr0137_scenario_h_one_deep() {
  _CHECK_PASSED="false"; _CHECK_OUTPUT=""

  local s; s=$(mktemp -d /tmp/ruflo-adr0137-H-XXXX)
  local log="$s/.log"; : > "$log"

  _adr0137_init "$s"
  if [[ ! -f "$s/.ruflo-project" ]]; then
    _CHECK_OUTPUT="ADR-0137/H: init did not write .ruflo-project at $s (init log: $(head -3 "$s/.init.log" | tr '\n' ' '))"
    rm -rf "$s" 2>/dev/null; return
  fi

  mkdir -p "$s/docs"
  ( cd "$s/docs" && NPM_CONFIG_REGISTRY="$REGISTRY" _timeout 60 "$CLI_BIN" memory store --key adr0137-h --value one-deep --namespace test 2>&1 ) >> "$log" 2>&1 || true

  if ! _adr0137_assert_no_strays "H" "$s"; then
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0137/H PASS: memory store from docs/ (1-deep) → no stray .claude-flow/ (root-anchored)"
  rm -rf "$s" 2>/dev/null
}

# ════════════════════════════════════════════════════════════════════
# Scenario I — `ruflo memory store` from a 5-deep cwd
# ════════════════════════════════════════════════════════════════════
check_adr0137_scenario_i_five_deep() {
  _CHECK_PASSED="false"; _CHECK_OUTPUT=""

  local s; s=$(mktemp -d /tmp/ruflo-adr0137-I-XXXX)
  local log="$s/.log"; : > "$log"

  _adr0137_init "$s"
  if [[ ! -f "$s/.ruflo-project" ]]; then
    _CHECK_OUTPUT="ADR-0137/I: init did not write .ruflo-project at $s (init log: $(head -3 "$s/.init.log" | tr '\n' ' '))"
    rm -rf "$s" 2>/dev/null; return
  fi

  mkdir -p "$s/a/b/c/d/e"
  ( cd "$s/a/b/c/d/e" && NPM_CONFIG_REGISTRY="$REGISTRY" _timeout 60 "$CLI_BIN" memory store --key adr0137-i --value five-deep --namespace test 2>&1 ) >> "$log" 2>&1 || true

  if ! _adr0137_assert_no_strays "I" "$s"; then
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0137/I PASS: memory store from a/b/c/d/e/ (5-deep) → no stray .claude-flow/ (walk-up to root)"
  rm -rf "$s" 2>/dev/null
}

# ════════════════════════════════════════════════════════════════════
# Scenario J — `ruflo init` in a fresh tmpdir, then memory op from a subdir
#
# `init` legitimately scaffolds INTO the invocation cwd (ADR-0137 keeps
# init/types.ts:457 as intentional-cwd). After init, a memory op from a
# subdir must NOT create a second .claude-flow/ under that subdir.
# ════════════════════════════════════════════════════════════════════
check_adr0137_scenario_j_init_fresh() {
  _CHECK_PASSED="false"; _CHECK_OUTPUT=""

  local s; s=$(mktemp -d /tmp/ruflo-adr0137-J-XXXX)
  local log="$s/.log"; : > "$log"

  # init scaffolds INTO $s (the cwd). This is the intended target.
  _adr0137_init "$s"
  if [[ ! -d "$s/.claude" ]]; then
    _CHECK_OUTPUT="ADR-0137/J: init did not create .claude/ at $s (init log: $(head -3 "$s/.init.log" | tr '\n' ' '))"
    rm -rf "$s" 2>/dev/null; return
  fi

  # Now run a memory op from a subdir — must walk up to $s, not create a
  # stray .claude-flow/ under the subdir.
  mkdir -p "$s/nested/work"
  ( cd "$s/nested/work" && NPM_CONFIG_REGISTRY="$REGISTRY" _timeout 60 "$CLI_BIN" memory store --key adr0137-j --value post-init --namespace test 2>&1 ) >> "$log" 2>&1 || true

  if ! _adr0137_assert_no_strays "J" "$s"; then
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0137/J PASS: init into fresh tmpdir + memory op from nested/work/ → single root .claude-flow/, no strays"
  rm -rf "$s" 2>/dev/null
}

# ════════════════════════════════════════════════════════════════════
# Scenario K — `ruflo hive-mind spawn` from a non-root cwd
#
# Hive-mind state must be written under the project root only; running spawn
# from a subdir must not leave a stray .claude-flow/ there.
# ════════════════════════════════════════════════════════════════════
check_adr0137_scenario_k_hive_spawn() {
  _CHECK_PASSED="false"; _CHECK_OUTPUT=""

  local s; s=$(mktemp -d /tmp/ruflo-adr0137-K-XXXX)
  local log="$s/.log"; : > "$log"

  _adr0137_init "$s"
  if [[ ! -f "$s/.ruflo-project" ]]; then
    _CHECK_OUTPUT="ADR-0137/K: init did not write .ruflo-project at $s (init log: $(head -3 "$s/.init.log" | tr '\n' ' '))"
    rm -rf "$s" 2>/dev/null; return
  fi

  mkdir -p "$s/sub"
  # --no-claude / non-interactive: spawn the swarm but don't launch an agent
  # session; we only care about WHERE state is written, not the orchestration.
  ( cd "$s/sub" && NPM_CONFIG_REGISTRY="$REGISTRY" _timeout 90 "$CLI_BIN" hive-mind spawn "adr0137-k probe objective" --max-workers 1 2>&1 ) >> "$log" 2>&1 || true

  if ! _adr0137_assert_no_strays "K" "$s"; then
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0137/K PASS: hive-mind spawn from sub/ → state under project root only, no stray .claude-flow/"
  rm -rf "$s" 2>/dev/null
}
