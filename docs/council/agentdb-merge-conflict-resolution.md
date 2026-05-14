# AgentDB Merge-Conflict Resolution — Council Report

**Date:** 2026-05-14
**Repo:** `forks/agentdb`
**Trigger:** Orphaned `git stash pop` conflict (no merge/rebase in progress) — half-applied
`stash@{0}: On main: b7-followup-pre-pull`.
**Coordination:** Queen (`queen-task`) + 2 file-resolver workers + 1 tsc verifier, agent team.

## Conflict sides

| Marker | Meaning |
|---|---|
| `<<<<<<< Updated upstream` | Current `main` HEAD — the **leaner restored state** (recent log: a series of "Restore ..." commits per ADR-0177/0178 follow-ups). |
| `>>>>>>> Stashed changes` | `stash@{0}: b7-followup-pre-pull` — the fork's pre-pull WIP snapshot. |

**Going-in hypothesis:** the stash is richer fork work that should usually win. **Outcome:** this
held for one file and was *false* for the other. Each region was decided on **verified
symbol existence**, not the heuristic — the two files correctly resolved to **opposite sides**.

## Verdict

**PASS.** Both files fully resolved (zero conflict markers, no unmerged git stages, both staged).
`tsc --noEmit`: the ~21 conflict-marker syntax errors are cleared; the 2 target files contribute
**zero** TypeScript errors; no new regression in any file. Stash left intact (not dropped); no
file outside the 2 conflicted files was touched by the resolvers.

---

## File 1 — `src/core/AgentDB.ts` (4 regions) → all "Updated upstream"

**Decisive finding:** the "Stashed changes" side for this file is a **stale pre-ADR-0177-Phase-1.6
snapshot**, not richer WIP. Its imports and local symbols provably do not exist in the current
codebase, so taking it would resurrect deleted architecture and fail to compile.

Evidence (verified by the resolver, re-checked by the Queen):
- `createGuardedBackend` — not exported by `src/backends/factory.js` (only `createBackend` exists).
- `getEmbeddingConfig` from `../config/embedding-config.js` — `src/config/` directory does not
  exist; symbol found nowhere in `src/`.
- Stashed R3/R4 logic references `embConfig`, `dim`, `_adr0166DeprecationWarned`,
  `_sqliteVecLoaded`, `tryLoadSqliteVec`, `createOptionFVirtualTables` — none defined in current
  HEAD or anywhere in `src/`.

Current `main` HEAD deliberately deleted the whole Option-F / ADR-0166–0170 deprecation machinery
from this file and rewrote `initialize()` lean.

| Region | Lines | "Updated upstream" | "Stashed changes" | Resolution |
|---|---|---|---|---|
| R1 imports | 13–25 | just `createBackend` | adds 8 controller imports + `createGuardedBackend` | **Upstream.** Not a union — the Stashed additions are unused/broken (their consuming code is the stale R3/R4 that was dropped). |
| R2 fields | 54–75 | `public vectorBackend` | `private vectorBackend` + 14 extra fields | **Upstream.** `public` is **forced** by real external use: `src/wrappers/agentdb-fast.ts:97-98` does `this.db.vectorBackend`. The 14 extra fields back the dropped R3/R4 logic. |
| R3 `loadSchemas` body | 186–365 (~178 ln) | lean schema-loading only | stale `initialize()` body dumped into `loadSchemas()` (embedder re-init, GraphTransformer, ADR-0166/0170 validation, guarded backend, 8 controllers) — references dead symbols throughout | **Upstream.** Incompatible with the current lean `initialize()`. |
| R4 `getController` switch | 382–487 (~104 ln) | upstream switch | adds cases (`causalRecall`/`learningSystem`/`graphTransformer`/`mutationGuard`/`sonaService`…) referencing fields that only exist in dropped R2 | **Upstream.** Verified `src/archivist/` (the integration in this same tree) does not call `getController()` with any of these names. |

**Net effect:** `git diff HEAD src/core/AgentDB.ts` is **empty** — the file is byte-identical to
`main` HEAD; the stash contributed nothing valid here. It **is** staged and fully resolved — the
empty diff is the *correct* outcome, not a missed resolution.

---

## File 2 — `src/controllers/LearningSystem.ts` (3 regions) → all "Stashed changes"

**Decisive finding:** here the Stashed side **is** the correct (fork-richer) side — the
already-resolved, non-conflicted body of the file (`this.backend`, `schemaReady!`, async
`initializeSchema()`) is only consistent with the Stashed side. "Updated upstream" was the
abandoned pre-postgres-port SQLite version.

| Region | Lines | "Updated upstream" | "Stashed changes" | Resolution |
|---|---|---|---|---|
| R1 class fields | 79–86 | `db: Database` + `embedder` (no definite-assignment) | `backend!: PostgresBackend` + `embedder!` | **Stashed.** `this.db` appears nowhere outside the conflict; whole file body uses `this.backend`. |
| R2 ctor + RuVector methods | 93–182 (~84 ln) | bare 3-line ctor (`this.db=db; …; this.initializeSchema()`) | `_singleton`-guarded ctor + `initializeRuVectorEnhancements()` + `getEngineTypes()` | **Stashed.** `schemaReady!` is only assigned in the Stashed ctor; upstream's fire-and-forget `initializeSchema()` (it is `async`) would not populate it. |
| R3 `getStateEmbedding` INSERT | 553–564 | `this.db.prepare(...).run(...)` (SQLite) | `this.backend.query(...)` (`$N` placeholders, PostgreSQL) | **Stashed.** Matches the postgres port used everywhere else in the file. |

### Completing the merge beyond the markers (Queen-reviewed, accepted)

The conflict markers wrapped only the class **body**. The imports section was auto-resolved to
upstream's leaner 2 imports, which **dropped 5 imports + the module-level `let _singleton` decl**
that the kept (Stashed) body depends on. The resolver re-added them so the kept body compiles:

- `RuVectorLearning, LearningConfig as GNNConfig` from `../backends/ruvector/RuVectorLearning.js` — verified exists/exports.
- `SonaTrajectoryService` from `../services/SonaTrajectoryService.js` — verified; dropped the stash's unused `TrajectoryStep as SonaStep` alias.
- `GNNService` from `../services/GNNService.js` — verified exists.
- `getEmbeddingConfig` — **corrected** from the stash's stale `../config/embedding-config.js`
  (missing — consistent with memory `project-adr0178-deferred-restorations`) to the live
  `../core/config-chain.js`, which re-exports it (`config-chain.ts:20`, verified by the Queen).
  Same path `GNNService.ts` / `StreamingEmbeddingService.ts` already use.
- Dropped the stash's `cosineSimilarity` import from `../utils/vector-math.js` — that path is also
  missing, and the file already has its own private `cosineSimilarity` method (~line 1476).
- Re-added `let _singleton: InstanceType<typeof LearningSystem> | null = null;` before the class.

**Verification by the Queen:** `src/core/config-chain.ts`, `RuVectorLearning.ts`,
`SonaTrajectoryService.ts`, `GNNService.ts` all exist; `config-chain.ts:20` exports
`getEmbeddingConfig`; `src/config/embedding-config.ts` and `src/utils/vector-math.ts` confirmed
absent.

### One completing-fix — FLAGGED for user awareness

`getEngineTypes()` (Stashed-side code, ~line 175) called `this.gnnLearning?.isInitialized()`.
`RuVectorLearning` has **no** `isInitialized()` method and never did — it exposes
`getState(): { initialized: boolean }`. The resolver verified `stash@{0}` contains the **identical
broken call** — a latent defect in the stashed work, **not** a merge artifact. Because it blocked
`tsc` for the file, the resolver applied a one-token completing-fix:

```
this.gnnLearning?.isInitialized()   →   this.gnnLearning?.getState().initialized
```

Same intent, the only API that exists. **If you want the stash kept bit-identical, revert just
that one line** (and accept one `tsc` error on this file).

### Test-file alignment — `tests/unit/controllers/LearningSystem.test.ts`

This file is staged (`M ` in index) from the broader stash pop. The resolver checked it against
the resolved source: **fully aligned, no mismatch.** The test uses `LearningSystem._resetSingleton()`,
`new LearningSystem(backend, embedder)`, `new PostgresBackend(...)`, `backend.query(...)` — all
match the Stashed-side signature/fields that were kept. (Upstream's `(db: Database, …)` ctor would
have *mis*matched the test.) The test file was **not** edited.

---

## tsc verification (`merge-tsc-verifier`)

Full log: `/tmp/agentdb-merge-tsc.log`.

| Metric | Before (markers unresolved) | After (resolved) |
|---|---|---|
| Conflict-marker syntax errors (TS1185) | ~21, all from the 7 regions | **0** — cleared |
| Errors in `src/core/AgentDB.ts` | (marker errors) | **0** |
| Errors in `src/controllers/LearningSystem.ts` | (marker errors) | **0** |
| Total `error TS` repo-wide | — | 119 |

The 119 remaining are **all pre-existing noise**, none a regression:
- `tests/benchmarks/helpers/graph-generator.ts` (39), `benchmarks/*` (~32), `examples/*` (~42) — untracked / out-of-scope dirs.
- `src/`: `agentdb-cli.ts` (2), `agentdb-mcp-server.ts` (1), `SyncCoordinator.ts` (1) — all show `M`/`modified` in `git status` from the broader stash pop, out of scope for this 2-file conflict.
- `src/examples/quic-sync-example.ts:122` (`TS2345`) — verified **not** a regression: file is
  `git`-unmodified, does not import AgentDB or LearningSystem, lives under `examples/`. Independent
  of this resolution.

---

## Structural acceptance (Queen, final)

- `git diff --name-only --diff-filter=U` — **empty** (no unmerged files).
- Conflict markers in both target files — **zero**.
- `src/controllers/LearningSystem.ts` — staged (`M`).
- `src/core/AgentDB.ts` — staged, byte-identical to HEAD (absent from `git status`, the correct outcome).
- `git stash list` — `stash@{0}: b7-followup-pre-pull` still present; **not dropped**.
- No file outside the 2 conflicted files was modified by the resolvers. (The other `M`/`A`/`??`
  entries — `package.json`, `src/archivist/*`, `MemoryConsolidation.ts`, `NightlyLearner.ts`,
  `SkillLibrary.ts`, `SyncCoordinator.ts`, `agentdb-mcp-server.ts`, `LearningSystem.test.ts` — are
  all pre-existing from the broader `git stash pop` and untouched by this team.)

## Open items for the user

1. **One-token completing-fix** in `LearningSystem.ts` (`isInitialized()` → `getState().initialized`).
   Accepted by the Queen as the minimum to clear `tsc`; it is a real latent defect in the stash,
   not a merge artifact. Revert that single line if you want `stash@{0}` kept bit-identical.
2. **Import section of `LearningSystem.ts` was edited outside the conflict markers** — necessary to
   make the kept Stashed body compile (5 re-added imports + `_singleton` decl, with two stale stash
   paths corrected to live ones). This is "completing the merge," not scope creep, but it is a
   change the markers did not strictly delimit — noted for visibility.
3. The broader `git stash pop` left many other files modified/added (`src/archivist/*` etc.). Those
   were **out of scope** for this conflict-resolution wave and were not reviewed here.
