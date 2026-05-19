# Security Review — ADR-0194/0195/0196 Implementations

**Reviewer**: security-auditor agent
**Date**: 2026-05-19
**Scope**: AutopilotLearning Phase 3 (embedding-cluster pattern discovery), Phase 4 (cross-controller event bus), Phase 5 (federated sync interface)

## Review Method

Polled `git -C /Users/henrik/source/forks/agentic-flow log --oneline -10` and `git status` for ~25 minutes. One target commit landed during the review window:

* **`c89a782 test(autopilot): unit tests for ADR-0194/0195/0196`** — tests-only commit, adds three unit test files (1,383 LOC).

The production source for all three ADRs was still in the working tree (staged or untracked) at the close of the review window, not committed. To produce an actionable review rather than block on commit timing, the audit covered the working-tree artifacts that would constitute the implementation commit:

* Modified: `forks/agentic-flow/agentic-flow/src/coordination/autopilot-learning.ts` (~528 lines diff vs HEAD)
* Modified: `forks/agentic-flow/agentic-flow/src/services/agentdb-service.ts` (Phase 4 wiring — fully present on disk)
* New: `forks/agentic-flow/agentic-flow/src/services/federated-sync-provider.ts` (175 lines)
* New: `forks/agentic-flow/agentic-flow/src/services/sync-coordinator-federated-adapter.ts` (211 lines)

The committed unit tests (`c89a782`) were also audited.

## Commit `c89a782` — Unit tests for ADR-0194/0195/0196

Files:

* `forks/agentic-flow/agentic-flow/tests/unit/autopilot-phase3-embedding-clustering.test.ts` (506 lines)
* `forks/agentic-flow/agentic-flow/tests/unit/autopilot-phase4-event-bus.test.ts` (393 lines)
* `forks/agentic-flow/agentic-flow/tests/unit/autopilot-phase5-federated-provider.test.ts` (470 lines)

**No findings.** Test code only; all behaviour is asserted against in-memory mocks. The Phase 4 test does perform `fs.readFileSync(.../services/agentdb-service.ts, 'utf8')` to grep for legacy callers (`autopilot-phase4-event-bus.test.ts:266-296`) — bounded, fixed path inside the package, no traversal risk.

## Working-tree artifact 1 — `src/services/federated-sync-provider.ts` (NEW, 175 lines)

Interface definition + `NoopFederatedSyncProvider` default. Pure types and a no-op implementation that returns `'local'` as install-id and `false` for availability.

**No findings.** No I/O, no network, no logging, no credentials. The Noop's `getLocalInstallId()` returns the constant string `'local'` (`federated-sync-provider.ts:131`), which is intentional per the doc-comment and the test expectation (`autopilot-learning-phase5-federation.test.ts:142`).

## Working-tree artifact 2 — `src/services/sync-coordinator-federated-adapter.ts` (NEW, 211 lines)

Thin adapter implementing `FederatedSyncProvider` over agentdb's `SyncCoordinator`. Includes the `getOrCreateInstallId(projectRoot)` filesystem helper.

### Finding 2.1 — `getOrCreateInstallId` reads file with no size cap (severity: **low**)

**File:line**: `forks/agentic-flow/agentic-flow/src/services/sync-coordinator-federated-adapter.ts:95-108`

```ts
function getOrCreateInstallId(projectRoot: string): string {
  const dir = path.join(projectRoot, CLAUDE_FLOW_DIR);
  const file = path.join(dir, INSTALL_ID_FILENAME);
  if (existsSync(file)) {
    const raw = readFileSync(file, 'utf-8').trim();
    if (raw.length > 0) return raw;
  }
  ...
}
```

`readFileSync(file, 'utf-8')` has no max-bytes cap. If `.claude-flow/install-id` is replaced with a multi-GB file (by the user or a stale tool), the entire content is loaded into memory and then `.trim()`'d. Mode 0600 on the file scopes the attack surface to the same user that runs the process; for the single-host environment in `user_machine.md` this is **not** a remote-attacker vector. Worth noting as defense-in-depth.

**Recommendation**: Either (a) cap the read at e.g. 256 bytes (a UUIDv4 is 36 chars), or (b) validate the trimmed string against `/^[0-9a-f-]{32,64}$/i` before returning. Option (b) also defends against Finding 2.2.

### Finding 2.2 — No format validation on returned install-id (severity: **low**)

**File:line**: `forks/agentic-flow/agentic-flow/src/services/sync-coordinator-federated-adapter.ts:99-100`

```ts
const raw = readFileSync(file, 'utf-8').trim();
if (raw.length > 0) return raw;
```

Any non-empty trimmed string is accepted as the install-id. The id is later used as a `Map<string, number>` key in `incrementVectorClock` (agentdb's `forks/agentdb/src/types/quic.ts:552`), and — more interestingly — gets serialised into episode metadata via `Object.fromEntries(vectorClock.clocks)` (`autopilot-learning.ts:~896`, see Finding 3.2).

The Map keying is safe (Map keys do not pollute `Object.prototype`). The `Object.fromEntries` round-trip on the persistence side is also safe under modern Node — `Object.fromEntries([['__proto__', 1]])` produces an own data property, not a prototype pollution. **Not exploitable today** in autopilot-learning, but the lack of validation is a code smell that compounds with Finding 2.1.

**Recommendation**: Add a UUID-shape regex check and re-mint if the on-disk file is malformed (with a logged warning so the corruption is observable per `feedback-no-fallbacks`).

### Finding 2.3 — Constructor mints install-id eagerly at every construction (severity: **info**)

**File:line**: `forks/agentic-flow/agentic-flow/src/services/sync-coordinator-federated-adapter.ts:122`

```ts
this._installId = getOrCreateInstallId(config.projectRoot ?? process.cwd());
```

Each `new SyncCoordinatorFederatedAdapter(...)` triggers `existsSync` + potentially `mkdirSync` + `writeFileSync` synchronously. If a caller instantiates the adapter from a path where `.claude-flow/` does not exist, the directory is created with mode 0o700 silently. Combined with `process.cwd()` as the default, a test or hook running from an unexpected CWD will create a stray `.claude-flow/install-id` there.

This is **information-only** because:

1. Adapter is currently only constructed when wired explicitly (no caller in tree).
2. Permissions (0o700/0o600) are correct.
3. Documented in the source comment at line 17-21.

**Recommendation**: Defer install-id materialisation to first `getLocalInstallId()` call rather than constructor; or require `projectRoot` to be explicit (no default to `cwd()`). This is a hardening preference, not a vulnerability.

### Finding 2.4 — Adapter's `push()` and `pull()` both delegate to the same bidirectional `sync()` (severity: **info**)

**File:line**: `forks/agentic-flow/agentic-flow/src/services/sync-coordinator-federated-adapter.ts:158-184`

`SyncCoordinator.sync()` is bidirectional (per agentdb's surface). Calling `adapter.push()` actually pushes AND pulls; the report just surfaces the `itemsPushed` slice. Calling `adapter.pull()` then re-runs the same bidirectional sync. A caller invoking both in sequence (`await adapter.push(); await adapter.pull();`) does double the network work and risks ordering anomalies on a busy peer.

**Not a security finding**, but is a correctness pitfall worth noting because the interface shape suggests one-directional semantics. The source comments are explicit about this, so callers reading the code will see it.

**Recommendation**: When a real QUIC transport lands, either rename to `sync()` to match SyncCoordinator's shape, or split detection/apply at the SyncCoordinator layer so `push` and `pull` can be called independently without redundant work.

## Working-tree artifact 3 — `src/coordination/autopilot-learning.ts` (MODIFIED)

Adds Phase 3 (embedding-cluster discovery), Phase 4 emit points, and Phase 5 (federation provider + vector clock stamping).

### Finding 3.1 — Episode `originInstallId` is caller-overridable (severity: **low**)

**File:line**: `forks/agentic-flow/agentic-flow/src/coordination/autopilot-learning.ts:~876-878` (in the diff at HEAD: line 477 of `/tmp/auto-final-rev.txt`)

```ts
const originInstallId = ep.originInstallId ?? this._syncProvider.getLocalInstallId();
this._vectorClock = incrementVectorClock(this._vectorClock, originInstallId);
const vectorClock = ep.vectorClock ?? this._vectorClock;
```

`AutopilotEpisode.originInstallId` is declared optional, but `_record` honours a caller-supplied value before falling back to the provider's install-id. All current callers (`recordTaskCompletion` / `recordTaskFailure` in the same file, `swarm-completion.ts:115` indirectly) are first-party and do not set this field, so the path is not exploitable today.

The risk is forward-looking: any future flow where an `AutopilotEpisode` is constructed from external input (e.g. an MCP tool that ingests data) could let the caller forge origin attribution. The same applies to `ep.vectorClock`.

Per ADR-0082 / `feedback-best-effort-must-rethrow-fatals`, origin attribution is an integrity-sensitive field. The defensive posture should be "the local provider is always authoritative for outgoing episodes".

**Recommendation**: Drop the `ep.originInstallId ??` and `ep.vectorClock ??` fallbacks; always use the provider/local clock. If a caller really needs to record an inbound (already-stamped) episode, give that a separate code path (e.g., `_recordRemote(ep)`) with explicit input validation.

### Finding 3.2 — VectorClock serialisation uses `Object.fromEntries` from a `Map<string, number>` (severity: **info**)

**File:line**: `forks/agentic-flow/agentic-flow/src/coordination/autopilot-learning.ts:~895` (`/tmp/auto-final-rev.txt:495`)

```ts
vectorClock: { clocks: Object.fromEntries(vectorClock.clocks) },
```

This is safe today. Modern Node's `Object.fromEntries` creates own data properties for any string key including `__proto__`, so prototype pollution is not triggered here. However, if the deserialisation side (currently unwired — Phase 5 runtime ADR is deferred) ever uses `Object.assign(target, parsed.clocks)` or shallow-copies into another object, then keys like `constructor` or `__proto__` could become a problem. Combined with Finding 2.2 (no install-id validation), an attacker who can write `.claude-flow/install-id` to `__proto__` could affect future round-tripping.

**Not exploitable today.** Documented now so it's not missed when the runtime ADR (transport + apply) lands.

**Recommendation**: When deserialisation is wired, deserialise via `new Map(Object.entries(parsed.clocks))` (which is the pattern the doc-comment promises), never via direct object spread/merge into a plain object.

### Finding 3.3 — Vector clock is incremented before `storeEpisode` await (severity: **low**)

**File:line**: `forks/agentic-flow/agentic-flow/src/coordination/autopilot-learning.ts:~877-879` (`/tmp/auto-final-rev.txt:477-479`)

```ts
this._vectorClock = incrementVectorClock(this._vectorClock, originInstallId);
const vectorClock = ep.vectorClock ?? this._vectorClock;
await this._agentdb.storeEpisode({ ... });
```

The in-memory vector clock is mutated before the persistence await. If `storeEpisode` throws, the in-memory clock is "ahead" of what was actually persisted. The next write will appear as N+2 with no episode at N+1. CRDT merge from a peer that knew about N+1 (impossible without persistence, so this is bounded) is not affected. The effect is that local writes appear non-contiguous in the clock domain.

**Why it matters slightly**: if the runtime ADR ever lands a "resume after crash → reconcile from peer" flow, the missing N+1 will look like a remote-only episode, which could trigger spurious conflict resolution.

**Recommendation**: Increment the clock AFTER `storeEpisode` succeeds, or capture the new clock in a local before await and only commit `this._vectorClock = nextClock` on success. The existing structure with `const originInstallId = ...` already supports this with a one-line move.

### Finding 3.4 — Phase 3 greedy clustering is O(N²) with no Phase-3-side cap (severity: **info**)

**File:line**: `forks/agentic-flow/agentic-flow/src/coordination/autopilot-learning.ts:~568-590` (`/tmp/auto-final-rev.txt:369-389`)

```ts
for (let i = 0; i < sorted.length; i++) {
  ...
  for (let j = i + 1; j < sorted.length; j++) {
    if (assigned.has(j)) continue;
    if (seed.memberIndices.length >= maxSize) break;
    const sim = AutopilotLearning._cosine(seed.centroid, embeddings[j]);
    ...
  }
}
```

Worst-case is O(N²) on the number of episodes. Input is bounded by `MAX_LIST = 1000` (existing `autopilot-learning.ts:75`), so the absolute ceiling is ~500k cosine comparisons on 384-dim vectors (`Xenova/all-mpnet-base-v2`) — that's roughly 200M FP multiplications, ~1-2s of wall time. The `maxSize: 100` knob caps inner-loop runtime per cluster but does not reduce the outer scan.

Per the task brief: "Recommend a `maxEpisodesPerClustering` config bound if not present."

**Recommendation**: Add `maxEpisodesPerClustering` to `AutopilotLearningConfig` (default 500, capped at MAX_LIST), and slice `successful` before calling `discoverPatternsByEmbedding`. This is defense-in-depth — the existing 1000 cap is already a guard, but a tighter Phase-3-specific knob makes the cost surface explicit per ADR-0194 §Risks.

### Finding 3.5 — Embedding count mismatch throws (severity: **info**, positive note)

**File:line**: `forks/agentic-flow/agentic-flow/src/coordination/autopilot-learning.ts:~551-555` (`/tmp/auto-final-rev.txt:351-355`)

```ts
if (rawEmbeddings.length !== sorted.length) {
  throw new Error(
    `[AutopilotLearning] discoverPatternsByEmbedding: embedding ` +
    `count mismatch — expected ${sorted.length}, got ${rawEmbeddings.length}`,
  );
}
```

**Positive finding** — the implementation correctly throws on the "embedder returned the wrong number of vectors" failure mode rather than silently producing degenerate clusters. Aligns with `feedback-no-fallbacks`.

## Working-tree artifact 4 — `src/services/agentdb-service.ts` (MODIFIED)

Adds the Phase 4 event bus, the `_attachLearningSubscriber()` wire-up, and the `_handleAutopilotEpisode` translator. Method bodies exist on disk; the staged diff at the close of the review window showed the field declarations + the `_attachLearningSubscriber()` call but not the full method bodies (the bodies are in the working file and would land with the implementation commit).

### Finding 4.1 — `getLearningSystem(): any` return type weakens type safety (severity: **info**)

**File:line**: `forks/agentic-flow/agentic-flow/src/services/agentdb-service.ts:1300`

```ts
getLearningSystem(): any {
  return this.learningSystem;
}
```

`any` defeats TypeScript's safety net. Callers can invoke arbitrary methods on the returned controller with no compile-time check, and a refactor of LearningSystem's surface would not surface here as a build error.

**Recommendation**: Type as `LearningSystem | null` (the actual field type) — the doc comment already promises that contract. The `any` is presumably to avoid a circular import with agentdb; if so, declare a `LearningSystemLike` interface in this file (mirror the `AgentDBLike` pattern in `autopilot-learning.ts`).

### Finding 4.2 — Phase 4 subscriber logs `taskId` in error messages (severity: **info**)

**File:line**: `forks/agentic-flow/agentic-flow/src/services/agentdb-service.ts:1352-1354, 1383-1386`

```ts
this.learningEvents.emit('error', new Error(
  `episode:recorded handler failed (taskId=${payload.taskId}): ${msg}`,
));
...
console.error(
  '[AgentDBService] Phase 4 subscriber: learningSystem unavailable ' +
  `(taskId=${payload.taskId}); cannot submitFeedback. ` + ...
);
```

`taskId` is autopilot-internal (e.g. `Date.now()`-derived) and not sensitive. **No leakage of credentials**. Noted only because the broader pattern of "include caller-supplied context in error messages" deserves a sanity check whenever a new input lands.

### Finding 4.3 — SHA-1 used for synthesized sessionId (severity: **info**, intentional choice)

**File:line**: `forks/agentic-flow/agentic-flow/src/services/agentdb-service.ts:1390`

```ts
const sid = `autopilot:${nodeCrypto.createHash('sha1').update(payload.subject).digest('hex')}`;
```

SHA-1 is cryptographically broken for collision resistance, but here it is being used as a **deterministic deduplication hash** for synthetic session IDs, not for authentication or integrity. ADR-0195 §Risks explicitly chose SHA-1 over a substring scheme to reduce accidental collisions, and 40 hex chars give 160 bits of dedup space which is well sufficient for autopilot's subject cardinality.

**No finding.** Documented because security scanners that flag any SHA-1 usage will trip on this; the comment in the source already justifies it.

### Finding 4.4 — `submitFeedback` uses parameterised SQL — no injection (severity: **info**, positive note)

**File:line**: `forks/agentic-flow/agentic-flow/src/services/agentdb-service.ts:1424-1432` (and target `forks/agentdb/src/controllers/LearningSystem.ts:332-344`)

Phase 4's `_handleAutopilotEpisode` passes `payload.subject` (the episode subject) and `payload.status` as `state` and `action` to `LearningSystem.submitFeedback`. The downstream `INSERT INTO learning_experiences` uses `db.prepare(... VALUES (?, ?, ?, ?, ?, ?, ?)).run(...)` — fully parameterised. **No SQL injection vector** in this path even when episode subjects contain SQL metacharacters.

### Finding 4.5 — `'error'` listener default attached at subscriber init (severity: **info**, positive note)

**File:line**: `forks/agentic-flow/agentic-flow/src/services/agentdb-service.ts:1332-1335`

The implementation attaches a default `'error'` listener on `learningEvents` before any other listener. This prevents Node's default behaviour (rethrow + exit) when a sync subscriber throws — and per `feedback-no-fallbacks`, the error is logged to stderr (observable) rather than swallowed. Compliant with the project's no-fallback contract.

### Finding 4.6 — Schema-not-yet-provisioned skip is bounded and visible (severity: **info**, positive note)

**File:line**: `forks/agentic-flow/agentic-flow/src/services/agentdb-service.ts:1408-1414, 1435-1441`

The Phase 4 subscriber catches `SQLITE_ERROR: no such table` and `Session not found` (`/no such table/i.test(msg)` and `/Session not found/i.test(msg)`) for the LearningSystem init race window. Per `feedback-best-effort-must-rethrow-fatals.md`, narrow catches like this are correct — they discriminate the specific class of recoverable error and re-throw everything else (line 1442-1443: `throw err`). Compliant.

## Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 4 (2.1, 2.2, 3.1, 3.3) |
| Info | 8 (2.3, 2.4, 3.2, 3.4, 3.5, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6 — 4 of which are positive notes) |

**No critical, high, or medium findings.** The four low findings are all defense-in-depth recommendations on a single-host, first-party-callers codebase; none is exploitable today.

## Top three recommendations

1. **Finding 3.1** — drop `ep.originInstallId ??` and `ep.vectorClock ??` fallbacks in `_record`; always source from `_syncProvider.getLocalInstallId()` + `this._vectorClock`. The interface allows external override of origin attribution and that's not a property the federation layer should grant to producers.

2. **Finding 3.3** — move `this._vectorClock = incrementVectorClock(...)` to **after** the `storeEpisode` await succeeds, so a failed write doesn't leave the in-memory clock ahead of persisted state.

3. **Finding 2.1 + 2.2** — cap the install-id file read at e.g. 256 bytes and validate the contents against a UUID-shape regex. Re-mint on malformed content (with a logged warning). Closes the only filesystem-loaded input that flows into vector clock keys.

## What was not reviewed

* The deserialisation/apply side of vector clocks across installs (Phase 5 runtime is deferred to a separate ADR per ADR-0196 §Out of scope). The serialisation side is reviewed; the round-trip side has notes (Finding 3.2) for whoever lands the runtime ADR.
* The actual content of `_attachLearningSubscriber` body in the *staged* diff — at review close, the staged diff showed only the field + call site; the full method body is in the on-disk file and was audited from there.
* The relationship between the implementer's `push/pull/notifyEpisode` interface and ADR-0196 §Interface shape's `requestSync/onRemoteEpisode`. The integration test `autopilot-learning-phase5-federation.test.ts:24-30` already notes this is a contract deviation but a coherent one — not a security concern.
