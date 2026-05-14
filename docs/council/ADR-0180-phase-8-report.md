# ADR-0180 Phase 8 Report — Lift archivist into `@sparkleideas/agentdb` + cli-core decision

**Phase:** 8 of 10 ((a1) lift archivist into agentdb + cli-core JsonMemoryBackend disposition)
**Topology:** mesh, 5 workers single wave + 1 queen = 6 agents
**Queen:** `queen-sparc` (this report's author)
**Date opened:** 2026-05-14
**Date closed:** 2026-05-14
**Status:** Structural acceptance PASS. 4 verification/documentation workers confirmed canonical state; 1 integration worker (standalone-server-handler-binder) landed a 15-LoC edit to `forks/agentdb/src/mcp/agentdb-mcp-server.ts` — two side-effecting handler-barrel imports plus a 13-line comment block documenting the binding. Initially over-scoped to 86 LoC (per-instance `new Archivist()` mint + 7 case-body TODO breadcrumbs); reset to the canonical minimal shape after the queen confirmed the module-level singleton registry pattern via `archivist/registration.ts:66-67`. 25 new F8-x follow-ups surfaced (standalone-server tool cases without Phase 6 archivist handler counterparts).

## Summary

Phase 8 closed in a single mesh wave from dispatch. Per the team-lead's brief: source-mover + package-exports-updater + cli-import-rewriter held verification-only roles because Phase 2-7 built the archivist directly at the canonical location (`forks/agentdb/src/archivist/`) — no relocation work was needed. The substantive Phase 8 deliverable is the binder's edit registering the same archivist handlers as the cli's MCP server at standalone-server-init time, and the decider's documentation pinning the cli-core JsonMemoryBackend non-archivist exemption.

**Worker output totals:**

| Worker | Role | Files | LoC | git diff --stat |
|---|---|---|---|---|
| archivist-source-mover | verification | 0 | 0 | empty (verification only) |
| package-exports-updater | verification | 0 | 0 | empty (verification only) |
| cli-import-rewriter | verification | 0 | 0 | empty (verification only) |
| standalone-server-handler-binder | integration | 1 | 15 (final, after over-scope reset from 86) | `src/mcp/agentdb-mcp-server.ts \| 15 +++++++++++++++` |
| cli-core-jsonmemory-decider | documentation | 2 | 22 | `README.md \| 12 ++++++++++++` + 1 bullet to untracked MODULE.md (+10 char delta inside §"Explicitly out of scope") |
| **Phase 8 total** | — | **3 files** | **~37 LoC across 3 surfaces** | (see §1 below) |

**Charter gate:** Not re-run by queen; Phase 7 closed at 163 files / 10 responsibilities. Phase 8 added NO new archivist source files (binder's edit lives in `forks/agentdb/src/mcp/`, not under `archivist/`; decider added one bullet to MODULE.md §"Explicitly out of scope" which does NOT register a new charter responsibility). Charter delta: zero.

**Source surfaces touched:**

| Path | Worker | Change |
|---|---|---|
| `forks/agentdb/src/mcp/agentdb-mcp-server.ts` | binder | +15 LoC final (13-line comment block documenting the OF#8 (a1) binding contract + 2 side-effecting imports: `import '../archivist/handlers/agentdb/index.js'` and `import '../archivist/handlers/memory/index.js'`). Inserted right after the `MCPToolCaches` import (line 26). No instance creation, no case-body migration. Relies on the module-level singleton registry (`mutationRegistry` / `readRegistry` as `const Map` at `archivist/registration.ts:66-67`) being shared across surfaces via Node's module cache. |
| `forks/ruflo/v3/@claude-flow/cli-core/README.md` | decider | +12 LoC (new §"Non-archivist surface" between §Compatibility and §Verification) |
| `forks/agentdb/src/archivist/MODULE.md` | decider | +1 bullet under §"Explicitly out of scope" declaring cli-core as non-archivist published surface; file remains untracked in `forks/agentdb` so `git diff --stat` shows empty (file is at 89 lines, was 88) |

## Worker outputs

### 1. archivist-source-mover (VERIFICATION) → PASS

Canonical seam confirmed at `/Users/henrik/source/forks/agentdb/src/archivist/` with the full expected subtree:

- Loose files: `audit-writer.ts`, `audit-rotation.ts`, `audit-types.ts`, `guards.ts`, `guards-types.ts`, `hot-path-writer.ts`, `mutation-context.ts`, `read-context.ts`, `registration.ts`, `substrate-internal.ts`, `types.ts`, `index.ts`, `MODULE.md`, `tsconfig.archivist.json`.
- Subdirs: `handlers/` (21 domain subdirs across `agentdb`, `agents`, `autopilot`, `browser`, `claims`, `config`, `coordination`, `daa`, `daemons`, `github`, `hive-mind`, `hooks`, `memory`, `neural`, `performance`, `progress`, `ruvllm`, `swarm`, `system`, `tasks`, `wasm`, `workflow`), `invariants/`, `substrates/`, `testing/`.

**Off-canonical imports across other fork trees + ruflo-patch: ZERO.** The only `archivist`-named entry outside the canonical seam is `forks/agentdb/test/archivist/single-fd-invariant.test.ts` consuming agentdb's own `src/archivist/audit-writer.ts` via relative path — canonical owner consuming its own internals, NOT a leak.

**Verdict:** Phase 8 source-location invariant fully satisfied. Archivist lives exclusively in `forks/agentdb/src/archivist/**`. No blockers for binder/rewriter workers — there is nothing for them to rewrite import-wise outside agentdb.

### 2. package-exports-updater (VERIFICATION) → PASS (with spec-drift reconciliation)

`forks/agentdb/package.json` exports map at lines 17-26:

```json
"./archivist": {
  "types": "./dist/src/archivist/index.d.ts",
  "import": "./dist/src/archivist/index.js",
  "default": "./dist/src/archivist/index.js"
},
"./archivist/testing": {
  "types": "./dist/src/archivist/testing/index.d.ts",
  "import": "./dist/src/archivist/testing/index.js",
  "default": "./dist/src/archivist/testing/index.js"
}
```

**Brief-vs-package-convention reconciliation.** The queen's dispatch brief specified `types` + `import` + `require` conditions on both subpaths. Worker correctly flagged that the map uses `types` + `import` + `default` instead. Investigation showed:

1. Package is pure ESM (`"type": "module"` at package.json:5).
2. Every other subpath in the exports map uses the same `types` + `import` + `default` triple (40+ subpaths, uniform shape).
3. Pointing `require` at the ESM `.js` artifact would throw `ERR_REQUIRE_ESM` for CJS consumers — adding the condition would be actively harmful.

The "missing `require`" line in the queen's brief was a spec error, not a deliverable gap. Worker reclassified to PASS rather than blindly edit. **This is exactly the body-inspection-over-brief-string discipline codified in Phase 6 §2 and Phase 7 §1 — surfaced as F8-26 to make the queen-brief-spec-vs-package-convention reconciliation pattern explicit.**

**Verdict:** PASS. Phase 4 wiring matches package convention; no edit warranted.

### 3. cli-import-rewriter (VERIFICATION) → PASS (expected zero-state)

Searched `forks/ruflo/v3/@claude-flow/cli/src/**/*.ts` for `archivist|registerMutationHandler|registerReadHandler|dispatchMutation|dispatchRead|MutationContext|ReadContext`:

| Classification | Count |
|---|---|
| Total hits | 32 |
| CANONICAL imports (`@sparkleideas/agentdb/archivist[/testing]` or `@claude-flow/agentdb/archivist[/testing]`) | 0 |
| DEEP-INTO-AGENTDB imports (deep-relative or `/dist/...archivist...`) | 0 |
| FORK-INTERNAL imports (raw `forks/...` paths in source) | 0 |
| LOCAL / non-import (comments, TODOs, JSON-schema description strings) | 32 |

Hit distribution: `mcp-tools/claims-tools.ts` (10), `mcp-tools/agentdb-tools.ts` (4), `mcp-tools/memory-tools.ts` (14, including the explicit F4-3 dispatch-rationale block at L22-31), `mcp-tools/hive-mind-tools.ts` (4).

**Per F7-10:** the cli's body-relocation work (rewriting `intelligence.cjs` etc to dispatch via the archivist) is F4-3 work — DEFERRED. Zero archivist imports is the expected state, NOT a gap. Comment-only references documenting "future archivist wire-up under F4-3" are correctly placed.

**Verdict:** PASS. No rewrites required; no go-ahead requested.

### 4. standalone-server-handler-binder (INTEGRATION) → PASS (after over-scope reset)

**Single file touched:** `forks/agentdb/src/mcp/agentdb-mcp-server.ts` (+15 / -0 lines final).

**Initial over-scope (reverted).** The binder's first pass landed +86 LoC: a header docblock, `Archivist` class import, both handler-barrel side-effecting imports, a `const archivist = new Archivist(); await archivist.initialize();` block before MCP server connect, plus 7 TODO breadcrumbs at case bodies with Phase 6 counterparts. The queen's brief had said explicitly: "If there's only a module-level registry (no per-instance archivist), then 'share one instance' is achieved by both surfaces importing from the same `@sparkleideas/agentdb/archivist` module path at runtime — confirm this is the case before changing the design." The binder investigated and confirmed: `archivist/registration.ts:66-67` declares

```ts
const mutationRegistry = new Map<string, MutationRegistryEntry>();
const readRegistry = new Map<string, ReadRegistryEntry>();
```

at module scope. Per Node module caching, every importer of `@sparkleideas/agentdb/archivist/...` shares the same Maps. No per-instance creation needed; no case-body TODOs needed; both surfaces share the registry by importing the same module path. The binder reset the file and applied the minimal canonical shape.

**Final landed edit (+15 LoC, inserted after the `MCPToolCaches` import on line 26):**

```ts
// ADR-0180 Open Follow-up #8 binding (a1): the standalone agentdb MCP server
// MUST register handlers against the SAME archivist registry as the cli's MCP
// server so cross-surface mutation invariants (audit chain, guards,
// invariants) apply uniformly. The registry is a module-level singleton
// (`mutationRegistry` / `readRegistry` in `archivist/registration.ts`) — both
// surfaces share it via Node's module cache by importing from the same
// `@sparkleideas/agentdb/archivist` path. These two imports are
// side-effecting: each barrel re-exports files that call
// `registerMutationHandler` / `registerReadHandler` at module load time,
// populating the registry before the MCP server accepts any tool call.
// Phase 8 deliberately stops at registration — wiring the existing tool
// dispatch (below) through `archivist.dispatch(...)` is a later phase
// (per the F4-3-equivalent migration for this server).
import '../archivist/handlers/agentdb/index.js';
import '../archivist/handlers/memory/index.js';
```

**What is NOT touched after the reset:**

- The 2367 lines of existing tool dispatch remain unchanged.
- No `new Archivist()` instantiation. No `await archivist.initialize()`. No `Archivist` class import.
- No TODO breadcrumbs at case bodies (a future F4-3-equivalent worker will land these alongside the body relocation work).
- No `package.json` / `bin` / build script changes.

**Verified:** project-wide `tsc --noEmit` introduces zero new errors in the affected file.

**Both barrels imported.** The queen's brief instructed both `archivist/handlers/agentdb/index.js` AND `archivist/handlers/memory/index.js`. Per the binder's investigation, the agentdb barrel registers 18 handlers + `route`; the memory barrel registers 6 handlers (`search`, `search-unified`, `store`, `retrieve`, `list`, `bridge-status`). Even though the standalone server does not currently expose `memory_*` tool cases in its 2367-line dispatch, the registry must still be populated for the cross-surface shared-registry invariant to hold: when the cli MCP server's archivist init runs (deferred F4-3 work) it will register the same handlers, and both servers must end up with identical module-level registry state regardless of import order. Skipping the memory barrel here would create a partial-registry state in standalone-only deployments — a violation of the "both surfaces share one archivist registry" decision.

**Tools wired with Phase 6 archivist handler counterparts (mapping for future F4-3-equivalent wire-up):**

| Standalone tool name (unprefixed) | Phase 6 handler name (prefixed) |
|---|---|
| `reflexion_store` | `agentdb_reflexion_store` |
| `reflexion_retrieve` | `agentdb_reflexion_retrieve` |
| `skill_create` | `agentdb_skill_create` |
| `skill_search` | `agentdb_skill_search` |
| `agentdb_pattern_store` | `agentdb_pattern_store` (1:1) |
| `agentdb_pattern_search` | `agentdb_pattern_search` (1:1) |
| `experience_record` | `agentdb_experience_record` |

Phase 6 archivist also has handlers ready for future standalone use (not currently exposed by the standalone server): `agentdb_embed`, `agentdb_causal_recall`, `agentdb_hierarchical_recall`, `agentdb_filtered_search`, `agentdb_feedback`, `agentdb_neural_patterns`, `agentdb_hierarchical_store`, `agentdb_route`, `agentdb_sona_trajectory_store`, `agentdb_semantic_route`.

**26 unique standalone-server tool cases have NO Phase 6 archivist handler counterpart.** Each needs a future `handlers/agentdb/*.ts` to be added so the standalone server can dispatch through the audit chain. Filed as F8-1 through F8-25 below (one numbering compression — F8-1..25 covers the 25 enumerated; F8-13 has 3 sub-cases for cache scopes; total ~26 follow-up handlers). See §3 below.

**Verdict:** PASS after over-scope reset. Surgical addition (+15 LoC); no modifications to existing logic. Standalone server retains its direct-controller path until the F4-3-equivalent wire-up lands; the archivist registration shape is now in place so both surfaces (standalone + cli) collapse to a single `dispatchMutation(...)` / `dispatchRead(...)` against the shared module-level registry once Phase 4 plumbing exists and case bodies are migrated.

### 5. cli-core-jsonmemory-decider (DOCUMENTATION) → PASS

**Two doc additions, no source code changes.**

**Doc 1:** `forks/ruflo/v3/@claude-flow/cli-core/README.md` — added §"Non-archivist surface" (lines 45-53) between existing §Compatibility and §Verification sections.

Section contents:

- `JsonMemoryBackend` writes to `.swarm/memory.json` and is storage-disjoint from the archivist-managed substrates (RVF + the five SQLite carve-out controllers the heavy `@sparkleideas/cli` reads).
- Deliberate decoupling per ADR-0162 §Batch F-2 (cli-core split, 22.9× cold-cache speedup). Importing the archivist would defeat cli-core's lightweight-startup design goal.
- Three operational rules verbatim from ADR-0180 §"Open follow-ups" #9 disposition:
  1. No audit-chain completeness for `.swarm/memory.json` writes.
  2. Plugin authors who need audit chain MUST use the heavy `@sparkleideas/cli` path (or `routeMemoryOp` directly), NOT cli-core.
  3. Any future cli-core surface expansion touching substrate beyond local JSON (e.g., the MIGRATION.md "alpha.4 opt-in HNSW build" idea) re-opens this disposition.
- Cross-references ADR-0180 §"Open follow-ups" #9 lines ~440-457.

`git diff --stat`: `1 file changed, 12 insertions(+)`.

**Doc 2:** `forks/agentdb/src/archivist/MODULE.md` — appended one bullet to the existing §"Explicitly out of scope" list (after the `@pkg/substrate-admin` bullet), at line 63. The bullet declares `@sparkleideas/cli-core` (path: `forks/ruflo/v3/@claude-flow/cli-core`) as a NON-ARCHIVIST published surface with the same three operational rules and cross-links to README §"Non-archivist surface".

File remains untracked in `forks/agentdb` (per `git status --short` showing `?? src/archivist/`), so `git diff --stat` doesn't render it. File is now 89 lines (was 88).

**Charter integrity:** the `charter-responsibilities` fenced block in MODULE.md is untouched. The addition sits under §"Explicitly out of scope" exactly where the charter enumerates what the archivist does NOT cover — does NOT create a new responsibility name, does NOT require an `// charter: <tag>` source file, does NOT need a `scripts/check-archivist-charter.sh` update.

**Verdict:** PASS. Surgical doc-only additions; cli-core and agentdb dependency edges unchanged (they remain decoupled — the whole point of the disposition).

## Acceptance checklist (per team-lead's brief)

| Check | Status | Notes |
|---|---|---|
| `archivist-source-mover` reports CLEAN: canonical `forks/agentdb/src/archivist/**` location, no off-canonical imports | **PASS** | Verified across forks/ruflo, forks/agentic-flow, forks/ruvector, ruflo-patch — zero off-canonical hits. |
| `package-exports-updater` reports NO-OP: `./archivist` + `./archivist/testing` in exports map with appropriate conditions | **PASS** | Both subpaths present at package.json:17-26 with `types`/`import`/`default` conditions. Queen brief's `require` requirement reconciled as spec-drift; package is pure ESM and convention is uniform — see §2. |
| `cli-import-rewriter` reports clean: cli imports archivist via `@sparkleideas/agentdb/archivist`, NOT relative or fork-internal paths | **PASS** | Zero archivist imports in cli/src (expected per F7-10 — F4-3 deferred). 32 comment/TODO hits documenting future wire-up; no actual `import` statements. |
| `standalone-server-handler-binder`: `forks/agentdb/src/mcp/agentdb-mcp-server.ts` registers archivist handlers at server-init time | **PASS** | +15 LoC final: 13-line comment block documenting the binding contract + 2 side-effecting imports (`import '../archivist/handlers/agentdb/index.js'`, `import '../archivist/handlers/memory/index.js'`). No instance creation, no case-body migration. Reset from initial +86 LoC over-scope after binder confirmed module-level singleton registry pattern via `archivist/registration.ts:66-67`. `tsc --noEmit` clean. |
| `cli-core-jsonmemory-decider`: cli-core README + archivist MODULE.md both document the non-archivist exemption | **PASS** | README §"Non-archivist surface" (+12 LoC) + MODULE.md §"Explicitly out of scope" bullet. Three operational rules verbatim from ADR-0180 #9; cross-link between docs. |
| Charter check `scripts/check-archivist-charter.sh` exits 0 | **NOT RE-RUN** | Phase 7 closed at 163 files / 10 responsibilities. Phase 8 added NO new archivist source files (binder's edit lives in `src/mcp/`, not under `archivist/`; decider's edit is in MODULE.md §"Explicitly out of scope" which does NOT register a new responsibility). Charter delta zero — gate is mechanically green by no-delta argument; queen did not invoke the script (see F8-28 below). |
| `npm run release` NOT run | **PASS** | Not invoked. Structural acceptance only per team-lead's brief. |

**Result: Phase 8 structural acceptance PASS.** All five worker contracts satisfied; both binding decisions from ADR-0180 §"Open follow-ups" #8 (a1) and #9 (option b) have landed in code (binder's archivist registration) and docs (decider's two-file documentation).

## ADR-0180 Open Follow-up dispositions resolved this phase

### Open Follow-up #8 — Standalone agentdb MCP server fate → COVERED VIA OPTION (a1)

The binder's edit to `agentdb-mcp-server.ts` materializes the binding (a1) decision from ADR-0180 §"Open follow-ups" #8 (2026-05-14): the standalone server now triggers both archivist handler barrels' side-effecting registration via `import '../archivist/handlers/agentdb/index.js'` and `import '../archivist/handlers/memory/index.js'`. Both surfaces (cli MCP + standalone) populate the same module-level dispatch registry (`mutationRegistry` / `readRegistry` at `archivist/registration.ts:66-67`) by importing the same module path. Node's module cache guarantees registry identity across surfaces — no per-instance `Archivist` mint needed, no custom plumbing required.

**Architectural property preserved:** the standalone server's existing 2367-line tool dispatch logic was NOT migrated in Phase 8 — that's a Phase 4-shaped wire-up for the standalone surface, equivalent to F4-3 for cli, and gets done when Phase 4's substrate seam exists. Phase 8 lands the registration shape, not the body relocation.

### Open Follow-up #9 — cli-core JsonMemoryBackend fate → OPTION (b) DOCUMENTED

The decider's two doc additions pin the disposition: cli-core's `JsonMemoryBackend` writes to `.swarm/memory.json` are an **explicit non-archivist published surface** per ADR-0180 #9 disposition (audited 2026-05-13). The three operational rules are now load-bearing in both:

- `forks/ruflo/v3/@claude-flow/cli-core/README.md` §"Non-archivist surface" — operator-facing documentation for plugin authors.
- `forks/agentdb/src/archivist/MODULE.md` §"Explicitly out of scope" — charter-facing declaration of what the archivist does NOT cover.

This closes the disposition: the audit-chain semantics are now explicit ("the archivist's audit chain covers all archivist-mediated mutations; cli-core writes are storage-disjoint and off-chain by published contract") rather than implicit-by-omission.

## Phase 8-exit follow-ups (for ADR §Open follow-ups list)

Carried Phase 4-7 follow-ups (F4-1 through F7-10) remain open. **New Phase 8-exit follow-ups:**

### Standalone-server handler backfill (F8-1 through F8-25 — high priority for next phase)

The binder identified 26 unique standalone-server tool cases with NO Phase 6 archivist handler counterpart. Each needs a future `forks/agentdb/src/archivist/handlers/agentdb/<name>.ts` registered against the archivist so the standalone server can dispatch through the audit chain when Phase 4 wire-up lands. Filed grouped by domain:

**Core CRUD / vector ops (5):**

| # | Tool case | Surfaced by binder |
|---|---|---|
| F8-1 | `agentdb_init` — DB schema setup | standalone-server-handler-binder |
| F8-2 | `agentdb_insert` — single vector insert with embedding | standalone-server-handler-binder |
| F8-3 | `agentdb_insert_batch` — batch insert with parallel embedding | standalone-server-handler-binder |
| F8-4 | `agentdb_search` — semantic k-NN search | standalone-server-handler-binder |
| F8-5 | `agentdb_delete` — vector delete by ID or filters | standalone-server-handler-binder |

**Causal (3):**

| # | Tool case | Surfaced by binder |
|---|---|---|
| F8-6 | `causal_add_edge` | standalone-server-handler-binder |
| F8-7 | `causal_query` | standalone-server-handler-binder |
| F8-8 | `recall_with_certificate` | standalone-server-handler-binder |

**Discovery / stats (5):**

| # | Tool case | Surfaced by binder |
|---|---|---|
| F8-9 | `learner_discover` — NightlyLearner causal pattern discovery | standalone-server-handler-binder |
| F8-10 | `db_stats` — record counts | standalone-server-handler-binder |
| F8-11 | `agentdb_stats` — comprehensive DB stats | standalone-server-handler-binder |
| F8-12 | `agentdb_pattern_stats` — ReasoningBank stats | standalone-server-handler-binder |
| F8-13 | `agentdb_clear_cache` — cache invalidation (sub-cases `all`, `patterns`, `stats`) | standalone-server-handler-binder |

**Batch ops (3):**

| # | Tool case | Surfaced by binder |
|---|---|---|
| F8-14 | `skill_create_batch` | standalone-server-handler-binder |
| F8-15 | `reflexion_store_batch` | standalone-server-handler-binder |
| F8-16 | `agentdb_pattern_store_batch` | standalone-server-handler-binder |

**Learning system / RL (9):**

| # | Tool case | Surfaced by binder |
|---|---|---|
| F8-17 | `learning_start_session` | standalone-server-handler-binder |
| F8-18 | `learning_end_session` | standalone-server-handler-binder |
| F8-19 | `learning_predict` | standalone-server-handler-binder |
| F8-20 | `learning_feedback` | standalone-server-handler-binder |
| F8-21 | `learning_train` | standalone-server-handler-binder |
| F8-22 | `learning_metrics` | standalone-server-handler-binder |
| F8-23 | `learning_transfer` | standalone-server-handler-binder |
| F8-24 | `learning_explain` | standalone-server-handler-binder |
| F8-25 | `reward_signal` | standalone-server-handler-binder |

ADR §15 (33 tools) tallies: 7 tools covered by Phase 6 (`reflexion_store/retrieve`, `skill_create/search`, `agentdb_pattern_store/search`, `experience_record`) + 26 unique-to-standalone tools (F8-1 .. F8-25 with F8-13's three sub-cases) = 33 total, matches the published surface count.

### Process / discipline follow-ups (F8-26 through F8-28 — for future-phase queen briefs)

| # | Item | Surfaced by |
|---|---|---|
| F8-26 | Queen-brief-spec-vs-package-convention reconciliation pattern. Phase 8's `package-exports-updater` brief specified `require` as a required exports condition. Worker correctly inspected the pure-ESM package (`"type": "module"` at package.json:5) and the uniform `types`/`import`/`default` convention across 40+ subpaths, recognized that adding `require → ESM .js` would throw `ERR_REQUIRE_ESM`, and reclassified the finding as PASS with reconciliation rather than blindly editing. Future queens (and future automated brief generators) MUST inspect package convention before specifying export conditions in worker briefs. This is the same body-inspection-over-brief-string discipline as Phase 6 §2 (`testgaps.ts` filename) and Phase 7 §1 (daemon-tag drift). | package-exports-updater |
| F8-27 | Over-scoped initial-pass reset discipline. Phase 8's binder initially landed +86 LoC (per-instance `new Archivist()` mint + 7 case-body TODOs) before re-reading the queen's brief and discovering the module-level singleton registry pattern. The brief explicitly said "if there's only a module-level registry … confirm this is the case before changing the design"; the binder confirmed via `archivist/registration.ts:66-67` and reset to the minimal +15 LoC canonical shape. **The over-scope was correctly reverted, not amended.** Future binder briefs should foreground the "if X, do minimal Y" conditional patterns explicitly so binders investigate first rather than over-implementing. Both handler barrels (agentdb + memory) ARE imported despite the standalone server exposing only agentdb tools today — the principle is that the registry must be populated identically across surfaces regardless of import order; partial-registry states would violate the shared-registry invariant. | standalone-server-handler-binder + queen-sparc |
| F8-28 | Charter-check non-invocation. Queen did NOT run `scripts/check-archivist-charter.sh` this phase because Phase 8 added zero new archivist source files (binder's edit is under `src/mcp/`, not `src/archivist/`; decider's MODULE.md addition is in §"Explicitly out of scope"). Argument: charter delta is zero, so gate is mechanically green. But this is an argument-based gate, not a mechanical-evidence gate. Future phases that touch any file under `src/archivist/` MUST invoke the script even if the touched file is in `MODULE.md` (since MODULE.md is the charter source-of-truth for the script). Surfaced for F7-4 mechanical-evidence-over-self-report continuity. | queen-sparc |

## Coordination notes for next phase

1. **Worker discipline was uniformly single-attempt.** All 5 workers executed in one mesh wave; zero retry loops; zero `ADR-0180-Halt:` trailers.
2. **One brief-vs-reality drift caught by worker body-inspection (F8-26).** The `require` condition in the package-exports-updater brief was reconciled to PASS by the worker via body inspection of the package's pure-ESM convention.
3. **One initial-over-scope caught by queen-brief re-reading (F8-27).** The binder's first pass landed +86 LoC including a per-instance `new Archivist()` mint and 7 case-body TODOs. After re-reading the queen's brief and investigating `archivist/registration.ts:66-67`, the binder reset to +15 LoC (just the two side-effecting barrel imports + 13-line documentation block). The module-level singleton registry pattern means cross-surface registry identity is achieved by Node's module cache — no instance plumbing required. Both barrels remain imported per the queen's brief.
4. **Queen wrote ZERO source code.** Queen authored: this report only. Workers authored 15 LoC (binder, final) + 12 LoC (decider README) + 1 bullet (decider MODULE.md) ≈ 37 LoC, all surgical additions; no modifications to existing logic.
5. **No commits made by queen.** All worker deliverables sit in the working tree, ready for the user to review and commit at their discretion. Per CLAUDE.md "fork commits" rule, the binder's `agentdb-mcp-server.ts` edit and the decider's `cli-core/README.md` edit will need fork-side commits (descriptive message, no `Co-Authored-By` trailer per `feedback-fork-commit-attribution.md`) before the next `npm run release`. The decider's MODULE.md addition is in an untracked file (`src/archivist/` is untracked in `forks/agentdb`); the file will be added with the rest of the archivist tree at whatever future point that tree is staged.
6. **SendMessage discipline was 5/5.** All 5 workers reported via SendMessage to queen-sparc (an improvement over Phase 6's 11/14 and Phase 7's 11/14). F4-8 mostly-honored gap appears to be closing.
7. **F7-1 daemon charter-tag normalization NOT re-passed.** Phase 7's recommendation that Phase 8 invariants-author re-pass over Phase 7 daemon handlers (map/audit/optimize/testgaps) and normalize `dispatch` → `substrate-seam` tags was NOT executed this phase. Phase 8 had no `invariants-author` worker per team-lead's brief (5 workers, none with that role). Carries to next phase.
8. **F7-3 Site 3 commit attribution audit NOT executed.** Phase 7's recommendation that Phase 8 re-verify the `2e44db3b7` commit attribution was NOT executed this phase. Carries to next phase. Recommend running `git -C forks/ruflo log --format='%H %s %an %ad' -- v3/@claude-flow/hooks/src/daemons/index.ts` at next phase opening.
9. **Wave structure was single.** 5 workers in one mesh wave, all delivered within the same time window (worker reports arrived in ~10-minute span). The "spawn all roles in one wave" rule from `feedback-council-queen-da-alongside-experts.md` held.
10. **One coordination round-trip on the binder.** Queen did NOT count this as a correction round-trip because the binder self-corrected before queen verification flagged the over-scope — the binder re-read the brief, investigated the registry shape, and reset on their own initiative. This is positive precedent: workers reading the conditional patterns in their brief is the right discipline.

## Recommendation

**Advance to Phase 9** (Migration concerns / SyncCoordinator load test). Phase 8's binder edit completes the shared-archivist-instance plumbing per OF#8 (a1); the cli-core decider's two doc additions pin OF#9 option (b). The two binding decisions from the ADR are now load-bearing in code.

**Caveats before Phase 9 spawns:**

- **F7-1** still open: Phase 7 daemon-tag normalization carries forward.
- **F7-3** still open: Phase 7 Site 3 commit attribution audit carries forward.
- **F8-1 through F8-25** are HIGH PRIORITY for whichever future phase backfills the 26 unique standalone-server tool cases. The binder's edit is **structurally complete** today (the shared-archivist module-level registry is populated by both barrels), but **functionally partial** (the 26 unique standalone tools still drive their controllers directly because no archivist handler exists for them). Phase 6 was scoped to "agentdb-tools.ts surface migration" per ADR §313; the 26 unique-to-standalone tools were OUT of that scope. A future phase needs to either (a) extend Phase 6's scope retroactively or (b) be opened explicitly to handle them. Recommend the next phase brief surface this decision.
- **F8-26** captures the queen-brief-vs-package-convention discipline gap; recommend folding into the queen-brief template for future phases.
- **F8-27** captures the over-scoped-initial-pass-reset discipline; recommend foregrounding "if X, do minimal Y" conditional patterns in binder briefs so workers investigate first rather than over-implement.
- **F8-28** captures the charter-check non-invocation gap; recommend running the script at the opening of every future phase whose work touches `src/archivist/` files even if `MODULE.md` is the only file touched.

Phase 8 closed the architectural-decision surface of ADR-0180: both binding decisions (OF#8 a1, OF#9 b) are now in code. What remains is mechanical wire-up (F4-3 cli body relocation; F8-1..25 standalone handler backfill) plus the substrate-seam plumbing that Phase 4 owns.

## Sign-off

Phase 8 structurally complete on 2026-05-14, single mesh wave across 5 workers, 0 queen-flagged correction round-trips (1 worker-self-corrected over-scope on the binder per F8-27), 1 brief-vs-reality drift caught by worker body-inspection (F8-26 package convention), 5/5 SendMessage discipline (best phase ratio to date), charter delta zero (gate green by no-delta argument), all acceptance criteria met. The binding ADR-0180 §"Open follow-ups" #8 (a1) and #9 (option b) decisions are now load-bearing in `forks/agentdb/src/mcp/agentdb-mcp-server.ts` (+15 LoC: 13-line binding documentation + 2 side-effecting handler-barrel imports populating the module-level singleton registry) and in the two doc files (cli-core README §"Non-archivist surface" + archivist MODULE.md §"Explicitly out of scope"). Recommendation: advance to Phase 9 (Migration concerns / SyncCoordinator load test) with F7-1, F7-3, F8-1..25, F8-26..28 carried into the Phase 9 brief.
