---
status: proposed
date: 2026-05-08
methodology: [SPARC, MADR]
decision-makers: [Henrik Pettersen]
tags: [agentdb, lift-and-shift, mcp-tool-prefix, plugin-adoption, agentdb-onnx, vendored-decommission]
supersedes: 0160
related: [0078, 0094, 0143, 0147, 0148, 0150, 0157]
---

# ADR-0161: Lift-and-shift agentdb to `forks/agentdb`; decommission vendored copy

## Context and Problem Statement

<!-- SPARC: S — Specification -->

ruvnet extracted agentdb into a standalone repo at https://github.com/ruvnet/agentdb on 2026-05-06 (init `8b3388b` + 6 cleanup commits, **7 total**). The extraction is a clean lift-and-shift from `agentic-flow/packages/agentdb/`. ADR-0160 mirrored it as `forks/agentdb`; this ADR supersedes ADR-0160's "observation-only" framing with the actual migration.

`diff -rq forks/agentic-flow/packages/agentdb/src forks/agentdb/src` (verified 2026-05-08):

| Category | Count | Examples |
|---|---:|---|
| .ts files differing | **59** | `backends/detector.ts` (1-line type-cast removal), `controllers/CausalMemoryGraph.ts`, `cli/agentdb-cli.ts` |
| Fork-only files | **~10** | `GuardedVectorBackend.ts`, `HierarchicalMemory.ts`, `MemoryConsolidation.ts`, `QUIC*.ts`, `StreamingEmbeddingService.ts`, `src/config/`, `src/consensus/` |
| Upstream-only (net-new) | **~10** | `MincutService.ts`, `SparsificationService.ts`, `controllers/attention/*`, `cli/lib/history-tracker.ts`, `cli/lib/report-store.ts` |

Sample diff (`detector.ts`): `(core as any).isNative?.()` → `core.isNative?.()` — one of the 14 trivial files. **The 12 large-diff files are NOT at this scale**: `controllers/AttentionService.ts` has a 1,503-line diff because upstream refactored it (split into `controllers/attention/*` + new `services/AttentionService.ts`); `RuVectorBackend.ts` has 664 lines because upstream added `RuVectorLearning`/`getEmbeddingConfig`/`deriveHNSWParams`. **The lift is real but the per-file work is non-uniform.**

**Commit-replay validation (2026-05-08)**: 191 raw fork-only commits in `packages/agentdb` (post `git fetch upstream`), 117 noise (109 `chore: bump versions to`, 4 `chore(publish): version bumps`, 2 `fork-version`, 1 `chore(preflight)`, 1 `chore(agentdb): Bump version`), **74 substantive** + 1 unique in `packages/agentdb-onnx` (`c702aa6`) + 0 unique in shim = **75 total substantive commits**. BUT `git apply --check` (forward, reverse, `--3way`) fails on 8/8 sample Feb 2026 commits — patches won't replay even with 3-way auto-merge. Conceptual changes ARE in `forks/agentdb` (alpha.13 base contains them); patches don't replay because alpha-version context shifted. Therefore: **the unit of migration work is the file (59 differing + ~10 fork-only ≈ 69 file-level decisions), NOT the commit**. Cognitive workload concentrates on **ADR-0069 (12 commits), ADR-0052 (8), ADR-0090 (5)**, plus ADR-0076 dual-instance, ADR-0078 bridge-elim, ADR-0094 R-series, ADR-0147 R6.

Out-of-source concerns folded in: MCP tool prefix (`mcp__agentic-flow__agentdb_*` → `mcp__agentdb__*`), 6 upstream plugins at `forks/agentdb/plugins/agentdb-{core,memory,search,graph,learning,causal}/`, `agentdb-onnx` sibling (2,039 LoC, 1 external consumer), and Rust adapter at `forks/ruvector/crates/rvf/rvf-adapters/agentdb/` (1,132 LoC).

## Decision Drivers

- **File-level three-way merge, not patch replay.** Validated empirically 2026-05-08: of 75 substantive fork-only commits, 8/8 Feb 2026 sample fail forward/reverse/3-way `git apply --check`. The migration unit is the file (59 differing + ~10 fork-only ≈ 69 decisions), not the commit. Cherry-pick replay was the original ADR mechanic; replaced with three-way merge between upstream alpha.10 base, our fork-side version, and `forks/agentdb` alpha.14.
- **Preserve provenance via per-ADR commits.** Per `feedback-no-history-squash`, multiple agents flagged "one commit covering all 59 files" as squash-pattern. Use one commit per ADR cluster (ADR-0069, ADR-0052, ADR-0090, etc.) so reverts target the right scope.
- **Default to WIRE.** Per `feedback-no-value-judgements-on-features`. Adopt all 6 upstream plugins; preserve all fork-only files; lift onnx to its natural home.
- **User direction 2026-05-08**: no phase-blocking gates; no rollback; no HM consideration; no upstream re-base; tests asserting old MCP prefix updated to assert new (intent preserved per `feedback-no-squelch-tests`).

## Considered Options

<!-- SPARC: P — Pseudocode -->

1. **Stay observation-only** (ADR-0160's original framing). Defeats consolidation; sources diverge further every release.
2. **Lift-and-shift** (RECOMMENDED). Copy fork-only files; reconcile 59 diffs inline; lift onnx; codemod Pass 7; adopt plugins; decommission vendored.
3. **Drop fork patches; consume public npm `agentdb` directly.** Silently loses ~10 fork-only files. Violates `feedback-data-loss-zero-tolerance`.

## Decision Outcome

<!-- SPARC: A — Architecture -->

**Chosen: Option 2.** Single execution checklist; no rigid phase ordering between independent steps.

### Execution checklist

1. **Lift fork-only files** from `forks/agentic-flow/packages/agentdb/src/` into `forks/agentdb/src/`. One commit covering all of them with the source SHA in the message. **Done as commit `d7ca0f6` on `forks/agentdb` main: 20 files / 8,262 insertions, source SHA `75b6e041`.** Follow-up commit needed: per Agent 02, `QUICConnection.ts`, `QUICConnectionPool.ts`, `QUICStreamManager.ts`, and `RaftConsensus.ts` have NO ADR linkage in either ADR namespace, are not imported anywhere, and the CHANGELOG explicitly removed QUIC from advertised features. Add `// TODO: ADR required before activation — ADR-0161 lift, no production wiring` as a top-of-file comment to each, so accidental wiring surfaces in code review.
2. **Reconcile the 59 differing files via file-level three-way merge** (NOT cherry-pick replay). The unit of work is the *file*, not the commit. Empirical validation 2026-05-08: 75 substantive `packages/agentdb` commits exist, but `git apply --check` (forward, reverse, AND `--3way`) all fail on a Feb 2026 sample (8/8 HARD_CONFLICT). The conceptual *changes* from those commits ARE present in `forks/agentdb`'s alpha.13 base; the *patches* won't replay because surrounding-line context shifted across alpha versions. So the mechanic is: for each of the 59 files, three-way merge between (a) the upstream alpha.10 base, (b) our fork-side version in `forks/agentic-flow/packages/agentdb/`, (c) the alpha.14 version in `forks/agentdb/`. Outcome: a `forks/agentdb/src/<f>` that preserves both upstream's alpha.11–14 evolution AND our ADR-driven fork patches (ADR-0056, ADR-0061, ADR-0069 H6/A2/A1, ADR-0076 dual-instance, ADR-0078, ADR-0090 B5, ADR-0094 R-series, ADR-0147 R6). **Per-ADR-cluster commits** (NOT one bulk commit) — preserves provenance per `feedback-no-history-squash`. Diff distribution: 14 files ≤5 lines (mechanical), 19 files 6-20 lines, 14 files 21-100 lines, **12 files 100+ lines** (highest risk; biggest is `controllers/AttentionService.ts` at 1,503 lines — upstream split it into `controllers/attention/{Cache,Config,Core,Helpers,Metrics,WASM}.ts` + new `services/AttentionService.ts`, plus `MincutService.ts`, `SparsificationService.ts` — mechanical "apply ours" would silently destroy this refactor).
3. **Lift `agentdb-onnx`** (four concrete fixes per Agent 05's audit):
   - `cp -r forks/agentic-flow/packages/agentdb-onnx forks/agentdb/packages/agentdb-onnx`.
   - Update `agentdb` entry in **`dependencies`** (NOT `peerDependencies` — the prior ADR wording was wrong) → `@sparkleideas/agentdb`.
   - Rewrite `ONNXEmbeddingService.ts:18` workspace-relative source import (`../../../agentdb/src/config/embedding-config.js`) to import from `@sparkleideas/agentdb` (the embedding-config public surface).
   - Add `"workspaces": ["packages/*"]` to `forks/agentdb/package.json` so the relocated sub-package builds as part of the fork's workspace; otherwise `npm install` and tsc must be run per-package.
4. **Build + test** `forks/agentdb` (including agentdb-onnx). Zero failures.
5. **Bump versions** to `3.0.0-alpha.14-patch.1`. Publish both packages to **Verdaccio** (`localhost:4873` per `reference-verdaccio` — single-developer canonical registry; no public-npm path).
6. **Codemod Pass 8** (NOT Pass 7 — `codemod.mjs:321-353` already defines Pass 7 as `@sparkleideas/cli → @sparkleideas/ruflo` per ADR-0143). Add Pass 8 to `ruflo-patch/scripts/codemod.mjs`: rewrite `mcp__agentic-flow__agentdb_<tool>` → `mcp__agentdb__<tool>` across `.md`, `.json`, `.sh`, `.ts`, `.mjs`, `.cjs`. Runs after Pass 7. Per Agent 06's audit, actual reference count is 23 (not 83) and ALL are in `*.md` documentation — zero in production code — so this is essentially a doc rewrite. Unit-tested at `tests/unit/adr0161-codemod-pass8.test.mjs` (idempotency + extension scoping + non-matching prefix safety).
7. **Bump `forks/ruflo`'s `agentdb` dep** to `3.0.0-alpha.14-patch.1`.
8. **Update `forks/agentic-flow`** consumer dep on `@sparkleideas/agentdb-onnx` (was workspace-relative; now declared as normal npm dep). **Plus**: rewrite the dynamic-import string at `agentic-flow/src/services/agentdb-service.ts:572` from `'../../../packages/agentdb-onnx/src/services/ONNXEmbeddingService.js'` to `'@sparkleideas/agentdb-onnx'`. Same file line 6 imports `embedding-config` from `packages/agentdb/` — switch to `@sparkleideas/agentdb`.
9. **Sanity-check Rust adapter** at `forks/ruvector/crates/rvf/rvf-adapters/agentdb/` (NOT a gate). Per Agent 04's empirical audit: the adapter has **zero TS bindings** — `Cargo.toml` only declares `rvf-runtime`, `rvf-types`, `rvf-index` as deps; no NAPI/FFI/wasm-bindgen/Node bindings. The 19 `agentdb` references in source are all doc-comments + test-fixture filenames. The adapter is a scaffold for a *future* RVF-native agentdb backend (per agentdb's own ADR-003), not a current consumer. The earlier ADR framing as "compatibility hazard" was a category error. Run `cargo test -p rvf-adapter-agentdb` as a sanity check; expected green pre/post; **0 LoC fix expected**.
10. **Adopt 6 upstream plugins** via existing plugin-install workflow. Rename ours with `ruflo-` prefix ONLY on observed name collision. No pre-emptive renaming.
11. **Flip `ruflo-patch` config + extend pipeline for 5th fork**: `package-map.json:77` upstream pointer → `ruvnet/agentdb`; `published-versions.json` updates; `package-checksums.json` regen. **Plus** (per Agent 08's pipeline audit — ~10 hidden 4-fork-hardcoded sites): add agentdb entry to `config/upstream-branches.json`; extend `lib/fork-paths.sh:50-51,77-82` (`SHORT` map + `_FORK_HEAD_PREFIX`); declare `NEW_AGENTDB_HEAD` / `UPSTREAM_AGENTDB_SHA` in `lib/pipeline-state.sh:13-25`; add 5th rsync block + status loop to `scripts/copy-source.sh:87,120-128,131,147`; add `agentdb_head` field in `scripts/ruflo-publish.sh:341-343` + `lib/pipeline-helpers.sh:43-55`; bump 5→6 IFS fields in `scripts/ruflo-sync.sh:340-351`. Codemod's existing `UNSCOPED_MAP` already covers the rename; no codemod change for the lift itself (Pass 8 adds the MCP-prefix rewrite per step 6).
12. **Acceptance suite + init-project smoke**. Zero regressions per `feedback-fix-all-tests`. Project is single-developer Verdaccio-only — no public-npm gate.
13. **Delete vendored**: `rm -rf forks/agentic-flow/packages/agentdb/` and `packages/agentdb-onnx/`. Update workspace manifest. **Shim cleanup**: in `forks/agentic-flow/agentic-flow/src/agentdb/` (the "Now proxies to agentdb npm package" backwards-compat shim) — if any internal consumer still imports from it, simplify to match alpha.14 export shape; if nothing internal still imports it, delete entirely. Final manifest sweep on `mcp-surface-manifest.json` (only `mcp__agentdb__*` remains). Final regression. (Recovery from this step is `git revert` + republish to Verdaccio — no immutable public artifact to deal with.)
14. **Supersede ADR-0160**: status `proposed` → `superseded by 0161`; append `### Implementation log` to ADR-0160. Update memory entries `project-agentdb-parallel-extraction.md` (parallel state ENDED) and `reference-fork-workflow.md` (5 forks).

### Explicit non-goals

`@ruvector/graph-transformer` upgrade; public npm `agentdb` keyword squatting (codemod Pass 2 is the defense); `forks/ruv-FANN` agentdb skill markdown; HM consideration (per user direction); upstream re-base; rollback plan.

<!-- SPARC: R — Refinement -->

### Consequences

- **Good** — single canonical agentdb source, MCP prefix, plugin set, onnx home; ~110K LoC removed from `forks/agentic-flow`.
- **Good** — fork-only files preserved with provenance via commits.
- **Bad** — codemod Pass 7 is new code; mitigated by unit test covering idempotency, extension scoping, and non-matching-prefix safety.
- **Neutral** — agentdb-onnx external consumer (`agentic-flow/services/agentdb-service.ts`) imports via npm name; only its dep declaration changes.

<!-- SPARC: C — Completion -->

### Confirmation

1. **`forks/agentdb`** has the migration commits and builds + tests pass; `forks/agentdb/packages/agentdb-onnx/` exists.
2. **Verdaccio** (`localhost:4873`) serves `@sparkleideas/agentdb@3.0.0-alpha.14-patch.<N>` and `@sparkleideas/agentdb-onnx@<N>`. Single-developer scope; no public-npm publish.
3. **`forks/agentic-flow/packages/agentdb/` and `packages/agentdb-onnx/`** do NOT exist.
4. **MCP prefix migrated**: `grep -rn "mcp__agentic-flow__agentdb_" ruflo-patch/ forks/ruflo/` returns ZERO matches outside historical artifacts (ADR text). Codemod Pass 7 + its unit test exist.
5. **Acceptance suite + init-project smoke pass** at no regression. ADR-0160 status updated; memory entries updated.
6. **Regression test** `tests/unit/adr0161-agentdb-consolidation-complete.test.mjs` exists and asserts: (a) `forks/agentdb` exists, (b) `forks/agentic-flow/packages/agentdb` does NOT exist, (c) `forks/agentdb/packages/agentdb-onnx` exists, (d) `config/package-map.json` declares `ruvnet/agentdb` upstream, (e) zero `mcp__agentic-flow__agentdb_` references in non-historical files, (f) published `@sparkleideas/agentdb` version starts with `3.0.0-alpha.14-`. This test guards against silent revert (e.g. accidental restore from a stale branch merge) per `feedback-data-loss-zero-tolerance`.
7. **Behavioral preservation** (per Agent 10's data-loss audit — counters the structural-only nature of criteria 1-6):
   - (a) `npx @sparkleideas/cli init` in a fresh temp project successfully creates an agentdb backend that survives a write-read-restart cycle (load-bearing behavior of the fork-only files: `HierarchicalMemory`, `MemoryConsolidation`, `StreamingEmbeddingService`, security guards).
   - (b) `mcp__agentdb__pattern_store` + `mcp__agentdb__pattern_search` round-trip from the new MCP server returns scored results; cross-checked against pre-migration baseline behavior.
   - (c) ADR-0076 dual-instance singleton guard in `CausalMemoryGraph.ts` is preserved post-merge (test: construct twice; second should warn + return first instance).
   - (d) ADR-0094 R-series memory_search returns >0 for verbatim-token queries against a populated namespace (the bug ADR-0147 fixed must stay fixed post-merge).
8. **QUIC / RaftConsensus guards present**: `grep -rE "// TODO: ADR required before activation" forks/agentdb/src/controllers/QUIC*.ts forks/agentdb/src/consensus/RaftConsensus.ts` returns 4 matches.

## Pros and Cons of the Options

- **Option 1** (observation-only): zero disruption, but defeats consolidation.
- **Option 2** (lift-and-shift, CHOSEN): mechanical scope matches the actual delta; provenance via commits.
- **Option 3** (drop patches): silently loses fork-only files; violates `feedback-data-loss-zero-tolerance`.

## More Information

### User direction (2026-05-08)

Accept alpha.14 base. Fold MCP prefix + 6 plugins + agentdb-onnx into this ADR. No phase-blocking gates. No rollback plan. No HM consideration. No upstream re-base if it advances during migration. Migration is lift-and-shift, not re-base.

### References

- ADR-0160 (superseded): observation-only fifth fork
- ADR-0157: MADR + SPARC template
- ADR-0078, ADR-0094, ADR-0147: drove the fork-only files preserved here
- ADR-0148, ADR-0150: sibling pattern for MCP audit + NAPI build
- ADR-0143: codemod context for Pass 7
- New fork: `forks/agentdb` (cloned 2026-05-08 from `ruvnet/agentdb` HEAD `a478ab3`); MCP server `name: 'agentdb'` at `src/mcp/agentdb-mcp-server.ts:282`
- **Migration log**: `forks/agentdb/MIGRATION-LOG.md` — file-level disposition table for the lift (20 fork-only files in Step 1 commit `d7ca0f6`; 59 differing-file reconciliations in Step 2). Restored 2026-05-13 after the ADR-0177 reset removed it; see [[project-fork-only-controllers]] memory for the full restoration catalog.
- Memory: `feedback-data-loss-zero-tolerance`, `feedback-no-history-squash`, `feedback-trunk-only-fork-development`, `feedback-never-touch-hz-remote`, `feedback-no-value-judgements-on-features`, `feedback-fix-all-tests`, `feedback-no-squelch-tests`, `feedback-test-in-init-projects`, `reference-pipeline-publish-paths`, `reference-verdaccio`, `project-agentdb-parallel-extraction`, `reference-fork-workflow`
