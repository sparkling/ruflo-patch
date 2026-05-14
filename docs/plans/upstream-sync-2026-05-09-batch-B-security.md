# Batch B — Security audit — agent analysis (2026-05-09)

Source: ADR-0162 Batch B. Produced by general-purpose research agent against `forks/ruflo` `main`. READ-ONLY analysis — no code applied.

Note: Names are still `@claude-flow/*` in source — rebrand happens via codemod at publish time.

## Per-commit classification

**`f8f4cd4bc` security: untrack .env files + broaden .gitignore** — **PARTIAL**. Fork's `.gitignore` already broadly blocks dot-files but does NOT block `.env.*` explicitly with `!.env.example` exception. `git ls-files` confirms `ruflo/src/ruvocal/.env` and `.env.ci` are STILL TRACKED in fork. `v3/goal_ui/.env` was deleted in the goal_ui rebrand, so only 2 of 3 untracks apply. Files: `.gitignore` + 2 .env files. Conflict: minor. **Should apply (filtered to existing files).**

**`bc399dc9a` sec: tighten npm overrides for protobufjs/tar/uuid** — **NOT_APPLIED**. Root `package.json` only has `"overrides": { "hono": ">=4.11.4" }`; no protobufjs/tar/uuid. `ruflo/package.json` has no `overrides` at all. Files: `package.json` + `ruflo/package.json`. Conflict: minor. **Apply** — strict additions, no rebrand interaction.

**`0535c3823` sec: cap MCP stdin buffer at 10MB** — **NOT_APPLIED**. `bin/cli.js` and `bin/mcp-server.js` both accumulate `buffer += chunk` with no upper bound. No `MCP_MAX_BUFFER_BYTES`. Conflict: clean. **Apply.**

**`5073f5673` fix(security): drop shell from git in statusline** — **NOT_APPLIED**. Both `statusline.js` and `statusline.cjs` still use `execSync('git config user.name 2>/dev/null || echo "user"', ...)` and `execSync('git branch --show-current 2>/dev/null || echo ""', ...)` — exact pre-fix pattern. Conflict: clean. **Apply.**

**`fb256ac59` fix(security): denylist loader-hijack env vars in terminal_create** — **NOT_APPLIED**. `validate-input.ts` has no `validateEnv`/`LD_PRELOAD`/`DYLD_*` denylist. Conflict: minor (fork added `validateQueenType`/`validateWorkerType` recently — no overlap). **Apply.**

**`de96b0eed` fix(security): restrict file mode on stores** — **PARTIAL/REWORK**. `src/fs-secure.ts` doesn't exist; `session-tools.ts`/`terminal-tools.ts` do (3 saveTerminalStore + 3 saveSession sites unprotected). BUT `memory/memory-initializer.ts` was DELETED in fork commit `f2f86193a` (ADR-0086 Debt 7). Cherry-pick will hit a delete/modify conflict. Conflict: **major** on memory-initializer.ts (skip that hunk, apply to remaining 3). **Apply with manual hunk drop.**

**`bbe53a21c` test(security): regression tests for validateEnv + fs-secure** — **NOT_APPLIED**. No `validate-input-env.test.ts` or `fs-secure.test.ts` in fork. Tests **depend on** `de96b0eed` (fs-secure.ts) and `fb256ac59` (validateEnv). Conflict: clean. **Apply AFTER `de96b0eed` and `fb256ac59`.**

**`d9fd35956` fix(security): add fetch timeouts to verify + IPFS HEAD** — **PARTIAL**. `src/commands/verify.ts` does NOT exist in fork (deleted/renamed). `src/transfer/ipfs/upload.ts` exists; the HEAD probe `fetch(${gateway}/ipfs/${cid}, { method: 'HEAD' })` has no timeout. Conflict: **major** on verify.ts (skip), minor on upload.ts. **Apply only the upload.ts hunk.**

**`3baebe177` fix(security): close command injection in github-safe.js** — **PARTIAL/REWORK**. Fork file is `github-safe.mjs` (renamed in `7e3700c21`); a copy also lives at `v3/@claude-flow/mcp/.claude/helpers/github-safe.js`. Both still use template-string `execSync(\`gh ${args.join(' ')}\`)` — exactly the unsafe pattern. Conflict: **major** (path mismatch + 113-line rewrite). **Apply manually to both .mjs and .js variants** — not a clean cherry-pick.

**`73babfb06` fix(security): close shell injection in github-tools MCP** — **NOT_APPLIED**. `github-tools.ts` (363 lines) has no `runArgv`/`toPositiveInt`/`sanitizeLabels`/`execFileSync`. Conflict: minor. **Apply.**

**`c1b57e4fd` fix(security): close shell injection in update/executor** — **NOT_APPLIED**. `update/executor.ts` still has `const installCmd = \`npm install ${update.package}@${update.latestVersion} --save-exact\`; execSync(installCmd, ...)` — exact pre-fix pattern at 2 sites. Conflict: clean. **Apply.**

**`367313824` fix(security): retry plain import + actionable error for aidefence** — **NOT_APPLIED**. `security-tools.ts:loadAIDefence` matches the pre-fix flow exactly: import → autoInstall → `file://` import → cryptic "Try restarting" error. No second plain `import(pkg)` retry between install and file://. `doctor.ts` has no `checkAIDefence`. Conflict: minor. **Apply.**

**`ed6d847fa` fix(security): drop bcrypt → bcryptjs** — **NOT_APPLIED**. `v3/@claude-flow/security/package.json` declares `"bcrypt": "^5.1.1"` + `@types/bcrypt` devDep. `password-hasher.ts` imports `from 'bcrypt'`. Pulls full tar CVE chain. Conflict: minor on package.json/source. Lockfile regeneration recommended over cherry-picking 182-line lockfile diff. **Apply manually (no lockfile cherry-pick).**

**`b9e2eb37e` fix(deps): bump vitest pins to ^4.0.16** — **NOT_APPLIED**. Confirmed: aidefence `^1.1.0`, browser `^2.0.0`, codex `^1.4.0`, plugin-agent-federation `^1.6.0`, plugin-iot-cognitum `^1.6.0`, testing peerDep `>=1.0.0`. Conflict: clean on package.json. **Apply manually (regenerate lockfile, don't cherry-pick 734-line lockfile diff).**

**`d5fbb3bc4` fix(hooks): stop creating empty files via $TOOL_INPUT shell injection** — **NOT_APPLIED**. `plugin/hooks/hooks.json` shows the unsafe `command: "npx claude-flow@alpha hooks pre-edit --file \"$TOOL_INPUT_file_path\""` pattern at every command hook. Conflict: clean. **Apply** (note: `claude-flow@alpha` strings will be rebranded by codemod at publish).

## Recommended cherry-pick order

```
1. f8f4cd4bc   .env untrack + .gitignore (drop v3/goal_ui/.env hunk — already gone)
2. bc399dc9a   npm overrides hardening
3. 0535c3823   MCP stdin DoS cap
4. 5073f5673   statusline shell drop
5. fb256ac59   validateEnv loader-hijack denylist
6. de96b0eed   fs-secure.ts + writeFileRestricted (DROP memory-initializer.ts hunk — deleted in fork)
7. bbe53a21c   regression tests (depends on #5+#6)
8. d9fd35956   IPFS HEAD timeout (DROP verify.ts hunk — file doesn't exist)
9. 73babfb06   github-tools.ts shell injection
10. c1b57e4fd  update/executor.ts shell injection
11. 367313824  aidefence retry + doctor probe
12. ed6d847fa  bcrypt → bcryptjs (manual; skip pnpm-lock.yaml hunk)
13. b9e2eb37e  vitest ^4.0.16 (manual; skip pnpm-lock.yaml hunk; regenerate after)
14. d5fbb3bc4  plugin/hooks/hooks.json stdin-jq pattern
15. 3baebe177  github-safe.js (MANUAL — fork uses .mjs path + has 2 copies in mcp/cli)
```

## Verdaccio / rebrand risk

- **`ed6d847fa`** modifies `@claude-flow/security/package.json` and bumps to `3.0.0-alpha.7`. Fork is at `3.0.0-alpha.6-patch.447`; cherry-pick will conflict on the version field. Resolution: keep fork version pin, apply only the `bcrypt → bcryptjs` dep swap and `@types/bcrypt` removal. Codemod handles `@claude-flow/security` → `@sparkleideas/security` at publish.
- **`b9e2eb37e`** touches 6 package.json `vitest` devDep ranges — purely version bumps. No interaction with rebrand.
- **`bc399dc9a`** adds new override keys (protobufjs/tar/uuid) alongside fork's existing `hono` override — strict superset, no rebrand-aware handling.
- **All pnpm-lock.yaml hunks** — regenerate via `cd v3 && pnpm install --no-frozen-lockfile` AFTER applying the source changes; don't cherry-pick lockfile hunks.

## Post-batch verification

```bash
cd /Users/henrik/source/forks/ruflo

# 1. Build still clean
cd v3/@claude-flow/cli && npm run build && cd ../../..

# 2. Security regression tests pass
cd v3/@claude-flow/cli && npx vitest run \
  __tests__/validate-input-env.test.ts \
  __tests__/fs-secure.test.ts \
  __tests__/github-tools-injection.test.ts \
  __tests__/update-executor-injection.test.ts && cd ../../..

# 3. .env files no longer tracked
git ls-files | grep -E "^ruflo/src/ruvocal/\.env(\.|$)" && echo "FAIL — still tracked" || echo "OK"

# 4. npm overrides include all 4 keys
node -e "const p=require('./package.json');console.log(Object.keys(p.overrides||{}))"
# expected: hono, protobufjs, tar, uuid

# 5. No remaining unsafe shell-string execSync in security-critical files
grep -nE "execSync\(\\\`[^']*\\\$\{" \
  v3/@claude-flow/cli/src/mcp-tools/github-tools.ts \
  v3/@claude-flow/cli/src/update/executor.ts \
  v3/@claude-flow/cli/.claude/helpers/statusline.{js,cjs} && echo "FAIL" || echo "OK"

# 6. bcryptjs (not bcrypt) is the security dep
grep -E '"bcrypt"|"bcryptjs"' v3/@claude-flow/security/package.json
# expected: "bcryptjs": "^3.0.3"

# 7. plugin/hooks/hooks.json uses stdin-jq pattern, no $TOOL_INPUT inline interpolation
grep -c '\$TOOL_INPUT' plugin/hooks/hooks.json
# expected: 0
```

## Key findings

- All 15 commits represent NEW security work upstream; fork has zero equivalents.
- 4 commits need partial application due to fork-specific divergence: `f8f4cd4bc` (1 of 3 .env files gone), `de96b0eed` (memory-initializer deleted), `d9fd35956` (verify.ts missing), `3baebe177` (github-safe.js renamed to .mjs + duplicated in mcp/).
- 2 commits (`ed6d847fa`, `b9e2eb37e`) ship large lockfile diffs — apply source-only, regenerate lockfile.
- Test commit `bbe53a21c` strictly depends on prior application of `de96b0eed` + `fb256ac59`.
- Recommended order proceeds low-risk → high-risk; `3baebe177` last because it requires manual file-path remapping.
