# ADR-0152: 3-way skill drift — reality / USERGUIDE / guidance MCP audit (119 skills surveyed)

- **Status**: Proposed
- **Date**: 2026-05-06
- **Deciders**: Henrik Pettersen
- **Related**: ADR-0148 (skill ↔ MCP tool surface audit), ADR-0149 (guidance MCP coverage gaps — quantified by this ADR), ADR-0151 (per-skill orphan-command decision matrix), ADR-0136 (claudemd-generator plugin/skill discovery)
- **Scope**: Three-way comparison of every skill across (1) on-disk reality, (2) USERGUIDE.md advertisement, (3) live `guidance_*` MCP tool index. Identifies which skills the AI can actually discover via standard channels.

## Context

The AI's discovery surface for ruflo skills runs through three layers:

1. **On-disk reality** — 81 plugin skills + 38 init-bundled skills = 119 total
2. **USERGUIDE.md** — what users (and AIs reading USERGUIDE) are told ruflo can do
3. **`guidance_*` MCP tools** — what the live MCP server says ruflo can do when the AI asks

For an AI to *find and use* a skill, all three layers should agree. ADR-0148 found pockets of drift; ADR-0149 surfaced guidance hallucinations; ADR-0151 catalogued slash-command coverage. This ADR is the consolidated 3-way diff with concrete numbers.

## Methodology

15-agent swarm (2026-05-06):
- **C1-C12** (12 agents): per-skill 3-way compare across 12 chunks of ~10 skills each (119 total). Verdict per skill: IN_SYNC / USERGUIDE_DRIFT / GUIDANCE_DRIFT / TRIPLE_DRIFT / USERGUIDE_PHANTOM / GUIDANCE_PHANTOM
- **C13**: USERGUIDE-only sweep — every skill USERGUIDE advertises, cross-checked against disk reality
- **C14**: guidance-only sweep — every skill/tool guidance recommends, cross-checked against disk + MCP registry
- **C15**: synthesizer (returned early; this ADR's synthesis assembled manually from chunk results)

All findings stored at `/tmp/adr-0152-findings/` (16 files, ~12 KB synthesis).

## Findings

### Headline tally (119 skills)

| Verdict | Count | % |
|---|---|---|
| **IN_SYNC** (all 3 sources agree) | 23 | 19% |
| **USERGUIDE_DRIFT** (real skill, USERGUIDE doesn't list it) | 21 | 18% |
| **GUIDANCE_DRIFT** (real skill, guidance MCP doesn't surface it) | 14 | 12% |
| **TRIPLE_DRIFT** (real skill, neither USERGUIDE nor guidance list it) | **61** | **51%** |
| USERGUIDE_PHANTOM (advertised, doesn't exist) | 0 | 0% |
| GUIDANCE_PHANTOM (recommended by guidance, doesn't exist) | 0 (skills) | 0% |

**Plus separately (different axes — tools and commands, not skills):**

| Class | Count | Source |
|---|---|---|
| Guidance tool phantoms | 39 | C14 |
| Guidance skill phantoms | 1 (`claude-flow-swarm`) | C14 |
| **USERGUIDE command phantoms** | **6** | post-swarm grep (2026-05-06) |

**USERGUIDE command phantoms (6)** — slash-command syntax shown for skills that need Skill-tool invocation (no command file exists):

| USERGUIDE shows | Actually exists as | Right invocation |
|---|---|---|
| `/adr-index` | Skill `ruflo-adr/adr-index` | Skill tool (or `/adr` dispatcher subcommand) |
| `/agentic-jujutsu` | Skill `agentic-jujutsu` | Skill tool only — see ADR-0148 §"Findings — Category C" |
| `/flow-nexus-neural` | Skill `flow-nexus-neural` | Skill tool only |
| `/flow-nexus-platform` | Skill `flow-nexus-platform` | Skill tool only |
| `/flow-nexus-swarm` | Skill `flow-nexus-swarm` | Skill tool only |
| `/hive-mind-advanced` | Skill `hive-mind-advanced` | Skill tool only |

These 6 entries are bugs in USERGUIDE syntax (showing `/...` autocomplete form when no command file exists), not in the underlying functionality (skills exist and are invokable). Five additional grep hits (`/compact`, `/reload-plugins`, `/skill-name`, `/slash-commands`, `/tmp`) are false-positives — Claude Code built-ins or doc placeholders.

Cross-axis comparison:
- USERGUIDE → reality (skills): **0 phantoms** (C13)
- USERGUIDE → reality (commands): **6 phantoms** (this section)
- Guidance → reality (tools): **39 phantoms** (C14)

USERGUIDE is mostly accurate on existence (skills + tools all exist), but conflates skill-invocation form with command-invocation form for 6 entries. This is fixable by either (a) adding `commands/<name>.md` thin-wrapper files for each skill USERGUIDE wants to show as `/<name>`, OR (b) changing USERGUIDE syntax to make the Skill-tool invocation explicit (e.g. `Skill { name: "agentic-jujutsu" }` instead of `/agentic-jujutsu`).

### Asymmetric drift

The drift between layers is sharply asymmetric:

| Direction | Status |
|---|---|
| USERGUIDE → reality | **Clean** — 0 phantoms (everything advertised exists) |
| Reality → USERGUIDE | **80 missing** — entire plugin-skill surface (81 skills × 0% USERGUIDE skill-table coverage) |
| USERGUIDE internal | **Inconsistent** — heading says "42 skills", enumerates 37 |
| Reality → Guidance MCP | **~75 missing** — most plugin skills not in any guidance area |
| Guidance MCP → reality | **Active hallucination** — 39 fake tool names + 1 fake skill |

**USERGUIDE under-promises; Guidance over-promises in misleading ways.** USERGUIDE silence is a documentation gap; guidance hallucination is an active correctness bug because AIs trust its recommendations.

### Per-chunk results

| Chunk | IN_SYNC | UG_DRIFT | G_DRIFT | TRIPLE | Cluster |
|---|---|---|---|---|---|
| c-aa | 5 | 0 | 4 | 1 | All 5 agentdb-* IN_SYNC; flow-nexus + browser missing from guidance |
| c-ab | 7 | 0 | 1 | 2 | hive-mind-advanced + performance-analysis are init-bundle gaps (ADR-0148 C closed) |
| c-ac | 10 | 0 | 0 | 0 | Init reasoningbank + V3-* fully aligned |
| c-ad | 0 | 0 | 8 | 2 | V3 + verification + worker-* in USERGUIDE but absent from guidance |
| c-ae | 0 | 8 | 0 | 2 | aidefence pii-detect/safety-scan TRIPLE; rest plugin-skill USERGUIDE drift |
| c-af | 0 | 0 | 0 | 10 | Entire ruflo-core, cost-tracker, daa, ddd, docs plugin surface |
| c-ag | 1 | 0 | 1 | 8 | doc-gen + federation-* + goals-* TRIPLE |
| c-ah | 0 | 0 | 0 | 10 | intelligence, iot-cognitum, jujutsu, knowledge-graph plugins |
| c-ai | 0 | 3 | 0 | 7 | knowledge-graph + loop-workers names known; market-data, migrations, neural-trader fully invisible |
| c-aj | 0 | 0 | 0 | 10 | rag-memory + plugin skills |
| c-ak | 0 | 10 | 0 | 0 | vector-*, llm-config, rvf, sparc-* plugin skills |
| c-al | 0 | 0 | 0 | 9 | sparc-spec, monitor-stream, tdd-workflow, wasm-*, workflow-* |
| **Total** | **23** | **21** | **14** | **61** |  |

### Top 3 worst-offender plugins (entire surface invisible to docs + guidance)

1. **ruflo-iot-cognitum** — 5 skills, 0 documented anywhere (USERGUIDE or guidance)
2. **ruflo-neural-trader** — 6 skills, 0 documented anywhere
3. **ruflo-rag-memory** — 2 skills + 1 plugin install line in USERGUIDE; skill-level invisible

### Largest single class of drift

**Plugin-shipped skills × 33-plugin marketplace = 81 skills × 100% USERGUIDE-undocumented at skill level.**

USERGUIDE documents the upstream init-bundled "42 skills" tree but never enumerates plugin-shipped skills despite 33 plugins existing. The marketplace section in USERGUIDE (L503-L522) lists install lines for 8 plugins. The remaining 25 plugins have zero per-plugin sections AND zero per-skill mentions.

### Guidance hallucinations (C14 detail)

39 tool phantoms across 13 of 16 guidance areas. Categories:

| Category | Count | Pattern |
|---|---|---|
| Name-format mismatches | 15 | `hooks_pre_task` (real: `hooks_pre-task`), `hive_mind_*` (real: `hive-mind_*`) |
| Whole-area fabrications | 10 | All `security_*` (none exist) + `claims_check/grant/revoke` |
| Wrong-name peers | ~5 | `agent_stop` → `agent_terminate`, `swarm_terminate` → `swarm_shutdown`, `embeddings_embed` → `embeddings_generate` |
| Pure fabrications | ~10 | `agent_metrics`, `swarm_spawn/topology/metrics`, `memory_export/import/compact/namespace`, `analyze_coverage` |

**Clean guidance areas:** only `intelligence-learning`, `performance`, `wasm-agents`, `sparc-methodology` (4 of 16).

## Decision

**Three-prong fix**, gated:

### Prong 1 — USERGUIDE catch-up (doc-only)

Update `docs/USERGUIDE.md`:
- Reconcile "42 skills" heading with reality (currently 119 skills total)
- Add a per-plugin section for the 25 silent plugins
- Add an "All Plugin Skills" table enumerating the 81 plugin skills with their plugin-of-origin
- **Fix the 6 command-syntax phantoms**: either change `/agentic-jujutsu` etc. to explicit Skill-tool invocation OR add the corresponding `commands/<name>.md` wrapper files

This is a doc-only PR (skills) + ~6 thin-wrapper command files (if option (a)). Lifts USERGUIDE_DRIFT (21) and the USERGUIDE-half of TRIPLE_DRIFT (61) → ~80 skills become documented; closes the 6 command phantoms.

### Prong 2 — Guidance MCP autodiscovery (code change, durable fix)

Per ADR-0149 Phase 3: replace hand-curated guidance area data with runtime introspection. At MCP server start, iterate the live tool registry + on-disk skill tree, build areas keyed by tool prefix + plugin name. This eliminates BOTH the GUIDANCE_DRIFT class AND the 39 tool phantoms in one structural fix.

Acceptance: a regression test asserts every guidance-listed tool name byte-matches a registered MCP tool name; same for skills.

### Prong 3 — Per-plugin guidance entries (code change, intermediate fix)

If Prong 2 is too large to ship soon, intermediate fix: hand-curate guidance areas for the 30 missing plugin namespaces (`adr`, `agentdb`, `aidefence`, `autopilot`, `browser`, `core`, `cost-tracker`, `daa`, `ddd`, `docs`, `federation`, `goals`, `hive-mind` (full), `intelligence`, `iot-cognitum`, `jujutsu`, `knowledge-graph`, `loop-workers`, `market-data`, `migrations`, `neural-trader`, `observability`, `plugin-creator`, `rag-memory`, `ruvector`, `ruvllm`, `rvf`, `security-audit`, `sparc`, `swarm`, `testgen`, `wasm`, `workflows`). Plus correct the 39 tool name typos in existing areas.

## Acceptance criteria

- [ ] **Prong 1**: USERGUIDE skill table enumerates ≥119 skills; "42" heading mismatch resolved; 25 silent plugins gain per-plugin sections
- [ ] **Prong 2 OR 3**:
  - Prong 2 path: `guidance-tools.ts` autogenerated; regression test pins zero phantoms
  - Prong 3 path: hand-curated 30 missing areas; all 39 tool name typos corrected
- [ ] Regression test `tests/unit/adr0152-three-way-coverage.test.mjs`: scans all 119 skill names, asserts every name appears in BOTH USERGUIDE.md AND in the in-process guidance tools' tool/skill arrays
- [ ] After fix lands: re-run the C14 hallucination probe; assert 0 phantoms

## Risks

1. **USERGUIDE bloat** — adding 80 skills + 25 plugin sections grows USERGUIDE substantially. Mitigation: USERGUIDE already 7,557 lines; adding ~150 more for full plugin enumeration is proportionate. Use collapsible sections for per-plugin tables to keep scroll cost down.

2. **Autodiscovery quality (Prong 2)** — generating recommend patterns from tool descriptions is heuristic; may produce worse recommendations than hand-curated for edge cases. Mitigation: hybrid — autodiscovery for the area structure + tool list; hand-curated patterns for high-traffic queries.

3. **Drift recurrence** — even after fix, new plugin or new MCP tool ships → guidance index drifts again. Mitigation: Prong 2's regression test catches this at PR-time.

4. **Methodology limits** — chunk agents had varying interpretation of "skill" (some confused with `node_modules` install paths vs fork source paths). Mitigation: counts here treat fork source as canonical; install-side variations are downstream of init logic (ADR-0148 Category C).

## Considered alternatives

### Alternative A — Just fix Prong 1 (USERGUIDE only)

Rejected: leaves the AI's primary discovery channel (`guidance_*` MCP) actively misleading. AIs follow guidance recommendations during normal operation, not USERGUIDE.

### Alternative B — Just fix Prong 2 (guidance only)

Rejected: leaves USERGUIDE under-documented, which affects user-facing onboarding. USERGUIDE is the entry point for new users.

### Alternative C — Delete the misleading guidance entries, no replacement

Replace 39 phantom tool names with `{}`. Rejected: AI gets less help, falls back to LLM training-data assumptions, which are even more wrong than current guidance.

### Alternative D — Defer to ADR-0149's existing plan

ADR-0149 already proposes the Phase 3 autodiscovery fix. This ADR could just be findings + redirect to ADR-0149 for action. Rejected: ADR-0149 is scoped to guidance MCP only; ADR-0152 also catches USERGUIDE drift which is out of ADR-0149's scope. Both are needed.

## Implementation log

(empty — pending decision to proceed)

## References

- ADR-0148 (skill ↔ MCP tool surface audit — Categories A/B/C/D)
- ADR-0149 (guidance MCP coverage gaps — this ADR's Prong 2/3 root)
- ADR-0151 (per-skill orphan-command decision matrix — overlaps the TRIPLE_DRIFT class)
- USERGUIDE.md L503-L522 (marketplace section — 8 install lines for 33 plugins)
- USERGUIDE.md L3970-L4150 (skills system — "42 skills" heading)
- `/tmp/adr-0152-findings/c-{aa..al}.md` (per-chunk swarm reports)
- `/tmp/adr-0152-findings/c13-userguide-phantoms.md` (USERGUIDE-only sweep)
- `/tmp/adr-0152-findings/c14-guidance-hallucinations.md` (guidance-only sweep — 39 phantoms catalogued)
- `/tmp/adr-0152-findings/c15-master-synthesis.md` (this ADR's source synthesis)
