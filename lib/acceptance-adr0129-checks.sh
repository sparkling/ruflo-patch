#!/usr/bin/env bash
# lib/acceptance-adr0129-checks.sh — ADR-0129 hive-mind CLI bug closeout
# (B1 memory store, B2 shutdown fields, B4 -t a,b,c comma-split).
#
# Asserts the post-fix target state for the three CLI bugs that were
# closed in the parallel fork commit (see ADR-0129 §Status). B3 was
# closed earlier in 4fcd79605 and is covered by ADR-0116 AC#5 + AC#6.
#
# Conventions (per CLAUDE.md memories):
#   - `_cli_cmd` helper (memory reference-cli-cmd-helper) — never raw
#     `npx @sparkleideas/cli@latest` (36x slower from npm cache lock).
#   - Captures full output to a per-check ".log" file (memory
#     feedback-no-tail-tests + feedback-full-test-output): NEVER pipe
#     mid-stream; grep the log file AFTER each step completes.
#   - Uses `var=$(grep -c ...); var=${var:-0}` (memory
#     reference-grep-c-bash-trap): `grep -c pat || echo 0` produces
#     "0\n0" on no-match and trips bash arithmetic.
#   - Each assertion explicitly fails (memory feedback-no-fallbacks) —
#     no silent skips, no "warn and continue".
#
# Operates on:
#   - $E2E_DIR (pre-init'd hive workspace, pre-installed CLI)
#   - /tmp/ruflo-adr0129-{B1,B2,B4}/ per-check logs

# ════════════════════════════════════════════════════════════════════
# AC #B1 — `hive-mind memory store <key> <value>` persists.
#
# Pre-fix: positional `store` was dropped, action defaulted to `list`,
# value never persisted. Post-fix (target state): `ctx.args[0]` is
# matched against MEMORY_ACTIONS (including the `store` alias of `set`),
# `key`/`value` accepted positionally, `set` action requires `--type`
# (any of MEMORY_TYPES per ADR-0122 T4).
#
# Sequence: init -> memory store knowledge testkey-adr0129 testvalue ->
# memory list -> grep for testkey-adr0129. Pass when the key appears in
# the post-store list output.
# ════════════════════════════════════════════════════════════════════

check_adr0129_b1_memory_store() {
  local start_ns end_ns
  start_ns=$(_ns)
  _CHECK_PASSED="false"

  local test_dir="/tmp/ruflo-adr0129-B1"
  local log="${test_dir}/.log"
  rm -rf "$test_dir"
  mkdir -p "$test_dir"

  local cli; cli=$(_cli_cmd)
  local key="testkey-adr0129"
  local value="testvalue-adr0129"

  # 1) Init the hive (force non-interactive). Capture full output.
  : > "$log"
  ( cd "$E2E_DIR" && NPM_CONFIG_REGISTRY="$REGISTRY" \
      _timeout 30 bash -c "$cli hive-mind init --topology hierarchical-mesh --consensus byzantine 2>&1" \
  ) >> "$log" 2>&1 || true

  # 2) Store the key (positional dispatch — `store` alias for `set`).
  # ADR-0122 T4 requires `--type` for set; pass `knowledge` (a valid
  # MEMORY_TYPES enum value).
  ( cd "$E2E_DIR" && NPM_CONFIG_REGISTRY="$REGISTRY" \
      _timeout 20 bash -c "$cli hive-mind memory store $key $value --type knowledge 2>&1" \
  ) >> "$log" 2>&1 || true

  # 3) List keys. Pass when our key appears.
  local list_log="${test_dir}/list.log"
  ( cd "$E2E_DIR" && NPM_CONFIG_REGISTRY="$REGISTRY" \
      _timeout 20 bash -c "$cli hive-mind memory list 2>&1" \
  ) > "$list_log" 2>&1 || true

  # Per memory reference-grep-c-bash-trap.
  local hits
  hits=$(grep -c "$key" "$list_log")
  hits=${hits:-0}

  if (( hits == 0 )); then
    _CHECK_OUTPUT="ADR-0129 B1 failed: memory store no-op — '$key' not in list output (logs: $log, $list_log; first 10 list lines: $(head -10 "$list_log" 2>/dev/null | tr '\n' ' '))"
    end_ns=$(_ns); _EXIT=0; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0129 B1 PASS: memory store '$key' persisted ($hits hit(s) in subsequent list)"
  end_ns=$(_ns); _EXIT=0; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
}

# ════════════════════════════════════════════════════════════════════
# AC #B2 — `hive-mind shutdown` renders telemetry without `undefined`.
#
# Pre-fix: MCP tool returned `workersTerminated`/`shutdownAt`/`graceful`
# while CLI printer read `agentsTerminated`/`stateSaved`/`shutdownTime`.
# Output: "Agents terminated: undefined", "State saved: No",
# "Shutdown time: undefined". Post-fix (target state): MCP tool emits
# `agentsTerminated` (numeric), `stateSaved: true`, `shutdownTime`
# (ISO timestamp). CLI printer reads the same keys, so the rendered
# output contains a numeric agentsTerminated value AND a Yes/No for
# stateSaved (NOT `undefined`).
#
# Sequence: init -> spawn -n 2 -> shutdown --force. Capture output and
# assert on the rendered field labels.
# ════════════════════════════════════════════════════════════════════

check_adr0129_b2_shutdown_fields() {
  local start_ns end_ns
  start_ns=$(_ns)
  _CHECK_PASSED="false"

  local test_dir="/tmp/ruflo-adr0129-B2"
  local log="${test_dir}/.log"
  local shutdown_log="${test_dir}/shutdown.log"
  rm -rf "$test_dir"
  mkdir -p "$test_dir"

  local cli; cli=$(_cli_cmd)

  : > "$log"
  # 1) Init.
  ( cd "$E2E_DIR" && NPM_CONFIG_REGISTRY="$REGISTRY" \
      _timeout 30 bash -c "$cli hive-mind init --topology hierarchical-mesh --consensus byzantine 2>&1" \
  ) >> "$log" 2>&1 || true

  # 2) Spawn 2 workers so shutdown has a non-zero count to render.
  ( cd "$E2E_DIR" && NPM_CONFIG_REGISTRY="$REGISTRY" \
      _timeout 20 bash -c "$cli hive-mind spawn -n 2 2>&1" \
  ) >> "$log" 2>&1 || true

  # 3) Shutdown (--force skips the interactive confirm). Capture into
  # shutdown_log so the assertions are scoped to the shutdown surface.
  ( cd "$E2E_DIR" && NPM_CONFIG_REGISTRY="$REGISTRY" \
      _timeout 20 bash -c "$cli hive-mind shutdown --force 2>&1" \
  ) > "$shutdown_log" 2>&1 || true

  # Assertion 1: NO 'undefined' anywhere in the shutdown rendering.
  local undef_hits
  undef_hits=$(grep -c 'undefined' "$shutdown_log")
  undef_hits=${undef_hits:-0}
  if (( undef_hits > 0 )); then
    _CHECK_OUTPUT="ADR-0129 B2 failed: $undef_hits 'undefined' string(s) in shutdown output (must be 0). First match: $(grep -m1 'undefined' "$shutdown_log" 2>/dev/null)"
    end_ns=$(_ns); _EXIT=0; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
    return
  fi

  # Assertion 2: 'Agents terminated: <digits>' appears (numeric, not
  # the literal word 'undefined' that the pre-fix shape produced).
  local agents_hits
  agents_hits=$(grep -cE 'Agents terminated: [0-9]+' "$shutdown_log")
  agents_hits=${agents_hits:-0}
  if (( agents_hits == 0 )); then
    _CHECK_OUTPUT="ADR-0129 B2 failed: no 'Agents terminated: <digits>' line in shutdown output (log: $shutdown_log, first 10 lines: $(head -10 "$shutdown_log" 2>/dev/null | tr '\n' ' '))"
    end_ns=$(_ns); _EXIT=0; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
    return
  fi

  # Assertion 3: 'State saved: Yes' or 'State saved: No' appears (the
  # CLI printer's ternary on stateSaved boolean — must be a real bool,
  # not undefined).
  local state_hits
  state_hits=$(grep -cE 'State saved: (Yes|No)' "$shutdown_log")
  state_hits=${state_hits:-0}
  if (( state_hits == 0 )); then
    _CHECK_OUTPUT="ADR-0129 B2 failed: no 'State saved: Yes|No' line in shutdown output (log: $shutdown_log, first 10 lines: $(head -10 "$shutdown_log" 2>/dev/null | tr '\n' ' '))"
    end_ns=$(_ns); _EXIT=0; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0129 B2 PASS: shutdown rendered numeric Agents terminated ($agents_hits hit) + State saved: Yes/No ($state_hits hit), zero 'undefined'"
  end_ns=$(_ns); _EXIT=0; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
}

# ════════════════════════════════════════════════════════════════════
# AC #B4 — `hive-mind spawn -t researcher,coder` produces 2 distinct
# worker types.
#
# Pre-fix: `-t` was a single string flag; `-t researcher,coder` was
# stored as a single literal type "researcher,coder" applied to all
# workers. Post-fix (target state, Option A "auto-comma-splits"): the
# CLI detects a comma in `--type`, validates each member against
# WORKER_TYPES, routes through the existing `--worker-types` array
# path with round-robin distribution. Mutex with `--worker-types`
# fires loudly if both are supplied.
#
# Sequence: init -> spawn -n 2 -t researcher,coder --format json.
# Assert the JSON workers[] array contains BOTH "researcher" and
# "coder" as distinct agentType values.
# ════════════════════════════════════════════════════════════════════

check_adr0129_b4_comma_split() {
  local start_ns end_ns
  start_ns=$(_ns)
  _CHECK_PASSED="false"

  local test_dir="/tmp/ruflo-adr0129-B4"
  local log="${test_dir}/.log"
  local spawn_log="${test_dir}/spawn.log"
  rm -rf "$test_dir"
  mkdir -p "$test_dir"

  local cli; cli=$(_cli_cmd)

  : > "$log"
  # 1) Init the hive.
  ( cd "$E2E_DIR" && NPM_CONFIG_REGISTRY="$REGISTRY" \
      _timeout 30 bash -c "$cli hive-mind init --topology hierarchical-mesh --consensus byzantine 2>&1" \
  ) >> "$log" 2>&1 || true

  # 2) Spawn 2 workers with `-t researcher,coder --format json`. The
  # JSON output prints the full MCP response, including per-worker
  # agentType field (ADR-0108 T13 round-robin contract).
  ( cd "$E2E_DIR" && NPM_CONFIG_REGISTRY="$REGISTRY" \
      _timeout 30 bash -c "$cli hive-mind spawn -n 2 -t researcher,coder --format json 2>&1" \
  ) > "$spawn_log" 2>&1 || true

  # Pull out distinct agentType values from the workers array. Use node
  # so we parse the JSON properly rather than regex on output (matches
  # ADR-0117 AC#4 robustness pattern). Per memory feedback-no-fallbacks,
  # if no workers are returned, the check fails — no silent zero-pass.
  local worker_types
  worker_types=$(node -e "
    const fs = require('fs');
    const text = fs.readFileSync('$spawn_log','utf8');
    // The JSON object is the only well-formed JSON in the output;
    // find it by matching outermost braces around 'workers'.
    const m = text.match(/\{[\s\S]*\"workers\"[\s\S]*\}/);
    if (!m) { console.log('NO_JSON'); process.exit(0); }
    try {
      const j = JSON.parse(m[0]);
      const ws = j.workers || [];
      const types = new Set(ws.map(w => w.agentType).filter(Boolean));
      console.log(Array.from(types).sort().join(','));
    } catch (e) {
      console.log('PARSE_ERR:' + e.message);
    }
  " 2>>"$log")

  if [[ "$worker_types" == "NO_JSON" || "$worker_types" == PARSE_ERR:* ]]; then
    _CHECK_OUTPUT="ADR-0129 B4 failed: spawn output did not contain parseable JSON workers array ($worker_types; log: $spawn_log, first 10 lines: $(head -10 "$spawn_log" 2>/dev/null | tr '\n' ' '))"
    end_ns=$(_ns); _EXIT=0; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
    return
  fi

  # Pre-fix path would yield types="researcher,coder" (single literal)
  # OR types="" (validateWorkerType throws). Post-fix Option A: types
  # contains BOTH "researcher" AND "coder" as distinct entries.
  if [[ "$worker_types" != *"coder"* ]] || [[ "$worker_types" != *"researcher"* ]]; then
    _CHECK_OUTPUT="ADR-0129 B4 failed: -t researcher,coder did not produce 2 distinct types (got types=[$worker_types]; expected both 'researcher' and 'coder'). Spawn log: $spawn_log"
    end_ns=$(_ns); _EXIT=0; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0129 B4 PASS: -t researcher,coder auto-comma-split produced 2 distinct worker types ($worker_types)"
  end_ns=$(_ns); _EXIT=0; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
}
