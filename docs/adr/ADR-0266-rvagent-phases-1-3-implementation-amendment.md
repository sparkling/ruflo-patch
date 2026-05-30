---
status: accepted
date: 2026-05-28
tags: [rvagent-wasm, implementation-amendment]
supersedes: []
depends-on: [ADR-0254, ADR-0256, ADR-0258, ADR-0259]
implements: []
---

# ADR-129 Phases 1-3 implementation amendment

## Context and Problem Statement

[[ADR-0254]] dispositioned upstream ADR-129 (`feat(rvagent): #ADR-129 full rvagent integration` — upstream commit `47a7825b0`) as `pick-partial`. Phase 4 (plugin-bridge helpers) landed via [[ADR-0256]] commit `818091545`. Phases 1-3 were gated on three design questions, two of which are now resolved:

- [[ADR-0258]] (persistence-threading): tiered per-tool wrap spec for the 17 new MCP tools (5 introspection / 1 mutator / 10 gallery-ephemeral / 1 compose-builder).
- [[ADR-0259]] (SAFE_MCP_TOOLS allowlist alignment): 29-entry final allowlist (vs upstream's 30) with hyphen renames for fork-naming-convention drift.
- Third sub-gate (the `loadRvf` signature typo at `optional-modules.d.ts:295`) is trivial; bundled into this implementation.

The two design ADRs (0258 + 0259) ARE the council outputs for this ADR. No additional council review is required — they enumerate the per-line wrapping rules and the per-tool allowlist contract. This amendment sequences the actual implementation deliverable.

Track B of the post-ADR-0261 upstream-merge completion plan (`docs/plans/2026-05-27-post-adr0261-upstream-merge-completion-plan.md` §Track B) names this ADR as the implementation amendment.

## Decision Drivers

* **Gates pre-decided.** ADR-0258 + ADR-0259 spec the load-bearing decisions. This ADR just lists the files to edit + the smoke surface.
* **3-agent parallel fan-out applicable but light** — Track B's scope is concentrated in `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/wasm-agent-tools.ts` (one file, ~300 LOC of new handlers). Limited cross-package surface compared to ADR-0261/ADR-0265 (which crossed agentdb + ruflo + ruflo-patch).
* **No upstream donate-back** per `[[feedback-no-upstream-donate-backs]]` — the persistence-threading + allowlist divergence stays fork-side.
* **Smoke wiring per ADR-0265 §L1-L4** — the lessons from prior implementation cycles apply (PARALLEL_DIR isolation, `_check_*` helper naming, shared-temp pattern if needed).

## Considered Options

* **Implement ADR-129 Phases 1-3 per the ADR-0258 + ADR-0259 specs (chosen)** — sequence the implementation deliverable using the per-tool wrapping spec (ADR-0258) and the allowlist contract (ADR-0259) as the council outputs; bundle the trivial `loadRvf` typo fix.

(No alternatives were recorded — the load-bearing decisions were pre-decided in the two design ADRs; this amendment is the implementation sequencing.)

## Decision Outcome

Chosen option: "implement per ADR-0258 + ADR-0259 specs", because those two design ADRs ARE the council outputs enumerating the per-line wrapping rules and the per-tool allowlist contract; this amendment only sequences the file edits and smoke surface.

**Accepted: implement per ADR-0258 + ADR-0259 specs.** Status flips `completed: false → true` when:

1. All 17 new MCP tool handlers exist in `wasm-agent-tools.ts` with the wrapping pattern from ADR-0258's per-tool table.
2. `SAFE_MCP_TOOLS` constant lands in `wasm-agent-tools.ts` matching ADR-0259's 29-entry final spec.
3. `loadRvf` signature typo fix at `optional-modules.d.ts:295` lands.
4. 5 smokes wire-into the canonical harness via `lib/acceptance-adr0266-checks.sh` per `[[feedback-always-wire-tests-into-cicd]]`.
5. INTEGRATION-LEDGER row 239 disposition flips from `pick-partial` to `reimplemented-via-adr-0266` (Phases 1-3 portion).

### Consequences

* Good, because the load-bearing decisions are pre-decided in ADR-0258 + ADR-0259, so this ADR only lists the files to edit and the smoke surface — a mechanical, low-risk land.
* Good, because the scope is concentrated in one file (`wasm-agent-tools.ts`, ~300 LOC of new handlers), with limited cross-package surface versus ADR-0261 / ADR-0265.
* Neutral, because the persistence-threading + allowlist divergence stays fork-side per `[[feedback-no-upstream-donate-backs]]`; no upstream donate-back.

## Implementation plan

### Phase 1 — Group 1 introspection tools (5)

Per [[ADR-0258]] §Group 1 — Agent introspection. Each tool:

- `wasm_agent_state` (upstream `wasm-agent-tools.ts:444-453`)
- `wasm_agent_todos` (`:463-472`)
- `wasm_agent_tools` (`:482-491`)
- `wasm_agent_turn_count` (`:501-511`)
- `wasm_agent_is_stopped` (`:521-531`)

Wrap pattern (matches existing `wasm_agent_files`):

```typescript
const wasm = await ensureLive(args.agentId as string);
const result = wasm.<liveCall>(args.agentId as string);
return { content: [{ type: 'text', text: JSON.stringify(result) }] };
```

### Phase 2 — Group 2 mutator (1)

`wasm_agent_reset` (`:541-551`) per ADR-0258 §Group 2:

```typescript
const wasm = await ensureLive(args.agentId as string);
const ok = wasm.resetWasmAgent(args.agentId as string);
withStoreLock(() => {
  const store = loadStore();
  const existing = store.agents[args.agentId as string];
  if (existing) {
    store.agents[args.agentId as string] = snapshotAgent(wasm, args.agentId as string, existing.config);
    saveStore(store);
  }
});
return { content: [{ type: 'text', text: JSON.stringify({ success: ok, agentId: args.agentId }) }] };
```

### Phase 3 — Group 3 gallery tools (10) + Group 4 compose builder (1) + SAFE_MCP_TOOLS

Per ADR-0258 §Group 3 + §Group 4:

- 10 gallery tools: `wasm_gallery_load_rvf` / `wasm_gallery_configure` / `wasm_gallery_categories` / `wasm_gallery_list_by_category` / `wasm_gallery_add_custom` / `wasm_gallery_remove_custom` / `wasm_gallery_import` / `wasm_gallery_export` / `wasm_gallery_active` / `wasm_gallery_config`
- `wasm_agent_compose` (`:357-431`) — ephemeral, returns base64 RVF bytes to caller; preserve AIDefence scan gate

Wrap pattern: `const wasm = await loadAgentWasm()` then call; no `ensureLive`, no `withStoreLock`.

**SAFE_MCP_TOOLS constant** per ADR-0259 final 29-entry spec — place immediately after `DESTRUCTIVE_TOOL_PATTERNS`. Hyphen-renamed entries (`hooks_post-task`, `hooks_pre-task`, `agentdb_pattern-search`, `agentdb_hierarchical-recall`) must use the hyphenated spelling exactly.

### Phase 3.5 — optional-modules.d.ts typo fix

`optional-modules.d.ts:295` — `loadRvf` signature typo, the third sub-gate from [[ADR-0254]]. Trivial; bundle into Phase 3 commit.

### Phase 5 — Verification routine

5 smokes minimum (matches ADR-0265's count) wired into `lib/acceptance-adr0266-checks.sh`:

1. `scripts/smoke-adr0266-group1-introspection.mjs` — Phase 1 ensureLive + 5 read-only call paths
2. `scripts/smoke-adr0266-group2-reset.mjs` — Phase 2 reset + re-snapshot under withStoreLock
3. `scripts/smoke-adr0266-group3-gallery.mjs` — Phase 3 10 gallery tools (each gets a quick call probe)
4. `scripts/smoke-adr0266-group4-compose.mjs` — Phase 3 wasm_agent_compose + AIDefence gate preserved
5. `scripts/smoke-adr0266-allowlist.mjs` — ADR-0259's verification §Step 2: grep each of 29 allowlist names against `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/*-tools.ts` and assert each has at least one hit

Wire into `scripts/test-acceptance.sh` with PARALLEL_DIR isolation per ADR-0265 §L2; helper naming `_check_adr0266_*` per ADR-0082 lint. Add `adr0266` to `test-acceptance-fast.sh` dispatch.

### Phase 6 — Codemod / lint guards

No new guards needed. The handlers live in `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/wasm-agent-tools.ts` which is already in the fork's codemod scope. ADR-0259's allowlist verification (Phase 5 smoke #5) is the one new release-time check.

## Acceptance criteria

| # | Criterion | Verification |
|---|---|---|
| C1 | All 5 Group 1 tools exist + wrap with `ensureLive` | grep `wasm_agent_state\|wasm_agent_todos\|wasm_agent_tools\|wasm_agent_turn_count\|wasm_agent_is_stopped` in `wasm-agent-tools.ts`; each handler's first non-arg-parse statement is `await ensureLive(args.agentId as string)`. |
| C2 | Group 2 reset wraps with `withStoreLock` + `snapshotAgent` | grep `wasm_agent_reset` in `wasm-agent-tools.ts`; the handler body calls `resetWasmAgent` then `withStoreLock(() => ... saveStore(...))`. |
| C3 | All 10 Group 3 gallery tools exist + plain `loadAgentWasm()` | grep each gallery tool name; each handler's body uses `loadAgentWasm()` (NOT `ensureLive`, NOT `withStoreLock`). |
| C4 | Group 4 compose tool exists + AIDefence scan preserved on gallery_import (see §Revision 1) | grep `wasm_agent_compose` in `wasm-agent-tools.ts`; the handler invokes `loadAgentWasm()` + `buildRvfContainer`. Separately grep `wasm_gallery_import`; that handler invokes the AIDefence `defence.detect()` (fork analog of upstream's `defence.scan()`) before WASM deserialization. |
| C5 | `SAFE_MCP_TOOLS` constant exists with 29 entries | grep `SAFE_MCP_TOOLS = new Set` in `wasm-agent-tools.ts`; the Set has 29 string literals matching ADR-0259's final spec verbatim. |
| C6 | `loadRvf` signature typo fixed | grep the signature at `optional-modules.d.ts:295` for the corrected form per ADR-0254's typo description. |
| C7 | Each allowlist name resolves to a real fork tool | Phase 5 smoke #5 — grep each of 29 names against `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/*-tools.ts`. Every name produces ≥1 hit; smoke FAILs loudly on any miss. |
| C8 | All 5 smokes wired into canonical harness | `lib/acceptance-adr0266-checks.sh` defines them; `bash scripts/test-acceptance-fast.sh adr0266` runs them; all PASS in CI. |

## Risks

| Risk | Mitigation |
|---|---|
| Upstream's handler bodies expect runtime state our `ensureLive` doesn't provide | Per ADR-0258, the wrap pattern includes `ensureLive` BEFORE the live call; the cold-process rehydrate path is the load-bearing piece. If a specific handler trips up post-implementation, log a fork-side amendment to the wrap pattern in this ADR's §Revision 1. |
| `wasm_agent_compose`'s AIDefence scan diverges between upstream + fork in subtle ways | Preserve upstream's scan call verbatim in Phase 3; the AIDefence integration is already in fork via ADR-0218 / ADR-0256. |
| `SAFE_MCP_TOOLS` list drifts from actual fork tool registry over time | Phase 5 smoke #5 (Allowlist verification) is the standing gate. Run on every release; if any name fails to resolve, fork-update the allowlist in this ADR's amendment chain. |
| `wasm_gallery_categories` may or may not exist depending on Phase 3 land status | Per ADR-0259, land Phase 3 + the allowlist entry in the same commit batch (preferred). Smoke #5 has the loud-fail safety net if the rule is violated. |

## More Information

Original status: accepted and implemented 2026-05-28 (`completed: true`). This ADR implements the vision of upstream ADR-129; ADR-129 is an upstream design doc, not a fork-corpus ADR, so it is referenced in prose rather than via the `implements` frontmatter slot.

- Upstream PR `47a7825b0` — `feat(rvagent): #ADR-129 — full rvagent integration (4 phases) (#2123)`
- [[ADR-0254]] — disposition + 3 gates
- [[ADR-0256]] — Phase 4 plugin-bridge helpers (already landed via fork commit `818091545`)
- [[ADR-0258]] — persistence-threading design gate (council output for this ADR)
- [[ADR-0259]] — SAFE_MCP_TOOLS allowlist alignment (council output for this ADR)
- [[ADR-0261]] — implementation pattern precedent (council + revision + 3-agent fan-out + smokes)
- [[ADR-0265]] — implementation pattern precedent (Phase 2a/2b cross-compile + per-platform sub-packages)
- `[[feedback-no-upstream-donate-backs]]` — persistence + allowlist divergence stays fork-side
- `[[feedback-always-wire-tests-into-cicd]]` — Phase 5 smokes go through the canonical harness
- `docs/plans/2026-05-27-post-adr0261-upstream-merge-completion-plan.md` §Track B — names this ADR

## Revision 1 — C4 AIDefence handler location corrected

**2026-05-28**: C4's original prose said the AIDefence scan lives on `wasm_agent_compose`. Verified against upstream `47a7825b0`: AIDefence scan actually lives on `wasm_gallery_import` (the HIGH-RISK template-deserialization tool) — the upstream `wasm_agent_compose` handler does NOT scan, since it only packs caller-provided skills (no JSON template deserialization). The fork's implementation correctly preserves AIDefence on `wasm_gallery_import` per upstream pattern. C4 criterion above amended accordingly. Smoke `scripts/smoke-adr0266-group4-compose.mjs` updated to grep both handlers.

## Confirmation

This ADR is **accepted, completed: true** as of 2026-05-28:

1. ✅ **Design ratified** — ADR-0258 + ADR-0259 are the council outputs; ADR-0266 sequenced the implementation.
2. ✅ **Implementation** — 3 fork commits landed (`765153bb4`, `be1e5c066`, `20374da67`): 17 new MCP tool handlers + 29-entry `SAFE_MCP_TOOLS` allowlist + agent-wasm.ts wrappers; Phase 3.5 typo fix already in place (fork commit `0fc2fbb07`).
3. ✅ **Validate + commit + release + push** — fast-acceptance: 5/5 ADR-0266 smokes PASS. Force-rebuild release pipeline confirmed cross-package symbols resolve (per `feedback-pipeline-shared-skip-on-dist-clear`). INTEGRATION-LEDGER row 240 amended `pick-partial` → `reimplemented-via-adr-0266`.
4. ✅ **Acceptance criteria audit** — C1-C7 verified by 5 smokes; C8 wired (`lib/acceptance-adr0266-checks.sh` + `scripts/test-acceptance.sh` adr0266 block + `scripts/test-acceptance-fast.sh` adr0266 dispatch + `.github/workflows/v3-ci-rvagent.yml`).
5. ✅ **ADR-0254 gates resolved** — Persistence-threading (0258), allowlist alignment (0259), `loadRvf` typo (0fc2fbb07) all closed; implementation gate closed by this ADR.
