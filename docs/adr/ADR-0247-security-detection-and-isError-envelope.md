---
status: proposed
date: 2026-05-24
tags: [audit-followup, security, aidefence, pii, mcp-envelope, ct-n]
supersedes: []
depends-on: [0201, 0210, 0233, 0238]
implements: []
---

# Security follow-ups beyond CT-E: isError envelope + framing + detector deferrals (CT-N)

## Context

[[ADR-0233]] §CT-E ("Surface without enforcement") delegated the *wire-or-remove* decision for eight unused security/telemetry/consensus surfaces to [[ADR-0238]]. CT-N is the **second-pass remediation track** for slice-04 (security) covering the five remaining findings that ADR-0238 explicitly listed as out-of-scope (PII coverage / `aidefence_learn` poisoning) plus the framing-mismatch and protocol-boundary findings that don't fit the wire-or-remove shape.

Findings in scope (per `/tmp/coverage-matrix.md` §CT-N row and the slice-04 audit):

1. **F-04-006 [HIGH]** — PII coverage gaps + `aidefence_has_pii` (6 regexes: email, dashed SSN, credit card, OpenAI/Anthropic api keys, GitHub PAT, `password=…`) vs `transfer_detect-pii` (8 different regexes: email, phone, ipv4, ipv6, narrower api_key, JWT, home/Windows paths). Both miss: addresses, IBAN, no-dash SSN, AWS/Stripe keys, private SSH keys, MAC. ADR-0238 deferred this finding explicitly.
2. **F-04-007 [HIGH]** — `aidefence_learn` MCP tool accepts unauthenticated `wasAccurate=false` from any caller (`security-tools.ts:357-447`, schema `required: ['input','wasAccurate']`); the `ThreatLearningService` stores patterns with `effectiveness: 0.2` + `falsePositiveCount: 1` on negative feedback, and decrements mitigation `effectiveness` (`threat-learning-service.ts:191-239`). Adversary can pollute `searchSimilarThreats` rankings + `getBestMitigation` selection. ADR-0238 deferred this finding explicitly.
3. **F-04-009 [WARNING]** — Aidefence handlers correctly set `isError: true` on failure (`security-tools.ts:204-211,290-297,342-349,437-444,492-499,536-543`), but `callMCPTool` (`mcp-client.ts:161-188`) returns `result as T` without inspecting `isError`. Consumers destructuring `{ safe } = await callMCPTool('aidefence_is_safe', …)` see `safe === undefined` on error; `if (!safe)` treats undefined as falsy alongside real "unsafe" verdicts; `if (safe)` short-circuits identically. Verified at HEAD: lines 176-179 read `try { const result = await tool.handler(input, context); return result as T; } catch (error) { … }` — no `isError` branch.
4. **F-04-010 [WARNING]** — Aidefence `index.ts:8` advertises "HNSW-indexed threat pattern search (150x-12,500x faster with AgentDB)". The speedup applies ONLY to `searchSimilarThreats` (a `learningService.searchSimilarThreats(query, …)` call returning past LEARNED patterns); the detect path is a synchronous for-loop over 50 regexes (`threat-detection-service.ts:289-307`), unrelated to HNSW. Operator-facing framing mismatch beyond the docblock-only fix ADR-0238 Surface 1 commits to (which targets the "AI Manipulation Defense System" framing, not the perf claim).
5. **F-04-011 [NOTE]** — `installAttempted` (module-scope boolean at `security-tools.ts:28`, set true at `:77`) means a transient npm/registry failure on the first aidefence call permanently disables aidefence for the rest of the MCP-server-process lifetime. Operators must restart the MCP server to recover.

**Explicitly excluded:** F-04-004 (caller-supplied identity in issue-claim handlers) is bound to the ADR-101 federated-claims direction and out of scope per the matrix.

## Pre-flight verification (per [[ADR-0201]] checklist)

Applied per finding ([[feedback-remediation-adr-preflight]]).

### F-04-009 (isError envelope propagation)

1. **Signal reaches audience?** Today, NO. Handlers honestly emit `isError: true`; the client helper at `mcp-client.ts:176-179` swallows that signal by returning the raw envelope. The audience (LLM consumer code that destructures `{ safe } = await callMCPTool(…)`) cannot distinguish a real "unsafe" verdict from a thrown-and-swallowed error. Fix is to make `callMCPTool` throw when `isError: true` — symmetric with the path it takes for thrown exceptions (line 180-187). After the fix, every existing consumer gets a consistent failure path.
2. **Upstream's choice?** Byte-identical: `/Users/henrik/source/ruvnet/ruflo/v3/@claude-flow/cli/src/mcp-client.ts:173-191` carries the same `return result as T` shape. Fork-only fix is permanent merge tax in this one file. Acceptable because (a) the change is small and surgical, (b) it implements the corpus rule [[feedback-best-effort-must-rethrow-fatals]] at a load-bearing seam, and (c) the upstream code is *latently broken* (handlers correctly signal but no one reads the signal) — fixing it forward is structurally aligned with upstream's intent even where bytes diverge.
3. **Premise true at runtime?** Verified by direct read of HEAD at `/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/mcp-client.ts:161-188` and `security-tools.ts:204-211,290-297,342-349,437-444,492-499,536-543`. The asymmetry is exactly as the audit describes: 6 handlers set `isError: true`; the client never inspects it.
4. **Sibling-ADR overlap?** This is the **client-side complement** to [[ADR-0242]]. ADR-0242's structural rule is "MCP **handlers** must let fatals throw (don't catch and return `{success:false}`)" — that's a server-side rule about the ~56 handlers that defeat the corpus rule by swallowing into envelopes. F-04-009 is a different defect: aidefence's 6 handlers ALREADY honor the corpus rule (they `isError: true` honestly); the **client** swallows the signal. ADR-0242's `mcp-server.ts:691-707` wrap explicitly does NOT change (the wrap is correct). This ADR's `mcp-client.ts:161-188` fix complements ADR-0242 at the other end of the MCP envelope: both ADRs target propagation of fatals through the protocol; ADR-0242 owns the server-side handler-rule, this ADR owns the client-side helper-rule. **Disjoint by artifact** — ADR-0242 modifies handlers; this ADR modifies `callMCPTool`. **Disjoint by mechanism** — ADR-0242's arch-test fires on handler-top-level `catch(e) { return {success:false} }`; this ADR's fix fires when an existing `isError: true` envelope is returned. **Decision: do not fold into ADR-0242; own here.** ADR-0242 is also long-term and explicitly out-of-scope for "fix the existing ~56 handlers"; this ADR is a one-file surgical change at the client.

### F-04-006 (PII coverage gaps + dual-detector mismatch)

1. **Signal reaches audience?** Today, partially. `aidefence_has_pii` and `transfer_detect-pii` both return per-call results that callers see, but neither tool is invoked at a real input boundary (per F-04-001 the entire aidefence surface is opt-in only; per the audit `transfer_detect-pii` is only invoked from an `export` flow inside the transfer system). The coverage gap is only observable to a caller who already opted in and who then runs the same payload through both detectors. **Real audience is operator-mental-model**: the package descriptions imply comprehensive coverage; reality is opinionated and shallow.
2. **Upstream's choice?** Both detectors exist with identical regex sets in upstream (`/Users/henrik/source/ruvnet/ruflo/v3/@claude-flow/aidefence/src/domain/services/threat-detection-service.ts:232-263` and `cli/src/transfer/anonymization/index.ts:17-26`). Upstream has NOT unified them; consolidating to a single package is a fork-only refactor that creates **permanent merge tax in two files** for a security boundary upstream chose not to centralize. Same structural calculus as [[ADR-0238]] Surface 1 (AIDefence central-dispatch wiring): upstream-not-wired + fork-only-fix = perpetual merge cost; defer until product driver emerges.
3. **Premise true at runtime?** Verified. Both detector files exist at the cited line ranges with the cited disjoint regex sets.
4. **Sibling-ADR overlap?** None — [[ADR-0238]] Surface 1 owns aidefence FRAMING honesty (docblock + 3-gate ADR rewrite) but explicitly defers F-04-006/F-04-007 ("Out of scope: F-04-006, F-04-007 — separate findings; not in wire-or-remove decision"). No other ADR proposes detector consolidation.

### F-04-007 (`aidefence_learn` unauthenticated negative feedback)

1. **Signal reaches audience?** Yes — the MCP tool is registered (per F-04-001 the surface is opt-in but reachable); any MCP caller can POST `{input, wasAccurate: false, ...}` and the `ThreatLearningService` mutates persisted patterns + mitigation rankings. The poisoned signal then reaches anyone who later calls `aidefence_stats` or `searchSimilarThreats`.
2. **Upstream's choice?** Identical schema upstream — `required: ['input', 'wasAccurate']`, zero auth, zero rate limit. Upstream did not enforce a caller identity gate on `aidefence_learn` either. Adding `caller_id` + rate-limit fork-only would require either (a) plumbing `caller_identity` into `MCPCallContext` (the same multi-ADR architectural change [[ADR-0238]] deferred for claims RBAC at Surface 2) or (b) a fork-local feedback-throttling layer that creates merge tax in `security-tools.ts` indefinitely. Both options exceed this ADR's scope and would re-litigate the same calculus ADR-0238 already walked for Surface 2.
3. **Premise true at runtime?** Verified. `security-tools.ts:357-447` carries the tool registration with no auth check; `threat-learning-service.ts:191-239` (per audit cite) stores `effectiveness: 0.2` + `falsePositiveCount: 1` on negative feedback. Wrapper stats counters at `security-tools.ts:36-43` similarly have no caller binding.
4. **Sibling-ADR overlap?** Partial — F-04-007's "wire `caller_identity`" remedy is the SAME architectural prerequisite ADR-0238 Surface 2 deferred for claims RBAC central-dispatch enforcement. Owning F-04-007 wiring HERE would force this ADR to specify the `MCPCallContext` identity-plumbing design — a multi-ADR architectural change with no driver. **Disposition: defer wiring with the same rationale ADR-0238 Surface 2 used; document the poisoning vector here so it's not forgotten.**

### F-04-010 (HNSW framing mismatch)

1. **Signal reaches audience?** Yes — operator reading `index.ts:8` sees "HNSW-indexed threat pattern search (150x-12,500x faster with AgentDB)" and may infer the detect path is accelerated. The misframing is operator-cognitive, not runtime.
2. **Upstream's choice?** Byte-identical at `/Users/henrik/source/ruvnet/ruflo/v3/@claude-flow/aidefence/src/index.ts:8`. Same merge-tax shape as F-04-005 (which [[ADR-0238]] Surface 1 already commits to fix with merge-tax acceptance because it's a one-line docblock change).
3. **Premise true at runtime?** Verified. The string is present on line 8 at HEAD.
4. **Sibling-ADR overlap?** [[ADR-0238]] Surface 1 already commits to "Rewrite `@claude-flow/aidefence/src/index.ts:1-30` docblock + `plugins/ruflo-aidefence/README` to 'manual scan utility' framing per F-04-005." That rewrite covers lines 1-30 which **includes** line 8's HNSW perf claim. **Decision: append a one-line scope-extension to ADR-0238 Surface 1's docblock-rewrite by referencing this ADR.** No new artifact; the docblock rewrite must clarify that the HNSW speedup applies only to `searchSimilarThreats` (past-learned patterns), not to detection itself.

### F-04-011 (`installAttempted` permanent cache)

1. **Signal reaches audience?** Yes — operator sees aidefence stop working after the first transient failure; the error message at `security-tools.ts:120-127` correctly lists three recovery paths (one of which is "restart the MCP server"). Today the signal IS honest about what to do; the friction is that "restart" is the only recovery.
2. **Upstream's choice?** Byte-identical at `/Users/henrik/source/ruvnet/ruflo/v3/@claude-flow/cli/src/mcp-tools/security-tools.ts:28,74,77`. Fork-only backoff is small merge tax in one file.
3. **Premise true at runtime?** Verified. Module-scope `let installAttempted = false` at line 28, gate at line 74, set at line 77.
4. **Sibling-ADR overlap?** None — `installAttempted` is unique to this loader. Not part of any other ADR's scope.

## Considered Options

* **Option A — Two-part comprehensive fix.** (1) Unify PII detection in a single package with an explicit coverage matrix documenting each pattern; both MCP tools dispatch to the same implementation (F-04-006). (2) Require `caller_id` + rate-limit on `aidefence_learn` per F-04-007. Plus F-04-009 client-side fix, F-04-010 framing ride-along, F-04-011 backoff. **Rejected** — Part (1) and Part (2) each fail pre-flight check #2 (upstream-not-wired; fork-only perpetual merge tax); part (2) ALSO fails check #4 (re-litigates the `caller_identity` plumbing ADR-0238 Surface 2 deferred).
* **Option B — Defer F-04-006 and F-04-007 entirely; own F-04-009 only.** Low-friction structural fix at `mcp-client.ts` that complements ADR-0242 on the client side. **Rejected as too narrow** — leaves F-04-010 and F-04-011 (both small, in-scope) unaddressed and forces follow-on micro-ADRs for trivial fixes.
* **Option C — Fold F-04-009 into [[ADR-0242]] since both are MCP-envelope-honesty issues.** **Rejected** — ADR-0242 is a long-term cultural-shift ADR explicitly scoped to handler-side rules; folding F-04-009 in would (a) blur ADR-0242's "handlers must throw" message, (b) couple a one-file client fix to ADR-0242's multi-cycle adoption timeline, (c) re-open ADR-0242's careful scope discipline. Cleaner to deliver F-04-009 as a small sibling ADR that explicitly disclaims overlap with ADR-0242.
* **Option D — Option B extended (chosen).** Own F-04-009 as the high-leverage structural fix; ride along with F-04-010 (one-line scope-extension to ADR-0238's already-committed docblock rewrite) and F-04-011 (small backoff fix in one file). **Defer F-04-006 and F-04-007 with explicit rationale** (upstream-not-wired + fork-only fix would be permanent merge tax for a security boundary upstream chose not to enforce — exact same calculus as [[ADR-0238]] Surfaces 1 and 2). This ADR closes the structural protocol-boundary gap and the small framing/recovery gaps; the deferred items are tracked openly as future product-bet ADRs.

## Decision

**Chosen: Option D — own F-04-009 + F-04-010 + F-04-011; defer F-04-006 and F-04-007 with explicit rationale.**

### Sites table

| # | Finding | Disposition | Action | Rationale |
|---|---------|-------------|--------|-----------|
| 1 | F-04-009 (WARN) `callMCPTool` ignores `isError` | **Fix in `mcp-client.ts`** | Change `mcp-client.ts:178-179` from `const result = await tool.handler(input, context); return result as T;` to inspect the result envelope: if the result is an object with `isError === true`, throw `new MCPClientError("Tool '${toolName}' returned isError envelope: ${extracted-text}", toolName)` (same `MCPClientError` constructor used for thrown exceptions at lines 182-186). Existing thrown-exception branch unchanged. Add an `isMCPErrorEnvelope(x): boolean` type-narrow helper (looks for `x?.isError === true`). | Client-side complement to [[ADR-0242]]'s server-side rule. Aidefence handlers already honor the corpus rule by setting `isError: true`; the client swallowing the signal defeats the discipline. One-file fix; immediate consumer-side improvement; lays the protocol groundwork for the broader handler migration ADR-0242 targets long-term. |
| 2 | F-04-010 (WARN) HNSW perf-claim framing | **Bundle with [[ADR-0238]] Surface 1 docblock rewrite** | When the ADR-0238 Surface 1 docblock-rewrite lands at `aidefence/src/index.ts:1-30`, the rewriter MUST also clarify the line-8 HNSW claim: "HNSW search of past learned patterns (`searchSimilarThreats`); detection latency is a fixed regex pass over 50 patterns (~5ms/100KB input), not HNSW-accelerated." If ADR-0238 Surface 1 lands BEFORE this ADR, file a one-line addendum to that ADR's implementation commit referencing F-04-010. | F-04-010 is the same docblock; splitting it from F-04-005 would force two passes over the same file. The clarification is one sentence; the merge-tax is identical to F-04-005's. Ride-along. |
| 3 | F-04-011 (NOTE) `installAttempted` permanent cache | **5-minute backoff with re-try-after timestamp** | Change `security-tools.ts:28` from `let installAttempted = false;` to `let installAttemptedAt: number \| null = null;`. Change the gate at `:74` from `if (installAttempted)` to `if (installAttemptedAt && Date.now() - installAttemptedAt < 5 * 60 * 1000)` (5-minute back-off window). Change the set at `:77` from `installAttempted = true;` to `installAttemptedAt = Date.now();`. Update the error message at `:120-127` to mention "auto-retry in N minutes" alongside the three existing recovery paths. | Permanent cache turns a transient registry blip into a session-long outage; 5-minute backoff turns it into a 5-minute pause that self-recovers. One-file fork-only change; small merge tax. Matches what the audit recommends verbatim. |
| 4 | F-04-006 (HIGH) PII detector dual + coverage gaps | **DEFER with explicit rationale** | This ADR does NOT consolidate the two PII detectors. Reasoning recorded in More information section + this row. Track as open work for a future product-bet ADR when (a) a real boundary actually invokes either detector at runtime (today neither does; F-04-001 + audit method), or (b) a PII consent/redaction model is decided. Until then, augmenting either detector creates fork-only merge tax against a security boundary upstream chose not to centralize. **Operators reading aidefence/transfer-anonymization docs should not assume comprehensive PII coverage.** | Pre-flight check #2 (upstream-not-wired) and the [[ADR-0238]] Surface 1 calculus (operator over-trust is the harm today, not API absence) apply identically here. Picking pattern coverage and naming this batch the "canonical PII set" is a product decision deferred until a real wiring driver exists. |
| 5 | F-04-007 (HIGH) `aidefence_learn` poisoning | **DEFER with explicit rationale** | This ADR does NOT add `caller_id` + rate-limit to `aidefence_learn`. Reasoning recorded in More information section + this row. The fix requires either (a) plumbing `caller_identity` into `MCPCallContext` (the same multi-ADR architectural change [[ADR-0238]] Surface 2 deferred for claims RBAC) or (b) a fork-local feedback-throttling layer that creates merge tax in `security-tools.ts` indefinitely. Until a `caller_identity` direction is decided (the same one F-04-003 and F-04-004 are waiting on), `aidefence_learn` remains exploitable for trust-poisoning of mitigation rankings. **Mitigating factor**: per F-04-005 / ADR-0238 Surface 1, the entire aidefence surface is opt-in and the framing is being corrected to "manual scan utility" — operators are being told the surface is not enforced; the poisoning impact lands on `searchSimilarThreats` ranking, not on the regex-based detect path (which is data-independent). | Pre-flight check #4 (sibling-ADR overlap on `caller_identity` plumbing) and the ADR-0238 Surface 2 calculus apply directly. Owning F-04-007 here would re-open the `MCPCallContext` identity-plumbing design across multiple ADRs. |

### Confirmation gates

* **Site 1 (F-04-009)**: Behaviour test in `forks/ruflo/v3/@claude-flow/cli/__tests__/mcp-client-iserror.test.ts` constructs a mock MCP tool that returns `{ isError: true, content: [{ type:'text', text: JSON.stringify({error:'simulated'}) }] }`; asserts `await callMCPTool('mock')` throws `MCPClientError` with `cause` (or message context) referencing the simulated error. Negative test: a tool returning `{ isError: false, content: [...] }` returns normally. After the change, `grep -n 'return result as T' forks/ruflo/v3/@claude-flow/cli/src/mcp-client.ts` returns zero (the unconditional pass-through is gone).
* **Site 2 (F-04-010)**: When ADR-0238 Surface 1 confirmation gate runs (`grep -rn "AI Manipulation Defense\|self-learning capabilities\|HNSW-indexed threat pattern search" forks/ruflo/v3/@claude-flow/aidefence/src/index.ts forks/ruflo/plugins/ruflo-aidefence/README` returns zero), the rewritten docblock must include a sentence explicitly scoping the HNSW claim to `searchSimilarThreats`. Manual review of the implementation commit.
* **Site 3 (F-04-011)**: `grep -n "installAttempted" forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/security-tools.ts` shows the variable renamed to `installAttemptedAt` and typed `number | null`. Behaviour test in `forks/ruflo/v3/@claude-flow/cli/__tests__/security-tools-backoff.test.ts` (or extend an existing aidefence test) asserts that after a simulated install-fail, a second call within 5 minutes throws the cached error AND a third call after `Date.now() + 5*60_000 + 1` re-attempts the install path.
* **Sites 4 + 5 (F-04-006, F-04-007)**: No code-level gate (deferred). Acceptance is documentary: this ADR's "More information" section names the open follow-ups; the security audit's slice-04 file remains the authoritative findings record; future product-bet ADRs that pick up either finding must reference this ADR's deferral rationale.

## Consequences

### Positive

* **F-04-009 fix** closes the largest structural gap in the MCP envelope-honesty story at the seam where it costs one file. Future handlers that adopt [[ADR-0242]]'s server-side rule (throw fatals) and existing handlers that already set `isError: true` honestly (the 6 aidefence handlers, plus any others) get the same consistent failure path on the client side.
* **F-04-010 ride-along** removes a perf-claim mismatch in the same docblock [[ADR-0238]] Surface 1 already rewrites — zero extra commits, one extra sentence in the rewrite.
* **F-04-011 backoff** turns a session-long aidefence outage into a 5-minute self-recovering pause; matches the audit's verbatim recommendation; small file-local change.
* **Deferral honesty** for F-04-006/F-04-007 keeps both findings visible in the audit trail rather than burying them in a "won't fix"; future product-bet ADRs can pick them up with the rationale already documented.

### Negative

* **F-04-009 is a behaviour change** for any caller that today silently swallows aidefence-error envelopes (per the audit, the two smoke scripts at `plugins/ruflo-{aidefence,browser}/scripts/smoke.sh` check only registration, not envelope contents). After this fix, those callers will see `MCPClientError` thrown where they previously saw a returned object with `isError: true`. **Mitigation**: the audit explicitly recommends this; the previous behaviour was a silent fail-open by convention; the change makes the failure observable. Surface the change in the implementation commit message + flag for plugin smoke-script review.
* **F-04-007 deferral leaves the poisoning vector open**. `aidefence_learn` remains exploitable for trust-poisoning of mitigation rankings (NOT of detection — regex detection is data-independent). The audit calibrated this as HIGH; deferring it accepts the risk until `caller_identity` plumbing exists. **Mitigation**: the entire aidefence surface is opt-in per F-04-001 and being reframed as "manual scan utility" per ADR-0238 Surface 1 — operators are being told the surface is advisory; the poisoning impact is bounded to a ranking surface that nothing else trusts at runtime.
* **F-04-006 deferral leaves PII coverage gaps documented but unfixed**. Operators reading either detector's description may still assume comprehensive coverage. **Mitigation**: ADR-0238 Surface 1's docblock rewrite reframes aidefence as a "manual scan utility"; this ADR documents the gap so future ADR-0238-style framing-honesty work can extend to the `aidefence_has_pii` description.
* **Three small fork-only fixes** (F-04-009, F-04-010 ride-along, F-04-011) each carry permanent merge tax against upstream in their respective files. Acceptable: total surface is three files, all small edits, all structurally aligned with corpus rules upstream's code already half-implements.

### Neutral

* This ADR does not touch `mcp-server.ts:691-707` (that wrap is correct — it converts thrown errors to JSON-RPC error frames already). The fix is at the client helper that wraps tool dispatch in `cli/src/`, not at the MCP server transport layer.
* This ADR does not propose a new lint or arch-test. The fix is a one-file behavioural change with a test; new structural rules belong to [[ADR-0242]]'s scope.

## Sites table

(Same as Decision Sites table above — retained here per the requested structure.)

| # | Finding | Severity | File:line | Action | Owns |
|---|---------|----------|-----------|--------|------|
| 1 | F-04-009 | WARN | `forks/ruflo/v3/@claude-flow/cli/src/mcp-client.ts:161-188` | Inspect `isError` in result envelope; throw `MCPClientError` if true | this ADR |
| 2 | F-04-010 | WARN | `forks/ruflo/v3/@claude-flow/aidefence/src/index.ts:8` | One-sentence scope-clarification in the ADR-0238 Surface 1 docblock rewrite | bundled with [[ADR-0238]] |
| 3 | F-04-011 | NOTE | `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/security-tools.ts:28,74,77,120-127` | Rename `installAttempted` → `installAttemptedAt: number \| null`; 5-minute backoff; updated error message | this ADR |
| 4 | F-04-006 | HIGH | `forks/ruflo/v3/@claude-flow/aidefence/src/domain/services/threat-detection-service.ts:232-263` + `forks/ruflo/v3/@claude-flow/cli/src/transfer/anonymization/index.ts:17-26` | **Deferred** — upstream-not-wired; fork consolidation = perpetual merge tax for a security boundary upstream chose not to centralize | deferred to future product-bet ADR |
| 5 | F-04-007 | HIGH | `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/security-tools.ts:357-447` + `forks/ruflo/v3/@claude-flow/aidefence/src/domain/services/threat-learning-service.ts:191-239` | **Deferred** — requires `caller_identity` plumbing in `MCPCallContext` (same architectural change [[ADR-0238]] Surface 2 deferred for claims RBAC) | deferred to `caller_identity` direction (joint with F-04-003 / F-04-004 / ADR-101) |

## More information

### Why F-04-006 and F-04-007 are deferred (not "won't fix")

Both findings cleared pre-flight checks #1 and #3 (signal reaches a real audience; premise is true at runtime). Both fail check #2 (upstream-not-wired) AND, for F-04-007, check #4 (architectural overlap with [[ADR-0238]] Surface 2's deferred `caller_identity` plumbing). Owning either finding here would commit this ADR to:

* **F-04-006**: picking the "canonical PII regex set" (which patterns are in, which aren't, who decides), creating a new package or service to host the unified detector, and refactoring both existing tools' dispatch paths. The result is a fork-only artifact upstream will conflict with on every sync. The right driver is "a real boundary calls one of these detectors at runtime" — which today doesn't exist (per F-04-001 the entire aidefence surface is opt-in, and `transfer_detect-pii` is only invoked from an export flow).
* **F-04-007**: designing the `caller_identity` field shape on `MCPCallContext`, deciding rate-limit semantics (per-caller? per-tool? token-bucket? sliding window?), wiring identity propagation through the MCP transport layer, and updating all consumers. This is the same architectural change `[[ADR-0238]]` Surface 2 deferred for claims RBAC — that ADR's reasoning applies directly: "Half-implemented authorization is worse than none (it ships with the appearance of a security boundary). Upstream-aligned; building real plumbing requires `caller_identity` in `MCPCallContext` — a multi-ADR architectural change with no driver."

Both deferrals are **tracked openly**, not buried. When/if a driver emerges (a real input-boundary invocation for F-04-006; a `caller_identity` design decision for F-04-007), the future ADR can reference this ADR's deferral rationale and move forward.

### Out-of-scope items also named for transparency

* **F-04-001** (AIDefence has zero non-test callers) — owned by [[ADR-0238]] Surface 1 (honesty-correction + keep).
* **F-04-002** (`commands/claims.ts:268-271` permissive-default on error) — owned by [[ADR-0220]] honesty-pass scope.
* **F-04-003** (central MCP dispatch performs no claims check) — owned by [[ADR-0238]] Surface 2 (remove the API surface / advisory banner).
* **F-04-004** (caller-supplied identity in issue-claim handlers) — bound to ADR-101 federated-claims direction; explicitly excluded from this ADR per matrix.
* **F-04-005** (AIDefence framing as "model" but is regex+rules) — owned by [[ADR-0238]] Surface 1 (docblock rewrite covers the framing-correction).
* **F-04-008** (`browser_cookie_use` advertises `aidefence_verdict` no enforcement) — owned by [[ADR-0238]] Surface 1, decision (c).
* **F-13-005 sibling concern** (MCP handlers catch-and-return success object) — owned by [[ADR-0242]] (server-side MCP handler-rule). F-04-009 (this ADR) is the client-side complement.

### References

* **Audit slice**: [`docs/audits/2026-05-24-second-pass-audit/04-security-aidefence-claims-pii.md`](../audits/2026-05-24-second-pass-audit/04-security-aidefence-claims-pii.md) — full 11-finding evidence base for slice 04; F-04-006, F-04-007, F-04-009, F-04-010, F-04-011 sourced verbatim.
* **Coverage matrix**: `/tmp/coverage-matrix.md` §CT-N (5-finding bucket + 3 decision-shape options, with the F-04-009 / [[ADR-0242]] overlap call-out).
* **Parent ADR**: [[ADR-0233]] §CT-N (none — CT-N was not in the original 10-CT batch; this ADR establishes CT-N as a new track per the matrix recommendation).
* **Pre-flight**: [[ADR-0201]] §[Remediation-ADR pre-flight checklist](./ADR-0201-codebase-soundness-completeness-audit-with-runtime-validation.md#remediation-adr-pre-flight-checklist-added-2026-05-20) — the four checks applied per finding above.
* **Sibling ADRs (overlap-cleared)**:
  * [[ADR-0210]] — stub-honesty mandate; governs framing-correction (F-04-010 rides on Surface 1's docblock rewrite which inherits ADR-0210's principle).
  * [[ADR-0238]] — wire-or-remove triage for the 8 unused security/telemetry/consensus surfaces. **Sibling for**: Surface 1 (F-04-001 + F-04-005 + F-04-008 framing/honesty); Surface 2 (F-04-003 + deferred `caller_identity` plumbing). **Bundled with**: F-04-010 (ride-along on Surface 1 docblock rewrite).
  * [[ADR-0242]] — shared error library + MCP envelope honesty (server-side). **Disjoint from F-04-009** by artifact (handlers vs `callMCPTool`) and mechanism (throw-vs-return rule vs honor-isError rule). F-04-009 is the client-side complement; this ADR owns it.
  * [[ADR-0220]] — honesty-pass for `commands/claims.ts:268-271` permissive-default fallback (F-04-002). Not in this ADR's scope.
* **Key file references** (HEAD-verified):
  * F-04-009: `/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/mcp-client.ts:161-188`; aidefence handlers at `/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/security-tools.ts:204-211,290-297,342-349,437-444,492-499,536-543`.
  * F-04-010: `/Users/henrik/source/forks/ruflo/v3/@claude-flow/aidefence/src/index.ts:8`; detect path at `domain/services/threat-detection-service.ts:289-307`.
  * F-04-011: `/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/security-tools.ts:28,74-77,120-127`.
  * F-04-006: `/Users/henrik/source/forks/ruflo/v3/@claude-flow/aidefence/src/domain/services/threat-detection-service.ts:232-263`; `/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/transfer/anonymization/index.ts:17-26`.
  * F-04-007: `/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/security-tools.ts:357-447`; `/Users/henrik/source/forks/ruflo/v3/@claude-flow/aidefence/src/domain/services/threat-learning-service.ts:191-239`.
* **Upstream comparison points** (for merge-tax accounting per [[feedback-update-integration-ledger]]):
  * `/Users/henrik/source/ruvnet/ruflo/v3/@claude-flow/cli/src/mcp-client.ts:173-191` — byte-identical to fork; F-04-009 fix opens fork divergence in this file.
  * `/Users/henrik/source/ruvnet/ruflo/v3/@claude-flow/aidefence/src/index.ts:8` — byte-identical; F-04-010 rides on ADR-0238 Surface 1 divergence already.
  * `/Users/henrik/source/ruvnet/ruflo/v3/@claude-flow/cli/src/mcp-tools/security-tools.ts:28,74,77` — byte-identical; F-04-011 fix opens small fork divergence.
* **Memory / corpus rules**:
  * [[feedback-best-effort-must-rethrow-fatals]] — F-04-009 fix operationalizes this rule at the `callMCPTool` client seam.
  * [[feedback-remediation-adr-preflight]] — the 4-check pre-flight applied per finding above.
  * [[feedback-corpus-evidence-before-feature-work]] — F-04-006/F-04-007 deferral rationale (no real boundary calls either today; consolidation/auth is feature-work waiting on evidence).
  * [[feedback-update-integration-ledger]] — three fork-only fixes need ledger rows on implementation commit (one per touched file: `mcp-client.ts`, `aidefence/src/index.ts` (joint with ADR-0238 Surface 1), `security-tools.ts`).
  * [[feedback-no-fallbacks]] — F-04-009 fix closes a "soft fail-open by convention" instance of this anti-pattern at the client helper.
