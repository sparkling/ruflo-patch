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

## Build & Test

### Cascading Pipeline (ADR-0038)

Each npm script includes all previous steps — running a later step runs everything before it:

| # | `npm run` script | Includes | What it does |
|---|------------------|----------|--------------|
| 1 | `preflight` | — | Static analysis, lint checks |
| 2 | `test:pipeline` | 1 | Pipeline infra tests (6 files, mocked) |
| 3 | `test:unit` | 1-2 | Product unit + integration tests (20 files) |
| 4 | `fork-version` | 1-3 | Bump `-patch.N` versions |
| 5 | `copy-source` | 1-4 | Copy fork source to `/tmp/ruflo-build` |
| 6 | `codemod` | 1-5 | Scope rename (`@claude-flow/*` → `@sparkleideas/*`) |
| 7 | `build` | 1-6 | TypeScript compile + WASM (parallel) |
| 8 | `publish:verdaccio` | 1-7 | Publish to Verdaccio + promote @latest |
| 9 | `test:acceptance` | 1-8 | Acceptance checks against a real init'd project |
| 10 | `finalize` | — | Save state, push forks, write timing (standalone) |
| 11 | `deploy` | 1-10 | Full pipeline end-to-end |

Other scripts:

```bash
npm run validate          # Environment smoke test
npm run sync              # Fetch upstream, merge on branch, test, create PR
npm run publish:fork      # Detect merged PRs, version bump, build, publish
```

### Required Tests Per Change Type

| Change | Required Tests | Command |
|--------|---------------|---------|
| Patch fix / helper code | preflight + pipeline + unit + acceptance | `npm run test:unit && npm run test:acceptance` |
| Codemod / pipeline script | preflight + pipeline + unit | `npm run test:unit` |
| Test script changes only | preflight + pipeline + unit | `npm run test:unit` |
| Acceptance / publish changes | preflight + pipeline + unit + acceptance | `npm run test:unit && npm run test:acceptance` |
| Pre-publish verification | full cascade | `npm run test:acceptance` |
| Deploy to Verdaccio (full) | all | `npm run deploy` |

### Test Pyramid (MANDATORY — all levels for every change)

| Level | Location | Style | Runner |
|-------|----------|-------|--------|
| **Unit** | `tests/unit/*.test.mjs` | London School TDD — mocked deps, no I/O | `npm run test:unit` |
| **Integration** | `tests/unit/*.test.mjs` | Real I/O — file persistence, subprocess exec, pipeline exercises | `npm run test:unit` |
| **Acceptance** | `lib/acceptance-*.sh` wired into `scripts/test-acceptance.sh` | Bash checks against real `init --full` project with published packages | `npm run test:acceptance` |

**Writing tests: ALL THREE levels in the same pass.** Never treat acceptance tests as optional or "later" work — the framework exists, use it.

**Running tests: ALL THREE levels every time.** When asked to run/test/verify:

```bash
npm run test:unit                                           # Level 1+2
curl -sf http://localhost:4873/-/ping && npm run test:acceptance   # Level 3 if Verdaccio up
```

NEVER run only `test:unit` and call it done. If Verdaccio is down, say so explicitly — do not silently skip acceptance.

### Fast acceptance runner (iterating on specific checks)

For debugging or iterating on acceptance check code without rebuilding packages:

```bash
bash scripts/test-acceptance-fast.sh check_<function_name>     # single check
bash scripts/test-acceptance-fast.sh p3,p4                     # phase groups
bash scripts/test-acceptance-fast.sh all                       # all ADR-0059 checks
```

Requires Verdaccio running and packages already published. Reuses existing `/tmp/ruflo-accept-*` and `/tmp/ruflo-e2e-*` dirs. Sequential (no subshell) — reliable variable propagation.

### Feature Workflow

1. Create or update tests first (all three levels)
2. Implement the change
3. Run `npm run test:unit` (and `test:acceptance` if the change type requires it)
4. Run `npm run build` if you touched fork source
5. Commit

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
claude mcp add claude-flow -- npx -y @sparkleideas/cli@latest
ruflo daemon start
ruflo doctor --fix
```

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
