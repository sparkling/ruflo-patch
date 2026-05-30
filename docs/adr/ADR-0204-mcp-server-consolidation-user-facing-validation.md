---
status: accepted
date: 2026-05-19
tags: [mcp, server, schema-validation, consolidation]
supersedes: []
depends-on: [ADR-0201, ADR-0202]
implements: []
---

# Unify the user-facing MCP server path on the validating package server

> **REFRAMED after a 6-expert swarm review (2026-05-20, second pass) —
> Option D REJECTED as written; see `## Swarm review evidence`.** The swarm
> (incl. an empirical reproduction of F-09-011) found the ADR aimed a large,
> upstream-diverging migration at the wrong file. Key findings:
> **(1)** The user-facing `mcp start` path is **NOT** `src/mcp-server.ts`
> (`startStdioServer()`); it is the **fast-path inline JSON-RPC loop in
> `bin/cli.js:43-224`** (and a second copy in `bin/mcp-server.js`), which
> short-circuits before command routing. There are **THREE** hand-rolled
> stdio loops, not two. **(2)** F-09-011 is LIVE (reproduced) — but because
> the served `bin/cli.js` loop has **no** `initProcessArchivist()`; the
> `:479` init (ADR-0181 Phase 1) is in the *unreached* `startStdioServer()`.
> So Option D (scoped to `src/mcp-server.ts:426-722`) **migrates the wrong
> file and would not fix F-09-011** — and would *regress* it, since the
> package `MCPServer` has **zero** archivist awareness (grep-clean). **(3)**
> Option D's bridge mechanism is factually broken: `getToolDefinitions()`
> does not exist (the export is `listMCPTools()`, handlers stripped);
> `registerTools` is a name-collision (the CLI's is a private `void`
> Map-populate, not `MCPServer.registerTools`); and package validation
> failures return `{isError:true}` tool *results*, not JSON-RPC errors — so D
> would fail its own F-09-001 acceptance check. **(4)** F-09-001/002/003/006/
> 007 are **upstream-inherited**, and upstream *actively maintains* the
> 3-loop hand-rolled stdio path while confining the package server to HTTP —
> Option D diverges + creates recurring merge-tax on the most-edited MCP
> files. **(5)** Undeclared dependency on the unbuilt ADR-0202 (the daemon's
> lifelong RVF lock could deadlock a mandatory `ensureRvfWired()`-before-
> serving).
>
> **Reframed decision:** decompose into targeted fixes on the *served* path
> instead of a migration — (a) **F-09-011:** add `await initProcessArchivist()`
> + RVF/SQLite warm to `bin/cli.js` + `bin/mcp-server.js` (or route them
> through `startStdioServer()`); (b) **F-09-001:** validate-in-place — import
> the standalone `@claude-flow/mcp` `validateSchema` into all three stdio
> loops' `tools/call`, surface JSON-RPC errors, delete the dead
> `validateToolInput`; (c) **F-09-002:** register the tool registry into the
> HTTP `MCPServer` (narrow Option-C delta); (d.1) **F-09-003:** PICK upstream
> `d065b2d65` to fix the HTTP struct-on-wire `protocolVersion` — non-blocking
> for `implemented`; (d.2) stdio-literal centralization splits to a new ADR.
> Option D is retained as a *deferred* future
> consolidation with explicit preconditions. The completion gate is kept but
> must spawn the real bin.

## Implementation status (2026-05-21)

**Implemented** in `@sparkleideas/cli@3.7.0-alpha.10` (verified live on patch.244):

- **(a) F-09-011** — `bin/cli.js` + `bin/mcp-server.js` run `initProcessArchivist()` + `warmUpRvfWithRetry()` as a background `archivistReady` promise; the JSON-RPC handshake stays instant, and `tools/call` `await`s it (failing loud on a fatal substrate). Verified: a fresh served process round-trips `memory_store`/`memory_search` with no "ensureRvfWired before initProcessArchivist".
- **(b) F-09-001** — `validateSchema` imported into the served `tools/call`; bad payloads surface as JSON-RPC `-32602`; dead `validateToolInput` deleted.
- **(c) F-09-002** — HTTP `MCPServer` registers `TOOL_REGISTRY_WITH_HANDLERS`.
- **(d.1) F-09-003** — upstream `d065b2d65` cherry-picked (HTTP `protocolVersion` string-on-wire).
- **(e)** — init-generated `.mcp.json` mounts `ruflo` only; the standalone `agentdb` mount stays deferred.
- **(d.2)** stdio protocol-version-literal centralization remains deferred to a future ADR (refactor, non-blocking).

The completion gate now runs in the **canonical** release acceptance (`scripts/test-acceptance.sh`), not only `test-acceptance-fast.sh`: `adr0204-archivist-rt`, `adr0204-bad-payload`, `adr0204-transport-parity`, `adr0204-mount`. (Wiring gap found 2026-05-21: the gate previously ran only in the fast runner.)

**Adjacent finding (separate fix — [[ADR-0226]]):** while validating the served memory bus by hand, the FIRST `memory_store` on a cold server was found to never emit its JSON-RPC reply — the store persisted, but the client hung. Root cause was a **pre-existing** (ADR-0085) blanket `console.log` no-op monkey-patch during controller-registry init swallowing the reply frame via a timing race — **NOT** an ADR-0204 regression (the first non-embedding `tools/call` replies fine). Fixed by writing JSON-RPC frames via raw `process.stdout.write` (ADR-0226); `adr0204-archivist-rt` now also guards it (fails on a MISSING first-store reply).

## Context and Problem Statement

ADR-0201's slice 09 audit (`docs/audits/2026-05-19-soundness-audit/09-mcp-server-wiring.md`) and slice 08 (`docs/audits/2026-05-19-soundness-audit/08-mcp-tool-implementations.md`) found that `ruflo mcp start` ships **two parallel MCP server implementations** with disjoint feature sets, mutually inconsistent protocol claims, and asymmetric tool surfaces between transports.

* **Package server — `forks/ruflo/v3/@claude-flow/mcp/src/server.ts` (1,134 LOC).** Full MCP 2025-11-25 surface: `MCPServer` class wiring `ToolRegistry` (with `validateSchema` on every `execute()`, see `mcp/src/tool-registry.ts:286-299`), `SessionManager`, `ResourceRegistry`, `PromptRegistry`, `TaskManager`, `TransportManager` (stdio/http/websocket — and `mcp/src/transport/stdio.ts` is a real 252-LOC `StdioTransport` adapter, NOT dead code), `RateLimiter`, `OAuth 2.1+PKCE`, `SamplingManager`, `ConnectionPool`. Wired into the HTTP transport path only.
* **Hand-rolled CLI server — `forks/ruflo/v3/@claude-flow/cli/src/mcp-server.ts` (1,016 LOC).** Hand-rolled JSON-RPC stdio loop (lines 426-722). Maintains its own 197-tool `TOOL_REGISTRY` (`mcp-client.ts`). `tools/call` (lines 655-685) invokes `callMCPTool` with **no schema validation** between the wire and the handler. Advertises `protocolVersion: '2024-11-05'` (string, year-stale). Does NOT instantiate any of the package server's eight subsystems.

The user-facing `ruflo mcp start` (the default stdio transport that Claude Code spawns via `.mcp.json`) runs the hand-rolled path. Schema validation is bypassed in production. The HTTP transport path uses the package server but registers **zero of the 197 CLI tools** (only the 4 built-in `system/*` + `tools/list-detailed` from `registerBuiltInTools()`), so `--transport http` exposes a different and much smaller surface than stdio.

Audit findings rolled into this ADR's scope (from `09-mcp-server-wiring.md` + `08-mcp-tool-implementations.md`):

* **F-09-001 [CRITICAL]** — `tools/call` in `cli/src/mcp-server.ts:655-685` never invokes schema validation. The wire-to-handler hop is unprotected.
* **F-09-002 [CRITICAL]** — HTTP transport in `cli/src/mcp-server.ts:727-756` spawns the `@claude-flow/mcp` `MCPServer` but registers zero of the 197 CLI tools, so HTTP serves a different tool surface than stdio.
* **F-09-003 [HIGH]** — Protocol version disagrees: stdio advertises string `'2024-11-05'`, package advertises `{major: 2025, minor: 11, patch: 25}` object. Same `MCPServer V3` brand, two protocol claims, neither matches the MCP spec's date-stamped string shape (`'2025-11-25'`).
* **F-09-004 [HIGH]** — Rate-limiter, connection-pool, OAuth, sampling, prompt-registry, resource-registry, task-manager (~1,500 LOC across eight files) are dead code on the production user-facing path.
* **F-08-001 [CRITICAL — duplicate symptom of F-09-002]** — package server's `registerBuiltInTools()` registers exactly 4 tools; the 327-tool `mcp-tools/` registry (audit slice 08) is never bridged into the HTTP path.

Practical consequence: a malformed `agent_spawn` payload that the package server's `validateSchema` would reject (wrong type, out-of-range integer, missing required field, pattern violation) reaches the handler unfiltered in the production stdio path. Handlers must defend themselves; many do not (audit slice 08 catalogues 14 silent-fallback / honest-stub findings on the handler side, several of which are explicitly the consequence of schemas not being enforced upstream).

A complicating constraint: `cli/src/mcp-client.ts:270-299` exports a `validateToolInput` helper that is a weaker subset of the package's `validateSchema` (checks only `required` fields — no `type`, `pattern`, `min/maxLength`, `min/maximum`, `enum`, `additionalProperties`, no nested validation). Even if it were wired (F-09-001 fix attempt #1), it would not provide JSON-Schema enforcement (F-09-007).

ADR-0117 (revised 2026-05-03) requires init-time `mcpServers.ruflo` registration; ADR-0143 requires the user-facing entry point to be `@sparkleideas/ruflo`. Both contracts are downstream of the MCP server choice this ADR makes — they constrain the spawn command, not the server implementation. ADR-0201 mandated audit-finding follow-ups under separate ADRs; this is the consolidation ADR for the MCP-server-wiring family of findings.

### Follow-up finding — F-09-011 (2026-05-20): the user-facing path serves archivist-backed tools without completing the archivist bootstrap

A debugging session on 2026-05-20 surfaced a second, reproducible symptom of the same two-path divergence — at the memory-bootstrap seam rather than the schema seam. Archivist-backed MCP tools (`agentdb_*`, `memory_*`) dispatch through `getProcessArchivist()` → `ensureSqliteWired()` / `ensureRvfWired()` (`cli/src/memory/archivist-init.ts`), which are **fail-loud guards** (per [[feedback-no-fallbacks]] / ADR-0180/0181): they throw `archivist-init: ensureSqliteWired called before initProcessArchivist` unless the host process completed `initProcessArchivist()` first. Calling `mcp__ruflo__agentdb_hierarchical-store` / `memory_store` over the user-facing stdio path returns exactly that error.

Triage ruled out the three obvious causes: **(a) not a stale published package** — the published build (`@sparkleideas/cli 3.7.0-alpha.10-patch.237` via `@sparkleideas/ruflo patch.208`) contains the init wiring (`mcp-server.js` dist `:368-369`); **(b) not a module-instance split** — `mcp-tools/agentdb-tools.js` imports the *same* `archivist-init.js` the server bootstraps and dispatches via `(await getProcessArchivist()).dispatch(...)`; **(c) not merely stale `autoStart` processes** — the failure reproduces against the current-build session server even after older server generations are killed. The init exists in `MCPServerManager.startStdioServer()` (`mcp-server.ts:479`, before the stdin listener at `:543`), yet served tool dispatches see `initialized === false`.

The residual cause is the path divergence this ADR targets: the substrate bootstrap is not guaranteed to run-to-completion on the path that actually serves tool calls. Consolidation (Option D) must make the archivist/memory substrate bootstrap an **explicit precondition of serving any tool** — `await initProcessArchivist()` (+ RVF/SQLite wiring) must complete on the single chosen server before tool registration/serving, aborting loudly if it cannot.

Operational note: `autoStart: true` was observed to accumulate stale MCP server generations (processes ~1–7 days old still bound, of differing builds). The consolidated server should not leave stale generations serving alongside a current one; the symptom (multiple `mcp start` processes of differing builds) compounds the path-divergence confusion. Whether the autoStart-staleness guard lands here or as a small follow-up is a wiring decision.

## Decision Drivers

* **User-facing safety**: the default install path (`ruflo mcp start` over stdio) must enforce input schemas. Schema enforcement that lives in the package but is unreachable from production is worse than no claim of enforcement at all — it builds false confidence.
* **Tool-surface invariance across transports**: stdio and HTTP must expose the same tool set, or the asymmetry must be a documented, enforced design choice (it is currently neither).
* **Protocol-version consistency**: one server brand, one protocol claim, conformant with the MCP spec's date-stamped string shape.
* **Eliminate dead-code drift**: the package's eight subsystems either get wired into the production path or move to `archive/`. Leaving 1,500 LOC of facilities (`rate-limiter.ts:267`, `oauth.ts:448`, `sampling.ts:363`, etc.) unreachable from the user-facing path is an ongoing maintenance tax and a footgun (any future contributor who instantiates the package server expects these to be live).
* **Loud-not-silent failure**: per [[feedback-no-fallbacks]] and ADR-0082, schema validation failures must surface as `tools/call` JSON-RPC errors with the validator's diagnostic, not get swallowed into handler-level success envelopes.
* **Composability with ADR-0117 / ADR-0143**: the `.mcp.json` spawn command stays `npx -y @sparkleideas/ruflo@latest mcp start` regardless of which server implementation is chosen; this ADR scopes to what runs **inside** that process.
* **Trace before hypothesis** ([[feedback-trace-before-hypothesis]]): the audit already traced both server paths — `mcp/src/transport/stdio.ts` (252 LOC) exists and is a real `ITransport` adapter. The package server can serve stdio natively today; the hand-rolled fork is not load-bearing.
* **Substrate bootstrap before serving** (F-09-011): the consolidated server must complete the archivist/memory substrate bootstrap (`initProcessArchivist()` + RVF/SQLite wiring) before serving any tool call. Today archivist-backed tools (`agentdb_*`, `memory_*`) fail-loud on the user-facing path because the bootstrap is not guaranteed to run-to-completion on the tool-serving path. The single chosen server must own this ordering and abort startup loudly if the substrate cannot stand up (per [[feedback-no-fallbacks]]).

## Considered Options

* **Option A — Migrate to package server for both transports (full features, keep hand-rolled).** Wire `cli/src/mcp-server.ts` to instantiate `MCPServer` from `@claude-flow/mcp` for stdio AND http; register the 197-tool registry into the package's `ToolRegistry` via `registerTools(...)`; keep the hand-rolled JSON-RPC loop as a parallel implementation for a transition period.
* **Option B — Delete `@claude-flow/mcp` package; keep hand-rolled stdio + add schema validation there.** Lift `schema-validator.ts` (and selectively whichever subsystems are actually needed) into the CLI; delete the package and its eight subsystems wholesale.
* **Option C — Split-purpose (status quo + register tools in HTTP).** Keep hand-rolled for stdio; keep package for HTTP/SSE; fix only F-09-002 by registering the 197 CLI tools with the HTTP server. Schema validation stays bypassed on the stdio path.
* **Option D — Hybrid: migrate to package server using its native stdio adapter; delete hand-rolled.** Replace the hand-rolled JSON-RPC loop in `cli/src/mcp-server.ts` with a thin bootstrap that instantiates `MCPServer` from `@claude-flow/mcp`, configures it with the `StdioTransport` from `mcp/src/transport/stdio.ts`, and bridges the 197-tool registry via `mcpServer.registerTools(...)` at startup. The hand-rolled JSON-RPC loop (`cli/src/mcp-server.ts:426-722`, ~300 LOC) goes away. Both transports go through the same `MCPServer` instance with the same tool registry, schema validation, and protocol claim.

## Decision Outcome

**Chosen (REVISED by swarm 2026-05-20): a decomposed set of targeted fixes on the actual served path — NOT Option D.** The original draft chose Option D (migrate stdio to the package server, delete the hand-rolled loop). The swarm rejected it (wrong file, regresses F-09-011, broken bridge mechanism, upstream divergence — see `## Swarm review evidence`). The revised decision:**

- **(a) F-09-011 [live blocker] — fix in the served path.** The served bins (`v3/@claude-flow/cli/bin/cli.js` fast-path inline loop, body `:46-204`, and `v3/@claude-flow/cli/bin/mcp-server.js`) currently run **no** archivist bootstrap. Replicate the three-step startup ordering `src/mcp-server.ts:478-543` already performs before its stdin listener: (1) `await initProcessArchivist()` (`:479`); (2) `await warmUpRvfWithRetry(sessionId, ensureRvfWired)` inside a `try/catch` that `process.exit(1)`s on a non-recoverable fault (`:506-510`); THEN (3) attach the stdin/JSON-RPC listener (`:543`). OR route both bins through `startStdioServer()` itself. **Gated on ADR-0202** (see `depends-on`): step (2) must NOT acquire the RVF flock as a serving precondition until 0202's per-op release is live, or it deadlocks against the daemon's lifetime lock (ADR-0202:294).
- **(b) F-09-001 [user-facing CRITICAL] — validate-in-place.** Import the standalone `validateSchema` (`@claude-flow/mcp/schema-validator`; reachable via the package's `"./*": "./dist/*.js"` export + barrel `mcp/src/index.ts:145-149`, and the CLI already type-deps `@claude-flow/mcp`) into the `tools/call` of all three stdio loops before `callMCPTool`; surface failures as JSON-RPC errors; delete the dead `validateToolInput`. Lower-divergence than Option D and upstream-aligned (upstream maintains these loops; keeps the package server for HTTP) — but note it is still fork-new code in three upstream-maintained loops, a non-zero (if small) recurring merge cost.
- **(c) F-09-002 / F-08-001 — register the 197-tool registry into the HTTP `MCPServer`** (narrow Option-C delta), orthogonal to stdio.
- **(d) F-09-003 — split into a live-bug pick (in 0204, non-blocking) + a centralization follow-up (new ADR).**
  - **(d.1) [in-family follow-up; non-blocking for `implemented`] PICK upstream `d065b2d65`** (2026-05-09, "fix #1874 + add MCP protocol-compliance smoke layer") via `git cherry-pick -x`. The fork is **369 commits behind upstream and has NOT integrated it** (`git merge-base --is-ancestor d065b2d65 HEAD` → false): `mcp/src/server.ts:91-95` still declares `protocolVersion` as a STRUCT `{major:2025,minor:11,patch:25}` and emits it on the wire (`:491-496`), which Claude Code's Zod validator rejects on the documented `ruflo mcp start -t http` path (`commands/mcp.ts:132-138`). The pick converts the struct to the spec's date-stamped string. Append an INTEGRATION-LEDGER row: `| d065b2d65 | 2026-05-09 | fix #1874 + add MCP protocol-compliance smoke layer | PICK | <local SHA> | 0204 | Resolves F-09-003 HTTP struct-on-wire; (d.2) stdio-literal centralization split to follow-up ADR. |` (this also closes the standing-rule gap at `INTEGRATION-LEDGER.md:123`, which currently ledgers only the chore-bump `a075c59fc`).
  - **(d.2) [DEFERRED to a new wire-protocol-versioning ADR, `depends-on: 0204`]** centralize the three stdio protocol-version literals (`bin/cli.js`, `bin/mcp-server.js`, `src/mcp-server.ts:632`) into one fork-local `cli/src/protocol-version.ts` SoT constant. Upstream `d065b2d65` **deliberately keeps two distinct values** — `'2025-11-25'` (package/HTTP) and `'2024-11-05'` (shared/stdio) — so the follow-up preserves the split; it does NOT unify them. Pinning a single value would regress upstream's design and advertise capabilities the `2024-11-05` stdio loops don't implement.
- **(e) agentdb `agentdb_*` mount question [0204 owns; deferred-here by ADR-0213:52].** The `agentdb_*` family *can be* mounted twice — the aggregator under `mcp__ruflo__agentdb_*` (the **only mount init generates today**: `mcp-generator.ts:70` builds `{ruflo}` alone) and a standalone under `mcp__agentdb__agentdb_*` (boot status owned by ADR-0213, not litigated here). Split the provenance: the aggregator's **controller surface** is upstream-intended (per #1226); its **RVF backing is fork-only** (`archivist` is grep-clean in `mcp/src/`). 0204 answers the mount question: the aggregator is the **sole user-facing mount**; the standalone stays deferred per ADR-0213; any future opt-in standalone must use a non-overlapping namespace. (NB: 0213's `busy_timeout` standalone boot crash is a *distinct* bug from F-09-011 — different binary; `archivist-init.ts` has zero PRAGMA calls — filed/fixed separately in `forks/agentdb`.)
- **Option D (full consolidation) is DEFERRED**, not adopted: revisit only if the multi-loop merge-tax later outweighs convergence, and only with (i) the archivist init explicitly designed into `createMCPServer()`'s lifecycle (not assumed), (ii) the bridge mechanism corrected (`listMCPTools` w/ handlers, real `MCPServer.registerTools`, JSON-RPC error shape), (iii) cold-start measured first, (iv) the ADR-0202 RVF-lock interaction resolved.

The rest of this section's Option-D rationale is retained below for the record but is superseded by the above.

~~**Original: Option D — Hybrid: migrate to package server using its native stdio adapter; delete the hand-rolled JSON-RPC loop.**~~

Rationale:

* **Option A** keeps a parallel implementation indefinitely. The audit's core finding is that the two implementations drift in protocol claims, tool surfaces, and feature wiring — sustaining both is the problem, not the solution. "Transition period" with no end-state is the long-term failure mode (see F-09-008 / F-09-009 / F-09-010 for adjacent drift evidence).
* **Option B** discards 1,500+ LOC of working code (rate-limiter, OAuth, sampling, prompt-registry, etc.) that the audit verified is **functionally correct** — just never wired. Most of that code is genuine MCP 2025-11-25 spec compliance work that the hand-rolled loop has no replacement for. Deleting it forecloses on multi-tenant / authenticated MCP futures (which ADR-0117's marketplace path will eventually need) and is a one-way door. Build-cost vs throw-away-cost is asymmetric.
* **Option C** fixes only the symptom (tool surface asymmetry between transports) and leaves the user-facing stdio path unvalidated forever. The audit's F-09-001 (CRITICAL) is specifically that the default install path bypasses schema validation; Option C declares that bypass a permanent design feature. Rejected: leaves the CRITICAL finding unaddressed.
* **Option D** is the unique option that resolves F-09-001, F-09-002, F-09-003, F-09-004, and F-08-001 in a single structural change. It uses the package's existing `StdioTransport` adapter (252 LOC, already implements `ITransport`) — no new transport code needed. It deletes ~300 LOC of duplicated JSON-RPC plumbing in the CLI without losing any production behaviour. Single tool registry source-of-truth (`mcp-client.ts`'s 197 tools) becomes the input to `mcpServer.registerTools(...)`; whichever transport is selected serves the same surface with the same validation.

The migration is structural, not feature-additive: every call site of `callMCPTool(...)` continues to work because the package's `ToolRegistry.execute()` invokes the same handler functions, just gated behind `validateSchema`. Handlers that already work continue to work; handlers receiving inputs that violate their declared `inputSchema` now fail at the wire boundary with the validator's diagnostic instead of silently mis-executing.

The single remaining concern is the gap between the CLI's `validateToolInput` (weaker variant per F-09-007) and the package's `validateSchema` (full JSON-Schema subset). Under Option D this gap closes automatically because the CLI's variant becomes dead code — the only validator on the production path is the package's full one.

### Consequences

> **These consequences were written for the superseded Option D (full migration) and are retained for the record. The binding consequences are the served-path fixes (a)/(b)/(c)/(d.1)/(e) in the Decision Outcome above:** F-09-011 is fixed by adding the init→warm-up→listener ordering to the served *bins* (NOT a "single bootstrap path"); F-09-001 by validate-in-place in the three stdio loops; F-09-002 by registering the registry into the HTTP server; F-09-003 by picking `d065b2d65` (struct→string). Bullets below that say "migration" / "single bootstrap path" / "~300 LOC deleted" describe Option D, which is **deferred**, not adopted.

* Good, because F-09-001 (CRITICAL): every `tools/call` in the user-facing stdio path runs through `validateSchema` before reaching the handler. The validator's diagnostic surfaces as a JSON-RPC error with structured error info.
* Good, because F-09-002 (CRITICAL): both transports register the same 197-tool registry via `mcpServer.registerTools(...)` at startup. `tools/list` returns identical results regardless of transport.
* Good, because F-09-003 (HIGH): picking `d065b2d65` (d.1) replaces the package server's structured `{major, minor, patch}` object with the MCP-spec date-stamped string Claude Code's Zod validator accepts on the HTTP path. There is **no** `@modelcontextprotocol/sdk` dependency to source from; HTTP and stdio keep upstream's two distinct values (`'2025-11-25'` / `'2024-11-05'`) per (d.2).
* Good, because F-09-004 (HIGH): the package's rate-limiter / connection-pool / OAuth / sampling / prompt-registry / resource-registry / task-manager become reachable from the user-facing path. They start as inert (no config flags enable them by default) but are wireable per-feature in follow-up ADRs without further server-implementation churn.
* Good, because F-08-001 (CRITICAL — slice 08): the 197-tool HTTP-surface gap closes. HTTP MCP transport callers (e.g. anyone configuring `--transport http`) get the full tool surface instead of just 4 system tools.
* Good, because F-09-011 (2026-05-20 follow-up): adding the `initProcessArchivist()` → `warmUpRvfWithRetry` → listener ordering to the served *bins* (a) makes substrate wiring a deterministic precondition of serving tools. Archivist-backed tools (`agentdb_*`, `memory_*`) stop returning `ensureSqliteWired/ensureRvfWired called before initProcessArchivist` on the user-facing stdio path — the fail-loud guard no longer fires because the substrate is actually wired before any dispatch. (Per (a), this is gated on ADR-0202.)
* Good, because eliminates ~300 LOC of hand-rolled JSON-RPC code from the CLI. Net code reduction.
* Good, because future MCP spec migrations (protocol version bumps, new methods, capability negotiation changes) happen in one place (`@claude-flow/mcp`) instead of two.
* Good, because aligns with [[reference-user-facing-brand]] and ADR-0143 — the `@sparkleideas/ruflo mcp start` spawn command is unchanged; only the in-process implementation changes.
* Bad, because the migration requires careful handler-error-shape preservation. The CLI's `callMCPTool` wraps thrown errors a particular way; the package's `ToolRegistry.execute()` wraps them differently (`{ content: [{ type: 'text', text: ... }], isError: true }`). Any test or downstream consumer that asserts on the exact error envelope shape needs to be updated.
* Bad, because the package server's `MCPServer.start()` calls `registerBuiltInTools()` (4 tools); the CLI needs to additionally call `registerTools(...)` AFTER start to attach the 197-tool registry. Ordering matters — if not done at startup, the first `tools/list` returns an incomplete view. Acceptance check must assert tool-count post-startup.
* Bad, because handlers that currently receive un-validated input (because the bypass made the validator unreachable) will start failing JSON-schema validation for callers that were sending sloppy payloads. This is a **correctness improvement**, but is observable as a behaviour change for sloppy callers — agent docs / skill bodies that were sending unvalidated payloads will need their references corrected. Mitigation: changelog entry + acceptance check that exercises a known-bad payload and asserts the validator's error surfaces.
* Bad, because the package server's transport stack adds startup cost relative to the bare hand-rolled JSON-RPC loop. Per F-09-009, the CLI currently writes a structured stderr log block at startup; the package server's logging chain is different. Startup time must be measured against ADR-0143's wrapper-overhead budget (~70-100ms post-ADR-0142) — if MCP-server cold-start exceeds that envelope materially, this ADR's implementation must be backed by a measurement and may require optimisation. Schema validation per-call is bounded by O(schema size + payload size) and is not on a hot path (one call per tool invocation, not per stream frame).
* Neutral, because the dual-namespace concern from ADR-0117 (revised) is unaffected — both Option C status quo and Option D produce the same `.mcp.json` shape (one `mcpServers.ruflo` key) and the same dispatched binary (`@sparkleideas/ruflo mcp start`).
* Neutral, because the package server has its own `BuiltInTools` (4 system tools); these remain registered. The CLI registry contains no overlapping names (verified by F-08 audit, "Zero duplicate tool names across the 327-tool surface"), so no naming collision.
* Neutral, because the package's `connection-pool.ts` stays inert (no config flag set) under this ADR's scope. If a follow-up ADR enables it (e.g. for HTTP transport's multi-connection pooling), the wiring is one config-object property change away — no further structural migration.
* Neutral, because dead-tree adjacent scaffolds (`v3/mcp/server.ts` per F-08-008, `v3/src/infrastructure/mcp/MCPServer.ts` per F-08-009) are explicitly out of scope for this ADR. Disposition of those decisions belongs in separate ADRs covering the dead-code cleanup family.

### Confirmation

### Completion gate (blocking)

**This ADR does NOT move to `implemented` until the following runtime check is green in `npm run release`.** F-09-011 was invisible to unit tests and to the static audit — it only appears when a real client dispatches an archivist-backed tool over the *user-facing* stdio server. A code-review, grep, or unit-mock assertion cannot prove it fixed. Therefore the binding completion criterion is an end-to-end acceptance check:

* Register an acceptance check in `lib/acceptance-harness.sh`, run by `npm run release` against a fresh `ruflo init`'d sandbox (per [[feedback-test-in-init-projects]] / [[feedback-complete-acceptance-tests]]; packages installed from Verdaccio per [[feedback-inspect-installed-not-dev-nodemodules]], NOT dev `node_modules`), that:
  1. boots the **user-facing** server exactly as `.mcp.json` does — `npx -y @sparkleideas/ruflo@latest mcp start` over stdio (the real spawned process, NOT a unit-mocked `MCPServer`);
  2. dispatches `tools/call` for `memory_store` (RVF substrate, namespace `adr-patterns`) AND `agentdb_hierarchical-store` (SQLite carve-out substrate, args `{key: 'adr/ADR-XXXX', value: …}` — the schema is `{key,value,tier}`, required `[key,value]`; there is **no `path` field**, and a `path` arg fails arg-validation at `agentdb-tools.ts:525` BEFORE reaching the `ensureSqliteWired` guard at `:539`, so the gate would not even exercise F-09-011) with valid arguments — these are the **exact two tools ADR indexing uses** (see below);
  3. asserts each write returns a success result — NOT a tool-result envelope whose `error` field contains `called before initProcessArchivist`, and NOT a JSON-RPC `-32601`. NB: these handlers surface failures inside the result payload as `{success:false, error}` (`agentdb-tools.ts:546-548`), NOT as a JSON-RPC `error` object — the gate asserts on the result payload, not `response.error`;
  4. **reads the records back** — `agentdb_hierarchical-recall` for the hierarchical key and `memory_search` for the `adr-patterns` key — and asserts the stored values are returned. A write that returns success but is not retrievable is a silent no-op fallback ([[feedback-no-fallbacks]]); the round-trip is what proves the substrate is actually wired, not just that the guard didn't throw.
* **ADR indexing is the protected consumer.** `adr-create` steps 4–6 and the `/adr-index` skill register every ADR through this same path: `agentdb_hierarchical-store` (the `adr/ADR-NNNN` record) + `memory_store` namespace `adr-patterns` (semantic search). The 2026-05-20 deferral of the ADR-0217 / ADR-0218 index registrations is the live instance this gate protects against — a green gate means `/adr-index` round-trips again. Note the path distinction: the gate must exercise the **MCP-server path** (`mcp__ruflo__*` over stdio), which is the broken one; the **CLI path** (`ruflo` subcommands) already inits correctly via `index.ts:282` and would mask the defect if used instead.
* The check MUST fail against the pre-fix build (it reproduces the 2026-05-20 error) and pass only once the consolidated server runs `initProcessArchivist()` + substrate wiring to completion before serving. A green run is the proof the consolidation actually closed the live blocker — not just the schema-validation findings. Until it is green, the ADR stays `accepted`, not `implemented`.
* Per [[feedback-skip-accepted-as-squelch]]: this gate may not be `skip_accepted`. The only legitimate skips are tool-not-found / env-disabled; "archivist didn't init" is the exact failure this gate exists to catch and must surface loudly.

Implementation is confirmed complete when:

* `cli/src/mcp-server.ts` no longer contains the hand-rolled JSON-RPC stdio loop (lines 426-722 of the current source are removed). The file becomes a thin bootstrap that imports `MCPServer` from `@claude-flow/mcp`, configures it with stdio or http transport based on flags, and bridges the 197-tool registry.
* `mcp-client.ts`'s `validateToolInput` (weaker validator) is deleted. The only validator on the production path is `mcp/src/schema-validator.ts`'s `validateSchema`.
* `mcp-server.ts` has no remaining direct readline/JSON-RPC plumbing. The package's `StdioTransport` owns I/O.
* Acceptance check (new): boot `ruflo mcp start` over stdio in a sandbox; send `{"jsonrpc":"2.0","method":"tools/list","id":1}`; assert the returned tool count equals the registry's own count read dynamically (`listMCPTools().length` from `mcp-client.ts`) — NEVER a hardcoded integer (see §Note on the tool count). The pre-fix state would return 4 tools over HTTP and the full registry over stdio, with no schema enforcement on either.
* Acceptance check (new — F-09-001 fix): in the same sandbox, send `{"jsonrpc":"2.0","method":"tools/call","params":{"name":"agent_spawn","arguments":{}},"id":2}` (deliberately missing required fields per `agent_spawn`'s schema). Assert the response contains a JSON-RPC error with a validator diagnostic (e.g. `"Missing required field: type"` or a structured `Invalid input` envelope) — NOT a tool-handler-level success envelope.
* Acceptance check (new — F-09-002 fix): boot the same server with `--transport http` (if exposed via CLI; otherwise via a sibling test entry-point); send `tools/list`; assert the count is identical to the stdio path AND both equal `listMCPTools().length` (transport parity, dynamic count).
* Acceptance check (new — F-09-003 fix, lands with (d.1)): assert the `initialize` response's `protocolVersion` is a Zod-accepting date-stamped string (`YYYY-MM-DD`) on BOTH transports — HTTP `== '2025-11-25'`, stdio `== '2024-11-05'`. This is upstream's deliberate two-value split (`d065b2d65`), NOT a single pinned constant; there is **no `@modelcontextprotocol/sdk` dependency** to source from (grep-clean across `cli/`+`mcp/`+`shared/` `package.json`), so each value is a named fork-local constant. The check passes `plugins/ruflo-core/scripts/test-mcp-protocol.mjs` against the fork dist.
* Acceptance check (F-09-011): the archivist-backed-tool dispatch over the user-facing stdio server — specified in full as the **Completion gate (blocking)** above. It is the binding gate, not an optional check; listed here only for cross-reference alongside the other findings.
* Acceptance check (new — item (e) mount): assert `mcpServers.agentdb` is **NOT** present in the init-generated `.mcp.json` (only `mcpServers.ruflo`), and that `agentdb_hierarchical-store` resolves through the `mcp__ruflo__` aggregator mount.
* `grep -rn "validateToolInput" forks/ruflo/v3/@claude-flow/cli/src/` returns 0 hits post-implementation (helper deleted).
* `grep -rn "validateSchema" forks/ruflo/v3/@claude-flow/cli/src/` returns at least one hit (transitive import via `MCPServer.handleToolsCall()`).
* Audit findings F-09-001, F-09-002, F-09-003, F-09-004, F-08-001, and the post-audit follow-up F-09-011 marked resolved in `docs/audits/2026-05-19-soundness-audit/00-README.md` synthesis section; each finding's resolution cites this ADR.
* Wrapper-overhead measurement: `time ruflo mcp start` cold-start measured before and after migration. If post-migration cold-start exceeds ~200ms (ADR-0142 wrapper budget + reasonable in-process MCP boot allowance), the implementer surfaces the regression and the ADR's implementation is gated on optimisation before merge.

## Swarm review evidence (2026-05-20, second pass)

6-expert adversarial swarm (queen + architect + runtime + archaeologist +
upstream + devil's advocate), applying [[feedback-remediation-adr-preflight]].
**Option D rejected; reframed to served-path targeted fixes.** Findings:

- **The served `mcp start` path is the bin fast-path loop, not `src/mcp-server.ts` (#3 premise-true; empirically reproduced).** `.mcp.json` runs `npx -y @sparkleideas/ruflo mcp start` with piped stdin → `bin/cli.js:43-46` intercepts (`mcp start` + non-TTY stdin) and runs an **inline JSON-RPC loop (`bin/cli.js:46-224`)** that imports `callMCPTool` directly and **short-circuits before command routing** — it never reaches `commands/mcp.ts` → `MCPServerManager.startStdioServer()`. `bin/mcp-server.js` is a second standalone copy. So there are **THREE** hand-rolled stdio loops; the ADR named only `src/mcp-server.ts`.
- **F-09-011 is LIVE (reproduced) — but mis-diagnosed + mis-scoped.** A fresh Verdaccio-installed `mcp start` returns `"ensureRvfWired called before initProcessArchivist"` / `"ensureSqliteWired called before initProcessArchivist"` for `memory_store` / `agentdb_hierarchical-store`; round-trip = silent no-op. Cause: the served `bin/cli.js`/`bin/mcp-server.js` loops have **no** `initProcessArchivist()`. The `:479` init (ADR-0181 Phase 1 `b17807487`, 2026-05-15) is real but in the *unreached* `startStdioServer()`. The guards `ensureSqliteWired`/`ensureRvfWired` throw on `!initialized` and do NOT fold in init (the `getProcessArchivist` self-heal never runs because the guard fires first on the same line). Stale `autoStart` processes are NOT the cause (single fresh process failed deterministically). **Fix = add the init to the bin loops; this is a ~5-line served-path fix, not a server migration.**
- **Option D would NOT fix F-09-011, and would REGRESS it.** It is scoped to `src/mcp-server.ts:426-722` (not the served path), and the package `MCPServer` has **zero** archivist awareness (`grep -rin archivist mcp/src/` = no hits). Migrating to it deletes the only init code and must re-add it as net-new fork code on `createMCPServer()`'s lifecycle — which the impl table omits. The ADR's "consolidation makes init a precondition" is aspirational.
- **Option D's bridge mechanism is factually broken (architect, verified).** `getToolDefinitions()` — cited as load-bearing ("verified during ADR authoring") — **does not exist**; the export is `listMCPTools()` returning handler-stripped metadata (can't bridge). `registerTools` is a **name-collision**: `mcp-client.ts:74` is a module-private `registerTools(tools): void` (populates the local Map), not `MCPServer.registerTools(tools): {registered, failed}` (`mcp/src/server.ts:55,292`). Package validation failures are returned as `{content, isError:true}` tool *results* (`tool-registry.ts:294-297`), **not** JSON-RPC errors — so Option D would *fail its own F-09-001 acceptance check* (which expects a JSON-RPC error) and is itself the swallowed-into-success anti-pattern the ADR forbids.
- **F-09-001/002/003/006/007 are upstream-inherited; upstream actively maintains the hand-rolled stdio path (#2).** Upstream has the same 3 unvalidated stdio loops; its HTTP path never calls `registerTools` (F-09-002 inherited); it *deliberately* runs two protocol versions (`d065b2d65`, 2026-05-09 — kept the split, hardened each in place). Upstream is hardening the hand-rolled stdio loops monthly (`0873f8146` 05-15; PR #2064 05-19) and confines the package server to HTTP — there is **no upstream consolidation signal**. Option D moves against this current → recurring merge-tax on `src/mcp-server.ts:426-722` + both bins, plus a fork-only archivist patch on upstream's HTTP-hardening package server. **Validate-in-place is the lower-divergence fix** (`validateSchema` is a standalone export; the CLI already deps+imports `@claude-flow/mcp`).
- **The archivist is entirely fork-specific** (no `archivist` anywhere in upstream `cli/src`; upstream uses best-effort graceful-degradation memory init). So the F-09-011 fix is a fork patch regardless; the question is whether it lands on 2 bin loops (cheap) or is carried on a migrated package server (expensive, moving target).
- **Undeclared dependency on the unbuilt ADR-0202.** Making `ensureRvfWired()` a precondition of serving any tool can deadlock/fail-loud when the daemon holds the RVF lock for life (F-13-001/ADR-0202, accepted-but-unimplemented). Neither the original D nor the served-path fix should mandate RVF-before-serving without accounting for 0202.
- **Sibling corrections.** 0211 is already decoupled (its D→C′ rewrite dropped the 0204 gate; the handover's "Gates 0211/0213" is stale). 0213's `busy_timeout` boot crash is a **distinct** bug (different fork/binary; `archivist-init.ts` has zero PRAGMA calls) — 0204 must not claim it; but 0204 **does own** the aggregator-vs-standalone `agentdb_*` double-mount that ADR-0213:52-54 deferred to it — now folded into the Decision Outcome as item (e) (keep the RVF aggregator mount, don't wire the standalone).
- **Completion gate: KEEP, but it must spawn the real bin.** The round-trip gate (boot `npx @sparkleideas/ruflo mcp start`, write+readback `memory_store`/`agentdb_hierarchical-store`) is well-designed and reproduced the bug — but ONLY because it spawns the actual bin. A gate that invokes `startStdioServer()` directly would falsely pass (that function has the init; the served bin doesn't). Attach the gate to the F-09-011 served-path fix as a standing regression guard. Per [[feedback-skip-accepted-as-squelch]] it may not be skip_accepted.
- **Lineage correction.** The package server is `9b33e1b2a` (2026-01-05), not `96285dccc` (which created the out-of-scope F-08-008 dead scaffold `v3/mcp/server.ts`). The hand-rolled path is the actively-maintained one (all ADR-0181 2026-05-15 work); Option D migrates *off* the maintained path *onto* the dormant package server (last touched 2026-04-05).

## Pros and Cons of the Options

### Option A — Migrate to package server for both transports, keep hand-rolled

* Good, because preserves a fallback if the package server's stdio transport has unforeseen issues.
* Bad, because perpetuates parallel implementations — drift returns next upstream merge.
* Bad, because doubles the audit surface — every future MCP issue requires checking which server is wired for which transport.
* Bad, because does not actually resolve F-09-001 unless the hand-rolled implementation is retired (which is then Option D).

### Option B — Delete `@claude-flow/mcp` package, keep hand-rolled, lift schema validator

* Good, because eliminates dead code (the package's eight subsystems become genuinely dead, not just unreachable).
* Bad, because discards working MCP 2025-11-25 compliance code (`oauth.ts`, `sampling.ts`, `prompt-registry.ts`, etc.) that the audit verified is correct.
* Bad, because closes the door on multi-tenant / authenticated MCP futures that ADR-0117's marketplace path will eventually need.
* Bad, because the hand-rolled server's protocol claim (`'2024-11-05'`) is year-stale; bringing it up to current spec means re-implementing capability negotiation, prompts, resources, tasks — duplicating what the package server already does.
* Bad, because one-way: the package server's code is harder to reconstruct than to wire.

### Option C — Status quo + register tools in HTTP

* Good, because narrow scope; one fix for F-09-002 only.
* Bad, because explicitly accepts F-09-001 as a permanent design choice — schema validation stays bypassed on the user-facing stdio path forever.
* Bad, because protocol-version disagreement (F-09-003) remains.
* Bad, because the package's eight subsystems stay unreachable from the user-facing path (F-09-004).
* Bad, because does not address the underlying drift driver: two server brands, two protocol claims, two registries.

### Option D — Hybrid: migrate to package server with native stdio adapter, delete hand-rolled

* Good, because uniquely resolves F-09-001, F-09-002, F-09-003, F-09-004, F-08-001 in one structural change.
* Good, because uses the package's existing 252-LOC `StdioTransport` adapter (no new transport code).
* Good, because net code reduction (~300 LOC deleted from CLI's hand-rolled JSON-RPC loop, ~30 LOC added for `MCPServer` bootstrap).
* Good, because single source of truth for tool registry, protocol version, validation.
* Good, because future MCP spec migrations happen in one place.
* Bad, because requires care with handler-error-shape preservation across the cutover (mitigation: acceptance check on known-bad payload).
* Bad, because startup cost is unknown until measured (mitigation: cold-start measurement gate before merge).
* Bad, because callers sending sloppy payloads will start failing schema validation (this is the correctness improvement, but observably a behaviour change — mitigation: changelog + agent-doc audit).

## More Information

Lifecycle dates from the original record: proposed 2026-05-19, accepted 2026-05-20, implemented 2026-05-21. This ADR was swarm-reviewed.

### Audit findings consolidated under this ADR

From `docs/audits/2026-05-19-soundness-audit/09-mcp-server-wiring.md`:

* **F-09-001** (CRITICAL): `tools/call` bypasses schema validation in production stdio path → resolved by Option D.
* **F-09-002** (CRITICAL): HTTP transport spawns MCPServer but registers zero tools → resolved by Option D.
* **F-09-003** (HIGH): Protocol version disagrees between stdio and HTTP transports → resolved by Option D.
* **F-09-004** (HIGH): Package facilities never wired for stdio → resolved by Option D (facilities become reachable; activation gated by config in follow-up ADRs).
* **F-09-006** (MEDIUM): `tool-registry.ts validateSchema` unreachable from stdio → resolved by Option D.
* **F-09-007** (MEDIUM): CLI's `validateToolInput` is a weaker variant of `validateSchema` → resolved by Option D (CLI variant deleted).
* **F-09-011** (CRITICAL — post-audit follow-up, 2026-05-20, not from slice 09): the user-facing path serves archivist-backed tools (`agentdb_*`, `memory_*`) without completing `initProcessArchivist()`, so they fail-loud with `ensureSqliteWired/ensureRvfWired called before initProcessArchivist`. Discovered while debugging the deferred ADR-0217/0218 index registration; triaged to a server-path/ordering issue (not stale package, not module split, not merely stale processes). → resolved by Option D making the substrate bootstrap a precondition of serving any tool.

Findings explicitly OUT of scope (separate ADR or no-action):

* **F-09-005** (MEDIUM): Plugin marketplace MCP registration is prose-only — addressed by ADR-0117 revision 2026-05-03; this ADR does not re-litigate.
* **F-09-008** (LOW): HTTP and WebSocket auth surfaces differ — separate hardening ADR if/when those transports become user-facing.
* **F-09-009** (LOW): CLI stdio start writes stderr JSON-shaped log — addressed implicitly by Option D (the package server's logger replaces the hand-rolled stderr block).
* **F-09-010** (INFO): connection-pool is in-process only and never configured — Option D makes the wiring point reachable; activation is a follow-up.

From `docs/audits/2026-05-19-soundness-audit/08-mcp-tool-implementations.md`:

* **F-08-001** (CRITICAL): `@claude-flow/mcp` server registers only 4 tools, not 327 → resolved by Option D.

### Note on the tool count

The audit cites two different tool counts: **197** (slice 09, the registered registry snapshot) and **327** (slice 08, counting all tool definitions across `mcp-tools/*.ts` including ones not registered). Neither is a stable constant — `cli/src/mcp-client.ts:81` registers **29 tool collections** (`...agentTools, ...swarmTools, ...memoryTools, …`) whose summed length is computed at build time and drifts as tools are added/removed.

**Implementation rule**: never hardcode the tool count anywhere. The registered count is the only one that matters for the wire surface, and it is read dynamically via `listMCPTools().length`. All acceptance checks assert *parity* (stdio == http == `listMCPTools().length`), not equality to a magic number. If a future check needs the absolute number, it computes it from the registry at test time.

### Related ADRs

* ADR-0117 — marketplace MCP server registration (revised 2026-05-03). Establishes init-time `mcpServers.ruflo` registration; this ADR's Option D preserves that contract unchanged.
* ADR-0143 — user-facing brand flip to `@sparkleideas/ruflo`. Establishes the spawn command in `.mcp.json`; this ADR's Option D preserves that command unchanged (the binary that gets spawned, not the implementation behind it).
* ADR-0142 — wrapper ESM-import pattern. The wrapper-overhead budget (~70-100ms warm) is the baseline against which this ADR's MCP cold-start must be measured.
* ADR-0201 — codebase soundness audit; this ADR is a Option D follow-up per ADR-0201's "audit-finding follow-ups under separate ADRs" mandate.
* ADR-0082 — fail-loud / no-fallbacks principle; this ADR's validator-surfacing requirement implements that principle for MCP wire input.

### Memory entries shaping this decision

* [[feedback-no-fallbacks]] — schema validation failures must surface, not be swallowed.
* [[feedback-trace-before-hypothesis]] — the audit traced both server paths and the package's `StdioTransport` before this ADR proposed migration.
* [[reference-user-facing-brand]] — spawn command stays `@sparkleideas/ruflo mcp start` regardless of the server choice this ADR makes.
* [[feedback-inspect-installed-not-dev-nodemodules]] — Confirmation section's acceptance checks operate on the published-package install, not dev `node_modules`.

### How we got here (lineage)

The two-server split is inherited, not designed. Traced through git + ADRs:

* **2026-01-04/05 — V3 scaffold days.** The servers landed as part of the wholesale V3 import (generic "checkpoint" commits): the 197-tool registry `cli/src/mcp-client.ts` (`2deb04253`, 01-04 19:29), the hand-rolled stdio loop `cli/src/mcp-server.ts` (`27df37558`, 01-04 22:44), and the package server `@claude-flow/mcp/src/server.ts` (`9b33e1b2a`, 01-05). NB: `96285dccc` (01-04 17:26) created the *dead scaffold* `v3/mcp/server.ts` (F-08-008, 773 LOC), NOT the real package server (1,009 LOC) — the prior cite conflated the two paths. Upstream V3 shipped two MCP server implementations; the fork inherited both.
* **The CLI wired the hand-rolled one.** `ruflo mcp start` (stdio) ran `cli/src/mcp-server.ts` + the `mcp-client.ts` registry. The package server was wired only to the HTTP transport — and even there registered zero CLI tools.
* **ADR-0056 (2026-03-22, "MCP Server Unified Backend")** did NOT consolidate the two servers — its "unified backend" is the RVF-primary/SQLite-fallback *storage* layer for `agentdb-mcp-server.ts`, a different concern. The two-server split survived it.
* **2026-04-05** — the package server's last substantive change (`9132f2020`, ADR-0069 config-chain). Dormant thereafter.
* **ADR-0180 + ADR-0181 (2026-05-14/15) entrenched the hand-rolled path.** ADR-0181 Phase 5 "flipped 100+ MCP tool sites through `archivist.dispatch`" (`272f07928`) and added RVF cold-start retry (`a819dcaa2`) — all into `cli/src/mcp-tools/` + the hand-rolled `cli/src/mcp-server.ts`. The package server received none of this. By May the hand-rolled path had the archivist wiring, the 197-tool registry, and the RVF retry; the package server had the spec-compliant MCP 2025-11-25 features and zero tool/archivist wiring. That asymmetry is exactly the drift this ADR resolves.

**Compatibility note for Option D**: the 197-tool registry handlers ARE the archivist-dispatch-flipped handlers from ADR-0181 Phase 5. Bridging them into the package server via `mcpServer.registerTools(...)` preserves the archivist dispatch path — the handler functions are unchanged, only the transport+validation shell around them changes. Option D does not re-litigate ADR-0181's work; it re-homes the same handlers under the validating server.

### Implementation sequencing

This is an implementation ADR — accepting it authorises the work directly, not a separate design pass. Work lands as direct commits on the fork `main` (per [[feedback-trunk-only-fork-development]] — no PRs, no long-lived branches).

**Files to change** (fork paths under `forks/ruflo/v3/@claude-flow/`; harness path under `ruflo-patch`):

| File | Change |
|------|--------|
| `cli/bin/cli.js` | (a) Add the served-path archivist bootstrap to the fast-path inline JSON-RPC loop (`:46-204`): `await initProcessArchivist()` → `warmUpRvfWithRetry(…, ensureRvfWired)` (with `process.exit(1)` on non-recoverable fault) → THEN the stdin listener, mirroring `src/mcp-server.ts:478-543`. (b) Import `validateSchema` from `@claude-flow/mcp` and run it in `tools/call` before `callMCPTool`; surface JSON-RPC errors. (d.2, deferred) replace the inline `protocolVersion` literal with the SoT constant. |
| `cli/bin/mcp-server.js` | Same (a)+(b)+(d.2) changes as `bin/cli.js` — this is the second standalone served loop. |
| `cli/src/mcp-server.ts` | (b) add `validateSchema` to the third stdio loop's `tools/call` (`~:632`). Hand-rolled loop is **kept** (Option D deferred). (d.2, deferred) literal → SoT constant. |
| `cli/src/mcp-client.ts` | (b) DELETE the weaker `validateToolInput` helper (`~:270-299`) once all three loops use `validateSchema`. Registry source stays `TOOL_REGISTRY` exposed via `listMCPTools()` (NB: `listMCPTools()` strips handlers — `:217-224` — so it CANNOT bridge a registry into `MCPServer.registerTools`; one reason Option D is deferred, not adopted). |
| `mcp/src/server.ts` | (c) register the 197-tool registry into the HTTP `MCPServer` via `registerTools(...)` (interface `:55`, impl `:292`). (d.1) cherry-pick `d065b2d65`: `protocolVersion` STRUCT (`:91-95`, emitted `:491-496`) → spec date-string. |
| `cli/src/commands/mcp.ts` | (e) keep the aggregator (`mcpServers.ruflo`) as the sole user-facing mount; do not wire the standalone `mcp__agentdb__*` into the served path. |
| `lib/acceptance-harness.sh` (ruflo-patch) | (B7) add an `adr0204` acceptance group + `lib/acceptance-adr0204-*.sh` registering the F-09-011 round-trip gate and the (a)/(b)/(c)/(d.1)/(e) sub-gates; add the group to the `test-acceptance-fast.sh` group list in `CLAUDE.md`. May NOT be `skip_accepted` per [[feedback-skip-accepted-as-squelch]]. |

Suggested commit shape (served-path; Option D NOT in scope):

1. **Commit 1 (a)** — served-bin archivist bootstrap (`bin/cli.js` + `bin/mcp-server.js`), landing after ADR-0202's per-op RVF release. Add the F-09-011 round-trip acceptance gate (spawn the real `npx -y @sparkleideas/ruflo@latest mcp start`, write+readback `memory_store` + `agentdb_hierarchical-store`).
2. **Commit 2 (b)** — `validateSchema` in all three stdio loops' `tools/call`; add the bad-payload acceptance check (assert JSON-RPC validator error); delete `validateToolInput`.
3. **Commit 3 (c)** — register the registry into the HTTP `MCPServer`; assert transport parity (`stdio == http == listMCPTools().length`).
4. **Commit 4 (d.1)** — `git cherry-pick -x d065b2d65`; append the INTEGRATION-LEDGER row; assert the HTTP `protocolVersion` is the spec date-string. **Non-blocking for `implemented`.** ((d.2) stdio-literal centralization → separate wire-protocol-versioning ADR.)

Each commit lands on `main` and is independently verifiable via `npm run release` per [[reference-pipeline-publish-paths]]. **0204 reaches `implemented` only after (a)/(b)/(c)/(e) are green, the F-09-011 gate passes, AND ADR-0202's per-op RVF release is live** (the `depends-on`). (d.1) lands as an in-family follow-up commit; (d.2) is a separate ADR.
