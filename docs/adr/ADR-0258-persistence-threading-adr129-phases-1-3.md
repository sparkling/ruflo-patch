---
status: proposed
date: 2026-05-25
tags: [upstream-sync, rvagent-wasm, persistence, ADR-129, design-gate]
supersedes: []
depends-on: [ADR-0254, ADR-0256]
implements: []
---

# Persistence threading decisions for ADR-129 Phases 1-3 MCP tools

## Context and Problem Statement

[[ADR-0254]] dispositioned upstream ADR-129 as `pick-partial`: Phase 4 (plugin bridge helpers) landed under [[ADR-0256]]; Phases 1-3 are gated on three remaining design questions. This ADR resolves the second of those: **persistence-layer threading for the 16 new MCP tools that ADR-129 Phases 1-3 introduce.**

Fork's `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/wasm-agent-tools.ts` carries a substantial cross-process persistence layer that upstream's PR has no awareness of:

* Every MCP tool call is a separate CLI process — the in-memory `agents` Map in `agent-wasm.ts` is empty at every fresh start (`wasm-agent-tools.ts:1-15` header).
* State is persisted to `<projectRoot>/.claude-flow/wasm-agents/store.json` with `PersistedAgent {id, config, info, state, tools, todos, stateSnapshotAt}` (`wasm-agent-tools.ts:105-126`).
* `withStoreLock()` (`:192-240`) is an O_CREAT|O_EXCL advisory lock with 5s budget, exponential backoff with jitter, stale-PID detection, and loud-fail on timeout — same shape as RVF's `acquireLock` per ADR-0095.
* `snapshotAgent()` (`:252-272`) re-reads `getWasmAgent`/State/Tools/Todos and packages them for write.
* `ensureLive()` (`:283-304`) reconstructs a fresh `WasmAgent` from saved config when the live registry doesn't have it (cold process), then re-keys it under the persisted id via `rehydrateWasmAgent`.
* `saveStore()` (`:170-177`) does atomic tmp-then-rename — no half-written file ever visible.

Upstream's post-129 `wasm-agent-tools.ts` (`/Users/henrik/source/ruvnet/ruflo` commit `47a7825b0`) calls `wasm.resetWasmAgent`, `wasm.getWasmAgentState`, `wasm.galleryAddCustom`, etc. directly without any persistence wrapping (sample: upstream `wasm-agent-tools.ts:541-551` for `wasm_agent_reset`, `:444-453` for `wasm_agent_state`, `:634-642` for `wasm_gallery_add_custom`). Picking the upstream handlers verbatim would break the fork's cross-process model: a `wasm_agent_reset` call in one process would clear in-memory state that the next process's `ensureLive` would just rehydrate from stale disk.

Each of the 16 new tools must be classified before landing.

## Decision Drivers

* **Cross-process model is load-bearing.** Each MCP call is a separate CLI process per fork's persistence-layer comment (`wasm-agent-tools.ts:4-8`). Anything that mutates agent state and is intended to outlive the current process must persist. Anything that's a pure read against the live process is allowed to be ephemeral, *provided* the live process is guaranteed to exist (i.e., we `ensureLive` first).
* **Honor existing patterns.** Existing tools wrap consistently: `wasm_agent_prompt` (`wasm-agent-tools.ts:371-389`) and `wasm_agent_tool` (`:402-423`) both call `ensureLive` then re-snapshot under `withStoreLock`; `wasm_agent_files` (`:485-494`) and `wasm_agent_export` (`:506-514`) `ensureLive` but don't re-snapshot (they're read-only against live state). Replicate this discipline for the new tools.
* **Gallery state lives inside the WASM runtime, not on disk.** The gallery is a `@ruvector/rvagent-wasm` internal data structure (`forks/ruvector/npm/packages/rvagent-wasm/rvagent_wasm.d.ts:143-195`). Configure/add/remove/import mutate runtime state of the gallery itself, not of any specific persisted agent. The persistence question for gallery tools is "do we need to persist *gallery* state across processes" — answered No for two reasons: (a) the WASM gallery state lives inside the in-process WASM module which is freshly instantiated per `loadAgentWasm`, so cross-process is already impossible; (b) the gallery's primary surface is read-only listing/search/template-create. Custom-template CRUD is a fork-secondary surface.
* **Composed RVF state has no persistent identity.** `wasm_agent_compose` builds an RVF byte buffer and returns it base64-encoded (per upstream `wasm-agent-tools.ts:415-427`). It does NOT create a registered agent. There's no `agentId` to thread through `ensureLive` or `snapshotAgent` because no agent exists yet. The composition is a *pure builder* — its output is the caller's to own.
* **`feedback-no-fallbacks`.** Where the live registry can't be rehydrated, the handler must surface a real error to the caller — the existing `ensureLive` lets the inner op throw "WASM agent not found" (per fork `:289-294`), which is the honest signal.

## Considered Options

* **Option A — Persist every state-touching tool, including composed RVFs.** Wrap all 16 tools with `ensureLive`/`snapshotAgent`. Add a new `composed?: boolean` or `rvfBytes?: string` field to `PersistedAgent`. Rejected because (a) composed RVFs have no `agentId` — they're builder output, not an agent record; (b) base64'd RVF bytes can be large and we have no recovery semantics for them (no "re-instantiate from composed RVF" call exists); (c) the gallery CRUD tools operate on WASM-internal gallery state, not on per-agent state — there's no `PersistedAgent` row to attach them to.
* **Option B — Tier the 16 tools by what they actually touch (this ADR).** Classify each as ephemeral (no persistence) or persisted (threads through `ensureLive` + `snapshotAgent`). Composed RVFs ship as ephemeral output (returned to caller, not persisted by ADR-129 itself). Re-snapshot only when an agent's `PersistedAgent` state advances.
* **Option C — Skip persistence entirely; require callers to re-create agents per process.** Rejected because it regresses fork's existing create-then-op-then-introspect lifecycle that the persistence layer was added to support.

## Decision Outcome

Chosen: **Option B — Tier the 16 tools by state surface.**

### Per-tool classification

The 16 tools fall into four groups by state surface. Each line cites the upstream handler line range (post-129 commit `47a7825b0`) and the fork-side wrapping pattern to apply.

#### Group 1 — Agent introspection (5 tools): `ensureLive` + read-only, no re-snapshot

These read live state from a specific agent. Cold processes must rehydrate first (else `getWasmAgent` returns nothing); they don't mutate so no re-snapshot.

| # | Tool | Upstream line | State touched | Fork wrap |
|---|---|---|---|---|
| 1 | `wasm_agent_state` | `444-453` | Reads `WasmAgent.get_state()` | `await ensureLive(agentId)` then call; no re-snapshot |
| 2 | `wasm_agent_todos` | `463-472` | Reads `WasmAgent.get_todos()` | `await ensureLive(agentId)` then call; no re-snapshot |
| 3 | `wasm_agent_tools` | `482-491` | Reads `WasmAgent.get_tools()` | `await ensureLive(agentId)` then call; no re-snapshot |
| 4 | `wasm_agent_turn_count` | `501-511` | Reads `WasmAgentInfo.turnCount` | `await ensureLive(agentId)` then call; no re-snapshot |
| 5 | `wasm_agent_is_stopped` | `521-531` | Reads `WasmAgentInfo.isStopped` | `await ensureLive(agentId)` then call; no re-snapshot |

Pattern (matches existing `wasm_agent_files` at `wasm-agent-tools.ts:485-494`):

```typescript
const wasm = await ensureLive(args.agentId as string);
const result = wasm.getWasmAgentState(args.agentId as string); // or get_todos / get_tools / etc.
return { content: [{ type: 'text', text: JSON.stringify(...) }] };
```

#### Group 2 — Agent mutator (1 tool): `ensureLive` + mutate + re-snapshot

This advances `PersistedAgent.state` and `.info.turnCount`. Must persist.

| # | Tool | Upstream line | State touched | Fork wrap |
|---|---|---|---|---|
| 6 | `wasm_agent_reset` | `541-551` | `WasmAgent.reset()` — clears messages + turn count | `await ensureLive(agentId)`; call `resetWasmAgent`; `withStoreLock(() => saveStore({...store, agents: {...store.agents, [id]: snapshotAgent(wasm, id, existing.config)}}))` |

Pattern (matches existing `wasm_agent_prompt` at `wasm-agent-tools.ts:371-389`):

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

#### Group 3 — Gallery state, ephemeral (10 tools): no persistence layer

These touch the WASM module's internal gallery state. The gallery is re-instantiated per process when `loadAgentWasm()` first runs (see `loadAgentWasm` at `wasm-agent-tools.ts:21-24`); cross-process persistence of gallery mutations is **not in scope for ADR-129** (it would require a separate `gallery.json` substrate plus mutex, which is out of band).

Each handler is plain: `const wasm = await loadAgentWasm()`, then call. Existing `wasm_gallery_list` (`wasm-agent-tools.ts:520-528`) is the model.

| # | Tool | Upstream line | State touched | Fork wrap |
|---|---|---|---|---|
| 7 | `wasm_gallery_load_rvf` | `563-573` | Reads `WasmGallery.loadRvf(id)` → `Uint8Array` | `loadAgentWasm()` then call; ephemeral |
| 8 | `wasm_gallery_configure` | `583-591` | `WasmGallery.configure(JSON)` — mutates in-WASM config | `loadAgentWasm()` then call; ephemeral |
| 9 | `wasm_gallery_categories` | `597-605` | Reads `WasmGallery.getCategories()` | `loadAgentWasm()` then call; ephemeral |
| 10 | `wasm_gallery_list_by_category` | `615-624` | Reads `WasmGallery.listByCategory(cat)` | `loadAgentWasm()` then call; ephemeral |
| 11 | `wasm_gallery_add_custom` | `634-642` | `WasmGallery.addCustom(JSON)` — mutates in-WASM gallery | `loadAgentWasm()` then call; ephemeral |
| 12 | `wasm_gallery_remove_custom` | `652-661` | `WasmGallery.removeCustom(id)` — mutates in-WASM gallery | `loadAgentWasm()` then call; ephemeral |
| 13 | `wasm_gallery_import` | `679-711` | `WasmGallery.importCustom(JSON)` after AIDefence scan | `loadAgentWasm()` then call; ephemeral; preserve AIDefence gate verbatim |
| 14 | `wasm_gallery_export` | `717-725` | Reads `WasmGallery.exportCustom()` | `loadAgentWasm()` then call; ephemeral |
| 15 | `wasm_gallery_active` | `731-739` | Reads `WasmGallery.getActive()` | `loadAgentWasm()` then call; ephemeral |
| 16 | `wasm_gallery_config` | `745-753` | Reads `WasmGallery.getConfig()` | `loadAgentWasm()` then call; ephemeral |

A follow-up ADR may revisit gallery persistence if the fork-side cross-process gallery story becomes important. Out of scope for the ADR-129 land.

#### Group 4 — Compose builder (1 tool): ephemeral, returns RVF to caller

This is the load-bearing decision the gate explicitly named (R-A §"Open questions" #2; [[ADR-0254]] Phase 1-3 gating table #2).

| # | Tool | Upstream line | State touched | Fork wrap |
|---|---|---|---|---|
| 17 (counted with 16 above is the new tool count; this is the same line as upstream's P2 plus the P4 hook) | `wasm_agent_compose` | `357-431` | Builds RVF via `buildRvfContainer` — no agent created | `loadAgentWasm()` then call; **ephemeral** — RVF bytes are returned base64-encoded as the response, NOT persisted in `store.json` |

The verdict on composed-RVF persistence is **EPHEMERAL**:

* **No agent identity exists.** `wasm_agent_compose` does not call `createWasmAgent`. Its output is a base64 byte string, not a `WasmAgentInfo` with an id. The `PersistedAgent` schema is keyed on `id: string`; there's no key to record this output under.
* **No recovery path exists.** The fork has no "instantiate WasmAgent from composed RVF bytes" call. `createWasmAgent(config)` takes `{model, instructions, maxTurns}`, not a byte buffer. Persisting RVF bytes would create a useless record.
* **Composed RVFs are caller-owned artifacts.** The caller is expected to save the base64 string to wherever it manages its RVF inventory (e.g., the gallery via a subsequent `wasm_gallery_add_custom` or `wasm_gallery_import` call) — the compose tool's job ends at "return the bytes."
* **Forward-compatible schema not changed.** No `PersistedAgent.rvf?` or `PersistedAgent.composed?` field is added. The proposed schema-change branch in R-A is closed by this decision.

If a future ADR introduces "register a composed RVF as a runnable agent," that ADR will own its own persistence schema. This ADR forecloses by stating: as of ADR-129 Phases 1-3, `wasm_agent_compose` is a pure builder.

### Verification (post-implementation)

When Phases 1-3 land (a separate implementation ADR), the implementer must:

1. Confirm Group 1 handlers all start with `await ensureLive(args.agentId as string)` and the immediate next call is the live read.
2. Confirm Group 2 (`wasm_agent_reset`) re-snapshots inside `withStoreLock` against the persisted config.
3. Confirm Group 3 handlers use plain `await loadAgentWasm()` (no `ensureLive`, no `withStoreLock` — gallery is not per-agent).
4. Confirm Group 4 (`wasm_agent_compose`) returns the RVF base64 in the response and does NOT write to `store.json`.
5. Confirm `PersistedAgent` interface is unchanged in shape (no new fields).
6. Smoke `scripts/smoke-wasm-rvf-compose.mjs` must validate the returned base64 round-trips through `WasmRvfBuilder.validate()` — no `store.json` artifact created.

## Consequences

### Positive

* **Per-tool ambiguity is resolved.** Each of the 16 tools has a named pattern with an existing wrapper to copy. The persistence-threading work for Phases 1-3 becomes mechanical.
* **`wasm_agent_compose` decision is explicit.** Ephemeral verdict closes the open question R-A surfaced. No schema change. No regret-prone "in case we need it later" carve-out.
* **No new substrate seam.** The decision avoids introducing per-gallery cross-process persistence (which would be its own substrate and require its own lock/atomic-write story).
* **Existing patterns reused.** Group 1 = `wasm_agent_files` pattern. Group 2 = `wasm_agent_prompt` pattern. Group 3 = `wasm_gallery_list` pattern. Group 4 = pure builder.

### Negative

* **Gallery mutations don't survive across processes.** A `wasm_gallery_add_custom` call in process A is invisible to process B's gallery in the same project. This is the trade-off for not adding a gallery substrate; if a future use case requires cross-process gallery state, a follow-up ADR will introduce the substrate at that time.
* **`wasm_agent_compose` callers must explicitly manage RVF outputs.** No "the compose tool will remember it for you" affordance. The base64 lives in the caller's response; they must save it if they want it later.

### Neutral

* **No code change in this ADR.** This is a decision-only ADR; Phases 1-3 implementation lands in a separate commit under its own implementation ADR. The classification table above is the implementer's spec.
* **Three of the four gates remain.** [[ADR-0254]] Phases 1-3 gating list still has SAFE_MCP_TOOLS allowlist audit and the `loadRvf` signature typo. This ADR resolves only the persistence-threading gate. The other two are resolved by sibling ADRs.

## Confirmation

1. If Phases 1-3 land in a follow-up implementation ADR, that ADR's commit references this ADR for the per-tool persistence pattern.
2. If a future ADR proposes cross-process gallery persistence, it cites this ADR for the "out-of-scope-for-129" framing it must amend.
3. If a future ADR proposes composed-RVF persistence (e.g., as a registered runnable agent), it cites this ADR's §Decision Group 4 for the foreclosure it must explicitly supersede.

## More Information

* `docs/research/2026-05-25-adr129-rvagent-upstream-trace.md` — R-A finding; §"Open questions" #2 is the open question this ADR resolves.
* `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/wasm-agent-tools.ts` — fork's persistence layer (`:99-304`) and existing wrap patterns (`wasm_agent_prompt` `:371-389`, `wasm_agent_tool` `:402-423`, `wasm_agent_files` `:485-494`).
* Upstream `47a7825b0:v3/@claude-flow/cli/src/mcp-tools/wasm-agent-tools.ts` — the 16 new tools at lines 437-755 (rendered to `/tmp/upstream-wasm-agent-tools-129.ts` for analysis).
* `[[ADR-0254]]` — parent disposition; Phase 1-3 gating list amended to 3 questions after OpenRouter resolved.
* `[[ADR-0256]]` — Phase 4 (plugin bridge) landed already; helpers exist at `wasm-agent-tools.ts:26-97`.
* `[[ADR-0095]]` — RVF advisory-lock pattern that `withStoreLock` mirrors.
* `[[ADR-0181]]` — Archivist seam restoration; gallery-as-non-archivist-substrate decision in this ADR aligns with the seam not absorbing every disk-state surface.
* Memory `[[feedback-no-fallbacks]]` — corpus rule informing the "fail loud on cold-process rehydrate" stance; `ensureLive` lets the inner op throw the honest signal rather than swallow.
