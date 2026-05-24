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

<!-- Per-ADR plan sections assembled below after swarm reviews complete -->
