---
status: accepted
completed: true
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

### Implementation record (2026-06-06; both-ways via direct MCP drives; PUSHED `2989b17c4..34bab050e`)

* **Fork commits:** R1 `2989b17c4` (atomic 4-call re-shape in `browser-session-tools.ts`: `rvf
  create` drops `--kind`, adds the REQUIRED `--dimension 768` (fork vector axis);
  `trajectory-begin/step/end` re-targeted to ruvector@0.2.25's real arg shapes `-c/--context`, `-a`,
  `-r`, `--success`, `--quality` — closes the un-merged Issue-#2015 half (upstream `905672021`) AND
  fixes the trajectory skew upstream still carries → direction-flips the fork above upstream's
  still-broken step-2), R2 `fb8006147` (TWO-part circuit fix per the DA-corrected scope: registry
  key `circuitBreakerController`→`circuitBreaker` AND `getStats()`→`getStatus()`;
  `rate_limit_status` returns real token-bucket fields or an honest capability-absent envelope — no
  hollow `{success:true}`), R3a `cb6b04a68` (in-process memory path replaces the per-call
  `npx @sparkleideas/cli@latest memory …` shell-out at :183/270/307), X1 `f2c975332` (PRICING
  Haiku-rate freshness note). Stack riders pushed in the same range: `f8ff12341` (ADR-0297
  loader-comment label fix), `34bab050e` (ADR-0294-X catch-gate rider).
* **Both-ways (direct MCP drives of published patch.415 vs the fixed bin, 2026-06-06):** published →
  record dies at step-1 (`--kind` arg error), `circuit_status` "not available" via the wrong key
  while `resource_usage` works, `rate_limit_status` hollow `{success:true}`, 30s+ shell tax per
  memory call; fixed → all PASS, honest-miss in single-digit seconds.
* **Wiring (patch repo `bc235d7`):** `scripts/smoke-adr0298-c6-reconvergence.mjs` — LOCAL `file://`
  targets only, no paid LLM calls; ruvector/agent-browser-absent assertions LOUD-SKIP, never
  silent-pass; a `resource_usage` registry sentinel distinguishes the published wrong-key/hollow bug
  from an uninitialized-registry SKIP, with a DA-path direct-registry fallback. Wired into
  `test-acceptance.sh` (source list + `run_check_bg` + `collect_parallel` group `adr0298`),
  `test-acceptance-fast.sh adr0298`, and CI `.github/workflows/v3-ci-c6-reconvergence.yml`
  (node-24). Ledger rows (R1/R2/R3a/X1): with this record's commit.
* **Recorded conditions:** no implementation-phase DA convened — the prior session terminated at the
  wiring commit, and this record is written post-hoc from commit + drive evidence (the review-phase
  DA had already corrected R2's scope to key+method and adjudicated R1 atomic-vs-split). The fork
  stack sat unpushed until this record's session pushed `2989b17c4..34bab050e`. R3b (general CLI
  cold-boot profile, ~26-31×) stays a recorded follow-up, not scope creep.
* Status stays `proposed`; flips with the release that turns `adr0298-c6-reconvergence` green.
