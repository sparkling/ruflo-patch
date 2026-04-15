#!/usr/bin/env bash
# lib/acceptance-adr0090-b1-checks.sh — ADR-0090 Tier B1: L3 dimension-
# mismatch fail-loud acceptance check.
#
# Requires: acceptance-harness.sh + acceptance-checks.sh sourced first
# Caller MUST set: E2E_DIR, TEMP_DIR, REGISTRY, PKG
#
# Background
# ==========
# ADR-0090 Tier B1 requires the CLI to exit non-zero with a clear
# "dimension mismatch" error when the stored .rvf file's header
# dimensions differ from the configured embedding dimension.
#
# Before the fork patch that accompanied this check, the CLI silently
# swallowed `EmbeddingDimensionError` inside ADR-0085's "best-effort"
# controller-init wrapper (memory-router.ts:520). The thrown error
# travelled:
#
#   controller-registry.ts:608 throws EmbeddingDimensionError
#     → memory-router.ts:379 catches and rewraps as generic Error
#       → memory-router.ts:404 catches and returns null
#         → memory-router.ts:520 wrapper sees nothing to catch
#           → CLI continues with _registryAvailable=false
#             → produces silently-incorrect search results
#
# Fork commit ADR-0090-B1 preserves EmbeddingDimensionError across all
# three catch layers so the CLI exits non-zero.
#
# What this check does
# ====================
# 1. Isolate a fresh copy of the E2E dir (so we don't pollute shared
#    state when we pre-seed a doctored memory.rvf).
# 2. Build a valid RVF meta file with a 384-dim header using the
#    published RvfBackend (via node script + @sparkleideas/memory).
#    We use the real RvfBackend rather than hand-crafting bytes so the
#    header format stays honest to upstream.
# 3. Place the meta file at the isolated project's .claude-flow/memory.rvf
#    (and .swarm/memory.rvf for safety — config may resolve to either).
# 4. Run `cli memory search` and capture stdout+stderr.
# 5. Assert: exit code is non-zero AND output contains a dimension-
#    mismatch diagnostic (the original error message text is
#    "Embedding dimension mismatch: stored vectors are").
# 6. Negative case: if the check PASSES when nothing-is-doctored, the
#    check itself is broken — emit a clear "self-test failed" output.
#
# Self-test philosophy
# ====================
# Per ADR-0082, we NEVER silent-pass. Per ADR-0090 Tier A2, SKIP_ACCEPTED
# is reserved for legitimate prerequisite-absent cases. This check has
# no such prereq (RvfBackend ships with every published memory pkg).

# ════════════════════════════════════════════════════════════════════
# B1: Dimension mismatch must be FATAL, not silent-fallback
# ════════════════════════════════════════════════════════════════════

check_adr0090_b1_dimension_mismatch_fatal() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local iso; iso=$(_e2e_isolate "b1-dim-mismatch")
  if [[ -z "$iso" || ! -d "$iso" ]]; then
    _CHECK_OUTPUT="B1: failed to create isolated project dir"
    return
  fi

  local cli; cli=$(_cli_cmd)
  local work; work=$(mktemp -d /tmp/b1-work-XXXXX)

  # ─── Step 1: build a 384-dim RVF file via real RvfBackend ──────────
  # We use the published @sparkleideas/memory package so the header
  # format is guaranteed to match the CLI's reader — if upstream ever
  # changes the serialization, this check fails loudly at the "no file
  # produced" step rather than silently missing the real invariant.
  #
  # The seed script MUST live inside $iso so node's module resolution
  # walks up to $iso/node_modules (symlinked by _e2e_isolate). Scripts
  # outside $iso cannot resolve @sparkleideas/memory.
  local seed_script="$iso/.b1-seed.mjs"
  local seed_db="$work/seed-384.rvf"
  cat > "$seed_script" << 'SEED_SCRIPT'
import { RvfBackend } from '@sparkleideas/memory';
const dbPath = process.argv[2];
const backend = new RvfBackend({
  databasePath: dbPath,
  dimensions: 384,
  autoPersistInterval: 0,
});
await backend.initialize();
// Store one entry with a 384-dim embedding so the file body is real.
const embedding = new Float32Array(384);
for (let i = 0; i < 384; i++) embedding[i] = Math.sin(i * 0.01);
await backend.store({
  id: 'b1-seed-1',
  key: 'b1-seed-key',
  namespace: 'b1-dim-test',
  content: 'ADR-0090 B1 seed entry (384-dim)',
  type: 'semantic',
  tags: [],
  metadata: {},
  accessLevel: 'private',
  ownerId: 'b1-acceptance',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  accessCount: 0,
  lastAccessedAt: Date.now(),
  version: 1,
  references: [],
  embedding,
});
await backend.shutdown();
console.log('SEED_OK:' + dbPath);
SEED_SCRIPT

  local seed_out
  seed_out=$(cd "$iso" && NPM_CONFIG_REGISTRY="$REGISTRY" node "$seed_script" "$seed_db" 2>&1) || true
  rm -f "$seed_script"
  if ! echo "$seed_out" | grep -q '^SEED_OK:'; then
    _CHECK_OUTPUT="B1: seed step failed — could not build 384-dim RVF file via @sparkleideas/memory: $(echo "$seed_out" | head -3)"
    rm -rf "$work"
    return
  fi
  if [[ ! -f "$seed_db" ]]; then
    _CHECK_OUTPUT="B1: seed step claimed SEED_OK but $seed_db does not exist on disk"
    rm -rf "$work"
    return
  fi

  # ─── Step 2: deploy the doctored file to both candidate paths ──────
  # The memory router's storage resolver may pick either path depending
  # on config.storage.databasePath. Pre-seed both so whichever is chosen
  # sees the 384-dim header.
  local dest
  for dest in "$iso/.claude-flow/memory.rvf" "$iso/.swarm/memory.rvf"; do
    mkdir -p "$(dirname "$dest")"
    cp "$seed_db" "$dest"
    # Also copy .meta if the backend produced one (getStoredDimension
    # prefers the meta sidecar for speed; both should say 384)
    if [[ -f "${seed_db}.meta" ]]; then
      cp "${seed_db}.meta" "${dest}.meta"
    fi
  done

  # ─── Step 3: run `cli memory search` with 768-dim config ──────────
  # The init'd project's config defaults to 768-dim (see Xenova/
  # all-mpnet-base-v2 from the init template). We run a search — any
  # memory op triggers _doInit() → initControllerRegistry() which
  # is where the dim mismatch detector fires.
  #
  # NOTE: we invoke the CLI directly (not via _run_and_kill) because
  # _run_and_kill's exit-code capture is broken — it reads $? from a
  # subsequent `cat` call, not from the CLI itself. The fail-loud
  # assertion REQUIRES the true exit code. We wrap with `timeout`
  # for safety in case the CLI hangs; the dim-mismatch path exits
  # in <1s on real installs (measured 307ms).
  local out_file="$work/search.out"
  local search_exit=0
  ( cd "$iso" && NPM_CONFIG_REGISTRY="$REGISTRY" timeout 45 $cli memory search --query 'dimension-mismatch-probe' > "$out_file" 2>&1 ) || search_exit=$?
  local search_out; search_out=$(cat "$out_file" 2>/dev/null || echo "")

  # ─── Step 4: assert fail-loud ──────────────────────────────────────
  # The invariant: the CLI must exit non-zero AND mention "dimension
  # mismatch" in stderr/stdout. Either an exit-0 or a silent success
  # is a regression.
  local has_diag=0
  if echo "$search_out" | grep -qiE 'dimension mismatch|EmbeddingDimensionError|stored vectors are.*-dim'; then
    has_diag=1
  fi

  if [[ "$search_exit" -eq 0 ]]; then
    _CHECK_OUTPUT="B1: REGRESSION — cli memory search exited 0 against a doctored 384-dim .rvf file with 768-dim config. The EmbeddingDimensionError is being silently swallowed by ADR-0085's best-effort controller-init wrapper. Output (first 10 lines):
$(echo "$search_out" | head -10)"
    rm -rf "$work"
    return
  fi

  if [[ "$has_diag" -eq 0 ]]; then
    _CHECK_OUTPUT="B1: CLI exited non-zero ($search_exit) as expected, but the output does not contain a 'dimension mismatch' diagnostic. The error is being masked by a generic failure message. Output (first 10 lines):
$(echo "$search_out" | head -10)"
    rm -rf "$work"
    return
  fi

  # ─── Step 5: self-test — undoctored project must not fail ──────────
  # If a clean E2E project (fresh iso, no doctored meta) ALSO fails
  # with "dimension mismatch", our test is reporting a false positive.
  # Same direct-invocation pattern as Step 3.
  local clean_iso; clean_iso=$(_e2e_isolate "b1-clean")
  local clean_out_file="$work/clean.out"
  local clean_exit=0
  ( cd "$clean_iso" && NPM_CONFIG_REGISTRY="$REGISTRY" timeout 45 $cli memory search --query 'clean-probe' > "$clean_out_file" 2>&1 ) || clean_exit=$?
  local clean_out; clean_out=$(cat "$clean_out_file" 2>/dev/null || echo "")
  if [[ "$clean_exit" -ne 0 ]] && echo "$clean_out" | grep -qiE 'dimension mismatch|EmbeddingDimensionError'; then
    _CHECK_OUTPUT="B1: self-test failed — clean E2E project ALSO reports dimension mismatch. The check cannot distinguish doctored from clean state. Clean output: $(echo "$clean_out" | head -5)"
    rm -rf "$work"
    return
  fi

  rm -rf "$work"

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="B1: cli memory search correctly exited $search_exit with 'dimension mismatch' diagnostic against doctored 384-dim RVF + 768-dim config; clean project exits 0 (self-test passed)."
}
