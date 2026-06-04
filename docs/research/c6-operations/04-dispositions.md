# C6 Operations — Dispositions

**Protocol:** ADR-0292 step 6. **No implementation here.** Synthesized by the queen from 01 (prover),
02+03 (auditor), and the DA cross-examination (every load-bearing verdict upheld; fix-scope
refinements + two new findings; errata folded into 01–03 on 2026-06-04). Re-convergence ADR:
**ADR-0298**.

## Disposition table

| # | Divergence | Class | Disposition |
|---|---|---|---|
| **R1** | **`browser_session_record` dead — TWO layers.** Step-1: fork `rvf create … --kind` fails (invalid flag, required `-d` omitted) — un-merged Issue-#2015 fix, FORK-REGRESSION (upstream's step-1 succeeds). Steps 2-4: `trajectory-begin/step/end` arg-skew vs ruvector@0.2.25 (`-c/--context` etc.) — UPSTREAM-BROKEN-SHARED (ADR-0293 D1 skew class) | FORK-REGRESSION (step-1) + UPSTREAM-BROKEN-SHARED (steps 2-4) | **ONE ATOMIC 4-call fix in browser-session-tools.js** (DA adjudication: rvf create → `--dimension <dim>` [768 to match the fork's mpnet unless the container spec dictates otherwise] + the 3 trajectory calls re-targeted to ruvector@0.2.25's real arg shapes). Do NOT split — half-fixing step-1 alone writes orphan `.rvf` containers. Cross-ref the skew CLASS to ADR-0293 D-series; the fix ships here. Fixing our handler also direction-flips us above upstream (which stays broken at step-2). *Acceptance:* record→step→end→replay chain green in a fork env; published baseline fails at step-1. |
| **R2** | **Stat-tools repair batch (DA-corrected scope).** `agentdb_circuit_status` BROKEN (wrong registry key `circuitBreakerController` AND wrong method — handler calls `getStats()`, the controller exposes `getStatus()`); `agentdb_rate_limit_status` HOLLOW (`rateLimiter` exposes neither — `success:true` with zero fields). Fork-only tools (DA settled: upstream has none of the 4) | FORK-AHEAD-BROKEN (1) + FORK-AHEAD-HOLLOW (1) | **TWO-part circuit fix (key + method) AND rate_limit repair** (wire a real stats surface on the controller or return an honest capability-absent envelope — no hollow success). `resource_usage`/`query_stats` stay as-is. *Acceptance:* circuit_status returns non-empty real breaker state; rate_limit_status returns real fields OR honest absence. |
| **R3** | **Fork CLI cold-boot ~26-31× slower than upstream for shelled memory ops** (DA F1: 34.7-41.0s warm vs 1.31s; cause: heavy controller-registry + native loads per fresh process). Blast radius: browser session tools shell `npx @sparkleideas/cli@latest memory …` PER CALL (browser-session-tools.js:183/270/307) | FORK-REGRESSION (perf) | **Scoped fix now + follow-up:** (a) in ADR-0298's batch — stop shelling a fresh CLI per browser-session call (in-process memory bridge or the running server's own memory path); (b) the general cold-boot profile is RECORDED as a follow-up perf item (own ADR if pursued — do not bundle a profiling program into this batch). *Acceptance (a):* template_apply/cookie_use honest-miss returns in seconds, not 30s+. |
| **J1** | 23 browser interaction tools registered unconditionally, degrading gracefully (clean self-disclosing envelope when agent-browser absent) vs upstream's conditional gate | FORK-AHEAD (surface choice) | **KEEP** (more discoverable; DA-verified graceful). |
| **J2** | ModelRouter Beta/Thompson learning (real priors, durable; route is a stochastic SAMPLE — DA refinement) | PARITY/healthy | **KEEP; doc note** if any doc implies deterministic routing. |
| **X1** | Doc batch: cost PRICING table stale Haiku-3 rates under a `haiku-4-5` label (DA F3 — freshness, internally consistent); observe/cost CLI doc-drift (shared upstream — record); cost plugin version-label note (0.16.1 live vs ADR arc v0.15.0) | doc drift | **FIX fork-owned items with the batch; record shared ones.** |
| — | PARITY (~18): loop-workers 5-tool framework + 12-trigger registry, worker dispatch/detect/cancel, observability content-real round-trips, cost chain + USD math (recomputed exact), browser lifecycle + local-Chromium drive, orchestration namespaces durable on RVF | PARITY | NO ACTION. |
| — | UPSTREAM-BROKEN-SHARED beyond R1 steps 2-4: none. Worker EXECUTION = C4's evidence (cross-ref). CronCreate/ScheduleWakeup = harness tools, out of scope | — | — |

## Key tensions recorded

1. **Fix-scope under-statement is the C6 lesson:** "one-token fix" survived two researchers and fell
   only to the DA's live method-surface probe — wiring a tool to a controller CONTRACT (`getStats()`)
   that the controllers don't implement is the unverified-replacement class (M-C6-2, broadened).
   Counter-process: a fix disposition naming a method/key must be probed against the LIVE registry
   surface before ratification.
2. **Perf regressions hide as harness timeouts** (F1): a 30s rpc window converted a 26-31× CLI
   cold-boot regression into "NEEDS-PROVER". Counter-process: any TIMEOUT verdict needs one
   warm-timing measurement before being graded a harness artifact.
3. Premise hygiene: **11/11 demonstrated** (program cumulative: 114/114 across C1–C6+C7/C8, zero
   fabricated-brokenness).

## What ADR-0298 must contain

R1 (atomic 4-call), R2 (two-part + sibling), R3a (in-process bridge) + R3b recorded follow-up,
J1/J2 keeps, X1 docs — each fix with acceptance wired into `test-acceptance*.sh` (both lists) + CI
(node-24); both-ways evidence; the two counter-processes recorded.

## Go-ahead checkpoints

Implementation queues in the serial lane behind ADR-0295+0296 (running) and ADR-0297 (C5 security
batch — R1 there outranks C6). Post-release: re-drive record→replay, the stat tools, and the
template/cookie latency.
