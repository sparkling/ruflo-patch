# 2026-05-25 — semantic-modelling: migration to current ruflo

## Context

`/Users/henrik/source/hm/semantic-modelling` is a long-lived semantic-modelling
project that has gone through several `ruflo init` generations (Mar 20, Apr 9,
Apr 22, May 25). The current install pins `@sparkleideas/ruflo@latest` (today
patch.292 / cli patch.316) in `.mcp.json`, and a fresh init has been run, but
the on-disk state contains a mix of:

- Files that the current code paths still actively read or write (today).
- Files written by older init/runtime generations that current code no longer
  touches.
- User-owned content (project memory, settings overrides, custom agents).

This plan is the audit that grounds any future cleanup. **Nothing in this plan
deletes anything yet.** It classifies each path by traced code-evidence, then
specifies the migration steps (in order) and the safe-to-delete set (only after
the migration steps complete and verification passes).

A prior recommendation in this conversation almost suggested deleting
`.claude/memory/` (88 markdown files, Apr 7–27 mtimes) as "stale". The user
pushed back, noting that markdown files are likely ingested into the memory
system. Tracing the code confirmed the user was right: the memory ingestion
path resolves `~/.claude/projects/<projectKey>/memory/`, and for this project
that path is a **symlink** to `.claude/memory/` — they are physically the same
files. Per `feedback-trace-before-hypothesis` this audit is grounded in
specific source lines, not inference.

## Memory ingestion architecture (traced)

### Path 1 — SessionStart hook → `auto-memory-hook.mjs import`

Reference: `.claude/settings.json` line 88 wires SessionStart to
`node .claude/helpers/auto-memory-hook.mjs import`.

The init-generated minimal `auto-memory-hook.mjs` is a fallback. When
`@sparkleideas/memory` (a.k.a. `@claude-flow/memory`) is installed (it is
transitively via `@sparkleideas/ruflo@latest`), `loadMemoryPackage()` returns
`AutoMemoryBridge`. The full bridge lives at
`forks/ruflo/v3/@claude-flow/memory/src/auto-memory-bridge.ts`.

`AutoMemoryBridge.importFromAutoMemory()` (line 377) reads from `memoryDir`,
which is resolved by `resolveAutoMemoryDir(workingDir)` at line 761:

```typescript
return path.join(
  process.env.HOME || process.env.USERPROFILE || '~',
  '.claude',
  'projects',
  projectKey,  // workingDir with '/' replaced by '-'
  'memory',
);
```

For `/Users/henrik/source/hm/semantic-modelling`, `projectKey` is
`-Users-henrik-source-hm-semantic-modelling`, so the resolved path is
`/Users/henrik/.claude/projects/-Users-henrik-source-hm-semantic-modelling/memory`.

**That path is a symlink** (verified by `ls -la` returning `lrwxr-xr-x ... ->
/Users/henrik/source/hm/semantic-modelling/.claude/memory`). The symlink was
created 2026-03-22 22:06. `diff` between the symlink target and `.claude/memory/`
returns empty — they are the same directory.

**Conclusion**: every `.md` file in `.claude/memory/` IS ingested by the
SessionStart hook into AgentDB under namespace `auto-memory`, indexed for
semantic search via embeddings. Deleting `.claude/memory/` would delete the
source of `auto-memory` namespace data.

### Path 2 — MCP tool `memory_import_claude`

Reference: `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/memory-tools.ts:945`.

The tool reads from `join(homedir(), '.claude', 'projects')` (line 962) under
the current project's hash (line 985), or all projects when `allProjects: true`.
Stores under namespace `claude-memories` with content-hash dedup (lines
1009–1025).

For this project, the resolved path is the same symlinked memory dir; same
file set ingested.

### Path 3 — does anything read project-local `.claude/memory/` directly?

```bash
grep -rln '\.claude/memory' v3/@claude-flow/cli/src/
```

Returns exactly one hit: `commands/memory.ts:1688` —
`"ADR-0080: removed .claude/memory.db copy"` (a comment about a removed
behavior, not active code).

**Conclusion**: no current code reads `.claude/memory/` by that path. Ingestion
flows through `~/.claude/projects/<hash>/memory/`. For semantic-modelling, that
indirection is a symlink to `.claude/memory/`, so the project-local dir IS the
live source of truth — but via the symlink, not via direct path resolution.

### Path 4 — `.swarm/memory.rvf` (the RVF substrate)

Reference: `forks/ruflo/v3/@claude-flow/cli/src/init/executor.ts:1484`
(ADR-0080) writes `databasePath: '.swarm/memory.rvf'` into `embeddings.json`.

The project's `.claude-flow/embeddings.json` (refreshed today) line 11
confirms `"databasePath": ".swarm/memory.rvf"`. The file mtime is May 25
16:12 — actively written today.

`.claude-flow/memory.rvf` (note: NOT `.claude-flow/data/memory.rvf`; the
top-level one) at 1.2 MB Apr 15 is the **pre-ADR-0165-B2 default**:
`forks/.../commands/embeddings.ts:708-711` documents that when
`embeddings.json` was missing the storage keys (which it was in older inits),
the resolver fell back to `DEFAULT_DATABASE_PATH = '.claude-flow/memory.rvf'`
(`forks/.../memory/src/resolve-config.ts:100`). The fix is ADR-0165 B2; the
file is the orphan from the buggy window.

### Path 5 — `.swarm/memory.db` (SQLite carve-out controllers)

Reference: `forks/ruflo/v3/@claude-flow/cli/src/memory/archivist-init.ts:1649`
shows `swarmDbPath = join(root, '.swarm', 'memory.db')` — actively used.

Per ADR-0181 Phase 7, `.swarm/memory.db` is the SQLite substrate for the
ADR-0181 carve-out controllers (`episodes`, `skills`, `skill_embeddings`,
`hierarchical_memory`). Schema is provisioned by `AgentDB.loadSchemas()`
embedded in `forks/agentdb/src/core/AgentDB.ts:209` — it reads from
`agentdb/src/schemas/schema.sql` shipped INSIDE the package (NOT from any
file in the project directory).

**The project's `.swarm/memory.db` is corrupt** (`sqlite3` returns
"database disk image is malformed"). This is a risk because:

1. `loadSchemas()` runs `CREATE TABLE IF NOT EXISTS` against the existing
   file — would fail on a corrupt page.
2. There is no corrupt-recovery code path in either CLI or agentdb (per
   `feedback-no-fallbacks`, this is intentional — operators must surface
   corruption, not silently re-create).

### Path 6 — `.swarm/memory.graph`, `.swarm/schema.sql`

Search `grep -rn 'memory\.graph' forks/` returns exactly one hit:
`statusline-generator.ts:552` which checks `data/memory.graph` (relative to
cwd), NOT `.swarm/memory.graph`. The path `<cwd>/data/memory.graph` is not
emitted by current init.

Search `grep -rn 'schema\.sql' forks/` returns only `AgentDB.ts:210` which
reads from `<agentdb pkg>/src/schemas/schema.sql` shipped in the package
— never reads `.swarm/schema.sql`.

`diff` between the project's `.swarm/schema.sql` and
`forks/agentdb/src/schemas/schema.sql` shows the project file is a **legacy
pre-v3 RuFlo schema** (header: "RuFlo V3 Memory Database / Version: 3.0.0")
with `memory_entries`/`patterns` tables that are not part of the current
AgentDB carve-out schema (episodes, skills, hierarchical_memory).

### Path 7 — `.swarm/swarm-state.json`, `.swarm/state.json`

Reference: `forks/.../mcp-tools/swarm-tools.ts:62` and `loadSwarmStore()` —
`.swarm/swarm-state.json` is the canonical swarm coordination file, actively
read/written.

`.swarm/state.json` (not `swarm-state.json`) is the older hive-mind state.
Search `grep -n state\.json` shows `mcp-tools/hive-mind-tools.ts:64`:
`const HIVE_FILE = 'state.json'` — but this is the LOCKED hive-state location
in a different directory tree (`.hive-mind/state.json`), not `.swarm/state.json`.
The project's `.swarm/state.json` (191 bytes, Apr 22, contains a swarm
descriptor) is consistent with the old `swarm init` writer that stored a
single-swarm record in `.swarm/state.json` before the multi-swarm
`.swarm/swarm-state.json` format landed.

### Path 8 — `.claude-flow/data/*` files

All six files (`archivist-audit.jsonl`, `auto-memory-store.json`,
`graph-state.json`, `intelligence-snapshot.json`, `pending-insights.jsonl`,
`ranked-context.json`) have mtimes from today (May 25). Managed by the
archivist and intelligence subsystems — all **live**.

## File-by-file classification

| Path | mtime | Classification | Reason | Action |
|---|---|---|---|---|
| `.claude/memory/` (88 files) | Apr 7 – Apr 27 | **active** | Ingested via `~/.claude/projects/<hash>/memory` symlink (auto-memory-bridge.ts:761 + ls -la confirms symlink) | preserve verbatim |
| `.claude/agents/` (30 categories) | Mar 20 – Apr 21 | **active (mixed)** | init copies on first-touch only (executor.ts:1111 `existsSync` check); contains user-custom `custom/` subdir + project-specific `yaml-model-*` agents not in upstream catalog | preserve; refresh non-custom subdirs via `init --force` only if user wants new V3 agents |
| `.claude/agents/custom/` | Apr 21 | **user-owned** | User-defined agents, not in upstream catalog | preserve verbatim |
| `.claude/agents/yaml-model-{adjudicator,validator-*}.md` | Mar 20 | **user-owned** | Project-specific (semantic-modelling/YAML validation), not in upstream agent catalog | preserve verbatim |
| `.claude/commands/` (23 entries) | refreshed today | **active** | init refreshed today | as-is |
| `.claude/helpers/` (mixed) | Apr 22 + today | **active (mixed)** | `auto-memory-hook.mjs` refreshed today, others Apr 22; init refresh path (executor.ts:508 `criticalHelpers`) only re-emits 3 specific helpers, leaves rest stale | preserve; consider `init --force` if helpers like `intelligence.cjs` are running stale logic |
| `.claude/helpers/auto-memory-hook.mjs` | today 16:12 | **active** | Refreshed by today's init (executor.ts:269) | as-is |
| `.claude/projects/` | Mar 23 | **unknown** | Project-local mirror of the `-Users-henrik-source-hm-semantic-modelling/memory/project-constraints.md` file (1 file, 1323 bytes); not scaffolded by init (search of `init/` shows no writer); appears to be hand-created project-local copy of project-constraint memory | preserve-pending-investigation |
| `.claude/skills/` (38 dirs) | Mar 20 + today | **active (mixed)** | Refreshed today (`dual-mode` is today's mtime) but most are Mar 20 — same init skip-if-exists semantics as agents | preserve; consider `init --force` |
| `.claude/scripts/check-patches.sh` | today | **active** | Refreshed today | as-is |
| `.claude/settings.json` | today 16:12 | **active** | Refreshed today | as-is |
| `.claude/settings.local.json` | Apr 16 | **user-owned** | Contains project-specific bash permissions (git submodule, hook-h.cjs probe paths) | preserve verbatim |
| `.claude/worktrees/` (8 dirs) | today | **active** | git worktrees for parallel claude sessions | as-is |
| `.swarm/memory.rvf` | today 16:12 | **active** | Live RVF substrate per ADR-0080 (`embeddings.json` line 11 confirms `databasePath: .swarm/memory.rvf`) | as-is |
| `.swarm/memory.rvf.lock` | today | **active** | RVF lock sentinel | as-is |
| `.swarm/memory.db` | Apr 22 | **active but corrupt** | ADR-0181 Phase 7 carve-out SQLite substrate (archivist-init.ts:1649); `sqlite3` reports "database disk image is malformed" — **blocks** ReflexionMemory/SkillLibrary/HierarchicalMemory controllers from initializing | **delete-with-backup-and-let-loadSchemas-recreate** (see Migration Step 2) |
| `.swarm/memory.graph` | Apr 4 (1.5 MB) | **orphan** | `grep -rn memory\.graph` returns zero hits in `.swarm/`-relative code; only hit is `statusline-generator.ts:552` checking `<cwd>/data/memory.graph` | safe-to-delete after Step 5 verification |
| `.swarm/schema.sql` | Apr 4 | **orphan** | `loadSchemas()` (AgentDB.ts:210) reads from `<pkg>/schemas/schema.sql`, NEVER from `.swarm/schema.sql`; `diff` confirms the project file is pre-v3 RuFlo schema (different tables) | safe-to-delete after Step 5 verification |
| `.swarm/state.json` | Apr 22 | **unknown** | Single-swarm legacy state (predates `.swarm/swarm-state.json` multi-swarm format); no grep hit on `.swarm/state.json` exactly (only `.hive-mind/state.json` and `<cwd>/swarm-state.json`) | preserve-pending-investigation |
| `.swarm/swarm-state.json` | Apr 22 | **active** | `loadSwarmStore()` reads via `SWARM_STATE_FILE = 'swarm-state.json'` (swarm-tools.ts:62) | as-is |
| `.claude-flow/memory.rvf` | Apr 15 (1.2 MB) | **orphan** | Pre-ADR-0165-B2 default path; current code resolves to `.swarm/memory.rvf` via embeddings.json override | safe-to-delete after Step 4 + 5 verification |
| `.claude-flow/memory.rvf.meta` | Apr 15 (1.2 MB) | **orphan** | Sidecar of the orphan above | safe-to-delete with `.claude-flow/memory.rvf` |
| `.claude-flow/data/*` (6 files) | today | **active** | All today's mtimes; archivist + intelligence | as-is |
| `.claude-flow/sessions/current.json` | today | **active** | Current session record | as-is |
| `.claude-flow/sessions/session-*.json` (10 files) | Apr 17 – Apr 28 | **historical (unread)** | Append-only history; no current read path located | preserve-pending-investigation |
| `.claude-flow/sessions/undefined.json` | Apr 28 | **orphan-suspect** | Filename suggests a writer bug; no read path | preserve-pending-investigation |
| `.claude-flow/{agents,daa,embeddings.json,config.json,config.yaml,hive-mind,hooks,learning,logs,metrics,models,neural,security,workflows}` | various | **active or empty** | All today (refreshed) or current-active | as-is |
| `.ruflo-project` | today | **active** | Canonical project marker (per memory-router.ts:323-385) | as-is |
| `CLAUDE.md` | today | **active** | Refreshed by today's init | as-is |
| `.mcp.json` | today | **active** | `npx -y @sparkleideas/ruflo@latest mcp start`; env vars `CLAUDE_FLOW_MAX_AGENTS=15`, `CLAUDE_FLOW_SWARM_TOPOLOGY=hierarchical-mesh`, `CLAUDE_FLOW_MEMORY_TYPE=hybrid` all match loader.ts:80/103/142 valid values | as-is |
| `~/.claude/projects/-Users-henrik-source-hm-semantic-modelling/memory/` | (symlink) | **active** | Symlink to `.claude/memory/` — see Path 1 above | as-is (symlink, do not delete) |
| `~/.claude/projects/-Users-henrik-source-hm-main2-semantic-modelling/memory/` | (symlink) | **active-orphan** | Symlink to `/Users/henrik/source/hm/main2/semantic-modelling/.claude/memory/` (15 files, last touched Apr 3). Path is a stale rename hash; ingestion under `allProjects=true` deduplicates by content hash (memory-tools.ts:1009-1025), so the 15 historic files DO get imported when running `--allProjects` (with dedup against the current 88) | preserve-pending-investigation |

## Migration steps (ordered)

Each step has a verification check. Run in order; do not proceed past a failed
verification.

### Step 1 — snapshot current state

```bash
SNAP_DIR=/tmp/semantic-modelling-snapshot-$(date +%Y%m%d-%H%M%S)
mkdir -p "$SNAP_DIR"
cp -R /Users/henrik/source/hm/semantic-modelling/.swarm "$SNAP_DIR/.swarm"
cp -R /Users/henrik/source/hm/semantic-modelling/.claude-flow "$SNAP_DIR/.claude-flow"
cp -R /Users/henrik/source/hm/semantic-modelling/.claude/memory "$SNAP_DIR/memory"
cp /Users/henrik/source/hm/semantic-modelling/.claude/settings.local.json "$SNAP_DIR/settings.local.json"
```

**Verify**: `du -sh "$SNAP_DIR"` returns a non-zero size.

**Rationale**: every subsequent step is reversible by `cp -R "$SNAP_DIR"/...
<project>/...`. Per `feedback-no-fallbacks`, we don't ship a code-level recovery
path — operator snapshots fill that role.

### Step 2 — handle the corrupt `.swarm/memory.db`

```bash
# Verify it is in fact corrupt (don't trust the audit blindly).
sqlite3 -readonly /Users/henrik/source/hm/semantic-modelling/.swarm/memory.db \
  "SELECT name FROM sqlite_master WHERE type='table';"
# Expected: error "database disk image is malformed"

# Move (not delete) so loadSchemas() recreates it cleanly.
mv /Users/henrik/source/hm/semantic-modelling/.swarm/memory.db \
   /Users/henrik/source/hm/semantic-modelling/.swarm/memory.db.corrupt-snapshot-$(date +%Y%m%d)
```

**Verify** (after step 5 starts the MCP server):

```bash
sqlite3 -readonly /Users/henrik/source/hm/semantic-modelling/.swarm/memory.db \
  "SELECT name FROM sqlite_master WHERE type='table';" | sort
# Expected non-empty table list including: episodes, skills, skill_embeddings,
# hierarchical_memory (per archivist-init.ts:1654)
```

**Rationale**: per Path 5 trace, the carve-out controllers (ReflexionMemory,
SkillLibrary, HierarchicalMemory) WILL fail to initialize against the corrupt
file. The cleanest path is to let `AgentDB.loadSchemas()` recreate it with
the current schema embedded in the agentdb package.

**Risk**: any episode/skill data previously stored in the corrupt file is
lost. Given file corruption pre-dates the v3 carve-out migration (Apr 22, 5
weeks before the Phase 7 wire-up), and `sqlite3` cannot read tables, that
data is already inaccessible — `mv` does not lose more than corruption
already did. The `.corrupt-snapshot` is retained for forensics.

### Step 3 — confirm `.claude/memory/` ingestion before any further changes

Before touching anything that could affect memory, verify the symlink chain
is intact and `memory_import_claude` can ingest:

```bash
# Confirm symlink target.
ls -la /Users/henrik/.claude/projects/-Users-henrik-source-hm-semantic-modelling/memory
# Expected: lrwxr-xr-x ... memory -> /Users/henrik/source/hm/semantic-modelling/.claude/memory

# Confirm files are reachable through the symlink.
ls /Users/henrik/.claude/projects/-Users-henrik-source-hm-semantic-modelling/memory/*.md | wc -l
# Expected: 88

# Optionally trigger import (read-only on .claude/memory/; writes to .swarm/memory.rvf):
# claude-flow memory_import_claude (via MCP) or
# the SessionStart hook firing on next claude open.
```

**Verify**: 88 markdown files reachable through the symlink path.

### Step 4 — migrate orphan `.claude-flow/memory.rvf` content into the live store (OPTIONAL)

`.claude-flow/memory.rvf` is 1.2 MB of RVF data from the pre-ADR-0165-B2
window. If the operator cares about preserving any patterns/entries written
between Apr 15 and the May fix, run:

```bash
# There is no "merge RVF into RVF" tool. The closest path is to dump entries
# from the orphan via the API and re-store into the live path. Since both
# files use the same RVF format and the same embedding dimensions, an
# operator-side script can:
#   1. Open .claude-flow/memory.rvf via @sparkleideas/memory RvfBackend
#      with explicit databasePath override.
#   2. Iterate listEntries() and call memory_store on each, which writes to
#      the canonical .swarm/memory.rvf.
# This is NOT a one-line operation and is OPTIONAL.
```

**Verify (when run)**: post-migration `memory_search` for known entries returns
results; pre/post entry counts comparable.

**Decision**: if operator does not need the historical content, skip this step
and proceed to Step 5 (the orphan can be removed in cleanup).

### Step 5 — verify post-migration health

```bash
# 1. Symlinked .claude/memory/ still reachable.
ls /Users/henrik/.claude/projects/-Users-henrik-source-hm-semantic-modelling/memory/ | wc -l
# Expected: 88

# 2. Live RVF store at canonical path.
ls -la /Users/henrik/source/hm/semantic-modelling/.swarm/memory.rvf
# Expected: > 0 bytes, today's mtime after server activity.

# 3. SQLite substrate recreated by loadSchemas().
sqlite3 -readonly /Users/henrik/source/hm/semantic-modelling/.swarm/memory.db \
  "SELECT name FROM sqlite_master WHERE type='table';" | sort
# Expected: episodes, skills, skill_embeddings, hierarchical_memory (+ others)

# 4. MCP server starts cleanly.
# (Manual: open claude in the project, watch for MCP init errors in the log.)

# 5. memory_search returns sensible results for a known query.
# (Manual: via MCP tool — try searching for content from .claude/memory/*.md)
```

**Verify**: all five checks pass. If any fail, restore from the snapshot in
Step 1 and stop — do not proceed to cleanup.

## Safe-to-delete list (with evidence per item)

**Only after Steps 1–5 complete and verification passes.** Each item below has
a specific code-evidence reference for why nothing reads it.

| Path | Size | Evidence | Confidence |
|---|---|---|---|
| `.swarm/schema.sql` | 9.2 KB | `loadSchemas()` (AgentDB.ts:210) reads from `<pkg>/src/schemas/schema.sql` only; `grep -rn schema.sql forks/` returns no hit on `.swarm/schema.sql`. The project file is a pre-v3 RuFlo schema (different tables); diff confirms incompatibility. | **high** |
| `.swarm/memory.graph` | 1.5 MB | `grep -rn memory\.graph forks/` returns one hit at `statusline-generator.ts:552` which checks `<cwd>/data/memory.graph` (NOT `.swarm/memory.graph`); no init writes this path. | **high** |
| `.claude-flow/memory.rvf` | 1.2 MB | Pre-ADR-0165-B2 orphan; current `embeddings.json` line 11 redirects all writes to `.swarm/memory.rvf`. | **high** (after Step 4 decision) |
| `.claude-flow/memory.rvf.meta` | 1.2 MB | Sidecar of the same orphan. | **high** (paired with above) |
| `.swarm/memory.db.corrupt-snapshot-*` | 316 KB | Snapshot of corrupt file moved in Step 2; only kept for forensics. | **high** (after operator confirms forensic value exhausted) |

**Total reclaimable**: ~4 MB (small in absolute terms; the value is in not
having broken-looking files in the project root, NOT in disk savings).

## Risks

1. **`.claude/projects/-Users-henrik-source-hm-semantic-modelling/memory/project-constraints.md`** —
   project-local mirror of one specific memory file. Classification: **unknown**.
   Not scaffolded by init (search of `init/` returns no writer). Could be (a)
   a hand-created override pinned to a specific project hash, (b) artifact
   of an old symlink that was later replaced. Per `feedback-no-fallbacks`,
   do **not** delete until traced.

2. **`.swarm/state.json`** — single-swarm legacy state predates
   `swarm-state.json`. Classification: **unknown**. No clear read path
   located, but the file is small (191 bytes) and may be referenced by an
   older MCP tool not searched. Preserve.

3. **`.claude-flow/sessions/session-*.json`** (10 historic files) and
   `undefined.json` — append-only history. Classification:
   **historical (unread)**. The filename `undefined.json` suggests a writer
   bug at some point. No read path located in CLI source. Preserve until a
   session-history reader is confirmed not to exist.

4. **`~/.claude/projects/-Users-henrik-source-hm-main2-semantic-modelling/memory/`** —
   symlink to `/Users/henrik/source/hm/main2/semantic-modelling/.claude/memory/`
   (15 files, last touched Apr 3). The "main2" path no longer corresponds to
   the active project root, BUT under `memory_import_claude --allProjects`,
   these 15 files DO get imported (dedup by content hash skips matches with
   the current 88, so the net effect is only ingesting the 15 minus dedup
   overlap). Classification: **active-orphan**. Preserve.

5. **`.claude/agents/`** — old Mar 20 / Apr 9 mtimes mean most agent
   definitions predate today's catalog. `init`'s skip-if-exists semantics
   (executor.ts:1111) mean they were NOT refreshed today. The user-custom
   `custom/` and `yaml-model-*` agents MUST be preserved; a fresh
   `init --force` would refresh upstream-catalog dirs but is opt-in.

6. **Step 2 data loss boundary** — moving the corrupt `.swarm/memory.db`
   loses whatever data was in it, but the file was already unreadable
   (`sqlite3` errors on `sqlite_master`), so this is making explicit a loss
   that had already occurred.

## Verification

After all migration steps complete, the following must all hold:

1. **`.claude/memory/` reachable via symlink**: `ls /Users/henrik/.claude/projects/-Users-henrik-source-hm-semantic-modelling/memory/ | wc -l` returns `88`.

2. **Carve-out SQLite tables provisioned**:
   ```sql
   SELECT name FROM sqlite_master WHERE type='table'
     AND name IN ('episodes','skills','skill_embeddings','hierarchical_memory');
   ```
   Returns 4 rows.

3. **Live RVF active**: `stat .swarm/memory.rvf` shows today's mtime after
   any `memory_store` / `memory_search` call.

4. **MCP server starts without errors**: Open claude in
   `/Users/henrik/source/hm/semantic-modelling`, observe the MCP startup log
   for absence of `RvfCorruptError`, `AgentDBInitError`, or
   `ControllerInitError` (the three fatal init errors discriminated in
   `memory-router.ts:323-331`).

5. **Memory ingestion path round-trips**: trigger the SessionStart hook
   (next claude open does it automatically) and confirm import completes
   without `[FAIL] auto-memory-hook` in stderr.

If any check fails:

```bash
SNAP_DIR=/tmp/semantic-modelling-snapshot-<timestamp>
cp -R "$SNAP_DIR/.swarm" /Users/henrik/source/hm/semantic-modelling/
cp -R "$SNAP_DIR/.claude-flow" /Users/henrik/source/hm/semantic-modelling/
cp -R "$SNAP_DIR/memory" /Users/henrik/source/hm/semantic-modelling/.claude/memory
```

Stop and investigate before retrying.
