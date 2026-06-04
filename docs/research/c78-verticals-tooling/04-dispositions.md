# C7+C8 Domain verticals + Developer tooling — Dispositions

**Protocol:** ADR-0292 step 6. **No implementation here.** Synthesized by the queen from 01 (prover),
02+03 (auditor — drove WITHOUT the prover's baseline), and the DA cross-examination, which doubled as
the prover↔auditor reconciliation (one prover claim REFUTED, the auditor's headline REFUTED, two new
findings; errata folded into 01–03 on 2026-06-04). Re-convergence ADR: **ADR-0299**.

**DA verdict summary:** the kernels, ledger rows, honesty-fix premises and the iot anomaly engine all
upheld under re-drive; the transfer_* contradiction settled (SHARED-inherited demo-FALLBACK, not a
live registry and not a fork fabrication — with an envelope-disclosure gap); "FORK-REGRESSION: 0"
corrected to **1 (known/tracked: ruvllm = market-data's HNSW substrate, ADR-0293 D1)**.

## Disposition table

| # | Divergence | Class | Disposition |
|---|---|---|---|
| — | **market-data HNSW substrate degraded** (`ruvllm_hnsw_*` dead on fork, works upstream; `market-ingest`/`market-pattern` declare those tools) | FORK-REGRESSION (known/tracked) | **OWNED BY ADR-0293 D1** (implemented, pushed, pending release). C7 action: post-release re-drive `ruvllm_hnsw_create→add→route` from the market-data shape; record D1 as the prerequisite for the plugin's advertised headline. |
| **F1** | **D-CROSS-1: marketplace.json carries the exact overclaim string the marketplace-integrity lint forbids** ("witness chain verification for Cognitum Seed hardware", fork marketplace.json:132 = lint pattern :91) because Assertion 4 walks only per-plugin manifests (:242). SHARED with upstream | incomplete fork honesty-fix (ADR-0248/0251 lineage) | **FIX:** extend lint Assertion 4 to walk `marketplace.json` + apply the honest rewrite there (iot/market descriptions). *Acceptance:* the lint catches a planted overclaim in marketplace.json; the live file passes post-rewrite. |
| **F2** | **market-data `commands/market.md:11`** still prescribes `agentdb_hierarchical-store` + namespace — the exact bug its own ADR-0001 §19 fixed in the SKILL (live schema doesn't accept namespace). SHARED; second split-surface drift, sibling of F1 | doc-contract defect | **FIX:** command.md → `memory_store --namespace market-data` (match the fixed skill). *Acceptance:* grep-contract — no `agentdb_hierarchical-store`+namespace prescription in the plugin's command surface. |
| **F3** | **The 3 neural-trader kernel smokes are NOT wired into any CICD runner** (latent red) AND `smoke-portfolio-cg.mjs:140` greps the un-rebranded `mcp__claude-flow__memory_store` literal (permanently red once run — the skill correctly uses `mcp__ruflo__`) | test-wiring defect (`feedback-always-wire-tests-into-cicd`) | **FIX:** rebrand the grep literal; wire all 3 kernel smokes into `test-acceptance*.sh` (run_check_bg + collect_parallel) + a fast group. *Acceptance:* the smokes run green in the standard runner. |
| **F4** | **transfer demo-fallback envelope-disclosure gap:** `discoverRegistry()` runs a real IPFS+Ed25519 chain and falls back to `getDemoPlugins()` with stderr-only `(demo)` logging; `createResult` (transfer-tools.ts:411) DROPS the marker — the model sees real-shaped fabricated entries with no disclosure. SHARED-inherited (byte-identical upstream; NOT fork-introduced — artifact-parity verified) | inherited honesty-debt (ADR-0293-D2 class, upstream-originated) | **FIX fork-side (small): surface `source`/`fromDemo` in the tool envelope.** Do NOT remove the fallback (it is a documented degradation path); do NOT grade as fork regression; no donate-back. *Acceptance:* offline `transfer_plugin-official` response carries an explicit demo/fallback marker; the name-search path (plugin-creator's real dependency) unchanged. |
| **J1** | Per-plugin honest-description rewrites (ADR-0248/0251) + the marketplace-integrity lint | FORK-AHEAD | **KEEP** (F1 completes them at the marketplace layer). |
| **J2** | neural-trader kernels (CG parity 1.6e-11..4.1e-11, PageRank reproducible, Ed25519 tamper/key-pin) = PARITY-via-handport (ledger rows 169-173, `cherry-pick -x`); `@noble/ed25519` bundled, both degradation modes LOUD; iot installs `@latest` (no pin skew); sublinear tools unregistered both sides with honest local fallback | PARITY / healthy | **NO ACTION; recorded.** |
| — | PARITY ~16 + symmetric safety-bound gaps (iot hardware data-plane, nt live/cloud/broker, nt's own 112-tool server) | — | RECORDED. |
| — | UPSTREAM-BROKEN: 0 | — | — |

## Key tensions recorded

1. **The prover misread its own evidence** ("live IPFS registry" with placeholder CIDs in its own
   JSONL) — the first prover-side refutation of the program. Lesson: registry/marketplace claims need
   CID/checksum-shape validation, not envelope plausibility. The DA's both-blind reconciliation
   (researchers never saw each other's docs) is what caught it.
2. **Cross-category exclusion errors are real:** the auditor excluded ruvllm as "not a C7/C8
   surface" without checking the plugins' declared tool lists. Counter-process: KNOWN-issue
   cross-ref tables must cite the plugin manifests' declared tools, not topic intuition.
3. Premise hygiene final: **11/11 — program complete at 125/125 audited fork ADR premises
   demonstrated across all 8 categories, zero fabricated-brokenness** (the single C1 citation
   artifact remains the program's only assumed-broken item).

## What ADR-0299 must contain

F1–F4 fixes (all small: lint extension + 2 doc-contract fixes + smoke wiring/rebrand + envelope
disclosure) with acceptance checks wired into the standard runner + CI (node-24); the D1-prerequisite
record; J keeps; the two counter-processes.

## Go-ahead checkpoints

Implementation queues in the serial lane (after ADR-0295+0296 → ADR-0297 → ADR-0298; F1-F4 are
light and can bundle with whichever batch has room). Post-release: market-data HNSW re-drive (D1
closure on a C7 surface) + the F-item acceptance greens.
