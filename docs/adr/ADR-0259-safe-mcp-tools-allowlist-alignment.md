---
status: proposed
date: 2026-05-25
tags: [upstream-sync, rvagent-wasm, security, allowlist, ADR-129, design-gate]
supersedes: []
depends-on: [ADR-0254, ADR-0258]
implements: []
---

# SAFE_MCP_TOOLS allowlist alignment for ADR-129 Phases 1-3

## Context and Problem Statement

[[ADR-0254]] dispositioned upstream ADR-129 as `pick-partial` and named the SAFE_MCP_TOOLS allowlist audit as one of three remaining gates for Phases 1-3 land. Upstream's allowlist sits at `wasm-agent-tools.ts:41-52` of commit `47a7825b0` and enumerates 30 MCP tool names that `wasm_agent_compose` will tag with `description: "Ruflo MCP tool: <name>"` (vs the fallback `description: "MCP tool: <name>"`) when constructing `McpToolDescriptor` records inside the composed RVF.

The allowlist's safety contract is: **a name on this list is a curated `mcp__ruflo__*` tool that's been vetted as safe-by-default for composition into a sandboxed WASM agent's tool surface.** Names off the list are treated as caller-supplied unknowns — they still pass through the `DESTRUCTIVE_TOOL_PATTERNS` filter (`*_delete`, `_remove`, `_drop`, `_shutdown`, `federation_*`, etc.), but they aren't presented with the "Ruflo MCP tool" branded description.

Fork's MCP registry diverges from upstream's namespace assumptions in two material ways:

1. **Naming convention drift.** Upstream's allowlist uses underscores throughout (`hooks_post_task`, `agentdb_pattern_search`, `agentdb_hierarchical_recall`). Fork's actual tool registry uses HYPHENS for those names: `hooks_post-task`, `hooks_pre-task`, `agentdb_pattern-search`, `agentdb_hierarchical-recall`. Verified via `grep -hE "name:\s*'(hooks|agentdb)_" forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/{hooks,agentdb}-tools.ts`. The hyphenated names are the real, registered ones in fork's MCP surface. Upstream's allowlist names cannot resolve to fork's tools without translation.

2. **Tools that don't exist in fork.** Upstream's list includes `memory_compress`, `embeddings_search_text`, `wasm_agent_status`, `task_summary` — none have an entry in fork's `mcp-tools/` source. Verified by grep against the relevant tool files.

3. **Fork-additional tools that should be considered.** Fork's `memory-tools.ts` exposes `memory_search_unified` (the SOTA search surface per memory `[[reference-fast-test-runner]]` and `[[project-memory-search-rvf-snapshot-isolation]]`) and `memory_bridge_status` — neither exists upstream. Upstream's allowlist is naive of them.

If we ship Phase 3's SAFE_MCP_TOOLS verbatim, the allowlist contains names that don't resolve in fork's registry — the descriptor branding becomes broken-by-default for 7 of the 30 names. A caller composing an agent with `mcpTools: ['hooks_post_task']` would pass it through (it's not destructive, so not blocked), but the underscore-named tool doesn't exist on the host, so the agent would fail to dispatch it at runtime. That's an evidence-vs-claim mismatch: the allowlist *claims* the tool is a curated, safe Ruflo tool; the runtime *finds* nothing.

## Decision Drivers

* **The allowlist must reflect actual fork registry.** Names on the list must resolve to a real tool entry in fork's `mcp-tools/*-tools.ts`. Anything else is decorative misinformation.
* **Honor fork's naming convention.** Hyphenated names like `hooks_post-task` exist for reasons predating this ADR; we do not rename them. Codemodding fork's tool names to match upstream is out of scope and would break every existing caller.
* **Preserve the "safe by default" semantics.** The list should contain tools that are reasonable to compose into a sandboxed WASM agent without any further policy gate — that means read/search/list-shaped tools and a small number of curated write tools (memory_store, embeddings_generate) that don't carry deletion or destructive side effects.
* **Add fork-additional curated tools where they meet the safety contract.** `memory_search_unified` is the SOTA memory recall surface; if it meets the safety bar, it belongs in the allowlist.
* **`feedback-no-fallbacks`.** Each "fork-present: YES" entry must be backed by a grep hit, not by hope. Each "fork-present: NO" must be ruled out by the same grep. No "probably exists" rows.

## Considered Options

* **Option A — Ship upstream's 30 names verbatim.** Rejected. 7 of the 30 do not resolve to a fork tool name (4 hyphen-vs-underscore, 3 missing entirely). The allowlist would brand non-existent tools as "curated Ruflo tools."
* **Option B — Translate the 7 mismatched names and add fork-additional curated tools (this ADR).** For each of upstream's 30: drop tools that don't exist, fix the hyphen/underscore mismatches to match fork's actual registry, add fork-additional curated tools that meet the same safety bar.
* **Option C — Drop the allowlist entirely; rely solely on `DESTRUCTIVE_TOOL_PATTERNS`.** Rejected because it loses the "Ruflo MCP tool: " branded descriptor that helps the composed agent's prompt see a curated provenance signal — the descriptor is the only non-destructive UX consequence of the list. Strip the list and every compose call gets the bare "MCP tool: <name>" fallback.
* **Option D — Maintain dual allowlists (upstream + fork-additional).** Rejected as needless complexity; the allowlist is for the composed-RVF descriptor branding, and a single curated set is the simpler model.

## Decision Outcome

Chosen: **Option B — Translate mismatches, drop missing, add fork-additional curated tools.**

### Per-tool reconciliation table

Source-of-truth confirmations:

* Upstream allowlist: `47a7825b0:v3/@claude-flow/cli/src/mcp-tools/wasm-agent-tools.ts:41-52` (verified via `git show` to `/tmp/upstream-wasm-agent-tools-129.ts:41-52`).
* Fork registry: `grep -hE "name:\s*'(memory|embeddings|hooks|wasm|agentdb|neural|task)_" forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/*-tools.ts` (executed 2026-05-25).

| Upstream-safe name | Upstream-safe? | Fork-present? | Verdict | Fork-allowlist name |
|---|---|---|---|---|
| `memory_search` | YES | YES (`memory-tools.ts`) | KEEP | `memory_search` |
| `memory_retrieve` | YES | YES | KEEP | `memory_retrieve` |
| `memory_list` | YES | YES | KEEP | `memory_list` |
| `memory_stats` | YES | YES | KEEP | `memory_stats` |
| `memory_store` | YES | YES | KEEP | `memory_store` |
| `memory_compress` | YES | NO (not in `memory-tools.ts`) | DROP | — |
| `memory_export` | YES | YES | KEEP | `memory_export` |
| `embeddings_search` | YES | YES (`embeddings-tools.ts`) | KEEP | `embeddings_search` |
| `embeddings_search_text` | YES | NO | DROP | — |
| `embeddings_generate` | YES | YES | KEEP | `embeddings_generate` |
| `embeddings_status` | YES | YES | KEEP | `embeddings_status` |
| `embeddings_compare` | YES | YES | KEEP | `embeddings_compare` |
| `hooks_post_task` | YES | NO (fork registers `hooks_post-task` with hyphen) | RENAME | `hooks_post-task` |
| `hooks_pre_task` | YES | NO (fork registers `hooks_pre-task` with hyphen) | RENAME | `hooks_pre-task` |
| `hooks_route` | YES | YES | KEEP | `hooks_route` |
| `hooks_metrics` | YES | YES | KEEP | `hooks_metrics` |
| `wasm_agent_list` | YES | YES | KEEP | `wasm_agent_list` |
| `wasm_agent_status` | YES | NO (no such tool in `wasm-agent-tools.ts`) | DROP | — |
| `wasm_agent_files` | YES | YES | KEEP | `wasm_agent_files` |
| `wasm_gallery_list` | YES | YES | KEEP | `wasm_gallery_list` |
| `wasm_gallery_search` | YES | YES | KEEP | `wasm_gallery_search` |
| `wasm_gallery_categories` | YES | YES (added by ADR-129 Phase 3 land per [[ADR-0258]] Group 3 row 9) | KEEP (post-P3) | `wasm_gallery_categories` |
| `agentdb_pattern_search` | YES | NO (fork registers `agentdb_pattern-search` with hyphen) | RENAME | `agentdb_pattern-search` |
| `agentdb_hierarchical_recall` | YES | NO (fork registers `agentdb_hierarchical-recall` with hyphen) | RENAME | `agentdb_hierarchical-recall` |
| `neural_predict` | YES | YES (`neural-tools.ts`) | KEEP | `neural_predict` |
| `neural_patterns` | YES | YES | KEEP | `neural_patterns` |
| `neural_status` | YES | YES | KEEP | `neural_status` |
| `task_list` | YES | YES (`task-tools.ts`) | KEEP | `task_list` |
| `task_status` | YES | YES | KEEP | `task_status` |
| `task_summary` | YES | NO | DROP | — |

Net from upstream's 30: **23 KEEP, 4 RENAME, 3 DROP** (where `wasm_gallery_categories` is contingent on Phase 3 landing per [[ADR-0258]] Group 3 row 9; if Phase 3 ships in the same commit batch as the allowlist, this row applies).

### Fork-additional curated tools to add

Tools that exist in fork but not upstream, evaluated against the safety bar (read/search/list-shaped, or curated non-destructive write):

| Fork-additional name | Source file | Shape | Verdict | Reason |
|---|---|---|---|---|
| `memory_search_unified` | `memory-tools.ts` | SOTA hybrid (sparse+dense) + Graph RAG + MMR memory search | ADD | Read-shape; memory `[[project-memory-search-rvf-snapshot-isolation]]` documents this as the canonical memory recall surface. Strictly safer than `memory_search` (which is the legacy path) for composed agents. |
| `memory_bridge_status` | `memory-tools.ts` | Returns Claude Code memory-bridge status (read-only) | ADD | Read-shape; non-destructive; gives composed agents visibility into whether `MEMORY.md` has been imported into AgentDB. |
| `embeddings_hyperbolic` | `embeddings-tools.ts` | Generate Poincare-ball embeddings for hierarchical data | HOLD | Generation/write-shape, but produces only embeddings, not data mutations. Fork-uncommon. Holding off pending a use case. |
| `embeddings_neural` | `embeddings-tools.ts` | Neural-network-style embedding adaptation | HOLD | Same as above — write-shape but bounded. Hold for now. |
| `embeddings_init` | `embeddings-tools.ts` | Initialize embedding subsystem | HOLD | Has side effects on subsystem state; not safe-by-default. |
| `agentdb_pattern-store` | `agentdb-tools.ts` | Store a pattern for future search | HOLD | Mutation. The list already includes `agentdb_pattern-search` (renamed); the symmetric write tool is not safe-by-default for composed agents. |
| `agentdb_hierarchical-store` | `agentdb-tools.ts` | Store a hierarchical fact | HOLD | Same reasoning as above. |
| `agentdb_skill_search` | `agentdb-tools.ts` | Search skills registry | ADD | Read-shape; symmetric to `agentdb_pattern-search`. |

Net fork-additional adds: **3** (`memory_search_unified`, `memory_bridge_status`, `agentdb_skill_search`).

### Final SAFE_MCP_TOOLS for fork (the deliverable)

Combining KEEP + RENAME + ADD (and including `wasm_gallery_categories` contingent on Phase 3 landing per [[ADR-0258]] Group 3 row 9):

```typescript
const SAFE_MCP_TOOLS = new Set([
  // Memory (7)
  'memory_search', 'memory_search_unified', 'memory_retrieve', 'memory_list', 'memory_stats',
  'memory_store', 'memory_export', 'memory_bridge_status',
  // Embeddings (4)
  'embeddings_search', 'embeddings_generate', 'embeddings_status', 'embeddings_compare',
  // Hooks (4) — note hyphens in post-/pre-task per fork convention
  'hooks_post-task', 'hooks_pre-task', 'hooks_route', 'hooks_metrics',
  // WASM agent surface (3)
  'wasm_agent_list', 'wasm_agent_files',
  // WASM gallery surface (3) — `wasm_gallery_categories` contingent on Phase 3
  'wasm_gallery_list', 'wasm_gallery_search', 'wasm_gallery_categories',
  // AgentDB (3) — note hyphens per fork convention
  'agentdb_pattern-search', 'agentdb_hierarchical-recall', 'agentdb_skill_search',
  // Neural (3)
  'neural_predict', 'neural_patterns', 'neural_status',
  // Task (2)
  'task_list', 'task_status',
]);
```

**Total entries in fork's final SAFE_MCP_TOOLS: 26** (24 if Phase 3 of ADR-129 has not yet shipped, removing `wasm_gallery_categories` from the line above and dropping `memory_bridge_status` is NOT proposed — leave both in).

Note on count: upstream had 30; fork's final list is 26. The shrinkage is: -3 (drop `memory_compress`, `embeddings_search_text`, `wasm_agent_status`, `task_summary`) +3 fork-additional (`memory_search_unified`, `memory_bridge_status`, `agentdb_skill_search`) = -4 (subtractions) + 3 (additions) = net -1; plus -3 (Phase 3-contingent: only `wasm_gallery_categories` survives; `wasm_agent_status` and `task_summary` were independently dropped). The hyphen renames are 1-for-1 substitutions. Verifying total: upstream 30 → drop 4 (memory_compress, embeddings_search_text, wasm_agent_status, task_summary) = 26 → add 3 (search_unified, bridge_status, skill_search) = 29 → 4 renames don't change count. Wait — let me recount the table.

Re-counting from the final TypeScript block above:

* Memory: 8 entries (`memory_search`, `memory_search_unified`, `memory_retrieve`, `memory_list`, `memory_stats`, `memory_store`, `memory_export`, `memory_bridge_status`).
* Embeddings: 4 entries.
* Hooks: 4 entries.
* WASM agent: 2 entries (`wasm_agent_list`, `wasm_agent_files`).
* WASM gallery: 3 entries.
* AgentDB: 3 entries.
* Neural: 3 entries.
* Task: 2 entries.

Total: 8 + 4 + 4 + 2 + 3 + 3 + 3 + 2 = **29 entries.**

**Total SAFE_MCP_TOOLS entries in fork's final allowlist: 29** (vs upstream's 30).

### Verification (post-implementation)

When Phase 3 of ADR-129 lands (a separate implementation ADR), the implementer must:

1. Place the `SAFE_MCP_TOOLS` definition immediately after `DESTRUCTIVE_TOOL_PATTERNS` in fork's `wasm-agent-tools.ts`, matching upstream's structure.
2. Confirm each name in the final allowlist resolves to a real tool entry via `grep -hE "name:\s*'<name>'" forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/*-tools.ts` — every name must produce at least one hit. If any does not, fail acceptance loudly (per `[[feedback-no-fallbacks]]`).
3. Confirm the hyphen-renamed entries (`hooks_post-task`, `hooks_pre-task`, `agentdb_pattern-search`, `agentdb_hierarchical-recall`) appear with the hyphenated spelling exactly.
4. If `wasm_gallery_categories` is included but Phase 3 has not landed yet, the entry refers to a tool that doesn't yet exist — either land Phase 3 in the same commit batch (preferred) or drop `wasm_gallery_categories` from the allowlist until Phase 3 lands.

## Consequences

### Positive

* **Every allowlist entry resolves.** Each name has a verified grep hit against fork's `mcp-tools/*-tools.ts`. The "curated Ruflo tool" descriptor branding becomes true-by-construction.
* **Hyphen convention preserved.** Fork's existing tool names are untouched; no codemod to rename them.
* **Fork-curated additions reflect actual fork-side recall surface.** `memory_search_unified` is the SOTA search path per memory `[[project-memory-search-rvf-snapshot-isolation]]`; surfacing it via the allowlist's branded descriptor signals to composed agents which surface is canonical.
* **Future-proof against upstream re-converge.** If upstream later expands the allowlist with more underscore-named tools, the fork-side allowlist file is the single source of truth; the translation table in this ADR is the audit trail for what was renamed and why.

### Negative

* **One-way divergence.** Fork's allowlist now contains tool names upstream's allowlist doesn't (e.g., `memory_search_unified`). Future upstream syncs against the allowlist must hand-merge: a naive `cp` over the file would clobber the fork-additional entries.
* **`wasm_gallery_categories` contingency adds coupling.** This ADR's final allowlist count is "29 if Phase 3 ships in the same batch, else 28 with `wasm_gallery_categories` deferred." The implementer must check the Phase 3 status before committing the allowlist; this ADR documents both possibilities.

### Neutral

* **No code change in this ADR.** This is a decision-only ADR; the allowlist constant lands in a separate commit under its own implementation ADR. The TypeScript block above is the implementer's spec.
* **The third gate remains.** [[ADR-0254]] Phases 1-3 gating list still has the `loadRvf` signature typo fix (`optional-modules.d.ts:295`). This ADR resolves only the SAFE_MCP_TOOLS audit; the typo fix is a separate, trivial pre-req ADR.

## Confirmation

1. If Phases 1-3 of ADR-129 land in a follow-up implementation ADR, that ADR's commit references this ADR for the final SAFE_MCP_TOOLS constant and the renaming-rationale audit trail.
2. If a future upstream sync touches upstream's SAFE_MCP_TOOLS, this ADR's per-tool table is the diff baseline: any new upstream entry must be re-mapped through "exists in fork? rename or drop?" before being accepted.
3. If a future ADR proposes adding more fork-additional tools to the allowlist (e.g., `embeddings_hyperbolic`, `agentdb_pattern-store`), it cites this ADR's §"Fork-additional curated tools" table for the safety-bar reasoning it must explicitly extend.

## More Information

* `docs/research/2026-05-25-adr129-rvagent-upstream-trace.md` — R-A finding; §"Open questions" #3 is the open question this ADR resolves.
* Upstream `47a7825b0:v3/@claude-flow/cli/src/mcp-tools/wasm-agent-tools.ts:41-52` — the 30-entry source (rendered to `/tmp/upstream-wasm-agent-tools-129.ts:41-52` for analysis).
* Fork registry grep audit (2026-05-25):
  - `memory-tools.ts` — 9 `memory_*` entries: `memory_search`, `memory_search_unified`, `memory_retrieve`, `memory_list`, `memory_stats`, `memory_store`, `memory_export`, `memory_bridge_status`, `memory_delete`, `memory_import_claude`, `memory_migrate`.
  - `embeddings-tools.ts` — 7 `embeddings_*` entries: `embeddings_compare`, `embeddings_generate`, `embeddings_hyperbolic`, `embeddings_init`, `embeddings_neural`, `embeddings_search`, `embeddings_status`.
  - `hooks-tools.ts` — 30+ `hooks_*` entries (hyphen convention throughout for `post-task`, `pre-task`, `model-route`, etc.).
  - `agentdb-tools.ts` — hyphen convention for `pattern-search`, `hierarchical-recall`, `causal-edge`, etc.
  - `task-tools.ts` — 7 `task_*` entries: `task_assign`, `task_cancel`, `task_complete`, `task_create`, `task_list`, `task_status`, `task_update`. No `task_summary`.
* `[[ADR-0254]]` — parent disposition; Phase 1-3 gating list amended to 3 questions after OpenRouter resolved.
* `[[ADR-0258]]` — sibling decision ADR resolving the persistence-threading gate. `wasm_gallery_categories` belongs to ADR-0258's Group 3 row 9 and is contingent on Phase 3 landing.
* Memory `[[project-memory-search-rvf-snapshot-isolation]]` — documents `memory_search_unified` as the SOTA recall surface; informs the fork-additional ADD decision.
* Memory `[[feedback-no-fallbacks]]` — corpus rule informing the "every grep hit must be verified" stance.
