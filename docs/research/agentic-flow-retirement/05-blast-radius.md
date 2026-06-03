# Facet 5 — Blast radius + sequenced retirement path

> Swarm `swarm-1780507536857-mruhcx`, facet 5 of 5. READ-ONLY analysis. Verified against working trees on 2026-06-03 (`forks/agentic-flow` @ `2.0.2-alpha-patch.956`, `forks/ruflo`, `ruflo-patch`). Static-import reachability computed mechanically (Python AST-ish closure), not by eyeball grep.

## TL;DR

The `AgentDBService` + fastmcp `stdio-full` cluster is a **self-contained island of exactly 14 source files** whose static-import closure is reached by **zero** `agentic-flow` package.json export entry points. It is runtime-reachable **only** through the `agentdb` / `agentic-flow mcp` bin path (`cli/mcp.ts → stdio-full.js`). The live ruflo (claude-flow v3) tree imports ~15 *other* agentic-flow subpaths — none of which drag in `AgentDBService`. **Retiring the island within the fork is low-blast-radius and orthogonal to F10.** Dropping the agentic-flow *dependency entirely* is a separate, much larger question owned by facet 2 (the live tree statically imports 15 subpaths). Recommended scope: **retire the island in the fork; do NOT drop the dep.**

---

## 1. Blast-radius inventory

### 1a. Source files — the static-import island (the real surface)

Mechanical reverse-reachability from `services/agentdb-service.ts` over static `import … from` / `export … from` edges yields **exactly 14 files** that would break if the file were deleted:

| File | Role |
|---|---|
| `services/agentdb-service.ts` | the class itself (91 KB) — defines `_attachLearningSubscriber` |
| `mcp/fastmcp/servers/stdio-full.ts` | the 220+-tool MCP server (registers all tool modules) |
| `mcp/fastmcp/tools/attention-tools.ts` | 6 tools |
| `mcp/fastmcp/tools/daa-tools.ts` | 10 tools |
| `mcp/fastmcp/tools/hidden-controllers.ts` | 17 tools (8 controllers) |
| `mcp/fastmcp/tools/memory-tools.ts` | 6 tools |
| `mcp/fastmcp/tools/neural-tools.ts` | 6 tools |
| `mcp/fastmcp/tools/performance-tools.ts` | 15 tools |
| `mcp/fastmcp/tools/quic-tools.ts` | 7 tools |
| `mcp/fastmcp/tools/rvf-tools.ts` | 5 tools |
| `mcp/fastmcp/tools/session-tools.ts` | 8 tools |
| `mcp/fastmcp/tools/workflow-tools.ts` | 11 tools |
| `services/direct-call-bridge.ts` | DirectCallBridge (infrastructure/workflow tools) |
| `services/hook-service.ts` | hook service |
| `services/swarm-service.ts` | swarm service |

**11 of the 23 fastmcp tool modules are CLEAN** of `AgentDBService` (autopilot, booster, consensus, cost-optimizer, explainability, github, gnn, infrastructure, quantization, ruvector, sona-rvf, sona, streaming). They register in `stdio-full` but don't depend on the class — so the "kills 12 tools" framing in the brief is the wrong axis. The dependency is **stdio-full itself + ~10 tool modules**, and stdio-full is the single chokepoint.

### 1b. Name-only references (NOT static importers — survive deletion as dangling type/comment refs)

My first grep returned 22 "importers." Eight of those reference the *string* `AgentDBService` only — in comments, log messages, JSDoc types, or duck-typed accessors (`svc.getAgentDBService?.()`), never a static `import`. These do **not** break on deletion of the class file (they were never statically bound to it), but their dangling references should be cleaned:

- `coordination/autopilot-learning.ts` — **LIVE-reachable** (exported as `./coordination/autopilot-learning`; consumed by ruflo `cli/src/autopilot-state.ts` + `doctor.ts`). References `AgentDBService` **only via `svc.getAgentDBService?.()` duck-type + comments/logs**. This is the F10/ADR-0195 producer half. *It does not import the class.*
- `services/controller-bridge.ts`, `services/agentdb-phase4-methods.ts`, `services/federated-sync-provider.ts`, `services/sync-coordinator-federated-adapter.ts`, `cli/autopilot-cli.ts`, `services/streaming-service.ts` — comment/type/string references only.

> Caveat: "name-only" was confirmed by grepping for `import|require|new AgentDBService|: AgentDBService|<AgentDBService` and finding nothing except in the 14-file set. `agentdb-phase4-methods.ts` is a mixin/`.call(this)` style file — re-confirm at delete time whether any method body calls `this`-bound AgentDBService members that a type-only stripping would miss.

### 1c. Live ruflo (claude-flow v3) — what it actually consumes from agentic-flow

Static imports in `forks/ruflo` (`v3/` + `src/`), by subpath frequency:

```
17  from 'agentic-flow'                       (main barrel — does NOT re-export AgentDBService)
16  from 'agentic-flow/reasoningbank'
 8  from 'agentic-flow/workers'
 8  from 'agentic-flow/core'
 5  from 'agentic-flow/mcp/fastmcp/tools/hooks'   (hooks/ subtree — CLEAN of AgentDBService)
 2  from 'agentic-flow/coordinators'
 2  from 'agentic-flow/coordination'
 1  from 'agentic-flow/transport/loader'
 1  from 'agentic-flow/sona'
 1  from 'agentic-flow/mcp/fastmcp/tools/sona-tools'  (CLEAN)
 1  from 'agentic-flow/coordination/autopilot-learning' (duck-types AgentDBService; no static import)
 …  attention, agentdb, hooks
```

**None of these reach `AgentDBService` statically** (verified: every package.json export entry point returns `no` in the reachability closure). The live tree's only relationship to the island's class is the *duck-typed* `getAgentDBService()` accessor inside `autopilot-learning`. So: **deleting the island does not break the live ruflo import graph.** (ADR-0287 §F5 already records "the v3 tree's only static use of the agentic-flow package is the hooks subtree… not AgentDBService.")

### 1d. Tests (fork-local) that exercise the surface

`forks/agentic-flow/agentic-flow/tests/`:
- `unit/streaming-service.test.ts`
- `unit/autopilot-phase4-event-bus.test.ts`, `unit/autopilot-phase4-step-feedback.test.ts`, `unit/autopilot-phase3-embedding-clustering.test.ts`, `unit/autopilot-cli-subscribe-federation.test.ts`
- `integration/autopilot-learning-phase4-bridges.test.ts`, `integration/autopilot-learning-phase3.test.ts`, `integration/autopilot-cli-patterns-episodes.test.ts`, `integration/adr0195-step-level-feedback.test.ts`

Most of these test `autopilot-learning` / federated / streaming surfaces (the *duck-type* side), not `stdio-full`. They need re-pointing or deletion only insofar as they construct `AgentDBService`; if they use the `*ServiceLike` duck-type interface they survive.

### 1e. Acceptance harness (`ruflo-patch`)

- `scripts/test-acceptance.sh:1441` + `:2843` — `adr0089-svc | "AgentDBService wraps (ADR-0089)" | check_adr0089_agentdb_service_wraps`. **This check directly asserts AgentDBService behaviour** and would have to be retired/retargeted in the same change (per [[feedback-always-wire-tests-into-cicd]] + [[reference-acceptance-runcheck-vs-collect]]: remove from BOTH `run_check_bg` AND the `collect_parallel` spec line, or it silently goes "no verdict").
- `scripts/test-acceptance.sh:294` — lists `"@sparkleideas/agentic-flow"` (dep presence, not island-specific).
- `scripts/test-acceptance.sh:1306` — Enhanced Booster wired into stdio-full (booster-tools is CLEAN, but registered in stdio-full → a stdio-full deletion touches this comment/check).

### 1f. Project ADRs depending on the surface

Grep hits (`docs/adr/`). The load-bearing ones:
- **ADR-0089** (controller-intercept-pattern-permanent) — names "AgentDBService wraps"; the acceptance check above is its guard. *Direct dependency.*
- **ADR-0192 / 0193 / 0194 / 0195 / 0196 / 0197** (autopilot-learning Phases) — these own `autopilot-learning.ts` + `_attachLearningSubscriber` + federated. They reference `AgentDBService` as the *episode sink* but via the duck-type. ADR-0195/0197 are the only ADRs naming `_attachLearningSubscriber`. ADR-0196 = `accepted` (FederatedSyncProvider runtime wired). **These do not require the island's MCP tools**, but they assume an `AgentDBService`-shaped episode store exists.
- **ADR-0287** (live-manual-test-remediation, `proposed`, 2026-06-02) — **F5 already disposes the closest piece**: "DELETE (complete scope): Phase-2 block + call site + the 4 orphaned consumer branches… Banner is on agentic-flow's own fastmcp surface (NOT the live ruflo boot); AgentDBService is 100% fork-authored." F5 explicitly scopes itself as "the smallest chip off a larger, possibly-vestigial agentic-flow AgentDBService + 12-tool [cluster]." **This retirement is the larger ADR that F5 anticipates.**
- ADR-0066/0067/0068/0073/0074/0075/0076/0076a/0077/0084/0085/0086/0111/0166/0219 — historical/architectural references (e.g., ADR-0075 "AgentDB becomes a library, not a service" — that direction is *aligned* with retirement). Mostly prose, not guards.

### 1g. INTEGRATION-LEDGER + arch-guards

- `docs/upstream/INTEGRATION-LEDGER.md` — **no row keys on `AgentDBService` or `stdio-full`.** Rows mention `agentic-flow` for QUIC/federation/version-pin disposition (rows 67/68/150/166/182/183/239/267/276/374/404). A retirement needs a **new fork-local ledger row** (per [[feedback-update-integration-ledger.md]]) but does not collide with an existing disposition. ADR-0217 already deleted sibling QUIC files fork-local (row 374) — precedent for fork-local island deletion.
- **No forbidden-substring / arch-guard gate keys on `AgentDBService`, `fastmcp`, or `stdio-full`** in `.github/workflows/` or `scripts/`. (Contrast: `HybridBackend`/`SqlJsBackend`/`1536` are gated — these are not.) So no guard flips red on deletion; but you'd *want* to ADD a reverse-import guard (no live ruflo file may import `services/agentdb-service` or `fastmcp/servers/stdio-full`) to lock the retirement, mirroring ADR-0265's C7.b/c reverse-import guards.

### 1h. package.json pins / bin / codemod

- `forks/agentic-flow/agentic-flow/package.json`: `bin.agentdb = dist/agentdb/cli/agentdb-cli.js`, `bin.agentic-flow = dist/cli-proxy.js`. The island is reached at runtime via `cli/mcp.ts → stdio-full.js` (the `mcp` subcommand) and `cli/doctor-cli.ts` (existence check). **Retiring the island means the `agentic-flow mcp` / standalone MCP product loses its tool surface** — this is the real product decision (gate 3b below).
- `package.json` `exports` map exposes **NO** `stdio`/`servers`/`agentdb-service` subpath (verified) → no published API contract breaks.
- `scripts/codemod.mjs` references to agentic-flow are **rename-scope only** (`agentic-flow → @sparkleideas/agentic-flow`, `mcp__agentic-flow__agentdb_* → mcp__agentdb__*`). Per [[feedback-patches-in-fork]], the deletion is a fork patch, not a codemod change — but the codemod's `mcp__agentic-flow__agentdb_*` rewrite (lines 318-337, 586) becomes dead once the island ships, and should be pruned in the same change.

### 1i. Skills / commands / plugins

No `plugins/` skill surfaces the island's tools by name. The hits under `.claude/worktrees/sharded-seeking-blanket/…` and `.claude/memory/…` are a stale worktree + memory notes, not live skill definitions. The live skill/plugin layer routes to the **ruflo** MCP (`mcp__ruflo__*` / `mcp__agentdb__*`), not `mcp__agentic-flow__*`. **No skill blast radius.**

---

## 2. Sequenced retirement plan

Two distinct scopes — keep them separate:

### Scope A (recommended): retire the island *within* the fork

> Deletes the 14-file static-import island + its standalone MCP product surface; keeps the agentic-flow dependency (live tree still needs reasoningbank/workers/core/hooks/coordination/transport/sona).

1. **Ratify the capture-wiring decoupling first.** Confirm (with facet 3/F10) that the episode-sink contract `autopilot-learning` depends on is the *duck-typed `SonaServiceLike`/`getAgentDBService()` shape*, not the concrete class. → *Verify:* `autopilot-learning.ts` has zero static `import` of `agentdb-service` (CONFIRMED today). If F10's seam (a) lands first (`ruflo hooks post-task` → SQLite), the producer no longer needs the island at all.
2. **Delete the 7 island-only tool modules' AgentDBService coupling + the MCP server.** Delete `services/agentdb-service.ts`, `services/direct-call-bridge.ts`, `services/hook-service.ts`, `services/swarm-service.ts`, `mcp/fastmcp/servers/stdio-full.ts`, and the 10 AgentDBService-importing tool modules (attention/daa/hidden-controllers/memory/neural/performance/quic/rvf/session/workflow). → *Verify:* `cargo`/`tsc` build of the fork is green; `npm run build` (per [[feedback-build-after-change]]); grep proves no remaining static importer.
3. **Strip dangling name-only refs** in the 8 name-only files (comments/logs/types referencing `AgentDBService` → retarget to the duck-type name or remove). → *Verify:* forbidden-substring sweep for `AgentDBService` in compiled dist returns 0 (per [[feedback-forbidden-substring-tests-grep-dist.md]] — JSDoc comments count).
4. **Decommission the `agentic-flow mcp` subcommand** (`cli/mcp.ts`, `cli/doctor-cli.ts` stdio-full checks) OR repoint it to the surviving CLEAN tool set if a slimmed standalone server is still wanted (gate 3b). → *Verify:* `agentic-flow mcp` either errors cleanly or boots the slimmed set; doctor check updated.
5. **Retire the acceptance check** `check_adr0089_agentdb_service_wraps` from BOTH `run_check_bg` (line 1441) AND the `collect_parallel` spec (line 2843). Update the booster/stdio-full comment at :1306. → *Verify:* full `scripts/test-acceptance.sh` run is green with no "no verdict" gap (per [[reference-acceptance-runcheck-vs-collect]]); use [[reference-fast-test-runner.md]] for the iteration loop.
6. **Add a reverse-import arch-guard**: no file under `forks/ruflo` may statically import `services/agentdb-service` or `fastmcp/servers/stdio-full` (mirror ADR-0265 C7.b/c). → *Verify:* guard passes now (true today) and would fail if reintroduced.
7. **Fork-local INTEGRATION-LEDGER row** (`fork-local`, disposition = island retirement, ADR ref) + the ADR documenting it. → *Verify:* ledger row present in same commit (per [[feedback-update-integration-ledger.md]], [[feedback-commit-often.md]]).
8. **Prune dead codemod rewrites** (`mcp__agentic-flow__agentdb_*` rules) once nothing emits them. → *Verify:* `tests/pipeline/codemod.test.mjs` green.

### Scope B (separate, larger — facet 2 decides feasibility): drop the agentic-flow dependency entirely

Not recommended as part of this work. Blocked because the live ruflo tree statically imports ~15 agentic-flow subpaths (reasoningbank ×16, workers ×8, core ×8, hooks ×5, transport, sona, coordination, attention). Each is its own retirement/replacement project. Scope A is the safe, bounded subset that removes the *vestigial* part without touching the live dependency.

---

## 3. F10 interaction note

**Retiring `AgentDBService` is ORTHOGONAL to F10's chosen direction — and slightly *helps* it.**

- F10's capture-wiring (ADR-0287, seam **a**) wires the live file-based PostTask hook → `ruflo hooks post-task` CLI, which writes the episode through the **ruflo/SQLite carve-out** (`hooks_post-task → agentdb_reflexion_store`, ADR-0268). **This path never touches agentic-flow's `AgentDBService`.** It is a different producer entirely.
- `_attachLearningSubscriber` lives in `AgentDBService`, and ADR-0195's *event-bus* seam is the **expensive half-seam** F10 explicitly **rejected** in favour of seam (a). So retiring `AgentDBService` removes the dead-half of the producer that F10 already decided not to use — it does not remove anything F10 needs.
- The only coupling to preserve is the **duck-typed** episode-sink contract in `autopilot-learning.ts` (`getAgentDBService()` / `SonaServiceLike`). Since that's duck-typed (confirmed: no static import), deleting the concrete class is safe **provided** the runtime injector that previously supplied an `AgentDBService` instance is either removed alongside or repointed to the SQLite-backed sink. → **Open verify for F10 facet:** who constructs the object passed as `svc` into `AutopilotLearning`, and does retiring the class strand that injection? (In the live ruflo path the injector is ruflo-side, not the island — so likely safe, but confirm.)

**Bottom line:** do F10 seam (a) and Scope-A retirement as independent changes; they don't block each other. If anything, land seam (a) first so the producer is provably island-free before deletion.

---

## 4. Open decision gates (human calls required first)

1. **(3a) Is agentic-flow's standalone MCP server still wanted as a separate product?** The island IS `agentic-flow mcp` (the 220+-tool stdio-full server). The live ruflo stack does not use it. If no external/standalone consumer wants it → delete (Scope A). If it's a shipped product → Scope A must *slim* it to the 11 CLEAN tool modules instead of deleting stdio-full. **This is the gating call.**
2. **(3b) Does anything external consume `mcp__agentic-flow__*` tools?** The codemod rewrites `mcp__agentic-flow__agentdb_* → mcp__agentdb__*`, implying historical external surface. Confirm no live `.mcp.json` / skill / downstream registers the agentic-flow stdio-full server before deleting.
3. **(3c) F10 sequencing preference:** land seam (a) before or after Scope A? (Recommendation: seam (a) first, to prove the producer is island-free.)
4. **(3d) ADR-0192/0193/0195/0196 episode-sink contract:** are these ADRs willing to re-anchor their "episode store" language from "AgentDBService" to the duck-typed/SQLite sink, or do they need the concrete class to remain as a named capability? (Per [[feedback-no-consumer-is-not-stub.md]]: confirm real-vs-stub before DELETE — here the class is REAL and fork-authored, so this is a deliberate retire-a-real-capability call, not a stub cleanup. The justification must be "no consumer + superseded by ruflo/SQLite sink," not "it's dead.")

---

## Caveats

- Reachability was computed over `import|export … from` static edges only. Dynamic `await import()` of the island would not show up — I checked the live ruflo tree's dynamic imports (only `coordination/autopilot-learning`, which is duck-typed) but did not exhaustively scan the *fork's own* dynamic imports of `agentdb-service`. Re-run a dynamic-import grep at delete time.
- `agentdb-phase4-methods.ts` is a `this`-bound mixin; verify no runtime member access survives type-stripping.
- ADR-0287 is `proposed`, not ratified — F5's DELETE disposition is not yet executed. This retirement should be folded into / sequenced after ADR-0287's ratification, or land as its own successor ADR that F5 points to.
- Per [[feedback-inspect-installed-not-dev-nodemodules.md]]: verify the *published* @sparkleideas/agentic-flow on Verdaccio does not expose stdio-full via a dist subpath before claiming "no API contract breaks" — I verified the source package.json exports map (NONE), which is authoritative for the contract, but a fresh-install spot check is cheap insurance.
