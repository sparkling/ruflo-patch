---
status: proposed
date: 2026-05-20
tags: [dead-code, federation, fork-cleanup, agentdb, audit-followup]
supersedes: []
depends-on: [0201]
implements: []
---

# Delete dead `services/federated-learning.ts` module

> **Reviewed directly (2026-05-22) — the slice-05/06 contradiction is
> RESOLVED in favour of "dead."** Drafted from a single CRITICAL audit
> finding (F-06-004): a 436-line module advertised as active in `CHANGELOG.md`
> + `MIGRATION-LOG.md` but with zero callers in `src/`. A direct end-to-end
> call-graph trace (see *Decision Outcome*) confirms the cross-fork
> controller-registry reference is a **dormant, gated, never-requested** arm
> with no live consumer — so Option A (delete) proceeds. Same pattern as
> ADR-0203 (delete dead `@claude-flow/hooks` package), smaller scope.

## Context and Problem Statement

The ADR-0201 audit
(`docs/audits/2026-05-19-soundness-audit/06-controllers-graph-federation.md`
F-06-004) confirmed that
`forks/agentdb/src/services/federated-learning.ts` is dead code:

```bash
$ grep -rln "FederatedLearningManager\|FederatedLearningCoordinator\|EphemeralLearningAgent" \
    forks/agentdb/src | grep -v 'services/federated-learning.ts'
# (empty — zero callers in src/ outside the defining file)
```

The 436-line module defines three classes (`EphemeralLearningAgent`,
`FederatedLearningCoordinator`, `FederatedLearningManager`) and is
advertised as **active feature surface**:

- `forks/agentdb/CHANGELOG.md:13-55` lists `FederatedLearningCoordinator`
  ("Central aggregation with quality-weighted consolidation") and
  `FederatedLearningManager` ("Multi-agent coordination with automatic
  aggregation") as if shipping.
- `forks/agentdb/MIGRATION-LOG.md:118` records it as net-new in the
  ADR-0161 3-way merge.

But:

- No controller wires it.
- No MCP tool exposes it.
- No test exercises it.

Memory [[project-deprecated-controllers]] explicitly names this controller
as **removable**:

> federatedSession + federatedLearningManager can be removed

The audit then disambiguated: there are TWO federated paths in the tree,
and only one is reachable.

- **`services/federated-learning.ts`** (this file) — wraps `SonaEngine`
  from `@ruvector/sona`; ZERO callers. **Dead.**
- **`backends/rvf/FederatedSessionManager.ts`** — wraps `@ruvector/ruvllm`;
  ONE caller (`SelfLearningRvfBackend.ts:402`, with its own silent-catch
  problem flagged as F-06-008). **Alive, do not delete.**

The audit recommends deleting the dead one outright. The recommendation
echoes ADR-0203's delete-the-dead-package pattern but at smaller scope: one
file (436 LOC) rather than a whole package.

There is a wrinkle. The fork's `learning-controllers` audit slice (slice
05, finding F-05-017) reports `FederatedLearningManager` as "verified
ALIVE" because `forks/ruflo/v3/@claude-flow/memory/src/controller-registry.ts`
references it at lines 75, 107, 514, 1180, 2038-2041 (`new
agentdbModule.FederatedLearningManager(...)`). This contradicts F-06-004's
"zero callers" finding because the slice-04 grep was scoped to
`forks/agentdb/src` only. **The cross-fork picture is: zero agentdb-internal
callers; one external caller in ruflo's controller-registry.** The dialectic
needs to resolve this:

- **Scenario A** — the registry call instantiates the class but the
  instance is never used downstream (registry-only wire, no live consumer).
  Then F-06-004's "dead" stands; the registry side also needs cleanup.
- **Scenario B** — the registry call wires `FederatedLearningManager` into
  a live path (e.g. ADR-0195 Phase 4 event bus subscribers, autopilot
  callbacks) that the audit slice 05 confirms as ALIVE. Then F-06-004's
  "delete" verdict is **wrong** and this ADR should be retracted.

The audit slice 05's F-05-017 says: "Real impl at services/federated-learning.ts:330
(~106 lines). FederatedLearningManager.registerAgent, startAggregation,
stopAggregation, aggregateAll, getSummary, cleanup all implemented. Real
Float32Array aggregation via EphemeralLearningAgent →
FederatedLearningCoordinator.aggregate → consolidate. No QUIC dependency;
in-process across SONA ephemeral agents."

Slice 05's verdict is "ALIVE." Slice 06's verdict is "dead."

This contradiction is **the load-bearing question for this ADR** — the
dialectic MUST resolve it before deletion lands. The drafted decision below
is conditional on resolving in favour of slice 06.

## Decision Drivers

- [[feedback-no-fallbacks]] — dead code exported as if active is the
  same anti-pattern as a silent fallback (advertises capability that does
  not exist).
- ADR-0203 precedent — delete-the-dead-package shipped on the same
  pattern, with the same memory citation.
- [[project-deprecated-controllers]] memory explicitly flags this controller
  as removable.
- README severity: F-06-004 is CRITICAL in the executive summary's CRITICAL
  table (item #6 in §HIGH/HIGH-adjacent — though the per-doc audit assigns
  CRITICAL).
- **CRUX:** the slice-05 vs slice-06 contradiction must be resolved by the
  dialectic before the deletion lands. Per [[feedback-remediation-adr-preflight]]
  #3 (premise true at runtime), the runtime/archaeologist agents must
  verify whether `controller-registry.ts:75/107/514/1180/2038-2041`
  references actually run a live `FederatedLearningManager` path.

## Considered Options

- **Option A — Delete the file outright + clean up the cross-fork
  registry references + CHANGELOG/MIGRATION-LOG cleanup (chosen,
  conditional on cross-fork resolution).** If slice 06's "dead" verdict
  holds, delete:
  - `forks/agentdb/src/services/federated-learning.ts` (436 LOC).
  - References in `forks/agentdb/src/index.ts` (any export).
  - References in `forks/ruflo/v3/@claude-flow/memory/src/controller-registry.ts`
    at lines 75, 107, 514, 1180, 2038-2041 (the cross-fork wire that slice
    05 reads as evidence of liveness).
  - CHANGELOG / MIGRATION-LOG entries advertising the surface.
  - INTEGRATION-LEDGER row recording the deletion with
    `superseded-by-local` disposition + cite of this ADR.
- **Option B — Keep the file; remove only the false-advertising in
  CHANGELOG / MIGRATION-LOG.** Rejected: leaves 436 LOC of dead code in
  the tree with the same misleading-reader cost the audit identified.
  ADR-0203 rejected the same shape for `@claude-flow/hooks`.
- **Option C — Wire the file to a real consumer (make it alive).**
  Rejected: no driver. The audit found no use case waiting for this
  surface. Building infra to justify dead code is the wrong direction.
- **Option D — Defer pending the slice-05/slice-06 contradiction
  resolution.** This is the **dialectic's first step** — without resolving
  whether the controller-registry references are live, neither delete nor
  keep is sound. Effectively this option says "do nothing until the
  contradiction resolves" — which is what the dialectic will do.

## Decision Outcome

**Chosen: Option A — delete. The slice-05 vs slice-06 contradiction is
RESOLVED in favour of "dead" by a direct end-to-end call-graph trace
(2026-05-22).**

Slice 06's grep was the harder evidence (zero agentdb-internal callers,
explicit delete recommendation, [[project-deprecated-controllers]] memory
confirmation). Slice 05's "ALIVE" verdict read the controller-registry
reference as liveness — but the trace shows that reference is a **dormant
arm**, not a live consumer:

- The only live reference to the **class** `FederatedLearningManager` is
  `controller-registry.ts:2041` (`const FLM = agentdbModule.FederatedLearningManager`)
  inside a lazy `case 'federatedLearningManager'` that constructs on demand.
- That arm is **never reached**: the registry's enabled-check returns `false`
  for `federatedLearningManager` (`:1180-1181`, "only useful in multi-agent
  swarms"), and **nothing requests the key** — zero
  `getController/resolve('federatedLearningManager')` callers in live
  `ruflo/v3` or `agentic-flow`.
- **Zero of the manager's methods** (`registerAgent`/`startAggregation`/
  `aggregateAll`/`getSummary`/`cleanup`) are invoked in live code (the only
  hits are in `archive/v2/`, on unrelated classes).

This is **Scenario A** (registry-only wire, no live consumer): F-06-004
"dead" stands, and slice-05's F-05-017 "ALIVE" is **refuted** — it mistook a
gated, never-requested registry case arm for a live path. Option A proceeds;
the deletion also removes the registry key-plumbing (the type union at
`:75/:107`, the list at `:514`, the gated enabled-case at `:1180`, and the
lazy construct-case at `:2038-2045`).

### Consequences (if Option A holds)

- Good, because 436 LOC of dead code disappears from `forks/agentdb/src/`.
- Good, because CHANGELOG / MIGRATION-LOG stop advertising a non-existent
  surface — the
  [[feedback-no-fallbacks]] documentation-drift pattern closes.
- Good, because the cross-fork registry wiring stops carrying a dead
  reference — readers tracing controller-registry no longer get sent to a
  dead module.
- Good, because the INTEGRATION-LEDGER row records the deletion for future
  upstream-sync agents (per [[feedback-update-integration-ledger]]).
- Bad, because if the dialectic finds a hidden live caller, this ADR
  must be retracted — risk of "ship the deletion, break something" if the
  contradiction is misjudged.
- Neutral, because the alive `backends/rvf/FederatedSessionManager.ts`
  (the OTHER federated path) is unaffected — different file, different
  consumer, different fix (F-06-008's silent-catch problem is separate).

### Confirmation (gates the deletion)

1. **End-to-end call-graph trace — DONE (2026-05-22), result: ZERO live
   callers.** The class is referenced only at `controller-registry.ts:2041`
   (lazy construct inside a `case` whose enabled-check returns `false` at
   `:1180` and which nothing requests); no manager method runs in live code
   (only `archive/v2/` hits, on unrelated classes). Scenario A confirmed →
   Option A proceeds.
2. **If trace = zero live callers (Option A proceeds):**
   - Delete the file.
   - Delete the registry references.
   - Delete CHANGELOG / MIGRATION-LOG advertising.
   - INTEGRATION-LEDGER row recorded with `superseded-by-local` disposition.
   - `grep -rn "FederatedLearningManager\|FederatedLearningCoordinator\|EphemeralLearningAgent" forks/` returns ZERO.
   - `npm run release` acceptance passes unchanged (no test exercised
     this surface, per the audit).
3. **If trace = ≥1 live caller (this ADR retracts) — DID NOT FIRE; the
   trace found zero.** Retained as the hypothetical: had a live caller been
   found, this ADR would retract, F-06-004 would get a "REFUTED on cross-fork
   grep" annotation, and [[project-deprecated-controllers]] would drop
   `federatedLearningManager` from the removable list. None applies — dead
   confirmed. (Conversely, slice-05's F-05-017 "ALIVE" is the verdict that is
   refuted: it read the gated registry arm as a live path.)

## Pros and Cons of the Options

### Option A — delete outright (+ cross-fork cleanup)

- Good, because removes 436 LOC of dead code + false advertising.
- Good, because matches ADR-0203's precedent on a smaller scope.
- Bad, because deletion is irreversible (modulo git) — the cross-fork
  contradiction must be resolved first.

### Option B — keep file, fix only CHANGELOG

- Bad, because leaves 436 LOC of dead code attracting reader confusion.

### Option C — wire to a real consumer

- Bad, because no driver — building infra to justify dead code.

### Option D — defer

- Neutral, because effectively what the dialectic does anyway before
  deciding A vs retraction.

## More Information

- **Audit source (the "dead" verdict):**
  `docs/audits/2026-05-19-soundness-audit/06-controllers-graph-federation.md`
  finding F-06-004; README `00-README.md` Cross-cutting pattern #1
  ("Parallel implementations, wrong one wired").
- **Audit source (the "alive" verdict — contradiction to resolve):**
  `docs/audits/2026-05-19-soundness-audit/05-controllers-learning.md`
  finding F-05-017 ("verified ALIVE").
- **Memory references:** [[project-deprecated-controllers]],
  [[feedback-no-fallbacks]], [[feedback-update-integration-ledger]],
  [[project-adr0201-remediation-impl-order]],
  [[feedback-remediation-adr-preflight]] (specifically #3
  premise-true-at-runtime — directly relevant to the contradiction).
- **Related ADRs:** ADR-0201 (parent audit), ADR-0203 (delete-the-dead-package
  precedent), ADR-0161 (agentdb extraction — the merge that brought this
  surface in), ADR-0178 (fork-only controllers restoration — different
  surface, intact), ADR-0195 (autopilot Phase 4 — the live federation
  path, per F-05-011 confirmed wired through agentic-flow).
- **NOT this ADR:** `backends/rvf/FederatedSessionManager.ts` is a
  different file, a different federation surface, and ALIVE (one caller
  in `SelfLearningRvfBackend.ts:402`). Its silent-catch problem (F-06-008)
  belongs to a separate ADR (likely folded into ADR-0220 learning
  controllers honesty pass or its own ADR if scope grows).
