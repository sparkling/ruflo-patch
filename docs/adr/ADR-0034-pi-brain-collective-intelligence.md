---
status: accepted
date: 2026-03-15
tags: [pi-brain, collective-intelligence, mcp]
supersedes: []
depends-on: []
implements: []
---

# π.ruv.io Collective Intelligence Integration

## Context and Problem Statement

π.ruv.io is a shared intelligence layer where AI agents contribute, search, and learn from a collective knowledge graph. 955 memories, 57 contributors, 123K graph edges, 20 clusters.

MCP server configured: `claude mcp add pi-brain --transport sse https://pi.ruv.io/sse`

### Hive Consensus Results

Four integration strategies were proposed and voted on by a 5-member specialist hive:

| Option | For | Against | Verdict |
|--------|-----|---------|---------|
| **C: Session-driven** (search at start, cache, share at end) | **5** | 0 | **Unanimous** |
| **A+: Manual with CLAUDE.md rule** (behavioral, no automation) | **4** | 1 | **Strong consensus** |
| B: Hook-driven pre-task (auto-search every task) | 2 | 3 | Rejected — noisy for trivial tasks |
| E: Full 91-tool integration (add npx ruvector MCP) | 1 | 4 | Rejected — overlaps with local tools |

## Considered Options

* **Option C: Session-driven** (search at start, cache, share at end) — unanimous (5 for, 0 against).
* **Option A+: Manual with CLAUDE.md rule** (behavioral, no automation) — strong consensus (4 for, 1 against).
* **Option B: Hook-driven pre-task** (auto-search every task) — Rejected, noisy for trivial tasks (2 for, 3 against).
* **Option E: Full 91-tool integration** (add npx ruvector MCP) — Rejected, overlaps with local tools (1 for, 4 against).

## Decision Outcome

Chosen option: "Option C + A+ combined", because session-driven search/share won unanimous consensus and the behavioral CLAUDE.md rule (A+) reinforces it, while the hook-driven (B) and full 91-tool (E) options were rejected as noisy and overlapping respectively.

Implement **Option C + A+** combined:

- **A+ (behavioral)**: CLAUDE.md instructs AI to search π before implementing and share after deploying
- **C (session-driven)**: At session-start, search π for project-relevant patterns (8-hour cache, max 2 calls/day). All sharing is explicit via MCP tool

### Specification (SPARC-S)

#### S1: CLAUDE.md Behavioral Rule (A+)

Add to project CLAUDE.md under Build & Test or as a new section:

> Before starting any new patch or investigation, search π (`brain_search`) for relevant patterns.
> After completing a significant deploy, share the key finding via `brain_share`.

#### S2: Session-Start Search (C)

At the beginning of each session, search π for patterns relevant to the current project:

```
brain_search "agentdb controller activation memory bridge"
brain_search "fork model upstream patches npm publish"
```

Cache the top results mentally — reference them during the session.

#### S3: Session-End Share (C)

At the end of a session with significant work, share 1-2 key findings:

```
brain_share
  category: "pattern" | "solution" | "debug" | "architecture"
  title: "Short descriptive title"
  content: "Root cause, solution, rationale"
  tags: ["relevant", "tags"]
```

#### S4: Vote on Quality

When search returns useful results, upvote. When wrong or outdated, downvote:
```
brain_vote id: "<memory-id>" direction: "up"
```

### Pseudocode (SPARC-P)

#### Session Lifecycle

```
SESSION START:
  1. brain_search "project-relevant query 1"
  2. brain_search "project-relevant query 2"
  3. Note useful results for reference during session

DURING SESSION:
  4. Before any new patch: brain_search "specific topic"
  5. If result solves problem: use it, cite it, upvote it
  6. If result is wrong: downvote it

SHARING (explicit only, never automatic):
  7. If significant work completed with reusable insight:
     brain_share category/title/content/tags  (via MCP tool)
  8. If drift suspected:
     brain_drift domain: "memory-systems"  (via MCP tool)
```

### Architecture (SPARC-A)

#### Integration Architecture

```
Session Start
    │
    ├── brain_search ──→ π.ruv.io ──→ cached context
    │
    ├── Work happens (patches, deploys, investigations)
    │   └── brain_search as needed for specific topics
    │
    ├── brain_vote on useful/wrong results found
    │
Session End
    │
    └── brain_share significant findings
```

No hooks, no auto-sync, no fork patches. Pure behavioral integration via MCP tools already configured.

#### What NOT to do

- Do NOT add π search to pre-task hooks (rejected — noisy for trivial tasks)
- Do NOT add the 91-tool npx ruvector MCP server (rejected — overlaps with local claude-flow)
- Do NOT auto-sync local memory to π (privacy risk, unnecessary coupling)

### Refinement (SPARC-R)

#### Share Categories

| When | Category | Example |
|------|----------|---------|
| Bug fix with non-obvious root cause | `debug` | MCP search 0-results: bridge fallback + dimension mismatch |
| Architecture decision with reusable rationale | `architecture` | 23/28 controllers dead code — bridge exists but no callers |
| Performance improvement with measurable results | `performance` | Search scores 0.27→0.88 after 768-dim fix |
| Reusable pattern | `pattern` | SolverBandit Thompson Sampling — exists but not exported |
| Security finding | `security` | MutationGuard stub always returns allowed:true |

#### Do NOT Share

- Secrets, credentials, API keys, file paths with usernames
- Trivial changes (typos, formatting)
- Unverified theories or speculative content
- Raw code files (use `code_snippet` for relevant excerpts)

### Completion (SPARC-C)

#### Already Done

1. MCP server configured (`pi-brain` via SSE)
2. 3 learnings shared to π (MCP search bug, controller gap, SolverBandit)
3. ADR-0034 created

#### Implementing Now

4. CLAUDE.md updated with behavioral rule
5. Portable AI integration guide created at `docs/guides/pi-brain-integration.md`

#### Ongoing

- Search π at session start
- Share findings at session end
- Vote on content found during searches

### Consequences

* Good, because it avoids reinventing solutions (955+ memories available)
* Good, because our learnings help 57+ other contributors
* Good, because zero infrastructure — behavioral integration only
* Good, because no latency impact on per-task operations
* Bad, because it depends on AI remembering to search (mitigated by CLAUDE.md rule)
* Bad, because shared content is publicly visible (pseudonymous)
* Bad, because 128-dim collective embeddings are lower resolution than our 768-dim local ones

## Privacy

- All content PII-stripped before storage (15 regex rules)
- Identity is pseudonymous (SHAKE-256 hash of API key)
- Differential privacy on embeddings (ε=1.0)
- Witness chains provide cryptographic provenance
- Only original contributor can delete their content

## More Information

Related references: π.ruv.io (https://pi.ruv.io/), the guide (https://pi.ruv.io/?guide=1), GitHub (https://github.com/ruvnet/RuVector), the portable integration guide at `docs/guides/pi-brain-integration.md`, and the MCP config command `claude mcp add pi-brain --transport sse https://pi.ruv.io/sse`.

This record used the SPARC + MADR + Hive-Mind Consensus methodology, with section headings (Specification / Pseudocode / Architecture / Refinement / Completion) remapped to the canonical MADR sections during the ADR-0271 migration, preserving all content. The deciders were the sparkling team (hive consensus: 5 specialists, Byzantine mesh topology). Original status: "Accepted".
