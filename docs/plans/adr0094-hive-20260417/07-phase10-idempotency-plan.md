# ADR-0094 Phase 10 — Idempotency Plan

**File**: `lib/acceptance-phase10-idempotency.sh` | **Budget**: ≤10s | **Rule**: `f(x); f(x) ≡ f(x)`
**Harness**: reuse `_session_invoke_tool` three-bucket pattern as `_p10_invoke`

## 1. Assertion patterns

Every check: call-1 → capture id + observer count N → call-2 (same args) → assert id stable AND observer still N.

| # | Target | Post-condition |
|---|---|---|
| A | `memory_store(k,v,ns)` | id matches; `memory_list` count unchanged; `memory_retrieve(k)` == call-1 value; no `duplicate key` warning |
| B | `session_save(name)` | same sessionId; `session_list` count unchanged; NO `name-2`/`name.1`; `session_info.lastSavedAt` monotonic |
| C | `config_set(k,v)` | `config_get(k)` still v; `config_list` count unchanged; no dup lines in `config export` |
| D | `init --full` on init'd dir | exit!=0 `"already initialized"` + mtime unchanged, OR exit 0 + mtime + file count unchanged; `--force` gate probed |

## 2. Additional high-ROI targets (8 total)

- **E. `agent_spawn(foo)` twice** — errors `already exists` OR same id; `agent_list` count unchanged
- **F. `claims_claim(t1)` twice same agent** — 2nd: `already claimed by me`; `claims_board` row unchanged
- **G. `workflow_create(w1)` twice** — errors or returns existing id; `workflow_list` unchanged
- **H. `task_create(t42)` twice** — errors on dup id; `task_list` unchanged

Skipped (>10s): `swarm_init`, `hive-mind_init`, `hooks_pre-task`.

## 3. Subtle bugs

1. **`-2` variants** (`foo.1`, `foo_2026-04-17T…`) — caught by `list | grep -c "^$name"` == 1
2. **Return-value lies** — same id but new internal rowid; caught by `list --json | jq length` delta
3. **Counter drift** — `config_set` bumps `version`; acceptable if `config_get` value stable (don't diff full blob)
4. **`init --full` silent overwrite** — wipes patched config; caught by mtime + sha256 of sentinel key
5. **Backend divergence** — RVF idempotent, SQLite fallback doubles; record `CLAUDE_FLOW_MEMORY_BACKEND` in diagnostic

## 4. Swarm (2 agents)

- **P10-A (impl)**: author 8 `check_adr0094_p10_*` funcs + `_p10_invoke` helper (copy `_session_invoke_tool` verbatim)
- **P10-B (wire + verify)**: source in `scripts/test-acceptance.sh`, wire via `run_check_bg`/`collect_parallel`, run `test-acceptance-fast.sh p10`, report

No coordinator at N=2.

## 5. Out-of-scope probe (MANDATORY)

ADR-0090 A1/A4 rule: never trust the surface return. **Return-value-only checks pass silently on the exact bug Phase 10 exists to catch.** Every check does `observe-before → call-2 → observe-after` and asserts equality.

| Check | Observer |
|---|---|
| A | `memory_list --namespace ns` + `memory_retrieve` |
| B | `session_list \| jq 'map(select(.name \| startswith($n))) \| length' == 1` |
| C | `config_list` count + `config_get` |
| D | `find .claude-flow -type f \| wc -l` + `stat -f %m config.json` |
| E-H | `<tool>_list \| jq length` (F: `claims_board \| grep -c`) |

## 6. Gate

- All 8 green or `skip_accepted` with explicit diagnostic — NEVER silent pass (ADR-0090 A2)
- ≤10s via `time bash scripts/test-acceptance-fast.sh p10`
- Sourced in `scripts/test-acceptance.sh`, wired into existing parallel group
- No root-dir artifacts; nothing outside `lib/`
- Three-bucket `_CHECK_PASSED` respected on SKIP branches
- Commit: `feat: ADR-0094 Phase 10 — 8 idempotency checks (memory/session/config/init + agent/claims/workflow/task)`
