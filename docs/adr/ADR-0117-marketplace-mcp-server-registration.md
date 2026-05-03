# ADR-0117: Marketplace plugin MCP server registration (`ruflo` key, fork CLI)

- **Status**: ⚠ **Revising 2026-05-03** — Phases 1-4 of original Decision shipped in code (dual-namespace via umbrella `plugin.json` `mcpServers`); now unwinding to the **service-method** approach (init-time registration via `mcp-generator.ts`). See §Revision 2026-05-03.
- **Date**: 2026-05-02 (initial), 2026-05-03 (revision)
- **Deciders**: Henrik Pettersen
- **Depends on**: ADR-0113 (plugin system integration completion), ADR-0116 (hive-mind marketplace plugin)
- **Scope**: Fork-side artifact for `sparkling/ruflo` distribution. Per `feedback-no-upstream-donate-backs.md`, this stays on `sparkling/main`; we do not file a PR against `ruvnet/ruflo`.

## Revision 2026-05-03 — switch to service-method registration

**What changed.** On user review of the implemented dual-namespace path, two facts converged:

1. **All 33 marketplace plugins** (verified: zero `mcpServers` blocks and zero `npx` command entries across `forks/ruflo/plugins/*/.claude-plugin/plugin.json`) follow a uniform "service method" pattern — minimal manifest, markdown-only `agents/commands/skills`, with skill bodies referencing `mcp__ruflo__*` tools that are expected to resolve via a single MCP server registered **once** at init time, not per-plugin.
2. **The original Decision** registered a parallel `mcpServers.ruflo` entry inside the umbrella `forks/ruflo/.claude-plugin/plugin.json` — a per-plugin-manifest registration mechanism that **none of the other 33 plugins use**. This makes the umbrella plugin a structural outlier and reintroduces the same "two competing names for the same service" anti-pattern the first rejected draft was rejected for.

**The corrected approach** is the service-method path (closely related to the second rejected draft, but scoped narrowly to MCP-server registration only — env vars, project dirs, OS data dirs explicitly stay out of scope as orthogonal naming concerns):

- **Init registers `mcpServers['ruflo']`** (one server, exposing tools as `mcp__ruflo__*`) — `forks/ruflo/v3/@claude-flow/cli/src/init/mcp-generator.ts:95`
- **9 init-bundled skill files** referencing `mcp__claude-flow__*` flip to `mcp__ruflo__*`
- **Umbrella `plugin.json` `mcpServers` block** is removed (or, if upstream-merge churn forces it to keep returning, becomes a no-op duplicate of init's registration that Claude Code dedupes)
- **`hooks.json` shellouts** continue to invoke `@sparkleideas/cli@latest` — orthogonal to MCP server registration; unrelated keep
- **Codemod Pass 5** continues to guard against `claude-flow@alpha` re-introduction in `.claude-plugin/**` and `plugins/**` — orthogonal keep
- **Acceptance check** updated to assert init registers `ruflo` (not `claude-flow`), and that no `mcpServers` block in the umbrella `plugin.json` shadows it

The original Decision's three "future fix" alternatives (§Decision lines 49-52) are now this Revision's actual plan. The trade-off the original Decision made — accept ~75 token bloat to avoid editing init — was wrong: editing init is cheap (1 line key flip + 9 init-bundled skill ref flips), and avoids leaving the umbrella plugin as a structural outlier among the 33.

**What was already implemented under the original Decision** (verified 2026-05-03 — these are the rollback targets, not aspirational):

| Phase | File | Current state | Action |
|---|---|---|---|
| 1 | `forks/ruflo/.claude-plugin/plugin.json` | Has `mcpServers.ruflo` running `@sparkleideas/cli@latest mcp start` | **Revert** the `mcpServers` block to absent (or restore the original `claude-flow@alpha` form so codemod Pass 5 can rewrite it deterministically) |
| 2 | `forks/ruflo/.claude-plugin/hooks/hooks.json` | All 5 shellouts use `@sparkleideas/cli@latest` | **Keep** — orthogonal to MCP server registration |
| 3 | `scripts/codemod.mjs` Pass 5 | Rewrites `claude-flow@alpha` → `@sparkleideas/cli@latest` in `.claude-plugin/**` + `plugins/**` | **Keep** — orthogonal to MCP server registration |
| 4 | `lib/acceptance-adr0117-marketplace-mcp.sh` | Asserts marketplace `mcpServers.ruflo` exists | **Rewrite** — assert init `mcpServers.ruflo` exists; assert umbrella `plugin.json` has no MCP-server-registration block |

See §Implementation plan (revised 2026-05-03) below for the corrected phase sequence.

## Adversarial-review history

This ADR went through three rejected drafts before arriving at the current scope. Each rejection narrowed the scope further:

1. **First draft — dual namespace, parallel servers.** Init keeps `claude-flow`-keyed server; marketplace adds a parallel `ruflo`-keyed server. Rejected: *"Why would you have 2 competing names for the same service?"*
2. **Second draft — MCP-namespace-only flip in init.** Single namespace `ruflo`; flip init's server-key + 9 init-bundled skill files + 2 init-time generators. Skip env vars, project dirs, OS data dirs. Rejected: *"We need this ADR to make all required changes, not to defer."*
3. **Third draft — wholesale `claude-flow` → `ruflo` rebrand.** 10 phases, ~522 files (helper scripts, bin scripts, Codex initializer, env vars, project dirs, OS data dirs, atomic writer+reader flips, migration plan). Rejected: *"All we need is for the plugins to work. The wholesale removal of claude-flow is a massive undertaking."*

Each rejection was internally consistent, but they pull in opposite directions: (1) wants single namespace, (2) wants no-defer completeness, (3) wants minimal scope. The only point that satisfies all three is to **define the goal narrowly: make plugin marketplace installs work end-to-end** — then accept whichever side-effect cost is smallest.

The smallest-cost solution is to register the marketplace plugin's MCP server under a different key (`ruflo`) than init's (`claude-flow`), point both at the same fork-CLI binary, and accept dual-namespace exposure when both are installed. This trades ~75 redundant tool entries in the system prompt for a 5-file change instead of 522.

## Context

ADR-0113 Phase C (`b24e46829`) rebranded plugin documentation: 524 occurrences across 121 `.md` files in `forks/ruflo/plugins/**` and `.claude-plugin/**` flipped from `mcp__claude-flow__*` to `mcp__ruflo__*`. ADR-0113 Phase D (`64491a274`) renamed bin self-id log tags to `[ruflo-mcp]`. The MCP server announces `name: 'ruflo'` (`mcp-server.ts:367,471`).

But Claude Code's MCP tool-namespace prefix is `mcp__<key>__<tool>` where `<key>` is the user-visible server name in `.mcp.json` (or in a plugin's `mcpServers` block) — **not** the server's announced `name` field. ADR-0113's audit-finding #3 (corrected 2026-05-02) conflated the two.

Empirical state in the fork (verified `/tmp/ruflo-e2e-rZHup/`, 2026-05-01):

| Surface | Path | Current value | Effect |
|---|---|---|---|
| Init MCP server registration | `forks/ruflo/v3/@claude-flow/cli/src/init/mcp-generator.ts:95` | `mcpServers['claude-flow']` running `@sparkleideas/cli@latest mcp start` | Init exposes tools as `mcp__claude-flow__*`; init-bundled skills (9 files, 75 refs) match this |
| Marketplace MCP entry | `forks/ruflo/.claude-plugin/plugin.json:52-57` | `mcpServers."claude-flow"` running `npx claude-flow@alpha mcp start` | (a) duplicate key collides with init's; (b) wrong package — pulls original upstream from public npm, not the fork |
| Marketplace hooks | `forks/ruflo/.claude-plugin/hooks/hooks.json` | 5× `npx claude-flow@alpha hooks <subcmd>` | Wrong package |
| Plugin skill MCP refs | `forks/ruflo/plugins/**/SKILL.md` | 121 files, 524 `mcp__ruflo__*` refs | No `ruflo`-keyed server registered → refs resolve to nothing |

The init surface is internally consistent and works. Only the marketplace surface is broken, in two ways: wrong server-key (so plugin docs' `mcp__ruflo__*` refs don't resolve) and wrong package (the args spawn upstream's public-npm package instead of the fork's CLI).

## Decision (superseded 2026-05-03 — see §Decision (revised 2026-05-03) below)

**Register the marketplace plugin's MCP server under the key `ruflo`, pointing at the fork-published CLI.** Init stays unchanged on `claude-flow`. When both surfaces are installed, two MCP server registrations exist (`claude-flow` and `ruflo`), both spawning the same `@sparkleideas/cli mcp start` binary, exposing the same tools under two namespace prefixes.

After this ADR lands:
- Marketplace `.claude-plugin/plugin.json` registers `mcpServers.ruflo` running `npx @sparkleideas/cli@latest mcp start`
- Marketplace `.claude-plugin/hooks/hooks.json` shells out to `npx @sparkleideas/cli@latest hooks <subcmd>` (5 occurrences)
- Init continues to register `mcpServers.claude-flow` running the same binary; init-bundled skills/agents/commands continue to reference `mcp__claude-flow__*`
- Plugin skill docs (524 `mcp__ruflo__*` refs) actually resolve because Claude Code now exposes a `ruflo` namespace
- Codemod gets one new pass to keep `claude-flow@alpha` from sneaking back via upstream merges

The dual-namespace cost is bounded and easy to revisit. If the system-prompt token bloat from listing ~75 tools twice becomes a measured problem, the future fix is one of:
- Have init only register a `ruflo` server (forwards-compatible, but scope of full rebrand)
- Have marketplace not register a server at all (rely on init's `claude-flow` server, revert plugin docs)

This ADR doesn't preempt those.

## Decision (revised 2026-05-03)

**Register the `ruflo` MCP server via init's service-method**, not via the umbrella plugin's `mcpServers` block. After this revision lands:

- Init's `mcp-generator.ts` registers `mcpServers['ruflo']` running the fork CLI binary
- The 9 init-bundled skill files referencing `mcp__claude-flow__*` flip to `mcp__ruflo__*`
- The umbrella `forks/ruflo/.claude-plugin/plugin.json` no longer carries an `mcpServers` block (matches the structural pattern of the other 33 marketplace plugins, all of which have minimal manifests)
- Plugin skill docs (524 `mcp__ruflo__*` refs across 121 files) resolve via init's single `ruflo` registration — same path the other 33 plugins assume
- `hooks.json` and codemod Pass 5 are kept (orthogonal — they enforce "fork CLI not upstream CLI" regardless of the MCP server registration mechanism)

**Out of scope** (deliberately, to keep this revision narrow):
- Renaming `.claude-flow/` project dir, `CLAUDE_FLOW_*` env vars, OS data dirs, or any infrastructure naming. Those are different concerns from MCP-server tool-namespace resolution and live in a separate (not-yet-written) ADR if anyone wants them flipped.
- Removing the marketplace's `claude-flow`-keyed entries from upstream USERGUIDE prose or marketplace metadata. The wholesale rebrand path (Alternative A) remains rejected.

## Implementation plan (revised 2026-05-03)

7 files touched. Phases group into 3 PRs + 1 manual verification step. Sequencing matters because flipping init's server-key without updating the 9 init-bundled skills would break tool resolution for `init --full` users until Phase R3 lands.

### Sequencing & gates (revised)

| PR | Phases | Files | Gate before merge |
|---|---|---|---|
| R-1 | Phase R1 (init flip) + Phase R2 (init-bundled skills) | `forks/ruflo/v3/@claude-flow/cli/src/init/mcp-generator.ts` (1 line) + 9 skill files under `forks/ruflo/v3/@claude-flow/cli/.claude/skills/**/SKILL.md` | After re-init in `/tmp/ruflo-init-test/`, generated `.mcp.json` shows `mcpServers.ruflo` (not `mcpServers['claude-flow']`); init-bundled skill `allowed-tools:` frontmatter shows zero `mcp__claude-flow__*` refs |
| R-2 | Phase R3 (umbrella plugin.json revert) + Phase R4 (acceptance rewrite) | `forks/ruflo/.claude-plugin/plugin.json` (remove `mcpServers` block) + `lib/acceptance-adr0117-marketplace-mcp.sh` (rewrite assertions) | `grep -c '"mcpServers"' forks/ruflo/.claude-plugin/plugin.json` returns `0`; acceptance asserts init registers `ruflo` |
| R-3 | Phase R5 (codemod regression test refresh) | `tests/pipeline/codemod.test.mjs` | Test cases updated to reflect new state — Pass 5 still rewrites `claude-flow@alpha` in non-source files; positive/negative test pairs still pass |

Phase R6 (real-install verification) gates the Status field flip from "Revising" → "Accepted", **not** any individual PR landing.

**Order rationale**:
- R-1 first: init must register `ruflo` before users running `ruflo init` can resolve `mcp__ruflo__*` refs from the marketplace plugins they install.
- R-2 second: removing the umbrella's `mcpServers` block would break tool resolution if R-1 hasn't landed (no `ruflo` registration anywhere).
- R-3 last: codemod regression tests verify the build pipeline doesn't reintroduce the wrong patterns. Sequencing R-3 before R-2 risks asserting against state that doesn't exist yet.

**Rollback per PR**:
- R-1 — revert `mcp-generator.ts` server-key + 9 skill files; init-bundled skill refs go back to `mcp__claude-flow__*`. Marketplace plugin refs (524 `mcp__ruflo__*`) become unresolvable again, matching pre-Phase-1 state.
- R-2 — restore `mcpServers` block in umbrella `plugin.json`; restore old acceptance assertions. Returns to dual-namespace state from the original Decision.
- R-3 — revert codemod test updates; Pass 5 itself stays.

### Phase R1 — Init MCP server-key flip

`forks/ruflo/v3/@claude-flow/cli/src/init/mcp-generator.ts`:

```diff
   if (config.claudeFlow) {
-    mcpServers['claude-flow'] = createRufloEntry(
+    mcpServers['ruflo'] = createRufloEntry(
       {
         ...npmEnv,
         CLAUDE_FLOW_MODE: 'v3',
```

Note: env var names (`CLAUDE_FLOW_*`) and the `config.claudeFlow` config-field name stay unchanged. This phase only flips the **MCP server-key** (the user-visible namespace prefix). Infrastructure naming is out of scope per §Decision (revised) "Out of scope."

### Phase R2 — Init-bundled skill file ref flip

9 SKILL.md files under `forks/ruflo/v3/@claude-flow/cli/.claude/skills/` reference `mcp__claude-flow__*` in their `allowed-tools:` frontmatter. Flip every occurrence to `mcp__ruflo__*`.

Find them:
```bash
grep -rl 'mcp__claude-flow__' forks/ruflo/v3/@claude-flow/cli/.claude/skills/
```

Codemod-driven flip (additive — doesn't conflict with existing Pass 4):
```bash
find forks/ruflo/v3/@claude-flow/cli/.claude/skills/ -name 'SKILL.md' -exec \
  sed -i 's/mcp__claude-flow__/mcp__ruflo__/g' {} +
```

Verify no remaining refs in init-bundled skills before commit:
```bash
grep -r 'mcp__claude-flow__' forks/ruflo/v3/@claude-flow/cli/.claude/skills/ && exit 1 || true
```

### Phase R3 — Remove umbrella plugin.json mcpServers block

`forks/ruflo/.claude-plugin/plugin.json` lines 51-70:

```diff
   "engines": {
     "claudeCode": ">=2.0.0",
     "node": ">=20.0.0"
-  },
-  "mcpServers": {
-    "ruflo": {
-      "command": "npx",
-      "args": ["@sparkleideas/cli@latest", "mcp", "start"],
-      "description": "...",
-      "optional": false
-    },
-    "ruv-swarm": { ... },
-    "flow-nexus": { ... }
   }
+  }
 }
```

Rationale: removing the entire `mcpServers` block makes the umbrella `plugin.json` structurally identical to the 33 sub-plugin manifests (none of which carry `mcpServers`). Init's registration handles the `ruflo` server; users who want `ruv-swarm` or `flow-nexus` register those separately via `claude mcp add` or via `ruflo init` flags (not in scope for this ADR — those are independent MCP servers, not duplicates of the fork CLI).

### Phase R4 — Acceptance check rewrite

`lib/acceptance-adr0117-marketplace-mcp.sh` — replace assertions:

| Old assertion (Phases 1-4) | Revised assertion |
|---|---|
| `forks/ruflo/.claude-plugin/plugin.json` has `mcpServers.ruflo` | `forks/ruflo/.claude-plugin/plugin.json` has **no** `mcpServers` block |
| Marketplace `plugin.json` has zero `claude-flow@alpha` strings | (kept) |
| Codemod doesn't undo `mcpServers.ruflo` rename | Codemod doesn't reintroduce `mcpServers` block on rebuild |
| Plugin SKILL.md `allowed-tools:` `mcp__ruflo__*` resolve against `tools/list` | (kept — but verify resolution is via init's `ruflo` server, not via per-plugin registration) |
| (new) | After `ruflo init` in `/tmp/ruflo-init-test/`, generated `.mcp.json` has `mcpServers.ruflo` running fork CLI |
| (new) | After `ruflo init`, no `.mcp.json` entry has `mcpServers['claude-flow']` |

### Phase R5 — Codemod regression tests

Pass 5 stays — its target (`claude-flow@alpha` → `@sparkleideas/cli@latest`) is orthogonal to the MCP-server-key concern. Update test cases in `tests/pipeline/codemod.test.mjs` to reflect:

- Marketplace `plugin.json` has no `mcpServers` block (test that codemod doesn't add one)
- 9 init-bundled SKILL.md files have `mcp__ruflo__*` (existing Pass 4 still applies, but now the input and expected output both use `ruflo`)

### Phase R6 — Verification on a real install

After R-1, R-2, R-3 land and the fork is republished to Verdaccio:
1. Re-init this repo (or any test project): `ruflo init upgrade --add-missing`
2. Inspect generated `.mcp.json`: must show `mcpServers.ruflo` pointing at fork CLI
3. Install one marketplace plugin via Claude Code: `/plugin marketplace add sparkling/ruflo` then `/plugin install ruflo-rag-memory@ruflo`
4. Restart the Claude Code session
5. At session start, deferred-tool list includes `mcp__ruflo__memory_search` (resolved via init's server, not via per-plugin registration)
6. Invoke `mcp__ruflo__memory_search` from a test prompt; observe success
7. Confirm `mcp__claude-flow__*` tools are NOT in the deferred-tool list (no parallel server)

If step 7 shows `mcp__claude-flow__*` still listed, an upstream-merged file or another generator is still emitting the old key — `grep -rn "'claude-flow'" forks/ruflo/v3/@claude-flow/cli/src/init/` to find it.

## Implementation plan (original — superseded 2026-05-03)

5 files touched. Phases group into 3 PRs + 1 manual verification step.

### Sequencing & gates

| PR | Phases | Files | Gate before merge |
|---|---|---|---|
| 1 | Phase 1 + 2 (content) | `forks/ruflo/.claude-plugin/{plugin.json, hooks/hooks.json}` | `grep -rE "claude-flow@alpha" forks/ruflo/.claude-plugin/` returns zero matches; existing init's `mcpServers.claude-flow` (in `mcp-generator.ts:95`) is **untouched** |
| 2 | Phase 3 (codemod regression) | `scripts/codemod.mjs`, `tests/pipeline/codemod.test.mjs` | `npm run test:pipeline` green; both positive AND negative test cases pass; running codemod twice on the same input is byte-stable |
| 3 | Phase 4 (acceptance) | `lib/acceptance-adr0117-marketplace-mcp.sh`, `scripts/test-acceptance.sh` | `npm run test:acceptance` green; check enforces zero `claude-flow@alpha` strings post-codemod |

Phase 5 (real-install dual-namespace verification) gates the ADR Status flip from Proposed → Accepted, **not** any individual PR landing. Phase 5 needs a Verdaccio republish (the fork CLI must be installable as `@sparkleideas/cli@latest`) and a real Claude Code session.

**Order rationale**:
- PR 1 first: content-only edits; no logic changes. Even if PR 1 alone shipped, no regression vs. today (current `claude-flow@alpha` args are also broken — they pull upstream public-npm package).
- PR 2 second: hardens the build pipeline against future upstream-merge regressions reintroducing `claude-flow@alpha`. Reversing PR 1 ↔ 2 leaves codemod tests with no real input to assert against.
- PR 3 third: verifies the combined state. Reversing PR 2 ↔ 3 risks acceptance passing on a build that lacks the regression test (false confidence).

**Rollback per PR**:
- PR 1 — revert the `.claude-plugin/` edits; restores the prior (also-broken) state, no functional regression because nothing currently consumes those broken refs
- PR 2 — revert codemod.mjs Pass 5 + test cases; existing 4 passes continue working
- PR 3 — revert acceptance script + `test-acceptance.sh` wiring

**Cross-ADR coupling with ADR-0116**: PR 3's acceptance check (AC #4) requires plugin SKILL.md `allowed-tools:` references to resolve against `@sparkleideas/cli mcp start`'s `tools/list` output. The `ruflo-hive-mind` plugin from ADR-0116 must already exist in the fork before PR 3 can pass — sequence ADR-0116's Commit 2 (first materialise run) **before** ADR-0117 PR 3.

### Phase 1 — Marketplace `plugin.json` MCP entry

`forks/ruflo/.claude-plugin/plugin.json:51-57`:

```diff
   "mcpServers": {
-    "claude-flow": {
+    "ruflo": {
       "command": "npx",
-      "args": ["claude-flow@alpha", "mcp", "start"],
+      "args": ["@sparkleideas/cli@latest", "mcp", "start"],
       "description": "Core Ruflo MCP server for swarm coordination, agent management, and task orchestration",
       "optional": false
     },
```

The `ruv-swarm` and `flow-nexus` entries below are unchanged (different packages, intentional).

### Phase 2 — Marketplace `hooks.json` shellouts

`forks/ruflo/.claude-plugin/hooks/hooks.json` lines 9, 18, 29, 38, 68:

`npx claude-flow@alpha hooks <subcmd>` → `npx @sparkleideas/cli@latest hooks <subcmd>` (5 occurrences). Subcommands referenced: `modify-bash`, `modify-file`, `post-command`, `post-edit`, `session-end`. Verify they exist in the fork CLI before merging:

```bash
grep -nE "name: '(modify-bash|modify-file|post-command|post-edit|session-end)'" \
  forks/ruflo/v3/@claude-flow/cli/src/commands/hooks.ts
```

### Phase 3 — Codemod regression defense

`scripts/codemod.mjs` already rewrites `mcp__claude-flow__<tool>` → `mcp__ruflo__<tool>` (Pass 4) and adds `.md` to `ALLOWED_EXTENSIONS`. Add one new pass to catch `claude-flow@alpha` reintroductions on future upstream merges:

| Pass | Pattern | Replacement | Scope |
|---|---|---|---|
| 5 (new) | `claude-flow@alpha` | `@sparkleideas/cli@latest` | `.claude-plugin/**/*.{json,md}` and `plugins/**/*.{json,md}` only — not source code, not docs/adr |

Test cases in `tests/pipeline/codemod.test.mjs`:

| Input | Expected output | Negative case |
|---|---|---|
| `npx claude-flow@alpha hooks modify-bash` (in `.claude-plugin/hooks/hooks.json`) | `npx @sparkleideas/cli@latest hooks modify-bash` | Same string in `docs/adr/**` MUST NOT be rewritten |
| `"args": ["claude-flow@alpha", "mcp", "start"]` (in `.claude-plugin/plugin.json`) | `"args": ["@sparkleideas/cli@latest", "mcp", "start"]` | Same string in upstream-merged `v3/@claude-flow/cli/src/**` source comments MUST NOT be rewritten |

Note: Pass 5 does NOT rewrite the bare `'claude-flow'` server-key string — that's intentional. Init keeps `mcpServers['claude-flow']` (no change to `mcp-generator.ts:95`); only the marketplace's distinct `mcpServers.ruflo` entry is added by Phase 1.

### Phase 4 — Acceptance check

Add `lib/acceptance-adr0117-marketplace-mcp.sh` wired into `scripts/test-acceptance.sh` post-init phase. Asserts:

1. `forks/ruflo/.claude-plugin/plugin.json` has `mcpServers.ruflo`, no `mcpServers."claude-flow"` (the marketplace's old key removed)
2. `forks/ruflo/.claude-plugin/plugin.json` and `.claude-plugin/hooks/hooks.json` together contain zero `claude-flow@alpha` strings
3. After codemod runs in `/tmp/ruflo-build/`: `.claude-plugin/plugin.json` and `hooks.json` carry over the same `mcpServers.ruflo` and `@sparkleideas/cli@latest` (i.e., codemod doesn't undo or re-flip them)
4. Plugin skill `allowed-tools:` frontmatter referencing `mcp__ruflo__<tool>` matches a tool name actually emitted when the fork CLI MCP server is queried via JSON-RPC `tools/list`. Test approach: spawn `@sparkleideas/cli mcp start`, send `{"method":"tools/list"}`, capture the response, assert ≥ 1 tool name where `frontmatter[allowed-tools]` contains `mcp__ruflo__<that-tool-suffix>`.

### Phase 5 — Verification on a real install

After Phases 1-4 land and the fork is republished to Verdaccio:
1. Re-init this repo (or any test project): `ruflo init upgrade --add-missing`
2. Install one marketplace plugin via Claude Code: `/plugin marketplace add sparkling/ruflo` then `/plugin install ruflo-rag-memory@ruflo`
3. Restart the Claude Code session so it loads the plugin's `mcpServers.ruflo` entry
4. At session start, deferred-tool list should include both `mcp__claude-flow__memory_search` (from init's server) AND `mcp__ruflo__memory_search` (from marketplace's server)
5. Invoke `mcp__ruflo__memory_search` from a test prompt; observe success

If step 5 fails, debug Claude Code's plugin loader to verify it actually picks up the marketplace's `mcpServers.ruflo` declaration. (Risk: Claude Code may dedupe by command-line, since both servers spawn the same binary. If so, the dual-namespace approach doesn't actually work and the fallback Alternative B becomes the necessary path.)

## Acceptance criteria (revised 2026-05-03)

Original Phases 1-4 acceptance — checked off because the work landed in code; Revision unwinds them.

- [x] ~~Phase 1~~ (superseded): `forks/ruflo/.claude-plugin/plugin.json` mcpServers key flipped to `ruflo` — landed; **Phase R3 removes the entire block**
- [x] Phase 2: `forks/ruflo/.claude-plugin/hooks/hooks.json` 5× `@sparkleideas/cli@latest` (kept — orthogonal to MCP key concern)
- [x] Phase 3: codemod Pass 5 lands with positive + negative test pairs (kept — Phase R5 refreshes test cases for new state)
- [x] ~~Phase 4~~ (superseded): `lib/acceptance-adr0117-marketplace-mcp.sh` — landed; **Phase R4 rewrites assertions**

Revised acceptance:

- [ ] Phase R1: `forks/ruflo/v3/@claude-flow/cli/src/init/mcp-generator.ts` registers `mcpServers['ruflo']` (single line key flip)
- [ ] Phase R2: 9 init-bundled SKILL.md files under `forks/ruflo/v3/@claude-flow/cli/.claude/skills/` flipped from `mcp__claude-flow__*` to `mcp__ruflo__*`
- [ ] Phase R3: `forks/ruflo/.claude-plugin/plugin.json` has no `mcpServers` block
- [ ] Phase R4: `lib/acceptance-adr0117-marketplace-mcp.sh` rewritten to assert init-side registration + absence of umbrella `mcpServers`
- [ ] Phase R5: codemod regression tests refreshed for new state in `tests/pipeline/codemod.test.mjs`
- [ ] `npm run test:unit` green
- [ ] `npm run release` green (full pipeline)
- [ ] Phase R6: in a real Claude Code session with marketplace plugin installed, `mcp__ruflo__*` tools resolve via init's single `ruflo` server registration (not via per-plugin registration); no `mcp__claude-flow__*` tools listed

## Risks

1. **Dual-namespace token cost.** When both init and marketplace are installed (most installs), the system prompt lists ~75 tools twice — once as `mcp__claude-flow__*`, once as `mcp__ruflo__*`. Bounded cost, reversible by future ADR if measurement shows it matters.
2. **Claude Code may dedupe identical-binary MCP server registrations.** If the loader sees init's `mcpServers.claude-flow` and marketplace's `mcpServers.ruflo` both spawning `npx @sparkleideas/cli@latest mcp start`, it could collapse them into one server (under whichever key it sees first), exposing tools under only one namespace. Phase 5 verification catches this. If it happens, the only fixes are: (a) revert plugin docs to `mcp__claude-flow__*` (Alternative B); (b) flip init to `ruflo` end-to-end (Alternative A, the wholesale rebrand). Both are larger than this ADR.
3. **Upstream-merge regressions.** Future merges from `ruvnet/ruflo` will reintroduce `claude-flow@alpha` strings in `.claude-plugin/**/*.json`. Codemod Pass 5 catches this at build time. Required, not optional.
4. **Codemod false positives.** Pass 5's pattern `claude-flow@alpha` is broad enough that it could match prose in `docs/adr/**` or commit-message text. Scope-limit by file path (only `.claude-plugin/**` and `plugins/**`); negative-test cases enforce.

## Considered alternatives

### Alternative A — wholesale `claude-flow` → `ruflo` rebrand

Flip every `claude-flow` artifact-naming convention in the fork to `ruflo`: ~522 files across MCP namespace, project dir `.claude-flow/`, env vars `CLAUDE_FLOW_*`, OS data dirs, bundled `settings.json`, helper scripts, bin scripts, Codex initializer, codemod, acceptance harness, local data migration.

**Rejected** because the cost is far larger than warranted by "make plugins work." Ten phases, atomic writer+reader couplings across init/daemon/MCP server/hooks, AgentDB integrity checks post-rename, shell rc file migration, ~213 hand edits + 300+ codemod-driven changes, multi-day implementation. The user surfaced this trade-off explicitly: *"all we need is for the plugins to work. The wholesale removal of claude-flow is a massive undertaking."*

### Alternative B — revert `b24e46829`, single namespace `claude-flow`

Undo the plugin-doc rebrand. 121 files / 524 refs revert from `mcp__ruflo__*` to `mcp__claude-flow__*`. Marketplace `plugin.json` keeps the `claude-flow` key, just fixes the args. Single namespace, no dual-listing.

**Rejected** because:
- Throws away the brand identity work that landed cleanly in `b24e46829`.
- The fork's distribution is `sparkling/ruflo` — running tools under `mcp__claude-flow__*` reintroduces upstream's name as the user-facing identifier.
- Mechanical effort is ~25× the chosen direction (524 ref reverts + codemod Pass 4 removal vs. ~11 line changes).

This is the fallback if Alternative D-style dedup (Risk #2) materialises and dual-namespace doesn't actually work in Claude Code.

### Alternative C — keep marketplace `mcpServers.claude-flow` key, just fix the args

Leave the marketplace key as `claude-flow` (matching init); change only the args from `claude-flow@alpha` to `@sparkleideas/cli@latest`. Plugin docs' `mcp__ruflo__*` refs continue to fail.

**Rejected** because it doesn't make plugin docs work — refs still resolve to nothing. The marketplace's whole point is `/plugin install <name>@ruflo` exposing functioning tools.

### Alternative D — marketplace adds no `mcpServers` entry; rely on init

Remove the `mcpServers` block from marketplace `plugin.json` entirely. Plugin docs' `mcp__ruflo__*` refs are still broken (init exposes only `mcp__claude-flow__*`).

**Rejected** for the same reason as C.

## Status note (revised 2026-05-03)

This ADR is now the minimum-cost fix to make `/plugin install <name>@ruflo` deliver functioning tools **via the same service-method path the other 33 marketplace plugins assume**. It deliberately does not pursue wholesale rebrand of `.claude-flow/`, `CLAUDE_FLOW_*` env vars, or OS data dirs — those are orthogonal naming concerns.

ADR-0113's audit-finding #3 inline correction (added 2026-05-02) and ADR-0116's `Depends on: ADR-0117` annotation continue to apply: this ADR is what makes `mcp__ruflo__*` references actually resolve. The 2026-05-03 revision changes **how** the resolution happens (init-time server-key flip rather than parallel umbrella-plugin registration); the dependency itself stays.

## Implementation log

Phases 1-4 of original Decision shipped in code on `forks/ruflo/main` and `ruflo-patch/main` between 2026-05-02 and 2026-05-03 (verified 2026-05-03 by file inspection — git history shows the changes bundled inside `9e3463bdf` "chore: bump versions to 2.7.47-patch.417" and the upstream-merge commit `55f2ea0f8`, not surfaced as ADR-aligned individual commits). Revision 2026-05-03 unwinds those and lands the corrected service-method approach.

Original phases (superseded):
- [x] Phase 1: Marketplace `plugin.json` mcpServers key flip + args fix — landed; **revert in Phase R3**
- [x] Phase 2: Marketplace `hooks.json` 5 stale package refs replaced — kept
- [x] Phase 3: Codemod Pass 5 + test cases — kept; tests refreshed in R5
- [x] Phase 4: Acceptance check — landed; **rewritten in Phase R4**
- [ ] Phase 5: (never executed; Revision supersedes)

Revised phases:
- [ ] Phase R1: Init `mcp-generator.ts` server-key flip (`claude-flow` → `ruflo`)
- [ ] Phase R2: 9 init-bundled SKILL.md `mcp__claude-flow__*` → `mcp__ruflo__*`
- [ ] Phase R3: Remove umbrella `forks/ruflo/.claude-plugin/plugin.json` `mcpServers` block
- [ ] Phase R4: Rewrite `lib/acceptance-adr0117-marketplace-mcp.sh` assertions
- [ ] Phase R5: Refresh codemod regression tests
- [ ] Phase R6: End-to-end verification on a real install
