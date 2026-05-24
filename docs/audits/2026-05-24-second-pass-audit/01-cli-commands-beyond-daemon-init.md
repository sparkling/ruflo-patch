# 01 — CLI commands beyond `daemon` and `init` (second-pass)

**Parent**: G-16-001 in [`16-gap-analysis.md`](../2026-05-19-soundness-audit/16-gap-analysis.md) (HIGH priority next-pass scope)
**Sibling reference**: [`10-daemon.md`](../2026-05-19-soundness-audit/10-daemon.md)
**Date**: 2026-05-24
**Method**: Read-only enumeration of the CLI command registry + targeted sampling. 9 commands sampled (`memory`, `swarm`, `mcp`, `plugins`, `workflow`, `agent`, `config`, `claims`, `process`) plus skim of `benchmark`, `completions`, `neural`, `start`, `verify`, `security`, `task`, `route`, `migrate`, `hive-mind`.

---

## Severity legend

- **CRITICAL** — Silently returns success on operations that did nothing OR corrupts state shared with audited surfaces.
- **HIGH** — Dishonest envelope (success without underlying work), state-mutating stub, or help/impl drift that misleads users.
- **MEDIUM** — Type-correctness bug, swallowed error, or fake-data fallback that survives into user-visible output.
- **LOW** — Pattern smell or stale reference that doesn't break behaviour by itself but compounds with other findings.

---

## Summary

The CLI registers 45 commands beyond `daemon`/`init`; 23 are eagerly loaded into the synchronous `commandRegistry`, the remainder are lazy-loaded via `commandLoaders`. Sampling 9 of those across mixed-use surfaces (memory, swarm, mcp, plugins, workflow, agent, config, claims, process) found 13 soundness defects — the same recurring failure modes from the May-19 audit (silent fallbacks, dishonest envelopes, manifest/impl drift) appear across every sampled command except `memory` and `agent` (which both call through the MCP/router boundary correctly and surface failures honestly). The single most important finding is that the `process daemon` stub flagged as F-10-003 in the May-19 audit is **still live** in `forks/ruflo` and is now joined by a third writer of the `.claude-flow/daemon.pid` file in `start --daemon`. ADR-0208's flip of `allowUnknownFlags` to `false` fixed the global parser permissiveness, but a widespread defaults antipattern (string `'true'` / `'false'` / `'100'` declared as defaults on `type: 'boolean'` / `type: 'number'` options) means the parser stores literal strings as flag values — boolean-as-string survives any cast and trips strict-equality checks.

**Subcommand tally (45 commands beyond `daemon`/`init`):**

| Category | Commands | Count |
|---|---|---|
| Core (sync-loaded) | start, status, task, session, agent, swarm, memory, mcp, hooks, doctor, embeddings, neural, performance, security, ruvector, hive-mind, guidance, cleanup, autopilot, skill, wizard | 21 |
| Advanced (lazy) | config, migrate, workflow, hive-mind-session, process, neural, providers, plugins, deployment, claims, completions, analyze, route, progress, issues, update, benchmark, appliance, appliance-advanced, transfer-store, verify | 21 |
| Aliases | skills (→ skill), wizard (→ init) | 2 + duplicates |

(Total counted from `commandLoaders` keys minus `init`/`daemon`/`wizard`; aliases in `commandRegistry` not double-counted.)

**Severity counts**: 2 CRITICAL · 5 HIGH · 4 MEDIUM · 2 LOW = 13 findings

---

## Findings

### F-01-001 [CRITICAL] `process daemon` stub still ships — confirmed unfixed since May-19 F-10-003
- Location: `/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/commands/process.ts:48-203`
- Issue: The standalone `process` command's `daemon` subcommand is byte-identical to the stub flagged as F-10-003 in the May-19 audit. `--action start` writes the CLI's own `process.pid` (line 118: `const newPid = process.pid;`) to `.claude-flow/daemon.pid`, then prints a hardcoded "Services:" tree (lines 133-138: `MCP Server: listening, Agent Pool: initialized (0 agents), Memory Service: connected, Task Queue: ready, Swarm Coordinator: standby`) regardless of whether any of those services exist. `--action status` reads the PID file and prints `"Status: 🟢 running"` if it parses — without `process.kill(pid, 0)` liveness check. No `spawn` or `fork` anywhere in this file (only `workers --action spawn`, unrelated).
- Recommendation: Either delete `processCommand.daemon` outright (the real `daemonCommand` is at `commands/daemon.ts`) or rename its PID file to `.claude-flow/process-daemon.pid` to stop colliding with the real daemon's PID. The fabricated Services tree must be removed; if a probe is wanted, query the real daemon's IPC socket and surface real state.

### F-01-002 [CRITICAL] `start --daemon` is a third writer of `.claude-flow/daemon.pid`
- Location: `/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/commands/start.ts:165-166`
- Issue: `startAction` writes `process.pid` to `.claude-flow/daemon.pid`:
  ```ts
  const daemonPidPath = path.join(cwd, '.claude-flow', 'daemon.pid');
  fs.writeFileSync(daemonPidPath, String(process.pid));
  ```
  This collides with both (a) the real `daemonCommand` PID writer and (b) `process daemon`'s PID writer (F-01-001). Three commands all writing the same PID file means the file's value depends on whichever ran last — and the on-disk format differs (raw integer here, JSON object `{pid, port, startedAt}` in `process.ts:17`). The next `daemon status` or `process daemon --action status` may crash on JSON.parse, or report a long-dead CLI as the daemon.
- Recommendation: `start` should not write any daemon PID file. If it wants daemon-mode bookkeeping it should call into the real daemon manager via `daemonCommand` or its API, not bypass it. At minimum, normalise the on-disk format across all writers and use `process.kill(pid, 0)` to validate the PID is live before reporting status.

### F-01-003 [HIGH] `swarm scale` is a dishonest envelope — no MCP `swarm_scale` call
- Location: `/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/commands/swarm.ts:755-816`
- Issue: The handler calls `swarm_status` to read current agent count, computes a delta, prints `"Spawning N new agents..."` (line 804) or `"Gracefully stopping N agents..."` (line 806), then unconditionally calls `output.printSuccess('Swarm scaled to N agents')` and returns `{ success: true, data: { swarmId, agents: targetAgents, delta } }`. There is no `callMCPTool('swarm_scale', ...)`. The advertised `--type` flag (line 769) is read into `agentType` but never used.
- Recommendation: Wire to the `swarm_scale` MCP tool (the static tool list at `mcp.ts:503` advertises it). If the tool doesn't exist on the backend, fail loud per [[feedback-no-fallbacks]] instead of declaring success.

### F-01-004 [HIGH] `workflow template create` is a pure dishonest envelope
- Location: `/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/commands/workflow.ts:608-628`
- Issue: The `create` subcommand declares `--name`, `--workflow`, `--file` options (lines 611-613), then in its action reads only `name`, validates it's present, prints `output.printSuccess('Template "${name}" created')`, and returns success. No file write, no MCP call, no registration anywhere. The user gets told their template was created — it was not.
- Recommendation: Either implement (write to `.claude-flow/templates/<name>.json` or similar, OR call `workflow_template_create` MCP tool) or remove the subcommand. If kept, `--workflow` and `--file` flag declarations must be honoured or removed.

### F-01-005 [HIGH] `config reset --section` ignores the `--section` flag
- Location: `/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/commands/config.ts:304-333`
- Issue: The `reset` subcommand declares a `--section` flag with `choices: ['agents', 'swarm', 'memory', 'mcp', 'providers', 'all']` (lines 316-320). The handler does `configManager.reset(ctx.cwd)` with no section argument — `--section swarm` resets the entire config, same as bare `reset`. User-visible output prints `"Configuration reset to defaults"` either way.
- Recommendation: Either thread the section through to `configManager.reset(cwd, section?)` or remove the `--section` flag declaration.

### F-01-006 [HIGH] `mcp toggle` is a stub that prints success without changing any state
- Location: `/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/commands/mcp.ts:572-612`
- Issue: `mcp toggle --enable foo,bar` runs:
  ```ts
  const tools = toEnable.split(',');
  output.printInfo(`Enabling tools: ${tools.join(', ')}`);
  output.printSuccess(`Enabled ${tools.length} tools`);
  ```
  No call to the MCP server, no config write, no tool-registry mutation. `--disable` path is identical. Users running `ruflo mcp toggle --disable hooks_pretrain` will see "Disabled 1 tools" and the tool remains enabled.
- Recommendation: Wire to a real `mcp_tool_toggle` MCP method, OR persist enabled/disabled state to `.claude-flow/config.json` under `mcp.disabledTools` and have `getMCPServerManager()` consult it. If neither path is taken, delete the subcommand.

### F-01-007 [HIGH] `mcp start` hardcodes "27 enabled" in the success table regardless of actual tool count
- Location: `/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/commands/mcp.ts:271`
- Issue: The post-start table reports `Tools: !tools || tools === 'all' ? '27 enabled' : '${tools.split(',').length} enabled'`. The May-19 audit established the MCP server advertises 298+ tools (agent 12 saw 298 listable; agent 08 counted 327 distinct handlers). "27" is a stale number from an early V3 prototype. Users see "27 enabled" and assume the server is under-provisioned.
- Recommendation: Query the manager for the actual registered tool count after `manager.start()` returns and emit that. Cheap: `listMCPTools().length` (already imported at `mcp.ts:22`).

### F-01-008 [HIGH] `plugins install` claims to use IPFS but actually installs from npm
- Location: `/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/commands/plugins.ts:217-350`
- Issue: The command description on line 220 says `"Install a plugin from IPFS registry or local path"`. The handler does call `createPluginDiscoveryService()` to fetch registry metadata, but then on line 313 falls through with the comment `// Install from npm (since IPFS is demo mode)` and calls `manager.installFromNpm(name, ...)`. The "Source:" line in the success box (line 329) reads `installed.source` (which will be `npm`), but the headline command description, all five `list` subcommand examples, and the registry-discovery spinner all claim IPFS is the source of truth. There is no `--source npm` opt-in or `--source ipfs` opt-out; the user has no signal that the IPFS surface is theatrical.
- Recommendation: Either implement IPFS install (this is what users opted into by trusting the registry's CID + checksum fields shown by `plugins info`) or remove the IPFS prose from descriptions/help. The current state is a silent fallback that masks a missing feature — direct [[feedback-no-fallbacks]] violation.

### F-01-009 [MEDIUM] String defaults on `type: 'number'` / `type: 'boolean'` options bypass coercion
- Location: Widespread — `benchmark.ts:22-26,92-95,251,377`; `daemon.ts:937-939`; `deployment.ts:305,403,579`; `embeddings.ts:119-120,483-484`; `guidance.ts:29,108,110,205,294,353,355-357,473`; `neural.ts:17,20-28`; `parser.ts:486` (the bug enabler)
- Issue: Many option declarations use `default: '100'` (string) on `type: 'number'` flags and `default: 'false'` (string) on `type: 'boolean'` flags. `parser.ts:481-498` (`applyDefaults`) assigns `opt.default` verbatim:
  ```ts
  if (flags[key] === undefined && opt.default !== undefined) {
    flags[key] = opt.default as string | boolean | number | string[];
  }
  ```
  No type coercion runs. Consequences:
  - `ctx.flags.verbose === true` (benchmark.ts:38) is **always false** when the default fires — `'false' !== true`.
  - Worse: any check using truthiness (`ctx.flags.verbose as boolean`) on a `default: 'false'` flag is **always truthy** because `Boolean('false') === true`.
  - `parseInt(ctx.flags.iterations as string || '100', 10)` (benchmark.ts:34) works by accident because the value is already a string.
  Behavioural drift is silent — the flag has the wrong type, but commands that always do their own `parseInt`/`as boolean` casts don't notice. Commands that compare strictly (e.g. `=== true`, `=== false`) will silently take the wrong branch when the default fires.
- Recommendation: Two-line fix in the parser — coerce defaults to declared type in `applyDefaults`, OR audit + fix all 25+ option sites. The parser fix is cheaper and catches future cases. Pattern test: any string-literal default on a non-string option type.

### F-01-010 [MEDIUM] `claims check` falls back to permissive policy on error and silently grants non-admin claims
- Location: `/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/commands/claims.ts:265-271`
- Issue: When the policy-file load throws, the catch block does:
  ```ts
  isGranted = !claim.startsWith('admin:');
  reason = isGranted ? 'Granted (default permissive policy)' : 'Admin claims require explicit grant';
  policySource = 'fallback';
  ```
  Any non-`admin:`-prefixed claim is granted. The user-visible output still prints `Result: GRANTED` and `Policy: fallback` in the same green-tick box used for legitimately granted claims; the only hint is the word "fallback" in the dim policy line.
- Recommendation: On policy-load failure, refuse the check and exit non-zero. A failing policy load is a configuration error; silently swapping in `!claim.startsWith('admin:')` is a permission-system [[feedback-no-fallbacks]] violation with security implications.

### F-01-011 [MEDIUM] `swarm.coordinate` returns success when MCP `swarm_init` fails — degrades silently to "agent plan only"
- Location: `/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/commands/swarm.ts:877-893`
- Issue: After printing the 15-agent V3 plan, the handler calls `swarm_init` and catches with `output.printWarning('MCP unavailable — showing agent plan only (no active coordination)')`, then returns `{ success: true, data: { agents: v3Agents, count: agentCount } }`. The user gets a success exit code, a printed plan, and no active swarm — calling scripts can't tell the difference.
- Recommendation: When MCP fails, return `success: false, exitCode: 1`. Printing the plan is informational and fine; the success envelope is the lie.

### F-01-012 [LOW] `swarm.start` hint string still references `claude-flow@v3alpha`
- Location: `/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/commands/swarm.ts:552`
- Issue: On MCP failure, the suggestion text is `"Start it with: claude mcp add claude-flow npx claude-flow@v3alpha mcp start"`. This violates [[feedback-always-npx-for-ruflo]] (must use `npx -y @sparkleideas/ruflo@latest mcp start`) and was already flagged for the init command as F-11-H13 in the May-19 audit; the same stale guidance leaks out of every other command's error hints. Status messages in `swarm.ts:611-612` use `npx @sparkleideas/cli@latest swarm init` — the wrong package per [[reference-user-facing-brand]] (should be the ruflo wrapper).
- Recommendation: Single-pass codemod over `commands/*.ts` for `claude-flow@v3alpha`, `npx @sparkleideas/cli@latest`, and `claude-flow ` prefixes in `examples:` blocks and error messages. The `examples:` arrays alone contain ~150 outdated `claude-flow ` prefixes across the registry.

### F-01-013 [LOW] `completions` top-level command list is out of sync with `commandRegistry`
- Location: `/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/commands/completions.ts:12-35`
- Issue: `TOP_LEVEL_COMMANDS` (line 12-17) hand-lists 22 commands and is missing 14 real registered commands (`init`, `wizard`, `start`, `status`, `mcp`, `process`, `migrate`, `analyze`, `route`, `progress`, `issues`, `update`, `ruvector`, `benchmark`, `guidance`, `appliance`, `appliance-advanced`, `transfer-store`, `cleanup`, `autopilot`, `skill`, `verify`). It also lists `help` (a built-in flag, not a registered command) and `version` (same). Subcommand lists drift too: `SWARM_SUBCOMMANDS` (line 20) lists `destroy`, `monitor`, `optimize` which don't exist in `swarm.ts`; the real subcommands are `init`, `start`, `status`, `stop`, `scale`, `coordinate`. `AGENT_SUBCOMMANDS` (line 23) lists `update` which doesn't exist; real ones include `metrics`, `pool`, `health`, `wasm-*`. Generated shell completions will autocomplete to non-existent subcommands.
- Recommendation: Derive `TOP_LEVEL_COMMANDS` and subcommand lists from `getCommandNames()` and command `.subcommands` at generation time, not hardcoded literals. Eliminates the drift class entirely.

---

## Cross-cutting patterns

Four issue classes appear across multiple commands. Each suggests a systemic fix rather than per-command patches.

### CC-01 — "Print success, do nothing" subcommands ("dishonest envelope")
Confirmed in:
- `swarm scale` (F-01-003): no `swarm_scale` MCP call
- `workflow template create` (F-01-004): no template write
- `config reset --section` (F-01-005): `--section` ignored
- `mcp toggle` (F-01-006): no state change
- `swarm.coordinate` on MCP failure (F-01-011): success envelope wraps inactive state

This is the same pattern the May-19 audit catalogued for the hooks subsystem (F-02-* stubs, F-03-* fake-data stubs, F-07 `SyncCoordinator.resolveConflicts` empty merge). The pattern's signature: handler declares options, validates `name`/`id` presence, prints a green-tick success line, returns `success: true` with a fabricated or echoed-back payload, and never reaches the MCP boundary or filesystem. Suggested cross-cutting fix: every subcommand should either call out to a real tool/file OR be marked with `_stub: true` in its returned data (per the May-19 recommendation #2 in `00-README.md`), so callers can detect the no-op.

### CC-02 — Help/impl drift across description, examples, and completions
Confirmed in:
- `plugins install`: description says "IPFS registry" but installs from npm (F-01-008)
- `mcp start`: hardcoded "27 tools" vs ~298 actual (F-01-007)
- `swarm.start` and `swarm status` print stale `claude-flow@v3alpha` / `@sparkleideas/cli@latest` hints (F-01-012)
- `completions` lists non-existent commands and subcommands (F-01-013)

Pattern: hand-maintained strings in `description`, `examples`, and `output.printInfo(...)` fall behind code changes. Suggested fix: a golden-master test that runs `ruflo --help` and each subcommand's `--help`, snapshots the output, and fails when descriptions reference packages or counts that the runtime can verify. Cheap to add for the count drift (`mcp start` could ask the manager); the package-rename drift wants a `git grep claude-flow@v3alpha` lint.

### CC-03 — String-literal defaults on typed options (parser does not coerce)
F-01-009 is the worst single instance but reflects a parser contract bug. `parser.ts:486` assigns `opt.default` to `flags[key]` verbatim. With 25+ option-site instances of `default: 'true' | 'false' | '<number-as-string>'`, the parser is effectively unenforced for default-flag types. Suggested fix: two lines in `applyDefaults`:
```ts
if (opt.type === 'number' && typeof opt.default === 'string') flags[key] = Number(opt.default);
else if (opt.type === 'boolean' && typeof opt.default === 'string') flags[key] = opt.default === 'true';
else flags[key] = opt.default;
```
Catches all 25+ sites without touching command files. The 5 commands with the most instances (`benchmark.ts`, `guidance.ts`, `deployment.ts`, `embeddings.ts`, `neural.ts`) are the ones most at risk of silent strict-equality bugs.

### CC-04 — Silent permissive fallback in safety-critical paths
- `claims check` falls back to permissive default on policy load failure (F-01-010)
- `swarm.coordinate` returns success when MCP unavailable (F-01-011)
- `plugins install` falls back to npm without telling the user IPFS path is mock (F-01-008)

Pattern: a critical operation (authorisation check, coordination init, signed registry install) silently degrades when its primary path fails. All three violate [[feedback-no-fallbacks]] explicitly. Suggested fix: make each fallback an opt-in flag (`--allow-npm-fallback`, `--allow-mcp-degrade`, `--allow-permissive-fallback`) and refuse by default.

---

## Out-of-scope

The following were intentionally not audited in this slice — they belong to other G-16 gap entries:

- `daemon` and `init` subcommands — covered by May-19 audit files 10, 11, 12.
- Plugin contents (per-plugin code) — G-16-002.
- AgentDB internals beneath the controller boundary — G-16-004.
- Security MCP-tool implementations (`aidefence_*`) — G-16-005, only the CLI `security` command was skim-checked here.
- Telemetry / observability surfaces — G-16-006.
- WASM / NAPI bridges and `agent-wasm` command's underlying runtime — G-16-007.
- Embedding pipeline below `routeEmbeddingOp` — G-16-008.
- `neural` / `ruvllm` deep internals — G-16-009.
- Hive-mind consensus protocols (CLI surface only skimmed, runtime not exercised) — G-16-010.
- The 28 commands not sampled (sample size 9 of 45). The four cross-cutting patterns above are likely to apply to most of the unsampled set; a follow-up slice could enumerate per-command verdicts using grep heuristics:
  - `grep -L callMCPTool commands/*.ts` for "no MCP call" stubs
  - `grep -n "default: '\(true\|false\|[0-9]\)" commands/*.ts` for CC-03 instances
  - `grep -n "claude-flow@v3alpha\|claude-flow " commands/*.ts` for CC-02 brand drift

## Methodology notes

- Read-only: no source modifications, no test runs, no MCP probes.
- Per [[feedback-no-upstream-donate-backs]]: findings are recorded here for the maintainer, not filed against `ruvnet/*`.
- Per [[feedback-no-time-estimates]]: no estimated effort ranges included.
- Severity floor: LOW findings only included when they show a recurring pattern (F-01-012, F-01-013 both show CC-02).
