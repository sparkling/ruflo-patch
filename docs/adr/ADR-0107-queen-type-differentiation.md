# ADR-0107: Queen type behavioral differentiation

- **Status**: Investigating (no implementation choice made)
- **Date**: 2026-04-29
- **Roadmap**: ADR-0103 item 3
- **Scope**: hive-mind queen types (`strategic` / `tactical` / `adaptive`) —
  whether each value selects a distinct leadership pattern at runtime.

## Context

README §Hive Mind Capabilities (line 214) claims:

> "🐝 **Queen Types**: Strategic (planning), Tactical (execution), Adaptive (optimization)"

§Why Choose Ruflo? (line 1608–1610) elaborates:

> | Strategic | Research, planning, analysis | High-level objective coordination |
> | Tactical | Implementation, execution | Direct task management |
> | Adaptive | Optimization, dynamic tasks | Real-time strategy adjustment |

§Comparison table (line 403):

> "Hive Mind | … | Queen-led swarms with collective intelligence, **3 queen types**, 8 worker types"

The CLI accepts `--queen-type strategic|tactical|adaptive` and the field is
displayed back in `hive-mind status` output. ADR-0104 §Out-of-scope flagged
the value as prompt-string interpolation; this ADR confirms and quantifies it.

## Investigation findings

### Upstream ADRs

- `forks/ruflo/v3/docs/adr/`: README index only — no queen-type ADR.
- `forks/ruflo/ruflo/docs/adr/`: empty.
- `forks/ruflo/v3/implementation/v3-migration/HIVE-MIND-MIGRATION.md` line 53–54:

  > | `Queen.ts` | Missing | ❌ Needs implementation |

  The migration doc (line 59–95) explicitly says V3's QueenCoordinator
  "Needs implementation" and includes a sketch of `selectStrategy(topology)`
  — but the strategy switch is keyed on **topology**, not on queen type.
  Queen-type-as-leadership-pattern was never a target.

### Source archaeology

| File | Lines | Per-type branching? | Wired into CLI? |
|---|---|---|---|
| `v3/@claude-flow/swarm/src/queen-coordinator.ts` | 2030 | **No.** Zero references to the strings `'strategic'`, `'tactical'`, or `'adaptive'` as queen types. The word "strategic" appears only in comments and method names ("strategic decision-maker"). No `queenType` field, no constructor argument, no factory parameter. | **No.** `grep -rln 'QueenCoordinator' v3/@claude-flow/cli/src/` returns nothing. Re-exported by `swarm/src/index.ts` but never instantiated by CLI. |
| `v3/@claude-flow/cli/src/commands/hive-mind.ts` | — | `queenType` is read at line 75 (`flags.queenType ?? 'strategic'`), substituted into the prompt header at line 88 (`👑 Queen Type: ${queenType}`), and echoed in the status panel at line 231. **No conditional, no validation, no enum check.** Any arbitrary string would round-trip unchanged. | This is the only place `--queen-type` flows. |
| `v3/@claude-flow/cli/src/init/executor.ts:1813` | — | Documents `--queen-type strategic` in the init template. | Doc only. |
| `v3/@claude-flow/cli/.claude/skills/hive-mind-advanced/SKILL.md` | — | Lists `strategic\|tactical\|adaptive` as valid types and shows examples per type. | Doc only. |
| `v2/src/cli/simple-commands/hive-mind.js:2485, 2494, 2503` | — | **Yes — but only as prompt prose.** The V2 prompt template injects 4 lines of guidance per type (`focus on high-level planning` / `manage detailed task breakdowns` / `learn from swarm performance and adapt`). | V2-only. Not ported to V3. |
| `v2/src/hive-mind/core/Queen.ts` | 774 | Has a `QueenMode` field, but the type is `'centralized' \| 'distributed' \| 'strategic'` — **different label set** from the README's `strategic/tactical/adaptive`. Only `mode === 'distributed'` triggers a code branch (broadcast agent registration, line 92). | V2 runtime; V3 migration is incomplete (Queen "Missing"). |
| `forks/ruflo/.claude/agents/hive-mind/queen-coordinator.md` | — | Describes one Queen with three governance protocols (Hierarchical / Democratic / Emergency mode) — orthogonal to the `strategic/tactical/adaptive` axis. | Markdown only; loaded by the Task agent runtime. |

### What `--queen-type` actually does today

Path through V3 (post-ADR-0104):

1. User runs `hive-mind spawn --claude --queen-type tactical -o "..."`.
2. `commands/hive-mind.ts:75` reads `(flags.queenType as string) \|\| 'strategic'`.
3. The string substitutes into `generateHiveMindPrompt()` at line 88 as
   one line of the prompt header: `👑 Queen Type: tactical`.
4. The Queen prompt then continues with **identical prose** regardless of
   the chosen type. There is no equivalent of V2's per-type prose block.
5. The string is also echoed in the launcher's status display (line 231).
6. `claude` is `child_process.spawn`-ed with the assembled prompt.

The Queen's behavior is whatever the LLM infers from a single line of header
text. There is no per-type strategy selection, no per-type tool restriction,
no per-type prompt section, no per-type validation.

### V2-vs-V3 migration status

`HIVE-MIND-MIGRATION.md` candidly states:
- V2 `Queen.ts` → V3 "Missing — Needs implementation"
- V3 `QueenCoordinator` was supposed to fill the gap (per ADR-003)
- The implementation it sketches keys strategy on **topology**, not queen type
- The actual `QueenCoordinator` shipped in `swarm/src/queen-coordinator.ts`
  is a 2030-LOC class that does task analysis, agent scoring, consensus
  coordination, and health monitoring — but **never branches on queen type**

The closest thing to runtime queen-type differentiation in the entire
codebase is V2's three 4-line prose blocks in `simple-commands/hive-mind.js`
(lines 2485–2510). That code was not ported to V3.

### Trust-model context (per ADR-0106)

Within a single hive, the Queen is a single `claude` session. Workers are
Task sub-agents under that same session. "Queen type" only meaningfully
differentiates **the Queen's prompt**; there is no separate queen process
that could implement a different algorithm. So any "differentiation" is
necessarily prompt-shaped, not algorithm-shaped.

## Current state verdict

- ✅ Flag plumbing: `--queen-type` is read, displayed, and persisted to the
  prompt without crashes.
- ❌ Validation: any string is accepted — `--queen-type banana` round-trips.
- ❌ Behavior: the Queen prompt is identical for all three values modulo
  one header line.
- ❌ Code paths: zero queen-type branching anywhere in the V3 runtime.
  Even V2's per-type prose blocks were not ported.
- ❌ README claim: "Strategic (planning), Tactical (execution), Adaptive
  (optimization)" implies distinct leadership patterns. Today there are none.

## Decision options

### Option A — Wire `QueenCoordinator` and add per-type strategy

Make `hive-mind spawn --claude` instantiate `QueenCoordinator` with a
`queenType` config parameter and add per-type branching:
**strategic** biases `determineExecutionStrategy()` toward `'fan-out-fan-in'`;
**tactical** biases toward `'sequential'` / `'pipeline'` and raises
complexity thresholds; **adaptive** forces `neural.findPatterns()` on
every analysis and re-weights `scoreAgents()` from `MatchedPattern.successRate`.

**Hard problem** (same as ADR-0106 §A): `QueenCoordinator` is a
process-local EventEmitter; the Queen runs in a separate `claude` CLI
process. Wiring the runtime class needs daemon transport (ADR-0106 §A1)
or it never reaches the Queen process at all. Effort estimate: large
(5–7 fork files, new MCP tool, paired tests, plus the daemon question).

### Option B — Per-type prompt prose block (port from V2)

Add a per-type prose block to `generateHiveMindPrompt()` mirroring V2
lines 2485–2510:

```ts
const QUEEN_TYPE_GUIDANCE: Record<string, string> = {
  strategic: '- Focus on high-level planning and decomposition\n- Delegate implementation to workers\n- Defer tactical decisions; make executive calls only when consensus stalls',
  tactical:  '- Manage detailed task breakdowns and assignments\n- Closely monitor worker progress; rebalance loads\n- Intervene directly when workers stall or produce malformed output',
  adaptive:  '- Begin with strategic decomposition; transition to tactical as work proceeds\n- Use mcp__ruflo__memory_search to recall similar past hives\n- Re-weight assignment based on observed success patterns',
};
```

Plus enum validation at the CLI boundary: reject `--queen-type banana`
with a clear error (no silent fallback, per `feedback-no-fallbacks.md`).
Effort estimate: small (one fork file, one acceptance lib, one paired
test).

### Option C — Doc correction (deflationary)

Acknowledge that queen type is metadata only. README is updated:

> "Queen type (`strategic`/`tactical`/`adaptive`) is passed to the Queen as
> guidance text. The Queen's interpretation shapes its leadership style.
> No separate runtime algorithm is selected; the differentiation is
> prompt-shaped."

The `--queen-type` flag stays. The orphaned `QueenCoordinator` is
documented as "future runtime, not yet wired into the hive-mind command".

Effort estimate: README diff (covered partly by ADR-0101) + a CLAUDE.md
note. No code change.

### Option D — Hybrid: per-type prose + state-tracking

- Ship Option B's per-type prompt prose blocks (real, observable
  behavioral differentiation through the prompt).
- Persist `queenType` into `.claude-flow/hive-mind/state.json` as an
  authoritative field, returned by `mcp__ruflo__hive-mind_status`.
- Reject unknown values at the CLI boundary (no fallback).
- Park `QueenCoordinator` (the orphaned 2030-LOC class) as `// @internal —
  reserved for future daemon-resident coordinator (see ADR-0106 Option A
  daemon transport)`.
- Update README copy to describe queen types as prompt-shaped leadership
  styles (matching the actual mechanism), not as runtime algorithms.

This matches the ADR-0105 / ADR-0106 recommendation pattern: ship the
honest, narrow improvement; preserve the orphaned class as future
infrastructure; update the README to match the trust model and runtime.

## Test plan

For whichever option ships:

**Regression** (automated, runs in `test:acceptance`):

1. For each of `strategic`, `tactical`, `adaptive`: the Queen prompt
   header includes the matching `Queen Type: <value>` line.
2. (Option B/D) For each type, the prompt contains the matching prose
   block and excludes the other two blocks.
3. (Option B/D) `--queen-type banana` exits non-zero with a clear message
   (no silent fallback to 'strategic').
4. (Option D) `mcp__ruflo__hive-mind_status` returns `queenType` as an
   authoritative field, not just an echo of the CLI flag.

**Live smoke** (uses developer's `claude` CLI; per ADR-0104 §Verification):

For each of the 3 queen types, spawn a hive with 2 workers and a small
objective ("List 3 prime numbers"). Verify post-run:

- The prompt file in `.hive-mind/sessions/hive-mind-prompt-<id>.txt`
  contains the matching per-type prose block (Option B/D only).
- `state.json` reflects `queenType` correctly (Option D only).
- The Queen's actual delegation pattern in stdout differs noticeably
  between strategic (more decomposition) and tactical (less decomposition)
  for the same objective.

**Unit** (in ruflo-patch `tests/unit/`):

- `acceptance-adr0107-queen-type-checks.test.mjs` — paired with the
  acceptance lib per ADR-0097.
- Tests prompt-template generation per type (string assertions).
- Tests rejection of unknown queen-type values (Option B/D).

## Implementation plan

If Option D (recommended):

1. **Per-type prose**: add `QUEEN_TYPE_GUIDANCE` map and a `§3 Queen Leadership
   Pattern` section to `generateHiveMindPrompt()` in
   `forks/ruflo/v3/@claude-flow/cli/src/commands/hive-mind.ts`.
2. **CLI validation**: in the `spawn` action, validate `--queen-type` against
   `['strategic', 'tactical', 'adaptive']`. Reject other values with a clear
   error (no silent fallback).
3. **State persistence**: extend `hive-mind_init` and `hive-mind_status`
   handlers to record/return `queenType`. Add to `.claude-flow/hive-mind/state.json`
   schema.
4. **Annotate orphaned class**: add a top-of-file comment to
   `swarm/src/queen-coordinator.ts` noting "not currently wired into the
   hive-mind CLI; reserved for future daemon-resident coordinator (ADR-0106
   Option A1)".
5. **README reconciliation** (in fork README, prelude per ADR-0101):
   - Replace "Strategic (planning), Tactical (execution), Adaptive
     (optimization)" with "Queen leadership styles passed as prompt
     guidance: Strategic (high-level decomposition), Tactical (close
     supervision), Adaptive (pattern-driven adjustment). Differentiation
     is prompt-shaped, not algorithmic."
6. **Tests**: regression checks in `lib/acceptance-adr0107-checks.sh` +
   paired unit per ADR-0097 + live smoke noted in test plan above.
7. **Fork commit** with ADR-0107 reference; ruflo-patch companion commit
   with the acceptance lib + paired test.

If Option C (doc-only): just steps 4 and 5.

## Risks / open questions

- **R1 — prompt-shaped behavior is judged by the LLM**: even with crisp
  per-type prose, the actual leadership pattern depends on Claude's
  interpretation. Smoke tests of "strategic decomposes more than tactical"
  may be flaky. Acceptance regressions should assert prompt content, not
  Queen behavior.
- **R2 — V2 prose blocks may be wrong**: the V2 strategic block says
  "Make executive decisions when consensus fails" but the V3 hive
  consensus surface (per ADR-0106) has no failure path beyond
  worker-absence. Need to write fresh prose tuned to the V3 trust model
  and MCP surface, not blindly port V2.
- **R3 — interaction with ADR-0108 (mixed worker types)**: the tactical
  queen's "monitor worker progress" guidance assumes per-worker role
  specialization. If ADR-0108 doesn't ship before ADR-0107, the tactical
  prose may instruct the Queen to monitor distinctions that don't exist
  in the worker pool yet.
- **R4 — `QueenCoordinator` may stay orphaned forever**: marking it
  `@internal` is a parking signal. If the daemon transport (ADR-0106 A1)
  is never built, the 2030-LOC class is dead code. Worth checking in 6
  months whether to keep or remove.
- **R5 — V2 had `QueenMode = 'centralized' | 'distributed' | 'strategic'`**:
  a different label set entirely. ADR-0107 picks the README's labels
  (`strategic/tactical/adaptive`). The V2 modes aren't ported because they
  weren't actually wired through the CLI either (only `'distributed'`
  triggered a code branch in V2).

## Out of scope

- Wiring `QueenCoordinator` into the `hive-mind` command (Option A) — that
  blocks on the daemon-transport problem from ADR-0106 §A1.
- Adding a fourth queen type — the README claims three; this ADR honors
  the existing label set.
- Per-worker-role behavior — ADR-0108.
- Worker-failure handling and the "even when some agents fail" claim —
  ADR-0109.
- Memory backend questions — ADR-0110.
- Queen-vs-queen handoff in federated scenarios — separate future ADR
  (referenced from ADR-0106 §D).

## Recommendation

Ship **Option D (hybrid)**: per-type prompt prose + CLI validation + state
persistence + README correction.

Rationale:
- The README claim becomes honest: the three queen types produce three
  visibly different prompts that steer Claude toward three leadership
  styles. Acceptance tests can assert this in static prompt content.
- No silent fallback: `--queen-type banana` fails loudly per
  `feedback-no-fallbacks.md`.
- The orphaned `QueenCoordinator` class is annotated rather than deleted,
  preserving optionality if a future daemon-resident coordinator
  materializes (ADR-0106 §A1).
- Effort matches the deflationary recommendation pattern of ADR-0105 /
  ADR-0106: don't over-build a multi-process coordinator for a
  single-Queen-process trust model.

**Cross-reference to ADR-0105 (Topology) — load-bearing for this ADR**: ADR-0105's recommendation (consume both `TopologyManager` and `graph-backend.ts` per ADR-0111 §"Orphaned `swarm/src/` classes — per-class disposition") gives this ADR two primitives to draw on for the per-type prompt prose:
- **TopologyManager** (in-process state, wired per ADR-0105 Option C): authoritative topology field surfaced via `mcp__ruflo__hive-mind_status`. Strategic queen prompt can reference "current topology" deterministically; tactical queen can use `electLeader` semantics; adaptive queen can call `rebalance` when load shifts.
- **`graph-backend.ts`** (NAPI cross-hive durable graph, adopted via ADR-087 on next upstream merge): adaptive queen's "re-weight worker assignment based on observed success patterns" reads collaboration history via `getNeighbors(nodeId, hops)` and `recordCollaboration` calls.

These are **complementary, not substitutes** — strategic/tactical queens lean on TopologyManager (live state); adaptive queen leans on graph-backend (historical patterns). Don't pick one; the per-type prose blocks should reference the right primitive per role.

**`QueenCoordinator` (orphaned 2030-LOC class) — wire as daemon-resident advisor** (corrected per memory `feedback-no-value-judgements-on-features.md` — "import ALL features"). Earlier draft said "don't wire — conflicts with ADR-0104"; that was a value judgement to skip. Composition resolves the conflict:

- **Orchestrator** (ADR-0104, unchanged): Queen runs as `claude --claude` subprocess, spawns workers via Task tool, writes to `mcp__ruflo__hive-mind_memory`.
- **Advisor** (new wiring): QueenCoordinator runs in the long-lived ruflo daemon. Queen prompt calls `mcp__ruflo__queen_*` MCP tools that delegate to QueenCoordinator's deterministic logic — `queen_score_capabilities({task, agentIds})`, `queen_detect_stalls()`, `queen_recommend_replacement({stalledAgentId})`, `queen_select_topology_strategy({topology})`.
- Both ship; the prompt-driven Queen *consults* the TS class for deterministic decisions while staying in `claude` for orchestration.
- Annotation: `// QueenCoordinator runs as daemon-side advisor; ADR-0104's prompt-driven Queen is the orchestrator and calls into this class via MCP tools`.

This adds capability-scored task assignment, stall detection, automatic recovery, per-topology coordination strategies, and performance-pattern training — all the QueenCoordinator capabilities — without regressing ADR-0104. ~150-200 LOC of MCP-tool surface + the existing 2030-LOC class wired through. See ADR-0111 §"Orphaned `swarm/src/` classes — per-class wire-up plan" for the canonical plan.

A follow-up ADR (post-ADR-0109 worker failure handling) can decide whether
the adaptive queen's "re-weight worker assignment based on observed
success patterns" hooks back into ReasoningBank — that needs ADR-0108's
worker role taxonomy first.
