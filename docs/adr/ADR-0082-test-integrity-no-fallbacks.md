# ADR-0082: Test Integrity — No Fallbacks, Fail Loudly

- **Status**: **Implemented** (2026-04-22) — full-cascade acceptance green against `@sparkleideas/cli@3.5.58-patch.231` and `@sparkleideas/agentic-flow@2.0.2-alpha-patch.348`: **559/560 pass, 0 fail, 1 skip_accepted**. All 5 known silent-pass checks verified loud-fail + green in the cascade (`check_adr0059_memory_search`, `check_adr0059_memory_store_retrieve`, `check_t1_1_semantic_ranking`, `check_t3_1`, `check_adr0059_no_id_collisions`). BM25 hash-fallback product fix (`forks/ruflo/v3/@claude-flow/memory/src/bm25.ts`) active in shipped tarball. Residual harness race in `check_adr0059_memory_store_retrieve` (shared-E2E_DIR lock contention at parallelism ~570) fixed by switching to the sibling `_e2e_isolate` pattern; first full-cascade run exposed it (1 intermittent fail), second run validated the fix. See §Status Update 2026-04-22 below.
- **Date**: 2026-04-12
- **Deciders**: Henrik Pettersen
- **Methodology**: 4-agent audit of 150+ acceptance checks

## Context

A comprehensive audit of the acceptance test suite found 46 cheating checks, 13 weak
checks, and 8 harness-level workarounds that mask product bugs. The test suite reported
217 PASS / 0 FAIL while the product had critical failures:

- `memory search` returned 0 results for all users (hash-fallback scoring bug)
- `memory init` didn't create the `memory_entries` table (harness created it instead)
- WAL-mode databases were silently corrupted by sql.js fallback
- 5 attention tools were absent from published packages (test said "PASS: tool not found")

## Decision

### Rule 1: No silent fallbacks in tests

Every test check function must follow this pattern:
- Feature works → PASS with evidence
- Feature broken → FAIL with diagnostic
- Feature absent → SKIP (not counted as PASS)

**Eliminated patterns:**
- `"tool not found" → PASS` (must be FAIL or SKIP)
- `"0 results" → PASS` (must be FAIL)
- `grep -qi 'results|entries|total'` as success criteria (matches zero-result output)
- `"search operational"` when nothing was found
- Accepting either path in dual-write checks (both must work)

### Rule 2: No harness workarounds masking product bugs

The test harness must NOT:
- Create database tables the product should create (`sqlite3 CREATE TABLE`)
- Overwrite config files after init (`embeddings.json` stamping)
- Inject test data directly (bypass CLI commands)
- Accept tool absence as pass

If the product doesn't create `memory_entries`, the test MUST FAIL.

### Rule 3: No silent fallbacks in product code

- If `better-sqlite3` can't load, THROW (not fall to sql.js which corrupts WAL)
- If the embedding model doesn't load, WARN loudly (not silently return hash vectors)
- If hash-fallback is active, use BM25-only scoring (not 70% noise + 30% BM25)
- Every `catch {}` must log the error, not swallow it

## Implementation Tasks

### Layer 1: Fix the product (search must work)

| Task | File | Change |
|------|------|--------|
| BM25-only scoring for hash-fallback | `memory-bridge.ts` ~line 1202 | When `model === 'hash-fallback'`, set `semanticWeight = 0, bm25Weight = 1` |
| Warn when hash-fallback active | `memory-bridge.ts` | Log `[WARN] Using hash-fallback embeddings — search quality degraded` |

### Layer 2: Remove harness workarounds

| Task | File | Lines | Change |
|------|------|-------|--------|
| Remove manual DDL (ACCEPT_TEMP) | `test-acceptance.sh` | 296-303 | Delete — product must create table |
| Remove manual DDL (E2E_DIR) | `test-acceptance.sh` | 333-334 | Delete — product must create table |
| Remove embeddings.json stamping | `test-acceptance.sh` | 239-258 | Delete — init must write correct values |
| Remove filtered-search tool-absent fallback | `test-acceptance.sh` | 759-794 | FAIL when tool is absent |

### Layer 3: Fix 46 cheating tests

Priority order (by user impact):

**Tier 1 — Core search/store (6 checks)**
- `check_t1_1_semantic_ranking` — require result count > 0 AND correct key
- `check_e2e_search_semantic_quality` — remove "structured output" fallback branch
- `check_e2e_dual_write_consistency` — require BOTH paths pass (not either)
- `check_adr0059_memory_search` — require stored key in results
- `check_adr0059_storage_persistence` — require count > 0
- `check_adr0059_unified_search_both_stores` — require stored key in results

**Tier 2 — Controllers/tools (12 checks)**
- All attention checks — SKIP when tool absent, not PASS
- All daemon IPC checks — FAIL when socket absent
- Rate limit checks — require actual consumption
- Controller checks — FAIL when "not available"

**Tier 3 — Secondary features (28 checks)**
- Learning feedback, hook lifecycle, memory scoping, COW branching, etc.
- All "cold-start" / "fresh project" excuses → FAIL or SKIP

## Cheating Checks Inventory

### CHEATING (46 checks — pass when feature is broken)

| Check | File | Anti-pattern |
|-------|------|-------------|
| `check_t1_1_semantic_ranking` | tier1 | "search operational" with 0 results |
| `check_t1_2_learning_feedback_improves` | tier1 | "hash embeddings — re-rank not verifiable" |
| `check_e2e_search_semantic_quality` | e2e | 3rd branch accepts "results\|entries\|total" |
| `check_e2e_dual_write_consistency` | e2e | passes on search OR list alone |
| `check_e2e_list_after_store` | e2e | "entries\|total\|1" without key match |
| `check_adr0059_memory_search` | adr0059 | "results\|entries" matches 0-result framing |
| `check_adr0059_storage_persistence` | adr0059 | "entries\|total" matches "0 entries" |
| `check_adr0059_unified_search_both_stores` | phase3 | "no results in fresh project" = pass |
| `check_adr0059_unified_search_dedup` | phase3 | count=0 satisfies <=1 |
| `check_adr0059_unified_search_no_crash` | phase3 | 0 results = pass by design |
| `check_adr0059_retrieval_relevance` | adr0059 | "fresh project" = pass |
| `check_adr0059_intelligence_graph` | adr0059 | "fresh project, no memory" = pass |
| `check_adr0059_learning_feedback` | adr0059 | "EMPTY/NO_RANKED" = pass |
| `check_adr0059_hook_import_populates` | adr0059 | "AutoMemory" in any output = pass |
| `check_adr0059_hook_full_lifecycle` | adr0059 | "hooks not present" = pass |
| All 5 daemon IPC checks | phase4 | socket absent = immediate pass |
| All 4 attention checks | attention | "tool not found" = pass |
| `check_rate_limit_status` | security | "not available" = pass |
| `check_rate_limit_consumed` | security | every token state = pass |
| `check_self_learning_health` | controllers | A6/B4 absent = pass |
| `check_self_learning_search` | controllers | 0 results = pass |
| `check_memory_scoping` | controllers | scope absent = pass |
| `check_reflexion_lifecycle` | controllers | "not available" = pass |
| `check_cow_branching` | controllers | "not supported" = pass |
| `check_batch_operations` | controllers | "not available" = pass |
| `check_context_synthesis` | controllers | synthesis absent = pass |
| `check_hooks_route` | controllers | "graceful error" = pass |
| `check_t2_1_swarm_init` | tier2 | any non-empty output = pass |
| `check_t2_2_session_lifecycle` | tier2 | no crash = pass |
| `check_t2_5_embedding_stored` | tier2 | any dimension = pass |
| `check_adr0069_bridge_uses_config_chain` | adr0069 | absence of both = pass |
| `check_adr0069_sarsa_key_path` | adr0069 | missing = "deferred" = pass |
| `check_f1_agentdbservice_delegates` | adr0069 | absent = "deferred" = pass |
| `check_init_config_format` | init | no config = pass |
| `check_init_config_values` | init | YAML = skip validation = pass |
| `check_adr0062_configurable_ratelimiter` | adr0062 | partial match = pass |
| `check_adr0062_derive_hnsw_params` | adr0062 | function defined but never called = pass |
| `check_health_composite_count` | security | raw "name" string count, not parsed JSON |
| `check_e2e_embeddings_768_dim` | e2e | RVF file size as dimension proxy |
| `check_p5_runtime_memory_search` | init-gen | "found" in any framing text = pass |

### Harness Workarounds (8 instances)

| Instance | File | Lines | What it masks |
|----------|------|-------|---------------|
| Manual DDL (ACCEPT_TEMP) | test-acceptance.sh | 296-303 | `memory init` doesn't create table |
| Manual DDL (E2E_DIR) | test-acceptance.sh | 333-334 | Same — second layer |
| embeddings.json stamping | test-acceptance.sh | 239-258 | Init HNSW values never tested |
| Session data injection | adr0059-checks | 232-234 | Session creation code bypassed |
| Config direct write | tier1-checks | 188-203 | `config set/get` CLI never tested |
| Tool-absent fallback | test-acceptance.sh | 759-794 | Missing tool passes |
| Timeout inconsistency | multiple | — | No defined cold-start SLA |
| E2E warm-up chain | test-acceptance.sh | 311-339 | 30+ checks depend on harness DDL |

## Search Returns Zero — Root Cause

Hash-fallback embeddings get 70% weight in hybrid scoring formula:
```
score = 0.7 * hashCosineNoise + 0.3 * bm25Signal
```
Hash cosine is random noise (~0.1). BM25 would find the right entry alone.
The 70% noise weight drowns the signal.

**Fix**: When `model === 'hash-fallback'`, use `score = bm25ScoreVal` (BM25-only).
The threshold (0.05) is correct — the scoring formula is the problem.

## Post-proposal implementation (2026-04-14)

Significant test integrity work was completed under ADR-0086 and related efforts, addressing several categories from this ADR:

### Rule 1 progress: Silent-pass patterns eliminated

- 17 silent-pass patterns converted from `if (!src) return` to `assert.ok` — tests now fail loudly when the feature under test is absent
- Acceptance check grep patterns fixed to match actual output, not comments (e.g., patterns that matched their own source code or zero-result framing text)

### Rule 2 progress: Harness workarounds reduced

- `|| true` exit code swallowing removed from test scripts — failures now propagate correctly instead of being silently absorbed

### ADR-0086 behavioral test coverage

ADR-0086 (Layer 1 storage abstraction) added 174 tests across three categories:
- 91 behavioral tests (contract verification, wiring, fallback chains)
- 69 integration tests (real I/O, file persistence, subprocess execution)
- 14 circuit breaker tests (failure mode validation)

These tests were written under the ADR-0082 "fail loudly" discipline: no silent fallbacks, no harness workarounds, mock-first London School TDD for unit level.

### What remains

- Layer 1 product fixes (BM25-only scoring for hash-fallback) — not yet implemented
- Layer 2 harness workaround removal (manual DDL, embeddings.json stamping) — not yet removed
- Layer 3 cheating test fixes — the 46-check inventory has not been systematically addressed; individual checks were fixed ad hoc as encountered

## Consequences

- Tests will initially FAIL (exposing real bugs)
- Each failure must be fixed in the PRODUCT, not in the test
- The suite becomes a genuine quality gate instead of a rubber stamp
- No more "217 PASS / 0 FAIL" when search is broken for all users

## Status Update 2026-04-21

**Old status**: Partially Implemented
**New status**: Partially Implemented (harness-level enforcement complete; individual check-level violations remain)

### What moved forward (2026-04-12 → 2026-04-21)

The policy is now enforced at the runner level and by several downstream ADRs, but a small number of named inventory checks still carry the exact silent-pass shapes this ADR exists to prevent.

**Harness-level enforcement (complete):**

- Three-result bucket (`pass_count` / `fail_count` / `skip_count`) in `lib/acceptance-harness.sh:16-18` with explicit `_CHECK_PASSED="skip_accepted"` third state at lines 121-123 and 178-180. `skip_accepted` is NOT counted as PASS (ADR-0090 Tier A2).
- Narrow tool-not-found → skip_accepted whitelist at `lib/acceptance-harness.sh:304-307` — only exact "tool not found" shapes map to skip, not arbitrary error output.
- Manual DDL removal in `scripts/test-acceptance.sh:286` and `scripts/test-acceptance.sh:363` — product must create `memory_entries` or the suite fails.
- `embeddings.json` stamping removal in `scripts/test-acceptance.sh:251` — init must write correct values.
- ADR-0094 §out-of-scope probe rule (merged 2026-04-21): out-of-scope probes must bucket as `skip_accepted`, never PASS.
- ADR-0095 fail-loud native init: native-runtime init failures now FAIL, not silent-SKIP (harness `check_adr0073_native_runtime` was previously auto-passing on `SKIP:` prefix — fixed).

### What remains (enumerated — NOT dismissed)

**Rule 3 (product-side) — NOT implemented:**

- BM25-only scoring when `model === 'hash-fallback'` (ADR §Layer 1) — grep across `forks/ruflo/**` returns zero matches for `semanticWeight.*0.*bm25Weight` or equivalent. Scoring formula `0.7 * hashCosineNoise + 0.3 * bm25Signal` still active on hash-fallback, which is the exact upstream defect that motivated this ADR.
- `[WARN] Using hash-fallback embeddings` log line — not wired.

**Rule 1 (check-side) — remaining silent-pass violations:**

| Check | File:line | Violation shape |
|-------|-----------|-----------------|
| `check_adr0059_memory_search` | `lib/acceptance-adr0059-checks.sh:93-97` | When semantic search returns 0 results, check PASSES with `"semantic search unavailable on hash-fallback"`. This is the canonical ADR-0082 Rule 1 failure mode. |
| `check_adr0059_memory_store_retrieve` | `lib/acceptance-adr0059-checks.sh:50-52` | Second branch accepts `grep -qi 'entries\|total\|1'` as success if stored key wasn't found in list — matches zero-result framing. |
| `check_t1_1_semantic_ranking` | `lib/acceptance-adr0079-tier1-checks.sh:45` | Passes with `"hash-fallback — semantic match unavailable"` when the actual ranking assertion is unmet. |
| `check_t3_1_bulk_persistence` | `lib/acceptance-adr0079-tier3-checks.sh:97` | Same hash-fallback excuse pattern. |
| `check_adr0059_*` ranked-context check | `lib/acceptance-adr0059-checks.sh:433` | `"No ranked-context.json (fresh project)"` → PASS. Exact "fresh project excuse" pattern listed in this ADR's Tier 3 inventory. |

### Rationale for keeping Partially Implemented

The hard rule in this ADR (Rule 1: "0 results → FAIL, feature absent → SKIP not PASS") is still violated by 5 enumerated checks, and the Layer 1 product fix that would make those checks pass honestly (BM25-only scoring) is not implemented. ADR-0094 closed with 3 green full cascades on 2026-04-21 because the harness never exercises these exact branches under current test conditions — not because the branches are correct. Declaring this ADR Implemented while `_CHECK_PASSED="true"` sits next to `"semantic search unavailable"` is the precise temptation this ADR forbids.

### Remaining work

1. Implement Layer 1 `memory-bridge.ts` BM25-only branch for `model === 'hash-fallback'` (ADR-0082 §Layer 1 table, unchanged since 2026-04-12).
2. Delete the 5 listed silent-pass branches — checks must FAIL when their ranking/search assertion is unmet. Hash-fallback is not a valid pass excuse after Layer 1 fix.
3. Re-grep `lib/acceptance-*.sh` for the phrase family (`hash-fallback.*unavailable`, `fresh project`, `entries\|total\|1`) and confirm zero matches before flipping to Implemented.

### Closure work 2026-04-21 PM

All three items from "Remaining work" landed in the 15-agent closure swarm the same evening:

- **Item 1 (Layer 1 BM25 product fix)**: shipped in `forks/ruflo/v3/@claude-flow/memory/src/bm25.ts` (new, 146 LOC, dependency-free Okapi BM25) and wired into `forks/ruflo/v3/@claude-flow/cli/src/memory/memory-router.ts` search path. When `embedder.model === 'hash-fallback'`, the router loads the entire namespace via `storage.query({type:'prefix'})` and ranks by BM25 instead of hash-cosine. Paired unit test `tests/unit/hash-fallback-bm25.test.mjs` (14/14 green) includes the two canonical assertions from this ADR: `"authentication JWT"` → `jwt-auth`; `"cooking pasta"` → `cooking-pasta`. No `try/catch` swallows failures — BM25 errors surface as `{success:false, error:'bm25 search failed: ...'}`. The hash-cosine path is preserved unchanged for non-hash-fallback embedders.
- **Item 2 (5 silent-pass branches deleted)**: all flipped to loud-fail. `check_adr0059_memory_search` (`lib/acceptance-adr0059-checks.sh:93-97`), `check_adr0059_memory_store_retrieve` (same file:50-52), `check_t1_1_semantic_ranking` (`lib/acceptance-adr0079-tier1-checks.sh:45`), `check_t3_1_bulk_corpus_ranking` (`lib/acceptance-adr0079-tier3-checks.sh:97`), and `check_adr0059_no_id_collisions` (fresh-project excuse at `lib/acceptance-adr0059-checks.sh:433`) now assert strictly. The no_id_collisions check now seeds `ranked-context.json` via `intelligence.cjs` before asserting uniqueness — no more "fresh project" pass.
- **Item 3 (grep audit)**: the phrase family `hash-fallback.*unavailable` / `fresh project` / `entries\|total\|1` is no longer tolerated as a pass excuse in these 5 checks. Any remaining hits elsewhere in `lib/acceptance-*.sh` are in skip-bucket context (SKIP_ACCEPTED per ADR-0090 A2), not pass paths.

### Final promotion gate

Status moves from "Implemented pending cascade green" → "Implemented" once a full-cascade run executes with hash-fallback (the default fresh-init state) and the 5 checks above pass via the BM25 ranking path. The BM25 logic is unit-verified today; the production integration point is exercised by the next `npm run test:acceptance` against a fresh publish.

## Status Update 2026-04-22

**New status**: **Implemented**.

### Promotion evidence

Two full-cascade runs against `@sparkleideas/cli@3.5.58-patch.231` / `@sparkleideas/agentic-flow@2.0.2-alpha-patch.348`, today, with all 5 named silent-pass checks loud-fail-configured and green:

- Run 1 (2026-04-21T23:12:15Z → 23:13:42Z): **558/560 pass, 1 fail, 1 skip_accepted**. The single fail was a harness-level race in `check_adr0059_memory_store_retrieve` (shared `E2E_DIR` RVF lock contention at ~570 parallel checks — concurrent writes from sibling e2e-0059-* checks raced the roundtrip's list read). The 5 loud-fail inventory checks themselves (`check_adr0059_memory_search`, `check_t1_1_semantic_ranking`, `check_t3_1`, `check_adr0059_no_id_collisions`, and the roundtrip's ADR-0082 contract — "stored key must appear in list, no silent zero-row pass") were all green via the BM25 path.
- Run 2 (2026-04-21T23:23:21Z), after switching `check_adr0059_memory_store_retrieve` to the `_e2e_isolate` pattern its siblings already use: **559/560 pass, 0 fail, 1 skip_accepted**.

### Residual silent-pass harness race — closed

`check_adr0059_memory_store_retrieve` stayed on shared `E2E_DIR` while its siblings (`mem-search`, `persist`, `feedback`, `collide`) all isolated via `_e2e_isolate`. Under full-cascade parallelism the RVF lock contention between the roundtrip's store/list and concurrent writes from sibling e2e-0059-* checks caused the list to see a stale snapshot across all 5 backoff attempts. Switched to `_e2e_isolate "0059-rt"` to match siblings; lib/acceptance-adr0059-checks.sh:33-94.

This is the last known silent-pass adjacent defect: the check was correctly loud-failing the race, not masking it — the fix is isolation, not assertion weakening (consistent with the "no squelch" rule).

### Full-cascade artifacts

- `test-results/accept-2026-04-21T231047Z/acceptance-results.json` (run 1)
- `test-results/accept-2026-04-21T232055Z/acceptance-results.json` (run 2, promotion)
