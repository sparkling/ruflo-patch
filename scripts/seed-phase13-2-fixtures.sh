#!/usr/bin/env bash
# scripts/seed-phase13-2-fixtures.sh — ADR-0094 Phase 13.2 fixture seeder
#
# ─── Scope ─────────────────────────────────────────────────────────────
# Phase 13.2 — AgentDB SQLite fixture migration. One-shot seed, not wired
# into acceptance cascade.
#
# Phase 13.1 shipped RVF binary migration coverage. Its captured
# `.swarm/memory.db` was schema-only (0 rows in every AgentDB table)
# because the RVF seed never exercised the reasoning layer. This script
# closes that gap:
#   1. cli init --full inside an isolated tmp project
#   2. Exercise AgentDB MCP tools (agentdb_skill_create,
#      agentdb_reflexion_store, agentdb_reflexion_retrieve) so rows land
#      in .swarm/memory.db
#   3. Force a WAL checkpoint so the primary .db holds all data
#   4. Verify row counts via sqlite3 (fail loud on empty schema)
#   5. Copy ONLY .swarm/memory.db into the fixture dir
#   6. Write .seed-manifest.json with CLI version + per-table row counts
#
# Re-run this when the AgentDB on-disk SQLite schema legitimately changes
# AND you want a `v2-agentdb/` fixture alongside `v1-agentdb/`.
#
# This script is NOT part of the acceptance cascade. It runs once, commits
# fixtures, and walks away. Verdaccio MUST be running at localhost:4873.
#
# Usage:
#   bash scripts/seed-phase13-2-fixtures.sh
#
set -euo pipefail

readonly REGISTRY="${REGISTRY:-http://localhost:4873}"
readonly PKG="@sparkleideas/cli"

# Sentinel markers — committed into the fixture so acceptance checks have
# a stable string to grep for.
readonly SKILL_NAME="p13-2-skill"
readonly SKILL_DESC="phase 13.2 migration sentinel skill"
readonly REFLEX_SESSION="p13-2-session"
readonly REFLEX_TASK="p13-2 reflexion sentinel: migration-survived"

_repo_root() { cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd; }
readonly REPO_ROOT="$(_repo_root)"
readonly FIXTURE_ROOT="${REPO_ROOT}/tests/fixtures/adr0094-phase13-2/v1-agentdb"

log() { printf '[seed-p13.2] %s\n' "$*" >&2; }
die() { log "FAIL: $*"; exit 1; }

# ── 0. Pre-flight ─────────────────────────────────────────────────────
curl -sf "${REGISTRY}/-/ping" >/dev/null \
  || die "Verdaccio not reachable at ${REGISTRY} — start it before seeding"
command -v shasum  >/dev/null || die "shasum not found"
command -v sqlite3 >/dev/null || die "sqlite3 not found (macOS: built-in)"

_filesize() {
  stat -f%z "$1" 2>/dev/null || stat -c%s "$1" 2>/dev/null || echo 0
}

# ── 1. Scratch dir ────────────────────────────────────────────────────
TMP="$(mktemp -d "/tmp/p13-2-seed-XXXXXX")"
trap '[[ -n "${TMP:-}" && -d "$TMP" ]] && rm -rf "$TMP"' EXIT
log "scratch: $TMP"

# ── 2. Install CLI ────────────────────────────────────────────────────
log "installing ${PKG}@latest from ${REGISTRY}"
NPM_CONFIG_REGISTRY="$REGISTRY" npm install \
  --prefix "$TMP" \
  --registry="$REGISTRY" \
  --loglevel=error \
  --no-audit --no-fund \
  "${PKG}@latest" \
  >"$TMP/install.log" 2>&1 \
  || { tail -40 "$TMP/install.log" >&2; die "npm install failed"; }

CLI=""
for _c in ruflo claude-flow cli; do
  if [[ -x "$TMP/node_modules/.bin/$_c" ]]; then CLI="$TMP/node_modules/.bin/$_c"; break; fi
done
[[ -n "$CLI" ]] || die "CLI binary not resolved at $TMP/node_modules/.bin/{ruflo,claude-flow,cli}"

CLI_VERSION="$(node -p "require('$TMP/node_modules/${PKG}/package.json').version" 2>/dev/null || echo unknown)"
log "cli version: $CLI_VERSION"

# ── 3. init --full ────────────────────────────────────────────────────
WORKDIR="$TMP/proj"
mkdir -p "$WORKDIR"
log "running: cli init --full --force (in $WORKDIR)"
(
  cd "$WORKDIR"
  NPM_CONFIG_REGISTRY="$REGISTRY" timeout 120 "$CLI" init --full --force \
    >"$TMP/init.log" 2>&1 || true
)
if [[ ! -f "$WORKDIR/.claude-flow/config.json" && ! -f "$WORKDIR/.claude-flow/config.yaml" ]]; then
  tail -40 "$TMP/init.log" >&2
  die "init did not create .claude-flow/config.{json,yaml}"
fi
log "init OK: .claude-flow/ present"

# ── 4. Helper to invoke an AgentDB MCP tool ───────────────────────────
# Mirrors `cli mcp exec --tool <t> --params '<json>'` — same shape
# _expect_mcp_body uses in the acceptance harness.
_mcp_exec() {
  local tool="$1" params="$2" logfile="$3"
  (
    cd "$WORKDIR"
    NPM_CONFIG_REGISTRY="$REGISTRY" timeout 60 "$CLI" mcp exec \
      --tool "$tool" --params "$params" \
      >"$logfile" 2>&1 || true
  )
}

# ── 5. Populate AgentDB tables ────────────────────────────────────────
# agentdb_skill_create — writes a row into skills (SkillLibrary controller).
log "running: agentdb_skill_create (name=$SKILL_NAME)"
_mcp_exec "agentdb_skill_create" \
  "$(printf '{"name":"%s","description":"%s"}' "$SKILL_NAME" "$SKILL_DESC")" \
  "$TMP/skill-create.log"

# agentdb_reflexion_store — writes a reflexion episode (ReflexionMemory).
log "running: agentdb_reflexion_store (task=$REFLEX_TASK)"
_mcp_exec "agentdb_reflexion_store" \
  "$(printf '{"session_id":"%s","task":"%s","reward":0.9,"success":true}' "$REFLEX_SESSION" "$REFLEX_TASK")" \
  "$TMP/reflex-store.log"

# agentdb_reflexion_retrieve — round-trip assertion (authoritative signal).
log "running: agentdb_reflexion_retrieve (assert reflexion round-trips)"
_mcp_exec "agentdb_reflexion_retrieve" \
  "$(printf '{"task":"%s"}' "$REFLEX_TASK")" \
  "$TMP/reflex-retrieve.log"

# The retrieve body should mention either the task string or the
# migration-survived marker. Reflexion retrieval in the current build can
# fan out to semantic search — be tolerant of either marker.
if ! grep -qE "migration-survived|p13-2 reflexion sentinel|${REFLEX_SESSION}" \
    "$TMP/reflex-retrieve.log"; then
  log "--- skill-create.log (last 20) ---"
  tail -20 "$TMP/skill-create.log" >&2
  log "--- reflex-store.log (last 20) ---"
  tail -20 "$TMP/reflex-store.log" >&2
  log "--- reflex-retrieve.log (last 40) ---"
  tail -40 "$TMP/reflex-retrieve.log" >&2
  die "reflexion_retrieve did not surface the sentinel — refusing to commit an un-verified fixture"
fi
log "reflexion round-trip OK: sentinel present in retrieve output"

# ── 6. WAL checkpoint + row-count verification ────────────────────────
DB="$WORKDIR/.swarm/memory.db"
[[ -f "$DB" ]] || die ".swarm/memory.db not created by AgentDB"

# Force any WAL pages back into the primary .db file so the committed
# fixture is a single-file SQLite (no .db-shm / .db-wal companions).
# TRUNCATE mode empties the WAL after checkpointing. Best-effort — an
# error here is a hard fail (we refuse to commit an incoherent DB).
log "running: sqlite3 PRAGMA wal_checkpoint(TRUNCATE)"
sqlite3 "$DB" "PRAGMA wal_checkpoint(TRUNCATE);" >"$TMP/checkpoint.log" 2>&1 \
  || { cat "$TMP/checkpoint.log" >&2; die "WAL checkpoint failed"; }

# Count rows in the data tables we care about. `sqlite3` will print a
# blank line for missing tables under -cmd ".tables" but errors when a
# non-existent table is selected — so discover tables first, then query
# the ones that exist.
_have_table() {
  sqlite3 "$DB" "SELECT name FROM sqlite_master WHERE type='table' AND name='$1' LIMIT 1;" \
    2>/dev/null | grep -qx "$1"
}

_rowcount() {
  local t="$1"
  if _have_table "$t"; then
    sqlite3 "$DB" "SELECT COUNT(*) FROM $t;" 2>/dev/null || echo 0
  else
    echo 0
  fi
}

SKILL_ROWS="$(_rowcount skills)"
EPISODE_ROWS="$(_rowcount episodes)"
PATTERN_ROWS="$(_rowcount reasoning_patterns)"
CAUSAL_ROWS="$(_rowcount causal_edges)"
SESSION_ROWS="$(_rowcount learning_sessions)"

log "row counts (post-checkpoint):"
log "  skills:            $SKILL_ROWS"
log "  episodes:          $EPISODE_ROWS"
log "  reasoning_patterns: $PATTERN_ROWS"
log "  causal_edges:      $CAUSAL_ROWS"
log "  learning_sessions: $SESSION_ROWS"

# Fail-loud guard: skills MUST have been populated or the fixture is
# worth nothing (same contract as 13.1: un-verified fixtures are worse
# than none).
if (( SKILL_ROWS < 1 )); then
  log "--- skill-create.log ---"
  tail -40 "$TMP/skill-create.log" >&2
  log "--- .swarm/ contents ---"
  ls -la "$WORKDIR/.swarm" >&2
  die "skills table is empty — agentdb_skill_create did not persist"
fi

# Double-check the marker is actually there (defence against a silent
# handler that returns success but writes junk).
if ! sqlite3 "$DB" "SELECT name FROM skills;" 2>/dev/null | grep -qF "$SKILL_NAME"; then
  die "skills table has rows but '${SKILL_NAME}' marker is missing"
fi
log "skills marker OK: '$SKILL_NAME' present in skills table"

DB_SIZE="$(_filesize "$DB")"
if (( DB_SIZE < 51200 )); then
  die "memory.db is suspiciously small ($DB_SIZE bytes) — abort"
fi
log "memory.db size: $DB_SIZE bytes"

# ── 7. Copy fixture payload ───────────────────────────────────────────
rm -rf "$FIXTURE_ROOT"
mkdir -p "$FIXTURE_ROOT/.swarm"

# Copy ONLY memory.db. WAL/SHM journals were truncated above so the .db
# file is self-contained. RVF files (.rvf / .rvf.meta) are NOT copied —
# Phase 13.1 is the canonical fixture for RVF, and 13.2's scope is
# AgentDB SQLite only.
cp "$DB" "$FIXTURE_ROOT/.swarm/memory.db"

# Belt-and-braces: make sure no transient WAL files slipped in.
rm -f "$FIXTURE_ROOT/.swarm/"*.db-shm 2>/dev/null || true
rm -f "$FIXTURE_ROOT/.swarm/"*.db-wal 2>/dev/null || true
# And no RVF files.
rm -f "$FIXTURE_ROOT/.swarm/"*.rvf     2>/dev/null || true
rm -f "$FIXTURE_ROOT/.swarm/"*.rvf.meta 2>/dev/null || true

# ── 8. Manifest ───────────────────────────────────────────────────────
MANIFEST="$FIXTURE_ROOT/.seed-manifest.json"
{
  printf '{\n'
  printf '  "adr": "ADR-0094 Phase 13.2",\n'
  printf '  "fixture": "v1-agentdb",\n'
  printf '  "cliPackage": "%s",\n' "$PKG"
  printf '  "cliVersion": "%s",\n' "$CLI_VERSION"
  printf '  "registry": "%s",\n' "$REGISTRY"
  printf '  "seededAt": "%s",\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '  "seed": {\n'
  printf '    "skillName": "%s",\n' "$SKILL_NAME"
  printf '    "skillDescription": "%s",\n' "$SKILL_DESC"
  printf '    "reflexionSessionId": "%s",\n' "$REFLEX_SESSION"
  printf '    "reflexionTask": "%s"\n' "$REFLEX_TASK"
  printf '  },\n'
  printf '  "rowCounts": {\n'
  printf '    "skills": %s,\n' "$SKILL_ROWS"
  printf '    "episodes": %s,\n' "$EPISODE_ROWS"
  printf '    "reasoning_patterns": %s,\n' "$PATTERN_ROWS"
  printf '    "causal_edges": %s,\n' "$CAUSAL_ROWS"
  printf '    "learning_sessions": %s\n' "$SESSION_ROWS"
  printf '  },\n'
  printf '  "files": [\n'
  first=1
  while IFS= read -r rel; do
    [[ -z "$rel" || "$rel" == "." ]] && continue
    rel="${rel#./}"
    [[ "$rel" == ".seed-manifest.json" ]] && continue
    abs="$FIXTURE_ROOT/$rel"
    [[ -f "$abs" ]] || continue
    sum="$(shasum -a 256 "$abs" | awk '{print $1}')"
    size="$(_filesize "$abs")"
    if (( first )); then first=0; else printf ',\n'; fi
    printf '    {"path": "%s", "sha256": "%s", "bytes": %s}' "$rel" "$sum" "$size"
  done < <(cd "$FIXTURE_ROOT" && find . -type f | sort)
  printf '\n  ]\n'
  printf '}\n'
} >"$MANIFEST"

# ── 9. Summary ────────────────────────────────────────────────────────
log "=== seeded fixture ==="
log "  dir:       $FIXTURE_ROOT"
log "  memory.db: $(_filesize "$FIXTURE_ROOT/.swarm/memory.db") bytes"
log "  manifest:  $MANIFEST"
log "  files captured:"
(cd "$FIXTURE_ROOT" && find . -type f | sort) | while read -r f; do
  log "    $f"
done
log "done."
