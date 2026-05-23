# Claude Code Configuration

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
- Keep files under 500 lines
- Use typed interfaces for all public APIs
- Prefer TDD London School (mock-first) for new code
- Use event sourcing for state changes
- Ensure input validation at system boundaries

## Build & Test

```bash
# Build
npm run build

# Test
npm test

# Run a single test file
npm test -- path/to/test.ts

# Lint
npm run lint
```

- ALWAYS run tests after making code changes
- ALWAYS verify build succeeds before committing

### Feature Workflow

1. Create or update tests first
2. Implement the change
3. Run tests — verify pass
4. Run build — verify success
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

| Situation | Use | Never |
|---|---|---|
| Multi-file / fan-out work | `Agent` tool, `run_in_background:true`, all spawns in ONE message | Poll status; use CLI as substitute |
| High-stakes decision, ADR ratification, multi-perspective review | `hive-mind_spawn` (or `ruflo hive-mind spawn --claude`) | Treat as anti-sprawl violation |
| Reflexive coordination at task start | (skip) | `swarm_init` unless user asked or persistent state needed |
| User explicitly asked for a claude-flow swarm | `swarm_init` (CLI auto-reuses matching) | `--new` flag unless parallel swarm genuinely needed |

- Use `hive-mind_spawn` (or `ruflo hive-mind spawn --claude`) when convening a council: named experts, per-question voting, Byzantine consensus, queen synthesis. (ADR-0115 carve-out — NOT bundled into swarm-sprawl prohibition.)
- DO NOT call `swarm_init` reflexively at task start (ADR-0098 — applies to flat-coordination swarms only).
- After spawning agents: STOP and wait for results. Do not poll.

## Tool Selection Rules

When you need a capability, choose in this order. Stop at the first match.

| You need to... | Use | Prefer over |
|---|---|---|
| Coordinate parallel sub-tasks | `Agent` tool with `run_in_background: true` | `swarm_init` for one-shot work |
| Convene a council on a high-stakes decision | `mcp__ruflo__hive-mind_spawn` (or invoke the `hive-mind-advanced` skill) | `Agent` fan-out (no synthesis) |
| Persist patterns/decisions across sessions | `mcp__ruflo__memory_store` | Writing to MEMORY.md from in-session work |
| Recall past decisions/patterns | `mcp__ruflo__memory_search` | Asking the user to re-explain |

When the active toolset doesn't cover a capability:
1. Run `ruflo skill list` — a skill may already provide it
2. Run `ruflo plugins list` — an installable plugin may provide it
3. Only after both come up empty, build the capability inline or ask the user

Sub-agents spawned via `Agent` typically inherit the parent's `mcp__ruflo__*` toolset. For long-running sub-tasks where MCP visibility is uncertain, run a discovery probe before spawning rather than pre-fetching results.

## Plugin Installation Rule

NEVER install plugins without explicit user confirmation. Plugins persist past the session.

Install only when ALL hold:
- User asked for a capability not covered by `ruflo skill list` or active MCP tools
- User confirmed the install

Discovery: `ruflo plugins --help`.
Install: `/plugin install ruflo-<name>@ruflo` (after `/plugin marketplace add ruvnet/ruflo`).
Tell user to run `/reload-plugins` if commands don't appear post-install.

## MCP Tools (Deferred)

The `ruflo` MCP server is registered. Tools are deferred — call ToolSearch
to load a tool's schema before invoking it.

Quick discovery:
- `ToolSearch("ruflo memory")` — store, search, retrieve patterns
- `ToolSearch("ruflo agent")` — spawn, list, manage agents
- `ToolSearch("ruflo swarm")` — multi-agent coordination
- `ToolSearch("ruflo hooks")` — lifecycle hooks and learning

Do NOT call `mcp__ruflo__agentdb_session-start` or
`mcp__ruflo__agentdb_session-end` — hooks manage session lifecycle
automatically.

## Hook Signals

Hooks inject signals into the conversation at three points:

- **Before task**: `[INTELLIGENCE] Relevant patterns...` — incorporate when relevant
- **During task**: `[INFO] Routing task...` — consider the recommended agent type
- **After task**: hooks store outcomes automatically; do not call session-start/end

If `[INFO] Router not available` appears, proceed normally without routing.

## Reference Pointers (when you need more than this file says)

- Tool catalog: `ToolSearch` with a relevant query
- Skill catalog: `ruflo skill list`
- Plugin catalog: `ruflo plugins list`
- Agent type catalog: `ruflo agent list`
- CLI diagnostics: `ruflo doctor --fix`
- Architecture decisions for this project: `docs/adr/`
- Cross-session memory: `~/.claude/projects/<project>/memory/MEMORY.md`
- Full feature reference: https://github.com/ruvnet/ruflo/blob/main/docs/USERGUIDE.md

## Support

One-time bootstrap (user runs once, AI never): `claude mcp add claude-flow -- npx -y @sparkleideas/ruflo@latest`

- Documentation: https://github.com/ruvnet/ruflo
- Issues: https://github.com/ruvnet/ruflo/issues
