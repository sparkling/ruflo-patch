#!/usr/bin/env bash
# lib/pipeline-utils.sh — Shared pipeline utilities (ADR-0038)
#
# Sourceable library — caller sets `set -euo pipefail` and provides:
#   SCRIPT_DIR, PROJECT_DIR, STATE_FILE, TEMP_DIR, BUILD_VERSION,
#   NEW_RUFLO_HEAD, NEW_AGENTIC_HEAD, NEW_FANN_HEAD, NEW_RUVECTOR_HEAD,
#   GLOBAL_TIMEOUT_PID
#
# Timing file variables (declared here, initialised on source):

PHASE_TIMINGS=""

# Per-command and per-package timing for pipeline-timing.json
TIMING_CMDS_FILE="/tmp/ruflo-timing-cmds.jsonl"
TIMING_BUILD_PKGS_FILE="/tmp/ruflo-timing-build-pkgs.jsonl"

PIPELINE_START_NS=""

# ---------------------------------------------------------------------------
# Logging helpers
# ---------------------------------------------------------------------------

log() {
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $*" >&2
}

log_error() {
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] ERROR: $*" >&2
}

# ---------------------------------------------------------------------------
# EXIT trap handler
# ---------------------------------------------------------------------------

cleanup() {
  local exit_code=$?
  if [[ -n "${GLOBAL_TIMEOUT_PID}" ]]; then
    kill "${GLOBAL_TIMEOUT_PID}" 2>/dev/null || true
  fi
  if [[ ${exit_code} -ne 0 ]]; then
    log_error "Build failed with exit code ${exit_code}"
  fi
  exit "${exit_code}"
}

# ---------------------------------------------------------------------------
# State file helpers
# ---------------------------------------------------------------------------

load_state() {
  RUFLO_HEAD=""
  AGENTIC_HEAD=""
  FANN_HEAD=""
  RUVECTOR_HEAD=""
  UPSTREAM_RUFLO_SHA=""
  UPSTREAM_AGENTIC_SHA=""
  UPSTREAM_FANN_SHA=""
  UPSTREAM_RUVECTOR_SHA=""

  if [[ -f "${STATE_FILE}" ]]; then
    log "Loading state from ${STATE_FILE}"
    while IFS='=' read -r key value; do
      [[ -z "${key}" || "${key}" =~ ^# ]] && continue
      case "${key}" in
        RUFLO_HEAD)          RUFLO_HEAD="${value}" ;;
        AGENTIC_HEAD)        AGENTIC_HEAD="${value}" ;;
        FANN_HEAD)           FANN_HEAD="${value}" ;;
        RUVECTOR_HEAD)       RUVECTOR_HEAD="${value}" ;;
        UPSTREAM_RUFLO_SHA)  UPSTREAM_RUFLO_SHA="${value}" ;;
        UPSTREAM_AGENTIC_SHA) UPSTREAM_AGENTIC_SHA="${value}" ;;
        UPSTREAM_FANN_SHA)   UPSTREAM_FANN_SHA="${value}" ;;
        UPSTREAM_RUVECTOR_SHA) UPSTREAM_RUVECTOR_SHA="${value}" ;;
      esac
    done < "${STATE_FILE}"

    # Validate SHA format (40-char hex) — reject corrupted/truncated values
    _validate_sha() {
      local val="$1" name="$2"
      if [[ -n "$val" && ! "$val" =~ ^[0-9a-f]{40}$ ]]; then
        log "WARNING: Invalid SHA for ${name} in state file: '${val:0:20}...' — treating as first run"
        echo ""
      else
        echo "$val"
      fi
    }
    RUFLO_HEAD=$(_validate_sha "$RUFLO_HEAD" "RUFLO_HEAD")
    AGENTIC_HEAD=$(_validate_sha "$AGENTIC_HEAD" "AGENTIC_HEAD")
    FANN_HEAD=$(_validate_sha "$FANN_HEAD" "FANN_HEAD")
    RUVECTOR_HEAD=$(_validate_sha "$RUVECTOR_HEAD" "RUVECTOR_HEAD")
    UPSTREAM_RUFLO_SHA=$(_validate_sha "$UPSTREAM_RUFLO_SHA" "UPSTREAM_RUFLO_SHA")
    UPSTREAM_AGENTIC_SHA=$(_validate_sha "$UPSTREAM_AGENTIC_SHA" "UPSTREAM_AGENTIC_SHA")
    UPSTREAM_FANN_SHA=$(_validate_sha "$UPSTREAM_FANN_SHA" "UPSTREAM_FANN_SHA")
    UPSTREAM_RUVECTOR_SHA=$(_validate_sha "$UPSTREAM_RUVECTOR_SHA" "UPSTREAM_RUVECTOR_SHA")

    log "State loaded: RUFLO=${RUFLO_HEAD:0:12}, AGENTIC=${AGENTIC_HEAD:0:12}, FANN=${FANN_HEAD:0:12}, RUVECTOR=${RUVECTOR_HEAD:0:12}"
  else
    log "No state file found — first run"
  fi

  # Snapshot state as PREV_* for check_merged_prs() comparison
  PREV_RUFLO_HEAD="${RUFLO_HEAD}"
  PREV_AGENTIC_HEAD="${AGENTIC_HEAD}"
  PREV_FANN_HEAD="${FANN_HEAD}"
  PREV_RUVECTOR_HEAD="${RUVECTOR_HEAD}"
}

save_state() {
  cat > "${STATE_FILE}" <<EOF
# ruflo build state — written by sync-and-build.sh (ADR-0027)
# Last updated: $(date -u '+%Y-%m-%dT%H:%M:%SZ')
RUFLO_HEAD=${NEW_RUFLO_HEAD:-${RUFLO_HEAD}}
AGENTIC_HEAD=${NEW_AGENTIC_HEAD:-${AGENTIC_HEAD}}
FANN_HEAD=${NEW_FANN_HEAD:-${FANN_HEAD}}
RUVECTOR_HEAD=${NEW_RUVECTOR_HEAD:-${RUVECTOR_HEAD}}
UPSTREAM_RUFLO_SHA=${UPSTREAM_RUFLO_SHA:-}
UPSTREAM_AGENTIC_SHA=${UPSTREAM_AGENTIC_SHA:-}
UPSTREAM_FANN_SHA=${UPSTREAM_FANN_SHA:-}
UPSTREAM_RUVECTOR_SHA=${UPSTREAM_RUVECTOR_SHA:-}
EOF
  log "State saved"
}

# ---------------------------------------------------------------------------
# Temp directory
# ---------------------------------------------------------------------------

create_temp_dir() {
  TEMP_DIR="/tmp/ruflo-build"
  mkdir -p "${TEMP_DIR}"
  log "Using persistent build directory: ${TEMP_DIR}"
}

# ---------------------------------------------------------------------------
# Build freshness check
# ---------------------------------------------------------------------------

check_build_freshness() {
  local manifest="/tmp/ruflo-build/.build-manifest.json"
  if [[ ! -f "$manifest" ]]; then
    log "No build manifest found — will build"
    return 1
  fi

  local stored
  stored=$(node -e "
    const m = JSON.parse(require('fs').readFileSync('${manifest}', 'utf-8'));
    console.log([m.ruflo_head, m.agentic_head, m.fann_head, m.ruvector_head || '', m.codemod_hash].join(':'));
  " 2>/dev/null) || { log "Cannot read manifest — will build"; return 1; }

  local stored_ruflo stored_agentic stored_fann stored_ruvector stored_codemod
  IFS=':' read -r stored_ruflo stored_agentic stored_fann stored_ruvector stored_codemod <<< "$stored"

  local current_codemod
  current_codemod=$(sha256sum "${SCRIPT_DIR}/codemod.mjs" 2>/dev/null | cut -d' ' -f1) || current_codemod=""

  if [[ "${stored_ruflo}" == "${NEW_RUFLO_HEAD}" && \
        "${stored_agentic}" == "${NEW_AGENTIC_HEAD}" && \
        "${stored_fann}" == "${NEW_FANN_HEAD}" && \
        "${stored_ruvector}" == "${NEW_RUVECTOR_HEAD}" && \
        "${stored_codemod}" == "${current_codemod}" ]]; then
    log "Build is current (manifest matches) — skipping build"
    return 0
  fi

  log "Build is stale — will rebuild"
  return 1
}

# ---------------------------------------------------------------------------
# Read build version
# ---------------------------------------------------------------------------

read_build_version() {
  # Read the CLI package version (has -patch.N suffix), not the root monorepo version
  BUILD_VERSION=$(node -e "
    const fs = require('fs');
    const path = require('path');
    // Try CLI package first (has the definitive version with -patch.N)
    const cliPath = path.join('${TEMP_DIR}', 'v3/@claude-flow/cli/package.json');
    if (fs.existsSync(cliPath)) {
      console.log(require(cliPath).version);
    } else {
      console.log(require('${TEMP_DIR}/package.json').version);
    }
  " 2>/dev/null) || {
    log_error "Could not read version from ${TEMP_DIR}"
    BUILD_VERSION="0.0.0"
  }
  log "Build version: ${BUILD_VERSION}"
}

# ---------------------------------------------------------------------------
# Phase runner with timing
# ---------------------------------------------------------------------------

add_cmd_timing() {
  local phase="$1" cmd="$2" ms="$3" exit_code="${4:-0}"
  printf '{"phase":"%s","command":"%s","duration_ms":%s,"exit_code":%s}\n' \
    "$phase" "$cmd" "$ms" "$exit_code" >> "$TIMING_CMDS_FILE"
}

add_build_pkg_timing() {
  local name="$1" ms="$2"
  printf '{"name":"%s","duration_ms":%s}\n' "$name" "$ms" >> "$TIMING_BUILD_PKGS_FILE"
}

run_phase() {
  local phase_name="$1"
  shift

  log "=== Phase: ${phase_name} ==="
  local phase_start_ns
  phase_start_ns=$(date +%s%N 2>/dev/null || echo 0)
  if ! "$@"; then
    local code=$?
    create_failure_issue "${phase_name}" "${code}"
    log_error "Phase '${phase_name}' failed — aborting"
    exit 1
  fi
  local phase_end_ns
  phase_end_ns=$(date +%s%N 2>/dev/null || echo 0)
  if [[ "$phase_start_ns" != "0" && "$phase_end_ns" != "0" ]]; then
    local phase_ms=$(( (phase_end_ns - phase_start_ns) / 1000000 ))
    log "  Phase '${phase_name}' completed in ${phase_ms}ms"
    PHASE_TIMINGS="${PHASE_TIMINGS} ${phase_name}:${phase_ms}"
  fi
}

print_phase_summary() {
  log "──────────────────────────────────────────"
  log "Phase timing summary:"
  for entry in $PHASE_TIMINGS; do
    local name="${entry%%:*}"
    local ms="${entry##*:}"
    if [[ $ms -ge 1000 ]]; then
      log "  $(printf '%-25s %6dms (%ds)' "$name" "$ms" "$((ms / 1000))")"
    else
      log "  $(printf '%-25s %6dms' "$name" "$ms")"
    fi
  done
  log "──────────────────────────────────────────"
}

write_pipeline_summary() {
  local summary_dir="${PROJECT_DIR}/test-results"
  mkdir -p "$summary_dir"
  local timestamp
  timestamp=$(date -u '+%Y%m%dT%H%M%SZ')
  local summary_file="${summary_dir}/${timestamp}/pipeline-timing.json"
  mkdir -p "$(dirname "$summary_file")"

  local pipeline_end_ns
  pipeline_end_ns=$(date +%s%N 2>/dev/null || echo 0)
  local pipeline_ms=0
  if [[ -n "$PIPELINE_START_NS" && "$PIPELINE_START_NS" != "0" && "$pipeline_end_ns" != "0" ]]; then
    pipeline_ms=$(( (pipeline_end_ns - PIPELINE_START_NS) / 1000000 ))
  fi

  # Use node to assemble the full timing JSON (phases + commands + packages + verify sub-phases)
  node -e "
    const fs = require('fs');
    const phases = '${PHASE_TIMINGS}'.trim().split(/\s+/).filter(Boolean).map(e => {
      const i = e.lastIndexOf(':');
      return { name: e.slice(0, i), duration_ms: parseInt(e.slice(i + 1)) };
    });
    let commands = [];
    try {
      commands = fs.readFileSync('${TIMING_CMDS_FILE}', 'utf-8')
        .trim().split('\\n').filter(Boolean).map(l => JSON.parse(l));
    } catch {}
    let buildPkgs = [];
    try {
      buildPkgs = fs.readFileSync('${TIMING_BUILD_PKGS_FILE}', 'utf-8')
        .trim().split('\\n').filter(Boolean).map(l => JSON.parse(l));
    } catch {}
    let publishPkgs = [];
    try {
      publishPkgs = JSON.parse(fs.readFileSync('${PROJECT_DIR}/config/.publish-timing.json', 'utf-8'));
    } catch {}
    let verifyPhases = [];
    for (const tf of ['/tmp/ruflo-publish-verdaccio-timing.jsonl', '/tmp/ruflo-acceptance-timing.jsonl']) {
      try {
        const entries = fs.readFileSync(tf, 'utf-8')
          .trim().split('\\n').filter(Boolean).map(l => JSON.parse(l));
        verifyPhases.push(...entries);
      } catch {}
    }
    const result = {
      timestamp: '${timestamp}',
      version: '${BUILD_VERSION:-unknown}',
      total_duration_ms: ${pipeline_ms},
      acceptance_passed: true,
      phases,
      commands,
      verify_phases: verifyPhases,
      packages: {
        build: buildPkgs,
        publish: publishPkgs.map(p => ({
          name: p.name, duration_ms: p.duration_ms || 0,
          version: p.version || '', tag: p.tag || ''
        }))
      }
    };
    fs.writeFileSync('${summary_file}', JSON.stringify(result, null, 2) + '\\n');
  " 2>/dev/null || {
    log "WARNING: Node JSON assembly failed — writing basic summary"
    local phases_json='[]'
    cat > "$summary_file" <<EOJSON
{"timestamp":"${timestamp}","version":"${BUILD_VERSION:-unknown}","total_duration_ms":${pipeline_ms},"acceptance_passed":true,"phases":${phases_json},"commands":[],"verify_phases":[],"packages":{"build":[],"publish":[]}}
EOJSON
  }
  log "Pipeline timing summary written to ${summary_file}"
}
