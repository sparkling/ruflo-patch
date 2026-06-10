# Session Handover — 2026-06-10 — ADR verification swarm + implementation plan

**Companion plan:** `docs/plans/IMPLEMENTATION-PLAN-2026-06-10-outstanding-adrs-swarm.md`

## TL;DR

An 8-agent adversarial swarm (all on the new **Fable 5** model) re-verified **17 open/
open-tailed ADRs** against the SHIPPED artifacts with live repros. **Zero ADRs were refuted
outright — every open defect re-confirmed live — but 11 needed amendments** where the
diagnosis / attribution / current-state had drifted. Three ADRs were flipped to `accepted`
(0284, 0287, 0269); twelve got evidence amendments. Then the **4 open decisions were
resolved one-by-one** with the user, each gated on an upstream-provenance check. A Batch-U
upstream-sync tracking ADR (0313) was created and sequenced last. **No fork code was changed
this session** — it was verification + ADR curation + planning only.

## Git state (branch `main`, all pushed-ready, working tree clean for docs/adr)

```
65b3035 docs(adr): ADR-0313 — Batch-U upstream sync (proposed, sequenced LAST)
36eb6cd docs(adr): ADR-0289 Phase-2 DEFER confirmed — deliberate divergence from upstream
30fd04a docs(adr): ADR-0307 T1 RESOLVED → attribution-only (follow upstream)
5950083 docs(adr): ADR-0306 T1 RESOLVED → KEEP (track upstream); reverse the wrong DELETE call
25de0a9 docs(adr): 2026-06-10 swarm verification — 3 flips + 12 evidence amendments
d36c0e3 docs(adr): ADR-0312 — hook-side CJS helpers dead under type:module, emit .cjs
```

Pre-existing uncommitted (NOT this session, leave or handle separately): `M package.json`,
`?? .claude-flow/daa/`, `?? .claude-flow/system/`.

## What the swarm verified (one line each)

- **0284 → ACCEPTED** — RVF single-flock collapse live-verified (smoke 3/3, 0 loss); gate green @ 2026-06-07 (743/753). Residuals: P2/P3 probes unwired, `v3-ci-rvf-lock.yml` can't pass on GitHub (sibling fork paths), 0267 dropped from depends-on.
- **0287 → ACCEPTED** — ~75% of backlog executed (reporter tier `9767dc601`, F5 via 0288, F10 via 0290, all live-confirmed). Open: F2 `resources/list -32601`, R2 swallow, T1 silo half, F1 `MCP_TIMEOUT`.
- **0269 → ACCEPTED** — 5 deferrals all still open in shipped dist; flipped to deferral-genre status; phantom Confirmation tag fixed.
- **0286** — interim loud-warn shipped (`602ee04` @ agentdb patch.444); deferred fail-loud still open. Stays proposed (own flip rule).
- **0304** — all 5 `--codex` bugs reproduce on newest publish; fix on fork main (`3ccb64e0e`) unreleased. **NB: wrong-server registration now succeeds SILENTLY with a current codex on PATH.**
- **0305** — zero stale claims; skill still shells ~840 npx round-trips; 0273 builder shipped + reachable.
- **0306** — see Decisions. **0307** — see Decisions. **0308** — root cause REVISED (plumbing no-op, not a 768 literal; every adapter silently 768×768; 2-line fix).
- **0309/0310** — federation: all DOA bugs real; 0310's missing nested `package.json` DOAs the WHOLE agentic-flow CLI; 0309 dispatcher is UPSTREAM (alpha.16) not the fork (patch.197).
- **0252** — 16/17 dispositions closed same-day by 0257; **re-eval trigger FIRED (91→~100 upstream commits)** → ADR-0313.
- **0288** — Gate-3 probe half closed 2026-06-06 (now recorded); doc half open; `:84` contradiction fixed.
- **0289** — redaction WAS wired at `storeEpisode` since `b385492` (safe-direction error corrected); Phase-2 policy still open.
- **0249** — MCP lint rule described BACKWARDS (fatals must THROW); baseline 20/63 not 61. **0250** — both findings still open; no touch.

## Decisions LOCKED (do NOT re-litigate — full rationale in each ADR)

| # | ADR | Resolution | Why (upstream-grounded) |
|---|---|---|---|
| D1 | 0306 | **KEEP, track upstream** | File is **byte-identical to `ruvnet/ruflo` origin/main** (rUv 2026-01-05 checkpoint). `executeCompletion` + sibling `ProviderAdapter.executeRequest` BOTH stubbed = decision/orchestration scaffold, not a lie. Upstream routing intent lives in ADR-026 (live tier router) / ADR-011 (`@claude-flow/providers`) / ADR-001 (adopt agentic-flow); ADR-011 names this router once under **Neutral** "can coexist"; stub-audits 063/064/066 never flag it. DELETE = merge-tax on identical code. **Don't wire ahead of upstream, don't delete.** |
| D2 | 0307 | **Attribution-only** | Upstream `worker-daemon.ts` has ZERO budget gating BY DESIGN; opt-in `exit-1` gate IS upstream (`budget.mjs:216`); ADR-097 puts hard enforcement at the **federation boundary** (`federation_send` caps), not the daemon. Daemon-gating = divergence. |
| D3 | 0289 Ph2 | **Defer** | Upstream `storeEpisode` captures RAW free-text, zero redaction = the rejected Option D. Fork metadata-only is a deliberate SAFETY divergence; `redactFreeText` is fork-original. "Follow upstream" doesn't apply (upstream impl is unsafe). Fork-ahead speculation → defer. |
| D4 | 0313 | **Own ADR, ledger-tracked, LAST** | Batch-U = ~100 commits; intelligence cluster (18) needs the other intelligence ADRs settled first. |

## The big lesson of this session (carry forward)

**I reflexively recommended DELETE on the MultiModelRouter and WROTE it into ADR-0306 — then
the user disbelieved it and a `git show origin/main` / `diff` showed it was byte-identical
UPSTREAM code.** The corrected discipline, now in memory (`feedback-no-consumer-is-not-stub`
2026-06-10 refinement): **before ANY delete/disposition verdict on apparent dead/mock code,
provenance-check upstream (`diff` vs origin/main) + read the upstream ADR intention FIRST.**
A DELETE verdict on upstream-identical code is almost always wrong. This generalized into the
session's governing rule: **follow upstream intent + implementation.**

Other standing reminders that bit or nearly bit this session:
- **Subscription auth — NO `ANTHROPIC_API_KEY` exists, by design.** Never call its absence a
  defect; key-gated provider paths are inert-by-design (`user-claude-subscription-no-api-keys`).
- **Verify on the SHIPPED artifact** (npx cache ≡ Verdaccio latest), never dev `node_modules`.
- **Trace the bin entry before patching** (0287 F2 is a `bin/` fix, not `src/`).
- The agentic-flow package has a **nested `agentic-flow/agentic-flow/dist/` layout** — router
  lives at `.../agentic-flow/dist/router/`, and the missing nested `package.json` is a real bug (0310).

## Outstanding work → the plan

All implementation is in `docs/plans/IMPLEMENTATION-PLAN-2026-06-10-outstanding-adrs-swarm.md`,
as swarm waves (parallel Agent fan-out, queen=main session, provenance-check-first):
- **Wave 1** (recommended start): 0308 + 0312 + 0287 F2/R2/T1-silo/F1, one release (carries 0304).
- **Wave 2:** 0305. **Wave 3:** 0310 then 0309. **Wave 4:** 0306 T3/T4, 0307 T2/T3, 0288 Gate-3, 0286 (opt), 2 new ADRs.
- **Wave 5 (LAST):** Batch-U (ADR-0313).
- **Deferred, do NOT touch:** 0249, 0250, 0269, 0289 Phase 2.

## Do-NOT list

- Do NOT re-litigate D1–D4 (they're evidence-grounded + user-decided).
- Do NOT reflexively DELETE unconsumed/mock code — provenance-check upstream first.
- Do NOT wire the MultiModelRouter, gate the daemon on budget, or build 0289 Phase 2.
- Do NOT start Batch-U before Waves 1–4 ship.
- Do NOT scaffold codex artifacts into real projects; 0304 (the codex FIX) is legit maintenance
  but FLAG it for Henrik (Claude-only) before releasing.
- Do NOT release from a worktree; main checkout only.
- Do NOT push to `origin`(ruvnet) or `hz`; fork pushes go to `sparkling`.

## Key paths / refs

- Forks: `/Users/henrik/source/forks/{ruflo,agentdb,agentic-flow,ruvector,ruv-FANN}`
- Upstream (read-only): `/Users/henrik/source/ruvnet/<repo>` (origin = ruvnet)
- Shipped runtime: `~/.npm/_npx/906e6debb112be6d/node_modules/@sparkleideas/` (≡ Verdaccio latest)
- Live tier router (the real one): `forks/ruflo/v3/@claude-flow/cli/src/ruvector/model-router.ts`
- Upstream ADRs: `ruvnet/ruflo:v3/implementation/adrs/` (ADR-001/011/026) + `v3/docs/adr/ADR-097`
- Ledger: `ruflo-patch/docs/upstream/INTEGRATION-LEDGER.md`
