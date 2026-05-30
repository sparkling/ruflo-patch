---
status: accepted
date: 2026-05-25
tags: [rvagent-wasm, plugin-bridge, implementation, pilot]
supersedes: []
depends-on: [ADR-0254]
implements: [ADR-0254]
---

# ADR-129 Phase 4 plugin-bridge implementation plan

## Context and Problem Statement

[[ADR-0254]] dispositioned upstream `ruvnet/ruflo`'s ADR-129 (commit `47a7825b0`, v3.8.0) as `pick-partial`: Phase 4 (plugin bridge) lands as a low-risk pilot now; Phases 1-3 are gated on three remaining design questions (persistence-layer threading, `SAFE_MCP_TOOLS` allowlist audit, `optional-modules.d.ts:295` `loadRvf` signature typo). Phase 4 was named the unblocked pilot because, per R-A's surface map (`docs/research/2026-05-25-adr129-rvagent-upstream-trace.md` §"Integration points"): *"Phase 4 (plugin manifest reader) lands as-is."*

This ADR is the implementation plan for that pilot. It does **not** land Phase 4 — it documents the exact files, hunks, smoke, and CI work that would land it, plus surfaces a coupling to Phase 2 that ADR-0254's high-level disposition did not name explicitly.

The Phase 4 surface, per upstream's own commit body (`47a7825b0`):

> *"Add `loadPluginManifest()` + `extractPluginSkills()` to `wasm-agent-tools.ts`. `wasm_agent_compose` gains `includePlugins?: string[]` — reads each plugin's `.claude-plugin/plugin.json`, parses `rvagent.exposeSkillsAsTools`, and adds matching skills to the RVF container. Unknown plugin name → warning, not error."*

Two new pure functions, one new optional parameter on an existing tool, an `rvagent` field added optionally to `plugin.json`. Helper-level Phase 4 lands with zero archivist-seam interaction and zero new MCP-tool surfaces (the helpers are utility code; the `includePlugins` parameter rides on the `wasm_agent_compose` tool that Phase 2 introduces).

## Phase 4 ↔ Phase 2 coupling — surfaced honestly

ADR-0254's plan reads:

> *"The P4 helpers stand alone — they don't require the P2 destructive-tool-pattern guards from the same code block."*

This is **true for the helpers** but **incomplete for the `includePlugins` parameter**. Verified directly against upstream `47a7825b0:v3/@claude-flow/cli/src/mcp-tools/wasm-agent-tools.ts`:

* The `loadPluginManifest()` helper sits at line 70-86 of the upstream final file.
* The `extractPluginSkills()` helper sits at line 88-101.
* The `includePlugins` parameter is declared at line 350 inside the `wasm_agent_compose` tool (a **Phase 2** tool — defined at line 324 with the `// ── ADR-129 P2 — wasm_agent_compose ──` marker).
* The plugin loop (lines 386-394) — which actually **invokes** the helpers — lives inside the `wasm_agent_compose` handler.

If only the helpers land (Phase 4 helpers without Phase 2's `wasm_agent_compose` tool), the helpers are unreachable at runtime: there is no MCP tool exposing the `includePlugins` parameter to callers. R-A's verdict "lands as-is" describes the **landing surface** (no compile errors, no archivist conflict), not the **functional reachability**.

The ADR-0254 amendment-1 note about three (not four) remaining gating questions is not affected; the OpenRouter resolution is genuinely independent. But the framing "Phase 4 ships value standalone" needs to be qualified.

This ADR proposes landing **helpers + smoke only** (Option A below). The helpers are exported utility functions ready for Phase 2 wire-up. The smoke validates the static contract (helpers exist, parse fixture manifests correctly). The `includePlugins` parameter and its consuming loop land only when Phase 2 lands (which is gated by ADR-0254 on the three remaining design questions).

## Decision Drivers

* **Honor the ADR-0254 disposition.** Phase 4 is the unblocked pilot; the three gating questions for Phases 1-3 are explicitly named in ADR-0254 and not unblocked by this ADR.
* **Per `[[feedback-no-fallbacks]]`: don't ship inert code.** Landing helpers that no MCP tool can reach is acceptable as a forward-compat seam — provided the smoke verifies the helpers behave correctly under direct fixture invocation, so they don't silently rot before Phase 2 catches up.
* **Per `[[feedback-corpus-evidence-before-feature-work]]`: every claim cited against actual upstream source, not the design doc's narrative.** The Phase 2/4 coupling was found by grepping the post-`47a7825b0` source, not by trusting the commit message.
* **Per `[[feedback-no-time-estimates]]`: no timelines.** The pilot is shaped by the named exit criteria, not by calendar.
* **Per `[[feedback-update-integration-ledger]]`: this ADR doesn't land code — the implementing commit (when it lands) appends the ledger row.**

## Considered Options

### Option A — Helpers + smoke only (proposed)

Land `loadPluginManifest` + `extractPluginSkills` as standalone functions in `wasm-agent-tools.ts`. Land the `smoke-wasm-plugin-bridge.mjs` smoke (already validates fixture-only behavior — no `wasm_agent_compose` invocation). Add the CI job. The `includePlugins` parameter and its loop are deferred to when Phase 2 lands. Net result: dead-but-exported helpers ready for Phase 2 to wire.

* **Pros**: Zero risk to existing tool surface. Smoke validates helpers in isolation. No upstream divergence beyond what ADR-0254 already accepts. Forward-compat with Phases 1-3 landing later as designed.
* **Cons**: Helpers are unreachable at runtime until Phase 2 lands. The plugin authors who add `rvagent` blocks to their `plugin.json` files see no behavior change yet.

### Option B — Helpers + minimal Phase-2-lite `wasm_agent_compose` (rejected)

Land helpers + a stub `wasm_agent_compose` that only does plugin-skills wiring (no `addMcpTools`, no destructive-tool gate, no `SAFE_MCP_TOOLS` allowlist). Plugin authors who declare `rvagent` see a working flow now.

* **Pros**: Plugin bridge is functionally reachable at runtime.
* **Cons**: Creates a fork-divergent shape of `wasm_agent_compose` (missing `mcpTools`, `mcpToolsAllowDestructive` — those parameters return runtime errors or are silently ignored). When Phase 2 lands "for real", either the stub is replaced (creating a behavior change for any caller that depended on the stub shape) or the two implementations have to be reconciled. **Per `[[feedback-no-fallbacks]]`: a stub that silently ignores documented inputs is a fallback masking missing functionality.** Rejected.

### Option C — Defer Phase 4 entirely until Phase 2 lands

Treat Phase 4 as a dependency of Phase 2; don't land any of it until Phase 2's three gating questions resolve.

* **Pros**: No dead code ever lands. Phase 4 lands functional on day one.
* **Cons**: ADR-0254 explicitly named Phase 4 the low-risk pilot. Deferring it contradicts that disposition; the helpers are genuinely independent code. Rejected.

## Decision Outcome

Chosen: **Option A — helpers + smoke only.**

## Decision

Land **the Phase 4 plugin-manifest helpers** (`loadPluginManifest`, `extractPluginSkills`) as exported pure functions inside `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/wasm-agent-tools.ts`. Land the upstream-verbatim `smoke-wasm-plugin-bridge.mjs` (already designed to validate fixture-only behavior — no `wasm_agent_compose` invocation, no API keys, no runtime WASM load). Land the matching CI job in `forks/ruflo/.github/workflows/v3-ci.yml`.

**Not landed by this ADR's implementation:**

* `includePlugins` parameter inside `wasm_agent_compose` — deferred until Phase 2 lands.
* The plugin-loop inside the compose handler (upstream lines 386-394) — deferred until Phase 2 lands.
* The `rvagent` block in any fork plugin's `plugin.json` — the helpers handle missing-block as null/empty; no opt-in needed today.

**MCP tool surfaces added**: none.
**MCP tools modified**: none.
**Existing MCP tools made WasmAgent-aware**: none.

**How does the plugin bridge route through existing swarm coordination?** It does not yet. The helpers are utility functions exported for future Phase 2 consumption; they do not participate in swarm coordination until the `wasm_agent_compose` tool (Phase 2) reads their output and embeds it in an RVF.

## Implementation plan

### Step 1 — Add the Phase 4 helpers to `wasm-agent-tools.ts`

**File**: `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/wasm-agent-tools.ts`

Cherry-pick / hand-port (the fork's `wasm-agent-tools.ts` predates the upstream commit; targeted insertion is cleaner than `git cherry-pick`) the following hunks from upstream `47a7825b0:v3/@claude-flow/cli/src/mcp-tools/wasm-agent-tools.ts`:

* **Imports**: ensure `existsSync, readFileSync` from `node:fs` (the fork already imports `existsSync, readFileSync`); add `resolve` from `node:path` (the fork imports only `join` today).
* **Phase 4 helpers block** (upstream lines 63-101 of the post-`47a7825b0` file):
  * `interface PluginRvagentConfig { exposeSkillsAsTools?: string[] | boolean; autoWireOnCompose?: boolean; }`
  * `interface PluginManifest { name?: string; rvagent?: PluginRvagentConfig; }`
  * `function loadPluginManifest(pluginName: string): PluginManifest | null` — searches three candidate dirs: `<cwd>/plugins/<name>/.claude-plugin/plugin.json`, `<cwd>/plugins/ruflo-<name>/.claude-plugin/plugin.json`, `<cwd>/v3/plugins/<name>/.claude-plugin/plugin.json`. Returns null if no match. Catches JSON parse errors silently (per upstream pattern).
  * `function extractPluginSkills(manifest, pluginName)` — returns `[]` when `manifest.rvagent` is absent or `exposeSkillsAsTools` is not an array (handles the boolean case by returning empty per upstream behavior; the boolean form means "all skills" but upstream requires explicit names — verified at upstream `wasm-agent-tools.ts:97` final).

**Done when**: `npx tsc --noEmit` against `v3/@claude-flow/cli/src/mcp-tools/wasm-agent-tools.ts` passes; `grep -n "loadPluginManifest\|extractPluginSkills" forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/wasm-agent-tools.ts` returns the two new function declarations.

### Step 2 — Land the Phase 4 smoke

**File**: `forks/ruflo/scripts/smoke-wasm-plugin-bridge.mjs`

Cherry-pick verbatim from upstream `47a7825b0:scripts/smoke-wasm-plugin-bridge.mjs` (118 lines).

The smoke is designed for static + fixture validation:

* **Static contracts** (greps against `wasm-agent-tools.ts` source):
  * `includePlugins` appears in the `wasm_agent_compose` tool block — **will fail** under this ADR's Option A because we are not adding `wasm_agent_compose` yet.
  * `loadPluginManifest` function exists.
  * `extractPluginSkills` function exists.
  * `pluginWarnings` path present in the source — **will fail** under this ADR's Option A.
* **Behavioral fixtures** (no source dependency, run on inlined `extractPluginSkillsFixture`):
  * Mock manifest with `exposeSkillsAsTools: ['trader-signal', 'trader-backtest']` returns 2 skills.
  * Mock manifest without `rvagent` returns 0 skills.
  * Mock manifest with `exposeSkillsAsTools: true` (boolean) returns 0 skills.

**Adjustment required**: the upstream smoke has 4 static contracts; 2 of them (`includePlugins` in compose, `pluginWarnings`) probe code that Option A does not land. The smoke needs a minor patch: skip those 2 assertions when `wasm_agent_compose` is absent (or split them into a separate Phase-2-precondition smoke).

**Recommended patch shape**: gate the 2 compose-dependent assertions behind a `composeToolBlock` truthiness check. The smoke already has the regex (`toolsSrc.match(/name:\s*['"]wasm_agent_compose['"][\s\S]*?handler:/)`); when that match is null, log a `skip` message rather than `fail` and continue. The other 5 assertions (helpers exist, fixture parsing correctness) remain hard contracts.

Implementer who lands this ADR must apply that small patch before landing the smoke; the patch is the only fork-divergence from upstream's smoke shape and is required because Option A defers Phase 2.

**Done when**: `node forks/ruflo/scripts/smoke-wasm-plugin-bridge.mjs` exits 0 with all 5 helper-and-fixture assertions PASS plus 2 SKIP messages explaining the deferred Phase 2 contracts.

### Step 3 — Add the CI job

**File**: `forks/ruflo/.github/workflows/v3-ci.yml`

Cherry-pick the `wasm-plugin-bridge-smoke` job stanza from upstream `47a7825b0:.github/workflows/v3-ci.yml`. The job is a single `node scripts/smoke-wasm-plugin-bridge.mjs` invocation under `runs-on: ubuntu-latest` with `actions/setup-node@v4` at `node-version: '22'`. No pnpm/install steps required (the smoke is pure-Node, no TS build).

Also update the `paths:` filter on the `on.push` / `on.pull_request` trigger to include the new file paths (per upstream's update to the same workflow).

**Done when**: the new job appears in `gh workflow view v3-ci.yml` output and the workflow file YAML is valid (`yamllint .github/workflows/v3-ci.yml` passes).

### Step 4 — Build verification + commit

**Order**:

1. Confirm the fork build succeeds: `cd forks/ruflo/v3 && pnpm --filter @claude-flow/cli build` produces a clean dist.
2. Run the smoke locally: `node forks/ruflo/scripts/smoke-wasm-plugin-bridge.mjs` shows 5 PASS + 2 SKIP.
3. Commit the changes in `forks/ruflo` (sparkling fork; trunk-only per `[[feedback-trunk-only-fork-development]]`); push to `sparkling main`.
4. Append the INTEGRATION-LEDGER row in `ruflo-patch` per `[[feedback-update-integration-ledger]]`: cherry-pick provenance (upstream `47a7825b0`), disposition (`pick-partial-helpers-only`), and citation to this ADR.

**Done when**: `git status --short` in both `forks/ruflo` and `ruflo-patch` is empty; the ledger row is present in `docs/upstream/INTEGRATION-LEDGER.md`.

## Files affected

Per the implementation plan above, three files change in `forks/ruflo` plus one file in `ruflo-patch`:

| # | Path | Change | Source |
|---|---|---|---|
| 1 | `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/wasm-agent-tools.ts` | Add ~40 lines (2 interfaces + 2 functions + 1 import addition for `resolve` from `node:path`); no existing lines modified | Hand-port from upstream `47a7825b0:v3/@claude-flow/cli/src/mcp-tools/wasm-agent-tools.ts` lines 63-101 |
| 2 | `forks/ruflo/scripts/smoke-wasm-plugin-bridge.mjs` | New file (118 lines) with one local patch: gate `wasm_agent_compose`-dependent assertions behind a `composeToolBlock` truthiness skip | Cherry-pick from upstream `47a7825b0:scripts/smoke-wasm-plugin-bridge.mjs`, plus the skip-gating patch documented in Step 2 |
| 3 | `forks/ruflo/.github/workflows/v3-ci.yml` | Add `wasm-plugin-bridge-smoke` job stanza (~20 lines) + extend `paths:` triggers | Cherry-pick the relevant job stanza from upstream `47a7825b0:.github/workflows/v3-ci.yml` |
| 4 | `ruflo-patch/docs/upstream/INTEGRATION-LEDGER.md` | Append one row recording the cherry-pick provenance | Per `[[feedback-update-integration-ledger]]` |

**File count: 4** (3 in fork; 1 in patch repo for ledger).

## Tests

### Existing tests that should continue passing

* All current `wasm-agent-tools.test.ts` tests in `forks/ruflo/v3/@claude-flow/cli/__tests__/` — adding two pure functions does not change any existing behavior; the persistence layer is untouched.
* All `smoke-*` scripts in `forks/ruflo/scripts/` — no shared state with the new smoke.
* `npm test` in `forks/ruflo/v3/@claude-flow/cli` — the helpers are pure and don't require new test fixtures unless we add a dedicated TS-level unit test (optional).
* Existing acceptance gates in `ruflo-patch/test-acceptance-fast.sh` per `[[reference-fast-test-runner]]` — the change is contained in the fork; acceptance suite does not import these helpers directly.

### New tests required

1. **`smoke-wasm-plugin-bridge.mjs`** (Step 2) — the upstream smoke patched to gate 2 of its 7 assertions on `wasm_agent_compose` presence. Provides static + fixture validation of `loadPluginManifest` and `extractPluginSkills`.
2. **(Optional, not required)** A TypeScript-level unit test for `loadPluginManifest` that creates a fixture plugin directory tree and asserts the function reads it correctly. The smoke already covers fixture-level parsing of `extractPluginSkills`; a TS test would add only file-IO coverage for `loadPluginManifest`. Acceptance-level smoke is sufficient for the pilot; TS unit test can be added when Phase 2 lands and the helpers become reachable through `wasm_agent_compose`.

## Dependencies and prerequisites

### Pinned dependencies (already in fork)

* **`@ruvector/rvagent-wasm@0.2.1-patch.145`** — verified per R-A: *"`v3/@claude-flow/cli/package.json:125`: `"@ruvector/rvagent-wasm": "0.2.1-patch.145"`"*. The package is **not** used by Phase 4's helpers (the helpers read static JSON files from disk; no WASM instantiation, no RVF builder calls). Pin is irrelevant to this ADR but documented as confirmed.
* **`@claude-flow/aidefence@3.0.2-patch.836`** — present in fork per R-A §"Dependencies"; **not consumed by Phase 4** (Phase 3 needs it for the `wasm_gallery_import` gate).

### New dependencies required

None. The helpers use only `node:fs` and `node:path` builtins, both already imported into the fork's `wasm-agent-tools.ts`.

### Coupling to the three remaining ADR-129 gating questions

ADR-0254 Amendment 1 lists three remaining gating questions for Phases 1-3:

| # | Gating question | Does Phase 4 helpers-only land depend on it? |
|---|---|---|
| 1 | OpenRouter routing in `agent-execute-core.ts` | **No.** OpenRouter is needed inside `callAnthropicMessages`, which is Phase 1's `JsModelProvider` callback. Phase 4 helpers don't touch the provider system. Verified: `grep "callAnthropicMessages\|OPENROUTER\|set_model_provider" loadPluginManifest extractPluginSkills` returns zero. |
| 2 | Persistence-layer threading for the 16 new tools (`ensureLive`, `withStoreLock`, `snapshotAgent`) | **No.** The helpers are stateless pure functions that read static files; no agent state created or mutated. The `wasm-agent-tools.ts:1-231` persistence layer is unaffected. **However**: this is the Phase 4 ↔ Phase 2 coupling surfaced in §"Phase 4 ↔ Phase 2 coupling" above. The `includePlugins` parameter would (if landed) invoke the helpers from inside the `wasm_agent_compose` handler, which is itself a Phase 2 surface that the persistence-threading question gates. Option A defers `includePlugins` precisely to avoid taking a position on that question. |
| 3 | `SAFE_MCP_TOOLS` allowlist audit | **No.** The allowlist gates which MCP tools `wasm_agent_compose` will embed as descriptors. Plugin skills come from plugin manifests, not the MCP registry. The two surfaces don't overlap. |

**(Resolved per ADR-0254 Amendment 1)**: The OpenRouter routing question is no longer gating; fork commit `1c31b3ecc` landed it.

**Honest assessment**: Phase 4 helpers-only as scoped by Option A has **no hard dependency** on the three Phase 1-3 gating questions. The Phase 2/4 *runtime* coupling exists but is deferred by Option A's scoping (helpers only, no `includePlugins` parameter, no compose-handler loop). The `loadRvf` typo fix (the 4th historical gating question, now consolidated into the Phases 1-3 group per ADR-0254 Revision 1) is a Phase 3 prerequisite and entirely orthogonal to Phase 4.

### Plugin layout compatibility

Per R-A §"Open questions" #4: *"Upstream's `loadPluginManifest` searches `plugins/<name>/.claude-plugin/plugin.json`, `plugins/ruflo-<name>/...`, `v3/plugins/<name>/...`. Fork has `/Users/henrik/source/forks/ruflo/plugins/` and `/Users/henrik/source/forks/ruflo/v3/plugins/`; matches."*

Spot-verified for this ADR: `find /Users/henrik/source/forks/ruflo/plugins -name "plugin.json" -path "*/.claude-plugin/*"` returns at least 5 plugins (ruflo-agentdb, ruflo-rvf, ruflo-neural-trader, ruflo-wasm, ruflo-goals) at the expected path shape. The three-candidate path search in upstream's `loadPluginManifest` matches fork layout without modification.

## Risk register

Per `[[feedback-no-fallbacks]]`: only risks grounded in actual surface analysis, not speculation. Phase 4 helpers-only is the LOW-RISK pilot.

| Risk | Source | Mitigation |
|---|---|---|
| Helpers land but no MCP tool reaches them (dead-code rot) | This ADR's Phase 2/4 coupling analysis | Smoke validates fixture-level parsing on every CI run; the helpers cannot rot silently — a regression breaks the smoke. When Phase 2 lands, the smoke's 2 SKIP'd assertions flip to PASS naturally. |
| Plugin author adds `rvagent` block to their `plugin.json` expecting behavior change, sees nothing | This ADR's Option A defers the consuming `includePlugins` parameter | Document in the smoke output and in the helpers' JSDoc that the consuming surface is Phase 2; reference this ADR. When the queen approves Phase 2, that ADR cites this one and removes the SKIP gating. |
| Plugin manifest path layout drifts between upstream and fork | R-A §"Open questions" #4 + this ADR's spot-check | Fork layout currently matches upstream's three-candidate path search; verified pre-merge. If fork ever adds a fourth plugin location, the helpers' search list needs extension. Same risk as upstream carries. |
| JSON parse errors in `loadPluginManifest` are silently swallowed | Upstream pattern: `try { return JSON.parse(...) } catch { /* skip */ }` (verified at upstream lines 79-80) | **This is a known upstream-pattern silent-catch.** Per `[[feedback-best-effort-must-rethrow-fatals]]`: malformed `plugin.json` should arguably surface a warning, not be silent. Recommendation for the implementer: keep the upstream pattern verbatim for first-land (parity), then file a follow-up ADR to discriminate fatal-vs-best-effort if the silent skip causes operator confusion in practice. Not a blocker for this ADR. |

## Compatibility with archivist

**Phase 4 helpers-only does NOT touch the archivist seam.**

Per R-A §"Archivist write-path conflict" analysis (ADR-130, sibling section): *"ADR-129 does NOT touch archivist substrate"* — same applies to Phase 4 specifically:

* `loadPluginManifest` reads `<cwd>/plugins/<name>/.claude-plugin/plugin.json` via `fs.readFileSync`. This is reading **bundled config files at process start time** — outside the archivist substrate model entirely. Per [[ADR-0253]] C1/C2/C3, the substrate model covers internal state (RVF, FS-JSON staging, SQLite carve-outs); reading static config files (plugin manifests, `package.json`, etc.) does not.
* `extractPluginSkills` is a pure function operating on an in-memory JS object.
* Neither helper writes any state, opens any database, holds any lock, or interacts with `RvfBackend`, `routeMemoryOp`, the daemon's FS-JSON Archivist (C1), the two unmigrated RVF-flock workers (C2), or the staging-substrate FS-JSON in-lock-commit path (C3).

**No ADR-0253 amendment required for this ADR. No `wasm-agents/store.json` carve-out interaction** (the helpers don't touch that file either).

When Phase 2 eventually lands, the `wasm_agent_compose` handler that consumes these helpers will need its own archivist disposition — specifically: does `wasm_agent_compose` persist composed RVFs to the fork's `<projectRoot>/.claude-flow/wasm-agents/store.json`, or are RVFs returned to the caller as base64 and forgotten? ADR-0254 §"Phases 1-3 — gated on four design questions" gating #2 is exactly that question. Phase 4 helpers-only sidesteps it by not landing the consumer.

## Rollback plan

If Phase 4 helpers land and we need to back them out, the minimum revert surface is:

1. **`forks/ruflo`**: `git revert <implementing-commit-sha>` on the trunk. The implementing commit touches only the 3 files named in §"Files affected" rows 1-3; revert is a clean diff.
2. **`ruflo-patch`**: remove the INTEGRATION-LEDGER row added per §Step 4. Optionally amend this ADR's status from `proposed` (after the implementing commit) → `superseded by ADR-NNNN` (where NNNN is the rollback's own ADR).

**No downstream consumers to coordinate.** The helpers are not referenced from anywhere in the fork's MCP surface (Option A explicitly defers their consumption). No plugin's `plugin.json` has the `rvagent` block populated yet; reverting the helpers has zero behavioral impact on existing plugins.

**Rollback trigger conditions** (when revert would be considered):

* The smoke breaks repeatedly with no actionable root cause (low-probability — the helpers are pure).
* A future Phase 2 design decision settles on a different plugin-bridge contract (e.g., a different field name than `rvagent`, or a different exposeSkillsAsTools shape). In that case, the Phase-2-implementation ADR would supersede this one and the helpers would be replaced, not removed in isolation.

## Open questions

The devil's advocate may surface these. All grounded in the analysis above.

1. **Should the JSON parse silent-catch be tightened?** Upstream uses `try { ... } catch { /* skip */ }`. Per `[[feedback-best-effort-must-rethrow-fatals]]`, malformed `plugin.json` is arguably a fatal-data-integrity error. Option A preserves upstream behavior for parity; a follow-up ADR could discriminate.
2. **Should we ship a TS-level unit test for `loadPluginManifest` alongside the .mjs smoke?** The smoke covers fixture-level parsing; the TS unit test would add file-IO coverage. Not strictly required for the pilot but adds isolation. Implementer's choice.
3. **Should fork plugins opportunistically add `rvagent` blocks to their `plugin.json` now (with helpers landed but no consumer)?** No behavioral effect today; signals intent for Phase 2. Defer to Phase 2 land.
4. **Does the upstream smoke's 2 SKIP'd assertions need a separate follow-up ADR documenting the SKIP?** No — the SKIPs are Option A's documented scope (this ADR), not a silent gap. The smoke's output explains them inline.

### Consequences

* Good, because **Phase 4 ADR-129 pilot lands** — closes the disposition trigger in ADR-0254 §"Phase 4 — pick now" with concrete code.
* Good, because **Two helpers ready for Phase 2 wire-up** — when Phase 2's three gating questions resolve, the `includePlugins` parameter in `wasm_agent_compose` consumes these helpers verbatim; no rework required.
* Good, because **Smoke + CI guard against helper rot** — fixture-level validation runs on every push; helpers cannot regress silently before Phase 2.
* Good, because **Plugin authors can begin adding `rvagent` blocks opportunistically** — the helpers gracefully skip missing/malformed blocks, so a plugin that declares the field before Phase 2 lands sees no behavior change but stays forward-compat.
* Bad, because **Helpers are unreachable from MCP callers** until Phase 2 lands. This is the Phase 2/4 coupling surfaced in §"Phase 4 ↔ Phase 2 coupling" — acceptable per Option A's framing, but a real functional gap until Phase 2 closes.
* Bad, because **The smoke ships with 2 SKIP'd assertions** (the `wasm_agent_compose` block existence checks). Not noise — the SKIPs are documented gates — but a future reader who runs the smoke without context will see SKIPs and may file an issue. Mitigation: the smoke's exit-code is 0 with SKIPs, and the JSDoc on the helpers references this ADR.
* Bad, because **Phase 4 verdict "lands as-is" in ADR-0254 was partially aspirational** — this ADR corrects the framing. ADR-0254 stays factually intact (it dispositioned Phase 4 as the low-risk pilot, which it is); this ADR adds the operational detail that "low-risk" means "helpers only, no `includePlugins` consumer."
* Neutral, because **No INTEGRATION-LEDGER entry in this ADR.** Per ADR-0254 §"Neutral" row 2: *"When Phase 4 of ADR-129 actually lands, the ledger row is added then."* This ADR plans Phase 4; the ledger row gets appended in Step 4 of the implementation by the agent that lands the cherry-pick.
* Neutral, because **No upstream divergence introduced.** Option A picks upstream's helpers verbatim; the only fork-local change is the smoke's skip-gating, which is forward-compat with upstream's full Phase 2+4 shape (the gates become PASS once Phase 2 lands).
* Neutral, because **No code change in this ADR itself.** This is an implementation-plan ADR per the ADR-0254 hand-off; the implementation commit follows.

### Confirmation

1. R-A's finding (`docs/research/2026-05-25-adr129-rvagent-upstream-trace.md`) and ADR-0254 (the parent disposition) remain in-corpus as the evidence base for this implementation plan.
2. If Phase 4 helpers land per this ADR, the implementing commit cites ADR-0256 in its commit message: e.g., `feat(ADR-0256): ADR-129 P4 plugin-bridge helpers (Option A — helpers-only)`.
3. If Phase 2 lands subsequently (resolving ADR-0254's three remaining gating questions), the Phase 2 ADR cites this one as the helper-prerequisite and the smoke's 2 SKIP'd assertions are un-gated as part of that land.
4. If a future audit re-flags the helpers as dead code, the auditor cites this ADR as the pre-existing disposition explaining the Phase 2/4 split.
5. If the queen prefers Option B (Phase-2-lite stub) or Option C (full deferral) instead, this ADR's status flips to `rejected — superseded by ADR-NNNN` and the alternative ADR carries the implementation plan.

## More Information

* [[ADR-0254]] — parent disposition. Names Phase 4 as the low-risk pilot for landing.
* `docs/research/2026-05-25-adr129-rvagent-upstream-trace.md` — R-A's upstream trace; §"Integration points" map of fork files Phase 4 touches.
* Upstream ADR-129 design doc: `git -C /Users/henrik/source/ruvnet/ruflo show 47a7825b0:v3/docs/adr/ADR-129-rvagent-full-integration.md` — read for context; the Phase 4 section starts under §"Phase 4 — Plugin bridge contract."
* Upstream impl commit: `47a7825b0` (`feat(rvagent): #ADR-129 — full rvagent integration (4 phases) (#2123)`). Phase 4 hunks live inline with `// ── ADR-129 P4 ──` comment markers (no separate sub-commit hash; squashed in the merge).
* Upstream final-file Phase 4 helper positions (post-`47a7825b0`):
  * `loadPluginManifest`: `v3/@claude-flow/cli/src/mcp-tools/wasm-agent-tools.ts:70-86`.
  * `extractPluginSkills`: `:88-101`.
  * `includePlugins` parameter declaration: `:350` (inside `wasm_agent_compose`).
  * Plugin-loop in compose handler: `:386-394`.
* `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/wasm-agent-tools.ts` — fork target file (519 lines pre-pick; ~559 after Option A).
* `forks/ruflo/scripts/smoke-*.mjs` — convention reference for the new smoke (see `smoke-agent-execute-providers.mjs`, `smoke-attribution-opt-in.mjs`, etc.).
* `forks/ruflo/.github/workflows/v3-ci.yml` — convention reference for the new CI job.
* [[ADR-0253]] — FS-JSON staging carve-out + 2 unmigrated workers. Confirmed: Phase 4 helpers do not touch any C1/C2/C3 surface.
* Memory `[[feedback-no-fallbacks]]` — informs the "no stub that silently ignores documented inputs" rejection of Option B.
* Memory `[[feedback-best-effort-must-rethrow-fatals]]` — informs the open question about the JSON parse silent-catch.
* Memory `[[feedback-update-integration-ledger]]` — informs the §Step 4 ledger-row-appending requirement on the implementing commit.
* Memory `[[feedback-trunk-only-fork-development]]` — informs the §Step 4 push-target requirement.
* Memory `[[feedback-corpus-evidence-before-feature-work]]` — informs the §"Phase 4 ↔ Phase 2 coupling" honesty about the upstream commit's inline P2/P4 phase markers.
