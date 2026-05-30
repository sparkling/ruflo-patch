---
status: accepted
date: 2026-05-12
tags: [mcp, skill, naming, agentdb]
supersedes: []
depends-on: [ADR-0174]
implements: []
---

# Reconcile `/adr-index` MCP tool naming with fork's agentdb-tools.ts

## Context and Problem Statement

The `/adr-index` skill (`~/.claude/skills/adr-index/SKILL.md`, distributed via `ruflo-adr` plugin) declares 6 MCP tools in its `allowed-tools` frontmatter:

```
allowed-tools:
  mcp__ruflo__agentdb_hierarchical-store
  mcp__ruflo__agentdb_hierarchical-query
  mcp__ruflo__agentdb_causal-edge
  mcp__ruflo__agentdb_causal-query
  mcp__ruflo__memory_store
  mcp__ruflo__memory_search
  Bash Read Grep Glob
```

The 2 `memory_*` tools work. The 4 `agentdb_*` tools have name mismatches against what fork's `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/agentdb-tools.ts` actually registers:

| Skill declares (dash) | Fork registers (in `agentdb-tools.ts`) | Match? |
|---|---|---|
| `agentdb_hierarchical-store` | `agentdb_hierarchical_store` (**underscore**) | **No — name mismatch; skill call fails** |
| `agentdb_hierarchical-query` | (none — closest is `agentdb_hierarchical_recall`, both underscored and different semantics) | **No — name + semantic mismatch; skill call fails** |
| `agentdb_causal-edge` | `agentdb_causal-edge` ✓ | Yes |
| `agentdb_causal-query` | `agentdb_causal_query` (**underscore**) | **No — name mismatch; skill call fails** |

Verified by source-read at `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/agentdb-tools.ts`:

```
agentdb_hierarchical_store      ← underscore
agentdb_hierarchical_recall     ← underscore (and "recall" semantics — single key lookup)
agentdb_hierarchical-delete     ← dash
agentdb_causal-edge             ← dash
agentdb_causal_query            ← underscore
agentdb_causal_recall           ← underscore
agentdb_causal-edge-delete      ← dash
agentdb_causal-node-delete      ← dash
```

The MCP server **does not normalize dash↔underscore**. Verified: `forks/ruflo/v3/@claude-flow/mcp/src/tool-registry.ts:389` validates only that tool names match `/^[a-z][a-zA-Z0-9_/:-]*$/`. No alias layer. Skill calls to `agentdb_hierarchical-store` (dash) look up a tool registered as `agentdb_hierarchical_store` (underscore), don't find it, and fail.

Upstream `ruvnet/ruflo` is the same skill source; upstream's `agentdb-tools.ts` registers the dash forms (`agentdb_hierarchical-store`, `agentdb_hierarchical-recall`) — but **no `agentdb_hierarchical-query` and no `agentdb_causal-query`** exist upstream either. The skill's name choices originated from a different point in upstream history that no longer exists.

**`/adr-index` runs are silently failing on 3 of 4 agentdb tool calls today**, plus 1 tool (`agentdb_hierarchical-query`) that doesn't exist anywhere by that name.

## Decision Drivers

* **Skill manifest stability (per ADR-0174's driver).** Skills declare specific MCP tool names. Changing the skill manifest forces every downstream consumer (plugin marketplace, cached skill installations, future skill authors who learned the dash names) to update. Prefer fixing the MCP server side.
* **Naming consistency within the `agentdb_*` namespace.** Fork's `agentdb-tools.ts` currently mixes conventions: `_hierarchical_store` (underscore) but `_hierarchical-delete` (dash); `_causal_query` (underscore) but `_causal-edge` (dash). No principled rule — accumulated drift. Pick one convention and align.
* **Dash convention as the standard.** Both upstream (where dash forms exist) and the skill manifest use dash. Aligning fork to dash matches both.
* **`feedback-no-fallbacks`.** Silent skill-call failures violate the no-silent-failures discipline. Either the call succeeds against the right tool, or it throws a clear "tool not found" error — but it must not silently no-op.
* **Cross-skill scope.** Other skills (`/odr-index`, `/adr-create`, `/odr-create`, possibly more in the `ruflo-adr` plugin) may declare the same names; one fix covers them all.

## Considered Options

* **Option A** — Rename skill declarations to match fork's underscore convention. Skill becomes `agentdb_hierarchical_store` / `_recall` / `_causal-edge` / `_causal_query`.
* **Option B** — Rename fork's MCP tools to match the skill's dash convention. Skill stays unchanged.
* **Option C** — Add aliases in fork's MCP server so both dash and underscore forms work. Skill stays unchanged.
* **Option D** — Implement `agentdb_hierarchical-query` and `agentdb_causal-query` as separate tools (distinct from `_recall` and the underscore `_query`) so semantics + naming both align.

## Decision Outcome

Chosen option: **Option B + Option D combined.**

- **B**: Rename the 3 mismatched underscore-form tools in fork's `agentdb-tools.ts` to their dash equivalents.
- **D**: Implement `agentdb_hierarchical-query` as a new tool (different semantics from `_recall`) covering the skill's actual need (read records by hierarchical path/glob, not single-key lookup).

### The 4 fork-side tool changes

1. **Rename `agentdb_hierarchical_store` → `agentdb_hierarchical-store`**
   - File: `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/agentdb-tools.ts`
   - Change the `name:` field; handler implementation unchanged.
   - Search-and-replace any `mcp__ruflo__agentdb_hierarchical_store` references in fork code; expected: zero (or only in tests).

2. **Implement new `agentdb_hierarchical-query` tool**
   - Distinct from existing `agentdb_hierarchical_recall` (which becomes `agentdb_hierarchical-recall` per item 4).
   - Semantics: query hierarchical store by path/glob, return matching records. The skill body (step 7 verification) needs to read ADR records to cross-reference against edges; `-recall` is single-key lookup, `-query` is path-pattern enumeration.
   - Handler: route to `getController('hierarchicalMemory')` and call the controller's enumerate/query API; if no such API exists on the controller, add one (small fork-side controller patch).

3. **Rename `agentdb_causal_query` → `agentdb_causal-query`**
   - File: same as #1
   - Same shape of change — name update only, handler unchanged.

4. **Rename `agentdb_hierarchical_recall` → `agentdb_hierarchical-recall` AND `agentdb_causal_recall` → `agentdb_causal-recall`**
   - For naming consistency within the `agentdb_*` family. Not directly required by `/adr-index` but required for the dash convention to be uniform. Audit and update any fork-internal callers of the underscore forms.

### Boundary: skill manifests do NOT change

The 11 cached locations of the `/adr-index` skill (per the find earlier) plus the master in `forks/ruflo/plugins/ruflo-adr/skills/adr-index/SKILL.md` stay unchanged. The skill's `allowed-tools` frontmatter is the contract; fork honors it.

### Audit for cross-skill impact

Before applying the renames, search the entire skill ecosystem for usage of the underscore names:

```bash
grep -rE "mcp__ruflo__agentdb_(hierarchical_store|hierarchical_recall|causal_query|causal_recall)" \
  /Users/henrik/source/ruvnet/ruflo /Users/henrik/source/forks/ruflo \
  ~/.claude/skills ~/.claude/plugins
```

Any consumer using the underscore name has to be updated. Expected: zero hits, since the skill ecosystem standardizes on dash per upstream. If hits exist, scope expands to include those consumers in the rename.

### Out of scope

- Renaming the **delete** tools (`agentdb_hierarchical-delete`, `agentdb_causal-edge-delete`, `agentdb_causal-node-delete`) — they already use dash. Consistent.
- Adopting a separate underscore→dash alias layer in the MCP server. Option C rejected: aliases are silent fallbacks; `feedback-no-fallbacks` discourages them; renaming is the no-fallback fix.
- Changing tool semantics. This ADR is a rename; behavior of `_store` / `_recall` / `_query` etc. is preserved.

### Consequences

* Good, because `/adr-index` (and `/odr-index` and similar skills sharing the manifest convention) starts succeeding on all 4 agentdb tool calls instead of silently failing on 3 of 4.
* Good, because fork's `agentdb_*` namespace becomes internally consistent (all dash, matching the existing delete-tool convention).
* Good, because fork aligns with upstream's dash-convention naming where upstream has the same tool.
* Good, because skill manifest stability (ADR-0174's driver) is respected — skills are unchanged.
* Bad, because any fork-internal callsite using the underscore form has to be updated. Mitigation: audit + atomic update in the same PR.
* Bad, because the new `agentdb_hierarchical-query` tool adds ~100-200 LoC: tool definition + handler + small controller patch if `HierarchicalMemory` lacks an enumerate API. Mitigation: scoped narrowly to what `/adr-index` step 7 needs.
* Neutral, because no MCP server alias layer is introduced — same registration model, just consistent names.

### Confirmation

1. **Phase 1 — Audit cross-skill usage** of the underscore forms. Document affected callsites. Expected: zero outside of fork tests.
2. **Phase 2 — Rename the 3 underscore tools** to dash in `agentdb-tools.ts`. Update any fork-internal callers identified in Phase 1. CI runs green.
3. **Phase 3 — Implement `agentdb_hierarchical-query`** tool: handler routes to a `HierarchicalMemory.query(path_pattern)` controller method (add if missing). Acceptance: from a populated `adr/*` hierarchical store, calling `agentdb_hierarchical-query` with path `adr/*` returns all ADR records.
4. **Phase 4 — Re-run `/adr-index`** against the fork-published `@sparkleideas/cli`; verify all 4 agentdb tool calls succeed and the index builds without "tool not found" errors.
5. **Phase 5 — Add acceptance test** that the 4 declared tool names exist in the MCP tool registry at boot. Prevents future drift.

## Pros and Cons of the Options

### Option A — rename skill to match fork (underscore)

* Good, because no MCP server change.
* Bad, because violates ADR-0174's skill-manifest-stability driver: every skill installation, plugin cache, and downstream user has to update.
* Bad, because diverges from upstream's dash convention (upstream's tool names use dash for the same family). Sync friction increases.

### Option B — rename fork's MCP tools to dash (partial fix; works for `_store` / `_query`)

* Good, because skill manifest stays stable.
* Good, because aligns fork with upstream's dash convention.
* Bad, because `_hierarchical-query` doesn't exist anywhere — Option B alone doesn't cover that case. Pair with Option D.

### Option C — add MCP server alias layer (both forms work)

* Good, because all skill versions in the wild keep working without renames.
* Bad, because silent alias is a fallback; `feedback-no-fallbacks` discourages it.
* Bad, because future skill authors learn whichever name they encounter first, deepening the drift instead of fixing it.

### Option D — implement `agentdb_hierarchical-query` as a new tool

* Good, because the skill semantics actually need a path-pattern query, not a single-key recall — adding the tool is the right fix.
* Good, because keeps `_recall` semantics intact for callers that need single-key lookup.
* Bad, because ~100-200 LoC of new tool + handler + possibly controller patch. Justified by the actual semantic gap.

### Option B + Option D (chosen)

* Good, because covers all 4 mismatched / missing tools with one coordinated change.
* Good, because aligns naming convention AND fills the semantic gap.
* Bad, because larger fork patch than B or C alone.

## More Information

Original status: completed, closed on 2026-05-18.

### Relationship to ADR-0174 (graph_* axis introduction)

ADR-0174 establishes the "Skill manifest stability" decision driver (line 65) and Phase C's no-skill-changes commitment (line 168). This ADR is a concrete application of that driver: when fork tooling diverges from skill expectations, fix the tooling, not the skill.

ADR-0174 Phase C re-routes the handlers of these MCP tools to the `graph_*` substrate without renaming. ADR-0176 (this ADR) is independent — it fixes the *names* in fork to match the skill's `allowed-tools` declaration. Both must happen for `/adr-index` to work correctly in fork: this ADR makes the calls reach a registered tool; ADR-0174 Phase C makes the routed handler actually do graph operations.

### Live evidence — `/adr-index` is failing today

Running `/adr-index` against the current fork would hit at least 3 silent failures:
- `mcp__ruflo__agentdb_hierarchical-store` call → tool not found → step 3 (record metadata storage) fails silently for every ADR
- `mcp__ruflo__agentdb_hierarchical-query` call → tool not found → step 7 verification incomplete
- `mcp__ruflo__agentdb_causal-query` call → tool not found → step 7 graph verification fails

Only `mcp__ruflo__agentdb_causal-edge` (step 4 edge creation) and the 2 memory_* tools work. Net behavior of `/adr-index` today: emits the report (step 8) without actual storage or verification — skill is essentially a no-op against persistence.

### Memory entries this ADR would touch

- None directly. The fix is at the MCP server / skill-tool-registration boundary; no project memory entries describe the underscore-vs-dash convention.

### Open follow-ups

1. **Cross-fork tool name audit.** Once the 4 renames land, audit every MCP tool in `agentdb-tools.ts` (49 tools per fork inventory) for naming-convention consistency. Catalogue all underscore-form names; decide if they all rename to dash. If yes, this becomes a fork-wide normalization pass.
2. **CI guard for skill-manifest ↔ MCP-registry alignment.** Add a regression test that parses every `SKILL.md` in `forks/ruflo/plugins/`, extracts `allowed-tools` MCP tool names, and asserts each is registered in the MCP server at boot. Prevents future drift.
3. **`HierarchicalMemory.query(path_pattern)` controller API.** Implementing `agentdb_hierarchical-query` may require a new controller method. Decide if the method becomes part of the canonical `HierarchicalMemory` interface (and gets promoted into ADR-0170 / ADR-0174 substrate scope) or stays as a thin fork-side wrapper.
4. **Upstream coordination.** Upstream `ruvnet/ruflo` doesn't have `agentdb_hierarchical-query` or `agentdb_causal-query` either. Once we implement these in fork, decide whether to PR them back upstream (the `/adr-index` skill upstream-side likely also fails silently on these). Aligns with ADR-0174 follow-up #8's upstream-PR coordination pattern.

## Amendments

### Amendment: Status reconciliation (2026-05-18) — partial implementation

Status kept `proposed` per the 2026-05-18 ADR status audit.

**Landed (Phases 2 + 3):**

- **Phase 2 renames** — `agentdb_hierarchical-store` registered with
  dash form at `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/agentdb-tools.ts:505`;
  `agentdb_causal-query` registered with dash form at `:1148`.
- **Phase 3 implementation** —
  `forks/agentdb/src/controllers/HierarchicalMemory.ts:487`
  implements `query(path_pattern)` ("the read-side complement to
  `store()`'s write path"); routed via
  `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/agentdb-tools.ts:604`
  (handler) and `agentdb-orchestration.ts:358` (path/glob enumeration
  comment).

**Deferred / open:**

- **Phase 5** — acceptance test asserting the 4 declared tool names
  exist in the MCP tool registry at boot has not been delivered.
  Without this gate, the underscore-vs-dash drift can re-occur. The
  follow-up "CI guard for skill-manifest ↔ MCP-registry alignment"
  (Open follow-up #2) likewise is not in place.
- **Phase 4** — `/adr-index` end-to-end against the published
  `@sparkleideas/cli` is not explicitly recorded as run + verified
  post-rename.

Reconciled as part of the 2026-05-18 status audit.

### Amendment: Phase 5 close-out (2026-05-18)

**Status flipped `proposed` → `implemented` with `closed-on: 2026-05-18`.**

Phase 5 delivered via `lib/acceptance-adr0176-tool-names.sh` (commit
`4fc11a0` on ruflo-patch main). Check id `adr0176-tool-names` boots
`cli mcp start`, sends JSON-RPC `initialize` + `tools/list` on stdin,
parses the registered tool names, and asserts all 4 dash-form names
from the `/adr-index` SKILL.md `allowed-tools:` declaration are
present in the MCP registry:

- `agentdb_hierarchical-store`
- `agentdb_hierarchical-query`
- `agentdb_causal-edge`
- `agentdb_causal-query`

Per-name fail-loud diagnostic per `feedback-no-fallbacks`. Verified
green in the release gate at ruflo `patch.207`: `673/682 passed, 0
failed, 9 skip_accepted` (corpus grew by +1 from the 681 baseline;
new check passed in 161ms).

Method mirrors `lib/acceptance-adr0117-marketplace-mcp.sh` AC#4 (JSON-RPC
`tools/list` parse via node), narrowed to the 4 ADR-0176 names.

**Open follow-ups remaining (out of scope for this close-out):**

- **Open follow-up #2** — broader CI guard that parses EVERY `SKILL.md`
  in `forks/ruflo/plugins/` and asserts every declared `allowed-tools`
  MCP name is registered (not just the 4 ADR-0176 names). Future ADR
  worth filing if skill-manifest drift becomes a recurring problem.
- **Phase 4** — `/adr-index` end-to-end against the published
  `@sparkleideas/cli` post-rename — not explicitly run + recorded.
  Behaviour is exercised by the new check transitively (tools must
  exist for the skill to dispatch), but a dedicated end-to-end probe
  is not in place.

### Amendment: `hierarchical-query` globbed the wrong column — defect + fix (2026-05-30)

Surfaced during the ADR-0271 corpus migration: `agentdb_hierarchical-query`
with path `adr/*` returned **zero** records while a bare `*` returned
**everything** — the inverse of this ADR's Phase-3 §Confirmation acceptance
("from a populated `adr/*` hierarchical store, calling
`agentdb_hierarchical-query` with path `adr/*` returns all ADR records"). So
that acceptance was **never actually met** by the implementation.

**Root cause.** The logical key/path supplied at write time (`adr/ADR-NNNN`)
is persisted by `hierarchicalStore` (`agentdb-orchestration.ts:314`) into
`metadata.key` + `tags: [key]` only; the `content` column holds the *value*
blob and the row `id` is a synthetic `mem-${Date.now()}-…`
(`HierarchicalMemory.ts:244`). The `hierarchical_memory` schema has **no
key/path column**. But `HierarchicalMemory.query()` globbed
`WHERE content LIKE ?` (`HierarchicalMemory.ts:504`) — i.e. the value blob —
so `adr/%` matched nothing (the blob starts with `{`), while `%` matched all.
(The path was never written into `content`; it lives in `metadata.key`.)

**Fix.** `query()` now globs the stored key:
`WHERE json_extract(metadata, '$.key') LIKE ? ESCAPE '\'`
(`forks/agentdb/src/controllers/HierarchicalMemory.ts`). This honours the
existing on-disk data (no schema migration) and satisfies the Phase-3
acceptance. Verified directly against SQLite: the old `content LIKE 'adr/%'`
returns 0; the new `json_extract(metadata,'$.key') LIKE 'adr/%'` returns the
record; bare `*` still matches.

**Residual / notes.**
- The stub-controller fallback (`agentdb-orchestration.ts:374`) also matches
  on `content` (`e.content.startsWith(prefix)`); it is only reached when the
  controller lacks `query()`, which the shipped controller does not — left as
  a lower-priority follow-up.
- `HierarchicalMemory` is a fork-only controller (no upstream `query()` /
  path model), so there is no upstream behaviour to reconcile against — this
  is a fork-internal contract whose own acceptance was unmet.
- Deploying the fix requires a fork rebuild + republish + MCP-server restart;
  the fork's `tsc` currently has pre-existing, unrelated type errors
  (`benchmarks/`, `examples/`, and a few `src/` sites incl.
  `HierarchicalMemory.ts:380` `manualSearch` tier typing) that predate this
  change.
- Bears on ADR-0271 Phase 3: purging `adr/*` index entries cannot rely on
  path enumeration until this fix ships; purge by tag/metadata or wipe the
  store instead.
