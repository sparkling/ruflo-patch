# Audit 11 — Init + MCP Server Installation (static)

ADR: /Users/henrik/source/ruflo-patch/docs/adr/ADR-0201-codebase-soundness-completeness-audit-with-runtime-validation.md
Slice: init.ts + init/ generators + .mcp.json registration path
Mode: read-only static audit
Date: 2026-05-19

## Files audited

- /Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/commands/init.ts (1414 lines)
- /Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/init/executor.ts (2295 lines)
- /Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/init/mcp-generator.ts (167 lines)
- /Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/init/types.ts (719 lines)
- /Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/init/index.ts (64 lines)
- /Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/init/claudemd-generator.ts (399 lines)
- /Users/henrik/source/forks/ruflo/.claude-plugin/marketplace.json (manifest)

## What init actually does for MCP

1. `executeInit()` in `init/executor.ts:188-300` runs as a 9-step pipeline. Step 2 (line 220-223) writes `.mcp.json` via `writeMCPConfig()`.
2. `writeMCPConfig()` (executor.ts:885-914) calls `generateMCPJson()` from `mcp-generator.ts:116` which serialises `generateMCPConfig()`.
3. `generateMCPConfig()` (mcp-generator.ts:68-111) emits up to 3 server entries: `ruflo`, `ruv-swarm`, `flow-nexus`. Only `ruflo` is enabled by default.
4. Server `ruflo` is built by `createRufloEntry()` (mcp-generator.ts:33-35) which delegates to `createMCPServerEntry()` with args `['@sparkleideas/ruflo@latest', 'mcp', 'start']`.
5. Cross-platform: Unix path emits `{command: "npx", args: ["-y", ...]}`; Windows path emits `{command: "cmd", args: ["/c", "npx", "-y", ...]}` (mcp-generator.ts:47-62).
6. There is no separate `claude mcp add` execution — `.mcp.json` is the only writable surface init touches for MCP registration. The `generateMCPCommands()` function (mcp-generator.ts:124) returns instruction strings but is not invoked by `executeInit()` (verified — no call sites within init/).
7. The plugin marketplace is NOT auto-installed by init. CLAUDE.md template (claudemd-generator.ts:171) only documents the manual `/plugin marketplace add` command.

## Reference comparison vs canonical /Users/henrik/source/ruflo-patch/.mcp.json

Auto-generated `.mcp.json` on Unix (the build that ships) matches canonical byte-for-byte at the field level:

| Field | Canonical | Generated (Unix, default opts) | Match |
|---|---|---|---|
| `command` | `npx` | `npx` | yes |
| `args[0]` | `-y` | `-y` | yes |
| `args[1]` | `@sparkleideas/ruflo@latest` | `@sparkleideas/ruflo@latest` | yes |
| `args[2..3]` | `mcp`, `start` | `mcp`, `start` | yes |
| `env.npm_config_update_notifier` | `false` | `false` | yes |
| `env.CLAUDE_FLOW_MODE` | `v3` | `v3` | yes |
| `env.CLAUDE_FLOW_HOOKS_ENABLED` | `true` | `true` | yes |
| `env.CLAUDE_FLOW_TOPOLOGY` | `hierarchical-mesh` | `options.runtime.topology` (default `hierarchical-mesh`) | yes (parameterised, but default is canonical) |
| `env.CLAUDE_FLOW_MAX_AGENTS` | `15` | `String(options.runtime.maxAgents)` (default `15`) | yes (parameterised) |
| `env.CLAUDE_FLOW_MEMORY_BACKEND` | `hybrid` | `options.runtime.memoryBackend` (default `hybrid`) | yes (parameterised) |
| `autoStart` | `true` | `config.autoStart` (default `true`) | yes (parameterised) |

The Unix path is **sound** vs canonical.

## Findings

### F-11-001 — `generateMCPCommands()` manual-setup hint diverges from auto-generated .mcp.json (POTENTIALLY UNSOUND)

- File: /Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/init/mcp-generator.ts:124-151
- Severity: Medium (drift between two surfaces that should agree)
- Symptom: `.mcp.json` written by init uses server key `ruflo` and binary `@sparkleideas/ruflo@latest` (correct per ADR-0143 and memory `feedback-always-npx-for-ruflo`). The manual-setup commands emitted by `generateMCPCommands()` for users to copy/paste use server key `claude-flow` and binary `@sparkleideas/cli@latest`.
  - Auto-gen: `"ruflo": {"command":"npx", "args":["-y","@sparkleideas/ruflo@latest","mcp","start"]}`
  - Hint emits: `claude mcp add claude-flow -- npx -y @sparkleideas/cli@latest mcp start`
- Why this matters: per memory `feedback-always-npx-for-ruflo`, ALL registration must use `@sparkleideas/ruflo@latest` (the wrapper), never `@sparkleideas/cli` directly, AND the server key must be `ruflo`. A user who follows the manual-setup hint instead of letting init write `.mcp.json` will end up with the internal package as the user-facing surface, AND under the wrong key — which then makes the `mcp__ruflo__*` tool prefixes documented elsewhere fail to resolve.
- Note: `generateMCPCommands()` is exported but not called from within `init/executor.ts`. Need to grep the broader CLI to determine if any UI surface still emits these strings to users. (Out of slice — flag for cross-cutting agent.)
- Suggestion: rename server key `claude-flow` → `ruflo` and binary `@sparkleideas/cli@latest` → `@sparkleideas/ruflo@latest` in `generateMCPCommands()` so the hint matches `.mcp.json`. The `flow-nexus` and `ruv-swarm` lines are fine.

### F-11-002 — `ruv-swarm` MCP entry not pinned to `@latest` (UNSOUND vs others)

- File: /Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/init/mcp-generator.ts:94-98
- Severity: Low (consistency / freshness)
- Symptom: `ruflo` uses `@sparkleideas/ruflo@latest`, `flow-nexus` uses `flow-nexus@latest`, but `ruv-swarm` is just `'ruv-swarm'` (no `@latest`). When `--start-all` boots and the user has an older cached `ruv-swarm`, npx resolves from cache rather than fetching the latest.
- This is the exact staleness shape ADR-0155 (cited in `mcp-generator.ts:21-31`) eliminated for the `ruflo` entry. Per the rationale "freshness wins", `ruv-swarm` should match.
- Suggestion: change `['ruv-swarm', 'mcp', 'start']` → `['ruv-swarm@latest', 'mcp', 'start']`. Same one-character fix for the manual-setup hints in `generateMCPCommands()` lines 133 and 143.

### F-11-003 — No `@sparkleideas/agentdb` MCP entry despite agentdb being the 5th fork (INCOMPLETE)

- File: /Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/init/mcp-generator.ts:68-111, types.ts:201-212
- Severity: Medium (completeness — depends on whether agentdb is intended to be an MCP server)
- Symptom: per memory `project-agentdb-parallel-extraction`, agentdb is now a top-level fork with its own published package `@sparkleideas/agentdb`. The `MCPConfig` type in `types.ts:201-212` only declares `claudeFlow`, `ruvSwarm`, `flowNexus` — no `agentdb` field. The `mcp-generator.ts` body has no branch for agentdb. The deferred MCP tool list visible to me includes `mcp__claude-flow__agentdb_*` (200+ entries), meaning agentdb tools are surfaced THROUGH the ruflo MCP server today.
- Two possible read-outs:
  - (a) intentional: agentdb is a library, not a standalone MCP server; tools are mounted on the ruflo MCP. No fix needed.
  - (b) gap: agentdb should be its own MCP server entry (e.g. `mcp__agentdb__*` prefix) so tools resolve under a clean namespace post-extraction.
- This audit can't decide between (a) and (b) without checking how `mcp start` mounts agentdb tools. Flagging for the parent audit.

### F-11-004 — Plugin marketplace NOT auto-installed; hint references upstream `ruvnet/ruflo` not `sparkling/ruflo` (POTENTIALLY UNSOUND)

- File: /Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/init/claudemd-generator.ts:171
- Severity: Medium (reference soundness)
- Symptom: per memories `project-adr0117-rebrand` and `reference-claude-plugin-install`, the marketplace plugin registers an MCP server under the `ruflo` key. Init does NOT call `/plugin marketplace add` automatically — it only documents the command in the generated CLAUDE.md. The documented command is:
  `/plugin install ruflo-<name>@ruflo (after /plugin marketplace add ruvnet/ruflo)`
- Two issues:
  - **Reference target wrong**: hint says `ruvnet/ruflo` (upstream) — but per memory `feedback-upstream-means-upstream`, upstream is 395+ commits behind the fork. The user-facing brand per ADR-0143 + `reference-user-facing-brand` is `@sparkleideas/ruflo`; the marketplace.json owner is `sparkling`. The user-facing project should be `sparkling/ruflo` (or the matching npm-installed manifest), not `ruvnet/ruflo` which would install stale upstream marketplace content.
  - **No auto-install**: ADR-0117 says the marketplace's MCP server registers under the `ruflo` key. If init isn't installing the marketplace, the `mcp__ruflo__*` tools documented in many places aren't actually wired up by `ruflo init` alone — the user needs a second manual step.
- Suggestion: either (a) document `sparkling/ruflo` (or whatever the published marketplace path is) instead of `ruvnet/ruflo`, or (b) have init optionally run `claude plugin marketplace add <correct-source>` + `claude plugin install ruflo@<correct-marketplace>` as a `--with-marketplace` flag.

### F-11-005 — Init "Next steps" output uses `claude-flow` not `ruflo` (UNSOUND vs user-facing brand)

- File: /Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/commands/init.ts:517-526 (init flow) and 878 (upgrade flow)
- Severity: Low (UX / brand consistency)
- Symptom: "Next steps" text prints:
  ```
  Run claude-flow daemon start to start background workers
  Run claude-flow memory init to initialize memory database
  Run claude-flow swarm init to initialize a swarm
  Or use claude-flow init --start-all to do all of the above
  ```
- Per ADR-0143 + memory `reference-user-facing-brand`, the user-facing command is `ruflo`, NOT `claude-flow`. The bottom two lines in the same block already use `ruflo plugins --help` and `ruflo skill list` (lines 524-525), so this block is inconsistent with itself.
- Suggestion: flip the 4 `claude-flow` references in this block to `ruflo`. Same fix at line 878 (upgrade flow's identical hint).

### F-11-006 — Idempotency: parent-walk dedup guard works but downstream skip message is server-key-locked (PARTIAL UNSOUNDNESS)

- File: /Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/init/executor.ts:851-914
- Severity: Low (handled, but worth noting)
- Behaviour: `writeMCPConfig()` checks (a) if `.mcp.json` already exists in targetDir → skip unless `--force`; (b) walks parents + `~/.claude.json` + `~/.claude/mcp.json` looking for an existing entry under the `ruflo` server key → skip unless `--force`. The dedup guard correctly catches the [[project-adr0117-rebrand]] case (#1779) where the marketplace plugin already registered `ruflo`.
- Soundness concerns:
  - The dedup walk only looks for the `ruflo` server key. If init in a future version writes under a different key (or if the manual-setup commands at F-11-001 write under the OLD `claude-flow` key as they currently do), the dedup misses the duplicate. Since F-11-001 should be fixed to use `ruflo` everywhere, this becomes moot — but worth noting as a coupled gap.
  - Idempotency on the same target is verified: re-running init without `--force` correctly skips (`.skipped.push('.mcp.json')`). No corruption risk under default flags.

### F-11-007 — Hooks installation: written to .claude/settings.json + .claude/helpers/, no separate hooks.json (SOUND)

- Files: /Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/init/executor.ts:216-261 (settings + helpers), settings-generator.ts (594 lines, not deep-read in this slice)
- Behaviour: hooks live inside `.claude/settings.json` under the `hooks` key (per Claude Code's hook contract), not in a separate `hooks.json`. The critical helper scripts (`hook-handler.mjs`, `auto-memory-hook.mjs`) are written to `.claude/helpers/` even when `components.helpers` is false but `components.settings` is true (executor.ts:243-261). This is SG-003 — addressed.
- Verified: 9 hook types enabled by default via `DEFAULT_INIT_OPTIONS.hooks` (types.ts:460-472), counted by `countEnabledHooks()` (executor.ts:292). Output line "Hooks: N hook types enabled in settings.json" (init.ts:413) reports correctly.

### F-11-008 — Skills installation: SOUND but a copy not a link (NOTE)

- Files: /Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/init/executor.ts:919-946+, types.ts:78-103
- Behaviour: skills copy from `findSourceDir('skills', options.sourceBaseDir)` to `.claude/skills/`. `DEFAULT_INIT_OPTIONS.skills` enables `core, agentdb, github, browser, v3` by default; opt-out for `flowNexus, dualMode`. ADR-0148 Category C also opt-in flags (`jujutsu, hiveMind, performance, workers`).
- Per [[feedback-no-codex-mentions]] the `dualMode: true` in `FULL_INIT_OPTIONS` (types.ts:661) is a soundness concern — `FULL` defaults shouldn't enable dual-mode given the project's Claude-only stance. But this is a config-policy issue, not a wiring bug; flagging for the policy-audit agent.

### F-11-009 — Daemon start: optional via flags, hint command name wrong (see F-11-005)

- Files: /Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/commands/init.ts:421-478, 519
- Behaviour: init does NOT auto-start the daemon. `--start-daemon` or `--start-all` flags trigger a detached `spawn` of the same node process invoking `daemon start` (line 449). Without those flags, init instructs the user (line 519). Hint text suffers from F-11-005's branding gap.
- Soundness on the spawn itself: uses `process.execPath + process.argv[1]` correctly to avoid re-resolving published packages via npx — matches the rationale comment at 425-427 about harness-init wall time. Good.

### F-11-010 — Reference soundness on paths/binaries: all post-install paths verified resolvable (SOUND)

- `.claude/settings.json` → written by `writeSettings()` (executor.ts:817-836)
- `.claude/helpers/{hook-handler.mjs, auto-memory-hook.mjs, statusline.cjs}` → written by `writeHelpers()` or SG-003 fallback
- `.mcp.json` → written by `writeMCPConfig()`
- `.claude-flow/{data,logs,sessions,hooks,agents,workflows}/` → created by `createDirectories()` (DIRECTORIES.runtime at executor.ts:174-182)
- `.ruflo-project` sentinel → ADR-0100 §2, written by `writeProjectSentinel()` (executor.ts:289) so `findProjectRoot()` resolves
- The auto-memory hook commands embedded in settings (executor.ts:351-356) use a git-root resolver: `git rev-parse --show-toplevel || process.cwd()` then `node -e "..."` — works regardless of CWD per #1259/#1284.
- All paths the generated config references are paths init itself creates. No dangling external references found in the init flow.

## Summary of soundness/completeness per ADR-0201

| Aspect | Status |
|---|---|
| `.mcp.json` matches canonical (Unix default) | SOUND |
| `.mcp.json` matches canonical (Windows) | SOUND (cmd /c wrapper, same args/env) |
| NPX vs global binary path | SOUND (always npx -y per ADR-0155) |
| Env vars match canonical | SOUND (all 6 keys present + parameterised) |
| Idempotency (re-run without --force) | SOUND |
| Dedup vs parent / ~/.claude.json | SOUND (catches #1779) |
| Manual-setup hint matches auto-generated | **UNSOUND** (F-11-001: wrong key + wrong binary) |
| `ruv-swarm` pinned to @latest | **UNSOUND** (F-11-002) |
| `@sparkleideas/agentdb` MCP entry | **INCOMPLETE if intended** (F-11-003: needs slice-external decision) |
| Plugin marketplace auto-install | **INCOMPLETE** (F-11-004: not auto-installed AND hint points to upstream) |
| Hooks installation location | SOUND |
| Hooks helpers always present when settings written | SOUND (SG-003) |
| Skills install | SOUND (modulo dualMode policy at F-11-008) |
| Daemon auto-start | OPT-IN via flags (intentional) |
| User-facing brand in init output | **UNSOUND** (F-11-005: 4 `claude-flow` refs should be `ruflo`) |
| Path/binary references resolve post-install | SOUND |

## Out of slice — flagged for parent / other agents

- Whether `generateMCPCommands()` is invoked anywhere in the CLI to display the divergent manual-setup hints to users (F-11-001 needs cross-cutting grep beyond `init/`).
- Whether `@sparkleideas/agentdb` should be its own MCP server entry vs mounted under the ruflo server (F-11-003).
- `FULL_INIT_OPTIONS.skills.dualMode = true` vs [[feedback-no-codex-mentions]] policy (F-11-008).
- Whether `settings-generator.ts` (594 lines) writes anything else that drifts from canonical — only spot-checked the env vars in this slice.
