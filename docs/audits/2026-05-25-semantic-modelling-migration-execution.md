# 2026-05-25 — semantic-modelling migration: execution report

Companion to `docs/plans/2026-05-25-semantic-modelling-ruflo-migration.md`
(commit `f2019d8`). Records what was actually executed.

## Outcome

**GREEN.** All 5 plan steps completed (Step 4 optional skipped); all 4
verified orphans deleted; live memory system healthy post-cleanup.

## Per-step execution

| # | Step | Outcome |
|---|---|---|
| 1 | Snapshot to `/tmp/semantic-modelling-snapshot-20260525-164156/` | 12 MB; daemon.sock skipped (expected, not a regular file) |
| 2 | Verify + move corrupt `.swarm/memory.db` | `sqlite3` returned "database disk image is malformed (11)"; moved to `.swarm/memory.db.corrupt-snapshot-20260525` |
| 3 | Confirm `.claude/memory/` ingestion chain | symlink at `~/.claude/projects/-Users-henrik-source-hm-semantic-modelling/memory` → `.claude/memory/`; 88 files reachable through symlink + 88 in canonical path (identity confirmed) |
| 4 | Migrate `.claude-flow/memory.rvf` content | **SKIPPED** per plan's optional decision (no historical content needed) |
| 5 | Post-migration health | symlinked dir 88 files ✓ • RVF 9306B ✓ • memory.db recreated by `memory init` (not by `memory stats` as plan suggested — see Plan-amendment note below) ✓ • 33 tables incl. expected `episodes`/`skills`/`skill_embeddings`/`hierarchical_memory` ✓ • `memory search` returns 2 prior entries at 0.44/0.43 (above 0.15 floor) ✓ |

## Cleanup executed

Deleted 4 verified orphans (~4 MB total):

- `.swarm/schema.sql` (9.2 KB)
- `.swarm/memory.graph` (1.5 MB)
- `.claude-flow/memory.rvf` (1.2 MB) — pre-ADR-0165-B2 fossil
- `.claude-flow/memory.rvf.meta` (1.2 MB) — sidecar

Retained (forensic):

- `.swarm/memory.db.corrupt-snapshot-20260525` — Step-2 quarantine

## Plan amendment surfaced during execution

The plan's Step-2-verify-after-step-5 instruction assumed `memory stats`
boots the MCP server enough to trigger `AgentDB.loadSchemas()`. It does
not — `memory stats` queries RVF directly and never instantiates the
SQLite carve-out controllers.

**Working trigger**: `npx ... memory init` runs the `MemoryInitializer`
which boots AgentDB and creates the SQLite tables. After this command,
`.swarm/memory.db` exists with 33 tables.

Plan should be updated to reference `memory init` (not `memory stats`)
as the post-mv recreate trigger. Filed as a follow-up to the plan
authors.

## Risks resolved / still open

**Resolved**:

- The 88 `.claude/memory/*.md` files are the canonical project memory
  source. They were never at risk of deletion — that was the
  pre-execution misreading I owe a correction for.
- The `~/.claude/projects/.../memory` symlink chain is intact; auto-
  memory bridge can still ingest 88 files.

**Still open** (per plan §Risks; not addressed by this execution):

1. `.claude/projects/-Users-henrik-source-hm-semantic-modelling/project-constraints.md` — unknown provenance; preserved.
2. `.swarm/state.json` — single-swarm legacy state; preserved.
3. `.claude-flow/sessions/session-*.json` historic + `undefined.json` — historical/unread; preserved.
4. `main2` sister symlink at `~/.claude/projects/-Users-henrik-source-hm-main2-semantic-modelling/memory` — separate symlink to a different physical path; preserved.

These remain `preserve-pending-investigation` until traced.

## Files in semantic-modelling: net state

Before:
- 88 .claude/memory/*.md files
- 7 files in .swarm/ (memory.rvf + .lock, memory.db [corrupt], memory.graph, schema.sql, state.json, swarm-state.json)
- 4 orphan files in .claude-flow/ (memory.rvf + .meta + others)

After:
- 88 .claude/memory/*.md files (unchanged)
- 5 files in .swarm/ (memory.rvf + .lock, memory.db [fresh, 33 tables], state.json, swarm-state.json) + 1 forensic quarantine
- 0 orphans in .claude-flow/

Net delete: 4 orphans + 0 carve-outs (everything load-bearing preserved).

## Commits / artifacts

This execution did NOT produce any git commit in `semantic-modelling`
(the project is gitignored / not under our version control). The
snapshot at `/tmp/semantic-modelling-snapshot-20260525-164156/` is the
rollback artifact.

This report itself committed in `ruflo-patch` for traceability.
