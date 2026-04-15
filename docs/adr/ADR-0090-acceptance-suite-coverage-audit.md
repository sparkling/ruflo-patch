# ADR-0090: Acceptance Test Suite Coverage Audit — Database Backend Paths

- **Status**: Implemented (Tier A) — 2026-04-15
- **Date**: 2026-04-15
- **Scope**: `ruflo-patch/lib/acceptance-*.sh` and `scripts/test-acceptance.sh`
- **Methodology**: 4-agent ruflo swarm audit (RVF backend, SQLite/agentdb, sql.js fallback, JSON state files)
- **Supersedes (partial)**: ADR-0082 "Partially Implemented" status — refreshed with post-ADR-0086/0088 findings
- **Related**: ADR-0075 (ideal state layers), ADR-0082 (Test Integrity — No Fallbacks), ADR-0086 (Layer 1 Storage), ADR-0088 (Daemon Scope), ADR-0089 (Controller Intercept Permanent)

## Context

During the ADR-0088 validation session (2026-04-15), an audit of acceptance
coverage by ideal-state layer revealed that Layer 2 was stuck at 75%
because ADR-0075's definition of "done" conflated structural and
behavioral unity. ADR-0089 resolved that by redefining Layer 2 against
the behavioral goal. Along the way, the user asked a specific follow-up:

> "Do we have acceptance tests for all databases (RVF, SQLite, etc.)?"
> "Do we have tests that we are not using sql.js fallbacks, or any fallbacks?"

A 4-agent swarm was spawned to investigate, each auditing one backend
against `/Users/henrik/source/ruflo-patch/lib/acceptance-*.sh`:

1. **RVF backend auditor** — primary memory path
2. **SQLite/agentdb auditor** — neural controller persistence (ADR-0086 Debt 15)
3. **sql.js fallback auditor** — edge environment path per ADR-0075
4. **State files auditor** — 15 JSON/JSONL files written at runtime

The findings are severe enough that existing claims in ADR-0086, ADR-0088,
and (freshly) the Debt 15 check from this session need to be revised.
This ADR documents the findings, explicitly acknowledges which recent
claims are weaker than advertised, and commits to specific remediation.

ADR-0082 previously audited 46 cheating checks + 13 weak checks + 8
harness workarounds and is still "Partially Implemented" 9 months later.
ADR-0090 refreshes that snapshot with post-ADR-0086/0088 findings and
converts the remediation into dated commitments.

## Findings

### Aggregate coverage by backend

| Backend | Behaviors audited | Runtime coverage | Zero-coverage gaps | Critical issues |
|---|---|---|---|---|
| **RVF** | 14 | 6 | 8 | 3 silent-pass anti-patterns inside test harness |
| **SQLite / agentdb** | 14 | 5 | 9 | Debt 15 guard is a facade (see below) |
| **sql.js fallback** | 9 | 0 | 9 | Backend deleted; ruflo-patch actively asserts absent; contradicts ADR-0075 |
| **JSON state files** | 15 files × 5 dims = 75 | ~15 | 60 | 10 of 15 files have zero coverage |
| **Totals** | **112** | **~26** | **86** | **≈23% coverage** |

### RVF — 8 of 14 behaviors uncovered

Auditor: `a777de03cf4172501` (RVF backend auditor).

**Zero runtime coverage** (ranked by severity):

1. **Corruption recovery** — truncated `.rvf`, bad header, partial WAL. WAL's entire reason to exist is durability under failure, yet no test ever corrupts a file and verifies recovery.
2. **Dimension mismatch on read** — ADR-0075 L3 mandates loud failure. Suite verifies generated config says 768, but a legacy 384-dim `.rvf` on disk would silently crash, skew, or overwrite user data.
3. **`.rvf.lock` advisory locking** — `check_t3_2_concurrent_writes` (`adr0079-tier3-checks.sh:107-163`) looks like concurrent-writer coverage but only scans for `SQLITE_BUSY`. RVF uses a PID-based file lock, not SQLite busy-timeout — this check cannot detect `.rvf.lock` regressions.
4. **HnswLite pure-TS fallback** — `check_adr0073_native_runtime` (`adr0073-checks.sh:131-186`) **silent-passes on SKIP** when native import fails (line 177). When native breaks in CI, the runtime test silently becomes a no-op.
5. **HNSW rebuild after compaction** — `check_adr0073_wal_roundtrip` sets `walCompactionThreshold: 1000` but only stores 10 entries, so compaction never triggers.
6. **`bulkInsert` atomicity** — no check exercises the documented API; 10 sequential `store()` calls are not the same contract.
7. **`entries > maxElements` tripwire** — 100k cap is defended at config-read time, not runtime.
8. **`:memory:` mode** — no runtime check.
9. **RVF magic header / version byte** — no check reads `.rvf` bytes. A zero-filled or wrong-version `.rvf` passes existing size-only checks.

**False coverage** (silent-pass anti-patterns inside the harness):

- `check_adr0073_wal_methods` — greps `rvf-backend.js` for symbol strings. Symbol rename defeats the check.
- `check_adr0073_native_package` — greps for import string. Broken runtime import path not detected.
- `check_adr0073_native_runtime` — **sets `_CHECK_PASSED="true"` on SKIP**. This is the ADR-0082 anti-pattern the project explicitly bans, inside our own test harness.
- `check_adr0080_rvf_has_entries` — 1025-byte zero-filled file passes.
- `check_t3_2_concurrent_writes` — scans `SQLITE_BUSY` / `database is locked` (wrong error shape for RVF).

### SQLite / agentdb — 9 of 14 behaviors uncovered

Auditor: `a824a24f77fb11046` (SQLite/agentdb auditor).

**The Debt 15 check added earlier this session is a facade.**

`check_adr0086_debt15_sqlite_path` (`acceptance-adr0086-checks.sh:565`) claims to be "the ONLY acceptance guard for the Debt 15 trade-off" but in fact verifies only agentdb's init behavior:

1. File exists after `agentdb_health` — **agentdb auto-creates the file with empty schema at cold-start**. Always passes regardless of whether any controller ever writes.
2. SQLite magic header — same: agentdb init is sufficient.
3. Size >= 4096 — **an empty agentdb schema file is already 20-40KB**. Trivially met.
4. `grep 'sqlite'` in `memory-router.js` — source-level grep, not runtime.

**Conclusion**: the Debt 15 guard verifies agentdb init, not controller persistence. If all 15 neural/learning controllers (reflexion, skillLibrary, reasoningBank, causalGraph, causalRecall, learningSystem, hierarchicalMemory, memoryConsolidation, attentionService, gnnLearning, semanticRouter, graphAdapter, sonaService, nightlyLearner, explainableRecall) silently fell back to in-memory state after an upstream merge, this check still reports green.

**Zero runtime coverage**:

- No check queries any controller-specific SQLite table (`episodes`, `causal_edges`, `skill_library`, `hierarchical_memory`, etc.) for row counts after a controller write — *resolved for `episodes` by Tier A1 (2026-04-15)*
- `check_reflexion_lifecycle` (`controller-checks.sh:107`) greps CLI stdout for `success|stored|true`; accepts empty retrieve as pass (`cold-start expected`). Never inspects the SQLite file.
- `check_causal_graph` (`controller-checks.sh:140`) explicitly accepts `results.*\[\]` (empty) as pass.
- `check_adr0059_intelligence_graph` explicitly **whitelists empty graph** as pass citing "debt 17 — intelligence.cjs reads SQLite, CLI writes RVF". This muzzles the only runtime signal for graphAdapter.
- `check_t1_4_sqlite_verify` (`adr0079-tier1-checks.sh:214`) queries `memory_entries` — the **RVF mirror table, not controller tables**. Accepts `"no such table"` as pass.
- No `better-sqlite3` absence-from-`package.json` guard.
- Skill library, hierarchicalMemory, causalRecall: no round-trip check at all.

### sql.js fallback — 0 of 9 behaviors covered; architecture divergence

Auditor: `a2d8fc222c54ff8ec` (sql.js edge fallback auditor).

**ADR-0075's creator correction claims**: "sql.js fallback is intentional — serves real edge environments (Vercel, Cloudflare Workers, Docker minimal)."

**Actual state** (verified from fork source):

- `@claude-flow/memory/src/database-provider.ts:21` defines `DatabaseProvider = 'better-sqlite3' | 'rvf' | 'auto'` — **no `'sqljs'` case**
- `createDatabase` switch at `database-provider.ts:192` has no sql.js branch
- `sqlite-backend.ts:12` hard-imports `better-sqlite3` with no try/catch — module load fails if native unavailable
- `SqlJsBackend` class is not exported from `@sparkleideas/memory/index.js`

**Ruflo-patch checks actively delete sql.js**:

- `check_adr0080_no_raw_sqljs` (`adr0080-checks.sh:1029`) — fails if any `import('sql.js')` appears in published CLI `.js`
- `check_adr0065_no_sqljs_backend` (`adr0065-checks.sh:144`) — fails if `SqlJsBackend` re-exported
- `check_no_sqljs_in_tool_descriptions` (`adr0084-checks.sh:82`) — fails on any `"sql.js"` string in user-facing output

**sql.js is still a package dependency** of `@claude-flow/memory`, `@claude-flow/shared`, `@claude-flow/embeddings`. The runtime consumers that remain:

- `event-store.ts:20` — event sourcing (top-level static import)
- `persistent-cache.ts:81,404` — embedding cache
- `rvf-migration.ts:128` — migration read path only

**None of these is the memory fallback ADR-0075 describes.** The edge-environment memory fallback was silently removed. Either ADR-0075's claim is stale, or we have an undocumented regression. Tests do NOT exercise any remaining sql.js path.

### JSON state files — 10 of 15 files have zero coverage

Auditor: `af4ab6abb4266951b` (state files auditor).

**Adequate coverage (✓ in all 5 dims: created / valid JSON / schema / CLI-updated / persisted)**: **0 files**.

**Partial (2-4 dims)**: `config.json`, `embeddings.json` — both init-time only, never round-tripped through a post-init CLI op.

**Weak (1 dim, presence-only)**: `ranked-context.json`, `pending-insights.jsonl`, `auto-memory-store.json`.

**Zero coverage** (10 files):

- `daemon-state.json` — ADR-0088 checks only `daemon status` stdout, never opens the JSON
- All 5 `.claude-flow/metrics/*.json` files (codebase-map, security-audit, performance, consolidation, test-gaps) — zero grep hits. `hooks worker dispatch --trigger consolidation` fires but nothing reads the output
- `intelligence-snapshot.json`
- `cjs-intelligence-signals.json`
- `.swarm/state.json`
- `.swarm/agents.json`

**Critical observation**: the only files with schema validation (`config.json`, `embeddings.json`) are init-time only. Everything written **after** init by daemon workers, hooks, or swarm coordination has zero to grep-level coverage.

## Decision

Split remediation into three tiers with explicit commitment levels.

### Tier A — Fix the lies (commit this session, ~1 day)

Honest-labeling fixes that remove false coverage and resolve the sql.js divergence. All are low-risk and high-signal.

**A1. Upgrade `check_adr0086_debt15_sqlite_path` to verify controller persistence.**

Currently verifies agentdb init. Upgrade to:

1. Run `cli mcp exec --tool agentdb_reflexion_store --params '{"insight":"acceptance test reflexion","embedding":"..."}'`
2. Use the `sqlite3` CLI binary (present on developer Macs + CI — no new product or test deps) to query `SELECT COUNT(*) FROM episodes WHERE task LIKE 'acceptance test reflexion adr0090%'` → must be `>= 1`. (The actual agentdb schema uses `episodes`, not `reflexion_log` — verified in `agentdb/dist/schemas/schema.sql:21` and `ReflexionMemory.js:22` during Tier A1 implementation.)
3. Kill CLI, reopen, query again → still `>= 1` (persistence proof)
4. Keep the source-grep guards as additional checks; don't remove them.

**A2. Fix `check_adr0073_native_runtime` silent-pass.**

`lib/acceptance-adr0073-checks.sh:177` sets `_CHECK_PASSED="true"` when the native import fails with "SKIP:". Per ADR-0082 this is the exact anti-pattern the project bans. Change to: if native import fails, `_CHECK_PASSED="false"` with a clear "Expected native RVF available, got: $err". The ONLY acceptable SKIP is when the binary is explicitly absent from the build (detected by file-existence check in a separate upstream step), and that must emit a distinct `_CHECK_OUTPUT="SKIP_ACCEPTED: ..."` that the runner treats as a warning, not a pass.

**A3. Reconcile sql.js with upstream.**

Two options — pick one and commit:

- **Option A3-DELETE**: Write ADR-0091 "sql.js Memory Fallback Removed". Document that the edge-environment memory fallback from ADR-0075 no longer exists in code, mark ADR-0075's creator correction as stale, and explicitly accept that `@sparkleideas/cli` does not support edge environments without native `better-sqlite3`.
- **Option A3-RESTORE**: Restore `SqlJsBackend` in `@claude-flow/memory/src/sqljs-backend.ts`, wire it into `DatabaseProvider` selector, add a `check_sqljs_roundtrip_fallback` acceptance check that shadows `better-sqlite3` via `NODE_PATH` and verifies a store/retrieve round-trip works under sql.js.

Recommendation: **A3-DELETE**. The architecture already reflects this; the claim in ADR-0075 is the stale part. Write ADR-0091 in the same session as ADR-0090.

**A4. Fix `check_t3_2_concurrent_writes` contract mismatch.**

Currently scans for `SQLITE_BUSY` / `database is locked` — the wrong error shape for RVF file locking. Replace with actual `.rvf.lock` contention detection: spawn N concurrent `cli memory store` processes, verify exactly one acquires the lock at a time (no "all succeed without serialization") and the file survives with all N entries present. Or rename to `check_t3_2_sqlite_concurrent_writes` if the goal is actually SQLite (it shouldn't be — RVF is the CRUD path).

### Tier B — Close the critical gaps (planned, committed to within next 2 sessions)

**B1. L3 dimension-mismatch fail-loud test.** Pre-seed `.claude-flow/memory.rvf` with a doctored 384-dim entry, start CLI with 768-dim pipeline config, run `cli memory search` → assert exits non-zero with clear "dimension mismatch" error message. ~40 LOC.

**B2. RVF corruption recovery suite.** Three checks:

- `check_rvf_truncated` — truncate `.rvf` to half its size, run `cli memory search` → verify fail-loud or recovery
- `check_rvf_bad_magic` — overwrite first 8 bytes with zeros, run same → verify fail-loud
- `check_rvf_partial_wal` — truncate `.rvf.wal` mid-record, run → verify clean recovery (WAL's reason to exist)

**B3. Daemon metrics file read-back checks** (5 checks, one per worker):

- After `hooks worker dispatch --trigger map`, open `.claude-flow/metrics/codebase-map.json`, verify valid JSON + required fields
- Same for audit, optimize, consolidate, testgaps

**B4. `better-sqlite3` absence guard.** New check in `acceptance-package-checks.sh`: fail if `better-sqlite3` appears in `@sparkleideas/cli/package.json` `dependencies` or `devDependencies`. Must ONLY appear in `optionalDependencies` (per ADR-0086 Debt 7).

**B5. Controller-specific row-count round-trips.** For each of the 15 neural controllers, add a check that:

1. Runs a controller-specific MCP tool (e.g., `agentdb_skill_create`) with known data
2. Queries the SQLite file via `sqlite3` CLI for the matching row
3. Asserts row count > 0 AND stored fields match

~15 checks total, ~30 LOC each. Can be batched in `acceptance-controller-checks.sh` as new functions.

**B6. State file persistence round-trips.** For each of the 10 zero-coverage state files, add minimum viable check: "CLI op X writes to file Y, new CLI op reads file Y, value matches". Not all 10 need immediate round-trips — prioritize `daemon-state.json` + 5 metrics files first.

### Tier C — Deferred (catalogued, not committed)

- Swarm state file coverage (`.swarm/state.json`, `.swarm/agents.json`)
- `:memory:` mode runtime check
- HNSW rebuild-after-compaction check
- `bulkInsert` atomicity check
- `entries > maxElements` runtime trip check
- Two-layer fail-loud (all backends fail) test
- L4 runtime "single resolveConfig path" trace check (needs instrumentation)
- L2 cross-entrypoint instance identity runtime check (needs new MCP tool)

These are listed for completeness. Each can be reopened by a future ADR if a specific bug makes it urgent. None are blocking today.

## Revised layer scoring (post-ADR-0090 honest)

| Layer | Before audit (claimed) | After audit (honest) | After Tier A (actual) | After Tier A+B (planned) |
|---|---|---|---|---|
| L1 (Storage) | 95% | **60%** (Debt 15 facade + 8 RVF gaps) | **78%** (Debt 15 real-row-count proof + A2 silent-pass eliminated + A4 real `.rvf.lock` contention) | 90% |
| L2 (Controllers) | 100% (ADR-0089) | **65%** (no SQLite row-count verification for 15 controllers) | **72%** (1 of 15 controllers — `episodes` via A1 — has real round-trip; 14 still gap) | 95% |
| L3 (Embeddings) | 90% | **70%** (no dimension-mismatch fail-loud) | 70% (unchanged — Tier B1) | 85% |
| L4 (Config) | 95% | 90% (init-time only, no runtime path check) | 90% (unchanged) | 90% |
| L5 (Data Flow) | 98% | **80%** (file-existence theater in multiple checks) | **86%** (A4 now reads `.rvf` bytes via header inspection; harness gained `skip_accepted` bucket so SKIP no longer masks FAIL) | 95% |
| **Weighted total** | **~94%** | **~75%** | **~81%** | **~91%** |

**The drop from 94% to 75% was honesty, not new failures.** Tier A lifted the honest number to ~81% by:
- Adding three-way status in the harness (`pass`/`fail`/`skip_accepted`) so ADR-0082's no-silent-pass rule is enforceable at the runner level, not just in check bodies
- Replacing the Debt 15 facade with a real row-count round-trip against the `episodes` table (across a CLI restart)
- Retargeting `check_t3_2_*_concurrent_writes` from `SQLITE_BUSY` (wrong backend) to real multi-writer contention against the primary RVF store

**The A4 check is actively failing against live CLI** — see "Tier A4 upstream discovery" below. That failure is real, not a test bug, and is a Tier B follow-up candidate rather than a Tier A regression.

## Explicit acceptance

This ADR is load-bearing for three specific claims made earlier in this session:

1. **ADR-0086 Debt 15** is re-classified from "Accepted Trade-Off with regression guard" to **"Accepted Trade-Off with real controller-persistence round-trip"** (Tier A1 implemented 2026-04-15, commit `be70f29`).
2. **ADR-0088 Implementation Results** (`241/242` and then `242/242`) are not revised — those numbers remain accurate as counts. The audit exposed that three of the passing checks were silent-pass anti-patterns; all three were rewritten in Tier A (commits `be70f29`, `feb3d2a`, `727571f`). Tier A2 additionally eliminated the harness-level silent-pass gap by adding a `skip_accepted` bucket distinct from `pass`.
3. **ADR-0089** Layer 2 100% claim is re-classified from "100% against revised criteria" to "100% against revised criteria PLUS 1 of 15 controllers (`episodes`) verified by Tier A1, 14 pending B5". Until B5 lands, Layer 2 is honestly 72%.

## Tier A4 upstream discovery — and fix (B7 closed in the same session)

While implementing Tier A4, the new `check_t3_2_rvf_concurrent_writes` check exposed what turned out to be two real bugs in `RvfBackend`. A 2-agent ruflo hive (Queen + Devil's Advocate) investigated them independently, then a deterministic in-process repro (`scripts/diag-rvf-inproc-race.mjs`) ruled out the Devil's Advocate's three confounds (cold-start contention, `timeout 90` SIGTERM, `walCompactionThreshold` mid-store compaction). Pre-fix observations from the repro (20 trials per scenario):

| Scenario | foundKeys / N | Loss rate | Crashed writers |
|---|---|---|---|
| N=2, wal=1000 | 1/2 in 20/20 | 50% | 0/20 |
| N=4, wal=1000 | 1/4 in 20/20 | 75% | 0/20 |
| N=8, wal=1000 | 1/8 in 20/20 | 87.5% | 20/20 (lock starvation) |
| N=4, wal=10   | 1/4 in 20/20 | 75% | 0/20 |

**Exactly `1/N` surviving in every single trial.** Not a distribution — deterministic. At N=2/4, zero crashes, zero dangling locks, callers got no signal at all. At N=8, a secondary bug (lock retry starvation) surfaced on top of the primary race.

**Two bugs**:

1. **Snapshot-overwrite race in `persistToDiskInner`**. Each writer's `this.entries` is a snapshot taken at `initialize()` time. When a peer compacted its WAL between our init and our shutdown, their entries landed in `.rvf`. Then our `shutdown()` → `compactWal()` → `persistToDiskInner()` rewrote `.rvf` from our stale snapshot, silently discarding peer writes.
2. **Lock retry starvation in `acquireLock`**. The 5-retry × 100ms fixed budget (~500ms total) starved 3-of-8 writers at N=8. Comment said "Retries up to 3 times with 50ms delay" — doubly stale: wrong count, wrong delay.

**Both fixed in fork commit `03ecec5e0`** (`fix: ADR-0090 B7 — RvfBackend multi-writer convergence + lock retry budget`):

- New `mergePeerStateBeforePersist()` called at top of `persistToDiskInner` (under the existing advisory lock). Re-reads `.rvf`/`.meta` with set-if-absent (our writes win on key conflict, peer entries we didn't have are merged), then replays the current WAL via the existing `replayWal()` path. HNSW/native index updates are intentionally skipped — this is the terminal persist for the instance.
- `acquireLock()` rewritten as time-budgeted retry: 5s total budget, exponential backoff (20ms → 500ms cap), ±50% jitter. Dead holders / stale locks (>5s) are cleared without waiting. Error message reports actual attempts + elapsed ms + budget.

**Post-fix observations from the same repro** (20 trials per scenario):

| Scenario | foundKeys / N | Loss rate | Crashed writers |
|---|---|---|---|
| N=2, wal=1000 | 2/2 in 20/20 | **0%** | 0/20 |
| N=4, wal=1000 | 4/4 in 20/20 | **0%** | 0/20 |
| N=8, wal=1000 | 8/8 in 20/20 | **0%** | 0/20 |
| N=4, wal=10   | 4/4 in 20/20 | **0%** | 0/20 |

Both bugs eliminated. N=8 also runs faster (5.7s vs 8.3s — exponential backoff is more efficient than fixed 100ms polling).

**B7 is closed in-session**, not promoted to upstream escalation backlog. `scripts/diag-rvf-inproc-race.mjs` now serves as the regression guard — it exits 1 on any future loss or crash, so any upstream regression that re-breaks the convergence or retry logic will fail loudly.

This also partially upgrades **ADR-0086 Debt 9** ("Concurrent WAL corruption — FIXED"). The original fix addressed byte-level WAL append integrity, not logical state convergence. B7 closes the state-convergence gap. Debt 9 is now honest rather than marketing.

## Acceptance criteria for ADR-0090 itself

ADR-0090 is not implemented when it's committed — it's implemented when Tier A lands. Specifically:

1. ✅ Tier A1 (Debt 15 upgrade): new unit + acceptance check pair that verifies at least 1 row in `episodes` after a controller write. **Commit `be70f29`**, 22 new unit tests + upgraded acceptance check. (Spec originally said `reflexion_log`; implementation verified actual agentdb table name is `episodes`.)
2. ✅ Tier A2 (`adr0073-native-runtime` silent-pass fix): check no longer passes on SKIP. **Commit `feb3d2a`**, 16 new unit tests, plus harness-level `skip_accepted` bucket added to `lib/acceptance-harness.sh` + `scripts/test-acceptance.sh`.
3. ✅ Tier A3 (sql.js reconciliation): ADR-0091 written. **Commit `a6dfc01`**, ADR-0075 creator-correction marked stale.
4. ✅ Tier A4 (`t3_2_concurrent_writes` fix): check renamed to `check_t3_2_rvf_concurrent_writes` and rewritten for real `.rvf.lock` contention. **Commit `727571f`**, 10 unit + 2 real-writer integration tests. Full unit+pipeline suite: 2815/2815 pass.
5. ✅ Layer scoring table in this ADR updated with post-Tier-A actuals. **This commit.** Weighted total: 75% → 81%.

All 5 criteria hold. ADR-0090 status is now `Implemented (Tier A)`. Tier B is a separate tracking gate (with new item B7 added from the Tier A4 upstream discovery).

## Alternatives Considered

### Option A: Update ADR-0082 instead of writing ADR-0090

Add a "2026-04-15 refresh" section to ADR-0082 with the new findings.

**Rejected**: ADR-0082 is 9 months old and its "Partially Implemented" status is misleading. The new audit (post-ADR-0086/0088) found issues ADR-0082's 2026-03 snapshot didn't catch. A fresh ADR makes the new snapshot discoverable; updating the old one buries it in a long changelog.

### Option B: File individual GitHub issues instead of an ADR

Open 36 issues (one per gap) and track in project board.

**Rejected**: ADRs are for decisions. "Which gaps to fix, which to defer, which to accept" is a decision that needs persistent reasoning. Issues are work items derived from decisions. Write the ADR first, spawn issues from it for Tier A/B items.

### Option C: Implement Tier A silently without writing an ADR

Just fix the 4 Tier A items.

**Rejected**: the Debt 15 facade discovery and the sql.js divergence are non-obvious architectural findings that future engineers need to read. A silent fix leaves no trail. ADR-0090 captures the reasoning so the next audit (in N months) doesn't rediscover the same things.

### Option D (chosen): ADR-0090 documents findings + 3-tier commitment + explicit acceptance

This shape.

## References

- 4-agent ruflo swarm, 2026-04-15 (swarm ID `swarm-1776284919158-2zg8bi`):
  - RVF auditor task: `a777de03cf4172501`
  - SQLite/agentdb auditor task: `a824a24f77fb11046`
  - sql.js fallback auditor task: `a2d8fc222c54ff8ec`
  - State files auditor task: `af4ab6abb4266951b`
- ADR-0082 — Test Integrity — No Fallbacks (precedent, partial status superseded by this ADR for 2026-04 snapshot)
- ADR-0086 — Layer 1 Storage Abstraction (§Debt 15 is re-classified here)
- ADR-0088 — Daemon Scope Alignment (numeric results remain; specific checks flagged for Tier A)
- ADR-0089 — Controller Intercept Pattern Permanent (Layer 2 100% claim pending B5)
- `lib/acceptance-adr0086-checks.sh:542-632` — the Debt 15 facade check to upgrade
- `lib/acceptance-adr0073-checks.sh:131-186` — the silent-pass anti-pattern to fix
- `lib/acceptance-adr0079-tier3-checks.sh:107-163` — the concurrency-check contract mismatch
