---
status: proposed
date: 2026-06-10
tags: [acceptance, browser-automation, agent-browser, resource-leak, perf-gate, dev-machine-hygiene]
supersedes: []
depends-on: []
implements: []
---

# Tear down / reap orphaned `agent-browser` headless Chrome (acceptance + browser-agent resource leak)

## Context and Problem Statement

The fork's browser tooling — the `ruflo-browser` plugin/agents AND the browser-path
**acceptance checks** — drives a headless Chrome via the npx package **`agent-browser`**
(`agent-browser-darwin-arm64`). Each run launches a fresh headless Chrome under a
per-session temp profile (`/var/folders/.../T/agent-browser-chrome-<uuid>`).

**The browser is never torn down when its launcher exits.** Observed live on the dev
machine 2026-06-10:

- **11 distinct `agent-browser` instances** alive simultaneously → **89 Chrome
  processes** (each instance = 1 main + ~8 GPU/renderer/utility helpers).
- **Every instance was orphaned — parent PID 1.** The process that invoked
  `agent-browser` had already exited *without* shutting down the Chrome it spawned,
  so Chrome + the `agent-browser` server outlived the session.
- **Accumulated over ~3 days** (process ages ranged from ~25 minutes to 3 days).
- Launch paths identify the leakers: most from **`/private/tmp/ruflo-accept-npxcache/_npx/...`**
  (the **acceptance-test** npx cache), the rest from `~/.npm/_npx/...` and
  `~/.ruflo/npx-cache/...` (browser agents / ad-hoc runs).
- They pin CPU **even when idle**: launched with `--enable-unsafe-swiftshader`
  (software GL), so the GPU/renderer helpers busy-spin rather than idling — the 11
  dead-session browsers were eating **~8–9 of 18 cores** (load avg ~16; dropped to
  ~9 within a minute of `pkill -9 -f '[a]gent-browser'`).

This is not a new phenomenon — it is the **root cause** of the recurring
acceptance **perf-gate contention** already recorded in
`memory/feedback-perf-gate-failure-check-machine-load.md` ("runaway Chrome …
failed `adr0261-benchmark` 3 consecutive runs … killing Chrome → green"). That
incident treated the symptom (kill Chrome, re-measure); this ADR addresses the
**source** so the leak stops recurring.

## Decision Drivers

- **Honest resource hygiene** — an acceptance run (or a browser agent) that
  silently leaves a headless browser running forever is the same class of
  unowned-side-effect defect the project's fail-loud/no-silent-fallback rules
  forbid elsewhere (ADR-0082 lineage).
- **Perf-gate reliability** — leaked browsers are external CPU contention that
  has already cost ~3 release cycles to a wrong "flaky" framing. Fixing the leak
  removes the contention at its source.
- **Dev-machine cost** — fans spinning for days; cores + RAM + disk (temp profiles)
  consumed by dead sessions.
- **Surgical, fork-only** — must not change `agent-browser`'s observable behavior
  for live sessions (it should still launch + drive Chrome); only guarantee teardown.

## Considered Options

1. **Do nothing / kill manually** (status quo). Rejected — recurring, wastes cycles,
   and the perf-gate symptom keeps re-appearing.
2. **Reaper only** — a sweep that kills orphaned `agent-browser-chrome-*` (PPID 1)
   + removes their temp profiles before and after the browser acceptance group.
   Pro: works regardless of whether we own `agent-browser`. Con: treats symptom;
   a long-running browser agent's *intentional* session must be excluded (only reap
   PPID-1 orphans, never live-parented ones).
3. **Teardown at the launch site** — wherever the fork launches `agent-browser`
   (browser acceptance checks + `ruflo-browser` tools/agents), wrap the browser
   lifecycle in `try/finally` (or `atexit`/signal handler) that closes the browser
   on normal exit, error, AND SIGINT/SIGTERM. Pro: fixes the source. Con: only
   covers launch sites we control; a crash that skips the handler still orphans.
4. **Both (recommended)** — teardown at every fork-controlled launch site +
   a defensive reaper in the acceptance harness for crash/SIGKILL escapes.

## Decision Outcome

**Proposed: Option 4 (teardown + defensive reaper).** Concretely:

1. **Investigate ownership of `agent-browser`** first — determine whether it is a
   fork-owned package (then add the teardown there) or third-party (then the
   teardown lives in *our* callers and we cannot patch the binary). Provenance-check
   per `feedback-no-consumer-is-not-stub` before assuming.
2. **Launch-site teardown:** every fork code path that starts `agent-browser`
   (the browser acceptance checks + `ruflo-browser` agent/session code) closes the
   browser in a `finally` and on `SIGINT`/`SIGTERM`, so a normal/handled exit never
   orphans.
3. **Defensive reaper:** the acceptance harness sweeps **orphaned** (`PPID == 1`)
   `agent-browser-chrome-*` processes + removes their temp profiles before AND after
   the browser group. **Reap ONLY PPID-1 orphans** — never a live-parented session
   (a running browser agent must survive).

> NOTE on scoping the kill: use the char-class self-match guard
> (`pkill -9 -f '[a]gent-browser-chrome'`) and gate on PPID==1 so an in-flight
> browser session is never killed.

## Consequences

- **Good:** the perf-gate contention source is removed; dev machine stops
  accumulating dead browsers; acceptance runs become hermetic w.r.t. browser state.
- **Cost / risk:** the reaper must be precise (PPID-1 only) or it could kill a live
  browser-agent session — covered by the acceptance check below.
- **Out of scope:** `agent-browser`'s own behavior for live use is unchanged; this
  only guarantees cleanup.

## Confirmation (acceptance — wire into `test-acceptance*.sh` + a workflow)

- After the browser acceptance group completes, assert **zero** orphaned
  `agent-browser-chrome-*` processes remain (`ps`-count == 0) and zero leftover
  `/var/folders/.../T/agent-browser-chrome-*` temp profiles.
- A negative-control test: a *live-parented* mock `agent-browser-chrome` process is
  NOT killed by the reaper (only PPID-1 orphans are).
- Per `feedback-always-wire-tests-into-cicd`: wire into both the runner
  (`run_check_bg` + `collect_parallel`) and `.github/workflows/`.

## Sequencing

Land this **before the Batch-U upstream merge (ADR-0313 / Wave 5)** — see the
agenda in `docs/plans/IMPLEMENTATION-PLAN-2026-06-10-outstanding-adrs-swarm.md`
and `docs/SESSION-HANDOVER-2026-06-10-wave-execution.md`. Rationale: Batch-U is a
~100-commit upstream sync whose acceptance/perf gates must run on a contention-free
machine; leaving the leak in place would re-introduce the false-flaky perf failures
during the most measurement-sensitive wave.
