# ADR-0097 Sprint Plan

## Helpers

In `lib/acceptance-harness.sh`. Build on existing `_run_and_kill{,_ro}` — do not replace.

```bash
# _expect_mcp_body <src> <regex> <label> [--skip-on=pat]
# Unwraps {content:[{type:text,text:..}]} via node; raw fallback.
_expect_mcp_body() {
  local body; body=$(_mcp_unwrap "$1"); local skip="${4#--skip-on=}"
  if [[ -n "$skip" ]] && echo "$body"|grep -qiE "$skip"; then
    _CHECK_PASSED=skip_accepted; _CHECK_OUTPUT="SKIP: $3 tool-absent"; return; fi
  if echo "$body"|grep -qiE "$2"; then
    _CHECK_PASSED=true; _CHECK_OUTPUT="$3: matched /$2/"
  else _CHECK_PASSED=false; _CHECK_OUTPUT="$3: no /$2/ body=$(echo "$body"|head -10)"; fi
}
# _mcp_invoke_tool <tool> <params> <regex> [label] [timeout] [--ro|--rw]
# Superset of 23 drifted variants. Default --ro.
_mcp_invoke_tool() {
  : "${E2E_DIR:?}" "${REGISTRY:?}"
  local cli=$(_cli_cmd) work=$(mktemp)
  local cmd="cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli mcp exec --tool $1"
  [[ "$2" != "{}" && -n "$2" ]] && cmd+=" --params '$2'"
  [[ "${6:---ro}" == "--rw" ]] && _run_and_kill "$cmd" "$work" "${5:-15}" \
                               || _run_and_kill_ro "$cmd" "$work" "${5:-15}"
  _expect_mcp_body "$work" "$3" "${4:-$1}" \
    --skip-on='tool.+not found|not registered|unknown tool|method .* not found'
  rm -f "$work"
}
# _with_iso_cleanup <id> <body_fn> — fixes the zero-trap gap.
_with_iso_cleanup() {
  local g=$(mktemp -d "/tmp/iso-$1-XXXXX")
  trap "chmod -R u+rwX '$g' 2>/dev/null; rm -rf '$g'" RETURN INT TERM
  export _ISO_GUARD="$g"; "$2"; trap - RETURN INT TERM
}
```

`_mcp_invoke_tool` wraps `_run_and_kill{,_ro}`; `_expect_mcp_body` is pure. Checks call `_e2e_isolate` inside `_with_iso_cleanup`.

## Lint (`scripts/lint-acceptance-checks.mjs`)

Regex on source — bash AST too slow. State machine tracks `check_adr*() {…}` bodies. <1s across 65 files. Exit 1 on any `err`.

| ID | Sev | Pattern |
|----|-----|---------|
| L1 | err  | `/_run_and_kill(_ro)?\s+"[^"]+"\s+"[^"]+"\s*$/m` (no timeout) |
| L2 | err  | body lacks `_CHECK_PASSED=` OR `return` before first assignment |
| L3 | warn | `/grep -qiE\s+"[^"]+".*_RK_OUT/` outside helpers |
| L4 | err  | `/grep -c\s+[^|]+\|\|\s*echo\s+0/` (bash trap) |
| L5 | warn | `/_[a-z]+_invoke_tool\(\)\s*\{/` in a non-harness file |
| L6 | warn | `_e2e_isolate` w/o matching `_with_iso_cleanup\|trap.*rm` |
| L7 | err  | function name not `/^check_adr\d{4}[a-z0-9_]*\(\)/` |

## CI Gate (Tier Y)

Fires in `scripts/preflight.mjs` — cascades through every `test:*` / `deploy`. Two `check()` blocks: (1) spawn `lint-acceptance-checks.mjs`, inherit exit; (2) glob `lib/acceptance-*-checks.sh`, assert matching `tests/unit/*.test.mjs` OR presence in `config/adr0097-grandfathered.json`.

Grandfather JSON = 54 files (65 minus Tier X 10 minus paired B1/B3/B5). New files must ship paired. No pre-commit hook — ADR-0038 cascade covers all entry points.

## Tier X (10)

Priority = (a) first-run failure, (b) mutation, (c) fanout:

1. `check_adr0094_p5_progress_check` — canonical narrow-regex; template
2. `check_adr0094_p5_progress_summary` — distinct envelope
3. `check_adr0094_p5_progress_sync` — only P5 writing state
4. `check_adr0094_p5_progress_watch` — timeout path
5. `check_adr0094_p6_autopilot_enable` — mutation; 2 consumers
6. `check_adr0094_p6_autopilot_learn` — mutation + RVF write
7. `check_adr0094_p7_coordination_orchestrate` — P7 failure shape
8. `check_adr0094_p7_coordination_sync` — mutation
9. `check_adr0094_p4_guidance_recommend` — content-envelope; most reused
10. `check_adr0094_p3_hooks_intelligence_pattern_store` — mutation + hooks

Each pair clones B3: static-source assertions + 5 behavioural cases (happy / tool-not-found / empty / crash / mismatch) via stubbed `_cli_cmd`.

## Swarm (7 agents, hierarchical)

1. **coordinator** — sequences blocks, owns commit train
2. **system-architect** — helpers + docblock in harness
3. **coder-lint** — script + grandfather JSON + preflight hook
4. **coder-tests** — 10 paired tests (B3 template)
5. **tester** — `test:unit` + `test-acceptance-fast.sh p5,p6,p7` per commit
6. **adversarial-reviewer** — ADR-0087 critique + neg-test spec
7. **probe writer (out-of-scope)** — 3 evasion probes (new check w/o pair, L4 in comment, `_<x>_invoke_tool` rename dodging L5). Each MUST fail preflight.

## Parallelism

Serial (~0.5d): architect lands helpers — everything else sources them.
Block A parallel (~1d): coder-lint, coder-tests, adversarial-reviewer.
Block B parallel (~0.5d): tester, probe writer, coordinator (per-file commits).

Tier Z (180 remaining) NOT parallelised — piggybacks on organic domain touches with `docs/bugs/coverage-ledger.md` deferral entries.

Total: ~2d w/7 agents; ~4-5d solo. Big-bang Alt A (4 weeks) avoided.
