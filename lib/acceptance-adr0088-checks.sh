#!/usr/bin/env bash
# lib/acceptance-adr0088-checks.sh — ADR-0088 acceptance checks
#
# Daemon Scope Alignment — verify the daemon is scoped to a cross-platform
# worker scheduler only:
#   - Dead code (DaemonIPCClient, memory.* IPC handlers, Phase 4 wording)
#     is absent from the published @sparkleideas/cli package
#   - `daemon status` output prints "AI Mode:" and NEVER prints
#     "IPC Socket: LISTENING", "Phase 4", or "Daemon IPC: Active"
#   - `init --full` only wires `daemon start --quiet` to SessionStart
#     when `claude` CLI is reachable on PATH
#   - `daemon start --quiet && daemon status` still succeeds in local mode
#     (headless-AI workers degrade to placeholder mode, not error out)
#
# Requires: acceptance-checks.sh sourced first (_run_and_kill, _run_and_kill_ro,
#           _cli_cmd, _e2e_isolate helpers available)
# Caller MUST set: TEMP_DIR, E2E_DIR, CLI_BIN, REGISTRY

# ════════════════════════════════════════════════════════════════════
# Helper: find the @sparkleideas/cli package directory
# ════════════════════════════════════════════════════════════════════

_adr0088_find_cli_pkg() {
  local pkg_dir=""
  pkg_dir=$(find "$TEMP_DIR" -path "*/node_modules/@sparkleideas/cli" -not -path "*/.iso-*" -type d 2>/dev/null | head -1)
  if [ -z "$pkg_dir" ]; then
    pkg_dir=$(find "$E2E_DIR" -path "*/node_modules/@sparkleideas/cli" -not -path "*/.iso-*" -type d 2>/dev/null | head -1)
  fi
  echo "$pkg_dir"
}

# ════════════════════════════════════════════════════════════════════
# ADR-0088-1: DaemonIPCClient absent from published package
#
# ADR-0088 §Decision item 1 deletes the class entirely. It had zero
# in-tree callers and contradicted ADR-050 (hot path is file-based,
# no daemon). Any surviving reference in published dist is a regression.
# ════════════════════════════════════════════════════════════════════

check_adr0088_no_ipc_client() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local cli_pkg_dir
  cli_pkg_dir=$(_adr0088_find_cli_pkg)

  if [ -z "$cli_pkg_dir" ]; then
    _CHECK_OUTPUT="ADR-0088-1: could not locate @sparkleideas/cli package in node_modules"
    return
  fi

  # grep -r will walk the package, including any nested node_modules — we
  # confine the search to dist/ and .claude/ which are the publish targets.
  # Each grep runs in its own subshell; we collect non-empty results into
  # an array so no blank lines sneak past.
  local -a hits=()
  local f

  if [[ -d "$cli_pkg_dir/dist" ]]; then
    while IFS= read -r f; do
      [[ -z "$f" ]] && continue
      hits+=("$f")
    done < <(grep -rl 'DaemonIPCClient' "$cli_pkg_dir/dist" 2>/dev/null | head -5)
  fi
  if [[ -d "$cli_pkg_dir/.claude" ]]; then
    while IFS= read -r f; do
      [[ -z "$f" ]] && continue
      hits+=("$f")
    done < <(grep -rl 'DaemonIPCClient' "$cli_pkg_dir/.claude" 2>/dev/null | head -5)
  fi

  if [[ ${#hits[@]} -gt 0 ]]; then
    local short=""
    for f in "${hits[@]}"; do
      short+=" ${f#${cli_pkg_dir}/}"
    done
    _CHECK_OUTPUT="ADR-0088-1: DaemonIPCClient still referenced in published package:${short}"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0088-1: DaemonIPCClient absent from published package (dead code deletion confirmed)"
}

# ════════════════════════════════════════════════════════════════════
# ADR-0088-2: `daemon status` prints AI Mode, not Phase 4 or IPC Socket
#
# ADR-0088 §Decision item 9 replaces the misleading
#   "IPC Socket: LISTENING" file-existence theatre with
#   "AI Mode: headless" | "AI Mode: local"
# based on the live capability probe.
# ════════════════════════════════════════════════════════════════════

check_adr0088_status_output() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local cli; cli=$(_cli_cmd)

  if [[ -z "${E2E_DIR:-}" || ! -d "$E2E_DIR" ]]; then
    _CHECK_OUTPUT="ADR-0088-2: E2E_DIR not set or missing"
    return
  fi

  _run_and_kill_ro "cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli daemon status" "" 10
  local out="$_RK_OUT"

  # Positive assertion: the new honest label must appear
  if ! echo "$out" | grep -q 'AI Mode:'; then
    _CHECK_OUTPUT="ADR-0088-2: 'AI Mode:' missing from daemon status output: $(echo "$out" | head -15 | tr '\n' ' ')"
    return
  fi

  # Negative assertions: the deleted labels must not appear
  if echo "$out" | grep -q 'IPC Socket: LISTENING'; then
    _CHECK_OUTPUT="ADR-0088-2: 'IPC Socket: LISTENING' still printed by daemon status"
    return
  fi

  if echo "$out" | grep -q 'Phase 4'; then
    _CHECK_OUTPUT="ADR-0088-2: 'Phase 4' wording still printed by daemon status"
    return
  fi

  if echo "$out" | grep -q 'Daemon IPC: Active'; then
    _CHECK_OUTPUT="ADR-0088-2: 'Daemon IPC: Active' still printed by daemon status"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0088-2: daemon status prints 'AI Mode:' and no Phase 4 / IPC Socket wording"
}

# ════════════════════════════════════════════════════════════════════
# ADR-0088-3: init without claude on PATH → no daemon-start SessionStart
#
# ADR-0088 §Decision item 8: capability-gated wiring. Without `claude`
# on PATH, `init --full` must NOT append the daemon-start hook. We run
# init inside an isolated sandbox with PATH stripped of claude-style
# binaries and parse .claude/settings.json.
# ════════════════════════════════════════════════════════════════════

check_adr0088_conditional_init_no_claude() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local cli; cli=$(_cli_cmd)

  # Fresh isolated dir — do NOT reuse E2E_DIR, init modifies cwd.
  local iso="${TMPDIR:-/tmp}/adr0088-init-no-claude-$$-$RANDOM"
  rm -rf "$iso" 2>/dev/null || true
  mkdir -p "$iso"

  # Stripped PATH: /usr/bin and /bin only. macOS ships no 'claude' there.
  # Node itself must be reachable — find its directory and prepend it so
  # npx/cli can locate `node` while still hiding any host-installed claude
  # that lives in a non-standard location (e.g. ~/.claude/local/bin).
  local node_dir=""
  if command -v node >/dev/null 2>&1; then
    node_dir=$(dirname "$(command -v node)")
  fi
  local stripped_path="${node_dir:+${node_dir}:}/usr/bin:/bin"

  # Sanity: confirm the stripped PATH does NOT have claude.
  if PATH="$stripped_path" command -v claude >/dev/null 2>&1; then
    _CHECK_OUTPUT="ADR-0088-3: stripped PATH unexpectedly has claude — cannot run this test on this host (node_dir=$node_dir)"
    rm -rf "$iso" 2>/dev/null
    return
  fi

  _run_and_kill "cd '$iso' && PATH='$stripped_path' NPM_CONFIG_REGISTRY='$REGISTRY' CLAUDE_FLOW_INTELLIGENCE_DISABLED=1 $cli init --full --force" "" 90

  local settings="$iso/.claude/settings.json"
  if [[ ! -f "$settings" ]]; then
    _CHECK_OUTPUT="ADR-0088-3: init did not produce .claude/settings.json in sandbox $iso: $(echo "$_RK_OUT" | tail -5 | tr '\n' ' ')"
    rm -rf "$iso" 2>/dev/null
    return
  fi

  # Use node -e to parse settings.json and walk SessionStart.hooks for the
  # daemon-start command. Bash grep is not structured enough to tell apart
  # the daemon-start hook from other commands that might legitimately
  # mention "daemon" in a different context.
  local check_out
  check_out=$(node -e "
    const s = JSON.parse(require('fs').readFileSync('$settings', 'utf-8'));
    const groups = s.hooks && s.hooks.SessionStart;
    if (!Array.isArray(groups)) { console.log('NO_SESSIONSTART'); process.exit(0); }
    const cmds = [];
    for (const g of groups) {
      if (Array.isArray(g.hooks)) {
        for (const h of g.hooks) {
          if (h && typeof h.command === 'string') cmds.push(h.command);
        }
      }
    }
    const daemonHook = cmds.find(c => /daemon\s+start/.test(c) && /--quiet/.test(c));
    const autoMem = cmds.some(c => /auto-memory-hook/.test(c));
    if (daemonHook) {
      console.log('HAS_DAEMON_START:' + daemonHook);
    } else {
      console.log('NO_DAEMON_START:' + (autoMem ? 'auto-memory-ok' : 'no-auto-memory') + ':count=' + cmds.length);
    }
  " 2>&1) || check_out="NODE_ERROR:$check_out"

  rm -rf "$iso" 2>/dev/null

  if [[ "$check_out" == HAS_DAEMON_START:* ]]; then
    _CHECK_OUTPUT="ADR-0088-3: daemon-start wired despite no claude on PATH — ${check_out#HAS_DAEMON_START:}"
    return
  fi
  if [[ "$check_out" == NO_SESSIONSTART ]]; then
    _CHECK_OUTPUT="ADR-0088-3: settings.json has no SessionStart section — init is broken, not just this ADR"
    return
  fi
  if [[ "$check_out" == NODE_ERROR:* ]]; then
    _CHECK_OUTPUT="ADR-0088-3: settings.json parse failed: ${check_out#NODE_ERROR:}"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0088-3: init without claude on PATH does NOT wire daemon-start (${check_out})"
}

# ════════════════════════════════════════════════════════════════════
# ADR-0088-4: init WITH claude on PATH → daemon-start IS wired
#
# ADR-0088 §Decision item 8: capability-gated wiring. We plant a
# zero-exit `claude` shim on PATH and run init. The SessionStart hook
# list must include the daemon-start entry.
# ════════════════════════════════════════════════════════════════════

check_adr0088_conditional_init_with_claude() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local cli; cli=$(_cli_cmd)

  local iso="${TMPDIR:-/tmp}/adr0088-init-with-claude-$$-$RANDOM"
  rm -rf "$iso" 2>/dev/null || true
  mkdir -p "$iso"

  # Plant a fake `claude` that exits 0 → `which claude` succeeds → headless.
  local shim_dir="$iso/fake-bin"
  mkdir -p "$shim_dir"
  cat > "$shim_dir/claude" <<'CLAUDESHIM'
#!/bin/sh
exit 0
CLAUDESHIM
  chmod +x "$shim_dir/claude"

  # Prepend shim so `which claude` picks ours regardless of host state.
  # Also keep node's directory on PATH so npx/cli can find `node`.
  local node_dir=""
  if command -v node >/dev/null 2>&1; then
    node_dir=$(dirname "$(command -v node)")
  fi
  local fake_path="${shim_dir}${node_dir:+:${node_dir}}:/usr/bin:/bin"

  _run_and_kill "cd '$iso' && PATH='$fake_path' NPM_CONFIG_REGISTRY='$REGISTRY' CLAUDE_FLOW_INTELLIGENCE_DISABLED=1 $cli init --full --force" "" 90

  local settings="$iso/.claude/settings.json"
  if [[ ! -f "$settings" ]]; then
    _CHECK_OUTPUT="ADR-0088-4: init did not produce .claude/settings.json in sandbox $iso: $(echo "$_RK_OUT" | tail -5 | tr '\n' ' ')"
    rm -rf "$iso" 2>/dev/null
    return
  fi

  local check_out
  check_out=$(node -e "
    const s = JSON.parse(require('fs').readFileSync('$settings', 'utf-8'));
    const groups = s.hooks && s.hooks.SessionStart;
    if (!Array.isArray(groups)) { console.log('NO_SESSIONSTART'); process.exit(0); }
    const cmds = [];
    for (const g of groups) {
      if (Array.isArray(g.hooks)) {
        for (const h of g.hooks) {
          if (h && typeof h.command === 'string') cmds.push(h.command);
        }
      }
    }
    const daemonHook = cmds.find(c => /daemon\s+start/.test(c) && /--quiet/.test(c));
    const autoMem = cmds.some(c => /auto-memory-hook/.test(c));
    if (daemonHook && autoMem) {
      console.log('OK:both');
    } else if (daemonHook) {
      console.log('OK:daemon-only');
    } else {
      console.log('MISSING_DAEMON:count=' + cmds.length);
    }
  " 2>&1) || check_out="NODE_ERROR:$check_out"

  rm -rf "$iso" 2>/dev/null

  if [[ "$check_out" == OK:* ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0088-4: init with fake claude on PATH wires daemon-start (${check_out})"
    return
  fi
  if [[ "$check_out" == MISSING_DAEMON:* ]]; then
    _CHECK_OUTPUT="ADR-0088-4: daemon-start NOT wired despite claude on PATH (${check_out})"
    return
  fi
  if [[ "$check_out" == NO_SESSIONSTART ]]; then
    _CHECK_OUTPUT="ADR-0088-4: settings.json has no SessionStart section"
    return
  fi
  if [[ "$check_out" == NODE_ERROR:* ]]; then
    _CHECK_OUTPUT="ADR-0088-4: settings.json parse failed: ${check_out#NODE_ERROR:}"
    return
  fi

  _CHECK_OUTPUT="ADR-0088-4: unexpected check output: $check_out"
}

# ════════════════════════════════════════════════════════════════════
# ADR-0088-5: daemon still works in local mode
#
# ADR-0088 §Consequences: "Users without claude CLI on PATH get no
# auto-start — defensible because the daemon cannot do anything useful
# for them anyway". But if they invoke it manually, it MUST still start
# cleanly, print "AI Mode: local", and not error out.
#
# We run the start + status calls in the existing E2E_DIR (which is
# already a full init'd project). No shim — we assume the host does not
# have `claude` installed. If it does, the check reports "headless"
# which is also valid per ADR-0088.
# ════════════════════════════════════════════════════════════════════

check_adr0088_daemon_still_works() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local cli; cli=$(_cli_cmd)

  if [[ -z "${E2E_DIR:-}" || ! -d "$E2E_DIR" ]]; then
    _CHECK_OUTPUT="ADR-0088-5: E2E_DIR not set or missing"
    return
  fi

  # Use an isolated copy so we don't collide with Phase 4's shared daemon.
  local iso; iso=$(_e2e_isolate "adr0088-daemon")
  mkdir -p "$iso/.claude-flow" 2>/dev/null || true

  # Start the daemon (quiet mode — minimal output)
  _run_and_kill "cd '$iso' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli daemon start --quiet" "" 10
  local start_out="$_RK_OUT"

  # Query status — we expect a clean response with the AI Mode line
  _run_and_kill_ro "cd '$iso' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli daemon status" "" 10
  local status_out="$_RK_OUT"

  # Try to stop the daemon so we don't leak a process between checks.
  _run_and_kill "cd '$iso' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli daemon stop" "" 5 || true
  rm -rf "$iso" 2>/dev/null

  # daemon start may print the "[Daemon] Starting in …" line to stderr
  # (logger) — the --quiet flag suppresses most output but honest startup
  # messaging should stay unless the command exited with a hard error.
  if echo "$start_out" | grep -qi 'error\|cannot find module\|traceback'; then
    _CHECK_OUTPUT="ADR-0088-5: daemon start reported an error: $(echo "$start_out" | head -5 | tr '\n' ' ')"
    return
  fi

  if ! echo "$status_out" | grep -q 'AI Mode:'; then
    _CHECK_OUTPUT="ADR-0088-5: daemon status missing 'AI Mode:' line: $(echo "$status_out" | head -15 | tr '\n' ' ')"
    return
  fi

  # AI Mode must be either 'local' or 'headless' — anything else is a bug.
  local mode=""
  if echo "$status_out" | grep -q 'AI Mode:[[:space:]]*local'; then
    mode="local"
  elif echo "$status_out" | grep -q 'AI Mode:[[:space:]]*headless'; then
    mode="headless"
  else
    _CHECK_OUTPUT="ADR-0088-5: AI Mode is neither 'local' nor 'headless': $(echo "$status_out" | grep 'AI Mode' | head -1)"
    return
  fi

  # Final negative checks — the legacy wording must be gone even when the
  # daemon is actively running.
  if echo "$status_out" | grep -q 'IPC Socket: LISTENING'; then
    _CHECK_OUTPUT="ADR-0088-5: running-daemon status still prints 'IPC Socket: LISTENING'"
    return
  fi
  if echo "$status_out" | grep -q 'Phase 4'; then
    _CHECK_OUTPUT="ADR-0088-5: running-daemon status still prints 'Phase 4' wording"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0088-5: daemon start --quiet + daemon status succeed (AI Mode: ${mode})"
}
