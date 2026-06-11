---
status: proposed
date: 2026-06-11
tags: [acceptance, harness, flaky-test, capture-race, perf-gate, partial]
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

**Implemented (this ADR, partial):**

- `_p7_cli_check` (`lib/acceptance-cli-commands-checks.sh`) — wrapped the
  capture+match in a 2-attempt loop; covers all 8 P7 CLI checks. ✅

**Deferred (tracked here, not yet done — the careful part):**

- `_expect_mcp_body` (`lib/acceptance-harness.sh`) — the shared MCP-invoke
  helper behind p8/INV checks. Needs the same retry **without** retrying its
  `tool-not-found → skip_accepted` branch (that's a legitimate skip, not a
  transient) — a more delicate refactor of a heavily-shared helper.
- `_check_adr0261_smoke` (`lib/acceptance-adr0261-checks.sh`) — retry the perf
  benchmark once on a target miss.
- **Root option (evaluate):** a concurrency cap in `run_check_bg` so the wave
  stops self-overloading — a single-point fix, but a bigger behavioral change to
  the ~900 s run that needs its own validation.

## Consequences

- Good: the most common flaker (P7 CLI family) is now load-tolerant.
- Neutral: the deferred helpers can still flake until hardened; a release may
  need a re-run (mitigated by killing stray Chrome + running at low load first,
  per `feedback-perf-gate-failure-check-machine-load`).
- The partial status is deliberate (shipped per a "ship now, harden the shared
  helpers carefully later" decision, 2026-06-11).

## Confirmation

`_p7_cli_check`: `bash -n` clean, `lint-acceptance-checks` findings `[]`. Full
closure = the two deferred helpers hardened (or a concurrency cap) + a green
acceptance run with no capture-race fails.
