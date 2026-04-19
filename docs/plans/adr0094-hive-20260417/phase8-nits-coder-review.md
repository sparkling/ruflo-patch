# Phase 8 INV-6 Nits — Coder Review (commit `7ea2175a1`)

**Reviewer:** Agent V (Phase 8 nits round)
**Date:** 2026-04-19
**Fork:** `/Users/henrik/source/forks/ruflo` branch `main`
**Base commit reviewed:** `7ea2175a1` *fix(config-tools): preserve scopes + rebuild nested tree on legacy reset*
**Parent:** `454b4d7eb` (original INV-6 fix, already approved in `phase8-coder-review.md`)
**Files changed:** `v3/@claude-flow/cli/src/mcp-tools/config-tools.ts` (+34 / -2)
**Companion test file:** `/Users/henrik/source/ruflo-patch/tests/unit/config-tools-shape-tolerance.test.mjs` (extended from 24 → 34 tests)
**Plan followed:** `docs/plans/adr0094-hive-20260417/phase8-review-nits-plan.md` (A2 + B1 + BUG-C JSDoc)

---

## Summary

**Approve.**

The coder implemented exactly the researcher-approved options (A2 reject-at-handler for BUG-A, B1 `setNestedValue` rebuild for BUG-B, plus the bundled JSDoc for BUG-C). The diff is minimal (34 insertions, 2 deletions, one file) and surgical — each change sits behind a named guard, carries a comment citing the review section, and is pinned by a dedicated static-source test. All 34 tests in `config-tools-shape-tolerance.test.mjs` pass on the freshly built dist (`01:00:54` > source `01:00:50`), with no new silent-pass patterns introduced. The 22 pre-existing tests from the parent commit still pass — nothing regressed. Live probes against the compiled dist confirm: legacy scoped writes fail loudly with a `scope`-mentioning error and zero byte mutation; `config_reset({})` on legacy produces a pure nested tree with zero dotted top-level keys; `config_list` post-reset emits 11 properly-namespaced dotted keys; reset-specific-key works on legacy (nested delete path); concurrent scoped writes survive on MCP; and concurrent scoped writes on legacy are both refused without touching the file.

---

## BUG-A correctness findings

### Handler path (lines 297–314)

The refusal gate is placed **before** any mutation of `store.values`, `store.scopes`, or the file, so refusal is guaranteed to be a no-op on disk:

```ts
if (scope !== 'default' && store.__shape === 'legacy') {
  return { success: false, key, value, scope, path, shape: 'legacy', error: 'scope writes require MCP shape — …' };
}
```

Findings against the task's BUG-A correctness checklist:

| Probe | Result |
|---|---|
| Save + reload preserves scopes on legacy shape? | **N/A by design** — scoped writes on legacy are refused, so there's nothing to preserve. Fix type A2 (reject) was explicitly chosen over A1 (`__scopes` sidecar). No sidecar exists; no stripping logic needed. This matches the plan. |
| Save + reload preserves scopes on MCP shape? | **Yes.** Verified live (probe: `scope:user, key:api.endpoint, value:https://mcp.example.com` → reloads as `scopes.user.api.endpoint`; the dotted-key path uses `setNestedValue`, the flat-key path uses direct assignment). Test `BUG-A #3` (lines 643–693) asserts both paths on both return-value and on-disk content. |
| Error loud and clear? Diagnostic info included? | **Yes.** Response payload includes `{success:false, key, value, scope, path, shape:'legacy', error:'scope writes require MCP shape — legacy (init-generated) config.json cannot persist scoped values'}`. Caller gets the exact path, scope, detected shape, and a remediation pointer in one message. |
| Race: concurrent legacy scoped writes (two different scopes) — do they both land? | **Both refused, file untouched.** Live probe (`Promise.all([set(x,1,user), set(y,2,project)])` against legacy init tree): `r1.success=false`, `r2.success=false`, file keys remain `['version','swarm']` — no mutation whatsoever. This is the correct A2 behavior: neither lands, neither silently "wins". |
| Race: concurrent MCP scoped writes (same scope, different dotted keys) | **Both land under the same scope subtree.** Live probe: `Promise.all([set(a.k1,V1,user), set(a.k2,V2,user)])` → `scopes.user.a = {k1:'V1', k2:'V2'}`. No file lock (none has ever been claimed for config-tools), but same-key concurrent writes would still have last-writer-wins semantics — out of scope for this fix. |

### Test coverage for BUG-A

- `BUG-A #1` (line 594): full refusal contract — `success:false`, error-mentions-scope, `shape='legacy'`, **byte-exact file equality before/after** (`beforeBytes.equals(afterBytes)`), and belt-and-suspenders follow-up `config_get` returns `exists:false`. Strong.
- `BUG-A #2` (line 626): regression fence for default-scope legacy writes — still succeed, still persist nested.
- `BUG-A #3` (line 643): MCP-shape scoped writes persist end-to-end for both dotted-key and flat-key paths, including `source:'scope'` attribution and wrapper preservation.

No silent-pass paths; every assertion includes a descriptive failure message.

---

## BUG-B correctness findings

### Handler path (lines 468–490)

The diff surgically replaces one line:

```diff
- Object.assign(store.values, DEFAULT_CONFIG);
+ for (const [k, v] of Object.entries(DEFAULT_CONFIG)) {
+   setNestedValue(store.values, k, v);
+ }
```

`setNestedValue` already rejects dangerous keys (`__proto__`, `constructor`, `prototype`) and enforces a 10-level depth cap (lines 185–194). `DEFAULT_CONFIG` has max 2-segment keys, so depth is well under the cap.

Findings against the task's BUG-B correctness checklist:

| Probe | Result |
|---|---|
| After reset on legacy: tree nested or flat? | **Nested.** Live probe: `config_reset({})` then `readFileSync` shows `{version, swarm:{topology:'mesh',maxAgents:10,autoScale:true}, memory:{persistInterval:60000,maxEntries:100000}, session:{…}, logging:{…}, security:{…}}`. Zero dotted top-level keys. Test `BUG-B #1` (line 699) asserts this explicitly via `Object.keys(persisted).filter(k=>k.includes('.'))` must be `[]`. |
| Subsequent `config_get --key swarm.topology` resolves correctly? | **Yes — returns "mesh".** Test `BUG-B #3` (line 750) asserts `result.value === 'mesh'` + `source === 'stored'` (not `'default'`, because the reset actually seeded the tree; the resolver hits the nested walk before falling through to `DEFAULT_CONFIG[key]`). Second key probe (`logging.format` → `'json'`) confirms the rebuild covers the whole map. |
| `config_list` shows nested structure? | **Yes — it flattens back to dotted keys for display, which is the intended `config_list` semantics.** Live probe post-reset returns 11 entries: `logging.format, logging.level, memory.maxEntries, memory.persistInterval, security.pathValidation, security.sandboxEnabled, session.autoSave, session.saveInterval, swarm.autoScale, swarm.maxAgents, swarm.topology`. `shape: 'legacy'` is reported on the response so callers can still tell what's on disk. |
| Edge: reset-specific-key (`{key:'swarm.maxAgents'}`) | **Works.** Live probe: `reset({key:'swarm.maxAgents'})` against legacy `{swarm:{topology:'hierarchical-mesh',maxAgents:15}}` → returns `{success:true, resetKeys:['swarm.maxAgents']}`, file becomes `{version, swarm:{topology:'hierarchical-mesh'}, memory, neural}` with `swarm.maxAgents` deleted via the existing nested-walk delete path (lines 450–462, unchanged by this commit). Sibling `swarm.topology` preserved, no dotted top-level keys introduced. |
| Edge: reset-all vs reset-specific-key | **Both correct.** Reset-all uses the new setNestedValue rebuild; reset-specific-key uses the pre-existing nested-walk delete that already handled legacy correctly. Good separation. |
| Edge: MCP reset still emits flat `{values:{…}}` | **Yes.** Test `BUG-B #2` (line 730) — MCP shape is unchanged: wrapper survives, dotted keys stay flat under `values`. |
| Edge: idempotence | **Yes.** Test `edge: repeated reset` (line 778): two consecutive `reset({})` calls produce `deepEqual` trees — no shape drift, no accumulating bookkeeping. |

### Test coverage for BUG-B

- `BUG-B #1` (line 699): nested-tree invariant (zero dotted keys) + three specific DEFAULT_CONFIG entries reachable via nested walk. Strong.
- `BUG-B #2` (line 730): MCP-shape anti-regression.
- `BUG-B #3` (line 750): end-to-end reset → get round-trip including source attribution.
- `edge:` (line 778): idempotence and shape stability across repeat resets.

---

## Test coverage assessment

### 34 tests, all pass

```
ℹ tests 34   suites 8   pass 34   fail 0   skipped 0   duration_ms 65.4
```

Distribution:

| Block | Tests | Scope |
|---|---|---|
| loadConfigStore shape detection | 4 | pre-existing |
| saveConfigStore shape preservation | 3 | pre-existing |
| nested tree integration | 5 | pre-existing |
| MCP-flat integration | 3 | pre-existing |
| p5-compat regression | 2 | pre-existing |
| Static source guards (shape) | 7 | pre-existing |
| **INV-6 follow-up — scope + reset on legacy** | **7** | **NEW** (BUG-A #1–3, BUG-B #1–3, idempotence edge) |
| **INV-6 follow-up static guards — BUG-A/B/C source pins** | **3** | **NEW** (handler refusal regex, setNestedValue rebuild with `Object.assign` anti-regression, JSDoc @remarks pin) |

### ADR-0082 compliance

| Rule | Status | Evidence |
|---|---|---|
| Assert on return values? | **Yes** | Every integration test asserts on handler return shape |
| Assert on on-disk state? | **Yes** | Every integration test reads `cfgPath(cwd)` and asserts the persisted JSON |
| Silent-pass detection | **Clean** | No `_CHECK_PASSED="true"` equivalents; no `try { ... } catch {}` over assertions; `beforeBytes.equals(afterBytes)` is a byte-exact check, not a string-contains. |
| SKIP-on-error pattern | **Not present** | No test skips any branch on error |

### Byte-exact file-untouched check (BUG-A #1)

This is a notably strong pattern worth calling out: `readFileSync(cfgPath(cwd))` is captured as `Buffer` before the refused set, then compared via `Buffer.equals` after. That catches even whitespace/reformatting changes — the refusal path really does not touch the file at all. This is a meaningful improvement over the pre-existing "file-does-not-contain-substring" style of on-disk asserts.

### Regression guard for `Object.assign` reversion (BUG-B static)

Line 837: `assert.doesNotMatch(src, /Object\.assign\(store\.values,\s*DEFAULT_CONFIG\)/)`. If anyone ever re-introduces the flat-assign path, this test fails loudly. Correct use of a static guard — matches the pattern of the original `__shape` leak guard.

### Gaps (non-blocking, nothing added is required for this commit)

1. **Test-of-test-scoping invariants.** `loadHandlersUnderCwd` uses a cache-buster query (`?t=${Date.now()}-${Math.random()}`) — robust and correct, but it relies on node's `--experimental-vm-modules` or native dynamic-import caching. Not a concern under `node --test` today; just noting.
2. **No test for `config_set scope=foo --key x` where `x` is non-dotted on legacy.** The refusal gate fires regardless of dot-vs-flat; a non-dotted key would still be rejected correctly, but it's not explicitly covered. Very low value to add.
3. **No test for `config_import` onto a legacy tree with scoped keys.** `config_import` does not gate on shape — if a caller `imports({config:{x:1}, scope:'user'})` onto a legacy file, the handler will write to `store.scopes.user.x` but `saveConfigStore` legacy branch will drop the whole `scopes` map. This is the same silent-drop pattern BUG-A fixed, but in `config_import` rather than `config_set`. Not regressed by this commit — pre-existing. See out-of-scope observations.

---

## CLAUDE.md compliance table

| Rule | Status | Evidence |
|---|---|---|
| Fork-only change (no codemod) | **PASS** | `git show 7ea2175a1 --name-only` → single file `v3/@claude-flow/cli/src/mcp-tools/config-tools.ts`. Codemod untouched. |
| No `ruflo-patch` source edits beyond tests | **PASS** | Test file `tests/unit/config-tools-shape-tolerance.test.mjs` is the only ruflo-patch edit (working-tree, extended from 24 → 34 `it(...)` blocks). No new scripts/libs. |
| No `dist/` edits in commit | **PASS** | Commit touches only `.ts`; dist is rebuilt separately via pipeline. |
| No secrets/.env | **PASS** | No `API_KEY\|SECRET\|TOKEN\|PASSWORD\|sk-` matches in the diff. |
| No accidental scope rename | **PASS** | Grep for `@sparkleideas` in the file → 0 matches. Fork stays at `@claude-flow/`. |
| 500-line rule | **SOFT WARN** | File grew 555 → 587 lines. Over guideline but this matches ADR-0089 "existing-file growth preferred over splitting to avoid upstream merge tax". Delta is contained helpers + two branch guards, not cross-cutting. Already flagged on the parent commit. Accept. |
| ADR-0082: fail loudly, no silent fallbacks | **PASS** | BUG-A fix explicitly chose A2 (reject-loudly) over A1 (sidecar-swallow) for this reason. The refusal returns `success:false` with a descriptive error — exact shape ADR-0082 wants. |
| All-test-levels written | **UNIT ✓ / INTEG ✓ / ACCEPT pre-existing** | The commit adds 7 integration tests + 3 static guards; acceptance is pre-existing (`check_p5_compat_config_set` + `_inv6_body` in `lib/acceptance-phase8-invariants.sh`), unchanged and still applicable. |
| Scope creep | **PASS** | Only `config-tools.ts` + test file. No wider refactor despite the availability of `BUG-C` (JSDoc), which was properly bundled not separated. |
| Build after fork changes | **VERIFIED** | `dist/src/mcp-tools/config-tools.js` rebuilt (20881 bytes, `01:00:54`) and contains both `scope writes require MCP shape` (line 283) and `setNestedValue(store.values, k, v)` (line 443). |
| Unit tests run | **VERIFIED** | `node --test tests/unit/config-tools-shape-tolerance.test.mjs` → `pass 34, fail 0`. |
| No committing secrets / `.env` files | **PASS** | — |

---

## Out-of-scope observations

Not regressions from this commit. Logged for future cleanup.

### 1. `config_import` has the same BUG-A class problem as `config_set` did

`config_import` handler (lines 555–585) writes to `store.scopes[scope]` without a shape-gate. A call like `config_import({config:{x:1}, scope:'user'})` on a legacy file:

- Mutates `store.scopes.user.x = 1` in memory
- `saveConfigStore` legacy branch spreads only `store.values`, dropping `scopes` entirely
- Handler returns `success:true`

This is structurally identical to the pre-fix BUG-A, just via a different entry point. Not introduced by this commit — pre-dates both `454b4d7eb` and `7ea2175a1`. Recommend filing as `phase8-import-scope-drop` nit.

### 2. Non-MCP scoped config_set with a non-dotted key on a non-existent scope still creates `store.scopes[scope] = {}` in memory before the refusal gate on LEGACY paths — but refusal happens first

Checked: the refusal at line 303 runs **before** the `store.scopes[scope] ??= {}` initialization at line 327, so there's no in-memory pollution. Confirmed by reading the handler top-to-bottom. This was a concern I wanted to rule out — it's fine.

### 3. ADR-0082 violation in pre-existing `check_p5_compat_config_set` (lines 391–393 of `lib/acceptance-init-generated-checks.sh`)

Previously flagged in `phase8-coder-review.md` §3. Still present. Sets `_CHECK_PASSED="true"` based on CLI output alone without verifying the file. Unrelated to this commit. Still worth a cleanup pass.

### 4. `config_reset({scope:'user'})` on a legacy file

Legacy reset-with-scope hits the `else if (store.scopes[scope])` branch at line 487 — `store.scopes` is always synthesized as `{}` for legacy loads, so the branch returns `resetKeys=[]`, `count=0`, `success:true`. No harm, but the response does not tell the caller "there are no scopes on a legacy config". Minor DX nit; not worth fixing now.

---

## Recommendation

**Ship `7ea2175a1`.** Every item in the researcher plan landed exactly as specified. The test suite is rigorous (byte-exact file comparisons, source-level regression guards, both handler return-values and persisted JSON asserts). Nothing from the parent-commit review was reopened. The two out-of-scope observations (`config_import`, pre-existing ADR-0082 leak in the acceptance check) should be tracked as separate Phase 8 hygiene items but do not block this fix.

Tester can proceed to run:

```bash
node --test tests/unit/config-tools-shape-tolerance.test.mjs
```

No Verdaccio needed for the 34-test suite. The INV-6 invariant and `check_p5_compat_config_set` acceptance probes should both go green on the next acceptance pass (they already were after the parent commit; this patch keeps them green and closes the two behavioral gaps that would have only surfaced under user-initiated scoped writes or full resets on init'd projects).
