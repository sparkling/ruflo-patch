---
status: accepted
date: 2026-06-10
tags: [mcp, observability, memory, honesty, infrastructure, upstream-sync, fix]
supersedes: []
depends-on: [ADR-0210, ADR-0287]
implements: []
---

# `system_health` storage honesty — probe the real store, not the legacy `store.json`

## Context and Problem Statement

The MCP `system_health` tool's `memory` check
(`cli/src/mcp-tools/system-tools.ts` ~:301) probed a single legacy path
`.claude-flow/memory/store.json` and reported `memory: degraded — Memory store
not found — run memory init` when absent. The fork's memory engine **never
writes there**: the canonical store is `.swarm/memory.db` (sql.js, via
`memory-router._getMemoryRoot()`) plus `.claude-flow/memory.rvf` /
`.swarm/*.rvf` (RVF). Result: on a fully-working system (`memory_store` /
`memory_search` operational) the tool reports the memory subsystem `degraded`
and depresses the overall score.

Live-reproduced on this ruflo-patch project (2026-06-10): `.swarm/memory.db`
1.0 MB written that day, `store.json` absent → `system_health` reports memory
`degraded` while memory ops work. This is the ADR-0210/ADR-0287 reporter-
dishonesty pattern: an advertised health surface lying about a healthy core. It
was NOT in ADR-0287's original F1–F10 set (a genuinely new item; the fork's
`fix/adr0287-reporter-cosmetics` branch never touched this check).

**Upstream already fixed the identical defect** as issue **#1843** (commit
`1884ed101`), replacing the single-path probe with
`memoryCandidates.some(existsSync)` over a candidate set. The fork was behind on
this file.

A sibling `database`/coordination check (~:377) probes only
`.claude-flow/coordination/store.json` but returns `unknown` (not `degraded`)
on miss, so it is advisory-only — a lower-severity companion, not part of this
decision's required scope.

## Decision Drivers

- **Reporter honesty (ADR-0210):** a health surface that lies about a healthy
  core is the DELETE-the-lie / honest-report class.
- **Follow upstream:** #1843 is a real upstream fix to inherit, not a fork
  invention — hand-port surgically.
- **Surgical scope:** fix the memory-check hunk only; do NOT pull upstream's
  unrelated deep disk/network real-probes, the `unknown`-excluded scorer, or the
  description rewrites (those belong to a later Batch-style upstream sync).

## Considered Options

1. **Surgical candidate-set hand-port (chosen).** Replace the single-path probe
   with `some(existsSync)` over the fork's REAL store paths (superset of #1843's
   list PLUS the fork-default `.claude-flow/memory.rvf` and `.swarm/*.rvf`). Keep
   the fork helper `findProjectRoot()` (not upstream's `getProjectCwd`).
2. **Resolver-based probe.** Call the fork's own `getMemoryRoot()` /
   `getDatabasePath()` instead of a static list. More precise under custom
   `memory.persistPath`, but risks a module cycle (importing memory-router into
   system-tools) and is heavier than the #1843 parity. Recorded as a possible
   refinement, not chosen now.
3. **Wholesale port of upstream's `system_health` rewrite.** Rejected —
   scope-creep (drags in `statfsSync`/`dns` deep probes + scorer changes);
   belongs to a Batch upstream sync with its own ledger rows.

## Decision Outcome

**Chosen: Option 1.** `system-tools.ts` memory check now probes a candidate set
(`.claude-flow/memory/store.json` legacy, `.claude-flow/memory.rvf`,
`.swarm/memory.db`, `.swarm/memory.rvf`, `.swarm/agentdb-memory.rvf`, +3 #1843
paths) via `some(existsSync)`; no new imports. Implemented in `forks/ruflo`
`f26e858c2`. INTEGRATION-LEDGER row records the #1843 hand-port.

## Consequences

- **Good:** a healthy store reports `memory: healthy`; the false `degraded` no
  longer depresses the overall score.
- **Residual:** a user who relocates the store via `memory.persistPath` /
  `CLAUDE_FLOW_MEMORY_PATH` can still false-negative against a static list —
  Option 2 (resolver-based) is the maximally-honest follow-up if that surfaces.
- **Companion (out of scope):** the coordination check probing only
  `.claude-flow/coordination/store.json` returns `unknown` on miss (advisory,
  does not falsely degrade) — flagged, not fixed here.

## Confirmation (acceptance — wired into `test-acceptance*.sh` + a workflow)

- `lib/acceptance-adr-syshealth-checks.sh` (RED-until-published — validates the
  shipped artifact): **M1** — with a real store present (`memory store` →
  `.swarm/memory.db`), `system_health` reports `memory: healthy` and emits no
  "store not found"; **M2** — arch-guard the shipped artifact probes a candidate
  SET (≥3 paths incl. `.swarm/memory.db`), guarding against a future cherry-pick
  re-introducing the lone `store.json` probe. Per
  `feedback-always-wire-tests-into-cicd`: wire run_check_bg + collect_parallel +
  `.github/workflows/`.
