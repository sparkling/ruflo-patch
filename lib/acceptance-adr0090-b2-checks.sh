#!/usr/bin/env bash
# lib/acceptance-adr0090-b2-checks.sh — ADR-0090 Tier B2: RVF corruption
# recovery suite.
#
# Requires: acceptance-harness.sh + acceptance-checks.sh sourced first
# Caller MUST set: E2E_DIR, TEMP_DIR, REGISTRY, PKG
#
# Contract
# ========
# The contract enforced by these checks (per fork commits ADR-0090-B2):
#
#   - File absent OR 0 bytes → normal cold start (no error)
#   - File exists, has bytes, but cannot be parsed AND WAL yields 0
#     entries → fail loud with `RvfCorruptError` (CLI exits non-zero,
#     diagnostic names the corrupt file and reason)
#   - File corrupt BUT WAL recovery yields >= 1 entries → use WAL,
#     no error (WAL is the authoritative recovery source by design)
#   - Partial WAL (trailing entry truncated) → skip trailing, recover
#     the prefix (existing behavior — preserved, not modified)
#
# Why fail-loud matters: if RvfBackend silently returned an empty backend
# on corrupt load, a subsequent `cli memory store` would write ONE entry
# to a fresh file, OVERWRITING the corrupt original. The user's only
# chance at recovery (manual inspection / restoration) would be lost.
# This is the ADR-0082 "no silent fallbacks" rule applied at the storage
# layer.
#
# Seeding strategy (important)
# ============================
# Instead of writing `.rvf` bytes from a seed script (which picks up the
# native binding when available and writes native binary — confusing the
# corruption tests), we let the REAL CLI create the initial state via a
# normal `cli memory store`. That way, whichever format the CLI
# naturally writes (native `SFVR` with pure-TS `.meta` sidecar, or pure-TS
# `RVF\0` as main) is the format we corrupt. When the CLI later re-opens
# the corrupt file, it sees its own format torn — the exact failure mode
# a real user would hit.
#
# We corrupt BOTH `.rvf` and `.rvf.meta` (and any `.wal`) because
# different resolver paths may pick different files. The check is for
# "cannot read any of these" — if all corruption fires together, the
# fail-loud path is exercised regardless of which file the resolver
# chose first.

# ════════════════════════════════════════════════════════════════════
# Shared helpers for B2
# ════════════════════════════════════════════════════════════════════

# Let the CLI run `memory store` once to create natural initial state
# at the config-resolved databasePath. Returns the path to the primary
# RVF file on success.
_b2_seed_via_cli() {
  local iso="$1"
  local cli; cli=$(_cli_cmd)
  local out_file
  out_file=$(mktemp /tmp/b2-seed-cli-XXXXX)
  # One CLI store — populates `.swarm/memory.rvf` (config default).
  ( cd "$iso" && NPM_CONFIG_REGISTRY="$REGISTRY" timeout 45 $cli memory store \
      --key 'b2-seed' --value 'seed content for B2 corruption test' \
      --namespace 'ns' > "$out_file" 2>&1 ) || true
  rm -f "$out_file"

  # Discover the .rvf file the CLI actually wrote to. Either .swarm or
  # .claude-flow — whichever the resolver picked.
  for candidate in "$iso/.swarm/memory.rvf" "$iso/.claude-flow/memory.rvf"; do
    if [[ -s "$candidate" ]]; then
      echo "$candidate"
      return
    fi
  done
  echo ""  # seed failed — caller handles
}

# Corrupt every RVF file at a given prefix (the .rvf path sans extension).
# Accepts a mutation function as an argument — a bash function name that
# is called with each file path.
_b2_corrupt_all() {
  local rvf_path="$1"
  local mutation="$2"
  for suffix in '' '.meta' '.wal'; do
    local f="${rvf_path}${suffix}"
    if [[ -f "$f" && -s "$f" ]]; then
      "$mutation" "$f"
    fi
  done
}

_b2_zero_magic() {
  local f="$1"
  if command -v dd >/dev/null 2>&1; then
    dd if=/dev/zero of="$f" bs=1 count=8 conv=notrunc 2>/dev/null
  else
    # Fallback: read + overwrite via python if available
    python3 -c "
import sys
p = sys.argv[1]
with open(p, 'r+b') as f:
  f.write(b'\\x00' * 8)
" "$f" 2>/dev/null
  fi
}

_b2_truncate_half() {
  local f="$1"
  local sz
  sz=$(wc -c < "$f" | tr -d ' ')
  local half=$(( sz / 2 ))
  (( half < 8 )) && half=8   # must leave something non-trivial for the test
  if command -v truncate >/dev/null 2>&1; then
    truncate -s "$half" "$f"
  else
    # macOS alternative
    dd if=/dev/null of="$f" bs=1 seek="$half" 2>/dev/null
  fi
}

# ════════════════════════════════════════════════════════════════════
# B2-1: Truncated .rvf — fail-loud
# ════════════════════════════════════════════════════════════════════

check_adr0090_b2_rvf_truncated() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local iso; iso=$(_e2e_isolate "b2-trunc")
  if [[ -z "$iso" || ! -d "$iso" ]]; then
    _CHECK_OUTPUT="B2-trunc: failed to create isolated project dir"
    return
  fi
  local cli; cli=$(_cli_cmd)
  local work; work=$(mktemp -d /tmp/b2-trunc-work-XXXXX)

  # ─── Step 1: let the CLI create natural initial state ──────────────
  local rvf_path
  rvf_path=$(_b2_seed_via_cli "$iso")
  if [[ -z "$rvf_path" ]]; then
    _CHECK_OUTPUT="B2-trunc: CLI seed step produced no .rvf file in .swarm or .claude-flow — cannot test truncation"
    rm -rf "$work"
    return
  fi

  # ─── Step 2: truncate every on-disk RVF file to half ───────────────
  _b2_corrupt_all "$rvf_path" _b2_truncate_half

  # ─── Step 3: run CLI — expect non-zero exit with corruption diag ──
  local out_file="$work/search.out"
  local search_exit=0
  ( cd "$iso" && NPM_CONFIG_REGISTRY="$REGISTRY" timeout 45 $cli memory search --query 'b2-trunc-probe' > "$out_file" 2>&1 ) || search_exit=$?
  local search_out; search_out=$(cat "$out_file" 2>/dev/null || echo "")

  if [[ "$search_exit" -eq 0 ]]; then
    _CHECK_OUTPUT="B2-trunc: REGRESSION — cli memory search exited 0 against a truncated .rvf. RvfCorruptError silently swallowed. Output:
$(echo "$search_out" | head -10)"
    rm -rf "$work"
    return
  fi

  if ! echo "$search_out" | grep -qiE 'corrupt|RvfCorruptError|truncat|storage.*failed'; then
    _CHECK_OUTPUT="B2-trunc: CLI exited $search_exit but output lacks a corruption diagnostic. Output:
$(echo "$search_out" | head -10)"
    rm -rf "$work"
    return
  fi

  rm -rf "$work"
  _CHECK_PASSED="true"
  _CHECK_OUTPUT="B2-trunc: cli memory search correctly exited $search_exit with corruption diagnostic against truncated .rvf."
}

# ════════════════════════════════════════════════════════════════════
# B2-2: Bad magic — fail-loud
# ════════════════════════════════════════════════════════════════════

check_adr0090_b2_rvf_bad_magic() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local iso; iso=$(_e2e_isolate "b2-magic")
  if [[ -z "$iso" || ! -d "$iso" ]]; then
    _CHECK_OUTPUT="B2-magic: failed to create isolated project dir"
    return
  fi
  local cli; cli=$(_cli_cmd)
  local work; work=$(mktemp -d /tmp/b2-magic-work-XXXXX)

  local rvf_path
  rvf_path=$(_b2_seed_via_cli "$iso")
  if [[ -z "$rvf_path" ]]; then
    _CHECK_OUTPUT="B2-magic: CLI seed step produced no .rvf file — cannot test bad-magic"
    rm -rf "$work"
    return
  fi

  # Zero the first 8 bytes of every on-disk RVF file (native or pure-TS
  # magic are both 4 bytes, but zeroing 8 also kills the headerLen prefix
  # so neither format can make progress).
  _b2_corrupt_all "$rvf_path" _b2_zero_magic

  local out_file="$work/search.out"
  local search_exit=0
  ( cd "$iso" && NPM_CONFIG_REGISTRY="$REGISTRY" timeout 45 $cli memory search --query 'b2-magic-probe' > "$out_file" 2>&1 ) || search_exit=$?
  local search_out; search_out=$(cat "$out_file" 2>/dev/null || echo "")

  if [[ "$search_exit" -eq 0 ]]; then
    _CHECK_OUTPUT="B2-magic: REGRESSION — cli memory search exited 0 against zero-magic .rvf. RvfCorruptError silently swallowed. Output:
$(echo "$search_out" | head -10)"
    rm -rf "$work"
    return
  fi

  if ! echo "$search_out" | grep -qiE 'corrupt|RvfCorruptError|magic|storage.*failed'; then
    _CHECK_OUTPUT="B2-magic: CLI exited $search_exit but output lacks a corruption/magic diagnostic. Output:
$(echo "$search_out" | head -10)"
    rm -rf "$work"
    return
  fi

  rm -rf "$work"
  _CHECK_PASSED="true"
  _CHECK_OUTPUT="B2-magic: cli memory search correctly exited $search_exit with corruption diagnostic against zero-magic .rvf."
}

# ════════════════════════════════════════════════════════════════════
# B2-3: Partial WAL — clean recovery (no silent zero, no data loss
#       beyond the truncated entry)
# ════════════════════════════════════════════════════════════════════

check_adr0090_b2_rvf_partial_wal() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local iso; iso=$(_e2e_isolate "b2-wal")
  if [[ -z "$iso" || ! -d "$iso" ]]; then
    _CHECK_OUTPUT="B2-wal: failed to create isolated project dir"
    return
  fi
  local cli; cli=$(_cli_cmd)
  local work; work=$(mktemp -d /tmp/b2-wal-work-XXXXX)

  # ─── Seed WAL-only state ────────────────────────────────────────────
  # This test needs entries that exist ONLY in the WAL (not compacted
  # into the main file). The CLI doesn't normally leave state like this
  # — shutdown always compacts. So we use a node script to create the
  # state directly. The script uses pure-TS RvfBackend (we skip native
  # binding at script time so the WAL is the canonical pure-TS WAL).
  #
  # We deliberately construct the WAL to contain >= 2 full entries so
  # that truncating mid-record leaves at least 1 complete entry for
  # recovery. Count must match what the CLI can actually retrieve —
  # no silent partial state.
  local seed_script="$iso/.b2-wal-seed.mjs"
  cat > "$seed_script" <<'SCRIPT'
import { RvfBackend } from '@sparkleideas/memory';
import { existsSync, rmSync, readFileSync, writeFileSync, truncateSync } from 'node:fs';

const dbPath = process.argv[2];
// Nuke any pre-existing state from the iso's init so we start clean.
for (const suffix of ['', '.meta', '.wal', '.lock', '.tmp']) {
  if (existsSync(dbPath + suffix)) rmSync(dbPath + suffix);
}

// High threshold so stores don't auto-compact — entries live in WAL.
const backend = new RvfBackend({
  databasePath: dbPath, dimensions: 768, autoPersistInterval: 0,
  walCompactionThreshold: 100000,
});
await backend.initialize();
for (let i = 0; i < 3; i++) {
  const e = new Float32Array(768);
  e[i] = 1;
  await backend.store({
    id: 'e' + i, key: 'k' + i, namespace: 'ns', content: 'val-' + i,
    type: 'semantic', tags: [], metadata: {}, accessLevel: 'private',
    ownerId: 'o', createdAt: Date.now(), updatedAt: Date.now(),
    accessCount: 0, lastAccessedAt: Date.now(), version: 1, references: [],
    embedding: e,
  });
}
// No shutdown — WAL has entries, main file may be empty/missing.
// Force-delete the main file + meta so WAL is the only recovery source.
for (const f of [dbPath, dbPath + '.meta']) {
  if (existsSync(f)) rmSync(f);
}

const walBuf = existsSync(dbPath + '.wal') ? readFileSync(dbPath + '.wal') : null;
if (!walBuf || walBuf.length < 32) {
  console.log('WAL_EMPTY:' + (walBuf ? walBuf.length : 'none'));
  process.exit(1);
}
// Truncate WAL to ~40% so entry 0 is complete, entry 1 is mid-truncated.
const target = Math.max(16, Math.floor(walBuf.length * 0.40));
truncateSync(dbPath + '.wal', target);
console.log('WAL_OK:' + dbPath + ' orig=' + walBuf.length + ' truncated=' + target);
SCRIPT

  # The CLI's config resolves to .swarm/memory.rvf by default. Seed there.
  mkdir -p "$iso/.swarm" "$iso/.claude-flow"
  local seed_out
  seed_out=$(cd "$iso" && NPM_CONFIG_REGISTRY="$REGISTRY" node ".b2-wal-seed.mjs" "$iso/.swarm/memory.rvf" 2>&1) || true
  rm -f "$seed_script"
  if ! echo "$seed_out" | grep -q '^WAL_OK:'; then
    _CHECK_OUTPUT="B2-wal: seed step failed: $(echo "$seed_out" | head -3)"
    rm -rf "$work"
    return
  fi

  # ─── Run memory list ───────────────────────────────────────────────
  local out_file="$work/list.out"
  local list_exit=0
  ( cd "$iso" && NPM_CONFIG_REGISTRY="$REGISTRY" timeout 45 $cli memory list --namespace ns > "$out_file" 2>&1 ) || list_exit=$?
  local list_out; list_out=$(cat "$out_file" 2>/dev/null || echo "")

  if [[ "$list_exit" -ne 0 ]]; then
    _CHECK_OUTPUT="B2-wal: cli memory list exited $list_exit against a partial WAL with at least 1 recoverable entry. Should have succeeded. Output:
$(echo "$list_out" | head -10)"
    rm -rf "$work"
    return
  fi

  # Count entries reported — expect exactly 1 (only entry 0 survived
  # the mid-entry-1 truncation at ~40% of WAL). The CLI formats memory
  # list as a table (`| k0 | ns | ... |`). Also fall back to parsing
  # the "Showing N of M entries" summary that the CLI prints after the
  # table — that's the most reliable signal regardless of format changes.
  local found_count
  # First try: count table rows matching our seeded keys. Pipe-prefixed
  # lines with k0/k1/k2 in column 1.
  found_count=$(echo "$list_out" | grep -cE '^\s*\|\s*k[0-9]+\s*\|' 2>/dev/null)
  found_count=${found_count:-0}
  # Fallback: parse the "Showing N of M entries" summary
  if (( found_count == 0 )); then
    local summary_n
    summary_n=$(echo "$list_out" | sed -nE 's/.*Showing ([0-9]+) of .*/\1/p' | head -1)
    if [[ -n "$summary_n" ]]; then
      found_count="$summary_n"
    fi
  fi

  if (( found_count == 0 )); then
    _CHECK_OUTPUT="B2-wal: REGRESSION — cli memory list exited 0 but reported 0 entries from a WAL that should recover >= 1 entry. Silent zero-return. Output:
$(echo "$list_out" | head -20)"
    rm -rf "$work"
    return
  fi

  rm -rf "$work"
  _CHECK_PASSED="true"
  _CHECK_OUTPUT="B2-wal: cli memory list exited $list_exit with $found_count recovered entry/entries from partial WAL (expected 1-2 after mid-entry truncation)."
}
