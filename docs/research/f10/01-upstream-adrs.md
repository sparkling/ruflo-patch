# F10 Facet — Upstream ADRs: Intention & Direction on Automatic Learning Capture

**Question under investigation (F10):** *Should* the learning substrate auto-capture
episodes/trajectories/SONA-adaptation during normal Claude Code operation? This facet
answers: **what does UPSTREAM (ruvnet) INTEND, and which DIRECTION is it heading?**

**Scope note:** stated intent / roadmap from ADRs, not current code (a sibling agent
covers current upstream code).

---

## origin/main freshness (recorded per the brief)

| Repo (fork dir) | upstream package | origin/main HEAD | date |
|---|---|---|---|
| `forks/ruflo` | **`claude-flow`** (author `ruv <ruv@ruv.net>`) | `844f68dbe` | **2026-06-02** |
| `forks/agentdb` | `agentdb` | `648e502` | **2026-05-29** |
| `forks/agentic-flow` | `agentic-flow` | `6a068546` | **2026-05-23** |

> Provenance check: `forks/ruflo` origin/main `package.json` `"name": "claude-flow"`,
> author `RuvNet <ruv@ruv.net>`. The "Ruflo" branding in its docs is **upstream ruv's
> own** rebrand — these are genuine upstream intent, not fork edits. ADRs cited from
> `forks/ruflo:v3/docs/adr/*` and `forks/ruflo:ruflo/docs/adr/*` are upstream claude-flow ADRs.

### Where upstream ADR corpora actually live (discovery result)

- **claude-flow (the Claude-Code product)** — `v3/docs/adr/ADR-074…ADR-131` (the
  self-learning hardening cluster lives here) + `ruflo/docs/adr/ADR-001…ADR-038`
  (chat-UI / autopilot) + `docs/IMPROVEMENT-ROADMAP.md`. **174 ADR files total.**
  *The earlier "ruflo has no ADRs" impression was because they sit under `v3/` and
  `ruflo/`, not top-level `docs/`.*
- **agentdb** — `docs/adrs/ADR-002…ADR-010` (the @ruvector self-learning pipeline) +
  `docs/ADR-073-sota-roadmap…` (most recent).
- **agentic-flow** — only `docs/adr/ADR-071/072` (ruvector reviews); its learning
  material is design/plan docs under `docs/features/{reasoningbank,agentdb}` and
  `docs/integration/sona`, **not** ADRs.

---

## VERDICT (one line)

**Upstream's intended end-state IS automatic capture during normal operation — but it
is being reached incrementally and is, as of the latest decisions (2026-05-30), only
PARTIALLY wired. The two seams that matter for Claude-Code operation — (a) wiring
`post-edit`/`post-command` hooks into the trajectory pipeline, and (b) a scheduled
background consolidation worker — are EXPLICITLY ACKNOWLEDGED AS INTENDED yet
DELIBERATELY DEFERRED as open "design calls." So today's manual/explicit-call-only
behaviour is a way-station, not the destination.**

Confidence: **High** for "intends auto-capture and has deferred the hook/worker seams";
**Medium** for the precise seam choice (upstream itself flags it as an unmade design call).

---

## Q1 — Does upstream INTEND auto-capture, or is explicit-call-only deliberate?

**Intends auto-capture; explicit-call-only is a transitional state, not the design goal.**

The decisive evidence is the **self-learning hardening cluster** in claude-flow
(`v3/docs/adr/`), all **Accepted + Implemented**, all dated **2026-05-30**, tracking
issue [#2245]:

- **ADR-074 — Self-Learning Wiring (#2245)** — *Status: Accepted, Implemented in ruflo
  3.10.14, 2026-05-30.* This ADR exists **specifically because** "the self-learning
  subsystem **reports success but persists nothing queryable**." It wired
  `hooks_task-completed {trainPatterns:true}` into the real `recordTrajectory()` path so
  "Agents that use this hook for completion-driven learning **actually train the
  model**." → Upstream is actively closing the gap between "advertised auto-learning"
  and "real auto-learning." It treats automatic, hook-driven capture as the **goal**,
  and the prior no-op as a **bug** ("convenience surfaces advertise capabilities they
  never actually invoke").

- The single clearest statement of intent-vs-deferral, ADR-074 §"Deliberately NOT in
  this round" (lines 72, 74):
  > "- **Wire `post-edit` / `post-command`** to feed the trajectory pipeline — design
  > call (which store wins).
  > - **Schedule consolidation worker** — background NightlyLearner instead of
  > on-demand only."

  These read as *planned-but-not-yet-done*, not *rejected*. The intent is auto-capture;
  the blocker is an unmade design decision ("which store wins").

- **ADR-075 — Unified Learning Stats** reiterates the same deferral (line 69):
  > "Wiring `post-edit` / `post-command` to feed the trajectory pipeline. **Tracked as
  > round B of the post-ADR-074 work.**"
  "Round B" = scheduled, not abandoned.

**Counter-signal (the manual side), and why it does not change the verdict:** the two
*most recent* upstream decisions both **chose manual/on-demand for now**:
- **agentdb ADR-073** (Accepted 2026-05-29) ships `consolidate_now` as an "**on-demand**
  wrapper around `NightlyLearner.run()`" and puts "**Background consolidation worker
  (4–6 wk) — full cron/budget version of #7**" in "**Deliberately NOT in this round.**"
- **claude-flow ADR-077** (Accepted 2026-05-30) declines auto-running pretrain:
  > "Auto-running pretrain at `init` time — **opt-in** via the script keeps `init`
  > fast and avoids unexpected GitHub API calls."

Read together with ADR-074/075, the pattern is **"intend auto, ship manual first, wire
auto incrementally once the design call is made"** — explicit-call-only is a *staging*
choice driven by (i) an unresolved store-ownership design question and (ii) honesty/CI
discipline (don't ship an auto path until it's measured), **not** a principled rejection
of auto-capture.

---

## Q2 — Which upstream ADRs cover each capture concern?

| Concern (F10 brief) | Upstream ADR(s) | Repo / path | What it says |
|---|---|---|---|
| **Hooks capturing outcomes** (the one path that *does* work) | **ADR-074** | claude-flow `v3/docs/adr/ADR-074-self-learning-wiring-2245.md` | Wires `hooks_task-completed{trainPatterns:true}` → `recordTrajectory()`. Names the working path: "`hooks_intelligence_trajectory-start → -step → -end`." |
| **post-task / completion capture** | **ADR-074 §1** | same | `hooks_task-completed` synthesises a one-step trajectory and feeds the pipeline. |
| **post-edit / post-command capture** | **ADR-074 (deferred), ADR-075 (deferred → "round B")** | claude-flow | Explicitly **intended but not yet wired**; open "design call (which store wins)." |
| **session-end / Stop capture** | *(none found)* | — | No upstream ADR wires a session-end or Stop hook to learning capture. Closest is the persistence-restart fix (ADR-074 item 4) so restarts don't *zero* history. |
| **ReasoningBank auto-population** | **agentdb ADR-006** (Proposed); design docs `agentic-flow/docs/features/reasoningbank/*` (PLANNING) | agentdb / agentic-flow | ADR-006's `KnowledgeCompiler`/`ReasoningBank.patternsLearned` populate from the solver's `train()` loop on every search — but ADR-006 is **Proposed**, unbuilt. The agentic-flow ReasoningBank integration plan is explicitly "**PLANNING (DO NOT IMPLEMENT)**." |
| **SONA adaptation triggers** | **agentdb ADR-002/005/006/007/008** | agentdb `docs/adrs/` | Trigger described as background `tick()` / `forceLearn()` on a configurable interval, plus per-search `recordTrajectory()`. ADR-005 = Accepted (components only). ADR-006/007(Ph2-5)/008 = **Proposed**. |
| **NightlyLearner scheduling** | **agentdb ADR-003 (mentions), ADR-073 (defers), claude-flow ADR-074/075 (defers)** | agentdb / claude-flow | NightlyLearner exists (branch→consolidate→verify→promote, ADR-003) but its **scheduling** is the deferred "background worker." ADR-073 ships only `consolidate_now` (manual). |
| **Trajectory capture** | **ADR-074** (claude-flow) + **agentdb ADR-002/005/007/008** | both | claude-flow: trajectory pipeline reachable via hooks. agentdb: per-search `beginTrajectory/addStep/endTrajectory` inside the backend (Proposed). |
| **RvfLearningStore / RVF native backend** | **agentdb ADR-003** ("ADR-057" in our notes ↔ upstream RVF integration) + **ADR-006** | agentdb `docs/adrs/ADR-003-…`, `ADR-006-…` | RVF format + the "unified self-learning RVF integration" that would make every search/insert self-learning. ADR-003 Accepted; ADR-006 Proposed. *(No upstream file literally named "ADR-057"; the RVF-native-backend decision is ADR-003 in agentdb.)* |
| **MemoryConsolidator / unified MemoryService** | **agentdb ADR-006 (unified self-learning); ADR-073 §B #7 (`consolidate_now`)**; claude-flow **ADR-075** (unified *stats*) | agentdb / claude-flow | "Unified" appears as (a) unified self-learning RVF (ADR-006, Proposed) and (b) unified learning **stats** aggregator (ADR-075, Accepted). The consolidation *worker* is deferred. *(No file literally "ADR-006 unified MemoryService" / "ADR-125" on upstream; these our-notes ids map to agentdb ADR-006 + claude-flow ADR-075.)* |
| **Autopilot event bus** | **ADR-037 — Autopilot Chat Mode** (Accepted 2026-03-05) | claude-flow `ruflo/docs/adr/ADR-037-AUTOPILOT-CHAT-MODE.md` | Autopilot is an **auto-continue / parallel-task UI** concept (web workers, RuVector WASM) for the HF Chat UI — it is **not** described as a learning-capture event bus. No upstream ADR ties an autopilot event bus to `_attachLearningSubscriber`/LearningSystem capture. |

**Notable absences (verified):** no upstream ADR — in any of the three repos — describes
a **session-end / Stop hook** capturing learning, nor an **autopilot event bus that
subscribes the LearningSystem** for auto-capture. A whole-tree grep of ADR bodies for
`session-end|Stop event|event bus.*learn|_attachLearningSubscriber|LearningSubscriber`
returned nothing. (`autopilot` only matches ADR-037's UI concept.)

---

## Q3 — Building TOWARD auto-capture, or deliberately manual? (with quotes)

**Building toward auto-capture, via a disciplined "honest wiring then incremental
automation" program — currently shipping manual defaults as the safe interim.**

Evidence it is building TOWARD auto:
- ADR-074 frames the no-op stubs as a **defect to fix**, not a design:
  > "A real engine exists; **convenience surfaces advertise capabilities they never
  > actually invoke.**"
  …and the fix makes the hook actually train: "Agents that use this hook for
  completion-driven learning **actually train the model.**"
- The cluster is an explicit multi-round program (#2245 → ADR-074 → 075 → 076 → 077 →
  078, all 2026-05-30), each round adding *real* learning behaviour (wiring → unified
  stats → distillation → pretrain-seed → hybrid-retrieval+outcome-signal). ADR-077:
  > "a way for a fresh ruflo install to start with a **non-empty** learning state … the
  > system was honest but **useless until many sessions had accumulated.**"
  → upstream's *problem statement* is "learning isn't happening enough automatically,"
  and each round increases automatic signal capture.
- claude-flow `docs/IMPROVEMENT-ROADMAP.md` (authored by `ruv`, 2026-05-24, under
  "#ADR-130 … improvement roadmap") treats the trajectory→DISTILL→SONA loop as an
  **existing premise** and only flags the *artifact-emission* gap:
  > "Ruflo's DISTILL step extracts key learnings from successful trajectories as
  > internal SONA patterns … The DISTILL step **already exists**
  > (`hooks_intelligence_trajectory-end`); the missing piece is a `skills/` file
  > emitter." (ADR-113 R-3, rated P1.)

Evidence it ships manual FOR NOW (the deliberate-interim quotes):
- agentdb ADR-073 §B: `consolidate_now` = "**on-demand** wrapper"; "Background
  consolidation worker … **stays in #6**" / "**Deliberately NOT in this round.**"
- claude-flow ADR-074 §"Deliberately NOT": "Wire `post-edit`/`post-command` … — **design
  call**"; "**Schedule consolidation worker** — background NightlyLearner instead of
  **on-demand only**."
- claude-flow ADR-077 §"Deliberately NOT": "Auto-running pretrain at `init` time —
  **opt-in** via the script."

The throughline: **the destination is auto; the current release cadence ships manual/
on-demand defaults until each auto seam is (i) given a store-ownership design decision
and (ii) backed by a measured regression test** (every cluster ADR ships a benchmark +
CI gate — auto paths are not enabled until proven).

---

## Q4 — If upstream intends auto-capture, what seam does it describe?

Upstream describes **two distinct seams at two layers**; they are complementary, not
competing:

1. **Hook-driven capture (the Claude-Code-operation seam — the one F10 is about).**
   - **Working today:** `hooks_intelligence_trajectory-start/-step/-end` → `recordTrajectory()`
     in claude-flow `intelligence.ts` (ADR-074 names this "the one path that actually
     works"). And, per ADR-074 §1, `hooks_task-completed{trainPatterns:true}` now feeds
     the same `recordTrajectory()` helper.
   - **Intended-next (deferred):** wire **`post-edit` / `post-command`** hooks to feed
     the same trajectory pipeline (ADR-074 §"Deliberately NOT"; ADR-075 "round B"). The
     unmade decision is **"which store wins"** (globalStats vs sonaCoordinator vs
     memory-bridge vs neural store — the four aggregators ADR-075 is unifying). ADR-074
     also notes "Wire MCP trajectory-end to `globalStats` too — currently feeds
     `sonaCoordinator` only," i.e. the capture sinks are not yet unified.
   - **Seed seam (shipped, opt-in):** `scripts/pretrain-from-github.mjs` (ADR-077/078)
     replays git commits + GH issues through the *same* `recordTrajectory()` path
     (commits=`success`, reverted/hotfixed=`partial`) — a one-shot harvester, not
     continuous capture, but proof upstream routes seed signal through the real pipeline.

2. **Backend-internal capture (the agentdb library seam — NOT a Claude-Code hook).**
   - `SelfLearningRvfBackend` (agentdb **ADR-006**, Proposed) wraps `RvfBackend` so that
     **every `searchAsync`/`insertAsync`** does enhance → search → `beginTrajectory`/
     `addStep`, with `feedback(quality)` ending the trajectory; a background `tick()`
     (default 5 s) runs SONA + contrastive + `RvfSolver.train()`. Config default
     `learning?: boolean` = **`true`**. ADR-008 (Proposed) states the intent verbatim:
     > "Each conversation turn improves future search quality, response routing, and
     > compression decisions — **automatically, with no manual intervention.**"
   - **Status caveat:** this seam is in **Proposed** ADRs (006, 007-phases-2-5, 008).
     ADR-005 (Accepted) built only the *standalone* components; ADR-006's own Context
     says "**None of these components are imported or invoked by `RvfBackend.ts`.**"
     So the "auto on every op" seam is **designed and intended but unratified/unbuilt**
     at the library layer.

**For the F10 decision specifically:** upstream's intended seam for *normal Claude-Code
operation* is **#1 — hook-driven trajectory capture**, extended from the
already-working `trajectory-*`/`task-completed` hooks to `post-edit`/`post-command`
(and, implicitly, the natural next step, a session-end/Stop sink — though upstream has
**not** written that ADR). The blocker upstream names is **store unification** (resolved
incrementally by ADR-075), after which the post-edit/post-command wiring ("round B") is
the next intended increment. The agentdb backend-internal seam (#2) is a deeper,
library-level auto-capture upstream also intends, but it lives in *Proposed* ADRs.

---

## Load-bearing citations (for the parent agent)

1. **claude-flow ADR-074** (`forks/ruflo:v3/docs/adr/ADR-074-self-learning-wiring-2245.md`,
   Accepted, Implemented 3.10.14, **2026-05-30**) — wires hooks into real trajectory
   capture; §"Deliberately NOT" defers `post-edit`/`post-command` wiring + scheduled
   consolidation worker as **open design calls**. *The single most decisive doc.*
2. **claude-flow ADR-075** (`…:v3/docs/adr/ADR-075-unified-learning-stats.md`, Accepted,
   **2026-05-30**) — unifies the 4 stat aggregators (the "which store wins" blocker);
   re-confirms post-edit/post-command as "**round B**."
3. **agentdb ADR-073** (`forks/agentdb:docs/ADR-073-sota-roadmap-and-this-release.md`,
   Accepted alpha.16, **2026-05-29**) — ships `consolidate_now` (**on-demand**) and puts
   the **background consolidation worker** in "Deliberately NOT in this round."
4. **agentdb ADR-006** (`forks/agentdb:docs/adrs/ADR-006-unified-self-learning-rvf-integration.md`,
   **Proposed**, 2026-02-17) — the library-layer "auto-capture on every search/insert"
   design (`learning` default `true`); Context admits the components are not yet invoked
   by `RvfBackend`.
5. **claude-flow ADR-077** (`…:v3/docs/adr/ADR-077-pretrain-from-history.md`, Accepted
   3.10.17, **2026-05-30**) — chooses **opt-in** pretrain over auto-run-at-init; proves
   seed signal flows through the *real* `recordTrajectory()` path.

Supporting: agentdb ADR-005 (Accepted — standalone components only); agentdb ADR-008
(Proposed — "automatically, with no manual intervention"); claude-flow ADR-037
(Autopilot = UI auto-continue, **not** a learning event bus); claude-flow
`docs/IMPROVEMENT-ROADMAP.md` (ruv, 2026-05-24 — treats trajectory-end DISTILL as
already-existing, flags only skill-file emission).

---

## Caveats / could-not-determine

- **Our-notes ADR ids don't all map 1:1 to upstream filenames.** The brief's "ADR-057
  (RVF native / RvfLearningStore)", "ADR-006/ADR-125 (unified MemoryService /
  MemoryConsolidator)", "ADR-100 (cli-core)", "ADR-094" appear to be **fork/our-corpus
  numbering**. On upstream origin/main: RVF-native = **agentdb ADR-003**; unified
  self-learning = **agentdb ADR-006**; unified *stats* = **claude-flow ADR-075**;
  cli-core split = **claude-flow ADR-100** (`v3/docs/adr/ADR-100-cli-core-split-lazy-load.md`,
  exists); `agentdb ADR-094` = Xenova→HF migration (claude-flow side) / not a learning
  ADR. I verified the *concepts* on upstream; I could **not** confirm a literal
  `ADR-057` file anywhere on the three origin/mains.
- **agentic-flow is the stalest origin/main (2026-05-23)** and carries no learning ADRs
  (only design/PLANNING docs, several marked "DO NOT IMPLEMENT" and dated 2025-10). I
  treated those as *historical design context*, not current intent. The current intent
  signal lives in **claude-flow** (2026-06-02 HEAD) and **agentdb** (2026-05-29).
- **No session-end/Stop-hook capture ADR exists upstream.** I can confirm its *absence*
  but cannot say whether upstream considers it in-scope-but-unwritten or out-of-scope;
  the deferral language only enumerates `post-edit`/`post-command` + the consolidation
  worker.
- I did **not** open the agentdb GitHub tracking issues (#6) or claude-flow #2245/#2241
  bodies (no network use); the ADRs summarise them, but the issues may carry finer
  roadmap detail than the ADR "Deliberately NOT" sections.
