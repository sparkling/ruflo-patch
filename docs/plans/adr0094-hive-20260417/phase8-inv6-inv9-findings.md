# Phase 8 INV-6 & INV-9 Root-Cause Findings

Agent R research, 2026-04-19. Fast-runner result: 9 PASS / 1 FAIL (INV-6) / 1 SKIP_ACCEPTED (INV-9).

## INV-6: config_set / config_get — FAIL (confirmed)

**Reproduction:** `cd /tmp/ruflo-e2e-fsc19 && cli mcp exec --tool config_set --params '{"key":"inv6test","value":"hello"}'` → `Cannot read properties of undefined (reading 'inv6test')`.

**Root cause:** `loadConfigStore()` at `config-tools.ts:51-67` does naked `JSON.parse(data)` and returns whatever shape is on disk. Init writes the project-config shape (`{version, swarm:{…}, memory:{…}, neural:{…}}`) — NOT the `ConfigStore` shape the tool declares (`{values, scopes, version, updatedAt}`). Handler lines `config_set:181, 184, 189` and `config_get:144, 147` then access `store.values[key]` / `store.scopes[scope][key]`; `store.values` is `undefined` on an init'd project, so the `[key]` dereference throws.

Verified: `/tmp/ruflo-e2e-fsc19/.claude-flow/config.json` begins `{"version":"3.0.0","swarm":{…},"memory":{…},…}` — no `values` or `scopes` fields.

**Other MCP tools using `.claude-flow/config.json`:** only one — `system-tools.ts:315` — and it's read-safe (calls `existsSync()` only, never parses). No other tool touches that file.

**Other tools that read init-populated files (shape check, sweep complete):**

| Tool | File | Init-populated? | Shape-safe? |
|------|------|-----------------|-------------|
| `config-tools.ts` | `.claude-flow/config.json` | YES (init template) | **NO — broken** |
| `system-tools.ts` | `.claude-flow/config.json` | YES | YES (existsSync only) |
| `memory-tools.ts` | `.claude-flow/memory/…` + `memory.rvf` | RVF populated | YES (uses router/controller, not JSON.parse) |
| `claims-tools.ts` | `.claude-flow/claims/claims.json` | YES (test seed only) | YES (shape matches `{claims, stealable, contests}`) |
| `session-tools.ts` | `.claude-flow/sessions/*.json` | dir empty on fresh init | YES (per-session files, no init blob) |
| `agent / swarm / task / workflow / hive-mind / coordination / daa / github / terminal / hooks / wasm-agent / ruvllm` | `.claude-flow/<subdir>/store.json` | subdirs empty on init | YES (self-created on first write) |
| `neural-tools.ts` | `.claude-flow/neural/{models,patterns}.json` | dir not created by init | YES (self-created) |
| `embeddings.json` | not read by any mcp-tool | N/A | N/A |

**Net:** the bug is isolated to `config-tools.ts`. No other MCP tool shares the anti-pattern against an init'd project today. Sibling `system-tools.ts` is read-only against the file.

**Dead code:** `getNestedValue` (line 75) and `setNestedValue` (line 100) are defined but **never called** anywhere in the tree (grep confirms). They were clearly intended to traverse dot-notation keys (e.g., `swarm.topology`) against the nested init shape — an abandoned refactor. The tool schema already advertises "dot notation supported" in both `config_get` and `config_set` descriptions, but the handlers still use flat `store.values[key]` lookup.

**Recommended fix approach (two layers):**
1. **Shape adapter in `loadConfigStore()`:** detect legacy/init shape (no `values` field) and either (a) migrate by lifting the nested object into flat dot-notation entries under `values`, or (b) keep nested and teach handlers to use `getNestedValue`/`setNestedValue`. Option (b) is better — it keeps the on-disk file human-editable and matches the init template.
2. **Wire up the dead helpers:** replace `store.values[key] = value` with `setNestedValue(store, key, value)` and the reads with `getNestedValue(store, key)`. Keep `DEFAULT_CONFIG` as a fallback map, but look it up via `getNestedValue` too.

## INV-9: neural_status — SKIP_ACCEPTED (by design, slightly misleading)

**Handler:** `neural-tools.ts:449-489`. Returned shape does NOT include `patternCount`; instead it nests pattern stats under `patterns.total` (line 475) and `patterns.byType` (476-479). So the invariant check that greps for `patternCount` will never match.

**Is `patternCount` supposed to exist?** No evidence it was ever exposed. No TODO/FIXME, no commented-out field. The handler counts patterns from `Object.values(store.patterns)` (line 461) and reports the count as `patterns.total`. This is a **legit response shape** — pattern storage works, it just lives at a different key name than the INV-9 check assumes.

**Not a stub.** The surrounding code is fully functional: `neural_patterns store` (line 327) persists to `store.patterns`, `neural_train` persists to `store.models`. `neural_status` reads and aggregates from both. The only "fake" bits are `_realSimilarity: true` advertisements in `neural_patterns.search`, which aren't relevant to INV-9.

**Fix scope for INV-9:** change the acceptance check to probe `patterns.total` (the actual field), OR add a flat `patternCount` alongside `patterns.total` for backward compatibility. Check fix is simpler and more honest — the INV-9 assertion was wrong, not the handler.

## Summary / Scope Recommendation

Fix scope is narrow. INV-6 is a single-file bug in `config-tools.ts` (shape mismatch + dead-code `getNestedValue`/`setNestedValue` never wired). No broader sweep needed — one-time audit of all 20 mcp-tool files confirmed `config-tools.ts` is the only tool that parses an init-populated config blob with a shape-divergent interface. INV-9 is a test-side naming mismatch (`patternCount` vs `patterns.total`), not a production bug — fix the check, not the handler. Coder should (1) migrate `loadConfigStore()` to consume the nested init shape via the existing dead helpers, and (2) update the INV-9 acceptance check to inspect `patterns.total`. Both fixes are bounded to ~30 LOC total and do not require cross-tool refactoring.
