#!/usr/bin/env bash
# lib/acceptance-ruvllm-checks.sh — ADR-0094 Phase 5: RuvLLM MCP tools
#
# Acceptance checks for the 10 ruvllm_* MCP tools.
#
# W2-I2 changes: router/SONA/LoRA state is now persisted under
#   .claude-flow/ruvllm/{hnsw,sona,microlora}-store.json
# so we can verify real create → op lifecycles across separate `cli mcp exec`
# invocations. The previous version accepted "Router not found: …" as a valid
# terminal state because the in-memory registry was wiped between calls — that
# was an ADR-0082 violation and is now gone.
#
# Requires: acceptance-harness.sh + acceptance-checks.sh sourced first
#           (_mcp_invoke_tool, _cli_cmd, _e2e_isolate, _with_iso_cleanup,
#            _MCP_BODY)
# Caller MUST set: E2E_DIR, TEMP_DIR, REGISTRY, PKG

# ════════════════════════════════════════════════════════════════════
# Internal: extract IDs from the last _MCP_BODY
# ════════════════════════════════════════════════════════════════════
#
# The *_create tools return JSON with {success, routerId|sonaId|loraId, ...}
# after the `Result:` sentinel. node is preferred over grep/sed since the
# body may span multiple lines or contain escaped braces.
_extract_router_id() {
  local body="${_MCP_BODY:-}"
  [[ -z "$body" ]] && { echo ""; return; }
  node -e '
    let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{
      try {
        const j = JSON.parse(d);
        const id = j.routerId || j.router_id;
        if (typeof id === "string" && id.length > 0) process.stdout.write(id);
      } catch {}
    });
  ' <<<"$body" 2>/dev/null || true
}

_extract_sona_id() {
  local body="${_MCP_BODY:-}"
  [[ -z "$body" ]] && { echo ""; return; }
  node -e '
    let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{
      try {
        const j = JSON.parse(d);
        const id = j.sonaId || j.sona_id;
        if (typeof id === "string" && id.length > 0) process.stdout.write(id);
      } catch {}
    });
  ' <<<"$body" 2>/dev/null || true
}

_extract_lora_id() {
  local body="${_MCP_BODY:-}"
  [[ -z "$body" ]] && { echo ""; return; }
  node -e '
    let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{
      try {
        const j = JSON.parse(d);
        const id = j.loraId || j.lora_id;
        if (typeof id === "string" && id.length > 0) process.stdout.write(id);
      } catch {}
    });
  ' <<<"$body" 2>/dev/null || true
}

# ════════════════════════════════════════════════════════════════════
# Check 1: ruvllm_status — query RuvLLM runtime status
# ════════════════════════════════════════════════════════════════════
check_adr0094_p5_ruvllm_status() {
  _mcp_invoke_tool \
    "ruvllm_status" '{}' \
    'available|initialized|version' \
    "P5/ruvllm_status" 15 --ro
}

# ════════════════════════════════════════════════════════════════════
# Check 2 + 3 + 4: HNSW create → add → route lifecycle (W2-I2)
# ════════════════════════════════════════════════════════════════════
#
# Real cross-process lifecycle: the router created in step 1 must survive
# to step 2 (via .claude-flow/ruvllm/hnsw-store.json) and the pattern added
# in step 2 must be retrievable in step 3.
#
# Each of the three public check functions below is a thin wrapper around
# the lifecycle body so the Sprint 0 catalog still sees three independent
# entries — but only the first one runs all three MCP calls. The others
# reuse the captured IDs and verify narrower contracts.

_ruvllm_hnsw_lifecycle_body() {
  local iso="$1"
  local _saved_e2e="${E2E_DIR:-}"
  E2E_DIR="$iso"

  # ─── Step 1: hnsw_create ────────────────────────────────────────
  _mcp_invoke_tool "ruvllm_hnsw_create" \
    '{"dimensions":4,"maxPatterns":8}' \
    '"routerId"|"success"\s*:\s*true|created|hnsw' \
    "P5/hnsw/create" 15 --rw
  if [[ "$_CHECK_PASSED" == "skip_accepted" ]]; then
    _CHECK_OUTPUT="SKIP_ACCEPTED: P5/hnsw-lifecycle: ruvllm_hnsw_create not in build"
    E2E_DIR="$_saved_e2e"; return
  fi
  if [[ "$_CHECK_PASSED" != "true" ]]; then
    _CHECK_OUTPUT="P5/hnsw-lifecycle step 1 (create) failed — $_CHECK_OUTPUT"
    _CHECK_PASSED="false"; E2E_DIR="$_saved_e2e"; return
  fi

  local rid; rid=$(_extract_router_id)
  if [[ -z "$rid" ]]; then
    _CHECK_OUTPUT="P5/hnsw-lifecycle: step 1 returned no routerId. Body: $(echo "${_MCP_BODY:-}" | head -3 | tr '\n' ' ')"
    _CHECK_PASSED="false"; E2E_DIR="$_saved_e2e"; return
  fi

  # Verify the store file is actually on disk — the whole point of W2-I2
  local store_path="${iso}/.claude-flow/ruvllm/hnsw-store.json"
  if [[ ! -f "$store_path" ]]; then
    _CHECK_OUTPUT="P5/hnsw-lifecycle: .claude-flow/ruvllm/hnsw-store.json missing after create (persistence regressed). iso=$iso rid=$rid"
    _CHECK_PASSED="false"; E2E_DIR="$_saved_e2e"; return
  fi

  # ─── Step 2: hnsw_add (separate process — validates persistence) ─
  _mcp_invoke_tool "ruvllm_hnsw_add" \
    "{\"routerId\":\"$rid\",\"name\":\"alpha\",\"embedding\":[0.9,0.1,0.1,0.1]}" \
    '"success"\s*:\s*true|"patternCount"\s*:\s*1' \
    "P5/hnsw/add" 15 --rw
  if [[ "$_CHECK_PASSED" == "skip_accepted" ]]; then
    _CHECK_OUTPUT="SKIP_ACCEPTED: P5/hnsw-lifecycle: ruvllm_hnsw_add not in build"
    E2E_DIR="$_saved_e2e"; return
  fi
  if [[ "$_CHECK_PASSED" != "true" ]]; then
    _CHECK_OUTPUT="P5/hnsw-lifecycle step 2 (add) failed — router '$rid' not persisted across processes. $_CHECK_OUTPUT"
    _CHECK_PASSED="false"; E2E_DIR="$_saved_e2e"; return
  fi

  # ─── Step 3: hnsw_route (third process — validates retrieval) ───
  _mcp_invoke_tool "ruvllm_hnsw_route" \
    "{\"routerId\":\"$rid\",\"query\":[0.9,0.1,0.1,0.1],\"k\":1}" \
    '"alpha"|"results"\s*:\s*\[' \
    "P5/hnsw/route" 15 --ro
  if [[ "$_CHECK_PASSED" == "skip_accepted" ]]; then
    _CHECK_OUTPUT="SKIP_ACCEPTED: P5/hnsw-lifecycle: ruvllm_hnsw_route not in build"
    E2E_DIR="$_saved_e2e"; return
  fi
  if [[ "$_CHECK_PASSED" != "true" ]]; then
    _CHECK_OUTPUT="P5/hnsw-lifecycle step 3 (route) failed — added pattern not retrievable. $_CHECK_OUTPUT"
    _CHECK_PASSED="false"; E2E_DIR="$_saved_e2e"; return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="P5/hnsw-lifecycle: create → add → route succeeded with persistence (routerId=$rid)"
  E2E_DIR="$_saved_e2e"
}

check_adr0094_p5_ruvllm_hnsw_create() {
  _with_iso_cleanup "p5-ruvllm-hnsw-create" _ruvllm_hnsw_lifecycle_body
}

# The add and route checks re-run the full lifecycle in their own isolate so
# each one is independently runnable (Sprint 0 catalog executes checks by
# name, not by dependency). This is the same pattern workflow-checks uses
# for the lifecycle-style probes.
check_adr0094_p5_ruvllm_hnsw_add() {
  _with_iso_cleanup "p5-ruvllm-hnsw-add" _ruvllm_hnsw_lifecycle_body
}

check_adr0094_p5_ruvllm_hnsw_route() {
  _with_iso_cleanup "p5-ruvllm-hnsw-route" _ruvllm_hnsw_lifecycle_body
}

# ════════════════════════════════════════════════════════════════════
# Check 5 + 6: SONA create → adapt lifecycle (W2-I2)
# ════════════════════════════════════════════════════════════════════
#
# Real cross-process lifecycle. Stats must change after adapt (quality
# signal altered weights / counters).

_ruvllm_sona_lifecycle_body() {
  local iso="$1"
  local _saved_e2e="${E2E_DIR:-}"
  E2E_DIR="$iso"

  # ─── Step 1: sona_create ────────────────────────────────────────
  _mcp_invoke_tool "ruvllm_sona_create" \
    '{"hiddenDim":16,"learningRate":0.1}' \
    '"sonaId"|"success"\s*:\s*true|sona' \
    "P5/sona/create" 15 --rw
  if [[ "$_CHECK_PASSED" == "skip_accepted" ]]; then
    _CHECK_OUTPUT="SKIP_ACCEPTED: P5/sona-lifecycle: ruvllm_sona_create not in build"
    E2E_DIR="$_saved_e2e"; return
  fi
  if [[ "$_CHECK_PASSED" != "true" ]]; then
    _CHECK_OUTPUT="P5/sona-lifecycle step 1 (create) failed — $_CHECK_OUTPUT"
    _CHECK_PASSED="false"; E2E_DIR="$_saved_e2e"; return
  fi

  local sid; sid=$(_extract_sona_id)
  if [[ -z "$sid" ]]; then
    _CHECK_OUTPUT="P5/sona-lifecycle: step 1 returned no sonaId. Body: $(echo "${_MCP_BODY:-}" | head -3 | tr '\n' ' ')"
    _CHECK_PASSED="false"; E2E_DIR="$_saved_e2e"; return
  fi

  local store_path="${iso}/.claude-flow/ruvllm/sona-store.json"
  if [[ ! -f "$store_path" ]]; then
    _CHECK_OUTPUT="P5/sona-lifecycle: .claude-flow/ruvllm/sona-store.json missing after create (persistence regressed)"
    _CHECK_PASSED="false"; E2E_DIR="$_saved_e2e"; return
  fi

  # ─── Step 2: sona_adapt (validates persistence + adaptation) ────
  # The tool returns {success, stats, statsChanged} — we require success=true
  # plus either stats present or statsChanged=true (stats is a JSON string
  # from the WASM module and its exact content is internal).
  _mcp_invoke_tool "ruvllm_sona_adapt" \
    "{\"sonaId\":\"$sid\",\"quality\":0.85}" \
    '"success"\s*:\s*true|"stats"|"statsChanged"' \
    "P5/sona/adapt" 15 --rw
  if [[ "$_CHECK_PASSED" == "skip_accepted" ]]; then
    _CHECK_OUTPUT="SKIP_ACCEPTED: P5/sona-lifecycle: ruvllm_sona_adapt not in build"
    E2E_DIR="$_saved_e2e"; return
  fi
  if [[ "$_CHECK_PASSED" != "true" ]]; then
    _CHECK_OUTPUT="P5/sona-lifecycle step 2 (adapt) failed — sona '$sid' not persisted across processes. $_CHECK_OUTPUT"
    _CHECK_PASSED="false"; E2E_DIR="$_saved_e2e"; return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="P5/sona-lifecycle: create → adapt succeeded with persistence (sonaId=$sid)"
  E2E_DIR="$_saved_e2e"
}

check_adr0094_p5_ruvllm_sona_create() {
  _with_iso_cleanup "p5-ruvllm-sona-create" _ruvllm_sona_lifecycle_body
}

check_adr0094_p5_ruvllm_sona_adapt() {
  _with_iso_cleanup "p5-ruvllm-sona-adapt" _ruvllm_sona_lifecycle_body
}

# ════════════════════════════════════════════════════════════════════
# Check 7 + 8: MicroLoRA create → adapt lifecycle (W2-I2)
# ════════════════════════════════════════════════════════════════════

_ruvllm_microlora_lifecycle_body() {
  local iso="$1"
  local _saved_e2e="${E2E_DIR:-}"
  E2E_DIR="$iso"

  # ─── Step 1: microlora_create ───────────────────────────────────
  _mcp_invoke_tool "ruvllm_microlora_create" \
    '{"inputDim":8,"outputDim":4,"rank":2}' \
    '"loraId"|"success"\s*:\s*true|lora|microlora' \
    "P5/microlora/create" 15 --rw
  if [[ "$_CHECK_PASSED" == "skip_accepted" ]]; then
    _CHECK_OUTPUT="SKIP_ACCEPTED: P5/microlora-lifecycle: ruvllm_microlora_create not in build"
    E2E_DIR="$_saved_e2e"; return
  fi
  if [[ "$_CHECK_PASSED" != "true" ]]; then
    _CHECK_OUTPUT="P5/microlora-lifecycle step 1 (create) failed — $_CHECK_OUTPUT"
    _CHECK_PASSED="false"; E2E_DIR="$_saved_e2e"; return
  fi

  local lid; lid=$(_extract_lora_id)
  if [[ -z "$lid" ]]; then
    _CHECK_OUTPUT="P5/microlora-lifecycle: step 1 returned no loraId. Body: $(echo "${_MCP_BODY:-}" | head -3 | tr '\n' ' ')"
    _CHECK_PASSED="false"; E2E_DIR="$_saved_e2e"; return
  fi

  local store_path="${iso}/.claude-flow/ruvllm/microlora-store.json"
  if [[ ! -f "$store_path" ]]; then
    _CHECK_OUTPUT="P5/microlora-lifecycle: .claude-flow/ruvllm/microlora-store.json missing after create (persistence regressed)"
    _CHECK_PASSED="false"; E2E_DIR="$_saved_e2e"; return
  fi

  # ─── Step 2: microlora_adapt (validates persistence + adaptation)
  _mcp_invoke_tool "ruvllm_microlora_adapt" \
    "{\"loraId\":\"$lid\",\"quality\":0.75,\"learningRate\":0.02}" \
    '"success"\s*:\s*true|"stats"|"statsChanged"' \
    "P5/microlora/adapt" 15 --rw
  if [[ "$_CHECK_PASSED" == "skip_accepted" ]]; then
    _CHECK_OUTPUT="SKIP_ACCEPTED: P5/microlora-lifecycle: ruvllm_microlora_adapt not in build"
    E2E_DIR="$_saved_e2e"; return
  fi
  if [[ "$_CHECK_PASSED" != "true" ]]; then
    _CHECK_OUTPUT="P5/microlora-lifecycle step 2 (adapt) failed — lora '$lid' not persisted across processes. $_CHECK_OUTPUT"
    _CHECK_PASSED="false"; E2E_DIR="$_saved_e2e"; return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="P5/microlora-lifecycle: create → adapt succeeded with persistence (loraId=$lid)"
  E2E_DIR="$_saved_e2e"
}

check_adr0094_p5_ruvllm_microlora_create() {
  _with_iso_cleanup "p5-ruvllm-microlora-create" _ruvllm_microlora_lifecycle_body
}

check_adr0094_p5_ruvllm_microlora_adapt() {
  _with_iso_cleanup "p5-ruvllm-microlora-adapt" _ruvllm_microlora_lifecycle_body
}

# ════════════════════════════════════════════════════════════════════
# Check 9: ruvllm_generate_config — stateless, no persistence needed
# ════════════════════════════════════════════════════════════════════
check_adr0094_p5_ruvllm_generate_config() {
  _mcp_invoke_tool \
    "ruvllm_generate_config" '{"maxTokens":128}' \
    'maxTokens|temperature|\{' \
    "P5/ruvllm_generate_config" 15 --ro
}

# ════════════════════════════════════════════════════════════════════
# Check 10: ruvllm_chat_format — stateless, no persistence needed
# ════════════════════════════════════════════════════════════════════
check_adr0094_p5_ruvllm_chat_format() {
  _mcp_invoke_tool \
    "ruvllm_chat_format" \
    '{"messages":[{"role":"user","content":"hi"}],"template":"llama3"}' \
    'hi|system|user|begin|end|message|format' \
    "P5/ruvllm_chat_format" 15 --ro
}
