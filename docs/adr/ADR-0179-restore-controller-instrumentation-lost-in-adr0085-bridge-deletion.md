---
status: proposed
date: 2026-05-13
tags: [memory, controllers, instrumentation, audit-gap, post-mortem]
supersedes: []
depends-on: [ADR-0053, ADR-0085, ADR-0084, ADR-0086, ADR-0112, ADR-0102, ADR-0177, ADR-0178, ADR-0180, ADR-0181, ADR-0183]
implements: []
---

> **Status note (2026-05-28, swarm review)**: The "restore six lost
> behaviors" framing is **~80% obsolete**. 5 of 6 are no longer "lost and
> needing restoration" — they were reimplemented in a better place by the
> now-live archivist (ADR-0180 `guard-policy` + `audit-chain`, ADR-0181
> runtime activation, ADR-0183 write-path unification — the last two this
> ADR never referenced). Only **SkillLibrary auto-promotion on feedback**
> is genuinely still missing (~30 LoC). The 34-row behavioral-diff table —
> this ADR's stated central deliverable — is a literal stub (rows 3-33 say
> "(Phase 1 hive output)") and its planned router-call-site target no
> longer exists. Re-scope per §Amendment 2026-05-28; do NOT execute the
> 15-agent restoration plan.

# Restore Controller Instrumentation Lost in ADR-0085 Bridge Deletion

## Context and Problem Statement

### Why the bridge existed in the first place (ADR-0053, 2026-02-25)

The bridge was not scaffolding or a temporary integration. ADR-0053 (AgentDB v3
Controller Activation & Runtime Wiring, 2026-02-25, **Implemented**) created
`memory-bridge.ts` as the permanent **Phase 1 Core Foundation** for a 6-phase
controller-activation programme. The problem it was solving:

> AgentDB v3 ships a rich controller ecosystem — 28 controllers covering
> self-learning, causal reasoning, episodic replay, explainable recall,
> proof-gated mutations, graph intelligence, skill promotion, and multi-armed
> bandit optimization — but the CLI runtime (`@claude-flow/cli`) instantiates
> none of them. The result is that powerful capabilities are available as dead
> exports while the runtime falls back to generic memory operations via
> `memory-initializer.js`.

ADR-0053 §Decision routed CLI memory ops through `ControllerRegistry →
HybridBackend → AgentDB v3 controllers` instead of raw sql.js, eliminating the
"dual memory system" (issues #1207–#1227, one issue per stranded controller).
The bridge is named in two load-bearing senses simultaneously:

1. **GoF Bridge pattern** — decouples the CLI's memory abstraction from
   AgentDB's controller implementations so they can vary independently.
2. **Cross-package literal bridge** — physically connects `@claude-flow/cli`
   and `@claude-flow/memory` (which wraps `agentdb`) across the package boundary
   without forcing tight coupling.

**The bridge was framed as permanent Phase 1 Foundation, not scaffolding.**
ADR-0053's six phases enumerate features added *inside* the bridge, not stages
on a path to removing it. The completed marker reads `## Completed: Foundation
Bridge (Phase 1 Core)`.

The six behaviours this ADR (ADR-0179) catalogues as lost are the **literal
deliverables** that ADR-0053 §Phase 2–5 listed by name as the bridge's mission:

| ADR-0053 Phase | Bridge mission | Behaviour now lost (per ADR-0179) |
|----------------|----------------|------------------------------------|
| Phase 2 | "HybridSearch (BM25) — Replace hand-rolled `String.includes()` fallback with reciprocal rank fusion" | (4) Hybrid BM25 + semantic fusion as default |
| Phase 2 | "recordFeedback callers — Add feedback recording to `post-task` hook on task success/failure" | (6) SkillLibrary auto-promotion on feedback |
| Phase 4 | "TieredCacheManager — Wire 5-tier compression config into HybridBackend init" | (2) TieredCache write-through |
| Phase 4 | "ExplainableRecall — Wire Merkle provenance certificates into search result metadata" | (5) ExplainableRecall provenance strings |
| Phase 4 | "SkillLibrary — Instantiate Voyager-pattern skill promotion from high-reward trajectories" | (6) SkillLibrary auto-promotion (same line item) |
| Phase 5 | "MutationGuard — Route all CLI memory mutations through guard" | (1) MutationGuard pre-write policy gate |
| Phase 5 | "AttestationLog — Expose attestation chain in `session-start` health checks" | (3) AttestationLog audit write |

ADR-0085's deletion was structurally sound but unintentionally **shed the entire
ADR-0053 mission deliverable list**. Every behaviour catalogued below was
deliberately wired by ADR-0053 (issues #1216, #1215, #1219, #1220, plus the
proof-gated #1207–#1227 chain) and is therefore not edge-case instrumentation —
it is the primary deliverable of a previous accepted ADR.

### Why ADR-0085's audit missed this

Between ADR-0053 (2026-02-25) and ADR-0085 (2026-04-13) — roughly 7 weeks —
three architectural moves changed the bridge's status from "permanent foundation"
to "redundant indirection":

1. **ADR-0086 storage axis split.** RVF became primary for `memory_*`;
   AgentDB SQLite became the secondary axis for `agentdb_*`. The bridge's
   "one integration point for all memory ops" mission disintegrated — there
   was no longer a single substrate to integrate against.
2. **ADR-0084 Phase 4 controller-direct access.** The router learned to call
   `getController('reasoningBank')` directly. The bridge's controller-access
   functions (`bridgeGetController`, `bridgeHasController`, `bridgeListControllers`)
   became redundant indirection.
3. **ADR-0112 axis independence.** "Two independent stores, no tool spans both"
   made the bridge's "single orchestrator for both stores" mental model not just
   redundant but architecturally wrong.

`agentdb-orchestration.ts` then materialised with 15 functions literally
commented `// Replicates: memory-bridge.ts bridgeXxx`, surfacing the redundancy
as a duplication-burden audit-trigger.

ADR-0085's 8-agent hive asked "is the bridge worth keeping as a module?" and
correctly answered "no." But the hive's specialists — "registry bootstrap
expert", "dead code analyst", "merge conflict analyst" — were structurally
optimised for that question. **No specialist asked "what features lived
*inside* the functions we are deleting?"** ADR-0053's mission deliverables were
not on the audit's checklist because nobody re-read ADR-0053 during the
deletion. The hive saw bridge surface area; it did not see ADR-0053 inheritance.

### Quantified regression against ADR-0053

The `ControllerRegistry` type definition currently enumerates **47 named controller
slots**. Across the whole `forks/ruflo/v3/@claude-flow/cli/src` tree,
`getController('<name>')` (or `registry.get('<name>')`) is called on **30**
of them. **17 controllers are instantiated by the registry but never accessed by
any user-facing code path** — the literal "instantiated-but-not-wired" pattern
ADR-0053 was created to eliminate.

Of those 17, eight are legitimate internal composition (attention sub-modules
folded inside `attentionService`; vector-backend primitives consumed by HNSW).
That leaves **nine controllers as genuine dead exports**, four of which are direct
regressions against ADR-0053's resolved issues:

| Controller | ADR-0053 issue | ADR-0053 resolution | Fork-now status |
|------------|----------------|---------------------|-----------------|
| `tieredCache` | Phase 4 #1220 | Resolved (wired via `HybridBackend` init) | Factory exists; zero user-facing callers — **regressed** |
| `explainableRecall` | Phase 4 #1216 | Resolved (`bridgeGetController('explainableRecall')`) | Factory exists; zero callers — **regressed** |
| `mutationGuard` | Phase 5 | Activated inside AgentDB, "route all CLI mutations through guard" | Factory exists; only the factory method's own delegation call — zero user-facing callers — **regressed** |
| `attestationLog` | Phase 5 | Activated, "expose attestation chain in `session-start` health checks" | Factory exists; zero callers — **regressed** |

The remaining five dead exports (`auditLogger`, `circuitBreaker` — name-drifted
from the called `circuitBreakerController`, `indexHealthMonitor`, `rvfOptimizer`,
`federatedLearningManager` — already slated for removal per
`project-deprecated-controllers.md`) are not ADR-0053 regressions but
demonstrate that the post-ADR-0085 architecture has no mechanism to prevent the
exact ADR-0053 failure mode from accumulating: new controllers can be added to
the registry without any corresponding caller, and nothing surfaces the gap.

ADR-0053's resolutions that **did** survive — `reasoningBank`, `reflexion`,
`causalGraph`, `skills`, `learningSystem`, `memoryGraph`, `agentMemoryScope`,
`nightlyLearner`, `sonaTrajectory`, `solverBandit`, `semanticRouter` — are all
reachable via `getController()` in the fork. So ADR-0085's deletion did not
reintroduce the entire ADR-0053 problem; it reintroduced a specific quadrant:
**the policy / audit / cache / explainability controllers** — which is exactly
the cluster ADR-0179 § (1)–(5) catalogues as lost behaviours.

This makes the regression structurally identical to the original ADR-0053
problem statement, just narrower:

> Powerful capabilities are available as dead exports while the runtime falls
> back to generic memory operations.

Four ADR-0053-resolved capabilities are dead exports again. ADR-0179 is the
re-resolution.

### What ADR-0179 corrects

A 2026-05-13 conversational audit walked the 34 exports of upstream's current
`memory-bridge.ts` (commit `ef73a1616`, post-ADR-0115) against the fork's
post-deletion state. Findings:

### Original deletion impact (ADR-0085 audit)

ADR-0085 (2026-04-13) deleted ~3,650 lines after an 8-agent hive audit concluded
that 54 of 64 bridge exports had zero external callers and the remaining 10 were
single-caller wrappers around redundant fallback paths. The deletion extracted
`getRegistry()` + 8 helpers (~226 lines) into `memory-router.ts` as
`initControllerRegistry()`. Net production LoC eliminated: ~3,588.

**The structural argument was sound on its own terms.** ADR-0086 + ADR-0084 Phase 4
+ ADR-0112 had made the bridge redundant indirection; `agentdb-orchestration.ts`
was already replicating 15 of its functions with comments saying `// Replicates:
memory-bridge.ts bridgeXxx (lines N-M)`. Deleting an unreachable module that
duplicates logic in a sibling file is correct.

**But the audit was structurally complete and behaviourally incomplete.** The hive
asked "is this module worth keeping?" — counting callers and dead exports. It did
not ask "what behaviour does each function implement, what ADR-0053 deliverable
does it carry, and is that deliverable preserved in the fork?" The hive's
specialists ("registry bootstrap expert", "dead-code analyst", "merge-conflict
analyst") were optimised for the structural question; ADR-0053 was not on their
reading list. As a result the deletion shed ADR-0053's mission deliverables along
with the obsolete plumbing.

A 2026-05-13 audit walked the 34 functions in upstream's current `memory-bridge.ts`
(commit `ef73a1616`, post-ADR-0115) against the fork's post-deletion state and
found:

| Status | Count | Notes |
|---|---|---|
| Fully preserved as router method or `agentdb_*` MCP tool | 28 | List CRUD, HNSW ops, controller access helpers, pattern/feedback/session/causal/hierarchical/batch routes |
| Partially preserved — function migrated but specific behaviors dropped inside | 3 | `bridgeStoreEntry`, `bridgeSearchEntries`, `bridgeRecordFeedback` |
| Audited (no behavioral diff against migrated `agentdb_*` tools) | — | Per-tool drift is uncharacterized; same audit-gap shape as above, scope unverified |

The 3 partially-preserved functions account for **6 distinct dropped behaviors**:

1. **MutationGuard pre-write policy gate.** Upstream's `bridgeStoreEntry` calls
   `guardValidate(registry, 'store', { key, namespace, size })` before any write. The
   gate can reject writes that fail policy (namespace size limits, key allow-lists,
   rate limits). Fork's `routeMemoryOp 'store'` (`memory-router.ts:1000-1092`) has
   no gate.

2. **TieredCache write-through.** Upstream calls `cacheSet(registry, cacheKey,
   entry)` after every successful write, populating a read-side cache keyed by
   `entry:{namespace}:{key}`. Fork's store path skips the cache; reads always hit
   storage. The controller is registered in `controller-registry.ts` but no caller
   invokes its `set` method on the memory axis.

3. **AttestationLog audit write.** Upstream calls `logAttestation(registry, 'store',
   id, { key, namespace, hasEmbedding })` after every successful write, producing
   a structured audit trail. Fork's `agentdb_health` tool description (`agentdb-tools.ts:6,167`)
   still claims an attestation count is available, but `AttestationLog.log()` has
   zero call sites — the count is structurally always zero.

4. **Hybrid BM25 + semantic search fusion (default).** Upstream's `bridgeSearchEntries`
   (`memory-bridge.ts:626-750`) runs BM25 keyword scoring **and** cosine similarity
   on every search, then fuses via `0.7 × semantic + 0.3 × BM25`. Fork's `routeMemoryOp
   'search'` does vector search **or** BM25 as alternatives — BM25 only fires when the
   embedder is in `hash-fallback` mode (`memory-router.ts:1130-1185`). Real-embedder
   searches lose the BM25 lexical signal entirely.

5. **ExplainableRecall provenance strings.** Upstream's search results carry a
   `provenance` field per result (e.g., `semantic:0.872+bm25:0.310`) showing the
   per-component scoring breakdown. The `explainableRecall` controller is registered
   in the fork's registry but no router method populates the field. Result objects
   from `routeMemoryOp 'search'` have no provenance.

6. **SkillLibrary auto-promotion on feedback.** Upstream's `bridgeRecordFeedback`
   (`memory-bridge.ts:1500-1509`) calls `skills.promote(pattern, quality)` for every
   pattern when `options.success && options.quality >= 0.9 && options.patterns?.length`.
   Fork's `routeFeedbackOp 'record'` (`memory-router.ts:1743-1810`) writes to
   `learningSystem` and `reasoningBank` but never calls `skills.promote()`.

None of these losses produced test regressions because none had dedicated assertions
in the fork's test suite. The deletion's "no caller" filter caught structural
redundancy correctly but blinded the audit to behaviors that lived inside retained
functions.

This is precisely the failure mode `feedback-no-value-judgements-on-features.md`
warns against:

> Default to WIRE for any "wire vs don't wire" decision. NEVER gate on "trust model
> doesn't justify it" / "scale doesn't demand it" / "redundant" / "edge case."
> Annotate trade-offs in code comments; ship the full surface; let user judge usage.

Six features got de-facto unwired without an explicit "drop" decision being recorded.

## Decision Drivers

* **ADR-0053 inheritance debt** — the six dropped behaviours are not edge-case
  instrumentation but **named mission deliverables of an accepted ADR**.
  ADR-0053 §Phase 2 explicitly listed BM25 hybrid search + recordFeedback /
  SkillLibrary promotion; §Phase 4 listed TieredCache + ExplainableRecall +
  SkillLibrary; §Phase 5 listed MutationGuard + AttestationLog. Until ADR-0053
  is explicitly superseded (it is not) or its deliverables explicitly
  re-decided (they were not — they were lost by structural collateral), the
  fork is in arrears against its own previously-accepted decision.
* **Audit completeness debt** — ADR-0085's structural verdict was correct; its
  behavioural verdict was assumed-not-verified. The audit methodology that
  produced the gap is still in place; until we replace it with a body-diff
  approach, the same failure mode is available to recur.
* **`feedback-no-value-judgements-on-features.md`** — six features dropped
  silently; principle says default-WIRE unless an explicit architectural reason
  (e.g. ADR-0112 cross-store) justifies the drop. None of the six has such a
  reason.
* **ADR-0112 axis separation** — the bridge attempted to orchestrate cross-store
  semantics (write to SQLite + cache + attest as a single operation). The fork's
  axis separation forbids cross-store coordination. Some lost behaviors may be
  legitimately dropped under ADR-0112; others belong on a single axis and were
  unrelated to cross-store coupling.
* **Memory-axis is fast/lean by design (ADR-0170 Phase C.3)** — pre/post hooks added
  to `routeMemoryOp 'store'` must not regress the storage-only init split that
  C.3 achieved. Each restored controller must be feature-checked + async-deferred so
  it pays zero cost when absent.
* **No silent fallbacks (`feedback-no-fallbacks.md`, ADR-0082)** — restored hooks
  that fail must surface, not swallow. Upstream's `try { logAttestation(); } catch
  { /* skip */ }` pattern is **not** the contract we adopt.

## Considered Options

* **Option A — Restore the 6 named behaviors as explicit call sites in router methods.**
  Add MutationGuard pre-hook, TieredCache write-through, AttestationLog audit to
  `routeMemoryOp 'store'`. Add hybrid BM25-semantic fusion + ExplainableRecall
  provenance to `routeMemoryOp 'search'`. Add SkillLibrary promotion to
  `routeFeedbackOp 'record'`. Skip a full body-diff of the other 28 functions until
  evidence of additional drift emerges.

* **Option B — Full 34-function behavioral diff, then per-behavior wire/drop decision.**
  Body-diff every export against its fork equivalent (router method or `agentdb_*`
  MCP tool). For each behavior identified, apply `feedback-no-value-judgements-on-features`:
  default WIRE unless an explicit architectural reason justifies the drop. Produce a
  34-row table as ADR appendix.

* **Option C — Accept the loss; document in code comments only.**
  Mark the 6 behaviors as accepted-drops in code comments at the relevant router-method
  sites. Do not restore anything. Rationale: zero callers were depending on these in
  the fork's test suite, so the loss was costless. Add comment markers so future
  upstream-sync agents don't re-introduce the dropped behaviors.

* **Option D — Selective restore (security/audit only).**
  Restore MutationGuard + AttestationLog (the two with security/governance semantics)
  but accept the loss of TieredCache + hybrid-search + provenance + skill-promotion
  (performance/UX features that have working substitutes — QueryOptimizer cache,
  vector search, idempotency, manual skill registration).

## Decision Outcome

Chosen option: **"Option B"**, because the audit-gap is the actual problem and the
restoration of the 6 named behaviors is downstream of fixing the audit. Without the
behavioral diff, we cannot confidently say "these 6 are the only losses" — the same
methodology gap that missed them is still in place for the 28 functions we labelled
"fully preserved" without inspecting their bodies. The body-diff produces a durable
artifact (the 34-row table) that future ADRs can reference, and per-behavior
wire/drop decisions create the explicit record that `feedback-no-value-judgements-on-features.md`
requires.

Option A skips the audit and assumes the 28 "preserved" functions really are
preserved — repeating ADR-0085's structural-only methodology. Option C contradicts
the WIRE-by-default principle (the user has not judged usage; the deletion judged
for them). Option D is internally inconsistent: TieredCache and SkillLibrary
auto-promotion are not less load-bearing than AttestationLog, just less obviously
security-themed.

### Supersession scope

This ADR does **not** supersede ADR-0085. ADR-0085's structural decision (delete
`memory-bridge.ts`, extract `getRegistry()` into the router, eliminate the redundant
hop) stands. This ADR remediates an audit-completeness gap inside ADR-0085's
methodology — the structural verdict was right; the behavioral verdict was
incomplete. ADR-0085's `## Consequences` section is amended in spirit (not
re-written) to acknowledge that the 6 behaviors above were dropped without explicit
decision.

### Consequences

* Good, because the 6 named dropped behaviors get an explicit wire/drop decision
  rather than continuing as silent gaps. Restores `feedback-no-value-judgements-on-features.md`
  compliance for the bridge-deletion blast radius.
* Good, because the 34-row behavioral-diff table becomes a durable artifact for
  future upstream-sync agents — they can check whether a new upstream commit to
  bridge-replacement code introduces new behaviors we need to consider, rather than
  re-running ad-hoc audits.
* Good, because re-wiring the policy/audit/cache hooks closes regressions vs upstream
  for any consumer that *was* relying on those behaviours but didn't have a test
  asserting them. Future upstream donate-back is unnecessary (we don't donate per
  `feedback-no-upstream-donate-backs.md`), so the regression-debt is fork-local.
* Good, because ADR-0053's "dual memory system" problem statement is once again
  honoured — the 28 AgentDB controllers ADR-0053 originally wired are once again
  reachable through fork-local code paths instead of being instantiated-but-unused.
  ADR-0053's six-phase mission completes via this ADR rather than lapsing
  silently.
* Good, because making restoration call-site-explicit (rather than bridge-shaped)
  preserves ADR-0084 Phase 4's controller-direct design and ADR-0170 Phase C.3's
  storage-only-init split. Hooks are feature-checked + deferred per controller —
  zero cost when the controller is absent.
* Bad, because the body-diff for 34 functions is real work. Estimate: 1–2 days for
  a 4-agent hive (one per cluster: memory CRUD, embedding/HNSW, controller-touching,
  hierarchical/causal/batch). Restoration of the 6 confirmed behaviors plus any
  additional drift discovered adds another 1–3 days of careful call-site work +
  test coverage.
* Bad, because some restored behaviors (TieredCache write-through, hybrid-search
  fusion) interact with QueryOptimizer (ADR-0043 B6) and BM25 lexical fallback —
  re-wiring requires deciding the interaction rules. E.g., does the post-store
  TieredCache write supersede QueryOptimizer's search cache, or do they coexist?
* Bad, because restoring hybrid BM25-semantic as the default changes the shape of
  search-result scores — existing callers tuned to pure-vector cosine thresholds
  (0.3 default in `memory_search`) may see different result sets. Migration plan
  needs a feature flag or new threshold guidance.
* Neutral, because ADR-0085's structural decision is unaffected — we are not
  re-introducing a `memory-bridge.ts` module, just re-introducing the call sites
  for instrumentation features inside the existing router methods.
* Neutral, because the audit is bounded: the 34 functions are upstream's surface
  area as of commit `ef73a1616` (post-ADR-0115 rename). Future upstream additions
  are out of scope and would trigger a separate audit cycle.

### Confirmation

Three confirmation surfaces:

1. **The 34-row behavioral-diff table** lives as ADR-0179 appendix (this file's
   `## More Information` section after Phase 1 completes). Each row: bridge function
   name, upstream body summary, fork equivalent location, behaviors-preserved list,
   behaviors-lost list, per-behavior decision (`WIRE` / `DROP-ADR-NNNN` /
   `DROP-explicit-reason`).
2. **Acceptance tests** — one per restored behavior. Specifically:
   - `adr0179-mutationguard-blocks-oversized-write` — asserts MutationGuard rejects
     a write with `size > policy_limit` and the rejection surfaces in
     `routeMemoryOp 'store'` return.
   - `adr0179-tieredcache-roundtrip` — asserts a fresh `memory_store` write is
     readable via TieredCache before storage is touched on the subsequent
     `memory_retrieve`.
   - `adr0179-attestationlog-records-store` — asserts `AttestationLog` has one row
     per successful `memory_store` call.
   - `adr0179-hybrid-bm25-semantic-fusion` — asserts that two queries semantically
     close but lexically distant produce different rank orders than pure-cosine.
   - `adr0179-explainable-recall-provenance` — asserts every search result has
     non-empty `provenance` field of shape `semantic:N.NNN+bm25:N.NNN`.
   - `adr0179-skill-auto-promotion` — asserts `routeFeedbackOp 'record'` with
     `success=true, quality=0.95, patterns=['p1']` causes `skills.has('p1')` to
     return true.
3. **Lint rule** (ADR-0085 §Confirmation–style): grep gate that detects future
   regressions — `grep "// ADR-0179: must call <controller>" memory-router.ts`
   marks the load-bearing call sites; PR-level review flags any deletion.
4. **Controller-coverage acceptance check** — `adr0179-controller-coverage`: for
   each controller registered in `controller-registry.ts`'s 47-slot enum,
   assert one of three states:
   (a) at least one `getController('<name>')` call site exists in
   `forks/ruflo/v3/@claude-flow/cli/src`, OR
   (b) the controller is on an explicit allow-list of internal-composition
   primitives (the 8 attention/backend sub-modules), OR
   (c) the controller has an explicit `// DEAD-EXPORT-PER-ADR-NNNN: <reason>`
   comment at its factory-method site.
   Anything else fails the check. This converts ADR-0053's manual-vigilance
   requirement into a structural enforcement that survives future audits, so a
   future "the bridge equivalent has accumulated 17 dead exports" finding
   cannot happen silently again.

## More Information

### Related ADRs

* **[[ADR-0053]]** — agentdb-v3-controller-activation (2026-02-25, **Implemented**).
  The *upstream* ADR that created `memory-bridge.ts` as Phase 1 Core Foundation
  and explicitly listed the six lost behaviours as Phase 2/4/5 deliverables.
  Authored by RuvNet & Claude Flow Team; status **Implemented**, published in
  `v3.1.0-alpha.51`. This ADR (ADR-0179) is the fork-side discharge of ADR-0053's
  obligations that ADR-0085 inadvertently lapsed. Per
  `feedback-upstream-means-upstream.md`, this is a genuine upstream-origin ADR,
  not a fork artefact — it lives at `ruvnet/ruflo:v3/implementation/adrs/ADR-053-agentdb-v3-controller-activation.md`.
* **[[ADR-0085]]** — bridge-deletion-ideal-state-gaps (2026-04-13). Triggering ADR.
  The 8-agent hive structural verdict was correct; this ADR remediates the
  behavioural-completeness gap inside its methodology and discharges the
  ADR-0053 inheritance debt the deletion accidentally created.
* **[[ADR-0084]]** — dead-code-cleanup (2026-04-12). Phase 4 controller-direct migration
  that made bridge deletion possible; the restored call sites must use `getController()`
  per Phase 4 conventions, not re-introduce bridge-shaped indirection.
* **[[ADR-0086]]** — layer1-storage-abstraction (2026-04-14). Deleted `memory-initializer.ts`
  on top of ADR-0085's bridge deletion; same structural-not-behavioral audit
  methodology applies — this ADR's Phase 1 body-diff covers initializer too.
* **[[ADR-0112]]** — independent-stores-not-cross-store (2026-05-01). Architectural
  reason some bridge behaviors *should* stay dropped — any restored hook that would
  coordinate writes across both RVF and AgentDB SQLite is rejected under ADR-0112.
* **[[ADR-0102]]** — unified-embedding-index-config. Establishes the single config
  chain (`embeddings.json` + `@claude-flow/config-chain`) that replaces the bridge's
  hardcoded embedder choice. Restored search behaviors must honor this chain.
* **[[ADR-0177]]** — config-chain-refactor (Phase 1.6). Extraction of
  `getEmbeddingConfig()` to a shared accessor across memory and agentdb axes.
  Restored hybrid-search fusion must read its weights and thresholds via this
  accessor, not hardcoded `0.7 / 0.3`.
* **[[ADR-0178]]** — restore-hierarchical-memory-implement-query (2026-05-13). Same
  remediation shape: a deletion was structurally right, behavioral completeness was
  assumed but not verified, restoration is a call-site addition against a stable
  architecture. ADR-0179 follows the same playbook.

### Council transcripts

Two dialectical council rounds (8 experts each, hierarchical-mesh topology, SendMessage dialectic) deliberated this ADR's decision space. Both are recorded verbatim with per-expert position papers:

* **[[ADR-0179-council-r1-bridge-deletion]]** — 2026-05-13. Question: was ADR-0085's deletion correct, should we live with the regression (A), restore via call sites (B), or restore the bridge module (C)? **Verdict: 6 B / 1 C / 1 A-with-B-acceptable.** Mandatory amendments to ADR-0179 surfaced: axis re-placement, performance guardrails, fail-loud semantics, body-diff methodology, ADR-0053 re-audit. Drives the current ADR's scope.

* **[[ADR-0179-council-r2-axis-architecture]]** — 2026-05-13. Question: should the fork keep its dual-axis storage (X, status quo ADR-0086/0112), collapse to single-axis upstream-style (Y), or adopt single-MCP-surface-with-dual-substrate-internal (Z)? **Verdict: 6 of 8 endorse Z.** Universal consensus that the "150-12,500× speedup" claim is dishonest (real gap 2-3×); that ADR-0086 was a unification attempt that failed at Debt 15; that ADR-0112 reframed that failure as deliberate architecture.

* **[[ADR-0179-council-r3-bridge-coordination]]** — 2026-05-13. Three questions: (1) body-diff of upstream's bridge to identify load-bearing coordination, (2) migration-window consistency model during ADR-0177 transition, (3) whether the 6 round-1 features should live at bridge-shape chokepoint or per-handler middleware. **Major correction surfaced mid-session**: both upstream AND fork have TWO MCP surfaces (`memory_*` + 18 `agentdb_*` tools) — earlier "fork added agentdb_*" framing was wrong. Option Z is therefore substrate-collapse + ADR-0112 revert, NOT surface collapse. **Three bombshells**: (a) upstream's bridge guards only 5 of 13 mutation paths — restoring "as upstream has it" reproduces a half-finished chokepoint; (b) ADR-0177's "RVF-only" target is operationally impossible because neural controllers have FK-structured relational schemas — realistic target is RVF + SQLite hybrid with per-controller System-of-Record assignment; (c) `bridgeRecordFeedback` has 3-4× silent storage amplification via uncoordinated fanout. **Mid-round framing reframe** (user-applied): treat prior ADRs as exploration inputs producing forward-design lessons, not constraints to honor. Reframed positions produced sharper convergence than the raw vote suggested.

**Post-reframe convergence** (7-of-7 voting members agree on): (1) one thin coordinator (~500-1000 LoC) at the MCP-tool-dispatch boundary; (2) cross-cutting middleware applied uniformly there; (3) type-level enforcement via branded types + required `MutationContext` argument — closes upstream's half-finished-chokepoint gap (5 of 13 → 13 of 13 guarded); (4) substrate hybrid forever (RVF-primary + PERMANENT_SQLITE carve-outs, per-controller SoR); (5) both MCP surfaces preserved; (6) controllers own internal multi-table transactions; (7) ADR-0112 retired (drop no-cross-surface-coordination rule); (8) lazy-per-tool init; (9) single audit chain above substrate split; (10) +36% wrapper fix as single insertion point at the coordinator.

**The residual disagreement is naming, not architecture**: "bridge" camp (3 experts — bridge-defender, memory-judge, integration-judge) wants line-level structural homology with upstream's `memory-bridge.ts` for merge alignment. "Middleware" camp (3 experts — status-quo-defender, security-judge, perf-judge) wants type-level enforcement explicit in file structure (`src/memory/middleware/` + branded `GuardedWrite<T>`). **A "thin bridge module that applies typed middleware via HOF" and "a middleware module that registers handlers via a typed factory" are the same architectural object.** The engineering decision is settled.

**Implications for ADR-0179**: the 6 features land at the single thin coordinator via type-enforced HOF middleware (closing upstream's half-finished gap at all 13+ mutation paths). The "shared write-middleware module" from round-1's verdict is refined into "thin-coordinator-with-HOF-middleware + controller-MutationContext-backstop." Per memory-judge: this isn't axis-shaped (round-2's axis framing collapses) — the coordinator is a dispatcher with middleware, applied uniformly across both MCP surfaces. ADR-0179 phase-0 work sequences ahead of any ADR-0180 substrate collapse so the restored features land coherently.

### Related memories

* `feedback-no-value-judgements-on-features.md` — default-WIRE principle. The six
  dropped behaviors should each have triggered an explicit WIRE-vs-DROP decision at
  ADR-0085 deletion time; this ADR makes those decisions retroactively.
* `feedback-no-fallbacks.md` — restored hooks must surface failures loudly, not
  silently `try { ... } catch {}`. Upstream's bridge swallowed AttestationLog errors;
  the restored call site does not.
* `feedback-data-loss-zero-tolerance.md` — MutationGuard's rejection semantics need
  zero-tolerance handling: a rejected write must NOT silently fall through to a
  stored-without-policy state.
* `project-fork-only-controllers.md` — catalog of restored controllers post-ADR-0178.
  Some of the controllers this ADR restores call sites for (e.g., `attestationLog`,
  `tieredCache`) overlap with that catalog — coordinate with that memory's
  upstream-sync guidance.

### Behavioral-diff table (Phase 1 deliverable, to be filled)

Phase 1 of this ADR produces the 34-row table. Until Phase 1 completes, the six
named behaviors above are the **known minimum** scope; the table will either
confirm "no additional drift in the other 28 functions" or extend the restoration
scope.

| # | Bridge function | Upstream behavior summary | Fork equivalent | Preserved | Lost | Decision |
|---|---|---|---|---|---|---|
| 1 | `bridgeStoreEntry` | RVF write + MutationGuard + TieredCache + AttestationLog | `routeMemoryOp 'store'` | RVF write (via RVF backend) | Guard, cache, attest | **WIRE** all 3 |
| 2 | `bridgeSearchEntries` | Hybrid BM25+semantic + ExplainableRecall provenance | `routeMemoryOp 'search'` | Vector search; BM25 as hash-fallback alternative | Hybrid fusion as default; per-result provenance | **WIRE** both |
| 3-33 | … | (Phase 1 hive output) | … | … | … | … |
| 34 | `bridgeGetAllEmbeddings` | (Phase 1 hive output) | `routerGetAllEmbeddings` | … | … | … |

### Implementation phases

1. **Phase 1 — Behavioral diff (4-agent hive).** Produce the 34-row table. Cluster
   agents by function family: memory CRUD (1-5), embedding/HNSW (6-10), controller
   helpers (11-16), pattern/feedback (17-19), causal/hierarchical/session (20-30),
   batch/synthesize/embeddings (31-34). Deliverable: the table above, filled.
2. **Phase 2 — Per-behavior wire/drop decisions.** For each lost behavior, decide
   WIRE (default) or DROP (with explicit architectural reason — typically ADR-0112
   cross-store concern or ADR-0170 init-cost concern). Decisions recorded in the
   table.
3. **Phase 3 — Restoration call sites.** Implement WIRE decisions as call sites in
   the appropriate router method or MCP tool handler. All restorations:
   - Use `getController()` per ADR-0084 Phase 4 (no bridge-shaped indirection)
   - Are feature-checked (no error when controller is absent)
   - Surface failures loudly per `feedback-no-fallbacks.md` (no silent try/catch)
   - Honor ADR-0170 Phase C.3 (controller-touching hooks call `ensureRegistry()`,
     storage-only paths do not)

   **Amendment 2026-05-14 (per ADR-0180 Follow-up #2 disposition):** Per ADR-0180,
   restoration call sites land at archivist handler registrations
   (`registerMutationHandler<T>` / `registerReadHandler<T, R>`) rather than directly
   in router methods. The six restored behaviours and their tests in this ADR are
   unchanged; only the placement of the calls shifts from router method bodies to
   handler bodies invoked via archivist dispatch. Phase ordering: this ADR's Phase 1
   + Phase 2 run before ADR-0180 Migration Phase 2 (archivist scaffolding); this
   ADR's Phase 3 folds into ADR-0180 Migration Phase 3 (memory_* surface).
4. **Phase 4 — Acceptance tests.** Six confirmed-behavior tests above, plus one per
   additional WIRE decision from the table.
5. **Phase 5 — Lint gate.** Grep-based check (acceptance-test shape) that the
   load-bearing call sites still exist in the router. Prevents future deletions
   from re-creating the gap.

## Execution Plan

### Topology

Hierarchical-mesh per `CLAUDE.md` project config: 1 queen architect at the apex,
1 devil's advocate in dialectic with the queen, 13 specialist experts distributed
across five functional clusters. Maximum 15 agents — the project cap.

Per `feedback-council-queen-da-alongside-experts.md`, queen + devil's advocate
spawn **alongside** experts in a single wave, not sequentially after. Per
`feedback-agent-dialectic-via-sendmessage.md`, all inter-agent comms use
`SendMessage` to the bound team — no file-based handoff (`/tmp/<hive-id>/` dirs,
shared JSON state files, etc. are forbidden).

The swarm is invoked via the `claude-flow-swarm` skill, which initialises the
ruflo MCP coordination layer per `reference-ruflo-mcp-swarms.md` (ruflo
orchestrates; Claude Code Agent tool executes).

### Initialisation sequence

```bash
# 1. Bootstrap topology + team binding via ruflo MCP
mcp__claude-flow__swarm_init        topology=hierarchical-mesh maxAgents=15
mcp__claude-flow__hive-mind_init    team_name=adr-0179-restore queen=system-architect

# 2. Single-message wave of 15 Agent-tool spawns (per CLAUDE.md "ALL agents in ONE message")
#    Every spawn carries: team_name=adr-0179-restore + unique name + run_in_background=true
```

### Agent roster (15 total)

**Leadership pair — spawned alongside experts, active across all 5 phases:**

| # | Role | `subagent_type` | Mandate |
|---|------|-----------------|---------|
| 1 | Queen architect | `system-architect` | Owns 34-row diff table integrity. Arbitrates WIRE/DROP deadlocks. Enforces ADR-0084 Phase 4 (controller-direct, no bridge-shape) and ADR-0170 Phase C.3 (no init-cost regression on memory_* axis). Merges per-expert outputs into the ADR appendix. |
| 2 | Devil's advocate | `reviewer` | Challenges every WIRE decision ("is this behaviour actually used? does upstream-DROP have an architectural reason we missed? is the restoration call site bridge-flavoured?"). Forces explicit defence per `feedback-no-value-judgements-on-features.md` — the burden is on whoever proposes DROP. |

**Phase 1 — Behavioural diff cluster (5 experts, parallel work):**

| # | Role | `subagent_type` | Cluster scope (upstream `memory-bridge.ts` exports) |
|---|------|-----------------|-----------------------------------------------------|
| 3 | Memory-CRUD body-diff expert | `code-analyzer` | `bridgeStoreEntry`, `bridgeSearchEntries`, `bridgeListEntries`, `bridgeGetEntry`, `bridgeDeleteEntry` (5 funcs) |
| 4 | Embedding/HNSW body-diff expert | `code-analyzer` | `bridgeGenerateEmbedding`, `bridgeLoadEmbeddingModel`, `bridgeGetHNSWStatus`, `bridgeSearchHNSW`, `bridgeAddToHNSW`, `bridgeGetAllEmbeddings` (6 funcs) |
| 5 | Controller-helper body-diff expert | `code-analyzer` | `bridgeGetController`, `bridgeHasController`, `bridgeListControllers`, `isBridgeAvailable`, `getControllerRegistry`, `shutdownBridge` (6 funcs) |
| 6 | Pattern/feedback/session body-diff expert | `code-analyzer` | `bridgeStorePattern`, `bridgeSearchPatterns`, `bridgeRecordFeedback`, `bridgeSessionStart`, `bridgeSessionEnd`, `bridgeRouteTask` (6 funcs) |
| 7 | Causal/hierarchical/batch body-diff expert | `code-analyzer` | `bridgeRecordCausalEdge`, `bridgeDeleteCausalEdge`, `bridgeDeleteCausalNode`, `bridgeDeleteHierarchical`, `bridgeHealthCheck`, `bridgeHierarchicalStore`, `bridgeHierarchicalRecall`, `bridgeConsolidate`, `bridgeBatchOperation`, `bridgeContextSynthesize`, `bridgeSemanticRoute` (11 funcs) |

Each expert produces their cluster's rows of the 34-row table and posts them via
SendMessage to `name=queen-architect`. Queen merges into the canonical appendix
inside this ADR.

**Phase 2 — Wire/drop deliberators (3 specialists, active after Phase 1 settles):**

| # | Role | `subagent_type` | Mandate |
|---|------|-----------------|---------|
| 8 | Cross-store axis specialist | `adr-architect` | For each lost behaviour, check whether restoration would coordinate writes across both RVF and AgentDB SQLite. Yes → `DROP-per-ADR-0112` with citation. No → defer to default-WIRE. |
| 9 | Default-WIRE advocate | `researcher` | Applies `feedback-no-value-judgements-on-features.md`: every behaviour is WIRE unless an explicit architectural reason (cited ADR) justifies DROP. Pushes back on every "scale doesn't demand it" / "trust model doesn't justify it" framing. |
| 10 | Performance/init-cost specialist | `performance-engineer` | For each WIRE decision, audit ADR-0170 Phase C.3 regression risk. Controllers requiring registry init must call `ensureRegistry()` only when the route is hit. Produces per-WIRE init-cost budget annotation against the +30% / +21% baseline that triggered Phase C.3. |

**Phase 3 — Restoration implementers (3 coders, active after Phase 2 decisions
land):**

| # | Role | `subagent_type` | Behaviours restored |
|---|------|-----------------|---------------------|
| 11 | Security/audit hooks implementer | `security-architect` | MutationGuard pre-store hook in `routeMemoryOp 'store'`; AttestationLog post-store hook. Per `feedback-no-fallbacks.md` + `feedback-data-loss-zero-tolerance.md` — no silent try/catch; rejected writes surface loudly. |
| 12 | Performance hooks implementer | `performance-engineer` | TieredCache write-through in `routeMemoryOp 'store'`; hybrid BM25 + semantic fusion as **default** in `routeMemoryOp 'search'`; ExplainableRecall provenance strings on every result. Fusion weights resolved via `@claude-flow/config-chain.getEmbeddingConfig()` per ADR-0177 — never hardcoded. |
| 13 | Learning hooks implementer | `coder` | SkillLibrary auto-promotion in `routeFeedbackOp 'record'` for `success && quality ≥ 0.9 && patterns.length > 0`. Plus any additional Phase-2 WIRE decisions in the feedback/learning domain. |

**Phase 4 — Test author (1 specialist):**

| # | Role | `subagent_type` | Deliverable |
|---|------|-----------------|-------------|
| 14 | TDD acceptance specialist | `tester` | The six named acceptance tests in `### Confirmation` above, plus one test per additional Phase-2 WIRE decision. Verification cycle is `npm run test:unit` + `npm run release` per CLAUDE.md "TWO COMMANDS" rule — no piecemeal acceptance scripts (per memory `feedback-all-test-levels.md`). |

**Phase 5 — Verification + lint gate (1 specialist):**

| # | Role | `subagent_type` | Deliverable |
|---|------|-----------------|-------------|
| 15 | Production validator | `production-validator` | Grep-based lint gate (load-bearing call sites must remain present); end-to-end `npm run release` run; sign-off that every row in the 34-row table has a non-`?` Decision column and every WIRE decision has a passing acceptance test. Flips ADR-0179 `status: proposed` → `status: accepted` once green. |

### Dialectic mechanics

Per `feedback-hive-discussion-mechanics.md`:

- Every expert turn engages **by name** with a specific claim from a prior turn
  (e.g., "Memory-CRUD expert → Embedding expert: I disagree with your WIRE verdict
  on `bridgeGenerateEmbedding` because the fork's `embedding-adapter` already
  covers the upstream behaviour at `embedding-adapter.ts:50-55` — what specifically
  is missing?").
- Refinements emerge from conversation, not from parallel independent verdicts.
- Devil's advocate is active throughout: Phase 1 ("is this body-diff
  comprehensive?"), Phase 2 ("is this DROP reason load-bearing?"), Phase 3 ("is
  this call site bridge-shaped?"), Phase 4 ("does this test actually fail before
  the fix?"), Phase 5 ("is the lint gate detectable from CI?").
- Queen synthesizes the dialectic into the ADR appendix in-place via `Edit`.

### Hand-off surface

| Phase | Output namespace (`memory_store`) | Key shape | Consumer |
|-------|-----------------------------------|-----------|----------|
| 1 | `adr-0179-diff` | `bridge-<func-name>` | Phase 2 deliberators (semantic-searchable inputs) |
| 2 | `adr-0179-decisions` | `<behaviour-name>` → `WIRE` \| `DROP-<adr-citation>` | Phase 3 implementers (precise WIRE list) |
| 3 | git commits to `forks/ruflo` main on `sparkling` per memory `reference-fork-workflow.md`; no `Co-Authored-By` trailer (fork rule per `feedback-fork-commit-attribution.md`) | — | Phase 4 tester |
| 4 | tests/ acceptance scripts checked into `ruflo-patch` (this repo, not fork) | `adr0179-<behaviour>.test.mjs` | Phase 5 validator |
| 5 | This ADR file: `status:` flip + 34-row table populated; ADR-0179 acceptance entry added to ADR-0094 living tracker | — | User |

### Abort criteria

The swarm self-aborts and escalates to user if any of the following:

- **Phase 1 scope explosion**: more than 5 of the 28 functions I labelled "fully
  preserved" reveal additional lost behaviours. Indicates the conversational audit
  materially understated scope — user decides whether to expand the ADR or pause.
- **Phase 2 deadlock**: deliberators cannot reach consensus on a WIRE/DROP after
  3 dialectic rounds. Indicates an architectural ambiguity needing user input,
  not more agent rounds.
- **Phase 3 init-cost regression**: restoration introduces > 5% wall-time
  regression on `npm run test:unit`. Indicates an ADR-0170 Phase C.3 violation;
  must redesign the hook before continuing.
- **Phase 4 test author cannot reproduce**: any of the six named behaviours
  cannot be exercised via a deterministic test. Indicates either the behaviour
  is harder to trigger than the body-diff suggested, or the restoration call
  site is wrong — back to Phase 3.

### Out of scope (deliberate)

- **Donate-back to upstream `ruvnet/ruflo`**: forbidden per
  `feedback-no-upstream-donate-backs.md`. The restored call sites stay fork-only.
- **Re-introducing `memory-bridge.ts` as a module**: forbidden — ADR-0085's
  structural decision stands. Restoration is **call-site additions inside
  existing router methods**, not a module restoration.
- **Behavioural audit of `agentdb-orchestration.ts` shadow functions**: ADR-0084
  flagged these as ADR-0085's deferred Phase 3. Tangentially relevant but a
  separate cleanup; if drift is found there during Phase 1, file as a follow-up
  issue, do not absorb into ADR-0179.

## Amendments

### Amendment: Status reconciliation (2026-05-18) — partial implementation; audit-methodology contribution survives

Status kept `proposed` per ADR-0180 §"ADR-0179 supersession scope" lines
345-353 ("Status stays `proposed`. No `superseded-by` field — the
audit-methodology contribution survives ADR-0180").

**Subsumed (no longer load-bearing as separate work):**

- The *placement* question for the six bridge-deletion behaviors
  (MutationGuard, AttestationLog, TieredCache, BM25+semantic fusion,
  ExplainableRecall, SkillLibrary auto-promotion) is answered by
  ADR-0180 §Architecture: those features land at the archivist's
  MCP-dispatch boundary, not scattered across router call sites.
  ADR-0179 Phase 3's `routeMemoryOp 'store'` recipe is architecturally
  obsolete.
- Fork code refs confirm the absorption: `agentdb-tools.ts:276,1461`
  cite "for ExplainableRecall (ADR-0180 §Provenance rollout scope —
  MANDATORY for this fusion site per ADR-0179)"; `archivist/MODULE.md`
  references ADR-0179 follow-ups (TieredCache, six lost features).

**Surviving contributions (still open):**

- The *audit-gap methodology* — the 34-row body-diff table (Phase 1
  deliverable) preventing recurrence of ADR-0085's structural-only
  audit — is **not yet populated**. The §"Behavioral-diff table (Phase 1
  deliverable, to be filled)" section remains a stub.
- The ADR-0053 inheritance-debt analysis (four controllers regressed
  against Phase 2/4/5 deliverables) — not separately catalogued as a
  durable artifact.
- The controller-coverage acceptance check that would convert ADR-0053's
  manual vigilance into structural enforcement — not delivered.

Frontmatter could append `ADR-0180` to `depends-on` per ADR-0180's
guidance, but per the same guidance no status change is required; the
methodology work is genuinely open. Reconciled as part of the 2026-05-18
status audit.

## Amendment: Swarm-review reconciliation (2026-05-28)

A 2026-05-28 swarm review mapped each of the 6 behaviors against the
now-live archivist (ADR-0180/0181/0183), verified against HEAD. The 6
behaviors this ADR set out to "restore" resolve as:

| # | Behavior | Verified status |
|---|---|---|
| 1 | MutationGuard pre-write gate | **SUBSUMED — archivist `guard-policy`.** 5 guards (`size`/`quality`/`pii`/`schema`/`rate-limit`) at `guards.ts:39-43`; `composeGuards()` runs in `dispatchMutationInternal` (`index.ts:939`) BEFORE every handler; any veto writes `state:'rejected'` and throws (fail-closed). Strictly better than the old bridge (guarded 5 of 13 paths; archivist guards all dispatched mutations). `memory_store` flows through it (`memory-router.ts:1166`). |
| 2 | TieredCache write-through | **OPEN but re-homed.** Not implemented; explicitly ADR-0180 Follow-up #6/#24 + MODULE.md out-of-scope. The read-path boundary exists to host it; the cache module does not. Owned by ADR-0180's follow-up, not this ADR's router recipe. |
| 3 | AttestationLog audit write | **SUBSUMED — archivist `audit-chain`.** Live write-through journal (`audit-writer.ts`); intent→applied/rejected entries around every dispatch. ADR-0180 §Architecture states "AttestationLog is this audit log." The structurally-always-zero attestation count this ADR §3 flagged is closed. |
| 4 | BM25 + semantic fusion (default) | **SUBSUMED / re-homed — but mechanism changed.** Fusion is now RRF (k=60) at the archivist boundary (`handlers/agentdb/filtered-search.ts`, `pattern-search.ts`), NOT this ADR's `0.7·sem + 0.3·BM25`. The ADR-0179 *spec* is stale, not merely relocated. (Legacy `memory-router.ts:1297` still gates BM25 behind hash-fallback mode — the architectural answer moved to the archivist.) |
| 5 | ExplainableRecall provenance | **SUBSUMED — read-path return shape.** `RankedResult<T>.provenance` is first-class; populated at `handlers/memory/search.ts:181` + `handlers/agentdb/filtered-search.ts:178`, 15-tool `includeProvenance` rollout. **Stale-citation fix**: the 2026-05-18 amendment's `agentdb-tools.ts:276,1461` ExplainableRecall citation returns ZERO grep hits — provenance lives in the archivist handlers, not agentdb-tools.ts. Drop or correct that line. |
| 6 | SkillLibrary auto-promotion on feedback | **GENUINELY MISSING.** `routeFeedbackOp 'record'` (`memory-router.ts:2119`) and the archivist `handlers/agentdb/feedback.ts` both fan out to LearningSystem + ReasoningBank but neither calls `skills.promote()`. The ONE behavior the entire 0180/0181/0183 program did not close. |

**Summary: 4 subsumed, 1 deferred-but-re-homed, 1 genuinely missing.**

**Re-scope (Improvement, replaces the 15-agent restoration plan):**

1. **Re-title intent.** "Restore the lost bridge behaviors" is misleading — most weren't restored, they were reimplemented at a better seam. The live scope is two things: **(a)** wire the one genuinely-missing behavior; **(b)** the audit-completeness artifact.

2. **Replace the 34-row "to-be-filled" table with the 6-row resolution ledger above.** The full body-diff was to inform a router-call-site restoration that no longer has a target — it is not pending work. Keep the *methodology lesson* (ADR-0085's structural-only audit missed in-body behaviors) as the durable contribution.

3. **Narrow the one live code change**: wire `skills.promote(pattern, quality)` into `forks/agentdb/src/archivist/handlers/agentdb/feedback.ts` (gated `success && quality >= 0.9 && patterns.length > 0`) — the handler already fans out to LearningSystem + ReasoningBank, so it's the natural home. Retarget the `adr0179-skill-auto-promotion` acceptance test at the archivist feedback handler, not `routeFeedbackOp`. Drop the other 5 acceptance tests (guards/audit/provenance/fusion are ADR-0180's confirmation responsibility now).

4. **Controller-coverage check**: it targets the cli `ControllerRegistry` 47-slot enum — a *different* surface than ADR-0180's archivist-charter check. If the "17 of 47 unreachable" dead-export risk still holds at HEAD (re-count — it predates the archivist migration), deliver the gate; otherwise mark resolved-by-evidence per `feedback-corpus-evidence-before-feature-work`.

5. **Status disposition (user choice)**: with 5/6 subsumed and the 6th ~30 LoC, this no longer warrants `proposed`-with-a-15-agent-plan. Either (a) keep `proposed` but shrink the execution plan to one coder change + one test, or (b) `superseded-by: [ADR-0180]` for the placement question while folding the SkillLibrary remnant into ADR-0181's continuation. Both defensible; left for the maintainer. NOT flipped unilaterally because a genuine (small) remnant remains.
