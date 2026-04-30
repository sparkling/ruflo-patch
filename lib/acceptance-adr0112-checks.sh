#!/usr/bin/env bash
# lib/acceptance-adr0112-checks.sh — ADR-0112 §Done criteria checks.
#
# Two test families that lock in ADR-0112's "two independent stores,
# feature-aligned" mandate:
#
#   1. Partition-holds (item #26) — operations on one store MUST NOT
#      write user data into the other store. 4 cases (2 write + 2 read).
#   2. AgentDB MCP read-tool round-trip (item #27) — store via
#      `agentdb_*_store`, read via `agentdb_*_recall` / `_search` /
#      `_retrieve`, assert the read tool returned the stored marker.
#      Closes the gap where existing b5-* tests bypass read MCP tools by
#      SELECTing sqlite3 directly: a read MCP tool that silently
#      bypasses AgentDB (returning [] from in-memory cache instead of
#      querying the store) would not be caught by b5.
#
# A note on partition semantics: the ADR cares about USER DATA crossing
# the store boundary, NOT about whether init creates both store files
# eagerly. AgentDB's better-sqlite3 + RvfBackend both initialize lazily
# at module load, which can create empty/header-only files for stores
# the user never operates on. That's an init-coupling concern, not the
# data-coupling concern these tests target. The marker-substring check
# is the semantically correct test: did the OPERATION write the user's
# bytes into the wrong store?
#
# Requires: acceptance-harness.sh + acceptance-checks.sh sourced first.
# Caller MUST set: E2E_DIR, REGISTRY (CLI_BIN inferred from _cli_cmd).

# ════════════════════════════════════════════════════════════════════
# Item #26 — Partition-holds (4 cases)
# ════════════════════════════════════════════════════════════════════
#
# The contract from ADR-0112 §Decision:
#   "A given MCP tool writes to exactly one store. The store is
#    determined by the tool's feature domain."
#
# Locks in the no-coordination invariant. If a future change adds a
# silent dual-write (e.g. memory_store also writes a marker into
# .swarm/memory.db "for safety"), one of these checks fails immediately.

# ────────────────────────────────────────────────────────────────────
# Helpers — leak detection
# ────────────────────────────────────────────────────────────────────
# Marker leak in SQLite = the marker string appears in ANY row of ANY
# user-data table (we exclude sqlite_master / sqlite_sequence).
_adr0112_db_contains_marker() {
  local db="$1"
  local marker="$2"
  [[ -f "$db" ]] || return 1  # absent = no leak
  command -v sqlite3 >/dev/null 2>&1 || return 1  # cannot probe = treat as no leak
  local tables
  tables=$(sqlite3 "$db" "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';" 2>/dev/null)
  [[ -z "$tables" ]] && return 1
  while IFS= read -r tbl; do
    [[ -z "$tbl" ]] && continue
    # Cast every column to text via sqlite3's .dump trick? Simpler:
    # query each table and look for the marker in any text column.
    # `SELECT * FROM <tbl>` then grep — fast enough at acceptance scale.
    if sqlite3 "$db" "SELECT * FROM \"$tbl\";" 2>/dev/null | grep -qF "$marker"; then
      echo "$tbl"
      return 0
    fi
  done <<< "$tables"
  return 1
}

# Marker leak in RVF = the marker bytes appear anywhere in the RVF
# family of files: `.rvf` (binary HNSW vectors), `.rvf.meta` (JSON
# sidecar with keys + values + embeddings), or `.rvf.wal` (write-ahead
# log). Substring grep across all three is the right detector — entries
# can land in any of them depending on whether persist has flushed.
# Markers are timestamped + PID-tagged so collisions are vanishingly
# rare across an iso lifecycle.
_adr0112_rvf_contains_marker() {
  local rvf="$1"
  local marker="$2"
  local found=1
  for ext in "" ".meta" ".wal"; do
    local f="${rvf}${ext}"
    [[ -f "$f" ]] || continue
    if grep -aqF "$marker" "$f" 2>/dev/null; then
      found=0
      break
    fi
  done
  return $found
}

# ────────────────────────────────────────────────────────────────────
# 26.1 — `memory_store` user data does not leak into .swarm/memory.db
# ────────────────────────────────────────────────────────────────────
check_adr0112_partition_memory_store_to_rvf_only() { # adr0097-l2-delegator
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local iso; iso=$(_e2e_isolate "0112-part-memstore")
  if [[ -z "$iso" || ! -d "$iso" ]]; then
    _CHECK_OUTPUT="0112/26.1: failed to create iso dir"
    return
  fi

  local cli; cli=$(_cli_cmd)
  local marker="adr0112-26-1-$$-$(date +%s)"

  _run_and_kill "cd '$iso' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli memory store --key '$marker' --value '$marker rvf-only payload' --namespace adr0112 2>&1" "" 45
  if ! echo "$_RK_OUT" | grep -qiE 'stored|success'; then
    _CHECK_OUTPUT="0112/26.1: memory store failed: $(echo "$_RK_OUT" | head -3 | tr '\n' ' ')"
    rm -rf "$iso" 2>/dev/null
    return
  fi

  local rvf="$iso/.swarm/memory.rvf"
  local db="$iso/.swarm/memory.db"

  # Sanity: marker landed in RVF (write side actually worked)
  if ! _adr0112_rvf_contains_marker "$rvf" "$marker"; then
    _CHECK_OUTPUT="0112/26.1: FAIL: memory_store reported success but marker '$marker' not found in $rvf — RVF write path broken"
    rm -rf "$iso" 2>/dev/null
    return
  fi

  # Partition: marker MUST NOT appear in AgentDB SQLite
  local leak_table
  leak_table=$(_adr0112_db_contains_marker "$db" "$marker")
  if [[ -n "$leak_table" ]]; then
    _CHECK_OUTPUT="0112/26.1: FAIL: marker '$marker' leaked into .swarm/memory.db table '$leak_table' — memory_store wrote user data into AgentDB SQLite (cross-store coordination forbidden by ADR-0112)"
    rm -rf "$iso" 2>/dev/null
    return
  fi

  rm -rf "$iso" 2>/dev/null
  _CHECK_PASSED="true"
  _CHECK_OUTPUT="0112/26.1: PASS: memory_store wrote marker into RVF only; SQLite contains zero rows with marker (per-store data partition holds)"
}

# ────────────────────────────────────────────────────────────────────
# 26.2 — `agentdb_reflexion_store` data does not leak into .swarm/memory.rvf
# ────────────────────────────────────────────────────────────────────
check_adr0112_partition_agentdb_store_to_db_only() { # adr0097-l2-delegator
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local iso; iso=$(_e2e_isolate "0112-part-agentdb")
  if [[ -z "$iso" || ! -d "$iso" ]]; then
    _CHECK_OUTPUT="0112/26.2: failed to create iso dir"
    return
  fi

  local cli; cli=$(_cli_cmd)
  local marker="adr0112-26-2-$$-$(date +%s)"
  local params="{\"session_id\":\"$marker\",\"task\":\"$marker partition probe\",\"reward\":0.5,\"success\":true}"

  _run_and_kill "cd '$iso' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli mcp exec --tool agentdb_reflexion_store --params '$params' 2>&1" "" 30
  local body="$_RK_OUT"

  if echo "$body" | grep -qiE '(not available|controller not initialized|not wired)'; then
    rm -rf "$iso" 2>/dev/null
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="0112/26.2: SKIP_ACCEPTED: ReflexionMemory controller not wired in build — $(echo "$body" | head -2 | tr '\n' ' ')"
    return
  fi

  local rvf="$iso/.swarm/memory.rvf"
  local db="$iso/.swarm/memory.db"

  # Sanity: marker landed in SQLite (write side actually worked)
  local home_table
  home_table=$(_adr0112_db_contains_marker "$db" "$marker")
  if [[ -z "$home_table" ]]; then
    _CHECK_OUTPUT="0112/26.2: FAIL: agentdb_reflexion_store reported success but marker '$marker' not found in any table of $db (silent in-memory fallback per ADR-0082 + ADR-0112 mandate). Body: $(echo "$body" | head -3 | tr '\n' ' ')"
    rm -rf "$iso" 2>/dev/null
    return
  fi

  # Partition: marker MUST NOT appear in RVF
  if _adr0112_rvf_contains_marker "$rvf" "$marker"; then
    _CHECK_OUTPUT="0112/26.2: FAIL: marker '$marker' leaked into .swarm/memory.rvf — agentdb_reflexion_store wrote user data into RVF (cross-store coordination forbidden by ADR-0112)"
    rm -rf "$iso" 2>/dev/null
    return
  fi

  rm -rf "$iso" 2>/dev/null
  _CHECK_PASSED="true"
  _CHECK_OUTPUT="0112/26.2: PASS: agentdb_reflexion_store wrote marker into SQLite ($home_table) only; RVF contains zero bytes matching marker (per-store data partition holds)"
}

# ────────────────────────────────────────────────────────────────────
# 26.3 — `memory_search` (with no AgentDB seed) does not leak into .swarm/memory.db
# ────────────────────────────────────────────────────────────────────
# Pre-seed RVF only. Run search. Assert search did not write the
# query string into AgentDB (e.g. via a "log every query" anti-pattern).
# ────────────────────────────────────────────────────────────────────
check_adr0112_partition_memory_search_does_not_query_db() { # adr0097-l2-delegator
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local iso; iso=$(_e2e_isolate "0112-part-memsearch")
  if [[ -z "$iso" || ! -d "$iso" ]]; then
    _CHECK_OUTPUT="0112/26.3: failed to create iso dir"
    return
  fi

  local cli; cli=$(_cli_cmd)
  local marker="adr0112-26-3-$$-$(date +%s)"

  # Step 1: seed RVF with one entry containing the marker
  _run_and_kill "cd '$iso' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli memory store --key '$marker' --value '$marker rvf-only seed' --namespace adr0112-search 2>&1" "" 45
  if ! echo "$_RK_OUT" | grep -qiE 'stored|success'; then
    _CHECK_OUTPUT="0112/26.3: seed memory_store failed: $(echo "$_RK_OUT" | head -2 | tr '\n' ' ')"
    rm -rf "$iso" 2>/dev/null
    return
  fi

  local db="$iso/.swarm/memory.db"

  # Step 2: snapshot any pre-existing marker presence in .db (should be none,
  # but assert it for clarity rather than silently inheriting init noise).
  local leak_pre
  leak_pre=$(_adr0112_db_contains_marker "$db" "$marker")
  if [[ -n "$leak_pre" ]]; then
    _CHECK_OUTPUT="0112/26.3: FAIL (pre-condition): marker '$marker' already in .swarm/memory.db table '$leak_pre' BEFORE search ran — write side leaked (item #26.1 should have caught this)"
    rm -rf "$iso" 2>/dev/null
    return
  fi

  # Step 3: run memory_search via CLI
  _run_and_kill "cd '$iso' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli memory search --query '$marker rvf-only' 2>&1" "" 30

  # Step 4: assert .db still has zero rows with marker (search is read-only
  # for AgentDB)
  local leak_post
  leak_post=$(_adr0112_db_contains_marker "$db" "$marker")
  if [[ -n "$leak_post" ]]; then
    _CHECK_OUTPUT="0112/26.3: FAIL: memory_search caused marker '$marker' to appear in .swarm/memory.db table '$leak_post' — search wrote query into AgentDB (cross-store read coupling forbidden by ADR-0112)"
    rm -rf "$iso" 2>/dev/null
    return
  fi

  rm -rf "$iso" 2>/dev/null
  _CHECK_PASSED="true"
  _CHECK_OUTPUT="0112/26.3: PASS: memory_search did not write marker into AgentDB SQLite (read path stays in RVF)"
}

# ────────────────────────────────────────────────────────────────────
# 26.4 — `agentdb_reflexion_retrieve` does not leak into .swarm/memory.rvf
# ────────────────────────────────────────────────────────────────────
check_adr0112_partition_agentdb_retrieve_does_not_query_rvf() { # adr0097-l2-delegator
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local iso; iso=$(_e2e_isolate "0112-part-adb-retr")
  if [[ -z "$iso" || ! -d "$iso" ]]; then
    _CHECK_OUTPUT="0112/26.4: failed to create iso dir"
    return
  fi

  local cli; cli=$(_cli_cmd)
  local marker="adr0112-26-4-$$-$(date +%s)"
  local store_params="{\"session_id\":\"$marker\",\"task\":\"$marker retrieve probe\",\"reward\":0.7,\"success\":true}"

  # Step 1: seed AgentDB
  _run_and_kill "cd '$iso' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli mcp exec --tool agentdb_reflexion_store --params '$store_params' 2>&1" "" 30
  local body="$_RK_OUT"
  if echo "$body" | grep -qiE '(not available|controller not initialized|not wired)'; then
    rm -rf "$iso" 2>/dev/null
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="0112/26.4: SKIP_ACCEPTED: ReflexionMemory controller not wired — $(echo "$body" | head -2 | tr '\n' ' ')"
    return
  fi

  local rvf="$iso/.swarm/memory.rvf"

  # Pre-condition: ensure marker not already in RVF (write-side partition)
  if _adr0112_rvf_contains_marker "$rvf" "$marker"; then
    _CHECK_OUTPUT="0112/26.4: FAIL (pre-condition): marker '$marker' already in .swarm/memory.rvf BEFORE retrieve ran — write side leaked (item #26.2 should have caught this)"
    rm -rf "$iso" 2>/dev/null
    return
  fi

  # Step 2: run agentdb_reflexion_retrieve
  local retrieve_params="{\"task\":\"$marker retrieve probe\",\"k\":5}"
  _run_and_kill "cd '$iso' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli mcp exec --tool agentdb_reflexion_retrieve --params '$retrieve_params' 2>&1" "" 30

  # Step 3: assert .rvf has no bytes matching the marker (retrieve must
  # not have written its query into RVF for "logging" or similar)
  if _adr0112_rvf_contains_marker "$rvf" "$marker"; then
    _CHECK_OUTPUT="0112/26.4: FAIL: agentdb_reflexion_retrieve caused marker '$marker' to appear in .swarm/memory.rvf — retrieve wrote query into RVF (cross-store read coupling forbidden by ADR-0112)"
    rm -rf "$iso" 2>/dev/null
    return
  fi

  rm -rf "$iso" 2>/dev/null
  _CHECK_PASSED="true"
  _CHECK_OUTPUT="0112/26.4: PASS: agentdb_reflexion_retrieve did not write marker into RVF (read path stays in AgentDB)"
}

# ════════════════════════════════════════════════════════════════════
# Item #27 — AgentDB MCP read-tool round-trip (4 cases)
# ════════════════════════════════════════════════════════════════════
#
# Existing b5-* tests prove the WRITE side: store via MCP, then SELECT
# via sqlite3 to confirm the row is on disk. They bypass read MCP
# tools entirely. A read tool that silently bypasses AgentDB
# (returning [] from in-memory cache, RVF fallthrough, etc.) would
# slip through every existing acceptance test.
#
# These checks store via the write MCP tool then immediately read via
# the corresponding read MCP tool, asserting the stored marker comes
# back. The pair (write tool, read tool) per controller is the
# minimum surface that proves reads consult the store.

# ────────────────────────────────────────────────────────────────────
# Shared helper: _adr0112_roundtrip
#
# Positional args:
#   $1 controller_label  — diagnostic prefix (e.g. "reflexion")
#   $2 store_tool        — MCP write tool (e.g. agentdb_reflexion_store)
#   $3 store_params      — JSON literal with marker embedded
#   $4 read_tool         — MCP read tool (e.g. agentdb_reflexion_retrieve)
#   $5 read_params       — JSON literal querying the same marker
#   $6 marker            — substring that MUST appear in read tool's
#                          response if the read consulted the store
# ────────────────────────────────────────────────────────────────────
_adr0112_roundtrip() {
  local label="$1"
  local store_tool="$2"
  local store_params="$3"
  local read_tool="$4"
  local read_params="$5"
  local marker="$6"

  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local iso; iso=$(_e2e_isolate "0112-rt-${label}")
  if [[ -z "$iso" || ! -d "$iso" ]]; then
    _CHECK_OUTPUT="0112/27 ${label}: failed to create iso dir"
    return
  fi

  local cli; cli=$(_cli_cmd)

  # Step 1: store via write MCP tool
  _run_and_kill "cd '$iso' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli mcp exec --tool '$store_tool' --params '$store_params' 2>&1" "" 30
  local store_body="$_RK_OUT"

  # Same skip taxonomy as b5: controller not wired = skip_accepted, else
  # we expect to round-trip.
  if echo "$store_body" | grep -qiE '(not available|controller not initialized|not wired|tool not found|unknown tool)'; then
    rm -rf "$iso" 2>/dev/null
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="0112/27 ${label}: SKIP_ACCEPTED: write tool '$store_tool' reports controller/tool unavailable — $(echo "$store_body" | head -2 | tr '\n' ' ')"
    return
  fi

  # Step 2: read via read MCP tool
  _run_and_kill "cd '$iso' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli mcp exec --tool '$read_tool' --params '$read_params' 2>&1" "" 30
  local read_body="$_RK_OUT"

  if echo "$read_body" | grep -qiE '(not available|controller not initialized|not wired|tool not found|unknown tool)'; then
    rm -rf "$iso" 2>/dev/null
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="0112/27 ${label}: SKIP_ACCEPTED: read tool '$read_tool' reports controller/tool unavailable — $(echo "$read_body" | head -2 | tr '\n' ' ')"
    return
  fi

  # Step 3: assert the marker came back through the read tool
  if echo "$read_body" | grep -qF "$marker"; then
    rm -rf "$iso" 2>/dev/null
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="0112/27 ${label}: PASS: ${store_tool}→${read_tool} round-trip returned marker '$marker'"
    return
  fi

  _CHECK_OUTPUT="0112/27 ${label}: FAIL: ${read_tool} response did not include marker '$marker' — read tool may be silently bypassing AgentDB (in-memory fallback / cache miss returned empty / RVF fallthrough). Store body: $(echo "$store_body" | head -2 | tr '\n' ' ') | Read body: $(echo "$read_body" | head -3 | tr '\n' ' ')"
  rm -rf "$iso" 2>/dev/null
}

# ────────────────────────────────────────────────────────────────────
# 27.1 — Reflexion store/retrieve round-trip
# ────────────────────────────────────────────────────────────────────
check_adr0112_roundtrip_reflexion() { # adr0097-l2-delegator
  local marker="adr0112-rt-refl-$$-$(date +%s)"
  _adr0112_roundtrip \
    "reflexion" \
    "agentdb_reflexion_store" \
    "{\"session_id\":\"$marker\",\"task\":\"$marker round-trip task\",\"reward\":0.8,\"success\":true}" \
    "agentdb_reflexion_retrieve" \
    "{\"task\":\"$marker round-trip task\",\"k\":5}" \
    "$marker"
}

# ────────────────────────────────────────────────────────────────────
# 27.2 — Pattern store/search round-trip (reasoningBank)
# ────────────────────────────────────────────────────────────────────
check_adr0112_roundtrip_pattern() { # adr0097-l2-delegator
  local marker="adr0112-rt-pat-$$-$(date +%s)"
  _adr0112_roundtrip \
    "pattern" \
    "agentdb_pattern_store" \
    "{\"pattern\":\"$marker round-trip approach\",\"type\":\"adr0112-test\",\"confidence\":0.9}" \
    "agentdb_pattern_search" \
    "{\"query\":\"$marker round-trip approach\",\"topK\":5}" \
    "$marker"
}

# ────────────────────────────────────────────────────────────────────
# 27.3 — Skill create/search round-trip
# ────────────────────────────────────────────────────────────────────
check_adr0112_roundtrip_skill() { # adr0097-l2-delegator
  local marker="adr0112-rt-skill-$$-$(date +%s)"
  _adr0112_roundtrip \
    "skill" \
    "agentdb_skill_create" \
    "{\"name\":\"$marker\",\"signature\":\"sig $marker\",\"body\":\"body $marker\"}" \
    "agentdb_skill_search" \
    "{\"query\":\"$marker\",\"limit\":5}" \
    "$marker"
}

# ────────────────────────────────────────────────────────────────────
# 27.4 — Hierarchical store/recall round-trip
# ────────────────────────────────────────────────────────────────────
check_adr0112_roundtrip_hierarchical() { # adr0097-l2-delegator
  local marker="adr0112-rt-hmem-$$-$(date +%s)"
  _adr0112_roundtrip \
    "hierarchical" \
    "agentdb_hierarchical_store" \
    "{\"content\":\"$marker hierarchical content\",\"tier\":\"working\"}" \
    "agentdb_hierarchical_recall" \
    "{\"query\":\"$marker hierarchical\",\"topK\":5}" \
    "$marker"
}
