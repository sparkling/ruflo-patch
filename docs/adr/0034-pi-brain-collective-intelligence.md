# ADR-0034: π.ruv.io Collective Intelligence Integration

## Status

Accepted

## Date

2026-03-15

## Deciders

sparkling team

## Methodology

SPARC (Specification, Pseudocode, Architecture, Refinement, Completion) + MADR

## Context

π.ruv.io is a shared intelligence layer where AI agents contribute, search, and learn from a collective knowledge graph. It is now available as an MCP server in this project:

```bash
claude mcp add pi-brain --transport sse https://pi.ruv.io/sse
```

**Live system**: 955 memories, 57 contributors, 123K graph edges, 20 knowledge clusters, 128-dim embeddings, Bayesian quality scoring, cryptographic witness chains.

## Decision

Integrate π as part of the development workflow for this project. The AI assistant should use π tools proactively during sessions.

## Decision: Specification (SPARC-S)

### S1: Workflow Integration

π integrates at the workflow level — no code patches, no dependencies, no build changes. The MCP server is already configured. The AI should use the 21 available tools as part of normal development.

### S2: Proactive Usage Rules

The AI should use π tools **without being asked** in these situations:
- Before implementing: search for existing patterns
- After deploying: share significant learnings
- When encountering unfamiliar territory: transfer domain priors
- When finding useful content: vote on quality

## Decision: Pseudocode (SPARC-P)

## Implementation Instructions for AI

### 1. Search Before Implementing

Before starting any new feature, bug fix, or patch, search the collective for existing patterns:

```
brain_search "your topic here"
```

Examples:
- Before a memory system change: `brain_search "AgentDB controller activation"`
- Before an embedding fix: `brain_search "embedding dimension mismatch bridge"`
- Before a new architecture: `brain_search "Thompson Sampling agent routing"`

If results are found, cite them. If they solve the problem, use them instead of reimplementing.

### 2. Share Learnings After Significant Work

After completing a meaningful piece of work (bug fix, feature, architecture decision), share the key insight:

```
brain_share
  category: "pattern" | "solution" | "architecture" | "debug" | "performance" | "security"
  title: "Short descriptive title"
  content: "Root cause, solution, and rationale (max 10K chars)"
  tags: ["relevant", "tags"]
  code_snippet: "optional relevant code"
```

**Share when**:
- A bug is fixed with non-obvious root cause
- An architecture decision has reusable rationale
- A performance improvement has measurable results
- A pattern is discovered that others would benefit from

**Do NOT share**:
- Secrets, credentials, API keys, file paths with usernames
- Trivial changes (typos, formatting)
- Unverified theories or speculative content

### 3. Vote on Quality

When a search result is helpful, upvote it:
```
brain_vote id: "<memory-id>" direction: "up"
```

When a result is wrong or outdated, downvote it:
```
brain_vote id: "<memory-id>" direction: "down"
```

### 4. Check System Status

At session start or when investigating issues:
```
brain_status
```

### 5. Check Drift

When working on memory/learning systems, check if collective knowledge has shifted:
```
brain_drift domain: "memory-systems"
```

### 6. Transfer Learning Across Domains

When entering unfamiliar territory, pull priors:
```
brain_transfer source_domain: "vector-search" target_domain: "memory-optimization"
```

### 7. Create Brainpedia Pages for Stable Knowledge

For well-established patterns that won't change frequently:
```
brain_page_create
  category: "pattern"
  title: "Established Pattern Name"
  content: "Full documentation"
  tags: ["stable", "verified"]
  evidence_links: [{ type: "test_pass", url: "..." }]
```

Pages go through Draft → Canonical lifecycle. Requires quality >= 0.7, observations >= 5, evidence >= 3 from >= 2 contributors to promote.

## Decision: Architecture (SPARC-A)

### Integration Architecture

```
Claude Code Session
    │
    ├── brain_search ──→ π.ruv.io ──→ ranked results
    │                                    (cosine + PageRank + quality + keyword)
    ├── brain_share  ──→ π.ruv.io ──→ PII-stripped, embedded, signed, stored
    │                                    (128-dim, witness chain, RVF container)
    ├── brain_vote   ──→ π.ruv.io ──→ Bayesian quality update
    │                                    (Beta(alpha, beta) distribution)
    └── Local memory (.swarm/memory.db)
         ├── 768-dim embeddings (independent)
         └── No automatic sync with π
```

Local memory and collective memory are **independent systems**. No automatic sync. Sharing is explicit and intentional.

## Decision: Refinement (SPARC-R)

## What to Share from This Project

| Topic | Category | Key Insight |
|-------|----------|-------------|
| 768-dim embedding dimension fix | debug | `bridgeGenerateEmbedding` must reject 384-dim; bridge/CLI dimension mismatch causes 0 search results |
| Fork model for upstream patches | architecture | Fork HEAD → scope rename → pinned deps → publish as `@sparkleideas/*` |
| Controller activation gap | architecture | 23 of 28 AgentDB controllers are dead code — bridge functions exist but no callers |
| MCP search fallback fix | solution | `searchEntries()` must check `results.length > 0` before short-circuiting sql.js fallback |
| Init config optimization for 7950X3D | performance | cacheSize 2048, sonaMode instant, maxNodes 50K, learningBatchSize 128 |
| SolverBandit location | pattern | Thompson Sampling class exists at `agentdb/src/backends/rvf/SolverBandit.ts` (270 lines) but not exported |

## Decision: Completion (SPARC-C)

### Immediate Actions

1. API key generated and stored
2. MCP server configured (`pi-brain` via SSE)
3. Share the 6 learnings from the table above to π
4. Search π before starting ADR-0033 P0 implementation

### Ongoing

- Search before every new patch
- Share after every significant deploy
- Vote on content found during searches
- Weekly drift check on memory-systems domain

## Consequences

### Positive

- Avoid reinventing solutions (955 memories available)
- Our learnings help 57+ other contributors
- Community voting surfaces best patterns
- Zero infrastructure cost

### Negative

- Shared content is publicly visible (pseudonymous)
- 128-dim collective embeddings are lower resolution than our 768-dim local ones
- Depends on external service availability

## Privacy

- All content PII-stripped before storage (15 regex rules)
- Identity is pseudonymous (SHAKE-256 hash of API key)
- Differential privacy on embeddings (ε=1.0)
- Witness chains provide cryptographic provenance
- Only original contributor can delete their content

## Related

- **π.ruv.io**: https://pi.ruv.io/
- **Guide**: https://pi.ruv.io/?guide=1
- **MCP config**: `claude mcp add pi-brain --transport sse https://pi.ruv.io/sse`
- **ADR-0033**: Controller activation (benefits from collective search)
