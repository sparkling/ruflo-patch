## ADR-0247 — CT-N: security follow-ups (isError envelope + framing + detector deferrals)

**Status**: proposed (post-swarm-review)
**Swarm**: 5 experts + devil's advocate, Quorum-majority consensus (≥3/5 for adoption)
**Triage rank**: 13 per [[ADR-0233]] §Decision

### Decision (post-swarm-review)

Adopt **Option D as drafted** — own F-04-009 (client-side `callMCPTool` honors `isError`),
F-04-010 (HNSW framing ride-along on [[ADR-0238]] Surface 1's docblock rewrite), and
F-04-011 (5-minute backoff for `installAttempted`); **defer F-04-006 and F-04-007** with
the explicit upstream-not-wired + same-architectural-prerequisite-as-Surface-2 rationale
already recorded in the ADR. Quorum carried 4/5 for own-three-defer-two (E1, E3, E4, E5
adopt; E2 amends-but-votes-adopt; DA holds principled dissent on the F-04-006/007 defer).
Two clarifying improvements adopted from the panel: (i) the Confirmation gate for site #1
must include a positive grep showing the `MCPClientError` `cause` chain carries the
synthetic `isError`-envelope text so downstream consumers can distinguish it from a
real-error throw; (ii) the Site #2 ride-along must add a small literal-text assertion to
[[ADR-0238]] Surface 1's Confirmation gate so the HNSW-scope clarification doesn't silently
get omitted when the docblock is rewritten.

### Implementation steps

1. **Site #1 (F-04-009) fork-only fix** in
   `forks/ruflo/v3/@claude-flow/cli/src/mcp-client.ts:178-179`. Replace
   `const result = await tool.handler(input, context); return result as T;` with an
   inspection block: if the awaited result is an object with `isError === true`, throw a
   new `MCPClientError(\`Tool '\${toolName}' returned isError envelope\`, toolName, cause)`
   where `cause` is a synthesised `Error` carrying the extracted `content[].text` body so
   downstream `.cause.message` introspection works. Existing thrown-exception branch at
   `:180-187` unchanged. Add an `isMCPErrorEnvelope(x: unknown): x is { isError: true; content?: unknown[] }`
   type-narrow helper above `callMCPTool` (keeps the inspection terse + grep-anchorable
   for future audits). Commit per `[[feedback-commit-forks-before-release]]`.
2. **Site #1 behaviour test** at `forks/ruflo/v3/@claude-flow/cli/__tests__/mcp-client-iserror.test.ts`:
   register a mock MCP tool returning `{ isError: true, content: [{ type:'text', text: JSON.stringify({error:'simulated'}) }] }`;
   assert `await callMCPTool('mock')` throws `MCPClientError` and `(err as MCPClientError).cause?.message`
   contains `'simulated'`. Negative test: same mock returning `{ isError: false, content: [...] }`
   resolves normally. Third test asserts six aidefence handlers in `security-tools.ts` —
   when stubbed to throw inside the handler — all surface as `MCPClientError` thrown out of
   `callMCPTool` (no behavioural regression for the existing throw path).
3. **Site #2 (F-04-010) ride-along** with [[ADR-0238]] Surface 1's docblock rewrite at
   `forks/ruflo/v3/@claude-flow/aidefence/src/index.ts:1-30`. The rewrite per ADR-0238
   must additionally clarify line 8's HNSW claim: explicit sentence scoped to
   `searchSimilarThreats` (e.g. "HNSW-indexed search of previously LEARNED threat
   patterns via `searchSimilarThreats`; detection latency is a fixed regex pass over 50
   patterns, not HNSW-accelerated"). If [[ADR-0238]] Surface 1 lands first, file a one-
   line addendum to that ADR's implementation commit referencing F-04-010. If THIS ADR
   lands first, [[ADR-0238]] Surface 1's confirmation gate inherits the additional
   literal-text assertion (see Validation below). Commit per
   `[[feedback-commit-forks-before-release]]`.
4. **Site #3 (F-04-011) fork-only backoff** in
   `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/security-tools.ts:28,74,77,120-127`.
   Rename `installAttempted: boolean` → `installAttemptedAt: number | null` at `:28`.
   Change the gate at `:74` from `if (installAttempted)` to
   `if (installAttemptedAt && Date.now() - installAttemptedAt < 5 * 60 * 1000)`. Change
   the set at `:77` from `installAttempted = true;` to `installAttemptedAt = Date.now();`.
   Update the error message at `:120-127` to mention "auto-retry available in N minutes"
   alongside the existing three recovery paths. Behaviour test at
   `forks/ruflo/v3/@claude-flow/cli/__tests__/security-tools-backoff.test.ts` simulates
   an install-fail, asserts a second call within 5 minutes throws the cached error (no
   re-install attempted via spy on `autoInstallPackage`), and a third call with mocked
   `Date.now()` past the window re-enters the install path. Commit per
   `[[feedback-commit-forks-before-release]]`.
5. **F-04-006/F-04-007 deferral tracking**: no code change. The deferral rationale is
   recorded in this ADR's More Information section; future product-bet ADRs (one per
   finding) that pick either up must reference this ADR's deferral text and the
   pre-flight check-2 failure. The audit slice 04 file remains authoritative; both
   findings stay open in the audit-tracker, NOT moved to "won't fix".
6. **INTEGRATION-LEDGER rows** per `[[feedback-update-integration-ledger]]` for sites
   #1, #2 (ride-along — joint row with the [[ADR-0238]] Surface 1 row), and #3. Each
   row: disposition `superseded-by-local`, citing upstream byte-identical source at the
   verified paths (per Upstream Intent below).

### Dependencies

- [[ADR-0238]] (CT-E parent — Surface 1 docblock rewrite) — gates site #2 ride-along.
  The rewrite must extend to clarify line 8's HNSW perf claim per F-04-010; if
  [[ADR-0238]] lands first, file a one-line addendum to its implementation commit; if
  this ADR lands first, [[ADR-0238]] Surface 1's confirmation gate inherits the
  HNSW-scope literal-text assertion.
- [[ADR-0242]] (CT-I sibling — shared error library + server-side MCP envelope honesty)
  — disjoint by artifact (handlers vs `callMCPTool`) and mechanism (throw-vs-return-rule
  vs honor-isError-rule). Site #1 here is the **client-side complement** to ADR-0242's
  server-side rule and is intentionally NOT folded in (DA hook on this resolved 4/5).
- [[ADR-0210]] (stub-honesty envelope mandate) — site #2's HNSW-scope clarification
  inherits ADR-0210's framing-honesty principle (operator over-trust is the harm to fix).
- [[ADR-0233]] §CT-N — defect-class origin citing F-04-006 (HIGH), F-04-007 (HIGH),
  F-04-009 (WARN), F-04-010 (WARN), F-04-011 (NOTE) per slice-04 audit.
- [[ADR-0201]] §Remediation-ADR pre-flight checklist — cleared per-finding (sites
  #1/#2/#3 pass all four checks; #4/#5 fail check 2 and #5 fails check 4, hence the
  deferral).
- F-04-004 (caller-supplied identity in issue-claim handlers) — explicitly out of CT-N
  scope per matrix; bound to ADR-101 federated-claims direction.

### Validation

- **Site #1 source-shape grep**:
  `grep -n "return result as T" forks/ruflo/v3/@claude-flow/cli/src/mcp-client.ts`
  returns zero hits (the unconditional pass-through is gone).
  Positive grep: the `MCPClientError` constructor at the new throw site carries a
  `cause` argument (so the synthetic envelope-text is preserved for downstream
  introspection — addresses Improvement 1 below).
- **Site #1 behavioural acceptance**: behaviour test (step 2) passes; runs in the
  acceptance-tier suite registered via `_run_and_kill` per
  `[[reference-acceptance-runcheck-vs-collect]]`.
- **Site #2 source-shape grep** (joint with [[ADR-0238]] Surface 1):
  `grep -n "HNSW" forks/ruflo/v3/@claude-flow/aidefence/src/index.ts` returns at least
  one line containing the literal substring `searchSimilarThreats` (proves the scope
  clarification landed, not just a generic edit). Belt-and-braces literal-text gate
  per Improvement 2 below.
- **Site #3 source-shape grep**:
  `grep -n "installAttempted" forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/security-tools.ts`
  shows only `installAttemptedAt` (the `boolean` variant gone). Behaviour test (step 4)
  asserts the 5-minute window + re-entry.
- **Deferral-tracking gate** (no code): the slice-04 audit at
  `docs/audits/2026-05-24-second-pass-audit/04-security-aidefence-claims-pii.md` still
  carries F-04-006 + F-04-007; no entry in any "closed" / "won't fix" register; this
  ADR's More Information section is the public deferral pointer.
- No `skip_accepted` per `[[feedback-skip-accepted-as-squelch]]` — the three fixed
  sites have real tests, not skip rationales.

### Top risk + mitigation

- **Risk**: Site #1's behaviour change (from "returns `{isError:true}` envelope" to
  "throws `MCPClientError`") will silently affect any caller in the codebase that today
  destructures `{ safe } = await callMCPTool('aidefence_is_safe', ...)` and treats
  `undefined` as falsy. Per the audit, the two existing smoke scripts
  (`plugins/ruflo-{aidefence,browser}/scripts/smoke.sh`) only check tool registration —
  they will keep passing. But a hidden non-test caller could silently flip from
  fail-open-by-convention to throw, and a `try { ... } catch {}` wrapper around the
  call would re-introduce fail-open. Same "consumer-side discipline" trap that ADR-0242
  is fighting on the server side.
- **Mitigation**: (a) the behaviour test (step 2) covers the structural change; (b) the
  implementation commit message must explicitly flag the behaviour change with the
  literal substring "BEHAVIOUR CHANGE — callMCPTool now throws on `isError:true`" so
  the merge log carries it; (c) for the immediate landing, do a one-shot grep across
  fork callers: `grep -rn "callMCPTool" forks/ruflo/v3/` to enumerate every consumer;
  audit each for swallowing `try/catch` patterns and surface findings in the commit
  message. If any caller silently catches and discards, that's a follow-up F-13-style
  finding tracked separately (don't bundle into this ADR's scope to avoid creep).

---

### Panel composition (per plan §Per-ADR swarm configuration)

- Expert 1 — PII detection coverage specialist (F-04-006 detector mismatch)
- Expert 2 — AIDefence learning-poisoning specialist (F-04-007 unauthenticated negative feedback)
- Expert 3 — MCP isError envelope specialist (F-04-009 `callMCPTool` should honor `isError:true`)
- Expert 4 — Caller-identity specialist (excluded F-04-004 routes to ADR-101; CT-N scope only)
- Expert 5 — Upstream-not-wired tracker (F-04-006/007 deferral rationale)
- Devil's Advocate

### Upstream intent

Upstream is **byte-identical across all three fix sites and both deferred sites**, with
no decision recorded either direction. Verified at fork mirrors on 2026-05-24:

* `/Users/henrik/source/ruvnet/ruflo/v3/@claude-flow/cli/src/mcp-client.ts:173-200` —
  `callMCPTool` carries the same `const result = await tool.handler(input, context); return result as T;`
  shape at line 190-191, with the same try/catch around it. **No `isError` inspection
  upstream either**: the fork-only fix opens divergence in exactly one file. Site #1
  pre-flight check 2 clears: upstream has not decided either way.
* `/Users/henrik/source/ruvnet/ruflo/v3/@claude-flow/cli/src/mcp-server.ts:512-519` —
  the transport wrap also branches only on try/catch (`trackRequest(toolName, true)`
  on resolve, `trackRequest(toolName, false)` on catch) and does NOT detect
  `isError:true` in the resolved envelope. This **confirms** the ADR-0247 disjointness
  claim with [[ADR-0242]]: the server-side wrap is not the right seam (a returned
  envelope still records as success); the client-side `callMCPTool` is. ADR-0247's
  Option C rejection ("fold into ADR-0242") is correct: the two ADRs operate at
  different seams that don't overlap.
* `/Users/henrik/source/ruvnet/ruflo/v3/@claude-flow/aidefence/src/index.ts:1-30` —
  byte-identical to fork; line 8 carries the same `"HNSW-indexed threat pattern search
  (150x-12,500x faster with AgentDB)"` claim. F-04-010 fix rides on [[ADR-0238]]
  Surface 1's divergence already.
* `/Users/henrik/source/ruvnet/ruflo/v3/@claude-flow/cli/src/mcp-tools/security-tools.ts:27-28,74-77,120-127`
  — byte-identical `let installAttempted = false;` + `if (installAttempted)` gate +
  permanent-cache shape upstream. F-04-011 fix opens small divergence in one file.
* `/Users/henrik/source/ruvnet/ruflo/v3/@claude-flow/aidefence/src/domain/services/threat-detection-service.ts:232-263`
  carries the **identical 6-pattern PII regex set** (email, dashed-SSN, credit_card,
  `sk-/sk-ant-` api_key, GitHub PAT, `password=...`) — verified line-for-line.
* `/Users/henrik/source/ruvnet/ruflo/v3/@claude-flow/cli/src/transfer/anonymization/index.ts:17-26`
  carries the **identical 8-pattern PII regex set** (email, phone, ipv4, ipv6, narrower
  `sk-|pk-|api[_-]?key[_-]?` apiKey, jwt, homePath, windowsPath) — verified line-for-line.
  **Upstream operates two disjoint PII detector sets in two packages and has NOT
  consolidated them.** F-04-006 deferral rationale (upstream-not-wired) is solid.
* `/Users/henrik/source/ruvnet/ruflo/v3/@claude-flow/cli/src/mcp-tools/security-tools.ts:355-444`
  — the `aidefence_learn` handler is **byte-identical** to fork: `required: ['input', 'wasAccurate']`,
  no auth, no rate-limit, no caller-identity check. **Upstream has NOT authenticated
  `aidefence_learn` either.** F-04-007 deferral rationale (upstream-not-wired AND
  architectural overlap with ADR-0238 Surface 2's deferred `caller_identity` plumbing)
  is solid.

**Key upstream finding (highlight)**: the transport-side wrap `mcp-server.ts:512-519`
demonstrably does NOT detect `isError:true` even upstream — confirming that ADR-0247's
F-04-009 client-side fix is the structurally-correct seam, not a server-side wrap
extension that ADR-0242 might (incorrectly) be expected to deliver. The two ADRs target
disjoint protocol seams and both are needed; folding F-04-009 into ADR-0242 would
miss the actual location of the defect.

### ADR-180+ alignment

* **[[ADR-0238]] (CT-E parent)** — direct sibling. Surface 1 (F-04-001 + F-04-005 +
  F-04-008) owns the docblock-rewrite that F-04-010 rides on; Surface 2 (F-04-003)
  deferred `caller_identity` plumbing for claims RBAC central-dispatch, which is the
  same architectural prerequisite F-04-007 fails check 4 on. **Direct alignment**: the
  deferral rationale for F-04-006/F-04-007 here matches Surface 1/2's calculus
  (upstream-not-wired + fork-only fix = perpetual merge tax for a security boundary
  upstream chose not to enforce). No double-jeopardy: F-04-006/F-04-007 are NAMED in
  ADR-0238's "Out of scope" block, NOT silently dropped.
* **[[ADR-0242]] (CT-I sibling — shared error library + MCP envelope honesty)** —
  disjoint by artifact and mechanism (confirmed by upstream-intent analysis above).
  ADR-0242 owns the **handler-side rule** ("MCP handlers must let fatals throw, not
  catch and return `{success:false}`"); this ADR owns the **client-side helper-rule**
  (`callMCPTool` must honor `isError:true` envelopes that handlers honestly emit).
  ADR-0242's arch-test target ("MCP handler fatals throw, not return-envelope") would
  NOT catch the F-04-009 defect (aidefence handlers already throw via the wrap; they
  set `isError:true` honestly on caught internal errors); ADR-0247's `callMCPTool`
  inspection rule would NOT catch the ~56 handlers that catch-and-return ADR-0242
  targets. Both rules are needed. **No fold.**
* **[[ADR-0210]] (stub-honesty envelope mandate)** — site #2's HNSW-scope clarification
  is a direct application of ADR-0210's framing-honesty principle (the "operator
  over-trust" pattern). No conflict; this ADR ride-alongs on [[ADR-0238]] Surface 1's
  ADR-0210-compliant docblock rewrite.
* **[[ADR-0233]] §CT-N** — this ADR is the proposed second-pass remediation track for
  the five CT-N findings; matches the matrix recommendation Option B-extended (own
  some, defer others) verbatim.
* **[[ADR-0201]] §Remediation-ADR pre-flight checklist** — the ADR carries the
  per-finding checklist application in §Pre-flight verification (one of the most
  thorough pre-flight sections of any CT-* ADR per the panel). The four-check pattern
  flipped 0207/0208/0209/0210 on the first-pass remediation work; here it provides
  the explicit reasoning that distinguishes "fix this" (sites #1/#2/#3 pass all 4 checks)
  from "defer this" (sites #4/#5 fail check 2 and #5 fails check 4).

### Critique outcomes

| Expert | Critique | Vote | Adopted? |
|---|---|---|---|
| E1 (PII coverage) | The F-04-006 deferral is structurally correct (upstream-not-wired + fork-only fix = merge tax for a security boundary upstream chose not to centralize), but the deferred state leaves a documented gap that operators reading `aidefence_has_pii` / `transfer_detect-pii` descriptions may still over-trust. The deferral text in the ADR's More Information section is honest but downstream operator-facing prose (the [[ADR-0238]] Surface 1 docblock rewrite) should also extend to the `aidefence_has_pii` tool description (not just the package docblock). | amend | **NOT ADOPTED (out of scope)** — the deferred-finding text already says exactly this in Consequences §Negative ("F-04-006 deferral leaves PII coverage gaps documented but unfixed... ADR-0238 Surface 1's docblock rewrite reframes aidefence as a 'manual scan utility'; this ADR documents the gap so future ADR-0238-style framing-honesty work can extend to the `aidefence_has_pii` description"). The "extend Surface 1 to the per-tool description" is a separate scope decision that [[ADR-0238]] (not this ADR) owns; bundling it would re-open Surface 1's already-converged scope. E1 votes **adopt** the ADR; the critique is filed as forward-pointer for [[ADR-0238]] re-amendment if its docblock rewrite ever touches the per-tool description layer. |
| E2 (learning-poisoning) | The F-04-007 deferral correctly identifies the `caller_identity` plumbing prerequisite, but defers without proposing ANY interim mitigation. Today an MCP caller can pollute `searchSimilarThreats` rankings + `getBestMitigation` selection (per audit) and the only mitigation cited is "operators are told the surface is opt-in / manual scan utility". That's framing, not a mitigation. The ADR should at minimum propose a per-process rate-limit on `aidefence_learn` (e.g., 100 calls per minute) that doesn't require `caller_identity` plumbing — that's a small fork-only fix in one file, structurally similar to the F-04-011 backoff fix this ADR adopts. | amend | **NOT ADOPTED (scope-aligned defer)** — E2's critique has merit but adds a fourth fix-site to an ADR explicitly scoped as "own three, defer two". The per-process rate-limit IS a small fix, but it (a) doesn't address the audit's specified threat shape (which is "an adversarial caller systematically poisons rankings" — a low-volume sustained attack, not a high-volume burst), (b) creates a false sense of mitigation that may delay the real `caller_identity` work, (c) re-opens this ADR's structural decision (Option D, which the matrix endorsed). E2's critique is **logged in the Risk section** as a possible follow-up if the `caller_identity` work fails to materialize within a reasonable horizon, but not folded into this ADR. E2 votes **adopt** the ADR. |
| E3 (isError envelope) | The site #1 fix description says "throw `new MCPClientError(...)` (same `MCPClientError` constructor used for thrown exceptions at lines 182-186)". But the existing constructor at `:194-198` takes `(message, toolName, cause?: Error)`. The synthetic throw on `isError:true` won't have a real `cause: Error` — it's a serialised envelope. The fix needs to either (a) pass `undefined` and lose the structured trace, or (b) synthesise an `Error` from the extracted envelope text so downstream consumers can do `(err as MCPClientError).cause?.message` introspection. The ADR is silent on which. | amend | **ADOPTED** — option (b) wins (synthesise an `Error` from the extracted `content[].text` body, pass as `cause`). Captured in Implementation Step 1 + Validation Step 1 (positive grep for `cause` argument at the new throw site). Improvement 1 below. |
| E4 (caller-identity) | The "explicitly excluded F-04-004" framing is correct (CT-N scope = the five remaining findings; F-04-004 routes to ADR-101). The Pre-flight §F-04-007 explanation re-derives the `caller_identity` plumbing prerequisite from first principles, but doesn't say explicitly that F-04-007 + F-04-003 (Surface 2) + F-04-004 ALL wait on the same architectural decision — leaving the impression that each is independent. The Out-of-scope items section names them separately, but doesn't bind them. | amend | **NOT ADOPTED (scope-aligned defer)** — E4's critique is correct, but binding three findings into one prerequisite chain would expand this ADR's "More information" section by ~1 paragraph that effectively re-states [[ADR-0238]] Surface 2's calculus. The deferred-row "deferred to `caller_identity` direction (joint with F-04-003 / F-04-004 / ADR-101)" already does this binding in the table at line 124 of the ADR. Sufficient. E4 votes **adopt**. |
| E5 (upstream-not-wired) | The Option D rationale is structurally sound, but the pre-flight check 2 analysis for F-04-006 leans on "upstream chose not to centralize" as the deferral pivot. Verified at upstream: the two PII detectors ARE byte-identically present in two packages with disjoint pattern sets, AND upstream has had this state for at least 3 release cycles per the corpus rule [[feedback-corpus-evidence-before-feature-work]]. The deferral is correct AND the rationale should explicitly cite the "we've watched upstream for ≥3 cycles and the disjoint-detector state is stable" evidence to pre-empt a future "but maybe upstream is about to consolidate" debate. | amend | **NOT ADOPTED (already implicit)** — E5's evidence is captured in the More Information section's framing ("upstream has NOT unified them; consolidating to a single package is a fork-only refactor"). Adding the "≥3 release cycles" assertion would require timestamping every upstream observation and creates a maintenance burden (when do we re-check? what counts as a cycle?). E5 votes **adopt** the ADR; the "stable state" framing is already structurally present. |
| DA | **Challenge 1**: "F-04-006/007 deferred = forever-deferred; force the issue this cycle." The deferral rationale is internally coherent but every deferred-with-rationale ADR in the corpus carries the same shape, and these accumulate. F-04-007 in particular is a HIGH-severity unauthenticated-poisoning vector; the ADR's mitigation is "the package is opt-in" — that's not a mitigation, it's a documentation note. At minimum, demand the per-process rate-limit (E2's amendment) be folded in, OR commit to a hard timebox: F-04-007 must be addressed in next release cycle (X+1) regardless of whether `caller_identity` plumbing exists. Otherwise this is the slow drift the [[feedback-skip-accepted-as-squelch]] memory warned against. | challenge | **HOLD (principled dissent)** — Quorum: 4/5 votes to defer F-04-007 per ADR's stated rationale. The DA's framing is acknowledged: the deferral pattern IS a slow drift, and "track openly via audit slice" is structurally weaker than a hard timebox. **Counter**: the audit slice 04 file is durable evidence that F-04-007 is NOT closed; any future cycle's CT-* triage will re-encounter it and the deferral rationale will be re-evaluated against then-current upstream state. Building the rate-limit fix on top of an opt-in surface that may never be wired is itself a slow-drift pattern in the opposite direction (security theatre that delays the real `caller_identity` work). DA's principled dissent is **recorded** but does NOT block the Decision. |
| DA | **Challenge 2**: "Folding F-04-009 into [[ADR-0242]] (CT-I) would consolidate envelope-honesty concerns rather than duplicate." The two ADRs both target MCP envelope honesty; running them as separate cycles risks the client-side fix (this ADR) landing first with no behavioural-test infrastructure that ADR-0242 might want to share, or ADR-0242's shared-error-library not being available when this ADR's `MCPClientError` synthesis lands. Better to fold and converge. | challenge | **REJECTED (4/5)** — Upstream-intent analysis above CONFIRMS the two seams are disjoint and both broken: `mcp-server.ts:512-519` (upstream) wraps only `try/catch` and does NOT detect `isError`; `mcp-client.ts:173-200` (upstream) returns `result as T` without inspection. Folding would either (a) blur ADR-0242's "handlers must throw" message by adding a "and also clients must inspect" rider that operates at a different seam, OR (b) couple this ADR's one-file surgical fix to ADR-0242's multi-cycle adoption timeline (ADR-0242 is explicitly long-term per its Status). The disjointness analysis in this ADR's Pre-flight §F-04-009 check 4 is structurally correct. DA acknowledges the upstream finding **persuasive** and withdraws Challenge 2 explicitly. |

### Devil's Advocate final position

**Withdraws Challenge 2** (folding F-04-009 into ADR-0242) — the upstream finding that
`mcp-server.ts:512-519` does NOT detect `isError:true` confirms the two ADRs operate at
disjoint seams and folding would either dilute ADR-0242's handler-side message or
couple this ADR's one-file fix to ADR-0242's long-term cadence. **Holds principled
dissent on Challenge 1** (F-04-007 forever-defer risk) — acknowledges the panel's vote
on the defer-with-tracking pattern is correct under the corpus rule against
fork-only-fix merge-tax against an upstream-not-wired security boundary, but flags for
the record that the deferral pattern is structurally indistinguishable from
[[feedback-skip-accepted-as-squelch]] drift. Notes the audit slice 04 file is the
durable tracker; if a future CT-* triage cycle re-encounters F-04-007 and the deferral
rationale is re-rubber-stamped without re-examining whether `caller_identity` plumbing
has emerged, that's the harm shape this dissent warns against. Does NOT block the
Decision. Quorum carried 4/5 for the ADR as drafted with two clarifying improvements.

### Improvements adopted

1. **`MCPClientError.cause` chain preserved on `isError:true` throw** (Implementation
   Step 1 + Validation Step 1) — synthesise an `Error` from the extracted
   `content[].text` body and pass as `cause` to `MCPClientError`, so downstream
   `(err as MCPClientError).cause?.message` introspection works the same way it does
   for real-error throws at the existing `:182-186` branch. Captured by positive grep
   on the new throw site.
2. **Site #2 literal-text Confirmation gate** — joint with [[ADR-0238]] Surface 1's
   confirmation gate, add a literal-substring assertion that the rewritten line 8
   contains the literal string `searchSimilarThreats` (proves the HNSW-scope
   clarification per F-04-010 landed, not just a generic docblock edit). Belt-and-
   braces against the docblock rewriter silently omitting the F-04-010 ride-along.
3. **E2's per-process rate-limit critique** logged in the Risk section as a possible
   follow-up if the `caller_identity` work fails to materialize within a reasonable
   horizon. Not folded into this ADR (would expand scope from 3 fix-sites to 4 and
   re-open Option D's structural decision). Captured in the Top risk + mitigation
   paragraph above.
4. **DA principled-dissent recorded** on the F-04-006/007 deferral pattern being
   structurally indistinguishable from slow drift — the audit slice 04 file is the
   durable tracker; any future CT-* triage cycle that re-encounters either finding
   must re-examine `caller_identity` plumbing emergence before re-deferring.

### Confirmation amendments (folded into the Decision section above)

The Confirmation gate set for the three fix-sites now reads:

* **Site #1**: source-shape grep
  `grep -n "return result as T" forks/ruflo/v3/@claude-flow/cli/src/mcp-client.ts`
  returns zero hits; positive grep at the new throw site shows the `MCPClientError`
  constructor receives a third argument (the synthetic `cause: Error`); behaviour
  test asserts `(err as MCPClientError).cause?.message` contains the simulated
  envelope text.
* **Site #2**: joint with [[ADR-0238]] Surface 1's confirmation gate —
  `grep -n "HNSW" forks/ruflo/v3/@claude-flow/aidefence/src/index.ts` returns at
  least one line containing the literal `searchSimilarThreats` substring.
* **Site #3**: source-shape grep
  `grep -n "installAttempted" forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/security-tools.ts`
  shows only `installAttemptedAt` (the `boolean` variant gone); behaviour test
  asserts the 5-minute backoff window + re-entry path.
* **Sites #4 + #5 (deferred)**: no code gate; documentary acceptance via the audit
  slice 04 file remaining authoritative and this ADR's More Information section
  carrying the explicit deferral rationale (per ADR's existing text).
