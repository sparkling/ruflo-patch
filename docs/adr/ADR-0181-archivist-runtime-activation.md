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

* **`initialize(config)` feeding.** Each host process (cli, `ruflo daemon`, hook-handler) constructs its substrate backends + `projectRoot` and passes them via `ArchivistInitConfig` (the type surface F4-2 Phase C built). The archivist's lazy-per-tool init then has real backends to register.
* **Handler un-stubbing order.** Un-stub in dependency order: handlers needing only `ctx.substrate.withWrite` (FS-JSON family) first; handlers needing read-optimized `query`/`vectorSearch` next; handlers needing cli-process backend handles last (after `initialize(config)` is fed). The ~88 stubs are grouped by this order, not by surface name.
* **Call-site delegation (F4-3).** Per surface, replace the cli MCP tool handler body / CLI command body / hook body with `archivist.dispatch(toolName, payload)` (or `dispatchRead`). The original path is deleted only once the delegation is release-verified — never both live at once.
* **ADR-0112 enforcement-code retirement.** Once `initialize(config)` is fed everywhere and handlers are invoked only post-`initialize()`, `RvfNotInitializedError` + `requireAgentDB()` are dead — the archivist's init-completion guarantee replaces them. Delete the classes + guards; the drift guard (ADR-0180 Gate 4) prevents reappearance.

## Execution Plan

Sequential phases; phase N+1 cannot start until phase N passes `npm run release`. Each phase runs as a `/swarm-advanced` team per the ADR-0180 Execution Plan pattern (queen + workers, per-phase council report in `docs/council/ADR-0181-phase-<N>-report.md`).

| Phase | Surface | Exit gate |
|---|---|---|
| **1** | **`initialize(config)` feeding.** cli + daemon + hook-handler each construct real backends + `projectRoot` and pass `ArchivistInitConfig`. | `npm run release` passes; `Archivist.initialize()` builds a non-empty substrate registry from a real config in each host process. |
| **2** | **FS-JSON handler un-stub.** Un-stub the handler bodies that need only `ctx.substrate.withWrite` (the FS-JSON family — claims/tasks/agents/swarm/coordination/workflow/neural/github/performance/system/config/progress/ruvllm/daa/wasm/browser/autopilot/hive-mind). | `npm run release` passes; zero `pending` stubs in the FS-JSON handler set. |
| **3** | **Read-optimized handler un-stub.** Un-stub handlers needing `query`/`vectorSearch` (memory_* reads, agentdb_* ranked reads) now that Phase 1 fed the read substrates. | `npm run release` passes; zero `pending` stubs in the read-handler set; provenance flag works end-to-end. |
| **4** | **cli-process-backend handler un-stub.** Close the `TODO(F4-3-callsite)` gaps — un-stub handlers needing router/bandit, reflexion re-embedding, ReasoningBank patterns handles (route, pattern-search, reflexion-retrieve, skill-search, the daemons). | `npm run release` passes; zero `pending` stubs anywhere in `handlers/**`. |
| **5** | **F4-3 cli delegation.** Per surface, replace cli MCP tool handler bodies + CLI command bodies + hook/daemon bodies with `archivist.dispatch()` / `dispatchRead()`. Delete each original path once its delegation is release-verified. | `npm run release` passes; every MCP tool + CLI write command + hook + daemon routes through the archivist; audit-chain count equals mutation count. |
| **6** | **ADR-0112 enforcement-code retirement.** Delete `RvfNotInitializedError` + `requireAgentDB()` + the `controller-registry.ts` "Phase 2" markers from `@claude-flow/memory`; the init-completion guarantee replaces them. | `npm run release` passes; `grep -RE 'RvfNotInitializedError|requireAgentDB\(' forks/ruflo/v3/@claude-flow/memory` returns zero; ADR-0180 Gate 4 drift guard extended to cover the ruflo memory tree. |
| **7** | **Full-system verification.** Audit-chain replay test (ADR-0180 §Confirmation) against the fully-activated system; the W1–W5 + W3-contended bench suite run against real archivist code paths (the bench baselines were captured against scaffolding). | `npm run release` passes; replay equality holds; bench numbers within their ADR-0180 regression bands. |

## Open follow-ups

1. **Bench re-baselining.** ADR-0180's `bench/baseline.json` was captured against the scaffold (placeholder numbers). Phase 7 must re-capture against the activated system — the regression bands only become meaningful once the handlers do real work.

2. **The ADR-0180 deferred follow-ups inherited here.** ADR-0180's Open Follow-ups #8 (standalone agentdb-mcp-server — ~25 tools with no Phase 6 handler counterpart, "F8-1..F8-25"), #19 (replay test harness wiring), and the F7-class process notes carry forward into this ADR's phases — they are activation concerns, not architecture concerns.

3. **cli-core JsonMemoryBackend stays a non-archivist surface.** Per ADR-0180 Open Follow-up #9 (documented, accepted). No phase here routes cli-core through the archivist; if that ever changes it reopens #9, not this ADR.

4. **Multi-process audit composition under real load.** ADR-0180 §15 + Open Follow-up #15 specified the shared append-only audit log + advisory locking; Phase 5 (cli delegation) is the first time cli + daemon + hook processes all dispatch concurrently for real. If the §15 single-fd-per-process invariant or the lock-contention budget breaks under genuine multi-process load, it surfaces here.

5. **`npm run release` cold-start cost.** Seven phases each gated on a full release run is a real wall-clock cost. If it proves prohibitive, the fallback is `npm run test:unit` for intra-phase iteration with `npm run release` only at phase exit — but the phase-exit gate is non-negotiable per `feedback-all-test-levels`.

## More Information

* [ADR-0180](ADR-0180-adopt-thin-memory-coordinator-with-type-enforced-mutation-handlers.md) — the architecture this ADR activates. §Implementation Status records the scaffold-vs-live boundary; this ADR is the "live" half.
* [docs/council/ADR-0180-f4-2-phase-a-report.md](../council/ADR-0180-f4-2-phase-a-report.md) / [-b](../council/ADR-0180-f4-2-phase-b-report.md) / [-c](../council/ADR-0180-f4-2-phase-c-report.md) — the F4-2 Phase A–C work that made the substrate seam live and surfaced the true ~88-stub scope.
* [docs/council/agentdb-merge-conflict-resolution.md](../council/agentdb-merge-conflict-resolution.md) — the `git stash pop` conflict resolution that unblocked `npm run release`.
* ADR-0112 — superseded by ADR-0180; its enforcement-code retirement is this ADR's Phase 6.
