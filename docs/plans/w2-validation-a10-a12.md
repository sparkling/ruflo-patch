# W2-V4 Validator — A10, A11, A12 (READ-ONLY)

**Date**: 2026-04-17
**Scope**: three post-fix commits on `main`
**Mode**: READ-ONLY (no edits)

| # | Commit | Subject | Verdict |
|---|--------|---------|---------|
| A10 | `355a6e84` | transfer tools — network probe removed | **PASS** (with note) |
| A11 | `cfbb56f` | P2 agent-lifecycle checks spawn first | **PASS** |
| A12 | `58c75fd` | file-output 3 PASS + 2 skip_accepted | **PARTIAL** — 1 skip rationale is factually wrong |

---

## A10 — `lib/acceptance-transfer-checks.sh` (355a6e84)

**Core question**: Is the offline-fallback shape the real product contract, or should the check prove IPFS reachability?

**Finding**: Offline-fallback **is** the real product contract.

Evidence (read from fork source, not inferred):

- `forks/claude-flow/v3/@claude-flow/cli/src/transfer/store/discovery.ts:212` emits `⚠ [Discovery] Using built-in fallback registry (may be outdated)` — a deliberate, logged, first-class code path.
- Same file line 316: `Get built-in genesis registry (always available offline)` — explicit contract: `seraphine-genesis-v1` is **seeded** into `featured`, `trending`, and `newest`.
- `plugins/store/discovery.ts:241–244` seeds 21 real `@claude-flow/*` plugins with `trustLevel:"official"` into the `official` fallback array.

So the old network probe (grep stderr for `ECONNREFUSED`) had two ADR-0082 violations as the commit message claims, and the corrected per-tool narrow regexes match the real contract. Each pattern is bound to the **specific shape the offline code path emits** — if upstream flips to real IPFS, the envelope will change and the check will fail loudly. That is the ADR-0082 discipline working correctly.

**Note (not a blocker)**: `check_adr0094_p4_transfer_plugin_search` asserts `isError:true` as a known-upstream-bug boundary. The commit message says the check "will fail loudly if upstream fixes the bug". This is correct, but there's no linked upstream issue number in the file comment — recommend adding a `// See fork issue #XXX` when one is filed, so the trigger for unblocking is discoverable.

**Verdict**: Offline-fallback is the product contract. Checks correctly verify it. PASS.

---

## A11 — `lib/acceptance-agent-lifecycle-checks.sh` (cfbb56f)

**Scope**: 4 checks (`p2-ag-status`, `p2-ag-health`, `p2-ag-terminate`, `p2-ag-update`) previously operated on agent IDs that were never created.

**Finding**: Fix is correct.

1. Schema verified against upstream `agent_spawn`: `agentType` (not `type`), `agentId` (not `name`) — see every `agentType`/`agentId` reference in lines 117–118, 176–177, 203, 300.
2. `_agent_spawn_fixed_id` helper (line 198) establishes the prereq before the target op. Spawn-unavailable is classified as `skip_accepted` (line 222); spawn-failed-for-other-reason is `false` (line 227). Three-way discipline (ADR-0090 Tier A2) preserved.
3. `_agent_spawn_fixed_id` uses `_run_and_kill` whose exit code is unreliable per the documented footgun — but this helper **uses output-pattern matching** (`spawned|success|$agent_id` at line 208) rather than `$_RK_EXIT`, so it dodges the trap. This is the correct pattern.
4. `check_adr0094_p2_agent_health` (line 237) has a softer contract — it falls through and calls `agent_health` even if spawn failed, on the grounds that the tool may report empty set. That's acceptable; `agent_health` semantics don't strictly require a populated store.

**Verdict**: PASS.

---

## A12 — `lib/acceptance-file-output-checks.sh` (58c75fd)

Three real upgrades (1, 3, 5) correctly replace skip_accepted with behavioral verification. Two remain skips — and one skip rationale is **factually wrong**.

### Check 2 — `p7-fo-swarm-ag` (`.swarm/agents.json`) — skip_accepted

The commit claims `.swarm/agents.json` is never produced. Partially true:

- `forks/claude-flow/v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts:98` writes to `.claude-flow/agents.json` (**not** `.swarm/agents.json`).
- So `.swarm/agents.json` at *that specific path* is indeed vestigial.

But the check's rationale undersells the artifact-naming confusion: there IS a `.claude-flow/agents.json` (singular), separate from `.claude-flow/agents/store.json` (covered by Check 1). The skip is defensible at the claimed path, but the rationale should acknowledge the two-file naming split rather than claim "agents live only in `.claude-flow/agents/store.json`".

**Verdict**: skip rationale is partially correct but incomplete. Not a blocker — the `skip_accepted` + "upgrade on reappearance" trigger is sound.

### Check 8 — `p7-fo-settings` (`.claude/settings.json`) — skip_accepted on `mcpServers`

**Rationale is wrong**. The commit message and inline doc both state:

> `mcpServers` is user-driven via `claude mcp add`, not init template output. No sibling `.mcp.json` is produced by ruflo/cli `init --full`.

Upstream source directly contradicts this:

- `init/executor.ts:181` — comment: `"Generate and write .mcp.json"`.
- `init/executor.ts:666` — `const mcpPath = path.join(targetDir, '.mcp.json');`.
- `init/executor.ts:675` — `result.created.files.push('.mcp.json');`.
- `init/mcp-generator.ts:47` — `const mcpServers: Record<string, object> = {};` — explicitly generates the `mcpServers` object with three servers (`claude-flow`, `ruv-swarm`, `flow-nexus`) keyed in at lines 51/66/75.

So `init --full` **does** emit `.mcp.json` at repo root with a populated `mcpServers` map. The skip is not just insufficiently justified — it is masking a real product contract that should be strictly tested.

**Verdict**: skip rationale is factually incorrect. This is exactly the kind of case where I7's proper fix (running in parallel) is required: the check should assert `.mcp.json` exists at `E2E_DIR` root and parses to include `mcpServers` with at least one server key. This is a clear ADR-0082 violation (silent-pass hiding a real contract) rather than a defensible acceptance trade-off.

---

## Summary

- **A10**: PASS. Offline-fallback is the real product contract; regexes are narrow and will fail loudly if the contract changes.
- **A11**: PASS. Prereq spawn with correct schema; three-way bucket discipline preserved; `_run_and_kill` exit-code footgun correctly avoided via output-pattern matching.
- **A12**: PARTIAL. Three upgrades are sound. Check 2 skip is defensible but with a gap in the stated rationale. **Check 8 skip rationale is factually wrong** — upstream `init/executor.ts` and `init/mcp-generator.ts` prove `init --full` emits `.mcp.json` with populated `mcpServers`. I7's parallel fix should assert this contract strictly.

**Recommendation**: allow A10 and A11 to merge; hold A12 until I7's fix for Check 8 lands, or open a tracker issue linking this validation note to ensure the skip gets upgraded before W2 is signed off.
