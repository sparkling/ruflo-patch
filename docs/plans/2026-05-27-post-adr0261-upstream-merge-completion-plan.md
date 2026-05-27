# Post-ADR-0261 upstream-merge completion plan

**Date**: 2026-05-27
**Author**: Henrik (with Claude Opus 4.7)
**Status**: draft

## Context

[[ADR-0261]] is `accepted + completed: true + implemented: 2026-05-27` (ratified 2026-05-27; release 3.7.0-alpha.10-patch.327 publishes the fork-native graph-edges substrate; INTEGRATION-LEDGER row 234 disposition flipped `deferred` → `reimplemented-via-adr-0261`).

The ADR-130 upstream merge is structurally complete. What remains:

- **3 ledger rows** (235/237/238) in the ADR-130 family carry `defer` dispositions whose blocking parent is now resolved. They are inert ledger items that should be re-dispositioned to close the family.
- **ADR-129 Phases 1-3** (rvagent integration) is the remaining substantive upstream-merge surface. Its two design gates (ADR-0258 persistence-threading + ADR-0259 SAFE_MCP_TOOLS allowlist) flipped to `accepted + completed` during this work. Implementation can begin.
- **ADR-0263** (archivist replay-verification harness, ADR-0181 Phase I successor) is `proposed + completed: false`. Fork-internal — not an upstream merge — but is the next ADR in the queue.

Three tracks below. Tracks A and B advance the upstream-merge frontier; Track C runs orthogonal and doesn't block either.

## Track A — Close the ADR-130 family ledger (small)

**Scope**: re-disposition 3 deferred rows in `docs/upstream/INTEGRATION-LEDGER.md`. No new ADR. No code changes.

| Row | SHA | Subject | New disposition | Rationale |
|---|---|---|---|---|
| 235 | `16810c3e2` | fix(bench) ADR-130 P6 CI-friendly single-session inserts | **skip-by-policy** (was: defer) | Upstream's bench targets `graph-edge-writer.ts`; the fork-native design ([[ADR-0261]]) replaced that path with the archivist handler. Fork's own `scripts/benchmark-graph.mjs` measures the equivalent surface (T1/T2/T3 against `agentdb_graph_edge`). Pick has no fork-side surface to land on. |
| 237 | `10086c4bb` | ci: timeout-minutes:40 to graph-benchmark job | **skip-by-policy** (was: defer) | Upstream tunes timeout for its own CI job. Fork's CI surface (`.github/workflows/v3-ci-graph.yml`) is independent + its smokes complete in sub-60s wall-clock after the shared-temp refactor (`d44fc86`). The 40-minute knob has nothing to gate. |
| 238 | `542481053` | docs(adr) ADR-130 graph intelligence integration + improvement roadmap | **referenced-from-fork-adr** (was: defer) | Upstream's docs cite upstream-only infrastructure (`graph-edge-writer.ts`, `MEMORY_SCHEMA_V3`, `verification/witness-fixes.json`). The fork's [[ADR-0261]] §Cross-references already names upstream PR `edde98f9e` as the inspiration. Re-disposition closes the row without picking the upstream doc. |

**Deliverables**:

1. Edit rows 235/237/238 with the new dispositions + dated note pointing to this plan.
2. Commit as `docs(ledger): close ADR-130 family deferred rows 235/237/238 (post-ADR-0261)`.
3. Push.

**Acceptance**: `grep "edde98f9e\|16810c3e2\|10086c4bb\|542481053" docs/upstream/INTEGRATION-LEDGER.md` shows no remaining `defer` disposition for ADR-130 family.

**Risk shape**: lowest. Pure documentation hygiene; no runtime behavior change; no merge conflicts possible.

## Track B — ADR-129 Phases 1-3 implementation (substantive)

**Scope**: implement upstream's rvagent integration Phases 1-3 (file at `47a7825b0` per ledger row 239). Both design gates are now done; the substantive work is reconciling upstream's MCP-tool surface with the fork's existing persistence layer in `wasm-agent-tools.ts`.

**Pre-flight reading**:
- [[ADR-0254]] §"Phase-by-phase analysis" for the per-phase scope.
- [[ADR-0256]] §"Option A" for the Phase 4 precedent (helpers + smoke + CI stanza pattern).
- [[ADR-0258]] for persistence-threading decisions on Phases 1-3 MCP tools.
- [[ADR-0259]] for the SAFE_MCP_TOOLS allowlist alignment.
- Fork's `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/wasm-agent-tools.ts` (the 592-line existing persistence layer that upstream's verbatim PR does not have).

**Two-stage delivery**:

### B.1 — New implementation ADR (call provisionally `ADR-0265 — ADR-129 Phases 1-3 implementation amendment`)

Drafts the design that reconciles upstream's Phase 1-3 MCP-tool surface (per upstream PR `47a7825b0`) with:
- Fork's `wasm-agent-tools.ts` persistence layer (`<projectRoot>/.claude-flow/wasm-agents/store.json` + `withStoreLock` + `snapshotAgent` + `ensureLive`)
- The persistence-threading decisions from [[ADR-0258]]
- The allowlist alignment from [[ADR-0259]]

Specifies file-level deliverables, acceptance criteria tied to the §R2.6-style 10-criteria table format ADR-0261 used, and §R2.10-style divergence catalog (what's forced by fork invariants vs convergent with upstream).

Status: `proposed` → council review (smaller than ADR-0261's; the design gates already exist) → `accepted` → implementation → `completed: true`.

### B.2 — Implementation

Mirrors the ADR-0261 implementation pattern:
- Parallel agent fan-out for the source writes (3 repos: agentdb if any handlers/types changed, ruflo cli for the MCP tools + persistence layer reconciliation, ruflo-patch for smokes + CI)
- Acceptance via 5 granular smokes (one per Phase 1, 2, 3 + a persistence-threading smoke + an allowlist-alignment smoke)
- Smokes wired into the canonical harness via a new `lib/acceptance-adr0265-checks.sh` (per [[feedback-always-wire-tests-into-cicd]])
- Release via `npm run release`; verdict via the canonical harness
- INTEGRATION-LEDGER row 239 updated from `pick-partial` to disposition reflecting the full integration

**Acceptance**:
1. New ADR-0265-shaped ratified
2. 3 phases land in forks; release publishes; sparkling push from pipeline
3. Smokes green through canonical harness
4. ADR-0265 `completed: true`
5. Ledger row 239 updated

**Risk shape**: medium. The reconciliation between upstream's MCP surface and the fork's persistence layer is the load-bearing design decision — both gates exist (ADR-0258/0259) but their implementation may surface impedance the gates didn't anticipate. Mitigation: spawn a council on the design ADR (lighter than ADR-0261's — focused on persistence-vs-MCP integration only).

## Track C — ADR-0263 ratification + implementation (parallel; non-blocking)

**Scope**: archivist replay-verification harness (ADR-0181 Phase I successor). Fork-internal. Doesn't block upstream merge progress but is the next pending ADR in the queue.

**Sequence**:
1. Council review of [[ADR-0263]] design (currently `proposed`)
2. Ratification: `proposed` → `accepted`
3. Implementation per the ADR's §Decision Outcome
4. Acceptance via canonical harness (one or more checks under a new `lib/acceptance-adr0263-checks.sh`)
5. `completed: true`

**Risk shape**: bounded — the replay-verification harness is a test surface, not a production code path.

## Track D — ADR-0265 QUIC federation native transport (substantive; multi-repo)

**Scope**: implement upstream [[ADR-108]] vision via fork-side [[ADR-0265]] (`proposed`, 2026-05-27). N-API binding crate wrapping upstream's quinn-based Rust crate + multi-platform binary distribution + loader extension + federation plugin adoption + 8-smoke verification + CI matrix. **Distinct scope from [[ADR-0217]]** — agentdb-sync stays quarantined.

**Pre-flight reading**:
- Upstream [[ADR-108]] in full (`/Users/henrik/source/ruvnet/ruflo/v3/docs/adr/ADR-108-native-quic-binding.md`)
- Upstream [[ADR-104]] (loader pattern — already in fork via [[ADR-0186]] row 266)
- Upstream `crates/agentic-flow-quic/` (the Rust crate we're wrapping) + `src/wasm.rs` (stub doc explaining why WASM doesn't suffice)
- Fork's [[ADR-0217]] sibling amendment 2026-05-27 (scope-distinction)
- Fork's existing WS-fallback wiring in `forks/ruflo/v3/@claude-flow/plugin-agent-federation/` (sourced via [[ADR-0186]])

**Track D unfolds in 4 stages**, mirroring the [[ADR-0261]] playbook adapted for the larger surface.

### D.0 — Upstream Phase-1 verification check (single agent, ~minutes)

Before any design work, verify upstream `ruvnet/agentic-flow#15-21` issue tracker state. If any Phase-1 ticket closed since 2026-05-09 (ADR-108 date), the fork may be able to consume upstream's work instead of duplicating it.

**Spawn**: single Explore-type agent (or inline) — fetch issue states + recent commits in `crates/agentic-flow-quic-node/` if it now exists. Report a delta table per upstream issue.

**Output**: appends to ADR-0265 §"Pre-flight" as a council-input doc.

### D.1 — Council review (5-expert parallel fan-out)

Following [[ADR-0261]] §Revision 1 pattern. ZERO consensus voting (per `[[feedback-no-hive-ceremony-for-impl]]`) — parallel agent fan-out with named expert lenses; synthesis is queen (the user-via-me).

| Expert | Lens | Output |
|---|---|---|
| Upstream-implementation archeologist | Read upstream `crates/agentic-flow-quic/` end-to-end; document client/server API surface; check what's `quinn`-public vs fork-must-wrap | API surface map ready for N-API wrapping |
| Fork-invariants steward | Re-read [[ADR-0186]] / [[ADR-0199]] / [[ADR-0200]] / [[ADR-0201]] / [[ADR-0217]]; produce constraint manifest the implementation must satisfy | Constraint table mirroring ADR-0261 §R1 |
| Cross-platform CI engineer | Audit the GitHub Actions matrix needed for cross-compiled binaries (darwin-arm64, darwin-x64, linux-x64-gnu, linux-arm64-gnu, win32-x64-msvc). Estimate CI cost; recommend platform set | CI-cost vs platform-coverage tradeoff table |
| Aspirational-claims auditor | Walk ADR-0265 §"Aspirational" 8-row table; for each upstream claim, identify whether it's physically realizable on quinn / Node.js, or marketing | Each row marked H/M/L confidence + verification method |
| Devil's-advocate / 8th-criterion hunter | 3+1 preflight per `[[feedback-remediation-adr-preflight]]`: signal-reaches-audience (does any fork consumer need >100 RPS / 0-RTT / mobility today?), upstream-already-decided (is Phase-1 imminent?), premise-true (does fork's agentic-flow really lack the N-API wrapper?), sibling-overlap (does ADR-0263 / ADR-0265 step on each other?) | Top-3 load-bearing critiques |

**Spawn pattern**: 5 parallel agents, ONE message, `run_in_background:true`. Each agent reads-only; no commits. Reports back when complete.

**Synthesis** (queen): apply council findings to ADR-0265 §Revision 1; flip frontmatter `status: proposed` → `accepted` only after corrections land.

### D.2 — Implementation (3-agent parallel fan-out per repo)

Mirrors [[ADR-0261]] §D.2 implementation:

| Agent | Repo | Phase coverage | LOC estimate |
|---|---|---|---|
| **agentic-flow-impl** | `/Users/henrik/source/forks/agentic-flow` | Phase 1 (Rust + N-API crate `crates/agentic-flow-quic-node/`) + Phase 3 (loader extension in `agentic-flow/src/transport/quic-loader.ts`) | ~800-1200 LOC (Rust + TS combined) |
| **ruflo-impl** | `/Users/henrik/source/forks/ruflo` | Phase 4 (federation plugin adoption: `v3/@claude-flow/plugin-agent-federation/src/plugin.ts` + doctor surface in `cli/src/commands/doctor.ts`) | ~150-250 LOC |
| **ruflo-patch-impl** | `/Users/henrik/source/ruflo-patch` | Phase 5 (8 smokes + benchmark in `scripts/`) + Phase 6 (codemod guards) + harness wiring (`lib/acceptance-adr0265-checks.sh` per `[[feedback-always-wire-tests-into-cicd]]`) + CI stanza (`.github/workflows/v3-ci-quic.yml`) | ~1400-1800 LOC (8 smokes × 150-200 + bench + harness + CI) |

**Spawn pattern**: 3 parallel `coder` subagents, ONE message, `run_in_background:true`. Cross-package symbol contract pinned in ADR-0265 §"Implementation plan" — same playbook as ADR-0261 where the agents coordinated on `decodeEmbedding` / `agentdb_graph_edge_query` shapes.

**Phase 2 (multi-platform binary distribution) is its own sub-track**:
- Phase 2 depends on Phase 1 (the crate must exist before we can publish binaries)
- 5 platform binaries published as `@agentic-flow/quic-native-{darwin-arm64,darwin-x64,linux-x64-gnu,linux-arm64-gnu,win32-x64-msvc}` to Verdaccio (per `[[reference-verdaccio]]`)
- `optionalDependencies` in `@sparkleideas/agentic-flow` resolves at install
- CI cross-compile via GitHub Actions matrix — gated on Track D.1's CI-engineer cost analysis

Phase 2 runs **sequentially after Phase 1** since binary builds need the crate compiled first.

### D.3 — Validation + commit + release + push

Identical to [[ADR-0261]]'s validation pass:

1. Verify content vs message (`git status` + sample `git show --stat` per `[[feedback-verify-commit-content-vs-message]]`)
2. Build per repo (`cargo build --release` for the Rust crate; `npm run build` for the TS layers)
3. Run lint extensions
4. Source-grep acceptance gates per ADR-0265 §"Acceptance criteria" C1-C8
5. Run smokes individually via `node scripts/smoke-quic-*.mjs` to confirm; THEN run via `bash scripts/test-acceptance-fast.sh adr0265` to confirm canonical harness path
6. Run `node scripts/analyze-acceptance-perf.mjs` post-implementation — verify the 8 smokes don't introduce a new PARALLEL-WASTE pattern (per `[[reference-acceptance-perf-analyzer]]`). If they do, apply the ADR-0261 §R2.2 shared-temp pattern.
7. Commit per repo (3 commits — forks/agentic-flow + forks/ruflo without Co-Authored-By trailer per `[[feedback-fork-commit-attribution]]`; ruflo-patch with it)
8. `npm run release` from ruflo-patch — release pipeline publishes forks + pushes to sparkling
9. `git push origin main` on ruflo-patch
10. Flip ADR-0265 `completed: false` → `true`, `implemented: <date>`
11. Update INTEGRATION-LEDGER with row for upstream ADR-108 disposition (`reimplemented-via-adr-0265` or equivalent)
12. Cross-link [[ADR-0217]] sibling amendment if any scope-clarification needed post-implementation

### D.4 — Acceptance criteria audit

Each of ADR-0265's 8 criteria verified by passing smoke:
- C1 N-API binding loads
- C2 Loader auto-upgrades with env var
- C3 Loader falls back without env var
- C4 Federation send round-trips on both backends
- C5 Doctor reports correct backend
- C6 Benchmarks meet documented targets (MEASURED figures populated in the aspirational table)
- C7 No agentdb QUIC re-introduction (ADR-0217 arch test still passes)
- C8 All 8 verification smokes wired into harness

Plus the aspirational-claims table (§"Aspirational upstream documentation goals") gets MEASURED values written in — sub-ms latency becomes "p99 = 1.23ms (localhost)" with actual figures, not the documentation claim repeated.

## Track D risk shape

- **Rust + N-API + cross-compile** is the substantial-implementation-risk leg. ADR-0265 §Risks names this; mitigation is the platform-coverage downscope option (drop to 2 platforms if CI cost exceeds 2× current).
- **Upstream Phase-1 drift** — if upstream merges their N-API wrapper while we're implementing, we may want to consume theirs instead of shipping ours. Mitigation: weekly track of upstream `agentic-flow#15-21`.
- **Aspirational claims failing verification** — possible (e.g., mobility may need network-namespace CI we don't have). Mitigation: ADR-0265 §"Aspirational" already permits `skip-by-policy` for verification methods CI can't run, with explicit deferred-verification documentation.
- **Federation traffic doesn't actually need >100 RPS** — Track D may ship a capability that has no live consumer (shelfware risk). Mitigation: the doctor surface + WS fallback retention mean QUIC is opt-in; no harm if unused. Acceptance criterion C4 verifies both paths work; the user is the one deciding when to flip the env var on.

## Sequencing — updated

- **Track A first** — still 5-minute ledger hygiene; cheap and clears scope before opening fronts
- **Tracks B and D in parallel** — both substantive multi-repo work, both follow ADR-0261's playbook. Different repos and ADRs (ADR-129 P1-3 vs ADR-108/0265 QUIC); minimal collision risk
- **Track C in parallel** — fork-internal, doesn't touch Tracks B/D files
- **D.0 (upstream check) before D.1 (council)** — non-negotiable; might inform whether to consume upstream's wrapper instead of building our own
- **D.2 Phase 1 before D.2 Phase 2** — binary builds need the crate compiled first
- **D.3 + D.4 sequential after D.2 completes** — validation + acceptance audit

No time estimates — risk shape, not duration. Track D is the heaviest substantive work in this plan due to the Rust + N-API + cross-compile layer.

## Cross-references

- [[ADR-0261]] — the precedent pattern (council + revision + amendment + acceptance via harness); Tracks B + D both follow this playbook
- [[ADR-0254]] — upstream-decision contract for ADR-129/130
- [[ADR-0256]] — ADR-129 Phase 4 precedent
- [[ADR-0258]] — persistence-threading design gate (done)
- [[ADR-0259]] — allowlist alignment design gate (done)
- [[ADR-0263]] — archivist replay-verification harness (proposed) — Track C
- [[ADR-0265]] — fork-native QUIC federation transport, upstream ADR-108 implementation (proposed 2026-05-27) — Track D
- [[ADR-0217]] — sibling-scope agentdb-QUIC quarantine; Track D explicitly does NOT extend into ADR-0217's surface
- [[ADR-0186]] — Batch I rollup with WebSocket QUIC fallback hand-port (ledger row 266); Track D's loader builds on this
- Upstream ADR-108 (`ruvnet/ruflo/v3/docs/adr/ADR-108-native-quic-binding.md`) — the source design Track D picks up
- INTEGRATION-LEDGER rows 234 (closed via ADR-0261), 235/237/238 (Track A), 239 (Track B); a new row will land for ADR-108 on Track D ratification
- [[feedback-always-wire-tests-into-cicd]] — Tracks B, C, D must wire their smokes into the canonical harness
- [[reference-acceptance-perf-analyzer]] — use post-implementation to verify new smokes don't introduce PARALLEL-WASTE
- [[feedback-commit-forks-before-release]] — fork commits land before `npm run release`
- [[feedback-no-time-estimates]] — sequencing reasons about risk shape, not duration
- [[feedback-no-hive-ceremony-for-impl]] — Tracks B + D council use parallel Agent fan-out (not hive-mind consensus)
- [[feedback-no-upstream-donate-backs]] — Track D's N-API binding crate stays fork-side; not PR'd upstream
