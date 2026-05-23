# ADR-0191 + Follow-Ups — Coordination Map for 14 Implementer Agents

Status: planning artifact (read-only). Tells each agent EXACTLY which
files/lines to touch so two agents never edit the same hunks.

All line numbers are from HEAD at the time ADR-0191 was authored. All
"forks/" paths in callsites resolve under `/Users/henrik/source/forks/`
(NOT under `ruflo-patch/`). The detector resolves them via
`SCAN_ROOTS` in `scripts/check-undiscriminating-catches.mjs:43-46`.

---

## 1. ADR-0191 Cluster A–E — master callsite list

The 29 HIGH-class undiscriminating catches enumerated by ADR-0191's
Phase B "Per-callsite investigation" + "Cluster analysis" tables.
Disposition column = what the cluster-agent does. Anchor file paths
below are relative to the fork roots in `SCAN_ROOTS`.

### Cluster A — Optional dynamic import / requireCjs (7 catches)

| # | Callsite | Disposition | Reason |
|---|---|---|---|
| A1 | `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hooks-tools.ts:402` (`@claude-flow/memory`) | `tryOptionalImport` helper | #5 — listed in `cli/package.json:optionalDependencies` |
| A2 | `hooks-tools.ts:404` (`@claude-flow/agentdb`) | **DELETE catch** | #4 dead path — not in package.json, codemod doesn't alias |
| A3 | `forks/ruflo/v3/@claude-flow/memory/src/memory-router.ts:599` (`agentdb`) | **DELETE catch** | #4 — required dep, always installed |
| A4 | `forks/ruflo/v3/@claude-flow/cli/src/services/autopilot-state.ts:322` (`agentic-flow/coordination/autopilot-learning`) | `tryOptionalImport` helper | #5 — optionalDep + subpath; producer landed via ADR-0192 |
| A5 | `forks/ruflo/v3/@claude-flow/cli/src/services/intelligence.ts:1162` (`@ruvector/ruvllm` via `createRequire`) | `tryOptionalImport` helper | #5 — original ESM-vs-CJS bug site |
| A6 | `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/ruvllm-tools.ts:130` (`../memory/intelligence.js` + `../memory/sona-optimizer.js`) | **DELETE catch** | #4 — same-package internal imports |
| A7 | `ruvllm-tools.ts:138` (`../ruvector/graph-backend.js`) | **DELETE catch** | #4 — same-package internal |

Cluster A net: 4 deletes + 3 helper conversions.

### Cluster B — Controller registry + duck-type + `Promise.race` (10 catches)

All 10 get **catch + `console.error` log** (graceful-degradation contract preserved).

| # | Callsite | Notes |
|---|---|---|
| B1 | `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hooks-tools.ts:1015` | standard cluster B shape |
| B2 | `hooks-tools.ts:1046` | standard |
| B3 | `hooks-tools.ts:1064` | standard |
| B4 | `hooks-tools.ts:1090` | standard |
| B5 | `hooks-tools.ts:2075` | standard |
| B6 | `hooks-tools.ts:2970` | standard |
| B7 | `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/memory-tools.ts:495` (`queryOptimizer.getCached`) | **PLUS** init-default flip + registry case re-instrumentation (see §3) |
| B8 | `memory-tools.ts:581` | standard |
| B9 | `memory-tools.ts:614` | standard |
| B10 | `memory-tools.ts:629` | standard |

Each restoration: `} catch (e) { console.error('[<context>] graceful-degradation: ...', e); }`.

### Cluster C — `defender.hasPII` paranoia (2 catches)

Both: **DELETE catch**, call `defender.hasPII(input)` directly. Interface
guarantees the method at `@claude-flow/aidefence/src/index.ts:96`.

| # | Callsite |
|---|---|
| C1 | `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/security-tools.ts:166` |
| C2 | `security-tools.ts:475` |

### Cluster D — State files (5 catches)

All five: inline `if (e.code === 'ENOENT') return <default>; throw e;`
discrimination. `SyntaxError` propagates.

| # | Callsite | File parsed |
|---|---|---|
| D1 | `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/system-tools.ts:196` | agentdb tasks query (outer catch over query failure) |
| D2 | `system-tools.ts:211` | agent `store.json` |
| D3 | `system-tools.ts:224` | task `store.json` |
| D4 | `forks/ruflo/v3/@claude-flow/memory/src/memory-router.ts:399` | `config.json` |
| D5 | `forks/ruflo/v3/@claude-flow/cli/src/commands/doctor.ts:233` | `config.json` |

### Cluster E — HNSW status paranoia (2 catches)

Both: **DELETE catch**. Producer at `memory-router.ts:1845` already
returns typed `{success, error?, available?, entryCount?, dimensions?}`
and does not throw. Caller reads `.success` / `.available`.

| # | Callsite |
|---|---|
| E1 | `forks/ruflo/v3/@claude-flow/cli/src/commands/embeddings.ts:1385` |
| E2 | `forks/ruflo/v3/@claude-flow/cli/src/commands/performance.ts:425` |

### Singletons (3)

| # | Callsite | Disposition |
|---|---|---|
| S1 | `forks/ruflo/v3/@claude-flow/cli/src/services/worker-daemon.ts:1057` (`import('../memory/memory-router.js')`) | **DELETE catch** (#4 same-package) |
| S2 | `forks/ruflo/v3/@claude-flow/cli/src/commands/embeddings.ts:1394` (same router import) | **DELETE catch** (#4) |
| S3 | `forks/ruflo/v3/@claude-flow/cli/src/commands/security.ts:367` (`git rev-parse`) | `if (e.code === 'ENOENT' \|\| e.status === 128) return null; throw e;` |

Final tally: **8 deletes + 10 catch-with-log + 2 typed-contract calls
+ 4 `tryOptionalImport` conversions + 5 inline ENOENT discriminations
= 29 changes**, exactly matching ADR-0191 disposition table line 312.

---

## 2. Phase D gate wiring

**Phase E** in ADR-0191 §"Concrete plan" (line 208–210, naming
discrepancy: the ADR says "Phase E (gate flip)") wires the detector
into pre-flight.

**Host file**: `/Users/henrik/source/ruflo-patch/scripts/ruflo-publish.sh`

**Precise hook point**: insert ONE new `run_phase` line immediately
AFTER line 457 (the existing `silent-catches` phase), BEFORE the
`napi-rebuild` block at line 464. New line:

```bash
run_phase "undiscriminating-catches" node "${SCRIPT_DIR}/check-undiscriminating-catches.mjs"
```

Pattern follows the four existing detector phases (`napi-coverage`,
`fetch-timeout`, `silent-catches`) — same invocation shape, same
allowlist mechanism. Allowlist file already exists at
`lib/undiscriminating-catches-allowlist.txt` (currently 26 lines, all
comments — empty allowlist by design). Detector exits 1 on any
non-allowlisted finding, which `run_phase` propagates as pipeline
failure.

**Gate flip prerequisite** (per ADR-0191 line 208): wired ONLY after
HIGH (29 catches) + LOW (~80 catches) classes are closed. Wiring it
sooner trips on baseline noise. Today: detector reports 341 catches
(370 baseline − 29 HIGH fixed); 312 still remain in MEDIUM/LOW. The
gate flip cannot happen until the LOW revisit (Phase D in the ADR's
own naming) confirms patterns are safe.

---

## 3. ADR-0191 follow-ups (4 surfaced in §"Follow-up work")

ADR-0191 lines 506–575 enumerate four post-release-3 follow-ups. Exact
file/line locations:

1. **B7 queryOptimizer default flip**:
   `forks/ruflo/v3/@claude-flow/cli/src/init/config-template.ts:198`
   — flip `enabled.queryOptimizer: false` → `true`. Single line.
   Initial commit: `aa7c7673f`. Acceptance: `ctrl-cluster-b` check.

2. **B7 controller-registry case re-instrumentation**:
   `forks/ruflo/v3/@claude-flow/memory/src/controller-registry.ts:1922`
   — `case 'queryOptimizer'`. Replace bare `catch { return null }` with
   per-precondition `console.error` discrimination (config flag missing,
   tuning section missing, instantiation throw — each separately
   surfaced). Pattern: log reason, then `return null` only on
   recognised absence; rethrow unexpected.

3. **Doctor `checkControllers` health check (Task #22)**:
   `forks/ruflo/v3/@claude-flow/cli/src/commands/doctor.ts` — add a new
   check function alongside existing health checks. Reports per-
   controller registration state (total / active / inactive / errored).
   No exact line — appends to the existing `doctor` command's check
   registry; pattern follows existing `checkXxx` functions in the same
   file.

4. **`ctrl-cluster-b` acceptance check (Task #21)**:
   `/Users/henrik/source/ruflo-patch/lib/acceptance-harness.sh` —
   register a new check named `check_cluster_b_controllers_register`.
   Asserts all 10 Cluster B controllers register AND
   `queryOptimizer` is enabled in a fresh init project. Guards against
   B7 regression. Pattern follows existing controller-registration
   acceptance checks (`ctrl-routing`, etc.).

Plus the ADR-0192 spawn (autopilot-learning producer build) — already
landed; not in this 14-agent landing.

---

## 4. Landing D scope (ADR-0194 GNNService integration)

ADR-0194 §"Landing D — GNNService embedding enhancement (Option 2
follow-up)" at line 303–312.

**File**:
`/Users/henrik/source/forks/agentic-flow/agentic-flow/src/coordination/autopilot-learning.ts`

**Method**: lazy resolve `_gnnService` via
`_agentdb.getController?.('gnnService')` in the existing `initialize()`
epilogue (the same anchor block §1 of the existing coordination map
shows for Phase 3/4/5 wire-in). New private field:
`private _gnnService: GNNServiceLike | null = null;`

**Routing call**: when `_gnnService.getEngineType() === 'native'`, route
each embedding through `gnn.forward(embedding, kNN-neighbours, weights)`
inside `_clusterPath` (the new Phase 3 method introduced by Landing C)
BEFORE handing the embedding array to `clusterEpisodes`. When absent or
`'js'`, skip enhancement.

**Optional config flag parent interface**: `AutopilotLearningConfig`
(declared inline in `autopilot-learning.ts` per the ADR-0194 implementation
log row `f3e48a1` — "AutopilotLearningConfig + ResolvedClusterConfig"). The
new field is additive:

```ts
interface AutopilotLearningConfig {
  // existing cluster fields from Landing C
  clusterThreshold?: number;
  maxClusterSize?: number;
  minClusterSize?: number;
  labelStrategy?: 'centroid-nearest' | 'top-tokens';
  // Landing D additive:
  gnnEnhancement?: boolean;  // default true; observable via metrics
}
```

**Metrics extension**: `LearningMetrics.engine` widens from string to
object `{ algorithm: 'keyword' | 'embedding-cluster'; gnnEnhancement:
'native' | 'js' | 'disabled' }`. Per the existing coordination map
§6 Open question #3, gnnEnhancement field is added ONLY when Landing D
lands — not as part of Landing C.

---

## 5. Step-level subscription point (ADR-0195 open question #3)

ADR-0195 §"Open questions" #3 (line 409–415): "Should the LearningSystem
subscriber also consume `trajectory:closed` (in addition to
`episode:recorded`)? A closed trajectory has a full step sequence —
feeding each step as a separate `submitFeedback` gives finer-grained RL
learning than one episode-level feedback."

**Existing `trajectory:step` emit**:
`/Users/henrik/source/forks/agentic-flow/agentic-flow/src/coordination/autopilot-learning.ts:301-305`
— `_emitTrajectoryStep` fires AFTER each successful `addStep` call
during `recordIterationStep`. Already wired per the d06ba2c commit in
the ADR-0195 implementation log.

**Subscription point** for the LearningSystem step-level subscriber:
`/Users/henrik/source/forks/agentic-flow/agentic-flow/src/services/agentdb-service.ts`
— in the existing `_attachLearningSubscriber()` method (added per
commit 31a0c25 per ADR-0195 implementation log). Today subscribes only
to `episode:recorded`; add a parallel `learningEvents.on('trajectory:step',
this._handleAutopilotStep.bind(this))` registration. The new
`_handleAutopilotStep` private method translates `{trajectoryId, state,
action, reward}` payload into a `learningSystem.submitFeedback({...})`
call, using the SAME synthetic sessionId scheme as
`_handleAutopilotEpisode` (`autopilot:${sha1(subject)}` — but for
step-level, the synthesized key is `autopilot:trajectory:${trajectoryId}`
to keep step accumulation pinned to the trajectory's identity).

ADR-0195 P4.2 chose episode-level for the initial wire; step-level is
this follow-up. Recommendation: ship as opt-in via env var
`AUTOPILOT_STEP_LEVEL_FEEDBACK=1` since the N-inserts-per-swarm vs
1-insert tradeoff isn't yet measured.

---

## 6. Transport binding decision recommendation (ADR-0196)

ADR-0196 §"Considered Options" lists Options 1–4 but Option 2 (adapter
over `SyncCoordinator`) is chosen and accepted — **transport library
selection is explicitly deferred** (the implementation note at lines
17–26 names that out). Section "Out of scope" lines 343–346 enumerate
three candidates: `node:quic`, `@fails-components/webtransport`,
`node-quic`, plus HTTP/2 fallback.

**Recommendation**: `@fails-components/webtransport` + HTTP/2 fallback.

1. **`node:quic` is not yet stable**: Node 23 made it Stability:1 —
   "Experimental". The runtime test rig is single-host (M5 Max) so a
   real cross-host validation isn't possible; depending on experimental
   stdlib API multiplies the unknowns.
2. **`@fails-components/webtransport` is explicitly named in
   `QUICServer.ts:111-112` in-source disclaimer** as the reference
   target. The agentdb fork's QUIC interface was designed against this
   library's shape; picking it minimizes the transport-wiring delta.
3. **HTTP/2 fallback handles the "no real QUIC peer reachable" case**
   (single-host loopback, restrictive corp networks, container env
   without UDP). The `@fails-components/webtransport` package supports
   HTTP/3 transport over QUIC AND falls back via standard `node:http2`
   plumbing — one library covers both paths.
4. **`node-quic` is unmaintained** (last npm publish 2022); not viable.
5. **Decision belongs to a separate ADR** (per ADR-0196 closure
   criterion #3): create a new ADR proposed/accepted before flipping
   ADR-0196 to `implemented` — the runtime ADR is the gating artifact.

---

## 7. CLI dispatcher shape (autopilot-cli.ts)

**Path**:
`/Users/henrik/source/forks/agentic-flow/agentic-flow/src/cli/autopilot-cli.ts`
(503 lines on HEAD).

**Dispatcher entry**: `handleAutopilotCommand(args)` at line 458 with a
`switch` on `args[0]` (lines 462–497). New subcommands plug in by:

1. Add a new `case '<subcommand>':` in the switch block (lines 467–493).
2. Implement `async function show<X>(opts): Promise<void>` following
   the pattern of `showLearn` (264–319), `showHistory` (321–380),
   `showPredict` (382–420). All three:
   - dynamically `import('../coordination/autopilot-learning.js')`,
   - construct `new AutopilotLearning()`,
   - `await learning.initialize()`,
   - branch on `opts.json` vs human-readable output,
   - wrap whole body in `try { ... } catch (error) { console.error(...) }`.
3. Register option parsing in `parseOptions(args)` at lines 78–98 if
   the new subcommand takes flags beyond `--json`/`--limit`/`--query`.
4. Update `printHelp()` lines 422–456: COMMANDS block + EXAMPLES block.

**Type drift caveat** (ADR-0195 line 85, "Pre-existing `autopilot-cli.ts`
type drift"): the existing `showLearn` / `showHistory` / `showPredict`
implementations reference properties (`successRate`, `taskType`,
`approach`, `uses`, `success`, `similarity`, `task`, `alternatives`)
that are NOT on the current `DiscoveredPattern` / `AutopilotEpisode` /
`predictNextAction` return types — masked by `tsc --noCheck`. ADR-0198
Finding 2 owns this fix (A7 agent slot in the existing coordination
map §6). New subcommand implementers should reference the actual
typed shapes (verified in this report's §1 cross-check above), NOT
the existing CLI's stale accesses.

---

## 8. File ownership matrix

Agents are labelled by ADR phase. **OVERLAP** entries flag where two
agents touch the same file or interface — these require merge-order
discipline (see ADR-0191 + adr0194-0196-coordination-map.md §5).

| Agent | ADR scope | Files owned | Overlap risk |
|---|---|---|---|
| ClusterA | ADR-0191 Cluster A (7 sites) | `hooks-tools.ts:402,404`, `memory-router.ts:599`, `autopilot-state.ts:322`, `intelligence.ts:1162`, `ruvllm-tools.ts:130,138`. Adds `tryOptionalImport` helper to a new `lib/optional-import.ts` shared with S1/S2. | Shares `hooks-tools.ts` with ClusterB (different lines: A at 402/404, B at 1015–2970). Safe via line separation. |
| ClusterB | ADR-0191 Cluster B (10 sites + B7 follow-ups) | `hooks-tools.ts:1015,1046,1064,1090,2075,2970`, `memory-tools.ts:495,581,614,629`. Plus follow-up §3.1 (`config-template.ts:198`), §3.2 (`controller-registry.ts:1922`), §3.4 (acceptance check in ruflo-patch `lib/acceptance-harness.sh`). | Shares `hooks-tools.ts` with ClusterA; shares `lib/acceptance-harness.sh` with no other agent in this landing. |
| ClusterC | ADR-0191 Cluster C (2 sites) | `security-tools.ts:166,475`. | None. |
| ClusterD | ADR-0191 Cluster D (5 sites) | `system-tools.ts:196,211,224`, `memory-router.ts:399`, `doctor.ts:233`. Plus follow-up §3.3 `doctor.ts` `checkControllers` check. | **Shares `doctor.ts` with itself** (D5 + §3.3): single agent, no inter-agent conflict, but coordinate the two edits in one PR. Shares `memory-router.ts` with ClusterA (different lines: A at 599, D at 399). Safe via line separation. |
| ClusterE | ADR-0191 Cluster E (2 sites) | `embeddings.ts:1385`, `performance.ts:425`. | **Shares `embeddings.ts` with S2** (E1 at 1385, S2 at 1394 — adjacent lines, single PR). Recommend: merge ClusterE + Singletons into one agent. |
| Singletons | ADR-0191 S1+S2+S3 | `worker-daemon.ts:1057`, `embeddings.ts:1394`, `commands/security.ts:367`. | Shares `embeddings.ts` with ClusterE; recommend co-landing. |
| 0194D | ADR-0194 Landing D | `autopilot-learning.ts` Phase 3 anchor block + `_gnnService` field, optional `gnnEnhancement` config. | **Shares `autopilot-learning.ts` with 0195step, 0196transport** — see existing coordination map §5 risk row "method anchor blocks". Land AFTER Landing C is stable (per ADR-0194 §"Implementation phases"). |
| 0195step | ADR-0195 trajectory-step subscriber | `agentdb-service.ts` `_attachLearningSubscriber` extension + new `_handleAutopilotStep` private method. | Shares `agentdb-service.ts` with 0196transport (different methods; safe). Shares no source-file edits with 0194D — pure subscriber addition. |
| 0196transport | ADR-0196 transport binding | NEW ADR file `docs/adr/ADR-0199-federation-runtime-transport.md` (or next-sequential), Plus `forks/agentdb/package.json` adding `@fails-components/webtransport` dep, plus socket bind in `QUICServer.start()` + connect in `QUICClient.connect()`. | **Shares `agentdb-service.ts`** with 0195step — but 0196transport touches QUIC bind path, 0195step touches LearningSystem subscriber. No line overlap. |
| CLIa | New subcommands for engine/metrics observability | `autopilot-cli.ts` new `case 'metrics':` showing `LearningMetrics.engine` + `gnnEnhancement` from §4. | **Shares `autopilot-cli.ts` with CLIb, A7 (ADR-0198)** — single dispatcher, multiple new cases. Resolve by merge-order; each new case is its own contiguous block. |
| CLIb | New subcommand for federation status | `autopilot-cli.ts` new `case 'federation':` showing `getSyncProvider().getLocalInstallId()` + last sync status. | Shares `autopilot-cli.ts` with CLIa + A7. Same merge-order resolution. |
| doc-reconcile | INTEGRATION-LEDGER row + USERGUIDE update | `docs/upstream/INTEGRATION-LEDGER.md` append-row, `docs/USERGUIDE.md` updates for new CLI subcommands. | None — pure docs. Lands LAST after all source agents complete. |

**Cross-agent overlap warnings**:

1. **`hooks-tools.ts`** — touched by both ClusterA (lines 402, 404) and
   ClusterB (lines 1015–2970). Different line ranges; safe to land in
   parallel BUT both PRs must rebase if either changes line numbering
   above the other's region. Recommend ClusterA lands first (deletes
   shrink the file; ClusterB rebases trivially).

2. **`embeddings.ts`** — ClusterE (1385) and S2 (1394) sit 9 lines
   apart. Strongly recommend folding into one agent's PR.

3. **`memory-router.ts`** — A3 (599) and D4 (399) are in the same file.
   Different methods, 200 lines apart; safe parallel.

4. **`doctor.ts`** — D5 (233) and §3.3 `checkControllers` are the same
   file. Same agent (ClusterD) owns both; co-land in one PR.

5. **`autopilot-learning.ts`** — the canonical 3-way merge point per the
   existing coordination map. 0194D, 0195step (subscriber, but agentdb-
   service.ts side) and 0196transport (no source edit in this file).
   Real risk is 0194D's `_gnnService` field addition vs the existing
   Phase 3/4/5 anchor blocks already merged. Lands inside the Phase 3
   anchor block — no overlap with Phase 4/5 anchors.

6. **`autopilot-cli.ts`** — three additions to the dispatcher (CLIa
   metrics, CLIb federation, A7 type-drift fix). Each owns disjoint
   `case` blocks but shares `parseOptions` + `printHelp` updates. Land
   in declared order: A7 (rename-only existing accesses) → CLIa → CLIb.

7. **`lib/acceptance-harness.sh` (ruflo-patch)** — only ClusterB touches
   it (`check_cluster_b_controllers_register`). No overlap.

8. **`scripts/ruflo-publish.sh` (ruflo-patch)** — Phase D gate flip
   (§2) is the ONLY change. Gated by ALL HIGH + LOW closure — does NOT
   land in this 14-agent batch unless LOW is empirically zero after
   ClusterA–E close. Recommend: defer to a separate Phase E agent run
   once detector reports zero non-allowlist findings.

---

End of coordination report. Cross-reference with
`/Users/henrik/source/ruflo-patch/docs/plans/adr0194-0196-coordination-map.md`
for the autopilot-learning byte-range matrix (§1) and existing risk
list (§5) — that document remains the authority for the 0194/0195/0196
overlap details inside `autopilot-learning.ts`.
