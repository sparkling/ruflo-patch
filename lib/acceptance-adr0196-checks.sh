#!/usr/bin/env bash
# lib/acceptance-adr0196-checks.sh — ADR-0196: AutopilotLearning Phase 5
# (federated learning interface — runtime deferred).
#
# ADR-0196 status is `accepted` as of 2026-05-19. Closure criteria are at
# the INTERNAL-API level: the FederatedSyncProvider interface is
# implemented (Noop default + SyncCoordinator adapter) and episode
# metadata carries `originInstallId` + `vectorClock` for cross-install
# disambiguation. CLI surface is OUT OF SCOPE for ADR-0196 closure —
# deferred to a future ADR.
#
# Reason these probes are source-level greps: CLI surface deferred to
# future ADR; these greps validate that the source-level FederatedSync
# interface + episode-identity wiring are present in the published
# @sparkleideas/agentic-flow tarball.
#
# Caller MUST set: TEMP_DIR (the acceptance install root that contains
# `node_modules/@sparkleideas/agentic-flow`).
#
# Catalog naming: check_adr0196_* is L7-accepted via the adr-NNNN filename tag.

# ── (1) FederatedSyncProvider interface present in source ───────────────────

# check_adr0196_federation_status_interface — assert the FederatedSyncProvider
# interface and its two reference implementations are present in the
# published source (the published @sparkleideas/agentic-flow tarball nests
# dist under `agentic-flow/` per its publish-side package.json `files`
# array):
#   * agentic-flow/dist/services/federated-sync-provider.js
#       — FederatedSyncProvider (the interface symbol)
#       — NoopFederatedSyncProvider (the default no-op impl)
#   * agentic-flow/dist/services/sync-coordinator-federated-adapter.js
#       — SyncCoordinatorFederatedAdapter (the SyncCoordinator-backed impl)
#
# Reason: CLI surface deferred to future ADR; this probe validates source-
# level wiring of ADR-0196's federation interface.
check_adr0196_federation_status_interface() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local pkg_dir="${TEMP_DIR}/node_modules/@sparkleideas/agentic-flow"
  if [[ ! -d "$pkg_dir" ]]; then
    _CHECK_OUTPUT="adr0196-fed-status: @sparkleideas/agentic-flow not installed at ${pkg_dir}"
    return
  fi

  local provider_js="$pkg_dir/agentic-flow/dist/services/federated-sync-provider.js"
  local adapter_js="$pkg_dir/agentic-flow/dist/services/sync-coordinator-federated-adapter.js"

  if [[ ! -f "$provider_js" ]]; then
    _CHECK_OUTPUT="adr0196-fed-status: agentic-flow/dist/services/federated-sync-provider.js missing (${provider_js})"
    return
  fi
  if [[ ! -f "$adapter_js" ]]; then
    _CHECK_OUTPUT="adr0196-fed-status: agentic-flow/dist/services/sync-coordinator-federated-adapter.js missing (${adapter_js})"
    return
  fi

  local missing=""
  # Interface and Noop default — both should appear in federated-sync-provider.js
  for token in "FederatedSyncProvider" "NoopFederatedSyncProvider"; do
    if ! grep -qF "$token" "$provider_js" 2>/dev/null; then
      missing="$missing $token(federated-sync-provider.js)"
    fi
  done
  # SyncCoordinator adapter — appears in its own file
  if ! grep -qF "SyncCoordinatorFederatedAdapter" "$adapter_js" 2>/dev/null; then
    missing="$missing SyncCoordinatorFederatedAdapter(sync-coordinator-federated-adapter.js)"
  fi

  if [[ -n "$missing" ]]; then
    _CHECK_OUTPUT="adr0196-fed-status: missing FederatedSyncProvider interface tokens:${missing}"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="adr0196-fed-status: PASS (FederatedSyncProvider interface + NoopFederatedSyncProvider + SyncCoordinatorFederatedAdapter all present in published source)"
}

# ── (2) Episode metadata carries originInstallId + vectorClock ──────────────

# check_adr0196_episode_originInstallId — assert the episode-identity wiring
# tokens are present in `agentic-flow/dist/coordination/autopilot-learning.js`:
#   * originInstallId       — Phase 5 step 1: episode-identity field
#   * vectorClock           — Phase 5 step 5: cross-install ordering field
#   * incrementVectorClock  — Phase 5 step 5: the bump helper
# All three together prove step 1 + step 5 of ADR-0196 are wired.
#
# Reason: CLI surface deferred to future ADR; this probe validates source-
# level wiring of episode-identity + vector-clock metadata.
check_adr0196_episode_originInstallId() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local pkg_dir="${TEMP_DIR}/node_modules/@sparkleideas/agentic-flow"
  if [[ ! -d "$pkg_dir" ]]; then
    _CHECK_OUTPUT="adr0196-episode-origin: @sparkleideas/agentic-flow not installed at ${pkg_dir}"
    return
  fi

  local target="$pkg_dir/agentic-flow/dist/coordination/autopilot-learning.js"
  if [[ ! -f "$target" ]]; then
    _CHECK_OUTPUT="adr0196-episode-origin: agentic-flow/dist/coordination/autopilot-learning.js missing in installed package (${target})"
    return
  fi

  local missing=""
  for token in "originInstallId" "vectorClock" "incrementVectorClock"; do
    if ! grep -qF "$token" "$target" 2>/dev/null; then
      missing="$missing $token"
    fi
  done

  if [[ -n "$missing" ]]; then
    _CHECK_OUTPUT="adr0196-episode-origin: missing episode-identity tokens in agentic-flow/dist/coordination/autopilot-learning.js:${missing}"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="adr0196-episode-origin: PASS (originInstallId + vectorClock + incrementVectorClock all present — Phase 5 steps 1 + 5 wired)"
}
