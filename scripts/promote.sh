#!/usr/bin/env bash
# promote.sh -- Promote a prerelease version to @latest (ADR-0010, ADR-0019)
#
# Usage:
#   promote.sh <version>            # Promote version to @latest
#   promote.sh --dry-run <version>  # Print commands without executing
#   promote.sh --yes <version>      # Skip confirmation prompt
#
# Updates scripts/.last-promoted-version atomically on success.
# Flags can appear in any position before the version argument.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_FILE="$SCRIPT_DIR/.last-promoted-version"

# ---------- Defaults ----------
DRY_RUN=false
AUTO_YES=false
VERSION=""

# ---------- Parse arguments ----------
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --yes|-y)  AUTO_YES=true ;;
    -*)        echo "Unknown flag: $arg"; exit 1 ;;
    *)         VERSION="$arg" ;;
  esac
done

if [[ -z "$VERSION" ]]; then
  echo "Usage: promote.sh [--dry-run] [--yes] <version>"
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

TOTAL=$(( ${#SCOPED_PACKAGES[@]} + 1 ))  # +1 for ruflo-patch root

# ---------- Verify version exists on npm ----------
echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] Verifying ruflo-patch@${VERSION} exists on npm ..."

if [[ "$DRY_RUN" == true ]]; then
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] [dry-run] npm view ruflo-patch@${VERSION} version"
else
  if ! npm view "ruflo-patch@${VERSION}" version >/dev/null 2>&1; then
    echo "Error: ruflo-patch@${VERSION} not found on npm."
    echo "Publish it first, then promote."
    exit 1
  fi
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] Found ruflo-patch@${VERSION} on npm."
fi

# ---------- Show previous version ----------
if [[ -f "$STATE_FILE" ]]; then
  PREV_VERSION=$(cat "$STATE_FILE")
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] Previous @latest: $PREV_VERSION"
else
  PREV_VERSION="(none)"
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] No previous .last-promoted-version found."
fi

# ---------- Summary ----------
echo ""
echo "Promotion plan"
echo "  Version        : $VERSION"
echo "  Previous       : $PREV_VERSION"
echo "  Packages       : $TOTAL (ruflo-patch + ${#SCOPED_PACKAGES[@]} scoped)"
echo "  Dry run        : $DRY_RUN"
echo ""

# ---------- Confirmation ----------
if [[ "$DRY_RUN" == false && "$AUTO_YES" == false ]]; then
  read -r -p "Promote ${VERSION} to @latest? [y/N] " confirm
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
echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] Promoting ${VERSION} to @latest"
echo ""

# Root package
run_dist_tag "ruflo-patch@${VERSION}"

# Scoped packages
for pkg in "${SCOPED_PACKAGES[@]}"; do
  run_dist_tag "@claude-flow-patch/${pkg}@${VERSION}"
done

# ---------- Update state file ----------
if [[ "$DRY_RUN" == true ]]; then
  echo ""
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] [dry-run] Would write '${VERSION}' to $STATE_FILE"
elif [[ "$FAILURES" -gt 0 ]]; then
  echo ""
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] Promotion finished with $FAILURES failure(s)."
  echo "State file NOT updated. Re-run failed packages manually or retry."
  exit 1
else
  # Atomic update: write to temp file, then mv (ADR-0019)
  TMPFILE=$(mktemp "$SCRIPT_DIR/.last-promoted-version.XXXXXX")
  echo -n "$VERSION" > "$TMPFILE"
  mv -f "$TMPFILE" "$STATE_FILE"

  echo ""
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] Promotion complete."
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] Updated $STATE_FILE -> ${VERSION}"
  echo "Verify: npm view ruflo-patch dist-tags"
  echo "Verify: npx ruflo-patch@latest --version"
fi
