#!/usr/bin/env bash
# lib/acceptance-adr0090-b3-checks.sh — ADR-0090 Tier B3 + B6a: daemon-worker
# output JSON fail-loud round-trip checks.
#
# Requires: acceptance-harness.sh + acceptance-checks.sh sourced first
# Caller MUST set: E2E_DIR, TEMP_DIR, REGISTRY, PKG
#
# Background
# ==========
# ADR-0090 §Findings (JSON state files): 10 of 15 daemon-written JSON files
# have ZERO acceptance coverage. The daemon workers are triggered on a
# schedule (15-240min) in a real environment, so the ruflo acceptance
# harness never observes a fresh write and therefore never asserts the
# shape of what was written.
#
# Tier B3 specifies 5 round-trip checks, one per worker:
#
#   | Trigger     | Output file                              |
#   | ----------- | ---------------------------------------- |
#   | map         | .claude-flow/metrics/codebase-map.json   |
#   | audit       | .claude-flow/metrics/security-audit.json |
#   | optimize    | .claude-flow/metrics/performance.json    |
#   | consolidate | .claude-flow/metrics/consolidation.json  |
#   | testgaps    | .claude-flow/metrics/test-gaps.json      |
#
# Tier B6a adds a 6th check: the daemon-state.json round-trip under the
# same fail-loud discipline.
#
# Product contract (observed via the fork source)
# ===============================================
# 1. `cli daemon trigger -w <worker>` invokes `WorkerDaemon.triggerWorker()`
#    SYNCHRONOUSLY (see fork commands/daemon.ts:634 → worker-daemon.ts:1220).
#    Each worker writes its output to the fixed path above and then
#    `saveState()` updates `.claude-flow/daemon-state.json`.
#
# 2. `cli hooks worker dispatch --trigger <worker>` (what the original
#    brief named) is a DIFFERENT code path: it calls the
#    `hooks_worker-dispatch` MCP tool which only updates in-memory MCP
#    accounting state (mcp-tools/hooks-tools.ts:3499-3594). It does NOT
#    invoke the real worker implementation — no file is written.
#
#    This means the Tier B3 brief's literal command, as written, would be
#    a false-positive check ("CLI exited 0 ⇒ PASS" without ever producing
#    the artifact). That's the ADR-0082 silent-pass anti-pattern.
#
# Decision: use `daemon trigger -w` (synchronous, writes the real file).
# The brief's intent — "does a worker's output file get produced with the
# documented shape?" — is served by the command that actually produces
# the artifact. See /tmp/b3-builder.md for the finding + follow-ups.
#
# Contract under test for every check:
#   a. Target file starts non-existent (pre-delete)
#   b. `cli daemon trigger -w <worker>` exits 0
#   c. File appears at the documented path within the timeout
#   d. File is >0 bytes (not empty)
#   e. File parses as JSON (not truncated)
#   f. File contains the required fields (contract shape)
#
# If ANY of (b)-(f) fails, _CHECK_PASSED="false" with a specific
# diagnostic. NEVER "skip_accepted" for these workers — they are all
# core to the ADR-0088 daemon scope and not one of them is
# prerequisite-absent. If a future ADR removes one, the corresponding
# check should be DELETED, not silently skipped.
#
# Self-test philosophy
# ====================
# Per ADR-0082, we NEVER silent-pass. Per ADR-0090 Tier A2,
# _CHECK_PASSED="skip_accepted" is reserved for legitimate
# prerequisite-absent cases (e.g. native runtime missing from the build).
# These 6 checks use a binary (true/false) result because there is no
# "prerequisite" — the daemon ships with every init'd project per
# ADR-0088. The ONLY scenario where "skip_accepted" is used is a guard
# for the future: if the researcher report ever flags a worker trigger
# as "removed from build" (e.g. after a hypothetical ADR-0088 successor
# drops a worker type), the helper will detect "unknown worker trigger"
# in the CLI error output and skip with a clear marker. See the
# `_b3_unknown_trigger_pattern` docblock below.

# ════════════════════════════════════════════════════════════════════
# Shared helper: _b3_check_worker_output_json
# ════════════════════════════════════════════════════════════════════
#
# Arguments (positional, all required except timeout):
#   $1 trigger          — worker trigger name ("map", "audit", ...)
#   $2 rel_path         — path relative to iso root (e.g.
#                         ".claude-flow/metrics/codebase-map.json")
#   $3 required_fields  — comma-separated list of TOP-LEVEL JSON fields
#                         that must be present (e.g. "timestamp,mode")
#   $4 timeout_s        — max seconds to wait for the file to appear
#                         (default 30)
#
# Contract:
#   - _CHECK_PASSED set to "true" / "false" / "skip_accepted"
#   - _CHECK_OUTPUT set to a human-readable diagnostic
#   - No global state leaks; iso dir cleaned up on exit
#
# Pattern for matching "worker not in build" (triggers skip_accepted):
#   grep -iE 'unknown worker|not (a valid|supported).*worker|worker.*not found'
#   Against the CLI's stderr from a non-zero exit. We only set
#   skip_accepted for the precise case the researcher report would flag.
_b3_check_worker_output_json() {
  local trigger="$1"
  local rel_path="$2"
  local required_fields="$3"
  local timeout_s="${4:-30}"

  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  # ─── Preconditions ─────────────────────────────────────────────────
  if [[ -z "$trigger" || -z "$rel_path" || -z "$required_fields" ]]; then
    _CHECK_OUTPUT="B3/${trigger}: helper called with missing args (trigger=$trigger rel_path=$rel_path fields=$required_fields)"
    return
  fi

  if [[ -z "${E2E_DIR:-}" || ! -d "$E2E_DIR" ]]; then
    _CHECK_OUTPUT="B3/${trigger}: E2E_DIR not set or missing (caller must set it)"
    return
  fi

  # ─── Step 1: isolate ───────────────────────────────────────────────
  local iso; iso=$(_e2e_isolate "b3-${trigger}")
  if [[ -z "$iso" || ! -d "$iso" ]]; then
    _CHECK_OUTPUT="B3/${trigger}: failed to create isolated project dir"
    return
  fi

  local cli; cli=$(_cli_cmd)
  local work; work=$(mktemp -d /tmp/b3-${trigger}-work-XXXXX)
  local target_file="$iso/$rel_path"

  # ─── Step 2: pre-delete the target file ────────────────────────────
  # A stale file from init would let this check PASS without the worker
  # ever running. Per the ADR-0090 findings, file-existence checks have
  # a history of being silent-pass theater — pre-deleting the file is
  # the minimum rigor for "we observed a fresh write".
  mkdir -p "$(dirname "$target_file")" 2>/dev/null
  rm -f "$target_file"
  if [[ -f "$target_file" ]]; then
    _CHECK_OUTPUT="B3/${trigger}: pre-delete failed — $target_file still exists before trigger (iso copy from E2E_DIR cannot be cleaned)"
    rm -rf "$work"
    return
  fi

  # ─── Step 3: dispatch the worker via `daemon trigger` ──────────────
  # `daemon trigger -w <worker>` invokes WorkerDaemon.triggerWorker()
  # synchronously. It returns only after the worker's `writeFileSync`
  # completes. This bypasses the `hooks worker dispatch` MCP stub that
  # does NOT produce a file (see docblock above).
  #
  # Uses the FIXED _run_and_kill (commit a03cdf8) which now captures
  # real exit codes via the sentinel line. Writing worker can touch
  # config/memory so we use the write-path variant (with WAL grace).
  local dispatch_out="$work/dispatch.out"
  _run_and_kill "cd '$iso' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli daemon trigger -w '$trigger'" "$dispatch_out" "$timeout_s"
  local dispatch_exit="${_RK_EXIT:-1}"
  local dispatch_body; dispatch_body=$(cat "$dispatch_out" 2>/dev/null || echo "")

  # ─── Step 3b: unknown-worker probe (three-way bucket) ──────────────
  # Per ADR-0090 Tier A2, "skip_accepted" is ONLY for legitimate
  # prerequisite-absent. If a future build removes a worker type, the
  # CLI prints "Unknown worker trigger: ..." or similar. Bucket those
  # distinctly so a removed-worker regression surfaces as SKIP, not
  # FAIL (drowning out real regressions), and not PASS (covering up
  # the removal).
  if echo "$dispatch_body" | grep -qiE 'unknown worker( trigger)?|not .*valid.*worker|worker.*not found|worker type.*not found'; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: worker trigger '$trigger' rejected by CLI (treated as removed-from-build per ADR-0090 Tier A2): $(echo "$dispatch_body" | head -3 | tr '\n' ' ')"
    rm -rf "$work" "$iso" 2>/dev/null
    return
  fi

  if [[ "$dispatch_exit" -ne 0 ]]; then
    _CHECK_OUTPUT="B3/${trigger}: dispatch exited $dispatch_exit (expected 0). Stderr/stdout (first 10 lines):
$(echo "$dispatch_body" | head -10)"
    rm -rf "$work" "$iso" 2>/dev/null
    return
  fi

  # ─── Step 4: poll for the file with exponential backoff ────────────
  # `daemon trigger` is nominally synchronous (writes file before
  # returning), but give a small polling window to defend against flush
  # buffering, filesystem latency, or a future refactor that adds
  # async. Exponential backoff: 50ms, 100ms, 200ms, 400ms, ... capped
  # at 1000ms, up to the total timeout_s budget.
  local delay_ms=50
  local elapsed_ms=0
  local timeout_ms=$(( timeout_s * 1000 ))
  while (( elapsed_ms < timeout_ms )); do
    if [[ -f "$target_file" && -s "$target_file" ]]; then
      break
    fi
    # Sleep in seconds (bash's sleep accepts fractions)
    local delay_s
    delay_s=$(awk -v ms="$delay_ms" 'BEGIN { printf "%.3f", ms/1000 }')
    sleep "$delay_s"
    elapsed_ms=$(( elapsed_ms + delay_ms ))
    delay_ms=$(( delay_ms * 2 ))
    (( delay_ms > 1000 )) && delay_ms=1000
  done

  # ─── Step 5: validate existence + size ─────────────────────────────
  if [[ ! -f "$target_file" ]]; then
    _CHECK_OUTPUT="B3/${trigger}: file not written after $timeout_s s — expected at '$rel_path'. Dispatch output: $(echo "$dispatch_body" | head -5 | tr '\n' ' ')"
    rm -rf "$work" "$iso" 2>/dev/null
    return
  fi

  local file_size; file_size=$(wc -c < "$target_file" 2>/dev/null | tr -d ' ')
  file_size=${file_size:-0}
  if (( file_size == 0 )); then
    _CHECK_OUTPUT="B3/${trigger}: file exists but is empty (0 bytes) — worker wrote nothing: $rel_path"
    rm -rf "$work" "$iso" 2>/dev/null
    return
  fi

  # ─── Step 6: validate JSON parse + required fields ─────────────────
  # Using node so we have access to the ambient node binary. A missing
  # node is a fatal infra problem (the CLI itself runs on node) — no
  # need to guard for "node unavailable".
  #
  # The validator prints:
  #   OK:<fields_checked>
  #   ERR_PARSE:<first line of parse error>
  #   ERR_MISSING:<comma-joined missing fields>
  #
  # Required fields are dotted-path: "timestamp,checks.envFilesProtected"
  # → validator walks each path and fails if any path is missing /
  # undefined. Explicit `null` is treated as missing to catch
  # half-populated artefacts.
  local validate_out
  validate_out=$(node -e '
    const fs = require("fs");
    const file = process.argv[1];
    const required = process.argv[2].split(",").map(s => s.trim()).filter(Boolean);
    let raw;
    try { raw = fs.readFileSync(file, "utf8"); }
    catch (e) { console.log("ERR_READ:" + e.message); process.exit(1); }
    let j;
    try { j = JSON.parse(raw); }
    catch (e) { console.log("ERR_PARSE:" + e.message); process.exit(1); }
    const missing = [];
    for (const path of required) {
      const parts = path.split(".");
      let cur = j;
      let ok = true;
      for (const p of parts) {
        if (cur === null || cur === undefined || typeof cur !== "object" || !(p in cur)) {
          ok = false; break;
        }
        cur = cur[p];
      }
      if (!ok || cur === null || cur === undefined) {
        missing.push(path);
      }
    }
    if (missing.length) { console.log("ERR_MISSING:" + missing.join(",")); process.exit(1); }
    console.log("OK:" + required.join(","));
  ' "$target_file" "$required_fields" 2>&1)

  if echo "$validate_out" | grep -q '^ERR_PARSE:'; then
    local parse_err; parse_err=$(echo "$validate_out" | sed -nE 's/^ERR_PARSE:(.*)/\1/p' | head -1)
    local peek; peek=$(head -c 200 "$target_file" 2>/dev/null)
    _CHECK_OUTPUT="B3/${trigger}: invalid JSON in $rel_path: $parse_err. First 200 bytes: $peek"
    rm -rf "$work" "$iso" 2>/dev/null
    return
  fi

  if echo "$validate_out" | grep -q '^ERR_MISSING:'; then
    local missing; missing=$(echo "$validate_out" | sed -nE 's/^ERR_MISSING:(.*)/\1/p' | head -1)
    _CHECK_OUTPUT="B3/${trigger}: missing required field(s) in $rel_path: $missing (required: $required_fields)"
    rm -rf "$work" "$iso" 2>/dev/null
    return
  fi

  if echo "$validate_out" | grep -q '^ERR_READ:'; then
    local read_err; read_err=$(echo "$validate_out" | sed -nE 's/^ERR_READ:(.*)/\1/p' | head -1)
    _CHECK_OUTPUT="B3/${trigger}: failed to read $rel_path: $read_err"
    rm -rf "$work" "$iso" 2>/dev/null
    return
  fi

  if ! echo "$validate_out" | grep -q '^OK:'; then
    _CHECK_OUTPUT="B3/${trigger}: validator returned unexpected output: $(echo "$validate_out" | head -3 | tr '\n' ' ')"
    rm -rf "$work" "$iso" 2>/dev/null
    return
  fi

  # ─── Step 7: cleanup + PASS ────────────────────────────────────────
  rm -rf "$work" "$iso" 2>/dev/null
  _CHECK_PASSED="true"
  _CHECK_OUTPUT="B3/${trigger}: $rel_path written ($file_size bytes), parses as JSON, all required fields present ($required_fields), elapsed=${elapsed_ms}ms"
}

# ════════════════════════════════════════════════════════════════════
# B3-map: Codebase map worker round-trip
# ════════════════════════════════════════════════════════════════════
#
# Required fields are derived from the fork source at
# worker-daemon.ts:runMapWorker (lines 949-972):
#   timestamp          — ISO string, always present
#   projectRoot        — absolute path
#   structure          — object with 4 hasXxx booleans
#   scannedAt          — epoch ms
#
# We validate the top-level fields + one structure key to keep the
# contract tight without becoming brittle to future additions.
check_adr0090_b3_map() {
  _b3_check_worker_output_json \
    "map" \
    ".claude-flow/metrics/codebase-map.json" \
    "timestamp,projectRoot,structure,scannedAt,structure.hasPackageJson" \
    30
}

# ════════════════════════════════════════════════════════════════════
# B3-audit: Security audit worker round-trip
# ════════════════════════════════════════════════════════════════════
#
# Required fields (worker-daemon.ts:runAuditWorkerLocal, lines 977-1001):
#   timestamp, mode, checks, riskLevel, recommendations
check_adr0090_b3_audit() {
  _b3_check_worker_output_json \
    "audit" \
    ".claude-flow/metrics/security-audit.json" \
    "timestamp,mode,checks,riskLevel,recommendations,checks.envFilesProtected" \
    30
}

# ════════════════════════════════════════════════════════════════════
# B3-optimize: Performance worker round-trip
# ════════════════════════════════════════════════════════════════════
#
# Required fields (worker-daemon.ts:runOptimizeWorkerLocal, 1006-1029):
#   timestamp, mode, memoryUsage, uptime, optimizations
check_adr0090_b3_optimize() {
  _b3_check_worker_output_json \
    "optimize" \
    ".claude-flow/metrics/performance.json" \
    "timestamp,mode,memoryUsage,uptime,optimizations,memoryUsage.rss" \
    30
}

# ════════════════════════════════════════════════════════════════════
# B3-consolidate: Consolidation worker round-trip
# ════════════════════════════════════════════════════════════════════
#
# Required fields (worker-daemon.ts:runConsolidateWorker, 1031-1078):
#   timestamp, patternsConsolidated, memoryCleaned, duplicatesRemoved
#
# Note: this worker is the only one that hits the real router
# (routeLearningOp / routeEmbeddingOp). It's also the slowest locally
# (~250ms). The 45s timeout is deliberately longer than the others to
# survive a cold embedding-model load on first invocation.
check_adr0090_b3_consolidate() {
  _b3_check_worker_output_json \
    "consolidate" \
    ".claude-flow/metrics/consolidation.json" \
    "timestamp,patternsConsolidated,memoryCleaned,duplicatesRemoved" \
    45
}

# ════════════════════════════════════════════════════════════════════
# B3-testgaps: Test gaps worker round-trip
# ════════════════════════════════════════════════════════════════════
#
# Required fields (worker-daemon.ts:runTestGapsWorkerLocal, 1083-1103):
#   timestamp, mode, hasTestDir, estimatedCoverage, gaps
check_adr0090_b3_testgaps() {
  _b3_check_worker_output_json \
    "testgaps" \
    ".claude-flow/metrics/test-gaps.json" \
    "timestamp,mode,hasTestDir,estimatedCoverage,gaps" \
    30
}

# ════════════════════════════════════════════════════════════════════
# B6a: Daemon-state.json round-trip
# ════════════════════════════════════════════════════════════════════
#
# Different shape from B3 — daemon-state.json is written by
# `WorkerDaemon.saveState()` (worker-daemon.ts:1253-1279) on every
# state change (start, stop, worker trigger). Lives at
# `.claude-flow/daemon-state.json`, not under metrics/.
#
# Required fields (from saveState, cross-checked against live file):
#   running        — boolean
#   workers        — object keyed by worker type
#   config         — object
#   savedAt        — ISO string (present on every save)
#
# We use the same helper by pointing at a different path — the
# contract is identical: fresh write → file exists → JSON → required
# fields present. We invoke via `daemon trigger -w map` because it's
# the cheapest worker (no model load, no router call) that also
# triggers a saveState. If the daemon ever stops writing daemon-state
# on trigger, we'll see it here loudly.
check_adr0090_b6a_daemon_state() {
  _b3_check_worker_output_json \
    "map" \
    ".claude-flow/daemon-state.json" \
    "running,workers,config,savedAt,workers.map" \
    30
  # Rewrite the CHECK_OUTPUT prefix from "B3/map" → "B6a/daemon-state"
  # so log searches on the B6a id turn up the right check.
  if [[ "${_CHECK_OUTPUT:-}" == B3/map:* ]]; then
    _CHECK_OUTPUT="B6a/daemon-state:${_CHECK_OUTPUT#B3/map:}"
  elif [[ "${_CHECK_OUTPUT:-}" == "SKIP_ACCEPTED: worker trigger 'map'"* ]]; then
    _CHECK_OUTPUT="SKIP_ACCEPTED: B6a/daemon-state — daemon trigger subcmd absent (treated as removed-from-build per ADR-0090 Tier A2)"
  fi
}
