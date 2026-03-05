#!/usr/bin/env bash
# scripts/test-acceptance.sh -- Layer 3 acceptance tests (ADR-0020)
#
# Validates the end-user experience by running ruflo-patch commands
# against published packages (local Verdaccio or real npm).
#
# Usage:
#   bash scripts/test-acceptance.sh [--registry <url>] [--version <ver>]
#
# Exit code: number of failed tests (0 = all pass)
set -uo pipefail

# ── Defaults ────────────────────────────────────────────────────────
REGISTRY="https://registry.npmjs.org"
VERSION="@latest"
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
    -h|--help)
      echo "Usage: bash scripts/test-acceptance.sh [--registry <url>] [--version <ver>]"
      echo ""
      echo "Options:"
      echo "  --registry <url>  npm registry URL (default: https://registry.npmjs.org)"
      echo "  --version <ver>   specific version to test (default: @latest)"
      exit 0
      ;;
    *)
      echo "Unknown argument: $1"
      exit 1
      ;;
  esac
done

PKG="ruflo-patch${VERSION}"

# ── Cleanup trap ────────────────────────────────────────────────────
cleanup() {
  if [[ -n "$TEMP_DIR" && -d "$TEMP_DIR" ]]; then
    rm -rf "$TEMP_DIR"
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
  _OUT="$(eval "$@" 2>&1)" || true
  _EXIT=${PIPESTATUS[0]:-$?}
  end_ns=$(date +%s%N 2>/dev/null || echo 0)
  if [[ "$start_ns" == "0" || "$end_ns" == "0" ]]; then
    _DURATION_MS=0
  else
    _DURATION_MS=$(( (end_ns - start_ns) / 1000000 ))
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

# ── Test functions ──────────────────────────────────────────────────

test_a1_version_check() {
  run_timed "NPM_CONFIG_REGISTRY='$REGISTRY' npx --yes '$PKG' --version"
  local passed="false"
  if [[ $_EXIT -eq 0 && -n "$_OUT" ]]; then
    # Output should contain a version-like string (digits and dots)
    if echo "$_OUT" | grep -qE '[0-9]+\.[0-9]+\.[0-9]+'; then
      passed="true"
    fi
  fi
  record_result "A1" "Version check" "$passed" "$_OUT" "$_DURATION_MS"
}

test_a2_init() {
  run_timed "cd '$TEMP_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' npx --yes '$PKG' init"
  local passed="false"
  if [[ $_EXIT -eq 0 ]]; then
    passed="true"
  fi
  record_result "A2" "Init" "$passed" "$_OUT" "$_DURATION_MS"
}

test_a3_settings_file() {
  local start_ns end_ns
  start_ns=$(date +%s%N 2>/dev/null || echo 0)
  local output passed="false"
  if [[ -f "$TEMP_DIR/.claude/settings.json" ]]; then
    passed="true"
    output="File exists: $TEMP_DIR/.claude/settings.json"
  else
    output="Missing: $TEMP_DIR/.claude/settings.json"
    # List what was created for debugging
    output="$output\nContents of temp dir:"
    output="$output\n$(find "$TEMP_DIR" -maxdepth 3 -type f 2>/dev/null | head -20)"
  fi
  end_ns=$(date +%s%N 2>/dev/null || echo 0)
  local duration_ms=0
  if [[ "$start_ns" != "0" && "$end_ns" != "0" ]]; then
    duration_ms=$(( (end_ns - start_ns) / 1000000 ))
  fi
  record_result "A3" "Settings file" "$passed" "$output" "$duration_ms"
}

test_a4_scope_check() {
  local start_ns end_ns
  start_ns=$(date +%s%N 2>/dev/null || echo 0)
  local output passed="false"
  if [[ -f "$TEMP_DIR/CLAUDE.md" ]]; then
    local matches
    matches=$(grep -c '@claude-flow-patch' "$TEMP_DIR/CLAUDE.md" 2>/dev/null || echo "0")
    if [[ "$matches" -ge 1 ]]; then
      passed="true"
      output="Found $matches @claude-flow-patch references in CLAUDE.md"
    else
      output="No @claude-flow-patch references found in CLAUDE.md"
      output="$output\nHead of CLAUDE.md:\n$(head -20 "$TEMP_DIR/CLAUDE.md" 2>/dev/null)"
    fi
  else
    output="Missing: $TEMP_DIR/CLAUDE.md"
  fi
  end_ns=$(date +%s%N 2>/dev/null || echo 0)
  local duration_ms=0
  if [[ "$start_ns" != "0" && "$end_ns" != "0" ]]; then
    duration_ms=$(( (end_ns - start_ns) / 1000000 ))
  fi
  record_result "A4" "Scope check" "$passed" "$output" "$duration_ms"
}

test_a5_doctor() {
  run_timed "cd '$TEMP_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' npx --yes '$PKG' doctor --fix"
  local passed="false"
  if [[ $_EXIT -eq 0 ]]; then
    if ! echo "$_OUT" | grep -q 'MODULE_NOT_FOUND'; then
      passed="true"
    fi
  fi
  record_result "A5" "Doctor" "$passed" "$_OUT" "$_DURATION_MS"
}

test_a6_mcp_config() {
  local start_ns end_ns
  start_ns=$(date +%s%N 2>/dev/null || echo 0)
  local output passed="false"
  if [[ -f "$TEMP_DIR/.mcp.json" ]]; then
    if grep -q 'autoStart.*false' "$TEMP_DIR/.mcp.json" 2>/dev/null; then
      output="Found autoStart: false in .mcp.json (MC-001 patch not applied)"
      output="$output\n$(cat "$TEMP_DIR/.mcp.json" 2>/dev/null)"
    else
      passed="true"
      output="File exists, no autoStart: false found"
    fi
  else
    output="Missing: $TEMP_DIR/.mcp.json"
    output="$output\nContents of temp dir:"
    output="$output\n$(find "$TEMP_DIR" -maxdepth 3 -type f 2>/dev/null | head -20)"
  fi
  end_ns=$(date +%s%N 2>/dev/null || echo 0)
  local duration_ms=0
  if [[ "$start_ns" != "0" && "$end_ns" != "0" ]]; then
    duration_ms=$(( (end_ns - start_ns) / 1000000 ))
  fi
  record_result "A6" "MCP config" "$passed" "$output" "$duration_ms"
}

# ── Main ────────────────────────────────────────────────────────────
echo "Acceptance Tests (ADR-0020 Layer 3)"
echo "===================================="
echo "Registry: $REGISTRY"
echo "Package:  $PKG"
echo "Results:  $RESULTS_DIR"
echo ""

# Create results directory
mkdir -p "$RESULTS_DIR"

# A1 runs independently (no temp dir needed)
echo "Running A1: Version check..."
test_a1_version_check

# A2-A6 share a single temp directory (init must run first)
create_temp_dir
echo "Temp dir:  $TEMP_DIR"
echo ""

echo "Running A2: Init..."
test_a2_init

echo "Running A3: Settings file..."
test_a3_settings_file

echo "Running A4: Scope check..."
test_a4_scope_check

echo "Running A5: Doctor..."
test_a5_doctor

echo "Running A6: MCP config..."
test_a6_mcp_config

# ── Summary ─────────────────────────────────────────────────────────
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
