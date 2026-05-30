---
status: accepted
date: 2026-04-15
tags: [sqljs, storage, memory, fallback]
supersedes: [ADR-0075]
depends-on: []
implements: []
---

# sql.js Memory Fallback Removed

## Context and Problem Statement

ADR-0075's "Upstream Creator Corrections (2026-04-06)" section records this
claim:

> **sql.js fallback is intentional** — serves real edge environments (Vercel,
> Cloudflare Workers, Docker minimal) where native better-sqlite3 is
> unavailable.

The ADR-0090 audit (Tier A3, 2026-04-15) pulled fork source and found this
claim no longer matches code. The 4-agent swarm auditor for the sql.js
fallback path (`a2d8fc222c54ff8ec`) verified:

- `@claude-flow/memory/src/database-provider.ts:21` defines
  `DatabaseProvider = 'better-sqlite3' | 'rvf' | 'auto'` — no `'sqljs'` case
- `createDatabase` switch at `database-provider.ts:192` has no sql.js branch
- `sqlite-backend.ts:12` hard-imports `better-sqlite3` with no try/catch —
  module load fails loudly if the native binding is unavailable
- `SqlJsBackend` class is not exported from `@sparkleideas/memory/index.js`

At the same time, ruflo-patch acceptance checks **actively assert sql.js
absence** from the memory path:

- `check_adr0080_no_raw_sqljs` (`lib/acceptance-adr0080-checks.sh:1029`) —
  fails if any `import('sql.js')` appears in published CLI `.js`
- `check_adr0065_no_sqljs_backend` (`lib/acceptance-adr0065-checks.sh:144`) —
  fails if `SqlJsBackend` is re-exported
- `check_no_sqljs_in_tool_descriptions` (`lib/acceptance-adr0084-checks.sh:82`) —
  fails on any `"sql.js"` string in user-facing output

So the architecture already diverged from ADR-0075's claim, and ruflo-patch
enforces the divergence in CI. Neither the change nor the enforcement layer
was ever recorded in an ADR. A future engineer reading ADR-0075 and trusting
its creator correction would be silently misled.

sql.js is still a package dependency of `@claude-flow/memory`,
`@claude-flow/shared`, and `@claude-flow/embeddings`, but only non-memory
consumers use it:

- `event-store.ts:20` — event sourcing (top-level static import)
- `persistent-cache.ts:81,404` — embedding cache
- `rvf-migration.ts:128` — migration read path only

None of these is the edge-environment memory fallback ADR-0075 described.

## Considered Options

### A3-RESTORE: restore `SqlJsBackend` and wire it into `DatabaseProvider`

Re-add `@claude-flow/memory/src/sqljs-backend.ts`, add a `'sqljs'` branch to
the `createDatabase` switch, export the class from
`@sparkleideas/memory/index.js`, and add a `check_sqljs_roundtrip_fallback`
acceptance check that shadows `better-sqlite3` via `NODE_PATH` and verifies
a store/retrieve round-trip under sql.js.

**Rejected** because:

1. The architecture already diverged months ago and no user has filed an
   edge-environment issue, so the demand signal is absent.
2. `better-sqlite3` now has wide platform wheel coverage (darwin-arm64,
   darwin-x64, linux-x64, linux-arm64, win32-x64); the historical
   "unavailable on exotic platforms" concern has largely evaporated.
3. Maintaining two memory backends doubles the runtime test matrix for
   every memory-path change forever. ADR-0082 already flagged
   silent-fallback paths as the primary source of masked failures.
4. `event-store.ts`, `persistent-cache.ts`, and `rvf-migration.ts` still
   import sql.js for non-memory purposes. The "pure JS must work for some
   codepath" invariant is covered by those consumers; we do not need a
   second pure-JS path on the memory side to satisfy it.

### Silent fix: just rewrite ADR-0075

Edit ADR-0075's creator correction in place and move on without a new ADR.

**Rejected** because the audit findings and the three sql.js enforcement
checks are a non-obvious architectural decision that a future engineer
needs to be able to find. Silent edits to a closed ADR leave no persistent
record of why the enforcement checks exist. ADR-0091 captures the reasoning
so the next audit can cite it directly.

### A3-DELETE (chosen): accept the removal and document it

Record that the edge-environment memory fallback no longer exists in code, mark ADR-0075's creator correction as stale, and codify the three enforcement checks as the permanent guardrail.

## Decision Outcome

Chosen option: "A3-DELETE — accept that the sql.js edge-environment memory fallback is gone and document it", because the architecture already diverged months ago with no edge-environment issue filed, `better-sqlite3` now has wide platform wheel coverage, and maintaining two memory backends would double the runtime test matrix forever (the exact silent-fallback risk ADR-0082 flags).

1. The edge-environment memory fallback from ADR-0075's creator correction
   **no longer exists in code**, and we explicitly accept that state.
2. `@sparkleideas/cli` does **not** support edge environments (Vercel,
   Cloudflare Workers, Docker minimal) without a working native
   `better-sqlite3` binding. We do not ship a pure-JS memory path.
3. ADR-0075's creator correction on this point is marked stale via an
   in-place update note that points here. The original text stays — we do
   not rewrite history.
4. sql.js remains a transitive dependency only for the three non-memory
   consumers listed above. This ADR documents that scope so the next audit
   does not re-rediscover it.
5. The three acceptance checks listed under **Enforcement** below are the
   persistent guardrail: if `SqlJsBackend` is re-exported, if `sql.js` is
   imported from the published memory path, or if a user-facing tool
   description mentions sql.js, the acceptance suite fails loudly.

### Consequences

**Positive:**

* Good, because ADR-0075 no longer lies about the memory backend matrix. A future audit reads ADR-0091 and the sql.js question is answered.
* Good, because a single memory codepath (`better-sqlite3` native + `rvf`) is simpler to reason about, test, and debug than a three-way matrix.
* Good, because the enforcement layer is named and tracked in one place, so accidental reintroduction of `SqlJsBackend` trips CI instead of shipping.
* Good, because it matches the ADR-0086 Debt 7 direction: remove SQLite fallbacks from the memory path entirely, not add more.

**Negative:**

* Bad, because we lose the edge-environment story. A user on Cloudflare Workers, Vercel edge runtime, or a minimal Docker image without `better-sqlite3` wheel coverage cannot run `@sparkleideas/cli`'s memory features. No one has filed this as an issue in the months since the backend was removed, but the capability gap is real.
* Bad, because if upstream revives an edge fallback later, we have to re-evaluate the three enforcement checks and decide whether to unblock or keep guarding. Revisit trigger: an upstream commit that adds a `'sqljs'` branch back to `createDatabase` in `database-provider.ts`.

### Confirmation

The decision is testable, not just declarative, via the three permanent enforcement acceptance checks (`check_adr0080_no_raw_sqljs`, `check_adr0065_no_sqljs_backend`, `check_no_sqljs_in_tool_descriptions`) detailed in the Enforcement section below. Removing or weakening any of these without replacing them is the ADR-0091 revisit trigger.

## Enforcement

These three acceptance checks are the permanent guardrail and the reason
this ADR's decision is testable, not just declarative:

| Check | File:Line | Fails when |
|---|---|---|
| `check_adr0080_no_raw_sqljs` | `lib/acceptance-adr0080-checks.sh:1029` | Any `import('sql.js')` appears in a published CLI `.js` file |
| `check_adr0065_no_sqljs_backend` | `lib/acceptance-adr0065-checks.sh:144` | `SqlJsBackend` is re-exported from `@sparkleideas/memory` |
| `check_no_sqljs_in_tool_descriptions` | `lib/acceptance-adr0084-checks.sh:82` | The literal string `"sql.js"` appears in any user-facing MCP tool description |

Removing or weakening any of these without replacing them is the
ADR-0091 revisit trigger.

## More Information

Original status: "Implemented (as of 2026-04-15)", with a recorded Date of 2026-04-15. Scope: `@claude-flow/memory` database provider; ruflo-patch enforcement checks. This ADR partially supersedes ADR-0075's "Upstream Creator Corrections" — specifically the sql.js edge-fallback claim — and is related to ADR-0082 (Test Integrity — No Fallbacks), ADR-0086 (Layer 1 Storage), and ADR-0090 (Acceptance Suite Coverage Audit Tier A3).

References:
- ADR-0090 §"sql.js fallback — 0 of 9 behaviors covered; architecture divergence" and §"Tier A3. Reconcile sql.js with upstream" — the audit that surfaced this ADR
- ADR-0075 §"Upstream Creator Corrections (2026-04-06)" — the stale claim this ADR supersedes in part
- ADR-0082 — "Test Integrity — No Fallbacks"; the no-silent-fallback principle this ADR honors
- ADR-0086 §"Debt 7" — `better-sqlite3` removed from CLI `package.json`; this ADR extends that direction to sql.js
- `@claude-flow/memory/src/database-provider.ts:21,192` — the provider type and `createDatabase` switch that verify the absence
- `@claude-flow/memory/src/sqlite-backend.ts:12` — the hard `better-sqlite3` import with no try/catch
- 4-agent ruflo swarm, 2026-04-15, sql.js fallback auditor task `a2d8fc222c54ff8ec`
