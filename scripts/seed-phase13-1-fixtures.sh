#!/usr/bin/env bash
# scripts/seed-phase13-1-fixtures.sh — ADR-0094 Phase 13.1 fixture seeder
#
# ─── Scope ─────────────────────────────────────────────────────────────
# Captures REAL binary RVF fixtures from a live, Verdaccio-published
# `@sparkleideas/cli@latest` round-trip. Run ONCE; the output gets
# committed under `tests/fixtures/adr0094-phase13-1/v1-rvf/`. This script
# is NOT wired into the acceptance cascade — it's an authoring tool.
#
# Re-run it when the RVF on-disk format legitimately changes AND you want
# to add a `v2-rvf/` fixture alongside `v1-rvf/` (keep `v1-rvf/` — that's
# the whole regression signal).
#
# Pipeline:
#   1. mktemp -d         — isolated work dir
#   2. npm install       — @sparkleideas/cli@latest from Verdaccio
#   3. cli init --full   — initialise a project (matches acceptance harness)
#   4. cli memory store  — write a known K/V pair into RVF
#   5. cli memory retrieve — ASSERT value comes back; fail loudly otherwise
#   6. copy .swarm/ + optional .claude-flow/*.db → fixture dir
#   7. write .seed-manifest.json (CLI version, timestamp, checksums)
#   8. clean up tmp
#
# Verdaccio MUST be running at http://localhost:4873.
#
# Usage:
#   bash scripts/seed-phase13-1-fixtures.sh
#
set -euo pipefail

readonly REGISTRY="${REGISTRY:-http://localhost:4873}"
readonly PKG="@sparkleideas/cli"
readonly KEY="p13rvf-sentinel"
readonly VALUE="migration-works-v1"
readonly NAMESPACE="p13rvf"

_repo_root() {
  # scripts/seed-phase13-1-fixtures.sh → repo root
  cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd
}
readonly REPO_ROOT="$(_repo_root)"
readonly FIXTURE_ROOT="${REPO_ROOT}/tests/fixtures/adr0094-phase13-1/v1-rvf"

log() { printf '[seed-p13.1] %s\n' "$*" >&2; }
die() { log "FAIL: $*"; exit 1; }

# ── 0. Pre-flight ─────────────────────────────────────────────────────
curl -sf "${REGISTRY}/-/ping" >/dev/null \
  || die "Verdaccio not reachable at ${REGISTRY} — start it before seeding"

command -v shasum >/dev/null || die "shasum not found (macOS: built-in, Linux: install perl)"

# Pick a stat flavour for filesize. macOS uses -f, GNU uses -c.
_filesize() {
  stat -f%z "$1" 2>/dev/null || stat -c%s "$1" 2>/dev/null || echo 0
}

# ── 1. Scratch dir ────────────────────────────────────────────────────
TMP="$(mktemp -d "/tmp/p13-1-seed-XXXXXX")"
trap '[[ -n "${TMP:-}" && -d "$TMP" ]] && rm -rf "$TMP"' EXIT
log "scratch: $TMP"

# ── 2. Install CLI ────────────────────────────────────────────────────
log "installing ${PKG}@latest from ${REGISTRY}"
# Belt-and-braces on registry: env var + --registry flag. Quiet npm output
# but preserve errors.
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
# Mirror the harness flags from scripts/test-acceptance.sh (line 245).
# Use --force so repeated local testing is safe; skip --with-embeddings
# because the fixture only needs the RVF store, not the embedding model
# cache (saves ~45s and ~500MB download).
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

# ── 4. memory store ───────────────────────────────────────────────────
log "running: cli memory store (key=$KEY namespace=$NAMESPACE)"
(
  cd "$WORKDIR"
  NPM_CONFIG_REGISTRY="$REGISTRY" timeout 60 "$CLI" memory store \
    --key "$KEY" --value "$VALUE" --namespace "$NAMESPACE" \
    >"$TMP/store.log" 2>&1 || true
)
# Don't fail on exit code alone — the CLI is known to hang post-success
# (ADR-0039 T1 open-handle issue). We verify success via retrieve below.

# ── 5. memory retrieve (authoritative success signal) ─────────────────
log "running: cli memory retrieve (assert value round-trips)"
RETRIEVE_OUT="$TMP/retrieve.log"
(
  cd "$WORKDIR"
  NPM_CONFIG_REGISTRY="$REGISTRY" timeout 60 "$CLI" memory retrieve \
    --key "$KEY" --namespace "$NAMESPACE" \
    >"$RETRIEVE_OUT" 2>&1 || true
)
if ! grep -qF "$VALUE" "$RETRIEVE_OUT"; then
  log "--- store.log (last 40) ---"
  tail -40 "$TMP/store.log" >&2
  log "--- retrieve.log (last 40) ---"
  tail -40 "$RETRIEVE_OUT" >&2
  die "memory retrieve did not return '$VALUE' — refusing to commit an un-verified fixture"
fi
log "retrieve OK: '$VALUE' present in retrieve output"

# ── 6. Validate .swarm/ payload before capture ────────────────────────
[[ -d "$WORKDIR/.swarm" ]] || die ".swarm/ dir not created by memory store"
RVF="$WORKDIR/.swarm/memory.rvf"
if [[ ! -f "$RVF" ]]; then
  # Some builds may name it differently — list and fail loudly so we
  # don't fabricate a fixture we didn't actually verify.
  log ".swarm/ contents:"
  ls -la "$WORKDIR/.swarm" >&2
  die ".swarm/memory.rvf not found — cannot capture RVF fixture"
fi
RVF_SIZE="$(_filesize "$RVF")"
if (( RVF_SIZE < 64 )); then
  die "memory.rvf is suspiciously small ($RVF_SIZE bytes) — abort"
fi
log "rvf size: $RVF_SIZE bytes"

# ── 7. Copy fixture payload ───────────────────────────────────────────
# Wipe and recreate the fixture dir so stale files from a previous seed
# don't sneak in.
rm -rf "$FIXTURE_ROOT"
mkdir -p "$FIXTURE_ROOT/.swarm"

# Copy whole .swarm/ tree but drop transient + AgentDB-sidecar files.
# `.rvf.lock`     — runtime PID lock
# `.ingestlock`   — 0-byte ingest sentinel
# `memory.db*`    — AgentDB's reasoning/learning SQLite (episodes, skills,
#                   patterns). This is NOT the memory-KV store — RVF is
#                   primary for memory_store/retrieve (ADR-0086). The seeded
#                   memory.db carries schema-only (0 rows in all data tables)
#                   because the seed only exercises memory KV, not episodes
#                   or skills. Shipping an empty-schema SQLite adds ~225 KB
#                   of git churn for zero migration coverage. AgentDB round-
#                   trip belongs in a distinct Phase 13.2 fixture that seeds
#                   real episode/skill rows.
cp -R "$WORKDIR/.swarm/." "$FIXTURE_ROOT/.swarm/"
rm -f "$FIXTURE_ROOT/.swarm/"*.rvf.lock 2>/dev/null || true
rm -f "$FIXTURE_ROOT/.swarm/.rvf.lock"   2>/dev/null || true
rm -f "$FIXTURE_ROOT/.swarm/"*.ingestlock 2>/dev/null || true
# AgentDB SQLite sidecar + WAL — excluded by design (see block above).
rm -f "$FIXTURE_ROOT/.swarm/"*.db        2>/dev/null || true
rm -f "$FIXTURE_ROOT/.swarm/"*.db-shm    2>/dev/null || true
rm -f "$FIXTURE_ROOT/.swarm/"*.db-wal    2>/dev/null || true

# Phase 13.1 = RVF only. AgentDB SQLite migration is Phase 13.2 territory
# (not yet implemented). Intentionally do NOT copy `.claude-flow/*.db`.

# ── 8. Manifest ───────────────────────────────────────────────────────
MANIFEST="$FIXTURE_ROOT/.seed-manifest.json"
{
  printf '{\n'
  printf '  "adr": "ADR-0094 Phase 13.1",\n'
  printf '  "fixture": "v1-rvf",\n'
  printf '  "cliPackage": "%s",\n' "$PKG"
  printf '  "cliVersion": "%s",\n' "$CLI_VERSION"
  printf '  "registry": "%s",\n' "$REGISTRY"
  printf '  "seededAt": "%s",\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '  "seed": {\n'
  printf '    "key": "%s",\n' "$KEY"
  printf '    "value": "%s",\n' "$VALUE"
  printf '    "namespace": "%s"\n' "$NAMESPACE"
  printf '  },\n'
  printf '  "files": [\n'
  first=1
  # Enumerate fixture files relative to FIXTURE_ROOT. Skip the manifest
  # itself (chicken/egg) and the `.` root entry from find.
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
log "  dir:      $FIXTURE_ROOT"
log "  rvf:      $(_filesize "$FIXTURE_ROOT/.swarm/memory.rvf") bytes"
log "  manifest: $MANIFEST"
log "  files captured:"
(cd "$FIXTURE_ROOT" && find . -type f | sort) | while read -r f; do
  log "    $f"
done
log "done."
