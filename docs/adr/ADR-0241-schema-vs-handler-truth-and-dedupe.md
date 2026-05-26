---
status: accepted
date: 2026-05-24
tags: [mcp, schema, validation, types, dedupe, audit-followup, ct-h]
supersedes: []
depends-on: [0201, 0224, 0233]
implements: []
---

# Schema-vs-handler truth + type dedupe (CT-H close-out)

## Context

[[ADR-0233]] §CT-H ("Schemas lie about what handlers enforce") gathered four
distinct symptoms of the same root pattern — the MCP `inputSchema`
declarations and the type definitions consumed across packages are
written independently of the runtime that enforces them, so the
declared contract and the actual contract drift:

1. **`memory_store` schema-vs-handler asymmetry (F-14-001 CRITICAL).** The
   fork's `memory_store` MCP `inputSchema.required` lists
   `['key','value','namespace']`. The handler does
   `const namespace = (input.namespace as string) || 'default'`.
   The READ counterparts (`memory_retrieve`, `memory_delete`) `throw`
   when `namespace` is missing. A strict MCP client refuses the call
   (or the server rejects it on schema parse); a permissive client
   passes the call through to a `'default'`-defaulted write. The same
   call lands at two different namespaces depending on which side of
   the wire enforces the schema. A later strict-client read at the
   explicit namespace will miss it — silent data-partitioning by
   client-strictness.
2. **`MemoryType` redefined seven times (F-14-002 WARN).** Five of the
   seven definitions are completely disjoint enum unions for the same
   name; only the `cli` ↔ `agentdb` pair is a documented mirror. Any
   future consumer that tries to use `MemoryType` as an exhaustiveness
   check sees one of seven mutually incompatible interpretations.
3. **`AgentType` redefined five times + intentional Zod bypass
   (F-14-003 WARN).** Five disjoint enum variants (8/10/13/6+string/10).
   The canonical `SpawnAgentSchema` Zod check at
   `cli/src/mcp-tools/validate-input.ts:308` is intentionally
   side-stepped at `:317` — `if (issue.code === 'invalid_enum_value') continue;`
   The schema pretends to constrain; the consumer documents that it
   routes around the constraint.
4. **`MCPTool` interface — 23 production definitions (F-14-005 WARN).**
   Four `@claude-flow/*` variants plus 17 plugin variants, with the
   `inputSchema` field typed as one of `MCPInputSchema |
   MCPToolInputSchema | JSONSchema` and the handler return type varying
   `Promise<MCPToolResult> | Promise<unknown> | Promise<TOutput>`. No
   single typed pipeline survives across a package boundary.
5. **`optional-modules.d.ts` ambient-`any` declarations (F-14-009 NOTE).**
   Three copies (`cli/types/`, `cli/src/types/`, `memory/src/types/`)
   declare `agentdb`, `@sparkleideas/agentdb`, `@claude-flow/agentdb`,
   `ruvector`, `@sparkleideas/ruvector`, `@xenova/transformers`,
   `better-sqlite3` as `const m: any`. Every cross-package callsite
   that imports these loses static type safety; if the underlying
   package renames or removes an export tomorrow, compilation succeeds
   and the runtime explodes at the first destructure.

The unifying defect is that **the codebase has multiple sources of
truth for the same contract**, and **no enforced reconciliation pass
between them**. Where [[ADR-0224]] solved this for one specific
species (the config-substrate Zod-bypass — 17 hand-rolled
`JSON.parse(config.json)` consumers refactored through a single
validated accessor), [[ADR-0233]] §CT-H names the surface that's still
unreconciled: MCP wire schemas, package-internal type duplication, and
ambient-`any` cross-package type erosion.

## Pre-flight verification

Per [[ADR-0201]] §"Remediation-ADR pre-flight checklist":

1. **Signal reaches its audience.** Verified end-to-end per site:
   - **F-14-001:** A spec-compliant MCP client (Anthropic's Claude
     Code) enforces server-declared `required` fields, so the schema
     IS reaching its audience as a rejection. The handler's silent
     default IS also reaching its audience for clients that don't
     pre-validate (or send tools/call with schema-faker payloads).
     Both paths are live; that's why the asymmetry is a real bug, not
     a theoretical one.
   - **F-14-003:** The `invalid_enum_value continue` swallow at
     `validate-input.ts:317` is reachable on every cli MCP
     `agent_spawn` dispatch. The Zod schema runs, but the only
     enforcement signal that survives is field-presence /
     field-type; enum-membership signal is discarded by design.
   - **F-14-002/005/009:** Type-duplication and ambient-`any` are
     compile-time hazards. The "signal" is whatever a TS compile
     would catch if the duplicates collapsed; today the compiler is
     silent because the duplicates are package-private OR the import
     comes in as `any`.
2. **Upstream hasn't already decided it.** Read directly against
   `/Users/henrik/source/ruvnet/ruflo/v3/@claude-flow/cli/src/mcp-tools/memory-tools.ts:274`
   on 2026-05-24:
   - **F-14-001 is a fork-only divergence.** Upstream's
     `memory_store` schema declares `required: ['key', 'value']` (no
     `namespace`). The handler at upstream `:281` does the same
     `(input.namespace as string) || 'default'`. So upstream is
     **coherent** — schema doesn't require namespace, handler defaults
     it; READ side `memory_retrieve` upstream `:346` also declares
     `required: ['key']` (not `['key','namespace']`) and the handler
     also defaults namespace. The fork **added** `'namespace'` to the
     write schema's required list AND tightened the READ handlers to
     throw on missing namespace, creating the asymmetry. Upstream made
     the opposite (consistent-permissive) call.
   - **F-14-002 and F-14-005 are not upstream-decided.** Upstream
     ships the same set of duplicates (verified by `grep -rn 'interface
     MCPTool\b' /Users/henrik/source/ruvnet/ruflo/v3` — 18 of the 19
     fork hits are present in upstream as well). Consolidating into a
     `@claude-flow/types` shared package would be a perpetual
     merge-tax against upstream's per-package factoring (ADR-006's
     MCP-first split, called out in the audit at lines 369-378).
   - **F-14-003 (Zod-bypass comment + swallow) is fork-only by
     comment archeology.** The `if (issue.code === 'invalid_enum_value') continue`
     swallow is documented in the fork as "we support custom types";
     upstream's posture on plugin-supplied agent types is the same
     (string-typed at storage), but the bypass is fork-local.
   - **F-14-009 (`optional-modules.d.ts`) is mostly fork-only** —
     upstream doesn't ship the `@sparkleideas/*` ambient declarations.
     The `agentdb` / `@xenova/transformers` / `better-sqlite3`
     ambients are upstream as well; the dual-name `@sparkleideas/*`
     mirrors were added by the codemod era.
3. **Premise/inventory is true at runtime.** Re-verified all
   five citations by direct read on 2026-05-24:
   - `memory-tools.ts:193` — `required: ['key', 'value', 'namespace']` ✓
   - `memory-tools.ts:260` — `const namespace = (input.namespace as string) || 'default'` ✓
   - `memory-tools.ts:370` — `required: ['key', 'namespace']` (READ throws on missing) ✓
   - `memory-tools.ts:378` — `throw new Error("'namespace' is required …")` (READ side) ✓
   - `memory-tools.ts:716` — `required: ['key', 'namespace']` (DELETE throws on missing) ✓
   - `validate-input.ts:317` — `if (issue.code === 'invalid_enum_value') continue;` ✓
   - `MCPTool` interface count — 19 production matches in fork (`@claude-flow/*` + plugins); audit's "23 production definitions" includes 4 plugin variants the targeted grep didn't surface. Order-of-magnitude correct; the dedupe argument doesn't depend on the exact integer.
   - `optional-modules.d.ts` — three copies confirmed:
     `cli/types/`, `cli/src/types/`, `memory/src/types/` ✓
4. **No sibling-ADR overlap.** Three relevant siblings checked:
   - **[[ADR-0204]] (b) F-09-001 — validate-in-place** commits to
     importing `validateSchema` (`@claude-flow/mcp/schema-validator`)
     into the `tools/call` of all three stdio loops BEFORE the
     handler runs. **That is partial overlap with Option A
     (handler-validation derived from `inputSchema`):** once ADR-0204
     ships, the schema becomes the enforced contract at the wire. But
     ADR-0204 does NOT reconcile the asymmetric write-strict /
     read-strict / handler-default situation — it only ensures
     whatever the schema says is what the wire enforces. The
     remaining decision (does `memory_store` require `namespace`?) is
     **this ADR's** scope and not ADR-0204's.
   - **[[ADR-0224]] (substrate Zod-bypass)** is a sibling but
     non-overlapping species. ADR-0224 covered the
     `JSON.parse(config.json)` substrate bypass and the
     `embedding.provider` default-skew. It did NOT touch the
     `validate-input.ts:317` `invalid_enum_value` swallow or any MCP
     `inputSchema` topic. The accessor pattern it established is the
     **model** for what a single-source-of-truth fix looks like, but
     the surface is distinct.
   - **No sibling ADR addresses the type-duplication clusters**
     (`MemoryType` / `AgentType` / `MCPTool` / `optional-modules`).

## Considered options

### Option A — Generate handler-validation FROM `inputSchema` (single source of truth at the MCP boundary)

Per-tool, the handler's input-shape preconditions are mechanically
derivable from the declared `inputSchema`. Either:

- A1. Run `validateSchema(toolName, input)` at the top of every
  handler (the package's `@claude-flow/mcp/schema-validator` already
  ships the validator), OR
- A2. Wire validation at the wire boundary (`tools/call` dispatcher)
  so handlers don't need per-call boilerplate.

Pros: closes F-14-001 by construction (asymmetry impossible —
handler enforces whatever the schema says). Mostly subsumed by
[[ADR-0204]] (b) for the wire-boundary form (A2).

Cons: Does not by itself reconcile the *content* of the schema with
the *intent* of the handler — if the schema says namespace required
and the handler defaults it, both flip to "required" (the schema
wins), which is the opposite of upstream's consistent-permissive
posture. Needs a per-tool decision on which side moves.

### Option B — Schema-vs-handler arch-test (sampled per CI run)

A new arch-test (`cli/__tests__/arch/schema-handler-parity.arch.test.ts`)
that samples N MCP tools per CI run and asserts: for every field listed
in `inputSchema.required`, omitting that field from a synthetic call
causes the handler to throw OR to return `{success: false, error}`
containing the field name. Tools where the handler defaults the
required field fail the arch-test.

Pros: catches future occurrences of F-14-001 without requiring all
handlers to migrate. Sampling keeps the per-CI cost bounded.

Cons: doesn't fix existing drift on its own; needs each existing
drift site to be reconciled before the test passes. Sampling means a
drift can hide for several CI runs before being sampled.

### Option C — Consolidate duplicated types into a shared `@claude-flow/types` package; ban ambient-`any` declarations

A new `@claude-flow/types` package owns `MemoryType`, `AgentType`,
`TaskStatus`, `MCPTool`, `MCPToolResult`, `SwarmTopology`. Every
`@claude-flow/*` package depends on it. The three `optional-modules.d.ts`
files are replaced with real `.d.ts` shipped from `@sparkleideas/agentdb`
and `@sparkleideas/ruvector` (or vendored alongside them).

Pros: maximal type safety; one source of truth across the package
boundary; static catches every duplicate-divergence at compile time.

Cons: Pre-flight #2 disqualifies this. Upstream ships the same
duplicates as a deliberate per-package-factoring choice. A
`@claude-flow/types` consolidation in the fork creates a perpetual
merge-tax against every upstream sync — every type the consolidated
package owns is a type upstream redefines per-package, and every
merge round will need to re-establish the consolidation. The audit
itself flags this at lines 369-378 ("the 23-way `MCPTool` definition
split is mostly explained by ADR-006's MCP-first design split across
mcp/shared/cli/cli-core packages"). The cost is structural and
recurring; the benefit is bounded (most duplicates compile because
nothing imports across them).

For the `optional-modules.d.ts` half, the dual-name (`agentdb` /
`@sparkleideas/agentdb` / `@claude-flow/agentdb`) ambiguity is itself
fork-only (per [[reference-agentdb-unscoped-name]]); replacing with
real `.d.ts` requires publishing typed `@types/*` packages for each
dual name or vendoring the public surface. The audit explicitly
marks this as a deliberate opt-out pattern (F-14-009 severity NOTE,
"documented as the worst cross-package type erosion surface, not as
a fix request").

### Option D — Per-tool surgical fix of F-14-001 only; defer the rest

Fix only the `memory_store` asymmetry. Two surgical sub-options:

- D1. **Schema relaxes to match handler.** Remove `'namespace'` from
  `inputSchema.required` of `memory_store`; document the default in
  the property description; align with upstream's
  `required: ['key', 'value']`. The READ-side handlers' throw stays
  (they're already documented as requiring an explicit namespace,
  which is meaningful — `'all'` is rejected because semantic-search
  defaults are wrong for them).
- D2. **Handler tightens to match schema.** Replace the
  `|| 'default'` with the same throw the READ side uses. Schema and
  handler both reject missing namespace; the fork stays divergent
  from upstream.

D1 is the upstream-aligned shape; D2 is the strict-everywhere shape.

Pros (D1): aligns with upstream (reduces merge-tax against the next
sync). Simple — one schema line + one handler line. Re-converges
the asymmetry without touching the type-duplication clusters.

Pros (D2): explicit-namespace is more discoverable for users; no
silent defaulting. But also: diverges further from upstream, costs
merge-tax forever.

Cons (D1/D2): does not address F-14-003 (Zod-bypass) or the
type-duplication clusters at all. Those are deferred to either
[[ADR-0233]]'s lower-priority CT items or to future work.

## Decision

**Chosen: Option D1 (schema relaxes to match handler, upstream-aligned)
+ Option B (arch-test guard against future drift) + targeted
F-14-003 fix.**

Rationale per option:

- **Option C is rejected** by pre-flight #2 (upstream merge-tax
  asymmetric to the bounded internal benefit). The audit's own
  severity tagging (F-14-009 NOTE, F-14-002 WARN, F-14-005 WARN) is
  consistent: these are documentation-of-debt, not load-bearing
  correctness issues. The arch-test (Option B) closes the future
  drift channel without consolidating the surface.
- **Option A2 is subsumed by [[ADR-0204]] (b).** Once that ships, the
  wire validates against `inputSchema` before handler dispatch. We
  rely on ADR-0204 for the structural fix; this ADR does not duplicate
  it.
- **Option D1 over D2** because upstream is the cheaper convergence
  point and the user-visible difference is small (a permissive write
  to namespace `'default'` is the documented default; users who care
  about explicit namespace already pass it). D2 doubles down on a
  fork-only divergence that has no clear upside.
- **Option B (arch-test)** prevents the F-14-001 *class* from
  recurring — any future tool whose schema-required field is
  defaulted by the handler fails the gate at CI. This is the same
  shape as [[ADR-0224]]'s `config-no-raw-parse.arch.test.ts` guard,
  applied to a different surface.
- **F-14-003 (`invalid_enum_value continue` swallow)** gets a
  targeted fix in the same ADR: replace the silent `continue` with
  an explicit allowlist check. Either the inline validator at
  `validate-input.ts` already canonicalizes the custom-type
  identifier (in which case the swallow is unnecessary — let Zod
  reject), or the schema's enum is incomplete (in which case
  extending the enum is the fix). Either way, the swallow goes —
  documented schema-vs-handler drift is still drift.

Out of scope (deferred per pre-flight #2 and audit severity):

- Type consolidation of `MemoryType` / `AgentType` / `TaskStatus` /
  `MCPTool` / `MCPToolResult` / `SwarmTopology` (F-14-002, -003,
  -004, -005, -006, -007). The 23-way `MCPTool` split tracks
  upstream; consolidating is a perpetual merge-tax.
- `optional-modules.d.ts` ambient-`any` consolidation (F-14-009).
  Audit marks NOTE; replacement requires typed `@types/*` per dual
  name. Deferred until dual-name resolution lands (out-of-tree).
- `MCPToolInputSchema` properties-as-`Record<string, unknown>`
  (F-14-008). Structural enabler of the F-14-001 class, but
  addressing it requires Zod-derived schemas across all 299 cli
  inputSchemas. Audit explicitly flags "Out of scope for this
  audit — flagging for a future refactor wave."
- `RuntimeConfigSchema.passthrough()` (F-14-010), `TaskInputSchema`
  zero callsites (F-14-011), legacy `v3/src/shared/types/index.ts`
  monolith (F-14-012). Each is a separate seam not in this ADR's
  scope.

### Concrete change shape

1. **F-14-001 reconciliation (Option D1):**

   ```ts
   // memory-tools.ts:193 — drop 'namespace' from required
   required: ['key', 'value'],

   // memory-tools.ts:182 — make the description carry the contract
   namespace: { type: 'string', description: 'Namespace for organization (default: "default")' },
   ```

   No handler change. The runtime `(input.namespace as string) || 'default'`
   stays. After [[ADR-0204]] (b) lands, the wire validator enforces
   the relaxed schema; strict clients no longer reject the call.
   Upstream-aligned at `:274`.

2. **F-14-003 fix (drop the Zod swallow):**

   ```ts
   // validate-input.ts:316 — replace
   //   if (issue.code === 'invalid_enum_value') continue;
   // with the explicit allowlist check
   const knownCustomTypes = await getKnownCustomAgentTypes(); // returns Set<string>
   for (const issue of zodErr.issues) {
     if (
       issue.code === 'invalid_enum_value' &&
       issue.path.join('.') === 'type' &&
       knownCustomTypes.has(input.agentType as string)
     ) {
       continue; // explicit allowlist match
     }
     errors.push(`${issue.path.join('.')}: ${issue.message}`);
   }
   ```

   If the inline validator earlier in the function already
   canonicalized `input.agentType` as a safe identifier, the
   allowlist check is the documented seam where "custom types"
   becomes a first-class concept. The silent `continue` becomes a
   typed allowlist — the schema-vs-handler drift goes away, replaced
   with an explicit "we accept these custom types" extension point.

3. **Option B arch-test:**

   ```ts
   // cli/__tests__/arch/schema-handler-parity.arch.test.ts (NEW)
   import { memoryTools } from '../../src/mcp-tools/memory-tools';
   // …and the other cli mcp-tools registries

   const ALL_TOOLS = [...memoryTools, ...hiveMindTools, …];

   describe('schema-handler parity', () => {
     for (const tool of ALL_TOOLS) {
       const required = tool.inputSchema?.required ?? [];
       for (const field of required) {
         it(`${tool.name}: handler rejects missing ${field}`, async () => {
           const input = synthesizeValidInputMinus(tool, field);
           const result = await tool.handler(input);
           expect(
             result &&
             typeof result === 'object' &&
             ('success' in result ? result.success === false : true) &&
             JSON.stringify(result).includes(field)
           ).toBe(true);
         });
       }
     }
   });
   ```

   Sampling is optional — full enumeration is bounded (~200 tools ×
   ~3 required fields ≈ 600 generated tests, each <50ms). Run the
   full set under `npm run release` acceptance; per-PR CI can
   sample to keep wall-clock down. The gate FAILS on F-14-001's
   exact shape (schema declares required, handler defaults rather
   than rejects).

## Consequences

- Good, because the user-visible F-14-001 asymmetry closes. Permissive
  and strict MCP clients dispatch `memory_store` calls to the same
  namespace (`'default'` when omitted, the declared value when
  present). No more silent data partitioning by client-strictness.
- Good, because the fix is upstream-aligned. The next upstream sync
  doesn't reintroduce the asymmetry — the fork no longer
  preferentially diverges on this contract.
- Good, because F-14-003's documented-schema-vs-handler-drift gets a
  typed allowlist replacement. The "we route around the Zod enum"
  comment is replaced with a "we extend the Zod enum with these
  custom types" surface — much easier to reason about and to test.
- Good, because Option B (arch-test) prevents the F-14-001 class from
  recurring. The exact same defect cannot ship in any new MCP tool
  without failing CI.
- Bad, because the type-duplication clusters (F-14-002, -005, etc.)
  remain in place. The codebase keeps shipping 5-7 disjoint
  definitions of `MemoryType` / `AgentType` / `MCPTool`. The audit
  judges this WARN (not CRITICAL) because the duplicates are
  package-private; this ADR accepts that judgment and defers
  consolidation. A future refactor wave could revisit if any of the
  duplicates start crossing a package boundary.
- Bad, because Option D1 means existing strict MCP clients that have
  been *correctly* refusing the unaligned call (because the fork's
  schema lied) will start accepting it — silently. The behaviour
  change is invisible to users in either direction (the write
  succeeds either way; the question is only which namespace it lands
  at). Mitigation: the property description's `default: "default"`
  surface IS the documentation; clients that don't pass namespace
  get exactly what the schema description promises.
- Bad, because Option B arch-test is wall-clock cost in the
  acceptance suite. Bounded by tool count × avg required-field count
  (~200 × 3); each generated test is a synthetic in-process call so
  no MCP round-trip cost. Estimated <30s for the full set.
- Neutral, because `optional-modules.d.ts` ambient-`any` stays. The
  dual-name ambiguity for `@sparkleideas/agentdb` /
  `@claude-flow/agentdb` / unscoped `agentdb` is documented and
  load-bearing (per [[reference-agentdb-unscoped-name]]); replacing
  with real `.d.ts` is its own track.

### Confirmation

1. **Unit test (F-14-001 — write-side schema/handler parity):** dispatch
   `memory_store` over the in-process MCP server with input
   `{key:'k', value:'v'}` (no namespace). Assert the call succeeds AND
   the stored entry is retrievable at namespace `'default'`. Pre-fix
   under [[ADR-0204]] (b): would FAIL on schema rejection (schema lies);
   post-fix: passes.
2. **Unit test (F-14-001 — round-trip from permissive then strict
   client):** write via `memory_store {key:'k', value:'v'}` (no
   namespace). Read via `memory_retrieve {key:'k', namespace:'default'}`.
   Assert the value comes back. (Pre-fix the asymmetry could have
   landed it elsewhere; post-fix the data partitioning closes.)
3. **Unit test (F-14-003 — Zod allowlist):** call the
   `validateAgentSpawn` helper with `agentType:'<unknown-custom>'`
   that is NOT in the allowlist; assert the error message includes
   `"invalid_enum_value"`. With `agentType:'<allowed-custom>'`,
   assert no error. (Pre-fix: both pass silently; post-fix: only
   allowlist-match passes.)
4. **Arch-test (Option B):** the new
   `schema-handler-parity.arch.test.ts` generates one test per
   `(tool, requiredField)` pair across all cli `mcp-tools/` registries.
   Pre-fix it FAILS on `memory_store × namespace` (handler defaults
   instead of rejecting). Post-fix: passes.
5. **Acceptance gate:** `npm run release` runs the arch-test and the
   three behaviour tests. Per
   [[feedback-skip-accepted-as-squelch]]: this gate may NOT be
   `skip_accepted`. Schema-vs-handler asymmetry is the exact class
   the gate exists to catch.
6. **No-regression:** existing tests that exercise `memory_store` with
   an explicit namespace continue to pass unchanged.

## Sites / duplication table

| # | Finding | Site | Severity | Fix in this ADR |
|---|---------|------|----------|-----------------|
| 1 | F-14-001 | `cli/src/mcp-tools/memory-tools.ts:193` schema vs `:260` handler | CRITICAL | YES — Option D1 (schema relax) |
| 2 | F-14-002 | `MemoryType` — 7 disjoint definitions across `shared/`, `memory/`, `cli/`, `agentdb/`, `v3/src/` | WARN | NO — defer (upstream-shape, no cross-boundary import) |
| 3 | F-14-003 | `cli/src/mcp-tools/validate-input.ts:317` `invalid_enum_value continue` swallow | WARN | YES — explicit allowlist replacement |
| 4 | F-14-004 | `TaskStatus` — 11 redefinitions w/ divergent state-machine vocabulary | WARN | NO — defer |
| 5 | F-14-005 | `MCPTool` interface — 23 production definitions (4 `@claude-flow/*` + 17 plugins + 2 root v3) | WARN | NO — defer (upstream-shape) |
| 6 | F-14-006 | `MCPToolResult` — 2 incompatible shapes (`{success, data, error}` vs `{content[], isError}`) | NOTE | NO — defer (package-private) |
| 7 | F-14-007 | `SwarmTopology` invents `'simple'` in legacy `v3/src/shared/types/index.ts` | NOTE | NO — defer (zero consumers, dead-end barrel) |
| 8 | F-14-008 | `MCPToolInputSchema.properties: Record<string, unknown>` | NOTE | NO — defer (Zod-derived schemas = future refactor wave) |
| 9 | F-14-009 | 3× `optional-modules.d.ts` ambient-`any` for `agentdb`/`ruvector`/`@xenova/transformers`/`better-sqlite3` | NOTE | NO — defer (dual-name ambiguity load-bearing) |
| 10 | F-14-010 | `RuntimeConfigSchema.passthrough()` × 7 | NOTE | NO — owned by [[ADR-0224]] / accepted as bounded |
| 11 | F-14-011 | `TaskInputSchema` Zod schema with zero non-test callsites | NOTE | NO — defer (unused exports — slice 11 territory) |
| 12 | F-14-012 | Legacy `v3/src/shared/types/index.ts` 427-line monolith — dead-end drift surface | NOTE | NO — defer (zero internal consumers) |
| — | (gate) | New `cli/__tests__/arch/schema-handler-parity.arch.test.ts` | — | YES — Option B (arch-test) |

## More information

- **Audit source:** `docs/audits/2026-05-24-second-pass-audit/14-schema-type-definitions.md`
  (12 findings, 1 CRITICAL, 3 WARN, 8 NOTE).
- **Theme:** [[ADR-0233]] §CT-H.
- **Pre-flight checklist:** [[ADR-0201]] §Remediation-ADR pre-flight checklist (added 2026-05-20).
- **Sibling ADRs (overlap-checked):**
  - [[ADR-0204]] (b) — validate-in-place at MCP wire boundary. Provides the structural Option A2; this ADR layers the content fix on top.
  - [[ADR-0224]] — substrate Zod-bypass single-accessor. Different species, same pattern (single source of truth + arch-test guard).
- **Memory references:**
  - [[reference-embedding-model]] — canonical model defaults that downstream `MemoryType` consumers depend on; orthogonal to this ADR's surface but informs the consolidation deferral (`MemoryType.vector` is one of the 7 disjoint variants).
  - [[reference-agentdb-unscoped-name]] — load-bearing dual-name pattern; why `optional-modules.d.ts` ambient-`any` stays.
  - [[feedback-no-fallbacks]] — silent schema-vs-handler asymmetry is the same shape as silent fallback at the wire boundary.
  - [[feedback-remediation-adr-preflight]] — drove pre-flight #2 (upstream-coherent) and #4 (overlap with ADR-0204).
  - [[feedback-skip-accepted-as-squelch]] — Option B arch-test may NOT be `skip_accepted`.
- **Carry-forward (not addressed here):**
  - `MCPToolInputSchema.properties: Record<string, unknown>` (F-14-008) — the structural enabler of F-14-001's class. Addressed only at the wire (ADR-0204 (b)) and at the per-handler arch-test (this ADR); the type itself stays `unknown`-typed. A future refactor could derive `inputSchema` from per-tool Zod schemas (the pattern in `rvf-mcp-server/src/server.ts`) but that touches all 299 cli handwritten schemas.
  - Type consolidation under a shared `@claude-flow/types` package (Option C). Deferred indefinitely per pre-flight #2 (upstream merge-tax asymmetric to bounded internal benefit).
  - `optional-modules.d.ts` real `.d.ts` replacement. Deferred until dual-name resolution lands (out-of-tree).

## Swarm review (2026-05-24)

Pattern-1 Council Hive (Dialectic). Byzantine consensus (f=⌊5/3⌋=1; ≥3/6
supermajority required). hierarchical-mesh topology, strategic queen, N=6
experts incl. devil's advocate, queen-composed transport. Per per-ADR
configuration in `docs/plans/2026-05-24-second-pass-remediation-plan.md`.

### Verdict

**5/6 adopt** (≥3/6 supermajority cleared, Byzantine `2f+1=3` satisfied):
ratify Option D1 + Option B + F-14-003 typed allowlist as drafted, with two
amendments:

1. **Pre-flight #2 correction (E5 upstream-coherence tracker)**: the sub-bullet
   labelling the F-14-003 `invalid_enum_value continue` swallow as "fork-only
   by comment archeology" is **refuted**. Direct read of
   `/Users/henrik/source/ruvnet/ruflo/v3/@claude-flow/cli-core/src/mcp-tools/validate-input.ts:248`
   shows the swallow is **byte-identical between fork and upstream** — the
   fork's `cli/src/mcp-tools/validate-input.ts` is a 10-line re-export shim
   of cli-core. The F-14-003 fix therefore carries upstream merge-tax that
   the ADR currently underweights. Implementation requires: (a)
   INTEGRATION-LEDGER row with `superseded-by-local` disposition per
   `[[feedback-update-integration-ledger]]`; (b) divergence-marker comment
   per [[ADR-0234]] precedent at the fix site. ("Fork created the asymmetry"
   for F-14-001 stands — upstream's `memory-tools.ts:274` is
   `required: ['key','value']` and the fork added `'namespace'` plus the
   read-side throws.)
2. **Option B gate registration (E4 Zod-arch-test specialist)**: arch-test
   runs full enumeration (~200 tools × ~3 required fields ≈ 600 generated
   tests) under `npm run release` acceptance, with the gate registered in
   BOTH `run_check_bg` AND `collect_parallel` lists per
   `[[reference-acceptance-runcheck-vs-collect]]` (the silent-no-verdict trap).
   Sampling stays optional for per-PR CI. No `skip_accepted` per
   `[[feedback-skip-accepted-as-squelch]]`.

### Per-voter ballots

| Voter | Vote | Position |
|-------|------|----------|
| E1 (MCP `inputSchema` specialist) | adopt | Schema relax matches upstream; F-14-001 asymmetry closes by construction once [[ADR-0204]] (b) lands the wire-validator. |
| E2 (handler-validation specialist) | adopt | Handler stays unchanged — no risk of breaking existing strict-client call sites; partitioning bug closes from the schema side. |
| E3 (type-deduplication specialist) | adopt | Deferring `MCPTool`/`MemoryType`/`AgentType` consolidation is correct — upstream factoring per ADR-006's MCP-first split makes Option C a perpetual merge-tax against bounded internal benefit (no cross-package imports today). |
| E4 (Zod-arch-test specialist) | adopt-with-amendment | Add gate registration in both `_run_and_kill` lists; full enumeration in acceptance, sampled in per-PR CI. |
| E5 (upstream-coherence tracker) | adopt-with-amendment | Pre-flight #2 mis-states F-14-003's upstream status (byte-identical, not fork-only) — needs INTEGRATION-LEDGER row + divergence marker. |
| DA (devil's advocate) | hold-principled-dissent | Two challenges: (a) "Relaxing the schema validates ad-hoc client behaviour — write-strict / read-lax would be cleaner" — rejected because upstream-aligned is cheaper merge-cost and the audit notes silent-default is the documented contract. (b) "23 MCPTool definitions is the wrong target — let upstream factoring win, defer dedupe entirely" — partly accepted (Option C IS deferred); DA also dissents on Option B value vs cost (gate catches a defect class whose only known instance is being structurally fixed by [[ADR-0204]] (b); ~30s wall-clock is bounded but the gate is belt-and-braces theatre once handler migration completes). DA accepts majority verdict; dissent recorded. |

### DA final position

Per skill best-practice #6 (DA must explicitly withdraw or hold), DA holds
**principled dissent** on Option B's long-term value: the gate catches a
defect class whose only known instance (F-14-001) is being structurally fixed
by [[ADR-0204]] (b), so the gate is belt-and-braces theatre once handler-rule
adoption ([[ADR-0242]]) lands broadly. DA accepts the majority verdict (gate
is cheap, mitigates regression-window between ADR-0204 (b) landing and broader
[[ADR-0242]] handler-rule adoption) but records the dissent for the
[[ADR-0233]] follow-up tracker — Option B may warrant retirement once
ADR-0204 + ADR-0242 reach steady-state.

### Key upstream finding (per assignment)

- **CONFIRMED**: "fork created the asymmetry" (F-14-001). Upstream
  `memory-tools.ts:274` has `required: ['key', 'value']` (no namespace) +
  handler defaults `(input.namespace as string) || 'default'` —
  coherent permissive. Fork at `:193` added `'namespace'` to required
  AND tightened read handlers at `:378`/`:724` to throw on missing
  namespace. Pure fork divergence; "relax not tighten" flip per
  [[ADR-0233]] §"Pre-flight inversions" is the correct upstream-convergent
  move.
- **REFUTED** (scope-correction to ADR pre-flight #2): "F-14-003
  (Zod-bypass) is fork-only by comment archeology" — wrong. Upstream
  cli-core ships the swallow byte-identically; the fork is upstream-aligned
  here. Fix carries merge-tax requiring INTEGRATION-LEDGER + divergence marker
  per [[ADR-0234]] precedent. Amendment #1 above corrects this in the
  implementation track.

### Fragment

Full review (per-voter ballots, implementation steps, validation, risks,
cross-references) at `docs/plans/.frags/ADR-0241-review.md`.
