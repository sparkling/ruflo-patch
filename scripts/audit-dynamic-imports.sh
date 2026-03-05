#!/usr/bin/env bash
# audit-dynamic-imports.sh — Scan upstream sources for dynamic imports
# referencing @claude-flow and classify whether the codemod handles them.
#
# Usage:
#   bash scripts/audit-dynamic-imports.sh [dir ...]
#
# Defaults to known upstream repo paths if no arguments provided.
# Exit code: 0 if no NEEDS_PATCH items, 1 if any NEEDS_PATCH items found.

set -euo pipefail

# --- Configuration -----------------------------------------------------------

DEFAULT_DIRS=(
  /home/claude/src/upstream/ruflo
  /home/claude/src/upstream/agentic-flow
  /home/claude/src/upstream/ruv-FANN
)

DIRS=("${@:-}")
if [[ ${#DIRS[@]} -eq 0 ]] || [[ -z "${DIRS[0]}" ]]; then
  DIRS=("${DEFAULT_DIRS[@]}")
fi

INCLUDE_EXTS=(--include='*.js' --include='*.ts' --include='*.mjs' --include='*.cjs')
EXCLUDE_DIRS=(--exclude-dir=.git --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=build)

TMPFILE="$(mktemp /tmp/audit-dynamic-imports.XXXXXX)"
trap 'rm -f "$TMPFILE"' EXIT

# --- Helpers -----------------------------------------------------------------

# is_comment returns 0 if the trimmed line looks like a comment.
is_comment() {
  local t="$1"
  [[ "$t" =~ ^// ]] || [[ "$t" =~ ^\*\  ]] || [[ "$t" =~ ^/\* ]] || [[ "$t" =~ ^\# ]]
}

# classify takes file, lineno, line_content and appends a TSV row to TMPFILE.
classify() {
  local file="$1" lineno="$2" line="$3"
  local trimmed
  trimmed="$(printf '%s' "$line" | sed 's/^[[:space:]]*//' | sed 's/[[:space:]]*$//')"

  # Skip comments
  if is_comment "$trimmed"; then
    return
  fi

  local location="${file}:${lineno}"

  # --- Static imports/requires: skip silently ---

  # import/export ... from '@claude-flow/...'
  if printf '%s' "$trimmed" | grep -qP "^\s*(import|export)\s.*from\s+['\"]@claude-flow/"; then
    printf 'STATIC\t%s\t%s\t%s\n' "$location" "static import/export" "-" >> "$TMPFILE"
    return
  fi

  # require('@claude-flow/something') — plain string, no concatenation
  if printf '%s' "$trimmed" | grep -qP "require\(\s*['\"]@claude-flow/[a-zA-Z0-9._-]+['\"]\s*\)"; then
    if ! printf '%s' "$trimmed" | grep -qP "require\(\s*['\"]@claude-flow/.*(\+|\\\$\{)"; then
      printf 'STATIC\t%s\t%s\t%s\n' "$location" "static require" "-" >> "$TMPFILE"
      return
    fi
  fi

  # import('@claude-flow/something') — plain dynamic import with full literal
  if printf '%s' "$trimmed" | grep -qP "import\(\s*['\"]@claude-flow/[a-zA-Z0-9._-]+['\"]\s*\)"; then
    if ! printf '%s' "$trimmed" | grep -qP "import\(\s*['\"]@claude-flow/.*(\+|\\\$\{)"; then
      printf 'STATIC\t%s\t%s\t%s\n' "$location" "static dynamic import" "-" >> "$TMPFILE"
      return
    fi
  fi

  # --- Dynamic patterns: classify as HANDLED or NEEDS_PATCH ---

  # Pattern: require('@claude-flow/' + ...) — concatenation with literal prefix
  if printf '%s' "$trimmed" | grep -qP "require\(\s*['\"]@claude-flow/?['\"]?\s*\+"; then
    printf 'HANDLED\t%s\t%s\t%s\n' "$location" "require('@claude-flow/' + ...)" "literal prefix in concatenation" >> "$TMPFILE"
    return
  fi

  # Pattern: import(`@claude-flow/${...}`) — template literal with literal prefix
  if printf '%s' "$trimmed" | grep -qP 'import\(\s*`@claude-flow/\$\{'; then
    printf 'HANDLED\t%s\t%s\t%s\n' "$location" 'import(`@claude-flow/${...}`)' "literal prefix in template" >> "$TMPFILE"
    return
  fi

  # Pattern: require(`@claude-flow/${...}`) — template literal in require
  if printf '%s' "$trimmed" | grep -qP 'require\(\s*`@claude-flow/\$\{'; then
    printf 'HANDLED\t%s\t%s\t%s\n' "$location" 'require(`@claude-flow/${...}`)' "literal prefix in template" >> "$TMPFILE"
    return
  fi

  # Pattern: variable holds '@claude-flow' scope string (not inside require/import call)
  if printf '%s' "$trimmed" | grep -qP "(const|let|var|=)\s.*['\"]@claude-flow/?['\"]"; then
    if ! printf '%s' "$trimmed" | grep -qP "(require|import)\s*\("; then
      printf 'NEEDS_PATCH\t%s\t%s\t%s\n' "$location" "variable holds '@claude-flow' scope" "scope in variable — fully indirect" >> "$TMPFILE"
      return
    fi
  fi

  # Pattern: @claude-flow inside a template literal with interpolation (not import/require call)
  if printf '%s' "$trimmed" | grep -qP '`[^`]*@claude-flow[^`]*\$\{[^`]*`'; then
    printf 'HANDLED\t%s\t%s\t%s\n' "$location" "template literal with @claude-flow prefix" "literal prefix in template" >> "$TMPFILE"
    return
  fi

  # Pattern: '@claude-flow/pkg' string in a data structure (object, array, map)
  if printf '%s' "$trimmed" | grep -qP "['\"]@claude-flow/[a-zA-Z0-9._-]+['\"]"; then
    printf 'NEEDS_PATCH\t%s\t%s\t%s\n' "$location" "@claude-flow/* string in data structure" "may be used for indirect lookup" >> "$TMPFILE"
    return
  fi

  # Catch-all: any remaining @claude-flow reference
  if printf '%s' "$trimmed" | grep -qP '@claude-flow'; then
    printf 'NEEDS_PATCH\t%s\t%s\t%s\n' "$location" "@claude-flow reference (unclassified)" "review manually" >> "$TMPFILE"
    return
  fi
}

# --- Main scan ---------------------------------------------------------------

found_any_dir=false

for dir in "${DIRS[@]}"; do
  if [[ ! -d "$dir" ]]; then
    echo "# WARN: directory not found, skipping: $dir" >&2
    continue
  fi
  found_any_dir=true

  while IFS= read -r match_line; do
    [[ -z "$match_line" ]] && continue

    # grep -rn output format: filepath:lineno:content
    # filepath may contain colons (unlikely but handle gracefully)
    local_file="${match_line%%:*}"
    remainder="${match_line#*:}"
    local_lineno="${remainder%%:*}"
    local_content="${remainder#*:}"

    classify "$local_file" "$local_lineno" "$local_content"
  done < <(grep -rnP "${INCLUDE_EXTS[@]}" "${EXCLUDE_DIRS[@]}" '@claude-flow' "$dir" 2>/dev/null || true)
done

if [[ "$found_any_dir" == false ]]; then
  echo "# ERROR: none of the specified directories exist" >&2
  exit 2
fi

# --- Output ------------------------------------------------------------------

# Print header + non-STATIC rows as the TSV manifest
printf 'STATUS\tFILE:LINE\tPATTERN\tNOTES\n'
grep -v '^STATIC' "$TMPFILE" 2>/dev/null || true

# --- Summary -----------------------------------------------------------------

# grep -c exits 1 when count is 0; use || true to prevent pipefail
total_dynamic=$(grep -cv '^STATIC' "$TMPFILE" 2>/dev/null || true)
handled_count=$(grep -c '^HANDLED' "$TMPFILE" 2>/dev/null || true)
needs_patch_count=$(grep -c '^NEEDS_PATCH' "$TMPFILE" 2>/dev/null || true)
static_count=$(grep -c '^STATIC' "$TMPFILE" 2>/dev/null || true)

# Default empty to 0
: "${total_dynamic:=0}"
: "${handled_count:=0}"
: "${needs_patch_count:=0}"
: "${static_count:=0}"

echo "" >&2
echo "# --- Summary ---" >&2
echo "# Total dynamic import matches: $total_dynamic" >&2
echo "# HANDLED (codemod covers):     $handled_count" >&2
echo "# NEEDS_PATCH (manual patch):   $needs_patch_count" >&2
echo "# Skipped static imports:       $static_count" >&2

if [[ "$needs_patch_count" -gt 0 ]]; then
  echo "# EXIT: 1 (NEEDS_PATCH items found)" >&2
  exit 1
else
  echo "# EXIT: 0 (all dynamic imports handled)" >&2
  exit 0
fi
