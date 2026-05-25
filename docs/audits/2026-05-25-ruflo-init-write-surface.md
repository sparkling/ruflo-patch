# 2026-05-25 — ruflo init: canonical write surface

## Scope

Command: `npx -y @sparkleideas/ruflo@latest init --full --force --with-embeddings`

Traced through fork source at `/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/`. Every entry is grounded in a `file:line` reference. Where path resolution is dynamic (e.g. `findSourceDir` walks parents), the entry is marked **UNKNOWN — runtime-resolved** with the resolver site.

The `--full --force --with-embeddings` invocation activates `FULL_INIT_OPTIONS` (types.ts:652–711) at init.ts:261, sets `options.force=true`, and after `executeInit()` runs (init.ts:353), additionally:

1. ML-002: calls `ensureRouter()` because `full === true` (init.ts:366) → bootstraps RVF storage in `.swarm/` (memory-router.ts:1006).
2. `--with-embeddings`: spawns `cli embeddings init --model <X> --force` (init.ts:516) → re-writes `.claude-flow/embeddings.json` and creates `.claude-flow/models/`.

`--full --force --with-embeddings` does NOT pass `--start-all` or `--start-daemon`, so the conditional daemon/swarm/memory CLI sub-invocations at init.ts:435–492 do NOT run.

## Bucket 1 — Project-root files

| Path | Op | Source | Always for `--full --force --with-embeddings`? | Conditional gate |
|---|---|---|---|---|
| `CLAUDE.md` | CREATE (overwrite under `--force`) | executor.ts:2149 (`writeFileSync(claudeMdPath, content)`) | YES | `options.components.claudeMd` (true in FULL); guarded by `existsSync && !options.force` at executor.ts:2142 — with `--force` always writes |
| `.mcp.json` | CREATE (overwrite under `--force`) | executor.ts:936 (`writeFileSync(mcpPath, content)`) | YES | `options.components.mcp` (true in FULL); guarded by `existsSync && !options.force` at executor.ts:916 — with `--force` always writes; `detectExistingRufloMCP` parent-walk guard at executor.ts:928 is bypassed by `--force` (line 927) |
| `.ruflo-project` | CREATE (NEVER overwrites; respects pre-existing even under `--force`) | executor.ts:2121 (`writeFileSync(sentinelPath, JSON.stringify(payload))`) | YES on first init; SKIPPED on rerun | Always called regardless of components — see executor.ts:307. Best-effort write inside try/catch; failure → `result.errors` but does not flip `result.success` |

**No** root-level `.gitignore` write. The only `.gitignore` written is **inside** `.claude-flow/` (see Bucket 2).

## Bucket 2 — Project subtree files

### `.claude/`

Top-level directory mkdir at executor.ts:797 (createDirectories), structure from `DIRECTORIES.claude` at executor.ts:185–191: `.claude/`, `.claude/skills/`, `.claude/commands/`, `.claude/agents/`, `.claude/helpers/`.

| Path | Op | Source | Conditional gate (`--full --force --with-embeddings` triggers?) |
|---|---|---|---|
| `.claude/settings.json` | CREATE; or MERGE if exists without `--force`; under `--force` always overwrites | executor.ts:846/853/859 (`writeFileSync(settingsPath, JSON.stringify(generated/existing))`) | YES — `options.components.settings` (true in FULL); content from `generateSettingsJson(options)` |
| `.claude/skills/<skill-name>/**` | CREATE (recursive copy from bundled source) | executor.ts:986 (`copyDirRecursive(sourcePath, targetPath)` via `copyDirRecursive` defined at 2261) | YES for all SKILLS_MAP categories — FULL sets `skills.all=true` at types.ts:674, so executor.ts:954 flattens all of SKILLS_MAP. Source resolved via `findSourceDir('skills')` (executor.ts:2194 — UNKNOWN until runtime; typical resolution: package's own `.claude/skills/` per executor.ts:2207–2210). Skills only copy when `existsSync(sourcePath)` at executor.ts:984 — categories in SKILLS_MAP whose directories aren't bundled (e.g. ADR-0148 C entries `performance-analysis`, `agentic-jujutsu`, `hive-mind-advanced`, `worker-benchmarks`, `worker-integration`) silently no-op |
| `.claude/commands/<command-name>/**` or `.claude/commands/<file>.md` | CREATE (recursive copy or single-file copy from bundled) | executor.ts:1053/1055 (`copyDirRecursive`/`copyFileSync`) | YES for all COMMANDS_MAP — FULL sets `commands.all=true` at types.ts:678, so executor.ts:1011 flattens all of COMMANDS_MAP (executor.ts:119–147). Source resolved via `findSourceDir('commands')` (UNKNOWN until runtime) |
| `.claude/agents/<category>/**` | CREATE (recursive copy from bundled) | executor.ts:1112 (`copyDirRecursive`) | YES for all AGENTS_MAP — FULL sets `agents.all=true` at types.ts:682, so executor.ts:1081 flattens all of AGENTS_MAP (executor.ts:152–179). Source via `findSourceDir('agents')` (UNKNOWN until runtime) |
| `.claude/helpers/pre-commit` | CREATE (force-overwrite) | executor.ts:1222 (`writeFileSync(filePath, content)`); chmod 755 at 1226 | YES — `options.components.helpers` (true in FULL). Content from `generatePreCommitHook()` (helpers-generator.ts:20) |
| `.claude/helpers/post-commit` | CREATE | executor.ts:1222 | YES — same gate. Content from `generatePostCommitHook()` (helpers-generator.ts:53) |
| `.claude/helpers/session.js` | CREATE | executor.ts:1222 | YES — content from `generateSessionManager()` (helpers-generator.ts) |
| `.claude/helpers/router.js` | CREATE | executor.ts:1222 | YES — content from `generateAgentRouter()` |
| `.claude/helpers/memory.js` | CREATE | executor.ts:1222 | YES — content from `generateMemoryHelper()` |
| `.claude/helpers/hook-handler.mjs` | CREATE; chmod 755 | executor.ts:1222 | YES — content from `generateHookHandler()` |
| `.claude/helpers/intelligence.cjs` | CREATE; chmod 755 | executor.ts:1222 | YES — content from `generateIntelligenceStub()` |
| `.claude/helpers/auto-memory-hook.mjs` | CREATE; chmod 755 | executor.ts:1222 | YES — content from `generateAutoMemoryHook()` |
| `.claude/helpers/statusline.cjs` | CREATE (force-overwrite — always written, even if writeHelpers already wrote it) | executor.ts:1379 (`writeFileSync(statuslinePath, statuslineScript)`) | YES — `options.components.statusline` (true in FULL). Always written (no existsSync guard at this site) |
| `.claude/helpers/<bundled-extras>` | CREATE (copy from `findSourceHelpersDir()` for any name NOT in the 8 generator names) | executor.ts:1253 (`copyFileSync`); chmod 755 if `.sh`/`.mjs` at 1255 | NORMALLY NO-OP — ADR-0235 Option B deleted the bundled static at `cli/.claude/helpers/` (see comment at executor.ts:1241). Defense-in-depth path only fires if bundle is restored |
| `.claude/statusline.sh` | CREATE (copy from bundled source) | executor.ts:1359 (`copyFileSync(sourcePath, destPath)`); chmod 755 at 1362 | CONDITIONAL — `sourceClaudeDir` resolved via `findSourceClaudeDir()` (executor.ts:1296); copies only if `existsSync(sourcePath)` at executor.ts:1357. **UNKNOWN whether bundled source ships these.** Check `/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/.claude/statusline.sh` |
| `.claude/statusline.mjs` | CREATE (copy from bundled source) | executor.ts:1359 | CONDITIONAL — same gate as `.claude/statusline.sh` |
| `.claude/scripts/check-patches.sh` | CREATE; chmod 0o755 | executor.ts:1288 (`writeFileSync(destPath, generateCheckPatchesScript())`) | YES — `writeCheckPatchesScript()` always called from `writeHelpers()` at executor.ts:1197, regardless of bundled-helpers branch. Directory `.claude/scripts/` mkdir'd at executor.ts:1280 |

### `.claude-flow/`

Top-level directory mkdir at executor.ts:797 (createDirectories), structure from `DIRECTORIES.runtime` at executor.ts:192–200: `.claude-flow/`, `.claude-flow/data/`, `.claude-flow/logs/`, `.claude-flow/sessions/`, `.claude-flow/hooks/`, `.claude-flow/agents/`, `.claude-flow/workflows/`.

| Path | Op | Source | Conditional? |
|---|---|---|---|
| `.claude-flow/` (directory) | MKDIR | executor.ts:797 via DIRECTORIES.runtime | YES — `options.components.runtime` (true in FULL) |
| `.claude-flow/data/` | MKDIR (empty) | executor.ts:797 | YES |
| `.claude-flow/logs/` | MKDIR (empty) | executor.ts:797 | YES |
| `.claude-flow/sessions/` | MKDIR (empty) | executor.ts:797 | YES |
| `.claude-flow/hooks/` | MKDIR (empty) | executor.ts:797 | YES |
| `.claude-flow/agents/` | MKDIR (empty) | executor.ts:797 | YES |
| `.claude-flow/workflows/` | MKDIR (empty) | executor.ts:797 | YES |
| `.claude-flow/metrics/` | MKDIR | executor.ts:1547 (`mkdirSync(metricsDir)`) | YES — `options.components.statusline` gates `writeInitialMetrics()` (executor.ts:293, true in FULL) |
| `.claude-flow/learning/` | MKDIR (empty after init; populated by daemon at runtime) | executor.ts:1547 | YES |
| `.claude-flow/security/` | MKDIR | executor.ts:1547 | YES |
| `.claude-flow/config.json` | CREATE (overwrite under `--force`) | executor.ts:1418 (`writeFileSync(configPath, JSON.stringify(template))`) | YES — `options.components.runtime` (true in FULL). Content from `getFullConfigTemplate()` at config-template.ts because `options.full === true` (executor.ts:1413) |
| `.claude-flow/embeddings.json` | CREATE (overwrite under `--force`) BY EXECUTOR | executor.ts:1504 (`writeFileSync(embeddingsJsonPath, embeddingsConfig)`) | YES — same gate as config.json |
| `.claude-flow/embeddings.json` | OVERWRITE BY `embeddings init --force` (re-runs after executeInit) | embeddings.ts:761 (`writeFileSync(configPath, JSON.stringify(config))`) | YES — `--with-embeddings` triggers init.ts:516 sub-invocation |
| `.claude-flow/models/` | MKDIR (empty unless model download succeeds) | embeddings.ts:680 (`mkdirSync(modelDir)`) | YES — `--with-embeddings` triggers this |
| `.claude-flow/models/<model-files>` | CREATE (ONNX model artefacts) | embeddings.ts:689 (`embeddings.downloadEmbeddingModel(model, modelDir, ...)`) | CONDITIONAL — `embeddings init` defaults `download !== false` (embeddings.ts:640) → true; init.ts:516 does not pass `--no-download`. The actual download is delegated to `@claude-flow/embeddings`; **UNKNOWN — see embeddings.ts:689** for the per-model file list. If the embeddings package is unavailable, the download is simulated (embeddings.ts:694) with no files written |
| `.claude-flow/.gitignore` | CREATE (overwrite under `--force`) | executor.ts:1523 (`writeFileSync(gitignorePath, gitignore)`) | YES — written inside `writeRuntimeConfig`, gated on `options.components.runtime` (true in FULL) |
| `.claude-flow/CAPABILITIES.md` | CREATE (overwrite under `--force`) | executor.ts:2069 (`writeFileSync(capabilitiesPath, capabilities)`) | YES — `writeCapabilitiesDoc()` called from `writeRuntimeConfig()` at executor.ts:1528 |
| `.claude-flow/metrics/v3-progress.json` | CREATE (overwrite under `--force`) | executor.ts:1580 (`writeFileSync(progressPath, JSON.stringify(progress))`) | YES — `writeInitialMetrics()` gated on `options.components.statusline` (true in FULL) |
| `.claude-flow/metrics/swarm-activity.json` | CREATE (overwrite under `--force`) | executor.ts:1605 | YES |
| `.claude-flow/metrics/learning.json` | CREATE (overwrite under `--force`) | executor.ts:1629 | YES |
| `.claude-flow/security/audit-status.json` | CREATE (overwrite under `--force`) | executor.ts:1644 | YES |

### `.swarm/`

`.swarm/` is **NOT** in `DIRECTORIES.runtime` (executor.ts:192–200). It is created only as a side-effect of `ensureRouter()` chained on `--full` at init.ts:368.

| Path | Op | Source | Conditional? |
|---|---|---|---|
| `.swarm/` (directory) | MKDIR (mode 0o700) | memory-router.ts:912 (`mkdirSync(path.dirname(databasePath), { recursive: true, mode: 0o700 })`) | YES — `full === true` triggers `ensureRouter()` (init.ts:366–373). `databasePath` defaults to `.claude-flow/memory.rvf` (memory-router.ts:866) but is overridden by `config.storage?.databasePath` from `resolve-config`, which reads `.claude-flow/embeddings.json` → `databasePath: '.swarm/memory.rvf'` (written at executor.ts:1484). With `findProjectRoot()` resolving the in-project case, `_resolveDatabasePath` returns `<projectRoot>/.swarm/memory.rvf` (memory-router.ts:387–391) |
| `.swarm/memory.rvf` | CREATE (RVF backend; chmod 0o600) | memory-router.ts:914 (`createStorage({ databasePath })`) → storage-factory; chmod at 917 (`_chmodDbFile`) | YES — via `ensureRouter()` chain |
| `.swarm/memory.rvf.jslock` | CREATE-then-UNLINK during clean shutdown | memory-router.ts:906 (path computed); written by RvfBackend lock acquisition; unlinked at memory-router.ts:533 (`unlinkSync(_lockPath)`) on `_syncShutdown()` | CONDITIONAL — transient. Present if init terminates abnormally; absent after clean exit |
| `.swarm/memory.rvf.lock` | CREATE-then-RELEASE (native FLVR binary lock; managed by RVF backend internals) | Not directly written from the 7 init source files; managed by `@claude-flow/memory` via `createStorage`. See memory-router.ts:903 comment | CONDITIONAL — transient like `.jslock` |

## Bucket 3 — User-home files

| Path | Op | Source | Conditional? |
|---|---|---|---|
| `~/.claude/` (directory) | MKDIR (recursive) | executor.ts:2171 (`mkdirSync(globalClaudeDir, { recursive: true })`) | YES — `homeDir && !options.skipGlobalClaudeMd`. FULL_INIT_OPTIONS does not set `skipGlobalClaudeMd`, and `--full --force --with-embeddings` does NOT pass `--no-global` → `skipGlobalClaudeMd` stays falsy (init.ts:343 gate) → writes. Wrapped in try/catch (executor.ts:2169–2185) — failure non-critical |
| `~/.claude/CLAUDE.md` | APPEND if exists and lacks "Ruflo Integration" marker; CREATE (trimStart) if absent | executor.ts:2176 (`appendFileSync(globalClaudeMd, rufloBlock)`); executor.ts:2180 (`writeFileSync(globalClaudeMd, rufloBlock.trimStart())`) | YES (same gate as above). Idempotent — `existing.includes('Ruflo Integration')` short-circuits append (executor.ts:2175) |

The appended block content (executor.ts:2160–2167):

```
# Ruflo Integration (auto-generated by ruflo init)
When working on multi-file tasks or complex features, use ToolSearch to find and invoke ruflo MCP tools.
Key tools: memory_store, memory_search, hooks_route, swarm_init, agent_spawn.
Check system-reminder tags for [INTELLIGENCE] pattern suggestions before starting work.
```

## Bucket 4 — Bundled-file walks

Init does NOT bundle templates inside the 7 init source files. It walks 3 bundled source directories at runtime via `findSourceDir(type)` (executor.ts:2194–2256) and copies into the project tree via `copyDirRecursive()` (executor.ts:2261).

### Bundle source resolution (executor.ts:2194–2256)

`findSourceDir(type)` probes these locations in order, returning the first that exists:

1. `<sourceBaseDir>/.claude/<type>` (if `options.sourceBaseDir` provided)
2. `<packageRoot>/.claude/<type>` where `packageRoot = path.resolve(__dirname, '..', '..', '..')` — typically `node_modules/@claude-flow/cli/.claude/<type>` after install (executor.ts:2207–2210)
3. Walk up to 10 levels from `__dirname` looking for `<parent>/.claude/<type>` (executor.ts:2218–2224)
4. `<cwd>/.claude/<type>`, `<cwd>/../.claude/<type>`, `<cwd>/../../.claude/<type>` (executor.ts:2228–2233)
5. For `type === 'agents'` also `<cwd>/v2/.claude/<type>` and `<cwd>/../v2/.claude/<type>` (executor.ts:2237–2240)
6. `<cwd>/plugin/<type>` and `<cwd>/../plugin/<type>` (executor.ts:2244–2247)

`findSourceHelpersDir()` (executor.ts:1129) uses a similar probe but also requires the directory contain the SENTINEL `hook-handler.mjs` (executor.ts:1131).

`findSourceClaudeDir()` (executor.ts:1296) probes for the package's `.claude/` directly (no `/<type>` suffix), used by the statusline copy at executor.ts:1352.

### Walker / destination matrix

| Walker | Source root (typical install path) | Destination | Filter under `--full --force --with-embeddings` |
|---|---|---|---|
| Skills walker (`copySkills`) | `findSourceDir('skills')` → `<pkg>/.claude/skills/` | `<projectRoot>/.claude/skills/<skill>/` | `skills.all === true` (FULL) → all of SKILLS_MAP (executor.ts:48–103) flattened. Of the SKILLS_MAP set, only categories whose directory exists in the bundled source actually copy (executor.ts:984 existsSync gate). Bundled source confirmed to contain: `agentdb-*` (5), `browser`, `dual-mode`, `flow-nexus-*` (3), `github-*` (5), `hooks-automation`, `pair-programming`, `reasoningbank-*` (2), `skill-builder`, `sparc-methodology`, `stream-chain`, `swarm-advanced`, `swarm-orchestration`, `v3-*` (9), `verification-quality`. ADR-0148 C entries (`performance-analysis`, `agentic-jujutsu`, `hive-mind-advanced`, `worker-benchmarks`, `worker-integration`) NOT present in bundled `.claude/skills/` — silently no-op |
| Commands walker (`copyCommands`) | `findSourceDir('commands')` → `<pkg>/.claude/commands/` | `<projectRoot>/.claude/commands/<cmd>/` or `<projectRoot>/.claude/commands/<file>.md` | `commands.all === true` (FULL) → all of COMMANDS_MAP (executor.ts:119–147) flattened. Bundled source contains: `agentic-jujutsu.md`, `agents/`, `analysis/`, `automation/`, `claude-flow-help.md`, `claude-flow-memory.md`, `claude-flow-swarm.md`, `coordination/`, `github/`, `hive-mind/`, `hooks/`, `memory/`, `monitoring/`, `optimization/`, `pair/`, `sparc/`, `sparc.md`, `stream-chain/`, `swarm/`, `training/`, `truth/`, `verify/`, `workflows/` |
| Agents walker (`copyAgents`) | `findSourceDir('agents')` → `<pkg>/.claude/agents/` | `<projectRoot>/.claude/agents/<category>/` | `agents.all === true` (FULL) → all of AGENTS_MAP (executor.ts:152–179) flattened. Bundled source contains: `analysis/`, `architecture/`, `browser/`, `core/`, `custom/`, `data/`, `development/`, `devops/`, `documentation/`, `flow-nexus/`, `github/`, `goal/`, `optimization/`, `payments/`, `sona/`, `sparc/`, `specialized/`, `sublinear/`, `templates/`, `testing/`, `v3/`, plus a `tmp.json` artifact at the bundle root (UNKNOWN whether this is copied — `copyAgents` iterates AGENTS_MAP categories, not bundle contents, so `tmp.json` is not iterated unless a category maps to it) |
| Helpers walker (`writeHelpers` defense-in-depth) | `findSourceHelpersDir()` → typically NULL after ADR-0235 Option B | `<projectRoot>/.claude/helpers/<extra>` | NORMALLY NO-OP. Only fires for names NOT already in the 8 generator-produced set (executor.ts:1218 dict keys: `pre-commit`, `post-commit`, `session.js`, `router.js`, `memory.js`, `hook-handler.mjs`, `intelligence.cjs`, `auto-memory-hook.mjs`). Bundled static at `cli/.claude/helpers/` was deleted per ADR-0235 — `findSourceHelpersDir()` returns null because the sentinel `hook-handler.mjs` is gone, and the block becomes a no-op (comment at executor.ts:1238) |
| Statusline copy (`writeStatusline` advanced files) | `findSourceClaudeDir()` → `<pkg>/.claude/` | `<projectRoot>/.claude/statusline.sh`, `<projectRoot>/.claude/statusline.mjs` | CONDITIONAL — `existsSync(sourcePath)` gate at executor.ts:1357. **UNKNOWN whether bundled `<pkg>/.claude/statusline.{sh,mjs}` exist** — not verified in this audit (the bundled `.claude/` listing showed only `agents/`, `commands/`, `settings.json`, `skills/` at top level, so this is likely NO-OP in production install) |

## Summary

**Distinct path globs** (deduplicating runtime-resolved walker outputs to category-level):

- Bucket 1 (root): **3** (`CLAUDE.md`, `.mcp.json`, `.ruflo-project`)
- Bucket 2 (`.claude/`): **9 leaf files** + walker outputs for `skills/`, `commands/`, `agents/` (3 walker outputs)
- Bucket 2 (`.claude-flow/`): **10 leaf files/dirs** + `models/` walker output (1)
- Bucket 2 (`.swarm/`): **1 persistent file** + 2 transient locks
- Bucket 3 (`~/.claude/`): **1 file** (append-or-create)

**Counted distinct paths: 30** (excluding the 3 walker outputs and 1 model-download walker, which fan out to many files at runtime). Including walker categories: **34**.

**Always-written under `--full --force --with-embeddings`:**

- All entries above marked YES.
- `.ruflo-project` is YES on first init, SKIP on rerun (executor.ts:2093).
- Statusline `.sh`/`.mjs` bundled-source copies are likely NO-OP (bundled-source absence).
- Helpers defense-in-depth block is NORMALLY NO-OP (ADR-0235 deletion).

**Conditional logic that `--full --force --with-embeddings` does NOT trigger** (stale audits should exclude these from "expected install" set):

1. `--start-all` / `--start-daemon` block (init.ts:435–492) — would invoke `cli memory init`, `cli daemon start`, `cli swarm init` as detached subprocesses with their own side-effects.
2. `--no-global` (init.ts:343) — would SKIP the `~/.claude/CLAUDE.md` append.
3. `--codex` / `--dual` (wizard-only, init.ts:568–569) — would write `AGENTS.md`-style targets (out of scope for this run).
4. ML-002 `memory init` chain — runs (because `full === true`), but only `ensureRouter()` (storage-only). `ensureRegistry()` (ControllerRegistry init at memory-router.ts:1029) does NOT run from init, so the agentdb_* substrate's `CREATE TABLE` side-effects do NOT fire at init time.
5. `embeddings init`'s simulated-download branch (embeddings.ts:694) — only fires when `@claude-flow/embeddings` is unavailable; in a normal published install the real download runs.
6. `writeSettings` merge branch (executor.ts:816–855) — under `--force`, the merge logic is bypassed (line 814 guard); the file is always overwritten via line 859.
7. Statusline `.claude/statusline.sh` / `.claude/statusline.mjs` copy — gated on bundled-source existsSync; bundled package likely lacks these (not verified).

## Implications for stale-file audits

Files that exist in a project but are NOT in this write surface are candidates for stale-cleanup classification (regardless of git-tracked status).

**Prior audit gaps (paths missed by `2026-05-25-stale-install-cleanup-execution.md` and `2026-05-25-opda-stale-install-audit.md`, which scoped only `.claude/`, `.claude-flow/`, `.swarm/`):**

1. **`CLAUDE.md` at project root** — overwritten under `--force` (executor.ts:2149). Prior audits did note it in "A \ B" sets but treated it as out-of-scope; it IS in scope per this canonical surface.
2. **`.mcp.json` at project root** — same treatment; created/overwritten under `--force` (executor.ts:936).
3. **`.ruflo-project` at project root** — created once, never overwritten (executor.ts:2121). Stale-audit implication: if a project has both `.ruflo-project` AND an unrelated marker like `AGENTS.md`, only `.ruflo-project` is part of the canonical install.
4. **`~/.claude/CLAUDE.md` user-home file** — append-or-create (executor.ts:2156–2185). This is a GLOBAL file shared across all projects on a machine. A per-project stale audit cannot disposition it; it can only be cleaned by removing the "Ruflo Integration" block from inside the file.
5. **`.claude-flow/models/` and its contents** — only written when `--with-embeddings` is used AND the embeddings package is available (embeddings.ts:680, 689). Prior audits did NOT verify this directory; it's a heavyweight subtree (potentially hundreds of MB of ONNX model files) that should be in the expected-install set when `--with-embeddings` is used.
6. **`.swarm/memory.rvf{,.lock,.jslock}`** — listed by the opda audit (which had a live MCP server holding these open) but treated as runtime state. Per this canonical surface, the `.rvf` file is CREATED at init time when `--full` is passed (memory-router.ts:914 via init.ts:366 chain), so it IS part of the canonical install — not strictly runtime-only state.
7. **Empty directory shells**: `.claude-flow/{data,logs,sessions,hooks,agents,workflows,learning}/` — these are mkdir'd empty at init time. A stale audit that filters out empty directories will miss them; a strict canonical install includes them.

The prior audits' "A \ B = 5" / "ref-only" file count (semantic-modelling line 29) is therefore an UNDER-count of the canonical write surface: it omits walker fan-out (each agent/skill/command leaf), `~/.claude/CLAUDE.md`, and `.claude-flow/models/`.
