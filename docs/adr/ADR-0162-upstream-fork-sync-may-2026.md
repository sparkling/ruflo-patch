---
status: proposed
date: 2026-05-09
methodology: [SPARC, MADR, runbook]
decision-makers: [Henrik Pettersen]
tags: [upstream-sync, forks, daemon, security, ruflo, agentic-flow, ruvector, v2-archive, runbook]
related: [0012, 0027, 0079, 0086, 0088, 0094, 0101, 0143, 0156, 0160, 0161]
audience: ai-executor
state_schema: 1
---

# ADR-0162: Upstream fork sync — May 2026 (288 commits, daemon-priority)

> **AI executor**: this is a runbook. Execute top-to-bottom. Each batch has Pre-conditions → Commands → Verification → Failure-modes → Resumability. Maintain state in `.claude-flow/data/sync-2026-05-09.yaml` per the schema below. If any verification fails, halt and surface — do not improvise. "Why" lives in `## Background` at the end; you do not need it to execute.

## Execution state schema

Maintain at `/Users/henrik/source/ruflo-patch/.claude-flow/data/sync-2026-05-09.yaml`. Update after every commit, not every batch.

```yaml
sync_id: 2026-05-09-upstream
schema_version: 1
decisions_resolved:
  adr_0088_policy: null            # one of: partial-revert | spawn-only
  pre_extraction_routing: null     # one of: retarget | skip
  paired_delete_api: null          # one of: apply | defer
preflight:
  cross_compile_setup: false       # true after zigbuild + xwin + targets installed
  forks_clean: false               # true after `git status` clean on all 4 active forks
batches:
  A: { status: pending, picks_landed: [], rebuild_done: false, smoke_passed: false }
  B: { status: pending, picks_landed: [], rebuild_done: false, smoke_passed: false }
  C+D: { status: pending, picks_landed: [], rebuild_done: false, smoke_passed: false }
  E: { status: pending, picks_landed: [], rebuild_done: false, smoke_passed: false }
  F: { status: pending, picks_landed: [], rebuild_done: false, smoke_passed: false }
  G: { status: pending, picks_landed: [], rebuild_done: false, smoke_passed: false }
  H: { status: pending, picks_landed: [], retargeted_to_agentdb: [], skipped: [], smoke_passed: false }
  I: { status: pending, picks_landed: [], skipped: [], rebuild_done: false, smoke_passed: false }
  J: { status: pending, picks_landed: [], skipped: [], smoke_passed: false }
post_batch:
  version_anchor_advance: false
  verdaccio_publish: false
  acceptance_tests_pass: false
  pushed_to_sparkling: false
```

`status` enum per batch: `pending | in_progress | complete | halted`.

## Inventory at sync time

Per-fork unmerged commit counts (verified 2026-05-09):

| Fork           | Last sync   | Days | Upstream ahead | Verdict |
|----------------|-------------|-----:|---------------:|---------|
| ruflo          | 2026-05-03  |    6 |            220 | Active — Batches A–G + J |
| agentic-flow   | 2026-05-03  |    6 |             29 | Active — Batch H |
| agentdb        | 2026-05-06  |    3 |              0 | Caught up — no batch |
| ruv-FANN       | 2026-02-09  |   89 |              0 | Dormant — patch-bump only |
| ruvector       | 2026-05-01  |    8 |             39 | Active — Batch I |

Inventory file: `docs/plans/upstream-sync-2026-05-09.md`. Per-batch verified analyses: `docs/plans/upstream-sync-2026-05-09-batch-{A,B,CD,G,HI}-*.md`.

## Execution model

How the AI uses this runbook + interacts with user during execution. Read this once at the start of a sync session.

### P0. State-file bootstrap

Run once per sync session, before P1. Idempotent — if file exists, do not overwrite (resume from current state).

```bash
mkdir -p /Users/henrik/source/ruflo-patch/.claude-flow/data
test -f /Users/henrik/source/ruflo-patch/.claude-flow/data/sync-2026-05-09.yaml || \
cat > /Users/henrik/source/ruflo-patch/.claude-flow/data/sync-2026-05-09.yaml <<'EOF'
sync_id: 2026-05-09-upstream
schema_version: 1
decisions_resolved:
  adr_0088_policy: null
  pre_extraction_routing: null
  paired_delete_api: null
preflight:
  cross_compile_setup: false
  forks_clean: false
batches:
  A: { status: pending, picks_landed: [], rebuild_done: false, smoke_passed: false }
  B: { status: pending, picks_landed: [], rebuild_done: false, smoke_passed: false }
  C+D: { status: pending, picks_landed: [], rebuild_done: false, smoke_passed: false }
  E: { status: pending, picks_landed: [], rebuild_done: false, smoke_passed: false }
  F: { status: pending, picks_landed: [], rebuild_done: false, smoke_passed: false }
  G: { status: pending, picks_landed: [], rebuild_done: false, smoke_passed: false }
  H: { status: pending, picks_landed: [], retargeted_to_agentdb: [], skipped: [], smoke_passed: false }
  I: { status: pending, picks_landed: [], skipped: [], rebuild_done: false, smoke_passed: false }
  J: { status: pending, picks_landed: [], skipped: [], smoke_passed: false }
post_batch:
  version_anchor_advance: false
  verdaccio_publish: false
  acceptance_tests_pass: false
  pushed_to_sparkling: false
EOF
```

### Decision-gate protocol

Before P1, surface the 3 decisions in `## Decisions gate` to the user via `AskUserQuestion`. For each:

1. Run the decision's check command first
2. Present the output to the user as context
3. Ask the question with the documented decision-tree options
4. Update `state.decisions_resolved.<key>` with the answer

Decision → option mapping:
- ADR-0088 policy → `partial-revert` | `spawn-only`
- Pre-extraction routing → `skip` (recommended; lift-and-shift covered per Agent verification 2026-05-09) | `retarget`
- Paired delete API → `apply` | `defer`

If any decision is unresolved when reaching its gate, halt — do not assume defaults.

### Inter-batch behavior

After a batch's verification block completes:

- **All verifications green** → auto-proceed to the next batch in sequence. Append a one-line summary to chat: `"Batch <X> complete: N picks landed, M skipped, smoke passed; proceeding to Batch <Y>."`
- **Any verification fails OR an unlisted failure mode triggers** → halt. Do not auto-recover, retry, or improvise. Update `state.batches.<X>.status = halted`. Report to user: which step failed, command run, expected output, actual output. Wait for user instruction.
- **Cross-fork batches** (H = agentic-flow, I = ruvector) may run in parallel with ruflo Batches A–G+J once their own pre-conditions hold. Within a single fork, batches are strict-ordered.

### Reporting cadence

| Event | Report to user? |
|---|---|
| Successful cherry-pick within batch | Silent (state file updated) |
| Failed cherry-pick / verification mismatch | Full context: SHA, command, expected vs actual |
| Batch complete (all verifications green) | One-line summary |
| Fork complete (all its batches done) | Fork-level summary: anchor advances applied, commit count remaining vs target |
| Sync complete (all batches + post-batch sanity gate green) | Final summary across all 5 forks + Verdaccio publish status |

### Hand-off to existing pipeline

This runbook does NOT re-implement build, version-bump, codemod, or Verdaccio publish. After all batches reach `status: complete` and the sanity gate passes, invoke the existing pipeline as documented in `## Post-all-batches`:

- `node scripts/fork-version.mjs bump <fork>` — per ADR-0027
- `npm run release` — calls `scripts/ruflo-publish.sh`, orchestrates build + codemod + Verdaccio publish per ADRs 0027, 0142, 0150
- `bash tests/test-acceptance-fast.sh` — existing acceptance harness

Do not re-implement any of these. Do not invoke piecemeal publish scripts (`publish-verdaccio.sh`, etc.) directly — they were intentionally removed from the canonical path per `feedback-build-scripts-only`.

### Rollback recipes

**Single batch (uncommitted)** — soft rollback, keeps working tree:
```bash
cd /Users/henrik/source/forks/<fork>
N=$(yq '.batches.<X>.picks_landed | length' \
   /Users/henrik/source/ruflo-patch/.claude-flow/data/sync-2026-05-09.yaml)
git reset HEAD~$N
# Update state: batches.<X>.status = in_progress, picks_landed unchanged (working tree still has changes)
```

**Single batch (committed)** — hard revert, preserves git history:
```bash
cd /Users/henrik/source/forks/<fork>
N=<count of picks_landed for this batch>
git revert --no-commit HEAD~$N..HEAD
git commit -m "revert: rollback Batch <X> per ADR-0162 (N picks reverted)"
# Update state: batches.<X>.status = pending, picks_landed = []
```

**Published Verdaccio rollback** — after `npm run release` shipped the wrong content:
- Do NOT delete from Verdaccio directly.
- Re-run the source-side rollback above on the affected fork.
- Re-run `npm run release` — pipeline produces the next `-patch.N` version with the correct content. Verdaccio's older versions remain available for any consumer that pinned the bad version explicitly.

**Whole-sync rollback** — if many batches need to revert and individual rollback is too tedious:
```bash
cd /Users/henrik/source/forks/<fork>
git reset --hard <SHA-before-sync-started>  # use the SHA from `git reflog | grep "before Batch A"`
# Reset state file to all-pending
```
This is destructive; use only when the user explicitly authorizes it.

## Decisions gate (resolve before any batch runs)

Three decisions block batch start. Each has a check command and a decision tree. Update `state.decisions_resolved.*` and proceed.

### Decision 1: ADR-0088 policy on `fork()`/IPC restoration

**Context**: Upstream's `a10a13e62` (#1691) and `69e72d2e4` (#1766) restore the IPC code path that ADR-0088 removed.

**Check**:
```bash
grep -E "fork\(|spawn\(process\.execPath" /Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/commands/daemon.ts | head -5
cat /Users/henrik/source/ruflo-patch/docs/adr/ADR-0088-*.md 2>/dev/null | grep -iE "status|spawn|fork" | head -5
```

**Decision tree**:
- If user accepts partial revert → set `adr_0088_policy: partial-revert` → Batch A applies `a10a13e62` and `69e72d2e4` as-is.
- If user wants to keep `spawn`-only → set `adr_0088_policy: spawn-only` → Batch A hand-ports `detached: true` from `69e72d2e4` onto our `spawn(...)` line; drops `child.disconnect()` (no IPC channel exists in our stdio).
- If unset → **halt and ask user.**

### Decision 2: Pre-extraction agentdb commits routing

**Context**: 13 agentic-flow commits target `packages/agentdb/`, deleted in our fork by ADR-0161 step 14. Verified empirically 2026-05-09: content already in `forks/agentdb` via lift-and-shift (sparsification, mincut, attention tests, ADR-072 phase 1 benchmark — all present, byte-identical to upstream).

**Check**:
```bash
ls /Users/henrik/source/forks/agentdb/src/controllers/SparsificationService.ts \
   /Users/henrik/source/forks/agentdb/src/controllers/MincutService.ts \
   /Users/henrik/source/forks/agentdb/tests/unit/sparsification.test.ts 2>&1 | grep -c "^/Users"
# Expected: 3 (all present → lift-and-shift covered)
```

**Decision tree**:
- If output is `3` → set `pre_extraction_routing: skip` → Batch H skips 11 of 13 commits as lift-and-shift covered (default; recommended).
- If output is `<3` → set `pre_extraction_routing: retarget` → Batch H re-targets the listed commits to `forks/agentdb/`.

### Decision 3: Paired delete API timing

**Context**: agentic-flow `c2af4dc` (agentdb delete API) + ruvector `1493bab01` (graph-node delete API) implement two halves of one feature. `1493bab01` requires manual merge (graph-node/lib.rs has +84/-157 divergence vs upstream).

**Check**:
```bash
cd /Users/henrik/source/forks/ruvector
git diff origin/main main -- crates/ruvector-graph-node/src/lib.rs | wc -l
# Expected: >100 (significant divergence; manual merge needed)
```

**Decision tree**:
- If user wants both this session → set `paired_delete_api: apply` → Batch H picks `c2af4dc` (re-targeted to forks/agentdb), Batch I picks `1493bab01` with manual merge.
- If user wants to defer both → set `paired_delete_api: defer` → both commits skipped this batch; track for next sync ADR.

## Preflight (run once before any batch)

### P1. Cross-compile toolchain setup

**Pre-condition**: `state.preflight.cross_compile_setup == false`.

**Commands**:
```bash
brew install zig
cargo install cargo-zigbuild cargo-xwin
rustup target add \
  x86_64-apple-darwin \
  x86_64-unknown-linux-gnu \
  aarch64-unknown-linux-gnu \
  x86_64-pc-windows-msvc
```

**Verification**:
```bash
zig version && \
  cargo zigbuild --version && \
  cargo xwin --version && \
  rustup target list --installed | grep -E "(x86_64-apple-darwin|x86_64-unknown-linux-gnu|aarch64-unknown-linux-gnu|x86_64-pc-windows-msvc)" | wc -l
# Expected last line: 4
```

**Failure modes**:
- `brew install zig` errors with permission → run as user (no sudo needed for homebrew on macOS)
- `cargo install cargo-zigbuild` errors with version mismatch → install pinned version: `cargo install cargo-zigbuild --version <known-good>` (consult `docs/runbooks/zig-pinned-versions.md` if exists)
- xwin fails to download MSVC SDK → check network; retry with `cargo xwin --accept-license` for unattended use

**On success**: set `preflight.cross_compile_setup: true`.

### P2. Verify all forks clean

**Pre-condition**: `state.preflight.forks_clean == false`.

**Commands**:
```bash
for d in ruflo agentic-flow agentdb ruv-FANN ruvector; do
  echo "=== $d ==="
  cd /Users/henrik/source/forks/$d && git status --short && git rev-parse --abbrev-ref HEAD
done
```

**Verification**: each fork shows empty `git status --short` and current branch `main`.

**Failure modes**:
- Uncommitted changes → halt; user resolves before sync starts
- Wrong branch → halt; do not switch branches automatically (preserves user state)

**On success**: set `preflight.forks_clean: true`.

### P3. Fetch upstream for all active forks

```bash
cd /Users/henrik/source/forks/ruflo && git fetch upstream --quiet
cd /Users/henrik/source/forks/agentic-flow && git fetch upstream --quiet
cd /Users/henrik/source/forks/ruvector && git fetch origin --quiet  # ruvector: origin IS upstream
cd /Users/henrik/source/forks/agentdb && git fetch upstream --quiet
```

No state update needed (idempotent).

## Per-batch runbooks

Each batch has identical structure. Run in order: **A → B → C+D → E → F → G → H → I → J**. Within ruflo (A, B, C+D, E, F, G, J) order is strict; H (agentic-flow) and I (ruvector) can run in parallel with the ruflo batches once their respective preconditions hold.

After every cherry-pick that succeeds, append the SHA to `state.batches.<X>.picks_landed`. After every batch completes, set `state.batches.<X>.status: complete`.

---

### Batch A — Daemon (ruflo, 9 commits)

**Pre-conditions**:
- `decisions_resolved.adr_0088_policy != null`
- `preflight.{cross_compile_setup, forks_clean} == true`
- `batches.A.status == pending`
- `cwd = /Users/henrik/source/forks/ruflo`

**Commit list (oldest-first execution order)**:

| # | SHA | What | Special handling |
|---|-----|------|------------------|
| 1 | `a10a13e62` | #1691 daemon.ts `spawn → fork` switch | If `adr_0088_policy=spawn-only`: drop the IPC bits; keep `detached: true` |
| 2 | `69e72d2e4` | #1766 IPC pipe break | If `adr_0088_policy=spawn-only`: skip entirely (depends on #1) |
| 3 | `c67fa393d` | alpha.13 #1793 worker-daemon.ts persist headless results | Limit cherry-pick to `worker-daemon.ts` hunk (drop analyzer.ts hunk if conflict) |
| 4 | `1884ed101` | alpha.12 #1844/#1845 daemon hunks | Drop unrelated MCP-renaming sub-fixes (#1839, #1841, #1842 — already covered by our ADRs) |
| 5 | `d88c69dde` | alpha.15 #1852, #1853, **#1854 hand-port** | DROP memory-initializer.ts hunk; HAND-PORT env-var resolution to `memory-router.ts` (adds `CLAUDE_FLOW_MEMORY_PATH` override + reconciles `memory.swarmDir` ↔ `memory.persistPath` config keys) |
| 6 | `f46e52f41` | alpha.16 crash recovery | Mostly additive; expect clean apply |
| 7 | `66f7f644d` | alpha.17 supervisor + mid-flight + Windows tasklist | — |
| 8 | `fd4c3cb3c` | Windows CI regression test for #1766 | Apply as-is (workflow file no-op for our infra; preserves test artifact) |
| 9 | `003ce127b` | `git mv v2 archive/v2` (6,440 renames) | Cherry-pick applies cleanly — verified blob SHAs identical to upstream pre-archive state |

**Execution (per commit)**:

```bash
git cherry-pick -x --strategy-option=patience <SHA>
# On version-field conflicts in package.json: take theirs
git checkout --theirs v3/@claude-flow/*/package.json 2>/dev/null
git add v3/@claude-flow/*/package.json 2>/dev/null
# On worker-daemon.ts conflict: manual resolution required (928 lines of fork divergence)
git status  # confirm clean before continuing
git cherry-pick --continue
```

**Verification (run after batch complete)**:

```bash
# 1. Daemon survives parent exit on macOS (smoke)
cd /tmp && rm -rf daemon-smoke && mkdir daemon-smoke && cd daemon-smoke
node -e "require('child_process').spawn('node', ['/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/bin/cli.js', 'daemon', 'start', '--quiet'], { stdio: 'inherit', detached: false }).on('exit', () => {});" &
PARENT=$!
sleep 3
kill $PARENT 2>/dev/null
sleep 5
DAEMON_PID=$(cat .claude-flow/daemon.pid 2>/dev/null)
ps -p $DAEMON_PID > /dev/null && echo "PASS" || echo "FAIL"
# Expected: PASS
[ -n "$DAEMON_PID" ] && kill $DAEMON_PID 2>/dev/null

# 2. memory-router.ts hand-port verified
grep -c "CLAUDE_FLOW_MEMORY_PATH" /Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/memory/memory-router.ts
# Expected: ≥ 1
```

**Failure modes**:
- `git cherry-pick` aborts on `worker-daemon.ts` → manual resolution; consult `docs/plans/upstream-sync-2026-05-09-batch-A-daemon.md` per-commit detail
- Daemon smoke test fails (PID dies with parent) → revert batch A; re-evaluate `adr_0088_policy` decision
- `memory-router.ts` lacks `CLAUDE_FLOW_MEMORY_PATH` post-batch → hand-port was missed; re-do step 5

**On success**: `state.batches.A.status: complete`, `smoke_passed: true`.

**Resumability**: each successful cherry-pick appends SHA to `state.batches.A.picks_landed`. On resume, skip SHAs already in `picks_landed`. If state is `in_progress` with N SHAs landed, restart from commit N+1.

---

### Batch B — Security audit (ruflo, 15 commits)

**Pre-conditions**:
- `batches.A.status == complete`
- `cwd = /Users/henrik/source/forks/ruflo`

**Commit list (oldest-first)**:

| # | SHA | Subject | Special handling |
|---|-----|---------|------------------|
| 1 | `f8f4cd4bc` | .env untrack + .gitignore broaden | Apply (filtered to existing files; `v3/goal_ui/.env` already gone) |
| 2 | `bc399dc9a` | npm overrides hardening (protobufjs/tar/uuid) | Apply |
| 3 | `0535c3823` | MCP stdin DoS cap (10 MB) | Apply |
| 4 | `5073f5673` | statusline shell drop | Apply |
| 5 | `fb256ac59` | validateEnv loader-hijack denylist | Apply |
| 6 | `de96b0eed` | restrict file mode on stores | Apply 3 files; **DROP memory-initializer.ts hunk; HAND-PORT** `writeFileRestricted` intent to `memory-router.ts` DB write site (file-mode 0600 hardening) |
| 7 | `bbe53a21c` | regression tests for validateEnv + fs-secure | Apply (depends on #5+#6) |
| 8 | `d9fd35956` | IPFS HEAD timeout + verify.ts timeout | Apply upload.ts hunk; **DROP verify.ts hunk** (verify command never imported into our fork; `fetchWitness`/`DEFAULT_MANIFEST_URL` 0 hits across v3/) |
| 9 | `73babfb06` | github-tools.ts shell injection close | Apply |
| 10 | `c1b57e4fd` | update/executor.ts shell injection close | Apply |
| 11 | `367313824` | aidefence retry + doctor probe | Apply |
| 12 | `ed6d847fa` | bcrypt → bcryptjs | Source only; **DROP pnpm-lock.yaml hunk** |
| 13 | `b9e2eb37e` | vitest pin bump to ^4.0.16 | Source only; **DROP pnpm-lock.yaml hunk** |
| 14 | `d5fbb3bc4` | hooks `$TOOL_INPUT` shell injection | Apply |
| 15 | `3baebe177` | github-safe.js shell injection | **MANUAL**: fork uses `github-safe.mjs` rename + 2 copies (cli + mcp); transcribe to both files |

**Execution (per commit)**:

```bash
git cherry-pick -x --strategy-option=patience <SHA>
git checkout --theirs v3/@claude-flow/*/package.json 2>/dev/null && git add v3/@claude-flow/*/package.json 2>/dev/null
git cherry-pick --continue
```

**Post-batch lockfile regen** (after #12 and #13):
```bash
cd v3 && pnpm install --no-frozen-lockfile
git add v3/pnpm-lock.yaml
git commit -m "chore(v3): regenerate pnpm-lock.yaml post Batch B"
```

**Verification**:
```bash
cd /Users/henrik/source/forks/ruflo

# 1. .env files no longer tracked
git ls-files | grep -E "^ruflo/src/ruvocal/\.env(\.|$)" && echo "FAIL" || echo "OK-env"

# 2. npm overrides include all 4 keys
node -p "Object.keys(require('./package.json').overrides || {}).sort().join(',')"
# Expected: "hono,protobufjs,tar,uuid"

# 3. No remaining unsafe shell-string execSync in security-critical files
grep -nE 'execSync\(`[^`]*\$\{' v3/@claude-flow/cli/src/mcp-tools/github-tools.ts \
                                v3/@claude-flow/cli/src/update/executor.ts \
                                v3/@claude-flow/cli/.claude/helpers/statusline.{js,cjs} 2>/dev/null && echo "FAIL" || echo "OK-shell"

# 4. bcryptjs (not bcrypt)
grep -E '"bcrypt"' v3/@claude-flow/security/package.json && echo "FAIL" || echo "OK-bcrypt"
grep -E '"bcryptjs"' v3/@claude-flow/security/package.json && echo "OK-bcryptjs"

# 5. memory-router.ts has writeFileRestricted (or equivalent) for DB writes
grep -c "writeFileRestricted\|0o600\|mode: 0o600" v3/@claude-flow/cli/src/memory/memory-router.ts
# Expected: ≥ 1
```

**Failure modes**:
- `de96b0eed` cherry-pick aborts on memory-initializer.ts → drop the hunk: `git checkout HEAD -- v3/@claude-flow/cli/src/memory/memory-initializer.ts` (file is deleted in fork); continue
- `3baebe177` apply fails because `github-safe.js` doesn't exist → expected; transcribe manually to `github-safe.mjs` (cli helpers) and `v3/@claude-flow/mcp/.claude/helpers/github-safe.js`
- npm audit shows critical/high after batch → halt; security audit failed; do not publish

**On success**: `batches.B.status: complete`, `smoke_passed: true`.

**Resumability**: append each landed SHA to `state.batches.B.picks_landed`.

---

### Batch C+D — Memory + ADR features (ruflo, 26 commits)

**Pre-conditions**:
- `batches.B.status == complete`
- `cwd = /Users/henrik/source/forks/ruflo`

**Commit list (strict ordering)**:

```
1.  4f2f68d52        embeddings@alpha.13 graceful fallback
2.  53409aba5        embeddings@alpha.14 shape change
3.  ea8cbf697        embeddings@alpha.16 Windows export
4.  21f668c55        transformers-loader (no scope conflict with our ADR-0094)
5.  c32ddead2        ADR-094 docs (lands in upstream's v3/docs/adr/, no conflict)
6.  bd55cd7cb        memory-bridge post-init parallelize → HAND-PORT to post-extraction agentdb seam
7.  6b46946dc        intelligence G6 dedup + trigram hoist
8.  122193a45        memory stats: embedding provider + HNSW
9.  3eb6b4d65        memory_import_claude content-hash dedupe
10. 0377945c9        idempotent memory init
11. d031c3d13        agentdb delete MCP tools → HAND-PORT to post-extraction agentdb-tools.ts
12. 966335022        bsqlite optdep + ^12.9.0 (Node 26 unblock)
13. d6936bae3        memory@alpha.15 version anchor
14. 3e8781bd2        CI no-bsqlite smoke
15. e6478f9ab        ADR-096 design doc
16. cb9a9f346        ADR-096 P1 vault primitives                    [STRICT ORDER 15→21]
17. 98aa2560e        ADR-096 P2 session-tools
18. 49c8019ed        ADR-096 P3 terminal-tools
19. 841365f64        ADR-096 P4 memory DB encryption
20. bbb90046e        ADR-096 status flip
21. ccf58ea4d        ADR-096 P5 doctor section
22. 62a6fc5fb        ADR-097 design doc
23. 7e1cc06df        ADR-097 P1 budget envelope
24. 149ea30a4        ADR-097 plugin docs
25. 9d4a9ea96        ADR-101 squash (Phases 1-3) — DO NOT pick precursors 1f826fb9b/edc39f7da/cc6af4b77
26. 3ba0b6141        ADR-101 build-break fix (CLAIMS_FOR_MESSAGE_TYPE)
27. 779eb309b        ADR-101 witness register
```

**Hand-port mechanic for #6 (`bd55cd7cb`) and #11 (`d031c3d13`)**:
- Both reference `memory-bridge.ts` which is deleted in our fork (relocated by ADR-0161).
- Cherry-pick will fail with "deleted by us" or apply hunk to non-existent file.
- Approach: `git cherry-pick -n <SHA>`; manually port the substantive change to the post-extraction agentdb seam (`v3/@claude-flow/cli/src/mcp-tools/agentdb-tools.ts` for #11; locate equivalent for #6 via `grep -rn "post-init wiring\|parallelize" v3/@claude-flow/cli/src/`); `git commit -m "feat(memory): hand-port <subject> from <SHA> per ADR-0162"`.

**Verification**:
```bash
# Memory + embeddings
cd v3/@claude-flow/embeddings && npm run build && npm test
cd ../memory && npm run build && npm test
cd ../cli && npm test -- --testPathPattern="memory|embeddings|agentdb-delete-tools"

# ADR-096
cd v3/@claude-flow/cli
npm test -- --testPathPattern="(encryption-vault|session-encryption|terminal-encryption|memory-db-encryption|doctor-encryption)"
CLAUDE_FLOW_ENCRYPT_AT_REST=1 CLAUDE_FLOW_ENCRYPTION_KEY=$(openssl rand -hex 32) ./bin/ruflo doctor -c encryption

# ADR-097
cd v3/@claude-flow/plugin-agent-federation
npm test -- --testPathPattern="(federation-budget|federation-coordinator)"

# ADR-101
cd v3/@claude-flow/claims && npm test  # expects 203/203
cd ../plugin-agent-federation && npm test -- --testPathPattern="federation-envelope"  # expects 373/373

# Cross-cutting integrity
cd v3 && npm run build  # expects 23/23 packages clean
```

**Failure modes**:
- ADR-096 phase out-of-order (P2 before P1) → P2 imports `vault.ts` which P1 publishes; halt and re-do in order
- `9d4a9ea96` precursors picked by accident → revert; double-applies federation logic. Verify with `git log main --grep="ADR-101 Phase"` (expected 0 matches before the squash; 1 after).
- `21f668c55` doc filename collision with our `docs/adr/0095-...md` → these live in different directories (`v3/docs/adr/` vs `docs/adr/`); no actual collision.

**On success**: `batches.C+D.status: complete`.

---

### Batch E — Hive-mind / swarm / MCP fixes (ruflo, 8 commits)

**Pre-conditions**: `batches.C+D.status == complete`.

**Commits (apply in any order, no inter-dependencies)**:
`c42aa265a`, `23016fdfa`, `7aa7fc93e`, `3ed34fe06`, `cc114c8db`, `c5915a718`, `d46972171`, `a002ae49a`.

**Execution**: standard cherry-pick loop with `--theirs` on package.json conflicts.

**Verification**:
```bash
cd v3/@claude-flow/cli && npm test -- --testPathPattern="(hive-mind|swarm|mcp-tools)"
```

**On success**: `batches.E.status: complete`.

---

### Batch F — CLI / doctor / init / UX + cli-core split (ruflo, ~22 commits + ba92c5612)

**Pre-conditions**: `batches.E.status == complete`.

**Phase F-1: standard CLI/doctor/init commits** (~22 commits per inventory). Apply oldest → newest. Watch for `memory-initializer.ts` collisions (already touched by `cfb0cea02` per ADR-0156) — reconcile manually.

**Phase F-2: `ba92c5612` cli-core split** (high-impact; 33 files, +2,972/-1,232; 22.9× cold-cache speedup):

**Pre-flight check** (run before applying `ba92c5612`):
```bash
cd /Users/henrik/source/forks/ruflo
git diff main upstream/main -- v3/@claude-flow/cli/src/{types.ts,output.ts,mcp-tools/types.ts,mcp-tools/validate-input.ts} | wc -l
# Expected: 0 (clean) or low (mechanical port). If non-trivial: port fork-only patches to cli-core's source.
```

**Apply**:
```bash
git cherry-pick -x ba92c5612
# Resolve plugin-script conflicts (cost-tracker × 6, ruflo-adr × 2): preserve sparkling rebrand, adopt CLI_CORE env-flag (defaults unchanged).
```

**Update root `package.json` files: whitelist** — add cli-core paths:
```bash
node -e "
  const fs = require('fs');
  const p = JSON.parse(fs.readFileSync('package.json','utf8'));
  const additions = [
    'v3/@claude-flow/cli-core/bin/**',
    'v3/@claude-flow/cli-core/dist/**/*.js',
    'v3/@claude-flow/cli-core/dist/**/*.d.ts',
    '!v3/@claude-flow/cli-core/dist/**/*.map',
    'v3/@claude-flow/cli-core/package.json'
  ];
  for (const a of additions) if (!p.files.includes(a)) p.files.push(a);
  fs.writeFileSync('package.json', JSON.stringify(p, null, 2) + '\n');
"
git add package.json
git commit -m "chore(publish): include cli-core in files whitelist (ADR-0162 Batch F)"
```

**Register `@sparkleideas/cli-core` in publish-levels**:
```bash
cd /Users/henrik/source/ruflo-patch
# Edit config/publish-levels.json — add @sparkleideas/cli-core to Level 1.
# Verify scripts/preflight-discover.mjs WONT_PUBLISH_PATTERNS does NOT match cli-core.
grep "cli-core" scripts/preflight-discover.mjs
# Expected: 0 matches in WONT_PUBLISH_PATTERNS (or explicit allow comment)
```

**Verification (post-batch-F)**:
```bash
cd /Users/henrik/source/forks/ruflo
cd v3/@claude-flow/cli-core && npm run build  # must succeed
cd ../cli && npm run build  # must succeed (4 shim files compile against cli-core dep)
cd /Users/henrik/source/forks/ruflo && node bin/cli.js --version  # must print version, not crash

# Cold-cache benchmark (run after Verdaccio publish, in post-batch checks):
# rm -rf ~/.npm/_npx
# time npx -y @sparkleideas/ruflo@latest --version
# Expected: <5s (was 25-34s pre-split)
```

**Failure modes**:
- cli's shim files don't resolve `@claude-flow/cli-core` → check pnpm workspace symlinks; `pnpm install` in v3/ to refresh.
- preflight-discover.mjs pattern-blocks `cli-core` → add explicit allow rule or move to LEVELS map.
- Cold-cache benchmark stays slow → verify cli-core/dist/ is included in tarball: `npm pack --dry-run | grep cli-core`.

**On success**: `batches.F.status: complete`.

---

### Batch G — ADR-0001 plugin contract bundle (ruflo, 30 commits)

**Pre-conditions**: `batches.F.status == complete`.

**Commits**: `df49b5176..6324f5ae0` consecutive range plus `b5b6fb3fb` (ruflo-browser, separate position). 30 commits per `docs/plans/upstream-sync-2026-05-09-batch-G-plugin-contract.md`.

**Execution**:
```bash
cd /Users/henrik/source/forks/ruflo
# Cherry-pick range with auto-conflict-resolution for plugin.json version fields
git cherry-pick -x df49b5176^..6324f5ae0
# On plugin.json version conflicts: take upstream's version (0.2.0/0.3.0) — pipeline manages package version separately
for f in $(git diff --name-only --diff-filter=U); do
  if [[ "$f" =~ plugin\.json$ ]]; then
    git checkout --theirs "$f"
    git add "$f"
  fi
done
git cherry-pick --continue

# Then b5b6fb3fb separately
git cherry-pick -x b5b6fb3fb
```

**Verification**:
```bash
# All 30 plugins now at version 0.2.0+ in their plugin.json
for p in /Users/henrik/source/forks/ruflo/plugins/ruflo-*/.claude-plugin/plugin.json; do
  node -p "JSON.parse(require('fs').readFileSync('$p','utf8')).version"
done | sort -u
# Expected: only 0.2.0 / 0.3.0 (no 0.1.x left for plugins in the bundle)

# Codemod will rebrand `mcp__claude-flow__*` → `mcp__ruflo__*` and `@claude-flow/cli` → `@sparkleideas/ruflo` at publish; verify post-publish via Verdaccio inspection.
```

**Failure modes**:
- Cherry-pick range fails mid-bundle → resume from last successful SHA (consult `picks_landed` state)
- Local `ruflo-adr` SKILL.md edits collide with upstream's `df49b5176` → verified false earlier (zero file overlap); if a conflict appears, halt — investigate.

**On success**: `batches.G.status: complete`.

---

### Batch H — agentic-flow (29 commits → 6 PICK + 3 RE-TARGET + 20 SKIP)

**Pre-conditions**:
- `decisions_resolved.pre_extraction_routing != null`
- `decisions_resolved.paired_delete_api != null`
- `cwd = /Users/henrik/source/forks/agentic-flow`

#### H-1: APPLY in agentic-flow (6 commits, 4 full + 2 partial)

| # | SHA | Action |
|---|-----|--------|
| 1 | `f5b6c7d` | Cherry-pick with file-by-file conflict resolution; **re-target the 3 `packages/agentdb/`-prefixed files** to `forks/agentdb/` (strip prefix) |
| 2 | `50eef3a` | KEEP only `agentic-flow/wasm/reasoningbank/*` WASM regen; DROP `packages/agentdb/package-lock.json` hunk |
| 3 | `c2af4dc` | If `paired_delete_api == apply`: RE-TARGET ALL 3 files to `forks/agentdb/` (paired with ruvector `1493bab01` in Batch I). Else SKIP. |
| 4 | `d231a13` | KEEP `.gitignore` additions only (`benchmark-results/`, `agentdb.db-shm`, `.claude/scheduled_tasks.lock`); DROP submodule pin + open-lovable hunks |
| 5 | `e60a5ba` | **PARTIAL**. Big merge (89 files / +18,784/-2,792). Cherry-pick with `-m 1`. Then `git checkout HEAD -- packages/agentdb/` to drop the agentdb hunks (already in via lift-and-shift). Keep top-level test infra: `playwright.config.ts`, `tests/browser/graph-transformer-wasm.test.ts`, `tests/browser/test-page.html`, `tsconfig.test.json`. |
| 6 | `62e4961` | Same as #5 (merge of #148, identical content). May skip if #5 already lands the content. |

#### H-2: RE-TARGET to `forks/agentdb/` (3 docs)

These are documents that exist in upstream's vendored agentdb but are absent in our `forks/agentdb`:

```bash
# c830a98 — ADR-072 design doc
cd /Users/henrik/source/forks/agentdb
git -C /Users/henrik/source/forks/agentic-flow show c830a98:docs/adrs/ADR-072-ruvector-advanced-features-integration.md \
    > docs/adrs/ADR-072-ruvector-advanced-features-integration.md
git add docs/adrs/ADR-072-ruvector-advanced-features-integration.md
git commit -m "docs(adrs): import ADR-072 design doc from agentic-flow@c830a98 (Phase 1 already shipped)"

# 25b26e2 — ADR-071 design doc
git -C /Users/henrik/source/forks/agentic-flow show 25b26e2:docs/adrs/ADR-071-agentdb-ruvector-wasm-capabilities-review.md \
    > docs/adrs/ADR-071-agentdb-ruvector-wasm-capabilities-review.md
git add docs/adrs/ADR-071-agentdb-ruvector-wasm-capabilities-review.md
git commit -m "docs(adrs): import ADR-071 design doc from agentic-flow@25b26e2 (Phase 2-4 WASM/browser already shipped)"

# 54440ca — PRE-PUBLISH-REVIEW.md
git -C /Users/henrik/source/forks/agentic-flow show 54440ca:packages/agentdb/PRE-PUBLISH-REVIEW.md \
    > PRE-PUBLISH-REVIEW.md
git add PRE-PUBLISH-REVIEW.md
git commit -m "docs: import PRE-PUBLISH-REVIEW.md from agentic-flow@54440ca (npm publishing guide)"
```

Append the 3 SHAs to `state.batches.H.retargeted_to_agentdb`.

#### H-3: SKIP (20 commits, verified mechanical)

| Category | Count | Commits |
|---|---:|---|
| Submodule pin (content already in `forks/agentdb`) | 5 | `daa521a`, `61f5841`, `629eb4f`, `bc31f0b`, `5e0497d` |
| Release no-op (bumps `agentdb` npm dep we don't track) | 3 | `d671c91`, `57a3859`, `1b85f67` |
| Pre-extraction lift-and-shift covered (verified file-present) | 11 | `bd434bf`, `45bbf17`, `7bbe540`, `6ef7ebb`, `0a8d6a1`, `24adb18`, `034b0a6`, `acfba14`, `2f24973`, `d19c130`, `a65ae9e` |
| Historical release note (no retroactive value) | 1 | `74f1a59` |

Append all 20 SHAs to `state.batches.H.skipped` for audit trail.

**Verification**:
```bash
cd /Users/henrik/source/forks/agentic-flow
git log upstream/main --not main --oneline | wc -l
# Expected: ≤ 8 (5 submodule + 3 release no-ops; 6 PICKed, 3 RE-TARGETed elsewhere, 12 covered-by-lift-and-shift accounted for)

# Top-level test infra now present in our agentic-flow
ls playwright.config.ts tests/browser/graph-transformer-wasm.test.ts tests/browser/test-page.html tsconfig.test.json | wc -l
# Expected: 4
```

**On success**: `batches.H.status: complete`.

---

### Batch I — ruvector (39 commits → 19 PICK + 20 SKIP, 1 manual merge)

**Pre-conditions**:
- `preflight.cross_compile_setup == true`
- `decisions_resolved.paired_delete_api != null` (gates `1493bab01`)
- `cwd = /Users/henrik/source/forks/ruvector`

#### I-1: APPLY 19 commits (chronological order; sparse-attention chain has strict order)

```
Hailo cluster:        d771d06ee → c7b0ba4c0 → c12d828b7 → 0442856c3* → c6d69003a → 55eae8887
Graph-node delete:    1493bab01  (manual merge; paired with c2af4dc; only if paired_delete_api == apply)
Sparse-attention:     4922b034f → 4c375e7ef → eb0fc2858 → 4db35f280 → add51a930 → 3c80010c0 → efc3d3618 → 9d8006ae2 → 51b1ca777
Docs:                 c30987277, 068bb637a, 36912ba3e, 58de8932d
```

`*` = `0442856c3` strip binary hunks during cherry-pick.

#### I-2: SKIP 18 NAPI binaries (verified pure-binary)

`ef5274c29`, `e38347601`, `6808c706e`, `fa39e66cf`, `ec4e4bbd1`, `1b106721b`, `5c580ebae`, `645c94df4`, `259c28965`, `5ea1c275e`, `b71981b5c`, `81a3532f3`, `77b44c2e1`, `999bfbdf7`, `225184550`, `368d64a29`, `5e0a1a414`, `8b518302c`. We rebuild from our source via the cross-compile toolchain.

Append all 18 to `state.batches.I.skipped`.

#### I-3: Carry-through Cargo.toml workspace `members` additions

Upstream's `Cargo.toml` in the picks moves 5 crates from `exclude` to `members` (`hailort-sys`, `ruvector-hailo`, `ruvector-hailo-cluster`, `ruvector-mmwave`) plus 2 net-new (`ruvllm_sparse_attention`, `ruvllm_retrieval_diffusion`). **Don't drop these hunks.** `ruos-thermal` stays in `exclude` (intentional standalone `[workspace]`).

#### I-4: Manual merge for `1493bab01`

`crates/ruvector-graph-node/src/lib.rs` has +84/-157 divergence. Re-implement `deleteNode`/`deleteEdge`/`deleteHyperedge` API on top of our current structure; preserve the API contract from upstream.

#### I-5: Rebuild ruvllm-wasm AFTER `c6d69003a`

```bash
cd crates/ruvllm-wasm
wasm-pack build --target web --out-dir ../../npm/packages/ruvllm-wasm
git add ../../npm/packages/ruvllm-wasm
git commit -m "chore(ruvector): rebuild ruvllm-wasm post c6d69003a (ADR-0162 Batch I)"
```

#### I-6: Rebuild all 5 platform binaries

After all picks land:
```bash
cd /Users/henrik/source/forks/ruvector
# Update build-all-platforms.sh per Batch I prereq to use zigbuild + xwin
napi build --target aarch64-apple-darwin --platform --release
napi build --target x86_64-apple-darwin --platform --release
napi build --target x86_64-unknown-linux-gnu --platform --release --zig
napi build --target aarch64-unknown-linux-gnu --platform --release --zig
cargo xwin build --release --target x86_64-pc-windows-msvc
# Copy outputs into npm/core/platforms/<5>/ruvector.node and equivalents for graph-node, rvf-node, ruvLLM
git add npm/
git commit -m "chore(ruvector): rebuild NAPI binaries for 5 platforms post Batch I"
```

**Verification**:
```bash
cd /Users/henrik/source/forks/ruvector

# Workspace + all 5 NAPI platforms produced
cargo build --release --workspace 2>&1 | tail -5
find npm/core/platforms -name "ruvector.node" | wc -l   # Expected: 5

# ruvllm-wasm rebuilt
test -f npm/packages/ruvllm-wasm/ruvllm_wasm_bg.wasm && echo "OK-wasm" || echo "FAIL"

# Artifact count unchanged
find npm -type f \( -name "*.node" -o -name "*.wasm" \) | wc -l   # Expected: 20

# Smoke darwin-arm64 (only platform we can run)
node -e "require('./npm/core/platforms/darwin-arm64/ruvector.node')" && echo "OK-load" || echo "FAIL"

# Hailo features OFF in default build
strings npm/core/platforms/darwin-arm64/ruvector.node | grep -c "hailort_init" || echo "0"
# Expected: 0 (no Hailo runtime symbols in default build)
```

**On success**: `batches.I.status: complete`, `rebuild_done: true`, `smoke_passed: true`.

---

### Batch J — CI / witness / release / docs (ruflo, ~25 commits)

**Pre-conditions**: `batches.{A,B,C+D,E,F,G}.status == complete` (ruflo content batches all done).

Apply LAST so witness manifests reflect actual state. Most are mechanical regenerations.

**SKIP — 5 upstream README prose tweaks** (verified personal-voice + affiliate-link, conflicts with our ADR-0143 sparkling README):
- `00039a833` — adds `ruv.io` link + `Cognitum.One/?RuFlo` affiliate URL; introduces `npx ruvflo init` typo
- `cb3809820` — voice tweak; subject misleading (brand "Ruflo" already present pre-commit)
- `1c266663c` — re-phrasing of Cognitum.One sentence
- `7523e4daa` — single 🔌 emoji on `<summary>`
- `6f11cc794` — typo fix `Congnitum` → `Cognitum`

Append the 5 to `state.batches.J.skipped`.

**Apply**: remaining ~20 CI/witness/release commits per inventory. Standard cherry-pick loop.

**On success**: `batches.J.status: complete`.

---

## Post-all-batches

### Sanity gate

**Pre-condition**: every `batches.<X>.status == complete`.

```bash
# 1. Sync completeness per fork
cd /Users/henrik/source/forks/ruflo && git log upstream/main --not main --oneline | wc -l
# Expected: ≤ 5 (README prose only)
cd /Users/henrik/source/forks/agentic-flow && git log upstream/main --not main --oneline | wc -l
# Expected: ≤ 8 (5 submodule + 3 release no-op)
cd /Users/henrik/source/forks/ruvector && git log origin/main --not main --oneline | wc -l
# Expected: ≤ 18 (NAPI binary commits — regenerated from our source)
```

If any output exceeds the expected count, halt — there are commits not accounted for.

### Version anchor advance

**Pre-condition**: sanity gate passed.

```bash
cd /Users/henrik/source/ruflo-patch
node scripts/fork-version.mjs bump /Users/henrik/source/forks/ruflo
node scripts/fork-version.mjs bump /Users/henrik/source/forks/agentic-flow
node scripts/fork-version.mjs bump /Users/henrik/source/forks/ruv-FANN
node scripts/fork-version.mjs bump /Users/henrik/source/forks/ruvector
# (agentdb: bumped via ADR-0161-aware path; not part of fork-version.mjs sweep)
```

**Verification — 8 ruflo packages anchor-advance**:
```bash
for pkg in cli shared guidance memory embeddings neural browser security; do
  v=$(node -p "JSON.parse(require('fs').readFileSync('/Users/henrik/source/forks/ruflo/v3/@claude-flow/$pkg/package.json','utf8')).version")
  echo "$pkg: $v"
done
# Expected:
#   cli        → 3.7.0-alpha.18-patch.1
#   shared     → 3.0.0-alpha.7-patch.1
#   guidance   → 3.0.0-alpha.3-patch.1
#   memory     → 3.0.0-alpha.15-patch.1
#   embeddings → 3.0.0-alpha.16-patch.1
#   neural     → 3.0.0-alpha.8-patch.1
#   browser    → 3.0.0-alpha.3-patch.1
#   security   → 3.0.0-alpha.7-patch.1
```

**Verification — patch-increment-only sample**:
```bash
node -p "JSON.parse(require('fs').readFileSync('/Users/henrik/source/forks/ruflo/v3/@claude-flow/codex/package.json','utf8')).version"
# Expected: 3.0.0-alpha.9-patch.108  (was patch.107 → +1)
```

**Verification — agentic-flow anchor advance**:
```bash
node -p "JSON.parse(require('fs').readFileSync('/Users/henrik/source/forks/agentic-flow/agentic-flow/package.json','utf8')).version"
# Expected: 2.0.11-patch.1  (was 2.0.2-alpha-patch.94)
```

**On success**: `state.post_batch.version_anchor_advance: true`.

### Acceptance tests

```bash
cd /Users/henrik/source/ruflo-patch
bash tests/test-acceptance-fast.sh
# Expected: exit 0
```

**On success**: `state.post_batch.acceptance_tests_pass: true`.

### Verdaccio publish

```bash
cd /Users/henrik/source/ruflo-patch
npm run release
# Per-fork publish + codemod + Verdaccio upload
```

**Verification — published versions on Verdaccio**:
```bash
for pkg in cli shared guidance memory embeddings neural browser security cli-core; do
  v=$(npm view --registry=http://localhost:4873 @sparkleideas/$pkg version 2>/dev/null)
  echo "@sparkleideas/$pkg: $v"
done
# Expected: each at the post-anchor-advance value (e.g. 3.7.0-alpha.18-patch.1 for cli)
```

**On success**: `state.post_batch.verdaccio_publish: true`.

### Cold-cache benchmark (proves cli-core split transferred)

```bash
TMP_NPM=$(mktemp -d)
NPM_CONFIG_CACHE=$TMP_NPM time npx -y --registry=http://localhost:4873 @sparkleideas/ruflo@latest --version
# Expected: <5s (was 25-34s pre-Batch-F)
```

### Push to sparkling

```bash
for d in ruflo agentic-flow agentdb ruv-FANN ruvector; do
  cd /Users/henrik/source/forks/$d && git push sparkling main
done
```

**On success**: `state.post_batch.pushed_to_sparkling: true`. Sync complete.

---

## Mechanical-block skips (final verified list — single source of truth)

| Category | Count | Commits | Verified by |
|---|---:|---|---|
| Upstream README prose | 5 | `00039a833`, `cb3809820`, `1c266663c`, `7523e4daa`, `6f11cc794` | Direct diff read 2026-05-09 |
| agentic-flow submodules | 5 | `daa521a`, `61f5841`, `629eb4f`, `bc31f0b`, `5e0497d` | Pinned SHAs in `forks/agentdb`; `bc31f0b` README byte-identical (0-line diff) |
| agentic-flow release no-ops | 3 | `d671c91`, `57a3859`, `1b85f67` | Bump `agentdb` npm dep we don't track |
| agentic-flow lift-and-shift covered | 12 | `bd434bf`, `45bbf17`, `7bbe540`, `6ef7ebb`, `0a8d6a1`, `24adb18`, `034b0a6`, `acfba14`, `2f24973`, `d19c130`, `a65ae9e`, `74f1a59` | Agent verification 2026-05-09: 9 INTENT-PRESERVED + 2 N/A + 1 historical-release-note |
| ruvector NAPI binaries | 18 | `ef5274c29` through `8b518302c` | Pure binary deltas (0 source line changes); regenerated from our source via cross-compile |

**Total full-commit skips: 43.**

**Hunk-level drops: 1.** `verify.ts` hunk in `d9fd35956` — upstream's CDN-witness verify command never imported (`fetchWitness` 0 hits across v3/); local artifact verification model unaffected.

**Hunk-level hand-ports: 2.**
- `#1854` patch in `d88c69dde` → `memory-router.ts` (env-var `CLAUDE_FLOW_MEMORY_PATH` resolution)
- `memory-initializer.ts` hunk in `de96b0eed` → current DB write site (`writeFileRestricted` file-mode 0600)

**Package.json version-bump hunks**: LAND with their commits. Final `fork-version.mjs` run harmonizes patch suffixes; 8 ruflo + 1 agentic-flow get genuine anchor advances; rest are intermediate jitter that gets harmonized.

---

## Background (rationale; not needed for execution)

### Why we publish v3, not v2

The version label `2.7.47-patch.527` is misleading: package is built and published from `v3/@claude-flow/*`. Verified:
- `bin/cli.js` is a 12-line proxy to `v3/@claude-flow/cli/bin/cli.js`
- Root `package.json` `files:` whitelist publishes only `v3/@claude-flow/{cli,shared,guidance}/...` paths
- `ruflo/package.json` declares `"@claude-flow/cli": ">=3.0.0-alpha.1"`
- Last 30 days, excluding bumps: v3/ has 240 real commits, v2/ has 9 (mostly cleanup)

`v2/` is dead-tree material. Upstream's `003ce127b` archives it; we follow.

### Versioning ADR chain

ADR-0012 (2026-03-06) proposed `bump-last-segment` to fix caret-range matching. ADR-0027 (2026-03-08) reverted to `{upstream}-patch.N` per package, sidestepping ADR-0012's concern via mandatory exact pinned deps. ADR-0079 T1-9 enforces pin discipline programmatically (build fails on unpinned `@sparkleideas/*` internal deps). ADR-0101 documents the model publicly.

ADR-0012 status updated 2026-05-09 to "Superseded by ADR-0027." `config/published-versions.json` confirms ADR-0027 is in force (every entry uses `-patch.N`).

### Three concrete pressures

1. Daemon regressions — 9 upstream commits address Windows IPC pipe, daemon self-kill, crash recovery, supervisor.
2. Cadence ~37 commits/day in ruflo — letting drift compound past 400 commits exceeds what one batch absorbs.
3. Real collisions need triage: ADR-0161 (agentdb extraction), ADR-0086 (memory-initializer.ts deletion), ADR-0088 (fork→spawn revert), ADR-0143 (sparkling rebrand).

### Considered alternatives (rejected)

1. Bulk merge upstream/main — loses revert granularity; would silently revert ADR-0143; would re-introduce agentdb submodule conflicting with ADR-0161.
2. Categorized batches with verified per-commit decisions — **chosen.**
3. Do nothing — drift compounds; daemon bugs reach more users.
4. Tooling-driven auto-rebase — premature; collision classes need human triage.

### Build pipeline coverage (verified by 4-agent swarm 2026-05-09)

| Fork | Binary artifacts shipped | Affected by sync? |
|---|---|---|
| ruflo | 2 WASM (`guidance_kernel`, `rvagent_wasm`) | NO (zero binary-touching commits in 220) |
| agentic-flow | reasoningbank WASM (4 files) | YES (`50eef3a` regen; paths intact post-ADR-0161) |
| agentdb | NONE (pure TS; native via optionalDependencies) | NO |
| ruv-FANN | n/a | NO (upstream dormant) |
| ruvector | 20 (10 NAPI + 10 WASM) | YES — 4 of 7 NAPI crates DIVERGED from upstream; rebuild ALL 5 platforms via cross-compile |

Pre-existing fork debt (out of scope; track separately): 9 standalone WASM crates uncovered by `build:all`; hardcoded NAPI/WASM allowlists in pipeline; agentdb dead `build:napi`/`build:wasm` scripts.

---

## Follow-up audit tasks (out of scope for this sync)

1. **Fetch-timeout audit** — d9fd35956's verify.ts hunk has no target in our fork; general intent (timeout fetches that could hang) applies to other fetch sites: `transfer-store` CDN downloads, `plugins/store/discovery.ts`, IPFS upload/HEAD, neural artifact downloads, iot-cognitum witness chain syncs. Catalog hits with `grep -rn "fetch(" --include="*.ts" v3/ | grep -v "AbortSignal.timeout"` and port `AbortSignal.timeout(N)` pattern.

2. **DB-write file-mode audit** — beyond the immediate hand-port, check whether other fork-side write sites for sensitive data (session stores, terminal histories, encryption vault scratch files) use `writeFileRestricted` or equivalent 0600 discipline.

3. **Pipeline silently-drops new artifacts** — `lib/napi-config.sh` and `scripts/build-wasm.sh` use hardcoded allowlists. Add fail-loud detection for new NAPI/WASM crates.

4. **agentdb dead build scripts** — vestigial `build:napi`/`build:wasm` in `forks/agentdb/package.json` reference non-existent dirs. Remove.

5. **Cross-compile pinning** — pin `zig` and `cargo-zigbuild` to known-good versions in `docs/runbooks/zig-pinned-versions.md` to avoid sync-time breakage on toolchain releases.

---

## More information

- Inventory: `docs/plans/upstream-sync-2026-05-09.md`
- Per-batch verified analyses:
  - `docs/plans/upstream-sync-2026-05-09-batch-A-daemon.md`
  - `docs/plans/upstream-sync-2026-05-09-batch-B-security.md`
  - `docs/plans/upstream-sync-2026-05-09-batch-CD-memory-adr.md`
  - `docs/plans/upstream-sync-2026-05-09-batch-G-plugin-contract.md`
  - `docs/plans/upstream-sync-2026-05-09-batch-HI-cross-fork.md`
- Build pipeline audit: 4-agent swarm 2026-05-09; full agent reports in conversation history of this ADR's authoring session
- Verdaccio publish path: `~/.claude/projects/-Users-henrik-source-ruflo-patch/memory/reference-pipeline-publish-paths.md`
- Acceptance tests: `tests/test-acceptance-fast.sh` (~90s)
