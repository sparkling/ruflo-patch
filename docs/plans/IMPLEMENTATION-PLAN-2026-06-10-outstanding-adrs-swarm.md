# Implementation Plan — Outstanding ADRs (swarm execution)

**Date:** 2026-06-10 · **Author:** session synthesis (Henrik + Claude) · **Status:** ready, awaiting per-wave go-ahead
**Companion:** `docs/SESSION-HANDOVER-2026-06-10-adr-verification-and-plan.md`

This plan executes the outstanding fork ADRs verified + dispositioned on 2026-06-10.
All four open decisions are **resolved** (see §Decisions). Batch-U upstream sync
(ADR-0313) is sequenced **last** per user decision.

---

## Governing principles (NON-NEGOTIABLE — every agent inherits these)

1. **Follow upstream intent + implementation.** Before ANY change, provenance-check:
   `git show origin/main:<path>` / `diff` — is the bug upstream? did upstream fix it?
   what does the upstream ADR intend? Do NOT diverge without a positive, recorded case.
   (This is the guard the MultiModelRouter DELETE-reflex violated — `feedback-no-consumer-is-not-stub`.)
2. **Patches in forks, never codemod.** Code fixes land in `forks/{ruflo,agentdb,agentic-flow}`
   on their build branches → push to `sparkling` (never `origin`=ruvnet, never `hz`).
   ADRs + dogfood `.claude/` + acceptance scripts live in `ruflo-patch`.
3. **Subscription auth — there is NO `ANTHROPIC_API_KEY`, by design.** Never treat its
   absence as a defect; key-gated provider paths are inert-by-design here. All real LLM
   execution is Claude Code processes on the subscription. (`user-claude-subscription-no-api-keys`)
4. **Verify on the SHIPPED artifact**, never dev `node_modules`. Live daemon's npx cache
   `~/.npm/_npx/906e6debb112be6d/node_modules/@sparkleideas/` ≡ Verdaccio `latest`. Fresh
   installs to `/tmp` for cross-checks (`feedback-inspect-installed-not-dev-nodemodules`).
5. **Wire every new test into BOTH** `test-acceptance*.sh` (`run_check_bg` AND the
   `collect_parallel` spec) AND `.github/workflows/` (`feedback-always-wire-tests-into-cicd`).
6. **Release from the MAIN checkout only** (`feedback-release-from-main-checkout-only`),
   `npm run release` (or `bash scripts/ruflo-publish.sh`); `--force` if a dist was wiped
   (`feedback-pipeline-shared-skip-on-dist-clear`). Node pin enforced (ADR-0302) — failing
   guard = fix env, never mise-exec-wrap.
7. **Never declare done without** build green + full acceptance green from a main-checkout
   release. Never squelch/skip a real failure (`feedback-no-squelch-tests`).
8. **Commit often**, INTEGRATION-LEDGER row per upstream pick (`feedback-update-integration-ledger`).

---

## Decisions (LOCKED 2026-06-10 — do NOT re-litigate)

| # | ADR | Resolution |
|---|---|---|
| D1 | 0306 | `MultiModelRouter` = **KEEP, track upstream** (byte-identical upstream scaffold; don't wire, don't delete) |
| D2 | 0307 | Budget = **attribution-only**, follow upstream ADR-097 federation-boundary model (no daemon gating) |
| D3 | 0289 | Phase 2 = **defer** (upstream captures raw free-text; redaction is fork-original; gate stays self-inert) |
| D4 | 0313 | Batch-U sync = own ADR, ledger-tracked, **LAST** |

---

## Swarm execution model

**Topology:** parallel Agent fan-out (the project's canonical pattern, ADR-0098 — NOT
`swarm_init` ceremony, NOT hive-mind unless a council is explicitly wanted). The **main
session is the queen**: it spawns implementers in ONE message (`run_in_background: true`),
synthesizes results, owns the build + release + acceptance gate.

**Per-implementer-agent contract (every agent, every wave):**
1. **Provenance-check** the target upstream (`git show origin/main` / `diff`) — confirm the
   bug/gap is real on the shipped artifact AND establish upstream's intent. Report it.
2. **Implement** the fix in the fork (minimal, surgical — `feedback-patches-in-fork`).
3. **Local verify** — typecheck/build the touched package; run the new regression locally.
4. **Wire acceptance** — add the check to `test-acceptance*.sh` (both run + collect) + workflow.
5. **Report** a structured result: provenance verdict, exact diff (file:line), test added,
   local build/test output, residual risks. Do NOT push/release (queen owns that).

**Queen (main session) per wave:** review diffs (`feedback-verify-commit-content-vs-message`),
resolve cross-file/cross-fork ordering, commit per fork, run ONE unified build + release from
the main checkout, verify FULL acceptance green, flip ADR status / add ledger rows, commit ADRs.

**Isolation:** for waves where agents mutate the **same fork file-set in parallel**, either
(a) agents report patches as text and the queen applies serially (best for tiny Wave-1 fixes),
or (b) `isolation: "worktree"` per agent and the queen cherry-picks (best for larger Wave-3
work). Default to (a) for Wave 1, (b) for Waves 2–4.

---

## Wave 1 — tiny high-confidence fork fixes (one release)

**Pattern:** 5 implementer agents, patch-report mode (agents propose exact diffs + tests;
queen applies + builds + releases once). Each opens with its upstream provenance-check.

| Agent | ADR | Repo · target | Fix shape (from 2026-06-10 swarm) | Acceptance |
|---|---|---|---|---|
| `fix-ruvllm-dim` | 0308 | `forks/ruflo` `v3/@claude-flow/cli/src/ruvector/ruvllm-wasm.ts:322-323` | `loraConfig.inFeatures = config.inputDim; loraConfig.outFeatures = config.outputDim;` (was writing `inputDim/outputDim` — inert expandos → every adapter silently 768×768). Provenance: confirm the property-name bug exists upstream too / isn't already fixed. | non-768 adapter round-trips create→adapt; un-pin `acceptance-ruvllm-checks.sh:275-279` 768 workaround |
| `fix-hookside-cjs` | 0312 | `forks/ruflo` `helpers-generator.ts` (+ `executor.ts:1210`) + `ruflo-patch/.claude/helpers/*` + `tests/pipeline/init-helpers-parity.test.mjs` | emit `router.cjs`/`memory.cjs`/`session.cjs`; handler refs w/ legacy `.js` fallback; dogfood-rename local helpers; rewrite the parity test that blesses `createRequire`. **Converge with upstream's in-flight `hook-handler.cjs` migration** (ADR-0287 F3a). | fresh-init `type:module` project: route hook shows recommendation box, not "Router not available" |
| `fix-resources-list` | 0287 F2 | `forks/ruflo` `cli/bin/cli.js:206/:309` + `bin/mcp-server.js:192/:298` (BIN entry, not src — `feedback-trace-bin-entry-before-patching`) | add a `{resources:[]}` handler so advertised `capabilities.resources` stops returning `-32601` | JSON-RPC `resources/list` returns `[]` |
| `fix-storeinagentdb` | 0287 R2 | `forks/agentdb` `agentdb-backend.ts:604-672` | discriminated re-throw in the two swallowing `catch{}` (SQLite INSERT + HNSW add); keep off-hot-path semantics | regression: simulated INSERT failure surfaces (not swallowed) |
| `fix-silo-timeout` | 0287 T1-silo + F1 | `ruflo-patch` `.claude/helpers/auto-memory-hook.mjs:247-253` + `settings.json:151`; `.mcp.json`/settings | retire dogfood `agentdb-memory.rvf` write + stale Stop→`sync` line; set `MCP_TIMEOUT=60000` (or record consciously-skipped) | no silo file regenerated; Stop hook clean |

**Rider:** 0304's codex fix is already on `forks/ruflo` main (`3ccb64e0e`, unreleased) — it ships
in this wave's release automatically. Add its T4 acceptance gate (zero `codex` matches today).
**FLAG:** Henrik is Claude-only — confirm keep-or-drop 0304 before the release.

**Definition of done:** all 5 patches applied, forks build, release from main, FULL acceptance
green, ADR-0308 amended-tasks done + 0287 remainder items struck, 0312 → can flip toward accepted
once its acceptance is green.

---

## Wave 2 — skill migration

**Pattern:** 1 implementer (`migrate-adr-index`), worktree isolation.

- **0305** — migrate the `adr-index` skill from `import.mjs` (~840 npx round-trips) to the
  shipped in-process `ruflo agentdb index` builder (ADR-0273, already shipped + reachable).
  Repo: `forks/ruflo` (`plugins/ruflo-adr` + skill `SKILL.md`). Provenance: upstream's
  `ruflo-adr` skill still shells `import.mjs` too (per-record npx) and never parses
  `implements` — confirm + decide whether to converge or stay fork-ahead.
- **DoD:** end-to-end index build (the undone T1) matches the round-trip path's record/edge
  counts; skill drives the builder; acceptance covers the skill path (not just the builder).

---

## Wave 3 — federation (follow upstream; 0309 is literally an upstream port)

**Pattern:** 2 implementers, worktree isolation (large, agentic-flow + plugin).

- **0310** (`forks/agentic-flow`) — fix 4 DOA `FederationHubServer` bugs (await `init`;
  null-guard `agentDB.storePattern` + the `stop()` close NPE; author/ship
  `run-hub.js`+`run-agent.js`; exports map) **+ add the nested `agentic-flow/package.json` to
  `files`** (without it the ENTIRE published agentic-flow CLI ENOENTs at `cli-proxy.js:43` —
  un-bricks far more than federation). DoD: T4 shipped-CLI cross-process push/pull + tenant
  isolation.
- **0309** (`forks/ruflo` `plugin-agent-federation`) — port upstream ADR-109 `inbound-dispatcher`
  across the alpha.5→alpha.13 drift (upstream `@claude-flow/...@alpha.16` ships+wires it since
  2026-05-17; the fork's `@sparkleideas/...@patch.197` lacks it) + build the missing local-memory
  responder (T2′). DoD: two-node `memory-query` round-trip, untrusted refused+audited.
- **Sequencing:** 0310 first (un-bricks the agentic-flow CLI that 0309 may lean on), then 0309.

---

## Wave 4 — doc / honesty (decisions baked in)

**Pattern:** parallel doc agents (no release until the cluster lands); mostly `forks/ruflo`
docs + `ruflo-patch` ADRs.

- **0306 T3/T4** — USERGUIDE `:894` Q-learning→Thompson; reconcile the **FIVE** savings
  figures (24.5/30-50/75/250/90%). T1=KEEP already resolved; ensure no surface calls the
  integration router a wired live executor.
- **0307 T2/T3** — document cost-tracker as attribution+alerting (hard cut-off = ADR-097);
  fix the "learn→opus" evidence conflation + stale haiku-4.5 pricing; **align worker cadence
  to upstream** (upstream `worker-daemon.ts` = 10/15min — provenance-check the `:59-60` 30/60
  array first; align or record a justified fork override).
- **0288 Gate-3 doc half** — re-anchor ~29 `AgentDBService` "episode store" refs across
  ADR-0192/0193/0195/0196 (or dispose per `feedback-old-adr-status-lines-go-stale`).
- **0286** (optional) — the deferred fail-loud (default-throw + opt-in env + regression test).
- **2 new ADRs** for swarm-found bugs: (a) `system_health` reports memory "degraded — store
  not found" while memory works (ADR-0210-class reporter honesty); (b) `init --help` advertises
  `--no-global` but the parser rejects it.
- **ADR-0314** (written 2026-06-10) — implement the `agent-browser` headless-Chrome
  **teardown + PPID-1 orphan reaper + acceptance check**. The recurring acceptance
  perf-gate contention (`feedback-perf-gate-failure-check-machine-load`) traces to this
  leak — 11 orphaned headless Chrome / ~8-9 cores, killed 2026-06-10. **Sequenced before
  Wave 5 (Batch-U)** so the upstream-merge's measurement-sensitive perf gates run
  contention-free.

---

## Wave 5 — Batch-U upstream sync (ADR-0313) — LAST

Its own dedicated effort, per ADR-0313: pin the Batch-T baseline SHA, enumerate
`<baseline>..<fresh-upstream-HEAD>` (~100 commits / ~67 substantive), per-family disposition
with the `intelligence` cluster (18) triaged commit-by-commit against the now-settled fork
baseline, INTEGRATION-LEDGER row per decision, release + acceptance. **Authorises no
integration until Waves 1–4 ship + a separate go-ahead.**

---

## Correctly deferred — do NOT implement (trigger/decision-gated, NOT skipped)

- **0249 / 0250** — triggers unfired (erosion +1.7% < 10%; windows to ~2026-08-24).
- **0269** (5 items) — all trigger-gated; none fired.
- **0289 Phase 2** — deferred by decision (D3).

---

## Per-wave gate (queen checklist before declaring a wave done)

- [ ] every agent's provenance-check recorded (upstream intent confirmed)
- [ ] diffs reviewed (content matches message); surgical; no scope creep
- [ ] touched forks build clean
- [ ] new acceptance wired into run + collect + workflow
- [ ] release from MAIN checkout; FULL acceptance green (no new fails, no silent skips)
- [ ] ADR statuses/tasks updated + committed; ledger rows where applicable
- [ ] `git status --short` clean OR every line explained
