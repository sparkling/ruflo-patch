#!/usr/bin/env bash
# lib/acceptance-adr0080-checks.sh — ADR-0080 acceptance checks
#
# Validates five ADR-0080 fixes in published @sparkleideas/* packages and
# init'd project helpers:
#   1. No hardcoded 1M maxEntries/maxElements in production code
#   2. Canonical 100K maxElements default in resolve-config
#   3. Atomic write pattern (.tmp + renameSync) in CLI writeJSON
#   4. MAX_STORE_ENTRIES cap in intelligence helper
#   5. createStorageFromConfig delegation in database-provider
#
# Requires: TEMP_DIR set by caller (install dir with node_modules/@sparkleideas/*)
# Requires: E2E_DIR set by caller (init'd project)
# Uses:     _find_pkg_js from acceptance-adr0063-checks.sh

# ════════════════════════════════════════════════════════════════════
# ADR-0080-1: No hardcoded 1M maxEntries/maxElements in production .js
# ════════════════════════════════════════════════════════════════════

check_adr0080_no_1m_maxentries() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local base="${TEMP_DIR}/node_modules/@sparkleideas"
  if [[ ! -d "$base" ]]; then
    _CHECK_OUTPUT="ADR-0080-1: @sparkleideas not installed in TEMP_DIR"
    return
  fi

  # Grep all production .js files for 1000000 near maxEntries or maxElements.
  # Exclude test files, spec files, and node_modules inside packages.
  local hits
  hits=$(find "$base" -path '*/node_modules' -prune -o \
    -name '*.js' -not -name '*.test.*' -not -name '*.spec.*' -print0 2>/dev/null \
    | xargs -0 grep -Hn 'max\(Entries\|Elements\).*1000000\|1000000.*max\(Entries\|Elements\)' 2>/dev/null \
    || true)

  local count=0
  if [[ -n "$hits" ]]; then
    count=$(echo "$hits" | wc -l | tr -d ' ')
  fi

  if [[ "$count" -eq 0 ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0080-1: zero hardcoded 1M maxEntries/maxElements in production .js files"
  else
    local files
    files=$(echo "$hits" | cut -d: -f1 | sort -u \
      | sed "s|${base}/||" | head -5 | tr '\n' ', ')
    _CHECK_OUTPUT="ADR-0080-1: ${count} hardcoded 1M maxEntries/maxElements hit(s) in: ${files%,}"
  fi
}

# ════════════════════════════════════════════════════════════════════
# ADR-0080-2: Canonical 100K maxElements default in resolve-config
# ════════════════════════════════════════════════════════════════════

check_adr0080_maxelements_100k() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local base="${TEMP_DIR}/node_modules/@sparkleideas"
  if [[ ! -d "$base" ]]; then
    _CHECK_OUTPUT="ADR-0080-2: @sparkleideas not installed in TEMP_DIR"
    return
  fi

  # Look for resolve-config in CLI or memory packages
  local rc_file=""
  for pkg in cli memory agentdb; do
    local candidate
    candidate=$(find "${base}/${pkg}" -name 'resolve-config*' -name '*.js' \
      -not -path '*/node_modules/*' 2>/dev/null | head -1)
    if [[ -n "$candidate" ]]; then
      rc_file="$candidate"
      break
    fi
  done

  if [[ -z "$rc_file" ]]; then
    # Broader search across all packages
    rc_file=$(find "$base" -name 'resolve-config*' -name '*.js' \
      -not -path '*/node_modules/*' 2>/dev/null | head -1)
  fi

  if [[ -z "$rc_file" ]]; then
    _CHECK_OUTPUT="ADR-0080-2: resolve-config*.js not found in any published package"
    return
  fi

  # Check for maxElements or maxEntries set to 100000
  if grep -qE 'max(Elements|Entries).*100000|100000.*max(Elements|Entries)' "$rc_file" 2>/dev/null; then
    _CHECK_PASSED="true"
    local short_path
    short_path=$(echo "$rc_file" | sed "s|${base}/||")
    _CHECK_OUTPUT="ADR-0080-2: canonical 100K maxElements default found in ${short_path}"
  else
    local short_path
    short_path=$(echo "$rc_file" | sed "s|${base}/||")
    _CHECK_OUTPUT="ADR-0080-2: no 100K maxElements/maxEntries default in ${short_path}"
  fi
}

# ════════════════════════════════════════════════════════════════════
# ADR-0080-3: Atomic write pattern in CLI helpers (writeJSON)
# ════════════════════════════════════════════════════════════════════

check_adr0080_atomic_writes() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local base="${TEMP_DIR}/node_modules/@sparkleideas"
  if [[ ! -d "$base" ]]; then
    _CHECK_OUTPUT="ADR-0080-3: @sparkleideas not installed in TEMP_DIR"
    return
  fi

  # Search for writeJSON implementations across CLI and memory packages.
  # The atomic pattern requires both .tmp file creation and renameSync.
  local found_tmp="false"
  local found_rename="false"
  local found_in=""

  for pkg in cli memory agentdb; do
    local pkg_dir="${base}/${pkg}"
    [[ -d "$pkg_dir" ]] || continue

    # Find files containing writeJSON
    local wj_files
    wj_files=$(grep -rl 'writeJSON\|write_json\|writeJson' "$pkg_dir" \
      --include='*.js' --include='*.mjs' --include='*.cjs' 2>/dev/null \
      | grep -v node_modules || true)

    for f in $wj_files; do
      if grep -q '\.tmp' "$f" 2>/dev/null; then
        found_tmp="true"
        found_in="$pkg"
      fi
      if grep -q 'renameSync\|rename(' "$f" 2>/dev/null; then
        found_rename="true"
      fi
    done
  done

  # Also check init'd project helpers (intelligence.cjs, auto-memory-hook.mjs)
  local intel="${E2E_DIR:+${E2E_DIR}/.claude/helpers/intelligence.cjs}"
  if [[ -n "$intel" && -f "$intel" ]]; then
    if grep -q '\.tmp' "$intel" 2>/dev/null; then
      found_tmp="true"
      found_in="${found_in:+${found_in}, }intelligence.cjs"
    fi
    if grep -q 'renameSync\|rename(' "$intel" 2>/dev/null; then
      found_rename="true"
    fi
  fi

  if [[ "$found_tmp" == "true" && "$found_rename" == "true" ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0080-3: atomic write pattern (.tmp + rename) found in ${found_in}"
  elif [[ "$found_tmp" == "true" ]]; then
    _CHECK_OUTPUT="ADR-0080-3: .tmp file creation found but renameSync missing (${found_in})"
  elif [[ "$found_rename" == "true" ]]; then
    _CHECK_OUTPUT="ADR-0080-3: renameSync found but .tmp pattern missing"
  else
    _CHECK_OUTPUT="ADR-0080-3: no atomic write pattern (.tmp + renameSync) in published packages or helpers"
  fi
}

# ════════════════════════════════════════════════════════════════════
# ADR-0080-4: MAX_STORE_ENTRIES cap in intelligence helper
# ════════════════════════════════════════════════════════════════════

check_adr0080_store_cap() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local intel="${E2E_DIR:+${E2E_DIR}/.claude/helpers/intelligence.cjs}"

  # First try init'd project
  if [[ -n "$intel" && -f "$intel" ]]; then
    if grep -qE 'MAX_STORE_ENTRIES.*=.*(1000|2000)|const.*MAX_STORE' "$intel" 2>/dev/null; then
      local cap_val
      cap_val=$(grep -oE 'MAX_STORE_ENTRIES\s*=\s*[0-9]+' "$intel" 2>/dev/null | grep -oE '[0-9]+' | head -1)
      _CHECK_PASSED="true"
      _CHECK_OUTPUT="ADR-0080-4: MAX_STORE_ENTRIES = ${cap_val:-capped} in intelligence.cjs"
      return
    fi
  fi

  # Fall back to published CLI package helpers
  local base="${TEMP_DIR}/node_modules/@sparkleideas"
  if [[ -d "$base" ]]; then
    local intel_pub
    intel_pub=$(find "$base" -name 'intelligence*' -name '*.js' -o -name 'intelligence*' -name '*.cjs' \
      2>/dev/null | grep -v node_modules | head -1)

    if [[ -n "$intel_pub" && -f "$intel_pub" ]]; then
      if grep -qE 'MAX_STORE_ENTRIES|maxStoreEntries' "$intel_pub" 2>/dev/null; then
        local cap_val
        cap_val=$(grep -oE 'MAX_STORE_ENTRIES\s*=\s*[0-9]+' "$intel_pub" 2>/dev/null | grep -oE '[0-9]+' | head -1)
        _CHECK_PASSED="true"
        local short_path
        short_path=$(echo "$intel_pub" | sed "s|${base}/||")
        _CHECK_OUTPUT="ADR-0080-4: MAX_STORE_ENTRIES = ${cap_val:-capped} in ${short_path}"
        return
      fi
    fi

    # Broader search: any file with MAX_STORE_ENTRIES or a 1000 cap near store
    local cap_file
    cap_file=$(grep -rl 'MAX_STORE_ENTRIES' "$base" --include='*.js' --include='*.cjs' \
      2>/dev/null | grep -v node_modules | head -1)
    if [[ -n "$cap_file" ]]; then
      local short_path
      short_path=$(echo "$cap_file" | sed "s|${base}/||")
      _CHECK_PASSED="true"
      _CHECK_OUTPUT="ADR-0080-4: MAX_STORE_ENTRIES found in ${short_path}"
      return
    fi
  fi

  if [[ -n "$intel" && ! -f "$intel" ]]; then
    _CHECK_OUTPUT="ADR-0080-4: intelligence.cjs not found at ${intel} and no MAX_STORE_ENTRIES in published packages"
  else
    _CHECK_OUTPUT="ADR-0080-4: no MAX_STORE_ENTRIES cap found in init'd project or published packages"
  fi
}

# ════════════════════════════════════════════════════════════════════
# ADR-0080-5: createStorageFromConfig delegation in database-provider
# ════════════════════════════════════════════════════════════════════

check_adr0080_factory_convergence() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local base="${TEMP_DIR}/node_modules/@sparkleideas"
  if [[ ! -d "$base" ]]; then
    _CHECK_OUTPUT="ADR-0080-5: @sparkleideas not installed in TEMP_DIR"
    return
  fi

  # Find database-provider in memory package (primary) or cli/agentdb
  local dbprov=""
  for pkg in memory cli agentdb; do
    local candidate
    candidate=$(find "${base}/${pkg}" -name 'database-provider*' -name '*.js' \
      -not -path '*/node_modules/*' 2>/dev/null | head -1)
    if [[ -n "$candidate" ]]; then
      dbprov="$candidate"
      break
    fi
  done

  if [[ -z "$dbprov" ]]; then
    # Broader search
    dbprov=$(find "$base" -name 'database-provider*' -name '*.js' \
      -not -path '*/node_modules/*' 2>/dev/null | head -1)
  fi

  if [[ -z "$dbprov" ]]; then
    _CHECK_OUTPUT="ADR-0080-5: database-provider*.js not found in published packages"
    return
  fi

  local short_path
  short_path=$(echo "$dbprov" | sed "s|${base}/||")

  if grep -q 'createStorageFromConfig' "$dbprov" 2>/dev/null; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0080-5: createStorageFromConfig delegation found in ${short_path}"
  else
    _CHECK_OUTPUT="ADR-0080-5: createStorageFromConfig not found in ${short_path}"
  fi
}
