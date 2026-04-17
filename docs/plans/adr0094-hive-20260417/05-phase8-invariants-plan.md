# Phase 8 — Cross-Tool Invariants: Implementation Plan

Location: `lib/acceptance-phase8-invariants.sh`. Depends on ADR-0097 canonical
helpers (`_mcp_invoke_tool`, `_expect_mcp_body`). Wall-clock cap 20s.

## 1. Check Design Pattern (pseudocode)

5-step skeleton: **isolate → pre-snapshot → mutate → post-assert → delta**.
`_expect_mcp_body` enforces body-level post-condition so silent no-ops fail.

```bash
check_inv_memory_roundtrip() {
  _CHECK_PASSED="false"; _CHECK_OUTPUT=""
  local dir; dir=$(_e2e_isolate inv-mem) || { _CHECK_OUTPUT="isolate failed"; return; }
  local key="inv-mem-$$-$(date +%s)"
  local val="phase8-sentinel-$(openssl rand -hex 4)"

  # PRE snapshot — confirm key absent
  _mcp_invoke_tool "$dir" memory_search "{\"query\":\"$val\"}" || \
    { _CHECK_OUTPUT="pre search errored"; return; }
  if echo "$_MCP_BODY" | grep -q "$key"; then
    _CHECK_OUTPUT="dirty fixture: $key already present"; return
  fi

  # MUTATE
  _mcp_invoke_tool "$dir" memory_store \
    "{\"key\":\"$key\",\"value\":\"$val\",\"namespace\":\"inv\"}" \
    || { _CHECK_OUTPUT="store failed"; return; }

  # POST assertion — body must contain the key
  _mcp_invoke_tool "$dir" memory_search "{\"query\":\"$val\"}"
  if _expect_mcp_body "$key"; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="INV-1 OK: store→search round-trip ($key)"
  elif [[ "$_MCP_SKIP" == "embeddings-unavailable" ]]; then
    _CHECK_PASSED="skip_accepted"          # three-way bucket
    _CHECK_OUTPUT="INV-1 SKIP: embeddings offline"
  else
    _CHECK_OUTPUT="INV-1 FAIL: search body lacks $key: $_MCP_BODY"
  fi
}
```

## 2. Ordering & Dependencies

All six mutate state (writes RVF / session / agent / claim / workflow /
config) → **each needs `_e2e_isolate` with a distinct check-id**; none run
against shared `E2E_DIR`. Only INV-1 depends on harness prep (embeddings
init). All six are independent → fully parallelizable via `run_check_bg` +
`collect_parallel`. Wall-clock ≈ slowest single check (≤15s) → fits 20s.

## 3. Additional High-ROI Invariants

Add 4 more invariants (10 total):

- **INV-7 Task lifecycle**: `task_create(desc)` → `task_list` shows it → `task_complete` → `task_summary` body references the id. Catches silent id-dropping.
- **INV-8 Session restore round-trip**: store key `K` → `session_save(name)` → wipe scratch → `session_restore(name)` → `memory_retrieve(K)` returns original value. Catches empty-session bug (ADR-0086 Debt 15 pattern).
- **INV-9 Neural pattern delta**: snapshot `neural_status.patternCount` → `neural_train(pattern)` → `neural_status.patternCount` strictly greater. Catches "training returns ok but stores nothing".
- **INV-10 Autopilot shape**: `autopilot_enable` → `autopilot_status.enabled==true` → `autopilot_predict({task})` returns object with keys `{recommendation,confidence}`. Catches tool that returns `{}` from stub.

## 4. Swarm Composition (5 agents)

| Role | Writes | Count |
|------|--------|-------|
| Implementer A | INV-1,2,7 (memory+session+task) | 1 |
| Implementer B | INV-3,4,5 (agent+claims+workflow) | 1 |
| Implementer C | INV-6,8,9,10 (config+restore+neural+autopilot) | 1 |
| Adversarial reviewer | challenges assertions, hunts pass-on-empty bodies | 1 |
| Out-of-scope probe writer | authors INV-11 (see §5) | 1 |

Three implementers, not two — 10 invariants / 3 ≈ 3 each is the right split.

## 5. Out-of-Scope Probe (INV-11 — delta sentinel)

**INV-11 `check_inv_all_tools_observe_delta`**: meta-probe re-runs each
mutate step twice in the same isolated dir and asserts **second pre-snapshot
differs from first**. If a tool is silently no-op'd (store returns ok but
writes nothing, `session_save` returns ok but `session_list` stays empty),
repeated-run delta is zero and probe fails. Stronger than "post-state
exists" — proves the tool *caused* the change.

## 6. Gate Criteria

- 10 invariants + INV-11 probe = **11 green**, 0 fail, skip_accepted only on
  genuinely-absent backends (embeddings offline, native bin missing).
- Wall-clock ≤ 20s measured via `_record_phase phase8`.
- Sourced from `scripts/test-acceptance.sh`, wired into a parallel group
  alongside Phase 7 via `run_check_bg` + `collect_parallel phase8 ...`.
- No retire-or-fold required (200-check budget headroom > 11).
- INV-11 must fail if any mutate step is stubbed out → regression guard for
  ADR-0082 "tests must fail loudly".