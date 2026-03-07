#!/bin/bash
# patch-all.sh — Orchestrator for folder-per-defect patches
# Safe to run multiple times. Each fix.py is idempotent via patch()/patch_all().
#
# Usage:
#   bash patch-all.sh --target <dir>
#
# Options:
#   --target <dir>       Patch node_modules inside <dir> (required)

set -euo pipefail

# Parse arguments
TARGET_DIR=""
while [[ $# -gt 0 ]]; do
  case $1 in
    --target)
      TARGET_DIR="${2:-}"
      if [[ -z "$TARGET_DIR" ]]; then
        echo "Error: --target requires a directory argument"
        exit 1
      fi
      shift 2
      ;;
    -h|--help)
      echo "Usage: patch-all.sh --target <dir>"
      echo ""
      echo "Options:"
      echo "  --target <dir>     Patch node_modules inside <dir> (required)"
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

if [[ -z "$TARGET_DIR" ]]; then
  echo "Error: --target <dir> is required"
  echo "Usage: patch-all.sh --target <dir>"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Shared discovery ──
. "$SCRIPT_DIR/lib/discover.sh"

# ── Collect installs ──
# Each entry: "dist_src\tversion\truvector_cli\truv_swarm_root\twritable"

INSTALLS=()

if [[ ! -d "$TARGET_DIR" ]]; then
  echo "Error: target directory does not exist: $TARGET_DIR"
  exit 1
fi
TARGET_DIR="$(cd "$TARGET_DIR" && pwd)"
while IFS= read -r line; do
  [ -n "$line" ] && INSTALLS+=("TARGET	$line")
done < <(discover_target_installs "$TARGET_DIR")

# ── Report what we found ──

echo "[PATCHES] Target: $TARGET_DIR"
echo ""

if [[ ${#INSTALLS[@]} -eq 0 ]]; then
  echo "  Target @claude-flow/cli: not found in $TARGET_DIR"
  echo "  Target ruvector: not found in $TARGET_DIR"
  echo ""
  echo "[PATCHES] Complete"
  exit 0
fi

for entry in "${INSTALLS[@]}"; do
  IFS=$'\t' read -r scope dist_src version rv_cli rs_root writable <<< "$entry"
  [ "$rv_cli" = "-" ] && rv_cli=""
  [ "$rs_root" = "-" ] && rs_root=""
  echo "  [$scope] @claude-flow/cli v$version at $dist_src"
  [ -n "$rv_cli" ] && echo "  [$scope] ruvector: $rv_cli"
  [ -n "$rs_root" ] && echo "  [$scope] ruv-swarm: $rs_root"
  if [ "$writable" = "no" ]; then
    echo "  [$scope] WARNING: not writable (re-run with sudo)"
  fi
done

echo ""

# ── Apply patches function ──

apply_patches() {
  local base="$1"
  local ruvector_cli="$2"
  local ruv_swarm_root="$3"
  local label="$4"

  if [ -z "$base" ] && [ -z "$ruvector_cli" ]; then
    echo "[$label] No packages found, skipping"
    return
  fi

  if [ -n "$base" ]; then
    echo "[$label] Patching @claude-flow/cli at: $base"
  fi
  if [ -n "$ruvector_cli" ]; then
    echo "[$label] Patching ruvector at: $ruvector_cli"
  fi

  export BASE="${base:-/dev/null}"
  export RUVECTOR_CLI="$ruvector_cli"
  export RUV_SWARM_ROOT="$ruv_swarm_root"

  # Dynamic discovery: concatenate common.py + all fix.py files sorted by
  # numeric execution-order prefix.  sort -V (version sort) handles mixed-width
  # prefixes correctly (100 < 110 < 370 < 1001 < 1250).
  #
  # PATCH_INCLUDE / PATCH_EXCLUDE env vars filter by directory name regex.
  python3 <(
    cat "$SCRIPT_DIR/lib/common.py"

    while IFS= read -r fix; do
      [ -f "$fix" ] || continue
      dirname=$(basename "$(dirname "$fix")")
      matchname="${dirname#[0-9]*-}"   # strip numeric prefix (3+ digits)
      if [ -n "${PATCH_INCLUDE:-}" ] && ! echo "$matchname" | grep -qE "$PATCH_INCLUDE"; then
        continue
      fi
      if [ -n "${PATCH_EXCLUDE:-}" ] && echo "$matchname" | grep -qE "$PATCH_EXCLUDE"; then
        continue
      fi
      cat "$fix"
    done < <(printf '%s\n' "$SCRIPT_DIR"/patch/*/fix.py | sort -V)

    echo "print(f\"[$label] Done: {applied} applied, {skipped} already present\")"
  )

  # Shell-based patches (e.g. permissions fixes)
  while IFS= read -r fix; do
    [ -f "$fix" ] || continue
    dirname=$(basename "$(dirname "$fix")")
    matchname="${dirname#[0-9]*-}"   # strip numeric prefix (3+ digits)
    if [ -n "${PATCH_INCLUDE:-}" ] && ! echo "$matchname" | grep -qE "$PATCH_INCLUDE"; then
      continue
    fi
    if [ -n "${PATCH_EXCLUDE:-}" ] && echo "$matchname" | grep -qE "$PATCH_EXCLUDE"; then
      continue
    fi
    bash "$fix" 2>/dev/null || true
  done < <(printf '%s\n' "$SCRIPT_DIR"/patch/*/fix.sh | sort -V)

  echo ""
}

# ── Apply to each discovered install ──

for entry in "${INSTALLS[@]}"; do
  IFS=$'\t' read -r scope dist_src version rv_cli rs_root writable <<< "$entry"
  [ "$rv_cli" = "-" ] && rv_cli=""
  [ "$rs_root" = "-" ] && rs_root=""

  if [ "$writable" = "no" ]; then
    echo "[$scope] SKIP: $dist_src not writable (re-run with sudo)"
    echo ""
    continue
  fi

  apply_patches "$dist_src" "$rv_cli" "$rs_root" "$scope"
done

echo "[PATCHES] Complete"
