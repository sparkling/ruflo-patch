# Handover — deploy shipped green + two suite-perf optimizations queued

**Date:** 2026-06-02
**State:** Deploy COMPLETE and green. Two performance optimizations agreed ("we will do both") and specced below, not yet started.

---

## TL;DR

1. **Shipped:** agentdb fail-loud (no silent sql.js fallback) + loud vector-fallback logging + removal of the ruvnet-inherited v1.6.0 vitest suite. Published + pushed. Acceptance **735 / 0 / 9 green**.
2. **The "benchmark failure" was machine contention, not code** — a runaway Chrome ate ~7 cores across 3 release cycles. Killed it → green first try. (See `feedback-perf-gate-failure-check-machine-load` memory. Do NOT re-chase this as a code bug.)
3. **Two optimizations to do** (both confirmed real with clean measurement):
   - **#1** — the build/publish phase load spike (peak load 35 on 18 cores).
   - **#2** — `adr0282` (the #1 slowest check, ~110s) does ~202 cold `cli mcp exec` subprocess spawns; batch them.

---

## What shipped (all pushed, nothing pending)

| Repo | HEAD | Published version | Pushed |
|---|---|---|---|
| `forks/agentdb` → `sparkling/main` | `b672817` (bump .418) | `@sparkleideas/agentdb 3.0.0-alpha.14-patch.418` | ✅ 0/0 |
| `ruflo-patch` → `origin`(=sparkling) | `e2a64cd` (bump .380) | `@sparkleideas/ruflo 3.1.0-alpha.14-patch.380`, `cli .406` | ✅ 0/0 |

Real agentdb changes (in `.418`): `bf90267` fail-loud on native better-sqlite3 load failure (sql.js only via `AGENTDB_ALLOW_SQLJS_FALLBACK=1`/`forceWasm`), `602ee04` loud vector-backend fallback logging (ADR-0286 interim), `b831140` removed 6 ruvnet v1.6.0 vitest files (logged in `docs/upstream/INTEGRATION-LEDGER.md`). cli/ruflo bumps are the ADR-0142 wrapper-pin cascade.

---

## Root-cause finding — do not re-chase

`adr0261-benchmark` (k-hop p99 ≤ 5ms) failed 3 consecutive release runs and `adr0282` ran 125s. **Cause: a runaway Google Chrome** (6–7 helper procs pegged ~99% CPU, stuck 4 days) eating ~7 of 18 cores during every run. Standalone the benchmark was **2ms** (2.5× margin); under contention it hit 8–114ms. After `pkill` of the Chrome helpers → both PASS, release green. The perf gate was correct; the diagnosis (mine) was initially wrong ("flaky" — user corrected). **Lesson recorded in memory `feedback-perf-gate-failure-check-machine-load`.**

Also cleaned (orphans, ~770MB + 7 cores): Chrome helpers, `agent-browser` ×11 (564MB, from dead `/tmp/ruflo-accept-*`), `context7` ×22, `ruv-swarm`/`flow-nexus` dup MCP daemons. The **3 live `ruflo` MCPs are legit** (one per session: hm / ruflo-patch / opda) — keep them.

---

## Clean perf baseline (Chrome-free run, 2026-06-02 ~15:0x, 339 samples / 17 min)

Sampler: `/tmp/accept-sampler.sh <out.csv> <max_s>` → load1 + node-proc-count + node-RSS every 3s.

- **avg load 8.6** / 18 cores (the `RUFLO_MAX_PARALLEL = ncpu/2 = 9` cap working).
- **peak load 35.4**, and **16–19% of the run > 12–14 load** — the fan windows.
- **node RSS peak 8.3 GB** across 39 procs — memory-pressure driver (box was ~17GB into swap).
- The 35.4 peak was in the **build/publish phase**, NOT acceptance.

Wall-time regression: **737–847s (05-31) → ~1000s now (+259s)**, entirely NEW heavy checks (`adr0282` 110s, `adr0265` 123s, `adr0284`, `adr-create-matrix`, `adr0285`) + small slowdowns. This is intrinsic, not the fail-loud change.

---

## Optimization #1 — build/publish phase load spike (peak 35 on 18 cores)

**Where:** `scripts/build-packages.sh` (~line 176: *"Group packages by dependency level for parallel builds (B3: derive from publish-levels.json)"*). Packages within a dependency level compile **concurrently** (one `tsc` per package), and a level can hold many packages → uncapped fan-out = the 35-load spike. `config/publish-levels.json` defines the level grouping. `scripts/publish-verdaccio.sh` then publishes 65 packages (`publish.mjs`, `for (const pkg of pkgs)`).

**Approach:**
- Cap the per-level parallel build group to a sane width (e.g. `nproc/2` or a `RUFLO_BUILD_PARALLEL` env, mirroring `RUFLO_MAX_PARALLEL` in `lib/acceptance-harness.sh:37-48`). A semaphore / `xargs -P N` over the per-level package list.
- Check whether `tsc` is invoked with its own threads; multiple concurrent `tsc` processes each spawning workers is the multiplier.
- Consider whether publish (65 pkgs) is also bursting — stage if so.

**Verify:** re-run a release with the sampler; the build-phase peak should drop from ~35 toward the ~9 cap, with negligible wall-time cost (build is a small fraction of the 1000s; the spike is the fan problem, not the time). Compare `/tmp/accept-res.csv` peak before/after.

**Risk:** low — pure scheduling/concurrency cap, no artifact change. Keep an escape hatch (env to restore full parallelism).

---

## Optimization #2 — `adr0282` does ~202 cold subprocess spawns (the #1 slowest check, ~110s)

**Where:** `scripts/smoke-adr0282-agentdb-surface-fixes.mjs`.
- `mcpExec` (line 59) = `spawnSync(cli, ['mcp','exec','--tool',tool,'--params',json])` — **a fresh `cli mcp exec` process per call** (Node cold start + agentdb 42-controller init each time, ~0.5–1s).
- G1 stores 101 records in a loop (lines 80–84) **and** deletes 101 in a loop (line 97) = **~202 cold spawns** for one check. THAT is the ~110s — **not embeddings** (values are tiny `v0..v100`, `tier:'working'`).

**Constraint:** the test needs >100 records to prove the `limit > 100` clamp is gone (101 is the minimum; can't reduce the count).

**Approach (batch the I/O, keep the assertion):**
- agentdb already exposes `agentdb_insert_batch` (`forks/agentdb/src/mcp/agentdb-mcp-server.ts:341`, `batch_size` default 100) — but that's the vector path. **Confirm whether a batch/bulk `hierarchical-store` exists**; if not, the cleanest fix is to store the 101 records in a **single in-process call** (one short `.mjs` that imports agentdb and writes 101 hierarchical records directly against the shared ACCEPT_TEMP install) instead of 101 `cli mcp exec` spawns. Same for the teardown deletes (one bulk delete).
- Alternatively add a batch hierarchical-store MCP tool in the fork and call it once. (Product change → `forks/agentdb`, needs its own release.)
- Whatever the path: the G1 assertion (`hierarchical-query pathPattern limit:200 → 101`) must stay byte-identical; only the *setup/teardown* gets batched.

**Verify:** `adr0282` still PASSES and drops from ~110s to single-digit seconds. Run via the gated path (it's wired at `test-acceptance.sh:3970-3984`, already reuses `ADR0255_SMOKE_SHARED_TEMP=$ACCEPT_TEMP`). Fast iteration: `bash scripts/test-acceptance-fast.sh adr0282` (needs a populated ACCEPT_TEMP).

**Risk:** medium — touches a smoke's setup. The decision split: smoke-side in-process bulk write (ruflo-patch only, fastest) vs. a new fork batch tool (product change, broader value). Recommend smoke-side first.

---

## Tooling & how-to

- **Run a clean release:** `cd ruflo-patch && npm run release > /tmp/deploy-release.log 2>&1` (background; bumps + builds + full acceptance + publishes + auto-pushes forks on green). ruflo-patch's own `package.json` version bump is left uncommitted — commit it with `chore: bump ruflo-patch version to patch.NNN (green release, cli ... / agentdb ...)` and `git push origin main` (the pipeline does NOT push the patch repo).
- **Measure resource:** start `/tmp/accept-sampler.sh /tmp/accept-res.csv 1700` in background alongside; analyze the CSV (avg/max load, % oversubscribed, node-RSS peak).
- **Existing analyzer:** `node scripts/analyze-acceptance-perf.mjs` — top-20 slowest, per-group CPU, PARALLEL-WASTE flags, delta vs previous run.
- **Before judging any perf-gate failure:** `ps -Aro pid,%cpu,%mem,comm | head -15` + `sysctl -n vm.loadavg` vs `sysctl -n hw.ncpu`. Kill external contention first.

## Gotchas

- **Harness sandbox blocks `kill`/`pkill`** — use `dangerouslyDisableSandbox: true` for process kills. The shell is fish: avoid `for p in $pids` (newline word-split breaks) and `${var%%}`; use `xargs` or explicit PIDs. Use regex char-classes (`'pat[t]ern'`) so `pkill -f` can't match its own command line.
- **Version churn is expected** — each release bumps patch.N; orphaned Verdaccio versions GC themselves. Don't freeze version literals.
- **`adr0282` is already shared-temp-wired** (test-acceptance.sh:3974) — its cost is the subprocess spawns, not a self-install. Don't "fix" the wiring.
- **Memory pressure** — the box was 17GB into swap with 8.3GB of node at acceptance peak; prune orphan MCP/agent-browser sprawl before long runs (see cleanup section).

---

## Resume order

1. **#1 build-parallel cap** (low-risk, biggest fan reduction) → measure with sampler.
2. **#2 adr0282 batch** (smoke-side in-process bulk write) → confirm PASS + time drop.
3. One clean release with the sampler to confirm both: lower peak load + ~−100s wall-time, still 735+/0 green.
