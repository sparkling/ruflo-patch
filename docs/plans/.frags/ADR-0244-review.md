## ADR-0244 — CT-K: CLI per-command honesty long-tail

**Status**: proposed (post-swarm-review)
**Swarm**: 5 experts + devil's advocate, Byzantine consensus (f=1, ≥3/6 supermajority)
**Triage rank**: 5 in [[ADR-0233]] §Decision (per-CT batch ordering)

### Decision (post-swarm-review)

Adopt the original Option A (per-site triage + parser fix + codemod extension) with **5 substantive amendments** surfaced by the panel: (i) Decision #3 (`swarm scale`) requires both wiring AND registering a real `swarm_scale` MCP handler (currently advertised at `mcp.ts:503` with zero implementation) OR deleting the subcommand — fail-loud is the safety net, not the disposition; (ii) Decision #11 (parser coercion) extends from 2 lines to 3 lines, adding `'string[]'` handling (`opt.default.split(',').map(s => s.trim())`) to close the full CC-03 class including string-array defaults; (iii) Decision #9 (F-01-012 brand drift) re-characterized as Pass 7 *architecture extension* (5 substring sets + path-scope to `commands/*.ts` + new codemod-test block), not a config flip; (iv) Check 2's byte-identical count corrected from 6/11 to **9/11** (4 whole-file + 5 block-byte-identical sites; divergence markers mandatory at all 9); (v) Decision #6 (`mcp toggle` persistence) requires either restart-required envelope note OR live-manager propagation. DA holds principled dissent on test-coverage limits for strict-equality surfacing after #11 (general risk class, out of CT-K scope); withdraws on the "11-sites-is-too-much-merge-tax" counter-proposal.

### Implementation steps

1. **Parser fix first (Decision #11) — 3-line coercion** in `forks/ruflo/v3/@claude-flow/cli/src/parser.ts:486` inside `applyDefaults`: add boolean (`opt.type === 'boolean' && typeof opt.default === 'string'` → `opt.default === 'true'`), number (`opt.type === 'number' && typeof opt.default === 'string'` → `Number(opt.default)`), AND string-array (`opt.type === 'string[]' && typeof opt.default === 'string'` → `opt.default.split(',').map(s => s.trim())`) coercion branches. Land **after** running the full unit+acceptance suite *with the coercion applied locally*, enumerating every new strict-equality failure as in-scope #11 cleanup (mirrors [[ADR-0208]] step 4 gate shape). ADR-0208 step 4 already shipped (commit `87cb68ae2`) — prerequisite is met.

2. **CRITICAL pair removal (Decisions #1 + #2)** in one commit:
   - `forks/ruflo/v3/@claude-flow/cli/src/commands/process.ts:48-203` — delete the entire `daemon` subcommand block from `processCommand` (the real `daemonCommand` at `commands/daemon.ts` is the canonical driver). Add `// ADR-0244: deleted; canonical daemon lives in commands/daemon.ts (upstream byte-identical — perpetual merge-tax)` divergence marker.
   - `forks/ruflo/v3/@claude-flow/cli/src/commands/start.ts:165-166` — remove the `daemonPidPath` write block from `startAction`. Add `// ADR-0244: PID file ownership belongs to daemonCommand (see ADR-0243 site #4 for signal-handler discipline; upstream byte-identical at :219-220)` marker. Closes the three-writer race on `.claude-flow/daemon.pid` and the `JSON.parse`-on-integer crash vector.

3. **CC-01 envelope dispositions (Decisions #3, #4, #5, #6, #7)**:
   - #3 (`swarm.ts:755-820` scale): wire to MCP `swarm_scale` AND register a real handler in `mcp-tools/swarm-tools.ts` (handler currently missing despite `mcp.ts:503` advertisement); OR delete the `scale` subcommand. Wire-or-delete the unused `--type` flag.
   - #4 (`workflow.ts:608-628` template create): implement filesystem-backed write to `.claude-flow/templates/<name>.json` returning `{success:true, data:{name, path}}`; OR delete subcommand.
   - #5 (`config.ts:304-333` reset --section): thread `--section` through to `configManager.reset(cwd, section?)` (extending the manager); OR remove the `--section` flag declaration.
   - #6 (`mcp.ts:572-612` toggle): persist `mcp.disabledTools` to `.claude-flow/config.json`; return `{success:true, data:{...}, note:'Restart required for changes to take effect'}` (cheaper) OR propagate to live `getMCPServerManager()` (more work).
   - #7 (`swarm.ts:877-893` coordinate): one-line catch-block envelope flip — return `{success:false, exitCode:1}` on MCP `swarm_init` failure; keep the printed plan.

4. **CC-02 honesty fixes (Decisions #8, #10)**:
   - #8 (`mcp.ts:271`): replace `'27 enabled'` literal with `${listMCPTools().length} enabled` (already imported at `mcp.ts:22`).
   - #10 (`completions.ts:12,20,23`): derive `TOP_LEVEL_COMMANDS`, `SWARM_SUBCOMMANDS`, `AGENT_SUBCOMMANDS` from `getCommandNames()` and command `.subcommands` at generation time; remove `help`/`version` (global flags, not commands).

5. **Pass 7 architecture extension (Decision #9)** in `forks/ruflo/scripts/codemod.mjs`:
   - Extend `isPlugin7Scope` path predicate to include `v3/@claude-flow/cli/src/commands/**/*.ts` (currently scoped to `init/**` only per [[ADR-0143]]:61).
   - Add 4 new substring rewrites alongside the existing `@sparkleideas/cli → @sparkleideas/ruflo`: `claude-flow@v3alpha` → `@sparkleideas/ruflo`, `claude-flow swarm` → `npx -y @sparkleideas/ruflo swarm`, `claude-flow workflow` → `npx -y @sparkleideas/ruflo workflow`, `npx @sparkleideas/cli@latest` → `npx -y @sparkleideas/ruflo@latest`, bare `claude-flow ` prefix → `npx -y @sparkleideas/ruflo `.
   - New `describe('codemod: ADR-0244 Pass 7 extension — commands/*.ts brand drift')` block in `tests/pipeline/codemod.test.mjs` per [[ADR-0143]] §Implementation step 1 pattern.
   - Golden-master snapshot of `cli --help` output asserts no `claude-flow@v3alpha` substring post-build.

6. **INTEGRATION-LEDGER rows** for all **9 byte-identical sites** (corrected from 6): per-site `superseded-by-local` dispositions citing ADR-0244 and naming the upstream byte-identical block. Update per `[[feedback-update-integration-ledger]]`. Sites: F-01-001 (process.ts), F-01-002 (start.ts daemonPidPath block), F-01-003 (swarm.ts scale block), F-01-004 (workflow.ts), F-01-005 (config.ts), F-01-006 (mcp.ts toggle block), F-01-007 (mcp.ts:271 "27 enabled" line), F-01-009 (parser.ts applyDefaults block), F-01-013 (completions.ts).

7. **Acceptance checks**: per-site behaviour tests asserting failure surfaces the cause:
   - Parser #11: `default: 'false'` on `type: 'boolean'` resolves to boolean `false`; `default: '100'` on `type: 'number'` resolves to number `100`; `default: 'a,b,c'` on `type: 'string[]'` resolves to `['a','b','c']`.
   - CC-01 sites: `expect(result.success).toBe(false)` when underlying operation fails (no silent success-on-MCP-fail).
   - F-01-001/#2: `ls .claude-flow/daemon.pid` after `start --daemon` shows the file is NOT written by start (only `daemonCommand` writes it).
   - F-01-012 codemod: golden-master snapshot of post-build CLI help text contains zero `claude-flow@v3alpha` / `claude-flow swarm` / `claude-flow workflow` / `npx @sparkleideas/cli@latest` substrings.

### Dependencies

- [[ADR-0201]] — pre-flight checklist (all four checks cleared in §Pre-flight verification; reaffirmed in §Swarm review with byte-identity correction).
- [[ADR-0208]] — strict-flag parsing sequence. **Already-satisfied today** (fork commit `87cb68ae2` flipped `parser.ts:565` 2026-05-23; step 4 gate met). CT-K parser fix (#11) can land now without waiting on ADR-0208 lint (step 1, still outstanding but does not gate the coercion).
- [[ADR-0210]] — stub-honesty mandate (post-swarm-review Option B′ "implement/restore/delete per-stub"). CT-K's CC-01 dispositions are the CLI-handler analogue at the dispatch layer.
- [[ADR-0143]] — codemod Pass 7. F-01-012 work requires architecture extension (path-scope + multi-token), not just routing through the pipeline. New codemod-test block needed.
- [[ADR-0233]] §CT-K — parent rollup; matrix entry for the 11 findings.
- [[ADR-0234]] (CT-A sibling) — exhaustive partition of slice 01. CT-A took F-01-008 + F-01-010 (loader-cascade theme); CT-K takes the remaining 11 (CLI-honesty theme). No overlap.
- [[ADR-0238]] (CT-E sibling) — MCP-tool wire-or-remove analogue; CT-K applies the same discipline at the CLI dispatch layer.
- [[ADR-0243]] (CT-J Site #4) — canonical PID/signal discipline (`installSignalHandlersOnce` pattern in `worker-daemon.ts:469-471`). CT-K F-01-002 removes the colliding `start --daemon` PID write and defers ownership to CT-J's pattern; one-directional cross-reference.

### Validation

- **Source-shape grep** post-fix:
  - `grep -n "writeFileSync.*daemon\.pid" forks/ruflo/v3/@claude-flow/cli/src/commands/start.ts` → zero hits (block removed).
  - `grep -n "processCommand.daemon\|subCommands.*daemon" forks/ruflo/v3/@claude-flow/cli/src/commands/process.ts` → daemon subcommand block absent.
  - `grep -n "'27 enabled'" forks/ruflo/v3/@claude-flow/cli/src/commands/mcp.ts` → zero hits (replaced with `listMCPTools().length`).
  - `grep -n "claude-flow@v3alpha" forks/ruflo/v3/@claude-flow/cli/src/commands/` → zero hits post-Pass 7 codemod.
- **Behavioural acceptance**:
  - `npx ruflo swarm scale --target 5 --type backend` against missing-handler backend returns `{success:false, exitCode:1}` with the cause surfaced (not `{success:true}`).
  - `npx ruflo workflow template create --name X --file Y` writes `.claude-flow/templates/X.json` AND returns `{success:true, data:{name, path}}` (OR subcommand absent if delete-disposition chosen).
  - `npx ruflo mcp toggle --disable foo` writes `mcp.disabledTools` to config AND prints "Restart required for changes to take effect".
  - `npx ruflo config reset --section swarm` resets only the swarm section (not the entire config).
  - `npx ruflo --help` and per-subcommand `--help` contain zero `claude-flow@v3alpha` substrings.
- **Per-site behaviour-test pass count**: 11/11 (one per finding).
- **No `skip_accepted`** per `[[feedback-skip-accepted-as-squelch]]`.

### Top risk + mitigation

- **Risk**: parser fix #11 surfaces 25+ strict-equality bugs at downstream sites (DA's principled-dissent concern). A low-coverage downstream strict-equality check may pass the suite locally but break in production. Same shape as ADR-0208 step 4's `commands-deep.test.ts:847` flip — the suite caught one site; the production cleanup discovered more.
- **Mitigation**: gate the parser fix behind a full unit+acceptance suite run *with the coercion applied locally* (per §Sequencing step 1 amendment); enumerate every new failure as in-scope #11 cleanup. Beyond that, the residual risk is general test-coverage limit, not specific to CT-K. Forward-pointer: future arch-test could grep for `=== true` / `=== false` patterns on `ctx.flags.*` and require a corresponding `as boolean` cast OR explicit default declaration — out of CT-K scope.
- **Second risk**: F-01-012 Pass 7 architecture extension touches the codemod pipeline (`scripts/codemod.mjs`) — a fork-critical infrastructure file. A broken Pass 7 extension regression could cascade through every release. Mitigation: new codemod-test block per ADR-0143 §Implementation pattern; golden-master snapshot of pre/post build CLI help text; commit per `[[feedback-commit-forks-before-release]]` so the release rebuilds against committed state.
