#!/usr/bin/env bash
# lib/acceptance-adr0300-checks.sh — ADR-0300 dangling-optional-dep gate.
#
# Asserts the PUBLISHED @sparkleideas/ruflo@latest dependency graph contains no
# @sparkleideas/* reference that fails to resolve on the registry.
#
# A dangling @sparkleideas/* optionalDependency — an unpublished napi platform
# binary (…-darwin-arm64, …-win32-x64-msvc) or pure sub-package (rvf-solver,
# rvf-wasm, diskann), minted by the codemod's @ruvector/* → @sparkleideas/
# ruvector-* rewrite — is the npm/arborist "empty-version dedup" landmine. It is
# harmless while EVERY such optional 404s (npm skips a lone unresolvable
# optional), but it bricks `npx @sparkleideas/ruflo` the instant a peer optional
# resolves: npm places the peer, runs pruneDedupable, walks into the empty-
# version placeholder nodes, and throws `Invalid Version` — aborting the whole
# install (MCP fails to start, -32000). See ADR-0300.
#
# This gate is timing-INDEPENDENT: it fails on the dangling ref itself, not on
# whether the trigger optional happens to be published yet. That is the point —
# the 2026-06-04 release PASSED acceptance and detonated hours later when the
# rabitq-wasm stub (ADR-0294 R3) shipped and became the trigger. An install-
# based check would have gone green at release time and missed it.
#
# Caller MUST set: PROJECT_DIR. Uses REGISTRY (defaults to localhost:4873).

check_adr0300_no_dangling_optional_deps() {
  local registry="${REGISTRY:-http://localhost:4873}"
  local log
  log="$(mktemp /tmp/ruflo-adr0300-XXXXX.log)"
  _CHECK_PASSED="false"

  if node "${PROJECT_DIR}/scripts/sanitize-internal-optional-deps.mjs" \
        check-published "@sparkleideas/ruflo@latest" --registry "$registry" \
        > "$log" 2>&1; then
    rm -f "$log"
    _CHECK_PASSED="true"
    return 0
  fi

  # Failure — surface the first few offending refs (greppable; full log kept).
  local detail
  detail="$(grep -E '→' "$log" 2>/dev/null | head -6 | sed 's/^[[:space:]]*//' | tr '\n' ';')"
  detail="${detail:-see ${log}}"
  _CHECK_OUTPUT="ADR-0300: @sparkleideas/ruflo@latest references unresolvable @sparkleideas/* dep(s) → ${detail} (full log: ${log})"
  return 1
}
