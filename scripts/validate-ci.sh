#!/usr/bin/env bash
set -euo pipefail

# validate-ci.sh — Non-destructive CI health check (Layer -1)
# Reads state but changes nothing. Safe to run at any time.
# ADR-0023: Google Size Small, < 1s. Global timeout: 30s.

# --- Global timeout guard (30s) ---
( sleep 30; echo "[TIMEOUT] validate-ci.sh exceeded 30s — sending SIGTERM" >&2; kill -TERM -$$ 2>/dev/null || kill -TERM $$ 2>/dev/null || true; sleep 5; kill -KILL -$$ 2>/dev/null || kill -KILL $$ 2>/dev/null || true ) &
GLOBAL_TIMEOUT_PID=$!
trap 'kill "$GLOBAL_TIMEOUT_PID" 2>/dev/null || true' EXIT

# --- Timing helpers ---
T0=$(date +%s%N 2>/dev/null || echo "$(date +%s)000000000")
START_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ)

_now_ns() {
  date +%s%N 2>/dev/null || echo "$(date +%s)000000000"
}

_duration_ms() {
  local start_ns="$1" end_ns="$2"
  echo $(( (end_ns - start_ns) / 1000000 ))
}

# --- Counters ---
PASS=0; FAIL=0; WARN=0

check() {
  local label="$1"; shift
  local t_start; t_start=$(_now_ns)
  if eval "$@" >/dev/null 2>&1; then
    local t_end; t_end=$(_now_ns)
    local ms; ms=$(_duration_ms "$t_start" "$t_end")
    echo "  PASS  $label (${ms}ms)"; ((PASS++)) || true
  else
    local t_end; t_end=$(_now_ns)
    local ms; ms=$(_duration_ms "$t_start" "$t_end")
    echo "  FAIL  $label (${ms}ms)"; ((FAIL++)) || true
  fi
}

warn_check() {
  local label="$1"; shift
  local t_start; t_start=$(_now_ns)
  if eval "$@" >/dev/null 2>&1; then
    local t_end; t_end=$(_now_ns)
    local ms; ms=$(_duration_ms "$t_start" "$t_end")
    echo "  PASS  $label (${ms}ms)"; ((PASS++)) || true
  else
    local t_end; t_end=$(_now_ns)
    local ms; ms=$(_duration_ms "$t_start" "$t_end")
    echo "  WARN  $label (${ms}ms)"; ((WARN++)) || true
  fi
}

echo "[${START_TIME}] Environment validation starting"
echo ""

echo "=== Environment ==="
check "Node >= 20" \
  "node -e 'process.exit(+process.versions.node.split(\".\")[0] >= 20 ? 0 : 1)'"
check "pnpm available" \
  "command -v pnpm"
check "python3 available" \
  "command -v python3"
check "git available" \
  "command -v git"
check "jq available" \
  "command -v jq"
check "gh CLI available" \
  "command -v gh"

echo ""
echo "=== systemd ==="
warn_check "Timer unit exists" \
  "systemctl cat ruflo-sync.timer"
warn_check "Timer is enabled" \
  "systemctl is-enabled ruflo-sync.timer"
warn_check "Timer is active" \
  "systemctl is-active ruflo-sync.timer"
warn_check "Service unit exists" \
  "systemctl cat ruflo-sync.service"

echo ""
echo "=== Secrets ==="
check "Secrets file exists" \
  "test -f ~/.config/ruflo/secrets.env"
check "Secrets file perms are 600" \
  "test \$(stat -c %a ~/.config/ruflo/secrets.env) = 600"
check "Secrets directory perms are 700" \
  "test \$(stat -c %a ~/.config/ruflo) = 700"

echo ""
echo "=== Upstream clones ==="
check "ruflo clone exists" \
  "test -d ~/src/upstream/ruflo/.git"
check "agentic-flow clone exists" \
  "test -d ~/src/upstream/agentic-flow/.git"
check "ruv-FANN clone exists" \
  "test -d ~/src/upstream/ruv-FANN/.git"

echo ""
echo "=== Build state ==="
warn_check "Last build state file exists" \
  "test -f scripts/.last-build-state"

echo ""
echo "=== Verdaccio ==="
warn_check "verdaccio binary available" \
  "command -v verdaccio"

echo ""
echo "---"
T1=$(_now_ns)
TOTAL_MS=$(_duration_ms "$T0" "$T1")
END_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ)
echo "$PASS passed, $FAIL failed, $WARN warnings (${TOTAL_MS}ms)"
echo "[${END_TIME}] Environment validation complete"
exit $FAIL
