# 13 — Error taxonomy audit (second-pass slice)

Scope: error classes, error codes, retry policies, swallow/rethrow
discipline across `forks/ruflo`, `forks/agentdb`, `forks/ruvector`,
and `ruflo-patch`. Covers gap **G-16-017 [LOW]** from
`docs/audits/2026-05-19-soundness-audit/16-gap-analysis.md` — the
May-19 audit explicitly skipped it.

Severity calibration: G-16-017 is LOW by the gap analysis. The
findings below are calibrated to that — most are quality / drift
issues, not production blockers. Two findings (F-13-002 and
F-13-005) escalate to MEDIUM because they actively defeat the
project's own `feedback-best-effort-must-rethrow-fatals` and
`feedback-no-fallbacks` rules at high-traffic surfaces.

## Summary

- Total error-class definitions counted: **~108 across all forks**
  - `forks/ruflo`: 81 (across 46 files in `v3/`, including 8 in the
    `gastown-bridge` plugin family and 5 in `agentic-qe`)
  - `forks/agentdb`: 16 (across 7 files in `src/`)
  - `forks/ruvector`: 238 Rust `thiserror` enums (across 126 files
    in `crates/`)
  - `ruflo-patch`: **0**
- Total naked `throw new Error(string)` sites:
  - `forks/ruflo`: **1218** across 337 TS files
  - `forks/agentdb`: **776** across 172 TS files
  - `forks/ruvector`: **9865** `.unwrap()` calls (Rust analog —
    mostly invariant/in-test, but 326 in hot-path `rvf-{node,runtime,kernel}`)
  - `ruflo-patch`: **51** naked throws in `scripts/`
- Modern Node Error-chain API (`{ cause: e }`) usage:
  - `forks/ruflo`: 7 occurrences total, only 2 are true rethrow-chains
    (`controller-registry.ts:38`, `memory-router.ts:979`). The rest
    are unrelated (CLI param schema, comments).
  - `forks/agentdb`: 8 occurrences, only 1 is a true rethrow-chain
    (`GraphDatabaseAdapter.ts:163`).
- Findings: 9 total / 0 critical / 2 medium / 6 warning / 1 note
- Severity calibration: this slice is LOW per gap-analysis. Findings
  are flagged for "actually bites in practice" rather than completeness.

### Per-package error-class density (TS only)

| Package (top throws) | naked `throw new Error()` | Error classes defined |
|---|---|---|
| `forks/ruflo/v3/.../plugins` | 399 | 30+ (mostly in 2 plugins) |
| `forks/ruflo/v3/.../cli` | 288 | 13 |
| `forks/ruflo/v3/.../swarm` | 81 | 0 |
| `forks/ruflo/v3/.../memory` | 63 | 4 |
| `forks/ruflo/v3/.../guidance` | 50 | 0 |
| `forks/ruflo/v3/.../shared` | 47 | 2 (incl. duplicate MCPServerError) |
| `forks/ruflo/v3/.../mcp` | 40 | 1 (duplicate MCPServerError) |
| `forks/ruflo/v3/.../claims` | 38 | 5 |
| `forks/ruflo/v3/.../integration` | 33 | 1 |
| `forks/agentdb/src/services/enhanced-embeddings.ts` | 34 | 0 |
| `forks/agentdb/src/quantization/vector-quantization.ts` | 34 | 0 |
| `forks/agentdb/src/backends/ruvector/RuVectorBackend.ts` | 23 | 1 (ProofDeniedError) |
| `forks/agentdb/src/backends/postgres/PostgresBackend.ts` | 23 | 0 |
| `forks/agentdb/src/backends/rvf/RvfBackend.ts` | 16 | 0 |

## Findings

### F-13-001 [WARNING] Two parallel retry libraries exist; neither is widely used; ad-hoc retry loops dominate

- **Location:**
  - Library A: `forks/ruflo/v3/@claude-flow/shared/src/resilience/retry.ts` (exports `retry`, `RetryError`, `RetryableErrors`)
  - Library B: `forks/ruflo/v3/@claude-flow/cli/src/production/retry.ts` (exports `withRetry`, `Retryable`, `RetryConfig`)
- **Evidence:**
  - Library A is imported by ZERO production callers; only `forks/ruflo/v3/@claude-flow/shared/src/resilience/index.ts:13` re-exports it.
  - Library B is imported by `forks/ruflo/v3/@claude-flow/cli/src/index.ts:745-750` (re-export only). No consumer in any package actually calls `withRetry(...)` from this library outside the `teammate-plugin`'s local copy.
  - Eight independent ad-hoc retry loops were found, each implementing exponential backoff differently:

    | File | Pattern | Retryability decision |
    |---|---|---|
    | `embeddings/src/embedding-service.ts:325` | `for (let attempt = 0; attempt < this.maxRetries; attempt++)` | hard-coded |
    | `plugins/src/providers/index.ts:250` | `for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++)` | per-config |
    | `plugins/src/integrations/ruvector/streaming.ts:1472` | `while (attempt < this.options.maxRetries)` | per-config |
    | `plugins/src/integrations/ruvector/ruvector-bridge.ts:311` | `while (attempt < this.retryConfig.maxAttempts)` | per-config |
    | `integration/src/provider-adapter.ts:602` | `while (attempt < maxAttempts)` | string-match on error.message |
    | `integration/src/long-running-worker.ts:333` | `while (attempt < this.maxRetries)` | hard-coded |
    | `cli/src/mcp-server.ts:154` | `for (let attempt = 1; attempt <= maxAttempts; attempt++)` | hard-coded |
    | `swarm/src/domain/entities/task.ts:223` (`_retryCount >= _maxRetries`) | counter on entity, no library |

- **Impact:** Eight different jitter formulas, eight different
  retryability heuristics, eight different upper bounds. A user-facing
  symptom is that "the system retried operation X" means different
  things in each location. The dead `RetryableErrors` predicate at
  `shared/resilience/retry.ts:196-224` ALREADY implements
  network/rate-limit/server-error classification — but nothing imports
  it. The other library (`cli/production/retry.ts`) has a non-trivial
  `RetryStrategy` ('exponential' | 'linear' | 'constant' | 'fibonacci')
  that's also unused. This is the `feedback-no-fallbacks` shape at the
  resilience layer: capability installed, no consumer.

### F-13-002 [MEDIUM] `ErrorHandler` facility (production-grade classification) is exported but never instantiated

- **Location:** `forks/ruflo/v3/@claude-flow/cli/src/production/error-handler.ts`
- **Evidence:** The class has been written (~480 lines): regex-based
  category classification (validation, authentication, authorization,
  not_found, rate_limit, timeout, circuit_open, external_service,
  internal, unknown), retryability predicate, sanitization (no
  secret-leak), error aggregation, monitoring report. A
  `defaultHandler = new ErrorHandler()` singleton is constructed at
  line 386. `withErrorHandling` wrapper exported at line 391.
  ```bash
  grep -rn "new ErrorHandler\|errorHandler\." v3/ | grep -v "/dist/"
  # only: v3/@claude-flow/cli/src/production/error-handler.ts:386
  # → not a single external instantiation
  ```

  ```bash
  grep -rn "withErrorHandling" v3/ | grep -v "/dist/"
  # only the export at index.ts:726 + the definition at production/error-handler.ts
  # → not a single call site
  ```

- **Impact:** The team built a sound error-handling abstraction and
  shipped it to user installs (`production/error-handler.ts` is part
  of the published cli dist). Every MCP tool handler then ignores it
  and rolls its own ad-hoc `catch (e) { return { success: false, error: sanitizeError(e) } }`
  pattern (see F-13-005 for the cross-cutting shape). This is
  observability debt — failures fan out across 1218+ throw sites with
  no unified category attached. Pick: either delete `error-handler.ts`
  (and revise USERGUIDE) or wire it into MCP-tool handlers.

### F-13-003 [WARNING] `ErrorCodes` constant duplicated byte-identically across three packages, with internal collision

- **Location:**
  - `forks/ruflo/v3/@claude-flow/mcp/src/types.ts:638-650`
  - `forks/ruflo/v3/@claude-flow/shared/src/mcp/types.ts:529-541`
  - `forks/ruflo/v3/mcp/types.ts:531+` (legacy / dual-write artifact)
- **Evidence:** All three define the same 11-entry `ErrorCodes` const
  + identical `MCPServerError` class. The values map JSON-RPC codes
  but have internal collisions:
  ```ts
  SERVER_NOT_INITIALIZED: -32002,
  AUTHORIZATION_FAILED: -32002,    // ← collides
  UNKNOWN_ERROR:        -32001,
  AUTHENTICATION_REQUIRED: -32001,  // ← collides
  ```
- **Impact:**
  - Drift risk: a fix to one copy doesn't propagate. Three copies × N
    consumers each.
  - Code-collision risk: a caller receiving `code: -32001` cannot
    distinguish "the MCP server returned UNKNOWN_ERROR" from
    "authentication required". The JSON-RPC spec leaves -32000 through
    -32099 as implementation-defined, but the chosen scheme shouldn't
    reuse codes within the same scheme.
  - Pattern shape: the codebase already has a typed-error hierarchy
    facility (the cli-core CLIError family with string codes — see
    F-13-004); MCP's numeric scheme is inconsistent with that.

### F-13-004 [WARNING] Error-code naming has 5+ parallel conventions; no project-wide prefix

- **Location:** Across all packages.
- **Evidence:** Found in the source tree:
  - **JSON-RPC numeric** (MCPServerError, ErrorCodes -32700 …)
  - **SCREAMING_SNAKE strings** (`'RATE_LIMIT'`, `'AUTHENTICATION'`,
    `'MODEL_NOT_FOUND'`, `'PROVIDER_UNAVAILABLE'` in the LLMProviderError
    family at `providers/src/types.ts:248-293`)
  - **SCREAMING_SNAKE typed enums** (`IntegrationErrorCode`,
    `ClaimErrorCode`, `PluginErrorCode` — at `integration/src/types.ts:429`,
    `claims/src/domain/types.ts:195`, `shared/src/plugin-interface.ts:705`)
  - **Plugin-prefixed namespaces** (`PrimeRadiantErrorCodes`,
    `LegalErrorCodes`, `GasTownErrorCodes`, `FinancialErrorCodes`,
    `TestIntelligenceErrorCodes`, `CodeIntelligenceErrorCodes`,
    `PerfOptimizerErrorCodes`, `HealthcareErrorCodes` — 8 plugin
    families with private namespaces)
  - **Literal-union strings** (`readonly code: 'BARE_NAME' | 'UNKNOWN_MODEL'`
    at `embedding-models.ts:34`)
  - **Free-form descriptive strings** (`'VALIDATION_ERROR'`,
    `'CONFIG_ERROR'`, `'COMMAND_NOT_FOUND'` in cli-core `types.ts:258-289`)
  - Searching for any project-wide prefix returns nothing:
    `grep -rn "RUFLO_E\|RUFLO_ERR\|CLAUDE_FLOW_E\|CFE-"` → only env-var
    matches (no error-code matches).
- **Impact:** A user filing a bug report with "error code RATE_LIMIT"
  doesn't tell maintainers WHICH layer raised it. Several plugins
  define their OWN `RATE_LIMIT` constant in isolation. An adopted
  convention (e.g. `RUFLO_E<area><nnn>`-style or a top-level enum
  union) would let consumers discriminate without `instanceof`
  cascades. Mild — actionable but low-urgency.

### F-13-005 [MEDIUM] MCP tool handlers uniformly catch-and-return-success-object — exceptions never propagate

- **Location:** 56 occurrences in `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/` alone:
  ```ts
  // representative shape, repeated ~56× across agentdb-tools, etc.
  handler: async () => {
    try {
      ...
    } catch (error) {
      return { available: false, error: sanitizeError(error) };
    }
  }
  ```
- **Evidence:** Every MCP tool handler wraps in `try/catch` and
  converts the throw to a returned object with `success: false` /
  `available: false` plus a string. The MCP JSON-RPC layer therefore
  never sees an `isError` response — every tool call appears to
  succeed from the client's POV with a payload that the client must
  inspect.

  Five separate `sanitizeError` implementations:
  | File | What it does |
  |---|---|
  | `cli/src/mcp-tools/agentdb-tools.ts:39` | Strips stack, returns message |
  | `cli/src/services/claim-service.ts:798` | Different strip rules |
  | `plugins/src/security/index.ts:366,385` | Two more (sanitizeErrorMessage + sanitizeError, different signatures) |
  | `shared/src/utils/secure-logger.ts:82,246` | Secret-scrubbing version |
  | `hooks/src/workers/mcp-tools.ts:39` | hooks-local variant |

- **Impact:** This is the project's MOST common error-handling
  anti-pattern in production. Several consequences:
  1. The MCP `isError: true` field never surfaces — clients can't
     pattern-match on tool failures (every response is "success").
  2. A transient `ECONNREFUSED` looks identical to a config error and
     a corrupted-disk error.
  3. The five `sanitizeError` variants format messages differently,
     so the same underlying error renders differently depending on
     which package caught it.
  4. The `ErrorHandler` facility in F-13-002 would address this; not
     wired in.

  This violates `feedback-best-effort-must-rethrow-fatals` at the
  user-facing surface. Fatal data-integrity errors (e.g. a corrupt
  RVF, ADR-0112 territory) are silently demoted to
  `{ available: false, error: 'something went wrong' }` strings.

### F-13-006 [WARNING] 41 throws interpolate `${e.message}` into a new Error — losing stack + cause

- **Location:** 41 sites across both forks. Sample:
  ```
  v3/@claude-flow/memory/src/migration.ts:209
  throw new Error(`Failed to load SQLite: ${(error as Error).message}`);
  ```

  ```
  v3/@claude-flow/shared/src/core/config/accessor.ts:102,109
  throw new Error(`Failed to read config.json at ${configPath}: ${(err as Error).message}`);
  throw new Error(`Failed to parse config.json at ${configPath}: ${(err as Error).message}`);
  ```

  ```
  v3/@claude-flow/cli/src/services/worker-daemon.ts:1310,1513-1516,1520-1523
  throw new Error(`Headless execution failed for ${workerConfig.type}: ${errorMsg}`);
  throw new Error(`routeLearningOp consolidate failed: ${msg}\n...`);
  throw new Error(`Consolidation worker failed: ${msg}\n...`);
  ```
- **Evidence:** 9 sites in ruflo, 32 in agentdb (counted via
  `grep -rnE "throw new Error\(.*\\\$\{.*\.message\}"`). Each could
  trivially use `{ cause: e }` (Node ≥16.9) which preserves the
  cause-chain and lets the downstream catch walk
  `err.cause.cause...`.
- **Impact:** Loss of stack-trace + parent-error metadata in the
  re-throw. Debugging a "Failed to load SQLite: SQLITE_CANTOPEN" gives
  no callstack into sqlite. The 2 sites that DO use `cause:` correctly
  (`memory/src/controller-registry.ts:38` ControllerInitError;
  `cli/src/memory/memory-router.ts:979`) show how cheap the fix is — a
  6-character `, cause: e` addition.

### F-13-007 [WARNING] Retryability is decided by `error.message.includes('ECONNRESET')` string-matching, not by error class

- **Location:**
  - `forks/ruflo/v3/@claude-flow/shared/src/resilience/retry.ts:196-224`
    (`RetryableErrors.network` / `.rateLimit` / `.serverError`
    predicates — all regex on `error.message`)
  - `forks/ruflo/v3/@claude-flow/cli/src/production/retry.ts:124-144`
    (`shouldRetryError` — `error.message.toLowerCase()` substring
    match against config's `nonRetryableErrors` list)
  - `forks/ruflo/v3/@claude-flow/cli/src/production/error-handler.ts:65-120`
    (the dead `ERROR_PATTERNS` table — 9 categories, each defined as a
    `RegExp[]` over `.message`)
  - `forks/agentdb/src/controllers/LearningSystem.ts:170-180,205-215,223-232`
    (`isModuleNotFound = error.code === 'MODULE_NOT_FOUND' || ... || error.message.includes('Cannot find')`)
- **Evidence:** Every retry/classify decision is text-shape based.
  Three concrete drift hazards:
  1. Node version changed `'Cannot find module'` to `'Cannot find package'` in some recent transitions — the LearningSystem heuristic could miss this.
  2. The cli/production/retry.ts default-config `nonRetryableErrors: ['validation', 'authentication', 'authorization', 'not_found']` matches the SUBSTRING of any error message containing the word "validation" — including the generic message `'Schema validation passed for...'` in a downstream warning.
  3. The legitimate Node `error.code` discrimination IS used at LearningSystem.ts:171-172 (`error?.code === 'MODULE_NOT_FOUND'`); the string-match is a defensive fallback. The other 8 ad-hoc retry loops (F-13-001) don't even do this much.
- **Impact:** A user creating a custom error class with a perfectly
  fine message that happens to contain "validation" will not be
  retried even on transient failure. Conversely, the `network`
  predicate misses any `instanceof NetworkError` if the message string
  doesn't include ECONNRESET/etc. Switching to an `instanceof`
  hierarchy (rooted in a base RetryableError class) would be sound
  but requires the F-13-004 prefix decision first.

### F-13-008 [WARNING] 193 `catch ... console.warn/error` sites without rethrow; only 44 are annotated as legitimate

- **Location:** Across `forks/ruflo`. Counted by
  ```bash
  grep -rnB1 "console\.\(warn\|error\)" --include="*.ts" v3/ | grep "catch\s*("
  # → 193 catch-then-console sites
  grep -rn "silent-fallthrough-OK" --include="*.ts" v3/
  # → 44 annotated swallows (most in rvf-backend.ts, ADR-0112 territory)
  ```

  In agentdb the count is asymmetric:
  ```bash
  grep -rn "silent-fallthrough-OK" --include="*.ts" forks/agentdb/src/
  # → 0 annotations
  ```

  Yet `LearningSystem.ts:165-233` shows the GOOD pattern (post-ADR-0220
  F-05-003): `if (isModuleNotFound) { console.warn(...) } else { throw error }`.

- **Evidence:** Sampling the 149 un-annotated swallows:
  - `worker-daemon.ts:1293-1297` — persist-failure to console.warn, return
  - `agentdb/src/controllers/MetadataFilter.ts:148-152` —
    `JSON.parse` failure silently returns `undefined`; caller can't tell
    "absent field" from "corrupt JSON"
  - many `console.warn` paths in plugins/

- **Impact:** Per `feedback-best-effort-must-rethrow-fatals`,
  unmarked swallows are presumed-wrong: they must discriminate fatal
  from transient. The `silent-fallthrough-OK` convention in
  `rvf-backend.ts` IS the project-internal answer to this — but it
  hasn't propagated outside that file. agentdb adopted the *rethrow-on-non-module-not-found*
  discrimination pattern only in LearningSystem.ts (post-ADR-0220);
  the other 60+ files in agentdb didn't get the treatment.

  This finding is sized DOWN to WARNING because most swallows look
  intentional on inspection (config-not-found falling back to default,
  optional feature unavailable). But the unmarked-vs-marked ratio
  (149 unmarked vs 44 marked) signals the convention isn't enforced.

### F-13-009 [NOTE] One gold-standard error class exists (gastown-bridge); not adopted anywhere else

- **Location:** `forks/ruflo/v3/plugins/gastown-bridge/src/errors.ts:97-157`
- **Evidence:** `GasTownError` extends Error and includes:
  - `readonly code: GasTownErrorCodeType` (typed union)
  - `readonly timestamp: Date`
  - `readonly context?: Record<string, unknown>`
  - `readonly cause?: Error`
  - `Error.captureStackTrace` for proper V8 stack
  - `toJSON()` for structured logging
  - `toString()` for human display
  - Subclasses: `BeadsError`, `ValidationError`, `CLIExecutionError`,
    `FormulaError`, `ConvoyError` — all properly extending GasTownError
- **Impact:** This is the ideal pattern. It exists. It's in the
  source tree. It has tests. It's used by 2 plugins (`gastown-bridge`
  + `agentic-qe` via inheritance). It is not adopted by `cli`, `memory`,
  `shared`, `mcp`, `claims`, `aidefence`, `agentdb`, or any of the
  60+ other top-level packages. Promoting this pattern to a shared
  `@claude-flow/errors` package would close out F-13-001 through
  F-13-008 in one move.

## Cross-cutting

Top 3 recurring call-site shapes across packages:

1. **MCP tool handler swallow-and-return** (F-13-005, 56+ sites):
   ```ts
   try { ... } catch (e) { return { success: false, error: sanitizeError(e) }; }
   ```
   Five `sanitizeError` definitions; no `isError` propagation to MCP
   client.

2. **Naked re-throw with message interpolation** (F-13-006, 41 sites):
   ```ts
   throw new Error(`Failed to X: ${(err as Error).message}`);
   ```
   Loses stack + cause; trivially fixable with `{ cause: e }`.

3. **Per-file ad-hoc retry loop** (F-13-001, 8 distinct
   implementations):
   ```ts
   for (let attempt = 0; attempt < this.maxRetries; attempt++) {
     try { ... return; } catch (e) { ... await sleep(...) }
   }
   ```
   Eight different backoff formulas; two project-internal retry
   libraries unused.

Worst per-package cluster:

- **`forks/ruflo/v3/@claude-flow/plugins`** (399 throws across many
  files) — high heterogeneity, no shared base class. Some plugins
  (gastown-bridge, agentic-qe) define proper error hierarchies;
  others use naked throws. Mixed culture even within one package.
- **`forks/agentdb/src/services/enhanced-embeddings.ts`** (34 throws,
  no error classes) and **`src/quantization/vector-quantization.ts`**
  (34 throws, no error classes) — pure-naked-throw files in agentdb.
  Each makes sense in context (parameter validation, dimension
  mismatch checks) but loses discriminability.

## Out of scope

Intentionally not covered:

- **Rust `.unwrap()` quality audit** — 9865 unwrap calls in non-test
  paths in `forks/ruvector/crates/`. Most are invariant-asserts or
  invariant `Mutex::lock().unwrap()` patterns that are idiomatic Rust.
  Per-call discrimination would require a dedicated Rust audit. Note
  that `crates/rvf/rvf-node/src/lib.rs` (the NAPI surface) has ZERO
  unwraps — the discipline IS present at the boundary.
- **The `aidefence` package error model** — zero error classes, zero
  throws (counter-intuitive but the package is mostly read-only
  classification; not a defect for this slice).
- **Plugin-internal error catalogs** — 8 plugins define their own
  `<Name>ErrorCodes` namespaces (PrimeRadiantErrorCodes,
  LegalErrorCodes, etc.). Internally consistent; auditing each plugin's
  catalog is in scope for G-16-002 (plugin contents audit).
- **OpenTelemetry / structured-error reporting** — overlaps with
  G-16-006 (telemetry). The `ErrorHandler.reportToMonitoring` config
  flag (line 31) is declared but the path is dead with the rest of
  the facility.
- **Acceptance-test error-fixture coverage** — whether tests exercise
  each error class. Belongs in G-16-018 (schema / type definitions).
- **Donate-backs to upstream** — per `feedback-no-upstream-donate-backs`,
  no PRs / issues filed against `ruvnet/*`.

## Method

- `grep -rn "class [A-Za-z_]*Error" --include="*.ts"` excluding
  `/dist/`, `__tests__`, `node_modules`, plus
  `grep -rn "pub enum [A-Za-z_]*Error" --include="*.rs"` for ruvector.
- `grep -rn "throw new Error("` for the naked-throw census,
  partitioned per-package by directory depth.
- For each error class encountered, opened the file and inspected
  whether it carries `code`, `cause`, `name`, and whether subclasses
  exist. Special attention to the `extends Error` vs
  `extends <DomainBaseError>` hierarchy depth (most are 1-deep).
- For retry policies: searched for `withRetry|maxAttempts|maxRetries|
  backoff|exponential|setTimeout.*resolve.*delay` and partitioned the
  consumers between (a) the two retry libraries and (b) ad-hoc loops.
- For swallow patterns: `grep -rnE "catch\s*\([^)]*\)\s*\{\s*\}"` for
  literal empty catches (zero across the codebase!) plus
  `grep -rnB1 "console\.\(warn\|error\)" | grep "catch"` for
  catch-then-log patterns (193 in ruflo, of which 44 are
  `silent-fallthrough-OK` annotated).
- For cause-chain usage: `grep -rn "cause:"` then filtered to actual
  Error constructor or assignment contexts (most matches were CLI
  param schema or comment text).
- Cross-walked each finding against `feedback-best-effort-must-rethrow-fatals`,
  `feedback-no-fallbacks`, and ADR-0112/ADR-0220 to confirm whether the
  pattern is project-acknowledged-good or already-flagged-bad.

## Recommendations

Numbered in priority order. Each closes one or more of F-13-001 through
F-13-009.

1. **Promote `gastown-bridge/src/errors.ts` to a shared base
   (F-13-009 + F-13-004 + F-13-006)** — extract the `GasTownError`
   shape into a `@claude-flow/errors` package (or
   `@claude-flow/shared/errors`). It already does `code` + `cause` +
   `context` + `timestamp` + `captureStackTrace` + `toJSON` + `toString`.
   Adopt it as the base for new error classes; migrate the most-thrown
   sites first (mcp-tools/, memory/, cli/services/).

2. **Wire `production/error-handler.ts` OR delete it (F-13-002)** — if
   used, every MCP tool handler should funnel through `withErrorHandling()`
   so error classification + sanitisation + retry-decision happen in
   one place. If not used, remove the dead `~480 LOC` to reduce
   surface.

3. **Pick one retry library and delete the other (F-13-001)** — the
   `production/retry.ts` version is richer (4 strategies, decorator
   support); the `shared/resilience/retry.ts` version has the cleaner
   `RetryableErrors` predicate set. Either pick wins; the migration
   path for the 8 ad-hoc loops is mechanical.

4. **Fix the MCP `ErrorCodes` collision + dedupe (F-13-003)** —
   one canonical `ErrorCodes` definition; assign distinct integers
   per the JSON-RPC implementation-defined range; have the other two
   files re-export, not redefine.

5. **Replace `.message.includes(...)` retryability with `instanceof`
   discrimination (F-13-007)** — once a base RetryableError exists
   (from #1), `RetryableErrors.transient` becomes
   `(e: Error) => e instanceof RetryableError && e.retryable`. The
   defensive string-match fallback stays for foreign errors.

6. **MCP tool handler convention: throw, don't return-error-object
   (F-13-005)** — let the MCP server / JSON-RPC layer convert thrown
   errors to `isError: true` responses with the proper structure.
   Today the handler-wrap-success-with-error-string pattern hides
   failures from MCP clients.

7. **Replace 41 message-interpolation throws with `{ cause: e }`
   (F-13-006)** — mechanical, one-line edits. Preserves stack + lets
   downstream catches walk the chain.

8. **Audit + annotate the 149 un-marked swallows (F-13-008)** —
   either add the existing `silent-fallthrough-OK` annotation (with
   the standard `// silent-fallthrough-OK: <why>` comment shape from
   rvf-backend.ts) or convert to the LearningSystem.ts:170-180
   discriminate-then-rethrow pattern. This is the highest-volume
   low-risk-per-site finding.

9. **Adopt the SCREAMING_SNAKE namespace prefix convention for
   plugin error catalogs (F-13-004)** — `PrimeRadiantErrorCodes`,
   `LegalErrorCodes`, etc. are already consistent within plugins.
   Add a USERGUIDE note that the runtime convention is
   `<Plugin>ErrorCodes.<NAME>` and reserve a `RUFLO_E*` prefix
   for cross-cutting errors only (or pick a different scheme).
