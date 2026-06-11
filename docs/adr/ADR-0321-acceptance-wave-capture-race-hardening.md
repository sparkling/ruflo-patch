---
status: accepted
date: 2026-06-11
tags: [acceptance, harness, flaky-test, capture-race, perf-gate]
supersedes: []
depends-on: [ADR-0094, ADR-0314]
implements: []
---

# Acceptance-wave capture-race: command-output checks flake under self-load

## Context and Problem Statement

The acceptance wave (`scripts/test-acceptance.sh`) fans out hundreds of checks
with **no concurrency cap** (`run_check_bg` backgrounds each), so the run
self-loads. Under peak load, checks of the shape *"run a command, capture its
stdout, regex-match it"* intermittently fail with **"exited 0 but output did not
match"** — while the diagnostic body they print **clearly matches**. The capture
(`_run_and_kill_ro` → file → `cat`) races at match-time even though the command
succeeded and produced correct output.

Observed across release cycles, a **different check each run** (so it reads as a
mysterious one-off rather than a class):

- `p7-cli-init` — `ruflo init --help` exits 0 in 376 ms, body contains
  "init"/"Initialize", yet `/…init…/` "did not match".
- `p8-inv3-agent` — `agent_list` post-terminate body `{agents:[]}` (matches
  `/agents|list|\[\]/`) "did not match", **while running concurrently with the
  ADR-0314 browser group's live Chrome**.
- `adr0261-benchmark` — the P6 perf gate misses its target under concurrent
  wave load (the `feedback-perf-gate-failure-check-machine-load` class).

This is **NOT** an [[ADR-0314]] leak (its reaper + `adr0314-no-orphans` PASS in
the same runs) and is independent of any fork code change.

## Decision

Make the affected checks **load-tolerant via retry-once-on-transient** — re-run
the capture+match once when the first attempt is non-passing. This does **not**
weaken assertions (`feedback-no-squelch-tests`): a genuinely broken command
fails both attempts (non-zero exit or a persistent real mismatch); only a
transient capture race is rescued.

**Implemented (this ADR):**

- `_p7_cli_check` (`lib/acceptance-cli-commands-checks.sh`) — 2-attempt loop;
  covers all 8 P7 CLI checks. ✅
- `_expect_mcp_body` (`lib/acceptance-harness.sh`) — a thin retry-once-on-hard-
  FAIL wrapper around the renamed `__expect_mcp_body_once`. Retries only when
  `_CHECK_PASSED == "false"`; **never** retries a PASS or the `tool-not-found →
  skip_accepted` branch (a legitimate skip, not a transient). Covers the
  hundreds of INV / qual / claims / coordination / aidefence checks that route
  through `_mcp_invoke_tool` → `_expect_mcp_body`. ✅
- `_check_adr0261_smoke` (`lib/acceptance-adr0261-checks.sh`) — retry-once-on-
  nonzero for the perf benchmark (transient target-miss vs real regression). ✅

**Deferred (optional root, not needed now):**

- A concurrency cap in `run_check_bg` so the wave stops self-overloading — a
  single-point structural fix, but a bigger behavioral change to the ~900 s run.
  The per-helper retries above resolve the observed flakes without it; revisit
  only if the capture race recurs in a helper not covered above.

## Consequences

- Good: all three observed flaky helpers are now load-tolerant — the P7 CLI
  family, the entire `_mcp_invoke_tool` → `_expect_mcp_body` class (INV / qual /
  claims / coordination / aidefence, hundreds of checks), and the adr0261 perf
  gate. The recurring "different check flakes each run" symptom is addressed at
  the three shared helpers rather than per-check.
- Neutral: a residual race in a capture helper NOT covered above could still
  surface; the optional `run_check_bg` concurrency cap is the structural backstop
  if so. Killing stray Chrome + running at low load first remains good practice
  (`feedback-perf-gate-failure-check-machine-load`).

## Confirmation

All three helpers (`_p7_cli_check`, `_expect_mcp_body`, `_check_adr0261_smoke`)
hardened: `bash -n` clean, `lint-acceptance-checks` findings `[]`. Closure
confirmed by a green acceptance run with no capture-race fails.
