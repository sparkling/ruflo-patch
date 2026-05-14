# Batches C+D — Memory + ADR features — agent analysis (2026-05-09)

Source: ADR-0162 Batches C and D. Produced by general-purpose research agent against `forks/ruflo` `main`. READ-ONLY analysis.

**Critical finding:** at HEAD, `v3/@claude-flow/cli/src/memory/memory-bridge.ts` does NOT exist (relocated by ADR-0161). And `agentdb-tools.ts` DOES exist but is heavily diverged. This means **`d031c3d13` is a HIGH-CONFLICT cherry-pick.**

## Memory / embeddings batch

| Commit | Files (key) | Conflict-risk | Verdict |
|---|---|---|---|
| `4f2f68d52` | `v3/@claude-flow/embeddings/{src/neural-integration.ts, package.json}` (alpha.13) | Low — graceful fallback | **APPLY** |
| `bd55cd7cb` | `v3/@claude-flow/cli/src/memory/memory-bridge.ts` post-init parallelize | **HIGH — `memory-bridge.ts` does NOT exist at our HEAD** | **APPLY-WITH-PORT** (replay perf change at the new agentdb-bridge location) |
| `53409aba5` | `v3/@claude-flow/embeddings/src/neural-integration.ts` (alpha.14) | Low | **APPLY** |
| `21f668c55` | `v3/@claude-flow/embeddings/src/transformers-loader.ts` (NEW), `embedding-service.ts:387`, `cli/src/memory/memory-initializer.ts:1539`, `embeddings/package.json`, `v3/docs/adr/ADR-095-architectural-gaps-from-april-audit.md` | NO scope conflict with our ADR-0094 | **APPLY** |
| `c32ddead2` | `v3/docs/adr/ADR-094-...md` (plan-only, superseded by 21f668c55) | Doc-only obsolete plan | **SKIP** |
| `6b46946dc` | `v3/@claude-flow/cli/.claude/helpers/intelligence.cjs` (G6 dedupe + trigram cache hoist) | Low | **APPLY** |
| `ea8cbf697` | `v3/@claude-flow/embeddings/src/neural-integration.ts` (alpha.16, Windows) | Low — extends alpha.14 regex | **APPLY** (after `53409aba5`) |
| `122193a45` | `v3/@claude-flow/cli/src/commands/memory.ts` stats provider section | Low | **APPLY** |
| `3eb6b4d65` | `v3/@claude-flow/cli/src/commands/memory.ts` `memory_import_claude` SHA-256 dedupe | Low | **APPLY** |
| `0377945c9` | `v3/@claude-flow/cli/src/commands/memory.ts` + `memory-initializer.ts` (idempotent `init`) | Low — additive `alreadyExists` flag | **APPLY** (note: our `cfb0cea02` already touched `memory init --force` per ADR-0156 — minor manual reconcile possible) |
| `d031c3d13` | `v3/@claude-flow/cli/src/mcp-tools/agentdb-tools.ts` (+1700/-1488), `v3/@claude-flow/cli/src/memory/memory-bridge.ts` (+2370 NEW), `package.json`, `pnpm-lock.yaml` | **HIGH — memory-bridge.ts not at HEAD; agentdb-tools.ts heavily diverged from ADR-0161 step 7** | **APPLY-WITH-PORT** |
| `d6936bae3` | `v3/@claude-flow/memory/package.json` (alpha.15) | Low | **APPLY** |
| `3e8781bd2` | `.github/workflows/...` CI smoke for #1867 | Low — additive | **APPLY** |
| `966335022` | `v3/@claude-flow/memory/{package.json, src/sqlite-backend.ts}` — bsqlite type-only static + opt-dep, ^12.9.0 | **MEDIUM** — our ADR-0086/Debt-7 already moved bsqlite to optionalDependencies | **APPLY** (verify ADR-0086 invariant "no dist file imports both bsqlite+sqljs") |

### ADR-0094 + ADR-0161 conflict verification

- **Our ADR-0094** = "100% acceptance test coverage plan" (Closed 2026-04-21). Scope: `ruflo-patch/lib/acceptance-*.sh`, surface manifest. **No code overlap** with upstream's ADR-094 (transformers migration touching `v3/@claude-flow/embeddings`).
- Skipping `c32ddead2` is **confirmed correct** (docs-only, superseded by `21f668c55`).
- Applying `21f668c55` is **safe code-wise** — the only collision is the doc filename `v3/docs/adr/ADR-095-architectural-gaps...md`. We don't have an `ADR-095` of our own (our 0095 is `RVF inter-process convergence`); however we'd be importing an *upstream* ADR doc into `v3/docs/adr/` which is a separate namespace from our `docs/adr/`. **This is fine** — `v3/docs/adr/` is upstream's directory.

## ADR series briefs

### ADR-101 (Federated Claims) — `9d4a9ea96`, `3ba0b6141`, `779eb309b`

- **Files:** new in `v3/@claude-flow/claims/src/infrastructure/`: `hlc.ts`, `vector-clock.ts`, `federation-bridge.ts`, `federated-event-store.ts`, `federated-claim-repository.ts`, `index.ts`. Edits to `claims/src/application/work-stealing-service.ts`. New tests. Edit to `plugin-agent-federation/src/{domain/entities/federation-envelope.ts, application/policy-engine.ts}`. New `v3/docs/adr/ADR-101-federated-claims.md`. Witness manifest entry.
- **Fork conflicts:** `git log --grep="ADR-101"` returns ZERO entries on our `main`. No competing implementation.
- **NOTE:** the merge `9d4a9ea96` is a **squash of three precursor commits** (`1f826fb9b` Phase 1, `edc39f7da` Phase 2, `cc6af4b77` Phase 3). Inventory listed only the merge SHA; cleanest is to cherry-pick **just `9d4a9ea96`** (single squashed commit) NOT also the precursors — otherwise you'd double-apply.
- **Recommendation:** apply all 3 in order: `9d4a9ea96` (squash) → `3ba0b6141` (CLAIMS_FOR_MESSAGE_TYPE — exhaustiveness build break fix) → `779eb309b` (witness register).

### ADR-096 (Encryption-at-rest) — `e6478f9ab`, `cb9a9f346`, `98aa2560e`, `49c8019ed`, `841365f64`, `bbb90046e`, `ccf58ea4d`

- **Files:** `v3/docs/adr/ADR-096-...md` (design + accept), `v3/@claude-flow/cli/src/encryption/vault.ts` (NEW), `cli/src/fs-secure.ts` (extended), `cli/src/mcp-tools/{session-tools.ts, terminal-tools.ts}`, `cli/src/memory/memory-initializer.ts` (9 read sites + 7 write sites), `cli/src/commands/doctor.ts`. Tests under `cli/__tests__/{encryption-vault, session-encryption, terminal-encryption, memory-db-encryption, doctor-encryption}.test.ts`.
- **Fork conflicts:** `git log --grep="ADR-096"` returns ZERO. **Caveat:** `memory-initializer.ts` was touched by our `cfb0cea02` (`memory init --force` per ADR-0156). Phase 4 (`841365f64`) edits the same file — manual reconcile likely on the 16 read/write sites.
- **Recommendation:** apply linearly — design `e6478f9ab` → P1 `cb9a9f346` → P2 `98aa2560e` → P3 `49c8019ed` → P4 `841365f64` → ADR-accept `bbb90046e` → P5 doctor `ccf58ea4d`. **Phase ordering is REQUIRED** — Phase 2 imports `vault.ts` from Phase 1; reverting to a single squash range loses the per-phase test-suite checkpoints.

### ADR-097 (Federation budget) — `62a6fc5fb`, `7e1cc06df`, `149ea30a4`

- **Files:** `v3/docs/adr/ADR-097-...md` (design), new `plugin-agent-federation/src/domain/value-objects/federation-budget.ts`, edits to `application/federation-coordinator.ts` and `mcp-tools.ts` (federation_send schema). Plugin docs at `plugins/ruflo-federation/{plugin.json, README.md, commands/federation.md, agents/federation-coordinator.md}`.
- **Fork conflicts:** none.
- **Recommendation:** apply `62a6fc5fb` → `7e1cc06df` → `149ea30a4` in order. Phase 2 (peer state machine) and Phase 3+ (cost-tracker, doctor) **NOT in this batch** — design ADR + Phase 1 + plugin docs only.

## Cross-batch dependencies + final ordering

**Dependency graph:**
- ADR-096 phases are sequential (P1 publishes `vault.ts`; P2/P3/P4 import).
- ADR-097 is independent of memory/embeddings.
- ADR-101 is independent of memory/embeddings, BUT touches `plugin-agent-federation` like ADR-097 P3-doc — order ADR-097 then ADR-101.
- `bd55cd7cb` (parallelize post-init) operates on `memory-bridge.ts` referenced by `841365f64` (ADR-096 P4). Apply memory batch FIRST so post-extraction port stabilises before encryption wiring.
- `21f668c55` (transformers-loader) touches `memory-initializer.ts:1539`. ADR-096 P4 (`841365f64`) also touches it. Apply transformers FIRST so encryption sees the loader pattern.
- `0377945c9` (idempotent init) touches `memory-initializer.ts` again. Order: 21f668c55 → 0377945c9 → 841365f64.
- `122193a45` adds embedding stats to `memory.ts`. Pairs with `21f668c55`. Order: 21f668c55 → 122193a45.

### Final recommended ordering (24 commits — 2 skipped)

```
1.  4f2f68d52 — embeddings@alpha.13 graceful fallback
2.  53409aba5 — embeddings@alpha.14 shape change
3.  ea8cbf697 — embeddings@alpha.16 Windows export
4.  21f668c55 — transformers-loader (ADR-094 transformers migration)
[SKIP c32ddead2 — docs-only obsolete plan]
5.  bd55cd7cb — memory-bridge post-init parallelize (PORT to post-extraction location)
6.  6b46946dc — intelligence G6 dedup + trigram hoist
7.  122193a45 — `memory stats` shows embedding provider + HNSW
8.  3eb6b4d65 — content-hash dedupe in memory_import_claude
9.  0377945c9 — idempotent memory init
10. d031c3d13 — agentdb 3 delete MCP tools (PORT to post-extraction agentdb seam)
11. 966335022 — bsqlite optional + ^12.9.0 (Node 26 unblock)
12. d6936bae3 — memory@alpha.15 version anchor
13. 3e8781bd2 — CI no-bsqlite smoke
14. e6478f9ab — ADR-096 design doc
15. cb9a9f346 — ADR-096 P1 vault primitives
16. 98aa2560e — ADR-096 P2 session-tools
17. 49c8019ed — ADR-096 P3 terminal-tools
18. 841365f64 — ADR-096 P4 memory DB encryption
19. bbb90046e — ADR-096 status flip
20. ccf58ea4d — ADR-096 P5 doctor section
21. 62a6fc5fb — ADR-097 design doc
22. 7e1cc06df — ADR-097 P1 budget envelope
23. 149ea30a4 — ADR-097 plugin docs
24. 9d4a9ea96 — ADR-101 squash (Phases 1–3) — NOT also pick precursors
25. 3ba0b6141 — ADR-101 build-break fix (CLAIMS_FOR_MESSAGE_TYPE)
26. 779eb309b — ADR-101 witness register
```

## Risks

- **R1 — `memory-bridge.ts` deleted by ADR-0161.** `bd55cd7cb` and `d031c3d13` will both fail clean cherry-pick. Plan for hand-port to the post-extraction agentdb seam (`forks/agentdb/...` per ADR-0161 step 7).
- **R2 — `memory-initializer.ts` re-touched by `cfb0cea02`** (ADR-0156). Expect 3-way merge on commits #4 (`21f668c55`), #9 (`0377945c9`), #18 (`841365f64`).
- **R3 — `21f668c55` ADR doc filename.** Upstream lands `v3/docs/adr/ADR-095-architectural-gaps-from-april-audit.md`. Our `docs/adr/ADR-0095` is RVF inter-process convergence (different directory + zero-padding scheme). Verify both directories' `ADR-095/0095` co-exist without shadowing.
- **R4 — `9d4a9ea96` is a 3-phase squash.** If inventory ever swaps to listing the 3 precursors, ONLY pick those — never both squash AND precursors.
- **R5 — bsqlite churn (`966335022`)** reopens ADR-0086 Debt-7. Verify post-cherry-pick that "no dist file imports both bsqlite + sqljs" still holds.
- **R6 — Encryption gate (`CLAUDE_FLOW_ENCRYPT_AT_REST`) is opt-in default-off.** Acceptance baseline should not regress — but ADR-0094 acceptance suite needs verification with gate=on once landed; not blocking.
- **R7 — RVF interaction.** ADR-096 P4 wires encryption through `memory-initializer.ts`. If our `project-rvf-primary.md` directive routes `memory init` through RVF, the wiring may be inert. Verify against current init flow before P4 cherry-pick.

## Verification commands per ADR series

```bash
# Memory/embeddings batch
cd /Users/henrik/source/forks/ruflo
cd v3/@claude-flow/embeddings && npm run build && npm test
cd ../memory && npm run build && npm test
cd ../cli && npm run build && npm test -- --testPathPattern="memory|embeddings|agentdb-delete-tools"

# ADR-096
cd v3/@claude-flow/cli
npm test -- --testPathPattern="(encryption-vault|session-encryption|terminal-encryption|memory-db-encryption|doctor-encryption)"
CLAUDE_FLOW_ENCRYPT_AT_REST=1 CLAUDE_FLOW_ENCRYPTION_KEY=$(openssl rand -hex 32) ./bin/ruflo doctor -c encryption

# ADR-097
cd v3/@claude-flow/plugin-agent-federation
npm run build && npm test -- --testPathPattern="(federation-budget|federation-coordinator)"

# ADR-101
cd v3/@claude-flow/claims
npm run build && npm test  # expects 203/203
cd ../plugin-agent-federation
npm test -- --testPathPattern="federation-envelope"  # expects 373/373

# Cross-cutting integrity
cd v3 && npm run build  # expects 23/23 packages clean
bash /Users/henrik/source/ruflo-patch/test-acceptance-fast.sh
```
