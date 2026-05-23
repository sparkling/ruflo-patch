# Session Handover — 2026-05-22

## TL;DR

Continued from the 2026-05-21 handover (open blocker: semantic `memory_search` returned
`total:0`). **Root cause found and fixed — and it was NOT what 2026-05-21 thought.** It is a
one-line **falsy-zero threshold coercion** in the `memory_search` MCP tool, not RVF snapshot
staleness. Fix shipped (`?? 0.3`, re-converged with upstream). The misdiagnosed "snapshot
staleness" fix (ADR-0167 Phase 3) was **reverted**. `memory_search` and the swarm-team
memory-backed dialectic now work live.

**One thing IN PROGRESS (resume point):** fixing the *same* falsy-zero bug in ~8 sibling
sites (other MCP search/threshold tools) — identified + triaged, **not yet fixed/committed**.
See "IN PROGRESS" below.

## Current published state (Verdaccio `http://localhost:4873`)

| Package | Version | Notes |
|---|---|---|
| `@sparkleideas/cli` | `3.7.0-alpha.10-patch.253` | `@latest`; has the `?? 0.3` memory_search threshold fix |
| `@sparkleideas/ruflo` (wrapper) | `3.1.0-alpha.14-patch.229` | `@latest`, pins cli patch.253 (lockstep OK) |
| `@sparkleideas/agentdb` | `3.0.0-alpha.14-patch.261` | unchanged this session |

Last release: **test-ci 4084 pass / 0 fail**, **acceptance 684/693 / 0 fail / 9 documented skip_accepted**.
`forks/ruvector` was **never touched** (the staleness fix that would have needed it was reverted).

## THE BUG (root cause) — `memory_search` threshold falsy-zero

`forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/memory-tools.ts` had:
```ts
const threshold = (input.threshold as number) || 0.3;   // BUG: || coerces threshold:0 -> 0.3
```
- `||` turns an explicit `threshold:0` ("no minimum") into `0.3`. Document embeddings score
  **0.2–0.5** cosine against realistic related queries (negative for unrelated), so the 0.3
  floor drops everything except near-exact (~1.0) matches → `total:0` for normal queries, and
  the swarm dialectic (searches at the unset 0.3 default) never recalls its own 0.2–0.4 memories.
- **Fix (shipped):** `?? 0.3` (nullish) — honors `threshold:0`, keeps 0.3 as the unset default.
  This **re-converges with upstream**, whose same line already uses `?? 0.3`; the fork carried an
  old rUv revision (`eddfda0040`, 2026-01-27) predating upstream's fix. `forks/ruflo a02e561ac`.

**Live evidence (2026-05-22):** same query/store — `threshold:-1` → hit at sim **+0.28**;
`threshold:0` → **0** (coerced to 0.3); exact content → **1.0** always. Engine/embeddings
(mpnet 768, provider `transformers.js`)/dispatch/namespace all correct. Verified post-fix:
`threshold:0` now returns the +0.28 hit; dialectic stores 3 positions → synthesizer retrieves
them via `memory_search` (scores 0.21–0.33, all below the old 0.3 floor).

### The misdiagnosis (and the lesson)

The 2026-05-21 session (and the first half of this one) blamed **RVF snapshot staleness** and
built ADR-0167 Phase 3 (`stat`-based reopen/refresh in `rvf-backend.ts`), shipping it as
patch.252. **It was the wrong layer.** `RvfBackend.search` was never broken (exact match=1.0,
related positive). The defect lived in the MCP **tool** layer (`memory-tools.ts`), above
`RvfBackend.search`. Phase 3 was **reverted** (`forks/ruflo bf71e2bd3`).

> **LESSON (now in memory):** For any `memory_search`/`memory_store` symptom, probe the **actual
> MCP tool path first** — store + search *via the MCP tool*, and read raw scores with
> `threshold:-1` — BEFORE hypothesizing in the engine/RVF/storage layer. Don't test
> `RvfBackend.search` in isolation (it works) and don't trust a trace agent's framing of which
> layer is at fault.

## IN PROGRESS — resume here: fix the SAME bug in sibling sites

The sweep (`grep` for `(threshold|minConfidence|minScore) ... || <number>`) found more occurrences
of the identical falsy-zero bug — user-supplied filter thresholds where `0` = "no floor" is
silently coerced. **All read-context-confirmed as filter/min thresholds. NOT yet fixed.**

**Fix set (change `|| <n>` → `?? <n>`):**
| File | Line | Code | Notes |
|---|---|---|---|
| `cli/src/memory/memory-router.ts` | 2064 | `threshold: op.minConfidence \|\| 0.3` | reasoningBank `searchPatterns` (the dialectic's own recall path) |
| `cli/src/memory/memory-router.ts` | 2066 | `minScore: op.minConfidence \|\| 0.3` | legacy search path |
| `cli/src/memory/memory-router.ts` | 2095 | `threshold: op.minConfidence \|\| 0.3` | router fallback search |
| `cli/src/mcp-tools/embeddings-tools.ts` | 484 | `(input.threshold as number) \|\| 0.5` | `embeddings_search` similarity threshold |
| `cli/src/mcp-tools/agent-tools.ts` | 619 | `(input.threshold as number) \|\| 0.5` | `agent_health` threshold (0 = include all) |
| `cli/src/mcp-tools/hooks-tools.ts` | 1885 | `(params.minConfidence as number) \|\| 0.7` | pattern import filter |
| `cli/src/mcp-tools/hooks-tools.ts` | 2724 | `(params.minConfidence as number) \|\| 0.3` | pattern search filter |
| `cli/src/mcp-tools/hooks-tools.ts` | 3826 | `(params.minConfidence as number) \|\| 0.5` | worker-trigger confidence filter |

**Disposition nuance (important):** `memory_search` (memory-tools.ts) was a **re-converge**
(upstream had fixed it). These siblings are **fork-AHEAD** fixes — **upstream still uses `||`**
(`embeddings-tools.ts:456`, `agent-tools.ts:623`, `hooks-tools.ts:1701/2673/3773`); upstream's
`memory-router.ts` doesn't have the minConfidence lines (fork code). Per "bug fixes live in the
fork" + "don't donate back," fix forward in the fork; expect future upstream-sync conflicts
(the guard test below will catch any `||` regression).

**Excluded as benign (do NOT change):**
- Stored-value display/scoring defaults: `confidence || 0.5` in `attention-coordinator.ts`,
  `auto-memory-bridge.ts`, `memory-graph.ts`, `neural.ts` (reading a missing stored value, not a
  user filter).
- Idempotent `|| 0`: `count || 0`, `offset || 0`, `total || 0`, `usageCount || 0`.
- `topK/limit/k || N`: `0` is degenerate (no results), defaulting is fine.

**Borderline (flagged — judgment call, not yet decided):**
- CLI quality-gate thresholds: `commands/hooks.ts:3070/3342/3575` (`threshold || 80`),
  `commands/analyze.ts:818` (`|| 10`), `commands/route.ts:636` (`|| 80`),
  `ruvector/coverage-router.ts:380/408/448` (`|| 80`). A `--threshold 0` to *disable* a gate
  gets coerced; same class but CLI surface + different impact.
- `embeddings-tools.ts:586/587` (`driftThreshold || 0.3`, `decayRate || 0.01`),
  `claims-tools.ts:932` (`targetUtilization || 0.7`), `hooks-tools.ts:2621` (`confidence || 0.8`).

**Remaining TODO for this thread:**
1. Apply the 8 `|| → ??` edits above (read-context already confirmed; `Edit` each — note
   `embeddings-tools.ts:484` and `agent-tools.ts:619` share identical line text, so edit per-file).
2. Extend the guard test `tests/unit/adr0167-memory-search-threshold.test.mjs` (currently only
   covers memory-tools) to assert `embeddings-tools.js` / `agent-tools.js` / `memory-router.js` /
   `hooks-tools.js` use `??` for these thresholds (dist-marker pattern; reads `/tmp/ruflo-build/...`).
3. `npm run build`, commit `forks/ruflo` (main → `sparkling`, no co-author trailer), add a ledger
   row (disposition: fork-ahead bug fix, NOT re-converge), `npm run release`.
4. Decide the borderline set with the user.

## Durable gotchas (also in memory)

- **`/mcp reconnect` re-attaches to the SAME running server** — it does NOT pick up a newly
  published version. To go live: clear `~/.npm/_npx/<hash>` (the wrapper's `npx` cache), pre-warm
  (`npx -y @sparkleideas/ruflo@latest --version`), `kill` the running server PID, THEN reconnect.
  (memory: `project-ruflo-wrapper-latest-regression`, `project-memory-search-rvf-snapshot-isolation`)
- **Engine vs tool layer:** `RvfStore::query` (Rust) is brute-force over an in-memory `self.vectors`
  loaded once at `boot()`; there is no HNSW graph in `rvf-runtime`; `needs_rebuild` = `dead_space_ratio>0.3`
  (compaction, not hydration). Prod native binding is rebranded `@sparkleideas/ruvector-rvf-node@0.1.7-patch.130`
  (HAS `iterAllWithVectors`/`listMetadataIds`/`getVector`); the stale dev `forks/agentdb/node_modules`
  copy is base `0.1.7` (lacks them) — never diagnose binding skew from dev node_modules.
- **bumpWrapperPin G1 fix:** `4c41205` (registry-aware wrapper bump) broke 2 `fork-version.test.mjs`
  G1 tests (they couldn't pin a registry query); fixed by adding a `skipNpmCheck` opt
  (`ruflo-patch 1ad481d`). The release test-ci was blocked on this until fixed.

## Commit index

- **forks/ruflo** (`sparkling/main`, pushed): `a02e561ac` (memory_search `||`→`??` fix),
  `bf71e2bd3` (revert ADR-0167 Phase 3), then pipeline version-bumps → HEAD `a9ef808d8` (= patch.253).
  Reverted/superseded: the Phase-3 commits `8a016beba`/`3f0b2b9e1`/`9858f31fd` (patch.252).
- **ruflo-patch** (`origin/main`, pushed through `efb5487`): `efb5487` (ADR-0167 retraction +
  Amendment 2026-05-22 + INTEGRATION-LEDGER row + removed `adr0167-p3-reader-refresh` test +
  added `adr0167-memory-search-threshold` guard), `1ad481d` (bumpWrapperPin skipNpmCheck),
  `a00e867` (the now-retracted Phase-3 ADR amendment + its removed test).

## Test / hygiene notes

- Guard test added: `tests/unit/adr0167-memory-search-threshold.test.mjs` (dist-marker:
  `memory-tools.js` must use `?? 0.3`, not `|| 0.3`). PASSED in the release. Needs extending to the
  sibling sites (TODO #2 above).
- Test pollution cleaned: `p3-live-probe-xyzzy`, `authdoc-live`, and the 3 `swarm-dialectic-test`
  positions were deleted from the live `.swarm` store.
- 3 idle `dialectic-*` workers were spawned into the persistent hive (`hive-1776935361015`) during
  the dialectic test — harmless, idle; left in place.
