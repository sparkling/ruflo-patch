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
defects and **honesty gaps around that healthy core** — most are reporters/wiring, one is a
keystone load bug, and several first-pass conclusions were **corrected** by the later passes
(notably: the node-22/sql.js processes were *other projects* — opda/hm — not ruflo-patch; the
daemon "Not running" and the write-visibility "lag" did not hold up).

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
* **D — Do nothing** (ignores the keystone F3a, which fails every turn).

## Decision Outcome

**Chosen: Option A.** The findings came from one investigation sweep and share context; a single
record keeps the evidence, the upstream-alignment, and the priority order together. Each finding
below carries its **validated root cause, current status, disposition, and provenance/merge-risk**.

### Findings

**F3a [HIGH — keystone] — Hook-time router fails to load ("Router not available" every turn).**
`.claude/helpers/{router,session,memory}.js` are CommonJS, but the project `package.json` declares
`"type":"module"`, so Node parses them as ESM and the load throws (`module is not defined`); the
hook-handler's loader swallows it → `router = null` → the `[INFO] Router not available` branch.
Reproduced in a fresh `init` sandbox. **The load-bearing fix is renaming the helper *targets* to
`.cjs`** — neither `createRequire` nor a `.cjs` *dispatcher* helps, because Node resolves
`router.js` by the package's `type:module` regardless of the requiring module's scope (upstream's
own generator is therefore *also* bugged here; only the fork-root dogfood went fully `.cjs`).
*Status:* **still firing live** this session even with MCP connected (it's independent of MCP).
*Disposition:* rename `router/session/memory.js → .cjs` in the generator (`helpers-generator.ts`
~:1212-1221) + `executor.ts` + adopt upstream's `hook-handler.cjs` dispatcher; re-dogfood this
repo's `.claude/`; **add an execution smoke** (run the route hook in a `type:module` sandbox, assert
≠ "Router not available") — its *absence* is why this shipped through every green release. Rewrite
the `init-helpers-parity.test.mjs` assertion that wrongly blesses `createRequire` as the fix.
*Provenance:* inherited generator, fork ahead on `.cjs`; merge risk moderate (collides with
upstream's in-flight `.mjs→.cjs` dispatcher migration — converge on it).

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
`.swarm/q-learning-model.json` with `SonaOptimizer.processTrajectoryOutcome` (live-trained via the MCP hook
path, `hooks-tools.ts:3037`), so it is **not** orphaned — just cold here (no trajectory traffic; F10/F3a).
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
ledger row + arch test (forced write-failure ⇒ throws). Sequence **before** any T1 wiring that puts
`AgentDBBackend` back on a hot path. *Provenance:* inherited verbatim (fork added only a comment) → merge-taxed.

**T1 [MED] — auto-memory hook's `agentdb-memory.rvf` silo + a dead drain-bridge.** The SessionStart hook
(`auto-memory-hook.mjs:247-255`) writes a **separate** `.swarm/agentdb-memory.rvf` in its own process,
**invisible to `memory_search`** unless the `memory-bridge` skill runs. Worse, its in-process "drain into
main memory" path (`:319-341`) is **dead code** — it imports the `memory-initializer` that ADR-0086 deleted
(`existsSync` permanently false). ADR-0083 already mandates converging silos through the single write path.
*Disposition:* **WIRE** the drain through `routeMemoryOp('store')` (replace the dead import); retire
`agentdb-memory.rvf` as a durable store — *not* "keep as tenant" (that ratifies a silo ADR-0083 set out to
remove and doubles the `flock` surface, ADR-0032/0284). Closes an ADR-0210 lie. *Provenance:* hook inherited,
RVF-target + dead-bridge fork-only; low merge risk; ledger the hook divergence.

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

**F10 [HIGH-impact, gated] — the learning/adaptation layer is frozen.** SONA last adapted **2026-04-04**
(`neural/stats.json` `lastAdaptation`; all 7 `neural/patterns.json` share that timestamp); the `learn` worker
finds 0 episodes; every AgentDB learning table (`episodes`/`learning_experiences`/`reasoning_patterns`/`skills`)
= 0; RL sidecars never written. Only the **ADR knowledge graph** is populated (`causal_edges`=910,
`adr_node_ids`=215, `hierarchical_memory`=292 — written by `adr-index`, not learning). *Root cause:* the
AgentDB/SONA learning **input** path (episode/trajectory capture) flows through the MCP/hook surface, which is
gated by **F1 + F3a**; the file-based intelligence-graph JSON stays warm, but the learning substrate is starved.
*Status:* MCP being up this session is **necessary-not-sufficient** — F3a is still down, so no trajectory capture
flows. *Disposition:* **gated on F3a** (+ F1); after fixing, confirm episodes accrue and `lastAdaptation`
advances. The stores are not broken — they are **starved**.

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
| 1 keystone | **F3a** | rename helpers → `.cjs` in the generator + re-dogfood + **execution smoke**; rewrite the parity test | moderate (converge w/ upstream `.mjs→.cjs`) |
| 2 code lies | **F5** | delete the Phase-2 block + call site | none (fork-only) |
| 2 code lies | **F2** | add `{resources:[]}` handler to **both** bins + ledger + arch-guard | negligible |
| 3 reporters | **F8a** | plumb real dim into CLI + MCP reporters (+ type + native literal) | ~none |
| 3 reporters | **F8e** | `isTTY` guard on Spinner/ProgressBar | low |
| 3 reporters | **F8b** | reconcile `doctor.ts` to JSON-canonical (verify drop-yaml separately) | low |
| 3 reporters | **F3b** | relabel the default `route` box as untrained from live stats | low |
| 4 storage | **T1** | wire auto-memory drain via `routeMemoryOp`; retire `agentdb-memory.rvf` | low |
| 4 storage | **R2** | discriminated re-throw (before any T1 hot-path wiring) + ledger + arch test | merge-taxed |
| 4 storage | **F4** | anchor `doctor.ts:166` PID path to project root | low |
| 5 pipeline | **F8d** | republish ruvllm @ pin + wire `__claudeFlowSonaStats` + fix comment | pipeline |
| band-aid (decided) | **F1** | `MCP_TIMEOUT=60000` in Claude Code's launch env — only. Tree-shrink + cache-warm dropped (downgraded; not worth it) | none (operator env) |
| gated | **F10** | re-verify learning resumes after F3a + F1 | — |
| keep / none | **T2, T3, T4, F6, F7, F8c, F9p, F11-RVF** | documented; no code change | — |

**Implementation note:** F3a is the only finding actively breaking on every turn, and it gates F10 — do it
first. F5 + F2 are self-contained honesty fixes. Everything in tier 3+ is low-risk cleanup.

### Consequences

* Good — fixing F3a restores hook-time routing (failing every turn) and unblocks F10's learning input.
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
  previously-missing execution test).
* **F5** — MCP boot log shows no `"real error, not module-missing"`; the live services init via Registry B.
* **F2** — `resources/list` returns `{ resources: [] }` (no `-32601`); arch-guard asserts the handler exists.
* **F8a** — `neural status` (CLI + MCP) reports 768-dim; **F4** — `doctor` reports Running including from a
  subdirectory; **F8e** — non-TTY output has no `\r`-frame spam.
* **F10** — after F3a + F1, episodes/trajectories accrue and `lastAdaptation` advances.
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
* **2026-06-03 — Daemon + MCP restarted onto node 24; live re-evaluation (authoritative).** **Correction:** the
  node-22/sql.js processes were the **other ruflo projects on this machine (opda, hm)**, not ruflo-patch — the
  "daemon/MCP runs sql.js" finding was a cross-project misattribution. ruflo-patch's own daemon (PID 49267) + MCP
  server (PID 81846) are node-24/native; the live `memory_store`→`memory_search` round-trip works with real
  embeddings (0.59). Net: **F1 + F4 downgraded** (surfaces healthy), **T3/T4 sql.js items dropped** (cross-project),
  **F8a doubled** (MCP reporter also lies), **F3a still broken** (keystone). Reaffirmed: hand cherry-pick (not
  `--theirs`); ledger = `docs/upstream/INTEGRATION-LEDGER.md`.
