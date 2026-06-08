---
status: proposed
date: 2026-06-08
tags: [adr-tooling, performance, indexing, cli, memory]
supersedes: []
depends-on: [ADR-0273, ADR-0088]
implements: []
---

# Migrate the adr-index skill from import.mjs (spawn-per-record) to the in-process agentdb index builder

## Context and Problem Statement

The `ruflo-adr:adr-index` skill builds the ADR index by running
`plugins/ruflo-adr/scripts/import.mjs`, which persists every record and edge
via `spawnSync('npx', ['@sparkleideas/cli@latest', 'memory', 'store', …])` —
**one CLI subprocess per item** (~309 records + ~531 edges ≈ 840 calls on the
ruflo-patch corpus). A 2026-06-08 run was killed after minutes; a swarm
investigation (fork-ADRs + upstream + live-cli-surfaces) established:

* **Measured cost:** ~0.5 s per `npx @sparkleideas/cli@latest` call, of which
  **~0.4 s is pure `@latest` registry-resolution + npm cache-lock contention**
  (buys nothing); ~0.09 s is per-process CLI cold-boot. ×840 ≈ 7 min, ~5.6 min
  of it the avoidable npx tax. This is the documented `reference-cli-cmd-helper`
  / ADR-0088 anti-pattern (36× measured there: 277-317 s → 7.7 s by resolving
  the binary once).
* **A purpose-built replacement already exists and is shipped:** ADR-0273's
  `agentdb index` CLI builds all three index surfaces (hierarchical `adr/<id>`,
  typed causal edges + derived inverses, `adr-patterns` with embeddings) in
  **one in-process pass**, cold-starting the registry/archivist once (~12-18 s)
  instead of paying a subprocess per item. Source+dist inspection confirms it
  parses `supersedes`/`depends-on`/`implements` from frontmatter and writes
  them as TYPED causal edges via `recordCausalEdge` (+inverses) — not the
  opaque blobs import.mjs writes (`adr-edges` keyed `${relation}:${from}->${to}:${ts}`).
* **The gap:** ADR-0273 shipped the builder but the `adr-index` skill (and the
  ruflo-adr plugin) still drive `import.mjs`. The migration was never completed.
* **Upstream** uses the identical per-item spawn (import.mjs is a near-verbatim
  descendant) and never re-architected the ADR path — but upstream's broader
  architecture prefers in-process bulk writes (ADR-006 `bulkInsert`) and MCP
  tools (ADR-076). Going in-process for the ADR path is consistent with
  upstream's own stated direction, not a divergence.

**Anti-bias discipline (this ADR explicitly resists the reflexive
"it's broken" conclusion, per the ADR-0293 lesson — 125/125 fork premises
demonstrated, the one broken-claim retracted):** two load-bearing facts are
NOT yet demonstrated and must be proven before acting, not assumed:
1. That import.mjs's opaque-blob `adr-edges` are actually *deficient* — whether
   `adr-verify`'s consumers need traversable typed edges or are fine with the
   blobs is UNVERIFIED (characterized by an agent from the keying, not proven).
2. That `agentdb index` works end-to-end — it is source+dist-verified to parse
   `implements`, but nobody RAN it to completion this session. "It's the working
   replacement" is a strong inference, not a demonstration.

## Decision Drivers

* The slowness is *measured*, not assumed; and the avoidable share (~80%) is
  pure npx-resolution tax.
* A shipped, in-process, typed-edge builder (ADR-0273) already exists — the fix
  is largely *migration*, not new construction.
* Honesty about the edge artifact: if downstream needs typed edges, import.mjs's
  blobs are a correctness gap, not just a perf one — but that must be confirmed.
* `feedback-trace-bin-entry-before-patching` / ADR-0293: verify the replacement
  by RUNNING it before trusting it; verify the legacy tool is actually deficient
  before retiring it.

## Considered Options

* **A — Migrate the skill to `agentdb index` (chosen, test-driven).** Repoint
  `ruflo-adr:adr-index` (and the plugin's adr-index) at the in-process builder;
  decide import.mjs's disposition (retire vs keep as fallback). Verify the
  builder end-to-end FIRST.
* **B — Fix import.mjs to resolve the CLI once (`_cli_cmd` pattern).** Removes
  the npx tax (the 36× win) with a minimal change, but keeps ×840 cold-boots
  AND the opaque-blob edge model — patching the legacy path ADR-0273 meant to
  replace. A partial fix.
* **C — Defer.** The `implements` parser fix already shipped (import.mjs,
  patch.432); live-graph edges are a nicety. Rejected as a standing answer: it
  leaves a 36×-slow tool as the skill's impl.

## Decision Outcome

Chosen: **A, test-driven** — migrate to `agentdb index`, but only after
demonstrating the two unproven facts above. This ADR authorises no code beyond
the verification probe; the migration itself is gated on an explicit go-ahead.

### Tasks

* **T1 — Run `agentdb index` end-to-end (prove the replacement).** Scope to the
  real corpus (`ADR_ROOT`/`--dir docs/adr`, NOT the worktree-polluted cwd scan
  — the `.claude/worktrees` over-reach seen with import.mjs); `--dry-run` then
  real; node-24. Confirm: completes fast (one cold-start, not ×840), writes the
  `implements`/`depends-on`/`supersedes` typed edges, and the edges are
  graph-traversable (query them back via `agentdb_graph-query`/`causal-query`).
* **T2 — Confirm the artifact question.** Determine whether `adr-verify` (and
  any other `adr-edges`/`adr-patterns` consumer) needs typed edges or tolerates
  import.mjs's blobs. This decides whether the migration is a correctness fix or
  only a perf fix.
* **T3 — Repoint the skill + plugin.** Update `ruflo-adr:adr-index` (project
  skill + the fork `plugins/ruflo-adr` skill/SKILL.md) to invoke `agentdb index`
  instead of `import.mjs`'s spawn loop.
* **T4 — Decide import.mjs disposition.** Retire it, or keep as a documented
  fallback. Note: import.mjs carries a 2026-06-08 `implements`-parse fix
  (shipped patch.432, ruflo-adr 0.2.39) — that fix is on the LEGACY builder; if
  import.mjs is retired the fix is moot-but-harmless, if kept it stays valid.
* **T5 — Acceptance + both-ways.** Wire/confirm the ADR-0273 acceptance check
  covers the skill's new path; both-ways verify.

### Consequences

* Good, because the ADR index builds in one in-process pass (no ~5.6 min npx
  tax) and — pending T2 — produces traversable typed edges instead of blobs.
* Good, because it completes ADR-0273's intent (the builder shipped; the skill
  never migrated) and aligns the ADR path with upstream's in-process direction.
* Bad, because `agentdb index` carries a ~12-18 s cold-start and RVF read/write
  lock considerations (ADR-0267 hazard, resolved by ADR-0274) that import.mjs's
  per-call model sidesteps; T1 must confirm no lock regression.
* Neutral, because the patch.432 import.mjs `implements`-fix may become moot if
  import.mjs is retired (T4) — harmless either way.
* Neutral, because this is a builder/skill migration; it does not change the ADR
  corpus or frontmatter.

### Confirmation

T1's end-to-end run (typed `implements` edges materialized + traversable, fast)
+ the T5 acceptance check green in a release. Until `agentdb index` is
demonstrated end-to-end AND the skill is repointed, this ADR stays `proposed`.

## More Information

* [[ADR-0273]] — the `agentdb index` in-process builder this migrates TO
  (shipped 2026-05-30; the gap is that the skill was never repointed).
* [[ADR-0088]] + `reference-cli-cmd-helper` — the `npx @latest`-per-call /
  npm-cache-lock anti-pattern (36× measured) and the resolve-once fix.
* Upstream context (origin/main @ d065b1592): import.mjs is a near-verbatim
  descendant of upstream's; upstream's in-process direction is ADR-006
  (`bulkInsert`) / ADR-076 (MCP), never closed for the ADR path.
* Method precedents: `feedback-trace-bin-entry-before-patching`,
  `feedback-old-adr-status-lines-go-stale`, ADR-0293 (verify, don't assume
  broken). The 2026-06-08 import.mjs `implements`-fix shipped at patch.432.
