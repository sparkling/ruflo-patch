# Batch-U Disposition — Slice D: memory + security + cross-area bug clusters

ADR-0313 Batch-U upstream sync. Read-only analysis. Fork = `/Users/henrik/source/forks/ruflo`
(branch `main`, 1637 commits ahead of merge-base `43c8fd79`). All 16 commits are upstream-only
(none are ancestors of fork HEAD). Upstream content read via `git show <SHA>` only.

## Central architectural fact (governs most memory verdicts)

The fork **reorganized the memory stack** away from the files upstream's memory fixes target:

- Upstream's `v3/@claude-flow/cli/src/memory/memory-initializer.ts`, `memory-bridge.ts`,
  and `embedding-quantization.ts` **do not exist in the fork's source** (only stale `dist/`
  artifacts remain). The fork's memory lives in a separate **`v3/@claude-flow/memory/`**
  package (`rvf-backend.ts`, `agentdb-backend.ts`, `embedding-pipeline.ts`,
  `auto-memory-bridge.ts`, `resolve-config.ts`).
- The fork's `embedding-pipeline.ts` (ADR-0234/0239/0094) drives embeddings itself
  (`@huggingface/transformers` → `@xenova/transformers` → `ruvector`) and **throws when no
  real embedder is available** (`feedback-no-fallbacks` removed the silent mock fall-through).
  There is **no silent agentdb mock-embedder path** in the fork's own pipeline.
- The fork's `agentdb-backend.ts` uses an **`embeddingGenerator` injection pattern**
  (lines 153/282/454-455/510-511): it computes vectors with its own ONNX pipeline and passes
  **pre-computed embeddings** to agentdb. agentdb's internal `EmbeddingService.embed()`
  (the mock-fallback path) is bypassed for writes.
- Embedding model: **mpnet 768-dim, full HF name `Xenova/all-mpnet-base-v2`** on purpose
  (ADR-0068/0069). Upstream's MiniLM-384 short-name registry handling is a divergence the
  fork deliberately rejected.

Consequence: most upstream memory fixes are **moot or fork-ahead**. The exceptions are the
two real bugs that live in a file the fork DID keep at the same path
(`v3/@claude-flow/memory/src/auto-memory-bridge.ts`): `resolveAutoMemoryDir` (#2282) and
`parseMarkdownEntries` (#2283).

## Disposition table

| SHA | type(area) | subject | VERDICT | rationale + fork-evidence | target / approach |
|---|---|---|---|---|---|
| eaaf59d1b | fix(multi) | community bug batch — session/hive/statusline (#2307/#2297/#2337) | **HAND-PORT (partial)** | 3 sub-fixes, decompose ↓ | see sub-rows |
| ↳ #2307 | fix(session) | atomic writes to current.json + corrupt self-heal | **HAND-PORT** | Fork's `session.cjs` + generator use bare `fs.writeFileSync` (lines 51/61/63/73/78/91/104/107) + bare `JSON.parse` — same write-race/corruption bug. Fork ALREADY knows the pid-temp+atomic-rename pattern (helpers-generator.ts:803-807) but applies it to the RVF path, not session — exactly the "session.js was missed in the sweep" situation. | `v3/@claude-flow/cli/src/init/helpers-generator.ts` `generateSessionManager()` (fork generates the .cjs, don't patch the static file) |
| ↳ #2297 | fix(hive-mind) | await spawned claude before returning | **HAND-PORT** | Fork's `spawnClaudeCodeInstance` (hive-mind.ts:830) has the bug verbatim: `claudeProcess.on('exit',…)` at :1026 for logging only, returns `{success:true,promptFile}` immediately (:1045/:1056/:1069), `stdio:'inherit'` (:996). Child orphaned. User uses hive-mind for councils → real impact. | `v3/@claude-flow/cli/src/commands/hive-mind.ts` — await child exit/error before returning |
| ↳ #2337 | fix(statusline) | resolve installed bin + cache TTL 10s→60s | **SKIP-fork-ahead** | Fork's `statusline-generator.ts` already resolves the installed bin (walks node_modules for `ruflo` umbrella, ADR-0301-aware, :680-693) and does **not** spawn `npx @claude-flow/cli@latest` per render. The storm's root cause (npx @latest re-resolution) is absent. | — |
| 16a55f7a5 | chore(security) | Socket.dev baseline doc + remove pages.yml | **SKIP-fork-ahead / SKIP-by-policy** | (a) `docs/security/socket-baseline.md` triages Socket alerts on the **public-npm `claude-flow@3.10.40`** + `ruvnet/ruflo` repo — fork ships @sparkleideas on Verdaccio (not Socket-scanned). (b) pages.yml removal is upstream CI hygiene (Pages 404 on ruvnet repo); fork owns CI (ADR-0302). | — (OBSERVATION: fork has its own `.github/workflows/pages.yml` which may be similarly broken — worth a separate fork CI cleanup, not this batch) |
| 0740ec741 | chore(release) | 3.10.38 — CI/witness/security cluster | **SKIP-by-policy** | PURE version bumps (5 files: package.json/lock/README only, 0 code). Fork owns versioning (ADR-0302). The real underlying fix it *announces* (`@noble/ed25519` added to security package deps for TS2307) is a **coupling note for the 1c98cbee6 port** — see PICK details. | — |
| d065b1592 | chore(release) | 3.10.37 — auto-memory cluster | **SKIP-by-policy** | Pure version bump for the facec4ccc cluster. Underlying fix dispositioned under facec4ccc. | — |
| facec4ccc | fix(memory) | auto-memory cluster — frontmatter/`_`/plugin/embed (#2281-#2285) | **HAND-PORT (partial)** | 5 sub-fixes, mixed. Decompose ↓ | see sub-rows |
| ↳ #2281 | fix(embeddings) | default model full-name→short-name | **SKIP-fork-ahead** | Fork defaults to `Xenova/all-mpnet-base-v2` (embeddings.ts:619, ADR-0069) — full name ON PURPOSE. Upstream's short-name MiniLM registry fix would CLOBBER ADR-0069. | — |
| ↳ #2282 | fix(memory) | `resolveAutoMemoryDir` replace `_`→`-` | **HAND-PORT** | Fork has the OLD buggy `.replace(/\//g,'-')` (auto-memory-bridge.ts:771). Same file path as upstream. Underscore project paths (e.g. `RX_ERP`) mismatch the project key. Clean one-line apply. | `v3/@claude-flow/memory/src/auto-memory-bridge.ts:771` → `.replace(/[\/_]/g,'-')` |
| ↳ #2283 | fix(memory) | `parseMarkdownEntries` frontmatter + fallback | **HAND-PORT** | Fork has the OLD version (auto-memory-bridge.ts:803): splits only on `## `, no frontmatter strip, no single-entry fallback → Claude Code native auto-memory files (frontmatter + free body) parse to ZERO entries and silently drop. **Directly relevant**: user's MEMORY.md is frontmatter-style. Clean apply (upstream diff is self-contained, same function). | `v3/@claude-flow/memory/src/auto-memory-bridge.ts:803` — port the 3-tier strip-frontmatter/split/fallback rewrite verbatim |
| ↳ #2284 | fix(hook) | hook workingDir env not PROJECT_ROOT | **HAND-PORT (adapt)** | Fork's `.claude/helpers/auto-memory-hook.mjs` hardcodes `workingDir: PROJECT_ROOT` (:283, :373). Upstream switches to `process.env.CLAUDE_FLOW_CWD || process.cwd()`. Fork rebrand → use `RUFLO_CWD`/`CLAUDE_FLOW_CWD` || cwd. Fork's hook is heavily diverged (dist paths, .claude-flow/data) so adapt, don't cherry-pick. | `.claude/helpers/auto-memory-hook.mjs:283,373` |
| ↳ #2285 | fix(hook) | global-npm `resolveBundledFile` fallback | **SKIP-fork-ahead (likely) — FLAG** | Upstream adds a global-npm-prefix lookup so `npm i -g ruflo` finds the bundled `@claude-flow/memory`. Fork ships via **plugin marketplace (@sparkleideas, ADR-0301)** + a different 4-strategy lookup (:135-159) anchored on PROJECT_ROOT/dist. The `npm i -g` global-prefix case is upstream's distribution model, not the fork's. Low applicability; verify the fork's plugin-install path resolves the memory pkg before porting. | (verify only) — fork distribution differs |
| 844f68dbe | fix(memory) | drop agentdb "Falling back to mock embeddings" warning cluster | **HAND-PORT** | Fork's `log-filters.ts` exists but ONLY suppresses `[AgentDB Patch] Controller index not found` — NOT the 9-line mock-fallback cluster. The warning originates in **agentdb's `EmbeddingService.js`** (a dep the fork bundles + calls via controller-registry.ts:611 `getEmbeddingService()`), so it CAN still print on macOS arm64 w/o libvips — **directly relevant to the user's setup**. After the fork's embeddingGenerator injection, the warning is cosmetic/wrong. Exact agentdb prefixes match. | `v3/@claude-flow/cli/src/log-filters.ts` (add the 9 prefixes to the drop-list) + the inline filter in the fork's MCP-stdio bin path (`bin/cli.js` / `v3/@claude-flow/cli/bin/cli.js`). Keep tight prefix-match (audit_1776483149979 lesson). |
| 9db902489 | fix(memory) | rescue agentdb mock-embedder when ruvector ONNX is live | **SKIP-fork-ahead** | Task flagged "directly relevant" — but the fork's architecture **already solves this structurally and better**. (1) Target file `cli/src/memory/memory-bridge.ts` doesn't exist in fork source. (2) Fork's `agentdb-backend.ts` injects its own `embeddingGenerator` and computes vectors itself BEFORE handing to agentdb — agentdb's `embed()`/`mockEmbedding()` is never the write path. Upstream's monkey-patch-after-the-fact rescue is superseded by the fork's inject-the-generator design. | — (fork design supersedes; no port) |
| 1c98cbee6 | feat(security) | P1 for ADR-144/145/146 | **HAND-PORT (discretionary, partial) — FLAG** | Highest-judgement call. 3 sub-components, all NET-NEW (no fork conflict) but **off-by-default future-facing FEATURES, not bug fixes**. Decompose ↓ | see sub-rows + PICK details |
| ↳ ADR-144 P1 | feat(security) | AgentAuthorizationPropagator | **HAND-PORT (discretionary)** | New file `security/src/authorization/propagator.ts` — no fork collision (fork security pkg is CVE/DDD-shaped, no `authorization/`). Self-contained AuthScope primitive, off until v4. | `v3/@claude-flow/security/src/authorization/propagator.ts` (new) + `index.ts` export (adapt to fork export style) + test |
| ↳ ADR-145 P1 | feat(security) | PluginIntegrityVerifier (Ed25519) | **HAND-PORT (discretionary)** | New file `security/src/plugins/integrity-verifier.ts` + `cli/src/plugins/trust/trust-anchors.json`. `@noble/ed25519` already in fork root+cli package.json. Relevant to the fork's plugin marketplace (ADR-0301, ~33 plugins). NOTE: requires `@noble/ed25519` ALSO added to `security/package.json` deps (see 0740ec741 coupling). | `v3/@claude-flow/security/src/plugins/integrity-verifier.ts` (new) + trust-anchors.json + `security/package.json` dep + index export + test |
| ↳ ADR-146 P2 | feat(security) | guardrail call site in mcp-client | **SKIP (incomplete dep)** | Patches `cli/src/mcp-client.ts` `callMCPTool` to call `applyContentBoundaryGuardrail` → lazy-resolves `ToolOutputGuardrail` from `@claude-flow/security`. Fork has **NO `ToolOutputGuardrail`** (ADR-131 never landed in fork). Patch would resolve to no-op (graceful fallback) → inert. Don't port in isolation; needs ADR-131 guardrail class first. | — (port ADR-131 first if this layer is wanted) |
| 08bf1cf32 | docs(adr) | 3 Proposed security ADRs (144/145/146) | **SKIP-fork-ahead** | Pure upstream ADR docs; no code. Fork maintains its OWN ADR corpus (ruflo-patch ADR-NNNN + v3/implementation/adrs ADR-0xx). Importing upstream ADR text verbatim collides with fork numbering. If the fork adopts 1c98cbee6, write a fork ADR. | — (write fork ADR if adopting the security work) |
| 920ba4b04 | fix(supply-chain) | correct tracking issue ref #2270→#2268 | **SKIP-by-policy** | Cosmetic bookkeeping: fixes an UPSTREAM issue-number typo + `github.com/ruvnet/ruflo` URL in `accepted-findings.json`. Fork maintains its own findings independently and doesn't track ruvnet issue numbers (`feedback-upstream-issues`). | — |
| 07b4c8609 | release | 3.10.33 + CI regression guards (#2267/#2257/#2256) | **SKIP-by-policy** | Version bumps (own, ADR-0302) + NEW CI guards (`smoke-workflows-yaml.mjs`, `smoke-router-regex.mjs`) = CI infra the fork owns. Underlying fixes = 4c0144371 (dispositioned). NOTE: `smoke-router-regex.mjs` is the companion test for #2257 — wire an equivalent if #2257 is ported (`feedback-always-wire-tests-into-cicd`). | — |
| 4c0144371 | fix(multi) | CI/router/ONNX cluster (#2267/#2257/#2256/#2253) | **HAND-PORT (partial)** | 4 sub-fixes, decompose ↓ | see sub-rows |
| ↳ #2257 | fix(router) | unanchored regex mis-route + confidence overclaim | **HAND-PORT** | Fork's `generateAgentRouter` (helpers-generator.ts:211) has the bug verbatim: pipe-delimited `TASK_PATTERNS` via `new RegExp(pattern,'i')`, ZERO `\b` anchors (count=0), hardcoded `confidence:0.8`/`0.5`. Tokens `ci`/`cd`/`ui`/`api` match inside words. Router IS LIVE — generated hook-handler calls `router.routeTask` at :481 + :564 (emits the `[INFO] Routing task` signal the project CLAUDE.md documents). | `v3/@claude-flow/cli/src/init/helpers-generator.ts` `generateAgentRouter()` — token-list schema + `\b` on single tokens, 0.8→0.6 / 0.5→0.3. Adapt to fork's "Ruflo Agent Router" branding. |
| ↳ #2256 | fix(cli) | `--version` fast-path before heavy import | **SKIP-fork-ahead (verify) — FLAG** | Upstream short-circuits `--version` in bin/cli.js before ONNX init (60s→31ms). Fork has its own bin/cli.js (both root + v3) and its own ADR-0302 toolchain/startup. Did not find a clobbering conflict but did not confirm the fork already fast-paths --version. Low cost if absent. | (verify fork bin/cli.js `--version` timing) |
| ↳ #2253 | fix(mcp) | stdio stdout pollution — embedder progress→stderr | **SKIP-fork-ahead (likely)** | Upstream redirects embedder progress prefixes (`Loading model:`, `Downloading:`, etc.) log→stderr in log-filters + bin. Fork's log-filters.ts header documents it ALREADY redirects parallel-embedder progress to stderr ("3. … redirect … parallel embedder … to stderr") — the fork's stdio-hygiene diverged and appears to cover this. Overlaps 844f68dbe scope. | (verify fork bin stdio filter covers these prefixes) |
| ↳ #2267 | fix(ci) | v3-ci.yml YAML parse (unquoted `:`) | **SKIP-by-policy** | Upstream-specific CI YAML fix; fork owns its v3-ci.yml/ci.yml (ADR-0302). | — |
| 427308308 | feat(cli) | #2105 CLAUDE_FLOW_DB_PATH + #2058 team gateway checklist | **HAND-PORT (partial) — FLAG** | #2105: fork's `memory.ts` already has `--path`/`-p` flags (:805,:1352) but NO env-var tier (`CLAUDE_FLOW_DB_PATH`/`RUFLO_DB_PATH`) and no `resolveDbPath()` 3-tier precedence. Partial: add `RUFLO_DB_PATH` (rebrand) with `--path > env > default`. `resolveDbPath()` lands in `resolve-config.ts` (fork has no memory-initializer.ts). #2058: `docs/TEAM-GATEWAY-CHECKLIST.md` references dual-mode Claude/**Codex** handoff → SKIP (`feedback-no-codex-mentions`). | `v3/@claude-flow/cli/src/commands/memory.ts` + `v3/@claude-flow/memory/src/resolve-config.ts` (env tier, rebranded). SKIP the Codex checklist doc. |
| 6778628e9 | fix(security) | bounds-check decodeEmbedding + env-var CI guard (#2144) | **SKIP-fork-ahead (Part 1) / SKIP-by-policy (Part 2)** | Part 1: fork has NO `embedding-quantization.ts` (git log confirms it never landed; only upstream commits touch it). Fork's `decodeEmbedding` is imported from the **`agentdb` dependency** (`agentdb/encoders/scalar-int8-encoder`, agentdb-tools.ts:2881) — the hardened function lives in agentdb, outside this fork's source. Part 2: `audit-env-var-precedence.mjs` CI guard — fork owns CI (ADR-0302); fork has audit-supply-chain/audit-hook-handler but not this one. | Part 1 → belongs in the **agentdb fork** if anywhere, not ruflo. Part 2 → fork CI-owner call (low priority). |
| c9ec2b607 | merge | PR #2122 (#2120 memory-status-backfill) | **SKIP-merge** | Merge commit for cfc341706. | — |
| cfc341706 | fix(memory) | #2120 accept NULL status (legacy DBs) + 3.7.0 | **SKIP-fork-ahead** | Targets `memory-bridge.ts`/`memory-initializer.ts` `WHERE status='active'` sql.js path — neither file exists in fork source. Fork's storage = `@claude-flow/memory` RVF/agentdb-backend; `memory_entries` legacy-DB sql.js query the fix patches is gone. status.ts `isInitialized` part also moot: fork's isInitialized already checks `.claude-flow/config.json` (status.ts:48), diverged from upstream's config.yaml requirement. | — |

## PICK / HAND-PORT details

### HIGH VALUE — real bugs present in the fork, clean(ish) ports

**1. facec4ccc #2283 — `parseMarkdownEntries` frontmatter+fallback** — `v3/@claude-flow/memory/src/auto-memory-bridge.ts:803`.
Fork has the old `## `-only splitter; Claude Code native auto-memory files (YAML frontmatter +
free body) parse to **zero entries** and silently drop on import. Directly relevant: the user's
MEMORY.md is frontmatter-style. Port the upstream 3-tier rewrite verbatim (strip frontmatter →
split on `## ` → single-entry fallback using `frontmatter.name`). Conflict risk: **low** — the
fork's function body matches the pre-fix upstream body exactly; the diff applies cleanly.

**2. facec4ccc #2282 — `resolveAutoMemoryDir` underscore paths** — same file, `:771`.
One-line: `.replace(/\//g,'-')` → `.replace(/[\/_]/g,'-')`. Conflict risk: **none**.

**3. eaaf59d1b #2307 — session atomic writes + corrupt self-heal** — `v3/@claude-flow/cli/src/init/helpers-generator.ts` (`generateSessionManager()`, ~:76-200).
Fork generates `session.cjs` from this generator; all session writes are bare `fs.writeFileSync`
(8 sites) + bare `JSON.parse` (no try/catch). Add an `atomicWrite(file,data)` helper
(`${file}.${pid}.tmp` → `rename`) — the fork already uses this exact idiom for the RVF path
(:803-807), so lift it into the session helper; wrap `restore()`'s `JSON.parse` in try/catch to
self-heal. Conflict risk: **low-medium** — must edit the generator (the .cjs is emitted), and
keep the fork's CJS style.

**4. eaaf59d1b #2297 — hive-mind await spawned claude** — `v3/@claude-flow/cli/src/commands/hive-mind.ts` (`spawnClaudeCodeInstance`, :830).
The 3 early `return {success:true,promptFile}` sites (:1045/:1056/:1069) fire before the child
exits; the existing `.on('exit')` logging (:1026) never runs and the child is orphaned. Wrap the
spawn in a Promise that resolves on the child's `exit`/`error` and `await` it before returning
(matches upstream's fix shape). Conflict risk: **low-medium** — fork's function is "ported from
v2.7.47" and structurally matches upstream's; verify the interactive vs `-p`/non-interactive
branch both await.

**5. 4c0144371 #2257 — router unanchored regex + confidence overclaim** — `v3/@claude-flow/cli/src/init/helpers-generator.ts` (`generateAgentRouter`, :211).
Router is LIVE (hook-handler calls `router.routeTask` at :481/:564, emits the documented
`[INFO] Routing task` signal). Port upstream's token-list-schema + `\b`-anchors rewrite,
0.8→0.6 / 0.5→0.3. Conflict risk: **medium** — fork's pattern map is the same pipe-string shape
but branded "Ruflo Agent Router"; re-author the patterns in the fork's voice rather than a literal
cherry-pick. Wire a `smoke-router-regex`-equivalent into the fork's acceptance runner if ported
(companion test from 07b4c8609).

**6. 844f68dbe — suppress agentdb mock-fallback 9-line warning** — `v3/@claude-flow/cli/src/log-filters.ts` (+ MCP-stdio inline filter in the bin path).
Fork's log-filters only drops `[AgentDB Patch] Controller index not found`. The mock-fallback
cluster still fires from agentdb's `EmbeddingService.js` on macOS arm64 w/o libvips (user's
machine). Add the 9 exact prefixes to the drop-list (tight-match, per audit_1776483149979).
Conflict risk: **low** — additive to an existing filter. Note: the fork already generates vectors
via its own pipeline, so the warning is cosmetic/wrong (safe to suppress).

### DISCRETIONARY — net-new security capability (judgement call for the queen)

**7. 1c98cbee6 ADR-144 P1 (propagator.ts) + ADR-145 P1 (integrity-verifier.ts)** — `v3/@claude-flow/security/src/{authorization/propagator.ts, plugins/integrity-verifier.ts}` + `cli/src/plugins/trust/trust-anchors.json`.
Net-new files, no fork collision, `@noble/ed25519` already present at root+cli. BUT: these are
**off-by-default future (v4) features, not bug fixes**, which sits in tension with the fork's
`feedback-no-dormant-off-by-default-flags` posture (ship ON + self-inert, or don't ship). If
adopted: (a) adapt `security/src/index.ts` exports to the fork's export style; (b) **add
`@noble/ed25519` to `v3/@claude-flow/security/package.json` deps** (this is the real content of
the 0740ec741 bump — the security package builds standalone and would TS2307 without it);
(c) ADR-145's plugin integrity is the more fork-relevant half (ties to the ADR-0301 marketplace).
**ADR-146 P2 (mcp-client guardrail) — do NOT port in isolation**: it depends on `ToolOutputGuardrail`
(ADR-131) which the fork lacks, so it resolves to a no-op. Write a fork ADR before adopting any of
this (don't import upstream's 08bf1cf32 ADR docs verbatim). Conflict risk: **medium** (export-style
adaptation + dep + the off-by-default policy question).

### PARTIAL — rebrand/adapt

**8. 427308308 #2105 — `RUFLO_DB_PATH` env tier** — `v3/@claude-flow/cli/src/commands/memory.ts` + `v3/@claude-flow/memory/src/resolve-config.ts`.
Fork has the `--path` flag but no env tier. Add `RUFLO_DB_PATH` (rebranded from
`CLAUDE_FLOW_DB_PATH`) with `--path > env > default` precedence; `resolveDbPath()` goes in
`resolve-config.ts` (no memory-initializer.ts in fork). SKIP the bundled #2058
`TEAM-GATEWAY-CHECKLIST.md` (Codex handoff content — `feedback-no-codex-mentions`). Conflict
risk: **low-medium** (the flag plumbing already exists; just add the env-read + helper).

**9. facec4ccc #2284 — hook workingDir env** — `.claude/helpers/auto-memory-hook.mjs:283,373`.
Replace `workingDir: PROJECT_ROOT` with `process.env.RUFLO_CWD || process.env.CLAUDE_FLOW_CWD || process.cwd()`.
Conflict risk: **low** but the fork's hook is heavily diverged — adapt the two assignments, don't
cherry-pick the file.

## Items explicitly NOT ported (with reason)

- **9db902489** (mock-embedder rescue) — fork's `embeddingGenerator` injection supersedes it (no port).
- **cfc341706 / c9ec2b607** (#2120 NULL status) — targets removed sql.js `memory_entries` path.
- **6778628e9 Part 1** (decodeEmbedding) — function lives in the `agentdb` dep, not fork source.
- **facec4ccc #2281** (MiniLM short-name) — would clobber ADR-0069 mpnet-full-name.
- **eaaf59d1b #2337** (statusline storm) — fork already resolves installed bin, no npx@latest.
- **4c0144371 #2253/#2256/#2267** — stdio hygiene already covered / CI-owned / verify-only.
- **08bf1cf32** (security ADR docs), **16a55f7a5** (Socket/pages), **920ba4b04** (issue-ref typo),
  **0740ec741 / d065b1592 / 07b4c8609** (release bumps) — docs/CI/version policy (own).
