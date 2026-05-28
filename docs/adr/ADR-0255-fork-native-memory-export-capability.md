---
status: accepted
completed: true
date: 2026-05-25
implemented: 2026-05-28
tags: [memory, mcp-tools, cli, export, upstream-disposition, archivist]
supersedes: []
depends-on: [ADR-0177, ADR-0181, ADR-0246, ADR-0253]
implements: []
---

> **Status note (2026-05-28)**: Both phases shipped. Phase 1 (`memory_export`
> MCP tool + envelope shape) landed via fork commit `adb91ab3d` (pre-existing
> in fork; verified registered at `forks/ruflo/.../memory-tools.ts:1346`).
> Phase 2 (`memory retrieve --value-only` flag) landed via fork commit
> `662957caa`. 2 smokes wired via `lib/acceptance-adr0255-checks.sh`; full
> release pipeline 2/2 PASS. Ledger row `0c31cbad4` finalized
> `superseded-by-local` with both commit SHAs. Phase 3 golden-test scenarios
> covered by the 2 wired smokes (envelope shape + value round-trip + format
> typed-error + includeVectors typed-error). Phase 4 ledger close paired in
> this commit.

# Fork-native `memory_export` capability (closes ledger row `0c31cbad4`)

## Context and Problem Statement

The 2026-05-25 ledger audit ([[INTEGRATION-LEDGER.md]] row `0c31cbad4`) found the upstream commit `fix(memory): #2073 — export returns real value + --value-only pipe-friendly retrieve` (`ruvnet/ruflo`, 2026-05-20) as `keep-pending`. The reason: the upstream fix patches a fork surface that doesn't exist here.

The upstream commit changes four files:

* `v3/@claude-flow/cli/src/mcp-tools/memory-tools.ts` — adds `includeContent: true` to the `memory_export` MCP tool's `listEntries` call and maps `e.content` → exported `value` field.
* `v3/@claude-flow/cli/src/memory/memory-bridge.ts` — adds `includeContent` option to `bridgeListEntries`, returning the row's `content` and ungated full id.
* `v3/@claude-flow/cli/src/memory/memory-initializer.ts` — same `includeContent` option on the matching `listEntries` path.
* `v3/@claude-flow/cli/src/commands/memory.ts` — adds `--value-only` flag to `memory retrieve` for pipe-friendly stdout.

Fork divergence at runtime, verified 2026-05-25:

* **No `memory_export` MCP tool exists.** Only 10 memory tools are registered in `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/memory-tools.ts` (lines 174-1209): `memory_store`, `memory_retrieve`, `memory_search`, `memory_delete`, `memory_list`, `memory_stats`, `memory_migrate`, `memory_import_claude`, `memory_bridge_status`, `memory_search_unified`. There is no `memory_export` and no `memory_import`.
* **The CLI calls a missing MCP tool.** `forks/ruflo/v3/@claude-flow/cli/src/commands/memory.ts:1208` invokes `callMCPTool<...>('memory_export', { outputPath, format, namespace, includeVectors })`. The CLI surface is wired (format choices: `json`/`csv`/`binary`; `--include-vectors` flag), but the MCP tool that backs it isn't registered. This is a latent CLI-MCP gap; `claude-flow memory export` will fail with an MCPClientError today.
* **No `memory-bridge.ts` / `memory-initializer.ts` in the fork's restructured subtree.** The fork's `v3/@claude-flow/cli/src/memory/` directory holds 7 files (`archivist-init.ts`, `ewc-consolidation.ts`, `intelligence.ts`, `memory-router.ts`, `neural-package-bridge.ts`, `rabitq-index.ts`, `sona-optimizer.ts`) per the [[ADR-0177]] substrate restoration. The functions upstream patches (`listEntries`, `bridgeListEntries`) do not exist on this surface.
* **The fork's `routeMemoryOp({type:'list'})` already returns `content`.** Verified at `memory-router.ts:1554-1571`: the dispatched archivist read returns `MemoryListRecord` which includes `content` (and `tags`) by default since [[ADR-0181]] task #100 follow-up (2026-05-17, agentdb a72f664). The upstream `includeContent: true` opt-in is not needed in the fork — the data path already carries the value, and the [[ADR-0181]] header documents this as the source-of-truth for the `list` path's wider record shape.

The audit row recorded the disposition trigger: *"separate ADR deciding fork's `memory_export` surface (vendor upstream → hand-ported; keep fork distinct → superseded-by-local)."* This ADR is that decision.

The user directive 2026-05-25 reframed the trigger to a positive: *"The intention of the memory export must be captured in our forks."* That is, the fork should grow a `memory_export` capability designed against its own substrate and conventions, not a hand-port that pretends the upstream architecture is in place.

## Decision Drivers

* **CLI surface is already wired; MCP tool is the gap.** The fork's `commands/memory.ts:1187-1232` already exposes `claude-flow memory export -o <path> [-f <format>] [-n <namespace>] [--include-vectors]`. Shipping the matching MCP tool closes a latent regression — running the CLI today throws `MCPClientError: Tool not found`. Per `[[feedback-no-fallbacks]]`, the right fix is to wire the tool, not to silently swallow the missing-tool error in the CLI handler.
* **Substrate seam is mandatory** ([[ADR-0181]], [[ADR-0246]]). The fork routes all memory reads through `routeMemoryOp` or `archivist.dispatchRead` ([[ADR-0181]] Phase 5 F4-3). A new memory tool that reaches into a SQL store directly would re-introduce the data-path forks the seam was built to prevent. The export must read via the same seam every other memory tool uses.
* **`includeContent` is upstream debt the fork doesn't have.** Upstream's `includeContent: true` flag exists because upstream's `listEntries` strips `content` by default to keep metadata-only callers cheap. Fork's `memory_list` dispatched path already returns `content` (see Context). Mirroring the upstream opt-in would import a contract that doesn't apply here.
* **Per `[[feedback-no-fallbacks]]`: the CSV/binary surface is already CLI-advertised.** The fork CLI's `format` option declares `json`/`csv`/`binary` (`commands/memory.ts:1166-1168`). Upstream's MCP tool advertises `json`/`csv` and adds the note *"CSV not implemented yet — wrote JSON"*. The MCP tool MUST honor the format choice or fail loudly with a typed error — silently writing JSON when CSV/binary was requested is the kind of silent fallback the fork forbids.
* **Per `[[ADR-0253]]`: substrate carve-outs are explicit, not implicit.** The export is a read-only enumeration; it does not introduce a new write path, so no new carve-out is created. But it MUST surface through the cli-process Archivist (RVF + HNSW), not the daemon-process Archivist (FS-JSON, per [[ADR-0253]] C1) — the export host is the cli process by design.
* **Per memory `[[feedback-no-time-estimates]]`:** no phase ordering implies a time-bound; the plan below sequences shape, not duration.

## Considered Options

* **Option A — Hand-port upstream's `memory_export` MCP tool + the `--value-only` retrieve flag verbatim.** Pull in upstream's `includeContent: true` plumbing, vendor the upstream `memory_export` body, and add `--value-only` to the `retrieve` command. Rejected: the `includeContent` opt-in addresses a problem the fork doesn't have (the fork's dispatched `list` already returns `content`); the upstream MCP tool reads via `listEntries` (an upstream-only function — the fork has no `memory-initializer.ts` to attach it to); and porting the function-routing pattern (re-establishing `getMemoryFunctions()`) regresses the [[ADR-0181]] seam discipline.
* **Option B — Author a fork-native `memory_export` MCP tool that reads through `routeMemoryOp({type:'list'})`, plus a `--value-only` flag on `memory retrieve` that mirrors upstream's pipe-friendly intent.** Lands the missing MCP tool against the fork's actual substrate seam. Honors the CLI surface already wired (json/csv/binary, `--include-vectors`, namespace filter). Includes the `--value-only` companion fix because the underlying motivation (cost-tracker pipeline needs pipe-friendly retrieve) applies equally to the fork. **Chosen.**
* **Option C — Mark the row `superseded-by-local` without shipping anything.** Acknowledge the architectural divergence and leave the CLI's broken `memory export` call as latent debt. Rejected: it leaves a user-visible CLI command that throws at runtime, which is a `[[feedback-no-fallbacks]]` violation — the export is advertised to users today.
* **Option D — Remove the CLI export command entirely.** If we can't back it with an MCP tool, remove the CLI surface. Rejected: the CLI surface is genuine value (the ruflo-cost-tracker, session blobs, and audit-trail consumers all want a stable export format). Removing it punishes the integration consumers for a missing implementation.

## Decision Outcome

Chosen: **Option B — fork-native `memory_export` MCP tool + `memory retrieve --value-only` flag, both designed against the fork's substrate seam and CLI surface.**

The seven design decisions are recorded below; the trigger to ship is **Phase 1 of the Plan** (the MCP tool registration) — that single phase closes the CLI's runtime gap. Phase 2 (the `--value-only` flag) is paired because it is the same upstream commit's motivation, but lands as an independent step.

### Decision 1 — Surface: MCP tool + CLI verb (both)

The fork ships **both** surfaces:

* **MCP tool `memory_export`** — registered in `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/memory-tools.ts`. Matches the upstream tool name (so any external caller that uses the upstream name finds it). Returns `{ outputPath, format, exported: { entries, vectors, patterns }, fileSize }` to satisfy the CLI's `callMCPTool<...>` type contract at `commands/memory.ts:1199-1213`.
* **CLI verb `claude-flow memory export`** — already exists at `commands/memory.ts:1151-1233`. No code change required in Phase 1; the existing handler is already correct against the proposed MCP tool's response shape.

**Why both:** the CLI surface is the user-facing entry point; the MCP tool is the substrate-seam-routed implementation. Removing either re-creates the missing-tool gap or hides the export from MCP clients.

### Decision 2 — Substrate routing: `routeMemoryOp({type:'list', limit, namespace})`

The MCP tool reads through `routeMemoryOp({type:'list'})` — the same seam the existing `memory_list` MCP tool uses (`memory-tools.ts:790-805`).

Rationale:

* `memory_list` and `memory_export` are the same enumeration shape; the only difference is the call sets `limit: 100000` (export) vs `limit: 50` (list default). Both write through the dispatched archivist `memory_list` handler ([[ADR-0181]] task #100, agentdb a72f664).
* The dispatched `list` returns `content` by default (memory-router.ts:1554-1571). No `includeContent` opt-in needed — the upstream debt does not exist in the fork.
* The PHASE 6+ marker on `memory_list` (`memory-tools.ts:790-799`) — *"route through archivist when memory_search_index→memory_store collapse lands"* — applies equally to `memory_export`. Both surfaces stay on `routeMemoryOp` until the seam expansion lands; both flip together. The export does NOT introduce a new "I'll handle the dispatch differently" axis.

**Anti-pattern explicitly rejected:** direct SQL reads against `.swarm/memory.db`. The fork's substrate surface is RVF-primary ([[ADR-0177]]); writing a SQL-direct exporter would bypass the seam ([[ADR-0181]]) and the audit chain ([[ADR-0246]]).

### Decision 3 — Output format: JSON (Phase 1); CSV + binary fail-loud until designed (Phase 1)

* **JSON** — schema mirrors upstream's `ruflo-memory-export/v1` shape:

  ```json
  {
    "schema": "ruflo-memory-export/v1",
    "exportedAt": "<ISO-8601>",
    "namespace": "<string|null>",
    "count": <number>,
    "entries": [
      {
        "key": "<string>",
        "namespace": "<string>",
        "value": "<string|null>",
        "createdAt": <unix-millis>,
        "updatedAt": <unix-millis>,
        "accessCount": <number>,
        "hasEmbedding": <boolean>,
        "size": <number>
      }
    ]
  }
  ```

  Schema string mirrors upstream so any cross-fork tooling that recognizes the schema continues to work. `value` carries the entry's `content` string (the fork's dispatched `list` returns it as `content`; the export key renames to `value` to match the upstream schema name).

* **CSV** — Phase 1: tool MUST throw a typed `Error` *"format 'csv' not implemented — Phase 1 ships JSON only; see ADR-0255 Plan"* if `format: 'csv'` is requested. Per `[[feedback-no-fallbacks]]`, silently writing JSON when CSV was asked (upstream's pattern) is forbidden. CSV is a future phase only if a real fork consumer (cost-tracker, audit pipeline) needs it; until then the option-but-no-impl surface is honest about the gap.

* **Binary** — same: throw a typed `Error` *"format 'binary' not implemented — Phase 1 ships JSON only"*. The CLI's `commands/memory.ts:1167` advertises `binary` as a choice; if Phase 1 lands without binary, the CLI command MAY be amended in a follow-up to remove that choice (or the typed error guides users to the gap). No silent fallback.

**Streaming**: NDJSON (newline-delimited JSON) is rejected for Phase 1. The upstream schema is a JSON object with `entries` as an array; matching that shape preserves cross-fork compatibility. Streaming is a future phase if memory stores grow beyond what fits comfortably in memory.

### Decision 4 — `--value-only` equivalent on `memory retrieve`: same flag name, same semantics, fork-native handler

Add `--value-only` to `commands/memory.ts` `retrieve` command (the fork already has the command, this is a flag addition). Behavior:

* Reads the entry via `callMCPTool<...>('memory_retrieve', { ... })`.
* If `ctx.flags['value-only']` is truthy, write the entry's content **directly to `process.stdout`** (no box, no banner, no decoration). Append a trailing newline ONLY if `process.stdout.isTTY` (so piped output stays exact).
* Returns `{ success: true, data: entry }` (the data flows through programmatic callers; only the stdout shape changes).

The flag name `--value-only` matches upstream so any cross-fork documentation, scripts, or memory-bank-stored examples that reference the flag continue to work. The implementation is fork-native (reads through `memory_retrieve` MCP tool, not upstream's `entry.content` direct access).

### Decision 5 — Filtering: `namespace` (Phase 1); `tags`, `keyPrefix`, `since` deferred

The MCP tool accepts:

* `outputPath: string` (required)
* `format: 'json' | 'csv' | 'binary'` (optional, default `'json'`)
* `namespace: string` (optional, omit = all namespaces)
* `includeVectors: boolean` (optional, default `false` for Phase 1 — see Decision 6)

Deferred to a future phase under a follow-up ADR:

* `tags` filter — `routeMemoryOp({type:'list'})` does not currently accept a tag filter at the seam (would require substrate handler expansion; tracked).
* `keyPrefix` filter — `routeMemoryOp({type:'list'})` DOES accept `keyPrefix` (memory-router.ts:1506-1521 falls back to `storage.query({type:'prefix', keyPrefix})`), but exposing it through the MCP tool's input schema needs deliberate naming + validation (deferred).
* `since` / time-range filter — same shape; deferred.

**Why the conservative Phase 1 surface:** the upstream tool's input schema is the same conservative shape (`outputPath`, `format`, `namespace`, `includeVectors`). Matching upstream's surface keeps the trigger condition explicit: ship Phase 1, close the CLI gap, evaluate the deferred filters against real consumer needs (cost-tracker, audit) before expanding.

### Decision 6 — Embedding handling: `includeVectors: false` default (Phase 1); `hasEmbedding` flag always included

* `includeVectors: false` (default): export carries `hasEmbedding: boolean` and `size: number` per entry (metadata only). Vectors are NOT serialized.
* `includeVectors: true`: Phase 1 — tool MUST throw a typed `Error` *"includeVectors=true not implemented — Phase 1 omits vector serialization; tracked in ADR-0255 Open Questions"*. Per `[[feedback-no-fallbacks]]`, silently dropping vectors when they were requested is forbidden.

Rationale for not shipping `includeVectors: true` in Phase 1:

* **Model lock.** Fork uses mpnet-768 (`[[reference-embedding-model]]`); upstream uses MiniLM-384. Exporting raw vectors with the model identity embedded is essential — without `model: 'Xenova/all-mpnet-base-v2'` + `dim: 768` in the payload, the export is non-portable. Upstream's export schema has no model identity field; a fork-only schema field (`embeddingModel`, `embeddingDim`) requires deliberate design.
* **Size budget.** mpnet-768 at float32 is ~3KB/entry. A 100k-entry export with vectors is ~300MB; the upstream schema is a single buffered JSON object. Phase 1 declines the bytes-budget question rather than answering it with a fallback.
* **Re-embed-on-import vs round-trip.** If the export is round-tripped via `memory_import` (a separate, also-missing MCP tool), the fork can re-embed on import (current mpnet-768 weights). Including vectors complicates the round-trip contract.

The CLI's `--include-vectors` flag (default `true` per `commands/memory.ts:1180`) MUST be changed to default `false` in Phase 1 — keeping the default at `true` would make every `claude-flow memory export` call fail with the typed error. The CLI change is part of Phase 1.

### Decision 7 — Streaming: all-at-once buffered (Phase 1); streaming deferred

Phase 1 reads up to `limit: 100000` entries via a single `routeMemoryOp({type:'list'})` call and buffers the full payload before `writeFileSync`. Matches upstream's shape exactly.

The 100k limit is the same upstream uses. If a real fork consumer overflows this (cost-tracker, federation, audit), the streaming version becomes its own ADR — the substrate seam (`storage.query` with `offset/limit`) supports paginated reads; the JSON shape would need an NDJSON variant; both are design-bearing changes.

Per `[[feedback-no-fallbacks]]`, the 100k limit is **explicit**, not a silent cap. Tool returns `count: all.entries.length` so callers can detect saturation; a follow-up ADR can add `truncated: true` to the schema if the cap is hit.

## Plan

Per `[[feedback-no-time-estimates]]`: phases are shape, not duration.

### Phase 1 — `memory_export` MCP tool + CLI default-flip + JSON-only fail-loud for csv/binary/includeVectors

**Files to change in `forks/ruflo`:**

* `v3/@claude-flow/cli/src/mcp-tools/memory-tools.ts` — register the new `memory_export` tool. Body shape:

  ```ts
  {
    name: 'memory_export',
    description: 'Export memory entries to a JSON file (keys, namespaces, timestamps, values, embedding-presence flag). Reads through routeMemoryOp({type:"list"}) — same substrate seam as memory_list. Schema: ruflo-memory-export/v1. CSV/binary/includeVectors=true throw typed errors until implemented (ADR-0255 Phase 1).',
    category: 'memory',
    inputSchema: {
      type: 'object',
      properties: {
        outputPath: { type: 'string', description: '...' },
        format: { type: 'string', enum: ['json', 'csv', 'binary'], description: '...' },
        namespace: { type: 'string', description: '...' },
        includeVectors: { type: 'boolean', description: '...' },
      },
      required: ['outputPath'],
    },
    handler: async (input) => {
      await ensureInitialized();
      const outputPath = String(input.outputPath ?? '');
      if (!outputPath) return { error: 'outputPath is required' };
      const format = (input.format as string) || 'json';
      if (format === 'csv' || format === 'binary') {
        throw new Error(`format '${format}' not implemented — Phase 1 ships JSON only; see ADR-0255 Plan`);
      }
      if (input.includeVectors === true) {
        throw new Error('includeVectors=true not implemented — Phase 1 omits vector serialization; see ADR-0255 Open Questions');
      }
      const namespace = input.namespace ? String(input.namespace) : undefined;
      if (namespace) { const v = validateIdentifier(namespace, 'namespace'); if (!v.valid) throw new Error(v.error); }
      // PHASE 6+: route through archivist when memory_search_index→memory_store
      // collapse lands; same condition as memory_list.
      const all = await routeMemoryOp({ type: 'list', namespace, limit: 100000, offset: 0 });
      const entries = ((all.entries as Array<Record<string, unknown>>) || []).map(e => ({
        key: e.key,
        namespace: e.namespace,
        value: typeof e.content === 'string' ? e.content : null,
        createdAt: e.createdAt,
        updatedAt: e.updatedAt,
        accessCount: e.accessCount,
        hasEmbedding: e.hasEmbedding,
        size: e.size,
      }));
      const payload = {
        schema: 'ruflo-memory-export/v1',
        exportedAt: new Date().toISOString(),
        namespace: namespace ?? null,
        count: entries.length,
        entries,
      };
      try { writeFileSync(outputPath, JSON.stringify(payload, null, 2), 'utf-8'); }
      catch (e) { return { error: `Could not write ${outputPath}: ${(e as Error).message}` }; }
      const vectorsWithEmb = entries.filter(e => e.hasEmbedding).length;
      return {
        outputPath,
        format: 'json',
        exported: { entries: entries.length, vectors: vectorsWithEmb, patterns: 0 },
        fileSize: `${Buffer.byteLength(JSON.stringify(payload))}B`,
      };
    },
  }
  ```

* `v3/@claude-flow/cli/src/commands/memory.ts` — flip the `--include-vectors` default from `true` to `false` (`commands/memory.ts:1180`). Until Phase 2 lands, leaving the default at `true` would make every `claude-flow memory export` invocation fail.

* `v3/@claude-flow/cli/src/mcp-tools/guidance-tools.ts:52` — already lists `memory_export` in the guidance discovery surface; no change. The line was aspirational pre-Phase-1; this phase makes it real.

**Trigger to flip ledger row `0c31cbad4` → `superseded-by-local`:** this phase landing in `forks/ruflo` main.

### Phase 2 — `memory retrieve --value-only` flag

**Files to change in `forks/ruflo`:**

* `v3/@claude-flow/cli/src/commands/memory.ts` — add `--value-only` boolean option to the `retrieve` command. Handler change: if `ctx.flags['value-only']`, write `entry.content` directly to `process.stdout`; append `\n` only when `isTTY`. Return `{ success: true, data: entry }` for programmatic callers.

Independent of Phase 1 (no shared files), but bundled in the same ADR because it is the same upstream commit's motivation (the cost-tracker pipeline's pipe-friendly read).

### Phase 3 — Golden tests in `ruflo-patch/tests/`

**Files to add in `ruflo-patch`:**

* `tests/mcp/memory-export-golden.test.mjs` — five fixture scenarios:
  1. Empty memory store → exports `{ schema, exportedAt, namespace: null, count: 0, entries: [] }`.
  2. Single-entry store (one `memory_store` then `memory_export`) → `entries.length === 1`, `entries[0].value === <stored content>`, `entries[0].hasEmbedding === true`.
  3. Multi-entry, multi-namespace → all entries present; namespace field per entry is correct; setting `namespace: 'foo'` in the export call filters correctly.
  4. CSV format requested → MCP tool throws typed error; tool envelope carries the error.
  5. `includeVectors: true` requested → MCP tool throws typed error.
* `tests/mcp/memory-retrieve-value-only.test.mjs` — three scenarios:
  1. Stored JSON value piped through `--value-only` parses with `JSON.parse` cleanly (no surrounding box characters).
  2. With `process.stdout.isTTY === true` simulated: trailing newline IS present.
  3. With `process.stdout.isTTY === false` simulated (piped): NO trailing newline.

Tests run against the codemod-built per-package dist via `loadRvfBackend` per memory `[[project-rvf-test-artifact-resolution]]`.

### Phase 4 — Ledger close

**File to change in `ruflo-patch`:**

* `docs/upstream/INTEGRATION-LEDGER.md` — row `0c31cbad4`: status `pending` → `superseded-by-local`; notes reference ADR-0255 and the Phase 1 trigger condition. (This ADR commits the ledger update in the same commit as itself; see "Commit shape" below.)

### Phase 5 (deferred) — follow-up follow-ons

Not in scope of this ADR; each becomes its own ADR if a real fork consumer needs it:

* `memory_import` MCP tool — pairs with `memory_export` for round-trip restore. CLI already advertises it (`commands/memory.ts:1236-1330`); same MCP-tool-missing gap as `memory_export` had pre-Phase-1.
* CSV serialization (if cost-tracker or audit consumer needs it).
* Binary serialization (probably never; "binary" in the CLI choices is a CLI surface artifact).
* `includeVectors: true` with `embeddingModel` + `embeddingDim` schema-v2 fields.
* Streaming / NDJSON variant for >100k entries.
* `tags`, `keyPrefix`, `since` filter expansion at the substrate seam.

## Archivist impact

The `memory_export` MCP tool is a **read-only enumeration** routed through `routeMemoryOp({type:'list'})`. This is the same seam `memory_list` already uses ([[ADR-0181]] task #100 dispatched path, with the PHASE 6+ marker preserved). Specifically:

* **No new write path.** The export does not introduce a new mutation, audit-chain entry, or staging-substrate interaction. No new carve-out is added to [[ADR-0253]]'s C1/C2/C3 list.
* **Same substrate access pattern as `memory_list`.** When the PHASE 6+ marker eventually flips (`memory_search_index → memory_store` collapse per [[ADR-0181]] header lines 22-37), `memory_export` flips with `memory_list` — they share the same `routeMemoryOp({type:'list'})` call. Tracked together.
* **Honors cli-process Archivist.** Per [[ADR-0253]] C1, the daemon's Archivist is FS-JSON only and does NOT host memory reads. `memory_export` runs in the cli process (it's invoked through the cli's MCP server). The cli's Archivist is RVF-routed and supplies the dispatched `list` results. No daemon-Archivist code path is added.
* **No bypass of the audit chain.** The export reads enumeration-state, which the audit chain ([[ADR-0246]]) does not gate (no `state: 'rejected'` semantics for reads). The export's correctness is bounded by the dispatched `list` handler's correctness; same envelope as `memory_list`.

**Explicitly: this ADR does NOT amend [[ADR-0253]].** No new substrate carve-out is introduced.

## Risk register

Per `[[feedback-no-fallbacks]]`: only risks grounded in actual surface analysis are listed; no speculation.

| Risk | Source | Mitigation |
|---|---|---|
| `routeMemoryOp({type:'list', limit:100000})` triggers PHASE 6+ regression (returns empty array if the archivist `memory_search_index` placeholder substrate is hit instead of the dispatched seam) | [[ADR-0181]] header lines 22-37 / memory-tools.ts:790-799 | The PHASE 6+ marker today says `memory_list` stays on `routeMemoryOp`, which is the live path — that path returns the dispatched `list` results when wired and falls through to substrate.query when not. memory_export follows the same gate; no new failure mode. |
| Schema name mismatch between fork export (`ruflo-memory-export/v1`) and upstream (`ruflo-memory-export/v1`) | Direct compare with upstream `mcp-tools/memory-tools.ts:1117` | Identical schema string — verified. No mitigation needed. |
| `content` field absent from `routeMemoryOp({type:'list'})` result envelope | memory-router.ts:1563 documents `content` is conditionally present (only when the dispatched handler returns it; the agentdb a72f664 widening makes it default) | If `e.content` is missing on any row (e.g., a partially-populated substrate), the export writes `value: null` for that row. Test #2 in Phase 3 asserts `value === <stored content>` on a happy path; regression would be caught immediately. Per `[[feedback-no-fallbacks]]`: this is a fail-loud-in-test posture, not a silent skip. |
| Fork CLI's `--include-vectors` default flip from `true` to `false` is a user-visible behavior change | `commands/memory.ts:1180` | Pre-Phase 1, every export call already failed (missing MCP tool); the default flip moves from "always-failed" to "always-succeeds-with-vectors-omitted". No regression for any user who was successfully exporting (there were none). |
| Phase 2 `--value-only` flag landing in `retrieve` command conflicts with any existing flag | Verified via `grep -n "value-only\|valueOnly" forks/ruflo/v3/@claude-flow/cli/src/commands/memory.ts` — no current usage | None. Trivial flag addition. |
| `process.stdout.write` direct call bypasses the `output.*` helpers used elsewhere in the command | `commands/memory.ts` standard pattern | This is intentional — the upstream commit message explicitly says *"Use process.stdout.write directly to bypass any printer-side transformation of quotes/structural characters."* Pipe-friendly shape requires no decoration. Test #1 in Phase 3 asserts JSON.parse-clean output. |

## Open questions

For follow-up phases / future ADRs:

1. **Should the export schema carry a `forkSchema` field?** The fork's export uses `ruflo-memory-export/v1` but the entries originate from an mpnet-768 / archivist-routed substrate. If `memory_import` re-embeds on import (a future fork-specific decision), the schema field is informational; if `memory_import` accepts vectors and a mismatched model would be fatal, the schema field becomes a contract. Surface for the Phase 5 `memory_import` ADR.
2. **Should `format: 'csv'` ship with `Phase 1.5`?** A real fork consumer (audit pipeline, cost-tracker) may need a flat-text export. If yes, the CSV schema needs deliberate design (multi-line `value` field escaping, namespace as column vs separate file). Tracked.
3. **Should `--value-only` skip metadata entirely or include it as JSON-lines comments?** The upstream commit emits raw value only (no metadata). For audit-replay use cases, metadata-as-JSON-comment-lines could be valuable but breaks `JSON.parse` cleanliness. Phase 2 chooses upstream's behavior; a future `--value-only --with-metadata` flag could add the comment-line variant.
4. **Should `includeVectors: true` ship with the `embeddingModel` + `embeddingDim` schema fields, or wait for `memory_import` to define the round-trip contract?** Embedding export is more useful if the import side knows what to do with it. Deferred to a future ADR that designs both sides together.
5. **Does the 100k limit need a `truncated: true` field?** If a real consumer hits the cap, the silent truncation is a `[[feedback-no-fallbacks]]` smell. A follow-up ADR can add the field + a CLI warning when `entries.length >= 100000`.
6. **Should the fork's CLI `--include-vectors` flag default flip be reverted when `includeVectors: true` actually ships?** Phase 1 flips it to `false` because `true` would always throw. Future Phase 5 (full vector serialization) MAY flip it back to `true` if that's the conventional expectation; or keep `false` because exports without vectors are dramatically smaller. Decision belongs to the `includeVectors` Phase ADR.

## Consequences

### Positive

* **CLI runtime gap closed.** `claude-flow memory export -o backup.json` works after Phase 1; no MCPClientError, no missing-tool fallback.
* **Substrate seam preserved.** The new MCP tool reads through `routeMemoryOp` like every other read-side memory tool. No SQL-direct path; no audit-chain bypass; no daemon-Archivist coupling.
* **Cross-fork schema compatibility.** `ruflo-memory-export/v1` schema string mirrors upstream; downstream tools that recognize the schema work against fork exports without rewrites.
* **Honest gaps.** CSV/binary/`includeVectors=true` fail loudly with typed errors instead of silently writing JSON or dropping vectors. The CLI's flag surface that previously advertised these as no-op-fallbacks now matches actual behavior.
* **Phase 2 (`--value-only`) unblocks cost-tracker piping.** Mirrors upstream's pipe-friendly intent against the fork's `memory_retrieve` MCP tool.
* **Ledger row resolved with a clear trigger.** Row `0c31cbad4` flips to `superseded-by-local` with the explicit condition (Phase 1 lands in fork).

### Negative

* **Two surfaces to maintain.** The CLI verb and the MCP tool both need to stay in sync. The cost is small (the response shape is narrow) but the doubled surface is real.
* **Format/vector throws are user-visible regressions for any caller previously discovering the CLI flags.** No such caller exists today (the MCP tool was missing; the CLI was unconditionally failing), so the regression is theoretical.
* **`memory_import` is not part of this ADR.** The export is round-trippable in shape, but the import-side tool is still missing. A consumer wanting backup-restore needs Phase 5 (separate ADR).
* **The 100k limit is silent.** Until the follow-up question 5 is resolved, exports of `>100000` entries silently truncate. Surface in test reports as a known cap.

### Neutral

* **PHASE 6+ marker is shared with `memory_list`.** When the marker flips, both tools flip; no independent retirement plan needed.
* **No new substrate carve-out.** [[ADR-0253]] unchanged.
* **No new audit-chain interaction.** [[ADR-0246]] unchanged.

## References

* Upstream commit: `ruvnet/ruflo` 0c31cbad48ab624a84433451e3dee2af76996550, *"fix(memory): #2073 — export returns real value + --value-only pipe-friendly retrieve"*, 2026-05-20.
* Fork CLI export command: `forks/ruflo/v3/@claude-flow/cli/src/commands/memory.ts:1151-1233`.
* Fork memory MCP tools (pre-Phase-1): `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/memory-tools.ts:172-1209` (10 tools registered, no `memory_export`).
* Fork memory router: `forks/ruflo/v3/@claude-flow/cli/src/memory/memory-router.ts:1461-1576` (`case 'list'` dispatched path returns `content` by default since 2026-05-17).
* Ledger row: `docs/upstream/INTEGRATION-LEDGER.md:183`.
* [[ADR-0177]] — RVF-primary substrate restoration (memory subtree shape).
* [[ADR-0181]] — Archivist runtime activation (substrate seam discipline; PHASE 6+ markers).
* [[ADR-0246]] — agentdb internals correctness (mutation-invariants; audit chain).
* [[ADR-0253]] — FS-JSON staging carve-out (substrate carve-outs are explicit; this ADR adds none).
* `[[reference-embedding-model]]` — fork uses mpnet-768.
* `[[feedback-no-fallbacks]]` — typed throws for unimplemented format/vector options.
* `[[feedback-no-time-estimates]]` — phases are shape, not duration.
