#!/usr/bin/env bash
# promote.sh -- Promote published versions to @latest (ADR-0010, ADR-0019)
#
# Reads per-package versions from config/published-versions.json and runs
# `npm dist-tag add <pkg>@<version> latest` for each package.
#
# Usage:
#   promote.sh                  # Promote all packages to @latest
#   promote.sh --dry-run        # Print commands without executing
#   promote.sh --yes            # Skip confirmation prompt
#   promote.sh <build-version>  # Label for state file (optional)
#
# Updates scripts/.last-promoted-version atomically on success.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
STATE_FILE="$SCRIPT_DIR/.last-promoted-version"
VERSIONS_FILE="$PROJECT_DIR/config/published-versions.json"

# ---------- Defaults ----------
DRY_RUN=false
AUTO_YES=false
BUILD_VERSION=""

# ---------- Parse arguments ----------
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --yes|-y)  AUTO_YES=true ;;
    -*)        echo "Unknown flag: $arg"; exit 1 ;;
    *)         BUILD_VERSION="$arg" ;;
  esac
done

# ---------- Load per-package versions ----------
if [[ ! -f "$VERSIONS_FILE" ]]; then
  echo "Error: $VERSIONS_FILE not found."
  echo "Run the publish pipeline first."
  exit 1
fi

# Parse JSON into bash associative array
declare -A PKG_VERSIONS
while IFS='=' read -r key value; do
  [[ -n "$key" ]] && PKG_VERSIONS["$key"]="$value"
done < <(node -e "
  const pv = JSON.parse(require('fs').readFileSync('$VERSIONS_FILE', 'utf-8'));
  for (const [name, ver] of Object.entries(pv)) {
    console.log(name + '=' + ver);
  }
")

TOTAL=${#PKG_VERSIONS[@]}

if [[ $TOTAL -eq 0 ]]; then
  echo "Error: No packages found in $VERSIONS_FILE"
  exit 1
fi

# ---------- Show previous version ----------
if [[ -f "$STATE_FILE" ]]; then
  PREV_VERSION=$(cat "$STATE_FILE")
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] Previous promotion: $PREV_VERSION"
else
  PREV_VERSION="(none)"
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] No previous .last-promoted-version found."
fi

# ---------- Summary ----------
echo ""
echo "Promotion plan"
echo "  Packages       : $TOTAL (per-package versions from published-versions.json)"
echo "  Build label    : ${BUILD_VERSION:-(not specified)}"
echo "  Dry run        : $DRY_RUN"
echo ""

# Show first few packages
local_count=0
for pkg in "${!PKG_VERSIONS[@]}"; do
  echo "  ${pkg}@${PKG_VERSIONS[$pkg]}"
  local_count=$((local_count + 1))
  if [[ $local_count -ge 5 ]]; then
    echo "  ... and $((TOTAL - 5)) more"
    break
  fi
done
echo ""

# ---------- Confirmation ----------
if [[ "$DRY_RUN" == false && "$AUTO_YES" == false ]]; then
  read -r -p "Promote all $TOTAL packages to @latest? [y/N] " confirm
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
PROMOTED=0

run_dist_tag() {
  local pkg_spec="$1"
  local ts
  ts="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"

  if [[ "$DRY_RUN" == true ]]; then
    echo "[$ts] [dry-run] npm dist-tag add \"$pkg_spec\" latest"
    PROMOTED=$((PROMOTED + 1))
  else
    echo -n "[$ts] npm dist-tag add \"$pkg_spec\" latest ... "
    if npm dist-tag add "$pkg_spec" latest 2>&1; then
      echo "OK"
      PROMOTED=$((PROMOTED + 1))
    else
      echo "FAILED"
      FAILURES=$((FAILURES + 1))
    fi
  fi
}

# ---------- Execute ----------
echo ""
echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] Promoting $TOTAL packages to @latest"
echo ""

for pkg in "${!PKG_VERSIONS[@]}"; do
  run_dist_tag "${pkg}@${PKG_VERSIONS[$pkg]}"
done

# ---------- Update state file ----------
LABEL="${BUILD_VERSION:-$(date -u '+%Y-%m-%dT%H:%M:%SZ')}"

if [[ "$DRY_RUN" == true ]]; then
  echo ""
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] [dry-run] Would write '${LABEL}' to $STATE_FILE"
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] [dry-run] $PROMOTED packages would be promoted"
elif [[ "$FAILURES" -gt 0 ]]; then
  echo ""
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] Promotion finished with $FAILURES failure(s), $PROMOTED promoted."
  echo "State file NOT updated. Re-run to retry failed packages."
  exit 1
else
  # Atomic update: write to temp file, then mv (ADR-0019)
  TMPFILE=$(mktemp "$SCRIPT_DIR/.last-promoted-version.XXXXXX")
  echo -n "$LABEL" > "$TMPFILE"
  mv -f "$TMPFILE" "$STATE_FILE"

  echo ""
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] Promotion complete: $PROMOTED packages promoted to @latest."
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] Updated $STATE_FILE -> ${LABEL}"
  echo "Verify: npm view @sparkleideas/cli dist-tags"
  echo "Verify: npx @sparkleideas/cli@latest --version"
fi
