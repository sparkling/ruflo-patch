---
status: accepted
date: 2026-06-10
tags: [upstream-sync, batch-u, integration-ledger, sequenced-last]
supersedes: []
depends-on: [ADR-0252, ADR-0228]
implements: []
---

# Batch-U upstream sync (2026-06): disposition the ~100 commits since Batch-T

## Context and Problem Statement

[[ADR-0252]] (Batch-S re-disposition, 2026-05-25) recorded a re-evaluation
trigger for the deferred upstream work: **"≥50 new `ruvnet/ruflo` commits since
2026-05-23."** A 2026-06-10 adversarial verification swarm found that trigger
has **objectively fired** — and ADR-0252's body still says "current state: 0 new
commits," now stale.

As of upstream `origin/main` HEAD `16a55f7a5` (2026-06-09, #2340), there are
**~100 commits since the Batch-T cut (2026-05-23, [[ADR-0228]])**. This ADR is
the Batch-U sync record: it scopes the work, fixes the methodology, and — per an
explicit decision (Henrik, 2026-06-10) — **sequences it LAST, after every other
outstanding fork ADR/fix has shipped.**

### Scope (upstream `git log origin/main --since=2026-05-24`, characterised 2026-06-10)

| Bucket | Count | Disposition lean |
|---|---|---|
| `feat` | 35 | substantive — per-commit triage |
| `fix` | 32 | substantive — per-commit triage (highest pick-value) |
| `chore` / `release` / `ci` | ~39 | mostly fork-handled-differently → SKIP-by-policy with ledger rows (own release pipeline [[ADR-0302]], marketplace [[ADR-0301]], CI shape) |
| `docs` / other | ~4 | pick or SKIP per content |

By area the weight is **`intelligence` (18)**, then release (11), ci (9), gaia
(5), statusline (4), memory (4), beir (4), security (3), with singletons in
routing/router/hooks/cost-tracker/graph/rvagent/init.

**The `intelligence` cluster (18) is the high-care zone:** it is the fork's most
heavily-diverged, most-actively-patched surface (the learning/routing/memory
stack audited across the 2026-06-10 session — ADR-0284/0287/0290/0306/0307).
Many of those 18 will be SKIP-because-fork-ahead or delicate hand-ports, **not**
clean cherry-picks. This is exactly why Batch-U is sequenced last: the other
ADRs settle the fork's intelligence-stack state first, so each upstream
intelligence commit can be dispositioned against a known, stable fork baseline.

## Decision Drivers

* **Follow upstream intent + implementation** (the session's governing rule) —
  the fork tracks upstream; an accumulated 100-commit drift is integration debt
  to dispositon, not ignore.
* **Stale-trigger hygiene** — ADR-0252's fired trigger must be closed through a
  real Batch-U record, not left as drift.
* **Sequence last** — the heaviest cluster (intelligence) overlaps the ADRs
  being fixed this cycle; dispositioning upstream intelligence commits before
  the fork's own intelligence ADRs land would triage against a moving baseline.
* **Per-commit honesty + the ledger** — every pick / hand-port / SKIP decision
  gets an `docs/upstream/INTEGRATION-LEDGER.md` row (`feedback-update-integration-ledger`),
  hand cherry-pick `-x` so trailers stay greppable (`feedback-verify-commit-content-vs-message`).

## Considered Options

* **A — Dedicated Batch-U triage as its own effort, sequenced last (chosen).**
  Full per-family disposition with the [[ADR-0228]] methodology; runs after the
  other outstanding ADRs/fixes ship.
* **B — Fold Batch-U into the current ADR-implementation waves.** Rejected: it
  is the single largest item, and its intelligence cluster needs the other
  intelligence ADRs settled first.
* **C — Blind bulk merge / `--theirs`.** Rejected: the fork is ahead on the
  highest-weight area; blind merge would clobber deliberate fork divergences
  (ADR-0284 lock collapse, ADR-0227 thresholds, ADR-0278/0280 bandit, etc.).
* **D — Keep deferring.** Rejected: the trigger has fired; indefinite deferral
  is the drift ADR-0252 warned against.

## Decision Outcome

Chosen: **Option A.** Batch-U is its own dedicated sync effort, ledger-tracked,
**executed last** in the current work program. Status `proposed`; **authorises
no integration** until (i) the other outstanding fork ADRs/fixes have shipped and
(ii) a separate explicit go-ahead.

### Tasks (deferred until the rest of the program is done)

* **T1 — Pin the exact baseline.** Resolve the Batch-T integration boundary SHA
  from [[ADR-0228]] + the ledger; enumerate the commit range `<batch-T-cut>..16a55f7a5`
  (refresh the upper bound at execution time — upstream will have advanced).
* **T2 — Per-family disposition** (feat / fix / chore-release-ci / docs), with
  the `intelligence` cluster triaged commit-by-commit against the post-fix fork
  baseline. Verdicts: PICK (hand cherry-pick `-x`) / HAND-PORT / SKIP-by-policy /
  SKIP-fork-ahead / SUPERSEDE.
* **T3 — Ledger rows** for every disposition in `docs/upstream/INTEGRATION-LEDGER.md`
  (same commit/PR as the pick).
* **T4 — Reconcile ADR-0252 + ADR-0233** "current state: 0 new commits" lines to
  point at this Batch-U record as the trigger's closure.
* **T5 — Release + acceptance** per the standard pipeline (release from the main
  checkout), full acceptance green before the sync is declared done.

### Consequences

* Good, because the fired ADR-0252 trigger is closed through a real, ledgered
  Batch-U disposition rather than left as silent drift.
* Good, because sequencing last means the high-care intelligence commits are
  triaged against a settled fork baseline, not a moving one.
* Neutral, because no integration happens until the rest of the program ships +
  a separate go-ahead — this ADR is a scoped tracking record.
* Bad (mitigated), because a 100-commit backlog grows while deferred; the ledger
  + this ADR keep it bounded and discoverable, and the substantive count
  (~67 feat+fix) is the real work, not the ~39 housekeeping commits.

### Confirmation

Batch-U is complete when: the commit range is fully dispositioned with a ledger
row each, the fork builds + full acceptance is green from a main-checkout
release, and ADR-0252/0233's stale "0 new commits" lines reference this record.
Until then this ADR stays `proposed`.

## More Information

* [[ADR-0252]] — the Batch-S re-disposition whose re-eval trigger 2 (≥50 commits)
  this ADR closes; [[ADR-0228]] — the Batch-T sync precedent + methodology.
* `docs/upstream/INTEGRATION-LEDGER.md` — the running disposition ledger
  (`feedback-update-integration-ledger`).
* Governance: `feedback-fresh-upstream-via-git-show` (verify upstream freshness),
  `feedback-verify-commit-content-vs-message` (`-x` trailers), `feedback-never-touch-hz-remote`.
* Boundary (record): start = Batch-T cut 2026-05-23 (pin exact SHA at T1); end =
  `16a55f7a5` (2026-06-09, #2340) — refresh at execution.
* Sequencing decision: Henrik, 2026-06-10 — "needs to be its own ADR … do this
  last, after we fixed everything else."

## Amendment (2026-06-11): Batch-U executed + shipped — ACCEPTED

All five tasks complete; status `proposed` → `accepted`.

- **T1** — baseline pinned: Batch-T cut `619b263aa` (2026-05-23); upper bound
  refreshed to `58716fd14` (2026-06-10). Range = **105 commits**.
- **T2** — every commit dispositioned (6 read-only analyst slices,
  `docs/upstream/batch-u/disposition-{A..F}.md`). ~12 HAND-PORT applied across 5
  fork commits (`forks/ruflo` `d0c991469`, `cb51b34a0`, `9a4dfe95c`, `1198bc0c3`,
  `3d4b68c3d`); 51 SKIP-by-policy, 24 SKIP-fork-ahead, 8 SUPERSEDE, 5 DEFERRED
  (port-eligible follow-ups), 3 SKIP-merge.
- **T3** — `docs/upstream/INTEGRATION-LEDGER.md` Batch-U section: summary +
  applied-pick→fork-SHA map + deferred list + full 105-row per-SHA table.
- **T4** — [[ADR-0252]] re-eval trigger 2 + [[ADR-0233]] §A "0 new commits"
  lines reconciled → FIRED + CLOSED by this record.
- **T5** — released from the main checkout: `@sparkleideas/cli@3.7.0-alpha.10-patch.437`,
  **full acceptance 757 pass / 0 fail / 10 skip_accepted**; gated fork push to
  `sparkling` fired (4 forks). The high-value picks (#2250 escalation, #2222+BugB
  route persistence, #2274 witness crash, #2283 frontmatter parse, #2257 router
  regex, RUFLO_DB_PATH env tier) are live.

Deferred follow-ups (tracked in the ledger, no code this batch): ADR-147
nested-subagent + entity-arm, ADR-144/145 off-by-default security (needs a fork
ADR), ADR-143 Tier-1 codemods (needs Agent-Booster-dead trace), unified-stats
view, `--explore` parser (vs ADR-0316), MCP ppid-watchdog (vs ADR-0314).
