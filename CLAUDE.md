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
- ALWAYS commit often — after every meaningful change (new patch, new ADR, config update, test fix). Do not accumulate uncommitted work across multiple tasks

## File Organization

- NEVER save to root folder — use the directories below
- Use `/src` for source code files
- Use `/tests` for test files
- Use `/docs` for documentation and markdown files
- Use `/config` for configuration files
- Use `/scripts` for utility scripts
- Use `/examples` for example code

## Adversarial Prompting Workflow (ADR-0087)

Before implementing any non-trivial feature or architectural change:

1. Describe the proposed approach to the AI
2. Ask it to find the **3 best reasons the architecture is wrong**
3. Ask what a **senior engineer would say 3 years from now**
4. Only after this adversarial pass, proceed with implementation

Use AI to be **less wrong**, not to go faster.

When running parallel sessions, frame them as **thinking types** (implementation, adversarial review, test generation, documentation, simplification) — not arbitrary task splits. The `route` hook emits `[ADR-0087] Parallel sessions:` advisories automatically for architectural prompts.

The `route` hook also emits `[ADR-0087] AI-first review:` advisories listing review focus areas (conventions, edge-cases, architecture, security, test-coverage, compatibility) tailored to the type of change. AI performs first-pass review before any human sees the code.

## What We Tried and Won't Try Again

- [2026-03] SPARC-style upstream rewrite — 44-49 week scope covers 15-20%; fork-patch ships immediately (ADR-0055)
- [2026-04] SQLite-first storage — RVF is primary; SQLite is fallback only (ADR-0086)
- [2026-04] Silent fallback paths in tests — masks real failures; tests must fail loudly (ADR-0082)
- [2026-04] Sidecar JSON files — eliminated in favor of single storage abstraction (ADR-0085)
- [2026-04] Subtracted parallel sessions per trigger — refactors need docs (stale risk), phased work needs simplification (cruft accumulates); all triggers get all 5 sessions (ADR-0087)
- [2026-04] Daemon in CLI hot path — ADR-0059 Phase 4's "single writer via IPC" contradicted upstream ADR-050 ("daemon adds process mgmt + health check + IPC complexity; file-based is simpler, more reliable"). `DaemonIPCClient` shipped with zero callers for months. Daemon now scoped to cross-platform timer scheduler only (ADR-0088).
- [2026-04] `npx @sparkleideas/cli@latest` in parallel acceptance checks — serializes 50+ concurrent checks behind npm's 23GB cache lock. Always use `$(_cli_cmd)` which resolves the installed symlink at `$TEMP_DIR/node_modules/.bin/cli`. 36x difference observed (277-317s → 7.7s in adr0080-store-init flake).
- [2026-04] `var=$(grep -c 'pat' file || echo 0)` bash anti-pattern — `grep -c` already prints "0" on zero matches AND exits 1, so `|| echo 0` appends a second "0" producing "0\n0" which trips bash arithmetic. Always use `var=$(grep -c 'pat' 2>/dev/null); var=${var:-0}`.
- [2026-04] Deleting upstream-maintained files to satisfy the 500-line rule — upstream merge tax (17-file migration, permanent conflict risk) exceeds aesthetic gain. Intercept pattern achieves runtime unity without source deletion (ADR-0089). `controller-registry.ts` stays at 2063 LOC; `agentdb-service.ts` stays at 1831 LOC; both wrap controller instantiations through `getOrCreate()` pool.

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

### Cascading Pipeline (ADR-0038)

Each script includes all previous steps — running a later step runs everything before it:

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
| 9 | `test:acceptance` | 1-8 | Acceptance checks against real init'd project |
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
| **Unit** | `tests/unit/*.test.mjs` | London School TDD — `mockFn()`/`mockCtor()`, mocked deps, no I/O | `npm run test:unit` |
| **Integration** | `tests/unit/*.test.mjs` | Real I/O — file persistence, subprocess exec, pipeline exercises | `npm run test:unit` |
| **Acceptance** | `lib/acceptance-*.sh` wired into `scripts/test-acceptance.sh` | Bash checks against real `init --full` project with published packages | `npm run test:acceptance` |

#### Writing tests: ALL THREE levels in the same pass

1. **Unit**: mock the function under test, verify wiring contracts (constructor args, fallback chains, return types)
2. **Integration**: exercise real components with real I/O (file reads/writes, subprocess calls, data round-trips)
3. **Acceptance**: add bash check functions in `lib/acceptance-{feature}-checks.sh`, source it in `test-acceptance.sh`, wire into the appropriate group with `run_check_bg` + `collect_parallel`

Never treat acceptance tests as optional or "later" work. The framework exists — use it.

#### Fast acceptance runner (iterating on specific checks)

For debugging or iterating on acceptance check code without rebuilding packages:

```bash
# Run Phase 3+4 checks only (~90s, reuses existing temp dirs)
bash scripts/test-acceptance-fast.sh p3,p4

# Run all ADR-0059 checks (Phase 1-4, 18 checks)
bash scripts/test-acceptance-fast.sh all

# Run specific groups
bash scripts/test-acceptance-fast.sh p3        # Phase 3 only
bash scripts/test-acceptance-fast.sh adr0059   # Phase 1+2 only
```

Requires Verdaccio running and packages published (from a prior `npm run test:acceptance`). Reuses existing `/tmp/ruflo-accept-*` and `/tmp/ruflo-e2e-*` dirs. Runs checks sequentially (no subshell — reliable variable propagation).

#### Running tests: ALL THREE levels every time

When asked to run/test/verify, ALWAYS run all available levels:

```bash
# Level 1+2: Unit + Integration (always available)
npm run test:unit

# Level 3: Acceptance (requires Verdaccio — check first, run if up)
curl -sf http://localhost:4873/-/ping && npm run test:acceptance
```

**NEVER run only `test:unit` and call it done.** If Verdaccio is down, say so explicitly — do not silently skip acceptance. If packages need building first, say that too.

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

## Swarm Protocols & Routing

### Auto-Start Swarm Protocol

When the user requests a complex task, spawn agents in background and WAIT:

```javascript
// STEP 1: Initialize swarm coordination
Bash("npx @sparkleideas/cli@latest swarm init --topology hierarchical --max-agents 8 --strategy specialized")

// STEP 2: Spawn ALL agents IN BACKGROUND in a SINGLE message
Task({prompt: "Research requirements...", subagent_type: "researcher", run_in_background: true})
Task({prompt: "Design architecture...", subagent_type: "system-architect", run_in_background: true})
Task({prompt: "Implement solution...", subagent_type: "coder", run_in_background: true})
Task({prompt: "Write tests...", subagent_type: "tester", run_in_background: true})
Task({prompt: "Review code quality...", subagent_type: "reviewer", run_in_background: true})
```

### Agent Routing

| Code | Task | Agents |
|------|------|--------|
| 1 | Bug Fix | coordinator, researcher, coder, tester |
| 3 | Feature | coordinator, architect, coder, tester, reviewer |
| 5 | Refactor | coordinator, architect, coder, reviewer |
| 7 | Performance | coordinator, perf-engineer, coder |
| 9 | Security | coordinator, security-architect, auditor |

### Task Complexity Detection

- AUTO-INVOKE SWARM when task involves: 3+ files, new features, cross-module refactoring, API changes, security, or performance work
- SKIP SWARM for: single file edits, simple bug fixes (1-2 lines), documentation updates, configuration changes

## Hooks System (27 Hooks + 12 Workers)

### Essential Hooks

| Hook | Description |
|------|-------------|
| `pre-task` / `post-task` | Task lifecycle with learning |
| `pre-edit` / `post-edit` | File editing with neural training |
| `session-start` / `session-end` | Session state persistence |
| `route` | Route task to optimal agent |
| `intelligence` | RuVector intelligence system |
| `worker` | Background worker management |

### 12 Background Workers

| Worker | Priority | Description |
|--------|----------|-------------|
| `optimize` | high | Performance optimization |
| `audit` | critical | Security analysis |
| `testgaps` | normal | Test coverage analysis |
| `map` | normal | Codebase mapping |
| `deepdive` | normal | Deep code analysis |
| `document` | normal | Auto-documentation |

```bash
npx @sparkleideas/cli@latest hooks pre-task --description "[task]"
npx @sparkleideas/cli@latest hooks post-task --task-id "[id]" --success true
npx @sparkleideas/cli@latest hooks worker dispatch --trigger audit
```

## Auto-Learning Protocol

### Before Starting Any Task
```bash
npx @sparkleideas/cli@latest memory search --query "[task keywords]" --namespace patterns
npx @sparkleideas/cli@latest hooks route --task "[task description]"
```

### After Completing Any Task Successfully
```bash
npx @sparkleideas/cli@latest memory store --namespace patterns --key "[pattern-name]" --value "[what worked]"
npx @sparkleideas/cli@latest hooks post-task --task-id "[id]" --success true --store-results true
```

- ALWAYS check memory before starting new features, debugging, or refactoring
- ALWAYS store patterns in memory after solving bugs, completing features, or finding optimizations

## Intelligence System (RuVector)

- **SONA**: Self-Optimizing Neural Architecture (<0.05ms adaptation)
- **HNSW**: 150x-12,500x faster pattern search
- **EWC++**: Elastic Weight Consolidation (prevents forgetting)
- **Flash Attention**: 2.49x-7.47x speedup

The 4-step intelligence pipeline:
1. **RETRIEVE** - Fetch relevant patterns via HNSW
2. **JUDGE** - Evaluate with verdicts (success/failure)
3. **DISTILL** - Extract key learnings via LoRA
4. **CONSOLIDATE** - Prevent catastrophic forgetting via EWC++

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
npx @sparkleideas/cli@latest swarm init --v3-mode
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

## Environment Variables

```bash
CLAUDE_FLOW_CONFIG=./claude-flow.config.json
CLAUDE_FLOW_LOG_LEVEL=info
ANTHROPIC_API_KEY=sk-ant-...
CLAUDE_FLOW_MEMORY_BACKEND=hybrid
CLAUDE_FLOW_MEMORY_PATH=./data/memory
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


## Support

- Documentation: https://github.com/ruvnet/claude-flow
- Issues: https://github.com/ruvnet/claude-flow/issues
