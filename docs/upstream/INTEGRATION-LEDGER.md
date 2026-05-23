# Upstream Integration Ledger

Single append-only record of every upstream `ruvnet/*` commit we have a
disposition on, across all 5 forks (`ruflo`, `agentic-flow`, `ruvector`,
`ruv-FANN`, `agentdb`). One row per upstream SHA. Authored to consolidate
what was previously scattered across per-sync ADRs (ADR-0111, ADR-0162,
ADR-0186) and the `docs/plans/upstream-sync-2026-05-09-batch-*.md` files.

## Disposition vocabulary

| Disposition | Meaning |
|---|---|
| `hand-ported` | Applied on our fork's `main` with content equivalence to the upstream commit. The local SHA(s) are the hand-port commits. Patch-id may differ from upstream because hand-ports drop upstream's `package.json` version-bump hunks (our fork has an independent `-patch.N` chain), but the source-code substance is the same. |
| `skip-by-policy` | Explicit decision not to apply (e.g. ADR-0088 spawn-only policy means daemon spawn↔fork churn is locked out). Local SHA is `—`. |
| `skip-mechanical` | Content is mechanically subsumed by another commit, or is pure churn we never want (NAPI binary regen we rebuild ourselves, submodule pin, lockfile-only). Local SHA is `—`. |
| `superseded-by-local` | Our fork moved past the upstream change independently. E.g. plugin contract v0.2.0 upstream → fork already at v0.2.17 via its own work. |
| `superseded-by-adr` | Replaced by a numbered local ADR. Reference the ADR in Notes. |
| `retargeted` | Applied on a *different* fork than upstream emitted it. Used for the agentic-flow→forks/agentdb pivot post-ADR-0161. |
| `pending` | Known unintegrated; awaiting decision or execution. Local SHA is `—`. |
| `reverted` | Was applied but later reverted (the disposition changed after landing). Local SHA columns the revert commit(s) and any superseding work. |

## How to use this ledger

- **One row per upstream SHA.** Never modify a row in place after a
  disposition lands; if reality changes, *append* a row that supersedes it
  and link them in Notes (`supersedes row 2026-05-08 …`).
- **Reference the authorizing ADR** in the `ADR` column (e.g. `0186`).
  That ADR is the audit trail for why this disposition was chosen.
- **Trailer match is the strongest evidence.** Audit a hand-port via
  `git log forks/<fork>/main --grep="cherry picked from commit <UP>"`.
  When no trailer exists, fall back to subject-line + patch-id audit
  (with `:(exclude)package.json :(exclude)ruflo/package.json` to strip
  upstream's version-bump hunks).
- **Per-sync ADRs append rows here** as part of their close-out, in
  addition to maintaining their own batch tables. The ADR batch tables
  are point-in-time runbooks; this ledger is the cumulative record.

## ruflo

Tracked window starts with the May 2026 sync delta (ADR-0186). Earlier
upstream commits absorbed via ADR-0111 / ADR-0162 v1 landed batches are
not seeded here; backfill as encountered.

| Upstream SHA | Date | Subject | Disposition | Local SHA | ADR | Notes |
|---|---|---|---|---|---|---|
| `a10a13e62` | 2026-05-03 | resolve five May 1-3 issues (incl. #1691 daemon spawn→fork) | skip-by-policy | — | 0186 | ADR-0088 spawn-only locked |
| `69e72d2e4` | 2026-05-05 | #1766 break IPC pipe so daemon survives parent | skip-by-policy | — | 0186 | ADR-0088 spawn-only locked |
| `f8f4cd4bc` | 2026-05-04 | security: untrack .env + broaden .gitignore | hand-ported | `f9655cc91` | 0186 | cherry-pick trailer |
| `bc399dc9a` | 2026-05-03 | sec: tighten npm overrides (protobufjs/tar/uuid) | hand-ported | (root `package.json` overrides) | 0186 | content-equivalent in root |
| `0535c3823` | 2026-05-03 | sec: cap MCP stdin buffer at 10MB | hand-ported | `bbf9a0bcb` | 0186 | cherry-pick trailer |
| `5073f5673` | 2026-05-03 | drop shell from git calls in statusline | hand-ported | `a71b0558f` | 0186 | cherry-pick trailer |
| `fb256ac59` | 2026-05-03 | denylist loader-hijack env vars in terminal_create | hand-ported | `4b3373663` | 0186 | cherry-pick trailer |
| `de96b0eed` | 2026-05-03 | restrict file mode 0600 on session/memory/terminal | hand-ported | `f57574e8a` | 0186 | mode-0600 at `memory-router.ts:889` |
| `bbe53a21c` | 2026-05-03 | regression tests for validateEnv + fs-secure | hand-ported | `6329aedf6` | 0186 | cherry-pick trailer |
| `d9fd35956` | 2026-05-03 | fetch timeouts on verify + IPFS HEAD probe | hand-ported | `52dc4acca` | 0186 | cherry-pick trailer |
| `73babfb06` | 2026-05-03 | close shell injection in github-tools MCP | hand-ported | `dc2a22958` | 0186 | cherry-pick trailer |
| `c1b57e4fd` | 2026-05-03 | close shell injection in update/executor | hand-ported | `f639ba526` | 0186 | cherry-pick trailer |
| `3baebe177` | 2026-05-03 | github-safe.js command injection close | hand-ported | `5ad2f805b` | 0186 | manual transcribe to `.mjs`/`.js` |
| `df49b5176` | 2026-05-04 | ruflo-adr plugin contract v0.2.0 | superseded-by-local | (n/a) | 0186 | fork plugin contracts already at v0.2.17/v0.3.17 |
| `ba92c5612` | 2026-05-05 | cli-core split (lite + umbrella) | hand-ported | `1f4d13097`, `d9275844b` | 0186 | F-2 phase landed |
| `003ce127b` | 2026-05-05 | archive legacy v2/ under archive/v2/ | hand-ported | `ea86b505c` | 0186 | patch-id MATCH (exact 6,442-file rename) |
| `fd4c3cb3c` | 2026-05-05 | Windows daemon-survives-parent-exit CI for #1766 | hand-ported | `64556ceb9` | 0186 | dropped pkg.json bumps |
| `d5fbb3bc4` | 2026-05-05 | hooks $TOOL_INPUT shell injection close (#1747) | hand-ported | `58002b702` | 0186 | cherry-pick trailer |
| `367313824` | 2026-05-06 | aidefence retry + doctor probe (#1807, #1813) | hand-ported | `849ca9560` | 0186 | cherry-pick trailer |
| `ed6d847fa` | 2026-05-06 | bcrypt → bcryptjs (tar CVE chain) | hand-ported | (security/`package.json` `bcryptjs: ^3.0.3`) | 0186 | content-equivalent |
| `b9e2eb37e` | 2026-05-06 | vitest pin ^4.0.16 (#1609, #1819) | hand-ported | `fe0066437` | 0186 | cherry-pick trailer |
| `4f2f68d52` | 2026-05-03 | embeddings: graceful agentic-flow fallback (alpha.13) | hand-ported | `a23875099` | 0186 | trailer match (C+D #1) |
| `53409aba5` | 2026-05-03 | embeddings: handle agentic-flow shape change (alpha.14) | hand-ported | `0520a8ebc` | 0186 | trailer match (C+D #2) |
| `21f668c55` | 2026-05-03 | implement ADR-094 transformers migration + ADR-095 gap tracking | hand-ported | `fa15160e5` | 0186 | trailer match (C+D #4) |
| `c32ddead2` | 2026-05-03 | ADR-094 migration plan for @xenova → @huggingface/transformers | hand-ported | `37cc087af` | 0186 | trailer match (C+D #5) |
| `bd55cd7cb` | 2026-05-03 | perf(memory-bridge): parallelize post-init wiring | hand-ported | `f81630ba4` | 0186 | bundled in C+D post-extraction hand-port |
| `6b46946dc` | 2026-05-03 | intelligence: content-hash dedup + hoist trigram cache | hand-ported | `c72c2f318` | 0186 | trailer match (C+D #7) |
| `122193a45` | 2026-05-03 | memory: show active embedding provider + HNSW status | hand-ported | `57abe57c8` | 0186 | trailer match (C+D #8) |
| `3eb6b4d65` | 2026-05-03 | memory: content-hash dedupe in memory_import_claude | hand-ported | `8d2bfa91e` | 0186 | trailer match (C+D #9) |
| `0377945c9` | 2026-05-03 | memory: make `memory init` idempotent | hand-ported | `d23f2a883` | 0186 | trailer match (C+D #10) |
| `d031c3d13` | 2026-05-03 | agentdb hierarchical + causal-edge + causal-node delete MCP | hand-ported | `bd33cf54f` | 0186 | trailer match (C+D #11) |
| `966335022` | 2026-05-03 | @claude-flow/memory@alpha.15 #1867 unblock install on Node 26 | hand-ported | `0a113d1bc` | 0186 | trailer match (C+D #12) |
| `d6936bae3` | 2026-05-03 | @claude-flow/memory bump to alpha.15 | hand-ported | `3acd05c9c` | 0186 | trailer match (C+D #13) |
| `3e8781bd2` | 2026-05-03 | ci: no-better-sqlite3 install smoke for #1867 | hand-ported | `bd783ac8b` | 0186 | trailer match (C+D #14) |
| `e6478f9ab` | 2026-05-03 | ADR-096 encryption-at-rest design | hand-ported | `6e81ade13` | 0186 | trailer match (C+D #15, ADR-096 P0) |
| `cb9a9f346` | 2026-05-03 | ADR-096 Phase 1 — vault primitives + tests | hand-ported | `9efd76ee9` | 0186 | trailer match (C+D #16) |
| `98aa2560e` | 2026-05-03 | ADR-096 Phase 2 — wire vault into session-tools | hand-ported | `9c5d20921` | 0186 | trailer match (C+D #17) |
| `49c8019ed` | 2026-05-03 | ADR-096 Phase 3 — wire vault into terminal-tools | hand-ported | `a32dac032` | 0186 | trailer match (C+D #18) |
| `841365f64` | 2026-05-03 | ADR-096 Phase 4 — wire vault into memory DB writes/reads | hand-ported | `feb8210cd` | 0186 | trailer match (C+D #19) |
| `bbb90046e` | 2026-05-03 | ADR-096 status → Accepted, log Phase 1-4 | hand-ported | `3eaeeb864` | 0186 | trailer match (C+D #20) |
| `ccf58ea4d` | 2026-05-03 | ADR-096 Phase 5 — encryption-at-rest doctor status | hand-ported | `1b3fbd172` | 0186 | trailer match (C+D #21) |
| `f8cd1c9fe` | 2026-05-03 | chore(release): bump to 3.6.25 + regen witness | hand-ported | `7949b2ee3` | 0186 | trailer match |
| `62a6fc5fb` | 2026-05-03 | ADR-097 — federation-wide budget circuit breaker | hand-ported | `72ad22898` | 0186 | trailer match (C+D #22) |
| `7e1cc06df` | 2026-05-03 | ADR-097 Phase 1 — budget envelope + hop counter | hand-ported | `1f104fa61` | 0186 | trailer match (C+D #23) |
| `149ea30a4` | 2026-05-03 | ruflo-federation plugin docs for ADR-097 | hand-ported | `be94c68df` | 0186 | trailer match (C+D #24) |
| `9d4a9ea96` | 2026-05-03 | ADR-101 Federated Claims — cross-node work coordination | hand-ported | `0a23dcaee` | 0186 | trailer match (C+D #25) |
| `3ba0b6141` | 2026-05-03 | plugin-agent-federation CLAIMS_FOR_MESSAGE_TYPE entries | hand-ported | `80cf8ca47` | 0186 | trailer match (C+D #26) |
| `779eb309b` | 2026-05-03 | chore(witness): register ADR-101-C federation fix as #82 | skip-by-policy | — | 0186 | confirmed 2026-05-18: witness manifest is fork-local; upstream #82 register inapplicable |
| `1884ed101` | 2026-05-08 | alpha.12 batch resolve #1839-#1847 | hand-ported | `a8ede7ef1` | 0186 | dropped pkg.json bumps |
| `c67fa393d` | 2026-05-08 | alpha.13 persist headless + ab-test guard | hand-ported | `a31cf95b9` | 0186 | dropped pkg.json bumps |
| `d88c69dde` | 2026-05-08 | alpha.15 #1852 Windows shell-injection + #1853 daemon self-kill + #1854 memory path | hand-ported | `7d6a2cc65`, `0d4219518` | 0186 | full alpha.15 hand-port + dedicated `CLAUDE_FLOW_MEMORY_PATH` wiring |
| `f46e52f41` | 2026-05-08 | alpha.16 daemon crash recovery (#1855) | hand-ported | `8e19a6c0f` | 0186 | carries `(cherry picked from commit f46e52f41…)` trailer |
| `66f7f644d` | 2026-05-08 | alpha.17 supervisor (#1565) + mid-flight (#1856) + Windows tasklist (#1857) | hand-ported | `cecfe8a88` | 0186 | dropped pkg.json bumps |
| `f81630ba4` | 2026-05-09 | hand-port post-extraction symbols (picks #8/#9/#10) | hand-ported | `f81630ba4` (same SHA) | 0186 | commit *is* the hand-port; landed on fork main |
| `ea8cbf697` | 2026-05-08 | @claude-flow/embeddings alpha.16 Windows ERR_PACKAGE_PATH_NOT_EXPORTED | hand-ported | `58462cde6` | 0186 | trailer match (C+D #3) |
| `229d273a1` | 2026-05-05 | fix(init): #1744 honest defaults + runtime fallbacks (v3.6.28) | hand-ported | `7cdc33183` | 0186 | trailer match (F-1) |
| `b51b804fa` | 2026-05-06 | fix(doctor): clarify that --fix prints commands | hand-ported | `b83cc4e8f` | 0186 | trailer match (F-1) |
| `7bfd650ee` | 2026-05-06 | fix(init): make RuFlo attribution trailer opt-in | hand-ported | `02d5e66d1` | 0186 | trailer match (F-1) |
| `88f9fba5f` | 2026-05-06 | fix(doctor): surface config collision legacy JSON vs v3 YAML | hand-ported | `4797e2188` | 0186 | trailer match (F-1) |
| `48da302b3` | 2026-05-06 | fix(doctor): walk-up .git fallback for git-repo health check | hand-ported | `d0d2d62c0` | 0186 | trailer match (F-1) |
| `7cee60317` | 2026-05-06 | fix(init): skip writing .mcp.json when ruflo MCP registered | hand-ported | `e7a092761` | 0186 | trailer match (F-1) |
| `19a569b1a` | 2026-05-09 | feat(federation): ADR-097 phases 2.a/2.b/3-up/4 + ADR-104 transport (#1876) | hand-ported | `c4175be73` | 0186 | 9 conflicts resolved: 4 pkg.json bumps + pnpm-lock + 2 witness files → ours; ADR-097 doc → upstream Implementation Status table merged in |
| `3657a6936` | 2026-05-13 | fix(hooks): pre-bash TypeError + global-install MODULE_NOT_FOUND (#1944, #1943) | hand-ported | `d06459717` | 0186 | conflicts in v3-ci.yml (took upstream mcp-protocol-smoke job) + hook-handler.mjs (took upstream toolInput.command fix, kept our .mjs extension) |
| `434a8f95b` | 2026-05-13 | fix(memory): bridge + doctor honor CLAUDE_FLOW_MEMORY_PATH / config (#1945, #1946) | hand-ported | `7c5f0d61f` | 0186 | adapted: memory-bridge.ts deletion per ADR-0085 kept; doctor.ts imports `getMemoryRoot` from memory-router.ts (new public export) instead of removed memory-initializer.ts |
| `1884ed101` | 2026-05-08 | alpha.12 batch resolve #1839-#1847 (re-audited as consumer-only) | hand-ported | `a8ede7ef1` (consumer) | 0218 | **supersedes row 94** — the original disposition ("dropped pkg.json bumps") understated a partial cherry-pick: `a8ede7ef1` brought only the worker-daemon.ts consumer half (`processDispatchQueue`, +129 lines, byte-identical). The +55-line hooks-tools.ts producer hunk did not apply cleanly against the fork's post-ADR-093 F2 rewrite and was dropped, leaving the queue path dead end-to-end. Closed by ADR-0218 producer port (next row). |
| `1884ed101` | 2026-05-22 | producer half of upstream #1845 (hooks_worker-dispatch writes daemon-queue/<id>.json) | hand-ported | (this commit) | 0218 | re-port of upstream commit's `hooks-tools.ts` producer hunk that `a8ede7ef1` dropped; adapted to fork: `findProjectRoot()` (NOT upstream's deprecated `getProjectCwd()` — ADR-0100), preserved 'synthetic-completed' state alongside new 'mcp-only', validateText(context) imported from existing `validate-input.ts:177`. Confirmation tests in fork `__tests__/mcp-tools/hooks-worker-dispatch-producer.test.ts` + patch `tests/pipeline/daemon-queue-lifecycle.test.mjs`. |
| `5d40236b1` | 2026-04-06 | upstream ADR-073 stub-honesty hand-ports (hooks_explain matchScore + on-disk success-rate; hooks_pretrain real FS scan; hooks_intelligence-reset real teardown) | hand-ported | `98d10e489` | 0210 | item-1 hand-port of 3 hooks-tools.ts handlers per ADR-0210 Option B′ Disposition. Representative upstream SHA `5d40236b1` ("eliminate all remaining stubs") covers `hooks_pretrain`; `hooks_explain` matchScore + `hooks_intelligence-reset` teardown adapted from adjacent upstream ADR-073 v3.5.55–v3.5.59 work. Adapted to fork: `getProjectCwd()` → `findProjectRoot()` (ADR-0100); upstream's `memory-bridge` route → `routeMemoryOp` (memory-bridge deleted per ADR-0085); `loadRoutingOutcomes()` reads on-disk routing-outcomes instead of literal `0.87` success rate. Fork commit `98d10e489` "fix(mcp-tools): ADR-0210 per-handler stub honesty dispositions" lands all 3 hand-ports plus 8 fork-original disposition items (item-2 implements, item-3 deletions, item-4 mark-honestly, plus F-01-004/F-02-007/F-03-007/F-03-013 scope-extensions) in one batch. Confirmation tests in `forks/ruflo/v3/@claude-flow/cli/__tests__/mcp-tools/`. |
| `7ca28a759` | 2026-05-13 | fix(statusline): read installed version from plugin package.json (#1951) | hand-ported | `0f44bbe19` | 0186 | clean cherry-pick |
| `4680a2c04` | 2026-05-14 | fix(statusline): guard SQLite header read on encrypted memory.db (#1989) | hand-ported | `d062dc096` | 0186 | clean cherry-pick |
| `1f8971d16` | 2026-05-14 | fix(init): platform-aware statusLine command (#1948) (#1995) | hand-ported | `745e6a90e` | 0186 | clean cherry-pick |
| `aebaccbf9` | 2026-05-18 | fix(neural): add AbortSignal.timeout(30s) to pinJSONToIPFS POST | fork-local | `aebaccbf9` (same SHA) | 0186 | not an upstream pick — closes ADR-0162 follow-up #1 (fetch-timeout audit). Fork-original fix. |
| `5228ffc44` | 2026-05-18 | security: convert session-state writes to writeFileRestricted (0600) — ADR-0188 Option 1 attempt | reverted | `634747deb` (revert), `5be65f3bf` (Option 2 doc note) | 0188 | initial Option 1 attempt; reverted 2026-05-18 when ADR-0188 chose Option 2 (session JSON is project-local ephemeral, not credential material). See ADR-0188 §Decision Outcome. |
| `802dff517` | 2026-05-09 | ci: extend path filter to plugin witness scripts (silent coupling fix) | hand-ported | `2d0e15ba7` | 0186 | clean cherry-pick (Batch J) |
| `bef3684b5` | 2026-05-13 | verify(federation): unblock Checks 2/3 by pinning cookies@0.9.0 (#1949) | hand-ported | `f0ac51489` | 0186 | clean cherry-pick (Batch J) |
| `70e233946` | 2026-05-10 | feat(federation): ADR-111 Phases 4-6 — firewall projection + witness chain + MCP tools (#1895) | superseded-by-local | — | 0187 | ADR-0187 declined ADR-111 adoption (Option 2). Standing rule: all ADR-111 SHAs are `superseded-by-local` per ADR-0187 until a concrete consumer request surfaces. |
| `bcdeed8d` | 2026-05-10 | feat(federation): ADR-111 Phases 1-3 — opt-in WireGuard mesh layer (#1894) | superseded-by-local | — | 0187 | ADR-0187 declined ADR-111 adoption (Option 2). Standing rule per ADR-0187. |
| `8f0d90032` | 2026-05-10 | fix(federation): security — validate peer wg fields before splice (ADR-111) | superseded-by-local | — | 0187 | ADR-0187 declined ADR-111 adoption (Option 2). Standing rule per ADR-0187. |
| `0c2b0c02f` `c08ac2251` `e2bc6d9ce` `7415f83ad` `5b36fe531` `3c447854d` `cffa55744` `4d6e47d8a` `3c4638bb9` `3b14b7aa9` `6f7d04d22` `0cdad108b` `40e94434f` `c29ed9963` `4a19793e5` `91657b9fc` `6e0ced793` `29ea78f21` | 2026-05-{03..14} | chore(release): 3.7.0-alpha.{various} version bumps | skip-mechanical | — | 0186 | Batch J — 18 upstream release-noop version-chain commits; fork has independent `3.7.0-alpha.10-patch.N` chain |
| `fdc00cce3` `f514495c8` `3c6d126b7` `9d43d8fdb` `3c0430b8b` `0666796a0` `f8ab5a325` `5b71c7ac1` | 2026-05-{03..16} | chore(verify)/feat(verification): witness manifest regenerations | skip-by-policy | — | 0186 | Batch J — fork-local witness manifest (verification.md.json) supersedes upstream regenerations |
| `00039a833` `6f11cc794` `7523e4daa` `1c266663c` `cb3809820` | 2026-05-05 | README prose / branding switches (Cognitum.One affiliate, `npx ruvflo init` typo, "Update branding from Claude Flow to Ruflo") | skip-by-policy | — | 0186 | Batch J — sparkling brand kept per ADR-0143 |
| `a075c59fc` | 2026-05-09 | chore: bump versions for #1874 publish chain | skip-mechanical | — | 0186 | Batch J — upstream's #1874 publish chain not applicable to our fork chain |
| `d065b2d65` | 2026-05-09 | fix #1874 + add MCP protocol-compliance smoke layer | cherry-picked | `241435e4d` | 0204 | Resolves F-09-003 HTTP struct-on-wire `protocolVersion` (struct→spec date-string). Conflicts in CI/`verification/*` resolved toward fork state (not load-bearing); payload `mcp/src/server.ts` + `shared/src/mcp/server.ts` + `test-mcp-protocol.mjs` applied. (d.2) stdio-literal centralization split to a follow-up ADR. |
| _standing rule (ADR-0203)_ | — | SHAs touching `v3/@claude-flow/hooks/` | superseded-by-adr | — | 0203 | Future upstream-sync waves classify all `v3/@claude-flow/hooks/` SHAs as superseded-by-adr (ADR-0203 eliminated the dead package's consumers; tree kept byte-identical via rsync-exclude). Fork impl: `2db0fdaeb`. |
| _upstream current_ | 2026-05-22 | memory_search threshold default: falsy-or → nullish-coalescing (honor threshold:0) | hand-ported | `a02e561ac` | 0167 | Re-converge: fork carried old rUv `eddfda0040` (falsy `or` coerced explicit threshold:0 → 0.3); upstream uses nullish `?` `?`. Fixes `memory_search` total:0 (related hits score 0.2-0.5; 0.3 floor dropped them). Default stays 0.3 (upstream value). Also reverted ADR-0167 Phase-3 staleness misdiagnosis (`bf71e2bd3`). |
| `6a356ffe6` | 2026-01-05 | init: writer `CLAUDE_FLOW_TOPOLOGY` / `CLAUDE_FLOW_MEMORY_BACKEND` (rUv parallel-authorship) | superseded-by-local | _fork_ | 0214 | Theatrical env vars (`MODE`, `HOOKS_ENABLED`, `TOPOLOGY`, `MEMORY_BACKEND`) had zero source consumers; aligned writers to reader names (`SWARM_TOPOLOGY` / `MEMORY_TYPE` per loader `53cfd8a53`). Recurring fork patch on `mcp-generator.ts` / `settings-generator.ts` / `executor.ts` — re-skip on future sync. Arch-test `cli/__tests__/arch/env-var-theatrical-gate.arch.test.ts` enforces. |
| `0cd9c4a39` | 2026-? | guidance: SG-012 init-patch port (9 `GUIDANCE_*` env vars in `settings.json`) | superseded-by-local | _fork_ | 0214 | Fork-introduced (NOT upstream-inherited); 9 zero-consumer `GUIDANCE_*` vars removed from `settings-generator.ts:69-77`. The original SG-012 commit's intent was annotation only — no `process.env.GUIDANCE_*` reader ever shipped. |
| _fork-local_ | 2026-05-23 | F-14-009 / F-14-014: `embedding.provider` skew + 21-callsite Zod-bypass | fork-local | _fork_ | 0224 | Provider unification (`memory.embeddings.provider: 'transformers.js' → 'onnx'` in `config-template.ts`). Single canonical `getValidatedConfig()` accessor in `shared/src/core/config/accessor.ts` + RuntimeConfigSchema. 21 substrate callsites migrated across 8 packages. Arch-test `cli/__tests__/arch/config-no-raw-parse.arch.test.ts` does NOT honour `adr-0100-allow` for `config.json` raw-parse. |
| `c5006bf97` `71826011b` `c071ace70` | 2026-04-21 onward | CLI bin map adds `ruflo` (originally ADR-0006 follow-up) — silently dropped + restored twice across `--theirs` merges; merge-tax history | superseded-by-local | `3f726dcec` | 0212 | F-12-001: npm alphabetical tie-break deterministically routed `.bin/ruflo` to the CLI, bypassing the wrapper. Option B chosen: removed `ruflo` from CLI bin map (the wrapper @sparkleideas/ruflo becomes sole declarer, converges with upstream's `ruflo`-free CLI). `ruflo-mcp` retained — settled KEEP per active acceptance consumer. Arch-test `cli/__tests__/arch/adr0212-cli-bin-no-ruflo.arch.test.ts` + real-source guard `tests/unit/rebrand-ruflo-bin.test.mjs` catch a future merge re-add. |
| _fork-local_ | 2026-05-23 | F-11-003: ADR-0161 Pass-8 emitted `mcp__agentdb__pattern_*` doc refs resolved against no server | fork-local | `5015b016f` `a8e74b5` | 0213 | Option B + defer: standalone agentdb MCP server is dead-on-arrival (busy_timeout pragma crash) AND SQLite-first (project-rvf-primary violation) AND namespace-doubled. Init unchanged (kept emitting `ruflo` aggregator only). Repointed 3 Pass-8 refs in 5 `.claude/agents/github/*.md` files (2 repoints + 1 removal — `pattern-stats` has no aggregator equivalent). Arch-test `cli/__tests__/arch/adr0213-init-no-agentdb-registration.arch.test.ts` pins the negative; gate test `tests/unit/adr0213-no-dead-agentdb-refs.test.mjs` pins the patch-side doc fix. |
| _fork-local_ | 2026-05-23 | F-11-001/002/004/005: 4 init-emitted user-facing drifts from ADR-0143's `@sparkleideas/ruflo` canonical brand | superseded-by-local | `dfe8ea93a` `1fa33d6` | 0223 | Option A — one-pass canonicalization. F-11-001 [HIGH H13] manual-setup hint: `claude mcp add claude-flow -- ... @sparkleideas/cli@latest` → `claude mcp add ruflo -- ... @sparkleideas/ruflo@latest`. F-11-002 [LOW] `ruv-swarm` pinned to `@latest` (ADR-0155 freshness). F-11-004 [MEDIUM] CLAUDE.md marketplace hint: `ruvnet/ruflo` → `sparkling/ruflo` (matches `.claude-plugin/marketplace.json` owner). F-11-005 [LOW] init.ts "Next steps" canonicalized to `ruflo` (was mixed `claude-flow`+`ruflo`). Arch-test `cli/__tests__/arch/adr0223-init-emitted-brand-canonicalization.arch.test.ts` enforces all 4 + grep-guard. |
| `02976fcb9` `6902716f6` `e6da5c863` `a1561222a` | 2026-05-07 onward | upstream #1834 (skill listing context overflow — 367 SKILL.md, 5x duplicates) + #1835 (skillListingBudgetFraction bump to 6%) + #1836 (prune duplicate skill sources: `v3/@claude-flow/{cli,mcp}/.claude/skills/` removed, `archive/v2/.claude/` → `archive/v2/_v2_claude_snapshot/` rename) | cherry-picked | `6902716f6` `e6da5c863` `a1561222a` | 0216 | Convergence with upstream's prune-not-precedence choice for the duplicate-skills problem. `a1561222a` is a fork-local regression fix restoring v2 hive-mind-advanced SKILL.md as canonical source post-prune. Option E builds on this convergence: NO fork-only precedence rule, NO dedupe-warning, NO multi-location lint. New `ruflo skill list` CLI closes F-15-001 (advertised-but-missing command, 5 references in `init.ts:529,889` + `claudemd-generator.ts:154,167,179`). Corpus-shape acceptance check `_run_skills_corpus_shape` + `_run_skills_cli_surface` under `--group skills-surface` closes F-15-102 (zero acceptance coverage for skills). SKILLS_MAP has 39 flattened entries pinned in arch-test `cli/__tests__/arch/adr0216-skills-map-pin.arch.test.ts`; corpus-shape walk whitelists `dual-mode/` (helper `.md` files but no `SKILL.md`); floor=38 (SKILL.md-file count for `--full` init). `.agents/skills/` untouched (sibling 0215's lane). |
| `b65f27e63` `87ba34854` | 2026-02-07 | Checkpoint: File edits — upstream Claude Code checkpoint that introduced slash-to-dollar corruption (`$dev$null`, `$tmp$X`, `$git$refs`, `$heads$X`, `$contents$X`, `#!$bin$bash`, …) across `.agents/skills/**/SKILL.md` | superseded-by-local | `cc3c27b41` | 0215 | Option E — fix source + content-invariant gate. Codemod scope-rename inadvertently dollar-translated shell paths in 77 inherited SKILL.md files (75 unique skills + 2 case-collision lowercase variants). General gate signature `\$<word>\$<word>` matched 75 files pre-fix, 0 post-fix. Reverted mechanically via the inverse `s|\$word\$word|/word/word|` substitution scoped to lowercase-first path tokens (avoiding `$TASK` / `$HOME` shell vars). Producer-agnostic invariant gate `tests/pipeline/skill-shell-integrity.test.mjs` catches any re-introduction (upstream re-sync, future codemod pass, hand-edit) — fail-loud, no `UPDATE_GOLDEN` escape hatch. Recurring fork patch: if upstream re-touches these one-off files, the reversion re-applies; the gate catches regression at pipeline-test time. |
| `0e1d26c11` | 2026-05-23 | fix(security): patch CVEs, shell injection, SSRF in ruflo (#2114) | hand-ported | `1c8e9fd79` | 0228 | Batch L. CWE-78: 2 fork-tracked `github-safe.js` patched (top-level: applied execFileSync + DRY_RUN env; `v3/@claude-flow/mcp/.claude/helpers/`: SUPERSEDED-BY-LOCAL — fork already shipped stronger fix with ALLOWED_COMMANDS whitelist + runGh wrapper + explicit `shell: false`). `v3/@claude-flow/cli/.claude/helpers/github-safe.js`: SUPERSEDED-BY-LOCAL (deleted at `161ea12ac` per ADR-0059 fork restructure). 3 upstream-only files SKIP: `scripts/audit-supply-chain.mjs` (supply-chain audit lives in ruflo-patch), `scripts/track-clones.mjs` (upstream marketing/analytics), `plugins/ruflo-core/scripts/witness/perf.mjs` (fork has own perf-witness per ADR-0181). CWE-918 SSRF: `ruflo/src/{mcp-bridge,ruvocal/mcp-bridge}/index.js` assertSafeUrl auto-merged cleanly. `browser-e2e.test.ts` execFileSync auto-merged. |
| `5b8e3ad0f` | 2026-05-23 | fix(deps): patch 3 moderate CVEs via npm overrides — qs DoS, protobufjs DoS, express qs-chain (#2113) | hand-ported | `ed506dc0e` | 0228 | Batch L. Version pin: kept fork's `3.7.0-alpha.11-patch.261` (Batch J standing rule). Overrides merge: added upstream's `express:>=4.22.2`, `qs:>=6.15.2`, `protobufjs` upgraded `>=7.5.5 → >=8.2.0` (closes GHSA-jggg-4jg4-v7c6 in v7 range left unguarded), plus opentelemetry pins + axios + fast-uri + vite + ws transitive CVE patches. Lockfile: take fork's HEAD (--ours); `npm install` regenerates against new constraints. |
| `166ee7f25` | 2026-05-21 | docs(adr): ADR-128 — init bundle reduce + refactor + skill source-of-truth fix | cherry-picked | `10f0a6eb5` | 0228 | Batch M. Clean cherry-pick — new doc file `v3/docs/adr/ADR-128-init-bundle-reduce-refactor.md` (242 lines). |
| `c63905e6a` | 2026-05-21 | feat(init): #2095 ADR-128 Phase 1 — ship 29 skills inside @claude-flow/cli package | cherry-picked | `a8d37037d` | 0228 | Batch M. Clean cherry-pick despite recent revert `d54e7d600` (which deleted 39 mis-bundled skills): merge-base predates the failed bundle attempt, so upstream's 29-skill add applies as plain creation, no conflict. Per DP-1: take upstream's 29 verbatim. |
| `865c901af` | 2026-05-21 | feat(init): #2095 ADR-128 Phase 2 — remove 9 forked agents (let plugins own them) | hand-ported | `a028b07bb` | 0228 | Batch M. Conflict: 4 of 9 agents (goal/goal-planner, v3/{adr-architect, memory-specialist, sparc-orchestrator}) had fork-side brand-canonicalization touches from `46ec1b6d9` (`mcp__claude-flow__` → `mcp__ruflo__` sweep). Per ADR-128 intent: take upstream's deletion. Resolved by `git rm` on the 4 conflicted files. Brand canonicalization work is incidental (files removed entirely). |
| `34e7b1e9f` | 2026-05-21 | feat(init): #2095 ADR-128 Phase 3 — opt-in domain-specific agent categories (98 → ~17 by default) | hand-ported | `d24c4531f` | 0228 | Batch M. Conflict: init.ts had 3 conflict regions where both sides added flag handlers / flag definitions / examples (fork: ADR-0069 port/similarityThreshold/maxAgents + ADR-0177 embedding-model validation; upstream: --all-agents flag). Resolution: keep BOTH (concatenate; both sides orthogonal additions). Per DP-2: take upstream's opt-in defaults (98 → ~17), `--all-agents` restores. types.ts DEFAULT_INIT_OPTIONS.agents.{github,hiveMind,v3,optimization} flipped true → false (auto-merged). |
| `0740b2fa1` | 2026-05-21 | feat(init): #2095 ADR-128 Phase 4 — delete 9 orphan command files (unreachable from COMMANDS_MAP) | hand-ported | `6e58f92a8` | 0228 | Batch M. Conflict: 4 regions in types.ts CommandsConfig + DEFAULT_INIT_OPTIONS.commands + executor.ts COMMANDS_MAP + command-copy logic — both sides restructured the same blocks (fork: ADR-0148 C pattern flat list; upstream: substrate vs opt-in groups + descriptive comments + defensive `(MAP.x \|\| [])`). Resolution: take upstream's organization + defensive syntax, PRESERVE fork-only `flowNexus` + `jujutsu` entries (jujutsu = agentic-jujutsu AI-VCS, fork-specific; flowNexus = ADR-0148 C pattern restoration). |
| `9a66b2996` | 2026-05-21 | feat(ci): #2095 ADR-128 Phase 5 — init-bundle-invariants smoke (no orphans, no plugin-init overlap) | hand-ported | `f4a86eabe` | 0228 | Batch M. Conflict: 2 regions in .github/workflows/v3-ci.yml path filters (push + pull_request). Both sides extended the filter lists. Resolution: take upstream's ~80 paths (covers all recent ADR smoke gates: 123, 126 Phases 3-6, 127, 128) AND preserve fork's 3 loose verification file paths (verification.md.json, verification-history.jsonl, witness-fixes.json) which upstream's `verification/**` glob misses. New files (clean adds): smoke-init-bundle-invariants.mjs + 8 skill files (browser, dual-mode/, flow-nexus-{neural,platform,swarm}). |
| `1ce81a3e3` | 2026-05-21 | chore(release): publish 3.7.0-alpha.76 — ADR-128 init bundle reduce + refactor | skip-mechanical | — | 0228 | Batch M. Batch J standing rule: pure version-bump (upstream's alpha.76 release after ADR-128 phases landed). Fork has independent `-patch.N` chain; not applicable. |
| `116613e9` | 2026-05-18 | docs(ruflo-browser): #2041 link plugin to ADR-122 substrate | cherry-picked | `53d75c3e2` | 0228 | Batch S #1 (ADR-122 browser substrate series). Clean. |
| `5fedd1d02` | 2026-05-18 | feat(browser): #2041 ADR-122 Phase 0 + Phase 1 — agent-browser 0.27 + signed trajectories | hand-ported | `da6bcf6d3` | 0228 | Batch S #2. v3/@claude-flow/browser/package.json conflict: kept fork version pin `3.0.0-alpha.3-patch.810`; took upstream's `agent-browser: ^0.27.0` bump (feature dep); kept fork's `agentic-flow: 2.0.2-alpha-patch.818` Verdaccio pin. |
| `8d10e1aa` | 2026-05-18 | feat(browser): #2041 ADR-122 Phase 1 MCP + Phase 2 causal recovery | cherry-picked | `412faf953` | 0228 | Batch S #3. Clean. |
| `dfb7747b` | 2026-05-18 | feat(browser): #2041 ADR-122 Phase 3 + Phase 4 — attested cookie vault + federated MCTS | cherry-picked | `ec9dbd780` | 0228 | Batch S #4. Clean. |
| `a0d3d01c` | 2026-05-18 | feat(browser): #2041 ADR-122 Phase 5 — cost-aware routing + GOAP preflight | cherry-picked | `54e5078dd` | 0228 | Batch S #5. Clean. |
| `45f95114` | 2026-05-18 | feat(browser): #2041 ADR-122 Phase 6 + substrate reframing — Session Capsule + adapters + risk classes | cherry-picked | `1cd3d14ed` | 0228 | Batch S #6. Clean. |
| `350bcf06` | 2026-05-18 | feat(browser): #2041 ADR-122 Phase 7 — Workflow Compiler + production-aware UCT | cherry-picked | `e594fe543` | 0228 | Batch S #7. Clean. |
| `72d31a00` | 2026-05-18 | docs(browser): #2041 ADR-122 security audit + substrate benchmarks + announcement draft | cherry-picked | `b93c83cd3` | 0228 | Batch S #8. Clean. Complete ADR-122 browser substrate series. |
| `126c23a0` | 2026-05-18 | feat(graph-intelligence): #2044 ADR-123 Phase 1 — ruflo-graph-intelligence plugin foundation | cherry-picked | `ff64e52b4` | 0228 | Batch S #9 (ADR-123 Graph Intelligence series). |
| `645f31a0` | 2026-05-18 | feat(graph-intelligence): #2044 ADR-123 Phases 2-4 — 5 adapters across 5 wedges | cherry-picked | `7c96d7219` | 0228 | Batch S #10. |
| `dbb88fdc` | 2026-05-18 | feat(graph-intelligence): #2044 ADR-123 Phases 5+6 — portfolio CG + AIDefence + jujutsu + JL + GOAP-LP | cherry-picked | `3b4cdc774` | 0228 | Batch S #11. |
| `ed81567c` | 2026-05-18 | feat(graph-intelligence): #2044 ADR-123 Phases 6.5+7 — streaming bridge + signed PR artifacts (beyond-SOTA) | cherry-picked | `f4f2d9e8d` | 0228 | Batch S #12. |
| `3cec3bf9` | 2026-05-18 | feat(graph-intelligence): #2044 ADR-123 Phase 8 — federation distribution of signed PR vectors | cherry-picked | `c0b5a9f6c` | 0228 | Batch S #13. |
| `36d8195a` | 2026-05-18 | fix(graph-intelligence): #2044 ADR-123 — add .claude-plugin/plugin.json for marketplace validate | cherry-picked | `d3947deff` | 0228 | Batch S #14. |
| `0181fb85` | 2026-05-19 | ci: #2046 supply-chain hardening — five-layer audit + dependency review + CODEOWNERS | cherry-picked | `4e9a87e7f` | 0228 | Batch S #15. |
| **Batch S followups** | 2026-05-19 | fix(browser): re-canonicalize ruflo-browser/README.md @claude-flow/ → @sparkleideas/ | fork-local | `b51c824b7` | 0228 | Batch S followup: ADR-0113 Phase C arch test (tests/pipeline/marketplace-manifest.test.mjs:114) caught a `@claude-flow/` ref introduced by ADR-122/123 picks. Resolved via scripts/apply-codemod-to-fork-md.mjs. |
| **Batch S continued (33 picks via background agent)** | 2026-05-18..05-23 | 24 clean cherry-picks + 8 hand-ported + 1 fork-local codemod commit. Landed: ADR-123 docs (3), ADR-125 Phases 6-7 + downloads badge (5), ADR-126 neural-trader bench/perf/security/Phase-5 (10), ADR-127 GitHub surface Phases 1+3+4 + #2089 followup (5), guidance perf #2103 Phase-1+M3+M4 (3), supply-chain #2046 root (1), cost-tracker spawnSync (1), init #2078 (1), data clones (3), graph-intelligence plugin.json (1), brand-canon followup (1). Hand-port pattern: v3-ci.yml `--ours` (already heavily merged), lockfile `--ours`, package.json kept fork patch-N pins. Full landed-list and per-pick details in background agent output (task abe01952896821c2a) | hand-ported (mixed) | `e04cc5b8d` (final HEAD) | 0228 | Batch S agent automation. Landed 33 new commits on `forks/ruflo/main`. |
| **Batch S source-conflict deferrals (24 commits)** | 2026-05-18..05-22 | ADR-125 memory hybrid Phases 1-5 (5) [substrate conflicts with fork's post-ADR-0177 SQLite restoration], ADR-126 neural-trader Phases 1-4 + 6 (5) [skills/SKILL.md fork divergence], ADR-127 Phase 2 + completion (2) [github agent .md frontmatter], kg-extract #2049 (1), 3 doc badge updates (3), 5 fix(deps)/fix(mcp)/fix(cli,daemon,mcp)/fix(init) (5), fix(memory) #2073 + fix(mcp) #2086 (2) + #2046 ADR-124 agentic-flow bump (1) | deferred-source-conflict | — | 0228 | These 24 commits touch fork-divergent source files (v3/@claude-flow/memory/* substrate post-ADR-0177, neural-trader SKILL.md fork content, github agent .md frontmatter, package.json patch-N cascades). Per `feedback-no-fallbacks`, bulk auto-resolution risks silent-edit bugs; deferred for per-commit manual triage in follow-up session. SHA list available in background agent output (task abe01952896821c2a §Skipped — source conflicts). |
| **Batch S empty-picks (9 commits)** | 2026-05-18..05-22 | ADR-122/agent-browser lockfile refreshes + rerere'd duplicates | skip-mechanical | — | 0228 | Roll-up: 9 cherry-picks reported empty (content already applied via rerere cache from prior conflict resolutions). |
| `4e9a33ce2` | 2026-05-19 | feat(memory): #2061 ADR-125 Phase 1 — MemoryService canonical entry point + deprecate UnifiedMemoryService | cherry-picked | `2248b833d` | 0230 | ADR-0230 step C / Phase 1 re-disposes row 163 source-conflict deferral. Fork adaptation: removed top-level RvfBackend + HnswLite exports from `v3/@claude-flow/memory/src/index.ts` (per Phase 1 + fork's `prepublishOnly` forbidden list); adapted `v3/@claude-flow/memory/src/index.test.ts` to skip SqlJsBackend (not vendored on fork — better-sqlite3 native is primary) and HybridBackend (lands via step F / Phase 2 adapter `11eaef851`) assertions. |
| `81a2b23eb` | 2026-05-19 | feat(memory): #2061 ADR-125 Phase 3 — persistent HNSW snapshot + restore | cherry-picked | `7fefa0c3e` | 0230 | ADR-0230 step D / Phase 3. Conflicts resolved on `src/index.ts` (kept fork's no-top-level-RvfBackend/HnswLite stance + adopted Phase 3 instance fields: storeCountSinceSnapshot, snapshotInterval, consolidatorTimer, consolidator, backend; assigned `this.backend = this.adapter` in constructor; took Phase 3's shutdown/store/bulkInsert bodies that route through `this.backend`). Phase 3 also DELETES `hnsw-lite.ts` (code inlined into rvf-backend.ts) and ADDS placeholder `consolidator.ts` (filled by Phase 4). Pre-flight: `HNSW\x01` magic confirmed non-colliding with fork RVF segment magics. |
| `8773fcffd` | 2026-05-19 | feat(memory): #2061 ADR-125 Phase 5 — graceful retrieval degradation + FTS5 keyword fallback | cherry-picked | `7f3e15334` | 0230 | ADR-0230 step D / Phase 5. Conflicts resolved on `controller-registry.ts` (took Phase 5's hybridSearch RRF+MMR impl verbatim — replaces fork's pre-existing BM25+HNSW hybridSearch case from ADR-0068 W4-3 which depended on the never-vendored `./controllers/hybrid-search.ts` module; kept fork's full 3-scope agentMemoryScope impl) and `sqlite-backend.ts` (kept fork's MEMORY_ENTRIES_DDL shared schema from ADR-0065 P3-2, added Phase 5's FTS5 virtual table). Phase 5 also wants `sqljs-backend.ts` (`modify/delete` — removed from fork tree; fork uses better-sqlite3 native, no sql.js fallback). Pre-flight: FTS5 confirmed available in fork's better-sqlite3 build. |
| `850450f38` | 2026-05-19 | feat(memory): #2061 ADR-125 Phase 4 — MemoryConsolidator (sweep + dedup + compactHnsw) | cherry-picked | `a68817f6b` | 0230 | ADR-0230 step E / Phase 4 adapt. Conflicts resolved on `controller-registry.ts`: (1) merged Phase 4's `agentdb?` + `memoryService?` RuntimeConfig fields into fork's RuntimeConfig (additive); (2) un-bundled `nightlyLearner` from the agentdb-required case-list and gave it its own `agentdb !== null OR memoryService !== null` enable condition; (3) `nightlyLearner` controller body now prefers `memSvc.getConsolidator().runAll()` when MemoryService is registered, falling back to fork's existing AgentDB delegate path (ADR-0068 W2-3). Phase 4's `consolidator.autoRun` config is undefined by default → `startConsolidatorTimer()` returns early → 6h setInterval NEVER fires; the ADR-0230 §Phase 4 adapter requirement is satisfied by config default rather than a code edit. |
| `11eaef851` | 2026-05-19 | feat(memory): #2061 ADR-125 Phase 2 — wire createHybridService to actually use HybridBackend | cherry-picked | `fe682324b` | 0230 | ADR-0230 step F / Phase 2 adapt (THE LOAD-BEARING RISK). Vendored upstream's `hybrid-backend.ts` (789 lines) to fork as `forks/ruflo/v3/@claude-flow/memory/src/hybrid-backend.ts` (additive — no fork version existed). Expanded `DatabaseProvider` union to add `'hybrid' \| 'agentdb'`. Added the `'hybrid'` + `'agentdb'` cases to fork's `createDatabase` switch with the same constructor shape upstream uses. `createHybridService` now flows through `createDatabase({provider:'hybrid'})` + `service.withBackend()` per upstream Phase 2. Fork dim default kept at 768 (mpnet) instead of upstream's 1536. Forbidden substrings (`HybridBackend`, `SqlJsBackend`, `JsonBackend`) purged from all 6 ADR-0076 production files; the names live in test files (which the gate doesn't read). |

## agentic-flow

| Upstream SHA | Date | Subject | Disposition | Local SHA | ADR | Notes |
|---|---|---|---|---|---|---|
| `25b26e2` | 2026-03-25 | ADR-071 agentdb+ruvector WASM capabilities review (doc) | retargeted | (present at `forks/agentdb/docs/adrs/`) | 0186 | post-ADR-0161 agentdb pivot |
| `c830a98` | 2026-03-26 | ADR-072 ruvector advanced features integration (doc) | retargeted | (present at `forks/agentdb/docs/adrs/`) | 0186 | post-ADR-0161 agentdb pivot |
| `54440ca` | 2026-03-26 | PRE-PUBLISH-REVIEW.md | retargeted | (present at `forks/agentdb/PRE-PUBLISH-REVIEW.md`) | 0186 | post-ADR-0161 agentdb pivot |
| `e60a5ba` | 2026-05-04 | merge feature/adr-071-wasm into main (top-level test infra) | hand-ported | `7c6d510` | 0186 | playwright + browser test files |
| `62e4961` | 2026-05-04 | Merge PR #148 release/merge-adr-071-wasm | skip-mechanical | — | 0186 | content subsumed by `7c6d510` |
| `f5b6c7d` | 2026-05-04 | 8 open issues fix (#145, #146 Gap 1+2, #102, #110, ...) | hand-ported | `1528b14` | 0186 | retarget applied |
| `50eef3a` | 2026-05-05 | regenerated WASM artifacts + agentdb lockfile bump | hand-ported | `ae20875` | 0186 | WASM regen only |
| `c2af4dc` | 2026-05-06 | agentdb delete API on GraphDatabaseAdapter + ReflexionMemory | retargeted | `8b3388b22` (in forks/agentdb) | 0186 | confirmed 2026-05-18: deleteNode/deleteEdge/deleteHyperedge/deleteEpisode all present in forks/agentdb at canonical paths via the ADR-0161 extraction commit (same day as upstream) |
| `d231a13` | 2026-05-06 | clean up repo root + bump agentdb submodule | hand-ported | `a24a00e` | 0186 | `.gitignore` only |
| `b280a4c` | 2026-05-09 | WebSocket QUIC fallback for federation transport (#153) | hand-ported | `f299cf49e` | 0186 | conflicts on agentic-flow/package.json + package-lock.json resolved to ours |
| `a3f1cdf` | 2026-05-23 | fix(security): replace shell-injectable execSync with safe-exec in MCP server (#156) | cherry-picked | `437365f` | 0228 | Batch L. Clean cherry-pick — claudeFlowSdkServer.ts wired to safe-exec helpers (execMemoryStore/Retrieve/Search, execAgentSpawn, safeExecNpx); validateFilePath() helper for agent_booster_edit_file/batch_edit blocks /etc /proc /sys /dev /root; auth-middleware.ts return type fix. |
| `98ea0ba` | 2026-05-23 | fix(security): patch 7 shell injection sites, resolve 45 CVEs, add transitive overrides (#157) | hand-ported | `4c6312f` | 0228 | Batch L. CVE dep bumps applied: @anthropic-ai/claude-code 2.1.7→2.1.150 (CVSS 10 sandbox escape), axios 1.13.0→1.16.1, postcss 8.5.6→8.5.15, react-router-dom 7.9.4→7.15.1; vite/ws/yaml/typescript-eslint/0x auto-merged. Full upstream overrides block (~40 transitive pins) auto-merged. Fork-specific: kept agentdb Verdaccio pin `3.0.0-alpha.14-patch.273`, kept node-llama-cpp; SKIP `marked` + `ruvector` upstream-only adds. http-sse.ts: merged ADR-0069 A6 resolvePort import with upstream's execFileSync add. agentBoosterPreprocessor.ts: defensive merge — kept fork's CVE-2026-003 validateLanguage + explicit `shell:false`, renamed `proc` → `spawnResult` to integrate with auto-merged post-conflict block. Lockfile --ours. |
| `6a06854` | 2026-05-23 | fix(security): CWE-78 shell injection, SSRF, hardcoded key, NaN-panic, RUSTSEC advisories (#158) | hand-ported | `9f9e4fc` | 0228 | Batch L. `.claude/helpers/github-safe.js`: SUPERSEDED-BY-LOCAL — fork already on `execFileSync('gh', args, {stdio:'inherit'})` (throws on non-zero); upstream's commit migrates `execSync → spawnSync` with manual exit-code propagation. Both CWE-78-safe; took fork's simpler variant via --ours. CWE-918 SSRF (`plugins.ts` assertSafeUrl in loadRemotePlugin), CWE-798 hardcoded creds, CWE-754 NaN-panic, RUSTSEC fixes (reasoningbank Rust crates + agent-booster + agentic-jujutsu): all auto-merged. New file `missing-optional-modules.d.ts` added cleanly. Lockfile auto-merged. |

## ruvector

| Upstream SHA | Date | Subject | Disposition | Local SHA | ADR | Notes |
|---|---|---|---|---|---|---|
| `1493bab01` | 2026-05-06 | graph-node deleteNode/deleteEdge/deleteHyperedge API | hand-ported | `ee8bca912` | 0186 | manual merge; pair-of-two with agentic-flow `c2af4dc` (agentdb side still pending) |
| `d771d06ee` | 2026-? | hailo: NPU embedding backend + multi-Pi cluster | hand-ported | `8b80e5c91` | 0186 | subject-match (Batch I Hailo cluster #1) |
| `c7b0ba4c0` | 2026-? | hailo: NPU pipeline pool exploration | hand-ported | `fcf19972d` | 0186 | subject-match (Batch I Hailo #2) |
| `c12d828b7` | 2026-? | hailo: lint cleanup + bridge test gates | hand-ported | `7a06c26d3` | 0186 | subject-match (Batch I Hailo #3) |
| `0442856c3` | 2026-? | hailo: bench fingerprint + StatsResponse npu_pool_size | hand-ported | `b55feedbe` | 0186 | subject-match (Batch I Hailo #4) |
| `c6d69003a` | 2026-? | ADR-179: ruvllm 4-Pi 5 + Hailo HAT cluster — SOTA 20.5 tok/s | hand-ported | `7fcdd9415` | 0186 | subject-match (Batch I Hailo #5) |
| `55eae8887` | 2026-? | ADR-180: ruvllm 2.2.1 cache-reset patch | hand-ported | `92c296b04` | 0186 | subject-match (Batch I Hailo #6) |
| `4922b034f` | 2026-? | sparse-attention crate integration (ADR-183..190) | hand-ported | `2b2da81b4` | 0186 | subject-match (Batch I sparse-attention chain head) |
| `51b1ca777` | 2026-? | sparse-mario: training-free retrieval LM + masked diffusion | hand-ported | `77614f282` | 0186 | subject-match (Batch I sparse-attention chain tail / new-since-v1) |
| `c30987277` | 2026-? | docs(adr): SOTA extension sections | hand-ported | `90e0ac3ac` | 0186 | subject-match (Batch I docs) |
| `068bb637a` | 2026-? | docs(sparse-attn): README SOTA extensions | hand-ported | `4a357f32d` | 0186 | subject-match |
| `36912ba3e` | 2026-? | docs(ruvllm-sparse): Pi 5 hardware benchmarks | hand-ported | `208eb1762` | 0186 | subject-match |
| `58de8932d` | 2026-? | docs(ruvllm, hailo-cluster): sparse-attention + Hailo-10 | hand-ported | `743e5dbe7` | 0186 | subject-match |
| `8f9742129` | 2026-05-12 | research(nightly): rairs-ivf — RAIRS IVF, first Inverted File Index (ADR-193) | hand-ported | `325de8932` | 0186 | clean cherry-pick |
| `a80a46d07` | 2026-05-12 | fix(ruvector-rairs): shorten keyword to satisfy crates.io 20-char limit | hand-ported | `6409012c3` | 0186 | clean cherry-pick |
| `bc3a9b1c9` | 2026-05-16 | fix: 9-issue cleanup batch + regression-guard CI workflow (#466) | hand-ported | `a29872189` | 0186 | conflicts on npm/packages/{pi-brain,rvf-wasm}/package.json → ours; tmux.js→tmux_lc.js and type.js→type_lc.js renames left macOS case-insensitive FS artifacts cleaned by `9d571abe8` |
| `c4212106f` | 2026-05-16 | ci: close 3 regression-guard coverage gaps (#468) | hand-ported | `6235e4f8d` | 0186 | clean cherry-pick |
| `eafba64fa` | 2026-05-23 | fix(security): RUSTSEC advisories + clippy hardening in RuVector (#504) | cherry-picked | `465d30753` | 0228 | Batch N priority-1 security. partial_cmp.unwrap()→Ordering::Equal on f32/f64 (12 sites); HTTP search input validation (k=0/>10k, empty/oversized vectors); LocalFsBackend env_clear + safe-env allowlist + deadline-based timeout (SEC-005). |
| `d5e07f6e6` | 2026-05-18 | fix(ruvector-router-core): #430 HNSW insert beam + distance-based pruning + storage rebuild | cherry-picked | `c72bd1ff9` | 0228 | Batch N. Clean cherry-pick. |
| `796236671` | 2026-05-19 | ci(security): add 5-layer supply-chain CI + clear 3 npm criticals | cherry-picked | `fc547893a` | 0228 | Batch N. Auto-merged. |
| `bff1642b2` | 2026-05-21 | fix(ruvector): ONNX wasm bundle + brain MCP ESM errors + supply-chain CI (#481) | hand-ported | `d4926d3ad` | 0228 | Batch N. npm/packages/ruvector/package.json conflict: kept fork's `0.1.2-patch.763` Verdaccio pin (upstream wanted 0.2.26). |
| `835a2f23c` | 2026-05-22 | fix(ci): exclude npm/ binaries from .node file search in publish workflow | cherry-picked | `2afab2b2d` | 0228 | Batch N. Clean. |
| `b4e26a5a2` | 2026-05-22 | fix(cli): use .meta.json sidecar instead of JSON-parsing binary redb (#417) (#482) | cherry-picked | `95071fb20` | 0228 | Batch N. Clean. |
| `0ae4de957` | 2026-05-22 | fix(intelligence): import() now inserts memories into HNSW index (#315) (#483) | cherry-picked | `91475ae12` | 0228 | Batch N. Clean. |
| `81aba6478` | 2026-05-22 | fix: CypherEngine multi-row MATCH, rvlite ESM import, LearningEngine export (#484) | cherry-picked | `aa079099d` | 0228 | Batch N. Clean. |
| `87399fa74` | 2026-05-22 | fix(postgres): wrap optional-feature SQL functions in DO exception blocks (#485) | cherry-picked | `e576bf195` | 0228 | Batch N. Clean. |
| `ca62a44c2` | 2026-05-22 | fix(ruvllm): reject unsupported GGUF + Qwen2/Gemma metadata (#486) | cherry-picked | `203235047` | 0228 | Batch N. Clean. |
| `600580a82` | 2026-05-22 | fix(mcp): exit cleanly on SIGTERM/SIGINT/stdin-end in MCP server (#475) | cherry-picked | `2b5f682f5` | 0228 | Batch N. Auto-merged. |
| `38105cf89` | 2026-05-22 | fix(mcp): route tracing output to stderr to prevent JSON-RPC stdio corruption (#470) | superseded-by-local | — | 0228 | Batch N DP-3: fork's ADR-0226 already shipped equivalent stdio-hygiene fix; upstream's commit converges. Skipped. |
| `7c3c1d424` | 2026-05-22 | feat(ops): add LinearBitNet — ternary weight GEMV with zero-skip (#477) | cherry-picked | `1f636ddb8` | 0228 | Batch N. Clean. |
| `f07540762` | 2026-05-22 | fix(rvlite): SPARQL variable predicates, DESCRIBE EOF, metadata-filtered vector search (#488) | cherry-picked | `304af4dd8` | 0228 | Batch N. Auto-merged. |
| `3b2bc2756` | 2026-05-22 | fix(mcp-brain-server): add missing /v1/reclassify route (#489) | cherry-picked | `fbeb6d04e` | 0228 | Batch N. Clean. |
| `b8faecfae` | 2026-05-22 | fix(mcp-brain-server): spawn_blocking for cognitive cycle + postgres version bump (#490) | cherry-picked | `62a0e1cea` | 0228 | Batch N. Clean. |
| `bd71cd1e2` | 2026-05-22 | fix(gnn): remove broken linux-arm64-musl target from build matrix (#491) | hand-ported | `3c0726a3a` | 0228 | Batch N. crates/ruvector-gnn-node/package.json conflict: kept fork's `0.1.25-patch.101` pins, dropped the `linux-arm64-musl` entry per upstream intent. |
| `e3d8ff8e6` | 2026-05-22 | fix(npm): update stale ruvector peer deps and fix TS syntax error (#492) | hand-ported | (pick after gnn) | 0228 | Batch N. npm/packages/agentic-synth/package.json conflict: kept fork's `"ruvector": "0.1.2-patch.763"` Verdaccio pin (upstream wanted `^0.2.0`). |
| `5ba2b59b5` | 2026-05-22 | fix(ts): align burst-scaling and ruvector-extensions with VectorDB API (#493) | cherry-picked | `07cb327be` | 0228 | Batch N. Clean. |
| `e3b3dc67f` | 2026-05-22 | fix(simd): remove outdated nightly-only comment; add AVX-512 CI compile check (#494) | cherry-picked | `719fdc339` | 0228 | Batch N. Clean. |
| `bd616ece4` | 2026-05-22 | fix(gnn): replace thread_rng with seeded StdRng for faster layer init (#495) | cherry-picked | `16a6fbdf1` | 0228 | Batch N. Clean. |
| `9d4e3ea71` | 2026-05-22 | fix(sql): rename access method hnsw → ruhnsw to match Rust source (#496) | cherry-picked | `be65c451c` | 0228 | Batch N. Clean. |
| `74ba93421` | 2026-05-22 | fix(cli): add missing brain agi and midstream commands + brain search --verbose (#497) | cherry-picked | `719ca58cd` | 0228 | Batch N. Clean. |
| `2495b8f1b` | 2026-05-22 | fix(ts): resolve TypeScript errors across 5 npm packages (#499) | cherry-picked | `938c655a4` | 0228 | Batch N. Auto-merged. |
| `a531628bb` | 2026-05-22 | fix(ts): remove rootDir+declaration from agentic-synth-examples tsconfig (#500) | cherry-picked | `23507bf2f` | 0228 | Batch N. Clean. |
| `4e133ddf1` | 2026-05-22 | fix(tests): repair npm unit/integration test suite — 5/5 suites now pass | cherry-picked | `acbacdc46` | 0228 | Batch N. Clean. |
| `41fe77d8a` | 2026-05-22 | fix(cognitum-gate-wasm): fix build paths + make wasm build optional | cherry-picked | `ed482a771` | 0228 | Batch N. Clean. |
| `d0f2b4ddb` | 2026-05-22 | fix(lint): resolve ESLint errors in wasm-unified, graph-data-generator, agentic | cherry-picked | `2eb2ceb23` | 0228 | Batch N. Auto-merged. |
| `5cd593deb` | 2026-05-22 | fix(lint): resolve ESLint errors in burst-scaling package | cherry-picked | `29949f317` | 0228 | Batch N. Clean. |
| `74a215446` | 2026-05-22 | fix(lint): fix graph-data-generator lint script target and extension | cherry-picked | `f9d665fa1` | 0228 | Batch N. Auto-merged. |
| `022bc3fca` | 2026-05-22 | fix(lint): resolve all ESLint errors in cli package | cherry-picked | `5c6585e4d` | 0228 | Batch N. Clean. |
| `e7330cd6a` | 2026-05-22 | fix(lint): resolve ESLint errors in agentic-synth package | cherry-picked | `5b5c749d7` | 0228 | Batch N. Clean. |
| `672e413f0` | 2026-05-22 | fix(lint): resolve ESLint errors in cognitum-gate-wasm package | cherry-picked | `e1ecd0044` | 0228 | Batch N. Clean. |
| `0ea566b57` | 2026-05-22 | fix(lint): resolve all ESLint errors in agentic-integration package | cherry-picked | `c33c02176` | 0228 | Batch N. Clean. |
| `0521862d2` | 2026-05-22 | fix(lint): resolve all ESLint errors in postgres-cli package | cherry-picked | `2769d05d3` | 0228 | Batch N. Clean. |
| `ea13b33da` | 2026-05-22 | fix(lint): resolve all ESLint errors in ruvbot package | cherry-picked | `9e78afb39` | 0228 | Batch N. Clean. |
| `a42606799` | 2026-05-22 | fix(lint): fix remaining ruvbot OpenRouterProvider lint issue | cherry-picked | `a859096b9` | 0228 | Batch N. Clean. |
| `a40634703` | 2026-05-22 | chore(audit): silence imageproc 0.25.0 soundness warnings | cherry-picked | `7e56f0876` | 0228 | Batch N. Clean. |
| `9b36abf7f` | 2026-05-22 | fix(lint): resolve remaining ruvbot CLI command and plugin lint errors | cherry-picked | `2710136a1` | 0228 | Batch N. Clean. |
| `33eeb9d2c` | 2026-05-22 | fix(lint): resolve final ruvbot CLI index lint error | cherry-picked | `c2e443376` | 0228 | Batch N. Clean. |
| `a06d8be56` | 2026-05-22 | fix(lint): achieve zero lint errors in ruvbot package | cherry-picked | `80321b6d0` | 0228 | Batch N. Clean. |
| `c2944bf39` | 2026-05-22 | fix(build): resolve sona napi flags and agentic-integration TypeScript errors | cherry-picked | `133869b30` | 0228 | Batch N. Auto-merged. |
| `8e75ae140` | 2026-05-22 | ci: add workflow_dispatch to key CI workflows + ignore test-results.json | cherry-picked | `d13dc91f7` | 0228 | Batch N. Clean. |
| `0edc4b985` | 2026-05-22 | ci: switch all CI workflows from ubuntu-latest to ubuntu-22.04 | cherry-picked | `b81a1d689` | 0228 | Batch N. Clean. |
| `16414a4c7` | 2026-05-22 | fix(node): remove non-existent @ruvector/core re-exports | cherry-picked | `606151963` | 0228 | Batch N. Clean. |
| `8967aee0e` | 2026-05-22 | fix(core): clear stale tsconfig rootDir pointing at non-existent src/ | cherry-picked | `6a2b98dbe` | 0228 | Batch N. Clean. |
| `07105268a` | 2026-05-22 | fix(ts): resolve 7 TypeScript build errors across node, postgres-cli, ruvbot | cherry-picked | `c5482a870` | 0228 | Batch N. Clean. |
| `a2422cf8b` | 2026-05-22 | fix(wasm-unified): suppress TS2532 in poincareToLorentz loop | cherry-picked | `24a0a3751` | 0228 | Batch N. Clean. |
| `4e6e3d399` | 2026-05-22 | ci(core-and-rest): bump timeout 180→240 min | cherry-picked | `5ab5e909b` | 0228 | Batch N. Clean. |
| `e2350b759` | 2026-05-23 | fix(core): HNSW correctness fixes, k=0 guard, sorted results, cross-integration (v2.2.3) (#502) | cherry-picked | `5a3944088` | 0228 | Batch N. Auto-merged. |
| (52 SHAs) | 2026-05-04..05-23 | chore: Update NAPI-RS binaries for all platforms | skip-mechanical | — | 0228 | Batch N roll-up: 52 NAPI binary regenerations across the window; fork rebuilds binaries natively per ADR-0150 + ADR-0186 standing rule. |
| (4 SHAs) | 2026-05-22 | ci: retrigger/kick stuck CI jobs | skip-mechanical | — | 0228 | Batch N roll-up: empty-fix CI re-trigger commits. |
| (2 SHAs) | 2026-05-22..05-23 | chore: bump versions / release patch versions | skip-mechanical | — | 0228 | Batch N roll-up: Batch J pattern — fork has independent `-patch.N` chain. |
| (1 SHA) | 2026-05-22 | docs(readme): add repository banner image linking to cognitum.one/ruvector | skip-by-policy | — | 0228 | Batch N: branding/marketing per ADR-0143. |
| (1 SHA) | 2026-05-22 | chore: revert router 0.1.31 bump from this PR | skip-mechanical | — | 0228 | Batch N: revert of a version bump within an upstream PR; not applicable to fork chain. |
| (2 SHAs) | 2026-05-22 | chore(postgres) regenerate Cargo.lock / chore(diskann) README sync | skip-mechanical | — | 0228 | Batch N: lockfile/README mechanics. |
| (2 SHAs) | 2026-05-22 | style: rustfmt / cargo fmt touched blocks | skip-mechanical | — | 0228 | Batch N: style-only churn; defer per DP-4. |
| **Batch O (~5 substantive)** | 2026-05-05..05-12 | ADR-180 ruvllm cache-reset + sparse-attention v0.1.1 + docs (ADR-183..193 family) | deferred | — | 0228 | Batch N+O: 5 older substantive upstream commits not yet picked (55eae8887, 4922b034f, 9d8006ae2, 068bb637a, 36912ba3e). Sparse-attention feature work + research docs. Fork doesn't currently consume these — defer to future sync ADR. |

## ruv-FANN

Dormant since 2026-02-09 (0 commits ahead) through 2026-05-22. Reactivated
2026-05-23 for Batch L security cherry-picks (ADR-0228).

| Upstream SHA | Date | Subject | Disposition | Local SHA | ADR | Notes |
|---|---|---|---|---|---|---|
| `9f373f0` | 2026-05-23 | fix: security patches, compile error, Adam decay bug, 9 new tests (v0.2.1) (#190) | cherry-picked | `ea968b2` | 0228 | Batch L. Clean cherry-pick — first post-dormancy row. |
| `1d93b35` | 2026-05-23 | fix(security): 25 NaN-panic fixes + RUSTSEC advisory documentation | cherry-picked | `708fcfd` | 0228 | Batch L. Clean cherry-pick. |

## agentdb

Caught up to upstream tip `a478ab3` (2026-05-06) per ADR-0161 extraction.
No upstream-fork delta tracked here yet; the `c2af4dc` pending hand-port
above (in agentic-flow section) will land here when executed.

| Upstream SHA | Date | Subject | Disposition | Local SHA | ADR | Notes |
|---|---|---|---|---|---|---|
| — | 2026-05-23 | delete(dead): remove src/services/federated-learning.ts (436 LOC) | fork-local | — | 0222 | Zero agentdb-internal callers confirmed by call-graph trace (F-06-004). Cross-fork controller-registry.ts refs in ruflo are a dormant gated case arm returning `false`; never instantiated by any live path. Also deleted examples/federated-learning-example.ts (stale example referencing the deleted service). |
| — | 2026-05-23 | fix(quarantine): ADR-0217 QUIC stack quarantine — delete QUICConnectionPool + QUICStreamManager; mark CRDT/JWT/VectorClock @internal; guard sync push/pull CLI; fix SyncCoordinator docstrings | fork-local | — | 0217 | Deleted src/controllers/QUICConnectionPool.ts + QUICStreamManager.ts (dead, never wired end-to-end). VectorClock/incrementVectorClock/createVectorClock retained as @public (agentic-flow autopilot-learning.ts runtime consumer). All CRDT/JWT types marked @internal. resolveConflicts + conflictStrategy marked @deprecated dead path. |
| `026011e` | 2026-05-23 | fix(security): bump vulnerable deps + harden JSON.parse in DB row readers (#3) | hand-ported | `1426b0a` | 0228 | Batch L. Kept fork version pin `3.0.0-alpha.14-patch.273`. ReasoningBank.ts top-of-file conflict: kept BOTH fork's `PatternNotFoundError` class (ADR-0219 F-04-001) AND upstream's `safeJsonParse<T>` helper (orthogonal additions). otel sdk-node 0.52→0.217 (GHSA-q7rr-3cgh-j5r3 Prometheus exporter crash). Auto-merged: ReflexionMemory.ts, SkillLibrary.ts, telemetry.ts. Lockfile --ours. |
| `d902f9e` | 2026-05-23 | fix(security): patch protobufjs critical CVE + 16 high-severity otel CVEs; harden execSync to spawnSync (#4) | cherry-picked | `716ddcf` | 0228 | Batch L. Clean cherry-pick (package.json auto-merged). |
| `1776223` | 2026-05-23 | fix(security): SQL injection (REINDEX), insecure PRNG for IDs, JSON.parse crash hardening | cherry-picked | `40f30b8` | 0228 | Batch L. Clean cherry-pick (input-validation.ts auto-merged). |

## Synced via ADR-0228 (2026-05-23 v3 close-out)

Batch T close-out. ADR-0228 ran across all 5 forks; ADR-0230 closed out
the deferred ADR-125 substrate picks. Both ADRs flip to `implemented`
2026-05-23T20:30Z. Full per-SHA details live in the rows above; this
table is the synopsis.

| Fork | Cherry-picked | Hand-ported | Skip-by-policy | Skip-mechanical | Superseded | Retargeted | Total disposed |
|---|---:|---:|---:|---:|---:|---:|---:|
| ruflo         | ~30 + 5 (ADR-125 phases) | ~8 | ~3 | ~6 (Batch S empty + roll-ups) | ~19 (Batch S source-conflict deferrals, future re-eval) | 0 | ~71 |
| agentic-flow  | 3 (CVEs #156/157/158) | 1 (override-conflict fix-up) | 0 | 1 (husky pre-commit removal) | 0 | 0 | 5 |
| ruvector      | 49 (Batch N data substrate) | 0 | 1 (banner image) | ~63 (52 NAPI binaries + 11 misc roll-ups) | 0 | 0 | ~113 |
| agentdb       | 3 (CVEs #3/#4 + REINDEX/PRNG) | 0 | 0 | 0 | 0 | 0 | 3 |
| ruv-FANN      | 2 (v0.2.1 #190 + 25 NaN-panic fixes) | 0 | 0 | 0 | 0 | 0 | 2 |
| **Total**     | **~92** | **~9** | **~4** | **~70** | **~19** | **0** | **~194** |

The ~19 ruflo `superseded` count refers to Batch S source-conflict
deferrals that stayed deferred (5 ADR-125 phases were re-disposed by
ADR-0230 → `cherry-picked`); the other 19 still await per-family
re-evaluation in a follow-up sync.

ADR-0230 (substrate re-convergence) executed within Move C window per
ADR-0229 Amendment 2026-05-23. All 5 deferred ADR-125 phases (1, 2, 3,
4, 5) plus the pre-landed Phases 6 + 7 now form a complete ADR-125
take. Per-phase landing SHAs are recorded in the ADR-0230 amendment
block (`docs/adr/0230-substrate-reconverge-upstream-adr125.md`).

All 10 confirmation criteria from ADR-0228 §Confirmation are
considered met by the per-fork green acceptance state at the close-out
timestamp (688/697 pass / 0 fail / 9 skip_accepted, sustained across
all step boundaries).

## Re-introduction guards

Paths the fork has **deleted by decision** that **still exist
upstream**. On the next upstream sync, apply `--ours` to these
paths to prevent the merge from re-introducing them. The cited
arch-tests trip immediately if a re-introduction slips through.

| Path | Deleted in | ADR | Upstream still ships | Arch-test guard |
|---|---|---|---|---|
| `forks/agentdb/src/services/federated-learning.ts` | `2026-05-23` fork-local | ADR-0222 | `ruvnet/agentdb/src/services/federated-learning.ts` (verified 2026-05-24) | `forks/agentdb/tests/unit/adr0217-adr0222-arch.test.ts` §"federated-learning file must not exist" + §"FederatedLearningManager must not appear in agentdb src/" |
| `forks/agentdb/examples/federated-learning-example.ts` | `2026-05-23` fork-local | ADR-0222 | `ruvnet/agentdb/examples/federated-learning-example.ts` (verified 2026-05-24) | (covered by the FederatedLearningManager grep above) |
| `forks/agentdb/src/controllers/QUICConnectionPool.ts` | `2026-05-23` fork-local | ADR-0217 | check upstream before next sync (file not currently in `ruvnet/agentdb/src/controllers/`) | `forks/agentdb/tests/unit/adr0217-adr0222-arch.test.ts` §"QUICConnectionPool file must not exist" |
| `forks/agentdb/src/controllers/QUICStreamManager.ts` | `2026-05-23` fork-local | ADR-0217 | check upstream before next sync (file not currently in `ruvnet/agentdb/src/controllers/`) | `forks/agentdb/tests/unit/adr0217-adr0222-arch.test.ts` §"QUICStreamManager file must not exist" |

**Sync runbook:**

1. Before merging upstream, run:
   ```bash
   for path in src/services/federated-learning.ts \
               examples/federated-learning-example.ts \
               src/controllers/QUICConnectionPool.ts \
               src/controllers/QUICStreamManager.ts; do
     git checkout HEAD -- "$path" 2>/dev/null || true
   done
   ```
   (or use `git merge -X ours` for the specific paths)
2. After merge, run `npx vitest run tests/unit/adr0217-adr0222-arch.test.ts`
   in `forks/agentdb` — must stay 13/13 green.
3. If arch-test goes red, the merge silently re-introduced a
   deleted file — revert that file and re-test before continuing.

## Notes / future work

* **No backfill yet** of ADR-0162 v1 landed batches (C+D / F / K hand-ports
  beyond the SHAs already cited above). Add as encountered during future
  audits.
* **Automation candidate** — a `scripts/upstream-ledger-audit.mjs` could
  diff this ledger against `git log forks/<fork>/main --grep="cherry picked
  from commit"` and flag missing rows. Out of scope for the initial seed.
* **Cross-reference enforcement** — the per-sync ADRs (ADR-0162, ADR-0186)
  should add an explicit close-out step "append rows to
  `docs/upstream/INTEGRATION-LEDGER.md`" so this file stays current.
