---
status: proposed
date: 2026-05-24
tags: [dead-code, parallel-implementations, fork-cleanup, lint-gate, cve, embedding, mcp, audit-followup]
supersedes: []
depends-on: [0201, 0222, 0233]
implements: []
---

# Per-cluster dead-code triage and parallel-implementation collapse

> Drafted from [[ADR-0233]] §CT-F (whole-tree dead-code scan, slice 11) — **~57 200 LOC unique TS source dead** across `forks/ruflo`, `forks/agentdb`, `forks/ruvector`, excluding the documented `archive/` (418 K LOC).
> CT-F is heterogeneous: every cluster needs a separate delete-vs-wire-vs-merge call. A blanket sweep would orphan published plugins (gastown-bridge, agentic-qe), discard CVE-mitigated code (the dead embedding stack's `transformers-loader.ts`), and worsen upstream-merge tax. This ADR proposes per-cluster decisions plus a lint gate so the next 5 K-LOC accretion is caught at PR time.

## Context

The May-19 audit's §E item 1 was a hint ("whole-tree dead-code scan would surface more"). Slice 11 of the second-pass audit (`docs/audits/2026-05-24-second-pass-audit/11-dead-code-scan.md`) tallied **23 findings** across the 3 in-scope forks:

* **4 CRITICAL** — `v3/@claude-flow/testing/` (16 566), `v3/mcp/` (5 587), `v3/src/` DDD scaffold (3 612), `forks/ruvector/npm/packages/*` (~10 077 across 11 packages).
* **6 HIGH** — `agentdb/src/wrappers/` (3 639), `v3/plugins/cognitive-kernel/` (2 803), `v3/plugins/ruvector-upstream/` (2 455), 10 catalog-only `v3/plugins/*` (~45 000 with `gastown-bridge` 20 254 and `agentic-qe` 17 036 the largest), `agentdb/src/search/` (1 092), `agentdb/src/compatibility/` (958), `agentdb/src/observability/` (773).
* **9 MEDIUM + 4 LOW** — `cli/src/appliance/` (2 841, dynamic-only), `cli/src/production/` (1 783, barrel re-export), `cli/src/benchmarks/` (546), `cli/src/runtime/headless.ts` (402), `v3/agents/*.yaml` (≈50), `cli/src/encryption/` (192), various single-file orphans.

The dominant pattern is **parallel implementation**: every dead surface is shaped like a live one it duplicates. The May-19 audit named one parallel pair; this scan surfaces **6 more pairs** and **5 wholly-dead trees** (slice 11 table at line 232). For every pair, the dead surface is more discoverable (top-level path, broader public API) than the live one — new maintainers and agents reach the dead surface first. The slice 03 (`v3/src/`) scaffold even uses literally forbidden tokens (`HybridBackend`, `SqlJsBackend`) that trip acceptance gates per `[[feedback-forbidden-substring-tests-grep-dist]]`.

One pair carries a CVE consequence (slice 08, F-08-002): the dead `@claude-flow/embeddings/embedding-service.ts` stack contains `transformers-loader.ts` — the [[ADR-0094]] CVE-mitigated loader that prefers `@huggingface/transformers` over `@xenova/transformers` to clear the protobufjs <7.5.5 RCE chain. The **live** path (`@claude-flow/memory/embedding-pipeline.ts:149`) hardcodes `import('@xenova/transformers')` and bypasses the loader entirely. **Deleting the dead stack without first moving the CVE-mitigated loader code into the live path would regress the CVE posture.**

Two clusters represent **published-to-npm plugins** (`gastown-bridge` `0.1.3-patch.822`, `agentic-qe` listed in featured/trending/official/newest in `discovery.ts`). The 20 K + 17 K LOC sources are the upstream of those published artifacts. Deletion here orphans the published artifacts — distinct from `v3/@claude-flow/testing/` where nothing is published (it's a workspace package whose `dist` would be a tombstone).

CT-F is not a single decision; it is **17 separate cluster decisions** (compressed into 7 categories below), each requiring its own delete-vs-wire-vs-merge call.

## Pre-flight verification (per [[ADR-0201]] checklist, all four checks applied)

1. **Signal reaches its audience** — for the **lint gate** half of the proposal, the audience is the release-gate CI job that runs `npm run release`. An ESLint `no-unused-exports` rule installed in `eslint.config.js` would emit warnings, but the release script (`scripts/ruflo-publish.sh`) does not currently run `npm run lint` as a blocking step — verified at the pipeline-script level. The gate must be a **discrete acceptance-tier check** invoked by `_run_and_kill` (per `[[reference-acceptance-runcheck-vs-collect]]`, both `run_check_bg` + `collect_parallel` must register it) OR a build-step error, not a lint warning. Without that wiring the gate would not reach its audience.
2. **Upstream hasn't already decided it** — `ls /Users/henrik/source/ruvnet/ruflo/v3/{mcp,src}/`, `.../v3/@claude-flow/testing/`, and `.../v3/plugins/` confirms upstream ships **all five dead trees** (`v3/mcp/`, `v3/src/`, `@claude-flow/testing/`, all 15 `v3/plugins/*` including gastown-bridge + agentic-qe + cognitive-kernel + ruvector-upstream). Deletion in the fork **opens a permanent fork-vs-upstream divergence** for every future sync — same shape as [[ADR-0222]]'s amendment, which now requires `--ours` on `services/federated-learning.ts` for every merge. The merge-tax must be accepted explicitly per cluster (and recorded in [[INTEGRATION-LEDGER]]).
3. **Premise/inventory is true at runtime** — re-derived all 5 CRITICAL inbound counts on 2026-05-24:
   * `grep -rn "from '.*v3/mcp/\|require.*v3/mcp/" forks/ --include='*.ts' --include='*.mjs' --include='*.cjs' --include='*.js' | grep -v node_modules | grep -v dist | grep -v "/v3/mcp/" | grep -v test` → **0 hits**.
   * `grep -rn "from '@claude-flow/testing\|from \"@claude-flow/testing" forks/ ... | grep -v node_modules | grep -v dist` → **2 self-doc JSDoc hits** in the package itself (`index.ts:14`, `v2-compat/index.ts:18`). 0 real consumers.
   * `grep -rn "from '.*v3/src/" forks/ ... | grep -v node_modules | grep -v dist | grep -v archive | grep -v "/v3/src/"` → **0 hits** (1 test-only consumer at `v3/__tests__/integration/mcp-integration.test.ts:2`).
   * `forks/agentdb/src/wrappers/embedding-service.ts` inbound: 0 (one test imports a sibling `wrappers/attention-fallbacks.js`, not embedding-service).
   * `find forks/ruflo/v3/@claude-flow/embeddings/src -name "transformers-loader*"` → file exists in the dead stack. `grep -n "@xenova/transformers" forks/ruflo/v3/@claude-flow/memory/src/embedding-pipeline.ts` → line 149 hardcodes the unwrapped import. CVE bypass confirmed.
4. **No sibling-ADR overlap** —
   * [[ADR-0222]] shipped on a single dead service file (`forks/agentdb/src/services/federated-learning.ts`, 436 LOC) on the same delete-the-dead-package shape. **No path collision** with this ADR — ADR-0222 targeted `services/`; CT-F targets `wrappers/`, `compatibility/`, `observability/`, `search/`, `v3/{mcp,src,plugins,agents,@claude-flow/testing}/`, and the unconsumed `forks/ruvector/npm/packages/*` set.
   * [[ADR-0233]] §CT-A triage owns the *fail-loud-on-silent-fallback* fix for `embedding-pipeline._doInitialize` and `learning-service.mjs`. This ADR's embedding-stack work is narrower: **move the CVE-mitigated `transformers-loader.ts` code from the dead stack into the live path BEFORE deleting the dead stack**. The fail-loud rework is CT-A; this ADR only owns the physical-deletion + CVE-loader-relocation step. Coordination point: CT-A's fix should ride the relocated loader.
   * [[ADR-0220]] (learning controllers honesty pass) touches `controllers/EmbeddingService.ts` (live) but does not own the parallel `wrappers/embedding-service.ts` (dead). No overlap.
   * [[ADR-0210]] (stub-honesty mandate) governs "wire OR remove" for slices E/CT-E. CT-F is **strict delete-or-publish**; the catalog-listed-but-unimplemented plugins are a CT-E concern (`v3/plugins/*` exposed via `discovery.ts` but the runtime has no plugin host that loads them per F-09-005). Decisions here that overlap CT-E (e.g. `cognitive-kernel` is not even catalog-listed → strict delete, no CT-E ambiguity) are flagged in the per-cluster table.
   * [[ADR-0215]]'s golden-master pattern is the precedent for the lint-gate proposal: an automated detector that joins the release gate rather than a one-shot audit.

All four checks pass. Two carry-overs to record per cluster: (a) merge-tax per [[INTEGRATION-LEDGER]] for every deletion overlapping with upstream; (b) CT-A coordination on the embedding-stack work.

## Considered options

* **Option A — Per-cluster decision with explicit delete-vs-wire-vs-merge call (chosen).** 7 cluster decisions in the table below, each independently actionable. Includes the prerequisite CVE-loader relocation for the embedding-stack cluster. Adds an `acceptance/no-new-dead-code` release-gate check (the lint-gate half) so the next 5 K-LOC accretion is caught at PR time. Each delete carries an [[INTEGRATION-LEDGER]] row and a fork arch-test (per the [[ADR-0222]] amendment shape).
* **Option B — Blanket "delete everything dead" sweep.** Rejected: would silently orphan the two published plugins (gastown-bridge `0.1.3-patch.822` + agentic-qe in featured/trending/official/newest), discard the CVE-mitigated `transformers-loader.ts` (F-08-002 worsens), and skip the (small) wire-vs-delete call on `cli/src/appliance/` (dynamic-only-live, F-11-014). One-decision-fits-all does not match CT-F's heterogeneity.
* **Option C — Add `no-unused-exports` lint to the release gate; defer per-cluster decision until next sweep.** Rejected as standalone: a lint gate without the per-cluster cleanup just freezes today's ~57 K LOC in place (the gate would only catch *new* dead code, since existing dead code is grandfathered). Adopted as **part of Option A** — gate + cleanup together.
* **Option D — Status quo + [[ADR-0215]]-style golden-master for new dead-code accretion.** Rejected as standalone: a golden-master records today's dead-LOC count and fails on growth. Doesn't address the existing 57 K LOC or the CVE-loader trap. Same gating effect as C but more brittle (the count fluctuates with refactors). Sub-component (a counter capped at today's value) is retained inside Option A's gate as a defence-in-depth detector.

## Decision

**Chosen: Option A — per-cluster triage with explicit delete-vs-wire-vs-merge per cluster, plus a `acceptance/no-new-dead-code` release-gate check.**

Decisions by cluster:

### Per-cluster triage table

| # | Cluster | LOC | Decision | Rationale | Cross-bonus (CT-G/CT-J) |
|---|---------|----:|----------|-----------|-------------------------|
| 1 | `v3/@claude-flow/testing/` whole package (F-11-002) | 16 566 | **DELETE** (workspace package + tsconfig project reference + lockfile entry + `cli/src/update/checker.ts` severity list entry) | 0 consumers; `dist` would be a tombstone; drags 16 K LOC into project-references on every build | — |
| 2 | `v3/mcp/` server + transport tree (F-11-001) | 5 587 | **DELETE** (whole `forks/ruflo/v3/mcp/` directory) | 0 inbound, parallel to live `cli/src/mcp-server.ts`; transport sub-tree is a divergent scaffold | **F-10-002 (CT-J) timers evaporate**; **F-05-001 (CT-G) `server-entry.ts:140-162` stdout-corruption MCP envelope leak + PII leak evaporates** |
| 3 | `v3/src/` parallel DDD scaffold (F-11-003) | 3 612 | **DELETE** (whole `forks/ruflo/v3/src/` directory + 1 test in `v3/__tests__/integration/mcp-integration.test.ts`) | 13 re-exported classes; 1 test only; literal forbidden tokens (`HybridBackend`/`SqlJsBackend`) trip [[feedback-forbidden-substring-tests-grep-dist]]; F-11-001's deletion makes the test moot anyway | — |
| 4 | Embedding-stack consolidation (F-11-007, F-08-002, F-08-011, F-11-009, F-11-010, F-11-008) | ~6 462 (`wrappers/` 3 639 + `compatibility/` 958 + `observability/` 773 + `search/` 1 092) plus the ~4 470-LOC `@claude-flow/embeddings/` dead package | **MERGE-THEN-DELETE**: (a) move `transformers-loader.ts` (CVE-mitigated, [[ADR-0094]]) from `@claude-flow/embeddings/src/` into `@claude-flow/memory/src/` and rewrite `embedding-pipeline.ts:149` to call it; (b) absorb `chunking.ts` (353 LOC) + `hyperbolic.ts` (458 LOC) into `@claude-flow/memory` since they are the only two pieces used outside the dead barrel; (c) then DELETE `@claude-flow/embeddings/` package, `agentdb/src/wrappers/`, `agentdb/src/compatibility/`, `agentdb/src/observability/`, `agentdb/src/search/` | CVE protection must land in the live path before deletion; parallel `EmbeddingService` (controllers vs wrappers) is the F-11-007 footgun for new contributors; V1→V2 compat shim has 0 v1 callsites | Coordinates with CT-A (F-08-002 fail-loud rework rides the relocated loader) |
| 5 | Catalog-only `v3/plugins/*` — split by published-or-not (F-11-005, F-11-006, F-11-011) | ~50 000 total | **SPLIT DECISION**: (a) **DELETE** `cognitive-kernel/` (2 803, not even catalog-listed) and `ruvector-upstream/` (2 455, comment-placeholder only); (b) **DEFER + flag for CT-E** on the 10 catalog-listed plugins (`gastown-bridge` 20 254, `agentic-qe` 17 036, `prime-radiant`, `legal-contracts`, `quantum-optimizer`, `healthcare-clinical`, `financial-risk`, `hyperbolic-reasoning`, `neural-coordination`, `perf-optimizer`, `test-intelligence`, `code-intelligence`). These two `gastown-bridge` + `agentic-qe` ship as published plugins (`0.1.3-patch.822` in `forks/ruflo/package.json:68`, `cli/package.json:113`, `cli/scripts/publish-registry.ts:195`, `discovery.ts` featured/trending/official lists). Deletion would orphan published artifacts — distinct from clusters 1-3 | Catalog-listed-but-unimplemented is a CT-E (surface-without-enforcement) concern per [[ADR-0210]]: wire OR remove. This ADR delegates to a sibling CT-E ADR per [[ADR-0233]] triage priority #5 | — |
| 6 | `forks/ruvector/npm/packages/*` unconsumed (F-11-004) | ~10 077 | **DEFER + flag for ruvector-fork audit** | 11 packages, 5 with `bin` entries → "library-published, no in-tree consumer" (bin scripts could be exercised by downstream `npm install` users). Decision is a separate ruvector-fork audit — out of CT-F's `forks/ruflo` + `forks/agentdb` primary scope per slice 11 §Out-of-scope. The lint gate (below) at least flags new accretion in `forks/ruvector/npm/` going forward | — |
| 7 | Single-file / smaller orphans (F-11-012 to F-11-022) | ~5 200 | **PER-FINDING DECISION**: **DELETE** `cli/src/runtime/headless.ts` (F-11-012, 402 LOC — orphan published script, misleading docstring); **DELETE** `cli/src/benchmarks/pretrain` (F-11-013, 546 LOC); **WIRE OR DELETE** `cli/src/appliance/` (F-11-014, 2 841 LOC — dynamic-only-live; the `npm install @claude-flow/appliance` hint is misleading because the modules ship in the same `dist`) — fix the hint OR delete + ship as separate package; **DELETE** `v3/agents/*.yaml` (F-11-015, ≈50 LOC — `archive/agents-root/` is already the documented archive; the active copy is the duplicate); **DELETE** `cli/src/production/{circuit-breaker,rate-limiter,retry,monitoring,error-handler,index}.ts` (F-11-017, 1 783 LOC — re-exported-only-dead). **KEEP** `cli/src/encryption/` (F-11-019, 192 LOC, 2 inbound — under threshold, likely live but lightly used). | F-11-022 (`v3/implementation/` 137 .md files) deferred to a docs cleanup pass; F-11-023 (`archive/`) honoured by `[[feedback-update-integration-ledger]]` — verify `scripts/codemod.mjs` skips `archive/` rather than rewriting it pointlessly | F-11-014 fix removes the bogus `npm install @claude-flow/appliance` user-facing error (CT-G adjacent, small footprint) |
| 8 | `acceptance/no-new-dead-code` release-gate check (lint half) | n/a (gate infra) | **ADD** as a new acceptance-tier check, registered with both `run_check_bg` AND `collect_parallel` (per `[[reference-acceptance-runcheck-vs-collect]]`) | A `ts-prune`/`knip` invocation over `forks/{ruflo,agentdb}/v3/@claude-flow/*/src/` after the post-codemod build, with a counter capped at today's deduped figure (after the deletions in clusters 1-5 + 7 land). New unused exports above the cap fail the release. Per pre-flight #1, must be a real fail-loud step in `_run_and_kill`, not just an ESLint warning ignored by `scripts/ruflo-publish.sh` | — |

### Implementation order

Hard sequence (each step gates the next):

1. **Cluster 4 step (a)** — move `transformers-loader.ts` into `@claude-flow/memory/src/` and route `embedding-pipeline.ts:149` through it. This is the **CVE prerequisite**. ADR-0094 protection lands in the live path. Verify with a smoke test that `@xenova/transformers` is no longer in the live dependency graph (or that `@huggingface/transformers` is preferred per the loader). Hand off to CT-A's fail-loud rework.
2. **Cluster 4 step (b)** — absorb `chunking.ts` + `hyperbolic.ts` into `@claude-flow/memory`. Update the small consumer set (slice 08 confirms only the dead barrel and a handful of tests touch these — the live `embedding-pipeline.ts` already does chunking inline).
3. **Cluster 4 step (c) + clusters 1-3 + cluster 5(a) + cluster 7's delete subset** — physical deletions. Each delete is one fork commit per `[[feedback-commit-forks-before-release]]`, with an [[INTEGRATION-LEDGER]] row (`superseded-by-local` disposition cite this ADR) and a fork arch-test ("file/dir must not exist" — the [[ADR-0222]] amendment pattern). Order within this step: 5(a) first (smallest blast radius), then 7 (single files), then 2/3 (paired — F-11-003 test depends on F-11-001), then 1 (the workspace package).
4. **Cluster 8** — wire the `acceptance/no-new-dead-code` gate. Cap the counter at the post-deletion deduped figure. Verify with a deliberate orphan-export commit that the gate fails red.
5. **Cluster 5(b)** — hand off the 10 catalog-listed plugins to a CT-E ADR. This ADR does NOT decide those.
6. **Cluster 6** — hand off to a ruvector-fork audit. The lint gate from step 4 catches any further accretion under `forks/ruvector/npm/`.

### Consequences

* **Good — discoverability + cognitive load.** Every new maintainer / agent searching for `MCPServer`, `HybridBackend`, `EmbeddingService`, `MCPTool` will find ONE result instead of N (slice 11 §cross-cutting: "for every live/dead pair, the dead surface is MORE discoverable than the live surface"). Single source of truth for each subsystem.
* **Good — CVE posture closes (cluster 4 step (a)).** The live embedding path picks up [[ADR-0094]] CVE-mitigated `transformers-loader.ts`. F-08-002's secondary "CVE protection is unwired in the live path" finding closes.
* **Good — cross-bonus from CT-G + CT-J (cluster 2).** Deleting `v3/mcp/` evaporates F-10-002 (timers without `.unref()` — CRITICAL CT-J) and F-05-001 (`server-entry.ts:140-162` stdout corruption + PII leak — HIGH CT-G). Three CT findings closed by one delete. This is the largest single-action win in CT-F.
* **Good — release-gate `acceptance/no-new-dead-code` (cluster 8).** Next 5 K-LOC accretion is caught at PR time per [[ADR-0233]] §CT-F observation. ESLint-warning-only would not catch (pre-flight #1); a real `_run_and_kill` acceptance check does.
* **Good — forbidden-token risk closed (cluster 3).** The `HybridBackend`/`SqlJsBackend` literal-token JSDoc in `v3/src/` disappears, removing a known acceptance-gate footgun per `[[feedback-forbidden-substring-tests-grep-dist]]`.
* **Bad — upstream divergence opens** for every cluster (1-3, 5(a)) that touches a tree `ruvnet/ruflo` also ships. Per [[ADR-0222]] amendment precedent: future merges need `--ours` for those paths. The arch-tests catch accidental re-add. Worth a runbook note for upstream-sync agents. The merge-tax cost is N permanent `--ours` entries — non-trivial but bounded.
* **Bad — `gastown-bridge` + `agentic-qe` decisions deferred.** Cluster 5(b) hands off to a sibling CT-E ADR. Until that ADR ships, ~37 K LOC of source remains in the tree (still on the wrong side of the lint-gate counter, so the gate cap absorbs it as grandfathered). This is the right deferral — the question "delete-the-source-of-a-published-plugin" is policy, not housekeeping.
* **Bad — temporary CI cost spike** during the deletion week. Each deletion commit per [[feedback-commit-forks-before-release]] requires a release cycle to verify (per `[[feedback-pipeline-shared-skip-on-dist-clear.md]]`, run `npm run release -- --force` if dist-skip artefacts appear after dist wipes). Acceptable for a one-time cleanup.
* **Neutral — `forks/ruvector/npm/packages/*` decision punted.** Cluster 6's 10 K LOC remains until a dedicated audit. The lint gate at least freezes growth. Per slice 11 §Out-of-scope this was the original scope decision.
* **Neutral — `archive/` 418 K LOC untouched.** F-11-023's pipeline-cost flag (codemod-rewriting `archive/` on every publish) is addressed separately — verify `scripts/codemod.mjs` skips `archive/` in a follow-up. Out of CT-F scope.

### Confirmation (gates the deletion batches)

1. **Cluster 4 step (a) confirmation** — `grep -n "@xenova/transformers\|loadTransformersPipeline\|transformers-loader" forks/ruflo/v3/@claude-flow/memory/src/embedding-pipeline.ts` shows the live pipeline now routes through the relocated loader. Smoke test: `npm run release` acceptance with `EMBEDDING_DEBUG=1` shows the loader's "prefer @huggingface/transformers" branch firing.
2. **Per-cluster deletion confirmation** — for each cluster c, after the delete commit lands in the appropriate fork:
   * `grep -rn "<deleted symbol or path>" forks/` returns ZERO outside docs, CHANGELOG / MIGRATION-LOG (acceptable as audit trail), and the [[INTEGRATION-LEDGER]] row.
   * Fork-local arch-test ("file/dir must not exist", per [[ADR-0222]] amendment shape) passes.
   * `npm run release` acceptance passes unchanged.
3. **Cluster 8 confirmation** — gate fires red on a synthetic orphan-export commit; gate passes green on `main`. Counter is registered in `collect_parallel`'s spec list (per `[[reference-acceptance-runcheck-vs-collect]]`, missing-from-spec = silently uncounted).
4. **Cross-bonus confirmation** — after cluster 2 deletion: F-10-002's `ConnectionPool.evictionTimer`/`WebSocketTransport.heartbeatTimer`/`SessionManager.cleanupTimer` paths no longer exist in the tree (`grep -rn "evictionTimer\|heartbeatTimer.*unref\b" forks/`); F-05-001's `server-entry.ts` deleted with the rest of `v3/mcp/`. Re-rate F-10-002 and F-05-001 as "resolved-by-deletion" in any post-mortem.
5. **Upstream-divergence ledger** — every cluster that touches a tree `ruvnet/ruflo` ships gets a `docs/upstream/INTEGRATION-LEDGER.md` row with `superseded-by-local` disposition and a citation to this ADR. Per [[feedback-update-integration-ledger]].

## Per-cluster table

(See [Per-cluster triage table](#per-cluster-triage-table) above. Reproduced as a sectioned anchor for ease of reference. Total clusters: 8 — 6 actionable deletions + 1 merge-then-delete + 1 deferral pair + 1 lint gate.)

| Action class | Cluster IDs | Net LOC removed | Cross-bonus | Defer to |
|--------------|-------------|----------------:|-------------|----------|
| Strict delete | 1, 2, 3, 5(a), 7 (subset) | ~30 600 + ~6 000 from cluster 7 subset | Cluster 2 closes F-10-002 + F-05-001 | — |
| Merge-then-delete | 4 (CVE prerequisite first) | ~6 462 deletion + ~4 470 stack absorption | Coordinates with CT-A (F-08-002 fail-loud) | — |
| Wire-or-delete (per finding) | 7 subset (F-11-014 appliance) | 0 or 2 841 depending on choice | F-11-014 closes a misleading install hint | — |
| Defer + handoff | 5(b), 6 | 0 (handed off) | — | CT-E ADR (5(b)); ruvector-fork audit (6) |
| Add lint gate | 8 | 0 (gate infra) | Caps future accretion | — |
| Keep (under threshold) | 7 (F-11-019 encryption) | 0 | — | — |

## More Information

* **Audit source:** `docs/audits/2026-05-24-second-pass-audit/11-dead-code-scan.md` (23 findings, 4 CRITICAL); `docs/audits/2026-05-24-second-pass-audit/08-embedding-pipeline.md` (CVE-loader location, F-08-002, F-08-011).
* **Parent ADRs:** [[ADR-0233]] §CT-F (theme batch); [[ADR-0201]] (pre-flight checklist applied); [[ADR-0222]] (single-file delete precedent — same shape at smaller scope).
* **Sibling ADRs (no overlap, see pre-flight #4):** [[ADR-0220]] (learning controllers — different files); [[ADR-0203]] (delete-dead-package precedent — `@claude-flow/hooks`); [[ADR-0094]] (CVE-mitigated `transformers-loader.ts` — the code being relocated in cluster 4); [[ADR-0210]] (stub-honesty mandate — governs cluster 5(b) handoff); [[ADR-0215]] (golden-master pattern — model for cluster 8 lint gate).
* **Memory references:** `[[project-deprecated-controllers]]` + `[[project-fork-only-controllers]]` (excluded from findings, both verified during the audit's cross-check); `[[feedback-forbidden-substring-tests-grep-dist]]` (cluster 3 closes a known footgun); `[[feedback-no-fallbacks]]` (cluster 4 CT-A coordination); `[[feedback-update-integration-ledger]]` (every deletion); `[[feedback-commit-forks-before-release]]` (per-commit release sequencing); `[[reference-acceptance-runcheck-vs-collect]]` (cluster 8 gate must register in both); `[[feedback-pipeline-shared-skip-on-dist-clear]]` (release-recovery if dist-skip artefacts appear).
* **NOT this ADR:**
  * The 10 catalog-listed `v3/plugins/*` (cluster 5(b)) — handed off to a CT-E ADR per [[ADR-0210]] stub-honesty mandate.
  * `forks/ruvector/npm/packages/*` (cluster 6) — handed off to a dedicated ruvector-fork audit.
  * `forks/agentic-flow/` dead code — slice 11 §Out-of-scope item 1 (deferred as too broad for this slice).
  * `archive/` 418 K LOC — slice 11 F-11-023 (intentional, documented, publish-excluded; codemod-skip verification is a separate small fix).
  * `forks/ruvector/crates/*` — Rust, not in TS dead-code scan scope.
  * CT-A (silent fallback completions) — owns the *fail-loud rework* for `embedding-pipeline._doInitialize` and `learning-service.mjs`. This ADR only relocates the CVE-loader; CT-A rides on top.
