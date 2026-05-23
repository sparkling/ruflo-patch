# Session Handover — 2026-05-28

> Companion to `docs/SESSION-HANDOVER-2026-05-27.md` (Move A execution
> record — completed). This handover is **forward-looking**: a scoped
> agenda for the next session, focused on the 11 Move A follow-ups +
> 3 standing carry-forwards. No execution context; just what's next.

## TL;DR

- **Move A is closed.** All 18 Wave 3 ADRs (0207-0224) are in terminal
  status (17 `implemented`, 1 `deferred`). See 2026-05-27 for execution
  details.
- **This session's agenda:** pick up Move A follow-ups in priority order
  (none blocking). The four quick wins below can clear the lowest-cost
  debt without opening new horizons.
- **Acceptance baseline at handover:** 688/697 pass / 0 fail / 9
  skip_accepted (canonical); 15/15 PASS (fast-runner `adr0059,p4`).
- **Tree clean** at handover (`ruflo-patch/main` at `d4fa4f0`,
  37 commits ahead of the Move A queue handover's `555fcc5`).
- **No pushes** carried from prior sessions; `hz` remote untouched.

## Recommended next-session priority order

### Quick wins (low effort, immediate debt-reduction)

These four close concrete debts surfaced by the Move A audit. Each is
self-contained, doesn't open new horizons, and ships fast.

1. **ADR-0210 INTEGRATION-LEDGER row** — Confirmation #4 owes a row for the
   3 item-1 hand-ports (`hooks_explain` / `hooks_pretrain` /
   `hooks_intelligence-reset`). Currently **0 matches** in
   `docs/upstream/INTEGRATION-LEDGER.md`. Prevents a future upstream-sync
   agent from misreading the hand-ports as fork divergences.
   - Action: append row(s) per [[feedback-update-integration-ledger]];
     cite the implementation commit `98d10e489`; one commit.
2. **ADR-0214 USERGUIDE.md cleanup** — 6 documented env-var sites
   (`CLAUDE_FLOW_MODE` x3, `CLAUDE_FLOW_TOKEN`, `CLAUDE_FLOW_TOPOLOGY`,
   `CLAUDE_FLOW_MEMORY_BACKEND`, `CLAUDE_FLOW_EMBEDDING_DIM`
   `384→768` per [[reference-embedding-model]]) need rewriting. ADR-Steps
   3+5 finish.
   - Action: edit `forks/ruflo/docs/USERGUIDE.md` lines `3229`, `6932`,
     `6960`, `6975`, `6993`, `7045`, `7060`. Commit fork (per
     [[feedback-commit-forks-before-release]]); add patch-side note.
3. **ADR-0220 F-05-016 disposition** — `LearningBridge.consolidate`
   bare-catch not covered by the 19 honesty tests. Status unclear.
   - Action: grep `forks/ruflo/v3/@claude-flow/memory/src/learning-bridge.ts`
     around lines 269-277; either add fix + test or explicitly note as
     deferred in an ADR-0220 amendment.
4. **ADR-0213 agentdb boot-crash tracker** — `forks/agentdb` ships
   `busy_timeout` pragma but it's missing from `ALLOWED_PRAGMAS` in
   `src/security/input-validation.ts:53`. Documented as "fork bug" in
   ADR-0213 text but no ledger / ADR / issue ID confirms it's tracked.
   - Action: file a separate tracker entry (lightweight ADR or memory
     note) so the deferred opt-in registration ADR has a real precondition.

### Larger / more-substantive (open scope if you take them)

5. **ADR-0208 Option D′ outstanding sub-steps** — the runtime flip
   shipped, but the ADR's **lint-first** sequencing inverted. Outstanding:
   - **Step 1** — build-time lint
     `scripts/check-manifest-flag-drift.mjs` (decidable set-membership
     over manifests + docs + resolved command tree). The ADR's documented
     primary deliverable + upstream-merge-tax mitigation.
   - **Step 2 (broad)** — clean the remaining 11 undeclared flags + 6
     undefined subcommands across the 3 manifest channels and shipped
     docs (`.claude/commands/hooks/*.md`).
   - **Step 3** — acceptance trip-wire through `bin/cli.js`/`_cli_cmd`.
   - **Step 5** — fuzzy-match via `suggest.ts` (explicitly decoupled per
     [[feedback-corpus-evidence-before-feature-work]]).
6. **ADR-0217 quarantine actions** (5 code items) — these go with the
   `deferred` status; they retract the lying surface without committing
   to the multi-writer build:
   - Export retraction with agentic-flow carve-out
   - CLI guard (so manual invocation of `agentdb sync` errors with a
     clear "deferred" message)
   - Delete `resolveConflicts` + `conflictStrategy` across 4 sites
   - Delete `QUICConnectionPool` / `QUICStreamManager` + arch-test
   - Update docs (no more "QUIC sync" advertising)
   - **CRITICAL:** preserve the vector-clock family carve-out at
     `agentdb/src/index.ts:178-194` — live agentic-flow consumer at
     `autopilot-learning.ts:42-43,1083`.
7. **ADR-0220 F-05-007 EWC++ per-call adapt path** — net-new Rust infra
   in `forks/ruvector/crates/sona/src/lora.rs` + `MicroLoraWasm`
   republish. Open as its own ADR.
8. **ADR-0221 F-06-006** — agentic-flow consumer demotion at
   `agentdb-service.ts:832-836`; same copy-paste anti-pattern for
   `routerEnabled` / `sonaEnabled` / `gnnEnabled`. Follow-up ADR if it
   surfaces in acceptance.
9. **ADR-0222 upstream merge-tax** — `ruvnet/agentdb` still ships
   `services/federated-learning.ts`. Next merge needs `--ours`. Arch-test
   catches accidental re-add. Action: note in upstream-sync runbook.
10. **ADR-0214 Council MUST-FIX #2** — runtime honoured-by-loader
    behavioural test. The arch-test verifies emission; this would assert
    that `SWARM_TOPOLOGY` / `MEMORY_TYPE` are honoured by the loader at
    runtime in a fresh-init'd project.
11. **ADR-0224 sync-vs-async drift** — implementation chose `sync`
    (rationale in JSDoc); ADR draft said `async`. Revisit if async
    migration becomes viable.

### Standing carry-forwards (unchanged across sessions)

- **ADR-0181 Phase 4** — `cli-process-backend handler un-stub` with
  hybrid-tier wiring requirement per ADR-0230 + ADR-0181 amendment.
- **19 Batch S source-conflict deferrals** (non-ADR-125) —
  re-evaluate per-family on next upstream sync.
- **5 ruvector Batch O deferrals** (sparse-attention) — not consumed
  by fork.

### Open horizon questions

- **Wave 3 closed.** Move B candidates (if any) would be a new horizon.
- **Pushing to `sparkling`** — nothing pushed in 2+ sessions. Push when
  ready.
- **Periodic upstream sync** — INTEGRATION-LEDGER's "next sync" trigger
  is operator-judged; the ADR-0210 row owed (item #1 above) is a hard
  precondition for any agent-led sync that touches `hooks-tools.ts`.

## Pre-flight (run before any work)

Identical to the prior session's pre-flight:

```bash
# 1. Fork ruflo clean
git -C /Users/henrik/source/forks/ruflo status --short
git -C /Users/henrik/source/forks/ruflo worktree list
# expect: clean tree, only main worktree at 29e143df1

# 2. Ruflo-patch clean
git -C /Users/henrik/source/ruflo-patch status --short
# expect: empty

# 3. Acceptance baseline
bash scripts/test-acceptance-fast.sh adr0059,p4
# expect: 15/15 passed
```

Abort on any failure; surface the discrepancy. Per
[[feedback-trace-before-hypothesis]] — if a failure surfaces ≥2 related
checks, spawn a read-only trace agent FIRST before any fix hypothesis.

## Standing rules in effect

Unchanged from the prior session's handover — re-stated for self-containment:

- [[feedback-remediation-adr-preflight]] — the 4-check preflight if any
  new ADR work happens
- [[feedback-no-fallbacks]] — silent fallbacks banned
- [[feedback-update-integration-ledger]] — every cherry-pick / hand-port /
  SKIP / retarget appends a row (item #1 above is this rule's open debt)
- [[feedback-trace-before-hypothesis]] — ≥2 related fails → trace agent
  before fix hypothesis
- [[feedback-commit-often]] — never leave untracked ADRs / fixes across
  a session; pre-handover `git status --short` MUST be clean OR every
  line explained
- [[feedback-always-use-the-skill]] — Skill tool for skill-wrapped
  capabilities; MCP for typed dispatch; never raw `npx`/`bash` for
  underlying ops shown in skill help text
- [[feedback-trunk-only-fork-development]] — all on `main`, no PRs
- [[feedback-never-touch-hz-remote]] — `hz` remote off-limits
- [[feedback-no-history-squash]] — no squashing; carefully merge
- [[feedback-skip-accepted-as-squelch]] — `skip_accepted` is for
  tool-not-found / env-disabled, NOT architectural deferral
- [[feedback-no-time-estimates]] — risk shape only, not time anchors
- [[feedback-inspect-installed-not-dev-nodemodules]] — audit via fresh
  `/tmp` install, never dev `node_modules/`
- [[feedback-commit-forks-before-release]] — commit fork edits before
  `npm run release` (relevant for items 2, 5, 6 above)
- [[feedback-pipeline-shared-skip-on-dist-clear]] — selective-build skip
  trap; use `--force` if needed
- [[feedback-forbidden-substring-tests-grep-dist]] — JSDoc comments
  survive compilation; watch for forbidden-token grep gates

## File-system state at handover

| Location | State |
|---|---|
| `forks/ruflo/main` | `29e143df1` (patch.289) — unchanged in last 2 sessions |
| `forks/ruflo/main` working tree | clean |
| `forks/agentic-flow/main` | unchanged |
| `forks/agentdb/main` | unchanged |
| `forks/ruv-FANN/main` | unchanged |
| `forks/ruvector/main` | unchanged |
| `forks/ruflo` worktrees | none |
| `ruflo-patch/main` | `d4fa4f0` — 37 commits ahead of `555fcc5` (the Move A queue handover) |
| `ruflo-patch/main` working tree | clean |
| `sparkling/*` push state | Nothing pushed in last 2+ sessions |
| `hz` remote | Untouched per [[feedback-never-touch-hz-remote]] |
| Swarm registry | All terminated; init fresh if needed |

## How to resume in the next session

1. **Read this file first.**
2. Read `docs/SESSION-HANDOVER-2026-05-27.md` if Move A execution
   context is needed (otherwise skip — Move A is closed).
3. Pre-flight (3 checks above).
4. Pick a follow-up to work on:
   - For quick wins (#1-4): direct edits + commits. No swarm needed.
   - For larger items (#5-11): consider scope first; some warrant their
     own ADR; ADR-0217 quarantine (#6) is the largest single piece.
5. **Per [[feedback-commit-often]]:** commit each logical change in the
   same turn as the edit. Don't end a session with untracked WIP.
6. **Per [[feedback-always-use-the-skill]]:** if a swarm is needed,
   dispatch via `Skill(skill: "ruflo-swarm:swarm")` + MCP tools, not
   raw `npx`.
7. Acceptance gate (`adr0059,p4`) after fork edits or any code-touching
   commit. Doc-only commits don't require per-commit gating.
8. End the session with `git status --short` clean and a fresh
   handover doc capturing what landed.

## Cross-references

- **Prior handover (Move A execution record)** — `docs/SESSION-HANDOVER-2026-05-27.md`
- **Move A queue handover** — `docs/SESSION-HANDOVER-2026-05-26.md`
- **Move A audit runbook (executed)** — `docs/plans/move-a-audit-2026-05-23.md` (v6)
- **Wave 3 ADRs (all terminal)** — `docs/adr/ADR-0207-*.md` through `docs/adr/ADR-0224-*.md`
- **INTEGRATION-LEDGER** — `docs/upstream/INTEGRATION-LEDGER.md` (item #1 above owes a row)
- **Memory entries** — see `~/.claude/projects/-Users-henrik-source-ruflo-patch/memory/MEMORY.md`; no new entries needed at this handover.
