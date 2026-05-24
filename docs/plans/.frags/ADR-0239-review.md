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
