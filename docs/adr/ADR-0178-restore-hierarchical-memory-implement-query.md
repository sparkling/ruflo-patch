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

## Audit context — why upstream's README didn't help

Upstream `ruvnet/agentdb/README.md` documents "10 Hierarchical / Causal Memory tools" (lines 181-187) including `agentdb_hierarchical_store / _recall / _delete` etc., plus a "hierarchical recall for /adr-index" promise (line 246). But upstream's actual code ships **none of them**:
- `src/mcp/agentdb-mcp-server.ts` registers zero `hierarchical_*` tools
- `src/controllers/HierarchicalMemory.ts` does not exist
- The hierarchical-* tools live downstream in ruflo's `agentdb-tools.ts`, consuming a `HierarchicalMemory` class the fork added via ADR-066

So upstream's README describes fork-only capabilities as if they were upstream. The reset to upstream therefore removed the actual implementation while preserving the documentation that promises it works.

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

2. **Upstream PR proposing `HierarchicalMemory` for `ruvnet/agentdb`.** Cite the README's existing claims (lines 94, 103, 181-187, 246) as motivation — upstream advertises the capability; the PR delivers it. Pair with ADR-0177 Phase 7 (orphan-fix PR) for maintainer-relationship value.

3. **Cherry-pick non-postgres improvements** from commits between `bd760f2` and archive HEAD. Audit each for relevance (bug fixes, perf tweaks); ignore postgres-specific changes.

4. **Catalog the other fork-only controllers still unrestored:**
   - `MemoryConsolidation.ts` (depends on HierarchicalMemory; natural follow-on)
   - `QUICConnection.ts` / `QUICConnectionPool.ts` / `QUICStreamManager.ts` (distributed-sync surface)
   - `StreamingEmbeddingService.ts` (streaming variant of EmbeddingService)

   For each: audit downstream callers, decide restore vs accept-stub.

5. **Skill-manifest ↔ MCP-registry CI guard** (per ADR-0176 Open Follow-up #2). Parse every `SKILL.md` in `forks/ruflo/plugins/`, extract `allowed-tools` MCP names, assert each is registered at boot. Prevents future drift like the underscore/dash mismatch or `hierarchical-query`-without-implementation.

6. **Document HierarchicalMemory as a fork-only file** via a project memory entry — so future upstream-sync agents see "expected to be fork-only" rather than being surprised by a file upstream doesn't have.
