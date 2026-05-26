---
status: accepted
completed: true
date: 2026-05-19
methodology: [MADR]
decision-makers: [Henrik Pettersen]
tags: [autopilot, learning, gnn, federation, audit, side-effects, ADR-0193, ADR-0194, ADR-0195, ADR-0196]
related: [0193, 0194, 0195, 0196]
upstream-related: [agentic-flow/ADR-058, agentic-flow/ADR-059]
audience: ai-executor
---

# ADR-0197: Three side-effect findings from ADR-0193 implementation

## Context and Problem Statement

ADR-0193's two-wave swarm execution and the three sub-ADR fill-in pass surfaced three architecture-level findings that fell outside the parent ADR's stated scope. Each is real, code-grounded, and warrants an explicit decision so it doesn't decay into "discovered then forgotten."

This ADR records all three together because:

* Each was discovered by a different ADR's analysis (0193 audit → 0195 agent → 0196 agent).
* Each affects a different subsystem (learning controller / GNN library / federation substrate).
* Each has a separate decision shape (fix now / scope already corrected / substrate already exists).
* Bundling them avoids three single-purpose ADRs that would over-formalize what are mostly observations.

The three findings are recorded below. Two have already been absorbed into the relevant sub-ADRs' rewrites; one remains an open standalone bug.

## Finding 1 — Latent `learningSystem.predictAction` bug

### Where

`forks/agentic-flow/agentic-flow/src/services/agentdb-service.ts:1214` calls:

```ts
const prediction = await this.learningSystem.predictAction?.(String(state));
```

### What's wrong

`LearningSystem` exposes no `predictAction` method. The real surface is `predict(sessionId, state)` at `forks/agentdb/src/controllers/LearningSystem.ts:267`.

The optional-chain (`?.`) means the call returns `undefined` every time — silently. No error surfaces; no log line; the calling code at `agentdb-service.ts:1214-1217` continues with `prediction === undefined` and falls through whatever branch reads it.

Worse: the surrounding try/catch at `agentdb-service.ts:1216` sets `this.learningSystem = null` on first throw. If anything in the call chain throws (e.g., `String(state)` on a circular object, or a coerce error somewhere in the unused result handling), the entire `learningSystem` is permanently nulled for the process lifetime. The same path then becomes an `available: false` for every subsequent caller without any restart-recovery.

### Why it matters

* **Silent feature absence**: the autopilot's "policy-recommended action" path returns no recommendation at all. Consumers either get the trivial default or hit the nulled-learningSystem branch.
* **No-op-by-typo**: the call shape says "this is wired to LearningSystem" — it isn't. Reading the code suggests a feature exists that empirically doesn't.
* **Permanent degradation**: once nulled, the only recovery is process restart. No reconciliation loop, no retry, no alert.

### Decision

**Fix as part of ADR-0195 Phase 4 implementation (concurrent landing).** Replace `predictAction?.(...)` with the real `predict(sessionId, state)` call shape, plumb `sessionId` from the caller's context, and remove the catch-and-null pattern (per `feedback-no-fallbacks.md`). Phase 4's cross-controller bridge wires AutopilotLearning → LearningSystem via `predict` / `submitFeedback`, so the fix lands in the same change.

### Tracking

Open question recorded in `ADR-0195-autopilot-learning-phase4-cross-controller-bridges.md` (the "Three additional observations" section names this bug explicitly).

### Resolution (2026-05-19)

Resolved by `forks/agentic-flow@dc41afc` (the direct removal of the broken probe + catch-and-null pattern) + `forks/agentic-flow@31a0c25` (Phase 4 bus + LearningSystem subscriber wiring).

The literal fix described in the Decision section above ("replace `predictAction?.(...)` with the real `predict(sessionId, state)` shape inside `AgentDBService.predictAction`") was NOT applied at that exact callsite because the public `predictAction(state: any)` surface (consumed by `mcp__neural_predict`, `stdio-full.ts:834`, `direct-call-bridge.ts:131`, and integration tests) has no sessionId source — no caller had one to plumb. Adding a synthesized-per-call sessionId at that boundary would have either changed the public signature (breaking 3 callers + 5 integration tests) or hardcoded a default (forbidden per `feedback-no-fallbacks`).

Instead, `dc41afc` removed the broken probe entirely (the dead-on-arrival branch produced no behavior; deleting it has zero observable cost) and `31a0c25` provides the *legitimate* `predict` / `submitFeedback` consumer at a different boundary — the LearningSystem subscriber inside `AgentDBService._attachLearningSubscriber`. There, the sessionId IS synthesizable from caller context (the autopilot subject hash: `autopilot:${sha1(subject)}`) per ADR-0195 §Decision Outcome §Contract, and the call shape matches `LearningSystem.predict` / `LearningSystem.submitFeedback` exactly. The bridge discharges the architecture gap Finding 1 named: autopilot signals now reach the LearningSystem policy update path with a real, properly-bound session.

`AgentDBService.getLearningSystem(): any` was also added (previously private) so any future caller with a legitimate sessionId can reach `predict` directly without re-introducing the broken probe.

## Finding 2 — `@ruvector/gnn` Node binding has no clustering API

### Where

`forks/ruvector/crates/ruvector-gnn-node/index.d.ts` (the napi-rs Node binding for `@ruvector/gnn`) exports only:

* `differentiableSearch`
* `hierarchicalForward`
* `getCompressionLevel`
* `RuvectorLayer.forward`
* `TensorCompress`

### What this contradicts

Upstream agentic-flow ADR-059 and ADR-0193 §G's Phase 3 description framed Phase 3 as "GNN-enhanced patterns via `@ruvector/gnn`" — implying the GNN library would do the clustering. It can't. There is no Louvain, no k-means, no community-detection primitive in the exposed Node surface. The GNN role is restricted to embedding generation / forward passes; clustering is on us.

The original ADR-0194 stub copied the upstream framing verbatim. That framing was wishful — it didn't reflect the library's actual surface.

### Decision

**Scope correction already landed in ADR-0194.** The fresh-eye agent rewrite renamed the ADR's `pattern` from "GNN-enhanced patterns" to "embedding-cluster pattern discovery" and re-pitched the role of `@ruvector/gnn` as optional embedding enhancement (`RuvectorLayer.forward` on per-episode embeddings before clustering), not as the clustering primitive.

ADR-0194 now recommends Option 1 (greedy cosine clustering, copy `MemoryConsolidation.clusterMemories` at `forks/agentdb/src/controllers/MemoryConsolidation.ts:298-341`). Option 2 retains the GNN-enhancement framing as a follow-up after Option 1 ships.

### Tracking

ADR-0194 captures this in its "Decision Drivers" section: `@ruvector/gnn Node binding does NOT expose clustering`. No further action needed.

### Note on the upstream framing

The upstream ADR-059 framing was speculative ("we *could* use GNN for clustering once `@ruvector/gnn` exposes the primitive"). Since the upstream binding never grew that primitive, the implementation path the framing suggested was never reachable. ADR-0194's rename keeps the spirit (embedding-based clustering) without misrepresenting the library.

## Finding 3 — QUIC + CRDT + SyncCoordinator surface is interface-complete

### Where

agentdb's federation stack:

* `forks/agentdb/src/controllers/QUICServer.ts` (503 lines): request/response shape, connection registry, rate-limiting, auth-token check, `processSyncRequest` dispatch to `syncEpisodes` / `syncSkills` / `syncEdges`. `start()` at line 100 only sets `isRunning = true` — in-source comment at line 111: *"Actual QUIC implementation would use a library like @fails-components/webtransport or node-quic. This is a reference implementation showing the interface."*
* `forks/agentdb/src/controllers/QUICClient.ts` (667 lines): pool, retry, push/pull surface. Same disclaimer.
* `forks/agentdb/src/controllers/QUICConnection.ts` (429 lines, file header): *"TODO: ADR required before activation — ADR-0161 lift, no production wiring"*. 0-RTT / BBR / migration logic implemented against a fictional underlying socket.
* `forks/agentdb/src/controllers/SyncCoordinator.ts` (792 lines): bidirectional `sync(ctx, onProgress)`, change detection by `ts > lastSyncAt` against `episodes` / `skills` / `skill_edges` tables, conflict resolution strategies (`local-wins` | `remote-wins` | `latest-wins` | `merge`), Merkle-style checksumming, ADR-0180 audit integration. Real, but wired to a `QUICClient` that has no real transport.
* CRDT primitives in `forks/agentdb/src/types/quic.ts` (772 lines): `VectorClock` with `compareVectorClocks` / `mergeVectorClocks` / `incrementVectorClock`, `GCounter`, `LWWRegister<T>`, `ORSet<T>`, `EpisodeSync` / `SkillSync` / `CausalEdgeSync` message envelopes, `JWTClaims` for auth.

`AgentDBService.initializePhase4Controllers` (`forks/agentic-flow/agentic-flow/src/services/agentdb-service.ts:801-893`) already wires `SyncCoordinator` and conditionally `QUICClient` / `QUICServer` behind `ENABLE_QUIC_SYNC` / `ENABLE_QUIC_SERVER` env vars. `syncWithRemote(onProgress)` at line 1545 is exposed. `forks/agentic-flow/agentic-flow/src/mcp/fastmcp/tools/quic-tools.ts` registers 4 MCP tools (`quic_sync_episodes`, `quic_sync_skills`, `quic_latency`, `quic_health`) on top.

### What this contradicts

The original ADR-0196 stub framed Phase 5 as "interface-defined, runtime deferred" — implying the federation interface was the next thing to write. The agent's audit found the interface is already written and well-tested; only the transport layer (the actual QUIC binding) is stubbed.

Net: **the entire surface above the transport is built**. Episodes already flow into `SyncCoordinator.detectChanges()` (`SyncCoordinator.ts:220`) via the SQL `episodes` table that `AutopilotLearning._record` writes to (`autopilot-learning.ts:485-498`). The "Phase 5 = federation" work is shorter than ADR-0193 §G implied — pick a QUIC binding (`node:quic` in Node 23+, or `@fails-components/webtransport`, or HTTP/2 fallback, or libp2p), wire it into `QUICConnection`, add episode identity fields (`originInstallId`, `vectorClock`), and ship.

### Decision

**Substrate finding shapes ADR-0196's recommended path; no further action needed here.** ADR-0196 already switched from Option 1 (interface-only no-op) to Option 2 (adapter over existing `SyncCoordinator`). The pre-decision audit captured the QUIC/CRDT/SyncCoordinator state in ADR-0196's "Context and Problem Statement" section.

### Note on the deprecation memory correction

Memory `project-deprecated-controllers.md` previously claimed `FederatedLearningManager` was a disabled stub. The current code disagrees: `FederatedLearningManager` is alive at `forks/agentdb/src/services/federated-learning.ts:330`, wired in `forks/ruflo/v3/@claude-flow/memory/src/controller-registry.ts:2038`. It does **in-process Float32Array aggregation** across SONA ephemeral agents — a different system from the cross-process `SyncCoordinator` story Phase 5 targets. Memory was corrected in the same change that committed ADR-0196's rewrite.

### Transport binding selection (deferred)

The choice between `node:quic` (Node 23+, native), `@fails-components/webtransport` (cross-version, WHATWG-aligned), HTTP/2 fallback (most portable), gRPC (heaviest, schema-driven), or libp2p (peer-to-peer-native) is a separate decision with its own operational impact. ADR-0196 explicitly does not pre-commit to a binding; that selection is a future ADR.

## Decision Outcome

Per finding:

1. **Finding 1** (latent `predictAction` bug): **defer to ADR-0195 Phase 4 implementation**. Captured in ADR-0195 as a load-bearing pre-existing condition the Phase 4 work must address. Acceptable to leave unfixed in isolation because the buggy path is dead-on-arrival (no wrong behavior produced; just absent feature).

2. **Finding 2** (GNN scope correction): **already absorbed into ADR-0194's rewrite**. ADR title and content renamed; recommendation re-pitched. No further action.

3. **Finding 3** (QUIC substrate exists): **already absorbed into ADR-0196's rewrite**. Recommendation switched to adapter-over-existing-SyncCoordinator. Transport binding selection remains a future ADR.

## Consequences

### Positive

* Three findings that surfaced incidentally now have explicit decisions instead of decaying into "we noticed something."
* Memory `project-deprecated-controllers.md` corrected based on Finding 3's audit — future agents won't repeat the wrong "FederatedLearningManager is a stub" claim.
* ADR-0194 + ADR-0196's recommendations now match the actual code substrate; future implementation work won't waste effort on the wrong path.
* The latent `predictAction` bug (Finding 1) is documented in two places (here + ADR-0195) so it can't be missed when Phase 4 starts.

### Negative

* Finding 1 stays unfixed until Phase 4 is prioritized. If Phase 4 is deferred indefinitely, the autopilot's "policy-recommended action" path silently produces no recommendation. Recovery: standalone bug fix; cost is two commits touching the same file in close sequence.
* Finding 3 reveals that Phase 5's effort is smaller than ADR-0193 §G implied — which is good for prioritization but means we've under-budgeted the "wait for federation infra" deferral in earlier ADRs.

### Risks

* **Finding 1 escalation**: if any caller's input shape changes (e.g., `state` becomes non-string-coercible), the catch-and-null path at `agentdb-service.ts:1216` will fire and permanently null `learningSystem`. The dead-on-arrival path becomes a soft-fail-permanent path. Mitigation: monitor `[AgentDBService]` stderr for the null-and-disable line; if it appears in production logs, escalate Finding 1 to immediate fix.
* **Finding 2 regression risk**: if upstream `@ruvector/gnn` adds a clustering API later, ADR-0194's recommendation no longer matches the library's capabilities. Mitigation: revisit ADR-0194 when `@ruvector/gnn` ships a clustering primitive.
* **Finding 3 binding selection deferred**: the longer the transport-binding decision waits, the more downstream interface choices ossify around `SyncCoordinator`'s current contract. Mitigation: open the binding-selection ADR before any second Phase-5-adjacent work starts.

## Tracking

* Finding 1 → ADR-0195 "Three additional observations" section + this ADR's Decision Outcome.
* Finding 2 → ADR-0194 rewrite (status: proposed); this ADR's Decision Outcome.
* Finding 3 → ADR-0196 rewrite (status: proposed); memory `project-deprecated-controllers.md` correction (2026-05-19); this ADR's Decision Outcome.

This ADR closes immediately on acceptance — it's a record of discoveries with their respective dispositions, not an implementation plan.
