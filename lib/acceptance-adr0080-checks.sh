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
    candidate=$(find "${base}/${pkg}" -path '*/node_modules' -prune -o \
      -name 'resolve-config*' -name '*.js' -print 2>/dev/null | head -1)
    if [[ -n "$candidate" ]]; then
      rc_file="$candidate"
      break
    fi
  done

  if [[ -z "$rc_file" ]]; then
    # Broader search across all packages
    rc_file=$(find "$base" -path '*/node_modules' -prune -o \
      -name 'resolve-config*' -name '*.js' -print 2>/dev/null | head -1)
  fi

  if [[ -z "$rc_file" ]]; then
    _CHECK_OUTPUT="ADR-0080-2: resolve-config*.js not found in any published package"
    return
  fi

  # Check for maxElements or maxEntries set to 100000 (compiled JS may use 100_000
  # or uppercase MAX_ENTRIES)
  if grep -qiE 'max.*(elements|entries).*(100000|100_000)|(100000|100_000).*max.*(elements|entries)' "$rc_file" 2>/dev/null; then
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

    # Find files containing writeJSON (exclude nested node_modules only).
    # Collect into a temp file to avoid subshell variable scoping issues.
    local wj_list
    wj_list=$(mktemp)
    find "$pkg_dir" -path '*/node_modules' -prune -o \
      \( -name '*.js' -o -name '*.mjs' -o -name '*.cjs' \) -print 2>/dev/null \
      | xargs grep -l 'writeJSON\|write_json\|writeJson' 2>/dev/null > "$wj_list" 2>/dev/null || true

    if [[ -s "$wj_list" ]]; then
      if xargs grep -q '\.tmp' < "$wj_list" 2>/dev/null; then
        found_tmp="true"
        found_in="$pkg"
      fi
      if xargs grep -q 'renameSync\|rename(' < "$wj_list" 2>/dev/null; then
        found_rename="true"
      fi
    fi
    rm -f "$wj_list"
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
    intel_pub=$(find "$base" -path '*/node_modules' -prune -o \
      \( -name 'intelligence*' \( -name '*.js' -o -name '*.cjs' \) \) -print \
      2>/dev/null | head -1)

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
    cap_file=$(find "$base" -path '*/node_modules' -prune -o \
      \( -name '*.js' -o -name '*.cjs' \) -print 2>/dev/null \
      | xargs grep -l 'MAX_STORE_ENTRIES' 2>/dev/null | head -1)
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
    candidate=$(find "${base}/${pkg}" -path '*/node_modules' -prune -o \
      -name 'database-provider*' -name '*.js' -print 2>/dev/null | head -1)
    if [[ -n "$candidate" ]]; then
      dbprov="$candidate"
      break
    fi
  done

  if [[ -z "$dbprov" ]]; then
    # Broader search
    dbprov=$(find "$base" -path '*/node_modules' -prune -o \
      -name 'database-provider*' -name '*.js' -print 2>/dev/null | head -1)
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

# ════════════════════════════════════════════════════════════════════
# ADR-0080-6: Provider must reference transformers.js (not bare transformers)
# ════════════════════════════════════════════════════════════════════

check_adr0080_provider_transformers_js() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local base="${TEMP_DIR}/node_modules/@sparkleideas"
  if [[ ! -d "$base" ]]; then
    _CHECK_OUTPUT="ADR-0080-6: @sparkleideas not installed in TEMP_DIR"
    return
  fi

  # Find config-template files across published packages
  local tpl_file=""
  for pkg in cli memory agentdb; do
    local candidate
    candidate=$(find "${base}/${pkg}" -path '*/node_modules' -prune -o \
      -name 'config-template*' -name '*.js' -print 2>/dev/null | head -1)
    if [[ -n "$candidate" ]]; then
      tpl_file="$candidate"
      break
    fi
  done

  if [[ -z "$tpl_file" ]]; then
    # Broader search
    tpl_file=$(find "$base" -path '*/node_modules' -prune -o \
      -name 'config-template*' -name '*.js' -print 2>/dev/null | head -1)
  fi

  if [[ -z "$tpl_file" ]]; then
    _CHECK_OUTPUT="ADR-0080-6: config-template*.js not found in published packages"
    return
  fi

  local short_path
  short_path=$(echo "$tpl_file" | sed "s|${base}/||")

  # Must contain "transformers.js" (the npm package name), not bare "transformers"
  if grep -q 'transformers\.js' "$tpl_file" 2>/dev/null; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0080-6: provider references transformers.js in ${short_path}"
  else
    _CHECK_OUTPUT="ADR-0080-6: transformers.js not found in ${short_path} (may use bare 'transformers')"
  fi
}

# ════════════════════════════════════════════════════════════════════
# ADR-0080-7: embeddings.json has all 7 storage fields
# ════════════════════════════════════════════════════════════════════

check_adr0080_embeddings_json_complete() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  # Fields written by executor.js into .claude-flow/embeddings.json (ADR-0080)
  local required_fields="storageProvider databasePath walMode maxEntries defaultNamespace dedupThreshold dimension"

  # Build list of candidate files to check (first match with all fields wins)
  local candidates=()
  local labels=()

  # 1. Init'd project embeddings.json (.claude-flow/ is the init'd location)
  for emb_subdir in .claude-flow .claude; do
    local emb_candidate="${E2E_DIR:+${E2E_DIR}/${emb_subdir}/embeddings.json}"
    if [[ -n "$emb_candidate" && -f "$emb_candidate" ]]; then
      candidates+=("$emb_candidate")
      labels+=("init'd project")
      break
    fi
  done

  # 2. Published executor.js (contains the embeddings.json template)
  local base="${TEMP_DIR}/node_modules/@sparkleideas"
  if [[ -d "$base" ]]; then
    local executor
    executor=$(find "$base" -path '*/node_modules' -prune -o \
      -name 'executor*' -name '*.js' -print 2>/dev/null | head -1)
    if [[ -n "$executor" && -f "$executor" ]]; then
      candidates+=("$executor")
      labels+=("published executor")
    fi

    # 3. Broader: any file containing storageProvider
    local broad_file
    broad_file=$(find "$base" -path '*/node_modules' -prune -o \
      \( -name '*.js' -o -name '*.json' \) -print 2>/dev/null \
      | xargs grep -l 'storageProvider' 2>/dev/null | head -1)
    if [[ -n "$broad_file" && -f "$broad_file" ]]; then
      candidates+=("$broad_file")
      labels+=("published packages (broad)")
    fi
  fi

  if [[ ${#candidates[@]} -eq 0 ]]; then
    _CHECK_OUTPUT="ADR-0080-7: no embeddings.json or storage-field source found"
    return
  fi

  # Check each candidate; pass on first one with all required fields
  local best_file="" best_label="" best_found=0 best_missing="" best_total=0
  local idx=0
  for emb_file in "${candidates[@]}"; do
    local label="${labels[$idx]}"
    idx=$((idx + 1))

    local missing=""
    local found=0
    local total=0
    for field in $required_fields; do
      total=$((total + 1))
      if grep -q "$field" "$emb_file" 2>/dev/null; then
        found=$((found + 1))
      else
        missing="${missing:+${missing}, }${field}"
      fi
    done

    if [[ "$found" -eq "$total" ]]; then
      local short_path
      short_path=$(echo "$emb_file" | sed "s|${TEMP_DIR}/node_modules/@sparkleideas/||" \
        | sed "s|${E2E_DIR}/||")
      _CHECK_PASSED="true"
      _CHECK_OUTPUT="ADR-0080-7: all ${total} storage fields present in ${short_path}"
      return
    fi

    # Track best candidate for error reporting
    if [[ "$found" -gt "$best_found" ]]; then
      best_file="$emb_file"
      best_label="$label"
      best_found="$found"
      best_missing="$missing"
      best_total="$total"
    fi
  done

  local short_path
  short_path=$(echo "$best_file" | sed "s|${TEMP_DIR}/node_modules/@sparkleideas/||" \
    | sed "s|${E2E_DIR}/||")
  _CHECK_OUTPUT="ADR-0080-7: ${best_found}/${best_total} fields in ${short_path} (${best_label}), missing: ${best_missing}"
}

# ════════════════════════════════════════════════════════════════════
# ADR-0080-8: Wizard embedding-model default is all-mpnet-base-v2
# ════════════════════════════════════════════════════════════════════

check_adr0080_wizard_canonical_model() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local base="${TEMP_DIR}/node_modules/@sparkleideas"
  if [[ ! -d "$base" ]]; then
    _CHECK_OUTPUT="ADR-0080-8: @sparkleideas not installed in TEMP_DIR"
    return
  fi

  # Find init command files (wizard lives in CLI init)
  local init_file=""
  for candidate_name in 'init*' 'wizard*' 'setup*'; do
    local candidate
    candidate=$(find "${base}/cli" -path '*/node_modules' -prune -o \
      -name "${candidate_name}" -name '*.js' -print 2>/dev/null | head -1)
    if [[ -n "$candidate" ]]; then
      init_file="$candidate"
      break
    fi
  done

  if [[ -z "$init_file" ]]; then
    # Broader search: any .js file containing both "wizard" and "embedding"
    init_file=$(find "${base}/cli" -path '*/node_modules' -prune -o \
      -name '*.js' -print 2>/dev/null \
      | xargs grep -l 'embedding.*model\|embeddingModel' 2>/dev/null | head -1)
  fi

  if [[ -z "$init_file" ]]; then
    # Even broader: search all packages
    init_file=$(find "$base" -path '*/node_modules' -prune -o \
      -name '*.js' -print 2>/dev/null \
      | xargs grep -l 'all-mpnet-base-v2' 2>/dev/null | head -1)
  fi

  if [[ -z "$init_file" ]]; then
    _CHECK_OUTPUT="ADR-0080-8: no init/wizard file with embedding model reference found"
    return
  fi

  local short_path
  short_path=$(echo "$init_file" | sed "s|${base}/||")

  if grep -q 'all-mpnet-base-v2' "$init_file" 2>/dev/null; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0080-8: wizard default all-mpnet-base-v2 found in ${short_path}"
  else
    _CHECK_OUTPUT="ADR-0080-8: all-mpnet-base-v2 not found in ${short_path}"
  fi
}

# ════════════════════════════════════════════════════════════════════
# ADR-0080-9: memory-bridge maxEntries fallback is 100000
# ════════════════════════════════════════════════════════════════════

check_adr0080_memory_bridge_100k() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local base="${TEMP_DIR}/node_modules/@sparkleideas"
  if [[ ! -d "$base" ]]; then
    _CHECK_OUTPUT="ADR-0080-9: @sparkleideas not installed in TEMP_DIR"
    return
  fi

  # Find memory-bridge in published packages
  local bridge_file=""
  for pkg in cli memory agentdb; do
    local candidate
    candidate=$(find "${base}/${pkg}" -path '*/node_modules' -prune -o \
      -name 'memory-bridge*' -name '*.js' -print 2>/dev/null | head -1)
    if [[ -n "$candidate" ]]; then
      bridge_file="$candidate"
      break
    fi
  done

  if [[ -z "$bridge_file" ]]; then
    # Broader search
    bridge_file=$(find "$base" -path '*/node_modules' -prune -o \
      -name 'memory-bridge*' -name '*.js' -print 2>/dev/null | head -1)
  fi

  if [[ -z "$bridge_file" ]]; then
    _CHECK_OUTPUT="ADR-0080-9: memory-bridge*.js not found in published packages"
    return
  fi

  local short_path
  short_path=$(echo "$bridge_file" | sed "s|${base}/||")

  # Check for maxEntries fallback of 100000
  if grep -qE 'maxEntries.*100000|100000.*maxEntries' "$bridge_file" 2>/dev/null; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0080-9: maxEntries fallback 100000 found in ${short_path}"
  else
    # Also check for the pattern: || 100000 or ?? 100000 near maxEntries
    if grep -qE '100000' "$bridge_file" 2>/dev/null && \
       grep -qE 'maxEntries' "$bridge_file" 2>/dev/null; then
      _CHECK_PASSED="true"
      _CHECK_OUTPUT="ADR-0080-9: maxEntries and 100000 both present in ${short_path}"
    else
      _CHECK_OUTPUT="ADR-0080-9: maxEntries fallback 100000 not found in ${short_path}"
    fi
  fi
}

# ════════════════════════════════════════════════════════════════════
# ADR-0080-10: memory store works after init (no manual sqlite3 needed)
# ════════════════════════════════════════════════════════════════════

check_adr0080_store_after_init() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local e2e="${E2E_DIR}"
  if [[ -z "$e2e" || ! -d "$e2e" ]]; then
    _CHECK_OUTPUT="ADR-0080-10: E2E_DIR not set or missing"
    return
  fi

  # Try storing an entry — should succeed without manual table creation
  local store_out
  store_out=$(cd "$e2e" && npx @sparkleideas/cli@latest memory store \
    --key "adr0080-test" --value "acceptance test entry" --namespace test 2>&1) || true

  if echo "$store_out" | grep -qi 'stored\|success'; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0080-10: memory store works after init"
  else
    local err
    err=$(echo "$store_out" | grep -i 'error\|no such table' | head -1)
    _CHECK_OUTPUT="ADR-0080-10: memory store failed: ${err:-unknown error}"
  fi
}

# ════════════════════════════════════════════════════════════════════
# ADR-0080-11: RVF is primary storage — bridge resolves correct path
# ════════════════════════════════════════════════════════════════════

check_adr0080_rvf_primary() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local base="${TEMP_DIR}/node_modules/@sparkleideas"
  if [[ ! -d "$base" ]]; then
    _CHECK_OUTPUT="ADR-0080-11: @sparkleideas not installed in TEMP_DIR"
    return
  fi

  # 1. memory-bridge must NOT hardcode 'agentdb-memory.rvf'
  local bridge_file=""
  bridge_file=$(find "$base" -name 'memory-bridge.js' -o -name 'memory-bridge.js.map' \
    2>/dev/null | grep -v node_modules/ | grep 'memory-bridge\.js$' | head -1)

  if [[ -z "$bridge_file" ]]; then
    _CHECK_OUTPUT="ADR-0080-11: memory-bridge*.js not found"
    return
  fi

  local short_path
  short_path=$(echo "$bridge_file" | sed "s|${base}/||")

  if grep -q 'agentdb-memory\.rvf' "$bridge_file" 2>/dev/null; then
    _CHECK_OUTPUT="ADR-0080-11: memory-bridge still hardcodes 'agentdb-memory.rvf' in ${short_path}"
    return
  fi

  # 2. memory-bridge must read databasePath from embeddings.json
  if grep -q 'databasePath\|embeddings\.json' "$bridge_file" 2>/dev/null; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0080-11: RVF path resolved from embeddings.json in ${short_path}"
  else
    # 3. At minimum must reference memory.rvf (canonical name)
    if grep -q 'memory\.rvf' "$bridge_file" 2>/dev/null; then
      _CHECK_PASSED="true"
      _CHECK_OUTPUT="ADR-0080-11: RVF path uses canonical 'memory.rvf' in ${short_path}"
    else
      _CHECK_OUTPUT="ADR-0080-11: no RVF path resolution found in ${short_path}"
    fi
  fi
}

# ════════════════════════════════════════════════════════════════════
# ADR-0080-12: No dead .claude/memory.db copy
# ════════════════════════════════════════════════════════════════════

check_adr0080_no_dead_copy() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local base="${TEMP_DIR}/node_modules/@sparkleideas"
  if [[ ! -d "$base" ]]; then
    _CHECK_OUTPUT="ADR-0080-12: @sparkleideas not installed in TEMP_DIR"
    return
  fi

  # memory.ts (the memory command) must NOT copyFileSync to .claude/memory.db
  local mem_cmd=""
  mem_cmd=$(find "$base" -name 'memory.js' -path '*/commands/*' \
    -path '*/node_modules' -prune -o -name '*.js' -print 2>/dev/null \
    | grep 'commands.*memory' | head -1)

  if [[ -z "$mem_cmd" ]]; then
    _CHECK_OUTPUT="ADR-0080-12: commands/memory.js not found"
    return
  fi

  local short_path
  short_path=$(echo "$mem_cmd" | sed "s|${base}/||")

  if grep -q 'copyFileSync.*claudeDbPath\|copyFileSync.*claude.*memory' "$mem_cmd" 2>/dev/null; then
    _CHECK_OUTPUT="ADR-0080-12: commands/memory.js still copies to .claude/memory.db in ${short_path}"
  else
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0080-12: no dead .claude/memory.db copy in ${short_path}"
  fi
}
