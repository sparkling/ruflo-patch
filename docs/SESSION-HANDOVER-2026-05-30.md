# Session Handover — 2026-05-30

## What this session did

Two arcs:

1. **ADR corpus → canonical MADR migration (ADR-0271).** All 280 `docs/adr/ADR-*.md` converted to the `/adr-create` template: YAML frontmatter (6 whitelisted keys), `# Title` (no `ADR-NNNN:` prefix), Context/Considered-Options/Decision-Outcome(Consequences+Confirmation) for decision ADRs; companions get frontmatter+H1+Context. Bare/3-digit filenames renamed to `ADR-NNNN[letter]-` (sub-lettered collisions, renumber-nothing). Content-preserving (≥95% word-retention fidelity gate; 0 losses). Committed.
2. **RVF memory concurrency + ADR-indexing tooling** — a connected chain of decisions (below), all recorded as ADRs, none yet implemented.

## ADRs created this session (5) — all `accepted`, committed, conformant, registered

| ADR | Title | Status |
|---|---|---|
| 0271 | Migrate ADR corpus to canonical MADR (rename + sub-letter) | accepted (corpus migrated; **Phase 3 index pending**) |
| 0272 | Typecheck hygiene for the agentdb fork (gate shipped `src/`) | accepted |
| 0273 | Scriptable `agentdb index` CLI surface | accepted (impl pending; depends 0274) |
| 0274 | Resolve RVF lock via read/write handle split | accepted (impl pending — **critical path**) |
| 0275 | Adopt upstream RVF progressive-indexing (HNSW Layer B) | accepted (impl pending; depends 0274) |

**Amended existing ADRs:** 0176 (recorded the `hierarchical-query` defect + the `metadata.key` glob fix), 0267 (re-opened — the idle-only fix was insufficient; resolution = 0274).

**Fork code committed but NOT released:** `forks/agentdb 2be4aba` — `HierarchicalMemory.query()` now globs `json_extract(metadata,'$.key')` (the ADR-0176 fix). The live MCP server still runs the old build → see WS0 in the plan.

## The decision chain (how the RVF ADRs connect)

```
0267 (RVF lock regression, re-opened) ──resolved by──> 0274 (read/write handle split)
0274 ──unblocks──> 0273 (index command) ──enables──> 0271 Phase 3 (corpus index)
0274 ──read handle──> 0275 (HNSW Layer B)
0176 (query key-glob fix) ── feeds ──> 0271 Phase 3
0272 (typecheck) — independent
```

Key findings, file:line-verified by analysis swarms:
- The MCP server holds the RVF `flock` for its **whole lifetime** after the first `tools/call` (ADR-0267's "fix" only covered the idle server). 0274 splits a persistent lock-free read handle from a transient per-transaction writer.
- RVF search is **brute-force O(N)** today — a **shared upstream+fork state** (`layer_b: false` in both), not a fork regression. Upstream designed the fix (RuVector ADR-033 progressive indexing) and built the HNSW engine (`ruvector-core`) but never wired Layer B into `rvf-runtime`. 0275 adopts it.
- The daemon-broker alternative is **out** (ADR-0207 removed the socket on upstream-alignment grounds) — not reconsidered.

## Current state

- **Working tree clean**; all ADRs + the execution plan committed.
- **Corpus migrated** (280 MADR files); **corpus AgentDB index NOT built** (that's ADR-0271 Phase 3 / plan WS3 — blocked on 0273 + the 0176 release).
- **Nothing from the 5 ADRs is implemented yet** — decisions only.

## Readiness gate (why this handover exists)

- **Open questions:** none. OOS1 (daemon broker) settled by ADR-0207; OOS3 (index command) folded into the execution plan.
- **Deferrals to review:** none requiring action now. The only deferral is RaBitQ/PQ quantization (RVF Layer C, upstream ADR-154) — an explicit *future-ADR* forward pointer in ADR-0275, not an open item. ADR-0274 D5 records reopen-per-transaction as a conditional fallback.
- **ADRs up to date:** yes — 5 created (all accepted), 2 amended, all committed + conformant (`adr-validate` PASS) + registered in `adr-patterns`.

## Next action

Execute **[docs/plans/2026-05-30-rvf-memory-and-adr-tooling-execution-plan.md](plans/2026-05-30-rvf-memory-and-adr-tooling-execution-plan.md)**. Start in parallel: WS0 (release the 0176 fix), WS5 (typecheck hygiene), WS1-P1 (cli dual handle). WS1 (ADR-0274) is the critical path; WS1-P3 (writer-lock lifecycle vs the witness chain) is the highest-risk item and carries a stress-test gate.

## Lessons carried (do not repeat)

- **Never build the corpus AgentDB index ad-hoc** (hand CLI loop or `import.mjs`). Use the ADR-0273 command, purge-then-rebuild. A 2026-05-30 hand attempt hit the ~780-round-trip wall and the MCP/CLI RVF snapshot split, and was reverted.
- **MCP and CLI memory see different RVF handles** (the ADR-0274 snapshot split) — `cli memory list` will not show MCP-written entries and vice-versa until the handle split lands. Verify the right view before claiming state.
- **"Out of scope" needs a real reason** — not "nobody uses it now" or "it'll take too long." This pulled cross-process freshness + the anti-reload writer into ADR-0274's scope.
- **Run `/adr-create` end-to-end** (all 7 steps incl. `memory_store` to `adr-patterns`) — hand-rolling drifted the registration for 0274/0275 (since fixed).
