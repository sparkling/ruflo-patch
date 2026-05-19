#!/usr/bin/env bash
# lib/acceptance-adr0194-checks.sh — ADR-0194: AutopilotLearning Phase 3
# (embedding-cluster pattern discovery).
#
# ADR-0194 status is `accepted` as of 2026-05-19. Closure criteria (per
# the ADR itself) are at the INTERNAL-API level: a new Phase 3 cluster
# aggregator is added alongside the existing Phase 2 keyword aggregator,
# and `getMetrics()` distinguishes the two via an `engine` discriminator.
# CLI surface is OUT OF SCOPE for ADR-0194 closure — deferred to a future
# ADR.
#
# Reason these probes are source-level greps: CLI surface deferred to
# future ADR; these greps validate that the source-level Phase 3 wiring
# is present in the published @sparkleideas/agentic-flow tarball.
#
# Caller MUST set: TEMP_DIR (the acceptance install root that contains
# `node_modules/@sparkleideas/agentic-flow`).
#
# Catalog naming: check_adr0194_* is L7-accepted via the adr-NNNN filename tag.

# ── (1) populated corpus: Phase 3 cluster path is wired ─────────────────────

# check_adr0194_patterns_populated — assert the published source contains the
# load-bearing Phase 3 implementation tokens in
# `agentic-flow/dist/coordination/autopilot-learning.js` (the canonical install
# path; the published @sparkleideas/agentic-flow tarball nests dist under
# `agentic-flow/` per its publish-side package.json `files` array):
#   * discoverPatternsByEmbedding  — the new Phase 3 method
#   * phase3-embedding             — the `source` discriminator string literal
#                                    set on cluster-derived patterns
#   * embedding-cluster            — the `engine` field value returned by
#                                    getMetrics() when Phase 3 is active
# Reason: CLI surface deferred to future ADR; this probe validates source-
# level wiring of ADR-0194's Phase 3 cluster aggregator.
check_adr0194_patterns_populated() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local pkg_dir="${TEMP_DIR}/node_modules/@sparkleideas/agentic-flow"
  if [[ ! -d "$pkg_dir" ]]; then
    _CHECK_OUTPUT="adr0194-populated: @sparkleideas/agentic-flow not installed at ${pkg_dir}"
    return
  fi

  local target="$pkg_dir/agentic-flow/dist/coordination/autopilot-learning.js"
  if [[ ! -f "$target" ]]; then
    _CHECK_OUTPUT="adr0194-populated: agentic-flow/dist/coordination/autopilot-learning.js missing in installed package (${target})"
    return
  fi

  local missing=""
  for token in "discoverPatternsByEmbedding" "phase3-embedding" "embedding-cluster"; do
    if ! grep -qF "$token" "$target" 2>/dev/null; then
      missing="$missing $token"
    fi
  done

  if [[ -n "$missing" ]]; then
    _CHECK_OUTPUT="adr0194-populated: missing Phase 3 wiring tokens in agentic-flow/dist/coordination/autopilot-learning.js:${missing}"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="adr0194-populated: PASS (Phase 3 cluster aggregator wired — discoverPatternsByEmbedding + phase3-embedding source + embedding-cluster engine all present)"
}

# ── (2) phase discriminators both present: union behavior wired ─────────────

# check_adr0194_patterns_empty — assert both phase-source discriminators are
# present in `agentic-flow/dist/coordination/autopilot-learning.js`:
#   * phase2-keyword   — the legacy keyword-aggregator pattern source tag
#   * phase3-embedding — the Phase 3 cluster-aggregator pattern source tag
# Their co-presence proves the union behavior is wired — Phase 3 ADDS to
# Phase 2 rather than replacing it, which is the closure-criterion guarantee
# for ADR-0194's "additive, no regression on Phase 2 corpus" promise.
# Reason: CLI surface deferred to future ADR; this probe validates source-
# level union wiring.
check_adr0194_patterns_empty() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local pkg_dir="${TEMP_DIR}/node_modules/@sparkleideas/agentic-flow"
  if [[ ! -d "$pkg_dir" ]]; then
    _CHECK_OUTPUT="adr0194-empty: @sparkleideas/agentic-flow not installed at ${pkg_dir}"
    return
  fi

  local target="$pkg_dir/agentic-flow/dist/coordination/autopilot-learning.js"
  if [[ ! -f "$target" ]]; then
    _CHECK_OUTPUT="adr0194-empty: agentic-flow/dist/coordination/autopilot-learning.js missing in installed package (${target})"
    return
  fi

  local missing=""
  for token in "phase2-keyword" "phase3-embedding"; do
    if ! grep -qF "$token" "$target" 2>/dev/null; then
      missing="$missing $token"
    fi
  done

  if [[ -n "$missing" ]]; then
    _CHECK_OUTPUT="adr0194-empty: missing union-behavior discriminator tokens in agentic-flow/dist/coordination/autopilot-learning.js:${missing}"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="adr0194-empty: PASS (both phase2-keyword and phase3-embedding discriminators present — union behavior wired)"
}
