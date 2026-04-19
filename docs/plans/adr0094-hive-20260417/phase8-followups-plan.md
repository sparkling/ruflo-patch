# Phase 8 Follow-ups — Research Plan (Agent R)

Date: 2026-04-19
Scope: 4 outstanding items after Phase 8 INV-6 / BUG-A / BUG-B landed.

---

## ITEM 1 — `config_import` scope drop (same class as BUG-A)

**File:** `/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/config-tools.ts:555-586`

**Verdict:** Confirmed. Identical class to BUG-A.

**Failure path (scope path, legacy shape):**

1. Caller sends `{config:{foo:"bar"}, scope:"user"}` OR `{config:{scopes:{user:{foo:"bar"}}}, scope:"default"}`.
2. `loadConfigStore()` returns a legacy store with `store.scopes = {}` and `__shape = 'legacy'`.
3. Handler takes the `else` branch at line 569 — writes into `store.scopes["user"]` via `Object.assign`.
4. `saveConfigStore()` at line 576 → line 142-147 legacy branch serialises ONLY `store.values`. **`store.scopes` is dropped.**
5. Returns `{success:true, scope:"user", imported:1, keys:["foo"], merge}` — a lie.

The second shape (merging `{scopes:{...}}` as a top-level key in `scope:"default"`) is even subtler: `Object.assign(store.values, config)` at line 565 puts a literal `"scopes"` key inside the legacy nested tree, corrupting the next shape-detect round.

**Recommended fix (same pattern as BUG-A, fail-loud per ADR-0082):**

Insert, immediately after `scope` is resolved (before line 563):

```ts
if (scope !== 'default' && store.__shape === 'legacy') {
  return { success: false, scope, shape: 'legacy', path: getConfigPath(),
    error: 'scope imports require MCP shape — legacy config.json cannot persist scoped values' };
}
if (store.__shape === 'legacy' && ('scopes' in config || 'values' in config)) {
  return { success: false, scope, shape: 'legacy', path: getConfigPath(),
    error: 'legacy config.json rejects payloads carrying `values`/`scopes` — would corrupt nested tree' };
}
```

Test coverage mirrors the BUG-A suite: one legacy + scoped reject, one legacy + scopes-in-payload reject, one legacy + clean merge passes.

---

## ITEM 2 — `:memory:` file at repo root

**Evidence:**

- `stat`: 162 bytes, ctime `Apr 19 01:07:54 2026` (matches Phase 8 test window).
- `hexdump`: begins `53 46 56 52 01 05` → `SFVR` magic. This is a **native RVF file** (format emitted by `@sparkleideas/ruvector-rvf-node`'s `RvfDatabase.create()`).
- IDIF block at offset 0x58 encodes the literal key string `:memory:`.

**Root cause:** The fork source has explicit `:memory:` guards at every file-writing site in `rvf-backend.ts` (L232, L291, L822, L1124, L1736, L1986, L2011). The `tryNativeInit` guard at L822 returns `false` before ever calling `RvfDatabase.create`. The installed `/tmp/ruflo-fast-1DNbJ` build confirms the guard is live (dist L798-L803).

So the guard works **for well-formed callers**. The file at repo root is from a path that bypasses `tryNativeInit` entirely — most likely either:

(a) A **direct call to `@sparkleideas/ruvector-rvf-node`'s `RvfDatabase.create(':memory:', …)`** without going through `RvfBackend`. Test `tests/unit/adr0086-rvf-real-integration.test.mjs:246` does call `RvfBackend` with `:memory:` from repo cwd, but goes through the guarded path.

(b) A **pre-2d12bb1 build of the installed `@sparkleideas/memory` package** running against repo cwd before the guard amendment landed, leaving the artifact behind.

(c) A **diagnostic/one-off subprocess** like `scripts/diag-rvf-persist-trace.mjs` (which has its own `:memory:` guards at L247/254/299) OR a runaway script that instantiated native RVF directly without the backend wrapper.

**Safest fix:** Delete the file and add `:memory:` to `.gitignore`. The fork source already has the right guards; the file is a stale artifact, not an ongoing bug. If it reappears, run `lsof` or `fs_usage` during test runs to catch the offender. Do not patch the fork for a problem that isn't reproducible in current code.

---

## ITEM 3 — Agent bail-out pattern ("waiting for notification")

**Diagnosis:** The reviewer+tester agents ran `run_in_background: true` Bash calls containing `until kill -0 <pid>; do sleep 2; done` then exited the Claude turn. That loop runs on the Bash subprocess but its stdout goes nowhere the agent polls — the agent's next scheduled action is "wait for Task tool to deliver output", which never happens because the agent itself terminated. It's a Claude-side pattern, not a Monitor/Bash quirk: the agent interpreted "poll TaskList every 60s" as "arrange for someone else to poll" rather than "stay in the turn and keep calling tools."

**Recommended coordinator pattern (for future ruflo-patch swarms):**

1. **Sequence dependent agents explicitly.** Spawn coder, wait for its completion in the **parent** turn (the parent stays alive), then spawn reviewer+tester in parallel.
2. **Use a concrete filesystem flag, not TaskList.** Have the coder write `/tmp/ruflo-swarm-<id>/coder-done` as its last action. The coordinator Bash-polls that file (`until [[ -f flag ]]; do sleep 30; done`) — simple, observable, robust.
3. **Collapse small-fix swarms.** If the task is <200 LOC change, one `coder+reviewer+tester` merged agent outperforms the multi-agent dance. Use separate agents only when review needs fresh eyes AND the change is >300 LOC.
4. **Never tell an agent to "poll TaskList."** Give it either concrete inputs that already exist, or an explicit bash loop condition it can set up and keep the turn alive for.

---

## ITEM 4 — INV-11 tolerance

**Current:** `confirmed >= 2 of 3` passes; `>= 1` passes as "partial."

**Recommendation: tighten to `confirmed == probes` (strict).**

**Justification:** All three probed tools (`memory_store`, `workflow_create`, `agent_spawn`) are core MCP tools required in any Phase 8-eligible build. If any one silently degrades to a no-op, INV-11 is the only cross-tool invariant that would catch it — softening the threshold directly defeats the purpose of the invariant. The current partial-pass is an **ADR-0082 violation** (masks real regressions with a green outcome). There is no legitimate build where one of the three probes should be "unavailable" — if it is, that itself is the regression INV-11 should surface as a FAIL, not tolerate as partial PASS.

Keep the `skip_accepted` branch at `probes == 0` (entire list-tool surface missing → not a Phase 8 build, genuinely skip). But if at least one list-tool returned, demand all three mutations cause observable deltas.

**Concrete diff:** Replace lines 693-703 with a single strict branch that sets PASS only when `confirmed == probes && probes > 0`, else FAIL with the existing misses message.

---

Word count: ~560.
