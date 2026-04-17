# Coverage Bug Ledger

Bugs discovered through the ADR-0094 acceptance coverage program. Append-only. Each entry is a standalone YAML block + short prose. One bug = one ID (BUG-NNNN).

**Fields**:
- `id` — monotonic, zero-padded 4 digits.
- `title` — one-line summary.
- `discovered` — ISO date.
- `check_id` — the acceptance check ID that first caught it (e.g., `p2-ap-enable`).
- `fork_file` — the source file that contained the bug.
- `state` — `discovered | triaged | in-fix | fix-committed | verified-green | closed | regressed | deferred | duplicate | not-a-bug`.
- `root_cause` — one paragraph, no hand-waving.
- `fix_strategy` — one sentence describing what the fix does.
- `fix_commit` — fork commit SHA (omit if not yet fixed).
- `verified_date` — ISO date when a full cascade ran green on this check (omit if not yet).
- `fingerprint` — SHA1(`check_id` + first-error-line + `fork_file`). Used for regression detection.
- `upstream_filed` — GitHub issue URL, or explicit reason `fork_only: <why>`.
- `related_adr` — ADR IDs that should be cross-linked.
- `owner` — agent / author responsible for close-out (may be `unassigned`).
- `depth_class` — one of `happy | error | lifecycle` (per ADR-0094 coverage metric).

**State transitions**:
```
discovered → triaged → in-fix → fix-committed → verified-green → closed
    |            |         |                                       |
    v            v         v                                       v
 not-a-bug   duplicate  deferred                               regressed
                                                                   |
                                                                   v
                                                             (back to in-fix)
```

**Close-out policy**:
- `closed`: check is green for ≥3 consecutive cascade runs across ≥3 days.
- `regressed`: previously-green check flips red AND fingerprint matches. Reopens the ledger entry; appends a new `regression_event` with date + cascade ID.
- `deferred`: known-broken but accepted; MUST have `accepted_until` date or explicit ADR cross-reference. Auto-converts to `in-fix` when date passes.

---

## BUG-0001 — autopilot tools ESM `require is not defined`

```yaml
id: BUG-0001
title: autopilot tools crash with "require is not defined" in ESM build
discovered: 2026-04-17
check_id: p2-ap-enable (plus lifecycle, predict, log)
fork_file: v3/@claude-flow/cli/src/autopilot-state.ts
state: fix-committed
root_cause: |
  File ships as ESM ("type": "module" in package.json, "module": "ESNext" in tsconfig) but
  6 helpers (getDefaultState, loadState, saveState, appendLog, loadLog, discoverTasks)
  used inline `const fs = require('fs')` etc. TypeScript preserves those require() calls
  verbatim in ESM output, so the 4 autopilot MCP tools that transit any of these helpers
  throw ReferenceError at runtime.
fix_strategy: Replace 6 inline require() calls with 4 top-level ESM imports (fs, path, os, crypto).
fix_commit: 196100171
verified_date: 2026-04-17
fingerprint: e8a4...pending  # to be computed by catalog-rebuild.mjs
upstream_filed: fork_only: ESM/CJS packaging artifact of our "type": "module" repackaging; upstream ships CJS where this works.
related_adr: [ADR-0094, ADR-0084]
owner: fix-autopilot-require (agent)
depth_class: happy
```

## BUG-0002 — embeddings_search crashes on minimal init

```yaml
id: BUG-0002
title: embeddings_search "Cannot read properties of undefined (reading 'enabled')"
discovered: 2026-04-17
check_id: p4-em-search
fork_file: v3/@claude-flow/cli/src/mcp-tools/embeddings-tools.ts
state: fix-committed
root_cause: |
  `init --full` writes a minimal embeddings.json (model/dimension/hnsw/taskPrefix only).
  Handler read the raw on-disk JSON and accessed config.hyperbolic.enabled. Because
  `embeddings_init` was never called, hyperbolic and neural sub-objects were undefined.
  All 6 read-path tools (search, generate, compare, neural, hyperbolic, status) crashed.
fix_strategy: Added applyDefaults() in loadConfig() that merges on-disk config with safe defaults (hyperbolic.enabled=false, neural.enabled=true, cacheSize=256, curvature=-1).
fix_commit: 196100171
verified_date: 2026-04-17
fingerprint: pending
upstream_filed: TBD (affects upstream HEAD — file candidate issue after test stabilization)
related_adr: [ADR-0094]
owner: fix-embeddings-search (agent)
depth_class: happy
```

## BUG-0003 — hooks_route wrong CausalRecall API signature

```yaml
id: BUG-0003
title: hooks_route crashes in enrichment path, aborts whole tool
discovered: 2026-04-17
check_id: ctrl-routing
fork_file: v3/@claude-flow/cli/src/mcp-tools/hooks-tools.ts
state: fix-committed
root_cause: |
  Called `cr.recall(task, { k: 5, minConfidence: 0.5 })` — options object as 2nd arg.
  Actual CausalRecall.recall() signature is (queryId, queryText, k, requirements?, accessLevel?).
  Options object flowed into embedder.embed(queryText) which crashed with
  "queryText.toLowerCase is not a function". Surrounding try/catch re-threw, killing
  the entire hooks_route tool even though primary routing (SolverBandit/Semantic)
  had already produced a valid recommended_agent.
fix_strategy: Use ergonomic cr.search({ query, k }) API + demote CausalRecall errors to metadata (causalContext.error) rather than re-throwing. Causal enrichment failure is not fatal per ADR-0082.
fix_commit: 196100171
verified_date: 2026-04-17
fingerprint: pending
upstream_filed: TBD (upstream bug)
related_adr: [ADR-0094, ADR-0082]
owner: fix-ctrl-routing (agent)
depth_class: happy
```

## BUG-0004 — session_delete undefined.replace

```yaml
id: BUG-0004
title: session_delete crashes when called with {name} instead of {sessionId}
discovered: 2026-04-17
check_id: p3-se-delete (plus lifecycle)
fork_file: v3/@claude-flow/cli/src/mcp-tools/session-tools.ts
state: fix-committed
root_cause: |
  session_delete and session_info required {sessionId} input. But session_save
  auto-generates sessionId and returns BOTH sessionId and name. Callers remembering
  only `name` (as ADR-0094's check did) pass {name}, leaving input.sessionId undefined.
  getSessionPath(undefined) then called undefined.replace(...) — crash.
fix_strategy: Added resolveSessionHandle() that accepts {sessionId} OR {name}, fails loudly on neither. Mirrors session_restore's existing either-key behavior.
fix_commit: 196100171
verified_date: 2026-04-17
fingerprint: pending
upstream_filed: TBD (upstream bug)
related_adr: [ADR-0094]
owner: fix-session-delete (agent)
depth_class: lifecycle
```

## BUG-0005 — RVF native `SFVR` magic misread as corruption

```yaml
id: BUG-0005
title: Pure-TS RvfBackend throws "bad magic SFVR" when native owns the file
discovered: 2026-04-17
check_id: t3-2-concurrent, adr0080-store-init
fork_file: v3/@claude-flow/memory/src/rvf-backend.ts
state: fix-committed
root_cause: |
  SFVR is the native @ruvector/rvf-node segment magic (forks/ruvector/crates/rvf/rvf-types/src/constants.rs:32),
  co-designed to coexist with pure-TS 'RVF\0'. Native writes SFVR to the main .rvf path + pure-TS
  metadata to .rvf.meta sidecar. When the pure-TS backend initialized on a project previously
  owned by native, loadFromDisk read the main path, saw SFVR, and threw RvfCorruptError instead
  of falling back to .meta.
fix_strategy: Added NATIVE_MAGIC = 'SFVR' constant + peek-and-skip path in loadFromDisk that falls back to .meta sidecar when the main file is native-owned.
fix_commit: 196100171
verified_date: 2026-04-17
fingerprint: pending
upstream_filed: TBD (upstream bug; ADR-0092 is the architecture context)
related_adr: [ADR-0094, ADR-0092, ADR-0086]
owner: fix-rvf-magic (agent)
depth_class: happy
```

## BUG-0006 — agentdb_experience_record wrote to wrong SQLite table

```yaml
id: BUG-0006
title: agentdb_experience_record wrote to episodes instead of learning_experiences
discovered: 2026-04-17
check_id: adr0090-b5-learningSystem
fork_file: v3/@claude-flow/cli/src/mcp-tools/agentdb-tools.ts
state: fix-committed
root_cause: |
  MCP handler called ReflexionMemory.storeEpisode (writes `episodes` table). The B5 check
  and the tool contract both expect the row to land in `learning_experiences`. Silent
  success + 0 rows in expected table = classic ADR-0082 violation.
fix_strategy: Rewired handler to call LearningSystem.recordExperience; pre-create parent learning_sessions row to satisfy FK constraint. Fail loudly if LearningSystem absent (no silent in-memory fallback).
fix_commit: 2f3a832d6
verified_date: 2026-04-17
fingerprint: pending
upstream_filed: TBD
related_adr: [ADR-0094, ADR-0082, ADR-0090]
owner: fix-controller-sqlite (agent)
depth_class: happy
```

## BUG-0007 — replayWal re-ingest created orphan native vec segments

```yaml
id: BUG-0007
title: replayWal re-ingested own entries into native backend, causing empty-search state
discovered: 2026-04-17
check_id: e2e-0059-p3-unified-both, e2e-0059-p3-dedup
fork_file: v3/@claude-flow/memory/src/rvf-backend.ts
state: fix-committed
root_cause: |
  During mergePeerStateBeforePersist, replayWal unconditionally re-ingested WAL entries
  into the native @ruvector/rvf-node backend. Single-writer CLI processes killed
  mid-shutdown left N orphan vec segments but indexedVectors: 0, needsRebuild: true.
  Every subsequent search returned empty (ADR-0082 silent-empty signature).
fix_strategy: For entries already in this.entries (alreadyLoaded=true — written by our own store() this session), update metadata dictionary only; skip HNSW + native index writes. Newly-seen peer entries still fall through to full ingest path.
fix_commit: 2f3a832d6
verified_date: 2026-04-17
fingerprint: pending
upstream_filed: TBD
related_adr: [ADR-0094, ADR-0082, ADR-0090]
owner: fix-controller-sqlite (agent)
depth_class: lifecycle
```

## BUG-0008 — RVF single-writer durability on process.exit(0) — INCOMPLETE

```yaml
id: BUG-0008
title: Concurrent CLI writers lose 5/6 entries because process.exit(0) skips compactWal
discovered: 2026-04-17
check_id: t3-2-concurrent
fork_file: v3/@claude-flow/memory/src/rvf-backend.ts
state: regressed  # partial fix landed but check still fails
root_cause: |
  CLI's setTimeout(process.exit(0), 500).unref() does NOT fire beforeExit, so
  memory-router._ensureExitHook → shutdownRouter → compactWal chain is skipped in most
  of 6 concurrent writers. Typically one lucky writer's beforeExit fires in time,
  compacts with only its own in-memory state, writes .meta.entryCount=1, and unlinks
  the WAL. Other 5 writers' entries live in WAL but .meta stays at 1.
fix_strategy: |
  Partial: call compactWal() after every store() (commit 196100171). Still fails because
  mergePeerStateBeforePersist only reads WAL, which first writer unlinks; subsequent
  writers see empty WAL and write their in-memory snapshot over .meta.

  Proper fix: under the lock, re-read .meta (not just WAL), merge on-disk state via
  seenIds-gated set-if-absent, THEN write. Scope > 1 phase; forked to ADR-0095.
fix_commit: 196100171 (partial)
verified_date: null  # still failing
fingerprint: pending
upstream_filed: TBD
related_adr: [ADR-0094, ADR-0095, ADR-0090, ADR-0082, ADR-0092]
owner: TBD (pending ADR-0095 design)
depth_class: lifecycle
```
