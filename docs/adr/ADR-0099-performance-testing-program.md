# ADR-0099: Performance Testing Program — Budgets, Not Gates

- **Status**: Proposed 2026-04-22 — hive-designed (queen + devil's advocate); still pending. Last reviewed 2026-05-03: no `npm run test:perf` script, no `tests/benchmarks/wallclock/` directory, no `docs/reports/perf/` baselines/anchors/HISTORY.md, `flash-attention-benchmark.mjs` unchanged (no `--promote`/`--calibrate` flags); ADR-0100 §4 Scenario F explicitly references this ADR as "perf program not yet shipped"; no successor; no regression reports forcing prioritization.
- **Date**: 2026-04-22
- **Scope**: New `npm run test:perf` suite, out-of-band from the cascading pipeline (ADR-0038); new `tests/benchmarks/wallclock/*.mjs` + port of existing `tests/benchmarks/flash-attention-benchmark.mjs`; new `docs/reports/perf/` artifact area (gitignored runs, committed anchor baselines); paired unit tests per ADR-0097. NO change to `test:acceptance`.
- **Related**: ADR-0038 (cascading pipeline), ADR-0069 F3 (existing Flash Attention perf claim), ADR-0081 (M5 Max hardware baseline), ADR-0090 (acceptance throughput concerns), ADR-0094 (acceptance coverage — **explicitly not extended** here), ADR-0097 (paired check-code tests).

## Context

We have exactly two perf-affecting incidents in project history:

1. **ADR-0069 F3** — Flash Attention must be ≥ 2× the JS fallback. Defended by one ad-hoc bench (`tests/benchmarks/flash-attention-benchmark.mjs`) that runs on request, has no CI gate, no historical baseline, no regression detection.
2. **Memory `reference-cli-cmd-helper`** — raw `npx @sparkleideas/cli@latest` serializes on npm's 23GB cache lock, producing 36× slowdown. Found by acceptance runtime explosion, not by a perf test. The fix is a convention (`$(_cli_cmd)`), not a regression harness.

Neither incident shipped a user-visible regression. There is no logged bug where a user complained "ruflo got slower." The honest scope of this ADR is therefore:

- **Defend the claims we already publish** (F3's 2×).
- **Probe user-visible cold paths** we think are slow but have never measured (`ruflo init --full`, MCP cold spawn).
- **Catch obvious drift** in the 3 components where regression would silently degrade the product.

**Not in scope:** building a general-purpose regression suite for components nobody has complained about. The devil's-advocate YAGNI objection is accepted — we build a **lightweight probe + budget tracker**, not a gate.

Hardware constraint dictates most design decisions: development happens on one M5 Max (36 GB, macOS Tahoe — ADR-0081, memory `user_machine`). N=1 box, no CI cluster. Any design that assumes statistical validity across machines is disqualified.

## Decision

### 1. Scope — what to test (3 workloads, not 6)

Cut from the initial 6 to 3 on YAGNI grounds. Each has a named motivating signal.

**1.1 Flash Attention — absolute wallclock + ratio (motivating: ADR-0069 F3)**
- Shapes: `(256, 256)` and `(768, 256)` — dropped the 6-shape matrix; pick the two where the 2× claim lives.
- Primary metric: absolute p50 per op in microseconds. Ratio (native vs JS fallback) reported as secondary.
- Budget: p50 native ≤ `X` µs (anchor = calibrated median of N=5 runs on `--promote --calibrate`), p50 ratio ≥ 2.0×. Noise floor: ±15% relative. **Initial `--promote` without prior baseline REQUIRES `--calibrate`** — prevents anchoring to a single pathological run (second-order review, Flaw 4).

**1.2 `ruflo init --full` cold wallclock (motivating: devil's-advocate CRITICAL — missing user-visible path)**
- Fresh `/tmp` dir, warm npm cache (Verdaccio running), via `$(_cli_cmd)` — NEVER via raw `npx @sparkleideas/cli@latest`.
- Primary metric: absolute wallclock p50 of 3 runs. Secondary: peak RSS.
- Budget: wallclock p50 ≤ `Y` s (anchor = calibrated median of N=5 runs on `--promote --calibrate`, + 25% headroom). No ratio, no multi-version comparison — this is the ceiling on "how long a user waits on first impression."

**1.3 MCP tool-call cold + warm round-trip (motivating: hooks fire on every Edit/Write)**
- Cold: spawn `ruflo mcp start` stdio server + first `swarm_status` call. Warm: 20 subsequent `swarm_status` calls in the same process.
- Primary metrics: cold p50 wallclock (single number, N=5 runs of the cold case), warm p95 over 20 calls within one run (N=3 runs).
- Budget: cold p50 ≤ 1500 ms, warm p95 ≤ 50 ms.

**Rejected** (with the devil's advocate's rationale):
- **RVF at 1M vectors** — vanity; no user project approaches this. Cap RVF testing at 10k (the largest tier acceptance already exercises). Deferred as 1.4 in a later ADR iff an acceptance check discovers regression at the 10k tier.
- **Pipeline step wallclock (build, publish, acceptance)** — already logged by `deploy-finalize.sh`; wrapping logs in thresholds is budget-tracking, not regression-testing. Keep in finalize, out of this ADR.
- **Hook overhead** — would require instrumenting hooks without a concrete regression signal. Defer until someone ships a slow hook.
- **Upstream-dominated benches** (ONNX, better-sqlite3 query plans, Node startup) — we cannot fix regressions there. Excluded on principle.

### 2. Methodology — how to test

**Harness: minimal, no new dependency.** Use `node:perf_hooks` only. Reject `mitata`/`tinybench` — adding a dev dep to measure 3 workloads is over-engineering; the existing Flash Attention bench already proves `perf_hooks` is sufficient for the precision we need.

**Per-workload (warmup, measure) tuples, not a global constant**:
- 1.1 Flash Attention: warmup=5, measure=adaptive (run until stddev/mean < 0.05 or 1000 iterations — replaces blind `MEASURE_ITERATIONS=100`).
- 1.2 `ruflo init --full`: warmup=0, measure=N=3. Cold start IS the measurement.
- 1.3 MCP cold: warmup=0, measure=N=5. MCP warm: warmup=2 calls, measure=N=20 calls within a process.

**N=1 machine discipline.** The devil's advocate CRITICAL objection is accepted: one M5 Max is not a statistically valid fleet. We compensate with:
- **Within-run A/B** for ratios (1.1) — native vs JS in the same process, same thermal state, interleaved iterations.
- **K-of-N consecutive-run gating** for budgets — a budget is considered breached only when 3 consecutive runs exceed the threshold. One flaky run is ignored.
- **Mandatory pre-run cooldown** — suite aborts if 1-minute load average > 0.5. After any `npm run build` or heavy CI step, wait 60 s before `npm run test:perf`.
- **No cross-run comparison across hardware** — if the machine changes, all baselines invalidate (error, not warn).

**CLI invocation rule.** Every benchmark that invokes the CLI uses `$(_cli_cmd)` resolution, never `npx @sparkleideas/cli@latest`. Referenced by slug in-file: `# memory: reference-cli-cmd-helper`. Paired unit test asserts the string `npx @sparkleideas/cli@latest` does not appear in any `tests/benchmarks/**` file.

**Published vs unpublished code.** 1.1 tests unpublished fork source (microbench of the kernel — what we ship is what we built). 1.2 and 1.3 test a published `-patch.N` via `$(_cli_cmd)` (what users install).

**Pipeline placement.** Fully out-of-band. `npm run test:perf` is a standalone script. NOT in `preflight`, NOT in `test:unit`, NOT in `test:acceptance`, NOT in `deploy`. Reasons: (a) M5 Max thermal would pollute every acceptance run; (b) `feedback-never-full-acceptance` bans preemptive full runs; (c) ADR-0090 already flags acceptance throughput. Invoked manually; optionally wired into `finalize` as advisory (warn-only).

**Pyramid fit.** Perf is a **modifier on integration tests**, not a 4th level. Each benchmark must exercise a code path that already has a correctness integration test — if the correctness test is gone, the benchmark is gone.

### 3. Measurement — how to measure

**Primary metric: absolute wallclock / latency, not ratio.** A 15 s → 30 s regression matters even if a 2× speedup ratio is preserved. Ratios (F3) are secondary.

**Percentile choice:**
- Microbenches (1.1): **p50 primary, p95 secondary** (requires N ≥ 200 sampled iterations for p95 to be meaningful).
- Wallclock (1.2, 1.3-cold): **p50 only** at N=3–5. p95 is not credible at that N.
- Warm stream (1.3-warm): **p95** over 20 calls in one process.

**Explicitly banned:** reporting mean ± stddev as headline numbers. M5 Max mean is dominated by occasional macOS Spotlight / timer outliers.

**Secondary metrics (reported, not gated):** `process.memoryUsage().rss` delta, GC event count from `v8.getHeapStatistics`, wall/CPU ratio (catches thermal throttling).

**Baseline storage — dual anchor:**
- **Acute baseline**: last committed `docs/reports/perf/baseline/<workload>.json`. Updated only by explicit human action (`npm run test:perf -- --promote`). Diff-reviewable in PR. **First-time baseline creation requires `--promote --calibrate`** — the `--calibrate` flag enforces N=5 runs, discards high/low, commits the median as anchor. Subsequent `--promote` may use the workload's standard N.
- **Drift anchor**: `docs/reports/perf/anchors/<YYYY-QQ>.json` — one per quarter, rotated on calendar, serves as long-arc drift detector ("are we 30 % slower than Q2 2026?").
- Per-run artifacts go in gitignored `docs/reports/perf/runs/<sha>.json` — not committed, not reviewed.
- RVF rejected for baselines: `project-rvf-primary` mandates RVF for runtime memory, not for human-reviewable config. Baseline shifts need `git diff` visibility.

**Regression detection — stability-aware, not fixed-percent:**
```
BREACH = (last 3 consecutive runs all exceed baseline p50 by >15%)
         AND (absolute delta > 2× the stddev of the last 5 runs)
```
Fixed 15%-of-mean is flake-prone on N=1; K-of-N + noise-floor is the minimum that is both sensitive and reliable. Precisely because `feedback-no-fallbacks` bans silent retry, the K-of-N requirement is explicit and visible — it is NOT a retry, it is a stability filter with a hard 3-run floor.

**Upstream-bump rebaseline workflow.** When Node, ONNX, or `better-sqlite3` bumps: one green run after the bump is required to re-promote baselines, via the same `--promote` flag, with a commit message referencing the upstream version change. No automatic rebaseline. No blanket accept.

### 4. Reporting — how to report

**Console (local):** mirror `flash-attention-benchmark.mjs` output style. Three columns: workload, p50 / p95, verdict (`PASS`, `BUDGET <delta>`, `STALE`, `COOLDOWN`). Human-readable in 10 s.

**Artifact (per run):** JSON schema written to gitignored `docs/reports/perf/runs/<sha>.json`:
```json
{
  "workload": "ruflo-init-full",
  "params": {...},
  "env": {
    "node": "22.x",
    "arch": "arm64",
    "cpu": "M5 Max",
    "commitSha": "...",
    "depsHash": "...",
    "cliResolution": "/tmp/ruflo-accept-xxxx/node_modules/.bin/ruflo"
  },
  "metric": {"p50_ms": 32100, "p95_ms": 36200, "samples": 3},
  "memory": {"rssDeltaMB": 410},
  "verdict": "pass",
  "baselineDeltaPct": -3.2,
  "runOrderWarn": null
}
```

`env.cliResolution` is the resolved CLI path, captured so the harness can self-assert it came from a Verdaccio/local install and NOT from `npx` global cache (see second-order review, Flaw 3).

**Budgets, not gates.** PR CI: no gating. Publish pipeline (`npm run publish:fork`): `test:perf` runs advisory; breach emits a `[WARN]` and a one-line PR comment, but does not block. The ADR's explicit position: we cannot build a credible gate on N=1 thermal, and a flaky gate invites bypass culture worse than no gate (devil's-advocate CRITICAL `feedback-no-fallbacks` objection).

**ADR-0094 carve-out.** Perf is **not** an ADR-0094 acceptance coverage entry. Acceptance stays binary (correctness, gate). Perf stays advisory (budget, warn). No cross-coupling. Explicit statement so a future contributor doesn't add `check_perf_*` to the coverage catalog.

**ADR-0097 paired tests — what "check-code quality" means for a perf harness.** Four tests per workload (the first three London-school with mocked timers, the fourth an integration smoke test):
1. Percentile math: feed a known `[1, 2, 3, ..., 100]` and assert p50=50, p95=95.
2. K-of-N stability: feed synthetic run history `[ok, ok, ok, breach, breach, breach]` and assert breach only on the 6th, not the 4th.
3. Planted-regression detection: mock a workload that takes 2× baseline; assert the harness reports `verdict: "regressed"` with correct `baselineDeltaPct`.
4. **Harness smoke** (second-order review, Flaw 3): run the real benchmark end-to-end once; assert (a) `metric.p50_ms` is a finite positive number (not `undefined`, not `NaN`), (b) `env.cliResolution` matches a `/tmp/ruflo-accept-*` or local `node_modules/.bin` pattern — NOT `npx-cache`, NOT an empty string, NOT `@latest`. Catches silently-broken resolvers that the grep-based forbidden-string check cannot see (bash-vs-mjs crossed-language gap in `_cli_cmd` helper).

Tests 1–3 assert **measurement math**, never numeric timing values — timing assertions in unit tests are flakes waiting to happen. Test 4 asserts **plumbing**, not timing — it runs the real harness but only gates on whether the output shape and CLI resolution are sane.

**Human-visible history.** `docs/reports/perf/HISTORY.md` — append-only, one row per `--promote` with commit SHA, date, workload, delta vs previous baseline. Markdown grep beats any dashboard we would build and then abandon.

**Acceptance surface.** One line printed at the start of `test:acceptance` summary: `[perf] baseline <YYYY-MM-DD>, last promote <sha>, 3 workloads tracked` (pulled from committed `docs/reports/perf/baseline/*.json` mtime + `HISTORY.md` head — NOT from gitignored `runs/`). Reads committed truth so the line works on every clone, every teammate's machine, and any replacement M5 Max — not just the one laptop that ran `--promote` last (second-order review, Flaw 1). No other coupling. Zero cost, surfaces staleness, doesn't block.

**Staleness forcing function.** `npm run publish:fork` refuses to proceed if the most recent `docs/reports/perf/baseline/*.json` mtime is >30 days old OR if `HISTORY.md` has no entry within 30 days. The refusal is bypassable with `--skip-perf-check` (which prints `[WARN] publishing without fresh perf baseline — last promote: <sha> <date>` loudly in the deploy log). This is a nudge, not a gate — it does not block publish, but it forces a visible human decision every 30 days. Without this, `--promote` gating + quarterly rotation + machine invalidation compose into "suite never runs" (second-order review, Flaw 2 — devil and queen converged on this one).

## Alternatives

### A. Full regression suite at 6 workloads
**Pros**: comprehensive; catches anything, anywhere.
**Cons**: 3× maintenance for 0× signal (YAGNI objection CRITICAL). Half the workloads have no motivating incident. Rejected.

### B. CI gate instead of warn-only
**Pros**: guarantees regressions can't ship.
**Cons**: N=1 thermal + `feedback-no-fallbacks` + `feedback-never-full-acceptance` collide — a gate would either flake (auto-bypass culture) or use silent retries (banned). Rejected.

### C. In-pipeline as `test:acceptance` phase
**Pros**: one command runs everything.
**Cons**: contradicts ADR-0090 throughput, contradicts `feedback-never-full-acceptance`, contradicts devil's-advocate CRITICAL thermal argument. Rejected.

### D. `mitata`/`tinybench` harness
**Pros**: better statistical methods.
**Cons**: dev-dep bloat for 3 workloads; `node:perf_hooks` is sufficient at this scope. Revisit if suite grows past 5 workloads. Deferred.

### E. RVF-stored baselines
**Pros**: aligns with `project-rvf-primary`.
**Cons**: baseline shifts invisible in `git diff`; PR review fails silently. Rejected for baselines specifically. Runtime perf memory, if added later, may still live in RVF.

### F. Last-`-patch.N` as baseline
**Pros**: always fresh.
**Cons**: incremental drift (3% per patch × 10 patches = 30% invisible decay). Rejected in favor of dual acute + quarterly anchor baselines.

### G. Pure fixed-percent regression threshold (e.g., "fail at 15% delta")
**Pros**: simple.
**Cons**: on N=1 M5 Max, run-to-run variance is 10–20%; either flakes or misses real regressions. Rejected in favor of K-of-N + noise-floor.

## Consequences

**Positive:**
- ADR-0069 F3 claim gains a defended regression boundary instead of a one-shot ad-hoc bench.
- User-visible `ruflo init --full` and MCP cold-spawn get measured for the first time; anchor values become known.
- Acceptance suite untouched — no throughput hit, no new flake surface in the ship gate.
- Paired unit tests per ADR-0097 mean the harness itself is trusted before its numbers are.

**Negative:**
- Warn-only semantics mean a real regression CAN ship. Mitigated by publish-pipeline `[WARN]` surface, 30-day staleness forcing function on `publish:fork`, and acceptance-phase `[perf]` staleness line.
- One more `docs/reports/perf/` area to maintain. Mitigated by runs being gitignored and quarterly anchor rotation being calendar-driven, not event-driven.
- N=1 hardware remains the single point of trust. Any future CI cluster re-opens this ADR.
- **Microbench-heavy workload mix** (second-order review, Flaw 5 — ACCEPT): 2 of 3 workloads (1.1, 1.3) are kernel-level microbenches; only 1.2 is a user-path integration measurement. An upstream-composition regression that doesn't hit `init --full` but slows real user workflows will evade this suite. In that scenario, acceptance runtime drift (already logged by `deploy-finalize.sh`) is the first-line detector, and a 4th workload is added per the §Consequences revisit trigger. Debt named rather than hidden behind the "lightweight" framing.

**Neutral / deferred:**
- RVF at 10k/100k/1M deferred — revisit if an acceptance check discovers 10k-tier regression.
- Hook overhead deferred — revisit when a user ships or reports a slow hook.
- Pipeline-step wallclock tracking stays in `deploy-finalize.sh`, not here.

## Adversarial Review Outcome (2026-04-22)

| Flaw (devil's advocate) | Severity | Disposition |
|---|---|---|
| YAGNI — no logged perf incidents in this repo | CRITICAL | **Accepted** — scoped down from 6 to 3 workloads, all with named motivating signals; reframed as budget tracker not regression suite |
| Missing `npm install` + `init --full` | CRITICAL | **Accepted** — `init --full` is 1.2, top-priority |
| N=1 machine, no statistical validity | CRITICAL | **Accepted** — explicit K-of-N consecutive-run gating, mandatory cooldown, within-run A/B for ratios |
| `_cli_cmd` vs `npx @latest` 36× trap | CRITICAL | **Accepted** — invocation rule + paired unit test that scans for forbidden string |
| Pipeline placement in `test:acceptance` | CRITICAL | **Accepted** — fully out-of-band, `npm run test:perf` standalone |
| Fixed threshold flake-vs-miss | CRITICAL | **Accepted** — K-of-N + noise-floor replaces fixed 15% gate |
| Thermal throttling | CRITICAL | **Accepted** — pre-run load-average check, 60 s cooldown after builds |
| ADR-0094 coupling = ship blocker | CRITICAL | **Accepted** — explicit carve-out, perf is NOT an acceptance entry |
| Budget vs gate conflation | CRITICAL | **Accepted** — declared budget; warn-only publish path; no gate anywhere |
| 1M HNSW vanity | HIGH | **Accepted** — capped at 10k, RVF tier deferred |
| Upstream-dominated benches | HIGH | **Accepted** — ONNX/SQLite/Node benches excluded by principle |
| Speedup ratios hide absolute regression | HIGH | **Accepted** — absolute wallclock primary, ratios secondary |
| Warmup=10/measure=100 blindly reused | HIGH | **Accepted** — per-workload (warmup, measure) tuples |
| Unpublished vs published code conflation | HIGH | **Accepted** — 1.1 unpublished, 1.2/1.3 published via `$(_cli_cmd)` |
| Mean as headline | HIGH | **Accepted** — p50 primary, mean banned as headline |
| `docs/reports/perf/` git bloat | MEDIUM | **Fixed** — runs gitignored, only baselines + quarterly anchors committed |
| Baselines in git cause diff pollution | MEDIUM | **Accepted** — reviewable diff is the point; frequency limited by explicit `--promote` |
| No rebaseline workflow for upstream bumps | HIGH | **Fixed** — named workflow: green run + `--promote` with commit referencing version |
| Build-phase heat cross-contamination | HIGH | **Fixed** — 60 s cooldown + load-avg check before suite |
| ADR-0097 paired-test handwave | MEDIUM | **Fixed** — three specific unit-test patterns named (percentile math, K-of-N stability, planted regression) |
| Schema designed, never read | MEDIUM | **Accepted** — `[perf]` line in acceptance summary is the minimum consumer; `HISTORY.md` is human-grep target |
| Maintenance forever | HIGH | **Accepted** — scope cut to 3 workloads with named incidents; revisit threshold before adding a 4th |

Net: every CRITICAL and HIGH objection moved the design. Scope cut from 6 → 3 workloads, harness from `mitata` → `node:perf_hooks`, semantics from gate → budget, pipeline placement from cascading → fully out-of-band.

## Hive Synthesis (2026-04-22)

This ADR is the output of a 2-voice design debate.

- **Hive ID**: `hive-1776893121206-lsu07u` (topology: hierarchical, consensus: byzantine, queen: `perf-adr-queen`)
- **Workers** (spawned 2026-04-22 21:25 UTC):
  - `perf-queen-1776893124304-theq` (proposal)
  - `devils-advocate-1776893124883-0oqu` (pre-mortem)
- **Memory keys**:
  - `adr-0099/topic` — framing + 4-question structure
  - `adr-0099/synthesis-notes` — scope cuts + CRITICAL objection disposition

Key captured objections that survived into the decision:

1. **"No logged perf incidents — this is premature optimization."** Accepted in full: scope cut from 6 to 3 workloads; each with a named motivating signal (F3 claim, user-visible cold start, hook-call cliff). Reframed from "regression suite" to "budget tracker + probe."
2. **"N=1 machine disqualifies statistical gating."** Accepted: no gate anywhere. Explicit K-of-N consecutive-run stability filter and mandatory cooldown replace percentage thresholds.
3. **"Coupling to ADR-0094 makes perf a ship blocker."** Accepted: explicit carve-out line in the ADR; perf is never an acceptance entry, never gates deploy.

The devil's advocate objection that did NOT move the decision: "Schema designed, never read." The answer (minimum consumer is the acceptance summary line + `HISTORY.md` grep target) was judged sufficient without building a dashboard.

## Second-Order Adversarial Review (2026-04-22 — same day, different hive)

After the first-order review produced the ADR above, a **second** hive was convened to attack the result. Target: the decisions the first round defended, the scope cuts the first round celebrated, and the internal contradictions that survived both voices. Review style: ADR-0087 3-flaw / 3-year hindsight (devil finds the 3 most likely 2029 regrets; queen judges dispositions).

- **Hive ID**: `hive-1776894758640-9e8cx6` (topology: hierarchical, consensus: byzantine, queen: `adr0099-review-queen`)
- **Workers** (spawned 2026-04-22 21:52 UTC):
  - `review-queen-1776894762149-ub8b` (anticipated-disposition ruling)
  - `review-devil-1776894763298-smiw` (3-flaw / 2029-regret memo)
- **Memory key**: `adr-0099/second-order-review`

### Reconciliation: devil's actual flaws vs. queen's anticipated flaws

The devil named 3, the queen pre-committed dispositions on 3. They **overlapped on 1** (Flaw 2 below — staleness / no forcing function). The remaining 4 are queen-only or devil-only surfaces, all real. Together: 5 flaws.

| # | Flaw | Source | Severity | Disposition |
|---|---|---|---|---|
| 1 | `[perf]` acceptance line reads from gitignored `runs/` → line is structurally absent on fresh clone / new machine / teammate's laptop | Devil's advocate | HIGH | **FIXED** — §4 now reads from committed `baseline/*.json` mtime + `HISTORY.md` head, not `runs/` |
| 2 | `--promote` gating + quarterly rotation + machine invalidation compose into "suite never runs" — harness passes paired tests forever while producing zero real signal | **Devil AND queen converged** | CRITICAL | **FIXED** — §4 staleness forcing function: `publish:fork` refuses if baseline >30 days stale, bypassable with `--skip-perf-check` that prints a loud `[WARN]` |
| 3 | `$(_cli_cmd)` is a bash helper — `.mjs` harness cannot call it; grep-based forbidden-string test passes even when resolver silently falls through to `npx @latest` and contaminates 2+ years of `HISTORY.md` with 36×-inflated numbers | Devil's advocate | CRITICAL | **FIXED** — schema now has `env.cliResolution`; paired test #4 asserts it matches `/tmp/ruflo-accept-*` or local `node_modules/.bin`, not npx-cache; assert `metric.p50_ms` is finite positive (not `undefined`/`NaN`) |
| 4 | Baseline bootstrap contamination — "anchor to first run" bakes in whatever transient pathology happened that Tuesday; no N=5-calibration protocol | Queen (anticipated) | HIGH | **FIXED** — §1.1/§1.2 anchors are now "calibrated median of N=5 runs on `--promote --calibrate`"; initial baseline creation REQUIRES `--calibrate` |
| 5 | Microbench-heavy scope: 2 of 3 workloads (1.1 Flash Attention, 1.3 MCP) are kernel-level; only 1.2 is a user-path integration. Upstream-composition regressions that don't hit `init --full` will evade this suite | Queen (anticipated) | MEDIUM-HIGH | **ACCEPTED** — debt named in Consequences/Negative; live mitigation is `deploy-finalize.sh` acceptance-runtime drift (how the 36× `_cli_cmd` trap was originally caught), with §Consequences revisit trigger for a 4th workload |

### Devil's 2029 failure scenarios (condensed)

- **Flaw 1**: *"April 2029. The M5 Max has been replaced. A new contributor clones ruflo-patch fresh, runs `npm run test:acceptance`, and sees `[perf] no recent run`. The one consumer the ADR designed for only ever worked for one person on one box."*
- **Flaw 2**: *"Acute baseline last touched 2026-09. Q4-2026 anchor exists; Q1-2027 onward missing — nobody was on-call for the calendar. 234+ deploys have shipped, Flash Attention silently drifted to 1.3× JS, and nobody knows because `test:perf` hasn't run against a fresh baseline in 30 months. The ADR achieved 'not being a flaky gate' by achieving 'not existing.' Theater in the precise sense `feedback-no-fallbacks` warns about."*
- **Flaw 3**: *"Every `HISTORY.md` entry after 2026-06 is inflated 36× because the `.mjs` benchmark called `spawnSync('bash', ['-c', '$(_cli_cmd) init --full'])` without sourcing the helper — `_cli_cmd` expanded to empty, fell through to literal `ruflo` or `npx @latest`. Two years of numbers are garbage."*

### Net judgment (devil's own)

> *"These three flaws compose into one meta-flaw: ADR-0099 has no forcing function for its own use and no self-test that the harness produces meaningful numbers. Individually none invalidates the ADR — it can still ship. Together they describe the likely 2029 end-state: a beautifully-designed budget tracker that ran 6 times in its life. Ship-with-debt, but the debt is specifically 'three edits that close the self-maintenance loop' — not 'rewrite the ADR.' All three preventive edits fit in one follow-up commit. The first-order review correctly caught that the ADR must not become a flaky gate; it missed that the opposite failure — becoming an unread artifact — is the more probable 3-year outcome on an N=1 laptop with no CI."*

All three edits were folded into the ADR body directly (not deferred to a follow-up commit). Queen's two additional anticipated flaws (4 and 5) were also folded in — 4 as FIX, 5 as ACCEPT with documented debt. Net structural change vs. the first-order draft:

- §1 anchors gain `--calibrate` requirement
- §3 Baseline storage specifies N=5 median for initial baseline
- §4 schema gains `env.cliResolution` field
- §4 paired tests go from 3 → 4 (the 4th is a plumbing-not-timing smoke test)
- §4 acceptance surface rewires to committed baselines (not gitignored runs)
- §4 gains explicit 30-day staleness forcing function on `publish:fork`
- §Consequences/Negative gains microbench-mix debt disclosure

**The ADR ships with zero follow-up debt from the second-order review.** All four FIX flaws are textually addressed above; the one ACCEPT flaw is named where future readers will see it rather than hidden in the first-order "lightweight" framing. Third-order review was not requested and is not planned.
