---
status: implemented
date: 2026-05-24
implemented-date: 2026-05-24
tags: [audit, soundness, completeness, second-pass, audit-followup]
supersedes: []
depends-on: [0201]
implements: []
---

# Second-pass soundness audit findings (2026-05-24)

## Context

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

## Headline CRITICALs (immediate-flag, 11)

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

## Decision

Treat the 165 findings as the second-pass batch counterpart to ADRs 0202–0218 after ADR-0201. **Apply the [Remediation-ADR pre-flight checklist](./ADR-0201-codebase-soundness-completeness-audit-with-runtime-validation.md#remediation-adr-pre-flight-checklist-added-2026-05-20) before drafting any remediation ADR from these findings.** The first batch saw 4 of 9 reviewed remediation ADRs flipped by a 6-expert swarm because the static finding-to-remedy step was skipped.

Prefer **theme-batched remediation ADRs (one per CT-A through CT-J)** over per-finding ADRs. Single-finding ADRs in CT-A through CT-J are likely to re-encounter the "no sibling-ADR overlap" trap (pre-flight check 4). The themes carve the work along seams that match the underlying bug class.

Triage priority (from this ADR's evidence, subject to maintainer re-ordering):

1. CT-G stdio-corruption fix (F-05-001, F-05-002) — single-commit, observable as MCP envelope corruption.
2. CT-B wrapper-bundled-helpers drift (F-12-001, F-12-003, F-07-003) — gates [[ADR-0211]]'s real implementation reaching npx users.
3. CT-A silent fallback completions (F-06-001, F-06-002, F-08-002, F-04-002) — extend the [[ADR-0095]] amendment to its sibling loaders.
4. CT-C hardcoded-list drift lint (F-02-001) — pipeline-start cross-registry check.
5. CT-E surface-without-enforcement triage — wire OR remove. Per [[ADR-0210]] stub-honesty mandate.
6. CT-F dead-code triage — ~57K LOC; needs maintainer per-cluster decisions, not a blanket delete.
7. CT-H schema-vs-handler reconciliation (F-14-001 first).
8. CT-D silent clamps (sona_instant.rs siblings of today's fix).
9. CT-J resource drift on long-lived processes.
10. CT-I error taxonomy — long-term cultural debt; lowest urgency.

## Consequences

* Headlines CT-A, CT-B, CT-C, CT-D each represent a recurring structural defect class. Each carries a separate ADR-track. Single-commit remedies on individual sites will rot back without a class-level rule (lint, golden-master, or arch-test).
* CT-E flags ~3,000+ LOC of surface (security, consensus, telemetry) where the cost of "wire OR delete" is materially asymmetric. Per [[ADR-0210]] this is the stub-honesty mandate — keep what works, document-or-remove what doesn't.
* CT-F's ~57K dead LOC suggests an automated detector (the dead-code scan) should join the release gate, not just a one-shot audit. ESLint `no-unused-exports` + cross-package import scan would catch the next 5K-LOC accretion before it grows.
* Slice 10 was STATIC. The §A.10 long-running runtime stress test (G-16-014's full scope) remains owed.

## Reviews still owed (carry-forward after this batch)

* **Performance/leak runtime stress** — slice 10 was static-only. Long-running stress test still owed (G-16-014).
* **Section §A: 19 Batch S source-conflict deferrals** — re-eval on next upstream sync (memory `feedback-update-integration-ledger`).
* **Section §A: 5 ruvector Batch O deferrals (sparse-attention)** — re-eval on dedicated sweep.
* **`archive/` 418K LOC** — intentionally excluded from CT-F dead-code scan. Decision deferred.

## More Information

* [[ADR-0201]] — first-pass audit + pre-flight checklist (this ADR is its second-pass counterpart).
* [[ADR-0095]] amendment 2026-05-23 — fallback removal (only `rvf-backend.ts` was actually fixed; CT-A extends the scope).
* [[ADR-0210]] — stub-honesty mandate (governs CT-E triage decisions).
* [[ADR-0215]] — codemod golden-master test (§E.2; CT-B is the init-template equivalent).
* [[ADR-0231]] wave A9 — defect-class origin for CT-C and CT-D.
* `feedback-no-fallbacks` — corpus-level rule that CT-A is meant to enforce.
* `feedback-remediation-adr-preflight` — checklist that gates remediation drafted from this ADR.
