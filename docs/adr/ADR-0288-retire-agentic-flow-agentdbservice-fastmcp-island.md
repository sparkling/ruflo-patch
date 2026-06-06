---
status: proposed
date: 2026-06-03
tags: [agentic-flow, agentdb, mcp, retirement, dead-code, upstream-alignment, honesty]
supersedes: []
depends-on: [ADR-0287, ADR-0089, ADR-0161, ADR-0177, ADR-0195]
implements: []
---

# Retire the fork-only agentic-flow AgentDBService + fastmcp MCP island

## Context and Problem Statement

`AgentDBService` (`forks/agentic-flow/agentic-flow/src/services/agentdb-service.ts`, ~91 KB) wraps agentdb
controllers behind a service and backs a large fastmcp MCP-tool surface in
`agentic-flow/src/mcp/fastmcp/`. It was introduced **fork-side** by commit `2f372931`
("Integrate AgentDB controllers into agentic-flow v2 with 12 new MCP tools") at a time when agentic-flow was the
canonical home of the agentdb/RVF code. Two later moves routed around it: **ADR-0161** (2026-05-08) extracted
agentdb into its own 5th fork (`forks/agentdb`), and claude-flow moved to the v3 monorepo (`v3/@claude-flow/*`).

**ADR-0287 §F5** (the dead Phase-2 controller-activation block) flagged this layer as "the smallest chip off a
**larger, possibly-vestigial** agentic-flow `AgentDBService` + fastmcp surface" and explicitly anticipated "the
larger ADR" this record now is. A read-only 5-agent swarm (`swarm-1780507536857-mruhcx`, 2026-06-03;
findings in `docs/research/agentic-flow-retirement/00-SYNTHESIS.md` + `01-05`) investigated whether the whole
layer is retirable dead weight.

**Honesty framing (load-bearing — this is NOT a stub cleanup).** `AgentDBService` is **real, fork-authored,
working code**: its tools function (they delegate to live agentdb controllers). Per `feedback-no-consumer-is-not-stub`
("no consumer" ≠ "stub") and the fork's deliberate **implement-ahead posture** (ADR-0177, which keeps real honest
code ahead of its consumer on purpose), the default disposition for such code is **KEEP-AS-CAPABILITY, not
DELETE**. ADR-0210's DELETE governs *lies* (advertised surfaces that silently no-op), which this is not. So this
ADR must justify removal **positively** — "no live consumer **and** superseded **and** an ongoing cost worth
removing" — not by the insufficient "it's unused." One of the very controllers in the orphan set
(`StreamingEmbeddingService`) was previously mis-called DELETE and corrected to KEEP — a standing caution.

## Decision Drivers

* **Upstream alignment.** Upstream agentic-flow `origin/main` has **no `AgentDBService` and no agentdb-wrapping
  MCP layer**; `src/agentdb/index.ts` is a `@deprecated` **re-export shim** that "proxies to agentdb npm
  package," and the standalone `agentdb` package owns the canonical agent-facing MCP surface (41 tools, growing
  per agentdb ADR-073). The fork layer is a duplicate/parallel surface that exists on no upstream branch — the
  same redundancy upstream's library/standalone-MCP split was designed to end (cf. local ADR-0161, upstream
  "AgentDB becomes a library, not a service").
* **Implement-ahead posture (ADR-0177)** — cuts the **other** way: real working fork code is intentionally kept
  ahead of consumers; removal needs a positive case, not just "no consumer."
* **No functional loss** — every method/tool delegates to an agentdb controller that survives, or maps to a live
  `mcp__ruflo__*` tool / `agentdb` CLI command (facet 3).
* **Maintenance / merge-tax** — a 14-file static-import island + ~80 AgentDBService-backed tools + ~20 fork tests
  is ongoing surface to maintain and to reconcile on every upstream rebase.
* **Consequence-verifiability** — the change must be provably safe (compiler + tests in a sandbox) before any
  real removal; the requesting human's explicit concern is that consequences be confirmed, not asserted.

## Considered Options

* **A — Retire the island within the fork (KEEP the dependency).** Delete the 14-file `AgentDBService` +
  `stdio-full` island, edit the 3 dynamic consumers, delete/retarget the ~20 fork tests, retire the acceptance
  check, add a reverse-import guard. Keep the `agentic-flow` dep (the live tree needs ~15 other subpaths).
* **B — KEEP-AS-CAPABILITY (status quo).** Leave the island as implement-ahead code (ADR-0177). Zero risk;
  carries the merge-tax + duplicate-surface indefinitely.
* **C — Slim, not delete.** If agentic-flow's standalone `agentic-flow mcp` server is a wanted product, strip
  only the ~80 AgentDBService-backed tools and keep `stdio-full` + the 11 AgentDBService-free tool modules.
* **D — Drop the `agentic-flow` dependency entirely.** Rejected: the live ruflo tree statically imports ~15
  *other* agentic-flow subpaths (reasoningbank ×16, workers ×8, core ×8, hooks ×5, transport, sona,
  coordination). Each is its own replacement project; out of scope.

## Decision Outcome

**Chosen: defer the delete-vs-keep call to two human gates; until they resolve, the default is Option B
(KEEP-AS-CAPABILITY).** The investigation establishes that retirement is *feasible without functional loss* and
*aligns with upstream* — but "feasible to retire" ≠ "should delete." Under ADR-0177 the bar is a positive case,
and that case turns on gates this record cannot decide unilaterally:

* **Gate 1 [GATING] — is agentic-flow's standalone `agentic-flow mcp` server / CLI a wanted product?** The island
  *is* that ~220-tool `stdio-full` server. If nothing external runs it → **Option A** (delete). If it is a
  shipped/standalone surface → **Option C** (slim to the 11 clean modules), never a blind delete.
* **Gate 2 — does anything external consume `mcp__agentic-flow__*` tools?** The codemod rewrites
  `mcp__agentic-flow__agentdb_* → mcp__agentdb__*`, implying a historical external surface. **ADR-0213 already
  largely answers this:** that rewrite was *doc-only — zero production code* and `ruflo init` emits no `agentdb`
  MCP server entry (only `ruflo`), so no init-generated surface has ever registered the agentic-flow stdio-full
  server. Confirm this still holds (no live `.mcp.json` / skill / downstream registration) before deleting.
* **Gate 3 — re-anchor ADR-0192/0193/0195/0196/0197's "episode store"** language from `AgentDBService` to the
  duck-typed / ruflo-SQLite sink (those ADRs assume an `AgentDBService`-shaped episode sink exists).

**This ADR is `proposed` and authorises nothing.** It records the investigation, the consequence inventory, and
the decision framework. The actual removal requires (i) the gates resolved toward A/C, (ii) the sandbox
confirmation in `### Confirmation`, and (iii) a separate explicit go-ahead. **Sequencing:** land ADR-0287 §F10
seam (a) first — it is orthogonal (it writes via the ruflo/SQLite path, never `AgentDBService`) and proves the
episode producer is island-free before any deletion.

### Reachability (ground truth, 2026-06-03 — exhaustive static + dynamic scan, both repos)

* **The live ruflo (claude-flow v3) tree has ZERO importers** of `agentdb-service` / `stdio-full` /
  `getAgentDBService`. Every consumer found is *inside* `forks/agentic-flow`.
* The **only** ruflo→island coupling is indirect and **graceful-by-design**: ruflo loads
  `agentic-flow/coordination/autopilot-learning`, which does `await import('../services/agentdb-service.js')`
  and, on absence, logs `unavailable` + sets `_available=false` (ADR-0191 absence-not-accepted, ADR-0192
  degraded-mode) — **no throw**. That feature is already dormant (ADR-0287 §F10: zero episodes, no live writer).
* The fastmcp `stdio-full` server is reached by **no** ruflo daemon/worker/skill/CI/init and is **not** in
  `.mcp.json`; even agentic-flow's default `agentic-flow mcp` routes to a slim server *without* `AgentDBService`.

### Consequences

* Good, because it removes a duplicate/parallel MCP surface for an engine whose canonical agent-facing MCP is
  the standalone `agentdb` package (41 tools) — moving the fork **toward** upstream's topology, not away.
* Good, because the fork's **own** `controller-bridge.ts` header already declares `AgentDBService` the legacy
  path "Phase 5 will remove this bridge entirely" — retirement realises a documented fork intent.
* Good, because **zero capability is lost**: ~80 tools / ~30 methods all delegate to surviving `forks/agentdb`
  controllers (`ReflexionMemory`, `ExplainableRecall`, `QUIC*`, `SyncCoordinator`, `MMRDiversityRanker`,
  `NightlyLearner`, `StreamingEmbeddingService`, …) or map to live `mcp__ruflo__*` / `agentdb` CLI surfaces.
* Good, because it removes ongoing merge-tax (a 14-file island + ~20 tests reconciled on every upstream rebase).
* Bad, because it deletes **real, working, fork-authored code** (not a stub) — irreversible-ish, and against the
  ADR-0177 implement-ahead grain; the positive case must hold (gates above), else KEEP is correct.
* Bad, because agentic-flow's standalone `agentic-flow mcp` loses its ~80-tool surface and `cli/autopilot-cli.ts`
  **hard-throws** on the missing `getAgentDBService` (`:492`/`:502`) — both must be handled (Gate 1).
* Neutral, because the live ruflo memory/agentdb stack is unaffected; the only live-path effect is
  `autopilot-learning` degrading from dormant-loadable to gracefully-unavailable (an already-idle feature).
* Neutral, because ~20 agentic-flow fork tests + the ruflo-patch acceptance check
  `check_adr0089_agentdb_service_wraps` must be deleted/retargeted as part of the same change.

#### Full removal scope (~40 files — "record everything")

| Bucket | Items | Note |
|---|---|---|
| Island (delete) | `services/agentdb-service.ts`, `mcp/fastmcp/servers/stdio-full.ts`, 10 AgentDBService tool modules (attention/daa/hidden-controllers/memory/neural/performance/quic/rvf/session/workflow), `services/{direct-call-bridge,hook-service,swarm-service}.ts` | 14-file static-import island |
| Dynamic consumers (edit) | `coordination/autopilot-learning.ts` (graceful), `cli/autopilot-cli.ts` (**throws** — must handle), `services/streaming-service.ts` (dynamic ×2) | not part of the island; kept + de-coupled |
| Fork tests (delete/retarget) | ~20 files under `agentic-flow/tests/{integration,unit}` + `scripts/verify-{adr062,phase4}.ts` + `tests/benchmarks/mcp-tool-latency-bench.ts` | all import `AgentDBService` |
| ruflo-patch acceptance | `scripts/test-acceptance.sh` `check_adr0089_agentdb_service_wraps` (retire from **both** `run_check_bg` `:1441` AND `collect_parallel` `:2843`) | else silent "no verdict" |
| Standalone surface | `cli/mcp.ts → stdio-full` + `cli/doctor-cli.ts` check | Gate-1 product decision (delete vs slim) |
| Governance | new fork-local INTEGRATION-LEDGER row; reverse-import arch-guard (mirror ADR-0265 C7.b/c); prune dead `mcp__agentic-flow__agentdb_*` codemod rules | per `feedback-update-integration-ledger`, `feedback-patches-in-fork` |

### Confirmation

Before any real removal (all in a throwaway git worktree first — nothing touches the real fork):

* **Sandbox build-test** — perform Scope A/C in an isolated worktree, run `npm run build` (tsc) + the fork test
  suite (full output to disk per `feedback-no-tail-tests`); confirm the non-test source compiles (the 3 dynamic
  consumers do not strand a TS2307) and the only failing tests are the deleted island's.
* **Reverse-import arch-guard** — no file under `forks/ruflo` may import `services/agentdb-service` or
  `fastmcp/servers/stdio-full` (true today; locks the retirement).
* **Forbidden-substring sweep** — `AgentDBService` absent from compiled `dist` (JSDoc comments count,
  `feedback-forbidden-substring-tests-grep-dist`).
* **Published-package spot check** — fresh install of `@sparkleideas/agentic-flow` on Verdaccio exposes no
  `stdio`/`servers`/`agentdb-service` subpath (`feedback-inspect-installed-not-dev-nodemodules`).
* **Acceptance green** — full `scripts/test-acceptance.sh` passes with the ADR-0089 check retargeted, no
  "no verdict" gap.

## Pros and Cons of the Options

### A — Retire the island (keep the dep)

* Good, because upstream-aligned, zero capability lost, removes merge-tax, realises the fork's own "Phase 5" note.
* Bad, because it deletes real code (ADR-0177 grain) and kills agentic-flow's standalone MCP/CLI surface — only
  correct if Gate 1 says "no product" and Gate 2 says "no external consumer."

### B — Keep-as-capability (status quo)

* Good, because zero risk; honours the implement-ahead posture; costs nothing at runtime (not on the live path).
* Bad, because it carries a duplicate MCP surface + 14-file/20-test merge-tax indefinitely, and leaves a
  fork-only divergence upstream never had.

### C — Slim, not delete

* Good, because it preserves a wanted standalone MCP product while removing the redundant agentdb re-wrap.
* Bad, because it is more surgical work than a clean delete (must keep `stdio-full` wiring for 11 modules) and
  still requires de-coupling the 3 dynamic consumers.

### D — Drop the dependency entirely

* Good, because maximal cleanup if agentic-flow were truly unused.
* Bad, because **false premise** — the live tree statically needs ~15 other agentic-flow subpaths; rejected.

## More Information

* **Investigation:** swarm `swarm-1780507536857-mruhcx`; synthesis + 5 facets in
  `docs/research/agentic-flow-retirement/00-SYNTHESIS.md`, `01-live-invocation.md`, `02-package-usage.md`,
  `03-capability-gap.md`, `04-upstream-direction.md`, `05-blast-radius.md`.
* **Parent:** ADR-0287 §F5 (anticipates this ADR) + §F10 (orthogonal; land seam (a) first). This ADR also
  corrected ADR-0287's F5 banner-reachability note: the false banner *is* reachable in the live claude-flow
  process via the autopilot edge (`tryLoadLearning → autopilot-learning.initialize → getAgentDBService →
  getInstance → initialize → Phase-2`), not only agentic-flow's standalone surface.
* **Related (intra-corpus):** ADR-0089 (controller-intercept-permanent + the `check_adr0089` guard),
  ADR-0161 (agentdb extraction), ADR-0177 (implement-ahead posture — the KEEP driver), ADR-0192/0193/0195/0196/0197
  (autopilot-learning episode-sink, Gate 3), ADR-0210 (advertised-surface honesty — why this is *not* that),
  ADR-0265 (reverse-import guard precedent), ADR-0217 (fork-local island-deletion precedent),
  ADR-0213 (the `mcp__agentic-flow__agentdb_*` prefix rewrite was *doc-only, zero production code* — material
  for Gate 2), ADR-0160 / ADR-0039a (upstream agentdb extraction + controller-integration context).
* **Upstream (prose-reference):** agentic-flow `origin/main` `src/agentdb/index.ts` (re-export shim);
  standalone `agentdb` `src/mcp/agentdb-mcp-server.ts` (41 tools) + agentdb ADR-073 (SOTA roadmap, growing the
  MCP surface); upstream "AgentDB becomes a library, not a service."
* **Governance:** `feedback-no-consumer-is-not-stub`, `feedback-patches-in-fork`, `feedback-update-integration-ledger`,
  `feedback-always-wire-tests-into-cicd`, `feedback-inspect-installed-not-dev-nodemodules`.

### Implementation note (post-hoc, 2026-06-06)

* **Gates resolved → Option C-prime executed fork-side** as agentic-flow `8c5ec5d7` (2026-06-04):
  island deleted (`agentdb-service.ts` 91KB, `controller-bridge.ts` — realising its own "Phase 5
  will remove this bridge entirely" note — plus direct-call-bridge/hook-service/swarm-service and
  the 10 AgentDBService tool modules); `stdio-full.ts` SLIMMED 894→488 keeping the 11 island-free
  fork registrations (github/ruvector/sona-rvf/infrastructure/autopilot/cost-optimizer/streaming/
  sona/quantization/explainability/booster); the 3 dynamic consumers de-coupled honestly
  (autopilot-learning → honest unavailable, capture flows via hooks post-task per ADR-0268/0290;
  autopilot-cli drops `autopilot subscribe`; streaming-service drops the retired stream surfaces).
  The published `@sparkleideas/agentic-flow@…patch.963.1` ships neither `agentdb-service.js` nor
  `controller-bridge.js` (verified by tarball listing, 2026-06-06) — the retirement is live.
* **Patch-repo test sweep completed 2026-06-06** — the scope-table row found undone when the unit
  suite went red against the post-retirement fork: unit retargets to retirement guards
  (`adr0089-intercept-enforcement` T2/T4; `adr0076-phase4-wiring` bridge/stdio describes;
  `adr0076-phase2-5` bridge describe; `adr0069-f3-onnx-import-resolvable` consumer assertions;
  `agentdb-service-f1-improvements` reality pin; `adr0069-f3-booster` dist mirror → LOUD-SKIP when
  the dev dist is absent) and the acceptance retarget (`check_adr0089_agentdb_service_wraps` →
  `check_adr0288_agentdb_service_retired`: published agentic-flow must ship neither island file —
  green against current published).
* **Timeline note (recorded, not chased):** the agentic-flow `patch.963` version bump landed
  2026-06-04 04:58, ~2h after the retirement, while the patch-repo unit suite was red against the
  deleted island (the failing tests predate the retirement by 7 weeks) and the old `adr0089-svc`
  acceptance check could no longer pass against the published artifact. Whatever ran that day did
  not gate on the full cascade.
* **Open:** Gate-3 re-anchoring (ADR-0192-family "episode store" language) remains tracked, not
  done here. Status flips with the next green release.
