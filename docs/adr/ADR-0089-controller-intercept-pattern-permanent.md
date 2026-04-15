# ADR-0089: Controller Intercept Pattern as Permanent Layer 2 Design

- **Status**: Proposed
- **Date**: 2026-04-15
- **Scope**: Patch repo (ADR) + acceptance tests. No code changes.
- **Supersedes (partial)**: ADR-0075 Layer 2 ideal; ADR-0076 Phase 4 acceptance criteria #1-#3
- **Related**: ADR-0076 (phased plan), ADR-0077 (intercept pattern introduction), ADR-0082 (no silent fallbacks), ADR-0087 (adversarial prompting)

## Context

ADR-0075 defined Layer 2 of the ideal architecture as:

> "One registry owns all controller lifecycles. AgentDB becomes a library the
> registry calls, not a self-contained app. AgentDBService is deleted. The
> 7-level init ordering is preserved."

ADR-0076 Phase 4 translated this into 7 acceptance criteria, three of which
were source-structural:

1. `agentdb-service.ts` is deleted
2. `grep -r "AgentDBService" agentic-flow/src/` returns zero hits
3. `wc -l controller-registry.ts` is under 500 lines

ADR-0077 introduced the **intercept pattern** as an upstream-merge-compatible
alternative:

- `controller-intercept.ts` exposes a module-level `getOrCreate(name, factory)` pool
- Both `ControllerRegistry.get()` and `AgentDBService` constructors wrap their
  instantiations in `getOrCreate()`
- Same name → same cached instance, regardless of which entrypoint was used

ADR-0076 shipped Phases 0-4 with the intercept pattern and explicitly deferred
the three structural criteria:

> "What was NOT done (by design, per ADR-0077):
> - `agentdb-service.ts` — kept (upstream file, wrapped with getOrCreate instead of deleted)
> - `controller-registry.ts` — NOT split into 3 files (merge conflict risk too high)"

**Two years later** (in the Layer 4 progress audit, 2026-04-15), these deferrals
were scoring Layer 2 at 65-75% despite:

- All runtime behavior matching ADR-0075's intent
- 21 unit tests (`adr0076-phase2-5.test.mjs`, `adr0076-controller-intercept-contract.test.mjs`) passing
- Zero reported cache divergence, state drift, or instance identity bugs
- Full acceptance suite (242/242) passing
- `agentdb-service.ts` having **80+ live call sites across 12 files** in upstream

The audit revealed that ADR-0075's Layer 2 definition **conflates two goals**:

| Goal | Status |
|---|---|
| **Behavioral unity** — one instance per controller type at runtime, consistent state across entrypoints | **Achieved** via intercept pattern |
| **Structural unity** — one source file, one class, one registry | **Deferred** by ADR-0077 for upstream merge compatibility |

ADR-0075 treated these as equivalent. They are not. Behavioral unity is the
thing that matters for production correctness. Structural unity is an
aesthetic preference that trades off against upstream merge cost.

## The original ADR-0075 bugs — status check

The five problems ADR-0075 listed for Layer 2:

| # | Problem | Status |
|---|---|---|
| 1 | Divergent in-memory caches across `ControllerRegistry` and `AgentDBService` | **FIXED** by `controller-intercept.ts` `getOrCreate()` pool |
| 2 | 13 controllers constructed in both registries, different object instances | **FIXED** — both entrypoints route through the same pool |
| 3 | ADR-0069 F1 delegation never landed (zero `getController()` calls in AgentDBService) | **FIXED** by `controller-bridge.ts` adapter |
| 4 | `controller-registry.ts` over 500-line rule (2063 LOC) | **Still true** — aesthetic, not functional |
| 5 | Two missions in one project (upstream dev + repackaging) | **Unresolved philosophical concern** |

**Three of five problems are genuinely solved.** The remaining two are
aesthetic (#4) and philosophical (#5), neither of which causes incorrect
runtime behavior.

## Decision

### 1. Supersede ADR-0075 Layer 2 definition

Replace:

> "One registry owns all controller lifecycles. AgentDB becomes a library the
> registry calls, not a self-contained app. AgentDBService is deleted."

With:

> "All controller instances at runtime resolve through a single shared pool
> (`controller-intercept.ts`). `ControllerRegistry.get(name)` and
> `AgentDBService.getInstance()` return byte-identical objects for the same
> controller name. The 7-level init ordering is preserved. `AgentDBService`
> and `ControllerRegistry` remain as separate source files to preserve
> upstream merge compatibility — they are structurally parallel but
> behaviorally unified."

### 2. Supersede ADR-0076 Phase 4 acceptance criteria #1-#3

**Removed criteria:**

- ~~`agentdb-service.ts` is deleted~~
- ~~`grep -r "AgentDBService" agentic-flow/src/` returns zero hits in production code~~
- ~~`wc -l controller-registry.ts` is under 500 lines~~

**Replaced with:**

1. `AgentDBService` constructor wraps every `new FooController(...)` call in
   `getOrCreate('foo', () => new FooController(...))` — verified by source grep
2. `ControllerRegistry.get('foo')` and `AgentDBService.getInstance()` then `foo`
   property return the same object reference (verified by behavioral test)
3. The 7-level init ordering is preserved (unchanged from the original criteria)
4. `controller-intercept.ts` pool survives a module reload without losing
   registered instances (prevents a class of regressions where the pool is
   reset by transient module loaders)

### 3. Acceptance criteria #4-#7 from ADR-0076 Phase 4 remain unchanged

- All 16+ MCP tool call sites route through `ControllerRegistry` (via bridge adapter)
- No `InMemoryStore` class exists in production code
- The 7-level init ordering is preserved
- Full acceptance suite passes

### 4. Accepted trade-off: 500-line rule for `controller-registry.ts` and `agentdb-service.ts`

The project style rule ("files under 500 lines") is explicitly **not
enforced** on `controller-registry.ts` (2063 LOC) and `agentdb-service.ts`
(1831 LOC). Both files are upstream-maintained; splitting them would require
permanent merge-conflict maintenance for cosmetic gain.

Engineers looking at these files should not treat their size as a TODO.
They should treat the intercept pattern as the intended design.

## Required regression test (from adversarial review)

The intercept pattern's correctness depends on `AgentDBService` wrapping its
constructor calls through `getOrCreate()`. If a future upstream merge
refactors AgentDBService's constructor patterns — e.g., swaps to factory
functions, adds dependency injection, moves instantiation to a new helper —
the intercept could silently stop working. Cache divergence would return
without a test failure.

**Add `tests/unit/adr0089-intercept-enforcement.test.mjs`** that greps the
upstream `agentdb-service.ts` source for every `new [A-Z][a-zA-Z]*Controller`
pattern and asserts each one is inside a `getOrCreate(` wrapper within a
reasonable line distance. Fail loudly with a clear error pointing at the
unwrapped constructor.

**Add `check_adr0089_intercept_pool_live`** to
`lib/acceptance-adr0089-checks.sh` that:

1. Runs `cli mcp exec --tool agentdb_health` to force controller init
2. Runs a second identical invocation
3. Verifies both invocations report the same controller count + instance IDs
   (same pool, not two parallel initializations)

These guards catch the "behavioral unity silently broken" class of
regressions that would otherwise only surface as production bugs months later.

## Revisit trigger

ADR-0089 is **not final**. It is the right call today but must be reviewed if
any of these happen:

1. **Upstream deletes `AgentDBService`** — per ADR-0075's creator correction
   ("AgentDBService IS scaffolding, going away"). If ruvnet/agentic-flow
   actually drops the file, we follow suit: delete `controller-intercept.ts`,
   delete `controller-bridge.ts`, migrate any remaining call sites to
   `ControllerRegistry.get()` directly.
2. **Upstream refactors `AgentDBService` constructors** in a way that
   defeats the intercept — detected by the regression test added above.
   Response: rewrite the intercept or accelerate deletion.
3. **A cache-divergence bug is reported in production** — the intercept was
   supposed to prevent this class. If it doesn't, the intercept is broken
   and we need a different design.
4. **The 500-line debt on `controller-registry.ts` starts actually blocking
   feature work** — e.g., we're hitting merge conflicts in every PR because
   the file is too unwieldy. Then the aesthetic rule becomes a functional
   cost and we revisit the split.

Every quarter, someone should check (1) — upstream AgentDBService status —
and update this ADR's status if the situation has changed.

## Consequences

### Positive

- **Layer 2 scores 100%** against a coherent, revised definition — no longer
  "75% + debt items" forever
- **Zero code changes** — the intercept pattern already ships
- **Future engineers** won't waste time "fixing" AgentDBService's file size
  as a TODO — the ADR tells them it's intentional
- **Regression guard added** — the new test catches upstream refactors that
  silently bypass the pool
- **Upstream merge cost** stays at its current low level — we don't touch
  1,831 LOC of upstream-maintained code

### Negative

- **Goalpost perception risk**: a reader comparing ADR-0075 to ADR-0089 might
  conclude we quit. Mitigation: this ADR is explicit about what changed and
  why. The 75% score is acknowledged as the pre-ADR-0089 state.
- **Latent bypass risk**: if the regression test is removed or weakened, the
  intercept pattern can silently stop working. Mitigation: the test is loud
  and its purpose is documented in both the ADR and the test file itself.
- **Upstream divergence risk**: if upstream deletes `AgentDBService` and we
  don't notice, our intercept infrastructure becomes dead code. Mitigation:
  quarterly revisit trigger.

### Trade-offs

- **File size rule** sacrificed for **upstream merge compatibility**. This is
  an explicit choice, not a drift. Both values matter; one wins.
- **Structural "single registry" goal** sacrificed for **behavioral "single
  instance per type" goal**. The latter is what production correctness cares
  about; the former is what architectural diagrams care about.

## Alternatives Considered

### A. Execute the original ADR-0076 Phase 4 deletion (3-5 days)

Delete `agentdb-service.ts`, migrate 80+ call sites across 17 files, split
`controller-registry.ts` into 3 files under 500 LOC each. Close the gap by
actually doing the work.

**Rejected**: the 3 ADR-0075 problems it would solve are already solved by
the intercept pattern. The remaining benefits are aesthetic. The cost is 3-5
days plus permanent upstream merge tax on 17 files forever. Cost exceeds
benefit by roughly 10:1.

### B. Leave Layer 2 at 75% forever, accept the debt

Don't write ADR-0089. Accept that ADR-0075's definition of ideal includes
goals we won't meet. Let Layer 2 score as "75% with accepted trade-off".

**Rejected**: the 75% score is misleading in both directions. It suggests
either "there's work left to do" (false — the work is deferred by design) or
"this is a genuine gap" (false — it's a deliberate trade-off). Future
engineers reading the progress report will waste time investigating a
non-problem. The right fix is to update the definition of "done" to match
reality, with explicit reasoning and revisit triggers.

### C. Add a source-grep test without writing an ADR

Just add the regression test and move on. No doc change.

**Rejected**: tests enforce rules; ADRs explain them. A future engineer
opening the test file and asking "why is this rule here?" needs a document
to read. ADR-0089 is that document.

### D (chosen): Supersede the three Phase 4 structural criteria; add regression test; define revisit trigger

~150 lines of ADR + one unit test file + one acceptance check. Zero
production code change. Explicit trade-off documentation. Clear revisit
trigger.

## Files Affected

**Patch repo (this commit):**

- `docs/adr/ADR-0089-controller-intercept-pattern-permanent.md` (new, this file)
- `docs/adr/ADR-0075-architecture-state-assessment.md` — add cross-reference to ADR-0089 under Layer 2 in the "Ideal End State" section
- `docs/adr/ADR-0076-ideal-state-implementation-plan.md` — mark Phase 4 acceptance criteria #1-#3 as SUPERSEDED BY ADR-0089

**Patch repo (follow-up commit if the decision is approved):**

- `tests/unit/adr0089-intercept-enforcement.test.mjs` — new unit test
- `lib/acceptance-adr0089-checks.sh` — new acceptance check file
- `scripts/test-acceptance.sh` — wire the new check via `run_check_bg` + `collect_parallel`
- `CLAUDE.md` — add a lesson under "What We Tried and Won't Try Again":
  "Deleting upstream-maintained files to satisfy the 500-line rule —
  upstream merge tax exceeds aesthetic gain; intercept pattern achieves
  runtime unity without source deletion (ADR-0089)"

**No fork changes.** The intercept pattern already ships.

## Score after this ADR

| Layer | Before ADR-0089 | After ADR-0089 |
|---|---|---|
| L1 (Storage) | 95% | 95% |
| L2 (Controllers) | **75%** (or 65% with AgentDBService honest count) | **100%** (revised definition) |
| L3 (Embeddings) | 90% | 90% |
| L4 (Config) | 95% | 95% |
| L5 (Data Flow) | 98% | 98% |
| **Weighted total** | **~88%** | **~94%** |

The 6-point bump is not more work being done — it is the Layer 2 definition
being aligned with what actually needs to be true for a patch repo that ships
upstream-compatible code.

The remaining ~6% gap to 100% is:

- L1: neural SQLite trade-off (accepted, upstream-coupled)
- L3: a few scattered `cosineSimilarity` implementations in non-critical paths
- L4: a small number of config-resolution sites that may still read from disk independently
- L5: upstream sql.js fallback for edge environments (intentional)

None of these are fixable without upstream divergence or ignoring accepted
trade-offs.

## References

- ADR-0075 (§"Ideal End State" / "Layer 2: Single Controller Registry") —
  the original definition this ADR supersedes
- ADR-0076 (§"Phase 4: Single Controller Registry", §"What was NOT done") —
  the phased plan and its deferred items
- ADR-0077 — the intercept pattern introduction that made this ADR possible
- `controller-intercept.ts`, `controller-bridge.ts` — the code
- `tests/unit/adr0076-controller-intercept-contract.test.mjs` — the existing
  pool behavioral test that this ADR references
- 5-agent ADR-0088 validation session (2026-04-15) — where the 75% Layer 4
  score was surfaced and the intercept trade-off was examined
