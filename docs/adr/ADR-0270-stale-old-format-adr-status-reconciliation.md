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
| **GENUINELY OPEN** | **0137** (cwd-eradication campaign) | **Re-validated 2026-05-29: 94** `adr-0100-allow:` annotations unfixed across **26 files** in `forks/ruflo` `main` (pass-1 said ~85 — under-counted); runtime guard `assertProjectRootAnchored` absent (0 hits, also 0 `adr-0137` source refs); no ADR-0137 acceptance check (the existing `acceptance-adr0100-checks.sh` runs deep-cwd but only canaries `.swarm/` placement, not the stray-`.claude-flow/` tree-walk). Campaign never executed; grep gate is green only because the annotations *are* the allowlist shape. |
| | **0149** (guidance MCP coverage) | **Re-validated 2026-05-29:** `guidance-tools.ts` (`v3/@claude-flow/cli/src/mcp-tools/`) catalog is **byte-frozen** at its audited state → **~40 phantom tools** still advertised (whole fabricated `security_*` area; underscore-vs-dash `hooks_*`/`hive_mind_*`; wrong-name peers); `memory_export` shipping ([[ADR-0255]]) removed exactly 1. Drift-test absent (incl. the ADR's own named acceptance file); 3 phases unbuilt. **Cheapest high-value fix = a drift-test asserting every catalog tool resolves in `config/mcp-surface-manifest.json`** (registry-of-truth already exists). |
| **DORMANT** (no successor, no forcing function) | **0099** (perf-testing program) | **Re-validated 2026-05-29: every artifact ABSENT** — no `test:perf` script, no `tests/benchmarks/wallclock/`, no `docs/reports/perf/`, no `--promote`/`--calibrate`/`--skip-perf-check` flags, no `publish:fork` staleness gate. ADR self-admits zero motivating regressions. `scripts/analyze-acceptance-perf.mjs` is unrelated (acceptance-pipeline timing, not the dedicated wallclock-benchmark program) — and is the first-line substitute the ADR itself names. |
| | **0101** (fork-README program) | **Re-validated 2026-05-29:** zero `@sparkleideas` prelude in **all 5** fork READMEs (agentdb is the 5th — pass-1 said 4); stale `ruvnet/claude-flow` URLs total **6, concentrated** (ruflo 3, ruvector 2, agentic-flow 1) — far below the ADR's ~15-20 estimate because upstream rewrote ruflo's README (7541→408 lines, `9250df2df`), invalidating the ADR's inventory; 5 §Open Decisions never answered. **0102 dependency now CLEARED** (0102 closed 2026-05-29) → mechanical half (prelude + 6 URL fixes + 5 stale `npx claude-flow@latest` cmds in ruflo) is unblocked. |
| **DONE-WITH-RESIDUAL** | **0100** (project-root resolution) | All 4 "pending" artifacts now exist (sentinel writer `init/executor.ts`, `__tests__/find-project-root.test.ts`, `lib/acceptance-adr0100-checks.sh`, `scripts/check-no-cwd-in-handlers.sh`). Residual = the broad site-eradication, owned by 0137. **Amended.** |
| | **0140** (hive-mind-advanced) | Piece 1 (the 718-line fork-authored skill, commit `d3fbfccee`) shipped + init-delivered. **Piece 2 council templates shipped 2026-05-29** (defect fixed — see §Confirmation #3). **Piece 5 handler tests added 2026-05-29** (`e69683975` — join/leave/broadcast; memory was already covered by ADR-0122/0123/0131). **Piece 6 DECLINED 2026-05-29** — team comms is a swarm concern (already at the swarm skill layer); binding hive workers breaks dialectic independence + would mutate the shared MCP surface. No open residuals. |
| | **0138** (working council template) | Its deliverable = 0140 Piece 2 templates — **delivered 2026-05-29** (`generic-council-protocol.md` + `worker-contract.md`). |
| | **0156** (memory init --force) | Impl shipped (`cfb0cea02`), corroborated by [[ADR-0164]] (`completed: true`). Residual = `tests/unit/adr0156-memory-init-force.test.mjs` not wired into the standard CICD runner (`[[feedback-always-wire-tests-into-cicd]]`). **Amended.** |
| | **0098** (swarm-init sprawl) | Fix shipped (`32c13d322`); acceptance check present; state file self-caps (21 clean `terminated`). Residual = paired unit test (ADR-0097 Tier Y/Z). Upstream-issue pending is policy-moot (`[[feedback-no-upstream-donate-backs]]`). |
| | **0104** (queen orchestration) | Implemented; acceptance + unit coverage exist. Residual = a thin standalone smoke script. |
| | **0106** (consensus enforcement) | In-handler dispatch done (0119/0120/0121). Daemon `ConsensusEngine` ~1400 LOC intentionally parked; orphan files preserved by design. |
| | **0065** (config centralization) | P3 actually mostly shipped despite "P3 deferred" headline; only the explicitly-*rejected* graph-consolidation is undone → effectively none. |
| | **0114** (swarm/hive-mind model) | Folded; U4/U5 code shipped despite unchecked §Done boxes; only doc back-reference chores remain. **Amended.** |
| | **0115** (iterative-discussion regression) | Regression-A fix live in `init/claudemd-generator.ts:72-83`; Regression B out-of-scope (upstream). **Amended.** |
| | **0102** (unified embedding config) | **CLOSED 2026-05-29** (was GENUINELY OPEN). Node memory config chain delivered (`resolve-config.ts` — 768 default + refined 384→768 gate, [[ADR-0068]]/[[ADR-0177]]); Rust `ruvector-config` unification **DECLINED** — the residual `embedding_dim: 384` literals are ruvllm's *internal routing-index* presets, not the memory path, and `ruvllm_hnsw_create` already takes dim from the caller (validated `[1,100k]`). Standalone-`cargo add ruvllm`-only beneficiary; no fork consumer, no forcing function; no-donate-back. **Amended.** |
| **SUPERSEDED / CLOSED / EXECUTED** (no work; stale prose only) | **0133** (RVF concurrent-write regression) | **Resolved** via stale-binary rebuild (`411cca1`/`bec5606`); `t3-2-concurrent` passes "6/6 persisted" in current acceptance. "Blocks ADR-0094" is void (0094 closed 2026-04-21, before this ADR). **Amended.** |
| | **0134** (native-artifact rebuild) | **Superseded** by [[ADR-0150]] (napi) + [[ADR-0232]] (wasm); its own `native-rebuild.sh`/`.native-targets.sh` design never built. **Amended.** |
| | **0139** (hive-mind-advanced spec) | Spec consumed by 0140. |
| | **0144** (MCP tools from sub-agent) | Self-superseded by 0140 (already marked). |
| | **0145** (research collection) | Executed (already marked). |
| | **0158** (multi-type DR indexer) | ODR skills shipped at `~/.claude/skills/` under the **DCAP / ODR-0095** model, NOT this ADR's ONT-0029 design (`.code.md` companions retired). Doc-reconciliation only. **Amended.** |
| | **0159** (HM decision-records refactor) | Obsolete — migration script never existed; HM converged on DCAP (no `methodology:` field). **Amended.** |
| | **0146** (substrate-dictated team binding, swarm) | **DECLINED 2026-05-29.** Team comms is a swarm concern, already delivered at the swarm skill layer (`swarm-init/SKILL.md:16` — `TeamCreate`/`Agent`/`SendMessage`); the substrate-dictated mechanism (mutating shared `swarm_*` MCP returns) declined. Un-parented from [[ADR-0140]] Piece 6 (also declined). The legit skill-layer part (enrich swarm's thin team-coordination prose) **LANDED 2026-05-29** (`swarm-init`, fork `ca6b4c3bf`). **Amended.** |
| | **0103 / 0107 / 0109 / 0110 / 0125 / 0129 / 0132** | All closed via the [[ADR-0118]] T1–T14 tracker (14/14 complete). |

### Genuinely open (the queryable backlog this ADR anchors)

Per `[[feedback-skip-accepted-as-squelch]]`, each carries a trigger. Live-revalidated 2026-05-29 (4-agent artifact check); all four confirmed still open/dormant, counts corrected below.

| ADR | Open work | Trigger / blocker |
|---|---|---|
| **0137** | **94** `adr-0100-allow:` sites (26 files) → real `findProjectRoot()` fixes; the `assertProjectRootAnchored` runtime write-guard; non-root-cwd acceptance check (stray-`.claude-flow/` tree-walk) | Mechanical campaign; no external blocker — symptom currently *masked* by the `**/.claude-flow/` gitignore rule, not fixed |
| **0149** | Drift-test asserting every `guidance-tools.ts` catalog tool resolves in `config/mcp-surface-manifest.json` (cheap, catches all ~40 phantoms); then drop phantoms / add the missing real namespaces | None forcing; guidance keeps mis-advertising ~40 phantoms until scheduled |
| **0099** | Whole perf-testing program | An actual logged perf regression |
| **0101** | Per-fork (×5) README `@sparkleideas` prelude + 6 stale-`claude-flow`-URL fixes; mechanical half now unblocked (0102 cleared) | Its 5 §Open Decisions need user answers; nothing else forces it |

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

1. The nine amended ADRs (0100, 0102, 0114, 0115, 0133, 0134, 0156, 0158, 0159) each
   open with a `[RECONCILED 2026-05-29 → …; see ADR-0270]` marker; their original
   status text is preserved verbatim after it. (0102 was closed-from-open the same
   day — product config chain delivered, Rust remainder declined — so it bears a
   marker too.)
2. `adr-index` surfaces THIS ADR (`completed: false`, tag `outstanding-work`) as the
   anchor for the §"Genuinely open" set.
3. A concrete defect confirmed during the audit: the init-delivered
   `hive-mind-advanced/SKILL.md` (in `.claude/skills/` and `plugins/ruflo-hive-mind/skills/`)
   referenced `templates/generic-council-protocol.md` and `templates/worker-contract.md`
   (lines 186/208/219) that did not exist — a live broken reference ([[ADR-0140]] Piece 2).
   **RESOLVED 2026-05-29**: both templates authored + placed in both skill dirs
   (byte-identical); references resolve; `smoke-skills-lockstep` + `smoke-init-bundle-invariants`
   green. Closes [[ADR-0140]] Piece 2 + [[ADR-0138]]. ([[ADR-0140]] Piece 5 tests added
   2026-05-29; **Piece 6 DECLINED** — team comms is a swarm concern (already at the swarm
   skill layer), not a hive one, and the dialectic patterns require worker isolation;
   [[ADR-0146]] likewise declined + un-parented.)
4. When every ADR in §"Genuinely open" is closed or re-homed, flip this ADR to
   `completed: true`.

## More Information

* [[ADR-0262]] — the `completed:` schema extension this reconciliation operationalises.
* [[ADR-0257]] / [[ADR-0269]] — the defer-with-trigger / queryable-tracker pattern this ADR follows.
* [[ADR-0233]] / [[ADR-0201]] — the audit "Reviews still owed" carry-forward (runtime perf/leak G-16-014; `archive/` skill pollution) — adjacent outstanding work not re-listed here.
* `[[feedback-old-adr-status-lines-go-stale]]` — the method this audit used and the durable lesson.
* Amended ADRs: [[ADR-0100]], [[ADR-0102]], [[ADR-0114]], [[ADR-0115]], [[ADR-0133]], [[ADR-0134]], [[ADR-0156]], [[ADR-0158]], [[ADR-0159]].
