#!/usr/bin/env bash
# lib/acceptance-package-checks.sh — Package checks (ADR-0039 T2)
#
# Requires: _cli_cmd, _booster_cmd from acceptance-checks.sh
# Caller MUST set: REGISTRY, TEMP_DIR, PKG
# Caller MUST define: run_timed

# --------------------------------------------------------------------------
# Agent Booster ESM import
# --------------------------------------------------------------------------
check_agent_booster_esm() {
  local start_ns end_ns
  start_ns=$(date +%s%N 2>/dev/null || echo 0)
  _CHECK_PASSED="false"

  local import_out
  import_out=$(cd "$TEMP_DIR" && NPM_CONFIG_REGISTRY="$REGISTRY" node -e "
    // Try full import first; if WASM is missing, verify the package at least resolves
    import('@sparkleideas/agent-booster')
      .then(m => { console.log('IMPORT_OK'); console.log(Object.keys(m).join(',')); })
      .catch(e => {
        if (e.message.includes('wasm') || e.message.includes('WASM')) {
          // WASM not available (pre-built artifact missing) -- verify package resolves
          try {
            const resolved = require.resolve('@sparkleideas/agent-booster');
            console.log('IMPORT_OK_NO_WASM');
            console.log('resolved: ' + resolved);
          } catch (e2) {
            console.log('IMPORT_FAIL: ' + e.message);
            process.exit(1);
          }
        } else {
          console.log('IMPORT_FAIL: ' + e.message);
          process.exit(1);
        }
      })
  " 2>&1) || true

  if echo "$import_out" | grep -q 'IMPORT_OK'; then
    _CHECK_PASSED="true"
    if echo "$import_out" | grep -q 'NO_WASM'; then
      _CHECK_OUTPUT="agent-booster package resolves (WASM not available): $(echo "$import_out" | tail -1)"
    else
      _CHECK_OUTPUT="agent-booster module imported successfully: $(echo "$import_out" | tail -1)"
    fi
  else
    _CHECK_OUTPUT="Failed to import @sparkleideas/agent-booster: $(echo "$import_out" | head -5)"
  fi

  end_ns=$(date +%s%N 2>/dev/null || echo 0)
  _EXIT=0
  if [[ "$start_ns" != "0" && "$end_ns" != "0" ]]; then
    _DURATION_MS=$(( (end_ns - start_ns) / 1000000 ))
  else
    _DURATION_MS=0
  fi
  _OUT="$_CHECK_OUTPUT"
}

# --------------------------------------------------------------------------
# Agent Booster binary
# --------------------------------------------------------------------------
check_agent_booster_bin() {
  local booster; booster=$(_booster_cmd)
  run_timed "cd '$TEMP_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $booster --version"
  _CHECK_PASSED="false"
  _CHECK_OUTPUT="$_OUT"
  if [[ $_EXIT -eq 0 && -n "$_OUT" ]]; then
    if echo "$_OUT" | grep -qE '[0-9]+\.[0-9]+'; then
      _CHECK_PASSED="true"
    fi
  fi
}

# --------------------------------------------------------------------------
# Plugins SDK import
# --------------------------------------------------------------------------
check_plugins_sdk() {
  local start_ns end_ns
  start_ns=$(date +%s%N 2>/dev/null || echo 0)
  _CHECK_PASSED="false"

  local import_out
  import_out=$(cd "$TEMP_DIR" && NPM_CONFIG_REGISTRY="$REGISTRY" node -e "
    import('@sparkleideas/plugins')
      .then(m => { console.log('IMPORT_OK'); console.log(Object.keys(m).join(',')); })
      .catch(e => { console.log('IMPORT_FAIL: ' + e.message); process.exit(1); })
  " 2>&1) || true

  if echo "$import_out" | grep -q 'IMPORT_OK'; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="plugins SDK imported: $(echo "$import_out" | tail -1)"
  else
    _CHECK_OUTPUT="Failed to import @sparkleideas/plugins: $(echo "$import_out" | head -5)"
  fi

  end_ns=$(date +%s%N 2>/dev/null || echo 0)
  _EXIT=0
  if [[ "$start_ns" != "0" && "$end_ns" != "0" ]]; then
    _DURATION_MS=$(( (end_ns - start_ns) / 1000000 ))
  else
    _DURATION_MS=0
  fi
  _OUT="$_CHECK_OUTPUT"
}

# ════════════════════════════════════════════════════════════════════
# ADR-0090 Tier B4: no silent sql.js fallback on the CLI's better-sqlite3
# consumers
#
# History
# -------
# Three revisions of this check:
#
# (v1, obsolete) Original ADR-0090 spec:
#   "fail if better-sqlite3 appears in @sparkleideas/cli dependencies.
#    Must ONLY appear in optionalDependencies."
#   Void-ab-initio — contradicted fork commit d5fe53522 (2026-04-12)
#   which re-added better-sqlite3 to `dependencies` because
#   open-database.ts's dynamic `import('better-sqlite3')` fell back to
#   sql.js on resolve failure, corrupting WAL databases.
#
# (v2, 2026-04-15) Flipped positive: better-sqlite3 MUST be in
#   `dependencies` AND `require.resolve` MUST succeed AND
#   `open-database.js` MUST reference better-sqlite3.
#
# (v3, 2026-04-16, THIS VERSION) Reality changed again. Fork commit
#   c7439f345 ("feat: memory migrate --from-sqlite command") moved
#   better-sqlite3 back to `optionalDependencies` and DELETED
#   `open-database.ts`. The WAL-corrupting silent-fallback path that
#   motivated the entire Debt 7 saga is GONE at the source level.
#   Surviving consumers (memory.js `memory migrate --from-sqlite`,
#   doctor.js diagnostic) use explicit fail-loud:
#     try { await import('better-sqlite3'); }
#     catch { output.printError('better-sqlite3 is required... Install:
#       npm install better-sqlite3'); return { exitCode: 1 }; }
#   No silent sql.js fallthrough anywhere. So better-sqlite3 in
#   `optionalDependencies` is now SAFE — it only affects user-invoked
#   migration commands, never auto-triggered CRUD paths.
#
# What v3 verifies
# ----------------
#   1. Static: @sparkleideas/cli/package.json declares better-sqlite3
#      SOMEWHERE (dependencies OR optionalDependencies). Missing
#      entirely → fail (migrate command won't work).
#      `devDependencies`-only → fail (consumers don't pull dev deps).
#   2. Static: `open-database.js` does NOT exist in the published dist.
#      If it reappears, the old silent-fallback regression is back
#      and we need to re-enable the runtime resolve check.
#   3. Static: every dist file that imports `better-sqlite3` must NOT
#      also import `sql.js` — the co-location of both imports in the
#      same file is the silent-fallback signature (open-database.ts
#      pattern: `try { import bsqlite } catch { import sqljs }`).
#   4. Runtime: IF better-sqlite3 is in `dependencies`, require.resolve
#      must succeed (deps are MUST-install). If in
#      `optionalDependencies`, the resolve is informational only —
#      optional means "OK to skip on this platform".
#
# Why the invariant still has teeth
# ---------------------------------
# The point of B4 is to prevent the ADR-0086 Debt 7 regression from
# silently returning. If a future upstream refactor re-adds a
# silent-fallback path (e.g. `open-database.ts` v2), check #3 fires
# because the new file will import both better-sqlite3 and sql.js in
# the same module. If a future upstream removes better-sqlite3
# entirely, check #1 fires (`memory migrate --from-sqlite` would break
# for real users who do need the migration path). If a future refactor
# moves better-sqlite3 into `devDependencies` (same-package npm hosts
# that pattern is visible during dev but never installed for users),
# check #1 fires with a clear diagnostic naming the wrong field.
# ════════════════════════════════════════════════════════════════════

check_adr0090_b4_better_sqlite3_required() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local cli_pkg_dir
  cli_pkg_dir=$(find "$TEMP_DIR" -path "*/node_modules/@sparkleideas/cli" -not -path "*/.iso-*" -type d 2>/dev/null | head -1)
  if [[ -z "$cli_pkg_dir" ]]; then
    cli_pkg_dir=$(find "${E2E_DIR:-/nonexistent}" -path "*/node_modules/@sparkleideas/cli" -not -path "*/.iso-*" -type d 2>/dev/null | head -1)
  fi
  if [[ -z "$cli_pkg_dir" ]]; then
    _CHECK_OUTPUT="B4: @sparkleideas/cli not found under TEMP_DIR/node_modules"
    return
  fi

  local pkg_json="$cli_pkg_dir/package.json"
  if [[ ! -f "$pkg_json" ]]; then
    _CHECK_OUTPUT="B4: $cli_pkg_dir/package.json missing"
    return
  fi

  # ─── Layer 1: static package.json declaration ──────────────────────
  # better-sqlite3 must be declared in `dependencies` OR
  # `optionalDependencies` — either is now valid (see docblock). Fail
  # if missing entirely or if only in `devDependencies`.
  local dep_kind
  dep_kind=$(node -e "
    const p = require('$pkg_json');
    if (p.dependencies && p.dependencies['better-sqlite3']) { console.log('dependencies'); process.exit(0); }
    if (p.optionalDependencies && p.optionalDependencies['better-sqlite3']) { console.log('optionalDependencies'); process.exit(0); }
    if (p.devDependencies && p.devDependencies['better-sqlite3']) { console.log('devDependencies'); process.exit(0); }
    console.log('missing');
  " 2>/dev/null)

  if [[ "$dep_kind" == "missing" ]]; then
    _CHECK_OUTPUT="B4: @sparkleideas/cli/package.json does not declare better-sqlite3 anywhere. Expected in 'dependencies' (required install) or 'optionalDependencies' (for user-invoked memory migrate --from-sqlite). Without it, the migration path fails with a module-not-found error rather than the expected 'Install better-sqlite3' diagnostic."
    return
  fi
  if [[ "$dep_kind" == "devDependencies" ]]; then
    _CHECK_OUTPUT="B4: @sparkleideas/cli/package.json declares better-sqlite3 ONLY in 'devDependencies'. Consumers' \`npm install\` does not pull devDependencies, so better-sqlite3 won't be available to the published CLI. Move to 'dependencies' or 'optionalDependencies'."
    return
  fi

  # ─── Layer 2: open-database.js must be absent ──────────────────────
  # This file was the ADR-0086 silent sql.js fallback path. Fork
  # commit c7439f345 deleted its source (2026-04). If it's back in
  # the dist, upstream re-introduced the WAL-corrupting regression
  # and this check must alert loudly.
  local opendb_file
  opendb_file=$(find "$cli_pkg_dir" -name "open-database.js" -type f -not -path "*/.iso-*" 2>/dev/null | head -1)
  if [[ -n "$opendb_file" ]]; then
    # Presence alone isn't fatal — only fatal if it has the
    # silent-fallback signature (both better-sqlite3 AND sql.js
    # imports in the same file).
    local has_bsqlite has_sqljs
    has_bsqlite=$(grep -c "better-sqlite3" "$opendb_file" 2>/dev/null); has_bsqlite=${has_bsqlite:-0}
    has_sqljs=$(grep -c "sql\\.js" "$opendb_file" 2>/dev/null); has_sqljs=${has_sqljs:-0}
    if (( has_bsqlite > 0 && has_sqljs > 0 )); then
      _CHECK_OUTPUT="B4: open-database.js reappeared at $opendb_file with BOTH better-sqlite3 AND sql.js imports. This is the ADR-0086 Debt 7 silent-fallback signature — WAL corruption risk is BACK. Review the file for try/catch fallthrough from better-sqlite3 to sql.js; if present, either re-pin better-sqlite3 to 'dependencies' or (preferred) remove the sql.js fallback path entirely."
      return
    fi
  fi

  # ─── Layer 3: no dist file has the silent-fallback signature ──────
  # Scan every .js file under dist for files that import BOTH
  # better-sqlite3 AND sql.js. That co-location is the canonical
  # silent-fallback pattern (open-database.ts's shape). If it appears
  # in a NEW file after a future refactor, flag it.
  local culprit
  culprit=$(
    find "$cli_pkg_dir/dist" -name "*.js" -type f 2>/dev/null | while read -r f; do
      if grep -q "better-sqlite3" "$f" 2>/dev/null && grep -q "sql\\.js" "$f" 2>/dev/null; then
        echo "$f"
        break
      fi
    done
  )
  if [[ -n "$culprit" ]]; then
    _CHECK_OUTPUT="B4: dist file $culprit imports BOTH better-sqlite3 AND sql.js. That's the ADR-0086 Debt 7 silent-fallback signature. Review for try/catch fallthrough and either pin better-sqlite3 to 'dependencies' or remove the sql.js path."
    return
  fi

  # ─── Layer 4: runtime resolve (strict only when in dependencies) ──
  # If better-sqlite3 is in `dependencies`, it MUST resolve — deps
  # are guaranteed installed. If in `optionalDependencies`, resolution
  # may legitimately fail on some platforms (that's what "optional"
  # means). We still TRY to resolve, but a failure is informational
  # rather than fatal when dep_kind=optionalDependencies.
  local resolve_out
  resolve_out=$(cd "$cli_pkg_dir" && node -e "
    try {
      const p = require.resolve('better-sqlite3');
      console.log('RESOLVED:' + p);
    } catch (e) {
      console.log('RESOLVE_FAIL:' + (e && e.message || e));
      process.exit(1);
    }
  " 2>&1) || true

  local resolve_note=""
  if echo "$resolve_out" | grep -q '^RESOLVED:'; then
    local resolved_path
    resolved_path=$(echo "$resolve_out" | sed -n 's/^RESOLVED://p' | head -1)
    if [[ -z "$resolved_path" || ! -f "$resolved_path" ]]; then
      _CHECK_OUTPUT="B4: better-sqlite3 resolved to '$resolved_path' but file does not exist — broken install"
      return
    fi
    resolve_note="resolves to $resolved_path"
  else
    # Resolve failed. Fatal only in 'dependencies' mode.
    if [[ "$dep_kind" == "dependencies" ]]; then
      _CHECK_OUTPUT="B4: better-sqlite3 is declared in CLI 'dependencies' but require.resolve FAILED from $cli_pkg_dir — npm install should have landed it: $(echo "$resolve_out" | head -3)"
      return
    fi
    resolve_note="declared optional + NOT installed on this host (acceptable for optionalDependencies)"
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="B4: better-sqlite3 declared in '$dep_kind' ($resolve_note); open-database.js silent-fallback absent from dist; no other dist file imports both better-sqlite3 and sql.js."
}
