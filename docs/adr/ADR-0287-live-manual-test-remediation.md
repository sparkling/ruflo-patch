---
status: proposed
date: 2026-06-02
tags: [mcp, observability, learning, memory, honesty, infrastructure]
supersedes: []
depends-on: [ADR-0204, ADR-0267, ADR-0274, ADR-0284, ADR-0177, ADR-0210, ADR-0277, ADR-0069, ADR-0207, ADR-0280, ADR-0235, ADR-0112, ADR-0180, ADR-0080, ADR-0094, ADR-0285, ADR-0095, ADR-0166, ADR-0068, ADR-0073, ADR-0086]
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

### 2026-06-03 — Dead-code triage (audit results, 4-agent scoped swarm)

A read-only audit swarm (MCP/transport, learning/routing, AgentDB controllers,
memory/helpers/config/data) applied the WIRE / KEEP-AS-CAPABILITY / DELETE /
CONSOLIDATE triage with `git show origin/main` provenance per candidate. **Headline:
exactly one confident CODE delete (F5), no siblings, no other dead code.** The fork's
implement-ahead posture held — most "looks-dead" surfaces are honest KEEP or
reachable-needs-fix. The discipline directly prevented a bad delete (see `bin/mcp-server.js`).

**Confident CODE DELETE — one, self-contained:**
- **F5 `initializePhase2RuVectorPackages`** (`agentic-flow/.../services/agentdb-service.ts:767-908` + call site `:457`). Re-confirmed by two agents: fork-only (zero hits in `origin/main`); calls `AgentDB.setController` which exists in neither fork nor upstream; the four controller names hit `default: throw "Unknown controller"`, and that string is **not** matched by `isModuleNotInstalledError`, so every boot prints a false `"… init failed (real error, not module-missing)"` banner; the fields it sets are read nowhere (Registry B does the real job via `controller-bridge.ts`). ADR-0210 lie. Delete the method + its single call site; leave the valid Phase-1/4 inits. **Merge risk: none.**

**Lie to FIX (not a clean delete — inherited, merge-taxed):**
- **F2 `resources` capability advert** — confirmed a real ADR-0210 lie on the live path,
  but **inherited verbatim from upstream** (both `bin/cli.js:206` *and* `bin/mcp-server.js:192`;
  upstream ships no handler either). Fix = set capabilities to `{ tools: { listChanged: true } }`
  in **both** bins, + an INTEGRATION-LEDGER row + arch-test guard so an upstream `--theirs`
  merge can't silently re-add it.

**KEEP — looks-dead, isn't (do NOT delete):**
- **`bin/mcp-server.js`** — *not* a consolidation target. Reachable via the `ruflo-mcp` /
  `claude-flow-mcp` bins and exercised by a **CICD-gated** check (`lib/acceptance-adr0113-plugin-checks.sh:378`,
  wired at `test-acceptance.sh:1133` + `collect_parallel:2883`); three ADR-0212 arch/unit
  tests assert it must stay. (This is the no-consumer≠stub save: a blind delete would have
  broken a gated check.) Supersedes the seed table's "consolidate pending evidence."
- **CLI Q-router + SonaOptimizer + all 5 routers** — Q-router is **live-trained** (not
  orphaned): `SonaOptimizer.processTrajectoryOutcome` (`sona-optimizer.ts:307`→`qLearningRouter.update:373`)
  runs on the MCP hooks trajectory-end path (`hooks-tools.ts:3037`), and CLI `route` shares
  the same `.swarm/q-learning-model.json`. The 5 routers (Q / Semantic / Enhanced+Model /
  Coverage / action-values) are intentionally distinct surfaces, all live.
- **Contrastive trainer** — KEEP-AS-CAPABILITY (honest self-inert: import→catch→null,
  every caller null-guards; `neural status` reports "Unavailable" truthfully). [See F8d cause
  correction above: the ruvllm *source* still exports it; the dist build is incomplete.]
- **`enableGraph`/graphAdapter throw** (`agentdb/src/core/AgentDB.ts:154-160`) — a **live,
  deliberate-inert guard** (Registry B forwards `enableGraph:true` into it; it loud-rejects to
  prevent a silent no-op), and a future **WIRE** target per ADR-0177 — not dead.
- **`controller-bridge.ts`** (live shim over Registry B), **Registry A switch**,
  `mutationGuard`/`attentionService` `undefined`-returns (honest explicit-enable), and the
  6 disabled daemon workers (real switch bodies, manually triggerable) — all KEEP.

**WIRE / fix (not delete) — supersedes some original dispositions:**
- **F3a helpers** — rename `router.js`/`session.js`/`memory.js` → `.cjs` + update the
  generator (`helpers-generator.ts:1219-1221`) + `settings-generator.ts:253` + re-sync this
  repo's stale `hook-handler.mjs` dogfood (which is the *live* handler here, just an old
  patch.211 snapshot missing newer ADR-0211 handlers — not a dead duplicate). Inherited.
- **F8a 0-dim** — add `dimensions: this.config.dimensions` to the `hnswStats` literal
  (`rvf-backend.ts:1240-1245`).
- **NEW — spinner non-TTY frame leak.** `cli-core/src/output.ts:595-632` (`Spinner.start()`/`render()`)
  writes `\r…frame` to stdout with **no `isTTY` guard** (the getter already exists at `:103`),
  so on non-TTY stdout every 100ms frame appends a line — the "Checking neural systems…" spam
  seen in the original manual test. Inherited; affects all spinner sites. Low-risk fix.
- **F8b — sharper than the seed.** Not just a stale `doctor.ts` comment: `doctor.ts:104-105,144-157`
  **inverts the canonical pick** — it recommends "keep the YAML, archive the JSON" while the
  daemon + ADR-0069 treat **JSON** as canonical. Reconcile doctor to JSON-canonical. Do NOT
  touch the daemon's json-wins precedence (inherited + intended). No newly-dead config keys
  re-emerged (project-config-gaps still holds).
- **F4 liveness** — reachable, buggy → the targeted PID-centric fix (per the cross-check), not dead.

**DATA housekeeping (stale `.swarm/*`, not code) — safe `rm` (untracked):**
`.swarm/memory.db.backup-384d`, `.swarm/memory.db.corrupt-2026-05-19-bak`,
`.swarm/memory.db.pre-fix-bak`, `.swarm/memory.rvf.meta.tmp.60748.447`,
`.swarm/memory-rvf.sqlite` (+`.lock`). **Verify-first (do not auto-delete):**
`.swarm/memory.rvf.meta.tmp.92578.1128` (recent — confirm pid 92578 dead) and
`.swarm/memory.graph` (git-tracked — needs `git rm`; confirm nothing reads the `.swarm/`
copy — statusline reads a *different* `.claude-flow/data/` path). `agentdb-memory.rvf*`,
live `memory.rvf*`/`memory.db*` = KEEP.

**Net:** the audit confirms the codebase is **not** carrying broad dead code — one
fork-only lie to delete (F5), one inherited lie to fix-with-merge-guard (F2), two new
reachable bugs (spinner, doctor canonical inversion), and a short stale-data cleanup.
Everything else flagged is honest KEEP or reachable-needs-wiring. No DELETE/CONSOLIDATE
beyond F5.

### 2026-06-03 — F9: Multi-substrate memory/learning coherence (the `.swarm/` split)

Extends the manual memory/learning testing that produced this ADR. There is **one
central `.swarm/`** (project-root-anchored; worktree/fixture `.swarm` dirs are isolated
by design and out of scope). The question is coherence *within* it. A focused source
trace (file:line below) found: **`.swarm/` is a federation of independently-owned
substrates, not a synchronized store** — but the *primary* path is coherent, so this is
mostly DOCUMENT-as-accepted-trade-off with two named risks and two scoped fixes.

**Coherence map — who owns what (corrects the "dual-write" mental model):**
- The **live user-memory path is single-substrate RVF.** `storage-factory.createStorage`
  instantiates **only `RvfBackend`** (`storage-factory.ts:147-159`, rewrites `.db`→`.rvf` at `:99`).
  `memory.rvf` (1,226 entries) is the **sole source of truth** for user memory; `RvfBackend`
  has **zero SQLite INSERTs**. The `HybridBackend` dual-write (`hybrid-backend.ts:225-235`,
  non-atomic `Promise.all([sqlite, agentdb])`) is **dead code on the live path** (imported only
  by `database-provider.ts` + an example) — KEEP-AS-CAPABILITY, not the wiring.
- **`memory.db` (SQLite) holds DISJOINT concerns**, not a mirror of user memory: AgentDB
  controller tables (`causal_edges`=910, `hierarchical_memory`=292; `reasoning_patterns`/
  `episodes`/`skills`/`learning_experiences`=0). It has **no `memory_entries` table** on the live
  path (the DDL at `schema.sql:15` is a **stale artifact** — only `AgentDBBackend`/`SQLiteBackend`,
  both off-path, ever create it). So there is **no SQLite↔RVF divergence on the hot path** —
  they hold different things ("coherent by disjointness").
- **Two RVF stores, siloed by design.** The cli/MCP process shares one `memory.rvf` (archivist
  writes into it via `MemoryRvfAdapter`, "Option A", `memory-rvf-adapter.ts:35-46`). The
  **auto-memory hook is a different process** that writes a **separate** `agentdb-memory.rvf`
  (`auto-memory-hook.mjs:247-255`). They are **never merged/synced**.
- Learning sidecars (`sona-patterns.json` present; `q-learning-model.json` / `action-values.json`
  / `moe-weights.json` **absent**) are independent flat-file islands with **no coherence contract**
  to the SQLite learning tables.

**Divergence / failure modes:**
- **R1 (real risk) — siloed `agentdb-memory.rvf`.** Auto-memory-hook insights land in a separate
  RVF and are **invisible to `memory_search`** unless the `ruflo-rag-memory:memory-bridge` skill is
  run. Designed Option-A/B split, but the recall-gap cost is an undocumented standing trade-off.
- **R2 (real, the one code FIX) — silent row/vector split.** `AgentDBBackend.storeInAgentDB`
  (`agentdb-backend.ts:777-844`) does the SQLite INSERT and the HNSW vector-add in **separate
  try/catch blocks with a swallowing `catch{}`** (`:832`) → can strand a row-without-vector (or
  in-memory-without-row). Only bites the `agentdb-memory.rvf`/dead-Hybrid paths today, but
  violates `feedback-no-fallbacks` / `feedback-best-effort-must-rethrow-fatals`.
- **Accepted/closed:** the cold sidecars (D7) are *never-triggered*, not broken (q-learning
  auto-saves @100 updates; action-values after `nightlyLearner.run()`; moe @50). Lock/collision
  data-loss windows are **closed** by ADR-0274 (rw-split) + ADR-0284 (single-flock + hash-ids);
  the sql.js causal/recall bind bug is **closed** by ADR-0285 (purge reconciled `causal_edges`
  1745→910). Past SQLite corruption (`.swarm/memory.db.corrupt-2026-05-19-bak`) was manual-repair
  only — there is **no general RVF↔SQLite reconciler** (only ADR-0285 purge + the memory-bridge skill).

**Vestigial store — `.claude/memory.db` (forensics):** a **384-dim legacy** SQLite memory DB
created by the old `memory init` on **2026-03-04** (`metadata` table: `sql_js:true`,
`dimensions:384` — pre-ADR-0068/0069 mpnet-768 unification), committed 2026-03-22 (`8035f1a`).
It is **empty** (0 rows in all content tables; legacy `memory_entries`/`patterns`/`trajectories`
schema, *different* from the live AgentDB schema). **ADR-0080 already removed the code that
*created* it** (`memory-router.ts:1706` "dead-weight one-time copy"), yet its `-shm` is dated
2026-06-02 because **discovery/fallback arrays still probe `.claude/memory.db`** as a candidate
path (`memory-router.ts:39, 4062, 4341`). So a dead, wrong-dimension DB still gets opened.

**F9 disposition — DOCUMENT (accepted trade-off) + scoped FIXes:**
- DOCUMENT: `.swarm/` is a substrate federation; live user-memory = single-substrate RVF
  (`memory.rvf` sole truth), `memory.db` = disjoint controller state. Primary path coherent-by-
  disjointness, already hardened by ADR-0274/0284/0285. Not a data-loss bug.
- **FIX (code):** re-throw fatal SQLite errors in `AgentDBBackend.storeInAgentDB:832` (or write
  row+vector under one guarded block) — close the silent row/vector divergence (R2).
- **FIX (cleanup):** prune `.claude/memory.db` from the discovery arrays (`memory-router.ts:39,
  4062, 4341`) so nothing probes a 384-dim legacy DB; remove the empty file; drop the stale
  `memory_entries` DDL at `schema.sql:15` (or document why it persists).
- **DOCUMENT (R1):** record that auto-memory-hook content (`agentdb-memory.rvf`) is siloed from
  `memory_search` and is reconciled only by the `memory-bridge` skill.

File:line: `storage-factory.ts:97-159`, `hybrid-backend.ts:225-235`, `memory-router.ts:39,492-501,
627-715,1706,4062,4341`, `archivist-init.ts:1640-1678`, `memory-rvf-adapter.ts:35-46`,
`auto-memory-hook.mjs:247-255`, `agentdb-backend.ts:777-844`, `action-values.ts:50`,
`q-learning-router.ts:149`, `moe-router.ts:165`, `schema.sql:15`.

### 2026-06-03 — F10: Learning layer frozen + full storage inventory + orphan stores

Live inspection of the actual on-disk stores (not just the code) surfaced the most
operationally significant finding of this whole ADR: **the learning/adaptation layer
has been frozen for ~2 months, because its input path is the same MCP/hook path that
is down (F1/F3a).** Plus two more orphan/duplicate stores.

**The freeze (evidence):**
- `.claude-flow/neural/stats.json`: `lastAdaptation` = **2026-04-04 00:32**; `trajectoriesRecorded` = 715 (frozen).
- `.claude-flow/neural/patterns.json`: all 7 patterns share timestamp `step_17752591209xx` = **2026-04-04 00:32** — populated once, never since.
- `.claude-flow/metrics/learn.json` (daemon `learn` worker, ran 2026-06-02): `edgesDiscovered: 0`, `skillsCreated: 0`, recommendation *"collect more diverse episode data."*
- `.swarm/memory.db`: every learning table (`episodes`, `learning_experiences`, `reasoning_patterns`, `skills`, `sona_trajectories`, `consolidation_*`) = **0 rows**. Only the **ADR knowledge graph** is populated (`causal_edges`=910 = ADR `depends-on`/`supersedes` edges, `adr_node_ids`=215, `hierarchical_memory`=292 = ADR metadata) — written directly by `adr-index`, not by learning.
- RL sidecars `.swarm/{q-learning-model,action-values,moe-weights}.json` = **never written**.

**Why (causal chain — strong, confirm post-fix):** there are TWO hook paths
(`project-two-hook-paths-cli-vs-handler`). The **file-based** path (settings.json →
`intelligence.cjs`) IS live — `.claude-flow/data/graph-state.json` (148 nodes/144 edges)
was updated **today**, and `[INTELLIGENCE]` fires every prompt. But the **AgentDB/SONA
learning** path (episodes, trajectories, RL uplift) flows through the **MCP** tools
(`hooks-tools.ts:3037` `processTrajectoryOutcome` → q-learning update; `nightlyLearner`
→ action-values) — and the MCP server's tools **never connect** (F1: npm cold-start >30s)
and the hook-time router is dead (F3a). So: **F1+F3a → no episode/trajectory capture →
learning starved → frozen since the last time MCP worked (2026-04-04).** The intelligence
JSON graph stays warm; the AgentDB/SONA learning substrate is inert. This is the concrete
answer to "we have learning pipelines that rely on storing data" — **they are storing
almost nothing new.**

**Orphan / duplicate stores (extends F9):**
- `.claude-flow/agentdb/agentdb.sqlite` (528 KB) — a **second, fully-initialized but
  ENTIRELY EMPTY** AgentDB SQLite, alongside the real `.swarm/memory.db`. A different init
  path resolved a different `dbPath`. Dead weight; ambiguous which is authoritative.
- `.claude/memory.db` — vestigial 384-dim legacy DB; **DELETED 2026-06-03** (empty, nothing
  opened it, `.swarm` always won). Discovery arrays (`swarm.ts:39`, `hooks.ts:4062,4341`)
  still list it → prune them so it can't resurface (F9 cleanup).

**Full storage inventory** (project root; `~/.claude/projects/.../memory/` is the separate
cross-session auto-memory, outside the repo):

| Store | Path | Purpose | State |
|---|---|---|---|
| User-memory vectors | `.swarm/memory.rvf` (+`.meta`) | `memory_store`/`memory_search` corpus (768-dim HNSW) — **the real memory** | ✅ 1,226 entries, live |
| AgentDB relational/graph | `.swarm/memory.db` | causal graph, hierarchical mem, episodes, skills, reasoning, learning tables | ⚠️ only ADR graph populated (910/215/292); learning tables = 0 |
| AgentDB SQLite #2 | `.claude-flow/agentdb/agentdb.sqlite` | duplicate AgentDB init | ❌ empty orphan |
| Auto-memory RVF | `.swarm/agentdb-memory.rvf` (+`.meta`) | auto-memory-hook insights (separate process) | ⚠️ siloed from `memory.rvf` (R1) |
| Auto-memory source | `.claude-flow/data/auto-memory-store.json` | 148 MEMORY.md/cross-project entries imported by the hook | ✅ 148 |
| Intelligence graph | `.claude-flow/data/graph-state.json` | 148 nodes/144 edges; `[INTELLIGENCE]` suggestions | ✅ live (updated today) |
| Intelligence aux | `.claude-flow/data/{intelligence-snapshot.json,ranked-context.json,pending-insights.jsonl}`, `cjs-intelligence-signals.json` | snapshots, ranked context, pending-insight queue | ✅ active |
| Neural patterns | `.claude-flow/neural/patterns.json` + `stats.json` | 7 patterns, 715 trajectories | ❌ frozen @ 2026-04-04 |
| SONA patterns | `.swarm/sona-patterns.json` | SONA optimizer state | ⚠️ stale |
| RL sidecars | `.swarm/{q-learning-model,action-values,moe-weights}.json` | Q-table / action-value uplift / MoE weights | ❌ never written |
| Archivist audit | `.claude-flow/data/archivist-audit.jsonl` (8.4 MB) | append-only audit log (ADR-0263 replay) | ✅ live |
| Daemon/agents state | `.claude-flow/{daemon-state.json,agents.json,agents/store.json,claims/claims.json,metrics/learn.json}`, `.swarm/{swarm-state.json,state.json}` | worker run history, agent registry, claims, learn metrics | ✅/⚠️ |
| Config | `.claude-flow/config.json` (May) + `config.yaml` (Apr) + `embeddings.json` | runtime config; **json wins, yaml dead** (F8b) | ⚠️ collision |
| Federation | `.claude-flow/federation/key-node-*.json` (~50) | federation node identities | ⚠️ transport broken (F1-adjacent) |
| Legacy/cruft | `.swarm/{memory.graph,memory-rvf.sqlite,memory.db.*-bak,memory.rvf.meta.tmp.*}` | old graph, backups, corruption snapshot (2026-05-19), orphaned temps | 🗑️ stale |

**Consolidated concerns (all findings):**
1. **[HIGH] Learning frozen/starved** (F10) — adaptation dead since 2026-04-04; episodes/RL tables empty; root cause is the broken MCP/hook input path (F1/F3a). The learning pipeline runs but has no input.
2. **[HIGH] MCP tools never connect** (F1) — entire surface offline this session; npm cold-start >30s.
3. **[HIGH] Hook router dead** (F3a) — CJS-under-`type:module` → "Router not available" every turn.
4. **[MED] Substrate sprawl** — 3 AgentDB SQLites (one real, one empty orphan, one deleted) + 2 RVFs + many JSON sidecars; ambiguous authority, no general reconciler.
5. **[MED] Auto-memory silo (R1)** + **silent row/vector catch (R2, `agentdb-backend.ts:832`)**.
6. **[MED] Config collision (F8b)**; **[LOW] corruption history** (`memory.db.corrupt-2026-05-19-bak`, no auto-repair).
7. **[LOW] reporter/cosmetic**: F2 resources lie, F8a 0-dim, spinner non-TTY leak, F4 daemon liveness, F5 dead block, doctor JSON-canonical inversion.

**F10 disposition:** the fix is **upstream of the stores** — restore the MCP/hook input path (F1 timeout + F3a `.cjs` rename), then confirm learning resumes (episodes/trajectories accrue, `lastAdaptation` advances). Separately, remove the empty `.claude-flow/agentdb/agentdb.sqlite` orphan and prune the `.claude/memory.db` discovery paths. The stores themselves are not broken — they are **starved**.

### 2026-06-03 — Legacy storage cleanup (executed)

Safely removed the stale/orphan artifacts after verifying **no open handles** (`lsof`
clean), **owner pids dead** (60748, 92578), and **no code reads the `.swarm/` copies**
(AgentDB loads its schema from the package `dist/schemas/`, not `.swarm/schema.sql`).
Removed:
- `.swarm/memory.db.backup-384d`, `.swarm/memory.db.corrupt-2026-05-19-bak`,
  `.swarm/memory.db.pre-fix-bak` (manual backups + a 2026-05-19 corruption snapshot)
- `.swarm/memory-rvf.sqlite` (+`.lock`) (pre-RVF legacy stub)
- `.swarm/memory.rvf.meta.tmp.60748.447`, `.swarm/memory.rvf.meta.tmp.92578.1128` (orphaned atomic-write temps; both pids dead)
- `.swarm/memory.graph` (1.5 MB legacy graph format), `.swarm/schema.sql` (stray schema copy)
- `.claude-flow/agentdb/agentdb.sqlite` (+`-shm`/`-wal`) (the empty orphan AgentDB #2)
- (earlier) `.claude/memory.db` (+`-shm`/`-wal`) — vestigial 384-dim legacy DB

**Verified intact (live stores, untouched):** `.swarm/memory.rvf` (76 MB) + `.meta`,
`.swarm/memory.db` (ADR graph), `.swarm/agentdb-memory.rvf`, `.swarm/sona-patterns.json`,
`.swarm/swarm-state.json`, `.swarm/state.json`. **Kept (ambiguous, not deleted):**
`.swarm/adr-0116-0117-impl.json`, `.swarm/adr-status-cleanup.json` (tiny ad-hoc namespace
dumps; no reader confirmed, left for conservatism). These are local runtime files
(`.swarm/` is gitignored) — cleanup is on-disk only, no commit of the data itself.

Still-open (code, needs go-ahead): prune `.claude/memory.db` from the discovery arrays
(`swarm.ts:39`, `hooks.ts:4062,4341`) and remove the empty `.claude-flow/agentdb/` dir's
re-creation path so the orphan #2 doesn't reappear.

### 2026-06-03 — F11: File organization vs upstream storage intent (3-agent upstream analysis)

Analysed our file layout against **upstream INTENT** (ruvnet ADRs + `origin/main` source
across ruflo/agentdb/agentic-flow/RuVector). This **revises the "sprawl" framing of F9/F10**:
most of our multi-store layout is **upstream-designed or upstream-anticipated**, not fork
accretion. Two prior assumptions were wrong and are corrected here.

**CORRECTION 1 — RVF is UPSTREAM, not a fork swap-in.** (Supersedes the stale memory note
"upstream computes cosine directly, no RVF" — true only of the 2026-05-06 thin-spinoff.)
RVF/RuVector are first-class upstream, ADR-governed in **all three** repos:
- RuVector **ADR-029** (Accepted): "RVF = the single canonical binary format for all
  RuVector libraries"; **ADR-032** (lock model: one `flock` writer / unlimited readers /
  30 s stale recovery — exactly what our ADR-0274/0284 re-implement).
- agentdb **ADR-002/003**: RuVector>RVF>HNSWLib backend priority (`backends/factory.ts`).
- claude-flow **ADR-057** (Proposed): "replace sql.js with RVF as the native backend",
  names `memory.rvf`/`events.rvf`/`embeddings.rvf`; `database-provider.ts:290` already
  rewrites `.db`→`.rvf` for `provider:'rvf'`. **ADR-046** even makes "ruflo" upstream.
- So our RVF choice is **on upstream's roadmap, and we are AHEAD**: we ship RVF as the live
  single substrate; upstream still defaults to `hybrid` (SQLite+AgentDB) with RVF "Proposed".

**CORRECTION 2 — the `.swarm`/`.claude-flow` split and the JSON sidecars are UPSTREAM
defaults, not fork sprawl.** `cleanup.ts:27-30` defines three purpose-dirs by design:
`.swarm/` (memory + RL state), `.claude-flow/` (config/metrics/sessions/daemon/data),
`.hive-mind/` (consensus). `.swarm/memory.db` is the upstream canonical heavy default
(`memory-initializer.ts:89`). The RL sidecars are upstream defaults verbatim:
`.swarm/sona-patterns.json` (`sona-optimizer.ts:124`), `.swarm/q-learning-model.json`
(`q-learning-router.ts:154`), `.swarm/moe-weights.json` (`moe-router.ts:156`). Upstream's
own store-discovery probe (`system-tools.ts:325-331`, issue #1843) enumerates almost
exactly our file set (`.claude-flow/memory/agentdb.sqlite`, `store.rvf`, `.swarm/memory.db`,
`agentdb.rvf`, `ruvector.db`).

**Upstream's intended architecture (synthesised):** a **federation of purpose-specific
files** under one **unified `MemoryService` API** (claude-flow ADR-006/ADR-125), on a
backend trajectory **sql.js → hybrid(SQLite+AgentDB) → RVF-native** (ADR-057). Two
layers hold *different* source-of-truth models, and upstream is mid-migration between them:
- **agentdb layer (ADR-002/003):** SQLite `*_embeddings` BLOBs are durable ground-truth;
  the vector backend is an **ephemeral accelerator** (no `storagePath` by default).
- **RuVector layer (ADR-029/032):** **RVF is the canonical source of truth; the companion
  SQL/KV store is a rebuildable cache.** Consolidation target for learning = a single
  `RvfLearningStore` (claude-flow `rvf-learning-store.ts`, ADR-057 Phase 6) folding
  sona/lora/ewc/trajectory sidecars into one RVF — **implement-ahead, no live caller yet.**

**Where our layout actually stands:**

| Our artifact | Upstream status | Verdict |
|---|---|---|
| `.swarm/memory.db` | canonical heavy default | ✅ aligned |
| `.swarm/` + `.claude-flow/` + `.hive-mind/` 3-dir split | upstream design (`cleanup.ts:27-30`) | ✅ aligned |
| `.swarm/memory.rvf` user-memory (RVF single substrate) | upstream ADR-057 endpoint (Proposed) | ✅ **aligned & AHEAD** |
| `.swarm/{sona-patterns,q-learning-model,moe-weights}.json` | upstream defaults verbatim | ✅ aligned (upstream wants them folded into RvfLearningStore *later*) |
| `.claude-flow/data/*.json|jsonl`, config.json | upstream `STATE_DIR` + config path | ✅ aligned (dir) |
| **RVF-as-sole-truth (SQLite `*_embeddings` empty)** | agentdb keeps SQLite-blob ground-truth + accelerator; RuVector ADR-029 says RVF-is-truth | ⚠️ **ahead of agentdb, aligned with ADR-029** — but we gave up the brute-force SQL-blob fallback (relevant to corruption history) |
| `.swarm/agentdb-memory.rvf` (auto-memory hook's separate RVF) | upstream auto-memory = the `~/.claude/projects/<key>/memory/` **markdown bridge**, not a project-local RVF | ⚠️ **fork-added** — triage WIRE-into-`memory.rvf` vs KEEP-as-tenant |
| `.swarm/action-values.json` | **not present anywhere upstream** | ⚠️ **fork-only** (ADR-0280) — keep as enhancement, but it's a 3rd RL sidecar; fold into RvfLearningStore when that lands |
| `.swarm/memory.rvf.meta` (20 MB) | RVF format keeps meta **in-file segments**; no `.rvf.meta` in the upstream format (claude-flow's *hybrid* uses `.hnsw`+`.meta.json`, a different backend) | ⚠️ **fork artifact** — large external sidecar the RVF format doesn't prescribe |
| `.claude-flow/agentdb/agentdb.sqlite` (empty) | location is upstream-probed, but an empty 2nd SQLite has no basis | 🗑️ accretion — **deleted** (F10) |
| `.claude-flow/neural/*.json` location | upstream puts MoE at `.swarm/`, not `.claude-flow/neural/` | ⚠️ minor location divergence |
| `config.yaml` | upstream recognizes `.json` only | ⚠️ fork-added (F8b) |
| 768-dim mpnet | upstream default = 384 MiniLM | ⚠️ deliberate fork choice (ADR-0068/0069) |

**The one real tension:** RuVector (ADR-029) wants **everything in one `.rvf`** (anti-
fragmentation, "an agentdb file can't be queried by claude-flow"); claude-flow ships a
**federation + unified API** with sidecars as the live default. The fork inherits both
visions. `RvfLearningStore` is upstream's bridge between them — and it's the thing to
**track, not pre-empt**.

**F11 disposition — our file organization is largely sound; do NOT over-consolidate.**
The earlier "fragmentation/sprawl" worry (F9/F10) is mostly **upstream-intended federation**.
Genuinely fork-only and worth triage: (1) `.swarm/agentdb-memory.rvf` — decide WIRE-into-
`memory.rvf` vs keep as an isolated tenant (it doubles the `flock` surface, ADR-032/0284);
(2) `.swarm/action-values.json` — keep (ADR-0280) but earmark for RvfLearningStore folding;
(3) empty `.claude-flow/agentdb/agentdb.sqlite` — done (deleted); (4) `config.yaml` — drop
(F8b); (5) the 20 MB `.rvf.meta` — confirm whether the fork's RVF wiring needs it or it's
recoverable in-file. **Strategic:** the RVF-as-sole-truth choice (dropping the SQLite-blob
fallback) is the deepest divergence and the one with a real robustness cost — worth an
explicit decision (accept, or restore a rebuildable SQL/blob cache per ADR-032 KI-2).
Do **not** invent a fork sidecar-consolidation scheme; adopt upstream's `RvfLearningStore`
(ADR-057 Phase 6) if/when it ships a live caller.

**F11 follow-up (2026-06-03) — consolidation status, verified in our fork.** "Consolidation"
is TWO distinct upstream mechanisms; checked both in `forks/ruflo`:
- **Runtime entry-consolidation = `MemoryConsolidator` (ADR-125): LIVE in our fork.** We carry
  `memory/src/consolidator.ts` + `MemoryService`; the `consolidate` daemon worker
  (`worker-daemon.ts:1610` `runConsolidateWorker`, 2,607 runs/100%) routes it, `nightlyLearner`
  delegates to `MemoryConsolidator.runAll()`, and `agentdb_consolidate` exposes it. Same upstream
  lineage (not a fork build), proven by the B5 acceptance ("8 episodic memories → 1 cluster").
  **Our architecture already takes care of this** — it's just starved here (`consolidation_*`
  tables = 0 because `episodes` = 0; F10). Nothing to emulate.
- **Store/sidecar-consolidation = `RvfLearningStore` (ADR-057 P6): implement-ahead in our fork,
  same as upstream.** We carry `memory/src/rvf-learning-store.ts` (magic `RVLS`) +
  `persistent-sona.ts` (`PersistentSonaCoordinator`), but they have **no live caller** — SONA
  still writes the separate `.swarm/sona-patterns.json` sidecar. We are **in lockstep with
  upstream** (code present, unwired). So there is nothing to "emulate" or import — wiring
  `PersistentSonaCoordinator` ahead of upstream would *diverge* (and add merge tax); the correct
  move is to wire it **when upstream wires its live caller**, staying merge-aligned.

Net: on consolidation we are **not behind upstream** — runtime consolidation is live (and works,
when fed), and sidecar-consolidation is implement-ahead in both. The only consolidation-relevant
problem is the same F10 starvation (the layer runs but has no episodes to consolidate).

**F11 correction (2026-06-03) — the "restore a rebuildable SQL/blob cache" recommendation is
WITHDRAWN; it contradicts `feedback-no-fallbacks`.** Earlier in F11 I framed RVF-as-sole-truth
(empty SQLite `*_embeddings`) as "a robustness cost — accept it, or restore a rebuildable SQL/blob
cache (ADR-032 KI-2)." That second option is wrong for this fork: ADR-032's companion-as-
rebuildable-cache is consulted *on RVF failure* — i.e. it **is** a fallback, exactly the silent
degrade-on-failure path our philosophy forbids (`feedback-no-fallbacks`,
`feedback-best-effort-must-rethrow-fatals`). Under **fail-hard / fail-fast / no-fallbacks**,
RVF-as-the-single-source-of-truth is the **correct and coherent** choice, and we already have the
matching behaviour: **ADR-0286 — "RVF vector backend fail-loud on init failure."** So this is *not*
a robustness gap and *not* a divergence with a cost; it is a deliberate, philosophy-consistent
departure from upstream's fallback-tolerant model. (This is a place our fork's principles
*intentionally* diverge from upstream ADR-032 KI-2 — and that divergence is right.)

The only legitimate residual (and it is NOT a fallback): **no-fallbacks ≠ no-backups.** Ensure
(a) RVF corruption/loss fails **loud** at *read/runtime* too, not just init (ADR-0286 covers init —
confirm the read path also throws rather than returning empty), and (b) recovery is a **deliberate
operator restore** from a backup/snapshot, never an automatic in-process cache. That preserves
fail-hard while still giving a recovery story. Do **not** add a SQL/blob auto-fallback.

### 2026-06-03 — Validation pass, batch 1 (F1, F2, F5, R2)

A 5-agent validation swarm re-checked each outstanding item against **upstream (ruvnet)
`origin/main` source + ADRs** and our ruflo-patch ADRs, validating *both* finding and proposed
solution. Batch 1 (F1/F2 via the MCP agent, F5/R2 via the AgentDB agent) below; **batch 2
(F3a/F3b, storage triage, F4/F8a/F8b/spinner/F9p/F8d) pending** and will append.

**F1 — VALID; solution parts 1+2 CONFIRMED, framing REVISED.**
- `MCP_TIMEOUT` is read from **Claude Code's own `process.env`** (confirmed: Claude Code MCP docs + claude-code-action #1152) — the "NOT `.mcp.json` env" note is correct; `.mcp.json`'s per-server `timeout` is a *different* knob (per-call watchdog).
- **REVISION (load-bearing): Claude Code hard-caps `MCP_TIMEOUT` at ~60 000 ms** (claude-code #16837 — `100000` still times out at ~60 s). So `60000` is the **ceiling, not a tunable**; a cold install >60 s is **unrescuable by env var**. This **elevates tree-shrink from "longer-term" to the *only* durable fix.**
- **The `agentdb` optional→required amplification is a confirmed fork regression** (`origin/main:cli/package.json` keeps `agentdb` in `optionalDependencies`; fork made it a hard dep). **Reverting it is the low-risk, fork-local first step** of the shrink — do it without waiting on upstream's *unfinished* ADR-100 cli-core split (Proposed, foundation only; steps 3-4 pending). Must preserve fail-loud at call sites when agentdb is genuinely needed-but-absent (`optional-modules.d.ts` pattern; ADR-0286).
- Constraint reaffirmed: the fix must **not** resurrect ADR-0104 §4a's direct-path-over-npx cure (deliberately deferred by `feedback-always-npx-for-ruflo`). Parts 1+2 add no fallback.

**F2 — VALID; mechanism CONFIRMED, remedy REVISED: ADD the handler, don't DROP the advert.**
- Both bins (`cli.js:206` live, `mcp-server.js:192`) advertise `resources` with no handler → `-32601`, byte-identical to `origin/main` (inherited).
- **REVISION:** upstream **does implement `resources/list`** — in its *class-based* servers
  (`shared/src/mcp/server.ts:609` → `{ resources: [] }`), just not in the hand-rolled inline bins.
  So the upstream-convergent, ADR-0210-aligned fix is to **add the empty `{ resources: [] }`
  handler to both bins** (mirrors upstream's own `handleResourcesList`), **not** drop the advert
  (which would diverge from upstream's universal advert → standing merge tax). Keep the both-bins +
  INTEGRATION-LEDGER row, but invert the arch-guard to assert the **handler exists** (not that the
  advert is absent). Drop-the-advert demoted to fallback-only (no evidence the fork wants to suppress resources).

**F5 — VALID; DELETE CONFIRMED (zero merge risk).**
- Re-confirmed fork-only (intro commit not an ancestor of `origin/main`; no `agentdb-service.ts`
  upstream), `setController` absent in both trees, the 4 keys hit `getController`'s `default: throw`,
  false "real error" banner fires every boot. **ADR-0069 §F1 *forbids* what the block does** (Phase-2/4
  controllers "have no path into AgentDB core") — the block's own `// ADR-0069 F1` comment misapplies it.
  Registry B already registers the live GNN/Router/Sona equivalents → delete loses no functionality.
- **Correction to the F5/F9 amendment text:** the `setController` calls are **unreachable** (the
  `getController` throw fires first), so the block fails as a **throw, not a TypeError** — the earlier
  "TypeErrors in addition to" phrasing overstated. Disposition unchanged. REWIRE-to-Registry-B is **not**
  warranted (would duplicate Registry B). Justify on dead-code grounds, not graphAdapter retirement
  (ADR-0170 superseded by ADR-0177).

**R2 — VALID; re-throw CONFIRMED, refined to a *discriminated* re-throw.**
- The silent row/vector split (`agentdb-backend.ts:777-848`, swallowing `catch{}` ~:832) is **inherited
  verbatim from upstream** (fork added only a comment) — so the fix is **merge-taxed** (unlike fork-only F5).
- **REVISION:** prefer a **discriminated re-throw of the data-integrity subset** (per
  `feedback-best-effort-must-rethrow-fatals` + ADR-0082 Rule 3 + ADR-0085 — match `err.name` across the
  dynamic-import boundary), **not** a blanket throw (which would also surface benign availability errors
  upstream tolerates, and diverge harder). Requires an **INTEGRATION-LEDGER row + an arch test** (forced
  SQLite-write-failure ⇒ throws), reaching the backend via a non-live constructor since the live path is
  `RvfBackend`.
- **Latency/urgency:** R2 is **latent today** — `storage-factory`→`RvfBackend` keeps `AgentDBBackend` off
  the live user-memory path (ADR-0095/F9 "coherent by disjointness"); it bites only the dead-Hybrid path
  and the separate `agentdb-memory.rvf` process. So: low-urgency hardening, **but a precondition** for any
  storage-triage decision (V4) that wires `agentdb-memory.rvf` back onto a hot path.

**Net batch-1 disposition changes:** F2 flips **drop→add-handler**; F1 tree-shrink elevated to *the*
durable fix with the **agentdb optional→required reversal as the immediate low-risk step** (MCP_TIMEOUT is
a 60 s ceiling); F5 delete stands (text correction only); R2 refined to discriminated-re-throw + merge-guard,
latent (sequence before any agentdb-memory.rvf wiring).

### 2026-06-03 — Validation pass, batch 2a (F3a, F3b)

Verified in a **fresh Verdaccio sandbox** (`/tmp/f3a-sandbox`, `type:module`, cli.408) + `git show
origin/main` — NOT this repo's stale dogfood. This batch **corrects several claims in my own earlier
amendments** (the F3a follow-ups in F11 / cross-check were partly wrong).

**F3a — VALID mechanism (empirically reproduced); my earlier framing had 3 errors — REVISED:**
- Repro in fresh sandbox: `echo '{"prompt":"…"}' | node .claude/helpers/hook-handler.mjs route` →
  `[FAIL] … module is not defined in ES module scope` → `[INFO] Router not available`. `type:module` is
  the sole precondition (control: remove it → loads).
- **Correction 1:** "the generator already emits `.cjs`, so the fix is just sync + re-dogfood" is **FALSE**.
  The generator (`helpers-generator.ts` + `executor.ts:1210-1215`) still emits `router.js`/`session.js`/
  `memory.js`. **This is a real generator code change, not a sync.** (Fork-*root* `.claude/` ships `.cjs` —
  it dogfooded further than the generator — but that's not what `ruflo init` produces.)
- **Correction 2 (un-retract):** my "ADR-0235 added a createRequire loader — inaccurate" retraction was
  itself wrong. The fork generator **does** emit `hook-handler.mjs` with `createRequire(import.meta.url)`
  (`helpers-generator.ts:395,400,410`). Original claim stands.
- **Correction 3 (load-bearing):** **renaming the helper *targets* to `.cjs` is the fix — the hook-handler
  extension is secondary.** Proven: upstream's own scheme (`hook-handler.cjs` + native `require` → `router.js`)
  **STILL throws** under `type:module` (Node resolves `router.js` by the package's `type:module` regardless of
  the requiring module's scope); only `→ router.cjs` loads. **So upstream `origin/main` is ALSO bugged here**
  (it converted the dispatcher `.mjs→.cjs` but left the helper targets `.js`). The fork-root all-`.cjs` set is
  the only fully-correct reference.
- **"stop swallowing the error" is anti-convergent — REVISE:** the fork's `.mjs` path *already* logs
  `[FAIL] …` to stderr (it aided this diagnosis); **upstream deliberately `// silently fail`s**. Keep our
  stderr log as a *deliberate fork divergence*, but it self-mutes once helpers are `.cjs` (nothing fails).
- **Fix (validated):** rename `router/session/memory.js → .cjs` in `helpers-generator.ts` + `executor.ts:1212-1214`
  (bodies are already `module.exports`; only the emitted filename + the hook-handler's `join(...,'router.cjs')`
  refs change); adopt upstream's `hook-handler.cjs` dispatcher (converge on the half upstream did); re-dogfood
  this repo's `.claude/`. **Test churn to expect:** `tests/pipeline/init-helpers-parity.test.mjs:158-204`
  *forbids* top-level `require` and blesses `createRequire` as "legal" — it encodes the false belief that
  createRequire fixes the load; moving the dispatcher to `.cjs` breaks it → rewrite. `tests/unit/hook-paths.test.mjs`
  needs settings.json↔helper-name agreement. `lib/acceptance-init-checks.sh` `node -c` already covers `.cjs` — no regression.
- **Root coverage gap (why it shipped green):** **no test EXECUTES the route hook under `type:module`** — the
  parity test only string-matches generator source; `node -c` only syntax-checks. **Add an execution smoke**
  (run `hook-handler route` in a `type:module` sandbox, assert ≠ "Router not available"), wired into the
  acceptance runner (`feedback-always-wire-tests-into-cicd`).
- **Merge risk: MODERATE** — the dispatcher rename collides with upstream's in-flight `.mjs→.cjs` migration.
  De-risk = adopt `hook-handler.cjs` (match upstream) **plus** the helper-target `.cjs` rename (the half
  upstream missed); inherited surface, divergent-but-convergent fix.

**F3b — diagnosis VALID; relabel target REVISED (it's narrower than I wrote):**
- Cold-table output reproduced live (`Confidence: 12.5%`, `Q-Value: 0.000`, `Exploration: Yes`).
- **`updateCount`/`qTableSize` are ALREADY surfaced — but only in `route stats`, not the default `route <task>`
  box.** So the honest fix lands on the **default box**: when `updateCount===0 && qTableSize===0`, annotate it
  "untrained (0 updates) — heuristic/exploration only" from the `getStats()` already on the router (ADR-0210:
  honesty at the surface the user reads, not a buried subcommand). Smaller change than "surface updateCount".
- **Correction:** "the real loop is NOT the Q-table" *overstates*. ADR-0277 keeps SONA's associative loop
  (incl. the Q-router) as "genuinely additive, not redundant" — the Q-table is a legitimate **secondary
  associative** learner that coexists with the ADR-0280 de-confounded substrate; it's just not *the*
  de-confounded one. **CONFIRM: don't wire (would make it a redundant associative writer — the thing
  ADR-0277 says to avoid) and don't retire (inherited + ADR-0277 keeps it).**
- **F3a↔F3b causal link:** the Q-table is cold *because* the hook path is down (F3a/F1). Fixing F3a revives
  the `SonaOptimizer.processTrajectoryOutcome → qLearningRouter.update` training loop, so the relabel must
  reflect **live** stats (cold OR warm), not hardcode "cold."
- **Merge risk: LOW** — presentational change in the fork's `route.ts` render block; no new substrate/persistence.

### 2026-06-03 — Validation pass, batch 2b (storage triage + F4/F8a/F8b/spinner/F9p/F8d)

**T1 — `.swarm/agentdb-memory.rvf` → REVISE: WIRE via router (it's an ADR-0210 lie, not a "decide").**
Finding VALID and *stronger*: there are **3 auto-memory silos** (SQLite `memory.db`, JSON `auto-memory-store.json`,
ESM-hook RVF `agentdb-memory.rvf`) per ADR-0083, split by a CJS/process boundary. Crucially the hook's own
"drain into main memory" bridge (`auto-memory-hook.mjs:319-341`) is **DEAD CODE** — it imports the
`memory-initializer` that **ADR-0086 Phase 3 deleted** (`existsSync` permanently false), so hook content
**never reaches `memory.rvf`/`memory_search`**. ADR-0083 already adjudicated the architecture: silos converge
through the **single write path (`routeMemoryOp`)** + read-only merge at search — NOT parallel durable files.
So the disposition is **WIRE through the router (replace the dead import with `routeMemoryOp('store')`); retire
`agentdb-memory.rvf` as a durable store** — *not* "keep as tenant" (which ratifies a silo ADR-0083 set out to
remove and doubles the flock surface, ADR-032/0284). Closes an ADR-0210 lie. Hook FILE inherited; RVF-target +
dead-bridge are fork-only (origin/main still targets SQLite) → ledger the divergence. Merge risk low.

**T2 — `.swarm/action-values.json` → CONFIRM KEEP; soften the earmark.** VALID, fork-only, fully live
(writer `memory-router.ts:2586` after `nightlyLearner.run()`; consumers `intelligence.ts:691` β-blend +
`model-router.ts:628` γ-blend, both **on by default**, self-inert when empty). Coherent with ADR-0280/0279/0277.
The JSON sidecar is the *correct* shape today (cheap cross-process IPC, ADR-0083 rationale). **Fold into
`RvfLearningStore` only when that store gets a live caller AND can meet the routing hot-path read-latency
budget** — today `RvfLearningStore`/`PersistentSonaCoordinator` exist but are **never instantiated** (folding a
live on-by-default substrate into an unwired store would regress a working feature — `feedback-no-dormant-off-by-default-flags`).
Merge risk: none.

**T3 — RVF fail-loud on READ → REVISE: already fail-loud; verify, don't fix.** PARTIAL. Hard corruption on the
runtime read path **already THROWS `RvfCorruptError`** (δ-strict, ADR-0164 A0d + ADR-0095 d5), not silent-empty;
and the t3-2 vectorless-drop confound is **already fixed** (ADR-0163 recovery uses unfiltered `listMetadataIds`).
So there is **no no-fallbacks violation to fix** for native corruption. Real residual = **(i)** add a
corruption-throws **acceptance assertion** (corrupt a `.rvf`, assert next `memory search` throws/non-zero, not
empty) since current evidence is source-trace; **(ii)** verify the **live sql.js daemon read path** shares the
δ-strict throw (`project-mcp-daemon-runs-sqljs-fallback` — the native `degradeToFallbackMode` may not apply
identically there). The sql.js-path check is the only real unknown.

**T4 — 20 MB `.swarm/memory.rvf.meta` → CONFIRM finding; NEEDED, do NOT remove.** VALID (not in the canonical
RVF format — RuVector ADR-029 keeps meta in in-file META_SEG). But it is **load-bearing**: it's the durable
metadata store for native-fallback AND the **live sql.js daemon** path (`loadFromDisk` reads `.meta` *first*,
`:1194-1199`); removing it breaks the path the live daemon actually uses. The 20 MB (~27% of the 73 MB store)
is a full metadata mirror, not a lock/index. Right move = **reframe `.meta` as a rebuildable cache (ADR-032
KI-2): native-mode authoritative-from-segments, `.meta` rebuilt-on-miss** — bounding it to fallback/sql.js mode.
That's a **tracked follow-up** (touches the most fork-diverged file + the hot live read path; medium risk), NOT
an inline fix and NOT a delete.

**F4 — daemon liveness → REVISE: the causal claim is wrong; the fix is narrower.** PARTIAL. "`daemon start
--foreground` didn't write `daemon.pid`" is **unsupported** — `start()` writes the PID at `worker-daemon.ts:968`
(both fg + bg). And `daemon status` **already anchors** via `findProjectRoot()` and reports correctly. The real
defect is narrow: **`doctor.ts:166` uses a cwd-relative `.claude-flow/daemon.pid`** → "Not running" from a
non-root cwd. Fix = anchor that path to `findProjectRoot()` (ADR-0137); keep PID-gating, do NOT trust
`daemon-state.json.running` (ADR-0207). Inherited byte-identical → consistent ADR-0137-class divergence.
⚠️ **Tension to resolve at implementation:** this contradicts the *earlier live finding* (this session) that the
daemon was running (PID 56912) while `daemon.pid` was **absent**. Source-trace says PID is always written;
live evidence said it wasn't. Confirm on the live daemon whether `daemon.pid` is actually written before
concluding the fix is doctor-path-only — there may be a foreground/embedded start path that bypasses `start()`.

**F8a — `neural status` "0-dim" → CONFIRM + scope correction (3 edits, not 1).** VALID, fork-only consumer.
Add `dimensions: this.config.dimensions` to the `hnswStats` literal (`rvf-backend.ts:1240`) **AND** add
`dimensions` to the `HNSWStats` **type** (`memory/src/types.ts:286-302`) **AND** the native `agentdb-backend.ts:690`
literal (else native path still shows 0). Near-zero merge risk.

**F8b — config canonical → PARTIAL: one sub-claim was wrong.** `doctor.ts:107` **does** include `config.json`
in its candidate list — my "doesn't check config.json" was wrong. The genuine bug is **yaml-FIRST precedence**
(`doctor.ts:153-158` returns the YAML hit before JSON) + the collision branch labelling JSON "legacy" + the stale
`:104-105` comment — all **inherited byte-identical** from upstream and all contradicting ADR-0069's JSON-canonical
runtime. Fix = invert precedence to JSON-first + reword. Keep json-wins runtime precedence. **"Drop config.yaml"
must be verified separately** (didn't confirm init still emits it / that nothing reads it).

**F8e — spinner non-TTY leak → CONFIRM.** VALID, inherited byte-identical. `isTTY` guard on `start()`/`render()`/
`stop()`'s `\r` writes is the correct minimal fix (early-return in `start()` so the interval never starts). Nit:
`:103` is inside the private `supportsColor()`, not a reusable getter — guard on `process.stdout.isTTY` directly.
`ProgressBar.render()` has the identical `\r` issue (same class — mention, out of scope).

**F9p — prune `.claude/memory.db` discovery paths → REVISE: LEAVE IT (don't prune).** VALID that the arrays are
skip-safe + `.swarm`-first. But they're **inherited byte-identical from upstream** (the fork's only change was
the ADR-0137 `findProjectRoot()` anchor); pruning is **purely cosmetic** (removes a harmless `existsSync`-false
skip) and creates **recurring merge tax** every time upstream touches these lists, for **zero behavioral gain**.
Verdict: **leave it** (at most a one-line "retained for upstream-parity; vestigial, skip-safe" comment). This
withdraws the earlier F9-prune action item.

**F8d — ruvllm ContrastiveTrainer → PARTIAL: 3 layers, rebuild-alone won't fix.** The "removed from ruvllm 2.5.x"
comment (`intelligence.ts:1171-1176`) is **FALSE** — the class ships in published `@ruvector/ruvllm@2.5.5`
(`dist/cjs/contrastive.js`, 72 KB). The real gaps: **(1)** the *consumed* pin `2.5.5-patch.201` is **not on
Verdaccio** (only base `2.5.5`) — a publish/version gap (`feedback-pipeline-shared-skip-on-dist-clear`); **(2)**
the reporter reads `globalThis.__claudeFlowSonaStats` (`intelligence.ts:1191`) which **nothing ever sets** → it
would report Unavailable even with the class loaded — an independent plumbing break; **(3)** the false comment must
be deleted. So F8d = **republish ruvllm at the consumed version + wire the stats global + fix the comment**, then
verify `neural status` flips to Active — NOT a rebuild-only close. Fork-only.

---

### Validated backlog (post-validation — the actual to-do)

All findings VALID (some PARTIAL with corrected root cause). Net work, by tier:

| Item | Verdict | Validated action | Provenance / merge risk |
|---|---|---|---|
| **F3a** (HIGH) | VALID, revised | Rename helper *targets* → `.cjs` in the **generator** (real change, not sync) + adopt `hook-handler.cjs` + re-dogfood + **add an execution smoke** (none exists — why it shipped broken). Rewrite the parity test's createRequire assertion. | inherited gen; moderate (collides w/ upstream in-flight `.mjs→.cjs`) |
| **F1** (HIGH) | VALID, revised | `MCP_TIMEOUT=60000` (launch env; it's a **60 s ceiling**) + warm npx cache; **revert `agentdb` optional→required** (low-risk first step); tree-shrink (track upstream ADR-100) is *the* durable fix | bloat inherited+amplified; parts 1-2 zero risk |
| **F5** (MED) | VALID, CONFIRM | DELETE the Phase-2 block + call site; wired check the false banner is gone | fork-only; **no merge risk** |
| **F2** (MED) | VALID, revised | **ADD** `{ resources: [] }` handler to **both** bins (converge w/ upstream) + ledger + arch-guard | inherited; negligible |
| **T1** (MED) | VALID, revised | **WIRE** auto-memory through `routeMemoryOp` (fix dead `memory-initializer` import); retire `agentdb-memory.rvf` as durable | fork-only patch; low |
| **R2** (MED) | VALID, refined | **Discriminated** re-throw (not blanket) + ledger + arch test; latent → sequence **before** any T1 hot-path wiring | inherited; merge-taxed |
| **F4** (MED) | PARTIAL | Anchor `doctor.ts:166` PID path to `findProjectRoot()` (the PID-write half is already done); **resolve the live daemon.pid-absent tension first** | inherited; low |
| **F8b** (MED) | PARTIAL | Invert `doctor.ts` precedence to JSON-first + reword; verify "drop config.yaml" separately | inherited; low |
| **F3b** (MED) | VALID, revised | Relabel the **default `route` box** as cold from live `getStats()` (don't wire, don't retire) | inherited; low |
| **F8a** (LOW) | VALID, CONFIRM | 3 edits: `hnswStats` literal + `HNSWStats` type + native literal | fork-only; ~none |
| **F8e** (LOW) | VALID, CONFIRM | `isTTY` guard on Spinner (+ note ProgressBar) | inherited; low |
| **F8d** (LOW) | PARTIAL | Republish ruvllm @ pinned version + wire `__claudeFlowSonaStats` + delete false comment | fork-only; pipeline |
| **T4** (triage) | VALID | Reframe `.meta` as rebuildable-cache — **tracked follow-up**, not now; do NOT delete | fork-only; medium |
| **T3** (triage) | PARTIAL | Already fail-loud — add corruption-throws assertion + **verify sql.js read path** | fork-only; assertion = no risk |
| **T2** (triage) | VALID, CONFIRM | KEEP; fold into RvfLearningStore only when it's live + meets latency budget | fork-only; none |
| **F9p** (LOW) | VALID → **WITHDRAWN** | **Leave** `.claude/memory.db` in the discovery arrays (pruning = gratuitous upstream divergence) | inherited; n/a |

**Cross-cutting:** the highest-value *new* gaps validation surfaced are **T1's dead `memory-initializer` bridge**
(hook learnings never reach search — a real lie + ADR-0083's unfinished fold) and the **sql.js-path verification**
for T3/T4 (the live daemon runs sql.js, so native-traced behaviour must be confirmed there, not assumed). F3a's
**missing execution test** is why a router that fails every turn shipped through green releases — the durable fix
includes that smoke. Several proposed fixes are **inherited surfaces** → each carries an INTEGRATION-LEDGER row
+ arch-guard so an upstream `--theirs` merge can't silently undo them.
