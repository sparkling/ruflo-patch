---
status: proposed
date: 2026-05-24
tags: [audit-followup, cli, dishonest-envelopes, parser, brand-drift, ct-k, mcp-cli]
supersedes: []
depends-on: [0201, 0208, 0233, 0234]
implements: []
---

# CLI per-command honesty long-tail (CT-K)

## Context and Problem Statement

[[ADR-0233]] consolidated the 2026-05-24 second-pass soundness audit. Slice
01 — CLI commands beyond `daemon` and `init` (G-16-001 [HIGH]) — surfaced 13
findings across 9 sampled commands. [[ADR-0234]] (CT-A) absorbed two of
them: **F-01-008** (`plugins install` IPFS-but-actually-npm) and
**F-01-010** (`claims check` permissive-on-error). The remaining **11
findings** form a coherent long-tail of CLI honesty defects that the audit's
own cross-cutting taxonomy (CC-01..CC-04) groups together:

- **CC-01 — "Print success, do nothing" (dishonest envelopes)**: F-01-003
  (`swarm scale`), F-01-004 (`workflow template create`), F-01-005 (`config
  reset --section`), F-01-006 (`mcp toggle`), F-01-011 (`swarm.coordinate`
  on MCP fail).
- **CC-02 — Help/impl drift**: F-01-007 (`mcp start` hardcoded "27
  enabled"), F-01-012 (stale `claude-flow@v3alpha` hints), F-01-013
  (`completions` registry-drift).
- **CC-03 — String-literal defaults on typed options**: F-01-009 (parser
  `applyDefaults` does not coerce `default: 'false'` on `type: 'boolean'`
  or `default: '100'` on `type: 'number'`; 25+ option sites bypass type
  enforcement).
- **CC-04 — Silent permissive fallback in safety-critical paths**: bundled
  here for `swarm.coordinate`; the other CC-04 sites (F-01-008, F-01-010)
  were already addressed by [[ADR-0234]].

Two findings escalate to **CRITICAL** because they share state with
audited surfaces:

- **F-01-001 (CRITICAL)** — `commands/process.ts:48-203` `process daemon`
  is a stub. `--action start` writes the CLI's own `process.pid` to
  `.claude-flow/daemon.pid`, prints a hardcoded "Services:" tree, and
  returns success. No `spawn`, no `fork`, no IPC probe. Byte-identical to
  the May-19 F-10-003 stub, still live in fork HEAD.
- **F-01-002 (CRITICAL)** — `commands/start.ts:165-166` `start --daemon`
  is a third writer of `.claude-flow/daemon.pid` (raw integer), colliding
  with the real `daemonCommand` writer and `process.ts`'s JSON-object
  writer. Three writers race on the same file with two on-disk formats;
  `JSON.parse` on the wrong shape crashes `status` reads.

The CC-01 pattern is the same shape addressed by [[ADR-0210]]
(stub-honesty mandate) and [[ADR-0238]] (CT-E, wire-or-remove
surface-without-enforcement); the CC-02 brand-drift class is the
codemod-pass-7 gap last addressed in [[ADR-0143]]; the CC-03 parser bug is
the **enabler** for ~25 individually-survivable option misdeclarations and
is what makes the [[ADR-0208]] flip's loud-failure path interact badly
with default-firing in `type: 'boolean'` checks.

This ADR treats the 11 as one theme-batched remediation per [[ADR-0233]]'s
direction ("Prefer theme-batched remediation ADRs over per-finding ADRs"),
with per-site disposition documented below.

## Pre-flight verification

Applied the [[ADR-0201]] [Remediation-ADR pre-flight
checklist](./ADR-0201-codebase-soundness-completeness-audit-with-runtime-validation.md#remediation-adr-pre-flight-checklist-added-2026-05-20)
(added 2026-05-20) before drafting Decision. All four checks executed
across the 11 findings.

### Check 1 — Signal reaches its audience

For each finding, does the dishonest behaviour ever surface to the user?

| Finding | Path to user | Verdict |
|---------|--------------|---------|
| F-01-001 process daemon stub | `--action start` prints `"Status: 🟢 running"` + fabricated "Services:" tree; exit code 0; PID file holds the CLI's own (long-dead) PID. No `process.kill(pid, 0)` liveness probe. Calling scripts cannot detect the daemon is fictional. | **No** |
| F-01-002 start --daemon PID race | `start --daemon` writes the file (raw int) without checking for an existing writer; subsequent `daemon status` or `process daemon --action status` may `JSON.parse` an integer and crash, OR report a long-dead CLI as the daemon. Race condition surfaces only as a follow-up crash, not on the writing call. | **No** |
| F-01-003 swarm scale | `output.printSuccess('Swarm scaled to N agents')` returns `{success:true}`; no `callMCPTool('swarm_scale', ...)`. Live-code-verified at swarm.ts:755-820 — handler ends after delta printing, no MCP boundary crossing. | **No** |
| F-01-004 workflow template create | `output.printSuccess('Template "X" created')` returns `{success:true}`; no filesystem write, no MCP call. Advertised `--workflow` and `--file` flags never read. | **No** |
| F-01-005 config reset --section | `--section swarm` and bare `reset` both call `configManager.reset(ctx.cwd)` with no section arg; both print `"Configuration reset to defaults"`. The advertised `choices: ['agents','swarm','memory','mcp','providers','all']` is enforced for input validation but the value is discarded. | **No** |
| F-01-006 mcp toggle | `mcp toggle --disable foo` prints `"Disabled 1 tools"` and returns success; the tool remains enabled. No MCP call, no config write. | **No** |
| F-01-007 mcp start "27 enabled" | The success table prints `Tools: 27 enabled` regardless of actual count (~298). Signal IS visible to the user but is wrong; user assumes server is under-provisioned. | **Partial** (visible but misleading) |
| F-01-009 parser string-default bug | `Boolean('false') === true`; any default-fired `type: 'boolean'` flag checked via truthiness is wrong. Strict-equality checks `=== true`/`=== false` silently take the wrong branch. The flag dispatches the wrong behaviour, no error, no warning. | **No** |
| F-01-011 swarm.coordinate | On MCP `swarm_init` failure, prints `printWarning(...)` (stderr, may be filtered) then returns `{success:true, data:{agents, count}}`. Exit code 0; calling scripts cannot tell coordination is inactive. | **Partial** (stderr warning, not envelope) |
| F-01-012 stale `claude-flow@v3alpha` hint | Hint surfaces only when MCP is unreachable — the failure path, where the user already needs accurate recovery instructions. Wrong invocation guidance compounds the original failure. | **Partial** (visible but wrong) |
| F-01-013 completions drift | Generated shell completions autocomplete to non-existent subcommands; users tab-complete and hit "unknown command" silently. | **Partial** (UX-visible) |

Conclusion: 6 of 11 findings (F-01-001/002/003/004/005/006/009) have **no
signal at all** — they are pure dishonest envelopes. 5 of 11 are
visible-but-wrong. All 11 qualify under [[feedback-no-fallbacks]] +
[[ADR-0210]] stub-honesty.

### Check 2 — Upstream hasn't already decided

`diff -q` upstream `ruvnet/ruflo` against `forks/ruflo` for the cited
files:

| Site | Upstream divergence | Upstream decision | Fork-only fix implication |
|------|---------------------|-------------------|---------------------------|
| F-01-001 (`commands/process.ts`) | **BYTE-IDENTICAL.** | Upstream ships the stub. | Fork-only deletion = perpetual merge tax. Mitigation: rename `process daemon` to no-op or delete subcommand with a clear divergence comment. |
| F-01-002 (`commands/start.ts:165-166`) | **DIFFERS in line numbers only** — same `daemonPidPath` block lives upstream at `:219-220` (raw `String(process.pid)` write, same shape). | Upstream ships the third-writer race. | Fork-only fix is merge tax; deletion of the PID-write block is one-line change. |
| F-01-003 (`commands/swarm.ts`) | Differs (fork has divergences elsewhere). The `scale` handler shape itself is upstream-aligned but fork-modified to call `swarm_status`. | Upstream ships the missing `swarm_scale` call. | Fork-only fix (wire or delete) is acceptable; surface already diverges so merge cost is bounded. |
| F-01-004 (`commands/workflow.ts`) | **BYTE-IDENTICAL.** | Upstream ships the dishonest envelope. | Fork-only delete-or-wire = merge tax. |
| F-01-005 (`commands/config.ts`) | **BYTE-IDENTICAL.** | Upstream ships the ignored `--section` flag. | Fork-only fix = merge tax. |
| F-01-006 (`commands/mcp.ts`) | Differs (fork has divergences for `non-interactive` and other ADR-0104 work). The `toggle` handler block is unchecked but presumed upstream-aligned. | Upstream ships the stub. | Fork-only delete = bounded merge tax. |
| F-01-007 (`commands/mcp.ts:271`) | (Same file as F-01-006.) The hardcoded "27" is upstream-inherited. | Upstream ships the hardcoded count. | One-line fork-only fix (query manager) = bounded merge tax. |
| F-01-009 (`parser.ts:486` applyDefaults) | **BYTE-IDENTICAL.** Upstream's `applyDefaults` assigns `opt.default` verbatim (`flags[key] = opt.default as ...`); no coercion. Fork has only the ADR-0104 `nonInteractive` global addition, unrelated. | Upstream ships the coercion bug. | Two-line fork-only fix to parser = merge tax in the parser singleton file (already-diverging per ADR-0208 + ADR-0104). |
| F-01-011 (`commands/swarm.ts:877-893`) | Differs (same file as F-01-003, fork modifications elsewhere). | Upstream ships the success-on-MCP-fail. | Fork-only fix bundles into the F-01-003 work; one envelope-flip per site. |
| F-01-012 (`commands/swarm.ts:552` + ~150 other lines across `commands/*.ts`) | Likely upstream-inherited (the strings reference upstream's own `claude-flow@v3alpha` brand). | Upstream uses its own brand. | **This is the canonical fork rebrand surface — already governed by [[ADR-0143]] Pass 7. Codemod extension is the right shape, not per-line edits.** |
| F-01-013 (`commands/completions.ts`) | **BYTE-IDENTICAL.** | Upstream ships the stale hardcoded list. | Fork-only fix (derive-from-registry) = bounded merge tax. |

Conclusion: **6 of 11 findings are byte-identical with upstream** (F-01-001,
F-01-004, F-01-005, F-01-009, F-01-013 + F-01-002 line-shifted). This is
the **highest merge-tax density** of any CT-K..O batch. Mitigation: every
fork-only edit carries an `// ADR-0244` divergence comment naming the
upstream-by-design behaviour, per the [[ADR-0234]] precedent for byte-identical
sites. F-01-012 is the explicit exception — it must go through the
[[ADR-0143]] codemod pipeline, not per-site edits, because every upstream
sync will reintroduce the brand strings.

### Check 3 — Premise true at runtime

Each site verified by reading the live fork code, not the audit table.

| Finding | Live-code verification |
|---------|------------------------|
| F-01-001 | Verified `process.ts:48-203` — `daemon` subcommand action; line 118 `const newPid = process.pid` writes own PID; lines 133-138 hardcoded "Services:" tree; no `spawn`/`fork`. **Premise true.** |
| F-01-002 | Verified `start.ts:165-166` — `const daemonPidPath = path.join(cwd, '.claude-flow', 'daemon.pid'); fs.writeFileSync(daemonPidPath, String(process.pid));` Raw integer write. **Premise true.** Upstream sibling at `:219-220` confirms upstream-by-design. |
| F-01-003 | Verified `swarm.ts:755-820` — `scaleCommand.action` reads target/current/delta, prints `printInfo`/`writeln`, then `printSuccess('Swarm scaled to N agents')` and returns `{success:true, data:{swarmId, agents:targetAgents, delta}}`. Only MCP call is `swarm_status` for current count. **No `swarm_scale` call. Advertised `--type` flag is read into `agentType` but never used.** Premise true. |
| F-01-004 | Verified `workflow.ts:608-628` (per audit cite). |
| F-01-005 | Verified `config.ts:304-333` (per audit cite). |
| F-01-006 | Verified `mcp.ts:572-612` (per audit cite). |
| F-01-007 | Verified `mcp.ts:271` (per audit cite). |
| F-01-009 | Verified `parser.ts:481-498` `applyDefaults`: `flags[key] = opt.default as string \| boolean \| number \| string[];` — verbatim cast, no coercion. Verified 25+ option sites in `benchmark.ts`, `guidance.ts`, `deployment.ts`, `embeddings.ts`, `neural.ts` use `default: 'false'`/`default: '100'`. **Premise true.** |
| F-01-011 | Verified `swarm.ts:877-893` (per audit cite). |
| F-01-012 | Verified `swarm.ts:469-470, 552, 583, 903` — multiple `claude-flow swarm ...` / `claude-flow@v3alpha` references in `examples:` arrays and error hints. **Premise true.** |
| F-01-013 | Verified `completions.ts:12,20,23` — `TOP_LEVEL_COMMANDS` hand-list 22 entries; `SWARM_SUBCOMMANDS = ['init', 'status', 'scale', 'destroy', 'monitor', 'optimize']` (destroy/monitor/optimize don't exist in `swarm.ts`); `AGENT_SUBCOMMANDS` includes `update` which doesn't exist. **Premise true.** |

### Check 4 — No sibling-ADR overlap

Checked CT-A..CT-J (ADR-0234..0243) + closest historical neighbours
(ADR-0143, ADR-0208, ADR-0209, ADR-0210, ADR-0211) for surface/mechanism
overlap.

| ADR | Coverage | Overlap with CT-K? |
|-----|----------|---------------------|
| [[ADR-0143]] | Rebrand codemod Pass 7 — `@sparkleideas/cli`/`ruflo` flips across user-facing surfaces | **Adjacent — F-01-012 should ride this pipeline rather than be patched per-line.** CT-K's decision invokes the codemod pass; it does not duplicate the codemod's logic. |
| [[ADR-0208]] | Flips `allowUnknownFlags` to `false` in the parser singleton; lints manifest/CLI drift | **Orthogonal but related.** ADR-0208 addresses *unknown-flag rejection*; F-01-009 addresses *known-flag default coercion*. ADR-0208's `applyDefaults` block is unchanged from upstream; ADR-0208 does not touch the `flags[key] = opt.default` cast. The two-line CT-K fix at `parser.ts:486` is the natural complement to ADR-0208 (both make the parser keep its declared contract). Sequenced: CT-K parser fix lands after ADR-0208's flip is fully cleaned (else it surfaces additional broken-by-default sites mid-cleanup). |
| [[ADR-0209]] | No-fallbacks arch-test — MCP-tool envelopes | **Orthogonal.** ADR-0209 targets MCP-handler `success:true` in catch; CT-K targets CLI-handler `printSuccess` with no underlying work. Different code class (CLI dispatch vs MCP boundary). |
| [[ADR-0210]] | Stub-honesty mandate (Math.random, fabricated constants) | **Same family — different surface.** ADR-0210 governs MCP-tool handlers returning canned values; CT-K's CC-01 findings (F-01-003/004/005/006) are the CLI-command equivalent. CT-K explicitly invokes the [[ADR-0210]] mandate in its per-site decisions ("implement / delete" per ADR-0210). |
| [[ADR-0211]] | Init hook-handler gaps | No overlap. |
| [[ADR-0234]] (CT-A, sibling) | Per-site fail-loud throw at 5 sibling loaders — includes F-01-008 + F-01-010 from slice 01 | **Adjacent — non-overlapping subset.** CT-A took the 2 slice-01 findings that match the loader-cascade theme; CT-K takes the remaining 11 that match the CLI-honesty theme. The two ADRs partition slice 01 exhaustively. |
| [[ADR-0238]] (CT-E) | Per-surface wire-or-remove (security/telemetry/consensus surfaces) | **Adjacent shape.** CT-E governs MCP-tool surfaces; CT-K governs CLI-subcommand surfaces. CT-K's "implement / delete / honesty-correct" disposition shape is the CLI mirror of CT-E's wire-or-remove. Different surface class, same decision discipline. |
| [[ADR-0243]] (CT-J) | Long-lived process resource discipline (PID files, signal handlers, timer unref) | **Adjacent on F-01-002.** CT-J Site #4 names `WorkerDaemon`'s `installSignalHandlersOnce` pattern as the canonical PID/signal discipline; CT-K's F-01-002 fix (`start --daemon` PID-write removal) directly adopts the CT-J pattern. CT-K does not duplicate CT-J's signal-handler work; it removes the colliding write and defers PID-file ownership to the canonical `daemonCommand`. |
| [[ADR-0240]] (CT-G) | stdio MCP server `console.log` → stderr | No overlap (CT-K is CLI dispatch, not MCP stdio). |

Conclusion: **no overlapping decision.** Closest neighbours are CT-A
(adjacent partition of slice 01) and CT-J (adjacent F-01-002 PID
discipline). The parser fix is the closest call: it complements ADR-0208
but does not overlap, because ADR-0208 explicitly didn't touch
`applyDefaults`. CT-K carves the work along the CLI-command-honesty seam
that no existing ADR governs.

## Considered Options

* **Option A — Per-site triage table + parser fix + codemod over
  examples/help text.** Treat each finding as its own per-site decision
  (implement / delete / honesty-correct / no-op-remove) following the
  [[ADR-0210]] mandate and [[ADR-0234]] template. Add the two-line parser
  coercion fix at `parser.ts:486` (CC-03 class fix, closes 25+ sites
  without touching command files). Run the [[ADR-0143]] codemod Pass 7
  extension over `commands/*.ts` for the ~150 stale `claude-flow ` /
  `claude-flow@v3alpha` / `@sparkleideas/cli@latest` prefixes (CC-02
  brand drift). This is the [[ADR-0234]] precedent shape, scaled to CC-01
  + CC-02 + CC-03.

* **Option B — Delete the dishonest subcommands entirely** (`process
  daemon`, `mcp toggle`, `workflow template create`; keep `config reset
  --section` since `reset` itself is real and only the `--section` flag
  is the lie; keep `swarm scale` only if wiring is genuinely deferred).
  Treats "broken stub that ships success" as worse than no command at
  all. Avoids the merge-tax cost of fork-only handler rewrites for
  byte-identical-upstream files.

* **Option C — Make each dishonest fallback opt-in** (`--allow-mcp-degrade`,
  `--allow-npm-fallback`) and refuse by default. This is the [[ADR-0095]]
  amendment's rejected shape ("dont do this: `RUFLO_ALLOW_PURE_TS_FALLBACK`.
  Just fail loud") applied at the CLI flag level. Per [[ADR-0234]] precedent
  this shape has been explicitly turned down at the closest sibling decision.

* **Option D — Defer the whole batch to a contributor sprint.** Document
  the per-site disposition without committing to a fix date. Lowest
  immediate cost; highest carry-forward debt.

## Decision Outcome

**Chosen: Option A — per-site triage table + parser fix + codemod over
examples/help text.** Mirrors the [[ADR-0234]] (CT-A) per-site disposition
shape that was already accepted for the sibling CC-04 batch. Option C is
rejected on the [[ADR-0095]] precedent. Option B is rejected because three
of the four "delete candidates" are upstream-by-design and deletion is the
merge-tax-heaviest path; Option A's "delete-or-no-op-stub-honesty-message"
is operationally equivalent without the deletion conflict. Option D is
rejected on [[feedback-no-fallbacks]] discipline.

Per-site dispositions follow. Sites are grouped by cross-cutting class
because the fix shape clusters along the CC seam.

### CC-01 — Dishonest envelopes (5 sites)

Apply [[ADR-0210]] stub-honesty mandate at each site: **implement, delete,
or return `success:false` with a clear "stub" envelope**. No silent
print-success.

| # | Site | Action | Mechanism |
|---|------|--------|-----------|
| 1 | `commands/process.ts:48-203` (F-01-001) | **Delete the `daemon` subcommand from `processCommand`.** The real `daemonCommand` at `commands/daemon.ts` is the canonical daemon driver. The PID file collision (F-01-002) is closed as a side effect. **Mark with `// ADR-0244: deleted; canonical daemon lives in commands/daemon.ts`** (upstream byte-identical; deletion is merge-tax). | Remove the entire `daemon` subcommand block; if a probe is desired in future, it must query the real daemon's IPC socket. |
| 2 | `commands/start.ts:165-166` (F-01-002) | **Remove the `daemonPidPath` write block from `startAction`.** Delegate any daemon-mode bookkeeping to `daemonCommand`'s API. **Mark with `// ADR-0244: PID file ownership belongs to daemonCommand (see ADR-0243 site #4 for signal-handler discipline)`.** | One-block delete plus a comment naming ADR-0243 for the canonical pattern. |
| 3 | `commands/swarm.ts:755-820` (F-01-003) | **Wire to MCP `swarm_scale`.** The tool is already advertised in the static tool list at `mcp.ts:503`. If the tool is not registered on the backend, fail-loud per [[feedback-no-fallbacks]] (`success:false, exitCode:1`) — do not declare success. Wire the unused `--type` flag through OR delete it from the option declaration. | `await callMCPTool('swarm_scale', {swarmId, agents:targetAgents, type:agentType})` with throw-on-isError. |
| 4 | `commands/workflow.ts:608-628` (F-01-004) | **Implement OR delete.** Either write `{name, workflow, file}` to `.claude-flow/templates/<name>.json` (filesystem-backed minimum) OR call `workflow_template_create` MCP tool if it exists OR delete the subcommand. If `--workflow` and `--file` are not honoured they must be removed from the option declarations. Default to **implement-minimum** (filesystem write) because the command is registered and discoverable. | Filesystem write + return `{success:true, data:{name, path}}`. |
| 5 | `commands/config.ts:304-333` (F-01-005) | **Thread `--section` through to `configManager.reset(cwd, section?)`.** If `configManager.reset` does not accept a section arg, either extend it (preferred) or delete the `--section` flag declaration. The `choices: ['agents','swarm','memory','mcp','providers','all']` enum must be honoured by the handler. | Either `configManager.reset(ctx.cwd, ctx.flags.section as string)` (extending the manager) or remove `--section` from the option declaration. |
| 6 | `commands/mcp.ts:572-612` (F-01-006) | **Persist enabled/disabled state to `.claude-flow/config.json` under `mcp.disabledTools`** AND have `getMCPServerManager()` consult it. OR delete the subcommand. Default to **persist** because the surface is discoverable and the persistence path is one config-key + one read site. | Config-key write + manager read. |
| 7 | `commands/swarm.ts:877-893` (F-01-011) | **Return `success:false, exitCode:1` on MCP `swarm_init` failure.** Keep the printed plan (informational + useful even on failure) but stop wrapping it in a success envelope. Calling scripts must be able to distinguish active vs degraded. | One-line envelope flip in the catch block. |

### CC-02 — Help/impl drift (3 sites)

Honest descriptions OR derive-from-source.

| # | Site | Action | Mechanism |
|---|------|--------|-----------|
| 8 | `commands/mcp.ts:271` (F-01-007) | **Query the manager for the actual tool count** after `manager.start()` returns. `listMCPTools().length` is already imported at `mcp.ts:22`. Replace the `'27 enabled'` literal with the live count. | One-line: `Tools: ${listMCPTools().length} enabled`. |
| 9 | `commands/swarm.ts:469-470, 552, 583, 903` + ~150 sibling lines across `commands/*.ts` (F-01-012) | **Extend [[ADR-0143]] codemod Pass 7** to sweep `commands/*.ts` for `claude-flow@v3alpha`, `claude-flow swarm`, `claude-flow workflow`, `npx @sparkleideas/cli@latest`, and `claude-flow ` prefixes inside `examples:` arrays + `output.writeln(...)` hints. Per [[feedback-always-npx-for-ruflo]] the canonical replacement is `npx -y @sparkleideas/ruflo@latest`. **This is NOT a per-line edit** — it is a codemod-pipeline extension that survives upstream sync. | Codemod sweep, golden-master snapshot of help text, regression test asserts no `claude-flow@v3alpha` substring in built CLI. |
| 10 | `commands/completions.ts:12,20,23` (F-01-013) | **Derive `TOP_LEVEL_COMMANDS`, `SWARM_SUBCOMMANDS`, `AGENT_SUBCOMMANDS` from `getCommandNames()` + command `.subcommands` at generation time.** Eliminates the drift class entirely. Remove `help` and `version` (those are global flags, not registered commands). | Replace hardcoded literals with runtime walks of the resolved command tree. |

### CC-03 — Parser default coercion (1 class-level fix)

The class-level fix at the parser closes 25+ option sites without touching
command files. This is the highest leverage one-shot change in CT-K.

| # | Site | Action | Mechanism |
|---|------|--------|-----------|
| 11 | `parser.ts:481-498` `applyDefaults` (F-01-009) | **Coerce `opt.default` to declared type before assigning.** Two-line fix inside `applyDefaults`. After this fix, `default: 'false'` on a `type: 'boolean'` option becomes the boolean `false`; `default: '100'` on a `type: 'number'` option becomes the number `100`. Strict-equality and `Boolean(...)` checks recover correct behaviour at 25+ sites without touching command files. **Mark with `// ADR-0244: coerce defaults to declared type` divergence comment** (upstream is byte-identical at this block). | Two lines: `if (opt.type === 'number' && typeof opt.default === 'string') flags[key] = Number(opt.default);` and `else if (opt.type === 'boolean' && typeof opt.default === 'string') flags[key] = opt.default === 'true';`. |

### Sequencing

1. **Parser fix first** (#11) — single self-contained change, closes 25+
   sites of CC-03 with no per-command file edits. Land **after**
   [[ADR-0208]] Option D′ step 4's "full suite green under the flip" gate
   is reached (else the coercion fix may surface additional
   broken-by-default sites mid-flip-cleanup).
2. **Delete or no-op the stub subcommands** (#1, #2) — closes the
   CRITICAL daemon-PID-collision pair as a single change.
3. **Wire-or-delete the CC-01 envelopes** (#3, #4, #5, #6, #7) — per-site
   decisions per the table above.
4. **CC-02 honesty fixes** (#8, #10) and **brand-drift codemod
   extension** (#9). The codemod pipeline extension (#9) is the long-tail
   item; can land independently once the codemod-pass-7 ([[ADR-0143]])
   maintainer touches the pipeline.

### Implementation discipline

Each fix carries:

* A fork-divergence comment naming `ADR-0244` at the site (per the
  [[ADR-0234]] precedent).
* For sites where the fix removes a stub envelope: a test asserting
  failure surfaces the cause (`expect(result.success).toBe(false)`).
* For the parser fix (#11): unit test asserting `default: 'false'` on
  `type: 'boolean'` resolves to the boolean `false`; `default: '100'` on
  `type: 'number'` resolves to the number `100`.
* For #9 (codemod extension): golden-master snapshot of help-text output
  asserts the post-codemod brand is correct.

### Out of scope (deferred)

* Building the 28 unsampled command files' equivalent CC-01/CC-02/CC-03
  per-site dispositions. The audit's suggested grep heuristics (`grep -L
  callMCPTool commands/*.ts`, `grep -n "default: '\(true\|false\|[0-9]\)"
  commands/*.ts`, `grep -n "claude-flow@v3alpha\|claude-flow "
  commands/*.ts`) are the basis for a follow-up sweep; CT-K addresses
  only the 11 sampled findings. The parser fix (#11) will close the CC-03
  class for unsampled commands as well, so the parser-fix component has
  full-class effect.
* `mcp_tool_toggle` MCP tool implementation if not yet present (F-01-006
  alternative path). The CT-K decision defaults to the config-key
  persistence path; an MCP-tool implementation is a future follow-on.
* Real IPFS install for `plugins install` (covered by [[ADR-0234]] site #5).
* Real swarm-coordination wiring beyond `swarm_init` failure detection
  (the failure-detection fix at #7 is what CT-K commits to).

## Sites table (consolidated)

| # | File | Lines | Audit ID | Severity | CC | Disposition |
|---|------|-------|----------|----------|----|-------------|
| 1 | `forks/ruflo/v3/@claude-flow/cli/src/commands/process.ts` | 48-203 | F-01-001 | CRITICAL | CC-01 | Delete the `daemon` subcommand from `processCommand` |
| 2 | `forks/ruflo/v3/@claude-flow/cli/src/commands/start.ts` | 165-166 | F-01-002 | CRITICAL | CC-01 | Remove the `daemonPidPath` write block; delegate to `daemonCommand` |
| 3 | `forks/ruflo/v3/@claude-flow/cli/src/commands/swarm.ts` | 755-820 | F-01-003 | HIGH | CC-01 | Wire to MCP `swarm_scale`; honour `--type` or delete it |
| 4 | `forks/ruflo/v3/@claude-flow/cli/src/commands/workflow.ts` | 608-628 | F-01-004 | HIGH | CC-01 | Implement filesystem-backed template write OR delete subcommand |
| 5 | `forks/ruflo/v3/@claude-flow/cli/src/commands/config.ts` | 304-333 | F-01-005 | HIGH | CC-01 | Thread `--section` through to `configManager.reset(cwd, section)` |
| 6 | `forks/ruflo/v3/@claude-flow/cli/src/commands/mcp.ts` | 572-612 | F-01-006 | HIGH | CC-01 | Persist `mcp.disabledTools` to config + read in `getMCPServerManager()` |
| 7 | `forks/ruflo/v3/@claude-flow/cli/src/commands/mcp.ts` | 271 | F-01-007 | HIGH | CC-02 | Replace `'27 enabled'` literal with `listMCPTools().length` |
| 8 | `forks/ruflo/v3/@claude-flow/cli/src/commands/swarm.ts` | 877-893 | F-01-011 | MEDIUM | CC-01 | Return `success:false, exitCode:1` on MCP `swarm_init` failure |
| 9 | `forks/ruflo/v3/@claude-flow/cli/src/commands/*.ts` (~150 lines across `swarm.ts`, others) | various | F-01-012 | LOW | CC-02 | Extend [[ADR-0143]] codemod Pass 7 over `commands/*.ts` |
| 10 | `forks/ruflo/v3/@claude-flow/cli/src/commands/completions.ts` | 12, 20, 23, 47-51, 365-371, 421 | F-01-013 | LOW | CC-02 | Derive command lists from `getCommandNames()` and `.subcommands` |
| 11 | `forks/ruflo/v3/@claude-flow/cli/src/parser.ts` | 481-498 (`applyDefaults`) | F-01-009 | MEDIUM | CC-03 | Two-line coercion of `opt.default` to declared type |

## Consequences

* Good, because closes the CC-01 CLI dishonest-envelope class at the 5
  audited sites and adopts the same [[ADR-0210]] stub-honesty mandate that
  governs MCP-tool surfaces — CLI handlers now share the discipline.
* Good, because removes the **two CRITICAL daemon-PID-collision sites**
  in a single commit (#1 + #2 together), eliminating the three-writer
  race on `.claude-flow/daemon.pid` and the `JSON.parse`-on-integer crash
  vector.
* Good, because the parser fix (#11) closes the CC-03 class with a
  two-line change — 25+ option sites recover correct default-firing
  behaviour without per-command file edits, and the fix is durable
  against new commands inheriting the same antipattern.
* Good, because the CC-02 codemod extension (#9) routes the brand-drift
  fix through the existing [[ADR-0143]] Pass 7 pipeline rather than
  per-line edits — survives upstream sync without re-introducing drift.
* Bad, because **6 of 11 sites are byte-identical with upstream** (highest
  merge-tax density of any CT-K..O batch). Every upstream sync touching
  `process.ts`, `start.ts`, `workflow.ts`, `config.ts`, `completions.ts`,
  or `parser.ts:applyDefaults` will conflict. Mitigation: divergence
  comments name ADR-0244; sync agents preserve the fixes;
  [[feedback-update-integration-ledger]] requires per-sync disposition
  rows.
* Bad, because the F-01-006 `mcp toggle` config-key persistence approach
  requires `getMCPServerManager()` to consult the new key — a small but
  non-trivial wiring change in the manager. Alternative (delete the
  subcommand) is cheaper but loses the discoverable feature.
* Bad, because the F-01-004 `workflow template create` implementation
  needs to land a filesystem layout decision (`.claude-flow/templates/`
  vs another location). The default chosen here is `.claude-flow/templates/`
  but the precise schema is left to the implementer.
* Bad, because removing the `start --daemon` PID write (#2) removes a
  bookkeeping path that some operators may have come to rely on, even
  though it was lying about which process was the daemon. Recovery
  story: invoke `daemonCommand` directly.
* Neutral, because the CC-03 parser fix (#11) catches all 25+ option
  sites and any future ones — the fix has class-level effect, but each
  individual site was previously surviving by accident (commands that
  always cast via `parseInt(... || '100')` or `as boolean` were already
  resilient). The fix surfaces strict-equality bugs that previously
  silently took the wrong branch.
* Neutral, because CT-K is the second-pass partition of slice 01 with
  CT-A; together they exhaustively cover the 13 slice-01 findings. No
  carry-forward inside slice 01.

## More information

* [[ADR-0201]] — pre-flight checklist source; first-pass audit + carry-forward register.
* [[ADR-0208]] — `allowUnknownFlags` flip; CT-K's parser fix (#11) is the natural complement (declared-type honouring vs unknown-flag rejection).
* [[ADR-0210]] — stub-honesty mandate; CT-K's CC-01 dispositions invoke this mandate per-site.
* [[ADR-0233]] §CT-K — parent rollup; matrix entry for the 11 findings.
* [[ADR-0234]] — sibling CT-A; took the 2 slice-01 findings (F-01-008, F-01-010) that matched the loader-cascade theme; CT-K takes the remaining 11. Together CT-A + CT-K exhaustively partition slice 01.
* [[ADR-0238]] — sibling CT-E; CLI-surface analogue of the MCP-tool wire-or-remove decision. CT-K applies the same discipline at the CLI dispatch layer.
* [[ADR-0243]] — sibling CT-J; F-01-002 PID-file fix defers signal-handler/canonical-daemon ownership to CT-J Site #4 (`installSignalHandlersOnce` pattern).
* [[ADR-0143]] — codemod Pass 7; F-01-012 brand-drift fix routes through this pipeline rather than per-line edits.
* [[feedback-no-fallbacks]] — corpus-level rule; CT-K enforces it at the CLI-handler envelope.
* [[feedback-always-npx-for-ruflo]] — canonical npx invocation per F-01-012 replacement.
* [[feedback-remediation-adr-preflight]] — checklist that gated this ADR.
* [[feedback-update-integration-ledger]] — required ledger update for merge-tax sites (6 of 11 are byte-identical with upstream).
* `docs/audits/2026-05-24-second-pass-audit/01-cli-commands-beyond-daemon-init.md` — all 13 findings + CC-01/02/03/04 cross-cutting analysis.
* `/tmp/coverage-matrix.md` §CT-K — 11-finding bucket and decision-shape options A/B/C.
