---
status: proposed
date: 2026-05-24
tags: [errors, error-handling, mcp, envelope, retry, long-term, ct-i]
supersedes: []
depends-on: [0201, 0209, 0210, 0233]
implements: []
---

# Shared error library + MCP envelope honesty (long-term, scope-limited)

> **Scope discipline up front (read this first).** This is a **long-term cultural-cleanup ADR**, not a one-cycle remediation. The defect class is "error-handling culture" — `~108` error classes, `~1,994` naked `throw new Error(string)` (1,218 in `forks/ruflo` + 776 in `forks/agentdb`), only `3` `{cause:e}` chains across both TS forks, `5` parallel `sanitizeError` definitions, `2` unused retry libraries, `8` ad-hoc retry loops, and `~56` MCP tool handlers that catch-and-return `{success:false, error: sanitizeError(e)}` instead of throwing. Proposing "fix all 2,000 throws" would be wrong (cost vs benefit; regression sprawl; merge tax against upstream which carries the same shape). The decision instead is to **establish the canon** (extract the gold-standard hierarchy that already exists, name it `@claude-flow/errors`), **gate new code on adoption** (lint warns on new `throw new Error(string)` while grandfathering existing), and **target the high-leverage protocol-boundary defect** (MCP envelope honesty — fatals must throw, not return `success:false`). Old code is grandfathered. There is no "Phase 4 of 4 — migrate all 2,000 throws" milestone.

## Context

[[ADR-0233]] §CT-I ("Error-handling cultural debt") consolidates the nine findings from
[`docs/audits/2026-05-24-second-pass-audit/13-error-taxonomy.md`](../audits/2026-05-24-second-pass-audit/13-error-taxonomy.md). The shape:

* **`~108` error classes** across the forks; `forks/ruflo` carries 81 across 46 files (with 8 in the `gastown-bridge` plugin family alone); `forks/agentdb` carries 16 across 7 files; `ruflo-patch` carries zero. The hierarchies do not share a base class; most extend `Error` directly with one level of depth.
* **`~1,994` naked `throw new Error(string)` sites** across the TS forks (`1,218` in ruflo + `776` in agentdb), plus `51` in `ruflo-patch/scripts/`. The Rust analog (`9,865` `.unwrap()` calls in `forks/ruvector`) is mostly idiomatic invariant-assert and explicitly out of scope.
* **`3` modern `Error.cause` chains across both TS forks combined** — only `controller-registry.ts:38`, `memory-router.ts:979` (ruflo), and `GraphDatabaseAdapter.ts:163` (agentdb) preserve the parent error through `{cause: e}`. The other `~41` "rethrow" sites interpolate `${e.message}` into a fresh `new Error(...)` and discard the stack + cause.
* **`5` parallel `sanitizeError` definitions** (F-13-005) in `agentdb-tools.ts:39`, `claim-service.ts:798`, `security/index.ts:366+385`, `secure-logger.ts:82+246`, `mcp-tools.ts:39`. Same conceptual operation; five different signatures and rules.
* **A `~480`-LOC `production/error-handler.ts` facility** with regex-based category classification, retryability predicate, sanitisation, aggregation, monitoring-report — **built, shipped, and never instantiated outside its own `defaultHandler` singleton** (F-13-002). Re-verified at runtime: `grep "new ErrorHandler"` across `forks/ruflo/v3` returns the file's own `defaultHandler = new ErrorHandler()` and one test. `grep "withErrorHandling"` returns the export site at `index.ts:726` and the definition — zero call sites.
* **Two project-internal retry libraries with zero production callers** (F-13-001) — `shared/resilience/retry.ts` and `cli/production/retry.ts`. Re-verified: only `index.ts:743-750` re-exports them and `teammate-plugin/tests/utils.test.ts` tests its own local copy. The eight ad-hoc retry loops in `embeddings/`, `plugins/`, `integration/`, `swarm/`, `cli/mcp-server.ts` each implement exponential backoff differently with different retryability heuristics.
* **`~56` MCP tool handlers uniformly catch-and-return `{success:false, error: sanitizeError(e)}`** (F-13-005) — defeating `feedback-best-effort-must-rethrow-fatals` at the highest-traffic user-facing surface. The MCP server at `mcp-server.ts:691-707` calls `trackRequest(toolName, true)` on a returned object (even with `success:false`) and only sets a JSON-RPC `error` envelope on a thrown exception. So a fatal data-integrity error (corrupt RVF, dimension mismatch, ADR-0112 territory) gets demoted to `{available:false, error:'string'}` flattened into `content[0].text`, and the MCP client (Claude Code, swarm agent) cannot tell it from a successful call.
* **A gold-standard hierarchy already exists in the tree** (F-13-009): `forks/ruflo/v3/plugins/gastown-bridge/src/errors.ts` (verified `701` lines, MIT-spirit gold-standard shape) ships `GasTownError` with `readonly code: GasTownErrorCodeType`, `readonly timestamp: Date`, `readonly context?: Record<string, unknown>`, `readonly cause?: Error`, `Error.captureStackTrace`, `toJSON()`, `toString()`, type guards (`isGasTownError` etc.), and a `wrapError()` adapter. Subclasses (`BeadsError`, `ValidationError`, `CLIExecutionError`, `FormulaError`, `ConvoyError`) all properly extend the base. Used by `gastown-bridge` and `agentic-qe` plugins — not adopted by `cli`, `memory`, `shared`, `mcp`, `claims`, `aidefence`, `agentdb`, or any of the `60+` other top-level packages.

Per [[feedback-best-effort-must-rethrow-fatals]] (the corpus rule), a `try/catch` that demotes a fatal data-integrity error to a returned envelope is the same shape as the ADR-0085→ADR-0090 bug class (`memory-router._doInit` silently swallowed `EmbeddingDimensionError` and returned NaN-scored results). The `~56` MCP-handler instances of this shape are the largest single cluster of that anti-pattern in the codebase.

## Pre-flight verification

Per [[ADR-0201]] §[Remediation-ADR pre-flight checklist](./ADR-0201-codebase-soundness-completeness-audit-with-runtime-validation.md#remediation-adr-pre-flight-checklist-added-2026-05-20):

1. **Signal reaches its audience.** Trace the propagation path for each sub-target:
   * **Shared error library + lint** (Option A + Option B step 1): the audience is **future code authors**. The signal reaches them via the lint diagnostic on new `throw new Error(string)` in changed files. The lint must run inside the same release-gate harness that already runs `check-silent-catches.mjs` / `check-undiscriminating-catches.mjs` (`scripts/ruflo-publish.sh:471,484`) for the signal to actually block a regression. Without the gate wiring, the lint is documentation. Decision: gate-wire the lint in scope below.
   * **MCP envelope honesty arch-test** (Option B step 2): the audience is **the MCP client (Claude Code, swarm agents)**, who pattern-match on JSON-RPC `error` frames vs returned objects. The signal reaches them via the protocol boundary at `mcp-server.ts:691-707`: throw → `{jsonrpc, id, error:{code:-32603, message}}`; returned object → `{jsonrpc, id, result:{content:[{type:'text', text: JSON.stringify(result)}]}}` (no `isError`, no structured channel). Verified at HEAD by direct read of the file. So fatals that throw at the handler reach the client as protocol errors; fatals that return-envelope are flattened into a JSON string the client must inspect. The arch-test target — "MCP handlers must let fatals propagate, not catch and return `success:false`" — is exactly the inverse of what most handlers do today, so the signal reaches its audience iff the handler stops catching.
   * **The retry-library and ErrorHandler-wiring sub-questions** are explicitly **out of scope for this ADR** — see Scope discipline at the head. They are flagged as follow-up work in More information.
2. **Upstream hasn't already decided it.** Verified by reading `/Users/henrik/source/ruvnet/ruflo/v3/@claude-flow/cli/src/mcp-tools/agentdb-tools.ts:40,73`: upstream carries the byte-identical `sanitizeError` definition and `{available:false, error: sanitizeError(error)}` return shape. Upstream's `production/error-handler.ts` exists with zero callers (same as the fork). Upstream has no shared `@claude-flow/errors` package; no `RUFLO_E*` error-code prefix; `grep "class.*Error.*extends.*Error"` returns `17` candidate base-class extensions but no shared root. **Upstream has not decided this problem class.** A fork-only intervention is greenfield here (not fighting upstream's design as in ADR-0209's fallback case), but it also doesn't re-converge — the introduction will carry a small merge tax in the touched files. Acceptable because the canon is portable: the extracted `@claude-flow/errors` package is a clean re-export of `gastown-bridge/errors.ts` which **is** upstream code originally.
3. **Premise/inventory is true at runtime.** Re-derived the load-bearing counts:
   * `throw new Error` in `forks/ruflo/v3` (excluding `dist/`, `node_modules/`, `__tests__`): **`1,331`** sites at HEAD (the audit's `1,218` is close — the delta is whether `cli-core/`, `agentic-qe/`, `agentic-jujutsu/` subtree variants are counted; both rough numbers support "thousands, not hundreds").
   * Modern `cause:` chains in error rethrows in `forks/ruflo/v3`: **`0`** by my narrow filter (`grep "cause:" ... | grep -E "(new Error|Error\().*cause"`); the audit's `3 across both forks` is the precise count under the broader rule "any `cause:` field on an Error constructor or assignment context." Either way: vanishingly rare.
   * `sanitizeError` definitions in `forks/ruflo/v3`: **`5`** sites confirmed at `cli/src/mcp-tools/agentdb-tools.ts:39`, `plugins/src/security/index.ts:366,385`, `shared/src/utils/secure-logger.ts:82,246` (plus the `claim-service.ts` and `hooks/workers/mcp-tools.ts` definitions cited in the audit which my run didn't catch — count is at least 5, possibly more). Audit number stands.
   * `ErrorHandler` wiring: confirmed **zero** external instantiations of `new ErrorHandler` and **zero** call sites for `withErrorHandling` outside the definition + the `index.ts` re-export.
   * `production/retry.ts` + `shared/resilience/retry.ts` callers: confirmed **zero** production callers; only `index.ts` re-exports + the `teammate-plugin/tests` local copy.
   * `gastown-bridge/errors.ts` is **`701`** lines (the audit cites `97-157` for the base-class subset), gold-standard shape verified line-by-line, type guards + `wrapError()` adapter included. The package is real, ships, and has tests.
4. **No sibling-ADR overlap.** This is the load-bearing check; the audit prompt flagged overlap with [[ADR-0209]] and [[ADR-0210]] specifically.
   * **vs [[ADR-0210]] (stub honesty):** ADR-0210's second-pass council explicitly carved out the protocol-level concern this ADR addresses: *"The strongest form of the rejected Option D — a protocol-level `isError`/`structuredContent` signal at the `mcp-server.ts:695` wrap that does reach the LLM at call-time — was not considered by the original draft; **if pursued it belongs in its own micro-ADR**, not a revival of the in-process `_stub` field."* This ADR is that micro-ADR on the envelope-honesty side. **Disjoint:** ADR-0210 owns the **per-handler stub disposition** (implement / restore / delete the `~11` named stubs in `hooks-tools.ts` + `performance-tools.ts`); this ADR owns the **protocol-boundary mechanism** (the lint/arch-test that says "fatals must throw") and the **shared library** under which any future stub or non-stub handler operates.
   * **vs [[ADR-0209]] (no-fallbacks arch-test):** ADR-0209 Step 2 pinned the SONA-envelope sites and explicitly noted the protocol-level defect: *"`mcp-server.ts:695` flattens a returned `success:true` onto the success path (`trackRequest(...,true)`; `isError` is set only on `throw` at `:697`), so an absent intelligence module is recorded as a successful call. Disposition by surfacing the failure at the protocol boundary, not by rewriting the payload."* — and then **deferred the protocol-boundary mechanism** to a future micro-ADR. This ADR is the mechanism. **Disjoint:** ADR-0209 owns the **per-site bulk-fix** (the `:525` envelope flip + the `~20-27` corrupt-JSON-collapse rethrows + the Result/loadStoreOrCreate helpers if a real caller emerges); this ADR owns the **structural rule** ("MCP handler fatals throw, not return-envelope") and the **shared library** that makes the rethrow ergonomic. Neither ADR proposes the same artifact.
   * **vs [[ADR-0233]] CT-A/CT-E:** CT-A (silent-fallback siblings) and CT-E (surface-without-enforcement triage) are about per-site decisions; this ADR is about the cross-cutting shape and the canonical library. Disjoint by content shape; complementary by intent.
   * **vs the unrelated ADR-0223 / ADR-0226:** those own user-facing brand + frame writes respectively; no surface overlap.
   * **vs the retry libraries.** F-13-001's retry consolidation is **not** owned by any current ADR. This ADR mentions it in More information but does NOT propose the consolidation (because the consolidation requires picking between `production/retry.ts` and `shared/resilience/retry.ts`, and that decision needs its own swarm review per `feedback-corpus-evidence-before-feature-work`).

Outcome: pre-flight clears for the shared-library extraction and the MCP envelope-honesty rule. The 2,000-throw migration, the ErrorHandler wiring, the retry consolidation, and the `MCPServerError` dedupe (F-13-003) are **named-as-out-of-scope** and tracked for future ADRs.

## Considered Options

* **Option A — Extract `gastown-bridge/src/errors.ts` to a shared `@claude-flow/errors` package; document the canon; gate new code on adoption (one-direction — old code grandfathered).** Promotes the existing gold-standard to a project-wide canon. Migration is opt-in / new-code-only; no big-bang. Light merge tax (one new package boundary). Doesn't fix existing throws — that's the point.
* **Option B — Two-step lint + arch-test.** **(1)** Lint forbidding NEW `throw new Error(string)` in changed files (allowing existing — grandfathered allowlist). **(2)** MCP-handler arch-test ensuring fatals re-throw (don't get swallowed into `{success:false}` envelopes). The lint is the cultural-shift instrument; the arch-test is the protocol-boundary mechanism. Both ride on top of Option A's library.
* **Option C — Big-bang: fix all 2,000 throws.** Pragmatic NO. Cost vs benefit is catastrophic (months of work, no functional improvement per site); regression sprawl risk is high (every touched file has to re-pass tests + acceptance); upstream merge tax is permanent (every touched file becomes a merge conflict against upstream); the gain is the same as A+B at year-end without the meantime breakage.
* **Option D — Status quo + document the debt.** Accept the cultural-debt shape; let it sit; document it here for future maintainers. Defensible — the audit calibrated CT-I as LOW (`F-13-005` is MEDIUM only because it defeats the corpus rule at the user-facing surface) — but the gold-standard library *already exists in-tree* and the lint cost is small; doing nothing leaves both unused.

## Decision

**Chosen: Option A + Option B, scope-limited and long-term-framed. Explicitly NOT Option C.**

This ADR is the **canon-establishment + new-code-gate**. It is not the migration. The migration, if it happens at all, is opt-in over multiple cycles.

### Decision scope (what this ADR actually proposes)

1. **Extract `gastown-bridge/src/errors.ts` to a new shared package** — package name to be confirmed during impl swarm review; tentative `@claude-flow/errors` (matches the `forks/ruflo/v3/@claude-flow/*` package layout). Move the `~157`-line base subset (`GasTownError` + `GasTownErrorCode` + type guards + `wrapError` + `getErrorMessage`) under a renamed root (tentative `RufloError` / `RufloErrorCode` — name TBD; the codemod must update the in-place `gastown-bridge/errors.ts` to re-export from the shared package so the plugin keeps working unchanged). The plugin-specific subclasses (`BeadsError`, `FormulaError`, `ConvoyError`, `CLIExecutionError`) stay in `gastown-bridge`. The plugin family (`gastown-bridge`, `agentic-qe`) continues to work; new packages that need an error hierarchy import from `@claude-flow/errors`.

2. **Document the canon** in a single page under `forks/ruflo/v3/@claude-flow/errors/README.md`, covering: when to extend `RufloError` vs `Error`, when to set `cause:`, when to use `wrapError()`, the `RUFLO_E*`-style code-naming convention (or whichever scheme the swarm settles on — F-13-004 lists 5 parallel naming conventions today, but **this ADR does not pick one**; it commits to the existence of a single naming convention in the new package, with the choice deferred to the impl swarm because picking the wrong scheme upfront would lock fork-wide migration into a re-do).

3. **Lint: forbid NEW `throw new Error(string)` in changed files.** A net-new advisory script (modelled on the existing zero-dep `scripts/check-silent-catches.mjs` / `check-undiscriminating-catches.mjs` family, NOT a new dependency) keyed on `throw new Error("..."` (literal-string constructor argument). **Grandfathered:** the existing `~1,994` sites are baselined into `lib/throw-new-error-allowlist.txt` (content-keyed, matching the existing `undiscriminating-catches-allowlist.txt` shape after the `fcab2bc` refactor). New sites in changed files fail the check. Diagnostic message: "throw an instance of `RufloError` (or subclass) from `@claude-flow/errors`, with a `code:` and `cause:` where applicable; see `forks/ruflo/v3/@claude-flow/errors/README.md`." Wired into `scripts/ruflo-publish.sh` alongside the existing checks.

4. **MCP-handler arch-test: fatals must throw.** A net-new arch-test asserts that **MCP tool handlers** (the `~56` handlers under `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/**.ts`) do not catch-and-return `{success:false, error:...}` for **fatal** errors. The rule is decidable in a narrow form only: "if a handler has a top-level `try/catch` that returns `{success:false, ...}` or `{available:false, ...}` for the *unfiltered* catch (i.e. with no `instanceof <FatalError>` discriminator and no re-throw of any class), it must instead let the error propagate." Honest discriminated catches (e.g. `catch (e) { if (e instanceof OptionalModuleNotFound) return {available:false}; throw e; }`) are explicitly allowed.

   **Adopting [[ADR-0209]] + [[ADR-0210]]'s own lessons on detectors:**
   * The rule ships **advisory-first** (`exit 0` with a count) and is keyed on the narrow shape "handler-top-level `catch(e) {return {success:false,...}}` with no `instanceof`/`name`-check sibling." NOT the broad "every numeric literal in a metric field" / "every catch with success:true" rule — those are ADR-0209's rejected `~84-98%` FP shapes.
   * Promotion to `exit 1` requires the lexical FP rate to be empirically `0` after baseline allowlist application; if it isn't, the rule stays advisory and the bulk-fix is per-handler.
   * **Old handlers grandfathered** into an allowlist; **new handlers** must throw on fatal-by-default. ADR-0210's per-handler dispositions (the `~11` named stubs) are NOT re-litigated here — this ADR's rule fires on *new* handlers, not on ADR-0210's already-dispositioned set.
   * The arch-test does NOT propose changing `mcp-server.ts:691-707`'s wrap. The wrap is correct — it converts thrown errors to JSON-RPC `-32603` frames already. The rule only asks handlers to **use** that thrown-error path instead of swallowing into a returned envelope.

5. **The shared library makes the rethrow ergonomic.** Once `RufloError` + `wrapError()` ship, the handler shape goes from:

   ```ts
   try { ... } catch (e) { return { success: false, error: sanitizeError(e) }; }
   ```

   to:

   ```ts
   try { ... } catch (e) { throw wrapError(e, RufloErrorCode.<area>_FAILED); }
   ```

   — preserving `cause`, surfacing `code`, and letting the MCP server produce a clean JSON-RPC error. Old code keeps working; new code gets the ergonomic upgrade.

### Decision scope (what this ADR explicitly does NOT propose)

* **Migrating any of the existing `~1,994` `throw new Error(string)` sites.** Grandfathered. The lint allows them; the canon doesn't require them. A future ADR may propose targeted migrations (e.g. "migrate the `~41` `${e.message}` interpolation throws to `wrapError` because they're a one-line edit and they drop `cause`") — that's F-13-006 and is a separate decision.
* **Wiring `production/error-handler.ts`.** Owned by F-13-002 / a future ADR. The Decision Drivers for "wire vs delete" are non-trivial (the `~480` LOC facility duplicates parts of what the new `@claude-flow/errors` package would do); deciding wire-or-delete *after* the shared library lands is cleaner than deciding both at once.
* **Consolidating the two retry libraries.** Owned by F-13-001 / a future ADR. Picking between `production/retry.ts` (richer; 4 strategies) and `shared/resilience/retry.ts` (cleaner predicates) needs a swarm-review per `feedback-corpus-evidence-before-feature-work` — and the 8 ad-hoc retry loops will need per-site disposition.
* **Deduping the 3 copies of `ErrorCodes` + `MCPServerError`** (F-13-003) including fixing the `-32001` / `-32002` internal collisions. Owned by F-13-003 / a future micro-ADR. Smaller scope than this ADR; could land first or after.
* **Annotating the `~149` un-marked `catch ... console.warn/error` swallows** (F-13-008). Owned by a future ADR (or by extending ADR-0191's allowlist process).
* **Picking the `RUFLO_E*` code-naming convention.** F-13-004. Deferred to the impl swarm so the shared library's first version doesn't lock in a scheme that a swarm later rejects.

### Migration shape (long-term, opt-in)

![diagram-1](diagrams/ADR-0242-shared-error-library-and-mcp-envelope-honesty/diagram-1.png)

<details>
<summary>Mermaid Source</summary>

```mermaid
flowchart TD
    A[Today: 108 error classes, 1,994 throws, 5 sanitizeError, 0 canon] --> B[Cycle 1: extract @claude-flow/errors from gastown-bridge<br/>(this ADR, scope 1+2)]
    B --> C[Cycle 1+ε: ship lint advisory + arch-test advisory<br/>(this ADR, scope 3+4 advisory mode)]
    C --> D[Cycle 2+: new handlers naturally adopt RufloError<br/>(no ADR required; review enforces)]
    D --> E[Cycle N: lint/arch-test FP=0?<br/>promote to exit-1]
    E -->|Yes| F[Gate-wire as blocking check]
    E -->|No| G[Stay advisory; per-site review]
    D --> H[Future ADR: targeted migration of F-13-006<br/>~41 message-interp throws -> wrapError<br/>(separate decision, evidence-deferred)]
    D --> I[Future ADR: ErrorHandler wire-or-delete<br/>(F-13-002, separate decision)]
    D --> J[Future ADR: retry-library consolidation<br/>(F-13-001, separate decision)]
    D --> K[Future ADR: ErrorCodes dedupe + collision fix<br/>(F-13-003, separate decision)]

    style A fill:#fee2e2,stroke:#991b1b,color:#000
    style B fill:#dbeafe,stroke:#1e40af,color:#000
    style C fill:#dbeafe,stroke:#1e40af,color:#000
    style D fill:#d1fae5,stroke:#065f46,color:#000
    style F fill:#d1fae5,stroke:#065f46,color:#000
    style G fill:#fef3c7,stroke:#92400e,color:#000
    style H fill:#e5e7eb,stroke:#374151,color:#000
    style I fill:#e5e7eb,stroke:#374151,color:#000
    style J fill:#e5e7eb,stroke:#374151,color:#000
    style K fill:#e5e7eb,stroke:#374151,color:#000
```

</details>

The blue path (cycle 1) is what this ADR commits to. The green steady-state is what the canon enables but does not force. The grey future-ADR boxes are explicitly out of this ADR's scope.

**There is no end-state milestone that says "all throws migrated."** That's the point. The cultural shift happens at the new-code boundary; the existing corpus rots forward at whatever rate organic refactors touch it.

## Consequences

* **Good** — The gold-standard error shape (already in-tree, already tested, already used by 2 plugins) becomes the named canon. New code has a documented "do this" path. The `cause:` chain becomes the natural shape (the `wrapError()` adapter does it for you).
* **Good** — The lint catches **new** instances of the cultural debt without forcing migration of existing code. Engineers stop adding the `1,995`th naked `throw new Error(string)` without thinking. No big-bang.
* **Good** — The MCP envelope-honesty arch-test repairs the largest single cluster of `feedback-best-effort-must-rethrow-fatals` violations at the user-facing surface — the `~56` handlers that demote fatals into `{success:false}` envelopes. Future handlers get the ergonomic rethrow path; old handlers grandfathered.
* **Good** — The mcp-server.ts wrap doesn't change. The fix is in *how handlers use the existing thrown-error path*, not in re-engineering the protocol layer. Lower blast radius than a protocol-level redesign.
* **Good** — Pre-flight check #2 + #4 cleared: upstream hasn't decided this; no sibling ADR overlaps; this ADR is the micro-ADR ADR-0210's council explicitly identified as owed.
* **Neutral / Bad** — Introduces a new package boundary (`@claude-flow/errors`). Small merge tax against upstream (which carries the same gastown-bridge file but no shared package). Mitigated by keeping the new package as a thin re-export of code that originated upstream.
* **Neutral / Bad** — The advisory-first lint may never get promoted to `exit 1` if the FP rate doesn't drop to zero. That's acceptable: the *signal* is what matters (engineer sees the warning at review time); the gate is the icing.
* **Neutral / Bad** — Old code stays ugly. The `~1,994` naked throws + `5` sanitizeErrors + `3` cause-chains are still there at the end of this ADR's adoption. By design. The audit calibrated this slice as LOW; the long-term cleanup is by erosion, not by replacement.
* **Bad** — Engineer cognitive load: there are now two "right" shapes for error rethrow in the codebase (the new `wrapError()` and the old `throw new Error(${e.message})`). Mitigated by the README + the lint pointing new code at the new shape, and by the grandfather allowlist marking old code as "known-debt, don't touch unless you're refactoring."
* **Bad** — The retry-library, ErrorHandler-wiring, and ErrorCodes-dedupe decisions remain open. This ADR explicitly defers them; if they sit open for cycles, the cultural-debt shape persists. Tracked in More information; a follow-up sweep should pick them up.
* **Bad** — The MCP envelope-honesty rule, even advisory-first, is going to surface a long list of existing handlers as candidates for "you should throw here." Grandfathered, but visible. The advisory count becomes a long-term tracking metric.

### Confirmation

* **Source-shape (deterministic):**
  * `forks/ruflo/v3/@claude-flow/errors/src/index.ts` exists, exports `RufloError`, `RufloErrorCode`, `wrapError`, `getErrorMessage`, `isRufloError` (names TBD per Decision scope 1).
  * `forks/ruflo/v3/plugins/gastown-bridge/src/errors.ts` re-exports the base subset from `@claude-flow/errors` (so the plugin's `GasTownError` is `class GasTownError extends RufloError` — preserving plugin-side API).
  * `scripts/check-throw-new-error.mjs` (net-new) exists, zero external dependencies, scans both `forks/ruflo/v3/@claude-flow/cli/src` and `forks/agentic-flow/src` (matching the existing checks' scan roots), reads `lib/throw-new-error-allowlist.txt` for grandfather entries, exits `0` advisory-first with a count.
  * `scripts/check-mcp-handler-fatal-throw.mjs` (net-new) exists, scans `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/`, asserts handlers whose top-level catch returns `{success:false}` or `{available:false}` are either in the grandfather allowlist or have an `instanceof`/`.name===` discriminator + re-throw path.
  * `scripts/ruflo-publish.sh` invokes both new checks alongside `check-silent-catches.mjs` and `check-undiscriminating-catches.mjs`.
  * `forks/ruflo/v3/@claude-flow/errors/README.md` exists, documents the canon.
* **Behavioural (acceptance):**
  * A new test file under `forks/ruflo/v3/@claude-flow/errors/__tests__/` asserts: `new RufloError('msg', RufloErrorCode.X, {ctx:1}, parent).cause === parent`; `.toJSON()` returns the expected shape; `.code === 'RUFLO_E_X'` (or whatever scheme the swarm picks); `wrapError(new Error('foo'))` preserves the message.
  * An arch-test asserts the `gastown-bridge/errors.ts` re-export round-trips: `import { GasTownError } from 'gastown-bridge/errors'; expect(new GasTownError('x') instanceof RufloError).toBe(true);`.
  * The MCP-handler arch-test produces a baseline count > 0 (the `~56` existing handlers); allowlist entries equal that baseline; FP count empirically measured; promote-to-`exit-1` gate firing iff the new-code rate is `0` after baseline.
* **No `skip_accepted`** ([[feedback-skip-accepted-as-squelch]]). The advisory-first lint is NOT a squelch — it's the explicit cultural-shift instrument modelled on ADR-0209's "fixed regression assertion + permanently-advisory counter." If it never promotes to `exit 1`, that's a signal that the FP rate stayed high — which itself is data the impl swarm needs.

## More information

### Out-of-scope follow-up work (named, not deferred-as-vague)

These are intentional follow-up ADRs, each with its own pre-flight + decision shape, not work this ADR implicitly commits to:

* **F-13-002 — Wire `production/error-handler.ts` OR delete it.** `~480` LOC, zero callers. Decision rests on whether the new `@claude-flow/errors` package covers the same use cases (sanitisation + classification + retryability). Owed: separate micro-ADR.
* **F-13-001 — Pick one retry library and delete the other.** `production/retry.ts` (richer) vs `shared/resilience/retry.ts` (cleaner). Eight ad-hoc retry loops downstream. Owed: separate micro-ADR with swarm review.
* **F-13-003 — Fix `ErrorCodes` triplication + internal `-32001` / `-32002` collision.** `MCPServerError` defined byte-identically in 3 packages; the `-32001` and `-32002` codes collide on two distinct error meanings each. Owed: separate micro-ADR (small scope).
* **F-13-004 — Pick the project-wide error-code naming convention.** 5 parallel conventions today. The new `@claude-flow/errors` package will pick one for its own codes; whether that scheme is enforced fork-wide is a separate decision.
* **F-13-006 — Migrate the `~41` `${e.message}` interpolation throws to `wrapError`.** Mechanical one-line edits; preserves stack + cause; clear win per site. But: needs a per-site review pass (some interpolations carry context the bare `cause:` doesn't), and the cost-of-touching-the-file vs benefit calculation is non-obvious. Owed: future targeted-migration ADR after canon adoption.
* **F-13-007 — Replace `error.message.includes(...)` retryability with `instanceof` discrimination.** Depends on F-13-001 (retry library) + F-13-004 (naming convention) landing first. Owed: future micro-ADR.
* **F-13-008 — Annotate the `~149` un-marked `catch ... console.warn/error` swallows.** Owned by ADR-0191's allowlist process; this ADR doesn't change that.
* **F-13-005 sub-cluster — Dedupe the 5 `sanitizeError` definitions.** Owed: micro-ADR after the new shared library lands (it can provide the canonical one).

### References

* **Audit slice:** [`docs/audits/2026-05-24-second-pass-audit/13-error-taxonomy.md`](../audits/2026-05-24-second-pass-audit/13-error-taxonomy.md) — full 9-finding evidence base for CT-I.
* **Consolidated theme:** [[ADR-0233]] §CT-I — defect-class statement; priority `10` (lowest urgency) by ADR-0233's triage; long-term framing is consistent with that calibration.
* **Pre-flight:** [[ADR-0201]] §[Remediation-ADR pre-flight checklist](./ADR-0201-codebase-soundness-completeness-audit-with-runtime-validation.md#remediation-adr-pre-flight-checklist-added-2026-05-20) — the four checks this ADR applied above.
* **Sibling ADRs (overlap-cleared):**
  * [[ADR-0209]] — no-fallbacks arch-test. Owns per-site bulk-fix of dishonest-success envelopes (`embeddings-tools:525` + corrupt-JSON-collapse); this ADR owns the protocol-boundary mechanism for *fatals*.
  * [[ADR-0210]] — stub honesty mandate. Owns per-handler stub disposition (implement/restore/delete the `~11` named stubs); explicitly carved out the protocol-level `isError`/`structuredContent` micro-ADR as owed work — this ADR delivers the envelope-honesty half.
  * [[ADR-0226]] — MCP stdio frame writes (`writeFrame`). Owns frame-write race-immunity; this ADR owns handler-side error propagation. Complementary; the frame layer is already correct.
  * [[ADR-0240]] — StdioServerTransport stderr-only logging. Owns the non-frame diagnostic channel; this ADR owns the handler-side fatal-throw channel. Same boundary (`mcp-server.ts:691-707`), different shape.
* **Gold-standard source:** `forks/ruflo/v3/plugins/gastown-bridge/src/errors.ts` — the `701`-line hierarchy this ADR proposes to extract.
* **The unwired facility (named for transparency):** `forks/ruflo/v3/@claude-flow/cli/src/production/error-handler.ts` — `~480` LOC, zero external instantiations; fate decided by F-13-002 follow-up ADR.
* **The unused retry libraries (named for transparency):** `forks/ruflo/v3/@claude-flow/shared/src/resilience/retry.ts` + `forks/ruflo/v3/@claude-flow/cli/src/production/retry.ts` — both have zero production callers; fate decided by F-13-001 follow-up ADR.
* **Memory / corpus rules:**
  * [[feedback-best-effort-must-rethrow-fatals]] — the corpus rule that this ADR's MCP envelope-honesty arch-test operationalises at the largest single cluster of violations.
  * [[feedback-no-fallbacks]] — parent policy; this ADR's envelope-honesty rule is a specific instance.
  * [[feedback-skip-accepted-as-squelch]] — the advisory-first lint is NOT a squelch (it's modelled on ADR-0209's settled approach).
  * [[feedback-corpus-evidence-before-feature-work]] — why the retry-library and naming-convention decisions are deferred to swarm review, not picked unilaterally here.
  * [[feedback-remediation-adr-preflight]] — the source of the 4-check pre-flight applied above.
  * [[feedback-update-integration-ledger]] — the new shared package's seed code originates from `gastown-bridge/errors.ts` which is upstream-derived; a ledger row recording the extraction is owed when the package lands.
