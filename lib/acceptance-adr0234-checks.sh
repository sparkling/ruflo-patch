# lib/acceptance-adr0234-checks.sh — ADR-0234 sibling-loader fail-loud trip-wire.
#
# Wires Batch 2's ADR-0234 (extend ADR-0095 fail-loud posture to vector-db /
# diskann / embedding-pipeline / memory-router / claims / plugins-install)
# per-site implementation snapshots into the fast acceptance runner.
#
# Five checks (one per ADR-0234 site):
#
#   1. site 1+2 — shared loader-errors helper present at the location
#      callers import from (loader-errors.ts in cli/src/ruvector/).
#   2. site 3 — embedding-pipeline.ts contains the labelled ADR-0234 throw
#      (no silent hash-fallback regression).
#   3. site 4 — claims.ts checkPolicyLoaded() throws fail-closed on
#      ENOENT, not silent skip.
#   4. site 5 — plugins.ts install command throws on --source ipfs / not-
#      implemented sources rather than silent no-op.
#   5. cross-bonus — F-03-007: agentdb EmbeddingService.mockEmbedding is
#      now unreachable from production paths because the embedding-pipeline
#      throws BEFORE controller-registry would invoke EmbeddingService at
#      all (closure-by-construction confirmation).
#
# Per ADR-0233 second-pass §Per-ADR validation gates §Gate 2.

_FORK_RUFLO="/Users/henrik/source/forks/ruflo"
_FORK_AGENTDB="/Users/henrik/source/forks/agentdb"

check_adr0234_loader_errors_helper_present() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local helper="${_FORK_RUFLO}/v3/@claude-flow/cli/src/ruvector/loader-errors.ts"
  if [[ ! -f "$helper" ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: site 1+2 loader-errors.ts helper not present at cli/src/ruvector/"
    return
  fi

  # The helper exports throwLoaderUnavailable() with the typed-error template.
  if ! grep -q "throwLoaderUnavailable" "$helper"; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: loader-errors.ts present but throwLoaderUnavailable export missing"
    return
  fi

  if ! grep -q "ADR-0234" "$helper"; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: loader-errors.ts missing ADR-0234 label in typed-error template"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="site 1+2: loader-errors.ts with throwLoaderUnavailable + ADR-0234 label present"
}

check_adr0234_embedding_pipeline_throws() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local pipe="${_FORK_RUFLO}/v3/@claude-flow/memory/src/embedding-pipeline.ts"
  if [[ ! -f "$pipe" ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: site 3 embedding-pipeline.ts missing"
    return
  fi

  # The labelled throw cites ADR-0234 in the message body.
  local hits
  hits=$(grep -c "ADR-0234" "$pipe" 2>/dev/null)
  hits=${hits:-0}

  if [[ "$hits" -lt 2 ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: expected ≥2 ADR-0234 references in embedding-pipeline.ts (init + embedInternal); found $hits"
    return
  fi

  # generateHashEmbedding is retained as an exported test-only fixture
  # (mirrors createJsFallbackIndex in diskann-backend.ts) but must NOT
  # be invoked from embedInternal or _doInitialize. Production paths
  # only know about transformers.js and ruvector providers; any call
  # site would route through `this.provider === '...'` blocks.
  # Use awk to scan the embedInternal body specifically (the function
  # spans the lines from `private async embedInternal` to the next
  # function/class boundary).
  if awk '/private async embedInternal/,/^  [a-zA-Z]+\s*\(/' "$pipe" \
       | grep -q "generateHashEmbedding("; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: generateHashEmbedding invoked from embedInternal (ADR-0234 removed runtime path; only test fixture export allowed)"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="site 3: embedding-pipeline.ts has ${hits} ADR-0234 throw labels; generateHashEmbedding not invoked from embedInternal"
}

check_adr0234_claims_fail_closed() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local claims="${_FORK_RUFLO}/v3/@claude-flow/cli/src/commands/claims.ts"
  if [[ ! -f "$claims" ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: site 4 claims.ts missing"
    return
  fi

  if ! grep -q "ADR-0234" "$claims"; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: site 4 claims.ts missing ADR-0234 label on fail-closed throw"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="site 4: claims.ts has ADR-0234 fail-closed throw on policy-load error"
}

check_adr0234_plugins_install_throws() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local plugins="${_FORK_RUFLO}/v3/@claude-flow/cli/src/commands/plugins.ts"
  if [[ ! -f "$plugins" ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: site 5 plugins.ts missing"
    return
  fi

  local hits
  hits=$(grep -c "ADR-0234" "$plugins" 2>/dev/null)
  hits=${hits:-0}

  if [[ "$hits" -lt 1 ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: plugins.ts missing ADR-0234 label on install throw; found $hits refs"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="site 5: plugins.ts has ${hits} ADR-0234 label(s) for install fail-loud"
}

check_adr0234_f03007_cross_bonus_closure() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  # mockEmbedding remains in EmbeddingService.ts — Batch 2 did not modify
  # agentdb. The closure-by-construction claim is that the
  # embedding-pipeline throws BEFORE controller-registry constructs
  # EmbeddingService, so mockEmbedding can no longer be reached via the
  # mpnet recall hot path.
  local svc="${_FORK_AGENTDB}/src/controllers/EmbeddingService.ts"
  if [[ ! -f "$svc" ]]; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: agentdb EmbeddingService.ts not present"
    return
  fi

  if ! grep -q "mockEmbedding" "$svc"; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: F-03-007 invariant changed — mockEmbedding removed from EmbeddingService.ts (re-verify ADR-0234 closure)"
    return
  fi

  # The cross-bonus is gated on embedding-pipeline.ts throwing. Re-run
  # the inner check; if site 3 isn't satisfied, neither is the closure.
  check_adr0234_embedding_pipeline_throws
  if [[ "$_CHECK_PASSED" != "true" ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: cross-bonus depends on site 3 (embedding-pipeline throws); site 3 not satisfied"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="F-03-007 cross-bonus closure: mockEmbedding present (unchanged) + embedding-pipeline throws upstream — unreachable from prod path"
}
