#!/bin/bash
# repair-post-init.sh
# Post-init remediation for projects initialized before patch-all.sh.
#
# What it does:
# 1) Finds a patched @claude-flow/cli helper source (local or global npx cache)
# 2) Backs up target .claude/helpers (default)
# 3) Rehydrates helper files into target project

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="$(pwd)"
SOURCE_SCOPE="auto"   # auto|local|global
DO_BACKUP=1
DRY_RUN=0
RUN_CHECK=1

usage() {
  cat <<'EOF'
Usage:
  bash repair-post-init.sh [options]

Options:
  --target <dir>        Target project directory (default: current working directory)
  --source <mode>       Source mode: auto|local|global (default: auto)
  --no-backup           Skip .claude/helpers backup
  --dry-run             Print actions without writing files
  --skip-check          Skip check-patches.sh preflight
  -h, --help            Show help
EOF
}

fail() {
  echo "[repair-post-init] ERROR: $*" >&2
  exit 1
}

log() {
  echo "[repair-post-init] $*"
}

run_cmd() {
  if [ "$DRY_RUN" -eq 1 ]; then
    echo "[dry-run] $*"
    return 0
  fi
  "$@"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target)     TARGET_DIR="${2:-}"; shift 2 ;;
    --source)     SOURCE_SCOPE="${2:-}"; shift 2 ;;
    --no-backup)  DO_BACKUP=0; shift ;;
    --dry-run)    DRY_RUN=1; shift ;;
    --skip-check) RUN_CHECK=0; shift ;;
    -h|--help)    usage; exit 0 ;;
    *)            fail "Unknown option: $1" ;;
  esac
done

if [[ ! "$SOURCE_SCOPE" =~ ^(auto|local|global)$ ]]; then
  fail "Invalid --source value: $SOURCE_SCOPE (expected auto|local|global)"
fi

TARGET_DIR="$(cd "$TARGET_DIR" && pwd)"
[ -d "$TARGET_DIR" ] || fail "Target directory not found: $TARGET_DIR"

if [ "$RUN_CHECK" -eq 1 ]; then
  if [ -x "$SCRIPT_DIR/check-patches.sh" ]; then
    log "Running preflight patch check..."
    bash "$SCRIPT_DIR/check-patches.sh" >/dev/null || {
      log "Patch check failed; applying patches..."
      bash "$SCRIPT_DIR/patch-all.sh" --global >/dev/null
      bash "$SCRIPT_DIR/check-patches.sh" >/dev/null || fail "Patch verification failed"
    }
  fi
fi

find_local_helpers() {
  local base="$1"
  for d in "$base" "$base/.." "$base/../.." "$base/../../.."; do
    if [ -d "$d/node_modules/@claude-flow/cli/.claude/helpers" ]; then
      (cd "$d/node_modules/@claude-flow/cli/.claude/helpers" && pwd)
      return 0
    fi
  done
  return 1
}

find_global_helpers() {
  . "$SCRIPT_DIR/lib/discover.sh"
  local first_dist_src=""
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    first_dist_src="${line%%	*}"
    break
  done < <(discover_all_cf_installs)
  if [ -n "$first_dist_src" ]; then
    local pkg_root
    pkg_root="$(cd "$first_dist_src/../.." 2>/dev/null && pwd)"
    if [ -d "$pkg_root/.claude/helpers" ]; then
      echo "$pkg_root/.claude/helpers"
      return 0
    fi
  fi
  ls -td ~/.npm/_npx/*/node_modules/@claude-flow/cli/.claude/helpers 2>/dev/null | head -1 || true
}

SRC_HELPERS=""
case "$SOURCE_SCOPE" in
  local)  SRC_HELPERS="$(find_local_helpers "$TARGET_DIR" || true)" ;;
  global) SRC_HELPERS="$(find_global_helpers)" ;;
  auto)
    SRC_HELPERS="$(find_local_helpers "$TARGET_DIR" || true)"
    if [ -z "$SRC_HELPERS" ]; then
      SRC_HELPERS="$(find_global_helpers)"
    fi
    ;;
esac

[ -n "$SRC_HELPERS" ] || fail "Could not locate @claude-flow/cli/.claude/helpers (source=$SOURCE_SCOPE)"
[ -d "$SRC_HELPERS" ] || fail "Source helpers directory does not exist: $SRC_HELPERS"

TARGET_HELPERS="$TARGET_DIR/.claude/helpers"
BACKUP_PATH="$TARGET_DIR/.claude/helpers.backup.$(date +%Y%m%d-%H%M%S)"

log "Target: $TARGET_DIR"
log "Source helpers: $SRC_HELPERS"
log "Target helpers: $TARGET_HELPERS"

run_cmd mkdir -p "$TARGET_HELPERS"

if [ "$DO_BACKUP" -eq 1 ] && [ -d "$TARGET_HELPERS" ]; then
  if [ "$(ls -A "$TARGET_HELPERS" 2>/dev/null || true)" ]; then
    log "Backing up existing helpers -> $BACKUP_PATH"
    run_cmd cp -a "$TARGET_HELPERS" "$BACKUP_PATH"
  fi
fi

copied=0
for src in "$SRC_HELPERS"/*; do
  [ -e "$src" ] || continue
  base="$(basename "$src")"
  run_cmd cp -a "$src" "$TARGET_HELPERS/$base"
  copied=$((copied + 1))
done

log "Copied/updated helper files: $copied"
log "Done."
