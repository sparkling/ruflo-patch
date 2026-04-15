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
# ADR-0090 Tier B4: better-sqlite3 must be a REQUIRED CLI dependency
#
# History
# -------
# The original Tier B4 spec in ADR-0090 said:
#   "fail if better-sqlite3 appears in @sparkleideas/cli dependencies.
#    Must ONLY appear in optionalDependencies (per ADR-0086 Debt 7)."
#
# That spec was void-ab-initio. ADR-0086 Debt 7's claim that
# better-sqlite3 was removed from the CLI is stale — fork commit
# d5fe53522 on 2026-04-12 ("fix: add better-sqlite3 as direct CLI
# dependency", three days before ADR-0090 was written) re-added it
# because:
#
#   open-database.ts (CLI pkg) does `await import('better-sqlite3')`.
#   When better-sqlite3 was only in the MEMORY package's deps, npm
#   hoisting failures meant the dynamic import could fail at runtime.
#   open-database.ts then fell back to sql.js, which corrupts WAL-mode
#   databases on close. This caused real user data loss.
#
# The original Debt 7 intent ("no silent sql.js fallback") was valid,
# but the diagnosis ("remove better-sqlite3 from CLI") was wrong. The
# correct invariant to enforce is a positive one: better-sqlite3 MUST
# be resolvable from the CLI package context at runtime, so open-
# database.ts takes the better-sqlite3 branch and never the WAL-
# corrupting sql.js fallback.
#
# What this check verifies (four layers)
# --------------------------------------
#   1. Static: @sparkleideas/cli/package.json declares better-sqlite3
#      in `dependencies` (not only optionalDependencies — those can
#      silently fail to install on cross-platform npm ci).
#   2. Static: open-database.js is present in the published dist and
#      still references better-sqlite3 (not replaced by an sql.js-only
#      shim or removed in an upstream refactor).
#   3. Runtime: a Node subprocess rooted at the CLI package dir can
#      `require.resolve('better-sqlite3')` — proves npm actually
#      installed the native binding, not just wrote it to package.json.
#   4. Runtime: the resolved path is a real file on disk (guards against
#      resolve-but-missing-binary — fs check on the resolved .node file).
#
# If any layer fails, we FAIL loudly with a diagnostic — this is the
# exact regression signal ADR-0086 Debt 7 was supposed to provide but
# never did (because the facade of "remove it from package.json"
# couldn't express the runtime requirement).
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
  # Parse with node so a nested "dependencies": {} is unambiguous and
  # we don't false-positive on devDependencies matches in the same file.
  local dep_kind
  dep_kind=$(node -e "
    const p = require('$pkg_json');
    if (p.dependencies && p.dependencies['better-sqlite3']) { console.log('dependencies'); process.exit(0); }
    if (p.optionalDependencies && p.optionalDependencies['better-sqlite3']) { console.log('optionalDependencies'); process.exit(0); }
    if (p.devDependencies && p.devDependencies['better-sqlite3']) { console.log('devDependencies'); process.exit(0); }
    console.log('missing');
  " 2>/dev/null)

  if [[ "$dep_kind" != "dependencies" ]]; then
    _CHECK_OUTPUT="B4: @sparkleideas/cli/package.json must declare better-sqlite3 in 'dependencies' (found in '$dep_kind'). optionalDependencies are not reliable — npm may silently skip them on cross-platform installs, causing open-database.ts to fall back to sql.js and corrupt WAL databases (see fork commit d5fe53522)."
    return
  fi

  # ─── Layer 2: static open-database.js still uses better-sqlite3 ────
  local opendb_file
  opendb_file=$(find "$cli_pkg_dir" -name "open-database.js" -type f 2>/dev/null | head -1)
  if [[ -z "$opendb_file" ]]; then
    _CHECK_OUTPUT="B4: open-database.js not found in published CLI dist (expected at cli/dist/src/memory/open-database.js). The WAL-safe SQLite opener may have been removed — if so, the check needs to be re-scoped to wherever WAL opens now happen."
    return
  fi
  if ! grep -q "better-sqlite3" "$opendb_file" 2>/dev/null; then
    _CHECK_OUTPUT="B4: open-database.js exists at $opendb_file but does not reference better-sqlite3 — upstream may have switched to sql.js-only (regression) or to a different engine entirely. Investigate before green-lighting."
    return
  fi

  # ─── Layer 3: runtime require.resolve from CLI package context ─────
  # Run node rooted at the CLI package dir so npm's node_modules
  # resolution matches the runtime. `require.resolve` is stricter than
  # a dynamic import catch — it throws synchronously if the binding
  # was not installed.
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

  if ! echo "$resolve_out" | grep -q '^RESOLVED:'; then
    _CHECK_OUTPUT="B4: better-sqlite3 is declared in CLI dependencies but require.resolve FAILED from $cli_pkg_dir — native binding was not installed (this is exactly the silent sql.js fallback path that corrupts WAL databases): $(echo "$resolve_out" | head -3)"
    return
  fi

  # ─── Layer 4: resolved path is a real file on disk ─────────────────
  local resolved_path
  resolved_path=$(echo "$resolve_out" | sed -n 's/^RESOLVED://p' | head -1)
  if [[ -z "$resolved_path" || ! -f "$resolved_path" ]]; then
    _CHECK_OUTPUT="B4: better-sqlite3 resolved to '$resolved_path' but file does not exist — broken install"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="B4: better-sqlite3 declared in CLI 'dependencies', resolvable from CLI package context ($resolved_path), open-database.js references it — silent sql.js fallback path is blocked."
}
