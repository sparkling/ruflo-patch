---
status: accepted
date: 2026-05-04
tags: [hive-mind, council, template, init]
supersedes: []
depends-on: []
implements: []
---

# Ship a working council-session template by default — what's left to do, grounded in iter9 vs HM-repo working-version comparison

## Context and Problem Statement

This ADR is a concrete gap analysis comparing iter9's empirical output (literal `npx hive-mind spawn --claude --non-interactive` from inside an existing claude session) against the HM repo's pre-regression Sessions 22-39 production sessions. It identifies exactly what queen-prompt scaffolding ruflo must ship to produce HM-quality output without requiring projects to invent their own ONT-0021.

### Three independent reference points

#### 1. The HM repo (pre-regression production, 250+ working sessions)

`/Users/henrik/source/hm/semantic-modelling/` ran 250+ council sessions between 2026-03-11 (Session 22, ONT-0021 added) and ~2026-04-23 (first regression-remediation memory rule added) using `ruflo hive-mind spawn --claude` against ruflo CLI. Sample artifact: `docs/ontology/odr/council/session-39-ont-0034-implementation.md` — 5 questions, 9 standing experts + Knublauch (extended panel), Kendall as DA, full ONT-0021 8-section format with explicit inter-expert discussion turns and DA withdrawal mechanic.

The mechanism (per ADR-0114 Lens 10 + memory `reference-hive-pre-regression-pattern.md`):
1. ruflo CLI generated substrate-only queen prompt (no protocol scaffolding)
2. Spawned fresh `claude` subprocess via `child_process.spawn('claude', ...)` with `stdio:'inherit'`
3. Spawned-claude inherited the project's CLAUDE.md (which anchored "convene council per ONT-0021")
4. Spawned-claude read `docs/ontology/odr/ONT-0021-expert-hive-review-methodology.md` (the methodology with named-panel + Session Protocol)
5. Spawned-claude used Agent tool to spawn N panellists with persona prompts citing each named expert's published methodology
6. Panellists were one-shot independent (do NOT see each other's outputs)
7. Spawned-claude (queen) waited for ALL panellists to report (per memory `feedback_hive_queen_must_wait_for_all_panellists.md`)
8. Spawned-claude composed Session-N transcript with all 8 ONT-0021 sections — per-expert positions, **inter-expert discussion**, DA challenge + responses + withdrawal, vote tally with refinements, decision

The protocol came **entirely from project files** (ONT-0021 + project CLAUDE.md). The ruflo queen prompt was substrate-only the entire working window.

#### 2. The pre-regression ruflo source (cloned for inspection)

Cloned 2026-05-04 to `/Users/henrik/source/workingCouncil/`:

| Fork | Commit at clone | Date | Why this commit |
|---|---|---|---|
| `ruflo` | `0590bf29c` "fix: resolve issues #1390, #1391, #1392 — v3.5.42" | 2026-03-20 | Last commit before TOOL PREFERENCE regression `7d9c61ad0` (2026-03-25). Session 39 era. |
| `agentic-flow` | `3cd9b47` | 2026-03-22 | Pre-regression date-matched |
| `ruv-FANN` | `b3908f1` | 2026-03-15 | Pre-regression date-matched |
| `ruvector` | `76d7dbea` | 2026-03-24 | Pre-regression date-matched |

Inspection of `workingCouncil/ruflo/v3/@claude-flow/cli/src/commands/hive-mind.ts` confirms:
- Queen prompt at lines 79–168 (89 lines)
- Substrate-only: HIVE MIND CONFIGURATION, WORKER DISTRIBUTION, AVAILABLE MCP TOOLS (5 categories), HIVE MIND EXECUTION PROTOCOL (4 phases), YOUR OBJECTIVE, COORDINATION TIPS
- **Zero references** to: named experts, panel, Devil's Advocate, discussion, withdrawal, vote format
- Closer: "🚀 BEGIN HIVE MIND COORDINATION NOW! Start by checking the current hive status and then proceed with the objective."

Today's queen prompt (post-`fe18fddb7`) is structurally similar (~240 lines) — adds worker contract, failure protocols, queen-type disposition (ADR-0125/0131/0132), but **still zero protocol scaffolding**. The protocol-delivery gap has existed the entire time; HM only worked because HM supplied its own ONT-0021.

#### 3. iter9 — the literal canonical CLI command from inside an existing claude session

Empirical run 2026-05-04, one-shot test of `npx hive-mind spawn --claude --non-interactive` from inside an active Claude Code session. Stream-json output captured at `~/.claude/projects/-Users-henrik-source-ruflo-patch/.../tool-results/b4c7hpci3.txt` (157KB).

**Command:**
```bash
timeout 120 npx @sparkleideas/cli@latest hive-mind spawn -n 3 \
  --queen-type strategic --consensus byzantine \
  --claude --non-interactive \
  -o "Should hive workers store their final verdicts as memory entries that future hives can retrieve, or should each hive be epistemically isolated?"
```

**Stages observed:**

| # | Stage | Outcome |
|---|---|---|
| 1 | CLI generates queen prompt + writes to `.hive-mind/sessions/hive-mind-prompt-hive-1777855527765.txt` | ✓ |
| 2 | Registers 3 worker slots in hive state (`hive-1777855527765`) | ✓ |
| 3 | `child_process.spawn('claude', ['-p', '--output-format', 'stream-json', '--verbose', ...])` — `--non-interactive` mode bypasses TTY requirement that breaks plain `--claude` from inside an existing claude session | ✓ — major architectural unlock (this is what made it work today; plain `--claude` would have hung) |
| 4 | Spawned claude (queen) starts up, loads auto-memory, restores session, loads 148 intelligence patterns | ✓ |
| 5 | Queen reads ruflo-patch project's CLAUDE.md (which has NO ONT-0021 anchor — this is not the HM repo) | ✓ but missing the council protocol that HM CLAUDE.md anchors |
| 6 | Queen TodoWrite plan: "Plan rationale → Spawn 3 workers → Read back + byzantine consensus → Report final verdict" | ✓ |
| 7 | Queen invents charged Worker A/B/C labels (PERSIST / ISOLATE / HYBRID) and spawns via Task tool | ⚠ NOT the HM pattern (HM used named experts, not charged labels) |
| 8 | Workers produce substantive verdicts with arguments + concessions + verdict (~24k tokens each) | ✓ |
| 9 | Queen attempts `mcp__ruflo__memory_search` and `mcp__ruflo__hive-mind_memory` writes — DENIED at permission gate despite `--dangerously-skip-permissions` default | ✗ permissions did not inherit to spawned subprocess |
| 10 | Queen falls back gracefully: records plan + verdict inline in transcript as canonical audit trail | ✓ — graceful degradation pattern works |
| 11 | Queen composes synthesis: "Convergence is strong, not forced. Read past each worker's charge into their concessions." Issues final verdict + 5 specific recommendations + worker absence trail | ✓ rich synthesis but **NOT the ONT-0021 8-section format** |
| 12 | Subprocess exits 0 within 120s timeout | ✓ |

**Output quality vs Session 39:**

| ONT-0021 section | iter9 produced? | Session 39 produced? |
|---|---|---|
| Per-expert Position section | ✓ (Worker A/B/C with charges) | ✓ (named experts speaking from methodology) |
| **Inter-Expert Discussion** (Allemang→Knublauch→Kendall sequenced turns) | ✗ — went straight to "Convergence" summary | ✓ — explicit per-expert reaction turns |
| **DA Challenge + responses + withdrawal** | ✗ — no DA role assigned, workers had built-in concessions to other framings | ✓ — explicit DA assignment, named experts respond to DA, DA either holds or withdraws |
| Vote: N-M tally with refinements | ⚠ implied (3 verdicts → 5 recommendations) but no formal N-M tally | ✓ — explicit "Vote: 10-0 with refinements" |
| Refinements adopted from conversation | ✓ but written by queen post-hoc | ✓ traced to specific discussion turns |
| Rationale citing publications | ⚠ workers cited "ReasoningBank/HNSW/EWC++" / "feedback-no-fallbacks" project memory but NOT named-author publications | ✓ — Allemang cites *Working Ontologist*, Hendler cites W3C, etc. |
| Decision | ✓ | ✓ |
| Worker absence/failure trail | ✓ — recorded gracefully (3 workers returned, no absence) | ✓ — recorded when applicable |

iter9 produced 3/8 ONT-0021 sections clean, 3/8 partial, 2/8 missing. **The mechanism worked but the protocol-content scaffolding is missing**: queen invented charged-labels instead of named experts, skipped inter-expert discussion section, did not assign explicit DA role.

### The gap

ruflo's queen prompt has never carried protocol-content scaffolding. HM's working sessions worked because HM's project CLAUDE.md anchored "convene council per ONT-0021" and ONT-0021 supplied the named panel + protocol. Fresh-init projects (no ONT-0021) get **substrate-only behaviour**: queen invents some council-shaped output (per iter9), but invents Worker A/B/C labels with charges instead of named experts, and skips the inter-expert discussion + DA-withdrawal sections.

This is exactly the gap ADR-0114 §Done U5 identified ("ship a council protocol skill / embed protocol in queen prompt template / make hive-mind spawn --claude shell out with a Queen prompt that follows the protocol"). U5 is still open; iter9 confirms the empirical shape of what's missing.

### Full 12-stage flow — reverse-engineered from `workingCouncil/` checkout

These are the stages a working pre-regression council session went through. Each stage is grounded in the cloned source + HM's project files + Session 39's output structure + memory rules.

#### Stage 1 — User invocation

```bash
npx ruflo hive-mind spawn "<question>" \
  --queen-type strategic \
  --consensus byzantine \
  --claude
```

#### Stage 2 — ruflo CLI generates queen prompt (substrate-only, verbatim from `workingCouncil/ruflo/v3/@claude-flow/cli/src/commands/hive-mind.ts:79-168`)

```
🧠 HIVE MIND COLLECTIVE INTELLIGENCE SYSTEM
═══════════════════════════════════════════════

You are the Queen coordinator of a Hive Mind swarm with collective
intelligence capabilities.

HIVE MIND CONFIGURATION:
📌 Swarm ID: <id>
📌 Swarm Name: <name>
🎯 Objective: <question>
👑 Queen Type: strategic
🐝 Worker Count: <N>
🔗 Topology: hierarchical-mesh
🤝 Consensus Algorithm: byzantine
⏰ Initialized: <timestamp>

WORKER DISTRIBUTION:
• worker: <N> agents

🔧 AVAILABLE MCP TOOLS FOR HIVE MIND COORDINATION:

1️⃣ COLLECTIVE INTELLIGENCE
   mcp__ruflo__hive-mind_consensus    - Democratic decision making
   mcp__ruflo__hive-mind_memory       - Share knowledge across the hive
   mcp__ruflo__hive-mind_broadcast    - Broadcast to all workers
   mcp__ruflo__neural_patterns        - Neural pattern recognition

2️⃣ QUEEN COORDINATION
   mcp__ruflo__hive-mind_status       - Monitor swarm health
   mcp__ruflo__task_create            - Create and delegate tasks
   mcp__ruflo__coordination_orchestrate - Orchestrate task distribution
   mcp__ruflo__agent_spawn            - Spawn additional workers

3️⃣ WORKER MANAGEMENT
   [agent_list/status/health, hive-mind_join/leave]

4️⃣ TASK ORCHESTRATION
   [task_assign/status/complete, workflow_create]

5️⃣ MEMORY & LEARNING
   [memory_store/retrieve/search, neural_train, hooks_intelligence_pattern-store]

📋 HIVE MIND EXECUTION PROTOCOL:

1. INITIALIZATION PHASE
   - Verify all workers are online and responsive
   - Establish communication channels
   - Load previous session state if available
   - Initialize shared memory space

2. TASK DISTRIBUTION PHASE
   - Analyze the objective and decompose into subtasks
   - Assign tasks based on worker specializations
   - Set up task dependencies and ordering
   - Monitor parallel execution

3. COORDINATION PHASE
   - Use consensus for critical decisions
   - Aggregate results from workers
   - Resolve conflicts using byzantine consensus
   - Share learnings across the hive

4. COMPLETION PHASE
   - Verify all subtasks are complete
   - Consolidate results
   - Store learnings in collective memory
   - Report final status

🎯 YOUR OBJECTIVE:
<question>

💡 COORDINATION TIPS:
• Use mcp__ruflo__hive-mind_broadcast for swarm-wide announcements
• Check worker status regularly with mcp__ruflo__hive-mind_status
• Store important decisions in shared memory for persistence
• Use consensus for any decisions affecting multiple workers
• Use mcp__ruflo__task_assign to assign tasks to workers, then
  mcp__ruflo__task_complete when done

🚀 BEGIN HIVE MIND COORDINATION NOW!
Start by checking the current hive status and then proceed with the objective.
```

**Verified zero references in the queen prompt** to: named experts, panel, Devil's Advocate, discussion, withdrawal, vote format, council, ONT-0021, transcript. **All protocol content comes from project files at later stages.**

#### Stage 3 — ruflo CLI forks `claude` subprocess

`child_process.spawn('claude', [...flags, queenPrompt], { stdio: 'inherit' })` at line 950. Subprocess takes over user terminal via stdio:'inherit'. Pre-regression: no `--non-interactive` flag (added later); flag added to support nested invocation from inside existing claude session, validated iter9.

#### Stage 4 — Spawned `claude` starts up

Inherits TTY. queenPrompt is initial user message. Loads:
- HM's `CLAUDE.md` (anchors: *"Write council transcript to `docs/ontology/odr/council/` if council convened"* — `/Users/henrik/source/hm/semantic-modelling/CLAUDE.md` line 191)
- HM's `.claude/memory/` rules (the procedural how-tos: `feedback_hive_queen_must_wait_for_all_panellists.md`, `feedback_swarm_vs_hive_distinction.md`, `feedback_wait_for_hive.md`, `feedback_hive_pushback_on_frame.md`)
- Auto-memory files
- 148+ intelligence patterns (per iter9 startup observation)

#### Stage 5 — Queen reads ONT-0021 (THE GAP IN FRESH-INIT)

Queen prompt's "🎯 YOUR OBJECTIVE" + queen-type=strategic + CLAUDE.md's "convene council if convened" → queen recognizes this as a council session and reads:

`/Users/henrik/source/hm/semantic-modelling/docs/ontology/odr/ONT-0021-expert-hive-review-methodology.md`

ONT-0021 supplies (verbatim from §Rules):

**Standing Panel (9 Experts):**
| Expert | Affiliation | Perspective |
|--------|-------------|-------------|
| Dean Allemang | Working Ontologist | Pragmatic RDF modeling, enterprise KG practice |
| Jim Hendler | W3C / RPI | OWL formal semantics, web architecture |
| Elisa Kendall | OMG / EDM Council | Enterprise ontology patterns, FIBO methodology |
| Kurt Cagle | The Ontologist | SHACL practitioner, taxonomy design, AI integration |
| Fabien Gandon | W3C / Inria | RDF/RDFS/OWL standards, linked data principles |
| Tom Baker | Dublin Core | Namespace design, metadata standards, vocabulary governance |
| Ian Davis | BBC / UK Gov | Linked data deployment at scale, government data patterns |
| Giancarlo Guizzardi | NEMO / UniLu | Foundational ontology (UFO, OntoUML) |
| Nicola Guarino | ISTC-CNR | Formal ontology theory, identity criteria, DOLCE |

**Extended Panel** (domain-specific): Ranganathan/ISO 25964 (faceted), Evans/Vernon (DDD), Dehghani (mesh), Knublauch (SHACL).

**Session Protocol** (5 mandatory rules — verbatim ONT-0021 §Session Protocol):
1. Always use named experts from the standing panel — never generic role titles
2. Each expert must state rationale from their published methodology
3. Always include a Devil's Advocate
4. Experts must discuss with each other (agree, disagree, withdraw prior dissent)
5. Synthesis report must include per-expert positions, vote tallies, dissent records (with withdrawals), recommended approach, rationale citing publications, agreed amendments, and whether existing ODRs need revision

**This is what fresh-init projects don't have.** The protocol is entirely project-supplied.

#### Stage 6 — Queen selects panel for THIS question (THE GAP IN FRESH-INIT)

Queen reads question, picks composition from ONT-0021 panel:
- Standing 9-expert if general ontology question
- Standing + Knublauch if SHACL-specific
- Standing + Evans + Vernon if DDD/bounded-context question
- Standing + Dehghani if data-mesh
- Assigns DA role for THIS session (often Cagle / Hendler / Kendall — varies per question)
- Optionally names a session-Queen synthesis personality (often Kendall for ontology, Allemang for pragmatic)

In iter9 (no ONT-0021), queen invented "Worker A/B/C with steel-man charges (PERSIST/ISOLATE/HYBRID)" — generic role labels, not named experts. **Direct violation of ONT-0021 Session Protocol rule 1.**

#### Stage 7 — Queen spawns panellists via Task/Agent tool — parallel one-shot

All N panellists spawned in **one message** (per memory rule `feedback_hive_queen_must_wait_for_all_panellists.md` — roster locked at spawn time, no late-additions). The literal prompts were recovered from HM Claude Code session transcripts at `~/.claude/projects/-Users-henrik-source-hm-semantic-modelling/5eb0fe0d-49f4-476e-8c59-21d8b1f7d2a3.jsonl` (4 Task tool calls: Allemang, Cagle, Baker, and Hejlsberg-as-DA, council on `generated/` folder organization). The empirical template is **simpler and more pragmatic** than the ONT-0021-citation-heavy reconstruction in earlier drafts of this ADR. Empirical shape:

**Standard panellist prompt (verbatim shape):**

```
You are **<Named Expert>** (<one-line frame, e.g. "semantic data
architecture, enterprise knowledge graphs">). You're participating
in a council to decide <one-line topic, e.g. "how to organize pipeline
output files in the `generated/` folder">.

## Your task

1. Read these <ADRs|files> to understand <context>:
   - `<path>` (<one-line summary>)
   - `<path>` (<one-line summary>)
   - ...

2. Also read `<config-or-data-file>` to understand <X>.

3. <Background fact, e.g. "Source repos live at repos/{system}/{repo}.
   Systems: sds (6 repos), productplan (19 repos), bbq (4 repos)">.

4. <PERSPECTIVE-SPECIFIC FOCUS — different per expert>:
   - <bulleted question 1 angled to this expert's frame>
   - <bulleted question 2>
   - ...

Write your position in `<output-dir>/council-<expert>.md`. Be specific —
<concrete deliverable, e.g. "show the actual directory tree you'd propose">.
```

**Devil's Advocate variant (verbatim shape from Hejlsberg call):**

```
You are **<Named Expert>** (Devil's Advocate — <DA frame, e.g. "engineering
rigor, type systems, practical software design">). You're participating
in a council to decide <topic>.

## Your role: DEVIL'S ADVOCATE

Your job is to find flaws, over-engineering, and hidden complexity in any
proposed scheme. You will also propose your own, but your primary value
is identifying problems others miss.

[same numbered sections 1-3 as standard]

4. CHALLENGE these questions hard:
   - <pointed challenge with concrete numbers, e.g. "Is copy-then-enrich
      worth the git bloat? 29 repos × 13 categories × 2 copies = 754 files">
   - <"What happens when you add a 30th repo? A 14th category?">
   - <"What's the SIMPLEST scheme that actually works?">

Write your position in `<output-dir>/council-<expert>.md`. Be brutally
honest about complexity. Propose the simplest viable scheme.
```

**Empirical observations (vs the citation-heavy reconstruction in earlier drafts):**

- Frame is **one parenthetical phrase**, not a publication-citation table. Citation discipline is project-supplied (CLAUDE.md / ONT-0021), not embedded in each Task prompt.
- **No `Vote: yes|no|abstain` rule** in the prompt — vote tallies emerge during queen's transcript composition (stage 10), not from panellist output.
- Output goes to a **file** (`<output-dir>/council-<expert>.md`), NOT a return value. This lets the queen read all positions atomically before composing.
- Each expert gets a **different focus angle** in section 4 (Allemang=KG/structure, Cagle=tooling/practical, Baker=provenance/lineage, Hejlsberg-DA=challenge with numbers). Section 4 is the only part that varies meaningfully across panellist prompts in the same session.
- DA charge is **"find flaws, over-engineering, hidden complexity"**, not "steel-man the contrarian view". The DA prompt also includes pointed challenge questions with concrete numbers.
- "You will NOT see other panellists' outputs" is **implicit** via file separation, not stated in the prompt.

#### Stage 8 — Panellists run independently

Each panellist is a sub-agent invocation (Task/Agent tool, run_in_background:true). One-shot:
- Read question
- Compose verdict citing methodology
- Return single verdict
- **Do NOT see other panellists**

Panellist output shape (from Session 39 verbatim):

```
**Dean Allemang:** "The framework maps cleanly to data governance tiers.
Mandatory properties (`minCount >= 1`) are structural requirements —
Violation is correct... I'd add one refinement: `sh:pattern` constraints
should also be Violation. A malformed ISO code is not a warning — it's
bad data."
```

#### Stage 9 — Queen WAITS for all panellists

Per `feedback_hive_queen_must_wait_for_all_panellists.md` (verbatim rules):

> "the Queen must NOT spawn until every panellist on the roster has
> reported. No exceptions. No placeholders. No 'rely on prior outputs
> from v2'. No 'good enough with what we have'. Absence of a panellist's
> report is a HARD BLOCK on Queen spawn."

Procedure:
1. Roster at spawn time: explicit `[id1: name1, id2: name2, ...]` list
2. Update on every task-notification (strikethrough completed IDs)
3. Hard-block before composing: if ANY ID unstruck, ABORT
4. `TaskList` final pre-flight before synthesis
5. Treat impatience as a flag (do NOT start "with what we have")
6. Hung panellist: retry, document as user-approved gap, OR keep waiting — never silently drop

#### Stage 10 — Queen composes Session-N transcript (8 sections, THE GAP IN FRESH-INIT)

Format (from Session 39 + ONT-0021 §Session Protocol rule 5):

```markdown
# Expert Hive Council Session <N> — <ODR-ID>: <topic>

**Date:** <YYYY-MM-DD>
**ODR:** <ID> (<title>)
**Scope:** <one-line>
**Panel:** <N> standing + <extended members>
**Devil's Advocate:** <Name>

---

## 1. Opening
[1-paragraph context, stakes, why a council was convened]

## 2. Per-Question Discussion

### Q<N>: <subquestion>
**Proposed framework / decision:** [...]

#### Expert Positions
**Dean Allemang:** "<verdict ~100 words citing Working Ontologist>"
**Jim Hendler:** "<verdict ~100 words citing W3C semantics>"
**Elisa Kendall:** "<verdict ~100 words citing FIBO>"
... [all N positions]

#### Inter-Expert Discussion
**Allemang:** "Knublauch raises an important point... Is that acceptable?"
**Knublauch:** "Yes. When minCount >= 1 is present, the property is mandatory..."
**Kendall:** "That's the correct interpretation. If a property is mandatory..."
**Cagle:** "So the rule becomes: if ANY constraint in the property shape
   is Violation-tier, the whole property shape gets Violation."
**All:** Agreement.

#### Devil's Advocate Challenge (<DA Name>)
**<DA>:** "<challenge — concrete objection or missing case>"
**<expert1>:** "<response using actual position content>"
**<expert2>:** "<response or counter>"
...
**<DA>:** "Fair point. <reason>. I withdraw the challenge."
   [OR]
**<DA>:** "<holds with refined principled dissent>"

#### Vote: N-M (with refinements)
**Refinements adopted:**
1. <refinement that emerged from the discussion>
2. ...

### Q2...QN: same structure

## 3. Decision (overall)
[Synthesis tying questions together]

## 4. Track Record append
[New row added to ONT-0021 §Track Record table]
```

**8 mandatory sections** per ONT-0021 §Session Protocol rule 5:
1. Per-expert positions
2. Vote tallies
3. Dissent records (with withdrawals)
4. Recommended approach
5. Rationale citing publications
6. Agreed amendments
7. Inter-expert discussion (implicit per rule 4)
8. Devil's Advocate challenge + responses (implicit per rule 3)

**Critical**: every claim attributed to a panellist traces to that panellist's actual verdict text. Inter-expert discussion turns are written by queen using verbatim/near-verbatim phrases from each panellist's position — composition over real content, not fabrication.

#### Stage 11 — Queen writes transcript file (THE GAP IN FRESH-INIT)

Per HM CLAUDE.md line 191: `docs/ontology/odr/council/session-<N>-<topic>.md`. Committed to git.

Cross-references:
- ODR file gets a "Consulted: [council session N]" header line
- ODR file's Links section gets a relative path to the transcript
- ONT-0021 §Track Record table gets a new row

#### Stage 12 — Subprocess exits

User saw the transcript stream out via stdio:'inherit'. Subprocess exits 0. Queen state persisted in `.hive-mind/sessions/<id>/`. The hive remains in `hive-mind sessions list` for future audit/resume.

### Stage-by-stage iter9 vs working-pre-regression comparison

| Stage | HM working pre-regression | iter9 (ruflo-patch project) | Gap class |
|---|---|---|---|
| 1. User invocation | `--claude` from fresh terminal | `--claude --non-interactive` from inside existing claude | none — `--non-interactive` is the architectural unlock |
| 2. Queen prompt | Substrate-only (89 lines) at `0590bf29c` | Substrate-only (~240 lines, with worker contract / failure protocols / queen disposition added since pre-regression — none of which are protocol-content scaffolding) | **content gap** — protocol scaffolding never added |
| 3. Subprocess fork | `stdio:'inherit'` TTY mode | `-p --output-format stream-json --verbose` print mode | none — both work, mode chosen by `--non-interactive` |
| 4. Subprocess startup | Loads project CLAUDE.md + memory + auto-memory | Loads ruflo-patch CLAUDE.md + memory + auto-memory | none |
| **5. Read ONT-0021** | ✓ HM has it at `docs/ontology/odr/ONT-0021-...` | ✗ ruflo-patch has no equivalent methodology file | **content gap** — fix: embed default panel + protocol in queen prompt |
| **6. Select named panel** | ✓ Allemang/Hendler/Kendall/etc. | ✗ Invented Worker A/B/C with steel-man charges | **content gap** — fix: queen prompt names default panel + DA assignment |
| 7. Spawn panellists (Task tool, parallel) | ✓ named experts with persona prompts | ✓ but generic role labels with charges (PERSIST/ISOLATE/HYBRID) | mechanism ✓; content gap inherits from stage 6 |
| 8. Panellists one-shot independent | ✓ | ✓ | none — mechanism identical |
| 9. Wait for all panellists | ✓ enforced by `feedback_hive_queen_must_wait_for_all_panellists.md` rule | ✓ implicitly (3 returned, no late-arrival problem) | none in this run; would be a gap if not for memory rule |
| **10. Compose 8-section transcript** | ✓ all 8 sections present per Session 39 | ✗ skipped Inter-Expert Discussion + DA Challenge sections; produced "Convergence" summary instead | **content gap** — fix: queen prompt mandates 8-section format |
| **11. Write transcript file** | ✓ to `docs/ontology/odr/council/session-N-<topic>.md` | ✗ no project location; written inline to subprocess output | **content gap** — fix: queen prompt names default location (`docs/decisions/council/`) |
| 12. Subprocess exits | ✓ 0 | ✓ 0 within 120s timeout | none |

**4 content gaps (stages 5, 6, 10, 11) — all in the queen prompt template.** Mechanism (stages 1-4, 7-9, 12) is identical and works in both. The fix is content-only: embed the protocol scaffolding in `renderHiveMindHeader()` so stages 5-6-10-11 happen by default.

## Considered Options

* **Ship a council-protocol scaffold in ruflo's queen prompt template (chosen)** — embed default panel + protocol + 8-section transcript format + panellist/DA templates so fresh-init projects produce HM-quality output without inventing their own methodology file.

(No alternatives were recorded.)

## Decision Outcome

Chosen option: "Ship a council-protocol scaffold in ruflo's queen prompt template", because the runtime mechanism is confirmed to work (workingCouncil state at `0590bf29c`, today's state, and iter9's empirical run all confirm it) — it's the absence of protocol-content guidance in the queen prompt that produces the gap. The scaffold is **content**, not code mechanics.

Ship a council-protocol scaffold in ruflo's queen prompt template so fresh-init projects produce HM-quality ONT-0021-shaped output without requiring the project to invent its own methodology file. The scaffold is **content**, not code mechanics — the runtime (workingCouncil/ruflo state at `0590bf29c`, today's state, and iter9's empirical run) all confirm the mechanism works; it's the absence of protocol-content guidance in the queen prompt that produces the gap.

### What ships in the patched queen prompt template

Add a new section to `renderHiveMindHeader()` (between MCP TOOLS and HIVE MIND EXECUTION PROTOCOL) — call it **COUNCIL PROTOCOL (when this hive is convened as a council)**:

```
📜 COUNCIL PROTOCOL (when invoked as a council session)

If the objective involves a design decision, ADR question, multi-stakeholder
trade-off, or any phrase by the user containing "council" / "panel" / "convene":

1. PANEL: Spawn N named experts (not "Worker A/B/C"). Pick from a domain panel
   appropriate to the question. For ontology/data: Allemang, Hendler, Kendall,
   Cagle, Gandon, Baker, Davis, Guizzardi, Guarino. For software architecture:
   Fowler, Ousterhout, Evans, Hickey, Beck, Liskov, Vernon, Hashimoto. Each
   panellist gets the empirical 4-section template (see template below) — frame
   in parens, numbered list of context-reading instructions, perspective-specific
   focus questions in section 4, write to file as deliverable.

2. DA: One panellist is explicitly assigned Devil's Advocate role for this
   session. Their prompt charge (verbatim from HM session 5eb0fe0d):
   "Your job is to find flaws, over-engineering, and hidden complexity in any
   proposed scheme. You will also propose your own, but your primary value
   is identifying problems others miss." Their section-4 charge is "CHALLENGE
   these questions hard" with concrete-number challenges, not "steel-man the
   contrarian view".

3. PANELLISTS ARE ONE-SHOT INDEPENDENT. They write positions to separate files
   in <output-dir>/council-<expert>.md — file separation is what enforces
   independence (panellists don't see each other's outputs because their
   files don't exist yet at spawn time). No "you will not see other
   panellists" instruction needed in the prompt.

4. WAIT FOR ALL PANELLISTS. Do not synthesize until every panellist on the
   roster has reported. No placeholders. No "rely on prior outputs". Use
   TaskList as authoritative pre-flight.

5. COMPOSE TRANSCRIPT WITH ALL 8 SECTIONS:
   - § Per-Expert Positions (verbatim or near-verbatim from each panellist's verdict)
   - § Inter-Expert Discussion (queen WRITES sequenced turns: "Allemang
     responds to Knublauch by citing X"; "Kendall builds on Allemang's
     point with FIBO precedent". Use ONLY actual content from panellist
     verdicts. This is composition over real content, not fabrication.)
   - § Devil's Advocate Challenge (DA's actual position) + Responses (using
     other panellists' actual content) + Withdrawal/Hold (DA either explicitly
     withdraws citing the argument that moved them, OR maintains principled
     dissent)
   - § Vote: N-M (formal tally based on panellist verdicts)
   - § Dissent Record (DA position if not withdrawn, with cited rationale)
   - § Recommended Approach (with refinements adopted from the discussion)
   - § Rationale Citing Publications
   - § Agreed Amendments (each labelled by source: "A1 (Allemang): ...",
     "A2 (Kendall): ...")

6. WRITE TRANSCRIPT to docs/decisions/council/ or equivalent project location.

7. PROJECT OVERRIDE: If the project's CLAUDE.md or a methodology file
   (ONT-0021-style) defines a custom panel/protocol, USE THAT INSTEAD of
   this default. The default is for projects without their own methodology.

PANELLIST TEMPLATE (use this exact shape — empirically grounded in HM
session 5eb0fe0d, see References):

   You are **<Named Expert>** (<one-line frame>). You're participating
   in a council to decide <one-line topic>.

   ## Your task

   1. Read these <ADRs|files> to understand <context>:
      - `<path>` (<one-line summary>)
      - ...

   2. Also read `<config-or-data-file>` to understand <X>.

   3. <Background fact relevant to all panellists>.

   4. <PERSPECTIVE-SPECIFIC FOCUS — different bullet questions per expert>:
      - <bullet question 1 angled to this expert's frame>
      - ...

   Write your position in `<output-dir>/council-<expert>.md`. Be specific —
   <concrete deliverable>.

DA TEMPLATE (use this exact shape — empirically grounded in HM session
5eb0fe0d, Hejlsberg call):

   You are **<Named Expert>** (Devil's Advocate — <DA frame>). You're
   participating in a council to decide <topic>.

   ## Your role: DEVIL'S ADVOCATE

   Your job is to find flaws, over-engineering, and hidden complexity in
   any proposed scheme. You will also propose your own, but your primary
   value is identifying problems others miss.

   [sections 1-3 same as panellist template]

   4. CHALLENGE these questions hard:
      - <pointed challenge with concrete numbers>
      - ...

   Write your position in `<output-dir>/council-<expert>.md`. Be brutally
   honest about complexity. Propose the simplest viable scheme.
```

This is ~85 lines of addition to the queen prompt (50-line protocol + 35-line templates). Token cost is bounded; benefit is HM-quality output by default. The templates are **verbatim shape from HM session 5eb0fe0d** — frame-as-parenthetical, file-as-deliverable, perspective-specific focus per expert.

### Consequences

* Good, because once shipped, the gap ADR-0114 §Done U5 identified closes — fresh `ruflo init` projects can run `hive-mind spawn --claude --non-interactive` and get Session-39-shape output. ADR-0136's "Plugin Installation Rule" framing extends naturally to "Council Convening Rule".
* Bad, because the 50-line prompt overhead applies to every hive-mind spawn, even non-council uses. Mitigation: section is gated by "If the objective involves a design decision..." condition; queens can skip it for routine multi-agent work. Token cost: ~250 tokens per spawn — acceptable per `feedback-no-value-judgements-on-features` (default to WIRE).
* Bad, because named-panel domain mismatch — "Allemang/Hendler/Kendall" works for ontology/data but not for, say, frontend UI design. Mitigation: panel selection guidance is suggestive, not prescriptive; queen picks an appropriate panel for the question. Project override (criterion 5) lets projects ship their own panels.
* Bad, because composition-over-real-content discipline can get violated (queen fabricates peer claims). Mitigation: criterion 6 (no-fabrication audit) is a hard test gate. Per memory `reference-hive-pre-regression-pattern.md`, this is the same risk HM mitigated via project review of every council transcript.
* Neutral, because a regression like ADR-0067 §4.2 could happen again. Mitigation: the COUNCIL PROTOCOL section is content, not a tool-preference rule. It doesn't forbid Task tool or any other primitive; it just adds positive guidance on shape. Less likely to be removed than the ADR-0067 negative-rule that was reverted in fe18fddb7.

### Confirmation

A patched queen prompt template ships when ALL hold:

1. **Fresh-init project test**: `mkdir /tmp/council-test && cd /tmp/council-test && ruflo init --full --start-all && ruflo hive-mind spawn --claude --non-interactive -n 3 -o "<design question>"` produces a transcript with **all 8 ONT-0021 sections** (per-expert positions, inter-expert discussion, DA challenge+responses+withdrawal, vote, dissent record, recommended approach, rationale, amendments). No project ONT-0021 supplied.

2. **Named-experts assertion**: panellists in the produced transcript are named experts (Allemang/Fowler/etc.), NOT "Worker A/B/C" labels. Greppable: each panellist heading matches `^**[A-Z][a-zA-Z]+( [A-Z][a-zA-Z]+)*:\*\*` pattern, NOT `^### Worker [A-Z]`.

3. **DA mechanic visible**: transcript includes either `Devil's Advocate.*withdraw` OR `Devil's Advocate.*hold ground` in the body. Greppable.

4. **Inter-Expert Discussion section non-empty**: section exists with at least 4 sequenced turns where each turn names a prior panellist by name and engages with a specific claim. Greppable: `(Allemang|Hendler|Kendall|Cagle|...).*\b(right|wrong|building on|responds to|sharpens|extends|withdraws)`

5. **Project override works**: a project that ships its own `methodology.md` or equivalent (ONT-0021 shape) supersedes the default panel. **Empirically validated by iter10 + iter11** (see §Empirical validation below).

6. **No-fabrication audit**: every claim attributed to a panellist in the transcript can be traced to that panellist's actual verdict (composition over real content, not fabrication). Tested by comparing transcript citations against worker output JSONL.

7a. **Parent permissions inheritance**: spawned queen subprocess inherits `--dangerously-skip-permissions` so the queen itself can read/write project files without prompting. iter9 hit this; iter10 + iter11 confirm `--dangerously-skip-permissions` IS being passed to the queen subprocess.

7b. **Subagent permissions inheritance** (NEW, surfaced by iter10): subagents spawned via Task/Agent tool from the queen do NOT inherit the parent's permission flag, even when the path is a descendant of an allowed working directory. iter10 logs verbatim: *"mkdir in '/private/tmp/council-iter10/council-output' was blocked. For security, Claude Code may only create directories in the allowed working directories for this session: '/private/tmp/council-iter10', '/tmp/council-iter10'"* — `council-output/` is a subdir of `/private/tmp/council-iter10/` so the prefix-match path-canonicalization is broken in the subagent sandbox, OR subagents have a different (stricter) sandbox config than the parent. Fix: subagent sandbox must inherit parent's allowed-dirs as a tree (descendants allowed), not as exact-path entries.

8. **Subprocess turn/budget limits sufficient for full council** (NEW, surfaced by iter11): the non-interactive subprocess (`claude -p --output-format stream-json --verbose`) has internal turn/budget caps that terminate the queen before subagent Tasks complete. iter11 spawned 3 named-expert Agents sequentially (Hickey/Liskov/Evans) but exited before any returned. Fix options:
   - Pipe `--effort high` (or `xhigh|max`) through `spawnClaudeCodeInstance`'s `claudeArgs`
   - Pipe `--max-budget-usd <N>` through (claude has this flag specifically for `--print` mode)
   - Drop `--non-interactive` and require TTY (regression — iter9's primary unlock was `--non-interactive` for nesting from inside an existing claude session)
   - Redesign so panellist Task spawns happen at parent-process level, not from inside a subprocess (out of scope for ADR-0138)

## Empirical validation (iter10 + iter11, 2026-05-04)

Both iterations ran in fresh `/tmp/council-iter1{0,1}/` directories with project-supplied `CLAUDE.md` + `METHODOLOGY.md` (the project-override pathway from §"What ships" rule 7). **No fork code changed.** Same objective as iter9 ("Should hive workers store their final verdicts as memory entries that future hives can retrieve, or should each hive be epistemically isolated?") for direct comparability.

### iter10 — file-as-deliverable variant (matches HM session 5eb0fe0d shape)

Stream-json output: 24 events, 24KB. Queen behaviour (verified from event log):

- ✅ Read `METHODOLOGY.md`
- ✅ Articulated panel: "Evans (bounded context lens), Hickey (simple vs easy), Liskov (substitution + 8 fallacies), Hashimoto (ops/state)" — 4 named experts from the panel
- ✅ Spawned 4 panellists via Agent tool with **empirical PANELLIST TEMPLATE shape** (frame-as-parens, numbered list, perspective-specific section-4, file-as-deliverable to `council-output/council-<expert>.md`)
- ✅ Each panellist had a different focus angle in section 4 (DDD/contexts vs simple-vs-easy vs distributed-substitution vs ops-state)
- ❌ All 4 subagents blocked at mkdir of `council-output/` despite the dir existing (sandbox path-prefix bug, criterion 7b)
- ❌ No transcript composed; council-output/ ended empty

Conclusion: **the protocol gap closes via project-override**, but the subagent sandbox blocks the file-based deliverable mechanism HM session 5eb0fe0d used.

### iter11 — return-value-as-deliverable variant (sandbox workaround)

Stream-json output: 16 events, 6.7KB. Adapted `METHODOLOGY.md`/`CLAUDE.md` so panellists return their position as `tool_result` text (no file writes) and queen composes transcript inline as final assistant message. Queen behaviour:

- ✅ Read `METHODOLOGY.md`
- ✅ Stated panel selection explicitly: *"Hickey, Liskov, Evans, Vernon (panellists) + Hashimoto (DA, operational-complexity critique angle)"*
- ✅ Spawned 3 named-expert Agents (Hickey, Liskov, Evans) — but **sequentially**, not in one parallel message despite explicit CLAUDE.md instruction
- ❌ Subprocess exited before any Agent returned a tool_result; no Vernon, no Hashimoto, no transcript

Conclusion: **prompt scaffolding alone cannot force parallel Task spawning** in non-interactive mode; the queen's default behaviour is sequential. AND the subprocess hits a turn/budget cap before sequential spawns complete (criterion 8). The two failure modes compound.

### Cross-iteration finding

| Stage from §Full 12-stage flow | iter10 outcome | iter11 outcome | Production-ready? |
|---|---|---|---|
| 5. Read methodology | ✅ via `METHODOLOGY.md` | ✅ via `METHODOLOGY.md` | YES, project override works |
| 6. Select named panel | ✅ Evans/Hickey/Liskov/Hashimoto | ✅ Hickey/Liskov/Evans/Vernon/Hashimoto-DA | YES |
| 7. Spawn panellists | ✅ correct empirical template shape | ✅ correct shape, but sequential | partial — needs parallelism |
| 8. Panellists run independently | ❌ sandbox blocks subagent operations | ❌ subprocess exit before returns | NO — needs criterion 7b + 8 fixes |
| 9. Wait for all panellists | n/a (none completed) | n/a (none completed) | NO |
| 10. Compose 8-section transcript | n/a | n/a | NO |
| 11. Write transcript file | n/a | n/a | NO |

**Net**: ADR-0138's prompt-content thesis (stages 5/6/7 close via project-override or queen-prompt scaffolding) is empirically validated. ADR-0138's runtime thesis (stages 8-11 work because iter9 demonstrated the mechanism) is **partially refuted**: iter9 worked with 3 charged-label workers in ~24k tokens; a 4-5 named-expert council needs more turns/budget than the non-interactive subprocess allows by default. **Stages 8-11 require runtime fixes (criteria 7b + 8), not just prompt-content fixes.**

## Phased rollout

Revised after iter10 + iter11. **Three layers** must ship together — prompt content alone is insufficient (empirically demonstrated). Order matters: fix runtime first (subagent sandbox + subprocess budget), then ship prompt scaffolding, then validate end-to-end.

| Step | Layer | Action | Verification |
|---|---|---|---|
| 1 | Runtime (criterion 7b) | Fix subagent sandbox in `spawnClaudeCodeInstance` so subagent allowed-dirs are tree-prefix matches (descendants OK), not exact-path matches. Reproduce iter10's `mkdir council-output` blocked-despite-existing pattern as a unit test, then fix until subagent can write to project subdirs | iter10 reproduction now succeeds; subagent can `Write` and `Bash mkdir` into project subdirs |
| 2 | Runtime (criterion 8) | Plumb `--effort high` (or `--max-budget-usd <N>`) through `spawnClaudeCodeInstance`'s `claudeArgs` builder so non-interactive subprocess has enough turns/budget for a 4-5 expert council | iter11 reproduction (5-expert spawn) now reaches transcript composition; queen emits final assistant message containing 8-section transcript |
| 3 | Prompt content | Edit `renderHiveMindHeader()` to add COUNCIL PROTOCOL section (~85 lines: 50 protocol + 35 templates) using the empirical PANELLIST/DA TEMPLATE shape from §"What ships" | unit test asserts queen prompt contains "COUNCIL PROTOCOL" + empirical template scaffolding |
| 4 | Prompt content | Fix parent permissions inheritance (criterion 7a) so queen's MCP tool calls (`memory_store`, `memory_search`, `hive-mind_memory`) work without prompting | unit test: spawn subprocess and assert `mcp__ruflo__memory_search` succeeds without prompt |
| 5 | Acceptance | Fresh-init project test (criterion 1) — `ruflo init` + `ruflo hive-mind spawn --claude --non-interactive -n 5 -o "<design question>"` produces transcript with **all 8 sections**, named experts only, DA mechanic visible, inter-expert discussion non-empty | passes |
| 6 | Acceptance | Project-override test (criterion 5) — project supplies its own `METHODOLOGY.md`; queen uses that panel + protocol instead of default | passes (already empirically validated by iter10 + iter11; needs to be encoded as a regression test) |
| 7 | Acceptance | No-fabrication audit (criterion 6) — every claim in transcript traces to a panellist's actual tool_result content | passes (manual review on first 3 sessions, then automated comparison harness) |
| 8 | Dogfood | Run on ruflo-patch's own ADR question (e.g. "Should ADR-0138's COUNCIL PROTOCOL section be domain-agnostic or ship per-domain panel files?") and verify HM-quality transcript produced | manual review |

## What this ADR does NOT propose

- **Does NOT replace `child_process.spawn('claude', ...)`.** The spawn call itself is fine — what needs to change is the **flags** passed to it (criterion 8: add `--effort high` or `--max-budget-usd <N>` to `claudeArgs`) and the **subagent sandbox config** that the spawn produces (criterion 7b: tree-prefix-match for allowed dirs, not exact-path). iter11 refutes the original "the mechanism is already correct" framing: the spawn-process mechanism works for iter9's 3-charged-label-worker pattern (24k tokens, no subagent file writes), but a 4-5 named-expert council with file-based or return-value-based composition exceeds default subprocess limits.
- **Does NOT add multi-round agent re-spawning.** The pre-regression mechanism was one-shot panellists + queen composition. That is the proven design (per memory `reference-hive-pre-regression-pattern.md`).
- **Does NOT replace the existing per-queen-type renderers** (Strategic/Tactical/Adaptive). The COUNCIL PROTOCOL section sits in the shared header and applies regardless of queen type — it's about the panellist+protocol shape, not the queen's disposition.
- **Does NOT touch the runtime cross-talk patterns.** Per memory `reference-hive-runtime-crosstalk-pattern.md`, file-based / hive-mind_memory CLI cross-talk is a separate viable pattern (validated iters 2-5). Both can coexist; the queen prompt scaffolding doesn't preclude file-based cross-talk for projects that prefer it.

## Trade-offs and risks

- **Risk: 50-line prompt overhead applies to every hive-mind spawn**, even non-council uses. Mitigation: section is gated by "If the objective involves a design decision..." condition; queens can skip it for routine multi-agent work. Token cost: ~250 tokens per spawn — acceptable per `feedback-no-value-judgements-on-features` (default to WIRE).
- **Risk: named-panel domain mismatch.** "Allemang/Hendler/Kendall" works for ontology/data but not for, say, frontend UI design. Mitigation: panel selection guidance is suggestive, not prescriptive; queen picks an appropriate panel for the question. Project override (criterion 5) lets projects ship their own panels.
- **Risk: composition-over-real-content discipline gets violated** (queen fabricates peer claims). Mitigation: criterion 6 (no-fabrication audit) is a hard test gate. Per memory `reference-hive-pre-regression-pattern.md`, this is the same risk HM mitigated via project review of every council transcript.
- **Risk: regression like ADR-0067 §4.2 happens again.** Mitigation: the COUNCIL PROTOCOL section is content, not a tool-preference rule. It doesn't forbid Task tool or any other primitive; it just adds positive guidance on shape. Less likely to be removed than the ADR-0067 negative-rule that was reverted in fe18fddb7.

## What this enables (downstream)

Once shipped, the gap ADR-0114 §Done U5 identified closes. Fresh `ruflo init` projects can run `hive-mind spawn --claude --non-interactive` and get Session-39-shape output. ADR-0136's "Plugin Installation Rule" framing extends naturally to "Council Convening Rule" — the AI knows when to convene and what shape the output should take, all from the queen prompt.

## References

### Empirical Task-tool prompt artifacts (the literal prompts — RECOVERED 2026-05-04)

- **HM Claude Code session 5eb0fe0d** — 4 verbatim Task tool prompts for a council on `generated/` folder organization:
  - File: `~/.claude/projects/-Users-henrik-source-hm-semantic-modelling/5eb0fe0d-49f4-476e-8c59-21d8b1f7d2a3.jsonl`
  - Panellists captured: Allemang (KG/structure focus), Cagle (practical/tooling focus), Baker (provenance/lineage focus), Hejlsberg (Devil's Advocate, "find flaws/over-engineering/hidden complexity")
  - Output convention: `generated/council-<expert>.md` (file as deliverable, not return value)
  - Extraction command (replicate via): `python3 -c "import json; [print(json.dumps(c['input'], indent=2)) for line in open('5eb0fe0d-49f4-476e-8c59-21d8b1f7d2a3.jsonl') for obj in [json.loads(line)] for c in (obj.get('message') or {}).get('content', []) if isinstance(c, dict) and c.get('name') == 'Task' and 'council' in c.get('input', {}).get('prompt', '').lower()]"`
- **HM Claude Code session 47aa8330** — multi-agent audit using `Agent N: <Role>` numbered-auditor framing (different mode from named-expert council, useful for completeness audits): `~/.claude/projects/-Users-henrik-source-hm-semantic-modelling/47aa8330-b0c0-4eae-b146-46ce66c50c9b.jsonl`
- **All HM session transcripts**: `~/.claude/projects/-Users-henrik-source-hm-semantic-modelling/*.jsonl` — search via `grep -l '"Task"' *.jsonl | xargs grep -l '<expert-name>'`

### Council methodology + transcript outputs

- **HM working session transcripts**: `/Users/henrik/source/hm/semantic-modelling/docs/ontology/odr/council/` — 200+ session transcripts; `session-39-ont-0034-implementation.md` is the canonical reference for the 8-section format
- **ONT-0021 methodology**: `/Users/henrik/source/hm/semantic-modelling/docs/ontology/odr/ONT-0021-expert-hive-review-methodology.md` (352 lines). §Session Protocol (lines 57-63) defines 5 mandatory rules. §Track Record (lines 89+) lists every session with panel composition and verdict tally.
- **HM CLAUDE.md anchor**: `/Users/henrik/source/hm/semantic-modelling/CLAUDE.md` line 191 — `Write council transcript to docs/ontology/odr/council/ if council convened`

### Pre-regression source clone

- **Pre-regression ruflo source clone**: `/Users/henrik/source/workingCouncil/ruflo/` checked out at `0590bf29c` (2026-03-20). Inspection shows substrate-only queen prompt at lines 79–168 of `v3/@claude-flow/cli/src/commands/hive-mind.ts`. All 4 forks cloned for full pre-regression context (agentic-flow @3cd9b47, ruv-FANN @b3908f1, ruvector @76d7dbea).

### iter9 empirical run

- **iter9 empirical run** (no project methodology): stream-json output captured at `~/.claude/projects/-Users-henrik-source-ruflo-patch/.../tool-results/b4c7hpci3.txt` (157KB). Command: `npx @sparkleideas/cli@latest hive-mind spawn -n 3 --queen-type strategic --consensus byzantine --claude --non-interactive -o "<question>"`. Demonstrates the 4 content gaps (stages 5/6/10/11) when project has no ONT-0021 equivalent. Queen invented "Worker A/B/C with PERSIST/ISOLATE/HYBRID charges" instead of named experts.

### iter10 empirical run (file-as-deliverable variant)

- **iter10**: `/tmp/council-iter10/` with `CLAUDE.md` + `METHODOLOGY.md` (project-override pathway). Same objective as iter9. Setup files preserved at `/tmp/council-iter10/CLAUDE.md` (2716 bytes) + `METHODOLOGY.md` (5376 bytes). Stream-json log: `/tmp/council-iter10/iter10-stdout.log` (24KB, 24 events).
- Outcome: queen ✅ read methodology, ✅ selected named experts (Evans/Hickey/Liskov/Hashimoto), ✅ used empirical PANELLIST TEMPLATE shape; ❌ subagents blocked at `mkdir council-output/` despite the dir existing under an allowed working directory. Confirmed criterion 7b regression (subagent sandbox path-canonicalization).

### iter11 empirical run (return-value-as-deliverable variant)

- **iter11**: `/tmp/council-iter11/` with revised `CLAUDE.md` + `METHODOLOGY.md` to bypass the iter10 sandbox issue (panellists return content via `tool_result`, queen composes inline). Same objective as iter9. Setup files preserved at `/tmp/council-iter11/CLAUDE.md` + `METHODOLOGY.md`. Stream-json log: `/tmp/council-iter11/iter11-stdout.log` (6.7KB, 16 events).
- Outcome: queen ✅ read methodology, ✅ articulated panel selection (*"Hickey, Liskov, Evans, Vernon (panellists) + Hashimoto (DA, operational-complexity critique angle)"*), ✅ spawned 3 named-expert Agents (Hickey/Liskov/Evans) with empirical template shape and per-expert focus angles; ❌ spawns were sequential despite explicit CLAUDE.md instruction to spawn-in-one-message; ❌ subprocess exited before any Agent returned. Surfaced criterion 8 (subprocess turn/budget cap).

### Memory rules + prior ADRs

- **Memory rules**: `feedback-hive-discussion-mechanics.md` (5 criteria), `reference-hive-pre-regression-pattern.md` (8-step working flow + composition-vs-fabrication distinction), `reference-hive-runtime-crosstalk-pattern.md` (alternative file-based and hive-mind_memory CLI patterns)
- **Prior ADRs**: ADR-0114 §Done U5 (delivery gap), ADR-0136 (claudemd content audit), ADR-0067 §4.2 / `7d9c61ad0` (regression commit reverted by `fe18fddb7`), ADR-0104/0125/0131/0132 (worker/queen failure protocols already shipped)
- **HM project memory rules** (the regression-remediation scar tissue that documents the procedural protocol): `feedback_hive_queen_must_wait_for_all_panellists.md`, `feedback_swarm_vs_hive_distinction.md`, `feedback_wait_for_hive.md` at `/Users/henrik/source/hm/semantic-modelling/.claude/memory/`

## Amendment History

- **2026-05-04 (initial)**: Proposed; queen-prompt panellist template reconstructed from ONT-0021 §Session Protocol + Session 39 verdict shapes (citation-heavy reconstruction with publication-list table and Vote: yes/no/abstain rule)
- **2026-05-04 (revision 1)**: Stage 7 panellist template + "What ships" §PANELLIST TEMPLATE / §DA TEMPLATE replaced with **empirically-recovered shape** from HM Claude Code session 5eb0fe0d (4 Task tool calls — Allemang/Cagle/Baker/Hejlsberg-DA). Real template is simpler: frame-as-parenthetical (no publication-citation table), file-as-deliverable (no return-value vote), perspective-specific focus per expert (different bullet questions per panellist), DA charge is "find flaws/over-engineering/hidden complexity" (not "steel-man contrarian view"). Added cross-references to both empirical sessions. Citation discipline + vote-tally framing remain in CLAUDE.md / project-supplied methodology, NOT in the per-Task prompt.
- **2026-05-04 (revision 2)**: Empirical validation runs iter10 + iter11 added. Both validate that the **project-override pathway** (project-supplied `CLAUDE.md` + `METHODOLOGY.md`) closes the prompt-content gap without changing fork code — queens correctly read methodology, select named experts, and apply the empirical PANELLIST/DA TEMPLATE. But both expose **runtime gaps** that prompt scaffolding alone cannot close:
  - **Criterion 7 split into 7a (parent) + 7b (subagent)**: parent permission inheritance works (`--dangerously-skip-permissions` propagates to queen subprocess), but **subagent sandbox** uses exact-path matching for allowed dirs instead of tree-prefix matching, blocking subagent writes/mkdir even into project subdirs. iter10 reproduced verbatim.
  - **Criterion 8 added**: non-interactive subprocess (`claude -p --output-format stream-json --verbose`) has internal turn/budget caps that terminate the queen before subagent Tasks complete. iter11 reproduced — queen spawned 3 of 5 named experts sequentially, subprocess exited before any returned. Fix options: pipe `--effort high` or `--max-budget-usd <N>` through `spawnClaudeCodeInstance`'s `claudeArgs`.
  - **Phased rollout reorganized**: 3 layers (runtime fixes → prompt content → acceptance gates) with runtime fixes BEFORE prompt-content shipping. Prompt-content alone is insufficient; runtime constraints must be addressed first.

## More Information

Original status: **[RECONCILED 2026-05-29 → DELIVERED; see [[ADR-0270]]]** This ADR's deliverable — a default council-session template projects can rely on without inventing their own ONT-0021 — shipped 2026-05-29 as [[ADR-0140]] Piece 2: `templates/generic-council-protocol.md` (the default dialectic methodology) + `templates/worker-contract.md` (the per-expert spawn contract), in both the editorial `.claude/skills/hive-mind-advanced/` and the `plugins/ruflo-hive-mind/skills/hive-mind-advanced/` delivery surfaces. Original status preserved below. — Proposed (2026-05-04). Concrete gap analysis comparing iter9's empirical output (literal `npx hive-mind spawn --claude --non-interactive` from inside an existing claude session) against the HM repo's pre-regression Sessions 22-39 production sessions. Identifies exactly what queen-prompt scaffolding ruflo must ship to produce HM-quality output without requiring projects to invent their own ONT-0021.

This ADR relates to ADR-0114 §Done U5 (council protocol delivery gap), ADR-0136 (claudemd generator content audit — same delivery-gap class), ADR-0067 §4.2 (the TOOL PREFERENCE regression that broke the hive 2026-03-25 → 2026-04-29), ADR-0104 (queen orchestration), ADR-0131 (worker failure protocol — already shipped), ADR-0132 (sub-queen failure escalation — already shipped), and ADR-0125 (queen disposition — already shipped).

Scope: The queen-prompt template at `forks/ruflo/v3/@claude-flow/cli/src/commands/hive-mind.ts` lines 394 (`renderHiveMindHeader`) + 617/656/698 (per-queen-type renderers). Specifically the protocol-content gap that prevents fresh-init projects from producing council-format output.
