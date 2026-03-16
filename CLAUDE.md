# Claude Code Configuration - RuFlo V3

## What This Project Is

ruflo-patch builds **upstream HEAD** of 4 repos (`ruflo`, `agentic-flow`, `ruv-FANN`, `RuVector`) and publishes them as `@sparkleideas/*` packages on npm. Upstream has hundreds of unpublished commits beyond their last npm tags — users installing from upstream get stale code.

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
- ALWAYS commit often — after every meaningful change (new patch, new ADR, config update, test fix). Do not accumulate uncommitted work across multiple tasks

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

### Project Config

- **Topology**: hierarchical-mesh
- **Max Agents**: 15
- **Memory**: hybrid
- **HNSW**: Enabled
- **Neural**: Enabled

## Build & Test

```bash
# Unit tests (preflight + pipeline + unit, ~0.8s)
npm run test:unit

# Build (TSC + WASM, cached at /tmp/ruflo-build)
npm run build

# Build targets (ADR-0039)
npm run build:tsc          # TypeScript compile only
npm run build:wasm         # WASM compile only (optional, standalone)

# Deploy (full cascade: test → build → publish → acceptance → finalize)
npm run deploy

# Sync stage (fetch upstream, merge, test, create PR)
npm run sync

# Acceptance test (requires prior publish to Verdaccio)
npm run test:acceptance

# Promote prerelease to @latest
npm run promote
```

### Cascading Pipeline (ADR-0038, ADR-0039)

| # | npm script | Includes | What it does |
|---|---|---|---|
| 1 | `preflight` | — | Static analysis |
| 2 | `test:pipeline` | 1 | Pipeline infra tests |
| 3 | `test:unit` | 1-2 | Unit tests |
| 4 | `fork-version` | 1-3 | Bump `-patch.N` versions |
| 5 | `copy-source` | 1-4 | rsync forks to build dir |
| 6 | `codemod` | 1-5 | Scope rename |
| 7a | `build:tsc` | 1-6 | TypeScript compile |
| 7b | `build:wasm` | — | WASM compile (standalone) |
| 7 | `build` | 7a+7b | Both |
| 8 | `publish:verdaccio` | 1-7 | Publish + promote @latest |
| 9 | `test:acceptance` | 1-8 | Real CLI, real packages |
| 10 | `finalize` | — | Save state, push forks |
| 11 | `deploy` | 1-10 | Full pipeline |

- ALWAYS run tests after making code changes
- ALWAYS verify build succeeds before committing

## Security Rules

- NEVER hardcode API keys, secrets, or credentials in source files
- NEVER commit .env files or any file containing secrets
- Always validate user input at system boundaries
- Always sanitize file paths to prevent directory traversal
- Run `npx @sparkleideas/cli@latest security scan` after security-related changes

## Concurrency: 1 MESSAGE = ALL RELATED OPERATIONS

- All operations MUST be concurrent/parallel in a single message
- Use Claude Code's Task tool for spawning agents, not just MCP
- ALWAYS batch ALL todos in ONE TodoWrite call (5-10+ minimum)
- ALWAYS spawn ALL agents in ONE message with full instructions via Task tool
- ALWAYS batch ALL file reads/writes/edits in ONE message
- ALWAYS batch ALL Bash commands in ONE message

## Swarm Orchestration

- MUST initialize the swarm using CLI tools when starting complex tasks
- MUST spawn concurrent agents using Claude Code's Task tool
- Never use CLI tools alone for execution — Task tool agents do the actual work
- MUST call CLI tools AND Task tool in ONE message for complex work

### 3-Tier Model Routing (ADR-026)

| Tier | Handler | Latency | Cost | Use Cases |
|------|---------|---------|------|-----------|
| **1** | Agent Booster (WASM) | <1ms | $0 | Simple transforms (var→const, add types) — Skip LLM |
| **2** | Haiku | ~500ms | $0.0002 | Simple tasks, low complexity (<30%) |
| **3** | Sonnet/Opus | 2-5s | $0.003-0.015 | Complex reasoning, architecture, security (>30%) |

- Always check for `[AGENT_BOOSTER_AVAILABLE]` or `[TASK_MODEL_RECOMMENDATION]` before spawning agents
- Use Edit tool directly when `[AGENT_BOOSTER_AVAILABLE]`

## Swarm Configuration & Anti-Drift

- ALWAYS use hierarchical topology for coding swarms
- Keep maxAgents at 6-8 for tight coordination
- Use specialized strategy for clear role boundaries
- Use `raft` consensus for hive-mind (leader maintains authoritative state)
- Run frequent checkpoints via `post-task` hooks
- Keep shared memory namespace for all agents

```bash
npx @sparkleideas/cli@latest swarm init --topology hierarchical --max-agents 8 --strategy specialized
```

## Swarm Execution Rules

- ALWAYS use `run_in_background: true` for all agent Task calls
- ALWAYS put ALL agent Task calls in ONE message for parallel execution
- After spawning, STOP — do NOT add more tool calls or check status
- Never poll TaskOutput or check swarm status — trust agents to return
- When agent results arrive, review ALL results before proceeding

## V3 CLI Commands

### Core Commands

| Command | Subcommands | Description |
|---------|-------------|-------------|
| `init` | 4 | Project initialization |
| `agent` | 8 | Agent lifecycle management |
| `swarm` | 6 | Multi-agent swarm coordination |
| `memory` | 11 | AgentDB memory with HNSW search |
| `task` | 6 | Task creation and lifecycle |
| `session` | 7 | Session state management |
| `hooks` | 17 | Self-learning hooks + 12 workers |
| `hive-mind` | 6 | Byzantine fault-tolerant consensus |

### Quick CLI Examples

```bash
npx @sparkleideas/cli@latest init --wizard
npx @sparkleideas/cli@latest agent spawn -t coder --name my-coder
npx @sparkleideas/cli@latest swarm init
npx @sparkleideas/cli@latest memory search --query "authentication patterns"
npx @sparkleideas/cli@latest doctor --fix
```

## Available Agents (60+ Types)

### Core Development
`coder`, `reviewer`, `tester`, `planner`, `researcher`

### Specialized
`security-architect`, `security-auditor`, `memory-specialist`, `performance-engineer`

### Swarm Coordination
`hierarchical-coordinator`, `mesh-coordinator`, `adaptive-coordinator`

### GitHub & Repository
`pr-manager`, `code-review-swarm`, `issue-tracker`, `release-manager`

### SPARC Methodology
`sparc-coord`, `sparc-coder`, `specification`, `pseudocode`, `architecture`

## Memory Commands Reference

```bash
# Store (REQUIRED: --key, --value; OPTIONAL: --namespace, --ttl, --tags)
npx @sparkleideas/cli@latest memory store --key "pattern-auth" --value "JWT with refresh" --namespace patterns

# Search (REQUIRED: --query; OPTIONAL: --namespace, --limit, --threshold)
npx @sparkleideas/cli@latest memory search --query "authentication patterns"

# List (OPTIONAL: --namespace, --limit)
npx @sparkleideas/cli@latest memory list --namespace patterns --limit 10

# Retrieve (REQUIRED: --key; OPTIONAL: --namespace)
npx @sparkleideas/cli@latest memory retrieve --key "pattern-auth" --namespace patterns
```

## Quick Setup

```bash
claude mcp add claude-flow -- npx -y @sparkleideas/cli@latest
npx @sparkleideas/cli@latest daemon start
npx @sparkleideas/cli@latest doctor --fix
```

## Claude Code vs CLI Tools

- Claude Code's Task tool handles ALL execution: agents, file ops, code generation, git
- CLI tools handle coordination via Bash: swarm init, memory, hooks, routing
- NEVER use CLI tools as a substitute for Task tool agents

## Collective Intelligence (π.ruv.io)

- When entering a new topic area or facing an unfamiliar problem, search π: `brain_search "topic"`
- After completing significant work with reusable insights, share via `brain_share`
- When search results are useful, upvote them: `brain_vote`
- Session-start hook auto-searches π (cached hourly — no manual search needed for routine work)
- See `docs/guides/pi-brain-integration.md` for full guide

## Support

- Documentation: https://github.com/ruvnet/claude-flow
- Issues: https://github.com/ruvnet/claude-flow/issues
