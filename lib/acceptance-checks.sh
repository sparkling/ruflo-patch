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

  # Run command in background; append sentinel when done
  ( eval "$cmd" >> "$out_file" 2>&1; echo "__RUFLO_DONE__" >> "$out_file" ) &
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

  # Kill process tree if still running (prevents orphaned node children)
  if kill -0 "$pid" 2>/dev/null; then
    pkill -P "$pid" 2>/dev/null || true   # kill children first
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  fi

  # Strip sentinel from output
  sed '/__RUFLO_DONE__/d' "$out_file" > "${out_file}.tmp" && mv "${out_file}.tmp" "$out_file"

  # Set output variable for callers
  _RK_OUT=$(cat "$out_file")
  _RK_EXIT=$?

  # Clean up temp file if we created it
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
