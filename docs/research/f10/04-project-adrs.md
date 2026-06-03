# F10 Facet 4 — What has the ruflo-patch ADR corpus already decided / intended about automatic learning capture?

> Read-only investigation, 2026-06-03. Cites ADR id + section for every claim.
> Scope: the 4-digit ruflo-patch ADRs in `docs/adr/`, cross-checked against live fork
> source under `/Users/henrik/source/forks/{agentic-flow,ruflo}`.

---

## 1. Has the project EVER decided for-or-against automatic learning capture?

**No ADR has ever made an explicit decision about whether normal Claude Code operation
should auto-capture learning.** There is no "capture seam" ADR, no PostTask/Stop-hook
episode-emission decision, and no deferred/dormant "we'll wire capture later" record.

What the corpus has instead is a **cluster of ADRs that silently ASSUMED the episode
stream is being fed**, then built consumers on top of it. Each names a producer that, in
normal operation, is never invoked. F10 is the first record to surface that the substrate
is dormant-by-design. The decisive ADRs:

| ADR | What it ASSUMED about capture | Reality (F10 + source trace) |
|---|---|---|
| **ADR-0193** §"Outstanding items" Item B/C + Verification matrix | The autopilot Stop hook drives trajectory recording (`recordIterationStep` + `endSwarmTrajectory`) and the Stop hook consumes re-engagement context after **"populating episodes"**. | The Stop hook `autopilot-hook.mjs` only **consumes** (`getReEngagementContext`, `getMetrics` — lines 222/225). It calls **no** producer. Episodes are produced only by `AutopilotLearning.recordTaskCompletion`, reachable solely from `swarm-completion.ts`, `autopilot-tools.ts` (MCP), `autopilot-cli.ts` — none on a hook path. |
| **ADR-0195** Decision Outcome + §"Contract between controllers" | `AutopilotLearning._record → storeEpisode → learningEvents.emit('episode:recorded') → LearningSystem.submitFeedback`. A LearningSystem subscriber attaches at AgentDBService boot. | The **subscriber** attaches at boot (`agentdb-service.ts:450 _attachLearningSubscriber()`), but the **emitter** (`new AutopilotLearning`) is only constructed per explicit CLI/MCP/swarm-completion call. In normal ops the producer never instantiates → the bus never emits → the subscriber starves. ADR-0195 is the **subscriber half**; the emitter exists but has no automatic caller. |
| **ADR-0197** Finding "Phase 5 substrate" (line 117) | "Episodes already flow into `SyncCoordinator.detectChanges()` via the SQL `episodes` table that `AutopilotLearning._record` writes to." | Same false premise: `_record` is not called in normal ops, so nothing flows. |
| **ADR-0277** §"Corrected closure map" row "Episode producer-input = WIRED live" | `hooks-tools.ts:1762 → ReflexionMemory.storeEpisode` is a **wired live** producer input. | That is the **`agentdb_reflexion-store` MCP tool handler** — a tool the model must *deliberately call*; it is not on a hook. ADR-0287 F10's live test drove it once and moved `episodes 0→1`, proving it is the only thing that writes episodes, and only on explicit call. |
| **ADR-0279** §"Rules" R3 (producer) | "The **post-task hook** (`hooks_post-task → agentdb_reflexion-store`) records `action = (model) ?? (agent)`." | **This is the closest the corpus comes to naming an auto-capture seam — and it does not exist.** There is no PostTask hook that emits `agentdb_reflexion-store`. `hooks_post-task` is an MCP tool, not a registered Claude Code hook that fires per task. ADR-0279's own Consequences (Bad) hedge: "capture depends on producers passing the model/agent … capture improves as producers adopt it" — i.e. it *assumed adoption that never happened*. |
| **ADR-0280** R2 (producer) | `routeLearningOp('run')` persists `action-values.json` after `NightlyLearner.run()`; the blend "self-activates exactly when there is signal." | The blend is correctly **self-inert with no data** (R5). But "signal" presupposes episodes, which presuppose capture. So ADR-0280's de-confounding self-activation is permanently inert in normal ops — *correct-by-construction, starved-in-practice*. |

**Net decided-position:** the project decided, repeatedly and implicitly (ADR-0277/0279/0280
under the ADR-0177 *implement-ahead* posture), to **build the consume side ahead of a
producer**, on the stated belief that a hook-driven producer either existed (ADR-0193/0197)
or would be adopted (ADR-0279 R3). **No ADR ever decided to build that producer.** F10 is the
first to name the absence. The implicit posture is "implement-ahead" (`feedback-no-consumer-is-not-stub`,
ADR-0177) — but ADR-0177 governs *consumers* waiting on built capability; here the **producer**
is the missing wire, which inverts the usual implement-ahead shape (capability built, consumer
waits → here: consumers built, the capture *input* never wired).

---

## 2. Consumer → starved-by-F10 map

Every shipped feature below is **live code** (built, tested, on a worker/tool/bus) whose input
is the `episodes`/`sona_trajectories`/`lastAdaptation` substrate that F10 shows is empty in
normal operation. "Starved" = runs faithfully, finds nothing.

| Consumer (shipped feature) | ADR | Wired state | Starved by F10? | Evidence |
|---|---|---|---|---|
| **NightlyLearner** (causal uplift engine → `causal_edges`) | ADR-0277 I1/I2 | **LIVE + scheduled.** `worker-daemon.ts:164` `learn` row `enabled:true`, 60-min, → `runLearnWorker → routeLearningOp({type:'run'})` → real NightlyLearner (`memory-router.ts:139`). | **YES — the single most-starved consumer.** Runs every 60 min, finds **0 episodes** → no edges discovered → `causal_edges` (live count 910) holds only *ADR-index* edges, never *learned* uplift. ADR-0287 F10: "the `learn` worker finds 0 episodes." |
| **Action-value substrate** `E[reward\|action,task_type]` | ADR-0279 R4 + ADR-0280 R1/R2 | **LIVE.** `NightlyLearner.computeActionValues()` → `.swarm/action-values.json` via `routeLearningOp('run')`. | **YES.** No episodes → no action rows → `action-values.json` is the only RL sidecar ever written (per ADR-0287 storage inventory, `action-values` "live (T2)") but holds nothing learned; the file's *existence* is the smoke that passed, not real uplift. |
| **Default-routing de-confounding blend** (`LocalReasoningBank` rerank β=0.2 + ModelRouter γ=0.3) | ADR-0280 R3/R4/R5 | **LIVE, ON by default, self-inert.** | **YES (silently).** Self-inert with no data (R5) → in normal ops it is *permanently* a no-op; routing stays cosine-only/prior-only forever. This is the ADR's *intended* fail-safe, but it means the headline feature ("routing de-confounds") never activates. |
| **ModelRouter contextual A-coupling** | ADR-0280 R4 (depends ADR-0278) | LIVE, γ-blended. | **YES.** Same starvation as above. |
| **LearningSystem** (9 RL algos, `learning_experiences`/`learning_policies`) | ADR-0195 P4.2 | **Subscriber LIVE at boot** (`_attachLearningSubscriber`), Q-update path built. | **YES.** Emitter (`AutopilotLearning`) never instantiates in normal ops → `episode:recorded` never fires → `learning_experiences` stays 0 → Q-tables never update. ADR-0287 F10: every learning table = 0. |
| **SONA adaptation** (`lastAdaptation`, `trajectoriesRecorded`) | ADR-0193 Item B; writer = `cli/src/memory/intelligence.ts` via `ruflo neural` CLI | Writer LIVE but **CLI-only**. | **YES.** `lastAdaptation` frozen 2026-04-04; `trajectoriesRecorded` frozen at 715. Only the `ruflo neural` subcommand writes it; nothing auto-calls it (ADR-0287 F10 trajectory-capture trace). |
| **MemoryConsolidator** (runtime entry-consolidation) | upstream agentdb ADR-125 (NOT fork ADR-0125 — see Caveats); referenced in ADR-0287 §F11 + ADR-0277 closure map (`controller-registry.ts:1692`) | **LIVE** (consolidate worker + `agentdb_consolidate`). | **PARTIALLY.** The consolidate worker (`worker-daemon.ts:154`, 10-min) runs over *memory entries* (the 1,226-entry RVF corpus), so it is **not** episode-starved the way the learner is — it has real input. ADR-0287 §F11: "live in our fork … just starved (F10)" overstates; consolidation has the memory corpus to work on, only its *episode*-adjacent paths are dry. |
| **ReasoningBank** (`reasoning_patterns` / `LocalReasoningBank`) | ADR-0166 Phase-3 (Option F wiring); ADR-0280 R3 reuses `LocalReasoningBank` | **LIVE** (7 neural patterns, `LocalReasoningBank.findSimilar` on the hot path). | **MIXED.** The *retrieval* side is live (cosine recall works — F10 confirms memory_search at 0.59/0.91). The *uplift-rerank* side (ADR-0280 R3) is starved. The SQLite `reasoning_patterns` table = 0 (ADR-0287 F10) but the JSON pattern store (7 patterns) is populated — two independent surfaces (ADR-0287 F6). |
| **Autopilot re-engagement** (Stop-hook context inject) | ADR-0193 Item C | LIVE (Stop hook calls `getReEngagementContext`). | **YES, but by design** — the Stop hook *consumes* episodes; with 0 episodes its context is empty (silence-on-empty is the contract, ADR-0193 Verification matrix Item C: "Empty-context silence is contract"). Not a bug; just permanently empty in normal ops. |
| **SyncCoordinator / QUIC federation** | ADR-0197 line 117; ADR-0196 | Surface-built, transport-stubbed. | **YES** (compounded): it would sync episodes — but there are none, *and* no real transport. Double-dormant. |
| **ADR-0285 causal/recall surfaces** | ADR-0285 | Repaired + green. | **Indirectly.** ADR-0285 fixed the *plumbing* (causal CRUD, recall, purge) so the surfaces work; but the *learned* `causal_edges` they would rank over are never produced (the 910 edges are ADR-index, not learning). ADR-0285 §"More Information" line 209 explicitly cites ADR-0277/0279 as the loop it complements. |

**The most-starved consumer is NightlyLearner (ADR-0277):** it is the only consumer that is
*scheduled to run autonomously every 60 minutes* and *finds nothing every time*. Every other
consumer is either event-driven (never triggered) or self-inert (no-op without data); the
learner is the one that actively executes against an empty table on a timer, making its
starvation the cleanest evidence that the loop's input is unwired.

---

## 3. Is F10 the unfinished half of ADR-0195?

**Partly yes, but F10 is broader than ADR-0195.** ADR-0195 built a clean event bus with a
permanent **subscriber** (LearningSystem) and named **four emit points** on the producer
(`AutopilotLearning`). The emit points are implemented (ADR-0195 Implementation log commits
`3fa9ec9`/`d06ba2c`). What ADR-0195 never addressed — because ADR-0193 §G handed it only the
"cross-controller bridge" scope — is **who instantiates the producer in normal operation.**

- ADR-0195 §"Decision Drivers" explicitly frames the producer as *transient, per-CLI-call*:
  "AutopilotLearning is created lazily (autopilot-cli.ts:241-242 … autopilot-tools.ts:114-115,
  swarm-completion.ts:242-244) per invocation." So ADR-0195 **knew** the producer only exists
  per explicit invocation and designed the bus to tolerate that — but it took the *invocation
  itself* as a given upstream of its scope.
- Therefore **ADR-0195's emitter is wired but never auto-fired**, and F10 is the missing piece
  ADR-0195 assumed someone else would supply: an automatic *invocation* of a producer.

But F10 ≠ ADR-0195's unfinished half exactly, because F10 spans **three independent writers
with three separate stores** (ADR-0287 F10):
1. `episodes` ← `ReflexionMemory.storeEpisode` (the `agentdb_reflexion-store` tool) — ADR-0277/0279 path, *separate from* the ADR-0195 autopilot→`storeEpisode` path.
2. `sona_trajectories` ← `SonaTrajectoryService.recordTrajectory` (`agentdb_sona_trajectory_store`).
3. SONA `lastAdaptation` ← `intelligence.ts` via `ruflo neural` CLI.

ADR-0195 only touches writer #1's *autopilot* branch. The cleanest framing: **F10 is the
union of "no automatic producer-invocation" across ALL three writers; ADR-0195 finished the
bus for one of them but not its trigger.** A capture-wiring ADR is the proper home — it would
*complete* ADR-0195 (give the autopilot emitter an automatic caller) AND wire the ADR-0277/0279
`reflexion-store` path AND the SONA path. ADR-0287 §F10 disposition agrees: "its own ADR, not
a side-effect."

---

## 4. ADR-0287 F10 — exact current disposition + acceptance criterion

**Disposition** (ADR-0287 §Findings "F10 [HIGH-impact — dormant BY DESIGN, not gated by F3a/F1]"
+ backlog row + §Consequences):

- Severity **HIGH-impact**, but **dormant by design**, explicitly **NOT gated by F3a (router)
  or F1 (MCP cold-start)** — a correction of the earlier "F1+F3a-gated" claim (overturned by the
  2026-06-03 trajectory-capture trace, ADR-0287 Changelog).
- **Root cause:** "there is **no automatic episode/trajectory-capture caller in normal Claude
  Code operation.**" The three symptoms are three independent metrics with three separate writers,
  **none on any hook path** (file-based or MCP). The `hooks_intelligence_trajectory-*` MCP tools
  are `enabled:false`, write only RVF `trajectories` + `sona-patterns.json`, and have no automatic
  caller.
- **Live empirical proof** (this session, MCP connected, node 24): drove a full trajectory
  `start→step→end` + one `agentdb_reflexion-store`; after — `episodes 0→1` **only** from the
  reflexion-store call, `sona_trajectories` still 0, `lastAdaptation` still 2026-04-03,
  `trajectoriesRecorded` still 715.
- **The real next step = a wiring decision, its own ADR:** "emit an `agentdb_reflexion-store`
  (and/or `intelligence.recordTrajectory`) from a real PostTask/Stop hook so agent outcomes accrue
  episodes for the (live-but-idle) NightlyLearner." Backlog tier "own ADR (wiring decision)".
- **Stores are not broken and not starved-by-a-bug** — "dormant by design."

**Acceptance / "Confirmation" criterion** (ADR-0287 §Confirmation, F10 bullet — quoted exactly):

> **F10** — after the chosen **capture-wiring** lands (its own ADR — emit `agentdb_reflexion-store`
> / `intelligence.recordTrajectory` from a PostTask/Stop hook), **episodes accrue and
> `lastAdaptation` advances**. **Not** "after F3a + F1" — those gate nothing here.

And the embedded caveat (§Findings F10 close): "assert `episodes`/`lastAdaptation` advance **after
the chosen capture wiring**, NOT 'after F3a + F1'."

So the F10 acceptance bar a capture-wiring ADR must clear is: **with the new capture seam live and
no manual tool calls, the `episodes` table gains rows AND `neural/stats.json lastAdaptation`
advances past 2026-04-04** (and, to feed the most-starved consumer, the daemon `learn` worker then
discovers non-null `causal_edges` per ADR-0277 I3's smoke shape).

---

## 5. Constraints a capture-wiring ADR MUST respect (corpus-drawn checklist)

1. **No-fallbacks / fail-loud** (`feedback-no-fallbacks`, `feedback-best-effort-must-rethrow-fatals`;
   ADR-0287 Decision Drivers; ADR-0286 RVF fail-loud). A capture hook must NOT swallow a write
   failure to "keep the turn fast." Discriminated re-throw of data-integrity errors only (the
   ADR-0195 P4.4 / ADR-0287 R2 pattern: catch "store unavailable / schema-not-provisioned", re-throw
   the rest). A capture seam that silently drops on error would re-create exactly the dormant-but-
   green illusion F10 exposed.

2. **Router is the SINGLE write path** (ADR-0083 "Phase 5 — Single Data Flow Path", Decision line 165;
   `check_adr0083_no_dosync_drain` standing acceptance check; ADR-0287 T1). Episode capture that
   writes memory-adjacent state must route through `memory-router.ts` (`routeReflexionOp`/`routeLearningOp`),
   not a side-channel. ADR-0287 T1 shows the cost of ignoring this: the dead `doSync()` drain that
   ADR-0083 deleted must not be resurrected. A capture hook should emit through the existing
   `agentdb_reflexion-store` → `ReflexionMemory.storeEpisode` router leg, which is already the live,
   ADR-0083-compliant write path.

3. **RVF flock / single-write-path on the vector store** (ADR-0083 §lock model; ADR-0032; ADR-0284
   single-lock-collapse; ADR-0083 doubles-the-flock-surface warning quoted in ADR-0287 T1). Capture
   must not open a *new* RVF writer or a per-turn process that contends the `.swarm/*.rvf` flock.
   Episodes land in SQLite (`episodes` table), which sidesteps the RVF lock — but any embedding the
   capture computes (e.g. for `recallEpisodes` similarity) must reuse the existing archivist/router
   write path, not a parallel RVF handle.

4. **Embedding cost — mpnet-768 is the immovable, real embedder** (ADR-0068/0069 unified model;
   ADR-0287 F1 critique: "the embedder is immovable … no-fallbacks forbids degrading to hash
   embeddings"; `feedback-full-model-names`). If capture embeds episode subjects on a hook, it pays
   a real mpnet-768 forward per turn. The seam must be cheap: prefer storing the episode row
   *without* synchronous embedding (the NightlyLearner reads SQLite text, not vectors, for uplift —
   ADR-0277 `discoverCausalEdges` works on reward/ts pairs), deferring any embedding to the
   already-scheduled daemon worker. Do NOT add a per-turn 768-dim embed on the hot path.

5. **Anti-sprawl — no reflexive `swarm_init` / coordination ceremony** (ADR-0098 "Swarm-Init Sprawl";
   CLAUDE.md anti-sprawl rows; `feedback-no-hive-ceremony-for-impl`). The capture seam is a *hook
   emitting one tool call*, not a swarm. It must not spawn agents, init swarms, or stand up
   coordination to record an outcome. One PostTask/Stop hook → one `routeReflexionOp` write.

6. **PII / sensitive-content risk — NEW, ungoverned, must be addressed fresh.** No existing ADR
   governs what an episode capture writes. An `episodes` row carries `subject` (the task description),
   `action`, `reward`, `critique` — **the task subject and critique can contain user prompt content,
   file paths, secrets, or PII.** The corpus has the *mechanism* (`aidefence_has_pii` /
   `aidefence_scan` / `transfer_detect-pii` MCP tools; CLAUDE.md "validate user input at system
   boundaries", "sanitize file paths") but **no ADR has ever decided whether captured learning is
   scrubbed.** A capture-wiring ADR MUST decide: does the episode `subject`/`critique` get
   PII-screened/redacted before the SQLite write? This is the single biggest *new* design question
   F10's wiring opens — capture turns transient turn content into a *durable, embedded, cross-session*
   store (it feeds NightlyLearner → causal recall → routing, and potentially QUIC federation
   ADR-0196), so anything captured is durable and retrievable.

7. **Retention / cap** (ADR-0193 Item A.4: `EPISODE_CAP` default 10000, evict-oldest). Auto-capture
   makes the episodes table grow per turn rather than per explicit call; the existing cap exists but
   was calibrated for sparse explicit writes. A capture ADR should confirm the cap + eviction holds
   under per-turn write volume.

8. **Implement-ahead is satisfied on the consume side — don't rebuild it** (ADR-0177; ADR-0277/0279/0280
   all shipped under it). The consumers are DONE and starved. The ADR must scope itself to the
   *producer trigger only* (ADR-0287 F10 disposition), not re-touch NightlyLearner, the action-value
   blend, or the bus. ADR-0287 §"Track record" warning: several first-pass claims in that ADR were
   wrong — verify each consumer is actually live-and-starved (not absent) against current code before
   wiring.

9. **Wire the acceptance check into CICD** (`feedback-always-wire-tests-into-cicd`; ADR-0287 §Confirmation).
   The F10 smoke must land in `test-acceptance*.sh` (`run_check_bg` + `collect_parallel` spec) AND
   `.github/workflows/`, asserting episodes accrue + `lastAdaptation` advances **with no manual tool
   call** — i.e. it must drive the *hook*, not call `agentdb_reflexion-store` directly (that would
   re-test the already-working tool, not the new capture).

---

## Caveats / corrections to the briefing

- **ADR-0125 is NOT "MemoryConsolidator".** The briefing said "MemoryConsolidator (ADR-0125 if
  referenced)". Fork **ADR-0125** is *Hive-mind Queen-type runtime differentiation* (frontmatter
  `tags:[hive-mind,queen,prompt]`). The MemoryConsolidator citation in ADR-0287 §F11 ("`MemoryConsolidator`,
  ADR-125") refers to the **upstream** agentdb 3-digit `ADR-125`, not the fork's 4-digit ADR-0125
  (upstream = 3-digit, fork = 4-digit per ADR-0287 §Terminology). MemoryConsolidator's live wiring is
  in `controller-registry.ts:1692` (the consolidator-preference branch ADR-0277 I2 had to bypass).

- **ADR-0287 §F11's "MemoryConsolidator … just starved (F10)" overstates.** The consolidate worker
  runs over the 1,226-entry RVF *memory corpus*, which is populated — it is not episode-starved the
  way NightlyLearner is. Only its episode-adjacent paths are dry.

- **ADR-0166 is `superseded`** (its substrate decision by ADR-0170, then RVF-as-sole-truth landed
  anyway). Its *Phase-3 controller-wiring* (ReflexionMemory/LearningSystem/ReasoningBank mirroring) is
  the relevant live part for F10's consumers; the substrate-replacement framing is dead.

- **ADR-0279 R3 "post-task hook" is the corpus's only explicit auto-capture *claim*, and it is false.**
  This is the strongest single citation that the project *believed* it had auto-capture and didn't.
  Treat it as the keystone evidence, not a wiring that merely needs enabling — there is no
  `hooks_post-task`-registered Claude Code hook emitting `agentdb_reflexion-store`; `hooks_post-task`
  is an on-demand MCP tool.

- **Live-source verification done** (not prose-only): `autopilot-hook.mjs` consumes-only (lines 222/225);
  `recordTaskCompletion` callers = cli/tools/swarm-completion only; `_attachLearningSubscriber` attaches
  at `agentdb-service.ts:450` while `new AutopilotLearning` is cli/tools/swarm-completion only; the
  daemon `learn` worker is `enabled:true` at `worker-daemon.ts:164` → `routeLearningOp({type:'run'})`.
  All corroborate ADR-0287 F10.
