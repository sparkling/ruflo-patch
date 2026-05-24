# 04 — Security: AIDefence (AIMDS) + claims authorization + PII detection audit

**Parent**: G-16-005 [HIGH] from `docs/audits/2026-05-19-soundness-audit/16-gap-analysis.md`
**Scope**: aidefence package + the 6 `aidefence_*` MCP tools, claims authorization (ADR-016 issue claims + the parallel `claims` RBAC command), PII detection (`aidefence_has_pii`, `transfer_detect-pii`, `pii-detector` agent), prompt-injection detection wiring.

## Summary

- Sources audited: `forks/ruflo/v3/@claude-flow/aidefence/src/` (467+412 LOC),
  `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/security-tools.ts` (561 LOC),
  `claims-tools.ts` (1,014 LOC), `commands/claims.ts` (RBAC), the 9 claims handlers in
  `forks/agentdb/src/archivist/handlers/claims/`, `transfer/anonymization/index.ts`,
  `browser-session-tools.ts`. Callsite grep across all 327 MCP tool handlers + plugins.
- Findings: **11 total / 3 critical / 4 high / 3 warning / 1 note**
- Soundness verdict: **FAIL** — security surfaces exist as *callable APIs* but are
  not invoked at any production input boundary. The aidefence ADR's "3-gate pattern"
  is prose-only; ZERO non-test callsites for any `aidefence_*` MCP tool exist anywhere
  in the codebase (F-04-001). The CLI `claims check` permission system has a
  fail-open default catch (F-04-002) AND is never consulted by `callMCPTool`
  (F-04-003). Issue claims accept unverified claimant identity strings (F-04-004).
- Completeness verdict: **PARTIAL** — the detection logic *itself* (regex
  patterns) is honest, deterministic, and reasonable for what it covers. The
  PII pattern list has gaps (no SSN-no-dashes, no addresses, inconsistent with
  the parallel `transfer/anonymization` set — F-04-006), and the "AIDefence
  uses a learned model" framing in the README and agent docs is misleading —
  it's regex + rule-based, no model load, no fail-load posture decision (F-04-005).
- Bottom line: the project ships **the security observability of a calculator**:
  you can ask the calculator whether `2+2=safe`, but nothing makes you ask
  before adding the number. Compounding this, the one place an attacker
  could exfiltrate signal (the unauthenticated `aidefence_learn` MCP tool)
  can pollute mitigation rankings (F-04-007).

## Method

- Located all security-surface code via filename search (`*aidefence*`, `*pii*`,
  `*claims*`, `*injection*`) under `forks/ruflo/v3/@claude-flow/`, `forks/ruflo/plugins/`,
  `forks/agentdb/src/`.
- For each MCP tool family (`aidefence_*`, `claims_*`, `transfer_detect-pii`),
  read the handler, traced its delegate (defender, archivist dispatch, file load),
  and asked four questions per the audit brief:
  1. Is the security check actually invoked at any input boundary, or is it API-only?
  2. What's the fail-mode (open/closed) for load failures and runtime errors?
  3. Does the handler authenticate its caller's claimed identity?
  4. Are there silent-fallback / dishonest-envelope / log-but-don't-reject patterns?
- Grep for callsites: `grep -rn "aidefence_scan\|aidefence_is_safe\|aidefence_has_pii"
  cli/src plugins/` (excluding security-tools.ts, smoke tests, .md docs) — confirmed
  zero programmatic callers outside the 6-tool registration in security-tools.ts.
- Checked the central MCP dispatch (`mcp-client.ts:callMCPTool`) for any
  pre-invocation security hook (claims check, PII pre-scan, prompt-injection
  pre-scan, rate limit). None present.
- Checked the archivist dispatch (`forks/agentdb/src/archivist/index.ts:dispatch`)
  for access control on mutation handlers. None present beyond
  `hasRealConfig` (init guard) and `getRegistration` (tool-name lookup).
- Read the canonical-contract ADRs (`ADR-022-aidefence-integration.md`,
  `plugins/ruflo-aidefence/docs/adrs/0001-aidefence-contract.md`,
  `ADR-016-collaborative-issue-claims.md`, `ADR-101-federated-claims.md`)
  to compare contract vs implementation.
- Verified the cookie vault claim in `browser-session-tools.ts:323` ("value blob
  includes a vault_handle, expiry, aidefence_verdict") by grepping for writers
  that actually set `aidefence_verdict`. None found.

## Per-surface roll-up

| Surface | Tools | Posture | Wired at input boundary? | Verdict |
|---|---|---|---|---|
| **aidefence runtime** (`security-tools.ts`) | 6 MCP tools | regex + rule-based, NOT model-load. Errors return `isError:true` (not fail-open by transport, but `isError` is never inspected by callers). | NO — opt-in only via direct MCP call | API present, never used |
| **PII detection (aidefence)** | `aidefence_has_pii` | 6 regex patterns (email, SSN-with-dashes, CC, sk-/sk-ant-/ghp_, password=…) | NO — not called by `memory_store` / `agent_spawn` / `task_create` / any boundary | gaps exist, never invoked |
| **PII detection (transfer)** | `transfer_detect-pii` | 8 different regex patterns (email, phone, ipv4, ipv6, narrower api_key, jwt, paths) | NO — only invoked by an `export` flow inside the transfer system | parallel set with gaps vs aidefence |
| **Prompt-injection** | `aidefence_scan` `quickScan` | 50+ regex patterns | NO — not called by any LLM input path | API present, never used |
| **Claims (workflow coordination)** | 10 `claims_*` MCP tools | Structural string compare of `formatClaimant(stored) !== formatClaimant(payload)` | identity check IS performed | weak — identity is unverified caller-supplied string |
| **Claims (RBAC permission system)** | `claude-flow claims check/grant/list` CLI | role+claim policy, wildcard match | NOT consulted by any MCP tool / `callMCPTool` dispatch | dead — orchestration-only |
| **claims authorization on dispatch** | `archivist.dispatch()` | none | n/a | absent |
| **Federated claims (ADR-101)** | proposed Ed25519+HMAC envelopes | designed | not implemented in local fork; cross-node only | out-of-scope here |
| **`aidefence_learn` poisoning** | `aidefence_learn` | accepts unauthenticated `wasAccurate=false` | inputs flow into `effectiveness` + `falsePositiveCount` for mitigation ranking | exploitable signal poisoning |

## Findings

### F-04-001 [CRITICAL] AIDefence MCP tools have zero non-test callers — the "3-gate pattern" is documentation, not enforcement

- **Locations**:
  - `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/security-tools.ts:135,220,306,358,453,508`
    (the 6 registered tools).
  - `forks/ruflo/plugins/ruflo-aidefence/docs/adrs/0001-aidefence-contract.md:36-44`
    (the "3-gate pattern" ADR — `aidefence_has_pii` pre-storage, `aidefence_scan`
    sanitization, `aidefence_is_safe` for content flowing back to an LLM).
  - `forks/ruflo/v3/@claude-flow/cli/src/mcp-client.ts:161` (the central
    `callMCPTool` dispatch — no pre-invocation security hook).
- **Threat**: Comprehensive grep across `forks/ruflo/v3/@claude-flow/cli/src`,
  `forks/agentdb/src`, and `forks/ruflo/plugins/` for callers of any
  `aidefence_*` tool name yields **only** the registration in `security-tools.ts`
  and references in `scripts/smoke.sh` (2 plugin smoke scripts). NO MCP tool
  handler, no `callMCPTool` callsite, no `archivist.dispatch` path, no plugin
  runtime calls aidefence before processing user input. Specifically verified
  unguarded:
  - `memory_store` (memory-tools.ts:195) writes user-supplied value with
    length validation only — `validateMemoryInput()` checks size, not content.
  - `agent_spawn`, `task_create`, all 30 tool categories — no aidefence call.
  - `browser_cookie_use` (browser-session-tools.ts:323) advertises the
    contract "value blob includes a vault_handle, expiry, aidefence_verdict"
    but performs no check that the verdict is present, and no writer in the
    codebase actually attaches such a verdict (`grep -rn aidefence_verdict`
    yields exactly the one read-side comment).
  - The `pii-detector` agent definition (`.claude/agents/v3/pii-detector.md`)
    is a prose description telling the LLM to detect PII — no system-level
    wiring forces the scan.
- **Impact**: AIDefence is a tool the agent can voluntarily call but is never
  forced to. The "defence-in-depth" ADR (`plugins/ruflo-aidefence/docs/adrs/0001`)
  prescribes pre-storage / sanitization / prompt-injection gates; the gates
  exist only as MCP tools the agent must remember to invoke. This is the
  May-19 dishonest-envelope pattern at the **package** level: the README
  promises "AI Manipulation Defense System with self-learning capabilities";
  in production, no defense executes unless an LLM explicitly calls it.
  Operator-side, **none** of the integrity guarantees the README claims are
  observable at runtime (no audit log of "aidefence ran before write X").
- **Recommendation**: Either (a) wire `aidefence_is_safe(value)` into
  `memory_store` before substrate.withWrite (and `aidefence_has_pii` into the
  same path with redact-or-reject policy), and `aidefence_is_safe(query)` into
  `memory_search` before vector search dispatch, OR (b) downgrade the
  package and ADR docs to "manual scan utility" so the contract matches.
  The current state — package framed as defense-in-depth, runtime is
  scan-on-demand — is the soundness gap.

### F-04-002 [CRITICAL] `commands/claims.ts:268-271` `check` command falls back to permissive default on error

- **Location**: `forks/ruflo/v3/@claude-flow/cli/src/commands/claims.ts:266-271`.
- **Threat**: The RBAC check action wraps policy loading in `try { … }` and
  on **any** exception (file missing, corrupt JSON, malformed user record,
  filesystem error) defaults to `isGranted = !claim.startsWith('admin:')` —
  i.e. every non-`admin:*` claim is GRANTED. Reason logged as "Granted
  (default permissive policy)".
- **Evidence** (lines 265-271):
  ```ts
  } catch (error) {
    spinner.stop();
    // On error, fall back to permissive default
    isGranted = !claim.startsWith('admin:');
    reason = isGranted ? 'Granted (default permissive policy)' : 'Admin claims require explicit grant';
    policySource = 'fallback';
  }
  ```
- **Impact**: Pattern-match with the May-19 audit's "silent fallback when X
  fails returns 'safe'" exact pattern. A user who has correctly *denied*
  `swarm:create` to user `bob` in `claims.json` will see `claims check -c
  swarm:create -u bob` return `GRANTED` if the file becomes unreadable (e.g.
  permission flip, truncation, edit in progress). Compounded by F-04-003
  (the check is never consulted anyway), but the explicit fail-open code is
  an independent red flag.
- **Recommendation**: Remove the permissive-default branch. On error, `return
  { success: false, exitCode: 1 }` with a structured "policy-evaluation
  failed" message. Fail-closed: an unreadable policy file blocks the action;
  the caller must repair or explicitly override.

### F-04-003 [CRITICAL] Central MCP dispatch performs no claims/permission check

- **Locations**:
  - `forks/ruflo/v3/@claude-flow/cli/src/mcp-client.ts:161-188` (`callMCPTool`).
  - `forks/agentdb/src/archivist/index.ts:828-858` (`archivist.dispatch`).
- **Threat**: The RBAC command (`claims check`) is plumbing without
  consumers. The central dispatch path inspects:
  - Tool-name lookup (`TOOL_REGISTRY.get(toolName)`)
  - Handler invocation
  - Error wrapping
  And NOTHING else. The archivist dispatch checks `hasRealConfig`,
  `getRegistration`, and `lookup.kind`. Neither path consults:
  - Any per-tool claim requirement
  - The caller's user identity (no concept of caller exists)
  - The `commands/claims.ts` permission policy
  - The aidefence scanner for malicious payloads
  Confirmed via `grep -rn "checkClaim\|hasPermission\|isGranted\|grantedClaims\|claimsConfig\|aidefence" cli/src/mcp-tools/` → no hits.
- **Impact**: The audit prompt asks "Are claims actually CHECKED, or is the
  API present but bypassed at call sites?" Answer: **the API is present and
  bypassed at every call site**. ADR-016 only describes ISSUE claims (who
  works on what); `commands/claims.ts` is a parallel, undocumented
  permission system invented in the CLI command shell. Neither is enforced
  at the MCP tool boundary. Any MCP caller can invoke `agent_spawn`,
  `swarm_init`, `memory_store`, `task_create` regardless of "policy".
- **Recommendation**: Decide intent. If RBAC is desired, plumb a
  `caller_identity` into `MCPCallContext` and gate every mutating handler
  through `claimsConfig` evaluation at the top of `callMCPTool`. If RBAC is
  not desired, delete `commands/claims.ts` and the documentation that
  implies it does anything. Half-implemented authorization is worse than
  none, because it ships with the appearance of a security boundary.

### F-04-004 [HIGH] Issue-claims handlers perform structural string-equality identity check on caller-supplied identity

- **Locations**:
  - `forks/agentdb/src/archivist/handlers/claims/release.ts:43`
    (`formatClaimant(claim.claimant) !== formatClaimant(payload.claimant)`)
  - `forks/agentdb/src/archivist/handlers/claims/handoff.ts` (same pattern)
  - `forks/agentdb/src/archivist/handlers/claims/accept-handoff.ts` (same)
  - `forks/agentdb/src/archivist/handlers/claims/steal.ts:44-54` (no identity
    check at all — only `preferredTypes` filter)
  - `forks/agentdb/src/archivist/handlers/claims/claim.ts:81-115` (accepts
    any claimant identity at first claim)
- **Threat**: A `Claimant` is `{ type, userId, name }` or `{ type, agentId,
  agentType }` — these are caller-supplied strings. The "only the current
  claimant can release" check is:
  ```ts
  if (formatClaimant(claim.claimant) !== formatClaimant(payload.claimant)) {
    throw new Error(`claims_release: only the current claimant can release`);
  }
  ```
  An attacker (or a confused agent) who knows the current claimant's
  `agentId:agentType` (visible via `claims_list` / `claims_board`, both
  unauthenticated read tools) can release/handoff/transfer any claim. There
  is no signed token, no session credential, no caller identity binding.
  `claims_steal` doesn't even attempt identity binding for the stealer.
- **Impact**: Anyone who can call `claims_release` (i.e., anyone with MCP
  access) can take work away from any other claimant by impersonating their
  identity tuple. The system reads as "first-mover trust" — once Alice
  claims issue 42, Bob can release it on her behalf by calling
  `claims_release({ issueId: '42', claimant: { type: 'human', userId: 'alice', name: 'Alice' } })`.
  The ADR-101 federated claims design proposes Ed25519+HMAC envelopes
  precisely to fix this (cross-node), but the LOCAL handlers have no
  equivalent. The TODO comments at the top of each handler ("port the CLI
  body") confirm this is the design — not an oversight.
- **Recommendation**: At minimum, bind issue-claim ownership to a
  process-stable opaque token (PID-bound or session-bound), and require
  callers of release/handoff/steal to present a token matching the stored
  one — not a free-form identity string. Long-term, adopt the ADR-101
  envelope scheme locally so the local/federated stories share one identity
  primitive.

### F-04-005 [HIGH] AIDefence is regex+rules, not a model — README/agent docs frame it as a learned model and create false expectations

- **Locations**:
  - `forks/ruflo/v3/@claude-flow/aidefence/src/index.ts:1-30` (README-style
    docblock: "AI Manipulation Defense System with self-learning
    capabilities", "HNSW-indexed threat pattern search (150x-12,500x faster)").
  - `forks/ruflo/v3/@claude-flow/aidefence/src/domain/services/threat-detection-service.ts:36-263`
    (50 inline regex patterns + 6 PII regexes — the entirety of the
    detection logic; no `await` for model load, no inference).
  - `forks/ruflo/plugins/ruflo-aidefence/agents/safety-specialist.md:6`
    ("specialist for threat detection, PII scanning, and adaptive defense training").
- **Threat**: The "AIMDS"/"AI Manipulation Defense" framing implies a
  learned detector that could fail-load (no model file, GPU unavailable,
  corrupt weights). Audit found NONE of that — every threat is a hardcoded
  regex match, every PII type is a hardcoded regex. Self-learning only
  affects `searchSimilarThreats` ranking + `getBestMitigation` recommendation
  (a separate `ThreatLearningService` that uses a VectorStore). The
  detection itself is deterministic and synchronous (no `await` in
  `detect`). On the **upside**: there is no fail-load risk (the audit
  prompt asked about this — answer: none, because there's nothing to load).
  On the **downside**: the framing leads operators to believe they have a
  trained detector when they have a regex bank. Attackers who understand
  this (regex coverage is enumerable from `threat-detection-service.ts:36-227`)
  can engineer around it (paraphrase, encoding, unicode tricks beyond the
  `NFKC` normalization).
- **Impact**: Operator over-trust. The May-19 audit's "dishonest envelope"
  pattern at the framing layer: the package presents an evolved-defender
  story; the implementation is what you'd write in an afternoon. Combined
  with F-04-001 (never wired at input boundaries), the gap between
  expectation and reality is large.
- **Recommendation**: Rewrite the docblock + plugin README to be honest:
  "rule-based regex detector with 50 prompt-injection patterns and 6 PII
  patterns; pattern coverage and limitations enumerated at
  `threat-detection-service.ts:36-263`. Pattern-search/mitigation ranking
  has a learning layer; detection itself is fixed rules." Either land a
  real model+inference path or stop marketing one.

### F-04-006 [HIGH] PII coverage gaps + inconsistency between aidefence and transfer-anonymization detectors

- **Locations**:
  - `forks/ruflo/v3/@claude-flow/aidefence/src/domain/services/threat-detection-service.ts:232-263`
    (6 patterns: email, SSN-with-dashes, credit_card, OpenAI/Anthropic
    api_key, GitHub PAT, `password=...`).
  - `forks/ruflo/v3/@claude-flow/cli/src/transfer/anonymization/index.ts:17-26`
    (8 patterns: email, phone, ipv4, ipv6, narrower `api_key` (`sk-|pk-|api[_-]?key[_-]?`),
    jwt, homePath, windowsPath).
- **Threat**: The two PII detectors implement DIFFERENT coverage, and the
  `plugins/ruflo-aidefence/docs/adrs/0001-aidefence-contract.md` 3-gate
  pattern routes pre-storage to `aidefence_has_pii` but outbound transfer
  through `transfer_detect-pii`. A value scanned at one gate is not
  necessarily caught at the other.
  - **aidefence misses**: phone numbers (US or international), ipv4/ipv6,
    JWT tokens, file paths leaking usernames, addresses.
  - **transfer-anonymization misses**: SSN (any format), credit card
    numbers, OpenAI/Anthropic-specific api key prefixes
    (`sk-ant-` not covered by `sk-|pk-|api[_-]?key[_-]?` because that requires
    a `[a-zA-Z0-9]{20,}` tail right after the prefix — `sk-ant-` has dashes),
    GitHub PATs, `password=...`.
  - **Both miss**: physical addresses, IBAN, full names in context, MAC
    addresses, AWS access keys (`AKIA...`), Stripe keys (`sk_live_...`),
    private SSH keys (`-----BEGIN ...-----`), passport numbers, driver
    license numbers, IP-like internal hostnames (192.168.x.x, 10.x.x.x).
  - **aidefence's SSN regex** (`\b\d{3}-\d{2}-\d{4}\b`) misses no-dash SSNs
    (`123456789`) and dot-separated (`123.45.6789`).
- **Impact**: The "scan for PII" promise has gaps both detectors share
  (addresses) and gaps each fails at uniquely. Caller-side intent (which
  gate to use) doesn't map to a coherent coverage story. PII patterns in
  README docs that say "emails, SSNs, API keys, passwords, etc." imply
  comprehensive coverage; the code is opinionated and shallow.
- **Recommendation**: Consolidate to ONE PII detector package with an
  enumerated, documented pattern set; the two MCP tools dispatch to the
  same implementation. Add at minimum: AWS keys, Stripe keys, IBAN, no-dash
  SSN, private-key PEM blocks. Document which categories are intentionally
  unsupported. Or accept the limits and rename `aidefence_has_pii` →
  `aidefence_has_obvious_pii` to set expectations.

### F-04-007 [HIGH] `aidefence_learn` accepts unauthenticated negative feedback that pollutes mitigation effectiveness

- **Locations**:
  - `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/security-tools.ts:357-447`
    (`aidefence_learn` MCP tool — accepts `wasAccurate: boolean` from any
    caller, no auth, no rate limit).
  - `forks/ruflo/v3/@claude-flow/aidefence/src/domain/services/threat-learning-service.ts:191-232`
    (handler stores pattern with `effectiveness: 0.2` if `wasAccurate=false`,
    `falsePositiveCount: 1`).
  - Same file, `recordMitigation` (`security-tools.ts:415-421` →
    `threat-learning-service.ts:239`) — decrements mitigation effectiveness
    on `mitigationSuccess=false`.
- **Threat**: An MCP caller can repeatedly call:
  ```ts
  await callMCPTool('aidefence_learn', {
    input: '<a real attack string>',
    wasAccurate: false,           // poison: claim true detection was a false positive
    threatType: 'jailbreak',
    mitigationStrategy: 'block',
    mitigationSuccess: false       // poison: claim 'block' didn't work
  });
  ```
  This:
  1. Stores the real threat pattern with `effectiveness: 0.2` +
     `falsePositiveCount: 1` (visible in `searchSimilarThreats` ranking).
  2. Decrements the `block` mitigation's effectiveness for jailbreaks,
     downranking it in `getBestMitigation` selection.
  Because detection itself is regex-based (F-04-005), this won't disable
  detection. But it WILL pollute the pattern store + mitigation
  recommendation surface, which downstream consumers may treat as ground
  truth.
- **Impact**: Trust-poisoning of an integrity-loadbearing surface with no
  authentication. Worsened by the fact that `aidefence_learn` has no
  rate-limit / no audit-log of feedback origin / no requirement for
  evidence (the `verdict` field is free-form string). An adversarial caller
  can systematically flip mitigation rankings.
- **Recommendation**: At minimum, require `aidefence_learn` to record the
  caller identity in the persisted pattern (and surface it via `aidefence_stats`).
  Rate-limit feedback per caller. Require the `verdict` field to be non-empty
  and explain. Long-term, treat `learnFromDetection` and `recordMitigation` as
  PRIVILEGED MCP tools requiring a separate auth gate (the same one F-04-003
  is missing).

### F-04-008 [WARNING] `browser_cookie_use` advertises `aidefence_verdict` contract with no enforcement

- **Locations**:
  - `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/browser-session-tools.ts:306,308,323-329`
    (description: "Raw cookie values are NEVER returned — only the opaque
    handle plus expiry / AIDefence verdict"; comment: "The contract: the
    value blob includes a vault_handle, expiry, aidefence_verdict").
- **Threat**: The tool DESCRIPTION promises an aidefence verdict; the tool
  IMPLEMENTATION reads `memory retrieve --namespace browser-cookies --key <host>`
  and returns the raw `stdout` blob. There is no validation that
  `aidefence_verdict` is actually present in the blob, no validation that
  the verdict is "safe", no rescan-at-read, no rejection if a writer
  bypassed the contract. A `grep -rn aidefence_verdict` across the entire
  repo yields ONLY this read-side comment — no writer attaches a verdict
  anywhere.
- **Impact**: May-19 audit's "dishonest envelope" pattern: documentation
  claims a security property that runtime does not enforce. Operators
  reading the description believe cookies are vetted before vault retrieval;
  the implementation reads whatever is in the keystore.
- **Recommendation**: Either implement the contract (rescan at read; reject
  on missing/unsafe verdict) or remove the misleading description and
  comment. If the writer-side enforcement is "out of scope for cookie_use",
  document the assumption explicitly — currently it reads as a promise.

### F-04-009 [WARNING] `aidefence` error envelope sets `isError:true` but caller path never inspects it

- **Locations**:
  - `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/security-tools.ts:204-211,290-297,342-349,437-444,492-499,536-543`
    (all 6 aidefence tools end with a catch returning `{ isError: true,
    content: [{ text: JSON.stringify({ error: String(error) }) }] }`).
  - `forks/ruflo/v3/@claude-flow/cli/src/mcp-client.ts:178` (`return result as T`
    — does not inspect `isError` on the way out).
- **Threat**: The handler-side discipline is correct (fail-closed on the
  surface: errors surface as `isError`, not as a `safe:true` envelope). But
  `callMCPTool` ignores `isError` and returns the result envelope as `T`.
  Downstream callers must remember to check `isError` themselves. The two
  smoke scripts that reference these tools (`plugins/ruflo-{aidefence,browser}/scripts/smoke.sh`)
  appear to check for tool registration only, not error envelopes.
- **Impact**: Soft fail-open by convention: a caller that uses the standard
  destructuring `{ safe } = await callMCPTool('aidefence_is_safe', ...)`
  will see `safe === undefined` (not `false`) on error — and `if (!safe)`
  branches won't behave as designed, while `if (safe)` will short-circuit
  the same way as a real "unsafe" verdict (treating an undefined as
  falsy). Without an explicit isError discipline at the dispatch layer,
  every consumer reimplements the check, and most won't. Less severe than
  fail-open at the handler, more severe than fail-closed by transport.
- **Recommendation**: Have `callMCPTool` throw an `MCPClientError` when the
  handler returns `isError: true` (the same path it takes for thrown
  exceptions). This gives every caller a consistent failure path. Audit
  every existing consumer that swallows the isError envelope.

### F-04-010 [WARNING] aidefence model framing: "HNSW 150x-12500x faster" is a vector-search claim, not a detection claim

- **Locations**:
  - `forks/ruflo/v3/@claude-flow/aidefence/src/index.ts:8-9` ("HNSW-indexed
    threat pattern search (150x-12,500x faster with AgentDB)").
  - Same file, line 200-205: `searchSimilarThreats` returns `[]` if
    `learningService` is null (which is the default unless
    `enableLearning: true`); when learning IS enabled, the speedup is
    for "search past learned patterns", NOT for the detection-time path.
- **Threat**: Operators reading the speedup claim may assume the regex
  detection itself is accelerated. It isn't; the detection path is a
  for-loop over 50 regexes (`threat-detection-service.ts:289-307`),
  unrelated to HNSW. The speedup applies only to `searchSimilarThreats`
  — a `learningService.searchSimilarThreats(query, options)` call that
  returns past LEARNED patterns. This is useful for incident response /
  pattern enrichment, NOT for the latency budget of the detect path.
- **Impact**: Same family as F-04-005 — framing mismatch. Less severe
  because the false expectation is performance, not coverage.
- **Recommendation**: Clarify the docstring: "HNSW search of past learned
  patterns; detection latency is a fixed regex pass (~5ms/100KB input)".

### F-04-011 [NOTE] `installAttempted` session-cache means aidefence load failure persists for the session

- **Location**:
  `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/security-tools.ts:27-28,74-77`.
- **Threat**: `installAttempted` is a module-level boolean set when the
  first lazy load fails. Subsequent calls in the same MCP-server process
  bypass the retry path and re-throw the "package not available" error.
  This is REASONABLE behavior (avoid install spam) but worth noting: a
  transient npm/registry failure on the first aidefence call permanently
  disables aidefence for that MCP-server-process lifetime. Operators must
  restart the MCP server to recover.
- **Impact**: Low. Restart unblocks. The error message at line 120-127
  correctly lists three recovery paths.
- **Recommendation**: Consider a 5-minute backoff instead of permanent
  cache; or document the restart requirement in the error message.

## Cross-cutting

- **API present, never invoked**: the dominant pattern across this audit
  scope. Both aidefence and the CLI-RBAC `claims` system ship as
  observable APIs (MCP tools, CLI commands) with NO production callsite
  invocation. This is structurally the May-19 audit's "stub-shaped"
  category at a higher level: the *families* are stubs even when individual
  *handlers* are real. Findings F-04-001 + F-04-003 are the headline.
- **Documentation as security**: every security-load-bearing
  invariant is asserted in prose (ADR `3-gate pattern`, agent definition
  `err on the side of caution`, browser-cookie comment `the contract: the
  value blob includes ... aidefence_verdict`) and zero are enforced by
  code. This is the May-19 "dishonest envelope" pattern at the *contract*
  layer. F-04-001 + F-04-005 + F-04-008.
- **Caller-supplied identity treated as authenticated identity**:
  appears in every claims handler (F-04-004) and is the design ancestor of
  F-04-003. Local claims handlers reject impersonation at the structural
  string layer; nothing prevents the string from being any value the
  attacker chooses to send. The federated claims design (ADR-101) solves
  this with Ed25519 envelopes; the local design has no equivalent.
- **Permissive-default fallback** (F-04-002): direct match with the
  May-19 critical anti-pattern. Catch + grant. The auditor-visible signal
  is the comment `// On error, fall back to permissive default`.
- **Self-learning attack surface** (F-04-007): unauthenticated learning
  is a known LLM/security-tool footgun. The poisoning vector here is
  bounded (rankings, not detection) but the lack of authentication
  + audit on `aidefence_learn` is itself the issue.

## Out of scope

- **ADR-101 federated-claims runtime soundness**: the cross-node Ed25519
  envelope verification path was reviewed only at the contract level. The
  TS prototype in `plugin-agent-federation/__tests__/unit/federation-envelope-claims.test.ts`
  was not exercised. Out of scope per slice 04 brief; flag for a federated-
  surface slice.
- **Aidefence test coverage** (`v3/@claude-flow/aidefence/__tests__/threat-detection.test.ts`):
  not read in depth. The audit verified the production source; test
  coverage of regex completeness is a separate question.
- **Plugin marketplace + IPFS transfer auth/signing** (G-16-011 in the
  May-19 gap analysis): the `transfer_*` MCP tool family was audited only
  for `transfer_detect-pii`. Pattern-store download/install paths are
  out-of-scope here.
- **Telemetry of security events**: no `aidefence.detected` /
  `claims.denied` span emission was sought. The G-16-006 telemetry slice
  will cover whether security signals reach observability.
- **`@claude-flow/security` package** (Zod schemas): `validate-input.ts:263-278`
  optionally loads it; the package itself was not audited.
- **`commands/security.ts` CLI** (`v3/@claude-flow/cli/src/commands/security.ts:810+`):
  reviewed only to confirm aidefence load discipline matches the MCP
  tools. The other ~3,000 LOC of the security command family (audit,
  scan-codebase, threat-modeling) is out-of-scope here.
