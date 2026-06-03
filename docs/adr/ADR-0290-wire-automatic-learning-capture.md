---
status: proposed
date: 2026-06-03
tags: [learning, hooks, capture, sona, autopilot, upstream-alignment, routing]
supersedes: []
depends-on: [ADR-0287, ADR-0280, ADR-0268, ADR-0195]
implements: []
---

# Wire automatic learning capture — fork hook → episode pipeline (extracted from ADR-0287 F10)

## Context and Problem Statement

The fork's learning/adaptation layer has been frozen since **2026-04-04** (ADR-0287 §F10): SONA `lastAdaptation`
stuck, the `learn` worker finds 0 episodes, every learning table empty. The diagnosis (ADR-0287 §F10, with live
proof) is **dormant by design** — there is **no automatic capture caller in normal Claude Code operation**. The
write chain is *already live* (`hooks_post-task → agentdb_reflexion_store → ReflexionMemory.storeEpisode →
episodes`, ADR-0268); **only the trigger is missing**: the live file-based hook
(`settings.json Task` matcher → `hook-handler.mjs post-task` → `intelligence.cjs.feedback()`) terminates in JSON
sidecars and never calls the capture. This ADR is the **actionable fix**, extracted from ADR-0287 §F10 into its
own record so the work can be planned and executed independently.

**Upstream intention is the guide (explicit constraint).** Upstream claude-flow **ADR-074** (self-learning-wiring,
#2245) already wired `hooks_task-completed → recordTrajectory()` and frames the prior no-op as a **bug**
("surfaces advertise capabilities they never invoke"). Its "Deliberately NOT in this round" list names exactly
our next steps — "wire post-edit/post-command to feed the trajectory pipeline (design call: *which store
wins*)" + "schedule the consolidation worker" — deferred pending the store-ownership question that **ADR-075**
(unified-learning-stats) resolves, and **ADR-077** seeds the same `recordTrajectory()` path via opt-in pretrain.
Upstream's direction is **honest-wiring → incremental-automation, each step behind a benchmark + CI gate**. We
adopt that posture verbatim: wire the hook to drive the capture, smallest step first, gated by an acceptance
benchmark, then extend incrementally toward upstream's post-edit/post-command + trajectory-pipeline end state.

**Decoupled from PII (ADR-0289).** Enabling learning needs **no PII handling**. The routing-learning signal is
the *structured* fields `action`/`reward`/`task_type`/`success` (NightlyLearner's `computeActionValues` reads
`E[reward | action, task_type]`); these carry no user content. The PII risk lives only in the *free-text* fields
(`task`/`input`/`output`/`code`/`critique`), which only *skill-consolidation* needs. So this ADR captures
**metadata-only** and **does not depend on ADR-0289**; ADR-0289 governs solely the *optional, later* free-text
capture. The two are independent.

## Decision Drivers

* **Upstream alignment (ADR-074).** Match upstream's "wire the hook to the capture pipeline" mechanism and its
  incremental, benchmark-gated cadence; track ADR-075's store-ownership resolution.
* **The write chain is already live (ADR-0268)** — this is a *trigger* wiring, not a new subsystem.
* **PII-free by construction** — metadata-only; no detector, nothing to leak (decoupled from ADR-0289).
* **No RVF-flock exposure** — episodes are the SQLite carve-out (`.swarm/memory.db`), not the `.jslock` surface
  ADR-0284 addressed.
* **No-fallbacks / fail-loud** — the capture is discriminating-non-fatal (logs, does not abort the hook), never
  swallow-to-stay-green.
* **Determinism** — a real hook fires every task, unlike a model-discretion MCP tool call.

## Considered Options

* **A — File-based PostTask hook → `ruflo hooks post-task` (seam a).** The live `Task`-matcher hook additionally
  invokes the existing CLI, which already writes the episode. Cheapest; directly mirrors upstream ADR-074's
  "hook → pipeline." **Chosen for Phase 1.**
* **B — Autopilot event-bus emitter.** Wire `recordTaskCompletion` so `_attachLearningSubscriber` fires.
  Rejected: the emitter has no live caller, lives in an optionalDep loaded per-call, and the file hook runs in a
  separate short-lived process that cannot reach the in-process bus (ADR-0287 §F10; agentic-flow `AgentDBService`
  is itself a retirement candidate per ADR-0288).
* **C — Model-instructed `hooks_post-task` MCP call.** Rejected — non-deterministic (depends on model compliance);
  not a code seam.
* **D — Full upstream parity (round B).** Additionally wire post-edit/post-command → trajectory pipeline and the
  SONA `recordTrajectory()` path (advancing `lastAdaptation`). The intended end state; **Phase 2**, after Phase 1
  is benchmark-green and ADR-075's store-ownership question is settled.

## Decision Outcome

**Chosen: Option A as Phase 1 (metadata-only episode capture), then Option D incrementally — exactly the
upstream ADR-074 → "round B" cadence.** Phase 1 unfreezes the headline symptom (NightlyLearner → action-values →
ADR-0280 routing de-confounding) with no PII surface and a one-file-plus-one-line change. Phase 2 extends toward
upstream's full intent (post-edit/post-command + SONA `lastAdaptation`).

**This ADR is `proposed`. It authorises no code** — implementation needs an explicit go-ahead. It is the
extracted, complete plan.

### Supersession scope

This ADR **supersedes only ADR-0287 §F10's *disposition*** (the "its own capture-wiring ADR" deferral). ADR-0287
§F10's diagnosis, live proof, and the rest of ADR-0287 stand unchanged; its F10 disposition now points here.

### Everything we need to make it work (Phase 1 — implementation checklist)

1. **Producer (the trigger).** Add the capture invocation to the live file-based PostTask handler —
   `.claude/helpers/hook-handler.mjs` `post-task` case (~`:231`), *additive* to the existing
   `intelligence.feedback(true)` JSON write. Durable fork fix: emit the same in the generator
   `cli/src/init/settings-generator.ts` (~`:399`) so fresh `init` projects inherit it (`feedback-patches-in-fork`).
2. **Invocation.** Shell to the existing `ruflo hooks post-task` (which already dispatches `agentdb_reflexion_store`).
   Prefer the daemon socket / `_cli_cmd` (`reference-cli-cmd-helper`) over a cold `npx` per task to bound the
   per-task subprocess cost on multi-agent fan-out.
3. **Arg forwarding.** Pass `--success`, `--agent <subagent_type>`, `--task "<description>"`, `--quality <n>`
   from the PostToolUse(Task) stdin. Fix `commands/hooks.ts` `postTaskCommand` (~`:1953`) to forward
   `task`/`quality` into `callMCPTool` (today it drops them → episodes record `task='task_…'`, reward 0.6).
   The description is used to **derive `task_type`** — it is **not stored raw** under Phase-1 metadata-only.
4. **Metadata-only write (PII-free).** Persist the structured fields `task_type` (derived), `action`, `reward`,
   `success`, `ts`, `session_id`; **omit / empty** the free-text columns (`task`, `input`, `output`, `code`,
   `critique`). This is the ADR-0289 decoupling — free-text capture is a separate, later decision.
5. **Reward integrity.** Keep ADR-0268 §R3's skeptic guard — absent quality records sub-threshold so a single
   run cannot auto-promote a skill; the write stays discriminating-non-fatal.
6. **Consumer (already live).** NightlyLearner runs hourly (`worker-daemon.ts` `learn` row, enabled, 60-min) →
   `computeActionValues` over `episodes` → `action-values.json` → ADR-0280 β/γ routing de-confounding (ON by
   default, currently self-inert for want of episodes). **Verify the scheduled trigger fires**; no new wiring
   needed beyond episodes existing.
7. **Acceptance + benchmark gate** (upstream's discipline): drive a real Task through the **file-based hook**
   (not a manual MCP call); assert `episodes` accrues a row with real `task_type`/`action`/`reward` and **no
   raw free-text / no PII**; assert NightlyLearner's next run populates `action-values.json`; wire into
   `test-acceptance*.sh` + `.github/workflows/` (`feedback-always-wire-tests-into-cicd`).

### Phase 2 (incremental, toward upstream's end state — separate go-ahead)

* Wire **post-edit / post-command** hooks to feed the capture (upstream ADR-074 "round B"), after ADR-075's
  store-ownership ("which store wins") is reconciled in-fork.
* Advance **SONA `lastAdaptation`** by driving `intelligence.ts recordTrajectory` (the `ruflo neural` path that
  actually moves it — the MCP `hooks_intelligence_trajectory-*` tools are `enabled:false` and write only RVF
  `trajectories` + `sona-patterns.json`, ADR-0287 §F10).
* Capture **redacted free-text** for skill-consolidation — gated on **ADR-0289** Phase 2 (secrets hard-blocked,
  PII masked, fail-loud).

### Consequences

* Good, because Phase 1 unfreezes the headline learning symptom (ADR-0280 routing de-confounding) via the
  cheapest seam, directly mirroring upstream ADR-074, with **zero PII surface**.
* Good, because it completes ADR-0195's missing producer half and converges with upstream's direction rather
  than inventing a fork-only mechanism.
* Good, because it is decoupled from ADR-0289 — learning ships without waiting on the redaction decision.
* Bad, because skill-consolidation (needs free-text) stays unfed until the optional Phase-2 / ADR-0289 redacted
  capture.
* Bad, because a per-task CLI subprocess adds cold-start latency on large fan-outs (mitigated via daemon socket
  / `_cli_cmd`).
* Neutral, because SONA `lastAdaptation` and post-edit/command remain Phase-2 — Phase 1 unfreezes episodes +
  action-values, not every F10 metric at once (matching upstream's incremental cadence).

### Confirmation

* The Phase-1 acceptance (item 7) is the gate: a file-based-hook-driven Task → `episodes` row (metadata-only,
  PII-free) → NightlyLearner → `action-values.json`. Benchmark-gated per upstream's posture. The check must
  assert the **hook** fires the write, never a manual tool call.

## More Information

* **Upstream guidance (prose-reference):** claude-flow **ADR-074** (hooks→`recordTrajectory`; no-op = bug; names
  the trajectory hook path), **ADR-075** (unified stats / "which store wins" / round B deferral), **ADR-077**
  (pretrain seeds `recordTrajectory`); agentdb **ADR-073** (on-demand consolidate, bg worker deferred), agentdb
  **ADR-006** (library-layer auto-capture on every op, `learning` default true — Proposed/unbuilt). Direction:
  honest-wiring → incremental-automation, benchmark+CI gated.
* **Fork basis:** ADR-0287 §F10 (diagnosis + live proof — this ADR extracts its disposition); ADR-0268 (the live
  `agentdb_reflexion_store → episodes` write chain); ADR-0280 / ADR-0277 / ADR-0279 (the consumers — action-value
  routing substrate); ADR-0195 (the autopilot producer half this completes).
* **Explicitly NOT a dependency:** **ADR-0289** (PII) — it governs only the optional free-text capture (Phase 2);
  Phase-1 learning is PII-free and proceeds without it.
* **Evidence:** swarm `docs/research/f10/01-04` (upstream ADRs / upstream impl / fork impl / project ADRs).
