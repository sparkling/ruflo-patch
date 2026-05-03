#!/usr/bin/env bash
# lib/acceptance-hive-memory-types.sh — ADR-0122 (T4) acceptance checks
#
# Hive-mind 8 memory types with TTL:
#   §Validation  acc_t4_8_type_matrix          — 8-type round-trip with default TTLs
#   §Validation  acc_t4_ttl_expiry_short        — TTL expiry within 500ms
#   §Validation  acc_t4_type_filter_list        — list filter by type
#   §Validation  acc_t4_unknown_type_rejected   — InvalidMemoryTypeError surfaced
#   §Validation  acc_t4_missing_type_rejected   — MissingMemoryTypeError surfaced
#   §Validation  acc_t4_legacy_dict_migration   — pre-place legacy entry; migrated on read
#
# Requires: _cli_cmd, _e2e_isolate from acceptance-harness.sh + acceptance-checks.sh
# Caller MUST set: REGISTRY, TEMP_DIR (or E2E_DIR)
#
# Per `reference-cli-cmd-helper.md`: parallel checks use `$(_cli_cmd)`, NEVER raw
# `npx --yes @sparkleideas/cli@latest` (the latter serializes on npm's 23GB cache lock).

set +u 2>/dev/null || true

# Helper: initialize hive in an iso dir. Borrowed from ADR-0104 helper —
# `.ruflo-project` sentinel pins findProjectRoot to the iso dir so writes
# don't land in the parent E2E_DIR's .claude-flow/.
_t4_hive_init() {
  local iso="$1"
  local cli; cli=$(_cli_cmd)
  : > "$iso/.ruflo-project"
  (cd "$iso" && NPM_CONFIG_REGISTRY="$REGISTRY" timeout 30 $cli hive-mind init >/dev/null 2>&1) || return 1
  return 0
}

# Helper: invoke the hive-mind_memory MCP tool via `mcp exec`. Returns the
# output text in $_T4_OUT, exit code in $_T4_EXIT.
_t4_memory_call() {
  local iso="$1"
  local params_json="$2"
  local cli; cli=$(_cli_cmd)
  _T4_OUT=$(cd "$iso" && NPM_CONFIG_REGISTRY="$REGISTRY" timeout 15 $cli mcp exec --tool hive-mind_memory --params "$params_json" 2>&1)
  _T4_EXIT=$?
}

# ════════════════════════════════════════════════════════════════════
# Scenario 1: 8-type matrix round-trip with documented default TTLs.
# ════════════════════════════════════════════════════════════════════
check_adr0122_8_type_matrix() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""
  local iso; iso=$(_e2e_isolate "adr0122-8type")
  _t4_hive_init "$iso" || { _CHECK_OUTPUT="ADR-0122-§matrix: hive-mind init failed in iso"; rm -rf "$iso" 2>/dev/null; return; }

  # All 8 types; default TTL applied per USERGUIDE table.
  local -a types=(knowledge context task result error metric consensus system)
  local missing=""
  for t in "${types[@]}"; do
    _t4_memory_call "$iso" "{\"action\":\"set\",\"key\":\"k-${t}\",\"value\":\"v-${t}\",\"type\":\"${t}\"}"
    if [[ $_T4_EXIT -ne 0 ]]; then
      missing="${missing}set:${t}(rc=$_T4_EXIT);"
      continue
    fi
    # Verify get returns value AND echoes the type back
    _t4_memory_call "$iso" "{\"action\":\"get\",\"key\":\"k-${t}\"}"
    if [[ $_T4_EXIT -ne 0 ]] || ! echo "$_T4_OUT" | grep -qF "v-${t}"; then
      missing="${missing}get:${t};"
    fi
    if ! echo "$_T4_OUT" | grep -qF "\"type\""; then
      missing="${missing}type-field:${t};"
    fi
  done

  if [[ -n "$missing" ]]; then
    _CHECK_OUTPUT="ADR-0122-§matrix: round-trip failures: $missing"
    rm -rf "$iso" 2>/dev/null
    return
  fi

  # Inspect persisted state — every key should now be a typed entry
  # ({type, ttlMs, expiresAt, createdAt, updatedAt} fields present).
  local state="$iso/.claude-flow/hive-mind/state.json"
  if [[ ! -f "$state" ]]; then
    _CHECK_OUTPUT="ADR-0122-§matrix: state.json not created"
    rm -rf "$iso" 2>/dev/null
    return
  fi

  local mismatches
  mismatches=$(python3 -c "
import json, sys
expected_default_ttl = {
    'knowledge': None,
    'context': 3_600_000,
    'task': 1_800_000,
    'result': None,
    'error': 86_400_000,
    'metric': 3_600_000,
    'consensus': None,
    'system': None,
}
with open('$state') as f:
    state = json.load(f)
sm = state.get('sharedMemory', {})
fail = []
for t, expected_ttl in expected_default_ttl.items():
    key = f'k-{t}'
    if key not in sm:
        fail.append(f'{key}-missing')
        continue
    entry = sm[key]
    if not isinstance(entry, dict):
        fail.append(f'{key}-not-typed')
        continue
    for required in ('value', 'type', 'ttlMs', 'expiresAt', 'createdAt', 'updatedAt'):
        if required not in entry:
            fail.append(f'{key}-no-{required}')
    actual_ttl = entry.get('ttlMs')
    if actual_ttl != expected_ttl:
        fail.append(f'{key}-ttl-{actual_ttl}-expected-{expected_ttl}')
print(','.join(fail) if fail else 'OK')
" 2>/dev/null)
  mismatches="${mismatches:-PYTHON_FAILED}"

  if [[ "$mismatches" != "OK" ]]; then
    _CHECK_OUTPUT="ADR-0122-§matrix: state.json shape/TTL mismatches: $mismatches"
    rm -rf "$iso" 2>/dev/null
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0122-§matrix: 8-type round-trip with documented default TTLs succeeded"
  rm -rf "$iso" 2>/dev/null
}

# ════════════════════════════════════════════════════════════════════
# Scenario 2: Short TTL expiry — set ttlMs=200, sleep 500ms, get returns null.
# ════════════════════════════════════════════════════════════════════
check_adr0122_ttl_expiry_short() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""
  local iso; iso=$(_e2e_isolate "adr0122-ttl-expiry")
  _t4_hive_init "$iso" || { _CHECK_OUTPUT="ADR-0122-§ttl: hive-mind init failed in iso"; rm -rf "$iso" 2>/dev/null; return; }

  # Set with very-short TTL.
  _t4_memory_call "$iso" '{"action":"set","key":"k-short","value":"will-die","type":"task","ttlMs":200}'
  if [[ $_T4_EXIT -ne 0 ]]; then
    _CHECK_OUTPUT="ADR-0122-§ttl: set with ttlMs=200 failed (rc=$_T4_EXIT). out: ${_T4_OUT:0:300}"
    rm -rf "$iso" 2>/dev/null
    return
  fi

  # Sleep past expiry. 500ms > 200ms TTL.
  sleep 0.6

  # get should report exists=false (lazily evicted).
  _t4_memory_call "$iso" '{"action":"get","key":"k-short"}'
  if [[ $_T4_EXIT -ne 0 ]]; then
    _CHECK_OUTPUT="ADR-0122-§ttl: get on expired key failed (rc=$_T4_EXIT). out: ${_T4_OUT:0:300}"
    rm -rf "$iso" 2>/dev/null
    return
  fi

  # Output should not contain the live value, and should signal eviction
  # (via "exists":false or "evicted":true).
  if echo "$_T4_OUT" | grep -qF "will-die"; then
    _CHECK_OUTPUT="ADR-0122-§ttl: REGRESSION — expired entry still returned. out: ${_T4_OUT:0:300}"
    rm -rf "$iso" 2>/dev/null
    return
  fi

  if ! echo "$_T4_OUT" | grep -qE '"exists":\s*false|"evicted":\s*true'; then
    _CHECK_OUTPUT="ADR-0122-§ttl: get on expired key did not signal eviction. out: ${_T4_OUT:0:300}"
    rm -rf "$iso" 2>/dev/null
    return
  fi

  # Verify state.json no longer contains the key (eviction was durable).
  local state="$iso/.claude-flow/hive-mind/state.json"
  if [[ -f "$state" ]] && python3 -c "
import json
with open('$state') as f:
    state = json.load(f)
import sys
sys.exit(0 if 'k-short' in state.get('sharedMemory', {}) else 1)
" 2>/dev/null; then
    _CHECK_OUTPUT="ADR-0122-§ttl: state.json still contains 'k-short' after expiry — lazy eviction not durable"
    rm -rf "$iso" 2>/dev/null
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0122-§ttl: ttlMs=200 entry evicted within 500ms wall-clock; state.json clean"
  rm -rf "$iso" 2>/dev/null
}

# ════════════════════════════════════════════════════════════════════
# Scenario 3: Type-filter list — set 3 entries, list({type:'task'}) returns 2.
# ════════════════════════════════════════════════════════════════════
check_adr0122_type_filter_list() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""
  local iso; iso=$(_e2e_isolate "adr0122-list-filter")
  _t4_hive_init "$iso" || { _CHECK_OUTPUT="ADR-0122-§filter: hive-mind init failed in iso"; rm -rf "$iso" 2>/dev/null; return; }

  _t4_memory_call "$iso" '{"action":"set","key":"a","value":1,"type":"task"}'
  [[ $_T4_EXIT -ne 0 ]] && { _CHECK_OUTPUT="ADR-0122-§filter: set a failed: ${_T4_OUT:0:200}"; rm -rf "$iso" 2>/dev/null; return; }
  _t4_memory_call "$iso" '{"action":"set","key":"b","value":2,"type":"task"}'
  [[ $_T4_EXIT -ne 0 ]] && { _CHECK_OUTPUT="ADR-0122-§filter: set b failed: ${_T4_OUT:0:200}"; rm -rf "$iso" 2>/dev/null; return; }
  _t4_memory_call "$iso" '{"action":"set","key":"c","value":3,"type":"knowledge"}'
  [[ $_T4_EXIT -ne 0 ]] && { _CHECK_OUTPUT="ADR-0122-§filter: set c failed: ${_T4_OUT:0:200}"; rm -rf "$iso" 2>/dev/null; return; }

  _t4_memory_call "$iso" '{"action":"list","type":"task"}'
  if [[ $_T4_EXIT -ne 0 ]]; then
    _CHECK_OUTPUT="ADR-0122-§filter: list({type:task}) failed (rc=$_T4_EXIT). out: ${_T4_OUT:0:300}"
    rm -rf "$iso" 2>/dev/null
    return
  fi

  # Output should mention 'a' and 'b' but NOT 'c'.
  if ! echo "$_T4_OUT" | grep -qF '"a"' || ! echo "$_T4_OUT" | grep -qF '"b"'; then
    _CHECK_OUTPUT="ADR-0122-§filter: list({type:task}) missing expected keys. out: ${_T4_OUT:0:300}"
    rm -rf "$iso" 2>/dev/null
    return
  fi
  if echo "$_T4_OUT" | grep -qF '"c"'; then
    _CHECK_OUTPUT="ADR-0122-§filter: list({type:task}) leaked knowledge-type key 'c'. out: ${_T4_OUT:0:300}"
    rm -rf "$iso" 2>/dev/null
    return
  fi

  # Unfiltered list should contain all three.
  _t4_memory_call "$iso" '{"action":"list"}'
  if ! echo "$_T4_OUT" | grep -qF '"a"' || ! echo "$_T4_OUT" | grep -qF '"b"' || ! echo "$_T4_OUT" | grep -qF '"c"'; then
    _CHECK_OUTPUT="ADR-0122-§filter: unfiltered list missing keys. out: ${_T4_OUT:0:300}"
    rm -rf "$iso" 2>/dev/null
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0122-§filter: list({type:task}) returns task-only; unfiltered returns all 3"
  rm -rf "$iso" 2>/dev/null
}

# ════════════════════════════════════════════════════════════════════
# Scenario 4: Unknown type rejected — set with type='invalid' surfaces error.
# ════════════════════════════════════════════════════════════════════
check_adr0122_unknown_type_rejected() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""
  local iso; iso=$(_e2e_isolate "adr0122-bad-type")
  _t4_hive_init "$iso" || { _CHECK_OUTPUT="ADR-0122-§bad: hive-mind init failed in iso"; rm -rf "$iso" 2>/dev/null; return; }

  _t4_memory_call "$iso" '{"action":"set","key":"k-bad","value":"v","type":"bogus"}'
  # Either: (a) MCP exec exits non-zero, or (b) succeeds but reports error in body.
  # Both must include the error name to count as "fail-loud".
  if [[ $_T4_EXIT -eq 0 ]] && ! echo "$_T4_OUT" | grep -qE 'InvalidMemoryTypeError|invalid type'; then
    _CHECK_OUTPUT="ADR-0122-§bad: set with type=bogus did not surface InvalidMemoryTypeError. rc=$_T4_EXIT out: ${_T4_OUT:0:400}"
    rm -rf "$iso" 2>/dev/null
    return
  fi

  # Verify no partial write — k-bad should NOT be in state.json.
  local state="$iso/.claude-flow/hive-mind/state.json"
  if [[ -f "$state" ]] && python3 -c "
import json
with open('$state') as f:
    state = json.load(f)
import sys
sys.exit(0 if 'k-bad' in state.get('sharedMemory', {}) else 1)
" 2>/dev/null; then
    _CHECK_OUTPUT="ADR-0122-§bad: state.json contains 'k-bad' — partial write on rejection (zero-tolerance violation)"
    rm -rf "$iso" 2>/dev/null
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0122-§bad: set with type=bogus rejected; no partial write"
  rm -rf "$iso" 2>/dev/null
}

# ════════════════════════════════════════════════════════════════════
# Scenario 5: Missing type rejected — set without type surfaces error.
# ════════════════════════════════════════════════════════════════════
check_adr0122_missing_type_rejected() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""
  local iso; iso=$(_e2e_isolate "adr0122-no-type")
  _t4_hive_init "$iso" || { _CHECK_OUTPUT="ADR-0122-§none: hive-mind init failed in iso"; rm -rf "$iso" 2>/dev/null; return; }

  # Set without `type` argument — must throw MissingMemoryTypeError.
  _t4_memory_call "$iso" '{"action":"set","key":"k-no-type","value":"v"}'
  if [[ $_T4_EXIT -eq 0 ]] && ! echo "$_T4_OUT" | grep -qE 'MissingMemoryTypeError|type.+required'; then
    _CHECK_OUTPUT="ADR-0122-§none: set without type did not surface MissingMemoryTypeError. rc=$_T4_EXIT out: ${_T4_OUT:0:400}"
    rm -rf "$iso" 2>/dev/null
    return
  fi

  # Verify no partial write.
  local state="$iso/.claude-flow/hive-mind/state.json"
  if [[ -f "$state" ]] && python3 -c "
import json
with open('$state') as f:
    state = json.load(f)
import sys
sys.exit(0 if 'k-no-type' in state.get('sharedMemory', {}) else 1)
" 2>/dev/null; then
    _CHECK_OUTPUT="ADR-0122-§none: state.json contains 'k-no-type' — partial write on rejection"
    rm -rf "$iso" 2>/dev/null
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0122-§none: set without type rejected; no partial write"
  rm -rf "$iso" 2>/dev/null
}

# ════════════════════════════════════════════════════════════════════
# Scenario 6: Legacy untyped entry migrated on read.
# Pre-place a legacy `state.sharedMemory[k] = "raw"` shape; loadHiveState
# rewrites it as `{value:"raw", type:'system', ttlMs:null, ...}` on read.
# ════════════════════════════════════════════════════════════════════
check_adr0122_legacy_dict_migration() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""
  local iso; iso=$(_e2e_isolate "adr0122-legacy")
  _t4_hive_init "$iso" || { _CHECK_OUTPUT="ADR-0122-§legacy: hive-mind init failed in iso"; rm -rf "$iso" 2>/dev/null; return; }

  local state="$iso/.claude-flow/hive-mind/state.json"
  if [[ ! -f "$state" ]]; then
    _CHECK_OUTPUT="ADR-0122-§legacy: state.json not created after init"
    rm -rf "$iso" 2>/dev/null
    return
  fi

  # Manually insert a legacy raw value (simulating pre-T4 state on disk).
  python3 -c "
import json
with open('$state') as f:
    s = json.load(f)
s['sharedMemory']['legacy-key'] = 'legacy-raw-value'
with open('$state', 'w') as f:
    json.dump(s, f, indent=2)
" 2>/dev/null || { _CHECK_OUTPUT="ADR-0122-§legacy: failed to pre-place legacy entry"; rm -rf "$iso" 2>/dev/null; return; }

  # Trigger a get — loadHiveState should migrate the legacy entry on read.
  _t4_memory_call "$iso" '{"action":"get","key":"legacy-key"}'
  if [[ $_T4_EXIT -ne 0 ]]; then
    _CHECK_OUTPUT="ADR-0122-§legacy: get on legacy key failed (rc=$_T4_EXIT). out: ${_T4_OUT:0:300}"
    rm -rf "$iso" 2>/dev/null
    return
  fi

  # Output should contain the original raw value (no data loss per
  # feedback-data-loss-zero-tolerance).
  if ! echo "$_T4_OUT" | grep -qF "legacy-raw-value"; then
    _CHECK_OUTPUT="ADR-0122-§legacy: legacy value not returned through get. out: ${_T4_OUT:0:400}"
    rm -rf "$iso" 2>/dev/null
    return
  fi

  # `loadHiveState` migrates the legacy shape in-memory and populates the
  # cache, but does NOT persist on a pure read (the source doc-comment says
  # "migrated to system/permanent on first read (loadHiveState)" — the
  # *next* save persists the migrated map). Trigger a downstream save by
  # writing an unrelated typed entry; the migrated `legacy-key` rides along
  # because `set` round-trips the entire `state.sharedMemory` dict via
  # saveHiveState. This exercises the migration's persistence contract.
  _t4_memory_call "$iso" '{"action":"set","key":"trigger-save","value":"v","type":"system"}'
  if [[ $_T4_EXIT -ne 0 ]]; then
    _CHECK_OUTPUT="ADR-0122-§legacy: trigger-save set failed (rc=$_T4_EXIT). out: ${_T4_OUT:0:300}"
    rm -rf "$iso" 2>/dev/null
    return
  fi

  # Now state.json must show the migrated typed shape.
  local migrated_check
  migrated_check=$(python3 -c "
import json
with open('$state') as f:
    s = json.load(f)
e = s.get('sharedMemory', {}).get('legacy-key')
if e is None:
    print('MISSING')
elif not isinstance(e, dict):
    print('NOT_DICT')
elif e.get('value') != 'legacy-raw-value':
    print(f'VALUE_MISMATCH:{e.get(\"value\")}')
elif e.get('type') != 'system':
    print(f'TYPE_NOT_SYSTEM:{e.get(\"type\")}')
elif e.get('ttlMs') is not None:
    print(f'TTL_NOT_NULL:{e.get(\"ttlMs\")}')
elif e.get('expiresAt') is not None:
    print(f'EXPIRES_NOT_NULL:{e.get(\"expiresAt\")}')
elif 'createdAt' not in e or 'updatedAt' not in e:
    print('MISSING_TIMESTAMPS')
else:
    print('OK')
" 2>/dev/null)
  migrated_check="${migrated_check:-PYTHON_FAILED}"

  if [[ "$migrated_check" != "OK" ]]; then
    _CHECK_OUTPUT="ADR-0122-§legacy: migrated shape mismatch: $migrated_check"
    rm -rf "$iso" 2>/dev/null
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0122-§legacy: legacy raw value migrated to typed system/permanent shape; value preserved"
  rm -rf "$iso" 2>/dev/null
}
