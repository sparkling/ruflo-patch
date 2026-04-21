# ADR-0079: Acceptance Test Completeness

- **Status**: Implemented (2026-04-21)
- **Date**: 2026-04-11
- **Deciders**: Henrik Pettersen
- **Methodology**: Hive deliberation (Queen + 8 experts + Devil's Advocate)

## Context

A 10-agent hive deliberation audited the acceptance test suite after reaching 169/169
pass rate. The hive included an ADR historian, test auditor, E2E reviewer, memory/learning
domain expert, config/init expert, WASM/attention expert, pipeline/publish expert, an
upstream maintainer perspective (Reuven Cohen), and a devil's advocate.

### Current Test Inventory

| Level | Files | Tests | Coverage Focus |
|-------|-------|-------|---------------|
| Pipeline | 6 | 131 | Codemod, fork-version, publish order |
| Unit | 52 | ~1,366 | Controller wiring, config chains, activation contracts |
| Fork | 4 | (vitest) | Direct fork source testing |
| Acceptance | 24 scripts | 169 | End-to-end against published packages |
| **Total** | **86** | **~1,666+** | |

### Acceptance Test Breakdown (Test Auditor findings)

| Category | Count | Percentage |
|----------|-------|-----------|
| Structural (grep-based) | 82 | 48% |
| Behavioral (runs code) | 50 | 29% |
| True E2E (data round-trip) | 30 | 18% |
| Smoke (crash-only) | 8 | 5% |

### Hive Verdict

**Rating: B-** — solid foundation for structural/packaging validation, critical gaps in
semantic and behavioral coverage.

The suite catches regressions in wiring, config, and package structure effectively. It
does NOT validate that core features (semantic search, learning, swarm) work as users
experience them.

169/169 gives ~65% confidence in the shipped product. High confidence for packaging
and configuration. Low confidence for feature correctness.

## Decision

Add tests across all three levels (unit, acceptance, fork) to address the gaps identified
by the hive. Organized by priority tier.

---

## Tier 1: Critical (Must-Have) — 10 tests

These address gaps where core product value is untested.

### T1-1: Semantic search ranking

**Level**: Acceptance
**What**: Store 5 entries with distinct topics. Search with a query semantically close to
one topic. Assert the closest entry ranks first.
**Why**: The core value proposition of memory search is semantic relevance. Current tests
use hash-based mock embeddings and verify only that results exist, not that they're
relevant. A broken embedding model would pass all current tests.
**Acceptance criteria**: Search result[0] matches the semantically closest stored entry.

### T1-2: Learning feedback improves search ranking

**Level**: Acceptance
**What**: Store 3 entries. Search. Record positive feedback on a lower-ranked result.
Re-search. Assert the feedback-boosted entry ranks higher than before.
**Why**: The learning system's purpose is to improve results over time. No current test
verifies this. `check_adr0059_learning_feedback` stores feedback but never re-searches.
**Acceptance criteria**: Post-feedback rank of the boosted entry is strictly better.

### T1-3: Config → runtime propagation

**Level**: Acceptance
**What**: Run `init --full`. Modify `config.json` to set `similarityThreshold: 0.99`.
Run `memory search` with a loose query. Assert zero results (threshold too high).
Reset to `0.1`. Re-search. Assert results returned.
**Why**: Config writes are tested (Phase 5), but no test verifies the runtime reads
the config. A broken config reader would pass all current tests.
**Acceptance criteria**: Behavior changes when config value changes.

### T1-4: SQLite data verification

**Level**: Acceptance
**What**: After `memory store --key test-key --value "hello"`, run
`sqlite3 .swarm/memory.db "SELECT key, value FROM memory_entries WHERE key='test-key'"`.
Assert the row exists with correct content.
**Why**: Current tests grep CLI stdout for "stored". This proves the print statement ran,
not that data persisted. The devil's advocate identified 269 grep invocations and zero
SELECT assertions across the entire suite.
**Acceptance criteria**: SELECT returns the exact stored key and value.

### T1-5: MCP stdio JSON-RPC handshake

**Level**: Acceptance
**What**: Start the MCP server via `npx @sparkleideas/cli mcp serve` in background.
Send a JSON-RPC `initialize` request over stdin. Assert the response contains a valid
`tools/list` with expected tool names (memory_store, memory_search, etc.).
**Why**: No test exercises the actual MCP protocol. All current MCP tests use `mcp exec`
CLI shortcut which bypasses the stdio transport layer.
**Acceptance criteria**: Valid JSON-RPC response with tool list.

### T1-6: Negative test — empty search returns zero results

**Level**: Acceptance
**What**: Search in a namespace known to be empty. Assert the result count is 0 and
the response is `{ success: true, results: [] }`.
**Why**: Zero negative tests exist. A search implementation that returns phantom results
for every query would pass 169/169.
**Acceptance criteria**: Empty namespace returns results: [].

### T1-7: Negative test — invalid input returns structured error

**Level**: Acceptance
**What**: Call `memory store` with empty key. Call `memory search` with empty query.
Assert both return `{ success: false, error: '...' }` not a crash.
**Why**: Input validation is untested. Silent acceptance of invalid data causes downstream
corruption.
**Acceptance criteria**: Structured error response, non-zero exit code.

### T1-8: Codemod completeness scan

**Level**: Acceptance
**What**: Scan all `.js` files in `node_modules/@sparkleideas/*/` for any remaining
`@claude-flow/` or `@ruvector/` references (excluding comments and node_modules).
Assert zero matches.
**Why**: Current codemod test checks 1 file for 1 reference. A partial codemod failure
in any of 41 packages would go undetected.
**Acceptance criteria**: Zero `@claude-flow/` references in published packages.

### T1-9: Version pin consistency

**Level**: Acceptance
**What**: For each installed `@sparkleideas/*` package, read its `package.json` and
verify all `@sparkleideas/*` dependencies reference the same `-patch.N` version.
**Why**: Split-brain dependency trees cause runtime import failures. No current test
checks this.
**Acceptance criteria**: All internal deps use the same patch version.

### T1-10: Controller initialization smoke test

**Level**: Unit
**What**: Import `ControllerRegistry`, call `initialize()` with a test config, assert
it resolves without throwing. Verify at least 20 controllers are registered.
**Why**: 44 controllers exist. Zero tests verify any of them actually construct. The
unit tests mock the registry; the acceptance tests never call initialize.
**Acceptance criteria**: initialize() resolves, listControllers().length >= 20.

---

## Tier 2: Important (Should-Have) — 8 tests

### T2-1: Swarm init + agent spawn

**Level**: Acceptance
**What**: Run `swarm init --topology hierarchical`. Run `agent spawn -t coder`.
Assert agent appears in `agent list`. Terminate and verify cleanup.
**Why**: Swarm coordination has zero acceptance coverage. Only file-path structural
checks exist.
**Acceptance criteria**: Agent spawns and appears in agent list.

### T2-2: Session lifecycle

**Level**: Acceptance
**What**: `session start --id test`. Store data during session. `session end --id test`.
`session restore --id test`. Assert restored data matches.
**Why**: Session save/restore is untested at all levels.
**Acceptance criteria**: Restored session contains data from the original.

### T2-3: WASM attention computation

**Level**: Acceptance
**What**: Install `@sparkleideas/ruvector-attention-unified-wasm`. Import and instantiate
the WASM module. Call `flashAttention(query, keys, values)` with known 4-dim vectors.
Assert output matches expected softmax result.
**Why**: The WASM binary is never executed. All F3 tests verify file existence or export
counts.
**Acceptance criteria**: Computed attention output matches expected values.

### T2-4: Embedding dimension match

**Level**: Acceptance
**What**: Call `agentdb_embed` MCP tool with text "hello world". Assert the returned
embedding has exactly 768 dimensions (matching the configured model).
**Why**: Embedding dimension was changed from 384 to 768. No test verifies the actual
model produces the expected dimension.
**Acceptance criteria**: embedding.length === 768.

### T2-5: Memory store with real embedding verification

**Level**: Acceptance
**What**: Store an entry with `generateEmbedding: true`. Read back via sqlite3. Assert
`length(embedding) / 4 = 768`.
**Why**: The dimension-mismatch detector we added warns at startup, but no test verifies
embeddings are actually generated at the correct dimension.
**Acceptance criteria**: Stored embedding is 768-dim Float32 BLOB.

### T2-6: CLAUDE.md structure validation

**Level**: Acceptance
**What**: After `init --full`, parse the generated CLAUDE.md. Assert it contains:
required sections (Behavioral Rules, File Organization, Build & Test), correct tool
name ("Agent tool" not "Task tool"), `@sparkleideas` scope references.
**Why**: CLAUDE.md is checked for scope string only. Structure, tool names, and
required sections are unverified.
**Acceptance criteria**: All required sections present, no "Task tool" references.

### T2-7: Daemon restart memory persistence

**Level**: Acceptance (Phase 4)
**What**: Store data via daemon IPC. Stop daemon. Restart daemon. Retrieve data. Assert
it matches.
**Why**: Phase 4 tests daemon IPC but never restarts the daemon. Cross-restart persistence
is untested.
**Acceptance criteria**: Data survives daemon restart.

### T2-8: Hooks settings.json → handler dispatch

**Level**: Acceptance
**What**: Verify `settings.json` hook definitions. Trigger a `post-edit` event via the
hook system. Assert the correct handler is dispatched (not just that the handler binary
runs when called directly).
**Why**: Current hook tests call the handler binary directly, bypassing settings.json
dispatch.
**Acceptance criteria**: Hook dispatched via settings.json path, handler receives event.

---

## Tier 3: Nice-to-Have — 7 tests

### T3-1: Bulk corpus search ranking (10+ entries)

**Level**: Acceptance
**What**: Store 10-15 entries across 3 topics. Search for each topic. Assert the top-3
results are from the correct topic.
**Why**: No test stores more than 3 entries. Ranking quality at scale is unverified.

### T3-2: Concurrent write safety

**Level**: Unit
**What**: Run 10 parallel `memory store` calls. Assert all succeed without
SQLITE_BUSY errors.
**Why**: sqlite3 busy_timeout is configured but never tested under contention.

### T3-3: Plugin load and execute

**Level**: Acceptance
**What**: Install a plugin. Load it. Call a plugin-provided function. Assert it returns.
**Why**: `check_plugin_install` installs but never loads or runs plugins.

### T3-4: ReasoningBank full cycle

**Level**: Acceptance
**What**: Store pattern → search patterns → record feedback → re-search → assert
the pattern ranks higher after positive feedback.
**Why**: The ReasoningBank cycle is the core learning primitive. Never tested end-to-end.

### T3-5: NightlyLearner consolidation

**Level**: Acceptance
**What**: Store multiple feedback entries. Trigger consolidation. Assert consolidated
insights are generated.
**Why**: NightlyLearner/EWC++ path untested; only synchronous consolidate() exercised.

### T3-6: ESM import test

**Level**: Acceptance
**What**: `node -e "import('@sparkleideas/cli').then(m => console.log(typeof m))"`.
Assert "object" output.
**Why**: CLI tested only via binary. A broken ESM entry point would pass all tests.

### T3-7: Package publish completeness

**Level**: Pipeline
**What**: After publish, enumerate all 41 packages in Verdaccio. Assert each has
a valid tarball with non-zero size.
**Why**: 25+ packages have zero dedicated test coverage. At minimum verify they publish.

---

## Implementation Strategy

### Test-before-code rule

Each test should be written to FAIL first against the current codebase, then fixed
by improving the product code. If a test passes immediately, either the test is weak
or the feature already works.

### Phase plan

| Phase | Tests | Effort | Prerequisite |
|-------|-------|--------|-------------|
| 1 | T1-1 through T1-10 | 2-3 days | None — all can run against current packages |
| 2 | T2-1 through T2-8 | 2-3 days | T1 complete for baseline |
| 3 | T3-1 through T3-7 | 1-2 days | Swarm + learning features stable |

### File organization

| Test | File |
|------|------|
| T1-1 through T1-9 | `lib/acceptance-adr0079-tier1-checks.sh` |
| T1-10 | `tests/unit/controller-init-smoke.test.mjs` |
| T2-1 through T2-8 | `lib/acceptance-adr0079-tier2-checks.sh` |
| T3-1 through T3-7 | `lib/acceptance-adr0079-tier3-checks.sh` + `tests/unit/` |

---

## Hive Expert Findings (verbatim summaries)

### ADR Historian

Unit tests simulate algorithms with inline mocks — they do not import or exercise real
modules. The ADR-0078 body says "Phase 3 proposed" while the status header says
"Implemented" — contradiction. ADR-0057 has zero test coverage.

### Test Auditor

170 checks: 82 structural (48%), 50 behavioral (29%), 30 E2E (18%), 8 smoke (5%).
7 critical paths with zero behavioral coverage: swarm, session save/restore, HNSW
search quality, embedding generation E2E, plugin execution, config hot-reload,
concurrent write safety.

### E2E Completeness Reviewer

Three critical blind spots: (1) semantic search uses hash mocks, (2) learning loop
stores feedback but never verifies improvement, (3) swarm coordination is completely
untested. CLAUDE.md generation checked for scope string only.

### Reuven Cohen (Upstream Perspective)

70% of changes are upstream-worthy. Bridge duplication (agentdb-orchestration.ts) is
a maintenance liability — would reject Phase 3 and ask for bridge refactoring instead.
The 384→768 default change is breaking without a migration path. Config-chain and
threshold work would be accepted. The test suite would be valuable contributed back
as a harness.

### Memory/Learning Domain Expert

No semantic distance assertions — any keyword store passes search checks. No
post-feedback re-search to verify ranking improvement. No bulk corpus test (10+ entries).
NightlyLearner/EWC++ path untested. ReasoningBank full cycle untested.

### Config/Init Expert

Zero controller initialization tests (none of 44 exercised). No config-to-runtime
propagation test. CLAUDE.md checked for scope only, not structure. settings.json hook
dispatch path untested (handler binary called directly).

### WASM/Attention Expert

10 of 12 F3/attention checks are structural. Zero WASM computation executed. Attention
checks accept "Tool not found" as passing. Flash Attention never tested with matrices.
WASM-to-JS fallback chain untested.

### Pipeline/Publish Expert

4 of 41 packages directly installed in tests. 25+ have zero dedicated coverage. No ESM
import test. No MCP stdio JSON-RPC handshake. Codemod validation checks 1 file. No
version pin consistency check across 41 packages.

### Devil's Advocate

**Severity: MAJOR.** Four systemic issues:
1. ~15 checks use "pass-on-degraded" — accept "not available" as PASS
2. grep-on-CLI-output proves print ran, not data persisted (269 grep, 0 SELECT)
3. sqlite3 CREATE TABLE workaround papers over a production schema gap
4. Zero negative tests — false-positive search would pass 169/169

---

## Upstream PR Candidates

| Test | Upstream value |
|------|---------------|
| T1-5 (MCP stdio handshake) | Validates protocol compliance for all MCP consumers |
| T1-10 (Controller init smoke) | Catches constructor bugs upstream has hit (#1492, #1499) |
| T2-4 (Embedding dimension match) | Validates the dimension unification upstream started |
| T3-2 (Concurrent write safety) | Tests sqlite busy_timeout under real contention |

---

## Risks

- **T1-1 (semantic ranking)** requires real embedding model to be available in CI.
  May need a lightweight test model or pre-computed embeddings fixture.
- **T2-3 (WASM computation)** requires wasm-pack and Rust in CI. Fallback: test
  the JS-only attention path.
- **T1-3 (config propagation)** may expose upstream config-reader bugs that produce
  false test failures. These should be fixed, not worked around.

---

## Comparison: Current State and After ADR-0079

| Metric | Current | After ADR-0079 |
|--------|---------|---------------|
| Acceptance checks | 169 | ~194 |
| True E2E coverage | 18% | ~35% |
| Negative tests | 0 | 2+ |
| Semantic search verified | No | Yes |
| Learning loop verified | No | Yes |
| Packages with zero coverage | 25+ | <10 |
| Confidence from green suite | ~65% | ~85% |

## Status Update 2026-04-21

- **Old status**: Proposed (2026-04-11)
- **New status**: Implemented
- **Evidence**: All 25 tests shipped. Tier 1: `lib/acceptance-adr0079-tier1-checks.sh` (390 LOC, 9 check functions covering T1-1..T1-9) plus `tests/unit/controller-init-smoke-adr0079.test.mjs` (76 LOC, T1-10). Tier 2: `lib/acceptance-adr0079-tier2-checks.sh` (146 LOC, T2-1..T2-8). Tier 3: `lib/acceptance-adr0079-tier3-checks.sh` (574 LOC, T3-1..T3-7). All three libs sourced by `scripts/test-acceptance.sh`. `docs/adr/ADR-0094-log.md` 2026-04-21 closure entry confirms full-cascade acceptance run 556 pass / 0 fail / 1 skip_accepted across 3 consecutive runs.
- **Rationale**: The hive-identified gaps (semantic ranking, learning feedback, SQLite round-trip, MCP stdio, codemod completeness, pin consistency, controller init smoke, WASM attention, embedding dim, RVF concurrent safety, ESM import, bulk corpus) are all now behavioral checks in the acceptance suite, not structural greps.
- **Remaining work**: None. T3-2 (concurrent writes) evolved to RVF .rvf.lock contention per ADR-0090 Tier A4 and is the gold-standard behavioral check; 3/3 green under mega-parallel waves per 2026-04-21 log.

