# Session Handover — 2026-05-21

## TL;DR

Started from "test the swarm-team memory-backed dialectic"; it kept failing, which
unwound a chain of real root-cause fixes (all shipped + acceptance-green). **One bug
remains open and is the current blocker for the dialectic: semantic `memory_search`
returns empty on an accumulated store.**

- **Works now (verified via the live MCP):** `memory_store` (incl. first store, ~68ms, no hang), `memory_retrieve` (exact key, cross-actor). A swarm coordinating by *known keys* is functional.
- **Broken (open):** `memory_search` (semantic/HNSW) returns `total: 0` for *every* query — including 13 legacy entries that exist with embeddings. Distinct bug, uncaught by acceptance.

## Current published state (Verdaccio `http://localhost:4873`)

| Package | Version | Notes |
|---|---|---|
| `@sparkleideas/agentdb` | `3.0.0-alpha.14-patch.261` | `getEmbeddingConfig`/`readEwcLambdaFromConfig`/`QUICConnectionPool` subpath; `busy_timeout` pragma restored |
| `@sparkleideas/cli` | `3.7.0-alpha.10-patch.249` | `@latest`; has the lost-reply `writeFrame` fix |
| `@sparkleideas/ruflo` (wrapper) | `3.1.0-alpha.14-patch.225` | `@latest`, **pins cli patch.249** (regression repaired) |
| `@sparkleideas/agentic-flow` | `2.0.2-alpha-patch.797` | import migration + 314 service tests + bugfixes |

Last full release: **test-ci 4083 pass / 0 fail**, **acceptance 684/693 pass / 0 fail / 9 documented skip_accepted**.

## OPEN BUG (the blocker) — semantic search returns empty

`memory_search` returns `{ total: 0 }` for all queries against the **ruflo-patch project store**:
- Empty even for `namespace: reasoningbank` (13 entries) and `namespace: all`, at `threshold: 0`, in ~4ms (empty-index signature).
- Data is **intact**: `memory_retrieve` returns `found: true`; `memory_stats` reports 38 entries / 100% embedding coverage.
- **Backend split** observed in tool output: `memory_store` → `backend: "archivist (RVF + HNSW)"`; `memory_search` → `backend: "HNSW + SQLite"`.
- A **fresh** store searched fine on the *same* cli patch.249 (the `/tmp/dialectic` ALPHA probe returned `total: 1`) → the failure is specific to the **accumulated** store: its HNSW index isn't hydrating from the stored embeddings on the warm MCP server.
- **Acceptance can't catch it** — the ADR-0090 B5 checks verify persistence with `sqlite3` row-counts, not `memory_search`.

**Repro:** warm MCP (`ruflo@latest` = patch.225) in `ruflo-patch`, call `memory_search` with any query + `threshold: 0` → `total: 0`, while `memory_retrieve` of a known key returns `found: true`.

**Where to look:** the agentdb HNSW index build/hydration path (RVF + HNSW). Question to answer: why does an existing/accumulated store load **0 vectors** into the HNSW index queried by `memory_search`, while a fresh store indexes correctly? Check the archivist (RVF) write path vs. the SQLite+HNSW read path — they may not be unified for search (ADR-0180/0181 archivist territory).

## What was fixed this session (all shipped)

1. **MCP lost-reply** (ADR-0226): first `memory_store` lost its JSON-RPC reply; `console.log` frame write was swallowed by a monkey-patch → switched to raw `process.stdout.write` (`writeFrame`). *(ruflo-patch `bd821a0`; in cli patch.246+)*
2. **gnn/attention native bindings** (ADR-0150): added to `NAPI_PACKAGES`, narrowed `.npmignore`; both load. *(`bd821a0`)*
3. **314 fresh tests** for 5 agentic-flow services (consensus, rl-training, streaming, gnn-router, RuvLLMOrchestrator) + **3 real bug fixes** (RuvLLMOrchestrator agent-name regex + task-type routing order; gnn-router stub/interface shapes + 0/0 NaN guard; rl-training `epochs || 100` → `?? 100`). *(agentic-flow `6b0d6c7`)*
4. **ADR-0161 import migration**: 30 `agentic-flow/src` files `packages/agentdb/...` → bare `agentdb`; added agentdb exports (`readEwcLambdaFromConfig`, `./controllers/QUICConnectionPool`). *(agentdb `c004113`, agentic-flow `6b0d6c7`)*
5. **Resolved 6 ADR-0177 substrate-revert skips** (`730f48a`, agentdb `e3b3369`): `adr-0093` rewritten to a frontier-schema parity invariant; `sqlite-pragma-adr0069` un-skipped after **restoring config-driven pragmas incl. `busy_timeout`** in `AgentDB.initializeDatabase()` (a real `SQLITE_BUSY` regression); `adr0090-b5` vestigial pglite dead-code stripped + Debt-15 sqlite3-availability guard added. Unit skips 6 → 0.
6. **fork-push reconcile** (`29f13ac`): `push_fork_version_bumps` retries after fetch+merge on the recurring ruvector divergence.
7. **Wrapper `@latest` regression** (`4c41205`) — *the MCP-delivery bug*: `bumpWrapperPin` bumped the wrapper version with `bumpPatchVersion` (local+1) instead of registry-aware `safeNextVersion`, so a stale local `package.json` republished a *lower* version (patch.214) over patch.224 with `--tag latest`, regressing `@latest` to a wrapper pinning a **pre-fix cli (patch.243)**. Fixed to use `safeNextVersion`; republished `ruflo@patch.225` (pins cli patch.249) as `@latest`.

## Durable gotchas (also saved to memory)

- **ADR-0170 is superseded by ADR-0177** — SQLite restored as the `agentdb_*` substrate; `better-sqlite3` is live, pglite is not a dep. The "Phase D" / "pglite is the substrate" comments scattered in tests/helpers are **stale traps** — do NOT execute ADR-0170 Phase D (it would delete the live substrate). *(memory: `project-adr0170-superseded-phase-d-trap`)*
- **Acceptance green ≠ MCP fixed.** The MCP runs `npx @sparkleideas/ruflo@latest` (the **wrapper**); acceptance runs `@sparkleideas/cli@latest` (via `_cli_cmd`). A fix in cli is green in acceptance but only reaches the MCP if the wrapper's `@latest` pins that cli. *(memory: `project-ruflo-wrapper-latest-regression`)*
- **npx cache staleness:** `npx @latest` reuses `~/.npm/_npx/<hash>/` within its staleness window, so `/mcp reconnect` can keep respawning stale code. Clear `~/.npm/_npx/*/@sparkleideas`, then **pre-warm** (`npx -y @sparkleideas/ruflo@latest --version`) before reconnecting — a cold install exceeds the MCP client's 30s startup timeout.

## Residual hardening (not done — optional follow-ups)

- `bumpWrapperPin` only fires on a cli **change**; the wrapper can still lag if cli is unchanged for several releases.
- `scripts/check-wrapper-cli-lockstep.mjs` checks the cli **pin** but not version **monotonicity** (wouldn't have caught the 214-over-224 regression).
- Phase-6 promote (`publish-verdaccio.sh`) uses `npm view <pkg> version` (= current `@latest`), so it can't **advance** a stuck tag.
- Fresh agentic-flow integration tests for the 5 services whose suites were removed (separate from the 314 unit tests added).

## Commit index

- **ruflo-patch:** `4c41205` (wrapper version fix), `730f48a` (6 skips + pglite cleanup), `9dc1d46` (adr0069 cross-fork import), `29f13ac` (fork-push reconcile), `bd821a0` (lost-reply + gnn/attention + reconcile + ADR status).
- **forks/agentdb:** `e3b3369` (busy_timeout pragmas), `c004113` (exports) → published patch.261.
- **forks/agentic-flow:** `6b0d6c7` (import migration + 314 tests + bugfixes) → published patch.797.
