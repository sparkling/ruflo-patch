# ADR-0082: Test Integrity — No Fallbacks, Fail Loudly

- **Status**: Proposed
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

## Consequences

- Tests will initially FAIL (exposing real bugs)
- Each failure must be fixed in the PRODUCT, not in the test
- The suite becomes a genuine quality gate instead of a rubber stamp
- No more "217 PASS / 0 FAIL" when search is broken for all users
