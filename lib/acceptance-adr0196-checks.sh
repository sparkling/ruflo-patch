#!/usr/bin/env bash
# lib/acceptance-adr0196-checks.sh — ADR-0196: AutopilotLearning Phase 5
# (federated learning interface — runtime deferred).
#
# ADR-0196 status is `accepted` as of 2026-05-19. Closure criteria from the
# ADR that map directly to acceptance probes:
#   * `FederatedSyncProvider` interface is exposed and discoverable from the
#     CLI (subject of `autopilot federation status --json`)
#   * Episode metadata carries `originInstallId` (Phase 5 implementation
#     step 1 — episode identity) and optionally `vectorClock` (step 5)
#
# Until ADR-0196 lands, these checks FAIL — that is the closure-criterion
# signal. Per `feedback-no-fallbacks.md`, FAIL is the right disposition.
#
# Surfaces under test (post-ADR):
#   - `ruflo autopilot federation status --json` — new subcommand returning
#     the FederatedSyncProvider fields: `localInstallId`, `provider` (one
#     of `noop` | `sync-coordinator`), `transportReady` (boolean — false
#     while QUIC transport is stubbed per ADR-0196 step 6).
#   - `ruflo autopilot episodes --last 1 --json` — new subcommand returning
#     the most-recent episode record with full metadata, including
#     `originInstallId` (step 1) and optionally `vectorClock` (step 5).
#
# Caller MUST set: REGISTRY, TEMP_DIR, ACCEPT_TEMP, P5_DIR.
#
# Catalog naming: check_adr0196_* is L7-accepted via the adr-NNNN filename tag.

# ── helpers ─────────────────────────────────────────────────────────────────

_adr0196_run_federation_status() {
  local dir="$1" out_file="$2"
  local cli; cli=$(_cli_cmd)
  _run_and_kill_ro \
    "cd '${dir}' && NPM_CONFIG_REGISTRY='${REGISTRY}' ${cli} autopilot federation status --json 2>&1" \
    "$out_file" \
    30
}

_adr0196_run_episodes_last() {
  local dir="$1" out_file="$2"
  local cli; cli=$(_cli_cmd)
  _run_and_kill_ro \
    "cd '${dir}' && NPM_CONFIG_REGISTRY='${REGISTRY}' ${cli} autopilot episodes --last 1 --json 2>&1" \
    "$out_file" \
    30
}

# Drive an episode write so `autopilot episodes --last 1` has a row to
# inspect. ADR-0193 Item B sets the storeEpisode path; ADR-0196 step 1
# extends it to include `originInstallId` in the row metadata.
_adr0196_seed_episode() {
  local dir="$1"
  local cli; cli=$(_cli_cmd)
  _run_and_kill \
    "cd '${dir}' && NPM_CONFIG_REGISTRY='${REGISTRY}' ${cli} memory store --key 'adr0196-fed-seed' --value 'federation-test-subject' --namespace autopilot:episodes" \
    "" 20
}

# ── (1) FederatedSyncProvider interface exposed via CLI ─────────────────────

# check_adr0196_federation_status_interface — assert the
# `autopilot federation status --json` subcommand exists and returns a JSON
# object with the three load-bearing fields from ADR-0196 §"Interface shape":
#   * localInstallId   — string (stable cross-call)
#   * provider         — string, one of {'noop','sync-coordinator'}
#   * transportReady   — boolean (false while ADR-0196 step 6 / runtime ADR
#                        is unimplemented; true once QUIC transport lands)
check_adr0196_federation_status_interface() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  if [[ -z "${P5_DIR:-}" || ! -d "$P5_DIR" ]]; then
    _CHECK_OUTPUT="adr0196-fed-status: \$P5_DIR not exported or missing"
    return
  fi

  local dir; dir=$(mktemp -d "${ACCEPT_TEMP:-/tmp}/_check_workdirs/ruflo-adr0196-fed-XXXXX")
  # shellcheck disable=SC2064
  trap "rm -rf '$dir' 2>/dev/null; trap - RETURN INT TERM" RETURN INT TERM
  _acceptance_snapshot "$P5_DIR" "$dir"
  : > "$dir/.ruflo-project"

  if [[ ! -f "${dir}/.claude-flow/config.json" ]]; then
    _CHECK_OUTPUT="adr0196-fed-status: clone from \$P5_DIR failed"
    return
  fi

  local out_file; out_file=$(mktemp "${ACCEPT_TEMP:-/tmp}/adr0196-fed-XXXXX")
  _adr0196_run_federation_status "$dir" "$out_file"
  local raw; raw=$(cat "$out_file" 2>/dev/null || echo "")
  rm -f "$out_file"
  raw=$(echo "$raw" | grep -v '^__RUFLO_DONE__:')

  if echo "$raw" | grep -qiE 'unknown command|unknown subcommand|no such command'; then
    _CHECK_OUTPUT="adr0196-fed-status: \`autopilot federation status\` subcommand not present — ADR-0196 Phase 5 not yet implemented"
    return
  fi

  local body
  body=$(node -e '
    (() => {
      const raw = require("fs").readFileSync(0, "utf8");
      const s = raw.indexOf("{");
      const e = raw.lastIndexOf("}");
      if (s < 0 || e < s) { process.exit(2); }
      try {
        const j = JSON.parse(raw.slice(s, e + 1));
        process.stdout.write(JSON.stringify(j));
      } catch { process.exit(3); }
    })();
  ' <<<"$raw" 2>/dev/null)

  if [[ -z "$body" ]]; then
    _CHECK_OUTPUT="adr0196-fed-status: subcommand produced no parseable JSON. Raw: $(echo "$raw" | head -10 | tr '\n' ' ' | head -c 600)"
    return
  fi

  # Assert all three interface fields.
  local probe
  probe=$(node -e "
    try {
      const j = JSON.parse(require('fs').readFileSync(0,'utf8'));
      const id = j.localInstallId;
      const prov = j.provider;
      const tr = j.transportReady;
      const idOk = typeof id === 'string' && id.length > 0;
      const provOk = typeof prov === 'string' && (prov === 'noop' || prov === 'sync-coordinator');
      const trOk = typeof tr === 'boolean';
      process.stdout.write(JSON.stringify({ idOk, provOk, trOk, id, prov, tr }));
    } catch (e) { process.stdout.write(JSON.stringify({ err: String(e).slice(0,200) })); }
  " <<<"$body" 2>/dev/null)

  local fail_msg=""
  if echo "$probe" | grep -q '"idOk":false'; then
    fail_msg="${fail_msg} localInstallId missing or non-string;"
  fi
  if echo "$probe" | grep -q '"provOk":false'; then
    fail_msg="${fail_msg} provider not in {noop,sync-coordinator};"
  fi
  if echo "$probe" | grep -q '"trOk":false'; then
    fail_msg="${fail_msg} transportReady not boolean;"
  fi

  if [[ -n "$fail_msg" ]]; then
    _CHECK_OUTPUT="adr0196-fed-status: FederatedSyncProvider interface fields incomplete:${fail_msg} Probe: ${probe}"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="adr0196-fed-status: localInstallId + provider + transportReady all present and well-typed. Probe: ${probe}"
}

# ── (2) Episode metadata carries originInstallId (+ optional vectorClock) ───

# check_adr0196_episode_originInstallId — drive an episode write, then read
# back the most-recent episode and assert its metadata contains
# `originInstallId` (Phase 5 step 1, mandatory). `vectorClock` is checked
# but treated as best-effort signal — step 5 of ADR-0196 marks it explicitly
# deferrable. We log its presence/absence in the diagnostic so the
# closure-criterion "did step 5 land?" question is answerable from logs.
check_adr0196_episode_originInstallId() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  if [[ -z "${P5_DIR:-}" || ! -d "$P5_DIR" ]]; then
    _CHECK_OUTPUT="adr0196-episode-origin: \$P5_DIR not exported or missing"
    return
  fi

  local dir; dir=$(mktemp -d "${ACCEPT_TEMP:-/tmp}/_check_workdirs/ruflo-adr0196-ep-XXXXX")
  # shellcheck disable=SC2064
  trap "rm -rf '$dir' 2>/dev/null; trap - RETURN INT TERM" RETURN INT TERM
  _acceptance_snapshot "$P5_DIR" "$dir"
  : > "$dir/.ruflo-project"

  if [[ ! -f "${dir}/.claude-flow/config.json" ]]; then
    _CHECK_OUTPUT="adr0196-episode-origin: clone from \$P5_DIR failed"
    return
  fi

  _adr0196_seed_episode "$dir"

  local out_file; out_file=$(mktemp "${ACCEPT_TEMP:-/tmp}/adr0196-ep-XXXXX")
  _adr0196_run_episodes_last "$dir" "$out_file"
  local raw; raw=$(cat "$out_file" 2>/dev/null || echo "")
  rm -f "$out_file"
  raw=$(echo "$raw" | grep -v '^__RUFLO_DONE__:')

  if echo "$raw" | grep -qiE 'unknown command|unknown subcommand|no such command'; then
    _CHECK_OUTPUT="adr0196-episode-origin: \`autopilot episodes\` subcommand not present — ADR-0196 Phase 5 step 1 not yet implemented"
    return
  fi

  local body
  body=$(node -e '
    (() => {
      const raw = require("fs").readFileSync(0, "utf8");
      const s = raw.indexOf("{");
      const e = raw.lastIndexOf("}");
      if (s < 0 || e < s) { process.exit(2); }
      try {
        const j = JSON.parse(raw.slice(s, e + 1));
        process.stdout.write(JSON.stringify(j));
      } catch { process.exit(3); }
    })();
  ' <<<"$raw" 2>/dev/null)

  if [[ -z "$body" ]]; then
    _CHECK_OUTPUT="adr0196-episode-origin: no parseable JSON from episodes subcommand. Raw: $(echo "$raw" | head -10 | tr '\n' ' ' | head -c 600)"
    return
  fi

  # Episode shape may be `{episodes:[{...}]}` or `{episode:{...}}` or a
  # top-level array. Walk all of these. `originInstallId` may be top-level
  # on the episode OR nested under `metadata`.
  local probe
  probe=$(node -e "
    (() => {
      try {
        const j = JSON.parse(require('fs').readFileSync(0,'utf8'));
        let ep = null;
        if (Array.isArray(j.episodes) && j.episodes.length > 0) ep = j.episodes[0];
        else if (j.episode) ep = j.episode;
        else if (Array.isArray(j) && j.length > 0) ep = j[0];
        else if (j.taskId !== undefined || j.subject !== undefined) ep = j;
        if (!ep) { process.stdout.write(JSON.stringify({hasEp:false})); return; }
        const origin = ep.originInstallId ?? ep.metadata?.originInstallId;
        const vc = ep.vectorClock ?? ep.metadata?.vectorClock;
        process.stdout.write(JSON.stringify({
          hasEp: true,
          hasOrigin: typeof origin === 'string' && origin.length > 0,
          origin: typeof origin === 'string' ? origin.slice(0,80) : null,
          hasVC: vc != null && typeof vc === 'object',
        }));
      } catch (e) { process.stdout.write(JSON.stringify({err:String(e).slice(0,200)})); }
    })();
  " <<<"$body" 2>/dev/null)

  if echo "$probe" | grep -q '"hasEp":false'; then
    _CHECK_OUTPUT="adr0196-episode-origin: episodes subcommand returned no episode after seed write. Body: $(echo "$body" | head -c 400)"
    return
  fi

  if echo "$probe" | grep -q '"hasOrigin":false'; then
    _CHECK_OUTPUT="adr0196-episode-origin: episode lacks originInstallId metadata (Phase 5 step 1 not yet wired). Probe: ${probe}. Body: $(echo "$body" | head -c 400)"
    return
  fi

  # vectorClock is optional (ADR-0196 step 5 explicitly deferrable); record
  # but don't gate on it.
  local vc_note=""
  if echo "$probe" | grep -q '"hasVC":true'; then
    vc_note=" vectorClock also present (Phase 5 step 5 landed)"
  else
    vc_note=" vectorClock absent (Phase 5 step 5 deferrable per ADR)"
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="adr0196-episode-origin: most-recent episode carries originInstallId.${vc_note}"
}
