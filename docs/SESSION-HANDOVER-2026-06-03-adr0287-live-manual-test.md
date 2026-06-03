# Session Handover — 2026-06-03 — ADR-0287 live manual-test of memory & learning

## TL;DR

A manual test of the live ruflo stack (memory, learning, neural, routing, daemon, MCP) became a
multi-pass investigation, now consolidated in **`docs/adr/ADR-0287-live-manual-test-remediation.md`**
(status: `proposed`). **The memory core is healthy; the findings are honesty/wiring gaps around it —
and several dramatic-sounding first-pass conclusions turned out to be wrong.** No fork/product code was
changed this session (the ADR is a decision record); two local-state cleanups were done. The single most
important corrected conclusion: **learning is frozen because it is *dormant by design* — nothing
auto-captures it — not because of any bug we can "fix."**

## What was produced

- **ADR-0287** — clean, consolidated (323→~345 lines after the trace update). Per-finding: validated root
  cause + current status + disposition + provenance/merge-risk; a prioritised backlog table; a compact
  changelog of the 6 investigation passes (manual test → upstream cross-check → dead-code audit → F9/F10/F11
  → 5-agent validation → daemon/MCP restart + live re-eval → trajectory-capture trace).
- **`docs/research/2026-06-02-live-system-findings-research-plan.md`** — the research plan (marked complete).
- Memory updated: `reference-ruvnet-upstream-repos` (RVF is upstream now, not fork) and
  `project-mcp-daemon-runs-sqljs-fallback` (root cause = node-version split).

## Corrected understanding — do NOT re-derive the wrong conclusions

A future session should start from these (each was a first-pass error that cost real effort to unwind):

1. **Memory works.** Live `memory_store`→`memory_search` paraphrase test = **0.59 cosine**, real mpnet-768 via
   `archivist (RVF + HNSW)`; 1,226 entries; 41 controllers live. The stores are not broken.
2. **F10 (frozen learning) is DORMANT BY DESIGN — not F1/F3a-gated, not starved-by-a-bug.** Episodes /
   sona_trajectories / SONA `lastAdaptation` have three *separate* writers, all reachable **only** via explicit
   MCP tools / CLI subcommands; **none sits on any hook path.** Nothing in normal Claude Code operation captures
   learning. Live proof: driving a trajectory + `reflexion-store` moved `episodes` 0→1 *only* from the explicit
   reflexion-store; sona/lastAdaptation didn't move. → The fix is a **capture-wiring design decision**, not a bug fix.
3. **F3a (the "Router not available" line every turn) is cosmetic — it gates nothing.** The router it fixes is a
   pure regex recommender that captures no learning. Worth fixing for honesty, but it is **not** a keystone.
4. **The node-22 / sql.js processes were *other projects* (opda, hm)**, not ruflo-patch. ruflo-patch's own daemon
   (PID 49267) + MCP server are node-24 / native better-sqlite3. The "daemon runs sql.js" finding was a
   cross-project misattribution.
5. **The daemon "Not running" and the write-visibility "lag" did not hold up** (ruflo-patch simply had no daemon
   of its own at the time; the lag didn't reproduce — RVF writes are synchronous-durable).
6. **`agentdb` is a *required* dependency by design** (ADR-0091 removed the sql.js fallback → it's the sole
   substrate → must be present). Do **not** "revert it to optional" — it wouldn't shrink the install anyway
   (npm installs optionalDependencies by default) and would reintroduce a banned silent-degradation.

## Open decisions (these need a human call before implementation)

1. **Ratify ADR-0287?** `proposed → accepted`. (Process.)
2. **[BIGGEST] F10 capture-wiring — its own ADR.** *Should* the learning substrate auto-capture during normal
   operation? If yes: what seam (e.g. emit `agentdb_reflexion-store` / `intelligence.recordTrajectory` from a
   PostTask/Stop hook), what gets captured, and what's the storage/perf cost? This is a genuine product/design
   decision — the learning layer has been inert since 2026-04-04 because no such seam exists.
3. **Cosmetic reporter tier (F8a, F8e, F8b, F4) — fix or leave?** They're mislabels on *inherited* files →
   permanent divergence + recurring merge-tax. F9p was withdrawn on exactly this logic; apply the same per-item
   test rather than auto-fix.
4. **F8d — fix or document?** Republishing ruvllm + wiring a global to flip a cosmetic "Unavailable" is poor
   cost/benefit; lean document-don't-fix.
5. **F3a — fix the `.cjs` rename or accept the noise?** Now known to gate nothing; moderate merge-risk (collides
   with upstream's in-flight `.mjs→.cjs`). Honesty hygiene vs merge-tax.
6. **Implementation go-ahead + order.** Per the no-execute rule, no fork patch proceeds without an explicit yes.
   Clear-value first targets: **F5** (delete dead Phase-2 block, zero risk) and **F2** (add `resources/list`
   handler, converges with upstream).

## Validated backlog (priority order, all gated on go-ahead)

| Tier | Item | Action |
|---|---|---|
| 1 (do first) | **F5** | delete dead Phase-2 controller-activation block + call site |
| 1 | **F2** | add `{resources:[]}` handler to **both** `cli.js` + `mcp-server.js` + ledger row + arch-guard |
| 2 (cosmetic — decide per #3) | F8a / F8e / F8b / F3b / F4 | reporter mislabels (0-dim, spinner, doctor JSON-canonical, route-cold label, daemon PID path) |
| 3 (storage) | **T1** | **DELETE** the dead drain-bridge (ADR-0083 = router single-write-path); retire `agentdb-memory.rvf`. **R2** standalone hardening (not a T1 precondition). |
| 4 | F8d | document-don't-fix (per #4) |
| band-aid (decided) | **F1** | `MCP_TIMEOUT=60000` in Claude Code's launch env — only |
| own ADR (decision #2) | **F10** | capture-wiring design decision |
| keep / none | T2, T3, T4, F6, F7, F8c, F9p, F11-RVF | documented; no code change |

Every inherited-surface fix (F2, R2, F4, F8b, F8e) gets a row in `docs/upstream/INTEGRATION-LEDGER.md` + an
arch-guard. We integrate by hand cherry-pick (`-x`), never `--theirs`.

## Operational state

- **Daemon:** PID 49267, node 24.14.1, native better-sqlite3, `daemon.pid` written; `doctor` → "Running".
- **MCP server (this project):** node 24, connected; `mcp__ruflo__*` tools available. (The node-22 MCP servers
  on this machine are opda/hm — **do not touch them.**)
- **`[INFO] Router not available`** still prints every prompt (F3a, cosmetic — unfixed, harmless).
- **Dev bin is stale (patch.213)** — use the npx-cache bin (`~/.npm/_npx/.../bin/ruflo`, patch.408) or
  `npx @latest` for any live check, never `node_modules/.bin/ruflo`.
- **Cleanups done (local, on-disk only):** deleted `.claude/memory.db` (vestigial 384-dim) + gitignored it;
  removed stale `.swarm/*` artifacts (backups, corruption snapshot, orphaned temps, empty orphan agentdb.sqlite,
  legacy memory.graph). Live stores untouched.

## Git state

All work committed to `main` (ruflo-patch). Working tree is clean except for **runtime state** under
`.swarm/`, `.claude-flow/`, `.claude/memory.db-*` (all gitignored — not for version control). No fork repos
were modified (`forks/ruflo`, `forks/agentdb` clean — all investigation was trace-only).

Latest commits: ADR-0287 rewrite + trajectory-capture-trace correction + critique incorporation; the cleanup
commits; the memory-untracking commits.
