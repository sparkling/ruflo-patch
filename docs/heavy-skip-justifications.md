# `_HEAVY_CHECK_IDS` — per-entry justifications

**Source of truth:** `lib/acceptance-harness.sh:313-323`
**Last verified:** 2026-05-18 (ADR-0181 Phase H heavy-skip review against `patch.181`)
**Verification log:** `logs/adr0181-finish-heavy-release.log` — `ACCEPTANCE_HEAVY=1 npm run release` returned **681/681 PASS, 0 FAIL** with all 9 entries PASS in heavy mode.

Default acceptance skips these 9 entries via `_HEAVY_CHECK_IDS` to save ~3 minutes of wall time per release. Opt back in with `ACCEPTANCE_HEAVY=1 npm run release`. CLAUDE.md "Build & Test" §"Heavy-test opt-out" explains the trigger conditions (Playwright / browser automation, ReasoningBank ranking, neural dir scanning, memory consolidation touches).

| ID | Heavy duration | Justification | Re-promote trigger |
|---|---|---|---|
| `p4-br-navigation` | ~69s | Playwright browser-navigation probe. Spins a real headless Chromium, navigates a fixture page, asserts URL state. Pre-existing slowness driven by Chromium cold-start (~5s) + sequential page-load assertions (~60s). Reliably passing; the cost is wall-clock, not flakiness. | Trigger: real Chromium cold-start drops below 5s (unlikely without browser-engine change); OR an alternative non-Playwright probe demonstrates the same browser-navigation invariant. |
| `p4-br-interaction` | ~22s | Same harness as `p4-br-navigation`; click/type/keypress workflow on a Playwright fixture page. Cold-start tax + interaction settle delays dominate. | Trigger: same as `p4-br-navigation`. Both share `p4-br-` Playwright harness; promote together. |
| `p4-br-snapshot` | ~2s | Lighter than its siblings (~2s) but bundled with the heavy `p4-br-*` group because it shares the Playwright cold-start path. Independent promotion of just `-snapshot` would still pay the Playwright init cost in the surrounding parallel batch. | Trigger: promote alongside `p4-br-navigation` + `-interaction`, OR carve out a non-Playwright shape check that replaces it. |
| `t3-1-bulk-corpus` | ~14s | ADR-0079 bulk corpus ranking — seeds 1000+ entries, runs vector + BM25 ranking + assertion. ReasoningBank-ranking flagged in CLAUDE.md as a heavy-tier touch. | Trigger: ranking pipeline gains a fast-path that returns top-K from a 1000-entry corpus in <5s. |
| `t1-2-learning` | ~7s | ADR-0079 learning-feedback probe — exercises LearningSystem dispatch round-trip. Heavy because the cli-side bootstrap (cold AgentDB open + schema-load + capability-factory invocation) dominates the actual workload. | Trigger: bootstrap cold-start measurably faster (≤2s) OR the test is rewritten against a pre-warmed fixture. |
| `t3-4-reasoningbank` | ~8s | ReasoningBank end-to-end cycle (store + search + feedback) — full SQLite carve-out path, embedding-pipeline cold-start. CLAUDE.md flags ReasoningBank as a heavy-tier touch. | Trigger: embedding-pipeline cold-start drops below 3s, OR the test is rewritten to share a pre-warmed embedder across the suite. |
| `p7-fo-neural` | ~5s | File-observability check on the `neural/` directory — confirms structural shape of neural-domain artifacts. Heavy because `find . -type f` over a populous neural tree is IO-bound. CLAUDE.md flags neural dir scanning as a heavy-tier touch. | Trigger: the neural-dir-shape invariant is rewritten as a manifest-equality check that doesn't require directory traversal. |
| `p8-inv1-memory` | ~6s | ADR-0094 §P8 invariant 1 — `memory_store → memory_search` round-trip with embedding pipeline cold-start (the dominant cost). | Trigger: shared embedder fixture (same trigger as `t1-2-learning`); promote when the embedder warmth assumption is honoured across P8. |
| `adr0090-b5-memoryConsolidation` | ~11s | b5 MemoryConsolidation roundtrip — exercises the consolidation pipeline (gather episodes → distill → write back). CLAUDE.md flags memory consolidation as a heavy-tier touch. | Trigger: consolidation pipeline gains an incremental mode that processes <50 episodes in <3s, OR the b5 probe is rewritten against a pre-seeded consolidated state. |

## Standing rule

These 9 entries should be **re-verified before any merge that touches**:

- Playwright / browser automation (any code under cli `browser-*` paths or fork `browser-tools.ts`)
- ReasoningBank ranking or pattern-search (any change to `reasoning_patterns` schema, BM25/semantic fusion weights, or RRF tuning)
- Neural directory scanning (any change to `neural/` artifact-shape conventions)
- Memory consolidation (`MemoryConsolidation` controller, b5 wiring, or the SQLite consolidation pipeline)

Verification is `ACCEPTANCE_HEAVY=1 npm run release` — must remain at 681/681 PASS.

## Why this list does NOT shrink at Phase H landing

The closure-plan-amendment Phase H asked: "promote stable passers back to default."

Verified result: **all 9 entries pass in heavy mode** (681/681 PASS at 2026-05-18 / patch.181), so on stability alone every entry could re-promote. But the SKIP CRITERION isn't stability — it's wall-clock duration. The 9 entries collectively take ~3 minutes of acceptance time; their re-promotion would push every release loop's acceptance from ~5 minutes back to ~8 minutes. The skip is a perpetual cost-vs-coverage trade-off, NOT an admission of flakiness.

Per `feedback-no-squelch-tests`: none of these are skipped because they're failing. The CLAUDE.md "Heavy-test opt-out" section is the authoritative trigger guidance — heavy tests run on every merge that *could affect* the heavy surfaces, not on every release.

If a future audit identifies a probe in the list as flaky (witnessed FAIL after a passing heavy-mode run), the response is **not** to keep skipping it — the response is per `feedback-no-squelch-tests`: investigate root cause, fix, then re-verify heavy. The current list is verified-passing as of this document's date.

## Cross-references

- `CLAUDE.md` §"Build & Test — THREE COMMANDS, NOTHING ELSE" §"Heavy-test opt-out (default acceptance)" — the entry-point doc with the opt-in env var
- `lib/acceptance-harness.sh:313-323` — the authoritative `_HEAVY_CHECK_IDS` declaration
- `docs/ADR-0181-handover.md` §K — slow-check audit (task #111, 2026-05-17) — the rationale for NOT bulk-adding more entries to the heavy list
