---
status: accepted
date: 2026-05-31
tags: [agentdb, mcp-tools, adr-index, retrieval, honest-surface, fix]
supersedes: []
depends-on: [ADR-0176]
implements: []
---

# agentdb_hierarchical-query: honor the caller's `limit` (don't clamp enumeration to MAX_TOP_K)

## Context and Problem Statement

`agentdb_hierarchical-query` is a path/glob ENUMERATION tool (ADR-0176 Phase 3):
given a path like `adr/*` it returns every matching record. Its input schema
advertises `limit` as *"Optional max results (default: unlimited)"*. But the
handler resolved the limit with `validatePositiveInt(params.limit, undefined,
MAX_TOP_K)` where `MAX_TOP_K = 100` — the similarity **top-K** guard shared by the
genuine top-K tools (`pattern-search`, `reflexion-retrieve`, `skill-search`,
`causal-recall`, …). `validatePositiveInt` does `Math.min(n, max)`, so any
explicit `limit > 100` was **silently clamped to 100**: `limit: 500` → 100,
`limit: 100000` → 100. The no-limit path (`undefined` → no SQL `LIMIT`) correctly
returned all rows, so the defect bit only callers who passed an explicit limit —
and did so *silently*, the dishonest-surface pattern the ADR-0210/ADR-0244 family
targets (the tool advertises "unlimited" but caps at 100).

Surfaced during the ADR-0281 index remediation: against a 287-record `adr/*`
corpus, `limit: 500` returned exactly 100 while a no-limit query returned all 287
(verified against the sqlite oracle). An earlier mis-diagnosis (a "byte-size
truncation" returning ~60) was a transient flaky read, disproven by tracing the
display path (`printJson` → `JSON.stringify`, no cap) and the MCP response path
(no cap); the only real, reproducible cap was the silent `limit` clamp.

## Decision Drivers

* **Make the advertised contract true.** The schema says "default: unlimited"; an
  explicit `limit` must be honored, not silently capped at a top-K constant.
* **Don't distort the genuine top-K tools.** `MAX_TOP_K = 100` is the correct
  guard for similarity search; the fix must not change it for those handlers.
* **Keep a safety ceiling.** A path-enumeration tool should still guard against a
  pathological caller limit, just at a generous bound rather than 100.

## Considered Options

* **A — pass `params.limit` through unclamped** (positive-int validated only).
  REJECTED: loses the pathological-input guard the validator provides.
* **B — raise the shared `MAX_TOP_K` constant.** REJECTED: would loosen the cap
  on the ~8 similarity tools that legitimately want a 100 top-K.
* **C — a separate enumeration ceiling (chosen):** add `MAX_QUERY_LIMIT = 100_000`
  and use it only for `agentdb_hierarchical-query`; leave `MAX_TOP_K` for the
  similarity tools.

## Decision Outcome

Chosen option: **"C — a separate enumeration ceiling"**, because it makes the
advertised "unlimited" contract true for the enumeration tool (honoring explicit
limits up to a generous 100K guard), leaves the no-limit "all rows" path
unchanged, and does not weaken the top-K cap on the similarity tools. One-line,
scoped change at the single handler.

### Rules (implementation)

* **R1 — `MAX_QUERY_LIMIT = 100_000`** added beside `MAX_TOP_K` in
  `mcp-tools/agentdb-tools.ts`, documented as the enumeration-tool ceiling.
* **R2 — `agentdb_hierarchical-query` uses it.** The handler's limit resolves via
  `validatePositiveInt(params.limit, undefined, MAX_QUERY_LIMIT)`. No-limit ⇒ no
  SQL `LIMIT` ⇒ all rows (unchanged); explicit `limit` honored up to 100K.
* **R3 — `MAX_TOP_K` unchanged** for the similarity handlers (`pattern-search`,
  `reflexion-retrieve`, `skill-search`, `causal-recall`, etc.).

### Consequences

* Good: an explicit `limit` on `hierarchical-query` is now honored — `limit: 500`
  over a 101-record set returns 101, not 100; the surface matches its schema.
* Good: similarity tools keep their 100 top-K guard (no blast radius).
* Neutral: a caller asking for `limit > 100_000` is still clamped (to 100K) — a
  generous safety bound, effectively unlimited for the ADR/skill corpora.

### Confirmation

* **Fork unit coverage:** the no-truncation display contract is pinned by
  `__tests__/mcp-exec-no-output-truncation.test.ts`.
* **Acceptance smoke (e2e):** `adr0282-agentdb-surface-fixes` G1 — store 101
  records, `hierarchical-query` with `limit: 200` → **101** (pre-fix: 100). Wired
  into the standard runner, the fast runner, and a dedicated CI workflow.

## More Information

- Found during the ADR-0281 index remediation (hierarchical keyed upsert +
  delete-by-key), alongside two sibling agentdb-CLI-surface fixes amended into
  their own ADRs: ADR-0273 (`--dry-run` was not dry) and ADR-0276
  (`causal-edge-delete` KV residual). The three share the `adr0282-agentdb-surface-fixes`
  acceptance smoke.
- **Depends on ADR-0176** — the same `agentdb_hierarchical-query` key-glob
  enumeration tool whose `limit` this honors.
- Fix location: `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/agentdb-tools.ts`
  (the `MAX_QUERY_LIMIT` constant + the `agentdb_hierarchical-query` handler).
