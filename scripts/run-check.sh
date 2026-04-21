#!/usr/bin/env bash
# scripts/run-check.sh — Run a single acceptance check by name.
#
# Usage:
#   bash scripts/run-check.sh check_t1_4_sqlite_verify
#   bash scripts/run-check.sh t1-4          # fuzzy match
#   bash scripts/run-check.sh t1            # runs all t1-* checks
#   bash scripts/run-check.sh --list        # list all available checks
#
# Requires: a prior `npm run test:acceptance` or `test-acceptance-fast.sh`
# run so temp dirs exist. Creates one if needed (~60s).
set -o pipefail

REGISTRY="${REGISTRY:-http://localhost:4873}"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# ── Find or create harness ──────────────────────────────────────────
ACCEPT_TEMP=""
for d in /tmp/ruflo-accept-* /tmp/ruflo-fast-*; do
  [[ -d "$d" ]] || continue
  for _c in ruflo claude-flow cli; do
    [[ -x "$d/node_modules/.bin/$_c" ]] && { ACCEPT_TEMP="$d"; break 2; }
  done
done

if [[ -z "$ACCEPT_TEMP" ]]; then
  ACCEPT_TEMP=$(mktemp -d /tmp/ruflo-fast-XXXXX)
  echo "[run-check] No harness found. Installing packages to $ACCEPT_TEMP (~15s)..."
  (cd "$ACCEPT_TEMP" \
    && echo '{"name":"check-test","version":"1.0.0","private":true}' > package.json \
    && npm install @sparkleideas/cli @sparkleideas/memory --registry "$REGISTRY" --no-audit --no-fund --prefer-offline 2>&1 | tail -1)
fi

TEMP_DIR="$ACCEPT_TEMP"
export ACCEPT_TEMP TEMP_DIR
PKG="@sparkleideas/cli"
CLI_BIN=""
for _c in ruflo claude-flow cli; do
  if [[ -x "${ACCEPT_TEMP}/node_modules/.bin/$_c" ]]; then CLI_BIN="${ACCEPT_TEMP}/node_modules/.bin/$_c"; break; fi
done

# Find or create E2E project
E2E_DIR=""
for d in /tmp/ruflo-e2e-*; do
  [[ -f "$d/.claude/settings.json" ]] && { E2E_DIR="$d"; break; }
done
if [[ -z "$E2E_DIR" ]]; then
  E2E_DIR=$(mktemp -d /tmp/ruflo-e2e-XXXXX)
  echo "[run-check] Creating E2E project at $E2E_DIR (~60s)..."
  (cd "$E2E_DIR" && NPM_CONFIG_REGISTRY="$REGISTRY" timeout 120 "$CLI_BIN" init --full --force >/dev/null 2>&1) || true
fi
export E2E_DIR

# ── Source ALL check libraries ──────────────────────────────────────
source "$PROJECT_DIR/lib/acceptance-harness.sh" 2>/dev/null || true
source "$PROJECT_DIR/lib/acceptance-checks.sh"
for f in "$PROJECT_DIR"/lib/acceptance-*-checks.sh; do
  [[ -f "$f" ]] && source "$f"
done

# ── List mode ───────────────────────────────────────────────────────
if [[ "$1" == "--list" || "$1" == "-l" ]]; then
  echo "Available checks:"
  declare -F | awk '{print $3}' | grep '^check_' | sort
  exit 0
fi

# ── Resolve function name ───────────────────────────────────────────
input="${1:?Usage: run-check.sh <check_name|short_name|--list>}"
matches=()

if declare -f "$input" &>/dev/null; then
  matches=("$input")
else
  fuzzy=$(echo "$input" | tr '-' '_')
  while IFS= read -r fn; do
    matches+=("$fn")
  done < <(declare -F | awk '{print $3}' | grep "check_${fuzzy}")
fi

if [[ ${#matches[@]} -eq 0 ]]; then
  echo "No check matching '$input'. Use --list to see available checks."
  exit 1
fi

# ── Run ─────────────────────────────────────────────────────────────
pass=0 fail=0
echo "[run-check] harness=$ACCEPT_TEMP  e2e=$E2E_DIR"
echo ""

for fn in "${matches[@]}"; do
  _CHECK_PASSED="false"; _CHECK_OUTPUT=""
  t0=$(date +%s%N 2>/dev/null || echo 0)
  "$fn" 2>&1
  t1=$(date +%s%N 2>/dev/null || echo 0)
  ms=$(( (t1 - t0) / 1000000 ))
  if [[ "$_CHECK_PASSED" == "true" ]]; then
    pass=$((pass + 1))
    printf "  \033[32mPASS\033[0m  %s (%sms): %s\n" "$fn" "$ms" "${_CHECK_OUTPUT:-ok}"
  else
    fail=$((fail + 1))
    printf "  \033[31mFAIL\033[0m  %s (%sms): %s\n" "$fn" "$ms" "${_CHECK_OUTPUT:-no output}"
  fi
done

echo ""
echo "Result: $pass/$((pass+fail)) passed, $fail failed"
exit $fail
