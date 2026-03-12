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
ROLLBACK=false
BUILD_VERSION=""

# ---------- Parse arguments ----------
for arg in "$@"; do
  case "$arg" in
    --dry-run)   DRY_RUN=true ;;
    --rollback)  ROLLBACK=true ;;
    --yes|-y)    AUTO_YES=true ;;
    -*)        echo "Unknown flag: $arg"; exit 1 ;;
    *)         BUILD_VERSION="$arg" ;;
  esac
done

# ---------- Timing helpers ----------
_ns() { date +%s%N 2>/dev/null || echo 0; }
_elapsed_ms() {
  local s="$1" e="$2"
  if [[ "$s" != "0" && "$e" != "0" ]]; then
    echo $(( (e - s) / 1000000 ))
  else
    echo 0
  fi
}

PROMOTE_START_NS=$(_ns)
PROMOTE_PKG_TIMINGS=""

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

# ---------- Rollback mode ----------
if [[ "$ROLLBACK" == true ]]; then
  echo ""
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] Rolling back: moving @previous to @latest for $TOTAL packages"
  echo ""
  ROLLBACK_FAILURES=0
  for pkg in "${!PKG_VERSIONS[@]}"; do
    prev_ver=$(npm view "${pkg}" dist-tags.previous 2>/dev/null || true)
    if [[ -z "$prev_ver" ]]; then
      echo "  ${pkg}: no @previous tag found — skipping"
      continue
    fi
    if [[ "$DRY_RUN" == true ]]; then
      echo "  [dry-run] would rollback ${pkg} to ${prev_ver}"
    else
      echo -n "  ${pkg}@${prev_ver} ... "
      if npm dist-tag add "${pkg}@${prev_ver}" latest 2>/dev/null; then
        echo "OK"
      else
        echo "FAILED"
        ROLLBACK_FAILURES=$((ROLLBACK_FAILURES + 1))
      fi
    fi
  done
  if [[ $ROLLBACK_FAILURES -gt 0 ]]; then
    echo "Rollback completed with $ROLLBACK_FAILURES failure(s)"
    exit 1
  fi
  echo "Rollback complete."
  exit 0
fi

# ---------- Helper ----------
PROMOTE_RESULTS_DIR=$(mktemp -d /tmp/ruflo-promote-XXXXX)

run_dist_tag() {
  local pkg_spec="$1"
  local ts _dt_start _dt_end _dt_ms
  # sanitize pkg_spec for use as filename
  local result_file="${PROMOTE_RESULTS_DIR}/${pkg_spec//\//_}"
  ts="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  _dt_start=$(_ns)

  if [[ "$DRY_RUN" == true ]]; then
    echo "[$ts] [dry-run] npm dist-tag add \"$pkg_spec\" latest"
    echo "OK" > "$result_file"
    _dt_ms=0
  else
    echo -n "[$ts] npm dist-tag add \"$pkg_spec\" latest ... "
    if npm dist-tag add "$pkg_spec" latest 2>&1; then
      echo "OK"
      echo "OK" > "$result_file"
    else
      echo "FAILED"
      echo "FAIL" > "$result_file"
    fi
    _dt_end=$(_ns)
    _dt_ms=$(_elapsed_ms "$_dt_start" "$_dt_end")
    echo "  (${_dt_ms}ms)"
  fi
}

# ---------- Snapshot current @latest as @previous ----------
echo ""
echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] Saving current @latest tags as @previous (for rollback)"
echo ""

for pkg in "${!PKG_VERSIONS[@]}"; do
  if [[ "$DRY_RUN" == true ]]; then
    echo "  [dry-run] would snapshot @previous for ${pkg}"
  else
    # Get current latest version (may not exist for first publish)
    current_latest=$(npm view "${pkg}" dist-tags.latest 2>/dev/null || true)
    if [[ -n "$current_latest" ]]; then
      npm dist-tag add "${pkg}@${current_latest}" previous 2>/dev/null || true
    fi
  fi
done

# ---------- Execute ----------
echo ""
echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] Promoting $TOTAL packages to @latest"
echo ""

MAX_PARALLEL=8
running=0
for pkg in "${!PKG_VERSIONS[@]}"; do
  run_dist_tag "${pkg}@${PKG_VERSIONS[$pkg]}" &
  running=$((running + 1))
  if [[ $running -ge $MAX_PARALLEL ]]; then
    wait -n 2>/dev/null || true
    running=$((running - 1))
  fi
done
wait

# Count results from temp files
PROMOTED=$(grep -rl "OK" "$PROMOTE_RESULTS_DIR" 2>/dev/null | wc -l)
FAILURES=$(grep -rl "FAIL" "$PROMOTE_RESULTS_DIR" 2>/dev/null | wc -l)
rm -rf "$PROMOTE_RESULTS_DIR"

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

# ---------- Timing summary ----------
PROMOTE_END_NS=$(_ns)
PROMOTE_TOTAL_MS=$(_elapsed_ms "$PROMOTE_START_NS" "$PROMOTE_END_NS")

echo ""
echo "──────────────────────────────────────────"
echo "Promote timing summary:"

# Sort by duration (descending) to highlight slowest packages
_sorted_timings=""
for entry in $PROMOTE_PKG_TIMINGS; do
  _pkg="${entry%:*}"
  _ms="${entry##*:}"
  _sorted_timings="${_sorted_timings}${_ms} ${_pkg}\n"
done

# Print top 10 slowest + total
echo -e "$_sorted_timings" | sort -rn | head -10 | while IFS=' ' read -r _ms _pkg; do
  [[ -z "$_ms" ]] && continue
  printf "  %-45s %6dms\n" "$_pkg" "$_ms"
done

if [[ $TOTAL -gt 10 ]]; then
  echo "  ... ($((TOTAL - 10)) more packages)"
fi
printf "  %-45s %6dms (%ds)\n" "TOTAL" "$PROMOTE_TOTAL_MS" "$((PROMOTE_TOTAL_MS / 1000))"
echo "──────────────────────────────────────────"
