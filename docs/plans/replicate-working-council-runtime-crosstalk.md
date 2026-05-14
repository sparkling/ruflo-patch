# Plan: Replicate the Working Council Hive (ONT-0021 / Session 39 shape, runtime cross-talk)

**Status:** Draft
**Date:** 2026-05-04
**Source of truth:**
- Methodology: `~/source/hm/main8/docs/ontology/odr/ONT-0021-expert-hive-review-methodology.md`
- Reference transcript: `~/source/hm/main8/docs/ontology/odr/council/session-39-ont-0034-implementation.md`
- Pre-regression source snapshot: `~/source/workingCouncil/ruflo/` (HEAD `0590bf29c`, 2026-03-20)
- Empirical pattern: memory `reference-hive-runtime-crosstalk-pattern.md` (validated 2026-05-04, iter2/3)
- Quality criteria: memory `feedback-hive-discussion-mechanics.md`

## Goal

Reproduce a working Expert Hive Council that produces an ONT-0021-shaped transcript with **genuine inter-expert dialog generated at the agent layer**, not composed in the main thread.

The validation criteria (from `feedback-hive-discussion-mechanics.md`):

1. Direct attribution by name in every reaction.
2. Specific claim engagement using each peer's actual content.
3. Dialectical advancement — each turn moves the rule forward.
4. DA either holds ground OR explicitly withdraws after named-expert responses.
5. Refinements adopted are content the conversation produced, not pre-written by the queen.

This is what Session 39 demonstrated and what `reference-hive-runtime-crosstalk-pattern.md` validated empirically with 3 agents on 2026-05-04.

## What we are NOT doing

- Not running `npx ruflo hive-mind spawn --claude` (works in fresh terminals only; from inside an existing Claude Code session it requires `--non-interactive` and has known permission-inheritance gaps — see memory `reference-hive-pre-regression-pattern.md` iter8).
- Not using `mcp__ruflo__hive-mind_memory` from sub-agent contexts (hangs — see iter1 failure note in cross-talk pattern memory).
- Not using `hive-mind_broadcast` to wake workers across rounds (no runtime bridge between Hive Mind broadcast and Agent Teams wake-up — see `feedback-hive-orchestration-pattern.md`).
- Not single-thread persona-play (the user has explicitly rejected queen-fabrication).

## Architecture

```
+----------------------------------------------------+
|  QUEEN  (this Claude Code main thread)             |
|  - reads ONT-0021                                  |
|  - chooses question & DA                           |
|  - mkdir /tmp/hive-<id>/                           |
|  - spawns 3 Agent({ run_in_background:true }) in   |
|    a SINGLE message (parallel)                     |
|  - waits for completion notifications              |
|  - reads pos-*.md and reaction-*.md                |
|  - composes ONT-0021 transcript using ONLY the     |
|    real position+reaction content                  |
|  - writes docs/ontology/odr/council/session-N.md   |
+----------------------------------------------------+
        |                  |                  |
        v                  v                  v
+--------------+   +---------------+   +---------------+
| Agent: Dean  |   | Agent: Holger |   | Agent: Elisa  |
| Allemang     |   | Knublauch     |   | Kendall (DA)  |
| (researcher) |   | (researcher)  |   | (researcher)  |
| run_in_bg    |   | run_in_bg     |   | run_in_bg     |
+--------------+   +---------------+   +---------------+
        \                |                /
         \               |               /
          v              v              v
        +----------------------------------+
        | /tmp/hive-<id>/                  |
        |   pos-allemang.md                |
        |   pos-knublauch.md               |
        |   pos-kendall.md                 |
        |   reaction-allemang.md           |
        |   reaction-knublauch.md          |
        |   reaction-kendall.md            |
        +----------------------------------+
```

Sub-agents are independent (Agent tool, `run_in_background: true`). Cross-talk happens through the shared `/tmp/hive-<id>/` directory: each writes its position, sleeps to let peers post, then reads peer files and writes a reaction that names them and engages specific claims.

## The 3 named experts (from Session 39 panel)

Picked because Session 39 is the high-water-mark transcript referenced in our memory and uses exactly the dialog mechanics we want to replicate. Per ONT-0021 §Standing Panel and §Extended Panel:

| Role | Expert | Frame | subagent_type |
|------|--------|-------|---------------|
| Position 1 | **Dean Allemang** (Working Ontologist) | Pragmatic RDF modeling, enterprise KG practice | `researcher` |
| Position 2 | **Holger Knublauch** (TopQuadrant, extended) | SHACL technical authority, ShapeClass semantics | `researcher` |
| Devil's Advocate | **Elisa Kendall** (OMG / EDM Council, FIBO) | Enterprise ontology patterns, structural-vs-advisory tiering | `researcher` |

(All 3 use `researcher` to keep prompts uniform; persona is carried in the prompt body, not the subagent type. ONT-0021 §Session Protocol mandates a DA — Kendall takes that role here, mirroring how she challenged in Session 39 Q1.)

## ONT-0021 transcript shape per question (per Session 39)

Each question section MUST contain these 8 elements, in this order:

1. **Question header** with proposed framework / decision.
2. **Expert Positions** — one paragraph per named expert, citing their published methodology.
3. **Inter-Expert Discussion** — turns where each expert names a peer and engages a specific claim ("Allemang: Knublauch raises an important point... Is that acceptable?" / "Knublauch: Yes...").
4. **Devil's Advocate Challenge** — DA poses a specific objection.
5. **Named-expert responses** to the DA challenge.
6. **DA verdict** — either explicit withdrawal ("I withdraw the challenge") or a recorded principled dissent.
7. **Vote tally** in the form `N-M[-K]` (agree-disagree-abstain).
8. **Refinements adopted** as a numbered list — content that came out of the discussion, not the queen's invention.

## The recipe (single-round parallel spawn, file-based cross-talk)

This mirrors `reference-hive-runtime-crosstalk-pattern.md` with the named-expert persona prompts and ONT-0021 protocol added. Seven steps from the queen's perspective.

### Step 1 — Initialize the hive (mirroring the working HM code)

Verified by reading **only** the pre-regression snapshot at `~/source/workingCouncil/ruflo/`. Two layers — the CLI command and the MCP tool it ultimately calls — and they disagree on what they accept. Both facts matter.

**Layer 1 — CLI surface** (`v3/@claude-flow/cli/src/commands/hive-mind.ts:30-44, 369-498`):

```ts
const TOPOLOGIES = [
  { value: 'hierarchical' },
  { value: 'mesh' },
  { value: 'hierarchical-mesh' },   // default
  { value: 'adaptive' },
];
const CONSENSUS_STRATEGIES = [
  { value: 'byzantine' },           // default
  { value: 'raft' },
  { value: 'gossip' },
  { value: 'crdt' },
  { value: 'quorum' },
];
```

CLI flags on `hive-mind init` (lines 372-408):

| Flag | Default | Source |
|---|---|---|
| `-t / --topology` | `hierarchical-mesh` | `TOPOLOGIES.map(t => t.value)` |
| `-c / --consensus` | `byzantine` | `CONSENSUS_STRATEGIES.map(s => s.value)` |
| `-m / --max-agents` | `15` | numeric, no validation |
| `-p / --persist` | `true` | boolean |
| `--memory-backend` | `hybrid` | string, no enum validation |

The CLI assembles those into one config object and calls (line 449-456):

```ts
callMCPTool<{...}>('hive-mind_init', {
  topology: 'hierarchical-mesh',
  consensus: 'byzantine',
  maxAgents: 15,
  persist: true,
  memoryBackend: 'hybrid',
})
```

**Layer 2 — MCP tool handler** (`v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts:286-329`):

```ts
{
  name: 'hive-mind_init',
  description: 'Initialize the hive-mind collective',
  category: 'hive-mind',
  inputSchema: {
    type: 'object',
    properties: {
      topology: { type: 'string', enum: ['mesh', 'hierarchical', 'ring', 'star'] },
      queenId: { type: 'string' },
    },
  },
  handler: async (input) => {
    const state = loadHiveState();                         // .claude-flow/hive-mind/state.json
    const hiveId = `hive-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const queenId = (input.queenId as string) || `queen-${Date.now()}`;

    state.initialized = true;
    state.topology    = (input.topology as HiveState['topology']) || 'mesh';
    state.createdAt   = new Date().toISOString();
    state.queen       = { agentId: queenId, electedAt: ..., term: 1 };
    saveHiveState(state);

    return {
      success: true, hiveId, topology: state.topology,
      consensus: input.consensus || 'byzantine',
      queenId, status: 'initialized',
      config: { topology, consensus, maxAgents: input.maxAgents || 15,
                persist: input.persist !== false,
                memoryBackend: input.memoryBackend || 'hybrid' },
      createdAt: state.createdAt,
    };
  },
}
```

What the snapshot actually does (and what the CLI README *does not* say):

- **State persists to `.claude-flow/hive-mind/state.json`** (`STORAGE_DIR='.claude-flow'`, `HIVE_DIR='hive-mind'`, `HIVE_FILE='state.json'` at lines 12-14). NOT `.hive-mind/`. The `.hive-mind/sessions/` path appears elsewhere — that's `spawnClaudeCodeInstance` writing the queen prompt file (line 222), a different concern.
- **Schema/handler mismatch.** The MCP `inputSchema` only declares `topology` and `queenId`. But the handler reads `input.consensus`, `input.maxAgents`, `input.persist`, `input.memoryBackend` and echoes them back in the `config` field. Those four are accepted at runtime but **none of them are persisted to `state.json`** — only `initialized`, `topology`, `createdAt`, `queen`, plus the static defaults `workers: []`, `consensus: {pending:[], history:[]}`, `sharedMemory: {}`. The `hiveId` is not stored either; it's regenerated on every `init` call.
- **Topology enum mismatch.** CLI accepts `hierarchical-mesh` and `adaptive`; MCP schema only enumerates `mesh / hierarchical / ring / star`. The handler casts via `as HiveState['topology']` (line 302) so `hierarchical-mesh` flows through, gets stored verbatim in `state.topology`, and is technically out-of-band of the typed enum. Not validated.
- **Defaults applied at the handler boundary.** If the CLI didn't pass a value, the handler fills in: topology `'mesh'`, consensus `'byzantine'`, maxAgents `15`, persist `true`, memoryBackend `'hybrid'`.
- **Returned `hiveId` is `hive-<Date.now()>-<6char>`** — fresh every call.

For our plan we have two equivalent paths — pick one:

**Path A — Bash CLI (closest mirror of the working code):**

```bash
npx @sparkleideas/cli@latest hive-mind init \
  -t hierarchical-mesh \
  -c byzantine \
  -m 3 \
  --memory-backend hybrid
```

(`-m 3` because we only need 3 panellists; the working code defaulted to 15 because it covered the 9-expert standing panel + extended.) Capture the printed `hiveId` for later memory keys.

**Path B — MCP tool from the queen's main thread:**

```text
ToolSearch("select:mcp__ruflo__hive-mind_init")
mcp__ruflo__hive-mind_init({
  topology: "hierarchical-mesh",
  consensus: "byzantine",
  maxAgents: 3,
  persist: true,
  memoryBackend: "hybrid"
})
```

Same effect, no subprocess. Use this when running from inside an existing Claude Code session — matches the rest of the plan's "queen runs in this main thread" architecture. **Only the queen** calls MCP init; sub-agents never load `mcp__ruflo__*` (per `reference-hive-runtime-crosstalk-pattern.md` iter1 hang).

Verify init succeeded before proceeding:
```bash
npx @sparkleideas/cli@latest hive-mind status
```
Expect `status: initialized` (or `ready`) and a `hiveId`.

> **Why init at all when cross-talk is file-based?** Two reasons. (1) It's the documented working mechanism from the HM code — replicating that flow is the goal of this plan. (2) Once initialized, the canonical cross-talk path (`hive-mind memory -a set/get` typed buckets) becomes available as an upgrade from the file-based fallback. We default to file-based in step 4 because it's the validated minimal path; the typed-bucket option is documented at the end of step 4.

### Step 2 — Pick the question and prepare shared state

Queen (main thread) decides:
- The single question Q to be reviewed.
- Hive ID: use the `hiveId` returned from step 1, or a short alias (`hive-<short-id>`) for the `/tmp` shared dir.
- The 3 personas: Allemang, Knublauch, Kendall (DA).

```bash
mkdir -p /tmp/hive-<id>/ && rm -f /tmp/hive-<id>/*.md
```

### Step 3 — Spawn 3 agents in ONE message (parallel)

Three `Agent` calls in the same tool-use block, each with `run_in_background: true`. Per memory, this is the synchronization barrier — they must spawn near-simultaneously so the `sleep 60` in step 3 of each worker contract acts as a barrier.

```text
Agent({ description: "Allemang — Round 1+Reaction", subagent_type: "researcher",
        run_in_background: true, prompt: <ALLEMANG_PROMPT> })
Agent({ description: "Knublauch — Round 1+Reaction", subagent_type: "researcher",
        run_in_background: true, prompt: <KNUBLAUCH_PROMPT> })
Agent({ description: "Kendall (DA) — Round 1+Reaction", subagent_type: "researcher",
        run_in_background: true, prompt: <KENDALL_PROMPT> })
```

### Step 4 — Worker contract (baked into each agent's prompt)

Per `reference-hive-runtime-crosstalk-pattern.md` worker contract, with persona substitutions. **Identical structure for all 3** — only persona, frame, and DA flag change.

Template (substitute `<...>` per agent):

```
You are <Expert Name> on a 3-person Expert Hive Council convened
under ONT-0021 (Expert Hive Review Methodology). Your published frame
is: <published frame, e.g. "Working Ontologist — pragmatic RDF
modeling and enterprise KG practice">.

QUESTION (Q): <question text + proposed framework verbatim>

PEERS (other experts on this council):
  - <Peer 1 name> (<peer 1 frame>)
  - <Peer 2 name> (<peer 2 frame>)

ROLE FLAG: <"PANELLIST" or "DEVIL'S ADVOCATE">

WORKER CONTRACT — execute strictly in order. Use only Write, Read, Bash.
Do NOT load any mcp__ruflo__* tools (they hang in sub-agent context).

Step 1 — POSITION (~120 words)
  Compose your initial position citing your published methodology.
  Take a clear stance on the proposed framework.
  If ROLE FLAG = DEVIL'S ADVOCATE: your position must include at least
    one specific procedural / formal / scope objection to the framework.

Step 2 — POST POSITION
  Write tool → /tmp/hive-<id>/pos-<your-name>.md
  Content = your position verbatim, no markdown wrapper.

Step 3 — BARRIER
  Bash: `sleep 60`
  This gives peers time to write their pos-*.md files.

Step 4 — READ PEERS
  Bash: `ls /tmp/hive-<id>/`
  Read tool → /tmp/hive-<id>/pos-<peer1>.md
  Read tool → /tmp/hive-<id>/pos-<peer2>.md
  If a peer file is missing, Bash `sleep 30` once and retry.

Step 5 — REACTION (~150 words)
  Compose a reaction that MUST:
    - reference EACH peer BY NAME at least once,
    - quote or paraphrase a SPECIFIC claim from each peer's position
      (no fabrication — it must come from their pos-<peer>.md),
    - take one of these dialectical moves: build on, refine, partially
      agree, disagree, or (DA only) hold ground / withdraw.
  If ROLE FLAG = DEVIL'S ADVOCATE: your reaction must end with either
    "I withdraw the challenge" (with stated reason traceable to a peer's
    response) OR "I hold the challenge" (with principled dissent).

Step 6 — POST REACTION
  Write tool → /tmp/hive-<id>/reaction-<your-name>.md

Step 7 — RETURN
  Return the reaction verbatim plus a 1-line summary listing the specific
  peer claims you engaged ("engaged: Knublauch on property-level severity;
  Kendall on maxCount-only").

CRITICAL: every claim attributed to a peer in your reaction must be
traceable to a string that exists in their pos-<peer>.md. No invented
peer content.
```

### Step 5 — Wait for completion notifications

Three `<task-notification>` blocks will arrive automatically as agents finish. The queen does **nothing** during this phase — no polling, no `sleep`, no status checks. (Per `feedback-no-tail-tests.md` and the standing rule against polling background work.)

### Step 6 — Inspect the results

Once all 3 notifications have arrived:

```bash
ls -la /tmp/hive-<id>/
for f in /tmp/hive-<id>/*.md; do echo "--- $f ---"; cat "$f"; done
```

Verify against the validation criteria:

- [ ] Each `reaction-*.md` references both peers by name.
- [ ] Each reaction quotes or paraphrases a specific claim from each peer's `pos-*.md`.
- [ ] DA reaction ends with explicit withdraw-or-hold verdict.
- [ ] At least one reaction performs a dialectical move (synthesis, refinement, reframing) — not just "I agree".

If any criterion fails, re-run step 3 with a sharper worker prompt — do not patch the transcript by hand.

### Step 7 — Compose the ONT-0021 transcript

Queen (main thread) writes `docs/ontology/odr/council/session-N-<topic>.md` using **only** the real content from `pos-*.md` and `reaction-*.md`. The 8 ONT-0021 sections map to source files as follows:

| ONT-0021 section | Source |
|---|---|
| Question header | Queen-supplied (the original Q) |
| Expert Positions | `pos-allemang.md`, `pos-knublauch.md`, `pos-kendall.md` (verbatim or near-verbatim) |
| Inter-Expert Discussion | Direct quotation/excerpt from `reaction-*.md` (the cross-talk happened *there*) |
| DA Challenge | The objection portion of `pos-kendall.md` |
| Named-expert responses to DA | The portions of `reaction-allemang.md` / `reaction-knublauch.md` that engage Kendall's objection |
| DA verdict | The explicit withdraw/hold line at the end of `reaction-kendall.md` |
| Vote tally | Queen tallies based on stances visible in pos+reaction files |
| Refinements adopted | Numbered list of refinement-shaped claims surfaced in the reactions |

**Composition vs fabrication:** every transcript line that quotes an expert MUST trace to a string in `pos-<name>.md` or `reaction-<name>.md`. The queen structures; she does not invent content. This is the distinction memory `reference-hive-pre-regression-pattern.md` calls "composition (legitimate)" vs "fabrication (illegitimate)".

## Why this matches the working pre-regression flow

Cross-referencing the snapshot at `~/source/workingCouncil/ruflo/` (HEAD `0590bf29c`, 2026-03-20 — within the Session 22-39 era) shows:

- `v3/@claude-flow/cli/src/commands/hive-mind.ts` lines 174-300: `spawnClaudeCodeInstance` generates a substrate-only prompt and `child_process.spawn('claude', [...], { stdio: 'inherit' })`. The spawned `claude` becomes the queen — exactly the mechanism described in `reference-hive-pre-regression-pattern.md` step 2c.
- The queen's protocol came from project files (ONT-0021 + project CLAUDE.md), not from the queen prompt.
- The empirical session-log pattern was: `Agents: 1 (main session — council convening...)` for sessions 22-33 (queen running in main thread, panellists spawned via Agent tool).

**This plan replaces** the `--claude` subprocess shell-out with an inline queen (already-running Claude Code session) + 3 background `Agent` spawns. The queen-side composition over real worker positions is preserved.

**This plan adds** what was *not* in the pre-regression flow: cross-talk at the agent layer via shared files. Memory entry `reference-hive-runtime-crosstalk-pattern.md` validated this works (iter2/3) and meets the dialectical criteria better than queen-only synthesis.

## Test execution

To validate this plan end-to-end, run it once with a small concrete question. Suggested:

> "Should ruflo's queen prompt template embed council protocol scaffolding (named experts, DA, vote shape), or stay substrate-only and rely on project ONT-0021?"

This is a real open question (per memory `reference-hive-runtime-crosstalk-pattern.md`, an earlier iter2 used this exact question and it produced clean dialog). Re-using it here gives a side-by-side comparison: same question, same recipe, same 3 personas, transcript should look ONT-0021-shaped with all 8 sections populated from real worker output.

Acceptance:

- All 3 `pos-*.md` and 3 `reaction-*.md` exist under `/tmp/hive-<id>/`.
- Each reaction passes the validation checklist in Step 5.
- The composed transcript at `docs/ontology/odr/council/session-N-*.md` contains all 8 ONT-0021 sections.
- DA section shows explicit withdraw-or-hold, traceable to `reaction-kendall.md`.

## Open risks

- **60s sleep barrier.** Cheap but inflexible. If one agent is slow to spawn, peers may read empty dirs. Mitigated: workers retry once with `sleep 30`. If it fails twice, switch barrier to file-existence polling (`while [ ! -f ... ]; do sleep 5; done`) — note that's a step change in worker contract complexity.
- **DA not withdrawing.** Kendall may legitimately hold ground. That's a valid outcome (Q3 of Session 142 had multiple dissents); the transcript records the dissent. Don't force withdrawal — that's fabrication.
- **Reaction without specific peer claim.** If an agent's reaction is generic ("I agree with both peers..."), it fails the dialectic criterion. Re-run with a sharper instruction in Step 5; do not paper over.
- **More than 3 agents.** Pattern is validated up to N=7 per memory; for full 9-expert panel the 60s barrier likely needs tuning. Out of scope for this plan.
