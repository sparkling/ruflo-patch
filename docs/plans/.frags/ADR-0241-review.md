## ADR-0241 — CT-H: schema-vs-handler truth + dedupe

**Status**: proposed (post-swarm-review)
**Swarm**: 6 experts + devil's advocate, Byzantine consensus (f=⌊5/3⌋=1; ≥3/6 supermajority)
**Triage rank**: 11 (per [[ADR-0233]] §Decision — relax-not-tighten inversion confirmed)

### Decision (post-swarm-review)

Ratify **Option D1 + Option B + F-14-003 typed allowlist** as drafted, with one
substantive correction surfaced by E5 (upstream-coherence tracker) and one
scope tightening surfaced by E4 (Zod-arch-test specialist):

1. **Correction (E5)**: ADR-0241's pre-flight #2 currently labels the
   `invalid_enum_value continue` swallow as "fork-only by comment archeology".
   Direct read of `/Users/henrik/source/ruvnet/ruflo/v3/@claude-flow/cli-core/src/mcp-tools/validate-input.ts:248`
   shows the swallow is **byte-identical between fork and upstream** (the fork's
   `cli/src/mcp-tools/validate-input.ts` is a 10-line re-export shim of the
   upstream cli-core path per its own header `"Authoritative source:
   @claude-flow/cli-core/mcp-tools/validate-input"`). The F-14-003 fix therefore
   carries upstream merge-tax that the ADR currently underweights. Amendment
   adds an INTEGRATION-LEDGER row per `[[feedback-update-integration-ledger]]`
   with a `superseded-by-local` disposition and a divergence-marker comment per
   the [[ADR-0234]] precedent.
2. **Scope tightening (E4)**: Option B arch-test runs full enumeration
   (~200 tools × ~3 required fields ≈ 600 generated tests) under `npm run release`
   acceptance, NOT per-PR CI. The ADR's "sampling is optional" line stays as
   written, but the gate registration goes into `_run_and_kill` + `collect_parallel`
   per `[[reference-acceptance-runcheck-vs-collect]]` to avoid the silent-no-verdict
   trap from `feedback-no-squelch-tests` heritage.

DA (devil's advocate) holds **principled dissent on Option B's value vs cost**
post-vote: argues arch-test catches a defect class whose only known instance
(F-14-001) is being fixed structurally by [[ADR-0204]] (b), so the gate is
belt-and-braces theatre for a class that won't recur once the wire-validator
ships. DA accepts the majority verdict (the gate is cheap, ~30s wall-clock per
release; mitigates the regression-window between ADR-0204 (b) landing and
broader handler-rule adoption) but records the dissent for the
ADR-0233 follow-up tracker.

### Implementation steps

1. **F-14-001 schema relax (Option D1)** in `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/memory-tools.ts`:
   - `:193` — change `required: ['key', 'value', 'namespace']` to `required: ['key', 'value']`
   - `:182` — update property description to `'Namespace for organization (default: "default")'`
   No handler change. Commit per `[[feedback-commit-forks-before-release]]`.
2. **INTEGRATION-LEDGER row** for F-14-001 fix: `convergence-with-upstream`
   disposition — the change re-aligns fork with upstream `memory-tools.ts:274`,
   closing fork-introduced divergence per
   `[[feedback-update-integration-ledger]]`.
3. **F-14-003 typed allowlist** in `forks/ruflo/v3/@claude-flow/cli-core/src/mcp-tools/validate-input.ts:248`:
   - Replace the bare `if (issue.code === 'invalid_enum_value') continue;` with
     the explicit allowlist check from the ADR's "Concrete change shape" §2.
   - Add divergence-marker comment per [[ADR-0234]] precedent: `// FORK: typed
     allowlist replaces upstream's silent swallow (CT-H/F-14-003 — see ADR-0241).`
   - **INTEGRATION-LEDGER row**: `superseded-by-local` (upstream-mergetax row;
     swallow is byte-identical upstream, so every sync needs this re-applied).
4. **Option B arch-test** at `forks/ruflo/v3/@claude-flow/cli/__tests__/arch/schema-handler-parity.arch.test.ts`
   per the ADR's "Concrete change shape" §3:
   - Iterate every cli `mcp-tools/*` registry (memory, hive-mind, agent,
     swarm, neural, etc.). Full enumeration, not sampled.
   - For each `(tool, requiredField)` pair, assert handler rejects (throws OR
     returns `{success: false, error: <contains-field-name>}`).
5. **Acceptance check registration** per `[[reference-acceptance-runcheck-vs-collect]]`:
   register the arch-test in both `run_check_bg` AND `collect_parallel` lists in
   the release pipeline; gate is `no-skip-accepted` per
   `[[feedback-skip-accepted-as-squelch]]`.
6. **Confirmation tests (4)** per ADR §Confirmation:
   - Write-side parity test (F-14-001).
   - Round-trip permissive-then-strict client test (F-14-001).
   - Zod allowlist unit test (F-14-003).
   - Arch-test full run (Option B).

### Dependencies

- [[ADR-0204]] (b) — validate-in-place at MCP wire boundary. **Provides the
  structural Option A2**; this ADR's Option D1 reconciles the *content* of
  the schema with the *intent* of the handler so that ADR-0204 (b) enforces
  the right relaxed contract. **Ordering**: ADR-0241 lands first (schema
  relax + handler unchanged), then ADR-0204 (b) wires the wire-validator. If
  ADR-0204 (b) lands first against the current fork schema, strict clients
  start rejecting `memory_store` calls without `namespace` — a behaviour
  regression mid-cycle.
- [[ADR-0224]] — substrate Zod-bypass single-accessor precedent. Same arch-test
  shape (`config-no-raw-parse.arch.test.ts` model), different surface.
- [[ADR-0233]] §CT-H — defect-class origin citing F-14-001 (CRITICAL),
  F-14-002/003/005 (WARN), F-14-009 (NOTE) + pre-flight inversion
  ("relax not tighten").
- [[ADR-0234]] — divergence-marker comment precedent for byte-identical
  upstream sites (F-14-003 case).
- [[ADR-0201]] — pre-flight checklist that cleared this draft (modulo E5's
  correction to check #2 for F-14-003 — applied via this fragment).
- [[ADR-0247]] (CT-N) — adjacent client-side MCP envelope work. **Disjoint**:
  ADR-0247 owns `callMCPTool` client-side `isError` propagation; this ADR owns
  server-side handler-vs-schema reconciliation. No code overlap.

### Validation

- **Source-shape grep**: `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/memory-tools.ts`
  `:193` reads `required: ['key', 'value'],` exactly (matches upstream `:274`).
- **Source-shape grep**: `forks/ruflo/v3/@claude-flow/cli-core/src/mcp-tools/validate-input.ts:248`
  reads the typed allowlist block, NOT `if (issue.code === 'invalid_enum_value') continue;`
  on its own line.
- **Behavioural acceptance (F-14-001)**: in-process MCP `memory_store {key,value}`
  with no `namespace` succeeds and stores at `'default'`; `memory_retrieve
  {key, namespace:'default'}` returns the value. Pre-fix: a strict MCP client
  would have refused the call; post-fix + ADR-0204 (b): call passes wire
  validation and lands at `'default'` deterministically.
- **Behavioural acceptance (F-14-003)**: `validateAgentSpawn({agentType:'<unknown-custom>'})`
  surfaces an `invalid_enum_value` error; `{agentType:'<allowed-custom>'}` does not.
- **Arch-test acceptance (Option B)**: `schema-handler-parity.arch.test.ts`
  passes on all ~600 generated tests. Pre-fix it would FAIL on
  `memory_store × namespace` (handler defaults instead of rejecting).
- **No `skip_accepted`** per `[[feedback-skip-accepted-as-squelch]]`. Schema-vs-
  handler asymmetry is exactly the class the gate exists to catch.
- **Confirmation that the published wrapper picks up the fix**: re-verify via
  fresh install in `/tmp` per `[[feedback-inspect-installed-not-dev-nodemodules]]`,
  NOT against dev `node_modules/`.

### Top risk + mitigation

- **Risk (E2)**: Option D1 means existing strict MCP clients that have been
  *correctly* refusing the unaligned `memory_store` call (because the fork's
  schema lied) will start accepting it silently. The behaviour change is
  invisible — the write succeeds either way; only the namespace landed-at
  changes. A client that previously got a schema-rejection error and then
  worked around it by passing `namespace:'<explicit>'` will continue to work;
  a client that gave up and used a different tool will now silently start
  succeeding. Risk: a consumer's "we don't support `memory_store` because the
  schema rejects our payloads" code path becomes dead code without an explicit
  migration notice.
- **Mitigation**: the property description carries the contract
  (`'Namespace for organization (default: "default")'`). The fix is also
  upstream-aligned, so any consumer that read upstream's spec already expected
  this behaviour. Document in the release-notes commit message that
  `memory_store` no longer requires `namespace`; tag the commit subject with
  `BREAKING: relaxes memory_store inputSchema.required (was fork-only divergence)`
  even though it's a relaxation (some clients may have hard-coded the strict
  shape). Surface via [[reference-fork-workflow]] commit-message conventions.
- **Secondary risk (E4)**: Arch-test wall-clock cost grows linearly with cli
  tool count (~200 today). Mitigation: per-PR CI runs sampled subset; full
  enumeration only in release-pipeline acceptance. ADR's "Sampling is optional"
  line preserved; the registration spec just makes the gate-level
  responsibility explicit.

### Byzantine consensus tally (6 voters, f=1, requiredVotes=3)

| Voter | Vote | One-line position |
|-------|------|-------------------|
| E1 (inputSchema specialist) | adopt | Schema relax matches upstream; closes asymmetry by construction once [[ADR-0204]] (b) lands. |
| E2 (handler-validation specialist) | adopt | Handler stays unchanged (no risk of breaking existing call sites); the write/read partitioning bug closes from the schema side. |
| E3 (type-deduplication specialist) | adopt | Deferring `MCPTool`/`MemoryType`/`AgentType` consolidation is correct — upstream merge-tax asymmetric to bounded internal benefit. |
| E4 (Zod-arch-test specialist) | adopt-with-amendment | Arch-test enumeration vs sampling needs explicit gate registration; otherwise adopt as drafted. |
| E5 (upstream-coherence tracker) | adopt-with-amendment | Pre-flight #2 mis-states F-14-003's upstream status; needs INTEGRATION-LEDGER + divergence marker per [[ADR-0234]] precedent. |
| DA (devil's advocate) | hold-principled-dissent | "Relaxing the schema validates ad-hoc client behaviour — write-strict / read-lax would be cleaner" AND "23 MCPTool definitions is the wrong target — let upstream factoring win, defer dedupe entirely." Both challenges addressed by the verdict (write-strict rejected because upstream-aligned is cheaper merge-cost; dedupe IS deferred per Option C rejection). DA accepts majority verdict; principled dissent recorded. |

**Result**: 5/6 adopt (3/6 supermajority cleared, Byzantine `2f+1=3` satisfied).
**DA position**: principled dissent held + recorded; no withdrawal.

### Key upstream finding (verification per assignment)

- **CONFIRMED** (E5): "the fork created the asymmetry" claim from
  [[ADR-0233]] §"Pre-flight inversions" is correct for F-14-001. Direct read
  of `/Users/henrik/source/ruvnet/ruflo/v3/@claude-flow/cli/src/mcp-tools/memory-tools.ts:274`
  on 2026-05-24 confirms upstream's `memory_store` schema declares
  `required: ['key', 'value']` (no namespace) and handler `:281` does
  `(input.namespace as string) || 'default'` — coherent permissive shape.
  The fork's divergence at fork-`:193` (`required: ['key','value','namespace']`)
  + read-side throw at fork-`:378`/`:724` created the asymmetry.
  Decision to flip "tighten handler" → "relax schema" is the correct
  upstream-convergent move.
- **REFUTED** (E5, scope-correction): ADR-0241 pre-flight #2 sub-bullet 3
  labels the F-14-003 swallow as "fork-only by comment archeology". Direct
  read of `/Users/henrik/source/ruvnet/ruflo/v3/@claude-flow/cli-core/src/mcp-tools/validate-input.ts:248`
  shows the swallow is **byte-identical with the fork**. The
  fork's `cli/src/mcp-tools/validate-input.ts` is a 10-line re-export shim
  per its own header. The F-14-003 typed-allowlist replacement therefore
  carries upstream merge-tax that the ADR's pre-flight underweights.
  Amendment 1 above corrects this.

### Cross-references

- [[ADR-0233]] §CT-H + §"Pre-flight inversions" — defect-class origin and
  the "relax not tighten" inversion this swarm ratified.
- [[ADR-0201]] §"Remediation-ADR pre-flight checklist" — ran with E5's
  correction applied for F-14-003.
- [[ADR-0204]] (b) — provides Option A2 structural fix at the wire boundary;
  this ADR's Option D1 provides the content fix the wire-validator enforces.
- [[ADR-0224]] — same-shape arch-test guard precedent (`config-no-raw-parse.arch.test.ts`).
- [[ADR-0234]] — divergence-marker comment precedent for byte-identical
  upstream sites (applied to F-14-003 fix here).
- [[ADR-0247]] (CT-N, parallel review) — disjoint by artifact + mechanism;
  no overlap in code or scope per ADR-0247's own §F-04-009 analysis.
- `[[feedback-update-integration-ledger]]` — INTEGRATION-LEDGER rows mandatory
  for both fixes (F-14-001 convergence-with-upstream; F-14-003 superseded-by-local).
- `[[feedback-commit-forks-before-release]]` — both fork edits commit BEFORE
  the next `npm run release`.
- `[[feedback-skip-accepted-as-squelch]]` — Option B arch-test gate cannot
  use `skip_accepted`.
- `[[feedback-inspect-installed-not-dev-nodemodules]]` — post-release verification
  uses fresh `/tmp` install, NOT dev `node_modules/`.
