# Batch-U Disposition — Slice C (graph / rvagent / nested-agents)

ADR-0313 upstream-sync disposition analysis. Slice C = the three LARGE feature
integrations: graph intelligence backend (upstream ADR-130), rvagent integration
(upstream ADR-129), nested-subagent infrastructure (upstream ADR-147).

**READ-ONLY analysis.** No fork source modified. Upstream content read via
`git show <SHA>` in `/Users/henrik/source/forks/ruflo` (fresh-upstream rule).
Fork current state = working tree on `main` (= OUR fork, branched at merge-base
`43c8fd7`, currently `3.7.0-alpha.11-patch.436`; none of these commits are
ancestors of fork HEAD).

## Headline finding

The fork has **already integrated all three feature families** — but as
**re-numbered, hand-ported fork-native ADRs in a different repo layout**
(`v3/@claude-flow/...`, `plugins/ruflo-*/`), not at upstream's `src/...` paths:

| Upstream feature | Fork equivalent | Status in fork |
|---|---|---|
| ADR-129 rvagent full integration | upstream-numbered ADR-129 hand-port + fork ADR-0266 (gallery CRUD) + ADR-0256 (plugin bridge) + ADR-0295 W1/W2 (echo-shape fix, **fork ahead**) | Fully present |
| ADR-130 unified graph backend (P1–P6) | **fork-native ADR-0261** (+ ADR-0294 R1 `graph_edges` write restore) — `agentdb_graph-query`/`graph-pathfinder` (same 6 algos), trajectory hooks, GraphEdgesSource plugin adapter; PQ via `agentdb/encoders/scalar-int8-encoder` instead of upstream's standalone `embedding-quantization.ts` | Fully present (variant) |
| ADR-147 P2 memory entity arm | **GAP** — fork has ADR-125-Phase-5 RRF+MMR `hybridSearch` but no `entity-tagger.ts` / no entity arm / no `signals` provenance | Missing → HAND-PORT |
| ADR-147 nested-subagent infra | **GAP** — no ADR-147 doc, no `nested-*` agents in `plugins/ruflo-agent/` | Missing → HAND-PORT (branding-sensitive) |

Net: the two big self-contained backends (rvagent, graph) are SUPERSEDED/already
in the fork; only the two newest ADR-147 pieces (entity arm + nested agents) are
genuine candidate ports; all version/CI commits are own-policy SKIPs.

## Disposition table

| SHA | type(area) | subject | VERDICT | rationale + fork-evidence | target files / port-approach + size |
|---|---|---|---|---|---|
| f5a180423 | feat(agents) | ADR-147 nested subagent (depth=5) infra + P2 stage 1 (#2336) | **HAND-PORT** | Genuine gap: no ADR-147 doc in fork, no `nested-*` agents under `plugins/ruflo-agent/agents/` (dir absent). Self-contained: 4 agent `.md` defs + a SKILL.md, each carrying a `tools:` frontmatter so spawned children inherit CC 2.1.169 `hasTaskTool`. BUT heavily branding-coupled (upstream `ruflo-agent` plugin, `swarm_init`/`hive-mind_spawn` MCP names, CLAUDE.md queen-coordinator rewrite) → must rebrand to fork plugin layout + `mcp__ruflo__*`. **Flag for queen**: plugin/agent-definition work, not core code; depth-cap guard (P3) is behind `CLAUDE_FLOW_STRICT_NESTING` and may collide with fork's own agent-orchestration ADRs (0098/0115). | `plugins/ruflo-agent/agents/nested-*.md` (+ `nested-queen` wired to ruflo MCP), `plugins/ruflo-agent/skills/nested-subagents/SKILL.md`, optional depth-guard in fork hooks. Rebrand required. **Size M** |
| 568193917 | chore(release) | 3.10.39 — ADR-147 entity arm + signal provenance (#2317 #2327) | **SKIP-by-policy** | Pure version bump + lockfile regen (`package.json`, `ruflo/package.json`, `v3/@claude-flow/cli|memory/package.json`, `package-lock.json`, `v3/pnpm-lock.yaml`). Fork owns versioning/release/CI (ADR-0302). | none |
| b099b705f | feat(memory) | ADR-147 entity arm + signal provenance in hybridSearch (#2327) | **HAND-PORT** | Genuine gap: fork has NO `entity-tagger.ts`; fork `hybridSearch` (controller-registry.ts:1371, "ADR-125 Phase 5") fuses only dense+sparse via `applyRRF([dense,sparse],60)`+`applyMMR`, no `signals`. Clean port: fork `applyRRF(rankedLists: SearchCandidate[][])` already takes N arms, and the fork case has the identical `toCands`/RRF/MMR skeleton the upstream diff edits. New files drop in verbatim; the one `hybridSearch` case is a hand-edit (fork carries extra ADR-0068-W4-3 supersession context around it, so not a clean cherry-pick). Re-home under fork's hybridSearch ADR lineage (ADR-125 P5), not "ADR-147 P2". | `v3/@claude-flow/memory/src/entity-tagger.ts` (+`.test.ts`) NEW verbatim; rework `controller-registry.ts` `hybridSearch` case to 3-arm + `signals`; `graceful-retrieval.test.ts` deltas. **Size S** |
| 6efe68fa1 | docs(adr) | ADR-129 status → Accepted + Gap 2 record (#2201) | **SKIP-fork-ahead** | Upstream ADR-129 doc lifecycle update only (`v3/docs/adr/ADR-129-rvagent-full-integration.md`, +24 lines). Fork already carries its own ADR-129 status doc (`20affc11e docs(adr): ADR-129 status → Accepted`) and the impl is live + extended (ADR-0266/0295). Upstream's record adds nothing the fork lacks. | none |
| 60f37f2d3 | fix(ci) | graph benchmark process.exit — kill 40-min hang (#2148) | **SKIP-fork-ahead** | One-line `process.exit(0)` in `scripts/benchmark-graph.mjs` — a file the fork **does not have** (fork's graph backend = ADR-0261 with no upstream `benchmark-graph.mjs`/`smoke-graph-*`/graph-benchmark CI job; confirmed absent). Real bug, but on a script outside fork scope. | none (no target file in fork) |
| 10086c4bb | ci | timeout-minutes: 40 on graph-benchmark job (ADR-130 P6) | **SKIP-by-policy** | Adds `timeout-minutes: 40` to `graph-benchmark` job in upstream `.github/workflows/v3-ci.yml`. Fork owns its CI (ADR-0302) and has no `graph-benchmark` job (grep of fork `.github` for graph-benchmark = empty). | none |
| e1bd1f072 | chore | bump all packages to 3.10.0 — ADR-130 P4+P5+P6 | **SKIP-by-policy** | Pure version bump (3 `package.json`). Fork owns versioning (ADR-0302). | none |
| 16810c3e2 | fix(bench) | ADR-130 P6 — CI-friendly single-session benchmark | **SKIP-fork-ahead** | Rewrites `scripts/benchmark-graph.mjs` (single-session inserts) — file absent in fork. Fork's ADR-0261 graph backend has its own (non-upstream) verification path. | none (no target file in fork) |
| edde98f9e | feat(graph) | ADR-130 — unified graph intelligence backend (P1–P6) (#2129) | **SUPERSEDE** | LARGE upstream feature, but fork already ships the full equivalent as **fork-native ADR-0261** (+ ADR-0294 R1). Evidence: `agentdb-tools.ts:2564` "ADR-0261: agentdb_graph-query and agentdb_graph-pathfinder … Algorithm logic is verbatim from upstream's agentdb-tools.ts"; graph-query tool desc "(ADR-0261, fork-native ADR-130)"; pathfinder ships the same 6 algos (dynamic-mincut, spectral-sparsify, temporal-centrality, connected-component-churn, witness-chain-divergence); P3 trajectory hooks `reinforced-by`/`trajectory-caused` in `hooks-tools.ts` ("ADR-0261 (fork-native ADR-130) Phase 3"); P4 `GraphEdgesSource`/`createAutoGraphAdapter` in `plugins/ruflo-knowledge-graph`. P1 PQ differs by design: fork uses `agentdb/encoders/scalar-int8-encoder` (`inlineCosine`/`decodeEmbedding`), NOT upstream's standalone `embedding-quantization.ts` (agentdb-tools.ts:2583 "which the fork doesn't have"). A PICK would clobber the fork's encoder-based + different-layout implementation. | none (fork-native ADR-0261/0294 owns this surface) |
| 542481053 | docs(adr) | #ADR-130 — graph intelligence + improvement roadmap | **SUPERSEDE** | The 420-line ADR-130 proposal/roadmap doc. Fork re-authored this decision as fork-native ADR-0261 (with its own encoder/layout choices). Upstream doc would conflict with the fork's ADR numbering + content. The IMPROVEMENT-ROADMAP items are upstream-internal (issue refs #1872/#2047/#2105 etc.) and not fork backlog. | none |
| bf0f505c9 | chore(release) | v3.8.0 — ADR-129 rvagent full integration | **SKIP-by-policy** | Pure version bump (3 `package.json`). Fork owns versioning (ADR-0302). | none |
| 47a7825b0 | feat(rvagent) | #ADR-129 — full rvagent integration (4 phases) (#2123) | **SKIP-fork-ahead** | LARGE feature already in the fork (hand-ported, not by SHA). Evidence: fork `ruvector/agent-wasm.ts` has all P1–P4 markers — `JsModelProvider`+`callAnthropicMessages` (P1 echo→Anthropic), `buildRvfContainer({mcpTools})`→`builder.addMcpTools()` ("ADR-129 P2", line 471), `buildRvfFromTemplate`/`loadRvf`; fork command surface adds the 16 MCP tools via ADR-0266; plugin bridge via ADR-0256. Fork is AHEAD: ADR-0295 W1/W2 (`9dbd55d1a`) fixes the live `@ruvector/rvagent-wasm` echo-as-object shape skew upstream's P1 doesn't handle. A PICK/HAND-PORT would regress fork-ahead code. | none (fork already integrated; fork ahead via ADR-0295) |

## PICK / HAND-PORT details

No PICKs. Two HAND-PORTs.

### HP-1 — b099b705f — memory entity arm + signal provenance (Size S, LOW risk)

The only clean, low-risk gap in the slice.

- **What lands:** entity matching as a 3rd RRF arm in `hybridSearch` + per-result
  `signals: ('vector'|'bm25'|'entity')[]` provenance.
- **Why portable:** fork `smart-retrieval.ts` `applyRRF(rankedLists: SearchCandidate[][])`
  already accepts an arbitrary number of arms; the fork `hybridSearch` case
  (`v3/@claude-flow/memory/src/controller-registry.ts:1371`) has the SAME
  `toCands` → `applyRRF([dense,sparse],60)` → `applyMMR(...,0.7)` skeleton that
  the upstream diff modifies. So: drop in `entity-tagger.ts` + `entity-tagger.test.ts`
  verbatim, and hand-edit the single `hybridSearch` case to (a) gate an entity arm
  on `extractEntities(query)`, (b) run the three arms via `Promise.all` with
  per-arm `.catch(()=>[])`, (c) stamp `signals` from per-arm id-sets.
- **Fork-specific care:** the fork's case carries extra ADR-0068-W4-3 supersession
  comments and a separate pre-existing BM25+HNSW path (line 1511) — hand-edit, do
  NOT `git apply`. Re-label as the fork's hybridSearch ADR (ADR-125 Phase 5
  continuation), NOT "ADR-147 P2" (ADR-147 is upstream's nested-agents number;
  in the fork that number is free/unused — avoid collision).
- **Verify:** the upstream capability smoke (Alice-Smith needle ranks #1 with all
  3 signals, ~47% RRF gap) — re-home under fork acceptance, do NOT run as a manual
  one-off (`feedback-always-wire-tests-into-cicd`).
- **Targets:** `v3/@claude-flow/memory/src/entity-tagger.ts` (NEW),
  `…/entity-tagger.test.ts` (NEW), `…/controller-registry.ts` (edit hybridSearch
  case), `…/graceful-retrieval.test.ts` (delta).

### HP-2 — f5a180423 — ADR-147 nested-subagent infrastructure (Size M, MEDIUM risk) — FLAG FOR QUEEN

- **What lands:** 4 agent definitions (`nested-coordinator`/`nested-researcher`/
  `nested-reviewer`/`nested-leaf`) each with explicit `tools:` frontmatter (the
  bit that lets CC 2.1.169 propagate `hasTaskTool` to spawned children), a
  `nested-queen` wired to the swarm/hive-mind/intelligence stack, a SKILL.md, and
  (P2 stage 1) capturing `parent_agent_id` into AgentDB on post-task.
- **Why genuine gap:** no ADR-147 doc, no `nested-*` agents in
  `plugins/ruflo-agent/agents/` (dir absent), no fork analog found.
- **Why M not S / why flag:**
  - Heavy **branding coupling** — upstream targets its `ruflo-agent` plugin,
    references `swarm_init`/`hive-mind_spawn` and `mcp__claude-flow__*`, and
    rewrites CLAUDE.md's queen-coordinator pattern. All must be rebranded to the
    fork's plugin layout + `mcp__ruflo__*` + ruflo CLAUDE.md (ADR-0301).
  - The `nested-queen` definition wires into ruflo's existing machinery
    (`hooks_intelligence_*` RETRIEVE→JUDGE→DISTILL→CONSOLIDATE, `coordination_consensus`)
    — needs reconciling with the fork's own agent-orchestration ADRs (0098 anti-
    reflexive-swarm, 0115 hive-mind carve-out) so it doesn't contradict them.
  - The P3 depth-cap guard (cap=4 behind `CLAUDE_FLOW_STRICT_NESTING`) is only
    "stage 1" upstream; porting partial multi-stage infra risks half-wired state.
  - This is agent-definition/plugin/doc work (not core code), so blast radius is
    contained, but the rebrand + ADR-reconciliation is judgment-heavy → **queen
    should confirm scope** (port now vs. author a fork-native nested-agents ADR
    that cherry-picks just the `tools:`-frontmatter mechanism).
- **Targets (post-rebrand):** `plugins/ruflo-agent/agents/nested-*.md`,
  `plugins/ruflo-agent/skills/nested-subagents/SKILL.md`, post-task
  `parent_agent_id` capture in fork hooks, a fork-native ADR to govern it.

## Per-verdict counts (12 total)

- PICK: 0
- HAND-PORT: 2 (b099b705f, f5a180423)
- SUPERSEDE: 2 (edde98f9e, 542481053)
- SKIP-fork-ahead: 4 (47a7825b0, 6efe68fa1, 60f37f2d3, 16810c3e2)
- SKIP-by-policy: 4 (568193917, 10086c4bb, e1bd1f072, bf0f505c9)
- SKIP-merge: 0
