# 2026-05-25 — INTEGRATION-LEDGER `superseded-by-local` audit (slice B: rows 17-32 by upstream date)

## Scope

48 `superseded-by-local` rows in `docs/upstream/INTEGRATION-LEDGER.md`. Sorted by upstream-date column; this slice covers chronological positions 17 through 32 (16 rows). Verifies that each claim "fork moved past upstream independently" still holds today.

Per `feedback-corpus-evidence-before-feature-work`: claims verified by reading the cited fork-side files and the cited upstream paths in `/Users/henrik/source/ruvnet/ruflo/`, not by inference from ADR text.

## Summary

- **still-superseded: 16**
- **drifted: 0**
- **upstream-rebased: 0**
- **stale-other: 0**

Net effect on ledger: **all 16 rows in this slice remain accurate as-written.** No ledger edits proposed. Upstream HEAD on `ruvnet/ruflo` is `ef73a1616` (2026-05-12); every fork SHA in this slice is dated 2026-05-24, so there is no chance of upstream having rebased these surfaces since the ledger was authored.

Cross-cutting observation (informational, not a ledger edit): three ADR-0238 sub-rows (S4, S6) cite the same fork commit `7b0e718a1`, and two more (S5, S7) cite the same commit `9fd2235fe`. The "fork-local" descriptions in those rows already note the joint commit; not a defect — the dual-row encoding tracks each Surface as its own decision unit. Three ADR-0243 rows (F-10-001, F-10-005, F-10-010) likewise share commit `32f90edc9`.

---

## Per-row findings

### Row 1 — `004bdc493` (ADR-0234 site 3 embedding-pipeline + memory-router fail-loud)

**Cited fork-side work:** `v3/@claude-flow/memory/src/embedding-pipeline.ts` + `v3/@claude-flow/cli/src/memory/memory-router.ts` — throw on missing transformers/ruvector; remove bare `catch {}` around `initPipeline`; drop `'hash-fallback'` provider type.

**Verification:**

- Fork: `embedding-pipeline.ts:120-220` and `:294-324` carry the throws (`Silent hash-fallback is removed (ADR-0234, ...)`). `memory-router.ts:881` has the ADR-0234 marker.
- Upstream: `ruvnet/ruflo/v3/@claude-flow/memory/src/embedding-pipeline.ts` and `ruvnet/ruflo/v3/@claude-flow/cli/src/memory/memory-router.ts` — **both files do not exist upstream** (confirmed via `ls`). Ledger's "fork-original (no upstream counterpart)" claim is correct.

**Classification:** still-superseded.

---

### Row 2 — `79d6ccab2` (ADR-0234 site 4 claims fail-closed)

**Cited fork-side work:** `cli/src/commands/claims.ts:265-271` — replace permissive-on-error branch with `return { success: false, exitCode: 1 }` + ADR-0234-tagged error.

**Verification:**

- Fork: `claims.ts:282-295` has `ADR-0234 (extends ADR-0095 amendment 2026-05-23 per feedback-no-fallbacks)` comment block plus the fail-closed branch (`Permissive-on-error branch removed (ADR-0234)`).
- Upstream: `ruvnet/ruflo/v3/@claude-flow/cli/src/commands/claims.ts` carries no `ADR-0234` references (`grep` returns 0 hits); diff vs fork shows fork added `printAdvisoryBanner`, hoisted `claimsConfigPaths`, and rewrote the catch branch as documented.

**Classification:** still-superseded.

---

### Row 3 — `32f90edc9` (ADR-0243 F-10-001 ruvllm bounded LRU)

**Cited fork-side work:** `cli/src/mcp-tools/ruvllm-tools.ts:40-42` — replace 3 module-scope `new Map<string, ...>()` with `BoundedLRU`; helper at `cli/src/utils/bounded-lru.ts`.

**Verification:**

- Fork: `ruvllm-tools.ts:71-75` has `RUVLLM_CACHE_MAX = BoundedLRU.readEnvMax('CLAUDE_FLOW_RUVLLM_CACHE_MAX', 64)` with `new BoundedLRU<string, ...>` for all 3 registries. `utils/bounded-lru.ts` exists.
- Upstream: `ruvnet/ruflo/v3/@claude-flow/cli/src/mcp-tools/ruvllm-tools.ts:312-314` carries the byte-identical 3 bare `new Map<string, ...>()` declarations — ledger claim verified.

**Classification:** still-superseded.

---

### Row 4 — `32f90edc9` (ADR-0243 F-10-005 activeTrajectories LRU + TTL)

**Cited fork-side work:** `cli/src/mcp-tools/hooks-tools.ts:528` — replace `new Map<string, TrajectoryData>()` with `BoundedLRU` (cap 256, idle-TTL 1h).

**Verification:**

- Fork: `hooks-tools.ts:544-552` has `TRAJ_CACHE_MAX = 256` + `TRAJ_IDLE_TTL_MS` + `new BoundedLRU<string, TrajectoryData>({ maxEntries, idleTtlMs })`.
- Upstream: `ruvnet/ruflo/v3/@claude-flow/cli/src/mcp-tools/hooks-tools.ts:444` is `const activeTrajectories = new Map<string, TrajectoryData>();` — bare Map, no TTL.

**Classification:** still-superseded.

---

### Row 5 — `32f90edc9` (ADR-0243 F-10-010 daemon signal-handler idempotency)

**Cited fork-side work:** `cli/src/services/worker-daemon.ts:462-472,483-504` — module-scope `daemonShutdownHandlersInstalled` + `daemonCrashHandlersInstalled` flags + idempotency gates; matches `agentdb/src/archivist/audit-writer.ts::installSignalHandlersOnce`.

**Verification:**

- Fork: `worker-daemon.ts:50-51` declares both module-scope flags; `:540-541` and `:568-569` check + set them as idempotency gates.
- Upstream: `ruvnet/ruflo/v3/@claude-flow/cli/src/services/worker-daemon.ts:366-387` has bare `setupShutdownHandlers()` / `installCrashHandlers()` — no flags.
- `forks/agentdb/src/archivist/audit-writer.ts` exists; `ruvnet/agentdb/src/archivist/` does not (matches `project-fork-only-controllers`).

**Classification:** still-superseded.

---

### Row 6 — `aea2d8ddd` (ADR-0241 F-14-003 validate-input typed allowlist)

**Cited fork-side work:** `cli-core/src/mcp-tools/validate-input.ts:248` (mirror at `cli/src/mcp-tools/validate-input.ts:317`) — replace `if (issue.code === 'invalid_enum_value') continue;` with `SUPPRESSED_VALIDATION_CODES` Set + rationale comment.

**Verification:**

- Fork cli-core: `:225` declares `const SUPPRESSED_VALIDATION_CODES = new Set<string>(['invalid_enum_value', ...])`; `:274` uses `.has(issue.code)`.
- Fork cli: same pattern at `:289` and `:337`.
- Upstream cli-core: `ruvnet/ruflo/v3/@claude-flow/cli-core/src/mcp-tools/validate-input.ts:248` is `if (issue.code === 'invalid_enum_value') continue;` (bare swallow).
- Upstream cli: file `ruvnet/ruflo/v3/@claude-flow/cli/src/mcp-tools/validate-input.ts` returns no matches (`grep` empty) — consistent with the ledger's "9-line re-export shim" framing.

**Classification:** still-superseded.

---

### Row 7 — `c44c0810b` (ADR-0238 S1 + ADR-0247 site #2 aidefence honesty, joint)

**Cited fork-side work:** docblock rewrite on `aidefence/src/index.ts` strikes "AI Manipulation Defense" / "self-learning capabilities" / "HNSW-indexed threat pattern search"; repositions as caller-opt-in; HNSW-scope clarification ride-along.

**Verification:**

- Fork: `aidefence/src/index.ts` returns zero hits for any of the 3 overclaim phrases. Lines 6-19 carry the caller-opt-in framing plus `ADR-0238 Surface 1 + ADR-0247 F-04-010 HNSW-scope` marker.
- Upstream: `ruvnet/ruflo/v3/@claude-flow/aidefence/src/index.ts:4-8` still contains all 3 overclaim phrases verbatim.

**Classification:** still-superseded.

---

### Row 8 — `cf7bbbaf5` (ADR-0238 S2 claims advisory banner)

**Cited fork-side work:** `cli/src/commands/claims.ts` — add `printAdvisoryBanner()` + invoke on every subcommand path.

**Verification:**

- Fork: `claims.ts:60` defines the helper; banner is invoked at `:91, :176, :335, :398, :467, :576` (6 subcommand paths plus the top-level action) — matches the ledger description.
- Upstream: zero matches for `printAdvisoryBanner` or `ADVISORY (ADR-0238 S2)` in `ruvnet/ruflo/v3/@claude-flow/cli/src/commands/claims.ts`.

**Classification:** still-superseded.

---

### Row 9 — `24049d9bd` (ADR-0238 S3 telemetry MCP tools delete, supersedes ADR-0045)

**Cited fork-side work:** Delete `agentdbTelemetryMetrics` + `agentdbTelemetrySpans` from `cli/src/mcp-tools/agentdb-tools.ts:1587-1641` plus registry rows; replace with redirect comment.

**Verification:**

- Fork: Only hit for `agentdbTelemetry*` is at `:2329` — a single comment `// ADR-0238 S3: agentdbTelemetryMetrics + agentdbTelemetrySpans DELETED`. No tool exports or registry rows remain.
- Upstream: zero matches for any of the 4 identifiers in `ruvnet/ruflo/v3/@claude-flow/cli/src/mcp-tools/` — consistent with the ledger's "fork-only invention" framing (no merge cost to upstream).

**Classification:** still-superseded.

---

### Row 10 — `7b0e718a1` (ADR-0238 S4 swarm consensus subtree quarantine)

**Cited fork-side work:** Prepend uniform `// QUARANTINED (ADR-0238 Surface 4 quarantine)` header to `swarm/src/consensus/{raft,byzantine,gossip,index}.ts`; add `swarm/__tests__/no-new-consensus-imports.test.ts`.

**Verification:**

- Fork: All 4 files lead with `* ADR-0238 Surface 4 quarantine: NO NEW imports from this directory.` block (confirmed via `head -5` on each). Arch-test file exists at the expected path.
- Upstream: `ruvnet/ruflo/v3/@claude-flow/swarm/src/consensus/raft.ts` leads with `* V3 Raft Consensus Implementation / Leader election and log replication for distributed coordination` — no quarantine header.

**Classification:** still-superseded.

---

### Row 11 — `9fd2235fe` (ADR-0238 S5 Raft naming honesty)

**Cited fork-side work:** `cli/src/commands/hive-mind.ts:146` — rewrite Raft entry from `label: 'Raft' / hint: 'Leader-based consensus'` to `label: 'Raft-flavoured' / hint: 'simple majority, no log replication (queen-elected leader, term-bucketed)'`.

**Verification:**

- Fork: `hive-mind.ts:152` is `{ value: 'raft', label: 'Raft-flavoured', hint: 'simple majority, no log replication (queen-elected leader, term-bucketed)' }`. Preceding comment block at `:144-149` documents both S5 and S7.
- Upstream: `ruvnet/ruflo/v3/@claude-flow/cli/src/commands/hive-mind.ts:41` is `{ value: 'raft', label: 'Raft', hint: 'Leader-based consensus' }`.

**Classification:** still-superseded.

---

### Row 12 — `7b0e718a1` (ADR-0238 S6 paxos enum + silent-Raft-fallback removal)

**Cited fork-side work:** Remove `'paxos'` from `swarm/src/types.ts:199`, `swarm/src/index.ts:326`, and the `case 'paxos':` switch arm in `swarm/src/consensus/index.ts:96-104`.

**Verification:**

- Fork: `grep "'paxos'\|paxos"` across the 3 cited files returns **zero hits**.
- Upstream: All 3 files retain `paxos` — `types.ts:199` still has the union member, `index.ts:326` still has it in the const tuple, `consensus/index.ts:106` still has `case 'paxos':`.

**Classification:** still-superseded.

---

### Row 13 — `9fd2235fe` (ADR-0238 S7 weighted CLI/MCP enum alignment)

**Cited fork-side work:** Add `'weighted'` to `cli/src/mcp-tools/hive-mind-tools.ts:73` (`ConsensusStrategyName` union) and `:1521` (MCP schema enum); add Queen-weighted entry to `commands/hive-mind.ts:144-150`.

**Verification:**

- Fork: `hive-mind-tools.ts:80` is `export type ConsensusStrategyName = 'raft' | 'byzantine' | 'gossip' | 'crdt' | 'quorum' | 'weighted';` Schema and downstream cases (`:647`) handle `weighted`. `commands/hive-mind.ts:155` is `{ value: 'weighted', label: 'Queen-weighted', hint: 'queen 3x voting power (requires elected queen)' }`.
- Upstream: `ruvnet/ruflo/v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts` returns no `'weighted'` matches in the relevant sections.

**Classification:** still-superseded.

---

### Row 14 — `334467bce` (ADR-0238 S8 consensus agents advisory frontmatter)

**Cited fork-side work:** Add `advisory: true` + "Advisory roleplay only (ADR-0238 S8)" paragraph to 6 files in `cli/.claude/agents/consensus/`.

**Verification:**

- Fork: Directory listing shows 7 .md files (5 plan + `security-manager.md` + `performance-benchmarker.md`); 6 of them contain both `advisory: true` and `Advisory roleplay only (ADR-0238 S8)`. `performance-benchmarker.md` excluded per ledger's documented architect amendment.
- Upstream: Directory listing identical (7 .md files); zero of them contain `advisory: true`.

**Classification:** still-superseded.

---

### Row 15 — `5059f08b8` (ADR-0247 site #1 callMCPTool isError envelope inspection)

**Cited fork-side work:** `cli/src/mcp-client.ts:161-188` — `isMCPErrorEnvelope` type-narrow + `extractEnvelopeError` synthesizer; `callMCPTool` throws `MCPClientError` on `{ isError: true }`; outer `catch` re-throws own `MCPClientError` to preserve `cause` chain. Sync-guard test `__tests__/mcp-client-iserror.test.ts`.

**Verification:**

- Fork: `mcp-client.ts:126` declares `MCPClientError`; `:145` defines `isMCPErrorEnvelope`; `:159` defines `extractEnvelopeError`; `:230-233` throws on envelope; `:245` re-throws own `MCPClientError` first to avoid double-wrap. Test file exists.
- Upstream: `ruvnet/ruflo/v3/@claude-flow/cli/src/mcp-client.ts` returns no matches for any of the 4 identifiers — byte-identical pre-fix shape, as claimed.

**Classification:** still-superseded.

---

### Row 16 — `1f16318d2` (ADR-0247 site #3 installAttemptedAt 5-minute backoff)

**Cited fork-side work:** `cli/src/mcp-tools/security-tools.ts:28,74,77,120-127` — rename `installAttempted: boolean` → `installAttemptedAt: number | null`; add `INSTALL_BACKOFF_MS = 5*60*1000` + `installError` cache; re-enter install after backoff window. Sync-guard test `__tests__/security-tools-backoff.test.ts`.

**Verification:**

- Fork: `security-tools.ts:31` is `let installAttemptedAt: number | null = null;`; `:32` defines `INSTALL_BACKOFF_MS = 5 * 60 * 1000`; `:35` adds `installError` cache; `:83-96` implements the backoff gate including `retryAt` ISO-8601 timestamp. Test file exists.
- Upstream: `ruvnet/ruflo/v3/@claude-flow/cli/src/mcp-tools/security-tools.ts:28,74,77` still has bare `let installAttempted = false;` — byte-identical permanent-cache shape, as claimed.

**Classification:** still-superseded.

---

## Conclusion

All 16 rows in slice B remain accurate. The ledger's framing of the fork-side superseding work as a perpetual or one-time merge tax (depending on whether upstream carries a byte-identical counterpart or has no counterpart at all) holds for every row. No proposed ledger edits.
