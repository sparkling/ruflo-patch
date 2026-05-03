# ADR-0125: Hive-mind Queen-type runtime differentiation (Strategic / Tactical / Adaptive)

- **Status**: **Implemented (2026-05-03)** per ADR-0118 §Status (T7 complete; fork 0748ed9e9 README + 9db6978d5 runtime). Supersedes ADR-0107 (full). Per §Reconciliation, "persist `queenType` across sessions" was a residual at proposal time; folded into T6/ADR-0124 §Specification (archive payload `queenType` field + live `state.queen.queenType` + `mcp__ruflo__hive-mind_status` surfacing).
- **Date**: 2026-05-02
- **Deciders**: Henrik Pettersen
- **Depends on**: ADR-0116 (hive-mind marketplace plugin — provides the verification matrix audit), ADR-0118 (hive-mind runtime gaps tracker — owns this task as T7)
- **Downstream**: ADR-0126 (T8 worker-type runtime — worker prompts cross-reference these queen prompt bodies)
- **Supersedes implementation in**: ADR-0107 (Accepted 2026-04-29 with Option D recommended: per-type prose + CLI validation + state persistence + README correction). ADR-0107 framed the work as a single decision; ADR-0118 §T7 then folded it into the runtime-gaps program. This ADR keeps ADR-0107's Option D mechanism (per-type prompt prose) and discharges its remaining steps explicitly — see §Reconciliation with ADR-0107 below.
- **Related**: ADR-0114 (substrate/protocol/execution architectural model — queen prompt is execution-layer)
- **Scope**: Fork-side runtime work in `forks/ruflo/v3/@claude-flow/cli/src/commands/hive-mind.ts`. Closes ADR-0116 verification matrix row "3 Queen types" (currently ✗ partial).

## Context

ADR-0116's USERGUIDE-vs-implementation verification matrix surfaced that the `Queen Types` block (Strategic / Tactical / Adaptive) advertises three distinct behaviour columns but ships as a label only. ADR-0118 §T7 owns this gap as a single-PR task.

Empirical state in the fork (verified against current `sparkling/main`):

| Surface | Path | Current behaviour |
|---|---|---|
| CLI flag parse | `forks/ruflo/v3/@claude-flow/cli/src/commands/hive-mind.ts:75` | reads `flags.queenType`, defaults to `'strategic'` |
| Prompt substitution | `forks/ruflo/v3/@claude-flow/cli/src/commands/hive-mind.ts:88` | substitutes `👑 Queen Type: ${queenType}` into a single prompt template — no other reference |
| MCP tools layer | `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts` | zero `queenType` branching |
| Swarm coordinator | `forks/ruflo/v3/@claude-flow/swarm/src/queen-coordinator.ts` | zero `queenType` branching |
| USERGUIDE contract | `**Queen Types:**` block | advertises 3 types, each with distinct behaviour columns (planning vs. execution vs. mode-switching) |

The label propagates into the queen's spawn prompt, but no downstream code path branches on it. All three queen types currently produce the same runtime behaviour.

## Decision Drivers

- **USERGUIDE contract** advertises three Queen types with distinct behaviour columns (planning vs. execution vs. mode-switching); shipping a label-only implementation falsifies the contract.
- **Behavioural distinguishability is the bar, not adjective swap.** Per ADR-0107 §R1, the LLM judges leadership pattern from the prompt; if "Strategic" and "Tactical" differ only by adjective in the framing paragraph, runtime differentiation is hollow. Each variant must carry a different MCP tool emphasis list and a different self-monitor checklist (Phases 2 and 3 below) — the tool list and checklist are the falsifiable axes; mission framing alone is not.
- **Current state** is fork-side patch territory: `flags.queenType` propagates only as a prompt-string label at `forks/ruflo/v3/@claude-flow/cli/src/commands/hive-mind.ts:88`. No protocol-layer or coordinator-layer change required.
- **Fork-side patching policy** (`feedback-patches-in-fork.md`): USERGUIDE-promised features that don't work are bugs; bugs are fixed in fork.
- **ADR-0118 §T7 escalation rule**: promote to a separate design ADR if queen-type prompts diverge enough that they need their own template files rather than inline branches. Inline branches are in scope for T7; template-file extraction is out of scope.
- **T8 (ADR-0126) worker prompts cite three sentinel substrings** — `"written plan"` (Strategic), `"spawned workers within"` (Tactical), `"named your chosen mode"` (Adaptive). These are the cross-ADR contract; renaming them is a breaking change for ADR-0126's cross-reference test.
- **ADR-0107 Option D step 5 (fork-root README copy correction) folds into T7 completion** to close the prose-vs-algorithmic differentiation gap user-facing. The README's current "Strategic (planning), Tactical (execution), Adaptive (optimization)" copy reads as runtime-algorithmic differentiation; T7 lands prompt-shaped behaviour and the README must say so.

## Considered Options

- **(a) Inline prompt branches in `generateHiveMindPrompt`** — `switch(queenType)` returns a per-variant prompt body within the existing function. *[CHOSEN]*
- **(b) Separate template files per queen type loaded at runtime** — `templates/queen-strategic.md`, `templates/queen-tactical.md`, `templates/queen-adaptive.md` read via `fs` at spawn time, with a small interpolation pass.
- **(c) Prompt composition from a base template + per-type addendum** — one shared base prompt body plus three small per-type addendum strings concatenated at substitution time.

## Pros and Cons of the Options

**(a) Inline branches**
- Pros: single-file diff; easy review; no new file-loading code path; no I/O at spawn time; matches T7 ADR-0118 escalation expectation.
- Cons: `hive-mind.ts` grows; per-variant prompt drift is hard to enforce mechanically — if one variant gains a `Tools you should reach for first` section heading, nothing flags the other two missing it (the unit test asserts presence per known sentinel, not section parity); a 4th queen type means refactoring all three sibling literals plus the switch and tests; cost of evolution is paid in three places.

**(b) Separate template files**
- Pros: each variant readable in isolation; supports designer/non-engineer iteration; trivially extensible to new queen types.
- Cons: introduces runtime template loading + path resolution; new failure modes (missing template, packaging miss); over-engineered for three short variants today.

**(c) Base + addendum composition**
- Pros: minimises duplication; clean variant deltas.
- Cons: hides the per-variant body across two strings; harder to diff a single variant's full text; sentinel-substring acceptance tests (Phase 4) become awkward.

## Decision Outcome

**Chosen option: (a) inline branches**, because the three variants are short, the diff stays in a single file, no new code paths or failure modes are introduced, and the escalation criterion in ADR-0118 §T7 explicitly endorses inline as the default. If during Phase 1 the variants share less than ~40% of their prompt text, escalate to a follow-up ADR for option (b) per ADR-0118 §T7.

## Reconciliation with ADR-0107

ADR-0107 (Accepted 2026-04-29) recommended **Option D**: per-type prose blocks + CLI-boundary validation + `state.json` persistence + README correction + `QueenCoordinator` annotation. ADR-0125 inherits Option D's mechanism (inline per-type prose) and discharges each step:

| ADR-0107 Option D step | ADR-0125 disposition |
|---|---|
| Per-type prose in `generateHiveMindPrompt` | In scope (Phases 1–3) |
| CLI-boundary enum validation, no silent fallback | In scope — see §Specification "CLI-boundary validation" |
| Persist `queenType` to `.claude-flow/hive-mind/state.json`, surface via `mcp__ruflo__hive-mind_status` | **Out of scope of T7**, deferred — tracked as ADR-0107 follow-up. T7 closes the prompt-differentiation matrix row from ADR-0116; state-persistence is independent of that row and does not block T8. Open question recorded in §Review notes. |
| README copy correction ("differentiation is prompt-shaped, not algorithmic") | **In scope of T7.** Replace the current "Strategic (planning), Tactical (execution), Adaptive (optimization)" copy in the fork-root README (`forks/ruflo/README.md` — verify path) with prose-shaped framing per ADR-0107 Option D step 5, e.g. "Queen leadership styles passed as prompt guidance: Strategic (planning-first), Tactical (execution-first), Adaptive (mode-switching by complexity). Differentiation is prompt-shaped, not algorithmic." Diff is a precondition for annotation lift (see §Completion). |
| Annotate orphaned `swarm/src/queen-coordinator.ts` as daemon-resident advisor | Already addressed in ADR-0107 §Recommendation; not re-litigated here |

The cross-reference contract for T8 (ADR-0126) — the three sentinel substrings — is new in this ADR; ADR-0107 did not name them.

## Consequences

**Positive**
- Single-file change in `forks/ruflo/v3/@claude-flow/cli/src/commands/hive-mind.ts`; review and revert are trivial.
- Sentinel substrings per variant give downstream T8 (ADR-0126) worker prompts stable anchors.
- No protocol-layer change preserves ADR-0114 layering (queen prompt is execution-layer, not protocol).

**Negative**
- `hive-mind.ts` file size grows; if a fourth queen type is added later, or any single variant diverges further, refactor to per-template files (option b) is likely.
- Inline branches push the readability ceiling; once any variant exceeds ~80 lines of prompt text, option (b) becomes the better fit.
- Per-variant section parity must be policed by tests, not the type system — the unit test asserts each variant carries the headings `Tools you should reach for first` and `Before declaring done, verify`, otherwise drift can land silently.

## Validation

- **Unit** — `tests/unit/adr0125-queen-type-prompts.test.mjs`:
  - `generateHiveMindPrompt-returns-pairwise-distinct-bodies` — three `queenType` values produce three pairwise-distinct strings.
  - `generateHiveMindPrompt-emits-per-type-sentinels` — Strategic body contains `"written plan"`; Tactical contains `"spawned workers within"`; Adaptive contains `"named your chosen mode"`. Wrong-type sentinels absent in each.
  - `generateHiveMindPrompt-section-parity` — every variant carries the headings `Tools you should reach for first` and `Before declaring done, verify`.
  - `generateHiveMindPrompt-unknown-queen-type-throws` — `'unknown' as QueenType` raises `Error("unknown queenType: unknown")`; no fallback to `'strategic'` (per `feedback-no-fallbacks.md`).
- **Integration** — same file, separate suite: end-to-end prompt-substitution path through the CLI command layer asserts per-type sentinels survive substitution.
- **Acceptance** — `lib/acceptance-adr0125-queen-types.sh` wired into `scripts/test-acceptance.sh` (parallel-wave check list, using `$(_cli_cmd)` per `reference-cli-cmd-helper.md`): spawn each queen type in an init'd project; capture the emitted prompt; assert per-type sentinel substrings present and wrong-type sentinels absent.
- **Acceptance — README copy** — same check script asserts the fork-root README (`forks/ruflo/README.md` — path verified during implementation) carries the prose-shaped framing ("Differentiation is prompt-shaped, not algorithmic") and no longer carries the bare "Strategic (planning), Tactical (execution), Adaptive (optimization)" string.

## Decision

**Replace the single `generateHiveMindPrompt` template with a queen-type-keyed prompt map.** Each variant carries:

1. A different framing of the queen's primary mission (planning-first vs. execution-first vs. complexity-driven mode-switch)
2. Different MCP tool emphasis surfaced in the prompt's "preferred tools" section
3. Different per-type acceptance criteria the queen self-monitors against

Inline-branch implementation (per ADR-0118 §T7 escalation criterion: "Promote if queen-type prompts diverge enough that they need their own template files (rather than inline branches)" — for this ADR, inline is sufficient).

No API change: `hive-mind spawn --queen-type=<value>` already accepts the three values; only `generateHiveMindPrompt`'s body changes.

## Implementation plan

Lifted from ADR-0118 §T7. Single file: `forks/ruflo/v3/@claude-flow/cli/src/commands/hive-mind.ts`.

### Phase 1 — Queen-type-keyed prompt map in `generateHiveMindPrompt`

Replace the single prompt template with a map keyed by `queenType`:

- **Strategic**: emphasises planning, analysis, decomposition. Frames the queen as architect-first; instructs the queen to invest in `task_create` for a full plan tree before delegating, and to write decisions to `memory_store` / `memory_search` so workers can read prior context.
- **Tactical**: emphasises execution and delegation throughput. Frames the queen as dispatcher-first; instructs the queen to bias toward `agent_spawn` and `task_assign` early, with shorter planning preamble and more frequent worker status pings.
- **Adaptive**: instructs the queen to choose between Strategic and Tactical mode based on objective complexity (signals: number of subtasks discovered during initial analysis, ambiguity in the objective text). When the queen detects mid-run that the wrong mode was picked, it uses `_consensus` to confirm a strategy switch with the workers.

### Phase 2 — Per-variant MCP tool emphasis

Each prompt variant lists its preferred tools in a "Tools you should reach for first" section:

- Strategic: `mcp__ruflo__task_create`, `mcp__ruflo__memory_store`, `mcp__ruflo__memory_search`, `mcp__ruflo__hive-mind_memory`
- Tactical: `mcp__ruflo__agent_spawn`, `mcp__ruflo__task_assign`, `mcp__ruflo__hooks_worker-status`, `mcp__ruflo__hive-mind_broadcast`
- Adaptive: `mcp__ruflo__hive-mind_consensus` for strategy switching, plus the union of Strategic + Tactical tool sets

The deferred-tool listing in the Claude Code session prompt remains unchanged; this is purely about which tools the queen-prompt instructs the queen to *reach for first*.

### Phase 3 — Per-type acceptance criteria in the prompt

Each variant ends with a self-check list the queen evaluates before declaring done:

- Strategic: "You produced a written plan with explicit subtask decomposition before spawning workers. You stored at least one decision rationale to memory."
- Tactical: "You spawned workers within the first N coordination cycles. You pinged worker status at least once per cycle."
- Adaptive: "You explicitly named your chosen mode (Strategic or Tactical) and your reason. If you switched mid-run, you ran `_consensus` to confirm."

### Phase 4 — Tests

Two test layers:

- **String-diff unit test** in `tests/unit/`: invokes `generateHiveMindPrompt` three times with `queenType: 'strategic' | 'tactical' | 'adaptive'`, asserts pairwise `prompt_a !== prompt_b` for all three pairs and that each variant contains its expected per-type sentinel strings (e.g. "written plan" for Strategic, "spawned workers within" for Tactical, "named your chosen mode" for Adaptive).
- **Behavioural acceptance test** in `lib/acceptance-adr0125-queen-types.sh` wired into `scripts/test-acceptance.sh`: for each `queenType` value, runs `hive-mind spawn` with a small fixed objective in dry-run prompt-emit mode, captures the emitted prompt, and asserts the per-type sentinel substrings are present and the wrong-type sentinels are absent.

### Phase 5 — Fork-root README copy correction (ADR-0107 Option D step 5)

Update `forks/ruflo/README.md` (or whichever fork-root README contains the offending copy — verify path during implementation) — replace the current "Strategic (planning), Tactical (execution), Adaptive (optimization)" framing with the prose-shaped framing: "Queen leadership styles passed as prompt guidance: Strategic (planning-first), Tactical (execution-first), Adaptive (mode-switching by complexity). Differentiation is prompt-shaped, not algorithmic." This closes ADR-0107 Option D step 5 and is a precondition for annotation lift (see §Completion).

## Specification

- **Queen-type enum**: TypeScript union `type QueenType = 'strategic' | 'tactical' | 'adaptive'`. No fourth value accepted at the type system or runtime layer. Unknown values fail loudly (see §Refinement).
- **Prompt map shape**: `Record<QueenType, (ctx: HiveMindPromptContext) => string>` where `HiveMindPromptContext` carries the existing substitution variables (objective, swarm id, topology, worker count) currently consumed at `forks/ruflo/v3/@claude-flow/cli/src/commands/hive-mind.ts:88`.
- **Per-variant body sections** (each variant's returned prompt string carries all three):
  - **Mission framing** — one paragraph naming the queen's primary disposition (planning-first / execution-first / complexity-driven mode-switch).
  - **Preferred MCP tools** — bullet list under the heading "Tools you should reach for first" (per Phase 2).
  - **Self-monitor acceptance criteria** — bullet list under "Before declaring done, verify" (per Phase 3) carrying the sentinel substrings used by acceptance tests.
- **CLI flag surface unchanged**: `hive-mind spawn --queen-type=<value>` already accepts `strategic | tactical | adaptive` at `forks/ruflo/v3/@claude-flow/cli/src/commands/hive-mind.ts:75`. No new flags, no rename, no default change (`'strategic'` stays).
- **CLI-boundary validation**: per ADR-0107 Option D and `feedback-no-fallbacks.md`, the `spawn` action validates `flags.queenType` against the enum at the CLI boundary before reaching `generateHiveMindPrompt`. Unknown values exit non-zero with `Error: --queen-type must be one of strategic|tactical|adaptive (got "<value>")`. This is the user-visible failure surface; the `default` throw inside `generateHiveMindPrompt` is a defence-in-depth backstop for non-CLI callers.
- **Cross-ADR sentinel contract for ADR-0126 (T8)**: the three sentinel substrings — `"written plan"` (Strategic), `"spawned workers within"` (Tactical), `"named your chosen mode"` (Adaptive) — are the stable anchors that ADR-0126's worker prompts cite. Renaming or rewording any of the three is a breaking change for ADR-0126's cross-reference test and requires coordinated edits in both ADRs.

## Pseudocode

```
generateHiveMindPrompt(queenType: QueenType, ctx: HiveMindPromptContext): string
  switch (queenType)
    case 'strategic':
      return renderStrategicPrompt(ctx)        // mission + Strategic tool list + Strategic self-check
    case 'tactical':
      return renderTacticalPrompt(ctx)         // mission + Tactical tool list + Tactical self-check
    case 'adaptive':
      return renderAdaptivePrompt(ctx)         // mission + union tool list + mode-name + consensus rule
    default:
      throw new Error(`unknown queenType: ${queenType}`)   // fail loudly per feedback-no-fallbacks
```

Each `render*Prompt` is an inline template literal in `hive-mind.ts`. No file I/O, no template loading, no string composition across helpers. The prior single-template body becomes three sibling literals.

## Architecture

- **Touched file**: `forks/ruflo/v3/@claude-flow/cli/src/commands/hive-mind.ts:88` — the prompt-substitution site identified in the §Context table. Function body of `generateHiveMindPrompt` swaps from a single template to a switch over `QueenType`.
- **Untouched layers**:
  - MCP tools layer (`forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts`) — no `queenType` branching added; per ADR-0114 the queen prompt sits at the execution layer, not the protocol layer.
  - Swarm coordinator (`forks/ruflo/v3/@claude-flow/swarm/src/queen-coordinator.ts`) — no behavioural branching added; queen behaviour differentiation is mediated entirely through the LLM-facing prompt.
- **Downstream consumers**:
  - The queen subagent's spawned conversation receives the per-type prompt body as its system/initial-user prompt.
  - **T8 (ADR-0126) worker prompts cross-reference these queen prompt bodies**: each worker variant cites the queen's mission framing and preferred-tools section so the worker collaborates consistently with whichever queen type spawned it. Sentinel substrings introduced here become anchors for those worker-prompt references.
- **No registration / no route table changes**: the existing `--queen-type` flag-parser already routes the three values; only the rendering function body changes.

## Refinement

- **Edge cases**:
  - **Unknown queen type at the CLI boundary** — `spawn` action rejects with a user-visible error before `generateHiveMindPrompt` is called (per §Specification "CLI-boundary validation"). No silent fallback to `'strategic'` (per `feedback-no-fallbacks.md`).
  - **Unknown queen type at runtime (non-CLI caller)** — TypeScript prevents at compile time, but a stray string from a programmatic caller reaches the switch. The `default` case throws as a defence-in-depth backstop.
  - **Queen type changes mid-session** — out of scope for T7. The prompt is rendered once at spawn; if a runtime mode-switch is needed, that is Adaptive's `_consensus` rule, which switches *behaviour* within the same prompt envelope rather than re-rendering the prompt.
  - **Prompt token budget per variant** — each variant must stay under the existing aggregate token budget for the queen subagent's initial prompt. If any single variant exceeds the budget, that is the trigger for option (b) escalation per ADR-0118 §T7.
  - **Variant-length asymmetry** — Adaptive carries the union tool list (Strategic + Tactical) plus mode-switch logic, so it is necessarily the longest variant. The token-budget check above applies to whichever variant is longest; in practice that is Adaptive.
- **Error paths**:
  - `default` case in the `switch` throws `Error('unknown queenType: ${queenType}')`. Tests assert this throw (no try/catch upstream that swallows it).
  - No best-effort wrappers around `generateHiveMindPrompt` — per `feedback-best-effort-must-rethrow-fatals.md`, a malformed `queenType` is a contract violation, not a recoverable condition.
- **Test list**:
  - **Unit**: prompt-map presence — three keys, each callable, each returns non-empty string. Fail-loud — `generateHiveMindPrompt('unknown' as QueenType, ctx)` throws.
  - **Integration**: prompt-substitution end-to-end — invoke the CLI command path that calls `generateHiveMindPrompt`, assert the returned prompt carries the per-type sentinel substring after all substitutions land.
  - **Acceptance**: spawn each queen type in an init'd project (per `feedback-test-in-init-projects.md`); capture emitted prompt; assert per-type sentinel present and wrong-type sentinels absent across all three variants.

## Completion

T7 marked `complete`, with Owner/Commit naming the green-CI commit (covering the prompt-map runtime work and the fork-root README diff per Phase 5). Annotation lift fires on the next materialise run after that flip. See ADR-0118 §Annotation lifecycle for the single-axis lift contract.

## Acceptance criteria

- [ ] Phase 1: `generateHiveMindPrompt` accepts `queenType` and returns three distinct prompt bodies
- [ ] Phase 2: each variant's prompt names its preferred MCP tools and they differ across the three variants
- [ ] Phase 3: each variant carries a per-type self-check section
- [ ] Phase 4: string-diff unit test passes — all three `queenType` values produce distinct prompt bodies, each contains its expected sentinel strings
- [ ] Phase 4: `lib/acceptance-adr0125-queen-types.sh` exists and passes for all three variants
- [ ] `npm run test:unit` green
- [ ] `npm run test:acceptance` green
- [ ] ADR-0118 §Status table T7 row flips to `complete`; the corresponding ADR-0116 plugin README "3 Queen types" annotation lifts on the next P1 materialise run

## Risks

**Low.** Additive prompt restructuring with no API change — `--queen-type` already accepts all three values; only the body of the template function changes.

Per ADR-0118 §T7 escalation criterion: promote to its own ADR if queen-type prompts diverge enough that they need their own template files rather than inline branches. For this ADR the inline-branch approach is in scope; if Phase 1 implementation finds the three variants share less than ~40% of their prompt text, escalate to a follow-up ADR for template-file extraction.

## Review notes

1. **State persistence (ADR-0107 Option D step 3) is deferred without an owning ADR.** ADR-0107 §Implementation plan step 3 specifies persisting `queenType` to `.claude-flow/hive-mind/state.json` and surfacing via `mcp__ruflo__hive-mind_status`. ADR-0125 declares this out of scope for T7 (matrix row "3 Queen types" is closed by prompt differentiation alone), but no successor ADR yet owns the state-persistence step. Open question: does this fold into T6 (ADR-0124 session lifecycle) since `state.json` is the session-checkpoint surface, or does it need its own task ADR? Resolve before annotation lift on ADR-0107. — resolved (triage H6 / row 32: folded into T6/ADR-0124 per ADR-0118 §Open questions item 3; ADR-0124 §Specification has taken delivery)
2. **Adaptive's `_consensus` rule for mid-run mode switch** assumes the consensus surface supports a "strategy switch" question. If T1 (ADR-0119 weighted consensus), T2 (gossip), T3 (CRDT) reshape the consensus surface, Adaptive's prompt instruction may reference a tool that no longer carries that semantic. Worth a cross-check after T1–T3 land. (triage row 34 — DEFER-TO-IMPL: cross-check after T1/T2/T3 land; implementer rewrites adaptive prompt's mode-switch instruction to match active consensus surface)

## References

- Task definition: ADR-0118 §T7
- Prior decision: ADR-0107 (Accepted 2026-04-29) — Option D mechanism inherited; remaining steps tracked in §Reconciliation
- Verification matrix audit: ADR-0116 §USERGUIDE-vs-implementation verification matrix, row "3 Queen types"
- Downstream consumer: ADR-0126 §Specification "Queen-prompt / worker-prompt cross-reference contract" — sentinel substrings declared in §Specification of this ADR
- Architectural constraints: ADR-0114 (substrate/protocol/execution layering — the queen-prompt is execution-layer, not protocol)
- USERGUIDE Hive Mind contract: substring anchor `**Queen Types:**` in `/Users/henrik/source/ruvnet/ruflo/docs/USERGUIDE.md`
- Fork-side patch policy: `feedback-patches-in-fork.md` memory
