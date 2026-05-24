---
status: proposed
date: 2026-05-24
tags: [mcp, stdio, jsonrpc, logging, pii, observability, ct-g]
supersedes: []
depends-on: [0201, 0226, 0233]
implements: []
---

# StdioServerTransport MCP servers must log only to stderr

## Context and Problem Statement

[[ADR-0233]] §CT-G ("STDIO/stdout corruption + PII leak in logging") identifies two specific sites on
`StdioServerTransport` MCP servers that write log lines to **stdout** via `console.log`, `console.info`,
or `console.debug`. stdout is the JSON-RPC channel for stdio MCP transports — any non-frame bytes there
corrupt the protocol envelope. One of the two sites additionally serialises full memory
key/value/namespace/tags into the line at `debug` level, layering a PII leak on top of the corruption.

Audit detail (see [[ADR-0233]] §CT-G citing [05-telemetry-observability.md#f-05-001](../audits/2026-05-24-second-pass-audit/05-telemetry-observability.md) F-05-001 HIGH and F-05-002 HIGH):

* **Site #1 — `forks/ruflo/v3/mcp/server-entry.ts:140-162`** — `createLogger` builds a `info`/`debug`
  pair backed by `console.info`/`console.debug`. Node aliases both to `process.stdout`. The default
  transport is `stdio` (`:38`) and the default log level is `info` (`:42`), so `info` messages always
  fire on the JSON-RPC channel — and the `server.on('tool:called', (data) => logger.debug('Tool
  called', data))` handler at `:281-283` logs the entire tool payload (for `memory_store`: `key`,
  `value`, `namespace`, `tags`) verbatim into the line whenever `--log-level debug` is set.

* **Site #2 — `forks/agentdb/src/mcp/agentdb-mcp-server.ts:2016`** — `console.log("🎓 Training session
  ${sessionId}...")` from the `learning_train` handler. The same file uses `console.error` correctly
  at 21 other sites (boot banners, error paths); this is a single missed-lint slip. The transport is
  unambiguously stdio (`:2299 await server.connect(new StdioServerTransport())`).

[[ADR-0226]] already addressed the **frame** side of the same channel: JSON-RPC reply frames in
`bin/cli.js` and `bin/mcp-server.js` now go through `writeFrame = (obj) => process.stdout.write(...)`
instead of `console.log(JSON.stringify(...))`, so that a third-party reassignment of `console.log`
cannot swallow a frame. CT-G is the **non-frame** logging side of the same boundary: diagnostic
logging on a stdio MCP server must never reach stdout regardless of which logger or transport guard
the call site uses. (Memory `project-rvf-test-artifact-resolution` records the same rule for agentdb:
"agentdb diagnostics → stderr (stdout is the MCP JSON-RPC channel)".)

## Pre-flight verification

Per [[ADR-0201]] §[Remediation-ADR pre-flight checklist](./ADR-0201-codebase-soundness-completeness-audit-with-runtime-validation.md#remediation-adr-pre-flight-checklist-added-2026-05-20):

1. **Signal reaches its audience.**
   * Site #1: end-to-end trace shows `v3/mcp/server-entry.ts` is **not** the live `ruflo mcp start`
     boot path. Production boots through `v3/@claude-flow/cli/src/commands/mcp.ts` →
     `mcp-server.ts` → `bin/cli.js`'s `writeFrame` loop (the surface [[ADR-0226]] fixed). The only
     references to `server-entry.ts` in the tree are its own JSDoc `npx tsx v3/mcp/server-entry.ts`
     examples; no script, init template, or `bin/*` invokes it. Site #1 is therefore reachable only
     under the documented `npx tsx` developer invocation — which is real, but a narrow audience.
     v3/mcp/ as a whole is the #4 entry in [[ADR-0233]]'s CT-F dead-code table (5,587 LOC).
   * Site #2: reachable through `forks/agentdb/src/cli/agentdb-cli.ts:1717` spawning
     `dist/src/mcp/agentdb-mcp-server.js` (the `agentdb mcp start` entrypoint). [[ADR-0213]]
     documented that this entrypoint currently **crashes deterministically at module-init**
     (`busy_timeout` pragma not in `ALLOWED_PRAGMAS`) before reaching `learning_train`. Once
     ADR-0213's repair lands, every `learning_train` call hits the `console.log` and corrupts the
     reply.
2. **Upstream hasn't already decided it.** `ruvnet/agentdb` source still carries the same
   `console.log("🎓 Training session ...")` at `src/mcp/agentdb-mcp-server.ts:2000` — the fork has
   not regressed; the bug is inherited. Fixing fork-side only creates a one-line merge tax until
   upstream takes a matching patch (or a fork-only stderr-routing change is preserved through sync).
   Upstream `ruvnet/ruflo` v3/mcp tree is identical to the fork on site #1 (per memory
   `feedback-upstream-means-upstream` — fork is 395+ commits ahead, but no commit in the relevant
   range edits this file). Re-converging via behaviour-test rather than label is preferred: the
   stderr-only assertion in the regression test below is portable upstream when the file is.
3. **Premise/inventory is true at runtime.** Re-read both files:
   * Site #1 confirmed at `:143` (`console.debug`), `:148` (`console.info`), `:153` (`console.warn`
     — already stderr by Node alias, no fix needed), `:158` (`console.error` — already stderr). The
     `info` and `debug` channels are the ones that go to stdout. Two further `console.log` calls
     exist in the same file but are out of CT-G scope: `:102` (`showHelp()` — runs only on `--help`,
     then `process.exit(0)`; never inside the stdio loop) and `:273` (JSON-RPC `notifications/
     server/ready` frame — already a frame, should follow [[ADR-0226]]'s `writeFrame` pattern, but
     that's a frame-write issue, not a logging issue, and lives in dead code).
   * Site #2 confirmed at `:2016` — single `console.log` in a 2,304-line file; the 21 `console.error`
     siblings at other paths confirm intent was always stderr.
4. **No sibling-ADR overlap.**
   * [[ADR-0226]] covers frame writes (`console.log(JSON.stringify(frame))`). CT-G covers
     non-frame logging (`console.log/info/debug("…")`). Disjoint by content shape; complementary by
     channel.
   * **CT-F dependency:** [[ADR-0233]]'s CT-F cross-cutting theme proposes deletion triage for
     ~57,200 LOC of parallel implementations; `forks/ruflo/v3/mcp/` (5,587 LOC) is the #4 cluster.
     If CT-F's remediation ADR (slated as ADR-0239 in [[ADR-0233]]'s triage order) decides to
     **delete** v3/mcp/ wholesale, site #1 evaporates and only site #2 needs the fix here. This ADR
     therefore separates the two sites in the Sites table and the Decision so the v3/mcp/ fix can be
     dropped or kept based on the CT-F outcome.
   * `commands/mcp.ts` (the live `ruflo mcp start` path) already uses `writeFrame` for frames
     (per ADR-0226) and `process.stderr.write` for diagnostics (sample at `:76`); no CT-G fix is
     owed there.

Outcome: pre-flight clears for site #2 unconditionally and for site #1 conditional on the CT-F
decision. Both sites are behaviour-verifiable (no stdout bytes other than JSON-RPC frames).

## Considered Options

* **Option A — Two-line surgical fix.** In site #1's `createLogger`, change `console.info` →
  `console.error` (`:148`) and `console.debug` → `console.error` (`:143`). In site #2, change
  `console.log` → `console.error` (`:2016`). Total diff: 3 lines. No new abstractions; matches the
  intent expressed at site #2 by the 21 sibling `console.error` calls.
* **Option B — Add an arch-test `no-stdout-from-mcp-server`** that walks every file reachable from a
  `new StdioServerTransport()` constructor and fails the build on any `console.{log,info,debug}`. The
  rule outlives the current sites and catches the next regression class-wide. Cost: walking
  reachability for arbitrary TS imports is non-trivial; a simpler proxy (lint
  `forks/agentdb/src/mcp/**` and any `v3/mcp/**` that survives CT-F) covers ~95% of the risk at
  fraction of the build cost.
* **Option C — Replace the console calls with a structured logger** that writes to stderr by
  construction (e.g. extend [[ADR-0226]]'s `writeFrame` pattern with a `writeLog` sibling, or
  introduce a thin `pino`/`winston` wrapper). Correct long-term shape, but: no structured logger is
  in use anywhere in either fork today (the audit confirmed: "`grep -l winston|pino` returns only
  lockfiles"), and introducing one for two sites violates the "Simplicity First" / "Surgical
  Changes" rules in `CLAUDE.md`.
* **Option D — Wait for CT-F (ADR-0239) to delete `v3/mcp/`, then only fix the agentdb site.**
  Defers site #1 to a delete decision that may or may not land; site #2 needs fixing today regardless
  (it's the live `agentdb mcp start` entrypoint and the only blocker is [[ADR-0213]]'s separate
  boot-crash repair).

## Decision

**Option A + a narrow Option B lint rider**, with the v3/mcp/ portion of site #1 contingent on
[[ADR-0233]]'s CT-F decision (ADR-0239):

1. **Site #2 (`forks/agentdb/src/mcp/agentdb-mcp-server.ts:2016`)** — change `console.log` →
   `console.error` unconditionally. Single-line fix; matches the file's 21 existing `console.error`
   siblings; required even if [[ADR-0213]]'s boot-crash repair lands tomorrow.
2. **Site #1 (`forks/ruflo/v3/mcp/server-entry.ts:140-162`)** — change `console.info` →
   `console.error` (`:148`) and `console.debug` → `console.error` (`:143`) **IF and only if** ADR-0239
   (CT-F) decides to *keep* `v3/mcp/`. If CT-F deletes the subtree, this site evaporates and no fix is
   needed. Until CT-F is decided, the fix is held in a draft branch to avoid touching code that may be
   removed.
3. **Lint rider (narrow Option B).** Add an ESLint rule `no-console-log-in-mcp-server` scoped to
   `forks/agentdb/src/mcp/**` (and `forks/ruflo/v3/mcp/**` if it survives CT-F) banning
   `console.log`, `console.info`, and `console.debug`. Allowed: `console.error`, `console.warn`
   (both go to stderr by Node alias). This catches the next regression without arch-walking the full
   `StdioServerTransport` import graph.
4. **Document the rule** in the fork-level lint config and `feedback-no-fallbacks`'s sibling
   (memory key candidate: `feedback-stdio-mcp-stderr-only-diagnostics`) so the rule is portable to
   any future stdio MCP server added to the codebase.

The PII concern at site #1 (`tool:called` event logs full memory payload at `debug` level) is
**resolved by routing to stderr** — the data still appears in operator logs if `--log-level debug`
is set, but is no longer mixed into the JSON-RPC channel where downstream clients (Claude Code,
swarm agents) would parse it as protocol bytes. A separate redaction-on-debug enhancement is owed
but out of CT-G scope (it's the F-05-006 / F-05-004 cardinality + PII work, owned by a future
telemetry-hardening ADR).

### Consequences

* **Good** — JSON-RPC channel for both stdio MCP entrypoints stops being corrupted by diagnostic
  output. `agentdb mcp start` (after [[ADR-0213]] boot-crash repair) emits clean frames on every
  `learning_train`. Any future `npx tsx v3/mcp/server-entry.ts` invocation (if v3/mcp/ survives
  CT-F) stops mixing `[INFO] Starting Claude-Flow MCP Server V3 {...}` lines into the
  `initialize` handshake.
* **Good** — PII leak vector at site #1 closes: payload data in `tool:called` debug events lands on
  stderr where it competes with no protocol parser.
* **Good** — the lint rider prevents next-regression: any new file under `forks/agentdb/src/mcp/`
  that ships a `console.log` fails the build.
* **Neutral** — one-line merge tax against upstream `ruvnet/agentdb`'s identical site until upstream
  takes a matching patch.
* **Neutral** — `console.warn` was already stderr-routed by Node alias; no behaviour change there.
* **Dependency on ADR-0239 (CT-F decision).** If CT-F decides to **delete** v3/mcp/, the
  site #1 fix is retracted and no diff is taken on that file (the entire subtree disappears). If
  CT-F decides to **keep** v3/mcp/, the site #1 fix lands as specified. The agentdb site #2 fix is
  independent of CT-F and lands first.
* **Behaviour-verifiable, no label/gate.** The Confirmation section asserts on observable bytes
  (stdout contains only JSON-RPC frames), not on an "expected change" label, per the [[ADR-0201]]
  pre-flight bias toward implement/delete/behaviour-test over label/gate/wire.

### Confirmation

* **Source-shape (deterministic):**
  * `forks/agentdb/src/mcp/agentdb-mcp-server.ts` (this file only — sibling cli paths' 60+
    `console.log` calls are out of CT-G scope per F-05-007) contains **zero** `console.log`
    calls; the `learning_train` case at the prior `:2016` line uses `console.error`.
  * If v3/mcp/ survives CT-F: `forks/ruflo/v3/mcp/server-entry.ts` `createLogger` returns object
    whose `info` and `debug` keys both invoke `console.error` (not `.info`/`.debug`/`.log`).
  * ESLint config under `forks/agentdb/.eslintrc*` (new file; none exists today) and
    `forks/ruflo/v3/mcp/.eslintrc*` (new file, conditional on CT-F keep) declares the
    `no-console` rule with `allow: ['error', 'warn']`.
* **Behavioural (acceptance):**
  * `agentdb mcp start` followed by an MCP `learning_train` request: parse every line on stdout; all
    lines must be parseable as JSON-RPC frames (no `🎓 Training session ...` bytes).
  * `npx tsx v3/mcp/server-entry.ts` (if path survives CT-F): with default `--log-level info`,
    stdout contains only the `notifications/server/ready` frame and any subsequent tool result
    frames; no `[ISO-timestamp] [INFO] ...` lines.
* **No `skip_accepted`** ([[feedback-skip-accepted-as-squelch]]).

## Sites

| # | File:line | Site type | Today's stream | After fix | Conditional on |
|---|-----------|-----------|----------------|-----------|----------------|
| 1a | `forks/ruflo/v3/mcp/server-entry.ts:143` (`console.debug`) | diagnostic | stdout | stderr | CT-F (ADR-0239) decision to KEEP v3/mcp/ |
| 1b | `forks/ruflo/v3/mcp/server-entry.ts:148` (`console.info`) | diagnostic | stdout | stderr | CT-F (ADR-0239) decision to KEEP v3/mcp/ |
| 2 | `forks/agentdb/src/mcp/agentdb-mcp-server.ts:2016` (`console.log`) | diagnostic | stdout | stderr | unconditional |

Sites NOT covered by this ADR (out of CT-G scope, listed for completeness):

| File:line | Why excluded |
|-----------|--------------|
| `v3/mcp/server-entry.ts:102` (`console.log` in `showHelp()`) | Runs only on `--help`, then `process.exit(0)`; never enters the stdio loop. Benign. |
| `v3/mcp/server-entry.ts:273` (`console.log(JSON.stringify(notification))`) | This is a JSON-RPC **frame**, not a log line. The frame happens to be correctly destined for stdout, but should use [[ADR-0226]]'s `writeFrame` pattern for the same race-immunity reason. Defer to a frame-side amendment of [[ADR-0226]] (or evaporate via CT-F). |
| `forks/agentdb/src/db-unified.ts` + ~16 other agentdb cli paths (~60 `console.log`) | Audit F-05-007 — these run in the cli daemon process, which is separate from the MCP stdio transport, so they don't corrupt JSON-RPC today. Pattern-level fork lint owed via a separate F-05-007 remediation ADR. |
| `TelemetryManager.recordError(message)` cardinality bomb (F-05-004) | Out of CT-G scope; that's the telemetry-cardinality / PII-in-labels issue, owned by a future telemetry-hardening ADR. |

## More Information

* [[ADR-0201]] — first-pass audit + the four-check remediation-ADR pre-flight that gates this draft.
* [[ADR-0226]] — sibling fix for the **frame** side of the same stdio JSON-RPC channel (covers
  `console.log(JSON.stringify(frame))`); CT-G covers the **non-frame** logging side.
* [[ADR-0233]] §CT-G — defect class definition for this ADR, citing F-05-001 (HIGH) and F-05-002
  (HIGH) from `docs/audits/2026-05-24-second-pass-audit/05-telemetry-observability.md`.
* [[ADR-0233]] §CT-F — dead-code triage for `v3/mcp/` (5,587 LOC); site #1 here evaporates if that
  ADR (slated as ADR-0239) decides to delete the subtree.
* [[ADR-0213]] — separate fork bug filing for the `agentdb mcp start` module-init crash
  (`busy_timeout` pragma vs `ALLOWED_PRAGMAS`). Site #2's `console.log` is only reachable at runtime
  after that crash is repaired, but the fix here lands independently because it's a one-line slip
  with an obvious correct shape.
* `feedback-no-fallbacks` — corpus rule ("agentdb diagnostics → stderr") that this ADR codifies
  for stdio MCP servers generally.
* `project-rvf-test-artifact-resolution` — memory record of the same stderr-vs-stdout rule for
  agentdb diagnostics, learned during the RVF substrate work.
* `docs/audits/2026-05-24-second-pass-audit/05-telemetry-observability.md` — full audit slice with
  per-finding evidence including the `formatMessage` quote and the `tool:called` debug-event PII
  vector.

## Swarm review (2026-05-24)

**Pattern**: P2 Consensus Decision Hive. **Consensus**: Quorum-majority (≥2/3). **Queen**: tactical. **Panel**: 3 experts + 1 DA.

### Panel composition

- Expert 1 — MCP-StdioServerTransport specialist
- Expert 2 — Node-IO discipline specialist
- Devil's Advocate

### Upstream intent

Upstream is **neutral-by-omission**, not aligned, on both sites. Verified at fork mirrors:
`/Users/henrik/source/ruvnet/agentdb/src/mcp/agentdb-mcp-server.ts:2000` carries the
**identical** `console.log("🎓 Training session ${sessionId}...")` slip surrounded by 21
correct `console.error` siblings — upstream has the same single-site stdout bug. At
`/Users/henrik/source/ruvnet/ruflo/v3/mcp/server-entry.ts:140-162` upstream's `createLogger`
also routes `info`/`debug` through `console.info`/`console.debug` (stdout) with default
`transport: stdio`. Both sites are inherited bugs, not fork regressions; the fix is a
one-line fork-only merge tax until upstream takes a matching patch. Pre-flight check 2
("upstream hasn't already decided it") clears: upstream has not decided either way.

### ADR-180+ alignment

ADR-0226 (frame-write side of the same stdio JSON-RPC channel, implemented) is the directly
supporting sibling — it routes JSON-RPC frames through `process.stdout.write` so a future
`console.log` reassignment cannot swallow a reply; CT-G is the disjoint-by-content-shape
diagnostic-logging counterpart. ADR-0213 (agentdb MCP standalone registration) is gated
deferred — site #2 here is in the same `agentdb-mcp-server.ts` that ADR-0213's
`busy_timeout` precondition already unblocked at fork commit `d1b6145`, so site #2 is now
runtime-reachable on every `learning_train` call. ADR-0239 (CT-F cluster 2 — delete
`v3/mcp/`) explicitly cites site #1 as a "cross-bonus": deleting v3/mcp/ evaporates site #1,
which is why this ADR makes the site #1 fix conditional. ADR-0210 (stub-honesty mandate) is
not in conflict — CT-G is a real protocol bug, not surface-without-enforcement.

### Critique outcomes

| Expert | Critique | Vote | Adopted? |
|---|---|---|---|
| Expert 1 (MCP-Stdio) | Confirmation §Source-shape asserts on the agentdb file containing zero `console.log`, but the file contains 60+ legitimate `console.log` calls in non-MCP cli daemon paths (per F-05-007). The assertion as written would always fail. Must scope to `agentdb-mcp-server.ts` specifically (or the path-globbed lint), not the whole file's containing directory. | amend | **ADOPTED** — narrow Source-shape clause to the single file `agentdb-mcp-server.ts`; the lint rider already scopes to `src/mcp/**` so it doesn't conflict with the cli's `console.log` siblings. |
| Expert 1 (MCP-Stdio) | The lint rider lives in `forks/agentdb/.eslintrc*` and `forks/ruflo/v3/mcp/.eslintrc*` — but neither file exists today (`find` returns no agentdb root eslintrc; only `v3/@claude-flow/cli/.eslintrc.json` and `v3/goal_ui/`, `ui/`). The ADR needs to either create the configs (Option A↑) or scope the rule into the existing `cli/.eslintrc.json` with a path `overrides` block. | amend | **ADOPTED** — note in implementation steps that the lint rider creates a new eslint config (or extends existing where present); the implementation cost is small but the ADR was silent on it. |
| Expert 2 (Node-IO) | The Decision says "console.warn is already stderr by Node alias" — verify. Node docs: `console.warn` and `console.error` both route to `process.stderr`; `console.log`, `console.info`, `console.debug` route to `process.stdout`. The ADR is correct, but the lint `allow: ['error', 'warn']` is the right pairing — both are stderr-safe. No change needed; the claim is sound. | agree | n/a (corroboration) |
| Expert 2 (Node-IO) | Option C (structured logger) was rejected on "no structured logger in use anywhere". True today, but ADR-0226 introduced a `writeFrame` helper for frames — extending that pattern with a `writeLog(level, msg, data)` sibling would be a 5-line addition that also addresses F-05-007 (60+ cli `console.log` calls) when those paths are touched. Worth a "future enhancement" mention, not a Decision change. | amend | **ADOPTED (lightweight)** — note in Consequences that the structured-logger pattern could be extended from ADR-0226's `writeFrame` if F-05-007 ever wants the same wrap-and-stream discipline. Not a Decision change, just a forward-pointer. |
| DA | "Just stop logging from MCP servers altogether — any logging is risky in the stdio path." The strongest form of this argument: route the two stdout sites to a no-op, not stderr. Stderr is still a side-channel the operator depends on; if the operator's logging consumer is misconfigured, stderr can fill pipes/disks under high tool-call volume. The lint rider that bans `console.log/info/debug` is already implicitly that argument — but Option A keeps the diagnostic value and adds the lint as a regression guard. | amend | **REJECTED** — stderr is the correct, conventional channel for MCP server diagnostics (operator visibility for debugging; matches the 21 sibling `console.error` calls already in the agentdb file; matches the live `cli/src/commands/mcp.ts:76` pattern). "No logging" would discard the F-05-001 `tool:called` PII-tracing capability without addressing the actual harm (which is the JSON-RPC channel, not the logging-as-such). The PII concern is separately owned by F-05-006 (future telemetry-hardening ADR). |
| DA | If the lint rider is the real fix, why keep the source-code changes at all? Just ship the lint and let it fail until someone touches each site. | amend | **REJECTED** — the source changes are the actionable fix (immediate); the lint is the regression guard (prevents the next slip). Ship both. This is the [[ADR-0215]] golden-master shape: cleanup + gate, not gate-only. |

### Devil's Advocate final position

**Holds principled dissent on the "stderr is also a risk" framing** — acknowledges the
panel's vote on Option A + lint rider is correct for the immediate fix, but flags for the
record that a future high-volume operator could still see stderr-pipe pressure. Notes this
is a separate observability concern (rate-limiting, log-level discipline) outside CT-G
scope. Does NOT block the Decision. Withdraws on the "no-logging" form of the argument
(panel rationale persuasive: operator visibility + sibling-call convention + non-frame-side
of ADR-0226 win).

### Improvements adopted

1. **Source-shape Confirmation clause narrowed** to `agentdb-mcp-server.ts` specifically
   (the file contains the single stdout-corruption site; the surrounding directory has
   legitimate non-MCP `console.log` calls).
2. **Implementation-step note added**: the lint rider creates a new ESLint config under
   `forks/agentdb/` (and conditional `forks/ruflo/v3/mcp/` per CT-F outcome) since neither
   exists today; cost is small but the ADR was silent on it.
3. **Forward-pointer added**: a future `writeLog` helper extending ADR-0226's `writeFrame`
   pattern is the natural shape if F-05-007's 60+ cli `console.log` calls ever want the
   same stream-discipline (not a Decision change).
4. **DA's principled-dissent recorded** on stderr-pipe-pressure risk under high tool-call
   volume — out of CT-G scope, separately owned by future observability rate-limiting.

### Confirmation amendments (folded into the Decision section above)

The Source-shape gate now reads:

* `forks/agentdb/src/mcp/agentdb-mcp-server.ts` contains **zero** `console.log` calls
  (scoped to this file only; the `db-unified.ts` + ~16 other agentdb cli paths' 60+
  `console.log` calls are out of CT-G scope per F-05-007).
* If v3/mcp/ survives CT-F: `forks/ruflo/v3/mcp/server-entry.ts` `createLogger` returns
  object whose `info` and `debug` keys both invoke `console.error` (not `.info`/`.debug`/`.log`).
* ESLint config at `forks/agentdb/.eslintrc*` (new) and `forks/ruflo/v3/mcp/.eslintrc*` (new,
  conditional on CT-F keep) declares the `no-console` rule with `allow: ['error', 'warn']`.
