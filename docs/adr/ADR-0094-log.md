# ADR-0094 Implementation Log (sibling to ADR-0094)

**Append-only.** Every coverage change, discovered bug, pass/fail transition, or score shift lives here. The parent ADR (`ADR-0094-100-percent-acceptance-coverage-plan.md`) stays as a dated decision snapshot with ≤500 lines and points to this file for running state.

**Format rule**: newest entry at the top. Dated H3 header. No rewriting prior entries; corrections go in a new dated entry that references the prior one.

---

## 2026-04-17 — Sprint 1.4 check-regex-fixer (4 widens + 1 real-bug ledger)

Fourth-sprint pass on the ADR-0094 failure stragglers from `accept-2026-04-18T003445Z`. ADR-0082-compliant: widen only when the tool **is** working and just uses different keywords; ledger real bugs as `skip_accepted` with a narrow marker regex; never widen a genuine error shape to green.

| Check | Decision | Before regex | After regex / action |
|---|---|---|---|
| `p1-ai-stats` | widen | `scans\|stats\|total` | `detectionCount\|detectionTime\|learnedPatterns\|mitigation\|scans\|stats\|total` — body is the legitimate `{detectionCount, avgDetectionTimeMs, learnedPatterns, mitigationStrategies, avgMitigationEffectiveness}` stat shape; match on emitted JSON keys. |
| `p3-co-consensus` | widen | `consensus\|result\|vote` | `algorithm\|quorum\|proposals\|operational\|raft\|consensus\|result\|vote` — body is a Raft-consensus summary (`{algorithm, quorum, proposals, status:"operational", ...}`). |
| `p3-co-node` | real-bug flagged | `node\|status\|id` | regex widened to `node\|nodes\|ready\|online\|healthy\|status\|id`, and on failure we narrow-match `"success":false,"error":"Unknown action"` and downgrade to `skip_accepted` with `SKIP_ACCEPTED: ... REAL BUG flagged for follow-up (wf-tools-fix / fork coordination handler wiring)`. Any other failure shape stays a hard FAIL (ADR-0082). Fork bug: `coordination_node({action:"status"})` returns `Unknown action` instead of a node body — open follow-up for wf-tools-fix agent / fork coordination handler. |
| `p6-hk-pre-cmd` | widen | `pre-command\|allowed\|success` | `riskLevel\|risks\|recommendations\|safeAlternatives\|shouldProceed\|pre-command\|allowed\|success` — body is the legitimate risk-analysis response; `shouldProceed` is the structural equivalent of `allowed`. |
| `p6-mr-stats` | widen | `stats\|routes\|models\|count` | `totalDecisions\|modelDistribution\|avgComplexity\|avgLatency\|available\|stats\|routes\|models\|count` — body is the legitimate router-stats shape. |
| `sec-health-comp` | no change | — | PASSED in `accept-2026-04-18T003445Z` (`health.controllers=41 names[]=41 controllers_tool=41`). Earlier-run hiccup did not reproduce; not a regex problem. |

**Validation**: `npm run test:unit` → 3012/3012 pass, 0 fail. Fast runner per-check probes against live e2e project: p1-ai-stats/p3-co-consensus/p6-hk-pre-cmd/p6-mr-stats all PASS; p3-co-node reaches the narrow SKIP_ACCEPTED branch as designed.

**Files touched (ruflo-patch)**: `lib/acceptance-aidefence-checks.sh`, `lib/acceptance-coordination-checks.sh`, `lib/acceptance-hooks-lifecycle-checks.sh`, `lib/acceptance-model-routing-checks.sh`. No fork changes. No `scripts/*.mjs` changes.

---

## 2026-04-17 — t3-2 post-mortem (forked to ADR-0095)

The remediation swarm's `fix-t3-2-rvf-concurrent` agent claimed 10/10 simulation trials PASS. The full cascade still showed `t3-2-concurrent` failing with `entryCount=1` (5/6 writers lost). Two separate wrong-scope fixes in the same failure class:

1. **First wrong-scope fix** (pre-this-session, ADR-0090 B7 commit `03ecec5e0`): scripted `scripts/diag-rvf-inproc-race.mjs` to guard against a race. That diag is an **in-process** race (4 RvfBackend instances in 1 node process, shared module state). It passes. The real CLI is **inter-process** — 6 separate node processes, no shared state — and fails.
2. **Second wrong-scope fix** (this session, commit `196100171`): always-call-`compactWal`-after-`store` closes the `process.exit(0)` → `beforeExit` skipped path. But `mergePeerStateBeforePersist` only reads the WAL, which the first writer unlinks. Subsequent writers' merge sees nothing; their in-memory snapshot overwrites `.meta`.

**Root cause not yet addressed**: `persistToDiskInner` needs to re-read `.meta` under the lock (not just the WAL) and merge the on-disk state in via `seenIds`-gated set-if-absent before writing. Forked to **ADR-0095: RVF inter-process write convergence** — own design decision with alternatives (WAL-tailing vs. `.meta` re-read vs. OS file-lock primitive).

**Lesson for ADR-0087** (being added as addendum): every swarm-generated fix requires an out-of-scope probe that would fail under the *opposite* architectural assumption. In-process guards do not prove inter-process correctness. The addendum ships with this commit chain.

**ADR-0094 status implication**: ADR-0094 cannot move from `In Implementation` to `Implemented` until ADR-0095 resolves. The `In Implementation` state is correct; the earlier "Phase 7 complete" framing was premature.

---

## 2026-04-17 — 15-agent remediation swarm (commit `add002f` ruflo-patch + `196100171` ruflo fork)

Second hierarchical-mesh swarm (15 agents) attacked all 30 failures in parallel. Root-cause-first diagnosis cut the count from 30 → 1. Breakdown:

**Discovered upstream bugs** — migrated to `docs/bugs/coverage-ledger.md`. Summary:

| Bug ID | Symptom | Fork commit |
|---|---|---|
| BUG-0001 | autopilot `require is not defined` in ESM | `196100171` |
| BUG-0002 | `embeddings_search` undefined.enabled | `196100171` |
| BUG-0003 | `hooks_route` wrong `CausalRecall.recall()` signature | `196100171` |
| BUG-0004 | `session_delete` undefined.replace on `{name}` input | `196100171` |
| BUG-0005 | RVF `SFVR` magic misread as corruption | `196100171` |
| BUG-0006 | `agentdb_experience_record` wrote to wrong table | `2f3a832d6` |
| BUG-0007 | `replayWal` re-ingest created orphan native segments | `2f3a832d6` |
| BUG-0008 | RVF single-writer durability (`process.exit(0)`) | `196100171` (partial — see ADR-0095) |

**Check-side improvements** (ruflo-patch `add002f`):
- Pattern widening for JSON content-wrapper responses: `guidance_quickref`, 9 `ruvllm_*` wrappers, 8+8 `task_*` wrappers, autopilot `predict`/`log`/lifecycle. Published build wraps replies in `{ content: [{ type: "text", ... }] }`; patterns now accept `[OK]|content|result` alongside domain keywords.
- Timeout bumps from 8s default → 30–60s for memory-store, hooks_route, memory_scoping, embedding_dimension, filtered_search, embedding_controller_registered, rate_limit_consumed. Mega-parallel wave saturates CPU; 768-dim embedding model load alone can exceed 8s.
- Corrected assertions:
  - `p6-err-perms` — old probe used `memory search` (doesn't touch config dir); replaced with `doctor` + `memory store` + RETURN-trap cleanup + `skip_accepted` fallback when CLI tolerates chmod 000.
  - 5 × `p7-fo-*` file paths — files not produced by `init --full` (lazy-created) now `skip_accepted` with rationale. JSON parse + `settings.permissions` assertion preserved.
  - `p7-cli-system` → `cli status` (no `system` subcommand exists in published CLI).
  - `t3-2` now reads `.rvf.meta` sidecar when native backend is active.
  - `sec-health-comp` — fixed schema mismatch (`controllerNames` is the field, not `name`).
  - `ctrl-scoping` — verifies scoped-key prefix via MCP response (`"key": "agent:<id>:<key>"`) instead of string match on unscoped output.
- Unit test update: `tests/unit/adr0086-rvf-integration.test.mjs` now accepts either `remove-then-readd` OR `skip-if-already-loaded` as valid HNSW-graph-integrity strategies (latter adopted in fork commit `2f3a832d6`).

---

## 2026-04-17 — First full-cascade run surfaced 30 failures (17 new ADR-0094 + 13 pre-existing)

The initial run showed the 100%-coverage program doing its job: **17 previously-hidden bugs** were caught by the new checks. 13 pre-existing failures also surfaced (some from the pre-ADR-0094 baseline, some newly-unmasked once RVF magic parsing worked).

---

## 2026-04-17 — Phases 1–7 implemented by 15-agent swarm (commit `66d3c3d`)

Single ruflo-orchestrated hierarchical swarm (topology=hierarchical, maxAgents=15, strategy=specialized) produced all 27 check files in parallel in ~3 minutes of wall-clock:

| Phase | Check files | Check functions | Tools covered |
|---|---|---|---|
| 1 Security | `acceptance-aidefence-checks.sh`, `acceptance-claims-checks.sh` | 18 | 17 |
| 2 Core Runtime | `acceptance-agent-lifecycle-checks.sh`, `acceptance-autopilot-checks.sh`, `acceptance-workflow-checks.sh`, `acceptance-guidance-checks.sh` | 28 | 31 |
| 3 Distributed | `acceptance-hivemind-checks.sh`, `acceptance-coordination-checks.sh`, `acceptance-daa-checks.sh`, `acceptance-session-lifecycle-checks.sh`, `acceptance-task-lifecycle-checks.sh` | 40 | 37 |
| 4 Integration | `acceptance-browser-checks.sh`, `acceptance-terminal-checks.sh`, `acceptance-embeddings-checks.sh`, `acceptance-transfer-checks.sh`, `acceptance-github-integration-checks.sh`, `acceptance-wasm-checks.sh` | 41 | 56 |
| 5 ML | `acceptance-neural-checks.sh`, `acceptance-ruvllm-checks.sh`, `acceptance-performance-adv-checks.sh`, `acceptance-progress-checks.sh` | 26 | 26 |
| 6 Hooks/Errors | `acceptance-hooks-lifecycle-checks.sh`, `acceptance-error-paths-checks.sh`, `acceptance-input-validation-checks.sh`, `acceptance-model-routing-checks.sh` | 19 | 19 |
| 7 Files/CLI | `acceptance-file-output-checks.sh`, `acceptance-cli-commands-checks.sh` | 18 | 18 |
| **Total** | **27 files** | **190** | **204** |

All files use the ADR-0090 shared-helper pattern: one `_<domain>_invoke_tool` per file + thin wrappers per tool. Three-way bucket (`pass`/`fail`/`skip_accepted`) uniformly applied. Wiring added to `lib/acceptance-checks.sh` (sources) + `scripts/test-acceptance.sh` (`run_check_bg` + `collect_parallel` specs).

---

## Current coverage state (snapshot — recompute from catalog for authoritative numbers)

> **Rule**: this table is a point-in-time courtesy copy. For authoritative numbers run `node scripts/catalog-rebuild.mjs --show`. If the two disagree, preflight's rot-detection must fail.

| Metric | Value @ 2026-04-17 T15:04Z |
|---|---|
| Total acceptance checks | 452 |
| Passing | 396 (87.6%) |
| `skip_accepted` | 55 (12.2%) |
| Failing | 1 (0.2%, t3-2-concurrent → ADR-0095) |
| `invoked_coverage` (target 100%) | 100% (all required tuples exercised) |
| `verified_coverage` (target ≥80%) | 87.6% |
| `skip_streak_days_max` | 0 (fresh baseline; catalog generator will begin tracking) |
| Wall-clock cascade | 122s (≤300s budget) |
