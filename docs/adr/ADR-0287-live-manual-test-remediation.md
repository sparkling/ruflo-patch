---
status: proposed
date: 2026-06-02
tags: [mcp, observability, learning, memory, honesty, infrastructure]
supersedes: []
depends-on: [ADR-0204, ADR-0267, ADR-0274, ADR-0284, ADR-0177, ADR-0210, ADR-0277, ADR-0069, ADR-0207, ADR-0280, ADR-0235, ADR-0112, ADR-0180, ADR-0080, ADR-0094, ADR-0285, ADR-0095, ADR-0166, ADR-0068, ADR-0073, ADR-0086]
implements: []
---

# Live manual-test remediation: hook-router load failure, MCP cold-start, dead controller-activation, and reporter/storage honesty gaps

## Context and Problem Statement

A manual test of the live ruflo stack in `ruflo-patch` (memory, learning, neural, routing,
daemon, MCP) surfaced a cluster of issues. Each was traced to root cause, then put through
three further read-only passes — an **upstream cross-check** (ruvnet `origin/main` source +
ADRs), a **dead-code audit**, and a **live re-evaluation** after the daemon + MCP server were
restarted onto node 24. This document is the consolidated result; the per-finding status below
is the *current, validated* truth. (The investigation arc is preserved compactly in the
Changelog; raw evidence is in `docs/research/2026-06-02-live-system-findings-research-plan.md`.)

**The core is healthy.** Memory works: a live `memory_store`→`memory_search` paraphrase test
("JWT refresh token rotation…" → "token-based login flow…") returns **0.59 cosine** via the
`archivist (RVF + HNSW)` backend with real mpnet-768 embeddings; the corpus holds 1,226 entries;
`agentdb_health` reports 41 controllers live from the canonical registry. The findings below are
defects and **honesty gaps around that healthy core** — most are reporters/wiring, and several
first-pass conclusions were **corrected** by the later passes (notably: the node-22/sql.js processes
were *other projects* — opda/hm — not ruflo-patch; the daemon "Not running" and the write-visibility
"lag" did not hold up; and **F3a is not the keystone it was first scored as** — the trajectory-capture
trace showed it gates nothing, and F10's frozen learning is dormant-by-design, not F3a/F1-gated).

**Terminology:** "upstream" = the ruvnet repos we forked from (`forks/* → origin/main`); upstream
ADRs are 3-digit (`ADR-100`), ours are 4-digit (`ADR-0287`). We integrate by **hand cherry-pick
(`-x`)**, never `--theirs`; every intentional divergence gets a row in
`docs/upstream/INTEGRATION-LEDGER.md` (the existing 364-row ledger).

## Decision Drivers

* **Honesty over green-wash** — a reporter that says "not running" / "real error" / "0-dim" /
  "Unavailable" about a working system is an ADR-0210-class lie; fix it or make it truthful.
* **Adopt upstream's direction, don't reinvent** — where upstream already solves a problem
  (cli-core split, `resources/list` handler, single-store consolidation), track/adopt it.
* **No-fallbacks / fail-loud** (`feedback-no-fallbacks`, `feedback-best-effort-must-rethrow-fatals`)
  — no silent degrade paths; RVF-as-sole-truth + fail-loud is correct, a SQL-blob *fallback* is not.
* **Patches in forks, not codemod** (`feedback-patches-in-fork`); each inherited-surface fix carries
  a ledger row + an arch-guard so a future hand cherry-pick can't silently re-introduce the old code.
* **No execution without a separate go-ahead** — this ADR is `proposed`; it records dispositions,
  it does not authorise the fork patches.

## Considered Options

* **A — Record validated dispositions in one ADR, implement later under separate go-aheads.**
* **B — Fix everything in the forks now** (violates no-execute-without-go-ahead + patches-in-fork batching).
* **C — One ADR per finding** (fragments the shared two-registry / multi-substrate / upstream-intent context).
* **D — Do nothing** (leaves the catalogued honesty gaps — false boot alarms, lying reporters, the dead
  drain-bridge — unaddressed, and never resolves F10's dormant-by-design learning).

## Decision Outcome

**Chosen: Option A.** The findings came from one investigation sweep and share context; a single
record keeps the evidence, the upstream-alignment, and the priority order together. Each finding
below carries its **validated root cause, current status, disposition, and provenance/merge-risk**.

### Findings

**F3a [LOW — cosmetic noise; does NOT gate F10] — Hook-time router fails to load ("Router not available" every turn).**
`.claude/helpers/{router,session,memory}.js` are CommonJS, but the project `package.json` declares
`"type":"module"`, so Node parses them as ESM and the load throws (`module is not defined`); the
hook-handler's loader swallows it → `router = null` → the `[INFO] Router not available` branch.
Reproduced in a fresh `init` sandbox. **The load-bearing fix is renaming the helper *targets* to
`.cjs`** — neither `createRequire` nor a `.cjs` *dispatcher* helps, because Node resolves
`router.js` by the package's `type:module` regardless of the requiring module's scope (upstream's
own generator is therefore *also* bugged here; only the fork-root dogfood went fully `.cjs`).
*Impact (corrected — was mis-scored "HIGH keystone"):* the failure suppresses one optional
`[INFO] Routing task → <agent>` advisory line per prompt. The target — `.claude/helpers/router.{js,cjs}` —
is a **pure `routeTask(task)` regex recommender** (`module.exports = { routeTask, AGENT_CAPABILITIES,
TASK_PATTERNS }`); it captures **nothing**. The live file-based hook `intelligence.cjs` imports only
`fs/path/os` and writes only JSON (`pending-insights.jsonl`, `ranked-context.json`,
`auto-memory-store.json`) — it never touches `episodes`/`sona_trajectories`/`lastAdaptation`/agentdb.
So fixing F3a changes only whether the advisory prints; it does **not** unblock F10 (see F10 + the
trajectory-capture trace). *Status:* **still firing live** this session even with MCP connected (it's
independent of MCP — and of learning). *Disposition:* still worth doing as honesty hygiene — rename
`router/session/memory.js → .cjs` in the generator (`helpers-generator.ts` ~:1212-1221) + `executor.ts`
+ adopt upstream's `hook-handler.cjs` dispatcher; re-dogfood this repo's `.claude/`; **add an execution
smoke** (run the route hook in a `type:module` sandbox, assert ≠ "Router not available"). Rewrite the
`init-helpers-parity.test.mjs` assertion that wrongly blesses `createRequire` as the fix. But it is
**not** a keystone and unblocks no other finding. *Provenance:* inherited generator, fork ahead on
`.cjs`; merge risk moderate (collides with upstream's in-flight `.mjs→.cjs` dispatcher migration —
converge on it).

**F5 [MED] — Dead Phase-2 controller-activation block emits a false "real error" banner.**
`initializePhase2RuVectorPackages` (`agentic-flow/.../services/agentdb-service.ts:767-908` + call
site `:457`) calls `AgentDB.getController('gnnLearning'|'semanticRouter'|'graphAdapter'|'sonaService')`.
`AgentDB.getController` (`AgentDB.ts:341-390`) hard-`switch`es and **throws** on unknown names; those
four aren't cases (and are the *wrong* keys — the canonical Registry B uses `gnnService`/`sonaTrajectory`/
`semanticRouter`/`graphAdapter`, confirmed live in `agentdb_health`'s 41 controllers). It also calls
`this.db.setController(...)`, which exists in **neither** fork nor upstream — but that line is
*unreachable* (the `getController` throw fires first, so it fails as a throw, not a TypeError). The
throw string isn't matched by `isModuleNotInstalledError`, so every boot logs a false
`"… init failed (real error, not module-missing)"`. The functionality is already live via
`LearningSystem`/`GNNService`/Registry B. *Disposition:* **DELETE** the block + call site (leave the
valid Phase-1/4 inits). Justify on dead-code grounds **only** — *not* "graphAdapter retired": ADR-0170
is superseded by ADR-0177, which *reverses* that retirement (still unimplemented in code). ADR-0069
§F1 explicitly excludes Phase-2/4 controllers from `getController`, so the block's own `// ADR-0069 F1`
comment misapplies it. *Provenance:* fork-only (intro `2f372931`, absent from `origin/main`); **zero
merge risk.**

**Reachability correction (2026-06-03 — agentic-flow provenance trace).** This finding's "every boot logs"
overstated *which* boot. The live ruflo MCP server is **`@sparkleideas/ruflo` = claude-flow v3** (`.mcp.json`:
`npx @sparkleideas/ruflo@latest mcp start`, `CLAUDE_FLOW_MODE=v3`) and does **not** import or boot
agentic-flow's `AgentDBService` — the v3 tree's only static use of the agentic-flow package is
`agentic-flow/transport/loader` (federation plugin) plus dynamic embedder/token-optimizer imports; none touch
`AgentDBService`/memory/learning. (An earlier "ruflo doesn't import agentic-flow" grep was meaningless — it
searched a non-existent top-level `ruflo/src`; `forks/ruflo` is the v3 monorepo, code under `v3/@claude-flow/*`.)
So the false banner fires on **agentic-flow's own fastmcp surface**, not the stack the manual test exercised —
the F5 acceptance check must boot agentic-flow's MCP/CLI, not the ruflo server. **`AgentDBService` is 100%
fork-authored** (no `class AgentDBService` anywhere on agentic-flow `origin/main`; the whole file is absent) ⇒
"what about upstream" = nothing to lose, zero parity to maintain. **No functionality is lost by the delete:**
the four controllers live in `forks/agentdb`'s canonical Registry B (archivist; 41 controllers in
`agentdb_health`); the consumer-method fallbacks (LearningSystem / CausalGraph / keyword routing) remain. The
**complete** delete scope was verified safe — Phase-1/4 are independently live (valid `getController` switch
cases) and every Phase-2 consumer guard (`if (this.<x>Enabled && this.<x>)`) is already false today. *Scope
note:* F5 is the smallest chip off a **larger, possibly-vestigial agentic-flow `AgentDBService` + 12-tool
fastmcp surface** that `forks/agentdb` + claude-flow v3 appear to have superseded — now under a **separate
retirement investigation** (`/ruflo-swarm:swarm`, 2026-06-03).

**F2 [MED] — `resources/list` returns `-32601` though the server advertises `resources`.**
Both bins advertise `capabilities.resources` with no handler → falls to `-32601`. The **live** path is
`bin/cli.js:206` (advert) / `:309` (`-32601`), **not** `bin/mcp-server.js:192` (reachable only via the
`ruflo-mcp` bin — the ADR-0267 dead-code trap); both must be patched. *Disposition:* **ADD** upstream's
empty `{ resources: [] }` handler to both bins (upstream implements exactly that in its *class*-servers,
`shared/src/mcp/server.ts:609`) — converges with upstream and keeps the advert truthful; do **not** drop
the advert (would diverge from upstream's universal advert → standing merge tax). Ledger row + arch-guard
that the *handler exists*. *Provenance:* inherited verbatim; negligible merge risk.

**F8a [LOW] — embedding dimension misreported (two reporters).** Memory embeddings are real (the 0.59
match proves mpnet-768), but two reporters lie about the dim: the CLI `neural status` prints "0-dim"
(`hnswStats` literal `rvf-backend.ts:1240-1245` omits `dimensions`; consumer `memory-router.ts:2136`
`?? 0`), and the MCP `neural_status` prints `hash-based / 384 / _realEmbeddings:false` for a path that is
actually real. *Disposition:* plumb the real dim into **both** reporters — add `dimensions:
this.config.dimensions` to the `hnswStats` literal **and** the `HNSWStats` type (`memory/src/types.ts:286-302`)
**and** the native `agentdb-backend.ts:690` literal; correct the MCP `neural_status` `_realEmbeddings`/dim
fields. *Provenance:* fork-only consumers; near-zero merge risk.

**F8e [LOW] — spinner non-TTY frame leak.** `cli-core/src/output.ts:595-632` (`Spinner.start()`/`render()`/
`stop()`) writes `\r…frame` to stdout with no `isTTY` guard → on non-TTY stdout each 100 ms frame appends a
line (the "Checking neural systems…" spam). *Disposition:* `isTTY` early-return in `start()` + guard
`render()`/`stop()` (`ProgressBar.render()` has the same issue — same fix class). Guard on
`process.stdout.isTTY` directly (the `:103` check is inside a private method). *Provenance:* inherited
byte-identical; low merge risk.

**F8b [LOW] — doctor inverts the config-canonical pick.** ADR-0069 chose `config.json` canonical (YAML is a
legacy read-fallback; daemon precedence is json-wins and **must not change**). `doctor.ts` is stale and
*inverts* it (`:104-105` comment + `:144-157` recommend "keep YAML, archive JSON"; it *does* check
`config.json` at `:107` — an earlier "doesn't check json" claim was wrong; the bug is yaml-first precedence).
*Disposition:* reconcile `doctor.ts` to JSON-canonical; verify "drop `config.yaml`" separately (didn't
confirm nothing emits/reads it). *Provenance:* inherited; low merge risk.

**F3b [LOW] — `ruflo route` default box reads cold/meaningless.** The CLI Q-router shares
`.swarm/q-learning-model.json` with `SonaOptimizer.processTrajectoryOutcome` (trained via the explicit
`hooks_intelligence_trajectory-end` MCP tool, `hooks-tools.ts:3037`), so it is **not** orphaned — just cold here
because nothing automatically drives that tool (the F10 dormant-by-design capture gap; the file actually didn't
exist on disk this session). NB this is the SONA q-table, distinct from the `episodes`/`lastAdaptation` writers.
The default `route <task>` box prints `Confidence 12.5% / Q 0.000 / Exploration` with no cold-state signal
(`route stats` already shows `updateCount`/`qTableSize`). *Disposition:* **relabel the default box** as
untrained when `updateCount===0` (from live `getStats()`). Do **not** wire routing-outcomes→Q-table (a
redundant associative learner conflicts with the ADR-0280 de-confounded substrate; ADR-0277 keeps SONA's
associative loop as additive) and do **not** retire it (inherited). *Provenance:* inherited; low merge risk.

**R2 [MED, latent] — silent row/vector split in `AgentDBBackend.storeInAgentDB`.** `agentdb-backend.ts:777-848`
does the SQLite INSERT and HNSW vector-add in separate try/catch blocks with a swallowing `catch{}` (`:832`)
→ can strand a row-without-vector. **Latent today** — `storage-factory`→`RvfBackend` keeps `AgentDBBackend`
off the live user-memory path (ADR-0095); it only bites the dead-Hybrid path + the separate
`agentdb-memory.rvf` process. *Disposition:* a **discriminated** re-throw of the data-integrity subset
(`err.name`-matched, per `feedback-best-effort-must-rethrow-fatals` + ADR-0082/0085), **not** a blanket throw;
ledger row + arch test (forced write-failure ⇒ throws). **Sequencing claim corrected — R2 stays latent
regardless of T1.** `routeMemoryOp({type:'store'})` routes through `createStorage` →
`@claude-flow/memory/storage-factory` → **`RvfBackend`** (`memory-router.ts:775-783`, ADR-0086/0095); it never
calls `AgentDBBackend.storeInAgentDB`. And T1 is now **DELETE the dead bridge** (no re-wire), so nothing puts
`AgentDBBackend` back on a hot path. The "R2 is a precondition for T1" ordering is therefore **moot**; keep R2
as standalone defensive hardening for the dead-Hybrid / `agentdb-memory.rvf` paths. *Provenance:* inherited
verbatim (fork added only a comment) → merge-taxed.

**T1 [MED — disposition corrected: DELETE the dead bridge, do NOT re-wire a drain] — auto-memory hook's
`agentdb-memory.rvf` silo + a dead drain-bridge.** The SessionStart hook (`auto-memory-hook.mjs:247-255`)
writes a **separate** `.swarm/agentdb-memory.rvf` in its own process, **invisible to `memory_search`** unless
the `memory-bridge` skill runs. Its in-process "drain into main memory" path (`:316-341`) is **dead code** — it
imports `cli/dist/src/memory/memory-initializer.js`, which ADR-0086 **deleted** (`existsSync` permanently false →
the whole block never runs; it would also embed at the wrong 384-dim if it ever did). **Correction (re-checked
ADR-0083):** ADR-0083 "Phase 5 — Single Data Flow Path" (accepted 2026-04-12) does **not** mandate a write-path
drain — it **abandoned** that approach. It explicitly *removed* the ADR-0074 `doSync()` drain from this very
hook (ADR-0083 §"Remove ADR-0074 `doSync()` drain from auto-memory-hook.mjs (60 lines)"), ruled out a direct
write-bridge, and made **"the Router the single write path"**; a standing acceptance check
`check_adr0083_no_dosync_drain` **verifies the drain is absent from the published hook**. So the prior
disposition ("WIRE the drain through `routeMemoryOp('store')`") would *resurrect* exactly the drain ADR-0083
deleted and would **trip `check_adr0083_no_dosync_drain`**. *Disposition (corrected):* **DELETE** the dead
drain-bridge block; rely on the read-time merge / `memory-bridge` skill (the ADR-0083 design) for cross-silo
visibility, and retire `agentdb-memory.rvf` as a durable store — *not* "keep as tenant" (that ratifies a silo
ADR-0083 set out to remove and doubles the `flock` surface, ADR-0032/0284). Closes the ADR-0210 dead-bridge lie
without re-introducing a banned drain. *Provenance:* hook inherited, RVF-target + dead-bridge fork-only; low
merge risk; ledger the hook divergence.

**T2 [triage] — `.swarm/action-values.json` (fork-only RL sidecar).** Fully live (writer
`memory-router.ts:2586` after `nightlyLearner.run()`; consumers blend β/γ uplift, on by default; ADR-0280/0279/0277).
*Disposition:* **KEEP**; fold into upstream's `RvfLearningStore` (ADR-057 P6) **only when** that store gets a
live caller and meets the cross-process read-latency budget (today it has *zero* callers — folding now would
regress a working feature). *Provenance:* fork-only; no merge risk.

**F1 [resolved-this-session / durable fix is its own ADR] — MCP cold-start can exceed Claude Code's 30s
connect timeout.** The server answers `initialize` in 0.14s (init deferred past the handshake, ADR-0204/0267);
the timeout is **100% npm cold-install** of a ~1.5GB / 444-package tree (~38s) under `npx @latest`, on the
first session after a version bump. *Status:* **surface UP this session** (tools connect; memory works).
*Disposition (DECIDED 2026-06-03): `MCP_TIMEOUT=60000` in Claude Code's launch env — that's it.* Claude
**hard-caps it at ~60 s** (a ceiling, not a tunable), and the cold install (~38 s) fits under it with headroom.
**Dropped:** the post-publish cache-warm (only warms the release machine, not users) and the durable tree-shrink
(a hard packaging project that can't touch the immovable embedder — see critique). F1 is already downgraded
(surface up; bites only the first session after a version bump), so the band-aid is the proportionate fix.
*Revisit only if* cold-start pain becomes frequent — then the one worthwhile sub-task is verify-and-omit the
**off-critical-path** native libs (onnxruntime/sharp/node-llama-cpp), its own small ADR after a load-trace.
**Correction (do NOT revert `agentdb` to `optionalDependencies`):** the fork holds `agentdb` in `dependencies` (upstream has it optional) **by
design** — ADR-0091 *removed the sql.js memory fallback* upstream keeps for edge envs, so RVF/agentdb is the
**sole** memory substrate and must be present (no-fallbacks/fail-loud; reverting would reintroduce a banned
silent-degradation). It also wouldn't help, since **npm installs `optionalDependencies` by default** — the
section label is not the lever. (This supersedes the validation pass's "revert agentdb optional→required as the
low-risk first step", which missed ADR-0091 and the optional-deps-still-installed fact.)

**Honest critique of the durable fix (it is the least-baked disposition here):**
- Marking ML libs `optional` (ADR-094) **does not shrink the `npx` download** for the same reason — npm installs
  optional deps unless the install runs `--omit=optional`, which the MCP spawn does not. ADR-094 is about install
  *resilience* (ARM/Alpine build failures), not size.
- The **embedder is immovable**: the MCP server needs xenova/transformers.js (~150 MB) for real semantic memory
  (the 0.59 match), and no-fallbacks forbids degrading to hash embeddings — so it cannot be omitted. The only
  genuinely-omittable bulk is the **off-critical-path** deps — native `onnxruntime-node`/`-web` (~158 MB, *if*
  transformers.js-WASM is the live path per F8c so the native runtime is installed-but-unused), `sharp` (~25 MB),
  `node-llama-cpp` (~34 MB) — and only after a trace confirms nothing loads them. Real, but a fraction of 1.5 GB.
- The **interim fixes don't reach end users**: `MCP_TIMEOUT` is a per-machine *launch-env* setting (operator
  workaround, not fork-shipped); cache-warm only warms the *release machine's* `~/.npm/_npx`, not a user's.
- **ADR-100 defers *load*, not *download*** — lazy-loading doesn't shrink the npm install unless the lite package
  genuinely doesn't depend on the heavy stack and fetches it on demand (a large change; Proposed/partial upstream).
- **Conclusion:** F1's realistic shape is "tolerate it (60 s timeout headroom, which a slow network still blows) +
  a hard packaging project" — verify+omit the off-critical-path native libs (its own ADR), don't expect a relabel
  or lazy-load to fix the download. Given F1 was already *downgraded* (surface up; intermittent, first-after-publish
  only), the cost/benefit may favour the interim band-aids over the packaging project. **Upstream has no precaching step** (the `bin/preinstall.cjs` cache-repair was removed in 3.1.0-alpha.53;
now a no-op). Its cold-start mechanisms all *avoid* the cost rather than precache it: **`@claude-flow/cli-core`**
(a separate package handling **memory commands only — no SQLite/HNSW/ONNX**; ~1.5s cold via `CLI_CORE=1`, for
*plugin scripts*), local `.cjs` (no npx, for statusline), and RVF replacing the sql.js WASM blob. **cli-core
cannot serve our F1**: the MCP server needs the full stack for real RVF memory, and cli-core has none of it —
routing the MCP through cli-core would yield a vector-less MCP. The mechanism that *would* cover the MCP is
ADR-100's **full** cli-core split (boot lite, lazy-load the heavy extras on first `tools/call` — our server
already defers init past the handshake, ADR-0204/0267, so only the npm *install* size remains), but ADR-100 is
**Proposed / partially-implemented upstream** → track it, don't adopt. So we shrink the *full* cli install
rather than route through the lite package. Do not resurrect ADR-0104 §4a's direct-path. *Provenance:* bloat
inherited + fork-amplified.

**F4 [downgraded → LOW] — daemon liveness reporting.** Re-evaluated live: with ruflo-patch's *own* daemon
running (it now writes `daemon.pid`), `doctor` correctly reports "✓ Running (PID 49267)". The earlier "Not
running" was largely that ruflo-patch had **no daemon of its own** (the node-22 one was opda/hm — see
Changelog); `start()` does write the PID. Residual: `doctor.ts:166` uses a **cwd-relative** PID path →
misreports only when run from a subdir. *Disposition:* anchor that path to `findProjectRoot()` (ADR-0137);
keep PID-gating, don't trust `daemon-state.json.running` (ADR-0207). *Provenance:* inherited; low.

**F8d [LOW] — `neural status` reports ContrastiveTrainer "Unavailable" (3 layers).** The comment "removed from
ruvllm 2.5.x" is **false** (the class ships in published `@ruvector/ruvllm@2.5.5`). Real gaps: (1) the
*consumed pin* `2.5.5-patch.201` is **not on Verdaccio**; (2) the reporter reads `globalThis.__claudeFlowSonaStats`,
which **nothing sets**; (3) the false comment. *Disposition:* republish ruvllm at the pinned version + wire the
stats global + delete the comment; a rebuild alone won't fix it. *Provenance:* fork-only pipeline.

**F10 [HIGH-impact — dormant BY DESIGN, not gated by F3a/F1] — the learning/adaptation layer is frozen.**
SONA last adapted **2026-04-04** (`neural/stats.json` `lastAdaptation` = `1775259120916`;
`trajectoriesRecorded` frozen at 715); the `learn` worker finds 0 episodes; every AgentDB learning table
(`episodes`/`sona_trajectories`/`learning_experiences`/`reasoning_patterns`/`skills`) = 0 in `.swarm/memory.db`;
RL sidecars never written (`q-learning-model.json` doesn't even exist). Only the **ADR knowledge graph** is
populated (`causal_edges`=910, `adr_node_ids`=215, `hierarchical_memory`=292 — written by `adr-index`, not
learning). **Root cause (CORRECTED — the prior "gated by F1+F3a" claim was wrong, see the trajectory-capture
trace):** there is **no automatic episode/trajectory-capture caller in normal Claude Code operation.** F10's
three symptoms are three *independent* metrics with three *separate* writers, and **none of them sits on any
hook path** (file-based or MCP-connection):
- **`episodes` table** ← `ReflexionMemory.storeEpisode` (`forks/agentdb .../controllers/ReflexionMemory.ts:190`),
  reachable only via the explicit `agentdb_reflexion-store` MCP tool / `agentdb reflexion store` CLI.
- **`sona_trajectories` table** ← `SonaTrajectoryService.recordTrajectory` (agentdb), reachable only via the
  explicit `agentdb_sona_trajectory_store` tool / archivist dispatch.
- **SONA `lastAdaptation`** ← `cli/src/memory/intelligence.ts` (`recordStep`/`recordTrajectory`/
  `endTrajectoryWithVerdict`/`distillLearning`, lines 998/1088/1256/1281), reached only by the `ruflo neural`
  CLI subcommand (`commands/neural.ts:252/265/852`).

The MCP `hooks_intelligence_trajectory-start/-step/-end` tools (`hooks-tools.ts:2837/2877/2961`) are **not on a
hook** either — they are tools the model would have to call deliberately, are marked `enabled:false`
(`:1510-1512`), and even when driven do **not** write `episodes`, `sona_trajectories`, or `lastAdaptation`:
`trajectory-end` persists into the user-memory RVF `trajectories` namespace and updates only
`.swarm/sona-patterns.json` (the `SonaOptimizer` JSON, `sona-optimizer.ts:902`). **Live empirical proof (this
session, MCP connected, node 24):** before — `episodes=0`, `sona_trajectories=0`, `lastAdaptation=2026-04-03`.
Drove a full trajectory `start→step→end` (`sonaUpdate:true`, `patternsExtracted:1`) **and** one
`agentdb_reflexion-store`. After — `episodes=0→1` **only from the reflexion-store call** (its
`session_id=adr0287-trace-probe` row), `sona_trajectories` **still 0**, `lastAdaptation` **still 2026-04-03**,
`trajectoriesRecorded` **still 715**. So MCP-up does not feed the substrate, and F3a (router) is irrelevant —
the capture tools simply have no automatic caller. *Disposition:* **NOT gated on F3a/F1.** The stores are not
broken and not starved-by-a-bug — they are **dormant by design**: learning only happens if something explicitly
calls the capture tools, which normal operation never does. The real next step is a **wiring decision** — e.g.
emit an `agentdb_reflexion-store` (and/or `intelligence.recordTrajectory`) from a real PostTask/Stop hook so
agent outcomes accrue episodes for the (live-but-idle) NightlyLearner — which is **its own ADR**, not a
side-effect of fixing F3a. (Caveat for the F10 acceptance: assert `episodes`/`lastAdaptation` advance **after
the chosen capture wiring**, NOT "after F3a + F1".)

**F10 capture-wiring investigation (2026-06-03 — 4-agent swarm: upstream ADRs · upstream impl · fork impl ·
project ADRs; raw findings `docs/research/f10/01-04`).** The dormant-by-design verdict holds and is now
grounded across upstream + fork + corpus, and the fix is de-risked:

- **Upstream INTENDS auto-capture but is wiring it incrementally and has DEFERRED the Claude-Code seam.**
  claude-flow ADR-074 (self-learning-wiring) wired `hooks_task-completed→recordTrajectory()` and frames the
  prior no-op as a *bug* ("surfaces advertise capabilities they never invoke"); its "Deliberately NOT in this
  round" list names exactly our gap — "wire post-edit/post-command to feed the trajectory pipeline (design
  call: which store wins)" + "schedule the consolidation worker" — deferred pending the store-ownership
  question ADR-075 (unified-learning-stats) is resolving, each step behind a benchmark+CI gate. (Citation fix:
  no literal upstream `ADR-057`; RVF-native = agentdb ADR-003, unified-self-learning = agentdb ADR-006
  [Proposed/unbuilt], cli-core = claude-flow ADR-100.)
- **Upstream and fork are at PARITY on the dormant seam.** Upstream's fired Claude-Code hook also terminates
  in `intelligence.cjs.feedback()` (JSON only — no episode/trajectory/SONA write). The fork is in fact
  **ahead** on the *manually-invoked* `hooks_post-task` (ADR-0268 episode write + reward integrity); upstream
  is ahead only on the `#2245 Round B` synthesise-trajectory-from-post-edit path — which also runs only on
  explicit MCP call. The fork is **not behind**; there is nothing to port.
- **Correction to this finding's "only via the explicit tool" wording — the episode write chain is already
  LIVE.** `hooks_post-task` (`hooks-tools.ts:1769`, ADR-0268) already dispatches `agentdb_reflexion_store →
  ReflexionMemory.storeEpisode → episodes` (substrate-registry "Phase 7 LIVE"). What is missing is **only the
  trigger**: the live file-based hook (settings.json `Task` matcher → `hook-handler.mjs post-task` →
  `intelligence.cjs.feedback()`) terminates in JSON sidecars and never calls it (`settings-generator.ts:397`
  wires the JSON-only Path A, never the episode-writing Path B).
- **F10 is the unfinished PRODUCER half of ADR-0195.** The fork shipped a consumer cluster (ADR-0195
  bus+subscriber, ADR-0277/0279/0280 action-value substrate) that ASSUMED a producer never built — ADR-0279
  §R3 literally names "the post-task hook (`hooks_post-task → agentdb_reflexion-store`)" as the producer, and
  that hook does not exist. The autopilot event bus is a **half-seam**: subscriber wired
  (`agentdb-service.ts:1427`), emitter present (`autopilot-learning.ts:1107`) but `_record()` has no live
  caller AND the file-hook runs in a separate short-lived process that cannot reach the in-process bus — so the
  event-bus seam is expensive, not "just needs an emitter."
- **Most-starved consumer: NightlyLearner.** It runs hourly (`worker-daemon.ts` `learn` row, enabled, 60-min)
  against an empty `episodes` table → `action-values.json` never populated → the ON-by-default ADR-0280 β/γ
  routing de-confounding is permanently self-inert. Filling `episodes` is what activates the headline routing
  feature.
- **Recommended cheapest correct seam (a):** wire the live file-based PostTask (`Task` matcher) hook to invoke
  the existing `ruflo hooks post-task` CLI, which already writes the episode. Insertion: minimal =
  `.claude/helpers/hook-handler.mjs` `post-task` handler (additive to the JSON feedback); durable fork fix =
  `settings-generator.ts:~399` so fresh inits inherit it (`feedback-patches-in-fork`). Forward
  `--task`/`--success`/`--agent`/`--quality` (today `postTaskCommand` drops `task`/`quality` → episodes record
  `task='task_…'`, reward 0.6; a one-line `callMCPTool` arg addition fixes it so NightlyLearner's `task_type`
  grouping is meaningful). **No RVF-flock exposure** — episodes are the SQLite carve-out (`.swarm/memory.db`),
  not the `.jslock` surface ADR-0284 addressed; the write is already discriminating-non-fatal (ADR-0268 R3).
- **Constraints the capture-wiring ADR MUST decide** (priority): (1) **PII/redaction — NEW, ungoverned, the
  biggest design question.** An episode row carries `subject`+`critique` = user-prompt content, file paths,
  possibly secrets — and capture turns transient turn content into a durable, embedded, cross-session,
  potentially federated (ADR-0196) store. Mechanism exists (`aidefence_has_pii`/`transfer_detect-pii`) but no
  policy → must decide redaction-before-write. (2) **Router single-write-path / flock** (ADR-0083 +
  `check_adr0083_no_dosync_drain`; ADR-0032/0284) — seam (a) sidesteps this (SQLite carve-out, not RVF), but
  must open no new RVF writer. (3) **No-fallbacks/fail-loud** (ADR-0286) — discriminated re-throw, never
  swallow-to-stay-green (that recreates the dormant-but-green illusion F10 exposed). (4) **Embedding cost** —
  no per-turn mpnet-768 embed on the hot path; defer to the daemon. (5) **Anti-sprawl** (ADR-0098)
  one-hook-one-write; **CICD must assert the HOOK fires the write, not a manual tool call.**

*Refined disposition:* unchanged in kind — **still its own capture-wiring ADR; do NOT implement here (no
go-ahead)** — but de-risked: the write path is live, the cheapest seam is identified (seam a), it **completes
ADR-0195** and aligns with upstream's ADR-074 direction, and the genuinely-open *decisions* are the constraints
above (PII foremost), not "does a seam exist." *Acceptance (refined):* after seam (a) lands, drive a real Task
completion through the **file-based hook** (not a manual tool) and assert `episodes` accrues a row with real
`task_type`/`reward`, then NightlyLearner's hourly run populates `action-values.json`. (Corpus citation fixes:
project `ADR-0125` = Hive-mind queen-types, *not* MemoryConsolidator — that is upstream 3-digit ADR-125; §F11's
"MemoryConsolidator starved" overstates, only the episode-adjacent paths are dry; `ADR-0166` is superseded,
only its Phase-3 controller-wiring is F10-relevant.)

**Non-bugs (documented, no change):** **F6** — the multiple pattern/graph stores are independent by design
(intelligence JSON 148/144, neural JSON 7/715, GNN graph uncreated, RVF 1,226), no data loss. **F7** — the
cross-process write-visibility "lag" did not reproduce; the RVF write path is synchronous-durable (ADR-0284).
**F8c** — `agentdb-onnx` missing → transformers.js WASM is the *intended* default (ADR-0080/0094). **T3/T4** —
"verify the sql.js read path / `.meta` is load-bearing" is **moot for ruflo-patch**: its MCP + daemon run
node-24/native; the sql.js processes were opda/hm. RVF read corruption already fails loud (δ-strict, ADR-0164).
Keep only a generic corruption-throws acceptance assertion as hygiene. **F9p** (prune `.claude/memory.db` from
discovery arrays) — **withdrawn**: the arrays are inherited byte-identical, skip-safe, `.swarm`-first; pruning
is gratuitous upstream divergence for zero gain.

**F11 — file organisation vs upstream intent (assessment, mostly aligned).** Our layout is largely
upstream-*designed*, not sprawl: the `.swarm`/`.claude-flow`/`.hive-mind` split, the RL JSON sidecars, and RVF
itself are all upstream (RuVector ADR-029/032, agentdb ADR-002/003, claude-flow ADR-057). We are *ahead* on RVF
(ship it live; upstream still defaults `hybrid`). Genuinely fork-specific: `action-values.json` (T2), the
separate `agentdb-memory.rvf` (T1), `config.yaml`, 768-dim mpnet (deliberate, ADR-0068/0069). Upstream's
`RvfLearningStore` is the intended sidecar-consolidation bridge — implement-ahead in both fork and upstream
(no live caller); **track it, don't pre-empt**. Runtime entry-consolidation (`MemoryConsolidator`, ADR-125) is
**live in our fork** (consolidate worker + `agentdb_consolidate`), just starved (F10). Our RVF-as-sole-truth
(empty SQLite `*_embeddings`) is the *correct* choice under no-fallbacks + ADR-0286 fail-loud — **not** a gap to
"fix" with a SQL-blob fallback.

### Prioritised backlog (validated; each = a fork patch + wired acceptance check, on go-ahead)

| Tier | Item | Action | Risk |
|---|---|---|---|
| 1 code lies | **F5** | **DELETE (complete scope)**: Phase-2 block + call site + the 4 orphaned consumer branches + fields + teardown. Banner is on agentic-flow's *own* fastmcp surface (NOT the live ruflo boot); `AgentDBService` is 100% fork-authored → acceptance check boots agentic-flow's MCP, not ruflo's | none (fork-only) |
| 1 code lies | **F2** | add `{resources:[]}` handler to **both** bins + ledger + arch-guard | negligible |
| 2 reporters | **F8a** | plumb real dim into CLI + MCP reporters (+ type + native literal) | ~none |
| 2 reporters | **F8e** | `isTTY` guard on Spinner/ProgressBar | low |
| 2 reporters | **F8b** | reconcile `doctor.ts` to JSON-canonical (verify drop-yaml separately) | low |
| 2 reporters | **F3b** | relabel the default `route` box as untrained from live stats | low |
| 3 storage | **T1** | **DELETE** the dead drain-bridge (do NOT re-wire — ADR-0083 = router-as-single-write-path); retire `agentdb-memory.rvf` | low |
| 3 storage | **R2** | discriminated re-throw + ledger + arch test (standalone; **not** a T1 precondition — `routeMemoryOp` hits RvfBackend, not AgentDBBackend) | merge-taxed |
| 3 storage | **F4** | anchor `doctor.ts:166` PID path to project root | low |
| 3 noise fix | **F3a** | rename helpers → `.cjs` in the generator + re-dogfood + **execution smoke**; rewrite the parity test. **Cosmetic only — suppresses an advisory line; gates nothing** | moderate (converge w/ upstream `.mjs→.cjs`) |
| 4 pipeline | **F8d** | republish ruvllm @ pin + wire `__claudeFlowSonaStats` + fix comment | pipeline |
| band-aid (decided) | **F1** | `MCP_TIMEOUT=60000` in Claude Code's launch env — only. Tree-shrink + cache-warm dropped (downgraded; not worth it) | none (operator env) |
| own ADR (wiring decision) | **F10** | dormant-by-design, **NOT gated by F3a/F1**. 4-agent swarm (2026-06-03): write chain already LIVE (`hooks_post-task`→`agentdb_reflexion_store`→`episodes`, ADR-0268) — only the **trigger** is missing. Cheapest seam (a) = wire the file-based PostTask hook → `ruflo hooks post-task` (`hook-handler.mjs` / `settings-generator.ts`); no RVF-flock (SQLite carve-out). Completes ADR-0195's producer half; unblocks NightlyLearner→ADR-0280. Open decisions = constraints (**PII-redaction foremost**), not seam existence | design |
| keep / none | **T2, T3, T4, F6, F7, F8c, F9p, F11-RVF** | documented; no code change | — |

**Implementation note (corrected):** F3a is **not** a keystone and gates nothing — it only suppresses an
optional `[INFO] Routing…` advisory; demoted to a tier-3 noise/honesty fix. F5 + F2 are self-contained honesty
fixes and the highest-value items. **F10 is NOT unblocked by F3a or F1** — the trajectory-capture trace + live
test prove the learning substrate has no automatic writer in normal operation (it is dormant by design), so it
needs a deliberate *capture-wiring* decision in its own ADR, not a side-effect of any fix here. Everything in
tier 2-3 is low-risk cleanup.

**Scope caveats (from the critique — apply before committing the cleanup tier):**
- **The reporter tier (F8a, F8e, F8b, F4) is cosmetic on *inherited* files.** Apply the F9p test per-item:
  is "stop a reporter mislabel" worth a *permanent* divergence + recurring merge-tax on an upstream-owned file?
  F9p was withdrawn on exactly this logic; F8e/F8b/F4 deserve the same explicit check, not an automatic "fix."
- **F8d (ContrastiveTrainer) is poor cost/benefit** — republishing a package + wiring a global to flip a
  *cosmetic* "Unavailable" on a genuinely-absent feature. Lean **document-don't-fix** unless the report
  actively misleads.
- **F7 caveat:** it reproduced *once* (the original observation), then not on two retries — so it's "couldn't
  reproduce; likely a cold-start race," not "proven absent." Keep, but don't overstate the certainty.
- **F5 caveat:** the audit confirmed Phase-2 is dead; **verify Phase-1/4 are live + correct** before deleting
  around them (cheap check; the delete leaves them in place).
- **Track record:** several first-pass claims in this ADR were wrong (F2 drop-not-add, agentdb-revert ×2,
  F3a-gates-F10). **Verify each disposition against current code before implementing** — don't trust the prose alone.

### Consequences

* Good — fixing F3a restores the hook-time routing advisory (failing every turn). It does **not** unblock F10
  (F3a and the file-based hook are not on the learning-capture path — trajectory-capture trace).
* Good — F5 removes a recurring false boot alarm and keeps Registry B the single controller authority.
* Good — the reporter fixes (F8a×2, F4, F8b) stop the diagnostics lying about a working system.
* Good — the validation/live-re-eval caught real errors *before* implementation (F2 drop→add, the F1 60s
  ceiling, T3/T4 cross-project, F4 not-symptomatic) and prevented a bad delete (`bin/mcp-server.js` is gated-KEEP).
* Neutral — F6/F7/F8c/T3/T4/F9p/F11-RVF are confirmed non-bugs / correct-as-is, documented not changed.
* Bad — F1's durable cure (tree-shrink) is deferred to its own ADR (cross-fork packaging risk); the interim
  only reduces cold-session frequency and cannot beat the 60s `MCP_TIMEOUT` cap on a >60s cold install.

### Confirmation

Each fix lands with an acceptance check wired into `test-acceptance*.sh` + `.github/workflows/` (per
`feedback-always-wire-tests-into-cicd`):
* **F3a** — run the route hook in a `type:module` sandbox; assert output ≠ "Router not available" (the
  previously-missing execution test). (Scope: routing advisory only — this check does **not** speak to F10.)
* **F5** — MCP boot log shows no `"real error, not module-missing"`; the live services init via Registry B.
* **F2** — `resources/list` returns `{ resources: [] }` (no `-32601`); arch-guard asserts the handler exists.
* **F8a** — `neural status` (CLI + MCP) reports 768-dim; **F4** — `doctor` reports Running including from a
  subdirectory; **F8e** — non-TTY output has no `\r`-frame spam.
* **F10** — after the chosen **capture-wiring** lands (its own ADR — emit `agentdb_reflexion-store` /
  `intelligence.recordTrajectory` from a PostTask/Stop hook), episodes accrue and `lastAdaptation` advances.
  **Not** "after F3a + F1" — those gate nothing here.
* Inherited-surface fixes (F2, R2, F4, F8b, F8e) each get an INTEGRATION-LEDGER row.

## More Information

* **Research plan & raw evidence:** `docs/research/2026-06-02-live-system-findings-research-plan.md`.
* **Builds on (intra-corpus):** ADR-0204/0267 (deferred MCP init), ADR-0274/0284/0285 (RVF locks/durability/purge),
  ADR-0177 (RVF vision; supersedes ADR-0170 graphAdapter retirement), ADR-0210 (advertised-surface honesty),
  ADR-0069 (config-canonical + Phase-2/4 exclusion), ADR-0207 (daemon liveness = PID-gated), ADR-0280/0277/0279
  (causal action-value substrate), ADR-0235 (init-helper seam), ADR-0112/0180 (independent-stores), ADR-0095
  (storage-factory), ADR-0166 (ReasoningBank-in-SQLite), ADR-0286 (RVF fail-loud), ADR-0068/0073/0086 (embedding
  dim / RVF / bsqlite placement).
* **Upstream (ruvnet, prose-reference only):** ADR-100 (cli-core lazy split), ADR-094 (xenova→optional), ADR-057
  (RVF native backend), RuVector ADR-029 (single canonical RVF format) / ADR-032 (flock lock model, RVF=source-of-truth),
  agentdb ADR-002/003 (RuVector>RVF>HNSWLib), ADR-073 (SOTA roadmap), ADR-006/ADR-125 (unified MemoryService / MemoryConsolidator).

### Storage inventory (ruflo-patch; `~/.claude/projects/.../memory/` is the separate cross-session auto-memory)

| Store | Path | Purpose | State |
|---|---|---|---|
| User-memory vectors | `.swarm/memory.rvf` (+`.meta`) | `memory_store`/`memory_search` corpus, 768-dim HNSW — **the real memory** | ✅ 1,226 entries, live (real embeddings) |
| AgentDB relational/graph | `.swarm/memory.db` | causal graph, hierarchical mem, episodes/skills/learning tables | ⚠️ only ADR graph populated (910/215/292); learning tables = 0 (F10) |
| Auto-memory RVF | `.swarm/agentdb-memory.rvf` (+`.meta`) | SessionStart hook insights (separate process) | ⚠️ siloed from `memory_search` (T1) |
| Auto-memory source | `.claude-flow/data/auto-memory-store.json` | 148 MEMORY.md/cross-project entries | ✅ |
| Intelligence graph | `.claude-flow/data/graph-state.json` | 148 nodes/144 edges; `[INTELLIGENCE]` suggestions | ✅ live |
| Neural / SONA | `.claude-flow/neural/{patterns,stats}.json`, `.swarm/sona-patterns.json` | 7 patterns / 715 trajectories / SONA state | ❌ frozen @ 2026-04-04 (F10) |
| RL sidecars | `.swarm/{q-learning-model,action-values,moe-weights}.json` | Q-table / action-value uplift / MoE | `action-values` live (T2); others never written |
| Config | `.claude-flow/{config.json,config.yaml,embeddings.json}` | runtime config (json canonical, ADR-0069) | ⚠️ doctor inverts the pick (F8b) |
| Audit / daemon / federation | `.claude-flow/data/archivist-audit.jsonl`, `daemon-state.json`, `federation/key-node-*.json` | audit log, worker history, federation ids | ✅ |

Removed during this work (verified safe — no handles, no readers): `.swarm/memory.graph` (legacy),
`.swarm/memory-rvf.sqlite`, `.swarm/memory.db.*-bak` (incl. the 2026-05-19 corruption snapshot),
`.swarm/memory.rvf.meta.tmp.*` (dead pids), `.claude-flow/agentdb/agentdb.sqlite` (empty orphan #2),
`.claude/memory.db` (vestigial 384-dim legacy). Live stores untouched. (`.swarm/` is gitignored; cleanup was
on-disk only.)

## Changelog (investigation arc — replaces the prior per-pass amendments)

* **2026-06-02 — Manual test + 4-agent research swarm.** Surfaced F1–F10; traced each to root cause.
* **2026-06-02 — Upstream cross-check (4 agents).** Per-finding CONFIRM/REFINE/CHALLENGE vs ruvnet `origin/main`.
  Key flips: F2 drop→add-handler; F1 = inherited bloat, adopt upstream ADR-100/094; F5 graphAdapter rationale stale
  (ADR-0170→0177); F3a stale-dogfood + createRequire mis-cite; F8b already-solved (narrow to stale doctor).
* **2026-06-03 — Dead-code audit (4 agents).** Exactly one confident DELETE (F5); `bin/mcp-server.js` is gated-KEEP
  (a blind delete would break a CICD check); surfaced the F8e spinner leak.
* **2026-06-03 — F9 substrate coherence + F10 frozen-learning + F11 upstream file-org.** `.swarm/` is a substrate
  federation, coherent-by-disjointness; learning frozen since 2026-04-04 (F1/F3a-gated); layout largely
  upstream-aligned; withdrew a SQL-blob-fallback idea (violates no-fallbacks); withdrew the F9-prune (gratuitous divergence).
* **2026-06-03 — Validation pass (5 agents).** Validated every finding + solution; refined F1 (60s `MCP_TIMEOUT`
  cap, agentdb-revert first step), R2 (discriminated re-throw), T1 (wire-via-router; dead drain-bridge = a lie),
  F3a (helper-target `.cjs` is load-bearing; upstream also bugged; un-retracted the createRequire claim), F8a
  (2 reporters), F4 (PID-write already done).
* **2026-06-03 — Trajectory-capture trace (live, MCP-connected; authoritative on F3a↔F10).** Traced every
  writer of `episodes`/`sona_trajectories`/`lastAdaptation` and its caller. **F3a does NOT gate F10:** the F3a
  target (`router.cjs`) is a pure `routeTask` recommender and `intelligence.cjs` (the live hook) writes only JSON
  — neither touches the learning substrate; F3a demoted HIGH-keystone → LOW cosmetic. **F10 root cause corrected:**
  not F1/F3a-gated but **dormant-by-design** — `episodes` is written only by the explicit `agentdb_reflexion-store`
  tool / CLI (`ReflexionMemory.storeEpisode`), `sona_trajectories` only by `agentdb_sona_trajectory_store`, and
  `lastAdaptation` only by the `ruflo neural` CLI (`intelligence.ts`); the `hooks_intelligence_trajectory-*` MCP
  tools are `enabled:false`, write only RVF `trajectories` + `sona-patterns.json`, and have no automatic caller.
  **Live proof:** a full trajectory `start→step→end` left `episodes`/`sona_trajectories`/`lastAdaptation`
  unchanged; only an explicit `agentdb_reflexion-store` moved `episodes` 0→1. **T1 corrected DELETE-not-rewire**
  (ADR-0083 = router-as-single-write-path; deleted the doSync drain + `check_adr0083_no_dosync_drain` guards it).
  **R2 sequencing mooted** (`routeMemoryOp`→RvfBackend, never `AgentDBBackend.storeInAgentDB`). F10 reframed as
  its own capture-wiring ADR.
* **2026-06-03 — Daemon + MCP restarted onto node 24; live re-evaluation (authoritative).** **Correction:** the
  node-22/sql.js processes were the **other ruflo projects on this machine (opda, hm)**, not ruflo-patch — the
  "daemon/MCP runs sql.js" finding was a cross-project misattribution. ruflo-patch's own daemon (PID 49267) + MCP
  server (PID 81846) are node-24/native; the live `memory_store`→`memory_search` round-trip works with real
  embeddings (0.59). Net: **F1 + F4 downgraded** (surfaces healthy), **T3/T4 sql.js items dropped** (cross-project),
  **F8a doubled** (MCP reporter also lies), **F3a still broken** (keystone). Reaffirmed: hand cherry-pick (not
  `--theirs`); ledger = `docs/upstream/INTEGRATION-LEDGER.md`.
* **2026-06-03 — F10 capture-wiring swarm (4 agents) + F5 reachability trace.** **F10:** confirmed
  dormant-by-design across upstream+fork+corpus and de-risked. Upstream INTENDS auto-capture but DEFERRED the
  Claude-Code seam (claude-flow ADR-074 calls the no-op a *bug*; post-edit/command deferred pending
  store-ownership, ADR-075); upstream+fork at PARITY on the dormant hook seam (fork ahead on `hooks_post-task`).
  Corrected this finding's "only via explicit tool" — the episode write chain is LIVE
  (`hooks_post-task`→`agentdb_reflexion_store`→`episodes`, ADR-0268); only the *trigger* is missing. F10 =
  unfinished PRODUCER half of ADR-0195 (ADR-0279 §R3 names a non-existent producer hook); most-starved consumer
  = NightlyLearner (hourly vs empty episodes) → ADR-0280 self-inert. Cheapest seam (a): wire file-based PostTask
  hook → `ruflo hooks post-task` (`hook-handler.mjs` / `settings-generator.ts`); no RVF-flock (SQLite carve-out).
  Biggest open decision = PII-redaction-before-write (new, ungoverned). Still its own ADR; no implementation.
  Raw findings: `docs/research/f10/01-04`. **F5:** reachability trace — the false banner is on agentic-flow's
  *own* fastmcp surface, not the live ruflo MCP boot (`@sparkleideas/ruflo` = claude-flow v3 never imports
  `AgentDBService`); `AgentDBService` is 100% fork-authored (absent from agentic-flow `origin/main`); delete
  loses no functionality (controllers live in agentdb Registry B). Opened a separate `/ruflo-swarm:swarm` to
  assess retiring the whole agentic-flow `AgentDBService`+fastmcp surface.
