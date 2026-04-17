# Sprint 0 — Prerequisites (ADR-0094 → 100%)

Baseline (verified from `test-results/accept-2026-04-17T150342Z/acceptance-results.json`): **452 / 396 pass / 1 fail (t3-2) / 55 skip**. CLI pinned at `3.5.58-patch.136`. 23 of 27 Phase-1–7 files carry per-domain `_<dom>_invoke_tool` drift; none parse an envelope.

## Work Items

### WI-1. Populate `config/mcp-surface-manifest.json`
`cli mcp list-tools` **does not exist**. Real subcommand: `cli mcp tools` (table output; `--json` accepted but ignored). `scripts/regen-mcp-manifest.mjs` impl:
1. `$(_cli_cmd) mcp tools` → strip `[AgentDB]/[INFO]` preamble, parse `/^\s{2}(\w[\w-]+)\s{2,}.*(Enabled|Disabled)\s*$/` → `mcp_tools[]`.
2. `$(_cli_cmd) --help` → 2-space indented names from PRIMARY/ADVANCED/UTILITY/ANALYSIS/MANAGEMENT → `cli_subcommands[]`.
3. Sanity guard: fail if `<150` or `>300` tools.
4. `npm view @sparkleideas/cli@latest version` → stamp `_pinned_cli_version`.

### WI-2. Minimum viable catalog (JSONL, no SQLite)
`scripts/catalog-rebuild.mjs` extended:
- `--append` reads newest `accept-*/acceptance-results.json`, **strips control chars** (`.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g,'')` — current output malformed at pos 109089, verified), appends one row per test to `test-results/catalog.jsonl`.
- `--show` prints dashboard (pass/fail/skip, verified + invoked coverage).
- `--verify` greps ADR-0094 digits, compares catalog; fails on divergence. Fingerprint = `sha1(check_id + first_error_line + fork_file)`.
- Fix `_escape_json` in `lib/acceptance-harness.sh` (tab/FF leaking) under this WI. SQLite layer deferred — JSONL handles 200-run depth.

### WI-3. Canonical `_expect_mcp_body`
**Envelope correction**: real CLI output is NOT `{content:[{type:"text",text:"..."}]}`. It is:
```
[AgentDB] Telemetry disabled
[INFO] Executing tool: <name>
[OK] Tool executed in Xms
Result:
<raw JSON or text>
```
Helper (≤40 LOC): `awk '/^Result:/{f=1;next}f'` extracts body, `tool.+not found|not registered|unknown tool` → `skip_accepted`, regex → `pass`/`fail`.

**Tier-X migration (Sprint 0)**: 10 files — `cli-commands`, `file-output`, `input-validation`, `error-paths`, `hooks-lifecycle`, `model-routing`, `aidefence`, `claims`, `workflow`, `coordination`. Remaining 13 roll forward as Tier-Z.

## Acceptance
1. Manifest has ≥200 tools + ≥25 subcommands; `--verify` passes.
2. `catalog-rebuild.mjs --show` renders 396/1/55; `--verify` green vs ADR-0094.
3. `_expect_mcp_body` compiled with paired `tests/unit/acceptance-harness-expect-mcp-body.test.mjs` covering ADR-0097's 5 paths.
4. `grep -c '_[a-z]*_invoke_tool' lib/acceptance-*-checks.sh` drops 23 → ≤13.
5. `npm run test:unit` green; `bash scripts/test-acceptance-fast.sh p1` green.
6. Cascade <300s (ADR-0038). Three commits: manifest, catalog, harness+migration.

## Swarm Profile
**6 agents, hierarchical, specialized**:
1. **queen** — serializes commits, owns gate.
2. **manifest-populator** — WI-1 + paired test.
3. **catalog-builder** — WI-2 + `_escape_json` fix.
4. **harness-migrator** — WI-3 + 10 paired unit tests.
5. **adversarial-reviewer** (ADR-0087) — argues 3 best reasons envelope assumption fails, parser misses tools, or `--verify` false-greens. Must produce one failing probe pre-signoff.
6. **out-of-scope-probe writer** (ADR-0087 addendum) — ships `scripts/diag-manifest-interproc.mjs` enumerating tools from `3.5.57` vs `3.5.58-patch.136` (skew test) + `tests/unit/catalog-malformed-json.test.mjs` feeding control-char JSON to `--append`.

## Risks
- **`mcp tools` format regression** — parser silently drops tools. Agent-6 probe on 2 versions; >10% divergence fails.
- **Control-char JSON** — 191 historical runs already corrupted; `--append` sanitizes defensively even after harness fix.
- **Envelope drift** — if upstream adopts `{content:[...]}`, add JSON-detection branch; fall through to raw if not.
- **Tier-X under-scoping** — 13 drift-helpers residual; gate allows per ADR-0097 Tier-Z.
- **ADR-0095 (t3-2) NOT a Sprint 0 dep** — blocks ADR-0094 `Implemented`, not Sprint 1 start. Flagged to prevent scope creep.
