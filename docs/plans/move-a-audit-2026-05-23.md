# Move A — Wave 3 ADR audit runbook (v6)

> Companion to `docs/SESSION-HANDOVER-2026-05-26.md`. Audit the **18**
> still-`proposed` Wave 3 ADRs (0207–0224 inclusive) into terminal
> status with behaviour-test or commit evidence cited.

## Scope (corrected from handover prose)

The prior handover prose said "16 ADRs in 0207-0224 minus 0205/0206".
Both numbers are wrong on inspection:

- 0205/0206 are **not** in the 0207-0224 range; they're separate
  ADRs that already carry `superseded by ADR-0217` in their frontmatter.
  The "minus" clause is nonsensical.
- 0207-0224 inclusive = **18** ADRs (0224 - 0207 + 1).
  The handover's per-ADR map table has 18 rows.

**Move A targets** (18): `0207, 0208, 0209, 0210, 0211, 0212, 0213,
0214, 0215, 0216, 0217, 0218, 0219, 0220, 0221, 0222, 0223, 0224`.

0205/0206's `superseded` flip is a Move A 0217-audit side-effect (the
0217 agent confirms supersession; the synthesis step writes the
supersession amendments to 0205+0206 alongside the 0217 commit).

## Out of scope (carry-forwards from prior session's "Risks")

These stay deferred — NOT folded into Move A:

- **ADR-0181 Phase 4** (`cli-process-backend handler un-stub`) — now
  has a hybrid-tier wiring requirement per ADR-0230 + ADR-0181
  amendment. When Phase 4 lands, `MutationContext` factory constructs
  the hybrid-tier backend via `createHybridService` (or
  `createDatabase({provider:'hybrid'})` + `withBackend()`). Separate
  work tracked in ADR-0181.
- **19 remaining Batch S source-conflict deferrals** (non-ADR-125) —
  neural-trader Phases 1-4+6, github surface Phases 2 + 3-completion,
  kg-extract #2049, 3 doc badge updates, 5 fix(deps/mcp/cli-daemon/init),
  fix(memory) #2073 + fix(mcp) #2086 + #2046 ADR-124. Re-evaluate
  per-family on next upstream sync.
- **5 ruvector Batch O deferrals** (sparse-attention work) — not
  consumed by fork.

## Goal

Drag each of 0207–0224 into a terminal status (`implemented` /
`superseded` / `rejected` / `deferred`) with evidence cited per
[[feedback-remediation-adr-preflight]]. Audit only — no code changes
during the swarm.

## Pre-flight (serial, before any swarm op)

1. `git -C /Users/henrik/source/forks/ruflo status --short && git -C /Users/henrik/source/forks/ruflo worktree list` — expect clean, only `main` worktree at `29e143df1`.
2. `git -C /Users/henrik/source/ruflo-patch status --short` — must be empty per [[feedback-commit-often]].
3. `bash scripts/test-acceptance-fast.sh adr0059,p4` — must be 15/15 PASS. The handover's `e2e-0059-p4-socket-exists` sanity lives in the `p4` group (not `adr0059`); `adr0059` is the cascade group that the 2026-05-23 harness fix (`d5c73b2`) unblocked.
4. Abort on any failure; surface the discrepancy.

## Execution mode: parallel fan-out (deviates from handover's A-H)

Handover proposed a **sequential A-H** order:

| Phase | ADRs | Handover rationale |
|---|---|---|
| A | 0207, 0208, 0212, 0222 | Suspected quick wins — already-shipped code, status flip only |
| B | 0218 | Depends on 0207's REMOVE disposition |
| C | 0209, 0210, 0211, 0213, 0214, 0215 | Audit-required group (no shortcut) |
| D | 0219, 0220, 0221 | Fail-loud / honesty / corrupt-DB error surfacing |
| E | 0216, 0223 | Skills surface / init MCP — relate to ADR-128 init bundle |
| F | 0224 | Config defaults + Zod bypass |
| G | 0217 | QUIC deferral decision (ship-or-defer writeup) |
| H | — | Move A close-out (every 0207-0224 in terminal status) |

This plan **deviates with parallel fan-out** (all 18 at once) because:

- All audits are read-only and independent; no inter-agent contention.
- The single dependency (0218 → 0207's REMOVE disposition) is handled
  at synthesis time: if 0207's audit overturns REMOVE, 0218 is rerun
  serially before committing either.
- Parallel cuts wall-clock substantially; loses the "0207 first"
  sequencing emphasis but synthesis processes results in A-H order.

**Trade**: lose phased "fail-early" if A quick-wins reveal blockers;
gain all 18 reports in single pass for complete-corpus synthesis.

**Phase H** (every ADR in terminal status, evidence cited) remains the
non-negotiable exit criterion regardless of execution order.

## Swarm lifecycle — all via `ruflo-swarm:swarm` skill

Per [[feedback-always-use-the-skill]] — never raw `npx`/`bash` for
skill-wrapped capabilities. **Load the skill first.** Loading happens
via any `Skill(skill: "ruflo-swarm:swarm", …)` invocation — the skill
body returns into context. There is no `args: "help"` convention; the
no-args call is the load + status check (non-destructive).

| Step | Invocation | Failure handling |
|---|---|---|
| **Load skill + check state** | `Skill(skill: "ruflo-swarm:swarm")` (no args → loads body + shows status) | If skill not found, halt and reconcile (plugin enable / catalog refresh) before any state-changing call. If stale swarm exists, evaluate reuse |
| Init | `Skill(skill: "ruflo-swarm:swarm", args: "init --topology hierarchical-mesh --max-agents 18 --strategy specialized")` | Surface error verbatim — NO silent fallback per [[feedback-no-fallbacks]]; halt for direction |
| Post-init verify | `Skill(skill: "ruflo-swarm:swarm")` (no args → status) | Confirm 18 agent slots available |
| Shutdown (post-synthesis) | `Skill(skill: "ruflo-swarm:swarm", args: "shutdown")` | Surface error |

**Topology choice:** `hierarchical-mesh` per the `ruflo-swarm:swarm-init` skill's explicit guidance "For larger teams (10+)". 18 audits > 10.

**Diagnostic escape** (only on suspected hang, NOT routine polling per ADR-091):

- `Skill(skill: "ruflo-swarm:swarm", args: "health")` for a one-shot health check
- `Skill(skill: "ruflo-swarm:watch")` to stream NDJSON events via Monitor tool

## Worker fan-out — one message, 18 `Agent` calls

After init verification succeeds, one message containing 18 `Agent` tool calls, each with:

- `subagent_type: general-purpose` (read+reason; `Explore` rejected — its description: "locates code; doesn't review or audit")
- `run_in_background: true`
- No `isolation: "worktree"` — agents are read-only
- Per-ADR prompt (template + per-ADR hint below)

**Worker-failure policy:** if an agent errors out or returns malformed
report, respawn ONCE with clarified prompt. If still bad, flag for
serial manual audit. Never `skip_accepted` per
[[feedback-skip-accepted-as-squelch]].

## Per-ADR hint table (baked into each agent's prompt)

| ADR | Phase | Hint |
|---|---|---|
| 0207 | A | REMOVE decision; `e2e-0059-p4-socket-exists` already asserts socket absence (inverted `f295135` + harness daemon-wait `fdcba38`). Confirm code matches; recommend `implemented` (REMOVE) or `rejected` |
| 0208 | A | Code-side flipped via step A's `--consensus`/`--topology` fix `32480dda2`. Audit + recommend `implemented` |
| 0209 | C | Arch-test existence/pass status. Interacts with [[feedback-no-fallbacks]] + ADR-0210 |
| 0210 | C | Stub envelopes — likely `behaviour-test` disposition. **MUST consult [[feedback-no-fallbacks]]** |
| 0211 | C | Init's hook-handler event-emission contract |
| 0212 | A | Wrapper rename already partially landed; verify + flip |
| 0213 | C | Does init write the agentdb MCP registration? |
| 0214 | C | `RUFLO_*` env-var usage across code |
| 0215 | C | Codemod golden-master test existence in pipeline |
| 0216 | E | Partially landed via Batch S Phase 1 (ADR-128) skills work; verify + flip |
| 0217 | G | QUIC quarantine context; **deferral candidate** — if `deferred`, Amendment with rationale + revisit-trigger. ALSO triggers supersession amendments to ADR-0205 + ADR-0206 at synthesis |
| 0218 | B | **Depends on 0207's REMOVE disposition** (preloaded assumption). If 0207 overturns REMOVE, rerun 0218 serially before committing |
| 0219 | D | Fail-loud paths in controller registry. **MUST consult [[feedback-no-fallbacks]]** |
| 0220 | D | Learning-controller stub envelopes. **MUST consult [[feedback-no-fallbacks]]** |
| 0221 | D | GraphDatabaseAdapter corrupt-DB error surfacing. **MUST consult [[feedback-no-fallbacks]]** |
| 0222 | A | Already landed via fork-local commit on `agentdb`; check INTEGRATION-LEDGER ruflo-row, agentdb section, near top |
| 0223 | E | Init's `.mcp.json` template — does it canonicalize to ruflo wrapper? |
| 0224 | F | Substrate's config-validation (Zod bypass) |

## Per-agent prompt template

```
You are auditing ADR-XXXX (Move A, per docs/SESSION-HANDOVER-2026-05-26.md
+ docs/plans/move-a-audit-2026-05-23.md).
READ-ONLY: do NOT use Edit, Write, NotebookEdit, git commit, git push, npm run release.
Tools you may use: Read, Grep, Glob, Bash (read-only: git log, git show, ruflo CLI, acceptance scripts).

Read: docs/adr/ADR-XXXX-*.md

Hint from runbook: <per-ADR hint from table above>
Handover phase: <A/B/C/D/E/F/G>

Apply the 4-check preflight per feedback-remediation-adr-preflight:
  1. signal-reaches-audience — cite path:line of production call-site
  2. upstream-hasn't-already-decided — git log on /Users/henrik/source/ruvnet/ruflo
  3. premise-true-at-runtime — cite acceptance test name + result, or recommend writing one
  4. no-sibling-overlap — scan ±3 ADRs in neighborhood

Per [[feedback-trace-before-hypothesis]]: if the audit surfaces a test
failure, do NOT hypothesize a fix. Recommend a deeper trace before any
remediation.

Output (markdown):
  - ADR: XXXX
  - Recommended terminal status: implemented | superseded | rejected | deferred
  - Signal-reaches-audience: <yes/no + evidence path:line>
  - Upstream check: <commit/ADR ref or "none found">
  - Premise-at-runtime: <test name + result, or "no test exists; recommend X">
  - Sibling overlap: <list or "none">
  - Suggested Amendment block (copy-pasteable into the ADR)
  - INTEGRATION-LEDGER row required? <yes/no — yes if "superseded by upstream">
  - Risk flags / open questions
```

## Synthesis (serial, post-fan-out)

1. Resolve `0218 ⇄ 0207` dependency: if 0207's audit overturns REMOVE, rerun 0218 serially before committing either.
2. Process the 18 reports in handover's A-H order (A → B → C → D → E → F → G); within each phase, alphabetical.
3. One commit per ADR (no batching, per [[feedback-commit-often]] + handover discipline):
   - Status flip + Amendment from agent's "Suggested Amendment"
   - `superseded by upstream` → append INTEGRATION-LEDGER row in the same commit per [[feedback-update-integration-ledger]]
   - `deferred` (esp. 0217) → Amendment with rationale + concrete revisit-trigger
   - **0217 deferral**: also produce supersession-flip commits for ADR-0205 and ADR-0206 in same sequence
   - Findings needing code changes → flag as serial follow-up, do NOT auto-fix
4. Acceptance gate after every commit: `bash scripts/test-acceptance-fast.sh adr0059,p4` — confirm green. Halt on any failure per [[feedback-no-squelch-tests]].
5. No pushes this swarm (continues prior session policy).

## Close-out

- `Skill(skill: "ruflo-swarm:swarm", args: "shutdown")` after the last commit gates green
- Write `docs/SESSION-HANDOVER-<next-date>.md` capturing Move A execution + any Move B follow-ups + standing-rules update

## Success criteria

- Pre-flight passes (clean tree both repos + adr0059+p4 15/15)
- Swarm init succeeds (or reuse confirmed); post-init status healthy
- 18 structured reports returned (or retried-once → manual fallback flagged)
- 0 leftover `proposed` ADRs in 0207-0224 (all 18 in terminal status)
- ADR-0205 + ADR-0206 `superseded` status persisted (driven by 0217 audit)
- Acceptance 15/15 sustained through every commit
- INTEGRATION-LEDGER updated for upstream-supersession findings
- `0218 ⇄ 0207` dependency resolved coherently
- Swarm shutdown clean
- Handover written

## Standing rules / memory references

In addition to those referenced inline:

- [[feedback-remediation-adr-preflight]] — central to Move A (the 4 checks)
- [[feedback-no-fallbacks]] — especially for honesty group (0210, 0219, 0220, 0221)
- [[feedback-update-integration-ledger]] — every supersession finding
- [[feedback-trace-before-hypothesis]] — if any audit surfaces ≥2 related fails, trace before fixing
- [[feedback-commit-often]] — 18+ ADR commits; one per ADR, never let WIP accumulate
- [[feedback-always-use-the-skill]] — swarm via Skill tool, never raw npx
- [[feedback-trunk-only-fork-development]] — all commits on `main`, no PRs
- [[feedback-never-touch-hz-remote]]
- [[feedback-no-history-squash]]
- [[feedback-skip-accepted-as-squelch]]
- [[feedback-no-time-estimates]]
- [[feedback-inspect-installed-not-dev-nodemodules]]
- [[feedback-commit-forks-before-release]] — N/A this swarm (no fork edits) but applies if findings escalate
- [[feedback-pipeline-shared-skip-on-dist-clear]] — N/A this swarm
- [[feedback-forbidden-substring-tests-grep-dist]] — N/A this swarm

## Will NOT do

- Run `npm run release` or push anything
- Touch the `hz` remote per [[feedback-never-touch-hz-remote]]
- Auto-fix code findings from agents
- Batch multiple ADR status flips into one commit
- Use `skip_accepted` to dodge a finding per [[feedback-skip-accepted-as-squelch]]
- Give time estimates per [[feedback-no-time-estimates]]
- Squash history per [[feedback-no-history-squash]]
- Inspect via dev `node_modules/` per [[feedback-inspect-installed-not-dev-nodemodules]]
- Call raw `npx`/`bash` for swarm lifecycle per [[feedback-always-use-the-skill]]
- Poll swarm status in a loop (ADR-091)
