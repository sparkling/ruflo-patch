# ADR-0118 Execution Plan — Hive-mind runtime gaps T1-T11

- **Status**: Living plan (per ADR-0094 pattern)
- **Date**: 2026-05-02
- **Purpose**: Wave-based execution plan for implementing 11 task ADRs (T1-T11) using parallel agent swarms (up to 15 agents)
- **Companion to**: ADR-0118 (parent tracker), ADR-0118-review-notes-triage.md (resolved decisions)

## Constraints

- Up to 15 agents in a swarm per wave; spawned via `Agent` tool with `run_in_background: true` per CLAUDE.md
- Each agent's scope: full Tn implementation — code + 3-level test pyramid (unit + integration + acceptance) per `feedback-all-test-levels.md`
- Trunk-only on forks per `feedback-trunk-only-fork-development.md` — pipeline is hardcoded to `git push origin main`
- Cascading pipeline: each Tn ships through `npm run test:acceptance` (Levels 1+2+3) before annotation lift
- 100% durability bar per `feedback-data-loss-zero-tolerance.md`
- Fail loudly per `feedback-no-fallbacks.md` — no silent fallback branches, throw at unknown inputs
- Annotation lift via H5 single-axis: T marked `complete` in ADR-0118 §Status with Owner/Commit naming green-CI commit; lift fires on next materialise run
- Build-scripts only per `feedback-build-scripts-only.md` — never invoke pipeline phases manually

## Pre-flight checks

Before Wave 1 launches:

| # | Check | Action |
|---|---|---|
| 1 | Verdaccio up | `curl -sf http://localhost:4873/-/ping` |
| 2 | Forks have `sparkling` remote | `git -C forks/<fork> remote -v \| grep sparkling` |
| 3 | Trunk synced on each fork | `git -C forks/<fork> pull origin main` (forks: ruflo, agentic-flow, ruv-FANN, ruvector) |
| 4 | Baseline tests green | `npm run test:unit && npm run test:acceptance` |
| 5 | Triage decisions still hold | Re-read ADR-0118-review-notes-triage.md §Henrik decisions resolved; confirm H1-H6 not stale |
| 6 | `partitionDetected` field stub | Pre-flight T9 row 46: add type-level `partitionDetected: boolean` to `HealthReport` interface at `forks/ruflo/v3/@claude-flow/swarm/src/queen-coordinator.ts:183` (T9 in Wave 3 needs this). Type-level only — no runtime detection logic in Wave 1 |

## Wave 1 — Independent tasks (5 agents in parallel)

All 5 tasks have zero hard Tn dependencies and touch non-conflicting file regions.

| Slot | Tn | ADR | Touch points | Risk | Hours-equivalent scope |
|---|---|---|---|---|---|
| 1 | T1 | ADR-0119 | `hive-mind-tools.ts` lines 46-163, 575 (consensus arm) | low | small — single-file diff |
| 2 | T4 | ADR-0122 | `hive-mind-tools.ts` lines 966-1039 (memory tool) | medium | medium — typed shape + sweep timer |
| 3 | T7 | ADR-0125 | `commands/hive-mind.ts` (generateHiveMindPrompt) + `forks/ruflo/README.md` (per H4) | low | small — prompt-map branches + README copy |
| 4 | T10 | ADR-0128 | `commands/hive-mind.ts:30-35,90` + `unified-coordinator.ts` (worker-spawn dispatch) | medium | medium — per-topology coordination protocols |
| 5 | Pre-flight T9 | n/a | `queen-coordinator.ts:183` (HealthReport interface extension only) | type-level | tiny — interface field add, no runtime |

**File-conflict matrix (Wave 1)**:
- T1 + T4 both edit `hive-mind-tools.ts` but in non-overlapping regions (lines 46-163 vs 966-1039). Safe parallel.
- T7 + T10 both edit `commands/hive-mind.ts` but different functions (generateHiveMindPrompt body vs TOPOLOGIES enum + worker-spawn). Safe parallel.
- Slot 5 (pre-flight T9) edits only `HealthReport` interface at line 183. No overlap with T7/T10.

**Inter-wave gate after Wave 1 completes**:
1. Owner/Commit named in ADR-0118 §Status for T1, T4, T7, T10 (all status `complete` with green-CI commit hash)
2. Verdaccio publish: `npm run publish:verdaccio` succeeds
3. Smoke test: fresh `init --full` against published packages exercises T1/T4/T7/T10 surfaces
4. Annotation lift: next materialise run drops "3 voting modes (Weighted)" + "8 memory types" + "3 Queen types" + "5 swarm topologies" rows from ADR-0116 plugin README

## Wave 2 — Tier 2 tasks (5 agents in parallel, depend on Wave 1)

| Slot | Tn | ADR | Depends on | Touch points | Risk |
|---|---|---|---|---|---|
| 1 | T2 | ADR-0120 | T1 (enum extended) | `hive-mind-tools.ts` (gossip arm + per-round timeout) | medium |
| 2 | T3 | ADR-0121 | T1 (enum extended) | `hive-mind-tools.ts` + new `crdt-types.ts` | medium-high |
| 3 | T5 | ADR-0123 | T4 (typed shape) | `hive-mind-tools.ts` (loadHiveState/saveHiveState) + RVF backend integration | medium |
| 4 | T8 | ADR-0126 | T7 (queen prompts) | `commands/hive-mind.ts` (worker prompt loop) + `queen-coordinator.ts:1234-1256` (typeMatches + scoring) | low-medium |
| 5 | T13 | ADR-0108 | T8 (soft) | `commands/hive-mind.ts` (`--worker-types` CLI flag) + `mcp-tools/hive-mind-tools.ts:285-296` (MCP `agentTypes` schema) + `validate-input.ts:49-65` (wire dead-code `validateWorkerType` validator) | low-medium |

**File-conflict watch (Wave 2)**:
- T2 + T3 both add cases to `_consensus` action handler switch. Each adds its own case branch; merge conflict risk on the action enum line. **Mitigation**: serialize to T2 → T3 if conflict surfaces; otherwise parallel with rebase.
- T5 + T8 don't share files. Safe.
- T8 + T13 both touch `commands/hive-mind.ts` but different functions: T8 modifies `generateHiveMindPrompt` body (lines 65-190); T13 modifies CLI option parsing in `spawnCommand.options` (lines 540-545) + the spawn dispatch loop. T13 + T8 also both touch `hive-mind-tools.ts`: T13 changes the `hive-mind_spawn` tool schema (lines 285-296), T8 doesn't touch that surface. Safe parallel.

**Inter-wave gate after Wave 2**:
- Same as Wave 1
- T5 specifically: 100% durability gate — `check_adr0123_concurrent_write_durability` must pass at 100% (not 99.x) per `feedback-data-loss-zero-tolerance.md`

## Wave 3 — Tier 3 tasks (4 agents in parallel)

| Slot | Tn | ADR | Depends on | Touch points | Risk |
|---|---|---|---|---|---|
| 1 | T6 | ADR-0124 | T4, T5 | new `commands/hive-mind-session.ts` + state.json schema (queenType per H6) + `mcp__ruflo__hive-mind_status` handler | medium |
| 2 | T9 | ADR-0127 | T7, T10 | new `adaptive-loop.ts` module + `queen-coordinator.ts:183` (HealthReport runtime population) + `unified-coordinator.ts:585` | **HIGH** |
| 3 | T11 | ADR-0130 | T5 | `rvf-backend.ts:488-491` (fsync at appendToWal) | medium |
| 4 | T12 | ADR-0131 | T1 (soft) | `mcp-tools/hive-mind-tools.ts` (`_consensus` action: auto-status-transitions, `retryTask` action) + `commands/hive-mind.ts` (worker prompt updates for failure-detection model) + `_status` MCP tool surface | medium |

**T12 placement rationale**: T12 touches `_consensus` MCP tool, which T1/T2/T3 also extend. Placing T12 in Wave 3 (after T1/T2/T3 stabilize via Waves 1+2) avoids three-way conflicts on the `_consensus` action handler switch. T12's auto-status-transition logic builds on top of whatever consensus arms T1/T2/T3 ship.

**File-conflict watch (Wave 3)**:
- T6 touches `commands/hive-mind-session.ts` (new file) + state.json schema. No conflict with T9/T11/T12.
- T9 touches `queen-coordinator.ts` (HealthReport runtime population) + `unified-coordinator.ts` + new `adaptive-loop.ts`. No conflict with T6/T11/T12.
- T11 touches `rvf-backend.ts:488-491`. No conflict with T6/T9/T12.
- T12 touches `_consensus` action handler in `hive-mind-tools.ts` and worker prompts in `commands/hive-mind.ts`. T6 also touches `commands/hive-mind.ts` but different surface (sessions handler, not worker prompts). Safe parallel.

**T9 — High-risk callout**:
- Autonomous control surface. ESCALATION CHECKPOINT applies: if PRELIMINARY thresholds (poll interval 5s, settle window, dampening duration, flip-rate ceiling 4/hour) prove degenerate during integration tests, **halt T9 implementation** and write a design ADR before code lands. Per ADR-0127 §Validation + §Completion + ADR-0118 §Open questions item 3.
- Two-phase annotation lift per H6:
  - Phase 1: T9 ships scaling end-to-end + topology mutation type-level only (throws not-implemented marker until T10 complete). Status `in-progress`.
  - Phase 2: T9 + T10 both `complete`. Full row drops from plugin README.

**T11 — fsync platform note**:
- Linux: `fsync(2)` flushes through to disk
- macOS: `fsync(2)` only flushes to disk cache; true durability requires `fcntl(F_FULLFSYNC)` (not in Node stdlib)
- Implementer documents per-platform durability semantics in §Specification before merge

## Annotation lift orchestration (H5 single-axis)

For each Tn:
1. Implementer writes Owner + Commit in ADR-0118 §Status row
2. Status flips `open` → `in-progress` → `complete`
3. Owner/Commit naming convention: human discipline gates on green CI (no script-side CI check)
4. Next materialise run drops the ADR-0116 plugin README "Known gaps" row + flips `implementation-status: missing|partial` → `implemented`

Two-phase lifts (T9 only): see Wave 3 T9 callout above.

## Risk profile summary

| Risk | Tns | Why |
|---|---|---|
| Low | T1, T7 | Single-file diffs, well-bounded |
| Low-medium | T8, T13 | Multi-file but mechanical (T13 = V2-parity restore; ADR-0108 design Accepted) |
| Medium | T2, T4, T5, T6, T10, T11, T12 | Substantive but bounded design |
| Medium-high | T3 | CRDT merge semantics need careful property tests |
| **High** | T9 | Autonomous control surface; ESCALATION trigger active |

## Failure modes and recovery

| Failure | Response |
|---|---|
| Verdaccio down | Halt all waves; resume when restored |
| Test failure on a single Tn | Halt that Tn only; other Tns in same wave continue independently |
| Pipeline failure (`npm run test:acceptance`) on Tn commit | Implementer fixes root cause per `feedback-no-squelch-tests.md`; never weaken assertions |
| ESCALATION trigger (T9 thresholds degenerate) | Halt T9; spawn design ADR; T9 stays at "Phase 1 partial" until threshold ADR lands |
| File conflict during merge | Bump dependent Tn to next wave; respawn with rebase |
| Concurrent write durability < 100% (T5) | Per `feedback-data-loss-zero-tolerance.md` — NOT shippable; halt T5 until 100% achieved |

## Agent budget per wave

| Wave | Agents in flight | Tns advanced | % of 15-agent budget |
|---|---|---|---|
| 1 | 5 | T1, T4, T7, T10 + pre-flight T9 | 33% |
| 2 | 5 | T2, T3, T5, T8, T13 | 33% |
| 3 | 4 | T6, T9, T11, T12 | 27% |

Total: 13 Tns shipped across 3 waves (T1-T13). Peak parallelism is 5 agents in Waves 1 and 2 — well within the 15-agent budget. Headroom available for:
- Adding unit-test-only agents per Tn (parallel to implementation agent within same Tn)
- Spawning a per-wave verification agent that runs alongside the implementation slots
- Splitting T9 into separate "control loop" + "topology mutation" agents if scope demands

## Total elapsed wall-clock estimate

(Per `feedback-no-time-estimates.md`: not stated. Each Tn ships when its acceptance gate passes; coordination cost dominates the trivial-implementation Tns; T9 dominates Wave 3 elapsed.)

## Spawn template per Tn implementation agent

Each Wave-N agent receives a self-contained prompt with:
1. Path to its Tn ADR (e.g. `/Users/henrik/source/ruflo-patch/docs/adr/ADR-0119-...`)
2. Path to ADR-0118-review-notes-triage.md for resolved decisions
3. Constraint: **edit only the fork files in scope per the Tn ADR's §Architecture**; do NOT touch ruflo-patch infrastructure
4. Constraint: write all 3 test pyramid levels in same commit
5. Constraint: run `npm run test:acceptance` to verify before reporting done; capture full log per `feedback-no-tail-tests.md`
6. Constraint: build-scripts only per `feedback-build-scripts-only.md` (use `npm run publish:verdaccio` / `npm run test:acceptance`, never piecemeal phases)
7. Constraint: trunk-only per `feedback-trunk-only-fork-development.md`; commit on fork's `main`, push to `sparkling`
8. Constraint: NO Co-Authored-By trailer on fork commits per `feedback-fork-commit-attribution.md`
9. Output: confirm Tn implementation complete + name the green-CI commit hash for ADR-0118 §Status update

## Pre-Wave-1 confirmation checklist (Henrik)

Before launching Wave 1:
- [ ] All 6 H decisions in triage doc confirmed still applicable
- [ ] Pre-flight checks 1-6 pass
- [ ] Henrik acks ESCALATION RULE for T9 (Wave 3) — if thresholds degenerate, spawn design ADR
- [ ] Optional: spawn read-only orientation agent that re-reads each ADR's §Specification + §Architecture and reports any updated line refs the ADR may carry post-edit

## References

- ADR-0118 (parent tracker)
- ADR-0118-review-notes-triage.md (resolved Henrik decisions H1-H6)
- ADR-0119 through ADR-0128, ADR-0130, ADR-0131 (per-task ADRs)
- ADR-0108 (T13 task ADR; mixed-type worker spawn mechanism)
- ADR-0094 — living tracker pattern
- ADR-0038 — cascading pipeline
- CLAUDE.md — test pyramid, concurrency, build & test
- Memory: `feedback-no-fallbacks.md`, `feedback-data-loss-zero-tolerance.md`, `feedback-all-test-levels.md`, `feedback-trunk-only-fork-development.md`, `feedback-build-scripts-only.md`, `feedback-no-time-estimates.md`, `feedback-no-tail-tests.md`, `feedback-fork-commit-attribution.md`, `reference-fork-workflow.md`, `reference-cli-cmd-helper.md`
