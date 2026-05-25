# Ledger Retargeted Rows + ADR-0257 Trim Items (#1, #2, #16) Audit

**Date**: 2026-05-25
**Scope**: Batch C-E of [[ADR-0257]] §Execution plan.
**Read-only**: `ruvnet/*`, `forks/ruflo`, `forks/agentic-flow`. **Write**: `forks/agentdb/src/archivist/MODULE.md` (Task 2 only).
**Outputs**: this file + amendment commit `bff2c97` in `forks/agentdb`.

---

## §1 — Retargeted rows (4)

The four `retargeted` rows in `docs/upstream/INTEGRATION-LEDGER.md` (lines 242, 243, 244, 249) are post-[[ADR-0161]] agentdb-pivot rows: upstream commits to `ruvnet/agentic-flow` whose substance moved to `forks/agentdb` via the 2026-05-06 extraction commit `8b3388b22` ("init: agentdb package source + marketing UI").

### Verification table

| Upstream SHA | Upstream subject | Upstream verified in `ruvnet/agentic-flow`? | Fork-side substance verified in `forks/agentdb`? | Verdict |
|---|---|---|---|---|
| `25b26e2` | `docs: Add ADR-071 - AgentDB & RuVector WASM Capabilities Review` (2026-03-25) | yes (`git show 25b26e2`) | yes — `forks/agentdb/docs/adrs/ADR-071-agentdb-ruvector-wasm-capabilities-review.md` present, intact (21,698 bytes, Status: Proposed, dated 2026-03-25) | **Still valid** |
| `c830a98` | `feat: Add ruvector upstream submodule and ADR-072` (2026-03-26) | yes (`git show c830a98`) | yes — `forks/agentdb/docs/adrs/ADR-072-ruvector-advanced-features-integration.md` present, intact (7,398 bytes, Status: Proposed, dated 2026-03-26). Note: the *ruvector submodule* part of the upstream commit subject is fork-disjoint (forks/ruvector exists as its own fork repo); only the ADR-072 doc was retargeted to `forks/agentdb`, which matches what the ledger row claims. | **Still valid** |
| `54440ca` | `docs(agentdb): Add pre-publish review and publishing guide` (2026-03-26) | yes (`git show 54440ca`) | yes — `forks/agentdb/PRE-PUBLISH-REVIEW.md` present (8,434 bytes), with commit-log provenance: `093b913 docs: import PRE-PUBLISH-REVIEW.md from agentic-flow@54440ca (npm publishing guide)` — explicit `-x`-style provenance trailer matches `feedback-update-integration-ledger` ("`git cherry-pick -x` so trailers stay greppable"). | **Still valid** |
| `c2af4dc` | `fix(agentdb): add delete API to GraphDatabaseAdapter + ReflexionMemory.deleteEpisode (#150) (#151)` (2026-05-06) | yes (`git show c2af4dc`) | yes — `8b3388b22` extraction commit ships `src/backends/graph/GraphDatabaseAdapter.ts` (481 lines), `src/controllers/ReflexionMemory.ts` (1391 lines) + `ReflexionMemory-delete.test.ts` (240 lines). Live grep confirms `deleteNode/deleteEdge/deleteHyperedge` in `GraphDatabaseAdapter.ts:347, 381, 397` + `deleteEdgesByEndpoints:411`, and `deleteEpisode` in `ReflexionMemory.ts:1164`. Ledger row's cited absorption SHA `8b3388b22` is correct. | **Still valid** |

### Classification

**All 4 rows: still valid, no drift.**

Each retargeted row:
- has a real upstream SHA in `ruvnet/agentic-flow` (verified via `git show --no-patch`),
- has substance present at the cited canonical path in `forks/agentdb`,
- carries a clear post-[[ADR-0161]] pivot rationale (the agentdb-from-agentic-flow extraction documented in memory `[[project-agentdb-parallel-extraction]]` and `[[reference-ruvnet-upstream-repos]]`).

No re-disposition needed; these rows are the canonical pattern for "upstream substance moved fork-axis during the 2026-05-06 extraction." Future agentic-flow→agentdb pivots (if any) should follow the same `retargeted | <forks/agentdb SHA> | 0186 | post-ADR-0161 agentdb pivot` shape.

---

## §2 — ADR-0253 MODULE.md footnote amendment

**Status**: Landed.
**Commit (agentdb)**: `bff2c97` — `docs(archivist): amend MODULE.md footnote to post-cc879ce in-lock-commit shape`.
**Branch**: `main` (per `[[feedback-trunk-only-fork-development]]`).
**Attribution**: solo-committer per `[[feedback-fork-commit-attribution]]` (no `Co-Authored-By` trailer on forks/agentdb commits).

### What changed

Before (pre-`cc879ce` shape, authored 2026-05-24 alongside [[ADR-0246]] F-03-002 partial discharge):

> **Footnote (ADR-0246 F-03-002 partial discharge, 2026-05-24)**: mutation-invariants are enforced today for FS-JSON-backed substrates only — the dispatch path stages FS-JSON writes (`staging-substrate.ts`) and only `commit()`s them after invariants pass. RVF-substrate enforcement is **pending** ...

After (post-`cc879ce` shape, per [[ADR-0253]] §"Per-carve-out disposition" + §Evidence):

> **Footnote (ADR-0253 amendment, 2026-05-25; supersedes ADR-0246 F-03-002 partial-discharge framing)**: mutation-invariants now have three substrate-specific shapes ... (1) **FS-JSON** ... commit *inside* the substrate's `withWrite` file lock — invariants run on already-committed bytes, not on staged state. This is the C3 carve-out in `[[ADR-0253]]`: permanent by design ... (2) **RVF**: enforcement is **pending** `freeze()` + rollback wiring ... (3) **SQLite carve-outs** ... retain full staged-state invariants. ...

### Why

[[ADR-0253]] §Evidence (lines 80-86 of the ADR) explicitly named this footnote as an open follow-up:

> Note: the MODULE.md footnote was authored *before* the `cc879ce` in-lock-commit fix and describes the *staged*-then-commit shape that path (a) restored for FS-JSON. The `cc879ce` commit then carved FS-JSON *back out* of that staged shape because of `[[ADR-0123]]` durability. ... The MODULE.md footnote will be amended in a separate commit to reflect the post-`cc879ce` shape; that amendment is named follow-up for this ADR.

Commits `cc879ce` + `bda4669` (forks/agentdb, 2026-05-25) introduced the FS-JSON in-lock-commit carve-out to fix a concurrent-write data-loss regression against [[ADR-0123]]'s 100% durability bar. The amended footnote enumerates all three substrate-specific shapes (FS-JSON C3, RVF pending, SQLite carve-outs) per [[ADR-0253]]'s decision table, so a future auditor finding [[ADR-0246]] alone does not re-litigate.

---

## §3 — GHIB 2-of-5 docs-badge outliers

**Source**: GHIB report-bearing commit `4375898` (ruflo-patch, 2026-05-25 — "docs(INTEGRATION-LEDGER): enumerate 19 Batch S per-SHA dispositions (ADR-0252)").

That commit's GHIB pass picked **3 of 5** README-touching upstream SHAs by "best-evidence" and added them to the ledger as `pending` (pull-pending docs/badge):

- `32612ecdf` (2026-05-19) — fix badge links + add ecosystem badges
- `f8974c74c` (2026-05-19) — trim redundant per-package npm badges
- `10db8e459` (2026-05-21) — add RuFlo Agentic Appliance banner

The remaining **2 of 5** (`4def69f00`, `4a57be7b8`) had no recorded disposition. This audit triages them.

### Per-SHA verdict

#### `4def69f00` — 2026-05-19 — `docs: add ruflo-graph-intelligence to plugin list + reshuffle featured installs`

**Files touched**: `README.md` (+4 −3), `ruflo/README.md` (+4 −3). 7 insertions, 6 deletions total.

**Substance**: Two README updates to roots:
1. Adds `ruflo-graph-intelligence` (ADR-123 — sublinear graph reasoning) under Intelligence & Learning. Count 32 → 33.
2. Reshuffles the Path A featured install snippet — adds `ruflo-rag-memory` and `ruflo-neural-trader`, removes `ruflo-autopilot` and `ruflo-federation`.

**Fork-side check**:

```
$ grep -c "ruflo-graph-intelligence" README.md ruflo/README.md
0  0
```

Zero references in `forks/ruflo`'s root READMEs. `ruflo-graph-intelligence` was explicitly **deleted** from the fork by [[ADR-0248]] F-07-001 (commits `7c4323500` + `78b5c73f1`). Picking `4def69f00` would re-introduce a plugin reference that fork has purged on policy grounds.

**Verdict**: **skip-by-policy** ([[ADR-0248]] F-07-001 supersedes; `ruflo-graph-intelligence` is forbidden fork-side).

**Suggested ledger row** (not added per task constraint "DO NOT modify INTEGRATION-LEDGER"):

```
| `4def69f00` | 2026-05-19 | docs: add ruflo-graph-intelligence to plugin list + reshuffle featured installs | skip-by-policy | — | 0252 | GHIB 2-of-5 docs-badge outlier. ADR-0248 F-07-001 deleted `ruflo-graph-intelligence` from fork (commits 7c4323500 + 78b5c73f1); README ref-count = 0. Picking would re-add a plugin fork has purged. |
```

#### `4a57be7b8` — 2026-05-18 — `fix(docs): #2028 — replace SendMessage-First with memory-as-bus pattern`

**Files touched**: `CLAUDE.md` (+98 −147), `package.json` (+1 −1), `ruflo/package.json` (+2 −2), `v3/@claude-flow/cli/package.json` (+1 −1), `v3/@claude-flow/cli/src/init/claudemd-generator.ts` (+45 −36). 5 files, 147 insertions, 187 deletions.

**Substance**: Rewrites root `CLAUDE.md` and the v3 init `claudemd-generator.ts` to replace "SendMessage-First Protocol" framing with "memory-as-bus pattern". Closes upstream issue #2028. Includes version bump to 3.7.0-alpha.69.

**Fork-side check**:

```
$ grep -nE "SendMessage|memory-as-bus" CLAUDE.md | head -10
267:  prompt: "Research requirements and codebase. SendMessage findings to 'architect' when done.",
271:  prompt: "Wait for research from 'researcher'. Design implementation. SendMessage design to 'coder'.",
275:  prompt: "Wait for design from 'architect'. Implement the solution. SendMessage code paths to 'tester'.",
279:  prompt: "Wait for implementation from 'coder'. Write tests. SendMessage results to 'reviewer'.",
288:SendMessage({ to: "researcher", summary: "Start research", message: "[task description and context]" })
299:// Pipeline flow via SendMessage:
546:Agent Teams turns Claude Code into a multi-agent system where named agents communicate in real-time via `SendMessage`. The comms system is the primary coordination mechanism — agents talk to each other, not just to the lead.
552:  ├── SendMessage ←→ architect (named agent)
553:  ├── SendMessage ←→ developer (named agent)
554:  ├── SendMessage ←→ tester (named agent)
```

`memory-as-bus` count: 0. Fork is on the pre-#2028 SendMessage-First shape at multiple sites (lines 267-554). Fork additionally has an independent CLAUDE.md-generator surface ([[ADR-0083]] generator drift work, already captured by ledger row `6b7d64bcb` as `pending` misc-defer per-SHA).

**Verdict**: **pending** (same disposition family as the three docs/badge picks `32612ecdf` / `f8974c74c` / `10db8e459`). CLAUDE.md is genuinely divergent and the v3 generator path overlaps fork's independent generator surface; needs per-commit triage on next sync.

**Suggested ledger row** (not added per task constraint):

```
| `4a57be7b8` | 2026-05-18 | fix(docs): #2028 — replace SendMessage-First with memory-as-bus pattern | pending | — | 0252 | GHIB 2-of-5 docs-badge outlier. Fork's root CLAUDE.md still on pre-#2028 SendMessage-First shape (lines 267-554; `memory-as-bus` count = 0). Touches v3/@claude-flow/cli/src/init/claudemd-generator.ts which overlaps fork's independent generator (per ADR-0083 drift work + ledger row `6b7d64bcb`). Per-commit triage on next sync. |
```

### Summary

| SHA | Verdict | Ledger disposition target |
|---|---|---|
| `4def69f00` | skip-by-policy | ADR-0248 F-07-001 deletion |
| `4a57be7b8` | pending | same family as 3 docs/badge picks; per-commit triage on next sync |

Neither outlier is silently-landed; both have actionable next-state classifications.

---

## §4 — `smoke-init-bundle-invariants.mjs` violation count verification

**Trigger**: Item #16 in [[ADR-0257]] (DEFERRED status; this audit is DOC-ONLY verification of the audit-row provenance).

**Command run**:

```
$ cd /Users/henrik/source/forks/ruflo
$ node scripts/smoke-init-bundle-invariants.mjs > /tmp/smoke-out.log 2>&1
$ echo $?
1
```

### Header confirmed

The script's own header line reports:

```
17 init-bundle invariant violation(s):
```

### Breakdown

| Category | Count | Lines in `/tmp/smoke-out.log` | Pattern |
|---|---|---|---|
| `[MISSING-SKILL]` (parser-regex bugs — see audit note below) | **5** | 4, 14, 20, 26, 35 | `SKILLS_MAP references '<garbled>' but neither SKILL.md nor README.md found in package` |
| `[COLLISION]` ([[ADR-0128]] plugin-agent basename collisions) | **12** | 41, 45, 49, 53, 57, 61, 65, 69, 73, 77, 81, 85 | `'<agent>.md' exists in both init template and plugin (plugin must be canonical)` |

**Total: 5 + 12 = 17.** Matches the script's self-reported header and [[ADR-0257]] item #16's claim verbatim.

### Per-violation list

#### Parser-regex bugs (5)

The `[MISSING-SKILL]` block surfaces the parser-regex bug clearly: the SKILLS_MAP key being parsed is malformed (e.g. `'t\n  // copied to user projects because they had no SKILLS_MAP category. Now\n  // categorised so \`--full\` (and category-specific flags) ship them.\n  jujutsu: ['`). The script's regex for SKILLS_MAP entries is matching across comment lines and category boundaries, producing 5 garbage keys that then fail the "SKILL.md or README.md exists in package" check.

| # | Line | Garbled key extracted | Real category context |
|---|---|---|---|
| 1 | 4-13 | `t\n[...]\njujutsu: [` | `jujutsu` category boundary |
| 2 | 14-19 | `],          // npx agentic-jujutsu — AI-native VCS\n  hiveMind: [` | `jujutsu`→`hiveMind` boundary |
| 3 | 20-25 | `],      // Queen-led collective intelligence (ADR-0140)\n  performance: [` | `hiveMind`→`performance` boundary |
| 4 | 26-34 | `], // Performance bottleneck + optimization workflow\n  workers: [\n    ` | `performance`→`workers` boundary |
| 5 | 35-40 | `,                 // Background worker benchmark suite\n    ` | `workers` interior (mid-entry comma) |

**Root cause** (DOC-only — no fix per item #16's DEFERRED status): the script's SKILLS_MAP-parsing regex does not account for inline `//` comments inside the JS object literal it scrapes, and treats the comment text + next category opening bracket as a single "key" string. The result is 5 spurious MISSING-SKILL violations per smoke run, all sharing the same parser-regex etiology. None reflect a real missing skill.

#### `[ADR-0128]` collisions (12)

Each row: an agent `.md` file exists at BOTH a fork-internal init-template path (`v3/@claude-flow/cli/.claude/agents/...`) AND a plugin path (`plugins/ruflo-hive-mind/agents/...`). [[ADR-0128]] §Phase 2 designates the plugin copy as canonical; init-template copies should be deleted.

| # | Line | Agent basename | Init-template path | Plugin path |
|---|---|---|---|---|
| 1 | 41-44 | `adaptive-coordinator.md` | `v3/@claude-flow/cli/.claude/agents/swarm/` | `plugins/ruflo-hive-mind/agents/` |
| 2 | 45-48 | `byzantine-coordinator.md` | `v3/@claude-flow/cli/.claude/agents/consensus/` | `plugins/ruflo-hive-mind/agents/` |
| 3 | 49-52 | `collective-intelligence-coordinator.md` | `v3/@claude-flow/cli/.claude/agents/v3/` | `plugins/ruflo-hive-mind/agents/` |
| 4 | 53-56 | `crdt-synchronizer.md` | `v3/@claude-flow/cli/.claude/agents/consensus/` | `plugins/ruflo-hive-mind/agents/` |
| 5 | 57-60 | `gossip-coordinator.md` | `v3/@claude-flow/cli/.claude/agents/consensus/` | `plugins/ruflo-hive-mind/agents/` |
| 6 | 61-64 | `hierarchical-coordinator.md` | `v3/@claude-flow/cli/.claude/agents/swarm/` | `plugins/ruflo-hive-mind/agents/` |
| 7 | 65-68 | `mesh-coordinator.md` | `v3/@claude-flow/cli/.claude/agents/swarm/` | `plugins/ruflo-hive-mind/agents/` |
| 8 | 69-72 | `performance-benchmarker.md` | `v3/@claude-flow/cli/.claude/agents/consensus/` | `plugins/ruflo-hive-mind/agents/` |
| 9 | 73-76 | `quorum-manager.md` | `v3/@claude-flow/cli/.claude/agents/consensus/` | `plugins/ruflo-hive-mind/agents/` |
| 10 | 77-80 | `raft-manager.md` | `v3/@claude-flow/cli/.claude/agents/consensus/` | `plugins/ruflo-hive-mind/agents/` |
| 11 | 81-84 | `security-manager.md` | `v3/@claude-flow/cli/.claude/agents/consensus/` | `plugins/ruflo-hive-mind/agents/` |
| 12 | 85-88 | `swarm-memory-manager.md` | `v3/@claude-flow/cli/.claude/agents/v3/` | `plugins/ruflo-hive-mind/agents/` |

All 12 plugin copies live in the same plugin (`ruflo-hive-mind`); 8 of 12 init-template sources are under `agents/consensus/`, 3 under `agents/swarm/`, 2 under `agents/v3/`. Per [[ADR-0128]] §Phase 2, the standing remediation is `rm v3/@claude-flow/cli/.claude/agents/{swarm,consensus,v3}/<basename>.md` (12 deletions). Smoke exit code 1 is intentional; the 12 collisions are documented-pre-existing per [[ADR-0257]] item #16's DEFERRED disposition.

### Verdict

**Audit's claim verified**: smoke surfaces **17 violations = 5 parser-regex bugs + 12 [[ADR-0128]] collisions**. Per-violation breakdown documented in this audit. No fix landed (per [[ADR-0257]] item #16's DEFERRED status; trigger remains "plugin-agent basename causes user-visible behavior bug OR smoke repurposed as release gate").

---

## Summary of all four task verdicts

| Task | Verdict |
|---|---|
| §1 Retargeted rows (4) | All 4 **still valid** — upstream SHAs verified in `ruvnet/agentic-flow`; substance present at cited paths in `forks/agentdb`; post-[[ADR-0161]] pivot rationale stands. |
| §2 ADR-0253 MODULE.md amendment | **Landed**. Commit `bff2c97` in `forks/agentdb` on `main`. Footnote at `src/archivist/MODULE.md:45-47` rewritten to enumerate three substrate-specific shapes (FS-JSON C3, RVF pending, SQLite carve-outs) per [[ADR-0253]] §Per-carve-out disposition. |
| §3 GHIB 2-of-5 docs-badge outliers | `4def69f00` → **skip-by-policy** ([[ADR-0248]] F-07-001 deletion of `ruflo-graph-intelligence`); `4a57be7b8` → **pending** (CLAUDE.md generator overlap, same family as the 3 picked docs/badge SHAs). Suggested ledger rows drafted but not applied (task constraint: DO NOT modify INTEGRATION-LEDGER). |
| §4 smoke violation count | **17 verified** (5 parser-regex bugs + 12 [[ADR-0128]] collisions). Per-violation list documented. DEFERRED status preserved per [[ADR-0257]] item #16. |

## Commit hashes produced by this audit

| Repo | Hash | Subject |
|---|---|---|
| `forks/agentdb` | `bff2c97` | `docs(archivist): amend MODULE.md footnote to post-cc879ce in-lock-commit shape` |
| `ruflo-patch` | (this commit) | `docs(audit): retargeted rows + ADR-0257 items #1/#2/#16 verification` |
