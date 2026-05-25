# 2026-05-25 — INTEGRATION-LEDGER superseded-by-local audit (slice C, 16 newest rows)

Parallel slice C of the 48 `superseded-by-local` row review. Slice C
covers the 16 newest rows by upstream date (all 2026-05-24). Verifies
the cited fork-side superseding work is still present at fork HEAD and
that the "byte-identical / block-identical / fork-only" upstream
predicates still hold against current upstream HEAD.

Per `feedback-corpus-evidence-before-feature-work`: every claim
re-verified against current source state, not against ADR text alone.

## Verdict

**16 still-superseded, 0 drifted, 0 upstream-rebased, 0 stale-other.**

All 16 rows verified. Every cited fork-side SHA is an ancestor of its
fork's `main` (9 in `forks/ruflo/main`, 3 in `forks/agentdb/main`, plus
the shared `1bfbd0db2` covering two rows and the shared `c97beb7ed`
covering two rows). Every "upstream byte-identical / block-identical"
predicate verified against upstream HEAD post-fetch
(`ruvnet/ruflo@31809ebeb 2026-05-25` and
`ruvnet/agentdb@1776223 2026-05-23`). For every row, upstream has NOT
touched the cited path since the audit baseline (zero commits in
`git log ef73a1616..origin/main -- <paths>` for ruflo, zero in
`a478ab3..origin/main -- <paths>` for agentdb).

No ledger amendment needed.

---

## Selection

Sorted all 48 `superseded-by-local` rows by upstream-date column (tie
break by file-line order: later line = later append = newer). The 35
rows dated `2026-05-24` form the most recent block; slice C takes the
last 16 of those by file-line order (line 217 + lines 362-376). Slices
A and B (handled in parallel) cover the older 32.

## Per-row findings

### Row 217 — ADR-0247 site #3 `installAttemptedAt` 5-minute backoff

**Fork SHA**: `1f16318d2` "fix(ADR-0247): site #3 — installAttemptedAt
5-minute backoff for aidefence auto-install"

**Fork state** (`forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/security-tools.ts`):
- `:31` `let installAttemptedAt: number | null = null;`
- `:32` `const INSTALL_BACKOFF_MS = 5 * 60 * 1000;`
- `:35` `let installError: Error | null = null;`
- `:80` ADR-0247 site #3 marker comment
- `:83-87` backoff window check + `retryAt` ISO-8601 synthesis
- Sync guard test: `v3/@claude-flow/cli/__tests__/security-tools-backoff.test.ts` present

**Upstream state** (`ruvnet/ruflo/v3/@claude-flow/cli/src/mcp-tools/security-tools.ts`
at HEAD `31809ebeb`):
- `:28` `let installAttempted = false;`
- `:74` `if (installAttempted)`
- `:77` `installAttempted = true;`
- No backoff constant, no error cache.

**Classification**: **still-superseded**. Permanent-cache shape
unchanged upstream; fork backoff still applies.

---

### Row 362 — ADR-0244 site #1 (CRITICAL) `commands/process.ts:48-203` daemon stub

**Fork SHA**: `1bfbd0db2` "fix(ADR-0244): sites #1 + #2 — close
daemon-PID race (CRITICAL pair)"

**Fork state** (`forks/ruflo/v3/@claude-flow/cli/src/commands/process.ts`):
- `:12-22` ADR-0244 site #1 marker block (`F-01-001 CRITICAL`)
- No `daemonCommand` definition (search returns 0 matches for
  `case 'daemon':` or `name: 'daemon'`)
- Sync guard test: `v3/@claude-flow/cli/__tests__/adr0244-daemon-pid-race.test.ts`
  present

**Upstream state** (`ruvnet/ruflo/v3/@claude-flow/cli/src/commands/process.ts`
at HEAD `31809ebeb`):
- `:46` `* Daemon subcommand - start/stop background daemon`
- `:48-49` `const daemonCommand: Command = { name: 'daemon', ... }`
- `:62-121` full handler with `.claude-flow/daemon.pid` writer

**Classification**: **still-superseded**. Upstream still ships the
full `daemonCommand` block; fork deletion still applies.

---

### Row 363 — ADR-0244 site #2 (CRITICAL) `commands/start.ts:165-166` daemonPidPath write

**Fork SHA**: `1bfbd0db2` (same commit as row 362)

**Fork state** (`forks/ruflo/v3/@claude-flow/cli/src/commands/start.ts:163-178`):
- ADR-0244 site #2 marker block (`F-01-002 CRITICAL`)
- No `fs.writeFileSync(daemonPidPath, String(process.pid))` call
  in the daemon-mode branch

**Upstream state** (`ruvnet/ruflo/v3/@claude-flow/cli/src/commands/start.ts`):
- `:218` `const daemonPidPath = path.join(cwd, '.claude-flow', 'daemon.pid');`
- `:219` `fs.writeFileSync(daemonPidPath, String(process.pid));`

**Classification**: **still-superseded**. Third-writer race surface
still present upstream; fork deletion still applies.

---

### Row 364 — ADR-0244 site #3 `commands/swarm.ts:755-820` scale dishonest envelope

**Fork SHA**: `404d50f70` "fix(ADR-0244): sites #3 + #7 — swarm scale +
coordinate envelope honesty"

**Fork state** (`forks/ruflo/v3/@claude-flow/cli/src/commands/swarm.ts:755-822`):
- ADR-0244 site #3 marker block at the head of `scaleCommand`
- Body calls `callMCPTool('swarm_scale', { swarmId, agents: targetAgents,
  type: agentType })`
- `success:false, exitCode:1` paths for input validation + MCP failure

**Upstream state** (`ruvnet/ruflo/v3/@claude-flow/cli/src/commands/swarm.ts:712-773`):
- `scaleCommand` body returns `{ success: true, data: { swarmId, agents:
  targetAgents, delta } }` after `output.printSuccess(...)` without ever
  invoking the MCP tool.

**Classification**: **still-superseded**. Dishonest envelope still
present upstream.

---

### Row 365 — ADR-0244 site #4 `commands/workflow.ts:608-628` template create stub

**Fork SHA**: `916beb662` "fix(ADR-0244): site #4 — workflow template
create persists to disk"

**Fork state** (`forks/ruflo/v3/@claude-flow/cli/src/commands/workflow.ts:617-640+`):
- ADR-0244 site #4 marker block
- Honours `--workflow` and `--file` flags
- Writes filesystem-backed JSON to
  `.claude-flow/templates/<name>.json` (atomic temp-then-rename)

**Upstream state** (`ruvnet/ruflo/v3/@claude-flow/cli/src/commands/workflow.ts:608-628`):
- Stub returns `{ success: true, data: { name, created: true } }`
  after printing success; flags are not read.

**Classification**: **still-superseded**.

---

### Row 366 — ADR-0244 site #5 `commands/config.ts:304-333` reset --section discarded

**Fork SHA**: `8956c30c6` "fix(ADR-0244): site #5 — config reset
--section honoured"

**Fork state** (`forks/ruflo/v3/@claude-flow/cli/src/commands/config.ts:303-340`):
- ADR-0244 site #5 marker block
- `const section = ctx.flags.section as string | undefined;` then
  `configManager.reset(ctx.cwd, section)` passes the flag through
- Branched output prose for partial vs full reset

**Upstream state** (`ruvnet/ruflo/v3/@claude-flow/cli/src/commands/config.ts:324`):
- `const configPath = configManager.reset(ctx.cwd);` — section flag
  is parsed but never threaded.

**Classification**: **still-superseded**.

---

### Row 367 — ADR-0244 site #6 `commands/mcp.ts:572-612` toggle stub

**Fork SHA**: `c97beb7ed` "fix(ADR-0244): sites #6 + #8 — mcp toggle
persists + live tool count"

**Fork state** (`forks/ruflo/v3/@claude-flow/cli/src/commands/mcp.ts:583-615+`):
- ADR-0244 site #6 marker block
- `configManager.set('mcp.disabledTools', ...)` write
- Envelope includes `note: 'Restart required for changes to take effect'`

**Upstream state** (`ruvnet/ruflo/v3/@claude-flow/cli/src/commands/mcp.ts:500-538`):
- Handler prints "Enabled N tools" / "Disabled N tools" via
  `output.printSuccess(...)` and returns `{ success: true }` without
  persisting anything.

**Classification**: **still-superseded**.

---

### Row 368 — ADR-0244 site #8 `commands/mcp.ts:271` literal '27 enabled'

**Fork SHA**: `c97beb7ed` (same commit as row 367)

**Fork state** (`forks/ruflo/v3/@claude-flow/cli/src/commands/mcp.ts:268-275`):
- ADR-0244 site #8 marker comment cluster
- `const liveToolCount = listMCPTools().length;`
- `toolsValue` uses `${liveToolCount} enabled`

**Upstream state** (`ruvnet/ruflo/v3/@claude-flow/cli/src/commands/mcp.ts:199`):
- `{ property: 'Tools', value: !tools || tools === 'all' ? '27 enabled' : ... }`
  literal `'27 enabled'` string.

**Classification**: **still-superseded**.

---

### Row 369 — ADR-0244 site #11 `parser.ts:481-498` applyDefaults verbatim cast

**Fork SHA**: `ffbf98dee` "fix(ADR-0244): site #11 — parser default
coercion (CC-03 class fix)"

**Fork state** (`forks/ruflo/v3/@claude-flow/cli/src/parser.ts`):
- `:44` `function coerceDefault(opt: CommandOption, value: unknown): string | boolean | number | string[]`
- `:534` `flags[key] = coerceDefault(opt, opt.default);` (seam wires
  the helper at the cast site)

**Upstream state** (`ruvnet/ruflo/v3/@claude-flow/cli/src/parser.ts:468+`):
- `applyDefaults` casts `opt.default as string | boolean | number | string[]`
  directly. No coerce helper exists in the file.

**Classification**: **still-superseded**.

---

### Row 370 — ADR-0244 site #10 `commands/completions.ts:12,20,23` hardcoded subcommands

**Fork SHA**: `f4a839b66` "fix(ADR-0244): site #10 — completions
derives command lists at runtime"

**Fork state** (`forks/ruflo/v3/@claude-flow/cli/src/commands/completions.ts`):
- `:21` `import { commands as registeredCommands, getCommandNames } from './index.js';`
- `:27` `return Array.from(new Set(getCommandNames())).sort();`
- Marker comment block at `:10` ("each command's `.subcommands` field
  — previous hardcoded ...")

**Upstream state** (`ruvnet/ruflo/v3/@claude-flow/cli/src/commands/completions.ts`):
- `TOP_LEVEL_COMMANDS = [ 'swarm', 'agent', ... ]` 22-item literal
- `SWARM_SUBCOMMANDS = [ 'init', 'status', 'scale', ... ]` literal
- `AGENT_SUBCOMMANDS = [ 'spawn', ... ]` literal
- ... all derivable lists hardcoded.

**Classification**: **still-superseded**.

---

### Row 371 — ADR-0246 F-03-001 probe-and-reseat metric on RvfBackend

**Fork SHA**: `7557d26` "fix(ADR-0246):
F-03-001/F-03-002/F-03-003 internals correctness"

**Fork state** (`forks/agentdb/src/backends/rvf/RvfBackend.ts`):
- `:33` `import { probeAndSeatMetric } from './metric-probe.js';`
- `:176, :297, :649` three call sites (`open` / `load` / `openReadonly`)
- Helper file `src/backends/rvf/metric-probe.ts` present in fork

**Upstream state** (`ruvnet/agentdb/src/backends/rvf/RvfBackend.ts`):
- `:125` `this.metricType = config.metric ?? 'cosine';` — config-input only
- `:735` `private distanceToSimilarity(distance: number)` — kept
- No `metric-probe` import, no probe helper in the directory.

**Classification**: **still-superseded**.

---

### Row 372 — ADR-0246 F-03-001 sibling: SqlJsRvfBackend metric read-back

**Fork SHA**: `7557d26` (same commit as row 371)

**Fork state** (`forks/agentdb/src/backends/rvf/SqlJsRvfBackend.ts`):
- `:353-396` `readPersistedMetric()` + `ensureSchemaAndSeed(fileExisted)`
  helpers
- `:398` `INSERT OR IGNORE INTO rvf_meta (...)` (preserves existing rows)
- `:123-131` read-back-before-create flow

**Upstream state** (`ruvnet/agentdb/src/backends/rvf/SqlJsRvfBackend.ts`):
- `:340` `INSERT OR REPLACE INTO rvf_meta (key, value) VALUES ('dimension', ?), ('metric', ?)`
  — destroys persisted row on every load
- No `readPersistedMetric` / `ensureSchemaAndSeed` helpers.

**Classification**: **still-superseded**.

---

### Row 373 — ADR-0246 F-03-003 factory.ts deriveHNSWParams merge

**Fork SHA**: `7557d26` (same commit as rows 371-372)

**Fork state** (`forks/agentdb/src/backends/factory.ts`):
- `:18` `import { deriveHNSWParams } from '../core/config-chain.js';`
- `:167` `function applyDerivedHNSWParams<C extends VectorConfig>(config: C): C`
- `:185, :195` shim wraps `HNSWLibBackend` and
  `SelfLearningRvfBackend.create` constructors

**Upstream state** (`ruvnet/agentdb/src/backends/factory.ts`):
- No `deriveHNSWParams` import (HEAD search returns 0 matches)
- No `applyDerivedHNSWParams` helper
- HNSWLibBackend static `{M:16, efC:200, efS:100}` literals reach
  callsites directly.

**Classification**: **still-superseded**.

---

### Row 374 — ADR-0246 F-03-002 path b (RVF) staging-substrate journals

**Fork SHA**: `36a163c` "fix(ADR-0246 F-03-002 path b): RVF + SQLite
staging enforcement"

**Fork state** (`forks/agentdb/src/archivist/staging-substrate.ts`):
- `:41-48` ADR-0246 F-03-002 path b marker block
- `:107-113` `RvfJournalOp` discriminated union covering insertAsync /
  insertBatchAsync / removeAsync
- `:225-240` `makeRvfRecordingHandle` builds a Proxy on
  `RvfSubstrateHandle.rvf`
- `forks/agentdb/src/archivist/` directory present

**Upstream state**: `ruvnet/agentdb/src/archivist/` directory **does
not exist** (`ls` returns ENOENT). Archivist is fork-only per
`[[project-fork-only-controllers]]`.

**Classification**: **still-superseded**. Zero upstream merge tax —
fork-only subsystem.

---

### Row 375 — ADR-0246 F-03-002 path b (SQLite) staging-substrate SAVEPOINT

**Fork SHA**: `36a163c` (same commit as row 374)

**Fork state** (`forks/agentdb/src/archivist/staging-substrate.ts`):
- `:49-70` marker block calling out SAVEPOINT discipline
- `:77` `import type { SqliteSubstrateHandle } from './substrates/sqlite-store.js';`
- `:116-122` `SqliteJournalEntry` tracks one active savepoint per
  storeId with the shared `better-sqlite3` handle

**Upstream state**: same as row 374 — `archivist/` does not exist
upstream.

**Classification**: **still-superseded**. Zero upstream merge tax.

---

### Row 376 — ADR-0240 site #2 `agentdb-mcp-server.ts:2016` console.log → console.error

**Fork SHA**: `459781e` "fix(ADR-0240): stderr-only logging for stdio
MCP transport (site #2)"

**Fork state** (`forks/agentdb/src/mcp/agentdb-mcp-server.ts:2015-2017`):
- `:2015-2016` ADR-0240 site #2 marker comment
- `:2017` `console.error(`🎓 Training session ${sessionId}...`);`
- Companion `.eslintrc.json` carries scoped `no-console` rule for
  `src/mcp/**/*.ts` (ADR-0240 §Decision item 3)

**Upstream state** (`ruvnet/agentdb/src/mcp/agentdb-mcp-server.ts:2000`):
- `console.log(\`🎓 Training session ${sessionId}...\`);` — still
  corrupting stdio MCP frames.

**Classification**: **still-superseded**.

---

## Summary table

| Row | Ledger line | Fork SHA(s) | Fork repo | ADR | Classification |
|---|---|---|---|---|---|
| 1 | 217 | `1f16318d2` | ruflo | 0247 | still-superseded |
| 2 | 362 | `1bfbd0db2` | ruflo | 0244 | still-superseded |
| 3 | 363 | `1bfbd0db2` | ruflo | 0244 | still-superseded |
| 4 | 364 | `404d50f70` | ruflo | 0244 | still-superseded |
| 5 | 365 | `916beb662` | ruflo | 0244 | still-superseded |
| 6 | 366 | `8956c30c6` | ruflo | 0244 | still-superseded |
| 7 | 367 | `c97beb7ed` | ruflo | 0244 | still-superseded |
| 8 | 368 | `c97beb7ed` | ruflo | 0244 | still-superseded |
| 9 | 369 | `ffbf98dee` | ruflo | 0244 | still-superseded |
| 10 | 370 | `f4a839b66` | ruflo | 0244 | still-superseded |
| 11 | 371 | `7557d26` | agentdb | 0246 | still-superseded |
| 12 | 372 | `7557d26` | agentdb | 0246 | still-superseded |
| 13 | 373 | `7557d26` | agentdb | 0246 | still-superseded |
| 14 | 374 | `36a163c` | agentdb | 0246 | still-superseded |
| 15 | 375 | `36a163c` | agentdb | 0246 | still-superseded |
| 16 | 376 | `459781e` | agentdb | 0240 | still-superseded |

**Class counts**:
- still-superseded: **16**
- drifted: **0**
- upstream-rebased: **0**
- stale-other: **0**

Note: `1bfbd0db2`, `c97beb7ed`, `7557d26`, and `36a163c` are shared
commits closing multiple ledger rows each (the audit framework expects
one row per surface, not one row per SHA).

## Sync-guard test inventory

Spot-checked presence of the named arch/behavior tests:
- `v3/@claude-flow/cli/__tests__/mcp-client-iserror.test.ts` (row 216 sibling)
- `v3/@claude-flow/cli/__tests__/adr0244-daemon-pid-race.test.ts` (rows 362+363)
- `v3/@claude-flow/cli/__tests__/security-tools-backoff.test.ts` (row 217)

All present in `forks/ruflo`.

## Method notes

- All 16 cited fork SHAs confirmed as ancestors of their respective
  fork-main branches (`git merge-base --is-ancestor <sha> HEAD`).
- Per `feedback-upstream-means-upstream`: upstream source was read
  from `/Users/henrik/source/ruvnet/{ruflo,agentdb}/` after
  `git fetch origin main`. Upstream HEADs at audit time:
  `ruvnet/ruflo@31809ebeb 2026-05-25`,
  `ruvnet/agentdb@1776223 2026-05-23`.
- Forward-walk check: `git log <previous-HEAD>..origin/main -- <paths>`
  for every cited byte-identical path returned ZERO commits on both
  repos, confirming the byte-identical predicates still hold without
  needing per-path `diff -q` after fetch.
- Fork source verified by direct file inspection at the line ranges
  cited in each ledger row; ADR marker comments
  (`ADR-0244 site #N`, `ADR-0246 F-03-XXX`, `ADR-0240 site #2`,
  `ADR-0247 site #3`) located inline.
- Ledger NOT modified. No remote pushed. Read-only audit per task
  constraints.
- The 35-row `2026-05-24` block contains more "fork-only" /
  "block-identical" / "byte-identical" rows than any prior single-day
  batch — this reflects the Batch 5 + post-Batch-5 remediation work
  (ADR-0238, ADR-0244, ADR-0246, ADR-0247) landing in one cycle.
