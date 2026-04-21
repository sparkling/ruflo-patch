#!/usr/bin/env bash
# lib/acceptance-phase13-migration.sh — ADR-0094 Phase 13: Migration backstop
#
# Verifies that a fixture captured under an older schema still reads
# correctly under the current code. This is the regression signal when a
# -patch.N bump silently drifts a storage format.
#
# ─── Scope ───────────────────────────────────────────────────────────
# Phase 13   (checks 1-6):  hand-crafted text fixtures exercising the
#            JSON/text surfaces the CLI reads directly (config.json,
#            sessions/*.json).
# Phase 13.1 (checks 7-8):  REAL binary RVF fixtures captured from a live
#            @sparkleideas/cli round-trip via
#            `scripts/seed-phase13-1-fixtures.sh`.
# Phase 13.2 (checks 9-10): REAL AgentDB SQLite fixture (.swarm/memory.db
#            seeded with skills + reflexion rows) captured via
#            `scripts/seed-phase13-2-fixtures.sh`. Closes the gap left by
#            13.1, whose captured memory.db was empty-schema only.
#
# Fixtures live under `tests/fixtures/adr0094-phase13/` (Phase 13 text),
# `tests/fixtures/adr0094-phase13-1/` (Phase 13.1 RVF binary), and
# `tests/fixtures/adr0094-phase13-2/` (Phase 13.2 AgentDB SQLite).
#
# Check matrix (10 checks):
#   #  id                                              fixture              tool             expected body
#   1. migration_config_v1_read                        v1-config            config_get       "rvf"
#   2. migration_config_v1_telemetry                   v1-config            config_get       "false"
#   3. migration_store_v1_session_list                 v1-store             session_list     "p13-fixture-session|p13"
#   4. migration_forward_compat_unknown_key            v1-forward-compat    config_get       "rvf" (MUST NOT panic on unknownFutureKey)
#   5. migration_backward_compat_missing_optional      v1-backward-compat   config_get       "rvf" (MUST NOT panic on missing telemetry)
#   6. migration_no_schema_panic                       all 4 fixtures       config_get       body NEVER matches schema-panic regex
#   7. migration_rvf_v1_retrieve                       v1-rvf               memory_retrieve  "migration-works-v1"
#   8. migration_rvf_v1_search                         v1-rvf               memory_search    "p13rvf-sentinel|migration-works-v1"
#   9. migration_agentdb_v1_skill_search               v1-agentdb           agentdb_skill_search       "p13-2-skill|p13-2 migration sentinel"
#  10. migration_agentdb_v1_reflexion_retrieve         v1-agentdb           agentdb_reflexion_retrieve "migration-survived|p13-2 reflexion sentinel"
#
# PASS           : body matches expected regex AND does NOT contain the
#                  schema-panic regex (unsupported|incompatible|
#                  upgrade.*required|schema.*mismatch).
# FAIL           : schema panic detected, expected-regex miss, or empty body.
# SKIP_ACCEPTED  : tool-not-found preserved from `_mcp_invoke_tool`.
#
# Requires: acceptance-harness.sh (_mcp_invoke_tool, _with_iso_cleanup).
# Caller MUST set: E2E_DIR, TEMP_DIR, REGISTRY, PKG, PROJECT_DIR.

# ════════════════════════════════════════════════════════════════════
# Shared helpers
# ════════════════════════════════════════════════════════════════════

# Schema-panic regex — if ANY of these fire in a response body, the current
# code rejected the fixture as unreadable. That's the regression P13 exists
# to catch.
_P13_PANIC_REGEX='unsupported|incompatible|upgrade.*required|schema.*mismatch'

# _p13_fixtures_dir — resolve the fixtures root. Mirrors the PROJECT_DIR
# fallback pattern used by acceptance-catalog-checks.sh so the lib is
# usable both from `scripts/test-acceptance.sh` and from ad-hoc sourcing.
_p13_fixtures_dir() {
  local root="${PROJECT_DIR:-}"
  if [[ -z "$root" ]]; then
    # Fallback: assume this lib sits in <root>/lib/.
    root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  fi
  printf '%s' "${root}/tests/fixtures/adr0094-phase13"
}

# Phase 13.1 fixtures live in a sibling dir. Kept distinct from Phase 13
# so the Phase 13 text-fixture set stays immutable — see README in each.
_p13_1_fixtures_dir() {
  local root="${PROJECT_DIR:-}"
  if [[ -z "$root" ]]; then
    root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  fi
  printf '%s' "${root}/tests/fixtures/adr0094-phase13-1"
}

# Phase 13.2 fixtures (AgentDB SQLite memory.db with real rows). Separate
# root so 13.1 (RVF) and 13.2 (SQLite) are regenerable independently.
_p13_2_fixtures_dir() {
  local root="${PROJECT_DIR:-}"
  if [[ -z "$root" ]]; then
    root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  fi
  printf '%s' "${root}/tests/fixtures/adr0094-phase13-2"
}

# _p13_load_fixture <fixture_name> <target_dir> [fixtures_root]
#
# Copies the named fixture into <target_dir>, preserving the `.claude-flow/`
# and `.swarm/` subpaths. Overwrites any pre-existing files the iso-cleanup
# may have seeded from E2E_DIR. Returns non-zero on failure so the calling
# check can fail loudly.
#
# Optional $3: fixtures root dir. Defaults to `_p13_fixtures_dir` (Phase 13
# text fixtures). Pass `_p13_1_fixtures_dir` output for Phase 13.1 RVF.
_p13_load_fixture() {
  local fixture_name="$1"
  local target_dir="$2"
  local fixtures_root="${3:-$(_p13_fixtures_dir)}"
  if [[ -z "$fixture_name" || -z "$target_dir" ]]; then
    echo "p13_load_fixture: missing args (fixture=$fixture_name target=$target_dir)" >&2
    return 2
  fi

  local src; src="${fixtures_root}/${fixture_name}"
  if [[ ! -d "$src" ]]; then
    echo "p13_load_fixture: fixture dir not found: $src" >&2
    return 3
  fi
  if [[ ! -d "$target_dir" ]]; then
    echo "p13_load_fixture: target dir not found: $target_dir" >&2
    return 4
  fi

  # Use `cp -R` with the fixture's own `.claude-flow/` and `.swarm/` trees.
  # We overwrite rather than skip — the fixture is the source of truth for
  # the surfaces it ships.
  local sub had=0
  for sub in .claude-flow .swarm; do
    if [[ -d "${src}/${sub}" ]]; then
      # Ensure target subdir exists so `cp -R src/. dst/` merges cleanly.
      mkdir -p "${target_dir}/${sub}" || return 5
      # Copy the *contents* of the fixture subdir, not the dir itself, so
      # nested files overwrite matching iso-seeded files in place.
      cp -R "${src}/${sub}/." "${target_dir}/${sub}/" || return 6
      had=1
    fi
  done

  if (( had == 0 )); then
    echo "p13_load_fixture: fixture '$fixture_name' has neither .claude-flow nor .swarm" >&2
    return 7
  fi
  return 0
}

# _p13_expect_readable <label> <expected_regex>
#
# Post-condition evaluator. Reads _MCP_BODY + _MCP_EXIT + _CHECK_PASSED that
# `_mcp_invoke_tool` just populated, then overwrites _CHECK_PASSED /
# _CHECK_OUTPUT with the Phase 13 verdict:
#   - SKIP_ACCEPTED if tool-not-found was detected (preserved).
#   - FAIL loudly if the schema-panic regex fires (distinct message).
#   - FAIL if body is empty.
#   - FAIL if expected regex is not matched.
#   - PASS otherwise.
_p13_expect_readable() {
  local label="${1:-p13}"
  local expected_regex="${2:-}"

  # Preserve tool-not-found skip from _mcp_invoke_tool.
  if [[ "${_CHECK_PASSED:-}" == "skip_accepted" ]]; then
    _CHECK_OUTPUT="SKIP_ACCEPTED: ${label}: tool not in build"
    return
  fi

  local body="${_MCP_BODY:-}"
  local exit_code="${_MCP_EXIT:-0}"

  # Reset — we re-decide below.
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  # Panic canary first — a schema-mismatch message is the regression we
  # exist to catch, even if the expected regex also matches downstream text.
  if echo "$body" | grep -qiE "$_P13_PANIC_REGEX"; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="${label} FAIL: schema panic detected in body (pattern: ${_P13_PANIC_REGEX}). exit=${exit_code}. Body: $(echo "$body" | head -5 | tr '\n' ' ')"
    return
  fi

  # Empty body — FAIL (loud; tool may have segfaulted).
  if [[ -z "$body" ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="${label} FAIL: empty body (exit=${exit_code}) — fixture may have crashed the reader"
    return
  fi

  # Expected regex check.
  if [[ -z "$expected_regex" ]] || ! echo "$body" | grep -qiE "$expected_regex"; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="${label} FAIL: expected /${expected_regex}/i not found. exit=${exit_code}. Body: $(echo "$body" | head -5 | tr '\n' ' ')"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="${label} OK: body matches /${expected_regex}/i, no schema panic"
}

# ════════════════════════════════════════════════════════════════════
# 1. migration_config_v1_read
# ════════════════════════════════════════════════════════════════════
_p13_config_v1_read_body() {
  local iso="$1"; local _saved="${E2E_DIR:-}"; E2E_DIR="$iso"
  if ! _p13_load_fixture "v1-config" "$iso"; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="P13/config_v1_read FAIL: fixture load failed"
    E2E_DIR="$_saved"; return
  fi
  _mcp_invoke_tool "config_get" \
    '{"key":"memory.backend"}' \
    '.' "P13/config_v1_read" 20 --ro
  _p13_expect_readable "P13/config_v1_read" 'rvf'
  E2E_DIR="$_saved"
}
check_adr0094_p13_migration_config_v1_read() {
  # adr0097-l2-delegator: _CHECK_PASSED= is set inside _with_iso_cleanup / body fn
  _with_iso_cleanup "p13-mig-cfg-v1-read" _p13_config_v1_read_body
}

# ════════════════════════════════════════════════════════════════════
# 2. migration_config_v1_telemetry
# ════════════════════════════════════════════════════════════════════
_p13_config_v1_telemetry_body() {
  local iso="$1"; local _saved="${E2E_DIR:-}"; E2E_DIR="$iso"
  if ! _p13_load_fixture "v1-config" "$iso"; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="P13/config_v1_telemetry FAIL: fixture load failed"
    E2E_DIR="$_saved"; return
  fi
  _mcp_invoke_tool "config_get" \
    '{"key":"telemetry.enabled"}' \
    '.' "P13/config_v1_telemetry" 20 --ro
  _p13_expect_readable "P13/config_v1_telemetry" 'false'
  E2E_DIR="$_saved"
}
check_adr0094_p13_migration_config_v1_telemetry() {
  # adr0097-l2-delegator: _CHECK_PASSED= is set inside _with_iso_cleanup / body fn
  _with_iso_cleanup "p13-mig-cfg-v1-tele" _p13_config_v1_telemetry_body
}

# ════════════════════════════════════════════════════════════════════
# 3. migration_store_v1_session_list
# ════════════════════════════════════════════════════════════════════
_p13_store_v1_session_list_body() {
  local iso="$1"; local _saved="${E2E_DIR:-}"; E2E_DIR="$iso"
  if ! _p13_load_fixture "v1-store" "$iso"; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="P13/store_v1_session_list FAIL: fixture load failed"
    E2E_DIR="$_saved"; return
  fi
  _mcp_invoke_tool "session_list" \
    '{}' \
    '.' "P13/store_v1_session_list" 20 --ro
  _p13_expect_readable "P13/store_v1_session_list" 'p13-fixture-session|"p13"'
  E2E_DIR="$_saved"
}
check_adr0094_p13_migration_store_v1_session_list() {
  # adr0097-l2-delegator: _CHECK_PASSED= is set inside _with_iso_cleanup / body fn
  _with_iso_cleanup "p13-mig-store-v1-list" _p13_store_v1_session_list_body
}

# ════════════════════════════════════════════════════════════════════
# 4. migration_forward_compat_unknown_key
# ════════════════════════════════════════════════════════════════════
_p13_forward_compat_unknown_key_body() {
  local iso="$1"; local _saved="${E2E_DIR:-}"; E2E_DIR="$iso"
  if ! _p13_load_fixture "v1-forward-compat" "$iso"; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="P13/forward_compat FAIL: fixture load failed"
    E2E_DIR="$_saved"; return
  fi
  _mcp_invoke_tool "config_get" \
    '{"key":"memory.backend"}' \
    '.' "P13/forward_compat_unknown_key" 20 --ro
  # PASS means: reader tolerated the unknown root key AND still resolved
  # memory.backend. Panic canary inside _p13_expect_readable enforces the
  # "tolerate, don't reject" half.
  _p13_expect_readable "P13/forward_compat_unknown_key" 'rvf'
  E2E_DIR="$_saved"
}
check_adr0094_p13_migration_forward_compat_unknown_key() {
  # adr0097-l2-delegator: _CHECK_PASSED= is set inside _with_iso_cleanup / body fn
  _with_iso_cleanup "p13-mig-fwd-unknown" _p13_forward_compat_unknown_key_body
}

# ════════════════════════════════════════════════════════════════════
# 5. migration_backward_compat_missing_optional
# ════════════════════════════════════════════════════════════════════
_p13_backward_compat_missing_optional_body() {
  local iso="$1"; local _saved="${E2E_DIR:-}"; E2E_DIR="$iso"
  if ! _p13_load_fixture "v1-backward-compat" "$iso"; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="P13/backward_compat FAIL: fixture load failed"
    E2E_DIR="$_saved"; return
  fi
  _mcp_invoke_tool "config_get" \
    '{"key":"memory.backend"}' \
    '.' "P13/backward_compat_missing_optional" 20 --ro
  # PASS means: reader defaulted gracefully on the missing `telemetry` block
  # AND still resolved memory.backend. Panic canary enforces graceful default.
  _p13_expect_readable "P13/backward_compat_missing_optional" 'rvf'
  E2E_DIR="$_saved"
}
check_adr0094_p13_migration_backward_compat_missing_optional() {
  # adr0097-l2-delegator: _CHECK_PASSED= is set inside _with_iso_cleanup / body fn
  _with_iso_cleanup "p13-mig-bwd-missing" _p13_backward_compat_missing_optional_body
}

# ════════════════════════════════════════════════════════════════════
# 6. migration_no_schema_panic
#    Meta-check: cycles all 4 fixtures through config_get and asserts NONE
#    of them produces a schema-panic message. Distinct from checks 1-5:
#    those verify the happy-path value; this one isolates the panic canary
#    as a standalone signal so a failure message surfaces the fixture that
#    tripped it.
# ════════════════════════════════════════════════════════════════════
_p13_no_schema_panic_body() {
  local iso="$1"; local _saved="${E2E_DIR:-}"; E2E_DIR="$iso"
  local fixture panic_fixtures=() skip_count=0 total=0
  for fixture in v1-config v1-store v1-forward-compat v1-backward-compat; do
    total=$((total + 1))
    # Clean slate per fixture: wipe the iso subtrees the previous iteration
    # wrote so each fixture loads in isolation.
    rm -rf "$iso/.claude-flow" "$iso/.swarm" 2>/dev/null || true

    if ! _p13_load_fixture "$fixture" "$iso"; then
      _CHECK_PASSED="false"
      _CHECK_OUTPUT="P13/no_schema_panic FAIL: fixture load failed for '$fixture'"
      E2E_DIR="$_saved"; return
    fi

    _mcp_invoke_tool "config_get" \
      '{"key":"memory.backend"}' \
      '.' "P13/no_schema_panic/$fixture" 20 --ro

    if [[ "${_CHECK_PASSED:-}" == "skip_accepted" ]]; then
      skip_count=$((skip_count + 1))
      continue
    fi

    local body="${_MCP_BODY:-}"
    if echo "$body" | grep -qiE "$_P13_PANIC_REGEX"; then
      panic_fixtures+=("$fixture")
    fi
  done

  if (( ${#panic_fixtures[@]} > 0 )); then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="P13/no_schema_panic FAIL: schema panic detected in fixture(s): ${panic_fixtures[*]} (pattern: ${_P13_PANIC_REGEX})"
    E2E_DIR="$_saved"; return
  fi

  if (( skip_count == total )); then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: P13/no_schema_panic: config_get not in build (all $total fixtures skipped)"
    E2E_DIR="$_saved"; return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="P13/no_schema_panic OK: $((total - skip_count))/$total fixtures produced no schema-panic message"
  E2E_DIR="$_saved"
}
check_adr0094_p13_migration_no_schema_panic() {
  # adr0097-l2-delegator: _CHECK_PASSED= is set inside _with_iso_cleanup / body fn
  _with_iso_cleanup "p13-mig-no-panic" _p13_no_schema_panic_body
}

# ════════════════════════════════════════════════════════════════════
# Phase 13.1 — RVF binary fixture round-trips
#
# These checks consume REAL .swarm/memory.rvf binaries captured from a
# live @sparkleideas/cli memory_store via `scripts/seed-phase13-1-fixtures.sh`.
# The fixture's committed K/V pair is:
#   key=p13rvf-sentinel  value=migration-works-v1  namespace=p13rvf
# If the current build can no longer read the committed RVF, that's the
# binary-format regression Phase 13.1 exists to catch.
# ════════════════════════════════════════════════════════════════════

# 7. migration_rvf_v1_retrieve
_p13_rvf_v1_retrieve_body() {
  local iso="$1"; local _saved="${E2E_DIR:-}"; E2E_DIR="$iso"
  if ! _p13_load_fixture "v1-rvf" "$iso" "$(_p13_1_fixtures_dir)"; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="P13.1/rvf_v1_retrieve FAIL: fixture load failed"
    E2E_DIR="$_saved"; return
  fi
  _mcp_invoke_tool "memory_retrieve" \
    '{"key":"p13rvf-sentinel","namespace":"p13rvf"}' \
    '.' "P13.1/rvf_v1_retrieve" 30 --ro
  _p13_expect_readable "P13.1/rvf_v1_retrieve" 'migration-works-v1'
  E2E_DIR="$_saved"
}
check_adr0094_p13_migration_rvf_v1_retrieve() {
  # adr0097-l2-delegator: _CHECK_PASSED= is set inside _with_iso_cleanup / body fn
  _with_iso_cleanup "p13-mig-rvf-v1-retrieve" _p13_rvf_v1_retrieve_body
}

# 8. migration_rvf_v1_search
_p13_rvf_v1_search_body() {
  local iso="$1"; local _saved="${E2E_DIR:-}"; E2E_DIR="$iso"
  if ! _p13_load_fixture "v1-rvf" "$iso" "$(_p13_1_fixtures_dir)"; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="P13.1/rvf_v1_search FAIL: fixture load failed"
    E2E_DIR="$_saved"; return
  fi
  _mcp_invoke_tool "memory_search" \
    '{"query":"migration-works-v1"}' \
    '.' "P13.1/rvf_v1_search" 30 --ro
  # Either the key or the value surfacing in the search body proves the
  # current code parsed the RVF and indexed the record.
  _p13_expect_readable "P13.1/rvf_v1_search" 'p13rvf-sentinel|migration-works-v1'
  E2E_DIR="$_saved"
}
check_adr0094_p13_migration_rvf_v1_search() {
  # adr0097-l2-delegator: _CHECK_PASSED= is set inside _with_iso_cleanup / body fn
  _with_iso_cleanup "p13-mig-rvf-v1-search" _p13_rvf_v1_search_body
}

# ════════════════════════════════════════════════════════════════════
# Phase 13.2 — AgentDB SQLite fixture round-trips
#
# These checks consume a REAL .swarm/memory.db SQLite binary captured
# from a live @sparkleideas/cli round-trip via
# `scripts/seed-phase13-2-fixtures.sh`. The fixture ships with:
#   - skills table: 1 row (name='p13-2-skill',
#                          description='phase 13.2 migration sentinel skill')
#   - episodes table: 1 row (reflexion: 'p13-2 reflexion sentinel: migration-survived')
# If the current build can no longer read rows out of the committed
# SQLite, that's the AgentDB-schema regression Phase 13.2 exists to catch.
# ════════════════════════════════════════════════════════════════════

# 9. migration_agentdb_v1_skill_search
_p13_agentdb_v1_skill_search_body() {
  local iso="$1"; local _saved="${E2E_DIR:-}"; E2E_DIR="$iso"
  if ! _p13_load_fixture "v1-agentdb" "$iso" "$(_p13_2_fixtures_dir)"; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="P13.2/agentdb_v1_skill_search FAIL: fixture load failed"
    E2E_DIR="$_saved"; return
  fi
  _mcp_invoke_tool "agentdb_skill_search" \
    '{"query":"p13-2"}' \
    '.' "P13.2/agentdb_v1_skill_search" 30 --ro
  # Either the skill name or the description surfacing in the body proves
  # the current code parsed the SQLite schema and retrieved the seeded row.
  _p13_expect_readable "P13.2/agentdb_v1_skill_search" \
    'p13-2-skill|p13-2 migration sentinel|phase 13.2 migration sentinel skill'
  E2E_DIR="$_saved"
}
check_adr0094_p13_migration_agentdb_v1_skill_search() {
  # adr0097-l2-delegator: _CHECK_PASSED= is set inside _with_iso_cleanup / body fn
  _with_iso_cleanup "p13-mig-adb-v1-skill" _p13_agentdb_v1_skill_search_body
}

# 10. migration_agentdb_v1_reflexion_retrieve
_p13_agentdb_v1_reflexion_retrieve_body() {
  local iso="$1"; local _saved="${E2E_DIR:-}"; E2E_DIR="$iso"
  if ! _p13_load_fixture "v1-agentdb" "$iso" "$(_p13_2_fixtures_dir)"; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="P13.2/agentdb_v1_reflexion_retrieve FAIL: fixture load failed"
    E2E_DIR="$_saved"; return
  fi
  _mcp_invoke_tool "agentdb_reflexion_retrieve" \
    '{"task":"p13-2 reflexion sentinel"}' \
    '.' "P13.2/agentdb_v1_reflexion_retrieve" 30 --ro
  # Either the `migration-survived` marker OR the raw sentinel string
  # surfacing proves the reflexion row round-tripped through the current
  # reader.
  _p13_expect_readable "P13.2/agentdb_v1_reflexion_retrieve" \
    'migration-survived|p13-2 reflexion sentinel'
  E2E_DIR="$_saved"
}
check_adr0094_p13_migration_agentdb_v1_reflexion_retrieve() {
  # adr0097-l2-delegator: _CHECK_PASSED= is set inside _with_iso_cleanup / body fn
  _with_iso_cleanup "p13-mig-adb-v1-reflex" _p13_agentdb_v1_reflexion_retrieve_body
}
