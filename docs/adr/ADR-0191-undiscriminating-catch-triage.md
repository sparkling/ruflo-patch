---
status: proposed
date: 2026-05-19
methodology: [MADR]
decision-makers: [Henrik Pettersen]
tags: [error-handling, fail-loud, ADR-0082, detector, silent-fallback]
related: [0082, 0188, 0189, 0190]
audience: ai-executor
---

# ADR-0191: Undiscriminating-catch triage — categorize the 370 baseline

## Context and Problem Statement

`scripts/check-undiscriminating-catches.mjs` (landed 2026-05-19 per
ADR-0190's silent-publish-gap work) flags `catch { /* comment */ }`
blocks that swallow without taking runtime action. The detector is
stricter than `check-silent-catches.mjs`: a comment documents intent,
but doesn't filter at runtime — every error type gets swallowed
uniformly. This is the exact failure mode that hid an ESM-vs-CJS error
in the 2026-05-19 TrainingPipeline regression, where my own
`try { ... require('module') ... } catch { /* not available */ }`
silently caught a real bug.

First-run report against `forks/ruflo/v3/@claude-flow/cli/src/` +
`forks/agentic-flow/src/`: **370 undiscriminating catches**. The
detector is informational (not wired into pre-flight) because 370
findings can't be triaged in one pass. This ADR is the triage map.

## Distribution of the 370 findings

By file (top 10 — 71% of the baseline):

| File | Count |
|---|---:|
| `forks/ruflo/.../memory/memory-router.ts` | 37 |
| `forks/ruflo/.../mcp-tools/hooks-tools.ts` | 34 |
| `forks/ruflo/.../commands/hooks.ts` | 22 |
| `forks/ruflo/.../services/worker-daemon.ts` | 16 |
| `forks/ruflo/.../mcp-tools/memory-tools.ts` | 15 |
| `forks/ruflo/.../commands/swarm.ts` | 14 |
| `forks/ruflo/.../mcp-tools/github-tools.ts` | 9 |
| `forks/ruflo/.../init/executor.ts` | 8 |
| `forks/ruflo/.../services/{headless-worker-executor,daemon-ipc}.ts` | 14 |
| `forks/ruflo/.../autopilot-state.ts` | 7 |

By body type:

| Type | Count |
|---|---:|
| Empty body (no comment) | 156 |
| Comment-only body | 209 |
| Other | 5 |

By comment pattern (`209` with-comment, top buckets):

| Pattern | Count | Risk class |
|---|---:|---|
| `/* ignore */` | 43 | Medium — context-dependent |
| `/* fall through */` + variants (`/* fall through to <X> */`) | 30+ | **LOW** — explicit next-strategy retry chain |
| `/* not available */` / `/* unavailable */` / `/* not initialized */` / capability gates | **28** | **HIGH** — same class as the ESM bug |
| `/* best effort */` / `/* best-effort */` / `/* non-fatal */` / `/* non-critical */` | 16 | LOW — cleanup paths |
| `/* already <X> */` (freed/removed/gone/exited) | 8 | LOW — idempotent cleanup |
| `/* corrupt file */` / `/* file <X> error */` | 5 | Medium — should discriminate parse vs i/o errors |

## Decision Drivers

* **ADR-0082 spirit** — fail loud. The 28 feature-detection catches
  are the bug class that bit me at 01:13Z today; same shape would
  silently swallow future bugs (a CommonJS-vs-ESM error, a transient
  npm install failure, a misnamed module export). These deserve a
  discriminating fix.
* **Existing convention** — `feedback-no-fallbacks` was authored
  knowing `catch { /* comment */ }` is the project's documented form
  of intentional silence. The 30+ `fall through` patterns are
  legitimate multi-strategy chains; tightening them globally would
  break thousands of working callsites.
* **Cost-of-fix scales with class** — converting "fall through"
  patterns to discriminating logic is mechanical-noise (the next
  attempt already handles errors). Converting "not available"
  patterns to `if (e.code !== 'MODULE_NOT_FOUND') throw e` requires
  per-call understanding of the expected error shape.
* **Triage horizon** — 370 catches at ~5 min/each (read, classify,
  edit, test) = ~31 hours. Not a one-session lift; needs a strategy
  that prioritizes the 28 high-risk over the 150+ low-risk.

## Considered Options

1. **Triage in three risk classes, fix HIGH first** (priority queue):

   * **HIGH (28)**: feature-detection / capability-gate catches. Each
     converted to `try { ... } catch (e) { if (e.code !== 'EXPECTED') throw e; /* expected: ... */ }`
     OR refactored to test capability without an exception
     (`typeof mod.Foo === 'function'` pattern from the
     TrainingPipeline fix). Target: 100% conversion within 30 days.
   * **LOW (~80, fall-through + idempotent + non-fatal)**:
     auto-allowlist via detector regex on comment patterns. Update
     `check-undiscriminating-catches.mjs` to skip catches whose
     comment matches `/(fall through|already (freed|gone|removed|exited)|non-fatal|non-critical|best[ -]effort)/i`.
     Net effect: ~280 baseline shrinks to ~150.
   * **MEDIUM (~150 remaining)**: case-by-case during natural code
     touches; no hard deadline. Wired gate fires AFTER HIGH is closed
     so new regressions get caught immediately.

2. **Fix every catch to be discriminating**. Convert all 370 in one
   coordinated PR. Each gets either `if (e.code !== 'X') throw e` or
   replaced with a non-exception capability test.

   *Tradeoff:* exhaustively correct. Multi-day project; risks
   regression by misclassifying error shapes; the legitimate
   fall-through cases get bloated with rethrows that next-strategy
   handlers would catch anyway.

3. **Auto-allowlist all 209 commented + flag only the 156
   empty-body catches**. Treat the existing convention as
   load-bearing: a comment IS the rationale. Reduce the detector to
   only flag empty bodies (which `check-silent-catches.mjs` already
   catches — making this detector redundant).

   *Tradeoff:* lowest cost. Loses the value the detector demonstrated
   today (catching the ESM bug). Same convention that allowed my own
   bug to pass review.

4. **Keep the detector unwired, advisory-only**. Leave it as a
   manual `node scripts/check-undiscriminating-catches.mjs` audit
   tool. Don't wire into pre-flight. Triage happens organically.

   *Tradeoff:* zero forcing function. Detector exists but doesn't
   prevent the next regression of this class.

## Decision Outcome

**Option 1 (three-class triage) — chosen, but Phase A SKIPPED for now.**

Decision 2026-05-19: the LOW class (~80 catches matching `fall
through` / `already <X>` / `non-fatal` / `non-critical` / `best
effort`) **stays visible in the detector output** rather than being
auto-allowlisted via comment regex. Rationale: the regex would
permanently bless 80 callsites as "safe" based on a one-line comment,
but several patterns in that bucket deserve real investigation
before that. Specifically:

* **`fall through to <X>` chains** — the "fall through" comment
  declares intent but doesn't prove the next attempt actually
  handles every error type that could fire. Some chains may have
  gaps where a transient error in attempt-2 also kills attempt-3
  before the chain converges.
* **`already <X>` (freed/gone/removed)** — these claim idempotence
  but a real audit might find calls where "already gone" only
  handles ENOENT and would mask permission errors or i/o failures.
* **`best effort`** — defensible in shutdown handlers; not
  defensible elsewhere. Per-callsite read needed to tell the
  difference.

Keeping LOW visible costs nothing today (the detector is informational,
not wired) and preserves the audit signal for the natural-code-edit
pass when each file is touched for other reasons.

### Concrete plan

1. **Phase A — SKIPPED** for now. The auto-allowlist regex is *not*
   added. All 370 stay visible. Revisit after Phase B closes.
2. **Phase B (~3 sittings)**: hand-fix the 28 HIGH catches. Each
   gets a discriminating `if (e.code !== ...) throw e` block OR a
   non-exception capability check (`typeof mod.X === 'function'`,
   following the TrainingPipeline fix pattern). Add unit tests for
   the discriminated error shapes per critical callsite.
3. **Phase C (advisory)**: leave the MEDIUM ~150 unwired. They get
   touched during natural code edits.
4. **Phase D (LOW revisit)**: after Phase B lands, re-read the LOW
   class. Either (a) confirm the patterns are truly safe →
   auto-allowlist via regex, or (b) discover real gaps → convert.
5. **Phase E (gate flip)**: wire
   `check-undiscriminating-catches.mjs` into `scripts/ruflo-publish.sh`
   pre-flight only after LOW + HIGH are both closed.

The 28 HIGH catches (per current grep) are concentrated in:

* `hooks-tools.ts` (7) — SolverBandit / SkillLibrary / LearningSystem /
  SemanticRouter / NightlyLearner / stats unavailable / @claude-flow
  memory not available — these are the same shape as the bug I hit
  (lazy-require feature detection). Test: `typeof mod.X === 'function'`.
* `memory-router.ts` (4) — agentdb not available, deferred init,
  controllers surface. These need careful read — some may be
  legitimate "init can fail; later code re-checks".
* `memory-tools.ts` (4) — QueryOptimizer / MMR / scope filter /
  context synthesis unavailable. Same shape; test for export
  presence instead of try/catch.
* `intelligence.ts` (1) — line 1162. The OTHER `/* not available */`
  in the same function we already fixed. Already on the
  this-session edit horizon.
* Various (12) — `autopilot-state.ts`, `ruvllm-tools.ts`,
  `security-tools.ts`, etc.

## Consequences

**If Option 1 (three-class triage)**:

* ~30 hour-equivalent investment spread over weeks.
* HIGH class closure within 30 days eliminates the bug class that hit
  today. Subsequent regressions caught by the gate.
* LOW class allowlist via regex creates a maintainable rule; new
  fall-through patterns must follow the convention or get flagged.
* MEDIUM class becomes the natural-code-touch backlog. Some never get
  touched; that's fine — they were never urgent.

**If Option 2 (fix everything)**:

* Highest correctness, highest risk of regression from misclassified
  error shapes. Multi-day project.

**If Option 3 (allowlist all 209)**:

* Detector becomes redundant with check-silent-catches.mjs. The
  failure mode that hit today stays open. Not recommended.

**If Option 4 (advisory-only forever)**:

* Lowest cost. Highest ongoing risk — no forcing function for the
  next regression.

This ADR closes when Option 1's Phase D lands (gate wired after HIGH
is closed) OR an alternative option is chosen and implemented.
