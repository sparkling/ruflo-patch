---
status: accepted
date: 2026-05-24
tags: [audit, soundness, completeness, second-pass, audit-followup]
supersedes: []
depends-on: [ADR-0201]
implements: []
---

# Second-pass soundness audit findings (2026-05-24)

## Context and Problem Statement

This decision was completed; implemented on 2026-05-24.

[[ADR-0201]] documented the 2026-05-19 audit of 6 named surfaces (controllers, hooks, MCP, daemon, init, skills) and surfaced an explicit backlog in its [Reviews still owed](./ADR-0201-codebase-soundness-completeness-audit-with-runtime-validation.md#reviews-still-owed-added-2026-05-24) section: 10 §D next-pass surfaces, 2 §E cross-cutting items, and 2 LOW §A items the first audit had marked as deferred.

On 2026-05-24 a 14-agent swarm reviewed all 14 surfaces in parallel under the same read-only-or-sandboxed discipline as the May-19 audit. Each agent wrote a dedicated finding file to `docs/audits/2026-05-24-second-pass-audit/NN-slug.md`. This ADR consolidates the cross-cutting verdict and decides how to act.

## Verdicts by slice

| # | Slice | Gap ID | Findings | Top severity | Output |
|---|-------|--------|----------|--------------|--------|
| 01 | CLI commands beyond `daemon`/`init` | G-16-001 [HIGH] | 13 | 2 CRITICAL | [01](../audits/2026-05-24-second-pass-audit/01-cli-commands-beyond-daemon-init.md) |
| 02 | Build pipeline soundness | G-16-003 [HIGH] | 14 | 3 CRITICAL | [02](../audits/2026-05-24-second-pass-audit/02-build-pipeline-soundness.md) |
| 03 | AgentDB internals (RVF, HNSW, archivist) | G-16-004 [HIGH] | 9 | 3 CRITICAL | [03](../audits/2026-05-24-second-pass-audit/03-agentdb-internals.md) |
| 04 | Security (aidefence, claims, PII) | G-16-005 [HIGH] | 11 | 3 CRITICAL | [04](../audits/2026-05-24-second-pass-audit/04-security-aidefence-claims-pii.md) |
| 05 | Telemetry / observability | G-16-006 [HIGH] | 11 | 3 HIGH | [05](../audits/2026-05-24-second-pass-audit/05-telemetry-observability.md) |
| 06 | WASM modules + native bindings | G-16-007 [HIGH] | 9 | 2 CRITICAL | [06](../audits/2026-05-24-second-pass-audit/06-wasm-native-bindings.md) |
| 07 | Plugin contents | G-16-002 [HIGH] | 10 | 3 CRITICAL | [07](../audits/2026-05-24-second-pass-audit/07-plugin-contents.md) |
| 08 | Embedding pipeline | G-16-008 [MEDIUM] | 13 | 5 HIGH | [08](../audits/2026-05-24-second-pass-audit/08-embedding-pipeline.md) |
| 09 | Consensus protocols | G-16-010 [MEDIUM] | 11 | 5 HIGH | [09](../audits/2026-05-24-second-pass-audit/09-consensus-protocols.md) |
| 10 | Performance / leaks (static) | G-16-014 [MEDIUM] | 12 | 2 CRITICAL | [10](../audits/2026-05-24-second-pass-audit/10-performance-leaks.md) |
| 11 | Whole-tree dead-code scan | §E.1 | 23 | 4 CRITICAL | [11](../audits/2026-05-24-second-pass-audit/11-dead-code-scan.md) |
| 12 | Init template fidelity | §E.3 | 8 | 1 HIGH | [12](../audits/2026-05-24-second-pass-audit/12-init-template-fidelity.md) |
| 13 | Error taxonomy | G-16-017 [LOW] | 9 | 2 MEDIUM | [13](../audits/2026-05-24-second-pass-audit/13-error-taxonomy.md) |
| 14 | Schema / type definitions | G-16-018 [LOW] | 12 | 1 CRITICAL | [14](../audits/2026-05-24-second-pass-audit/14-schema-type-definitions.md) |

**Total: 165 findings** across 14 slices (~26 CRITICAL/HIGH, the remainder MEDIUM/LOW/NOTE/INFO). §E.2 (codemod golden-master) was already implemented by [[ADR-0215]] and was not re-audited.

## Cross-cutting themes

Ten patterns recur across multiple slices. Theme-batched remediation will be more tractable than per-finding ADRs.

### CT-A — Silent fallbacks recur; [[ADR-0095]] amendment was applied only to `rvf-backend.ts`

The 2026-05-23 amendment that removed pure-TS fallbacks was a surgical fix. Three sibling loaders still ship the same anti-pattern:

* `forks/ruflo/v3/@claude-flow/cli/src/ruvector/vector-db.ts:103-130` — hash-stretched-sine fake "embedding" (`Math.sin(hash * (i+1) * 0.001)`); `getStatus()` codifies `backend: 'fallback'` as a state (F-06-001 CRITICAL).
* `forks/ruflo/v3/@claude-flow/cli/src/ruvector/diskann-backend.ts:54-114` — cascade `diskann → hnsw → cosine-js` with empty `catch { /* Fall through */ }` (F-06-002 CRITICAL).
* `forks/ruflo/v3/@claude-flow/memory/src/embedding/embedding-pipeline.ts:147-167` + `memory-router.ts:880` — silent ONNX-init failure → hash-provider (F-08-002 HIGH).
* `forks/ruflo/v3/@claude-flow/cli/src/commands/claims.ts:268-271` — RBAC `check` catches errors and grants every non-`admin:*` claim by default (F-04-002 CRITICAL).
* `commands/plugins.ts` — `plugins install` description claims IPFS, silently installs from npm (F-01-008 HIGH).

### CT-B — Wrapper-bundled static files override source-of-truth generators

Several "implemented" ADRs are invisible at runtime because `executor.ts:findSourceHelpersDir` prefers the wrapper's bundled static `.claude/helpers/*.mjs` over the regenerator:

* [[ADR-0211]] hook-handler subcommands: source has 14, bundled static has 8 → May-19 F-02 defect **still live in published output** (F-12-001 HIGH).
* Stop hook `auto-memory-hook.mjs sync` flag: same root cause (F-12-003 MEDIUM).
* [[ADR-0143]] brand rebrand: `forks/ruflo/.claude-plugin/plugin.json` still says `name: "claude-flow"`, `version: 2.5.0`, author `rUv`; `install.sh` writes a `claude-flow` MCP key invoking `npx claude-flow@alpha` (F-07-003 CRITICAL).

This is the init-template equivalent of the codemod gap that [[ADR-0215]] closed.

### CT-C — Hardcoded list drift (the [[ADR-0231]] wave A9 pattern recurs four more times)

ADR-0231 fail-loud landed in `publish.mjs::buildPackageMap`. The underlying defect — multiple hand-aligned scope/package-name registries that must stay in lockstep — is unchanged at four sibling sites:

* `scripts/fork-version.mjs::SCOPES` + `UNSCOPED_PUBLISHABLE`
* `scripts/codemod.mjs::UNSCOPED_MAP`
* `scripts/build-packages.sh::_v3_packages` (literal)
* `scripts/preflight-discover.mjs::isInScope`

Observable drift today: `agentic-jujutsu` is in `UNSCOPED_MAP` but absent from `UNSCOPED_PUBLISHABLE` (F-02-001 CRITICAL).

### CT-D — Silent numeric clamps (the `.max(10)` pattern recurs four more times)

`forks/ruvector/crates/ruvllm-wasm/src/sona_instant.rs` ships four siblings of the today-fixed `set_pattern_capacity` clamp: `set_micro_lora_rank` (l.131 `value.max(1).min(4)`), `set_learning_rate` (l.143), `set_ema_decay` (l.155), `set_ewc_lambda` (l.179). The crate's `[lints]` config disables `manual_clamp` so clippy never flagged them. JS-side `HNSW_MAX_SAFE_PATTERNS = 1024` cap (`ruvllm-wasm.ts:142`) overrides user `config.maxPatterns` silently then throws mid-ingest on the 1025th `addPattern` (F-06-003, F-06-004).

### CT-E — Surface without enforcement

Rich APIs sit on top of code paths that never invoke them:

* **AIDefence**: 6 MCP tools, zero non-test callers. `memory_store`, `agent_spawn`, `callMCPTool` all bypass (F-04-001 CRITICAL).
* **Claims RBAC**: API exists in `commands/claims.ts`; central MCP dispatch (`mcp-client.ts::callMCPTool`, `archivist.dispatch`) performs no claims check (F-04-003 CRITICAL).
* **Telemetry**: ~580 LOC OpenTelemetry scaffolding in `forks/agentdb/src/observability/` with zero call sites. `agentdb_telemetry_metrics` / `_spans` MCP tools call methods that don't exist on `TelemetryManager` — permanently dead (F-05-003 HIGH).
* **Consensus**: agentdb's "Raft" handler has no leader election and no log replication; `paxos` silently substituted to Raft; 5 consensus agent types are prompt-only Markdown with no dispatch (F-09-001 through F-09-010).

### CT-F — Parallel implementations (May-19 §E hint confirmed, 5x bigger)

Whole-tree dead-code scan tallied ~57,200 LOC unique TS source dead (excluding the documented `archive/`):

| Rank | Path | LOC |
|------|------|-----|
| 1 | `forks/ruflo/v3/plugins/gastown-bridge/` | 20,254 |
| 2 | `forks/ruflo/v3/plugins/agentic-qe/` | 17,036 |
| 3 | `forks/ruflo/v3/@claude-flow/testing/` | 16,566 |
| 4 | `forks/ruflo/v3/mcp/` (server + transport) | 5,587 |
| 5 | `forks/ruflo/v3/src/` parallel DDD scaffold | 3,612 |

The May-19 audit called `v3/mcp/` 1,112 LOC; the full subtree including `transport/` is 5,587 LOC. The dead embedding stack (`@claude-flow/embeddings/embedding-service.ts`, 1,169 LOC) contains the [[ADR-0094]] CVE-mitigated transformers loader — the **live** path doesn't have it (F-08-002 secondary).

### CT-G — STDIO/stdout corruption + PII leak in logging

Two specific stdout-write sites on `StdioServerTransport` MCP servers (would corrupt JSON-RPC):

* `forks/ruflo/v3/mcp/server-entry.ts:140-162` — `createLogger` writes `info`/`debug` via `console.info`/`console.debug` → **stdout**. The `tool:called` debug event logs full memory key/value/namespace/tags (F-05-001 HIGH — JSON-RPC corruption AND PII leak).
* `forks/agentdb/src/mcp/agentdb-mcp-server.ts:2016` — `console.log("Training session...")` from a `StdioServerTransport` MCP server (F-05-002 HIGH).

### CT-H — Schemas lie about what handlers enforce

* `memory_store` MCP `inputSchema.required: ['key','value','namespace']`; handler does `namespace ?? 'default'`. `memory_retrieve`/`memory_delete` THROW on missing namespace → asymmetric write-silent / read-strict data-partitioning bug determined by client strictness (F-14-001 CRITICAL).
* `MemoryType` redefined **seven times** with disjoint enum unions; `AgentType` 5 variants; canonical Zod `SpawnAgentSchema` intentionally bypassed at `validate-input.ts:317` (F-14-002, F-14-003).
* `MCPTool` interface — **23 production definitions** across 4 packages + 17 plugins.
* `optional-modules.d.ts` declares `agentdb`/`ruvector`/`@xenova/transformers`/`better-sqlite3` as ambient-`any` (3 copies) — all cross-package callsites lose static safety (F-14-009).

### CT-I — Error-handling cultural debt

108 error classes across forks; **1,218 naked `throw new Error(...)` in ruflo, 776 in agentdb**; only 3 `{cause: e}` chains. All ~56 MCP tool handlers swallow into `{success: false, error: sanitizeError(e)}` strings (5 separate `sanitizeError` definitions). 480-LOC `production/error-handler.ts` exists but is never instantiated. Two retry libraries exist; both have zero callers; 8 ad-hoc retry loops across packages. `gastown-bridge/src/errors.ts` is the gold-standard hierarchy (F-13-009).

### CT-J — Process-lifetime resource drift on long-lived processes

* `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/ruvllm-tools.ts:40-42` — three module-scope `Map<string, WasmHandle>`s (`hnswRouters`, `sonaInstances`, `loraInstances`) leak WASM-heap-backed entries for process lifetime (F-10-001 CRITICAL).
* `v3/mcp/` timers (`ConnectionPool.evictionTimer`, `WebSocketTransport.heartbeatTimer`, `SessionManager.cleanupTimer`) are not `.unref()`'d — CLI commands that transiently construct these hang the Node event loop on exit (F-10-002 CRITICAL).
* `RvfBackend._pendingNativeIngest` retains up to 100K Float32Arrays (~300MB) until first semantic `search()` rehydrates (F-10-007 WARN).

## Remediation ADRs (one per cross-cutting theme)

Drafted 2026-05-24 as theme-batched per the Decision below. Each was pre-flight-checked against [[ADR-0201]] §"Remediation-ADR pre-flight checklist"; several flipped based on runtime/upstream/inventory re-derivation — see "Pre-flight inversions" below.

| Theme | ADR | Decision shape | Impact (severity rollup) | Status |
|-------|-----|----------------|--------------------------|--------|
| CT-A | [[ADR-0234]] | Per-site fail-loud throw at 5 sibling loaders extending [[ADR-0095]] | 3 CRITICAL + 2 HIGH (5 sites) | proposed |
| CT-B | [[ADR-0235]] | Delete bundled `.claude/helpers/` + invert `findSourceHelpersDir` preference + build-time parity test | 1 CRITICAL + 1 HIGH + 1 MED (3 sites) | proposed |
| CT-C | [[ADR-0236]] | Pipeline-start cross-registry pairwise lint at gate-0 | 1 CRITICAL (5 sites, live drift confirmed) | proposed |
| CT-D | [[ADR-0237]] | Return `Result<(), JsValue>` from 4 `sona_instant.rs` setters; HNSW `maxPatterns` validation at construction; re-enable `manual_clamp` clippy lint | 5 sites (4 Rust + 1 JS cap) | proposed |
| CT-E | [[ADR-0238]] | Per-surface triage: AIDefence framing-honesty, remove dead telemetry MCP tools, **quarantine** dead swarm tree (upstream active), enum-align `weighted` | 3 CRITICAL + 4 HIGH (8 surfaces) | proposed |
| CT-F | [[ADR-0239]] | Per-cluster triage: 5 strict deletes, 1 merge-then-delete (CVE-loader relocation prerequisite), 2 deferrals, 1 release-gate `no-new-dead-code` check | 4 CRITICAL (~57K LOC, 8 clusters) | proposed |
| CT-G | [[ADR-0240]] | Route `console.log/info/debug` on stdio MCP servers to stderr + narrow `no-console` ESLint rider; site #1 contingent on CT-F | 2 HIGH (2 sites) | proposed |
| CT-H | [[ADR-0241]] | **Relax** `memory_store` schema to upstream-aligned `['key','value']` + sampled schema-handler parity arch-test + replace `validate-input.ts:317` Zod-bypass with explicit allowlist | 1 CRITICAL + 3 WARN | proposed |
| CT-I | [[ADR-0242]] | Extract `gastown-bridge/src/errors.ts` to shared `@claude-flow/errors` + advisory-first lint forbidding NEW `throw new Error(string)` + MCP-handler arch-test asserting fatals throw | 2 MED + cultural (~1,331 throws, grandfathered) | proposed |
| CT-J | [[ADR-0243]] | Per-site fix using in-tree healthy patterns (`HiveLRU`, `installSignalHandlersOnce`, `.unref()`) + `no-unref-setinterval` ESLint rule; F-10-002 deferred to CT-F | 2 CRITICAL + 1 WARN | proposed |
| CT-K | [[ADR-0244]] | Per-site triage + 2-line `parser.ts:486` `applyDefaults` coercion fix (closes 25+ option sites) + [[ADR-0143]] codemod extension over `commands/*.ts` (~150 stale brand strings); 6/11 sites byte-identical with upstream (divergence markers mandatory); F-01-009 sequenced after [[ADR-0208]] step 4 gate | 2 CRITICAL + 5 HIGH + 3 MED + 2 LOW (11 sites) | proposed |
| CT-L | [[ADR-0245]] | Hybrid per-site + `run_phase_norevert` helper extraction + `scripts/lint-set-e-discipline.mjs` (requires `set -euo pipefail` or `# DELIBERATE:` rationale); pipeline is fork-only infra (zero upstream merge tax); also folds `audit-dynamic-imports.sh` Hetzner-path fix | 1 CRITICAL + 6 WARN + 3 NOTE remediated, 1 NOTE accepted as documented intent (11 sites) | proposed |
| CT-M | [[ADR-0246]] | Behaviour-test-first for the 3 CRITICAL (RVF metric reprobe on reopen extending [[ADR-0073]], archivist invariants pre-write + rollback, factory `deriveHNSWParams` enforcement) + per-finding fix table for 4 WARN + 2 NOTE; F-03-002 is fork-only code (zero merge tax) | 3 CRITICAL + 4 WARN + 2 NOTE (9 findings) | proposed |
| CT-N | [[ADR-0247]] | Own F-04-009 (client-side `callMCPTool` `isError` propagation, complement to [[ADR-0242]]'s server-side rule) + F-04-010 (HNSW framing ride-along) + F-04-011 (5-min `installAttempted` backoff); F-04-006/007 deferred with upstream-not-wired + [[ADR-0238]]-Surface-2 overlap rationale | 2 HIGH + 2 WARN + 1 NOTE (5 findings) | proposed |
| CT-O | [[ADR-0248]] | [[ADR-0210]]-conformant per-plugin triage (DOA delete-or-publish-and-wire, phantom-tool removal, description rewrites) + fork-source marketplace integrity lint + hand-edit for `ruflo-core/hooks/hooks.json` brand drift (codemod doesn't reach marketplace source) | 2 CRITICAL + 6 WARN + 1 NOTE remediated, 2 NOTE accepted (9 findings) | proposed |

### Cross-bonus dependencies (resolve multiple CTs with a single change)

* **CT-F cluster 2 (delete `v3/mcp/`)** simultaneously closes F-10-002 (CT-J / [[ADR-0243]] site #2) and F-05-001 (CT-G / [[ADR-0240]] site #1). One delete, three CT findings resolved.
* **CT-E ([[ADR-0238]])** inherits gastown-bridge + agentic-qe deferral from CT-F (published npm artifacts — deletion would orphan).
* **CT-I ([[ADR-0242]])** is the micro-ADR [[ADR-0210]]'s second-pass council explicitly named as owed for the protocol-boundary signal.
* **CT-K** F-01-002 (`start --daemon` PID race) defers canonical PID/signal discipline to **CT-J ([[ADR-0243]])** Site #4 — daemon-PID ownership lives there.
* **CT-N** F-04-010 (HNSW framing) **rides on [[ADR-0238]] Surface 1 docblock rewrite** (same file, same merge tax) rather than a separate edit pass.
* **CT-K** F-01-009 (parser coercion) **sequenced after [[ADR-0208]] Option D′ step 4 gate** — flipping the parser before the strict-flag gate is green would surface additional broken-by-default sites mid-cleanup.
* **CT-O** F-07-004 (`ruflo-core/hooks/hooks.json` brand) — Pass 5 codemod technically matches but runs against build temp dir while marketplace ships from fork source via `marketplace.json source:`; fix is hand-edit + fork-source lint mirroring [[ADR-0235]], NOT a Pass 5 scope extension.

### Pre-flight inversions (audit's static suggestion did NOT survive re-derivation)

* **CT-A** sites 2 + 4 (`diskann-backend.ts`, `claims.ts`) are byte-identical with upstream → fork-only throws conflict on every upstream sync; divergence-marker comments + ledger entries required.
* **CT-D** upstream `ruvnet/RuVector` still ships ALL 5 clamps including today's wave-A9-fixed `set_pattern_capacity` — fork now 5 ahead; merge-tax surfaced.
* **CT-E** dead swarm consensus (1,425 LOC) flipped from "delete" to **quarantine** — upstream is actively investing (`federation-transport.ts`, `transport.ts` siblings).
* **CT-G** upstream `ruvnet/agentdb` has the same `console.log` at same line → fix is fork-only merge tax.
* **CT-H** upstream has `required:['key','value']` (no namespace) — **the fork created the asymmetry**. Decision flipped from "tighten handler" to **relax schema** to re-converge.
* **CT-K** highest merge-tax density of any second-pass CT — **6 of 11 sites byte-identical with upstream**; mitigation is divergence-marker comments per [[ADR-0234]] precedent.
* **CT-L** **pipeline is fork-only infra** — upstream `ruvnet/ruflo/scripts/` has no publish/verdaccio/napi/build-package scripts → zero merge tax for the lint + helper extraction.
* **CT-M** **F-03-002 (archivist post-write invariants) is fork-only code from ADR-0180** — `ruvnet/agentdb` has no `archivist/` directory at all; zero merge tax. By contrast F-03-001 and F-03-003 are byte-identical with upstream and require INTEGRATION-LEDGER rows.
* **CT-N** rejected matrix Option C (fold F-04-009 into CT-I/[[ADR-0242]]) — they're disjoint by artifact (handlers vs `callMCPTool`) and mechanism (arch-test on swallow vs runtime `isError` inspection); folding would couple a one-file surgical fix to ADR-0242's multi-cycle adoption timeline.
* **CT-O** Pass 5 codemod scope-extension rejected — the codemod runs against build temp dir while marketplace ships from fork source. Hand-edit + fork-source lint (mirroring [[ADR-0235]]) is the correct shape.

## Singleton dispositions (11 findings — fix-in-place / defer / accept)

The 11 uncovered findings that don't cluster with ≥3 siblings into a coherent CT theme. Per `feedback-no-streak-timegates`, each gets an explicit disposition rather than spawning a per-finding ADR.

| Finding | Sev | Slice | Title | Disposition |
|---------|-----|-------|-------|-------------|
| F-08-003 | HIGH | 08 | `embeddings_search` MCP bypasses [[ADR-0227]] adaptive 0.15 threshold via `\|\| 0.5` | **fix-in-place** — one-line removal at `embeddings-tools.ts:484` |
| F-08-004 | HIGH | 08 | `RvfEmbeddingCache` 32-bit FNV-1a hash collision returns wrong embedding (~1% at 10K entries) | **fix-in-place** — store text alongside embedding and verify on `get()`, OR re-key by SHA-256 prefix |
| F-08-001 | HIGH | 08 | V3 `'auto'` provider prefers hash over neural; RVF default dim 384 | **defer-with-rationale** — stack is dead (CT-F cluster 4 deletes it via merge-then-delete); rides on cluster 4 |
| F-12-002 | MED | 12 | [[ADR-0214]] partial; `.claude/settings.json` still emits stale `primaryStorage:"pglite"` | **fix-in-place** — remove from `settings-generator.ts` per ADR-0214 + [[project-adr0170-superseded-phase-d-trap]] |
| F-11-016 | MED | 11 | `@claude-flow/mcp` package facilities never wired on stdio | **defer-with-rationale** — rides on CT-F cluster 2 (delete `v3/mcp/`); evaporates with deletion |
| F-12-005 | LOW | 12 | `statusline.cjs` and `statusline.js` duplicates with conflicting banners | **fix-in-place** — delete `.js` variant from template |
| F-12-006 | LOW | 12 | Many emitted helpers use pre-rebrand `npx claude-flow` (623 lines) | **fix-in-place** — codemod brand-flip pass over `.claude/{agents,commands,skills,helpers}/`; extends [[ADR-0143]] Pass 7 |
| F-12-007 | LOW | 12 | Three `claude-flow-*` slash commands keep pre-rebrand brand | **fix-in-place** — rename to `/ruflo-*` (or remove if redundant with `mcp__ruflo__` tools) |
| F-06-007 | NOTE | 06 | `ruvllm-wasm.ts` silent JSON-parse catches (KV cache `{}` stats) | **fix-in-place** — narrow catch + log to stderr once per session |
| F-06-008 | NOTE | 06 | `hnsw_router.rs` `unwrap()`s NaN panic in WASM graph-traversal hot path | **fix-in-place** — pre-validate `f32::is_finite()` at WASM boundary (partially closed by CT-D's setter validation; graph-traversal unwraps remain) |
| F-11-018 | LOW | 11 | `agentdb/src/index.ts` re-exports `examples/` symbols | **accept** — convention violation only; informational, not behavioural |

**Fast-track recommendation**: F-08-003 (one-line) and F-08-004 (one-evening) are both HIGH with low blast radius; either could ship as a single follow-up commit.

## 100% coverage statement

| Bucket | Count | Disposition |
|--------|-------|-------------|
| Covered (CT-A…CT-O) | 51 + 45 = **96** | Actively remediated by ADR-0234…ADR-0248 |
| Deferred-in-ADR | 42 | Explicitly named in an ADR, dispositioned as defer/follow-up (e.g. CT-I's F-13-001…008 follow-up list, CT-F's gastown deferral) |
| No remediation needed | 16 | PASS/INFO/positive findings (e.g. F-08-006/007 PASS, F-05-011 INFO) |
| Singleton dispositions | 11 | Per-finding `fix-in-place` / `defer-with-rationale` / `accept` (above section) |
| **Total** | **165** | **100% coverage** |

## Headline CRITICALs (immediate-flag, 11 +7 surfaced post-synthesis = 18 total)

1. **F-04-001** — AIDefence has zero non-test callers; defense-in-depth is documentation only.
2. **F-04-002** — `commands/claims.ts:268-271` RBAC permissive-on-error.
3. **F-04-003** — Central MCP dispatch performs no claims/permission check.
4. **F-03-001** — `RvfBackend.distanceToSimilarity` never re-probes metric on reopen — same shape as the ADR-0073 `2cos−1` trap in a different code path.
5. **F-03-002** — Archivist invariants evaluated AFTER substrate write completes; charter says BEFORE; no rollback.
6. **F-06-001** — `vector-db.ts` hash-sine fake embedding fallback.
7. **F-06-002** — `diskann-backend.ts` silent cascade.
8. **F-07-003** — `.claude-plugin/plugin.json` ADR-0143 rebrand miss (claude-flow name, version 2.5.0, author rUv).
9. **F-10-001** — Module-scope unbounded Maps holding NAPI/WASM handles.
10. **F-10-002** — `v3/mcp/` timers without `.unref()`.
11. **F-14-001** — `memory_store` inputSchema lies vs handler permissiveness; READ counterparts throw → data-partitioning bug.

### +7 CRITICALs surfaced by the coverage-matrix pass

The synthesis's "immediate-flag 11" missed seven CRITICAL findings from the slice files. All seven are now homed in a CT-K..O remediation ADR:

12. **F-01-001** — `process daemon` stub fakes PID + hardcoded "Services:" tree → **CT-K / [[ADR-0244]]**.
13. **F-01-002** — `start --daemon` third writer of `.claude-flow/daemon.pid` with different on-disk format → **CT-K / [[ADR-0244]]** (canonical PID ownership defers to CT-J / [[ADR-0243]] Site #4).
14. **F-02-003** — `publish-verdaccio.sh` missing `set -e`; wrapper publish failure → exit 0 (the exact `project-ruflo-wrapper-latest-regression` shape) → **CT-L / [[ADR-0245]]**.
15. **F-03-001** — `RvfBackend.distanceToSimilarity` never re-probes metric on reopen (ADR-0073 `2cos−1` trap sibling) → **CT-M / [[ADR-0246]]**.
16. **F-03-002** — Archivist invariants evaluated AFTER substrate write, no rollback → **CT-M / [[ADR-0246]]** (fork-only code; zero merge tax).
17. **F-03-003** — `backends/factory.ts::createHNSWLibBackend` HNSW static defaults divergent from canonical 23/100/50 → **CT-M / [[ADR-0246]]**.
18. **F-07-001** + **F-07-002** — `ruflo-graph-intelligence` 6 DOA MCP tools + `ruflo-agentdb` 3 phantom `embeddings_rabitq_*` → **CT-O / [[ADR-0248]]**.

## Decision

Treat the 165 findings as the second-pass batch counterpart to ADRs 0202–0218 after ADR-0201. **Apply the [Remediation-ADR pre-flight checklist](./ADR-0201-codebase-soundness-completeness-audit-with-runtime-validation.md#remediation-adr-pre-flight-checklist-added-2026-05-20) before drafting any remediation ADR from these findings.** The first batch saw 4 of 9 reviewed remediation ADRs flipped by a 6-expert swarm because the static finding-to-remedy step was skipped.

Prefer **theme-batched remediation ADRs (one per CT-A through CT-J)** over per-finding ADRs. Single-finding ADRs in CT-A through CT-J are likely to re-encounter the "no sibling-ADR overlap" trap (pre-flight check 4). The themes carve the work along seams that match the underlying bug class.

All **15 theme-batched ADRs** ([[ADR-0234]] through [[ADR-0248]]) were drafted on 2026-05-24, each pre-flight-checked, achieving 100% coverage of the 165 findings (96 in CTs, 42 deferred-in-ADR, 16 no-remediation-needed, 11 singletons). See "Remediation ADRs" table above for the per-theme decision shape, impact, and status, and the "Singleton dispositions" section for the long tail. Triage priority (subject to maintainer re-ordering):

1. CT-G [[ADR-0240]] stdio-corruption fix — single-commit, observable as MCP envelope corruption.
2. CT-M [[ADR-0246]] AgentDB internals correctness — 3 CRITICAL data-integrity (RVF metric reprobe, archivist pre-write+rollback, factory deriveHNSWParams). Behaviour-test-first.
3. CT-B [[ADR-0235]] wrapper-bundled-helpers drift — gates [[ADR-0211]]'s real implementation reaching npx users.
4. CT-A [[ADR-0234]] silent fallback completions — extend the [[ADR-0095]] amendment to its sibling loaders.
5. CT-K [[ADR-0244]] CLI per-command honesty long-tail — 2 CRITICAL daemon-PID-collision + parser fix + brand codemod extension.
6. CT-L [[ADR-0245]] pipeline robustness + set-e discipline — 1 CRITICAL `publish-verdaccio.sh` missing `-e` + helper extraction + lint script.
7. CT-O [[ADR-0248]] plugin marketplace integrity + honesty — 2 CRITICAL DOA/phantom + marketplace lint + per-plugin description rewrites.
8. CT-C [[ADR-0236]] hardcoded-list drift lint — pipeline-start cross-registry check.
9. CT-E [[ADR-0238]] surface-without-enforcement triage — wire OR remove per [[ADR-0210]] stub-honesty mandate.
10. CT-F [[ADR-0239]] dead-code triage — ~57K LOC; per-cluster decisions (5 strict deletes + 1 merge-then-delete + 2 deferrals + lint gate).
11. CT-H [[ADR-0241]] schema-vs-handler reconciliation (F-14-001 first; relax-not-tighten to re-converge with upstream).
12. CT-D [[ADR-0237]] silent clamps (`sona_instant.rs` siblings of today's fix).
13. CT-N [[ADR-0247]] security detection + isError envelope — F-04-009 client-side rule + ride-alongs; F-04-006/007 deferred.
14. CT-J [[ADR-0243]] resource drift on long-lived processes.
15. CT-I [[ADR-0242]] error taxonomy — long-term cultural debt; lowest urgency.

**Singleton fast-track**: F-08-003 (one-line `|| 0.5` removal) and F-08-004 (RvfEmbeddingCache FNV-1a collision) are both HIGH with low blast radius; either can ship as a single follow-up commit without an ADR.

## Consequences

* Headlines CT-A, CT-B, CT-C, CT-D each represent a recurring structural defect class. Each carries a separate ADR-track. Single-commit remedies on individual sites will rot back without a class-level rule (lint, golden-master, or arch-test).
* CT-E flags ~3,000+ LOC of surface (security, consensus, telemetry) where the cost of "wire OR delete" is materially asymmetric. Per [[ADR-0210]] this is the stub-honesty mandate — keep what works, document-or-remove what doesn't.
* CT-F's ~57K dead LOC suggests an automated detector (the dead-code scan) should join the release gate, not just a one-shot audit. ESLint `no-unused-exports` + cross-package import scan would catch the next 5K-LOC accretion before it grows.
* Slice 10 was STATIC. The §A.10 long-running runtime stress test (G-16-014's full scope) remains owed.

## Reviews still owed (carry-forward after this batch)

Updated 2026-05-25 — see [[ADR-0252]] for the Batch S re-disposition and per-item resolution below.

* **Performance/leak runtime stress** (G-16-014) — ~~static-only~~ → **harness landed** in `ruflo-patch` commit `a9aa795` (`scripts/test-stress-runtime.sh` + `scripts/stress-runtime-driver.mjs`). Smoke run at `STRESS_N=100` exposes 14× RSS growth with 24 of 100 inflight after 30s drain — needs follow-up investigation to disambiguate ADR-0243 gap vs synthetic-burst artifact vs warmup-cost allocation. Harness was the precondition; the underlying signal is now a separate work item.
* **Section §A: 19 Batch S source-conflict deferrals** — ~~re-eval on next upstream sync~~ → **re-disposed by [[ADR-0252]]**. Per-family verdict: 5 supersede (ADR-126 neural-trader → [[ADR-0248]] + [[ADR-0251]]), 3 pull-pending (docs, next sync), 2 defer + 9 defer-per-SHA (ADR-127 github surface + misc). ~~`ruvnet/ruflo` has had 0 new commits since 2026-05-23; trigger fires on next sync (no current action).~~ → **FIRED + CLOSED 2026-06-11: the 105-commit Batch-U range (`619b263aa..58716fd14`) was fully dispositioned in [[ADR-0313]] (ledger `docs/upstream/INTEGRATION-LEDGER.md`).**
* **Section §A: 5 ruvector Batch O deferrals (sparse-attention)** — ~~re-eval on dedicated sweep~~ → **closed; bookkeeping correction landed** ([[ADR-0252]] amendment to `docs/upstream/INTEGRATION-LEDGER.md:296`). Direct content inspection confirmed all 5 SHAs are absorbed: 55eae8887→92c296b04, 4922b034f→2b2da81b4, 9d8006ae2→3117f4a8e, 068bb637a→4a357f32d, 36912ba3e→208eb1762. Original ledger row was stale. **Note**: prior framing "fork doesn't currently consume these" was inaccurate — sparse-attention crates ARE consumed intra-fork (`ruvllm_retrieval_diffusion` depends on `ruvllm_sparse_attention`; `ruvector-sparse-inference-wasm` depends on `ruvector-sparse-inference`).
* **`archive/` 418K LOC** — ~~intentionally excluded from CT-F dead-code scan~~ → **partial action landed**: `forks/ruflo` commit `1a26254eb` renamed `archive/v2/_v2_claude_snapshot/skills/` → `legacy-skills/` to break Claude Code's `/skills/` directory-segment discovery match. SKILL.md descriptive count (settings.json comment was inaccurate — 26 files, not 367). Discovery-reachable count: 341→315. **Remaining**: 315 still exceeds default 1% budget cap (~63); `skillListingBudgetFraction` left at 6%. Bigger pollution sources unaddressed (`.agents/skills` 134, `plugins/*/skills` 104). The rest of `archive/v2/` remains intentionally kept; no further dead-code scan needed.

## More Information

* [[ADR-0201]] — first-pass audit + pre-flight checklist (this ADR is its second-pass counterpart).
* [[ADR-0095]] amendment 2026-05-23 — fallback removal (only `rvf-backend.ts` was actually fixed; CT-A extends the scope).
* [[ADR-0210]] — stub-honesty mandate (governs CT-E triage decisions).
* [[ADR-0215]] — codemod golden-master test (§E.2; CT-B is the init-template equivalent).
* [[ADR-0231]] wave A9 — defect-class origin for CT-C and CT-D.
* `feedback-no-fallbacks` — corpus-level rule that CT-A is meant to enforce.
* `feedback-remediation-adr-preflight` — checklist that gates remediation drafted from this ADR.
