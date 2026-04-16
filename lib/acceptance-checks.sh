#!/usr/bin/env bash
# lib/acceptance-checks.sh — Acceptance test loader (ADR-0039 T2)
#
# Thin loader that defines shared helpers and sources individual check group
# files. The T1 sentinel-based _run_and_kill replaces the old file-size
# stability heuristic.
#
# Contract:
#   Caller MUST set:  REGISTRY, TEMP_DIR, PKG
#   Caller MAY set:   RUFLO_WRAPPER_PKG (e.g. "@sparkleideas/ruflo@3.5.7" — defaults to "@sparkleideas/ruflo@latest")
#   Caller MAY set:   COMPANION_TAG (dist-tag for agent-booster/plugins, e.g. "@prerelease")
#   Caller MUST define: run_timed (sets _OUT, _EXIT, _DURATION_MS)
#   Each check_* function sets: _CHECK_PASSED ("true"/"false"), _CHECK_OUTPUT

# ══════════════════════════════════════════════════════════════════════════════
# Shared helpers
# ══════════════════════════════════════════════════════════════════════════════

# Helper: resolve the CLI command. In context where packages are pre-installed in
# TEMP_DIR/node_modules, use the local binary to avoid npx re-installing
# all transitive deps (~30s, includes better-sqlite3 cc1 compile).
# In acceptance context (real npm, no pre-install), fall back to npx.
_cli_cmd() {
  local local_bin="${TEMP_DIR}/node_modules/.bin/cli"
  if [[ -x "$local_bin" ]]; then
    echo "$local_bin"
  else
    echo "npx --yes $PKG"
  fi
}

_booster_cmd() {
  local local_bin="${TEMP_DIR}/node_modules/.bin/agent-booster"
  if [[ -x "$local_bin" ]]; then
    echo "$local_bin"
  else
    echo "npx --yes @sparkleideas/agent-booster${COMPANION_TAG:-}"
  fi
}

# Run a CLI command and detect completion via sentinel line (ADR-0039 T1).
# CLI processes hang after completion (open SQLite handles) — this uses a
# sentinel to detect when the command has actually finished, then kills
# the process immediately instead of waiting for timeout.
# Usage: _run_and_kill "command string" [out_file] [max_seconds]
# Sets: _RK_OUT, _RK_EXIT
#
# Exit-code capture (fixed 2026-04-16): the backgrounded subshell records
# the command's exit code into the sentinel line as `__RUFLO_DONE__:<rc>`.
# On completion we parse it out. If the process was killed by us (sentinel
# not written), _RK_EXIT is set to 137 (SIGKILL convention) so callers can
# distinguish "command finished with some exit code" from "we had to kill
# it because it hung past the sentinel". Prior to this fix, _RK_EXIT was
# ALWAYS 0 because it captured $? from the immediately-preceding `cat`
# call, not from the command — silently defeating every `_RK_EXIT -eq 0`
# check in the acceptance suite.
_run_and_kill() {
  local cmd="$1" out_file="${2:-}" max_wait="${3:-8}"

  # Create temp file if caller did not provide one
  if [[ -z "$out_file" ]]; then
    out_file=$(mktemp /tmp/rk-XXXXX)
    local _rk_own_file="true"
  else
    local _rk_own_file="false"
  fi
  > "$out_file"

  # Run command in background; append sentinel with exit code when done.
  # The `rc=$?` capture happens IMMEDIATELY after the command, before any
  # other subshell statement can overwrite it. The sentinel line format
  # is stable (`__RUFLO_DONE__:<digits>`) — callers must not emit this
  # prefix in their own output (no known collisions in the suite).
  ( eval "$cmd" >> "$out_file" 2>&1; rc=$?; echo "__RUFLO_DONE__:$rc" >> "$out_file" ) &
  local pid=$!

  # Poll for sentinel or timeout
  local elapsed=0
  while (( $(echo "$elapsed < $max_wait" | bc) )); do
    sleep 0.25
    elapsed=$(echo "$elapsed + 0.25" | bc)
    if grep -q '__RUFLO_DONE__' "$out_file" 2>/dev/null; then
      break
    fi
    # Check if process already exited
    if ! kill -0 "$pid" 2>/dev/null; then
      sleep 0.1  # brief grace for sentinel write
      break
    fi
  done

  # Grace period for Node.js WAL flush + shutdown before killing
  # (RvfBackend.shutdown compacts WAL on beforeExit — needs ~1s)
  if kill -0 "$pid" 2>/dev/null; then
    sleep 1
  fi

  # Kill process tree if still running (prevents orphaned node children)
  # Record whether we had to kill it, so we can set _RK_EXIT=137 if the
  # sentinel is missing (differentiates "hung and killed" from "exited 0").
  local _rk_killed="false"
  if kill -0 "$pid" 2>/dev/null; then
    _rk_killed="true"
    pkill -P "$pid" 2>/dev/null || true   # kill children first
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  fi

  # Extract the exit code from the sentinel before stripping.
  # If no sentinel (killed or crashed before writing), _RK_EXIT=137.
  local _rk_sentinel_line
  _rk_sentinel_line=$(grep '^__RUFLO_DONE__:' "$out_file" 2>/dev/null | tail -1)
  if [[ -n "$_rk_sentinel_line" ]]; then
    _RK_EXIT="${_rk_sentinel_line##__RUFLO_DONE__:}"
    # Defensive: if the captured value isn't a valid integer (somehow), fall
    # back to 0 so arithmetic comparisons don't throw a bash error.
    [[ "$_RK_EXIT" =~ ^-?[0-9]+$ ]] || _RK_EXIT=0
  else
    _RK_EXIT=137
  fi

  # Strip sentinel line(s) from output
  sed '/^__RUFLO_DONE__:/d' "$out_file" > "${out_file}.tmp" && mv "${out_file}.tmp" "$out_file"

  # Set output variable for callers
  _RK_OUT=$(cat "$out_file")

  # Clean up temp file if we created it
  if [[ "$_rk_own_file" == "true" ]]; then
    rm -f "$out_file"
  fi
}

# ─────────────────────────────────────────────────────────────
# Read-only variant: same as _run_and_kill but skips the 1s
# WAL-flush grace period. Use for memory list/search, mcp exec
# queries, doctor, --version, health checks — anything that
# doesn't write.
# Usage: _run_and_kill_ro "command string" [out_file] [max_seconds]
# Sets: _RK_OUT, _RK_EXIT
# ─────────────────────────────────────────────────────────────
_run_and_kill_ro() {
  local cmd="$1" out_file="${2:-}" max_wait="${3:-8}"

  if [[ -z "$out_file" ]]; then
    out_file=$(mktemp /tmp/rk-XXXXX)
    local _rk_own_file="true"
  else
    local _rk_own_file="false"
  fi
  > "$out_file"

  # Same exit-code sentinel format as _run_and_kill (see docblock there).
  ( eval "$cmd" >> "$out_file" 2>&1; rc=$?; echo "__RUFLO_DONE__:$rc" >> "$out_file" ) &
  local pid=$!

  local elapsed=0
  while (( $(echo "$elapsed < $max_wait" | bc) )); do
    sleep 0.25
    elapsed=$(echo "$elapsed + 0.25" | bc)
    if grep -q '__RUFLO_DONE__' "$out_file" 2>/dev/null; then
      break
    fi
    if ! kill -0 "$pid" 2>/dev/null; then
      break
    fi
  done

  # NO grace period — read-only ops have no WAL to flush
  if kill -0 "$pid" 2>/dev/null; then
    pkill -P "$pid" 2>/dev/null || true
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  fi

  # Extract exit code from sentinel before stripping (see _run_and_kill)
  local _rk_sentinel_line
  _rk_sentinel_line=$(grep '^__RUFLO_DONE__:' "$out_file" 2>/dev/null | tail -1)
  if [[ -n "$_rk_sentinel_line" ]]; then
    _RK_EXIT="${_rk_sentinel_line##__RUFLO_DONE__:}"
    [[ "$_RK_EXIT" =~ ^-?[0-9]+$ ]] || _RK_EXIT=0
  else
    _RK_EXIT=137
  fi

  sed '/^__RUFLO_DONE__:/d' "$out_file" > "${out_file}.tmp" && mv "${out_file}.tmp" "$out_file"

  _RK_OUT=$(cat "$out_file")

  if [[ "$_rk_own_file" == "true" ]]; then
    rm -f "$out_file"
  fi
}

# ══════════════════════════════════════════════════════════════════════════════
# Source check group files
# ══════════════════════════════════════════════════════════════════════════════
_CHECKS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${_CHECKS_DIR}/acceptance-smoke-checks.sh"
source "${_CHECKS_DIR}/acceptance-structure-checks.sh"
source "${_CHECKS_DIR}/acceptance-diagnostic-checks.sh"
source "${_CHECKS_DIR}/acceptance-package-checks.sh"
source "${_CHECKS_DIR}/acceptance-controller-checks.sh"
source "${_CHECKS_DIR}/acceptance-security-checks.sh"
source "${_CHECKS_DIR}/acceptance-e2e-checks.sh"
source "${_CHECKS_DIR}/acceptance-init-checks.sh"
source "${_CHECKS_DIR}/acceptance-attention-checks.sh"
source "${_CHECKS_DIR}/acceptance-adr0069-f3-checks.sh"
source "${_CHECKS_DIR}/acceptance-adr0071-checks.sh"
source "${_CHECKS_DIR}/acceptance-adr0074-checks.sh"
source "${_CHECKS_DIR}/acceptance-adr0080-checks.sh"
source "${_CHECKS_DIR}/acceptance-adr0090-b1-checks.sh"
source "${_CHECKS_DIR}/acceptance-adr0090-b2-checks.sh"
source "${_CHECKS_DIR}/acceptance-adr0090-b3-checks.sh"
