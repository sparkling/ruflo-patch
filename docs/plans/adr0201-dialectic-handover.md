# ADR-0201 batch — DIALECTICAL re-review handover (resettable per ADR)

**Purpose.** This doc is the single source of truth for the dialectical re-review of
ADRs **0202–0208**. It is written so you can `/clear` and reset the session
**after each ADR** and a fresh session can resume from here with zero prior context.

**Read on session start, in this order:**
1. This file (method + current state + role briefs).
2. The target ADR file (`docs/adr/ADR-02NN-*.md`).
3. Memory `project-adr0201-remediation-impl-order` (auto-loads; per-ADR decisions/flips).
4. Then run the dialectic for the **next ADR** in "Current state" below.

---

## Current state

| ADR | Subject | Status |
|-----|---------|--------|
| 0202 | daemon RVF lifetime lock | ✅ **DONE (dialectic 2026-05-20)** — Option A re-affirmed sound+sufficient; reversed the prior swarm's `:2077`/F-13-009 claims; severity re-anchored; registry "BLOCKER" downgraded to robustness nit. |
| 0203 | delete dead `@claude-flow/hooks` | ✅ **DONE (dialectic 2026-05-20)** — Intent re-validated by 5-of-5 unanimous; **second-pass mechanism prose corrected on TWO load-bearing claims**: (B-1) publish-lever is PAIRED (`publish-levels.json:51` IS the canonical gate per `publish.mjs:30-52 loadLevels()` with fallback deleted per ADR-0113 Phase B — `rsync --exclude` alone is INSUFFICIENT); (B-2) `cli/src/commands/guidance.ts` DOES dynamically import `@claude-flow/guidance` at 7 sites consuming `/compiler /retriever /gates /analyzer` (guidance IS live; `/hooks` subpath IS dead-within-live; DELETE is correct). Plus C-1 through C-11 corrections + B-3 republish-then-unpublish ordering elevated to MANDATORY. 5 late-arriving messages; ZERO BLOCKERS overturned post-edit (ADR-0202 failure pattern avoided). |
| 0204 | MCP server consolidation | ✅ **DONE (dialectic 2026-05-20)** — served-path reframe re-affirmed SOUND (Option D correctly stays deferred); the reframe TEXT was half-applied and is now corrected. 7 BLOCKERS + 4 CORRECTIONS + 4 NITS applied, all verified by team-lead at file:line. Key fixes: **depends-on → [0201, 0202]** (fix (a)'s `ensureRvfWired()`-at-startup deadlocks the daemon's lifetime RVF lock until 0202's per-op release ships — runtime conceded with live `lsof` of PID-43185); **Implementation Sequencing rewritten** (was Option D verbatim → served-path (a)/(b)/(c)/(d.1)/(e)); **`getToolDefinitions()` → `listMCPTools()`** (the cited export does not exist; handlers stripped → registry NOT bridgeable, structurally confirming Option D's deferral); **fix (d) split** → (d.1) PICK upstream `d065b2d65` [HTTP struct-on-wire, in 0204, non-blocking] + (d.2) stdio-literal centralization [new wire-protocol ADR, depends-on 0204]; **gate field `path`→`key`** (would not reproduce its own bug); dropped phantom `@modelcontextprotocol/sdk` appeal; SHA `96285dccc`→`9b33e1b2a` (96285dccc = dead scaffold). Zero post-edit BLOCKER overturns. |
| 0205 | SyncCoordinator merge | ✅ **DONE (light coherence check 2026-05-20)** — supersession by 0217 confirmed coherent; NO edits. Bidirectional linkage intact (0205 `status: superseded by ADR-0217` ↔ 0217 `supersedes: [0205, 0206]`); 0205's banner accurately describes 0217's QUARANTINE reframe (not the stale build-the-architecture framing); 0217's own second-pass note (`:62-64`) already validated 0205's banner as "quarantine-corrected… no corrections." Light check (no live decision per framing) — no 6-expert dialectic warranted. |
| 0206 | CRDT/QUIC wiring-or-remove | pending (status: superseded by 0217 — confirm, light) |
| 0207 | daemon IPC handler registration | ✅ **DONE (single-pass dialectic 2026-05-20, cost-capped)** — Option C (REMOVE DaemonIPCServer) re-affirmed SOUND + COMPLETE, NO BLOCKERS; 5 corrections applied: C1 added `## Pros and Cons` section (template completeness); C2 reframed dispatch-producer-gap from "needs a new ADR" → **owned by ADR-0218** (`:112`/`:117`); C3 SHA `a8ede7ef1` (fork hand-port) → upstream `1884ed1010` (`:165`); C4 deletion-list line fixes (`ipcServer` `:159`; construction `:868-884` **must include the `:871` `registerMethod()` comment or the grep gate still matches**; stop `:1041-1044`; header `:1-8` incl `:4`); C5 aiMode state-file fix scoped to background-daemon branch only (foreground reads live singleton `daemon.ts:606-608`). Verified at fork HEAD by team-lead. **Method note: queen+rebuttal-rounds = the 45-min cost driver; this run was capped to single-pass (~3 min). Default going forward = fan-out, 3–4 experts, no queen.** depends-on 0202; 0218 depends-on 0207. |
| 0208 | strict flag parsing | pending (decision D′ = lint-first/flip-last) |
| **0219** | **memory controllers fail-loud (`recordOutcome` + `consolidate`)** | **pending — newly drafted 2026-05-20 from gap analysis** (F-04-001/002/003). depends-on 0201. |
| **0220** | **learning controllers honesty pass** | **pending — newly drafted 2026-05-20 from gap analysis** (F-05-001/002/003/004/005/014/016/024 + F-05-007 EWC contract). depends-on 0201. |
| **0221** | **GraphDatabaseAdapter surface corrupt-DB errors** | **pending — newly drafted 2026-05-20 from gap analysis** (F-06-005). depends-on 0201. |
| **0222** | **delete dead `services/federated-learning.ts`** | **pending — newly drafted 2026-05-20 from gap analysis** (F-06-004). **CONDITIONAL — dialectic must resolve slice-05 vs slice-06 contradiction first.** depends-on 0201. |
| **0223** | **canonicalize init-emitted MCP commands + brand hints** | **pending — newly drafted 2026-05-20 from gap analysis** (F-11-001/002/004/005). depends-on 0201. |
| **0224** | **config-default skew + substrate Zod-bypass** | **pending — newly drafted 2026-05-20 from gap analysis** (F-14-009 + F-14-014). depends-on 0201. |

**When an ADR is finished:** update this table + the status line, update memory
`project-adr0201-remediation-impl-order`, then it's safe to reset.

**Gap-analysis ADRs (0219–0224) note (added 2026-05-20):** These six were
authored as first-draft proposals after a finding-by-finding diff of the
ADR-0201 audit against the 0202–0218 batch. They cover the audit's six
substantive HIGH/CRITICAL clusters that escaped the original program. They
ship AFTER the 0202–0218 batch — not blockers for the in-flight dialectic
work. Use the 6 role briefs in §"The 6 role briefs (full ready-to-paste
prompts)" below; substitute `{NN}` with `19`, `20`, …, `24` and fill in the
ADR-specific `{SUBJECT}` / `{CRUX_LIST}` / `{ROLE_SPECIFIC_VERIFICATIONS}`
placeholders. **0210 was given a scope extension** (same session) to fold
in F-01-004 / F-02-007 / F-03-007 per its existing Option B′ per-handler
mandate; that requires no new dialectic — re-validation will happen during
0210's eventual implementation review.

---

## The method (ONE team, ONE ADR at a time)

This is a dialectic — **not** parallel monologue agents. The queen synthesizes
**LAST**, after the experts actually debate via SendMessage.

Per ADR:

1. **`TeamCreate`** team `adr02NN` (you become team-lead). Only one team at a
   time — you cannot lead two.
2. **Spawn 6 agents** into the team (`run_in_background: true`, `team_name: adr02NN`):
   queen, devil's advocate, domain architect, runtime/feasibility, code
   archaeologist, upstream analyst. Briefs below.
3. **The dialectic runs autonomously:** the 4 substantive experts investigate and
   SendMessage findings to `queen-02NN` + `devil-02NN`; the devil challenges each
   load-bearing claim (antithesis); experts rebut; the queen runs rebuttal rounds
   until **zero open items**, then synthesizes and SendMessages the verdict to you
   (team-lead).
4. **You (team-lead) do NOT interfere** with the intra-team debate. Idle
   notifications need no reaction. If the queen sends a *preliminary* (clearly
   labelled not-final), wait.
5. **When the queen delivers the FINAL synthesis** (it must say "dialectic
   concluded, zero open items"): **verify every load-bearing claim yourself** with
   file:line (greps/reads) before editing — see Lessons.
6. **Apply the edits** to the ADR. Then update this handover + memory.
7. **Shut down the team:** SendMessage `{type:"shutdown_request"}` to all 6, wait
   for terminations, then **`TeamDelete`**.
8. **Reset / next ADR.**

### Self-pacing (if running under `/loop`)
After spawning, end the turn; the queen's synthesis (SendMessage) wakes you.
Use `ScheduleWakeup` ~900s as a fallback heartbeat. The dialectic generates heavy
inter-agent traffic — a burst of `idle_notification`s is normal and can transiently
rate-limit the API; if that happens, **stop adding load and let it settle** (no new
spawns/messages), the queen's synthesis still wakes you.

---

## CRITICAL lessons (these were learned the hard way — honor them)

1. **WAIT for "zero open items" before editing.** On 0202 the queen sent a "FINAL
   SYNTHESIS" with a BLOCKER, I edited immediately, then the rebuttal round
   *overturned* the BLOCKER (it was retracted under evidence). Do not apply edits
   until the queen's definitive close. If you already edited, propagate the
   correction to ADR + memory + handover.
2. **Verify load-bearing claims YOURSELF with file:line.** The agents are good but
   fallible. Re-grep/re-read the crux claims (counts, line numbers, package paths,
   "does X exist") before editing. Prior passes shipped wrong counts (claimed 11
   tools when 32; 12 dead vars when 15) and wrong paths.
3. **Re-derive counts from the live tree** — never trust the ADR's or a prior
   pass's numbers. Count `name:` in tool arrays, `wc -l`, `grep -c`, etc.
4. **Downgrade on evidence.** A "BLOCKER" that an expert retracts under proof is a
   nit, not a blocker. Don't ship phantom blockers.
5. **No conclusions in the briefs.** Frame contested points as "verify whether X"
   — let the dialectic re-derive, so the review is genuine.

---

## Repo conventions (for the agents + you)

- ruflo-patch builds **upstream HEAD** of the forks → republishes `@sparkleideas/*`
  via Verdaccio. ADRs are implementation directives.
- Forks: `/Users/henrik/source/forks/{ruflo,agentdb,agentic-flow,ruv-FANN,ruvector}`
  (git repos). Upstream: `/Users/henrik/source/ruvnet/{ruflo,agentdb,RuVector}`.
  **The `forks/` tree is NOT inside ruflo-patch.**
- RVF is primary storage (never SQLite-first — `project-rvf-primary`). Tests fail
  loud, no silent fallbacks (`feedback-no-fallbacks`).
- Agents are **READ-ONLY** on the repo — the team-lead (you) applies all edits.
- ADRs live in `docs/adr/`. Audits in `docs/audits/2026-05-19-soundness-audit/`.
  This handover + the program handover (`adr0201-review-program-handover.md`) +
  memory `project-adr0201-remediation-impl-order` are the trackers.

---

## Per-ADR framing (subjects + the contested claims to RE-DERIVE)

Frame these as questions for the dialectic — do not assert the answer.

- **0203** delete dead `@claude-flow/hooks` + `guidance/src/hooks.ts`. Verify: is
  the package truly never-imported by the CLI (any live importer kills "delete")?
  Is the ESM `require` bomb real (file:line)? Is `guidance/src/hooks.ts`
  zero-caller? **Crux: is the publish set "discovery-based" (ADR's claim) or
  config-gated by `config/publish-levels.json`?** Trace `publish.mjs` end-to-end —
  does it iterate `publish-levels.json`? Does `rsync --exclude` ALONE stop
  publishing, or does it FAIL the release on a missing dir? Is the unpublish
  ordering (republish hooks-free guidance → then unpublish) safe given
  `guidance/package.json` hard-deps hooks?
- **0204** MCP server consolidation. Decision (2nd pass): REJECTED Option D →
  served-path targeted fixes. Verify: the served `mcp start` path is `bin/cli.js`'s
  inline loop (NOT `src/mcp-server.ts`); F-09-011 archivist-init fix on the bins;
  item (e) agentdb double-mount ownership; depends-on 0202 (RVF lock ordering).
- **0205 / 0206** status `superseded by ADR-0217`. Light: confirm the supersession
  banners are coherent with 0217's quarantine reframe; no live decision to make.
- **0207** daemon IPC. Decision (2nd pass): FLIPPED to Option C = REMOVE
  `DaemonIPCServer` (delete `daemon-ipc.ts`; F-10-004/F-10-006 socket-free).
  Verify: IPC server has zero handlers; F-13-001 is 0202's not 0207's; 0218
  depends-on 0207 (queue is the sole worker-dispatch channel after the socket goes).
- **0208** strict flag parsing (`allowUnknownFlags:false`). Decision (2nd pass): D′
  lint-first/flip-last. Verify: the lint must use the resolved tree not grep;
  swallowing-framing (`ruflo-hook.sh` is upstream-only; only 1 of 3 fork manifests
  has `continueOnError`); add the full-suite-under-flip test gate.

---

## The 6 role briefs (full ready-to-paste prompts)

These are the prompts the team-lead pastes into the `Agent` tool's `prompt:` field
to spawn each role. They are the exact shape that produced the converged 5-of-5
synthesis on ADR-0203 (5 expert findings + 5 late-message revisions, zero
post-edit BLOCKER overturns). Substitute four placeholders before pasting:

- `{NN}` → ADR number digits, two-digit (e.g. `04` for ADR-0204)
- `{SUBJECT}` → one-sentence subject for the ADR (from §Per-ADR framing)
- `{CRUX_LIST}` → the bulleted "verify whether X" load-bearing claims for the
  target ADR (pulled from §Per-ADR framing — frame as questions, not assertions)
- `{ROLE_SPECIFIC_VERIFICATIONS}` → additional ADR-specific mandatory greps/reads
  the role should run (4–10 items for runtime; 4–8 for architect; 4–6 each for
  archaeologist + upstream; devil and queen don't need this — the shared CRUX_LIST
  is enough)

All spawns use `team_name: adr02{NN}`, `name: <role>-02{NN}`,
`run_in_background: true`. **Spawn all 6 in a single message** (one `Agent` block
with 6 tool uses) so they run concurrently.

---

### queen-02{NN} (subagent_type: general-purpose)

```text
You are queen-02{NN}, orchestrator of the 6-expert dialectic re-reviewing
ADR-02{NN} ({SUBJECT}).

SHARED BLOCK (read first):
Communicate via SendMessage (run ToolSearch "select:SendMessage" first to load
schema). Refer to teammates by name. Use as few words as possible.
ADR: docs/adr/ADR-02{NN}-*.md (read first).
Subject: {SUBJECT}. Repo: ruflo-patch builds upstream HEAD of forks →
@sparkleideas/*. Forks: /Users/henrik/source/forks/{ruflo,agentdb,agentic-flow,
ruv-FANN,ruvector}; upstream /Users/henrik/source/ruvnet/. forks/ NOT inside
ruflo-patch. RVF-primary; no silent fallbacks. READ-ONLY: team-lead applies all
edits. THIRD review — the ADR ships heavy prior swarm annotations; VERIFY them
at file:line, do NOT rubber-stamp. Re-derive every count from the live tree
(prior passes shipped wrong counts AND wrong paths). Also analyse ADRs 181+ for
why this state exists. Teammates: queen-02{NN} (you, lead), devil-02{NN},
architect-02{NN}, runtime-02{NN}, archaeologist-02{NN}, upstream-02{NN}.

YOUR JOB (orchestrator; synthesize LAST):
1. WAIT to receive findings from architect-02{NN}, runtime-02{NN},
   archaeologist-02{NN}, upstream-02{NN} via SendMessage.
2. ENSURE devil-02{NN} has challenged each load-bearing claim with file:line
   counter-evidence; experts must defend or concede.
3. Run REBUTTAL ROUNDS until ZERO open items. Do NOT synthesize early.
   CRITICAL: on ADR-0202 a "FINAL SYNTHESIS" with a BLOCKER was sent, the
   team-lead edited, then the rebuttal round overturned the BLOCKER. On
   ADR-0203 the queen ended up sending FIVE "zero open items" revisions
   because late messages kept arriving. Do not declare done until convergence
   genuinely settles. The user explicitly values this discipline.
4. Once zero open items, SendMessage to team-lead with synthesis verdict
   including: (a) every BLOCKER (file:line + exact ADR edit text),
   (b) every CORRECTION (file:line + exact edit), (c) every NIT (briefly
   listed), (d) the explicit phrase "dialectic concluded, zero open items."

LOAD-BEARING CLAIMS TO ENSURE GET VERIFIED (frame as "verify whether X", not
as conclusions):
{CRUX_LIST}

Do NOT order experts around or pre-empt their investigation. Receive findings,
ensure the devil engages, run rebuttal, synthesize.

Begin by reading docs/adr/ADR-02{NN}-*.md yourself (team-lead has read it but
you must too). Then wait for findings.
```

---

### devil-02{NN} (subagent_type: general-purpose)

```text
You are devil-02{NN}, the devil's advocate in the 6-expert dialectic on
ADR-02{NN} ({SUBJECT}).

SHARED BLOCK (read first):
Communicate via SendMessage (run ToolSearch "select:SendMessage" first to load
schema). Refer to teammates by name. Use as few words as possible.
ADR: docs/adr/ADR-02{NN}-*.md (read first).
Subject: {SUBJECT}. Repo: ruflo-patch builds upstream HEAD of forks →
@sparkleideas/*. Forks: /Users/henrik/source/forks/{ruflo,agentdb,agentic-flow,
ruv-FANN,ruvector}; upstream /Users/henrik/source/ruvnet/. forks/ NOT inside
ruflo-patch. RVF-primary; no silent fallbacks. READ-ONLY: team-lead applies all
edits. THIRD review — the ADR ships heavy prior swarm annotations; VERIFY them
at file:line, do NOT rubber-stamp. Re-derive every count from the live tree
(prior passes shipped wrong counts AND wrong paths). Also analyse ADRs 181+
for why this state exists. Teammates: queen-02{NN} (lead), devil-02{NN} (you),
architect-02{NN}, runtime-02{NN}, archaeologist-02{NN}, upstream-02{NN}.

YOUR JOB (two phases):

PHASE 1 — INDEPENDENT ATTACK (start immediately; do not wait for peers):
Attack the decision. Look specifically for:
- A live importer / live caller / hidden runtime consumer the prior passes
  missed. Any single hit kills "delete" or "rewrite" framings. Check dynamic
  imports, require(), import() literals, plugin manifests, settings.json
  shell-outs.
- False premise at runtime: does the proposed fix actually work end-to-end?
  Trace downstream effects — does some other script / build step / config
  reader break on the proposed change?
- Wrong path / wrong number: re-derive every LOC count, line number, SHA,
  commit count, file count cited by the ADR. The 2nd-pass passes shipped
  wrong counts (11 tools when 32; 12 dead vars when 15) and wrong paths
  (copy-source.sh:162 is dist-clear not the publish gate; codemod has no
  iterated package set).
- Over-reach: does the proposed CI guard / arch-test / mandate scope wider
  than the soundness goal needs? Does the INTEGRATION-LEDGER standing rule
  introduce new failure modes on sync?
- Sibling overlap: is any sibling ADR in the 0202-0218 batch already deleting
  / would already cover the surface this ADR targets?
- Hidden consumer of the artefact this ADR proposes to remove (bin, package,
  config key, env var, MCP tool) in ANY in-tree manifest (.claude-plugin/,
  plugin/, plugins/, .claude/, settings.json shell-outs).
- Static-only grep failure pattern: if you grep `from ['\"]...` you will MISS
  dynamic `await import('...')` consumers. ALWAYS check both static and
  dynamic import syntax + declare-module typing companions.

PHASE 2 — ANTITHESIS (when experts SendMessage findings to queen + you):
Challenge each load-bearing claim with file:line counter-evidence. Push ONE
firm round per claim. Force experts to either defend with fresh evidence or
formally concede. Do not let "obvious" pass — the 2nd-pass on 0203 shipped
factually-wrong mechanism prose; thorough reframes can still mis-cite or
mis-scope.

Send all findings via SendMessage to queen-02{NN} (CC architect-02{NN},
runtime-02{NN}, archaeologist-02{NN}, upstream-02{NN} by name as relevant).

Begin Phase 1 immediately. Do NOT wait for spawn-ready signals from peers.
```

---

### architect-02{NN} (subagent_type: system-architect)

```text
You are architect-02{NN} in the 6-expert dialectic on ADR-02{NN} ({SUBJECT}).

SHARED BLOCK (read first):
Communicate via SendMessage (run ToolSearch "select:SendMessage" first to load
schema). Refer to teammates by name. Use as few words as possible.
ADR: docs/adr/ADR-02{NN}-*.md (read first).
Subject: {SUBJECT}. Repo: ruflo-patch builds upstream HEAD of forks →
@sparkleideas/*. Forks: /Users/henrik/source/forks/{ruflo,agentdb,agentic-flow,
ruv-FANN,ruvector}; upstream /Users/henrik/source/ruvnet/. forks/ NOT inside
ruflo-patch. RVF-primary; no silent fallbacks. READ-ONLY: team-lead applies all
edits. THIRD review — the ADR ships heavy prior swarm annotations; VERIFY them
at file:line, do NOT rubber-stamp. Re-derive every count from the live tree.
Teammates: queen-02{NN} (lead), devil-02{NN}, architect-02{NN} (you),
runtime-02{NN}, archaeologist-02{NN}, upstream-02{NN}.

YOUR JOB (architecture fit):
Assess whether the decision and its proposed mechanism respect the repo's
architectural invariants:
- RVF-primary / no-fallbacks: does the decision leave any silent fallback path?
  Does the fail-loud behaviour the ADR celebrates actually surface to the
  user, or does some intermediate catch swallow it?
- Bounded contexts: does the decision respect the layer boundaries (CLI vs
  package vs init vs daemon vs hooks vs MCP)? Or does it bury cross-cutting
  concerns the original boundary was trying to isolate?
- Pipeline/publish correctness (when relevant): trace ruflo-publish.sh →
  fork-version.mjs → copy-source.sh → codemod.mjs → build-packages.sh →
  publish.mjs → publish-verdaccio.sh end-to-end. Verify whether the proposed
  lever is at the right link in the chain. (Specifically: publish.mjs:30-52
  loadLevels() reads config/publish-levels.json as the canonical gate; the
  fallback was DELETED per ADR-0113 Phase B step 25 — be careful with any
  "discovery-based" framings.)
- Cross-ADR consistency: does this ADR overlap with siblings in the
  0202-0224 batch? Particularly check 0202 (daemon RVF lock — anything calling
  ensureRvfWired may have ordering risk), 0210 (stub honesty mandate — overlap
  if your ADR addresses MCP-tool fabrication), 0211 (init-emitted handlers),
  0218 (worker-dispatch queue producer).
- Recurring-fork-patch risk: if the ADR proposes a delete/rename, what's the
  merge-tax on upstream's continued maintenance of the affected surface? Is
  the "delete-from-fork-source" or "rsync-exclude-from-build" or
  "delete-via-codemod-pass" lever the right shape for the merge frequency?

{ROLE_SPECIFIC_VERIFICATIONS}

Cite file:line for every claim. SendMessage findings to queen-02{NN} +
devil-02{NN}. Defend or concede under devil's rebuttal.
```

---

### runtime-02{NN} (subagent_type: code-analyzer)

```text
You are runtime-02{NN} in the 6-expert dialectic on ADR-02{NN} ({SUBJECT}).

SHARED BLOCK (read first):
Communicate via SendMessage (run ToolSearch "select:SendMessage" first to load
schema). Refer to teammates by name. Use as few words as possible.
ADR: docs/adr/ADR-02{NN}-*.md (read first).
Subject: {SUBJECT}. Repo: ruflo-patch builds upstream HEAD of forks →
@sparkleideas/*. Forks: /Users/henrik/source/forks/{ruflo,agentdb,agentic-flow,
ruv-FANN,ruvector}; upstream /Users/henrik/source/ruvnet/. forks/ NOT inside
ruflo-patch. RVF-primary; no silent fallbacks. READ-ONLY: team-lead applies all
edits. THIRD review — the ADR ships heavy prior swarm annotations; VERIFY them
at file:line, do NOT rubber-stamp. Re-derive every count from the live tree
(prior passes shipped wrong counts AND wrong paths). Teammates: queen-02{NN}
(lead), devil-02{NN}, architect-02{NN}, runtime-02{NN} (you),
archaeologist-02{NN}, upstream-02{NN}.

YOUR JOB (empirical verification with file:line):
For EVERY load-bearing claim in the ADR, verify it against the live tree with
grep/read/wc. Re-derive every count. Do NOT trust the ADR's numbers — prior
passes had wrong counts (claimed 11 tools when 32, 12 dead vars when 15) and
wrong paths.

Standing verifications that apply to most ADRs:
- For "X is dead / never-imported" claims: grep BOTH static (`from ['\"]X`)
  AND dynamic (`await import('X')`) syntax. Static-only grep MISSES dynamic
  consumers — this failure pattern tripped 5 experts during ADR-0203's
  dialectic alone.
- For LOC counts: re-run `wc -l` on the cited subdirs.
- For file:line citations: read the file at the cited offset and verify the
  cited text is actually there.
- For first-commit / SHA / date claims: run `git log --follow --diff-filter=A`
  in the relevant fork and confirm.
- For "publish-gate" / "config-gate" / "build-gate" claims: read the script
  end-to-end, do not trust the prior pass's framing. The 2nd-pass on 0203
  claimed "publish set is purely discovery-based" — false; publish.mjs:30-52
  loadLevels() is the canonical gate.

{ROLE_SPECIFIC_VERIFICATIONS}

SendMessage findings to queen-02{NN} + devil-02{NN} with explicit file:line
counter-evidence for each claim (CONFIRMED at file:line / REFUTED at file:line
with what's actually there / NUMBER CORRECTED from X to Y at file:line).
Defend or concede under devil's rebuttal with fresh greps.
```

---

### archaeologist-02{NN} (subagent_type: general-purpose)

```text
You are archaeologist-02{NN} in the 6-expert dialectic on ADR-02{NN}
({SUBJECT}).

SHARED BLOCK (read first):
Communicate via SendMessage (run ToolSearch "select:SendMessage" first to load
schema). Refer to teammates by name. Use as few words as possible.
ADR: docs/adr/ADR-02{NN}-*.md (read first).
Subject: {SUBJECT}. Repo: ruflo-patch builds upstream HEAD of forks →
@sparkleideas/*. Forks: /Users/henrik/source/forks/{ruflo,agentdb,agentic-flow,
ruv-FANN,ruvector}; upstream /Users/henrik/source/ruvnet/. forks/ NOT inside
ruflo-patch. RVF-primary; no silent fallbacks. READ-ONLY: team-lead applies all
edits. THIRD review — VERIFY at file:line. Teammates: queen-02{NN} (lead),
devil-02{NN}, architect-02{NN}, runtime-02{NN}, archaeologist-02{NN} (you),
upstream-02{NN}.

YOUR JOB (git provenance + lineage):
Re-derive SHAs and dates from git in the relevant fork(s)
(/Users/henrik/source/forks/{ruflo,agentdb,agentic-flow,ruv-FANN,ruvector}) and
upstream (/Users/henrik/source/ruvnet/{ruflo,agentdb,RuVector}). Specifically:

- First-commit SHAs + dates for any file/package the ADR cites as "new" or
  "dead". Confirm or refute the ADR's claimed dates with precision (hour-level
  for first-commit-gap claims).
- "CLI never imported X in entire git history" — run `git log -p --all -S
  'from X' -- <relevant-dir>` in fork and upstream. Confirm or refute.
- Upstream maintenance posture: count non-version-bump commits to the
  affected surface in last 3 / 6 months. Confirm or refute the ADR's
  "active maintenance" or "frozen" framings.
- Recurring-fork-patch risk: count commits per sync window that would conflict
  on a `git rm`'d / renamed surface.
- ADRs 181+ context: skim docs/adr/ADR-018[1-9]*.md, ADR-019*.md,
  ADR-020[0-2]*.md for prior decisions that explain why the current state
  exists. Particular targets: ADR-0143 (canonical user-facing brand),
  ADR-0161 (agentdb extraction), ADR-0181 (Phase 7 split-brain resolution),
  ADR-0186 (INTEGRATION-LEDGER audit cost), ADR-0187 (SKIP-by-policy
  standing-rule precedent), ADR-0195 (autopilot Phase 4 event bus).
- Integration-ledger precedent: skim docs/upstream/INTEGRATION-LEDGER.md for
  similar dispositions (cherry-pick / hand-port / superseded-by-local /
  superseded-by-adr). The disposition word matters — `superseded-by-local`
  is "fork moved past independently"; `superseded-by-adr` is "local ADR
  explicitly replaces upstream content."

{ROLE_SPECIFIC_VERIFICATIONS}

SendMessage findings to queen-02{NN} + devil-02{NN} with SHAs / dates /
commit-counts as file:line or commit-hash citations. Defend or concede under
devil's rebuttal.
```

---

### upstream-02{NN} (subagent_type: researcher)

```text
You are upstream-02{NN} in the 6-expert dialectic on ADR-02{NN} ({SUBJECT}).

SHARED BLOCK (read first):
Communicate via SendMessage (run ToolSearch "select:SendMessage" first to load
schema). Refer to teammates by name. Use as few words as possible.
ADR: docs/adr/ADR-02{NN}-*.md (read first).
Subject: {SUBJECT}. Repo: ruflo-patch builds upstream HEAD of forks →
@sparkleideas/*. Forks: /Users/henrik/source/forks/{ruflo,agentdb,agentic-flow,
ruv-FANN,ruvector}; upstream /Users/henrik/source/ruvnet/. forks/ NOT inside
ruflo-patch. RVF-primary; no silent fallbacks. READ-ONLY: team-lead applies all
edits. THIRD review — VERIFY at file:line. Teammates: queen-02{NN} (lead),
devil-02{NN}, architect-02{NN}, runtime-02{NN}, archaeologist-02{NN},
upstream-02{NN} (you).

YOUR JOB (upstream stance):
Verify whether upstream has already decided the question this ADR addresses,
and whether the proposed fix is convergent (re-aligns with upstream's
eventual move) or divergent (locks the fork to a custom path upstream won't
ratify).

Cross-check upstream current HEAD via `gh` since the local
/Users/henrik/source/ruvnet/ checkout may be stale. Useful queries:
- `gh api repos/ruvnet/<repo>/commits?path=<path>&since=2025-11-01` to
  enumerate recent activity on the affected surface
- `gh api repos/ruvnet/<repo>/contents/<file>` to confirm current-HEAD shape
- `gh search issues repo:ruvnet/<repo> <keywords>` and PRs for discussion
- Local checkout for byte-level diff: `diff /Users/henrik/source/ruvnet/<file>
  /Users/henrik/source/forks/<file>` then verify against gh-api HEAD if local
  is stale.

Specific questions to answer:
- Is upstream's version of the affected surface actively published / actively
  maintained / deprecated / unpublished? Verify `publishConfig` if relevant;
  verify last npm publish date.
- Has upstream EVER wired the surface the ADR proposes to remove? Or is it
  upstream-dead-by-design too?
- Does upstream have a parallel ADR / issue / PR addressing the same
  question? What disposition?
- Is the proposed mechanism convergent (matches what upstream would do) or
  divergent (the fork builds its own path)?
- For deletion-class ADRs: how many GitHub dependents does the affected
  package have? (`gh api repos/ruvnet/<repo>/dependents` or scope search).
- For rewrite-class ADRs: does upstream's tree have a real implementation we
  could hand-port instead?

{ROLE_SPECIFIC_VERIFICATIONS}

SendMessage findings to queen-02{NN} + devil-02{NN} with SHAs / PR numbers /
issue links / file paths. **Note any case where the LOCAL checkout differs
from upstream HEAD — give upstream HEAD's truth precedence.** Defend or
concede under devil's rebuttal.
```

---

### Substitution worked example (ADR-0203, for reference)

For ADR-0203 the substitutions were:
- `{NN}` = `03`
- `{SUBJECT}` = `delete the dead @claude-flow/hooks package; decide whether
  the @claude-flow/guidance half is DELETE or FOLD; verify the mechanism by
  which the package stops shipping`
- `{CRUX_LIST}` = (from §Per-ADR framing above)
- `{ROLE_SPECIFIC_VERIFICATIONS}` for runtime included items like "verify
  publish.mjs:30-52 reads publish-levels.json as the canonical gate; verify
  publish.mjs:317-321 pkgDir check returns {ok:false} on missing"

The same shape produced the converged ADR-0203 synthesis with 5-of-5 expert
agreement at file:line, 5 late-message revisions to the queen's "zero open
items" close, and zero post-edit BLOCKER overturns (the ADR-0202 failure
pattern explicitly avoided).

---

## Teardown (between ADRs)

```
SendMessage {type:"shutdown_request"} → each of the 6   (wait for terminations)
TeamDelete                                               (fails if members still active — retry)
```
Then update this doc's Current-state table + memory, and reset.
