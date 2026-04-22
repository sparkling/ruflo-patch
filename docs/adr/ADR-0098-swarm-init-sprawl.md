# ADR-0098: Swarm-Init Sprawl — Generator Instructions + CLI Dedupe

- **Status**: Implemented 2026-04-22 — code applied to fork (not yet built/published). Ship bundle: instruction fix (§1) + Option 2-safe handler dedupe (§2 revised: config-fingerprint + file lock + atomic write + TTL + force/reason + reused flag, NO reference-counting — see §"Adversarial Review Outcome") + acceptance checks (§3) + local cleanup (§4). Pending: `npm run build` in fork, commit+push to `sparkling/main`, upstream issue filed, ADR-0097 Tier Y paired unit test for bash acceptance checks.
- **Date**: 2026-04-22
- **Scope**: fork `forks/ruflo/v3/@claude-flow/cli/src/init/claudemd-generator.ts`, fork `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/swarm-tools.ts` (MCP `swarm_init` handler, L83–132), fork `forks/ruflo/v3/@claude-flow/cli/src/commands/swarm.ts` (CLI wrappers at L202 and L431), acceptance harness addition, local `.swarm/swarm-state.json` cleanup in ruflo-patch repo
- **Related**: ADR-0082 (no silent fallbacks — `swarm init` silently appending is the same anti-pattern for state), ADR-0094 (acceptance coverage — new check belongs in Phase 9+), ADR-0097 (check-code quality — any new check follows the paired-unit-test rule)

## Context

Forensic evidence from ruflo-patch working directory as of 2026-04-22:

- `.swarm/swarm-state.json` contains **66 swarm records**, every one with `status: "running"`, `agents: []`, `tasks: []`.
- Timestamp analysis disproves "one swarm per new project": e.g. 2026-04-06 shows 6 `swarm_init` events between 00:06 and 08:47 UTC, four of them within 45 minutes. The 2026-04-20 cluster shows 9 inits in 4 hours. This is same-project reflexive init, not per-project bootstrap.
- 0 PIDs match the recorded swarms — nothing is actually running. The records are write-only state.

### Chain of causation (traced to source files)

1. **Generator instruction layer** (`forks/ruflo/v3/@claude-flow/cli/src/init/claudemd-generator.ts`):
   - L72: `"Use CLI tools (via Bash) for coordination: swarm init, memory, hooks"`
   - L79: `"ALWAYS use hierarchical topology for coding swarms"`
   - L87: `"ruflo swarm init --topology hierarchical --max-agents 8 --strategy specialized"` (worked example — gets copied)
   - L128: `"| Initialize a swarm | ruflo swarm init via Bash |"` (no scope qualifier in the "When to Use What" table)

   These lines get baked into every `ruflo init`-generated CLAUDE.md. The model reads them as capability advertisements; the "ALWAYS use hierarchical topology" phrasing pre-commits it before the scope condition is evaluated.

2. **CLI handler layer**: MCP `swarm_init` handler at `swarm-tools.ts:83-132` unconditionally mints a fresh ID (L96: `swarm-${Date.now()}-${Math.random()...}`) and blindly appends to `.swarm/swarm-state.json` (L118–120: `store.swarms[swarmId] = swarmState; saveSwarmStore(store)`). No existence check, no dedupe, no reuse. CLI wrappers at `swarm.ts:202` (primary `initCommand`) and `swarm.ts:431` (secondary init path, likely `--start-all`) both delegate to this handler. Adding a reuse predicate is a ~10-line change at the single MCP handler, which catches both CLI paths automatically.

3. **Model reinforcement layer**: past sessions that used swarms populated the `[INTELLIGENCE]` pattern store with swarm-adjacent patterns. Those patterns are injected into prompt context for subsequent sessions, biasing the model toward the swarm path it was supposed to stop taking. Self-reinforcing loop.

### Why this is a cleanliness bug, not an incident

- No process footprint.
- No correctness impact on published packages.
- No security leak unless a user puts sensitive data in a swarm label.

But it's a cleanliness bug that **poisons future decisions**: a session that legitimately wants to reuse an existing swarm is selecting from 66 orphans of unknown provenance.

## Decision

Fix at the two layers we own (fork) — not (3), which is emergent model behavior shaped by (1) and (2).

### 1. Generator instruction rewrite

In `forks/ruflo/v3/@claude-flow/cli/src/init/claudemd-generator.ts`, replace L72, L79, L87, L128 with a single explicit guardrail block:

```markdown
## Agent Orchestration

- DEFAULT: use Claude Code's built-in `Agent` tool for multi-agent work.
  It spawns subagents with ZERO coordination state, ZERO setup, ZERO cleanup.
- DO NOT call `swarm_init`, `hive-mind_spawn`, or `ruflo swarm init`
  reflexively at the start of tasks. Only when:
    (a) the user explicitly asks for claude-flow coordination, OR
    (b) persistent cross-session coordination state is actually required.
- If you DO init a claude-flow swarm:
    1. Call `swarm_status` first — reuse an existing swarm if present.
    2. Call `swarm_shutdown` when the task ends.

| Need | Use |
|------|-----|
| Multi-agent work on one task | `Agent` tool (built-in) |
| Persistent swarm state (rare, explicit) | `swarm_init` via MCP, after `swarm_status` |
```

Removes the `--topology hierarchical --max-agents 8` worked example entirely — worked examples get copied and that one was being copied at scale.

### 2. MCP handler dedupe (config-fingerprint, not session-scoped)

Modify the MCP `swarm_init` handler at `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/swarm-tools.ts:83-132`:

1. Add an optional `force: boolean` field to the input schema.
2. Before minting a new ID, load the store and look for an existing swarm with `status === 'running'` AND matching `{topology, maxAgents, config.strategy}`. If found and `force !== true`:
   - Update its `updatedAt`.
   - Return its existing `swarmId` with a new `reused: true` field in the response.
3. Otherwise, mint a new ID and append as today. Return `reused: false`.
4. CLI wrappers at `swarm.ts:202` and `swarm.ts:431` accept a `--new` / `--force` flag, propagate it as `force: true` to the MCP call, and log `"Reusing swarm-XXX (same config)"` when `reused: true`.

**Why config-fingerprint, not session-scoped (revised from initial design):**

The initial design called for session-scoped dedupe — reuse only within the same Claude Code session. On review, session-scoping requires plumbing a session ID from Claude Code → Bash tool invocations → `npx` CLI subprocess → MCP handler. Claude Code's transcript UUID is available in hook env vars but **not** propagated to normal Bash invocations, and adding that plumbing is more surface area than the fix warrants.

Config-fingerprint achieves the same effect for the actual bug — reflex-init always uses the generator's default config (`hierarchical-mesh, 15, specialized`), so all reflex-init calls across any session collapse onto the one existing record. The devil's-advocate objection (don't punish legitimate multi-swarm use) is still satisfied:

- Two parallel swarms for genuinely different purposes naturally get different configs → separate records, no collision.
- Two parallel swarms with the same config → edge case, user passes `force: true` / `--new`.

**Predicate choice — 3 fields, not 6:** `{topology, maxAgents, strategy}` is the minimum set that distinguishes meaningfully different swarms. Adding `communicationProtocol`/`autoScaling`/`consensusMechanism` would make two reflex-init calls diverge on unset-default differences and fail to dedupe. Keeping it to 3 fields maximizes collapse on the common case.

**Stale-record concern:** a `status: running` record 30 days old would still match and get reused. Not fixing in this ADR — ship the minimum dedupe first, add a TTL check (e.g., only consider records `updatedAt` within 7 days) only if orphans recur despite dedupe. Path: add a `lastAccessedAt` field, filter predicate on it.

### 3. Acceptance check

New check in `lib/acceptance-swarm-checks.sh`, wired into Phase 9+ per ADR-0094. Paired unit test per ADR-0097.

Scenario (revised for config-fingerprint semantics):
1. Fresh init'd project — assert `.swarm/swarm-state.json` has 0 swarms.
2. `swarm init` with defaults → record count = 1, response `reused: false`.
3. `swarm init` with defaults again → record count still = 1, response `reused: true`, same `swarmId` returned.
4. `swarm init --topology mesh --max-agents 4` → record count = 2, new `swarmId`, `reused: false`.
5. `swarm init --topology mesh --max-agents 4` again → record count still = 2, `reused: true`.
6. `swarm init --new` (with defaults) → record count = 3, new `swarmId`, `reused: false`.
7. Manually transition one record to `status: terminated`, `swarm init` with that same config → record count = 4, new `swarmId`, `reused: false` (terminated records are not reuse candidates).
8. Generated-CLAUDE.md content check — assert the four flagged strings (L72/L79/L87/L128 equivalents) are absent from the post-fix generator output.

### 4. Local cleanup of `ruflo-patch` working copy

Truncate `/Users/henrik/source/ruflo-patch/.swarm/swarm-state.json` to `{"swarms": {}, "version": "3.0.0"}`. Not a published change — just resets local state so we can verify the fix is working (any new orphan = regression). File is gitignored; no commit.

### Not doing (with rationale)

- **Session-end auto-shutdown hook** — would be defense-in-depth but superfluous once (2) lands. Revisit if orphans reappear despite dedupe.
- **Pattern-store pruning** (removing past swarm-usage patterns that self-reinforce the behavior) — second-order effect; let the fixed generator produce new data for a few weeks first, then evaluate.
- **Upstream patch** to `ruvnet/claude-flow`'s own generator — file as an issue with a reproducer (our 66-orphan dataset), keep our fork patch as the shipping fix. Per `feedback-patches-in-fork.md`, upstream-worthiness doesn't block our ship.

## Alternatives

### A. Fix only the instructions, not the CLI
**Pros**: smaller diff, one file.
**Cons**: any future instruction drift, any user typo-loop, any hook regression refills the orphan pile. The CLI is the backstop that makes the instruction fix durable. Rejected.

### B. Fix only the CLI, not the instructions
**Pros**: one change, cures the symptom regardless of what Claude is told.
**Cons**: Claude still wastes tool-call budget and latency firing `swarm_init` every task. Symptom-only fix. Rejected.

### C. Global (not session-scoped) dedupe
**Pros**: strongest guarantee of a single swarm per project.
**Cons**: breaks legitimate multi-swarm workflows (parallel research + implementation). Per devil's-advocate objection. Rejected.

### E. Session-scoped dedupe (initial design, revised out)
**Pros**: reuse only within the same Claude Code session — tighter scope.
**Cons**: requires propagating a session ID from Claude Code → Bash tool invocations → `npx` CLI subprocess → MCP handler. That channel doesn't currently exist and adding it is more surface area than the fix warrants. Config-fingerprint dedupe (shipped §2) achieves the same practical outcome because all reflex-init calls use the generator's default config and collapse onto one record regardless of session boundary.

### F. Session-end auto-shutdown hook
**Pros**: symmetric to init — every swarm a session created gets torn down at end.
**Cons**: superfluous once dedupe lands, because dedupe already caps record count. Also needs session-scoped swarm tracking we don't have. Defer — revisit if orphans reappear despite dedupe.

### G. Reference-counting / ownership-gated shutdown (rejected at adversarial review)
**Pros**: would cleanly solve the "reused caller shuts down shared swarm" scenario (see "Adversarial Review Outcome" below).
**Cons**: requires a caller-ID channel that the MCP handler cannot see today; implementation is error-prone (stale references, forged IDs, race on counter); adds state semantics that are harder to debug than the original bug. Flaw surface exceeds flaw surface of the unfixed problem. Moved to convention (documented in CLAUDE.md guardrail) rather than enforcement.

### D. Force a cleanup at every `swarm init` (delete old before creating new)
**Pros**: cleanliness guaranteed.
**Cons**: destroys legitimate long-running swarms on any reflex-init. Worst of both worlds. Rejected.

## Consequences

**Positive**:
- Fresh-init'd projects stop accumulating orphan swarm records.
- Sessions that still honestly need coordination state get a working `swarm_init` flow with explicit reuse and cleanup semantics.
- Acceptance check catches regressions (instruction drift, generator edits that re-introduce the copied-example pattern).

**Negative**:
- The 66 existing orphans in ruflo-patch are cleaned but not preserved as a telemetry artifact. Accept — they contain no task/agent data, only topology metadata that is also recoverable from config.
- Advanced users relying on multiple simultaneous swarms within one session must learn the `--new` flag. Document in the CLI help text.
- One more check in an already-dense acceptance suite (cf. ADR-0090/ADR-0094 throughput concerns).

**Neutral / needs monitoring**:
- Intelligence pattern store still biased toward swarm-init patterns for the first few weeks until new post-fix data dilutes the signal. Revisit pruning if new orphans appear despite fixed generator.

## Adversarial Review Outcome (2026-04-22 PM)

The initial ship plan included reference-counting and session-scoped dedupe. An adversarial review (at user request) identified the following flaws:

| Flaw | Severity | Disposition |
|------|----------|-------------|
| 1. Race on concurrent init (JSON read-modify-write without lock) | HIGH | **Fixed** — `withSwarmStoreLock` helper using `O_EXCL` sentinel with stale-lock recovery, wraps the entire load→match→save sequence. Atomic write (tmp + rename) in `saveSwarmStore`. |
| 2. Stale `running` records become dedupe attractors | HIGH | **Fixed** — 7-day TTL filter in predicate (`SWARM_REUSE_TTL_MS`). Records with `updatedAt` older than TTL are not reuse candidates; a new record is created instead. |
| 3. Ownership/shutdown ambiguity when reused caller later calls shutdown | MEDIUM-HIGH | **Mitigated via convention, not enforcement.** Enforcement would require a caller-ID channel the MCP handler cannot see today (see Alternative G). Instead: CLAUDE.md guardrail instructs callers not to shutdown a swarm they received with `reused: true`. Acceptance check could later detect violations by scanning for `reused: true → swarm_shutdown(same ID)` sequences. |
| 4. `force` flag as a drift vector | MEDIUM | **Mitigated** — `reason: string` optional field alongside `force`; handler emits `[WARN]` on force=true without reason (advisory log, not blocking). Surfaces in CI if reflex-force starts appearing. |
| 5. Predicate picks oldest matching record instead of freshest | MEDIUM | **Fixed** — `Object.values(...).sort((a,b) => updatedAt desc)` before `[0]`. Always picks most recently active match. |
| 6. 40 lines + tests for a 33KB cosmetic bug | LOW | **Accepted.** The instruction fix alone (§1) probably catches 90% of reflex-init. Handler dedupe (§2) is belt-and-braces. If Phase-2 measurement shows §1 alone is sufficient, §2 lives as dead-but-harmless infrastructure. |

Net: ship Option 2-safe = fixes 1/2/4/5 in code, 3 in convention, 6 accepted.

## Implementation Log

### 2026-04-22 PM — Code applied (build + commit pending)

**Fork changes** (branch `forks/ruflo/main`, not yet committed):

- `v3/@claude-flow/cli/src/mcp-tools/swarm-tools.ts`:
  - Added `renameSync`, `openSync`, `closeSync`, `writeSync`, `unlinkSync`, `statSync`, `constants` to `node:fs` imports.
  - Converted `saveSwarmStore` to atomic-write (temp + rename).
  - Added `withSwarmStoreLock` helper (O_EXCL sentinel, 5s timeout, 30s stale-lock recovery).
  - Added `SWARM_REUSE_TTL_MS = 7 days` constant.
  - Added `force: boolean` and `reason: string` fields to `swarm_init` inputSchema.
  - Rewrote handler: runs within lock; when `force !== true`, finds most-recently-updated running swarm with matching `{topology, maxAgents, config.strategy}` within TTL; returns `reused: true` with existing ID or `reused: false` with new ID.
  - Emits `[WARN]` to stderr when `force=true` without `reason`.
- `v3/@claude-flow/cli/src/commands/swarm.ts`:
  - Primary `initCommand` (L202): added `--new` and `--reason` CLI flags; propagates `force`/`reason` to MCP call; prints `Reusing existing swarm <ID>` instead of success banner when `reused: true`.
  - Secondary init in `startCommand` (L454 area): now honors MCP-returned `swarmId` (no longer discards it for a client-side `Date.now()` mint); surfaces reuse in spinner message.
- `v3/@claude-flow/cli/src/init/claudemd-generator.ts`:
  - `agentOrchestration()` — replaced with DEFAULT/DO-NOT-reflexive/Agent-tool-first guidance (was pre-commit "ALWAYS" language pointing at swarm init).
  - `antiDriftConfig()` — removed worked example `ruflo swarm init --topology hierarchical --max-agents 8 --strategy specialized`; prefaced remaining config guidance with "when explicitly required."
  - `whenToUseWhat()` — table row "Initialize a swarm | ruflo swarm init" replaced with two rows distinguishing built-in `Agent` (default) from `swarm init` (rare, explicit).
- `v3/@claude-flow/cli/__tests__/swarm-init-dedupe.test.ts`:
  - New test file; 10 scenarios exercising the real handler against a temp CWD via `CLAUDE_FLOW_CWD` env var (no fs mocking).

**ruflo-patch changes** (branch `main`, not yet committed):

- `lib/acceptance-adr0098-checks.sh`:
  - New; three checks: generator-no-reflex (A), same-config-dedupe (B), --new-flag-bypass (C).
- `scripts/test-acceptance.sh`:
  - Sourced `$adr0098_lib` alongside phase17.
  - Added `_adr0098_specs` array and wired into the spec aggregate passed to the summary.
  - Added three `run_check_bg` lines inside `[[ -f settings.json && -f $adr0098_lib ]]` guard.
- `.swarm/swarm-state.json`:
  - Truncated from 66 orphan records to `{"swarms": {}, "version": "3.0.0"}` (local working-copy reset, not committed — file is gitignored).

### Pending before publish

- [ ] `cd /Users/henrik/source/forks/ruflo/v3/@claude-flow/cli && npm run build` — verify TypeScript compiles with the new imports and schema fields.
- [ ] `npm run test:unit` in fork — verify `swarm-init-dedupe.test.ts` passes all 10 scenarios.
- [ ] `npm run test:unit` in ruflo-patch — verify nothing regressed in paired tests.
- [ ] Commit to fork (target: `sparkling/main`) + commit to ruflo-patch, then `npm run deploy` to publish new patch version.
- [ ] Run `npm run test:acceptance` post-publish — verify the three ADR-0098 checks pass end-to-end.
- [ ] Paired unit test for acceptance-adr0098-checks.sh per ADR-0097 Tier Y — deferred to Tier Z backlog if not done immediately.
- [ ] File upstream issue against `ruvnet/claude-flow` with the 66-orphan reproducer + link to this ADR. Independent of our fork patch; upstream can choose to adopt.

## Hive Synthesis (2026-04-22)

Decision here is the output of an 8-voice design debate on 2026-04-22 with a devil's-advocate seat.

**Persistent hive record:**
- **Hive ID**: `hive-1776255332181` (topology: hierarchical, consensus: byzantine, queen: `ux-daemon-queen`)
- **Workers spawned for this debate** (8 total, 2026-04-22 18:59 UTC):
  - `hive-worker-1776880745070-cbgj` (initial)
  - `hive-worker-1776880783848-{8hqs, n6n7, fp7h, 6ht0, w3g0, brqt, n8zz}` (batch of 7)
- **Memory key**: `adr-0098/hive-debate` — full debate summary, rejected alternatives, and devil's-advocate objections. Retrieve via `ruflo memory retrieve -k adr-0098/hive-debate`.

Key captured objections:

1. **"Write-only telemetry is still telemetry — you might be killing audit data."** Verified `agents: []` / `tasks: []` on every record — nothing downstream reads them. Concession accepted.
2. **"CLI dedupe punishes advanced multi-swarm use."** Adopted: session-scoped dedupe + `--new` flag, not global.
3. **"The real fix is upstream, not a fork patch."** Adopted: file upstream issue, keep fork patch as ship vehicle. No block on our ship.

Note on hive-vs-swarm: the hive-mind system correctly reuses a single persistent hive across sessions (this debate added workers to the existing `hive-1776255332181`, didn't create a new one). The swarm system, which this ADR addresses, lacks that reuse semantics — that's the asymmetry the fix eliminates.
