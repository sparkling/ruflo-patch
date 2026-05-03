#!/usr/bin/env bash
# lib/acceptance-adr0100-checks.sh — ADR-0100 §4 acceptance checks.
#
# Verifies that `findProjectRoot()` (forks/ruflo/.../mcp-tools/types.ts:50)
# anchors artifact paths on the project root REGARDLESS of where Claude
# Code's CWD has drifted. The canary artifact is `.swarm/` (written by
# `swarm init`, which routes through swarm-tools.ts:46 → findProjectRoot).
# An additional canary (Scenario G — grep gate) shells out to
# scripts/check-no-cwd-in-handlers.sh to fail the build if any in-scope CLI
# source reintroduces `process.cwd()` outside an allowlisted shape (comment,
# string literal, or `adr-0100-allow:` annotation). Scope expanded 2026-05-03
# from mcp-tools-only to also cover init/**, commands/**, cli/src/memory/**,
# and @claude-flow/memory/src/** after the adr0100-b/c regressions surfaced
# path-anchoring `process.cwd()` calls outside the original gate's coverage.
#
# Six scenarios per ADR-0100 §4 + the user brief (2026-05-03):
#   A — cwd at project root after `ruflo init`        → .swarm/ at root
#   B — cwd 1 level deep in subdir                    → .swarm/ at root
#   C — cwd 5 levels deep                             → .swarm/ at root
#   D — cwd outside any project (HOME=tmp, no markers) → fallback warn AND
#       persistent log entry written under HOME/.ruflo/resolver-warnings.log
#   E — nested project (sentinel beats CLAUDE.md+.claude pair at shallower)
#       → .swarm/ at the inner sentinel'd root, NOT the outer CLAUDE.md root
#   F — depth cap (40-deep tree, MAX_WALK_DEPTH=32 in resolver)
#       → resolver bails without infinite loop, returns startDir, log entry
#   G — grep gate (scripts/check-no-cwd-in-handlers.sh)
#       → no non-allowlisted process.cwd() across the broadened CLI scope:
#         mcp-tools/*-tools.ts, init/**, commands/**, cli/src/memory/**,
#         @claude-flow/memory/src/**
#
# Conventions:
#   - Each scenario writes its tempdir to ${TEST_DIR}/scenario-<X>/ so post-
#     mortem inspection is possible (memory `feedback-no-fallbacks`: failures
#     surface; nothing silenced).
#   - Full output captured to ${TEST_DIR}/<scenario>.log; never piped through
#     tail/head (memory `feedback-no-tail-tests` / `feedback-full-test-output`).
#   - Counts via `var=$(grep -c ...); var=${var:-0}` (memory
#     `reference-grep-c-bash-trap`).
#   - CLI invoked via $CLI_BIN (the harness-resolved local fork bin) — never
#     raw `npx @sparkleideas/cli@latest` (memory `reference-cli-cmd-helper`,
#     36× slower under npm cache lock contention).
#   - Each scenario uses a fresh /tmp/ruflo-adr0100-<X>-XXXX dir, NOT
#     _e2e_isolate. _e2e_isolate places fixtures under E2E_DIR which has its
#     own CLAUDE.md + .claude markers — findProjectRoot would walk past iso
#     to E2E_DIR and the assertions would sample wrong state. This mirrors
#     the existing ADR-0098 B/C decision (acceptance-adr0098-checks.sh:94).
#
# Caller MUST set: REGISTRY, CLI_BIN, TEMP_DIR (or harness equivalents).
# Caller MAY set: ADR0100_TEST_DIR — base for scenario tempdirs (defaults
# /tmp/ruflo-adr0100-<scenario>-<rand>).

set +u 2>/dev/null || true

__ADR0100_PROJECT_DIR=""
__ADR0100_GATE_SCRIPT=""
_adr0100_resolve_paths() {
  if [[ -n "$__ADR0100_PROJECT_DIR" ]]; then return; fi
  __ADR0100_PROJECT_DIR="${PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
  __ADR0100_GATE_SCRIPT="${__ADR0100_PROJECT_DIR}/scripts/check-no-cwd-in-handlers.sh"
}

# Helper: bootstrap a fresh dir with `ruflo init --full --quiet` so the
# CLI sees a real init'd project (CLAUDE.md + .claude/ + .ruflo-project).
# We symlink node_modules from TEMP_DIR/E2E_DIR to avoid the ~30s reinstall
# (same trick adr0098 uses).
_adr0100_init() {
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

# Helper: run `swarm init` with cwd set to $work, capture into $log.
_adr0100_swarm_init() {
  local work="$1" log="$2"
  ( cd "$work" && NPM_CONFIG_REGISTRY="$REGISTRY" _timeout 30 "$CLI_BIN" swarm init 2>&1 ) >> "$log" 2>&1 || true
}

# Count `.swarm` directories under a tree (the sprawl canary).
_adr0100_count_swarm_dirs() {
  local root="$1"
  local n
  n=$(find "$root" -name '.swarm' -type d 2>/dev/null | wc -l | tr -d ' ')
  n=${n:-0}
  echo "$n"
}

# Locate the published `types.js` (which exports findProjectRoot) inside the
# harness-installed @sparkleideas/cli. The fork repo's dist/ is intentionally
# never built (per CLAUDE.md "TWO COMMANDS, NOTHING ELSE" — release builds
# under /tmp/ruflo-build/ and publishes to Verdaccio), so we must read the
# artifact users actually install. Path layout has shifted across builds
# (e.g. dist/mcp-tools/ vs dist/src/mcp-tools/), so we `find` rather than
# hardcode. Same shape as `_find_pkg_js` in adr0063 / adr0065 / adr0083.
#
# Echoes the resolved path on stdout. Empty stdout = not found (caller MUST
# fail loudly with that fact; per memory `feedback-no-fallbacks`, no silent
# fork-source fallback is acceptable).
_adr0100_find_published_types_js() {
  local pkg_dir="${TEMP_DIR:-}/node_modules/@sparkleideas/cli"
  if [[ -z "${TEMP_DIR:-}" || ! -d "$pkg_dir" ]]; then return; fi
  find "$pkg_dir" -name 'types.js' -path '*/mcp-tools/*' 2>/dev/null | head -1
}

# ════════════════════════════════════════════════════════════════════
# Scenario A — cwd at project root
# ════════════════════════════════════════════════════════════════════
check_adr0100_scenario_a_root() {
  _CHECK_PASSED="false"; _CHECK_OUTPUT=""
  _adr0100_resolve_paths

  local s; s=$(mktemp -d /tmp/ruflo-adr0100-A-XXXX)
  local log="$s/.log"; : > "$log"

  _adr0100_init "$s"

  if [[ ! -f "$s/.ruflo-project" ]]; then
    _CHECK_OUTPUT="ADR-0100/A: init did not write .ruflo-project sentinel at $s (init log: $(head -3 "$s/.init.log" | tr '\n' ' '))"
    rm -rf "$s" 2>/dev/null; return
  fi
  if [[ ! -f "$s/CLAUDE.md" ]]; then
    _CHECK_OUTPUT="ADR-0100/A: init did not write CLAUDE.md at $s"
    rm -rf "$s" 2>/dev/null; return
  fi
  if [[ ! -d "$s/.claude" ]]; then
    _CHECK_OUTPUT="ADR-0100/A: init did not create .claude/ at $s"
    rm -rf "$s" 2>/dev/null; return
  fi

  _adr0100_swarm_init "$s" "$log"

  local n; n=$(_adr0100_count_swarm_dirs "$s")
  if [[ "$n" != "1" ]]; then
    _CHECK_OUTPUT="ADR-0100/A: expected exactly 1 .swarm/ at root, found $n (tree: $(find "$s" -name '.swarm' -type d | tr '\n' ' '))"
    return
  fi
  if [[ ! -d "$s/.swarm" ]]; then
    _CHECK_OUTPUT="ADR-0100/A: .swarm/ did not land at root ($s); tree: $(find "$s" -name '.swarm' -type d | tr '\n' ' ')"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0100/A PASS: cwd at root → .swarm/ at root (1 dir, sentinel/CLAUDE.md/.claude all present)"
  rm -rf "$s" 2>/dev/null
}

# ════════════════════════════════════════════════════════════════════
# Scenario B — cwd 1 level deep
# ════════════════════════════════════════════════════════════════════
check_adr0100_scenario_b_one_deep() {
  _CHECK_PASSED="false"; _CHECK_OUTPUT=""
  _adr0100_resolve_paths

  local s; s=$(mktemp -d /tmp/ruflo-adr0100-B-XXXX)
  local log="$s/.log"; : > "$log"

  _adr0100_init "$s"
  mkdir -p "$s/src"
  _adr0100_swarm_init "$s/src" "$log"

  local n; n=$(_adr0100_count_swarm_dirs "$s")
  if [[ "$n" != "1" ]]; then
    _CHECK_OUTPUT="ADR-0100/B: expected 1 .swarm/ (at root, walk-up from src/), found $n; tree: $(find "$s" -name '.swarm' -type d | tr '\n' ' ')"
    return
  fi
  if [[ -d "$s/src/.swarm" ]]; then
    _CHECK_OUTPUT="ADR-0100/B: sprawl — .swarm/ landed in src/ (resolver did not walk up): $s/src/.swarm"
    return
  fi
  if [[ ! -d "$s/.swarm" ]]; then
    _CHECK_OUTPUT="ADR-0100/B: walk-up failed — .swarm/ not at root; tree: $(find "$s" -name '.swarm' -type d | tr '\n' ' ')"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0100/B PASS: cwd src/ → .swarm/ at root (walk-up 1 level)"
  rm -rf "$s" 2>/dev/null
}

# ════════════════════════════════════════════════════════════════════
# Scenario C — cwd 5 levels deep
# ════════════════════════════════════════════════════════════════════
check_adr0100_scenario_c_five_deep() {
  _CHECK_PASSED="false"; _CHECK_OUTPUT=""
  _adr0100_resolve_paths

  local s; s=$(mktemp -d /tmp/ruflo-adr0100-C-XXXX)
  local log="$s/.log"; : > "$log"

  _adr0100_init "$s"
  mkdir -p "$s/a/b/c/d/e"
  _adr0100_swarm_init "$s/a/b/c/d/e" "$log"

  local n; n=$(_adr0100_count_swarm_dirs "$s")
  if [[ "$n" != "1" ]]; then
    _CHECK_OUTPUT="ADR-0100/C: expected 1 .swarm/ (at root, walk-up 5 levels), found $n; tree: $(find "$s" -name '.swarm' -type d | tr '\n' ' ')"
    return
  fi
  if [[ ! -d "$s/.swarm" ]]; then
    _CHECK_OUTPUT="ADR-0100/C: walk-up 5 levels failed — .swarm/ not at root; tree: $(find "$s" -name '.swarm' -type d | tr '\n' ' ')"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0100/C PASS: cwd a/b/c/d/e/ → .swarm/ at root (walk-up 5 levels)"
  rm -rf "$s" 2>/dev/null
}

# ════════════════════════════════════════════════════════════════════
# Scenario D — cwd outside any project (no markers anywhere on the walk)
#
# Per ADR §1: resolver MUST log to stderr AND ${HOME}/.ruflo/resolver-warnings.log
# AND return startDir (no silent fallback). We override HOME so the test does
# not write into the real user log.
# ════════════════════════════════════════════════════════════════════
check_adr0100_scenario_d_no_markers() {
  _CHECK_PASSED="false"; _CHECK_OUTPUT=""
  _adr0100_resolve_paths

  local s; s=$(mktemp -d /tmp/ruflo-adr0100-D-XXXX)
  local log="$s/.log"; : > "$log"

  # Workdir is a no-marker dir. We need findProjectRoot to:
  #   1. start from $work
  #   2. walk up — and find NOTHING (so $work must NOT be inside any
  #      .ruflo-project / CLAUDE.md+.claude / .git directory).
  # /tmp on macOS is /private/tmp; walking up from $s eventually hits / .
  # Verify no .git exists between $s and / (it shouldn't on a sane host;
  # if the test ever fires inside a parent .git, this assertion is the
  # canary).
  local probe="$s" found_git="" walks=0
  while [[ "$probe" != "/" && walks -lt 64 ]]; do
    if [[ -d "$probe/.git" || -f "$probe/.ruflo-project" ]]; then
      found_git="$probe"
      break
    fi
    probe=$(dirname "$probe")
    walks=$((walks + 1))
  done
  if [[ -n "$found_git" ]]; then
    _CHECK_OUTPUT="ADR-0100/D: SKIP precondition — $found_git lies between $s and /; cannot test no-marker path"
    rm -rf "$s" 2>/dev/null; return
  fi

  # Fake HOME so the resolver writes its persistent warning under a path
  # we control and can inspect.
  local fake_home="$s/home"
  mkdir -p "$fake_home/.ruflo"
  local persistent_log="$fake_home/.ruflo/resolver-warnings.log"

  # Invoke findProjectRoot directly via the published CLI's resolver. We
  # can't use `swarm init` here because it has additional dependencies
  # (config files, embeddings, etc.) that may write *somewhere*. Direct
  # node import of the published types.js is the cleanest test of the
  # resolver contract.
  #
  # IMPORTANT: source from the harness-installed @sparkleideas/cli, NOT
  # from the fork repo. The fork's dist/ is intentionally never built
  # (release builds under /tmp/ruflo-build/ → Verdaccio); reading from
  # the published artifact is the contract users actually receive.
  local types_js
  types_js=$(_adr0100_find_published_types_js)
  if [[ -z "$types_js" || ! -f "$types_js" ]]; then
    _CHECK_OUTPUT="ADR-0100/D: published mcp-tools/types.js not found under ${TEMP_DIR:-<TEMP_DIR-unset>}/node_modules/@sparkleideas/cli (resolved: '$types_js'; was the harness install step run before acceptance?)"
    rm -rf "$s" 2>/dev/null; return
  fi

  # Published @sparkleideas/cli is type:module — must use ESM dynamic import.
  local resolved
  resolved=$( cd "$s" && HOME="$fake_home" node --input-type=module -e "
    const { findProjectRoot } = await import('$types_js');
    process.stdout.write(findProjectRoot('$s'));
  " 2>>"$log" )

  if [[ "$resolved" != "$s" ]]; then
    _CHECK_OUTPUT="ADR-0100/D: resolver returned '$resolved', expected fallback to startDir '$s'"
    rm -rf "$s" 2>/dev/null; return
  fi

  if [[ ! -f "$persistent_log" ]]; then
    _CHECK_OUTPUT="ADR-0100/D: persistent warning log NOT written to $persistent_log (resolver violates §1 BOTH-sinks contract)"
    rm -rf "$s" 2>/dev/null; return
  fi

  local entries; entries=$(grep -c 'No project root marker found' "$persistent_log")
  entries=${entries:-0}
  if [[ "$entries" -lt 1 ]]; then
    _CHECK_OUTPUT="ADR-0100/D: persistent log exists but lacks 'No project root marker found' entry (got: $(head -3 "$persistent_log" | tr '\n' ' '))"
    rm -rf "$s" 2>/dev/null; return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0100/D PASS: no-marker fallback returns startDir + writes persistent log ($entries entry/entries)"
  rm -rf "$s" 2>/dev/null
}

# ════════════════════════════════════════════════════════════════════
# Scenario E — nested project, sentinel beats CLAUDE.md pair at shallower depth
#
# Layout:
#   /tmp/ruflo-adr0100-E-XXXX/                     (outer)
#     CLAUDE.md, .claude/                          (init'd outer project)
#     sub/inner/
#       .ruflo-project                             (inner sentinel)
#       <swarm init invoked from here>
#
# Expected: .swarm/ lands at sub/inner/, NOT at outer.
# ════════════════════════════════════════════════════════════════════
check_adr0100_scenario_e_sentinel_priority() {
  _CHECK_PASSED="false"; _CHECK_OUTPUT=""
  _adr0100_resolve_paths

  local s; s=$(mktemp -d /tmp/ruflo-adr0100-E-XXXX)
  local log="$s/.log"; : > "$log"

  # Outer: a real ruflo init.
  _adr0100_init "$s"

  # Inner: just a sentinel + a writable .swarm parent. Don't init — we want
  # to test that sentinel ALONE wins, even without CLAUDE.md/.claude/.git
  # at the inner level.
  local inner="$s/sub/inner"
  mkdir -p "$inner"
  printf '{"version":1,"initDate":"%s","cliVersion":"adr0100-acceptance"}\n' "$(date -u +%FT%TZ)" > "$inner/.ruflo-project"

  _adr0100_swarm_init "$inner" "$log"

  local total; total=$(_adr0100_count_swarm_dirs "$s")
  if [[ "$total" != "1" ]]; then
    _CHECK_OUTPUT="ADR-0100/E: expected 1 .swarm/ (at inner sentinel'd root), found $total; tree: $(find "$s" -name '.swarm' -type d | tr '\n' ' ')"
    return
  fi
  if [[ ! -d "$inner/.swarm" ]]; then
    _CHECK_OUTPUT="ADR-0100/E: .swarm/ did NOT land at $inner; tree: $(find "$s" -name '.swarm' -type d | tr '\n' ' ')"
    return
  fi
  if [[ -d "$s/.swarm" ]]; then
    _CHECK_OUTPUT="ADR-0100/E: sentinel priority FAILED — .swarm/ landed at outer $s/.swarm/, not inner"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0100/E PASS: inner sentinel beat outer CLAUDE.md+.claude (.swarm/ at $inner/.swarm)"
  rm -rf "$s" 2>/dev/null
}

# ════════════════════════════════════════════════════════════════════
# Scenario F — depth cap (40-deep tree, MAX_WALK_DEPTH=32)
#
# Asserts the resolver bails after MAX_WALK_DEPTH iterations without
# infinite loop AND returns startDir AND writes a persistent log entry
# (no markers anywhere on the truncated walk = same fallback as Scenario D).
# Also bounded by a wall-clock timeout to catch a hypothetical infinite-
# loop regression.
# ════════════════════════════════════════════════════════════════════
check_adr0100_scenario_f_depth_cap() {
  _CHECK_PASSED="false"; _CHECK_OUTPUT=""
  _adr0100_resolve_paths

  local s; s=$(mktemp -d /tmp/ruflo-adr0100-F-XXXX)
  local log="$s/.log"; : > "$log"

  # Build a 40-deep tree under s (no markers anywhere).
  local deep="$s"
  local i
  for i in $(seq 1 40); do
    deep="$deep/d$i"
  done
  mkdir -p "$deep"

  # Same .git-precondition probe as Scenario D — we need a no-marker path
  # from $deep up to /, otherwise the resolver legitimately matches a host
  # parent .git and the depth-cap test never fires.
  local probe="$s" found="" walks=0
  while [[ "$probe" != "/" && walks -lt 64 ]]; do
    if [[ -d "$probe/.git" || -f "$probe/.ruflo-project" ]]; then
      found="$probe"; break
    fi
    probe=$(dirname "$probe")
    walks=$((walks + 1))
  done
  if [[ -n "$found" ]]; then
    _CHECK_OUTPUT="ADR-0100/F: SKIP precondition — $found lies between $s and /; cannot test depth cap"
    rm -rf "$s" 2>/dev/null; return
  fi

  local fake_home="$s/home"
  mkdir -p "$fake_home/.ruflo"
  local persistent_log="$fake_home/.ruflo/resolver-warnings.log"

  # Resolve published types.js (see Scenario D for rationale — fork dist/
  # is intentionally never built; we read what users install).
  local types_js
  types_js=$(_adr0100_find_published_types_js)
  if [[ -z "$types_js" || ! -f "$types_js" ]]; then
    _CHECK_OUTPUT="ADR-0100/F: published mcp-tools/types.js not found under ${TEMP_DIR:-<TEMP_DIR-unset>}/node_modules/@sparkleideas/cli (resolved: '$types_js'; was the harness install step run before acceptance?)"
    rm -rf "$s" 2>/dev/null; return
  fi

  # Bound the call by a timeout — if the resolver infinite-loops, we exit
  # via SIGKILL and report the regression. Published @sparkleideas/cli is
  # type:module — must use ESM dynamic import.
  local resolved exit_code=0
  resolved=$( HOME="$fake_home" _timeout 10 node --input-type=module -e "
    const { findProjectRoot } = await import('$types_js');
    process.stdout.write(findProjectRoot('$deep'));
  " 2>>"$log" ) || exit_code=$?

  if (( exit_code == 124 || exit_code == 137 )); then
    _CHECK_OUTPUT="ADR-0100/F: resolver TIMED OUT against 40-deep no-marker tree — depth cap regression (infinite loop?)"
    rm -rf "$s" 2>/dev/null; return
  fi

  if [[ "$resolved" != "$deep" ]]; then
    _CHECK_OUTPUT="ADR-0100/F: resolver returned '$resolved', expected fallback to startDir '$deep' after MAX_WALK_DEPTH"
    rm -rf "$s" 2>/dev/null; return
  fi

  if [[ ! -f "$persistent_log" ]]; then
    _CHECK_OUTPUT="ADR-0100/F: depth-cap fallback did NOT write persistent log entry"
    rm -rf "$s" 2>/dev/null; return
  fi

  local entries; entries=$(grep -c 'No project root marker found' "$persistent_log")
  entries=${entries:-0}
  if [[ "$entries" -lt 1 ]]; then
    _CHECK_OUTPUT="ADR-0100/F: persistent log exists but no 'No project root marker found' entry"
    rm -rf "$s" 2>/dev/null; return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0100/F PASS: 40-deep no-marker tree → resolver bailed, returned startDir, wrote log"
  rm -rf "$s" 2>/dev/null
}

# ════════════════════════════════════════════════════════════════════
# Scenario G — grep gate (ADR-0100 §3c)
#
# Wraps scripts/check-no-cwd-in-handlers.sh. The script prints to stdout
# and exits 1 on any non-allowlisted process.cwd() in the broadened CLI
# scope (mcp-tools/*-tools.ts + init/** + commands/** + cli/src/memory/** +
# @claude-flow/memory/src/**). See the script header for allowlist rules.
# ════════════════════════════════════════════════════════════════════
check_adr0100_scenario_g_grep_gate() {
  _CHECK_PASSED="false"; _CHECK_OUTPUT=""
  _adr0100_resolve_paths

  if [[ ! -x "$__ADR0100_GATE_SCRIPT" ]]; then
    _CHECK_OUTPUT="ADR-0100/G: gate script not executable: $__ADR0100_GATE_SCRIPT"
    return
  fi

  local s; s=$(mktemp -d /tmp/ruflo-adr0100-G-XXXX)
  local log="$s/.log"; : > "$log"

  local exit_code=0
  ADR0100_LOG_DIR="$s" PROJECT_DIR="$__ADR0100_PROJECT_DIR" \
    bash "$__ADR0100_GATE_SCRIPT" >> "$log" 2>&1 || exit_code=$?

  if (( exit_code == 0 )); then
    _CHECK_PASSED="true"
    # Scope expanded 2026-05-03: now covers mcp-tools/*-tools.ts +
    # init/**/*.ts + commands/**/*.ts + cli/src/memory/**/*.ts +
    # @claude-flow/memory/src/**/*.ts (see scripts/check-no-cwd-in-handlers.sh).
    _CHECK_OUTPUT="ADR-0100/G PASS: zero non-allowlisted process.cwd() across CLI source (mcp-tools, init, commands, memory)"
    rm -rf "$s" 2>/dev/null
    return
  fi

  # Failure path — surface the violation lines so the failure is debuggable
  # without spelunking through ${TEST_DIR}.
  local viol_count viol_lines
  viol_count=$(grep -c '^/' "$log")
  viol_count=${viol_count:-0}
  viol_lines=$(grep '^/' "$log" | head -5 | tr '\n' ';' | sed 's/;$//')
  _CHECK_OUTPUT="ADR-0100/G: gate failed (exit=$exit_code) — $viol_count violation(s); first hits: ${viol_lines:0:300}"
  # Keep $s for postmortem.
}
