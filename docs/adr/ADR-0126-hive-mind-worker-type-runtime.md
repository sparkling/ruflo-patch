# ADR-0126: Hive-mind worker-type runtime differentiation (T8)

- **Status**: **Implemented (2026-05-03)** per ADR-0118 §Status (T8 complete).
- **Date**: 2026-05-02
- **Deciders**: Henrik Pettersen
- **Depends on**: ADR-0116 (hive-mind marketplace plugin — verification matrix supplies the gap row this ADR closes), ADR-0118 (runtime gaps tracker — task definition and escalation criteria), ADR-0125 (T7 queen-type prompts — queen prompts and worker prompts must reference each other consistently)
- **Related**: ADR-0114 (substrate/protocol/execution layering — worker behaviour lives in execution layer)
- **Scope**: Fork-side runtime work in `forks/ruflo/v3/@claude-flow/cli/src/commands/hive-mind.ts` (queen-prompt prose blocks) and `forks/ruflo/v3/@claude-flow/swarm/src/queen-coordinator.ts` (`typeMatches` rows + capability-score nudges). Per `feedback-patches-in-fork.md`, USERGUIDE-promised features that don't work are bugs and bugs are fixed in fork. Out of scope: per-worker subagent prompt template (no such template exists in fork source — the queen-LLM holds the Task-tool spawn site).

## Context

ADR-0116's verification matrix flagged "8 Worker types" as ⚠ partial: the documented catalog ships in the `AgentType` union (`forks/ruflo/v3/@claude-flow/swarm/src/types.ts:78-91` carries all 8) and 6 of 8 types appear in the in-process `QueenCoordinator` task-routing table, but only 4 types receive capability-score nudges and the queen's spawn prompt addresses the worker pool only as a count summary, not by type-specific role. Per `reference-ruflo-architecture` memory, ruflo orchestrates and the local `claude` CLI executes — so "differentiation" lives in the prose the queen prompt feeds the LLM about each worker type, plus the scoring inside `QueenCoordinator` that picks workers for in-process tasks.

Empirical state in the fork (verified against current `sparkling/main`):

| Surface | Path | Current behaviour |
|---|---|---|
| Worker-type enum | `forks/ruflo/v3/@claude-flow/swarm/src/types.ts:78-91` | All 8 USERGUIDE types present in `AgentType` union (plus `coordinator`, `monitor`, `specialist`, `queen`, `worker`) |
| Queen-prompt worker block | `forks/ruflo/v3/@claude-flow/cli/src/commands/hive-mind.ts:94-95` | `WORKER DISTRIBUTION:` lists `${type}: ${count} agents` per type — count-only, no per-type role prose |
| Worker grouping helper | `forks/ruflo/v3/@claude-flow/cli/src/commands/hive-mind.ts:49-59` | `groupWorkersByType` buckets workers; output feeds `WORKER DISTRIBUTION` plus `workerTypes` enumeration in the prompt |
| Task-type → agent-type table | `forks/ruflo/v3/@claude-flow/swarm/src/queen-coordinator.ts:1234-1244` | `typeMatches` covers 6 of 8 USERGUIDE worker types (`researcher`, `analyst`, `coder`, `tester`, `reviewer`, `documenter`); missing `architect` and `optimizer` |
| Capability-score nudges | `forks/ruflo/v3/@claude-flow/swarm/src/queen-coordinator.ts:1253-1256` | 4 `task.type === 'X' && caps.Y` branches for `coding`/`review`/`testing`/`coordination` — `research`/`analysis`/`documentation` task types match via `typeMatches` but get no extra nudge |
| Worker subagent spawn | (none in source) | Workers are spawned by the queen-LLM through Claude Code's Task tool inside the launched session; no per-worker prompt template lives in fork source |

USERGUIDE block `**Worker Specializations (8 types):**` advertises: researcher, coder, analyst, tester, architect, reviewer, optimizer, documenter. Two gaps follow: (i) `architect` and `optimizer` are absent from `typeMatches`, so the `QueenCoordinator` cannot route any task type to them via the existing match path; (ii) no surface in fork source describes per-type role behaviour to the queen-LLM — workers appear only as `${type}: ${count} agents` lines, leaving the queen-LLM to invent role behaviour at Task-tool spawn time without anchor text.

T8 in ADR-0118 closes this row. T8 depends on T7 (ADR-0125) because ADR-0125 introduces queen-type prompt sentinels (planning-first / execution-first / mode-switch) that worker-type prose cites, so each worker block can reference the queen-type currently coordinating; without T7, the cross-reference substring resolves to an empty value and the cross-check test fails loudly.

**Out of scope for T8.** This ADR does not introduce a per-worker subagent prompt template — none exists in source today, and adding one would require re-architecting how `commands/hive-mind.ts` spawns Claude Code (the queen-LLM, not fork code, holds the Task-tool spawn site). The queen-prompt prose change here is the surface that anchors what workers do; if a fork-side per-worker template ever becomes warranted, it is a follow-up ADR.

## Decision Drivers

- USERGUIDE block `**Worker Specializations (8 types):**` is the contract surface; the queen prompt must describe role behaviour for all 8 types, and the in-process `QueenCoordinator` routing must reach all 8 — neither holds today
- `typeMatches` at `queen-coordinator.ts:1234-1244` covers 6 of 8 USERGUIDE worker types (researcher, analyst, coder, tester, reviewer, documenter via the corresponding `TaskType`s); `architect` and `optimizer` cannot be selected by any task type
- Capability-score nudges at `queen-coordinator.ts:1253-1256` cover only `coding`, `review`, `testing`, `coordination` — five USERGUIDE types (researcher, analyst, architect, optimizer, documenter) get no extra nudge even when `typeMatches` does direct a task to them
- The queen prompt's `WORKER DISTRIBUTION:` line at `commands/hive-mind.ts:94-95` is count-only — it gives the queen-LLM no per-type role prose to anchor Task-tool worker invocations against
- Per `reference-ruflo-architecture` memory, the `claude` CLI is the executor and the queen-LLM (not fork code) holds the Task-tool spawn site — the only fork-side surface that can shape worker behaviour is the queen prompt prose plus `QueenCoordinator` scoring
- T7 (ADR-0125) cross-reference: ADR-0125 introduces per-queen-type sentinel substrings (mission framing, preferred MCP tools, self-monitor checks); worker-type prose must cite those sentinels so the queen-LLM steers workers consistently with its own active mode
- ADR-0114 layering: worker-type prose and `QueenCoordinator` scoring are both execution-layer (LLM-facing strings + intra-coordinator routing); no protocol-layer (consensus/topology) change is required
- `feedback-no-fallbacks.md`: the existing `score = 0.5` baseline at `queen-coordinator.ts:1230-1259` silently routes non-matching agents when the pool has zero agents of the matching type; this is the silent-fallback shape the memory forbids. T8 must throw at the scoring site so the queen sees the empty-pool condition rather than absorbing it into a downstream task failure

## Considered Options

- **(a) Per-worker inline branches + per-worker prose blocks in the queen prompt** — chosen. Extend `typeMatches` to cover all 8 types, add 4 missing capability-score nudges in `QueenCoordinator`, and emit one prose block per worker type in `generateHiveMindPrompt`.
- **(b) Scoring matrix in config table loaded at startup** — externalise the type→task-type and type→nudge-keyword mappings into a TOML/JSON loaded by `queen-coordinator`; queen-prompt prose still inline.

## Pros and Cons of the Options

### (a) Per-worker inline branches + per-worker prose blocks

- Pros: deterministic and debuggable (every change is grep-able source); mirrors USERGUIDE catalog 1:1; matches existing inline-branch pattern at `queen-coordinator.ts:1234-1256`; matches T7 (ADR-0125) inline strategy, keeping queen-side and worker-side surfaces symmetric; tests can iterate the existing `AgentType` union parametrically; fails loudly on unknown types via `default:` throw per `feedback-no-fallbacks.md`
- Cons: changing any worker's role prose, task-type mapping, or `task.type` literal requires a code edit and re-publish through the cascade — no operator-facing tunability; eight prose blocks plus eight nudge branches plus eight `typeMatches` rows is a coupled set with no central spec, so blocks can drift apart structurally (mitigated by the structural-contract test in §Validation, not eliminated); routing correctness depends entirely on callers passing the right `task.type` literal — there is no description-classifier in fork source, so a miscategorising caller silently routes to the wrong worker until the literal is corrected; no learning loop — if routing is wrong in practice the system does not self-correct; multi-match (option-b co-placement) requires the explicit highest-score-wins + tiebreak rule documented in §Refinement

### (b) Scoring matrix in config table

- Pros: behaviour edits don't require a code change or cascade re-publish — operators can re-tune trigger keywords or task-type bindings by editing one file; worker→keyword and worker→task-type mapping is visible in one place; supports designer/non-engineer iteration on routing without touching TypeScript; queen-prompt prose can stay inline so the queen-LLM still gets stable anchor text
- Cons: adds a config surface that must be init-template-generated, schema-validated, and version-pinned alongside fork releases; missing or malformed rows must fail loudly per `feedback-no-fallbacks.md` (no silent default-routing fallback), which converts "edit a file" simplicity into "edit a file and re-validate the schema"; asymmetric with T7's inline strategy — splitting routing data across two surfaces (config table for workers, inline switch for queen) widens the cross-reference contract; init template must learn how to render the config and acceptance must verify it

## Decision Outcome

**Chosen option: (a) per-worker inline branches + per-worker prose blocks**, because it is the minimum change that closes the matrix row, mirrors the existing inline-table pattern at `queen-coordinator.ts:1234-1256` (additive only), keeps debuggability at grep-distance, fails loudly on unknown types per `feedback-no-fallbacks.md`, and matches the inline-branch strategy chosen by T7 (ADR-0125) so worker-side and queen-side surfaces stay symmetric. Option (b) is genuinely cheaper to *re-tune* but pays its price up front in init-template work, schema validation, and cross-surface asymmetry — re-tuning is not a workload we have evidence of needing, so the up-front tax buys an option we may never exercise. Option (b) remains an annotated follow-up in §Refinement; if operator-facing routing changes become a recurring ask, escalate then.

## Consequences

### Positive

- 8 differentiable behaviours visible to the queen-LLM (one prose block per type) and reachable in `QueenCoordinator` (full `typeMatches` coverage + nudges); ADR-0116 matrix row "8 Worker types" closes
- Deterministic capability-score output — given a task definition and an agent pool, the worker selected by `QueenCoordinator` is reproducible across runs
- Debuggable at source — every prose block, `typeMatches` row, and nudge branch is a discrete grep target
- Symmetric with T7 (ADR-0125) queen-type branching strategy; the queen-prompt sentinel surface is uniform across both ADRs
- Tests can iterate the existing `AgentType` union parametrically — adding a 9th worker type later requires updating one union, three sites in this ADR's surface, and the cross-reference in T7's queen prompt, then re-running the same parametric tests

### Negative

- Three coupled surfaces per type (queen-prompt prose block, `typeMatches` row, capability-score nudge) plus the cross-reference into T7's queen prompt — every behaviour change is a multi-site edit
- No central structural spec for the 8 prose blocks — drift between them (one type loses its sentinel, another grows an extra section) is detectable only by the structural-contract test in §Validation, not by the type system
- No learning from outcomes — `task.type` → worker mappings are static; if `architect` consistently gets routed wrong in practice the system does not self-correct
- Routing depends entirely on the caller passing the correct `task.type` literal (set at `task-orchestrator.ts:125` or hardcoded inside `queen-coordinator.ts:711-814`); a miscategorised caller is a fork patch and cascade re-publish to fix
- Adding a 9th worker type requires touching the `AgentType` union, this ADR's three coupled surfaces, T7's queen prompt cross-reference, and the parametric tests — coupling tax scales linearly with type count
- Multi-match disposition (when `typeMatches[task.type]` carries multiple worker types via option-b co-placement) is resolved by highest-score-wins with enum-order tiebreak per §Refinement; this is deterministic but loses information when a task is genuinely two-typed (e.g. "design and implement" — architect vs. coder)

## Validation

- Unit: enum-coverage test asserts all 8 USERGUIDE types have a `typeMatches` row in `queen-coordinator.ts`; capability-score-nudge presence test asserts each of the 8 types has at least one nudge that fires for its matching `task.type` literal; queen-prompt-prose presence test asserts `generateHiveMindPrompt` emits 8 pairwise-distinct prose blocks; structural-contract test asserts every prose block carries the same three required sections (role-description sentinel, MCP-tool list sentinel, queen-type cross-reference sentinel) so blocks cannot drift apart silently; default-case throw tests assert unknown worker type throws in both routing and prompt-emission paths; **`t8_empty_pool_throws`** (unit) feeds a `TaskDefinition` whose `typeMatches` row has zero matching agents in the pool and asserts `calculateCapabilityScore` throws `Error('No agent of matching type for task.type=X available in pool')` per §Specification empty-pool contract
- Integration: end-to-end queen-prompt emission test invokes the prompt-substitution path through the CLI command layer for a worker pool covering all 8 types; asserts each type's prose block, MCP-tool sentinel, and T7 cross-reference substring survive substitution; `QueenCoordinator.calculateCapabilityScore` test feeds a parametric set of `(TaskDefinition, AgentState)` pairs and asserts the matching worker's score is strictly highest; multi-match tiebreak test feeds a `TaskDefinition` whose `typeMatches` row carries multiple worker types and asserts highest-score wins with enum-order tiebreak
- Acceptance: `lib/acceptance-adr0126-checks.sh` (new) runs in an init'd project against published packages, invokes `hive-mind spawn` with worker pools covering all 8 types, captures the emitted prompt, and asserts (i) every type's role-description sentinel is present and pairwise distinct, (ii) every type's MCP-tool sentinel is present, (iii) the active queen-type body sentinel from ADR-0125 appears in each prose block, (iv) the structural-contract sections all appear in the same order across the 8 blocks, (v) **`acc_t8_empty_pool_rejected`** drives a `task.type` whose worker is absent from the pool and asserts the queen surfaces the empty-pool error rather than silently selecting a non-matching agent, (vi) wired alongside per-ADR check suites with `$(_cli_cmd)` per `reference-cli-cmd-helper.md`. Per `feedback-all-test-levels.md`, all three levels ship in the same commit as the implementation
- Annotation lift: ADR-0118 §Status row T8 marked `complete`, with Owner/Commit naming the green-CI commit; lift fires on the next materialise run per §Completion

## Decision

**Emit per-worker-type prose blocks in the queen prompt; extend `typeMatches` to cover all 8 USERGUIDE worker types; add the 4 missing capability-score nudges in `QueenCoordinator`.** This brings the queen-LLM's anchor text in line with the USERGUIDE catalog and makes every USERGUIDE type reachable through `QueenCoordinator` task routing.

After this ADR lands:
- `generateHiveMindPrompt` replaces the count-only `WORKER DISTRIBUTION:` block at `commands/hive-mind.ts:94-95` with 8 prose blocks (one per worker type) carrying role description, role-specific MCP tools list, and a substring cross-referencing the active queen-type body emitted by ADR-0125
- `typeMatches` at `queen-coordinator.ts:1234-1244` gains rows for the missing task-type → worker-type mappings so `architect` and `optimizer` are reachable (see §Specification for the new `TaskType` values and how they are introduced)
- `calculateCapabilityScore` at `queen-coordinator.ts:1253-1256` gains 4 additional nudges so all 8 USERGUIDE worker types receive a capability bump on their matching task type, not just `coder`/`reviewer`/`tester`/`coordinator`
- No per-worker subagent prompt template is added to fork source — workers are spawned by the queen-LLM through Claude Code's Task tool, and the prose blocks above are the surface the queen-LLM reads when constructing those Task-tool prompts

## Implementation plan

Three changes plus tests. All edits land in `forks/ruflo/v3/@claude-flow/cli/src/commands/hive-mind.ts` and `forks/ruflo/v3/@claude-flow/swarm/src/queen-coordinator.ts`.

### 1. Per-worker-type prose blocks in the queen prompt

In `generateHiveMindPrompt` (`commands/hive-mind.ts:65-190`), replace the count-only `WORKER DISTRIBUTION:` block at lines 94-95 with a per-type prose block. For each type present in `workerGroups`, emit a paragraph carrying (i) a role-description sentinel substring (the structural contract from §Validation), (ii) a role-specific MCP-tool list sentinel, (iii) a cross-reference to the active queen-type body sentinel sourced from ADR-0125. Tools-by-type emphasis: researcher → `memory_search` / `embeddings_search`; coder → file edits + test runs; analyst → `performance_*`; tester → acceptance harness invocation; architect → ADR creation + `analyze_diff*`; reviewer → `analyze_diff-risk` / `analyze_diff-reviewers`; optimizer → `performance_bottleneck` / `neural_optimize`; documenter → `markdown-editor` skill + USERGUIDE updates. Worker types not present in the pool emit no block (the prose is per-pool, not catalog-fixed).

### 2. Extend `typeMatches` to cover the missing 2 worker types

`queen-coordinator.ts:1234-1244` carries the `Record<TaskType, AgentType[]>` that drives type-match scoring. Two USERGUIDE worker types — `architect` and `optimizer` — are unreachable via this table because no `TaskType` value maps to them. Two options for the implementer (see §Review notes for the open question): either (a) add a new `TaskType` for each (`'design' → ['architect']`, `'optimization' → ['optimizer']`) and extend the `TaskType` union accordingly, or (b) add the missing types as co-placed agents on existing rows (e.g. `coding: ['coder', 'architect']` so `architect` is a co-target for coding tasks, with the multi-match disposition of §Specification picking the winner). Option (a) requires an audit of `forks/ruflo/v3/@claude-flow/swarm/src/coordination/task-orchestrator.ts` callers (the literal `task.type` assignment site at line 125, and the hardcoded literals inside `queen-coordinator.ts:711-814`) to emit the new literals at every call site that should target the new types; option (b) avoids the audit but adds row-level multi-target rows whose disposition leans on the §Specification multi-match contract. Both remain viable; the implementer must commit to one and document the choice in §Specification before code lands.

### 3. Add the 4 missing capability-score nudges

`queen-coordinator.ts:1253-1256` carries 4 `task.type === 'X' && caps.Y` branches for `coding`/`review`/`testing`/`coordination`. Add 4 more nudges so every USERGUIDE worker type receives a capability bump on its matching task type — pair the nudges with the `TaskType` values introduced (or reused) by change #2. Existing branches stay untouched. Default case at the end of the new switch throws `Error("Unknown worker-type for scoring: ${type}")` per `feedback-no-fallbacks.md`.

### 4. Tests

Per `feedback-all-test-levels.md`, all three levels ship in the same commit:

- 8 pairwise-distinct prose blocks (string-diff test); each prose block carries the structural-contract sections in the same order; each block carries the type-specific MCP-tool sentinel
- `calculateCapabilityScore` returns the strictly-highest score for the matching worker on each `TaskType` (parametric over the 8-type enum)
- Multi-match tiebreak: a task description that triggers multiple worker types resolves to highest-score with enum-order tiebreak; round-trip the input and assert determinism across 100 runs
- Worker prompts reference the active queen-type body (cross-check ADR-0125 sentinel appears in each prose block)
- Default-case throws on unknown worker type at both the prompt-emission site and the scoring site
- Acceptance check `lib/acceptance-adr0126-checks.sh` exercises the surface end-to-end; see §Validation for the assertion list

## Specification

- **Worker-type enum (existing)**: 8 USERGUIDE members already live in `AgentType` at `forks/ruflo/v3/@claude-flow/swarm/src/types.ts:78-91` — `researcher`, `coder`, `analyst`, `architect`, `tester`, `reviewer`, `optimizer`, `documenter`. This ADR does not introduce or extend the union; it consumes the existing 8.
- **Per-type prose-block structural contract (queen prompt)**: every block emitted by `generateHiveMindPrompt` carries, in this fixed order, three sentinel-bearing sections — (a) `## Worker role: ${type}` plus a one-sentence role description, (b) `### Tools you should reach for first` plus a bullet list of role-specific MCP tools, (c) `### Working with the active queen` plus a substring that quotes the ADR-0125 queen-type sentinel for the active queen mode. Section headings (or canonicalised equivalents) are the sentinels the structural-contract test asserts on. Tools-by-type emphasis: researcher → `memory_search` / `embeddings_search`; coder → file edits + test runs; analyst → `performance_*`; tester → acceptance harness invocation; architect → ADR creation + `analyze_diff*`; reviewer → `analyze_diff-risk` / `analyze_diff-reviewers`; optimizer → `performance_bottleneck` / `neural_optimize`; documenter → `markdown-editor` skill + USERGUIDE updates.
- **`typeMatches` extension surface in `queen-coordinator.ts:1234-1244`**: every USERGUIDE worker type must appear as a value in the table for at least one `TaskType`. The 6 already covered — `researcher` (via `research`, `analysis`), `analyst` (via `analysis`), `coder` (via `coding`), `tester` (via `testing`), `reviewer` (via `review`), `documenter` (via `documentation`) — stay. The 2 missing — `architect` and `optimizer` — gain coverage via the option chosen for change #2 in the Implementation plan. Whichever option is chosen, the post-condition is: every member of the 8-type set appears at least once on the right-hand side of the `Record<TaskType, AgentType[]>`.
- **Capability-score nudge surface in `queen-coordinator.ts:1253-1256`**: every USERGUIDE worker type has at least one `task.type === 'X' && caps.Y` branch that fires when its matching task type is scored. Existing 4 branches (`coding`/`review`/`testing`/`coordination`) stay; 4 new branches cover `research`, `analysis`, `documentation`, plus whichever `TaskType` change #2 chose for `architect` and `optimizer`. Default-case throws on an unrecognised worker type per `feedback-no-fallbacks.md`.
- **Queen-prompt / worker cross-reference contract**: ADR-0125 (T7) emits queen-type sentinel substrings in `renderStrategicPrompt` / `renderTacticalPrompt` / `renderAdaptivePrompt`. Each per-type prose block in this ADR's queen prompt cites at least one of those sentinels (the one matching the active `queenType`). The cross-reference test asserts the cited sentinel is present in every block. T7 must land first; otherwise the cited sentinel resolves to an empty value and the cross-check test fails loudly per `feedback-no-fallbacks.md`.
- **Multi-match disposition contract**: `QueenCoordinator.calculateCapabilityScore` is called per agent and returns a numeric score; the existing caller picks the highest-scoring agent. When two agents tie, the tiebreak is enum-order over `AgentType` (researcher < coder < analyst < architect < tester < reviewer < optimizer < documenter). When `typeMatches[task.type]` resolves to multiple worker types simultaneously (option-b co-placement), this still resolves to a single agent — multi-worker fan-out is a topology concern handled by T10 (ADR-0128), not this ADR.
- **Empty-pool contract**: when a task's `typeMatches` row points at a worker type and zero agents of that type are present in the pool, `calculateCapabilityScore` throws `Error('No agent of matching type for task.type=X available in pool')` at the scoring site. This replaces the existing `score = 0.5` baseline disposition (the fork's silent fallback that routed non-matching agents); per `feedback-no-fallbacks.md`, empty-pool must surface as a queen-visible error, not as opaque mis-execution downstream. The test in §Validation asserts the throw fires.
- **Trigger-keyword framing dropped**: capability-score nudges fire only when the caller passes the literal `task.type` value matching one of the 8 worker types (the value is set directly by the caller via `forks/ruflo/v3/@claude-flow/swarm/src/coordination/task-orchestrator.ts:125` or via hardcoded literals in `queen-coordinator.ts:711-814`). No description-keyword classifier exists in fork source today; "trigger keyword" framing is dropped from this ADR's surface — the surface is `task.type` literals only.

## Pseudocode

- `generateHiveMindPrompt` (`commands/hive-mind.ts:65-190`) replaces the count-only `WORKER DISTRIBUTION:` block with a per-type prose loop. For each `type` in `Object.keys(workerGroups)`, emit a block carrying the three structural-contract sections in fixed order, the type-specific MCP-tool sentinel, and the queen-type cross-reference substring sourced from `flags.queenType`'s ADR-0125 sentinel. Lookup of the per-type prose by an `AgentType` value not in the USERGUIDE 8-set throws `Error("Unknown worker-type for prompt: ${type}")` — no silent fallback to a generic block.
- `queen-coordinator.ts:1234-1244` (`typeMatches`) gains rows so every USERGUIDE worker type appears at least once on the right-hand side. `queen-coordinator.ts:1253-1256` (capability-score nudges) gains 4 additional branches in the same `if (task.type === 'X' && caps.Y) score += 0.1` shape so every USERGUIDE worker type receives a nudge on its matching task type. The trailing `default:` arm in any new switch added for the nudge dispatch throws `Error("Unknown worker-type for scoring: ${type}")` per `feedback-no-fallbacks.md`.
- `calculateCapabilityScore` (entry of the function at `queen-coordinator.ts:1230`) gains an explicit empty-pool guard before scoring proceeds: when `typeMatches[task.type]` resolves a non-empty list and zero agents in the pool match any member of that list, throw `Error('No agent of matching type for task.type=${task.type} available in pool')`. This replaces the existing `score = 0.5` baseline disposition for empty-pool inputs — that baseline was itself the silent fallback this ADR fixes per `feedback-no-fallbacks.md`.
- The Task-tool spawn site for individual workers lives in the queen-LLM, not in fork source — there is no per-worker template literal to replace. The fork-side surface this ADR shapes is the queen prompt prose plus `QueenCoordinator` scoring; both feed the queen-LLM's Task-tool decisions.

## Architecture

- **Touched files**:
  - `forks/ruflo/v3/@claude-flow/cli/src/commands/hive-mind.ts` (per-type prose blocks in `generateHiveMindPrompt`, replacing the count-only `WORKER DISTRIBUTION:` block at lines 94-95)
  - `forks/ruflo/v3/@claude-flow/swarm/src/queen-coordinator.ts` (rows added to `typeMatches` at 1234-1244; nudges added to `calculateCapabilityScore` at 1253-1256)
- **Untouched files**: `types.ts:78-91` (`AgentType` union already carries the 8 USERGUIDE types — no change needed); the queen-LLM-held Task-tool spawn site (lives in the LLM, not in fork source — no fork-side template to edit)
- **Data flow (queen-prompt path)**: `flags.queenType` resolves to its ADR-0125 sentinel substring → `generateHiveMindPrompt` walks `workerGroups` and emits one prose block per present type, embedding the queen-type sentinel and the type-specific MCP-tool sentinel → the assembled prompt is written to `.hive-mind/sessions/hive-mind-prompt-${swarmId}.txt` and passed to the spawned `claude` process → the queen-LLM reads the prose blocks when constructing Task-tool prompts for individual workers.
- **Data flow (`QueenCoordinator` scoring path, independent)**: a `TaskDefinition` arrives at `QueenCoordinator.calculateCapabilityScore` → empty-pool guard (this ADR adds it) throws if no agent of any matching type is present → `typeMatches[task.type]` returns the candidate `AgentType` list → if `agent.type` is in that list, score += 0.3 → matching `task.type === 'X' && caps.Y` nudge fires for an extra 0.1 → highest scorer wins, ties broken by enum order per §Specification.
- **Existing 0.5 baseline at `queen-coordinator.ts:1230-1259` is the fallback being fixed.** The fork's current scoring function returns `0.5` when no `typeMatches` row applies to a present agent — that path silently selects a non-matching agent for the task. T8 does not preserve that disposition for the empty-pool case; the empty-pool guard added by this ADR throws before the baseline path can be reached. The `0.5` baseline still fires for present-but-non-matching agents inside a non-empty pool (legitimate scoring fallthrough) — it is only the empty-pool case that this ADR rewires to a throw.
- **T7 (ADR-0125) cross-reference**: ADR-0125's `renderStrategicPrompt` / `renderTacticalPrompt` / `renderAdaptivePrompt` all emit a documented sentinel substring; this ADR's prose loop reads the sentinel for the active `flags.queenType` and embeds it in every per-type prose block. T7 must land first; otherwise the embedded sentinel is empty and the §Validation cross-reference test fails loudly.

## Refinement

- **Edge cases**:
  - **Unknown worker type at prompt-emission or scoring** — `AgentType` includes non-USERGUIDE values (`coordinator`, `monitor`, `specialist`, `queen`, `worker`); the per-type prose loop only emits blocks for the 8 USERGUIDE types, and any other value throws `Error("Unknown worker-type for prompt: ${type}")` per `feedback-no-fallbacks.md`. The scoring nudge default-case throws similarly.
  - **Scoring tie at threshold** — when two agents tie on `calculateCapabilityScore`, deterministic tiebreak is by enum order over `AgentType` (researcher < coder < analyst < architect < tester < reviewer < optimizer < documenter). Test asserts the ordering across all 28 pairwise tie cases.
  - **Multi-type task intent** — a task whose `typeMatches[task.type]` row carries multiple worker types resolves through `QueenCoordinator` as a single selection. The highest-scoring matching agent wins; tie breaks by enum order. Fan-out to multiple workers from a single task is a topology-layer concern handled by T10 (ADR-0128), explicitly out of scope here.
  - **Worker pool empty for chosen type** — if `typeMatches[task.type]` selects worker types that are not in the active pool (zero agents of those types), `calculateCapabilityScore` throws per the §Specification empty-pool contract. The throw replaces the fork's existing `score = 0.5` baseline disposition for empty-pool inputs (the baseline silently routed non-matching agents); per `feedback-no-fallbacks.md` the empty-pool condition surfaces as a queen-visible error. The `t8_empty_pool_throws` (unit) and `acc_t8_empty_pool_rejected` (acceptance) tests in §Validation assert the throw fires.
  - **Adding a 9th worker type** — out of scope; per ADR-0118 §T8 escalation criterion, a new worker type is a new ADR, not an inline edit here.
  - **Worker types absent from the spawned pool** — `generateHiveMindPrompt` emits prose only for types present in `workerGroups`; types absent from the pool emit no block. The `WORKER DISTRIBUTION` summary still lists all present types so the queen-LLM has its census.
- **Error paths**: default case in any new prompt-emission switch throws; default case in any new scoring switch throws; missing queen-type sentinel (T7 not landed) fails the cross-reference test loudly. No try/catch at the dispatch layer — failures propagate to the queen and surface in CLI output, per `feedback-best-effort-must-rethrow-fatals.md`.
- **Test list**:
  - **Unit**: per-type prose presence (every USERGUIDE type emits a non-empty pairwise-distinct block when present in the pool); structural-contract test (every block carries the three required sections in the same order); `typeMatches` coverage (every USERGUIDE worker type appears at least once on the right-hand side); scoring nudge coverage (every USERGUIDE worker type has at least one branch that fires for its matching `TaskType`); enum-tiebreak determinism (28 pairwise tie cases resolve in the documented order across 100 runs each); default-case throw tests at both prompt-emission and scoring sites.
  - **Integration**: end-to-end queen-prompt emission — invoke the CLI command path that calls `generateHiveMindPrompt` with a worker pool covering all 8 types, assert each type-specific MCP-tool sentinel survives substitution, assert the active queen-type sentinel from ADR-0125 appears once per block; multi-match disposition — feed `QueenCoordinator` a `TaskDefinition` whose `typeMatches` row carries multiple worker types, assert highest-score-wins with enum-order tiebreak; empty-pool disposition — feed a `TaskType` whose `typeMatches` row has no matching agents in the pool, assert `calculateCapabilityScore` throws per the §Specification empty-pool contract (`t8_empty_pool_throws`).
  - **Acceptance**: `lib/acceptance-adr0126-checks.sh` exercises the surface end-to-end against published packages — see §Validation for the full assertion list.
- **Future work** (annotated, not blocking T8 per `feedback-no-value-judgements-on-features.md`): option (b) config-driven type→`TaskType` and type→keyword tables remains a viable next step if operator-facing routing changes become a recurring need. The inline-branch surface chosen here is grep-able and additive, so a later config-driven layer can read the same data without re-architecting.

## Completion

- **Annotation lift criterion**: ADR-0118 §Status row T8 marked `complete`, with Owner/Commit naming the green-CI commit. Annotation lift fires on the next materialise run after that flip — see ADR-0118 §Annotation lifecycle.
- **Acceptance wire-in**: `lib/acceptance-adr0126-checks.sh` registered in `scripts/test-acceptance.sh` alongside existing per-ADR check suites. Phase grouping aligns with the hive-mind acceptance phase (no ruvector-heavy load — this ADR does not exercise WASM).
- **Cross-references for downstream work**:
  - T9 (ADR-0127, adaptive topology) reads `worker.type` and `mostBackloggedType` against the existing `AgentType` union (introduced before this ADR — T8 does not add the enum). T9 benefits from the full `typeMatches` coverage T8 lands, because `mostBackloggedType` only carries useful signal if every USERGUIDE type is reachable through `QueenCoordinator` task-routing.
  - T10 (ADR-0128, swarm topology runtime) routes tasks through topologies that read `QueenCoordinator.calculateCapabilityScore`. T10 benefits from the new nudges T8 lands, because every USERGUIDE worker type then carries a non-baseline score on its matching task type. Multi-worker fan-out from a single task is T10's concern, explicitly out of scope here.
- **Lift gating**: per ADR-0118 §Annotation lifecycle, the materialise script reads ADR-0118's §Status table and lifts the README annotation when T8 status is `complete`. The Owner/Commit columns naming the green-CI commit is the audit trail for that flip.

## Acceptance criteria

- [ ] `generateHiveMindPrompt` emits a pairwise-distinct prose block for every USERGUIDE worker type present in the pool (researcher, coder, analyst, architect, tester, reviewer, optimizer, documenter)
- [ ] Every prose block carries the three structural-contract sections in fixed order (role description, MCP-tools list, queen-type cross-reference)
- [ ] `typeMatches` at `queen-coordinator.ts:1234-1244` covers all 8 USERGUIDE worker types; `architect` and `optimizer` are reachable through at least one `TaskType`
- [ ] `calculateCapabilityScore` at `queen-coordinator.ts:1253-1256` carries a nudge branch for every USERGUIDE worker type
- [ ] Default-case throws on unknown worker type at both the prompt-emission site and the scoring site
- [ ] Multi-match resolves to highest-score-wins with enum-order tiebreak; determinism verified across 100 runs
- [ ] Empty-pool disposition throws `Error('No agent of matching type for task.type=X available in pool')`; `t8_empty_pool_throws` (unit) and `acc_t8_empty_pool_rejected` (acceptance) assert the throw fires
- [ ] Cross-reference test asserts each prose block embeds the active queen-type sentinel from ADR-0125
- [ ] `lib/acceptance-adr0126-checks.sh` exists, is wired into `scripts/test-acceptance.sh` using `$(_cli_cmd)` per `reference-cli-cmd-helper.md`, and passes
- [ ] `npm run test:unit` green
- [ ] `npm run test:acceptance` green
- [ ] ADR-0118 §Status row T8 flips to `complete`; ADR-0116 plugin README annotation for "8 Worker types" is removed by the next materialise run

## Risks

1. **`queen-coordinator.ts` is 2,030 lines and `commands/hive-mind.ts` is 1,416 lines.** Extending `typeMatches` at 1234-1244 and adding nudges at 1253-1256 must not break the surrounding capability-score logic; replacing the `WORKER DISTRIBUTION` block in `generateHiveMindPrompt` must not break the rest of the queen prompt assembly. Mitigation: edits are additive (new rows in `typeMatches`, new branches in the nudge block, prose loop replacing two lines of count summary), with parametric tests that exercise existing rows/branches alongside the new ones.
2. **Cross-ADR coupling with ADR-0125.** The per-type prose blocks cite ADR-0125's queen-type sentinels. If T7 lands with sentinels named differently than what the prose loop reads, every prose block fails the cross-reference test. Mitigation: T8 lands after T7; the cross-reference test catches drift loudly per `feedback-no-fallbacks.md`.
3. **`typeMatches` extension introduces new `TaskType` values (option a in change #2).** If the `TaskType` union is consumed elsewhere in the swarm package (e.g. handler dispatch, telemetry tags), adding `'design'` or `'optimization'` may need handler stubs in those sites. Mitigation: grep `TaskType` consumers before landing, document the call-sites list in the implementation PR, add stub handlers if any consumer narrows on the union exhaustively.
4. **Drift across the 8 prose blocks.** With no central spec, blocks can lose required sections silently (one type's MCP-tool list goes missing during a refactor). Mitigation: the structural-contract test in §Validation enforces the three required sections in fixed order; failure is loud per `feedback-no-fallbacks.md`.
5. **Per ADR-0118 §T8 escalation criterion**: "Promote to own ADR if the worker-type catalog diverges from USERGUIDE's 8 (e.g. user requests a `security-auditor` worker)." This ADR closes the existing 8 only; any 9th type is a new ADR.
6. **Existing call sites relying on the `score = 0.5` baseline for empty-pool inputs must be audited.** The throw added by this ADR changes the empty-pool disposition from "silent low-score selection" to "queen-visible exception". Any caller of `calculateCapabilityScore` that expects a numeric return for empty-pool inputs (e.g. probing routines, telemetry samplers, multi-task batch schedulers) will now see a thrown error. Mitigation: grep `calculateCapabilityScore` consumers in the swarm package before landing; document the call-sites list in the implementation PR; if any consumer deliberately probes empty pools, wrap that consumer's call in a try-block that surfaces the error to the queen rather than swallowing it (no try/catch at the dispatch layer per `feedback-best-effort-must-rethrow-fatals.md`).

## References

- ADR-0116 — verification matrix audit ("8 Worker types" row)
- ADR-0118 §T8 — task definition and dependency on T7
- ADR-0125 — T7 queen-type prompts (must land first; provides the sentinel substrings cited by per-worker prose blocks)
- ADR-0127 — T9 adaptive topology (downstream consumer of the worker-type → task-type routing this ADR completes)
- ADR-0128 — T10 swarm topology runtime (downstream consumer of the per-type scoring; multi-worker fan-out is its concern, not this ADR's)
- `reference-ruflo-architecture` memory — ruflo orchestrates; `claude` CLI executes; the queen-LLM holds the Task-tool spawn site for individual workers
- `feedback-no-fallbacks.md` — default-case throws; no silent default routing
- `feedback-all-test-levels.md` — unit + integration + acceptance ship in the same commit
- `feedback-patches-in-fork.md` — USERGUIDE-promised features that don't work are bugs; bugs are fixed in fork
- `reference-cli-cmd-helper.md` — acceptance check uses `$(_cli_cmd)`, never raw `npx @latest`
- USERGUIDE Hive Mind contract — substring anchor `**Worker Specializations (8 types):**`
- `forks/ruflo/v3/@claude-flow/swarm/src/types.ts:78-91` — `AgentType` union (existing source of truth for the 8 USERGUIDE types)
- `forks/ruflo/v3/@claude-flow/swarm/src/queen-coordinator.ts:1234-1244` — `typeMatches` table to extend
- `forks/ruflo/v3/@claude-flow/swarm/src/queen-coordinator.ts:1253-1256` — capability-score nudges to extend
- `forks/ruflo/v3/@claude-flow/cli/src/commands/hive-mind.ts:65-190` — `generateHiveMindPrompt` body
- `forks/ruflo/v3/@claude-flow/cli/src/commands/hive-mind.ts:94-95` — `WORKER DISTRIBUTION:` block to replace with prose loop

## Review notes

Open questions for the implementer to resolve before code lands:

1. **Structural-contract sentinels.** §Specification names section headings (`## Worker role`, `### Tools you should reach for first`, `### Working with the active queen`) as the sentinels the structural-contract test asserts on. If the prose blocks need to integrate into a non-Markdown surface (e.g. a JSON config or a non-MD prompt envelope), the heading-based sentinels need a canonicalisation step. Not blocking unless that surface is encountered. — resolved-with-condition (triage row 38: no non-MD surface exists today; re-open if a future Tn introduces a programmatic prompt envelope)
