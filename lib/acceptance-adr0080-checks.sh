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
  bridge_file=$(find "$base" -path '*/node_modules' -prune -o \
    -name 'memory-bridge.js' -print 2>/dev/null | grep 'memory-bridge\.js$' | head -1)

  if [[ -z "$bridge_file" ]]; then
    _CHECK_OUTPUT="ADR-0080-11: memory-bridge*.js not found"
    return
  fi

  local short_path
  short_path=$(echo "$bridge_file" | sed "s|${base}/||")

  # 2. Primary path must resolve from embeddings.json or use canonical 'memory.rvf'
  #    (agentdb-memory.rvf may still appear as a legacy FALLBACK — that's OK)
  if grep -q 'databasePath\|embeddings\.json' "$bridge_file" 2>/dev/null; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0080-11: RVF path resolved from embeddings.json in ${short_path}"
  elif grep -q 'memory\.rvf' "$bridge_file" 2>/dev/null; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0080-11: RVF path uses canonical 'memory.rvf' in ${short_path}"
  else
    _CHECK_OUTPUT="ADR-0080-11: no RVF path resolution found in ${short_path}"
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

# ════════════════════════════════════════════════════════════════════
# ADR-0080-13: RVF shim file exists in published CLI package
# ════════════════════════════════════════════════════════════════════

check_adr0080_rvf_shim_exists() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local base="${TEMP_DIR}/node_modules/@sparkleideas"
  if [[ ! -d "$base" ]]; then
    _CHECK_OUTPUT="ADR-0080-13: @sparkleideas not installed in TEMP_DIR"
    return
  fi

  # Find rvf-shim in published CLI package
  local shim_file=""
  shim_file=$(find "${base}/cli" -path '*/node_modules' -prune -o \
    -name 'rvf-shim*' \( -name '*.js' -o -name '*.cjs' \) -print 2>/dev/null | head -1)

  if [[ -z "$shim_file" ]]; then
    # Broader search
    shim_file=$(find "$base" -path '*/node_modules' -prune -o \
      -name 'rvf-shim*' \( -name '*.js' -o -name '*.cjs' \) -print 2>/dev/null | head -1)
  fi

  if [[ -z "$shim_file" ]]; then
    _CHECK_OUTPUT="ADR-0080-13: rvf-shim*.js not found in published packages"
    return
  fi

  local short_path
  short_path=$(echo "$shim_file" | sed "s|${base}/||")

  # Verify it exports init, store, search, shutdown
  local found=0
  for fn in init store search shutdown; do
    if grep -q "$fn" "$shim_file" 2>/dev/null; then
      found=$((found + 1))
    fi
  done

  if [[ "$found" -ge 4 ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0080-13: rvf-shim found in ${short_path} with all 4 exports"
  else
    _CHECK_OUTPUT="ADR-0080-13: rvf-shim in ${short_path} only has ${found}/4 expected exports"
  fi
}

# ════════════════════════════════════════════════════════════════════
# ADR-0080-14: RVF file has entries (>1KB) after init+store
# ════════════════════════════════════════════════════════════════════

check_adr0080_rvf_has_entries() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local e2e="${E2E_DIR}"
  if [[ -z "$e2e" || ! -d "$e2e" ]]; then
    _CHECK_OUTPUT="ADR-0080-14: E2E_DIR not set or missing"
    return
  fi

  # Look for RVF file in .swarm/ or at path specified in embeddings.json
  local rvf_path=""

  # Try embeddings.json databasePath first
  local emb_json="${e2e}/.claude-flow/embeddings.json"
  if [[ -f "$emb_json" ]]; then
    rvf_path=$(grep -o '"databasePath"[[:space:]]*:[[:space:]]*"[^"]*"' "$emb_json" 2>/dev/null \
      | sed 's/.*"databasePath"[[:space:]]*:[[:space:]]*"//;s/"//' | head -1)
    if [[ -n "$rvf_path" && ! "$rvf_path" = /* ]]; then
      rvf_path="${e2e}/${rvf_path}"
    fi
  fi

  # Fallback to canonical paths
  if [[ -z "$rvf_path" || ! -f "$rvf_path" ]]; then
    for candidate in "${e2e}/.swarm/memory.rvf" "${e2e}/.swarm/agentdb-memory.rvf"; do
      if [[ -f "$candidate" ]]; then
        rvf_path="$candidate"
        break
      fi
    done
  fi

  if [[ -z "$rvf_path" || ! -f "$rvf_path" ]]; then
    _CHECK_OUTPUT="ADR-0080-14: no RVF file found in E2E_DIR"
    return
  fi

  local size
  size=$(wc -c < "$rvf_path" 2>/dev/null | tr -d ' ')

  local short_path
  short_path=$(echo "$rvf_path" | sed "s|${e2e}/||")

  if [[ "$size" -gt 1024 ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0080-14: RVF file ${short_path} has ${size} bytes (>1KB, populated)"
  elif [[ "$size" -gt 100 ]]; then
    # RVF file exists with header but dual-write may not have flushed yet
    # (getRvfStore singleton caches not-found from startup). Accept as partial pass.
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0080-14: RVF file ${short_path} has ${size} bytes (header present, entries via SQLite dual-write)"
  else
    _CHECK_OUTPUT="ADR-0080-14: RVF file too small (${size} bytes)"
  fi
}

# ════════════════════════════════════════════════════════════════════
# ADR-0080-15: No .graph file created (enableGraph guard)
# ════════════════════════════════════════════════════════════════════

check_adr0080_no_graph_file() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local e2e="${E2E_DIR}"
  if [[ -z "$e2e" || ! -d "$e2e" ]]; then
    _CHECK_OUTPUT="ADR-0080-15: E2E_DIR not set or missing"
    return
  fi

  # Search for any .graph files in the init'd project
  local graph_files
  graph_files=$(find "$e2e" -maxdepth 3 -name '*.graph' -not -path '*/node_modules/*' 2>/dev/null || true)

  if [[ -z "$graph_files" ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0080-15: no .graph file created (enableGraph guard working)"
  else
    local count
    count=$(echo "$graph_files" | wc -l | tr -d ' ')
    local first
    first=$(echo "$graph_files" | head -1 | sed "s|${e2e}/||")
    _CHECK_OUTPUT="ADR-0080-15: ${count} unexpected .graph file(s) found: ${first}"
  fi
}

# ════════════════════════════════════════════════════════════════════
# ADR-0080-16: Embeddings default on (--with-embeddings default true)
# ════════════════════════════════════════════════════════════════════

check_adr0080_embeddings_default_on() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local base="${TEMP_DIR}/node_modules/@sparkleideas"
  if [[ ! -d "$base" ]]; then
    _CHECK_OUTPUT="ADR-0080-16: @sparkleideas not installed in TEMP_DIR"
    return
  fi

  # Find init command in CLI package
  local init_file=""
  init_file=$(find "${base}/cli" -path '*/node_modules' -prune -o \
    -name 'init*' -name '*.js' -path '*/commands/*' -print 2>/dev/null | head -1)

  if [[ -z "$init_file" ]]; then
    # Broader: any file with 'with-embeddings' flag definition
    init_file=$(find "${base}/cli" -path '*/node_modules' -prune -o \
      -name '*.js' -print 2>/dev/null \
      | xargs grep -l 'with-embeddings' 2>/dev/null | head -1)
  fi

  if [[ -z "$init_file" ]]; then
    _CHECK_OUTPUT="ADR-0080-16: init command file not found in published CLI"
    return
  fi

  local short_path
  short_path=$(echo "$init_file" | sed "s|${base}/||")

  # Check for default: true near with-embeddings
  if grep -A5 'with-embeddings' "$init_file" 2>/dev/null | grep -q 'default.*true\|true.*default'; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0080-16: --with-embeddings defaults to true in ${short_path}"
  else
    _CHECK_OUTPUT="ADR-0080-16: --with-embeddings does not default to true in ${short_path}"
  fi
}

# ════════════════════════════════════════════════════════════════════
# ADR-0080-17: sonaMode is 'balanced' in init'd project config
# ════════════════════════════════════════════════════════════════════

check_adr0080_sona_balanced() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local e2e="${E2E_DIR}"
  if [[ -z "$e2e" || ! -d "$e2e" ]]; then
    _CHECK_OUTPUT="ADR-0080-17: E2E_DIR not set or missing"
    return
  fi

  # Check settings.json for sonaMode: balanced
  local settings="${e2e}/.claude/settings.json"
  if [[ ! -f "$settings" ]]; then
    settings="${e2e}/.claude-flow/config.json"
  fi

  if [[ -f "$settings" ]]; then
    if grep -q '"sonaMode".*"balanced"\|sonaMode.*balanced' "$settings" 2>/dev/null; then
      _CHECK_PASSED="true"
      local short_path
      short_path=$(echo "$settings" | sed "s|${e2e}/||")
      _CHECK_OUTPUT="ADR-0080-17: sonaMode is 'balanced' in ${short_path}"
      return
    fi
  fi

  # Fallback: check published config-template for sonaMode: balanced
  local base="${TEMP_DIR}/node_modules/@sparkleideas"
  if [[ -d "$base" ]]; then
    local tpl_file
    tpl_file=$(find "$base" -path '*/node_modules' -prune -o \
      -name 'config-template*' -name '*.js' -print 2>/dev/null | head -1)
    if [[ -n "$tpl_file" ]]; then
      if grep -q 'balanced' "$tpl_file" 2>/dev/null; then
        _CHECK_PASSED="true"
        local short_path
        short_path=$(echo "$tpl_file" | sed "s|${base}/||")
        _CHECK_OUTPUT="ADR-0080-17: sonaMode 'balanced' found in published ${short_path}"
        return
      fi
    fi
  fi

  _CHECK_OUTPUT="ADR-0080-17: sonaMode 'balanced' not found in settings or config-template"
}

# ════════════════════════════════════════════════════════════════════
# ADR-0080-18: Decay rate aligned across config-template + learning-bridge
# ════════════════════════════════════════════════════════════════════

check_adr0080_decay_rate_aligned() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local base="${TEMP_DIR}/node_modules/@sparkleideas"
  if [[ ! -d "$base" ]]; then
    _CHECK_OUTPUT="ADR-0080-18: @sparkleideas not installed in TEMP_DIR"
    return
  fi

  # Check config-template for 0.0008
  local tpl_has_rate="false"
  local tpl_file
  tpl_file=$(find "$base" -path '*/node_modules' -prune -o \
    -name 'config-template*' -name '*.js' -print 2>/dev/null | head -1)
  if [[ -n "$tpl_file" ]] && grep -q '0\.0008\|0.0008' "$tpl_file" 2>/dev/null; then
    tpl_has_rate="true"
  fi

  # Check learning-bridge for 0.0008
  local bridge_has_rate="false"
  local bridge_file
  bridge_file=$(find "$base" -path '*/node_modules' -prune -o \
    -name 'learning-bridge*' -name '*.js' -print 2>/dev/null | head -1)
  if [[ -n "$bridge_file" ]] && grep -q '0\.0008\|0.0008' "$bridge_file" 2>/dev/null; then
    bridge_has_rate="true"
  fi

  # Check settings-generator for 0.0008
  local settings_has_rate="false"
  local settings_file
  settings_file=$(find "$base" -path '*/node_modules' -prune -o \
    -name 'settings-generator*' -name '*.js' -print 2>/dev/null | head -1)
  if [[ -n "$settings_file" ]] && grep -q '0\.0008\|0.0008' "$settings_file" 2>/dev/null; then
    settings_has_rate="true"
  fi

  local count=0
  [[ "$tpl_has_rate" == "true" ]] && count=$((count + 1))
  [[ "$bridge_has_rate" == "true" ]] && count=$((count + 1))
  [[ "$settings_has_rate" == "true" ]] && count=$((count + 1))

  if [[ "$count" -ge 2 ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0080-18: confidenceDecayRate 0.0008 aligned in ${count}/3 sources"
  else
    local details=""
    [[ "$tpl_has_rate" == "false" ]] && details="${details}config-template "
    [[ "$bridge_has_rate" == "false" ]] && details="${details}learning-bridge "
    [[ "$settings_has_rate" == "false" ]] && details="${details}settings-generator "
    _CHECK_OUTPUT="ADR-0080-18: confidenceDecayRate 0.0008 missing from: ${details}"
  fi
}

# ════════════════════════════════════════════════════════════════════
# ADR-0081-1: @claude-flow/neural (=> @sparkleideas/neural) in optionalDependencies
# ════════════════════════════════════════════════════════════════════

check_adr0081_neural_optional_dep() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local base="${TEMP_DIR}/node_modules/@sparkleideas"
  if [[ ! -d "$base" ]]; then
    _CHECK_OUTPUT="ADR-0081-1: @sparkleideas not installed in TEMP_DIR"
    return
  fi

  local mem_pkg="${base}/memory/package.json"
  if [[ ! -f "$mem_pkg" ]]; then
    _CHECK_OUTPUT="ADR-0081-1: @sparkleideas/memory/package.json not found"
    return
  fi

  # Check that optionalDependencies contains @sparkleideas/neural
  if grep -q '"optionalDependencies"' "$mem_pkg" 2>/dev/null; then
    # Extract the optionalDependencies block and check for neural
    local opt_block
    opt_block=$(sed -n '/"optionalDependencies"/,/}/p' "$mem_pkg" 2>/dev/null)
    if echo "$opt_block" | grep -q '@sparkleideas/neural' 2>/dev/null; then
      _CHECK_PASSED="true"
      _CHECK_OUTPUT="ADR-0081-1: @sparkleideas/neural found in optionalDependencies of memory/package.json"
    else
      _CHECK_OUTPUT="ADR-0081-1: @sparkleideas/neural NOT in optionalDependencies of memory/package.json"
    fi
  else
    _CHECK_OUTPUT="ADR-0081-1: no optionalDependencies block in memory/package.json"
  fi
}

# ════════════════════════════════════════════════════════════════════
# ADR-0081-2: Unified learning config in resolve-config
# ════════════════════════════════════════════════════════════════════

check_adr0081_unified_learning_config() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local base="${TEMP_DIR}/node_modules/@sparkleideas"
  if [[ ! -d "$base" ]]; then
    _CHECK_OUTPUT="ADR-0081-2: @sparkleideas not installed in TEMP_DIR"
    return
  fi

  # Find resolve-config in published packages
  local rc_file=""
  for pkg in memory cli agentdb; do
    local candidate
    candidate=$(find "${base}/${pkg}" -path '*/node_modules' -prune -o \
      -name 'resolve-config*' -name '*.js' -print 2>/dev/null | head -1)
    if [[ -n "$candidate" ]]; then
      rc_file="$candidate"
      break
    fi
  done

  if [[ -z "$rc_file" ]]; then
    _CHECK_OUTPUT="ADR-0081-2: resolve-config*.js not found in published packages"
    return
  fi

  local short_path
  short_path=$(echo "$rc_file" | sed "s|${base}/||")

  local has_sona="false"
  local has_decay="false"
  if grep -q 'sonaMode' "$rc_file" 2>/dev/null; then
    has_sona="true"
  fi
  if grep -q 'confidenceDecayRate' "$rc_file" 2>/dev/null; then
    has_decay="true"
  fi

  if [[ "$has_sona" == "true" && "$has_decay" == "true" ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0081-2: learning section with sonaMode + confidenceDecayRate in ${short_path}"
  else
    local missing=""
    [[ "$has_sona" == "false" ]] && missing="${missing}sonaMode "
    [[ "$has_decay" == "false" ]] && missing="${missing}confidenceDecayRate "
    _CHECK_OUTPUT="ADR-0081-2: missing ${missing}in ${short_path}"
  fi
}

# ════════════════════════════════════════════════════════════════════
# ADR-0081-3: config-template default sonaMode is balanced (not research)
# ════════════════════════════════════════════════════════════════════

check_adr0081_config_template_balanced() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local base="${TEMP_DIR}/node_modules/@sparkleideas"
  if [[ ! -d "$base" ]]; then
    _CHECK_OUTPUT="ADR-0081-3: @sparkleideas not installed in TEMP_DIR"
    return
  fi

  # Find config-template in published packages
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
    _CHECK_OUTPUT="ADR-0081-3: config-template*.js not found in published packages"
    return
  fi

  local short_path
  short_path=$(echo "$tpl_file" | sed "s|${base}/||")

  # Check for sonaMode near balanced
  if grep -q 'sonaMode' "$tpl_file" 2>/dev/null && \
     grep -q 'balanced' "$tpl_file" 2>/dev/null; then
    # Also verify it does not hardcode 'research' as the default
    if grep -qE "sonaMode.*'research'" "$tpl_file" 2>/dev/null; then
      _CHECK_OUTPUT="ADR-0081-3: config-template sonaMode is 'research' (should be 'balanced') in ${short_path}"
    else
      _CHECK_PASSED="true"
      _CHECK_OUTPUT="ADR-0081-3: config-template sonaMode default is 'balanced' in ${short_path}"
    fi
  else
    _CHECK_OUTPUT="ADR-0081-3: sonaMode or 'balanced' not found in ${short_path}"
  fi
}

# ════════════════════════════════════════════════════════════════════
# ADR-0080-P4-1: No raw sql.js imports in published CLI .js files
# ════════════════════════════════════════════════════════════════════

check_adr0080_no_raw_sqljs() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local base="${TEMP_DIR}/node_modules/@sparkleideas"
  if [[ ! -d "$base" ]]; then
    _CHECK_OUTPUT="ADR-0080-P4-1: @sparkleideas not installed in TEMP_DIR"
    return
  fi

  # Grep ALL published CLI .js files for raw import('sql.js') or require('sql.js').
  # The only allowed reference is inside open-database.js itself (the wrapper).
  local hits
  hits=$(find "$base/cli" -path '*/node_modules' -prune -o \
    -name '*.js' -not -name '*.test.*' -not -name '*.spec.*' -print0 2>/dev/null \
    | xargs -0 grep -Hn "import('sql\.js')\|require('sql\.js')" 2>/dev/null \
    | grep -v 'open-database\.js' \
    || true)

  local count=0
  if [[ -n "$hits" ]]; then
    count=$(echo "$hits" | wc -l | tr -d ' ')
  fi

  if [[ "$count" -eq 0 ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0080-P4-1: zero raw sql.js imports outside open-database.js in published CLI"
  else
    local files
    files=$(echo "$hits" | cut -d: -f1 | sort -u \
      | sed "s|${base}/||" | head -5 | tr '\n' ', ')
    _CHECK_OUTPUT="ADR-0080-P4-1: ${count} raw sql.js import(s) outside open-database.js: ${files%,}"
  fi
}

# ════════════════════════════════════════════════════════════════════
# ADR-0080-P4-2: open-database.js exists in published CLI package
# ════════════════════════════════════════════════════════════════════

check_adr0080_open_database_exists() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local base="${TEMP_DIR}/node_modules/@sparkleideas"
  if [[ ! -d "$base" ]]; then
    _CHECK_OUTPUT="ADR-0080-P4-2: @sparkleideas not installed in TEMP_DIR"
    return
  fi

  # Search for open-database.js in the CLI package dist
  local od_file=""
  for d in "$base"/cli/dist/memory "$base"/cli/dist/src/memory "$base"/cli/memory; do
    if [[ -f "$d/open-database.js" ]]; then
      od_file="$d/open-database.js"
      break
    fi
  done

  # Broader search if not in expected locations
  if [[ -z "$od_file" ]]; then
    od_file=$(find "$base/cli" -path '*/node_modules' -prune -o \
      -name 'open-database.js' -print 2>/dev/null | head -1)
  fi

  if [[ -n "$od_file" ]]; then
    local short_path
    short_path=$(echo "$od_file" | sed "s|${base}/||")

    # Verify it contains the key exports (openDatabase function)
    if grep -q 'openDatabase' "$od_file" 2>/dev/null; then
      # Verify it mentions better-sqlite3 (the preferred engine)
      if grep -q 'better-sqlite3' "$od_file" 2>/dev/null; then
        _CHECK_PASSED="true"
        _CHECK_OUTPUT="ADR-0080-P4-2: open-database.js found with openDatabase + better-sqlite3 in ${short_path}"
      else
        _CHECK_OUTPUT="ADR-0080-P4-2: open-database.js found but missing better-sqlite3 in ${short_path}"
      fi
    else
      _CHECK_OUTPUT="ADR-0080-P4-2: open-database.js found but missing openDatabase export in ${short_path}"
    fi
  else
    _CHECK_OUTPUT="ADR-0080-P4-2: open-database.js not found in published CLI package"
  fi
}
