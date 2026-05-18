---
status: proposed
date: 2026-05-12
tags: [router, mcp, init-template, silent-fallback, axis-separation, adr-0082, adr-0166, adr-0170]
supersedes: []
depends-on: [ADR-0082, ADR-0147, ADR-0166, ADR-0170]
implements: []
---

# Router silent-fallback and disabled-controller audit

## Context and Problem Statement

A user investigation of a different ruflo project surfaced three concrete bugs:

1. **`agentdb_hierarchical_store` silently dropped** — controller stub returns success, writes nowhere.
2. **`agentdb_graph_node_create` / `agentdb_graph_edge_create` silently dropped** — fixed by ADR-0170 Phase D (graph-node retired), but the underlying anti-pattern (MCP tool reports success while writing nothing) is wider than the graph axis.
3. **`agentdb_causal-edge` routes to RVF `namespace=causal-edges`** instead of the SQL `causal_edges` table — labelled ADR-0147 R7 TODO, never resolved.

ADR-0170 (substrate replacement, accepted 2026-05-12) ported all 14 SQL-bearing controllers from SQLite to PostgreSQL and enforced fail-loud at the substrate boundary, but it did **not** touch:

- The init template's `controllers.enabled` defaults
- The CLI memory-router's cross-axis "router-fallback" pattern
- The MCP tool registry's handling of disabled controllers

A systematic grep across `forks/ruflo/v3/@claude-flow/cli/src/init/config-template.ts` and `forks/ruflo/v3/@claude-flow/cli/src/memory/memory-router.ts` shows the user's three bugs are the visible tip of a larger pattern. The pattern violates ADR-0082 (no silent fallback), ADR-0166 (axis-separation: memory_*=RVF, agentdb_*=PostgreSQL), and ADR-0170's substrate fail-loud contract.

### Audit findings

**Disabled-by-default controllers in `init/config-template.ts:151-165`** (8 of 12 listed; only `reasoningBank`, `causalRecall`, `nightlyLearner`, `attentionService`, `agentMemoryScope` default to `true`):

| Controller | Default | Status post-ADR-0170 |
|---|---|---|
| `queryOptimizer` | `false` | Ported, available, disabled |
| `auditLogger` | `false` | n/a (no controller of that name in fork) |
| `batchOperations` | `false` | Ported, available, disabled |
| `hierarchicalMemory` | `false` | Ported, available, disabled — user's bug #1 |
| `memoryConsolidation` | `false` | Ported (Wave 1b B-10), available, disabled |
| `hybridSearch` | `false` | Cross-axis search, available, disabled |
| `federatedSession` | `false` | Deprecated per ADR-0068 — correctly off |

Five working controllers ship disabled in every fresh `ruflo init`. The corresponding `mcp__ruflo__agentdb_*` MCP tools exist and are registered; users (or hives/swarms) calling them hit either an explicit "AgentDB not available" error or the silently-noop controller stub path.

**Cross-axis router fallbacks in `memory-router.ts`** (7 sites, grep `namespace: '[a-z-]+'`):

| Line | Op | Controller tried | RVF fallback namespace | Marker |
|---|---|---|---|---|
| 1726 | pattern search | ReasoningBank | `'pattern'` | `controller: 'router-fallback'` |
| 1795 | feedback record | LearningSystem + ReasoningBank | `'feedback'` | "guaranteed persistence" (parallel write, always fires) |
| 1839 | session start (search past patterns) | ReflexionMemory | `'session'` | controller marker |
| 1885 | session end | ReflexionMemory | `'session'` | controller marker |
| 2083 | causal edge record | CausalMemoryGraph | `'causal-edges'` | `controller: 'router-fallback'` — user's bug #3 |
| 2148 | causal query | CausalMemoryGraph | `'causal-edges'` | merge-controller-and-namespace |
| 2160 | causal query (recall) | CausalRecall | `'causal-edges'` | same |

Every site shares the pattern: try the agentdb_* controller; on failure (controller missing, method absent, exception caught) silently write/read RVF (memory_* axis) with a controller-specific namespace, return `success: true` with a `'router-fallback'` marker. From the caller's perspective, the call succeeded — but the data landed on the wrong axis. ADR-0166's axis-separation rule is violated; ADR-0082's no-silent-fallback rule is violated.

**The `feedback-{taskId}` pattern is the worst case.** Line 1788-1801: regardless of whether LearningSystem/ReasoningBank succeeded, the router ALWAYS writes a feedback entry to RVF `namespace='feedback'`. This isn't a fallback — it's a parallel write, mirroring the now-retired ADR-0085 "bridge" pattern. Data lands in two places; the canonical store can change between calls; deduplication is impossible.

**MCP tool handler patterns** (sample from `mcp-tools/agentdb-tools.ts`): handlers attempt the controller method and use the `result ?? { success: false, error: 'AgentDB not available...' }` idiom. When the controller is disabled in init config, `result` is undefined and the handler returns `success: false` with a generic error — fail-loud in form, but the diagnostic doesn't tell the user "controller X is disabled in `.claude-flow/config.json`, flip `controllers.enabled.X` to `true`". The user just sees "AgentDB not available" and assumes a substrate problem.

### Why this matters

The three layers (init template defaults, router fallbacks, MCP tool diagnostics) compound:

1. Fresh `ruflo init` ships with 5 working controllers disabled.
2. User invokes `agentdb_hierarchical_store` via MCP — the controller is disabled, the tool returns "AgentDB not available", the user assumes setup is broken.
3. User invokes `agentdb_causal-edge` — the controller IS enabled, but the router silently writes to RVF namespace=`causal-edges`. The user sees `success: true` and assumes data lands in the SQL `causal_edges` table.
4. Skills documented against the intended-state (controllers on, data in canonical tables) lie to their consumers because the runtime doesn't match the documentation.

This is the data-loss-in-success-suit pattern that `feedback-data-loss-zero-tolerance` exists to ban. ADR-0170 fixed the substrate; this ADR fixes the layers above it.

## Decision Drivers

* **ADR-0082 (no silent fallback)** — the router-fallback marker IS the silent fallback ADR-0082 was meant to prevent. Fixed in some places (substrate boundary per ADR-0170), violated in others (CLI router).
* **ADR-0166 axis-separation** — memory_* axis is RVF, agentdb_* axis is PostgreSQL. The router fallbacks cross the axis silently.
* **ADR-0170 fail-loud contract** — applies at the substrate but stops at the router. The router's "guaranteed persistence" + "router-fallback" patterns predate ADR-0170 and were not in its scope.
* **ADR-0147 R7 TODO** — the causal-edge case was acknowledged 2026-04-XX; never closed. R7 covers ONE of seven sites.
* **Skill/MCP contract** — when a skill calls `mcp__ruflo__agentdb_*`, the contract is that data lands in the named axis. Silent cross-axis writes break that contract for every consumer that depends on it.
* **Diagnostic quality** — "AgentDB not available" without the controller-is-disabled diagnostic forces every user to debug what's actually a config flag. Per `feedback-no-fallbacks` spirit: fail loud and *useful*.
* **User-binding directive 2026-05-11 ("postgres, or fail fast, fail loud")** — same posture, different layer. The router needs the same posture as the substrate.

## Considered Options

* **Option A** — Status quo. Keep the disabled-by-default controllers off, keep the router fallbacks, document the gotcha. Rely on advanced users to flip flags. (Equivalent to "skip the bug, document the workaround".)
* **Option B** — Enable all working controllers by default in init template. Keep router fallbacks as defence-in-depth. Add diagnostic improvement for the "disabled in config" case. **Partial fix.**
* **Option C** — Enable controllers by default AND retire all router fallbacks. The agentdb_* axis tools must succeed against agentdb_* (PostgreSQL) or throw with controller-disabled diagnostic. Cross-axis writes from the router are removed entirely. **Full fix; matches ADR-0170 substrate posture at the router layer.**
* **Option D** — Make the router fallback explicit at the MCP boundary: rename `agentdb_causal-edge` → `memory_causal-edge` (or similar) when the data demonstrably belongs to memory_* axis. Tools that demand SQL persistence stay agentdb_*; tools that work-with-fallback move to memory_*. The router's job becomes routing by tool name, not by controller availability.
* **Option E** — Reopen the axis-separation question. Allow controllers to span axes officially (memory_*=RVF and agentdb_*=PostgreSQL becomes memory_*=RVF *or* PostgreSQL, agentdb_*=PostgreSQL *or* RVF) with explicit routing rules. **Architecturally invasive; contradicts ADR-0166.**

## Decision Outcome

Chosen option: **Option C** — Enable controllers by default + retire router fallbacks. The MCP tool surface and the router both adopt the fail-loud posture ADR-0082 + ADR-0170 already enforce at the substrate.

### Rationale

1. **The fallback-success masking is the actual bug.** The user's investigation showed that consumers of `agentdb_causal-edge` see success but data lands wrong. Option B (keep fallbacks) leaves this behaviour in place. Option D solves it by renaming tools, but that's a breaking API change for every skill/consumer and a permanent fork from upstream ruflo's tool naming.
2. **ADR-0166's axis-separation is load-bearing.** Cross-axis silent writes break the framing. Options that keep them either contradict ADR-0166 (Option E) or accept the contradiction (Option B).
3. **Diagnostic improvement is achievable.** Today's "AgentDB not available" can become "Controller `hierarchicalMemory` is disabled in `.claude-flow/config.json` (`controllers.enabled.hierarchicalMemory: false`). Flip to `true` to use this tool." — a one-line config edit. The user gets to "fixed in 30 seconds" instead of "fixed in 30 minutes of substrate debugging".
4. **The retiring case (federatedSession per ADR-0068) is intentionally off and stays off.** Option C doesn't blindly flip every flag — it flips the ones whose controllers are alive and ported. Deprecated controllers keep their disabled default.

### Phased plan

**Phase A — diagnostic improvement (low risk, immediate).**

1. Update every MCP tool handler in `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/agentdb-tools.ts` (49 tools) to detect the "controller disabled in config" case explicitly. Return:
   ```
   { success: false, error: "Controller `${name}` is disabled in .claude-flow/config.json (controllers.enabled.${name}: false). Flip to `true` to use this tool." }
   ```
   instead of the generic "AgentDB not available".
2. Acceptance test covering each of the 5 disabled-by-default controllers: invoke MCP tool, assert the diagnostic carries the config-flag name.

**Phase B — enable controllers by default.**

1. `forks/ruflo/v3/@claude-flow/cli/src/init/config-template.ts:151-165` — flip the 5 ported-but-disabled controllers (`queryOptimizer`, `batchOperations`, `hierarchicalMemory`, `memoryConsolidation`, `hybridSearch`) from `false` to `true`. Leave `federatedSession: false` (deprecated per ADR-0068) and `auditLogger` (no controller of that name) untouched.
2. Acceptance test: fresh `ruflo init` produces a config where all 11 alive controllers default to `true`.
3. Migration: existing `.claude-flow/config.json` files keep their current flags (no auto-edit). Users opt in by re-running `ruflo init` or hand-editing the config.

**Phase C — retire router cross-axis fallbacks.**

The 7 sites (memory-router.ts lines 1726, 1795, 1839, 1885, 2083, 2148, 2160) each get one of three treatments:

| Site | Treatment |
|---|---|
| 1726 (pattern search) | If ReasoningBank fails, throw with diagnostic. No `namespace: 'pattern'` RVF fallback. |
| 1795 (feedback record) | Drop the "guaranteed persistence" RVF parallel write. LearningSystem/ReasoningBank are the canonical persistence; if both fail, throw. |
| 1839, 1885 (session start/end) | Drop the `namespace: 'session'` RVF fallback. ReflexionMemory is canonical; if it fails, throw with diagnostic. |
| 2083 (causal edge record) | Drop the `namespace: 'causal-edges'` RVF fallback per ADR-0147 R7. CausalMemoryGraph is canonical; if it fails, throw. |
| 2148, 2160 (causal query) | Drop the merge-with-namespace pattern. CausalMemoryGraph/CausalRecall are canonical; if both fail, return `success: false` with diagnostic. No "merge-and-mask" behaviour. |

Per `feedback-no-fallbacks`: the diagnostics name the missing controller, the underlying error, and the config-flag remediation when applicable.

Acceptance tests update accordingly — any test that asserted `controller: 'router-fallback'` is rewritten to assert the canonical controller succeeds or the explicit error message surfaces.

**Phase D — sweep for sibling patterns.**

Grep across both forks for:
- `'router-fallback'` controller marker (any remaining sites)
- `namespace:\s*'[a-z-]+'` inside agentdb_* route functions (any new RVF cross-axis writes)
- `?? { success: false` (generic error pattern that should carry controller diagnostic)
- Similar fallback patterns in `forks/agentic-flow/agentic-flow/src/services/agentdb-service.ts` and elsewhere

Any site that survives the sweep is either renamed (Option D-style — move to memory_* tool naming) or retired (Option C-style — fail loud).

### Consequences

* Good, because `agentdb_*` MCP tools now report honestly: "controller X is disabled in your config" is actionable; "AgentDB not available" was not.
* Good, because every fresh `ruflo init` ships with the full agentdb_* surface enabled. Skills documented against the intended state work out of the box.
* Good, because the axis-separation rule (ADR-0166) is enforced at the router boundary, not just the substrate boundary. Memory_* writes land in RVF; agentdb_* writes land in PostgreSQL. No silent cross-axis leak.
* Good, because the `feedback-{taskId}` parallel-write pattern (ADR-0085-residue) retires. Single source of truth for feedback data.
* Good, because ADR-0147 R7 TODO finally closes (causal-edge specifically), and the six sibling sites get the same treatment in one pass instead of seven separate ADRs.
* Bad, because consumers (skills, hives, swarms) that *relied* on the router-fallback success may break — they were writing to one axis and reading from another silently, and the new fail-loud surface makes the inconsistency explicit. Migration: rerun `ruflo init` to enable the controllers, or update consumers to call the right tool for the axis.
* Bad, because diagnostic improvements (Phase A) touch every MCP tool handler (49 tools in `agentdb-tools.ts`). Mechanical work but real LoC.
* Neutral, because the fork now diverges from upstream `claude-flow`'s default config layout. Upstream ships with these controllers disabled too (verified — fork's default mirrors upstream's). Phase B's defaults flip is fork-internal; upstream-sync work must respect that the fork's config-template has different default truthiness.

### Confirmation

Compliance is verified by:

1. **Phase A complete** when an acceptance test invokes each of the 5 disabled-by-default controller MCP tools against a config that explicitly disables it, and the response error message contains the controller name + the `controllers.enabled.<name>` config path.
2. **Phase B complete** when a fresh `ruflo init` produces a `.claude-flow/config.json` where `controllers.enabled.{hierarchicalMemory, memoryConsolidation, batchOperations, queryOptimizer, hybridSearch}` are all `true`, and acceptance covers the full agentdb_* surface against the default config.
3. **Phase C complete** when `grep -nE "controller: 'router-fallback'|namespace: '(pattern|feedback|session|causal-edges)'" forks/ruflo/v3/@claude-flow/cli/src/memory/memory-router.ts` returns zero hits inside route handlers (matches inside comments documenting the retirement are allowed).
4. **Phase D complete** when the cross-axis-leak sweep finds zero sites in both forks, AND the acceptance suite covers the canonical (controller-succeeds) and failure (controller-throws) paths for each formerly-fallback route.

### Out of scope

* **Renaming MCP tools** (Option D). The fork keeps upstream's tool names; only the routing behaviour changes.
* **Reopening axis-separation** (Option E). ADR-0166's framing stays.
* **Substrate work**. ADR-0170 handled that; this ADR sits one layer above.
* **Migration of existing user data** when controllers flip from disabled to enabled by default. Users who ran ruflo init earlier and stored data via the router-fallback path have that data in RVF namespaces (`feedback`, `session`, `causal-edges`, etc.). Phase C does NOT auto-migrate that data to the canonical agentdb_* tables. Migration is a separate ADR (or a manual one-shot CLI) if/when needed; the loud-fail diagnostic surfaces the inconsistency.

## More Information

### Related ADRs

* **ADR-0082** — Loud-fallback rule. This ADR extends ADR-0082's scope from the substrate boundary (where ADR-0170 enforces it) to the CLI router boundary.
* **ADR-0147 R7** — Refinement #7 of ADR-0147 acknowledged the causal-edge specific router fallback. This ADR generalises and closes R7 alongside its six siblings.
* **ADR-0166** — Axis-separation (memory_*=RVF, agentdb_*=postgres). The cross-axis fallbacks documented here directly contradict ADR-0166 §"What this means for memory_* axis".
* **ADR-0170** — Substrate replacement (SQLite → pglite). Substrate boundary is fail-loud; this ADR is the parallel work at the router boundary.
* **ADR-0085** — Best-effort wrappers (retired). The "guaranteed persistence" feedback-{taskId} parallel write is an ADR-0085-style residue not cleaned up when ADR-0085 was deprecated.

### Surfacing trigger

User investigation 2026-05-12 (different ruflo project, post-ADR-0170): the report identified `agentdb_hierarchical_store` silent drop, `agentdb_graph_node_create/edge_create` silent drops (since-fixed by ADR-0170 Phase D), and `agentdb_causal-edge` cross-axis route. The investigation framed these as three discrete bugs; this ADR audits the surrounding layers and finds the same pattern at 12+ sites (5 init defaults + 7 router fallbacks), proposing systematic remediation.

### Estimated work

Per `feedback-no-time-estimates`: not stated. Phase A is mechanical (49 handlers, 1 diagnostic per); Phase B is a 5-line config change + tests; Phase C is 7 router-site rewrites + test updates; Phase D is a sweep. Sequential dependencies: Phase A unlocks Phase B (config flip needs the new diagnostic to make sense to users); Phase B unlocks Phase C (router fallbacks can retire once controllers are reliably available). Phase D last as confirmation.

## Amendments

### Amendment: Current state (2026-05-18)

Status kept `proposed` per the 2026-05-18 ADR status audit. **No
implementation work to date** — zero fork-code references to `ADR-0172`
across `forks/{ruflo,agentdb,ruvector,agentic-flow}` and no acceptance
or unit tests target this ADR. The three named deliverables remain open:

1. **Audit of `memory-router.ts` drop-to-`'router-fallback'` paths** at
   `forks/ruflo/v3/@claude-flow/cli/src/memory/memory-router.ts` lines
   1979, 2338, 2464 (the cross-axis-leak sites Phase C is supposed to
   retire).
2. **Disabled-controller inventory in `controller-registry.ts`** —
   document each of the 5 disabled-by-default controllers and the
   loud-fail diagnostic Phase A requires.
3. **`hierarchicalMemory: false` / `memoryConsolidation: false`
   default-false audit** at
   `forks/ruflo/v3/@claude-flow/cli/src/init/config-template.ts:202-203`
   — Phase B's config-flip target. Currently both defaults remain
   `false`; Phase B has not landed.

**Caveat from substrate-posture shift.** ADR-0172 was written depending
on ADR-0170 (postgres/pglite substrate). ADR-0177 superseded ADR-0170
and retired the postgres/pglite direction — Phase B's "substrate
boundary fail-loud" framing inherits substrate context from a retired
ADR. The router-boundary fail-loud principle survives; the substrate
referent does not. Any future execution of this ADR must re-frame Phase
B against the ADR-0177 / ADR-0180 archivist substrate seam, not
postgres.
