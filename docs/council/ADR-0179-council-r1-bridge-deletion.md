# ADR-0179 Council — Round 1 Transcript

**Date**: 2026-05-13
**Team**: `adr-0179-council` (`~/.claude/teams/adr-0179-council/config.json`)
**Topology**: hierarchical-mesh, 8 agents, all spawned in one wave (per `feedback-council-queen-da-alongside-experts.md`)
**Comms**: SendMessage on the bound team (per `feedback-agent-dialectic-via-sendmessage.md`) — no file-based handoff
**Related ADR**: [[ADR-0179]] (proposed) — Restore Controller Instrumentation Lost in ADR-0085 Bridge Deletion
**Related Round-2**: [[ADR-0179-council-r2-axis-architecture]] — 8-expert deliberation on whether the underlying axis architecture (which led to the bridge deletion) should itself be revisited

## Question deliberated

Was ADR-0085's deletion of `memory-bridge.ts` correct? Three options:

- **Option A**: ADR-0085's deletion was correct, current state is fine, drop ADR-0179. Live with the regression.
- **Option B**: ADR-0085's structural deletion was correct, but the audit gap is real, ADR-0179's call-site restoration is the right discharge.
- **Option C**: Restore `memory-bridge.ts` as a module. Walk back ADR-0084 controller-direct (or readd bridge as parallel path). Possibly reverse ADR-0086 / ADR-0112 axis independence.

## Participants

| `name:` slug | `subagent_type` | Role |
|---|---|---|
| `queen-architect` | `system-architect` | Synthesis, no advocacy |
| `devils-advocate` | `reviewer` | Pure opposition to all 3 options |
| `bridge-defender` | `researcher` | Pro-restoration (Option C) |
| `status-quo-defender` | `adr-architect` | Pro-current architecture |
| `perf-judge` | `performance-engineer` | Perf-axis verdict |
| `security-judge` | `security-architect` | MutationGuard/AttestationLog axis |
| `memory-judge` | `memory-specialist` | Axis-placement correctness |
| `integration-judge` | `v3-integration-architect` | Upstream-sync cost |

## Briefing supplied to all agents

- **ADR-0053 (upstream, 2026-02-25, Implemented in v3.1.0-alpha.51)**: Created `memory-bridge.ts` as Phase 1 Foundation to solve the "dual memory system" — AgentDB v3 shipped 28 controllers (ReasoningBank, MutationGuard, AttestationLog, TieredCache, ExplainableRecall, SkillLibrary, etc.) but the CLI runtime instantiated none of them and fell through to raw sql.js in memory-initializer.js. Bridge framed PERMANENT Foundation.
- **ADR-0084 Phase 4 (fork, 2026-04-12)**: Moved router to controller-direct access via `getController()`.
- **ADR-0086 (fork, 2026-04-14)**: Split storage axes. RVF for `memory_*`, AgentDB SQLite for `agentdb_*`. Deleted `memory-initializer.ts`.
- **ADR-0112 (fork, 2026-05-01)**: Independent stores — no MCP tool spans both. Cross-store coordination forbidden.
- **ADR-0085 (fork, 2026-04-13)**: Deleted `memory-bridge.ts` (~3,650 lines, 64 exports). 8-agent hive audit found 54/64 exports had zero external callers. Extracted `getRegistry()` + 8 helpers (~226 lines) into `memory-router.ts`. Structural verdict — did NOT body-diff each function for behaviors-inside.

### What the 2026-05-13 audit discovered

6 features lost inside the deleted functions:

1. **MutationGuard pre-write policy gate** — Upstream `bridgeStoreEntry` called `guardValidate(...)` before every write; fork's `routeMemoryOp 'store'` has none.
2. **TieredCache write-through** — Upstream populated read-side cache after every write; fork skips.
3. **AttestationLog audit trail** — Upstream wrote `logAttestation(...)` after every successful write; fork has zero call sites (yet `agentdb_health` still advertises the count, making the telemetry surface structurally lying).
4. **Hybrid BM25 + semantic fusion as default** — Upstream fused with `0.7 × semantic + 0.3 × BM25` on every search; fork does vector OR BM25 as alternatives, never both.
5. **ExplainableRecall provenance strings** — Upstream returned `semantic:0.872+bm25:0.310` style provenance per result; fork's field is unset.
6. **SkillLibrary auto-promotion** — Upstream `bridgeRecordFeedback` called `skills.promote(pattern, quality)` for `success && quality ≥ 0.9 && patterns.length > 0`; fork's `routeFeedbackOp 'record'` skips it.

47 controllers registered, 17 with zero callers from `cli/src`. 9 dead exports; **4 direct regressions against ADR-0053-Resolved issues** (#1220 TieredCache, #1216 ExplainableRecall, Phase 5 MutationGuard, Phase 5 AttestationLog).

---

## QUEEN ARCHITECT — Opening framing

### Load-bearing axes the council must argue

- **Axis 1: Structural vs behavioral correctness of deletion** — ADR-0085's audit confirmed 54/64 exports had zero external callers (structural sound). But "no caller" ≠ "no behavior"; functions had side effects (cache write-through, policy gates, audit writes) invoked transitively.
- **Axis 2: ADR-0053's Resolved status — were the issues actually fixed, or was Resolution a fiction once the bridge was removed?** — 4 named issues are direct regressions. Process failure independent of which option we pick.
- **Axis 3: Restoration locus — module-level vs call-site-level** — A bridge module (Option C) restores both behaviors AND the architectural shape ADR-0084 explicitly rejected. Call-site restoration (Option B / ADR-0179) restores behaviors without resurrecting the parallel path.
- **Axis 4: Independence of ADR-0086/0112 from the bridge question** — RVF/SQLite axis separation and cross-store-forbidden are orthogonal to the 6 lost features. None of the 6 features required cross-store transactions.
- **Axis 5: Controller-coverage as an invariant, not a one-shot fix** — 17 registered-but-uncalled controllers is a symptom of missing lint. Whatever option wins, the absence of a "registered ⟹ called-or-explicitly-internal" check is the actual root cause.
- **Axis 6: Cost-of-reversal asymmetry** — Option C reintroduces ~3,650 LoC and the parallel-path failure mode ADR-0084 fixed. Option B adds ~6 call sites + lint. Option A ships a known regression against shipped-Resolved upstream issues.

### Anticipated consensus

- The 2026-05-13 audit finding is correct and load-bearing: 6 features were lost, not 0.
- ADR-0085's structural verdict (54/64 exports unused) was sound *as a structural claim*; the failure was methodological — export-graph audit cannot detect behavioral side effects.
- ADR-0053's "Resolved" markings on #1220 / #1216 / Phase 5 controllers are now factually incorrect and must be reopened or re-annotated regardless of A/B/C.
- ADR-0086 (RVF vs SQLite axis separation) is independently sound and should NOT be reversed.
- A controller-coverage lint is needed regardless of which option wins.

### Tentative lean

**Option B**, with the caveat that ADR-0179 must include the controller-coverage lint as a hard CI gate, not advisory; and ADR-0053's Resolved markings must be re-audited and re-annotated. **Confidence: 62.**

Justification: the 6 lost features are independent decorators on existing router operations, not a coherent module — call-site restoration is the minimum-blast-radius discharge that doesn't resurrect the parallel-path failure mode ADR-0084 correctly diagnosed.

---

## DEVIL'S ADVOCATE — Trilateral challenge

### Challenge to Option A ("deletion was correct, do nothing")

- **Strongest argument FOR A that defenders won't make:** 54/64 zero-caller exports is the smoking gun — the bridge was a museum, not a runtime. "Regression" requires a baseline of working behavior; if MutationGuard's pre-write gate fired in production and a fork user noticed when it stopped, name the bug report. There isn't one. **You cannot regress from a feature nobody invoked.**
- **Strongest argument AGAINST A:** "Nobody noticed" is exactly what you'd expect from silently-deleted audit, attestation, and provenance code. Those features fail by being absent, not by throwing. AttestationLog regression doesn't page anyone — it just leaves you with no audit trail when compliance asks six months later.
- **What advocates of A are HIDING:** The four ADR-0053 regressions (TieredCache, ExplainableRecall, MutationGuard, AttestationLog) were inside the *10 called* functions — embedded in helpers that DID have callers. The "54/64" headline is misleading.
- **One unambiguous data point that sinks A:** A single ADR-0053-cited issue (#1220, #1216, or either Phase 5 issue) where the feature was demonstrably exercised by a CLI path that still exists today and is now silently degraded.

### Challenge to Option B ("ADR-0179 restoration is the right discharge")

- **Strongest argument FOR B that defenders won't make:** B is the only option that forces the 34-row behavioral diff that ADR-0085 skipped. The audit debt is real and only B discharges it. A buries it; C buries it under a 3,650-line restoration nobody will re-read.
- **Strongest argument AGAINST B:** B is the "have your cake and eat it" option. ADR-0085 was wrong → restore the features. ADR-0085 was right → keep the deletion. The 34-row diff and explicit call sites are a *consolation prize* designed so neither bridge-defender nor status-quo-defender loses. That's diplomacy, not architecture. The controller-coverage lint also re-introduces the same coupling ADR-0112 forbade — Hybrid BM25+semantic fusion *by definition* spans the vector axis and the keyword axis.
- **What advocates of B are hand-waving:** *Where* the explicit call sites go. The deleted bridge had a coherent layering (ControllerRegistry → HybridBackend → controllers). B sprinkles 6 features across the router as ad-hoc call sites. That's not "restoring features without restoring the bridge" — that's reinventing the bridge as scattered router code, which is strictly worse than either A or C.
- **One unambiguous data point that sinks B:** Show the proposed router diff for Hybrid BM25+semantic fusion. If it requires the router to coordinate a write across the RVF axis AND the AgentDB SQLite axis in a single MCP tool, ADR-0112 is violated and B is incoherent.

### Challenge to Option C ("restore the bridge, undo related ADRs")

- **Strongest argument FOR C that defenders won't make:** The fork made three independent architectural decisions (ADR-0084 controller-direct, ADR-0086 axis split, ADR-0112 independent stores) and *each* was justified locally. But the *composition* of all three is what produced the 6-feature loss, and no single ADR owns that composition. Only C admits the composition is broken.
- **Strongest argument AGAINST C:** Restoring 3,650 lines and walking back three downstream ADRs to fix 6 features (4 of which may not have working callers in current fork) is the textbook definition of "over-correction in response to embarrassment." The ADR-0086 axis split was driven by RVF-primary — that's load-bearing infrastructure, not a stylistic choice.
- **What advocates of C are romanticizing:** The bridge as it *was* vs the bridge as it *would have to be* post-ADR-0086/0112. You cannot restore `memory-bridge.ts` as-of-deletion onto current trunk. C's "restoration" is actually "rewrite a new bridge that pretends ADR-0086 didn't happen." That's a much larger surgery than C's defenders are admitting.
- **One unambiguous data point that sinks C:** Demonstrate that any of the 6 lost features *requires* a bridge module rather than 6 explicit router call sites + a coverage lint.

### The question NOBODY will want to answer

**Why did ADR-0085's hive audit ship with zero body-diff of the 10 *called* functions, and what process change prevents the next deletion from doing the same?** The council is litigating the symptom. The process that approved a 3,650-line deletion without behavioral diff is the actual defect, and it will fire again — on the next "obviously dead" module — regardless of which option wins.

### Own lean

Pure opposition by role. One observation for the queen: **B is the option that resolves itself by producing evidence**. A and C resolve by vote. Prefer the option that produces evidence.

---

## BRIDGE DEFENDER — Case for restoration

### Position

- **Primary: C (confidence 72)** — restore `memory-bridge.ts` as the concentrated controller-integration surface.
- **Secondary acceptable fallback: B+** — accept ADR-0179 call-site restoration only if it ships with (a) a single `controller-integration/` module that physically co-locates the 6 call sites, (b) the audit table promoted to a runtime registry contract, and (c) a CI lint that fails when a controller is registered with zero callers.

### Five strongest arguments

1. **The audit is empirical proof that scattered integration loses features.** Six ADR-0053 mission deliverables silently regressed between 2026-02-25 and 2026-05-13. That is the predicted failure mode of dispersing a cohesive integration responsibility. The bridge existed precisely so "is controller X wired?" was answerable by reading one file.
2. **64 exports was cohesion, not bloat.** The bridge was the *intended* integration point for 28 controllers; the CLI hadn't finished wiring its surface area yet. Deleting the bridge because callers hadn't arrived is like deleting an API because no client has shipped. The 17 currently-zero-caller controllers prove the wiring debt didn't vanish, it lost its home.
3. **GoF Bridge + cross-package bridge is the right pattern for this seam.** AgentDB ships an abstraction; the CLI is the implementation hierarchy. ADR-0084 Phase 4 optimized for one hop of indirection at the cost of the abstraction that made the system auditable.
4. **ADR-0179 institutionalizes the same audit gap.** An audit table is a *document*. Documents drift. The bridge was *code*; its exports were the audit table, mechanically.
5. **The fork is in arrears against its own foundational ADR.** ADR-0053 was framed "Phase 1 Foundation" and "PERMANENT." Issues #1207-#1227 were marked Resolved on the basis of `bridgeGetController('X')`.

### Honest weak spot

I'm reasoning from a briefing, not from the deleted code. If the bridge was 80% router-that-shouldn't-have-been-there and 20% actual integration, then ADR-0085 correctly extracted the router and the remaining 20% is small enough that call-site restoration is genuinely fine. **My case rests on the bridge having been load-bearing at deletion; if it was mostly dead scaffolding around a small integration core, Option B is the right answer.**

---

## STATUS-QUO DEFENDER — Case for current architecture

### Position

- **Primary: B (confidence 78)**
- Acceptable secondary: A as a fallback if the audit shows the 6 features can be reconstructed organically. **C is unacceptable.**

### Why ADR-0085 was correct and remains correct

1. **The bridge encoded a now-forbidden mental model.** ADR-0053 was written when the system was *one* memory plane with controllers as an implementation detail. ADR-0086 split that plane into two stores; ADR-0112 forbade cross-store coordination as a design rule. A bridge module whose entire purpose is to be the single orchestrator spanning both stores is, post-0086/0112, a category error.
2. `agentdb-orchestration.ts` literally re-implemented 15 bridge functions with file:line citations — the codebase telling us one of the two layers had forked and was diverging.
3. **The dead-export evidence was overwhelming and pre-deletion-verified.** 54/64 exports had zero external callers.
4. **Controller-direct (ADR-0084 Phase 4) had already won on the CLI side.** Once `getController()` was the canonical path, the bridge's value disappeared.
5. **Net production LoC: -3,588 against a +226 router extraction.** That ratio (~16:1) is only achievable when the deleted code was genuinely redundant.

### Where I'll concede ground

- The 6 lost behaviours ARE real losses. MutationGuard and AttestationLog in particular are correctness/audit features, not nice-to-haves.
- The audit-gap critique — that ADR-0085's review counted *call edges* but not *behavioural surface* — is fair.
- ADR-0179's restoration phases are reasonable. This is the right discharge.

### Honest weak spot

My case leans on ADR-0085's review having been *structurally* sound while conceding it was *behaviourally* incomplete. If the audit-gap critique generalises — if there are more than 6 lost behaviours — the "deletion was right on structure" defence weakens with every additional discovery. If a second audit pass surfaces 6+ more lost behaviours, B starts looking like denial and C starts looking like prudence.

---

## PERFORMANCE JUDGE — Perf-axis verdict

### Per-option signature

- **Option A**: RVF append-only WAL + atomic compact. p50 sub-ms for small payloads. Zero pre-write gate cost. Phase C.3 wins fully realized. **Net: cheapest on every perf axis.**
- **Option B**: +3 synchronous controller hops per write (MutationGuard, TieredCache, AttestationLog). +0.5-2ms p50, +5-15% p99 tail. Hybrid BM25+semantic adds O(n) IDF traversal — read p50 goes from ~1ms to ~10-30ms (**10-30× regression**). **Risk**: if hooks pull via `getRegistry()`, memory_* routes re-acquire registry bootstrap; +15-25% of original +30% store-p50 regression returns. Phase C.3 forfeit unless lite-registry is engineered.
- **Option C**: Same as B plus bridge dispatch (~50-200µs). If C undoes RVF: catastrophic, back to sql.js cosine-on-JSON (150-12,500× per ADR-0086's own measurement). **Net: worst on every axis.**

### Ranking purely on perf

1. **A** — strictly cheapest on every axis. The floor.
2. **B** — recoverable IF hybrid is opt-in (`hybrid: true` flag, default off) AND 3 write-side controllers are lazily constructed without forcing registry bootstrap.
3. **C** — strictly dominated.

### Hard rules for any WIRE decision in B

- Hybrid BM25+semantic must be **opt-in per-query**, not default-on.
- MutationGuard must have **O(1) empty-rules fast path**.
- AttestationLog must NOT contend with main RVF WAL.
- No new call site may force `ensureRegistry()` on memory_* axis.

---

## SECURITY JUDGE — Security-axis verdict

### Current security posture (Option A — do nothing)

- MutationGuard: structurally dead. Every store/search/batch/remove/save/load bypasses the gate.
- AttestationLog: structurally dead **with a worse failure mode** — `agentdb_health` advertises an attestation count that is *always zero by construction*. An operator reading "0 attestations" today cannot distinguish "system quiet" from "audit subsystem unwired." **Lying telemetry surface.**
- ADR-0060 compliance: zero.
- Overall posture rating (1-10, where 10 = ADR-0053 design intent): **2**.

### Option B posture

- MutationGuard wired as router pre-hook: **8**. Validates store/batch/remove/save/load at the single chokepoint.
- AttestationLog wired as router post-hook: **8**. `agentdb_health` count becomes truthful.
- **Failure semantics: MUST fail loudly.** Feature-check at boot (is the controller wired?), fail-loud at every invocation thereafter. Not "feature-checked per call so missing guard is silently OK."

### Option C posture

- Posture rating: **9** at the bridge layer. But restoring with the wrong architecture re-introduces 54-of-64 dead exports — a 1:30 attack-surface ratio for a 2-feature security gain.

### Ranking

1. **B** — restores ADR-0060 compliance at router chokepoint without re-introducing the bridge's cross-store coupling.
2. **C** — same security posture but ships architectural debt.
3. **A** — forensic black hole, lying `agentdb_health` count, unenforceable policy layer.

### Non-obvious regression

**`agentdb_health` reports attestation count = 0 today; an operator reads this as "low activity" rather than "audit subsystem unwired."** This is worse than not exposing the field — it converts an absent feature into false reassurance. The lying-telemetry problem alone justifies B over A.

---

## MEMORY ARCHITECTURE JUDGE — Storage-axis verdict

### Per-feature axis assignment

| Feature | Correct axis | Current ADR-0179 placement | Misplaced? |
|---|---|---|---|
| MutationGuard pre-write gate | **Both axes** (axis-neutral middleware) | memory_* router | YES — must be dual-axis |
| TieredCache write-through | memory_* primary | memory_* router | Partially correct |
| AttestationLog audit | **Both axes** | memory_* router | YES — must be dual-axis |
| Hybrid BM25+semantic fusion | memory_* search only | memory_* router | Mostly correct |
| ExplainableRecall provenance | **agentdb_* primary** | memory_* router | YES — misplaced |
| SkillLibrary auto-promotion | agentdb_* (correct) | agentdb_* feedback route | Correctly placed |

### Ranking

1. **B-amended** — split into B-mem and B-db, shared write-middleware module (`src/memory/middleware/`) for MutationGuard + AttestationLog, axis-specific read-path features.
2. **B-as-written** — better than A but ExplainableRecall on memory_* is structurally wrong; Guard/Attest skipping agentdb_* leaves real audit hole.
3. **A** — regressions are real; not a stable resting point.
4. **C — off the ranking.** Direct ADR-0086 violation.

### The deepest architectural question

**Is the bridge concept axis-shaped or NOT axis-shaped?** NOT axis-shaped. The original bridge bundled three distinct concerns: (1) write-path middleware (axis-neutral); (2) read-path enhancement (axis-specific); (3) controller lifecycle (correctly killed by ADR-0086). The bridge's failure was conflating these. ADR-0179's failure mirror is putting (1) and (2) on one axis as if they were the same kind of thing.

---

## INTEGRATION JUDGE — Upstream-sync & fork-divergence verdict

### Per-option upstream-sync cost

- **A**: Upstream changes never reach fork via bridge.ts (deleted). Each weekly sync produces `deleted by us` conflict. Drift over 6mo: 2-4 more silent regressions; 12mo: capability surface visibly trails upstream.
- **B**: Body-diff per sync is the corrective. Drift over 6mo: stable if body-diff cadence established.
- **C**: Worst. Re-import 2,370-line bridge, then re-fork to honor ADR-0084/0086/0112. 6mo: re-fork begins immediately. 12mo: bridge.ts is most divergent file in the fork *again*.

### The "fork-owned agentdb" complication

Pre-0161, agentdb was vendored. Now it's its own fork. **Both** consumer and provider of the bridge are fork-owned. The original ADR-0053 framing solved cross-package indirection when one side was vendored. Now that both sides are fork-owned, the indirection has no remaining value. **This decisively weakens the case for C.**

### Body-diff methodology heuristic

For files where `exports/LoC < 0.05`, body-diff is mandatory before deletion. Bridge.ts was 34/2370 ≈ 0.014 — well below threshold.

### Ranking

1. **B** — restores feature parity without re-coupling to upstream's pre-split, pre-direct architecture.
2. **A** — cheapest weekly sync cost; compounds divergence-of-capability.
3. **C** — worst on every integration axis.

---

## Council verdict (synthesis)

### Tally

| Expert | Primary | Notes |
|---|---|---|
| queen-architect | **B** (62%) | Tentative; willing to escalate to "B+" if recurrence risk surfaces |
| devils-advocate | **none** (pure opposition) | But explicitly: "Prefer the option that produces evidence" → B |
| bridge-defender | **C** (72%) | Concedes to B+ if call sites are physically co-located + lint generalizes |
| status-quo-defender | **B** (78%) | A as last-resort fallback; C is "unacceptable" |
| perf-judge | **A** on pure perf grounds | But "B is recoverable" if hybrid is opt-in + no eager-init leakage |
| security-judge | **B** (decisive) | C is second; A is non-compliant with ADR-0060 |
| memory-judge | **B-amended** | Axis re-placement mandatory; C "off the ranking" — violates 0086/0112 |
| integration-judge | **B** | A second; C "worst on every integration axis" |

**Final tally: 6 B / 1 C / 1 A-with-B-acceptable.**

### Mandatory amendments to ADR-0179 ("B-amended")

1. **Axis re-placement** — MutationGuard + AttestationLog go on *both* router axes via shared write-middleware (`src/memory/middleware/`), not just memory_*. ExplainableRecall moves to agentdb_*.
2. **Performance guardrails** — Hybrid BM25+semantic opt-in not default; MutationGuard O(1) empty-rules fast path; AttestationLog separate I/O; no registry leakage on memory_* axis; lazy per-controller construction.
3. **Failure semantics + chokepoint coverage** — Fail-loud not feature-checked-per-call; audit of controller-direct mutation sites under ADR-0084 Phase 4; read-side guard policy explicit.
4. **Body-diff methodology generalization** — `exports/LoC < 0.05` triggers body-diff before deletion. Permanent precedent.
5. **Reopen ADR-0053 Resolved markings** — Issues #1220, #1216, Phase 5 controllers must be re-audited and re-annotated.

### Final recommendation

Adopt **B-amended**. The bridge stays deleted. ADR-0084/0086/0112 stay in place. The 6-feature debt gets discharged correctly — not by recreating the bridge, not by pretending the gap doesn't exist.

---

## Provenance

- Round 1 ran 2026-05-13 ~11:10–11:14 (4 minutes wall-clock from spawn to last idle).
- Cost: zero per `feedback-no-api-keys.md` — agents shell out to local `claude` CLI via subscription.
- 8 agents spawned in one `Agent` tool wave (single message) per `feedback-council-queen-da-alongside-experts.md`.
- Round 1 outputs delivered via SendMessage on team `adr-0179-council`, per `feedback-agent-dialectic-via-sendmessage.md`.
- Followed by [[ADR-0179-council-r2-axis-architecture]] which deliberated whether the underlying axis architecture (which ADR-0179's restoration assumes) is itself correct.
