# 2026-05-25 — Picks-implementer validation report

## Verdict

**RED** — Phase 3 release acceptance aborted at the `undiscriminating-catches` lint phase before reaching acceptance tests. Both flagged catches were introduced by commit `b5d12dc93` (one of the 8 picks).

## Phase 1 — Content vs subject (8 commits)

All 8 commits' content matches the audit expectations and the commit subjects. Each carries a `(cherry picked from commit XXX)` trailer linking to the upstream SHA. Authors are upstream `ruv <ruv@ruv.net>`; committer is Henrik (standard cherry-pick pattern).

| SHA | Subject (short) | Files touched | Audit-expected files | Substance found | Verdict |
|---|---|---|---|---|---|
| `1c31b3ecc` | #2042 agent_execute provider routing (PAIRED) | 3 files: `.github/workflows/v3-ci.yml`, `scripts/smoke-agent-execute-providers.mjs`, `v3/@claude-flow/cli/src/mcp-tools/agent-execute-core.ts` | `agent-execute-core.ts` (+OpenRouter dispatch from `94b98c90c`); new static-only smoke from `1eebc724f` | `callOpenAICompat` helper present (2 mentions in source); `OpenRouter` referenced 12x in source; smoke is static-only, no install/build steps; both halves of the pair landed | PASS |
| `576abb329` | docs: badge links (partial pick) | 1 file: `v3/@claude-flow/memory/README.md` (2-line diff) | Memory README only; root + ruflo README skipped per ADR-0143 | Only the 2 badge URLs switched from relative to absolute GitHub URLs; root and ruflo README untouched | PASS |
| `7949e613e` | #2089 ADR-127 Phase 2 security | 14 files: github-safe.js (both copies), github-setup.sh (both), 3 dogfood agent .md (WebFetch removal), swarm-pr/issue (4 copies), smoke-github-safe-injection.mjs | github-safe + agent frontmatter + injection sweep | 3 dogfood agents have 0 `WebFetch` mentions (`release-manager`, `release-swarm`, `repo-architect`); 14 files match audit's expected scope | PASS |
| `6a78593b6` | #2089 Phase 3 actions/checkout@v4 | 12 files: 6 dogfood commands + 5 init-template agents + smoke widening | All `@v3` deprecated refs cleared from `.claude/` and `v3/@claude-flow/cli/.claude/` | `grep -rn 'actions/checkout@v3'` returns 0 matches in either tree; smoke covers 5 scan-tree paths | PASS |
| `c045ef6cb` | #2049 kg-extract type-imports + drop disabled semantic-route | 7 files: kg plugin SKILL.md + commands/kg.md + agents/graph-navigator.md + plugin.json + new smoke + supply-chain follow-ups | type-depends-on relation + dropped `agentdb_semantic-route` controller across 4 fork callsites | `agentdb_semantic-route` remaining mentions are in retired-controller documentation context, not active `allowed-tools`; broader fork sweep landed | PASS |
| `b5d12dc93` | #2098 #2093 #2085 three regressions | 4 files: init.ts (#2098A) + headless-worker-executor.ts (#2098B) + agent-tools.ts + swarm-tools.ts (#2085) | `--no-global` flag fix; `detached:true` + `process.kill(-pid)`; `swarmId` schema + bridge | All three substances present: `flags['global'] === false` read; `detached: process.platform !== 'win32'` + `process.kill(-child.pid, signal)`; `swarmId` schema + `swarm.agents.push(agentId)` + `loadSwarmStore`/`saveSwarmStore` imports | PASS (content) / FAIL (lint discipline — see Discrepancies) |
| `6fdfae731` | #2078 CLAUDE.md Co-Authored-By rule | 1 file: `v3/@claude-flow/cli/src/init/claudemd-generator.ts` (+2 lines/-1 line) | One-line addition to `behavioralRules()` | Single rule added: "NEVER add a `Co-Authored-By` trailer to user commits unless this project's `.claude/settings.json` has `attribution.commit` set (#2078)..." | PASS |
| `215a600ee` | #2086 ruvllm WASM auto-init | 2 files: `scripts/smoke-ruvllm-wasm-auto-init.mjs` + `v3/@claude-flow/cli/src/mcp-tools/ruvllm-tools.ts` | `loadRuvllmWasm()` folds in `await initRuvllmWasm()`; separate `loadRuvllmWasmModule()` for status diagnostic; smoke ported | Both `initRuvllmWasm()` call inside `loadRuvllmWasm()` and the `loadRuvllmWasmModule()` helper present in source (lines 41-42, 46) | PASS |

### Paired-pick verification (`1c31b3ecc`)

Both upstream change sets landed:
- From `94b98c90c`: `callOpenAICompat` helper, `RUFLO_PROVIDER=openrouter` env var, `OPENROUTER_API_KEY` branch, no-provider error lists Anthropic+OpenRouter+Ollama, `executeAgentTask()` delegates to `callAnthropicMessages()`.
- From `1eebc724f`: smoke is static-only (5 contract checks, no dist-import), workflow shape has no install/build steps.

The commit message explicitly cites both `(cherry picked from commit 94b98c90c...)` and `(cherry picked from commit 1eebc724f...)`. PAIRED pick is correctly recorded.

### Partial-pick verification (`576abb329`)

Only `v3/@claude-flow/memory/README.md` (2-line diff) landed. Root README and `ruflo/README.md` additions per ADR-0143 brand divergence were correctly skipped — fork's `README.md` and `ruflo/README.md` were not modified by this commit. The trailer `(cherry picked partial from commit 32612ecdf...: memory README only)` documents the partial scope.

## Phase 2 — Build + unit tests

### Fork build (`npm run build` in `forks/ruflo`)

**Result**: top-level `tsc` emits 388 TypeScript errors. **Zero of these errors are in pick-touched files** — all are concentrated in `v3/plugins/{agentic-qe, financial-risk, gastown-bridge, healthcare-clinical, hyperbolic-reasoning, neural-coordination, perf-optimizer, prime-radiant}`, `v3/@claude-flow/{codex, deployment/examples, memory/benchmarks, memory/examples, neural, plugin-agent-federation, plugin-iot-cognitum, plugins/examples}`, and `v3/index.ts` coordination/shared module references.

These trees are pre-existing build-state issues unrelated to the 8 picks. The publish pipeline does not use top-level `tsc` — it uses per-package builds via `bash scripts/build-packages.sh` (see `package.json` line: `"build:tsc": "npm run codemod && bash scripts/build-packages.sh"`).

A baseline build against parent commit `34119ebcb` aborts at the very first error (`error TS2688: Cannot find type definition file for 'long'`) — `@types/long` is missing from `node_modules`. The pick-tip build proceeds past that point and exposes pre-existing errors in unbuilt-by-default trees. The picks did not introduce these errors.

Build log: `logs/picks-validator-build-20260525T130806Z.log` (491 lines, 388 errors)
Parent build log: `logs/picks-validator-parent-build-20260525T130806Z.log` (9 lines, 1 fatal error)

### Unit tests

Per the task spec: "after build success: cd /Users/henrik/source/ruflo-patch && npm test". `ruflo-patch` has no top-level `test` script; the unit-test path is `npm run test:unit`, which cascades through `preflight` + `test:pipeline` + `test:unit`. This cascade is also embedded in the release pipeline (`scripts/ruflo-publish.sh`), so I proceeded directly to Phase 3 — the release run exercises the same unit/lint surface.

The release pipeline aborted in lint phase before reaching unit tests, so no unit-test verdict is available from this validation run. The lint failure is upstream of unit tests.

## Phase 3 — Release acceptance

**Result**: FAILED at `undiscriminating-catches` lint phase. Did not reach the acceptance count gate.

Release log: `logs/picks-validator-release-20260525T130806Z.log` (62 lines, exit 0 from background harness but pipeline logged `ERROR: Phase 'undiscriminating-catches' failed — aborting`).

Phase sequence executed:
- `adr0180-gates` PASS (4/4 gates, 1287ms)
- `merge-detect` PASS (fast-forwards on all 5 forks)
- `napi-coverage` PASS (19 NAPI crates)
- `fetch-timeout` PASS (40 fetch calls all carry signal)
- `silent-catches` PASS (1281 catches scanned, all surface error)
- `undiscriminating-catches` **FAIL** — 2 violations:

```
[UNDISCRIMINATING-CATCH] ../forks/ruflo/v3/@claude-flow/cli/src/services/headless-worker-executor.ts:1216
  try { process.kill(-child.pid, signal); return; } catch { /* fall through */ }

[UNDISCRIMINATING-CATCH] ../forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/agent-tools.ts:318
  } catch { /* swarm store unavailable — agent still registered globally */ }
```

Both files modified by commit `b5d12dc93` (one of the 8 picks). Both catches are verbatim from upstream `ad429d154` — the picks-implementer faithfully reproduced upstream's code but did not adapt to the fork-specific `lint-undiscriminating-catches` discipline (per memory `feedback-best-effort-must-rethrow-fatals`).

The lint message offers three legitimate remediations:
1. Add a discriminator: `} catch (e) { if (e.code !== 'ESRCH') throw e; /* expected race */ }`
2. Add a log: `} catch (e) { logger.warn('...', e); }`
3. Allowlist with rationale in `lib/undiscriminating-catches-allowlist.txt`

For the kill-tree catch: `process.kill(-pid, sig)` failing with `ESRCH` (process group already gone) is the documented expected race; any other error should propagate. For the swarm-bridge catch: an I/O error reading/writing the swarm store is a real failure that should be logged rather than silently swallowed — per memory `feedback-best-effort-must-rethrow-fatals`, "ADR-0085-style try/catch must discriminate; swallowing fatal data-integrity errors is an ADR-0082 violation".

The release pipeline never reached the acceptance count (688+/697 expected). Verdict counts unavailable.

## Phase 4 — Ledger cross-check

All 14 rows updated by `b885a43` checked. All `Local SHA` references that point to fork commits exist (`git cat-file -t` returns `commit` for each of the 8 picks). All dispositions match the audit's recommendations.

| Row | Upstream SHA | Disposition (post-`b885a43`) | Local SHA | Verdict |
|---|---|---|---|---|
| 171 | `32612ecdf` | hand-ported (partial) | `576abb329` | Match audit + commit exists |
| 172 | `f8974c74c` | skip-by-policy | — | Match audit |
| 173 | `10db8e459` | skip-by-policy | — | Match audit |
| 174 | `7d2fc001e` | hand-ported | `7949e613e` | Match audit + commit exists |
| 175 | `b4e177667` | hand-ported | `6a78593b6` | Match audit + commit exists |
| 176 | `21e52108d` | hand-ported | `c045ef6cb` | Match audit + commit exists |
| 177 | `f60417352` | skip-by-policy | — | Match audit |
| 178 | `3dbf6074a` | skip-by-policy | — | Match audit |
| 179 | `94b98c90c` | hand-ported (paired) | `1c31b3ecc` | Match audit + commit exists |
| 180 | `ad429d154` | hand-ported | `b5d12dc93` | Match audit + commit exists |
| 181 | `6b7d64bcb` | hand-ported | `6fdfae731` | Match audit + commit exists |
| 182 | `1eebc724f` | hand-ported (paired) | `1c31b3ecc` | Match audit + commit exists; paired with row 179 |
| 183 | `0c31cbad4` | pending | — | Match audit; Notes carry explicit ADR-decision trigger ("separate ADR deciding fork's `memory_export` surface") |
| 184 | `bc1f587c0` | hand-ported | `215a600ee` | Match audit + commit exists |

No row claims a fork SHA that doesn't exist. No row's disposition contradicts the audit. Skip-by-policy entries all use `—` for `Local SHA`. The paired-pick rows (179, 182) both point to the same fork SHA `1c31b3ecc` — correctly recorded for the paired-pick pattern.

## Discrepancies

### D1 — Lint-discipline violation in `b5d12dc93` (BLOCKING)

Commit `b5d12dc93` ports two upstream catch blocks verbatim that fail the fork's `lint-undiscriminating-catches` check:
- `headless-worker-executor.ts:1216` — `catch { /* fall through */ }` after `process.kill(-child.pid, signal)`
- `agent-tools.ts:318` — `catch { /* swarm store unavailable — agent still registered globally */ }` after the swarm-store push

This is a fork-specific lint that upstream `ad429d154` does not have to satisfy. Per the picks-implementer audit recommendation: "Three small surgical fixes. All present in fork." The audit did not flag this lint mismatch in advance. The fork build itself succeeded, but the publish pipeline's lint phase rejects the catches.

Both violations are exclusively in `b5d12dc93`-introduced code. No other pick introduced new undiscriminating catches.

### D2 — Co-Authored-By trailers preserved from upstream (NON-BLOCKING)

5 of 8 picks (`6a78593b6`, `7949e613e`, `c045ef6cb`, `b5d12dc93`, `6fdfae731`, `215a600ee`) carry `Co-Authored-By: RuFlo <ruv@ruv.net>` or `Co-Authored-By: RuFlo <ruflo-bot@users.noreply.github.com>` trailers in their messages. These come from upstream commit bodies and were preserved via cherry-pick to keep upstream attribution greppable (per memory `feedback-update-integration-ledger`: "Use `git cherry-pick -x` so trailers stay greppable").

Memory `feedback-fork-commit-attribution.md` states: "Henrik is sole committer on forks/{ruflo,...}; never append `Co-Authored-By: claude-flow <ruv@ruv.net>` there." The trailers here are from cherry-picked upstream commit bodies (not appended by Claude/the implementer), and the committer is Henrik. The author/committer split is the documented `git cherry-pick -x` pattern. This is consistent with how the ledger surfaces upstream provenance and does not require correction. Flagging for awareness only.

### D3 — Top-level `tsc` errors are pre-existing (NON-BLOCKING)

The fork's top-level `npm run build` (which runs `tsc`) emits 388 errors. None of these errors are in pick-touched files — they're all in unrelated trees that the publish pipeline doesn't build (`v3/plugins/*`, `v3/@claude-flow/{codex,deployment/examples,memory/{benchmarks,examples}, neural, plugin-*, plugins/examples}`, `v3/index.ts`). The per-package publish pipeline (`scripts/build-packages.sh`) does not invoke top-level `tsc`; it builds the packages listed in `config/package-map.json`. The picks did not introduce these errors; this is pre-existing build state.

## Recommendation

**RED — Fix D1 before push.**

Required next step: address the 2 undiscriminating-catch violations in `b5d12dc93`. Three options ordered from preferred to fallback:

1. **Discriminator on `headless-worker-executor.ts:1216`** — `} catch (e: any) { if (e?.code !== 'ESRCH') throw e; /* process group already gone */ }`. `ESRCH` is the documented errno when the process group doesn't exist; any other error (e.g., `EPERM`) should propagate so callers see the real failure rather than silently falling through to the child-only kill.

2. **Discriminator OR log on `agent-tools.ts:318`** — either `} catch (e: any) { logger.warn('agent_spawn: swarm-store bridge failed', { agentId, targetSwarmId, error: e?.message }); }` to keep the best-effort semantics while surfacing real failures, OR add the same `if (e?.code !== 'ENOENT') throw e;` shape if the only expected failure mode is "store file missing".

3. **Allowlist** in `lib/undiscriminating-catches-allowlist.txt` (less preferred; the lint exists precisely because allowlisting bare-comment catches hides regressions like the 2026-05-19 TrainingPipeline ESM-vs-CJS one).

After the fix, re-run `bash scripts/ruflo-publish.sh --force` to confirm the release reaches acceptance and counts at 688+/697 / 0 fail / ≤9 skip_accepted before pushing.

**Do not push the current state**. The picks-implementer's commits cleanly cherry-pick upstream code but miss a fork-specific lint discipline that the publish pipeline enforces.
