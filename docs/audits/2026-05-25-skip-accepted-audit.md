# 2026-05-25 — skip_accepted audit (acceptance run 091526Z)

Per `feedback-skip-accepted-as-squelch.md` classification.

**Source:** `test-results/accept-2026-05-25T091526Z/acceptance-results.json` (697 total, 688 passed, 0 failed, 9 skip_accepted).

**Dispatch path:** `lib/acceptance-harness.sh:312-324` — `_HEAVY_CHECK_IDS` allowlist. When `ACCEPTANCE_HEAVY != "1"`, the harness writes a `skip_accepted` verdict with marker `HEAVY_SKIP: <id> skipped — opt in with ACCEPTANCE_HEAVY=1 (saves ~3min wall time)` and returns before invoking the check function. Marker is recognized by `scripts/check-skip-accepted.mjs` (line 33).

**Standing justification doc:** `docs/heavy-skip-justifications.md` — every entry has a documented heavy duration and a re-promote trigger; last full heavy-mode verification 2026-05-18 / patch.181 returned 681/681 PASS.

| # | Check name | Reason quoted | Classification | Justification |
|---|---|---|---|---|
| 1 | `t1-2-learning` — Learning feedback (ADR-0079) | `HEAVY_SKIP: t1-2-learning skipped — opt in with ACCEPTANCE_HEAVY=1 (saves ~3min wall time)` | legit:heavy-test-opt-out | ~7s cold-start dominated bootstrap (AgentDB open + capability factory). Re-promote trigger documented in `heavy-skip-justifications.md:15`. |
| 2 | `t3-1-bulk-corpus` — Bulk corpus ranking (ADR-0079) | `HEAVY_SKIP: t3-1-bulk-corpus skipped — opt in with ACCEPTANCE_HEAVY=1 (saves ~3min wall time)` | legit:heavy-test-opt-out | ~14s; seeds 1000+ entries for ReasoningBank rank assertion. ReasoningBank flagged in CLAUDE.md as a heavy-tier touch. |
| 3 | `t3-4-reasoningbank` — ReasoningBank cycle (ADR-0079) | `HEAVY_SKIP: t3-4-reasoningbank skipped — opt in with ACCEPTANCE_HEAVY=1 (saves ~3min wall time)` | legit:heavy-test-opt-out | ~8s; full store→search→feedback cycle with embedding cold-start. |
| 4 | `adr0090-b5-memoryConsolidation` — B5 memoryConsolidation roundtrip | `HEAVY_SKIP: adr0090-b5-memoryConsolidation skipped — opt in with ACCEPTANCE_HEAVY=1 (saves ~3min wall time)` | legit:heavy-test-opt-out | ~11s; consolidation pipeline (gather→distill→write-back). CLAUDE.md flags memory consolidation as heavy-tier. |
| 5 | `p4-br-navigation` — Browser navigation (P4) | `HEAVY_SKIP: p4-br-navigation skipped — opt in with ACCEPTANCE_HEAVY=1 (saves ~3min wall time)` | legit:heavy-test-opt-out | ~69s Playwright; real Chromium cold-start (~5s) + sequential page-load assertions. Wall-clock cost, not flakiness. |
| 6 | `p4-br-interaction` — Browser interaction (P4) | `HEAVY_SKIP: p4-br-interaction skipped — opt in with ACCEPTANCE_HEAVY=1 (saves ~3min wall time)` | legit:heavy-test-opt-out | ~22s Playwright; click/type/keypress workflow. Shares `p4-br-*` harness with #5. |
| 7 | `p4-br-snapshot` — Browser snapshot (P4) | `HEAVY_SKIP: p4-br-snapshot skipped — opt in with ACCEPTANCE_HEAVY=1 (saves ~3min wall time)` | legit:heavy-test-opt-out | ~2s itself, but bundled with `p4-br-*` Playwright group — independent promotion still pays Chromium cold-start in surrounding parallel batch. |
| 8 | `p7-fo-neural` — File: neural dir (P7) | `HEAVY_SKIP: p7-fo-neural skipped — opt in with ACCEPTANCE_HEAVY=1 (saves ~3min wall time)` | legit:heavy-test-opt-out | ~5s; `find . -type f` over populous neural/ tree, IO-bound. CLAUDE.md flags neural-dir scanning as heavy-tier. |
| 9 | `p8-inv1-memory` — INV-1 memory store→search (P8) | `HEAVY_SKIP: p8-inv1-memory skipped — opt in with ACCEPTANCE_HEAVY=1 (saves ~3min wall time)` | legit:heavy-test-opt-out | ~6s; ADR-0094 §P8 invariant — store→search round-trip with embedding cold-start dominating. |

## Summary

- legit: 9
- squelch: 0

All 9 entries are routed through a single shared opt-out gate (`_HEAVY_CHECK_IDS` in `lib/acceptance-harness.sh:312-323`). They are not failing checks dressed as skips: heavy-mode (`ACCEPTANCE_HEAVY=1`) verification on 2026-05-18 / patch.181 returned **681/681 PASS** with all 9 entries green (`logs/adr0181-finish-heavy-release.log` per `docs/heavy-skip-justifications.md:5`). The skip is a wall-clock cost/coverage trade-off saving ~3 min/release, with per-entry re-promote triggers documented.

No squelches detected. No follow-up remediation required.
