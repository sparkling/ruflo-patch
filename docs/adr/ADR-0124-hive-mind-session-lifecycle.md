# ADR-0124: Hive-mind session lifecycle (checkpoint / resume / export / import)

- **Status**: **Implemented (2026-05-03)** per ADR-0118 §Status (T6 complete; fork 42d7ad606). Implementation per §Implementation plan: new `commands/hive-mind-session.ts` with five subcommand handlers, archive read/write helpers, `queenType` capture/restore wired into checkpoint/resume.
- **Date**: 2026-05-02
- **Deciders**: Henrik Pettersen
- **Depends on**: ADR-0116 (hive-mind marketplace plugin — verification matrix), ADR-0118 (runtime gaps tracker — owns task T6), ADR-0122 (T4 typed memory shape), ADR-0123 (T5 typed memory backend) — session state should use the typed memory backend for portability
- **Related**: ADR-0104 (queen orchestration — re-spawn semantics), ADR-0114 (architectural model — substrate/protocol/execution layering)
- **Scope**: Fork-side runtime work in `v3/@claude-flow/cli/src/commands/`. Closes ADR-0118 §T6. Per `feedback-patches-in-fork.md`, USERGUIDE-promised features that don't work are bugs and bugs are fixed in fork.

## Context

ADR-0116's verification matrix flagged the `Session management` row as ✗: the USERGUIDE advertises checkpoint, resume, export, and import for hive sessions, but the runtime ships none of it.

Empirical state in the fork (`forks/ruflo`, 2026-05-02):

```
$ grep -nE "checkpoint|exportSession|importSession|resumeSession|saveSession" \
    v3/@claude-flow/cli/src/commands/hive-mind.ts \
    v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts
(zero matches)
```

State persistence is limited to `loadHiveState`/`saveHiveState` writing the live state file in place — no versioned snapshots, no archive format, no resume path. Two command-surface markdown files exist with no handler logic behind them:

- `forks/ruflo/.claude/commands/hive-mind/hive-mind-sessions.md`
- `forks/ruflo/.claude/commands/hive-mind/hive-mind-resume.md`

Both files exist today as auto-generated stubs with no frontmatter. ADR-0116's annotation policy requires `implementation-status: missing` on each, but no materialise run has applied that policy yet. Either (a) the next ADR-0116 P1 materialise run writes `implementation-status: missing`, then this ADR's annotation-lift flips it to `implemented`, or (b) this ADR's lift step is conditional — runs only if the materialise step ran first. The lift criterion below names this dependency explicitly. ADR-0118 §T6 owns the gap; this ADR holds the design decisions for the session-archive shape and the resume sequence.

## Decision Drivers

- **Queen re-spawn semantics (load-bearing)** — per ADR-0104, a re-spawned queen receives a continuation marker so it knows it is resuming, not initialising; uses the existing `child_process.spawn('claude', …)` path against the user's subscription per `reference-ruflo-architecture`. Resume contract is non-trivial: re-spawned queen must preserve original `prompt` + worker manifest and not re-initialise context already established pre-checkpoint
- **ADR-0122 (T4) typed-shape contract** — `hiveState` payload uses the typed entry shape (`{ value, type, ttlMs, expiresAt, createdAt, updatedAt }`); checkpoints round-trip without translation
- **ADR-0123 (T5) RVF-backed cache contract** — checkpoint reads pass through the LRU cache layer; restore writes through the same backend interface, preserving WAL semantics; cache coherency across processes is RVF-is-source-of-truth per T5 §Architecture
- **USERGUIDE contract** advertises `sessions list`, `sessions checkpoint`, `resume`, `sessions export`, `sessions import` under the hive-mind surface; matrix row is currently ✗ — empty implementation today
- **`feedback-no-fallbacks.md`** — every error path throws explicitly; no silent degraded resume, no best-effort partial restore
- **Archive format is fork-internal** — no external SemVer commitment on the archive shape; the JSON skeleton documented under §"Archive format" is internal documentation, not a published JSON Schema; versioning header is forwards-compat for own-tool round-trips only

## Considered Options

- **(a) Versioned gzipped JSON archives** [CHOSEN] — `.gz` files under `.claude-flow/hive-mind/sessions/`, one full snapshot per checkpoint, `schemaVersion` header for forwards-compat
- **(b) SQLite snapshots** — copy the live SQLite-backed memory database (post ADR-0123) into a per-checkpoint file
- **(c) Incremental delta snapshots with periodic full snapshots** — log-structured: deltas between checkpoints + periodic compactions

## Pros and Cons of the Options

**(a) Versioned gzipped JSON archives**

- Pro: portable across machines and fork upgrades; human-debuggable on decompress (`zcat archive.json.gz | jq`)
- Pro: simple resume sequence — read, ungzip, parse, validate version, restore, re-spawn
- Pro: aligns with ADR-0122 typed memory shape — the `hiveState` payload is already JSON-serializable
- Pro: no DB engine coupling — works whether T5 backend is RVF, SQLite, or future
- Con: full snapshot per checkpoint — archive grows linearly with state size; per-snapshot bandwidth is `O(state)`
- Con: no compaction story — long-lived hives with frequent checkpoints accumulate disk usage linearly
- Con: opaque to text tools without decompress — `grep`/`rg` over a sessions/ directory needs `zcat | grep` or equivalent; CI greppability requires tooling adjustment
- Con: gzip CRC catches transport bit-flips, but a corrupted JSON payload that round-trips through `JSON.parse` without throwing (e.g., a numeric field tampered to a still-valid value) is undetected — corruption beyond gzip's CRC scope is out of band
- Con: not atomic on write — large `state` requires careful write-then-rename to avoid torn checkpoints
- Con: `schemaVersion` is forwards-compat only — schema-version mismatch on resume is hard-fail (no migration tool ships); user-facing UX is "export, upgrade, re-import on a compatible build"

**(b) SQLite snapshots**

- Pro: atomic via `VACUUM INTO` or file copy with WAL checkpoint
- Pro: incremental backup primitives available (rsync deltas, page-level diffs)
- Con: couples archive format to T5's specific SQLite backend — breaks if T5 evolves to RVF-only or hybrid
- Con: not human-debuggable without sqlite3 toolchain
- Con: cross-machine portability fragile — version-specific page formats, ICU collation, FTS extensions

**(c) Incremental delta snapshots**

- Pro: archive size scales with delta volume, not absolute state size — efficient for long-lived hives where (a)'s linear growth becomes painful
- Pro: per-checkpoint cost is small (delta encoding only)
- Pro: directly addresses (a)'s linear-archive-growth con; the right answer if/when current scale shows pain
- Con: resume sequence non-trivial — must replay deltas in order, handle missing baselines
- Con: corruption in any delta breaks the chain; recovery semantics are subtle
- Con: significantly more code than (a) — premature optimisation given current scale (no benchmark shows full snapshots are a bottleneck)
- Con: deferral is conditional, not permanent — if a real hive surfaces archives > 50 MB or checkpoint frequency > 1/min sustained, (c) becomes the correct answer and this ADR escalates per ADR-0118 §T6

## Decision Outcome

**Chosen option: (a) versioned gzipped JSON archives**, traceable to drivers as follows:

- **Queen re-spawn driver**: format-orthogonal — re-spawn semantics work identically under (a), (b), or (c). (a) is chosen for the other drivers, not this one.
- **T4 typed-shape driver**: (a) preserves the typed shape verbatim in JSON — no translation, no schema mapping. (b) and (c) require a typed-row mapping or a delta-encoding schema.
- **T5 backend driver**: (a) is decoupled from T5's backend choice — works whether the active backend is RVF, sql.js, or a future hybrid. (b) couples archive to SQLite specifically and is rejected per `project-rvf-primary` (RVF is primary; SQLite is fallback).
- **`feedback-no-fallbacks` driver**: (a)'s error paths (gzip CRC, JSON parse, structural validation, version check) all throw cleanly. (c)'s delta-replay semantics introduce subtle partial-success states that are hard to make fail-loud.
- **USERGUIDE coverage driver**: (a) is the smallest implementation that closes the matrix row.

(c)'s complexity is rejected as speculative for now — no measured pain from full snapshots today. The deferral is conditional: archive size > 50 MB or sustained checkpoint frequency > 1/min triggers escalation per ADR-0118 §T6 ("Promote to its own ADR if the session-archive format becomes a versioned artifact other tools consume") to revisit (c).

**Trade-offs accepted**: archive grows linearly with state size; no compaction; sessions/ greppability requires `zcat | grep`; corruption beyond gzip CRC scope (e.g., post-decompress JSON tampering with type-valid mutations) is undetected — a future iteration can add `payloadHash` if needed (see §Specification).

## Consequences

**Positive**

- Portable archives — copy the file, restore on any machine running a compatible fork build
- Human-debuggable — `zcat archive.json.gz | jq` reveals the full hive snapshot with no proprietary tooling
- Simple resume sequence — read, ungzip, version-check, restore typed memory, re-spawn queen
- Decoupled from T5 backend choice — works whether memory lives in RVF, SQLite, or hybrid
- `schemaVersion` header allows internal evolution without breaking own-tool round-trips

**Negative**

- Full snapshot per checkpoint — archive size is `O(state)` per file; no compression-across-checkpoints
- No compaction — long-lived hives with frequent checkpoints accumulate disk usage linearly
- Archive grows linearly with state size — large worker manifests + large typed-memory state inflate every snapshot
- Opaque to plain-text tools — `grep`/`rg` over `sessions/` requires `zcat | grep`; CI scripts that scan sessions/ need adjusted tooling
- No external schema commitment — third-party tooling that parses archives risks breakage on `schemaVersion` bumps
- **Schema-version mismatch on resume is hard-fail** — `resume <id>` against an archive with `schemaVersion ≠ 1` exits non-zero with `[ERROR] Archive schemaVersion <n> not supported by this build (expected 1). Export and re-import on a compatible build.` No migration tool ships with this ADR; user must export pre-upgrade and re-import post-upgrade if the format ever bumps. Recommended user workflow documented under §Refinement edge cases

## Validation

- **Unit**: archive serialize/deserialize round-trip; `schemaVersion` mismatch produces explicit error (no silent fallback per `feedback-no-fallbacks.md`); typed-memory shape preservation per ADR-0122; structural validation rejects missing `queenPrompt` / malformed `workerManifest`; gzip round-trip
- **Integration**: round-trip checkpoint→resume; corrupted archive (truncated gzip, bad JSON, missing required fields) produces explicit failure; legacy untyped entries from pre-T4 sessions migrate on import per T4 migration policy; multi-session enumeration ordering
- **Acceptance**: five named checks in `lib/acceptance-adr0124-hive-session-checks.sh` (matching the ADR-0123 naming convention) wired into `scripts/test-acceptance.sh`:
  - `check_hive_mind_sessions_list` — exercises `sessions list` against multi-session and zero-session states
  - `check_hive_mind_sessions_checkpoint` — exercises `sessions checkpoint <id>` and asserts archive shape on disk
  - `check_hive_mind_resume` — round-trip checkpoint → kill → resume; verifies queen re-spawn produces continuation marker
  - `check_hive_mind_sessions_export` — exercises `sessions export <id> --output <path>` and asserts archive parses cleanly
  - `check_hive_mind_sessions_import` — exercises `sessions import <path>` against an exported archive

  Tests run in an init'd project per `feedback-test-in-init-projects.md`; parallel-safe invocations use `$(_cli_cmd)` per `reference-cli-cmd-helper`. Resume-after-crash is sequential (kills processes, must not race other parallel checks).

## Decision

**Implement five session subcommands backed by gzipped JSON archives, and wire resume to re-spawn the queen with the restored prompt + worker manifest.** The archive format is internal-only — versioned for forwards-compat but not promised to external tooling.

Subcommands (all under `ruflo hive-mind`):

| Command | Effect |
|---|---|
| `sessions list` | Enumerate persisted hive state files in `.claude-flow/hive-mind/sessions/` |
| `sessions checkpoint <session-id>` | Snapshot current `state` to a versioned gzipped JSON file |
| `resume <session-id>` | Load a checkpoint and re-spawn the queen with restored prompt + worker manifest |
| `sessions export <session-id> --output <path>` | Dump checkpoint to a portable archive at `<path>` |
| `sessions import <path>` | Load an exported archive into local state |

Per ADR-0122 + ADR-0123, the in-memory `state` carried in archives uses the typed memory shape (`{ value, type, ttlMs, expiresAt, ... }`). Checkpoints round-trip through the typed backend; legacy untyped entries from pre-T4 sessions migrate on import per the T4 migration policy.

**Archive format is internal-only.** Per ADR-0118 §T6 escalation criterion ("Promote to its own ADR if the session-archive format becomes a versioned artifact other tools consume"), the format stays a fork-internal contract for now. Versioning header is included so we can evolve without breaking own-tool round-trips, but no external consumer is promised.

## Implementation plan

Lifted verbatim from ADR-0118 §T6:

1. **`hive-mind sessions list`** — enumerate persisted hive state files in `.claude-flow/hive-mind/sessions/`
2. **`hive-mind sessions checkpoint <session-id>`** — snapshot current `state` to a versioned file (gzipped JSON)
3. **`hive-mind resume <session-id>`** — load a checkpoint and re-spawn the queen with the restored prompt + worker manifest
4. **`hive-mind sessions export <session-id> --output <path>`** — dump checkpoint to a portable archive
5. **`hive-mind sessions import <path>`** — load an exported archive into local state
6. **`queenType` wiring (ADR-0107 Option D step 3)** — add `queenType` field to `state.json` schema (live state, on the queen object); update MCP `hive-mind_status` handler in `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts` to surface `state.queen?.queenType`; capture `queenType` into archive payload at checkpoint; restore `state.queen.queenType` from archive before queen re-spawn at resume
7. Update `hive-mind-sessions.md` and `hive-mind-resume.md` command docs per §Completion's conditional-dependency rule (flip-or-write so the post-condition is "no `missing` annotation remains")
8. Tests: round-trip export→import, resume after crash, multi-session enumeration, schemaVersion mismatch, spawnability-probe pre-mutation throw, resume idempotence, queenType round-trip through checkpoint/resume, hive-mind_status surfaces queenType

### Files

- **New**: `forks/ruflo/v3/@claude-flow/cli/src/commands/hive-mind-session.ts` — handlers for the 5 subcommands + archive read/write helpers. Flat sibling of `hive-mind.ts` per the existing `commands/` convention (every command is a flat sibling `.ts` file; no `commands/<name>/` subdirectories exist today, and ADR-0125 (T7) confirms `hive-mind.ts` stays a single flat file). Distinct from the existing top-level `commands/session.ts` (905 lines, generic CLI session-management — unrelated to hive-mind sessions; the `hive-mind-` prefix disambiguates).
- **Edit**: `forks/ruflo/v3/@claude-flow/cli/src/commands/hive-mind.ts` — wire the subcommand dispatch into the existing `hive-mind` command tree (currently 1416 lines; per ADR-0089 upstream-files-exception this is acceptable, but new code goes in `hive-mind-session.ts` rather than inline to avoid further bloat)
- **Edit**: `forks/ruflo/.claude/commands/hive-mind/hive-mind-sessions.md`, `hive-mind-resume.md` — annotation handling per the lifecycle dependency in §Context (these files have no frontmatter today; ADR-0116's materialise run is expected to write `implementation-status: missing` first, then this ADR's lift flips it to `implemented` or removes the field per ADR-0118 §"Annotation lifecycle")

### Archive format (internal)

Filename pattern: `<session-id>-<iso8601>.json.gz` under `.claude-flow/hive-mind/sessions/`. Single canonical shape used by both `checkpoint` (canonical archive directory) and `export`/`import` (user-supplied path). The §Specification block below is the authoritative shape definition.

`schemaVersion` exists for forwards-compat; it is not part of an external contract.

### Resume sequence

1. Read + decompress archive
2. Validate `schemaVersion` (currently must be `1`; reject with explicit error otherwise)
3. Probe queen spawnability (`which claude` + auth) before any state mutation
4. Restore `hiveState` into the typed memory backend (ADR-0123)
5. Register `workerManifest`
6. Re-spawn queen via the existing queen-spawn path with `queenPrompt` verbatim + continuation marker per ADR-0104
7. The re-spawned queen receives `--continuation <session-id>` so it knows it is resuming, not initialising

## Specification

Five subcommand surfaces under `ruflo hive-mind`:

- `sessions list` — enumerate state files in `.claude-flow/hive-mind/sessions/`; output: `{ sessionId, checkpointAt, archivePath, sizeBytes }[]` sorted by `checkpointAt` desc
- `sessions checkpoint <session-id>` — atomic write-then-rename of a versioned gzipped JSON archive to `.claude-flow/hive-mind/sessions/<session-id>-<iso8601>.json.gz`
- `resume <session-id>` — load the most recent checkpoint matching `<session-id>` and re-spawn the queen via `child_process.spawn('claude', …)` per `reference-ruflo-architecture` with the restored prompt + worker manifest
- `sessions export <session-id> --output <path>` — checkpoint to a user-supplied path (same archive shape)
- `sessions import <path>` — read a user-supplied archive and materialise into local state under a fresh `session-id`

Archive shape (internal contract — `schemaVersion` MUST be `1` for current fork build):

```
{
  "schemaVersion": 1,
  "hiveState":     { /* typed memory shape per ADR-0122; round-trips through ADR-0123 backend */ },
  "queenPrompt":   "<original spawn prompt as string>",
  "queenType":     "strategic" | "tactical" | "adaptive" | undefined,
  "workerManifest": [ { "id", "type", "manifest" }, ... ],
  "timestamp":     "<iso8601>"
}
```

`queenType` carries ADR-0107 Option D step 3's queen-type identifier through the archive. Captured from `state.queen?.queenType` at checkpoint; restored to `state.queen.queenType` before queen re-spawn so the resumed queen starts under the same type. `undefined` is permitted for archives written before the field was wired in (older fork builds) or hives spawned without an explicit type.

**Live state field (ADR-0107 Option D step 3 wiring).** Independent of the archive, `state.json` (the live state file written by `saveHiveState`) gains a `queenType` field on the queen object. The MCP `hive-mind_status` handler in `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts` surfaces the current `queenType` in its response payload (small handler change — read `state.queen?.queenType` and include it in the status output).

**Checksum field — deferred.** The shape does NOT include a `payloadHash`. Rationale: gzip CRC catches transport bit-flips; structural validation catches missing or wrong-typed fields; JSON-shape tampering that round-trips through `JSON.parse` AND structural validation without throwing is the only undetected case (e.g., a numeric `ttlMs` flipped to a different valid number). Accepted as a known gap. If a future use case demands tamper-detection, add `payloadHash: <sha256-hex>` over the canonicalized payload (sorted keys, no whitespace) — validated before structural-shape validation. This is forwards-compatible with `schemaVersion: 1` because deserializers can ignore unknown fields per the existing forwards-compat contract; the validation step would simply skip the check on archives without the field.

Archive directory: `.claude-flow/hive-mind/sessions/`. Created lazily on first checkpoint (no init-time directory creation).

Resume contract: re-spawn the queen via `child_process.spawn('claude', …)` per `reference-ruflo-architecture` (ruflo orchestrates, `claude` CLI executes against user's subscription per `feedback-no-api-keys.md`). The spawn invocation receives `queenPrompt` verbatim plus a continuation marker per ADR-0104; the resumed queen MUST NOT re-initialise context already established pre-checkpoint.

## Pseudocode

**Checkpoint sequence** (`sessions checkpoint <session-id>`):

```
1. snapshot = collectHiveState(sessionId)
   // hiveState ← typed memory backend (ADR-0123); read goes through cache
   // queenPrompt ← in-memory queen registration
   // queenType ← state.queen?.queenType (may be undefined for older hives)
   // workerManifest ← worker registry
2. payload = JSON.stringify({ schemaVersion: 1, hiveState, queenPrompt, queenType, workerManifest, timestamp: nowIso() })
3. compressed = gzip(payload)
4. tempPath = `${archiveDir}/.${sessionId}-${ts}.json.gz.tmp`
5. fs.writeFileSync(tempPath, compressed)
6. fs.renameSync(tempPath, finalPath)   // atomic on same filesystem
```

**Resume sequence** (`resume <session-id>`):

```
1. archivePath = locateLatestArchive(sessionId)         // throws if missing
2. compressed = fs.readFileSync(archivePath)
3. payload = JSON.parse(gunzip(compressed))             // throws on corrupt gzip / bad JSON
4. assert payload.schemaVersion === 1                   // explicit error otherwise — no fallback
5. probeQueenSpawnability()                             // which claude + auth probe; throw BEFORE state mutation
6. restoreHiveStateIntoTypedBackend(payload.hiveState)  // per ADR-0123 typed backend; LRU cache on calling process is warmed
7. registerWorkerManifest(payload.workerManifest)
8. state.queen.queenType = payload.queenType            // ADR-0107 Option D step 3; assigned before spawn so the new process reads the right type
9. child_process.spawn('claude', [...args, '--continuation', sessionId], { … })
   // queenPrompt verbatim + continuation marker per ADR-0104; resume is retry-safe — re-runs reach the same fixed point
```

**Export = checkpoint to user-supplied path**:

```
1. snapshot = collectHiveState(sessionId)
2. write gzipped JSON to <user-path> (same shape as canonical checkpoint)
```

**Import = checkpoint from user-supplied path**:

```
1. read + gunzip + parse user-supplied archive
2. validate schemaVersion
3. write into canonical archive directory under fresh sessionId
4. (resume is a separate explicit step — import does NOT auto-resume)
```

## Architecture

- **Handler placement** — new file `forks/ruflo/v3/@claude-flow/cli/src/commands/hive-mind-session.ts` (flat sibling to `hive-mind.ts`; not under a `hive-mind/` subdirectory — none exists in `commands/` today) holds all five subcommand handlers + archive read/write helpers; dispatcher wired into existing `forks/ruflo/v3/@claude-flow/cli/src/commands/hive-mind.ts` subcommand tree. Filename `hive-mind-session.ts` (singular) intentionally distinct from existing top-level `commands/session.ts` (generic CLI session management, unrelated)
- **Integration with ADR-0122 (T4) typed memory** — the `hiveState` field is the typed-entry payload (`{ value, type, ttlMs, expiresAt, ... }`) verbatim; checkpoints round-trip without translation; legacy untyped entries from pre-T4 sessions migrate on import per T4 migration policy
- **Checkpoint contents — queenType capture** — `queenType` is captured from `state.queen?.queenType` if present; resume restores it onto `state.queen.queenType` before queen re-spawn so the new process starts under the original type per ADR-0107 Option D step 3. Folded into this ADR per ADR-0118 §Open questions item 3 default rule, superseding ADR-0125's prior out-of-scope declaration of the same step
- **Interaction with ADR-0123 (T5) RVF backend** — checkpoint reads `hiveState` from the typed backend; reads pass through the LRU cache layer (no backend-direct path); restore on `resume`/`import` writes through the same backend interface, preserving WAL semantics. **Cache coherency on restore**: restore warms only the calling process's in-process LRU; a concurrently-running daemon or sibling CLI keeps its existing cache and re-fetches from RVF on next `loadHiveState` per the ADR-0123 §Architecture "RVF is source of truth" contract — this ADR does not introduce explicit cache invalidation messaging
- **Queen prompt restoration: verbatim** — the resumed queen receives `queenPrompt` exactly as captured at checkpoint time. No re-templating against the current build's prompt skeleton. Trade-off: a hive resumed against a newer fork build runs the OLD prompt against potentially-newer MCP tool contracts. Accepted because (a) re-templating would lose worker delegation context already in the prompt, (b) ADR-0104's tool-use block is the only known divergence point and is backwards-compatible (older prompts still work), (c) re-templating opens a versioning question the fork has no current answer to. If a future prompt change breaks resume compatibility, escalate per ADR-0118 §T6
- **Command-frontmatter wiring** — `forks/ruflo/.claude/commands/hive-mind/hive-mind-sessions.md` and `hive-mind-resume.md` have no frontmatter today; ADR-0116's next materialise run is expected to write `implementation-status: missing` per its policy, after which this ADR's annotation-lift flips to `implemented` (or removes the field) once all unit + integration + acceptance tests are green per ADR-0118 §"Annotation lifecycle"
- **Queen re-spawn path** — uses the existing queen-spawn invocation point (per ADR-0104); `resume` does NOT introduce a separate spawn code path — same `child_process.spawn('claude', …)` plus `--continuation <session-id>` argument

## Refinement

**Edge cases**

- **Resume after fork upgrade with schema drift** — `schemaVersion` mismatch throws hard-fail. User-visible error: `[ERROR] Archive schemaVersion <n> not supported by this build (expected 1). To migrate, run 'ruflo hive-mind sessions export <id>' on the source build, then 'sessions import <path>' on a compatible build.` Exit code 1. No migration tool ships with this ADR — recommended workflow is export-on-old-build → import-on-new-build IF and only if the new build also accepts the old version. If neither side does, the archive is unreadable and that is the documented failure mode.
- **Corrupted archive** — truncated gzip throws at gunzip step; malformed JSON throws at `JSON.parse`; missing required fields throw at structural-validation step. Each surfaces a distinct error; never silently degraded. Gzip CRC catches transport bit-flips; JSON-shape tampering that round-trips through `JSON.parse` without throwing is undetected (acknowledged trade-off — see §Decision Outcome). If a future iteration adds `payloadHash` to the archive shape, it goes here as a SHA256 over the canonicalized payload, validated before structural-shape validation.
- **Partial worker manifest** (worker entry missing `id` or `type`) — structural validation rejects on resume; archive flagged as malformed. No partial-restore.
- **Missing `queenPrompt`** — required field; resume fails with explicit error (no defaulting to empty prompt).
- **Sessions directory does not exist on first `sessions list`** — return empty list, do NOT auto-create (lazy creation belongs to checkpoint write path).
- **Concurrent checkpoint vs active session writes** — checkpoint reads `hiveState` from the T5 backend while a sibling process may be mid-write through the same backend. T5's WAL semantics guarantee read-consistency at the row level; checkpoint sees a point-in-time snapshot of each entry but the snapshot is NOT cross-row-atomic — entries written between read of entry A and read of entry B may produce a non-coherent snapshot if writers are racing. Accepted: hive checkpoint is best-effort consistency at the row level, not transactional across rows. Tests cover this (multi-writer + checkpoint + resume produces a state that is "some valid prefix of writer order," not corrupted). If a future use case demands cross-row atomicity, escalate per ADR-0118 §T6.
- **Concurrent checkpoint vs concurrent checkpoint** — atomic write-then-rename guarantees no torn archives; if two checkpoints race for the same `<session-id>-<timestamp>` filename (sub-second collision), the second `renameSync` overwrites the first (acceptable — both reflect the same moment).
- **Queen re-spawn failure mid-resume** — pseudocode steps 5 (typed-memory restore) and 7 (queen spawn) are not transactional. If step 7 fails after step 5 has mutated typed memory, the hive is in a half-resumed state. **Decision**: pre-validate spawnability before mutating state — step 5 is preceded by a probe (`which claude` + auth check). If the probe fails, throw before any state mutation. If probe passes but spawn fails anyway (rare race), the resumed typed-memory state is left in place; rerunning `resume <id>` is idempotent (re-restores the same checkpoint, re-tries spawn). Documented as "resume is retry-safe; partial-state rollback is not implemented because reruns reach the same fixed point."

**Error paths** (no fallbacks per `feedback-no-fallbacks.md`)

- Archive read failure → throw, do not fall back to live state
- `schemaVersion` mismatch → throw with the exact error string from §Consequences; do not attempt best-effort restore
- Corrupted gzip stream → throw at gunzip; do not attempt to read uncompressed bytes
- JSON parse error → throw; do not attempt partial-object recovery
- Worker manifest validation failure → throw; do not partial-restore subset of workers
- Missing `queenPrompt` → throw; do not default to empty prompt
- Spawnability probe failure (no `claude` on PATH, auth missing) → throw BEFORE any state mutation
- Queen re-spawn failure (`child_process.spawn` exits non-zero post-probe) → throw; resumed typed-memory remains in place; user reruns `resume <id>` after fixing the spawn issue

**Test list**

- **Unit**: archive serialize/deserialize symmetry; `schemaVersion` gate (1 OK, 0/2 explicit error); structural validation rejects missing `queenPrompt` / malformed `workerManifest`; gzip round-trip; spawnability-probe failure throws before any state mutation
- **Integration**: real checkpoint→resume cycle in tmp dir; corrupted-archive cases (truncated gzip, bad JSON, missing fields); concurrent-checkpoint-vs-checkpoint atomicity; concurrent-checkpoint-vs-active-write produces a coherent prefix; multi-session enumeration ordering; resume idempotence (rerun `resume <id>` against same checkpoint reaches the same fixed point)
- **Acceptance**: five named checks per the §Validation list, run against a real init'd project per `feedback-test-in-init-projects.md`; resume-after-crash test runs sequentially; use `$(_cli_cmd)` for parallel safety per `reference-cli-cmd-helper`

## Completion

**Annotation lift criterion** — T6 marked `complete` in ADR-0118 §Status, with Owner/Commit columns naming a green-CI commit. Annotation lift fires on the next materialise run after that flip. See ADR-0118 §Annotation lifecycle for the canonical contract.

1. Drop the `Session management` row from the `## Known gaps vs. USERGUIDE` table in ADR-0116's plugin README (auto-handled by next P1 materialise run when this Tn is marked `complete` in ADR-0118 §Status)
2. Flip `implementation-status: missing` → `implemented` (or remove the field entirely) on `forks/ruflo/.claude/commands/hive-mind/hive-mind-sessions.md` and `hive-mind-resume.md`. **Conditional dependency**: this step assumes ADR-0116's materialise run has already written the `implementation-status: missing` frontmatter to these files. Today (2026-05-02) neither file has any frontmatter; if the materialise run has not run by the time T6 lands, the lift step instead writes `implementation-status: implemented` directly (or the field is omitted). Either way, the post-condition is the same: no `missing` annotation remains on either file.

**Acceptance wire-in** — new helper `lib/acceptance-adr0124-hive-session-checks.sh` (matching ADR-0123's naming convention) registered in `scripts/test-acceptance.sh`. The five named checks from §Validation run against a real init'd project. The four read-only checks (`list`, `checkpoint`, `export`, `import`) can run in the parallel wave; `check_hive_mind_resume` runs sequentially after the parallel wave joins (it kills processes — must not race other parallel checks). All parallel invocations MUST use `$(_cli_cmd)` per `reference-cli-cmd-helper`. Update ADR-0094 living tracker once the helper lands.

**Done when**: all acceptance criteria below check; ADR-0118 §Status row for T6 flips to `complete` with commit SHA; annotations lift via next materialise run; ADR-0094 reflects the new acceptance coverage.

## Acceptance criteria

- [ ] `sessions list` enumerates every state file in `.claude-flow/hive-mind/sessions/`; multi-session test asserts ordering + correct count; empty-directory test returns empty list (does NOT auto-create)
- [ ] `sessions checkpoint <id>` produces a gzipped JSON archive at the canonical path; archive parses cleanly via `zcat | jq` and contains the typed-memory state per ADR-0122
- [ ] Round-trip test: `export` → delete local state → `import` → resulting state byte-equals the pre-export state (modulo timestamps that legitimately differ)
- [ ] Resume-after-crash test: kill a running hive, run `resume <id>`, queen re-spawns with the restored prompt + worker manifest and continues making progress against the original objective
- [ ] `schemaVersion` mismatch produces the explicit error string from §Consequences (no silent fallback per `feedback-no-fallbacks.md`)
- [ ] Spawnability-probe failure throws BEFORE typed-memory mutation; resumed state is unchanged from pre-resume
- [ ] Resume is retry-safe: `resume <id>` rerun after a partial failure reaches the same fixed point
- [ ] `queenType` round-trips through checkpoint/resume — value set on `state.queen.queenType` pre-checkpoint matches value on `state.queen.queenType` post-resume
- [ ] `mcp__ruflo__hive-mind_status` surfaces the current `queenType` in its response payload (ADR-0107 Option D step 3)
- [ ] `hive-mind-sessions.md` and `hive-mind-resume.md` carry no `implementation-status: missing` annotation after all three test levels are green (per the conditional-dependency step in §Completion)
- [ ] `npm run test:unit` and `npm run test:acceptance` both green

## Risks

**Medium.** Re-spawning a queen mid-conversation needs careful prompt reconstruction — the resumed queen must not re-initialise context it already established pre-checkpoint, must not lose worker delegation state, and must respect ADR-0104's queen-orchestration model. The continuation marker in step 8 of the resume sequence is the critical contract; tests must exercise the not-re-initialising path explicitly.

**Verbatim-prompt drift** — if the queen-prompt skeleton changes in a future fork build (e.g., a new mandatory tool-use block), resuming a pre-change checkpoint runs the old prompt against new MCP contracts. Acknowledged trade-off (see §Architecture); escalate per ADR-0118 §T6 if a real divergence breaks resume.

Per ADR-0118 §T6 escalation criterion: **promote to its own ADR if the session-archive format becomes a versioned artifact other tools consume.** For this ADR, the format is internal-only — no external schema commitment, no published JSON Schema, no SemVer guarantees on the archive shape.

## References

- ADR-0116 — hive-mind marketplace plugin (verification matrix that flagged the gap)
- ADR-0118 — hive-mind runtime gaps tracker (owns task T6, defines the bullets implemented here; §Open questions item 3 default rule is the basis for folding ADR-0107 step 3 into this ADR)
- ADR-0122 — typed memory shape (T4) — archive payload shape
- ADR-0123 — typed memory backend (T5) — round-trip storage layer
- ADR-0104 — queen orchestration (resume re-spawn semantics)
- ADR-0107 — queen-type differentiation (origin of Option D step 3: persist `queenType` to `state.json`, surface via `hive-mind_status`; folded into this ADR per ADR-0118 §Open questions item 3)
- ADR-0125 — queen-type runtime (T7) — confirms `commands/hive-mind.ts` stays a single flat file (no `commands/hive-mind/` subdirectory); previously declared ADR-0107 Option D step 3 out of scope, now superseded by the fold-in here
- ADR-0089 / `project-adr0094-living-tracker` — upstream-files-exception for `hive-mind.ts` 500-line limit; ADR-0094 acceptance-coverage tracker

## Review notes

Open questions surfaced during the 2026-05-02 review pass — recorded here, not blocking the ADR's `Proposed` status:

1. **Verbatim queen-prompt vs build-skeleton drift**: §Architecture commits to verbatim restoration with the trade-off that a hive resumed on a newer fork build runs the OLD prompt against potentially-newer MCP contracts. ADR-0104's tool-use block was the most recent prompt-skeleton change. If a future change introduces an incompatible tool-use contract, this ADR's verbatim choice becomes a resume-breaking bug. Open question: should resume detect known-incompatible prompt skeletons and refuse rather than silently running an old prompt? Deferred — escalation triggered by a concrete incompatibility, not pre-emptively. (triage row 25 — DEFER-TO-FOLLOWUP-ADR: escalates when fork build introduces non-backwards-compat queen-prompt skeleton)

2. **Cross-process cache coherency on restore**: `resume`/`import` warm only the calling process's LRU cache (per ADR-0123 §Architecture's "RVF is source of truth" punt). Open question: should the resumed queen broadcast a `cache-invalidate` signal to a running daemon that may be holding a stale cache for the same hive? The ADR-0123 contract documents this as out-of-scope; this ADR inherits that punt. If real coherency bugs surface in the resume path, escalate per ADR-0118 §T6. (triage row 26 — DEFER-TO-FOLLOWUP-ADR: T6 inherits ADR-0123 punt; escalates when real coherency bug observed)

3. **Checkpoint-vs-active-write coherency**: §Refinement accepts row-level consistency, not cross-row atomicity. Tests cover "some valid prefix of writer order"; open question is whether that bar is enough for hive workloads where a partial-coherent state could mislead a resumed queen (e.g., consensus state recorded but worker-result it depends on missing). If a real misleading-resume bug surfaces, the fix is either (a) write-lock during checkpoint or (b) snapshot via T5's WAL transactional read. (triage row 27 — DEFER-TO-FOLLOWUP-ADR: row-level consistency accepted; escalates if misleading-resume bug surfaces)

4. **Migration tool absence on `schemaVersion` bump**: §Consequences commits to "export-on-old-build → import-on-new-build" as the user workflow, but this only works if both builds support both versions in opposite directions. If old build can't write v2 and new build can't read v1, the archive is unreadable. Open question: should every fork build ship with a one-shot migrator that reads the previous version? Deferred — only relevant when v2 actually exists. (triage row 28 — DEFER-TO-FOLLOWUP-ADR: hard-fail accepted; escalates when schemaVersion 2 introduced)

5. **`payloadHash` checksum**: deferred per §Specification. Open question: is gzip CRC + structural validation actually sufficient, or is JSON-shape tampering (e.g., a TTL flipped to a still-valid number) a realistic threat for hive archives? Deferred until a concrete tampering scenario is identified. — resolved (triage row 29: gzip CRC + structural validation accepted; deferred until concrete tampering scenario)

6. **Existing `commands/session.ts` (905 lines)**: top-level CLI session-management, unrelated to hive-mind sessions. The new `hive-mind-session.ts` filename disambiguates by prefix, but a future reader might still confuse them. Open question: should `commands/session.ts` be renamed to `commands/cli-session.ts` for clarity? Out of scope for this ADR; raise as a separate housekeeping issue if it surfaces in review. — resolved (triage row 30: hive-mind- prefix sufficient per §Files; rename is separate housekeeping)
