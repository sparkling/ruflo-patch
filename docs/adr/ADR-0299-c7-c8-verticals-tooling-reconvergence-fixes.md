---
status: proposed
completed: false
date: 2026-06-04
tags: [verticals, market-data, neural-trader, iot, plugin-creator, transfer, honesty, re-convergence, c7, c8, fixes]
supersedes: []
depends-on: [ADR-0292, ADR-0291, ADR-0293, ADR-0248, ADR-0251]
implements: []
---

# C7+C8 re-convergence — complete the honesty lint, fix the split-surface drifts, disclose the transfer demo-fallback

## Context and Problem Statement

The ADR-0292 C7+C8 review (2026-06-04; evidence `docs/research/c78-verticals-tooling/01..04`, drives
`/tmp/c78-evidence/`) closes the program's analysis phase. The categories are the cleanest audited —
the fork's numerical kernels are correct (CG parity to 1e-11, reproducible PageRank, fail-closed
Ed25519), the honesty posture is exemplary, and PARITY-via-handport is ledger-verified. The DA's
both-blind reconciliation produced two corrections that shape this ADR: the prover's "live IPFS
registry" was a misread of the **hardcoded demo-fallback catalog** (placeholder CIDs in its own
evidence), and the auditor's "FORK-REGRESSION: 0" missed that **ruvllm IS market-data's declared
HNSW substrate** (= ADR-0293 D1, already implemented and pending release — recorded here as the
plugin's prerequisite, not new work).

**This ADR is `proposed`.** All four fix items are light (lint extension, two doc-contract fixes,
smoke wiring, envelope field) and bundle into the serial implementation lane where room allows.

## Decision Drivers

* The fork's own marketplace-integrity lint forbids an overclaim string that the fork's own
  `marketplace.json` still carries — because the lint never walks that file.
* A command surface still instructs agents to call a tool with an argument its live schema rejects
  (the second split-surface drift of the program — C4's F1 was the first).
* Three real kernel smokes exist but are wired into no runner (latent red + un-rebranded grep
  literal) — a direct `feedback-always-wire-tests-into-cicd` violation.
* Offline `transfer_*` responses present fabricated-shaped entries with no in-envelope disclosure.

## Considered Options

* **Four small honesty/contract fixes + records** (this ADR). Chosen.
* Remove the transfer demo-fallback — rejected: it is upstream's documented degradation path
  (real IPFS+Ed25519 chain first); the fork-right-sized fix is envelope disclosure, not unwinding
  shared behaviour.
* Record-only — rejected: F1/F2 are self-contradictions between fork-shipped surfaces; F3 hides a
  red test.

## Decision Outcome

Adopt `docs/research/c78-verticals-tooling/04-dispositions.md` verbatim.

### Fixes

* **F1 — complete the honesty lint:** extend marketplace-integrity Assertion 4 to walk
  `marketplace.json` and apply the honest rewrite there (the "witness chain verification for
  Cognitum Seed hardware" string at :132 matches the lint's own pattern at :91). *Acceptance:* the
  lint catches a planted marketplace.json overclaim; the live file passes post-rewrite.
* **F2 — market-data command contract:** `commands/market.md:11` → `memory_store --namespace
  market-data` (the SKILL was already fixed by its ADR-0001; the command still prescribes
  `agentdb_hierarchical-store`+namespace, which the live schema rejects). *Acceptance:*
  grep-contract on the plugin's command surface.
* **F3 — wire the kernel smokes:** rebrand `smoke-portfolio-cg.mjs`'s `mcp__claude-flow__memory_store`
  grep literal → `mcp__ruflo__memory_store`; wire all 3 neural-trader kernel smokes into
  `test-acceptance*.sh` (run_check_bg + collect_parallel) + a fast group. *Acceptance:* green in the
  standard runner.
* **F4 — transfer demo-fallback disclosure:** surface `source`/`fromDemo` in the `transfer_*`
  envelope (`createResult`, transfer-tools.ts:411 — currently drops the stderr-only `(demo)`
  marker). Keep the fallback itself. *Acceptance:* offline `transfer_plugin-official` carries an
  explicit fallback marker; `transfer_plugin-search` unchanged.

### Records (no code change)

* **market-data HNSW prerequisite = ADR-0293 D1** (implemented, pushed, pending release) — C7's one
  known regression; post-release re-drive from the market-data shape closes it.
* **J1/J2 keeps:** the honest-rewrite + lint fork-aheads (completed by F1); kernels
  PARITY-via-handport; ed25519 loud degradation; iot @latest (no pin skew); sublinear unregistered
  both sides.
* **Counter-processes:** registry/marketplace claims need CID/checksum-shape validation (the
  prover-refutation lesson); KNOWN-issue cross-ref tables must cite plugin manifests' declared
  tools (the exclusion-error lesson).

### Consequences

* Good, because the program's analysis phase closes with every fork-shipped self-contradiction
  (lint-vs-manifest, command-vs-schema, smoke-vs-brand) repaired and the honesty posture completed
  at the marketplace layer.
* Good, because the two final counter-processes harden future audits.
* Neutral, because the shared transfer fallback stays (disclosure added); no donate-backs.

### Confirmation

F1–F4 acceptance checks in `test-acceptance*.sh` (both lists) + CI (node-24); post-release
market-data HNSW re-drive. Flips to `accepted`/`completed:true` when shipped and green in a release.

## More Information

* Evidence: `docs/research/c78-verticals-tooling/01..04` (DA verdicts + errata folded 2026-06-04;
  `/tmp/c78-evidence/da/logs/`). Program: ADR-0292 C7/C8 rows. Siblings: ADR-0293..0298.
* **Program completion note:** with C7+C8 reviewed, all 8 ADR-0292 categories have records.
  Final premise tally: **125/125 audited fork ADR premises DEMONSTRATED; zero fabricated-brokenness**
  (the single C1 F1 citation artifact, retracted, remains the program's only assumed-broken item).
  Per-category mistake signatures: C1 wrong-shape · C2 necessity-not-re-justified · C3
  un-merged-paired-fix · C4 doc-drift · C5 stale-fork-artifact-lag · C6 unverified-replacement ·
  C7/C8 split-surface-drift + prover-misread (caught by the DA).

### Implementation record (2026-06-06; both-ways verified; PUSHED `929c5b5f2..1fcfcb866`)

* **Fork commits:** F1 `929c5b5f2` (marketplace.json iot-cognitum + market-data descriptions synced
  verbatim to the per-plugin `plugin.json` honest rewrites), F2 `2c87c0ef1`
  (`commands/market.md:11` → `memory_store --namespace market-data` with the tier-vs-namespace
  routing note; the agents/ Tools list mentions hierarchical tools WITHOUT a namespace pairing —
  outside the command-surface contract, untouched), F3 `4991bac0e` (portfolio-cg grep literal
  `mcp__claude-flow__` → `mcp__ruflo__`), F4 `1fcfcb866` (`transfer_plugin-official` envelope
  carries `source`/`fromDemo`/`plugins`; `PluginDiscoveryResult.fromDemo` added; the demo cache
  entry is flagged so cache hits cannot launder provenance; `plugin-search` untouched).
* **Both-ways:** the extended lint went RED on the live marketplace.json pre-rewrite (the real
  offender = the planted-overclaim proof; 24 pass / 1 fail) → 25/25 GREEN post-rewrite. Kernel
  smokes: portfolio-cg 20/20 (was permanently red on the literal); backtest-signing 21/21 +
  feature-attribution 37/37 (were red on `@noble/ed25519` unresolvable — fork-root `npm install` is
  broken by unrelated self-referencing renamed packages (`@claude-flow/cli-core` ETARGET), so the
  zero-dep package is placed manually and the acceptance smoke LOUD-SKIPs the two crypto smokes
  when unresolvable). F4: the acceptance smoke vs the published Verdaccio cli FAILS with the
  bare-array signature (6 pass / 1 fail standalone — the designed red leg); the fixed dist handler
  drive returns `{source: "claude-flow-official (demo)", fromDemo: true, plugins: 6}` and a
  cache-hit second call preserves both; the live drive also proved the fail-closed signature path
  falls back to demo WITH disclosure even when the gateway fetch succeeds.
* **Wiring:** `scripts/smoke-adr0299-c78-reconvergence.mjs` + `lib/acceptance-adr0299-checks.sh`
  into `test-acceptance.sh` (source list + `run_check_bg` + `collect_parallel` group `adr0299`),
  `test-acceptance-fast.sh adr0299`, and CI `.github/workflows/v3-ci-c78-reconvergence.yml`
  (node-24). Lint Assertion 4 extended to walk marketplace.json
  (`tests/pipeline/plugin-marketplace-integrity.test.mjs`, runs in the standard cascade —
  preflight+pipeline+unit green, 0 fail). Ledger rows (F1–F4): with this record's commit.
* **Riders surfaced by this batch:** ADR-0288's patch-repo test sweep was found undone (unit suite
  red against the retired island; the old `adr0089-svc` acceptance check unpassable against
  published patch.963) — completed in the sibling commit with retirement guards; 4 unit tests'
  `../../../forks` escapes made worktree-safe via `config/upstream-branches.json` resolution.
* Status stays `proposed`; flips with the release that turns `adr0299-c78-reconvergence` green.
  Post-release: re-drive `ruvllm_hnsw_create→add→route` from the market-data shape (the ADR-0293 D1
  prerequisite recorded in `Records`).
