# Hook Lifecycle Analysis for Learning Integration

**Date**: 2026-03-04
**Research Scope**: hook-handler.cjs commands vs MCP expectations vs Claude Code events
**Status**: Complete (31 MCP handlers mapped)

---

## Executive Summary

The hook system has **2 layers**:

1. **Claude Code Hook Events** (fired by Claude Code editor)
   - SessionStart → fires hook-handler route/session-restore
   - UserPromptSubmit → fires hook-handler route
   - PostToolUse → fires hook-handler post-edit
   - PreToolUse → fires hook-handler pre-bash
   - SessionEnd → fires hook-handler session-end
   - Stop → fires auto-memory-hook sync

2. **MCP Handler Functions** (exposed to @claude-flow/cli)
   - 31 hook handlers exist in MCP tools (hooks-tools.js)
   - Only **7 are actually wired** into upstream settings.json
   - The other 24 are "idle" (functions exist but no settings.json entry calls them)

---

## Hook Handler Commands (hook-handler.cjs)

Each command implements a specific lifecycle point. All handlers use `safeRequire()` to load helper modules (router.js, session.js, memory.js, intelligence.cjs) without noise.

### Active Commands (Wired in settings.json)

| Handler | Event | What it does | Learning Integration | Feeds into |
|---------|-------|-------------|----------------------|-----------|
| **route** | UserPromptSubmit | Ranks agents via router.routeTask(), writes route-reward-signal.json | YES — stores agent choice + confidence | routing decision |
| **session-restore** | SessionStart | Loads session state, initializes intelligence graph | YES — calls intelligence.init() to load PageRank graph | intelligence context |
| **session-end** | SessionEnd | Consolidates intelligence graph, writes nightly-learner-signal.json | YES — calls intelligence.consolidate() to recompute PageRank | learning consolidation |
| **post-edit** | PostToolUse (Write/Edit) | Increments session.metrics.edits, calls intelligence.recordEdit() | YES — feeds edit file path to intelligence | edit history |
| **pre-bash** | PreToolUse (Bash) | Validates command safety (blocks dangerous patterns) | INDIRECT — logs safety violations | audit trail |

### Stub Commands (Not Wired / Incomplete)

| Handler | What it would do | Feeds into | Status |
|---------|------------------|-----------|--------|
| **pre-task** | Routes task, increments session.metrics.tasks | task routing | Defined but not called from settings.json |
| **post-task** | Records implicit success feedback, calls intelligence.feedback(true) | learning feedback | Defined but not called |
| **stats** | Displays intelligence stats | display | Defined but not called |
| (unknown) | compact-manual, compact-auto, status | session lifecycle | NOT IN CODE — referenced in upstream settings.json but handlers missing |

---

## MCP Handler Functions (hooks-tools.js)

31 hook handlers defined in `@claude-flow/cli/dist/src/mcp-tools/hooks-tools.js`. These are the "intended" integration points but most are NOT currently called by settings.json.

### Category: Session Lifecycle (3 handlers)

| MCP Handler | What it does | Wired in settings.json? |
|-------------|-------------|------------------------|
| `hooksSessionStart` | Init session, load memory | **YES** (via hook-handler session-restore) |
| `hooksSessionEnd` | Consolidate, archive session | **YES** (via hook-handler session-end) |
| `hooksSessionRestore` | Restore previous session | **PARTIAL** (hook-handler session-restore has CLI fallback) |

### Category: Task Routing & Execution (6 handlers)

| MCP Handler | What it does | Wired? |
|-------------|-------------|--------|
| `hooksRoute` | Route task to agent | **YES** (via hook-handler route) |
| `hooksPreTask` | Pre-task setup, routing | NO |
| `hooksPostTask` | Post-task feedback | NO |
| `hooksPreCommand` | Pre-bash command validation | **YES** (via hook-handler pre-bash) |
| `hooksPostCommand` | Post-command logging | NO |
| `hooksPreEdit` + `hooksPostEdit` | Edit tracking | **PARTIAL** (post-edit wired) |

### Category: Intelligence & Learning (6 handlers)

| MCP Handler | What it does | Wired? |
|-------------|-------------|--------|
| `hooksIntelligence` | Get ranked context (PageRank) | NO |
| `hooksIntelligenceLearn` | Record feedback for learning | NO |
| `hooksIntelligenceStats` | Display learning stats | NO |
| `hooksIntelligenceReset` | Clear learning state | NO |
| `hooksIntelligenceAttention` | Attention-weighted memory | NO |
| `hooksPatternStore` + `hooksPatternSearch` | Memory ops | NO |

### Category: Metrics & Monitoring (4 handlers)

| MCP Handler | What it does | Wired? |
|-------------|-------------|--------|
| `hooksMetrics` | Session metrics dashboard | NO |
| `hooksWorkerStatus` | Worker health | NO |
| `hooksWorkerList` | Worker inventory | NO |
| `hooksIntelligenceStats` | Learning stats | NO |

### Category: Advanced Features (12 handlers)

| MCP Handler | What it does | Wired? |
|-------------|-------------|--------|
| Trajectory tracking (3) | Trajectory start/step/end | NO |
| Model routing (4) | Model selection + outcome | NO |
| Workers (4) | Dispatch, detect, cancel | NO |
| Other (1) | hooksTools meta-handler | NO |

---

## What Each Helper Module Does

### router.js
- Routes tasks to agents based on keyword patterns
- Returns `{ agent, confidence, reason }`
- **Called by**: hook-handler route, pre-task
- **Feeds into**: Agent selection decision

### session.js
- Manages session lifecycle: start/restore/end
- Tracks metrics: edits, commands, tasks, errors
- Persists to `.claude-flow/sessions/current.json` and archives
- **Called by**: hook-handler session-restore, session-end
- **Feeds into**: Session context for cross-session memory

### memory.js
- Simple key-value store for cross-session context
- Persists to `.claude-flow/data/memory.json`
- **Called by**: (loaded but NOT used in hook-handler.cjs currently)
- **Feeds into**: Context sharing between sessions

### intelligence.cjs
- Loads/saves knowledge graph from `graph-state.json`
- Tracks edits in `pending-insights.jsonl`
- Consolidates via PageRank algorithm
- Generates ranked context for routing
- **Called by**: hook-handler route, session-restore, session-end, post-edit
- **Feeds into**: Learning loop, ranked context injection

---

## Claude Code Hook Event → MCP Handler Mapping

```
SessionStart
  → hook-handler session-restore
     → session.restore()
     → intelligence.init()
  → auto-memory-hook.mjs import (separate entry)

UserPromptSubmit
  → hook-handler route
     → intelligence.getContext()
     → router.routeTask()
     → writes route-reward-signal.json

PostToolUse (Write|Edit|MultiEdit)
  → hook-handler post-edit
     → session.metric('edits')
     → intelligence.recordEdit()

PreToolUse (Bash)
  → hook-handler pre-bash
     → validateCommandSafety()

SessionEnd
  → hook-handler session-end
     → intelligence.consolidate()
     → writes nightly-learner-signal.json
     → session.end()

Stop
  → auto-memory-hook.mjs sync (separate entry)

[NOT WIRED]
  → hook-handler pre-task
     → session.metric('tasks')
     → router.routeTask()

[NOT WIRED]
  → hook-handler post-task
     → intelligence.feedback(true)
```

---

## Classification: ESSENTIAL / IMPORTANT / OPTIONAL

### ESSENTIAL (Must be wired for learning/memory to work)

1. **session-restore** (SessionStart)
   - Initializes intelligence graph
   - Restores session state
   - Without this: intelligence starts blank every session

2. **session-end** (SessionEnd)
   - Consolidates PageRank graph
   - Saves learning state
   - Without this: insights are lost

3. **route** (UserPromptSubmit)
   - Injects ranked context into routing
   - Records routing decision for feedback
   - Without this: no intelligent routing

4. **post-edit** (PostToolUse)
   - Records edits for intelligence
   - Tracks edit metrics
   - Without this: no edit history for learning

### IMPORTANT (Significantly improves learning quality)

1. **hooksIntelligence** / **hooksIntelligenceLearn**
   - Need to expose intelligence API to MCP tools
   - Currently missing from settings.json
   - Would allow explicit feedback recording

2. **hooksPatternStore** / **hooksPatternSearch**
   - Need to expose memory API to MCP tools
   - Required for `npx @claude-flow/cli memory` commands

3. **hooksMetrics** / **hooksIntelligenceStats**
   - Dashboard visibility into learning progress
   - NOT critical but enables monitoring

4. **pre-task** (hook-handler)
   - Would capture task-level routing
   - Currently defined but not wired
   - Should be added to settings.json PreTask event (NOT AVAILABLE)

### OPTIONAL (Nice-to-have, not core)

1. **post-task** (hook-handler)
   - Implicit success feedback
   - Requires Claude Code PostTask event (doesn't exist)

2. Worker/trajectory/model routing handlers
   - Useful for multi-agent swarms
   - Not needed for single-agent setup

3. **pre-bash** validation
   - Safety net, not core to learning

### PROJECT-SPECIFIC

1. **auto-memory-hook.mjs**
   - Specific to this repo's integration approach
   - Implements ESM-side memory store reading
   - Not part of upstream MCP

---

## Gaps in Current Implementation

### Gap 1: Missing Claude Code Events
- `PreTask` event doesn't exist (would call hook-handler pre-task)
- `PostTask` event doesn't exist (would call hook-handler post-task)
- Solution: Use hooks at task lifecycle instead

### Gap 2: MCP Handlers Not Wired
- 24/31 MCP handlers exist but aren't called by settings.json
- Would need to manually invoke via MCP protocol or add to init template

### Gap 3: Missing Settings.json Entries
- **Missing compact-manual** (referenced in upstream settings.json but no handler)
- **Missing compact-auto** (referenced but no handler)
- **Missing status** (called by SubagentStart but handler missing)

### Gap 4: Handler vs MCP Name Mismatch
- hook-handler uses CJS commands: `route`, `session-restore`, `session-end`, etc.
- MCP uses camelCase exports: `hooksRoute`, `hooksSessionStart`, etc.
- No direct mapping — they're separate implementations

---

## Learning Loop Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    LEARNING PIPELINE                         │
└─────────────────────────────────────────────────────────────┘

SESSION START
  ↓ session-restore handler
  ├─ Load .claude-flow/sessions/current.json
  └─ Intelligence.init()
     └─ Load .claude-flow/data/graph-state.json (PageRank graph)

USER SUBMITS PROMPT
  ↓ route handler
  ├─ intelligence.getContext() → ranked memory entries
  ├─ router.routeTask() → select agent
  └─ Write .claude-flow/data/route-reward-signal.json

EDIT A FILE
  ↓ post-edit handler
  ├─ session.metric('edits')
  └─ intelligence.recordEdit(filepath)
     └─ Append to .claude-flow/data/pending-insights.jsonl

SESSION END
  ↓ session-end handler
  ├─ Intelligence.consolidate()
  │  └─ Recompute PageRank from graph
  │  └─ Save updated graph-state.json
  └─ Write .claude-flow/data/nightly-learner-signal.json

EXTERNAL LEARNING (auto-memory-hook.mjs)
  ↓ (separate from hook-handler)
  ├─ Read .swarm/memory.db entries
  ├─ Inject ranked context via ESM bridge
  └─ Signal CJS intelligence layer
```

---

## Key Findings

1. **Two parallel systems exist**: hook-handler.cjs (CJS) and MCP tools (ESM)
   - They don't call each other directly
   - Must be wired separately into settings.json

2. **Only 5/8 core handlers are wired**
   - pre-task, post-task, stats are defined but not called
   - compact-manual, compact-auto, status handlers don't exist

3. **Intelligence graph is PageRank-based**
   - Loaded at session start
   - Edges built from pending insights (edits + routing decisions)
   - Consolidated at session end

4. **Signals bridge CJS↔ESM**
   - route-reward-signal.json (CJS → ESM via file)
   - nightly-learner-signal.json (CJS → ESM via file)
   - These allow ESM @claude-flow/memory to read CJS outcomes

5. **No direct coupling** between router/session/memory helpers
   - Each is independent
   - Integration happens at hook-handler dispatcher level
   - Easy to extend or replace individual helpers
