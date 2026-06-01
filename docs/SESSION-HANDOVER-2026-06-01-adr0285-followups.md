# Session Handover — 2026-06-01 — ADR-0285 shipped + outstanding follow-ups

## TL;DR

**ADR-0285 is SHIPPED GREEN.** The ADR-index causal/recall MCP surfaces were repaired
and `agentdb index --purge` made idempotent. 6 defects fixed across 2 forks, reviewed
(SHIP-WITH-NITS), acceptance **734/743, 0 failed**, published **agentdb@patch.412 /
cli@patch.400 / ruflo@patch.374**, all forks + ruflo-patch `main` pushed.

**Outstanding** (the "fix everything" scope, NOT yet done — this handover is the spec):
- **A. `causal-query` cold-process 2s timeout** on large stores (real, low-risk fix).
- **B. native better-sqlite3 doesn't load in the running daemon → sql.js fallback** (the
  reason the P4/P6 bugs manifested live; nuanced — partly stale-cache, partly a latent
  `^11`/`^12` version split).
- **C. two reviewer nits** (trivial doc/comment).
- **D. session daemon still serves the OLD build** — restart Claude Code for live
  `mcp__ruflo__*` tools on patch.400/412 (not a code fix).

---

## What shipped (context — already done, do NOT redo)

ADR: `docs/adr/ADR-0285-repair-adr-index-causal-recall-surfaces-and-complete-purge.md`
(`accepted`, with a full `## Amendment — implemented + shipped` section).

| Defect | Fix | File | Fork commit |
|---|---|---|---|
| P6 + P4 (sql.js NAMED-param bind → "Internal error") | `bindSqlJsParams()` | `agentdb/src/db-fallback.ts` | `e455a2f` |
| P4 (undefined bind, fail-loud) | `assertNumericId()` guards | `agentdb/src/controllers/CausalMemoryGraph.ts` | `1fa64ee` |
| P1/P2/P8 (purge missed SQLite tables) | `purgeAdrCausalTables()` + `reconcileAdrCausalEdges()` | `ruflo …/memory/memory-router.ts` + `commands/agentdb.ts` | `a53373ebe` |
| P5/P7 (`/`-keys + id-normalize + unmask) | drop `validateIdentifier`, `normalizeAdrId()`, harden `sanitizeError()` | `ruflo …/mcp-tools/agentdb-tools.ts` | `a97d09b02` + reword |

Verified: agentdb fork unit/regression **34/34**; the `adr0285-causal-crud-and-purge`
acceptance gate is green and wired (`test-acceptance.sh` `run_check_bg` + `collect_parallel`,
`test-acceptance-fast.sh`, `.github/workflows/v3-ci-agentdb-surface.yml`); a live
`agentdb index --purge` reconcile on the real **291-ADR / 910-edge** corpus produced
**910 total == 910 distinct** (vs the pre-fix 1745/890 duplication).

Key diagnostic insight (also saved to auto-memory `project-mcp-daemon-runs-sqljs-fallback`):
**the live daemon runs the sql.js WASM fallback**, so sql.js-path bugs show live via
`mcp__ruflo__*` but NOT in a fresh better-sqlite3 install / acceptance smoke. P3 (savepoint
desync) needed no separate patch — it was a downstream symptom of the sql.js bind throw,
confirmed closed by the green smoke (A1a).

---

## OUTSTANDING A — `causal-query` cold 2s timeout on large stores

**Symptom (live, patch.400 `cli mcp exec` vs the real `.swarm`):**
`agentdb_causal-query {cause:'adr/ADR-0274'}` → `{success:false, error:"causal_query timeout (2s)"}`.

**Root cause (traced, not hypothesised):**
- The P7 `normalizeAdrId` fix now resolves `adr/ADR-0274` → real node `1073742028` (before,
  it minted a phantom node → 0 results → returned instantly, never exercising this path).
- The query handler wraps `routeCausalOp('query')` in a `Promise.race` with a **2s guard**:
  `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/agentdb-tools.ts:1325-1331`.
- The SQLite controller query is FAST (`idx_causal_edges_from`, ~5ms, verified via
  `EXPLAIN QUERY PLAN`). The slow tail is the **always-run RVF `causal-edges`
  namespace-list dual-read** at `forks/ruflo/.../memory/memory-router.ts:~2838-2860`
  (made unconditional by ADR-0147 R6 so the controller can't hide namespace-only edges).
  On a **cold process** loading the 72MB `memory.rvf` for the first time, that read
  exceeds 2s. A **warm daemon** (RVF preloaded) is expected fast — this is cold-start
  latency, not a hot-path bug.

**Fix options (pick one; recommend 1, consider 2):**
1. **Raise/adapt the guard.** 2s is a hang-detector, not a latency SLA; a cold 72MB RVF
   load legitimately needs several seconds. Bump to ~10–15s (mirror the value other cold
   reads use, or make it env-configurable). Lowest risk, no parity change. Same 2s guard
   exists on `causal-recall` (`memory-router.ts:2940`) and `learning-predict`
   (`agentdb-tools.ts:2003`) — fix consistently.
2. **Make the namespace dual-read lazy** when the controller already returned results.
   Post-ADR-0285 the index writes ADR edges to BOTH SQLite `causal_edges` AND the RVF
   `causal-edges` namespace, so for ADR causal edges the SQLite controller is now complete
   and the namespace merge is redundant. BUT ADR-0147 R6 made it unconditional deliberately
   (parity for "edges only the namespace knows about" — e.g. learned non-batch edges); do
   NOT regress that without confirming the parity case is dead. Higher risk.
3. The `keyPrefix` push-down (`listOp.keyPrefix = \`${op.cause}→\``) already makes the
   *query* O(matches); it does not help the one-time RVF *load*. Not sufficient alone.

**Gate:** add a large-corpus causal-query assertion (the existing `adr0285` smoke uses a
tiny synthetic corpus, which is why it never hit this). Either seed a larger corpus in the
smoke, or assert a warm-daemon causal-query returns the expected edge count within budget.

---

## OUTSTANDING B — native better-sqlite3 doesn't load in the daemon (→ sql.js)

**Why it matters:** this is the ROOT reason the P4/P6 sql.js-binding bugs manifested live.
The ADR-0285 fix made the sql.js fallback *correct*, but the daemon ideally runs native
better-sqlite3 (faster, and the bug class can't recur).

**Mechanism (traced):** `forks/agentdb/src/core/AgentDB.ts:180-192` tries
`(await import('better-sqlite3')).default` + `new Database(dbPath)`; on **any** throw it
`console.log('[AgentDB] better-sqlite3 not available, using sql.js WASM')` and falls back.

**Findings (NOT a simple "missing binary"):**
- The patch.400 install tree has TWO better-sqlite3, BOTH with native `.node` built:
  - hoisted `node_modules/better-sqlite3` = **12.10.0** (`build/Release/better_sqlite3.node` ✓)
  - agentdb-nested `…/@sparkleideas/agentdb/node_modules/better-sqlite3` = **11.10.0** (✓)
- Version split is declared: **agentdb `package.json` → `^11.10.0`**, **cli `package.json`
  → `^12.9.0`**. agentdb's runtime `import('better-sqlite3')` resolves its nested `^11`.
- A FRESH `cli mcp exec` (daemon's Node 22.21.1) loads native better-sqlite3 fine
  (recall-fixer confirmed). So the **running daemon's** sql.js fallback is most likely a
  **stale-npx-cache ABI mismatch at its boot** (the `_npx/906e6debb112be6d` cache's
  better-sqlite3 prebuilt binary didn't match the Node it started under), NOT a persistent
  resolution bug.

**Fix (two parts):**
1. **Immediate / no-code:** restart the daemon (kill `ruflo mcp start`; next spawn
   re-resolves `@latest` into a fresh npx cache and rebuilds better-sqlite3 for the current
   Node). Expectation: the new daemon uses native better-sqlite3. **Confirm** with a live
   probe — a query that, on sql.js pre-ADR-0285, would have thrown the now-fixed bind error;
   or add an MCP/CLI introspection of `usingWasm` (`AgentDB.ts` sets `this.usingWasm`).
2. **Durable:** collapse the `^11`/`^12` split — align `agentdb` and the cli to ONE
   better-sqlite3 major (prefer `^12` to match the cli/hoisted copy, or pin both via an
   `overrides`), so only one native copy is installed and the wrong-ABI-resolves risk is
   gone. Verify native loads in a fresh Verdaccio install under the runtime Node, and that
   the agentdb unit suite stays 34/34. RISK: better-sqlite3 native ABI is Node-major
   specific — confirm prebuilds exist for the target Node, else a source build is needed at
   install (acceptable for this stack, already happens).

**Note:** even with native better-sqlite3, the sql.js fallback path must stay correct
(ADR-0285) — some environments legitimately have no native build. Do NOT remove the
fallback; just make native the default that actually loads.

---

## OUTSTANDING C — reviewer nits (trivial, non-blocking)

From the ADR-0285 reviewer (SHIP-WITH-NITS), both documented as residuals in the ADR:
1. The bare (non-`--purge`) re-index path catches the "node-id present but edge row absent"
   drop only via the `--purge`-gated shortfall check; invisible on a bare re-index. Add a
   1-line comment at the gate in `commands/agentdb.ts`, or extend the reconcile to the bare
   path. (Mitigated: the swallow still `console.error`s; the sql.js fix removes the throw
   that variant needed.)
2. `detectNamedSigil` (`agentdb/src/db-fallback.ts`) applies the first placeholder's sigil
   to all re-keyed keys → a statement mixing `@a`+`:b` would mis-key. Not present in the
   corpus; the single-convention assumption is documented in the helper. Leave as-is or add
   an assertion.

---

## State / mechanics (for whoever resumes)

- **Everything committed + pushed.** Forks (agentdb, ruflo) → `sparkling`, unpushed=0.
  ruflo-patch `main` → `sparkling/ruflo-patch` (`0ace4b1`, was 76 commits behind — the
  pipeline pushes forks but NOT ruflo-patch's own origin; that's a manual `git push origin
  main` step, now done).
- **Build/release:** `npm run release -- --force` (canonical; builds all forks → publishes
  Verdaccio → full acceptance incl. `adr0285`). ~18 min. Use `--force` (selective-skip can
  leave dist empty). The release does NOT push ruflo-patch origin — push manually after.
- **Fast iteration:** `bash scripts/test-acceptance-fast.sh adr0285` (or `adr0059` etc.) for
  a single group without a full release.
- **Reconcile cli:** a patch.400 install is at `/tmp/adr-test-cli-v400` (`node_modules/.bin/cli`);
  `agentdb index --purge --dir docs/adr` against this `.swarm` is idempotent (910/910).
- **Gotcha:** the ADR-0084 forbidden-substring gate greps the published CLI dist for
  `sql.js` (excluding import/`from` lines) — do NOT put the literal `sql.js` in a comment
  that compiles into `dist/src/mcp-tools/agentdb-tools.js` (burned one release cycle; use
  "WASM SQLite fallback").
- **Flaky:** `e2e-0059-no-collisions` (intelligence.cjs consolidate on a hand-written
  `RVF\0` seed) is load-sensitive on a shared `ranked-context.json` — a single fail under
  parallel-load is a flake, not a regression (green on re-run).

## Suggested order when resuming "fix everything"

1. **B.1** restart-and-confirm native better-sqlite3 (cheapest, biggest-class win) →
   decide if **B.2** (version align) is needed.
2. **A** raise the cold-read timeout guard(s) + large-corpus gate.
3. **C** the two nit comments.
4. One `npm run release -- --force` → confirm green → push forks + ruflo-patch origin.
