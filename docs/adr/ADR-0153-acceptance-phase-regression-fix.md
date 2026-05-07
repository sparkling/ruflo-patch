# ADR-0153: Acceptance phase regression — wrapper-proxy 92% root cause + 7.5x recovery

- **Status**: Implemented 2026-05-07
- **Date**: 2026-05-07
- **Deciders**: Henrik Pettersen
- **Related ADRs**: ADR-0094 (acceptance coverage), ADR-0098 (parallelism cap), ADR-0129 (hive-mind sibling tests), ADR-0142 (wrapper pivot), ADR-0147 (agentdb refinement that surfaced this work)

## Context

Acceptance phase wall-time grew from ~3 min (April baseline, 460 checks) to **25 min (timeout)** by 2026-05-06 (674 checks). The phase was reliably aborting at `RUFLO_GLOBAL_TIMEOUT_S=1500s` with zero per-check verdicts emitted — `wait "${BG_PIDS[@]}"` blocked indefinitely on a hung check, hiding the actual cause. Multiple deploys had been failing at the acceptance gate.

A 4-agent swarm investigated in parallel (long-runner ID, time-growth root cause, parallelism audit, shared-harness design). Forensics from `/private/tmp/.../tasks/b*.output` and `pipeline-timing.json` archives identified the regression timeline:

| Date | Acceptance wall | Trigger |
|---|---|---|
| 2026-04-21 | 70s (561 checks) | baseline cap=9 |
| 2026-05-04 morning | 192s (673 checks) | new checks added |
| 2026-05-04 evening | 199s | ADR-0142 wrapper pivot landed (`bd7e7c9`) — wrapper-proxy starts growing |
| 2026-05-05 evening | 451-573s | wrapper-proxy at 314-446s |
| 2026-05-06 evening | 1,377-1,447s | wrapper-proxy at 1,098-1,340s (92% of wall) |

## Root causes (in order of magnitude)

### 1. wrapper-proxy hung for 22 minutes per run

`lib/acceptance-diagnostic-checks.sh:35,49` made unbounded `npx --yes @sparkleideas/ruflo@latest --version|status` calls. Post-`bd7e7c9` the wrapper became a real `@sparkleideas/cli` consumer (not a 1-shim package), so `npx` downloaded ~675 packages on every invocation. Three concurrent wrapper-install checks contended on `~/.npm/_cacache`. Without a per-call timeout, hung calls held a parallel slot indefinitely.

### 2. `run_check_bg` had no per-check timeout safety net

`lib/acceptance-harness.sh:203-214` (the parallel-fan-out subshell) ran the check function with `"$fn" || true` — no timeout. When a check hung, `collect_parallel`'s `wait "${BG_PIDS[@]}"` blocked forever. The phase eventually hit `RUFLO_GLOBAL_TIMEOUT_S=1500s` and SIGKILLed the process group; the aggregator never ran, so zero PASS/FAIL verdicts were emitted.

### 3. ADR-0129 sibling checks raced under cap=9

B1/B2/B4 all did `hive-mind init + spawn` against shared `$E2E_DIR`. B1 was already isolated (`_e2e_isolate`); B2/B4 weren't. Higher parallelism exposed the race: a sibling's init wiped `state.json` between B4's init and spawn, surfacing as "Hive-mind not initialized".

### 4. Browser-tool checks made N sequential `cli mcp exec` calls

`p4-br-navigation` (9 tools) and `p4-br-interaction` (11 tools) each spawned a fresh MCP server per tool — each launching Playwright (~10s cold). 9 × ~13s = 115s for navigation alone (the wave's long pole post wrapper-proxy fix).

### 5. Wrapper-install checks paid 82-93s npm install each

Three wrapper-install checks (`adr0142-bin-path`, `adr0142-mcp-jsonrpc`, `adr0143-init-mcp`) each ran `npm install @sparkleideas/ruflo --cache=<isolated>`. The `--cache=<isolated>` flag (added to defeat parallel cache contention) defeated npm's package cache reuse, making each install 4× slower than the harness's bulk install.

### 6. Phase 5 init was 40s sequential bulk

`scripts/test-acceptance.sh` ran `cli init --full --force --with-embeddings` synchronously inline before its parallel check group could fire. Net Phase 5 wall: ~47s.

### 7. Autopilot atomic-write race

`saveState`/`appendLog` used a shared `${path}.tmp` filename. Concurrent calls raced: A's rename succeeded, B's rename hit ENOENT because A had already renamed the shared `.tmp`. Pre-existing bug, exposed under the higher parallelism enabled by the other fixes. Failed `p2-ap-enable` ~50% of runs.

## Decision

Apply seven fixes in priority order. All are surgical — coverage unchanged at 674 checks.

### Fix 1: wrapper-proxy bounded + uses pre-installed binary

`lib/acceptance-diagnostic-checks.sh` — wrap both `npx` calls in `_run_and_kill 60s`. Then go further: harness install at `scripts/test-acceptance.sh:191` already includes `@sparkleideas/ruflo`; check uses `${TEMP_DIR}/node_modules/.bin/ruflo` directly. Falls back to `npx` if shared install missing. Net: 1340s → ~1s (1500x).

### Fix 2: per-check watchdog in `run_check_bg`

`lib/acceptance-harness.sh:203-214` — wrap each check subshell with a 180s watchdog (configurable via `RUFLO_CHECK_TIMEOUT_S`). Watchdog races to write a TIMEOUT verdict file BEFORE SIGKILL'ing the subshell, so the parent aggregator sees the failure cleanly. Caps any future hung check, anywhere.

### Fix 3: ADR-0129 B2/B4 wrapped in `_e2e_isolate`

`lib/acceptance-adr0129-checks.sh` — both checks now use the same isolation pattern as B1 (added 2026-05-04). Eliminates the sibling-state race, allows cap=9 to work safely.

### Fix 4: Cap=9 restored

`lib/acceptance-harness.sh:30-37` — was capped at 6 reactively when wrapper-proxy created CPU contention. Both root causes resolved → cap returns to ncpu/2 (= 9 on M5 Max).

### Fix 5: Browser MCP-batched single session

`lib/acceptance-browser-checks.sh` — `p4-br-navigation` + `p4-br-interaction` now batch all tool calls through ONE `cli mcp start` invocation via stdin JSON-RPC (mirrors the existing `adr0117-marketplace-mcp.sh:256` pattern). One Playwright launch + N in-process dispatches replaces N × Playwright launches. Same per-tool-responded counting semantics. Navigation: 115s → 75s (with hard timeout headroom for boundary stability).

### Fix 6: Wrapper-solo install + Phase 5 init both run in BACKGROUND

`scripts/test-acceptance.sh` — both expensive setup operations launched in parallel after CLI_BIN is resolved, joined right before they're needed. By the time setup phases finish (~78s sequential), the bg jobs (~70s wrapper install, ~40s phase5 init) are already done — wait is a no-op. Eliminates 3 × 82s wrapper-install checks from the parallel wave's long pole, and drops Phase 5 wall from ~47s to ~5-10s.

### Fix 7: Autopilot atomic-write race

`forks/ruflo/v3/@claude-flow/cli/src/autopilot-state.ts` (FORK COMMIT) — `saveState` and `appendLog` use unique `${path}.tmp.${pid}.${random}` instead of shared `.tmp`. Each concurrent writer has its own exclusive tmp file → no rename ENOENT.

## Acceptance criteria

- [x] Pipeline acceptance phase wall ≤ 4 min
- [x] Direct `bash scripts/test-acceptance.sh` wall ≤ 4 min
- [x] 100% pass on 3 consecutive runs (zero failures, zero skips)
- [x] Zero `skip_accepted` verdicts (delegated-skip stub `p9-rvf-delegated` removed; replaced by `t3-2-concurrent` which has actual coverage)
- [x] No coverage drop — 674 checks before and after
- [x] All fixes deployed via Verdaccio (autopilot fix in cli@3.5.58-patch.395)

## Empirical results

| Metric | Before (2026-05-06) | After (2026-05-07) | Improvement |
|---|---|---|---|
| Acceptance wall | 25 min (timeout abort) | 3:19 ± 6s | **7.5x** |
| Pass count | 0 (aborted) | 674/674 | 100% |
| Failures | timeout | 0 | clean |
| Skips | 1 (delegated stub) | 0 | clean |
| Flake rate | unknown | 0% (3/3 runs clean) | stable |
| wrapper-proxy alone | 1340s | <1s | 1500x |

## Risks + mitigations

- **R1: Bg wrapper-solo race with main install.** The harness install completes BEFORE the bg job starts, so they don't race on `~/.npm/_cacache`. Bg job uses isolated cache (`$WRAPPER_SOLO_TEMP/.npm-cache`) anyway — defense in depth.
- **R2: Bg phase5 init contends with parallel wave for CPU.** Wave starts well after phase5 init has finished (~80s setup vs ~40s init). Empirically observed 0 skip-related failures across 3-run stability check at 75s nav timeout.
- **R3: Per-check watchdog could mask real performance regressions.** 180s default is generous; checks that legitimately need more time can override via `RUFLO_CHECK_TIMEOUT_S`. The watchdog writes a TIMEOUT verdict so the failure is loud — not silent.
- **R4: Autopilot fix uses `Math.random()` not `crypto.randomBytes()`.** For atomic-write tmpfile uniqueness across concurrent processes within ~ms, Math.random's collision space (~2^36 unique 8-char base36 strings) is more than sufficient. Crypto-strength not required.

## Considered + rejected alternatives

- **Reduce check count.** Rejected — would degrade coverage. The 460→674 growth was driven by ADR-0094 Phase 8-17 + recent integrity work. All real coverage.
- **Wrapper-solo dedup as foreground phase.** Tried (commit b3d556f, reverted). Added 70s sequential install while only freeing ~50s parallel-wave time. Net regression.
- **Cap=12 (oversubscribe ncpu/2).** Rejected — original 9→6 cap was reactive to load spiking to 13.5; without the wrapper-proxy fueling that contention the spike isn't reproducible at cap=9, but cap=12 introduces real risk on the 18-core M5.
- **Persistent MCP daemon for ALL browser tools (not just batched).** Rejected — requires bigger refactor (long-lived stdio process across multiple checks). Per-check-batched JSON-RPC is good enough; floor is ~75s for navigation, well under the original 115s.

## References

- forks/ruflo `bd7e7c9` — wrapper pivot that surfaced the regression
- patch repo commits chain: `47b39b7` → `3d9bc28` → `8289125` → `d811a4c` → `e1c6dec` → `9 follow-up commits`
- forks/ruflo (autopilot fix) — atomic-write race
- `lib/acceptance-harness.sh:30-37` (parallelism cap), `:203-214` (run_check_bg watchdog)
- `lib/acceptance-diagnostic-checks.sh:21-72` (wrapper-proxy)
- `lib/acceptance-adr0129-checks.sh` (B1/B2/B4 isolation)
- `lib/acceptance-browser-checks.sh:146-220, 218-300` (MCP-batched browser checks)
- `lib/acceptance-adr0142-bin-path.sh`, `lib/acceptance-adr0143-init-mcp.sh` (use shared WRAPPER_SOLO_TEMP)
- `scripts/test-acceptance.sh` lines 197-217 (wrapper-solo bg), 264-285 (phase5 init bg), 707-712 (joins)
- `forks/ruflo/v3/@claude-flow/cli/src/autopilot-state.ts:158-170, 184-190` (atomic write race fix)
- `/private/tmp/claude-501/-Users-henrik-source-ruflo-patch/.../tasks/bnzideamz.output` (3-run stability verification)
