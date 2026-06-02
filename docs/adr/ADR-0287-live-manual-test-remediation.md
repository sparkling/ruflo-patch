---
status: proposed
date: 2026-06-02
tags: [mcp, observability, learning, honesty, infrastructure]
supersedes: []
depends-on: [ADR-0204, ADR-0267, ADR-0274, ADR-0284, ADR-0170, ADR-0210, ADR-0277]
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
