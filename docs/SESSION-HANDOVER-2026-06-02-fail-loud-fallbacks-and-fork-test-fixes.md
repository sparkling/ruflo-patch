# Handover — no-silent-fallback fail-loud work + agentdb fork test-suite repair (in progress)

**Date:** 2026-06-02
**State:** mid-task. Several commits landed locally; **release is HELD** (nothing new pushed/published) until the fork test suite is green and two architectural decisions are made.

---

## TL;DR

1. Fixed the **better-sqlite3 → sql.js silent fallback** to fail loud (the ADR-0285 P3/P4/P6 root). Committed, **not pushed**.
2. Recorded **ADR-0286** to defer the *second* silent fallback (RVF/vector-backend factory) and made its **logging loud** now. Committed, **not pushed**.
3. Started repairing the **~44 pre-existing failures** in the agentdb fork's own `vitest` suite (NOT in the release gate). 3 parallel agents ran: **2 delivered solid fixes** (in worktrees, not yet integrated), 1 hit a genuine architectural ambiguity.
4. **Two decisions needed** before this is "all green" (see *Pending decisions*).

> ⚠️ **RELEASE IS HELD.** The user said "kill the release, we will fix this first." Do NOT `npm run release` / `ruflo-publish.sh` or `git push` the agentdb fork until the suite is green + decisions made. (No release process was actually found running — the hold is a directive.)

---

## Commits this session (with push status)

### ruflo-patch (remote `origin` = sparkling/ruflo-patch)
| SHA | What | Pushed? |
|---|---|---|
| `6bc0e39` | adr-create 4-surface storage op-matrix harness + acceptance/fast/CI wiring | ✅ pushed |
| `f719b0b` | ADR-0286 (RVF vector-backend fail-loud, deferred; interim loud logging) | ❌ **unpushed** (ahead of origin by 1) |

### agentdb fork (remote `sparkling` = sparkling/agentdb; NEVER `origin`=ruvnet)
| SHA | What | Pushed? |
|---|---|---|
| `07ffc77` | sql.js SAVEPOINT lifecycle regression test (ADR-0285 P3) | ✅ pushed |
| `bf90267` | **fail loud on native better-sqlite3 load failure** (no silent sql.js fallback) — `resolveBetterSqlite3LoadFailure` in `src/core/AgentDB.ts` + `tests/regression/agentdb-no-silent-sqljs-fallback.test.ts` (5 tests) | ❌ **unpushed** |
| `602ee04` | **loud-log every vector-backend fallback** (`warnVectorBackendFallback` in `src/backends/factory.ts`, ADR-0286 interim) | ❌ **unpushed** |

agentdb `main` is **ahead of sparkling/main by 2** (`bf90267`, `602ee04`). Both trees clean (ignore `agentdb.rvf.lock` + `.claude-flow/data/archivist-audit.jsonl` runtime artifacts).

---

## Agent worktrees — fixes NOT yet integrated to agentdb `main`

Three git worktrees of the fork (base = `602ee04`). node_modules is symlinked into each (`ln -s …/forks/agentdb/node_modules`). To run tests in one: `cd /tmp/agentdb-wt-<name> && npx vitest run <file>`.

| Worktree | Commit | Status |
|---|---|---|
| `/tmp/agentdb-wt-persistence` | `e012a51` | ✅ **verified green (35 passed)** — cherry-pick to main |
| `/tmp/agentdb-wt-vectors` | `0883b25` | ⚠️ api-compat green; **1 adr0166 test still red** — cherry-pick, then resolve the 1 |
| `/tmp/agentdb-wt-attention` | (none) | ❌ no changes — architectural ambiguity (see decisions) |

**These worktrees + their commits are the only place the persistence/vectors fixes live.** Cherry-pick before removing the worktrees.

### What the agent fixes actually are (reviewed — no squelching)
- `e012a51` (persistence + core-features): `ORDER BY ts DESC, id DESC` tiebreaker (src/controllers/ReflexionMemory.ts); `dimensions:`→`dimension:` mistyped EmbeddingService key; `await addCausalEdge` (it's async); DB-corruption test clobbers header magic (offset 0) + forces a read (old offset-1000 write hit slack SQLite never validates); schema-integrity test instantiates `ReasoningBank` so its lazy tables exist.
- `0883b25` (api-compat + adr0166): api-compat derives dim from `getStats().dimension` (the `dimensions:384` ctor key was ineffective; real dim = mpnet-768); adr0166 renamed obsolete `createGuardedBackend` spy → `createBackend` (2 tests). **Still red:** adr0166 "vectorBackendName resolves to non-'none' for ruvector".

---

## The ~44 fork failures — per-file status

| File | Count | Status |
|---|---|---|
| `tests/regression/persistence.test.ts` | ~3 | ✅ fixed (`e012a51`, worktree) |
| `tests/regression/core-features.test.ts` | ~1 | ✅ fixed (`e012a51`, worktree) |
| `tests/regression/api-compat.test.ts` | ~1 | ✅ fixed (`0883b25`, worktree) |
| `tests/adr0166-vectorbackend-wired.test.ts` | ~3 | ⚠️ 2 fixed (`0883b25`); **1 red** (ruvector resolution) |
| `tests/regression/build-validation.test.ts` | ~10 | 📋 diagnosed, NOT applied (mine) |
| `tests/regression/v1.6.0-features.test.ts` | ~9 | 📋 diagnosed, NOT applied (mine) |
| `tests/regression/attention-regression.test.ts` | ~9 | ❌ blocked — architectural decision |

> These are **pre-existing** (stash-proven: my fail-loud change added 0 failures — 48 without it → 44 with) and sit **outside the release gate** (the gate is ruflo-patch acceptance + `test:charter`, not the fork's internal vitest). The fork ships at patch.414 *with* them.

---

## Pending DECISIONS (need user input)

1. **attention-regression** (~9): the test assumes an API that diverged. `db.listControllers()` does not exist; `getController('memory')` returns `this.reflexion` (ReflexionMemory — no `.store()`), while `src/controllers/MemoryController.ts` exists but is **not wired into the registry**. Two paths:
   - **(A) source rewire** — add `AgentDB.listControllers()`; map `getController('memory')`→MemoryController (confirm MemoryController has `store/retrieve/search` + is the intended 'memory' controller). Changes public API.
   - **(B) test rewrite** — point the test at the *current* API (ReflexionMemory via `getController('memory')`; drop/replace `listControllers()`).
   - First check: is `MemoryController` instantiated/used anywhere? `git log -S listControllers` — was it removed deliberately?
2. **adr0166 ruvector** (1): `vectorBackendName` resolves past `ruvector` even though `@ruvector/core` is installed → it silently falls back (rvf/hnswlib/sqljs-rvf). This is **the very silent-vector-fallback ADR-0286 is about** — "fixing it properly" overlaps ADR-0286's deferred work. Decide: accept the fallback name in the test, or treat the silent ruvector→fallback as the real defect (and fold into ADR-0286).

---

## RESUME steps (when unblocked)

```bash
cd /Users/henrik/source/forks/agentdb          # on main, HEAD 602ee04

# 1. Integrate the two good agent commits
git cherry-pick e012a51 0883b25                # (commits live in the worktrees' shared .git)

# 2. Apply MY stale-path fixes (NO new diagnosis needed):
#    build-validation.test.ts  → dist/X  →  dist/src/X  (index.js, index.d.ts, cli/agentdb-cli.js,
#        controllers/*.js+*.d.ts, db-fallback.js); main 'dist/index.js'→'dist/src/index.js';
#        types →'dist/src/index.d.ts'; bin →'dist/src/cli/agentdb-cli.js';
#        version '1.6.1' → assert non-empty/semver-ish (do NOT freeze a literal — pipeline bumps it);
#        files: expect 'dist/src/','dist/schemas/','dist/models/' (not bare 'dist'/'src').
#        name 'agentdb' + exports keys already match — keep. VERIFY @xenova/transformers etc. still in deps.
#        ⚠️ "should have built browser bundle" (dist/agentdb.min.js) may be a REAL gap — check vs fresh dist.
#    v1.6.0-features.test.ts    → cliPath 'dist/cli/agentdb-cli.js' → 'dist/src/cli/agentdb-cli.js' (lines ~18, ~372)

# 3. ONE build (dist was rm'd this session — it needs restoring anyway; build-validation/v1.6.0 need it):
npm run build                                  # the ONLY full build — see feedback-no-repeated-full-builds

# 4. Targeted verify (NEVER bare `npx vitest run` / `npm test` — CPU):
npx vitest run tests/regression/build-validation.test.ts tests/regression/v1.6.0-features.test.ts \
  tests/regression/persistence.test.ts tests/regression/core-features.test.ts \
  tests/regression/api-compat.test.ts tests/adr0166-vectorbackend-wired.test.ts

# 5. Resolve attention + adr0166-ruvector per the user's decision.

# 6. Cleanup worktrees:
for w in attention persistence vectors; do git worktree remove --force /tmp/agentdb-wt-$w; done

# 7. When the user lifts the release hold — push, then release:
#    agentdb:    git push sparkling main           (bf90267, 602ee04, + the cherry-picks/fixes)
#    ruflo-patch: git push origin main             (f719b0b ADR-0286)
#    release:    npm run release  (or scripts/ruflo-publish.sh)  — per reference-pipeline-publish-paths
```

---

## Key findings / corrections this session

- **The live MCP daemon is NOT stale / NOT sql.js.** Earlier in the session I wrongly claimed it ran stale patch.225 sql.js. Verified via `lsof`: it launches from the **npx cache** (`~/.npm/_npx/906e6debb112be6d`, agentdb **patch.414**) with **native better-sqlite3** mapped. The `/mcp` restart worked. The pre-restart P3 error came from an older daemon instance. (Memory `project-adr0285-p3p4-causal-crud` corrected.)
- **CPU rule** (memory `feedback-no-repeated-full-builds`): never drive a fork loop with repeated `npm run build` + bare `npx vitest run` — it pegs all cores. vitest reads TS source directly: use targeted `npx vitest run <file>`; one full build, at the end.
- **sql.js engine FAILS LOUD now** (`bf90267`): a native better-sqlite3 load failure throws an actionable error; WASM only via explicit `AGENTDB_ALLOW_SQLJS_FALLBACK=1` or `forceWasm:true`. The decision helper `resolveBetterSqlite3LoadFailure(error, env)` is exported + unit-tested.
- **Vector-backend fallbacks are LOUD now** (`602ee04`): every non-preferred/init-failure path warns `⚠ VECTOR-BACKEND FALLBACK … (ADR-0286)`. Full fail-loud-with-opt-in deferred to ADR-0286.
- **No-squelch held**: every applied/harvested fix is a real root-cause correction or a stale-expectation correction with a cited reason — no weakened/skipped assertions.

## adr-create storage matrix (earlier in session — DONE + pushed)
`scripts/smoke-adr-create-storage-matrix.mjs` (4 surfaces × all ops + 2× `--purge` reconciliation) is green 30/30 on better-sqlite3 AND sql.js wrapper P3/P4/P6 are unit-covered. Wired into acceptance + fast + CI (`6bc0e39`, pushed). ADR-0286 is registered in AgentDB (hierarchical `adr/ADR-0286` + adr-patterns) — corpus is now 292 ADRs.
