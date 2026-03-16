#!/usr/bin/env bash
# rollback.sh -- Reassign @latest dist-tags to a known-good version (ADR-0019)
#
# Usage:
#   rollback.sh <version>            # Roll back to specified version
#   rollback.sh                      # Roll back to .last-promoted-version
#   rollback.sh --dry-run <version>  # Print commands without executing
#   rollback.sh --yes <version>      # Skip confirmation prompt
#
# Flags can appear in any position before the version argument.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
STATE_FILE="$SCRIPT_DIR/.last-promoted-version"

# ---------- Defaults ----------
DRY_RUN=false
AUTO_YES=false
GOOD_VERSION=""

# ---------- Parse arguments ----------
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --yes|-y)  AUTO_YES=true ;;
    -h|--help)
      echo "Usage: rollback.sh [--dry-run] [--yes] <version>"
      echo "  --dry-run   Print commands without executing"
      echo "  --yes|-y    Skip confirmation prompt"
      echo "  <version>   Target version to roll back to (or reads .last-promoted-version)"
      exit 0 ;;
    -*)        echo "Unknown flag: $arg"; exit 1 ;;
    *)         GOOD_VERSION="$arg" ;;
  esac
done

# ---------- Resolve version ----------
if [[ -z "$GOOD_VERSION" ]]; then
  if [[ -f "$STATE_FILE" ]]; then
    GOOD_VERSION=$(cat "$STATE_FILE")
    echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] Read rollback target from $STATE_FILE"
  else
    echo "Usage: rollback.sh [--dry-run] [--yes] <version>"
    echo "Or ensure $STATE_FILE exists."
    exit 1
  fi
fi

if [[ -z "$GOOD_VERSION" ]]; then
  echo "Error: version is empty"
  exit 1
fi

# Dynamic per-package versions from published-versions.json (C6: per-package rollback)
declare -A PKG_VERSIONS
while IFS=$'\t' read -r name version; do
  [[ -n "$name" ]] && PKG_VERSIONS["$name"]="$version"
done < <(node -e "
  const pv = JSON.parse(require('fs').readFileSync('${PROJECT_DIR}/config/published-versions.json','utf-8'));
  for (const [k,v] of Object.entries(pv)) console.log(k + '\t' + v);
" 2>/dev/null)

if [[ ${#PKG_VERSIONS[@]} -eq 0 ]]; then
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] WARN: Could not read packages from config/published-versions.json — using hardcoded fallback"
  # Fallback hardcoded list as safety net (uses GOOD_VERSION since we have no per-package info)
  SCOPED_PACKAGES=(
    # Level 1
    agentdb agentic-flow ruv-swarm
    # Level 2
    shared memory embeddings codex aidefence
    # Level 3
    neural hooks browser plugins providers claims
    # Level 4
    guidance mcp integration deployment swarm security performance testing
    # Level 5
    cli claude-flow
  )
  for pkg in "${SCOPED_PACKAGES[@]}"; do
    PKG_VERSIONS["@sparkleideas/${pkg}"]="${GOOD_VERSION}"
  done
  # Add the root package
  PKG_VERSIONS["@sparkleideas/ruflo"]="${GOOD_VERSION}"
fi

TOTAL=${#PKG_VERSIONS[@]}

# ---------- Summary ----------
echo ""
echo "Rollback plan"
echo "  Target version : ${GOOD_VERSION} (fallback) / per-package from published-versions.json"
echo "  Packages       : $TOTAL (from published-versions.json)"
echo "  Dry run        : $DRY_RUN"
echo ""

# ---------- Confirmation ----------
if [[ "$DRY_RUN" == false && "$AUTO_YES" == false ]]; then
  read -r -p "Proceed with rollback? [y/N] " confirm
  case "$confirm" in
    [yY]|[yY][eE][sS]) ;;
    *)
      echo "Aborted."
      exit 0
      ;;
  esac
fi

# ---------- Helper ----------
FAILURES=0

run_dist_tag() {
  local pkg_spec="$1"
  local ts
  ts="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"

  if [[ "$DRY_RUN" == true ]]; then
    echo "[$ts] [dry-run] npm dist-tag add \"$pkg_spec\" latest"
  else
    echo -n "[$ts] npm dist-tag add \"$pkg_spec\" latest ... "
    if npm dist-tag add "$pkg_spec" latest 2>&1; then
      echo "OK"
    else
      echo "FAILED"
      FAILURES=$((FAILURES + 1))
    fi
  fi
}

# ---------- Execute ----------
echo ""
echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] Rolling back @latest (per-package versions)"
echo ""

# All packages with per-package versions from published-versions.json (C6)
for pkg in "${!PKG_VERSIONS[@]}"; do
  local_ver="${PKG_VERSIONS[$pkg]}"
  run_dist_tag "${pkg}@${local_ver}"
done

# ---------- Summary ----------
echo ""
if [[ "$DRY_RUN" == true ]]; then
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] Dry run complete. No changes made."
elif [[ "$FAILURES" -gt 0 ]]; then
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] Rollback finished with $FAILURES failure(s)."
  echo "Re-run failed packages manually or retry the script."
  exit 1
else
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] Rollback complete."
  echo "Verify: npm view @sparkleideas/ruflo dist-tags"
  echo "Verify: npx @sparkleideas/ruflo@latest --version"
fi
