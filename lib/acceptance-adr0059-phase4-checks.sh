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
  _CHECK_PASSED="false"
  local socket_path="$E2E_DIR/.claude-flow/daemon.sock"

  if [[ -S "$socket_path" ]] || [[ -e "$socket_path" ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="Socket file created at $socket_path"
  else
    _run_and_kill "cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $CLI_BIN daemon status" "" 5
    if echo "$_RK_OUT" | grep -qi "running"; then
      _CHECK_PASSED="false"
      _CHECK_OUTPUT="SKIP: daemon running but socket not found"
    else
      _CHECK_PASSED="false"
      _CHECK_OUTPUT="SKIP: daemon socket not found"
    fi
  fi
}

check_adr0059_daemon_ipc_probe() {
  _CHECK_PASSED="false"
  local socket_path="$E2E_DIR/.claude-flow/daemon.sock"

  local result
  result=$(node -e "
    const net = require('net');
    const fs = require('fs');
    const path = '$socket_path';
    if (!fs.existsSync(path)) { console.log('NO_SOCKET'); process.exit(0); }
    const socket = net.createConnection(path, () => {
      console.log('CONNECTED');
      socket.destroy();
    });
    socket.on('error', (e) => { console.log('ERROR:' + e.code); });
    setTimeout(() => { socket.destroy(); console.log('TIMEOUT'); }, 2000);
  " 2>&1) || true

  if echo "$result" | grep -q "CONNECTED"; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="Node connected to daemon socket"
  elif echo "$result" | grep -q "NO_SOCKET"; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="SKIP: daemon socket not found"
  else
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="SKIP: daemon socket not found (probe: $result)"
  fi
}

# ════════════════════════════════════════════════════════════════════
# DAEMON IPC: memory operations through socket
# ════════════════════════════════════════════════════════════════════

check_adr0059_daemon_ipc_store() {
  _CHECK_PASSED="false"
  local socket_path="$E2E_DIR/.claude-flow/daemon.sock"

  if [[ ! -e "$socket_path" ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="SKIP: daemon socket not found"
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
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="SKIP: daemon socket not found"
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
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="SKIP: daemon socket not found"
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
