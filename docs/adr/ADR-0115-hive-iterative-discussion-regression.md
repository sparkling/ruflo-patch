# ADR-0115: Hive iterative-discussion regression — root cause + fix

- **Status**: Proposed (2026-05-02). Two-regression finding from a 5-panellist investigation hive (P1 git archaeology + P3 code reader + P4 memory-rule forensics + P2 behavior diff + DA dissent). Regression A is fixable in the fork; Regression B is upstream of ruflo and out of scope here.
- **Date**: 2026-05-02
- **Deciders**: Henrik Pettersen
- **Methodology**: Investigation hive `hive-1777724839877-...` (hierarchical, byzantine, 5 worker slots) following the orchestrator/executor pattern. CLI for metadata; Agent tool with named role personas for execution. Synthesis held until all 5 panellists reported per `~/.claude/projects/-Users-henrik-source-hm-semantic-modelling/memory/feedback_hive_queen_must_wait_for_all_panellists.md` rule (added 2026-04-26 by the user as scar tissue for the regression this ADR investigates).
- **Depends on**: ADR-0114 (architectural model + Lens 10 timeline finding). User pushback that produced the timeline question: "some, if not most, of the memory rules in HM, was added after the hive discussions broke after an update to the ruflo plugin."
- **Closes**: ADR-0114 §Done U5 ("investigate the regression in ruflo's hive plugin between mid-April and late-April 2026").

## Context

ADR-0114 §Lens 10 established that the hive feature worked out-of-box for 6+ weeks (2026-03-11 → 2026-04-22, 250+ rich council sessions in `~/source/hm/semantic-modelling/`) on just ONT-0021 methodology ODR + CLAUDE.md anchoring — no memory rules required. Then between 2026-04-23 and 2026-04-27, the user added 7 memory rules (`feedback_swarm_*`, `feedback_hive_*`, `feedback_council_*`, `feedback_wait_for_hive*`) as remediation for observed regressions. The 2026-04-26 incident in `feedback_hive_queen_must_wait_for_all_panellists.md` cites two failures in one ADR-0195 deliberation: Queen v1 spawned in parallel with panellists and finished first on speculation; v3 miscounted "all 7 panellists complete" when SHACL Validator hadn't reported.

User asked: investigate the regression in ruflo's hive plugin between mid-April and late-April 2026.

A 5-panellist investigation hive ran. Findings below.

## Investigation findings

### P1 (Git Archaeologist) — top suspect commit

`32c13d322` 2026-04-22 20:05:40, "fix(swarm-init): eliminate sprawl — generator guardrail + config-fingerprint dedupe (ADR-0098)". One of 8 candidate commits in the 04-15 → 04-27 window; the only one that touches user-visible hive prose (claudemd-generator.ts). 7 sibling commits all rule UNLIKELY (settings-generator-only, init-scaffolding-only, model-string-bump, daemon-IPC, project-root-resolver swap).

### P3 (Code Reader) — verbatim diff

`32c13d322` rewrote `agentOrchestration()` in `v3/@claude-flow/cli/src/init/claudemd-generator.ts`. Pre-regression, the function had no `hive-mind` mention. Post-regression, it added these specific lines (line numbers in the post-32c13d322 file):

```text
- DEFAULT: use Claude Code's built-in `Agent` tool for multi-file or cross-module tasks.
  It spawns subagents with ZERO coordination state, ZERO setup, ZERO cleanup.
- ALWAYS set `run_in_background: true` when spawning agents
- Put ALL agent spawns in a single message for parallel execution
- After spawning agents, STOP and wait for results — do not poll or check status
- DO NOT call `swarm_init`, `hive-mind_spawn`, or `ruflo swarm init` reflexively
  at the start of tasks. Only when:
    (a) the user explicitly asks for claude-flow coordination, or
    (b) persistent cross-session coordination state is actually required.
```

`antiDriftConfig()` was also rewritten — heading flipped from "## Swarm Configuration & Anti-Drift" to "## Swarm Configuration (when explicitly required)"; the `ruflo swarm init --topology hierarchical --max-agents 8 --strategy specialized` worked example was deleted. `whenToUseWhat()` reframed the swarm-init row from "Initialize a swarm" to "Persistent swarm coordination (rare, explicit)".

`git log -S "hive-mind_spawn" --all -- claudemd-generator.ts` confirms `32c13d322` is the introducing commit (and earlier `de2eab778` removed it as part of an unrelated refactor — first appearance in any form before `32c13d322`).

Critical detail: the commit's stated intent was anti-sprawl for `swarm_init` (66 orphan records cited). The literal text **bundled `hive-mind_spawn` into the same prohibition without separate justification**. Hive-mind was side-swiped.

### Empirical verification — the spawn mechanism reads CLAUDE.md

`v3/@claude-flow/cli/src/commands/hive-mind.ts:293`:

```ts
const claudeProcess = childSpawn('claude', claudeArgs, {
  stdio: 'inherit',
  shell: false,
});
```

No `cwd:` option. Per Node.js docs, child inherits parent's cwd. The parent's cwd is the user's project dir. Claude Code launched in a project dir AUTO-READS that dir's CLAUDE.md.

Therefore: when `ruflo hive-mind spawn --claude` shells out, the spawned claude reads the project's CLAUDE.md, INCLUDING any "DO NOT call hive-mind_spawn reflexively" prose generated by `init --full` post-2026-04-22.

Empirical test (2026-05-02): `mktemp -d /tmp/hive-claudemd-probe-XXX; cd $TEST; npx -y @sparkleideas/cli@latest init --full --force` → grep CLAUDE.md → confirmed lines 88-95 contain the exact anti-sprawl prohibition. Fresh-init projects post-04-22 are affected.

### P4 (Memory-Rule Forensics) — sharper finding

The 7 memory rules patch a DIFFERENT issue than the CLAUDE.md prose — they patch the lack of a runtime barrier on Queen-spawn ordering. Specifically (from `feedback_hive_queen_must_wait_for_all_panellists.md`):

> "Incident 1 (2026-04-26 ADR-0195 hive v1): spawned Queen + 7 panellists in parallel via Agent tool. Queen finished first based on speculative reasoning about what each role would say, NOT actual panellist outputs."

> "Incident 2 (2026-04-26 ADR-0195 hive re-run v3): I spawned 8 panellists, then claimed 'all 7 panellists complete' and spawned Queen v3 — but I miscounted. SHACL Validator Engineer hadn't reported. I rationalised it as 'did not report in this re-run; rely on prior outputs from v2' — exactly the failure mode the user had just told me to avoid."

The pattern across all 7 rules: **the Queen-after-panellists ordering is implemented by the assistant's prose-counting, not by a TaskList-gated runtime barrier.** Every rule patches a runtime gap with prescriptive prose.

### P2 (Behavior Comparator) — pre-vs-post signature

Pre-regression sessions (S100 2026-04-13, S0167-related sessions 2026-04-20/21, S0169 2026-04-21):
1. Per-decision voting matrices with one row per named expert
2. Verbatim multi-paragraph expert quotations (Cohen 4-block ruling, Knublauch CONFIRMS quotes)
3. Cross-expert discussion visible (concurrences, withdrawals between v1/v2)
4. DA dissents folded into conditional amendments
5. Declared roster size = voter count

Post-regression sessions (session-402 2026-04-26, q2/q3 sessions 2026-04-26):
1. Queen synthesis precedes panellist outputs (session-402 §Process Notes admits this explicitly)
2. Declared roster ≠ voter count (Q2-OQ-3 6→4; Q3 8→7) without dissent-record explaining who didn't report
3. Panellist §Position-N sections become parallel one-shot monologues
4. DA dissents collapse to "RECORDED but deferred"
5. Citation fabrications (slash-form IRIs, retired predicates) appear because Queen wrote before ground-truth

### DA (Devil's Advocate) — strong dissent

Three dissents stand:

1. **hm CLAUDE.md was last touched 2026-04-22 14:29:37 (commit `e6265def`), 6 HOURS BEFORE `32c13d322` was committed at 20:05.** hm never received the anti-sprawl text. hm experienced the regression. So Regression A cannot be the cause for hm specifically. hm would need to re-run `ruflo init` to inherit the bundled prohibition; they didn't.

2. **The rule gates on user intent**: clause (a) "user explicitly asks for claude-flow coordination" should self-disable the prohibition for explicit hive requests. Logical, but the strongly-worded "DEFAULT: use Agent tool" + "DO NOT call ... reflexively" phrasing biases Claude toward Agent tool psychologically even when the gate is satisfied.

3. **Alternative cause**: ADR-0104 `7e9510246` 2026-04-29 rewrote the Queen prompt + introduced a worker MCP-memory contract. If `mcp__ruflo__hive-mind_*` tools aren't registered in spawned Claude session, workers fail silently → Queen synthesizes prematurely. **Rejected** — too late (04-29) to explain 04-26 incidents.

DA's #1 is decisive: it splits the regression into two components, neither of which is the simple "32c13d322 broke the hive" story.

## Decision — two-regression model

**Regression A (ruflo CLAUDE.md prose, fresh-init projects only)**:
- Cause: `32c13d322` bundled `hive-mind_spawn` into the swarm-sprawl `agentOrchestration()` prohibition without separate justification.
- Mechanism: `init --full` regenerates CLAUDE.md with the anti-sprawl text → claude subprocess launched by `hive-mind spawn --claude` inherits project cwd → reads CLAUDE.md → biased toward Agent tool over claude-flow swarms (incl. hive-mind).
- Affected: ruflo users who run `init --full` (or `init --force`) any time after 2026-04-22 publish.
- NOT affected: hm (last init pre-regression).
- Empirical evidence: 2026-05-02 fresh-init test in `/tmp/hive-claudemd-probe-qbB7MI/` confirms lines 88-95 contain the exact prohibition; `hive-mind.ts:293` confirms cwd inheritance.

**Regression B (orchestration discipline, observed in hm 2026-04-26)**:
- Cause: NOT in any ruflo commit. NOT in CLAUDE.md (hm's wasn't regenerated).
- Mechanism: Queen-after-panellists ordering relies on assistant-side prose-counting; no runtime barrier. Some prompt/runtime change in the 04-22 → 04-26 window made Claude start spawning Queen IN PARALLEL with panellists via the `Agent` tool rather than sequentially, leading to premature speculative synthesis.
- Most likely upstream of ruflo: Claude Code or Claude model update affecting parallel-spawn semantics or default discipline. Not a ruflo bug.
- User remediated with 7 memory rules 2026-04-23 → 2026-04-27 (the strongest enforcement is `feedback_hive_queen_must_wait_for_all_panellists.md` 2026-04-26).

**Cross-repository git evidence (added post-investigation)**:

- hm's CLAUDE.md history: last commit `e6265def` 2026-04-22 14:29:37, with 5 prior commits all manual edits (Karpathy principles, Dev Infrastructure restoration, etc.). NEVER regenerated by `ruflo init` in the regression window. Empirically: hm's CLAUDE.md does not contain "DO NOT call ... hive-mind_spawn ... reflexively" prose.
- hm uses `npx -y @sparkleideas/cli@latest` (no version pin in their package.json or lockfile). Every invocation pulls latest. So hm DID get the new post-32c13d322 CLI binary. But the only fork commit to `hive-mind.ts` in the window — `bb9e56dec` 2026-04-23 (project-root resolver swap) — does not change the Queen prompt or worker-spawn semantics.
- The 04-26 incident description verbatim from `feedback_hive_queen_must_wait_for_all_panellists.md`: **"spawned Queen + 7 panellists in parallel via Agent tool"**. Mechanism is the Claude Code built-in `Agent` tool, NOT `ruflo hive-mind spawn --claude`. So Regression B is a discipline failure at the assistant-orchestration level, not at the CLI-spawn level.
- ruflo-patch CLAUDE.md was regenerated by `init --full --force` on 2026-04-22 00:36 (commit `350469a` "merge generator refresh with project-specific knowledge"). That was BEFORE 32c13d322 (20:05 same day) — so ruflo-patch's CLAUDE.md ALSO lacks the bundled prohibition. Subsequent commits did not regenerate it. (Verified empirically — `grep -i "hive\|reflexive" /Users/henrik/source/ruflo-patch/CLAUDE.md` returns 0 hits.)

This narrows Regression B's causal candidate to:
- **Anthropic Claude Code or model update** in the 04-22 → 04-26 window — not visible in ruflo-patch git or hm git
- The `Agent` tool's parallel-spawn semantics or the assistant's default Queen-after-panellists discipline shifted

Empirical disproof of "ruflo broke it" for hm: hm's CLAUDE.md and the CLI's hive-mind.ts both lack the kind of behavioral change that would explain the 04-26 incident pattern. The only ruflo-side change with potential effect on Queen-spawn discipline (32c13d322's CLAUDE.md prose) didn't reach hm because hm doesn't regenerate.

**The user's recollection ("the hive discussions broke after an update to the ruflo plugin") was correct in spirit but conflated two regressions.** Regression A IS a ruflo update; Regression B is NOT.

## Empirical test methodology — does CLAUDE.md affect spawned hive?

**User's test question**: "Create a new project with init, and make a manual change to its CLAUDE.md to test. If you run a test against a brand new init project, will that test make use of the claude.md? How are the hives launched for these tests? Does that launch method cause claude.md to be evaluated?"

**Answer**: Yes, CLAUDE.md is evaluated. Mechanism:

1. `ruflo hive-mind spawn --claude -o "<obj>"` invokes `commands/hive-mind.ts` line 261-296.
2. Line 293: `const claudeProcess = childSpawn('claude', claudeArgs, { stdio: 'inherit', shell: false });`
3. `childSpawn` is Node `child_process.spawn`. Default cwd is parent's cwd. The parent's cwd is the user's project dir (where they ran `ruflo hive-mind spawn`).
4. Claude Code launched in a directory containing CLAUDE.md auto-loads it as system context (per Claude Code's documented behavior).
5. The Queen prompt embedded in `claudeArgs[claudeArgs.length-1]` (line 286) is supplemented by the CLAUDE.md context.
6. So: anti-sprawl prose in CLAUDE.md → Queen reads it → bias toward Agent tool.

**This is testable empirically**: inject a unique probe string into CLAUDE.md (e.g., `MAGICWORD-xyz123`); run `hive-mind spawn --claude -o "What's the magic word?"`; the spawned Claude WILL find it because Claude Code reads CLAUDE.md on launch.

**For OUR acceptance tests**: any test that runs `npx @sparkleideas/cli@latest hive-mind spawn --claude` (or that exercises the hive's user-facing behavior) IS subject to whatever CLAUDE.md the test project has. Our acceptance harness creates test projects via `init`, so those projects inherit the anti-sprawl prose. Tests that probe hive behavior should either (a) explicitly modify CLAUDE.md to neutralize the prohibition, or (b) test the hive at the CLI substrate layer (which doesn't read CLAUDE.md) rather than via the `--claude` execution path.

## Decision — fix scope

**Fix Regression A (in fork)**:

Edit `forks/ruflo/v3/@claude-flow/cli/src/init/claudemd-generator.ts` `agentOrchestration()` to unbundle `hive-mind_spawn`. Specifically: change

```text
- DO NOT call `swarm_init`, `hive-mind_spawn`, or `ruflo swarm init` reflexively
```

to either:

```text
- DO NOT call `swarm_init` or `ruflo swarm init` reflexively at the start of tasks (ADR-0098 anti-sprawl).
- Use `hive-mind_spawn` when convening a council with named experts + voting + Queen synthesis.
  Use the `Agent` tool for parallel work delegation without consensus ceremony.
```

Acceptance: `npx -y @sparkleideas/cli@latest init --full --force` on a fresh tmp dir; grep CLAUDE.md for `hive-mind_spawn`; expected to appear in POSITIVE guidance, not in a "DO NOT" prohibition.

**Mitigate Regression B (in patch repo via init scaffolding)**:

Ship the 7 hm memory rules — or an ONT-0021-equivalent council-protocol skill — as init-seeded scaffolding, so new projects inherit the orchestration discipline that was lost. This restores the pre-regression behavior at the assistant-prose level without depending on Claude Code's default runtime semantics.

Acceptance: post-init project has `.claude/skills/hive-mind-council/` (or equivalent location) with rule content equivalent to `feedback_hive_queen_must_wait_for_all_panellists.md` plus the methodology sketch from ONT-0021.

## Consequences

### Positive

- Fresh-init projects no longer self-suppress hive-mind use via CLAUDE.md prose.
- The `hive-mind spawn --claude` path produces Queen output that respects the council protocol when ONT-0021-equivalent scaffolding is in place.
- ADR-0098 anti-sprawl intent is preserved (swarm_init prohibition stands; only hive-mind_spawn unbundled).
- The two-regression decomposition prevents future investigations from chasing a single root-cause that doesn't exist.

### Negative

- The anti-sprawl warning was load-bearing for swarm_init reflexive use. Unbundling hive-mind_spawn means we lose protection against reflexive HIVE use too. Trade-off: we accept reflexive hive use because the hive IS the council protocol, and council use is appropriate for non-trivial decisions.
- Regression B remains unfixed in this ADR. Mitigation via init-seeded memory rules works around the symptom; root-cause fix requires Claude Code or upstream Claude model behavioral change.
- Any acceptance test that runs hive-mind through `--claude` path is sensitive to whatever CLAUDE.md the test project has. This is now documented; tests must account for it explicitly.

### Neutral

- Regression A's fix is single-line. Fork commit + tests + push to sparkling. Rollback is one revert.
- Regression B's mitigation is content/template work, not code work. Could spawn a follow-up ADR for "ship council-protocol scaffolding".

## §Done

- [ ] **R1 — Regression A fix in fork**: Edit `claudemd-generator.ts` `agentOrchestration()` to unbundle `hive-mind_spawn` from the swarm-sprawl prohibition. Single-line change. Test with fresh `init --full` + grep CLAUDE.md.
- [ ] **R2 — acceptance check**: add `check_adr0115_claudemd_hive_unbundled` to `lib/acceptance-adr0113-plugin-checks.sh` (or new `lib/acceptance-adr0115-checks.sh`). Greps installed `@sparkleideas/cli/dist` for the bundled prohibition; expects 0 matches.
- [ ] **R3 — fork commit + push to sparkling**: per `feedback-fork-commits` + `feedback-trunk-only-fork-development`.
- [ ] **R4 — patch repo commit**: ADR-0115 + acceptance check + test wiring.
- [ ] **R5 — Regression B mitigation (separate scope)**: ship init-seeded scaffolding for council protocol — either as a new skill template, or as memory rule templates that init writes into the user's `~/.claude/projects/<project>/memory/`. Defer to a follow-up ADR if the user agrees.

## Cross-references

- ADR-0098 (swarm-init sprawl elimination — Regression A's introducing commit, intent: anti-sprawl for swarm_init)
- ADR-0114 §Lens 10 (3-layer hive architecture; this ADR closes §Done U5)
- `feedback_hive_queen_must_wait_for_all_panellists.md` (2026-04-26, primary scar tissue for Regression B)
- `feedback_swarm_source_of_truth.md` (2026-04-23, first scar-tissue rule, possibly tied to Regression A's CLAUDE.md propagation)

## Revision history

- **2026-05-02 (initial draft)** — captured 5-panellist investigation hive findings (P1+P3+P4+P2+DA), DA dissent reconciled into the two-regression model, empirical test of CLAUDE.md inheritance via `childSpawn` cwd-default behavior.
