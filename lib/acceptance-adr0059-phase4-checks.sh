#!/usr/bin/env bash
# lib/acceptance-adr0059-phase4-checks.sh — ADR-0059 Phase 4 acceptance checks
#
# Daemon IPC: Unix domain socket communication between hooks and daemon.
#
# LIFECYCLE: The caller (test-acceptance.sh) manages the daemon lifecycle.
# These functions are pure assertions — they assume the daemon is already
# running (or stopped, for fallback). They do NOT start/stop the daemon.
#
# Requires: acceptance-checks.sh + acceptance-adr0059-checks.sh sourced first
# Caller MUST set: E2E_DIR, CLI_BIN, REGISTRY

# Safety: disable strict unset checking for these check functions.
set +u 2>/dev/null || true

# ════════════════════════════════════════════════════════════════════
# DAEMON IPC: socket exists, probe
# ════════════════════════════════════════════════════════════════════

check_adr0059_daemon_ipc_socket_exists() {
  # ADR-0207 (accepted 2026-05-20, shipped patch.273): DaemonIPCServer + the
  # Unix `.claude-flow/daemon.sock` were deleted; the daemon's control plane
  # is now PID file + `daemon-state.json` + CLI orchestration. This check is
  # retained under its historical name to keep the e2e-0059-p4 contract
  # stable, but its semantics are inverted: success means the daemon is
  # alive AND no socket file is present. A socket file appearing on a
  # post-0207 build would mean the IPC server got resurrected (regression).
  _CHECK_PASSED="false"
  local socket_path="$E2E_DIR/.claude-flow/daemon.sock"
  local pid_file="$E2E_DIR/.claude-flow/daemon.pid"
  local state_file="$E2E_DIR/.claude-flow/daemon-state.json"

  # Regression guard: socket must not exist on a post-ADR-0207 build.
  if [[ -S "$socket_path" || -e "$socket_path" ]]; then
    _CHECK_OUTPUT="FAIL: ADR-0207 regression — daemon.sock present at $socket_path (IPC server should be removed)"
    return
  fi

  # PID + state file together are the post-ADR-0207 "daemon is up" signal.
  if [[ -f "$pid_file" && -f "$state_file" ]]; then
    local pid; pid=$(cat "$pid_file" 2>/dev/null) || true
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      _CHECK_PASSED="true"
      _CHECK_OUTPUT="Daemon control plane up (PID $pid, state file present, no socket per ADR-0207)"
      return
    fi
  fi

  # Fall back to asking the daemon (handles bg-daemon detection nuances).
  _run_and_kill_ro "cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $CLI_BIN daemon status" "" 5
  if echo "$_RK_OUT" | grep -qi "running"; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="Daemon reports running; no socket present (ADR-0207 compliant)"
  else
    # Daemon not started — expected default per ADR-0088 (daemon is opt-in
    # for timer scheduler only). Counts toward invocation, not verification.
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: daemon not running (ADR-0088 daemon is opt-in)"
  fi
}

check_adr0059_daemon_ipc_probe() {
  # ADR-0207: socket removed. The "probe" now verifies that the absence is
  # honest: if a socket file exists it MUST be a real Unix domain socket
  # accepting connections (i.e. we did not regress to a stale file).
  # When the daemon is alive but no socket exists, that's the post-0207
  # compliant state and the check passes.
  _CHECK_PASSED="false"
  local socket_path="$E2E_DIR/.claude-flow/daemon.sock"
  local pid_file="$E2E_DIR/.claude-flow/daemon.pid"

  if [[ ! -e "$socket_path" ]]; then
    if [[ -f "$pid_file" ]]; then
      local pid; pid=$(cat "$pid_file" 2>/dev/null) || true
      if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
        _CHECK_PASSED="true"
        _CHECK_OUTPUT="No daemon.sock (ADR-0207 removed IPC server); daemon PID $pid alive"
        return
      fi
    fi
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: daemon not running (ADR-0088 daemon is opt-in)"
    return
  fi

  # Socket file present — this is a regression on post-0207 builds. Verify
  # the file is a real socket and not a stale leftover.
  local result
  result=$(node -e "
    const net = require('net');
    const fs = require('fs');
    const path = '$socket_path';
    const socket = net.createConnection(path, () => {
      console.log('CONNECTED');
      socket.destroy();
    });
    socket.on('error', (e) => { console.log('ERROR:' + e.code); });
    setTimeout(() => { socket.destroy(); console.log('TIMEOUT'); }, 2000);
  " 2>&1) || true

  if echo "$result" | grep -q "CONNECTED"; then
    _CHECK_OUTPUT="FAIL: ADR-0207 regression — daemon.sock is live and accepts connections"
  else
    _CHECK_OUTPUT="FAIL: ADR-0207 regression — daemon.sock file present (probe: $result)"
  fi
}

# ════════════════════════════════════════════════════════════════════
# DAEMON IPC: memory operations through socket
# ════════════════════════════════════════════════════════════════════

check_adr0059_daemon_ipc_store() {
  _CHECK_PASSED="false"
  local socket_path="$E2E_DIR/.claude-flow/daemon.sock"

  if [[ ! -e "$socket_path" ]]; then
    # Daemon is opt-in per ADR-0088 (IPC hot path retired; daemon scoped to timer scheduler only).
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: daemon socket absent (ADR-0088 retired IPC hot path; socket is opt-in)"
    return
  fi

  local result
  result=$(node -e "
    const net = require('net');
    const req = JSON.stringify({jsonrpc:'2.0',method:'memory.store',params:{key:'ipc-test-store',value:'daemon stored this via IPC',namespace:'ipc-test'},id:1}) + '\n';
    const socket = net.createConnection('$socket_path', () => { socket.write(req); });
    let data = '';
    socket.on('data', c => {
      data += c.toString();
      if (data.includes('\n')) { console.log(data.trim()); socket.destroy(); }
    });
    socket.on('error', e => { console.log('ERROR:' + e.message); });
    setTimeout(() => { socket.destroy(); if (!data) console.log('TIMEOUT'); }, 5000);
  " 2>&1) || true

  if echo "$result" | grep -qi '"result"'; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="memory.store via IPC returned result"
  elif echo "$result" | grep -qi 'success'; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="memory.store via IPC succeeded"
  elif echo "$result" | grep -qi 'TIMEOUT'; then
    _CHECK_OUTPUT="memory.store IPC timed out"
  else
    _CHECK_OUTPUT="memory.store IPC unexpected: $result"
  fi
}

check_adr0059_daemon_ipc_search() {
  _CHECK_PASSED="false"
  local socket_path="$E2E_DIR/.claude-flow/daemon.sock"

  if [[ ! -e "$socket_path" ]]; then
    # Daemon is opt-in per ADR-0088 (IPC hot path retired; daemon scoped to timer scheduler only).
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: daemon socket absent (ADR-0088 retired IPC hot path; socket is opt-in)"
    return
  fi

  # Store an entry first, then search for it
  node -e "
    const net = require('net');
    const req = JSON.stringify({jsonrpc:'2.0',method:'memory.store',params:{key:'ipc-search-entry',value:'OAuth PKCE flow for mobile authentication',namespace:'ipc-search'},id:1}) + '\n';
    const socket = net.createConnection('$socket_path', () => { socket.write(req); });
    let data = '';
    socket.on('data', c => {
      data += c.toString();
      if (data.includes('\n')) { socket.destroy(); }
    });
    socket.on('error', e => { console.log('ERROR:' + e.message); });
    setTimeout(() => { socket.destroy(); }, 5000);
  " 2>&1 || true

  local search_result
  search_result=$(node -e "
    const net = require('net');
    const req = JSON.stringify({jsonrpc:'2.0',method:'memory.search',params:{query:'OAuth authentication',namespace:'ipc-search',limit:5},id:2}) + '\n';
    const socket = net.createConnection('$socket_path', () => { socket.write(req); });
    let data = '';
    socket.on('data', c => {
      data += c.toString();
      if (data.includes('\n')) { console.log(data.trim()); socket.destroy(); }
    });
    socket.on('error', e => { console.log('ERROR:' + e.message); });
    setTimeout(() => { socket.destroy(); if (!data) console.log('TIMEOUT'); }, 8000);
  " 2>&1) || true

  if echo "$search_result" | grep -qi '"result"'; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="memory.search via IPC returned result"
  elif echo "$search_result" | grep -qi 'success\|results'; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="memory.search via IPC succeeded"
  elif echo "$search_result" | grep -qi 'TIMEOUT'; then
    _CHECK_OUTPUT="memory.search IPC timed out"
  else
    _CHECK_OUTPUT="memory.search IPC unexpected: $search_result"
  fi
}

check_adr0059_daemon_ipc_count() {
  _CHECK_PASSED="false"
  local socket_path="$E2E_DIR/.claude-flow/daemon.sock"

  if [[ ! -e "$socket_path" ]]; then
    # Daemon is opt-in per ADR-0088 (IPC hot path retired; daemon scoped to timer scheduler only).
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: daemon socket absent (ADR-0088 retired IPC hot path; socket is opt-in)"
    return
  fi

  local result
  result=$(node -e "
    const net = require('net');
    const req = JSON.stringify({jsonrpc:'2.0',method:'memory.count',params:{},id:3}) + '\n';
    const socket = net.createConnection('$socket_path', () => { socket.write(req); });
    let data = '';
    socket.on('data', c => {
      data += c.toString();
      if (data.includes('\n')) { console.log(data.trim()); socket.destroy(); }
    });
    socket.on('error', e => { console.log('ERROR:' + e.message); });
    setTimeout(() => { socket.destroy(); if (!data) console.log('TIMEOUT'); }, 5000);
  " 2>&1) || true

  if echo "$result" | grep -qi '"result"'; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="memory.count via IPC returned: $result"
  elif echo "$result" | grep -qE '[0-9]'; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="memory.count via IPC returned numeric result"
  elif echo "$result" | grep -qi 'TIMEOUT'; then
    _CHECK_OUTPUT="memory.count IPC timed out"
  else
    _CHECK_OUTPUT="memory.count IPC unexpected: $result"
  fi
}

check_adr0059_daemon_ipc_fallback() {
  _CHECK_PASSED="false"

  # Ensure daemon is NOT running (caller should have stopped it already)
  _run_and_kill "cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $CLI_BIN daemon stop" "" 5
  rm -f "$E2E_DIR/.claude-flow/daemon.sock" 2>/dev/null || true

  # Run hook import — should work via direct RVF fallback
  local result
  result=$(_adr0059_run_hook "auto-memory-hook.mjs" "import") || true
  [[ "$result" == "SKIP" ]] && { _CHECK_PASSED="true"; _CHECK_OUTPUT="Hook not present"; return; }

  # Should not crash
  if echo "$result" | grep -qiE '(fatal|unhandled|SIGSEGV)'; then
    _CHECK_OUTPUT="Hook crashed without daemon: $result"
  else
    _CHECK_PASSED="true"
    if echo "$result" | grep -qiE '(import|memory|skipping|AutoMemory)'; then
      _CHECK_OUTPUT="Hook ran without daemon (direct fallback OK)"
    else
      _CHECK_OUTPUT="Hook ran without errors (daemon not required)"
    fi
  fi
}
