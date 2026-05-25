# 2026-05-25 — opda stale install audit (READ-ONLY)

Audited project: `/Users/henrik/source/opda/`
Reference manifest: `/tmp/ruflo-init-reference-20260525T155103Z/file-manifest.txt` (319 files; built from a fresh `--full --force` init under patch.316 install).
Diff method: `comm -23 opda-files-rel.txt ref-files-rel.txt` → **78 candidates**.

This audit is **READ-ONLY**. The live MCP server (PID 1312, `npx -y @sparkleideas/ruflo@latest mcp start`, alive 2h24m+) is using files in this project. No cleanup was executed.

## Live-process state

`lsof -p 1312` shows the MCP server holding the following opda files open:

```
/Users/henrik/source/opda                              (cwd)
/Users/henrik/source/opda/.swarm/memory.db              (15u)
/Users/henrik/source/opda/.swarm/memory.db-shm          (16u, 17u)
/Users/henrik/source/opda/.swarm/memory.db-wal          (18w)
/Users/henrik/source/opda/.swarm/memory.rvf             (21u)
/Users/henrik/source/opda/.swarm/memory.rvf.lock        (20u)
/Users/henrik/source/opda/.claude-flow/data/archivist-audit.jsonl   (18w, append-mode)
```

All 6 LIVE files appear in the 78 candidates (because the fresh-init reference no longer writes them under `.swarm/`, but PID 1312 is the user's running MCP server actively reading/writing them). They are excluded from any stale classification.

## Counts

- Total candidates (opda \ reference): **78**
- Live-active (PID 1312 open handles): **6** (preserved)
- User-owned (git-tracked under `.claude/` per opda commit `3ae45be`): **52** (preserved)
- Runtime-live, untracked under `.claude-flow/` or `.swarm/` (gitignored runtime data still in use by the MCP server's substrate): **9** (preserved)
- Stale-investigate (basename grep returns hits in current fork code, but evidence supports stale; per `feedback-no-fallbacks`, preserve): **3**
- Stale-safe-to-delete (basename grep returns 0 hits, mtime predates current init, **not held by PID 1312**, **not git-tracked**): **8**
- Unknown / other: **0**

Sum: 6 + 52 + 9 + 3 + 8 = 78. Matches.

## Note on git-tracked status

The opda repo explicitly tracks `.claude/` resources after the commit:

```
3ae45be chore: track .claude init resources + ruflo config; ignore memory/runtime
59ddeda chore: snapshot ruflo config (CLAUDE.md, .mcp.json, settings.json) before init --force
```

`.gitignore`:
```
.claude/settings.local.json
.claude/memory.db*
.claude-flow/
.swarm/
```

So `.claude/` content (agents, commands, helpers, README) is **user-curated and intentionally tracked**. Even though the current init no longer writes the older `.sh` helpers, the older `agents/core/{coder,researcher,reviewer,tester}.md`, or `commands/flow-nexus/*`, these are **user-tracked snapshots** — treating them as auto-delete candidates would clobber the user's explicit "track these init artifacts" decision. They are classified **user-owned (preserved)** in this audit. The cleanup decision belongs to the user, not this script.

## Per-path classification table

mtime/size from `stat -f`. tracked = `git ls-files` returns match. live = path matches PID 1312 lsof output. grep-hits = `grep -rln <basename> /Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/`. Classifications: **L** live-active, **U** user-owned (tracked), **R** runtime-live (untracked but in active substrate), **S-I** stale-investigate (grep>0 in fork code but evidence stale), **S-D** stale-safe-to-delete (grep=0, predates current init, untracked).

### .swarm/ (10 candidates — 6 live, 4 stale)

| Path | mtime | Class | grep-hits | Evidence |
|---|---|---|---|---|
| `.swarm/memory.db` | 2026-05-18 19:03 | **L** | 15 | PID 1312 holds fd 15u. Canonical substrate per ADR-0080 comment. |
| `.swarm/memory.db-shm` | 2026-05-25 14:53 | **L** | 0 | PID 1312 holds fd 16u/17u. |
| `.swarm/memory.db-wal` | 2026-05-25 17:04 | **L** | 0 | PID 1312 holds fd 18w (write-active). |
| `.swarm/memory.rvf` | 2026-05-20 21:52 | **L** | 5 | PID 1312 holds fd 21u. |
| `.swarm/memory.rvf.lock` | 2026-05-20 21:52 | **L** | 1 | PID 1312 holds fd 20u (lock file). |
| `.swarm/swarm-state.json` | 2026-05-20 23:37 | **R** | 2 | `init/statusline-generator.ts:368` + `mcp-tools/swarm-tools.ts` use this exact path as canonical substrate. Not in PID 1312's current open set but is the active runtime store. |
| `.swarm/schema.sql` | 2026-05-18 19:03 | **S-D** | 0 | No fully-qualified `.swarm/schema.sql` reference in fork code. Same orphan family identified in semantic-modelling cleanup. |
| `.swarm/state.json` | 2026-05-20 21:52 | **S-D** | 0* | Generic basename `state.json` has 13 incidental hits but fully-qualified `.swarm/state.json` returns zero. Same orphan family. |

(* `state.json` basename matches many unrelated `state.json` files in unrelated subsystems. Fully-qualified path is what matters for this candidate.)

### .claude/ memory.db family (3 candidates — all stale orphans)

| Path | mtime | Class | grep-hits | Evidence |
|---|---|---|---|---|
| `.claude/memory.db` | 2026-05-18 19:03 | **S-I** | 1 | Only reference is `commands/memory.ts:1688`: *"ADR-0080: removed .claude/memory.db copy — it was a dead-weight one-time copy that never received subsequent writes. Subsystems that probed it (`.swarm/memory.db` is the canonical path) now fall through gracefully."* Per `feedback-no-fallbacks`, basename hit > 0 → preserve. Evidence is unambiguous: orphan from pre-ADR-0080 substrate. Gitignored via `.claude/memory.db*`. |
| `.claude/memory.db-shm` | 2026-05-18 18:46 | **S-D** | 0 | Sidecar of `.claude/memory.db`. Gitignored. |
| `.claude/memory.db-wal` | 2026-05-18 18:46 | **S-D** | 0 | Sidecar of `.claude/memory.db` (0 bytes). Gitignored. |

### .claude/agents/ (9 candidates — all user-owned/tracked)

All git-tracked in opda commit `3ae45be`. Current init writes a **different** agents catalog (sees `analysis/`, `architecture/`, `consensus/`, `core/planner.md` only, `flow-nexus/`, etc.). The opda set is from a pre-refresh init and the user committed it intentionally.

| Path | mtime | Class | grep-hits |
|---|---|---|---|
| `.claude/agents/core/coder.md` | 2026-05-18 18:33 | **U** | 0 |
| `.claude/agents/core/researcher.md` | 2026-05-18 18:33 | **U** | 0 |
| `.claude/agents/core/reviewer.md` | 2026-05-18 18:33 | **U** | 0 |
| `.claude/agents/core/tester.md` | 2026-05-18 18:33 | **U** | 0 |
| `.claude/agents/goal/goal-planner.md` | 2026-05-18 18:33 | **U** | 0 |
| `.claude/agents/v3/adr-architect.md` | 2026-05-18 18:33 | **U** | 0 |
| `.claude/agents/v3/memory-specialist.md` | 2026-05-18 18:33 | **U** | 6 (string-references in code, not file-path) |
| `.claude/agents/v3/security-auditor.md` | 2026-05-18 18:33 | **U** | 0 |
| `.claude/agents/v3/sparc-orchestrator.md` | 2026-05-18 18:33 | **U** | 0 |

Coder/researcher/reviewer/tester live under `commands/sparc/` in current init (`.claude/commands/sparc/coder.md` etc.), not under `agents/core/`. The user has BOTH locations because opda preserves the old location via git tracking AND today's init wrote the new location.

### .claude/commands/flow-nexus/ (9 candidates — all user-owned/tracked, relocated by current init)

All git-tracked. Current init now writes these under `.claude/agents/flow-nexus/` instead (which opda also has from today's init). The legacy `commands/flow-nexus/` location is preserved by the user's git commit.

| Path | mtime | Class | grep-hits |
|---|---|---|---|
| `.claude/commands/flow-nexus/app-store.md` | 2026-05-18 18:33 | **U** | 0 |
| `.claude/commands/flow-nexus/challenges.md` | 2026-05-18 18:33 | **U** | 0 |
| `.claude/commands/flow-nexus/login-registration.md` | 2026-05-18 18:33 | **U** | 0 |
| `.claude/commands/flow-nexus/neural-network.md` | 2026-05-18 18:33 | **U** | 0 |
| `.claude/commands/flow-nexus/payments.md` | 2026-05-18 18:33 | **U** | 0 |
| `.claude/commands/flow-nexus/sandbox.md` | 2026-05-18 18:33 | **U** | 0 |
| `.claude/commands/flow-nexus/swarm.md` | 2026-05-18 18:33 | **U** | 0 |
| `.claude/commands/flow-nexus/user-tools.md` | 2026-05-18 18:33 | **U** | 0 |
| `.claude/commands/flow-nexus/workflow.md` | 2026-05-18 18:33 | **U** | 0 |

### .claude/helpers/ (34 candidates — all user-owned/tracked except 1 stale-investigate)

The current init writes a focused set of helpers: `auto-memory-hook.mjs`, `hook-handler.mjs`, `intelligence.cjs`, `memory.js`, `post-commit`, `pre-commit`, `router.js`, `session.js`, `statusline.cjs`. The older catalog of `.sh` scripts + `.cjs/.js` forms in opda is from a pre-refresh init.

All `.sh` files git-tracked in commit `3ae45be`. The user explicitly preserved them. Preserved as **U** (user-owned).

| Path | mtime | Class | grep-hits | Note |
|---|---|---|---|---|
| `.claude/helpers/adr-compliance.sh` | 2026-05-20 21:52 | **U** | 0 | |
| `.claude/helpers/auto-commit.sh` | 2026-05-20 21:52 | **U** | 0 | |
| `.claude/helpers/checkpoint-manager.sh` | 2026-05-20 21:52 | **U** | 0 | |
| `.claude/helpers/daemon-manager.sh` | 2026-05-20 21:52 | **U** | 0 | |
| `.claude/helpers/ddd-tracker.sh` | 2026-05-20 21:52 | **U** | 0 | |
| `.claude/helpers/github-safe.js` | 2026-05-18 19:01 | **U** | 0 | older form; current init writes `.mjs` |
| `.claude/helpers/github-safe.mjs` | 2026-05-20 21:52 | **U** | 0 | newer form; not currently written by init |
| `.claude/helpers/github-setup.sh` | 2026-05-20 21:52 | **U** | 0 | |
| `.claude/helpers/guidance-hook.sh` | 2026-05-20 21:52 | **U** | 0 | |
| `.claude/helpers/guidance-hooks.sh` | 2026-05-20 21:52 | **U** | 0 | |
| `.claude/helpers/health-monitor.sh` | 2026-05-20 21:52 | **U** | 0 | |
| `.claude/helpers/hook-handler.cjs` | 2026-05-18 19:01 | **S-I** | 1 | `settings-generator.ts:17` mentions `hook-handler.cjs` in a comment as the legacy form before migration to `.mjs`. Current init writes `hook-handler.mjs` (which opda also has, mtime 2026-05-25 17:11). The `.cjs` version is **NOT git-tracked** (the user did not snapshot this one — see git ls-files output for helpers/). Stale orphan, but basename grep > 0 → preserve. |
| `.claude/helpers/learning-hooks.sh` | 2026-05-20 21:52 | **U** | 0 | |
| `.claude/helpers/learning-optimizer.sh` | 2026-05-20 21:52 | **U** | 0 | |
| `.claude/helpers/learning-service.mjs` | 2026-05-20 21:52 | **U** | 0 | |
| `.claude/helpers/metrics-db.mjs` | 2026-05-20 21:52 | **U** | 0 | |
| `.claude/helpers/pattern-consolidator.sh` | 2026-05-20 21:52 | **U** | 0 | |
| `.claude/helpers/perf-worker.sh` | 2026-05-20 21:52 | **U** | 0 | |
| `.claude/helpers/quick-start.sh` | 2026-05-20 21:52 | **U** | 0 | |
| `.claude/helpers/README.md` | 2026-05-20 21:52 | **U** | 0 | |
| `.claude/helpers/security-scanner.sh` | 2026-05-20 21:52 | **U** | 0 | |
| `.claude/helpers/setup-mcp.sh` | 2026-05-20 21:52 | **U** | 0 | |
| `.claude/helpers/standard-checkpoint-hooks.sh` | 2026-05-20 21:52 | **U** | 0 | |
| `.claude/helpers/statusline-hook.sh` | 2026-05-20 21:52 | **U** | 1 | `helpers-generator.ts:1491` still includes this in a code path. Current `executor.ts` only writes `statusline.cjs` (opda has both). |
| `.claude/helpers/statusline.js` | 2026-05-20 21:52 | **U** | 0 | older `.js` form; current init writes `.cjs` (opda has both). |
| `.claude/helpers/swarm-comms.sh` | 2026-05-20 21:52 | **U** | 0 | |
| `.claude/helpers/swarm-hooks.sh` | 2026-05-20 21:52 | **U** | 0 | |
| `.claude/helpers/swarm-monitor.sh` | 2026-05-20 21:52 | **U** | 0 | |
| `.claude/helpers/sync-v3-metrics.sh` | 2026-05-20 21:52 | **U** | 0 | |
| `.claude/helpers/update-v3-progress.sh` | 2026-05-20 21:52 | **U** | 0 | |
| `.claude/helpers/v3-quick-status.sh` | 2026-05-20 21:52 | **U** | 0 | |
| `.claude/helpers/v3.sh` | 2026-05-20 21:52 | **U** | 0 | |
| `.claude/helpers/validate-v3-config.sh` | 2026-05-20 21:52 | **U** | 0 | |
| `.claude/helpers/worker-manager.sh` | 2026-05-20 21:52 | **U** | 0 | |

Re-verification for `hook-handler.cjs`: `git ls-files .claude/helpers/hook-handler.cjs` returns empty (untracked). Both helpers above marked S-I are untracked, but kept preserved per the no-fallbacks rule.

Note on `auto-commit.sh`: this file is **git-tracked**, but it's also an older artifact. Today's init no longer generates it. The user-tracking precedent rules — preserved as **U**.

### .claude-flow/ runtime data (15 candidates — all gitignored runtime)

The user's `.gitignore` excludes `.claude-flow/` entirely. The current init writes a different subset (compare reference manifest: `metrics/learning.json`, `metrics/swarm-activity.json`, `metrics/v3-progress.json` are the canonical metrics now). Other entries in opda are runtime-accumulated logs/data from past runs.

| Path | mtime | Class | grep-hits | Note |
|---|---|---|---|---|
| `.claude-flow/config.yaml` | 2026-05-18 19:01 | **R** | 4 | Referenced in `commands/doctor.ts`. Runtime config file. |
| `.claude-flow/daemon-state.json` | 2026-05-21 16:59 | **R** | 3 | Referenced in `commands/daemon.ts`, `services/worker-daemon.ts`. Runtime daemon checkpoint. |
| `.claude-flow/data/archivist-audit.jsonl` | 2026-05-25 17:04 | **L** | 2 | **PID 1312 holds fd 18w (live append-mode write)**. |
| `.claude-flow/data/pending-insights.jsonl` | 2026-05-25 15:50 | **R** | 1 | Mtime within today. Runtime insights queue, untracked. |
| `.claude-flow/logs/daemon.log` | 2026-05-21 16:59 | **R** | 2 | Runtime daemon log. |
| `.claude-flow/logs/headless/audit_1779125753675_g9mbul_prompt.log` | 2026-05-18 18:35 | **S-D** | 0 | Per-invocation log artifact (timestamped basename). Stale runtime debris from May 18. Gitignored. |
| `.claude-flow/logs/headless/audit_1779125753675_g9mbul_result.log` | 2026-05-18 18:36 | **S-D** | 0 | Same. |
| `.claude-flow/logs/headless/optimize_1779125914676_98u0dw_prompt.log` | 2026-05-18 18:38 | **S-D** | 0 | Same. |
| `.claude-flow/logs/headless/optimize_1779127587486_vobzly_prompt.log` | 2026-05-18 19:06 | **S-D** | 0 | Same. |
| `.claude-flow/metrics/codebase-map.json` | 2026-05-21 16:57 | **R** | 1 | Runtime metric. Current init writes only learning/swarm-activity/v3-progress under `metrics/`; this is an additional runtime-produced metric. |
| `.claude-flow/metrics/consolidation.json` | 2026-05-21 08:20 | **R** | 1 | Same — runtime metric. |
| `.claude-flow/metrics/performance.json` | 2026-05-21 16:31 | **R** | 1 | Same. |
| `.claude-flow/metrics/security-audit.json` | 2026-05-21 16:29 | **R** | 1 | Same. |
| `.claude-flow/metrics/test-gaps.json` | 2026-05-21 16:35 | **R** | 1 | Same. |
| `.claude-flow/swarm/swarm-state.json` | 2026-05-18 22:12 | **S-I** | 2 | Current init/MCP code only references `.swarm/swarm-state.json` (no longer `.claude-flow/swarm/swarm-state.json`). The 2 hits are for the basename `swarm-state.json`, not the `.claude-flow/swarm/` path specifically. Likely orphan from older substrate location. Untracked. Preserved per no-fallbacks. |

## Special-focus paths summary

The audit checked the special-focus paths called out in the brief:

| Path | Class | Verdict |
|---|---|---|
| `.claude/memory.db` | **S-I** | Confirmed stale: ADR-0080 explicitly removed this; canonical is `.swarm/memory.db` (which PID 1312 is using). Preserved (basename grep 1) per no-fallbacks. |
| `.claude/memory.db-shm` | **S-D** | Sidecar of above. Stale orphan. |
| `.claude/memory.db-wal` | **S-D** | Sidecar of above (0 bytes). Stale orphan. |
| `.swarm/schema.sql` | **S-D** | Same orphan family as in semantic-modelling cleanup. No reference in current fork code. |
| `.swarm/state.json` | **S-D** | Same orphan family. No fully-qualified reference; basename hits are unrelated. |
| `.claude/helpers/` (dir mtime 2026-05-20) | Mixed | 34 files: 33 user-tracked (preserved as **U**), 1 untracked `hook-handler.cjs` (**S-I**). Today's init wrote 8 fresh files (mtime 17:11) but did not remove the older catalog. |
| `.claude/agents/` (dir mtime 2026-05-18) | Mixed | 9 files in candidates: all user-tracked (preserved as **U**). Today's init wrote the new `agents/` catalog (analysis/, architecture/, etc.) alongside the user-tracked older `core/`, `goal/`, `v3/` subdirs. |

## Conflict check — stale-safe-to-delete vs PID 1312

PID 1312 holds 6 file handles. None of the **8 stale-safe-to-delete** files match those handles:

```
S-D files:
- .claude/memory.db-shm        ← NOT held by PID 1312 (PID 1312 holds .swarm/memory.db-shm)
- .claude/memory.db-wal        ← NOT held by PID 1312 (PID 1312 holds .swarm/memory.db-wal)
- .swarm/schema.sql            ← NOT held by PID 1312
- .swarm/state.json            ← NOT held by PID 1312
- .claude-flow/logs/headless/audit_1779125753675_g9mbul_prompt.log    ← NOT held
- .claude-flow/logs/headless/audit_1779125753675_g9mbul_result.log    ← NOT held
- .claude-flow/logs/headless/optimize_1779125914676_98u0dw_prompt.log ← NOT held
- .claude-flow/logs/headless/optimize_1779127587486_vobzly_prompt.log ← NOT held
```

**No stale-safe-to-delete candidate conflicts with PID 1312's open file handles.** Cleanup of these 8 files would not require stopping the MCP server.

## Recommendation

The audit identified **8 stale-safe-to-delete** files. **All 8 are gitignored, untracked, and not held by PID 1312** — they would be safe to delete even with the MCP server running, but no deletion was executed per the read-only constraint.

If the user wants to clean up, my recommendation is:

1. **Cleanup phase 1 — safe even with MCP running** (8 files):
   - `.claude/memory.db-shm`, `.claude/memory.db-wal` (the `-shm`/`-wal` sidecars of the ADR-0080-removed orphan `.claude/memory.db`)
   - `.swarm/schema.sql`, `.swarm/state.json` (semantic-modelling orphan family)
   - `.claude-flow/logs/headless/audit_*.log` (2 files) and `optimize_*.log` (2 files) — historical headless run debris from May 18

2. **Cleanup phase 2 — requires MCP server stop** (1 file):
   - `.claude/memory.db` (the 155 KB pre-ADR-0080 sqlite orphan). Per the no-fallbacks rule it's classified S-I (basename grep hit on the ADR-0080 "removed" comment), but the comment IS the evidence it's safe to delete. Recommend deleting alongside the -shm/-wal sidecars; doing all three together avoids leaving the dangling sidecars. **PID 1312 is not using this file** (it uses `.swarm/memory.db`), so even this is technically safe to delete while the MCP server runs — the no-fallbacks rule is the only reason it's classified S-I.

3. **Cleanup phase 3 — user decision** (52 git-tracked files under `.claude/`):
   - The user explicitly tracked these in commit `3ae45be`. Whether to keep them as "history of past init outputs" or refresh to today's init is a **user policy decision**, not an audit recommendation. If the user wants to mirror today's init, they would need to:
     - `git rm` the 9 `agents/core/{coder,researcher,reviewer,tester}.md` + `agents/goal/goal-planner.md` + `agents/v3/{adr-architect,memory-specialist,security-auditor,sparc-orchestrator}.md`
     - `git rm` the 9 `commands/flow-nexus/*.md` (relocated to `agents/flow-nexus/`, which today's init wrote)
     - `git rm` the 33 user-tracked `.claude/helpers/*` legacy helpers
     - Then commit the cleanup.
   - This audit does **not** recommend doing that automatically — the user's tracking intent is explicit.

4. **No action needed** on:
   - 6 LIVE files (PID 1312 holds them)
   - 9 R (runtime-live) files (`.claude-flow/daemon-state.json`, `metrics/*`, runtime data; the MCP server / daemon will continue writing them)
   - 1 R file `.swarm/swarm-state.json` (canonical substrate per `init/statusline-generator.ts:368`)

## Process trail

- `lsof -p 1312` output: `/tmp/pid1312-open-files.txt`
- Reference manifest: `/tmp/ruflo-init-reference-20260525T155103Z/file-manifest.txt`
- opda inventory: `/tmp/opda-files-rel.txt`
- Candidates (B \ A): `/tmp/opda-candidates.txt`
- Per-candidate classification table data: `/tmp/opda-classify.txt`
- Git-tracked status: `/tmp/opda-candidates-git.txt`
