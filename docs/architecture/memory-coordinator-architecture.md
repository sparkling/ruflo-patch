<style>
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');

:root {
  --max-width: 1600px !important;
}

.container {
  max-width: 1600px !important;
}

body {
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif !important;
  font-size: 19px !important;
  max-width: 1600px;
  margin: 0 auto;
  padding: 2.5rem 3rem;
  line-height: 1.7 !important;
  color: #1a1a1a;
  background: #fafbfc !important;
}

h1, h2, h3, h4, h5, h6 {
  font-family: 'Outfit', sans-serif;
  font-weight: 600;
  letter-spacing: -0.015em;
  line-height: 1.25;
}

h1 {
  font-size: 3rem;
  border-bottom: 3px solid #1565C0;
  padding-bottom: 0.75rem;
  margin-bottom: 2rem;
  color: #0D47A1;
}

h2 {
  font-size: 2.1rem;
  margin-top: 3.5rem;
  margin-bottom: 1rem;
  color: #1565C0;
  border-bottom: 1px solid #e5e7eb;
  padding-bottom: 0.4rem;
}

h3 {
  font-size: 1.55rem;
  margin-top: 2.25rem;
  margin-bottom: 0.75rem;
  color: #2E7D32;
}

h4 {
  font-size: 1.25rem;
  margin-top: 1.75rem;
  margin-bottom: 0.5rem;
  color: #455A64;
}

p {
  margin: 0.85rem 0;
}

code, pre {
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-feature-settings: "liga" 0;
}

code {
  background: #eef2ff;
  color: #4338ca;
  padding: 0.15em 0.45em;
  border-radius: 4px;
  font-size: 0.88em;
  font-weight: 500;
}

pre {
  background: #1e293b;
  color: #e2e8f0;
  padding: 1.25rem;
  border-radius: 8px;
  overflow-x: auto;
  font-size: 0.92em;
  line-height: 1.5;
}

pre code {
  background: transparent;
  color: inherit;
  padding: 0;
  font-weight: 400;
}

img {
  max-height: 700px;
  max-width: 100%;
  display: block;
  margin: 1.75rem auto;
  cursor: zoom-in;
  border-radius: 6px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.08);
  background: white;
  padding: 1rem;
}

table {
  border-collapse: collapse;
  width: 100%;
  margin: 1.5rem 0;
  background: white;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 1px 3px rgba(0,0,0,0.05);
}

th, td {
  border: 1px solid #e5e7eb;
  padding: 0.85rem 1.1rem;
  text-align: left;
  vertical-align: top;
}

th {
  background: #f1f5f9;
  font-family: 'Outfit', sans-serif;
  font-weight: 600;
  color: #1e293b;
}

tr:hover td {
  background: #f9fafb;
}

blockquote {
  border-left: 4px solid #1565C0;
  margin: 1.25rem 0;
  color: #334155;
  background: #f0f9ff;
  padding: 1rem 1.25rem;
  border-radius: 0 6px 6px 0;
}

a {
  color: #1565C0;
  text-decoration: none;
  border-bottom: 1px solid #93c5fd;
  transition: border-color 0.15s ease;
}

a:hover {
  border-bottom-color: #1565C0;
}

ul, ol {
  margin: 0.75rem 0;
  padding-left: 1.5rem;
}

li {
  margin: 0.35rem 0;
}

hr {
  border: none;
  border-top: 1px solid #e5e7eb;
  margin: 2.5rem 0;
}

.callout {
  border-radius: 10px;
  padding: 1.5rem 1.75rem;
  margin: 2rem 0;
  box-shadow: 0 1px 3px rgba(0,0,0,0.05);
}

.tldr {
  background: linear-gradient(135deg, #E3F2FD 0%, #BBDEFB 100%);
  border: 1px solid #1565C0;
  border-radius: 10px;
  padding: 1.5rem 1.75rem;
  margin: 2rem 0;
}

.tldr h2 {
  margin-top: 0;
  border: none;
  color: #0D47A1;
  padding: 0;
}

.eli15 {
  background: linear-gradient(135deg, #FFF8E1 0%, #FFE082 100%);
  border: 1px solid #F57F17;
  border-radius: 10px;
  padding: 1.5rem 1.75rem;
  margin: 2rem 0;
}

.eli15 h2 {
  margin-top: 0;
  border: none;
  color: #E65100;
  padding: 0;
}

.toc {
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  padding: 1.5rem 1.75rem;
  margin: 2rem 0;
  column-count: 3;
  column-gap: 2.5rem;
  column-rule: 1px solid #f1f5f9;
}

.toc h2 {
  margin-top: 0;
  border: none;
  color: #1565C0;
  padding: 0;
  font-size: 1.3rem;
  column-span: all;
  -webkit-column-span: all;
  margin-bottom: 1rem;
}

.toc ul {
  margin: 0.25rem 0 0.75rem;
  padding-left: 1.25rem;
  break-inside: avoid;
  -webkit-column-break-inside: avoid;
  page-break-inside: avoid;
}

.toc p {
  margin: 0.4rem 0 0.2rem;
  break-after: avoid;
  -webkit-column-break-after: avoid;
  page-break-after: avoid;
}

.toc a {
  border: none;
}

.toc a:hover {
  text-decoration: underline;
}

details {
  background: #f8fafc;
  padding: 0.75rem 1rem;
  border-radius: 6px;
  margin: 1rem 0;
  border: 1px solid #e2e8f0;
}

details summary {
  cursor: pointer;
  font-weight: 600;
  color: #475569;
  font-family: 'Outfit', sans-serif;
  user-select: none;
}

details[open] summary {
  margin-bottom: 0.75rem;
}
</style>

# Memory Archivist Architecture

> **Status:** Accepted under [ADR-0180](../../../adr/export/html/ADR-0180-adopt-thin-memory-coordinator-with-type-enforced-mutation-handlers.html); runtime activation implemented under [ADR-0181](../../../adr/export/html/ADR-0181-archivist-runtime-activation.html); write-path unified under [ADR-0183](../../../adr/export/html/ADR-0183-memory-write-path-unification.html).
> **Audience:** Anyone touching memory, stores, MCP tools, hooks, daemons, or substrate.
> **Last updated:** 2026-05-18 (post-ADR-0186 + ADR-0183 + ADR-0181)

> **Current state (2026-05-18).** The Archivist exists at runtime as a **per-process** instance — each entry point (`@sparkleideas/cli`, `@sparkleideas/cli mcp start`, `@sparkleideas/cli daemon`, `@sparkleideas/cli hooks-daemon`) initialises its own ([ADR-0181](../../../adr/export/html/ADR-0181-archivist-runtime-activation.html)). The MCP `memory_store` / `memory_search` / `memory_retrieve` write path now flows through `routeMemoryOp({type:'store'}) → archivist.dispatch('memory_store') → forks/agentdb/src/archivist/handlers/memory/store.ts`, which owns both the insert and the RC-2 upsert via the rvf substrate ([ADR-0183](../../../adr/export/html/ADR-0183-memory-write-path-unification.html), completed 2026-05-17). The hive-mind consensus handler ([ADR-0184](../../../adr/export/html/ADR-0184-hive-mind-consensus-handler-port.html)) was ported to `forks/agentdb/src/archivist/handlers/hive-mind/consensus/<strategy>.ts`; the cli-side handler was retired ([ADR-0185](../../../adr/export/html/ADR-0185-hive-mind-consensus-cli-retirement.html)). The agentdb package itself is fork-owned at `forks/agentdb/` ([ADR-0161](../../../adr/export/html/ADR-0161-consolidate-agentdb-onto-fifth-fork.html), published from Verdaccio as `@sparkleideas/agentdb@alpha.14-patch.NNN`) — upstream's `packages/agentdb/` was removed from our agentic-flow tree. Release-time file-copy minimisation is governed by [ADR-0182](../../../adr/export/html/ADR-0182-file-copy-minimization.html). The May upstream-sync cycle closed under [ADR-0186](../../../adr/export/html/ADR-0186-upstream-fork-sync-2026-05-18-v2.html) (ADR-097 + ADR-104 federation transport landed via `c4175be73`; ADR-111 WireGuard mesh declined per [ADR-0187](../../../adr/export/html/ADR-0187-adopt-upstream-adr-111-wireguard-mesh.html)).

<div class="toc">

## Contents

**Orientation**

- [TL;DR](#tldr)
- [Explain it to me like I'm 15](#explain-it-to-me-like-im-15)
- [Why we're building this](#why-were-building-this)

**The system**

- [Five caller surfaces](#five-caller-surfaces)
- [System architecture](#system-architecture)
- [The substrate seam](#the-substrate-seam)

**The write path**

- [How a write flows end-to-end](#how-a-write-flows-end-to-end)
- [Type enforcement](#type-enforcement)
- [The audit chain](#the-audit-chain)
- [Re-entrancy and bulk mode](#re-entrancy-and-bulk-mode)
- [The hot-path fast-path](#the-hot-path-fast-path)
- [Quota and error contracts](#quota-and-error-contracts)

**The read path**

- [How a read flows](#how-a-read-flows)
- [TieredCache and invalidation](#tieredcache-and-invalidation)

**Cross-cutting**

- [The six restored features](#the-six-restored-features)
- [Schema evolution](#schema-evolution)
- [Multi-process and durability](#multi-process-and-durability)
- [Testing strategy](#testing-strategy)
- [Observability and operations](#observability-and-operations)
- [Plugins](#plugins)
- [Governance](#governance)

**Delivery**

- [Migration path](#migration-path)
- [What this is NOT](#what-this-is-not)
- [References](#references)

</div>

<div class="tldr">

## TL;DR

The **Memory Archivist** is a thin module (scope-gated by `MODULE.md` charter, no LoC ceiling) that sits between **any in-process caller** and substrate. The MCP boundary is one entry point — the most prominent — but CLI commands, lifecycle hooks, background daemons, and inter-store cascades all route through the same archivist via the same `SubstrateAccess` capability handle delivered through `MutationContext` / `ReadContext`.

**Type enforcement** is structural, not conventional: the substrate handle (`better-sqlite3`/RVF) lives in `archivist/substrate-internal.ts`, which is path-restricted by tsconfig to the archivist tree and not in the package's `exports` field. No store-tree code can import it. Stores expose mutations only as branded `GuardedWrite<T>` (via `registerMutationHandler<T>`) and reads as `GuardedRead<T, R>` (via `registerReadHandler<T, R>`); attempting `import { db } from '../substrate-internal'` fails at compile time. An ESLint rule and a runtime `MutationContext` assertion are belt-and-braces.

**Substrate is layered, not unified.** The archivist's seam is a single `SubstrateAccess.withWrite<T>(fn)` capability with three substrate-specific implementations: the fork's hive-mind `lock+WAL+tmp+rename` shape (ADR-0095) generalized for the ~18 file-system JSON stores (claims/tasks/agents/swarm/coordination/workflow/neural/github/performance/system/config/progress/ruvllm/daa/wasm/browser/autopilot + hive-mind itself), `db.transaction(fn)` for the SQLite carve-outs (the canonical 5-controller roster per ADR-0166 `PERMANENT_SQLITE_CARVE_OUT`: CausalMemoryGraph, CausalRecall, NightlyLearner, LearningSystem aggregations, ReasoningBank GROUP BY — running on **better-sqlite3 with sql.js as fallback** per ADR-0177; ADR-0170's postgres + ruvector-postgres move was superseded by ADR-0177), and a pass-through for RVF (the Rust crate already owns atomicity at the N-API boundary). One abstraction, three implementations — because lower layers already provide isolation and durability at different points.

**Durability is zero-loss except for kernel panic.** A single append-only JSONL audit log at `.claude-flow/data/archivist-audit.jsonl` is written via `fcntl` advisory write-locks around `write()`+`fsync()`. Hot-path writers (post-edit, pre-task) use a write-through journal — every entry hits `write()` synchronously (page cache, survives `SIGKILL`/OOM); `fsync` is batched ≤100ms. Audit-chain replay against a fresh substrate is the §Confirmation gate, asserting addressable-key set-equality (rows by PK, vectors by ID, edges by endpoint-pair).

The six features lost in [ADR-0085](../../../adr/export/html/ADR-0085-bridge-deletion-ideal-state-gaps.html)'s bridge deletion (mutation guard, attestation log, tiered cache, BM25+semantic fusion, explainable recall provenance, skill auto-promotion) all land at the archivist — one auditable location. [ADR-0112](../../../adr/export/html/ADR-0112-independent-stores-not-cross-store.html) is retired. Both MCP surfaces (`memory_*` + `agentdb_*`) are preserved unchanged.

</div>

<div class="eli15">

## Explain it to me like I'm 15

Imagine the codebase as a **research library** with many back rooms and many people who write to or read from it — librarians at the front desk (MCP tools), staff with their own door codes (CLI commands), automated lights-out cataloging jobs that fire on every page-turn (hooks), nighttime stack-shifters (daemons), and even one back room whose contents reference items in another back room (inter-store cascades, like the NightlyLearner that pulls from one shelf and re-files into three others).

Before, every writer had their own key to the back. Some kept a clean log of what they did; most didn't. Two shelves had different conventions and didn't know about each other. When the upstream "self-learning bridge" tried to fix this by putting a librarian inside one back room, it accidentally triggered three or four "I saw that" memos for every book filed — silent amplification — and only got informed of 5 of the 13 doors.

**The Archivist sits at the front desk**, between any writer and the back. We're not building one librarian per back room — we're putting one **passage point** in front of all of them, with three rules:

1. **You can't get to the back without the Archivist handing you a key.** The key is a "capability handle" — a branded TypeScript type that has no public constructor. The TypeScript compiler refuses to compile code that tries to fabricate one. (For repair scripts and migrations, there's a separate "admin entrance" with its own key, gated by file name — and every admin entry logs itself.)

2. **Every entry is written down in one logbook.** A single append-only JSONL file at `.claude-flow/data/archivist-audit.jsonl`. The CLI and the daemon (two separate processes) share it via OS-level file locking; the lock window is microseconds. We can replay the logbook against an empty library and reproduce the current state — that's the test that makes the system recoverable.

3. **Writes that fire fast (every keystroke that triggers `post-edit`) get a fast lane.** Audit entries are `write()`'d to disk immediately (~10–100µs, ends up in the kernel's page cache) but `fsync` is batched ≤100ms. Entries already in the page cache survive `SIGKILL`, OOM-kill, and normal process exit because the page cache outlives the process. They do NOT survive power loss or kernel panic — that ~100ms window is the deliberate trade-off for keeping the hot-path under 2ms. Power-loss durability is out of scope for this project.

The back rooms (substrates) keep their own rules — RVF has its own crash-safe binary format, SQLite has WAL and transactions, file-system JSON stores use a lock+atomic-rename shape. The Archivist doesn't replace those; it just makes sure every write came through the front desk first, gets logged, and can be replayed.

The six things the old librarian used to do — checking books for problems, logging every shelving, caching popular books, helping people find books by topic or meaning, explaining *why* a book was suggested, promoting books to "favorites" — all happen at the front desk now, in one tidy office, with concrete designs for each.

</div>

## Why we're building this

The fork has lived under three contradicting rules at once:

1. **[ADR-0085](../../../adr/export/html/ADR-0085-bridge-deletion-ideal-state-gaps.html)** deleted the upstream bridge — it was right that the bridge was failing (only 5 of 13 mutation paths guarded; 3-4× silent write amplification).
2. **[ADR-0112](../../../adr/export/html/ADR-0112-independent-stores-not-cross-store.html)** forbade cross-store coordination at the substrate layer — right that placement at substrate causes amplification.
3. **[ADR-0177](../../../adr/export/html/ADR-0177-adopt-upstream-agentdb-rvf-vision.html)** pivoted to RVF-primary with SQLite carve-outs — said nothing about coordination.

The gap: every cross-cutting concern that used to live in the bridge (the six features [ADR-0179](../../../adr/export/html/ADR-0179-restore-controller-instrumentation-lost-in-adr0085-bridge-deletion.html) catalogs) is now stranded. Three months of governance gridlock. Six features stub/orphaned/scattered.

A three-round council ([r1](../../../council/export/html/ADR-0179-council-r1-bridge-deletion.html) / [r2](../../../council/export/html/ADR-0179-council-r2-axis-architecture.html) / [r3](../../../council/export/html/ADR-0179-council-r3-bridge-coordination.html)) converged on a single answer: re-introduce the Archivist, but at a **different layer** (above MCP dispatch, not at substrate) and with **type enforcement** instead of runtime convention. Two subsequent swarms — the [caller audit](../../../council/export/html/ADR-0180-swarm-callers-audit.html) and a 14-agent follow-up-disposition swarm — found and resolved the implementation questions. ADR-0180 codifies the decisions; this document explains the system they describe.

## Five caller surfaces

The archivist is consumed by five distinct caller surfaces. Estimated counts from the wire-up audit:

| Surface | Count | Examples |
|---|---|---|
| **MCP tools** (published cli) | ~110 across 24 surfaces | `memory_*` (4 mutating), `agentdb_*` (~20), `hive-mind_*` (6), `hooks_*` (~18), `autopilot_*` (6), `claims_*` (8), `task_*` (5), `agent_*` (4), `swarm_*` (2), `coordination_*` (5), `workflow_*` (8), `daa_*` (6), `wasm_*` (6), `neural_*` (3), `github_*` (3), `embeddings_*` (4), `performance_*` (4), `config_*` (3), `ruvllm_*` (6), `browser_*` (4), `aidefence_*` (5) |
| **MCP tools** (standalone agentdb server) | ~15 | `agentdb_insert(_batch)`, `agentdb_delete`, `reflexion_store(_batch)`, `skill_create(_batch)`, `agentdb_pattern_store(_batch)` |
| **CLI direct-write commands** | ~25 | `ruflo memory store/delete/init/migrate`, `agentdb causal/learner/reflexion/skill/sync`, `agentdb init/migrate` |
| **Lifecycle hooks** | 4 mutating | `post-edit` (HOT, every Edit/Write), `pre-task` (HOT, every Agent invocation), `post-task` (MODERATE), `session-end` (COLD-heavy) |
| **Daemons / background workers** | 6+ writers | `worker-daemon` (map/audit/optimize/consolidate/testgaps), `AutoMemoryBridge` periodic sync, `HooksLearningDaemon`, `MemoryConsolidation` controller |
| **Inter-store cascades** | 4 major orchestrators | `NightlyLearner.run()`, `MemoryConsolidation.createSemanticMemory`, `SkillLibrary.consolidateEpisodesIntoSkills`, `SyncCoordinator.applyChanges` |

Total: **~200+ in-process call sites**. An order of magnitude beyond the "13 mutation paths" estimate earlier drafts used.

Additionally: `@claude-flow/cli-core/commands/memory.ts` uses a separate file-based `JsonMemoryBackend` (`memory/json-backend.js`) that bypasses the archivist entirely — this is an explicit non-archivist carve-out (zero in-tree consumers; ADR-100 cold-cache <5s budget prohibits archivist deps).

## System architecture

The archivist sits between **any in-process caller** and substrate. All five caller surfaces route through it. Substrate is layered — three substrate-shaped `SubstrateAccess` implementations behind a single capability interface.

![memory-archivist-system-architecture](diagrams/memory-coordinator-architecture/memory-archivist-system-architecture.png)

<details>
<summary>Mermaid Source</summary>

```mermaid
---
config:
  layout: elk
---
%%{init: {"theme": "base", "themeVariables": {"primaryColor":"#E3F2FD","primaryTextColor":"#0D47A1","primaryBorderColor":"#1565C0","lineColor":"#37474F","fontFamily":"Inter, sans-serif"}}}%%
flowchart TB
    accTitle: Memory Archivist System Architecture
    accDescr: Five caller surfaces route through the Archivist into one of three substrate implementations behind a SubstrateAccess capability

    subgraph callers["Caller surfaces (~200+ call sites)"]
        Mcp["MCP tools<br/>(~125 mutating)"]:::service
        Cli["CLI direct-write<br/>(~25)"]:::service
        Hooks["Lifecycle hooks<br/>(4: post-edit HOT,<br/>pre-task HOT,<br/>post-task, session-end)"]:::service
        Daemons["Daemons<br/>(worker-daemon,<br/>AutoMemoryBridge,<br/>HooksLearningDaemon)"]:::service
        Cascades["Inter-store cascades<br/>(NightlyLearner,<br/>MemoryConsolidation,<br/>SkillLibrary, SyncCoordinator)"]:::service
    end

    Archivist["<b>Memory Archivist</b><br/>scope-gated by MODULE.md<br/>(no LoC ceiling)"]:::process

    subgraph features["Cross-cutting features at the boundary"]
        Guard["MutationGuard<br/>(5 built-ins + plugins)"]:::security
        Audit["AttestationLog<br/>(single JSONL)"]:::security
        Cache["TieredCache<br/>(read-side)"]:::process
        Fusion["BM25+semantic<br/>RRF fusion"]:::process
        Provenance["ExplainableRecall<br/>provenance"]:::process
        Promote["SkillLibrary<br/>auto-promotion"]:::process
    end

    subgraph seam["SubstrateAccess (capability seam)"]
        FsImpl["makeFsJsonSubstrate<br/>(lock+WAL+tmp+rename)"]:::process
        SqlImpl["makeSqliteSubstrate<br/>(db.transaction)"]:::process
        RvfImpl["makeRvfSubstrate<br/>(N-API pass-through)"]:::process
    end

    subgraph substrate["Substrates"]
        FsJson[("File-system JSON<br/>~15 stores<br/>(claims/swarm/<br/>workflow/wasm/agents)")]:::data
        Sqlite[("SQLite carve-outs<br/>5 named stores")]:::data
        Rvf[("RVF native<br/>HNSW + segments")]:::data
    end

    Mcp --> Archivist
    Cli --> Archivist
    Hooks --> Archivist
    Daemons --> Archivist
    Cascades --> Archivist

    Archivist --> Guard
    Archivist --> Audit
    Archivist --> Cache
    Archivist --> Fusion
    Archivist --> Provenance
    Archivist --> Promote

    Archivist -- "GuardedWrite&lt;T&gt;<br/>GuardedRead&lt;T,R&gt;" --> FsImpl
    Archivist -- "GuardedWrite&lt;T&gt;<br/>GuardedRead&lt;T,R&gt;" --> SqlImpl
    Archivist -- "GuardedWrite&lt;T&gt;<br/>GuardedRead&lt;T,R&gt;" --> RvfImpl

    FsImpl --> FsJson
    SqlImpl --> Sqlite
    RvfImpl --> Rvf

    classDef user fill:#F3E5F5,stroke:#7B1FA2,stroke-width:2px,color:#4A148C
    classDef service fill:#E8F5E9,stroke:#2E7D32,stroke-width:2px,color:#1B5E20
    classDef process fill:#E1F5FE,stroke:#0277BD,stroke-width:2px,color:#01579B
    classDef security fill:#E0F2F1,stroke:#00695C,stroke-width:2px,color:#004D40
    classDef data fill:#FFF8E1,stroke:#F57F17,stroke-width:2px,color:#E65100
```

</details>

**Load-bearing properties**:

- **Above any in-process caller, not just MCP dispatch.** The archivist's type-enforcement mechanism is universal — nothing in store-tree code can write to substrate any other way. MCP is the most prominent entry point but not the only one.
- **Both reads and writes route through.** Writes carry full ceremony (guard + audit + `MutationContext`); reads carry minimal ceremony (`ReadContext`, no audit, no guard). Trivial key-based reads are ~5-line passthroughs.
- **Substrate is layered.** Three substrate-specific `SubstrateAccess` implementations behind one capability interface. The seam is the abstraction, not the implementation.
- **MCP surfaces are preserved.** Both `memory_*` and `agentdb_*` keep their existing tool surfaces and parameter shapes — no consumer migration required.

## The substrate seam

The fork-authored hive-mind primitive (`withHiveStoreLock` + `saveHiveState` at `hive-mind-tools.ts:1173-1259`, per ADR-0095) is the most mature substrate code in the codebase — but it lives *inside an MCP-tool handler* because it was needed before the archivist abstraction existed. The migration **extracts** this primitive to `makeFsJsonSubstrate`; hive-mind then becomes a consumer of it like every other store. The primitive doesn't generalize as a single universal substrate (forcing the same lock+WAL above SQLite/RVF either serializes or under-coordinates), but it does generalize as the FS-JSON-substrate implementation.

The seam is **`SubstrateAccess.withWrite<T>(fn)`**, with three substrate-specific implementations:

```typescript
// archivist/substrate-internal.ts (path-restricted per §Type enforcement)
export interface SubstrateAccess {
  /** Atomic, isolated, durable mutation. Substrate-appropriate exclusion;
   *  commits on `fn` return; leaves prior state intact on throw.
   *  Cache invalidation runs only after commit. */
  withWrite<T>(fn: (handle: SubstrateHandle) => Promise<T>): Promise<T>;
  /** Bulk variant — one audit summary, not N. See §Re-entrancy and bulk mode. */
  withBulkWrite<T>(intent: BulkIntent, fn: (h: SubstrateHandle) => Promise<T>): Promise<T>;
}

// archivist/substrates/fs-json-store.ts — primitive extracted from hive-mind-tools.ts:1173 (ADR-0095)
export function makeFsJsonSubstrate<S>(path: string, cache: Map<string, S>): SubstrateAccess {
  return {
    async withWrite(fn) {
      return withFileLock(`${path}.lock`, async () => {
        const handle = {
          read: () => loadJson(path),
          write: (s: S) => saveJsonAtomic(path, s, cache),
          // saveJsonAtomic = openSync+writeSync+fsyncSync+closeSync+rename;
          // cache.set ONLY after the rename succeeds.
        };
        return await fn(handle);
      });
    },
    withBulkWrite(_intent, fn) { return this.withWrite(fn); /* archivist emits manifest */ },
  };
}

// archivist/substrates/sqlite-store.ts
export function makeSqliteSubstrate(db: BetterSqlite3.Database): SubstrateAccess {
  return {
    async withWrite(fn) {
      // db.transaction wraps BEGIN IMMEDIATE / COMMIT / ROLLBACK; SQLite's
      // own file lock handles cross-process. No O_EXCL above it — would deadlock.
      let result: unknown;
      db.transaction(() => { result = await fn({ db }); })();
      return result as T;
    },
    withBulkWrite(_intent, fn) { return this.withWrite(fn); },
  };
}

// archivist/substrates/rvf-store.ts
export function makeRvfSubstrate(backend: RvfBackend): SubstrateAccess {
  return {
    async withWrite(fn) {
      // ingestBatch is internally serialized in the Rust crate; cache-after-success
      // is wired at RvfBackend.ts:310 (cachedCount++ on success).
      return await fn({ rvf: backend });
    },
    withBulkWrite(_intent, fn) { return this.withWrite(fn); },
  };
}
```

**Why not a single universal implementation:**

| Substrate | What it already provides | What the archivist adds |
|---|---|---|
| **File-system JSON** (~18 stores: claims, tasks, agents, swarm, coordination, workflow, neural, github, performance, system, config, progress, ruvllm, daa, wasm, browser, autopilot, **plus hive-mind**) | One mature implementation in-place: hive-mind has full lock+WAL+tmp+rename+fsync+cache-after-success (~94 KB fork-authored code at `hive-mind-tools.ts:1173-1259`, per ADR-0095). The other ~17 split into naive `writeFileSync` (~12: claims, tasks, neural, github, performance, system, config, ruvllm, browser, …) and partial implementations (~4: swarm has tmp+rename without fsync; workflow + wasm have pid lock without rename; daa has tmp+rename without lock). Append-log variant: autopilot uses state.json + log.jsonl. | **Extract** the fork's hive-mind primitive from `hive-mind-tools.ts:1173-1259` into `makeFsJsonSubstrate`. All ~18 stores (including hive-mind) consume it via `SubstrateAccess.withWrite`. Hive-mind's MCP-tool file loses ~490 LoC of substrate machinery (per Q7 measurement; earlier "~2400" estimate was 5× over); gains a clean `ctx.substrate.withWrite(...)` dispatch. Fixes latent silent-loss bugs across the ~12 naive stores. |
| **SQLite** (5 carve-out controllers per ADR-0166 `PERMANENT_SQLITE_CARVE_OUT`: CausalMemoryGraph, CausalRecall, NightlyLearner, LearningSystem aggregations, ReasoningBank GROUP BY — running on better-sqlite3 with sql.js as fallback per ADR-0177; ADR-0170's postgres move was superseded) | `db.transaction` for atomicity + isolation + WAL durability; SQLite's own file lock for cross-process | Just `db.transaction(fn)` wrapping. Adding O_EXCL above would deadlock multi-store compositions. |
| **RVF** (vector + content stores) | Crash-safe binary format + fsync + atomic file at the Rust crate's N-API boundary | Pass-through. JS-layer locks would duplicate crate-internal serialization and race against pending-queue flushes. |

The TieredCache invalidation hook (§TieredCache and invalidation) is present in `makeFsJsonSubstrate` and absent (intentionally) in the other two — that asymmetry is real and documented in the `MODULE.md` charter, not papered over.

## How a write flows end-to-end

**Status (2026-05-18):** the `memory_*` mutating tools are wired end-to-end through this sequence. Per [ADR-0183](../../../adr/export/html/ADR-0183-memory-write-path-unification.html) (completed 2026-05-17), the router shim `routeMemoryOp({type:'store', ...})` no longer holds the substrate write; it dispatches through `archivist.dispatch('memory_store', payload, ctx)`, and the handler at `forks/agentdb/src/archivist/handlers/memory/store.ts` owns both the row insert and the RC-2 upsert via the rvf substrate in one atomic mutation. The ADR-0086 behavioural conformance test's `store`/`update` methods were dropped from the "required on the router shim" list as a consequence — those operations now live behind `archivist.dispatch`, not on the router's surface. Hive-mind consensus follows the same shape: the handler ports live under `forks/agentdb/src/archivist/handlers/hive-mind/consensus/<strategy>.ts` ([ADR-0184](../../../adr/export/html/ADR-0184-hive-mind-consensus-handler-port.html), [ADR-0185](../../../adr/export/html/ADR-0185-hive-mind-consensus-cli-retirement.html)).

Every write — regardless of caller surface — flows through the archivist with this sequence:

![write-flow-with-full-ceremony](diagrams/memory-coordinator-architecture/write-flow-with-full-ceremony.png)

<details>
<summary>Mermaid Source</summary>

```mermaid
%%{init: {"theme": "base", "themeVariables": {"primaryColor":"#E3F2FD","actorBkg":"#E1F5FE","actorBorder":"#0277BD","actorTextColor":"#01579B","sequenceNumberColor":"#1565C0","fontFamily":"Inter, sans-serif"}}}%%
sequenceDiagram
    accTitle: Write flow with full ceremony
    accDescr: A mutation passes through the Archivist boundary - opens audit, runs guards, dispatches to the store via SubstrateAccess, invalidates cache, fires post-write triggers, closes audit

    autonumber

    participant Caller as Caller<br/>(MCP / CLI / hook / daemon / cascade)
    participant Arch as Archivist
    participant Guard as MutationGuard
    participant Audit as AttestationLog<br/>(JSONL + fcntl)
    participant Store as Store handler<br/>(GuardedWrite type)
    participant Sub as SubstrateAccess<br/>(FS-JSON / SQLite / RVF)
    participant Cache as TieredCache
    participant Post as Post-write triggers<br/>(SkillLibrary auto-promote)

    Caller->>Arch: dispatch(intent, payload)

    Arch->>Audit: openEntry intent
    Note over Audit: write to JSONL page cache then fsync batched

    Arch->>Guard: check intent + payload
    Guard-->>Arch: GuardVerdict array

    alt any veto
        Arch->>Audit: closeEntry rejected + verdicts
        Arch-->>Caller: error with verdicts
    else all pass or warn
        Arch->>Store: handler payload + ctx

        Store->>Sub: withWrite fn
        Note over Sub: substrate-shaped exclusion per impl

        alt write succeeds
            Sub-->>Store: ok
            Store-->>Arch: result
            Arch->>Audit: closeEntry applied + result
            Arch->>Cache: invalidate storeId + namespace
            Arch->>Post: trigger result async
            Arch-->>Caller: result
        else write fails
            Sub-->>Store: error
            Store-->>Arch: error
            Arch->>Audit: closeEntry failed or partial
            Arch-->>Caller: error - no compensating writes
        end
    end
```

</details>

Three properties of this sequence are load-bearing:

1. **Audit opens before substrate write, closes after.** A crash between open and close leaves a *dangling intent* — recoverable via replay or operator-visible by the §Confirmation gate.
2. **No automatic compensating writes on failure.** Counter increments, autoincrement IDs, and downstream auto-promotion triggers cannot be cleanly inverted. The audit chain records the *attempt* (state: `failed` or `partial`) with operator-visible alarm; replay is a verification tool, not a recovery tool. (Aligns with `feedback-data-loss-zero-tolerance` — fail loud, never silently compensate.)
3. **Post-write triggers run async.** Skill auto-promotion, embedding-cache warmup, etc. fire off the hot path with their own audit entries (children of the original via `MutationContext.child()`; see §Re-entrancy).

## Type enforcement

The archivist's type-enforcement claim is **narrower and more defensible** than "the compiler rejects any bypass". The honest claim is: *no store-tree code can obtain a substrate handle except through `MutationContext`, under the project's tsconfig*. Defeats via `as any`, `eval`, runtime module loading, and outer-scope handle-stashing are caught by ESLint, runtime backstops, or code review — not by the compiler alone.

### The substrate-handle pattern

![type-enforcement-layers](diagrams/memory-coordinator-architecture/type-enforcement-layers.png)

<details>
<summary>Mermaid Source</summary>

```mermaid
---
config:
  layout: elk
---
%%{init: {"theme": "base", "themeVariables": {"primaryColor":"#E3F2FD","primaryTextColor":"#0D47A1","primaryBorderColor":"#1565C0","lineColor":"#37474F","fontFamily":"Inter, sans-serif"}}}%%
flowchart LR
    accTitle: Type enforcement layers
    accDescr: Five layers of enforcement from compile-time path restriction through runtime context assertion

    L1["L1: Path restriction<br/>tsconfig allowlist<br/>archivist/** only"]:::security
    L2["L2: Branded types<br/>GuardedWrite&lt;T&gt;,<br/>GuardedRead&lt;T,R&gt;,<br/>SubstrateAccess"]:::security
    L3["L3: Store barrel typing<br/>Record&lt;string,<br/>GuardedWrite | GuardedRead&gt;"]:::security
    L4["L4: ESLint rules<br/>no-restricted-imports,<br/>no-restricted-syntax for casts"]:::process
    L5["L5: Runtime ctx assert<br/>handler throws if<br/>ctx undefined"]:::process

    L1 --> L2 --> L3 --> L4 --> L5

    Bypass1["Direct import<br/>(blocked at L1)"]:::error
    Bypass2["Raw mutation export<br/>(blocked at L2/L3)"]:::error
    Bypass3["as any cast<br/>(blocked at L4 + L5)"]:::error
    Bypass4["Outer-scope stash<br/>(blocked at L4 + review)"]:::warning
    Bypass5["eval / dynamic import<br/>(not blocked — review only)"]:::warning

    Bypass1 -.- L1
    Bypass2 -.- L2
    Bypass3 -.- L4
    Bypass4 -.- L4
    Bypass5 -.- L5

    classDef security fill:#E0F2F1,stroke:#00695C,stroke-width:2px,color:#004D40
    classDef process fill:#E1F5FE,stroke:#0277BD,stroke-width:2px,color:#01579B
    classDef error fill:#FFCDD2,stroke:#C62828,stroke-width:2px,color:#B71C1C
    classDef warning fill:#FFF9C4,stroke:#F9A825,stroke-width:2px,color:#F57F17
```

</details>

### Registration sketch

```typescript
// archivist/handle.ts
declare const SubstrateAccessBrand: unique symbol;
export type SubstrateAccess = {
  readonly [SubstrateAccessBrand]: never;
  withWrite<T>(fn: (h: SubstrateHandle) => Promise<T>): Promise<T>;
  withBulkWrite<T>(intent: BulkIntent, fn: (h: SubstrateHandle) => Promise<T>): Promise<T>;
};

declare const GuardedWriteBrand: unique symbol;
export type GuardedWrite<T> =
  ((payload: T, ctx: MutationContext) => Promise<Result>)
  & { readonly [GuardedWriteBrand]: true };

declare const GuardedReadBrand: unique symbol;
export type GuardedRead<T, R> =
  ((query: T, ctx: ReadContext) => Promise<R>)
  & { readonly [GuardedReadBrand]: true };

export interface MutationContext {
  readonly auditId: string;
  readonly originatingTool: string;
  readonly guardVerdicts: ReadonlyArray<GuardVerdict>;
  readonly timestamp: number;            // captured at intent-open
  readonly substrate: SubstrateAccess;   // ONLY source of substrate handle
  child(reason: string): MutationContext;  // for re-entrant nested writes
}

export interface ReadContext {
  readonly originatingTool: string;
  readonly requestId: string;
  readonly intent?: ReadIntent;
  readonly cacheHints?: CacheHints;
  // No substrate field on read paths — reads use a ReadOnlySubstrateAccess
  // delivered the same way but typed differently.
}

export function registerMutationHandler<T>(
  intent: MutationIntent,
  handler: (payload: T, ctx: MutationContext) => Promise<Result>,
  options?: { hotPath?: boolean; cacheScope?: 'namespace' | 'store' | 'global' },
): GuardedWrite<T>;

export function registerReadHandler<T, R>(
  intent: ReadIntent,
  handler: (query: T, ctx: ReadContext) => Promise<R>,
  options?: { cacheTtlMs?: number },
): GuardedRead<T, R>;
```

### The escape hatch

Migrations, bulk imports, and repair scripts that legitimately need raw substrate access import from a separate `@pkg/substrate-admin` entrypoint that is **unresolvable under the main tsconfig** (allowlisted to `scripts/`, `migrations/`, `cli/admin/` via a separate `tsconfig.admin.json` project reference). Each admin invocation writes a synthetic audit entry — `{ tool: 'admin:<script>', operator, sha, processRole: 'admin' }` — so privileged actions remain on the chain.

**What's enforced where:**

| Defeat attempt | Caught by | When |
|---|---|---|
| `import { db } from '../substrate-internal'` in a store file | TypeScript compiler (tsconfig path restriction) | Compile time |
| Exporting a raw mutation function from a store barrel | TypeScript compiler (branded `GuardedWrite<T>` types) | Compile time |
| Constructing `SubstrateAccess` outside the archivist | TypeScript compiler (unique-symbol brand has no public constructor) | Compile time |
| `import Database from 'better-sqlite3'` outside `archivist/**` | ESLint `no-restricted-imports` | `npm run test:unit` + `npm run release` preflight |
| `as unknown as SubstrateAccess` cast | ESLint `no-restricted-syntax` on the brand symbol | `npm run test:unit` + `npm run release` preflight |
| Handler stashing `ctx.substrate` in module-scope state | ESLint rule flagging outer-scope assignment | `npm run test:unit` + `npm run release` preflight |
| `eval` / dynamic-import escape | Code review only | Review |
| `as any` cast in a handler | Runtime `MutationContext` assertion (handler throws on undefined `ctx`) | Runtime |

## The audit chain

A **single append-only JSONL file** at `<memoryRoot>/data/archivist-audit.jsonl` is the system's source of truth for "what mutations happened". Both the cli process and the `ruflo daemon` process write to it; cross-process ordering is established by `fcntl` advisory write-locks acquired only around `write()`+`fsync()`.

The `<memoryRoot>` resolution lives in `forks/ruflo/v3/@claude-flow/cli/src/memory/memory-router.ts` and is exposed via the public `getMemoryRoot()` export (added 2026-05-18 as an ADR-0186 follow-up; `_getMemoryRoot` remains the internal implementation). Precedence order (from `memory-router.ts` ~L434-450): `CLAUDE_FLOW_MEMORY_PATH` env var, then `config.json`'s `memory.persistPath`, then the default `.swarm` directory inside the project. The archivist obtains the root through this helper at process start so that all four entry points ([ADR-0181](../../../adr/export/html/ADR-0181-archivist-runtime-activation.html)) resolve the same audit log under the same precedence.

![audit-chain-write-through-with-fcntl-advisory-locking](diagrams/memory-coordinator-architecture/audit-chain-write-through-with-fcntl-advisory-locking.png)

<details>
<summary>Mermaid Source</summary>

```mermaid
%%{init: {"theme": "base", "themeVariables": {"primaryColor":"#E3F2FD","actorBkg":"#E0F2F1","actorBorder":"#00695C","actorTextColor":"#004D40","sequenceNumberColor":"#00695C","fontFamily":"Inter, sans-serif"}}}%%
sequenceDiagram
    accTitle: Audit chain write-through with fcntl advisory locking
    accDescr: Audit entries open intent, write through to JSONL with fcntl locking, fsync batched ≤100ms

    autonumber

    participant Arch as Archivist
    participant Buf as 256-entry queue<br/>(producer-side)
    participant Fd as Audit fd<br/>(.claude-flow/data/archivist-audit.jsonl)
    participant Lock as fcntl advisory lock
    participant Timer as fsync timer<br/>(≤100ms)

    Arch->>Buf: enqueue({ auditId, processId, intent, ts, ... })
    Note over Buf: bounded 256, single producer<br/>p99 lock wait ≈ low single-digit ms

    Buf->>Lock: acquire F_OFD_SETLKW
    Note over Lock: microsecond window<br/>only for write+fsync pair

    Lock->>Fd: write(JSON.stringify(entry) + '\n')
    Note over Fd: enters page cache<br/>survives SIGKILL/OOM

    Fd->>Lock: release F_OFD_SETLK
    Lock->>Timer: schedule fsync if not pending

    Timer->>Fd: fsync(fd) [batched, off hot path]
    Note over Fd: durable to disk
```

</details>

### Entry shape

```jsonl
{"auditId":"a1b2","processId":{"pid":42,"role":"cli","sessionId":"s1"},"parentAuditId":null,"contextVersion":1,"timestamp":1715620000000,"originatingTool":"memory_store","intent":{"type":"store","namespace":"session","keyHash":"..."},"state":"intent"}
{"auditId":"a1b2","timestamp":1715620000003,"guardVerdicts":[{"guard":"size","outcome":"pass"}],"state":"applied","result":{"id":"mem-...","embeddingModel":{"name":"all-mpnet-base-v2","version":"1.0"}}}
```

Two records per intent — one `intent`, one `applied`/`partial`/`failed`/`rejected`. A dangling `intent` (no closing record) indicates a crash between substrate-write and audit-close; the §Confirmation replay surfaces these.

### What MUST be recorded for replay

| Field | Why |
|---|---|
| Generated ID (random or `lastInsertRowid`) | Replay against fresh substrate cannot regenerate deterministically |
| Timestamp at intent-open | Downstream stores must NOT call `Date.now()` themselves |
| Embedding model identity `{name, version, dimension}` | Embedding generation is model-version-dependent |
| Resolved substrate (RVF vs SQLite vs FS-JSON) | Substrate routing can change across deploys |
| Caller payload (post-normalization) | Replay must re-derive write without re-running non-deterministic pre-write transforms |
| `processId` (pid + role + sessionId) | Multi-process debugging, shutdown recovery |
| `parentAuditId` (nullable) | Re-entrancy tree reconstruction |
| `contextVersion` (default `1`) | Schema-evolution lazy upgrade chain |

### Retention policy

| Setting | Default | Notes |
|---|---|---|
| Per-file rotation | 100 MiB | rotates to `archivist-audit.<n>.jsonl` |
| `maxTotalBytes` | 1 GiB | combined size budget; eviction at 95% high-water |
| `maxAgeDays` | 90 days | time-expired rotated files evicted first |
| Active file | **never auto-evicted** | even if alone exceeds budget |
| `floor.marker` | always written | names the evicted predecessor, surfaces "pre-floor: opaque" in replay reports |
| Backup | operator responsibility | not auto-backed-up; target `$RUFLO_HOME/audit/` |

CLI: `ruflo archivist purge [--older-than <dur>] [--keep-last <n>] [--dry-run]` (refuses active file; self-audits purge event) and `ruflo archivist export --since <ts>` to snapshot before destructive ops.

Failure modes: **disk-full** triggers force-eviction (ignoring age budget) and, if necessary, `degraded.audit` mode that stamps decisions `audit-deferred: true` rather than blocking — never silently drops. **Chain breaks** (manual deletion, corruption) block daemon startup unless `--allow-broken-audit-chain` is passed (writes a `recovery.marker` for post-incident review).

## Re-entrancy and bulk mode

Some intents fan out to additional substrate writes (NightlyLearner.run cascades through Causal + Reflexion + SkillLibrary; SkillLibrary.consolidateEpisodesIntoSkills writes skills + embeddings + graph + vector). Other intents touch hundreds of rows in a single logical operation (`SyncCoordinator.applyChanges` writes 4 tables; `agentdb migrate` bulk-copies rows).

### Nested context (`ctx.child()`)

```typescript
// Inside a write handler:
async function nightlyLearnerRun(payload, ctx: MutationContext) {
  // Each child write gets a fresh auditId, parentAuditId = ctx.auditId
  await consolidateEpisodes(ctx.child('consolidate-episodes'));
  await discoverCausalEdges(ctx.child('discover-causal-edges'));
  await pruneEdges(ctx.child('prune-edges'));
  return { ok: true };
}
```

The audit chain reconstructs as a **tree, not a flat list**. Replaying a parent re-applies its children in recorded order; the §Confirmation gate asserts the operation tree matches the audit tree exactly.

**Important non-re-entrancy:** writing SQL + vector + graph in one controller method (e.g., `ReflexionMemory.recordEpisode`) is NOT re-entrancy — it's one atomic intent touching multiple substrate tables. It gets ONE audit entry. The distinction: re-entrancy crosses **handler boundaries** (one handler invokes another's `GuardedWrite<T>`); same-controller multi-substrate stays within one handler.

### Bulk mode (`ctx.bulk()`)

```typescript
// SyncCoordinator pull writes 1000 rows across 4 tables; one audit entry, not 4000
async function applyChanges(payload, ctx: MutationContext) {
  return ctx.substrate.withBulkWrite(
    { intent: 'sync-pull', count: 1000, tables: ['episodes','skills','skill_edges','sync_state'] },
    async (handle) => {
      // bulk operation; archivist records a manifest, not per-row entries
      for (const row of payload.rows) await handle.db.prepare('INSERT OR REPLACE INTO ...').run(...);
    }
  );
}
```

The audit entry carries `{ count, checksum, tableName }` per touched table. Replay asserts manifest-equality (row count + checksum per table), not per-row equality.

## The hot-path fast-path

Two hooks fire on every Claude Code lifecycle event and have a <2ms latency ceiling: `post-edit` (every `Edit`/`Write`/`MultiEdit`) and `pre-task` (every Agent invocation). Full archivist ceremony per call (guard + audit + post-write triggers) is incompatible with these budgets.

### Fast-path opt-in

```typescript
registerMutationHandler('post-edit-trajectory', handler, { hotPath: true });
```

Hot-path handlers get:

- **MutationGuard skipped** (caller asserts no guard required at registration)
- **Post-write triggers run async** via `setImmediate` — failure doesn't block the write
- **No nested `MutationContext.child()`** (compile-time forbidden via `never`-typed `child` on hot contexts)
- **Bounded payload** ≤4KB (larger payloads divert to cold path at runtime)

### Latency budget

| Percentile | Target | Notes |
|---|---|---|
| p50 | ≤300μs | Ring-buffer enqueue + context alloc + audit-entry shape + JSON of ≤2KB payload, no I/O |
| p99 | ≤2ms | Matches existing `pending-insights.jsonl` `appendFileSync` ceiling — headroom for fsync-drain lock, GC, log rotation |
| p99.9 | ≤5ms | Soft-alert ceiling |

### Microbenchmark gate

`forks/<archivist-package>/bench/hot-path.bench.ts` runs 10K iterations and asserts the three percentiles AND that the archivist matches or beats `fs.appendFileSync` baseline. Wired into `npm run release` preflight; not run on every push (10K iterations × 2 paths × warmup ≈ 30s wall-clock). Regressions block release.

### Cross-process contention variant

A second benchmark, `forks/<archivist-package>/bench/hot-path-contended.bench.ts`, runs the same 10K loop with two concurrent contenders against the audit log's `fcntl F_OFD_SETLKW` advisory write-lock:

1. **Daemon-process simulator** firing scheduled writes at the daemon cadence
2. **Post-edit storm fixture** firing one hook payload every 50ms for the bench duration

The contended variant asserts p99 ≤ 5ms (relaxed from <2ms — explicit contention budget) **and** that the single-process baseline measured in the same run stays within its <2ms p99 band. If single-process p99 holds but contended p99 exceeds 5ms, the gate fails with "lock contention exceeds budget" and Phase 7 release blocks until either the lock-acquisition path is optimized or the contended ceiling is renegotiated by ADR amendment.

Without this variant, the single-process W3 number would be a paper budget. The real workload — cli + daemon + hook storm — needs explicit gating.

### Two-stage journal

![hot-path-write-through-journal](diagrams/memory-coordinator-architecture/hot-path-write-through-journal.png)

<details>
<summary>Mermaid Source</summary>

```mermaid
---
config:
  layout: elk
---
%%{init: {"theme": "base", "themeVariables": {"primaryColor":"#E3F2FD","primaryTextColor":"#0D47A1","primaryBorderColor":"#1565C0","lineColor":"#37474F","fontFamily":"Inter, sans-serif"}}}%%
flowchart LR
    accTitle: Hot-path write-through journal
    accDescr: Hot-path writers enqueue to 256-entry queue then write through to audit fd with batched fsync; cold path runs full ceremony

    HotCaller["Hot caller<br/>(post-edit, pre-task)"]:::service
    Queue["256-entry queue<br/>(bounded, single-producer)"]:::process
    WriteThrough["write() to audit fd<br/>(~50µs, page cache)"]:::process
    FsyncTimer["fsync timer<br/>(≤100ms, off hot path)"]:::process
    Disk[("audit log durable")]:::data

    HotCaller -->|enqueue| Queue
    Queue -->|drain immediately| WriteThrough
    WriteThrough -->|defer fsync| FsyncTimer
    WriteThrough -->|in page cache| Disk
    FsyncTimer -->|periodic| Disk

    ColdCaller["Cold caller<br/>(MCP, CLI, daemon)"]:::service
    FullCeremony["Full ceremony<br/>(guard + audit + sync fsync<br/>+ post-write triggers)"]:::process

    ColdCaller --> FullCeremony --> WriteThrough

    classDef service fill:#E8F5E9,stroke:#2E7D32,stroke-width:2px,color:#1B5E20
    classDef process fill:#E1F5FE,stroke:#0277BD,stroke-width:2px,color:#01579B
    classDef data fill:#FFF8E1,stroke:#F57F17,stroke-width:2px,color:#E65100
```

</details>

The 256-entry queue size is from the burst envelope: ~100 Edits/sec worst-case × ~50µs/entry = queue depth never exceeds ~5. The bound is 50× over the realistic burst. Backpressure (rare): bounded `O(µs)` producer block on `fcntl` lock acquisition.

## Quota and error contracts

If substrate is full (ENOSPC, SQLITE_FULL, RVF segment-cap, EDQUOT), the archivist surfaces a `QuotaExhaustedError` with structured backoff hints:

```typescript
class QuotaExhaustedError extends ArchivistError {
  constructor(
    readonly substrate: 'sqlite' | 'rvf' | 'fs-json',
    readonly reason: 'disk_full' | 'sqlite_max_page' | 'rvf_segment_limit' | 'fs_quota',
    readonly hint: BackoffHint,
    readonly attemptedAuditId: string,
  ) { super(`Substrate ${substrate} exhausted: ${reason}`); }
}

interface BackoffHint {
  retryAfterMs?: number;          // never set for disk_full — operator action required
  sheddable: boolean;             // hot-path writers skip on true to preserve budget
  suggestion: 'evict' | 'compact' | 'rotate' | 'fail';
}
```

**Audit behavior:** the entry IS opened pre-write and completed with `state: 'failed', reason: 'quota_exhausted'`. "Never opened" was rejected because it breaks the §Confirmation "audit count = mutation call count" invariant.

**MCP client shape:** `{ isError: true, content: [...], _meta: { errorCode: 'QUOTA_EXHAUSTED', substrate, reason, retryAfterMs, sheddable } }`. Existing MCP callers already handle `isError: true` — no migration cost.

**Out of scope:** quota *prediction* (pre-write capacity probe). Every substrate's "is there room" check is racy and substrate-specific; deferred to a future quota-aware guard verdict.

## How a read flows

Reads route through the archivist too, but with much lighter ceremony — no audit, no guard. Trivial key-based reads are ~5-line passthroughs; semantic-search reads compose BM25+vector fusion and attach provenance at the boundary.

### Return shape

```typescript
interface RankedResult<T> {
  readonly item: T;
  readonly score: number;                // normalized [0,1], higher = better
  readonly provenance: {
    readonly storeId: string;            // which store produced this candidate
    readonly matchType: 'bm25' | 'semantic' | 'exact' | 'graph' | 'hybrid';
    readonly rawScore: number;           // store-native score before normalization
    readonly rank: number;               // 1-indexed rank within this store's response
    readonly matchedField?: string;
    readonly explanation?: string;       // optional human-readable rationale
  };
}

export type RankedResults<T> = ReadonlyArray<RankedResult<T>>;

// Stores expose reads as:
export type GuardedRead<T, R> =
  ((query: T, ctx: ReadContext) => Promise<R>)
  & { readonly [GuardedReadBrand]: true };
// where R = RankedResults<Item> for semantic-search tools
```

### Cross-store fusion: Reciprocal Rank Fusion (RRF)

When multiple stores answer a query, the archivist combines results via RRF:

`score = Σ_s w_s / (k + rank_s)`, with `k=60` (Cormack default) and per-store weights `w_s` from archivist config.

**Why RRF over weighted score:**
- Scale-free — BM25 returns unbounded log-tf scores while cosine returns [0,1]; normalizing across both is fragile
- Only needs ranks, not raw scores — robust to score-distribution differences
- Standard hybrid-search choice (Elastic, Vespa, Weaviate)
- Degrades gracefully when one store returns nothing

The archivist performs dedup (by item id) and RRF combination; stores contribute ordered candidates with raw scores only.

### Minimum store contract

- **Pure-vector store** (semantic): returns top-K by cosine/dot, `matchType: 'semantic'`, `rawScore` = similarity. RRF only consumes the ordering — semantic ranking participates natively.
- **Pure-BM25 store**: returns top-K by BM25, `matchType: 'bm25'`, `rawScore` = BM25 score. Same path.
- **Stores that don't support a query type**: return `[]` cleanly. Archivist treats absent stores as zero-contribution.

### Client-facing return shape — dual

MCP read tools keep their existing `{ id, content, score }[]` shape by **default** (backward compat — ADR-0180's "MCP surfaces preserved unchanged" promise). An `includeProvenance: true` parameter returns the full `RankedResult` shape for clients that need it.

#### Provenance rollout scope (2026-05-14 audit)

The flag must be wired across **15 ranked-read tools** spanning three migration phases:

| Phase | Surface | Tools | Est. LoC |
|---|---|---|---|
| 3 | `memory_*` | `memory_search`, `memory_retrieve`, `memory_list`, `memory_search_unified`, `memory_bridge_status` | ~210 |
| 4 | `hive-mind_*` (read mode) | `hive-mind_memory`, `hive-mind_consensus` | ~140 |
| 6 | `agentdb_*` | `agentdb_filtered_search` (BM25+semantic fusion site — provenance mandatory per ADR-0179), `agentdb_pattern_search`, `agentdb_reflexion_retrieve`, `agentdb_skill_search`, `agentdb_causal_recall`, `agentdb_hierarchical_recall`, `agentdb_neural_patterns` (read-only; provenance applies to the `similar` action only), `agentdb_semantic_route` | ~315 |
| **Total** | | **15 tools** | **~665 LoC** |

Per-tool: ~40-50 LoC each — schema addition (`includeProvenance?: boolean`, default `false`), handler-side passthrough of `RankedResult` vs flattened legacy shape, two unit tests per tool (legacy shape with no flag, full shape with `includeProvenance: true`). Spot-counted on three representative tools: `memory_search` ~45 LoC, `agentdb_filtered_search` ~50 LoC, `hive-mind_memory` ~42 LoC.

### Cache writes during reads — persistence-boundary rule

A READ-classified tool MAY mutate **in-memory caches** (QueryOptimizer, LRU embedding cache, telemetry counters, re-rank buffers) without invoking MutationGuard or AttestationLog. The classification test is **persistence**:

> *If the write survives `process.kill()`, it is a mutation. If it dies with the process, it is a cache.*

In-process caches are derivable from durable substrate, lost on restart, and auditing them produces churn without truth. AttestationLog records one event per persistent mutation; cache populations during reads surface as `ReadContext.cacheHints: { wrote_cache, cache_keys }` — advisory observability only.

**Edge case explicitly flagged:** if any future controller adds *disk-backed* cache (e.g., `~/.cache/ruflo/embed.sqlite`), that controller MUST be re-classified MUTATING regardless of the tool's surface name. The surface-name → classification map is not load-bearing; the persistence-boundary test is.

Currently classified READ today (correctly): `memory_search` (QueryOptimizer cache mutation), `agentdb_embed` (LRU cache), `agentdb_filtered_search` (delegates to substrate read + in-memory metadata filter). No re-classification needed; this rule codifies the *why*.

## TieredCache and invalidation

The TieredCache is a **single process-wide cache owned by the archivist**, not per-store. Per-store caches would force fan-out invalidation through every store on every mutation — the upstream failure mode.

### Cache key

```typescript
type CacheKey = {
  storeId: StoreId;                       // discriminates stores sharing namespace strings
  namespace: Namespace;                   // brand-matches the store's mutation namespace
  queryFingerprint: string;               // xxhash64 of canonicalized read intent
};
```

### Invalidation triggers

- Every `applied` write (and every `partial` write — partial is still a substrate mutation) emits **one invalidation event** keyed by `{ storeId, namespace }`.
- `intent` and `failed` audit states do **NOT** invalidate (no substrate effect).
- The post-write hook fires AFTER state transitions to `applied|partial`, BEFORE post-write triggers (SkillLibrary auto-promotion etc.) — so cascaded reads inside the same intent see a clean cache.
- `bulk()` mutations emit ONE coarse event per `(storeId, namespace)` touched by the manifest, not N row-events.
- Stores declare `cacheScope: 'namespace' | 'store' | 'global'` on `registerMutationHandler` — default `namespace`; `store` widens to all namespaces in the store (counter-style writes that affect rankings cross-namespace); `global` is the escape hatch (schema migrations).

### TTL

Soft 5-min TTL as a safety net for residual cases mutation-driven invalidation doesn't cover (clock skew under multi-process audit composition, unguarded reads from the admin escape hatch). **TTL is NOT the primary correctness mechanism** — invalidation events are. Hot-path `agentdb_route` reads opt out of caching entirely (no entry written) since route latency budgets are tighter than cache-lookup overhead.

### Re-entrancy

`MutationContext.child(reason)` invalidates at the child's `applied|partial` transition just like a top-level intent — children invalidate independently. Reads in the parent's continuation see the child's invalidations because invalidation is synchronous within the archivist's per-intent serial orchestration.

This matches `feedback-data-loss-zero-tolerance`: a cached result returned to a caller after a known-invalidating mutation in the same logical operation is a correctness bug, not just staleness.

## The six restored features

The six features lost in [ADR-0085](../../../adr/export/html/ADR-0085-bridge-deletion-ideal-state-gaps.html)'s bridge deletion all land at the archivist — one auditable location, not scattered across the ~200+ call sites.

![six-restored-features-at-the-archivist-boundary](diagrams/memory-coordinator-architecture/six-restored-features-at-the-archivist-boundary.png)

<details>
<summary>Mermaid Source</summary>

```mermaid
---
config:
  layout: elk
---
%%{init: {"theme": "base", "themeVariables": {"primaryColor":"#E3F2FD","primaryTextColor":"#0D47A1","primaryBorderColor":"#1565C0","lineColor":"#37474F","fontFamily":"Inter, sans-serif"}}}%%
flowchart TB
    accTitle: Six restored features at the archivist boundary
    accDescr: Pre-write, transactional, and post-write features grouped around the archivist with each tied to its phase

    Arch["<b>Archivist</b>"]:::process

    subgraph preWrite["Pre-write phase"]
        Guard["1. MutationGuard<br/><i>5 built-in verdicts:<br/>size, quality, PII,<br/>schema, rate-limit</i>"]:::security
    end

    subgraph duringWrite["Transactional phase"]
        Audit["2. AttestationLog<br/><i>Single JSONL,<br/>fcntl-locked,<br/>write-through journal</i>"]:::security
    end

    subgraph postWrite["Post-write phase"]
        Cache1["3. TieredCache<br/>(invalidation)"]:::process
        Promote["6. SkillLibrary<br/>auto-promotion<br/><i>async via ctx.child()</i>"]:::process
    end

    subgraph readPath["Read path"]
        Cache2["3. TieredCache<br/>(lookup)"]:::process
        Fusion["4. BM25+semantic<br/>RRF fusion (k=60)"]:::process
        Provenance["5. ExplainableRecall<br/>provenance<br/><i>per-result metadata<br/>in RankedResult</i>"]:::process
    end

    Arch --> Guard
    Arch --> Audit
    Arch --> Cache1
    Arch --> Promote

    Arch -. "read<br/>tools" .-> Cache2
    Arch -. "read<br/>tools" .-> Fusion
    Arch -. "read<br/>tools" .-> Provenance

    classDef process fill:#E1F5FE,stroke:#0277BD,stroke-width:2px,color:#01579B
    classDef security fill:#E0F2F1,stroke:#00695C,stroke-width:2px,color:#004D40
```

</details>

### MutationGuard verdict shape

```typescript
type GuardVerdict =
  | SizeVerdict
  | QualityVerdict
  | PiiVerdict
  | SchemaVerdict
  | RateLimitVerdict
  | PluginVerdict;

interface GuardVerdictBase {
  readonly guard: GuardName;
  readonly outcome: 'pass' | 'warn' | 'veto';
  readonly reason?: string;
}

interface QualityVerdict extends GuardVerdictBase {
  guard: 'quality';
  score: number;     // [0,1], propagated for handlers to branch on
  threshold: number;
}

// Algebra: ANY veto → mutation rejected; warn allows write but logs;
// guards run independently (no short-circuit) so audit captures all signals.
// Guard exception → synthetic veto (fail-closed, NOT degraded-mode allow).
```

**Plugin contract:** `archivist.registerGuard(name, fn)` from plugin init. Reserved names = the five defaults; plugins must namespace (`plugin-name/guard-name`) and emit `PluginVerdict`. Plugin guards have **no access to `SubstrateAccess`** — only intent, payload, and a read-only `MutationContext` subset (`originatingTool`, `timestamp`).

## Mutation invariants — the second correctness gate

Audit-log replay alone is **tautological**: the audit entry and the substrate mutation derive from the same handler/payload, so a handler that records `foo` but writes `bar` would replay identically and remain invisible. Replay verifies "same audit log → same substrate" — it does NOT verify "audit log captured caller intent correctly".

Mutation invariants close this gap. Each `registerMutationHandler<T>` MAY declare invariants — per-handler predicates over `(callerIntent, recordedPayload, substrateStateBefore, substrateStateAfter)`:

```ts
registerMutationHandler<MemoryStoreIntent>('memory.store', handler, {
  invariants: [
    {
      name: 'namespace-preserved',
      check: (intent, recorded) =>
        intent.namespace === recorded.namespace
          ? 'pass'
          : { violated: true, detail: `intent=${intent.namespace} recorded=${recorded.namespace}` }
    },
    {
      name: 'content-bytes-preserved',
      check: (intent, recorded) =>
        Buffer.byteLength(intent.content) === recorded.content_bytes
          ? 'pass'
          : { violated: true, detail: `intent=${Buffer.byteLength(intent.content)} recorded=${recorded.content_bytes}` }
    }
  ]
});
```

The archivist evaluates invariants at write-time BEFORE the audit entry transitions to `applied`. A violation aborts the write — recorded as `state: 'rejected', reason: 'invariant_violation', invariant: <name>` — and surfaces to the caller per `feedback-data-loss-zero-tolerance` (no silent fallthrough). Replay re-evaluates invariants against the recorded pair; live-vs-replay verdict mismatch fails the §Confirmation gate.

| Property | Guards | Invariants |
|---|---|---|
| Concern | Policy (PII, size, quality) | Correctness (intent ↔ recorded) |
| Failure mode | `outcome: 'veto' \| 'warn' \| 'pass'`, allows `warn` through | `pass` or rejection — no middle ground |
| Source of truth | Cross-cutting (across many handlers) | Per-handler (declared at registration) |
| Catches | "shouldn't happen" inputs | "handler is wrong" outputs |

**What invariants catch:** handler regression (was correct, now records wrong) and contract drift (handler's shape diverges from declared invariants).

**What invariants do NOT catch:** bugs present in the handler AND its invariants at registration time. Both live and replay produce identically-wrong outputs that satisfy identically-wrong invariants. The fully non-tautological defense is reference-impl differential testing — deferred to per-surface judgement (see ADR-0180 Follow-up #25). Invariants are the primary second gate; reference impls are escalation.

## Schema evolution

The `MutationContext` shape will change over time. Audit entries carry a top-level `contextVersion: number` (current = `1`). Within a major version, fields can be ADDED but not renamed/removed/redefined (forward-compat-only). When breaking changes are needed:

- Deliberate ADR amendment bumps `contextVersion`
- Ships an `upgradeAuditEntry(entry, fromVersion) -> entry` function in `archivist/audit-migrations.ts`
- Migration is **lazy at replay time** — the audit log on disk is never rewritten (preserves append-only + `feedback-data-loss-zero-tolerance`)
- Replay reads `contextVersion`, threads through registered upgrade chain (`upgrade1to2 ∘ upgrade2to3 …`), then dispatches to the current handler

**Replay semantics for added fields:** v2 adds a field (e.g., `replicaId`) → v1 entries get `replicaId: 'unknown'` from `upgrade1to2`. Handlers that cannot tolerate sentinels declare `minContextVersion` at registration; replaying a too-old entry records `{ state: 'failed', reason: 'context_version_below_handler_minimum' }` in the verification report and continues — replay does not abort.

**Release-pipeline gate:** "no upgrade panics" — `npm run release` preflight verifies every recorded `contextVersion` in the live audit log has a registered upgrade path to current. Release fails if a version is present in the audit log but missing from the migration registry.

## Multi-process and durability

Four entry points run as **separate processes**, all writing to the same substrate: `@sparkleideas/cli` (one-shot CLI invocations), `@sparkleideas/cli mcp start` (the MCP server), `@sparkleideas/cli daemon` (the long-lived background daemon), and `@sparkleideas/cli hooks-daemon` (the hooks worker). Per [ADR-0181](../../../adr/export/html/ADR-0181-archivist-runtime-activation.html), **each entry point initialises its own Archivist instance** — the Archivist is per-process, not a global singleton, and is not shared across processes. The substrate handles (RVF backend, SQLite db, FS-JSON locks) are owned by that process's Archivist for the process's lifetime; the audit log is the only cross-process artefact.

### Composition: shared append-only JSONL with `fcntl` advisory locking

```typescript
async function appendEntry(entry: AuditEntry): Promise<void> {
  const line = JSON.stringify(entry) + '\n';
  const fd = await fs.promises.open(AUDIT_LOG, 'a');
  try {
    await acquireWriteLock(fd);     // fcntl F_OFD_SETLKW
    await fd.write(line);            // page cache; survives SIGKILL
    await fd.sync();                  // batched ≤100ms in hot-path
  } finally {
    await releaseLock(fd);
    await fd.close();
  }
}
```

The lock window is microseconds (only the `write+fsync` pair). Intent ordering across processes is established by lock-acquisition order — the OS serializes. Replay reads the file sequentially: **append-only + lock-ordered writes mean the file IS the merge order**.

Why not per-process audit logs (option b — rejected): it makes the §Confirmation "audit-entry count equals mutation count" invariant unverifiable without an out-of-band merge step that itself must be audited — recursion. (c) per-process replay was also rejected because it gives up the cross-substrate single-chain invariant.

### File modes (per ADR-0188, 2026-05-18)

Project-local ephemeral state files written by the Archivist and its substrates use the **default `0644` mode** — this includes `archivist-audit.jsonl`, hive-mind `state.json`, claims / tasks / agents / workflow / coordination / autopilot / etc. JSON stores, and the daemon socket's sibling state files. These are not credential material and are scoped to the user's working directory (`.claude-flow/`); restricting them would break legitimate co-located readers (acceptance tests, `ruflo doctor`, hooks daemons running under the same UID) without a security benefit.

`writeFileRestricted` (mode `0600`) is reserved for genuine credential vault sites only: the terminal-tools API-key store, the session-tools refresh-token cache, and the memory-router's `chmod 0600` on the SQLite `memory.db` (when SQLite carve-outs are active). [ADR-0188](../../../adr/export/html/ADR-0188-session-state-file-mode.html) records the design intent explicitly so that future security sweeps don't reflexively chmod the ephemeral session JSON to `0600`.

### Durability scope

The archivist targets **process-level durability**, not hardware-level durability. Power loss and kernel-level events are explicitly out of scope per project policy (see [feedback-data-loss-zero-tolerance.md scope clarification 2026-05-14](../../../.claude/projects/-Users-henrik-source-ruflo-patch/memory/feedback-data-loss-zero-tolerance.md)).

| Failure mode | What's lost | In scope? |
|---|---|---|
| Normal exit / `SIGTERM` / `SIGINT` / `SIGHUP` / `beforeExit` | Nothing — hooks trigger synchronous `fsyncSync()` of the open audit fd | ✓ |
| `SIGKILL` / OOM-kill / `kill -9` | Nothing — entries already `write()`-ed survive in the OS page cache; only one in-flight `write()` (~100µs window, single entry being serialized) | ✓ |
| Kernel panic / power loss / lid-close-with-uncached-write / unplug | Up to ~100ms of hot-path entries (uncommitted fsync window) | **out of scope** |

The deliberate divergence from `pending-insights.jsonl`'s sync-per-entry `appendFileSync`: that baseline is power-loss-safe at the cost of ~1-10ms per-write latency. The archivist's batched fsync moves the cost off the hot path — `write()` alone returns in ~10-100µs — at the cost of a ≤100ms power-loss window we explicitly accept. Process crashes (the failure mode in scope) are covered by the page cache outliving the process; hardware crashes (out of scope) lose the window.

### Out of scope (trigger-bound, not unconditional)

- Cross-process `MutationContext.child()` across the cli→daemon boundary — **deferred today** (no current call site crosses processes mid-intent; daemon writes originate in the daemon). **Re-opens** if any of: **(R1)** cli enqueues daemon work mid-intent expecting child-of-parent attestation; **(R2)** an inter-controller orchestrator (NightlyLearner / MemoryConsolidation / SkillLibrary / SyncCoordinator) moves to the daemon while a cli MCP tool holds the root context; **(R3)** a hook handler relocates from cli to daemon; **(R4)** multi-host SyncCoordinator wants remote-host writes attested as children of a local intent. **Watchdogs (defense-in-depth):** **(W1)** grep gate `MutationContext.*child(.*RPC` / `enqueueWith.*auditId` / `parentAuditId :` runs in `npm run release` preflight (`scripts/ruflo-publish.sh`) and in `npm run test:unit` — match blocks release unless the head commit carries an `ADR-0180-Halt: cross-process-mcc` trailer with a paired Addendum; **(W2)** runtime warning if `MutationContext.serialize()` is invoked.
- Cross-process cache invalidation (daemon's archivist instance carries its own TieredCache; the cli's cache is not invalidated by a daemon write) — 5-min TTL bounds the staleness window

## Testing strategy

### Mock-context factory (`withTestContext()`)

Branded `MutationContext` and `SubstrateAccess` deliberately have no public constructor. Unit-testing a `GuardedWrite<T>` handler requires constructing one. The solution: a `tsconfig.test.json` project reference allowlists `**/*.{test,spec}.ts`; `@pkg/archivist/testing` is **unresolvable under the main tsconfig** (production code cannot import it). ESLint `no-restricted-imports` as defense-in-depth.

```typescript
// memoryStore.test.ts
import { withTestContext } from '@pkg/archivist/testing';
import { storeMemory } from './memoryStore';

test('storeMemory writes one audit entry with normalized payload', async () => {
  const result = await withTestContext(storeMemory, {
    namespace: 'session',
    content: '  hello  ',          // expect trim normalization
    tags: ['a', 'b'],
  });

  expect(result.audit).toHaveLength(1);
  expect(result.audit[0]).toMatchObject({
    tool: 'memory_store',
    state: 'applied',
    payload: { content: 'hello', tags: ['a', 'b'] },
  });
});
```

The helper constructs a **real branded** `MutationContext` over a synthetic `SubstrateAccess` backed by a per-test `Map`. Audit captured in-memory, guards default permissive, post-write triggers run inline. Supports `child()` re-entrancy and `bulk()` mode. Vector ops return identity. Helper lives in `archivist/testing/**` (path-restricted from production via tsconfig) and uses the same branded-type machinery as the production runtime — breaks if branding weakens, keeping test infrastructure honest.

### Three-tier replay harness

The audit-chain replay test that gates §Confirmation runs at three tiers with three cadences:

| Tier | Scope | Location | Where it runs | Budget |
|---|---|---|---|---|
| **T1: Per-surface integration** | One spec per migrated MCP surface; seeds substrate, runs representative mutation set, replays subset filtered by `originatingTool`, asserts addressable-key set-equality | `test/replay/<surface>.spec.ts` | `npm run test:unit` (diff-scoped) + `npm run release` preflight (all surfaces) | ≤90s diff-scoped |
| **T2: Top-level acceptance** | Cross-surface mutation suite (Phase 9 load scenarios A/B/C + §Confirmation suite); whole-file replay against fresh substrate | `test/replay/acceptance.spec.ts` | `npm run release` acceptance stage | ≤15min |
| **T3: Fast-mode subset** | Replays only the last 100 audit entries against a substrate snapshot | `test/replay/fast.spec.ts` | `npm run test:unit` (every run) | <30s |

**Success criteria:** (1) audit-entry count equals mutation count (or bulk-manifest equivalents); (2) addressable-key set-equality (rows-by-PK, vectors-by-ID, graph-edges-by-endpoint-pair); (3) cross-process invariant holds (audit log is the merge order).

**Explicitly excluded:** read-order, HNSW graph topology, timing-derived fields (`Date.now`-at-replay, `lastInsertRowid` resolved at replay vs original). The original-time `timestamp` field (required in `MutationContext`) is the equality anchor for time-derived state.

### Three load-test scenarios for re-entrancy + bulk mode

| Scenario | Driver | Assertions |
|---|---|---|
| **A**: `NightlyLearner.run()` | 1 invocation cascading into Causal + Reflexion + SkillLibrary child contexts | Audit-tree depth ≤ 3; mutation-count parity; p99 ≤ 1.5× pre-archivist baseline |
| **B**: `SyncCoordinator.applyChanges` 1000 rows × 4 tables | Synthetic pull payload | Exactly 4 bulk audit entries (not 4000); manifest equality on replay; ≤ 2× unguarded baseline (sublinear overhead) |
| **C**: `MemoryConsolidation.createSemanticMemory` 100 episodes | Cluster into ~10 semantic memories, each cascading through store→markConsolidated→applyForgettingCurve→vectorBackend.remove | Audit tree shape matches operation tree exactly; replay re-applies children in order; final state equals live state on `(id, embedding_id, consolidated_flag)` by PK |

Cross-scenario invariant: `audit-entry count = mutation count + bulk-entries`.

## Observability and operations

OTEL handles remote/aggregated views (spans, traces, metrics, OTLP exporters at `agentdb/src/observability/telemetry.ts`). Local operator introspection is **CLI-only**, reusing the daemon's existing Unix-domain-socket IPC at `.claude-flow/daemon.sock` — no new HTTP listener, no port collision risk, filesystem-permission authn.

### CLI commands

| Command | Purpose |
|---|---|
| `ruflo archivist status [--json] [--verbose]` | One-shot snapshot — mirrors `ruflo hive-mind status` shape |
| `ruflo archivist tail [--filter] [--since] [--follow] [-n]` | Line-delimited JSON of **committed** audit entries (does NOT stream pre-fsync ring buffer — would mislead operators on crash) |

### Exposed fields

- `archivist.{version, uptimeMs, process}`
- `auditChain.{depth, lastEntryAt, lastReplayAt, lastReplayResult}`
- `fastPath.{bufferOccupancy, lastFsyncAt, batchedFlushesLast60s, medianLatencyMs, p99LatencyMs}`
- `errors.recent[]` (kinds tied to QuotaExhausted, GuardVeto, ReplayFailure)
- `writeRates.perStore`
- `init.perTool` (lazy-per-tool init state)
- `phase` (current migration phase)

Both commands work whether the daemon is up (via socket) or down (direct audit-log read) — same fallback pattern `ruflo daemon status` uses today.

## Plugins

Third-party plugins may add tools (the marketplace pattern, [ADR-0117](../../../adr/export/html/ADR-0117-marketplace-mcp-server-registration.html)) but **cannot register typed mutation handlers** at the archivist's boundary. Public `archivist.registerStore(name, handlers)` was rejected because it would deliver `MutationContext.substrate` to arbitrary third-party code — extending the trust boundary that the entire type-enforcement claim exists to defend.

### What plugins CAN do

1. **Register their own MCP servers** via `.claude-plugin/plugin.json`. Plugin tools run in the plugin's own process and MAY call back into ruflo's MCP server as a normal MCP client — those calls route through the archivist with `originatingTool` = plugin tool name
2. **Read from any archivist-managed namespace** via the public `memory_*` / `agentdb_*` MCP surface
3. **Persist plugin-private state** in their own files / databases outside the archivist

### What plugins CANNOT do

1. Register a typed `GuardedWrite<T>` handler at the archivist's mutation-dispatch boundary
2. Define a new MCP tool *on the ruflo MCP server* that performs a guarded write (first-party only, shipped in `forks/agentdb/src/mcp/`)
3. Receive a `SubstrateAccess` handle by any means

### Plugin MCP-as-client sketch

```typescript
// example-plugin/.claude-plugin/plugin.json registers:
//   mcpServers."example-plugin" = { command: 'npx', args: ['-y', '@vendor/example-plugin'] }

import { MCPClient } from '@modelcontextprotocol/sdk/client';

const ruflo = new MCPClient({ name: 'example-plugin' });
await ruflo.connect('stdio', {
  command: 'npx',
  args: ['-y', '@sparkleideas/ruflo', 'mcp', 'start'],
});

export async function recordExampleEvent(event: ExampleEvent) {
  await ruflo.callTool('memory_store', {        // routes through archivist
    key: `example-plugin/${event.id}`,
    value: JSON.stringify(event),
    namespace: 'example-plugin',
  });
}
```

**Revisit trigger:** if a future plugin needs persistence the `memory_*` / `agentdb_*` MCP surface cannot serve (e.g., a new substrate kind beyond RVF/SQLite/fs-JSON), open a separate ADR to extend the first-party substrate set rather than open a runtime registration API.

## Governance

The archivist module enforces its "thin" property via a single mechanism: a co-located `MODULE.md` charter enumerating in-scope responsibilities — the six features named above, dispatch, type machinery, lazy-per-tool init, audit-chain replay, mutation invariants. Any feature not enumerated requires an ADR amendment before landing.

Earlier drafts paired the charter with a 2500-LoC size-budget gate. The audit retracted this: itemized accounting of the six features plus dispatch core plus substrate seam plus three substrate impls comes to ~2400-2600 LoC of *minimum* surface, so the budget would have been breach-by-design. The charter (what may land) replaces the budget (how much it weighs) as the structural gate. Type enforcement on the substrate seam remains the runtime gate.

Architectural ownership intentionally has **no named individual** — named owners decay (people leave, rotate, deprioritize); the "thin" property is a structural claim, enforced by the charter rather than by named gatekeepers.

## Migration path

The wire-up audit found **~200+ call sites** that must route through the archivist — an order of magnitude beyond earlier "13 mutation paths" estimates. Parallel per-store migration is infeasible; merge conflicts on shared archivist code would dominate. Replace with **surface-by-surface phased migration**:

![surface-by-surface-migration-phases](diagrams/memory-coordinator-architecture/surface-by-surface-migration-phases.png)

<details>
<summary>Mermaid Source</summary>

```mermaid
---
config:
  layout: elk
---
%%{init: {"theme": "base", "themeVariables": {"primaryColor":"#E3F2FD","primaryTextColor":"#0D47A1","primaryBorderColor":"#1565C0","lineColor":"#37474F","fontFamily":"Inter, sans-serif"}}}%%
flowchart TB
    accTitle: Surface-by-surface migration phases
    accDescr: Nine phases from scaffolding through ADR-0112 legacy retirement

    P2["<b>Phase 2: Scaffolding</b><br/>• Archivist + audit-chain + type machinery<br/>• Lift withHiveStoreLock → makeFsJsonSubstrate<br/>• Feature flag; no live callers"]:::process
    P3["<b>Phase 3: memory_*</b> (4 mutating tools)<br/>• End-to-end validation<br/>• Proves type machinery + audit chain"]:::process
    P4["<b>Phase 4: hive-mind_*</b> (6 tools)<br/>• Extract withHiveStoreLock + saveHiveState<br/> from hive-mind-tools.ts to makeFsJsonSubstrate<br/>• Hive-mind becomes a consumer; ~490 LoC shrink (per Q7)<br/>• Substrate primitive now shared with other FS-JSON stores"]:::process
    P5["<b>Phase 5: FS-JSON group</b> (~17 stores; hive-mind covered in Phase 4)<br/>• claims/tasks/agents/swarm/coordination/<br/> workflow/neural/github/performance/<br/> system/config/progress/ruvllm/daa/<br/> wasm/browser/autopilot"]:::process
    P6["<b>Phase 6: agentdb_*</b> (~20 tools)<br/>• Triggers ADR-0112 legacy refactor<br/>• ~14 strict-mode + 6 requireAgentDB sites"]:::process
    P7["<b>Phase 7: Hooks + daemons</b><br/>• Fast-path enabled for post-edit, pre-task<br/>• worker-daemon scheduled writers<br/>• AutoMemoryBridge, HooksLearningDaemon"]:::process
    P8["<b>Phase 8: Decisions</b><br/>• Standalone agentdb MCP server: lift archivist INTO agentdb<br/>• cli-core JsonMemoryBackend: explicit non-archivist exemption"]:::process
    P9["<b>Phase 9: Inter-store orchestrators</b><br/>• NightlyLearner, MemoryConsolidation,<br/> SkillLibrary, SyncCoordinator<br/>• Validates MutationContext.child() + bulk() under load"]:::success
    P10["<b>Phase 10: ADR-0112 retirement</b><br/>• Remove strict-mode markers<br/>• Retire RvfNotInitializedError fail-loud pattern<br/>• ADR-0112 marked superseded"]:::success

    P2 --> P3 --> P4 --> P5 --> P6 --> P7 --> P8 --> P9 --> P10

    classDef process fill:#E1F5FE,stroke:#0277BD,stroke-width:2px,color:#01579B
    classDef success fill:#C8E6C9,stroke:#2E7D32,stroke-width:2px,color:#1B5E20
```

</details>

Each phase ships independently and is acceptance-testable. An ESLint counter tracks unmigrated mutation sites — count trends down per phase. ADR amendment required if the `MODULE.md` charter needs expansion mid-migration; no LoC ceiling (see §Governance).

**Execution Plan.** Each phase runs via `/swarm-advanced` with a per-phase team — a queen + 4-15 parallel workers under `team_name: "adr-0180-phase-N"`. Phases stay sequential (Phase N+1 cannot start until Phase N's `npm run release` gate passes); within a phase, workers run in parallel via the Agent tool with `run_in_background: true`. Worker outputs flow to the queen via SendMessage; queen runs the phase's acceptance test and produces a phase report at `docs/council/ADR-0180-phase-<N>-report.md`. Full per-phase team composition + parallelism ceilings (Phases 5 + 6 hit 15-agent cap) are in ADR-0180 §Execution Plan. Pre-Phase-2 prerequisite (`scripts/ruflo-publish.sh` gains the `ADR-0180-Halt:` trailer scan + charter conformance hook) is a one-shot scripting task on ruflo-patch, not a swarm phase.

### Measurement-date anchoring

Every quantitative claim in this document and ADR-0180 is anchored to two audit dates: the **2026-05-13 wire-up audit** (call-site counts, LoC, test-file inventories) and the **2026-05-14 provenance audit** (15 ranked-read tools, ~665 LoC). Anchors are load-bearing — a phase opening against a stale anchor is operating on numbers that may no longer reflect the codebase.

| Gate | Cadence | Threshold | Action on breach |
|---|---|---|---|
| Per-phase planning gate | Each phase before release | >10% drift on call-site, LoC, or test-file count for that phase's surface | Implementing commit on `main` carries `bench/measurement-snapshot-<YYYY-MM-DD>.md` + `ADR-0180-Halt: re-scope` trailer; `npm run release` refuses to advance the fork's version until a paired `ADR-0180-Amendment: phase-N` resolution commit lands |
| Phase 4 hive-mind-tools.ts boundary | Phase 4 only | >10% drift on `hive-mind-tools.ts` LoC vs anchor | Phase 4 re-scope before next release |
| Sub-10% drift | Each phase | Drift ≤10% | Note in snapshot file, no halt |

Snapshots commit to `forks/<archivist-package>/bench/measurement-snapshots/` per phase for retrospective audit. The 10% threshold is conservative — smaller drifts are noted without halting.

### Phase 2's first deliverable: performance baseline harness

**No handler wiring lands in Phase 3+ until `bench/baseline.json` exists.** Five workloads at `forks/<archivist-package>/bench/`:

| Workload | Driver | Hard-fail threshold |
|---|---|---|
| W1 — Cold single write | `memory_store` 1000 warm iterations | p99 > 2× baseline |
| W2 — Cold bulk write | `SyncCoordinator.applyChanges` 1000 rows | per-row p50 > 2× or total > 2× |
| W3 — Hot tight loop | `post-edit` hook 100/s (reuses Follow-up #13 microbench) | p99 ≥ 2 ms (absolute) |
| W4 — Read cache hit + miss | `memory_search` 100 queries (50 unique cold, 50 repeat hot) | cache-hit p50 > 1 ms or miss p50 > 1.3× substrate |
| W5 — Inter-store cascade | `NightlyLearner.run()` fixed fixture | audit-tree depth > 3 or mutation count mismatch |

Soft regression bands: p50 ≤ 1.2–1.3×, p99 ≤ 1.5×, except W3 (absolute <2 ms p99 per §Performance). Capture wall-clock + syscall count + allocations + fsync count + audit-tree depth where relevant. Node built-in test runner + `performance.now()` histograms; no third-party perf dep. Where they run: W1/W2/W4/W5 in `npm run release` preflight (synchronous, fail-fast); W3 in `npm run release` acceptance stage (30s wall-clock fits the existing acceptance budget); W1+W3 also run in `npm run test:unit` for fast feedback during phase work.

### Phase 4 surprises to call out before starting

Per Q4 (extractability audit), three things surface only when you actually start the hive-mind migration. **Items 1 and 2 are pre-existing fork bugs** (live data-loss / concurrency bugs today), NOT Phase 4 deliverables — they land as fork-side maintenance commits on `forks/ruflo/v3 main` ahead of Phase 4 (`scripts/ruflo-publish.sh` preflight refuses Phase 4 release if the maintenance commits are not present on `main`):

1. **`agents.json` doesn't currently use any substrate primitive** — naive `writeFileSync`, silent catch, no fsync, no lock. A latent ADR-0085 violation hiding in plain sight at `hive-mind-tools.ts:1264-1280`. **Pre-Phase-4 maintenance commit** wraps the writes in the existing `withHiveStoreLock` shape (already in the same file at L1213-1259) as `saveAgentStore`/`loadAgentStore` (~30 LoC) under commit subject `fix(hive-mind): wrap agents.json writes in withHiveStoreLock (pre-Phase 4)`. Phase 4 then migrates `agents.json` as a **second** consumer of `makeFsJsonSubstrate` to validate the abstraction's genericity. If `agents.json` can't migrate cleanly, the extracted primitive is wrong.
2. **The consensus handler at `hive-mind-tools.ts:1849` doesn't hold the lock today** — propose/vote branches mutate `state` and call `saveHiveState` without wrapping `withHiveStoreLock`. Live concurrency bug. **Pre-Phase-4 maintenance commit** wraps ~6 propose/vote/status sites in `withHiveStoreLock` (~30 LoC) under commit subject `fix(hive-mind): wrap consensus propose/vote in withHiveStoreLock (pre-Phase 4)`. Phase 4 then routes through `ctx.withWrite` mechanically; the genuinely-Phase-4 deliverable is the new regression test asserting every state mutation goes through the wrapper.
3. **`performSweep` is hive-specific** — knows about `state.sharedMemory` and `isExpired`. This IS a Phase 4 design decision (not a pre-existing bug): either keep `performSweep` in hive-mind-tools.ts (and have it use the substrate's `withWrite`) or generalize as `sweep?: (state:T) => boolean` substrate option. Don't try to bury hive-specific sweep logic in the generic substrate.

Tracking: forks have no separate issue tracker (trunk-only per `feedback-trunk-only-fork-development`; `feedback-no-upstream-donate-backs` precludes filing on ruvnet/*). Items 1 + 2 are the canonical work items tracked here and in ADR-0180 §Migration concerns Phase 4 until the maintenance commits land.

### LoC shrink — refined estimate

Per Q7 measurement (line-counted, not estimated): **~490 LoC** of substrate machinery moves from `hive-mind-tools.ts` to `makeFsJsonSubstrate`. The remaining ~2647 LoC stays — consensus/queen/worker protocols and 17 MCP tool handler bodies. The "~2400 LoC shrink" earlier drafts named was 5× over.

The dedup payoff is **across N tool families** (hive, claims, tasks, agents, sessions, …) all sharing one tested substrate primitive — not from hive-mind alone. Frame the win as substrate dedup, not as hive-mind shrink.

### CRDT consensus does not require new substrate abstraction

Per Q8 audit, the fork's CRDT consensus protocol (ADR-0121) uses CvRDT merge primitives over JSON-serialised state. The merge is a **pure function**; the persistence is a **single substrate write** structurally identical to the BFT/Raft/Quorum branches' tally save. `SubstrateAccess.withWrite<T>(fn)` covers it — no `withConverge(state, peer)` abstraction is needed. The CRDT algebra lives in `crdt-types.ts`; the substrate sees an opaque blob.

### Documentation sweep per phase

Per Q10 catalog, ~40 doc references across 5 surfaces will need updates as each phase lands. Every migration phase ends with a mandatory **doc-sweep sub-task** covering the surface it touched: USERGUIDE.md sections, plugin READMEs, SKILL.md files, top-level project docs (CLAUDE.md, STATUS.md). MCP tool descriptions are already storage-agnostic — no updates required.

**Wording posture distinction:**

| Audience | Wording posture |
|---|---|
| User-facing (USERGUIDE, doctor output, ruflo-rag-memory README) | Preserve user-visible paths; offer "managed by archivist" framing. Avoid renaming substrate concepts users already know. |
| Internal (CLAUDE.md, this architecture doc, plugin-author SKILLs) | Full archivist vocabulary — `MutationContext`, `GuardedWrite`, substrate-handle pattern, path-restricted module. |
| Validation harness (`docs/validation/README.md`) | Keep `better-sqlite3` verbatim — install-smoke fixtures, not substrate-architecture claims. |

### What's not in scope for any phase

- Cross-process `MutationContext.child()` across cli↔daemon (deferred today; trigger-bound — re-opens when R1-R4 fire; W1-W3 watchdogs prevent silent lapse; see §Out of scope for triggers + watchdogs)
- Cross-process cache invalidation (5-min TTL bounds staleness; revisit if symptoms appear)
- Plugin-defined store registration (rejected; plugins use MCP-as-client)
- HNSW-topology replay equivalence (replay asserts set-equality, not graph-shape equality)
- Quota *prediction* / pre-write capacity probe (deferred to future guard verdict)

## What this is NOT

- **Not the upstream bridge.** Upstream's bridge sat at substrate; this archivist sits above MCP dispatch *and* CLI/hook/daemon/cascade entry points. Upstream's bridge fanned out 3-4× to downstream writers; this archivist orchestrates serially. Upstream's bridge relied on convention; this one is type-enforced.
- **Not a god-object.** Scope gated by the `MODULE.md` charter (which features may land), not by a LoC ceiling. Owns dispatch + audit + plug-in features; no domain logic. Stores still own their domains.
- **Not a transaction coordinator.** No two-phase commit, no distributed transactions across stores. Each store owns its own multi-table transaction; archivist orchestrates serially with audit between.
- **Not a substrate decision.** Substrate is settled by [ADR-0177](../../../adr/export/html/ADR-0177-adopt-upstream-agentdb-rvf-vision.html). This works with any combination of FS-JSON, SQLite, and RVF.
- **Not a universal substrate primitive.** The seam is `SubstrateAccess`; the implementations are substrate-shaped. Forcing a single universal implementation either serializes or under-coordinates.
- **Not a fat per-call wrapper.** Both reads and writes route through, but reads don't accumulate audit entries — trivial reads are ~5-line passthroughs.
- **Not an MCP-surface consolidation.** `memory_*` and `agentdb_*` both stay. Archivist is invisible to clients.
- **Not a recovery tool.** Audit-chain replay is **verification**, not recovery. Counter increments, autoincrement IDs, and downstream auto-promotion triggers cannot be cleanly inverted; the archivist surfaces partial-state failures via operator-visible alarm rather than auto-compensating.
- **Not retroactive.** Existing stores continue to work. We migrate them surface-by-surface across 10 phases (Phase 2 scaffolding through Phase 10 ADR-0112 retirement). Each phase ships independently.

## References

### ADRs

- [ADR-0085](../../../adr/export/html/ADR-0085-bridge-deletion-ideal-state-gaps.html) — Delete self-learning bridge wrapper *(the deletion that motivated this; `memory-bridge.ts` no longer exists as a live file — references in `init/helpers-generator.ts` template literals are intentional per ADR-0188 design intent)*
- [ADR-0112](../../../adr/export/html/ADR-0112-independent-stores-not-cross-store.html) — Forbid cross-store coordination *(superseded by ADR-0180)*
- [ADR-0117](../../../adr/export/html/ADR-0117-marketplace-mcp-server-registration.html) — Marketplace MCP server registration *(plugin model precedent)*
- [ADR-0161](../../../adr/export/html/ADR-0161-consolidate-agentdb-onto-fifth-fork.html) — agentdb extracted as 5th fork *(2026-05-08; supersedes ADR-0160; consolidated to `forks/agentdb`, published as `@sparkleideas/agentdb@alpha.14-patch.NNN`)*
- [ADR-0167](../../../adr/export/html/ADR-0167-cross-process-rvf-write-coordination.html) — Cross-process RVF write coordination *(accepted 2026-05-10)*
- [ADR-0177](../../../adr/export/html/ADR-0177-adopt-upstream-agentdb-rvf-vision.html) — Adopt upstream agentdb RVF vision *(substrate decision; supersedes ADR-0170/0174/0175 postgres divergence)*
- [ADR-0179](../../../adr/export/html/ADR-0179-restore-controller-instrumentation-lost-in-adr0085-bridge-deletion.html) — Restore controller instrumentation *(the six features cataloged)*
- [ADR-0180](../../../adr/export/html/ADR-0180-adopt-thin-memory-coordinator-with-type-enforced-mutation-handlers.html) — Adopt the Memory Archivist *(this architecture's decision record)*
- [ADR-0181](../../../adr/export/html/ADR-0181-archivist-runtime-activation.html) — Memory Archivist runtime activation *(implemented; per-process initialisation in cli / mcp-server / daemon / hooks-daemon)*
- [ADR-0182](../../../adr/export/html/ADR-0182-file-copy-minimization.html) — File-copy minimisation at release time
- [ADR-0183](../../../adr/export/html/ADR-0183-memory-write-path-unification.html) — Memory write-path unification *(accepted, completed 2026-05-17; `routeMemoryOp` dispatches through `archivist.dispatch`; insert + RC-2 upsert owned by `forks/agentdb/src/archivist/handlers/memory/store.ts`)*
- [ADR-0184](../../../adr/export/html/ADR-0184-hive-mind-consensus-handler-port.html) — Hive-mind consensus handler port *(implemented 2026-05-18; handlers under `forks/agentdb/src/archivist/handlers/hive-mind/consensus/<strategy>.ts`)*
- [ADR-0185](../../../adr/export/html/ADR-0185-hive-mind-consensus-cli-retirement.html) — cli-side hive-mind consensus handler retired *(implemented 2026-05-18; delegates to agentdb's port)*
- [ADR-0186](../../../adr/export/html/ADR-0186-upstream-fork-sync-2026-05-18-v2.html) — May upstream-sync close-out *(implemented 2026-05-18; ADR-097 + ADR-104 federation transport landed via `c4175be73`)*
- [ADR-0187](../../../adr/export/html/ADR-0187-adopt-upstream-adr-111-wireguard-mesh.html) — WireGuard mesh declined *(ADR-111 not adopted)*
- [ADR-0188](../../../adr/export/html/ADR-0188-session-state-file-mode.html) — Session-state file mode kept at 0644 *(implemented 2026-05-18; design intent for project-local ephemeral files)*

### Council and swarm deliberations

- [Round 1: Bridge deletion verdict](../../../council/export/html/ADR-0179-council-r1-bridge-deletion.html)
- [Round 2: Axis architecture](../../../council/export/html/ADR-0179-council-r2-axis-architecture.html)
- [Round 3: Bridge coordination](../../../council/export/html/ADR-0179-council-r3-bridge-coordination.html) — type-enforced vs runtime-convention distinction
- [Caller audit swarm](../../../council/export/html/ADR-0180-swarm-callers-audit.html) — enumerated the ~200+ call sites across 5 caller surfaces

### Implementation references

- ADR-0180 §Architecture — all 11 architectural bullets (placement, type enforcement, runtime backstop, read-path return shape, substrate, transactions, MCP surfaces, audit chain, init, performance, governance, escape hatch, migration concerns, +36% wrapper status)
- ADR-0180 §Open follow-ups #2-#24 — 20 concrete dispositions with TS sketches for every implementation decision (substrate seam, audit format, schema evolution, cache invalidation, guard verdicts, hot-path budget, observability, plugins, quota, multi-process, mock-context, three-tier replay harness, load scenarios)
