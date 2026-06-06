---
status: accepted
completed: true
date: 2026-06-04
tags: [learning, upstream, audit, sona, trajectories, hooks, plugins, evidence, methodology]
supersedes: []
depends-on: [ADR-0290, ADR-0287]
implements: []
---

# Upstream learning audit (ruflo 3.10.36) — verified capability map and fork program implications

## Context and Problem Statement

The fork's learning program ("fix EVERYTHING related to learning", follow-on to ADR-0290) needs a
ground-truth answer to: **does upstream's learning work, and how?** Prior characterizations — including
the F10 research swarm's (docs/research/f10/) and this session's own first two passes — were derived
from git reading plus partial live tests, and the user challenged them repeatedly, citing a known
failure mode: *agents erroneously reporting ruflo features as broken*. The challenges were justified:
**three successive waves of findings were corrected** before this map stabilized. This ADR records the
final, evidence-tiered capability map and what it changes in the fork's plan.

**Method (what finally produced stable findings):** a by-the-book environment — upstream's documented
one-line installer (`curl …/install.sh | bash`, ruflo@3.10.36 from public npm), `init` as run by the
installer, the documented `/plugin marketplace add ruvnet/ruflo` + **all 33 marketplace plugins**
(project scope) — then, per surface: (a) drive it exactly as production does (real hook payloads,
correct event sequence, single long-lived MCP server for MCP-tool flows); (b) **complete fs write-trace**
(a `NODE_OPTIONS --require` shim logging every write API call to any path) instead of grepping
expected locations; (c) SQLite dumps of every `.db`, not text greps; (d) read the installed dist
(`~/.npm/_npx/...@claude-flow/cli/dist`) for every mechanism claimed present or absent.

## Decision Drivers

* The fork learning program (ADR-0290 Phase 2+) must port/avoid the right upstream pieces.
* Repeated erroneous "feature broken" verdicts burn trust and cycles; the validation bar itself needs
  recording (see Confirmation).
* Fork↔upstream divergences on the live trajectory path turn out to run in BOTH directions.

## Considered Options

* Accept this audit's capability map as the evidence base for the fork learning program — record it,
  with per-claim evidence tiers and the corrections history.
* Re-run the audit as an automated harness before relying on it — rejected for now: the manual audit is
  complete and reproducible from this record; automation can follow as part of the program's CI.

## Decision Outcome

Chosen option: record the verified map. **Answer to "is everything working perfectly?": no — but the
failure is architectural, not mechanical.** Every individual mechanism tested WORKS; the system still
does not learn end-to-end because the one durable learning loop has **no automatic trigger and no
consumer**. Precisely:

### Findings — what WORKS (each: live-tested + code-verified)

* **W1 — Durable cross-session pattern learning via the trajectory MCP tools.** In a live MCP server
  session, `hooks_intelligence_trajectory-start → -end` does real SONA learning from real content
  (`"real-sona-learning"`); the distilled routing pattern persists to **`.swarm/sona-patterns.json`**
  (sona-optimizer.js, `DEFAULT_PERSISTENCE_PATH`); a **new** session reloads and reinforces it —
  empirically: repeat task in a fresh server → `successCount 1→2`, `confidence 0.55→0.595`, persisted
  back. Trajectory records additionally persist to `.swarm/memory.db` `memory_entries`
  (namespace `trajectories`, **with 384-d embeddings**, semantically retrievable via
  `memory_search`). Writers: hooks-tools.js:2397 (pending, at start) / :2532 (completed, at end).
* **W2 — Automatic capture trigger exists (plugin layer).** Of 33 plugins exactly one — `ruflo-core` —
  ships hooks: `PostToolUse(Bash)→hooks post-command` (**real success from exit_code**),
  `PostToolUse(Write|Edit|MultiEdit)→hooks post-edit`, `Stop→session-end`, via a resilient shim
  (local bin → `npx --prefer-offline`; all errors swallowed by design, exit 0).
* **W3 — The shallow intelligence.cjs sidecar loop, cross-session.** `route` (UserPromptSubmit) →
  `post-task` (SubagentStop) across separate processes boosts the matched pattern's confidence
  (+0.05, observed 0.55→0.60; handoff via `ranked-context.json`); patterns survive
  session-end→restore and are injected as ranked context. (First-pass "inert" verdict was a
  wrong-shape test — isolated post-task without a preceding route.)
* **W4 — `memory store/search`.** Works incl. vectors; `--threshold` defaults to **0.7** (documented),
  so related-but-not-verbatim content (scores ~0.3) is hidden by default — a recall-tuning critique,
  NOT a malfunction. (First-pass "search broken" verdict was a missed default.)
* **W5 — `neural train`** runs and is the one ReasoningBank flusher (`flushPatterns()` at end of
  training): persists `patterns.json` + a LoRA checkpoint. `hooks pretrain` runs honestly
  (all-zero metrics on a toy repo, no error).

### Findings — what is GENUINELY missing or defective (survived all three challenge waves)

* **G1 — The working loop (W1) has no automatic trigger.** Only explicit model/operator calls of the
  trajectory MCP tools reach the pattern-persisting optimizer (`processTrajectoryOutcome` — sole
  consumer site, hooks-tools.js:2567). The automatic plugin path (W2) feeds
  `recordTrajectory`/sonaCoordinator, which never reaches the optimizer: **complete write-trace of a
  plugin fire shows exactly one project write — `.claude-flow/neural/stats.json` (counters).**
* **G2 — The working loop has no consumer.** `hooks_route`/`pre-task` route via keyword matching +
  routing-outcomes; **zero read sites of `sona-patterns.json` outside the optimizer's own
  reinforcement.** Learned patterns get stronger; nothing routes on them.
* **G3 — Episode learning does not exist upstream.** `episodes` table exists (agentdb schema), **zero
  writers** in the cli's hooks layer (code: no `storeEpisode` reference in installed
  `hooks-tools.js`); 0 rows after the full battery. The episode→NightlyLearner→action-values chain is
  fork-only (ADR-0268/0279/0280/0290).
* **G4 — No scheduled learner.** Daemon workers: map/audit/optimize only. The fork's hourly `learn`
  row (ADR-0277) has no upstream counterpart.
* **G5 — Per-process ReasoningBank loss + counter-echo display.** Hook-driven captures bump
  `patternsLearned` but the bank's debounced (100 ms `setTimeout`) flush dies with the short-lived
  process; `neural status` displays the **stats counter** as "N patterns stored"
  (`details: ${stats.patternsLearned} patterns stored`) — counters presented as content.
* **G6 — `SubagentStop → post-task` hardcodes `intelligence.feedback(true)`** (fabricated success)
  in both the repo-root dev helper and the init-generated handler (helpers-generator.ts:572-579).
  The boost mechanism (W3) works — fed a lie on this event.
* **G7 — Guide drift.** `[AGENT_BOOSTER_AVAILABLE]`: engine ships in agentic-flow behind
  `AGENTIC_FLOW_AGENT_BOOSTER=true` and cli-core tool *descriptions* promise the literal, but the
  documented `ruflo hooks pre-task` surface has **zero emit sites** — the guide's verbatim example
  cannot reproduce. `memory init` is required for memory ops but neither installer nor `init` runs it.
  `learning-service.mjs`/`learning-hooks.sh`/`learning-optimizer.sh` ship as orphan helpers (no
  runtime invoker; referenced only by each other and agent-prompt docs). Upstream also attempted a
  deterministic completion trigger and removed it (executor.ts: "TeammateIdle/TaskCompleted are not
  valid Claude Code hook events"); the parked `agentTeams.hooks.taskCompleted {enabled:true}` config
  has zero runtime readers. The shipped completion-capture strategy is **instructed self-reporting**
  (generated CLAUDE.md: `hooks post-task … --success true` — hardcoded success).

### Findings — fork-relevant deltas

* **F1 — RETRACTED (2026-06-04, C1 review — docs/research/c1-learning-intelligence/).** The claimed
  fork regression does not exist: the fork's `hooks_intelligence_trajectory-*` tools run, do real SONA
  learning, and persist `.swarm/sona-patterns.json` + RVF exactly like upstream (PARITY). The
  `enabled:false` citation (hooks-tools.ts ~1510) is **display metadata in the `hooks_list` response**
  (rows describing which hooks auto-fire — `post-task`/`post-edit`, which demonstrably run, carry the
  same flag), not a tool gate. ADR-0287 §F10's citation was amplified here without checking the
  surrounding structure — the exact wrong-shape failure this ADR's Confirmation bar exists to catch,
  reproduced inside this ADR. Verified first-hand: the rows sit in a `const hooks = [...]` returned by
  the list handler. The C1 review found the REAL fork regressions elsewhere: ruvllm WASM dead
  (`initSync` version skew vs vendored `@sparkleideas/ruvector-ruvllm-wasm`, 6 tools), `hooks_transfer`
  demo-data fabrication, `neural_predict/status` hash-fallback, `neural_compress` removed.
* **F2 — Fork ahead of upstream:** automatic durable capture→consumer chain exists only in the fork
  (ADR-0290: hook → metadata-only episode → hourly NightlyLearner → action-values → routing blend;
  17/17 smoke vs published packages).
* **F3 — Environment note:** on this machine upstream installs need the public registry — the local
  Verdaccio mirror's `@ruvector/*` shadow tops out below `sona@0.1.6` and breaks `npx ruflo` under
  the default registry.

### Program implications (planning input only — implementation needs its own go-ahead)

1. **P1 (reshaped):** re-enable the fork's trajectory tools + port upstream's trajectory-end→optimizer
   feed (and ADR-074/075 recordTrajectory + store-unification + #2241 sanitization) — upstream solved
   persistence for trajectories; take it.
2. **P2:** plug G1 with the fork's proven ADR-0290 trigger seam (file/plugin hook → CLI, metadata-only).
3. **P3:** plug G2 — routing reads learned patterns (fork analogue: action-values blend already does
   this for episodes; extend to sona patterns).
4. **Avoid porting:** counter-as-content displays (G5), fabricated `--success true` instruction
   templates (G6/G7), per-fire subprocess designs that drop their output.
5. **Port candidates that ship in-package:** `scripts/pretrain-from-github.mjs` (ADR-077/078).

### Consequences

* Good, because the fork program now targets the two real gaps (trigger, consumption) instead of a
  nonexistent persistence gap.
* Good, because a validated upstream persistence design (sona-patterns.json + embedded trajectory
  rows) is available to port rather than invent.
* Good, because the corrections history + method (Confirmation below) raise the bar against the
  recurring "feature erroneously reported broken" failure mode.
* Bad, because three correction waves were needed — first-pass live-audit conclusions (text-grep
  scope, default flags, wrong event sequence, killed processes) misreported working features.
* Neutral, because the audit project (`/tmp/ruflo-fresh`) is disposable; reproduction needs only this
  record.

### Confirmation

**The validation bar for any future "ruflo feature X is broken" claim** (each first-pass failure here
violated at least one):

1. Test the **production shape**: real payloads, correct event sequence (e.g. route→post-task), the
   process model the feature assumes (long-lived MCP server vs one-shot CLI), graceful shutdown.
2. Check **documented defaults/flags** (`--help`) before judging output absent (e.g. `--threshold 0.7`).
3. Hunt persistence with a **complete fs write-trace** (NODE_OPTIONS shim) + **SQLite dumps of every
   .db** + full-tree diff — never location-guessed text greps (`.swarm/` vs `.claude-flow/`; binary
   stores are grep-invisible).
4. Verify mechanism claims against the **installed dist** (entry points first —
   `feedback-trace-bin-entry-before-patching`), not only git checkouts.
5. Distinguish **counter telemetry from content** (read what the display field actually binds to).

## More Information

* Built on ADR-0290 (fork capture wiring, shipped + 17/17 verified) and ADR-0287 §F10 (fork frozen-
  learning diagnosis). Corrects/refines the F10 research conclusion "upstream is dormant-by-design on
  auto-capture": dormant for *episode/task-completion* learning, **not** for edit/command trajectory
  capture (plugin layer) — though that capture's durable half is unplugged (G1/G2).
* Upstream evidence at: claude-flow origin/main `844f68dbe` / published 3.10.36; agentdb `648e502` /
  3.0.0-alpha.16 tree. Audit environment: `/tmp/ruflo-fresh` (installer log `/tmp/ruflo-fresh-install2.log`,
  write traces `/tmp/fswrites.log`).
* Session memory: `project-upstream-learning-audit-2026-06-04` (three-wave corrections recorded).
