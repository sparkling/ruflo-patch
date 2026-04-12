# Project Name

## Behavioral Rules

- Do what has been asked; nothing more, nothing less
- NEVER create files unless absolutely necessary for the goal
- ALWAYS prefer editing an existing file to creating a new one
- NEVER proactively create documentation files unless explicitly requested
- NEVER save working files or tests to the root folder
- ALWAYS read a file before editing it
- NEVER commit secrets, credentials, or .env files

## File Organization

- Use `/src` for source code, `/tests` for tests, `/docs` for documentation
- Use `/config` for configuration, `/scripts` for scripts, `/examples` for examples
- NEVER save files to the root folder

## Architecture

- Follow Domain-Driven Design with bounded contexts
- Keep files under 500 lines
- Use typed interfaces for all public APIs
- Validate input at system boundaries

## Build & Test

```bash
npm run build
npm test
npm run lint
```

- ALWAYS run tests after making code changes
- ALWAYS verify build succeeds before committing

## Security

- NEVER hardcode API keys, secrets, or credentials in source files
- NEVER commit .env files or any file containing secrets
- Validate all user input at system boundaries
- Sanitize file paths to prevent directory traversal

## Concurrency

- Batch ALL related operations into a single message
- Spawn ALL agents in ONE message using the Agent tool with `run_in_background: true`
- Batch ALL file reads, writes, and edits in ONE message
- Batch ALL Bash commands in ONE message

## Agent Orchestration

- Use the Agent tool to spawn subagents for complex multi-file tasks
- ALWAYS set `run_in_background: true` when spawning agents
- Put ALL agent spawns in a single message for parallel execution
- After spawning agents, STOP and wait for results before proceeding
- Use CLI tools (via Bash) for coordination: swarm init, memory, hooks
- NEVER use CLI tools as a substitute for Agent tool subagents
