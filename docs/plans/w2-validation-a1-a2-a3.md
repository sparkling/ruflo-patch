# W2-V1 Validation — A1 / A2 / A3

**Scope**: Audit of 3 W1 fork-free acceptance fixes for INTENT fulfillment.
**Method**: Read commit → read current check body → read fork handler source → run live CLI probes at `@sparkleideas/cli@3.5.58-patch.154` (Verdaccio) → classify.
**Temp probe dir**: `/tmp/w2-v1-validator-45137`
**READ-ONLY** — no commits, no fork changes, no acceptance run.

---

## Commits under review

| Agent | SHA | File | Checks touched |
|---|---|---|---|
| A1 | `944a5e6` | `lib/acceptance-session-lifecycle-checks.sh` | `p3-se-save`, `p3-se-info`, `p3-se-restore`, `p3-se-delete` (+ `_session_invoke_tool` skip regex, + new `_session_seed` helper) |
| A2 | `25d2608` | `lib/acceptance-task-lifecycle-checks.sh` | `p3-ta-lifecycle`, `p3-ta-create`, `p3-ta-assign`, `p3-ta-update`, `p3-ta-cancel`, `p3-ta-complete`, `p3-ta-status` (+ new `_task_create_and_capture` helper) |
| A3 | `dabad2b` | `lib/acceptance-daa-checks.sh` | `p3-da-adapt` only |

---

## Per-check signoff table

| check_id | intent (1-sentence) | fix method | tests intent? | confidence | notes |
|---|---|---|---|---|---|
| **A1 / p3-se-save** | Verify `session_save` MCP tool actually persists a session and returns the documented success shape (`sessionId`, `savedAt`, stats). | Tightened expected pattern to `savedAt\|sessionId`; parallel-safe name with `$$`. | **yes** | high | Success-shape tokens verified live: `"sessionId"`, `"savedAt"` present only on success path. Unreachable from any error JSON. |
| **A1 / p3-se-info** | Verify `session_info` returns detailed metadata (`fileSize`, `hasData`, `savedAt`) for a real session. | Seeds session via `session_save` first (unique name), then passes name to `session_info`; pattern tightened to `savedAt\|fileSize\|hasData`. | **yes** | high | Happy path is exercised. Error payload `{"name":"...","error":"Session not found"}` does NOT match the new tight pattern (verified). Seed-failure branch explicitly FAILs, not skips. |
| **A1 / p3-se-restore** | Verify `session_restore` actually restores data and returns `restored:true`. | Seeds → pattern `"restored":\s*true\|restoredAt`. | **yes** | high | Pattern requires literal `"restored":true` (not `false`), so it cannot leak to `{"restored":false,"error":"Session not found"}`. Probe confirmed success payload. |
| **A1 / p3-se-delete** | Verify `session_delete` actually unlinks the file and returns `deleted:true`. | Seeds → pattern `"deleted":\s*true\|deletedAt`. | **yes** | high | Same logic as restore. Tight, success-only. |
| **A1 / `_session_invoke_tool` skip regex** | Only classify as skip_accepted when the MCP tool is genuinely missing from the build, NOT when handler returns a legitimate domain error. | Replaced bare `not found` alternative with `tool.+not (found\|registered)\|tool .+ is not available`. | **yes** | high | Tested: `{"error":"Session not found"}` → NO_MATCH; `Tool session_info not found` → MATCH; `Unknown tool: ...` → MATCH. |
| **A2 / p3-ta-create** | Verify `task_create` creates a task with the documented `{type, description}` schema. | Switched from `{"name":"..."}` to `{"type":"test", "description":"..."}`. | **partial** | medium | Correct schema is now sent AND the handler persists a record. BUT the inherited expected pattern `'created\|task\|id\|content\|\[OK\]\|result'` also matches the CLI wrapper line `[OK] Tool executed...` that prints for any handler returning a value (including error responses). Safe in practice because the real code path is exercised, but the assertion wall is paper-thin. |
| **A2 / p3-ta-assign** | Verify `task_assign` actually attaches agents to a task. | `_task_create_and_capture` → real taskId → agentIds **array**. | **partial** | medium | Success path is real. Same `[OK]\|result` leak as above. |
| **A2 / p3-ta-update** | Verify status transition (pending → in_progress). | Real taskId → valid `status` enum. | **partial** | medium | Same shape-leak risk. |
| **A2 / p3-ta-cancel** | Verify `task_cancel` marks the task cancelled. | Real taskId. | **partial** | medium | Error path for bogus IDs returns `"success":false` which still matches the `success` alternative. Self-provisioning avoids that path. |
| **A2 / p3-ta-complete** | Verify `task_complete` marks the task complete. | Real taskId. | **partial** | medium | Same. |
| **A2 / p3-ta-status** | Verify `task_status` returns current state of a real task. | Real taskId. | **partial** | **low** | task_status on bogus ID returns `"status":"not_found","taskId":"..."` — **matches** the current pattern `'status\|state\|task\|content\|\[OK\]\|result'` via `task` AND `status`. If `_task_create_and_capture` ever silently regresses, this check returns PASS on a "Task not found" error. |
| **A2 / p3-ta-lifecycle** | Multi-step invariant: create → assign → update → list → status → summary → complete + cancel a second task. | Captures taskId from `task_create` output; uses `agentIds` array for assign. | **yes** | medium | End-to-end happy path is real. Still uses the over-broad inherited patterns — only a full catastrophic handler regression would flip the result, because each mutating step depends on the prior one succeeding. |
| **A3 / p3-da-adapt** | Verify `daa_agent_adapt` actually updates agent metrics and returns adaptation result. | Self-provisions agent via `daa_agent_create --params '{"id":...,"type":"worker"}'` (correct `id`-keyed schema), then adapts with `feedback`+`performanceScore`, pattern `adapted\|updated\|success\|adaptation`. | **partial** | medium | Happy path works (verified: returns `success:true, adaptation:{adaptations:1, newSuccessRate:0.95}`). BUT: (a) the bare `success` alternative matches `"success":false` in error paths; (b) the helper's skip regex still contains bare `not found`, so if prereq silently fails, `"error":"Agent not found"` would re-route to skip_accepted — exactly the original W1 anti-pattern, just masked by a more reliable prereq rather than a tighter regex. |

---

## Red-flag summary — top 5 concerns

1. **A2 — `_task_invoke_tool` skip regex still contains bare `not found`** (line 46). A2 fixed the upstream cause (wrong taskIds leading to "Task not found" errors) but did not close the underlying regex hole. If any future `_task_create_and_capture` regression returns a non-matching tid, error payloads like `"error":"Task not found"` will be re-masked as skip_accepted. **Recommended hardening**: tighten helper's skip regex to A1's pattern (`tool.+not (found|registered)|unknown tool|...|tool .+ is not available`).

2. **A2 — expected patterns allow `\[OK\]` as a success alternative**. The CLI wrapper prints `[OK] Tool executed in N.NNms` whenever the handler returns any value (even an error-shape). Every one of A2's individual checks (and the pre-existing lifecycle) passes when `[OK]` appears — meaning the inner handler's correctness is **not** asserted. `p3-ta-status` is the clearest violation: bogus-id response matches via BOTH `task` and `[OK]`. **Recommended hardening**: narrow each expected pattern to handler-specific success-only tokens (e.g., `task_cancel` → `"status":\s*"cancelled"|cancelledAt`, `task_update` → `"success":\s*true.+"progress"` etc.). This is A1's template.

3. **A3 — `_daa_invoke_tool` skip regex still contains bare `not found`** (line 60). A3's fix makes the happy path reliable but does NOT prevent the ambient mis-classification bug. If `daa_agent_create` silently regresses (for example, fork bumps schema again), `daa_agent_adapt` will return `"error":"Agent not found"` and fall into skip_accepted — the original symptom A3 was tasked to eliminate. **Recommended hardening**: same as (1) — tighten to tool-registration-only phrasing. (Note: A1 did this in its file; A3 did not in theirs.)

4. **A3 — expected pattern includes bare `success` token**. Matches `"success":\s*false` in error responses. For the happy path exercised this is a false concern (prereq + handler both emit `success:true, adaptation:{...}`), but the assertion is not success-discriminating. **Recommended hardening**: `\"adaptation\":\s*\{|adaptations\":\s*[1-9]\|\"newSuccessRate\"` (adaptation object only present on success).

5. **A3 — sibling `check_adr0094_p3_daa_agent_create` (outside A3's scope) silently passes a schema-violating payload**. `daa_agent_create` handler requires `id` but check sends `{"name":"daa-test",...}`, producing an agent stored under key `"undefined"` with a null `id` field. Check passes via bare `agent` token. Not A3's fault but the adjacent hazard should be logged for the W3 planning round — it's the same class of bug A3 fixed for adapt.

---

## Notable positives

- **A1 is a textbook fix**: tightens skip regex to tool-registration-only AND tightens every individual check's expected pattern to handler-specific success tokens (`"restored":\s*true|restoredAt`, `"deleted":\s*true|deletedAt`, `savedAt|fileSize|hasData`). Each pattern is verified unreachable from the corresponding error shape. `_session_seed` helper is parallel-safe (`$$-${RANDOM}`) and uses a three-way return protocol (`__SKIP_TOOL_MISSING__` / `__SEED_FAILED__` / real name) that propagates prereq failures loudly. This is the pattern A2 and A3 should follow in the next pass.

- **A2 correctly identifies and fixes both schema bugs**: `{type, description}` instead of `{name, description}`, and `agentIds` (array) instead of `agentId` (string). These are genuine product-contract bugs. Taskid extraction via `grep -oE 'task-[0-9]+-[a-z0-9]+'` reliably captures the handler's generated ID.

- **A3 correctly identifies the prereq-ordering bug**: parallel check-1 couldn't be relied on for check-2's seed, AND check-1 was using wrong schema. Self-provisioning with `$$-${RANDOM}` id is the right approach.

---

## Overall signoff

| Agent | Verdict | Rationale |
|---|---|---|
| A1 | **ACCEPT** | All 4 checks exercise real handler behavior with success-only patterns. Skip regex hardened against the exact false-positive the commit message identifies. Seed helper's three-state return is ADR-0082 compliant. |
| A2 | **ACCEPT WITH CAVEAT** | Schema bugs genuinely fixed; real taskIds flowing through. Caveat: inherited over-broad patterns (`[OK]`, `success`, `task`) mean the checks prove wiring + schema + prereq chain, but don't prove handler-level correctness. Follow-up recommended (see flags 1-2). This is a W1 scope fix — the pattern tightening is legitimately a W3 deliverable. |
| A3 | **ACCEPT WITH CAVEAT** | Happy-path prereq provisioning is correct and verified. Caveat: identical ambient hazards to A2 (flags 3-4). The underlying `_daa_invoke_tool` skip regex bug is unfixed — if the prereq ever regresses the check will again mask as skip_accepted, exactly as before. Follow-up strongly recommended before trusting this check long-term. |

**Path**: `/Users/henrik/source/ruflo-patch/docs/plans/w2-validation-a1-a2-a3.md`
