# ADR-0149: Guidance MCP coverage gaps — `guidance_*` is significantly out of sync with actual MCP/plugin surface

- **Status**: Proposed (severity quantified 2026-05-06 via 15-agent ADR-0152 swarm)
- **Date**: 2026-05-06
- **Deciders**: Henrik Pettersen
- **Related**: ADR-0148 (skill ↔ MCP tool surface audit — Category D split-off), ADR-0152 (3-way reality/USERGUIDE/guidance drift audit — quantifies guidance hallucination rate), ADR-0117 (mcp__ruflo__ namespace), ADR-0136 (claudemd-generator plugin/skill discovery)
- **Scope**: All `guidance_*` MCP tools — `guidance_capabilities`, `guidance_recommend`, `guidance_workflow`, `guidance_quickref`, `guidance_discover`. Their data files / hardcoded indexes / prompt templates that drive what the AI is told about ruflo's surface.

## Context

ADR-0148's S5 stripe (3 agents probing `guidance_*` for 16 categories) found that the guidance system is the AI's primary self-discovery surface — when an AI is asked "what can ruflo do for X?" or "which tool should I use to Y?", these tools answer.

But the guidance index is **frozen** at an early ruflo state. The audit found:

### S5-A1 — memory/agentdb/swarm/agent/task probes

| Category | Coverage | Issues |
|---|---|---|
| `memory` | covered (capabilities + recommend + workflow + quickref) | Guidance lists 11 tools / 2 agents / 5 skills; mentions `memory_export`/`memory_import`/`memory_namespace`/`memory_compact` which don't exist server-side |
| `agentdb` | **ZERO direct coverage** despite ~50 `agentdb_*` MCP tools shipping | Largest dedicated-namespace gap — no `area`, no `recommend` pattern, no `workflow`, no `quickref` |
| `swarm` | covered via `swarm-orchestration` + `hive-mind` | Naming mismatches: guidance says `swarm_terminate`, actual is `swarm_shutdown`; says `hive_mind_*` underscore, actual is `hive-mind_*` dash |
| `agent` | area exists with 8 tools / 5 agent types | `skills: []` empty; no recommend/workflow/quickref patterns; says `agent_stop`, actual is `agent_terminate` |
| `task` | **ZERO coverage** | 8 `task_*` MCP tools live, but no area/recommend/workflow/quickref |

### S5-A2 — hooks/hive-mind/aidefence/federation/knowledge-graph probes

- 16 areas indexed; only **2 of 5** probed categories exist (`hooks-automation`, `hive-mind`)
- 3 categories return `Unknown area: <name>`: `aidefence`, `federation`, `knowledge-graph` — despite implementations existing at the plugin/MCP level
- `recommend()` returns FAKE tool names: `hive_mind_propose`, `hive_mind_vote`, `hive_mind_init` (underscore) — actual is `hive-mind_*` dash, AND there are no propose/vote tools at all
- `recommend()` keyword matcher only fires for "hive-mind"; "hooks", "aidefence", "federation", "knowledge-graph" all fall through to generic fallback. "federation" mis-routes to `security` area
- workflow enum (14 types) has no entries for: `aidefence`, `federation`, `knowledge-graph`, `hive-mind`, `embeddings`, `wasm`, `ruvllm`, `sparc`, `config`
- `hooks-automation` has zero agents indexed despite having 17 commands

### S5-A3 — neural/ruvector/ruvllm/rvf/observability/workflows probes

- **None of the 6 requested category names are valid `area` values** — all return `Unknown area`
- `guidance_workflow` enum lacks 5 of 6 categories
- `guidance_quickref` has zero domains for any of the 6
- `guidance_recommend` patterns are sparse: only "use neural" matched (intelligence-learning); 5 others returned generic fallback
- Largest blind spots: **observability has zero surface**, **RVF has zero surface**, **ruvllm-inference area has empty agents/skills/commands arrays** and surfaces only 6 of 9 actual `mcp__ruflo__ruvllm_*` tools

## Severity (quantified by ADR-0152 swarm 2026-05-06)

C14 (one of 15 ADR-0152 agents) probed `guidance_capabilities` across all 16 hardcoded areas + cross-referenced every recommended tool/skill name against the live MCP server registry (284 tools) and on-disk skill set (119 skills). Concrete numbers:

| Phantom class | Count | Example |
|---|---|---|
| **Total tool phantoms** | **39** | (~14% of registered MCP tools have a hallucinated alias in guidance) |
| Name-format mismatches | 15 | guidance: `hooks_pre_task`; real: `hooks_pre-task` (4× hooks family); `hive_mind_*` underscore vs real `hive-mind_*` dash (3 entries) |
| Whole-area fabrications | 10 | guidance lists 6 `security_*` tools (none registered) + `claims_check/grant/revoke` (registry has only `claims_list`) |
| Wrong-name peers | ~5 | guidance: `agent_stop`, real: `agent_terminate`; guidance: `swarm_terminate`, real: `swarm_shutdown`; guidance: `embeddings_embed`, real: `embeddings_generate`; guidance: `session_start/end`, real: `session_save/restore` |
| Pure fabrications | ~10 | `agent_metrics`, `agent_logs`, `swarm_spawn/topology/metrics`, `memory_init/export/import/compact/namespace`, `analyze_coverage/graph` |
| **Skill phantoms** | **1** | guidance lists `claude-flow-swarm` in `swarm-orchestration` area; not on disk |

**Clean areas (no phantoms):** `intelligence-learning` (5/5 real), `performance` (5/5 real), `wasm-agents` (10/10 real), `sparc-methodology` (no tools claimed). Only **3 of 16** guidance areas are fully clean.

ADR-0152 also confirmed the missing-areas problem (originally hypothesized by S5-A2/S5-A3): probing 16 plugin categories reveals **3 categories return `Unknown area:`** despite implementations existing — `aidefence`, `federation`, `knowledge-graph`. Plus 6 more categories in S5-A3's probe (`neural`, `ruvector`, `ruvllm`, `rvf`, `observability`, `workflows`) have either no area key or empty agents/skills/commands arrays.

The 14% phantom rate is significant: an AI calling `guidance_recommend` and trusting the response will issue `MCP tool not found` errors ~1 time in 7. ADR-0148 catalogued the same phantoms downstream as missing handlers; this ADR catalogues them upstream as misleading guidance.

## The contract this breaks

When an AI calls `mcp__ruflo__guidance_capabilities { category: 'aidefence' }` and receives `Unknown area: aidefence`, the AI's natural fallback is "this category doesn't exist; don't suggest it." But aidefence DOES exist, with 6 working MCP tools. The guidance system is **actively misleading** the AI away from real capabilities.

Same for the wrong tool names in `recommend()`: an AI told to call `hive_mind_propose` will hit "MCP tool not found" — the same failure class ADR-0148 catalogues. Guidance is generating new instances of the same gap type.

## Decision

**Three-phase fix** to align the guidance index with reality, gated:

### Phase 1 — Inventory the guidance data sources

Find where guidance content lives:

| Phase 1 deliverable | Output |
|---|---|
| Locate the `area` registry | Likely a hardcoded list in `mcp-tools/guidance-tools.ts` or a JSON data file imported by it |
| Locate the `recommend` keyword→pattern map | Same file or a sibling `guidance-patterns.json` |
| Locate the `workflow` enum + `quickref` topics | Same |
| Trace how each is generated/maintained | Are they hand-written? Auto-generated from MCP server reflection? Imported from upstream? |

This phase is research only. Output: a single audit doc at `/tmp/adr-0149-findings/data-sources.md`.

### Phase 2 — Add 14 missing areas to the guidance index

Based on S5 findings, the guidance system needs entries for:

**ZERO-COVERAGE namespaces (need full area + recommend + workflow + quickref):**
- agentdb
- task
- aidefence
- federation
- knowledge-graph
- observability
- rvf
- workflows

**PARTIAL-COVERAGE (need fixes, not full creation):**
- agent (skills:[] → populate; rename `agent_stop` → `agent_terminate`)
- swarm (rename `swarm_terminate` → `swarm_shutdown`)
- hive-mind (drop fake `hive_mind_propose`/`hive_mind_vote`; rename `hive_mind_*` → `hive-mind_*`)
- hooks-automation (populate agents)
- ruvllm-inference (populate empty arrays; add 3 missing tools)
- intelligence-learning (already covered for `neural`; verify completeness)
- memory (drop refs to non-existent tools `memory_export`/`memory_import`/`memory_namespace`/`memory_compact`; align with ADR-0148 alias decisions)

### Phase 3 — Auto-discovery (long-term)

The root cause of guidance drift is hand-curated data falling out of sync with the auto-evolving MCP tool registry. Long-term, generate the guidance index from runtime introspection:

```
At MCP server start:
  for each tool registered: emit category from name prefix (`memory_*`, `agentdb_*`, `aidefence_*`, ...)
  build area index keyed by prefix
  build recommend patterns from tool descriptions (NLP keyword → tool match)
  expose via guidance_* tools
```

This eliminates the drift class entirely. Acceptance: after adding/removing any MCP tool, `guidance_*` reflects the change without a manual data-file edit.

## Acceptance criteria

- [ ] Phase 1: data sources catalogued in `/tmp/adr-0149-findings/data-sources.md`
- [ ] Phase 2: every category that has a corresponding plugin OR MCP tool prefix has a guidance area
- [ ] Phase 2: zero `Unknown area:` errors for any plugin name (test: probe each `ruflo-*` plugin's name as `category:`)
- [ ] Phase 2: `guidance_recommend` returns tool names that match the registered MCP tool names byte-for-byte (no underscore-vs-dash mismatches; no fake `propose`/`vote`)
- [ ] Phase 3 (deferred): automated drift detector — a unit test that scans every guidance area's `tools:` array and asserts every name is in the live MCP server's tool registry
- [ ] Acceptance test in `tests/unit/adr0149-guidance-coverage.test.mjs`

## Risks

1. **Phase 2 churn surface** — fixing 14 areas requires editing potentially-large hand-curated data structures. Each rename touches multiple fields (tool name, category list, recommend pattern, workflow enum). Risk: introduce new typos while fixing old ones. Mitigation: Phase 3's auto-discovery test would have caught both classes; consider implementing the test even if auto-discovery generation is deferred.

2. **Auto-discovery quality** — generating recommend patterns from tool descriptions is heuristic; may produce worse recommendations than hand-curated ones for edge cases. Mitigation: hybrid — auto-discovery generates the baseline, human-curated overrides remain for high-traffic patterns (e.g. `memory` has 11 hand-curated tool entries; auto-discovery would generate fewer but possibly less helpful ones).

3. **AI adoption inertia** — even after fixes ship, sessions cached on the old guidance state may keep recommending wrong tool names. Mitigation: documented "guidance reload after MCP restart" — same as plugin reload.

## Considered alternatives

### Alternative A — Just delete `guidance_*` tools

Rejected: AI's primary self-discovery surface. Removing leaves a worse hole — AI defaults to generic-LLM training-data assumptions about what ruflo can do, which are even more wrong than today's misaligned guidance.

### Alternative B — Replace guidance with documentation links

Each `guidance_*` call returns "see USERGUIDE.md §X". Rejected: USERGUIDE is 7,557 lines; AI fetching 7K lines per discovery query is wasteful. Curated guidance is the right shape; just needs to be accurate.

### Alternative C — Hand-curated fix-once, no Phase 3

Just do Phase 2 and call it done. Rejected: drift will recur every time a new MCP tool ships (which happens monthly per fork pace). Phase 3 (auto-discovery) is the durable fix.

## Implementation log

(empty — pending Phase 1 inventory)

## References

- ADR-0148 §"Findings — Category D" (parent ADR; this is the split-off)
- ADR-0136 (claudemd-generator plugin/skill discovery — broader context for AI self-discovery)
- ADR-0117 (mcp__ruflo__ namespace — source of underscore-vs-dash issues)
- `/tmp/adr-0148-findings/s5-a1.md`, `s5-a2.md`, `s5-a3.md` (S5 swarm probes — raw data)
- `mcp-tools/guidance-tools.ts` (Phase 1 starting point)
