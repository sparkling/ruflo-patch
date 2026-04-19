# Phase 8 Coder-Review Nits — Fix Design

**Author:** Agent R — **Date:** 2026-04-19
**Source:** `phase8-coder-review.md` §1–§3
**File:** fork `v3/@claude-flow/cli/src/mcp-tools/config-tools.ts` @ 454b4d7eb
**Probes:** `/tmp/ruflo-e2e-E5kTM` + `/tmp/ruflo-fast-DxYAX/node_modules/.bin/cli`

---

## A. BUG-A — scope write silently dropped on legacy save

### A.1 Reproduction (verified)

```bash
cd /tmp/ruflo-e2e-E5kTM
$cli mcp exec --tool config_set --params \
  '{"key":"scoped.key","value":"scopeval","scope":"user"}'
# → {"success":true,"shape":"legacy",…}
grep -c scoped .claude-flow/config.json   # → 0  (value never persisted)
```

### A.2 Root cause

`config-tools.ts:145` — `saveConfigStore` legacy branch: `payload = {...store.values}`. `store.scopes` is never written. Handler at `:302-313` writes to `store.scopes[scope]` regardless of shape.

### A.3 Fix — recommend **A2 (reject at handler, fail loudly)**

| Option | Verdict |
|---|---|
| A1 `__scopes` sidecar | Persists data but pollutes init template files with non-template top-level key. |
| **A2 reject** | **ADR-0082 compliant.** Legacy shape + non-default scope → `{success:false, error:"scope writes require MCP shape"}`. No silent loss. |
| A3 auto-upgrade to MCP | Irreversible; next `init --full` regenerates legacy → cyclical data loss. |

**Senior-in-3-years test:** A2 least surprising. A legacy file was emitted by `init` and has no scope concept — a scoped write has no right answer. A2 surfaces the mismatch; A1 hides it; A3 mutates the file behind the user's back.

### A.4 New unit tests

1. `config_set scope=user` on legacy → `success:false` + error mentions scope + file byte-identical before/after
2. `config_set scope=default` on legacy → still succeeds (anti-regression)
3. `config_set scope=user` on MCP → persists across reload

---

## B. BUG-B — `config_reset({})` on legacy produces dotted top-level keys

### B.1 Reproduction (verified)

```bash
$cli mcp exec --tool config_reset --params '{}'
node -e 'const c=JSON.parse(fs.readFileSync(".claude-flow/config.json"));
         console.log(Object.keys(c).filter(k=>k.includes(".")).length,
                     c.swarm?.topology)'
# → 11 undefined   (c["swarm.topology"] === "mesh" instead)
```

### B.2 Root cause

`config-tools.ts:446-450`: legacy reset does `Object.assign(store.values, DEFAULT_CONFIG)` where `DEFAULT_CONFIG` (`:39-51`) is flat. Injects 11 dotted strings into a previously-nested tree. `check_p5_compat_config_set`'s nested reader breaks.

### B.3 Fix — recommend **B1 (rebuild via setNestedValue)**

| Option | Verdict |
|---|---|
| **B1 setNestedValue rebuild** | **Smallest diff.** Replace `Object.assign` with `for (const [k,v] of Object.entries(DEFAULT_CONFIG)) setNestedValue(store.values, k, v)`. `setNestedValue` already wired, depth-guarded. No new imports. |
| B2 import `buildConfig` | Cross-module dep mcp-tools→init; pulls 40+ keys (neural, controllers, workers…) beyond "defaults" semantics. Scope creep. |
| B3 DEFAULT_CONFIG_NESTED | Two parallel maps drift over time. Anti-pattern. |

**Senior test:** B1 keeps DEFAULT_CONFIG as single source of truth; the reset path just stops assuming flat.

### B.4 New unit tests

1. `config_reset({})` on legacy → no dotted top-level keys; `c.swarm.topology === "mesh"`; `c.memory.persistInterval === 60000`
2. `config_reset({})` on MCP → file stays flat `{values:{"swarm.topology":"mesh",…}}` (anti-regression)
3. After legacy reset, `config_get("swarm.topology")` round-trips `"mesh"`

---

## C. Test coverage gap

Add ONE new `describe` at the end of `tests/unit/config-tools-shape-tolerance.test.mjs` titled `INV-6 follow-up — scope + reset on legacy`. Do NOT touch the existing 22 tests. Six total new tests (§A.4 + §B.4), each asserting on BOTH handler return value AND on-disk file content (ADR-0082). No new static-source guard — the existing block at `:502-567` already fences shape literals; these fixes add no new sentinels.

## D. Phase 8 invariants — INV-12 / INV-13?

**Defer.** Six unit tests close the window at zero Verdaccio cost. Acceptance adds ~30s/check runtime and CLI/JSON flakiness; INV-6 + `check_p5_compat_config_set` cover the user-visible legacy path. Escalate only if a regression slips past unit.

## E. JSDoc on `resolveValue` (review §3)

**Bundle.** One-line `@remarks` (literal-dotted-key shadows nested walk) is zero-cost and lives in the same file already being edited for A/B. Deferring means re-opening the file.

## Summary

A2 + B1 + 6 unit tests + 1-line JSDoc, one focused commit. No Phase 8 acceptance additions.
