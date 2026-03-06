# ADR-0024: Agent Booster Integration

- **Status**: Proposed
- **Date**: 2026-03-07
- **Deciders**: ruflo-patch maintainers
- **Methodology**: SPARC + MADR

## Context

The `@sparkleideas/cli` ships a `CLAUDE.md` to every user project via `npx @sparkleideas/cli init`. That file defines a 3-Tier Model Routing system (ADR-026) and instructs agents to:

> "Always check for `[AGENT_BOOSTER_AVAILABLE]`" and "Use Edit tool directly when `[AGENT_BOOSTER_AVAILABLE]`"

Tier 1 is the Agent Booster -- a Rust/WASM package that performs AST-aware code transformations locally in sub-millisecond time at zero cost. It handles simple, deterministic edits (var-to-const, add types, rename variables) without making any LLM API call.

**The problem**: `agent-booster` is not published under the `@sparkleideas` scope. Users of `@sparkleideas/cli` see the Tier 1 routing instructions in their CLAUDE.md but have no way to activate them without manually discovering and installing a separate, differently-scoped package. In practice, most users never do this. The result is that every code edit -- no matter how trivial -- falls through to Tier 2 (Haiku, ~500ms, $0.0002) or Tier 3 (Sonnet/Opus, 2-5s, $0.003-0.015). Users pay more money and wait longer for edits that could be instantaneous and free.

## Decision Drivers

1. **User cost and latency** -- Without Tier 1, users pay for LLM calls on trivial edits that a local WASM transform handles deterministically in <1ms at $0.
2. **Broken routing contract** -- CLAUDE.md promises 3-tier routing, but only 2 tiers actually work for `@sparkleideas` users. The `[AGENT_BOOSTER_AVAILABLE]` check always returns false.
3. **Discoverability** -- Users should not need to know about a separate package scope to get the full capability of the CLI they installed.
4. **Scope consistency** -- All other packages in the ecosystem are under `@sparkleideas/*`. A package from a different scope creates confusion and version mismatch risk.

## SPARC Framework

### Specification

**Problem**: Tier 1 routing is non-functional for `@sparkleideas` users. All code edits go through LLM API calls (Tier 2 or Tier 3), even trivial transforms that are deterministic and could run locally. The CLAUDE.md shipped to every user project references `[AGENT_BOOSTER_AVAILABLE]`, but the package required to satisfy that check is not available within the `@sparkleideas` scope.

**Trigger**: The CLAUDE.md that ships with `npx @sparkleideas/cli init` already documents and depends on agent-booster for Tier 1 routing. The [unpublished-sources.md](../unpublished-sources.md) audit identified this gap and recommended "Integrate Now".

**Success Criteria**:

1. Users can install agent-booster within the `@sparkleideas` scope: `npm install @sparkleideas/agent-booster`
2. The CLI's `[AGENT_BOOSTER_AVAILABLE]` check discovers the package automatically -- no user configuration required
3. Simple code transforms (var-to-const, add types, rename variables) execute locally via WASM in <1ms at $0 cost
4. Two CLI binaries are available after install: `agent-booster` (standalone editor) and `agent-booster-server` (Morph LLM-compatible API server)
5. Compatible with Claude Desktop, Cursor, and VS Code via MCP Tools
6. No existing `@sparkleideas/*` package breaks

### Pseudocode

The following describes what happens from a user's perspective when an agent encounters a code edit task:

```
WHEN agent receives a code edit task:

  1. Check: Is @sparkleideas/agent-booster installed?
     |
     +-- YES: Emit [AGENT_BOOSTER_AVAILABLE]
     |   |
     |   +-- Classify the edit complexity
     |       |
     |       +-- Simple transform (var->const, add type annotation, rename)?
     |       |   -> Route to Tier 1: Agent Booster (WASM)
     |       |   -> Execute locally, <1ms, $0 cost
     |       |   -> Return deterministic result with confidence score
     |       |
     |       +-- Low complexity (<30%)?
     |       |   -> Route to Tier 2: Haiku (~500ms, $0.0002)
     |       |
     |       +-- High complexity (>30%)?
     |           -> Route to Tier 3: Sonnet/Opus (2-5s, $0.003-0.015)
     |
     +-- NO: [AGENT_BOOSTER_AVAILABLE] check returns false
         |
         +-- ALL edits go to Tier 2 or Tier 3 (current behavior)
         +-- User pays for every edit, even trivial ones
```

**User-facing before/after**:

```
BEFORE (agent-booster not in @sparkleideas scope):
  User runs: npx @sparkleideas/cli init
  CLAUDE.md says: "Check for [AGENT_BOOSTER_AVAILABLE]"
  Reality: Check always fails. All edits -> LLM. User pays ~$0.0002-$0.015 per edit.

AFTER (agent-booster published as @sparkleideas/agent-booster):
  User runs: npm install @sparkleideas/agent-booster
  -- OR it ships as optionalDependency of @sparkleideas/cli --
  CLAUDE.md says: "Check for [AGENT_BOOSTER_AVAILABLE]"
  Reality: Check succeeds. Simple edits -> WASM. $0, <1ms. Complex edits -> LLM as before.
```

### Architecture

Agent Booster sits at the bottom of the 3-Tier Model Routing system. From the user's perspective, it is the fast path that intercepts simple edits before they reach any LLM.

**3-Tier Model Routing (user-facing view)**:

```
  User's agent encounters a code edit
              |
              v
  +---------------------------+
  | Tier 1: Agent Booster     |  <1ms  |  $0  |  Simple transforms
  | (WASM, 100% local)        |        |      |  var->const, add types,
  | @sparkleideas/agent-booster|       |      |  rename variables
  +---------------------------+
              |
              | (edit too complex for Tier 1)
              v
  +---------------------------+
  | Tier 2: Haiku             |  ~500ms  |  $0.0002  |  Low complexity
  +---------------------------+
              |
              | (requires deep reasoning)
              v
  +---------------------------+
  | Tier 3: Sonnet/Opus       |  2-5s  |  $0.003-$0.015  |  Complex tasks
  +---------------------------+
```

**What ships to users**:

| Component | Description |
|-----------|-------------|
| `@sparkleideas/agent-booster` | npm package, installable via `npm install` |
| `agent-booster` binary | Standalone CLI for AST-aware code transforms |
| `agent-booster-server` binary | Morph LLM protocol-compatible API server |
| Pre-built WASM + JS | No compilation or build step at install time |
| MCP Tools integration | Works with Claude Desktop, Cursor, VS Code |

**Package characteristics**:

| Property | Value |
|----------|-------|
| Upstream package | `agent-booster` v0.2.2 |
| Repackaged as | `@sparkleideas/agent-booster` |
| Internal `@sparkleideas/*` dependencies | None |
| External dependencies | None (self-contained WASM) |
| Build step required at install | No -- ships pre-built `dist/` |
| Node.js requirement | >= 16 (WASM support) |
| Publish topology level | Level 1 (no internal deps) |

**How the CLI discovers it**: When `[AGENT_BOOSTER_AVAILABLE]` is checked, the agent resolves `@sparkleideas/agent-booster` via standard Node.js module resolution. If the package is in `node_modules` (project-level or global), Tier 1 routing activates. No configuration file or environment variable is needed.

### Refinement

**Capability summary for users**:

| Capability | What it means for users |
|-----------|-------------------------|
| Sub-millisecond transforms | Instant feedback on simple edits -- no waiting for API roundtrips |
| $0 cost | No API calls, no tokens consumed, no billing for Tier 1 edits |
| 100% deterministic | Same input always produces same output -- no LLM hallucination risk |
| Confidence scoring | Each transform reports its confidence; low-confidence edits fall through to Tier 2/3 |
| Morph LLM API server | `agent-booster-server` binary provides a local API compatible with Morph protocol |
| MCP Tools | Integrates with Claude Desktop, Cursor, VS Code without additional setup |
| Offline operation | Fully local, works without network connectivity |

**Performance numbers (from upstream benchmarks)**:

| Metric | Agent Booster (Tier 1) | Morph LLM | LLM API (Tier 2/3) |
|--------|----------------------|-----------|---------------------|
| Latency | <1ms | ~52ms | 500ms - 5s |
| Cost per edit | $0 | Varies | $0.0002 - $0.015 |
| Speed vs LLM API | 350x faster | 7x faster | Baseline |
| Speed vs Morph LLM | 52x faster | Baseline | -- |

**Risk assessment (user-facing)**:

| Risk | Impact on users | Mitigation |
|------|----------------|------------|
| WASM binary adds ~5MB to install | Slightly larger `npm install` | Package is optional; users who don't need Tier 1 don't install it |
| Platform compatibility | None expected | WASM runs in any Node.js >= 16 without native compilation |
| Agent Booster cannot handle a complex edit | No impact | Confidence scoring detects this; edit falls through to Tier 2/3 automatically |
| User does not install the package | Same as today | The `[AGENT_BOOSTER_AVAILABLE]` check gracefully degrades to Tier 2/3 |

### Completion

**Decision**: Integrate Now (Option A)

## Considered Options

### Option A: Integrate Now (chosen)

Publish `@sparkleideas/agent-booster` so users can install it and activate Tier 1 routing.

- Users run `npm install @sparkleideas/agent-booster` or it arrives as an optionalDependency of the CLI
- The `[AGENT_BOOSTER_AVAILABLE]` check starts returning true
- Simple code transforms bypass LLM calls entirely
- Two binaries become available: `agent-booster` and `agent-booster-server`

**Pros**: Completes the 3-tier routing contract that CLAUDE.md already promises. Zero internal dependencies means lowest integration risk. Ships pre-built (no build step). Saves users money and time on every simple edit.

**Cons**: Increases total package count by one. WASM binary adds ~5MB to the install footprint for users who install it.

### Option B: Defer Until Upstream Adds Formal Dependency

Wait for `@claude-flow/cli` upstream to formally declare `agent-booster` as a dependency.

**Pros**: Conservative. No work required.

**Cons**: Users continue to see Tier 1 routing instructions in CLAUDE.md that cannot be activated. Every simple edit costs money and takes hundreds of milliseconds instead of being free and instant. The gap between documented behavior and actual behavior persists indefinitely.

### Option C: Document Manual Installation from Different Scope

Tell users to `npm install agent-booster` (unscoped upstream package) in the CLI documentation.

**Pros**: No publishing work. Package already exists on npm.

**Cons**: Breaks scope consistency. Users must discover and trust a package from a different scope. Version mismatches between unscoped `agent-booster` and `@sparkleideas/cli` are possible. The discoverability problem remains -- users must read documentation carefully to learn about a package that should just work.

## Decision Outcome

**Chosen option: Option A -- Integrate Now**

### Rationale

1. **The contract already exists.** Every user who runs `npx @sparkleideas/cli init` gets a CLAUDE.md that tells their agents to check for `[AGENT_BOOSTER_AVAILABLE]`. Publishing the package under `@sparkleideas` is not adding new functionality -- it is fulfilling an existing, documented promise.

2. **Direct user cost savings.** For a user whose agents make 100 simple edits per session, the difference is $0 vs $0.02-$1.50 per session, and <100ms vs 50-500 seconds of cumulative latency. These are not theoretical gains; they are the documented purpose of Tier 1 routing in ADR-026.

3. **Graceful degradation.** If a user chooses not to install `@sparkleideas/agent-booster`, nothing breaks. The `[AGENT_BOOSTER_AVAILABLE]` check returns false, and all edits route to Tier 2/3 as they do today. This is purely additive.

4. **Lowest risk integration.** Zero internal dependencies, ships pre-built WASM+JS, no build step, no new repository to clone. The integration pattern is identical to the existing Level 1 packages (`agentdb`, `agentic-flow`, `ruv-swarm`).

### Consequences

**Good (user-facing)**:

- Users get $0, sub-millisecond code transforms for simple edits (var-to-const, add types, rename variables)
- The 3-Tier Model Routing system documented in CLAUDE.md works end-to-end for the first time
- `agent-booster-server` binary provides a Morph LLM-compatible local API server
- MCP Tools integration works with Claude Desktop, Cursor, and VS Code
- Fully offline operation -- no network dependency for Tier 1 edits
- 100% deterministic results eliminate LLM hallucination risk on simple transforms

**Bad (user-facing)**:

- Users who install the package add ~5MB (WASM binary) to their `node_modules`
- One additional package to track for version updates

**Neutral**:

- Users who do not install `@sparkleideas/agent-booster` see no change in behavior -- Tier 2/3 routing continues to work as before
- The upstream `agent-booster` (unscoped) package remains available on npm independently
- Binary names (`agent-booster`, `agent-booster-server`) are the same regardless of npm scope

### Required Documentation Updates

When this ADR is implemented, the following documents must be updated:

| Document | Change |
|----------|--------|
| `docs/unpublished-sources.md` | Move `agent-booster` from unpublished to published; update recommendation from "Integrate" to "Done" |
| `docs/ruvnet.packages.and.source.location.md` | Add `@sparkleideas/agent-booster` to Matrix 2 (published packages) with source path, version, and binary info |
| `README.md` | Update package count; mention Tier 1 routing availability |
| `CLAUDE.md` | Update Tier 1 row in 3-Tier Model Routing table to reference `@sparkleideas/agent-booster` |

### Required Tests

| Layer | Test | What it validates |
|-------|------|-------------------|
| **Unit** | `tests/06-publish-order.test.mjs` | `@sparkleideas/agent-booster` appears in Level 1 of the LEVELS array |
| **Integration** | `scripts/test-integration.sh` Phase 8 | Package publishes to Verdaccio, `npm install` resolves, WASM binary present in `node_modules` |
| **Acceptance** | `scripts/test-acceptance.sh` | New test: `test_a13_agent_booster()` — verify `import('@sparkleideas/agent-booster')` resolves, WASM module initializes, a simple code transform (e.g., `var x = 1` → `const x = 1`) returns correct output |
| **Acceptance** | `scripts/test-acceptance.sh` | New test: `test_a14_agent_booster_bin()` — verify `npx @sparkleideas/agent-booster --version` runs and returns a version string |

---

## References

- ADR-026: 3-Tier Model Routing (referenced in CLAUDE.md shipped to all user projects)
- CLAUDE.md: `[AGENT_BOOSTER_AVAILABLE]` and `[TASK_MODEL_RECOMMENDATION]` directives
- [Unpublished Sources Audit](../unpublished-sources.md): "Integrate Now" recommendation
- [ADR-0014: Topological Publish Order](0014-topological-publish-order.md): Level 1 placement
- [ADR-0021: Teammate Plugin Integration](0021-teammate-plugin-integration.md): Comparison (deferred due to build step requirement)
- Upstream source: `github.com/ruvnet/agentic-flow/packages/agent-booster/`
