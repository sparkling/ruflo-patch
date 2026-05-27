# Post-ADR-0261 upstream-merge completion plan

**Date**: 2026-05-27
**Author**: Henrik (with Claude Opus 4.7)
**Status**: draft

## Context

[[ADR-0261]] is `accepted + completed: true + implemented: 2026-05-27` (ratified 2026-05-27; release 3.7.0-alpha.10-patch.327 publishes the fork-native graph-edges substrate; INTEGRATION-LEDGER row 234 disposition flipped `deferred` → `reimplemented-via-adr-0261`).

The ADR-130 upstream merge is structurally complete. What remains:

- **3 ledger rows** (235/237/238) in the ADR-130 family carry `defer` dispositions whose blocking parent is now resolved. They are inert ledger items that should be re-dispositioned to close the family.
- **ADR-129 Phases 1-3** (rvagent integration) is the remaining substantive upstream-merge surface. Its two design gates (ADR-0258 persistence-threading + ADR-0259 SAFE_MCP_TOOLS allowlist) flipped to `accepted + completed` during this work. Implementation can begin.
- **ADR-0263** (archivist replay-verification harness, ADR-0181 Phase I successor) is `proposed + completed: false`. Fork-internal — not an upstream merge — but is the next ADR in the queue.

Three tracks below. Tracks A and B advance the upstream-merge frontier; Track C runs orthogonal and doesn't block either.

## Track A — Close the ADR-130 family ledger (small)

**Scope**: re-disposition 3 deferred rows in `docs/upstream/INTEGRATION-LEDGER.md`. No new ADR. No code changes.

| Row | SHA | Subject | New disposition | Rationale |
|---|---|---|---|---|
| 235 | `16810c3e2` | fix(bench) ADR-130 P6 CI-friendly single-session inserts | **skip-by-policy** (was: defer) | Upstream's bench targets `graph-edge-writer.ts`; the fork-native design ([[ADR-0261]]) replaced that path with the archivist handler. Fork's own `scripts/benchmark-graph.mjs` measures the equivalent surface (T1/T2/T3 against `agentdb_graph_edge`). Pick has no fork-side surface to land on. |
| 237 | `10086c4bb` | ci: timeout-minutes:40 to graph-benchmark job | **skip-by-policy** (was: defer) | Upstream tunes timeout for its own CI job. Fork's CI surface (`.github/workflows/v3-ci-graph.yml`) is independent + its smokes complete in sub-60s wall-clock after the shared-temp refactor (`d44fc86`). The 40-minute knob has nothing to gate. |
| 238 | `542481053` | docs(adr) ADR-130 graph intelligence integration + improvement roadmap | **referenced-from-fork-adr** (was: defer) | Upstream's docs cite upstream-only infrastructure (`graph-edge-writer.ts`, `MEMORY_SCHEMA_V3`, `verification/witness-fixes.json`). The fork's [[ADR-0261]] §Cross-references already names upstream PR `edde98f9e` as the inspiration. Re-disposition closes the row without picking the upstream doc. |

**Deliverables**:

1. Edit rows 235/237/238 with the new dispositions + dated note pointing to this plan.
2. Commit as `docs(ledger): close ADR-130 family deferred rows 235/237/238 (post-ADR-0261)`.
3. Push.

**Acceptance**: `grep "edde98f9e\|16810c3e2\|10086c4bb\|542481053" docs/upstream/INTEGRATION-LEDGER.md` shows no remaining `defer` disposition for ADR-130 family.

**Risk shape**: lowest. Pure documentation hygiene; no runtime behavior change; no merge conflicts possible.

## Track B — ADR-129 Phases 1-3 implementation (substantive)

**Scope**: implement upstream's rvagent integration Phases 1-3 (file at `47a7825b0` per ledger row 239). Both design gates are now done; the substantive work is reconciling upstream's MCP-tool surface with the fork's existing persistence layer in `wasm-agent-tools.ts`.

**Pre-flight reading**:
- [[ADR-0254]] §"Phase-by-phase analysis" for the per-phase scope.
- [[ADR-0256]] §"Option A" for the Phase 4 precedent (helpers + smoke + CI stanza pattern).
- [[ADR-0258]] for persistence-threading decisions on Phases 1-3 MCP tools.
- [[ADR-0259]] for the SAFE_MCP_TOOLS allowlist alignment.
- Fork's `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/wasm-agent-tools.ts` (the 592-line existing persistence layer that upstream's verbatim PR does not have).

**Two-stage delivery**:

### B.1 — New implementation ADR (call provisionally `ADR-0265 — ADR-129 Phases 1-3 implementation amendment`)

Drafts the design that reconciles upstream's Phase 1-3 MCP-tool surface (per upstream PR `47a7825b0`) with:
- Fork's `wasm-agent-tools.ts` persistence layer (`<projectRoot>/.claude-flow/wasm-agents/store.json` + `withStoreLock` + `snapshotAgent` + `ensureLive`)
- The persistence-threading decisions from [[ADR-0258]]
- The allowlist alignment from [[ADR-0259]]

Specifies file-level deliverables, acceptance criteria tied to the §R2.6-style 10-criteria table format ADR-0261 used, and §R2.10-style divergence catalog (what's forced by fork invariants vs convergent with upstream).

Status: `proposed` → council review (smaller than ADR-0261's; the design gates already exist) → `accepted` → implementation → `completed: true`.

### B.2 — Implementation

Mirrors the ADR-0261 implementation pattern:
- Parallel agent fan-out for the source writes (3 repos: agentdb if any handlers/types changed, ruflo cli for the MCP tools + persistence layer reconciliation, ruflo-patch for smokes + CI)
- Acceptance via 5 granular smokes (one per Phase 1, 2, 3 + a persistence-threading smoke + an allowlist-alignment smoke)
- Smokes wired into the canonical harness via a new `lib/acceptance-adr0265-checks.sh` (per [[feedback-always-wire-tests-into-cicd]])
- Release via `npm run release`; verdict via the canonical harness
- INTEGRATION-LEDGER row 239 updated from `pick-partial` to disposition reflecting the full integration

**Acceptance**:
1. New ADR-0265-shaped ratified
2. 3 phases land in forks; release publishes; sparkling push from pipeline
3. Smokes green through canonical harness
4. ADR-0265 `completed: true`
5. Ledger row 239 updated

**Risk shape**: medium. The reconciliation between upstream's MCP surface and the fork's persistence layer is the load-bearing design decision — both gates exist (ADR-0258/0259) but their implementation may surface impedance the gates didn't anticipate. Mitigation: spawn a council on the design ADR (lighter than ADR-0261's — focused on persistence-vs-MCP integration only).

## Track C — ADR-0263 ratification + implementation (parallel; non-blocking)

**Scope**: archivist replay-verification harness (ADR-0181 Phase I successor). Fork-internal. Doesn't block upstream merge progress but is the next pending ADR in the queue.

**Sequence**:
1. Council review of [[ADR-0263]] design (currently `proposed`)
2. Ratification: `proposed` → `accepted`
3. Implementation per the ADR's §Decision Outcome
4. Acceptance via canonical harness (one or more checks under a new `lib/acceptance-adr0263-checks.sh`)
5. `completed: true`

**Risk shape**: bounded — the replay-verification harness is a test surface, not a production code path.

## Sequencing

- **Track A first** — 5-minute ledger update closes the ADR-130 family before opening new fronts; clears the deferred-disposition noise in the ledger that an ADR-129 Phase 1-3 planner would have to step over.
- **Tracks B and C in parallel** — independent: B is upstream merge; C is fork-internal. Different repos, different ADRs, different smokes.
- **B.1 (design ADR) before B.2 (implementation)** — non-negotiable per the proposed-then-accepted gate pattern.

No time estimates — the work shape is the signal, not the clock. Track A is one commit; Track B is multi-day with a council step; Track C is multi-day with a council step.

## Cross-references

- [[ADR-0261]] — the precedent pattern (council + revision + amendment + acceptance via harness)
- [[ADR-0254]] — upstream-decision contract for ADR-129/130
- [[ADR-0256]] — ADR-129 Phase 4 precedent
- [[ADR-0258]] — persistence-threading design gate (done)
- [[ADR-0259]] — allowlist alignment design gate (done)
- [[ADR-0263]] — archivist replay-verification harness (proposed)
- INTEGRATION-LEDGER rows 234 (closed via ADR-0261), 235/237/238 (Track A), 239 (Track B)
- [[feedback-always-wire-tests-into-cicd]] — both B and C must wire their smokes into the canonical harness
- [[reference-acceptance-perf-analyzer]] — use post-implementation to verify new smokes don't introduce PARALLEL-WASTE
- [[feedback-commit-forks-before-release]] — fork commits land before `npm run release`
- [[feedback-no-time-estimates]] — sequencing reasons about risk shape, not duration
