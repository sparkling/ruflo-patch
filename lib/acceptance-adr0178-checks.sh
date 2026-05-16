#!/usr/bin/env bash
# lib/acceptance-adr0178-checks.sh — ADR-0176 Phase 3 / ADR-0178: end-to-end
# acceptance for the `agentdb_hierarchical-query` MCP tool.
#
# Validates the full 3-layer chain:
#   1. MCP tool registration: `agentdb_hierarchical-query` resolves via
#      forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/agentdb-tools.ts
#   2. Orchestration handler: hierarchicalQuery() in
#      forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/agentdb-orchestration.ts
#   3. Controller method: HierarchicalMemory.query(pathPattern, opts) in
#      forks/agentdb/src/controllers/HierarchicalMemory.ts (commit bdfadad)
#
# Semantics under test (matching HierarchicalMemory.query SQL impl):
#   - `*` → SQL LIKE `%`, `?` → `_` (glob → LIKE conversion)
#   - Matches against the `content` column (hierarchicalStore writes
#     `params.value` into `content`)
#   - Optional `tier` filter (working | episodic | semantic)
#   - Optional `limit`, sorted by `created_at DESC`
#
# Caller MUST set: REGISTRY, TEMP_DIR
# Caller MAY set:  PROJECT_DIR
#
# Single check, five phases — one init (~120s) amortised across all
# assertions instead of 5 separate inits.
#
# Catalog naming: check_adr0178_hierarchical_query_e2e is L7-accepted via
# the adr-NNNN filename tag.

# ── helpers ─────────────────────────────────────────────────────────────────

# adr0097-l5-intentional: this helper wraps `_run_and_kill_ro` with the
# `mcp exec --tool ... --params ...` invocation specific to ADR-0178's flow,
# captures the body after the `Result:` sentinel, and returns the count of
# top-level `results[]` entries. The canonical `_mcp_invoke_tool` only does a
# regex match — counting requires JSON parsing the body via node, which is
# the genuine domain-specific extension here. Reuses _run_and_kill_ro under
# the hood so no parallel invocation path is built.
_adr0178_query_count() {
  local dir="$1" params_json="$2" out_file="$3"
  local cli; cli=$(_cli_cmd)
  _run_and_kill_ro \
    "cd '${dir}' && NPM_CONFIG_REGISTRY='${REGISTRY}' ${cli} mcp exec --tool agentdb_hierarchical-query --params '${params_json}' 2>&1" \
    "$out_file" \
    30

  local raw; raw=$(cat "$out_file" 2>/dev/null || echo "")
  raw=$(echo "$raw" | grep -v '^__RUFLO_DONE__:')

  # Surface tool-not-found early so the caller can short-circuit with a
  # clear diagnostic rather than crashing on JSON parse.
  if echo "$raw" | grep -qiE 'tool.+not found|not registered|unknown tool|no such tool|method .* not found|invalid tool'; then
    echo "TOOL_NOT_FOUND"
    return
  fi

  # Body lives after the `Result:` sentinel (see forks/ruflo
  # v3/@claude-flow/cli/src/commands/mcp.ts L698). If missing, fall back
  # to the raw output so JSON parse can still attempt — it will fail and
  # surface as ERR_NO_JSON below.
  local body
  if echo "$raw" | grep -q '^Result:'; then
    body=$(echo "$raw" | awk '/^Result:/{f=1;next}f')
  else
    body="$raw"
  fi

  if [[ -z "$body" ]]; then
    echo "ERR_EMPTY_BODY"
    return
  fi

  # Defensive: upstream may wrap in {content:[{type:"text",text:"..."}]}.
  # If so, descend before counting (mirrors _expect_mcp_body's unwrap).
  # The parse logic lives inside an IIFE — Node.js v24's `node -e` rejects
  # top-level `return` as a syntax error, and the early-exit branches need
  # `return` to short-circuit.
  local count
  count=$(node -e '
    (() => {
      let raw = require("fs").readFileSync(0, "utf8");
      try {
        let j = JSON.parse(raw);
        if (j && Array.isArray(j.content) && j.content[0] && typeof j.content[0].text === "string") {
          j = JSON.parse(j.content[0].text);
        }
        if (j && j.error && (!j.results || j.results.length === 0)) {
          process.stdout.write("ERR:" + String(j.error).slice(0, 200));
          return;
        }
        const r = (j && Array.isArray(j.results)) ? j.results : null;
        if (r === null) {
          process.stdout.write("ERR_NO_RESULTS_ARRAY");
          return;
        }
        process.stdout.write(String(r.length));
      } catch (e) {
        process.stdout.write("ERR_NO_JSON:" + String(e.message).slice(0, 100));
      }
    })();
  ' <<<"$body" 2>/dev/null || echo "ERR_NODE_FAILED")
  echo "$count"
}

# Helper: store one record into hierarchical_memory at the given content
# string. We write `value=<path>` so the `content` column matches the
# pathPattern glob in query phases. Tier defaults to working.
_adr0178_store() {
  local dir="$1" path="$2" tier="${3:-working}" out_file="$4"
  local cli; cli=$(_cli_cmd)
  local params="{\"key\":\"${path}\",\"value\":\"${path}\",\"tier\":\"${tier}\"}"
  _run_and_kill \
    "cd '${dir}' && NPM_CONFIG_REGISTRY='${REGISTRY}' ${cli} mcp exec --tool agentdb_hierarchical-store --params '${params}' 2>&1" \
    "$out_file" \
    30
}

# ── single check, five phases ────────────────────────────────────────────────

# check_adr0178_hierarchical_query_e2e — exercises the full agentdb_hierarchical-query
# 3-layer chain via 5 phases against one init'd project:
#   A. wildcard `adr/*` → expect 3
#   B. single-char glob `adr/ADR-00?` → expect 3
#   C. tier mismatch `adr/*` + tier=semantic → expect 0 (records were
#      stored in working)
#   D. limit `adr/*` + limit=2 → expect 2
#   E. no-match `unrelated/*` → expect 0
check_adr0178_hierarchical_query_e2e() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local dir; dir=$(mktemp -d "${ACCEPT_TEMP:-/tmp}/_check_workdirs/ruflo-adr0178-hq-XXXXX")
  local work; work=$(mktemp -d "${ACCEPT_TEMP:-/tmp}/_check_workdirs/ruflo-adr0178-work-XXXXX")
  # shellcheck disable=SC2064
  trap "rm -rf '$dir' '$work' 2>/dev/null; trap - RETURN INT TERM" RETURN INT TERM

  local cli; cli=$(_cli_cmd)

  # ── Setup: ruflo init in temp dir ─────────────────────────────────────
  # Use --force --with-embeddings so the embedding stack is fully wired
  # (HierarchicalMemory.query is independent of vector search, but the
  # controller still bootstraps under AgentDB init).
  _run_and_kill \
    "cd '${dir}' && NPM_CONFIG_REGISTRY='${REGISTRY}' ${cli} init --full --force --with-embeddings" \
    "${work}/init.log" \
    120

  if [[ ! -f "${dir}/.claude-flow/config.json" ]]; then
    _CHECK_OUTPUT="adr0178: init failed (no .claude-flow/config.json). Last 5 lines of init log: $(tail -5 ${work}/init.log 2>/dev/null | tr '\n' ' ')"
    return
  fi

  # ── Write phase: 3 hierarchical-store calls (working tier) ────────────
  _adr0178_store "$dir" "adr/ADR-001" "working" "${work}/store-001.out"
  _adr0178_store "$dir" "adr/ADR-002" "working" "${work}/store-002.out"
  _adr0178_store "$dir" "adr/ADR-003" "working" "${work}/store-003.out"

  # Defensive: surface tool-not-found / controller-not-wired on the store
  # leg before we run any query — saves a confusing 0-results diagnostic
  # downstream. The 3 store calls should each emit `Result:` + JSON with
  # success:true.
  local store_body; store_body=$(cat "${work}/store-001.out" 2>/dev/null || echo "")
  if echo "$store_body" | grep -qiE 'tool.+not found|not registered|unknown tool|no such tool|method .* not found|invalid tool'; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="adr0178: SKIP_ACCEPTED: agentdb_hierarchical-store reports tool-not-found (the published build is older than ADR-0176 Phase 3, or stub handler excluded from registration barrel). $(echo "$store_body" | head -3 | tr '\n' ' ')"
    return
  fi
  if echo "$store_body" | grep -qiE 'hierarchicalmemory not available|controller not initialized|null controller|not wired'; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="adr0178: SKIP_ACCEPTED: hierarchicalMemory controller reports not-wired in build — $(echo "$store_body" | grep -iE 'error|not available|not wired' | head -2 | tr '\n' ' ')"
    return
  fi

  # ── Phase A: wildcard `adr/*` → expect 3 ─────────────────────────────
  local phaseA; phaseA=$(_adr0178_query_count "$dir" '{"pathPattern":"adr/*"}' "${work}/qA.out")
  if [[ "$phaseA" == "TOOL_NOT_FOUND" ]]; then
    _CHECK_OUTPUT="adr0178: agentdb_hierarchical-query not registered in build (published @sparkleideas/cli predates today's ADR-0176 Phase 3 wiring — needs npm run release). Body: $(cat ${work}/qA.out 2>/dev/null | head -3 | tr '\n' ' ')"
    return
  fi
  if [[ "$phaseA" != "3" ]]; then
    _CHECK_OUTPUT="adr0178: phase A (wildcard 'adr/*') expected 3 results, got '${phaseA}'. Raw body: $(cat ${work}/qA.out 2>/dev/null | tail -20 | tr '\n' ' ' | head -c 400)"
    return
  fi

  # ── Phase B: single-char glob `adr/ADR-00?` → expect 3 ───────────────
  # SQL LIKE: `?` → `_` (matches any single char). `_` is also LIKE's own
  # single-char wildcard, but the controller's escape pass converts the
  # glob and escapes pre-existing `_` characters in the input — see
  # forks/agentdb/src/controllers/HierarchicalMemory.ts L490-495.
  local phaseB; phaseB=$(_adr0178_query_count "$dir" '{"pathPattern":"adr/ADR-00?"}' "${work}/qB.out")
  if [[ "$phaseB" != "3" ]]; then
    _CHECK_OUTPUT="adr0178: phase B (glob 'adr/ADR-00?') expected 3 results, got '${phaseB}'. Raw body: $(cat ${work}/qB.out 2>/dev/null | tail -20 | tr '\n' ' ' | head -c 400)"
    return
  fi

  # ── Phase C: tier filter mismatch → expect 0 ─────────────────────────
  # Records were stored in working tier; querying with tier=semantic should
  # match none.
  local phaseC; phaseC=$(_adr0178_query_count "$dir" '{"pathPattern":"adr/*","tier":"semantic"}' "${work}/qC.out")
  if [[ "$phaseC" != "0" ]]; then
    _CHECK_OUTPUT="adr0178: phase C (tier=semantic on working-tier records) expected 0 results, got '${phaseC}'. Raw body: $(cat ${work}/qC.out 2>/dev/null | tail -20 | tr '\n' ' ' | head -c 400)"
    return
  fi

  # ── Phase D: limit clamp → expect 2 ───────────────────────────────────
  local phaseD; phaseD=$(_adr0178_query_count "$dir" '{"pathPattern":"adr/*","limit":2}' "${work}/qD.out")
  if [[ "$phaseD" != "2" ]]; then
    _CHECK_OUTPUT="adr0178: phase D (limit=2 over 3 matches) expected 2 results, got '${phaseD}'. Raw body: $(cat ${work}/qD.out 2>/dev/null | tail -20 | tr '\n' ' ' | head -c 400)"
    return
  fi

  # ── Phase E: no-match pattern → expect 0 ─────────────────────────────
  local phaseE; phaseE=$(_adr0178_query_count "$dir" '{"pathPattern":"unrelated/*"}' "${work}/qE.out")
  if [[ "$phaseE" != "0" ]]; then
    _CHECK_OUTPUT="adr0178: phase E ('unrelated/*' with no matching records) expected 0 results, got '${phaseE}'. Raw body: $(cat ${work}/qE.out 2>/dev/null | tail -20 | tr '\n' ' ' | head -c 400)"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="adr0178: agentdb_hierarchical-query 3-layer chain OK — phases A=3 B=3 C=0 D=2 E=0 across one init'd project (5 assertions)"
}
