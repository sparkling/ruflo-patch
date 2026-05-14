# Batch A — Daemon — agent analysis (2026-05-09)

Source: ADR-0162 Batch A. Produced by general-purpose research agent against `forks/ruflo` `main` (562 ahead, 220 behind upstream). READ-ONLY analysis — no code applied.

Working tree state: fork 562 ahead / 220 behind upstream. Merge base `43c8fd794` (Apr 8). All 9 daemon-touching commits are unmerged.

## Per-commit assessment

### 1. `69e72d2e4` — fix(daemon): break IPC pipe (#1766)

**Files (4 / 25 lines):** root + ruflo + cli `package.json`; `v3/@claude-flow/cli/src/commands/daemon.ts` (+15 / -4).

**Daemon-relevance:** ENTIRELY daemon-focused. Touches the `forkOpts` block: `detached: !isWin → true` and adds `child.disconnect()` after `child.unref()`.

**Conflict risk: MAJOR.** Our fork's `daemon.ts` was reverted from `fork()` back to `spawn(process.execPath, ...)` — confirmed by `grep "fork(" daemon.ts` → no match; line 264 shows `detached: !isWin`. The hunk context (`fork(cliPath, forkArgs, forkOpts)`) does not exist on `main`. Patch will not apply cleanly. Package.json bumps (3.7.0-alpha.3) collide with our 2.7.47-patch.527 line.

**Strategy:** Skip mechanical pick. Either (i) hand-port the two-line semantic fix onto our `spawn`-based codepath: switch `detached: !isWin` → `detached: true` and add a try/catch `child.disconnect()` if any IPC channel exists (currently none — our stdio is `['ignore','ignore','ignore']` with no `'ipc'`, so `disconnect()` is a no-op — fix is effectively `detached: true`); or (ii) cherry-pick #1691 (a10a13e62) first to restore the `fork()` path, then this applies cleanly.

**Notes:** ADR-0088 (`c3ad3ebc9`) deliberately kept `spawn` and removed `fork`. Re-introducing `fork(...,'ipc')` undoes part of that ADR. Decide policy before proceeding.

### 2. `fd4c3cb3c` — ci(windows): regression test for #1766

**Files (2 / 117 lines):** `.github/workflows/ci.yml` (+78), `verification.md` (+39).

**Daemon-relevance:** Entirely a Windows CI test for #1766.

**Conflict risk:** `verification.md` last touched on fork by `f5bd5c679` (chore version bump) — likely MINOR-MAJOR depending on overlap. `ci.yml` is fork-modified (Hetzner removal, sparkling pipeline). Verification.md is in our trees as a witness manifest — unsafe to modify.

**Strategy: SKIP.** Windows CI doesn't run on our infrastructure. Regression test value is upstream-only.

### 3. `003ce127b` — chore(repo): archive v2/ → archive/v2/

**Files:** ~6,440 renames + .npmignore + new archive/README.md / 41 net lines.

**Daemon-relevance:** ZERO. Pure directory move.

**Conflict risk:** CLEAN-ish for non-daemon but NOT applicable: `ls v2/` confirms our fork has no `v2/` directory at all. The 6,440 git-mv operations have no targets.

**Strategy: SKIP.** Cherry-pick would fail with "v2/X does not exist" on every rename.

### 4. `1884ed101` — fix alpha.12 (#1839-#1847)

**Files (16 / +416 -116):** package.json x3, bin/cli.js, bin/mcp-server.js, config-adapter.ts, doctor.ts, memory.ts, executor.ts, mcp-generator.ts, hooks-tools.ts, memory-tools.ts, system-tools.ts, worker-daemon.ts (+125 lines), index.ts, plus a test fixture.

**Daemon-relevance:** BUNDLED. Daemon-touching parts: #1844 (YAML config in `worker-daemon.ts`), #1845 (dispatch queue in `worker-daemon.ts` + `hooks-tools.ts`). Other 7 sub-issues are MCP renaming (claude-flow → ruflo), executor/generator branding, doctor health.

**Conflict risk: MAJOR across the board.** Every file is heavily fork-modified:
- `worker-daemon.ts`: 928 diff lines vs upstream
- `hooks-tools.ts`: 2,327 diff lines (we have ADR-0086 T2.7 router rewrites)
- `memory-tools.ts`: 1,159 lines (router-based, not memory-initializer)
- `mcp-generator.ts`: ours emits `ruflo` already (ADR-0155 supersedes #1841)
- `executor.ts`: 802 line diff
- `system-tools.ts`: 294-line diff
- `index.ts`: 444 lines diff

**Strategy:** Cherry-pick infeasible as a unit. Decompose: extract just the #1844 + #1845 daemon hunks (queuePollTimer + processDispatchQueue + YAML reader) and hand-apply. Skip #1839/#1841/#1842 — already covered by fork ADRs. Skip the index.ts TS fix unless our build is broken.

### 5. `c67fa393d` — fix alpha.13: persist headless results + ab-test guard

**Files (6 / +79 -4):** 3 package.json, `worker-daemon.ts` (+63), `analyzer.ts` (+12).

**Daemon-relevance:** Mostly daemon (#1793 = persist headless results). #1652 ab-test guard is guidance-package.

**Conflict risk:** `worker-daemon.ts` MAJOR; `analyzer.ts` last fork touch `c2c21f6ae` likely also conflicts.

**Strategy:** Hand-port #1793. The persist block at `executeWorker()` needs to write to `.claude-flow/metrics/<name>.json`. Apply: `git cherry-pick -x --strategy-option=patience c67fa393d -- v3/@claude-flow/cli/src/services/worker-daemon.ts` then resolve manually; skip the analyzer.ts hunk if it conflicts.

### 6. `d88c69dde` — fix alpha.15: #1852 + #1853 + #1854

**Files (6 / +104 -16):** 3 pkg, `headless-worker-executor.ts` (+25), `worker-daemon.ts` (+12), `memory-initializer.ts` (+77).

**Daemon-relevance:** #1852 (shell injection in headless executor) and #1853 (self-PID skip in `checkExistingDaemon`) ARE daemon. #1854 (`memory-initializer.ts` getMemoryRoot helper) IS NOT — that file was DELETED in our fork (`f2f86193a`, ADR-0086 Debt 6).

**Conflict risk:**
- `memory-initializer.ts` hunk → CANNOT APPLY: file does not exist on `main`. Cherry-pick fails with "deleted by us".
- `headless-worker-executor.ts` (107-line diff) — minor structural divergence; check current line 1171 (`spawn('claude', ['--bare', '--print', prompt], ...)`) — our fork uses `--bare --print`. Stdin-pipe fix needs re-derivation.
- `worker-daemon.ts` self-PID skip — line 541 already has `checkExistingDaemon` but no self-skip.

**Strategy:** Skip mechanical pick. Hand-apply #1852 (stdin-pipe pattern) and #1853 (self-PID skip in `checkExistingDaemon`); discard #1854 entirely (`memory-initializer` is dead in our tree, router handles paths).

**Notes:** #1854 is the highest-risk drop — our router-based memory has its own path resolution. Verify `CLAUDE_FLOW_MEMORY_PATH` env var works through `memory-router.ts` separately.

### 7. `f46e52f41` — fix alpha.16: daemon crash recovery (#1855)

**Files (5 / +145 -4):** 3 pkg, `headless-worker-executor.ts` (+14, `getActiveChildPids()`), `worker-daemon.ts` (+129).

**Daemon-relevance:** ENTIRELY daemon-focused. Adds `installCrashHandlers`, `writeCrashRecord`, `writeChildrenSnapshot`, `reapOrphanedChildren` to worker-daemon.

**Conflict risk: MAJOR** — depends on alpha.12 + alpha.13 + alpha.15 worker-daemon state. As pure additive (new methods + 3 small `writeChildrenSnapshot()` insertions in `execution:start/complete/error` listeners), upstream changes are tractable but the diff base is wrong.

**Strategy:** Hand-port the 4 new methods + 3 listener insertions. `git cherry-pick -x --strategy-option=patience f46e52f41` and resolve. Probably tractable since new methods are largely standalone.

**Notes:** Most additive of the bunch. Best candidate to land first if doing manual ports.

### 8. `66f7f644d` — fix alpha.17: #1565 + #1856 + #1857

**Files (5 / +327 -5):** 3 pkg, `daemon.ts` (+275, supervisor + Windows tasklist), `worker-daemon.ts` (+50, mid-flight detector).

**Daemon-relevance:** ENTIRELY daemon-focused.

**Conflict risk: MAJOR** (same dependency chain as #7). `daemon.ts` already has 495 diff-lines vs upstream from ADR-0088 + #1766 reverts. Supervisor block (`install-supervisor`/`uninstall-supervisor` subcommands) is purely additive → should apply onto our fork shape after path-context conflicts. `killStaleDaemonsWindows` split is also additive. #1856 mid-flight detector depends on #1855 `WorkerState.lastStartedAt` field.

**Strategy:** Apply AFTER #7. `git cherry-pick -x --strategy-option=patience 66f7f644d`, resolve daemon.ts top imports + version bump, accept additive method blocks.

**Notes:** Supervisor (#1565) is the most user-visible feature: launchd/systemd installers. High value retention.

### 9. `a10a13e62` — fix(cli,ui): May 1-3 issues (3.6.13)

**Files (9 / +198 -84):** 3 pkg, `daemon.ts` (+44, #1691 fork() switch), `embeddings.ts` (+16), `hooks.ts` (+170), `performance.ts` (+5), `goal_ui/Index.tsx` (+23), `mcp/tools/hooks-tools.ts` (+12).

**Daemon-relevance:** BUNDLED but separable. Daemon part is #1691 — the spawn → fork switch. Other 4 issues unrelated.

**Conflict risk:**
- `daemon.ts` #1691 hunk: targets `spawn(process.execPath, ...)` block which still exists on our `main`. Should apply mechanically with `--strategy-option=patience` IF we accept reverting ADR-0088 `fork`-removal. Our line 293 still says `spawn(process.execPath, spawnArgs, spawnOpts)` — exactly what #1691 wants to replace.
- `embeddings.ts`, `hooks.ts`, `performance.ts`: heavy fork divergence (memory-router refactor). MAJOR.
- `goal_ui/Index.tsx`: last fork touch `e58154a42` (rebrand). Probably MINOR.
- `v3/mcp/tools/hooks-tools.ts`: small file. Check separately.

**Strategy:** Cherry-pick `daemon.ts` portion ONLY (file-scoped: `git show a10a13e62 -- v3/@claude-flow/cli/src/commands/daemon.ts | git apply --3way -`). Skip everything else. Note: this contradicts ADR-0088 which deleted the IPC code path. Re-applying #1691 brings IPC back.

**Notes: Date-paradox.** This commit (May 3) PREDATES #1766 (May 5) chronologically but appears LAST in inventory ordering. Sequence: `a10a13e62` (May 3, 3.6.13, #1691 introduces fork+ipc) → `69e72d2e4` (May 5, fixes the bug fork+ipc introduced). Logical pick order: `a10a13e62` BEFORE `69e72d2e4`.

## Recommended cherry-pick order

Assuming the ADR-0088 policy decision permits restoring `fork()`/IPC (otherwise hand-port `detached: true` only):

1. `a10a13e62` (#1691 daemon hunk only) — restores `fork()` path that #1766 builds on
2. `69e72d2e4` (#1766) — now applies cleanly atop step 1
3. `c67fa393d` (alpha.13 #1793 worker-daemon.ts hunk only)
4. `1884ed101` (extract #1844 YAML + #1845 dispatch queue daemon hunks ONLY; drop #1839/#1841/#1842)
5. `d88c69dde` (alpha.15 #1852 + #1853 hand-applied; SKIP #1854 memory-initializer)
6. `f46e52f41` (alpha.16 crash recovery — most additive)
7. `66f7f644d` (alpha.17 supervisor + mid-flight + Windows tasklist)
8. `fd4c3cb3c` — SKIP (Windows CI, doesn't apply to fork infra)
9. `003ce127b` — SKIP (no v2/ to archive)

Use `git cherry-pick -x --strategy-option=patience <SHA>` per pick.

## Blockers identified

- **Commit 2 (`fd4c3cb3c`)** — DROP. Windows CI infrastructure unused on this fork.
- **Commit 3 (`003ce127b`)** — DROP. Our fork has no `v2/` directory.
- **Commit 6's #1854 sub-fix** (memory-initializer.ts) — DROP. File is intentionally deleted (ADR-0086 Debt 6). Apply only #1852 + #1853 from `d88c69dde`.
- **Policy decision**: Restoring #1691 / #1766 reintroduces `fork(..., 'ipc')` — partially reverts ADR-0088. If ADR-0088 stands, hand-port `detached: true` only onto our `spawn`-based path and drop the IPC-disconnect logic.
- **Version bumps** in package.json: All 9 commits include 3.7.0-alpha.* bumps → conflict with our 2.7.47-patch.527 line. Skip every package.json hunk.

## Smoke-test command (macOS, post-batch)

```bash
cd /tmp && rm -rf daemon-smoke && mkdir daemon-smoke && cd daemon-smoke && \
node -e "require('child_process').spawn('npx', ['-y', '@sparkleideas/cli@latest', 'daemon', 'start', '--quiet'], { stdio: 'inherit', detached: false }).on('exit', () => {});" & \
PARENT=$!; sleep 3; kill $PARENT 2>/dev/null; sleep 5; \
DAEMON_PID=$(cat .claude-flow/daemon.pid 2>/dev/null); \
if [ -n "$DAEMON_PID" ] && ps -p $DAEMON_PID > /dev/null; then \
  echo "PASS: daemon $DAEMON_PID survived parent exit"; \
  kill $DAEMON_PID; \
else \
  echo "FAIL: daemon died with parent"; \
fi
```
