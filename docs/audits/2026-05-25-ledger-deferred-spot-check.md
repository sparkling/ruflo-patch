# 2026-05-25 — INTEGRATION-LEDGER "deferred" spot-check (5-row sample)

Sample selection criterion: maximize epoch + family + batch coverage.

Caveat on the sample-able space: most pre-Batch-S "deferred" entries in
`docs/upstream/INTEGRATION-LEDGER.md` have already been promoted/closed
in earlier audits. Truly-pending rows outside the 19 just added by GHIB
(rows 171–184, Batch S re-disposed per ADR-0252) are now scarce. The
remaining "defer-flavored" rows live as:

- inline `defer per DP-X` annotations on `skip-mechanical` style rows
- `(... still pending)` cross-references on otherwise-disposed rows
- `Option B + defer` framings on `fork-local` decisions
- `reverted` rows with an "Option N follow-up" path
- prose notes ("will land here when executed") in section headers

This audit samples one row from each of those defer-flavors plus the
classic agentic-flow / ruvector pair-of-two cross-reference.

| # | Sampled row (ledger line) | Upstream SHA | Upstream subject confirmed | Fork status | Classification |
|---|---|---|---|---|---|
| 1 | Line 134 — F-11-003 fork-local "Option B + defer" (ADR-0213; ruflo) | `_fork-local_` (no upstream SHA — `5015b016f` + `a8e74b5` fork-local pair) | n/a (fork-local arch-test pinning the negative — "no agentdb MCP registration" — verified at `forks/ruflo/v3/@claude-flow/cli/__tests__/arch/`) | Arch-test alive (`5015b016f` subject "test(init): ADR-0213 pin-the-negative — no agentdb MCP registration" confirmed in fork log). Standalone agentdb MCP server still absent from init emission (no `mcp__agentdb__pattern_*` refs in fork `.claude/`). | **still-deferred** — defer rationale (standalone agentdb-MCP is busy_timeout-broken, SQLite-first, namespace-doubled) unchanged. Row text accurate. |
| 2 | Line 230 — `c2af4dc` agentic-flow retargeted to agentdb (Batch I; ADR-0186) | `c2af4dc05dfd4ecaabc3149f61836d1f00391f11` | confirmed: "fix(agentdb): add delete API to GraphDatabaseAdapter + ReflexionMemory.deleteEpisode (#150) (#151)" — `rUv@2026-05-06` | `forks/agentdb` `8b3388b22` (init: agentdb package source + marketing UI, same-day 2026-05-06) contains `deleteNode/deleteEdge/deleteHyperedge` on `src/backends/graph/GraphDatabaseAdapter.ts` and `deleteEpisode` on `src/controllers/ReflexionMemory.ts` — verified by `git show 8b3388b22 -- <path>` content match | **still-deferred (already amended)** — row already amended 2026-05-18 with "confirmed ... all present in forks/agentdb at canonical paths via the ADR-0161 extraction commit". Row 230's disposition (retargeted) and confirmation note both current. |
| 3 | Line 241 — `1493bab01` ruvector hand-ported, cross-ref "(agentdb side still pending)" (Batch I; ADR-0186) | `1493bab017f9f9c3f202e60d8a7aa1b77700d3d3` | confirmed: "feat(graph-node): add deleteNode/deleteEdge/deleteHyperedge API — closes #427" — `ruvnet@2026-05-06` | `forks/ruvector` `ee8bca912` "feat(graph-node): delete API (deleteNode/Edge/Hyperedge) — manual merge from 1493bab01 (ADR-0162 Batch I, paired with agentic-flow c2af4dc)" confirmed in fork log. AND the cross-referenced "agentdb side" content is present in `forks/agentdb` per row 2 above. | **silently-landed (cross-ref note stale)** — row 241's hand-ported disposition is correct, but the trailing parenthetical "(agentdb side still pending)" is stale. Row 230 has already been amended to confirm agentdb-side absorption, but row 241's note text was not updated. See "Silently-landed promotions" below. |
| 4 | Line 315 — Batch N rustfmt 2-SHA roll-up (skip-mechanical "defer per DP-4"; ruvector; ADR-0228) | `1d43f2c3` ("style: rustfmt embedder.rs (#487)" — 2026-05-22) + `b26001ad` ("style: cargo fmt --all on touched HNSW pruning block" — pre-supply-chain). 2-SHA count matches the row's "(2 SHAs)" header. | confirmed: both subjects match upstream `ruvnet/RuVector@origin/main` after `git fetch` (local mirror tip was `9054c2cc 2026-05-12`, pre-Batch-N). | `forks/ruvector` log from 2026-05-22..05-23 shows NO `style:` / `rustfmt` / `cargo fmt` commits. Neither rustfmt SHA was hand-picked. | **still-deferred** — DP-4 rationale (style-only churn, skip-mechanical) holds. Row 315 current. |
| 5 | Line 117 — `5228ffc44` reverted ADR-0188 Option 1 attempt (ruflo) | `5228ffc445bf4b13e3d4429fbd7fba388e461f7d` — **NB this is a FORK SHA, not upstream**. The ledger row places it in the "Upstream SHA" column anyway because the table schema has no column for fork-original commits. | The commit IS fork-original (Henrik Pettersen@2026-05-18 23:26 BST per `git show`). Not in `ruvnet/ruflo` history. | Revert `634747deb` "Revert security: convert session-state writes to writeFileRestricted (0600) — ADR-0188 Option 1" present in fork log. Companion doc note `5be65f3bf` "docs(fs-secure): record ADR-0188 Option 2 boundary — session JSON stays 0644" also present. | **stale-other (schema mismatch, not a defer-content issue)** — disposition `reverted` is accurate; both follow-up commits exist as cited. The audit flag is that the "Upstream SHA" column carries a fork SHA. Optional schema repair, not a defer-promotion case. |

## Summary

- still-deferred: 3 (rows 134, 230, 315)
- silently-landed: 1 (row 241 cross-ref note + agentdb section header at line 332)
- superseded-upstream: 0
- stale-other: 1 (row 117 — fork SHA in Upstream-SHA column; schema convention not content)

## Silently-landed promotions (proposed text only — do NOT amend in this commit)

**Row 241 trailing note + line 332 agentdb section header**

Both reference `c2af4dc` as "agentdb side still pending" or as "the
`c2af4dc` pending hand-port above ... will land here when executed",
but the same content (`deleteNode/deleteEdge/deleteHyperedge/deleteEpisode`)
is already present in `forks/agentdb@8b3388b22` (2026-05-06,
ADR-0161 extraction init commit). Row 230 itself is already amended
("confirmed 2026-05-18 ... all present in forks/agentdb at canonical
paths via the ADR-0161 extraction commit (same day as upstream)").

Proposed row 241 note text replacement:

```
manual merge; pair-of-two with agentic-flow `c2af4dc` (agentdb side
absorbed via `forks/agentdb@8b3388b22` ADR-0161 extraction init; see
row 230 amendment confirmed 2026-05-18).
```

Proposed agentdb-section prose replacement (line 332-333):

```
No upstream-fork delta tracked here yet; the `c2af4dc` row above (in
agentic-flow section) was retargeted into the `8b3388b22` ADR-0161
extraction init (same-day 2026-05-06) and is recorded as `retargeted`.
```

Both edits are **note-text only** — no disposition change, no SHA
promotion. The underlying disposition (`retargeted` on row 230,
`hand-ported` on row 241) remains correct; only the cross-reference
prose drifts.

## Stale-other (schema)

**Row 117 column convention**

The "Upstream SHA" column on row 117 carries `5228ffc44` which is a
fork-original commit (Henrik Pettersen@2026-05-18, ADR-0188 Option 1
attempt). The "Local SHA" column then carries the revert
(`634747deb`) and the Option-2 doc note (`5be65f3bf`). This is a
schema mismatch but content-correct — the `reverted` disposition
accurately captures that the fork tried Option 1, reverted it, and
adopted Option 2. Optional fix: move `5228ffc44` to the Local SHA
column and mark "Upstream SHA" as `—` (consistent with other
fork-local rows that use `_fork-local_` in column 1, e.g. rows
116/132/134).

## Method notes

- Upstream subjects verified via `git log --oneline -1 <SHA>` on
  `/Users/henrik/source/ruvnet/<repo>/` mirrors. Where local mirror
  was stale (RuVector tip at `9054c2cc` 2026-05-12), `git fetch
  origin main` was run before the lookup to access Batch-N era
  commits. Per project-memory `feedback-upstream-means-upstream.md`,
  no comparison against `forks/` was used as authoritative for
  upstream content.
- Fork status verified via `git log --grep` on
  `/Users/henrik/source/forks/<repo>/` and direct file inspection
  (`grep -rn "deleteNode" forks/agentdb/src/`) for content
  absorption checks.
- No fork was modified; no remote was pushed. Read-only audit per
  task constraints.
