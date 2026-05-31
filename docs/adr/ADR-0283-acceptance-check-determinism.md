---
status: accepted
date: 2026-05-31
tags: [acceptance, determinism, intelligence, browser, flakiness, fix]
supersedes: []
depends-on: []
implements: []
---

# Make two non-deterministic acceptance checks predictable (no re-run-and-hope)

## Context and Problem Statement

The patch.366 release surfaced two acceptance failures — `e2e-0059-intel-graph`
and `p4-br-eval` — that had *passed* in patch.365 three hours earlier on the same
code minus the agentdb-CLI fixes. Neither subsystem has any path to those fixes,
so the temptation was to call them "flaky" and re-run. That is wrong: a test that
passes "almost always" is a broken test. A re-run hides non-determinism; it does
not fix it. Both failures had concrete, reproducible root causes that only
manifest under machine load — exactly the conditions a parallel acceptance run
creates.

1. **`intel-graph` — a shared-temp atomic-write race.** The generated
   `intelligence.cjs` helper's `writeJSON()` wrote via a **fixed** temp name
   (`p + ".tmp"`) then `fs.renameSync(tmp, p)`. When parallel writers share a
   data dir (the e2e-0059 sub-checks share one `E2E_DIR`), one process renames
   `p.tmp` away while another is between its write and rename → the second
   `renameSync` throws **`ENOENT`**. That is the exact crash observed
   (`Intelligence init failed: node:fs:1012 binding.rename`). A deterministic
   two-writer interleaving reproduces it: shared temp → `ENOENT`; per-process
   temp → `OK`.

2. **`browser_eval` — a stale persistent browser-session daemon.** `agent-browser`
   (which `browser_eval` shells out to) runs a **persistent per-session browser
   daemon** over a UNIX socket (`~/.agent-browser/<session>.sock` + `.pid`); the
   browser tools use the `default` session. A **stale/stuck `default` session**
   left by a prior run makes `agent-browser eval` HANG connecting to it; the cli's
   60s tool timeout then fires as `spawnSync npx ETIMEDOUT`, no result, a flaky
   FAIL. It passed in 2.9s in patch.365 (fresh session); the budget appeared to
   grow 15s→17s→60s+ across the patch.366 retries as the **stale session
   persisted** — the npx/timeout was the symptom. Verified directly: a stale
   session hangs 90s+; a fresh one returns `{"result":2}` in ~2s. (Secondary
   contributor: agent-browser is provisioned via on-demand `npx --yes
   agent-browser` — not installed — whose resolution can also ETIMEDOUT on a cold
   cache under load. agent-browser@0.27.0 is available on npm + Verdaccio.)

## Decision Drivers

* **Tests must be predictable.** Determinism is the property; re-running is not a
  remedy. Each fix must remove the non-determinism, not paper over it.
* **Fix the cause at the right layer.** The race is in the atomic-write helper;
  the timeout is in the check's budget. Neither is in the subsystem under test.

## Considered Options

* **A — re-run until green.** REJECTED: hides the defect; the user's standing
  rule is predictability, not luck.
* **B — skip-accept both under load.** REJECTED: "skip" dodges the test, it does
  not make it deterministic.
* **C — fix the determinism at the cause (chosen):** per-process temp names for
  the atomic write; size the browser timeout to the operation's real worst-case.

## Decision Outcome

Chosen option: **"C — fix the determinism at the cause."**

### Rules

* **R1 — per-process-unique temp (intelligence writeJSON).** The atomic-write
  temp name is `p + "." + process.pid + ".tmp"` instead of `p + ".tmp"`, so
  concurrent writers never share a temp file; the final `rename(tmp → p)` stays
  atomic (last writer wins on `p`; POSIX rename is atomic). Applied in the cli
  generator `init/helpers-generator.ts` (`generateIntelligenceStub`, which the
  published cli deploys) **and** the patch repo's tracked full helper
  `.claude/helpers/intelligence.cjs`.
* **R2 — clean agent-browser session per run (primary); warm its npx cache.** The
  acceptance setup kills any lingering agent-browser daemon and clears the
  `default` session (`~/.agent-browser/default.*`) so each run starts fresh,
  eliminating the stuck-session hang. It also pre-warms the agent-browser npx
  cache (`npx --yes agent-browser --version`, background, best-effort — no browser
  launch, no session created) so the on-demand resolution is a cache-hit. The
  `browser_eval` check timeout is raised 15s→60s as headroom. With a fresh
  session browser_eval is a ~2s pass; the verdict is determined by browser
  correctness, not leftover session state.

### Consequences

* Good: both checks are determined by behavior, not load. The `ENOENT` race is
  structurally impossible (no shared temp); the browser check is no longer raced
  by its own under-sized timeout.
* Neutral: per-process temp files can be orphaned if a process is killed
  mid-write (the fixed-name version had at most one, but raced); harmless leftover
  in `.claude-flow/data`, cleared by the ADR-0210 data-clear path.
* Neutral: a genuinely hung browser now waits up to 60s before the check fails —
  only on the hang path; the common path is unchanged.

### Confirmation

* **R1**: deterministic two-writer interleaving — shared temp throws `ENOENT`
  (the production crash), per-pid temp returns `OK`. The rebuilt generator emits
  the per-pid temp; cli unit tests stay green.
* **R2**: clearing the stale `~/.agent-browser/default.*` session makes
  `agent-browser --session default eval 1+1` return
  `{"success":true,"data":{"result":2}}` in ~2s — it hung 90s+ against the stale
  session. agent-browser@0.27.0 is present on npm + Verdaccio; the npx warm-up
  removes the secondary cold-cache timeout.

## More Information

- Found during the patch.366 release of the agentdb-CLI surface fixes
  (ADR-0273 / ADR-0276 / ADR-0282). These two are test-predictability fixes, not
  product regressions — the agentdb fixes shipped green (`adr0281` + `adr0282`
  acceptance checks passed).
- Touches the ADR-050 intelligence helper (`writeJSON`) and the ADR-0094 Phase-4
  browser checks (`browser_eval`).
