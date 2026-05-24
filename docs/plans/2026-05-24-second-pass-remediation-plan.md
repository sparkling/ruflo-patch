# Second-pass remediation plan (2026-05-24)

Companion to [[ADR-0233]] (Second-pass soundness audit findings) and [[ADR-0201]] (audit methodology + pre-flight checklist).

This plan is assembled from 15 parallel swarm reviews — one per remediation ADR
([[ADR-0234]] through [[ADR-0248]]). Each review: 6 named experts + 1 devil's
advocate, a consensus protocol chosen for the ADR's decision shape, upstream-intent
analysis, ADR-180+ alignment analysis, critique + improvements applied to the ADR.
Per-ADR sections below are assembled from `docs/plans/.frags/ADR-XXXX-review.md`
after all 15 swarm reviews complete.

## Triage order (from ADR-0233 §Decision)

1. CT-G [[ADR-0240]] stdio-corruption
2. CT-M [[ADR-0246]] AgentDB internals (3 CRITICAL data-integrity)
3. CT-B [[ADR-0235]] wrapper-bundled-helpers drift
4. CT-A [[ADR-0234]] silent fallback completions
5. CT-K [[ADR-0244]] CLI per-command honesty
6. CT-L [[ADR-0245]] pipeline robustness + set-e
7. CT-O [[ADR-0248]] plugin marketplace integrity
8. CT-C [[ADR-0236]] hardcoded-list drift lint
9. CT-E [[ADR-0238]] surface wire-or-remove
10. CT-F [[ADR-0239]] dead-code triage
11. CT-H [[ADR-0241]] schema reconciliation
12. CT-D [[ADR-0237]] silent clamps
13. CT-N [[ADR-0247]] security follow-ups
14. CT-J [[ADR-0243]] resource discipline
15. CT-I [[ADR-0242]] error taxonomy

Singleton fast-track (no ADR — direct fixes): F-08-003, F-08-004.

---

## Orchestration constraints (verified 2026-05-24)

- **Agent Teams are 1-at-a-time per session.** `TeamDelete` takes no parameters and uses "the current session's team context" — only one active team at a time. If we used Agent Teams (transport (b) SendMessage from `hive-mind-advanced` skill) for swarm reviews, max parallelism collapses to 1 (sequential).
- **Workers don't need to revise after seeing peers** for ADR-review work — the dialectic is one-round, with the queen synthesizing from independent expert returns. Cross-talk happens at the synthesis layer, not the per-expert layer. → Transport (a) "queen-composed" is sufficient for all 15 ADRs.
- **Decision**: all 15 swarm reviews use queen-composed transport (no Agent Teams). Parallel cap of 3-per-wave is preserved; 5 waves total.
- **Each swarm is roleplay, not real sub-agents**. 15 × 6 expert sub-agents = 90 concurrent sub-agents would be much heavier than the marginal value. The 6 expert personas are a reasoning framework executed by a single top-level Agent per ADR, following the `hive-mind:hive-mind-advanced` skill's Pattern 1 (Council Hive) / Pattern 4 (Review Hive) / Pattern 2 (Consensus Decision Hive) recipes.

## Per-ADR swarm configuration (initial pass)

For each remediation ADR: the hive pattern, consensus protocol, topology, queen type, expert panel (6 specialists incl. devil's advocate), and notes on why this configuration fits. References the four canonical patterns from `hive-mind:hive-mind-advanced`:

- **P1 Council Hive (Dialectic)** — N named experts cite methodology, devil's advocate dissents, queen composes transcript. Best for contested decisions needing reasoned debate.
- **P2 Consensus Decision Hive (BFT)** — propose → vote → resolve. Best for discrete decisions (which option, ratify yes/no).
- **P3 Implementation Hive (Coordinated Development)** — architect-vote → parallel build → review-vote. Best for hybrid design+execution.
- **P4 Review Hive (Multi-perspective)** — N reviewers each carry a checklist, per-finding severity vote, queen aggregates. Best for surface/cluster triage with many independent findings.

| ADR | CT | Pattern | Consensus | Topology | Queen type | N | Devil's Adv | Cross-talk | Memory | Rationale |
|-----|-----|---------|-----------|----------|------------|---|-------------|------------|--------|-----------|
| 0234 | CT-A | P1 Council | byzantine | hierarchical-mesh | strategic | 6 | ✓ | queen-composed | hybrid | Merge-tax dialectic — 2 of 5 sites byte-identical with upstream; correctness vs merge-cost contested |
| 0235 | CT-B | P2 Decision | quorum (majority) | hierarchical | tactical | 5 | ✓ | queen-composed | hybrid | Pick among combined Option B+D vs A vs C vs D; clear options, no dialectic needed |
| 0236 | CT-C | P2 Decision | weighted | hierarchical | tactical | 4 | ✓ | queen-composed | hybrid | Lint vs single-source vs generator; queen-led — pipeline owner authority |
| 0237 | CT-D | P2 Decision | quorum (majority) | hierarchical | tactical | 4 | ✓ | queen-composed | hybrid | Result vs throw vs lint-only — clear technical decision |
| 0238 | CT-E | P4 Review | quorum (majority) per-surface | mesh | strategic | 6 | ✓ | queen-composed (per-surface independent) | hybrid | 8 unused surfaces; per-surface wire-or-remove vote with queen synthesis |
| 0239 | CT-F | P4 Review | quorum (supermajority) per-cluster | mesh | strategic | 6 | ✓ | queen-composed | hybrid | 8 dead-code clusters; supermajority required for delete (irreversible); cross-bonus dependencies tracked via queen |
| 0240 | CT-G | P2 Decision | quorum (majority) | hierarchical | tactical | 3 | ✓ | queen-composed | context only | Smallest swarm; 2 sites, clear winner (route to stderr); minimal panel |
| 0241 | CT-H | P1 Council | byzantine | hierarchical-mesh | strategic | 6 | ✓ | queen-composed | hybrid | Already inverted (relax-not-tighten); dialectic on arch-test value + dedupe deferral |
| 0242 | CT-I | P1 Council | weighted | hierarchical-mesh | strategic | 6 | ✓ | queen-composed | hybrid | Cultural debt scope dialectic; queen-led (maintainer prioritises adoption pace) |
| 0243 | CT-J | P2 Decision | quorum (majority) | hierarchical | tactical | 4 | ✓ | queen-composed | hybrid | In-tree healthy patterns to apply; clear roadmap |
| 0244 | CT-K | P1 Council | byzantine | hierarchical-mesh | strategic | 6 | ✓ | queen-composed | hybrid | Highest merge-tax density (6/11 byte-identical with upstream); per-site disposition contested |
| 0245 | CT-L | P2 Decision | quorum (majority) | hierarchical | tactical | 4 | ✓ | queen-composed | hybrid | Hybrid A+B+C decision; per-site + helper + lint; clear options |
| 0246 | CT-M | P1 Council | byzantine | hierarchical-mesh | strategic | 6 | ✓ | queen-composed | hybrid | 3 CRITICAL data-integrity; test-first vs implement-first; F-03-002 fork-only vs F-03-001/003 byte-identical with upstream |
| 0247 | CT-N | P2 Decision | quorum (majority) | hierarchical | tactical | 5 | ✓ | queen-composed | hybrid | Own-some + defer-others (matrix Option B-extended); cross-ADR scoping |
| 0248 | CT-O | P4 Review | quorum (majority) per-plugin | mesh | strategic | 6 | ✓ | queen-composed | hybrid | Per-plugin disposition (delete/publish/rewrite); marketplace lint cross-cuts |

### Expert panel composition (specialist roles per ADR)

Each panel has 6 experts including 1 devil's advocate. Roles are ADR-specific; chosen to cover the surface's blind spots. All experts spawn via Claude's Agent tool with `subagent_type: researcher` — the persona is carried in the prompt body per the hive-mind skill's contract.

| ADR | Expert 1 | Expert 2 | Expert 3 | Expert 4 | Expert 5 | Devil's Advocate |
|-----|----------|----------|----------|----------|----------|------------------|
| 0234 | RVF/embedding upstream historian (ADR-0095 lineage) | Fork-divergence specialist (byte-identical site catalog) | Behavior-test architect | Maintainer merge-tax proxy | Reliability/failure-mode specialist | DA: "ADR-0095 amendment should have been universal — why surgical?" |
| 0235 | Init template specialist (helpers-generator vs bundled static) | Codemod-scope specialist (ADR-0215 model) | Brand-rebrand archeologist (ADR-0143) | Build-pipeline specialist | npx-installation simulator | DA: "Delete bundled static → break first-time installs offline" |
| 0236 | Pipeline-script specialist (5 registries inventory) | ADR-0231 wave-A9 archeologist | Lint-DX specialist (developer-friction) | Single-source-of-truth advocate | Drift-detection mechanic | DA: "Lint is theatre — single-source is the only real fix" |
| 0237 | Rust setter-API specialist (sona_instant.rs) | Clippy lint-discipline specialist | WASM-bindgen JS-boundary specialist | Upstream sync-tax specialist | Hyperparameter UX specialist | DA: "Honor user input → silent NaN propagation downstream" |
| 0238 | Security-stack specialist (AIDefence + claims) | Consensus-protocol specialist (raft/byzantine/gossip) | Telemetry specialist (OTel + observability) | Stub-honesty mandate specialist (ADR-0210) | Upstream-activity tracker | DA: "Quarantine is just permanent dead code — delete" |
| 0239 | Dead-code archeologist (per-cluster scope) | CVE-relocation specialist (transformers-loader move) | Plugin-publish-state specialist (gastown/agentic-qe npm) | Parallel-implementation pattern detective | Lint-gate engineer (no-new-dead-code) | DA: "57K LOC delete is irreversible — staged-deletion gates" |
| 0240 | MCP-StdioServerTransport specialist | Node-IO discipline specialist (stdout vs stderr) | — | — | — | DA: "Just stop logging from MCP servers altogether" |
| 0241 | MCP inputSchema specialist (`required` semantics) | Handler-validation specialist (write vs read asymmetry) | Type-deduplication specialist (MCPTool 23 defs) | Zod-arch-test specialist | Upstream-coherence tracker | DA: "Relaxing the schema validates ad-hoc client behaviour" |
| 0242 | Error-class hierarchy specialist (gastown-bridge gold standard) | MCP-envelope specialist (`success:false` swallowing) | Lint-grandfathering specialist | Retry-library consolidation specialist | Migration-pace specialist | DA: "Shared error library will rot just like the dead retry libs" |
| 0243 | NAPI/WASM handle lifecycle specialist | Timer-unref discipline specialist | Signal-handler idempotency specialist | LRU/eviction pattern specialist (`HiveLRU`) | Long-lived-process operator | DA: "ESLint rules become security theatre — perf-monitor instead" |
| 0244 | CLI subcommand specialist (45-command surface) | Argument-parser specialist (`applyDefaults` coercion) | Brand-rebrand codemod specialist (ADR-0143 Pass 7) | Fork-divergence specialist (6/11 byte-identical) | UX honesty specialist (stub-honesty per ADR-0210) | DA: "11 sites of merge-tax for honesty — accept some dishonesty" |
| 0245 | Bash set-e discipline specialist | Pipeline-helper-extraction specialist (`run_phase_norevert`) | Machine-pinned-path specialist (Hetzner cleanup) | Lint-DX specialist | Best-effort vs fatal-rethrow specialist | DA: "Lint over discipline is more theatre — fix the actual scripts" |
| 0246 | RVF substrate-persistence specialist (ADR-0073 lineage) | Archivist invariant-timing specialist (ADR-0180 charter) | HNSW-parameter derivation specialist | Behavior-test-first advocate | Upstream-fork divergence specialist | DA: "F-03-002 charter says BEFORE — implement transactional substrate, not amend charter" |
| 0247 | PII detection coverage specialist | AIDefence learning-poisoning specialist | MCP isError envelope specialist | Caller-identity specialist | Upstream-not-wired tracker | DA: "F-04-006/007 deferred = forever-deferred; force the issue" |
| 0248 | Plugin marketplace architect | MCP tool-registration specialist (ADR-0117 pattern) | Plugin-publish lifecycle specialist | Hand-edit vs codemod-scope specialist | Brand-rebrand archeologist (ADR-0143) | DA: "All 2 code-shipping plugins are DOA — delete from marketplace" |

### Cross-cutting orchestration notes

* **Memory backend**: `hybrid` (RVF + JSON sidecar) for all swarms with persistent transcripts. CT-G uses `context` only (small swarm, short-lived). Per ADR-0122 typed buckets, write final consensus to `type: consensus`, in-flight transcripts to `type: context`.
* **Session ID convention**: `swarm-review-ADR-XXXX-{timestamp}` — survives session restart per skill's resume semantics.
* **Failure handling**: skill's WORKER FAILURE PROTOCOL applies — 60s timeout, retry-once, never wait indefinitely. With roleplay execution, failures manifest as the top-level Agent returning incomplete consensus; treat as one-shot, no retry.
* **Devil's advocate explicit withdrawal**: per skill best-practice #6, DA must explicitly withdraw or hold principled dissent. The queen's synthesis MUST document the DA's final position (no vague "all agreed").
* **Upstream intent analysis source**: read from `/Users/henrik/source/ruvnet/<repo>/` (per `[[reference-ruvnet-upstream-repos]]` — all 4 forks have local upstream mirrors verified at scaffold-time).
* **ADR-180+ intent analysis source**: grep `/Users/henrik/source/ruflo-patch/docs/adr/ADR-0{180..232}-*.md` for tags + concepts. Each swarm reads its ADR's `depends-on:` list as a starting point.

### Execution waves (triage-ordered, 3 per wave)

| Wave | ADRs | Rationale |
|------|------|-----------|
| 1 | CT-G [[ADR-0240]], CT-M [[ADR-0246]], CT-B [[ADR-0235]] | Top 3 triage priority; mix of small (CT-G) + high-stakes (CT-M) + structural-gate (CT-B) |
| 2 | CT-A [[ADR-0234]], CT-K [[ADR-0244]], CT-L [[ADR-0245]] | Triage 4-6; CT-A + CT-K share merge-tax pattern; CT-L is pipeline |
| 3 | CT-O [[ADR-0248]], CT-C [[ADR-0236]], CT-E [[ADR-0238]] | Triage 7-9; cross-bonus + lint-shape decisions |
| 4 | CT-F [[ADR-0239]], CT-H [[ADR-0241]], CT-D [[ADR-0237]] | Triage 10-12; CT-F is largest (57K LOC); CT-H + CT-D are surgical |
| 5 | CT-N [[ADR-0247]], CT-J [[ADR-0243]], CT-I [[ADR-0242]] | Triage 13-15; lowest-urgency batch |

### Per-ADR write-target

Each swarm writes to ONE per-ADR fragment file (`docs/plans/.frags/ADR-XXXX-review.md`) to avoid plan-doc race conditions. After all 15 complete, fragments are assembled into this plan doc (atomic merge step). The fragment schema is documented in each swarm's prompt template.

---

## Per-ADR remediation plans (post-swarm-review, 2026-05-24)

Assembled from 15 swarm-review fragments under `docs/plans/.frags/`. Each plan was synthesized by a 6-expert (or 4-6) dialectic with a devil's advocate and the consensus protocol chosen for the ADR's decision shape per the configuration table above. The full swarm transcript per ADR is appended to its ADR file (look for `## Swarm review (2026-05-24)` section in `docs/adr/ADR-XXXX-*.md`).

Triage-ordered. Each plan is self-contained: status, decision (post-review), implementation steps, dependencies, validation, top risk + mitigation.

---

## ADR-0240 — CT-G: stderr-only logging for StdioServerTransport

**Status**: proposed (post-swarm-review)
**Swarm**: 3 experts + devil's advocate, Quorum-majority consensus
**Triage rank**: 1 (highest priority per [[ADR-0233]] §Decision)

### Decision (post-swarm-review)

Apply **Option A + narrow Option B lint rider** as originally drafted, with two scope
clarifications surfaced by the panel: (i) the Source-shape Confirmation gate is narrowed
to `agentdb-mcp-server.ts` specifically — the surrounding agentdb cli paths contain 60+
legitimate `console.log` calls that are out of CT-G scope per F-05-007; (ii) the lint
rider creates a new ESLint config under `forks/agentdb/.eslintrc*` (and conditional
`forks/ruflo/v3/mcp/.eslintrc*` per CT-F outcome) since neither file exists today. Site
#2 (agentdb) ships unconditionally; site #1 (v3/mcp/) is contingent on [[ADR-0239]]
(CT-F cluster 2) deciding to keep v3/mcp/. DA holds principled dissent on stderr-pipe
pressure under high tool-call volume (out of CT-G scope; future observability work).

### Implementation steps

1. **Site #2 unconditional fork-side fix** in `forks/agentdb/src/mcp/agentdb-mcp-server.ts:2016`:
   change `console.log` → `console.error`. One-line edit matching the file's 21 sibling
   `console.error` calls. Commit per `[[feedback-commit-forks-before-release]]`.
2. **ESLint config creation** at `forks/agentdb/.eslintrc.json` (new file): declare
   `no-console: ['error', { allow: ['error', 'warn'] }]` scoped via `overrides.files` to
   `src/mcp/**/*.ts` only — avoids touching the daemon-side 60+ legitimate `console.log`
   sites that F-05-007 will own separately.
3. **INTEGRATION-LEDGER row** for site #2: `superseded-by-local` disposition citing this
   ADR; upstream `ruvnet/agentdb/src/mcp/agentdb-mcp-server.ts:2000` carries the
   byte-identical defect, so this is fork-only merge-tax until upstream takes a matching
   patch. Record per `[[feedback-update-integration-ledger]]`.
4. **Conditional site #1 hold** in a draft branch: if [[ADR-0239]] (CT-F cluster 2)
   decides to **keep** `v3/mcp/`, apply `console.info` → `console.error` (`:148`) and
   `console.debug` → `console.error` (`:143`) at `forks/ruflo/v3/mcp/server-entry.ts`
   plus the parallel `.eslintrc.json` creation. If CT-F **deletes** v3/mcp/, retract the
   site #1 fix (the entire subtree evaporates and the cross-bonus closes F-05-001
   automatically per [[ADR-0239]] cluster 2 row).
5. **Acceptance check** invoked via `_run_and_kill` (registered in both `run_check_bg`
   and `collect_parallel` per `[[reference-acceptance-runcheck-vs-collect]]`): boot
   `agentdb mcp start`, issue an MCP `learning_train` request, parse every stdout line —
   all lines must be valid JSON-RPC frames; ZERO `🎓 Training session ...` bytes on
   stdout. Boot is unblocked by [[ADR-0213]]'s `busy_timeout` fix (fork commit `d1b6145`).

### Dependencies

- [[ADR-0226]] — sibling fix for frame-write side of the same stdio JSON-RPC channel;
  establishes the `writeFrame` pattern this ADR's diagnostic-side rule complements.
- [[ADR-0213]] — unblocks the agentdb MCP server boot (`busy_timeout` allowlist fix);
  without this, site #2 was unreachable at runtime. Now satisfied per the 2026-05-24
  amendment.
- [[ADR-0239]] (CT-F cluster 2) — gates site #1. Cross-bonus: if v3/mcp/ is deleted,
  F-05-001 + F-10-002 close together with one delete.
- [[ADR-0233]] §CT-G — defect-class origin citing F-05-001 (HIGH) and F-05-002 (HIGH).
- [[ADR-0201]] — Remediation-ADR pre-flight checklist that cleared this draft (all four
  checks pass: signal-reaches-audience for both sites; upstream-not-decided; premise
  true at runtime; no sibling-ADR overlap).

### Validation

- Source-shape grep: `forks/agentdb/src/mcp/agentdb-mcp-server.ts` has zero `console.log`
  calls (scoped to this single file; sibling cli paths excluded).
- Source-shape grep (conditional): `forks/ruflo/v3/mcp/server-entry.ts:140-162` —
  `createLogger.info` and `.debug` keys both invoke `console.error`.
- ESLint pass: `npm run lint --workspace=forks/agentdb` (or equivalent) fails red on a
  deliberate `console.log` re-introduction in `src/mcp/**`.
- Behavioural acceptance: `agentdb mcp start` followed by `learning_train` — stdout is
  parseable as JSON-RPC frames only; no `🎓 Training session` bytes on stdout (they may
  appear on stderr, which is correct).
- Behavioural acceptance (conditional on CT-F keep): `npx tsx v3/mcp/server-entry.ts`
  with default `--log-level info` — stdout contains only the `notifications/server/ready`
  frame; no `[ISO-timestamp] [INFO] Starting Claude-Flow MCP Server V3 ...` lines.
- No `skip_accepted` per `[[feedback-skip-accepted-as-squelch]]`.

### Top risk + mitigation

- **Risk**: site #2 lands but the lint rider's new ESLint config doesn't run on CI (no
  pipeline step invokes `npm run lint` in `forks/agentdb/`), so the next slip slips
  again — recreating the F-05-002 shape. Same pre-flight #1 trap that flipped ADR-0207
  ("signal reaches audience").
- **Mitigation**: register the lint as an acceptance-tier check (per step 5's
  `_run_and_kill` registration), not just an ESLint warning. The check explicitly
  greps `console.log` in `forks/agentdb/src/mcp/**` and fails the release if non-zero.
  Belt + braces: lint warns developers at edit time; acceptance check fails the release
  if the lint is ignored. Matches the [[ADR-0215]] golden-master pattern.

---

## ADR-0246 — CT-M: AgentDB internals correctness

**Status**: proposed (post-swarm-review)
**Swarm**: 6 experts + devil's advocate, Byzantine consensus (≥3/6 supermajority; f=⌊(N-1)/3⌋=1)
**Triage rank**: 2 (3 CRITICAL data-integrity)

### Decision (post-swarm-review)

Hybrid C+A retained: behaviour-test-first for the 3 CRITICAL plus per-finding fix table for 4 WARN + 2 NOTE. Single ADR (not split), per ADR-0233's theme-batching mandate. Five improvements adopted from the dialectic: (1) F-03-001 uses probe-and-reseat by default (fail-loud only on explicit non-default caller mismatch) to re-converge with ADR-0073's intent; (2) F-03-002 path (a) is mandatory for FS-JSON substrate this cycle, RVF-substrate enforcement is gap-named as honest follow-up without weakening MODULE.md:45 charter sentence (DA Challenge 1 partial adoption); (3) tests must use real substrates not in-memory mocks; (4) F-03-003 fix+test fold into single commit (mechanical change); (5) INTEGRATION-LEDGER plan expanded to name three byte-identical files explicitly (`RvfBackend.ts`, `SqlJsRvfBackend.ts`, `factory.ts`).

### Implementation steps

1. **F-03-001 red test commit** (`tests/unit/adr0246-f03001-rvf-metric-reprobe.test.mjs`) — source-shape guard asserting `metric()` is called after every `RvfDatabase.open*`; runtime test exercising real temp-path round-trip (create `metric:l2` store → close → reopen with default config → store+search → assert score matches independent `cosineSimilarity` within ε=1e-6, NOT `2cos−1`). Land RED.
2. **F-03-002 red test commit** (`tests/unit/adr0246-f03002-archivist-invariants-rollback.test.mjs`) — runtime test using `archivist.dispatch('ruvllm_microlora_adapt', {input: <zeros>})` against real `makeFsJsonSubstrate` at temp path. Assert throw propagates AND `handle.read()` returns NO zero entry. Companion test asserting RVF-substrate dispatch still records `rejected` without rollback (documenting named gap). Land RED.
3. **F-03-001 fix commit** — In `RvfBackend.initialize()` / `load()` / `openReadonly()`, after `RvfDatabase.open`, probe `this.metricType = (await this.db.metric()) as 'cosine' | 'l2' | 'ip'`. Fail-loud only when caller explicitly passed `config.metric` (non-default) AND persisted store disagrees. For `SqlJsRvfBackend.load()`: read back `(SELECT value FROM rvf_meta WHERE key='metric')`; do NOT re-call `createSchema()`; same probe-and-reseat default + explicit-mismatch throw. Add `// charter:`-style divergence-marker comment naming ADR-0246. Turns red test GREEN.
4. **F-03-002 fix commit** — In `archivist/index.ts:986-1013`: detect substrate kind on entry; for FS-JSON, snapshot pre-write state via `substrate.read()`, invoke handler in a try block that aborts before `saveJsonAtomic` rename when invariants reject (mechanism: stage the new state in memory inside the handler, run invariants on the staged state, only then call `withWrite`). Plumb real `substrateStateBefore/After` into `Invariant<T>` args for FS-JSON path; remain `undefined` for RVF path. F-03-008 (dead-param) closes for FS-JSON only. Append footnote to `MODULE.md:45` clarifying RVF-substrate enforcement gap. Turns red FS-JSON test GREEN; RVF-substrate companion test passes as documenting-the-gap.
5. **F-03-003 fix+test combined commit** (`tests/unit/adr0246-f03003-hnsw-factory-derivation.test.mjs` + factory.ts edit) — source-shape test asserting `createHNSWLibBackend` calls `deriveHNSWParams` before instantiation; runtime test calling `createBackend('hnswlib', {dimension: 768})` and asserting `{M:23, efConstruction:100, efSearch:50}`. Edit `factory.ts::createHNSWLibBackend` AND `factory.ts::createRvfBackend` to merge `deriveHNSWParams(config.dimension)` into config when M/efC/efS omitted. Static defaults in `HNSWLibBackend.ts:87-94` retained (constructor seam).
6. **WARNING fixes** (one commit each): F-03-004 (`hot-path-writer.ts::enqueue` → async + `await drainOne()` at capacity); F-03-005 (`RvfBackend.indexStats()` re-throw instead of fabricated default); F-03-006 (`RvfBackend.remove()` throws `'async-only'` matching `search()` pattern at `:234-240`).
7. **NOTE handling**: F-03-008 closes with F-03-002 fix (FS-JSON arm plumbs params live; RVF arm leaves them `undefined` per gap-mark). F-03-009 documentation-only (`// @internal` JSDoc on `HNSWIndex`; remove from `controllers/index.ts:11` and `src/index.ts:73` public exports). F-03-007 closes by construction when CT-A ([[ADR-0234]]) lands.
8. **INTEGRATION-LEDGER rows**: append three explicit rows naming `forks/agentdb/src/backends/rvf/RvfBackend.ts`, `forks/agentdb/src/backends/rvf/SqlJsRvfBackend.ts`, and `forks/agentdb/src/backends/factory.ts` with `cherry-pick -x`-able trailers per `[[feedback-update-integration-ledger]]`.
9. **Independent-cosine verification**: after all 3 CRITICAL fixes land green, run `embeddings_compare` (per `[[project-memory-search-rvf-snapshot-isolation]]`) on a reopened `metric:l2` store and assert score equals raw `cosine_similarity(a, b)` within ε=1e-6.

### Dependencies

- [[ADR-0073]] — F-03-001 extends its 2026-05-22 amendment's named follow-up pointer to the agentdb-side `distanceToSimilarity` site. Agentic-flow canonical (`ruvnet/agentic-flow/agentic-flow/src/optimizations/ruvector-backend.ts:322`) scores `cosineSimilarity(a, b)` directly — re-convergence target.
- [[ADR-0180]] — F-03-002 charter at MODULE.md:45. Charter sentence preserved verbatim; runtime aligns to spec for FS-JSON; RVF gap named honestly.
- [[ADR-0227]] — adaptive threshold 0.3→0.15 assumed correct cosine. F-03-001 closure restores that premise on the agentdb-native search consumers.
- [[ADR-0231]] — wave A9 `inputIsNotAllZero` invariant is the F-03-002 path-(a) test target.
- [[ADR-0233]] — CT-M parent. 100% coverage statement counts CT-M against the 96 actively-remediated findings.
- [[ADR-0234]] — CT-A; F-03-007 (`EmbeddingService.mockEmbedding` fallback) closes by construction when CT-A lands.
- [[ADR-0239]] — CT-F dead-code triage; disjoint live-code scope, no overlap.

### Validation

- **Reproducer test F-03-001**: temp-path RVF round-trip — create `metric:l2` store with two random unit-normalized vectors; close; reopen with default `cosine` config; search vector1 against vector2; assert returned `r.score` matches independent `cosineSimilarity(vec1, vec2)` within ε=1e-6 (NOT `2 * cos − 1` as the bug produces).
- **Reproducer test F-03-002**: real FS-JSON `makeFsJsonSubstrate` at temp path; `archivist.dispatch('ruvllm_microlora_adapt', {input: new Array(384).fill(0)})`; expect throw with `invariant '...' violated`; subsequent `handle.read({storeId})` must NOT contain the zero-input journal entry. Pre-fix: read returns zero entry.
- **Companion test F-03-002 (RVF gap)**: real RVF substrate; same dispatch; expect throw AND substrate retains zero entry (documents the named gap; passes today because it asserts current-known behaviour).
- **Reproducer test F-03-003**: `createBackend('hnswlib', {dimension: 768})` (no M/efC/efS); assert backend `indexStats()` returns `{m: 23, efConstruction: 100, efSearch: 50}`.
- **Cross-baseline check**: after all 3 fixes, `embeddings_compare` independent baseline vs `agentdb_filtered_search` MCP handler on the same reopened store: ε=1e-6.
- **WARNING regression tests**: F-03-004 source-shape `no /void this.drainOne\(\)/ in enqueue body`; F-03-005 source-shape `no fabricated-default literal in indexStats catch`; F-03-006 source-shape `remove() throws; no /\.catch\(.+\) =>/ fire-and-forget`.

### Top risk + mitigation

- **Risk**: F-03-002 path (a) for FS-JSON requires re-ordering `dispatchMutationInternal` such that the handler returns a STAGED state object, invariants evaluate on the staged state, and only then the substrate write commits. This is a non-trivial change to the dispatch contract — current `MutationHandlerFn<T>` returns `Promise<void>` and the handler internally calls `ctx.substrate.withWrite(...)` which immediately commits. Naive re-ordering breaks handlers that don't separate "compute new state" from "write new state".
- **Mitigation**: introduce an optional `previewWrite` method on `SubstrateAccess` (in-memory dry-run that returns staged state); FS-JSON impl computes the new JSON in memory without touching the file. Handlers that opt in to the new pattern call `ctx.substrate.previewWrite(...)` then return the staged state; invariants evaluate on it; if pass, dispatch commits via `ctx.substrate.withWrite(...)` (or the substrate exposes a `commit(staged)` primitive). Handlers that don't opt in keep current behaviour AND get the RVF-substrate gap-marker (invariants run post-commit, audit `rejected` recorded, no rollback). Migration is opt-in per handler; existing `microlora-adapt` handler is the first migrator (the ADR-0231 wave A9 invariant is the test target). This preserves backwards compatibility while making the charter sentence true at runtime for opted-in handlers.
- **Secondary risk**: F-03-001 probe-and-reseat changes the metric of the live backend instance on every `open*` call. A caller that constructs the backend with `metric:'cosine'` and reopens an `l2` store will see `this.metricType` flip to `l2` mid-session. Downstream callers consulting `metricType` get the correct value, BUT if any caller cached the metric before the reopen, they'd hold a stale value.
- **Mitigation**: grep callers of `RvfBackend.metricType` (private) and `RvfBackend.metric()` (public method); confirm no caller caches the value across an `open*` call. Document the reseat behaviour at the method JSDoc.

---

## ADR-0235 — CT-B: init-template golden-master or regenerate

**Status**: proposed (post-swarm-review)
**Swarm**: 5 experts + devil's advocate, Quorum-majority consensus (5/5 agree on shape; DA holds principled-but-narrow dissent on aggressiveness)
**Triage rank**: 3 (gates [[ADR-0211]]'s real implementation reaching npx users; gates [[ADR-0143]]'s brand reaching the umbrella manifest)

### Decision (post-swarm-review)

Apply the as-drafted **Option B (bundled-static deletion via `git rm` + `files:` trim) + Option D (preference inversion in `writeHelpers`) + content-invariant lint for F-07-003 (umbrella brand)** with five panel-adopted clarifications: (1) enumerate the 8 generator-covered names + the 3 currently-overlapping; (2) use `node --test` + `walkMd` pattern for both new tests per [[ADR-0215]] precedent; (3) the umbrella-brand fix is a NET-NEW lint, not a "Pass 7 path-scope extension" (Pass 7's regex doesn't cover brand strings); (4) bundled-static deletion is a two-part action (git removal + `files:` trim); (5) DA's "first-time offline install" framing is unfounded — `npm install` is online by definition, generator code is in `dist/`. DA holds principled dissent on remedy aggressiveness ("always regenerate" vs preference-inversion) — captured as the conservative-fallback inverse but not adopted as the chosen remedy.

### Implementation steps

1. **Preference-inversion in `writeHelpers`** (`forks/ruflo/v3/@claude-flow/cli/src/init/executor.ts:1184-1232`). The 8 names the generator dispatch produces: `pre-commit`, `post-commit`, `session.js`, `router.js`, `memory.js`, `hook-handler.mjs`, `intelligence.cjs`, `auto-memory-hook.mjs` (from `executor.ts:1234-1243`). Currently-known overlaps with bundled static: `hook-handler.mjs`, `intelligence.cjs`, `auto-memory-hook.mjs` (the 3). Verify the 5-vs-3 split at implementation time per ADR Decision §3 Pre-flight Check 3. Refactor seeds `result.created.files` from generators first, then skips those names in the copy loop. Maintain the upstream `findSourceHelpersDir` Strategy-1-through-4 walk for bundled-only filenames (the 33 orphans path, in case the conservative fallback is chosen).

2. **Bundled-static deletion (two-part action)** for the unconditional-Option-B path:
   - `git rm -r forks/ruflo/v3/@claude-flow/cli/.claude/helpers/` (removes all 41 bundled helpers; the 8 generator-covered overlap with regeneration, the 33 orphans triage with F-12-004 per Decision §2).
   - Drop `.claude` from `forks/ruflo/v3/@claude-flow/cli/package.json` `files:` array (line 80-83). Without BOTH steps, the directory either survives in git (re-added on `git add .`) or in published tarballs (`.claude` still listed).
   - If conservative fallback is chosen instead: keep `.claude` in `files:`, delete only the 3 overlap files (`hook-handler.mjs`, `intelligence.cjs`, `auto-memory-hook.mjs`), retain the 33 orphans (defers F-12-004).

3. **Build-time parity test** at `ruflo-patch/tests/pipeline/init-helpers-parity.test.mjs` using `node --test` (not vitest, per [[ADR-0215]] `skill-shell-integrity.test.mjs` placement). Walks the fork tree via the `walkMd`/`upstream.ruflo.dir` pattern from `marketplace-manifest.test.mjs`. For each name that exists in both the bundled static directory AND the generator dispatch, assert byte-equality. Fails loud on any drift. No `UPDATE_GOLDEN`-style operator-accept path. The test is meaningful only on the conservative-fallback path (where bundled static still exists); on the unconditional-deletion path, the test becomes trivially-vacuously-true and may be replaced with a different gate (the tarball-content lint per step 6).

4. **F-07-003 umbrella plugin.json brand fix** at `forks/ruflo/.claude-plugin/plugin.json:2-9`. Replace `"name": "claude-flow"` → `"name": "ruflo"`; `"version": "2.5.0"` → `"0.0.0"` placeholder (or coordinate with wrapper-version cadence per [[project-ruflo-wrapper-latest-regression]]); `"name": "rUv"` → `"Henrik Pettersen"` (or `"ruvnet"`); `homepage` and `repository.url` → `sparkling/ruflo` per [[reference-user-facing-brand]]. Hand-edit; the brand strings are out of Pass 7's regex scope (Pass 7 rewrites `@sparkleideas/cli`, not `claude-flow` brand strings) — corrected per Swarm review E3.

5. **F-07-003 install.sh disposition** at `forks/ruflo/.claude-plugin/scripts/install.sh:138-179`. **Preferred: delete the script entirely** — under [[ADR-0117]] §Revision 2026-05-03 service-method install, `.mcp.json` registration is the only supported path and install.sh's MCP-add is a contradicting parallel bootstrap. If retention is required (any external doc references it), rewrite the MCP-add line to `claude mcp add ruflo -- npx -y @sparkleideas/ruflo@latest mcp start` per [[feedback-always-npx-for-ruflo]]. Either path: also grep `docs/USERGUIDE.md` and `README.md` for `install.sh` references and update or remove.

6. **Content-invariant lints** at `ruflo-patch/tests/pipeline/umbrella-plugin-brand.test.mjs` (`node --test`, `walkMd` pattern, same harness as step 3). Scan `forks/ruflo/.claude-plugin/**/*.{json,sh}` for forbidden strings: `"name": "claude-flow"`, `"version": "2.5.0"`, `"name": "rUv"`, `npx claude-flow@alpha`, `mcp add claude-flow ` (trailing space). Fail loud on any hit. Pair with a one-liner tarball-content lint that runs `npm pack` then asserts `tar -tf … | grep -c '.claude/helpers/'` returns 0 on the unconditional-deletion path (or matches the conservative-fallback count).

7. **Pass 7 extension-allowlist widening** at `scripts/codemod.mjs`. Currently Pass 7 path scope predicate matches `.{md,json}`; widen to `.{md,json,sh}` to catch future `.sh`-located `@sparkleideas/cli` references (defense-in-depth; the install.sh rewrite is the primary fix). Add regression test asserting a deliberately-inserted `@sparkleideas/cli` reference in `.claude-plugin/scripts/install.sh` is flipped to `@sparkleideas/ruflo` by `transformSource()`. (Per Swarm review E3 — this is the corrected interpretation; the brand strings themselves remain out of Pass 7's regex scope, so the umbrella-brand lint at step 6 is the durable gate for those.)

8. **INTEGRATION-LEDGER rows** for the two fork-side fixes per [[feedback-update-integration-ledger]]:
   - Bundled-static removal: `superseded-by-local` disposition citing upstream `ruvnet/ruflo/v3/@claude-flow/cli/.claude/helpers/` (same byte-identical defect class present upstream — different sentinel `.cjs` vs `.mjs`, identical preference order).
   - Umbrella brand rebrand: `superseded-by-local` citing upstream `ruvnet/ruflo/.claude-plugin/plugin.json` (byte-identical for brand strings; upstream-by-design for `claude-flow` brand; ADR-0143 explicitly diverged).

### Dependencies

- [[ADR-0211]] — its source-side fix (14 handlers + fail-loud + `feedback(success)`) only reaches npx users once this ADR's bundled-static drift is closed. Without ADR-0235, ADR-0211 is "implemented in source, invisible at runtime" per F-12-001.
- [[ADR-0143]] — F-07-003 brand fix coordinates with codemod Pass 7. Pass 7 path scope already covers `.claude-plugin/**/*.{md,json}` (line 60) — the umbrella brand miss is at the regex layer (brand strings out of scope), not the path layer. Pass 7 extension allowlist widening (`.{md,json}` → `.{md,json,sh}`) is defense-in-depth for future `.sh`-located package refs.
- [[ADR-0215]] — model for the parity-test-as-invariant + content-invariant lint approach. Same harness choice (`node --test`), same file-walk pattern (`walkMd`), same fail-loud-no-operator-accept discipline.
- [[ADR-0210]] — stub-honesty mandate. Option B's bundled-static deletion is a direct application: keep what works (generators), document-or-remove what doesn't (33 orphans).
- [[ADR-0117]] §Revision 2026-05-03 — service-method install pattern. install.sh's `claude-flow` MCP key contradicts this (it writes a parallel bootstrap config). Preferred fix (delete install.sh) is ADR-0117-aligned.
- [[ADR-0117]] for marketplace MCP server registration under `ruflo` key — same identity the 32 wrapper plugins depend on.
- [[ADR-0233]] §CT-B — defect-class origin citing F-12-001 (HIGH), F-12-003 (MEDIUM), F-07-003 (CRITICAL).
- [[ADR-0201]] — Remediation-ADR pre-flight checklist cleared for this draft (all four checks pass per ADR §Pre-flight verification).

### Validation

- **Build-time parity test**: `ruflo-patch/tests/pipeline/init-helpers-parity.test.mjs` exists, runs under `node --test`, asserts byte-equality between each generator output and any same-name file in `forks/ruflo/v3/@claude-flow/cli/.claude/helpers/`. Fails today (bundled `hook-handler.mjs` has 8 keys, generator emits 14). After source-bundle alignment, passes.
- **Tarball-content lint**: `tar -tf $(npm pack @sparkleideas/cli@latest 2>/dev/null | tail -1) | grep -c '.claude/helpers/'` returns 0 (unconditional path) or 33 (conservative fallback — orphans retained). Pair with the parity test gate.
- **Runtime hook-handler verification**: `echo '{}' | node .claude/helpers/hook-handler.mjs pre-edit` in fresh `npx -y @sparkleideas/ruflo@latest init` sandbox runs the real `pre-edit` handler (returns FS check result, exit 0). Pre-fix this prints `[OK] Hook: pre-edit` (bundled static's old fallthrough).
- **`auto-memory-hook.mjs sync` verification**: `node .claude/helpers/auto-memory-hook.mjs sync` runs the real sync (`case 'sync': await doSync(); break;`), not the bundled static's `default` branch usage hint.
- **F-07-003 lint**: `ruflo-patch/tests/pipeline/umbrella-plugin-brand.test.mjs` fails on current tree (umbrella plugin.json + install.sh); passes after the source fix.
- **F-07-003 file content**: `forks/ruflo/.claude-plugin/plugin.json` reads `"name": "ruflo"` (canonical brand per [[reference-user-facing-brand]]); author is `Henrik Pettersen` or `ruvnet`; homepage points at the fork's repo. `install.sh` either deleted OR uses the canonical service-method MCP-add line.
- **Pass 7 regression test**: deliberately-inserted `@sparkleideas/cli` in `.claude-plugin/scripts/install.sh` is flipped to `@sparkleideas/ruflo` by `transformSource()`.
- **No regression**: `adr0211` acceptance group still passes (preference inversion makes generator and bundled identical, so user-facing behaviour matches generator).
- **No `skip_accepted`** per [[feedback-skip-accepted-as-squelch]] on either of the two new gates.

### Top risk + mitigation

- **Risk**: Bundled-static deletion (Option B) breaks a user workflow that depended on an orphan helper (e.g., `setup-mcp.sh`, `quick-start.sh`). F-12-004 classifies most orphans as dead code (fork-internal v3 dev tooling) or broken (`setup-mcp.sh` is wrong per F-12-008), so risk is low — but unverified per-file at decision time. Same pre-flight #1 trap shape that flipped ADRs 0207/0208/0209 ("signal reaches audience"): we *think* the orphans aren't reaching anyone, but absence-of-evidence is not evidence-of-absence.
- **Mitigation**: Conservative fallback is explicitly documented in ADR Decision §2: retain the 33 orphans, delete only the 3 generator-overlapping bundled statics. This unblocks F-12-001 / F-12-003 while deferring F-12-004's triage. The unconditional-deletion path remains the preferred end-state but is reversible by re-adding `.claude` to `files:` if a user-impact signal arrives post-release.
- **Secondary risk**: The umbrella-brand fix requires picking a canonical version triple for the umbrella plugin.json. The project lacks a single source-of-truth for the umbrella's identity (the wrapper-version cadence is brittle per [[project-ruflo-wrapper-latest-regression]]).
- **Mitigation**: Pin a `0.0.0` placeholder version until a wrapper-version-aware build step takes over (cross-bonus with future build-pipeline work).

---

## ADR-0234 — CT-A: extend [[ADR-0095]] fallback removal to sibling loaders

**Status**: proposed (post-swarm-review)
**Swarm**: 6 experts + devil's advocate, Byzantine consensus (≥3/6 supermajority; f=⌊(N-1)/3⌋=1)
**Triage rank**: 4 (CT-A is the silent-fallback long-tail beyond [[ADR-0095]]'s surgical RVF amendment)

### Decision (post-swarm-review)

Option A (per-site fail-loud throw, no escape hatch) retained as the canonical shape — mirrors the [[ADR-0095]] 2026-05-23 amendment posture user explicitly affirmed ("dont do this: `RUFLO_ALLOW_PURE_TS_FALLBACK`. Just fail loud"). Six improvements adopted from the dialectic, none of which weaken the fail-loud posture: (1) site 1 (vector-db) error message names ADR-0095's amendment lineage explicitly (not just ADR-0234) so the historical chain is greppable; (2) site 2 (diskann) test must use the `RvfBackend.ts:1129` typed-error shape pattern (`{code, path, adr}`) rather than free-form throw, per F-06-002 cross-cutting observation 3; (3) site 3 (`embedding-pipeline`) gets a paired follow-on commitment to surface live provider in `embeddings_status` MCP response (F-08-008) — without it the operator's recovery story is "read the throw, find the cause" only; the ADR records the follow-on as a named gap, not a deferred-to-forever; (4) site 4 (claims) `INTEGRATION-LEDGER.md` row creation made explicit per `[[feedback-update-integration-ledger]]` — the byte-identical upstream means every sync touching `commands/claims.ts:265-271` will conflict; (5) site 5 (plugins) two-part fix retained but ordered: rewrite description+examples FIRST (single-string fix, zero behavioural risk), guard `--source ipfs` SECOND (adds new flag handling, golden-master snapshot impact); (6) per-site test coverage stipulation tightened from "at minimum one acceptance-tier test" to "one test asserting throw AND one test asserting throw includes ADR-0234 reference in message" — matches the [[ADR-0095]] amendment test pattern. DA holds principled dissent on site 2 (diskann) merge-tax framing — see DA final position.

### Implementation steps

1. **Site 1 fork-side fix** in `forks/ruflo/v3/@claude-flow/cli/src/ruvector/vector-db.ts:155-159, 235-260`: throw at `loadRuVector` failure point with typed error `{code: 'RUVECTOR_UNAVAILABLE', path: <module-spec>, adr: 'ADR-0234'}`. Remove `backend: 'fallback'` from `getStatus()` return shape. Keep `generateHashEmbedding` in-file but unreachable from production callsites; tests-only import allowed. Error message references both ADR-0234 and the [[ADR-0095]] amendment lineage. Commit per `[[feedback-commit-forks-before-release]]`.

2. **Site 2 fork-side fix** in `forks/ruflo/v3/@claude-flow/cli/src/ruvector/diskann-backend.ts:54-114`: three typed-error throws (one per cascade tier) using the `RvfBackend.ts:1129` pattern. Preserve `createJsFallbackIndex` as test-only helper (callable from `tests/` paths; unreachable from `getDiskAnnIndex` production path). Add `// ADR-0234: fork diverges from upstream (which ships silent cascade by design)` divergence comment naming this ADR. INTEGRATION-LEDGER row required (byte-identical with upstream confirmed at `/Users/henrik/source/ruvnet/ruflo/v3/@claude-flow/cli/src/ruvector/diskann-backend.ts`).

3. **Site 3 fork-side fix** in `forks/ruflo/v3/@claude-flow/memory/src/embedding-pipeline.ts:147-167, 220-244` + `forks/ruflo/v3/@claude-flow/cli/src/memory/memory-router.ts:874-882`: throw the actual error in `_doInitialize` (drop `console.warn`-then-fall-through); remove bare `catch {}` at `memory-router.ts:880`; delete hash branch in `embedInternal:242-243`. **Paired follow-on**: file a `embeddings_status` MCP-tool gap-mark naming F-08-008 (surface live provider — `transformers.js | ruvector | hash-fallback`) so the operator-recovery story is "read the throw + check `embeddings_status` for confirmation". Follow-on is gap-named, not deferred-to-forever.

4. **Site 4 fork-side fix** in `forks/ruflo/v3/@claude-flow/cli/src/commands/claims.ts:265-271`: replace permissive-default branch with `return { success: false, exitCode: 1 }` plus clear error message naming the underlying cause. Add `// ADR-0234: fork-only fail-closed (upstream is byte-identical permissive-by-design)` divergence comment. INTEGRATION-LEDGER row required.

5. **Site 5 fork-side fix** in `forks/ruflo/v3/@claude-flow/cli/src/commands/plugins.ts:220, 230, 311-313`: ORDERED two-part fix. Part (a) — rewrite `description`, two `examples:` lines, and `discovery` spinner text from "IPFS registry" to "Install a plugin from npm registry (IPFS path not yet implemented)". Single-string change. Part (b) — add `if (source === 'ipfs') throw new Error('[plugins] IPFS install path not implemented; use --source npm')` guard at source-selection boundary. Part (a) commits first (lowest risk); part (b) commits second (adds new flag handling). Golden-master snapshot allowlist entry per `[[ADR-0215]]` required for the help-text change.

6. **Per-site acceptance tests**: `tests/unit/adr0234-f06001-vector-db-throw.test.mjs`, `tests/unit/adr0234-f06002-diskann-throw.test.mjs`, `tests/unit/adr0234-f08002-embedding-pipeline-throw.test.mjs`, `tests/unit/adr0234-f04002-claims-fail-closed.test.mjs`, `tests/unit/adr0234-f01008-plugins-honest-description.test.mjs`. Each test asserts throw + error message contains the literal string `'ADR-0234'`.

7. **INTEGRATION-LEDGER rows** for sites 2 and 4 (the two byte-identical-with-upstream sites): two `superseded-by-local` disposition rows citing ADR-0234, with `cherry-pick -x`-able trailers. Site 1 is already-diverging from upstream (fork has more permissive behaviour today); the additional fork-only fail-loud throw is itself a new divergence, so a ledger row is required there too. Sites 3 and 5 are fork-original / partially-diverging — no new ledger row needed for the throw itself, but site 5's description rewrite is a deliberate fork-only divergence and warrants a ledger row.

### Dependencies

- [[ADR-0095]] — the 2026-05-23 amendment whose posture this ADR universalises. Without ADR-0095's "no escape hatch" precedent, Option B (env-var opt-in) would re-enter consideration; with it, Option A is the only consistent fork-policy.
- [[ADR-0201]] — Remediation-ADR pre-flight checklist that gated this draft. Verified 2026-05-24: signal reaches user on 4/5 sites (sites 1-4 no signal; site 5 partial visible-but-misleading); upstream byte-identical on sites 2 and 4 (merge-tax acknowledged); premise true at runtime on all 5 sites; no sibling-ADR overlap with [[ADR-0209]] (different code class — MCP-tool envelopes vs loader cascades), [[ADR-0210]] (fabricated-constants vs silent degradation), or [[ADR-0227]] (threshold tuning vs the score that the threshold gates).
- [[ADR-0210]] — stub-honesty mandate is the conceptual sibling: ADR-0210 governs MCP-tool handlers returning canned values; ADR-0234 governs loader cascades silently degrading the semantic surface. Different code class, same discipline.
- [[ADR-0227]] — adaptive threshold floor 0.3→0.15 assumed correct cosine score; ADR-0234 site 3 addresses the silent fallback that swaps the score generator underneath the threshold. Orthogonal but adjacent — closure of site 3 reinforces ADR-0227's recalibration.
- [[ADR-0233]] §CT-A — parent rollup explicitly directing theme-batched remediation. ADR-0234 IS that remediation.
- [[ADR-0244]] (CT-K, sibling) — took the other 2 slice-01 findings (F-01-008 actually consumed here at site 5; F-01-010 consumed here at site 4 + CT-K F-01-010 row 10). ADR-0234 + ADR-0244 exhaustively partition slice-01 + the loader sites from slice 06 / 08 / 04.
- [[ADR-0246]] (CT-M, sibling) — F-03-007 (`EmbeddingService.mockEmbedding` fallback) closes by construction when ADR-0234 lands (CT-M Sites table row 11). Cross-ADR dependency direction is clear.
- [[feedback-no-fallbacks]] / [[feedback-best-effort-must-rethrow-fatals]] — corpus rules that this ADR enforces uniformly across the 5 sibling loaders.
- [[feedback-update-integration-ledger]] — required for sites 2 and 4 (byte-identical upstream), site 1 (now-divergent fork posture), and site 5 description rewrite.

### Validation

- **Source-shape gates (deterministic)**:
  - `forks/ruflo/v3/@claude-flow/cli/src/ruvector/vector-db.ts` — zero callers of `generateHashEmbedding` outside `tests/`; `getStatus()` return shape contains no `backend: 'fallback'` literal.
  - `forks/ruflo/v3/@claude-flow/cli/src/ruvector/diskann-backend.ts` — zero `catch { /* Fall through */ }` blocks in `getDiskAnnIndex`; `createJsFallbackIndex` unreachable from production path (grep-verified).
  - `forks/ruflo/v3/@claude-flow/memory/src/embedding-pipeline.ts` — `_doInitialize` re-throws; no `console.warn`-then-continue; `embedInternal:242-243` hash fallback deleted.
  - `forks/ruflo/v3/@claude-flow/cli/src/memory/memory-router.ts:874-882` — no bare `catch {}` swallowing init failures.
  - `forks/ruflo/v3/@claude-flow/cli/src/commands/claims.ts:265-271` — `return { success: false, exitCode: 1 }` on policy-load error; no `'Granted (default permissive policy)'` reason string.
  - `forks/ruflo/v3/@claude-flow/cli/src/commands/plugins.ts:220, 230, 311-313` — `description` and `examples:` reference "npm registry" not "IPFS"; `--source ipfs` throws.

- **Behavioural acceptance**:
  - Boot CLI in a fresh sandbox with `ruvector` uninstalled; invoke `vector-db.createVectorDB(768)`; expect throw with `ADR-0234` in message (NOT silent degradation to hash-stretched-sine).
  - Boot CLI with `@xenova/transformers` AND `ruvector` both uninstalled; invoke `embedding-pipeline.initialize()`; expect throw (NOT `console.warn`-then-hash).
  - Invoke `cli claims check -c swarm:create -u bob` against a deliberately-unreadable policy file; expect exit 1 (NOT exit 0 with "Granted (default permissive policy)").
  - Invoke `cli plugins install --source ipfs <name>`; expect throw naming "IPFS install path not implemented".
  - Per-site test asserts error message contains literal `'ADR-0234'`.

- **No `skip_accepted`** per `[[feedback-skip-accepted-as-squelch]]`.

### Top risk + mitigation

- **Risk**: site 3 (`embedding-pipeline` + `memory-router`) is the most consequential behavioural change in this ADR — operators upgrading from a pre-ADR-0234 wrapper will see init throw where previously they saw degraded search. The pre-flight check 1 verdict was "no signal reaches user", which means today's operators may not even know they're running on hash fallback — so the throw is the FIRST signal they get, and it surfaces during init not at query time (longer feedback delay for operators reading their logs). This is the intended posture (matches [[ADR-0095]] amendment), but operators with no `@xenova/transformers` AND no `ruvector` installed will see immediate hard failure where they previously had silent degradation that "worked" by some weak metric.

- **Mitigation**: paired follow-on per step 3's commitment — `embeddings_status` MCP tool surfaces the live provider (`transformers.js | ruvector | hash-fallback | unavailable`) so operators can probe their installation state BEFORE invoking any embedding-dependent code path. The throw message names the missing dependencies explicitly (matching `RvfBackend.ts:1129`'s `[RvfBackend] Native binding @ruvector/rvf-node failed to load ... Install @ruvector/rvf-node to proceed.` pattern). Combined: operators have a probe (`embeddings_status`), an actionable throw (`Install @xenova/transformers and/or ruvector`), and a recovery path (npm install + retry). The follow-on F-08-008 fix is gap-named in this ADR's "Out of scope (deferred)" section so it doesn't disappear into the deferred-to-forever pile.

- **Secondary risk**: site 2 (diskann) is the highest merge-tax site — byte-identical with upstream and the upstream design explicitly ships the three-tier cascade. Every upstream sync that touches `cli/src/ruvector/diskann-backend.ts` will conflict. DA flagged this with two concrete challenges (see DA final position).

- **Secondary mitigation**: per the F-06-002 audit's cross-cutting observation 3 ("loader error messaging is uneven; `rvf-backend.ts:1129` does the right thing — include `code`, surface the path, name the ADR that removed the fallback"), site 2's throw shape MUST match the `RvfBackend.ts:1129` template precisely. This means a sync agent encountering the conflict can mechanically port the throw shape (it's a labelled pattern, not free-form), reducing the merge-tax cost from "rewrite the cascade" to "preserve the labelled throws". The divergence comment names ADR-0234 explicitly; `[[feedback-update-integration-ledger]]` requires per-sync disposition rows that name the ADR. Cost is bounded but real.

---

## ADR-0244 — CT-K: CLI per-command honesty long-tail

**Status**: proposed (post-swarm-review)
**Swarm**: 5 experts + devil's advocate, Byzantine consensus (f=1, ≥3/6 supermajority)
**Triage rank**: 5 in [[ADR-0233]] §Decision (per-CT batch ordering)

### Decision (post-swarm-review)

Adopt the original Option A (per-site triage + parser fix + codemod extension) with **5 substantive amendments** surfaced by the panel: (i) Decision #3 (`swarm scale`) requires both wiring AND registering a real `swarm_scale` MCP handler (currently advertised at `mcp.ts:503` with zero implementation) OR deleting the subcommand — fail-loud is the safety net, not the disposition; (ii) Decision #11 (parser coercion) extends from 2 lines to 3 lines, adding `'string[]'` handling (`opt.default.split(',').map(s => s.trim())`) to close the full CC-03 class including string-array defaults; (iii) Decision #9 (F-01-012 brand drift) re-characterized as Pass 7 *architecture extension* (5 substring sets + path-scope to `commands/*.ts` + new codemod-test block), not a config flip; (iv) Check 2's byte-identical count corrected from 6/11 to **9/11** (4 whole-file + 5 block-byte-identical sites; divergence markers mandatory at all 9); (v) Decision #6 (`mcp toggle` persistence) requires either restart-required envelope note OR live-manager propagation. DA holds principled dissent on test-coverage limits for strict-equality surfacing after #11 (general risk class, out of CT-K scope); withdraws on the "11-sites-is-too-much-merge-tax" counter-proposal.

### Implementation steps

1. **Parser fix first (Decision #11) — 3-line coercion** in `forks/ruflo/v3/@claude-flow/cli/src/parser.ts:486` inside `applyDefaults`: add boolean (`opt.type === 'boolean' && typeof opt.default === 'string'` → `opt.default === 'true'`), number (`opt.type === 'number' && typeof opt.default === 'string'` → `Number(opt.default)`), AND string-array (`opt.type === 'string[]' && typeof opt.default === 'string'` → `opt.default.split(',').map(s => s.trim())`) coercion branches. Land **after** running the full unit+acceptance suite *with the coercion applied locally*, enumerating every new strict-equality failure as in-scope #11 cleanup (mirrors [[ADR-0208]] step 4 gate shape). ADR-0208 step 4 already shipped (commit `87cb68ae2`) — prerequisite is met.

2. **CRITICAL pair removal (Decisions #1 + #2)** in one commit:
   - `forks/ruflo/v3/@claude-flow/cli/src/commands/process.ts:48-203` — delete the entire `daemon` subcommand block from `processCommand` (the real `daemonCommand` at `commands/daemon.ts` is the canonical driver). Add `// ADR-0244: deleted; canonical daemon lives in commands/daemon.ts (upstream byte-identical — perpetual merge-tax)` divergence marker.
   - `forks/ruflo/v3/@claude-flow/cli/src/commands/start.ts:165-166` — remove the `daemonPidPath` write block from `startAction`. Add `// ADR-0244: PID file ownership belongs to daemonCommand (see ADR-0243 site #4 for signal-handler discipline; upstream byte-identical at :219-220)` marker. Closes the three-writer race on `.claude-flow/daemon.pid` and the `JSON.parse`-on-integer crash vector.

3. **CC-01 envelope dispositions (Decisions #3, #4, #5, #6, #7)**:
   - #3 (`swarm.ts:755-820` scale): wire to MCP `swarm_scale` AND register a real handler in `mcp-tools/swarm-tools.ts` (handler currently missing despite `mcp.ts:503` advertisement); OR delete the `scale` subcommand. Wire-or-delete the unused `--type` flag.
   - #4 (`workflow.ts:608-628` template create): implement filesystem-backed write to `.claude-flow/templates/<name>.json` returning `{success:true, data:{name, path}}`; OR delete subcommand.
   - #5 (`config.ts:304-333` reset --section): thread `--section` through to `configManager.reset(cwd, section?)` (extending the manager); OR remove the `--section` flag declaration.
   - #6 (`mcp.ts:572-612` toggle): persist `mcp.disabledTools` to `.claude-flow/config.json`; return `{success:true, data:{...}, note:'Restart required for changes to take effect'}` (cheaper) OR propagate to live `getMCPServerManager()` (more work).
   - #7 (`swarm.ts:877-893` coordinate): one-line catch-block envelope flip — return `{success:false, exitCode:1}` on MCP `swarm_init` failure; keep the printed plan.

4. **CC-02 honesty fixes (Decisions #8, #10)**:
   - #8 (`mcp.ts:271`): replace `'27 enabled'` literal with `${listMCPTools().length} enabled` (already imported at `mcp.ts:22`).
   - #10 (`completions.ts:12,20,23`): derive `TOP_LEVEL_COMMANDS`, `SWARM_SUBCOMMANDS`, `AGENT_SUBCOMMANDS` from `getCommandNames()` and command `.subcommands` at generation time; remove `help`/`version` (global flags, not commands).

5. **Pass 7 architecture extension (Decision #9)** in `forks/ruflo/scripts/codemod.mjs`:
   - Extend `isPlugin7Scope` path predicate to include `v3/@claude-flow/cli/src/commands/**/*.ts` (currently scoped to `init/**` only per [[ADR-0143]]:61).
   - Add 4 new substring rewrites alongside the existing `@sparkleideas/cli → @sparkleideas/ruflo`: `claude-flow@v3alpha` → `@sparkleideas/ruflo`, `claude-flow swarm` → `npx -y @sparkleideas/ruflo swarm`, `claude-flow workflow` → `npx -y @sparkleideas/ruflo workflow`, `npx @sparkleideas/cli@latest` → `npx -y @sparkleideas/ruflo@latest`, bare `claude-flow ` prefix → `npx -y @sparkleideas/ruflo `.
   - New `describe('codemod: ADR-0244 Pass 7 extension — commands/*.ts brand drift')` block in `tests/pipeline/codemod.test.mjs` per [[ADR-0143]] §Implementation step 1 pattern.
   - Golden-master snapshot of `cli --help` output asserts no `claude-flow@v3alpha` substring post-build.

6. **INTEGRATION-LEDGER rows** for all **9 byte-identical sites** (corrected from 6): per-site `superseded-by-local` dispositions citing ADR-0244 and naming the upstream byte-identical block. Update per `[[feedback-update-integration-ledger]]`. Sites: F-01-001 (process.ts), F-01-002 (start.ts daemonPidPath block), F-01-003 (swarm.ts scale block), F-01-004 (workflow.ts), F-01-005 (config.ts), F-01-006 (mcp.ts toggle block), F-01-007 (mcp.ts:271 "27 enabled" line), F-01-009 (parser.ts applyDefaults block), F-01-013 (completions.ts).

7. **Acceptance checks**: per-site behaviour tests asserting failure surfaces the cause:
   - Parser #11: `default: 'false'` on `type: 'boolean'` resolves to boolean `false`; `default: '100'` on `type: 'number'` resolves to number `100`; `default: 'a,b,c'` on `type: 'string[]'` resolves to `['a','b','c']`.
   - CC-01 sites: `expect(result.success).toBe(false)` when underlying operation fails (no silent success-on-MCP-fail).
   - F-01-001/#2: `ls .claude-flow/daemon.pid` after `start --daemon` shows the file is NOT written by start (only `daemonCommand` writes it).
   - F-01-012 codemod: golden-master snapshot of post-build CLI help text contains zero `claude-flow@v3alpha` / `claude-flow swarm` / `claude-flow workflow` / `npx @sparkleideas/cli@latest` substrings.

### Dependencies

- [[ADR-0201]] — pre-flight checklist (all four checks cleared in §Pre-flight verification; reaffirmed in §Swarm review with byte-identity correction).
- [[ADR-0208]] — strict-flag parsing sequence. **Already-satisfied today** (fork commit `87cb68ae2` flipped `parser.ts:565` 2026-05-23; step 4 gate met). CT-K parser fix (#11) can land now without waiting on ADR-0208 lint (step 1, still outstanding but does not gate the coercion).
- [[ADR-0210]] — stub-honesty mandate (post-swarm-review Option B′ "implement/restore/delete per-stub"). CT-K's CC-01 dispositions are the CLI-handler analogue at the dispatch layer.
- [[ADR-0143]] — codemod Pass 7. F-01-012 work requires architecture extension (path-scope + multi-token), not just routing through the pipeline. New codemod-test block needed.
- [[ADR-0233]] §CT-K — parent rollup; matrix entry for the 11 findings.
- [[ADR-0234]] (CT-A sibling) — exhaustive partition of slice 01. CT-A took F-01-008 + F-01-010 (loader-cascade theme); CT-K takes the remaining 11 (CLI-honesty theme). No overlap.
- [[ADR-0238]] (CT-E sibling) — MCP-tool wire-or-remove analogue; CT-K applies the same discipline at the CLI dispatch layer.
- [[ADR-0243]] (CT-J Site #4) — canonical PID/signal discipline (`installSignalHandlersOnce` pattern in `worker-daemon.ts:469-471`). CT-K F-01-002 removes the colliding `start --daemon` PID write and defers ownership to CT-J's pattern; one-directional cross-reference.

### Validation

- **Source-shape grep** post-fix:
  - `grep -n "writeFileSync.*daemon\.pid" forks/ruflo/v3/@claude-flow/cli/src/commands/start.ts` → zero hits (block removed).
  - `grep -n "processCommand.daemon\|subCommands.*daemon" forks/ruflo/v3/@claude-flow/cli/src/commands/process.ts` → daemon subcommand block absent.
  - `grep -n "'27 enabled'" forks/ruflo/v3/@claude-flow/cli/src/commands/mcp.ts` → zero hits (replaced with `listMCPTools().length`).
  - `grep -n "claude-flow@v3alpha" forks/ruflo/v3/@claude-flow/cli/src/commands/` → zero hits post-Pass 7 codemod.
- **Behavioural acceptance**:
  - `npx ruflo swarm scale --target 5 --type backend` against missing-handler backend returns `{success:false, exitCode:1}` with the cause surfaced (not `{success:true}`).
  - `npx ruflo workflow template create --name X --file Y` writes `.claude-flow/templates/X.json` AND returns `{success:true, data:{name, path}}` (OR subcommand absent if delete-disposition chosen).
  - `npx ruflo mcp toggle --disable foo` writes `mcp.disabledTools` to config AND prints "Restart required for changes to take effect".
  - `npx ruflo config reset --section swarm` resets only the swarm section (not the entire config).
  - `npx ruflo --help` and per-subcommand `--help` contain zero `claude-flow@v3alpha` substrings.
- **Per-site behaviour-test pass count**: 11/11 (one per finding).
- **No `skip_accepted`** per `[[feedback-skip-accepted-as-squelch]]`.

### Top risk + mitigation

- **Risk**: parser fix #11 surfaces 25+ strict-equality bugs at downstream sites (DA's principled-dissent concern). A low-coverage downstream strict-equality check may pass the suite locally but break in production. Same shape as ADR-0208 step 4's `commands-deep.test.ts:847` flip — the suite caught one site; the production cleanup discovered more.
- **Mitigation**: gate the parser fix behind a full unit+acceptance suite run *with the coercion applied locally* (per §Sequencing step 1 amendment); enumerate every new failure as in-scope #11 cleanup. Beyond that, the residual risk is general test-coverage limit, not specific to CT-K. Forward-pointer: future arch-test could grep for `=== true` / `=== false` patterns on `ctx.flags.*` and require a corresponding `as boolean` cast OR explicit default declaration — out of CT-K scope.
- **Second risk**: F-01-012 Pass 7 architecture extension touches the codemod pipeline (`scripts/codemod.mjs`) — a fork-critical infrastructure file. A broken Pass 7 extension regression could cascade through every release. Mitigation: new codemod-test block per ADR-0143 §Implementation pattern; golden-master snapshot of pre/post build CLI help text; commit per `[[feedback-commit-forks-before-release]]` so the release rebuilds against committed state.

---

## ADR-0245 — CT-L: pipeline robustness + set-e discipline

**Status**: proposed (post-swarm-review)
**Swarm**: 4 experts + devil's advocate, Quorum-majority consensus, hierarchical topology, tactical queen, queen-composed transport
**Triage rank**: 6 (per [[ADR-0233]] §Decision; wave 2 of 5)

### Decision (post-swarm-review)

Adopt hybrid **A+B+C, scope-merged** as originally drafted — per-site
disposition table for 11 findings, `run_phase_norevert` helper extracted into
`lib/pipeline-helpers.sh`, and `scripts/lint-set-e-discipline.mjs` gating
gate-0. Quorum-majority **4/4 in favour**; devil's advocate withdraws principled
dissent with one accepted proposal (R5 below). Six refinements applied to the
ADR; the per-site disposition table, helper shape, and lint gate ship as
written.

### Implementation steps

The ADR's concrete steps 1-14 stand, with these refinements applied:

1. **Step 1 amended (R2)**: `run_phase_norevert`'s recoverable-error allowlist
   is per-call explicit (3rd argument or per-phase shell array), not a global
   lookup table. Prevents allowlist drift becoming a new registry-drift class
   (the very anti-pattern CT-C's ADR-0236 closes for scope registries).
2. **Step 3 amended (R3)**: also emit a node-importable `lib/fork-paths.mjs`
   re-exporting `FORK_DIR_*` so the 9 sibling `.mjs` lint scripts import from
   one source rather than carry independent `process.env.X ?? "/Users/henrik/..."`
   defaults. Composes with CT-C's single-source-of-truth pattern; closes the
   path-default registry-drift class before it opens.
3. **Step 6 amended (R5)**: agentic-flow `tsc --noEmit` baseline assertion
   reads from a checked-in `config/agentic-flow-type-error-baseline.json`
   (single key: `{"count": 256}`). Any bump to the number is a reviewable PR
   delta, not an invisible source-tree edit. Matches the
   `config/runtime-externals-allowlist.json` shape step 7 proposes — one
   pattern for "bounded baselines re-measured on intent".
4. **Step 12 amended (R1)**: lint implementation must explicitly handle the 5
   scripts without `set -e` (not the 3 named in the ADR body):
   `check-no-cwd-in-handlers.sh`, `publish-verdaccio.sh`, `run-check.sh`,
   `test-acceptance-fast.sh`, `test-acceptance.sh`. Pick per-script: migrate to
   `set -euo pipefail` OR add `# DELIBERATE:` header comment with rationale.
5. **Step 12 also amended (R4)**: lint accepts `# DELIBERATE-<id>:` (linking
   to ADR or corpus memory) so future audits can grep all exemptions and
   verify each has a live justification. Lint failure messages cite both
   file:line AND the helper + corpus rule (`run_phase_norevert` +
   `feedback-best-effort-must-rethrow-fatals`).
6. **New step 15 (R6/queen)**: no INTEGRATION-LEDGER row needed — fork-local
   pipeline infrastructure with no upstream hand-port. Explicit note per
   `[[feedback-update-integration-ledger]]` to prevent "missing-row"
   audit at next upstream sync.
7. **New step 16 (mitigation per Top risk)**: register the lint as an
   acceptance-tier check (not just `npm run lint` rider), plus a behavioural
   acceptance check that greps the 2 deliberate `-uo pipefail` scripts for
   zero remaining `|| log` swallows in their tolerant-phase blocks, and
   asserts each tolerant phase routes through `run_phase_norevert`. Matches
   the [[ADR-0215]] golden-master pattern; closes the copy-paste loophole
   the DA's first dissent hook surfaced.

### Dependencies

- [[ADR-0231]] wave A9 — defect-class origin; this ADR closes the same
  release-regression shape extending to the publish-wrapper branch.
- [[ADR-0233]] §CC-02-B (`set -e` discipline cross-cutting) + §CC-02-C
  (machine-pinned paths) — the cross-cutting themes this ADR closes out.
- [[ADR-0236]] (CT-C close-out) — sibling on the same audit slice. CT-C took
  the registry-drift family (`F-02-001`/`F-02-002`/`F-02-004`); CT-L takes the
  remaining 11 pipeline-robustness findings. R3 (node-importable
  `lib/fork-paths.mjs`) extends CT-C's single-source-of-truth pattern to
  cross-script path defaults.
- [[ADR-0226]] (writeFrame discipline) — kinship: both ADRs formalise an
  idiom by giving it a named helper (`writeFrame`/`run_phase_norevert`) +
  lint to prevent regression.
- [[ADR-0243]] (CT-J) — shape sibling: same per-site disposition + helper
  extraction pattern.
- [[ADR-0201]] — Remediation-ADR pre-flight checklist (all 4 checks pass:
  signal reaches audience at the publish stage for `F-02-003`/`F-02-005`/
  `F-02-006/audit-dynamic-imports.sh`; upstream not decided; premise true
  at runtime per direct head/sed verification; no sibling-ADR overlap).
- [[ADR-0193]] — kinship via `feedback-best-effort-must-rethrow-fatals` rule.

### Validation

- **Source-shape (lint)**: `node scripts/lint-set-e-discipline.mjs` passes on
  current state after step 12's per-script migration; fails red on a
  deliberately inserted `.sh` file with `set -uo pipefail` but no
  `# DELIBERATE:` header.
- **Source-shape (helper adoption)**: `grep -c "run_phase_norevert" scripts/publish-verdaccio.sh`
  returns at least 2 (Phase 4 wrapper-publish, Phase 6 promote);
  `grep -c "|| log " scripts/publish-verdaccio.sh` in the tolerant-phase
  blocks (lines 160-210) returns 0.
- **Source-shape (paths)**: `grep -c "/Users/henrik/" scripts/ruflo-publish.sh`
  returns 0 (3 sites migrated to `${FORK_DIR_*}`);
  `grep -c "/home/claude/" scripts/audit-dynamic-imports.sh` returns 0
  (dead Hetzner paths re-pointed per `[[feedback-never-touch-hz-remote]]`).
- **Source-shape (baseline data)**: `cat config/agentic-flow-type-error-baseline.json`
  exists with `{"count": 256}` (or current re-measure);
  `config/runtime-externals-allowlist.json` exists with `["flow-nexus"]`.
- **Behavioural (acceptance)**: a synthetic `npm publish` failure (mock
  registry returning 500 for non-"already-exists" reason) on the wrapper
  exits non-zero at the publish stage — proves `F-02-003` regression
  guard works. Today: synthetic failure exits 0, masking through to
  acceptance against stale wrapper.
- **Behavioural (acceptance)**: a deliberate `audit-dynamic-imports.sh`
  invocation in a temp checkout reports scanning >0 files (today: 0 files
  scanned, silent pass).
- No `skip_accepted` per `[[feedback-skip-accepted-as-squelch]]`.

### Top risk + mitigation

- **Risk**: helper extraction + lint + 12 site fixes across 6 files + 2 new
  files is the largest single ADR in the CT-L/M/N batch. Landing without a
  behavioural acceptance check means the lint passes day-one (current state
  IS conforming after migrations) and the helper is invoked at exactly 2-3
  sites. A future revert that loosens `set -uo` somewhere else passes the
  lint via a copy-paste `# DELIBERATE:` header with no meaningful
  justification. Same failure shape ADR-0240 §"Top risk" identifies
  (lint-without-acceptance-check pattern).
- **Mitigation**: per ADR-0240's accepted shape and R4's citation
  discipline — register the lint as an acceptance-tier check (not just
  `npm run lint` rider). Add a behavioural acceptance check that PROVES
  `run_phase_norevert` is actually invoked at the 2-3 expected sites (not
  bypassed via copy-paste of the old `|| log` pattern). The
  `# DELIBERATE-<id>:` requirement makes every future exemption
  greppable + verifiable at the next audit.
- **DA's withdrawn proposal stands as commitment**: if `# DELIBERATE-*:`
  comments accumulate without a live ADR/memory ref backing them, that's
  the signal to escalate to Option B (single source-of-truth) for the
  set-e discipline. Today: 2-3 exemptions, all backed by this ADR;
  threshold check at next audit.

---

## ADR-0248 — CT-O: plugin marketplace integrity + honesty

**Status**: proposed (post-swarm-review)
**Swarm**: 5 experts + devil's advocate, Quorum-majority per-plugin consensus (≥4/6)
**Triage rank**: 7 (per [[ADR-0233]] §Decision)

### Decision (post-swarm-review)

Apply the original ADR's **combination of Options A + C + narrow codemod-style
edit** with **three concrete amendments** surfaced by the panel: (i) F-07-004
disposition upgraded to adopt upstream's `scripts/ruflo-hook.sh` resilient
shim (verified-superior to the substitution the ADR proposed); (ii)
upstream-status claims for F-07-001 and F-07-004 corrected — both are
fork-only / fork-regressed, NOT "ALIGNED-WITH-FORK" as the ADR's pre-flight
states; (iii) brand-drift count for F-07-004 corrected from 5 → 3
(`grep -c` verified). Per-plugin votes are unanimous (6/6) on 8 of 12
dispositions; F-07-004 shim adoption is 5/6 (E4 hand-edit-only dissent
withdrawn after upstream evidence shown); F-07-007 description-rewrite is
5/6 with DA principled dissent recorded. DA withdraws on "lint is theatre"
(panel rationale: regression-guard not authorship-discipline) and on
"delete `ruflo-agentdb`" (real plugin with real registered tools); holds
principled dissent on "delete `ruflo-neural-trader`" (12-file CLI-shim
plugin) for future audit cycle.

### Implementation steps

1. **F-07-001 delete (preferred disposition)**: Remove
   `ruflo-graph-intelligence` entry from
   `forks/ruflo/.claude-plugin/marketplace.json`; delete
   `forks/ruflo/plugins/ruflo-graph-intelligence/` tree (verified
   fork-only — `ruvnet/ruflo/plugins/` has no `ruflo-graph-intelligence`
   directory). Record in INTEGRATION-LEDGER as `fork-only-deleted` (no
   upstream divergence — the plugin never existed upstream).
2. **F-07-002 phantom-tools removal**: Hand-edit
   `forks/ruflo/plugins/ruflo-agentdb/skills/vector-search/SKILL.md:5`
   to drop `mcp__ruflo__embeddings_rabitq_build|_search|_status` from
   `allowed-tools`; remove "RaBitQ 1-bit quantization" framing from
   skill body; update `scripts/smoke.sh:40-42,82,106-108` to drop the
   three phantom names from the expected-tools loop and markdown-grep
   gate; rewrite `docs/adrs/0001-agentdb-optimization.md:37,49,73` to
   drop false line-number citations. Record fork-vs-upstream divergence
   in INTEGRATION-LEDGER per `[[feedback-update-integration-ledger]]`
   (upstream carries the same phantom refs — fork is diverging
   intentionally to remove the lie).
3. **F-07-004 upstream shim re-adoption** (post-review amendment): Copy
   `ruvnet/ruflo/plugins/ruflo-core/scripts/ruflo-hook.sh` to
   `forks/ruflo/plugins/ruflo-core/scripts/` (new file in fork; the
   shim does NOT exist in fork today — verified via `ls
   forks/ruflo/plugins/ruflo-core/scripts/` returns no `ruflo-hook.sh`).
   Rewrite the 3 hook commands at lines 9, 18, 48 (`grep -c
   "claude-flow@alpha"` = 3, NOT 5 as the original ADR stated) to
   invoke `"${CLAUDE_PLUGIN_ROOT}/scripts/ruflo-hook.sh" <subcmd> || true`
   matching upstream's pattern. The shim prefers a locally-installed
   binary, falls back to `npx --prefer-offline`, always exits 0 so
   install failures never block a turn. The `_note` field in the shim
   explicitly forbids reverting to bare `npx <pkg>@alpha hooks` — this
   note must be preserved verbatim. Record in INTEGRATION-LEDGER as
   `import-from-upstream` (NOT `superseded-by-local`).
4. **F-07-006 description rewrites** (4 plugins —
   `ruflo-iot-cognitum`, `ruflo-federation`, `ruflo-knowledge-graph`,
   `ruflo-market-data`): Hand-edit each
   `plugins/<name>/.claude-plugin/plugin.json` description field to
   name the actually-composed MCP-tool families + add "workflow
   scaffold" / "thought-template" framing. No new lint — gated at PR
   review.
5. **F-07-007 description rewrite** (`ruflo-neural-trader`): Hand-edit
   `plugins/ruflo-neural-trader/.claude-plugin/plugin.json` to drop
   "112+ MCP tools" framing, name the `npx neural-trader` delegation
   explicitly. DA dissent recorded but disposition unchanged.
6. **Marketplace integrity lint** (`ruflo-patch/tests/pipeline/
   plugin-marketplace-integrity.test.mjs` — new file): 4 assertions
   per the ADR's Decision §Marketplace integrity lint section. After
   F-07-004's shim adoption, the plugin-hook-brand assertion (#3)
   strengthens to also require `${CLAUDE_PLUGIN_ROOT}/scripts/*.sh`
   routing for all hook commands. Forbidden-string set factored into
   shared `tests/pipeline/_brand-forbidden.mjs` helper (or reused from
   [[ADR-0235]]'s `umbrella-plugin-brand.test.mjs`).
7. **F-07-008 runtime verification**: Single sandbox `claude plugin
   install ruflo-cost-tracker@ruflo` + `grep -E
   "plugins/ruflo-cost-tracker/scripts" ~/.claude/plugins/
   ruflo-cost-tracker/skills/*/SKILL.md` to determine whether Claude
   Code rewrites the hardcoded `plugins/...` paths. Outcome (i): close
   F-07-008 with "accepted, document the convention in plugin's README".
   Outcome (ii): rewrite skill bodies to use `${CLAUDE_PLUGIN_ROOT}` or
   equivalent. Tracked as follow-up; not blocking ADR-0248 landing.

### Dependencies

- [[ADR-0210]] — stub-honesty mandate (implement / restore / delete,
  not label) — governs F-07-001 and F-07-002 dispositions; this ADR
  applies the principle per-plugin.
- [[ADR-0235]] (CT-B) — sibling content-invariant lint pattern for
  umbrella `plugin.json` brand miss; the per-plugin integrity lint
  here extends ADR-0235's pattern to plugin hooks + skill
  `allowed-tools` refs. Coordinate forbidden-string set so the two
  lints cannot drift.
- [[ADR-0143]] — brand-rebrand Pass 7 — F-07-004 is a Pass 5
  coverage-vs-reach gap (codemod matches the path but runs against
  build temp dir while marketplace ships from fork source via
  `marketplace.json source:` — see CT-O cross-bonus row in
  [[ADR-0233]]). Remedy is hand-edit + lint, NOT Pass 5 scope
  extension (rejected per [[ADR-0233]] pre-flight-inversion list).
- [[ADR-0117]] §Revision 2026-05-03 — service-method MCP server
  registration — the structural premise the 32 markdown-bundle plugins
  compose against; F-07-001 delete-disposition honours this design
  (the plugin's 6 MCP tools cannot be registered through plugin-side
  `mcpServers` blocks per service-method spec).
- [[ADR-0238]] (CT-E) — wire-or-remove for **central**
  `cli/src/mcp-tools/*.ts` surfaces; disjoint from this ADR's
  per-plugin scope.
- [[ADR-0201]] — Remediation-ADR pre-flight checklist — applied per
  cluster (A/B/C/D). Per the review, Cluster A check #2 and Cluster C
  check #2 are corrected; the four-check shape is preserved.

### Validation

- **F-07-001 deletion**: `grep -c "ruflo-graph-intelligence"
  forks/ruflo/.claude-plugin/marketplace.json` returns 0 AND
  `ls forks/ruflo/plugins/ruflo-graph-intelligence/` returns
  no-such-directory.
- **F-07-002 phantom-tools removal**: `grep -c "embeddings_rabitq"
  forks/ruflo/plugins/ruflo-agentdb/skills/vector-search/SKILL.md`
  returns 0 AND `grep -c "embeddings_rabitq"
  forks/ruflo/plugins/ruflo-agentdb/scripts/smoke.sh` returns 0.
  The marketplace integrity lint's tool-reference-resolution
  assertion fails today and passes after the fix.
- **F-07-004 shim adoption**: `grep -c "claude-flow@alpha"
  forks/ruflo/plugins/ruflo-core/hooks/hooks.json` returns 0 AND
  `grep -c "ruflo-hook.sh"
  forks/ruflo/plugins/ruflo-core/hooks/hooks.json` returns ≥3 AND
  `test -x forks/ruflo/plugins/ruflo-core/scripts/ruflo-hook.sh`
  succeeds (the shim was copied from upstream). The marketplace
  integrity lint's plugin-hook-brand assertion fails today and passes
  after the fix.
- **F-07-006 / F-07-007 description rewrites**: PR-review gated; no
  automated test (the rewrites are subjective).
- **F-07-008**: Runtime verification probe (cheap — single sandbox
  install + grep) determines disposition; no acceptance gate in
  ADR-0248 itself.
- **Marketplace integrity lint**: `npm run test:pipeline` invokes the
  new lint; all 4 assertions pass against the post-fix tree.
- No `skip_accepted` per `[[feedback-skip-accepted-as-squelch]]`.

### Top risk + mitigation

- **Risk**: F-07-001 deletion is a behaviour-visible change for anyone
  scripting "all plugins in `marketplace.json`" against the fork. If
  any downstream consumer (an autopilot worker, a future
  `plugin discover`-style tool, a memory entry citing the plugin)
  references `ruflo-graph-intelligence`, deletion silently breaks
  that reference. The ADR's fallback (b) — publish to Verdaccio AND
  wire `graphIntelligenceTools` into the cli registry AND add a
  markdown surface — preserves the listing but at a real cost
  (publish + cli-registry edit + new skill authoring); the ADR picks
  delete-preferred per [[ADR-0210]] stub-honesty.
- **Mitigation**: Search the corpus for `ruflo-graph-intelligence`
  references before landing the deletion. `grep -r
  "ruflo-graph-intelligence"
  ~/.claude/projects/-Users-henrik-source-ruflo-patch/memory/` to
  surface any memory entries; `grep -rn "graphIntelligenceTools"
  forks/ ruflo-patch/` to surface any code references; check
  `docs/adr/*` for any prior ADR that promises wiring (per the ADR's
  reference to ADR-126 / "Wedge-8" — that reference must be either
  re-targeted or marked deferred-without-target).
- **Secondary risk**: F-07-004 shim adoption introduces a new file
  (`scripts/ruflo-hook.sh`) into the fork. The shim runs on every
  `PostToolUse` / `Stop` hook fire — a bug in the shim is a
  per-tool-call cost. **Mitigation**: copy verbatim from upstream
  (`ruvnet/ruflo/plugins/ruflo-core/scripts/ruflo-hook.sh`) without
  modification; the upstream shim has been in production for months
  and is the proven path. Future fork-specific divergences (if any)
  go through INTEGRATION-LEDGER review.

---

## ADR-0236 — CT-C: cross-registry scope/package-name lint

**Status**: proposed (post-swarm-review)
**Swarm**: 4 experts + devil's advocate, Weighted consensus (queen ×3; denominator `(N-1)+3 = 7`), hierarchical topology, tactical queen, queen-composed transport
**Triage rank**: 8 (per [[ADR-0233]] §Decision; wave 3 of 5)

### Decision (post-swarm-review)

Adopt **Option A — pipeline-start cross-registry pairwise lint at gate-0** as
originally drafted, with eight refinements applied. Weighted-vote **+7/7**
(queen +3, all 4 experts +1 each); devil's advocate **HOLDS** principled
dissent on hook 1 (lint-is-theatre) but accepts queen's commitment to schedule
Option B as the next-pass remediation (R6); WITHDRAWS hook 2 (gate-0 softness)
on the strength of R4's 2-commit TDD discipline. Per-site disposition table,
pairwise checks list, and gate-0 invocation ship as written. The today-live
`agentic-jujutsu` drift (verified: present in `codemod.mjs:53::UNSCOPED_MAP`,
absent from `fork-version.mjs:49-58::UNSCOPED_PUBLISHABLE`, real publishable
package at `forks/agentic-flow/packages/agentic-jujutsu/package.json`) ships
as the test's first asserted GREEN case in commit-2.

### Implementation steps

The ADR's concrete steps 1-5 stand, with these refinements applied:

1. **Step 1 (named exports)**: export `SCOPES` + `UNSCOPED_PUBLISHABLE` from
   `scripts/fork-version.mjs`. Preserve internal usage; named exports only.
2. **Step 2 amended (R5)**: create `scripts/lint-scope-registries.mjs`. Every
   fail-loud message MUST cite (a) offending registry's file:line + symbol,
   (b) the registry it should agree with (file:line + symbol), (c) suggested
   fix (e.g. "add `agentic-jujutsu` to `UNSCOPED_PUBLISHABLE`" or "remove
   from `UNSCOPED_MAP`"), (d) corpus rule citation
   (`[[feedback-no-fallbacks]]` + ADR-0231 wave-A9 §Lesson #2 quote).
   Self-resolving from message alone; no ADR re-read required at release time.
3. **Step 3 amended (R2)**: add gate-0 call as the FIRST executable line
   after `set -euo pipefail` + `lib/*` sourcing in `scripts/ruflo-publish.sh`
   — BEFORE Phase 0's `verify_fork_branches` step. Fail-fast: drift caught
   before any pipeline state change.
4. **Step 4 amended (R4)**: 2-commit TDD sequence — commit-1 lands the lint
   script + unit test at `tests/pipeline/lint-scope-registries.test.mjs`
   asserting current-state drift (test fails RED on the
   `agentic-jujutsu` miss); commit-2 lands the `UNSCOPED_PUBLISHABLE` fix
   adding `'agentic-jujutsu'` to the Set, test passes GREEN. Discipline
   surfaces the drift in git history for future audits; relies on
   `[[feedback-no-history-squash]]` (already corpus-enforced).
5. **Step 5 (documentation)**: update `[[reference-pipeline-publish-paths]]`
   to name the gate-0 invariant, and add a head comment in
   `lib/pipeline-helpers.sh` cross-referencing the lint.
6. **New pairwise check #6 (R1)**: `build-packages.sh::_v3_packages` bash
   literal at `:187-191` MUST equal the inline JS `v3set` at `:200-205`
   (intra-file drift, same shape as cross-file drift). Cheap (one extra
   parse pass in the lint script), closes the same-file drift class
   E1 surfaced.
7. **Option A rationale appended (R3)**: Decision §"Option A" explicitly
   names scope-rename-at-source as the wave-A9-lesson-#2 alternative and
   rejects it because 6 of 11 drift-prone unscoped names
   (`ruvector-core-*-{darwin,linux,win32}-*`,
   `ruvector-attention-{wasm,unified-wasm}`, `ruvllm-wasm`) come from
   `napi-rs` / `wasm-pack` generated `package.json` files — rename at
   source would require hand-editing or post-processing every regeneration.
   Lint catches drift without touching generator output.
8. **Option B re-eval cadence (R6)**: Decision §"Defer option B" amended
   to "next remediation pass — CT-C round 2", not the 90-day window. The
   two recorded drift instances (wave A9 `ruvllm-wasm` + today's
   `agentic-jujutsu`) already meet the implicit threshold. Queen commits
   to follow-up cadence as a soft commitment (Weighted-vote pipeline-owner
   authority).
9. **INTEGRATION-LEDGER row not needed (R7)**: fork-local pipeline
   infrastructure with no upstream hand-port. Explicit note per
   `[[feedback-update-integration-ledger]]` to prevent "missing-row"
   audit at next sync.
10. **DA's recorded forcing function (R8)**: if `agentic-jujutsu` is the
    only drift the lint catches in the first 90 days, queen still owes
    Option B at the next pass regardless of lint-fire frequency. Recorded
    as soft commitment; not a Decision change.

### Dependencies

- [[ADR-0231]] wave A9 — defect-class origin. The eighth amendment (2026-05-24)
  fixed `publish.mjs::buildPackageMap` with the fail-loud-on-duplicate-name
  idiom; "Lessons for the corpus" #2 names this ADR's exact remit. ADR-0236
  is the systematic follow-up turning the lesson into a release gate.
- [[ADR-0215]] — codemod golden-master, the analogous test-gate for codemod
  output drift. Same shape: cheap read-only check at pipeline start, fail-loud
  on drift, no `UPDATE_GOLDEN`-style operator-accept path.
- [[ADR-0245]] (CT-L sibling) — adjacent pipeline-lint ADR on the same audit
  slice. CT-L took the registry-drift family's path-default cousin
  (R3 `lib/fork-paths.mjs` node-importable single-source); CT-C took the
  name-registry family. The two ADRs compose: both ship lints gating the
  same `ruflo-publish.sh` entrypoint.
- [[ADR-0233]] §CT-C — defect-class origin citing `F-02-001` (CRITICAL) +
  `F-02-004` (WARNING).
- [[ADR-0201]] — Remediation-ADR pre-flight checklist (all 4 checks pass per
  ADR §"Pre-flight verification": signal reaches pipeline operator at
  gate-0; upstream not decided — pipeline is fork-only infra; premise true
  at runtime per direct grep verification of today's `agentic-jujutsu`
  drift; no sibling-ADR overlap with the wave-A9 `buildPackageMap` fix
  which is narrowly publish.mjs-scoped).
- [[ADR-0095]] §amendment 2026-05-23 — same "fail-loud over silent fallback"
  idiom precedent (removed pure-TS fallback in `rvf-backend.ts`).
- [[ADR-0143]] — brand-rebrand archeology; the unscoped names this ADR
  catalogues (`ruflo`, `claude-flow`, etc.) intersect Pass 7 scope but
  belong to the publishability axis, not the brand axis.

### Validation

- **Source-shape (today's drift)**: `grep -n "agentic-jujutsu"
  scripts/fork-version.mjs scripts/codemod.mjs` returns exactly one hit
  (codemod.mjs:53), confirming the drift the lint catches.
- **Source-shape (post-fix)**: after commit-2, `grep "agentic-jujutsu"
  scripts/fork-version.mjs` returns one hit inside the
  `UNSCOPED_PUBLISHABLE` Set literal.
- **Source-shape (lint exists)**: `scripts/lint-scope-registries.mjs`
  exists, is `node --test`-importable, exports a `lintAll()` function
  returning `{ passes: [...], failures: [{ registry, expected, found, fix }] }`.
- **Source-shape (gate-0 wired)**: `grep -nB 2 -A 5 "lint-scope-registries"
  scripts/ruflo-publish.sh` returns a hit BEFORE the `verify_fork_branches`
  call (Phase 0).
- **Behavioural (acceptance-tier)**: a synthetic addition of `'demo-pkg':
  '@sparkleideas/demo'` to `codemod.mjs::UNSCOPED_MAP` followed by
  `bash scripts/ruflo-publish.sh --dry-run` exits non-zero with an error
  message naming both files, both line numbers, and the suggested fix.
- **Behavioural (TDD discipline)**: `git log --oneline scripts/lint-scope-registries.mjs
  scripts/fork-version.mjs` shows a 2-commit sequence (lint+test first,
  fix second) — not squashed.
- **Behavioural (acceptance check survives gate-0 regression)**: an
  acceptance-tier check independently invokes
  `node scripts/lint-scope-registries.mjs` against current state, so a
  future regression that removes the gate-0 call from
  `ruflo-publish.sh` still fails the release.
- No `skip_accepted` per `[[feedback-skip-accepted-as-squelch]]`.

### Top risk + mitigation

- **Risk**: same shape as ADR-0240 and ADR-0245
  (lint-without-acceptance-check pattern). The lint script exists, gate-0
  is wired, but a future regression — someone moves the lint call below
  Phase 0 or comments it out during a debug pass — silently de-activates
  the gate. Pre-flight #1 trap shape ("signal reaches audience").
  Compounded here because gate-0 is `ruflo-publish.sh`'s entrypoint —
  there's no upstream gate above it.
- **Mitigation**: per ADR-0240's accepted shape — register the lint as
  an acceptance-tier check (not just `ruflo-publish.sh` invocation). The
  acceptance check (a) boots `bash scripts/ruflo-publish.sh --dry-run` and
  confirms the gate-0 log line "lint-scope-registries: PASS" appears in
  output, AND (b) independently invokes
  `node scripts/lint-scope-registries.mjs` against current state. Belt +
  braces: gate-0 catches the operator at release time; acceptance check
  catches the gate-0 regression itself. Matches the [[ADR-0215]]
  golden-master pattern and the CT-G/CT-L mitigations.
- **Secondary risk**: the 2-commit TDD sequence (R4) requires discipline
  at fix-commit time. **Mitigation**: per `[[feedback-no-history-squash]]`,
  the project already forbids squash-to-clean-up; this risk is
  structurally bounded.
- **DA's principled-dissent forcing function (R8)**: if Option B is not
  scheduled at the next remediation pass — independent of how often the
  lint fires — the audit's "5 registries" structural finding survives
  unaddressed. Recorded; not a Decision change but a queen-side
  commitment.

---

## ADR-0238 — CT-E: per-surface wire-or-remove triage for 8 unused security/telemetry/consensus surfaces

**Status**: proposed (post-swarm-review)
**Swarm**: 6 experts (5 + DA), Quorum-majority per-surface (≥4/6)
**Triage rank**: 9 (per [[ADR-0233]] §Decision)

### Decision (post-swarm-review)

All 8 surfaces ADOPTED per-surface at the per-surface quorum threshold
(≥4/6); 6 of 8 cleared with 5/6 (DA dissent) or 6/6 (unanimous). The
chosen Option A ("per-surface triage") stands intact; six lightweight
improvements were folded:

- **Surface 1 (AIDefence)**: honesty-correction + keep (5/6, DA dissent).
  Cross-reference to [[ADR-0247]] F-04-010 ride-along on the same docblock
  added.
- **Surface 2 (Claims RBAC central dispatch)**: remove API surface /
  advisory banner (6/6 unanimous).
- **Surface 3 (`agentdb_telemetry_metrics`/`_spans`)**: delete tools,
  redirect to working stat tools (5/5 telemetry-specialist + general
  vote, DA agreed). Confirmation gate extended: `observe-metrics` skill
  must resolve the 4 redirected tools at HEAD.
- **Surface 4 (Dead `swarm/src/consensus/*.ts`)**: quarantine, do not
  delete (5/6, DA dissent). Rationale **strengthened** with specific
  upstream-investment evidence — 3 commits on `transport.ts` +
  `federation-transport.ts` titled "ADR-095 G2 pluggable
  ConsensusTransport + Ed25519 message signing", most recent
  `22ca3b018` on **2026-05-11** (13 days before this review). File-header
  comment must cite the commit so future upstream-sync agents see the
  live evidence.
- **Surface 5 ("Raft" naming honesty)**: description honesty (6/6).
- **Surface 6 (`paxos` silent substitution)**: bundled with Surface 4;
  remove enum + switch case (6/6). Implementation-sequencing note:
  Surface 6 changes go in the **same commit** as Surface 4's quarantine
  arch-test.
- **Surface 7 (`weighted` enum CLI alignment)**: add to CLI enum (6/6).
  Zero-merge-tax (upstream has same drift); fastest win in this ADR.
- **Surface 8 (5 consensus agent .md frontmatter honesty)**: `advisory: true`
  frontmatter + leading "Advisory roleplay only" paragraph (5/6, DA dissent).
  Implementation note: if `advisory` is a novel frontmatter field,
  document the schema in a one-line addendum to `cli/.claude/agents/README.md`.

DA holds principled dissent on Surfaces 4 + 1 + 8 framings (quarantine
maintenance debt; central-wiring deferral leaves F-04-001 unmitigated;
consensus prompt-body language still leads operators). All flagged as
future re-evaluation opportunities; none block the per-surface adoption.

### Implementation steps

1. **Surface 2 (advisory banner — easy + unanimous first)**: add a leading
   banner to `claude-flow claims check/grant/list` CLI commands:
   `"ADVISORY: this command writes policy that NOTHING currently enforces. See ADR-0238 Surface 2."`
   OR delete the command surface entirely (record the chosen sub-option in
   the implementation commit). Update `cli/src/commands/claims.ts` per
   ADR-0238 Surface 2 §Action.
2. **Surface 7 (enum alignment — zero-merge-tax)**: add `'weighted'` to
   `cli/src/mcp-tools/hive-mind-tools.ts:73` `ConsensusStrategyName` enum
   and the `hive-mind --consensus` flag enum in `commands/hive-mind.ts`.
   Update help text + skill doc count from 5 to 6 modes. The 277-LOC
   `weighted.ts` handler already works.
3. **Surface 5 (description honesty)**: rewrite `commands/hive-mind.ts:146`
   help text from "Raft, Leader-based consensus" to "Raft-flavoured:
   term-bucketed majority voting against a queen-elected leader (no leader
   election, no log replication, no RPC)". Same rewrite to MCP tool schema
   description.
4. **Surface 1 (framing-honesty docblock pass)**: rewrite
   `@claude-flow/aidefence/src/index.ts:1-30` to "manual scan utility"
   framing per F-04-005 **AND** add the F-04-010 ride-along
   (per [[ADR-0247]] Site 2) clarifying HNSW scope: "HNSW search of past
   learned patterns (`searchSimilarThreats`); detection latency is a fixed
   regex pass over 50 patterns, not HNSW-accelerated." Rewrite
   `plugins/ruflo-aidefence/docs/adrs/0001-aidefence-contract.md` 3-gate
   ADR + plugin README. Remove `aidefence_verdict` mention from
   `browser-session-tools.ts:306,308,323-329`.
5. **Surface 3 (delete telemetry tools + redirect)**: delete the two MCP
   tool registrations at `cli/src/mcp-tools/agentdb-tools.ts:1587-1641`.
   Update `agents/observability-engineer.md` + `observe-metrics`/`observe-trace`
   skills to point at `agentdb_resource_usage`, `agentdb_circuit_status`,
   `agentdb_rate_limit_status`, `agentdb_query_stats` (verify all 4
   resolve at HEAD via `getController`). Mark ADR-0045 supersession in the
   deletion commit.
6. **Surface 4 + 6 (quarantine + paxos enum removal — same commit)**:
   add file-header to `swarm/src/consensus/{raft,byzantine,gossip,index}.ts`:
   `// QUARANTINED: not reachable from any user-facing path; reach via dispatch through agentdb/archivist/handlers/hive-mind/consensus/* instead. Retained to track upstream's investment.`
   `// Upstream is actively extending this surface (see ruvnet/ruflo commit 22ca3b018, ADR-095 G2 — pluggable ConsensusTransport, 2026-05-11). Delete-or-quarantine decision dispatched per ADR-0238 quarantine disposition.`
   Add arch-test at `swarm/__tests__/no-new-consensus-imports.test.ts`
   forbidding new `.ts` files from importing from `./consensus/` (existing
   `unified-coordinator.ts:303` allowlisted). Update `swarm/README.md` to
   mark the `ConsensusEngine` example as "experimental; live consensus
   path is `hive-mind --consensus <mode>`". In the same commit: remove
   `'paxos'` from `swarm/src/types.ts:199` `ConsensusAlgorithm` and
   `swarm/src/index.ts:326` `CONSENSUS_ALGORITHMS`; delete the
   `case 'paxos':` fall-through at `consensus/index.ts:77-85`.
7. **Surface 8 (5 consensus agent frontmatter honesty)**: add to each of
   `cli/.claude/agents/consensus/{byzantine-coordinator,raft-manager,gossip-coordinator,crdt-synchronizer,quorum-manager}.md`
   frontmatter: `advisory: true`. Add leading body paragraph:
   `**Advisory roleplay only.** This agent's prompt describes distributed-consensus mechanisms (PBFT, Raft, gossip, CRDT, quorum) but spawning it does NOT enforce them. Real consensus dispatch goes through `hive-mind --consensus <mode>` → `agentdb/archivist/handlers/hive-mind/consensus/*` (single-process state-merge with per-strategy threshold arithmetic). The byzantine-coordinator name does not connect to PBFT three-phase protocol implementation.`
   Same edit to `consensus-builder.md` + `security-manager.md`. If
   `advisory` is novel, document in `cli/.claude/agents/README.md` (one
   line: "`advisory: true` — agent prompt is cognitive-scaffold only; no
   real dispatch path connects the name to enforcement").
8. **INTEGRATION-LEDGER rows**: per [[feedback-update-integration-ledger]],
   each fork-only fix gets a row.
   - Surface 1: `aidefence/src/index.ts` rewrite (joint with [[ADR-0247]] F-04-010); `browser-session-tools.ts:306-329`; `0001-aidefence-contract.md` rewrite.
   - Surface 2: `commands/claims.ts` advisory banner OR deletion.
   - Surface 3: `agentdb-tools.ts:1587-1641` deletion (fork-only invention; ledger disposition `delete-fork-only`).
   - Surface 4: 4 file-header additions + arch-test + README update — `superseded-by-local` against upstream's continuing investment (cite `22ca3b018`).
   - Surface 5: `hive-mind.ts:146` + MCP schema description; small text-only fork divergence.
   - Surface 6: `swarm/src/{types.ts,index.ts,consensus/index.ts}` — enum + case removal.
   - Surface 7: `hive-mind-tools.ts:73` + `commands/hive-mind.ts` enum add (zero merge tax — upstream same drift).
   - Surface 8: 5+2 agent .md frontmatter edits (matches upstream same files; small divergence per file).
9. **Behavioural acceptance** per surface:
   - Surface 1: `grep -rn "AI Manipulation Defense\|self-learning capabilities\|HNSW-indexed threat pattern search" forks/ruflo/v3/@claude-flow/aidefence/src/index.ts forks/ruflo/plugins/ruflo-aidefence/README` returns zero hits.
   - Surface 2: `claude-flow claims check` either prints the ADVISORY banner OR command is absent.
   - Surface 3: `grep -rn "agentdb_telemetry_metrics\|agentdb_telemetry_spans" forks/ruflo/v3/@claude-flow/cli/src/` returns ZERO; `observe-metrics` skill test resolves the 4 redirected tools.
   - Surface 4: arch-test passes (no NEW `.ts` files import from `./consensus/`); file headers present on all 4 files; README "experimental" disclaimer present.
   - Surface 5: `commands/hive-mind.ts:146` no longer says "Raft, Leader-based consensus" without "Raft-flavoured" qualifier; MCP schema description matches.
   - Surface 6: `grep -rn "'paxos'" forks/ruflo/v3/@claude-flow/swarm/src/` returns zero hits.
   - Surface 7: `claude-flow hive-mind --consensus weighted` accepts at parse and dispatches to the agentdb `weighted` handler; behaviour test exercises end-to-end propose+vote+resolve.
   - Surface 8: all 5 consensus agent .md files + `consensus-builder.md` + `security-manager.md` have `advisory: true` frontmatter + leading "Advisory roleplay only" paragraph.

### Dependencies

- [[ADR-0210]] — stub-honesty mandate (governing principle); Surfaces 1, 5,
  8 implement its Option B′ item 6 (description honesty); Surfaces 2, 3
  implement its delete arm.
- [[ADR-0201]] — pre-flight checklist; all 8 surfaces cleared all 4 checks.
- [[ADR-0247]] (CT-N sibling) — F-04-010 ride-along on Surface 1 docblock;
  F-04-006/F-04-007 deferred there with rationale matching Surface 1 here.
- [[ADR-0239]] (CT-F) — cluster 2 deletes `v3/mcp/` (consistent pattern);
  this ADR's Surface 4 explicitly **inverts** to quarantine because
  upstream invests in the swarm consensus tree but not in `v3/mcp/`.
- [[ADR-0095]] — no-fallbacks; Surface 6 (silent paxos→raft) is an
  instance; Surface 2 (half-implemented auth) is an anti-pattern.
- [[ADR-0203]] / [[ADR-0222]] — delete-dead-package precedents (Surface
  3 follows; Surface 4 inverts).
- [[ADR-0217]] — quarantine + arch-test pattern (precedent for Surface 4
  approach).
- [[ADR-0233]] §CT-E — defect-class origin.

### Validation

- All 8 source-shape greps in Decision §Confirmation (per surface).
- Per-surface behaviour tests as detailed in Implementation step 9.
- No `skip_accepted` per `[[feedback-skip-accepted-as-squelch]]`.

### Top risk + mitigation

- **Risk**: Surface 4's quarantine accretes maintenance debt (file-header
  triage + per-merge `--ours` on the consensus subtree) for code that may
  never run in production. If upstream's ADR-095 G2 transport investment
  stalls and no real consumer wires `ConsensusEngine` within 6-12 months,
  the quarantine becomes permanent dead code with bookkeeping cost the
  ADR doesn't recoup.
- **Mitigation**: file-header cites the specific upstream commit
  (`22ca3b018` ADR-095 G2 step 1, 2026-05-11) so future upstream-sync
  agents have a concrete reference to re-evaluate. Add a memory entry
  (`project-adr0238-surface4-quarantine-watch`) noting the
  upstream-investment-watch posture: re-evaluate Surface 4 if (a) upstream
  abandons ADR-095 G2 work for >6 months OR (b) a real consumer wires
  `ConsensusEngine` (in which case the quarantine should lift and
  Surface 4 graduates to wire-then-keep). DA's principled dissent
  recorded for re-evaluation trigger.

### Key upstream finding

**The CT-E quarantine decision for Surface 4 is confirmed and
strengthened.** Upstream is actively investing in the consensus tree
via ADR-095 G2 (steps 1+4): pluggable `ConsensusTransport` interface
with `LocalTransport` + `FederationTransport` implementations, Ed25519
message signing, fail-closed signature verification. Most recent commit
`22ca3b018` landed **2026-05-11**, 13 days before this review. The
commit messages explicitly target F-09-002 (the "single-process Map
peers" gap). Quarantine over delete is correct; the ADR's "investment"
claim was understated and is now backed by concrete commit citations
in both the file headers and INTEGRATION-LEDGER rows.

---

## ADR-0239 — CT-F: per-cluster dead-code triage + CVE-loader relocation + release-gate

**Status**: proposed (post-swarm-review)
**Swarm**: 6 experts (5 + DA), Quorum-supermajority per-cluster (≥5/6 for DELETE; ≥4/6 for MERGE/DEFER/KEEP)
**Triage rank**: 10 (per [[ADR-0233]] §Decision)

### Decision (post-swarm-review)

All 8 clusters adopted per-cluster at the supermajority threshold (≥5/6 for DELETE; ≥4/6 for MERGE/DEFER/KEEP); 8/8 cleared **6/6 unanimous** with substantive amendments folded for clusters 1, 4, 5, 7, and 8. The chosen Option A ("per-cluster triage with explicit delete-vs-wire-vs-merge per cluster + `acceptance/no-new-dead-code` release-gate") stands intact; the per-cluster table is unchanged in shape but tightened in confirmation gates and ordering discipline.

Cluster-by-cluster summary:

- **Cluster 1** `v3/@claude-flow/testing/` (16,566 LOC): **DELETE adopted 6/6**. Confirmation extended to assert tsconfig project-reference removal.
- **Cluster 2** `v3/mcp/` server + transport (5,587 LOC): **DELETE adopted 6/6**. Cross-bonus closes F-10-002 (CT-J) + F-05-001 (CT-G) — one delete, three CT findings resolved.
- **Cluster 3** `v3/src/` parallel DDD scaffold (3,612 LOC): **DELETE adopted 6/6**. Forbidden-token risk closes (`HybridBackend`/`SqlJsBackend` JSDoc per `[[feedback-forbidden-substring-tests-grep-dist]]`).
- **Cluster 4** embedding-stack MERGE-THEN-DELETE (~6,462 + ~4,470 absorbed): **ADOPTED 6/6 w/ amendments**. CVE-loader relocation (step (a)) is the load-bearing prerequisite; hard assertion required that `@huggingface/transformers` resolves on fresh install; interim-window quarantine header on `wrappers/embedding-service.ts` between steps (a/b) and (c).
- **Cluster 5(a)** `cognitive-kernel/` + `ruvector-upstream/` (5,258 LOC): **DELETE adopted 6/6**. Verdaccio 404 verification (both packages not published) required before deletion.
- **Cluster 5(b)** 10 catalog-listed `v3/plugins/*` incl. gastown-bridge + agentic-qe (~50,000 LOC): **DEFER to CT-E adopted 6/6**. Per [[ADR-0238]] inheritance per [[ADR-0233]] line 151 cross-bonus dependency; gastown-bridge + agentic-qe are live published Verdaccio artefacts (deletion would orphan).
- **Cluster 6** `forks/ruvector/npm/packages/*` (~10,077 LOC): **DEFER to ruvector-fork audit adopted 6/6**. Cluster 8 gate scope amended to include this fork so growth freezes pending dedicated audit.
- **Cluster 7** Single-file orphans (~5,200 LOC): **ADOPTED 6/6 w/ amendments**. F-11-014 (`appliance/`) wire-or-delete sub-option recorded in implementation commit; F-11-019 (`encryption/`) KEEP-with-watch annotation.
- **Cluster 8** `acceptance/no-new-dead-code` release-gate: **ADOPTED 6/6 w/ DA caveat**. Dual-layer gate (per-cluster arch-tests + scoped unused-export counter); scope extended to `forks/{ruflo,agentdb,ruvector}/**/src/`; direct `timeout` invocation replaces unreliable `_run_and_kill` wrapper per `[[feedback-run-and-kill-exit-code.md]]`.

DA holds principled dissent on cluster 4's residual risk profile (most security-sensitive multi-step move-then-delete in the audit) but withdraws on all other clusters; the staged-deletion discipline (gate-between-clusters) and the dual-layer gate replace the original counter-only design and address the irreversibility objection.

### Implementation steps

1. **Cluster 4 step (a) — CVE-loader relocation (FIRST, load-bearing)**:
   - Move `transformers-loader.ts` from `forks/ruflo/v3/@claude-flow/embeddings/src/` into `forks/ruflo/v3/@claude-flow/memory/src/`.
   - Rewrite `embedding-pipeline.ts:149` from `await import('@xenova/transformers')` to call the relocated loader.
   - Preserve the `source` field plumbing into `embeddings_status.runtime.source` OR concurrently land F-08-008's `getProvider()` surface in the same commit.
   - Coordination point with CT-A: the loader's `source` field IS the signal CT-A's fail-loud rework must surface.
   - **Hard acceptance gate**: `embeddings_status.runtime.source === '@huggingface/transformers'` on FRESH install (per `[[feedback-inspect-installed-not-dev-nodemodules.md]]`); `npm ls @xenova/transformers` on production install returns empty.
   - Fork commit per `[[feedback-commit-forks-before-release]]`; INTEGRATION-LEDGER row `superseded-by-local`.
2. **Cluster 4 step (b) — absorb `chunking.ts` (353 LOC) + `hyperbolic.ts` (458 LOC)** into `@claude-flow/memory`. Update the small consumer set (slice 08 confirms only the dead barrel + handful of tests touch these).
3. **Cluster 4 interim-window quarantine** (between (a/b) and (c)): annotate `forks/agentdb/src/wrappers/embedding-service.ts` + `wrappers/index.ts` with `// QUARANTINED — ADR-0239 cluster 4 step (c) pending; extend controllers/EmbeddingService.ts instead`. Removable on step (c) landing. Prevents concurrent contributor from adding a new provider class to the dead path.
4. **Per-cluster deletion sequence (gate-between discipline)**: each cluster lands one fork commit per `[[feedback-commit-forks-before-release]]`, with INTEGRATION-LEDGER row + fork arch-test ("file/dir must not exist", per [[ADR-0222]] amendment shape) + release-gate green run BEFORE the next cluster starts.
   - **Order**: 5(a) first (smallest blast radius, Verdaccio-404 verified) → 7 single-file subset (DELETE: `headless.ts`, `benchmarks/pretrain`, `v3/agents/*.yaml`, `production/`) → 7 wire-or-delete (`appliance/` — record sub-option) → 7 KEEP-with-watch annotation (`encryption/`) → 2 + 3 (paired, F-11-003 test depends on F-11-001) → 4 step (c) (delete `@claude-flow/embeddings/` package + agentdb `wrappers/`, `compatibility/`, `observability/`, `search/`) → 1 (workspace package, largest dependency-graph removal).
   - Run `npm run release -- --force` if dist-skip artefacts appear (per `[[feedback-pipeline-shared-skip-on-dist-clear.md]]`).
5. **Cluster 8 — release-gate wiring (LAST, after deletions land)**:
   - Wire `ts-prune`/`knip` invocation over `forks/{ruflo,agentdb,ruvector}/**/src/` after the post-codemod build.
   - Dual-layer gate:
     - (i) **Per-cluster arch-tests** (file/dir must not exist) for clusters 1, 2, 3, 5(a), 7-subset, 4(c) — [[ADR-0222]] shape.
     - (ii) **Scoped unused-export counter** capped at post-deletion deduped figure; fail the release on growth.
   - Register the check with BOTH `run_check_bg` AND `collect_parallel` per `[[reference-acceptance-runcheck-vs-collect]]`.
   - Use direct `timeout` invocation; do NOT rely on `_run_and_kill`'s `_RK_EXIT` per `[[feedback-run-and-kill-exit-code.md]]`.
   - Verify with deliberate orphan-export commit that the gate fails red; passes green on `main`.
6. **Cluster 5(b) handoff to CT-E**: hand off the 10 catalog-listed plugins to a sibling [[ADR-0238]]-shape decision under [[ADR-0210]]'s stub-honesty mandate. This ADR does NOT decide those. gastown-bridge + agentic-qe remain live on Verdaccio through the deferral window.
7. **Cluster 6 handoff to ruvector-fork audit**: dedicated audit pending. Cluster 8 gate (extended scope) catches further accretion in `forks/ruvector/npm/packages/*`.
8. **INTEGRATION-LEDGER rows**: per `[[feedback-update-integration-ledger]]`, each fork-only deletion gets a row with `superseded-by-local` disposition citing this ADR.
   - Cluster 1: workspace package + tsconfig project-reference + lockfile entry + `cli/src/update/checker.ts` severity-list entry.
   - Cluster 2: `forks/ruflo/v3/mcp/` whole directory.
   - Cluster 3: `forks/ruflo/v3/src/` whole directory + the one integration test in `v3/__tests__/integration/mcp-integration.test.ts`.
   - Cluster 4: relocation (memory absorption); deletion of `@claude-flow/embeddings/` package + 4 agentdb subtrees.
   - Cluster 5(a): `v3/plugins/cognitive-kernel/` + `v3/plugins/ruvector-upstream/`.
   - Cluster 7 deletions: 5 separate rows (one per deleted target).

### Dependencies

- [[ADR-0094]] (implemented) — CVE-mitigated `transformers-loader.ts` code-of-record being relocated in cluster 4 step (a).
- [[ADR-0222]] (implemented) — delete-dead-services precedent at smaller scope; arch-test shape + `--ours` merge-tax pattern.
- [[ADR-0203]] (implemented) — delete-dead-package precedent; cluster 1 (`@claude-flow/testing/`) matches this shape.
- [[ADR-0238]] (proposed, CT-E sibling) — cluster 5(b) hand-off destination; inherits gastown-bridge + agentic-qe deferral.
- [[ADR-0240]] (proposed, CT-G) — cluster 2's deletion evaporates Site #1 (F-05-001) per cross-bonus.
- [[ADR-0243]] (proposed, CT-J) — cluster 2's deletion evaporates F-10-002 (un-`.unref()`'d timers).
- [[ADR-0210]] (implemented) — stub-honesty mandate governing cluster 5(b) hand-off.
- [[ADR-0215]] (implemented) — golden-master pattern (model for cluster 8 lint gate; DA's critique refined the design to dual-layer).
- [[ADR-0233]] §CT-F — defect-class origin (~57,200 LOC unique TS source dead across 23 findings + 8 clusters).
- [[ADR-0201]] — Remediation-ADR pre-flight checklist that cleared this draft (all four checks pass per ADR §Pre-flight).

### Validation

- Source-shape per-cluster greps in Decision §Confirmation table.
- Per-cluster arch-tests (`*-arch.test.ts`) pass — file/dir absence after deletion.
- Cluster 4 step (a) hard CVE-resolution assertion: `embeddings_status.runtime.source === '@huggingface/transformers'` on fresh install; `npm ls @xenova/transformers` returns empty.
- Cluster 5 publish-status pre-checks: `npm view --registry=http://localhost:4873 @sparkleideas/plugin-{cognitive-kernel,ruvector-upstream}` returns 404 before deletion; `@sparkleideas/plugin-{gastown-bridge,agentic-qe} dist-tags` continues returning valid `latest` through deferral.
- Cluster 8 dual-layer gate: arch-tests pass; scoped unused-export count ≤ today's cap; deliberate orphan-export commit trips the gate red.
- Cross-bonus confirmation post-cluster 2: F-10-002 `evictionTimer`/`heartbeatTimer`/`cleanupTimer` paths no longer exist in tree; F-05-001's `server-entry.ts` deleted with the rest of `v3/mcp/`.
- Per-cluster release gate green between each deletion (gate-between-clusters discipline).
- No `skip_accepted` per `[[feedback-skip-accepted-as-squelch]]`.

### Top risk + mitigation

- **Risk**: cluster 4 step (a)'s CVE-loader relocation silently falls back to `@xenova/transformers` on production install (the loader's documented prefer-`@huggingface`-fallback-`@xenova` shape). The CVE bypass that F-08-002 flags would continue post-relocation without anyone noticing — the relocation gives the **appearance** of a fix while the actual import chain still pulls protobufjs <7.5.5.
- **Mitigation**: cluster 4 §Confirmation amended (DA-driven) to require BOTH (a) `embeddings_status.runtime.source === '@huggingface/transformers'` on FRESH install (per `[[feedback-inspect-installed-not-dev-nodemodules.md]]`), AND (b) `npm ls @xenova/transformers` on production install returns empty. If `@huggingface/transformers` is not installed on the production target, the gate fails red. The dual-assertion catches both the "loader silently fell back" and the "loader was wired but the package wasn't installed" failure modes. Pair with CT-A's fail-loud rework: any silent fallback in the loader's resolution path becomes a thrown error, not a stderr-only warn.

### Key upstream finding

**CVE-loader location verified**: `find` on `forks/ruflo/v3/@claude-flow/` returns a single source copy of `transformers-loader.ts` at `embeddings/src/transformers-loader.ts` (in the dead stack) with compiled artefacts at `embeddings/dist/`. The live embedding path at `memory/src/embedding-pipeline.ts:149` hardcodes `await import('@xenova/transformers')` — the loader's CVE-mitigation logic is structurally bypassed. The loader's file-header explicitly cites ADR-094 protobufjs <7.5.5 RCE. **Deleting the dead `@claude-flow/embeddings/` package without first relocating the loader code into the live path would regress the CVE posture for every embedding generated by production CLI/MCP/memory** — this is the load-bearing rationale for cluster 4's MERGE-THEN-DELETE ordering. Upstream `ruvnet/ruflo` carries the same hardcoded `@xenova` import at the same site (CVE bypass inherited, not a fork regression); the fork-only relocation opens a one-line merge-tax until upstream takes a matching patch.

**Secondary upstream finding (cluster 5 publish-status asymmetry)**: `@sparkleideas/plugin-gastown-bridge@0.1.3-patch.822` and `@sparkleideas/plugin-agentic-qe@3.5.59-patch.418` are live on Verdaccio (verified via `npm view --registry=http://localhost:4873`); the other 11 catalog-listed `v3/plugins/*` packages are NOT published (404 on Verdaccio for `cognitive-kernel`, `ruvector-upstream`, and the 9 others in cluster 5(b)). Cluster 5's split (DELETE 5(a) unpublished; DEFER 5(b) published to CT-E) is the only configuration that doesn't orphan a live published artefact. Verdaccio is the only registry that matters per `[[reference-verdaccio]]`; public-npm is shadowed and inaccessible.

---

## ADR-0241 — CT-H: schema-vs-handler truth + dedupe

**Status**: proposed (post-swarm-review)
**Swarm**: 6 experts + devil's advocate, Byzantine consensus (f=⌊5/3⌋=1; ≥3/6 supermajority)
**Triage rank**: 11 (per [[ADR-0233]] §Decision — relax-not-tighten inversion confirmed)

### Decision (post-swarm-review)

Ratify **Option D1 + Option B + F-14-003 typed allowlist** as drafted, with one
substantive correction surfaced by E5 (upstream-coherence tracker) and one
scope tightening surfaced by E4 (Zod-arch-test specialist):

1. **Correction (E5)**: ADR-0241's pre-flight #2 currently labels the
   `invalid_enum_value continue` swallow as "fork-only by comment archeology".
   Direct read of `/Users/henrik/source/ruvnet/ruflo/v3/@claude-flow/cli-core/src/mcp-tools/validate-input.ts:248`
   shows the swallow is **byte-identical between fork and upstream** (the fork's
   `cli/src/mcp-tools/validate-input.ts` is a 10-line re-export shim of the
   upstream cli-core path per its own header `"Authoritative source:
   @claude-flow/cli-core/mcp-tools/validate-input"`). The F-14-003 fix therefore
   carries upstream merge-tax that the ADR currently underweights. Amendment
   adds an INTEGRATION-LEDGER row per `[[feedback-update-integration-ledger]]`
   with a `superseded-by-local` disposition and a divergence-marker comment per
   the [[ADR-0234]] precedent.
2. **Scope tightening (E4)**: Option B arch-test runs full enumeration
   (~200 tools × ~3 required fields ≈ 600 generated tests) under `npm run release`
   acceptance, NOT per-PR CI. The ADR's "sampling is optional" line stays as
   written, but the gate registration goes into `_run_and_kill` + `collect_parallel`
   per `[[reference-acceptance-runcheck-vs-collect]]` to avoid the silent-no-verdict
   trap from `feedback-no-squelch-tests` heritage.

DA (devil's advocate) holds **principled dissent on Option B's value vs cost**
post-vote: argues arch-test catches a defect class whose only known instance
(F-14-001) is being fixed structurally by [[ADR-0204]] (b), so the gate is
belt-and-braces theatre for a class that won't recur once the wire-validator
ships. DA accepts the majority verdict (the gate is cheap, ~30s wall-clock per
release; mitigates the regression-window between ADR-0204 (b) landing and
broader handler-rule adoption) but records the dissent for the
ADR-0233 follow-up tracker.

### Implementation steps

1. **F-14-001 schema relax (Option D1)** in `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/memory-tools.ts`:
   - `:193` — change `required: ['key', 'value', 'namespace']` to `required: ['key', 'value']`
   - `:182` — update property description to `'Namespace for organization (default: "default")'`
   No handler change. Commit per `[[feedback-commit-forks-before-release]]`.
2. **INTEGRATION-LEDGER row** for F-14-001 fix: `convergence-with-upstream`
   disposition — the change re-aligns fork with upstream `memory-tools.ts:274`,
   closing fork-introduced divergence per
   `[[feedback-update-integration-ledger]]`.
3. **F-14-003 typed allowlist** in `forks/ruflo/v3/@claude-flow/cli-core/src/mcp-tools/validate-input.ts:248`:
   - Replace the bare `if (issue.code === 'invalid_enum_value') continue;` with
     the explicit allowlist check from the ADR's "Concrete change shape" §2.
   - Add divergence-marker comment per [[ADR-0234]] precedent: `// FORK: typed
     allowlist replaces upstream's silent swallow (CT-H/F-14-003 — see ADR-0241).`
   - **INTEGRATION-LEDGER row**: `superseded-by-local` (upstream-mergetax row;
     swallow is byte-identical upstream, so every sync needs this re-applied).
4. **Option B arch-test** at `forks/ruflo/v3/@claude-flow/cli/__tests__/arch/schema-handler-parity.arch.test.ts`
   per the ADR's "Concrete change shape" §3:
   - Iterate every cli `mcp-tools/*` registry (memory, hive-mind, agent,
     swarm, neural, etc.). Full enumeration, not sampled.
   - For each `(tool, requiredField)` pair, assert handler rejects (throws OR
     returns `{success: false, error: <contains-field-name>}`).
5. **Acceptance check registration** per `[[reference-acceptance-runcheck-vs-collect]]`:
   register the arch-test in both `run_check_bg` AND `collect_parallel` lists in
   the release pipeline; gate is `no-skip-accepted` per
   `[[feedback-skip-accepted-as-squelch]]`.
6. **Confirmation tests (4)** per ADR §Confirmation:
   - Write-side parity test (F-14-001).
   - Round-trip permissive-then-strict client test (F-14-001).
   - Zod allowlist unit test (F-14-003).
   - Arch-test full run (Option B).

### Dependencies

- [[ADR-0204]] (b) — validate-in-place at MCP wire boundary. **Provides the
  structural Option A2**; this ADR's Option D1 reconciles the *content* of
  the schema with the *intent* of the handler so that ADR-0204 (b) enforces
  the right relaxed contract. **Ordering**: ADR-0241 lands first (schema
  relax + handler unchanged), then ADR-0204 (b) wires the wire-validator. If
  ADR-0204 (b) lands first against the current fork schema, strict clients
  start rejecting `memory_store` calls without `namespace` — a behaviour
  regression mid-cycle.
- [[ADR-0224]] — substrate Zod-bypass single-accessor precedent. Same arch-test
  shape (`config-no-raw-parse.arch.test.ts` model), different surface.
- [[ADR-0233]] §CT-H — defect-class origin citing F-14-001 (CRITICAL),
  F-14-002/003/005 (WARN), F-14-009 (NOTE) + pre-flight inversion
  ("relax not tighten").
- [[ADR-0234]] — divergence-marker comment precedent for byte-identical
  upstream sites (F-14-003 case).
- [[ADR-0201]] — pre-flight checklist that cleared this draft (modulo E5's
  correction to check #2 for F-14-003 — applied via this fragment).
- [[ADR-0247]] (CT-N) — adjacent client-side MCP envelope work. **Disjoint**:
  ADR-0247 owns `callMCPTool` client-side `isError` propagation; this ADR owns
  server-side handler-vs-schema reconciliation. No code overlap.

### Validation

- **Source-shape grep**: `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/memory-tools.ts`
  `:193` reads `required: ['key', 'value'],` exactly (matches upstream `:274`).
- **Source-shape grep**: `forks/ruflo/v3/@claude-flow/cli-core/src/mcp-tools/validate-input.ts:248`
  reads the typed allowlist block, NOT `if (issue.code === 'invalid_enum_value') continue;`
  on its own line.
- **Behavioural acceptance (F-14-001)**: in-process MCP `memory_store {key,value}`
  with no `namespace` succeeds and stores at `'default'`; `memory_retrieve
  {key, namespace:'default'}` returns the value. Pre-fix: a strict MCP client
  would have refused the call; post-fix + ADR-0204 (b): call passes wire
  validation and lands at `'default'` deterministically.
- **Behavioural acceptance (F-14-003)**: `validateAgentSpawn({agentType:'<unknown-custom>'})`
  surfaces an `invalid_enum_value` error; `{agentType:'<allowed-custom>'}` does not.
- **Arch-test acceptance (Option B)**: `schema-handler-parity.arch.test.ts`
  passes on all ~600 generated tests. Pre-fix it would FAIL on
  `memory_store × namespace` (handler defaults instead of rejecting).
- **No `skip_accepted`** per `[[feedback-skip-accepted-as-squelch]]`. Schema-vs-
  handler asymmetry is exactly the class the gate exists to catch.
- **Confirmation that the published wrapper picks up the fix**: re-verify via
  fresh install in `/tmp` per `[[feedback-inspect-installed-not-dev-nodemodules]]`,
  NOT against dev `node_modules/`.

### Top risk + mitigation

- **Risk (E2)**: Option D1 means existing strict MCP clients that have been
  *correctly* refusing the unaligned `memory_store` call (because the fork's
  schema lied) will start accepting it silently. The behaviour change is
  invisible — the write succeeds either way; only the namespace landed-at
  changes. A client that previously got a schema-rejection error and then
  worked around it by passing `namespace:'<explicit>'` will continue to work;
  a client that gave up and used a different tool will now silently start
  succeeding. Risk: a consumer's "we don't support `memory_store` because the
  schema rejects our payloads" code path becomes dead code without an explicit
  migration notice.
- **Mitigation**: the property description carries the contract
  (`'Namespace for organization (default: "default")'`). The fix is also
  upstream-aligned, so any consumer that read upstream's spec already expected
  this behaviour. Document in the release-notes commit message that
  `memory_store` no longer requires `namespace`; tag the commit subject with
  `BREAKING: relaxes memory_store inputSchema.required (was fork-only divergence)`
  even though it's a relaxation (some clients may have hard-coded the strict
  shape). Surface via [[reference-fork-workflow]] commit-message conventions.
- **Secondary risk (E4)**: Arch-test wall-clock cost grows linearly with cli
  tool count (~200 today). Mitigation: per-PR CI runs sampled subset; full
  enumeration only in release-pipeline acceptance. ADR's "Sampling is optional"
  line preserved; the registration spec just makes the gate-level
  responsibility explicit.

### Byzantine consensus tally (6 voters, f=1, requiredVotes=3)

| Voter | Vote | One-line position |
|-------|------|-------------------|
| E1 (inputSchema specialist) | adopt | Schema relax matches upstream; closes asymmetry by construction once [[ADR-0204]] (b) lands. |
| E2 (handler-validation specialist) | adopt | Handler stays unchanged (no risk of breaking existing call sites); the write/read partitioning bug closes from the schema side. |
| E3 (type-deduplication specialist) | adopt | Deferring `MCPTool`/`MemoryType`/`AgentType` consolidation is correct — upstream merge-tax asymmetric to bounded internal benefit. |
| E4 (Zod-arch-test specialist) | adopt-with-amendment | Arch-test enumeration vs sampling needs explicit gate registration; otherwise adopt as drafted. |
| E5 (upstream-coherence tracker) | adopt-with-amendment | Pre-flight #2 mis-states F-14-003's upstream status; needs INTEGRATION-LEDGER + divergence marker per [[ADR-0234]] precedent. |
| DA (devil's advocate) | hold-principled-dissent | "Relaxing the schema validates ad-hoc client behaviour — write-strict / read-lax would be cleaner" AND "23 MCPTool definitions is the wrong target — let upstream factoring win, defer dedupe entirely." Both challenges addressed by the verdict (write-strict rejected because upstream-aligned is cheaper merge-cost; dedupe IS deferred per Option C rejection). DA accepts majority verdict; principled dissent recorded. |

**Result**: 5/6 adopt (3/6 supermajority cleared, Byzantine `2f+1=3` satisfied).
**DA position**: principled dissent held + recorded; no withdrawal.

### Key upstream finding (verification per assignment)

- **CONFIRMED** (E5): "the fork created the asymmetry" claim from
  [[ADR-0233]] §"Pre-flight inversions" is correct for F-14-001. Direct read
  of `/Users/henrik/source/ruvnet/ruflo/v3/@claude-flow/cli/src/mcp-tools/memory-tools.ts:274`
  on 2026-05-24 confirms upstream's `memory_store` schema declares
  `required: ['key', 'value']` (no namespace) and handler `:281` does
  `(input.namespace as string) || 'default'` — coherent permissive shape.
  The fork's divergence at fork-`:193` (`required: ['key','value','namespace']`)
  + read-side throw at fork-`:378`/`:724` created the asymmetry.
  Decision to flip "tighten handler" → "relax schema" is the correct
  upstream-convergent move.
- **REFUTED** (E5, scope-correction): ADR-0241 pre-flight #2 sub-bullet 3
  labels the F-14-003 swallow as "fork-only by comment archeology". Direct
  read of `/Users/henrik/source/ruvnet/ruflo/v3/@claude-flow/cli-core/src/mcp-tools/validate-input.ts:248`
  shows the swallow is **byte-identical with the fork**. The
  fork's `cli/src/mcp-tools/validate-input.ts` is a 10-line re-export shim
  per its own header. The F-14-003 typed-allowlist replacement therefore
  carries upstream merge-tax that the ADR's pre-flight underweights.
  Amendment 1 above corrects this.

### Cross-references

- [[ADR-0233]] §CT-H + §"Pre-flight inversions" — defect-class origin and
  the "relax not tighten" inversion this swarm ratified.
- [[ADR-0201]] §"Remediation-ADR pre-flight checklist" — ran with E5's
  correction applied for F-14-003.
- [[ADR-0204]] (b) — provides Option A2 structural fix at the wire boundary;
  this ADR's Option D1 provides the content fix the wire-validator enforces.
- [[ADR-0224]] — same-shape arch-test guard precedent (`config-no-raw-parse.arch.test.ts`).
- [[ADR-0234]] — divergence-marker comment precedent for byte-identical
  upstream sites (applied to F-14-003 fix here).
- [[ADR-0247]] (CT-N, parallel review) — disjoint by artifact + mechanism;
  no overlap in code or scope per ADR-0247's own §F-04-009 analysis.
- `[[feedback-update-integration-ledger]]` — INTEGRATION-LEDGER rows mandatory
  for both fixes (F-14-001 convergence-with-upstream; F-14-003 superseded-by-local).
- `[[feedback-commit-forks-before-release]]` — both fork edits commit BEFORE
  the next `npm run release`.
- `[[feedback-skip-accepted-as-squelch]]` — Option B arch-test gate cannot
  use `skip_accepted`.
- `[[feedback-inspect-installed-not-dev-nodemodules]]` — post-release verification
  uses fresh `/tmp` install, NOT dev `node_modules/`.

---

## ADR-0237 — CT-D: surface out-of-range numeric config

**Status**: proposed (post-swarm-review)
**Swarm**: 4 experts + devil's advocate, Quorum-majority consensus
**Triage rank**: 12 (per [[ADR-0233]] §Decision triage order)

### Decision (post-swarm-review)

Apply **Option A + same-wave Option C lint rider** as originally drafted, with five
scoping/clarification amendments surfaced by the panel: (i) error-message format follows the
[[ADR-0095]] amendment precedent — `JsValue::from_str` payload includes setter name, offending
value, valid range, and `ADR-0237` reference; (ii) Option C lint re-enable is **per-crate**
(`ruvllm-wasm/Cargo.toml:122` only), not workspace-wide — re-enabling `manual_clamp`
workspace-wide may surface ~50+ existing violations across other crates out of CT-D scope;
(iii) the lint catches `x.max(N).min(M)` but does NOT guard ceiling-only `x.min(M)` or other
silent-rewrite shapes — per-site fix is load-bearing, lint is belt-and-braces; (iv)
INTEGRATION-LEDGER row cites per-line scope (`:131, :143, :155, :179` — the four newly-diverged
setters; `:167` is wave-A9's prior divergence); (v) each `Err` return carries a divergence-marker
comment `// ADR-0237: fork diverges from upstream silent clamp` matching the [[ADR-0234]]
per-site disposition pattern. DA withdraws on the NaN-propagation challenge (current code IS
the silent-NaN path; fix CLOSES it) but holds principled dissent on universalizing wave A9's
ceiling-only precedent to four range-bounded setters (does NOT block).

### Implementation steps

1. **Sites 1-4 (Rust) fork-side fix** in `forks/ruvector/crates/ruvllm-wasm/src/sona_instant.rs`:
   - `:131` `set_micro_lora_rank`: change signature to `pub fn set_micro_lora_rank(&mut self, value: usize) -> Result<(), JsValue>`; reject `value < 1 || value > 4` with `JsValue::from_str("set_micro_lora_rank: value {value} out of range [1, 4] (ADR-0237)")`. Add divergence-marker comment.
   - `:143` `set_learning_rate`: change to `Result<(), JsValue>`; reject `value < 0.0 || value > 1.0 || !value.is_finite()` with formatted error; divergence-marker comment.
   - `:155` `set_ema_decay`: same shape as `:143`.
   - `:179` `set_ewc_lambda`: same shape as `:143`.
   Commit per `[[feedback-commit-forks-before-release]]`.
2. **Site 5 (JS) fork-side fix** in `forks/ruflo/v3/@claude-flow/cli/src/ruvector/ruvllm-wasm.ts`:
   At `createHnswRouter` (line 150-198), validate `config.maxPatterns <= HNSW_MAX_SAFE_PATTERNS`
   at construction time; throw with `"WASM HNSW maximum is ${HNSW_MAX_SAFE_PATTERNS}, requested ${config.maxPatterns} (ADR-0237)"` if exceeded. Remove the mid-ingest `count >=
   HNSW_MAX_SAFE_PATTERNS` throw at `:169-173` (the construction-time check obviates it; the
   counter logic can stay for `addPattern` boolean return). Commit separately from the Rust
   fix; the JS-side fix is fork-only and does not need a wasm rebuild.
3. **Option C follow-up commit (same wave)**: remove `manual_clamp = "allow"` from
   `forks/ruvector/crates/ruvllm-wasm/Cargo.toml:122` (per-crate, not workspace-wide). Verify
   `cargo clippy --all-targets -- -D warnings` passes on `ruvllm-wasm` with the lint
   re-enabled. Commit per `[[feedback-commit-forks-before-release]]`.
4. **INTEGRATION-LEDGER row** for sites 1-4: `superseded-by-local` disposition citing this
   ADR; upstream `ruvnet/RuVector/crates/ruvllm-wasm/src/sona_instant.rs:131, :143, :155, :179`
   carries the byte-identical silent clamps, so this is fork-only merge-tax until upstream
   takes a matching patch. The wave-A9 prior divergence at `:167` is already recorded; this row
   extends it to the four siblings. Record per `[[feedback-update-integration-ledger]]`.
5. **Site 5 INTEGRATION-LEDGER row**: fork-only fix (the `ruvllm-wasm.ts` file is fork-original
   per [[ADR-0234]] CT-A check 2; no upstream counterpart). No merge tax.
6. **Acceptance check** invoked via `_run_and_kill` (registered in both `run_check_bg` and
   `collect_parallel` per `[[reference-acceptance-runcheck-vs-collect]]`): instantiate
   `SonaConfigWasm` via WASM bindings, call `set_learning_rate(2.0)` — expect a JS throw with
   `"ADR-0237"` substring; call `set_learning_rate(NaN)` — expect throw; call
   `set_micro_lora_rank(0)` and `set_micro_lora_rank(5)` — both expect throws; call
   `createHnswRouter({ maxPatterns: HNSW_MAX_SAFE_PATTERNS + 1 })` — expect throw at
   construction (not mid-ingest); call `set_pattern_capacity(5)` — expect SUCCESS (wave A9
   precedent, no lower clamp). The wasm-bindgen `Result<(), JsValue>` surface produces JS
   throws that the test catches with `expect(() => ...).toThrow(/ADR-0237/)`.
7. **Rust unit tests** in `crates/ruvllm-wasm/src/sona_instant.rs#[cfg(test)] mod tests`: add
   `test_set_micro_lora_rank_rejects_out_of_range`, `test_set_learning_rate_rejects_negative`,
   `test_set_learning_rate_rejects_above_one`, `test_set_learning_rate_rejects_nan`,
   `test_set_ema_decay_rejects_nan`, `test_set_ewc_lambda_rejects_out_of_range` — each asserts
   `Err` for the out-of-range case. Matches the wave-A9 precedent of un-ignoring
   `test_pattern_buffer_overflow` to capture the bug it fixed.

### Dependencies

- [[ADR-0231]] wave A9 — the `set_pattern_capacity` precedent in the same file; same defect
  class, same fix shape (honor user input; keep documented ceilings). This ADR's
  implementation extends the wave-A9 disposition to four sibling setters in the same file.
- [[ADR-0095]] amendment 2026-05-23 — corpus-level precedent for rejecting escape-hatch
  options (the "dont do this: `RUFLO_ALLOW_PURE_TS_FALLBACK`. Just fail loud" disposition
  applies analogously to Option B's `console::warn_1` log-only path, correctly rejected here).
- [[ADR-0234]] (CT-A) — sibling theme also using the per-site disposition + divergence comment
  + INTEGRATION-LEDGER row shape for "fork now N ahead of upstream". This ADR is the
  Rust-WASM-seam counterpart to [[ADR-0234]]'s TS-loader-seam fixes.
- [[ADR-0233]] §CT-D — defect-class origin citing F-06-003 (WARNING, 4 setters) and F-06-004
  (WARNING, HNSW cap). This ADR IS the CT-D remediation.
- [[ADR-0201]] — Remediation-ADR pre-flight checklist that cleared this draft (all four
  checks pass: signal-reaches-audience for the wasm-bindgen setters via the public
  `@ruvector/ruvllm-wasm` artefact AND for the HNSW JS-side cap via `createHnswRouter`
  callers; upstream-neutral-by-omission on the 4 setters; premise true at runtime per direct
  file:line citations; no sibling-ADR overlap with 0234-0236, 0238-0248).

### Validation

- Source-shape grep: `forks/ruvector/crates/ruvllm-wasm/src/sona_instant.rs` —
  `grep -c 'value\.max([0-9.]*).min([0-9.]*)' sona_instant.rs` returns **zero** matches
  (the four silent-clamp sites are gone; `set_pattern_capacity:167` already has
  `value.min(1000)` per wave A9 and matches a stricter pattern).
- Source-shape grep: `forks/ruflo/v3/@claude-flow/cli/src/ruvector/ruvllm-wasm.ts` —
  `createHnswRouter` body contains the construction-time `maxPatterns` validation throw;
  `count >= HNSW_MAX_SAFE_PATTERNS` mid-ingest throw is removed (or downgraded to a
  belt-and-braces assertion if the WASM index can grow under the user's nose).
- Source-shape grep: `forks/ruvector/crates/ruvllm-wasm/Cargo.toml` — line 122 no longer
  contains `manual_clamp = "allow"`; `cargo clippy --all-targets -- -D warnings` passes on
  `ruvllm-wasm` crate.
- Rust unit-test pass: `cargo test -p ruvllm-wasm sona_instant::tests::test_set_` shows the
  6 new tests passing.
- Behavioural acceptance: the `_run_and_kill`-registered check in implementation step 6
  exercises all 5 sites end-to-end via JS bindings; failures throw with `ADR-0237` substring.
- No `skip_accepted` per `[[feedback-skip-accepted-as-squelch]]`.

### Top risk + mitigation

- **Risk**: wasm-bindgen-visible API break for external consumers of `@ruvector/ruvllm-wasm`
  who are calling the setters from JS — `sonaConfig.learningRate = 1.5` will THROW instead of
  silently coercing to `1.0`. The fork's own code currently constructs `SonaConfigWasm` only
  via its constructor (the audit verified no fork code calls the setters by name), so the
  blast radius is external-consumer-only. But the WASM artefact is published as
  `@sparkleideas/ruvector-ruvllm-wasm` and any downstream consumer pinning the published
  artefact will see the breaking change on update.
- **Mitigation**: the wave-A9 commit message convention (`fix(ruvllm-wasm): honor user
  pattern_capacity, drop silent .max(10) clamp`) sets the precedent for the changelog framing
  — "honor user input; previously-silent rewrites now throw at the boundary". The version bump
  on the `@ruvector/ruvllm-wasm` artefact should be a **minor** under semver (new throws on
  inputs previously coerced — surface change but not a deletion); the ADR-0237 reference in
  every error message gives downstream consumers a trace path to understand the disposition.
  Belt-and-braces: the per-crate Option C lint re-enable prevents new sites from accreting
  in `ruvllm-wasm`; the cross-cutting [[ADR-0233]] observation #4 (the broader `[lints]`
  audit) is correctly scoped out — a future ADR may take that on if the fork's lint posture
  is reviewed.

### Cross-bonus / related work

- **F-06-008 partial closure** (cross-cutting): the audit's NOTE F-06-008 (`hnsw_router.rs`
  unwrap()s NaN panic in graph-traversal hot path) is **partially mitigated** by this ADR's
  `f32::is_finite()` guard on the three `f32` setters — NaN at the config-setter boundary
  is rejected before it can propagate into HNSW route/insert paths. The graph-traversal
  `unwrap()`s still need their own fix (per the audit's singleton disposition
  `fix-in-place — pre-validate f32::is_finite() at WASM boundary`), but this ADR closes one
  of the tributaries.
- **F-06-003 + F-06-004 closure**: this ADR's 5 sites cover both audit findings completely.
- **Option C ([[ADR-0233]] cross-cutting observation #4)**: the per-crate `manual_clamp`
  re-enable here is a **narrow** disposition of the broader "150+ lints disabled in
  ruvllm-wasm" observation. The broader audit is correctly scoped out; if undertaken, a
  future ADR would walk the workspace's `[lints]` configs and decide per-lint whether the
  "research-tier crate, doc/style churn deferred" comment still applies.

---

## ADR-0247 — CT-N: security follow-ups (isError envelope + framing + detector deferrals)

**Status**: proposed (post-swarm-review)
**Swarm**: 5 experts + devil's advocate, Quorum-majority consensus (≥3/5 for adoption)
**Triage rank**: 13 per [[ADR-0233]] §Decision

### Decision (post-swarm-review)

Adopt **Option D as drafted** — own F-04-009 (client-side `callMCPTool` honors `isError`),
F-04-010 (HNSW framing ride-along on [[ADR-0238]] Surface 1's docblock rewrite), and
F-04-011 (5-minute backoff for `installAttempted`); **defer F-04-006 and F-04-007** with
the explicit upstream-not-wired + same-architectural-prerequisite-as-Surface-2 rationale
already recorded in the ADR. Quorum carried 4/5 for own-three-defer-two (E1, E3, E4, E5
adopt; E2 amends-but-votes-adopt; DA holds principled dissent on the F-04-006/007 defer).
Two clarifying improvements adopted from the panel: (i) the Confirmation gate for site #1
must include a positive grep showing the `MCPClientError` `cause` chain carries the
synthetic `isError`-envelope text so downstream consumers can distinguish it from a
real-error throw; (ii) the Site #2 ride-along must add a small literal-text assertion to
[[ADR-0238]] Surface 1's Confirmation gate so the HNSW-scope clarification doesn't silently
get omitted when the docblock is rewritten.

### Implementation steps

1. **Site #1 (F-04-009) fork-only fix** in
   `forks/ruflo/v3/@claude-flow/cli/src/mcp-client.ts:178-179`. Replace
   `const result = await tool.handler(input, context); return result as T;` with an
   inspection block: if the awaited result is an object with `isError === true`, throw a
   new `MCPClientError(\`Tool '\${toolName}' returned isError envelope\`, toolName, cause)`
   where `cause` is a synthesised `Error` carrying the extracted `content[].text` body so
   downstream `.cause.message` introspection works. Existing thrown-exception branch at
   `:180-187` unchanged. Add an `isMCPErrorEnvelope(x: unknown): x is { isError: true; content?: unknown[] }`
   type-narrow helper above `callMCPTool` (keeps the inspection terse + grep-anchorable
   for future audits). Commit per `[[feedback-commit-forks-before-release]]`.
2. **Site #1 behaviour test** at `forks/ruflo/v3/@claude-flow/cli/__tests__/mcp-client-iserror.test.ts`:
   register a mock MCP tool returning `{ isError: true, content: [{ type:'text', text: JSON.stringify({error:'simulated'}) }] }`;
   assert `await callMCPTool('mock')` throws `MCPClientError` and `(err as MCPClientError).cause?.message`
   contains `'simulated'`. Negative test: same mock returning `{ isError: false, content: [...] }`
   resolves normally. Third test asserts six aidefence handlers in `security-tools.ts` —
   when stubbed to throw inside the handler — all surface as `MCPClientError` thrown out of
   `callMCPTool` (no behavioural regression for the existing throw path).
3. **Site #2 (F-04-010) ride-along** with [[ADR-0238]] Surface 1's docblock rewrite at
   `forks/ruflo/v3/@claude-flow/aidefence/src/index.ts:1-30`. The rewrite per ADR-0238
   must additionally clarify line 8's HNSW claim: explicit sentence scoped to
   `searchSimilarThreats` (e.g. "HNSW-indexed search of previously LEARNED threat
   patterns via `searchSimilarThreats`; detection latency is a fixed regex pass over 50
   patterns, not HNSW-accelerated"). If [[ADR-0238]] Surface 1 lands first, file a one-
   line addendum to that ADR's implementation commit referencing F-04-010. If THIS ADR
   lands first, [[ADR-0238]] Surface 1's confirmation gate inherits the additional
   literal-text assertion (see Validation below). Commit per
   `[[feedback-commit-forks-before-release]]`.
4. **Site #3 (F-04-011) fork-only backoff** in
   `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/security-tools.ts:28,74,77,120-127`.
   Rename `installAttempted: boolean` → `installAttemptedAt: number | null` at `:28`.
   Change the gate at `:74` from `if (installAttempted)` to
   `if (installAttemptedAt && Date.now() - installAttemptedAt < 5 * 60 * 1000)`. Change
   the set at `:77` from `installAttempted = true;` to `installAttemptedAt = Date.now();`.
   Update the error message at `:120-127` to mention "auto-retry available in N minutes"
   alongside the existing three recovery paths. Behaviour test at
   `forks/ruflo/v3/@claude-flow/cli/__tests__/security-tools-backoff.test.ts` simulates
   an install-fail, asserts a second call within 5 minutes throws the cached error (no
   re-install attempted via spy on `autoInstallPackage`), and a third call with mocked
   `Date.now()` past the window re-enters the install path. Commit per
   `[[feedback-commit-forks-before-release]]`.
5. **F-04-006/F-04-007 deferral tracking**: no code change. The deferral rationale is
   recorded in this ADR's More Information section; future product-bet ADRs (one per
   finding) that pick either up must reference this ADR's deferral text and the
   pre-flight check-2 failure. The audit slice 04 file remains authoritative; both
   findings stay open in the audit-tracker, NOT moved to "won't fix".
6. **INTEGRATION-LEDGER rows** per `[[feedback-update-integration-ledger]]` for sites
   #1, #2 (ride-along — joint row with the [[ADR-0238]] Surface 1 row), and #3. Each
   row: disposition `superseded-by-local`, citing upstream byte-identical source at the
   verified paths (per Upstream Intent below).

### Dependencies

- [[ADR-0238]] (CT-E parent — Surface 1 docblock rewrite) — gates site #2 ride-along.
  The rewrite must extend to clarify line 8's HNSW perf claim per F-04-010; if
  [[ADR-0238]] lands first, file a one-line addendum to its implementation commit; if
  this ADR lands first, [[ADR-0238]] Surface 1's confirmation gate inherits the
  HNSW-scope literal-text assertion.
- [[ADR-0242]] (CT-I sibling — shared error library + server-side MCP envelope honesty)
  — disjoint by artifact (handlers vs `callMCPTool`) and mechanism (throw-vs-return-rule
  vs honor-isError-rule). Site #1 here is the **client-side complement** to ADR-0242's
  server-side rule and is intentionally NOT folded in (DA hook on this resolved 4/5).
- [[ADR-0210]] (stub-honesty envelope mandate) — site #2's HNSW-scope clarification
  inherits ADR-0210's framing-honesty principle (operator over-trust is the harm to fix).
- [[ADR-0233]] §CT-N — defect-class origin citing F-04-006 (HIGH), F-04-007 (HIGH),
  F-04-009 (WARN), F-04-010 (WARN), F-04-011 (NOTE) per slice-04 audit.
- [[ADR-0201]] §Remediation-ADR pre-flight checklist — cleared per-finding (sites
  #1/#2/#3 pass all four checks; #4/#5 fail check 2 and #5 fails check 4, hence the
  deferral).
- F-04-004 (caller-supplied identity in issue-claim handlers) — explicitly out of CT-N
  scope per matrix; bound to ADR-101 federated-claims direction.

### Validation

- **Site #1 source-shape grep**:
  `grep -n "return result as T" forks/ruflo/v3/@claude-flow/cli/src/mcp-client.ts`
  returns zero hits (the unconditional pass-through is gone).
  Positive grep: the `MCPClientError` constructor at the new throw site carries a
  `cause` argument (so the synthetic envelope-text is preserved for downstream
  introspection — addresses Improvement 1 below).
- **Site #1 behavioural acceptance**: behaviour test (step 2) passes; runs in the
  acceptance-tier suite registered via `_run_and_kill` per
  `[[reference-acceptance-runcheck-vs-collect]]`.
- **Site #2 source-shape grep** (joint with [[ADR-0238]] Surface 1):
  `grep -n "HNSW" forks/ruflo/v3/@claude-flow/aidefence/src/index.ts` returns at least
  one line containing the literal substring `searchSimilarThreats` (proves the scope
  clarification landed, not just a generic edit). Belt-and-braces literal-text gate
  per Improvement 2 below.
- **Site #3 source-shape grep**:
  `grep -n "installAttempted" forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/security-tools.ts`
  shows only `installAttemptedAt` (the `boolean` variant gone). Behaviour test (step 4)
  asserts the 5-minute window + re-entry.
- **Deferral-tracking gate** (no code): the slice-04 audit at
  `docs/audits/2026-05-24-second-pass-audit/04-security-aidefence-claims-pii.md` still
  carries F-04-006 + F-04-007; no entry in any "closed" / "won't fix" register; this
  ADR's More Information section is the public deferral pointer.
- No `skip_accepted` per `[[feedback-skip-accepted-as-squelch]]` — the three fixed
  sites have real tests, not skip rationales.

### Top risk + mitigation

- **Risk**: Site #1's behaviour change (from "returns `{isError:true}` envelope" to
  "throws `MCPClientError`") will silently affect any caller in the codebase that today
  destructures `{ safe } = await callMCPTool('aidefence_is_safe', ...)` and treats
  `undefined` as falsy. Per the audit, the two existing smoke scripts
  (`plugins/ruflo-{aidefence,browser}/scripts/smoke.sh`) only check tool registration —
  they will keep passing. But a hidden non-test caller could silently flip from
  fail-open-by-convention to throw, and a `try { ... } catch {}` wrapper around the
  call would re-introduce fail-open. Same "consumer-side discipline" trap that ADR-0242
  is fighting on the server side.
- **Mitigation**: (a) the behaviour test (step 2) covers the structural change; (b) the
  implementation commit message must explicitly flag the behaviour change with the
  literal substring "BEHAVIOUR CHANGE — callMCPTool now throws on `isError:true`" so
  the merge log carries it; (c) for the immediate landing, do a one-shot grep across
  fork callers: `grep -rn "callMCPTool" forks/ruflo/v3/` to enumerate every consumer;
  audit each for swallowing `try/catch` patterns and surface findings in the commit
  message. If any caller silently catches and discards, that's a follow-up F-13-style
  finding tracked separately (don't bundle into this ADR's scope to avoid creep).

---

### Panel composition (per plan §Per-ADR swarm configuration)

- Expert 1 — PII detection coverage specialist (F-04-006 detector mismatch)
- Expert 2 — AIDefence learning-poisoning specialist (F-04-007 unauthenticated negative feedback)
- Expert 3 — MCP isError envelope specialist (F-04-009 `callMCPTool` should honor `isError:true`)
- Expert 4 — Caller-identity specialist (excluded F-04-004 routes to ADR-101; CT-N scope only)
- Expert 5 — Upstream-not-wired tracker (F-04-006/007 deferral rationale)
- Devil's Advocate

### Upstream intent

Upstream is **byte-identical across all three fix sites and both deferred sites**, with
no decision recorded either direction. Verified at fork mirrors on 2026-05-24:

* `/Users/henrik/source/ruvnet/ruflo/v3/@claude-flow/cli/src/mcp-client.ts:173-200` —
  `callMCPTool` carries the same `const result = await tool.handler(input, context); return result as T;`
  shape at line 190-191, with the same try/catch around it. **No `isError` inspection
  upstream either**: the fork-only fix opens divergence in exactly one file. Site #1
  pre-flight check 2 clears: upstream has not decided either way.
* `/Users/henrik/source/ruvnet/ruflo/v3/@claude-flow/cli/src/mcp-server.ts:512-519` —
  the transport wrap also branches only on try/catch (`trackRequest(toolName, true)`
  on resolve, `trackRequest(toolName, false)` on catch) and does NOT detect
  `isError:true` in the resolved envelope. This **confirms** the ADR-0247 disjointness
  claim with [[ADR-0242]]: the server-side wrap is not the right seam (a returned
  envelope still records as success); the client-side `callMCPTool` is. ADR-0247's
  Option C rejection ("fold into ADR-0242") is correct: the two ADRs operate at
  different seams that don't overlap.
* `/Users/henrik/source/ruvnet/ruflo/v3/@claude-flow/aidefence/src/index.ts:1-30` —
  byte-identical to fork; line 8 carries the same `"HNSW-indexed threat pattern search
  (150x-12,500x faster with AgentDB)"` claim. F-04-010 fix rides on [[ADR-0238]]
  Surface 1's divergence already.
* `/Users/henrik/source/ruvnet/ruflo/v3/@claude-flow/cli/src/mcp-tools/security-tools.ts:27-28,74-77,120-127`
  — byte-identical `let installAttempted = false;` + `if (installAttempted)` gate +
  permanent-cache shape upstream. F-04-011 fix opens small divergence in one file.
* `/Users/henrik/source/ruvnet/ruflo/v3/@claude-flow/aidefence/src/domain/services/threat-detection-service.ts:232-263`
  carries the **identical 6-pattern PII regex set** (email, dashed-SSN, credit_card,
  `sk-/sk-ant-` api_key, GitHub PAT, `password=...`) — verified line-for-line.
* `/Users/henrik/source/ruvnet/ruflo/v3/@claude-flow/cli/src/transfer/anonymization/index.ts:17-26`
  carries the **identical 8-pattern PII regex set** (email, phone, ipv4, ipv6, narrower
  `sk-|pk-|api[_-]?key[_-]?` apiKey, jwt, homePath, windowsPath) — verified line-for-line.
  **Upstream operates two disjoint PII detector sets in two packages and has NOT
  consolidated them.** F-04-006 deferral rationale (upstream-not-wired) is solid.
* `/Users/henrik/source/ruvnet/ruflo/v3/@claude-flow/cli/src/mcp-tools/security-tools.ts:355-444`
  — the `aidefence_learn` handler is **byte-identical** to fork: `required: ['input', 'wasAccurate']`,
  no auth, no rate-limit, no caller-identity check. **Upstream has NOT authenticated
  `aidefence_learn` either.** F-04-007 deferral rationale (upstream-not-wired AND
  architectural overlap with ADR-0238 Surface 2's deferred `caller_identity` plumbing)
  is solid.

**Key upstream finding (highlight)**: the transport-side wrap `mcp-server.ts:512-519`
demonstrably does NOT detect `isError:true` even upstream — confirming that ADR-0247's
F-04-009 client-side fix is the structurally-correct seam, not a server-side wrap
extension that ADR-0242 might (incorrectly) be expected to deliver. The two ADRs target
disjoint protocol seams and both are needed; folding F-04-009 into ADR-0242 would
miss the actual location of the defect.

### ADR-180+ alignment

* **[[ADR-0238]] (CT-E parent)** — direct sibling. Surface 1 (F-04-001 + F-04-005 +
  F-04-008) owns the docblock-rewrite that F-04-010 rides on; Surface 2 (F-04-003)
  deferred `caller_identity` plumbing for claims RBAC central-dispatch, which is the
  same architectural prerequisite F-04-007 fails check 4 on. **Direct alignment**: the
  deferral rationale for F-04-006/F-04-007 here matches Surface 1/2's calculus
  (upstream-not-wired + fork-only fix = perpetual merge tax for a security boundary
  upstream chose not to enforce). No double-jeopardy: F-04-006/F-04-007 are NAMED in
  ADR-0238's "Out of scope" block, NOT silently dropped.
* **[[ADR-0242]] (CT-I sibling — shared error library + MCP envelope honesty)** —
  disjoint by artifact and mechanism (confirmed by upstream-intent analysis above).
  ADR-0242 owns the **handler-side rule** ("MCP handlers must let fatals throw, not
  catch and return `{success:false}`"); this ADR owns the **client-side helper-rule**
  (`callMCPTool` must honor `isError:true` envelopes that handlers honestly emit).
  ADR-0242's arch-test target ("MCP handler fatals throw, not return-envelope") would
  NOT catch the F-04-009 defect (aidefence handlers already throw via the wrap; they
  set `isError:true` honestly on caught internal errors); ADR-0247's `callMCPTool`
  inspection rule would NOT catch the ~56 handlers that catch-and-return ADR-0242
  targets. Both rules are needed. **No fold.**
* **[[ADR-0210]] (stub-honesty envelope mandate)** — site #2's HNSW-scope clarification
  is a direct application of ADR-0210's framing-honesty principle (the "operator
  over-trust" pattern). No conflict; this ADR ride-alongs on [[ADR-0238]] Surface 1's
  ADR-0210-compliant docblock rewrite.
* **[[ADR-0233]] §CT-N** — this ADR is the proposed second-pass remediation track for
  the five CT-N findings; matches the matrix recommendation Option B-extended (own
  some, defer others) verbatim.
* **[[ADR-0201]] §Remediation-ADR pre-flight checklist** — the ADR carries the
  per-finding checklist application in §Pre-flight verification (one of the most
  thorough pre-flight sections of any CT-* ADR per the panel). The four-check pattern
  flipped 0207/0208/0209/0210 on the first-pass remediation work; here it provides
  the explicit reasoning that distinguishes "fix this" (sites #1/#2/#3 pass all 4 checks)
  from "defer this" (sites #4/#5 fail check 2 and #5 fails check 4).

### Critique outcomes

| Expert | Critique | Vote | Adopted? |
|---|---|---|---|
| E1 (PII coverage) | The F-04-006 deferral is structurally correct (upstream-not-wired + fork-only fix = merge tax for a security boundary upstream chose not to centralize), but the deferred state leaves a documented gap that operators reading `aidefence_has_pii` / `transfer_detect-pii` descriptions may still over-trust. The deferral text in the ADR's More Information section is honest but downstream operator-facing prose (the [[ADR-0238]] Surface 1 docblock rewrite) should also extend to the `aidefence_has_pii` tool description (not just the package docblock). | amend | **NOT ADOPTED (out of scope)** — the deferred-finding text already says exactly this in Consequences §Negative ("F-04-006 deferral leaves PII coverage gaps documented but unfixed... ADR-0238 Surface 1's docblock rewrite reframes aidefence as a 'manual scan utility'; this ADR documents the gap so future ADR-0238-style framing-honesty work can extend to the `aidefence_has_pii` description"). The "extend Surface 1 to the per-tool description" is a separate scope decision that [[ADR-0238]] (not this ADR) owns; bundling it would re-open Surface 1's already-converged scope. E1 votes **adopt** the ADR; the critique is filed as forward-pointer for [[ADR-0238]] re-amendment if its docblock rewrite ever touches the per-tool description layer. |
| E2 (learning-poisoning) | The F-04-007 deferral correctly identifies the `caller_identity` plumbing prerequisite, but defers without proposing ANY interim mitigation. Today an MCP caller can pollute `searchSimilarThreats` rankings + `getBestMitigation` selection (per audit) and the only mitigation cited is "operators are told the surface is opt-in / manual scan utility". That's framing, not a mitigation. The ADR should at minimum propose a per-process rate-limit on `aidefence_learn` (e.g., 100 calls per minute) that doesn't require `caller_identity` plumbing — that's a small fork-only fix in one file, structurally similar to the F-04-011 backoff fix this ADR adopts. | amend | **NOT ADOPTED (scope-aligned defer)** — E2's critique has merit but adds a fourth fix-site to an ADR explicitly scoped as "own three, defer two". The per-process rate-limit IS a small fix, but it (a) doesn't address the audit's specified threat shape (which is "an adversarial caller systematically poisons rankings" — a low-volume sustained attack, not a high-volume burst), (b) creates a false sense of mitigation that may delay the real `caller_identity` work, (c) re-opens this ADR's structural decision (Option D, which the matrix endorsed). E2's critique is **logged in the Risk section** as a possible follow-up if the `caller_identity` work fails to materialize within a reasonable horizon, but not folded into this ADR. E2 votes **adopt** the ADR. |
| E3 (isError envelope) | The site #1 fix description says "throw `new MCPClientError(...)` (same `MCPClientError` constructor used for thrown exceptions at lines 182-186)". But the existing constructor at `:194-198` takes `(message, toolName, cause?: Error)`. The synthetic throw on `isError:true` won't have a real `cause: Error` — it's a serialised envelope. The fix needs to either (a) pass `undefined` and lose the structured trace, or (b) synthesise an `Error` from the extracted envelope text so downstream consumers can do `(err as MCPClientError).cause?.message` introspection. The ADR is silent on which. | amend | **ADOPTED** — option (b) wins (synthesise an `Error` from the extracted `content[].text` body, pass as `cause`). Captured in Implementation Step 1 + Validation Step 1 (positive grep for `cause` argument at the new throw site). Improvement 1 below. |
| E4 (caller-identity) | The "explicitly excluded F-04-004" framing is correct (CT-N scope = the five remaining findings; F-04-004 routes to ADR-101). The Pre-flight §F-04-007 explanation re-derives the `caller_identity` plumbing prerequisite from first principles, but doesn't say explicitly that F-04-007 + F-04-003 (Surface 2) + F-04-004 ALL wait on the same architectural decision — leaving the impression that each is independent. The Out-of-scope items section names them separately, but doesn't bind them. | amend | **NOT ADOPTED (scope-aligned defer)** — E4's critique is correct, but binding three findings into one prerequisite chain would expand this ADR's "More information" section by ~1 paragraph that effectively re-states [[ADR-0238]] Surface 2's calculus. The deferred-row "deferred to `caller_identity` direction (joint with F-04-003 / F-04-004 / ADR-101)" already does this binding in the table at line 124 of the ADR. Sufficient. E4 votes **adopt**. |
| E5 (upstream-not-wired) | The Option D rationale is structurally sound, but the pre-flight check 2 analysis for F-04-006 leans on "upstream chose not to centralize" as the deferral pivot. Verified at upstream: the two PII detectors ARE byte-identically present in two packages with disjoint pattern sets, AND upstream has had this state for at least 3 release cycles per the corpus rule [[feedback-corpus-evidence-before-feature-work]]. The deferral is correct AND the rationale should explicitly cite the "we've watched upstream for ≥3 cycles and the disjoint-detector state is stable" evidence to pre-empt a future "but maybe upstream is about to consolidate" debate. | amend | **NOT ADOPTED (already implicit)** — E5's evidence is captured in the More Information section's framing ("upstream has NOT unified them; consolidating to a single package is a fork-only refactor"). Adding the "≥3 release cycles" assertion would require timestamping every upstream observation and creates a maintenance burden (when do we re-check? what counts as a cycle?). E5 votes **adopt** the ADR; the "stable state" framing is already structurally present. |
| DA | **Challenge 1**: "F-04-006/007 deferred = forever-deferred; force the issue this cycle." The deferral rationale is internally coherent but every deferred-with-rationale ADR in the corpus carries the same shape, and these accumulate. F-04-007 in particular is a HIGH-severity unauthenticated-poisoning vector; the ADR's mitigation is "the package is opt-in" — that's not a mitigation, it's a documentation note. At minimum, demand the per-process rate-limit (E2's amendment) be folded in, OR commit to a hard timebox: F-04-007 must be addressed in next release cycle (X+1) regardless of whether `caller_identity` plumbing exists. Otherwise this is the slow drift the [[feedback-skip-accepted-as-squelch]] memory warned against. | challenge | **HOLD (principled dissent)** — Quorum: 4/5 votes to defer F-04-007 per ADR's stated rationale. The DA's framing is acknowledged: the deferral pattern IS a slow drift, and "track openly via audit slice" is structurally weaker than a hard timebox. **Counter**: the audit slice 04 file is durable evidence that F-04-007 is NOT closed; any future cycle's CT-* triage will re-encounter it and the deferral rationale will be re-evaluated against then-current upstream state. Building the rate-limit fix on top of an opt-in surface that may never be wired is itself a slow-drift pattern in the opposite direction (security theatre that delays the real `caller_identity` work). DA's principled dissent is **recorded** but does NOT block the Decision. |
| DA | **Challenge 2**: "Folding F-04-009 into [[ADR-0242]] (CT-I) would consolidate envelope-honesty concerns rather than duplicate." The two ADRs both target MCP envelope honesty; running them as separate cycles risks the client-side fix (this ADR) landing first with no behavioural-test infrastructure that ADR-0242 might want to share, or ADR-0242's shared-error-library not being available when this ADR's `MCPClientError` synthesis lands. Better to fold and converge. | challenge | **REJECTED (4/5)** — Upstream-intent analysis above CONFIRMS the two seams are disjoint and both broken: `mcp-server.ts:512-519` (upstream) wraps only `try/catch` and does NOT detect `isError`; `mcp-client.ts:173-200` (upstream) returns `result as T` without inspection. Folding would either (a) blur ADR-0242's "handlers must throw" message by adding a "and also clients must inspect" rider that operates at a different seam, OR (b) couple this ADR's one-file surgical fix to ADR-0242's multi-cycle adoption timeline (ADR-0242 is explicitly long-term per its Status). The disjointness analysis in this ADR's Pre-flight §F-04-009 check 4 is structurally correct. DA acknowledges the upstream finding **persuasive** and withdraws Challenge 2 explicitly. |

### Devil's Advocate final position

**Withdraws Challenge 2** (folding F-04-009 into ADR-0242) — the upstream finding that
`mcp-server.ts:512-519` does NOT detect `isError:true` confirms the two ADRs operate at
disjoint seams and folding would either dilute ADR-0242's handler-side message or
couple this ADR's one-file fix to ADR-0242's long-term cadence. **Holds principled
dissent on Challenge 1** (F-04-007 forever-defer risk) — acknowledges the panel's vote
on the defer-with-tracking pattern is correct under the corpus rule against
fork-only-fix merge-tax against an upstream-not-wired security boundary, but flags for
the record that the deferral pattern is structurally indistinguishable from
[[feedback-skip-accepted-as-squelch]] drift. Notes the audit slice 04 file is the
durable tracker; if a future CT-* triage cycle re-encounters F-04-007 and the deferral
rationale is re-rubber-stamped without re-examining whether `caller_identity` plumbing
has emerged, that's the harm shape this dissent warns against. Does NOT block the
Decision. Quorum carried 4/5 for the ADR as drafted with two clarifying improvements.

### Improvements adopted

1. **`MCPClientError.cause` chain preserved on `isError:true` throw** (Implementation
   Step 1 + Validation Step 1) — synthesise an `Error` from the extracted
   `content[].text` body and pass as `cause` to `MCPClientError`, so downstream
   `(err as MCPClientError).cause?.message` introspection works the same way it does
   for real-error throws at the existing `:182-186` branch. Captured by positive grep
   on the new throw site.
2. **Site #2 literal-text Confirmation gate** — joint with [[ADR-0238]] Surface 1's
   confirmation gate, add a literal-substring assertion that the rewritten line 8
   contains the literal string `searchSimilarThreats` (proves the HNSW-scope
   clarification per F-04-010 landed, not just a generic docblock edit). Belt-and-
   braces against the docblock rewriter silently omitting the F-04-010 ride-along.
3. **E2's per-process rate-limit critique** logged in the Risk section as a possible
   follow-up if the `caller_identity` work fails to materialize within a reasonable
   horizon. Not folded into this ADR (would expand scope from 3 fix-sites to 4 and
   re-open Option D's structural decision). Captured in the Top risk + mitigation
   paragraph above.
4. **DA principled-dissent recorded** on the F-04-006/007 deferral pattern being
   structurally indistinguishable from slow drift — the audit slice 04 file is the
   durable tracker; any future CT-* triage cycle that re-encounters either finding
   must re-examine `caller_identity` plumbing emergence before re-deferring.

### Confirmation amendments (folded into the Decision section above)

The Confirmation gate set for the three fix-sites now reads:

* **Site #1**: source-shape grep
  `grep -n "return result as T" forks/ruflo/v3/@claude-flow/cli/src/mcp-client.ts`
  returns zero hits; positive grep at the new throw site shows the `MCPClientError`
  constructor receives a third argument (the synthetic `cause: Error`); behaviour
  test asserts `(err as MCPClientError).cause?.message` contains the simulated
  envelope text.
* **Site #2**: joint with [[ADR-0238]] Surface 1's confirmation gate —
  `grep -n "HNSW" forks/ruflo/v3/@claude-flow/aidefence/src/index.ts` returns at
  least one line containing the literal `searchSimilarThreats` substring.
* **Site #3**: source-shape grep
  `grep -n "installAttempted" forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/security-tools.ts`
  shows only `installAttemptedAt` (the `boolean` variant gone); behaviour test
  asserts the 5-minute backoff window + re-entry path.
* **Sites #4 + #5 (deferred)**: no code gate; documentary acceptance via the audit
  slice 04 file remaining authoritative and this ADR's More Information section
  carrying the explicit deferral rationale (per ADR's existing text).

---

## ADR-0243 — CT-J: long-lived process resource discipline

**Status**: proposed (post-swarm-review)
**Swarm**: 4 experts + devil's advocate, Quorum-majority consensus
**Topology**: hierarchical · **Queen**: tactical · **Transport**: queen-composed
**Triage rank**: 14 of 15 (per [[ADR-0233]] §Decision; lowest-urgency batch)

### Decision (post-swarm-review)

Apply **Option A (per-site surgical fixes) for live sites + Option C
addendum (`no-unref-setinterval` ESLint rule) + explicit deferral of
F-10-002 to CT-F (ADR-0239)** as originally drafted, with **five
clarifications** surfaced by the panel: (i) bounded-LRU dispose contract
made explicit — probe `destroy`/`free`/`dispose` on eviction; behaviour
test asserts process RSS not just `Map.size`; (ii) `no-unref-setinterval`
lint scoped to `cli/src/**` + `memory/src/**` ONLY, `v3/mcp/**` exempted
via `overrides` until CT-F decides; (iii) `daemonShutdownHandlersInstalled`
idempotency flag MUST be module-scope `let`, not class-scope `private`
(the `daemon trigger` path constructs fresh `WorkerDaemon` per call); (iv)
Consequences updated to acknowledge F-10-003 is already on deck for the
HandleRegistry extraction; (v) F-10-007 eager-flush fix recorded with a
follow-up footnote that even post-fix a single 300MB transient on load is
an inherent ceiling — stream-ingest is a separate ADR. DA holds
principled dissent on the F-10-007 ceiling (out of CT-J scope) and
withdraws on the lint-vs-perf-monitor challenge.

### Implementation steps

1. **F-10-001 — bounded LRU on three `ruvllm-tools.ts:312-314` Maps.**
   New class (or local helper matching the `HiveLRU` shape at
   `hive-mind-tools.ts:868-931`). Cap from
   `CLAUDE_FLOW_RUVLLM_CACHE_MAX` env (default 64; fail-loud on invalid
   per `[[feedback-no-fallbacks]]`). Move-to-front on `get`. **Eviction
   probes `typeof handle.destroy === 'function' ? handle.destroy() : typeof handle.free === 'function' ? handle.free() : typeof handle.dispose === 'function' ? handle.dispose() : noop` in that priority order.** Commit per
   `[[feedback-commit-forks-before-release]]`. Behaviour test cycles 200
   distinct ids through `mcp__ruflo__ruvllm_hnsw_create`, asserts (a)
   `Map.size === 64`, (b) **process RSS stays under LRU-cap budget**
   (~64 × per-instance WASM heap), (c) eviction count matches the spec.

2. **F-10-005 — bounded LRU + idle-TTL on `activeTrajectories`** at
   `hooks-tools.ts:528`. Default cap 256, TTL 1 hour from last step.
   Symmetric with F-10-001 dispose contract (trajectories have no native
   handle, so dispose probe yields noop — but the probe shape stays for
   future-proofing). Behaviour test: start trajectory, simulate idle 1h,
   assert eviction.

3. **F-10-007 — eager-flush `_pendingNativeIngest`** at
   `rvf-backend.ts:186-187`. Inside `ensureNativeSemanticReady`,
   immediately after native append completes: `this._pendingNativeIngest = []`,
   THEN `this._nativeRehydrated = true` (in that order so a re-entrant
   call cannot append against a half-cleared array). Behaviour test:
   load 100K entries into RVF without calling `search()`, call
   `ensureNativeSemanticReady` directly, assert
   `_pendingNativeIngest.length === 0` AND subsequent `search()` returns
   the loaded set. **Zero merge tax** (fork-only code — upstream
   rvf-backend.ts is 527 LOC vs fork's 3,221 LOC; the field doesn't
   exist upstream).

4. **F-10-010 — module-scope idempotency gate for daemon signal handlers**
   at `worker-daemon.ts:462-472, 483-504`. **Module-scope** (top-level
   `let daemonShutdownHandlersInstalled = false`), NOT class-scope
   `private`. Same gate shape for `installCrashHandlers`
   (`uncaughtException` + `unhandledRejection`). Adopts the
   `audit-writer::installSignalHandlersOnce` pattern verbatim. Behaviour
   test: call `daemon trigger` twice in same process via in-tree harness,
   assert `process.listenerCount('SIGTERM')` stays at 1 (and same for
   SIGINT, SIGHUP, uncaughtException, unhandledRejection).

5. **F-10-002 — DEFER to CT-F (ADR-0239 cluster 2).** Track as closed-by-
   reference in this ADR's site table. If CT-F **deletes** `v3/mcp/`,
   F-10-002 evaporates with the subtree; if CT-F **keeps**, apply
   `.unref()` per timer as a one-line follow-up amendment AND remove the
   `v3/mcp/**` exemption from the lint scope. See cross-bonus row in
   [[ADR-0233]] §Cross-bonus dependencies.

6. **`no-unref-setinterval` ESLint rule** added under
   `forks/ruflo/v3/@claude-flow/cli/.eslintrc.json` (existing config —
   verified) AND `forks/ruflo/v3/@claude-flow/memory/.eslintrc.json`
   (create new). Scoped via `overrides.files` to **`cli/src/**` and
   `memory/src/**` ONLY**; `v3/mcp/**` explicitly **excluded** until
   CT-F decides. Defer the NAPI/WASM-Map arch-test (Option C part b) as
   a follow-up — requires custom TypeScript-AST traversal materially more
   work than the lint.

7. **INTEGRATION-LEDGER rows**:
   - F-10-001: `superseded-by-local` citing this ADR; upstream
     `ruvnet/ruflo/v3/@claude-flow/cli/src/mcp-tools/ruvllm-tools.ts:312-314`
     carries the byte-identical defect — fork-only merge tax until
     upstream takes a matching patch.
   - F-10-010: `superseded-by-local` citing this ADR; upstream
     `ruvnet/ruflo/v3/@claude-flow/cli/src/services/worker-daemon.ts:366-375`
     carries the byte-identical defect. Fork-only merge tax.
   - F-10-007: **no ledger row needed** (fork-only code per
     [[project-fork-only-controllers]]; the field doesn't exist upstream).
   - F-10-005: `superseded-by-local` if upstream `hooks-tools.ts` carries
     the same module-scope Map (verify at implementation time).

### Dependencies

- [[ADR-0233]] §CT-J — defect-class origin citing F-10-001, F-10-002
  (CRITICAL), F-10-005, F-10-007, F-10-010 (WARN/NOTE counter-flag).
- [[ADR-0239]] (CT-F cluster 2) — gates F-10-002 site #2. **Cross-bonus**
  per ADR-0233 §Cross-bonus dependencies: deleting `v3/mcp/` evaporates
  F-10-002 (3 timers) AND F-05-001 (CT-G site #1) with one delete.
- [[ADR-0244]] (CT-K) **F-01-002 sequenced after CT-J Site #4** per ADR-0233:
  "canonical PID/signal discipline lives at CT-J Site #4". Adopting F-10-010
  here unblocks the CT-K `start --daemon` PID-race fix.
- [[ADR-0080]] — HNSW 100K maxElements cap is the source of F-10-007's
  300MB upper bound; eager-flush closes retention-after-rehydrate but
  doesn't change the cap.
- [[ADR-0073]] — RVF substrate-persistence charter; F-10-007 fix
  preserves "RVF is source of truth" invariant.
- [[ADR-0201]] — Remediation-ADR pre-flight checklist that cleared this
  draft. Check #4 ("no sibling-ADR overlap") was the flip point — the
  audit's original static suggestion to fix F-10-002 per-site collided
  with CT-F's planned `v3/mcp/` deletion; deferral was the correct
  inversion. Pre-flight clears for all 4 live sites unconditionally.
- [[ADR-0215]] — golden-master pattern is the precedent for ship-cleanup
  + cheap regression-guard lint together, rather than gate-only.
- `[[feedback-no-fallbacks]]` — LRU on invalid `maxEntries` MUST throw
  (matches `HiveLRU` constructor at hive-mind-tools.ts:876-883).
- `[[feedback-remediation-adr-preflight]]` — corpus-level rule gating
  this ADR's drafting.
- `[[project-fork-only-controllers]]` — establishes F-10-007 RvfBackend
  enhancements as fork-only code with zero merge tax.

### Validation

- **Source-shape grep**:
  - `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/ruvllm-tools.ts:312-314`
    Maps wrapped in bounded-LRU class (or local helper), constructor reads
    `CLAUDE_FLOW_RUVLLM_CACHE_MAX` env (default 64).
  - `forks/ruflo/v3/@claude-flow/memory/src/rvf-backend.ts:186-187` —
    `_pendingNativeIngest = []` assignment present inside
    `ensureNativeSemanticReady` BEFORE `_nativeRehydrated = true`.
  - `forks/ruflo/v3/@claude-flow/cli/src/services/worker-daemon.ts` —
    module-scope `let daemonShutdownHandlersInstalled = false` declaration
    AND `setupShutdownHandlers` short-circuits if set.
  - `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hooks-tools.ts:528` —
    `activeTrajectories` wrapped in bounded-LRU + idle-TTL.
- **ESLint pass**: `npm run lint --workspace=@claude-flow/cli` and
  `@claude-flow/memory` fail red on a deliberate `setInterval` without
  `.unref()` in `cli/src/` or `memory/src/`; pass green for the existing
  compliant sites (`worker-daemon.ts`, `worker-queue.ts`, `mcp-server.ts`,
  `rvf-backend.ts.persistTimer`). `v3/mcp/` sites stay un-linted until CT-F.
- **Behavioural acceptance** (per per-site test specs in
  [[ADR-0243]] §Decision):
  - Cycle 200 distinct ids through `ruvllm_hnsw_create`; assert process
    RSS does not grow past the LRU-cap budget (~64 × per-instance WASM
    heap), not just `Map.size === 64`.
  - Load 100K entries into RVF without calling `search()`; call
    `ensureNativeSemanticReady`; assert `_pendingNativeIngest.length === 0`
    AND subsequent `search()` returns the loaded set.
  - Call `daemon trigger` twice in same process; assert
    `process.listenerCount('SIGTERM') === 1` (and same for SIGINT,
    SIGHUP, uncaughtException, unhandledRejection).
- **Runtime stress carry-forward**: per [[ADR-0201]] §Carry-forward and
  [[ADR-0233]] §Reviews still owed, the full scope of G-16-014 — a
  long-running runtime stress test (10K+ MCP tool calls against a
  single MCP-stdio process with RSS / FD-count / listener-count budget
  assertions) — remains owed AFTER CT-J's per-site patches and CT-F's
  site #2 resolution land. The per-site behaviour tests assert each FIX
  at its seam but NOT freedom-from-drift at the process level.
- **No `skip_accepted`** per `[[feedback-skip-accepted-as-squelch]]`.

### Top risk + mitigation

- **Risk**: F-10-001 LRU lands without the strengthened dispose contract,
  so the bounded JS Map evicts entries but the underlying WASM heap stays
  retained (a `MicroLora`/`SonaInstant`/`HnswRouter` `destroy`/`free`
  call is needed to release the WASM-side memory). Behaviour test
  asserting only `Map.size === 64` would pass while the actual leak
  continues — RSS still grows linearly with distinct ids.
- **Mitigation**: dispose probe is mandatory per Expert 1's amendment;
  behaviour test asserts process RSS budget, not just `Map.size`.
  The probe priority order (`destroy` → `free` → `dispose` → noop) is
  explicit so future WASM types with different lifecycle methods are
  handled without code change. Matches Expert 1's concern that "silent
  eviction without releasing WASM heap is the actual bug, not the JS
  Map size".

- **Risk** (secondary): F-10-002 deferral leaves the v3/mcp/ event-loop-
  pin live in the tree. A CLI command that transiently constructs a
  `ConnectionPool` via an as-yet-unidentified import path hangs Node on
  exit until CT-F decides.
- **Mitigation**: audit confirmed zero external callers of `v3/mcp/`
  today (CT-F pre-flight check #3 verified 0 hits for `from '.*v3/mcp/'`
  outside the subtree itself). The lint catches NEW uses elsewhere; the
  CT-F triage decision is owed at triage priority #10 — well-bounded
  wait. If CT-F defers further, this ADR carries an amendment to apply
  the `.unref()` per-site fix and remove the lint exemption.

---

## ADR-0242 — CT-I: shared error library + MCP envelope honesty

**Status**: proposed (post-swarm-review)
**Swarm**: 6 experts + devil's advocate, Weighted consensus (queen ×3; 8 weighted points total, threshold 4)
**Triage rank**: 15 (lowest urgency per [[ADR-0233]] §Decision — long-term cultural debt; explicitly framed as not-a-migration)

### Decision (post-swarm-review)

Ratify **Option A + Option B as drafted** (extract `gastown-bridge/errors.ts` to shared `@claude-flow/errors`; advisory-first lint forbidding NEW `throw new Error(string)`; MCP-handler arch-test asserting fatals throw), with **4 improvements** surfaced by the panel and **2 substantive corrections** to load-bearing pre-flight claims. Long-term, scope-limited framing preserved. **Explicitly NOT** Option C (big-bang fix all ~1,994 throws) or Option D (status quo + document).

Improvements (folded into the ADR's §"Swarm review (2026-05-24)" section):

1. **(E2 + queen)** Explicit disjointness paragraph vs [[ADR-0247]] (CT-N F-04-009, client-side `callMCPTool` `isError`). Same protocol-boundary concern, opposite ends. Disjoint by artifact (handlers vs `callMCPTool`) and mechanism (arch-test on swallow-shape vs runtime `isError` inspection).
2. **(E3 + queen)** Explicit allowlist file names + content-keying convention in §Confirmation: `lib/throw-new-error-allowlist.txt` (content-keyed) + `lib/mcp-handler-fatal-throw-allowlist.txt` (handler-id-keyed). Both new check scripts register in BOTH `run_check_bg` AND `collect_parallel` per `[[reference-acceptance-runcheck-vs-collect]]`.
3. **(Queen)** INTEGRATION-LEDGER row commitment in §Confirmation. Disposition for both fork edits (new `@claude-flow/errors` package + `gastown-bridge/errors.ts` re-export shim): `convergence-with-upstream` (re-organization of upstream-derived content under a shared boundary).
4. **(E5 + DA-counter)** §"Erosion-vs-rot disposition" subsection: DA's "rot like dead retry libs" challenge structurally answered — (i) advisory-first lint creates review-time forcing function the retry libs never had; (ii) canon is minimum-viable (2 plugin families already adopt it). Mitigation invariant: cycle N+3 adoption-rate check.

DA (devil's advocate) holds **principled dissent on cultural debt acceptance**: argues lint-grandfathering is perpetual bifurcation and that an honest "accept the debt" disposition would be cleaner than an advisory-first detector that may never promote to `exit 1`. DA accepts the majority verdict (lint cost is small; canon enables future targeted migrations like F-13-006); records dissent for the [[ADR-0233]] follow-up tracker.

### Implementation steps

1. **Extract `@claude-flow/errors` package** at `forks/ruflo/v3/@claude-flow/errors/`:
   - `src/index.ts` re-exports the ~157-LOC base subset from `gastown-bridge/errors.ts` (`GasTownError` → renamed `RufloError`; `GasTownErrorCode` → renamed `RufloErrorCode`; `wrapError`, `getErrorMessage`, `isGasTownError` → renamed `isRufloError`, plus type guards).
   - Plugin-specific subclasses (`BeadsError`, `FormulaError`, `ConvoyError`, `CLIExecutionError`) stay in `gastown-bridge`.
   - Naming convention (`RUFLO_E*`, `RUFLO_ERR_*`, etc.) deferred to impl swarm per F-13-004; ADR commits only to existence of single convention in new package.
   - Add divergence-marker comment in `src/index.ts` per [[ADR-0234]] precedent: `// FORK: shared @claude-flow/errors extracted from upstream gastown-bridge/errors.ts; see ADR-0242.`
   - `README.md` documents canon: when to extend `RufloError` vs `Error`, when to set `cause:`, when to use `wrapError()`, naming convention.
   - Behavior test asserting `new RufloError(...)` round-trip + `wrapError(parent).cause === parent`.

2. **Plugin re-export shim** at `forks/ruflo/v3/plugins/gastown-bridge/src/errors.ts`:
   - Replace base subset with `export { RufloError as GasTownError, RufloErrorCode as GasTownErrorCode, wrapError, getErrorMessage } from '@claude-flow/errors';` shape.
   - Plugin-specific subclasses (`BeadsError`, etc.) updated to `extends GasTownError` (which is now the imported `RufloError`).
   - Arch-test asserts re-export round-trips: `new GasTownError('x') instanceof RufloError === true`.
   - Commit per `[[feedback-commit-forks-before-release]]`.

3. **INTEGRATION-LEDGER rows (2)**:
   - New `@claude-flow/errors` package: `convergence-with-upstream` (extracts upstream-derived content into shared boundary).
   - `gastown-bridge/errors.ts` re-export shim: `convergence-with-upstream` (refactor preserves byte-identical consumer call-site behavior; upstream's `ruvnet/ruflo/v3/plugins/gastown-bridge/src/errors.ts` is the seed).
   - Both per `[[feedback-update-integration-ledger]]`.

4. **Lint script** at `scripts/check-throw-new-error.mjs`:
   - Zero-dep, modelled on `scripts/check-silent-catches.mjs` + `scripts/check-undiscriminating-catches.mjs`.
   - Scans `forks/ruflo/v3/@claude-flow/cli/src` and `forks/agentic-flow/src` (matching existing checks' scan roots).
   - Detects `throw new Error("..."` (literal-string constructor argument; net-new sites only).
   - Reads `lib/throw-new-error-allowlist.txt` (content-keyed per the `fcab2bc` refactor pattern; baseline = today's ~1,994 sites).
   - Diagnostic: "throw an instance of `RufloError` (or subclass) from `@claude-flow/errors`, with a `code:` and `cause:` where applicable; see `forks/ruflo/v3/@claude-flow/errors/README.md`."
   - Advisory-first (`exit 0` with count); promotion to `exit 1` iff FP rate empirically `0` after baseline.

5. **MCP-handler arch-test** at `scripts/check-mcp-handler-fatal-throw.mjs`:
   - Scans `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/`.
   - Narrow shape only: handler-top-level `catch(e) { return { success: false, ...} }` (OR `{ available: false, ...}`) with no `instanceof` / `.name===` discriminator + no re-throw path.
   - Honest discriminated catches (`catch (e) { if (e instanceof OptionalModuleNotFound) return {available:false}; throw e; }`) explicitly allowed.
   - Reads `lib/mcp-handler-fatal-throw-allowlist.txt` (handler-id-keyed; baseline = today's ~56 sites).
   - Advisory-first per [[ADR-0209]] / [[ADR-0210]] settled approach.
   - Does NOT propose changing `mcp-server.ts:691-707` wrap (the wrap is correct — throw → JSON-RPC `-32603` frame).

6. **Acceptance check registration** per `[[reference-acceptance-runcheck-vs-collect]]`:
   - Both new checks registered in BOTH `run_check_bg` AND `collect_parallel` lists in `scripts/ruflo-publish.sh`.
   - Gate is `no-skip-accepted` per `[[feedback-skip-accepted-as-squelch]]` (advisory-first is NOT a squelch; modelled on ADR-0209's settled pattern).

### Dependencies

- [[ADR-0201]] — Remediation-ADR pre-flight checklist that cleared this draft (modulo the 2 corrections in this fragment: gastown-bridge upstream-derived provenance; retry-libs upstream parity confirmatory).
- [[ADR-0209]] — owns per-site bulk-fix of dishonest-success envelopes; this ADR owns the protocol-boundary mechanism (the lint + arch-test that says "fatals must throw"). Disjoint per ADR-0242 §pre-flight check #4.
- [[ADR-0210]] — second-pass council explicitly identified this micro-ADR as owed for the protocol-boundary signal; this ADR delivers the envelope-honesty half (server-side handler-rule).
- [[ADR-0233]] §CT-I — defect-class origin; priority 10 (lowest urgency); long-term framing consistent with that calibration.
- [[ADR-0234]] — divergence-marker comment precedent (applied to new `@claude-flow/errors/src/index.ts` provenance).
- [[ADR-0239]] (CT-F) — defers `gastown-bridge` deletion specifically because it's a published artifact (`@claude-flow/plugin-gastown-bridge@0.1.4` on Verdaccio) whose source is upstream; this ADR's extraction is therefore also not a delete.
- [[ADR-0247]] (CT-N) — client-side complement (`callMCPTool` `isError` propagation). Disjoint by artifact + mechanism per Improvement #1 above.
- [[ADR-0248]] (CT-O) — owns gastown-bridge per-plugin disposition; this ADR's extraction does not conflict (plugin runtime behavior preserved via re-export shim).

### Validation

- **Source-shape grep**: `forks/ruflo/v3/@claude-flow/errors/src/index.ts` exists, exports `RufloError` (or whatever name the swarm settles on), `RufloErrorCode`, `wrapError`, `getErrorMessage`, `isRufloError`.
- **Source-shape grep**: `forks/ruflo/v3/plugins/gastown-bridge/src/errors.ts` re-exports the base subset from `@claude-flow/errors` (so `class GasTownError extends RufloError` — preserving plugin-side API).
- **Source-shape grep**: `scripts/check-throw-new-error.mjs` exists, zero external deps, scans both fork TS roots, reads `lib/throw-new-error-allowlist.txt`, exits `0` advisory-first with count.
- **Source-shape grep**: `scripts/check-mcp-handler-fatal-throw.mjs` exists, scans `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/`, baseline allowlist = today's ~56 sites.
- **Source-shape grep**: `scripts/ruflo-publish.sh` invokes both new checks alongside `check-silent-catches.mjs` and `check-undiscriminating-catches.mjs`.
- **Source-shape grep**: `forks/ruflo/v3/@claude-flow/errors/README.md` exists, documents canon.
- **Behavioural acceptance**: `new RufloError('msg', RufloErrorCode.X, {ctx:1}, parent).cause === parent`; `.toJSON()` returns expected shape; `.code === 'RUFLO_E_X'` (or whatever scheme swarm picks).
- **Behavioural acceptance**: re-export round-trip — `import { GasTownError } from 'gastown-bridge/errors'; expect(new GasTownError('x') instanceof RufloError).toBe(true);`.
- **MCP-handler arch-test**: baseline count > 0 (the ~56 existing handlers); allowlist entries equal that baseline; FP count empirically measured; promote-to-`exit-1` gate firing iff new-code rate is `0` after baseline.
- **No `skip_accepted`** per `[[feedback-skip-accepted-as-squelch]]`. Advisory-first lint is NOT a squelch — it's the explicit cultural-shift instrument modelled on ADR-0209's "fixed regression assertion + permanently-advisory counter."
- **Post-release**: verify via fresh install in `/tmp` per `[[feedback-inspect-installed-not-dev-nodemodules]]`, NOT against dev `node_modules/`.

### Top risk + mitigation

- **Risk (DA)**: Shared error library rots like the dead retry libs — new code keeps adopting the naked `throw new Error(string)` pattern; canon adoption stays at 2 plugins forever; advisory lint plateaus and never promotes to `exit 1`.
- **Mitigation**: Erosion-vs-rot disposition (Improvement #4). Structural difference from retry libs is (i) advisory-first lint creates a review-time forcing function (engineer sees the warning at PR review; the retry libs never had this signal); (ii) canon is minimum-viable (extracts exactly what 2 plugin families already use, not a richer-than-needed design). **Mitigation invariant**: cycle N+3 adoption-rate check. If the lint advisory count is still > 0 in cycle N+3 AND canon adoption rate is zero across all new code, that's the "rotting" signal and the canon may need a "delete-and-accept-the-debt" follow-up ADR per DA's principled dissent. If canon adoption is non-zero, the canon is working as designed and the long-tail of existing throws is exactly the documented erosion-not-replacement path.
- **Secondary risk (E2)**: MCP-handler arch-test FP rate stays > 0 forever (never promotes to `exit 1`); the gate becomes documentation rather than enforcement. Mitigation: the *signal* is what matters (handler authors see the warning at review time); the gate is the icing. Per [[ADR-0209]]'s settled pattern, permanently-advisory counters are an accepted shape — not a regression.

### Weighted consensus tally (8 weighted points: queen ×3 + 5 worker votes; threshold 4)

| Voter | Weight | Vote | One-line position |
|-------|--------|------|-------------------|
| **Queen** (strategic) | 3 | **adopt-with-improvements** | The canon + lint + arch-test triple is the right shape; long-term framing pre-empts the "rot like dead retry libs" risk; improvements tighten structural claims without re-scoping. |
| E1 (error-class hierarchy) | 1 | adopt | `gastown-bridge/errors.ts` is the right gold standard (701 LOC hierarchy with `code`/`cause`/`context`/`timestamp`/`captureStackTrace`/`toJSON`/`toString`/type guards + `wrapError` adapter — every modern shape present). |
| E2 (MCP-envelope) | 1 | adopt-with-amendment | Arch-test rule (handler-top-level swallow w/o discriminator) is right narrow shape; ADR must note disjointness from [[ADR-0247]] (CT-N) — same protocol-boundary, opposite ends. |
| E3 (lint-grandfathering) | 1 | adopt-with-amendment | Advisory-first pattern matches existing precedent; FP-rate-zero promotion criterion sound; allowlist must be content-keyed (matching `fcab2bc` refactor); script names + acceptance-registration spec should be explicit. |
| E4 (retry-library consolidation) | 1 | adopt-as-out-of-scope | Correctly deferred per `feedback-corpus-evidence-before-feature-work`. Confirming: both retry libs exist in upstream too with zero production callers; F-13-001 deferral is upstream-aligned by omission. |
| E5 (migration-pace) | 1 | adopt | Long-term framing honest about what doesn't migrate; ~1,994 throws stay disclosure prevents future maintainers misreading ADR as migration commitment; cycle-1 scope (extract + ship advisory checks) fits one release cycle. |
| **DA** (devil's advocate) | 1 | **hold-principled-dissent** | "Shared error library will rot just like dead retry libs unless mandatory adoption is gated — but mandatory adoption is what ADR explicitly disclaims." AND: "Lint-grandfathering means perpetual bifurcation — accept the cultural debt instead." Both addressed by Improvement #4 (erosion-vs-rot) and the DA dissent record below. |

**Result**: queen (3) + 5 adopt-class votes = **8 weighted points adopt** (threshold `ceil(8/2) = 4` cleared). DA holds principled dissent (recorded; not a vote against). Decision ratified.

**DA position**: principled dissent held + recorded; no withdrawal. Vindication test: if after 3 cycles the lint hasn't promoted to `exit 1` AND canon adoption rate is non-zero AND advisory count is materially growing (not just plateauing), DA's "rot like retry libs" hypothesis is vindicated and a follow-up "delete-and-accept-the-debt" ADR may be owed.

### Key upstream finding (verification per assignment)

**`forks/ruflo/v3/plugins/gastown-bridge/src/errors.ts` is NOT fork-only — it IS upstream code**. Direct read on 2026-05-24:

- Fork `/Users/henrik/source/forks/ruflo/v3/plugins/gastown-bridge/src/errors.ts`: **701 LOC**.
- Upstream `/Users/henrik/source/ruvnet/ruflo/v3/plugins/gastown-bridge/src/errors.ts`: **700 LOC**.
- `diff -q` between fork and upstream returns no output → **byte-identical for the hierarchy subset this ADR proposes to extract**.
- Plugin is **published as `@claude-flow/plugin-gastown-bridge@0.1.4`** on Verdaccio (confirmed via `curl -s http://localhost:4873/@claude-flow/plugin-gastown-bridge` → `{"name":"@claude-flow/plugin-gastown-bridge","versions":{"0.1.4":...}}`).
- Listed in `featured/trending/official/newest` per `cli/scripts/publish-registry.ts:195` and `discovery.ts` (per [[ADR-0239]] cluster 5).

**Implication**: the prompt's hint that gastown-bridge is "fork-only per CT-O finding" is **incorrect**. CT-O ([[ADR-0248]]) treats `gastown-bridge` as a **published plugin** subject to per-plugin disposition; CT-F ([[ADR-0239]]) **explicitly defers** gastown-bridge's deletion specifically because it's a published artifact whose source is upstream. This makes the ADR-0242 extraction **easier, not harder**: the new `@claude-flow/errors` package re-exports code that originated upstream and is currently shipped via two upstream-aligned plugins (`gastown-bridge` itself and `agentic-qe` via inheritance). Merge-tax against future upstream syncs is structural (a new package boundary), not substantive (no upstream-divergent content). INTEGRATION-LEDGER disposition: `convergence-with-upstream` (re-organization of upstream-derived content under a shared boundary), NOT `superseded-by-local` (which would imply fork-divergent invention).

**Secondary upstream finding**: fork's `production/error-handler.ts` has **480 LOC**; upstream's has **398 LOC**. The fork has *extended* the dead facility by ~82 LOC without wiring any callers, deepening F-13-002. Minor drift; worth noting for the F-13-002 follow-up ADR's "wire-or-delete" calculus. If "delete" wins, deletion closes 480 fork-LOC; if "wire" wins, the wire must happen on the upstream-aligned 398-LOC version to minimize merge tax. **No change required to ADR-0242** — this is data for the F-13-002 follow-up.

**Tertiary upstream finding**: both retry libraries exist in upstream too (`ruvnet/ruflo/v3/@claude-flow/cli/src/production/retry.ts` and `ruvnet/ruflo/v3/@claude-flow/shared/src/resilience/retry.ts`), both with zero production callers in either fork or upstream. F-13-001 deferral is therefore **upstream-aligned by omission** — picking one library and deleting the other is a fork-only intervention that would carry permanent merge tax. The future F-13-001 micro-ADR will need to make that call explicitly.

### Cross-references

- [[ADR-0233]] §CT-I + §"Pre-flight inversions" — defect-class origin; CT-I is NOT a pre-flight inversion (the ADR correctly identifies the structural rule without needing flip).
- [[ADR-0201]] §"Remediation-ADR pre-flight checklist" — ran with the 2 corrections above applied.
- [[ADR-0209]] — Step 2 explicitly deferred the protocol-boundary mechanism to a future micro-ADR; this ADR is that mechanism. Disjoint.
- [[ADR-0210]] — second-pass council explicitly identified this micro-ADR as owed; ADR-0242 delivers the envelope-honesty half (server-side handler-rule).
- [[ADR-0234]] — divergence-marker comment precedent (applied to new `@claude-flow/errors/src/index.ts` provenance).
- [[ADR-0239]] (CT-F) — gastown-bridge deferred from deletion specifically because of published-artifact status; ADR-0242's extraction is also not a delete.
- [[ADR-0247]] (CT-N) — client-side complement; disjoint by artifact + mechanism per Improvement #1 (ADR-0247's own pre-flight already documents this disjointness).
- [[ADR-0248]] (CT-O) — owns gastown-bridge per-plugin disposition; no conflict with extraction.
- `[[feedback-best-effort-must-rethrow-fatals]]` — the corpus rule the MCP envelope-honesty arch-test operationalizes at the largest single cluster of violations.
- `[[feedback-no-fallbacks]]` — parent policy; envelope-honesty rule is a specific instance.
- `[[feedback-skip-accepted-as-squelch]]` — advisory-first lint is NOT a squelch.
- `[[feedback-corpus-evidence-before-feature-work]]` — why F-13-001/002/003/004 deferred to follow-up swarm reviews.
- `[[feedback-remediation-adr-preflight]]` — source of 4-check pre-flight; corrections #1 (gastown-bridge upstream-derived) and #2 (retry-libs upstream parity) sharpen pre-flight check #2 ("upstream hasn't already decided it").
- `[[feedback-update-integration-ledger]]` — INTEGRATION-LEDGER rows owed for both fork edits (both `convergence-with-upstream`).
- `[[feedback-commit-forks-before-release]]` — both fork edits commit BEFORE next `npm run release`.
- `[[feedback-inspect-installed-not-dev-nodemodules]]` — post-release verification uses fresh `/tmp` install.
- `[[reference-acceptance-runcheck-vs-collect]]` — both new check scripts register in BOTH lists per Improvement #2.

---

