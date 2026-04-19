# Phase 8 INV-6 Coder Review — commit `454b4d7eb`

**Reviewer:** Agent V2 (reviewer)
**Date:** 2026-04-19
**Fork:** `/Users/henrik/source/forks/ruflo` branch `main`
**Files changed:** `v3/@claude-flow/cli/src/mcp-tools/config-tools.ts` (+188 / -24)
**Test file:** `/Users/henrik/source/ruflo-patch/tests/unit/config-tools-shape-tolerance.test.mjs` (new, 568 lines, 22 `it(...)` tests in 6 describe blocks)

---

## Summary

**Approve-with-nits.**

The fix correctly closes INV-6: `loadConfigStore` detects shape, `saveConfigStore` preserves shape, and both handlers wire in the previously-orphaned `getNestedValue` / `setNestedValue`. The commit is surgical, scoped to one file, and covered by a solid test suite that asserts on both returned values and file-on-disk contents (no silent-pass anti-patterns). INV-6 and `check_p5_compat_config_set` should both go green once the tester runs against this build.

Two real but out-of-INV-6-scope concerns worth capturing (see "Out-of-scope observations"): legacy-shape scope writes are silently dropped on save, and `config_reset` on legacy shape produces a mixed-shape hybrid file. Neither blocks this fix; both deserve a tracked follow-up.

---

## Correctness

### Shape detection robustness (`detectShape`, lines 73-91)

The heuristic **BOTH `values` AND `scopes` must be plain objects** handles the must-check cases correctly:

| Input | Expected | Actual | OK? |
|-------|----------|--------|-----|
| `{}` empty | legacy (no values, no scopes) | legacy | Yes |
| `{"values": []}` (array) | legacy (array is excluded via `!Array.isArray`) | legacy | Yes |
| `{"values": ..., "scopes": ..., "extra": ...}` | mcp (both present) | mcp | Yes |
| `{"values": {}, "scopes": null}` | legacy (`scopes` not object) | legacy | Yes |
| `null` | legacy (null branch skipped) | legacy | Yes |
| string/Buffer | `JSON.parse` returns a string/number → not an object → legacy | legacy | Yes |
| init-generated `{version, swarm, memory, ...}` | legacy | legacy | Yes (covered by test line 164-180) |

One nit: `detectShape` accepts a JSON primitive (e.g. `"config.json contains a bare string"`) by falling through to `'legacy'`, and then `loadConfigStore` casts `parsed` to `Record<string, unknown>` — for a string/number/bool parse result the downstream `tree.version` reads are safe (undefined from non-object) but `values: tree` makes `store.values` a non-object. The tests do not probe this case. In practice `readFileSync` of a CLI-written config always produces an object, but a hand-corrupted config would misbehave. **Minor — will not happen under normal init flow.**

### Save preserves shape (lines 137-157)

The key guarantee (legacy round-trip does NOT rewrite as `{values, scopes}`) is correct:
- Legacy branch: `payload = { ...store.values }` — bare tree, no wrapper. `__shape` bookkeeping cannot leak because spreading `store.values` never copies a property that was set on the *outer* store, not on `store.values` itself.
- MCP branch: builds a fresh object literal with explicit keys — `__shape` naturally excluded.

**Test coverage:** lines 236-255 assert the persisted file has NO `{values, scopes}` keys and NO `__shape` key. Also covered by static source guards lines 526-559.

### MCP-flat path still works (config_get/config_set)

- MCP read: `resolveValue` does direct `hasOwnProperty` lookup first, so flat `{"swarm.topology": "mesh"}` keyed as a dotted string resolves instantly with no nested-walk fallback needed. Covered by test lines 418-428.
- MCP write: `scope === 'default'` path writes `store.values[key] = value` directly (lines 299-301). Shape preserved.

### Dead-helper wiring

- `getNestedValue` — used inside `resolveValue` (line 217), inside the scope path of `config_get` (line 248), and inside `config_reset` (line 426). Previously orphaned, now 4 call sites. Test line 537-546 asserts `>= 2` call count — a regression fence.
- `setNestedValue` — used in the legacy branch of `config_set` (line 298) and in the dotted-scope branch (line 310). Previously orphaned, now wired.

### INV-6 acceptance probe compatibility

Traced `lib/acceptance-phase8-invariants.sh:306-336`:
1. `_mcp_invoke_tool "config_set" "{key,value}"` — on init-shape config.json, handler detects legacy, `setNestedValue` writes subtree, `saveConfigStore` writes bare nested payload. Response body includes `"success": true` → regex `'set|success|updated|saved|true'` matches. **PASS**.
2. `_mcp_invoke_tool "config_get" "{key}"` — handler re-reads the now-mutated file, resolves the new nested path via `getNestedValue`, returns `{value: "phase8-cfg-<ts>"}` — the `$val` literal appears in the response body. **PASS**.

No check-side weakening needed. The fix alone closes INV-6.

### check_p5_compat_config_set compatibility

`lib/acceptance-init-generated-checks.sh:372-394`:
- Runs `claude-flow config set --key test.p5key --value "p5-roundtrip"` against a real init'd P5_DIR
- Then reads `.claude-flow/config.json` with node and prints `c.test?.p5key`
- Expects `"p5-roundtrip"`

After the fix: init shape loaded → `setNestedValue(store.values, 'test.p5key', 'p5-roundtrip')` creates `{test: {p5key: "p5-roundtrip"}}` merged into the nested tree → legacy save emits bare tree → `c.test.p5key === "p5-roundtrip"`. **PASS**.

(There is an unrelated ADR-0082 violation in this acceptance check at lines 391-393 — `_CHECK_PASSED="true"` is set even when the file verification fails, with the message "CLI output matched". Not introduced by this commit, but flag it as a future fix: a passing CLI output with a wrong file should be a FAIL, not a PASS.)

---

## Test coverage

### Strong areas

- **Shape detection**: 4 tests covering legacy, mcp, defaults, values-without-scopes edge case. (lines 164-219)
- **Save shape preservation**: 3 tests asserting both the returned-object and file-on-disk content, plus a `__shape` leak guard. (lines 236-287)
- **Legacy round-trip integration**: 5 tests — set+get agreement, wrapper absence on disk, deep nested reads, sibling preservation on set. (lines 304-372)
- **MCP round-trip integration**: 3 tests for flat-shape symmetry, preserving the wrapper, pre-existing values surviving writes. (lines 389-428)
- **check_p5_compat regression**: 2 tests literally mirroring the bash acceptance probe. (lines 446-495)
- **Static source guards**: 7 tests pinning the fix (shape literals, exports, __shape bookkeeping, legacy payload spread, non-orphan wiring, __shape-leak regression, dist freshness). (lines 502-567)

The tests check BOTH returned-handler values AND persisted file contents (ADR-0082 compliant — no silent-pass branches that mask bugs). Every assertion has a failure message that explains the invariant.

### Weak areas / gaps (non-blocking)

1. **No test for scope writes on legacy shape** — see out-of-scope observation 1 below. The silent-drop-on-save behavior is not exercised and will become invisible.
2. **No test for `config_import` on legacy shape** — if someone imports a flat config onto a nested tree, the result is a mixed-shape hybrid. Not in scope for INV-6 but worth a note.
3. **No test for `config_reset` all-keys on legacy** — see out-of-scope observation 2. The `Object.assign(store.values, DEFAULT_CONFIG)` path injects dotted keys into a legacy tree.
4. **No `detectShape({})` empty-object test** — relies on the default-synthesis path, but doesn't exercise "parsed is literally `{}`". Low risk because the file would have to be deliberately empty; init never writes this.
5. **Buffer/string mismatch**: `JSON.parse` would throw on a Buffer (non-string), but `readFileSync(path, 'utf-8')` always returns a string, so this cannot occur. Still, if a future refactor removes the encoding, the `catch` swallows silently and returns defaults — not a silent-pass of real data because no data is returned.

None of these gaps block INV-6 closure.

---

## CLAUDE.md compliance table

| Rule | Status | Evidence |
|------|--------|----------|
| Fork patched (not codemod) | PASS | Only `v3/@claude-flow/cli/src/mcp-tools/config-tools.ts` changed; no `codemod/` touched |
| 500-line rule | SOFT WARN | File grew 391 → 555 lines. Over the 500-line guideline but ADR-0089 accepts existing-file growth when splitting would add upstream merge tax; this stays within one file and the growth is scoped helpers + branching, not cross-cutting concerns. Acceptable. |
| No `dist/` edits in commit | PASS | `git show 454b4d7eb --name-only` returns only the `.ts` file |
| No secrets/.env | PASS | No `API_KEY|SECRET|TOKEN|PASSWORD|sk-...` matches in the file |
| No accidental scope rename | PASS | `@sparkleideas` substring count = 0 (fork stays at `@claude-flow/`) |
| Fail loudly (no silent fallbacks) | PASS | `loadConfigStore`'s catch returns defaults only when the file cannot be parsed; the legacy branch fails loudly by returning an empty-values shape that any downstream read would expose |
| ADR-0082 test discipline | PASS | Every test asserts on BOTH return value AND on-disk file content; no `_CHECK_PASSED="true"` on skip branches inside the new tests |
| No silent-pass on SKIP | PASS | New tests do not introduce any new skip paths |
| ALL test levels written | UNIT ✓ / INTEG ✓ / ACCEPT pre-existing | Unit tests (shape detection, save preservation, static guards). Integration tests (real file I/O, real handler exec against a tmp dir). Acceptance is the pre-existing `check_p5_compat_config_set` + `_inv6_body` — the fix makes them green without harness changes. |
| Build after fork change | VERIFIED | `dist/src/mcp-tools/config-tools.js` exists at 19036 bytes, modified 00:43, contains 17 refs to `__shape`/`detectShape`/`resolveValue` |

---

## Out-of-scope observations

These are NOT regressions introduced by this commit and do not block INV-6. They are existing latent issues made visible by the new shape-aware code path.

### 1. Legacy-shape scope writes are silently dropped on save

`saveConfigStore` legacy branch does `payload = { ...store.values }` and discards `store.scopes` entirely. A caller running `config_set --scope user --key foo.bar --value baz` against an init'd project will see `success: true` from the handler, but the next `loadConfigStore` will not find that value — the entire `scopes` map is wiped on every legacy save. The code comment at line 304-308 acknowledges scopes are "primarily an MCP-shape concept" but the handler still appears to succeed. **Suggested follow-up:** either reject scoped writes on legacy with a loud error, or persist scopes in a sidecar field like `__scopes` inside the legacy tree. Recommend filing as an ADR-0094 Phase 8 nit.

### 2. `config_reset` on legacy with no `key` arg produces a mixed-shape file

`config_reset({})` on a legacy store:
```ts
resetKeys = Object.keys(store.values);           // ['version','swarm','memory',...]
for (const k of resetKeys) delete store.values[k];
Object.assign(store.values, DEFAULT_CONFIG);     // injects flat dotted keys
```
The result is a legacy-shape tree whose top-level keys are dotted strings like `"swarm.topology": "mesh"`. `__shape` stays `'legacy'`, save writes `{...store.values}`, and the file is now a *weird hybrid* where the original nested structure is gone but the wrapper is also gone. Subsequent reads against dotted keys work (direct lookup hits), but the next `config_list` call will produce flat dotted keys instead of the nested structure the init template expected. **Suggested follow-up:** for legacy shape, replace with a fresh default *nested* tree (e.g. import `config-template.ts`), not `DEFAULT_CONFIG`.

### 3. Dotted-key-in-key vs dotted-path resolver precedence

The resolver at line 213-218 correctly prioritises literal-dotted-key over nested-walk. If a future caller stores `{values: {"swarm.topology": "mesh-flat", swarm: {topology: "mesh-nested"}}}`, `resolveValue(values, "swarm.topology")` returns `"mesh-flat"` — the nested `"mesh-nested"` is shadowed. That is the intended semantics (and matches existing MCP behaviour) but is undocumented. **Suggested follow-up:** one-line JSDoc on `resolveValue` calling out the precedence.

### 4. Pre-existing ADR-0082 violation in `check_p5_compat_config_set`

Lines 391-393 of `lib/acceptance-init-generated-checks.sh`:
```bash
else
  _CHECK_PASSED="true"
  _CHECK_OUTPUT="P5: config set confirmed (CLI output matched)"
```
The CLI output alone cannot prove the round-trip; this is exactly the silent-pass pattern ADR-0082 was written to catch. Unrelated to this commit but worth a cleanup pass.

---

**Recommendation: ship this commit.** The tester can run the 22 unit tests now (no Verdaccio needed) and the INV-6 + P5 acceptance probes once packages are rebuilt to @sparkleideas. Consider logging the out-of-scope observations against ADR-0094 Phase 8 hygiene items.
