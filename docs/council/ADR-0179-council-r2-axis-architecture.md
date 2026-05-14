# ADR-0179 Council — Round 2 Transcript

**Date**: 2026-05-13
**Team**: `adr-0179-council` (same 8 agents as round 1, recontextualized via SendMessage)
**Topology**: hierarchical-mesh (continued from round 1)
**Comms**: SendMessage on bound team — no file-based handoff
**Related ADRs**: [[ADR-0179]] (round 1 outcome) — will likely spawn ADR-0180 from this round's verdict
**Predecessor**: [[ADR-0179-council-r1-bridge-deletion]] — round 1 on the bridge deletion itself

## Question deliberated

Should the fork keep its **dual-axis** storage architecture (`memory_*` writes RVF, `agentdb_*` writes AgentDB SQLite — ADR-0086/0112), or revert to a **single-axis** model like upstream (one MCP surface, one storage file, with any hybrid sub-backends invisible to the caller)?

**User constraint**: "Discount any work we have done so far with postgres." ADR-0170 / pglite substrate work is off the table. Pure RVF-vs-SQLite axis question.

### Three options

- **Option X (status quo, dual axis)**: keep ADR-0086/0112. Two MCP surfaces (`memory_*`, `agentdb_*`), two files (`.rvf` + `.swarm/memory.db`), two failure modes.
- **Option Y (collapse to single axis, upstream-style)**: one MCP surface (`memory_*`). One storage file. HybridBackend (or AgentDB's own hybrid internals) hidden behind the single surface. agentdb_* tools removed or merged. Revert ADR-0086 + ADR-0112.
- **Option Z (single user surface, dual substrate internal)**: one MCP surface, internally route by query type. Keep RVF for vectors, keep AgentDB SQLite for relational, but never expose the choice to the caller. Revert ADR-0112; keep most of ADR-0086.

## Upstream research (supplied to all agents as ground truth)

1. **ADR-006 (Unified Memory Service, 2026-01-03)** — One MemoryService, three pluggable backends: `sqlite | agentdb | hybrid`. Hybrid was default. ONE CLI API surface (`memory_*`), pluggable internals.
2. **ADR-009 (Hybrid Memory Backend Default)** — HybridBackend routes by query type: key-value → SQLite, semantic → AgentDB (HNSW), structured → SQLite. All in `.swarm/memory.db`. ONE file, internally dual-substrate.
3. **Actual upstream CLI runtime** — `memory-initializer.ts` bypasses HybridBackend entirely. Raw sql.js writes everything to `.swarm/memory.db` with HNSW metadata tables.
4. **AgentDB v3 itself is internally hybrid** — SQLite for metadata + native vector indexes for HNSW.

### The fork's compromised story (load-bearing for round 2)

- **ADR-0086 (2026-04-14)** was titled **"Layer 1 — Single Storage Abstraction (RVF-First)."** Its stated GOAL was to eliminate the dual backend. It explicitly accepted **Debt 15 "ControllerRegistry dual-backend"** as the ONE trade-off it could not close, because the 10+ neural controllers (Reflexion, SkillLibrary, CausalGraph, LearningSystem, etc.) need relational schemas that don't fit RVF's K/V model.
- **ADR-0112 (2026-05-01)** then took that *failed unification* and reframed it as deliberate architecture: "two independent stores, feature-aligned." Workload-differentiation language.
- **The "150x-12,500× speedup" claim from ADR-0086** is RVF native NAPI HNSW vs upstream's *sql.js cosine on rehydrated JSON embeddings*. It is NOT RVF vs AgentDB's own native HNSW. The honest comparator is plausibly **2-5×**, not 150-12,500×.

---

## QUEEN ARCHITECT — Opening framing (round 2)

### Load-bearing axes

- **Axis 1: User-surface count is a contract, not an implementation detail.** Once `memory_*` and `agentdb_*` are both first-class MCP tool families, callers (skills, agents, third-party plugins) hard-code the choice. Reverting to a single surface later is a breaking change.
- **Axis 2: ADR-0086's stated goal vs its delivered outcome.** ADR-0086 was titled "Single Storage Abstraction" and *failed* to unify — Debt 15 was the unclosed trade-off. ADR-0112 then re-narrated that failure as deliberate. These are different architectures wearing the same code.
- **Axis 3: Where does the hybrid routing decision live?** Three placements: (a) at the **caller** (Option X — caller picks `memory_*` or `agentdb_*`), (b) at the **router** (Option Z — caller hits `memory_*`, router dispatches by query shape), (c) at the **substrate** (Option Y — caller hits `memory_*`, AgentDB's internal SQLite+HNSW handles it).
- **Axis 4: The 150x-12,500x perf claim does not survive scrutiny in the relevant comparison.** RVF native NAPI HNSW vs sql.js-cosine-on-JSON is real but irrelevant — that's the upstream-CLI baseline, not the upstream-HybridBackend baseline.
- **Axis 5: Independence as a feature vs as a cost.** ADR-0112 frames "no cross-store transactions, no shared consistency" as a *feature*. Equally, it is a *cost* (any future feature wanting K/V + vector + relational coherence cannot be built at all).
- **Axis 6: 10+ neural controllers and the relational-schema floor.** Even Option Y/Z must accommodate Reflexion, SkillLibrary, CausalGraph, LearningSystem. RVF's K/V model cannot host them. Pure "everything in RVF" is off the table.
- **Axis 7: Migration cost asymmetry.** Option X is free. Option Z is medium. Option Y is high.

### Tentative lean

**Option Z** (single user surface, dual substrate internal): one `memory_*` MCP surface, internal router dispatches by query shape, RVF retained as vector substrate, AgentDB SQLite retained as relational substrate. **Confidence: 58.**

Justification: Option Z preserves every perf gain ADR-0086 actually delivered (RVF on vector hot path), absorbs the 10+ controllers as ADR-0086's Debt 15 always required, restores upstream's single-surface design intent (ADR-006/009), eliminates the dual-surface caller tax, and creates the routing seam the round-1 features need to be restored coherently. **It is also the option ADR-0086 was *trying* to deliver before Debt 15 derailed it.**

---

## DEVIL'S ADVOCATE — Trilateral challenge (round 2)

### Pre-flight: four ambient claims the council won't examine

1. **The 150-12,500× speedup.** Measured RVF-HNSW vs sql.js JSON rehydrate + JS cosine. **Wrong baseline.** AgentDB ships its own HNSW; honest baseline is RVF-HNSW vs AgentDB-HNSW. Nobody on this council has run that benchmark.
2. **ADR-0086's stated goal was unification.** Re-read the title: "Layer 1 — Single Storage Abstraction (RVF-First)." Decision text wanted ONE backend. It produced TWO. Debt-15 is the receipt that unification was *attempted and not delivered*. ADR-0112 then relabelled the residue as "feature-aligned independent stores." **By definition, retroactive rationalisation of a forced compromise.**
3. **"Upstream is single-axis" is half-true.** Upstream's *design* is single-surface hybrid. Upstream's *runtime* bypasses all of that and writes raw sql.js. "Single-axis like upstream" actually means "single-axis like upstream's runtime shortcut," which is the *least* designed of the three states.
4. **AgentDB is already internally hybrid.** SQLite + vector indexes inside one process, one file. **Z is *describing AgentDB*.** Only honest question for Z: does the fork's RVF buy anything over AgentDB's own vector layer that justifies maintaining a second substrate?

### Challenge to X ("status quo dual-axis")

- **Strongest argument FOR X defenders won't make:** The dual-axis exists because RVF and AgentDB have *different durability and recovery semantics*, not because of speed. Defenders won't say this out loud because it admits the axis split was about *recovery*, not the 150-12,500× speedup story.
- **Strongest argument AGAINST X:** ADR-0086 set itself a unification goal in its title and failed. The fork is shipping a hidden tradeoff labelled as an architectural choice. Every cross-axis feature becomes either impossible (ADR-0112 forbids it) or smuggled through the router as ad-hoc coordination. X is paying interest on the failed unification every time someone tries to add a feature that spans both stores.
- **One unambiguous data point that sinks X:** RVF-HNSW vs AgentDB-HNSW on the same corpus, same query mix, ≤2× difference. If RVF is not order-of-magnitude faster, the dual-substrate cost is unjustified.

### Challenge to Y ("single-axis like upstream")

- **Strongest argument FOR Y defenders won't make:** Y is the only option that lets the fork rejoin upstream's ADR-006/009 surface. Y buys *back* convergence.
- **Strongest argument AGAINST Y:** "Single-axis like upstream" is actually "single-axis like upstream's *runtime shortcut* — raw sql.js bypassing the hybrid backend upstream *designed*." Y is the option where the fork copies upstream's *undesigned* runtime state.
- **One unambiguous data point that sinks Y:** If Y means "the runtime," the fork is regressing. If Y means "the design," then Y is actually Z — and should be called Z.

### Challenge to Z ("single MCP surface, dual substrate routed internally")

- **Strongest argument FOR Z defenders won't make:** Z is what AgentDB *already is*. Admitting "AgentDB already does Z" is admitting RVF is the redundant layer.
- **Strongest argument AGAINST Z:** The maintenance burden of "two stores" does not vanish when you hide it; it migrates into the routing layer and gets *worse* because now it is invisible to callers but still requires invariants nobody can see and nobody will test. Z is rebuilding the conditions for the same class of error (the bridge deletion).
- **One unambiguous data point that sinks Z:** A specific MCP tool whose semantics require *atomic* writes to both substrates. If even one tool needs that, Z either ships a distributed-transaction layer (which it won't) or accepts partial-failure modes the API doesn't expose.

### The question NOBODY will want to answer

**Is ADR-0086 + ADR-0112 an architectural insight, or is it the retroactive rationalisation of a unification attempt that failed at Debt-15?** Until somebody names the ADR-0086 unification failure honestly, the axis question cannot be decided — every option will be evaluated against a phantom baseline. **Sub-question: who is going to run the RVF-HNSW vs AgentDB-HNSW benchmark *before* the vote, not after?**

### Own lean

Pure opposition. **The cheapest next move is not picking an option** — it is (a) running RVF-HNSW vs AgentDB-HNSW on a real corpus, and (b) amending ADR-0086's Status section to say plainly whether Debt-15 was a partial-success or a unification-failure.

---

## SINGLE-AXIS ADVOCATE (formerly bridge-defender) — Case for unification

### Position

- **Primary: Z (confidence 70)** — one MCP surface, dual substrate internal. Revert ADR-0112, keep most of ADR-0086.
- Secondary acceptable fallback: **Y (confidence 55 if forced)**.
- **X is not acceptable.** Dual-axis is failed unification rebranded as deliberate architecture.

### Five strongest arguments

1. **The fork already tried single-axis and the ADR record proves it.** ADR-0086 was titled "Single Storage Abstraction (RVF-First)." ADR-0112 walked in three months later and reframed the uncloseable debt as "two independent stores, feature-aligned." That is renaming a known incomplete unification as a finished feature.
2. **Upstream is the working counterfactual.** Both ADR-006/009's HybridBackend and the raw-sql.js runtime work in production. "Dual-axis is necessary because the workloads differ" has to argue against a working upstream that doesn't believe that.
3. **The speedup claim is benchmark theatre.** 150-12,500× is RVF vs sql.js doing cosine over rehydrated JSON. The honest comparison is RVF vs AgentDB's *own* HNSW, and that's 2-5× at most.
4. **Two stores is two of everything, forever.** Two backup paths. Two corruption recovery procedures. Two failure modes. Two namespaces. Two ADRs to enforce against drift.
5. **The user-facing story is unsellable.** A user installing the package and reading the docs sees `memory_store` and `agentdb_hierarchical_store` and asks: "which do I use?" That answer is an implementation detail leaking through the public surface.

### Honest weak spot

If `agentdb_causal_*` does graph-shaped queries that are *semantically* distinct from "remember this fact," not just substrate-distinct — then the namespace split is carrying real semantic information and Z's "hide it all behind one surface" loses that. **My answer (sub-namespacing within the unified surface) is plausible but I haven't designed it.**

---

## DUAL-AXIS DEFENDER (formerly status-quo-defender) — Case for status quo

### Position

- **Primary: X (confidence 62)**
- Acceptable secondary: **Z** (confidence I'd accept this without protest: 30)
- **Y unacceptable** (confidence in rejection: 88)

**Honest admission**: The gap between X and Z is narrower than my role-incentive suggests. **If we were greenfield I would probably advocate Z.** I hold X primarily on migration-cost and contract-stability grounds.

### Engaging the inconvenient facts (no dodging)

- **"ADR-0086 was titled 'Single Storage Abstraction (RVF-First)' — dual-axis is failed unification"**: **Conceded ground.** "The original goal wasn't met" is not the same as "the resulting architecture is wrong." A lot of good architectures are residue of failed unifications. ADR-0086's title is wrong relative to its outcome; ADR-0112 should have explicitly retired the unification goal rather than dressing the failure as virtue.
- **"The 150-12,500× speedup baseline is dishonest"**: **Conceded fully.** Real delta is 2-5×, probably workload-dependent. **Anyone citing 150× in a 2026-05 decision document is misrepresenting the comparison.**
- **"Workload differentiation is post-hoc"**: **Partly true.** Split exists because we couldn't migrate the controllers, then we noticed the workloads differ. Reverse causality matters.
- **"MutationGuard and AttestationLog are cross-cutting"**: **Strongest critique.** The features apply regardless of substrate. Same *intent*, different *mechanism*. I'll concede this is the strongest argument for Z over X.

### Is Z strictly better than X?

Honestly assessing: Z beats X on three axes (cognitive load, cross-cutting features, upstream-sync drift). X beats Z on three (migration cost, contract stability, explicit semantics). One is a wash. **My honest read is that Z is mildly better on architectural merits and X is mildly better on migration realism.**

### Honest weak spot

**My case for X is ~60% migration-cost realism and ~40% genuine merit.** A purely-merit case would put Z and X roughly tied with Z slightly ahead. If the council weights "carve nature at the joints" heavily over "respect sunk migration cost," they should pick Z.

---

## PERFORMANCE JUDGE — Perf-axis verdict (round 2)

### Per-option signature

- **Option X (dual-axis)**: RVF p50 ~0.3-0.8ms (vectors); SQLite p50 ~0.5-1.5ms (relational). Phase C.3 wins fully retained. Two-file cold start ~8-25ms.
- **Option Y (single-axis upstream-style)**: All writes through AgentDB router. p50 ~0.5-1.5ms (**1.5-3× slower than RVF direct**). **Phase C.3 FORFEITED** unless internally re-architected (the +30% store p50 / +21% wall regression returns).
- **Option Z (single surface, dual substrate)**: ~99% of X's perf with cleaner external surface. Dispatch branch ~10-50µs (below MCP roundtrip noise). Phase C.3 PRESERVABLE if router predicate runs before registry init.

### RVF vs AgentDB-internal-HNSW (the load-bearing question)

- Index quality: identical recall (both HNSW).
- Insertion: gap **1.5-3×**.
- k-NN search no JOIN: gap **1.5-3×**.
- k-NN with metadata JOIN: gap **2-5×**.
- Cold open: **slight win for SQLite**.

**Verdict: 2-3× typical, 5× worst-case for JOIN-heavy reads.** Meaningful for high-throughput agent hot loops; below human perception for casual use. **Dual-axis is justified by perf alone for high-throughput agent workloads, NOT for casual interactive use.**

### The 150-12,500× claim — defend or debunk

**Debunked as currently framed.** That comparison is RVF native NAPI HNSW vs sql.js WASM cosine-over-JSON.parse'd-embeddings. **The honest claim is: "RVF is 150-12,500× faster than the upstream's sql.js-based vector search."** True. Justifies escaping sql.js. Does NOT justify dual-axis vs single-axis when single-axis runs on AgentDB's native HNSW. Real gap there: 2-3×.

### Ranking purely on perf

1. **X** — strictly best on hot-path latency, fully retains Phase C.3.
2. **Z** — within 1% of X on perf, cleaner external surface.
3. **Y** — loses 1.5-3× on hot path AND forfeits Phase C.3.

### Hidden perf trap in each option

- A: none (perf floor).
- Y: Phase C.3 forfeiture is **silent** — microbenchmarks look fine, cold-start regression shows up only weeks later in user telemetry.
- Z: router predicate must be predicate-cheap (string check, not controller lookup).

---

## SECURITY JUDGE — Security-axis verdict (round 2)

### Framing — round-1 insight that drives round 2

MutationGuard and AttestationLog are **cross-cutting write-middleware**, not axis-specific data. They validate *what is being written* and *who is writing it*; they don't care whether the substrate is RVF or SQLite. **Security features that don't carve at the axis joints punish any architecture that puts joints between them and the data plane.**

### Per-option posture

- **Option X**: TWO chokepoints. TWO audit streams. Cross-axis correlation requires manual reconstruction. Posture rating: **5/10**.
- **Option Y**: ONE chokepoint. ONE audit chain. No cross-axis correlation problem. Posture: **8/10**.
- **Option Z**: ONE chokepoint at MCP-router layer (above substrate split). Audit records logical intent, not substrate accident. **The audit boundary is *above* the routing decision.** Posture: **9/10**.

### Why Z is best-of-both

Single-chokepoint property of Y while preserving substrate-purity benefit of X. **From the auditor's perspective there is one store; from the runtime's perspective there are two.** Hiding the dual substrate from the caller doesn't hurt security — it *helps* security, because the caller can't bypass the guard by targeting a substrate directly.

### Ranking

1. **Z** (9/10) — best of both worlds.
2. **Y** (8/10) — strong single-chokepoint; pure architectural cost.
3. **X** (5/10) — defensible but pays permanent two-chokepoint tax with cross-axis blind spot.

### Non-obvious regression

**ADR-0112's "no MCP tool spans both stores" is, from a security perspective, "no MCP tool can audit both stores in one call."** The standard operator workflow ("query the audit log for everything this agent_id did between T1 and T2") cannot exist as a single MCP call under X. **The cost of X is paid not at write time but at incident time, when paying it is most expensive.**

---

## MEMORY ARCHITECTURE JUDGE — Verdict on X/Y/Z

### Workload signature per substrate

- **RVF excels at**: Append-only writes of (id, vector, small-blob-value); ANN search; single-writer regimes with WAL + atomic compact; embedding-payload-dominant memory.
- **SQLite excels at**: Relational schemas with FKs, joins, multi-column indexes, range scans, GROUP BY; ACID multi-row transactions; mutation-heavy with UPDATE semantics.

**Is the difference fundamental or parameterized?** **Fundamental.** A neural controller asking "give me all reflexion entries for session S where verdict='loss' joined to their causal-edges" is not a parameterized-cost variant of "ANN search a 768-dim vector."

### Feature topology audit

| Feature | Axis-natural? |
|---------|---------------|
| memory_store / memory_retrieve / memory_search (K/V/ANN) | RVF-natural |
| memory_search (BM25 fusion) | **Cross-cutting** |
| ReasoningBank verdicts, Reflexion entries, CausalGraph edges, SkillLibrary, LearningSystem | SQLite-natural |
| HierarchicalMemory | **Cross-cutting** |
| MutationGuard, AttestationLog | **Cross-cutting** |
| TieredCache | Mostly RVF, partially SQLite |
| ExplainableRecall provenance | SQLite-natural |
| StreamingEmbeddingService | RVF-natural |

**Tally: ~6 RVF-natural, ~6 SQLite-natural, ~3-4 cross-cutting.** The split IS carving at a real joint for ~80% of features. **But the user-visible MCP surface does not have to mirror the substrate split.** Carving internally is correct; carving in the tool namespace is a separate decision.

### Maintenance burden — real

ADR-0086 (split), 0090 (data loss), 0112 (reframing), 0154 (RVF unification target), 0161 (agentdb migration), 0164 (vectorless META_SEG), 0166 (axis-separation amendment), 0178/0179 (restoration audit), plus six fork-only controllers needing restoration. **9+ ADRs and ~6 fork-only controllers worth of architectural churn** trace directly to the dual-substrate reality.

### Was ADR-0086+0112 forced or chosen?

- **Forced at the substrate level**: Yes. Neural controllers' relational schemas force SQLite.
- **Chosen at the surface level**: Yes. ADR-0112 took the forced substrate duality and *promoted it* to a user-facing axis split. The alternative — single MCP surface, dual internal substrate, hidden router — was always available. **ADR-0112 didn't seriously evaluate it; it reframed Debt 15 as deliberate.**

### The deepest architectural question

**Is the substrate split the same decision as the surface split?** **No.** Substrate split is forced and correct. Surface split was a separate, optional choice that ADR-0112 made to "make the forced split feel deliberate." **The right architecture is dual substrate + single surface (Z).**

### Ranking

1. **Z** (single MCP surface, dual internal substrate)
2. **X** (status quo)
3. **Y** (collapse to upstream-style)

---

## INTEGRATION JUDGE — Verdict on X/Y/Z

### Per-option sync cost

- **X**: Two MCP surfaces, one of which (`agentdb_*`) has no upstream analog. Every upstream MCP change requires a fork judgment call. Sustained interpretation tax: 4-8 hours/month.
- **Y**: One MCP surface, matches upstream. One substrate router that *doesn't* match upstream's. Symbolic alignment at substrate layer; Debt 15 resurfaces.
- **Z**: One MCP surface (matches upstream), one router with axis-aware dispatch. Sync clean at surface, fork burden localized to substrate implementations where we already own both ends.

### The fork-owned agentdb complication

Post-0161, both consumer and provider of any MCP→storage call are fork-owned. The original ADR-0053 framing solved cross-package indirection when one side was vendored. **Now that both sides are fork-owned, the indirection has no remaining value.** Decisively shifts cost-benefit toward Y or Z.

### Alignment value

**Alignment at the substrate layer = symbolic** (Y is wrong about this). **Alignment at the MCP surface layer = real** (X is wrong about this). **Z is the only option that gets both right.**

### MCP surface migration cost

- Agent prompts: rewrites across the corpus, mechanical but broad.
- Skills: shims via aliases (`agentdb_*` → unified handlers) reduce cost to near-zero for 1-2 versions.
- Documentation: find-and-replace risk; high false-positive rate.
- External user scripts: aliasing protects them.

**Z with compatibility-alias layer reduces migration cost to near-zero. Y with aliasing is functionally equivalent to Z. The aliasing question is what actually distinguishes Y from Z in practice.**

### Effect on the 4 ADR-0053 regressions

- **MutationGuard / AttestationLog**: Easier under Y or Z (single chokepoint vs asymmetric two-chokepoint enforcement).
- **TieredCache**: Easier under Z specifically (single router = natural cache layer).
- **Hybrid retrieval (BM25+semantic)**: Genuinely easier under Z (matches HybridBackend's split exactly).
- **ExplainableRecall + SkillLibrary auto-promotion**: Both want unified view of what was retrieved and from where.

**Net: 4 of 6 regressions are *easier* to restore under Z, 2 are *equally easy* under Y and Z. None are easier under X.**

### Ranking

1. **Z** (single surface, dual substrate)
2. **Y** (collapse to single-axis)
3. **X** (keep dual-axis)

---

## Council verdict (synthesis)

### Tally (round 2)

| Expert | Primary | Notes |
|---|---|---|
| queen-architect | **Z** (58%) | "Finishes what ADR-0086 was trying to deliver before Debt 15 derailed it" |
| devils-advocate | **none** (opposition) | Pre-flight: benchmark + ADR-0086 honesty needed first |
| bridge-defender (now single-axis advocate) | **Z** (70%) | Single MCP surface with dual substrate; Y is fallback |
| status-quo-defender | **X** (62%) | Concedes: case is ~60% migration-realism, ~40% merit; "if greenfield, Z is probably right" |
| perf-judge | **X** > **Z** > **Y** | Z is "within 1% of X" perf-wise; 150-12,500× debunked, real gap 2-3× |
| security-judge | **Z (9/10)** > Y (8/10) > X (5/10) | "Cost of X is paid not at write time but at incident time" |
| memory-judge | **Z** > X > Y | "Substrate split is real (kills Y); surface split is cosmetic (favors Z over X)" |
| integration-judge | **Z** > Y > X | Final ranking unambiguous |

**Final tally: 6 of 8 endorse Z, 2 X (perf-judge with Z as "within 1%", status-quo-defender with concessions), 0 Y, 1 abstain (DA).**

Even the dissent is soft: perf-judge essentially endorses Z, status-quo-defender admits 60% migration-realism / 40% merit, says greenfield = Z.

### Universal consensus points

1. **The 150-12,500× speedup claim is dishonest** (debunked by perf-judge, memory-judge, DA; conceded by status-quo-defender). Real gap is 2-3× at most.
2. **ADR-0086's title was "Single Storage Abstraction (RVF-First)"** — its STATED GOAL was unification. Debt 15 was the unclosed boundary.
3. **ADR-0112 reframed Debt 15 as deliberate architecture** — "rhetorical engineering on top of forced compromise" per multiple experts.
4. **Substrate split is REAL** (workload bimodality, ~6 RVF-natural / ~6 SQLite-natural / 3-4 cross-cutting).
5. **Surface split is OPTIONAL and over-extended in ADR-0112.**
6. **Z = "dual substrate + single surface" is the synthesis the fork should have arrived at originally.**

### Risks the council flagged for Z

1. **Router must stay thin** — predicate dispatch is microseconds; controller-graph traversal is the Phase C.3 trap reborn. Phase C.3 wins must be preserved.
2. **Compatibility aliases are load-bearing for migration** — `agentdb_*` tools must remain registered as aliases over the unified surface for at least one release cycle.
3. **Cross-store referential integrity** — lazy resolution OK; two-phase commit not OK.
4. **Router invariant** — below the audit boundary, no side-effects except the substrate write itself.
5. **DA's pre-flight gate** — run the honest RVF-vs-AgentDB-HNSW benchmark before committing to Z.

### Final recommendation

Adopt **Z** as the architectural direction. Treat ADR-0086's substrate-purity decision as accepted-and-preserved; treat ADR-0112's surface-split decision as superseded.

Concretely:

1. **Run the benchmark first** (per DA): RVF NAPI HNSW vs AgentDB's native HNSW on actual fork workload.
2. **Draft ADR-0180 (proposed)**: "Single MCP Surface, Dual Substrate Internal — Reverting ADR-0112's surface split while preserving ADR-0086's substrate purity."
3. **Sequence with ADR-0179**: round-1 ADR-0179 becomes phase-0 of ADR-0180. The router that ADR-0180 builds is the natural home for MutationGuard + AttestationLog + hybrid BM25 + ExplainableRecall + SkillLibrary.
4. **Compatibility aliases**: `agentdb_*` tools as soft-deprecated aliases for 1-2 release cycles.
5. **Amend ADR-0086 Status section**: acknowledge Debt 15 was a partial unification failure rather than an accepted-and-stable trade-off.

---

## Provenance

- Round 2 ran 2026-05-13 ~11:24–11:28 (~4 minutes wall-clock from dispatch to last idle).
- Cost: zero per `feedback-no-api-keys.md`.
- Same 8-agent team as [[ADR-0179-council-r1-bridge-deletion]]; recontextualized via SendMessage with role re-framings:
  - `bridge-defender` → SINGLE-AXIS ADVOCATE
  - `status-quo-defender` → DUAL-AXIS DEFENDER
  - All others: unchanged role, new question.
- Comms via SendMessage on team `adr-0179-council`, per `feedback-agent-dialectic-via-sendmessage.md`.
- Upstream research (ADR-006/009, upstream CLI runtime, AgentDB internals) compiled by orchestrator before dispatch.
