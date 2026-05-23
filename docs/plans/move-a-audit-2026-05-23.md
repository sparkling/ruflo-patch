# Move A — Wave 3 ADR audit runbook (v5)

> Plan for Move A per `docs/SESSION-HANDOVER-2026-05-25.md`. Audit the
> 16 still-`proposed` Wave 3 ADRs (0207–0224 minus 0205/0206 which are
> superseded by 0217) into terminal status with behaviour-test or
> commit evidence cited.

## Goal

Drag each of `0207–0224` (minus `0205/0206`) into a terminal status
(`implemented` / `superseded` / `rejected` / `deferred`) with
evidence cited per [[feedback-remediation-adr-preflight]]. Audit only
— no code changes during the swarm.

## Pre-flight (serial, before any swarm op)

1. `git -C /Users/henrik/source/forks/ruflo status --short && git -C /Users/henrik/source/forks/ruflo worktree list` — expect clean, only `main` worktree at `29e143df1`.
2. `git -C /Users/henrik/source/ruflo-patch status --short` — must be empty (per [[feedback-commit-often]]).
3. `bash scripts/test-acceptance-fast.sh adr0059,p4` — must be 15/15 PASS. The handover's `e2e-0059-p4-socket-exists` sanity lives in the `p4` group (not `adr0059`); `adr0059` is the cascade group that the 2026-05-23 harness fix (`d5c73b2`) unblocked.
4. Abort on any failure; surface the discrepancy.

## Swarm lifecycle — all via `ruflo-swarm:swarm` skill

Per [[feedback-always-use-the-skill]] — never raw `npx`/`bash` for skill-wrapped capabilities. **Load the skill first.** Loading happens via any `Skill(skill: "ruflo-swarm:swarm", …)` invocation — the skill body returns into context. Use the no-args call as the load + state-check; it has no destructive side effects and gives current swarm status.

| Step | Invocation | Failure handling |
|---|---|---|
| **Load skill + check state** | `Skill(skill: "ruflo-swarm:swarm")` (no args → loads skill body + shows status per the skill) | If skill not found, halt and reconcile (plugin enable / catalog refresh) before any state-changing call. If stale swarm exists, evaluate reuse |
| Init | `Skill(skill: "ruflo-swarm:swarm", args: "init --topology hierarchical-mesh --max-agents 16 --strategy specialized")` | Surface error verbatim — NO silent fallback per [[feedback-no-fallbacks]]; halt for direction |
| Post-init verify | `Skill(skill: "ruflo-swarm:swarm")` (no args → status) | Confirm 16 agent slots available |
| Shutdown (post-synthesis) | `Skill(skill: "ruflo-swarm:swarm", args: "shutdown")` | Surface error |

**Topology choice:** `hierarchical-mesh` per the `ruflo-swarm:swarm-init` skill's explicit guidance "For larger teams (10+)". 16 audits > 10.

**Diagnostic escape** (only on suspected hang, NOT routine polling per ADR-091):
- `Skill(ruflo-swarm:swarm, args: "health")` for a one-shot health check
- `Skill(ruflo-swarm:watch)` to stream NDJSON events via Monitor tool

## Worker fan-out — one message, 16 `Agent` calls

After init verification succeeds, one message containing 16 `Agent` tool calls, each with:

- `subagent_type: general-purpose` (read+reason; `Explore` rejected — "locates code; doesn't review or audit")
- `run_in_background: true`
- No `isolation: "worktree"` — agents are read-only
- Per-ADR prompt (template + per-ADR hint below)

**Worker-failure policy:** if an agent errors out or returns malformed report, respawn ONCE with clarified prompt. If still bad, flag for serial manual audit. Never `skip_accepted` per [[feedback-skip-accepted-as-squelch]].

## Per-ADR hint table (baked into each agent's prompt)

| ADR | Hint |
|---|---|
| 0207 | REMOVE decision; `e2e-0059-p4-socket-exists` already asserts socket absence (inverted `f295135` + harness daemon-wait `fdcba38`). Confirm code matches; recommend `implemented` (REMOVE) or `rejected` |
| 0208 | Code-side flipped via step A's `--consensus`/`--topology` fix `32480dda2`. Audit + recommend `implemented` |
| 0209 | Arch-test existence/pass status. Interacts with [[feedback-no-fallbacks]] + ADR-0210 |
| 0210 | Stub envelopes — likely `behaviour-test` disposition. **MUST consult [[feedback-no-fallbacks]]** |
| 0211 | Init's hook-handler event-emission contract |
| 0212 | Wrapper rename already partially landed; verify + flip |
| 0213 | Does init write the agentdb MCP registration? |
| 0214 | `RUFLO_*` env-var usage across code |
| 0215 | Codemod golden-master test existence in pipeline |
| 0216 | Partially landed via Batch S Phase 1 (ADR-128) skills work; verify + flip |
| 0217 | QUIC quarantine context; **deferral candidate** — if `deferred`, Amendment with rationale + revisit-trigger |
| 0218 | **Depends on 0207's REMOVE disposition** (preloaded assumption). If 0207 overturns REMOVE, rerun 0218 serially before committing |
| 0219 | Fail-loud paths in controller registry. **MUST consult [[feedback-no-fallbacks]]** |
| 0220 | Learning-controller stub envelopes. **MUST consult [[feedback-no-fallbacks]]** |
| 0221 | GraphDatabaseAdapter corrupt-DB error surfacing. **MUST consult [[feedback-no-fallbacks]]** |
| 0222 | Already landed via fork-local commit on `agentdb`; check INTEGRATION-LEDGER ruflo-row, agentdb section, near top |
| 0223 | Init's `.mcp.json` template — does it canonicalize to ruflo wrapper? |
| 0224 | Substrate's config-validation (Zod bypass) |

## Per-agent prompt template

```
You are auditing ADR-XXXX (Move A, per docs/SESSION-HANDOVER-2026-05-25.md
+ docs/plans/move-a-audit-2026-05-23.md).
READ-ONLY: do NOT use Edit, Write, NotebookEdit, git commit, git push, npm run release.
Tools you may use: Read, Grep, Glob, Bash (read-only: git log, git show, ruflo CLI, acceptance scripts).

Read: docs/adr/ADR-XXXX-*.md

Hint from runbook: <per-ADR hint from table above>

Apply the 4-check preflight per feedback-remediation-adr-preflight:
  1. signal-reaches-audience — cite path:line of production call-site
  2. upstream-hasn't-already-decided — git log on /Users/henrik/source/ruvnet/ruflo
  3. premise-true-at-runtime — cite acceptance test name + result, or recommend writing one
  4. no-sibling-overlap — scan ±3 ADRs in neighborhood

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
2. One commit per ADR (no batching, per handover discipline):
   - Status flip + Amendment from agent's "Suggested Amendment"
   - `superseded by upstream` → append INTEGRATION-LEDGER row in the same commit (per [[feedback-update-integration-ledger]])
   - `deferred` (esp. 0217) → Amendment with rationale + concrete revisit-trigger
   - Findings needing code → flag as serial follow-up, do NOT auto-fix
3. Acceptance gate after every commit: `bash scripts/test-acceptance-fast.sh adr0059,p4` — confirm green. Halt on any failure per [[feedback-no-squelch-tests]].
4. No pushes this swarm.

## Close-out

- `Skill(ruflo-swarm:swarm, args: "shutdown")` after the last commit gates green
- Update `docs/SESSION-HANDOVER-2026-05-25.md` (or write a new handover dated today) capturing Move A execution + any Move B follow-ups

## Success criteria

- Pre-flight passes (clean tree both repos + adr0059+p4 15/15)
- Swarm init succeeds (or reuse confirmed); post-init status healthy
- 16 structured reports returned (or retried-once → manual fallback flagged)
- 0 leftover `proposed` ADRs in 0207–0224
- Acceptance 15/15 sustained through every commit
- INTEGRATION-LEDGER updated for upstream-supersession findings
- `0218 ⇄ 0207` dependency resolved coherently
- Swarm shutdown clean
- Handover written

## Will NOT do

- Run `npm run release` or push anything
- Touch the `hz` remote (per [[feedback-never-touch-hz-remote]])
- Auto-fix code findings from agents
- Batch multiple ADR status flips into one commit
- Use `skip_accepted` to dodge a finding (per [[feedback-skip-accepted-as-squelch]])
- Give time estimates (per [[feedback-no-time-estimates]])
- Squash history (per [[feedback-no-history-squash]])
- Inspect via dev `node_modules/` (per [[feedback-inspect-installed-not-dev-nodemodules]])
- Call raw `npx`/`bash` for swarm lifecycle (per [[feedback-always-use-the-skill]])
- Poll swarm status in a loop (ADR-091)
