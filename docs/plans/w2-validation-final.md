# W2 Validator + Final Synth — A13/A14 + W2-I1..I9 (READ-ONLY)

**Date**: 2026-04-18 ~18:05 BST
**Mode**: READ-ONLY (no edits, no commits)
**Scope**: A13 (`d1bc898`), A14 (`db25bf7`), W2-I1..I9; global audit across W1+W2 (~23 agents, ~85 checks)

---

## Signoff Table

| Agent | Commit/State | Verdict | Evidence |
|---|---|---|---|
| A1 | `944a5e6` sessions | GO | Tightened skip regex (`tool.+not (found\|registered)`), `_session_seed` seeds happy path, handler-shape PASS regex (`savedAt`, `"restored":true`). |
| A2 | `25d2608` p3-ta | GO | `_task_create_and_capture` extracts real taskId; corrected `{type,description}` schema; `agentIds` array. |
| A3 | `dabad2b` daa-adapt | GO | Self-provisions prereq agent with correct `id`-keyed schema. `\|\| true` on create is intentional fall-through to adapt classification. |
| A5 | `1ff3e22` wasm | PARTIAL | Accepts `WASM agent not found` as PASS. Architecturally honest (cross-process Map) per V2 F2/F3. **Wiring-only; WASM runtime unexercised**. |
| A6 | `21dbdfb` ruvllm | SUPERSEDED | Accepts `Router not found` as PASS (V2 F3/F4). W2-I2 (in-flight) replaces with real cross-process lifecycle + store files. |
| A7/A4 | `1ff6c0a` te-close | GO | Captures generated `sessionId` from `terminal_create`; drops `removed` from PASS regex. |
| A8 | n/a | — | Not a W1 agent commit in the audit scope. |
| A9 | `ea07f67` github | GO | Drops false GITHUB_TOKEN gate; narrow PASS asserting `_stub:true` marker (load-bearing). |
| A10 | `355a6e8` transfer | GO | Per-tool narrow offline-fallback regex; removes ECONNREFUSED silent-skip. |
| A11 | `cfbb56f` p2-ag | GO | `_agent_spawn_fixed_id` correct `agentType`/`agentId` schema; three-way discipline preserved. Output-pattern matching avoids `_run_and_kill` exit-code footgun. |
| A12 | `58c75fd` p7-fo | PARTIAL | 3× real behavioral upgrades (agents/store, swarm/state, neural). Check-8 skip rationale for `.mcp.json` is factually wrong per V4 (upstream `init/executor.ts:181`). W2-I7 should resolve. |
| A13 | `d1bc898` p6-perms | GO | chmod `.swarm` (actual RVF write path). Tight EACCES/permission-denied regex. v2 regression-lock unit test. |
| A14 | `db25bf7` b5-docs | GO | Docs-only classification verification on patch.151. Narrow skip regex preserved; classification honest. Superseded in part by W2-I3. |
| W2-I1 | NOT LANDED | WAIT | No commit visible at audit end. |
| W2-I2 | IN-FLIGHT (dirty) | GO-PENDING | `lib/acceptance-ruvllm-checks.sh` uncommitted. Replaces A6 registry-miss-as-PASS with REAL cross-process create→add→route + on-disk `.claude-flow/ruvllm/*-store.json` verification via `_mcp_invoke_tool`. Directly fixes V2 F3/F4. |
| W2-I3 | `70c9901` causal pipeline | GO (with caveat) | `_b5_check_causal_pipeline` enforces causal_edges table exists (regression-guard for agentic-flow `8238837`) + "no such table" error absent + exit 0. **Caveat**: causalRecall/explainableRecall only exercise the cold-start short-circuit path (stats<5); recall_certificates INSERT is unverified. nightlyLearner is the strongest of the three. Docblocks honestly state the limitation. |
| W2-I4 | IN-FLIGHT (dirty, in b5 file) | GO-PENDING | gnnService telemetry check requires `success:true` + `controller:"gnnService"` + `engine` + numeric `count`. Tight 4-element conjunction; regression-guard flips to FAIL if tool disappears from manifest. |
| W2-I5 | NOT LANDED | WAIT | No commit visible. |
| W2-I6 | NOT LANDED | WAIT | "Hardest assignment" — no commit at audit end. |
| W2-I7 | NOT LANDED | WAIT | Needed for A12 Check-8 `.mcp.json` skip upgrade. |
| W2-I8 | `d00c51d` daa-wf-exec | GO | Self-contained create+execute lifecycle; bypasses bare `not found` regex; PASS requires both `running\|executed` AND matching `$wf_id`. |
| W2-I9 | NOT LANDED | WAIT | `/tmp/w2i9-flake/before.txt` shows flake-investigation scaffolding only. |

---

## Top-10 Flags (across all 23 agents / W1+W2)

1. **A5 wiring-only PASS on `WASM agent not found`** (wasm-checks.sh:161). Cross-process `agents` Map dooms real E2E. Needs in-process driver per V2 F5 tracking item.
2. **A6 obsolete `Router/SONA/MicroLoRA not found` PASS branch** still on `main` until W2-I2 lands. Regex matches both pass and error paths (task's anti-pattern).
3. **A12 Check-8 `.mcp.json` skip_accepted is factually wrong** — upstream `init/executor.ts:181,666,675` + `init/mcp-generator.ts:47-75` emit `.mcp.json` with populated `mcpServers`. ADR-0082 violation. W2-I7 open.
4. **W2-I3 causalRecall/explainableRecall pass the short-circuit path**, not real recall+certificate issuance. Acknowledged in docblock but ADR-0094 scoreboard must reflect "schema-regression-guard only", not full end-to-end.
5. **A5/A6 `content` token in success regex** (V2 F3) — any handler response shape with `content` token matches. Weakens FAIL detection.
6. **Domain-specific `_*_invoke_tool` helpers** (daa/wasm/task/agent/session/ruvllm/terminal/github/transfer) coexist with canonical `_mcp_invoke_tool`. ADR-0097 L5 drift is architectural, not W1/W2-introduced, but unresolved. W2-I2 migrates ruvllm → canonical helper; other 8 files remain divergent.
7. **A13 secondary `doctor` probe accepts "No config file (using defaults)" warning** as PASS corroboration. Broad regex (`EACCES\|permission\|denied\|cannot (access\|read\|open)\|No config file\|Config File\|warning`) for a read-path that is not the core probe. Low risk; primary probe is strict.
8. **A11 `_agent_spawn_fixed_id` success signal `spawned\|success\|$agent_id`** could match spurious banner text containing `success`. Low risk; sigma is dominated by `$agent_id` literal.
9. **W2-I1, I5, I6, I7, I9 not landed at audit end** (18:05 BST). W2-I6 is the "properly fix b5 checks that A14 declared accepted trade-offs" — this validator could not audit what isn't written.
10. **A3 `|| true` after daa_agent_create** silently discards create errors before the adapt call. Intentional per commit message (missing tool surfaces via adapt's skip regex) but pattern breaks if MCP tool emits success shape WITHOUT actually persisting. Re-verify when W2-I2's on-disk store pattern spreads to DAA.

**Clean audits (no anti-patterns found)**:
- Zero `retry`/`retries`/`attempts` control-flow in any acceptance check file. The only occurrences are content payloads (pattern-retry string) or `maxRetries:5` as MCP request data.
- Zero new `2>/dev/null || true` silent-fallbacks introduced by W1/W2. All stderr-suppression is file-existence-tolerated patterns re-checked elsewhere.
- No helper in W1/W2 reimplements `_mcp_invoke_tool` in a way that masks regex drift. The new helpers (`_p7_*`, `_session_seed`, `_task_create_and_capture`, `_wasm_invoke_agent_op`, `_agent_spawn_fixed_id`, `_b5_check_controller_roundtrip`, `_b5_check_causal_pipeline`) add domain logic (ID capture, SQL round-trip, DDL regression guards) on top of `_run_and_kill`/`_mcp_invoke_tool`.

---

## Final GO/NO-GO

**Landed (GO)**: A1, A2, A3, A7, A9, A10, A11, A13, A14, W2-I3 (with caveat), W2-I8. **11 agents, ~65 checks.**

**Landed (PARTIAL)**: A5, A12 (Check 8 only). **~5 checks flagged for follow-up.**

**Superseded pending in-flight commit**: A6 (by W2-I2). **~4 checks.**

**In-flight but un-committed**: W2-I2 (GO-PENDING), W2-I4 (GO-PENDING). **~7 checks.**

**Not landed at audit end**: W2-I1, I5, I6, I7, I9. **Cannot sign off.**

**Overall verdict**: W1 is PRODUCTION-READY modulo A5/A12 follow-up items tracked in V2/V4. W2 is HALF-LANDED with the committed W2-I3 + W2-I8 both GO; the largest value-add (W2-I6 "properly fix b5 trade-offs") is not visible. Queen synthesis should hold final sign-off until the 5 missing W2-I commits land and a delta audit of W2-I6 is completed — especially whether its proposed fixes exercise each controller's real write path rather than adding noise that triggers a state change without proving correctness.

**Risk**: If W2-I6 attempts to "flip" skip_accepted on the 7 controllers that A14 verified as architecturally-correct no-persistence (attentionService, causalGraph, gnnService pre-W2-I4, graphAdapter, memoryConsolidation, semanticRouter, sonaTrajectory), it risks fabricating passes. V2/V4 methodology — read the fork source, confirm each assertion maps to the real code path — must be repeated for every W2-I6 check.
