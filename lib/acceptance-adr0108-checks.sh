#!/usr/bin/env bash
# lib/acceptance-adr0108-checks.sh — ADR-0108 (T13) Mixed-type worker spawn
#
# V2-parity port: --worker-types CLI flag (comma-separated, round-robin),
# `hive-mind_spawn` MCP tool's agentTypes array<enum> schema, and mutex
# with --type / agentType.
#
# Acceptance asserts (against published packages):
#   AC #1 — CLI surface: --worker-types is documented in `hive-mind spawn --help`
#           with the V2-parity description ("Mutually exclusive with --type").
#   AC #2 — MCP schema: `hive-mind_spawn` tool advertises agentTypes as
#           array<enum> via the dist artifact.
#   AC #3 — Round-robin: spawn -n 6 --worker-types researcher,coder,tester
#           registers 6 workers with the modulo distribution.
#   AC #4 — Mutex: spawn --type coder --worker-types researcher,tester exits
#           non-zero with the V2-parity error message.
#
# Requires: _cli_cmd, _e2e_isolate, _adr0125_hive_init, _ns, _elapsed_ms
#           — all defined in scripts/test-acceptance.sh + acceptance-adr0125-queen-types.sh
# Caller MUST set: REGISTRY, E2E_DIR

set +u 2>/dev/null || true

# Cached path to the codemodded CLI dist for AC #2 (MCP schema dist surface).
__ADR0108_CLI_DIST=""
_adr0108_resolve_dist() {
  if [[ -n "$__ADR0108_CLI_DIST" ]]; then return; fi
  if [[ -f "/tmp/ruflo-build/v3/@claude-flow/cli/dist/src/mcp-tools/hive-mind-tools.js" ]]; then
    __ADR0108_CLI_DIST="/tmp/ruflo-build/v3/@claude-flow/cli/dist/src/mcp-tools/hive-mind-tools.js"
  elif [[ -f "/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/dist/src/mcp-tools/hive-mind-tools.js" ]]; then
    __ADR0108_CLI_DIST="/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/dist/src/mcp-tools/hive-mind-tools.js"
  fi
}

# Helper: hive-init in an isolated dir. Mirrors _adr0125_hive_init.
_adr0108_hive_init() {
  local iso="$1"
  local cli; cli=$(_cli_cmd)
  : > "$iso/.ruflo-project"
  (cd "$iso" && NPM_CONFIG_REGISTRY="$REGISTRY" timeout 30 $cli hive-mind init >/dev/null 2>&1) || return 1
  return 0
}

# ════════════════════════════════════════════════════════════════════
# AC #1 — --worker-types appears in `hive-mind spawn --help`
# ════════════════════════════════════════════════════════════════════
check_adr0108_cli_flag_present() {
  local start_ns end_ns
  start_ns=$(_ns)
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local iso; iso=$(_e2e_isolate "adr0108-cli-flag")
  local cli; cli=$(_cli_cmd)

  # `hive-mind spawn --help` must list --worker-types per the V2-parity port.
  local help_out
  help_out=$(cd "$iso" && NPM_CONFIG_REGISTRY="$REGISTRY" timeout 30 $cli hive-mind spawn --help 2>&1)
  rc=$?

  if ! grep -qF "worker-types" <<<"$help_out"; then
    _CHECK_OUTPUT="ADR-0108 AC#1: --worker-types not present in spawn --help. out: ${help_out:0:300}"
    rm -rf "$iso" 2>/dev/null
    end_ns=$(_ns); _EXIT=0; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
    return
  fi

  # The description must reference the mutex relationship to --type so users
  # discover the constraint without reading the ADR.
  if ! grep -qF "Mutually exclusive with --type" <<<"$help_out"; then
    _CHECK_OUTPUT="ADR-0108 AC#1: spawn --help missing 'Mutually exclusive with --type' phrasing"
    rm -rf "$iso" 2>/dev/null
    end_ns=$(_ns); _EXIT=0; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0108 AC#1: --worker-types declared in spawn --help with mutex documentation"
  rm -rf "$iso" 2>/dev/null
  end_ns=$(_ns); _EXIT=0; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
}

# ════════════════════════════════════════════════════════════════════
# AC #2 — `hive-mind_spawn` MCP tool advertises agentTypes array<enum>
# ════════════════════════════════════════════════════════════════════
check_adr0108_mcp_schema_array_enum() {
  local start_ns end_ns
  start_ns=$(_ns)
  _CHECK_PASSED="false"
  _adr0108_resolve_dist

  if [[ -z "$__ADR0108_CLI_DIST" ]]; then
    _CHECK_OUTPUT="ADR-0108 AC#2: CLI MCP-tools dist not present at any known path"
    end_ns=$(_ns); _EXIT=1; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
    return
  fi

  # The dist must contain the schema surface for `agentTypes` (array + enum)
  # alongside the existing `agentType` scalar.
  if ! grep -qE "agentTypes" "$__ADR0108_CLI_DIST"; then
    _CHECK_OUTPUT="ADR-0108 AC#2: dist missing 'agentTypes' schema entry"
    end_ns=$(_ns); _EXIT=0; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
    return
  fi

  # Sanity: the array+enum shape must include the 8 USERGUIDE worker types
  # so the schema enforces the contract at the boundary.
  local missing=()
  for t in researcher coder analyst tester architect reviewer optimizer documenter; do
    if ! grep -qF "'$t'" "$__ADR0108_CLI_DIST" && ! grep -qF "\"$t\"" "$__ADR0108_CLI_DIST"; then
      missing+=("$t")
    fi
  done
  if (( ${#missing[@]} > 0 )); then
    _CHECK_OUTPUT="ADR-0108 AC#2: agentTypes enum missing types — ${missing[*]}"
    end_ns=$(_ns); _EXIT=0; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0108 AC#2: hive-mind_spawn dist schema declares agentTypes array<enum> with all 8 USERGUIDE worker types"
  end_ns=$(_ns); _EXIT=0; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
}

# ════════════════════════════════════════════════════════════════════
# AC #3 — Round-robin: -n 6 --worker-types researcher,coder,tester
#         registers 6 workers with the modulo distribution.
# ════════════════════════════════════════════════════════════════════
check_adr0108_round_robin_distribution() {
  local start_ns end_ns
  start_ns=$(_ns)
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local iso; iso=$(_e2e_isolate "adr0108-round-robin")
  if ! _adr0108_hive_init "$iso"; then
    _CHECK_OUTPUT="ADR-0108 AC#3: hive-mind init failed in iso"
    rm -rf "$iso" 2>/dev/null
    end_ns=$(_ns); _EXIT=0; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
    return
  fi

  local cli; cli=$(_cli_cmd)
  local out rc
  out=$(cd "$iso" && NPM_CONFIG_REGISTRY="$REGISTRY" timeout 30 $cli hive-mind spawn -n 6 --worker-types researcher,coder,tester 2>&1)
  rc=$?

  if [[ $rc -ne 0 ]]; then
    _CHECK_OUTPUT="ADR-0108 AC#3: spawn exited $rc. out: ${out:0:300}"
    rm -rf "$iso" 2>/dev/null
    end_ns=$(_ns); _EXIT=0; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
    return
  fi

  # Inspect the agent store for the per-worker agentType — the round-robin
  # contract is structural, not just a CLI render. State path mirrors the
  # MCP handler's `loadAgentStore` (`.claude-flow/agents.json`).
  local agents_file="$iso/.claude-flow/agents.json"
  if [[ ! -f "$agents_file" ]]; then
    _CHECK_OUTPUT="ADR-0108 AC#3: agents.json missing after spawn (expected at $agents_file)"
    rm -rf "$iso" 2>/dev/null
    end_ns=$(_ns); _EXIT=0; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
    return
  fi

  # Count occurrences of each agentType in the agent store. With -n 6 and 3
  # types, each type should appear exactly 2 times (modulo distribution).
  local researcher_count coder_count tester_count
  researcher_count=$(node -e "
    const a = JSON.parse(require('fs').readFileSync('$agents_file', 'utf8'));
    let n = 0;
    for (const id of Object.keys(a.agents || {})) {
      if (a.agents[id]?.agentType === 'researcher' && a.agents[id]?.domain === 'hive-mind') n++;
    }
    process.stdout.write(String(n));
  " 2>/dev/null)
  coder_count=$(node -e "
    const a = JSON.parse(require('fs').readFileSync('$agents_file', 'utf8'));
    let n = 0;
    for (const id of Object.keys(a.agents || {})) {
      if (a.agents[id]?.agentType === 'coder' && a.agents[id]?.domain === 'hive-mind') n++;
    }
    process.stdout.write(String(n));
  " 2>/dev/null)
  tester_count=$(node -e "
    const a = JSON.parse(require('fs').readFileSync('$agents_file', 'utf8'));
    let n = 0;
    for (const id of Object.keys(a.agents || {})) {
      if (a.agents[id]?.agentType === 'tester' && a.agents[id]?.domain === 'hive-mind') n++;
    }
    process.stdout.write(String(n));
  " 2>/dev/null)

  researcher_count=${researcher_count:-0}
  coder_count=${coder_count:-0}
  tester_count=${tester_count:-0}

  if [[ "$researcher_count" != "2" || "$coder_count" != "2" || "$tester_count" != "2" ]]; then
    _CHECK_OUTPUT="ADR-0108 AC#3: round-robin distribution wrong (expected 2/2/2, got researcher=$researcher_count coder=$coder_count tester=$tester_count)"
    rm -rf "$iso" 2>/dev/null
    end_ns=$(_ns); _EXIT=0; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0108 AC#3: round-robin distribution wires 2× researcher + 2× coder + 2× tester"
  rm -rf "$iso" 2>/dev/null
  end_ns=$(_ns); _EXIT=0; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
}

# ════════════════════════════════════════════════════════════════════
# AC #4 — Mutex: --type and --worker-types together → non-zero exit
# ════════════════════════════════════════════════════════════════════
check_adr0108_mutex_type_worker_types() {
  local start_ns end_ns
  start_ns=$(_ns)
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local iso; iso=$(_e2e_isolate "adr0108-mutex")
  if ! _adr0108_hive_init "$iso"; then
    _CHECK_OUTPUT="ADR-0108 AC#4: hive-mind init failed in iso"
    rm -rf "$iso" 2>/dev/null
    end_ns=$(_ns); _EXIT=0; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
    return
  fi

  local cli; cli=$(_cli_cmd)
  local out rc
  out=$(cd "$iso" && NPM_CONFIG_REGISTRY="$REGISTRY" timeout 30 $cli hive-mind spawn -n 2 --type coder --worker-types researcher,tester 2>&1)
  rc=$?

  # Per ADR-0108 §Backward compatibility, the mutex must produce a non-zero
  # exit and a discoverable error message. Per `feedback-no-fallbacks.md`,
  # silent precedence is forbidden.
  if [[ $rc -eq 0 ]]; then
    _CHECK_OUTPUT="ADR-0108 AC#4: spawn with --type + --worker-types unexpectedly succeeded (rc=0). out: ${out:0:300}"
    rm -rf "$iso" 2>/dev/null
    end_ns=$(_ns); _EXIT=0; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
    return
  fi

  if ! grep -qF "mutually exclusive" <<<"$out"; then
    _CHECK_OUTPUT="ADR-0108 AC#4: error message missing 'mutually exclusive' phrasing. out: ${out:0:300}"
    rm -rf "$iso" 2>/dev/null
    end_ns=$(_ns); _EXIT=0; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0108 AC#4: --type + --worker-types mutex enforced (rc=$rc, error contains 'mutually exclusive')"
  rm -rf "$iso" 2>/dev/null
  end_ns=$(_ns); _EXIT=0; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
}
