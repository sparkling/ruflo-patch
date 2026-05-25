# 2026-05-25 — INTEGRATION-LEDGER pending-row audit (14 SHAs)

## Summary

- **pick now: 5**
  - `32612ecdf` — memory README badge link bug (fork still has broken relative URLs)
  - `7d2fc001e` — github-safe security hardening (fork has vulnerable injection patterns + WebFetch)
  - `b4e177667` — github actions/checkout@v3 deprecation sweep (fork has the deprecated refs)
  - `94b98c90c` — agent_execute provider routing (fork users on OpenRouter/Ollama affected)
  - `1eebc724f` — companion smoke for `94b98c90c` (pick together)
- **pick now (low-confidence, see notes): 4**
  - `21e52108d` — kg-extract type-import + drop semantic-route (fork plugin has the bug)
  - `ad429d154` — three regressions (#2098A no-global, #2098B detached kill, #2085 swarm bridging) all present in fork
  - `6b7d64bcb` — claudemd-generator Co-Authored-By rule (aligns with `feedback-fork-commit-attribution`)
  - `bc1f587c0` — ruvllm WASM auto-init in loadRuvllmWasm (fork has the bug)
- **skip-by-policy: 4**
  - `f8974c74c` — README badge trim (codex/RuFlo branding not on fork; trims badges fork never had)
  - `10db8e459` — RuFlo Agentic Appliance banner (upstream brand; fork's README diverges per ADR-0143)
  - `f60417352` — agentic-flow 2.0.12 bump (fork Verdaccio-pinned `2.0.2-alpha-patch.861`; Batch J standing rule)
  - `3dbf6074a` — agentic-flow 2.0.13 bump (same policy as `f60417352`)
- **superseded-by-local: 0**
- **keep-pending: 1**
  - `0c31cbad4` — memory `export --value-only` (target code path doesn't exist on fork; needs separate `memory_export` MCP tool work first)

Net effect on ledger: **13 of 14 rows get a concrete disposition (pick or skip-by-policy)**; only 1 row remains pending and now carries an explicit trigger.

---

## Per-SHA findings

### `32612ecdf` 2026-05-19 — docs: fix badge links + add ecosystem badges

**Upstream content**: 3 files. `v3/@claude-flow/memory/README.md` flips two badge hrefs from relative (`../../../data/clone-data.proof.json`) to absolute GitHub URLs (npm strips relative links). Adds ecosystem-downloads + git-clones badges to root `README.md` and `ruflo/README.md`.

**Fork state**:
- `forks/ruflo/v3/@claude-flow/memory/README.md` lines 4-5: still has the broken relative URLs (`../../../data/clone-data.proof.json`, `../../../data/clone-data.ledger.json`). The npm-page rendering bug applies to fork-published `@claude-flow/memory` too.
- Fork's root + `ruflo/README.md` diverge per ADR-0143 (carry flo.ruv.io / goal.ruv.io / RuVector badges); upstream's added ecosystem-downloads badges are NOT in fork.

**Recommendation**: **pick** (memory README portion only)

**Reason**: The memory README badge-link fix is a genuine npm-page rendering bug that affects fork's published `@claude-flow/memory`. The root + `ruflo/README.md` additions touch surfaces the fork has rebranded per ADR-0143 and should be skipped to avoid re-introducing upstream brand badges. Surgical hand-port: just the 2-line diff in `v3/@claude-flow/memory/README.md`.

**Proposed ledger row update**: `hand-ported | <new-fork-sha> | 0252 | Memory README badge link bug picked surgically (2-line diff to absolute GitHub URLs); root + ruflo README additions skipped per ADR-0143 brand divergence.`

---

### `f8974c74c` 2026-05-19 — docs: trim redundant per-package npm badges

**Upstream content**: Removes 3 badges from root + `ruflo/README.md` (`npm downloads (ruflo)`, `npm version (claude-flow)`, `npm downloads (claude-flow)`) — keeps only the ecosystem-downloads + git-clones added in `32612ecdf`.

**Fork state**: Fork's root + `ruflo/README.md` (per ADR-0143) carry a different badge set entirely (flo.ruv.io / goal.ruv.io / RuVector etc.). The badges being trimmed don't exist on fork.

**Recommendation**: **skip-by-policy**

**Reason**: This is the trim half of an upstream pair (`32612ecdf` adds, `f8974c74c` trims). Since fork doesn't carry the badges being trimmed and the prior add wasn't picked (skipped per ADR-0143), the trim has nothing to apply against. Pure no-op.

**Proposed ledger row update**: `skip-by-policy | — | 0252 | ADR-0143 brand divergence: fork's root + ruflo/README.md badge set differs from upstream; the badges being trimmed don't exist on fork → no-op.`

---

### `10db8e459` 2026-05-21 — docs(readme): add RuFlo Agentic Appliance banner

**Upstream content**: Adds `RuFlo-agentic-appliance.png` (2MB) + banner link `cognitum.one/appliance` to root README, `ruflo/README.md`, and `v3/@claude-flow/cli/README.md`.

**Fork state**: Fork's READMEs diverge per ADR-0143 (sparkling brand). Per memory `feedback-no-codex-mentions` and ADR-0143, upstream brand assets (Cognitum.One affiliate banners, RuFlo branding) are skipped.

**Recommendation**: **skip-by-policy**

**Reason**: Direct match to existing ledger policy precedent — row 125 (Batch J) skipped 5 SHAs `00039a833`/`6f11cc794`/`7523e4daa`/`1c266663c`/`cb3809820` for "Cognitum.One affiliate, `npx ruvflo init` typo, branding switches" with reason "sparkling brand kept per ADR-0143". This is the same shape of commit.

**Proposed ledger row update**: `skip-by-policy | — | 0252 | ADR-0143 brand divergence: Cognitum.One affiliate banner is upstream brand surface; sparkling brand kept per Batch J standing rule (row 125).`

---

### `7d2fc001e` 2026-05-21 — feat(security): #2089 ADR-127 Phase 2 — github-safe maxBuffer + agent frontmatter

**Upstream content** (12 files, +255/-128):
- `github-safe.js` (both copies): adds `GITHUB_SAFE_VERSION='1.0.0'`, 256KB body cap, strict try/finally cleanup
- `github-setup.sh` (both copies): `set -euo pipefail` + improved `gh auth status` parsing
- 3 agent .md files (release-manager, release-swarm, repo-architect): removes `WebFetch` from `tools:` frontmatter
- `swarm-pr.md` + `swarm-issue.md` (both dogfood + init-template): replaces unquoted `${{ github.event.comment.body }}` / `${{ github.event.label.name }}` interpolation with `mktemp + printf + grep + --comment-file` pattern (prompt-injection fix)
- `smoke-github-safe-injection.mjs` flips 256KB case from "note" to "ok"

**Fork state**:
- `forks/ruflo/.claude/helpers/github-safe.js` is missing `GITHUB_SAFE_VERSION` and `MAX_BODY_BYTES` — the body cap + version constant aren't there (only `GITHUB_SAFE_DRY_RUN` is, from an earlier phase).
- 8 fork files still have the vulnerable `${{ github.event.comment.body }}` / `${{ github.event.label.name }}` interpolation pattern (4 swarm-pr.md, 4 swarm-issue.md across `.claude/agents/`, `.claude/commands/`, `v3/@claude-flow/cli/.claude/agents/`, `v3/@claude-flow/cli/.claude/commands/`).
- 6 fork agent .md files still have `WebFetch` in `tools:` (release-manager, release-swarm, repo-architect across the dogfood + init-template trees).

**Recommendation**: **pick**

**Reason**: This is a real prompt-injection + body-size security hardening. The cited "frontmatter conflict" in the original Batch S deferral is solely the `mcp__claude-flow__*` → `mcp__ruflo__*` rebrand in the agent frontmatter — the upstream patch's actual change to that frontmatter is just removing `WebFetch` from the `tools:` line, which is orthogonal to the rebrand. A hand-port preserving the `mcp__ruflo__*` prefix has no conflict shape. The injection fix has zero rebrand surface (shell pattern, not MCP tool names).

**Proposed ledger row update**: `hand-ported | <new-fork-sha> | 0252 | github-safe security hardening picked; agent frontmatter WebFetch removal preserves fork's mcp__ruflo__ rebrand (only the WebFetch line removed, frontmatter prefix kept).`

---

### `b4e177667` 2026-05-21 — fix(github): #2089 — complete Phase 3 (5 init-template agents missed)

**Upstream content** (15 files): `actions/checkout@v3` → `actions/checkout@v4` across 5 init-template agents + 6 dogfood commands. Strengthens `smoke-deprecated-actions.mjs` to scan all 5 trees instead of 2. Version bump to alpha.75.

**Fork state**: `grep -rln 'actions/checkout@v3'` against fork's `.claude/` and `v3/@claude-flow/cli/.claude/` finds 10+ files still on the deprecated v3. The fork is exposed.

**Recommendation**: **pick**

**Reason**: Sed-style mechanical fix. `actions/checkout@v3` is deprecated and will be removed by GitHub Actions; fork's smoke-deprecated-actions check has the same scan-tree gap upstream is closing. The version-bump portion is skip-mechanical (Batch J standing rule — fork has independent `-patch.N` chain), but the actions sweep + smoke widening is in scope.

**Proposed ledger row update**: `hand-ported | <new-fork-sha> | 0252 | actions/checkout@v3 → v4 sweep across fork's 4 .claude/ trees + smoke widening; version-bump portion (alpha.75) skipped per Batch J fork-chain rule.`

---

### `21e52108d` 2026-05-19 — fix(kg-extract): #2049 type-imports + drop semantic-route

**Upstream content** (5 files): kg-extract SKILL.md adds `type-depends-on` relation (weight 0.1) for TS `import type`; kg-traverse SKILL.md switches from disabled `agentdb_semantic-route` to `agentdb_pattern-search`. New smoke `smoke-kg-extract-type-imports.mjs` + `v3-ci.yml` job. New `.github/supply-chain/follow-ups.md`.

**Fork state**:
- `forks/ruflo/plugins/ruflo-knowledge-graph/skills/kg-extract/SKILL.md` line 5 still references `mcp__ruflo__agentdb_semantic-route` in `allowed-tools` (disabled controller per upstream's analysis).
- `forks/ruflo/plugins/ruflo-knowledge-graph/skills/kg-traverse/SKILL.md` line 5 + line 20 still calls `agentdb_semantic-route` for routing/similarity.
- Fork's plugin manifest + `commands/kg.md` + `agents/graph-navigator.md` also reference `agentdb_semantic-route` (broader cleanup needed beyond the 2 SKILL.md files).

**Recommendation**: **pick** (with broader fork sweep)

**Reason**: The disabled-controller reference is a real bug in fork — `agentdb_semantic-route` returns "SemanticRouter not available in current agentdb build" per upstream analysis, and fork's plugin would hit the same dead path. The type-import classification is also genuinely useful for fork's kg-extract users. Fork has 4 callsites (vs upstream's 2 SKILL.md files) — adapt the sweep to cover all 4.

**Proposed ledger row update**: `hand-ported | <new-fork-sha> | 0252 | kg-extract type-depends-on + dropped disabled agentdb_semantic-route across 4 fork plugin files (SKILL.md kg-extract/kg-traverse + commands/kg.md + agents/graph-navigator.md); smoke ported.`

---

### `f60417352` 2026-05-19 — fix(deps): #2046 ADR-124 — bump agentic-flow to 2.0.12

**Upstream content**: Bumps `agentic-flow: ^2.0.11 → ^2.0.12` in root + `v3/@claude-flow/browser` + accepted-findings + lockfiles. New ADR-124 doc.

**Fork state**: Fork pins `agentic-flow: 2.0.2-alpha-patch.861` (Verdaccio-only build) in 4 package.json files; Batch J standing rule (row 148 `5fedd1d02`) explicitly keeps the fork's Verdaccio pin against upstream agentic-flow bumps.

**Recommendation**: **skip-by-policy**

**Reason**: Direct match to existing ledger policy precedent — row 148 (Batch S `5fedd1d02`) skipped an agentic-flow bump with reason "kept fork's `agentic-flow: 2.0.2-alpha-patch.818` Verdaccio pin". The 2.0.12 patch (xenova optional) is the kind of fix the fork's own Verdaccio-built agentic-flow chain handles independently.

**Proposed ledger row update**: `skip-by-policy | — | 0252 | Batch J standing rule: fork pins agentic-flow 2.0.2-alpha-patch.861 (Verdaccio); upstream 2.0.12 bump not applicable. Per-fix xenova-optional behavior covered by fork's independent agentic-flow patch chain.`

---

### `3dbf6074a` 2026-05-19 — fix(deps): #2048 — bump agentic-flow 2.0.12 → 2.0.13

**Upstream content**: Patch follow-up to `f60417352` (Windows onnxruntime lazy-load).

**Fork state**: Same as `f60417352` — fork has independent Verdaccio-pinned agentic-flow chain.

**Recommendation**: **skip-by-policy**

**Reason**: Same as `f60417352`. Companion upstream patch chain.

**Proposed ledger row update**: `skip-by-policy | — | 0252 | Same as f60417352 — Batch J fork Verdaccio-pin rule.`

---

### `94b98c90c` 2026-05-21 — fix(mcp): #2042 — agent_execute routes through v3 provider system

**Upstream content** (3 files, +284/-86): `agent-execute-core.ts` `executeAgentTask()` now delegates to `callAnthropicMessages()` which dispatches Anthropic / OpenRouter / Ollama. New `callOpenAICompat()` helper. New smoke + v3-ci job.

**Fork state**: `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/agent-execute-core.ts`:
- Line 116 and line 361: BOTH inline `fetch('https://api.anthropic.com/v1/messages', ...)` calls present
- `executeAgentTask()` early-returns with "ANTHROPIC_API_KEY required" if Anthropic key absent
- No OpenRouter branch, no `callOpenAICompat`

Fork has the exact bug. Any fork user running on OpenRouter or Ollama via `.claude-flow/config.yaml` cannot use `agent_execute`.

**Recommendation**: **pick**

**Reason**: Real high-severity user bug. Ruflo's multi-provider story is broken without this. Patch is localized to one file + adds a smoke. No fork divergence in this file.

**Proposed ledger row update**: `hand-ported | <new-fork-sha> | 0252 | agent_execute now routes through provider system (Anthropic / OpenRouter / Ollama); fork had the two inline anthropic fetches + ANTHROPIC_API_KEY hard requirement. Pick paired with 1eebc724f smoke.`

---

### `ad429d154` 2026-05-21 — fix(cli,daemon,mcp): #2098 #2093 #2085 — three regressions

**Upstream content** (4 files, +64/-6): three independent bug fixes:
1. **#2098A** `--no-global` flag: parser stores `flags.foo=false` for `--no-foo`, not `flags['no-foo']=true`; init.ts read the wrong key.
2. **#2098B / #2093** Daemon subprocess: spawn `claude --print` without `detached:true`; grandchildren reparent to init on timeout. Fix: `detached:true` + `process.kill(-pid, sig)`.
3. **#2085** `agent_spawn` not in `swarm_status.agents`: agent store and swarm store never bridged; schema didn't accept `swarmId`.

**Fork state**:
- `forks/ruflo/v3/@claude-flow/cli/src/commands/init.ts` line 188: still reads `flags['no-global']` (the wrong key per upstream analysis).
- `forks/ruflo/v3/@claude-flow/cli/src/services/headless-worker-executor.ts`: still uses `child.kill('SIGTERM')` / `child.kill('SIGKILL')` (lines 765, 785, 788, 1206, 1209, 1210, 1285); no `detached:true`, no `process.kill(-pid, ...)`.
- `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/agent-tools.ts`: no `swarmId` field in `agent_spawn` schema; no swarm.agents push.

All three bugs present in fork.

**Recommendation**: **pick**

**Reason**: Three small surgical fixes. Each has independent value (init flag respect, daemon subprocess cleanup against leaks, swarm/agent visibility). All present in fork.

**Proposed ledger row update**: `hand-ported | <new-fork-sha> | 0252 | Three regressions ported: #2098A flag-read fix in init.ts; #2098B detached+pgid kill in headless-worker-executor.ts; #2085 swarmId schema + agent store bridging.`

---

### `6b7d64bcb` 2026-05-21 — fix(init): #2078 — CLAUDE.md Co-Authored-By override

**Upstream content** (1 file, +1 line): adds a bullet to `behavioralRules()` in `claudemd-generator.ts`: "NEVER add a Co-Authored-By trailer to user commits unless this project's .claude/settings.json has attribution.commit set (#2078)."

**Fork state**: `forks/ruflo/v3/@claude-flow/cli/src/init/claudemd-generator.ts` `behavioralRules()` (lines 14-25) has no Co-Authored-By rule.

**Recommendation**: **pick**

**Reason**: One-line addition. Aligns directly with user memory `feedback-fork-commit-attribution` (Henrik is sole committer on fork branches, doesn't want Co-Authored-By appended). Project-level generated CLAUDE.md only — doesn't touch fork's own repo conventions. Trivial pick.

(Note: the prior ledger row referenced "ADR-0083 generator drift" — that ADR is actually about Phase 5 single data flow, unrelated. The reference was incorrect but doesn't affect disposition.)

**Proposed ledger row update**: `hand-ported | <new-fork-sha> | 0252 | One-line behavioralRules() addition to claudemd-generator.ts; aligns with feedback-fork-commit-attribution.`

---

### `1eebc724f` 2026-05-21 — fix(smoke): #2042 — make providers smoke static-only

**Upstream content** (2 files, +20/-27): drops the dist-import behavioral check from `smoke-agent-execute-providers.mjs` (CI install of cli's `workspace:*` deps fails); replaces with static contract: OpenRouter dispatch must come BEFORE Anthropic-key early-return. Removes install/build steps from `agent-execute-providers-smoke` job.

**Fork state**: Smoke doesn't exist on fork yet (lands with `94b98c90c`).

**Recommendation**: **pick** (together with `94b98c90c`)

**Reason**: Companion fix to `94b98c90c`. Pick them as a pair so the smoke is born static-only and doesn't need its install/build hack.

**Proposed ledger row update**: `hand-ported | <new-fork-sha> | 0252 | Companion to 94b98c90c — static-only smoke for OpenRouter dispatch order; pick as pair so smoke is born without the install/build hack.`

---

### `0c31cbad4` 2026-05-20 — fix(memory): #2073 — export returns real value + --value-only

**Upstream content** (4 files, +72/-8):
- `memory.ts` `retrieveCommand`: new `--value-only` flag (raw stdout, no decoration)
- `memory-tools.ts` `memory_export`: passes `includeContent:true` to `listEntries`, writes `e.content` to exported `value`
- `memory-bridge.ts` `bridgeListEntries`: accepts `includeContent` option
- `memory-initializer.ts` `listEntries`: accepts `includeContent` option

**Fork state**:
- `forks/ruflo/v3/@claude-flow/cli/src/memory/` does NOT contain `memory-bridge.ts` or `memory-initializer.ts`. Fork's memory subsystem is restructured: `archivist-init.ts`, `ewc-consolidation.ts`, `intelligence.ts`, `memory-router.ts`, `neural-package-bridge.ts`, `rabitq-index.ts`, `sona-optimizer.ts`.
- `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/memory-tools.ts` exports 10 memory tools (`memory_store`, `memory_retrieve`, `memory_search`, `memory_delete`, `memory_list`, `memory_stats`, `memory_migrate`, `memory_import_claude`, `memory_bridge_status`, `memory_search_unified`) — **no `memory_export` tool exists**.
- Fork's `commands/memory.ts` exportCommand calls `callMCPTool('memory_export', ...)` — which targets a tool the fork doesn't define. The CLI `memory export` is already broken on fork.

**Recommendation**: **keep-pending** (with explicit trigger)

**Reason**: The bug-fix targets a code path that doesn't exist on fork. Adding `memory_export` and the bridge plumbing is much larger than the upstream patch — it's a fork-side feature gap, not a fork-side bug. Hand-porting `0c31cbad4` would require first deciding: (a) implement `memory_export` MCP tool on fork (substantial), (b) accept that fork's CLI `memory export` doesn't work and fix the CLI to use a different export path, or (c) wholesale port `memory-bridge.ts`/`memory-initializer.ts` from upstream (cross-cutting against fork's archivist/memory-router restructure).

**Explicit trigger**: keep-pending until a separate ADR decides what fork's `memory_export` surface should look like. Re-evaluate after that ADR lands. If the decision is to vendor upstream's memory-tools `memory_export` + `listEntries(includeContent)`, this row converts to `hand-ported`. If the decision is to keep fork's memory architecture distinct, this row converts to `superseded-by-local`.

**Proposed ledger row update**: `pending | — | 0252 | KEEP-PENDING per 2026-05-25 audit: fork memory architecture diverges substantially (no memory_export MCP tool; no memory-bridge.ts / memory-initializer.ts; restructured memory/ subtree). Trigger: separate ADR deciding fork's memory_export surface. Re-eval after that ADR.`

---

### `bc1f587c0` 2026-05-21 — fix(mcp): #2086 — auto-init ruvllm WASM in loadRuvllmWasm

**Upstream content** (6 files, +196/-4): `loadRuvllmWasm()` now calls `await mod.initRuvllmWasm()` (the init is idempotent — early-returns on `_wasmReady`). New `loadRuvllmWasmModule()` helper for `ruvllm_status` diagnostic path. CI smoke `smoke-ruvllm-wasm-auto-init.mjs` (12 invariants).

**Fork state**:
- `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/ruvllm-tools.ts` lines 29-31: `loadRuvllmWasm()` just `return import(...)` — no `initRuvllmWasm()` call (has the bug).
- `forks/ruflo/v3/@claude-flow/cli/src/ruvector/ruvllm-wasm.ts` has `initRuvllmWasm()` (line 103) and IS called inside individual `createSonaInstant`/`createMicroLora`/`createHnswRouter` paths (lines 169, 227, 283, 350) — partial coverage that masks the symptom for tools that go through `create*`.
- `ruvllm_status` would still report `wasm.initialized=false` after any non-`create*` tool path.

**Recommendation**: **pick**

**Reason**: Small (~10 lines) defensive fix. `initRuvllmWasm` is idempotent, so cost after first call is one boolean. Fork has the bug at `loadRuvllmWasm()` even though some paths mask it. Pick along with the smoke for regression protection.

**Proposed ledger row update**: `hand-ported | <new-fork-sha> | 0252 | loadRuvllmWasm now folds in await initRuvllmWasm (idempotent); separate loadRuvllmWasmModule() for ruvllm_status diagnostic path; smoke ported. Fork had the bare-import bug.`

---

## Notes on the "silently-landed" category

After grep-by-SHA and grep-by-subject (first 6 words) against `forks/ruflo` for all 14 SHAs, **none** had a corresponding fork commit by either trailer or subject match. The `silently-landed` category is empty for this batch.

## Notes on the "defer to next sync" framing

The original Batch S deferrals used "per-commit triage on next sync" as the next-action. This audit replaces that placeholder for 13 of 14 rows. The one remaining `pending` row (`0c31cbad4`) now carries an explicit ADR-triggered next-action rather than a calendar trigger.
