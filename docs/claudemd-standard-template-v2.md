# Claude Code Configuration - RuFlo V3

## What This Project Is

${projectDescription}

## Default Scope

<!-- One sentence: what does "this project" mean when the user says "fix this"? -->
${defaultScope}

## Behavioral Rules (Always Enforced)

- Do what has been asked; nothing more, nothing less
- NEVER create files unless absolutely necessary for the goal
- ALWAYS prefer editing an existing file to creating a new one
- NEVER proactively create documentation files unless explicitly requested
- NEVER save working files or tests to the root folder
- ALWAYS read a file before editing it
- NEVER commit secrets, credentials, or .env files
- ALWAYS commit often — after every meaningful change

## File Organization

- Use `/src` for source code, `/tests` for tests, `/docs` for documentation
- Use `/config` for configuration, `/scripts` for scripts, `/examples` for examples
- NEVER save files to the root folder

## Build & Test

```bash
${buildCommands}

# Run a single test file
${singleTestCommand}
```

- ALWAYS run tests after making code changes
- ALWAYS verify build succeeds before committing

### Feature Workflow

1. Create or update tests first
2. Implement the change
3. Run tests — verify pass
4. Run build — verify success
5. Commit

## Security

- NEVER hardcode API keys, secrets, or credentials in source files
- NEVER commit .env files or any file containing secrets
- Validate all user input at system boundaries
- Sanitize file paths to prevent directory traversal

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
| Initialize a swarm | `npx @sparkleideas/cli@latest swarm init` via Bash |
| Run CLI diagnostics | `npx @sparkleideas/cli@latest doctor --fix` via Bash |
| Invoke a registered skill | Skill tool with the skill name (e.g., `/commit`) |
