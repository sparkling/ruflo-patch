# 2026-05-25 — INTEGRATION-LEDGER superseded-by-local audit (slice A: 16 oldest)

Audit scope: 16 oldest `superseded-by-local` rows in `docs/upstream/INTEGRATION-LEDGER.md`,
sorted by the upstream-date column. Slice A is one of 5 parallel audit slices
covering all 48 such rows. Per `feedback-corpus-evidence-before-feature-work`
and `feedback-upstream-means-upstream`: every verdict is grounded in
`git log` / `git show` evidence against `ruvnet/*` for upstream and
`forks/*` for the fork-side superseding work.

## Summary

- **still-superseded**: 13
- **drifted**: 2 (proposed ledger action below)
- **upstream-rebased**: 0
- **stale-other**: 1 (proposed ledger action below)

### Drifted rows requiring ledger action

| Ledger line | Upstream SHA | Verdict | Proposed action |
|---|---|---|---|
| 185 | `0c31cbad4` (ruvnet/ruflo, 2026-05-20) | drifted — Phase 1a only (MCP tool + include-vectors default flipped); Phase 1b `memory retrieve --value-only` NOT shipped; ADR-0255 still `status: proposed` | Tighten Notes to "Phase 1a shipped via [[ADR-0255]]; `--value-only` retrieve flag DEFERRED" OR ship Phase 1b before treating as closed |
| 289 | `38105cf89` (ruvnet/**RuVector**, 2026-05-22) | drifted — fix is for the `ruvector-mcp` binary in **ruvector**; fork `forks/ruvector/crates/ruvector-cli/src/mcp_server.rs:50,54` still lacks `.with_writer(std::io::stderr)`. Ledger cites fork's ADR-0226 but ADR-0226 covers the CLAUDE-FLOW MCP stdio loop (ruflo `bin/cli.js` / `bin/mcp-server.js`), NOT the ruvector-mcp Rust binary. Wrong fork. | Re-tag as `keep-pending` or `cherry-pick`; the fork ruvector binary still emits log lines on stdout under stdio transport |

### Stale-other row

| Ledger line | Upstream SHA | Verdict | Proposed action |
|---|---|---|---|
| 135 | `c5006bf97` / `71826011b` / `c071ace70` (column labelled "Upstream SHA") | stale-other — these three SHAs are **fork commits** in `forks/ruflo`, not upstream commits. ADR-0212 disposition (remove `ruflo` from CLI bin map; arch-test + unit guards in place) remains correct, but the row's first column is a provenance mislabel | Move the three SHAs to the "Cited fork work" column or to Notes; the Upstream SHA column should be `_fork-local_` or `—` |

## Per-row findings

| # | Upstream SHA | Date | Subject | Cited fork work | Verdict | Evidence |
|---|---|---|---|---|---|---|
| 1 | `6a356ffe6` | 2026-01-05 | init: writer `CLAUDE_FLOW_TOPOLOGY` / `CLAUDE_FLOW_MEMORY_BACKEND` (rUv parallel-authorship) | _fork_ (ADR-0214) | still-superseded | `git -C ruvnet/ruflo show 6a356ffe6 --stat` exists (Mon Jan 5, init/executor.ts + 7 init files). Fork `forks/ruflo/v3/@claude-flow/cli/src/init/mcp-generator.ts:91-92` writes `CLAUDE_FLOW_SWARM_TOPOLOGY` / `CLAUDE_FLOW_MEMORY_TYPE` (aligned reader names, not the upstream theatrical pair). Arch-test `cli/__tests__/arch/env-var-theatrical-gate.arch.test.ts` present. |
| 2 | `b65f27e63` `87ba34854` | 2026-02-07 | Checkpoint: slash-to-dollar corruption across `.agents/skills/**/SKILL.md` | `cc3c27b41` (ADR-0215) | still-superseded | Both upstream SHAs exist (`git -C ruvnet/ruflo show`). Superseding fork commit `cc3c27b41` ("fix(skills): ADR-0215 revert slash-to-dollar corruption in .agents/skills/") present in `forks/ruflo`. Live gate: `find forks/ruflo/.agents/skills/ -name "SKILL.md" -exec grep -l '\$[a-z_]\+\$[a-z_]'` returns 0 matches. Gate `tests/pipeline/skill-shell-integrity.test.mjs` present in ruflo-patch. |
| 3 | `c5006bf97` `71826011b` `c071ace70` | 2026-04-21 onward | CLI bin map adds `ruflo` (merge-tax history) | `3f726dcec` (ADR-0212) | stale-other | All three SHAs resolve in `forks/ruflo` (NOT ruvnet/ruflo). The row labels them as upstream SHAs but they are fork-internal merge-tax history. Superseding commit `3f726dcec` ("fix(packaging): ADR-0212 remove `ruflo` from CLI bin map (Option B)") present. `forks/ruflo/v3/@claude-flow/cli/package.json` bin map confirms only `ruflo-mcp` / `cli` / `claude-flow` / `claude-flow-mcp` — no `ruflo`. Arch-test `adr0212-cli-bin-no-ruflo.arch.test.ts` + unit test `tests/unit/rebrand-ruflo-bin.test.mjs` present. Disposition holds; only the SHA-provenance label is wrong. |
| 4 | `df49b5176` | 2026-05-04 | ruflo-adr plugin contract v0.2.0 | (n/a) (ADR-0186) | still-superseded | `git -C ruvnet/ruflo show df49b5176` confirms 2026-05-04 v0.2.0 plugin contract. Fork `forks/ruflo/plugins/ruflo-adr/.claude-plugin/plugin.json` "version": "0.2.17" — fork is already past upstream's v0.2.0 baseline as claimed. |
| 5 | `70e233946` | 2026-05-10 | feat(federation): ADR-111 Phases 4-6 — firewall projection + witness chain + MCP tools (#1895) | — (ADR-0187) | still-superseded | `git -C ruvnet/ruflo show 70e233946` exists. ADR-0187 (`docs/adr/ADR-0187-adopt-upstream-adr-111-wireguard-mesh.md` line 2: `status: implemented`, "Chosen: Option 2 — Decline adoption"). `find forks/ruflo -name "wg-mesh-service.ts"` returns empty; `find … wg-witness-service.ts` returns empty. Decline holds. |
| 6 | `bcdeed8d` | 2026-05-10 | feat(federation): ADR-111 Phases 1-3 — opt-in WireGuard mesh layer (#1894) | — (ADR-0187) | still-superseded | Same as #5 — `git -C ruvnet/ruflo show bcdeed8d` exists; ADR-0187 declined the whole ADR-111 chain; fork has no WireGuard mesh code. |
| 7 | `8f0d90032` | 2026-05-10 | fix(federation): security — validate peer wg fields before splice (ADR-111) | — (ADR-0187) | still-superseded | Same as #5/#6 — `git -C ruvnet/ruflo show 8f0d90032` exists; ADR-111 declined per ADR-0187. |
| 8 | `0c31cbad4` | 2026-05-20 | fix(memory): #2073 — export returns real value + --value-only pipe-friendly retrieve | — (ADR-0255) | **drifted** | `git -C ruvnet/ruflo show 0c31cbad4` exists. ADR-0255 status is **`proposed`** (not `implemented`), date 2026-05-25. Phase 1a IS shipped: `memory_export` MCP tool registered at `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/memory-tools.ts:1330`, and `commands/memory.ts` `--include-vectors` defaults to `false`. Phase 1b (`memory retrieve --value-only` flag) is NOT shipped — `grep -nE "value-only\|valueOnly" forks/ruflo/v3/@claude-flow/cli/src/commands/memory.ts` returns zero matches. Ledger overclaims the second deliverable. |
| 9 | `38105cf89` | 2026-05-22 | fix(mcp): route tracing output to stderr to prevent JSON-RPC stdio corruption (#470) | — (ADR-0228) | **drifted** | SHA exists in `ruvnet/RuVector` (NOT `ruvnet/ruflo`). Upstream diff adds `.with_writer(std::io::stderr)` to `crates/ruvector-cli/src/mcp_server.rs:48-58`. Fork `forks/ruvector/crates/ruvector-cli/src/mcp_server.rs:50,54` still lacks the call. ADR-0226 (cited as the supersession) covers a DIFFERENT product: the ruflo claude-flow MCP stdio loop (`bin/cli.js` / `bin/mcp-server.js`), NOT the Rust `ruvector-mcp` binary. The ruvector fork still ships log lines on stdout under stdio transport — the upstream bug is genuinely uncovered. |
| 10 | _fork-local_ | 2026-05-23 | F-11-001/002/004/005: 4 init-emitted brand drifts | `dfe8ea93a` `1fa33d6` (ADR-0223) | still-superseded | `git -C forks/ruflo log --oneline dfe8ea93a` resolves ("fix(init): ADR-0223 canonicalize init-emitted MCP commands + brand hints"). Live verification of the 3 guarded files: `forks/ruflo/v3/@claude-flow/cli/src/init/mcp-generator.ts:152,162` emits `claude mcp add ruflo -- ... @sparkleideas/ruflo@latest`; `claudemd-generator.ts:283` matches; `mcp-generator.ts:155,165` pins `ruv-swarm@latest` (F-11-002 fix). Arch-test `adr0223-init-emitted-brand-canonicalization.arch.test.ts` present. |
| 11 | ADR-0235 bundled-static deletion | 2026-05-24 | fork-local: delete `v3/@claude-flow/cli/.claude/helpers/` (41 files) + invert `writeHelpers` preference | (this commit) (ADR-0235) | still-superseded | `ls forks/ruflo/v3/@claude-flow/cli/.claude/helpers/` returns "No such file or directory". Pipeline gate `tests/pipeline/init-helpers-parity.test.mjs` present in ruflo-patch. |
| 12 | ADR-0235 umbrella plugin.json rebrand | 2026-05-24 | fork-local: `.claude-plugin/plugin.json` rebrand + `install.sh` delete + brand-string fixes | (this commit) (ADR-0235) | still-superseded | `forks/ruflo/.claude-plugin/plugin.json` "name": "ruflo", author "Henrik Pettersen" (rebrand applied). `ls forks/ruflo/install.sh` returns "No such file or directory". Pipeline gate `tests/pipeline/umbrella-plugin-brand.test.mjs` present. |
| 13 | ADR-0234 site 1 vector-db fail-loud | 2026-05-24 | fork-local: `v3/@claude-flow/cli/src/ruvector/vector-db.ts` — throw at loader boundary | `f6df0656a` (ADR-0234) | still-superseded | `git -C forks/ruflo log --oneline f6df0656a` resolves ("fix(ADR-0234): sites 1+2 fail-loud throws — vector-db + diskann loaders"). Live: `vector-db.ts:175,190,239,258,299,321` all call `throwLoaderUnavailable`. Helper `loader-errors.ts` present. |
| 14 | ADR-0234 site 2 diskann fail-loud | 2026-05-24 | fork-local: `diskann-backend.ts` — three labelled throws | `f6df0656a` (ADR-0234) | still-superseded | `forks/ruflo/v3/@claude-flow/cli/src/ruvector/diskann-backend.ts:93,125,148` carry the three labelled throws `DISKANN_TIER_UNAVAILABLE` / `HNSW_TIER_UNAVAILABLE` / `PURE_JS_DISALLOWED`. |
| 15 | ADR-0234 site 3 embedding-pipeline + memory-router fail-loud | 2026-05-24 | fork-local: `embedding-pipeline.ts` + `memory-router.ts` — throw on missing transformers/ruvector | `004bdc493` (ADR-0234) | still-superseded | `git -C forks/ruflo log --oneline 004bdc493` resolves ("fix(ADR-0234): site 3 fail-loud throws — embedding-pipeline + memory-router"). Live: `embedding-pipeline.ts:204,224,294,304,315` carry ADR-0234 throws; `memory-router.ts:881-892` removes bare `catch{}` around `initPipeline`. |
| 16 | ADR-0234 site 4 claims fail-closed | 2026-05-24 | fork-local: `commands/claims.ts:265-271` — permissive-on-error → `{success:false, exitCode:1}` | `79d6ccab2` (ADR-0234) | still-superseded | `git -C forks/ruflo log --oneline 79d6ccab2` resolves ("fix(ADR-0234): site 4 fail-closed — claims check on policy-load error"). Live: `claims.ts:282-295` carries ADR-0234 fail-closed branch with `return { success: false, exitCode: 1 }` and literal `'ADR-0234'` in the printed message. |

## Methodology

For each row in the slice:

1. **Upstream existence check** — `git -C /Users/henrik/source/ruvnet/<repo> show <sha> --stat`. For the rows where the upstream SHA wasn't in `ruvnet/ruflo`, searched all five `ruvnet/*` repos (ruflo, agentdb, agentic-flow, ruv-FANN, RuVector) to identify the source repo.
2. **Superseding fork work check** — for the SHA(s) named in the "Cited fork work" column, `git -C /Users/henrik/source/forks/<repo> log --oneline <sha> -1`. For supersession by file/feature state rather than by named commit, ran direct file inspection.
3. **Live invariant check** — for rows that name an arch-test or pipeline gate, verified the gate file exists in the fork or in ruflo-patch.

## Slice-A boundary

The slice was selected by sorting all 48 `superseded-by-local` rows by the date column. The 16 oldest rows in date order span 2026-01-05 → 2026-05-24. Three rows share the date 2026-05-10 (all three ADR-111 federation phases); four rows share 2026-05-24 (ADR-0234 sites 1-4 + ADR-0235 bundled-static + ADR-0235 umbrella rebrand). The row at line 133 with date `2026-?` was excluded from this slice (sorts to the end as undated; other slices will cover it).
