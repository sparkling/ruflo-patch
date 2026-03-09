#!/usr/bin/env bash
# scripts/test-acceptance.sh -- Layer 4 production verification (ADR-0023)
#
# Validates the end-user experience by running ruflo commands
# against published packages (local Verdaccio or real npm).
#
# Usage:
#   bash scripts/test-acceptance.sh [--registry <url>] [--version <ver>] [--package <name>]
#
# Exit code: number of failed tests (0 = all pass)
set -uo pipefail

# ── Defaults ────────────────────────────────────────────────────────
REGISTRY="https://registry.npmjs.org"
VERSION="@latest"
PACKAGE_NAME="@sparkleideas/cli"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RESULTS_DIR="$PROJECT_ROOT/test-results/$TIMESTAMP"
TEMP_DIR=""

PASS_COUNT=0
FAIL_COUNT=0
TOTAL_COUNT=0
TEST_RESULTS_JSON="[]"

# ── Argument parsing ────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --registry)
      REGISTRY="$2"
      shift 2
      ;;
    --version)
      VERSION="@$2"
      shift 2
      ;;
    --package)
      PACKAGE_NAME="$2"
      shift 2
      ;;
    -h|--help)
      echo "Usage: bash scripts/test-acceptance.sh [--registry <url>] [--version <ver>] [--package <name>]"
      echo ""
      echo "Options:"
      echo "  --registry <url>    npm registry URL (default: https://registry.npmjs.org)"
      echo "  --version <ver>     specific version to test (default: @latest)"
      echo "  --package <name>    package name to test (default: @sparkleideas/cli)"
      exit 0
      ;;
    *)
      echo "Unknown argument: $1"
      exit 1
      ;;
  esac
done

PKG="${PACKAGE_NAME}${VERSION}"

# Wrapper package version — when testing a specific CLI version (not @latest),
# use the wrapper's own version from package.json with @prerelease tag.
if [[ "$VERSION" == "@latest" ]]; then
  RUFLO_WRAPPER_PKG="@sparkleideas/ruflo@latest"
else
  _WRAPPER_VER=$(node -e "console.log(require('$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/package.json').version)" 2>/dev/null) || _WRAPPER_VER=""
  if [[ -n "$_WRAPPER_VER" ]]; then
    RUFLO_WRAPPER_PKG="@sparkleideas/ruflo@${_WRAPPER_VER}"
  else
    RUFLO_WRAPPER_PKG="@sparkleideas/ruflo@prerelease"
  fi
fi

# ── Isolated npm/npx cache ────────────────────────────────────────
# Use a fresh npm cache so npx never resolves stale cached versions.
# This is the only reliable way to ensure npx fetches the latest from
# the registry — clearing ~/.npm/_npx is a race condition with npm's
# internal lock files and index cache.
ACCEPT_NPX_CACHE=$(mktemp -d /tmp/ruflo-accept-cache-XXXXX)
export NPM_CONFIG_CACHE="$ACCEPT_NPX_CACHE"

# Global timeout — Layer 4 must complete within 600s (ADR-0023: Large < 900s)
( sleep 600; echo "[TIMEOUT] test-acceptance.sh exceeded 600s — sending SIGTERM" >&2; kill -TERM -$$ 2>/dev/null || kill -TERM $$ 2>/dev/null || true; sleep 5; kill -KILL -$$ 2>/dev/null || kill -KILL $$ 2>/dev/null || true ) &
GLOBAL_TIMEOUT_PID=$!

# ── Cleanup trap ────────────────────────────────────────────────────
cleanup() {
  kill "$GLOBAL_TIMEOUT_PID" 2>/dev/null || true
  if [[ -n "$TEMP_DIR" && -d "$TEMP_DIR" ]]; then
    rm -rf "$TEMP_DIR"
  fi
  if [[ -n "${ACCEPT_NPX_CACHE:-}" && -d "${ACCEPT_NPX_CACHE:-}" ]]; then
    rm -rf "$ACCEPT_NPX_CACHE"
  fi
}
trap cleanup EXIT INT TERM

# ── Helpers ─────────────────────────────────────────────────────────
create_temp_dir() {
  TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ruflo-accept-XXXXXX")"
}

# Run a command, capture output and duration.
# Sets: _OUT, _EXIT, _DURATION_MS
run_timed() {
  local start_ns end_ns
  start_ns=$(date +%s%N 2>/dev/null || echo 0)
  _OUT="$(timeout 60 bash -c "$*" 2>&1)" || true
  _EXIT=${PIPESTATUS[0]:-$?}
  end_ns=$(date +%s%N 2>/dev/null || echo 0)
  if [[ "$start_ns" == "0" || "$end_ns" == "0" ]]; then
    _DURATION_MS=0
  else
    _DURATION_MS=$(( (end_ns - start_ns) / 1000000 ))
  fi
  if [[ $_DURATION_MS -gt 30000 ]]; then
    echo "  SLOW  $(date -u +%H:%M:%S) — last command took ${_DURATION_MS}ms (threshold: 30s)" >&2
  fi
}

# Record a test result. Args: id, name, passed (true/false), output, duration_ms
record_result() {
  local id="$1" name="$2" passed="$3" output="$4" duration_ms="$5"
  TOTAL_COUNT=$((TOTAL_COUNT + 1))

  # Escape output for JSON (newlines, quotes, backslashes, tabs)
  local escaped_output
  escaped_output=$(printf '%s' "$output" | head -c 4096 | python3 -c '
import sys, json
data = sys.stdin.read()
print(json.dumps(data), end="")
' 2>/dev/null || echo '""')

  if [[ "$passed" == "true" ]]; then
    PASS_COUNT=$((PASS_COUNT + 1))
    echo "  PASS  $id: $name"
  else
    FAIL_COUNT=$((FAIL_COUNT + 1))
    echo "  FAIL  $id: $name"
    # Show first few lines of output on failure
    echo "$output" | head -5 | sed 's/^/        /'
  fi

  # Append to JSON array
  local entry
  entry=$(printf '{"id":"%s","name":"%s","passed":%s,"output":%s,"duration_ms":%d}' \
    "$id" "$name" "$passed" "$escaped_output" "$duration_ms")

  if [[ "$TEST_RESULTS_JSON" == "[]" ]]; then
    TEST_RESULTS_JSON="[$entry]"
  else
    TEST_RESULTS_JSON="${TEST_RESULTS_JSON%]}, $entry]"
  fi
}

# ── Source shared test library (ADR-0023) ──────────────────────────
ACCEPTANCE_LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib/acceptance-checks.sh"
if [[ ! -f "$ACCEPTANCE_LIB" ]]; then
  echo "ERROR: Shared test library not found: $ACCEPTANCE_LIB" >&2
  exit 1
fi
# shellcheck source=../lib/acceptance-checks.sh
source "$ACCEPTANCE_LIB"

# ── Adapter: run shared checks through record_result ───────────────
# Maps shared check_* functions (which set _CHECK_PASSED, _CHECK_OUTPUT)
# to the acceptance test result recording format.
run_acceptance_check() {
  local a_id="$1" a_name="$2" check_fn="$3"
  echo "Running $a_id: $a_name..."
  "$check_fn"
  record_result "$a_id" "$a_name" "$_CHECK_PASSED" "${_CHECK_OUTPUT:-$_OUT}" "${_DURATION_MS:-0}"
}

# ── Registry-specific tests (Layer 4 only) ─────────────────────────

# A0 now uses the shared check_latest_resolves from lib/acceptance-checks.sh

test_a8_no_broken_versions() {
  # Verify that npm resolves @sparkleideas/cli@latest to a version with
  # a working dist/ directory. Under ADR-0027, all versions use
  # {upstream}-patch.N format — the -patch suffix is expected.
  # This test catches the old broken 3.5.2-patch.1 (no dist/) by
  # verifying the resolved version can actually run.
  local start_ns end_ns
  start_ns=$(date +%s%N 2>/dev/null || echo 0)
  local output passed="false"

  local resolved_version
  resolved_version=$(NPM_CONFIG_REGISTRY="$REGISTRY" npm view @sparkleideas/cli@latest version 2>/dev/null) || true

  if [[ -n "$resolved_version" ]]; then
    # Verify the resolved version has a working CLI entry point
    local has_bin
    has_bin=$(NPM_CONFIG_REGISTRY="$REGISTRY" npm view "@sparkleideas/cli@${resolved_version}" bin --json 2>/dev/null) || true
    if [[ -n "$has_bin" && "$has_bin" != "{}" ]]; then
      passed="true"
      output="@sparkleideas/cli@latest = $resolved_version (has bin entries)"
    else
      output="DANGER: @sparkleideas/cli@latest resolves to $resolved_version (no bin entries — broken package)"
    fi
  else
    output="Could not resolve @sparkleideas/cli@latest from registry"
  fi

  end_ns=$(date +%s%N 2>/dev/null || echo 0)
  local duration_ms=0
  if [[ "$start_ns" != "0" && "$end_ns" != "0" ]]; then
    duration_ms=$(( (end_ns - start_ns) / 1000000 ))
  fi
  record_result "A8" "No broken versions resolved" "$passed" "$output" "$duration_ms"
}

test_a16_plugin_install() {
  # Verify plugin install command works
  run_timed "cd '$TEMP_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' npx --yes '$PKG' plugins install --name @sparkleideas/plugin-prime-radiant"
  local passed="false"
  if [[ $_EXIT -eq 0 ]]; then
    if echo "$_OUT" | grep -qi 'install\|success\|prime-radiant'; then
      passed="true"
    fi
  fi
  record_result "A16" "Plugin install" "$passed" "$_OUT" "$_DURATION_MS"
}

# ── Main ────────────────────────────────────────────────────────────
ACCEPT_T0=$(date +%s%N 2>/dev/null || date +%s)
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Production verification starting"
echo ""
echo "Production Verification (ADR-0023 Layer 4)"
echo "============================================"
echo "Registry: $REGISTRY"
echo "Package:  $PKG"
echo "Results:  $RESULTS_DIR"
echo ""

# Create results directory
mkdir -p "$RESULTS_DIR"

# A0: Unpinned smoke test — exercises exactly what a first-time user does
echo "Running A0: @latest dist-tag resolves..."
run_acceptance_check "A0" "@latest dist-tag resolves" check_latest_resolves

# A1 runs independently (no temp dir needed)
# Use a throwaway temp dir for version check
TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ruflo-accept-a1-XXXXXX")"
echo "Running A1: Version check..."
run_acceptance_check "A1" "Version check" check_version
rm -rf "$TEMP_DIR"

# A2-A16 share a single temp directory (init must run first)
create_temp_dir
echo "Temp dir:  $TEMP_DIR"
echo ""

# Install packages needed for import tests (A13, A15) into temp dir.
# CLI uses the specific version being tested. Agent-booster and plugins
# have independent version numbers — use the same dist-tag so we test
# packages from the same publish run (prerelease→prerelease, latest→latest).
# If a specific version was given (not @latest), use @prerelease for
# companion packages since they have different version numbers.
COMPANION_TAG="${VERSION}"
if [[ "$VERSION" != "@latest" && "$VERSION" =~ ^@[0-9] ]]; then
  COMPANION_TAG="@prerelease"
fi
(cd "$TEMP_DIR" && echo '{"name":"ruflo-accept-test","version":"1.0.0","private":true}' > package.json \
  && npm install "@sparkleideas/cli${VERSION}" \
     "@sparkleideas/agent-booster${COMPANION_TAG}" \
     "@sparkleideas/plugins${COMPANION_TAG}" \
     --registry "$REGISTRY" --ignore-scripts --no-audit --no-fund 2>&1) || {
  echo "WARN: Failed to install test packages — A13/A15 may fail" >&2
}

# Shared checks A2-A7, A9-A10, A13-A15 (from lib/acceptance-checks.sh)
run_acceptance_check "A2"  "Init"                check_init
run_acceptance_check "A3"  "Settings file"       check_settings_file
run_acceptance_check "A4"  "Scope check"         check_scope
run_acceptance_check "A5"  "Doctor"              check_doctor
run_acceptance_check "A6"  "MCP config"          check_mcp_config
run_acceptance_check "A7"  "Wrapper proxy"       check_wrapper_proxy

# Registry-specific tests (Layer 4 only — not in shared library)
echo "Running A8: No broken versions resolved..."
test_a8_no_broken_versions

run_acceptance_check "A9"  "Memory lifecycle"    check_memory_lifecycle
run_acceptance_check "A10" "Neural training"     check_neural_training
run_acceptance_check "A13" "Agent booster import" check_agent_booster_esm
run_acceptance_check "A14" "Agent booster binary" check_agent_booster_bin
run_acceptance_check "A15" "Plugins SDK import"  check_plugins_sdk
run_acceptance_check "A17" "ruflo init --full"   check_ruflo_init_full

# Registry-specific test (Layer 4 only)
echo "Running A16: Plugin install..."
test_a16_plugin_install

# ── Summary ─────────────────────────────────────────────────────────
ACCEPT_T1=$(date +%s%N 2>/dev/null || date +%s)
if [[ "$ACCEPT_T0" =~ ^[0-9]{10,}$ ]]; then
  TOTAL_MS=$(( (ACCEPT_T1 - ACCEPT_T0) / 1000000 ))
else
  TOTAL_MS=$(( ACCEPT_T1 - ACCEPT_T0 ))
fi
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Production verification complete (${TOTAL_MS}ms)"
echo ""
echo "------------------------------------"
echo "Total: $TOTAL_COUNT  Passed: $PASS_COUNT  Failed: $FAIL_COUNT"
echo "------------------------------------"

# ── Write results JSON ──────────────────────────────────────────────
cat > "$RESULTS_DIR/acceptance-results.json" <<JSONEOF
{
  "timestamp": "$TIMESTAMP",
  "registry": "$REGISTRY",
  "version": "${VERSION#@}",
  "total_duration_ms": $TOTAL_MS,
  "tests": $TEST_RESULTS_JSON,
  "summary": {
    "total": $TOTAL_COUNT,
    "passed": $PASS_COUNT,
    "failed": $FAIL_COUNT
  }
}
JSONEOF

echo "Results written to: $RESULTS_DIR/acceptance-results.json"

exit "$FAIL_COUNT"
