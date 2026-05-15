---
status: proposed
date: 2026-05-14
tags: [memory, architecture, mcp, substrate, runtime-activation]
depends-on: [ADR-0180]
implements: []
---

# ADR-0181: Archivist Runtime Activation (F4-2 / F4-3)

## Context and Problem Statement

ADR-0180 adopted the Memory Archivist and ran its 10-phase Execution Plan to structural completion: the archivist tree (`forks/agentdb/src/archivist/**`) holds 163 `.ts` files across 22 handler surfaces, the type-enforced substrate seam, audit chain, hot-path queue, governance charter, bench harness, and load scenarios. F4-2 Phases A–C then made the substrate seam *live* — substrate factories (`makeSqliteSubstrate`/`makeRvfSubstrate`/`makeFsJsonSubstrate`), the `initialize()` substrate registry, `getSubstrate()` resolution, read-optimized `query`/`vectorSearch`, the multi-file atomic-write primitive, and audit-writer integration.

But the archivist is **scaffolded, not live on the write path**. F4-2 Phase B's scope audit found the picture ADR-0180 §Implementation Status records honestly:

* **~88 of 118 handler files still throw `pending` stubs.** ADR-0180's "14 `TODO(F4-2)` handlers" estimate was a stale curated slice; the real stub landscape is the large majority of the handler surface.
* **No call site dispatches through the archivist.** The cli MCP tool handlers, the CLI direct-write commands, the hooks, and the daemons all still run their *original* authoritative paths. `archivist.dispatch()` / `dispatchRead()` exist and resolve real substrate, but nothing routes through them yet — ADR-0180 deferred this as "F4-3" from day one.
* **`initialize(config)` is unfed.** The substrate registry is built from an `ArchivistInitConfig`, but no process (cli / daemon / hook) constructs the real backends + `projectRoot` and passes them in. F4-2 Phase C closed the type surface; the call-site wiring is open.
* **Read-optimized substrate has `TODO(F4-3-callsite)` gaps.** Several handlers need backend handles (router/bandit, reflexion re-embedding, ReasoningBank patterns) that are constructed in the cli process, not the archivist's — Phase C documented these precisely as deferred call-site wiring.
* **ADR-0112's enforcement code is still live.** `RvfNotInitializedError` + `requireAgentDB()` remain in `forks/ruflo/v3/@claude-flow/memory/` because they are the *current* fail-loud guard. ADR-0180 Open Follow-up #5 conditions their retirement on the archivist's init-completion guarantee being live — which it is not until this ADR lands.
* **Nothing is `npm run release`-verified.** The orphaned `git stash pop` conflict that blocked the pipeline was resolved 2026-05-14, removing the *blocker* to verification — but verification itself has not run.

The problem this ADR addresses: **ADR-0180 settled the architecture and built the scaffold; the archivist still needs to be turned on.** Treating that as an open-ended tail of ADR-0180 obscures its true depth. It is its own execution program.

## Decision Drivers

* The architecture is settled — ADR-0180 §Decision Outcome is not reopened. This ADR is about *activation execution*, not a new architectural choice.
* `feedback-no-fallbacks` / `feedback-data-loss-zero-tolerance`: a half-wired archivist where *some* call sites dispatch and others don't is a split-brain write path — worse than the current all-original-paths state. Activation must be coherent per surface.
* The handler stubs are not uniform — F4-2 Phase B/C proved some are genuinely blocked on backend handles only the cli process holds. Un-stubbing must follow the dependency order, not a flat sweep.
* `npm run release` is the only real correctness gate (per `CLAUDE.md` "Build & Test"). Every phase here is acceptance-tested through it; the structural-only verification of ADR-0180's phases is explicitly insufficient for runtime activation.
* ADR-0112's enforcement-code retirement is gated on this ADR — leaving it pending indefinitely keeps a retired rule's code live, which is its own drift risk.

## Considered Options

* **Extend ADR-0180's Execution Plan with more phases.** Rejected — ADR-0180 is `accepted` and its Execution Plan is structurally complete; runtime activation is a distinct concern with a different correctness gate (`npm run release`, not structural acceptance). Appending phases would blur the "scaffold done" vs "system live" boundary that the honest accounting depends on.
* **Un-stub everything in one sweep, then wire call sites.** Rejected — ignores the dependency order F4-2 Phase B/C surfaced (handlers blocked on cli-process backends can't be un-stubbed before `initialize(config)` is fed). A flat sweep produces handlers that compile but throw at runtime.
* **Wire call sites first (F4-3), then un-stub handlers behind them.** Rejected as the *primary* ordering — dispatching to a throw-stub handler is strictly worse than the current original-path behaviour (`feedback-no-fallbacks`: it fails loudly, but it fails where it used to work).
* **Phased activation: feed `initialize(config)` → un-stub handlers surface-by-surface → wire call sites per surface → retire ADR-0112 code → `npm run release` gate (chosen).** Each surface goes live as a unit: its handlers get real bodies, *then* its call sites delegate, *then* the next surface. No split-brain; every step is release-testable.

## Decision Outcome

Chosen: **phased runtime activation**, executed as a distinct ADR-0181 Execution Plan (below). The ordering invariant: **a surface's handlers are un-stubbed before its call sites are delegated to the archivist, and `initialize(config)` is fed before any handler that needs a real backend runs.** No surface is half-activated.

### Consequences

* Good — the archivist becomes the live write path coherently, surface by surface, each step `npm run release`-verified. No split-brain interval.
* Good — ADR-0112's enforcement code retires on a real trigger (the init-completion guarantee going live), not on a calendar.
* Good — the honest "scaffold vs live" boundary stays legible: ADR-0180 = scaffold, ADR-0181 = activation.
* Bad — this is a large program (~88 handler bodies + ~110 cli-tool delegations + call-site wiring across cli/daemon/hook processes). It is not a quick follow-on.
* Bad — until ADR-0181 completes, the archivist is dead weight: built, committed, charter-enforced, but not on any write path. The maintenance cost of the scaffold is paid before the benefit is realized.
* Neutral — the cli/daemon/hook original paths keep working throughout; activation is additive per surface, with the original path removed only once its surface's delegation is release-verified.

### Confirmation

* **`npm run release` is the gate for every phase.** Structural acceptance (charter check, `tsc --noEmit`) is necessary but not sufficient — each phase must pass the full preflight + build + publish + acceptance pipeline before the next begins.
* Per-surface activation is verified by an acceptance test that exercises the surface's MCP tools end-to-end through `archivist.dispatch()` and asserts the audit chain recorded the mutation (the §Confirmation invariant from ADR-0180: audit-entry count equals mutation count).
* ADR-0112 enforcement-code retirement is confirmed by the existing drift guard (`run_adr0180_gates()` Gate 4) plus a grep proving `RvfNotInitializedError` / `requireAgentDB(` have zero remaining call sites in `forks/ruflo/v3/@claude-flow/memory/`.
* Final confirmation: a full `npm run release` with every surface delegated, zero handler `pending` stubs reachable from a live tool, and the audit-chain replay test (ADR-0180 §Confirmation) passing against the activated system.

## Architecture

No new architecture — ADR-0180 §Architecture stands. This ADR specifies the *activation mechanics*:

* **`initialize(config)` feeding.** Each host process (cli, `ruflo daemon`, hook-handler) constructs a per-process `Archivist` and feeds it an `ArchivistInitConfig` (the type surface F4-2 Phase C built). _Amended ([§Amendments](#amendments), 2026-05-15): Phase 1's config is **`projectRoot`-only** across all three processes — none currently hold a reusable RVF/SQLite backend, and their handlers classify as FS-JSON, which `getSubstrate()` lazily mints from `projectRoot`. Real RVF/SQLite backend wiring is deferred to the phase that un-stubs the handlers dispatching through those substrate families._
* **Handler un-stubbing order.** Un-stub in dependency order: handlers needing only `ctx.substrate.withWrite` (FS-JSON family) first; handlers needing read-optimized `query`/`vectorSearch` next; handlers needing cli-process backend handles last (after `initialize(config)` is fed). The ~88 stubs are grouped by this order, not by surface name.
* **Call-site delegation (F4-3).** Per surface, replace the cli MCP tool handler body / CLI command body / hook body with `archivist.dispatch(toolName, payload)` (or `dispatchRead`). The original path is deleted only once the delegation is release-verified — never both live at once. **Prerequisite: the typed `dispatch` overload.** Today `dispatch(toolName: string, payload: unknown)` is `unknown`-typed at the call site (ADR-0180 Open Follow-up #26) — a typo'd tool name or mismatched payload is a runtime throw, not a `tsc` error. Before this phase wires ~110 literal-tool-name call sites, land a `ToolPayloadMap` interface keying every registered tool to its payload type plus `dispatch<K extends keyof ToolPayloadMap>(tool: K, payload: ToolPayloadMap[K])` / `dispatchRead` overloads, so every call site this phase creates is compile-time-checked on both tool name and payload shape.
* **ADR-0112 enforcement-code retirement.** Once `initialize(config)` is fed everywhere and handlers are invoked only post-`initialize()`, `RvfNotInitializedError` + `requireAgentDB()` are dead — the archivist's init-completion guarantee replaces them. Delete the classes + guards; the drift guard (ADR-0180 Gate 4) prevents reappearance.

## Execution Plan

Sequential phases; phase N+1 cannot start until phase N passes `npm run release`. Each phase runs as a `/swarm-advanced` swarm — up to 25 concurrent agents, queen-led, with a per-phase council report in `docs/council/ADR-0181-phase-<N>-report.md`. The swarm mechanics, concurrency budget, and per-phase team composition are specified in §Multi-Agent Execution Plan below.

| Phase | Surface | Exit gate |
|---|---|---|
| **1** | **`initialize(config)` feeding.** cli + daemon + hook-handler each construct a per-process `Archivist` and feed it an `ArchivistInitConfig`. _Amended ([§Amendments](#amendments), 2026-05-15): the config is `projectRoot`-only._ | `npm run release` passes; `Archivist.initialize()` completes from a real (`projectRoot`-bearing) config in each host process — _init-completion_, not registry non-emptiness (`initialize()` eagerly builds only the substrate families the config supplies; FS-JSON is lazy-minted). |
| **2** | **FS-JSON handler un-stub.** Un-stub the handler bodies that need only `ctx.substrate.withWrite` (the FS-JSON family — claims/tasks/agents/swarm/coordination/workflow/neural/github/performance/system/config/progress/ruvllm/daa/wasm/browser/autopilot/hive-mind). | `npm run release` passes; zero `pending` stubs in the FS-JSON handler set. |
| **3** | **Read-optimized handler un-stub.** Un-stub handlers needing `query`/`vectorSearch` (memory_* reads, agentdb_* ranked reads) now that Phase 1 fed the read substrates. | `npm run release` passes; zero `pending` stubs in the read-handler set; provenance flag works end-to-end. |
| **4** | **cli-process-backend handler un-stub.** Close the `TODO(F4-3-callsite)` gaps — un-stub handlers needing router/bandit, reflexion re-embedding, ReasoningBank patterns handles (route, pattern-search, reflexion-retrieve, skill-search, the daemons). | `npm run release` passes; zero `pending` stubs anywhere in `handlers/**`. |
| **5** | **F4-3 cli delegation.** First land the **typed `dispatch` overload** — a `ToolPayloadMap` interface keying every registered tool name to its payload type, plus `dispatch<K extends keyof ToolPayloadMap>(tool: K, payload: ToolPayloadMap[K])` / `dispatchRead` overloads (closes ADR-0180 Open Follow-up #26 — `dispatch` is `unknown`-typed at the call site today). Then per surface, replace cli MCP tool handler bodies + CLI command bodies + hook/daemon bodies with `archivist.dispatch()` / `dispatchRead()`. Delete each original path once its delegation is release-verified. | `npm run release` passes; every MCP tool + CLI write command + hook + daemon routes through the archivist; audit-chain count equals mutation count; **`dispatch` / `dispatchRead` expose the `ToolPayloadMap` overloads and every Phase 5 call site uses a literal tool name — `tsc --noEmit` rejects an unregistered tool name or a payload that mismatches its handler's `T`.** |
| **6** | **ADR-0112 enforcement-code retirement.** Delete `RvfNotInitializedError` + `requireAgentDB()` + the `controller-registry.ts` "Phase 2" markers from `@claude-flow/memory`; the init-completion guarantee replaces them. | `npm run release` passes; `grep -RE 'RvfNotInitializedError|requireAgentDB\(' forks/ruflo/v3/@claude-flow/memory` returns zero; ADR-0180 Gate 4 drift guard extended to cover the ruflo memory tree. |
| **7** | **Full-system verification.** Audit-chain replay test (ADR-0180 §Confirmation) against the fully-activated system; the W1–W5 + W3-contended bench suite run against real archivist code paths (the bench baselines were captured against scaffolding). | `npm run release` passes; replay equality holds; bench numbers within their ADR-0180 regression bands. |

## Multi-Agent Execution Plan

Each phase of the Execution Plan above runs as a `/swarm-advanced` swarm — up to **25 concurrent agents**, topology established by ruflo MCP and execution carried by the Claude Code Agent tool. This section specifies the swarm mechanics; it changes none of the phase boundaries or exit gates above.

### Concurrency ceiling

* **Hard ceiling: 25 concurrent agents per phase** — queen + Devil's Advocate + workers + verifiers, all counted. The ceiling is per-phase: a phase tears its swarm down (`TeamDelete`) before the next begins, so no two phases' agents are ever live together.
* This raises the standing `CLAUDE.md` project ceiling (15 agents) for the duration of this program; it reverts to 15 when ADR-0181 closes.
* A phase need not saturate the budget — the per-phase composition table sizes each phase to its real parallel surface. Phase 2 (FS-JSON un-stub, ~18 store families) and Phase 5 (cli delegation, ~110 call sites) are the budget-saturating phases; the rest run leaner.

### Topology and strategy (per `/swarm-advanced`)

* **Topology: hierarchical-mesh.** A queen coordinates — hierarchical command for phase gating and the `npm run release` exit gate — while workers form a mesh among themselves for dialectic. Verification-heavy phases (3, 7) lean toward star: the queen centralizes the replay / bench verdict. `swarm_init({ topology: "hierarchical", maxAgents: 25, strategy: <per phase> })` establishes this.
* **Strategy per phase:** `parallel` for the un-stub phases (2, 3, 4 — independent handler files, no inter-worker dependency); `specialized` for Phase 1 (three distinct host processes) and Phase 5 (per-surface delegation, each surface a specialist); `adaptive` for Phase 7 (verification work re-plans on a failed replay or out-of-band bench number).

### Spawn protocol

Per `feedback-council-queen-da-alongside-experts`, `feedback-always-use-agent-teams`, and `feedback-agent-dialectic-via-sendmessage`:

1. **`swarm_init`** (ruflo MCP) — establish topology, `maxAgents: 25`, the phase strategy, and the phase memory namespace `adr-0181/phase-<N>`.
2. **`TeamCreate`** `adr-0181-phase-<N>`.
3. **Spawn the whole wave in one message** — queen + Devil's Advocate + every worker + every verifier, each with `team_name: "adr-0181-phase-<N>"`, a unique `name`, and `run_in_background: true`. No sequential rounds: experts, DA, and queen are live together from t0.
4. **Workers execute single-attempt** (`feedback-single-arm-experiment-prompt-discipline`) — one pass at their slice, no retry loops. On completion each `SendMessage`s the queen *and* `TaskUpdate`s its own task to `completed` — closing the worker-contract gap the ADR-0180 Phase 10 report flagged (workers must claim and close their `TaskUpdate` entry, not only `SendMessage`).
5. **Inter-agent dialectic via `SendMessage`** — workers and the DA engage by `name` on specific claims; never `/tmp` shared dirs, never file-based handoff.
6. **Queen** waits for all workers, runs the phase's `npm run release` exit gate, and authors `docs/council/ADR-0181-phase-<N>-report.md`.
7. **`TeamDelete`** once the queen and all workers acknowledge shutdown.

### Coordination substrate

* **Memory namespace** `adr-0181/phase-<N>` (ruflo MCP `memory_store` / `memory_search`) — workers publish their handler-file inventory, stub→live diffs, and blocked-on-backend findings; the queen reads it to assemble the council report. Cross-phase carry-forwards — e.g. the `TODO(F4-3-callsite)` set Phase 1 surfaces for Phase 4 — persist at `adr-0181/carry-forward`.
* **Monitoring & fault tolerance** — the queen runs `swarm_monitor` / `swarm_status` for liveness. A worker silent past a heartbeat is re-spawned once (swarm-advanced auto-recovery); a second failure escalates to Halt.
* **Halt protocol** (inherited from ADR-0180 §Execution Plan) — any worker may raise `ADR-0181-Halt:<reason>` on a retroactive flaw in an earlier phase; the release pipeline blocks until a paired `ADR-0181-Amendment: phase-<N>` commit lands amending the prior phase.

### Per-phase team composition

All totals ≤ 25. Worker counts track the phase's parallel surface; verifiers cover the phase's exit gate.

| Phase | Topology / strategy | Queen | DA | Workers | Verifiers | Total |
|---|---|---|---|---|---|---|
| **1** initialize(config) feeding | hierarchical / specialized | 1 | 1 | 3 — cli, daemon, hook-handler wiring | 2 — init-completion, `ArchivistInitConfig`-shape | 7 |
| **2** FS-JSON handler un-stub | hierarchical-mesh / parallel | 1 | 1 | 18 — one per FS-JSON store family | 5 — 2 invariant-authors, charter-check, stub-count, release-gate | 25 |
| **3** Read-optimized handler un-stub | star / parallel | 1 | 1 | 8 — memory_* reads + agentdb_* ranked reads, grouped | 3 — provenance-flag e2e, query/vectorSearch routing, stub-count | 13 |
| **4** cli-process-backend handler un-stub | hierarchical-mesh / parallel | 1 | 1 | 6 — route, pattern-search, reflexion-retrieve, skill-search, daemon handlers ×2 | 2 — capability-handle wiring, stub-count | 10 |
| **5** F4-3 cli delegation | hierarchical-mesh / specialized | 1 | 1 | 19 — 1 typed-overload (`ToolPayloadMap`; the 18 delegation workers gate their start on its `SendMessage`), 18 per-surface delegation | 4 — audit-chain count, `tsc` overload check, original-path-deletion, multi-process audit | 25 |
| **6** ADR-0112 enforcement-code retirement | hierarchical / specialized | 1 | 1 | 4 — `RvfNotInitializedError` deletion, `requireAgentDB()` deletion, `controller-registry.ts` markers, Gate-4 drift-guard extension | 2 — zero-grep, init-completion-guarantee | 8 |
| **7** Full-system verification | star / adaptive | 1 | 1 | 6 — replay-harness, W1–W5 bench, W3-contended bench, bench re-baseline, replay-equality, regression-band check | 2 — release-gate, council-report cross-check | 10 |

Each phase's queen spawns in the same wave as its workers and DA (not after — `feedback-council-queen-da-alongside-experts`) and is the sole agent that runs the `npm run release` exit gate and authors the council report.

## Open follow-ups

1. **Bench re-baselining.** ADR-0180's `bench/baseline.json` was captured against the scaffold (placeholder numbers). Phase 7 must re-capture against the activated system — the regression bands only become meaningful once the handlers do real work.

2. **The ADR-0180 deferred follow-ups inherited here.** ADR-0180's Open Follow-ups #8 (standalone agentdb-mcp-server — 33 tools, ~15 mutating, with no handler counterpart in this ADR's Phase 2–4 un-stub set), #19 (replay test harness wiring), and the F7-class process notes carry forward into this ADR's phases — they are activation concerns, not architecture concerns.

3. **cli-core JsonMemoryBackend stays a non-archivist surface.** Per ADR-0180 Open Follow-up #9 (documented, accepted). No phase here routes cli-core through the archivist; if that ever changes it reopens #9, not this ADR.

4. **Multi-process audit composition under real load.** ADR-0180 §15 + Open Follow-up #15 specified the shared append-only audit log + advisory locking; Phase 5 (cli delegation) is the first time cli + daemon + hook processes all dispatch concurrently for real. If the §15 single-fd-per-process invariant or the lock-contention budget breaks under genuine multi-process load, it surfaces here.

5. **`npm run release` cold-start cost.** Seven phases each gated on a full release run is a real wall-clock cost. If it proves prohibitive, the fallback is `npm run test:unit` for intra-phase iteration with `npm run release` only at phase exit — but the phase-exit gate is non-negotiable per `feedback-all-test-levels`.

## Amendments

### Amendment: Phase 1 (2026-05-15)

ADR-0181's original Phase 1 text — "construct real backends + `projectRoot`" and an exit gate of "builds a **non-empty** substrate registry" — assumed each host process holds a reusable RVF/SQLite backend that `initialize()` could register eagerly. Phase 1's recon proved otherwise:

* **No host process holds a reusable backend.** The cli's only RVF handle is `@claude-flow/memory`'s `RvfBackend` (`implements IMemoryBackend`) — a nominally-incompatible class, in a different package, from the agentdb `RvfBackend` (`implements VectorBackendAsync`) that `ArchivistInitConfig.rvfBackend` is typed against. Passing it needs an `as unknown as` cast-lie; constructing a fresh one is a double-open on the same `.rvf` file. The `ruflo daemon` and hook-handler hold no memory backend at all.
* **Their handlers are FS-JSON.** Every storeId the three processes dispatch today classifies as FS-JSON, which `getSubstrate()` lazily mints from `projectRoot` alone — needing no `rvfBackend` / `sqliteDb`.

**Amended text:**

* **§Architecture / Phase 1 surface** — each host process feeds a **`projectRoot`-only** `ArchivistInitConfig`. Real RVF/SQLite backend wiring (and the `taskRouter` / `embeddingScorer` / `patternReader` capability factories) is deferred to the phase that un-stubs the handlers that dispatch through those substrate families — the `TODO(F4-3-callsite)` work, Phase 4/5.
* **Phase 1 exit gate** — "non-empty substrate registry" → **init-completion**. `initialize()` eagerly builds only the substrate families whose backend the config supplies (RVF, SQLite); FS-JSON is lazy-minted on first `getSubstrate()`. A `projectRoot`-only config therefore *legitimately* leaves the eager registry empty. The invariant that holds: `initialize()` completes from a real `projectRoot`-bearing config, is idempotent, and the lazy FS-JSON path resolves through that `projectRoot` — while RVF / SQLite-carve-out stores fail loud (no silent no-op substrate). Verified by `forks/agentdb/test/archivist/init-config-feeding.test.ts`.

The architecture (ADR-0180) is not reopened — this amendment narrows Phase 1's *config shape* to what the host processes can honestly supply today; the deferred backend wiring lands intact in a later phase. Council record: [docs/council/ADR-0181-phase-1-report.md](../council/ADR-0181-phase-1-report.md).

## More Information

* [ADR-0180](ADR-0180-adopt-thin-memory-coordinator-with-type-enforced-mutation-handlers.md) — the architecture this ADR activates. §Implementation Status records the scaffold-vs-live boundary; this ADR is the "live" half.
* [docs/council/ADR-0180-f4-2-phase-a-report.md](../council/ADR-0180-f4-2-phase-a-report.md) / [-b](../council/ADR-0180-f4-2-phase-b-report.md) / [-c](../council/ADR-0180-f4-2-phase-c-report.md) — the F4-2 Phase A–C work that made the substrate seam live and surfaced the true ~88-stub scope.
* [docs/council/agentdb-merge-conflict-resolution.md](../council/agentdb-merge-conflict-resolution.md) — the `git stash pop` conflict resolution that unblocked `npm run release`.
* ADR-0112 — superseded by ADR-0180; its enforcement-code retirement is this ADR's Phase 6.
