# ADR-0108: Mixed-type worker spawns

- **Status**: Investigating (no implementation choice made)
- **Date**: 2026-04-29
- **Roadmap**: ADR-0103 item 4
- **Scope**: hive-mind worker-type heterogeneity (`researcher` / `coder` /
  `analyst` / `tester` / `architect` / `reviewer` / `optimizer` /
  `documenter` — eight types, mixed in a single `spawn` call).

## Context

README claims, surveyed:

- Line 215: "👷 **8 Worker Types**: Researcher, Coder, Analyst, Tester,
  Architect, Reviewer, Optimizer, Documenter"
- Line 403: "🐝 Queen-led swarms with collective intelligence, 3 queen
  types, **8 worker types**"
- Line 2362: "**Worker Types** | 8 specialized agents | researcher, coder,
  analyst, tester, architect, reviewer, optimizer, documenter"
- Line 1630: `npx ruflo hive-mind spawn "Build API"` — single-objective
  CLI example, no per-type breakdown shown.

Reader's implication: one `spawn` call instantiates a mixed hive (e.g.
1 researcher + 2 coders + 1 tester + 1 reviewer), each worker
specialized to its role.

## Investigation findings

### Source archaeology — V3 is single-type at every layer

| File | Constraint |
|---|---|
| `v3/@claude-flow/cli/src/commands/hive-mind.ts:537–543` | `--type` option: `type: 'string'`, `default: 'worker'`, no `choices`, no array, no split. |
| `v3/@claude-flow/cli/src/commands/hive-mind.ts:530–536` | `--role` option: `choices: ['worker','specialist','scout']` (role, not domain type). |
| `v3/@claude-flow/cli/src/commands/hive-mind.ts:600,621–626` | `spawnAction` reads scalar `agentType`; forwards once to the MCP tool. |
| `v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts:285–350` | `hive-mind_spawn` schema: `agentType: { type: 'string' }` — scalar, no enum validation. Loop at line 312 creates `count` records all sharing the same `agentType`. |
| `v3/@claude-flow/cli/src/commands/hive-mind.ts:699–703` | Worker-record build applies `type: agentType` uniformly. |

So `--n 5 --type coder` produces five identical `agentType: 'coder'`
records. The only workaround for heterogeneity is calling `spawn`
multiple times — records accumulate in the state file.

### Source archaeology — orphaned 8-type enum

`v3/@claude-flow/swarm/src/types.ts:78–91` defines:

```ts
export type AgentType =
  | 'coordinator' | 'researcher' | 'coder' | 'analyst' | 'architect'
  | 'tester'      | 'reviewer'   | 'optimizer' | 'documenter'
  | 'monitor'     | 'specialist' | 'queen'     | 'worker';
```

Eight specialized worker types — exactly the README's eight — plus role
labels. **Not imported by `hive-mind.ts` or `hive-mind-tools.ts`.** The
`--type` flag accepts any string. A typo `--type fizzbuzz` succeeds
silently with no warning.

### V2 had this feature; V3 dropped it without an ADR

| V2 file:line | Behavior |
|---|---|
| `v2/src/cli/simple-commands/hive-mind.js:836–838` | `flags.workerTypes ? flags.workerTypes.split(',') : ['researcher','coder','analyst','tester']` (default 4, not 8). |
| `v2/.../hive-mind.js:842–870` | Round-robin: `workerType = workerTypes[i % workerTypes.length]`. |
| `v2/.../hive-mind.js:430–442` | Wizard offered all 8 types as checkboxes (first 4 checked by default). |
| `v2/.../hive-mind.js:2705–2752` | `getWorkerTypeInstructions(workerType)` — per-type prose injected into worker prompts (researcher/coder/analyst/tester/coordinator/architect; rest fell through to a generic template). |

V2 had `--worker-types`, modulo distribution, and per-role prompt prose.
V3's port lost all three. The migration doc
(`v3/implementation/v3-migration/HIVE-MIND-MIGRATION.md`, see ADR-0105)
flags the Queen as "Missing — needs implementation"; the worker-type
flow appears to have been collateral.

### Agent definitions inventory

`forks/ruflo/.claude/agents/hive-mind/` contains 5 agent definitions —
none per-domain-worker-type:
`collective-intelligence-coordinator.md`, `queen-coordinator.md`,
`scout-explorer.md`, `swarm-memory-manager.md`, and `worker-specialist.md`
(215 LOC; generic worker, describes Code/Research/Analysis/Test
sub-modes inline as JS examples, not separate files). **No**
`researcher.md` / `coder.md` / `analyst.md` / `tester.md` /
`architect.md` / `reviewer.md` / `optimizer.md` / `documenter.md`
files in this subtree. Whether the broader `.claude/agents/`
directory has reusable per-type files is open (R1).

### Generated Queen prompt — what workers see today

`generateHiveMindPrompt` (commands/hive-mind.ts:62–190) emits
`workerTypes = Object.keys(workerGroups)`. With every worker carrying
identical `agentType`, the prompt's `WORKER DISTRIBUTION` line is e.g.
`• coder: 5 agents` — a single bucket. **No per-role prose** is
injected. The §6 ADR-0104 worker-coordination contract (lines 168–178)
is also generic — no role-specific instruction is parameterized.

## Current state verdict

- ✅ 8-type enum (`AgentType`) exists in swarm package; V2 history
  has `--worker-types` flag + per-type prose ready for port.
- ❌ V3 CLI `--type` is scalar; no `--worker-types` flag.
- ❌ V3 MCP `agentType` scalar, no enum validation, no array form.
- ❌ V3 Queen prompt: no per-role prose; all workers generic.
- ❌ 8 type-named prompt files do not exist in
  `.claude/agents/hive-mind/`.
- ⚠️ Workaround: multiple `spawn` calls accumulate; a single
  invocation cannot.

## Decision options

### Option A — Add `--worker-types` flag (V2 parity, comma-separated)

1. Add `--worker-types` (string, comma-split) to
   `spawnCommand.options`. Validate against the 8-element domain
   subset of `AgentType` (excluding role labels). Reject unknown
   values per `feedback-no-fallbacks.md`.
2. `spawnAction`: parse to array; round-robin
   `types[i % types.length]` over `--n`. Mutex with `--type`.
3. Extend `hive-mind_spawn` MCP schema: optional
   `agentTypes: array<enum>`. Handler picks per-worker type; falls
   through to scalar when absent.
4. Enrich §6 worker-coordination contract: per-worker prose from a
   new `getWorkerTypeInstructions()` helper (port V2 dictionary +
   4 missing types: reviewer, optimizer, documenter, architect).
5. (Optional) author 8 `.claude/agents/hive-mind/{type}.md` files
   for canonical external prose; or keep inline in the helper.

**Parser concern** (per ADR-0104 §1): `--non-interactive` had to be
hoisted to `globalOptions` for the lazy-loaded `hive-mind` parser.
`--worker-types` is a string option (less ambiguous than boolean),
but smoke-test with positional args after the value
(`spawn --worker-types coder,tester "Build API"`) to confirm the
objective is not greedy-consumed.

### Option B — `--type` accepts JSON array

`--type '["coder","tester"]'` distributes across the array; scalar
backward-compatible. Cons: shell-quoting friction, value-shape
sniffing is the silent-fallback pattern memory
`feedback-no-fallbacks.md` warns against (typo `--type '[coder]'`
forces a choice between silent scalar fallback and hard error).

### Option C — Doc correction only

Document multi-spawn accumulation as the canonical mixed-hive
workflow ("spawn each type separately; workers accumulate"). CLI stays
single-type. Add enum validation to the MCP tool's `agentType` field
as a small safety fix even without flag changes.

### Option D — Hybrid: `hive-mind compose` subcommand

```
ruflo hive-mind compose --spec '{"researcher":1,"coder":2}' --claude -o "..."
```

Keeps `spawn` simple; powerful surface opt-in. Loops the spec, calls
`hive-mind_spawn` per type, chains into `--claude`. Heavier than V2's
flag for what is functionally batched spawn.

## Test plan

**Regression** (automated, runs in `test:acceptance`):

1. (A) `spawn -n 3 --worker-types researcher,coder,tester` →
   `hive-mind_status` returns 3 workers with distinct `agentType`
   values (set match, order unspecified).
2. (A) `--worker-types fizzbuzz` → CLI non-zero with
   `error: unknown worker type 'fizzbuzz'. Valid: researcher, ...`.
   Per `feedback-no-fallbacks.md`, no silent skip.
3. (A) `--worker-types researcher --type coder` → CLI non-zero
   (mutually exclusive).
4. (A/D) Generated Queen prompt's `WORKER DISTRIBUTION` lists each
   type with its count.
5. (A) Generated Queen prompt includes per-type prose (e.g.
   researcher → `WebSearch`/`research methodology` from helper).
6. (All) MCP `hive-mind_spawn` with `agentType: 'fizzbuzz'` rejects
   with enum-validation error.
7. **Parser regression** (ADR-0104 §1): `spawn --claude
   --worker-types researcher,coder --dry-run --non-interactive
   'Build API'` — positional `'Build API'` survives as objective.

**Live smoke** (developer's `claude` CLI, per ADR-0104):
`spawn --worker-types researcher,coder,tester,reviewer -n 4` with
objective "research, implement, test, and review a small CLI tool".
After: state.json shows 4 distinct types; each worker's
`worker-<id>-result` aligns with its role (research vs code vs test
report vs review notes — not 4× identical content); Queen log shows
role-specific subtask assignment.

**Unit** (`tests/unit/acceptance-adr0108-mixed-types-checks.test.mjs`,
paired per ADR-0097): flag parsing, round-robin distribution, enum
validation, mutex with `--type`, `getWorkerTypeInstructions()`
returns non-empty distinct prose for each of the 8 types.

## Implementation plan

If Option A (recommended):

1. **Type enum**: define a CLI-local `WORKER_TYPES = ['researcher',
   …, 'documenter']` (8 domain values) in
   `cli/src/commands/hive-mind.ts`. Avoids cross-package coupling.
2. **CLI flag** (`commands/hive-mind.ts:521–588`): add
   `--worker-types` (string, comma-split). Parse + validate + mutex
   with `--type` in `spawnAction`.
3. **MCP tool** (`mcp-tools/hive-mind-tools.ts:285–350`): extend
   schema with optional `agentTypes: array[enum]`. Handler at
   line 312 picks per-worker type (`agentTypes[i % len]`); falls
   through to scalar when absent. Add enum validation to scalar
   `agentType` simultaneously (Option C's fix).
4. **Prompt enrichment** (`commands/hive-mind.ts:62–190`): port V2's
   `getWorkerTypeInstructions(type)` helper, fill in 4 missing
   types (reviewer, optimizer, documenter, architect). Inject
   per-type prose into the §6 worker contract.
5. **Tests**: regression (acceptance lib) + paired unit per ADR-0097
   + one live smoke.
6. **Fork commit** ADR-0108 reference; ruflo-patch companion commit.
7. **README reconciliation** (with ADR-0101): keep "8 worker types"
   claim, add now-true single-spawn-mixed-types CLI example.

## Risks / open questions

- **R1 — agent definition source**: 8 type-named files don't exist
  in `.claude/agents/hive-mind/`. Per-type prose can be inline (V2
  approach) or external; whether reusable `coder.md` / `researcher.md`
  exist elsewhere in `.claude/agents/` is open.
- **R2 — parser scoping**: per ADR-0104 §1, smoke-test
  `--worker-types` with positional args after the value to confirm
  the objective is not greedy-consumed.
- **R3 — round-robin semantics**: V2 used modulo
  (`--worker-types coder,tester -n 5` → 3 coders + 2 testers). Lowest
  surprise; preserve.
- **R4 — interaction with ADR-0107 (queen types)**: Queen's per-type
  behavior may want to reason about the worker mix; wiring is
  ADR-0107's concern, but this ADR's data flow should not preclude it.
- **R5 — enum subset**: `swarm/src/types.ts` has 13 values mixing
  domain types and role labels. The validation enum exposed via
  `--worker-types` is the 8 domain values only.

## Out of scope

- Queen-side reasoning over the worker mix (ADR-0107).
- Worker-failure handling for a typed worker malfunction (ADR-0109).
- Cross-hive worker-type negotiation (federated scenarios).
- Adding worker types beyond the README's 8.
- Renaming `--type` to `--worker-type` for symmetry — back-compat
  cost outweighs the consistency gain.
- README rewrite of capabilities table — covered by ADR-0101.

## Recommendation

Ship **Option A** (V2-parity `--worker-types` flag + per-type prompt
prose), paired with Option C's enum-validation fix on the MCP tool.

Rationale: V2 had this exact feature; the V2→V3 port lost it without
an explicit decision. The 8-type enum already exists in the swarm
package, the README already promises the surface, and reusable
per-type prose exists in V2 source for direct port. Scope is
well-bounded — one new flag, one schema extension, one helper, one
prompt enrichment — with mutex against `--type` preserving the
single-spawn workflow.

Defer Option D (`compose` subcommand). If mixed-spec spawning grows
beyond comma-separated lists (weight specs, profiles, templates),
revisit then. V2-parity is the correct ceiling for now.

### Backward compatibility (per memory `feedback-no-value-judgements-on-features.md` — wire ALL features)

Option A is a **strict superset** of upstream's current `--type` surface. Every existing usage stays valid:

| Form | Upstream supports | Post-ADR-0108 |
|---|---|---|
| `spawn --type researcher -n 5` (single type, fan-out) | ✅ | ✅ — preserved as the degenerate single-element case of `--worker-types`. Internal handling: when only `--type` is given (and `--worker-types` absent), the round-robin loop sees a 1-element array, producing N identical workers. Identical observable behavior to today. |
| `spawn --type researcher` (single type, single worker) | ✅ | ✅ — preserved (same path). |
| `spawn --worker-types researcher,coder,tester -n 6` (NEW comma-separated, mixed) | ❌ | ✅ — new V2-parity surface. Round-robin: 2× researcher, 2× coder, 2× tester. |
| Worker prompt is `"You are a ${type} in the hive."` (free-form, no per-type prose) | ✅ | ✅ — preserved as the **fallback** when a `--worker-types` value has no per-type prose definition in `getWorkerTypeInstructions()`. Adding a worker-type via `--worker-types` that the helper doesn't know prints a warning + uses the free-form fallback. Per `feedback-no-fallbacks.md`, the warning is loud (not silent), but the spawn still proceeds — falling back to upstream's existing behavior preserves the upstream-supported worker shape. |
| 8-type enum validation (`--type fizzbuzz` rejected) | ❌ (silently accepts) | ✅ — added per Option C. **This is a behavioral change**: `--type fizzbuzz` now exits 1 with `[ERROR] Invalid worker type 'fizzbuzz'. Allowed: researcher, coder, analyst, tester, architect, reviewer, optimizer, documenter` (per `feedback-no-fallbacks.md`). Upstream's silent acceptance was a bug class, not a feature; closing it is honoring `feedback-no-fallbacks.md`, not breaking compat. |
| `--type` and `--worker-types` together | n/a | ❌ — mutex. Spec must use one or the other; using both exits 1 with `[ERROR] --type and --worker-types are mutually exclusive; use --worker-types for mixed spawns`. |

**Net**: every upstream-valid invocation continues to work post-ADR-0108. The only existing invocations that change behavior are unknown-type values (which were silent bugs); per `feedback-no-fallbacks.md` they should fail loud, and upstream's ADR-092 explicitly endorses domain-specific validators for this pattern. Backward-compat is preserved for all valid forms.

**Acceptance check** (regression): the existing acceptance harness asserts `spawn --type researcher -n 3` produces 3 worker records all with `agentType: 'researcher'`. After ADR-0108 this assertion stays — the round-robin path with a 1-element type array yields the same result.

**MCP tool surface** (`hive-mind_spawn`):
- Existing `agentType: <string>` parameter — preserved (single-type case).
- New `agentTypes: <array<enum>>` parameter — added (mixed-type case).
- Schema accepts either form; mutex enforced. Existing MCP-tool consumers using `agentType` see no change.
