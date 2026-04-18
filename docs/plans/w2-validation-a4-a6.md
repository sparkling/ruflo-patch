# W2-V2 Validation: A4 / A5 / A6

Validator pass (READ-ONLY). Methodology mirrors V1: read commit → read fork source under `/tmp/ruflo-build` → classify as PASS / PARTIAL / FAIL against the ORIGINAL INTENT (end-to-end tool behavior) versus mere wiring.

## Signoff Table

| Agent | Commit | Check(s) | Original intent | Current assertion | Verdict |
|-------|--------|----------|-----------------|-------------------|---------|
| A4 | `1ff6c0a` | `p4-te-close` | Close a terminal session created via `terminal_create`; verify state transition to `closed`. | Calls `terminal_create` first, extracts generated `sessionId` from JSON, passes it to `terminal_close`; asserts `closed\|success\|closedAt`. | **PASS** — genuine end-to-end round-trip. Store is file-backed (`loadTerminalStore/saveTerminalStore`) so cross-process state survives. Old `not found` laundering bug cleanly removed. |
| A5 | `1ff3e22` | `p4-wa-prompt`, `p4-wa-tool`, `p4-wa-export`, `p4-wa-files` | End-to-end: create an agent → invoke op on that agent → observe real response (prompt reply, tool result, export JSON, files/tools list). | Invokes each op against a deliberately-nonexistent `agentId`, treats the handler-layer `WASM agent not found: <id>` error as PASS. Fallback success regex kept but will never trigger cross-process. | **PARTIAL** — wiring-only. The `agents` Map (`agent-wasm.js:50`) is pure in-memory per-process; `mcp exec` is one-shot so cross-process create-then-op is architecturally impossible with the current CLI surface. Agent self-reported honestly. See Flag F2 for overclaim. |
| A6 | `21dbdfb` | `p5-ruvllm-hnsw-add`, `p5-ruvllm-hnsw-route`, `p5-ruvllm-sona-adapt`, `p5-ruvllm-microlora-adapt` | Exercise add/route/adapt logic paths against a router/SONA/LoRA instance created by the matching `_create` tool. | Uses `*-nonexistent` ID, accepts `Router not found` / `SONA not found` / `MicroLoRA not found` strings as PASS. `[OK]`-absence gate layered in front. | **PARTIAL** — wiring-only, same architectural reason as A5 (`hnswRouters`, `sonaInstances`, `loraInstances` are in-memory Maps at `ruvllm-tools.js:281-283`). |

## Top 5 Flags

### F1 — `[OK] Tool executed` gate in A6 is a no-op for its target cases (minor, correctness)
`commands/mcp.js:537` computes `toolSuccess = result.success !== false`. Ruvllm registry-miss handlers return `{content:[...], isError:true}` with no `success` field → `undefined !== false === true` → `printSuccess` fires and `[OK] Tool executed in Nms` IS printed. Therefore the new `! grep '\[OK\] Tool executed'` precondition in the skip bucket never helps distinguish anything for the four target checks; they survive because the registry-miss text matches the positive regex. Not wrong, but the commit message sells this gate as the key fix — in practice it only matters for edge cases where a handler genuinely returns `{success:false}` without emitting any matching text. Recommend either (a) drop the `[OK]` clause and document why, or (b) wire CLI so `isError:true` flips `toolSuccess`.

### F2 — A5 commit message overclaims coverage (HIGH SCRUTINY)
Commit body states accepting `WASM agent not found` as PASS "proves loadAgentWasm() + function dispatch + error propagation all work". In fact `agents.get(agentId)` is a plain JS Map lookup that throws BEFORE any WASM binary is touched (`initAgentWasm` is only called inside `createWasmAgent`, not the ops). So the check proves only: tool registered, handler dispatched, `agent-wasm.js` JS module imported, Map lookup ran. The WASM module (`rvagent_wasm_bg.wasm`) is never loaded in these 4 checks. **Update ADR-0094 scoreboard to reflect "wiring verified; WASM runtime unexercised"** rather than full coverage. Without this correction, a 100% P4 coverage claim is misleading.

### F3 — `content` token in every A5/A6 success regex makes them match almost anything (minor, but important for FAIL detection)
Ruvllm and WASM handlers all wrap output as `{content: [{type:'text', text: ...}]}`. The literal token `content` is in every A5/A6 expected_pattern, so ANY response that reaches the handler passes — including unexpected handler exceptions that still come out shaped as `{content:[{type:'text', text:'{"error":...}'}], isError:true}`. This weakens the PARTIAL assertion further: if a future regression changes the registry lookup to not throw, the check would still PASS. Recommend dropping `content` from the pattern union and keeping only semantic tokens (`Router not found`, `WASM agent not found`, `success`, etc.).

### F4 — A5 dead success branch never fires (cosmetic, harmless)
The `_wasm_invoke_agent_op` helper's bucket 3 ("real success pattern match") is reachable only if the agent already exists in-process — which, by the commit's own explanation, can never happen across `mcp exec` boundaries. Keeping it as "future-proof" is fine, but combined with F3 it gives a misleading impression that the check has a genuine success path. Either add a same-process driver (see F5) or comment it as "reserved for a future in-process test harness".

### F5 — Architectural follow-up missing from both A5 and A6 (sizeable, tracking)
The real fix to actually test end-to-end behavior is either (a) an in-process test harness that imports the tool handlers directly and drives create→op within one Node process, or (b) a long-lived `cli mcp serve` daemon that the acceptance script speaks to. Neither commit files a follow-up ADR or TODO. ADR-0094 claims "100% acceptance coverage"; with 8 checks (A5×4 + A6×4) now officially wiring-only, the scoreboard needs an asterisk and a deferred tracking item. Recommend adding a sub-task under ADR-0094 / ADR-0097 before declaring P4+P5 closed.

---

## Supporting evidence

- **A4 handler** (`terminal-tools.js:192-218`): `sessionId` required, store is file-backed, returns `{success:true, sessionId, closedAt}` on match — A4 check now hits the real success branch.
- **A5 handlers** (`wasm-agent-tools.js:44-92,129-170`): four ops dispatch to `promptWasmAgent / executeWasmTool / getWasmAgentTools / exportWasmState`, each of which does `agents.get(agentId)` first and throws `WASM agent not found: <id>` if absent. `agents` is `new Map()` (`agent-wasm.js:50`) — in-memory only.
- **A6 handlers** (`ruvllm-tools.js:57-86,88-112,142-162,197-217`): each does `hnswRouters.get / sonaInstances.get / loraInstances.get` and returns `{content:[...], isError:true}` with `Router/SONA/MicroLoRA not found` string on miss. Registries are in-memory Maps (`ruvllm-tools.js:281-283`).
- **CLI banner logic** (`commands/mcp.js:537-544`): `toolSuccess = result.success !== false`; handlers returning `{content,isError:true}` without `success` field still print `[OK] Tool executed` — relevant to F1.

## Overall

- A4: clean fix, full signoff.
- A5, A6: honest partial fixes — the agents correctly identified an architectural limit and picked a conservative pass criterion, but the ADR-0094 tracker MUST reflect that these 8 checks are wiring-only (not end-to-end). File follow-up for an in-process driver.
