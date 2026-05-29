---
status: accepted
completed: false
date: 2026-05-29
tags: [corpus-hygiene, adr-status, reconciliation, outstanding-work, defer-with-trigger]
supersedes: []
depends-on: [ADR-0262, ADR-0257, ADR-0269]
implements: []
---

> **Status (2026-05-29)**: `accepted` (the reconciliation verdicts below are
> ratified), `completed: false` so this ADR surfaces in an `adr-index`
> outstanding-work query as the single anchor for the genuinely-open set it
> enumerates. Flip to `completed: true` when every ADR in §"Genuinely open"
> is closed or re-homed.

# Reconciliation of stale old-format ADR status lines (2026-05-29 corpus audit)

## Context and Problem Statement

The ADR corpus carries two status conventions. Pre-[[ADR-0262]] ADRs record status
in a body line `- **Status**: ...` written **once at proposal time** and almost
never updated. Post-[[ADR-0262]] ADRs use frontmatter `status:` + `completed:`.

A "what's left to do?" query against the corpus is therefore unreliable: a body
saying "Proposed" is not evidence the work is open. A naive `completed: false`
query returns exactly one ADR ([[ADR-0269]]) because the flag is new and was not
backfilled onto the ~160 old-format ADRs. Reading the body status lines instead
**over-reports** outstanding work — many "Proposed"/"Partial" ADRs describe work
that has since shipped, folded into a tracker, or been superseded.

This was demonstrated in-session: an initial answer reported [[ADR-0100]] as having
"four contract artifacts never landed" straight from its 2026-05-03 status line —
all four exist in `forks/ruflo` `main` today.

On 2026-05-29 a 4-agent read-only reconciliation adjudicated ~30 old-format ADRs,
each verdict grounded in (1) frontmatter `completed:` where present, (2) the actual
status/content of successor ADRs, (3) live presence/absence of the exact
code/test/script artifacts each ADR names (checked in `forks/*` on `main` and in
`ruflo-patch`), and (4) git log — never the body prose. Headline open/residual
verdicts were independently re-verified before this record was written.

## Decision Drivers

* **Corpus honesty** — stale "Proposed" lines mislead every future "what's left"
  query and inflate the apparent backlog (the stale-row trap, cf
  `[[feedback-old-adr-status-lines-go-stale]]`, `[[feedback-ledger-deferred-row-may-be-stale]]`).
* **Queryability** — [[ADR-0262]] added `completed:` precisely so outstanding work
  surfaces. The genuinely-open old ADRs lack frontmatter, so they never surface.
* **Surgical change** — correcting in place must preserve the historical
  proposal-time record (the convention used by [[ADR-0103]]/[[ADR-0147]]: prepend a
  dated marker, keep the original).
* **No silent defer** — per `[[feedback-skip-accepted-as-squelch]]`, every
  still-open item names an explicit trigger, not "later".

## Considered Options

* **Option A — leave the corpus as-is.** Rejected: the corpus actively
  misrepresents what's open; the cost recurs on every status query.
* **Option B — backfill full YAML frontmatter (`status:` + `completed:`) onto all
  ~160 old-format ADRs.** Rejected here as out of scope: a wholesale format
  migration the project has not chosen; high edit surface, low marginal value over
  Option C for answering "what's left".
* **Option C (chosen)** — record the reconciliation verdicts in this ADR, make the
  genuinely-open set queryable here with explicit triggers (the [[ADR-0257]]/[[ADR-0269]]
  defer-with-trigger pattern), and apply **surgical dated status-line amendments**
  only to the ADRs whose prose is *actively misleading* (says open/blocks-X but is
  done/resolved/superseded).

## Decision Outcome

Chosen: **Option C.** The eight actively-misleading ADRs receive a prepended
`[RECONCILED 2026-05-29 → …; see ADR-0270]` marker (original status text preserved
after it). All other verdicts live in the table below; the genuinely-open set is
the queryable backlog this ADR anchors.

### Reconciliation verdict table (~30 old-format ADRs)

| Verdict | ADRs | Evidence summary |
|---|---|---|
| **GENUINELY OPEN** | **0137** (cwd-eradication campaign) | ~85 `adr-0100-allow:` annotations unfixed in `forks/ruflo` `main`; runtime guard `assertProjectRootAnchored` absent (0 hits); no acceptance check. Campaign never executed. |
| | **0149** (guidance MCP coverage) | `guidance-tools.ts` still advertises phantom tools (some, e.g. `memory_export`, have since shipped via [[ADR-0255]], so the count is lower than the ADR's); coverage drift-test absent; 3 phases unbuilt. |
| | **0102** (unified embedding config) | Rust side unbuilt — no `ruvector-config` crate; `embedding_dim: 384` defaults remain in `forks/ruvector`. **Node side already done** via [[ADR-0068]]/[[ADR-0177]] (init writes `embedding.*` keys, 768-dim per `[[reference-embedding-model]]`). |
| | **0146** (substrate-dictated team binding) | Blocked on [[ADR-0140]] Piece 6, which is itself unbuilt (`requiredSetup`/`spawnTemplate`/`TeamCreate` → 0 hits in `swarm-tools.ts`/`hive-mind-tools.ts`). |
| **DORMANT** (no successor, no forcing function) | **0099** (perf-testing program) | No `test:perf` script, no `tests/benchmarks/wallclock/`, no `docs/reports/perf/`, no `--promote`/`--calibrate` flags. ADR admits zero motivating regressions. |
| | **0101** (fork-README program) | Zero `@sparkleideas` prelude in any of the 4 fork READMEs; stale `ruvnet/claude-flow` URLs remain; 5 §Open Decisions never answered; partly depends on the unbuilt 0102. |
| **DONE-WITH-RESIDUAL** | **0100** (project-root resolution) | All 4 "pending" artifacts now exist (sentinel writer `init/executor.ts`, `__tests__/find-project-root.test.ts`, `lib/acceptance-adr0100-checks.sh`, `scripts/check-no-cwd-in-handlers.sh`). Residual = the broad site-eradication, owned by 0137. **Amended.** |
| | **0140** (hive-mind-advanced) | Piece 1 (the 718-line fork-authored skill, commit `d3fbfccee`) shipped + init-delivered. **Piece 2 council templates shipped 2026-05-29** (defect fixed — see §Confirmation #3). Residuals: Piece 5 handler tests, Piece 6 team-binding. |
| | **0138** (working council template) | Its deliverable = 0140 Piece 2 templates — **delivered 2026-05-29** (`generic-council-protocol.md` + `worker-contract.md`). |
| | **0156** (memory init --force) | Impl shipped (`cfb0cea02`), corroborated by [[ADR-0164]] (`completed: true`). Residual = `tests/unit/adr0156-memory-init-force.test.mjs` not wired into the standard CICD runner (`[[feedback-always-wire-tests-into-cicd]]`). **Amended.** |
| | **0098** (swarm-init sprawl) | Fix shipped (`32c13d322`); acceptance check present; state file self-caps (21 clean `terminated`). Residual = paired unit test (ADR-0097 Tier Y/Z). Upstream-issue pending is policy-moot (`[[feedback-no-upstream-donate-backs]]`). |
| | **0104** (queen orchestration) | Implemented; acceptance + unit coverage exist. Residual = a thin standalone smoke script. |
| | **0106** (consensus enforcement) | In-handler dispatch done (0119/0120/0121). Daemon `ConsensusEngine` ~1400 LOC intentionally parked; orphan files preserved by design. |
| | **0065** (config centralization) | P3 actually mostly shipped despite "P3 deferred" headline; only the explicitly-*rejected* graph-consolidation is undone → effectively none. |
| | **0114** (swarm/hive-mind model) | Folded; U4/U5 code shipped despite unchecked §Done boxes; only doc back-reference chores remain. **Amended.** |
| | **0115** (iterative-discussion regression) | Regression-A fix live in `init/claudemd-generator.ts:72-83`; Regression B out-of-scope (upstream). **Amended.** |
| **SUPERSEDED / CLOSED / EXECUTED** (no work; stale prose only) | **0133** (RVF concurrent-write regression) | **Resolved** via stale-binary rebuild (`411cca1`/`bec5606`); `t3-2-concurrent` passes "6/6 persisted" in current acceptance. "Blocks ADR-0094" is void (0094 closed 2026-04-21, before this ADR). **Amended.** |
| | **0134** (native-artifact rebuild) | **Superseded** by [[ADR-0150]] (napi) + [[ADR-0232]] (wasm); its own `native-rebuild.sh`/`.native-targets.sh` design never built. **Amended.** |
| | **0139** (hive-mind-advanced spec) | Spec consumed by 0140. |
| | **0144** (MCP tools from sub-agent) | Self-superseded by 0140 (already marked). |
| | **0145** (research collection) | Executed (already marked). |
| | **0158** (multi-type DR indexer) | ODR skills shipped at `~/.claude/skills/` under the **DCAP / ODR-0095** model, NOT this ADR's ONT-0029 design (`.code.md` companions retired). Doc-reconciliation only. **Amended.** |
| | **0159** (HM decision-records refactor) | Obsolete — migration script never existed; HM converged on DCAP (no `methodology:` field). **Amended.** |
| | **0103 / 0107 / 0109 / 0110 / 0125 / 0129 / 0132** | All closed via the [[ADR-0118]] T1–T14 tracker (14/14 complete). |

### Genuinely open (the queryable backlog this ADR anchors)

Per `[[feedback-skip-accepted-as-squelch]]`, each carries a trigger.

| ADR | Open work | Trigger / blocker |
|---|---|---|
| **0137** | ~85 `adr-0100-allow:` sites → real `findProjectRoot()` fixes; the `assertProjectRootAnchored` runtime write-guard; non-root-cwd acceptance check | Mechanical campaign; no external blocker — symptom currently *masked* by the `**/.claude-flow/` gitignore rule, not fixed |
| **0149** | Reconcile `guidance-tools.ts` (drop phantoms / add real tools); coverage drift-test | None forcing; guidance keeps mis-advertising until scheduled |
| **0102** | Rust `ruvector-config` crate + shared schema; remove `embedding_dim: 384` literals | Standalone-ruvector Rust users get 384-dim; no forcing function (Node path already 768) |
| **0146** | `swarm_init`/`agent_spawn` return Agent-Teams binding | **[[ADR-0140]] Piece 6** must land + validate first |
| **0099** | Whole perf-testing program | An actual logged perf regression |
| **0101** | Per-fork README prelude + stale-URL fix | Its 5 §Open Decisions need user answers; nothing forces it |

### Consequences

* Good, because the next "what's left" query resolves against this one record plus
  the trigger-tracked deferrals ([[ADR-0269]]/[[ADR-0249]]/[[ADR-0250]]/[[ADR-0252]]),
  not ~30 stale prose lines.
* Good, because the eight actively-misleading ADRs no longer falsely read as open
  (or, for 0100, falsely as incomplete).
* Bad, because this is a point-in-time snapshot — a *new* round of old-ADR drift is
  possible; mitigated by `[[feedback-old-adr-status-lines-go-stale]]` recording the
  reconciliation method.
* Neutral, because the ~160 old ADRs still lack queryable frontmatter (Option B not
  taken); this ADR carries the open-set queryability instead.

### Confirmation

1. The eight amended ADRs (0100, 0114, 0115, 0133, 0134, 0156, 0158, 0159) each
   open with a `[RECONCILED 2026-05-29 → …; see ADR-0270]` marker; their original
   status text is preserved verbatim after it.
2. `adr-index` surfaces THIS ADR (`completed: false`, tag `outstanding-work`) as the
   anchor for the §"Genuinely open" set.
3. A concrete defect confirmed during the audit: the init-delivered
   `hive-mind-advanced/SKILL.md` (in `.claude/skills/` and `plugins/ruflo-hive-mind/skills/`)
   referenced `templates/generic-council-protocol.md` and `templates/worker-contract.md`
   (lines 186/208/219) that did not exist — a live broken reference ([[ADR-0140]] Piece 2).
   **RESOLVED 2026-05-29**: both templates authored + placed in both skill dirs
   (byte-identical); references resolve; `smoke-skills-lockstep` + `smoke-init-bundle-invariants`
   green. Closes [[ADR-0140]] Piece 2 + [[ADR-0138]]. ([[ADR-0140]] Piece 5 tests + Piece 6
   team-binding remain open; [[ADR-0146]] still blocked on Piece 6.)
4. When every ADR in §"Genuinely open" is closed or re-homed, flip this ADR to
   `completed: true`.

## More Information

* [[ADR-0262]] — the `completed:` schema extension this reconciliation operationalises.
* [[ADR-0257]] / [[ADR-0269]] — the defer-with-trigger / queryable-tracker pattern this ADR follows.
* [[ADR-0233]] / [[ADR-0201]] — the audit "Reviews still owed" carry-forward (runtime perf/leak G-16-014; `archive/` skill pollution) — adjacent outstanding work not re-listed here.
* `[[feedback-old-adr-status-lines-go-stale]]` — the method this audit used and the durable lesson.
* Amended ADRs: [[ADR-0100]], [[ADR-0114]], [[ADR-0115]], [[ADR-0133]], [[ADR-0134]], [[ADR-0156]], [[ADR-0158]], [[ADR-0159]].
