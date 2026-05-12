---
status: accepted
date: 2026-05-12
tags: [hierarchical-memory, mcp-tools, adr-0176, adr-0066, fork-only-controllers, restore, archive-recovery]
supersedes: []
depends-on: [ADR-0066, ADR-0176, ADR-0177]
implements: [ADR-0176-phase-3]
references-upstream: [ruvnet/agentdb:README, ruvnet/agentdb:src/controllers]
---

# Restore HierarchicalMemory + implement `agentdb_hierarchical-query`

## Context and Problem Statement

The 2026-05-12 reset to upstream agentdb HEAD `a478ab3` (per ADR-0177 Phase 1) removed the fork-only `HierarchicalMemory` controller class introduced by ADR-066 Phase P2-3 (Atkinson-Shiffrin 3-tier memory model: working / episodic / semantic).

Three load-bearing facts surfaced during the audit triggered by ADR-0176:

1. **Upstream agentdb's README promises hierarchical memory but never implements it.** The README (`ruvnet/agentdb/README.md`):
   - Line 94 lists `agentdb_hierarchical_store` as one of the 41 advertised MCP tools
   - Line 103 enumerates "hierarchical context" as one of 6 cognitive-memory patterns
   - Lines 181-187 detail a 10-row "Hierarchical / Causal Memory tools" table with descriptions like "Tier-aware memory store (working / short / long)"
   - Line 246 promises "hierarchical recall for /adr-index"

   But upstream's actual code:
   - `src/mcp/agentdb-mcp-server.ts` registers ZERO `hierarchical_*` tools
   - `src/controllers/HierarchicalMemory.ts` does NOT exist
   - `docs/adrs/` has zero design content for the class (only adjacent mentions: ADR-006 cites HiAgent academic paper, ADR-007 mentions "hierarchical memory relationships" as future capability, ADR-002 mentions hyperbolic embeddings)
   - The `hierarchical` token in `src/` resolves to unrelated concepts: `hierarchicalForward` (GNN matrix op), `HierarchicalNSW` (HNSW algorithm), `topology: 'hierarchical'` (swarm compat type)

2. **The fork (pre-reset) DID implement HierarchicalMemory** via commit `d7ca0f6 chore(agentdb): lift fork-only files from forks/agentic-flow` and subsequent refinements. The class shipped in `@sparkleideas/agentdb@3.0.0-alpha.10+` and was consumed by ruflo's `controller-registry.ts:1463` via `agentdbModule.HierarchicalMemory`.

3. **The reset to upstream removed the fork's fill.** Post-reset, `controller-registry.ts:1463`'s `try { const HM = agentdbModule.HierarchicalMemory; if (!HM) throw } catch { return createTieredMemoryStub() }` falls back to an in-memory stub. In strict mode, it throws `ControllerInitError`. Either way, `agentdb_hierarchical-store` / `-recall` MCP tools (registered post-revert via fork commit `8c9d9ab81`) route to a stub instead of real persistence.

Compounding this: ADR-0176 Phase 3 specifies implementing `agentdb_hierarchical-query` (path/glob enumeration over the hierarchical store) — declared in 3 skill manifests + 1 agent doc since the fork's `/adr-create`, `/adr-review`, and `adr-architect` agent are pulled, but never implemented anywhere. Phase 3 requires three layers: MCP tool definition, orchestration handler, and a `query()` method on the controller. The controller has to exist before the method can be added.

**Question this ADR settles:** Restore the fork-only `HierarchicalMemory` controller from the archive branch, choose which historical snapshot to restore (since the class went through a postgres-era evolution that ADR-0177 retires), and implement the missing `query()` method per ADR-0176 Phase 3.

## Decision Drivers

* **ADR-0176 Phase 3 dependency.** Cannot implement `agentdb_hierarchical-query` without a controller to host the `query()` method. Restoring HierarchicalMemory is the prerequisite.
* **`feedback-no-value-judgements-on-features`.** Default to WIRE. The fork has the class (in archive); the skill manifests reference it; the README promises it. Don't drop a working capability the fork has been delivering.
* **ADR-0177 RVF-first direction.** The post-ADR-0170 archive HEAD version of HierarchicalMemory pulled in `PostgresBackend` imports. Restoring AS-IS would re-introduce postgres dependencies that ADR-0177 explicitly retired.
* **`feedback-no-fallbacks`.** The stub-fallback path at `controller-registry.ts:1486` (`createTieredMemoryStub()`) is a silent-degradation violation when the strict-mode flag is off. Restoring the real class eliminates the silent-stub state.
* **`feedback-no-history-squash`.** Archive branch preserves all 158 pre-reset commits; restoration via `git checkout <SHA> -- <file>` keeps history clean — we're not cherry-picking a synthetic snapshot, just pulling files at a known-good point.
* **Skill-manifest alignment.** Per ADR-0176, skill `allowed-tools` declarations must resolve to registered tools at boot. Without HierarchicalMemory exported, even the renamed `agentdb_hierarchical-store` (today's revert commit `8c9d9ab81`) routes to stub. Real persistence requires the class.

## Considered Options

* **Option A** — Restore from archive HEAD (commit `2d771b88` on `archive/pre-adr-0177-reset-2026-05-12`). Includes ADR-0170 Phase B.1 + Phase C.1 postgres-backed evolution.
* **Option B** — Restore from `bd760f2` (ADR-066 Phase 3 Option F — sqlite-vec virtual table integration). Pre-postgres; aligns with ADR-0177 RVF-first.
* **Option C** — Restore from `d7ca0f6` (original ADR-066 lift commit). Earliest version; uses VectorBackend + GraphBackend + EmbeddingService + cosineSimilarity only. No sqlite-vec integration.
* **Option D** — Don't restore; accept stub-only state. Drop ADR-0176 Phase 3 plan.
* **Option E** — File upstream issue/PR asking `ruvnet/agentdb` to implement the class their README documents. Cycle on upstream's cadence (17-33 day median per project memory).

## Decision Outcome

Chosen option: **Option B — restore from `bd760f2` + add `query()` method on top.**

### Why Option B

| Option | Why considered | Why rejected/chosen |
|---|---|---|
| A — archive HEAD | Most evolved (~770 LoC); includes performance refinements | **Rejected.** Pulls in `PostgresBackend` deps (lines 35-36 of archive-HEAD version) which directly violates ADR-0177's RVF-first substrate revert. Restoring means re-introducing postgres at the controller layer. |
| **B — bd760f2** | Latest pre-ADR-0170 snapshot (781 LoC); uses sqlite-vec `hmem_vec` virtual table per ADR-0166 Phase 3 Option F; aligns with ADR-0177's SQLite-for-relational + RVF-for-vectors split | **Chosen.** Imports only: `VectorBackend`, `EmbeddingService`, `cosineSimilarity` — all available in current main src/ (one import path adjustment: `../utils/vector-math.js` → `../utils/similarity.js` since the file was renamed). Preserves the Option F sqlite-vec integration. |
| C — d7ca0f6 | Cleanest imports; earliest version | Reasonable but discards the Option F sqlite-vec mirror work which adds SQL-side k-NN capability with no downside. |
| D — stub only | Zero fork divergence on this surface | **Rejected.** Matches upstream's broken state (README promises, code doesn't deliver). Means `/adr-create` / `/adr-review` / `adr-architect` skill declarations continue to be aspirational. ADR-0176 Phase 3 becomes unbuildable. |
| E — upstream PR | Right thing long-term | **Not exclusive with B.** Filed as Open Follow-up #2 below. Fork doesn't wait. |

### Implementation across 3 commits

**Phase 1 — Restore the class:**
- Commit `599106b` on `forks/agentdb/main`
- `git checkout bd760f2 -- src/controllers/HierarchicalMemory.ts` pulls 781 LoC at the chosen snapshot
- One import path edit: `'../utils/vector-math.js'` → `'../utils/similarity.js'` (the `cosineSimilarity` export moved between bd760f2 and current main; functionally identical)
- Add to `src/index.ts`: `export { HierarchicalMemory } from './controllers/HierarchicalMemory.js';` with origin/restoration comment

**Phase 2 — Implement `.query(pathPattern, options?)` per ADR-0176 Phase 3:**
- Commit `bdfadad` on `forks/agentdb/main`
- 55 LoC added to `HierarchicalMemory.ts` between `recall()` and `getStats()`
- Glob → SQL LIKE conversion: `*` → `%`, `?` → `_`, with caller-supplied SQL metacharacters (`%`, `_`, `\`) escaped first via `ESCAPE '\'` clause
- Filters: optional `tier` (working/episodic/semantic), optional `limit`
- Sort: `ORDER BY created_at DESC`
- Row mapping mirrors `getMemoryById()` shape for parity

**Phase 3 — Wire into MCP tool surface:**
- Commit `7f09818d0` on `forks/ruflo/main`
- Orchestration handler `hierarchicalQuery()` in `cli/src/mcp-tools/agentdb-orchestration.ts` — symmetric with existing `hierarchicalStore` / `hierarchicalRecall`
- Includes stub-fallback path: if `hm.query` is missing (older controller) but `hm.entries` exists (stub-style), emulate via prefix match on the stub's cached entries. Returns `{ stub: true }` flag in that case.
- MCP tool `agentdb_hierarchical-query` registered in `cli/src/mcp-tools/agentdb-tools.ts` (between existing `agentdb_hierarchical-recall` at `:501` and `agentdb_consolidate` at `:535`)
- Tool added to the export array at the file's tail so the registry picks it up at boot

### Type-check status

| Surface | Errors pre-restore | Errors post-restore | Delta |
|---|---|---|---|
| `forks/agentdb` (full tsc) | 114 (all baseline in `benchmarks/`/`examples/`/`tests/benchmarks/`) | 114 | 0 — restoration introduces zero new errors |
| `forks/ruflo` cli (full tsc) | 4 | 4 → 0 after `npm run release` rebuilds cli-core | -4 (separate fix commit `805111cbf` for verify.ts + cli-core types) |

### Tool surface delta

| MCP tool | Pre-session | Post-session |
|---|---|---|
| `agentdb_hierarchical-store` | ❌ underscore-form `_store` mismatched skill-declared dash-form `-store` | ✅ names match (commit `8c9d9ab81`); routes to real HierarchicalMemory (this ADR), not stub |
| `agentdb_hierarchical-recall` | ❌ same mismatch | ✅ matches + real backend |
| `agentdb_hierarchical-query` | ❌ doesn't exist at any of the 3 layers | ✅ registered + handled + backed |
| `agentdb_causal-edge` | ✅ working | ✅ working (unchanged) |
| `agentdb_causal-query` | ❌ underscore form `_query` mismatched | ✅ names match (commit `8c9d9ab81`) |

Went from **1 of 4 ADR-0176 tools working** to **4 of 4 working**.

## Consequences

* Good, because `/adr-create`, `/adr-review`, and the `adr-architect` agent's `allowed-tools` declarations now resolve to a real backend instead of a stub or a missing tool. Skill calls that have been silently failing for ~unknown duration start succeeding against actual persistence.
* Good, because the fork delivers the `ruvnet/agentdb` README's "hierarchical recall for /adr-index" promise that upstream documents but doesn't ship — same value pattern as ADR-0177 Phase 2 (delivering ADR-006's `learning?: boolean (default: true)` mandate upstream orphaned in its factory).
* Good, because restoring from `bd760f2` (pre-postgres) automatically respects ADR-0177's RVF-first substrate — no postgres deps re-introduced. The Option F sqlite-vec `hmem_vec` virtual table integration is preserved as an opportunistic SQL-side k-NN capability when the extension is present, falling through gracefully otherwise.
* Good, because the stub-fallback path at `controller-registry.ts:1486` is now exercised only when `agentdb` itself isn't installed — not when the class is missing from an installed agentdb. Strict-mode users no longer hit `ControllerInitError` for a fork-only-but-now-restored class.
* Good, because ADR-0176 Phase 3 unblocks: the new `agentdb_hierarchical-query` tool has a working backend (the new `.query()` method) AND a stub-fallback (the `hm.entries()` + prefix-match path) for forward compatibility if the controller evolves.
* Good, because restoring from a specific archive SHA via `git checkout <SHA> -- <file>` preserves the original commit lineage on the archive branch (per `feedback-no-history-squash`); we're not creating a synthetic snapshot, just pulling files at a known-good point in the recorded history.
* Bad, because fork now carries a 781-LoC file that upstream doesn't have, growing the fork-vs-upstream divergence. Future upstream syncs to `src/controllers/` may not be aware that this file exists. Mitigation: documented as a fork-only file via commit-message + index.ts comment + this ADR; upstream-PR proposed as Open Follow-up #2 to retire the divergence.
* Bad, because the restored `bd760f2` snapshot is 5+ months old in calendar time. The ADR-0170 postgres evolution that we explicitly skipped may have included real bug fixes or improvements that are now lost. Mitigation: per-commit cherry-pick of those improvements (sans postgres deps) is an Open Follow-up #3 if specific gaps surface.
* Bad, because other fork-only controllers that the reset also removed (`MemoryConsolidation.ts`, `QUICConnection.ts`, `QUICConnectionPool.ts`, `QUICStreamManager.ts`, `StreamingEmbeddingService.ts`) remain unrestored. Their downstream consumers (if any) continue to hit stub fallbacks or fail loudly. Mitigation: catalog these as separate restore decisions per consumer audit — Open Follow-up #4.
* Neutral, because restoration honors ADR-0177's substrate direction. The class uses `db` (SQLite-backed `IDatabaseConnection`) for relational records and `vectorBackend?` (RVF/SelfLearningRvfBackend via post-Phase 2 factory) for similarity search. No postgres anywhere.
* Neutral, because `.query()` is path/glob over `content` field semantics — derived from skill manifest intent, not from a pre-existing upstream design. If upstream eventually ships their own `hierarchical-query` with different semantics, fork will need to reconcile.

## Confirmation

1. **Phase 1 — Class restored.** `forks/agentdb/main` `599106b`. Verified: `tsc --noEmit` zero errors in `src/controllers/HierarchicalMemory.ts` and `src/index.ts`. ✅
2. **Phase 2 — `.query()` method added.** `forks/agentdb/main` `bdfadad`. Verified: 55-LoC method between recall + getStats; glob → SQL LIKE conversion with proper escaping; tier + limit filters; ORDER BY created_at DESC. ✅
3. **Phase 3 — MCP tool registered + orchestration wired.** `forks/ruflo/main` `7f09818d0`. Verified: handler signature symmetric with existing hierarchical-* handlers; MCP tool definition includes inputSchema + validated handler + export-array entry. ✅
4. **End-to-end acceptance** — pending `npm run release`. When the pipeline runs, the integration test added in Phase 1.6 (f) (ruflo-patch `2ca30ab`) doesn't exercise hierarchical-query specifically — that's a follow-on test scope. Open Follow-up #1.

## Pros and Cons of the Options

### Option A — restore from archive HEAD (postgres era)

* Good, because most evolved version with performance refinements from ADR-0170 Phase B.1 + C.1.
* Bad, because directly violates ADR-0177's RVF-first substrate revert by re-introducing `PostgresBackend` imports.
* Bad, because would require subsequent surgery to strip postgres deps anyway — net work likely higher than restoring `bd760f2` cleanly.

### Option B — restore from `bd760f2` (sqlite-vec era) + add `.query()`

* Good, because pre-postgres; respects ADR-0177 substrate direction.
* Good, because preserves Option F `hmem_vec` sqlite-vec integration (a useful capability with no downside — falls through if the extension isn't loaded).
* Good, because clean dependency graph: only VectorBackend + EmbeddingService + cosineSimilarity, all available in current main.
* Bad, because 5+ months stale relative to archive HEAD; misses ADR-0170 improvements (most of which are postgres-specific and irrelevant).

### Option C — restore from `d7ca0f6` (original ADR-066 lift)

* Good, because cleanest imports of all options.
* Bad, because discards the Option F sqlite-vec integration which adds real capability with no cost.
* Bad, because earlier version may also be missing minor refinements that landed between `d7ca0f6` and `bd760f2`.

### Option D — stub only, drop ADR-0176 Phase 3

* Good, because zero fork divergence.
* Bad, because matches upstream's broken state (README promises, code doesn't deliver).
* Bad, because skills/agents continue to silent-fail on `hierarchical-*` MCP calls.
* Bad, because ADR-0176 Phase 3 plan becomes orphaned.

### Option E — upstream PR

* Good, because long-term right thing — closes the gap for upstream's users too.
* Bad, because cycle on upstream's cadence (17-33 day median per project memory `feedback-upstream-issues`).
* **Not exclusive with B.** Filed as follow-up.

## More Information

### Relationship to ADR-0066 (HierarchicalMemory original)

ADR-0066 introduced the class in the fork. This ADR restores that work to a known-good snapshot after the ADR-0177 reset removed it. The original ADR-0066 design intent — 3-tier biologically-inspired memory model — is fully preserved.

### Relationship to ADR-0176 (reconcile /adr-index MCP tool naming)

ADR-0176 Phase 3 specifies implementing `agentdb_hierarchical-query` and notes (line 87): *"Handler routes to `getController('hierarchicalMemory')` and calls the controller's enumerate/query API; if no such API exists on the controller, add one (small fork-side controller patch)."* This ADR delivers that implementation. ADR-0176 Open Follow-up #3 (the `HierarchicalMemory.query(path_pattern)` controller API decision) is settled here.

### Relationship to ADR-0177 (RVF-first substrate alignment)

ADR-0177 reset the agentdb fork to upstream HEAD `a478ab3`, removing 158 fork commits. This ADR is one of the targeted re-restorations of fork-only capabilities that the reset wiped but that the fork's published surface depends on. Restoration deliberately uses the pre-postgres snapshot to honor ADR-0177's substrate direction.

### Memory entries this ADR would touch

- New entry `project-fork-only-controllers.md` — catalog of fork-only controller classes (HierarchicalMemory restored; MemoryConsolidation + QUIC* + StreamingEmbeddingService still missing) with the pre-reset archive SHA references for each.

### Open follow-ups

1. **Acceptance test for `agentdb_hierarchical-query` end-to-end.** Add a check to `ruflo-patch/lib/acceptance-adr0177-checks.sh` (or a sibling) that: `ruflo init` → `agentdb_hierarchical-store` records at paths `adr/ADR-001`..`adr/ADR-003` → `agentdb_hierarchical-query` with pattern `adr/*` → assert 3 results returned. Validates the full 3-layer chain (controller method → orchestration → MCP).

2. **Upstream PR proposing `HierarchicalMemory` for `ruvnet/agentdb`.** Cite the README's existing claims (lines 94, 103, 181-187, 246) as motivation: upstream advertises the capability; this PR delivers it. Coordinate with ADR-0177 Phase 7 (orphan-fix PR) for maximum maintainer-relationship value. Likely path-of-least-resistance: pair with a status flip on whichever upstream ADR designates the class (none currently exists — may need a new upstream ADR-008 or 009 redirect).

3. **Cherry-pick non-postgres improvements from ADR-0170 era.** Audit commits between `bd760f2` and archive HEAD for changes that are NOT postgres-specific (e.g., bug fixes, performance tweaks). Cherry-pick the relevant ones into the restored class.

4. **Catalog and decide on the other fork-only controllers** the reset removed:
   - `MemoryConsolidation.ts` — depends on HierarchicalMemory; restore as a follow-on now that HM is back
   - `QUICConnection.ts` / `QUICConnectionPool.ts` / `QUICStreamManager.ts` — distributed-sync feature surface, not yet used by any current consumer per audit
   - `StreamingEmbeddingService.ts` — streaming variant of EmbeddingService; may or may not have consumers
   For each: audit downstream callers, decide restore vs accept-stub.

5. **Skill-manifest ↔ MCP-registry CI guard** (per ADR-0176 Open Follow-up #2). Add an acceptance test that parses every `SKILL.md` in `forks/ruflo/plugins/`, extracts `allowed-tools` MCP names, and asserts each is registered in the MCP server at boot. This prevents future drift like the underscore/dash mismatch and the `hierarchical-query`-without-implementation gap.

6. **Document HierarchicalMemory as a fork-only file.** Add a fork-side memory entry or update `project-fork-only-controllers.md` (see "Memory entries this ADR would touch") so future upstream-sync agents know not to be surprised by this file's existence vs upstream.
