#!/usr/bin/env bash
set -euo pipefail

# validate-ci.sh — Non-destructive CI health check
# Reads state but changes nothing. Safe to run at any time.

PASS=0; FAIL=0; WARN=0

check() {
  local label="$1"; shift
  if eval "$@" >/dev/null 2>&1; then
    echo "  PASS  $label"; ((PASS++))
  else
    echo "  FAIL  $label"; ((FAIL++))
  fi
}

warn_check() {
  local label="$1"; shift
  if eval "$@" >/dev/null 2>&1; then
    echo "  PASS  $label"; ((PASS++))
  else
    echo "  WARN  $label"; ((WARN++))
  fi
}

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
echo "$PASS passed, $FAIL failed, $WARN warnings"
exit $FAIL
