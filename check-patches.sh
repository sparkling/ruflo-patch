#!/bin/bash
# check-patches.sh — Dynamic sentinel checker
# Reads patch/*/sentinel files to verify patches are still applied.
# On session start: detects wipes, auto-reapplies, warns user.
#
# Usage:
#   bash check-patches.sh [--global] [--target <dir>]
#
# If neither flag is given, --global is assumed.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Timeout & timing ──
CP_START=$(date -u +%Y-%m-%dT%H:%M:%SZ)
CP_T0=$(date +%s%N 2>/dev/null || echo "$(date +%s)000000000")
echo "[$CP_START] Sentinel verification starting"

( sleep 30; echo "[TIMEOUT] check-patches.sh exceeded 30s — aborting" >&2; kill -TERM $$ 2>/dev/null ) &
CP_TIMEOUT_PID=$!

cp_cleanup() {
  kill "$CP_TIMEOUT_PID" 2>/dev/null || true
  wait "$CP_TIMEOUT_PID" 2>/dev/null || true
}
trap cp_cleanup EXIT

# ── Parse arguments ──
DO_GLOBAL=0
TARGET_DIR=""
while [[ $# -gt 0 ]]; do
  case $1 in
    --global) DO_GLOBAL=1; shift ;;
    --target) TARGET_DIR="${2:-}"; shift 2 ;;
    *) shift ;;  # ignore unknown
  esac
done

if [[ $DO_GLOBAL -eq 0 && -z "$TARGET_DIR" ]]; then
  DO_GLOBAL=1
fi

# ── Shared discovery ──
. "$SCRIPT_DIR/lib/discover.sh"

# ── Collect installs ──
INSTALLS=()

if [[ $DO_GLOBAL -eq 1 ]]; then
  while IFS= read -r line; do
    [ -n "$line" ] && INSTALLS+=("$line")
  done < <(discover_all_cf_installs)
fi

if [[ -n "$TARGET_DIR" && -d "$TARGET_DIR" ]]; then
  while IFS= read -r line; do
    [ -n "$line" ] && INSTALLS+=("$line")
  done < <(discover_target_installs "$TARGET_DIR")
fi

if [[ ${#INSTALLS[@]} -eq 0 ]]; then
  echo "[PATCHES] WARN: Cannot find claude-flow CLI files"
  exit 0
fi

# ── Path resolver ──

resolve_path() {
  local base="$1"
  local rv_base="$2"
  local rs_base="$3"
  local pkg="$4"
  local relpath="$5"
  case "$pkg" in
    ruvector)  echo "$rv_base/$relpath" ;;
    ruv-swarm) echo "$rs_base/$relpath" ;;
    @claude-flow/*)
      local cf_scope
      cf_scope="$(cd "$base/../../../.." 2>/dev/null && pwd)"
      local subpkg="${pkg#@claude-flow/}"
      echo "$cf_scope/@claude-flow/$subpkg/$relpath"
      ;;
    *)         echo "$base/$relpath" ;;
  esac
}

# ── Check sentinels for a single install ──

check_sentinels_for_install() {
  local base="$1"
  local rv_cli="$2"
  local rs_root="$3"

  local rv_base=""
  if [ -n "$rv_cli" ]; then
    rv_base="$(cd "$(dirname "$rv_cli")/.." 2>/dev/null && pwd)"
  fi

  local all_ok=true

  for sentinel_file in "$SCRIPT_DIR"/patch/*/sentinel; do
    [ -f "$sentinel_file" ] || continue

    local dirname
    dirname=$(basename "$(dirname "$sentinel_file")")
    local matchname="${dirname#[0-9]*-}"
    if [ -n "${PATCH_INCLUDE:-}" ] && ! echo "$matchname" | grep -qE "$PATCH_INCLUDE"; then
      continue
    fi
    if [ -n "${PATCH_EXCLUDE:-}" ] && echo "$matchname" | grep -qE "$PATCH_EXCLUDE"; then
      continue
    fi

    local pkg="claude-flow"

    local first_pkg_line
    first_pkg_line=$(grep -m1 '^package:' "$sentinel_file" 2>/dev/null || true)
    if [ -n "$first_pkg_line" ]; then
      local first_pkg="${first_pkg_line#package:}"
      first_pkg="${first_pkg#"${first_pkg%%[![:space:]]*}"}"
      first_pkg="${first_pkg%%[[:space:]]*}"
      local has_non_pkg_default=false
      grep -v '^package:' "$sentinel_file" | grep -v '^$' | grep -v '^none$' | head -1 | grep -q '.' && has_non_pkg_default=true
      if ! $has_non_pkg_default; then
        case "$first_pkg" in
          ruvector)  [ -z "$rv_cli" ] && continue ;;
          ruv-swarm) [ -z "$rs_root" ] && continue ;;
        esac
      fi
    fi

    while IFS= read -r line; do
      line="${line#"${line%%[![:space:]]*}"}"
      [[ -z "$line" ]] && continue

      if [[ "$line" == package:* ]]; then
        pkg="${line#package:}"
        pkg="${pkg#"${pkg%%[![:space:]]*}"}"
        pkg="${pkg%%[[:space:]]*}"
        continue
      fi

      if [[ "$line" == "none" ]]; then
        continue

      elif [[ "$line" =~ ^absent\ \"(.+)\"\ (.+)$ ]]; then
        local pattern="${BASH_REMATCH[1]}"
        local filepath
        filepath=$(resolve_path "$base" "$rv_base" "$rs_root" "$pkg" "${BASH_REMATCH[2]}")
        if grep -q "$pattern" "$filepath" 2>/dev/null; then
          all_ok=false
        fi

      elif [[ "$line" =~ ^grep\ \"(.+)\"\ (.+)$ ]]; then
        local pattern="${BASH_REMATCH[1]}"
        local filepath
        filepath=$(resolve_path "$base" "$rv_base" "$rs_root" "$pkg" "${BASH_REMATCH[2]}")
        if [ -f "$filepath" ] && ! grep -q "$pattern" "$filepath" 2>/dev/null; then
          all_ok=false
        fi
      fi
    done < "$sentinel_file"
  done

  $all_ok
}

# ── Check all installs ──

any_failed=false
first_version=""

for entry in "${INSTALLS[@]}"; do
  IFS=$'\t' read -r dist_src version rv_cli rs_root writable <<< "$entry"
  [ "$rv_cli" = "-" ] && rv_cli=""
  [ "$rs_root" = "-" ] && rs_root=""
  [ -z "$first_version" ] && first_version="$version"

  CP_INST_T0=$(date +%s%N 2>/dev/null || echo "$(date +%s)000000000")
  if ! check_sentinels_for_install "$dist_src" "$rv_cli" "$rs_root"; then
    any_failed=true
    CP_INST_T1=$(date +%s%N 2>/dev/null || echo "$(date +%s)000000000")
    CP_INST_MS=$(( (CP_INST_T1 - CP_INST_T0) / 1000000 ))
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Install check: $dist_src — ${CP_INST_MS}ms (FAILED)"
    break
  fi
  CP_INST_T1=$(date +%s%N 2>/dev/null || echo "$(date +%s)000000000")
  CP_INST_MS=$(( (CP_INST_T1 - CP_INST_T0) / 1000000 ))
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Install check: $dist_src — ${CP_INST_MS}ms (OK)"
done

VERSION="${first_version:-unknown}"

CP_T1=$(date +%s%N 2>/dev/null || echo "$(date +%s)000000000")
CP_TOTAL_MS=$(( (CP_T1 - CP_T0) / 1000000 ))

if ! $any_failed; then
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Sentinel verification complete (${CP_TOTAL_MS}ms)"
  echo "[PATCHES] OK: All patches verified (v$VERSION)"
  exit 0
fi

# ── Patches wiped — auto-reapply and warn ──

echo ""
echo "============================================"
echo "  WARNING: ruflo patches were wiped!"
echo "  Likely cause: npx cache update (v$VERSION)"
echo "============================================"
echo ""

if [ -x "$SCRIPT_DIR/patch-all.sh" ]; then
  REAPPLY_ARGS=()
  if [[ $DO_GLOBAL -eq 1 ]]; then REAPPLY_ARGS+=(--global); fi
  if [[ -n "$TARGET_DIR" ]]; then REAPPLY_ARGS+=(--target "$TARGET_DIR"); fi
  bash "$SCRIPT_DIR/patch-all.sh" "${REAPPLY_ARGS[@]}"
  echo ""
  echo "[PATCHES] Auto-reapplied."
else
  echo "[PATCHES] ERROR: patch-all.sh not found at $SCRIPT_DIR"
  echo "[PATCHES] Run manually: bash $SCRIPT_DIR/patch-all.sh"
fi

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Sentinel verification complete (${CP_TOTAL_MS}ms)"
