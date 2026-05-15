# Claude Code Configuration - RuFlo V3

## What This Project Is

ruflo-patch builds **upstream HEAD** of 3 repos (`ruflo`, `agentic-flow`, `ruv-FANN`) and publishes them as `@sparkleideas/*` packages on npm. Upstream has hundreds of unpublished commits beyond their last npm tags — users installing from upstream get stale code.

**Pipeline**: fork HEAD → `{upstream-tag}-patch.N` versioning → scope rename (`@claude-flow/*` → `@sparkleideas/*`) → pin all internal deps → build → test → publish

**This is NOT just scope renaming.** The primary value is:
1. **Current code** — builds from upstream HEAD, not stale tags
2. **Pinned deps** — all 41 packages versioned together with exact `-patch.N` refs
3. **Bug fix patches** — layered on fork source, tracked as GitHub issues

## Default Scope

- By default, ALL instructions target the **repackaged published version** (`@sparkleideas/*` packages that users install)
- Only target this repo's internal tooling when the user explicitly says so

## Behavioral Rules (Always Enforced)

- Do what has been asked; nothing more, nothing less
- NEVER create files unless they're absolutely necessary for achieving your goal
- ALWAYS prefer editing an existing file to creating a new one
- NEVER proactively create documentation files (*.md) or README files unless explicitly requested
- NEVER save working files, text/mds, or tests to the root folder
- Never continuously check status after spawning a swarm — wait for results
- ALWAYS read a file before editing it
- NEVER commit secrets, credentials, or .env files

## File Organization

- NEVER save to root folder — use the directories below
- Use `/src` for source code files
- Use `/tests` for test files
- Use `/docs` for documentation and markdown files
- Use `/config` for configuration files
- Use `/scripts` for utility scripts
- Use `/examples` for example code

## Project Architecture

- Follow Domain-Driven Design with bounded contexts
- Keep files under 500 lines (exceptions: upstream-maintained files — see memory `project-adr0094-living-tracker` / ADR-0089)
- Use typed interfaces for all public APIs
- Prefer TDD London School (mock-first) for new code
- Use event sourcing for state changes
- Ensure input validation at system boundaries

### Project Config

- **Topology**: hierarchical-mesh
- **Max Agents**: 15
- **Memory**: hybrid (RVF primary; SQLite fallback only — see memory `project-rvf-primary`)
- **HNSW**: Enabled
- **Neural**: Enabled

## Build & Test — THREE COMMANDS, NOTHING ELSE

> **READ THIS FIRST. EVERY TIME.** Before reaching for any "fast iteration"
> shortcut, scroll back here. The user has watched this rule get broken in
> session after session. There are exactly three commands. Pick one. Run it.
> Don't propose alternatives.

### The only three commands

| What you want | The command. The ONLY command. |
|---------------|--------------------------------|
| Run tests without publishing | `npm run test:unit` |
| Run acceptance for ONE group only (no rebuild) | `bash scripts/test-acceptance-fast.sh --group <group>` |
| Test + publish + acceptance + commit fork bumps | `npm run release` |

Decision tree:

```
User says: test / deploy / verify / ship / publish / run the tests / check it works
  │
  ├── Just unit + integration, no publish needed?
  │     → npm run test:unit
  │
  ├── Iterating on ONE acceptance group (e.g. just p3 / adr0177)?
  │   Verdaccio has the latest packages from a prior release?
  │     → bash scripts/test-acceptance-fast.sh --group <group>
  │       Groups: p3, p4, p5, p8, p9, p10, p12, p14, p15, p16, p17,
  │               adr0059, adr0085, adr0090-b5 (or "b5"), adr0104,
  │               adr0177, adr0178, e2e-storage, all
  │     Returns in ~30-90s. Does NOT rebuild source — call `npm run release`
  │     first if your source changed.
  │
  └── Anything else (verify a fix end-to-end, full check, publish, deploy)
        → npm run release      (add `-- --force` if no merged PRs detected and you want to republish)
```

That's it. Stop.

### Heavy-test opt-out (default acceptance)

The default `npm run release` acceptance run SKIPS 9 heavy passing tests
(~3 minutes of wall time, including 75s of Playwright browser-navigation).
List + opt-back-in env-var live in `lib/acceptance-harness.sh`
(`_HEAVY_CHECK_IDS`). To run the full corpus:

```bash
ACCEPTANCE_HEAVY=1 npm run release
```

Use this before merging anything that touches Playwright / browser
automation, ReasoningBank ranking, neural directory scanning, or memory
consolidation. The skipped tests show up as `skip_accepted` with a
`HEAVY_SKIP` diagnostic.

### FORBIDDEN — DO NOT RUN THESE FOR TEST/DEPLOY

These targets and scripts EXIST in the repo. Running them for the test/deploy
workflow is wrong every time. Treat them as poison.

- ❌ `npm run build` / `npm run build:tsc` / `npm run build:wasm` — release cascades through build
- ❌ `npm run test:acceptance` — cascades through release; just call release
- ❌ `npm run preflight` / `npm run test:pipeline` — covered by test:unit
- ❌ `npm run copy-source` / `npm run codemod` / `npm run fork-version` / `npm run finalize` — piecemeal cascade pieces
- ❌ `npm run publish:verdaccio` — REMOVED, doesn't exist
- ❌ `npm run deploy` — REMOVED, doesn't exist
- ❌ `bash scripts/copy-source.sh` / `build-packages.sh` / `publish-verdaccio.sh` / `run-fork-version.sh` — direct script calls
- ❌ `node scripts/codemod.mjs` — direct invocation
- ❌ `npx tsc` inside any fork package
- ❌ `napi build` outside the cascade
- ❌ `sed -i` on installed `dist/` files in `/tmp/ruflo-*/`
- ❌ Hand-editing `package.json` `version` to "force" a bump
- ❌ Direct `npm publish` to bypass `safeNextVersion`

If `npm run release` doesn't do what you need, **fix the script** — never run
a workaround by hand. Script chain: `scripts/ruflo-publish.sh` →
`scripts/fork-version.mjs` → `scripts/copy-source.sh` → `scripts/codemod.mjs`
→ build → publish → acceptance.

### One narrow exception (NOT a general escape hatch)

| Command | When and ONLY when |
|---------|---------------------|
| `npm run test:acceptance:ruvector` | User EXPLICITLY asks for the ruvector-heavy tier (P4 WASM + P5 RuVLLM, 20 checks). OOMs the host in the parallel wave; sequential, post-parallel, opt-in. |

Not a substitute for `release` when verifying a fork-source patch.

### Pre-flight before `npm run release`

1. Fork changes committed on `main` with descriptive message — `git -C forks/<name> commit ...` (no Co-Authored-By trailer per memory `feedback-fork-commit-attribution.md`). If you skip this, release bundles your changes into "chore: bump versions" and you lose the message.
2. Verdaccio up — `curl -sf http://localhost:4873/-/ping`
3. Then: `npm run release` — and don't touch anything until it finishes.

### Pre-flight before `bash scripts/test-acceptance-fast.sh`

1. A prior `npm run release` must have published the source you want to test (the fast runner uses `@sparkleideas/cli@latest` from Verdaccio).
2. Verdaccio up — `curl -sf http://localhost:4873/-/ping`
3. Use `--group <group>` to target one acceptance group only.

### Why these rules

Every workaround desyncs something. `npm run build` skips fork-version commits. Hand-edited `dist/` gets clobbered on next install. `npm run test:acceptance` cascades through release anyway, so calling it directly just creates confusion when it fails. `bash scripts/test-acceptance-fast.sh` is FAST but reads stale published packages — only use it after a prior `release` and only when iterating on the ACCEPTANCE harness or a specific check. `release` is the only path that:

- Holds the flock (no overlapping pipeline runs)
- Bumps fork versions, commits to `main`, tags, pushes to `sparkling`
- Copies source → /tmp/ruflo-build → codemod → build → publish under invariant ordering
- Updates `state.last-build-state` atomically
- Runs preflight + unit + acceptance gates

### Cascade reference (don't run directly — read-only)

For understanding what release does internally. **You don't run any of these.**

```
release
  └── ruflo-publish.sh
       ├── detect merged PRs
       ├── fork-version.mjs (bump)
       ├── git commit + tag + push to sparkling
       ├── copy-source.sh
       ├── codemod.mjs
       ├── build (tsc + wasm parallel)
       ├── publish-verdaccio.sh
       └── test-acceptance.sh
```

### Feature Workflow

1. Create or update tests first (all three levels)
2. Implement the change — if fork source, commit to fork main with descriptive message before step 4
3. Run `npm run test:unit` for fast feedback
4. Run `npm run release` for full verification (build + publish + acceptance). NEVER run `npm run build` separately — it's forbidden. See "Build & Test — TWO COMMANDS, NOTHING ELSE" above.
5. Commit ruflo-patch changes

## Security Rules

- NEVER hardcode API keys, secrets, or credentials in source files
- NEVER commit .env files or any file containing secrets
- Always validate user input at system boundaries
- Always sanitize file paths to prevent directory traversal
- Run `ruflo security scan` after security-related changes

## Concurrency

- Batch ALL independent operations into a single message
- Spawn ALL agents in ONE message using the Agent tool with `run_in_background: true`
- Batch ALL independent file reads/writes/edits in ONE message
- Batch ALL independent Bash commands in ONE message

## Task Complexity

- Single file edit or fix: work directly, no agents needed
- 3+ files, new feature, or cross-module refactoring: spawn agents
- When in doubt, start direct — escalate to agents if scope grows

## Agent Orchestration

- Use the Agent tool to spawn subagents for multi-file or cross-module tasks
- ALWAYS set `run_in_background: true` when spawning agents
- Put ALL agent spawns in a single message for parallel execution
- After spawning agents, STOP and wait for results — do not poll or check status
- Use CLI tools (via Bash) for coordination: swarm init, memory, hooks
- NEVER use CLI tools as a substitute for Agent tool subagents

## MCP Tools (Deferred)

This project has a `claude-flow` MCP server with 200+ tools for memory,
swarms, agents, hooks, and coordination. Tools are deferred — you MUST call
ToolSearch to load a tool's schema before calling it.

Quick discovery:
- `ToolSearch("claude-flow memory")` — store, search, retrieve patterns
- `ToolSearch("claude-flow agent")` — spawn, list, manage agents
- `ToolSearch("claude-flow swarm")` — multi-agent coordination
- `ToolSearch("claude-flow hooks")` — lifecycle hooks and learning

Do NOT call `mcp__claude-flow__agentdb_session-start` or
`mcp__claude-flow__agentdb_session-end` — hooks manage session lifecycle
automatically.

## Hook Signals

Hooks inject signals into the conversation at three points:

- **Before task**: `[INTELLIGENCE] Relevant patterns...` — incorporate when relevant
- **During task**: `[INFO] Routing task...` — consider the recommended agent type
- **After task**: hooks store outcomes automatically; do not call session-start/end

If `[INFO] Router not available` appears, proceed normally without routing.

## When to Use What

| Need | Use |
|------|-----|
| Spawn a subagent for parallel work | Agent tool (built-in, `run_in_background: true`) |
| Search or store memory | `mcp__claude-flow__memory_*` (load via ToolSearch first) |
| Initialize a swarm | `ruflo swarm init` via Bash |
| Run CLI diagnostics | `ruflo doctor --fix` via Bash |
| Invoke a registered skill | Skill tool with the skill name (e.g., `/commit`) |

## Quick Setup

```bash
claude mcp add claude-flow -- npx -y @sparkleideas/ruflo mcp start
ruflo daemon start
ruflo doctor --fix
```

Per ADR-0143 (B2 decision) the canonical user-facing entry point is `@sparkleideas/ruflo` — the published wrapper imports `@sparkleideas/cli` in-process via ADR-0142's ESM-pattern bin (~70ms warm overhead). Direct `npx @sparkleideas/cli` invocation still works for internal/test use but is no longer the user-facing recommendation.

## Memory — where project lessons live

Cross-session lessons (anti-patterns, preferences, project history) live in
`~/.claude/projects/-Users-henrik-source-ruflo-patch/memory/`, indexed by
`MEMORY.md` (auto-loaded every session). Check memory before starting work on
an unfamiliar area. Especially load-bearing entries:

- `project-rvf-primary` — RVF is primary storage; never add SQLite-first paths
- `feedback-no-fallbacks` — tests must fail loudly; no silent fallback branches
- `feedback-all-test-levels` — unit + integration + acceptance in every pass
- `reference-cli-cmd-helper` — parallel acceptance checks MUST use `$(_cli_cmd)`, never `npx @latest` (36× slower)
- `reference-fork-workflow` — build branches, remotes, push targets per fork
- `feedback-no-adversarial-review` — skip ADR-0087 planning critique unless requested

## Support

- Documentation: https://github.com/ruvnet/claude-flow
- Issues: https://github.com/ruvnet/claude-flow/issues
