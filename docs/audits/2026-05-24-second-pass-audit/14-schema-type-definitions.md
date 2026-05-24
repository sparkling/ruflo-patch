# 14 — Schema / type-definition audit (shared types between packages)

Slice 14 of 14 (G-16-018 [LOW]). READ-ONLY static pass across
forks/ruflo (v3 + @claude-flow/*), forks/agentdb, forks/ruvector.
ADR-0224 + ADR-0214 fixed the substrate zod-bypass and env-var
canonicalization; this slice asks whether the **shared TS types,
Zod schemas, and MCP `inputSchema` declarations** stay consistent
across package boundaries.

## Summary

- Files scanned: ~3,000 TS files across `forks/ruflo/v3/@claude-flow/*`,
  `forks/ruflo/v3/src`, `forks/ruflo/v3/plugins`, `forks/agentdb/src`,
  `forks/ruvector/npm/packages`
- Exported types/interfaces/enums in `@claude-flow/*` (production): **~2,912**
  in **482 files** (excludes `/dist/`, `/node_modules/`, `/archive/`)
- MCP `inputSchema:` declarations: **299 in cli mcp-tools**, **36 in
  agentdb**, **~171 files total**
- Zod schema files: **169** (`from 'zod'`), with **~848** `z.object()`
  expressions
- Findings: **12 total / 1 critical / 3 warning / 8 note**
- Drift verdict: **PARTIAL** — the schemas and types are *internally*
  consistent within each `@claude-flow/*` package, but the same
  domain concept (`MemoryType`, `AgentType`, `TaskStatus`, `MCPTool`,
  `SwarmTopology`) is **redefined per package with subtly different
  values**, and **every cross-package boundary that imports `agentdb`,
  `ruvector`, `@xenova/transformers`, or `better-sqlite3` types it as
  `any`** via local `optional-modules.d.ts` ambient declarations
- Bottom line: **The MCP schema-vs-handler contract is the worst real
  drift** (F-14-001, CRITICAL — `memory_store`'s schema marks
  `namespace` as required but the handler defaults to `'default'` when
  it's missing, so a strict client gets a different surface than the
  permissive one). Behind that, the seven-way `MemoryType` split
  (F-14-002, WARN) and four-way `AgentType` split (F-14-003, WARN) mean
  any code that crosses an internal package boundary with a typed enum
  payload has zero compile-time guarantee the receiver accepts the same
  values. The "shared types between packages" gap the May-19 audit
  flagged is real but mostly bounded: each duplicate cluster has a
  *documented* mirror relationship (e.g. agentdb's `HiveMemoryType`
  carries the explicit comment "mirrors the cli `MemoryType` union") or
  is package-private and never crosses an API boundary. The legacy
  `v3/src/shared/types/index.ts` (427-line monolithic barrel from the
  pre-DDD layout) is the single biggest source of drift; it is
  re-exported as `v3/src/index.ts`'s top-level `export *` but every
  modernized `@claude-flow/*` package imports from
  `@claude-flow/shared/src/types` or its own internal `types.ts`
  instead, leaving the legacy file as **dead-end drift surface** that
  TypeScript will never catch because nothing imports it transitively.

## Top duplication offenders

| Concept | Definitions in production | Disjoint? | Severity |
|---|---|---|---|
| `MemoryType` | 7 (5 in ruflo/v3 + 2 mirror pairs in agentdb) | YES — completely disjoint enum values across `memory.interface.ts`, `memory/src/types.ts`, `domain/entities/memory-entry.ts`, `cli/hive-mind-tools.ts`, `v3/src/shared/types/index.ts`, `agentdb/hive-state.ts`, `agentdb/handlers/hive-mind/memory.ts` | WARN (F-14-002) |
| `TaskStatus` | 11 across `@claude-flow/*` | PARTIAL — `'created'` vs `'pending'` as initial verb, `'running'` vs `'processing'`, `'paused'` only in some | WARN (F-14-004) |
| `MCPTool` interface | 23 (4 in `@claude-flow/*`, 1 in `v3/src/`, 1 in `v3/mcp/`, 17 in `plugins/*`) | YES on field shape — generic vs non-generic, `JSONSchema` vs `MCPToolInputSchema` vs `MCPInputSchema` for `inputSchema`, optional `category`/`cacheable`/`deprecated`/`timeout` fields drift | WARN (F-14-005) |
| `MCPToolResult` | 10 in production | YES — claims-side uses `{ success, data, error }`, hooks-side and cli-side use `{ content[], isError }` | NOTE (F-14-006) |
| `AgentType` | 5 (10/13/8/10/6 enum values respectively) | YES — `swarm/src/types.ts` lists 13 including `queen`/`worker`; `agent.interface.ts` lists 10; `claims/domain/types.ts` lists 8 (no `queen`); `v3/src/shared/types/index.ts` lists 6 + `string` escape-hatch | WARN (F-14-003) |
| `SwarmTopology` | 4 in production | YES — `coordinator.interface.ts` lists 6 (`hierarchical/mesh/ring/star/adaptive/hierarchical-mesh`); `testing/helpers/swarm-instance.ts` lists 4 (drops `ring`/`star`); `v3/src/shared/types/index.ts` lists 4 *and invents* `'simple'` not present anywhere else | NOTE (F-14-007) |
| `MCPToolInputSchema` (the SCHEMA-of-the-schema) | 3 definitions all using `properties: Record<string, unknown>` | YES on semantic — the inner property types are erased to `unknown`, so the schema body itself is structurally untyped | NOTE (F-14-008) |

## Findings

### F-14-001 [CRITICAL] `memory_store` MCP `inputSchema.required` lists `namespace`, but handler silently defaults to `'default'`
- Location:
  - Schema: `/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/memory-tools.ts:175-193` —
    `required: ['key', 'value', 'namespace']`
  - Handler: same file `:200-260` — `const namespace = (input.namespace as string) || 'default'`
- Issue: The MCP `inputSchema` for `memory_store` declares `namespace`
  as a required property. A spec-compliant MCP client (per
  https://modelcontextprotocol.io spec) will refuse to send a call that
  omits a `required` field, OR will fail the call when the server
  validates against its declared schema. Anthropic's Claude Code MCP
  client *does* enforce server-declared `required` fields when surfacing
  the tool, so the tool advertises one contract ("namespace required")
  while the handler silently accepts a different one ("namespace
  defaults to 'default'"). A non-validating client (or a client that
  generates inputs from the schema, e.g. via JSON-Schema-faker) will
  produce different behaviour than a strict client — *the same call* is
  routed to two different namespaces depending on which side enforces
  the schema.
- Cross-reference: `memory_retrieve` (`memory-tools.ts:370`) and
  `memory_delete` (`memory-tools.ts:716`) handle this correctly —
  both `throw new Error("'namespace' is required …")` when missing.
  Only `memory_store` (the WRITE side) silently defaults; the READ
  side is strict. This means data written through a non-validating
  client lands at `'default'`, and a later strict-client read at the
  *same* explicit namespace will miss it. Silent data partitioning by
  client-strictness.
- Severity rationale: data-integrity hazard, not just schema cosmetics.
  Marked CRITICAL despite being one tool because the asymmetry
  (write-silent / read-strict) makes the bug latent.
- Suggested fix scope (not in this audit's scope to implement): either
  remove `'namespace'` from `required` and document the default in the
  property description, OR add the same fail-loud throw the retrieve/
  delete handlers have.

### F-14-002 [WARN] `MemoryType` redefined seven times across packages with completely disjoint enum values
- Location (all production, no test/archive paths):
  - `/Users/henrik/source/forks/ruflo/v3/@claude-flow/shared/src/core/interfaces/memory.interface.ts:10` —
    `'session' | 'persistent' | 'vector' | 'cache' | 'pattern'` (5)
  - `/Users/henrik/source/forks/ruflo/v3/@claude-flow/memory/src/types.ts:15` —
    `'episodic' | 'semantic' | 'procedural' | 'working' | 'cache'` (5)
  - `/Users/henrik/source/forks/ruflo/v3/@claude-flow/memory/src/domain/entities/memory-entry.ts:15` —
    `'semantic' | 'episodic' | 'procedural' | 'working'` (4)
  - `/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts:88` —
    `'knowledge' | 'context' | 'task' | 'result' | 'error' | 'metric' | 'consensus' | 'system'` (8)
  - `/Users/henrik/source/forks/ruflo/v3/src/shared/types/index.ts:86` —
    `'task' | 'context' | 'event' | 'task-start' | 'task-complete' | 'workflow-state' | string` (6 + escape-hatch)
  - `/Users/henrik/source/forks/agentdb/src/archivist/handlers/hive-mind/hive-state.ts:15`
    (alias `HiveMemoryType`) — same 8 values as `hive-mind-tools.ts` (DELIBERATE MIRROR, header comment `"mirrors the cli MemoryType union (ADR-0122 T4, 8 types)"`)
  - `/Users/henrik/source/forks/agentdb/src/archivist/handlers/hive-mind/memory.ts:53` —
    `export type HiveMindMemoryType = HiveMemoryType` (re-export of the mirror)
- Issue: Five of the seven definitions are **completely disjoint enum
  unions** for the same name (`MemoryType`). The cli `MemoryType`
  (knowledge/context/task/…) is mirrored intentionally in agentdb as
  `HiveMemoryType` — that pair is sound (header comment + matching
  `MEMORY_TYPES`/`HIVE_MEMORY_TYPES` runtime arrays + matching
  `DEFAULT_TTL_MS_BY_TYPE`/`HIVE_DEFAULT_TTL_MS_BY_TYPE` defaults).
  But the **other four** (`memory.interface.ts`, `memory/src/types.ts`,
  `memory-entry.ts`, `v3/src/shared/types/index.ts`) are **silent
  drift** — they all export `MemoryType` from `@claude-flow/shared` or
  `@claude-flow/memory` or `v3` namespaces, and a consumer importing
  the wrong barrel will compile but reject every value the *other*
  barrel emits.
- Cross-reference: `MemoryConfigSchema` (Zod, `schema.ts:84`) declares
  `type: z.enum(['sqlite','agentdb','hybrid','redis','memory'])` — but
  that's a different field (`MemoryConfig.type` is the *backend*,
  not the *entry* type). Confusingly co-named.
- Severity rationale: WARN not CRITICAL because the runtime callsites
  in `@claude-flow/memory` always cast at the seam
  (`entry.type as MemoryType` — see `sqlite-backend.ts:749`,
  `rvf-backend.ts:1039`, `agentdb-backend.ts:671`, `agentdb-adapter.ts:706`)
  so TypeScript never catches the drift, but the data round-trips
  through string comparison anyway. Real risk is at any future
  refactor that tries to use the type union as exhaustiveness check.
- Drift surface: an `IMemoryEntry` constructed against
  `memory.interface.ts` (allowed values: `session|persistent|vector|cache|pattern`)
  passed to a `MemoryEntry` consumer expecting
  `memory/src/types.ts` semantics (allowed: `episodic|semantic|…`) compiles
  AND parses, but every downstream filter-by-type predicate returns
  zero rows.

### F-14-003 [WARN] `AgentType` redefined in 5 production locations with disjoint enum values
- Location:
  - `/Users/henrik/source/forks/ruflo/v3/@claude-flow/shared/src/core/interfaces/agent.interface.ts:14`
    — 10 values (`coder/reviewer/tester/researcher/planner/architect/coordinator/security/performance/custom`)
  - `/Users/henrik/source/forks/ruflo/v3/@claude-flow/swarm/src/types.ts:78` — 13 values
    (adds `analyst/optimizer/documenter/monitor/specialist/queen/worker`, drops `security/performance/custom`)
  - `/Users/henrik/source/forks/ruflo/v3/@claude-flow/integration/src/agentic-flow-agent.ts:33` —
    10 values (mirror of `agent.interface.ts` — sound)
  - `/Users/henrik/source/forks/ruflo/v3/@claude-flow/claims/src/domain/types.ts:248` —
    8 values (`coder/debugger/tester/reviewer/researcher/planner/architect/coordinator`; adds `debugger`, drops `security/performance/custom`)
  - `/Users/henrik/source/forks/ruflo/v3/src/shared/types/index.ts:15` —
    6 values + `string` escape-hatch (`coder/tester/reviewer/coordinator/designer/deployer | string`)
- Issue: The same enum name carries 8 / 10 / 13 / 6+string variants.
  A `queen` agent (valid in `swarm/types.ts`) is rejected by
  `agent.interface.ts`; an `optimizer` (valid in `swarm`) is rejected
  by `claims`; the legacy `v3/src/` variant accepts literally any
  string. The Zod-enforced `SpawnAgentSchema` at
  `security/input-validator.ts:264` uses an enum (`AgentTypeSchema`)
  that the validation callsite *intentionally drops*:
  `cli/src/mcp-tools/validate-input.ts:317` reads
  `if (issue.code === 'invalid_enum_value') continue;` — the comment
  says "we support custom types (the inline validator already checked
  the identifier is safe)". So the canonical Zod enum is **a known
  lie**: it pretends to constrain, the consumer routes around it. This
  is documented schema-vs-handler drift.
- Severity rationale: WARN — no data corruption (string-typed at the
  storage layer), but every consumer of the typed enum operates in
  ignorance of which subset it can actually receive.

### F-14-004 [WARN] `TaskStatus` redefined 11 times with divergent state-machine vocabulary
- Sample drift (full list in §Inventory):
  - `@claude-flow/shared/src/core/interfaces/task.interface.ts:14` —
    `'pending'|'queued'|'assigned'|'running'|'completed'|'failed'|'cancelled'|'timeout'` (8)
  - `@claude-flow/swarm/src/types.ts:164` —
    `'created'|'queued'|'assigned'|'running'|'paused'|'completed'|'failed'|'cancelled'|'timeout'` (9 — starts with `created` not `pending`, adds `paused`)
  - `@claude-flow/cli/src/services/worker-queue.ts:32` —
    `'pending'|'processing'|'completed'|'failed'|'timeout'|'cancelled'` (6 — uses `processing` not `running`, no `queued`/`assigned`)
  - `@claude-flow/cli/src/infrastructure/swarm-interfaces.ts:13` —
    `'pending'|'queued'|'assigned'|'running'|'completed'|'failed'|'cancelled'` (7 — drops `timeout`)
- Issue: Three distinct verbs (`pending`/`created`, `running`/`processing`),
  `paused` only exists in one, `queued`/`assigned` only in some.
  Consumers that round-trip a `TaskStatus` value through
  `worker-queue.ts` will silently drop the `paused` distinction and
  lose `queued`/`assigned` granularity.
- Severity rationale: WARN — every callsite stringly-types the
  comparison so no runtime crash, but the canonical state machine is
  unverifiable.

### F-14-005 [WARN] `MCPTool` interface drifts on generics, `inputSchema` type, and optional fields across 4 `@claude-flow/*` packages + 17 plugins
- Location:
  - `/Users/henrik/source/forks/ruflo/v3/@claude-flow/shared/src/types/mcp.types.ts:10` —
    NO generics, `inputSchema: MCPInputSchema`, handler returns `Promise<MCPToolResult>` (the *closed*-content variant)
  - `/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/types.ts:85` —
    NO generics, `inputSchema: MCPToolInputSchema` (the structurally-untyped variant), handler returns `Promise<MCPToolResult | unknown>` (escape-hatch)
  - `/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli-core/src/mcp-tools/types.ts:36` —
    near-mirror of cli/src/mcp-tools (separate package, same shape)
  - `/Users/henrik/source/forks/ruflo/v3/@claude-flow/mcp/src/types.ts:220` —
    HAS generics `<TInput=unknown, TOutput=unknown>`, `inputSchema: JSONSchema`, adds `deprecated/timeout/cacheable/cacheTTL`
  - `/Users/henrik/source/forks/ruflo/v3/@claude-flow/shared/src/mcp/types.ts:292` —
    near-mirror of `@claude-flow/mcp/src/types.ts` (also generic), suggesting one was vendored from the other
  - 17 plugin variants — wide field-set drift; some carry generics, some don't
- Issue: A function typed `(tool: MCPTool) => …` is unsafe across
  package boundaries: the `inputSchema` field's type is one of
  `MCPInputSchema | MCPToolInputSchema | JSONSchema`, all structurally
  distinct. Handler return type is `Promise<MCPToolResult>` (closed) vs
  `Promise<MCPToolResult | unknown>` (escape-hatch) vs `Promise<TOutput>`
  (generic). The cli's `MCPTool.handler` returning `unknown` propagates
  forward — the entire tool-result pipeline is `unknown`-typed at the
  top callsite, then string-cast at each downstream consumer.

### F-14-006 [NOTE] `MCPToolResult` has two genuinely incompatible production shapes
- Location:
  - `/Users/henrik/source/forks/ruflo/v3/@claude-flow/claims/src/api/cli-types.ts:141` —
    `{ success: boolean; data?: unknown; error?: string }`
  - `/Users/henrik/source/forks/ruflo/v3/@claude-flow/hooks/src/workers/mcp-tools.ts:65` —
    `{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }`
- Issue: Same name, completely disjoint field set. A consumer reading
  `result.success` against the hooks-side shape gets `undefined`; one
  reading `result.content` against the claims-side shape gets
  `undefined`. The hooks-side is the **MCP-spec-compliant**
  representation; the claims-side is a custom internal contract that
  shouldn't carry the same TypeScript name.
- Severity rationale: NOTE not WARN because the two definitions are
  package-private and `MCPToolResult` from claims never crosses an
  API boundary into hooks-side code (verified by `grep -rn` showing
  no cross-package imports). But the name collision is a footgun for
  any future refactor that tries to make `MCPToolResult` a shared
  contract.

### F-14-007 [NOTE] `SwarmTopology` invents `'simple'` value in legacy barrel that no other definition accepts
- Location:
  - `/Users/henrik/source/forks/ruflo/v3/src/shared/types/index.ts:166` —
    `'hierarchical' | 'mesh' | 'simple' | 'adaptive'` (the only definition with `'simple'`)
  - `@claude-flow/shared/src/core/interfaces/coordinator.interface.ts:13` —
    `'hierarchical' | 'mesh' | 'ring' | 'star' | 'adaptive' | 'hierarchical-mesh'`
  - `SwarmConfigSchema` (zod) at `shared/core/config/schema.ts:56` —
    matches `coordinator.interface.ts` (no `'simple'`)
- Issue: A consumer that imports `SwarmTopology` from the legacy
  `v3/src/shared/types/index.ts` (re-exported by `v3/src/index.ts:8`)
  can set `topology: 'simple'` and pass typecheck — but
  `SwarmConfigSchema.parse()` will reject the value at runtime.
- Severity rationale: NOTE because no production code actually does
  this (grep returns 0 hits for `'simple'` as a topology literal in
  consumer paths), but the legacy barrel re-exporting the wrong
  enum is a trap for anyone who imports from `'claude-flow/v3'` or
  `'@sparkleideas/cli'` root.

### F-14-008 [NOTE] MCP `inputSchema.properties` is typed as `Record<string, unknown>`, defeating any compile-time schema check
- Location: `/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/types.ts:11-15`
  ```ts
  export interface MCPToolInputSchema {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  }
  ```
- Issue: The shape of each property (its `type`, `enum`, `default`,
  `items`, `description`) is `unknown` — TypeScript will never catch
  a malformed inner schema. Compare with
  `@claude-flow/shared/src/types/mcp.types.ts:20-38`, which DOES define
  `MCPPropertySchema` with `type: 'string'|'number'|…`, `enum?:`,
  `default?:`, `items?: MCPPropertySchema`, `properties?:` (recursive).
  The cli package picked the less-typed variant, so the **299
  handwritten schemas in `cli/src/mcp-tools/`** are validated only at
  runtime by the MCP transport (if at all — agentdb's standalone MCP
  server makes the same choice). This is the structural reason F-14-001
  was possible: there's no static check that schema `required` matches
  handler input validation.

### F-14-009 [NOTE] Cross-package types from agentdb/ruvector/transformers/better-sqlite3 are ambient-`any` at every callsite that imports them
- Location:
  - `/Users/henrik/source/forks/ruflo/v3/@claude-flow/memory/src/types/optional-modules.d.ts:1-56`
  - `/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/types/optional-modules.d.ts`
  - `/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/types/optional-modules.d.ts`
- Issue: Each package declares its own ambient stub:
  ```ts
  declare module 'agentdb' { const m: any; export default m; }
  declare module '@sparkleideas/agentdb' { const m: any; export default m; }
  declare module '@claude-flow/agentdb' { const m: any; export default m; }
  declare module 'ruvector' { const m: any; export default m; export const VectorDB: any; … }
  declare module '@xenova/transformers' { const m: any; export default m; export const pipeline: any; … }
  declare module 'better-sqlite3' { const Database: any; export default Database; export type Database = any; }
  ```
  Every import from these packages comes in as `any`. Consumers like
  `agentdb-backend.ts:56` do `const agentdbModule: any = await import('agentdb')`
  and then destructure `AgentDB`, `HNSWIndex`, `isHnswlibAvailable`,
  `deriveHNSWParams` — all `any`. If agentdb removes or renames any
  of these tomorrow, this code COMPILES but EXPLODES at runtime when
  the destructured value is undefined.
- Severity rationale: NOTE — this is a *deliberate* opt-out pattern
  for the legitimate ambiguity of dual package names
  (`agentdb` upstream / `@sparkleideas/agentdb` Verdaccio /
  `@claude-flow/agentdb` legacy alias — see
  `reference-agentdb-unscoped-name`). Replacing it with real types
  requires either publishing a `@types/*` package per dual name or
  vendoring agentdb's public type surface. Documented here as the
  *worst* cross-package type erosion surface, not as a fix request.

### F-14-010 [NOTE] `RuntimeConfigSchema` uses `passthrough()` everywhere; the runtime types are partly fictional
- Location: `/Users/henrik/source/forks/ruflo/v3/@claude-flow/shared/src/core/config/schema.ts:186-233`
  — 7 `.passthrough()` calls in the runtime config family
- Issue: ADR-0224 wired the runtime config through Zod
  (`getValidatedConfig()`), but the schemas are `passthrough()` —
  unknown keys flow through as `unknown`. The exported
  `type RuntimeConfig = z.output<typeof RuntimeConfigSchema>` only
  types the explicitly-declared leaves (similarityThreshold,
  cleanupIntervalMs, ewcLambda, learning rates, factory worker
  timeouts). Every other key consumers read from
  `.claude-flow/config.json` is `unknown` at the type level. This is
  the right tradeoff — the alternative is a maintenance nightmare —
  but consumers should know that "Zod-validated config" only validates
  ~12 leaves of a much larger document.
- Severity rationale: NOTE — pattern is correct given the constraints,
  flagged for transparency.

### F-14-011 [NOTE] `TaskInputSchema` Zod schema exists and is exported but has zero non-test runtime callsites
- Location: `/Users/henrik/source/forks/ruflo/v3/@claude-flow/security/src/input-validator.ts:274` (definition) +
  `/Users/henrik/source/forks/ruflo/v3/@claude-flow/security/src/input-validator.ts:453` (helper `validateTaskInput()`)
- Issue: `grep -rn 'validateTaskInput\b' --exclude-dir=dist --exclude-dir=node_modules --exclude='*.test.*'`
  returns ZERO production callsites. The schema exists, the helper
  exists, the tests cover the helper — but no MCP tool, no handler,
  no orchestration path ever calls it. Task inputs flow through the
  system without ever touching the declared Zod schema. The
  `SpawnAgentSchema` parallel does get called (at
  `validate-input.ts:308`), so this is specifically `TaskInputSchema`
  that's orphaned, not a pattern-wide failure.
- Severity rationale: NOTE — unused exports per slice 11 territory;
  the validation is silently absent.

### F-14-012 [NOTE] Legacy `v3/src/shared/types/index.ts` (427-line monolith) is dead-end drift surface
- Location: `/Users/henrik/source/forks/ruflo/v3/src/shared/types/index.ts` (427 lines, all-concepts-in-one-file)
- Issue: This file is re-exported by `v3/src/index.ts:8` (`export * from './shared/types';`)
  and defines its own `AgentType`, `MemoryType`, `SwarmTopology`,
  `MCPTool`, `MCPToolResult` etc. — all the duplicates flagged in
  F-14-002 through F-14-007. Every modernized `@claude-flow/*` package
  imports from `@claude-flow/shared/src/types` or its own internal
  `types.ts`, **never** from this file. So the file is a barrel that
  ships in the v3 root but whose types are unreachable through the
  modern paths.
- Cross-reference: this is the worst single source of "type with
  drift values nobody actually uses" because deleting any one
  duplicate would still leave the legacy barrel exporting the wrong
  thing through `v3/src/index.ts`.
- Severity rationale: NOTE — no consumer is broken because no internal
  consumer imports from it, but a third-party importing from
  `'@sparkleideas/cli/v3'` root would get a totally different type
  surface than one importing from `'@sparkleideas/cli/v3/@claude-flow/shared'`.

## Cross-cutting

- **The "shared types between packages" gap is bounded, not catastrophic.**
  Most of the package-internal duplication compiles because nothing
  imports across the duplicate sites — the canonical path inside each
  package is consistent. Real cross-package boundaries usually pass
  serialized data (JSON strings, MCP-protocol envelopes) so the type
  drift never materializes at runtime. The exception is F-14-001's
  schema-vs-handler asymmetry which IS a real runtime hazard.
- **The cli `mcp-tools/types.ts` choice to type `inputSchema.properties`
  as `Record<string, unknown>` is the structural enabler of every
  schema-vs-handler bug** (F-14-001 + the 299 handwritten cli schemas).
  Switching to either Zod-derived schemas (the pattern in
  `rvf-mcp-server/src/server.ts`) or to the more-strongly-typed
  `MCPPropertySchema` from `@claude-flow/shared/src/types/mcp.types.ts`
  would catch the entire class statically. **Out of scope for this
  audit** — flagging for a future refactor wave.
- **The 23-way `MCPTool` definition split** is mostly explained by
  ADR-006's MCP-first design split across `mcp`/`shared`/`cli`/`cli-core`
  packages. The CLI's MCP server doesn't actually consume the
  generic-typed variant from `@claude-flow/mcp/src/types.ts`; it builds
  its own untyped-handler shape. The duplication is *deliberate
  package-local definitions to avoid cross-package imports*, which is
  internally consistent with how the codebase factors `inputSchema`
  validation per package. But every consumer that thinks it's working
  with "THE MCPTool type" is working with one of seven mutually
  incompatible interpretations.
- **The cli `SpawnAgentSchema` enum lie** (F-14-003, intentionally
  routing around `invalid_enum_value`) is the only Zod-vs-TS drift the
  code itself documents in a comment. Every other drift is silent.
- **Worst boundary-erosion surface**: the cross-package
  `optional-modules.d.ts` ambient `any` declarations (F-14-009). Three
  separate copies of the same `declare module 'agentdb' { … any; }`
  pattern. This is the single largest type-loss site in the codebase
  by import frequency — every callsite that imports agentdb's
  `AgentDB`/`HNSWIndex` runtime symbols loses all static type safety.

## Out-of-scope

- **Implementing the F-14-001 fix.** Read-only audit by ADR-0201.
- **Auditing plugin type definitions in depth.** Slice 07 covers
  plugin contents; this slice limited plugin-side checks to the
  `MCPTool` count (17 plugin variants, listed but not individually
  examined).
- **Auditing test/fixture type files.** Test fixtures legitimately
  redefine narrowed enums for assertion purposes (e.g.
  `testing/src/fixtures/memory-fixtures.ts` MemoryType is a test enum,
  not a runtime one).
- **JSON Schema files.** Zero `*.schema.json` or `schema.json` files
  exist outside `node_modules/` in any fork. All JSON Schema is
  inline-declared in `inputSchema: { … }` blocks per MCP tool.
- **Runtime validation behaviour testing.** No actual MCP calls were
  fired; F-14-001 is inferred from code reading, not from a runtime
  reproduction. A future runtime probe slice could confirm by issuing
  an MCP `memory_store` call without `namespace` from a strict client.
- **Schema migration paths.** ADR-0224 + ADR-0214 set the canonical
  paths; this slice did not re-audit whether legacy-shape config
  documents migrate cleanly into the new Zod-validated runtime config.
- **Adversarial input testing.** Slice 13 (G-16-013) covers fuzz/
  adversarial input. Schema laxity (`passthrough()`, untyped
  properties) is a precondition for some classes of injection but the
  injection-attack surface analysis lives in slice 13.
