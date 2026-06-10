---
status: accepted
date: 2026-06-09
tags: [federation, memory-sharing, agentic-flow, federation-hub, shipping-bug, websocket-sync]
supersedes: []
depends-on: [ADR-0309, ADR-0265]
implements: []
---

# Fix `FederationHubServer` — a working multi-tenant memory-sync hub that is DOA as shipped

## Context and Problem Statement

The 2026-06-09 shared-memory validation (4-agent, user-driven — the user disbelieved
Q4's "no shared store", rightly: the THIRD wrong-negative this session) found that
`@sparkleideas/agentic-flow` SHIPS a real multi-tenant memory-sync hub —
`agentic-flow/dist/federation/FederationHubServer.js` (~439 LOC): `http.createServer()`
+ `WebSocketServer` + `.listen()`, a tenant-isolated SQLite `episodes`/`change_log`/`agents`
schema, an `auth`/`push`/`pull`/`ack` protocol with vector clocks and per-tenant
broadcast, paired with a `FederationHubClient`.

**It works** — proven end-to-end across processes: started on `:8444` (`lsof` confirmed
the listener), a writer process (tenant `acme-corp`) pushed an episode, a SEPARATE
reader process pulled it back (`dataLen:1`, correct vector clock), and a reader in a
different tenant got `dataLen:0` (isolation holds).

**But it is DOA as shipped** — real, functional code blocked by shipping defects, NOT a stub:

1. **Init-order race.** `db/sql-adapter.js` calls `this.init()` async without `await`,
   so the hub's *synchronous* `db.exec(schema)` in the constructor throws
   `"Database not initialized"` (reproduced twice). The validation only obtained its
   cross-process proof by bypassing this one line (a synchronous sql.js adapter; hub
   logic verbatim).
2. **Null AgentDB reference.** `this.agentDB = null`, then `await this.agentDB.storePattern()`
   NPEs on `push` (the SQLite path survives only via a per-episode try/catch).
3. **Missing CLI entry.** `cli/federation-cli.js` spawns `federation/run-hub.js`, which
   is **absent from the published tarball** → "build the project first", `exit(1)`
   (`run-agent.js` likewise).
4. **Not exported.** The hub/client are not in the package `exports` map.

So a genuine cross-process shared store exists and functions, but no user can start it
via the shipped CLI.

## Decision Drivers

* This is the most complete shared-store implementation in the tree and it nearly
  works — fixing 1–4 turns "no turnkey shared store" into "a runnable multi-tenant
  memory-sync hub".
* `feedback-no-consumer-is-not-stub` / `feedback-capability-not-single-named-class`:
  real, working code with shipping defects is to be repaired, not deleted or dismissed
  (the original negative judged the wrong artifact and missed this hub entirely).
* Honesty: the README/USERGUIDE said "no working shared store" — true only *because of*
  these defects, a misleading reason to leave standing.

## Considered Options

* **Fix the four shipping defects + add an acceptance test (chosen).**
* **Leave it, doc-only** — rejected: a shipped, functional hub that crashes on construct
  and can't be launched is exactly the latent-capability defect the fork's posture repairs.
* **Delete it** — rejected: it works (proven); the defects are bounded.

## Decision Outcome

Chosen: repair the four defects so `FederationHubServer` starts from the shipped CLI and
serves cross-process push/pull. Status `proposed`; no execution until an explicit go-ahead.

### Tasks
* **T1** — Fix the `sql-adapter` init-order race (await init, or make the schema-exec path
  synchronous-safe) so the constructor no longer throws "Database not initialized".
* **T2** — Fix the `agentDB` null reference (lazy-init or null-guard the `storePattern` path).
* **T3** — Ship `run-hub.js` + `run-agent.js` in the published package `files` and add the
  hub/client to the `exports` map, so `agentic-flow federation start` works.
* **T4 — Acceptance:** from the shipped CLI, start the hub, push an episode from one
  process, pull it from a separate process (correct vector clock), and confirm cross-tenant
  isolation (`dataLen:0`).

### Consequences
* Good: a real, runnable multi-tenant memory-sync hub — a concrete cross-machine
  team-memory primitive — without writing it from scratch.
* Neutral: git-as-memory-bus remains the recommended default; this is opt-in.
* Bad (mitigated): a network-listening memory hub is security-sensitive — pair with the
  federation auth/PII/trust stack ([[ADR-0309]]) before any non-loopback use.

### Confirmation
T4 green: shipped-CLI start + cross-process push/pull round-trip + tenant isolation.

## More Information
* Siblings: [[ADR-0309]] (federation inbound dispatcher — the plugin-side serve path),
  [[ADR-0265]] (QUIC transport).
* Evidence (2026-06-09 validation): `agentic-flow/dist/federation/FederationHubServer.js`;
  live `:8444` listener + cross-process push/pull proof + the four defects, in
  `/tmp/ruflo-q4-validate/shared-store.md`.
* Method: [[ADR-0293]] + `feedback-capability-not-single-named-class` (the negative judged
  the wrong artifact; the real hub was in agentic-flow).
* User-facing README §4/§10 corrected 2026-06-09 to credit the hub (real, proven
  cross-process) while noting it doesn't run as shipped.

## Amendments

### Amendment (2026-06-10): all four defects re-confirmed live; Bug 3's mechanism is bigger than recorded — the ENTIRE published agentic-flow CLI is DOA

Adversarial re-verification against
`@sparkleideas/agentic-flow@2.0.2-alpha-patch.980` (npx cache ≡ Verdaccio
latest; tarball re-pulled and listed):

* **Bug 1 CONFIRMED live — and deterministic, not racy.**
  `new FederationHubServer({port:0})` from the shipped dist throws
  `Database not initialized` every time: the un-awaited `this.init()` at
  `db/sql-adapter.js:20` guarantees the constructor's synchronous
  `db.exec(schema)` (hub :28-29, throw :66-67) always loses. "Reproduced
  twice" understated it — it cannot win.
* **Bug 2 CONFIRMED live** — with init bypassed and the shipped `handlePush`
  verbatim: `Failed to insert episode {"error":"Cannot read properties of
  null (reading 'storePattern')"}`; SQLite survives via the per-episode catch
  (`episodes: 1, ack: true`). **Uncited bonus defect:** `stop()` (:415) does
  `await this.agentDB.close()` — an UNCAUGHT NPE on shutdown; fold into T2.
* **Bug 3 CONFIRMED, mechanism incomplete — the published CLI dies
  EARLIER.** The `files` allowlist also excludes the nested
  `agentic-flow/package.json`, so `cli-proxy.js:43`'s `readFileSync` ENOENTs
  and exits 1 before ANY command runs — **the entire published agentic-flow
  CLI is DOA from the package, not just federation** (`node …/cli-proxy.js
  federation start` → ENOENT). The quoted "build the project first" branch
  is reachable only from a repo checkout. Additionally, `run-hub.js` has no
  compiled source anywhere — the only source is
  `docker/federation-test/run-hub.ts` (imports `../../src`, compiled
  nowhere) — so the entry points must be AUTHORED/relocated, not merely
  shipped.
* **Bug 4 CONFIRMED** — the root `exports` map has 24 keys, zero
  federation/Hub entries, and no `./*` wildcard: encapsulation blocks even
  deep specifier imports (absolute-file-path import only).
* **"It works once init is bypassed" re-validated** in-process with shipped
  code (only `init` awaited): same-tenant pull `dataLen:1` with vector clock
  `{"writer":7}`; cross-tenant `dataLen:0`; broadcast received. (Prior
  cross-process `:8444`/lsof proof in
  `/tmp/ruflo-q4-validate/shared-store.md:81-104`.)

**T3 amended:** (a) add the nested `agentic-flow/package.json` to `files` —
without it nothing in T1/T2 is reachable from the published package (this
fix un-bricks the WHOLE agentic-flow CLI, a larger payoff than this ADR's
own scope); (b) author `run-hub.js`/`run-agent.js` into `src/federation/`
(or adapt the docker test runners) AND ship them; (c) then add the
hub/client `exports`-map entries. T-numbering otherwise stands; status stays
`proposed` (nothing fixed yet — nothing stale).
