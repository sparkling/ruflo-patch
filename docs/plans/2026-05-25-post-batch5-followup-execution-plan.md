# 2026-05-25 — Post-Batch-5 follow-up execution plan

Sibling to `docs/plans/2026-05-24-second-pass-execution-plan.md` and `docs/handovers/2026-05-25-post-batch5-handover.md`. Plans the execution of the follow-up work items that emerged after this session closed the four ADR-0233 §"Reviews still owed" carry-forward items.

## Context

This session closed the four ADR-0233 carry-forward items (1=stress harness, 2=ADR-0252 Batch S re-disposition, 3=sparse-attention bookkeeping correction, 4=archive skill prune). Closing them surfaced 17 follow-up work items (A–R, excluding J as a gap in the alphabet). This plan sequences and parallelises that work across a 32-core machine.

Constraints observed this session:

- **API rate / overload risk** — 3 background agents died on 529 errors today (Item 2 retry + Item 3 retry + an earlier item-1 hand-off). The 32-core local compute capacity is not the bottleneck; **Anthropic API concurrency is**. Practical parallel agent count: **4–6 in flight at once**, not 32.
- **File-conflict risk** — multiple items touch `docs/upstream/INTEGRATION-LEDGER.md` and `docs/adr/ADR-0233-*.md`. Batches must sequence file-overlapping work.
- **Gating dependencies** — some items must precede others (e.g. `L` must land before `A` so the stress test isn't a false-positive fail during investigation; `D` must precede `C` so the dedup strategy matches the actual discovery mechanism).

## Inventory & priority

| ID | Item | Priority | Type | Files touched |
|---|---|---|---|---|
| **A** | Disambiguate stress-test 14× RSS signal | HIGH | investigation + likely code fix | `forks/ruflo/v3/.../*` (TBD) |
| **K** | ADR for FS-JSON staging carve-out | HIGH | new ADR (ADR-0253) | `docs/adr/ADR-0253-*.md` |
| **L** | Mark stress test "investigation-pending" | MEDIUM-HIGH | small code edit | `scripts/test-stress-runtime.sh` |
| **M** | ADR-0233 remediation status table refresh | MEDIUM | doc walk + edit | `docs/adr/ADR-0233-*.md`, ADR-0234–0248 frontmatter |
| **N** | Audit 9 skip_accepted in latest acceptance run | MEDIUM | analyst report | none (writes report) |
| **C** | Bigger SKILL.md pollution dedup | MEDIUM | code/config | `forks/ruflo/.claude/`, `forks/ruflo/.agents/`, settings.json |
| **D** | Verify Claude Code skill-discovery key | MEDIUM | empirical research | none (writes finding) |
| **G** | Per-SHA: enumerate 5 supersede (neural-trader) | MEDIUM | research + ledger | `docs/upstream/INTEGRATION-LEDGER.md` |
| **H** | Per-SHA: enumerate 3 pull-pending (docs) + decide pull-now vs sync | MEDIUM-LOW | research + maybe cherry-pick | ledger; possibly forks/ruflo |
| **I** | Per-SHA: enumerate 2 github-surface + verify conflict still applies | MEDIUM-LOW | research + ledger | ledger; possibly forks/ruflo |
| **B** | Per-SHA: enumerate 9 misc | LOW | research + ledger | `docs/upstream/INTEGRATION-LEDGER.md` |
| **E** | Ledger hygiene spot-check (3–5 other "deferred" rows) | LOW-MEDIUM | research | `docs/upstream/INTEGRATION-LEDGER.md` |
| **O** | Refactor fragile slice-window pattern | LOW-MEDIUM | code | `tests/unit/adr0080-maxelements.test.mjs` |
| **P** | Index stress test in `tests/CLAUDE.md` | LOW | doc edit | `tests/CLAUDE.md` |
| **F** | Resolve uncommitted `package.json` version bump | TRIVIAL | git op | `package.json` |
| **Q** | Cross-fork push verification | TRIVIAL | check | none |
| **R** | Session-level memory entries | LOW | memory write | `~/.claude/projects/.../memory/` |

## Dependency graph

```
Batch 0 (sync, direct):
  F ──┐
  Q ──┼── prerequisite to all subsequent work
  R ──┘

Batch 1 (parallel agents, 5–6 in flight):
  K (ADR-0253 author)
  L (stress test gating edit)
  M (ADR-0233 + dependent ADR statuses)
  N (skip_accepted audit)
  D (discovery key verification)
  G + H + I + B (combined per-SHA pass)

Batch 2 (parallel, ≤3 in flight; gated on Batch 1):
  A (stress test deep investigation)        ← gated on L
  C (SKILL.md dedup)                        ← gated on D
  E (ledger hygiene spot-check)             ← gated on G+H+I+B (avoid ledger merge conflict)
  O (slice-window refactor)                 ← independent; can land in Batch 1 if agent budget allows
  P (stress test indexing)                  ← gated on L (so the index points at the gated test)
```

## Parallelization strategy on 32-core machine

The 32-core machine is **not** the parallelism limit. Per-agent compute is light (each agent makes API calls); 32 idle cores during a 6-agent run is normal. The two real limits are:

1. **Anthropic API concurrency / 529 overload** — practical ceiling: 6 concurrent agents on a stable API; 4 during periods of overload. After 3 deaths today, defensively cap at **5 agents per batch wave**.
2. **File-write conflicts** — agents writing to the same file race. Three risk files this batch:
   - `docs/upstream/INTEGRATION-LEDGER.md` — G+H+I+B writes; E writes
   - `docs/adr/ADR-0233-*.md` — M writes
   - `tests/unit/adr0080-maxelements.test.mjs` — O writes
   - `scripts/test-stress-runtime.sh` — L writes

To handle file conflicts: serialise agents that touch the same file across batches. G+H+I+B and E both touch INTEGRATION-LEDGER → put E in Batch 2 only after G+H+I+B commits.

### Why not 32 agents in parallel

- API will reject most simultaneous starts (529 overload, confirmed this session).
- Token-budget per agent dominates local CPU.
- The supervisor (this conversation) has its own context budget; the more results returned, the more main-thread context consumed.
- Higher fan-out increases coordination cost — verifying outputs, resolving conflicts, retrying failures.

The "32 cores" framing is a red herring for AI-driven workflows; the right metric is **API stability × supervisor context budget**, both of which favour 4–6 wave size.

## Swarm topology

Per the `ruflo-swarm:swarm` skill: hierarchical topology, max-agents 8 (we'll use 5 per wave), specialized strategy.

```
npx @sparkleideas/cli@latest swarm init \
    --topology hierarchical \
    --max-agents 8 \
    --strategy specialized
```

After init, spawn workers via Claude Code's Agent tool with `run_in_background: true`. The swarm provides:

- topology metadata (so agents can discover siblings if needed — typically not needed in this plan)
- shared status surface (`swarm status`, `swarm health`)
- specialization affinity (the strategy hints at agent type per task)

But — per `feedback-no-hive-ceremony-for-impl` — we do not run consensus votes or hive-mind ceremony for implementation work. Each agent independently completes its task; the supervisor (this conversation) coordinates by:

1. Reading each agent's completion summary
2. Inspecting commits/files to verify against the summary
3. Sequencing subsequent batches based on outcomes

### Agent-type mapping (specialized strategy)

| Item | Agent type | Rationale |
|---|---|---|
| A | `coder` (or `researcher` if no fix lands this session) | Likely involves code change in ADR-0243 path |
| K | `adr-architect` or `coder` | Authors ADR-0253 |
| L | `coder` | Tactical script edit |
| M | `code-analyzer` | Walk + edit ADR statuses; cross-reference frontmatter |
| N | `code-analyzer` or `researcher` | Audit of 9 skip_accepted classifications |
| C | `coder` | Real dedup work; touches multiple skill paths |
| D | `researcher` | Empirical verification (read docs, possibly run a probe) |
| G+H+I+B | `researcher` (combined) | One researcher pass over the 19 SHAs |
| E | `researcher` | Read-only ledger spot-check |
| O | `coder` | Small refactor |
| P | direct (no agent) | One-line tests/CLAUDE.md edit |
| F, Q, R | direct (no agent) | Hygiene |

## Batches

### Batch 0 — Hygiene & prep (direct, no agents, ~5 min)

1. **F** — Resolve `package.json` uncommitted version bump:
   - Option (a): commit it (treats prior failed release as canonical version state in Verdaccio)
   - Option (b): revert it (matches checked-in state; next release will re-bump)
   - **Recommend (a)**: matches the Verdaccio-published-state principle in `reference-verdaccio`. One small commit.

2. **Q** — Verify cross-fork pushes for this session:
   - `git -C /Users/henrik/source/forks/ruflo log @{u}..HEAD` (expect empty)
   - Same for `forks/agentdb`, `forks/ruvector`
   - `git -C /Users/henrik/source/ruflo-patch log @{u}..HEAD` (expect empty)

3. **R** — Write 2 memory entries (deferred to end of session — see "Closing" below).

### Batch 1 — Parallel agents, 5 in flight (~20–40 min walltime)

All 5 agents run in parallel via `Agent` tool with `run_in_background: true`. No file conflicts within this batch.

| Agent | Task | Files |
|---|---|---|
| `k-adr-author` | Author ADR-0253 (FS-JSON staging carve-out amending ADR-0246) | new `docs/adr/ADR-0253-*.md` |
| `l-stress-gate` | Add `STRESS_INVESTIGATION_PENDING=1` env guard (or rename to `bash scripts/test-stress-runtime-experimental.sh` + a stub script that fails-loud unless guard set) | `scripts/test-stress-runtime.sh` |
| `m-status-refresh` | Walk ADRs 0234–0248 frontmatter; update ADR-0233 §"Remediation ADRs" table status column to match | `docs/adr/ADR-0233-*.md` + N ADR frontmatter |
| `n-skip-audit` | Read `test-results/accept-2026-05-25T*/acceptance-results.json`; for each `skip_accepted`, classify as legit (tool-not-found / env-disabled / heavy-test-opt-out) or squelch | none (writes finding report) |
| `d-discovery-probe` | Verify Claude Code skill-discovery semantics: does it key off `/skills/` directory segment or `SKILL.md` filename? Look at docs.claude.com if accessible OR inspect Claude Code's source if cloned locally | none (writes finding) |

**Batch 1 deferred** (rolls into Batch 2 because of ledger-write contention):
- `ghib-sha-enumeration` — touches `docs/upstream/INTEGRATION-LEDGER.md`, conflicts with `e-ledger-hygiene` if both run together

### Batch 2 — Parallel agents, 5 in flight, gated on Batch 1 completion

| Agent | Task | Gated on | Files |
|---|---|---|---|
| `a-stress-investigate` | Deep investigation: is the 14× RSS at N=100 a real ADR-0243 leak, a synthetic-burst artifact, or warmup allocation? Profile the MCP child; bisect by tool family (HiveLRU/timer/signal/write); produce a finding + recommended fix or "test methodology needs adjustment" verdict | L (so the stress test is gated as investigation-pending before any future runner trips on it) | `forks/ruflo/v3/.../` (TBD); writes finding |
| `c-skill-dedup` | Based on D's finding, either prune duplicate SKILL.md paths (if directory-segment-based discovery) or pursue a content-based dedup (if filename-based). Restore `skillListingBudgetFraction` to default if below cap | D | `forks/ruflo/.claude/`, `.agents/`, `plugins/*/skills/`, `v3/.claude/skills/` |
| `ghib-sha-enum` | Per-SHA enumeration of all 19 Batch S deferrals (5+3+2+9); add per-row ledger entries with disposition (supersede / pull-pending / defer / drop) | Batch 1 done (avoids M's ADR-0233 edits cascading) | `docs/upstream/INTEGRATION-LEDGER.md` |
| `o-slice-refactor` | Refactor `tests/unit/adr0080-maxelements.test.mjs`: replace fixed-window slicing with function-boundary detection (regex `^\s*\}\s*,?\s*$` against block start) so future generator expansions don't trip the same window | none (could go Batch 1 if budget) | `tests/unit/adr0080-maxelements.test.mjs` |
| `p-stress-index` | One-line edit to `tests/CLAUDE.md` adding the stress test to the suite reference + invocation example | L | `tests/CLAUDE.md` |

### Batch 3 — Single agent (~10–20 min)

| Agent | Task | Gated on | Files |
|---|---|---|---|
| `e-ledger-spot-check` | Walk 3–5 other "deferred" rows in INTEGRATION-LEDGER and verify they're still accurate (sample: rows tagged "Batch N", "Batch M", "ruv-FANN dormant" — different families, different epochs). Flag any other Batch-O-style drift | `ghib-sha-enum` committed (avoids merge conflict) | `docs/upstream/INTEGRATION-LEDGER.md` |

### Closing (direct, no agents)

- **R** — Write 2 memory entries:
  - **R.1**: "head -5 hides drift cascade" — when an acceptance check's diff output uses `head -5`, fixing the first-listed drift may reveal further drift that was hidden. (Lesson from `adr0116-drift` initial misdiagnosis.)
  - **R.2**: "ledger 'deferred' row may be stale — verify content vs row before accepting the disposition" — Batch O Lesson; saved generations of follow-up.
- Update `MEMORY.md` index pointers.
- Run full `npm run release` for final green confirmation.

## Risk register

| Risk | Mitigation |
|---|---|
| API 529 during Batch 1 spawn | Spawn in pairs (3 + 2) with 30s gap if 529 hit; fall back to in-session completion (as we did this session for Items 2+3) |
| File conflict in INTEGRATION-LEDGER between `ghib-sha-enum` and `e-ledger-spot-check` | Serialised across batches (E in Batch 3) |
| File conflict in ADR-0233 between `m-status-refresh` and downstream agents wanting to amend its "Reviews still owed" | M completes in Batch 1; later batches don't touch ADR-0233 |
| `A` finding requires fork code edit + rebuild + republish — adds 15–20 min to the critical path | A is the deepest item; budget for it accordingly. If finding is "synthetic-burst artifact", no fix needed and we close the open item. |
| `C` finding (depends on D) requires touching `.agents/skills/` which has 134 SKILL.md — large diff | If D shows filename-based discovery, C's scope shifts dramatically; revisit C's plan after D lands |

## Out of scope (deferred to future session)

- **Performance-leak runtime test integration into the cascading pipeline (npm run test:acceptance)** — current harness is a standalone script per `tests/CLAUDE.md`'s pipeline taxonomy. Integration is a future shape.
- **Memory dedup beyond `.agents/skills/`** — `plugins/*/skills/` (104) and `v3/.claude/skills/` (38) are kept-but-overlapping. Decision pending broader discovery model.
- **Full ADR-0246 rewrite (vs amendment)** — K creates an amendment-style ADR-0253; a full rewrite is bigger surface and gated on staging-substrate design review.
- **Per-SHA dispositions for Batch O's 5 SHAs beyond just adding the missing `9d8006ae2` row** — they're absorbed; the ledger now reflects that. No further work needed.

## Confirmation criteria for this plan

This plan is "executed" when:

1. Batches 0–3 complete OR explicit deferral committed.
2. ADR-0233 §"Reviews still owed" carries no open lines (or each remaining line points to a follow-up ADR / future-session token).
3. `npm run release` final run is green (688+/697 pass, 0 fail, ≤9 skip_accepted).
4. `git status --short` empty on all 4 repos OR each line documented.
5. Memory entries R.1 + R.2 written.

## Reference

- Parent: `docs/handovers/2026-05-25-post-batch5-handover.md`
- Sibling: `docs/plans/2026-05-24-second-pass-execution-plan.md`
- Carry-forward closure: `[[ADR-0252]]` (Batch S re-disposition) + commit `57218c2`
- Stress harness: `[[ADR-0243]]` + commit `a9aa795` (`scripts/test-stress-runtime.sh` + `scripts/stress-runtime-driver.mjs`)
- FS-JSON staging fix: `forks/agentdb` commits `cc879ce` + `bda4669`
- Archive prune: `forks/ruflo` commit `1a26254eb`
