# ADR-0055: NightlyLearner Skill Consolidation + MCP Tool Completion

**Status**: Implemented (v3.5.15-patch.114, 2026-03-22)
**Date**: 2026-03-22
**Deciders**: System Architecture
**Methodology**: SPARC + MADR

---

## S - Specification

### Problem 1: NightlyLearner dead wiring (Issue #6 / #85)

NightlyLearner instantiates SkillLibrary at construction (line 91) but never calls
`consolidateEpisodesIntoSkills()`. Learning episodes accumulate indefinitely without
being distilled into reusable skills. The `run()` pipeline has 6 steps — none invoke
consolidation.

### Problem 2: Missing MCP tools (Issue #13 / #82-91)

The CLI exposes 36 agentdb MCP tools but documentation targets 41. Five tools have
backend methods that exist and are tested but have no MCP tool registration:
`skill-create`, `skill-search`, `learner-run`, `learning-predict`, `experience-record`.

---

## P - Pseudocode

### Fix 1: NightlyLearner wiring

```
run() pipeline:
  Step 1: discoverCausalEdges()      — existing
  Step 2: completeExperiments()      — existing
  Step 3: createExperiments()        — existing
  Step 4: pruneEdges()               — existing
  Step 5: consolidateSkills()        — NEW (non-fatal try/catch)
  Step 6: calculateStats()           — existing (renumbered)
  Step 7: generateRecommendations()  — existing (renumbered)

consolidateSkills():
  try:
    result = this.skillLibrary.consolidateEpisodesIntoSkills({
      minAttempts, minReward, timeWindowDays, extractPatterns
    })
    report.skillsCreated = result.created
    report.skillsUpdated = result.updated
    report.patternsExtracted = result.patterns.length
  catch:
    // Non-fatal — log and continue
```

### Fix 2: MCP tool registration

```
For each missing tool:
  1. Define MCPTool with name, description, inputSchema
  2. handler: getBridge() → bridgeGetController(name) → call method
  3. Wrap in try/catch returning { success: false, error }
  4. Add to agentdbTools export array
```

---

## A - Architecture

### NightlyLearner pipeline (after fix)

```
Episodes table
     │
     ▼
NightlyLearner.run()
  ├── Step 1: Discover causal edges
  ├── Step 2: Complete experiments
  ├── Step 3: Create new experiments
  ├── Step 4: Prune old edges
  ├── Step 5: Consolidate into skills  ←── NEW
  │     └── SkillLibrary.consolidateEpisodesIntoSkills()
  │           └── Extract patterns → Create/update skills table
  ├── Step 6: Calculate stats
  └── Step 7: Generate recommendations
```

### MCP tools (after fix)

36 existing + 5 new = 41 total:

| New tool | Controller | Backend method |
|----------|-----------|---------------|
| `agentdb_skill_create` | skillLibrary | `createSkill()` / `promote()` |
| `agentdb_skill_search` | skillLibrary | `retrieveSkills()` / `searchSkills()` |
| `agentdb_learner_run` | nightlyLearner | `run()` / `consolidate()` |
| `agentdb_learning_predict` | learningSystem | `predict()` / `recommendAlgorithm()` |
| `agentdb_experience_record` | reflexion | `store()` |

### Tool naming convention

All 41 MCP tools use underscores as separators: `agentdb_{feature}_{action}`.
This matches the upstream agentdb MCP server convention. Hyphens were normalized
to underscores in patch.114 (14 legacy tools renamed).

---

## R - Refinement

### Files changed

**Issue #6 (agentic-flow fork)**:
- `packages/agentdb/src/controllers/NightlyLearner.ts`
  - `LearnerReport` interface: +3 fields (skillsCreated, skillsUpdated, patternsExtracted)
  - `run()`: +1 new Step 5 with own try/catch
  - `printReport()`: +3 output lines

**Issue #13 (ruflo fork)**:
- `v3/@claude-flow/cli/src/mcp-tools/agentdb-tools.ts`
  - +5 tool definitions (~200 lines)
  - Export array updated (36 → 41 entries)

### Risk assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Skill consolidation fails | LOW | Own try/catch, non-fatal — remaining steps still run |
| New MCP tools crash | LOW | Each has try/catch returning `{ success: false, error }` |
| Controller not available at runtime | LOW | All tools check controller existence before calling |
| Performance of consolidation in nightly run | LOW | Configurable params, small episode tables in practice |

---

## C - Completion

### Validation

- `tsc --noEmit`: clean on both forks
- `npm run test:unit`: 541/541 pass
- `npm run deploy`: 56/56 acceptance, v3.5.15-patch.114
- All 41 MCP tool names normalized to underscore convention

### Related issues

- #85 (P4-A: SkillLibrary routing) — addressed by NightlyLearner wiring
- #82-91 (controller wiring) — partially addressed by 5 new MCP tools

## Consequences

### Positive

- NightlyLearner now actually consolidates episodes into skills (was dead code since v3 inception)
- 41/41 MCP tools registered — matches documentation
- Skills become searchable and reusable across sessions
- `agentdb_learner-run` lets users trigger the nightly pipeline on demand

### Negative

- Skill consolidation adds latency to the nightly run (~100ms for small episode tables)
- 5 new tools increase the MCP tool surface area (more to maintain)

## Related

- **ADR-0050**: Controller activation — established the deferred init pipeline
- **ADR-0052**: Config-driven embedding — embedding dimensions for skill vectors
- **ADR-0054**: RuVector patch pipeline (proposed) — completes the fork model
