# Phase 9 Concurrency Matrix — Plan

**File**: `lib/acceptance-phase9-concurrency.sh`. **Gated**: ADR-0095 lands first
(read-under-lock pattern). **Wall cap**: ≤30s (7 checks × ≤5s, parallelized).

## 1. Race protocol per family

All races use the t3-2 pattern from `lib/acceptance-adr0079-tier3-checks.sh:149`:
`_e2e_isolate` → N background subshells with `timeout 20` → `wait $pid` → per-proc
logs in `mktemp -d /tmp/p9-<id>-XXXXX` → assertion on post-race state, NOT on
cli stdout (exit codes are unreliable per MEMORY note).

### 1a. Claims (`claims_claim`) — exactly-one-winner
Create task id. Spawn N=6 subprocs calling
`cli mcp exec --tool claims_claim --params '{"taskId":"<id>","agentId":"agent-$i"}'`.
**Assert**: post-race `claims_board` shows `claims[taskId].holder` equals exactly
one agent id. Logs: exactly 1 `"claimed":true`, 5 "already claimed".

### 1b. Session save (`session_save`) — atomic, never interleaved
Pre-create `race-sess`. N=2 subprocs write different payloads.
**Assert**: `session_info` returns one payload fully (last-write-wins) OR one
proc got CAS/version error. Validate with `node -e 'JSON.parse(...)'` —
never mixed metadata (payload-A + timestamp-B, truncated JSON, etc).

### 1c. Workflow execute (`workflow_execute`) — 1 running + 3 queued/rejected
Pre-create workflow. N=4 subprocs call `workflow_execute --name race-wf`.
**Assert**: `workflow_status` shows exactly 1 run in `running`/`started`;
remaining 3 either queued OR report "already running". No double-start.

### 1d. RVF — defer to ADR-0095
Wrapper `check_p9_rvf_interproc_race` shells out to ADR-0095's
`scripts/diag-rvf-interproc-race.mjs`; asserts exit 0 + `entryCount==writers`.

## 2. Additional races (all 3)

- **`agent_spawn` dup-name** — 3 procs spawn `--name dup`; exactly 1 succeeds,
  `agent_list` shows one. Same "exactly-one" shape as claims.
- **`memory_delete` idempotent** — 2 procs delete same key; both exit 0,
  `memory_retrieve` returns not-found. Catches 2nd-delete crashes.
- **`task_complete` first-wins** — 2 procs complete same task; winner's
  `completedBy` persists, 2nd returns "already complete" (not silent overwrite).

**Total: 7 race checks.**

## 3. Subprocess harness — `_race_N_cli`

Extract to `lib/acceptance-harness.sh` (+40 lines, currently 154):

```bash
# _race_N_cli <N> <log_prefix> <iso> <cli_args...>
_race_N_cli() {
  local N=$1 prefix=$2 iso=$3; shift 3
  local cli; cli=$(_cli_cmd)
  _RACE_LOGS_DIR=$(mktemp -d "/tmp/${prefix}-XXXXX")
  local pids=() i
  for i in $(seq 1 "$N"); do
    ( date +%s%N > "$_RACE_LOGS_DIR/start-$i"
      cd "$iso" && NPM_CONFIG_REGISTRY="$REGISTRY" timeout 20 $cli "$@" \
        > "$_RACE_LOGS_DIR/proc-$i.log" 2>&1
      echo $? > "$_RACE_LOGS_DIR/rc-$i" ) &
    pids+=($!)
  done
  for pid in "${pids[@]}"; do wait "$pid" 2>/dev/null || true; done
  _RACE_EXIT_CODES=()
  for i in $(seq 1 "$N"); do
    _RACE_EXIT_CODES+=("$(cat "$_RACE_LOGS_DIR/rc-$i" 2>/dev/null || echo 99)")
  done
}
```

Each check calls it, then queries post-race state via `_run_and_kill_ro`.

## 4. Swarm composition (5 agents)

1. **harness-agent** — adds `_race_N_cli` + stub file + `scripts/test-acceptance.sh`
   group wiring. **Blocks 2-5**.
2. **claims-agent** — 1a + 2a (both "exactly-one").
3. **session-agent** — 1b + 2b (session + delete idempotence).
4. **workflow-agent** — 1c + 2c (both "first-wins").
5. **rvf-bridge-agent** — 1d wrapper once ADR-0095's diag exists.

Agent 1 commits first; 2-5 spawn in parallel.

## 5. Serialization-regression probe

Each subproc writes `date +%s%N` to `$_RACE_LOGS_DIR/start-$i` as its first
action (in `_race_N_cli`). Post-wait, compute
`spread = max(start_i) - min(start_i)`. **Assert spread < 100ms** —
catches "serialized pretending to be concurrent" regressions (e.g. if
`_e2e_isolate` gained a global lock, or bash fork got serialized by npm
cache contention). Spread recorded in `_CHECK_OUTPUT` for diagnostics.

## 6. Gate criteria

- All 7 checks green **3 consecutive runs × 3 calendar days** in `phase9` group.
- Aggregate wall-clock ≤30s via `run_check_bg` + `collect_parallel`.
- Per-check overlap spread <100ms (in `_CHECK_OUTPUT`).
- Zero dangling locks/temp files in `$iso` post-suite (t3-2 cleanup at line 270).
- **Meta-regression**: temporarily delete `_race_N_cli`; all 7 must FAIL LOUDLY
  (no silent PASS) — fulfills ADR-0082.
