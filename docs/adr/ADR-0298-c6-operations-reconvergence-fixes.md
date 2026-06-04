---
status: proposed
completed: false
date: 2026-06-04
tags: [operations, browser, workers, observability, cost, stat-tools, perf, re-convergence, fork-regression, c6, fixes]
supersedes: []
depends-on: [ADR-0292, ADR-0291, ADR-0293, ADR-0042, ADR-0043]
implements: []
---

# C6 re-convergence — fix the browser-session record chain, repair the stat tools, stop shelling the CLI per call

## Context and Problem Statement

The ADR-0292 C6 review (2026-06-04; evidence `docs/research/c6-operations/01..04`, drives
`/tmp/c6-evidence/`) proved upstream's Operations surface works (loop-workers is a real worker/cron
backbone; observability and cost-tracker are honest template/script substrates carrying real
content; browser lifecycle works over local Chromium) with ONE upstream-broken item
(`browser_session_record`, dying at the ruvector trajectory arg-skew). The fork audit + DA found the
fork is at parity or justified-ahead everywhere except three items — and the DA materially
sharpened two fix scopes the researchers under-stated.

**This ADR is `proposed`.** Fixes run in the serial implementation lane (queue: after the
ADR-0295+0296 batch and ADR-0297's security batch).

## Decision Drivers

* `browser_session_record` is dead in the fork ONE STEP EARLIER than upstream (un-merged Issue-#2015
  fix layered under the shared trajectory skew) — and fixing our handler direction-flips us above
  upstream.
* Two of the four fork-only stat tools return broken/hollow envelopes (wired to a `getStats()`
  contract 2 of 4 controllers don't implement).
* A ~26-31× CLI cold-boot penalty hits every browser-session memory call (34.7-41s vs upstream's
  1.31s) — a perf regression that masqueraded as harness timeouts.

## Considered Options

* **Atomic 4-call browser fix + two-part stat repair + in-process memory bridge** (this ADR). Chosen.
* Split the browser fix (step-1 now, trajectory later) — rejected (DA adjudication): half-fixing
  step-1 writes orphan `.rvf` containers; the trajectory calls are dead code until step-1 works.
* Key-only circuit fix — rejected: ships `{success:true}` with empty stats (the DA's live
  method-surface probe: the controller exposes `getStatus()`, not `getStats()`).

## Decision Outcome

Adopt `docs/research/c6-operations/04-dispositions.md` verbatim.

### Fixes

* **R1 — browser_session_record: ONE atomic 4-call edit** (`browser-session-tools.js`): `rvf create`
  drops `--kind`, adds `--dimension <dim>` (768 to match the fork's mpnet unless the container spec
  dictates otherwise); the three `trajectory-begin/step/end` calls re-targeted to ruvector@0.2.25's
  real arg shapes (`-c/--context`, `-a`, `-r`, `--success`, `--quality`). Skew CLASS cross-referenced
  to the ADR-0293 D-series (same family as D1); the fix ships here. *Acceptance:* record → step →
  end → replay chain green in a fork env (replay-spike reachable); published baseline fails at
  step-1; both-ways logged.
* **R2 — stat-tools repair (DA-corrected scope):** `agentdb_circuit_status` = TWO-part fix (registry
  key `circuitBreakerController`→`circuitBreaker` AND `getStats()`→`getStatus()`);
  `agentdb_rate_limit_status` = wire a real stats surface or return an honest capability-absent
  envelope (no hollow success). `resource_usage`/`query_stats` unchanged. *Acceptance:*
  circuit_status returns non-empty breaker state; rate_limit_status returns real fields OR honest
  absence; probed against the live controller registry.
* **R3a — stop shelling a fresh CLI per browser-session memory call** (`browser-session-tools.js`
  :183/270/307): use an in-process memory path instead of `npx @sparkleideas/cli@latest memory …`
  per call. *Acceptance:* template_apply/cookie_use honest-miss returns in single-digit seconds.
* **R3b (recorded follow-up, not in this batch):** general fork CLI cold-boot profile (~26-31× vs
  upstream) — own perf item if pursued.

### Keeps + docs

* **J1:** unconditional-but-graceful 23 browser interaction tools — KEEP (DA-verified clean
  degradation envelope). **J2:** ModelRouter Thompson-sampling learning — KEEP (doc note: routes are
  stochastic samples; the durable artifact is the Beta prior).
* **X1:** cost PRICING table Haiku-rate freshness note; shared observe/cost CLI doc-drift recorded;
  version-label note (live 0.16.1).

### Consequences

* Good, because the record→replay chain comes back AND direction-flips the fork above upstream's
  still-broken step-2; the stat tools stop lying-by-hollowness; browser memory ops shed a 30s tax.
* Good, because two counter-processes land: live method-surface probes before ratifying fix scopes;
  warm-timing before grading any TIMEOUT a harness artifact.
* Neutral, because R3b stays a recorded follow-up rather than scope creep.

### Confirmation

R1/R2/R3a acceptance checks wired into `test-acceptance*.sh` (run_check_bg + collect_parallel) + CI
(node-24); both-ways evidence; post-release re-drives per 04. Flips to `accepted`/`completed:true`
when shipped and green in a release.

## More Information

* Evidence: `docs/research/c6-operations/01..04` (DA verdicts + errata folded 2026-06-04;
  `/tmp/c6-evidence/da/`). Program: ADR-0292 C6 row. Siblings: ADR-0293..0297.
* C6 mistake-class signature: **un-merged-paired-fix (again) + unverified-replacement** — the
  ADR-0042/0043 stat tools were wired to a controller contract never probed live.
