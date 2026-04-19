# Phase 8 Follow-ups — Coder Review (Agent V)

**Reviewer:** Agent V (Phase 8 follow-ups round)
**Date:** 2026-04-19
**Plan reviewed:** `docs/plans/adr0094-hive-20260417/phase8-followups-plan.md` (4 ITEMs; the bail-out pattern in ITEM 3 is process-only and not in scope for this review)
**Coder commits reviewed:**

- Fork (`/Users/henrik/source/forks/ruflo`, branch `main`): `a23ab3a74` *fix(config-tools): reject scope imports on legacy shape (INV-6 follow-up)*
- ruflo-patch (`/Users/henrik/source/ruflo-patch`, branch `main`): `9bcf423` *chore: cleanup `:memory:` artifact + tighten INV-11 + config_import tests*

**Recommendation:** **Approve-with-nits.** Tester is unblocked; the nits are scope-of-fix gaps, not regressions or missing tests for what landed.

---

## Summary

Three of four plan ITEMs landed cleanly. The pattern is consistent with BUG-A from the prior round (ADR-0082 fail-loud, dual fork+patch commits, byte-exact file-unchanged assertions, INV-11 fast-acceptance still 11/11). Two issues prevent a clean Approve and one observation is logged as out-of-scope:

1. **Nit (gap, not a regression):** ITEM 1's plan called for rejecting *both* `'scopes' in config` and `'values' in config` on legacy. The implementation only catches `scopes`. A `config_import({config:{values:{...}}})` against legacy still mutates the file with a junk top-level `values` key (probed live below). It does not flip shape detect (`detectShape` requires both `values` AND `scopes` to declare MCP), so it's not catastrophic — but it is the symmetric half of the same pre-existing class. The plan flagged it; the diff missed it.
2. **Nit (edge-case divergence):** Task focus item A explicitly called out: "import payload with EMPTY `scopes: {}` — should NOT trigger rejection (that's a no-op import)". The implementation rejects *any* `hasOwnProperty(config, 'scopes')`, including `scopes:{}`. Probed live: returns `success:false` with the corrupt-tree error. Defensible (the user clearly intended a scope payload and the legacy file can't honor it), but it diverges from the brief and there's no test pinning either direction.
3. **Out-of-scope note:** Plan ITEM 3 (agent bail-out pattern) is a coordinator/topology recommendation, not a code change. Nothing in the commits addresses it; the reviewer didn't expect it to. Filed for the swarm-topology doc.

---

## A. config_import fix (fork commit `a23ab3a74`)

### Pattern fidelity to BUG-A

**PASS — same fail-loud pattern, same shape, same diagnostic surface.** The new gates at `config-tools.ts:563–588` mirror BUG-A almost verbatim:

```ts
if (scope !== 'default' && store.__shape === 'legacy') {
  return { success: false, scope, shape: 'legacy', path: getConfigPath(),
    error: 'scope imports require MCP shape — legacy (init-generated) config.json cannot persist scoped values' };
}
if (store.__shape === 'legacy' &&
    Object.prototype.hasOwnProperty.call(config, 'scopes')) {
  return { success: false, scope, shape: 'legacy', path: getConfigPath(),
    error: 'legacy config.json rejects import payloads carrying a top-level `scopes` key — would corrupt the nested tree' };
}
```

Both gates fire **before** `Object.assign(store.values, config)` at line 597, so refusal is guaranteed file-untouched. Diagnostic payload includes `{success:false, scope, shape:'legacy', path, error}` — same shape as BUG-A's `config_set` refusal. Comment cites the prior fix and ADR-0082. No gratuitous divergence.

### Test coverage (4 new tests in §9 of `tests/unit/config-tools-shape-tolerance.test.mjs`)

| Required by task | Covered? | Test |
|---|---|---|
| Legacy + scoped reject + file untouched | **YES** | `ITEM-1 #1` — `success:false`, `error` mentions `scope`, byte-exact `Buffer.equals` before/after |
| Legacy + plain default-scope merge succeeds | **YES** | `ITEM-1 #2` — `success:true`, persisted nested tree, init keys survive, no `values`/`scopes` wrapper leaks in |
| MCP + scopes-in-payload succeeds | **YES** | `ITEM-1 #3` — MCP wrapper preserved, payload merged into `store.values` per pre-existing semantics |
| Legacy + scopes-in-payload reject + file untouched | **YES** | `ITEM-1 #4` — `success:false`, byte-exact compare |

All four assertions are strong: explicit failure messages, byte-exact buffer comparison (not substring), and the success path verifies both the return value AND the on-disk JSON. No silent-pass branches.

`node --test tests/unit/config-tools-shape-tolerance.test.mjs` → **38/38 pass** (the 4 new tests + the 34 pre-existing).

### Live behavioural probes (rebuilt dist `01:14`)

```
PROBE_PLAIN          → success:true                 (legacy + foo:'bar' merges, file shows 'foo':'bar')
PROBE_NONEMPTY_SCOPES→ success:false (rejected)     (legacy + scopes:{user:{x:1}}, file unchanged)
PROBE_BOTH (CATASTROPHIC) → success:false (rejected) (legacy + values:{...} + scopes:{...}, file unchanged)
```

Catastrophic case (both `values` AND `scopes` in payload — would otherwise have flipped shape detect to MCP and orphaned the entire init tree) is refused because the `scopes` clause catches it before `values` matters. So the worst real-world case is covered.

### Correctness gaps

#### Nit A1 (gap from plan): `values`-only payload on legacy is not caught

```
PROBE_VALUES_KEY (legacy + values:{'foo.bar':'baz'}) →
  success:true, file gains a literal top-level "values":{"foo.bar":"baz"} alongside swarm/version
```

The plan said `if (… && ('scopes' in config || 'values' in config))`. The diff only kept the `scopes` half. The file post-import contains both the original init keys AND an out-of-place `values` wrapper at the top. `detectShape` still returns `legacy` on the next load (it requires *both* `values` AND `scopes`), so it doesn't catastrophically reinterpret the tree — but the file is now visibly corrupt and any future refactor that loosens shape-detect to "either values or scopes ⇒ MCP" would turn this into a data-loss path. Symmetric to the BUG-A class the fix exists to prevent.

**Fix sketch (one line):**

```ts
Object.prototype.hasOwnProperty.call(config, 'scopes') ||
Object.prototype.hasOwnProperty.call(config, 'values')
```

Plus one matching test. Non-blocking — file the nit and ship.

#### Nit A2 (edge-case divergence from task brief): empty `scopes:{}` rejected

```
PROBE_EMPTY_SCOPES (legacy + scopes:{}) →
  success:false, error: 'legacy config.json rejects import payloads carrying a top-level `scopes` key — would corrupt the nested tree'
```

Task focus brief explicitly called out: "import payload with EMPTY `scopes: {}` — should NOT trigger rejection (that's a no-op import)". The current `hasOwnProperty` gate makes no shape/size discrimination, so it fires.

Two reasonable answers:

- **Strict (current behaviour):** any `scopes` key signals scope-intent, refuse uniformly. Defensible — caller meant *something* by including it.
- **Permissive (per brief):** `Object.keys(config.scopes).length === 0` is a no-op, allow it through.

Either is reasonable; neither is currently pinned by a test in §9 (test #4 uses `scopes:{user:{foo:'bar'}}`, not `{}`). Ask the user which behaviour they want and add the test. **Non-blocking** because the strict reading is at worst a pickier API, not a data-loss path.

---

## B. `:memory:` cleanup (patch commit `9bcf423`)

| Probe | Result |
|---|---|
| File gone from working tree | **PASS** — `ls /Users/henrik/source/ruflo-patch/:memory:` → No such file or directory |
| `.gitignore` has `:memory:` entry | **PASS** — line 73 (`:memory:`), preceded by a 4-line explanatory comment block (lines 69–72) |
| No `git add -A` slipped in other junk | **PASS** — `git show 9bcf423 --name-only` lists exactly `.gitignore`, `lib/acceptance-phase8-invariants.sh`, `tests/unit/config-tools-shape-tolerance.test.mjs`. Working-tree dirt (`.claude-flow/data/*.json`) was correctly *not* staged. |
| Root cause fix in fork? | **PASS** (already there) — `rvf-backend.ts` has `:memory:` guards at L20, L232, L233, L291, L733, L820. The fork is already correct; this commit only addresses the stale artifact + safety-net gitignore. The plan called this out as the right call (no fork patch needed for a non-reproducible artifact). |

The plan's reasoning ("the file is a stale artifact from a path that bypassed the backend wrapper") is sound and the commit message reproduces it accurately. Cleanup-only commit, no behavioural change in either repo.

---

## C. INV-11 tighten (patch commit `9bcf423`, `lib/acceptance-phase8-invariants.sh:693–707`)

### Diff verification

```diff
-  if (( confirmed >= 2 )); then
-    _CHECK_PASSED="true"
-    _CHECK_OUTPUT="INV-11 OK: delta-sentinel confirmed $confirmed/$probes …"
-  elif (( confirmed >= 1 )); then
-    _CHECK_PASSED="true"
-    _CHECK_OUTPUT="INV-11 OK (partial): $confirmed/$probes …"
+  if (( confirmed == probes )); then
+    _CHECK_PASSED="true"
+    _CHECK_OUTPUT="INV-11 OK: … (strict all-required)"
   else
+    _CHECK_OUTPUT="INV-11 FAIL: delta-sentinel requires all $probes probes … only $confirmed confirmed — tools may be silently no-op'd. misses=$failures"
     _CHECK_PASSED="false"
   fi
```

| Required by task | Result |
|---|---|
| `(( confirmed == probes ))` strict? | **PASS** — exactly that line at `:701` |
| Error message mentions which probe(s) failed if `< probes`? | **PASS** — `misses=$failures`; `$failures` is a space-separated string of `A:memory_store(…)`, `B:workflow_create(…)`, `C:agent_spawn(…)` tokens populated upstream at L657/L671/L680 |
| Test run after change still 11/11 at 3/3 confirmation? | **PASS** — fast acceptance group `adr0094-p8` ran clean: `INV-11 OK: delta-sentinel confirmed 3/3 mutations cause observable list-body delta (strict all-required)`; final `Fast Results: 11/11 passed, 0 failed, 0 skip_accepted` |
| `skip_accepted` branch preserved for `probes == 0`? | **PASS** — `:687–691`, untouched, still emits `SKIP_ACCEPTED: INV-11: no list tools available …` |

Comment block (`:693–700`) cites ADR-0082 + Phase 8 follow-up + ITEM 4 + the explicit reasoning that the previous partial-pass masked real regressions. Good provenance.

This is a textbook `phase8-coder-review.md`-style tightening — exactly what ITEM 4 prescribed.

---

## D. Commit hygiene

| Required | Result |
|---|---|
| Fork commit on `main` branch (not feature branch) | **PASS** — `git branch --show-current` in `forks/ruflo` → `main` (HEAD is `a23ab3a74`) |
| ruflo-patch commit on `main` branch | **PASS** — `git branch --show-current` in `ruflo-patch` → `main` (HEAD is `9bcf423`) |
| ruflo-patch commit doesn't touch fork files | **PASS** — `git show 9bcf423 --name-only` is exactly `.gitignore`, `lib/acceptance-phase8-invariants.sh`, `tests/unit/config-tools-shape-tolerance.test.mjs`. No `v3/` or fork-source paths. |
| Fork commit doesn't touch test/lib | **PASS** — `git show a23ab3a74 --name-only` is exactly `v3/@claude-flow/cli/src/mcp-tools/config-tools.ts` |
| No `dist/` or `codemod/` edits | **PASS** — `git show <sha> --name-only \| grep -cE 'dist/|codemod/'` → 0 in both commits |
| No accidental scope-rename | **PASS** — `git show a23ab3a74 -- v3/.../config-tools.ts \| grep -c sparkleideas` → 0 (fork stays at `@claude-flow/`) |
| Commit message style matches CLAUDE.md | **PASS** — both subjects ≤ ~73 chars, imperative mood, scoped (`fix(config-tools):`, `chore:`), bodies cite plan doc + ITEM numbers, both end with `Co-Authored-By: claude-flow <ruv@ruv.net>` trailer |
| Build after fork change | **PASS** — `dist/src/mcp-tools/config-tools.js` mtime `09:14`, contains `scope imports require MCP shape` (line 529) and `hasOwnProperty.call(config, 'scopes')` (line 533); `wc -c` → 22233 bytes (up from prior commit's 20881) |
| No secrets / `.env` | **PASS** — diffs grep clean for `API_KEY|SECRET|TOKEN|PASSWORD|sk-` |
| 500-line rule | **SOFT WARN** — `config-tools.ts` grew 587 → 617 lines. Same ADR-0089 dispensation that applied to `7ea2175a1` (existing-file growth preferred over splitting to avoid upstream merge tax). Already accepted on the prior commit. |

---

## Test-level coverage check (CLAUDE.md "all three levels")

| Level | Status | Evidence |
|---|---|---|
| Unit | **PASS** | 4 new `it()` blocks in `tests/unit/config-tools-shape-tolerance.test.mjs` §9 (assertions on handler return values + module wiring) |
| Integration | **PASS** | Same 4 tests exercise real `loadHandlersUnderCwd` against real on-disk `config.json` files in tmp dirs (file write, dynamic import, byte-exact `readFileSync` comparisons, real `JSON.parse` of post-import state) |
| Acceptance | **PASS** | INV-11 acceptance check rebuilt under `lib/acceptance-phase8-invariants.sh:_inv11_body`; fast runner `bash scripts/test-acceptance-fast.sh adr0094-p8` returns `11/11 passed`; ADR-0082 strict branch is what's exercised |

ADR-0082 compliance: no silent-pass anywhere in the diff. The strict INV-11 path is itself an ADR-0082 hardening (the previous `>=1` branch was the kind of soft-fail this rule exists to prevent). The test additions assert on both return values AND on-disk state, with byte-exact buffer comparisons on the refusal paths.

---

## Out-of-scope observations (logged, not blocking)

### O1. ITEM 3 (agent bail-out) is a process change, not a code change

The plan's ITEM 3 recommends concrete-filesystem-flag coordination instead of "poll TaskList" for future swarms. Nothing in either commit addresses this — correctly so, because there's nothing to address in the source. File this in `08-swarm-topology-strategy.md` or its successor as a post-mortem note. Reviewer hit this exact pattern during this review session: the wait-loop pattern works fine; what doesn't work is asking an agent to "poll TaskList" when no TaskList entries are ever created by the coordinator.

### O2. Pre-existing ADR-0082 leak in `check_p5_compat_config_set`

Previously flagged in `phase8-coder-review.md` §3 and `phase8-nits-coder-review.md` §3. Still present in `lib/acceptance-init-generated-checks.sh:391–393`. Not touched by these commits — and nothing in the plan said to. Worth a separate cleanup pass.

### O3. `config_export` is not gated

The fix touches `config_set` (BUG-A, prior commit) and `config_import` (this commit). `config_export` and `config_reset` were the other shape-aware mutators; both were already correct (`config_reset` got fixed in BUG-B; `config_export` is read-only and shape-tolerant by construction). No follow-up needed, but worth a one-line audit-trail note that the BUG-A class has been swept across all four shape-aware tools now.

---

## Recommendation

**Approve-with-nits. Ship `a23ab3a74` + `9bcf423`. Tester unblocked.**

Tester can proceed with:

```bash
node --test tests/unit/config-tools-shape-tolerance.test.mjs   # 38/38
bash scripts/test-acceptance-fast.sh adr0094-p8                # 11/11
```

Both already verified green by reviewer.

The two nits should be tracked but do not block this round:

- **Nit A1** (`'values'` companion to `'scopes'`): file as `phase8-import-values-symmetric` follow-up. One-line gate addition + one test. <10 LOC.
- **Nit A2** (empty-scopes behaviour): brief disagreement with implementation. Confirm direction with the user, then either tighten the gate to `Object.keys(config.scopes).length > 0` (permissive, matches brief) or add a test pinning the strict behaviour with a comment explaining why we deviated from the brief. <5 LOC either way.

Both are tractable in the next round; neither makes the current commits unsafe to land.
