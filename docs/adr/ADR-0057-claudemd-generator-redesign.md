# ADR-0057: CLAUDE.md Generator Redesign

- **Status**: Proposed
- **Date**: 2026-04-03
- **Deciders**: ruflo-patch maintainers
- **Methodology**: SPARC + MADR

## Decision Drivers

1. Current generator produces ~250 lines (standard) to ~400 lines (full) of CLAUDE.md, far exceeding the ~100-line / 4,000-character budget where per-project instructions remain effective
2. 12 instances of "Task tool" across 3 functions -- the correct Claude Code tool name is "Agent tool" (SubagentStart/SubagentStop in hook events)
3. `autoStartProtocol()` shows `Task({prompt:..., subagent_type:...})` pseudo-code that does not match how Claude Code tool invocations actually work (XML tool_use blocks)
4. `executionRules()` references "poll TaskOutput" -- no such tool exists
5. `setupAndBoundary()` says "Task tool handles ALL execution" -- wrong tool name
6. "ADR-026" in `swarmOrchestration()` points to upstream's ADR numbering, not the local ruflo-patch ADR-0026 (Pipeline Stage Decoupling)
7. Sections like `intelligenceSystem()` use jargon Claude does not understand (SONA, EWC++, LoRA, Flash Attention) -- these are not actionable instructions
8. Several sections are reference material (agent type catalogs, CLI command tables, hook/worker inventories) that belong in tool discovery, not in per-project instructions

## Context and Problem Statement

CLAUDE.md serves two purposes with different audiences:

| Purpose | Audience | Location | Budget |
|---------|----------|----------|--------|
| **Project rules** -- what to do and not do when working in this project | Claude Code session operating on the project | `./CLAUDE.md` (per-project) | < 100 lines, < 4,000 chars |
| **Tool discovery** -- how to find and invoke MCP tools, CLI commands, agent types | Claude Code session needing to use claude-flow features | `~/.claude/CLAUDE.md` (global) | Unbounded (loaded once) |

The current generator conflates both purposes into a single per-project file. This wastes context window on reference material that never changes between projects, while diluting the project-specific rules that actually govern behavior.

### Principles for the Redesign

1. **Per-project CLAUDE.md is a rulebook, not a manual.** Every line must be an imperative instruction or a concise build/test reference. No catalogs, no tables of available features.
2. **Global CLAUDE.md is a discovery index.** Agent types, CLI commands, hook inventories, memory commands, and setup instructions go here. Loaded once per user, not per project.
3. **Correct tool names.** Claude Code's subagent spawning tool is called "Agent", not "Task". The hook events are `SubagentStart` and `SubagentStop`.
4. **No pseudo-code examples for tool invocation.** Claude Code tools are invoked via XML tool_use blocks that Claude already knows how to produce. Showing incorrect JavaScript-style examples is worse than showing nothing.
5. **No framework jargon Claude cannot act on.** Terms like SONA, EWC++, HNSW, LoRA, Flash Attention are internal implementation details. CLAUDE.md instructions must use plain terms Claude can execute.
6. **Deferred MCP tools bridge the gap.** When the claude-flow MCP server is registered, its 150+ tools appear in `system-reminder` blocks. The generator should not duplicate what the MCP tool registry already provides.

## Decision

### 1. Template Hierarchy

Reduce from 6 templates to 3. The removed templates were combinations of the standard template with extra sections bolted on -- that complexity belongs in the global file.

| Template | Lines | Use Case |
|----------|-------|----------|
| `minimal` | ~40 | Solo developer, no swarm, basic rules |
| `standard` | ~75 | Default. Behavioral rules, build/test, security, concurrency, agent orchestration |
| `full` | ~95 | Adds swarm topology config, memory usage rules, learning protocol |

The `security`, `performance`, and `solo` templates are removed. `solo` is replaced by `minimal`. `security` and `performance` added a few domain-specific rules that can be injected as optional section fragments into `standard` or `full` via `--with-security` / `--with-performance` flags rather than being separate templates.

### 2. Section Inventory

#### Sections to KEEP (rewritten for correctness and brevity)

| Section | Current Function | Change |
|---------|-----------------|--------|
| Behavioral Rules | `behavioralRules()` | Keep as-is. 8 lines, all enforceable. |
| File Organization | `fileOrganization()` | Keep as-is. 7 lines. |
| Build & Test | `buildAndTest()` | Keep. Parameterized from `package.json` scripts. |
| Security Rules | `securityRulesLight()` | Keep. 5 lines. |
| Concurrency Rules | `concurrencyRules()` | Rewrite: fix "Task tool" to "Agent tool" (3 instances). |
| Execution Rules | `executionRules()` | Rewrite: fix "Task calls" to "Agent calls", remove "poll TaskOutput". |

#### Sections to CUT from per-project (move to global)

| Section | Current Function | Reason |
|---------|-----------------|--------|
| CLI Commands Table | `cliCommandsTable()` | Reference material. 20 lines of table. |
| Agent Types | `agentTypes()` | Reference material. 15 lines listing 25 agent names. |
| Memory Commands | `memoryCommands()` | Reference material. 12 lines of bash examples. |
| Hooks System | `hooksSystem()` | Reference material. 25 lines of hook/worker tables. |
| Intelligence System | `intelligenceSystem()` | Jargon Claude cannot act on. 10 lines. |
| Environment Variables | `envVars()` | Reference material. 8 lines. |
| Quick Setup | `setupAndBoundary()` | One-time setup. 10 lines. Belongs in global. |

#### Sections to CUT entirely

| Section | Current Function | Reason |
|---------|-----------------|--------|
| Auto-Start Protocol | `autoStartProtocol()` | Contains incorrect Task() pseudo-code. Agent spawning is done through tool_use, not function calls. The routing table and complexity detection heuristics are not actionable. |
| Anti-Drift Config | `antiDriftConfig()` | Duplicates swarm init command. The actual anti-drift mechanism is the hive-mind consensus, which is runtime behavior, not an instruction. |
| 3-Tier Model Routing | inside `swarmOrchestration()` | References "ADR-026" (wrong ADR), contains pricing/latency numbers Claude cannot act on, and the `[AGENT_BOOSTER_AVAILABLE]` signal comes from hooks, not from CLAUDE.md. |
| Learning Protocol | `learningProtocol()` | Memory search/store is a tool capability, not a rule. The MCP tool registry handles discovery. |

#### Sections to ADD

| Section | Content | Rationale |
|---------|---------|-----------|
| Project Architecture (slim) | 3 lines: DDD, 500-line limit, typed interfaces | Cut the "Project Config" sub-section (topology/HNSW/neural are runtime config, not instructions) |
| Agent Orchestration | 5 lines: when to spawn agents, use `run_in_background: true`, batch in one message, wait for results | Replaces swarmOrchestration + executionRules + autoStartProtocol with correct tool names |

### 3. Per-Project CLAUDE.md: `standard` Template Output

The exact markdown content the generator should produce for the `standard` template. Parameterized values shown in `${...}` notation.

```markdown
# ${projectName}

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
${buildTestBlock}
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
```

**Line count**: 52 lines of content + blank lines = ~70 lines total.
**Character count**: ~2,400 characters.

### 4. Global CLAUDE.md Block

Written to `~/.claude/CLAUDE.md` by `init --full` (or `init --setup-global`). This is additive -- the generator appends a clearly delimited block, not replacing existing content.

```markdown
<!-- claude-flow:start -->
## Claude Flow: Tool Discovery

### MCP Server

The `claude-flow` MCP server provides 150+ tools for agent coordination, memory,
hooks, swarm management, and more. If the MCP server is registered, these tools
appear automatically in system-reminder blocks. Use ToolSearch to find specific
tools by name or keyword.

### CLI Quick Reference

```bash
# Agent management
npx @sparkleideas/cli@latest agent spawn -t coder --name my-coder
npx @sparkleideas/cli@latest agent list

# Swarm coordination
npx @sparkleideas/cli@latest swarm init --topology hierarchical --max-agents 8
npx @sparkleideas/cli@latest swarm status

# Memory (store, search, retrieve, list, delete)
npx @sparkleideas/cli@latest memory store --key "name" --value "data" --namespace ns
npx @sparkleideas/cli@latest memory search --query "search terms"

# Hooks and learning
npx @sparkleideas/cli@latest hooks pre-task --description "task"
npx @sparkleideas/cli@latest hooks post-task --task-id "id" --success true

# Diagnostics
npx @sparkleideas/cli@latest doctor --fix
npx @sparkleideas/cli@latest system health
```

### Agent Types

Core: `coder`, `reviewer`, `tester`, `planner`, `researcher`
Specialized: `security-architect`, `security-auditor`, `performance-engineer`
Coordination: `hierarchical-coordinator`, `mesh-coordinator`
GitHub: `pr-manager`, `code-review-swarm`, `issue-tracker`, `release-manager`

### Setup

```bash
claude mcp add claude-flow -- npx -y @sparkleideas/cli@latest
npx @sparkleideas/cli@latest daemon start
npx @sparkleideas/cli@latest doctor --fix
```

### Support

- Docs: https://github.com/ruvnet/claude-flow
- Issues: https://github.com/ruvnet/claude-flow/issues
<!-- claude-flow:end -->
```

The `<!-- claude-flow:start -->` / `<!-- claude-flow:end -->` markers allow `init --setup-global` to be idempotent: re-running replaces the block rather than appending duplicates.

### 5. Bug Fix Inventory

All 6 known bugs and their resolution in the new design:

| Bug | Current Code | Resolution |
|-----|-------------|------------|
| "Task tool" (12 instances) | `concurrencyRules()`, `swarmOrchestration()`, `executionRules()`, `setupAndBoundary()` | Replaced with "Agent tool" in new `concurrency` and `agentOrchestration` sections |
| "ADR-026" reference | `swarmOrchestration()` line 77 | Section removed from per-project. No ADR reference needed. |
| `Task({prompt:..., subagent_type:...})` | `autoStartProtocol()` lines 116-120 | Section removed entirely. No pseudo-code for tool invocation. |
| "poll TaskOutput" | `executionRules()` line 145 | Replaced with "wait for results before proceeding" |
| "Task tool handles ALL execution" | `setupAndBoundary()` line 375 | Section moved to global. Rewritten as "Agent tool subagents" |
| Incorrect JS pseudo-code | `autoStartProtocol()` lines 111-121 | Section removed. Claude already knows how to invoke tools via tool_use. |

### 6. Generator TypeScript Structure

The new `claudemd-generator.ts` should have this structure:

```
TEMPLATE_SECTIONS = {
  minimal: [behavioralRules, fileOrg, buildTest, security],
  standard: [behavioralRules, fileOrg, architecture, buildTest, security, concurrency, agentOrchestration],
  full: [behavioralRules, fileOrg, architecture, buildTest, security, concurrency, agentOrchestration, swarmConfig, memoryRules],
}

generateClaudeMd(options, template) -> per-project CLAUDE.md
generateGlobalBlock(options) -> global ~/.claude/CLAUDE.md block
```

Section functions: 9 total (down from 17).

| Function | Lines | Templates |
|----------|-------|-----------|
| `behavioralRules()` | 9 | all |
| `fileOrganization()` | 5 | all |
| `architecture()` | 6 | standard, full |
| `buildAndTest(options)` | 8 | all |
| `securityRules()` | 6 | all |
| `concurrencyRules()` | 6 | standard, full |
| `agentOrchestration()` | 8 | standard, full |
| `swarmConfig(options)` | 6 | full |
| `memoryRules()` | 5 | full |

Plus one new export:

| Function | Lines | Purpose |
|----------|-------|---------|
| `generateGlobalBlock()` | ~50 | Produces the `<!-- claude-flow:start -->` block for ~/.claude/CLAUDE.md |

## Consequences

### Positive

- Per-project CLAUDE.md drops from ~250 lines to ~70 lines (72% reduction), staying well within the 4,000-character budget
- All 12 "Task tool" references corrected to "Agent tool"
- No incorrect pseudo-code examples that teach Claude wrong invocation patterns
- Reference material moves to global where it is loaded once, not per-project
- Generator shrinks from 17 section functions to 9, reducing maintenance surface
- Idempotent global block with HTML comment markers

### Negative

- Users who relied on per-project CLI command tables or agent type lists will need to run `init --setup-global` to get that content into their global file
- 3 templates instead of 6 reduces granularity (mitigated by `--with-security` / `--with-performance` flags)
- Existing projects that re-run `init` will get a much shorter CLAUDE.md, which may surprise users

### Risks

| Risk | Mitigation |
|------|------------|
| Users miss CLI reference after upgrade | `init` prints a notice: "CLI reference moved to ~/.claude/CLAUDE.md. Run `init --setup-global` to install." |
| Global block conflicts with user's existing ~/.claude/CLAUDE.md | HTML comment markers make the block replaceable. Generator reads existing content and only replaces within markers. |
| ADR-0035 tests (S-08, S-17) assume specific CLAUDE.md content | Tests must be updated to match new template output. Specifically: line count assertions, content pattern checks. |
