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

# Complete list of scoped packages (ADR-0014 levels 1-5)
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

TOTAL=$(( ${#SCOPED_PACKAGES[@]} + 1 ))  # +1 for @sparkleideas/ruflo-patch root

# ---------- Summary ----------
echo ""
echo "Rollback plan"
echo "  Target version : $GOOD_VERSION"
echo "  Packages       : $TOTAL (@sparkleideas/ruflo-patch + ${#SCOPED_PACKAGES[@]} scoped)"
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
echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] Rolling back @latest to ${GOOD_VERSION}"
echo ""

# Root package
run_dist_tag "@sparkleideas/ruflo-patch@${GOOD_VERSION}"

# Scoped packages
for pkg in "${SCOPED_PACKAGES[@]}"; do
  run_dist_tag "@sparkleideas/${pkg}@${GOOD_VERSION}"
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
  echo "Verify: npm view @sparkleideas/ruflo-patch dist-tags"
  echo "Verify: npx @sparkleideas/ruflo-patch@latest --version"
fi
