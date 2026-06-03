---
status: proposed
date: 2026-06-02
tags: [mcp, observability, learning, honesty, infrastructure]
supersedes: []
depends-on: [ADR-0204, ADR-0267, ADR-0274, ADR-0284, ADR-0177, ADR-0210, ADR-0277, ADR-0069, ADR-0207, ADR-0280, ADR-0235, ADR-0112, ADR-0180, ADR-0080, ADR-0094]
implements: []
---

# Live manual-test remediation: MCP cold-start, hook-router CJS/ESM, dead Phase-2 controller activation, and reporter/liveness honesty gaps

## Context and Problem Statement

A manual test of the live ruflo stack in `ruflo-patch` (memory, learning, neural,
routing, daemon, MCP — via the live npx-cache bin `@sparkleideas/ruflo@latest`,
patch.408, **not** the acceptance harness) surfaced a cluster of issues. Each was
then traced to root cause by a four-agent read-only research swarm against the fork
source (`/Users/henrik/source/forks/*`), the live binary, and the Claude Code MCP
logs. The research plan and raw evidence are in
`docs/research/2026-06-02-live-system-findings-research-plan.md`.

The core working surfaces are healthy: memory store/retrieve/semantic-search
(1,226 entries, mpnet-768, HNSW active, scoring correct at 0.91 for near-exact
match), SONA/ReasoningBank/Flash-Attention/Training-Pipeline all active, hooks
firing, `ruflo doctor` 15-pass. The findings below are defects and honesty gaps
around that healthy core — most are reporters lying about a working system, two are
genuine load/wiring bugs, and several first-pass conclusions were **corrected** by
the research (the daemon is in fact running; the "eventual-consistency" write lag
did not reproduce).

Findings (severity in brackets):

- **F1 [high] — No `mcp__ruflo__*` tools registered in the session.** Not a server
  bug. The MCP server answers `initialize` in **0.14s** and already defers all
  AgentDB/RVF/archivist bootstrap past the handshake (ADR-0204(a)/ADR-0267,
  `bin/mcp-server.js:64-75,183-196`). The 30s connection timeout is **100% npm
  cold-install** of a 1.5GB / 444-package tree (~38s, dominated by ML
  optionalDependencies: onnxruntime, xenova, agentic-flow, node-llama-cpp, sharp),
  forced on the **first session after every version bump** by the `@latest` +
  frequent-patch design. Warm = 0.5s, offline = 0.02s. The `TAR_ENTRY_ERROR` storm
  is a symptom of npm self-repairing a partially-extracted cache, not the cause.
- **F2 [medium] — `resources/list` returns `-32601 Method not found`** though the
  server advertises `capabilities.resources` at `bin/mcp-server.js:192`; no handler
  exists (`default` → -32601 at `:298`). Advertised-but-no-op (cf. ADR-0210).
- **F3a [high] — Hook-time router always "Router not available".** `.claude/helpers/
  router.js` (and `session.js`, `memory.js`) are CommonJS, but project
  `package.json:39` declares `"type":"module"`, so Node parses them as ESM and the
  load throws (`module is not defined`); `safeImport`'s bare `catch {}`
  (`hook-handler.mjs:45`) swallows it → `router = null` → the `[INFO] Router not
  available` branch (`hook-handler.mjs:145`). Reproduced end-to-end. The template's
  `createRequire` "fix" (ADR-0235) does **not** help — a `.js` file is ESM under
  `"type":"module"` regardless of loader.
- **F3b [medium] — CLI Q-router is untrained and architecturally orphaned.**
  `.swarm/q-learning-model.json` never existed; epsilon=1.0, `updateCount:0`. The
  router only learns via explicit `ruflo route feedback`, which nothing in the stack
  ever calls. The 715 trajectories / 7 neural patterns / ReasoningBank / `learn`
  worker all feed the **causal/semantic** subsystem, not the Q-table
  (`q-learning-router.js:41,216`; `route.js:138`). The `learn`-12 vs `map`-3677 run
  gap is a benign age/cadence artifact (`learn` added under ADR-0277).
- **F5 [medium] — Dead Phase-2 controller-activation block emits a false alarm.**
  `agentdb-service.ts:767-908` (`initializePhase2RuVectorPackages`) calls
  `AgentDB.getController('gnnLearning'|'semanticRouter'|'graphAdapter'|'sonaService')`.
  `AgentDB.getController` (`AgentDB.ts:341-390`) is a hard `switch` that **throws**
  on unknown names (and has no `setController`), and these four names belong to the
  *other* registry (canonical `ControllerRegistry`, Registry B) — and are wrong even
  there (`gnnLearning`/`sonaService` are private LearningSystem fields, not registry
  keys `gnnService`/`sonaTrajectory`). All four throw → caught → mislabeled "real
  error, not module-missing" → `GNN/Router/Graph/Sona=false`. **The functionality is
  already live** via `LearningSystem`/`GNNService`/Registry B; `graphAdapter` is
  retired (ADR-0170 Phase D). The `doctor` "32/41, 9 inactive" reads Registry B and
  is healthy/unrelated (the 9 are config-gated/explicit-enable).
- **F6 [info, not a bug] — Discrepant pattern/graph stores.** Four independent
  stores with overlapping vocabulary: intelligence JSON (148 patterns/144 edges,
  `graph-state.json`), neural JSON (7 patterns/715 trajectories, `neural/*.json`,
  Sona trajectories in-memory by design), uncreated GNN graph (0/0,
  `.claude-flow/agentdb/graph.db` absent — blocked by F5 + retired by ADR-0170), and
  the RVF/HNSW corpus (1,226 vectors, authoritative). No data loss. `.swarm/memory.graph`
  (1.5MB, 6-Apr) is a stale legacy artifact.
- **F7 [low, CORRECTED] — Cross-process write-visibility lag did NOT reproduce.**
  The RVF write path is synchronous-durable (lock → index add → WAL append →
  `compactWal` flush → unlock, all under one flock; `rvf-backend.ts:542-594`,
  ADR-0284). Two fresh-process trials returned the new entry on the first search
  (0.80 / 0.88). The original one-off miss was a cold-start txnid-snapshot timing
  artifact at the ADR-0274 read-your-own-writes guard boundary, self-healing within
  one process generation — not designed eventual consistency. The per-call ~31s is
  mpnet WASM cold-load, not index lag.
- **F8a [low] — `neural status` prints "0-dim".** Reporter gap: the `hnswStats`
  object (`rvf-backend.ts:1240-1245`) has no `dimensions` field, so
  `memory-router.ts:2136` `?? 0` always wins. `memory stats` reads 768 from a
  different path and is correct.
- **F8b [medium] — config.json + config.yaml collision.** `doctor.ts:148` warns
  correctly. Precedence is json-wins-then-stops (`worker-daemon.ts:486`), so when
  config.json exists the YAML's `OPT-*` tuning (cacheSize/learningBridge,
  maxAgents:20) is **silently dead**.
- **F8c/F8d [info, not bugs] — Intended fallbacks.** `agentdb-onnx` missing →
  transformers.js WASM is the *intended* default embedding path (`executor.ts:1451`,
  no-API-key discipline); native ONNX is an optional accelerator. Contrastive Trainer
  "Unavailable" is honest reporting of a class removed from ruvllm 2.5.x
  (`intelligence.ts:1170-1176`); current stack uses TrainingPipeline/SonaCoordinator
  (both Active).
- **F4 [medium, CORRECTED] — Daemon liveness misreported.** The daemon **is**
  running (live PID 56912, `daemon start --foreground`). `daemon status`/`doctor`
  report "Not running" because (a) `.claude-flow/daemon.pid` is absent (the
  foreground start didn't write it), so `bgRunning=false`, and (b) the status CLI's
  fresh in-process `WorkerDaemon` singleton has `running=false`; worker history is
  rehydrated from `daemon-state.json` with `nextRun:undefined` (hence all
  "Next Run = -"). `daemon.ts:664-667`, `worker-daemon.ts:806-822,1181-1189`. The 6
  disabled workers are disabled in fork DEFAULT_WORKERS (`worker-daemon.ts:166-171`),
  not by this repo.

## Decision Drivers

* Honesty over green-wash — reporters that claim "not running"/"real error"/"0-dim"
  for a working system are ADR-0210-class lies and must be fixed or made truthful.
* Preserve the `npx -y @sparkleideas/ruflo@latest` freshness mandate
  (`feedback-always-npx-for-ruflo`) — no pinning, no removing npx.
* Patches land in the forks, not the codemod (`feedback-patches-in-fork`).
* No fork code change without a separate explicit go-ahead — this ADR records
  dispositions; it is `proposed`, not implemented.
* Distinguish genuine bugs (F1-timeout, F2, F3a, F5, F8a, F8b, F4) from
  intended-behaviour / non-bugs (F6, F7, F8c, F8d, F3b-is-untrained-not-broken).

## Considered Options

* **Option A — Record dispositions, triage by severity, fix nothing yet** — one
  consolidated ADR that classifies each finding (bug / intended / non-bug) with a
  chosen remedy per finding, implemented later under separate go-aheads.
* **Option B — Fix everything in the forks immediately** — bundle all remedies into
  one patch series now.
* **Option C — Split into N single-finding ADRs** — one ADR per finding.
* **Option D — Do nothing** — the working core is fine; treat all as cosmetic.

## Decision Outcome

Chosen option: **Option A**, because the findings came from one investigation sweep
and are thematically related (live-system honesty/connection/wiring), so a single
record keeps the evidence and dispositions together; while the no-execute-without-
go-ahead and patches-in-fork rules forbid Option B's immediate bulk change. Option C
fragments shared context (the two-registry story, the four-store map) across records;
Option D ignores two high-severity bugs (F1, F3a) that disable real surfaces.

Per-finding disposition:

| # | Class | Disposition | Target |
|---|-------|-------------|--------|
| F1 | bug (env, not code) | (1) Set `MCP_TIMEOUT=60000` in Claude Code's **launch environment** (NOT `.mcp.json` `env` — Claude reads its own `process.env`). (2) Warm the npx cache as a post-publish release step so cold sessions are rare. (3) Longer-term: gate the ML optionalDependencies — **separate ADR** (cross-fork packaging risk). | launcher env + release pipeline |
| F2 | bug (advertised no-op) | Remove the unimplemented `resources` capability advertisement at `bin/mcp-server.js:192` (or implement `resources/list` if a catalog is genuinely intended — not currently). | forks/ruflo cli |
| F3a | bug (CJS/ESM) | Rename `router.js`/`session.js`/`memory.js` → `.cjs` in deployed `.claude/helpers/` **and** in `helpers-generator.js`; stop swallowing the load error in `safeImport`/`safeRequire` (log to stderr). | forks/ruflo cli init template |
| F3b | intended-but-untrained + orphaned | Decision point: **wire `routing-outcomes.json` → `QLearningRouter.update()`** (quality→reward map + replay-dedup) so it learns from data that already exists — preferred under the no-dormant-flags discipline; OR relabel `ruflo route` output as "untrained (epsilon=1.0)". Pick at implementation time. | forks/ruflo cli |
| F5 | bug (dead code + false alarm) | **Delete** `initializePhase2RuVectorPackages` (`agentdb-service.ts:767-908`) — Registry B is the single registration authority; GNN/Router/Sona already live; `graphAdapter` retired (ADR-0170). Do not resurrect graphAdapter. Relabel the `neural status` GNN "0/0" row as retired. | forks/agentic-flow |
| F6 | not a bug | No data fix. Optional housekeeping: remove stale `.swarm/memory.graph`; relabel GNN line (covered by F5). | — |
| F7 | not a bug (corrected) | No code change; write path is synchronous-durable. Optional low-priority hardening: a fresh reader re-checks txnid once after an empty top-k. Defer (speculative; did not reproduce). | — |
| F8a | bug (reporter) | One-line: add `dimensions: this.config.dimensions` to `hnswStats` (`rvf-backend.ts:1241`). | forks/ruflo memory |
| F8b | bug (latent) | Pick config.yaml **or** config.json as canonical and archive the other (per doctor's fix hint) so the `OPT-*` tuning stops being silently inert. | repo config + doctor hint |
| F8c/F8d | not bugs | No action. Optional: rename the contrastive-trainer reporter row to the current ruvllm training API. | — |
| F4 | bug (liveness detection) | Make `daemon status`/`doctor` detect a live daemon when `daemon.pid` is missing — either have `daemon start --foreground` write/maintain the PID file, or fall back to `daemon-state.json.running` gated by a fresh `lastTick` heartbeat. | forks/ruflo cli |

### Consequences

* Good, because the two high-severity surfaces become reliable: MCP tools register
  on cold sessions (F1) and hook-time routing actually loads (F3a).
* Good, because deleting the dead Phase-2 block (F5) removes a recurring false "real
  error" alarm and re-establishes a single controller-registration authority.
* Good, because the reporter fixes (F8a, F4) stop `neural status`/`doctor` from
  lying about a working system — restoring trust in the diagnostics.
* Good, because the corrections (F4 daemon-is-running, F7 no-lag) prevent chasing
  phantom data-integrity bugs.
* Neutral, because F6/F7/F8c/F8d are confirmed non-bugs — documented, not changed.
* Bad, because F1's durable cure (shrinking the 1.5GB cold-install tree) is deferred
  to a separate ADR with cross-fork packaging risk; the interim is an env var +
  release-time cache warming, which only reduces (not eliminates) cold-session
  timeouts.
* Bad, because F3b needs a genuine product decision (wire vs relabel) that this ADR
  defers to implementation time.

### Confirmation

* **F1**: after setting `MCP_TIMEOUT` + cache-warming, a first-session-after-release
  cold start connects with `hasTools:true` (Claude Code MCP log shows
  `Successfully connected` under the limit). Add a release-pipeline step asserting a
  post-publish `npx … --version` warm-up ran.
* **F2/F5/F8a/F4**: targeted acceptance checks wired into `test-acceptance*.sh` +
  `.github/workflows/` (per `feedback-always-wire-tests-into-cicd`): F2 = `resources/list`
  returns a result (or capability absent); F5 = no "real error, not module-missing"
  in MCP boot log + `Phase 2 complete` shows the live services without the throw;
  F8a = `neural status` shows `768-dim`; F4 = `daemon status` reports running when a
  live `daemon start` PID exists.
* **F3a**: `echo '{"prompt":"…"}' | node .claude/helpers/hook-handler.mjs route`
  emits `[INFO] Routing task: …`, not "Router not available".
* **F3b**: if wired, `ruflo route stats` shows `updateCount > 0` / `epsilon < 1`
  after outcomes replay.

## More Information

* Research plan & evidence: `docs/research/2026-06-02-live-system-findings-research-plan.md`.
* Builds on: ADR-0204 (MCP server consolidation / deferred archivist bootstrap),
  ADR-0267 (RVF lock release while MCP running / deferred RVF warmup), ADR-0274 (RVF
  read/write handle split, x-process freshness guard), ADR-0284 (single-flock write
  collapse), ADR-0170 (graphAdapter retirement, Phase D), ADR-0210 (advertised-surface
  honesty), ADR-0277 (autonomous causal learning / `learn` worker).
* Related lore: `feedback-always-npx-for-ruflo`, `feedback-patches-in-fork`,
  `feedback-no-dormant-off-by-default-flags`, `project-two-hook-paths-cli-vs-handler`,
  `project-mcp-daemon-runs-sqljs-fallback`, `feedback-trace-bin-entry-before-patching`.
* Key file:line anchors are inline in each finding above; full traces in the four
  research-agent reports (session 2026-06-02).

## Amendments

### 2026-06-02 — Upstream/ADR cross-check (4-agent comparison swarm)

A second read-only swarm compared every finding against three axes — fresh ruvnet
upstream source (`git show origin/main`), upstream ADRs, and this repo's ADR corpus —
to test each disposition (CONFIRM / REFINE / CHALLENGE) and flag merge risk. Net:
the working core is sound and most fixes are low/no merge risk, but **six dispositions
had inaccurate targets or rationales that are corrected below.** No disposition was
fully reversed except F3b's *preferred remedy* (wire → relabel) and F8b (bug →
already-solved-by-ADR-0069, narrowed to a stale reporter).

| # | Verdict | Provenance | Merge risk |
|---|---------|------------|------------|
| F1 | REFINE | bloat **inherited**; fork *amplified* it | low (track upstream ADR-100) |
| F2 | REFINE | **inherited** (both entry files) | negligible |
| F3a | REFINE | fork-introduced **and already superseded** upstream | low (converges) |
| F3b | CONFIRM diag / **flip remedy** | inherited (implement-ahead) | wire=high, relabel=none |
| F5 | REFINE | block **fork-only** (`2f372931`); contract inherited | **none** — DELETE safe |
| F6 | CONFIRM | mixed; no cross-store contract anywhere | none |
| F4 | REFINE | **inherited** (identical upstream) | none (additive) |
| F7 | CONFIRM | **fork-invented** subsystem | none |
| F8a | CONFIRM | field inherited-absent, consumer fork-new | minimal (additive) |
| F8b | **CHALLENGE** | precedence inherited & **intended** (ADR-0069) | do NOT touch precedence |
| F8c | CONFIRM | aligned (ADR-0080/0094) | none |
| F8d | REFINE | outcome right, **cause wrong** | low |

Corrections (supersede the body where they conflict):

- **F2 — wrong file target.** The live `ruflo mcp start` path is `bin/cli.js` (advert
  `:206`, `-32601` at `:309`), **not** `bin/mcp-server.js:192` (reachable only via the
  `ruflo-mcp` bin — the ADR-0267 dead-code trap). Both files carry the bug
  byte-identically from upstream; the fix must patch **`cli.js` primarily**, or the
  live `-32601` survives. Disposition intent (drop the unbacked `resources` advert)
  is ADR-0210-aligned and unchanged.
- **F1 — adopt upstream's durable fix.** The 1.5GB tree is **inherited** from ruvnet
  (xenova/better-sqlite3/node-llama-cpp are required upstream deps; onnxruntime/sharp
  transitive). Upstream already has the accepted durable fix: **upstream ADR-100**
  (cli-core lazy-load split — same 30s-timeout/zero-tools bug) + **upstream ADR-094**
  (xenova → optionalDependencies). The deferred "shrink the tree" ADR should
  adopt/track ADR-100/094, not chart a parallel course. Also: the fork **amplified**
  the bloat by promoting `agentdb` optional→required in `cli/package.json` vs upstream
  — a fork-introduced install-size regression a shrink ADR can partly reverse.
- **F3a — re-scope target + fix a mis-citation.** The live defect in *this repo* is a
  **stale dogfood `.mjs` snapshot** (`hook-handler.mjs` from patch.211, commit
  `e1d033d`) plus the published template's residual `.js` helpers (which break only
  under a `type:module` root). The fork *root* already ships all-`.cjs` helpers — the
  exact fix shape. Durable fix: mirror the fork-root's `.cjs` set into the template
  generator + re-dogfood this repo's `.claude/`; verify against a fresh `init`
  sandbox, not this repo's stale `.claude/`. **Correction:** the body's claim that
  "ADR-0235 added a `createRequire` loader that still fails under type:module" is
  inaccurate — ADR-0235 has no `createRequire` change; that loader is a different
  surface (auto-memory resolver).
- **F3b — flip the preferred remedy to relabel/retire.** The body leaned "prefer wiring
  `routing-outcomes.json` → `QLearningRouter.update()` (no-dormant-flags)". The
  comparison shows wiring would create a **redundant associative learner competing
  with the ADR-0280 action-value/causal substrate** (`.swarm/action-values.json`) —
  re-introducing the duplication ADR-0277/0280 consolidated away (high merge tax +
  architectural conflict). Correct disposition: **relabel `ruflo route` as
  untrained/experimental, or retire it (ADR-0210 honesty)**. The `no-dormant-flags`
  rule cannot be satisfied — there is no self-inert-until-data path for an untrained
  Q-table. (The one would-be trainer, `SonaOptimizer.recordTrajectory`, is itself
  uncalled in the wired hook path.)
- **F5 — DELETE is safe; drop the stale rationale.** The block is **fork-only** (intro
  `2f372931`, absent from `agentic-flow origin/main`), calls a `setController` that
  exists in *neither* fork nor upstream `AgentDB` (so it `TypeError`s in addition to
  the `getController` throw), uses wrong registry keys, and upstream shows zero intent
  to maintain it (incl. the live ADR-073 SOTA roadmap) — **zero merge risk**.
  **Correction:** drop "graphAdapter retired (ADR-0170 Phase D) — do not resurrect" as
  the justification. **ADR-0170 is superseded by ADR-0177 (accepted), which *reverses*
  the retirement** and prescribes re-enabling graph mode (still unimplemented in code:
  `agentdb/src/core/AgentDB.ts:154-158` throws on `enableGraph`). Justify the delete on
  dead-code grounds only; graphAdapter's substrate fate is an open ADR-0177 Phase 1
  item, orthogonal to this delete. Also: ADR-0069 §F1 explicitly excludes Phase-2/4
  controllers from `getController`, so the block's own `// ADR-0069 F1` comment
  misapplies that ADR — further support for DELETE.
- **F4 — prefer the PID-centric fix; correct the worker framing.** The liveness gap is
  **inherited** (`daemon.ts`/`doctor.ts` byte-identical to upstream; hardcoded relative
  `.claude-flow/daemon.pid`). Prefer **ensuring the PID write + anchoring `doctor.ts`'s
  path to project-root (ADR-0137)** over trusting `daemon-state.json.running` — the
  latter contradicts **ADR-0207**, which deliberately made the PID file the liveness
  arbiter and the state file untrusted-when-stale. **Correction:** drop "6 workers
  disabled in fork" — the disabled set is upstream-baseline (predict/document) + 4
  intentional fork additions (ADR-0277 added learn/preload enabled); not a regression.
- **F8b — CHALLENGE: already solved, narrow to a reporter bug.** json-wins precedence
  is **inherited and intended**: **ADR-0069 already chose `config.json` canonical**;
  YAML is a deliberate legacy read-fallback, and a fresh `init` emits no YAML (no
  collision in practice). Do **not** touch the precedence or remove the YAML fallback
  (upstream-aligned + ADR-0069 legacy-project guarantee). The genuine, narrow defect is
  a **stale `doctor.ts`**: its comment (`:105`) and config-detection list (`:113-115`)
  still reference `config.yaml` only and don't check `config.json` — out of sync with
  ADR-0069. Fix only that.
- **F8d — outcome right, stated cause wrong.** "Unavailable" is honest (the consumer
  genuinely can't construct it), but **ContrastiveTrainer was NOT removed from ruvllm
  2.5.x** — the ruvector fork source still exports it (`ruvllm/src/contrastive.ts:214`,
  re-exported in `index.ts:84`). The real cause is an **incomplete dist build**:
  `ruvllm/dist/cjs/` is missing `contrastive.js`, `training.js`, `models.js`,
  `intelligence.js`, `benchmarks.js`. This is a separate **latent build-completeness
  gap** (worth its own look) — and a rebuild that ships `contrastive.js` would flip the
  report to Active and make the stale "removed in 2.5.x" comment a lie.

Frontmatter `depends-on` updated accordingly: ADR-0170 (superseded) replaced by
ADR-0177; added ADR-0069, ADR-0207, ADR-0280, ADR-0235, ADR-0112, ADR-0180, ADR-0080,
ADR-0094. Upstream ADR-100 (cli-core lazy split) and upstream ADR-094 (xenova→optional)
are ruvnet-corpus, referenced in prose only (not eligible for intra-corpus `depends-on`).

### 2026-06-03 — Dead-code triage (initial, from the cross-check)

The cross-check surfaced removal candidates. These are triaged under the
`feedback-no-consumer-is-not-stub` discipline — **WIRE / KEEP-AS-CAPABILITY /
DELETE** — where DELETE is reserved for ADR-0210-class *lies* (advertised surfaces
that no-op) or fork-only broken code, NOT for honest unadvertised "implement-ahead"
surfaces. A scoped read-only audit swarm (launched 2026-06-03) is expanding this into
an evidence-backed list; the table below is the seed.

| Candidate | Location | Verdict | Rationale | Merge risk |
|---|---|---|---|---|
| F5 Phase-2 controller-activation block | `agentic-flow/.../agentdb-service.ts:767-908` | **DELETE** | Fork-only (`2f372931`); calls nonexistent `setController` (TypeError); wrong registry keys; functionality already live via Registry B; emits a false "real error" boot banner → ADR-0210 lie | None — upstream has no such path |
| CLI Q-router surface | `q-learning-router.ts`, orphaned `SonaOptimizer.recordTrajectory` (`sona-optimizer.ts:285,372`) | **DECIDE** (relabel/retire, not silent delete) | Orphaned + untrained, but inherited honest implement-ahead; becomes a lie only because `ruflo route` prints meaningless confidence/Q-values. Wiring rejected (conflicts ADR-0280 substrate). | relabel=none; retire=low |
| Second MCP server copy | `src/mcp-server.ts`, `bin/mcp-server.js` (vs live `bin/cli.js` inline) | **KEEP / consolidate** (do NOT delete) | Still reachable via `ruflo-mcp` / `claude-flow-mcp` bins; deleting breaks those entries (no-consumer≠stub). It is the *duplication* that enables the ADR-0267 trap — a consolidation question pending evidence of whether `ruflo-mcp` has any real consumer. | high if deleted blind |
| Stale `.swarm/memory.graph` | repo runtime state (1.5MB, 6-Apr legacy) | **DELETE** (housekeeping, data not code) | Legacy artifact; nothing reads it | none |

Items NOT for removal (looks-dead-isn't): F8d's missing ruvllm dist modules are a
*build-completeness gap* (source exists, dist incomplete) — fix the build, do not
delete; F3a's `.js`/`.mjs` helpers are live-but-misloading — rename, do not delete.

Execution of any DELETE is a separate fork patch requiring go-ahead. The audit swarm
will append a §"Dead-code triage (audit results)" subsection with the evidence-backed
WIRE/KEEP/DELETE list before any removal lands.
