# ADR-0111: Upstream merge program (post-2026-04-29 swarm investigation)

- **Status**: Executing — W1 (pre-flight) + W1.5/W1.6/W1.7 (RVF-primary fail-loud + safeJsonParse port) complete; W2/W3 (recipe staging) complete; W4 + W5 pending. **Closure depends on ADR-0103**: W5 promotes ADR-0105/0106/0107/0109 from `Investigating` → `Accepted with Option X`; the orphan-class wire-up implementation those promoted ADRs mandate is ADR-0103's program (post-W5). ADR-0111 cannot move to `Implemented` while ADR-0103 holds accepted-but-undelivered mandates ADR-0111 placed there. See §Closure dependency on ADR-0103.
- **Date**: 2026-04-29
- **Scope**: All 4 forks (`ruflo`, `agentic-flow`, `ruv-FANN`, `ruvector`)
- **Method**: 15-agent parallel research swarm — each agent owned a slice
  (per-fork, per-theme, cross-cutting). Findings consolidated below.

## Context

Last upstream merge into our forks was 6 weeks ago (2026-03-16 for `ruflo`,
2026-04-06 for `ruvector`; `agentic-flow` and `ruv-FANN` are upstream-current).
Upstream has shipped substantial work in that window — 5 new ADRs, two minor
version bumps, multiple security-validation programs, a 19-plugin
marketplace, and on the ruvector side a major-version jump (0.x → 2.x) plus a
26→205 crate sprawl. This ADR is the merge plan and it lists every commit
worth attention so the actual merge can be executed without re-research.

## Inventory

| Fork | Upstream→us | Us→upstream | Last merge | Notes |
|---|---:|---:|---|---|
| `ruflo` | 67–130 (filter dep) | 342 | 2026-03-16 (`0af6a9702`) | v3.5.43 → v3.6.9 published to npm; 4 files of ADR-0104 footprint touched |
| `agentic-flow` | 0 | 133 | up-to-date | bookkeeping only (republish at new patch.N) |
| `ruv-FANN` | 0 | 17 | up-to-date | bookkeeping only |
| `ruvector` | 2318 | 2512 | 2026-04-06 (`a5ede10a`; the `d2e29c6f` 2025-11-26 PR-merge cited in earlier draft was the wrong merge SHA) | major version bump (0.x → 2.x); 26 → 171 crates (workspace members at upstream HEAD); ~510 NAPI bot churn skippable; ~1808 real signal commits (2318 minus 510 bot) |

## Hypothesis test — are our ADR-0104 patches now redundant?

**Largely NO.** All six ADR-0104 patches survive merge:

| ADR-0104 § | Upstream coverage | Status |
|---|---|---|
| §1 parser hoist for `--non-interactive` | `01070ede8` v3.5.80 fixes a *different* lazy-command bug (`lazyCommandNames` registry + `sawFirstPositional` Pass 1) but doesn't make `--non-interactive` a recognized global boolean flag | **Unique — survives** (mechanical hand-merge in restructured `globalOptions`) |
| §2 hard-error on missing objective | No upstream equivalent | **Unique — survives** |
| §3 honest output wording | No upstream equivalent | **Unique — survives** |
| §4a `.mcp.json` direct-path | `init/mcp-generator.ts` untouched upstream (zero commits in window) | **Unique — survives, zero conflict** |
| §5 `withHiveStoreLock` file lock | Upstream modified the handlers we wrap (validation `a101c2a08`, AgentDB sidecar `04d6a9a0a`, real consensus `6992d5f67`) but lock semantics still apply | **Unique — survives, mechanical re-wrap** |
| §6 revert `#1422` block + WORKER COORDINATION CONTRACT | **Directly contradicts** `8c4cecfb1` (the commit that *introduced* the block we removed). Acceptance check `check_adr0104_section_6` enforces the revert on every test run | **Survives, must be carefully re-applied** |

**One open question closed by upstream:**
- ADR-0104 Q4 (`--dangerously-skip-permissions` non-propagation): closed by `e50df6722` HIGH-02 (strict `=== true` semantics). Adopt and close the question.

**One ADR significantly impacted:**
- ADR-0106 (Consensus): `6992d5f67` v3.5.22 ships ~493 LOC of real strategy-driven consensus tallying split across `hive-mind_consensus` (~283 LOC in `hive-mind-tools.ts`) + `coordination_consensus` (~210 LOC in `coordination-tools.ts`) — BFT 2/3+1, Raft majority + term collision, Quorum unanimous/majority/supermajority, Byzantine cross-vote detection. **ADR-0106 recommendation is now Option A** (full wire-up of `ConsensusEngine` + raft/gossip/byzantine into `hive-mind_consensus` MCP handler via daemon-resident pattern, per memory `feedback-no-value-judgements-on-features.md`). Upstream's `6992d5f67` JSON-tally improvements (equivocation detection, term-collision, Byzantine cross-vote detection) **layer on top** of `ConsensusEngine`'s real protocol implementations rather than substituting for them. Trust-model framing stays as documented context (informs future signature-verification work) — does NOT gate wiring.

**ADR-0107/0108/0110 silent-fallback gaps NOT closed:**
- Upstream's `validateIdentifier` regex is `^[a-zA-Z0-9_][a-zA-Z0-9_\-.:]{0,127}$` — shell-injection / path-traversal sanitization only. `--queen-type banana`, `--type fizzbuzz`, `storageProvider: 'better-sqlite3'` all still pass. ADR-092's "domain-specific validators per shape" is the explicit upstream-blessed pattern; our `validateQueenType` / `validateWorkerType` / `validateStorageProvider` enum validators fit cleanly into `validate-input.ts`. Upstream gave us the *scaffolding*, not the *fixes*.

**ADR-0105/0109 (topology, fault tolerance) unchanged upstream:**
- Orphaned-subsystem pattern persists: `TopologyManager` (656 LOC), `ConsensusEngine`, `QueenCoordinator` (2030 LOC) still not imported by CLI. ADR-0103 roadmap stays valid for those.

## New upstream ADRs

| ADR | Title | Adopt? | Priority |
|---|---|---|---|
| ADR-085 | Issue #1425 comprehensive remediation (validation, type safety, honest metrics) | yes (already in `a101c2a08` + `dc2abef2a`) | high |
| ADR-086 | `@ruvector/ruvllm` native intelligence backend | **adopt** — full wire-up; sequencing dependency on `@sparkleideas/ruvector-ruvllm` publish from ruvector fork (per §Cross-fork merge order step 1) | high |
| ADR-087 | `@ruvector/graph-node` native graph backend (10× faster than WASM) | yes; **gate on ruvector merge**. **Provides `recordSwarmTeam(agentIds, topology)` + `getNeighbors(nodeId, hops)` — natural primitive for ADR-0105/0107/0109; consume rather than greenfield equivalents** | high |
| ADR-088 | LongMemEval benchmark for AgentDB | **adopt all 4 modes** (raw / hybrid / full / baseline). Raw runs in default acceptance harness (HNSW-only, no external dependency). Hybrid + full use Haiku reranking via Anthropic API — wired but **gated on user-supplied `ANTHROPIC_API_KEY` env var** (the gate is the user choosing to provide a key for that benchmark mode, not us hiding capability). Default acceptance does NOT require the API key (raw mode is the gate-free path). Per memory `feedback-no-api-keys.md`: ruflo orchestration itself never requires API keys; LongMemEval hybrid/full are *external benchmarks* that compare AgentDB against Anthropic-API-backed alternatives — supplying a key is an opt-in user action, not a ruflo runtime cost. | high |
| ADR-092 | MCP tool input validation bugfixes (domain-specific validators per shape) | **must adopt** | high |

### Adoption stance (added 2026-04-30 per #12 closure)

**A — Policy: separate-paths, cross-reference, no copying.**

Upstream ADRs land in `forks/ruflo/v3/docs/adr/` via the W4 merge (3-digit numbering: `ADR-085`, `ADR-092`, etc.). Our ADRs live in `ruflo-patch/docs/adr/` (4-digit numbering: `ADR-0085`, `ADR-0092`, etc.). The numbering schemes are disjoint by design — there is no collision, no renumbering decision required, no centralization needed. The "85" suffix in upstream's ADR-085 ("issue #1425 remediation") and our ADR-0085 ("memory-bridge.ts deletion") is purely coincidental; the topics are fully disjoint.

Per-ADR adoption verdict in the table above is our explicit acceptance. We do NOT copy upstream ADRs into `ruflo-patch/docs/adr/`, do NOT renumber, do NOT supersede with our own. We cross-reference by upstream ID (e.g., "per ADR-092 pattern", "per ADR-085 §item 5"). The merge brings the implementation code; the ADR docs ride along in the fork as authoritative for the upstream surface.

When our own ADR builds on an upstream pattern (e.g., our ADR-0107/0108/0110 extend ADR-092's domain-specific-validators-per-shape pattern), we cite the upstream ADR explicitly in the dependency chain.

**B — Upstream WIP feature branches: don't pre-empt.**

Same rule as the rabitq Path B closure (R15 reframe). Upstream ADRs that exist only on feature branches (not yet merged into upstream `main`) are NOT adopted by our merge wave. They land when upstream merges them.

Currently identified: **ADR-091 (`loop-monitor-native-integration`)** lives only on `origin/feat/adr-091-loop-monitor-integration` (not in `origin/main`). Not in this merge wave. Will be picked up in a future merge wave once upstream merges to main. Same posture as rabitq's `feat/wasm-packages-rabitq-acorn` (closed under R15) — we don't pre-empt upstream's review/sequencing decisions on their own WIP.

**C — Upstream→fork ADR dependency chains.**

The merge introduces an explicit chain: upstream's **ADR-085** §item 5 ("Expand input validation to all command handlers") is the foundation; upstream's **ADR-092** ("domain-specific validators per shape") formalizes the pattern; **our ADR-0107/0108/0110** EXTEND the pattern with `validateQueenType` / `validateWorkerType` / `validateStorageProvider` enum validators. This chain is captured in §Decision plan step 7. Future cross-fork ADRs that build on upstream patterns should cite the upstream chain explicitly so the inheritance is traceable when either side evolves.

**D — Lifecycle gap acknowledgment (out of scope for this ADR but worth flagging).**

Upstream's ADR evolution (additions, supersessions, status changes) is tracked **episodically** per merge wave — each wave runs an audit like this §New upstream ADRs table. There is no continuous-tracking mechanism. This works for our episodic merge tempo but means cross-references can drift between waves: if upstream's ADR-085 gets a successor (e.g., ADR-093 amending it), our cross-references stay pinned to ADR-085 until the next merge wave's audit. Out of scope for ADR-0111 to solve; flagging for awareness. Future merge programs should include "audit upstream's ADRs for evolution since last wave" as an explicit step (already implicit in the ADR-0111 W2 design).

## Cross-cutting findings

1. **Orphaned-subsystem pattern persists upstream.** Full TypeScript classes in `v3/@claude-flow/swarm/` (`TopologyManager`, `ConsensusEngine`, `QueenCoordinator`) with tests, never imported from `cli/src/`. The V2→V3 migration in `HIVE-MIND-MIGRATION.md` (`Queen.ts → Missing → ❌ Needs implementation`) remains incomplete. ADR-0105/0107/0109 recommendations still apply.

2. **`storage-factory.ts` is fork-only.** Upstream uses `database-provider.ts` for backend selection. ADR-0110's identified "unreachable SQLite branch" is fork-only code. Upstream has its own (different) unreachable branch in `database-provider.ts`. ADR-0110 should be amended to note this.

3. **README "SQLite WAL" claim already deleted upstream** at `81418649c` (Apr 2026 — same commit that ships the 19-plugin marketplace + USERGUIDE.md split). Current upstream README says "HNSW-indexed AgentDB" + "RVF portable memory" — aligns with our RVF-primary stance. ADR-0110 doc-correction tier is largely a no-op against current upstream README; reconciliation is just merging the new copy.

4. **README honesty audit** (`ff3228613`) already removed several fabricated metrics: "90.5% accuracy across 40 patterns", "100% routing accuracy", "150x-12,500x faster" (now "HNSW-indexed"), "352x faster Agent Booster" (now "instant"), "5 consensus → 3 (Raft, Byzantine, Gossip)" + CRDT marked planned. Partial overlap with ADR-0101 fork-README delta program.

5. **Embedding-dim conflict.** `e0d4703eb` introduces 384d MiniLM-L6 as fallback embedder. **Conflicts with our 768-dim Xenova/all-mpnet-base-v2 decision** (memory `reference-embedding-model.md`, ADR-0068, ADR-0102). Either drop the 384d wiring on merge or make embedding-dim configurable end-to-end. Upstream's `01c764f6f` auto-pad to 768 confirms 768-dim is canonical for SONA/MicroLoRA.

6. **Plugin sandboxing namespace gate.** `f3cc99d8b` (CRIT-02) introduces vm isolation + 8-permission capability gating with **trust-level routing checking `@claude-flow/` namespace prefix to flag "official" plugins**. Under our codemod scope rename, **the namespace check must be rewritten to `@sparkleideas/`** or no plugin running through our distribution can ever be marked "official". Add an acceptance test for this.

7. **Statusline regenerator collision.** `a0ef36cbb` adds "auto-regenerate statusline on older installs" — will erase our `.claude/helpers/statusline.cjs` overlay on first user upgrade. **Move our statusline patch into the fork source** (per `feedback-patches-in-fork.md`) before pulling this commit.

8. **AgentDB silent-catch sidecar.** `04d6a9a0a` adds `bridge.bridgeStoreEntry()` AgentDB sidecar calls inside our locked handlers, wrapped in silent `try/catch` (violates `feedback-no-fallbacks.md`). At merge: move the bridge call **outside** the lock (after `saveHiveState`); make the catch loud or remove it.

## Deleted-file orphans (silent-drop hotspots)

A file we deleted whose upstream version still gets updates is a silent
hazard — `git merge` keeps our deletion and the upstream fixes silently
disappear. Audit:

- **Total files our 342 ahead-commits deleted vs `0af6a9702`**: **125**
- **Of those, files upstream ALSO modified in the 67-commit window**: **16**

Distribution of the 125 deletions:

| Directory | Count | Reason |
|---|---:|---|
| `v3/@claude-flow/neural/` | 80 | Compiled artifacts (`.js`/`.d.ts`/`.map`) — generated, not source. Re-emerge on rebuild. |
| `v3/@claude-flow/swarm/` | 24 | Same — compiled artifacts |
| `v3/@claude-flow/shared/` | 4 | Compiled |
| `.claude/agents/*.yaml` + `.claude/agents/v3/*.yaml` | 12 | YAML agent definitions — superseded by upstream's `.md` standardization (`4609a4917`); aligned with upstream direction |
| `v3/@claude-flow/memory/src/{hybrid-backend.ts, hybrid-backend.test.ts, sqljs-backend.ts}` | 3 | ADR-0086 RVF-first abstraction |
| `v3/@claude-flow/cli/src/memory/{memory-bridge.ts, memory-initializer.ts}` | 2 | ADR-0086 RVF-first abstraction |

### The 16 orphan-fix-target files (where upstream fixes get silently dropped)

Most are aligned with upstream's direction (yaml→md migration); only 4 are
substantive memory-subsystem files we eliminated per ADR-0086:

| File | Our reason for deletion | Upstream activity in window | Disposition on merge |
|---|---|---|---|
| `.claude/agents/{database,project-coordinator,python,security-auditor,typescript}-specialist.yaml` (5) + `index.yaml` | Replaced (V3 migration) | `4609a4917` standardizing yaml→md — same direction | Aligned: keep our deletion, accept upstream's `.md` additions |
| `.claude/agents/v3/{database,project-coordinator,python,test-architect,typescript}-specialist.yaml` (5) + `index.yaml` | Same | Same | Aligned: same |
| `v3/@claude-flow/cli/src/memory/memory-bridge.ts` | ADR-0086 RVF-first | Multiple commits (`bff8a34af` ReasoningBank embedder, `656d404b2` self-learning pipeline, `911bd4e94` RaBitQ alignment, `04d6a9a0a` AgentDB sidecar, `eb4f251b6` ESM, `5c5ede94b` cwd, more) | **Audit**: did our RVF replacement absorb the same fixes? Specifically the SQLite-path fix from `bff8a34af` may have an analogous bug in RVF; verify. |
| `v3/@claude-flow/cli/src/memory/memory-initializer.ts` | ADR-0086 RVF-first | `bff8a34af` SQLite path P0 (`path.join` → `path.resolve` — data loss when MCP server CWD changed), `5c5ede94b` cwd, `0590bf29c` namespace | **Audit**: same — does our equivalent code (likely in our `storage-factory.ts` or RVF init path) have the same bugs upstream just fixed? |
| `v3/@claude-flow/memory/src/hybrid-backend.test.ts` | ADR-0086 hybrid-eliminated | `5151aa9b2` health tolerance fix | Aligned: our deletion is correct (no hybrid backend exists in our model) |
| `v3/@claude-flow/memory/src/sqljs-backend.ts` | ADR-0086 sqljs-eliminated | `5151aa9b2` test fix | Aligned |

### Action items for the merge

1. **Re-audit `bff8a34af` (SQLite path fix) and `5c5ede94b` (cwd handling) against our RVF init/path code.** The same bug class (cwd churn breaking persistence) may exist in our paths.
   - **Audit completed by ADR-0086+0084 redundancy-audit agent (2026-04-29) and re-verified 2026-04-29 file-path validation pass:** our `memory-router.ts` benefits from the `findProjectRoot()` helper (renamed from `getProjectCwd()` on 2026-04-23 per ADR-0100; live at `cli/src/mcp-tools/types.ts:50`) + `CLAUDE_FLOW_CWD` support in 16 MCP-tool files, but **5 sites in `memory-router.ts` itself use bare `process.cwd()` without the helper** (lines 204, 209, 273, 312, 316). Same bug class as upstream's `bff8a34af`/`5c5ede94b`. Mitigated for the primary `.rvf` path by ADR-0069 Bug #3's per-user fallback; outstanding for `swarmDir` + config-read paths. **Concrete fix**: replace 5 bare `process.cwd()` sites with `findProjectRoot()` (already exported from `cli/src/mcp-tools/types.ts:50`). Add an acceptance check that asserts `memory store` from `CWD=/` writes to the same `.rvf` as `memory store` from inside the init'd project (the upstream #1532 test surface, adapted to RVF).

### Upstream's storage-correctness state vs ours (empirical, 2026-04-29)

`bff8a34af` "fixed" cwd-churn data loss — but only at **3 specific sites in `memory-initializer.ts`** (lines 392, 2058, 2180). Upstream HEAD still has **25 bare `process.cwd()` calls in `cli/src/memory/` + `memory/src/`**, and several still use the buggy `path.join(process.cwd(), ...)` pattern:

```
memory-initializer.ts:501   path.join(process.cwd(), '.swarm')         ← STILL BUGGED
memory-initializer.ts:1055  path.join(process.cwd(), 'memory.db')      ← STILL BUGGED (4 fallback paths)
ewc-consolidation.ts:150    path.join(process.cwd(), '.swarm', ...)    ← STILL BUGGED
intelligence.ts:28          const cwd = process.cwd()                  ← bare, no helper
memory-bridge.ts:40         const cwd = process.cwd()                  ← bare
```

**Upstream did not introduce any project-root helper that honors `CLAUDE_FLOW_CWD`.** Our 16 MCP-tool files do (`findProjectRoot()`, originally named `getProjectCwd` and renamed 2026-04-23 per ADR-0100). The bug class is *partially* fixed upstream — at fewer sites, but still active.

#### Primitive-by-primitive comparison

| Storage-correctness primitive | Upstream HEAD | Our fork |
|---|---|---|
| `findProjectRoot()` helper honoring `CLAUDE_FLOW_CWD` (renamed from `getProjectCwd` on 2026-04-23 per ADR-0100) | **does not exist** | `cli/src/mcp-tools/types.ts:50`, used in 16 MCP-tool files |
| Bare `process.cwd()` count in storage paths | **25** (3 of those moved from `path.join` → `path.resolve` in `bff8a34af`) | 5 (in `memory-router.ts` lines 204, 209, 273, 312, 316; documented above as an outstanding action item) |
| `open-database.ts` WAL-safe wrapper | **does not exist** | ADR-0080 created it |
| Cross-process file lock for JSON state stores (claims, hive-mind, swarm, sessions, workflow) | **does not exist anywhere** (`grep -l withSwarmStoreLock\|withHiveStoreLock\|O_EXCL` returned nothing) | ADR-0098 + ADR-0104 §5 + ADR-0094 P9 across 5+ store types |
| `persistQueue` inter-process serialization | **in-process only** (`8824fe3c4`) — `Promise.then().catch(() => {})` chain inside one Node process | ADR-0095 advisory lock + 3-item program a/b/c — covers inter-process `LockHeld 0x0300` from native NAPI lib |
| `RvfCorruptError` class + atomic tmp+rename + fsync | **not in upstream** (`rvf-backend.ts` touched once for `persistQueue` only) | ADR-0090 B2 + ADR-0095 d11 fsync-tmp-before-rename for APFS |
| `seenIds` tombstone for multi-writer convergence | **not addressed** | ADR-0090 B7 (`de7ba4876`) |
| Native `tryNativeInit` magic-byte invariant | **does not exist** | ADR-0095 d4 |
| `withWalSafe()` / open-with-WAL guard | **does not exist** — sql.js + WAL trap is still open in `memory-initializer.ts` | ADR-0080 `open-database.ts` wrapper |

#### What this means for the merge

Upstream is doing **incremental, patchy, issue-driven fixes** on the SQLite-first path — usually after a user files an issue (`#1490` cwd path, `#1532` cwd handling, `#1559` ESM crashes, etc.). The bug-fix campaign is real and reduces severity, but it is **not architectural**:

- They didn't centralize cwd resolution
- They didn't build a generic file-lock primitive
- They didn't solve inter-process RVF races
- They didn't wrap WAL semantics in a safe abstraction

We **bypassed the bug class** by going RVF-first AND by building the missing primitives. Upstream is still triaging individual symptoms.

**Implications for ADR-0111 execution**:

1. **Our RVF-first commits don't lose value on merge.** The bugs we sidestepped are still present in upstream's residual SQLite paths.
2. **The orphaned-fix risk for the deleted memory files (per §Deleted-file orphans) is bounded** — upstream only patched ~3 sites for cwd-churn; we already cover those + 22 more via `findProjectRoot()`. The 5 outstanding bare `process.cwd()` sites in `memory-router.ts` are the only real residual.
3. **`8824fe3c4`'s `persistQueue` does NOT obviate ADR-0095.** Its scope is intra-process; ADR-0095's lock is inter-process. Composition (queue inside lock inside merge) gives both guarantees; replacing one with the other regresses.
4. **Upstream's incremental fixes are still worth absorbing** — they're not redundant with us. `bff8a34af`'s 3-site `path.resolve` patch is in files we deleted, so it's literally a no-op for our merge; but the behavioral *intent* (fix cwd-relative paths) is mirrored by our `findProjectRoot()` rollout. Any future upstream cwd fix that lands in `memory-router.ts` would matter.

### Divergence patterns across the fork

The cwd-churn pattern (upstream patches symptoms / we eliminate the bug class) repeats across multiple subsystems. Mapping them so the merge isn't surprised:

#### Pattern 1 — Upstream patchy / Our architectural elimination

| Bug class | Upstream's incremental approach | Our architectural approach |
|---|---|---|
| **Cwd-churn data loss** | `bff8a34af` 3 sites in `memory-initializer.ts`; 22 sites still bare `process.cwd()` | `findProjectRoot()` helper (renamed from `getProjectCwd` 2026-04-23) used in 16 MCP-tool files; ADR-0100 walk-up resolution across 15 handlers |
| **Silent fallbacks** (`Math.random()` confidence, hardcoded metrics, stub-success) | 10+ commits removing fakery one surface at a time: `a101c2a08`, `398f7c2dc`, `dc2abef2a`, `e030ee039`, `d3da4b676`, `1409db9bc`, `0752e5963`, `a2e2def04`, `5d40236b1`, `fef1a7dd7` | `feedback-no-fallbacks.md` invariant + ADR-0050 14 fail-loud defects + ADR-0049 fail-loud invariant — silent fallbacks forbidden by policy, not "fix as found" |
| **Enum validation gaps** | `validateIdentifier` regex shell-sanitization expanded to 27/28 files (`a101c2a08`); ADR-092 names "domain-specific validators per shape" but only ships `validateGitRef` + `validatePackageName` | ADR-0107/0108/0110 specify `validateQueenType` / `validateWorkerType` / `validateStorageProvider` enum validators following ADR-092's stated pattern — architectural completion |
| **State-store consistency** | None — `grep -l withSwarmStoreLock\|withHiveStoreLock\|O_EXCL` returns **zero** matches in upstream. State files unprotected against concurrent writers | ADR-0098 + ADR-0104 §5 + ADR-0094 P9 — single `withSwarmStoreLock` / `withHiveStoreLock` / `withClaimsLock` primitive applied to 5+ store types |
| **Hive-mind orchestration** | ADR-067 §4.2: forbid Task tool, point Queen at JSON-stub `agent_spawn` MCP — broken architectural decision. Then issue-by-issue stub remediation in `8c4cecfb1` (22 stubs) without revisiting the architectural block | ADR-0104 reverts the `#1422` block + adds WORKER COORDINATION CONTRACT — architectural fix that lets the Queen actually orchestrate |
| **Stub elimination** | `8c4cecfb1` "22 stubs replaced", `43edb691a` "22 stub CLI commands", `398f7c2dc` "9 remaining stubs" — replace one surface at a time | ADR-0073 stub-tool-honesty + ADR-0050 fail-loud invariants — stubs forbidden by policy |
| **Schema drift / WAL safety** | None — sql.js-writes-to-WAL-mode-database trap is unaddressed upstream | ADR-0080 `open-database.ts` WAL-safe wrapper — single chokepoint detects WAL mode and refuses sql.js |
| **Config-chain bypass** | `a101c2a08` validates inputs at 27 handler call sites; never centralizes config resolution | ADR-0080 `resolve-config.ts` unified chain (`embeddings.json` → `RuntimeConfig` → consumers) wired across 50+ sites in ADR-0069 audit |
| **Embedding-dim drift** | `e0d4703eb` adds 384d MiniLM-L6 fallback (another option). `01c764f6f` later auto-pads to 768. Two different incremental responses | ADR-0052 + ADR-0068 + ADR-0102 enforce 768-dim end-to-end across all controllers, RLConfig, queen-coordinator, HNSW M-param |
| **Multi-writer RVF races** | `8824fe3c4` adds in-process `persistQueue` only. Doesn't address inter-process `LockHeld 0x0300` from native NAPI | ADR-0095 advisory lock + tmp-path uniqueness + factory cache + tryNativeInit invariant — inter-process |
| **`cli mcp exec` ephemeral state loss** | Unaddressed — fresh MCP-tool processes lose in-memory state; no fix in 67-commit window | Cross-process persistence (Category J, ~5 commits) — journal-replay store, atomic tmp+rename, config wiring |

#### Pattern 2 — Upstream architectural / Ours incomplete or absent

The reverse — places where **upstream did the architectural thing and we haven't yet**, or where upstream's primitive is the right one to absorb:

| Topic | Upstream's architectural move | Our state |
|---|---|---|
| **Plugin sandboxing** | `f3cc99d8b` CRIT-02 — vm isolation + 8-permission capability gating + `PluginPermissions` interface + namespace-based trust gate | We don't have this. Adopt + **codemod the namespace gate from `@claude-flow/` → `@sparkleideas/`** so our scope rename doesn't break the trust system (per §Cross-cutting findings #6) |
| **Lazy command loading (PERF-03)** | `e50df6722` — `cli/src/commands/index.ts` 37 sync imports → 10 + `commandLoaders` async map. Removes ~5-8s startup cost | We don't have this. Adopt as-is. |
| **`ConfigFileManager` with Zod-ready validation** | `43edb691a` — atomic writes, schema-ready validation surface for `config init/set/reset/export/import` | We have ad-hoc config plumbing. ADR-0110 enum validators should layer ON TOP of this rather than reinvent |
| **Honesty test suite** (400 LOC) | `e030ee039` — integration tests asserting no `Math.random()` / `setTimeout` / hardcoded values across MCP tools | We have per-handler unit tests; no equivalent global honesty assertion suite. Adopt the test idiom for our acceptance harness |
| **`hive-mind_consensus` real strategy tallying** | `6992d5f67` ships ~430 LOC of real BFT/Raft/Quorum JSON-tally with term-collision + Byzantine-voter detection inside the MCP handler | ADR-0106 now Option A (full wire-up of `ConsensusEngine` + raft/gossip/byzantine via daemon-resident pattern). Upstream's `6992d5f67` JSON-tally improvements **layer on top** of `ConsensusEngine` (additional correctness wins regardless of dispatch backend), not substitute for the real protocols |
| **`graph-backend.ts` for ADR-087** | `7eb505d22` — `recordSwarmTeam(agentIds, topology)` + `getNeighbors(nodeId, hops)` runtime primitives | ADR-0105/0107/0109's natural primitive. **Consume rather than greenfield equivalents** |
| **`bff8a34af` `--dangerously-skip-permissions` strict semantics** | Strict `=== true` check (was `!== false`) — closes ADR-0104 Q4 (permission propagation in `-p` mode) | Q4 was open; adopt and close |
| **`getProjectCwd` for `guidance_discover`** | `9fc61ea1c` — 3-strategy walk-up, but only **one tool** | We have ADR-0100 for **15 tools** — broader. Donate-back candidate. (Note: our equivalent helper was renamed `getProjectCwd` → `findProjectRoot` on 2026-04-23; if upstream merges our donation we'd want symbol-name alignment) |

#### Pattern 3 — Genuinely different architectural choices (not "incremental vs eliminate" — two different axioms)

| Topic | Upstream | Ours | Disposition |
|---|---|---|---|
| **Storage backend selection** | Dual SQLite+RVF co-existence via `database-provider.ts` (both alive concurrently) | RVF-first via `storage-factory.ts`; SQLite is structurally-unreachable fallback (per `project-rvf-primary.md`) | Preserve — it's our axiom |
| **Hooks vs MCP separation** | Intentional design — hooks for trajectory learning, MCP for coordination (ADR-073/0083/0084/0086 line) | ADR-0104 **respects** this boundary | Alignment, not divergence |
| **Topology / Queen types / Consensus runtime** | Orphaned full TS classes in `swarm/src/` (TopologyManager 656 LOC, QueenCoordinator 2030 LOC, ConsensusEngine + raft/byzantine/gossip) — never imported by CLI | We deleted them or built replacements (`controller-registry.ts`, `controller-intercept.ts`) | **Per-class disposition** — see §"Orphaned `swarm/src/` classes — per-class disposition" below |
| **Worker spawning** | Single `--type` per spawn; worker prompt is `"You are a ${type} in the hive."` free-form | ADR-0108 plans V2-parity port: `--worker-types` comma-separated + per-type prose. V2 had this; V3 lost it. | Port back from V2 |
| **Init template surface** | Minimal init; user-driven config | Comprehensive (ADR-0070): emits all ADR-0069 keys, 5 CLI flags, JSON not YAML, deep-clone options | Preserve our richer surface |
| **Plugin marketplace** | 19 native plugins + GitHub Pages storefront + validation workflow (`81418649c`) | None | Adopt; codemod install URLs to `@sparkleideas/cli` |

### Orphaned `swarm/src/` classes — per-class wire-up plan

**Policy** (per memory `feedback-no-value-judgements-on-features.md`): wire ALL orphaned capability. Architectural conflicts are solvable via composition; trust-model / scale / "edge case" arguments are NOT reasons to skip wiring. Document trade-offs as code annotations, not as "don't ship."

| Class | LOC | What it provides | Wire-up plan |
|---|---:|---|---|
| `swarm/src/topology-manager.ts` | 656 | `addNode/removeNode/electLeader/rebalance` + adjacency list + role index over EventEmitter. State-tracking + leader-election layer. | **Wire** (ADR-0105 Option C). Instantiate per hive on the MCP server, persist state via `withHiveStoreLock`, expose authoritative `topology` field via `mcp__ruflo__hive-mind_status`, workers register on first `hive-mind_memory({set})` call. **Complementary** to `graph-backend.ts` (persistent agent-relationship graph) — wire BOTH per ADR-0105 §Recommendation. ~50-80 LOC of glue + acceptance tests. |
| `swarm/src/queen-coordinator.ts` | 2030 | Capability-scored task assignment, stall detection, automatic recovery, per-topology coordination strategies, performance pattern training | **Wire as daemon-resident advisor** alongside ADR-0104's prompt-driven Queen (composition, not replacement). QueenCoordinator runs in the long-lived ruflo daemon; Queen prompt (per ADR-0104 §6) calls advisor methods via new MCP tools (`queen_score_capabilities`, `queen_detect_stalls`, `queen_recommend_replacement`, `queen_select_topology_strategy`). Both live; the prompt-Queen *consults* the TS class for deterministic decisions while staying in `claude` for orchestration. Annotation: `// QueenCoordinator runs as daemon-side advisor; ADR-0104's prompt-driven Queen is the orchestrator and calls into this class via MCP tools`. ~150-200 LOC of MCP-tool surface + the existing 2030-LOC class wired through. |
| `swarm/src/consensus/raft.ts` | 443 | Term-based leader election + log replication + commit-index ordering | **Wire** as `hive-mind_consensus({strategy:'raft'})` backend. Replaces JSON-tally placeholder for Raft. Annotation: `// Raft state is in-process per Queen session; cross-hive federation persistence is a separate enhancement (see ADR-0106 federation track)` — annotation, not gate. |
| `swarm/src/consensus/gossip.ts` | 513 | Epoch-based propagation, eventually consistent across N nodes | **Wire** as `hive-mind_consensus({strategy:'gossip'})` backend. Annotation: `// Gossip epoch state per Queen session; cross-hive persistence is a federation enhancement.` |
| `swarm/src/consensus/index.ts` (`ConsensusEngine`) | 267 | Factory with algorithm switch (`raft \| byzantine \| gossip \| paxos→raft`) | **Wire** as the dispatch layer behind `hive-mind_consensus` MCP handler. Replaces inline `switch (strategy)` with `ConsensusEngine.initialize({algorithm: strategy})`. Annotation: `// paxos→raft fallback is intentional per upstream design.` |
| `swarm/src/consensus/byzantine.ts` | 431 | PBFT shape with `requiredVotes = 2*f + 1`; `signature?: string` field declared on `ByzantineMessage` | **Wire** as `hive-mind_consensus({strategy:'byzantine'})` backend. Structural PBFT (vote-counting, equivocation detection across rounds) is real even with signatures unverified. Annotation: `// signatures field is structural-only; full PBFT identity verification is a separate feature gap (see ADR-0109 — fill at federation time when independent identity exists). Wiring the protocol now means strategy='byzantine' produces real BFT-shape vote tallies; signature-verified adversarial guarantees come later.` |

**No "don't wire" entries.** Every orphaned class above gets wired. Earlier-draft "Don't wire QueenCoordinator / consensus intra-hive / byzantine" rows were value judgements (memory `feedback-no-value-judgements-on-features.md`); corrected.

**Composition strategy for QueenCoordinator** (the conflict-with-ADR-0104 case):

The earlier objection — "Queen-as-TS-class conflicts with Queen-as-claude-subprocess" — is solvable, not blocking. The composition is **advisor + orchestrator**, not either-or:

- **Orchestrator** (ADR-0104, unchanged): `cli/src/commands/hive-mind.ts` spawns `claude --claude` per ADR-0104 §6. Queen runs as `claude` subprocess, spawns workers via Task tool, writes results to `mcp__ruflo__hive-mind_memory`.
- **Advisor** (new wiring): QueenCoordinator runs in the long-lived ruflo daemon. The Queen's prompt is extended to call `mcp__ruflo__queen_*` MCP tools that delegate to QueenCoordinator's deterministic logic:
  - `queen_score_capabilities({task, agentIds})` → returns ranked agent suitability
  - `queen_detect_stalls()` → reads daemon-side timing state, returns silent workers
  - `queen_recommend_replacement({stalledAgentId})` → uses TopologyManager's role index + collaboration history
  - `queen_select_topology_strategy({topology})` → returns coordination block (mesh-broadcast / hierarchical-subtree / ring-pass / etc.) for the Queen prompt to follow
- The prompt-driven Queen *consults* the TS class for deterministic decisions while staying in `claude` for orchestration. Both feature sets ship.

**Updates required to existing ADRs** (per "wire all" policy) — this is the same set as §Decision plan step 7 (Reconcile our ADRs); the two lists were drifting in earlier drafts and are now reconciled:

- ADR-0103 §Investigation progress — ADR-0107 row → "wire QueenCoordinator as daemon-resident advisor"; ADR-0106 row → flip from Option D to Option A (full wire-up of `swarm/src/consensus/*`); ADR-0109 row → reference wired consensus protocols; cross-cutting findings + recommendation that ADR-0105/0107/0109 consume `graph-backend.ts` (ADR-087) instead of greenfielding equivalents
- ADR-0104 §Q4 — closed by `e50df6722` HIGH-02 (strict `=== true` semantics for `--dangerously-skip-permissions`); adopt and mark resolved
- ADR-0105 §Recommendation — already correct (wires both TopologyManager + graph-backend.ts)
- ADR-0106 §Recommendation — flip from Option D ("park `ConsensusEngine` as future federation infra") to Option A ("wire `ConsensusEngine` into `hive-mind_consensus` MCP handler"). All 4 strategies become real protocol implementations. Upstream's `6992d5f67` JSON-tally improvements layer on top. Add CLI flag exposure (`strategy`/`term`/`quorumPreset`/`timeoutMs`) so all protocol parameters are user-addressable
- ADR-0107 §Recommendation — flip from "park QueenCoordinator as `@internal`" to "wire QueenCoordinator as daemon-resident advisor with new `mcp__ruflo__queen_*` MCP tool surface"
- ADR-0107/0108/0110 §Validation — extend `validate-input.ts` with `validateQueenType` / `validateWorkerType` / `validateStorageProvider` enum validators per ADR-092's domain-specific-validators-per-shape pattern
- ADR-0109 §Recommendation — flip from "preserve `swarm/src/consensus/*` as `@internal — federated cross-hive`" to "wire all 4 consensus protocols (raft/gossip/byzantine/CRDT-future); signatures-unverified annotation stays as known-limitation in code, not as gating policy"
- ADR-0110 §Amendment — note that "storage-factory.ts is fork-only; upstream's `database-provider.ts` exhibits a different unreachable-branch pattern; README 'SQLite WAL' claim already deleted upstream at `81418649c`"

### What this means for the merge plan

The three-pattern split is the merge plan in compressed form:

- **Pattern 1**: keep our architectural eliminations; absorb upstream's incremental fixes alongside (they're complementary, not redundant). Closes more of each bug class than either alone.
- **Pattern 2**: adopt upstream's architectural moves we don't have. Plugin sandboxing, PERF-03 lazy loading, `ConfigFileManager`, honesty test suite, `graph-backend.ts` consumption, Q4 closure — all real upgrades for our fork.
- **Pattern 3**: preserve our axioms (RVF-first, comprehensive init template). Consume upstream's where it complements (`graph-backend.ts`, plugin marketplace). Reframe ADR-0106 since `6992d5f67` already shipped the runtime we'd planned to wire.

### Plugin support: 3-layer state

Plugin support is itself a 3-layer system; we have 2 of 3. Mapping for clarity since "do we have plugins?" depends on which layer:

| Layer | What | Our state | Upstream state |
|---|---|---|---|
| **1. Plugin SDK** (interfaces, registry) | `@sparkleideas/plugins` package + `plugin-interface.ts` (`src/core/`) + `plugin-registry.ts` (`src/registry/`) + `cli/src/plugins/` + `__tests__/plugin-registry.test.ts`. **No `plugin-loader.ts` exists in our fork** (verified 2026-04-29) — earlier draft cited a file we don't ship | ✅ **shipped** as `@sparkleideas/plugins` (codemod-renamed from `@claude-flow/plugins` at build time; source `package.json` still reads `@claude-flow/plugins`) | ✅ shipped as `@claude-flow/plugins` |
| **2. v3 ecosystem plugins** (domain plugins bundled with the package) | 15 plugins in `v3/plugins/`: agentic-qe, code-intelligence, cognitive-kernel, financial-risk, gastown-bridge, healthcare-clinical, hyperbolic-reasoning, legal-contracts, neural-coordination, perf-optimizer, prime-radiant, quantum-optimizer, ruvector-upstream, teammate-plugin, test-intelligence | ✅ **shipped** | ✅ shipped (same set) |
| **3. Claude Code native plugin marketplace** (top-level `plugins/ruflo-*` tree + GitHub Pages storefront + plugin sandboxing) | ❌ **not yet** — `.claude-plugin/marketplace.json` lists 1 plugin (root `name: claude-flow-marketplace`, plugins[0] `name: claude-flow`); top-level `plugins/` directory does not exist; no GH Pages workflow; no vm-isolation sandbox | ✅ shipped as `81418649c` (130 files, 19 plugins, GH Pages workflow, ruflo-goals 20th plugin via `851f3ed4c`). `marketplace.json` `name: ruflo`, 20 plugins. Plugin sandbox via `f3cc99d8b` (vm isolation + 8-permission capability gating + `PluginPermissions` interface) |

**User-facing implication today**: a user on `@sparkleideas/cli` can write plugins via the SDK and gets the 15 ecosystem plugins bundled, but **cannot** `/plugin marketplace add ruvnet/ruflo` through our distribution to discover Claude Code native plugins, and community plugins run **without sandboxing** — full capability access.

**Layer-3 merge work** (per §Cross-fork merge order step 2 group G):

1. **Adopt `81418649c`** (19-plugin marketplace + GitHub Pages workflow + USERGUIDE.md split out of README).
2. **Adopt `f3cc99d8b` plugin sandbox** — but **codemod the namespace gate**: upstream's trust check uses literal `@claude-flow/` prefix; under our scope rename it must become `@sparkleideas/` or no community plugin running through our distribution can ever be marked "official." Add an acceptance test that verifies trust level is correctly applied to `@sparkleideas/*`-prefixed plugins.
3. **Codemod plugin-source markdown** — 94 `@claude-flow/*` install-command refs across plugin docs become `@sparkleideas/*`. The 299 `mcp__claude-flow__*` tool-name refs depend on whether our renamed CLI registers tools as legacy `mcp__claude-flow__*` or new `mcp__sparkleideas__*` (per §Cross-cutting findings — verify before codemod).
4. **Marketplace identity decision** — open question:
   - **Option A**: users `/plugin marketplace add ruvnet/ruflo` — gets upstream's manifest pointing at upstream's CLI package. Distribution incoherence (manifest says `@claude-flow/cli`, user has `@sparkleideas/cli`).
   - **Option B**: we publish a parallel `sparkling/ruflo-marketplace` repo with codemod'd plugin sources + manifest pointing at `@sparkleideas/cli`. Coherent but adds a maintenance surface.
   - **Option C**: keep upstream's marketplace identity, codemod the marketplace.json `name` and the install snippets at *consumption* time (when user runs `/plugin install`). Lowest maintenance, requires CLI cooperation.
   - Recommendation: **Option B for our published distribution** — the patch repo already maintains 4 fork repos; one more (`sparkling/ruflo-marketplace`) is the consistent fork-workflow shape. Documented in `reference-fork-workflow.md` after the merge ships.

### Cross-cutting orphan-handling action items (not plugin-specific)

These are general merge-hygiene items that surfaced during the swarm investigation; they sit alongside §Action items for the merge above:

1. **Re-audit `911bd4e94` RaBitQ-bridge alignment** against our equivalent integration (we don't have RaBitQ yet on fork main, but it lands automatically with step 2's upstream sync — no special branch merge required per R15 reframe). The bridge alignment audit happens during ruflo group F when `911bd4e94` is composed onto our `memory-bridge.ts` patches.
2. **Document each substantive deletion's "upstream-equivalent fix scope"** in ADR-0084 (Dead Code Cleanup) and ADR-0086 (RVF-first) — make the orphan-tracking explicit so future merges don't miss this class of risk.
3. **Add a build-time check**: list-deleted-files-also-modified-upstream as a diagnostic in `scripts/sync-upstream` (or wherever the merge prep lives) so the orphan-list surfaces every merge cycle.

### Cross-cutting redundancy hypothesis (the 342 ahead-commits)

Of our 342 ahead-of-upstream commits:

- **HIGH redundancy (~25-40%)** — concentrated in fix-commits in honest-metrics / stub-removal / fake-heuristics themes (138 fix-commits total). Upstream did **10+ parallel "honesty" commits** (`a101c2a08` v3.5.71 #1425 remediation, `398f7c2dc` v3.5.72 9 stubs, `e030ee039` AgentDB + honesty tests, `d3da4b676`, `1409db9bc`, `0752e5963`, `a2e2def04`, `5d40236b1`, `fef1a7dd7`, `ff3228613` README audit). When we rebase, many of our small fix-commits will produce empty diffs ("already applied").
- **LOW redundancy (~0%)** — architectural divergences:
  - **ADR-0080** Storage Consolidation Verdict (19 commits): UNIQUE — upstream uses dual RVF+SQLite co-existence; we forced RVF-first
  - **ADR-0094** 100% Acceptance Coverage (13 commits): UNIQUE — different surface (acceptance vs unit/integration honesty tests)
  - **ADR-0086/0090/0095/0084** RVF-first storage (~30 commits): UNIQUE — upstream still treats SQLite as live read path (`911bd4e94`, `656d404b2` confirm)
  - **ADR-0076/0068** Controller architecture + config unification: UNIQUE
  - **ADR-0052** Config-driven embedding (11 commits): DIVERGENT — upstream goes the other way (`e0d4703eb` adds 384d MiniLM); we enforce 768-dim
  - **ADR-0073** Native RVF activation (5 commits): UNIQUE-ish — upstream's `7eb505d22` is native ruvllm/graph-node, not RVF
  - **ADR-0069** Future Vision: AgentDBService consolidation (10 commits): UNIQUE

**Net merge expectation**: ~25-40% of our fix-commits get absorbed as no-ops or near-no-ops; ~60-75% of our fix-commits + nearly all of our feat-commits remain real divergence we want to preserve.

### 2026-04-29 — 15-agent redundancy-audit swarm: hypothesis decisively refuted

A 15-agent parallel swarm audited every one of our 342 ahead-of-upstream commits classified as DROP / KEEP / MERGE.

| Slice | Commits | DROP | KEEP | MERGE |
|---|---:|---:|---:|---:|
| ADR-0052 Config-driven embedding | 11 | 1 | 8 | 2 |
| ADR-0094 Acceptance coverage (fork side) | 19 | 0 | 13 | 6 |
| ADR-0090 DB backend paths | 16 | 0 | 10 | 6 |
| ADR-0076 Architecture consolidation | 9 | 0 | 9 | 0 |
| ADR-0069 Future Vision config chain | 13 | 0 | 13 | 0 |
| ADR-0086+0084 RVF-first storage | 11 | 0 | 11 | 0 |
| ADR-0080 Storage Consolidation Verdict | 19 | 2 (idempotent) | 15 | 2 |
| ADR-0068+0033 Controller config + activation | 10 | 0 | 10 | 0 |
| ADR-0073+0095 Native RVF + IPC | 9 | 0 | 9 | 0 |
| Chore (version bumps + cleanup) | 47 | 3 | 44 | 0 |
| Non-ADR fix batch 1 | 30 | 7 self-superseded | 22 | 1 |
| Non-ADR fix batch 2 | 30 | 9 self-superseded + 1 upstream | 17 | 4 |
| Feat (architectural feats) | 48 | 0 | 48 | 0 |
| Small-ADRs cluster (21 ADRs) | 38 | 0 | ~30 | ~8 |
| Issue-tagged (WM/SG/CF/DM/ML/EM/MM/etc) | 36 | 1 obsoleted + 2 redundant + 2 squash | 27 | 4 |

**Cumulative across 346 audited commits**:

- **Genuinely upstream-redundant (DROP — rebase as empty diff)**: **7 commits ≈ 2%**
  1. `d5ae8d56c` — Hetzner-specific tuning (no longer relevant on M5 Max)
  2. `dc179d605` — intelligence.cjs dedup (upstream `4a3763ec2` does the same dedup with same numbers; ours landed 2 days earlier)
  3. `31363d5bc` — CI/CD probe leftover comment
  4. `4e253bcd7` — CI/CD probe leftover comment
  5. `f72bd028d` — CI/CD probe leftover comment
  6. `0d4981721` (partial) — `@xenova/transformers` optionalDep (upstream `4b42b5d22` covers the dep entry; keep the 768-dim fallback dim portion)
  7. `c3c1f18dd` (verify on rebase) — `.unref()` on setInterval timers (upstream `19ace7e54` adjacent; verify which timers overlap)

- **Self-superseded by ADR-0085/0086 deletion** (rebase as `deleted-by-us/modified-by-them` → resolve "keep deletion"): **~16 commits ≈ 5%**. These touch `memory-initializer.ts` / `memory-bridge.ts` / `open-database.ts` which our own ADR-0085 / ADR-0086 deleted. They're not redundant with upstream; they're redundant with our own subsequent refactor.

- **Squash-pre-merge candidates** (logical pairs): 2 pairs
  - `de14ffe4d` + `9f44022ed` (SG-004 add+supersede)
  - `2c311d36e` + `67f143f8e` (DM-001 384d→768d direction reversal)

- **HIGH-CONFLICT hand-merge required**: ~10-15 commits
  - 5 hunks in the ADR-0104 hive-mind cluster (already detailed in §Conflict zones)
  - `0cd9c4a39` (13-axis init port, collides with upstream's 19-plugin marketplace + yaml→md)
  - 6 RVF backend commits in ADR-0090 (collide with upstream `8824fe3c4` `persistQueue`)
  - `5b7cefaea` (memory-bridge controller wiring)
  - `f46a104b0` (controller-registry P2-B/C + P5-C)
  - `a3b3d7797` (worker-daemon — `maxCpuLoad: 28.0` collides with upstream `100ffeaa3` proportional formula)

- **KEEP (real fork divergence preserved through merge)**: **~310 commits ≈ 91%**

### Hypothesis verdict

**The user's hypothesis "most of our 342 changes have been fixed upstream" is decisively refuted.** Genuine upstream-redundancy across 346 audited commits is **~2%**. What initially looks like redundancy in the loose fix-commits is mostly **self-superseded** (we did the work, then our own ADR-0085/0086 made the work obsolete via deletion). Those commits don't rebase as empty diffs — they rebase as `deleted-by-us/modified-by-them` conflicts that resolve to "keep our deletion."

### Architectural take-aways

1. **Architectural ADRs (0052, 0068, 0069, 0073, 0076, 0080, 0086, 0090, 0094, 0095) are ~0% redundant.** Upstream maintained dual SQLite+RVF coexistence; we forced RVF-first. Upstream lacks unified config-chain; we built `resolve-config.ts`. Upstream uses orphaned subsystem code (`TopologyManager`, `ConsensusEngine`, `QueenCoordinator`); we either delete or build new replacements. Each cluster is genuine fork divergence worth preserving.

2. **Feat-commits are 100% KEEP.** All 48 architectural feats (cross-process persistence, new MCP tools, storage refactor, config chain, controller architecture, native RVF) survive merge unchanged.

3. **Chore commits are 6% redundant.** The 3 CI/CD probe leftovers should be reverted before merge. Otherwise version bumps live in `@sparkleideas/*` namespace disjoint from upstream's `@claude-flow/*`.

4. **The orphaned-deletion hazard is the real merge risk** (per §Deleted-file orphans), not redundancy. Upstream's `bff8a34af` SQLite-path P0 + `5c5ede94b` cwd handling fix files we deleted; we need to audit whether the same bug class re-emerges in our `memory-router.ts` (already addressed in pre-flight: replace 5 bare `process.cwd()` sites with `findProjectRoot()`).

5. **Donate-back candidates** (broader/cleaner than upstream): ADR-0100 (15 MCP handlers vs upstream's 1 tool), ADR-0107/0108/0110 enum-validators following ADR-092's domain-specific-validators-per-shape pattern.

### Categorization of the 342 ahead-of-upstream commits

Synthesized from the 15-agent audit. Each category is a coherent *area of work* — distinct from upstream's parallel directions. Counts are approximate (some commits span categories — i.e., they appear in multiple slices of the redundancy-audit table above and so the audit table sums to 346 commits, 4 above the 342-commit inventory; the gap is double-counted commits that span two slices: one ADR-0090 commit also tagged Non-ADR-fix-batch, two ADR-0094 commits also in Issue-tagged WM/SG, and one Chore commit also in Pipeline cluster). The category sums below total ~293, leaving ~49 commits in cross-cutting touches not assigned to a single category (they are double-counted between A-M slices, mostly between A Storage + C Controllers + B Config — the audit's per-slice totals are authoritative; the per-category prose totals are descriptive only).

#### A. Storage & Memory subsystem (~70 commits, ~20%)

**The single largest divergence.** Upstream maintains dual SQLite+RVF co-existence (SQLite as live read path); we forced **RVF-first**, with SQLite reduced to a structurally-unreachable fallback in `storage-factory.ts`. Spans:

- **ADR-0086 + ADR-0084** (11): deleted `memory-initializer.ts`, `memory-bridge.ts`, `hybrid-backend.ts`, `sqljs-backend.ts`. Built `memory-router.ts` as the consolidated successor. Phase 0-3 progression.
- **ADR-0073** (5): native `@ruvector/rvf-node` (NAPI bindings); WAL write path; `.meta` sidecar; ghost-vector + replayWal fixes.
- **ADR-0095** (4): multi-writer race elimination (3-item program a/b/c) — `tryNativeInit` rewrite, tmp-path uniqueness, factory cache, fsync-tmp-before-rename for APFS.
- **ADR-0090** (16): Tier B1/B2/B3/B5/B7 fixes — `RvfCorruptError` class, atomic write paths, real BFT/Raft/Quorum tallying, controller renames, `ensureRouter` ordering, dimension propagation, multi-writer convergence.
- **ADR-0080** (19): new `open-database.ts` WAL-safe wrapper; new `rvf-shim.ts`; new `resolve-config.ts`. 8 raw sql.js sites replaced. cacheSize/maxEntries 1000000→100000.
- **ADR-0094 fork-side** (5): RVF write-amplification; `.meta` sidecar fallback on InvalidChecksum; lock release on exit.

#### B. Configuration chain & embedding-dim enforcement (~40 commits, ~12%)

Unified config-chain that **doesn't exist upstream**. Single source of truth (`embeddings.json` → `resolve-config.ts` → `RuntimeConfig` → `controller-registry`) for embedding dimension, model name, HNSW parameters, rate-limit defaults, similarity thresholds, learning rates.

- **ADR-0069** (13): A1-A17 audit of 50+ remediation sites; F3 dual `AttentionService` instances; init template + 5 CLI flags (`--port`, `--embedding-model`, `--similarity-threshold`, `--max-agents`, `--embedding-dim`); BM25 hash-fallback; closure with `_resolveDatabasePath` + `ruflo` bin rename.
- **ADR-0068** (5): Wave 2 dimension/model/HNSW unification; stale m:16/efC:200 defaults replaced; HNSW params config-driven via `RuntimeConfig`.
- **ADR-0052** (11): Per-package `embedding-constants.ts` Tier-2 pattern (8 constants files + 22 consumers); hardcoded-dimension elimination across 17+22+11+9 files; 13 stale OpenAI 1536 defaults replaced.
- **ADR-0067** (1): Full `Xenova/`-prefix sweep — direct collision with upstream `e0d4703eb`'s 384d MiniLM fallback.

**Why divergent**: upstream goes the other direction (`e0d4703eb` adds 384d fallback); we enforce 768-dim Xenova/all-mpnet-base-v2 end-to-end. Recommendation: make dimension end-to-end configurable, with our 768-dim defaults preserved.

#### C. Controller architecture (~50 commits, ~15%)

**Composition-aware controller registry** with deferred-init levels, intercept pattern, and 28 newly-activated controllers. Upstream still has the orphaned-subsystem pattern (full classes in `swarm/src/queen-coordinator.ts` 2030 LOC, `topology-manager.ts` 656 LOC, `consensus/{raft,gossip,byzantine}.ts` — never imported by CLI).

- **ADR-0076** (8): Phase 0-4 — HybridBackend deletion, `embedding-pipeline.ts`, `IStorage` interface, `storage-factory.ts`, `controller-intercept.ts` singleton pool, `getOrCreate(name, factory)` wrapping all 45 factory paths.
- **ADR-0033** (11): P2-P6 wiring — SkillLibrary, SonaTrajectory, GuardedVector, ExplainableRecall (Merkle), AgentMemoryScope, COW branching, reflexion (retrieve/store), causal_query, SolverBandit, contextSynthesizer, MMRDiversityRanker, causalRecall, batchOperations.
- **ADR-0041, 0042, 0043, 0044, 0045, 0046** (~12): RateLimiter/CircuitBreaker/ResourceTracker; MetadataFilter/QueryOptimizer; AttentionMetrics wiring; TelemetryManager + 4 audit MCP tools; NativeAccelerator singleton; `validateControllerIntegration` + `withBridgeSafeguards`.
- **ADR-0050** (4): 14 fail-loud invariants (F1-FLM) per `feedback-no-fallbacks.md`.
- **ADR-0072** (2): 20-package merge consolidation across the controller surface.
- **ADR-0040** (1): Inject embedders, drop deprecated controllers.

#### D. Hive-mind & Swarm orchestration (~5 commits, ~1%)

Small but architecturally critical — the hive actually orchestrates after our patches.

- **ADR-0104** (1): 6 source changes — parser flag scoping, hard-error on missing objective, honest "Registered worker slot(s)" wording, `.mcp.json` direct-path detection, `withHiveStoreLock` file lock, revert `#1422` block + WORKER COORDINATION CONTRACT.
- **ADR-0098** (1): Generator guardrail + config-fingerprint dedupe + O_EXCL lock (just shipped this session).
- **SG-009** (2): Removed `--v3-mode` flag; v3 (hierarchical-mesh + AgentDB + SONA) is now default.

#### E. Acceptance-harness fork-side fixes (~15 commits, ~4%)

Fork-side product fixes surfaced by ruflo-patch's acceptance harness (the harness itself is 50+ separate commits in ruflo-patch).

- Input validation + named errors (5): `validateIdentifier`/`validateText` calls in `memory_*` / `claims_*` / `consensus_*` handlers.
- File locking + idempotency (5): Cross-process O_EXCL locks on claims/session/workflow stores; `workflow_create` idempotent by name; `session_info` returns value.
- Pre-existing bugs surfaced by `196100171` (1 commit, 5 sub-fixes): autopilot ESM, embeddings defaults, hooks API (`cr.recall`→`cr.search` — may DROP if upstream `a2e2def04` rewrote first), session resolveHandle, RVF replayWal.
- Cold-start memory_search (1): exp-backoff retry for RVF flush-visibility.

#### F. CLI & Init template (~15 commits, ~4%)

- **ADR-0070** init template (3): new `config-template.ts` (166 LOC); JSON not YAML config; deep-clone options; permissionRequest hook.
- **ADR-0100** project-root walk-up (1): `findProjectRoot()` with 4 sentinel layers across 15 MCP handlers. **Broader than upstream's `9fc61ea1c`** (one tool only) — donate-back candidate.
- **CF-006** config.json migration (4): `init.ts`/`status.ts`/`start.ts` migrated from `config.yaml` to `config.json`; `start all` subcommand.
- **CF-003/004** doctor + config (2): `checkMemoryBackend` diagnostic; `--install` auto-rebuild; `config get/export` reads `config.json` with defaults merge.
- Pipeline/branding (5): `ruflo` bin alias; CLAUDE.md anti-drift swarm config + hook lifecycle + task complexity gate; init brand-aware "Next steps" output.

#### G. Hook handler & ESM hygiene (~10 commits, ~3%)

- **ADR-0085 Path A** (3): deleted `memory-bridge.ts` (3,650 lines); pushed registry into `memory-router.ts`; `hook-handler.cjs` → `.mjs`; statusline reads SQLite directly.
- **ADR-0074** (1): CJS/ESM dual-silo fix in helpers (different scope from upstream's `eb4f251b6`).
- Phase-2 wiring ESM (3): bare `require()` → ESM imports in `controller-registry.ts`, `intelligence.ts`, swarm package.
- Bridge rewiring (3): `bridgeGenerateEmbedding` uses `enhancedEmbeddingService`; agent-result store hardening.

#### H. Daemon hardening & IPC (~10 commits, ~3%)

- **DM-001..006 + HW-001..004** (1 commit, 10 sub-fixes): stdin pipe→ignore, exit-code propagation, intervals, timeout 5min→16min, log rotation, macOS freemem skip. **Note: `maxCpuLoad: 28.0` collides with upstream `100ffeaa3` proportional formula** — adopt upstream's.
- **ADR-0088** (2): deleted dead `DaemonIPCClient` (95 LOC); fixed daemon startup log; comment scrub.
- **ADR-0059** (2): unified MCP search both stores + DaemonIPC server; package-json deps required not optional.

#### I. Fork-only MCP tools (~10 commits, ~3% — 17+ new tools)

Net-new MCP tools that don't exist upstream. None collide with upstream's parallel additions:

- `ff826a846` — 6 tools: `agentdb_semantic_{add_route, remove_route, list_routes, graph_node_{create, get}, graph_edge_create}`
- `e84f3641a` — 2 tools: `agentdb_neural_patterns`, `agentdb_sona_trajectory_store`
- `1226875c6` — 5 tools: skill-create, skill-search, learner-run, learning-predict, experience-record
- `3827a6e14` — 3 tools: `rate_limit_status`, `resource_usage`, `circuit_status`
- `d4ad69865` — 4 tools: D1 telemetry + A9 audit + D3 embed
- `e14105f67` — 1 action: `coordination_node` status/info

#### J. Cross-process persistence (~5 commits, ~1%)

Fix for the `cli mcp exec` ephemeral-process bug — upstream still has it. Fresh MCP-tool processes lose in-memory state; we persist via journal-replay store / atomic tmp+rename / config wiring.

- `40581189c` — HNSW routers + SONA + MicroLoRA via journal-replay store
- `73c868044` — wasm agents to `store.json` (atomic tmp+rename)
- `ca7f9ce12` — SemanticRouter + graphAdapter cross-process persistence wiring
- `52539ff2c` — session memory snapshot via memory-router (RVF)

#### K. Pipeline & version-bump churn (~50 chore commits, ~15%)

- `-patch.N` pipeline version bumps (41): `@sparkleideas/*` namespace bumps from ruflo-patch deploy pipeline. Disjoint from upstream's `@claude-flow/*` namespace.
- 1.0.0 baselines (7).
- Stray TS-compile artifact removal (2): `.js`/`.d.ts`/`.map` files leaked into `src/` from misconfigured TS outDir.
- ADR-0085 phantom-reference cleanup (1).
- **CI/CD probe leftover (3 — DROP)**: `// pipeline-test-<ts>` / `// cicd-test-<ts>` / `// cicd-final-<ts>` comments in `shared/src/index.ts:196-198`. Revert pre-merge.

#### L. Portability fixes (~3 commits, ~1%)

Migrated from a 187GB Hetzner server to M5 Max 36GB. Hetzner-specific defaults removed:

- `639aa3701` — replace 160GB ceiling with dynamic OS detection
- `72e7305eb` — replace Hetzner-specific defaults with portable values (ruflo-patch#92)
- `d5ae8d56c` (DROP) — Hetzner-specific tuning no longer relevant

#### M. Hygiene & dead-code cleanup (~10 commits, ~3%)

- Build fixes: TS1128 unclosed case block; type declarations for 6 untyped deps; IStorageContract matches IMemoryBackend.
- Removed deprecated controllers: `graphTransformer`, `hybridSearch`, `federatedSession`, `mmrDiversity` (per `project-deprecated-controllers.md`).
- Phantom-reference cleanup: ADR-0085 `AgentDBService` reference scrub.
- Conflict-resolution cleanup: dead SqlJsBackend imports, auto-memory-hook syntax, restored baseline checks.

### The story in one paragraph

We forked ~6 weeks ago from the same upstream codebase. Since then we built a coherent **RVF-first storage architecture** (~70 commits) backed by a **unified config chain** (~40 commits), wired through a **composition-aware controller registry** (~50 commits) — none of which exists upstream. Upstream took a different direction: **dual SQLite+RVF coexistence** with stub-orphaned subsystem code in `swarm/src/`, plus a massive **"honesty audit" wave** removing fake metrics from existing surfaces. The two fork directions are **complementary at the bug-fix layer** (~15 of our acceptance fork-side commits absorb cleanly with upstream's validation expansion) but **architecturally divergent at the storage / config / controller-registry layer** (~95% of our work has no upstream parallel). That's why the redundancy audit found only ~2% genuinely upstream-redundant — most of our work is in spaces upstream simply doesn't operate in.

## Conflict zones (ruflo hive-mind cluster)

5 hunks across 4 files, ~60-80 min hand-merge total:

| Severity | File | Hunks | Resolution shape | Time |
|---|---|---|---|---|
| Critical | `hive-mind-tools.ts` `hive-mind_memory` set/delete | 2 | Take upstream body (AgentDB sidecar from `04d6a9a0a` + real consensus from `6992d5f67`), wrap in `withHiveStoreLock(async () => { ... })`. Move silent `bridge.bridgeStoreEntry` outside the lock; replace `catch { /* AgentDB not available */ }` with **loud** `catch (err) { console.error('[hive-mind_memory] AgentDB sidecar failed:', err); }` per `feedback-no-fallbacks.md`. **NOTE — corrected 2026-04-29 post-W2/W3**: the earlier "validation + AgentDB sidecar + real consensus" tri-fold conflated three letters. Validation arrives in letter D (`dc2abef2a` introduces `validate-input.ts`, `a101c2a08` calls it from this handler — that's a separate hand-merge with its own 60-85 min budget). Sidecar + consensus arrive in letter E. Also corrected: "HNSW vector cleanup goes INSIDE the lock" does NOT apply here — that cleanup is in `memory-tools.ts memory_delete` (letter D), not `hive-mind-tools.ts hive-mind_memory delete`. | 30-45 min for the sidecar-into-lock + loud-catch composition |
| High | `commands/hive-mind.ts` line-157 spawn prompt | 1 | `0590bf29c` rebranded `mcp__claude-flow__*` → `mcp__ruflo__*` in same prompt block. Take rebranded text as base, layer our Task-tool restoration + WORKER COORDINATION CONTRACT on top. Verify all `mcp__ruflo__*` references. | 10-15 min |
| Medium | `parser.ts` globalOptions table | 1 | `01070ede8` (Tier A blockers) restructured the same `globalOptions` block. Keep our `non-interactive` entry inside upstream's restructured array; preserve upstream's `lazyCommandNames` registry + `sawFirstPositional`. | 5-10 min |
| Trivial | `hive-mind-tools.ts` import block | 1 | Merged import block keeping upstream's new validation imports + our expanded `node:fs` imports. | 3 min |
| Trivial | `hive-mind-tools.ts` `saveHiveState` body | 1 | Our atomic tmp+rename version wins (strict superset). | 3 min |
| None | `init/mcp-generator.ts` | 0 | Zero upstream commits — pure additive merge. | 0 |

**Strategy:** `git merge --strategy=ort --strategy-option=patience`, with `git config rerere.enabled true` set first. **Do NOT cherry-pick** — would re-enter the `hive-mind_memory` conflict 4 times (each of `0590bf29c`, `04d6a9a0a`, `6992d5f67`, `a101c2a08` touches the same handlers).

## Cross-fork merge order

Topologically required (codemod renames `@ruvector/*` → `@sparkleideas/ruvector-*`; ruflo's ADR-086/087 imports `@ruvector/{ruvllm, graph-node}`; if ruvector hasn't merged its 2318 upstream commits, ruflo gets stale runtime).

### 1. ruvector first

Required publishes before ruflo can build:

- `@sparkleideas/ruvector-graph-node` (+ 5 platform binaries: darwin-arm64, darwin-x64, linux-x64-gnu, linux-arm64-gnu, win32-x64-msvc) — needed by `7eb505d22` (ADR-086/087)
- `@sparkleideas/ruvector-ruvllm` (+ 5 platform binaries) — needed by `7eb505d22` and `bf23566f0`
- `@sparkleideas/ruvector-rabitq-wasm` — needed by `ca4d1f0a4`/`911bd4e94` (RaBitQ). **No special sequencing**: RaBitQ landed on upstream main via PR #370 (2026-04-23, foundation crate `ruvector-rabitq`) + PR #394 (2026-04-26, squash-merge of `ce1afecb` adding `crates/ruvector-rabitq-wasm` + `npm/packages/rabitq-wasm/` + ADR-161). Comes along on the normal step-2 ruvector upstream sync; pipeline runs `crates/ruvector-rabitq-wasm/build.sh` (wasm-pack on demand for web/nodejs/bundler targets); codemod renames; publish under `@sparkleideas/ruvector-rabitq-wasm`. Earlier draft framed this as requiring an upstream-WIP-branch merge — corrected per R15 reframe.

Acceptance gate: `npm run test:acceptance:ruvector` passes against a fresh init'd project. Specifically verify `GraphDatabase.open()` storage hydration (sparkling commit `d8ba8b03`) and `MATCH (n) RETURN n` no-label branch (sparkling commit `5bc11872`) survive merge with upstream. Embedding pipeline still 768-dim (`reference-embedding-model.md`).

### 2. ruflo second

Once `@sparkleideas/ruvector-*@latest` is verified, merge ruflo HEAD's 130 commits.

Recommended merge order *within* the ruflo wave (lowest risk first):

```
A. Test infrastructure
   5151aa9b2  monorepo-wide test fixes — all 20 packages green (5,370 tests)
   d7e05b443  commands-deep test for PERF-03 lazy loading

B. ESM/CJS hardening
   eb4f251b6  17 bare require() in ESM modules
   01070ede8  Tier A blockers (parser, validation) [conflicts §1]

C. Daemon/session P0 user-blockers
   f43d5dca3  CLI hang cluster + session crashes (6 issues)
   5c5ede94b  cwd/intelligence-hang/memory-init
   bff8a34af  ReasoningBank/SQLite-path/namespace
   5a5bfa6a6  P0 daemon startup
   100ffeaa3  CPU-proportional maxCpuLoad

D. Validation + honest metrics (ADR-085, ADR-092)
   dc2abef2a  validate-input.ts foundation
   a101c2a08  comprehensive #1425 remediation [touches §5 handlers]
   39c3ffe96  6 MCP tool validation bugfixes
   43edb691a  ConfigFileManager (atomic writes, Zod-ready validation surface) + 22 stub CLI commands; ADR-0110 enum validators layer on top
   ff3228613  README honesty audit [conflicts ADR-0101]
   0752e5963 / 1409db9bc / d3da4b676 / a2e2def04 / 398f7c2dc  honest metrics

E. Hive-mind cluster (the conflict zone)
   8c4cecfb1  v3.5.43 — 9 issues + 22 stubs [introduces #1422 block we revert]
   0590bf29c  v3.5.42 — #1390/1391/1392 [conflicts §6 line-157]
   66cd6cbbc  hive-mind_status reads real agent state
   04d6a9a0a  feature gaps + AgentDB sidecar [conflicts §5; bridge call must move outside lock]
   6992d5f67  v3.5.22 — 22 stub features (real BFT/Raft/Quorum JSON-tally improvements; layer on top of ADR-0106 Option A `ConsensusEngine` wire-up)
   e50df6722  critical security & perf [closes Q4]

F. PERF-03 + native backends (ADR-086/087)
   e0d4703eb  ruvector WASM integration foundation
   47a91581e  WASM optionalDeps + README gap analysis
   (e50df6722 merged once in group E — PERF-03 + HIGH-02 both ship in that single commit; do not list/merge twice)
   7eb505d22  native ruvllm + graph-node intelligence backends [requires ruvector publishes]
   bf23566f0  saveCheckpoint JS-fallback guard
   01c764f6f  microlora 768-dim padding
   ca4d1f0a4  RaBitQ 1-bit quantized search [resolves at npm install once step 2's ruvector sync publishes @sparkleideas/ruvector-rabitq-wasm; ruflo runtime is dynamic-import + try/catch with graceful BM25/HNSW fallback — soft at runtime, hard only at install time per R15 reframe]
   911bd4e94  browser fixes + RaBitQ bridge alignment [same resolution path as ca4d1f0a4]

G. Plugins & marketplace
   81418649c  19 Claude Code native plugins [HUGE: 130 files, README→stub, marketplace.json rewrite]
   851f3ed4c  ruflo-goals plugin
   bd280a79b  expand ruflo-goals agent docs
   c091ea628  $ARGUMENTS for goals command
   f3cc99d8b  CRIT-02 plugin sandboxing [namespace gate must be codemod'd]
   23090ddbe  transfer_plugin-search null guard
   0ced9bf85  plugin creator template fix
   2287d8b61  guidance MCP tools (5 new — discovery)
   9fc61ea1c  getProjectCwd for guidance_discover [donate-back candidate; ADR-0100 covers 15 tools more broadly — do not regress]
   4609a4917  agent/skill YAML frontmatter standardization

H. Misc small fixes (low-risk, last)
   5fdd8e19e  PluginManager priority/version
   dc7957cf4  hooks package type export paths
   8e51bd54d  TS2307 codex import guard
   b1b615aae  YAML-safe agent template frontmatter
   6fb7a9e69  AIDefence regex relaxation
   a0ef36cbb  auto-regenerate statusline on older installs [PRE-FLIGHT BLOCKING: move our .claude/helpers/statusline.cjs patch into fork source per R9 BEFORE this commit lands; otherwise the regenerator overwrites our overlay on first user upgrade]
   8824fe3c4  Tier A+B 13-issue cluster

I. Fork-side hand-conflicts (rebase guidance — these are OUR commits, not upstream; they must survive the rebase intact)
   0cd9c4a39  13-axis init port — **NO ACTUAL CONFLICT (corrected 2026-04-29 post-W3)**. Paths are fully disjoint: our commit touches 6 TypeScript files in `v3/@claude-flow/cli/src/{commands,init}/`; upstream's `81418649c` 19-plugin marketplace touches 130 files in `plugins/`/`.claude-plugin/`/`.github/`/`docs/`. The earlier "yaml→md collision" framing conflated SG-008 `config.yaml`→`config.json` (runtime config, our concern) with upstream's `_config.yml` (Jekyll docs storefront, unrelated). Three-way merge composes cleanly in any order. ~5 min verification.
   5b7cefaea  memory-bridge controller wiring → memory-bridge.ts is upstream-deleted-by-us per ADR-0086; resolve `deleted-by-us/modified-by-them` as keep-our-deletion; controller wiring already migrated to memory-router.ts
   f46a104b0  controller-registry P2-B/C + P5-C — **CORRECTED 2026-04-29 post-W3**: `controller-registry.ts` is NOT fork-only. Originated upstream as `bfef01821` (ADR-053). Zero textual overlap expected: our edits at lines 65/161/519/633 (CLIControllerName union, INIT_LEVELS Level 1, isControllerEnabled core-intelligence default-on group, factory `case 'solverBandit'`); upstream's window touches at line ~747 (ReasoningBank embedder param via `bff8a34af`) + minor ESM `import('node:path')` (`5a5bfa6a6`). Recipe: preserve fork's solverBandit registration + attestationLog wiring + 3 bridge wrappers; let 3-way merge layer upstream's ReasoningBank embedder param + ESM fix on top. ~8 min. Per ADR-0107/0108/0109 (W5 reconciliation), wiring upstream's `TopologyManager`/`QueenCoordinator`/`ConsensusEngine` into the registry is W5 work, not part of this merge.
   a3b3d7797  worker-daemon `maxCpuLoad: 28.0` → adopt upstream's `100ffeaa3` proportional formula `Math.max(cpuCount * 0.8, 2.0)`; on a 16-core M5 Max this yields 12.8, not 28; document as a fork-config override IF intentional, otherwise drop our 28.0 override
   6 RVF backend commits in ADR-0090 → collide with upstream `8824fe3c4` persistQueue; compose (queue inside our lock); see §Pattern 1 row 10
   ADR-0085 deletion conflicts (~15 commits across 4 deleted files) → **REVISED 2026-04-30 post-orphan-audit**: mechanical merge resolution is `git rm` (all `deleted-by-us/modified-by-them` cases). Per-commit semantic verdicts from the W4-prep orphan-deletion audit (see §Implementation Log entry):
       - **2 pre-resolved by W1.5 + W1.6**: `911bd4e94` (`bridgeGetAllEmbeddings` → `routerGetAllEmbeddings`); `8824fe3c4` (`vectorBackend: 'auto'` → `'ruvector'`, stricter)
       - **8 absorbed**: `ca4d1f0a4` (RVF atomic store + BM25 fallback in router); `0752e5963` (`Xenova/all-mpnet-base-v2` default at router:449); `bff8a34af` (namespace `'all'` default at memory-tools:289 + dual-method dispatch); `5a5bfa6a6` (dual-method dispatch at router:1426-1444 + static `import * as path from 'node:path'`); `c07ff8f48` (RVF atomic delete + HNSW); `e0d4703eb` (ruvector ONNX fallback in EmbeddingPipeline); `6992d5f67` (RVF surgical HNSW remove)
       - **4 n/a (bug class structurally absent)**: `39c3ffe96` (null-embedder race fails-loud at construction); `04d6a9a0a` (TypeScript-only patch); `75fe9f564` (sql.js path deleted with memory-initializer); `5151aa9b2` hybrid-backend.test.ts portion (hybrid-backend abstraction gone)
       - **1 port-required (W1.7)**: `e50df6722` `safeJsonParse` for prototype-pollution defense at `agentdb-backend.ts:955-963`. Upstream applied this to `sqljs-backend.ts` (deleted on our fork) but the same vulnerability class exists in our AgentDB SQLite path
       - **1 absorbed (closed 2026-04-30)**: `656d404b2` LocalReasoningBank registry-fallback semantics — investigated post-orphan-audit. Verdict: **absorbed, high confidence**. AgentDB unconditionally constructs `ReasoningBank` (`AgentDB.ts:207`) and `LearningSystem` (`AgentDB.ts:216`) during `initialize()`; `getController('reasoningBank' | 'learningSystem')` (`AgentDB.ts:262-272`) is a dead-simple field return with no lazy-load and no null-able path. Under Model 1 (W1.5/W1.6), a successfully-initialized AgentDB guarantees non-null returns; failure throws `AgentDBInitError` at construction (no silent half-init). Upstream's `656d404b2` fallback covered a pre-Model-1 partial-init state that is structurally unreachable in our fork. Soft future-proofing note: receiver-side null handling at `memory-router.ts:1372, 1434` (routePatternOp) is silent-fallthrough; since null is unreachable, no observable difference, but a hardening pass could add `if (!reasoningBank) throw new AgentDBInitError(...)` to catch future version-mismatch regressions.
       
       **Earlier "all 9 → keep-our-deletion" framing was directionally correct but elided the per-commit semantic question** ("did our deletion + replacement absorb the upstream fix, or did we lose it?"). The audit found 1 real port-required item that the blanket policy would have missed. Future merge waves should run the same audit shape rather than defaulting to the blanket policy.
   2 squash-pre-merge pairs → **DROPPED 2026-04-30** per memory `feedback-no-history-squash.md` (R16 closed). Both pairs (`de14ffe4d`+`9f44022ed` SG-004, `2c311d36e`+`67f143f8e` DM-001) stay as-is in history. W4 rebase replays both commits per pair; minor noise accepted. No force-push to `sparkling/main`.
```

Acceptance gate: `npm run test:unit && npm run test:acceptance` (full cascade); `lib/acceptance-adr0104-checks.sh` end-to-end (every section has explicit assertions; failures surface in <1 minute); manual smoke for live hive after merge.

### 3. agentic-flow + ruv-FANN — bookkeeping

0 upstream commits each. Republish at the new `-patch.N` for cross-package version alignment (per `reference-fork-workflow.md`'s 41-package pinning). `npm run test:unit` per fork as gate.

## Ruvector breaking changes catalog

Most painful changes when consuming ruvector's 2318 commits. The ~510 NAPI bot-commit deltas rebase as empty diffs once `cargo build` regenerates the native bindings on our side — these are pre-built artifacts (auto-generated `.node` binaries + their checksums), not source features.

| SHA | Change | Severity | Migration |
|---|---|---|---|
| `96590a1d` | Workspace `0.1.32 → 2.0.0` jump | high | Re-pin all internal `@sparkleideas/ruvector-*` deps to `2.x` `-patch.N`; bump every fork that consumes ruvector |
| `f7345eef` + `1fd3906a` | Rust MSRV → 1.92+ (edition 2024) | high | Pin `rust-toolchain.toml` to `stable` ≥1.92; update preflight; CI matrix bump |
| `5a2c6355` | Node engines → `>=20` | medium | Bump `engines.node` in published `@sparkleideas/ruvector*` package.json templates |
| `e4e2aa80` | `MultiHeadAttention::new()` and `RuvectorLayer::new()` return `Result` instead of `Self` | medium | Mechanical `?` insertion at every callsite; 11 files in this single commit |
| `9e08b74c` | New `PropertyValue::FloatArray` variant; `enum PropertyValue` not `#[non_exhaustive]` | medium | Add `_ => …` arms in fork-patch matches; persisted graph stores are one-way migrations once a `FloatArray` is written |
| `e359e532` + `f297c34c` | Router default-storage-path: `None` now allocates per-PID tempfile (was error/shared) | medium | Audit `RouterVectorDB::new()` callers; supply explicit path if persistence is wanted; drop local score-inversion workarounds |
| `0989957d` + `668c873e` | Workspace-version migration (path deps now require `version =` field) | medium | Codemod must learn workspace-version idiom; every internal `@sparkleideas/ruvector-*` path dep gets matching `-patch.N` |
| `f4a6aae5` | New **opt-in** `onnx-embeddings` feature flag (not added to defaults) — adds `OnnxEmbedding` for real semantic embeddings (#265) | medium | When ruflo enables `onnx-embeddings` for `@sparkleideas/ruvector-core` consumers, ensure the feature is enumerated in our cargo feature manifest. WASM build paths still set `default-features = false`; explicitly list `simd`, `storage`, `hnsw` if needed |
| `f16530dc` | `VectorDB::insert_batch(impl AsRef<[VectorEntry]>)` (was `Vec<VectorEntry>`) | low | Source-compatible for owned `Vec`; type-erased callers may need annotation |
| `24d92f23` | Workspace `2.1.0 → 2.2.0`; sona `0.1.9 → 0.2.0` | low | Adopt; re-baselines `-patch.N` versioning across all `@sparkleideas/ruvector-*` packages (mechanical cascade through `npm run fork-version`) |
| 26 → 171 crates / 7 → 84 npm packages | Crate sprawl (rabitq, rulake, rvm, kalshi, consciousness, decompiler, diskann, cnn, delta, cluster, cognitum-gate, …) | high (mechanical) | **Publish all 171 crates** as `@sparkleideas/*` (per `feedback-no-value-judgements-on-features.md` — wire ALL features). Codemod handles ~165 additional package renames mechanically (existing prefix-mapping rule covers them; verify per `scripts/test-codemod-acceptance.mjs` before publish). `-patch.N` versioning extends to all 171 — `npm run fork-version` already handles workspace-wide version stamping. Real cost: pipeline wall-time grows with package count (each `npm publish` is ~2-5s); acceptance must cover the new surface. Not a value-judgement to skip; just additional mechanical work. |
| `42d869a1` + `96d8fdc1` | 645 + 429 files reformatted across two commits (rustfmt + cargo fmt) | low | Mechanical conflicts; resolve `git checkout --theirs` then `cargo fmt` of our patches |

## SONA / reasoning_bank — already on fork main

5 upstream sona commits we don't have yet. **No threshold re-tuning** (already on fork main via fork-side mirrored commits `a697632b` SSE-grace + `72e5ab60` AGI self-optimization — earlier draft cited the upstream-only originals `158a6803` + `1b8d9bf9` which return zero hits on `git branch --contains` against fork main):

- `2d0ce8bd` MicroLoRA `set_weights` — additive, take it
- `100fd8bb` adds per-crate `[lints.rust]` blocks (243 files, 24,408 insertions) — **adopt non-conflictingly**. Earlier draft claimed our `42901a78` "deliberately deleted the `[lints.rust]` block"; this was wrong — `42901a78` touches rvf-node/sona NAPI packaging + `.npmignore` and does not modify any `[lints]` block. Fork has no workspace-level `[lints.rust]`; upstream's `100fd8bb` adds per-crate ones non-conflictingly. The only fork file with an existing `[lints.rust]` block is `crates/ruvllm/Cargo.toml:278`; check whether `100fd8bb` adds a duplicate there during merge
- `24d92f23` workspace `2.1.0 → 2.2.0` bump — adopt; cascades into our `-patch.N` versioning (all `@sparkleideas/ruvector-*` packages re-baseline from `0.1.x-patch.N` to `2.x-patch.N` at the next pipeline run). Sequencing: applies as part of step 2 of §Cross-fork merge order
- `96d8fdc1` cargo fmt — apply, reverify thresholds untouched
- `fcebbd89` sona 0.1.9 doc bump — already done on our side via mirrored commit; rebases as empty diff (mechanical, not a feature skip)

## RVF / WAL / consensus — stable

**Format breaks: NONE** across 2318 commits. RVFS magic + 64-byte segment header layout stable; all changes additive (new `SegmentType` discriminants in unused slots). Existing `.swarm/memory.rvf` files load on any newer rvlite. Forward-compat enforced by `unknown_segment_preservation.rs`.

**ADR-0104 §5 lock — no collision** with rvlite. ruflo's `withHiveStoreLock` protects JSON via NodeJS; rvlite's `WriterLease` protects `.rvf` via Rust; different files, different processes, **same primitive design** (O_EXCL + PID + stale recovery). Compatible by construction.

**Pull `7c5acced` (macOS errno fix)** — without it rvlite cannot link on M5 Max. Trivial merge.

For future ADR-0106 cross-hive evolution: `6db89867` (`ruvector-delta-consensus` CRDT crate) and `6990be76` (rvf-federation Byzantine-tolerant aggregation) are ready-made primitives.

## Risk register

| # | Risk | Mitigation |
|---|---|---|
| R1 | ruvector RVF format break propagates to ruflo memory subsystem | Format scout confirms zero breaks. Gate ruflo merge on `npm run test:acceptance:ruvector` P4-WASM + P5-RuVLLM |
| R2 | ADR-086 SonaCoordinator API drift across 2318 ruvector commits | Pin ruvllm to version validated in upstream's API testing table; integration check before promoting `@sparkleideas/ruvector-ruvllm@latest` |
| R3 | ADR-087 graph-node bindings broken on a platform | Verify all 5 platform-binary packages publish; sparkling has `d8ba8b03` (storage hydration fix) |
| R4 | ADR-085 dedup interferes with RVF-primary | Integration test for "session-start with 5,706 entries → ~20 unique" against an RVF-backed init'd project |
| R5 | Hive-mind merge conflicts (ADR-0104 hot zone, 5 hunks) | Detailed in §Conflict zones above; ~60-80 min hand-merge with `--strategy=ort --strategy-option=patience` + `rerere` |
| R6 | Versioning skew if forks not merged together | Include all 4 forks in wave; bump `-patch.N` baseline coherently |
| R7 | ADR-088 hybrid/full benchmark unexpectedly invokes Anthropic API in a CI run that lacks `ANTHROPIC_API_KEY` | All 4 LongMemEval modes wired (per `feedback-no-value-judgements-on-features.md`); default acceptance runs raw mode only (gate-free, HNSW-only). Hybrid/full check for `ANTHROPIC_API_KEY` env var; if absent, exit 0 with `[INFO] Skipped: hybrid mode requires ANTHROPIC_API_KEY (this is a benchmark mode, not a ruflo runtime requirement)`. The gate is user-controlled (set the env var to run), not ruflo-controlled (the modes are wired and shipped). |
| R8 | Codemod misses new `@ruvector/{ruvllm, graph-node, rabitq-wasm}` imports | Codemod scout confirmed prefix mapping handles all; add unit test in `tests/pipeline/codemod.test.mjs` for the literal strings |
| R9 | Statusline regenerator (`a0ef36cbb`) overwrites our `.claude/helpers/statusline.cjs` patch | Move statusline patch into fork source per `feedback-patches-in-fork.md` *before* pulling this commit |
| R10 | Plugin sandbox namespace gate (`@claude-flow/` literal) breaks "official" trust under our scope rename | **Codemod-rewrite portion: closed 2026-04-30** — existing global `SCOPED_RE = /@claude-flow\//g` text-replace rule at `scripts/codemod.mjs:178` already auto-rewrites the literal to `@sparkleideas/` (verified via inspection 2026-04-30; not AST-aware, applies to literals in code as well as imports). Test coverage locked in via `62a357e` (`tests/pipeline/codemod.test.mjs`: `transforms @claude-flow/ literal in non-import contexts`). **Acceptance-test portion: deferred to W4 letter G execution** per W2 letter G recipe — when `f3cc99d8b` merges, the executor adds the fixture plugin (`name: '@sparkleideas/test-plugin'`, `trustLevel: 'official'`) + capability-access assertion to `lib/acceptance-*.sh`. Pre-W4 work cannot test against absent code. |
| R11 | 384d MiniLM fallback embedder (`e0d4703eb`) conflicts with our 768-dim mpnet decision | Drop the 384d wiring on merge OR make embedding-dim configurable end-to-end. Upstream's `01c764f6f` 768-pad confirms 768 is canonical for SONA/MicroLoRA |
| R12 | 26 → 171 ruvector crates: publish-scope explosion | Decide before merging: keep current 26-crate set vs whitelist new crates vs mirror all 171. Decision: mirror all 171 per `feedback-no-value-judgements-on-features.md`. Affects `-patch.N` pinning surface area |
| R13 | 5 bare `process.cwd()` sites in `memory-router.ts` (lines 204, 209, 273, 312, 316) replicate the cwd-churn bug class upstream's `bff8a34af`/`5c5ede94b` patched | Pre-flight item (§Decision plan step 1); replace with `findProjectRoot()` before merge starts. Acceptance check: `memory store` from `CWD=/` writes to same `.rvf` as inside init'd project |
| R14 | Orphaned-deletion hazard (16 of 125 deleted files have upstream activity in window) — `git merge` keeps our deletion; upstream fixes silently disappear | §Deleted-file orphans audit completed; 12 of 16 are aligned (yaml→md direction); 4 substantive memory files audited per R13. Add `scripts/sync-upstream` build-time check that lists `deleted-by-us` files where upstream modified the file in the merge window (§Cross-cutting orphan-handling action items #3) |
| R15 | ~~RaBitQ commits `ca4d1f0a4` / `911bd4e94` blocked on `@sparkleideas/ruvector-rabitq-wasm` publish from upstream branch `feat/wasm-packages-rabitq-acorn` (commit `ce1afecb`)~~ — **REFRAMED 2026-04-29 post-W1**: RaBitQ is **already in upstream main** (PR #370 merged the foundation crate `ruvector-rabitq` 2026-04-23; PR #394 squash-merged `ce1afecb` adding `crates/ruvector-rabitq-wasm` + `npm/packages/rabitq-wasm/` + ADR-161 to `origin/main` 2026-04-26). It's not "an upstream WIP feature branch we have to pre-empt" — it's a feature that landed in upstream main and rides the normal sync in §Decision plan step 2 (ruvector merge). Additionally, ruflo's runtime imports are all dynamic `await import()` inside try/catch with graceful BM25/HNSW fallback; the only hard requirement is `npm install` resolving `@sparkleideas/ruvector-rabitq-wasm`, which is satisfied as soon as we sync upstream + build + codemod + publish. **No special handling required.** | Standard step 2 (ruvector full upstream sync): rabitq comes along; pipeline runs `crates/ruvector-rabitq-wasm/build.sh` (wasm-pack on demand); codemod renames; publish `@sparkleideas/ruvector-rabitq-wasm@0.1.0-patch.N`. ruflo group F's `ca4d1f0a4` + `911bd4e94` then resolve cleanly at `npm install`. Optional Path B: also pull the 5 extra commits on `feat/wasm-packages-rabitq-acorn` (5 ahead, 15 behind upstream main, **0 conflicts vs origin/main** per agent-3 dry-merge — earlier W1 preflight reported 1016 conflicts because it ran the dry-merge against our 200+-commit-stale fork main, not against upstream main). |
| R16 | ~~2 squash-pre-merge pairs are pre-existing fork-history nonsense that creates needless conflict noise on rebase~~ — **CLOSED 2026-04-30 per memory `feedback-no-history-squash.md`**: do not squash. Squashing rewrites history and risks data loss; clean fork history is not a project goal. Carefully merge instead. Both pairs (`de14ffe4d`+`9f44022ed` SG-004, `2c311d36e`+`67f143f8e` DM-001) stay in history as-is. Any rebase noise during W4 from replaying the pairs is acceptable. | None — keep both pairs in history; let W4 rebase replay both commits per pair. No force-push to `sparkling/main`. |
| R17 | ~~Our `a3b3d7797` `maxCpuLoad: 28.0` collides with upstream `100ffeaa3` proportional formula~~ — **CORRECTED 2026-04-29 post-W3**: `worker-daemon.ts` already merged the upstream formula correctly on `merge/upstream-2026-04-29` (lines 159-160 `Math.max(cpuCount * 0.8, 2.0)`, 16-core M5 Max yields 12.8 — cgroup-aware). The surviving `28.0` is in **`v3/@claude-flow/cli/src/init/config-template.ts:256`** (init template). Resolution: drop the `maxCpuLoad: 28` literal from `config-template.ts:256` and the `maxCpuLoad` key from the init template's `daemon.resourceThresholds` block. Result: init no longer writes a Hetzner-tuned override into every fresh `.claude-flow/config.json`; runtime uses upstream's smart formula. The other 9 patches in `a3b3d7797` (HW-001..004, DM-001/003/004/006, WM-108) are NOT upstream-redundant and survive unchanged. Verdict on `28.0`: accidental Hetzner-32-thread sympathetic value (no load-test commit; contradicts our own `72e7305eb` portability policy). | Drop the literal in `config-template.ts:256`; add inline comment that 32+ thread servers can override via `daemon.resourceThresholds.maxCpuLoad` in user `.claude-flow/config.json` (priority chain at `worker-daemon.ts:177`). ~5 min. |
| R18 | `5b7cefaea` (memory-bridge controller wiring) + `f46a104b0` (controller-registry P2-B/C + P5-C) hand-conflict during rebase | §Cross-fork merge order group I documents the resolution per commit. `rerere` will speed up the second pass if any retry is needed |

## Decision: recommended merge plan

Execute as a **single coordinated wave** across the 4 forks, gated at each phase:

1. **Pre-flight**:
   - Ruvector publish-scope (R12): **publish all 171 upstream crates as `@sparkleideas/*`** (per `feedback-no-value-judgements-on-features.md` — wire ALL features). Codemod handles the mechanical renames; pipeline wall-time grows with package count but the work is mechanical, not architectural. The earlier "whitelist + defer rest" wording was a value judgement to skip; corrected.
   - Bump Rust toolchain to `stable` ≥1.92 in `rust-toolchain.toml`; bump `engines.node` to `>=20`.
   - Update codemod regex tests for new `@ruvector/{ruvllm, graph-node}` imports.
   - Move `.claude/helpers/statusline.cjs` patch into fork source.
   - Ensure plugin-sandbox namespace gate codemod rule exists.
   - **Revert 3 CI/CD probe leftover commits** (`31363d5bc`, `4e253bcd7`, `f72bd028d`) on `forks/ruflo` `main` — they each append a `// pipeline-test-<ts>` / `// cicd-test-<ts>` / `// cicd-final-<ts>` comment to `v3/@claude-flow/shared/src/index.ts:196-198`. Useless post-merge; create needless 3-way conflict noise on every future merge cycle.
   - Replace 5 bare `process.cwd()` sites in `v3/@claude-flow/cli/src/memory/memory-router.ts` (lines 204, 209, 273, 312, 316) with `findProjectRoot()` (already exported from `cli/src/mcp-tools/types.ts:50`; renamed from `getProjectCwd` on 2026-04-23 per ADR-0100) — closes the same bug class upstream's `bff8a34af`/`5c5ede94b` fixed elsewhere.
   - **Enable rerere on each fork's working branch BEFORE letter-group merges start** (added 2026-04-29 post-W2 letter-E recipe): `git config rerere.enabled true && git config rerere.autoUpdate true`. Letter E's hive-mind cluster (`8c4cecfb1`/`0590bf29c`/`04d6a9a0a`/`6992d5f67` all touch `hive-mind-tools.ts` and `commands/hive-mind.ts`) requires `--strategy=ort --strategy-option=patience` with rerere; cherry-pick is forbidden per §Conflict zones to avoid re-entering the same conflict 4 times.
2. **Merge ruvector** — full source merge (no feature skips per `feedback-no-value-judgements-on-features.md`). Mechanical handling only: ~510 NAPI bot-regenerated artifacts rebase as empty diffs after `cargo build` regenerates them locally; ~16 self-superseded commits resolve as `keep-deletion` (our ADR-0085/0086 already deleted what they patched); 3 CI/CD probe leftover commits revert pre-merge per §Pre-flight. All 171 crates publish as `@sparkleideas/*` (codemod handles renames). `cargo build` clean; publish `@sparkleideas/ruvector-*` (+ platform binaries for graph-node and ruvllm) to local Verdaccio.
3. **Acceptance gate**: `npm run test:acceptance:ruvector` against fresh init'd project. Verify P4-WASM + P5-RuVLLM. Embedding pipeline 768-dim. Format compatibility.
4. **Merge ruflo** in order A → B → C → D → E → F → G → H per the lettered groups above. Group I is the fork-side rebase-conflict guide that applies *during* group A-H execution, not as a separate step. Use `--strategy=ort --strategy-option=patience` + `rerere enabled`. Hand-resolve the 5 conflict-zone hunks (§Conflict zones).
5. **Acceptance gate**: `npm run test:unit && npm run test:acceptance`; `lib/acceptance-adr0104-checks.sh` end-to-end; live smoke `npx ruflo hive-mind spawn "..."`.
6. **Merge agentic-flow + ruv-FANN** as bookkeeping (republish at new `-patch.N`); `npm run test:unit` per fork.
7. **Reconcile our ADRs** (**doc reconciliation + small validators only — heavy wire-up is ADR-0103's program; see §Closure dependency below**):
   - ADR-0103: update with cross-cutting findings + recommendation that ADR-0105/0107/0109 consume `graph-backend.ts` (ADR-087) instead of greenfielding equivalents. **Promote ADR-0103 from `Investigating` → `Accepted` so its implementation phase is unblocked.**
   - ADR-0104 Q4: closed by `e50df6722` HIGH-02 — adopt and mark resolved.
   - ADR-0106: **promote `Investigating` → `Accepted with Option A`** (full wire-up of `ConsensusEngine` + raft/gossip/byzantine into `hive-mind_consensus` MCP handler via daemon-resident pattern, per memory `feedback-no-value-judgements-on-features.md`). Upstream's `6992d5f67` JSON-tally improvements layer on top. Add CLI flag exposure (`strategy`/`term`/`quorumPreset`/`timeoutMs`) so all protocol parameters are user-addressable. Trust-model framing stays as documented context — does NOT gate wiring. **Implementation is ADR-0103 program work, not W5.**
   - ADR-0107/0108/0110: **promote `Investigating` → `Accepted`**. Extend `validate-input.ts` with `validateQueenType` / `validateWorkerType` / `validateStorageProvider` enum validators per ADR-092's domain-specific-validators-per-shape pattern. The validators are small + tied to W4 letter D's `validate-input.ts` foundation; in-scope for W5. The heavier wire-up (e.g., ADR-0107 QueenCoordinator daemon-resident advisor) is ADR-0103 program work.
   - ADR-0105: **promote `Investigating` → `Accepted with Option C`** (wire BOTH `TopologyManager` + `graph-backend.ts`). Implementation is ADR-0103 program work.
   - ADR-0109: **promote `Investigating` → `Accepted`**. Silently no-op PBFT in `byzantine.ts` confirmed; trust-model framing unchanged. The actual wiring of `byzantine.ts` is bundled with ADR-0106's ConsensusEngine wire-up under ADR-0103.
   - ADR-0110: amend with "storage-factory.ts is fork-only; upstream's `database-provider.ts` exhibits a different unreachable-branch pattern; README 'SQLite WAL' claim already deleted upstream at `70a54a7c5`".

### Closure dependency on ADR-0103

ADR-0111's lifecycle is **coupled** to ADR-0103: W5 step 7 promotes ADRs 0105/0106/0107/0109 from `Investigating` → `Accepted with Option X`, which triggers ADR-0103's implementation phase (orphan-class wire-up: ~50-80 LOC glue for TopologyManager, ~150-200 LOC for QueenCoordinator daemon-resident advisor + new `mcp__ruflo__queen_*` MCP tool surface, ~200 LOC for ConsensusEngine + raft/gossip/byzantine dispatch). Until that implementation lands, ADR-0111 leaves ADR-0103 holding mandates that are accepted-but-not-delivered.

**ADR-0111 status progression:**
- `Investigating` → `Executing` (W1 complete; in flight now)
- `Executing` → **`Awaiting ADR-0103 closure`** (W4 + W5 acceptance gates pass; ADR-0111 program work is done; ADR-0103 implementation phase begins)
- `Awaiting ADR-0103 closure` → `Implemented` (ADR-0103's orphan-class wire-up program completes; the ADRs ADR-0111 promoted to `Accepted` are now actually wired through and exercised by acceptance tests)

ADR-0103 has its own implementation waves (likely 3 verticals: TopologyManager / QueenCoordinator / ConsensusEngine). Each closes the corresponding ADR-0105/0106/0107/0109 from `Accepted` to `Implemented`. When all four are `Implemented`, ADR-0103 closes, and ADR-0111 closes via the dependency.

This explicitly avoids the failure mode where ADR-0111 declares itself "Implemented" while having shipped only ADR doc updates without the wire-up code.

## Operations

Strategies the merge plan needs but earlier drafts didn't document.

### Branch strategy

- **Working branch per fork**: `merge/upstream-2026-04-29` cut from `forks/<fork>/main` for each of `forks/{ruflo, agentic-flow, ruv-FANN, ruvector}`. All A-H + I rebase work happens on the working branch; `main` stays untouched until acceptance gates pass.
- **PR-style review**: each fork's working branch opens a PR against `forks/<fork>/main` (sparkling remote). PRs land in `ruvector → ruflo → agentic-flow → ruv-FANN` order, mirroring §Cross-fork merge order. Squash-merge to keep `main` clean; the working-branch tip is preserved as the merge-commit ancestor for forensics.
- **One branch, not many**: do not split per-letter-group (A-only branch, B-only branch, etc.) — the dependencies between groups make per-group branches more conflict-prone than helpful.

### Test-coverage gates per phase

| Phase | Gate (must pass before next phase) |
|---|---|
| After step 1 (Pre-flight) | `npm run preflight` per fork; codemod regex tests pass; statusline patch present in fork source |
| After step 2 (ruvector merge + publish) | `npm run test:acceptance:ruvector`; `cargo build --workspace`; all 5 platform binaries publish to local Verdaccio successfully |
| Within step 4 (ruflo letter-group merges) | After each letter group A-H: `npm run test:unit` (must remain green); after F: `npm run build` (TypeScript compile clean); after E: `lib/acceptance-adr0104-checks.sh` passes |
| After step 4 (ruflo full merge) | `npm run test:unit && npm run test:acceptance` full cascade; live `npx ruflo hive-mind spawn "..."` smoke test |
| After step 6 (bookkeeping) | `npm run test:unit` per fork |
| After step 7 (ADR reconciliation) | All ADR cross-references resolve; `lib/acceptance-adr0098-checks.sh` + `lib/acceptance-adr0104-checks.sh` end-to-end |

### Rollback strategy

- **Per-phase rollback**: each phase is a `git reset --hard <pre-phase-tag>` away from undoing. Tag before each phase: `pre-merge-<fork>-<phase>` (e.g., `pre-merge-ruvector-step2`, `pre-merge-ruflo-step4-E`).
- **Verdaccio rollback**: `npm unpublish <pkg>@<version>` available within 24h of publish; after that, publish a `-patch.N+1` that reverts the change (semver-discipline; never republish same version with different content).
- **If acceptance gate fails after step 4**: revert the working branch to `pre-merge-ruflo-step4-A`, re-investigate root cause, do not proceed to step 5. Do not partial-merge to `main`.
- **If a downstream fork wave hard-fails after ruvector ships**: hold ruvector at the new `2.x-patch.0` baseline; the older `0.1.x-patch.N` remains the @latest tag for `@sparkleideas/cli` consumers until ruflo's wave succeeds.

### Tag / release strategy

- **Coordinated baseline bump**: after step 4 acceptance passes, `npm run fork-version` re-baselines all 4 forks to a shared `-patch.0` against the new upstream tags (ruflo `vX.Y.Z-patch.0`, ruvector `2.2.0-patch.0`, etc.).
- **Single annotated tag per fork**: `merge-2026-04-29-upstream` annotates the merge-commit on each fork's `main`. Body of the tag references this ADR.
- **NPM dist-tag flow**: `npm run publish:fork` publishes `-patch.0` to `next` dist-tag first. After 48h soak (or earlier on explicit user signal), promote to `latest`. Document the soak window in `reference-fork-workflow.md`.

### Backwards-compatibility statement to `@sparkleideas/cli` consumers

User-visible breaking changes from this wave:

1. **Ruvector major-version bump 0.x → 2.x** — package.json `peerDependencies` and `dependencies` need re-pinning by users on direct `@sparkleideas/ruvector-*` installs. The `@sparkleideas/cli` consumer surface is insulated (we re-pin internally), but standalone users of `@sparkleideas/ruvector-core` will see the bump.
2. **Plugin sandbox + namespace gate** — community plugins that previously ran with full capability access now run sandboxed by default. Plugins with non-`@sparkleideas/`-prefixed names lose the "official" trust badge. Document in CHANGELOG with explicit migration steps (`/plugin marketplace add` semantics).
3. **`config.json` → `config.json` migration** — for users still on `config.yaml` from older builds, document the auto-migration in CHANGELOG.
4. **Node.js engines `>=20`** — users on Node 18 will see install-time warnings; previously install-time errors were lenient. Document the bump in CHANGELOG.
5. **CLI startup faster** — PERF-03 lazy loading drops 5-8s startup cost. Behavioral improvement, not a break, but worth a CHANGELOG line.

CHANGELOG entry to publish alongside the `-patch.0` baseline:

```
### Breaking changes
- @sparkleideas/ruvector-* major bump (0.x → 2.x). Re-pin if direct.
- Plugin sandbox enforced; non-@sparkleideas/ plugins lose "official" trust.
- Node.js >= 20 required.

### Improvements
- 19-plugin marketplace (Claude Code native).
- ConsensusEngine fully wired (raft/gossip/byzantine/CRDT-future).
- QueenCoordinator daemon-resident advisor.
- TopologyManager + graph-backend.ts both wired.
- LongMemEval all 4 modes wired (raw default; hybrid/full opt-in via ANTHROPIC_API_KEY).
- PERF-03 lazy-load: ~5-8s CLI startup speedup.
- 5 process.cwd() sites in memory-router.ts now use findProjectRoot().
```

### Time and parallelism

- **Estimated wall time** (sequential single-engineer baseline): step 1 ~1h, step 2 ~3-5h (ruvector compile + publish 171 crates × ~2-5s each + acceptance), step 3 ~30 min, step 4 ~6-10h (130 commits × hand-resolution + acceptance after each letter group), step 5 ~1h, step 6 ~30 min, step 7 ~2h. **Total: ~14-20h of focused work**, depending on hand-merge yield.
- **Multi-agent wall time** (per §Multi-agent execution plan): ~6-9h compressed, with prep waves running in parallel. Sequential bottlenecks remain (single working branch, ruvector-before-ruflo dependency).
- **Parallelism (sequencing constraints)**: step 2 (ruvector) and step 6 (agentic-flow + ruv-FANN bookkeeping) cannot overlap because step 6 depends on step 5's `-patch.N` baseline. Step 6's two forks (agentic-flow, ruv-FANN) CAN run in parallel between themselves. Step 4's letter groups must run strictly sequential **on the working branch** because A → H is dependency-ordered, but resolution recipes for A-H can be staged in parallel ahead of time (see §Multi-agent execution plan).

## Multi-agent execution plan

This section defines how to execute the merge wave using ruflo's swarm/hive orchestration. Per memory `reference-ruflo-architecture.md`, ruflo is the orchestrator and the local `claude` CLI is the executor — `ruflo hive-mind spawn` does `child_process.spawn('claude', ...)` against the user's Claude subscription. Per memory `feedback-no-api-keys.md`, **zero API costs**: every agent in this plan runs on the user's local subscription via the `claude` CLI.

The merge has 5 natural parallel waves. Each wave uses ruflo's hive-mind with the project's default topology (`hierarchical-mesh`, max 15 agents per `CLAUDE.md`). Workers handoff via `mcp__ruflo__hive-mind_memory` (atomic write through `withHiveStoreLock` per ADR-0104 §5). Cross-worker disputes resolve via `mcp__ruflo__hive-mind_consensus` (real BFT/Raft/Quorum tally per ADR-0106 Option A wire-up).

### Wave boundaries

| Wave | Purpose | Agent count | Topology | Parallelism | Maps to merge step |
|---|---|---|---|---|---|
| W1 | Pre-flight prep across 4 forks | 4 | mesh | full parallel | Step 1 |
| W2 | Resolution-recipe staging for ruflo letter groups | 8 | hierarchical-mesh | full parallel | Pre-step 4 (preparation) |
| W3 | Group I fork-side conflict recipe staging | 6 | mesh | full parallel | Pre-step 4 (preparation) |
| W4 | Sequential merge execution (single coordinator) | 1 + observers | hierarchical | sequential by design | Step 2 + step 4 |
| W5 | ADR reconciliation | 8 | mesh | full parallel | Step 7 |

W2 and W3 run **concurrently with W1** (recipe staging is read-only against upstream/fork state — does not touch the working branch). W4 cannot start until W1 completes (working branch needs preflight). W5 runs after W4 acceptance gates pass.

### Wave 1 — Pre-flight prep (4-agent mesh)

Spawn:

```bash
ruflo hive-mind spawn "Pre-flight prep for ADR-0111 merge wave. \
  4 workers, one per fork. Each worker reads ADR-0111 §Pre-flight \
  + §Operations, performs the items for its assigned fork, writes \
  status to mcp__ruflo__hive-mind_memory under preflight/<fork>/, \
  commits work to a 'merge/upstream-2026-04-29' working branch, \
  pushes to sparkling/<fork>." \
  --worker-types preflight-ruflo,preflight-ruvector,preflight-agentic-flow,preflight-ruv-FANN \
  --topology mesh
```

Per-worker tasks:

| Worker | Tasks | Memory keys written |
|---|---|---|
| `preflight-ruflo` | Replace 5 bare `process.cwd()` sites in `memory-router.ts` with `findProjectRoot()`; revert 3 CI/CD probe commits (`31363d5bc`, `4e253bcd7`, `f72bd028d`); move `.claude/helpers/statusline.cjs` into fork source per R9 | `preflight/ruflo/{cwd-sites, probe-revert, statusline}` |
| `preflight-ruvector` | Bump `rust-toolchain.toml` to `stable` ≥1.92; update codemod regex tests for new `@ruvector/{ruvllm, graph-node, rabitq-wasm}` imports; verify `feat/wasm-packages-rabitq-acorn` is mergeable | `preflight/ruvector/{rust-bump, codemod-regex, rabitq-branch}` |
| `preflight-agentic-flow` | Bump `engines.node` to `>=20`; verify `-patch.N` baseline syncs with new ruvector; bookkeeping-only sanity check | `preflight/agentic-flow/{engine-bump, baseline-sync}` |
| `preflight-ruv-FANN` | Bump `engines.node` to `>=20`; bookkeeping sanity check. ~~Squash 2 fork-side pre-merge pairs~~ — squash dropped 2026-04-30 (R16 closed per memory `feedback-no-history-squash.md`). | `preflight/ruv-FANN/{engine-bump}` |

**Wave gate**: all 4 workers report `done` to `preflight/<fork>/status` before W4 begins. Queen aggregates via consensus check (`hive-mind_consensus({strategy: 'quorum', preset: 'unanimous'})`).

### Wave 2 — Resolution-recipe staging for ruflo groups A-H (8-agent hierarchical-mesh)

Read-only against upstream + fork; produces per-group resolution recipes in memory. Runs in parallel with W1.

Spawn:

```bash
ruflo hive-mind spawn "Stage resolution recipes for ruflo letter groups A-H. \
  Each worker reads ADR-0111 §Cross-fork merge order step 2 for its assigned letter, \
  pulls the upstream commits, dry-runs the merge against forks/ruflo/main, \
  documents the conflict shape + resolution per commit, writes to \
  mcp__ruflo__hive-mind_memory under recipes/<letter>/<commit>/. \
  Do NOT modify any working branch — recipes only." \
  --worker-types group-A,group-B,group-C,group-D,group-E,group-F,group-G,group-H \
  --topology hierarchical-mesh
```

Per-worker output schema (memory key per commit):

```json
{
  "commit": "0590bf29c",
  "letter": "E",
  "files_touched": ["v3/@claude-flow/cli/src/commands/hive-mind.ts"],
  "conflict_shape": "rebrand-vs-our-task-tool-restoration",
  "resolution": "Take rebranded text as base, layer our Task-tool restoration + WORKER COORDINATION CONTRACT on top. Verify all mcp__ruflo__* references.",
  "estimated_minutes": 12,
  "rerere_compatible": true,
  "blockers": null
}
```

**Wave gate**: 130 recipe entries (one per upstream commit) present in `recipes/` namespace; W4 coordinator reads them as the merge script.

### Wave 3 — Group I fork-side conflict recipe staging (6-agent mesh)

Same pattern as W2, but for our own commits that hand-conflict on rebase. Runs in parallel with W1, W2.

Workers: `conflict-0cd9c4a39`, `conflict-5b7cefaea`, `conflict-f46a104b0`, `conflict-a3b3d7797`, `conflict-rvf-cluster`, `conflict-adr0085-deletions`.

Output keys: `conflicts/<commit-or-cluster>/recipe.json`.

**Wave gate**: 6 recipes complete; W4 reads them in interleaved order with W2 recipes (per Group I instruction: applied during A-H execution, not as a separate step).

### Wave 4 — Sequential merge execution (1 coordinator, multiple observers)

W4 is **NOT parallel** — the working branch is single-threaded. But the coordinator agent spawns observer workers who tail acceptance gates in parallel.

Spawn:

```bash
ruflo hive-mind spawn "Execute the ADR-0111 merge wave on working branches. \
  Read recipes from mcp__ruflo__hive-mind_memory recipes/* and conflicts/*. \
  Apply in order: ruvector first, then ruflo letter groups A-H, then \
  agentic-flow + ruv-FANN bookkeeping. Run acceptance gates between phases. \
  Halt and consult user on any recipe failure (do not improvise resolution \
  beyond what's in the recipe)." \
  --worker-types merge-coordinator,acceptance-watcher-unit,acceptance-watcher-pipeline,acceptance-watcher-acceptance \
  --topology hierarchical
```

Roles:

- **`merge-coordinator`** (Queen-launched, prompt-driven) — applies recipes serially. Single point of write to working branches. Uses `git config rerere.enabled true` + `--strategy=ort --strategy-option=patience`. After each letter group, signals acceptance watchers via `merge-status/letter/<X>=ready-for-test`.
- **`acceptance-watcher-unit`** — observes `npm run test:unit` after each letter group; writes status to `merge-status/letter/<X>/unit-tests`.
- **`acceptance-watcher-pipeline`** — observes pipeline tests; writes to `merge-status/letter/<X>/pipeline-tests`.
- **`acceptance-watcher-acceptance`** — observes `npm run test:acceptance` after step 4 completes; writes to `merge-status/post-step4/acceptance`.

If any acceptance watcher reports `fail`, the coordinator halts and surfaces the failure to the user via the live `claude` session output.

### Wave 5 — ADR reconciliation (8-agent mesh) — **doc + small validators only**

Runs after W4 acceptance gates pass. **Scope: doc reconciliation + the small `validate-input.ts` enum-validator extensions for ADR-0107/0108/0110**. The heavier orphan-class wire-up (TopologyManager / QueenCoordinator / ConsensusEngine) is **out of W5 scope** — it is ADR-0103's program, which begins after W5 promotes the orphan-related ADRs (0105/0106/0107/0109) to `Accepted`. See §Closure dependency on ADR-0103 in §Decision plan step 7.

Spawn:

```bash
ruflo hive-mind spawn "Reconcile our ADRs per ADR-0111 §Decision plan step 7 — \
  doc + small validators only; ADR-0103 owns wire-up implementation. \
  8 workers, one per affected ADR. Each worker reads the ADR's current state, \
  reads the §Updates required entries in ADR-0111 for its ADR, applies the \
  edits (incl. flipping Investigating → Accepted with explicit option choice), \
  runs the relevant lib/acceptance-adrXXXX-checks.sh, commits to the \
  working branch. Output diff to mcp__ruflo__hive-mind_memory adrs/<adr>/diff. \
  Do NOT implement the orphan-class wire-up — that is ADR-0103's program work." \
  --worker-types adr-0103,adr-0104,adr-0105,adr-0106,adr-0107,adr-0108,adr-0109,adr-0110 \
  --topology mesh
```

Per-worker scope (matches §Decision plan step 7):

| Worker | Scope |
|---|---|
| `adr-0103` | Update §Investigation progress with cross-cutting findings + graph-backend.ts consumption recommendation |
| `adr-0104` | Mark Q4 closed; reference upstream `e50df6722` HIGH-02 |
| `adr-0105` | Verify §Recommendation already wires both TopologyManager + graph-backend.ts (no edit if already correct) |
| `adr-0106` | Flip recommendation to Option A (full ConsensusEngine wire-up); document daemon-resident pattern + CLI flag exposure |
| `adr-0107` | Flip recommendation to "wire QueenCoordinator as daemon-resident advisor"; define `mcp__ruflo__queen_*` tool surface |
| `adr-0108` | Add `validateWorkerType` enum validator extension |
| `adr-0109` | Flip §Recommendation to wire all 4 consensus protocols; document signatures-unverified annotation |
| `adr-0110` | Add amendment about `storage-factory.ts` fork-only + `database-provider.ts` upstream pattern + README SQLite-WAL deletion at `81418649c` |

**Wave gate**: 8 ADRs updated, all `lib/acceptance-adr*-checks.sh` scripts pass.

### Coordination protocol (cross-wave invariants)

- **Memory namespace**: all keys live under `mcp__ruflo__hive-mind_memory` keyspace `merge-2026-04-29/`. Persistent across the entire wave.
- **Locking**: `withHiveStoreLock` (ADR-0104 §5) wraps every memory write. `O_EXCL` + stale-lock recovery means agents on the same machine cannot corrupt the namespace.
- **Consensus**: cross-worker disputes (e.g., two workers proposing different recipes for the same commit) resolve via `hive-mind_consensus({strategy: 'quorum', preset: 'majority'})`. Per ADR-0106 Option A wire-up, this is real protocol-driven consensus, not a JSON poll.
- **Halt protocol**: any worker reporting `status=blocked` or `status=fail` causes the Queen prompt to surface the failure to the live user session via the `claude` CLI's output channel. The user decides whether to retry, skip, or abort.
- **No API key required**: every spawn uses `child_process.spawn('claude', [...])` against the user's Claude subscription. The hive prompt does NOT pass `ANTHROPIC_API_KEY`; per `feedback-no-api-keys.md` this is the entire point of ruflo's architecture.

### Wave timing estimates (multi-agent)

| Wave | Sequential time | With multi-agent |
|---|---|---|
| W1 (4 forks pre-flight) | ~1h | ~20 min (4-way parallel) |
| W2 (8 letter-group recipes) | ~2h | ~30 min (8-way parallel; reads only) |
| W3 (6 fork-side conflict recipes) | ~1h | ~20 min (6-way parallel; reads only) |
| W4 (sequential merge + acceptance) | ~9h | ~5h (acceptance watchers cut iteration latency; rerere replays cached recipes) |
| W5 (8 ADRs) | ~2h | ~30 min (8-way parallel) |
| **Total** | **~15h** | **~6.5h** |

Compression factor ~2.3× — bounded by W4's serialized working-branch writes. The remaining 5h of W4 cannot parallelize further without splitting the merge across multiple branches (which would multiply conflict surface and is rejected per `--strategy=ort` guidance).

### Why this fits the project's stated architecture

- **`hierarchical-mesh` topology** matches the project's default (`CLAUDE.md` Project Config: `Topology: hierarchical-mesh`).
- **Max 15 agents** stays within the project's `Max Agents: 15` limit; W2's 8 + W3's 6 = 14 concurrent.
- **Consensus via real protocols**: depends on ADR-0106 Option A being wired *before* this wave starts. If the wave runs before ADR-0106 wire-up, fall back to `strategy: 'quorum'` against the JSON-tally implementation in upstream `6992d5f67` (still real, just simpler than full Raft/Byzantine).
- **`withHiveStoreLock` protection** is the same primitive that protects ruflo's hive-mind state; using it for merge coordination reuses verified infrastructure (ADR-0104 §5, ADR-0098 swarm-init sprawl).
- **`mcp__ruflo__hive-mind_memory` cross-process persistence** (per Category J fork commits) ensures recipe state survives Queen restart.
- **No API key, no budget**: per `feedback-no-api-keys.md`, the entire wave runs on user's subscription via local `claude` CLI subprocess.

## Out of scope

Genuinely out-of-scope items — sequencing or topical separation, NOT value judgements (per memory `feedback-no-value-judgements-on-features.md`):

- **Federated cross-hive consensus end-to-end implementation** — separate ADR if/when that scenario ships. The primitives (`swarm/src/consensus/{raft,byzantine,gossip}`, `ruvector-delta-consensus`, `rvf-federation`) are wired per ADR-0106 Option A; the federation *application* (signed identity across machines, cross-hive state replication, multi-Queen leader election) is the separate work. The protocols ship; using them across machines is what's separate.
- **Upstream-contributing our enum validators back to `ruvnet/ruflo`** — separate workflow once fork stabilizes. Not a wiring decision; a contribution-direction decision.
- **ADR-0101 fork-README delta program** — separate ADR. Documentation reconciliation runs on its own track.
- **19-plugin marketplace fork-side identity decision** — separate decision. Three options laid out in §"Plugin support: 3-layer state" (use upstream marketplace / publish parallel `sparkling/ruflo-marketplace` / codemod at consumption time). Recommendation: B. Out of scope here because that's a publication-pipeline decision, not a wiring one.

**Removed from prior "Out of scope" list** (these were value judgements, not genuine scope items — corrected per `feedback-no-value-judgements-on-features.md`):

- ~~"Adopting all 205 ruvector crates"~~ — moved to §Pre-flight as a mechanical action (publish all 171; the original "205" figure was wrong — verified upstream HEAD has 171 workspace members).
- ~~"ADR-088 LongMemEval hybrid/full modes (behind opt-in flag; raw mode only in default acceptance)"~~ — moved to §New upstream ADRs as "wire all 4 modes; user-supplied API key gates hybrid/full at runtime, not ship-time."

## Implementation Log

### 2026-04-29 — Investigation completed via 15-agent swarm

15 parallel research agents (one per slice) analyzed the upstream delta. Findings consolidated above. No execution begun; this ADR is the merge plan, not the merge.

Per-agent reports (paths to swarm task output, archived):

- ruflo hive-mind cluster — verdict: ADR-0104 patches survive
- ruflo CLI/parser/init — verdict: §1 + §4a still required
- ruflo security/validation — verdict: ADR-0107/0108/0110 gaps survive; scaffolding adopted
- ruflo memory/RVF/agentdb — verdict: ADR-0110 amend; 384d/768d conflict
- ruflo WASM/native backends — verdict: 3 ruvector publishes blocking ruflo
- ruflo plugins/marketplace — verdict: namespace gate codemod required
- ruflo tests/bug fixes — verdict: 30 P0 commits worth pulling
- ruflo perf/architecture — verdict: PERF-03 lazy loading + statusline-regenerator risk
- ruvector NAPI churn — verdict: skip ~510 bot commits
- ruvector SONA/reasoning_bank — verdict: 5 commits, no re-tuning, 1 deliberate-decision
- ruvector native backends — verdict: 4 breaking changes, additive otherwise
- ruvector RVF/WAL/consensus — verdict: format stable, lock pattern compatible
- ruvector breaking changes catalog — verdict: 0.x→2.x + Rust 1.92 + 26→171 crate sprawl (initial swarm cited 205 — superseded by 2026-04-29 validation pass)
- ADR adoption + dependencies — verdict: ruvector first, ruflo second, bookkeeping last
- Conflict zone deep-dive — verdict: 5 hunks ~60-80 min hand-merge

### 2026-04-29 — 4-agent validation + numerical/structural correction pass

Following the swarm investigation, a 4-agent validation swarm was run to verify every claim in the ADR independently. Mismatches found and corrected in this revision:

**Numerical / factual corrections** (specific values were wrong):
- Last ruvector merge: `d2e29c6f` (2025-11-26) → `a5ede10a` (2026-04-06).
- Real ruvector signal commits: ~784 → ~1808 (2318 minus 510 bot churn).
- Crate count: 26 → 205 → corrected to 26 → 171 (workspace members at upstream HEAD).
- Npm package count: 7 → 56 → corrected to 7 → 84.
- Helper symbol: `getProjectCwd()` → `findProjectRoot()` (renamed 2026-04-23 per ADR-0100; ADR was treating already-completed work as future).
- Bare `process.cwd()` sites in `memory-router.ts`: 6 → 5 (lines 313/318 are returns of joined paths, not bare calls).
- Consensus file LOCs: raft ~1100 → 443; gossip ~1300 → 513; byzantine ~1000 → 431; index ~250 → 267.
- Plugin count: "14 plugins" → 15 (the count was self-contradictory with the listed names).
- CI/CD probe comment lines: `shared/src/index.ts:194-196` → 196-198.
- SQLite-WAL deletion: `70a54a7c5` (Feb 2026) → `81418649c` (Apr 2026).
- Workspace bump: `2.0.6 → 2.2.0` → `2.1.0 → 2.2.0`.
- Reformat scope: 426 files → 645 + 429 across two commits.
- Sona consensus LOC: ~430 inside `hive-mind_consensus` → ~493 split between `hive-mind_consensus` (~283) and `coordination_consensus` (~210).
- Mirrored sona commits: `158a6803`+`1b8d9bf9` (upstream-only) → `a697632b`+`72e5ab60` (fork-main mirrors).

**Removed fabricated claim**: "our `42901a78` deliberately deleted the `[lints.rust]` block" — independently verified false. `42901a78` touches rvf-node/sona NAPI packaging and `.npmignore`. Fork has no workspace-level `[lints.rust]`. Reframed as "non-conflicting adoption of upstream's per-crate `[lints.rust]` blocks via `100fd8bb`".

**Structural completeness additions**:
- §Cross-cutting orphan-handling action items — promoted from misnumbered list-2-to-4 inside Plugin Layer-3 work.
- Group I (fork-side hand-conflicts) added to §Cross-fork merge order — ensures `0cd9c4a39`, `5b7cefaea`, `f46a104b0`, `a3b3d7797`, RVF backend conflicts, and squash-pre-merge pairs all have explicit resolution guidance.
- `9fc61ea1c` and `43edb691a` added to merge groups G and D respectively (previously flagged but unassigned).
- `e50df6722` clarified as merged once in group E (PERF-03 + HIGH-02 ship in the same commit).
- §Operations section added — branch strategy, test-coverage gates per phase, rollback strategy, tag/release strategy, BC statement, time/parallelism estimates.
- R13-R18 added to §Risk register — process.cwd cleanup, orphan-deletion hazard, RaBitQ sequencing, squash-pre-merge pairs, maxCpuLoad collision, fork-side hand-conflicts.
- §Updates required to existing ADRs (line 240-244) reconciled with §Reconcile our ADRs (Decision plan step 7) — both now name the same set including ADR-0104 Q4, ADR-0108, ADR-0110.
- Stale cross-section pointer fixed: "step 4 group G" → "step 2 group G".
- 342 vs 346 commit-count gap explained (cross-slice double-counting in the audit table).
- The 49-commit gap between category-prose totals (293) and inventory (342) annotated as cross-cutting double-counting; per-slice totals in the audit table are authoritative.

**Verified correct (no change required)**: all 21 cited ruflo SHAs exist and match descriptions; all 5 new upstream ADRs (085-088, 092) exist; all 15 ruvector breaking-change SHAs exist; 510 NAPI bot churn count exact; sparkling commits `d8ba8b03`+`5bc11872` confirmed; RaBitQ branch + `ce1afecb` confirmed; RVF format stability verified (`unknown_segment_preservation.rs`, no layout rewrites); `6db89867` + `6990be76` ready-made primitives confirmed; lock primitives (`withHiveStoreLock`/`withSwarmStoreLock`/`withClaimsLock`) verified; `topology-manager.ts` 656 LOC verified; `queen-coordinator.ts` 2030 LOC verified; conflict-zone files exist; ADR-0098 ship verified (commit `32c13d322`); `7eb505d22` `graph-backend.ts` signatures verified.

### 2026-04-29 — Wave 1 (pre-flight) executed

4 parallel agents per §Multi-agent execution plan W1. All 4 working branches `merge/upstream-2026-04-29` created off each fork's `main` and pushed to `sparkling/<fork>`.

| Agent | Fork | HEAD | Status |
|---|---|---|---|
| `preflight-ruflo` | `forks/ruflo` | `b53f48b249` | ✅ |
| `preflight-ruvector` | `forks/ruvector` | `0af8ed57a6` | ✅ |
| `preflight-agentic-flow` | `forks/agentic-flow` | `503c8d9cdd` | ✅ |
| `preflight-ruv-FANN` | `forks/ruv-FANN` | `828579a52b` | ✅ |

**Pre-flight items completed:**

- **R13 cwd-churn cleanup** — 5 bare `process.cwd()` sites in `v3/@claude-flow/cli/src/memory/memory-router.ts:{204,209,273,312,316}` replaced with `findProjectRoot()`. Import added: `import { findProjectRoot } from '../mcp-tools/types.js';`. Closes the same bug class upstream's `bff8a34af`/`5c5ede94b` patched elsewhere.
- **CI/CD probe revert** — 3 leftover comment lines (`// pipeline-test-1773520675`, `// cicd-test-1773520822`, `// cicd-final-1773522020`) removed from `v3/@claude-flow/shared/src/index.ts`. Cleaner than 3 revert commits.
- **R9 statusline** — investigation showed disposition is **identical-no-action**: the actual source template at `v3/@claude-flow/cli/src/init/statusline-generator.ts` (`generateStatuslineScript()`, 839 LOC) wired into the regenerator at `v3/@claude-flow/cli/src/init/helpers-generator.ts:1363` already contains all our customizations (`'Opus 4.6 (1M context)'` at template lines 182/198, `.swarm` paths at 208/302/464/480 per ADR-0069 A4). When upstream `a0ef36cbb` regenerates, it regenerates from this template, preserving our customizations. The two `.claude/helpers/statusline.cjs` overlay copies are stale runtime artifacts at different snapshots, not source-of-truth. **R9 risk assessment in this ADR was overcautious.**
- **Rust toolchain** — `forks/ruvector` got new `rust-toolchain.toml` pinned to `stable` and `Cargo.toml` `rust-version` bumped `1.77` → `1.92`. Edition stayed at `2021` (the `2024` migration is W4 work touching upstream-source files; not pre-flight). Local rustc 1.95 verified well above the floor.
- **engines.node ≥20** — `forks/agentic-flow` updated 16 package.json files; `forks/ruv-FANN` updated 3. Both top-level package.json files bumped (already-present, value bumped). `ruv-FANN` install passes (933 packages, 4s, no engine warnings); `agentic-flow` install was already broken pre-bump (pipeline state references unpublished `agentdb@3.0.0-alpha.10-patch.348`) — pre-existing, not caused by the bump.
- **Codemod regex tests** — `tests/pipeline/codemod.test.mjs` got 2 new test cases covering `@ruvector/{ruvllm, graph-node, rabitq-wasm}` → `@sparkleideas/ruvector-*` rename for static `import` + `require` (incl. subpath) plus `package.json` deps with caret/tilde/exact/prerelease/peerDeps ranges. Existing prefix rule at `scripts/codemod.mjs:30-31, 219` already handles all 3 packages — tests just lock in the contract. **Committed `03b77a6` 2026-04-30**; extended for `@ruvector/acorn-wasm` parity in `e716236` 2026-04-30 after Path B inspection confirmed `acorn-wasm` is the sibling-package that lands alongside `rabitq-wasm` via PR #394.

**New findings (decisions surfaced for W2/W3 gate):**

1. ~~**R15 amplified — rabitq branch dry-merge has 1016 conflicts.**~~ **REFRAMED 2026-04-29 post-investigation** (4-agent rabitq investigation swarm): the 1016-conflict count was a real number but a **stale-base artifact**, not a rabitq-specific signal. The W1 preflight-ruvector agent ran `git merge --no-commit feat/wasm-packages-rabitq-acorn` from the W1 working branch off our **fork main** (HEAD `8225c53cb`, last upstream sync 2026-04-06 `a5ede10a` — 200+ commits behind upstream main HEAD `20aca12a`, 1438 files of accumulated divergence). Independent verification: agent-3 ran the same dry-merge against `origin/main` and got **0 conflicts** (the branch is 5 ahead, 15 behind upstream main; sym-diff 28 files). Investigation also revealed: (a) RaBitQ is **already in upstream main** via PR #370 (2026-04-23, foundation crate) + PR #394 (2026-04-26, `ce1afecb` squash-merge adds `crates/ruvector-rabitq-wasm` + `npm/packages/rabitq-wasm/` + ADR-161); (b) `@ruvector/rabitq-wasm@0.1.0` is **already published on public npm**; (c) ruflo's consumer is dynamic-import + try/catch + graceful BM25/HNSW fallback — `npm install` is the only hard gate, runtime is soft. **Net**: R15 collapses; rabitq rides the normal step-2 ruvector upstream sync. See R15 reframe in §Risk register and the rabitq-specific note in §Cross-fork merge order step 1.

2. **R16 squash-pair Pair B re-evaluation.** `2c311d36e` + `67f143f8e` (DM-001 384d→768d direction reversal) are adjacent (1 unrelated intervening merge), but post-pair churn on the 5 affected files is heavy: `controller-registry.ts`=62 commits, `memory-bridge.ts`=58, `memory-initializer.ts`=46, `embeddings-tools.ts`=9, `neural.ts`=5. Squashing changes the diff vs. parent of 4 fork-only files, forcing rebase replay across ≈60 follow-up commits per file. **Squashing Pair B may *increase* total rebase work rather than decrease it.** The merged-final state (768-dim) is preserved either way. Recommend: **skip Pair B squash**; W4 rebase will resolve the dimension transition mechanically when those follow-up commits replay.

3. **R16 Pair A safe to squash.** `de14ffe4d` + `9f44022ed` (SG-004 add+supersede) — 9 unrelated merge intermediaries between them, **0 inter and 0 post-pair commits touch the same files**. Mechanical squash, low risk. Awaiting force-push gate (sparkling/main rewrite) — no execution.

4. **forks/ruflo `cli` package tsc "broken" pre-W1 — non-issue (corrected 2026-04-30).** The W1 agent ran `cd v3/@claude-flow/cli && npm run build` directly in the fork, which has no `node_modules` (workspace deps never installed there — the pipeline installs in `/tmp/ruflo-build`, not in the fork). 479 errors all environmental: missing `@types/node` (declared in workspace-root devDeps but not hoisted), unresolved `agentdb@-patch.348` (only via Verdaccio), unlinked workspace siblings. **W4's actual build gate runs via `npm run build` from `ruflo-patch/`** (orchestrator path: `copy-source → /tmp/ruflo-build → codemod → per-package npm install → tsc + wasm`). The fork-local tsc state is **irrelevant** to W4. The earlier "Will need addressing for W4 acceptance gates" framing was misleading — drop. Smoke-test path for pre-W4: `npm run test:acceptance` from `/Users/henrik/source/ruflo-patch`.

**Pending user gates before W2/W3:**

- ✅ ~~R15 strategy decision~~ — **resolved**: rabitq is already in upstream main; no special branch handling. Standard step-2 ruvector sync ships it. Optional Path B: pull Branch 1's 5 extra refinement commits beyond what PR #394 squash-merged — 0 conflicts vs upstream main; deferrable.
- ✅ ~~R16 Pair A squash force-push~~ — **closed 2026-04-30**: dropped per memory `feedback-no-history-squash.md`. Both pairs stay in history.
- ✅ ~~R16 Pair B squash decision~~ — **closed 2026-04-30**: same as Pair A — dropped.
- ✅ ~~Fix forks/ruflo `cli` tsc state~~ — **closed 2026-04-30 as non-issue**: the W1 agent ran `cd v3/@claude-flow/cli && npm run build` directly in the fork, which has no `node_modules` (workspace deps never installed there). 479 errors all environmental: missing `@types/node` (declared in workspace-root devDeps but not hoisted), unresolved `agentdb@-patch.348` (only available via Verdaccio), unlinked workspace siblings. **W4's actual build gate runs via `npm run build` from `ruflo-patch/`**, which uses the orchestrator path: `copy-source → /tmp/ruflo-build → codemod → per-package npm install → tsc + wasm`. The fork-local tsc state is irrelevant to W4. To smoke-test letter F's build before W4 starts: run `npm run test:acceptance` from `/Users/henrik/source/ruflo-patch` (the orchestrator path, not the fork-local one).
- ✋ Codemod regex test commit on `ruflo-patch` (uncommitted in working tree).

### 2026-04-29 — Post-W1: 4-agent rabitq investigation swarm

Triggered by user pushback on the W1 preflight-ruvector "1016 conflicts" finding for `feat/wasm-packages-rabitq-acorn` and the implied need to merge an upstream WIP branch. 4 read-only agents covered: (1) upstream ruvector ADRs + docs, (2) RaBitQ code surface in `origin/main`, (3) per-branch dossier across the 6 rabitq-related upstream branches, (4) commit timeline + ruflo consumer-side analysis.

**Findings, condensed:**

- **RaBitQ landed in upstream main 2026-04-23 → 2026-04-26.** PR #370 (`2c028aee`) brought the foundation `crates/ruvector-rabitq` (3717 LOC, 40 tests, mature). Subsequent commits on origin/main added Hadamard rotation, AVX2/AVX-512 dispatch, persistence, SoA storage, kernel trait. PR #394 squash-merged `ce1afecb` adding `crates/ruvector-rabitq-wasm` (188 LOC wasm-bindgen wrapper) + `npm/packages/rabitq-wasm/` (package skeleton — `.gitignore` deliberately excludes `.wasm/.js/.d.ts`, built via `wasm-pack` per `build.sh`).
- **`@ruvector/rabitq-wasm@0.1.0` is already published on public npm.** Verified via `npm view`. ADRs 154/161 are still `Proposed` (not Accepted), CHANGELOG has zero rabitq entries — research-tier ship-but-unannounced posture, not stable API.
- **Per-branch dossier.** 6 rabitq-related upstream branches: `feat/wasm-packages-rabitq-acorn` (Branch 1: 5 ahead, 15 behind, **0 conflicts vs origin/main**, strict superset of all others, defines the npm package); `feature/diskann-rabitq-{backend,persistence}` (Branches 2+3: separate diskann-quantizer surface, Branch 3 ⊃ Branch 2, 0 conflicts each); `feature/rabitq-wasm` (Branch 4: superseded by Branch 1); `research/nightly/2026-04-23-rabitq` (Branch 5: already merged via PR #370); `research/rabitq-integration` (Branch 6: pure docs, 0 conflicts).
- **The W1 preflight-ruvector "1016 conflicts" was real but stale-base.** It measured `merge --no-commit feat/wasm-packages-rabitq-acorn` from W1 working branch off **fork main** (`8225c53cb`, ~200+ commits behind upstream main `20aca12a`, 1438-file accumulated divergence). Agent-3's independent dry-merge against `origin/main` showed **0 conflicts**. Both numbers are correct; they measure different operations.
- **ruflo consumer side.** `ca4d1f0a4` adds `v3/@claude-flow/cli/src/memory/rabitq-index.ts` (296 LOC), 3 new MCP tools (`embeddings_rabitq_{build,search,status}`), and declares `"@ruvector/rabitq-wasm": "^0.1.0"` in `v3/@claude-flow/cli/package.json` regular `dependencies`. **All 3 production import sites use dynamic `await import()` inside try/catch** with explicit `RaBitQ unavailable, fall through` fallback. `911bd4e94` adds bridge alignment fix. Net: hard at `npm install`, soft at runtime. The "hard sequencing dependency" framing in pre-investigation R15 was overstated.

**Plan deltas applied (this revision):**
- R15 reframed in §Risk register — collapses to "no special handling".
- §Cross-fork merge order step 1 rabitq bullet rewritten — no more "merge feat/wasm-packages-rabitq-acorn into fork main first".
- §Cross-fork merge order step 2 group F annotations on `ca4d1f0a4` / `911bd4e94` updated — soft-runtime + hard-install-time framing.
- §Cross-cutting orphan-handling action item #1 (`911bd4e94` re-audit) re-anchored to ruflo group F.

**Plan unchanged:**
- §Cross-fork merge order step ordering (ruvector → ruflo → bookkeeping) still correct; rabitq just doesn't require a special branch merge inside step 2.
- §Conflict zones unchanged; rabitq is not in the 5-hunk hot zone.
- W2 + W3 design unchanged (per §Multi-agent execution plan).

**~~Optional Path B still open~~ — Path B closed 2026-04-30: SKIP** (Path A only). Inspection agent verified the 5 "ahead" commits (`81801bfd`, `0b476767`, `47f73061`, `ff09f655`, `6d634c0e`) are **pre-squash history collapsed into `ce1afecb`** on origin/main. Branch tip is timestamped 5h47m before the squash; merge-base equals branch parent; every key file (`acorn-wasm/src/lib.rs`, `rabitq-wasm/src/lib.rs`, `acorn/src/index.rs`, `package.scoped.json`) is byte-identical between branch tip and main. The earlier framing "post-publish refinements worth pulling" was wrong — they're pre-publish work, not post-. The branch is just stale because nobody updated it after the squash. Pulling adds duplicate history + Cargo.toml `members = [...]` line-ordering conflicts but zero functional change. **W4 step-2 ruvector merge: just sync `origin/main`; ignore the branch entirely.** Codemod note: the PR introduced `@ruvector/acorn-wasm` as a sibling alongside `@ruvector/rabitq-wasm` — our generic `@ruvector\/` regex covers it transitively (no explicit test required, optional 5-line fixture-list extension to `tests/pipeline/codemod.test.mjs` for parity with the `rabitq-wasm` test).

### 2026-04-29 — Wave 2 + Wave 3 (recipe staging) executed

14 read-only investigation agents (8 W2 letter-group + 6 W3 fork-side conflict) per §Multi-agent execution plan. Diff-inspection methodology (no actual merges; classify conflict shape from sym-diff overlap). All recipes produced for the W4 coordinator.

**Total estimated W4 hand-merge time: ~762–841 min (~13–14h)**

| Slice | Commits | Minutes | Status |
|---|---:|---:|---|
| W2 A — Test infra | 2 | 10 | 1 clean, 1 single-file structural |
| W2 B — ESM/CJS hardening | 2 | — | parser.ts: standard 3-way add-add merge (upstream `01070ede8` adds lazyCommandNames machinery; our `fe18fddb7` adds `--non-interactive` hoist; both purely additive since 2026-03-16 merge-base — verified 2026-04-30, ADR-0104 did NOT remove anything despite W2 letter B agent's incorrect "over-eager removal" framing) |
| W2 C — Daemon/session P0 | 5 | 110 | 2 superseded-skip; 1 partial re-port; 2 selective hunks |
| W2 D — Validation/honest metrics | 10 | 105–150 | 5 empty-after-rebase; a101c2a08 critical 60-85 min |
| W2 E — Hive-mind cluster | 6 | 55–80 | 4 hunks (not 5 — see §Conflict zones correction); rerere required |
| W2 F — PERF-03 + native backends | 7 | 195 | 3 commits modify deleted memory-bridge → re-anchor to memory-router |
| W2 G — Plugins & marketplace | 10 | 136 | 81418649c no overlap with 0cd9c4a39; f3cc99d8b namespace gate codemod |
| W2 H — Misc small fixes | 7 | — | 5 pre-resolved; **`8824fe3c4` "mild blocker" resolved 2026-04-30** by orphan-deletion audit dossier #4 — `memory-bridge.ts` collision is one of 9 deleted-by-us cases; semantic content (top-level `vectorBackend: 'auto'` + controllers-block flag) **pre-resolved by W1.5** (`'ruvector'` value + delegated-to-AgentDB shape makes the flag redundant under Model 1) |
| W3 0cd9c4a39 | 1 | 5 | Disjoint paths — no actual conflict |
| W3 5b7cefaea | 1 | 25 | 9 collisions all keep-our-deletion |
| W3 f46a104b0 | 1 | 8 | Zero textual overlap |
| W3 a3b3d7797 | 1 | 5 | Reduces to dropping `config-template.ts:256` literal |
| W3 RVF cluster | 6 | 25 | Only 1 of 6 conflicts; queue-inside-lock |
| W3 ADR-0085 dels | 15 | 15–20 | 18 mechanical `git rm`; bff8a34af pre-resolved by W1 |

**Headline corrections applied to plan (this revision):**

1. **§Conflict zones row 1** — split tri-fold "validation + AgentDB sidecar + real consensus" by letter (validation in D via `dc2abef2a` + `a101c2a08`; sidecar + consensus in E). Removed "HNSW vector cleanup INSIDE the lock" — that cleanup is in `memory-tools.ts memory_delete` (letter D), not `hive-mind-tools.ts hive-mind_memory delete`. Reduces "5 hunks" to 4.
2. **§Cross-fork merge order Group I row 1** — paths between `0cd9c4a39` and `81418649c` are fully disjoint; the "yaml→md collision" framing conflated SG-008 `config.yaml`→`config.json` (runtime) with upstream's `_config.yml` (Jekyll docs). No actual conflict.
3. **§Cross-fork merge order Group I row 3** — `controller-registry.ts` is NOT fork-only; originated upstream as `bfef01821` (ADR-053). Zero textual overlap between our P2-B/C edits and upstream's window changes.
4. **R17** — `worker-daemon.ts` already merged correctly on working branch. Surviving `28.0` is in `config-template.ts:256` (init template), not `worker-daemon.ts`. Resolution = drop the literal from config-template, ~5 min.
5. **§Pre-flight** — added `git config rerere.enabled true && git config rerere.autoUpdate true` as a required pre-W4 step.

**New blockers for W4:**

- **`memory-router.ts` may need pre-merge extension** before letter F can land. 4 W2 commits (`ca4d1f0a4`, `911bd4e94`, `04d6a9a0a` partial, `8824fe3c4` partial) modify the deleted `memory-bridge.ts` and require re-anchoring to `memory-router.ts`. New router exports likely needed: `routerGetAllEmbeddings()` (replaces `bridgeGetAllEmbeddings`), raw-embedding return shape on store, post-store HNSW callback hook.
- ~~**Codemod registration**~~ — **closed 2026-04-30**: existing global `SCOPED_RE = /@claude-flow\//g` text-replace at `scripts/codemod.mjs:178` already auto-rewrites the namespace literal in `plugin-loader.ts:~432` to `@sparkleideas/`. Verified via inspection — the codemod is not AST-aware, applies to literals in code as well as imports/deps. No new sweep entry needed. Test coverage locked in via `62a357e` (`tests/pipeline/codemod.test.mjs`: `transforms @claude-flow/ literal in non-import contexts (namespace gate, comments, template literals)`). The W2 letter G recipe's "register the namespace literal in ruflo-patch codemod sweep" item was over-cautious — strike from the recipe.
- **Acceptance test gap** — no existing acceptance test covers plugin trust-level routing; needs adding for `f3cc99d8b` (publish a fixture plugin with `name: '@sparkleideas/test-plugin'` + `trustLevel: 'official'`, verify it loads with full context).
- **`8824fe3c4` mild blocker** — patches `v3/@claude-flow/cli/src/memory/memory-bridge.ts` (deleted on our fork). Investigate whether the hunk targets a creation that lands earlier in the merge wave; otherwise drop the hunk and file upstream issue.
- **Sequencing on letter F** — `7eb505d22` + `ca4d1f0a4` + `911bd4e94` block on step-2 ruvector publishes of `@sparkleideas/ruvector-{ruvllm, graph-node, rabitq-wasm}`.

**Donate-back candidates surfaced:**
- `9fc61ea1c` — upstream's local helper covers 1 tool with stale-cwd-cached-at-module-load risk; our ADR-0100 `findProjectRoot()` covers 15 tools without caching. File issue post-merge.
- `f3cc99d8b` — parametrize `'@claude-flow/'` namespace literal as `OFFICIAL_NAMESPACE_PREFIX` constant. File issue post-merge.

**Already-applied / superseded commits (W4 will produce empty/no-op diffs)**:
- W2 D: 5 commits (`43edb691a`, `0752e5963`, `1409db9bc`, `d3da4b676`, `a2e2def04`) — empty-after-rebase
- W2 H: 5 commits (`5fdd8e19e`, `dc7957cf4`, `8e51bd54d`, `b1b615aae` already in W1 base; `a0ef36cbb` R9 disposition)
- W2 C: 2 commits (`5c9ede94b` superseded by ADR-0100, `100ffeaa3` superseded by `a3b3d7797`)
- Net: ~12 of 67 letter commits collapse to no-ops at rebase time.

**Hypothesis verdict update**: ADR §Hypothesis predicted 25-40% upstream-redundancy on fix-commits; W2 D measured 50% in that letter — within band on the high side. Across all 67 letter-group commits the empty-after-rebase rate is ~18% (12/67) — lower than the per-letter-D rate but consistent with the "5/10 commits redundant in honest-metrics letter" pattern.

**Plan unchanged:**
- §Cross-fork merge order step ordering (ruvector → ruflo → bookkeeping) still correct.
- W2 + W3 design verified (14 agents produced complete coverage).
- W4 sequential merge pattern unchanged: rerere + ort+patience strategy on the working branch.

### 2026-04-30 — Pre-W4 open-question closure consolidated

Going through the open-question list before kicking off W4. All 10 items closed; verdicts recorded in their canonical sections of this ADR. Summary for the audit trail:

| # | Topic | Verdict | Where it landed |
|---|---|---|---|
| 1 | R16 Pair A squash (`de14ffe4d`+`9f44022ed`) | **DROP** | R16 row + §Group I row 5 + §Cross-fork merge order Group I + new memory `feedback-no-history-squash.md` |
| 2 | R16 Pair B squash (`2c311d36e`+`67f143f8e`) | **DROP** | Same as #1 — both pairs dropped (squashing risks data loss; clean history not a project goal) |
| 3 | forks/ruflo `cli` tsc "broken" pre-W1 | **NON-ISSUE** | W1 Implementation Log entry corrected — fork-local tsc state is irrelevant to W4 (orchestrator builds via `/tmp/ruflo-build`, not the fork) |
| 4 | Codemod regex test commit | **COMMITTED** (`03b77a6` + extended `e716236` for acorn-wasm parity) | W1 entry updated to remove "uncommitted, awaiting review" |
| 5 | memory-router pre-extension (W1.5 + W1.6) | **LANDED** | W1.5 commit `4c1c66a6e` + W1.6 commit `03df8643b` on `forks/ruflo` `merge/upstream-2026-04-29` (pushed to sparkling). Plus W1.7 commit `14eac18f3` (orphan-audit safeJsonParse port). |
| 6 | Codemod sweep update for `f3cc99d8b` namespace gate | **ALREADY-HANDLED** (existing `SCOPED_RE` regex) | R10 row updated; W2/W3 entry "Codemod registration" struck; test added in `62a357e` |
| 7 | Plugin trust-level acceptance test | **DEFERRED to letter G execution** | R10 row's "add acceptance test" → deferred per W2 letter G recipe (cannot test against absent `f3cc99d8b` code pre-W4) |
| 8 | `8824fe3c4` missing-file hunk "mild blocker" | **PRE-RESOLVED** by W1.5 (orphan audit dossier #4) | W2/W3 entry summary updated; orphan audit verdict in §Group I |
| 9 | Path B 5-extra rabitq commits | **SKIP** (pre-squash history collapsed into `ce1afecb`) | R15 row §Optional Path B section + §rabitq investigation entry |
| 10 | parser.ts lazy-command restoration intent | **NO RESTORATION NEEDED** (add-add merge) | W2/W3 entry summary updated — `fe18fddb7` did NOT remove the four constructs (verified: 0 lines removed, merge-base had 0 occurrences); upstream's `01070ede8` adds them post-our-merge-base |

**Pre-W4 work outputs (commits on this repo `main`):**
- `03b77a6` — codemod ruvector test
- `62a357e` — codemod literal-in-code test (locks in `f3cc99d8b` namespace-gate auto-rewrite contract)
- `b0788fb` — ADR-0111 W1/W1.5/W1.6/W2/W3 + R15/R16/R17 corrections + orphan audit
- `b26d53d` — ADR-0111 LocalReasoningBank close
- `7115ecb` — ADR-0111 Path B close
- `e716236` — codemod acorn-wasm parity + adr0076-phase4-wiring test heuristic hardened
- `c1d6540` — ADR-0111 W2 letter B parser.ts framing correction

**Pre-W4 work outputs (commits on `forks/ruflo` `merge/upstream-2026-04-29`):**
- `b53f48b249` — W1 pre-flight (5 cwd sites, 3 probe reverts, R9 statusline disposition)
- `4c1c66a6e` — W1.5 RVF-primary fail-loud + memory-router letter F prep
- `03df8643b` — W1.6 fail-loud propagation through memory-router catches
- `14eac18f3` — W1.7 safeJsonParse port (orphan audit item #15)

**Pre-W4 work outputs on other forks:**
- `0af8ed57a6` (`forks/ruvector merge/upstream-2026-04-29`) — rust-toolchain.toml + Cargo.toml rust-version 1.92
- `503c8d9cd` (`forks/agentic-flow merge/upstream-2026-04-29`) — engines.node ≥20 (16 files)
- `828579a52b` (`forks/ruv-FANN merge/upstream-2026-04-29`) — engines.node ≥20 (3 files)

**Outstanding pre-W4 items** (not on the original 10-question list, but worth tracking):
- **smoke-test letter F's build** — `npm run test:acceptance` from `ruflo-patch/` to validate the orchestrator path before W4 starts. Recommended pre-step-2 to catch any orchestrator-side issues in isolation rather than mid-13-14h-merge-wave.
- **W5 sequencing** (#11) — TopologyManager/QueenCoordinator/ConsensusEngine wire-up; per ADR is W5 work post-W4-acceptance, not pre-W4. Open per the original list.
- **ADR-085/092 doc adoption stance** (#12) — open per the original list.
- **Donate-back filings sequencing** (#13) — open per the original list.

**The plan is now ready for W4 execution.** All blockers identified during W2/W3 + orphan audit are either resolved or explicitly deferred to W4 letter execution time.
