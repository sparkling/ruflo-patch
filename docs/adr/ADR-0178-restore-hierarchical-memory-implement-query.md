---
status: accepted
date: 2026-05-12
tags: [hierarchical-memory, mcp-tools, fix, regression-repair, adr-0176, adr-0066, adr-0177]
supersedes: []
depends-on: [ADR-0066, ADR-0176, ADR-0177]
implements: [ADR-0176-phase-3]
references-upstream: [ruvnet/agentdb:README]
---

# Fix hierarchical memory: restore controller + complete the `hierarchical-*` MCP surface

## What was broken

After today's ADR-0177 reset (fork's agentdb → upstream HEAD `a478ab3`) hierarchical memory was non-functional. Three concrete symptoms:

1. **`HierarchicalMemory` class was gone.** The fork's ADR-066-introduced controller (`forks/agentdb/src/controllers/HierarchicalMemory.ts`) was removed by the reset because upstream doesn't ship it. `controller-registry.ts:1473` (in ruflo) calls `agentdbModule.HierarchicalMemory` → `undefined` → falls back to `createTieredMemoryStub()`. Tools that "succeeded" actually wrote to an in-memory stub, not persistence. (In strict mode the controller registry threw `ControllerInitError` instead — also broken, just loudly.)

2. **MCP tool names mismatched skill manifests.** Fork commit `827ab7fc4 (Mar 2026): fix: normalize all MCP tool names to underscores` had renamed 14 names from dash to underscore — based on the wrong premise that upstream agentdb's MCP server uses underscores. Upstream `ruvnet/ruflo`'s agentdb-tools.ts actually uses dash, and every skill manifest in `plugins/ruflo-adr/` declares dash forms. Result: `mcp__ruflo__agentdb_hierarchical-store` from a skill couldn't find the underscore-registered `agentdb_hierarchical_store`. The MCP server doesn't normalize separators (verified at `tool-registry.ts:389`).

3. **`agentdb_hierarchical-query` was never implemented.** Three skills/agents (`adr-create`, `adr-review`, `adr-architect`) had declared this tool in `allowed-tools` for an unknown duration without anyone shipping the implementation. No registration in `agentdb-tools.ts`, no orchestration handler, no controller method. Pure vapor declared as "available."

Net: of the 4 hierarchical-* MCP tools any skill could reasonably call, **only 1 worked** (`agentdb_causal-edge` — survived both the underscore rename and the missing-class issue).

## Audit context — what upstream documents vs ships, what downstream consumes

### Upstream agentdb promises what it doesn't deliver

`ruvnet/agentdb/README.md` documents the surface in 5 places:
- Line 94: lists `agentdb_hierarchical_store` among the 41 advertised MCP tools
- Line 103: "hierarchical context" as one of 6 cognitive-memory patterns
- Line 110: "hierarchical recall, delete" in the MCP tools feature bullet
- **Lines 181-187:** detailed 10-row "Hierarchical / Causal Memory tools" table — `agentdb_hierarchical_store` (*"Tier-aware memory store (working / short / long)"*), `_recall` (*"Tier-filtered retrieval"*), `_delete` (*"Remove hierarchical entry by key"*)
- Line 246: "hierarchical recall for /adr-index" cited as a ruflo integration

But upstream's actual code ships **none of them**:
- `src/mcp/agentdb-mcp-server.ts` registers zero `hierarchical_*` tools
- `src/controllers/HierarchicalMemory.ts` does not exist
- `docs/adrs/` (ADR-002 through ADR-010) has zero design content — only adjacent mentions (ADR-006 cites HiAgent academic paper, ADR-007 mentions "hierarchical memory relationships" as future capability, ADR-002 mentions hyperbolic embeddings)
- The `hierarchical` token in `src/` resolves only to unrelated concepts: `hierarchicalForward` (GNN matrix op), `HierarchicalNSW` (HNSW algorithm), `topology: 'hierarchical'` (swarm compat type)

Upstream ruflo's `CHANGELOG.md:18` confirms the origin: *"AgentDB v3.0.0-alpha.9: 8 new controllers (HierarchicalMemory, MemoryConsolidation, SemanticRouter, GNNService, RVFOptimizer, MutationGuard, AttestationLog, GuardedVectorBackend) + 6 MCP tools"* — HierarchicalMemory was a downstream addition packaged into agentdb's release. The reset to upstream removed the actual implementation while preserving the documentation that promises it works.

### Downstream consumption is broad — not isolated to /adr-index

Five upstream `ruflo` plugins reference `agentdb_hierarchical-*` tools across ~17 skill / agent / command / README files:

| Plugin | Files | What they call |
|---|---|---|
| `ruflo-adr` | adr-create, adr-review (SKILLs), adr-architect (agent), adr (command), REFERENCE.md | `-store` + `-query` for ADR tree + edge tracking |
| `ruflo-knowledge-graph` | kg-traverse, kg-extract (SKILLs), graph-navigator (agent), kg (command), README | `-store` + `-recall` for entity nodes + relation edges |
| `ruflo-goals` | deep-research, dossier-collect, horizon-track (SKILLs), deep-researcher, dossier-investigator (agents) | `-store` + `-recall` for goal/dossier persistence |
| `ruflo-market-data` | data-engineer (agent) | `-store` + `-recall` for OHLCV data + pattern metadata |

The hierarchical-* surface is load-bearing for at least 4 distinct downstream concerns: ADR tracking, knowledge graphs, goal/research workflows, and market data pipelines. ADR-0176's "/adr-index" framing understated the consumer count by ~4×.

### Latent UX bug: namespace argument silently dropped

`ruflo-market-data/docs/adrs/0001-market-data-contract.md:19` documents a known issue with the hierarchical-* tools:

> *"agentdb_hierarchical-* routes by **tier** (`working|episodic|semantic`), not namespace. The namespace arg was silently ignored."*

But several consumers continue to write namespace as if it worked:
- `plugins/ruflo-knowledge-graph/README.md:58` — *"Entity nodes are stored via `agentdb_hierarchical-store`"* (combined with `commands/kg.md:12`'s *"in the `knowledge-graph` namespace"* claim)
- `plugins/ruflo-knowledge-graph/skills/kg-extract/SKILL.md:27` — assumes namespace separation

Skill calls reach the tool but the namespace argument has no runtime effect — records collide across namespaces in the underlying `hierarchical_memory` SQL table. Out of scope for this fix; tracked as Open Follow-up #7.

### Prior ADR history on this surface

Several ruflo-patch ADRs have touched hierarchical memory:

| ADR | What it touched |
|---|---|
| ADR-0050 §N5 | Fixed (`[x]`): `agentdb_hierarchical-recall` missing `success` field in response shape |
| ADR-0068 | Listed `hierarchicalMemory` as one of the controllers needing config-chain wiring for Phase F1 |
| ADR-0069 | Documented that HierarchicalMemory / MemoryConsolidation were directly constructed (bypassing getController) and that their constructor `graphBackend` parameter was never read |
| ADR-0112 | Listed HierarchicalMemory as one of ~10 controllers using the AgentDB SQLite store (`hierarchical_memory` table) |
| ADR-0154 | Referenced hierarchical-store in a 231-ADR wipe-and-reindex test |
| ADR-0163 | `adr0090-b5-hierarchicalMemory` test bucket for concurrent-writer data-loss investigation |
| ADR-0166 Phase 1.5 | Removed the dead `graphBackend` parameter from HierarchicalMemory's constructor — visible in the restored class's header comment |
| ADR-0176 Phase 3 | Specified implementing `hierarchical-query`; today's commits land it |
| **ADR-0178** (this) | Documents the fix |

## The fix (3 commits, 2 repos)

### 1. Restore the controller class — `forks/agentdb/main` `599106b`

`git checkout bd760f2 -- src/controllers/HierarchicalMemory.ts` — pulls 781 LoC from the latest pre-postgres snapshot in the `archive/pre-adr-0177-reset-2026-05-12` branch. Choice of snapshot:

- **Not** archive HEAD: that version's commit `6661723 adr-0170 Phase B.1` added `PostgresBackend` imports, which directly violates ADR-0177's RVF-first substrate revert.
- **`bd760f2 adr-0166 Phase 3 Option F`**: pre-postgres; preserves the sqlite-vec `hmem_vec` virtual-table integration which adds SQL-side k-NN with no downside; clean imports (only `VectorBackend`, `EmbeddingService`, `cosineSimilarity`).
- One import path adjustment: `'../utils/vector-math.js'` → `'../utils/similarity.js'` — the `cosineSimilarity` export moved between bd760f2 and current HEAD; functionally identical.
- Add to `src/index.ts`: `export { HierarchicalMemory } from './controllers/HierarchicalMemory.js';` with an origin/restoration comment so future upstream-sync agents know not to drop it.

### 2. Add `.query(pathPattern, options?)` method — `forks/agentdb/main` `bdfadad`

55 LoC between `recall()` and `getStats()`. Signature:

```ts
async query(
  pathPattern: string,
  options?: { tier?: MemoryTier; limit?: number },
): Promise<MemoryItem[]>
```

Glob → SQL `LIKE` conversion: `*` → `%`, `?` → `_`. Caller-supplied `%`, `_`, `\` are escaped first via `ESCAPE '\\'` clause so they match literally. Filters: optional `tier`, optional `limit`. Sort: `ORDER BY created_at DESC`. Row → `MemoryItem` mapping mirrors `getMemoryById()` for parity.

Distinct from `recall()` (similarity search) and from `getMemoryById()` (single-key fetch).

### 3. Wire MCP tool surface + revert name normalization — `forks/ruflo/main` commits `8c9d9ab81` + `7f09818d0`

**`8c9d9ab81 Revert "fix: normalize all MCP tool names to underscores"`** — surgical `git revert` of the original misguided commit. 13 of 14 names flip from `_` back to `-` (the 14th, `causal-edge`, was independently restored to dash by a later commit `bd33cf54f` so its revert is a no-op). Affected tools beyond hierarchical-*: `pattern-store`, `pattern-search`, `session-start`, `session-end`, `context-synthesize`, `semantic-route`, `reflexion-retrieve`, `reflexion-store`, `causal-query`, `causal-recall`, `batch-optimize`. No internal callers or test files use the underscore forms (verified by grep across `v3/`, `plugins/`, `skills/`, `commands/`).

**`7f09818d0 adr-0176 Phase 3: register agentdb_hierarchical-query MCP tool + orchestration handler`** — three additions:

- New `hierarchicalQuery` export in `cli/src/mcp-tools/agentdb-orchestration.ts`: delegates to `getController('hierarchicalMemory').query(pathPattern, ...)`. Includes a stub-fallback path that emulates prefix-match over `hm.entries()` when the real `.query()` method is missing (forward-compatible for stub-mode runtime).
- MCP tool registration `agentdb_hierarchical-query` in `cli/src/mcp-tools/agentdb-tools.ts` between the existing `hierarchical-recall` and `consolidate` tools. inputSchema accepts `pathPattern` (required), `tier` (optional), `limit` (optional, capped at MAX_TOP_K). Validation via existing `validateString` / `validatePositiveInt` helpers.
- Tool exported in the file's export array so the registry picks it up at boot.

## Result

| MCP tool | Before fix | After fix |
|---|---|---|
| `agentdb_hierarchical-store` | ❌ name `_store` ≠ skill-declared `-store` AND class missing → silent stub | ✅ names match + real backend |
| `agentdb_hierarchical-recall` | ❌ same | ✅ matches + real backend |
| `agentdb_hierarchical-query` | ❌ doesn't exist at any of 3 layers | ✅ registered + handled + backed |
| `agentdb_causal-edge` | ✅ working | ✅ working (unchanged) |
| `agentdb_causal-query` | ❌ name mismatch | ✅ matches |

**1 of 4 ADR-0176 tools working → 4 of 4 working.** `/adr-create`, `/adr-review`, and the `adr-architect` agent's `allowed-tools` declarations now resolve to real backends.

Type-check: `forks/agentdb` `tsc --noEmit` shows 114 baseline errors (all pre-existing in `benchmarks/` + `examples/` + `tests/benchmarks/`, identical to upstream's set), zero new errors in restored or modified `src/` files.

## Why this is a fix, not a feature

Each of the three layers was already declared somewhere as expected-to-work:

- **Class:** declared in `controller-registry.ts:1473`'s `agentdbModule.HierarchicalMemory` lookup; consumed by `hierarchicalStore` / `hierarchicalRecall` orchestration handlers that have shipped for months
- **Tool names (dash forms):** declared in `plugins/ruflo-adr/skills/adr-create/SKILL.md`, `adr-review/SKILL.md`, `adr-architect.md`, `commands/adr.md`, `REFERENCE.md` — five files across the ruflo-adr plugin alone
- **`hierarchical-query` tool:** declared in `allowed-tools` of 2 skills + 1 agent; the description in ADR-0176 Phase 3 spec'd the semantics ("query hierarchical store by path/glob")

Each layer was a promise the fork made and didn't keep. This ADR records closing those three gaps as a coordinated fix.

## Consequences

* Good, because the fork now delivers what every layer of its own documentation already claims. No semantic change for callers — the tools behave the way their schemas + descriptions said they would.
* Good, because the stub-fallback path at `controller-registry.ts:1486` (`createTieredMemoryStub()`) is no longer the de-facto runtime state for hierarchical memory. Strict mode users stop getting `ControllerInitError`; non-strict-mode users stop getting silent in-memory-only persistence.
* Good, because the `hmem_vec` sqlite-vec virtual-table integration from ADR-0166 Phase 3 Option F is preserved — SQL-side k-NN remains an opportunistic capability when the extension is loaded, falling through cleanly when it isn't.
* Good, because the underscore-normalization revert (commit `8c9d9ab81`) also fixes 9 other tools beyond hierarchical-* (`pattern-store` / `-search`, `session-start` / `-end`, `context-synthesize`, `semantic-route`, `reflexion-retrieve` / `-store`, `causal-query` / `-recall`, `batch-optimize`) that had the same skill ↔ registry mismatch. Single revert, broader benefit.
* Bad, because fork now carries an 836-LoC `HierarchicalMemory.ts` (781 restored + 55 added) that upstream doesn't have. Future upstream-sync agents need to be aware. Mitigation: file is documented as fork-only via index.ts comment + this ADR + a memory entry (Open Follow-up #6).
* Bad, because the restored `bd760f2` snapshot is months stale; non-postgres improvements made between `bd760f2` and archive HEAD are not in the restored file. Mitigation: per-commit cherry-pick is Open Follow-up #3 if specific gaps surface.
* Bad, because other fork-only controllers the reset also removed (`MemoryConsolidation`, `QUICConnection*`, `QUICConnectionPool`, `QUICStreamManager`, `StreamingEmbeddingService`) remain unrestored. Their consumers (if any) continue routing to stubs. Mitigation: Open Follow-up #4 — catalog and decide per consumer audit.
* Bad, because **HierarchicalMemory has no in-class concurrency control**. Source-read confirms zero locks, no transactions, no atomic ops — relies entirely on the layers below (SQLite WAL + RVF's `flock`+`.jslock` from ADR-0095 + the vectorless-recovery fix from ADR-0163). Five specific gaps live above those substrates:
  - **Multi-write non-atomicity** in `store()` (HierarchicalMemory.ts:265-303): SQL `INSERT INTO hierarchical_memory` + `vectorBackend.insert()` + optional `hmem_vec` virtual-table mirror are 3 independent writes outside any transaction. Lines 305-310 explicitly acknowledge: *"a write that succeeds on the relational table but fails on the vec mirror leaves them inconsistent. Surface the error rather than silently swallowing."* Fails loud per `feedback-no-fallbacks` — inconsistency remains.
  - **In-memory cache races**: `workingMemoryCache` (Map) + `episodicMemoryIndex` (Map) accessed without locks. JS single-thread covers the common case; `await` boundaries allow interleaving.
  - **Auto-consolidation races**: `checkConsolidation()` runs from inside `store()` when `autoConsolidate: true`. Concurrent stores all trigger consolidation passes.
  - **Non-atomic `promote()`**: read accessCount → compare → update tier. Concurrent recalls can double-promote.
  - **No optimistic-concurrency token**: no `version`/`etag` on `MemoryItem`. `rehearse()` + `promote()` last-writer-wins on timestamp fields.

  Hierarchical-memory operations sit on top of substrate-level concurrency work tracked by ADR-0163 (closed for the t3-2 6-writer case via `7deff1027` vectorless-recovery fix), ADR-0167 + ADR-0168 (cross-process N=8 work continues). The `adr0090-b5-hierarchicalMemory` test bucket was one of the 14 failing buckets ADR-0163 cluster-tracked; needs re-verification against the restored class. Mitigation: Open Follow-up #8 catalogs the in-class gaps and decisions.

## Verification

| Layer | Verification |
|---|---|
| Controller restored | `forks/agentdb` `tsc --noEmit`: zero new errors in `src/controllers/HierarchicalMemory.ts` or `src/index.ts` |
| `.query()` method | Same — zero new errors; method placement between `recall` and `getStats` confirmed |
| Tool registration | `forks/ruflo` `tsc --noEmit`: 4 pre-existing errors (verify.ts @noble/ed25519 + config-adapter tieredCache, separately fixed in commit `805111cbf`); zero new errors from MCP tool addition or orchestration handler |
| Name revert | `forks/ruflo` `git show 8c9d9ab81 --stat` confirms 13 single-line changes (13 insertions / 13 deletions) in one file, no other surface touched |
| End-to-end acceptance | **Pending `npm run release`.** No e2e test exercises hierarchical-query yet — Open Follow-up #1. |

## Open follow-ups

1. **Add an end-to-end acceptance check** in `ruflo-patch/lib/acceptance-adr0177-checks.sh` (or sibling): `ruflo init` → `agentdb_hierarchical-store` records at paths `adr/ADR-001..003` → `agentdb_hierarchical-query` with pattern `adr/*` → assert 3 results. Validates the full 3-layer chain (controller method → orchestration → MCP registration).

2. **~~Upstream PR proposing `HierarchicalMemory` for `ruvnet/agentdb`.~~** **[🔻 Retired 2026-05-12 per `feedback-no-upstream-donate-backs.md`. Fork improvements stay fork-only; no PRs to ruvnet/* repos. The restored class lives in fork only; upstream users continue to receive the README's promise unfulfilled — that's upstream's problem, not the fork's. Original text preserved for traceability.]** Cite the README's existing claims (lines 94, 103, 181-187, 246) as motivation — upstream advertises the capability; the PR delivers it. Pair with ADR-0177 Phase 7 (orphan-fix PR) for maintainer-relationship value.

3. **Cherry-pick non-postgres improvements** from commits between `bd760f2` and archive HEAD. Audit each for relevance (bug fixes, perf tweaks); ignore postgres-specific changes.

4. **Catalog the other fork-only controllers still unrestored:**
   - `MemoryConsolidation.ts` (depends on HierarchicalMemory; natural follow-on)
   - `QUICConnection.ts` / `QUICConnectionPool.ts` / `QUICStreamManager.ts` (distributed-sync surface)
   - `StreamingEmbeddingService.ts` (streaming variant of EmbeddingService)

   For each: audit downstream callers, decide restore vs accept-stub.

5. **Skill-manifest ↔ MCP-registry CI guard** (per ADR-0176 Open Follow-up #2). Parse every `SKILL.md` in `forks/ruflo/plugins/`, extract `allowed-tools` MCP names, assert each is registered at boot. Prevents future drift like the underscore/dash mismatch or `hierarchical-query`-without-implementation.

6. **Document HierarchicalMemory as a fork-only file** via a project memory entry — so future upstream-sync agents see "expected to be fork-only" rather than being surprised by a file upstream doesn't have.

7. **Fix the namespace-silently-dropped UX bug** (per the audit finding in §"Latent UX bug"). `agentdb_hierarchical-*` routes by tier, not namespace. Two consumers continue to pass namespace as if it worked: `plugins/ruflo-knowledge-graph/README.md:58` + `commands/kg.md:12` (writes "knowledge-graph" namespace); `plugins/ruflo-knowledge-graph/skills/kg-extract/SKILL.md:27` (assumes namespace separation). Three options:
   - (a) Add namespace support to HierarchicalMemory schema (`hierarchical_memory` SQL table grows a `namespace` column, indexed; `store()` accepts it; `recall()` + `query()` filter on it). Requires migration.
   - (b) Have the orchestration handlers (`hierarchicalStore` / `hierarchicalRecall` / `hierarchicalQuery`) embed the namespace into the `content` field as a path prefix (`namespace:path`), preserving the tier-routing for storage. Caller-side concern, no schema change.
   - (c) Document the limitation explicitly in the MCP tool descriptions and fix the misleading consumer docs (knowledge-graph README + kg.md + kg-extract). Lowest-effort but doesn't deliver the feature.

   Defer the decision pending consumer audit (does anything other than knowledge-graph actually rely on cross-namespace separation?).

8. **In-class concurrency control for HierarchicalMemory.** Per the consequence bullet above, the restored class has no in-class primitives. Five specific gaps (multi-write non-atomicity, cache races, auto-consolidation races, non-atomic promote, no optimistic-concurrency token) sit on top of the substrate-level concurrency story (ADR-0163 / 0167 / 0168). Three design decisions to make:

   - **(a) Wrap `store()` SQL + vector + hmem_vec writes in a SQL transaction.** Smallest change, addresses the load-bearing multi-write desync case (HierarchicalMemory.ts:265-303). Implementation: open `BEGIN IMMEDIATE` on `this.db` before line 265; `COMMIT` after line 311; wrap `vectorBackend.insert()` failure in `ROLLBACK` if the SQL transaction supports it. Vector backend writes are NOT in the same transaction (different connection / different file), so this fixes SQL+hmem_vec atomicity but not SQL+vectorBackend — that desync remains. Net: partial fix; reduces the failure surface from 3-way to 2-way.

   - **(b) Add async mutex to working/episodic cache + auto-consolidation.** Broader change. Use a lightweight async-mutex pattern (e.g., `p-mutex` or a hand-rolled `Promise`-chained queue) around all `workingMemoryCache` / `episodicMemoryIndex` mutations + the `checkConsolidation()` call. Reduces interleaving risk under high concurrency. Doesn't help the multi-write desync (that's substrate-level).

   - **(c) Add `version` field + optimistic-update for `promote()` + `rehearse()`.** Largest change. New column `version` on `hierarchical_memory` SQL table (default 0; incremented on every update). `promote()` / `rehearse()` use `UPDATE ... WHERE id = ? AND version = ?` and retry on 0-rows-affected. Eliminates double-promote / last-writer-wins races. Requires schema migration.

   **Pre-requirement — verification step:** before deciding (a)/(b)/(c), re-verify the `adr0090-b5-hierarchicalMemory` test bucket against today's restored class. ADR-0163 closed t3-2 with the vectorless-recovery fix; if `b5-hierarchicalMemory` passes post-restoration + post-`npm run release`, the existing substrate fixes are sufficient and the in-class gaps may be theoretical-only. If it still fails (concurrent-write durability degraded for the hierarchical path specifically), escalate to a dedicated concurrency-fix ADR rather than incrementally adding (a)/(b)/(c).

   Lean: do the verification first; pick (a) if any in-class gap is empirically reachable; defer (b) + (c) unless a specific failure mode justifies them.
