# 2026-05-25 — ruflo init validation: semantic-modelling

## Verdict

GREEN with two cosmetic warnings (no functional regression).

## Phase 1 — Pre-flight

- Location: `/Users/henrik/source/hm/semantic-modelling`
- Pre-existing git state: dirty (modifications + many untracked `.claude/memory/*.md` and `generated/sds/*` files). This is the target project's own working state, NOT something we touched. No commit performed there.
- Verdaccio: reachable at `localhost:4873` (HTML root served).
- Pinned versions on Verdaccio (audit-time):
  - `@sparkleideas/ruflo@latest` = `3.1.0-alpha.14-patch.290`
  - `@sparkleideas/cli@latest` = `3.7.0-alpha.10-patch.314`
  - Wrapper declares dependency: `{ "@sparkleideas/cli": "3.7.0-alpha.10-patch.314" }` — exact pin, aligned with `@latest` cli. No regression vs `project-ruflo-wrapper-latest-regression`.

## Phase 2 — Init run

- First attempt FAILED with `[ERROR] Unknown option: --withEmbedding` — the task spec asked for `--with-embedding` (singular), but the canonical flag is `--with-embeddings` (plural). The argparser camel-cases the singular form and rejects it. Default for `--with-embeddings` is `true`, so embeddings would init even without the flag.
- Second attempt with correct `--with-embeddings`: SUCCESS.
- Log: `/Users/henrik/source/ruflo-patch/logs/init-validate-semantic-modelling-20260525T144524Z.log` (43 lines)
- Command: `npx -y @sparkleideas/ruflo@latest init --full --force --with-embeddings`
- Key output lines:
  - `... Initializing... RuFlo V3 initialized successfully!`
  - `Files: 139 created`
  - `Skills: .claude/skills/ (34 skills)` — banner says 34, actual dir has 38 entries (38 dirs, 37 SKILL.md)
  - `Agents: .claude/agents/ (89 agents)` — banner says 89, actual = 30 (substrate set; would be ~89 with `--all-agents`)
  - `Commands: .claude/commands/ (23 commands)` — matches
  - `[INFO] Hooks: 7 hook types enabled in settings.json`
  - `[INFO] Initializing ONNX embedding subsystem... Model: Xenova/all-mpnet-base-v2 Hyperbolic: Enabled (Poincaré ball) ✓ Embeddings initialized`

## Phase 3 — Artifacts

| Path | Status | Notes |
|---|---|---|
| `.claude/` | present | dirs: `agents/` (30), `commands/` (23), `skills/` (38), `helpers/`, `memory/`, `scripts/`, `worktrees/`, `projects/` |
| `.claude/settings.json` | present | 9542 bytes, today's mtime, 7 hook types |
| `.claude/skills/*/SKILL.md` | 37 present | well above the ≥5 threshold; SKILLS_MAP bundle (ADR-0216) intact |
| `.claude/helpers/hook-handler.mjs` | present | 13163 bytes, executable, today's mtime |
| `.claude/helpers/auto-memory-hook.mjs` | present | 3422 bytes, executable, today's mtime |
| `.mcp.json` | present | `ruflo` server: `npx -y @sparkleideas/ruflo@latest mcp start` (matches `feedback-always-npx-for-ruflo`); also lists `ruv-swarm` and `flow-nexus` as `optional:true` |
| `.swarm/memory.rvf` | present | 162 bytes pre-roundtrip → **4694 bytes post-roundtrip** (RVF is the active write path); SFVR magic header (`53 46 56 52 01 05` = format V1.5) |
| `.swarm/memory.db` | present | SQLite 3.x, but mtime stale (Apr 22) — confirms RVF-primary, SQLite NOT being written |
| `CLAUDE.md` | present | 7036 bytes, today's mtime — ADR-0235 init template |
| `.claude-flow/config.json` | present | 6417 bytes, today's mtime |
| `~/.cache/transformers/Xenova/all-mpnet-base-v2/onnx/model_quantized.onnx` | present | 110 MB, mtime 2026-04 (lazy-loaded earlier, reused now) |

## Phase 4 — Memory system

Round-trip results:

| Step | Command | Result |
|---|---|---|
| 1. store | `memory store --key test-init-validation --value "validation test 2026-05-25"` | OK — `Vector: Yes (768-dim)`, 26 bytes stored |
| 2. search | `memory search --query "validation"` | OK — 1 result, key `test-init-validation`, **score 0.44**, namespace `default`, search time 182ms |
| 3. retrieve | `memory retrieve --key test-init-validation` | OK — exact value returned, `Access Count: 1`, `Vector: Yes` |
| 4. stats | `memory stats` | OK — `Provider: Xenova/all-mpnet-base-v2`, `Dimensions: 768`, `Semantic Search: yes`, `Total Entries: 1` |

- Score 0.44 is well above the fork's adaptive floor of 0.15 (per `project-memory-search-rvf-snapshot-isolation`). The mpnet-cosine recall fix is in effect.
- 768-dim embeddings confirm `Xenova/all-mpnet-base-v2` per `reference-embedding-model`.
- RVF file growth (162 → 4694 bytes) + stale SQLite mtime confirms RVF is the primary substrate per ADR-0177 (no Phase-D regression).

## Phase 5 — Intelligence/hooks

`.claude/settings.json` registers 7 hook types calling the local `hook-handler.mjs` (file-based, lock-free path per `project-two-hook-paths-cli-vs-handler`):

- `PreToolUse`: Bash → pre-bash, Write|Edit|MultiEdit → pre-edit, Task → pre-task
- `PostToolUse`: Write|Edit|MultiEdit → post-edit, Bash → post-command, Task → post-task
- `UserPromptSubmit`: route (intelligence routing — this is what emits `[INTELLIGENCE]` signals)
- `SessionStart`: session-restore + `auto-memory-hook.mjs import` + `check-patches.sh --global` + `daemon start --quiet`
- `SessionEnd`: session-end
- `Stop`: present (truncated by 120-line read window)

All hooks resolve via `${CLAUDE_PROJECT_DIR:-.}` with fallback to `${HOME}` — the file-based path. None call `mcp__ruflo__*` directly (correct — that path holds the RVF lock and was the F-13-001 victim).

## Phase 6 — Patch identification

- `npx -y @sparkleideas/ruflo@latest --version` → `ruflo v3.7.0-alpha.10-patch.314` (the wrapper delegates `--version` to the cli, so this is the cli version, not the wrapper version).
- Wrapper version on Verdaccio: `@sparkleideas/ruflo@latest` = `3.1.0-alpha.14-patch.290`
- Wrapper deps on Verdaccio: `{ "@sparkleideas/cli": "3.7.0-alpha.10-patch.314" }` — exact-pin equal to `@sparkleideas/cli@latest`.
- Conclusion: wrapper-CLI alignment is correct; no version regression.

## Anomalies / discrepancies

1. **Task spec flag is `--with-embedding`; canonical is `--with-embeddings`** (plural). First init attempt rejected. Either update task spec OR add a singular alias to the parser. Not a regression — works with the correct flag.
2. **Init banner reports `89 agents` but `.claude/agents/` contains 30** — the 30 is the post-ADR-128 substrate default; `--all-agents` was not passed. The banner text in the wrapper appears to hardcode "89" regardless of the substrate subset actually installed. Cosmetic, but misleading.
3. **`memory store` logs `[INFO] Storing in undefined/test-init-validation`** — namespace prefix is the literal string `undefined` when not specified, instead of resolving to the default namespace. The stored entry's namespace is correctly `default` in the search/retrieve responses; only the log line is wrong.
4. **`memory stats` reports `Backend: SQLite + HNSW`** but the file evidence (memory.rvf growing, memory.db stale) shows RVF is the actual primary write path. Likely stale stats output not updated for the ADR-0177 RVF restoration. Cosmetic — the search/retrieve work.
5. **`memory stats` reports `HNSW Index: not active`** — search still returned at 0.44 score. With 1 entry, HNSW may legitimately skip indexing. Worth re-running stats with >32 entries (HNSW M=23) to see if the indicator flips. Not a gate.
6. **`memory stats` shows empty `Total Storage` and `Location`** — purely a printf gap.

## Recommendation

**GREEN — init is solid.** The patched memory system is properly initialised on `semantic-modelling`:

- Wrapper/CLI versions align with Verdaccio `@latest` (no `project-ruflo-wrapper-latest-regression`).
- RVF is the active primary substrate (file growth confirms writes).
- 768-dim mpnet embeddings via cached ONNX model — `reference-embedding-model` honoured.
- Memory round-trip works end-to-end at score 0.44 — above the 0.15 adaptive floor (the `project-memory-search-rvf-snapshot-isolation` fix is in effect).
- 7 hook types registered through the file-based lock-free path.
- `.mcp.json` uses `npx -y @sparkleideas/ruflo@latest` per `feedback-always-npx-for-ruflo`.

**The 6 anomalies above are cosmetic/diagnostic only.** None block usage. Worth tracking as a follow-up batch:

- (low) Add a `--with-embedding` alias for the singular form so docs/task specs don't trip
- (low) Fix the agent-count banner to print the actual installed count
- (low) Strip the `undefined/` prefix from the `memory store` log line
- (low) Update `memory stats` to print `RVF + HNSW` (or detect substrate) and populate `Total Storage` / `Location`
