# Council re-validation — dialectic-style plan (ADR-0216 → 0227)

> Companion to [COUNCIL-REVALIDATION-HANDOVER.md](./COUNCIL-REVALIDATION-HANDOVER.md).
> The handover defines the *method* (6-expert council, shared memory, per-ADR edits).
> This plan assigns the *intensity* of that method per remaining ADR, so we match
> effort to each ADR's character instead of running a uniform 6-expert swarm on all of them.
>
> **Status: 0215 done (S1, validated). Next: 0216.** Each ADR was read (Considered
> Options + Decision Outcome), not classified from the handover's one-line hints.

## Why match style to ADR

ADR-0215's re-validation showed where verdict-quality actually comes from:

* **Diversity of lenses + independent grounding in real code** — the two highest-value
  findings (the frontmatter-vs-fence false-negative; the false "codemod never over-matched"
  claim) were each surfaced by a *single* lens, 1-against-5.
* **A queen who verifies, not averages** — the contested claims were closed by re-running
  the greps, not by debate or vote.

So the batch does **not** need a full debate everywhere. It needs the right aggregator for
each ADR's question: *"is this claim true?"* (verification) vs *"is this the right call?"*
(judgment).

## Principles carried into every ADR

1. **Verification ≠ decision. Voting/consensus is the wrong aggregator for fact-finding.**
   A correct 1-vs-5 minority finding must win on evidence. Do **not** use hive-mind
   majority/Byzantine consensus to decide whether a claim is true.
2. **Queen independently re-verifies every load-bearing number and every contested claim**
   (re-run the grep / trace the call graph). Agents *surface* candidates; the queen *closes* them.
3. **Conflict-triggered rebuttal, not blanket debate** — spend a second wave only where
   experts materially disagree or a coupled sibling must be reconciled.
4. **Fold corrections into the ADR body**, then append a
   `### Second council re-validation (2026-05-22)` block (under *Swarm review evidence*,
   before *More Information*), and store a one-paragraph synthesis to memory
   `adr-batch-review/adr-NNNN-synthesis`.
5. **Watch the recurring cohort findings** (from the handover): `## Consequences` should be
   nested `### Consequences`; `depends-on` bare-number `[0201]`; "owned by sibling ADR" punts;
   "upstream-inherited" vs fork-introduced; stale re-listed counts; ADR-0202 is `implemented`.

## The intensity ladder

| Tier | Structure | Aggregator | When |
|---|---|---|---|
| **S0** | Solo verification (1 agent + queen spot-check) | queen confirms | already shipped/implemented; question is "does code match the ADR + template clean" |
| **S1** | Parallel diverse lenses + queen-verifies | queen synthesis | correctness fix, decision obvious; verify claims + buildability |
| **S2** | S1 + conflict-triggered rebuttal / sibling cross-check | queen synthesis | coupled to a sibling ADR, or a secondary judgment worth one antithesis pass |
| **S3** | Opponent/judge on the pivotal claim | queen judges crux on **evidence** | verdict hinges on one genuinely contested judgment |
| **S4** | Multi-round thesis → antithesis → synthesis | queen synthesizes the bet | architecture/product bet; premises themselves contested |

The six lenses (handover): code archaeologist (`code-analyzer`), upstream analyst
(`researcher`), corpus analyst (`adr-architect`), template auditor (`reviewer`), feasibility
(`system-architect`), devil's advocate (`analyst`). Drop the **upstream** lens when an ADR is
fork-local with no provenance claim; keep the rest.

## Per-ADR assignments

### S0 — verification only (shipped/implemented)

| ADR | Crux / character | Checks & traps |
|---|---|---|
| **0226** mcp-stdio-frames-raw-stdout | `status: implemented`; JSON-RPC bugfix | Frames go via `process.stdout.write` (not `console.log`); no-op `:594` not reverted; matches code. depends-on 0204. |
| **0225** sequence-build-before-test-ci | `status: implemented`; CI ordering | Race-condition premise real; pipeline actually sequences `build` before `test-ci`. |
| **0227** recalibrate-threshold-for-mpnet | Shipped per memory (0.3→0.15, fork `16d7c87cd`, patch.259) | Confirm ADR matches the shipped change. **Template fix:** H1 carries an `ADR-0227:` prefix (should be title only); frontmatter looked thin — verify it exists. |

### S1 — parallel critique + queen-verifies (correctness fixes)

| ADR | Crux / character | Checks & traps |
|---|---|---|
| **0219** memory-controllers-fail-loud | Fail-loud on `recordOutcome`/`consolidate`; Option A (per-handler) chosen | Verify the silent-fallback claims are real and the fix is buildable. Decision uncontested. Upstream lens optional (fork-local). |
| **0220** learning-controllers-honesty | Fail-loud on stub returns; Option A chosen | Same shape. One antithesis hook: is EWC a genuine background-only stub or real? Verify that one claim. |

### S2 — + conflict-triggered rebuttal / sibling cross-check (coupled ADRs)

| ADR | Crux / character | Checks & traps |
|---|---|---|
| **0216** skills-CLI-+-dedupe-rejected | Option E (minimal `skill list` + corpus-shape acceptance; init-time dedupe **rejected**) | **Reciprocal cross-check with 0215** (preload `adr-0215-synthesis`): confirm 0216 owns user-facing `.claude/skills/` and never touches `.agents/skills/`. Light antithesis on rejecting init-time dedupe. `depends-on: [ADR-0201]` is the known prefixed-form outlier. |
| **0223** init-mcp-canonicalize-to-ruflo | Option A (fix all four in one ADR) | Overlap with 0213 (F-11-001 fold) + 0212 (wrapper brand). Trap: the `ruflo@latest`-wrapper-regression (`bumpWrapperPin`) and `npx -y @sparkleideas/ruflo@latest mcp start` canonical form. |
| **0224** config-defaults-skew-+-Zod-bypass | "Tentative: Option A" (single accessor + arch-test + default unification) | Sibling of 0214 (shared config surface). Verify the 17-package `JSON.parse(config.json)` bypass is real; cross-check 0214's NaN/skew findings. |

### S3 — opponent/judge on the pivotal claim (contested judgment)

| ADR | Crux / character | Checks & traps |
|---|---|---|
| **0218** restore-dispatch-producer | Option A (port upstream #1845 producer); depends-on 0207 | **Re-confirm 0207's REMOVE decision first.** Crux: after 0207 deletes the socket, is restoring the producer (A) right vs removing the feature (B)? Proponent/opponent on restore-vs-remove. |
| **0221** graphadapter-corrupt-DB | "Tentative: Option A" (throw + refuse to start) | Safety judgment: fail-loud throw (A) vs quarantine-and-continue (B) vs configurable (C) at a data boundary. Opponent/judge on that. Verify the "already done" `fs.existsSync` gate state. |

> **0222** is *not* run as a staged debate — see *Special case* below.

### Special case — 0222 (queen's direct ruling, not a staged dialectic)

**Per explicit instruction (2026-05-22): for 0222, ignore the ADR's "defer to the
dialectic" instruction and rule by best judgement.** The Decision Outcome reads
"Tentative: Option A — delete, *conditional on the dialectic* resolving
slice-05-ALIVE vs slice-06-DEAD." But *is-this-code-dead* is a binary fact, not a
matter of argument — a staged proponent/opponent round is ritual. Determine the
truth by evidence and rule.

Method:

* Run the S1 lenses to verify the ADR's *factual* claims (436 LOC; the
  `controller-registry.ts` refs 75/107/514/1180/2038-2041; the
  CHANGELOG/MIGRATION-LOG advertising; the cross-fork export list).
* **Queen rules dead-vs-alive directly** by tracing the call graph end-to-end:
  does anything actually *consume* `FederatedLearningManager`'s methods
  downstream, or does the controller-registry merely *instantiate* it
  (instantiation ≠ live consumer)? Reconcile with the
  `project-deprecated-controllers` memory (only `federatedSession` /
  `federatedLearningManager` are deletable; **keep** `graphAdapter` /
  `learningBridge`).
* **De-tentative-ize the ADR**: replace "Tentative / conditional on the dialectic"
  with a definite decision plus the call-graph evidence that settled it.

### S4 — multi-round dialectic (architecture/product bet)

| ADR | Crux / character | Checks & traps |
|---|---|---|
| **0217** QUIC | Option C — **quarantine + defer** (reverses the original "build full QUIC" draft); `supersedes: [0205, 0206]` | The heavyweight. Wave 1 establishes facts (truly dormant? no driver? upstream abandoned?). Wave 2: proponent(quarantine) vs opponent(honest single-writer mirror, B). Queen synthesizes the product bet **and** the supersession framing — does `supersedes:[0205,0206]` correctly capture *declining to build* what they specified? Note filename slug says "implement-full" — stale vs the chosen quarantine (cf. 0215's slug). |

## Per-tier method (how to actually run each)

* **S0** — Spawn one `code-analyzer` (or `system-architect` for CI/config) to diff the ADR's
  claims against the implemented code + check template conformance. Queen spot-checks the one
  load-bearing fact and the template fix. No swarm.
* **S1** — Spawn 5–6 lenses in parallel (background, shared memory), each thesis→antithesis→verdict
  writing to `adr-NNNN-review`. Queen re-verifies load-bearing numbers, folds edits, appends block.
* **S2** — S1, but the corpus/feasibility lens is explicitly tasked with the sibling cross-check
  (preloaded synthesis in the blackboard). If two lenses materially conflict, run a single targeted
  rebuttal wave feeding them each other's findings; otherwise queen resolves directly.
* **S3** — S1 for breadth, **plus** a dedicated proponent and opponent assigned to the pivotal
  claim, each arguing from real code. Queen judges the crux on evidence. (0222 is handled
  separately — see *Special case* — because its crux is a binary fact, not a contestable judgment.)
* **S4** — Two explicit rounds. Round 1: lenses verify the contested *premises*. Round 2: proponent
  vs opponent debate reading Round 1's blackboard. Queen synthesizes both the decision and its
  cross-corpus framing (supersession).

## Coupled-ADR preload map

Load these into the blackboard so cross-checks are real, not asserted:

* **0216** ← `adr-0215-synthesis` (reciprocal skills-seam separation)
* **0218** ← 0207's REMOVE decision (re-validated 2026-05-22 per `batch-shared-context`)
* **0223** ← 0212 (wrapper brand) + 0213 (F-11-001 fold) decisions
* **0224** ← 0214 (config surface: F-14-014 Zod bypass / F-14-015 NaN)

## Execution & state

* **Order:** numeric (0216 → 0227). No dependency forces a reshuffle (0207 re-validated; 0215 done).
  Cost is not flat — **0217 (S4) is the expensive one mid-queue, and 0222 needs a real end-to-end
  call-graph trace** (see *Special case*); the rest are lighter, not end-loaded.
* **Swarm:** reuse `swarm-1779479028397-t4z22l` (hierarchical, queen-led) within its 7-day TTL;
  re-`swarm_init` with matching `{topology, maxAgents, strategy}` auto-reuses it (ADR-0098).
* **Per-ADR state:** findings → memory `adr-NNNN-review/adr-NNNN-<lens>`; synthesis →
  `adr-batch-review/adr-NNNN-synthesis`; edits + `### Second council re-validation (2026-05-22)`
  block in the ADR file. `TaskList` is empty this session — memory is the source of truth.

## References

* Method + shared traps: [COUNCIL-REVALIDATION-HANDOVER.md](./COUNCIL-REVALIDATION-HANDOVER.md)
* Shared context (paths/traps/conventions): memory `adr-batch-review/batch-shared-context`
* MADR template: `~/.claude/skills/adr-create/SKILL.md`
* Audit findings (`F-XX-YYY`): this directory
