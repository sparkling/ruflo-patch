---
status: implemented
date: 2026-05-25
tags: [session-backlog, execution-plan, swarm-orchestration, integration-ledger, ADR-129, ADR-130]
supersedes: []
depends-on: [ADR-0254, ADR-0255, ADR-0256]
implements: []
---

# 2026-05-25 session backlog + 4-batch execution plan

## Context and Problem Statement

The 2026-05-25 session produced eight audit deliverables ([picks-validation](../audits/2026-05-25-picks-validation.md), [skip-accepted-audit](../audits/2026-05-25-skip-accepted-audit.md), [adr0254-devils-advocate](../audits/2026-05-25-adr0254-devils-advocate.md), [ledger-deferred-spot-check](../audits/2026-05-25-ledger-deferred-spot-check.md), [ledger-misc-mech-audit](../audits/2026-05-25-ledger-misc-mech-audit.md), [ledger-napi-regens-audit](../audits/2026-05-25-ledger-napi-regens-audit.md), [ledger-pending-audit](../audits/2026-05-25-ledger-pending-audit.md), [ledger-skip-by-policy-audit](../audits/2026-05-25-ledger-skip-by-policy-audit.md), [ledger-version-bumps-audit](../audits/2026-05-25-ledger-version-bumps-audit.md)), two background research files (`2026-05-25-adr129-rvagent-upstream-trace.md`, `2026-05-25-adr130-graph-archivist-trace.md`), three new dispositional ADRs ([[ADR-0254]], [[ADR-0255]], [[ADR-0256]]), and a 15-row INTEGRATION-LEDGER triage commit (`dbea3d8`). Eighteen distinct open items were surfaced across these deliverables; a nineteenth was added during session close-out (comprehensive ledger sweep of rows never audited today).

Per memory `[[feedback-commit-often]]`, leaving these in a session transcript invites loss. Per `[[feedback-update-integration-ledger]]`, the ledger sweep portion specifically must produce row-level changes, not a research summary. This ADR is the tracked backlog, with a phased execution plan that names the canonical `ruflo-swarm:swarm` invocation per batch.

The plan implements per `[[feedback-no-hive-ceremony-for-impl]]`: parallel `Agent`-tool fan-out via the `swarm init` shape that the `ruflo-swarm:swarm` skill wraps, **not** queen-led hive-mind consensus rounds. The cap of 5-6 agents per wave honors the empirical Anthropic-API stability ceiling observed in prior session work.

## Decision Drivers

* **Per `[[feedback-commit-often]]`: capture every open item in a tracked artifact same-day.** Leaving 19 items in a session transcript orphans them.
* **Per `[[feedback-update-integration-ledger]]`: item #19 (ledger sweep of ~55 unaudited rows) must update the ledger, not just produce a research file.**
* **Per `[[feedback-no-hive-ceremony-for-impl]]`: use `Agent`-tool fan-out via `swarm init`; do not invoke `hive-mind_spawn` for implementation batches.** Hives are reserved for high-stakes decision-bearing work.
* **Per `[[feedback-no-time-estimates]]`: every batch describes scope-shape, not duration.**
* **Per `[[feedback-verify-commit-content-vs-message]]`: per-batch file-conflict avoidance is explicit; same-fork parallel commits run with a verify-after-merge step.**
* **Per `[[feedback-commit-forks-before-release]]`: every implementation batch commits forks before any `npm run release` runs.**
* **Per `[[feedback-always-use-the-skill]]`: every batch cites the `ruflo-swarm:swarm` skill (and what canonical invocation it produces), not raw `npx swarm init` impl detail.**
* **Per `[[feedback-skip-accepted-as-squelch]]`: deferred items must name an explicit trigger condition, not "next sync."**

## Considered Options

* **Option A — Single sequential batch.** Walk all 19 items in one long agent chain. Rejected: items #19's 55-row sweep dominates wall-clock and blocks the trivial fixes (items #4, #13). Sequencing also gives up the API parallelism the work invites.
* **Option B — Per-item parallel spawn (19 simultaneous agents).** Rejected: Anthropic 529 errors observed in prior session work cluster around the 5-6 concurrent-agent ceiling. Spawning 19 hits a rate-limit wall.
* **Option C — Four phased batches with 5-6 agents per wave, scoped to file-disjoint surfaces (this ADR).** Trivial wins land first to clear cognitive load; design-ADR implementations land before the long sweep so the sweep can cite their resolved state; the long sweep runs as a single 5-agent parallel wave; a closure agent consolidates ledger updates and pushes.
* **Option D — Two batches: implementation + ledger sweep.** Rejected: combining the design-ADR implementations (items #10, #11) with the ledger sweep (item #19) creates a same-fork commit race (per `[[feedback-verify-commit-content-vs-message]]`). Separation cleanly avoids it.

## Decision Outcome

Chosen: **Option C — Four phased batches with 5-6 agents per wave.**

The four batches are A (trivial + small actionables), B (design-ADR implementations), C (comprehensive ledger sweep), D (closure + push). Phase ordering is causal: A unblocks the latent crash (item #4 + #10), B provides authoritative state that C's sweep cites, C aggregates the largest unaudited surface in one wave, D consolidates everything for a single release/push. Items #12/#14/#15/#16/#17 are deferred with explicit triggers (see §"Out-of-scope (deferred)").

## Backlog table

The 19 items are recorded verbatim from the session-close hand-off, with batch assignment and trigger.

| ID | Item | Severity | Batch | Trigger |
|---|---|---|---|---|
| 1 | [[ADR-0253]] §Evidence "open follow-up" — amend `forks/agentdb/src/archivist/MODULE.md:45-47` footnote to reflect post-`cc879ce` in-lock-commit shape (named in [[ADR-0253]] §Evidence; never done) | LOW | C (E) | Bundled with C-wave ledger sweep |
| 2 | GHIB ledger-enumeration caveat — 3 docs-badge SHAs picked by "best-evidence" from 5 candidates; the other 2 (`4def69f00`, `4a57be7b8`) have no recorded disposition | LOW | C (E) | Bundled with C-wave ledger sweep |
| 3 | Lockstep smoke between top `.claude/skills/` and `v3/@claude-flow/cli/.claude/skills/` to prevent future bidirectional drift (recommended in research-doc amendment; never built) | MEDIUM | B | Lands as Phase B side-task |
| 4 | Pick `87f2a26cd` — agent-browser lockfile drift; one of the Batch S "rerere'd duplicates" hid this | **HIGH** | A | First batch — unblocks ledger correctness |
| 5 | Enumerate Batch S 9-SHA roll-up — line 165 doesn't list the SHAs; they only exist in a vanished background agent transcript | MEDIUM | A | Bundle with batch-A ledger refinements |
| 6 | 5 audit-skip-policy citation refinements — rows 125/312/173 mis-cite [[ADR-0143]]; rows 46/47 should append `+ ADR-0162 Batch A #1` | LOW | A | Bundle with batch-A ledger refinements |
| 7 | 3 audit-version-bumps reasoning corrections — `cffa55744` / `91657b9fc` / `0c2b0c02f` had hidden substance. Skip outcomes still defensible; reasoning needs rewriting | MEDIUM | A | Bundle with batch-A ledger refinements |
| 8 | NAPI count fix — line 309 claims `(52 SHAs)`; actual is 21 | TRIVIAL | A | Bundle with batch-A ledger refinements |
| 9 | 5 ADR-126 superseded-by-adr rows — never spot-checked whether [[ADR-0248]]/[[ADR-0251]] cover the same surface | MEDIUM | C (D) | Bundled with C-wave's superseded-by-adr researcher |
| 10 | [[ADR-0255]] Phase 1 implementation — closes a latent crash (fork's `memory export` CLI command calls a missing MCP tool today) | **HIGH** | B | First batch-B agent — latent crash fix |
| 11 | [[ADR-0256]] Phase 4 Option A implementation — helpers + smoke (4 files, ~160 lines) | MEDIUM | B | Second batch-B agent — pilot land |
| 12 | 2 remaining [[ADR-0254]] Phase 1-3 design questions — persistence-threading for 16 new MCP tools; `SAFE_MCP_TOOLS` allowlist audit against fork's MCP registry | MEDIUM | DEFERRED | Trigger: external pressure to land [[ADR-0254]] Phases 1-3 (no organic reason today) |
| 13 | `loadRvf` typo at `optional-modules.d.ts:295` — declares `loadRvf(data: Uint8Array): boolean`; actual is `loadRvf(id: string): Uint8Array` | TRIVIAL | A | First batch-A agent — TS-level correctness |
| 14 | [[ADR-0202]] lint scope extension — `scripts/lint-no-daemon-lock-cache.mjs` hard-targets `worker-daemon.ts` only; doesn't enforce no-module-scope-cache for other files | MEDIUM | DEFERRED | Trigger: a second module-scope-cache violation found OR ADR-0202 follow-up cited |
| 15 | `--force` auto-detection in `scripts/ruflo-publish.sh` — initial release today hit `feedback-pipeline-shared-skip-on-dist-clear`; recovered via manual `--force` rerun | LOW | DEFERRED | Trigger: same failure mode hits a second time (then becomes a pattern, not anecdote) |
| 16 | 17 violations in `smoke-init-bundle-invariants.mjs` — 5 parser-regex bugs + 12 [[ADR-0128]] plugin-agent basename collisions | MEDIUM | DEFERRED | Trigger: a plugin-agent basename causes user-visible behavior bug OR the smoke is repurposed as a release gate |
| 17 | 388 pre-existing TS errors in fork — `plugins/prime-radiant/`, other outside-cli paths | LOW | DEFERRED | Trigger: a TS error in those paths blocks a release OR fork's CI extends to those dirs |
| 18 | Push final state — 7 unpushed ruflo-patch commits + 4 unpushed forks/ruflo commits since the last push earlier today | TRIVIAL | D | Batch D closure step |
| 19 | Comprehensive ledger sweep of non-audited rows — 46 `superseded-by-local` + 6 `superseded-by-adr` + 4 `retargeted` = ~56 rows where "the equivalence claim was true when the row was written" has never been re-verified | **HIGH** | C | Largest unaudited slice — batch-C is dedicated to this |

**Item count: 19** — confirms session hand-off enumeration.

## Execution plan

Per `[[feedback-always-use-the-skill]]`: every batch invokes the `ruflo-swarm:swarm` skill. The skill wraps the canonical `swarm init` invocation; the literal command form is shown inline for traceability.

Per memory `[[feedback-verify-commit-content-vs-message]]`: every batch that produces parallel commits on the same fork concludes with a `git status --short` + sampled `git show --stat <head>~N..HEAD` verify step before any `npm run release` runs. The verify catches `git add` races that swap diffs between commits.

Per `[[feedback-no-hive-ceremony-for-impl]]`: every batch uses `Agent`-tool fan-out via `swarm init`. No `hive-mind_spawn`.

### Batch A — Trivial + small actionables (3 agents in parallel)

**Skill invocation**: `ruflo-swarm:swarm` (canonical form: `npx @sparkleideas/cli@latest swarm init --topology hierarchical --max-agents 3 --strategy specialized`).

**Why hierarchical at 3 agents**: tasks are file-disjoint (one TS typo fix, one cherry-pick of one SHA, one bundled ledger-text refinement); hierarchical topology gives a clean fan-out without the cross-agent coordination overhead a mesh would introduce. Strategy `specialized` matches the heterogeneous agent types (coder for TS, picker for cherry-pick, doc-editor for ledger refinements).

| Agent | Type | Item(s) | Files touched |
|---|---|---|---|
| A-1 | coder | #13 — `loadRvf` typo fix in `optional-modules.d.ts:295` | `forks/ruflo/v3/@claude-flow/cli/src/types/optional-modules.d.ts` (1-line signature fix) |
| A-2 | coder (cherry-picker) | #4 — pick `87f2a26cd` for agent-browser lockfile drift | `forks/ruflo/<files-from-87f2a26cd>` (per `git show 87f2a26cd --stat` against ruvnet/ruflo) |
| A-3 | doc-editor | Bundled #5, #6, #7, #8 — ledger text refinements | `docs/upstream/INTEGRATION-LEDGER.md` (multiple row updates) + 3 audit-file reasoning corrections in `docs/audits/2026-05-25-ledger-skip-by-policy-audit.md`, `docs/audits/2026-05-25-ledger-version-bumps-audit.md`, `docs/audits/2026-05-25-ledger-napi-regens-audit.md` |

**File-conflict avoidance**: A-1 touches only `forks/ruflo` types; A-2 touches only files in upstream `87f2a26cd`'s scope; A-3 touches only `ruflo-patch/docs/`. **Zero file-overlap between agents.**

**Commit discipline**:
* A-1 commits in `forks/ruflo` on `main` (per `[[feedback-trunk-only-fork-development]]`); commit message cites this ADR + item #13.
* A-2 commits in `forks/ruflo` on `main` with `git cherry-pick -x 87f2a26cd` so the trailer stays greppable (per `[[feedback-update-integration-ledger]]`).
* A-3 commits in `ruflo-patch` on `main`; commit message cites this ADR + items #5/#6/#7/#8.
* **Same-fork race check**: A-1 + A-2 both commit in `forks/ruflo`. After both finish, run `git -C /Users/henrik/source/forks/ruflo log --oneline -5` and `git -C /Users/henrik/source/forks/ruflo show --stat HEAD~1..HEAD` to verify each commit's diff matches its message (per `[[feedback-verify-commit-content-vs-message]]`).
* No `npm run release` in batch A. Releases happen only in batch D.

**Done when**: 3 commits exist (2 in `forks/ruflo`, 1 in `ruflo-patch`); `git status --short` is empty in both repos; the post-batch verify confirms diffs match messages.

### Batch B — Design ADR implementations (2 agents in parallel + 1 side-task)

**Skill invocation**: `ruflo-swarm:swarm` (canonical form: `npx @sparkleideas/cli@latest swarm init --topology hierarchical --max-agents 3 --strategy specialized`).

**Why 3 agents at hierarchical**: B-1 ([[ADR-0255]] Phase 1) and B-2 ([[ADR-0256]] Phase 4) are file-disjoint and both target `forks/ruflo`. B-3 (item #3, lockstep smoke) is doc + smoke-script work in `ruflo-patch` and one new file in `forks/ruflo/scripts/`. A 3-agent hierarchical fan-out lets all three run simultaneously without mesh-coordination overhead.

| Agent | Type | Item(s) | Files touched |
|---|---|---|---|
| B-1 | coder | #10 — [[ADR-0255]] Phase 1 (fork-native `memory_export` MCP tool) | `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/memory-tools.ts` (add `memory_export` tool ~50 lines); optional smoke `forks/ruflo/scripts/smoke-memory-export.mjs` |
| B-2 | coder | #11 — [[ADR-0256]] Phase 4 Option A (plugin-bridge helpers + smoke) | `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/wasm-agent-tools.ts` (+~40 lines), `forks/ruflo/scripts/smoke-wasm-plugin-bridge.mjs` (new, 118 lines), `forks/ruflo/.github/workflows/v3-ci.yml` (+job stanza), `ruflo-patch/docs/upstream/INTEGRATION-LEDGER.md` (+1 row) |
| B-3 | coder | #3 — lockstep smoke for `.claude/skills/` drift | New: `forks/ruflo/scripts/smoke-skills-lockstep.mjs` (compares top `.claude/skills/` vs `v3/@claude-flow/cli/.claude/skills/`); `forks/ruflo/.github/workflows/v3-ci.yml` (+job stanza, edit only — shared with B-2; see conflict note below) |

**File-conflict avoidance**:
* B-1 touches `memory-tools.ts` only; B-2 touches `wasm-agent-tools.ts` only — **disjoint MCP-tool source files**.
* B-2 and B-3 **both edit** `forks/ruflo/.github/workflows/v3-ci.yml` (each adds a job stanza). To avoid `git add` race per `[[feedback-verify-commit-content-vs-message]]`, B-3 waits for B-2's commit before opening the file (the swarm orchestrator's coordination layer serializes this), or alternatively B-2 and B-3 are run as sequential sub-stages within a single agent's plan. **Recommended: serialize within B-3's plan** — B-3 reads the post-B-2 state of `v3-ci.yml` before adding its own stanza.
* B-2 also touches `ruflo-patch/docs/upstream/INTEGRATION-LEDGER.md` (adding 1 row for the cherry-pick provenance per [[ADR-0256]] Step 4). Batch C will also touch this file; batch D's consolidation handles that — B-2's row is appended first.

**Commit discipline**:
* B-1 commits in `forks/ruflo` citing [[ADR-0255]] Phase 1 + this ADR's item #10.
* B-2 commits in `forks/ruflo` citing [[ADR-0256]] + this ADR's item #11; separately commits `INTEGRATION-LEDGER.md` row in `ruflo-patch` citing same.
* B-3 commits in `forks/ruflo` after B-2's `v3-ci.yml` lands (or amends the ledger PR appropriately).
* **Same-fork race check**: after all 3 finish, `git -C /Users/henrik/source/forks/ruflo log --oneline -5` + sample 3 `git show --stat` calls to verify diffs match messages.
* No `npm run release` in batch B; that runs only in batch D.

**Done when**: 3+ commits in `forks/ruflo` (one per agent), 1+ commit in `ruflo-patch` (B-2's ledger row); `git status --short` empty in both; verify confirms diffs match messages; B-1's `memory_export` smoke passes; B-2's `smoke-wasm-plugin-bridge.mjs` exits 0 with 5 PASS + 2 SKIP per [[ADR-0256]] Step 2; B-3's lockstep smoke exits 0 (no drift between skill trees).

### Batch C — Comprehensive ledger sweep (5 agents in parallel + 1 consolidator)

**Skill invocation**: `ruflo-swarm:swarm` (canonical form: `npx @sparkleideas/cli@latest swarm init --topology mesh --max-agents 5 --strategy adaptive`).

**Why mesh at 5 agents**: the 5 sub-sweeps share a single output target (`docs/upstream/INTEGRATION-LEDGER.md` row updates) consolidated by a follow-on coder. Mesh topology lets the 5 researchers cross-check each other's findings if they discover an item another researcher's slice also touches (e.g., a `superseded-by-local` row that turns out to be covered by an ADR that another researcher's `superseded-by-adr` slice tracks). `adaptive` strategy lets agents shift slice boundaries if they discover their assigned range is uneven in difficulty.

| Agent | Type | Slice | Output |
|---|---|---|---|
| C-A | researcher | 15 oldest `superseded-by-local` rows | `docs/audits/2026-05-25-ledger-superseded-by-local-slice-A.md` (each row: SHA, claimed-equivalent ADR or local change, verification verdict) |
| C-B | researcher | 15 middle `superseded-by-local` rows (rows 16-30) | `docs/audits/2026-05-25-ledger-superseded-by-local-slice-B.md` |
| C-C | researcher | 16 newest `superseded-by-local` rows (rows 31-46) | `docs/audits/2026-05-25-ledger-superseded-by-local-slice-C.md` |
| C-D | researcher | 6 `superseded-by-adr` rows (incl. the 5 ADR-126 rows from item #9 + 1 other) | `docs/audits/2026-05-25-ledger-superseded-by-adr.md` (per row: target ADR cited, does that ADR's §Decision actually cover the upstream commit's surface) |
| C-E | researcher | 4 `retargeted` rows (agentic-flow→agentdb era pivots from [[ADR-0161]]) + items #1, #2, #16 (note: #16 is DEFERRED but C-E doc-only verifies the audit-row provenance), and the [[ADR-0253]] §Evidence footnote amendment for item #1, and the GHIB enumeration caveat for item #2 | `docs/audits/2026-05-25-ledger-retargeted-and-trim.md` + edit to `forks/agentdb/src/archivist/MODULE.md:45-47` for item #1 + ledger note for item #2 |
| C-consolidator | coder (runs **after** C-A through C-E complete) | Read the 5 audit files; apply consolidated ledger row updates to `docs/upstream/INTEGRATION-LEDGER.md` | Single commit on `ruflo-patch/main` containing all ledger row updates from batch C |

**File-conflict avoidance**:
* C-A through C-E **each write their own audit file** — no shared output during the parallel phase. **Zero file-overlap during fan-out.**
* C-E touches `forks/agentdb/src/archivist/MODULE.md` (item #1 footnote amendment) — disjoint from all other agents.
* All ledger row updates are batched into a single commit by C-consolidator, **not** appended by each researcher. This avoids the `git add` race that fan-out commits to the same file would create per `[[feedback-verify-commit-content-vs-message]]`.

**Commit discipline**:
* C-A through C-E each commit only their own audit file in `ruflo-patch` (no ledger edits). 5 commits, each on its own file path — no race.
* C-E additionally commits the `forks/agentdb` footnote amendment in `forks/agentdb` (its own commit, separate from the audit-file commit per `[[feedback-trunk-only-fork-development]]`).
* C-consolidator runs **strictly after** C-A through C-E finish (the swarm orchestrator gates this — `topology mesh` does not mean unordered; mesh permits cross-talk during the fan-out but the consolidator dependency is explicit in the agent plan).
* C-consolidator's single ledger commit cites: this ADR + items #1, #2, #9, #19.
* **Race check after C fan-out**: `git -C /Users/henrik/source/ruflo-patch status --short` confirms only the 5 audit files exist as new + the agentdb footnote commit landed in `forks/agentdb`. C-consolidator then writes its ledger edits + commits. Final check: `git -C /Users/henrik/source/ruflo-patch log --oneline -10` shows researcher commits then consolidator commit.
* No `npm run release` in batch C.

**Done when**: 5 audit files exist in `docs/audits/`; 1 footnote amendment commit in `forks/agentdb`; 1 consolidated ledger commit in `ruflo-patch`; the consolidated ledger commit's row updates align with each of the 5 audit files' findings (spot-verify 3 random row updates against the audit-file's source row); `git status --short` empty in both repos.

### Batch D — Closure (2 agents sequential)

**Skill invocation**: `ruflo-swarm:swarm` (canonical form: `npx @sparkleideas/cli@latest swarm init --topology hierarchical --max-agents 2 --strategy sequential`).

**Why hierarchical at 2 agents sequential**: D-1's release validation must complete before D-2's push. `sequential` strategy enforces the ordering; hierarchical topology gives a clean parent→child relationship between releaser and pusher.

| Agent | Type | Item(s) | Action |
|---|---|---|---|
| D-1 | release-validator | All preceding batch outputs | `npm run release` (or `bash scripts/ruflo-publish.sh` per `[[reference-pipeline-publish-paths]]`); if `feedback-pipeline-shared-skip-on-dist-clear` fires, rerun with `--force` per `[[feedback-pipeline-shared-skip-on-dist-clear]]`. Confirm GREEN. |
| D-2 | pusher | #18 — push 7 unpushed `ruflo-patch` commits + 4 unpushed `forks/ruflo` commits + 1 `forks/agentdb` footnote commit + any additional commits from batches A-C | `git -C /Users/henrik/source/ruflo-patch push sparkling main`; `git -C /Users/henrik/source/forks/ruflo push sparkling main`; `git -C /Users/henrik/source/forks/agentdb push sparkling main` (per `[[feedback-fork-workflow]]` push target). **NEVER push to `origin` (ruvnet read-only) and NEVER push to `hz` (per `[[feedback-never-touch-hz-remote]]`).** |

**File-conflict avoidance**: D-1 and D-2 are sequential. **Zero parallelism — zero conflict surface.**

**Commit discipline**:
* D-1 does NOT commit. The release pipeline auto-commits version bumps per `[[feedback-build-scripts-only]]`; D-1 verifies that the bump commit lands and the dist tags update on Verdaccio.
* D-2 does NOT commit; only pushes.
* Per `[[feedback-commit-forks-before-release]]`: batches A, B, C must all have committed their fork state **before** D-1 runs. The release rebuilds forks from committed state; uncommitted fork edits silently discarded.

**Done when**: Verdaccio shows the new `cli@latest` and `ruflo@latest` versions; `git -C ... log --oneline @{u}..HEAD` returns empty for all 3 repos (everything pushed); the release pipeline's acceptance gate is GREEN.

## Agent count summary

| Batch | Parallel agents | Sequential agents | Total agents this batch |
|---|---|---|---|
| A | 3 | 0 | 3 |
| B | 3 | 0 | 3 |
| C | 5 | 1 (consolidator) | 6 |
| D | 0 | 2 | 2 |
| **Total** | **11 parallel max** | **3 sequential** | **14** |

The peak concurrent-agent count is **5** (batch C's fan-out), well under the empirical Anthropic API 529 ceiling of 5-6 observed in prior sessions.

## Out-of-scope (deferred)

Per `[[feedback-skip-accepted-as-squelch]]`: each deferred item has an explicit trigger condition, not "next sync."

| ID | Item | Trigger to re-prioritize |
|---|---|---|
| 12 | [[ADR-0254]] Phase 1-3 persistence threading + `SAFE_MCP_TOOLS` allowlist audit | External pressure to land Phases 1-3 of ADR-129 (e.g., user request, upstream council vote, plugin author depending on a Phase 1-3 surface). No organic reason today — Phase 4 (this session) is the unblocked pilot. |
| 14 | [[ADR-0202]] lint extension to other files | A second module-scope-cache violation surfaces in code review or audit OR ADR-0202 follow-up referenced in a new ADR. Today's `worker-daemon.ts` scoping is sufficient for the one known case. |
| 15 | `--force` auto-detection in `scripts/ruflo-publish.sh` | The `feedback-pipeline-shared-skip-on-dist-clear` failure mode hits a second time in a release. One occurrence is anecdote; two is a pattern worth automating around. |
| 16 | 17 violations in `smoke-init-bundle-invariants.mjs` (5 parser-regex + 12 plugin-agent basename collisions) | Either: (a) a plugin-agent basename collision causes a user-visible behavior bug, OR (b) the smoke is repurposed as a release gate (forcing it to pass). Today the smoke runs but the violations are documented-pre-existing. |
| 17 | 388 pre-existing TS errors in `plugins/prime-radiant/` and other outside-cli paths | Either: (a) a TS error in those paths blocks a release in the future, OR (b) fork CI extends to cover those directories. Today they're outside the CI scope and outside the v3 CLI build path. |

## Risks

Per `[[feedback-no-fallbacks]]`: only risks grounded in actual surface analysis, not speculation.

| Risk | Source | Mitigation |
|---|---|---|
| Anthropic API 529 rate-limit at >5 concurrent agents | Empirical observation in prior session work | Cap each batch at 5 parallel agents. Batch C's 5-agent fan-out is the ceiling. Sequential consolidator (C-consolidator, D-1, D-2) does not contribute to the concurrent count. |
| Same-fork `git add` race in batches A/B/C creating commits with swapped diffs | Memory `[[feedback-verify-commit-content-vs-message]]` (observed cost-and-recovered in prior session) | Each batch ends with explicit verify step: `git log --oneline -N` + sampled `git show --stat HEAD~M..HEAD`. Same-fork-parallel-commit scenarios (batch A's A-1+A-2 in `forks/ruflo`; batch B's B-1+B-2+B-3 in `forks/ruflo`) named explicitly with verify gates. |
| Lint blocker reaches release gate from batch A/B (e.g., today's `b5d12dc93`-style catch issue) | Today's release sequence: picks-implementer commits `b5d12dc93`; the `undiscriminating-catches` lint phase aborted Phase 3 acceptance until manually fixed | Batch B's smoke validation (B-1's memory-export smoke, B-2's plugin-bridge smoke, B-3's lockstep smoke) is run locally before D-1. Batch A's coder agents run `npm run lint` (or the targeted ADR-0202 lint per `[[ADR-0202]]`) locally before committing. D-1's release pipeline still runs the full lint as the final gate. |
| Batch C consolidator's single ledger commit silently drops a row update | Manual aggregation step; no automated diff between researcher findings and consolidator output | Spot-verify 3 random row updates after C-consolidator commits: pick a random SHA from each of the 5 audit files, confirm the corresponding ledger row reflects the audit's verdict. |
| Batch D push fails on `sparkling` remote (network, auth, force-push protection) | Generic risk; remote is sparkling-only per `[[feedback-fork-workflow]]` and `[[feedback-never-touch-hz-remote]]` | D-2 reports push failures explicitly; never falls back to `origin` (ruvnet read-only) or `hz` (migrated-away). User intervention required if `sparkling` is unreachable. |

## Cross-references

* [[ADR-0254]] — Upstream ADR-129 + ADR-130 integration disposition (council 2026-05-25). Names Phase 4 as the unblocked pilot; the three gating questions for Phases 1-3 surface in item #12.
* [[ADR-0255]] — Fork-native `memory_export` capability. Phase 1 implementation is item #10.
* [[ADR-0256]] — ADR-129 Phase 4 plugin-bridge implementation plan. Option A implementation is item #11.
* [[ADR-0253]] — FS-JSON staging carve-out. §Evidence footnote amendment is item #1.
* [[ADR-0177]] — RVF-primary substrate restoration. Cited by [[ADR-0255]] §Decision 2.
* [[ADR-0181]] — Archivist seam discipline. Cited by [[ADR-0255]] §Decision 2 + [[ADR-0254]] §Drivers.
* [[ADR-0202]] — Lint for no-module-scope-cache. Item #14 is the scope-extension follow-up.
* [[ADR-0246]] — Mutation-invariants. Cited by [[ADR-0255]] §Drivers + [[ADR-0254]] §Drivers.
* [[ADR-0143]] — Brand naming (root + ruflo README skip). Cited (correctly or incorrectly) in items #5, #6.
* [[ADR-0162]] — Batch A #1 (skip-by-policy citation). Cited in item #6.
* [[ADR-0161]] — agentdb consolidation (retargeted rows). Cited in item #19 batch C-E slice.
* [[ADR-0128]] — Plugin-agent naming. Cited in item #16.
* `docs/audits/2026-05-25-picks-validation.md` — picks-implementer validation report (lint blocker from `b5d12dc93`).
* `docs/audits/2026-05-25-skip-accepted-audit.md` — skip-accepted audit.
* `docs/audits/2026-05-25-adr0254-devils-advocate.md` — DA critique of ADR-0254.
* `docs/audits/2026-05-25-ledger-deferred-spot-check.md` — re-verified deferred + reverted ledger rows (item #7 source).
* `docs/audits/2026-05-25-ledger-misc-mech-audit.md` — skip-mechanical + reverted ledger rows audit.
* `docs/audits/2026-05-25-ledger-napi-regens-audit.md` — Batch N 52→21 NAPI count audit (item #8 source).
* `docs/audits/2026-05-25-ledger-pending-audit.md` — 14 pending-rows per-SHA audit.
* `docs/audits/2026-05-25-ledger-skip-by-policy-audit.md` — 6 skip-by-policy anchors audit (item #6 source).
* `docs/audits/2026-05-25-ledger-version-bumps-audit.md` — Batch J/M/N version-bump roll-ups audit (item #7 source).
* `docs/research/2026-05-25-adr129-rvagent-upstream-trace.md` — R-A's rvagent surface map.
* `docs/research/2026-05-25-adr130-graph-archivist-trace.md` — R-B's graph-edge-writer DEFER analysis.
* `docs/upstream/INTEGRATION-LEDGER.md` — the corpus batch C sweeps over (~56 rows: 46 superseded-by-local + 6 superseded-by-adr + 4 retargeted).
* Memory `[[feedback-no-hive-ceremony-for-impl]]` — informs the swarm-vs-hive choice.
* Memory `[[feedback-verify-commit-content-vs-message]]` — informs the per-batch verify steps.
* Memory `[[feedback-commit-forks-before-release]]` — informs the batch-D placement after A/B/C.
* Memory `[[feedback-update-integration-ledger]]` — informs C-consolidator's role and the batch-B-2 ledger row.
* Memory `[[feedback-trunk-only-fork-development]]` — informs the `main`-only commit + push targets.
* Memory `[[feedback-fork-workflow]]` — informs the `sparkling` push target.
* Memory `[[feedback-never-touch-hz-remote]]` — informs the explicit `hz` exclusion in batch D.
* Memory `[[feedback-skip-accepted-as-squelch]]` — informs the per-deferred-item triggers.
* Memory `[[feedback-always-use-the-skill]]` — informs the `ruflo-swarm:swarm` citation per batch.
* Memory `[[feedback-no-fallbacks]]` — informs the §Risks list (only real risks, not speculative).
* Memory `[[feedback-no-time-estimates]]` — informs the absence of timeline anywhere.
* Memory `[[feedback-build-scripts-only]]` — informs D-1's release invocation choice.
* Memory `[[reference-pipeline-publish-paths]]` — informs D-1's `npm run release` / `make release` / `bash scripts/ruflo-publish.sh` choice.
* Memory `[[feedback-pipeline-shared-skip-on-dist-clear]]` — informs the D-1 `--force` retry path.

## Confirmation

1. All 19 session items are recorded in §"Backlog table" with batch assignment.
2. The 4-batch plan in §"Execution plan" cites `ruflo-swarm:swarm` per batch with the canonical `swarm init` form, agent count, agent types, file-conflict avoidance, and commit discipline.
3. The 5 deferred items in §"Out-of-scope (deferred)" each have an explicit trigger condition, not "next sync."
4. If batches A-D execute as planned, this ADR's status flips from `proposed` to `implemented` once D-2 confirms the push.
5. If any item shifts to a different batch during execution (e.g., A-3's ledger refinements turn out to need a full batch-C-style sub-research), the implementing commit cites this ADR and the §"Backlog table" row is amended in a same-commit edit (per `[[feedback-update-integration-ledger]]`-style row honesty).
6. If a deferred item's trigger fires before execution starts, the item is promoted into an in-scope batch (likely B or a new batch E) via a same-day ADR amendment.

## More Information

* `ruflo-swarm:swarm` skill — the canonical entry point each batch invokes. The skill wraps `npx @sparkleideas/cli@latest swarm init --topology <T> --max-agents <N> --strategy <S>` and handles agent spawning, coordination, and the `Agent`-tool fan-out per `[[feedback-no-hive-ceremony-for-impl]]`.
* `mcp__ruflo__swarm_init` — the underlying MCP tool the skill delegates to (loaded via `ToolSearch("ruflo swarm")` per CLAUDE.md §"MCP Tools (Deferred)").
* `mcp__ruflo__agent_spawn` — the per-agent spawn tool the swarm orchestrator uses.
* `mcp__ruflo__memory_store` — used by researchers in batch C to persist findings to ReasoningBank (per `[[feedback-update-integration-ledger]]` for cross-session memory).
* The 19 items came from the 2026-05-25 session close-out; provenance traced in §"Cross-references."

## Handover state — 2026-05-25 end-of-session

### Closed during the session (16 of 19 original items)

| ID | Item | Closing commit / artefact |
|---|---|---|
| #1 | ADR-0253 §Evidence MODULE.md footnote | `bff2c97` (forks/agentdb) |
| #2 | GHIB 2-of-5 docs-badge outliers | `df739f6` (audit) — `4def69f00` → skip-by-policy, `4a57be7b8` → pending |
| #3 | Lockstep skills smoke | `56f925c67` (forks/ruflo) — smoke + 5-dir sync, then `1e3a44d68` corrective revert |
| #5 | Batch S 9-SHA partial enumeration | `be4e107` — 5 of 9 enumerated; **4 remain anonymous** |
| #6 | 5 anchor citation refinements | `be4e107` |
| #7 | 3 version-bump reasoning corrections | `be4e107` (rows split + reasoning rewritten) |
| #8 | NAPI count fix (52 → 21) | `be4e107` |
| #9 | 5 ADR-126 superseded-by-adr rows audit | `eb59caa` + `1e0699c` (re-classified as `superseded-by-adr (partial)`) |
| #10 | ADR-0255 Phase 1 memory_export MCP tool | `adb91ab3d` (forks/ruflo) |
| #11 | ADR-0256 Phase 4 Option A helpers + smoke | `818091545` (forks/ruflo) + `f93523f5c` (ledger row) |
| #12 | ADR-129 Phases 1-3 design questions | ADR-0258 (`a172b71`) + ADR-0259 (`f2b13e2`) |
| #13 | `loadRvf` typo | `0fc2fbb07` (forks/ruflo) |
| #14 | ADR-0202 lint scope extension | `2dd1d1c` |
| #15 | `--force` auto-detection in publish script | `e91a193` |
| #16 | smoke-init-bundle-invariants 17 violations | `cfc6ebca5` (forks/ruflo) |
| #17 | prime-radiant TS errors → ADR-0260 | `69a184d` + `f580f7ec0` (forks/ruflo) |

### Closed in follow-up session (2026-05-25, same-day)

| ID | Item | Closing commit / artefact |
|---|---|---|
| HIGH | ADR-126 Phase 1 namespace fix | `7558f967b` (forks/ruflo) — `git cherry-pick -x 8d9e20f0c`; 2 conflicts resolved (ADR-0001 §"Implementation status" from incoming; `trader-train/SKILL.md` namespace fix from incoming, fork-local `mcp__ruflo__` prefix preserved per ADR-0143). `smoke.sh` step 8 PASSes. Ledger row 168 + appended supersession row capture provenance. |
| LOW #1 | `--with-embedding` singular alias | `9fd76635d` (forks/ruflo) — `init.ts` declares `with-embedding` option + action handler reads both forms. |
| LOW #2 | Init banner agent-count "89 vs 30" | SKIP — verified not a bug. Banner uses dynamic `result.summary.agentsCount` (counts `.md` files); `FULL_INIT_OPTIONS.agents.all=true` installs all categories. Audit's "30" likely counted subdirectories, not `.md` files. |
| LOW #3 | `memory store` `undefined/<key>` log | `e8f10fa7d` (forks/ruflo) — applied `\|\| 'default'` guard in `storeCommand` matching `deleteCommand` pattern. |
| LOW #4 + #6 | `memory_stats` backend label + populate `totalSize`/`location` | `999346808` (forks/ruflo) — backend `SQLite + HNSW`→`RVF + HNSW` (post-ADR-0177); `statSync` of `.swarm/memory.rvf` populates totalSize + location. |
| LOW #5 | HNSW Index "not active" | SKIP — diagnostic only, may be legitimate with <32 entries. |
| LOW | `statusline-hook.sh` init regression | `ea26d9029` (forks/ruflo) — `executor.ts:writeHelpers()` now writes `statusline.cjs` + `statusline-hook.sh` when `options.components.statusline` is enabled (mirrors `helpers-generator.ts:1489-1492`). |
| LOW | Plan #3 main body `memory init` reference | `(ruflo-patch commit, this batch)` — added explicit Step 0 to invoke `memory init` for substrate-boot before the Step 5 verifies; Step 2 verify retitled to reference Step 5's `memory init`. |

### ADR-129 Phases 1-3 — DEFERRED with concrete trigger pointing at ADR-0258 + ADR-0259 (2026-05-25 follow-up)

User-pressure trigger from item #12 fired ("go through deferred one by one"). Attempted verbatim cherry-pick of `47a7825b0` and aborted at first conflict — confirmed via direct file inspection that the fork's `wasm-agent-tools.ts` carries an architecturally distinct cross-process persistence layer (`<projectRoot>/.claude-flow/wasm-agents/store.json` + `withStoreLock` + `snapshotAgent` + `ensureLive`) that upstream's PR has no awareness of. Verbatim adoption would regress the cross-process state model.

Two existing ADRs already document the required reconciliation:

- **ADR-0258** (proposed): persistence-threading decisions for the 16 new MCP tools — must thread each through fork's `withStoreLock` pattern OR document a carve-out before the tool ships
- **ADR-0259** (proposed): SAFE_MCP_TOOLS allowlist alignment — upstream's 30-name allowlist uses underscored naming that doesn't match fork's hyphen convention (`hooks_post-task` vs upstream's `hooks_post_task`); also includes tools fork doesn't have AND misses fork-only tools

**Concrete trigger** (corrects ADR-0257 #12's "external pressure" framing): ADR-0258 AND ADR-0259 must both flip from `proposed` → `accepted` (with implementation completed) before ADR-129 Phases 1-3 can land. The pick is gated on those two ADRs reaching `implemented` status, not on user pressure alone — the pressure surfaced the architecture work, which now sits in two named ADRs.

In-session methodology note: my initial ELI15 brief framed Phases 1-3 as "a cherry-pick once design questions are answered." That was wrong: upstream answered the design questions (chose ephemeral for compose; SAFE_MCP_TOOLS exists at line 41), but the fork has a distinct architecture that needs its OWN design decision to reconcile. ADR-0258 + ADR-0259 are exactly that decision; they just hadn't been implemented yet. Caught via abort-and-inspect; documented here.

### MEDIUM-priority — RESOLVED 2026-05-25 (user accepted all 4)

All 4 ADR-126 partial-supersedes picked as cherry-picks with brand-flip + smoke updates:

- Phase 2 (`d9bd4e6ad`) → `f39268978` — ADR-125 memory lifecycle (TTL on signals, dedup on backtests, `memory_delete` in allowed-tools)
- Phase 3 (`9c075a3c3`) → `8464156a1` — Sublinear CG portfolio adapter + new `trader-portfolio-cg/` skill (1163 lines)
- Phase 4 (`48cb0a7ee`) → `4f686f68d` — Ed25519-signed backtest artifacts + new `src/signed-artifact.*` (679 lines; also added trader-cloud-backtest as side effect of Phase 4's add/add conflict — ADR-117 cloud-backtest skill now in fork)
- Phase 6 (`11c1ad974`) → `136d82183` — PageRank feature attribution + new `trader-explain/` skill + `src/signed-attribution.*` (1400 lines)

Smoke post-picks: 9 PASS / 2 FAIL (the 2 failures are pre-existing fork drift — plugin version 0.2.0 vs fork's 0.2.20, `@claude-flow/cli` v3.6 README pin vs fork's `@sparkleideas/cli`; both unrelated to ADR-126 phases).

Plugin now has 9 skills (was 6 + trader-portfolio-cg added in Phase 3 + trader-cloud-backtest added by Phase 4 side effect + trader-explain added in Phase 6). Smoke `step 2` updated to reflect.

### Deferred with explicit trigger condition (not "next sync")

| Item | Trigger to unblock | Status (2026-05-25 follow-up) |
|---|---|---|
| **#4 `87f2a26cd` agent-browser lockfile pick** | Was: fix v3/ pnpm-workspace specifier resolution, then re-attempt. | **RESOLVED — skip-by-policy.** 2026-05-25 follow-up traced the build pipeline: `scripts/codemod.mjs:98` declares `DELETE_FILES = new Set(['pnpm-lock.yaml'])` — the build pipeline DELETES the lockfile in the codemod phase and uses `npm install` with explicit deps. The "drift" between v3/pnpm-lock.yaml and v3/@claude-flow/browser/package.json has no functional surface in the fork. The pick (and the 8 other ADR-122 lockfile commits) is structurally inapplicable. The toolchain "fix" was the wrong question — we don't use the toolchain piece that drift would affect. Companion dev-tooling commit `6ec57ef5a` (v3/.npmrc with link-workspace-packages=true) makes pnpm install work for editor / dev-time experimentation, not for release. |
| **4 unenumerated Batch S SHAs** (ledger row 165) | Recovery of background agent transcript `task abe01952896821c2a` OR re-derivation from upstream commit log filtered by `cherry picked from commit` trailers. The 5 enumerated (`87f2a26cd` `338f7320a` `62aa08f49` `cc007d952` `0ddf1dfa4`) leave 4 unaccounted. | **PARTIAL** — 6th candidate identified by upstream-window grep: `9b4ce6d99` "chore(deps): #2046 refresh v3/pnpm-lock.yaml for agentic-flow 2.0.3→2.0.11" (same lockfile-family shape). 3 SHAs remain unrecoverable without the background agent transcript. |
| **Migration plan §Risks #1**: `.claude/projects/-Users-henrik-source-hm-semantic-modelling/project-constraints.md` | Trace its writer (not init's surface). If found a writer in current code, classify (active); if not, preserve as historical. | **RESOLVED — HISTORICAL.** `grep -rn "project-constraints\.md" v3/@claude-flow/{cli,memory,hooks}/src/` returns 0 writers. Classify historical; eligible for deletion. |
| **Migration plan §Risks #3**: 10 historic `.claude-flow/sessions/session-*.json` + `undefined.json` | Confirm no session-history reader exists in CLI source. If confirmed, classify as historical-unread (eligible for deletion). The `undefined.json` filename suggests a past writer bug. | **RESOLVED — HISTORICAL-UNREAD.** `grep -rn ".claude-flow/sessions" v3/@claude-flow/cli/src/` returns only `vault.ts:30` (comment prose), `executor.ts:196` (creates empty dir), `init.ts:418` (banner). No code path reads or writes session-*.json. Classify historical-unread; eligible for deletion. |
| **Migration plan §Risks #4**: `~/.claude/projects/-Users-henrik-source-hm-main2-semantic-modelling/memory/` symlink | The "main2" path no longer corresponds to active project root. Under `memory_import_claude --allProjects` the 15 files DO get imported (deduped by content hash against the current 88). Trigger: decision on whether to delete the symlink (would prevent the dedup-into-current-store flow) OR retain for cross-history searchability. | **OPERATOR DECISION** — analysis: target exists with 15 files; dedup is content-hash safe (no data corruption). No technical default. Retain = cross-history searchability; delete = main2 ingestion stops. User call. |
| **5 "stale-investigate" files preserved in semantic-modelling earlier audit** | Per-file resolution: `.claude-flow/config.yaml` (ADR-0069 fallback), `.claude/helpers/{hook-handler.cjs, package.json, README.md, statusline-hook.sh}`. | **RESOLVED.** 4 of 5 already deleted between audits (the 4 helpers — likely manual cleanup); only `.claude-flow/config.yaml` remains, classified KEEP per ADR-0069 fallback. |

### Skipped by policy — not coming in (recorded for the no-resurrection rule)

| Item | Policy anchor |
|---|---|
| **Upstream ADR-130 graph intelligence backend** | ADR-0254 §Decision: `defer` with `re-implement-when-revisited` + 7-item re-implementation criteria (must route via `staging-substrate.ts`, must use mpnet-768, must consolidate with `causal_edges`, must satisfy ADR-0202 lint, must not be fire-and-forget, witness chain mapped to archivist audit chain). Trigger: explicit decision to revisit. |
| **4 of 15 new upstream commits**: `e1bd1f072` `bf0f505c9` `c9ec2b607` `1af3b1875` `6bcee19ad` | skip-mechanical — version bumps + merge commits (Batch J standing rule) |
| **3 of 15 ADR-130 group**: `10086c4bb` `16810c3e2` `542481053` | Defer with parent ADR-130 |
| **2 of 15 docs/branding**: `899163cb8` (benchmarks gist link), `619b263aa` (publishing policy alpha→stable) | skip-by-policy (ADR-0143 brand + Verdaccio-not-stable-cadence) |
| **`cfc341706` memory NULL status fix** | skip-by-policy — fork doesn't have the affected files (`memory-bridge.ts`, `memory-initializer.ts`) per ADR-0177 substrate restoration |

### Memory + project state at handover

- `@sparkleideas/cli@latest` = `3.7.0-alpha.10-patch.316` on Verdaccio
- `@sparkleideas/ruflo@latest` = `3.1.0-alpha.14-patch.292` on Verdaccio
- ADR-0094 streak: ignore per memory `[[feedback-no-streak-timegates]]`
- All ruflo-patch commits today pushed (last push: `fa1ac8e`)
- All forks/ruflo commits today pushed (last push: `f580f7ec0`)
- forks/agentdb up-to-date (pushed by pipeline)
- opda + hm: cleanups committed locally (NOT pushed; user-owned repos)

### State after same-day follow-up (status flip → implemented)

- `forks/ruflo/main` head: `a2af4dadd` (10+ new fork commits since `f580f7ec0`: HIGH + LOW closures + release-pipeline remediation commits below + ADR-128 carve-out)
- All HIGH + LOW items closed; MEDIUM + DEFERRED + SKIPPED retain their explicit triggers per `[[feedback-skip-accepted-as-squelch]]`
- Verdaccio versions update with the next `npm run release` (pipeline bumps wrapper + cli together)

### Release-pipeline remediation commits (2026-05-25 follow-up)

The first three release attempts surfaced three issues; each was diagnosed and fixed:

| Release attempt | Failure phase | Root cause | Fix |
|---|---|---|---|
| 1 | `undiscriminating-catches` lint | My `999346808` patch added `try { statSync } catch { /* file may not exist */ }` — lint correctly flagged comment-only catch | `9e5bc9a78`: refactored to `if (existsSync) { statSync }` |
| 2 | `test-ci` (TS compile) | `feedback-pipeline-shared-skip-on-dist-clear` — shared dist wiped but tsbuildinfo not invalidated; consumers got missing `getValidatedConfig` from `@sparkleideas/shared/core` | Re-run with `--force` (documented pattern) |
| 3 | `test-ci` (unit tests) | Prior session's `cfc6ebca5` (item #16 closure 2026-05-25 **16:29:30**) deleted CLI init copies per ADR-128 but the deleted `gossip-coordinator.md` + `crdt-synchronizer.md` carried real ADR-0120/0121 wire-in. Initial fix (`f615c0508`) ported wire-in into plugin canonicals — but plugin canonical turned out to be the WRONG source-of-truth for wired files because `ruflo init` copies from the CLI init template, not the plugin. That caused ADR-0116 drift (materialise script produces thin upstream copy, plugin canonical now has wire-in additions). | Final fix in commits `8c5c36ee9` (revert `f615c0508` — plugin canonical back to thin matching materialise output) + `a2af4dadd` (restore CLI init template files with wire-in + ADR-128 carve-out for these 2 basenames in `smoke-init-bundle-invariants.mjs`). Test paths reverted to CLI init template (this commit). |
| (also surfaced) | n/a — runtime bug | Clean-init Stop hook fires `auto-memory-hook.mjs sync`; ADR-0083 Wave 2 removed `sync` from the helper. Drift never caught because settings-generator caller wasn't updated when bundled-static helper was retired (per `helpers-generator.ts:990-995` comment, ADR-0235 Batch 1 exposed it; nobody surfaced the settings-generator side). | `b35b85a69`: remove Stop hook entirely (ADR-0083 Wave 2 made the drain redundant; better than repointing to `status` which would spam banner output on every exit) |

**Architectural finding (ADR-128 wire-in carve-out)**: ADR-128's "plugin's version is canonical, init template's copy is deleted, no exceptions" policy is correct for purely-documentation duplicates but breaks for files whose wire-in is consumed at `ruflo init` time (plugin install is a SEPARATE `/plugin install` step, not part of `init --full`). The 2 wired consensus agents (`gossip-coordinator.md`, `crdt-synchronizer.md`) are now allowlisted via `ADR_128_WIRE_IN_CARVE_OUT` in `scripts/smoke-init-bundle-invariants.mjs`. The other 10 files deleted by `cfc6ebca5` (5 other consensus, 3 swarm, 2 v3) carried no wire-in and remain plugin-only per ADR-128 unchanged.

Methodology lessons for ADR-0257-class work going forward:

* **Run `npm run test:unit` BEFORE `npm run release`.** Per `tests/CLAUDE.md`. Would have caught the cfc6ebca5/wire-in regression in 30 seconds instead of through the full release cascade.
* **Audit `ADR-128`-style canonical-source moves for wire-in content.** When a file is deleted because a different copy is canonical, verify the canonical copy contains everything the deleted file had — especially frontmatter keys like `allowed-tools` that constitute a wired MCP-tool surface.
* **`set -o pipefail` in any pipe chain that runs the release.** The first release attempt reported exit 0 despite ERROR-aborting because of `npm run release \| tee \| tail` masking npm's exit code.

### Snapshots retained (not on session-cleanup path)

- `/tmp/dual-stale-cleanup-snap-20260525T164505Z/` (8.1 GB; opda + hm pre-stale-cleanup)
- `/tmp/semantic-modelling-snapshot-20260525-164156/` (12 MB; pre-migration)
- `/tmp/semantic-modelling-stale-snap-20260525T155129Z/` (8.1 GB)
- `/tmp/ruflo-clean-20260525T163802Z/` (clean reference init)
- `/tmp/ruflo-init-reference-20260525T155103Z/` (earlier clean reference)

Delete when forensic value exhausted.
