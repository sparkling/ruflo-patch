# 06 — WASM modules + native (NAPI) bindings soundness audit

## Summary

- Surfaces audited: 4 JS loaders (`agent-wasm.ts`, `ruvllm-wasm.ts`, `diskann-backend.ts`, `vector-db.ts`) + the NAPI `RvfBackend` (`rvf-backend.ts:1079-1535` — ~456 LoC just for `tryNativeInit`) + Rust source for `crates/ruvllm-wasm/*` + `crates/rvf/rvf-{node,wasm}/*`
- Crate inventory: ~50 WASM-named crates (`crates/*-wasm`); ~30 with `wasm-bindgen` + `cdylib`; only ~10 ship a canonical `npm/packages/<name>/` artefact (verified via `find npm/packages -name "package.json"`).
- NAPI inventory: 12 `NAPI_PACKAGES` entries in `lib/napi-config.sh` (8 ruvector + 2 single-binary + 2 gnn/attention). Of these, only `rvf-node` is currently loader-resolved from the runtime fork (`rvf-backend.ts:1116`).
- Findings: 9 total / 2 critical / 4 warning / 3 note
- Soundness verdict: **PARTIAL PASS** — `RvfBackend` loader is exemplary post-ADR-0095 amendment 2026-05-23 (correctly fail-loud). `diskann-backend.ts` + `vector-db.ts` still ship pure-JS fallbacks that the same amendment says were removed; the amendment was applied narrowly to RVF only.
- Completeness verdict: **FAIL** — ADR-0232 (proposed today) confirms no wasm-rebuild pipeline phase exists; stale `pkg/` shadowing was a known-and-fixed defect (ADR-0231 wave A9) but the root cause remains uncovered.
- Bottom line: One survivor of `feedback-no-fallbacks` (the hash-based JS embedding fallback in `vector-db.ts:103-130` + the silent diskann→hnsw→cosine-js cascade in `diskann-backend.ts:54-114`), four silent numeric clamps in `ruvllm-wasm/src/sona_instant.rs` that share the same anti-pattern as the agent-A6-fixed `set_pattern_capacity`, and a `WasmGallery.get()` panic-swallow that hides API contract drift.

## Inventory tables

### WASM crates with publishable `npm/packages/<name>/` artefact

| Crate (`crates/`) | Name in `Cargo.toml` | Publishable as | Loader |
|---|---|---|---|
| `ruvllm-wasm/` | `ruvllm-wasm` (unscoped) | `@ruvector/ruvllm-wasm` → `@sparkleideas/ruvector-ruvllm-wasm` | `cli/src/ruvector/ruvllm-wasm.ts:107` |
| `rvAgent/rvagent-wasm/` | (via `npm/packages/rvagent-wasm`) | `@ruvector/rvagent-wasm` → `@sparkleideas/ruvector-rvagent-wasm` | `cli/src/ruvector/agent-wasm.ts:86` |
| `rvf/rvf-wasm/` | `rvf-wasm` | `@ruvector/rvf-wasm` → `@sparkleideas/ruvector-rvf-wasm` | (no loader in fork — browser-only) |
| `ruvector-attention-unified-wasm/`, `learning-wasm/`, `economy-wasm/`, `exotic-wasm/`, `nervous-system-wasm/` | wasm-pack defaults (unscoped, UNSCOPED_MAP-rewritten) | `@ruvector/<name>-wasm` → `@sparkleideas/ruvector-<name>-wasm` (re-exported by `@ruvector/wasm` meta) | `cli/src/ruvector/index.ts:208-215` (only `learning-wasm` is loader-resolved) |

**Naming-anomaly cross-check (ADR-0231 wave A9 lesson):** `ruvllm-wasm` is the documented trap (crate name unscoped, npm name `@ruvector/ruvllm-wasm`). Search of `UNSCOPED_MAP` (`scripts/codemod.mjs:38-68`) confirms one entry exists. No other crate in the WASM publishable subset was found with the same shape (Rust unscoped → npm scoped) — `rvagent-wasm` and `rvf-wasm` declare `@ruvector/...` directly in their `package.json` `name` and so are routed by the `RUVECTOR_PREFIX_FROM` codemod rule (`scripts/codemod.mjs:30`).

### NAPI crates with publishable artefact

| Crate (`crates/`) | NAPI dest dir | Loader |
|---|---|---|
| `rvf/rvf-node/` | `npm/packages/rvf-node/` | **`memory/src/rvf-backend.ts:1116`** (single hard-resolved consumer) |
| `ruvector-node/`, `ruvector-graph-node/`, `ruvector-router-ffi/`, `ruvector-tiny-dancer-node/`, `sona/`, `ruvector-solver-node/`, `agentic-robotics-node/`, `ruvector-gnn-node/`, `ruvector-attention-node/`, `examples/ruvLLM/` | per `lib/napi-config.sh:21-46` | none in fork (downstream consumers, not loaded by ruflo runtime) |
| `agentic-jujutsu/` (agentic fork) | `packages/agentic-jujutsu/` | (separate fork — out of scope here) |

## Findings

### F-06-001 [CRITICAL] Pure-JS hash-embedding fallback survives `feedback-no-fallbacks` amendment

- **Location:** `forks/ruflo/v3/@claude-flow/cli/src/ruvector/vector-db.ts:101-130` (`generateHashEmbedding`) + caller cascade at lines 240-258 (`createVectorDB` fallback) + 268-277 (`cosineSimilarity` JS fallthrough)
- **Issue:** The ADR-0095 amendment 2026-05-23 ("Pure-TS fallback is removed (ADR-0095 amendment 2026-05-23, feedback-no-fallbacks)") was applied surgically to `rvf-backend.ts:1129-1134` and `rvf-backend.ts:1477-1481` only. The matching surface in `vector-db.ts` was missed: when `import('ruvector')` fails (line 157, `.catch(() => null)`), and on every per-call `try { … } catch { /* Fall back to … */ }` (lines 241-244, 257-258, 272-275), the code silently degrades to a `Math.sin(hash * (i+1) * 0.001) * 0.5 + 0.5`-based "embedding". That output is not even close to a real embedding — it's a deterministic hash-stretched sine wave that has zero semantic content. Any downstream similarity search keyed on it is statistical noise.
- **Evidence:**
  ```ts
  // vector-db.ts:155-159
  try {
    const ruvector = await import('ruvector').catch(() => null);
    // ruvector exports VectorDB class, not createVectorDB function
    if (ruvector && (typeof ruvector.VectorDB === 'function' || …)) {
  ```
  ```ts
  // vector-db.ts:101-130 — the "fallback" embedding generator
  function generateHashEmbedding(text: string, dimensions: number = EMBEDDING_DIM): Float32Array {
    let hash = 0;
    for (let i = 0; i < normalized.length; i++) {
      hash = ((hash << 5) - hash) + normalized.charCodeAt(i);
      hash = hash & hash;
    }
    for (let i = 0; i < dimensions; i++) {
      embedding[i] = Math.sin(hash * (i + 1) * 0.001) * 0.5 + 0.5;
    }
    // …normalize and return
  }
  ```
  And the `getStatus()` shape (line 286) advertises `backend: 'fallback'` as a first-class state alongside `'ruvector-wasm'` / `'ruvector'` — codifying the fallback as supported.
- **Impact:** `vector-db.ts` is wired through the ruvector barrel (`cli/src/ruvector/index.ts:79` re-exports `loadRuVector`). Any consumer relying on the public API can silently get hash-stretched-sine "embeddings" if `ruvector` is unavailable, then run nearest-neighbour search over them and get apparently-valid but semantically-empty results. This is the exact pattern `feedback-no-fallbacks` flags as a fail-mask. The rvf-backend amendment got the principle right; this file kept the old behaviour.
- **Suggested action:** Apply the same fail-loud throw that `rvf-backend.ts:1129` does. The hash-embedding generator can stay as a debug helper but should not be a callable production path. Either gate it behind an explicit `RUVECTOR_FALLBACK_OK=1` env-opt-in (with loud stderr) or delete it outright.

### F-06-002 [CRITICAL] Three-tier silent fallback cascade in `diskann-backend.ts`

- **Location:** `forks/ruflo/v3/@claude-flow/cli/src/ruvector/diskann-backend.ts:54-114` (`getDiskAnnIndex`) + 198-220 (`createJsFallbackIndex`)
- **Issue:** Cascade is `diskann` → `hnsw` → `cosine-js` with empty `catch { /* Fall through */ }` on each layer (lines 83-86, 105-107). No stderr warning, no error thrown, no audit signal. The `activeBackend: VectorBackend` state variable is the only way the caller can discover which tier was picked, and most call sites in the fork do not read it (`searchVectors` returns `SearchResult[]` without exposing the backend choice — line 169-196).
- **Evidence:**
  ```ts
  // diskann-backend.ts:80-86
  diskannInstance = index;
  activeBackend = 'diskann';
  return { index, backend: 'diskann' };
    } catch {
      // Fall through
    }
  }

  // Try HNSW (@ruvector/router VectorDb) as fallback
  try {
    // …
    } catch {
      // Fall through
    }
  }

  // Pure JS fallback
  const jsIndex = createJsFallbackIndex(config.dim);
  ```
  And the pure-JS fallback (line 200-220) is an `O(N)` brute-force cosine scan over every inserted vector — when `@ruvector/diskann` is installed but throws (e.g. partial NAPI binary), production silently goes from billion-scale-NN to linear-scan-NN, with the same return shape.
- **Impact:** Same family as F-06-001. The diskann surface is in scope for the May-23 amendment but was not touched. Per ADR-0231 wave A9 lesson, "silent ambiguous resolution is the anti-pattern."
- **Suggested action:** Same as F-06-001 — fail loud on each NAPI/WASM module-load failure. Reserve `cosine-js` for a tests-only or in-process unit-test mode, never production.

### F-06-003 [WARNING] Four more silent numeric clamps in `sona_instant.rs` setters, identical pattern to the agent-A6 `set_pattern_capacity` bug

- **Location:** `forks/ruvector/crates/ruvllm-wasm/src/sona_instant.rs:131`, `:143`, `:155`, `:179` (plus the now-fixed `:166-168`)
- **Issue:** The agent-A6 fix (`commit 6227eb8` removed `value.max(10)` from `set_pattern_capacity` so `5` no longer becomes `10`). The same WASM-bindgen setter file has **four sibling setters** that still silently clamp user input without any error signal:
  - `set_micro_lora_rank` (line 131): `value.max(1).min(4)` — passing rank `0` or `>4` is silently coerced. Documented as "Clamp 1-4" in a `//` comment but the JS caller has no way to know the value was rewritten.
  - `set_learning_rate` (line 143): `value.max(0.0).min(1.0)` — passing `lr = 1.5` (a common hyperparameter typo) silently becomes `1.0`.
  - `set_ema_decay` (line 155): `value.max(0.0).min(1.0)` — same shape.
  - `set_ewc_lambda` (line 179): `value.max(0.0).min(1.0)` — same shape.
- **Evidence:**
  ```rust
  // sona_instant.rs:130-132 — micro_lora_rank
  pub fn set_micro_lora_rank(&mut self, value: usize) {
      self.micro_lora_rank = value.max(1).min(4); // Clamp 1-4
  }

  // sona_instant.rs:142-144 — learning_rate
  pub fn set_learning_rate(&mut self, value: f32) {
      self.learning_rate = value.max(0.0).min(1.0);
  }
  ```
  Compare with the symmetric `pi_quant_wasm.rs:134-140`, which DOES `panic!()` on out-of-range bits/k — proving the codebase has a precedent for fail-loud validation; the SONA setters chose the wrong half.
- **Impact:** Caller-visible misconfiguration is silently swallowed. A user setting `learningRate: 2.0` (forgetting they're not in PyTorch land) sees adaptation proceed at `lr=1.0`, gets unexpectedly-fast convergence, and never learns their config was rewritten. Same class as the `set_pattern_capacity(5) → 10` bug that prompted the agent-A6 fix.
- **Suggested action:** Either `return Result<(), JsValue>` from each setter with a typed range-error, or `console::warn_1` in the WASM binding before the clamp. Match the `pi_quant_wasm.rs` shape.

### F-06-004 [WARNING] HNSW pattern-limit hard-clamp in `ruvllm-wasm.ts:169-173` overrides user `config.maxPatterns`

- **Location:** `forks/ruflo/v3/@claude-flow/cli/src/ruvector/ruvllm-wasm.ts:142` (`HNSW_MAX_SAFE_PATTERNS = 1024`) + 169-173 (the throw)
- **Issue:** The JS wrapper exposes `config.maxPatterns: number` (line 31) but then ignores it past `1024` — the underlying WASM-side `HnswRouterWasm.new(dimensions, maxPatterns)` IS instantiated with whatever the user passed, but the JS-side counter (`count++`) trips the throw at line 170 before the WASM index runs out of room. The constant comment claims "v2.0.2 supports 1000+ patterns (fixed connect_node ordering)" but the JS limit is `1024`. There's no signal at construction time that the requested `maxPatterns` was effectively capped at 1024.
- **Evidence:**
  ```ts
  // ruvllm-wasm.ts:160-176
  const router = new mod.HnswRouterWasm(config.dimensions, config.maxPatterns);
  if (config.efSearch) {
    router.setEfSearch(config.efSearch);
  }
  let count = 0;
  return {
    addPattern(pattern: HnswPattern): boolean {
      if (count >= HNSW_MAX_SAFE_PATTERNS) {
        throw new Error(
          `HNSW pattern limit reached (${HNSW_MAX_SAFE_PATTERNS}).`
        );
      }
  ```
- **Impact:** A caller asking for `maxPatterns: 5000` will get throws on the 1025th `addPattern` call, mid-ingest, with no upfront error. Half the corpus is loaded before the limit fires.
- **Suggested action:** Either remove the 1024 cap (the comment claims the WASM side supports more), or validate `config.maxPatterns <= HNSW_MAX_SAFE_PATTERNS` at `createHnswRouter` and throw with a clear "WASM HNSW maximum is N, requested M" message.

### F-06-005 [WARNING] `agent-wasm.ts:392-398` swallows `WasmGallery.get()` panic with `catch {}`

- **Location:** `forks/ruflo/v3/@claude-flow/cli/src/ruvector/agent-wasm.ts:392-399`
- **Issue:** The comment says "Wraps in try/catch because WasmGallery.get() panics on unknown IDs in v0.1.0". A WASM `panic!` is a contract violation, not a recoverable error — wrapping it in `catch {}` and returning `null` hides API drift. If `WasmGallery` is upgraded and now THROWS a JsValue (instead of panicking), or if the panic message changes, the loader silently returns `null` for what could be a different failure mode (e.g. the WASM module wasn't initialised, or the gallery object is now namespaced differently).
- **Evidence:**
  ```ts
  // agent-wasm.ts:392-399
  export async function getGalleryTemplate(id: string): Promise<GalleryTemplateDetail | null> {
    const gallery = await getGallery();
    try {
      return gallery.get(id) ?? null;
    } catch {
      return null;
    }
  }
  ```
  And the `agent.prompt()` echo-stub detection (lines 154-196) is a similar shape: the file accepts `wasmResult === \`echo: ${input}\`` as "the bundled WASM didn't actually run an LLM" and routes through Anthropic — masking the fact that `@ruvector/rvagent-wasm` v0.1.0 is shipping a stub. Per ADR-0095 "G4" labelled comment, this is documented but it's still a silent route-around (`feedback-no-fallbacks`-shaped, see lines 168-191).
- **Impact:** Production-time API drift in `@ruvector/rvagent-wasm` is invisible. The `echo:` detection in particular masks the fact that we're shipping a non-functional WASM agent and pretending it works by reaching out to Anthropic Messages — that's the platform-dishonest pattern the May-23 amendment was meant to kill.
- **Suggested action:** At minimum, catch+log+rethrow rather than catch+swallow. For the echo-stub route, surface the stub-detection as a status field instead of routing-around: if `@ruvector/rvagent-wasm` is a stub, that's a deployment fact users deserve to know.

### F-06-006 [WARNING] `loadTrainingPipeline` in `lora-adapter.ts:155-174` silently returns null on require failure

- **Location:** `forks/ruflo/v3/@claude-flow/cli/src/ruvector/lora-adapter.ts:155-174`
- **Issue:** `loadTrainingPipeline` tries `requireCjs('@ruvector/ruvllm')` and on any failure returns `null`. `pipelineLoaded` is set to `true` upfront so subsequent calls skip the retry — meaning if the native binary failed to load due to a transient FS issue, the failure is cached for the process lifetime and never re-attempted. No stderr signal, no telemetry.
- **Evidence:**
  ```ts
  // lora-adapter.ts:155-174
  async function loadTrainingPipeline(adapter: LoRAAdapter): Promise<any> {
    if (pipelineLoaded) return ruvllmPipeline;
    pipelineLoaded = true;
    try {
      const { createRequire } = await import('module');
      const requireCjs = createRequire(import.meta.url);
      const ruvllm = requireCjs('@ruvector/ruvllm');
      // …
      return ruvllmPipeline;
    } catch {
      return null;
    }
  }
  ```
- **Impact:** Same family as F-06-001/002. The fork's `initBackend()` (line 202-204) calls this and returns void regardless. Callers cannot distinguish "backend loaded" from "backend silently unavailable." The cached null defeats any reconnection.
- **Suggested action:** Throw with the typed error (preserving `err.code`) like `rvf-backend.ts:1129` does. Make backend-unavailability a deployment error, not a runtime guess.

### F-06-007 [NOTE] `ruvector-wasm.ts:185` and 410 silent JSON-parse catches

- **Location:** `forks/ruflo/v3/@claude-flow/cli/src/ruvector/ruvllm-wasm.ts:185`, `:410`
- **Issue:** Two narrow `catch {}` blocks:
  - Line 185: `r.metadata` parsing — `typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata` is fine if the string is valid JSON; if not, no fallback is taken — but the caller path already has it inside a try at line 180 absent. Actually re-reading: there's NO try at line 180; the `JSON.parse` will throw out of the `.map()` and surface. OK, no defect here.
  - Line 410: `try { return JSON.stringify(cache.stats()); } catch { return '{}'; }` — masks a WASM-side `cache.stats()` panic with an empty object. The KV cache stats are a telemetry/observability surface; silently returning `{}` makes the issue invisible to monitoring.
- **Evidence:**
  ```ts
  // ruvllm-wasm.ts:408-412
  stats(): string {
    // Use toJson if available, otherwise stringify
    try { return JSON.stringify(cache.stats()); } catch { return '{}'; }
  },
  ```
  Also `:301`: `try { (feedback as any).success = success; } catch { /* v2.0.2 quirk */ }` — accepting a known-broken WASM-side field-setter as "quirk" rather than wiring around it explicitly.
- **Impact:** Low — telemetry/observability paths only. Doesn't corrupt data. But it does hide WASM-side API drift the same way F-06-005 does.
- **Suggested action:** Log to stderr at least once per session before returning the empty object. Or — if the WASM-side panic shape is known — discriminate by error and only return `{}` for the documented quirk.

### F-06-008 [NOTE] `hnsw_router.rs` unwrap()s in non-test paths

- **Location:** `forks/ruvector/crates/ruvllm-wasm/src/hnsw_router.rs:354`, `:413`, `:450`, `:451`, `:457`, `:458`, `:480-481`, `:488`, `:497`
- **Issue:** Multiple `.partial_cmp(&b.1).unwrap()` in graph-traversal hot paths. These will panic on `NaN` scores — the input embedding can produce `NaN` if any component is non-finite (e.g. all-zero input embeddings, post-normalisation division by zero). A panic inside WASM is recoverable in the JS host (it throws a `RuntimeError`) but the loader (`createHnswRouter` in `ruvllm-wasm.ts:150-198`) does NOT wrap `addPattern`/`route` calls — the panic surfaces as an unhandled exception with a generic `RuntimeError: unreachable` message that hides the actual NaN cause.
- **Evidence:**
  ```rust
  // hnsw_router.rs:354
  let entry_point = self.entry_point.unwrap();
  // hnsw_router.rs:413
  scored_neighbors.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
  ```
- **Impact:** Production NaN-bearing embeddings (rare but possible) crash the entire WASM module ungracefully. Per the recent `commit 6227eb8` posture ("honor user input"), input validation should reject NaN upfront, not panic mid-traversal.
- **Suggested action:** Either pre-validate `f32::is_finite()` on every embedding before insert/route (fail-loud at the boundary), or use `partial_cmp(&b.1).unwrap_or(Ordering::Equal)` to defend against NaN. The former is preferred per `feedback-no-fallbacks`.

### F-06-009 [NOTE] No wasm-rebuild pipeline phase — ADR-0232 (proposed today) covers this

- **Location:** Pipeline-wide; the missing phase would mirror `scripts/napi-rebuild.sh` (per `lib/napi-config.sh`, 12 NAPI packages)
- **Issue:** Already documented in `docs/adr/ADR-0232-pipeline-wasm-rebuild-phase.md`. Recording here for audit completeness: the absence of a WASM-rebuild phase + the `pkg/` shadowing trap (ADR-0231 wave A9) together mean a contributor running a one-off `wasm-pack build` in `crates/<name>-wasm/` can produce a `pkg/` shadow that wins the publishable-name slot if/when both the canonical and the shadow lose private-flag and pass the SUBDIR_BLACKLIST asymmetry. ADR-0231's `9f6577f` made this fail loud at publish time, but it remains an operator-burden-mitigation rather than a pipeline-rebuilds-canonical solution.
- **Evidence:** `find forks/ruvector/crates -type d -name "pkg"` returns 8 stale wasm-pack output dirs. `find forks/ruvector/npm/packages -type d -name "pkg"` returns 3 (`rvf-wasm`, `rvf-solver`, `rudag`) — these are LEGITIMATE (the package's `main` points into `pkg/`). Discrimination is by path, not name.
- **Impact:** Already mitigated at publish time. Risk shape is "stale canonical artefact ships if the contributor forgot to rebuild." ADR-0232 (if accepted) closes the loop.
- **Suggested action:** No new action — ADR-0232 captures the remediation. Out-of-scope for this audit.

## Cross-cutting observations

1. **The May-23 amendment was applied narrowly to RVF only.** The amendment's framing was scope-wide ("Pure-TS fallback is removed … feedback-no-fallbacks"), but its application was surgical (two changes in `rvf-backend.ts`). At least three other loaders (`vector-db.ts`, `diskann-backend.ts`, `lora-adapter.ts`) and one stub-route-around (`agent-wasm.ts` echo detection) ship behaviour the amendment's text claims was removed. This is a `feedback-pass-skip-not-signal` shape — applying the principle to one file and treating the broader work as done.

2. **`ruvllm-wasm/src/sona_instant.rs` is the silent-clamp epicentre.** Five setters in 50 lines, four still silent post-agent-A6 fix. Worth a dedicated pass to either Result-wrap them all or add WASM-side `console::warn` on clamp.

3. **Loader error messaging is uneven.** `rvf-backend.ts:1129` does the right thing: include `code`, surface the path, name the ADR that removed the fallback. `diskann-backend.ts` does the wrong thing: `catch { /* Fall through */ }` with no name, no code, no path. A loader-error-message-template would help.

4. **`crates/ruvllm-wasm/Cargo.toml` lint config (`[lints.rust]` allows everything) hides the kind of issue this audit found.** `unused_imports = "allow"`, `dead_code = "allow"`, `unused_variables = "allow"`, `unsafe_op_in_unsafe_fn = "allow"` — and the clippy section disables ~150 lints. Anything Rust's own toolchain could have flagged (incl. `manual_clamp`, `comparison_chain`) is silenced. This explains how four silent setters survived; clippy would have flagged `manual_clamp` on every one of them.

5. **The `WasmAgent` echo-stub route-around in `agent-wasm.ts:154-196`** is a remarkable platform-dishonesty: we ship a "WASM agent" that detects its own non-functionality (`/^echo: /.test`) and silently calls Anthropic Messages instead. If `@ruvector/rvagent-wasm` is a stub, we should be honest about it — either ship a different package that calls Anthropic by design, or document "this requires `ANTHROPIC_API_KEY`" at construction time, not in a runtime detect-and-route.

## Out of scope

- **Pipeline rebuild phase** (covered by ADR-0232 — flagged for completeness in F-06-009 only).
- **Native build correctness** (NAPI `.node` binaries' Rust internals). `rvf-node/src/lib.rs` is ~1310 LoC with `.unwrap()`/`.expect()` patterns; a deep dive into NAPI ↔ Rust panic boundaries is its own audit slice.
- **WASM browser-side bundling.** This audit focuses on Node-side loaders.
- **NAPI cross-platform optional dependencies.** Verified via `rvf-node/package.json:optionalDependencies` (5 targets), version pins are coherent (`0.1.7-patch.122` – `0.1.7-patch.146`). Out of scope for soundness.
- **`agentdb`-side embedding storage.** Slice 04 covered the controllers-memory surface.
