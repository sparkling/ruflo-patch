# Embedding Pipeline Soundness Audit (Slice 08)

Second-pass audit per G-16-008 [MEDIUM]. Scope: model loading, batching,
caching, queue management for embeddings across MCP / CLI / hooks / memory.
Read-only. Canonical reference: `[[reference-embedding-model]]` (mpnet,
768-dim, HNSW 23/100/50), `[[feedback-full-model-names]]`,
`[[feedback-no-fallbacks]]`, ADR-0069, ADR-0073 amendment, ADR-0227.

## Summary

The embedding stack ships **three parallel implementations** of the same
subsystem, only one of which is wired into the live MCP / CLI / hooks path:

1. **Live path (canonical)** — `@claude-flow/memory/src/embedding-pipeline.ts`
   + `embedding-adapter.ts`. Used by `memory-router.ts` (CLI memory store /
   search), `mcp-tools/embeddings-tools.ts` (via `memory-router.generateEmbedding`),
   `controller-registry.ts`. Defaults are correct (mpnet/768/transformers.js).
   Singleton init promise serialised correctly (F-08-006). Dimension
   strictness is real (`DimensionMismatchError` thrown at both `initialize()`
   probe and every `embed()`, F-08-007 PASS).

2. **Dead stack — `@claude-flow/embeddings/src/embedding-service.ts`** —
   1169 LOC with five provider classes (OpenAI / Transformers / Mock /
   AgenticFlow / RVF) plus `createEmbeddingServiceAsync('auto')` that prefers
   `RvfEmbeddingService` (hash) → AgenticFlow → Transformers. **No live
   consumer in CLI/MCP/memory**; only tests and a doc-comment example in
   `plugins/examples/ruvector-plugins/reasoning-bank.ts` import it. The
   ADR-094 CVE protection (`transformers-loader.ts` prefers
   `@huggingface/transformers` over `@xenova/transformers` to clear the
   protobufjs <7.5.5 RCE) lives in this dead stack only — the canonical
   pipeline hardcodes `@xenova/transformers` and never benefits (F-08-002).

3. **Helper — `.claude/helpers/learning-service.mjs`** (Reasoning Bank
   ONNX wiring) directly instantiates `agentic-flow/dist/embeddings/
   optimized-embedder.js`, silently falls back to a hash embedding when
   the file is missing or `init()` throws, and uses `text.slice(0, 200)`
   as the cache key + `text.slice(0, 500)` for the embedded input —
   silent truncation and silent key-collision both (F-08-005).

The "auto" provider in stack #2 picks RVF (hash) before any neural model
even when transformers.js is available — directly contradicts the
"ONNX primary, hash opt-in" tier and `feedback-no-fallbacks` (F-08-001).
That code path is currently unreached at the MCP/CLI surface, but
remains exposed via `createEmbeddingServiceAsync` exported from
`@claude-flow/embeddings/src/index.ts` — any future caller will get
hash silently.

Beyond the parallel-implementation issue:

* **MCP `embeddings_search` bypasses ADR-0227 adaptive threshold**
  (`embeddings-tools.ts:484`, `const threshold = (input.threshold as
  number) || 0.5`). The `|| 0.5` supplies a literal default to
  `routeMemoryOp`, which interprets caller-supplied threshold as
  explicit and skips `getAdaptiveThreshold`. Result: every MCP semantic
  search uses 0.5 floor — above the 0.25-0.65 mpnet related-band, so
  weak-but-genuine matches are dropped exactly as ADR-0227 fixed
  elsewhere (F-08-003).

* **`embeddings_status` MCP tool does not surface the live provider**
  — caller can't tell whether the canonical pipeline resolved to
  `transformers.js`, `ruvector`, or `hash-fallback` (F-08-008). Combined
  with the silent fallback in `embedding-pipeline._doInitialize`
  (the `try { transformers } catch { try { ruvector } catch { hash }`
  chain that only `console.warn`s — F-08-002), users cannot detect
  silent hash mode without inspecting stderr.

* **`RvfEmbeddingCache` keys by 32-bit FNV-1a hash with no text
  validation on `get()`** (`rvf-embedding-cache.ts:147-172`). Two
  distinct texts that share the FNV-1a hash collide silently into one
  Map entry; `get()` returns the wrong embedding without any check
  (F-08-004 HIGH). Cache nominally holds 10,000 entries — birthday-paradox
  collision is ~1% at that size.

* **`DEFAULT_DIMENSIONS = 384` in `rvf-embedding-service.ts:50`**
  contradicts the type-file comment "default: 768, ADR-0052" at
  `types.ts:154` and the project-wide canonical 768 (F-08-001).

* **No `EmbeddingPipeline.embed()` queue / backpressure**
  (`embedding-pipeline.ts:185-194`). Concurrent callers race directly
  through `this.model(text, ...)` — transformers.js pipelines are not
  reentrant; under load this risks `ort` (ONNX runtime) state corruption
  or silent slowdown (F-08-009 MEDIUM).

* **No tokenizer integration; chunker is character-only**. mpnet's
  512-token limit is never enforced (`chunking.ts:294-308` —
  `chunkByToken` is `chunkBySentence` with `maxChunkSize * 4` as a
  rough proxy). Input texts exceeding 512 tokens get silently
  truncated by transformers.js (F-08-010 MEDIUM).

## Trace — one embedding from MCP call to consumer

The live `mcp__ruflo__embeddings_generate` MCP call goes:

```
embeddings_tools.ts:317 handler
  → loadConfig() (reads .claude-flow/embeddings.json)
  → generateRealEmbedding(text, dim)
    → getRealEmbeddingFunction()
      → dynamic import('../memory/memory-router.js').generateEmbedding
    → memory-router.generateEmbedding (re-export at line 2706)
      → dynamic import('@claude-flow/memory/embedding-adapter')
      → embedding-adapter.generateEmbedding(text)
        → agentdb.applyTaskPrefix(text, 'document')  [best-effort try/catch]
        → getPipeline() ?? loadEmbeddingModel()
          → initPipeline(config.embedding) [singleton, init-promise serialised]
            → EmbeddingPipeline._doInitialize()
              → try @xenova/transformers
                pipeline('feature-extraction', model)  ← model loaded HERE
              → catch → try ruvector
              → catch → hash-fallback
              → probe embedding → throw DimensionMismatchError if wrong dim
        → pipeline.embed(processedText)
          → embedInternal()
            → model(text, { pooling: 'mean', normalize: true })  [L2-normalised by HF]
            → return Float32Array(output.data)
          → throw DimensionMismatchError if length != configured dim
  → fallback hash path (embeddings-tools.ts:140-155) if realFn missing/threw
  → optional toPoincare(emb, curvature) for hyperbolic geometry
  → return { embedding, metadata }
```

Caches / queues along the way:

| Location | Type | Key shape | Eviction | Namespaced? |
|---|---|---|---|---|
| `embedding-pipeline.ts` | (none) | — | — | — |
| `embedding-adapter.ts` | (none) | — | — | — |
| `embedding-service.ts` LRUCache | in-mem Map | full text (string) | LRU on `maxSize` | per-service instance |
| `RvfEmbeddingService` LRUCache | in-mem Map | full text (string) | LRU on `maxSize` | per-service instance |
| `RvfEmbeddingCache` (persistent .bin) | Map<uint32, entry> | **32-bit FNV-1a hash** | LRU + TTL 7d | no |
| `PersistentEmbeddingCache` (sql.js .db) | SQLite | `emb_<fnv-hex>_<length>` | LRU + TTL 7d | no |
| `learning-service.mjs` embeddingCache | in-mem Map | **`text.slice(0, 200)`** | FIFO @ 1000 | no |
| `OptimizedEmbedder` (agentic-flow) | own internal LRU | — (opaque) | own | — |
| `Transformers.js` pipeline | own internal | — (opaque) | — | — |

No process-level queue or concurrency limit anywhere; concurrent embed
calls race directly through the transformers.js pipeline (F-08-009).

## Findings

### F-08-001 [HIGH] V3 'auto' provider prefers hash over neural; RVF default dim is 384, not 768

- File: `/Users/henrik/source/forks/ruflo/v3/@claude-flow/embeddings/src/embedding-service.ts:945-1000`,
  `rvf-embedding-service.ts:50`, `types.ts:154`
- Sound: NO — direct violation of `feedback-no-fallbacks` and
  `reference-embedding-model`. `createEmbeddingServiceAsync({ provider:
  'auto' })` tries `RvfEmbeddingService` (hash) FIRST (line 947-955),
  then AgenticFlow, then Transformers. The comment at line 925 even
  documents this: "auto provider picks best available: agentic-flow >
  transformers > mock" — but the code disagrees with its own docstring.
- Complete: NO — `DEFAULT_DIMENSIONS = 384` in `rvf-embedding-service.ts`
  contradicts the type comment "default: 768, ADR-0052" at `types.ts:154`
  and the project canonical 768. If a caller passes only `{ provider:
  'rvf' }` (no `dimensions`), they get a 384-dim hash vector — instant
  `DimensionMismatchError` against the 768 substrate.
- Evidence:

```ts
// embedding-service.ts:946-955
if (provider === 'auto') {
  // Try RVF first (52KB, always available, fast hash embeddings)
  try {
    const service = new RvfEmbeddingService({
      provider: 'rvf',
      dimensions: rest.dimensions ?? 384,  // wrong default
      cacheSize: rest.cacheSize,
    });
    await service.embed('test');
    return service;  // returns immediately — never tries ONNX
  } catch { /* fall through */ }
```

- Suggestion: `auto` should try ONNX (transformers.js / agentic-flow)
  FIRST, fall back to hash only with `provider: 'mock-hash'` explicit
  opt-in. `DEFAULT_DIMENSIONS` should be 768. The whole `embedding-service.ts`
  stack is currently dead (see F-08-011), but leaving it exported with a
  hash-first 'auto' is a footgun for any future consumer.

### F-08-002 [HIGH] Canonical EmbeddingPipeline silently falls back to hash on ANY ONNX failure

- File: `/Users/henrik/source/forks/ruflo/v3/@claude-flow/memory/src/embedding-pipeline.ts:147-167, 222-244`
- Sound: NO — direct violation of `feedback-no-fallbacks`. Per memory
  `project-memory-search-rvf-snapshot-isolation` this is the layer
  where bug reports show "search returns 0 results" without an error.
- Complete: PARTIAL — the dimension-mismatch probe (line 169-173) IS a
  loud fail, but the initial `try @xenova/transformers` only logs
  `console.warn` and proceeds to ruvector, then hash. At runtime the
  user sees `[embedding-pipeline] transformers.js failed: ... Using
  hash-fallback (search quality degraded)` on stderr only — no
  programmatic signal, MCP/CLI exit 0, all subsequent searches return
  garbage similarities (~0.05-0.28 between any pair).
- Compounding: `memory-router.ts:880` wraps the init in another
  silent `try { ... } catch { /* hash fallback will be used */ }` with
  not even a `console.warn` — the original error is dropped entirely.
- Compounding (CVE): the V3 `transformers-loader.ts` (ADR-094) prefers
  `@huggingface/transformers` to clear the protobufjs <7.5.5 critical
  RCE chain. The canonical pipeline hardcodes `import('@xenova/transformers')`
  at line 149 — never touches the loader. CVE protection is unwired
  in the live path.
- Suggestion: Re-throw transformers.js failures unless an explicit
  `embedding.fallback: 'hash'` config flag is set. Route the live path
  through `loadTransformersPipeline()` to pick up ADR-094 protection.
  At minimum, surface the actual error through the MCP `embeddings_status`
  response (see F-08-008).

### F-08-003 [HIGH] embeddings_search MCP tool bypasses ADR-0227 adaptive 0.15 threshold

- File: `/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/embeddings-tools.ts:484`
- Sound: NO — hardcoded `threshold = (input.threshold as number) || 0.5`
  supplies 0.5 to `routeMemoryOp` whenever the caller doesn't pass one.
  `getAdaptiveThreshold(explicitThreshold)` returns `explicitThreshold`
  unconditionally when it is `!== undefined && !== null` — so the
  literal 0.5 is treated as explicit. Adaptive override (`0.15` for
  ONNX, `0.05` for hash) never fires for this entrypoint.
- Complete: NO — per ADR-0227 the mpnet RELATED band is ~0.25-0.65;
  a 0.5 floor cuts well into the band and drops the weak-but-genuine
  matches the ADR was written to recover.
- Evidence:

```ts
const threshold = (input.threshold as number) || 0.5;  // ← forces explicit
...
const searchResult = await routeMemoryOp({
  ...
  threshold,  // adaptive override skipped
  ...
});
```

```ts
// embedding-adapter.ts:187-189
export async function getAdaptiveThreshold(explicitThreshold?: number) {
  if (explicitThreshold !== undefined && explicitThreshold !== null) {
    return explicitThreshold;  // ← 0.5 wins, 0.15 lost
  }
  ...
}
```

- Suggestion: Drop the `|| 0.5` and let `undefined` propagate so
  `getAdaptiveThreshold` returns 0.15 for ONNX. Or call
  `getAdaptiveThreshold(input.threshold)` explicitly at the tool
  boundary.

### F-08-004 [HIGH] RvfEmbeddingCache returns wrong embedding on FNV-1a hash collision

- File: `/Users/henrik/source/forks/ruflo/v3/@claude-flow/embeddings/src/rvf-embedding-cache.ts:147-172, 178-214, 299-306`
- Sound: NO — `entries` is a `Map<number, CacheEntry>` keyed by 32-bit
  FNV-1a hash of the text. `get(text)` looks up by hash only, never
  verifies the stored entry corresponds to the requested text. Two
  distinct texts with the same FNV-1a hash will return the same
  embedding silently.
- Complete: PARTIAL — `set()` writes the new embedding under the
  colliding hash, evicting the previous one. `textToHash` is maintained
  but only used by eviction/delete, never consulted by `get()`.
- Probability: at 10,000 entries (default `maxSize`), birthday-paradox
  collision probability is ~1.16%. Real-world text streams (logs,
  prompts, code snippets) hit FNV-1a collisions more readily than the
  ideal model.
- Evidence:

```ts
// rvf-embedding-cache.ts:147-172
async get(text: string): Promise<Float32Array | null> {
  await this.ensureInitialized();
  const hash = this.hashText(text);          // 32-bit FNV-1a
  const entry = this.entries.get(hash);      // ← Map<number, ...>
  if (!entry) return null;
  // ... TTL check ...
  return entry.embedding;                     // ← no text verification
}
```

  `RvfEmbeddingService` always wires this cache when `cachePath` is
  provided (`rvf-embedding-service.ts:154-160`), so any consumer of
  RVF persistent caching is exposed.
- Suggestion: Store `text` (or a high-entropy hash like SHA-256 prefix)
  alongside `embedding` in `CacheEntry`; verify on `get()`. Use a
  `Map<string, CacheEntry>` keyed by the original text or by a
  collision-resistant digest.

### F-08-005 [HIGH] learning-service.mjs has 200-char key collisions and silent input truncation

- File: `/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/.claude/helpers/learning-service.mjs:484-534`
- Sound: NO — three independent problems compound:
  1. `text.slice(0, 200)` is used as the cache key (line 495). Any two
     distinct strings sharing the first 200 chars collide silently into
     the same cached embedding.
  2. `text.slice(0, 500)` is fed into `this.embedder.embed(...)` (line
     505 + 527). Inputs over 500 chars are truncated without warning
     before they hit the ONNX model.
  3. The initial `try { agentic-flow.init }` path falls through to
     `_fallbackEmbed` on ANY error or when the file isn't found — only
     a `console.log` records the regression. After that all reasoning-bank
     similarity scores are hash garbage.
- Complete: PARTIAL — works in the happy path (full agentic-flow ONNX
  available, short texts), breaks silently in every degraded state.
- Evidence:

```js
// :502-512
if (this.useAgenticFlow && this.embedder) {
  try {
    embedding = await this.embedder.embed(text.slice(0, 500));  // silent trunc
  } catch (e) {
    console.log(`[Embedding] ONNX failed, using fallback: ${e.message}`);
    embedding = this._fallbackEmbed(text);  // silent hash fallback
  }
} else {
  embedding = this._fallbackEmbed(text);    // silent hash fallback (init failed)
}
```

- Suggestion: Use a full-text hash (or a Bloom-filter-style longer
  prefix) for the cache key, OR store the text alongside the embedding
  and verify on hit. Reject inputs over 512 tokens loudly; integrate
  the model's tokenizer for accurate length. Drop the hash fallback
  per `feedback-no-fallbacks` — fail loud, log the actual error.

### F-08-006 [INFO] EmbeddingPipeline init-promise race serialisation is correct

- File: `/Users/henrik/source/forks/ruflo/v3/@claude-flow/memory/src/embedding-pipeline.ts:127-177`
- Sound: PASS — both `EmbeddingPipeline.initialize()` and the module-level
  `initPipeline()` serialise concurrent callers behind a single in-flight
  promise (`_initPromise` and `_initPromise` respectively). First caller
  wins; subsequent callers await the same promise. No double-load race.
- Note for completeness — flagged as PASS, not a defect.

### F-08-007 [INFO] Dimension-strict check is real and correctly placed

- File: `/Users/henrik/source/forks/ruflo/v3/@claude-flow/memory/src/embedding-pipeline.ts:42-48, 170-173, 190-192`
- Sound: PASS — `cosineSimilarity` throws `DimensionMismatchError` on
  length mismatch; `initialize()` throws on probe-vs-configured
  mismatch; every `embed()` re-validates. `memory-router._isFatalInitError`
  picks up `DimensionMismatchError` direct throws (per slice 04 of the
  May-19 audit).
- The 384→768 trap from `feedback-full-model-names` is correctly caught
  HERE. The trap remains live in the V3 `embedding-service.ts` stack
  (F-08-001) but does not reach a live path.

### F-08-008 [MEDIUM] embeddings_status does not expose live pipeline provider

- File: `/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/embeddings-tools.ts:872-940`
- Sound: PARTIAL — surfaces `config.model`, `config.dimension`, and a
  granular `ruvectorStatus { available, enabled, version }`, but does
  NOT call into the live `EmbeddingPipeline.getProvider()` (which
  returns one of `'transformers.js' | 'ruvector' | 'hash-fallback'`).
  After F-08-002's silent fallback fires, the user has no MCP signal
  that the pipeline resolved to hash; only stderr `console.warn`.
- Complete: NO for the slice question "where does the use-real-mpnet
  vs use-hash-fallback decision surface?". The answer today is "in
  stderr logs of the process that loaded the pipeline" — invisible to
  MCP callers.
- Suggestion: Import `getPipeline` from `@claude-flow/memory/embedding-pipeline`
  and add `runtime: { provider, isInitialized, dimension }` to the
  `embeddings_status` response. Honest signal for `feedback-no-fallbacks`.

### F-08-009 [MEDIUM] No queue / concurrency limit on transformers.js pipeline

- File: `/Users/henrik/source/forks/ruflo/v3/@claude-flow/memory/src/embedding-pipeline.ts:185-194, 220-244`
- Sound: PARTIAL — `EmbeddingPipeline.embed()` has no semaphore or
  queue. Concurrent callers race directly through `this.model(text,
  { pooling: 'mean', normalize: true })`. Transformers.js pipelines
  share an ORT (ONNX Runtime) session; concurrent inference on the
  same session is officially "supported but performance-undefined" and
  empirically causes either contention slowdown or — in older
  onnxruntime-node — `ORT_FAIL` errors that the V3
  pipeline would silently swallow into the hash fallback (F-08-002).
- `embedding-adapter.generateBatchEmbeddings` exposes a `concurrency`
  knob but it's caller-supplied, optional, defaults to `texts.length`
  (full parallelism, line 134). No process-level upper bound.
- Suggestion: Wrap `embedInternal` in a `p-limit(1)` (or configurable
  N) semaphore for the transformers.js branch. Document the chosen
  limit in `EmbeddingPipeline.getProvider()`.

### F-08-010 [MEDIUM] No tokenizer; chunker uses chars/4 approximation

- File: `/Users/henrik/source/forks/ruflo/v3/@claude-flow/embeddings/src/chunking.ts:294-308`,
  pipeline `embed()` line 185 (no truncation)
- Sound: PARTIAL — `chunkByToken` is just `chunkBySentence` with
  `maxChunkSize * 4` as a chars-per-token guess. Per
  `estimateTokens()` line 313-316, the assumption is "1 token ≈ 4
  chars" — accurate for English ASCII, off by 2x-3x for code, CJK,
  emoji, mixed scripts.
- Complete: NO — mpnet's hard limit is 512 tokens. Inputs that exceed
  it are silently truncated by transformers.js (`truncation: true` is
  the default when not specified). The pipeline never warns; the
  caller has no signal that "embed this 10k-character docstring"
  actually embedded only the first ~2k chars.
- Compounds F-08-005: `learning-service.mjs` truncates at 500 chars
  BEFORE the model, on top of the tokenizer's silent truncation, on
  top of the 200-char cache key. Three layers of silent loss.
- Suggestion: At minimum, log a warning when input exceeds `4 * 512 =
  2048` chars (the conservative bound). Better: expose the model's
  tokenizer (transformers.js gives you `pipeline.tokenizer`) and chunk
  by real tokens at the pipeline boundary.

### F-08-011 [MEDIUM] V3 @claude-flow/embeddings package is dead in CLI/MCP/memory paths

- File: `/Users/henrik/source/forks/ruflo/v3/@claude-flow/embeddings/src/embedding-service.ts` (1169 LOC),
  `rvf-embedding-service.ts` (382 LOC), `persistent-cache.ts` (410 LOC),
  `rvf-embedding-cache.ts` (578 LOC), `neural-integration.ts` (340 LOC),
  `hyperbolic.ts` (458 LOC), `chunking.ts` (353 LOC) — total ~4,470 LOC
- Sound: N/A (dead code)
- Complete: N/A
- Evidence: `grep -r 'createEmbeddingService\|new (Rvf|Transformers|
  AgenticFlow|OpenAI|Mock)EmbeddingService' --include='*.ts' v3 |
  grep -v node_modules | grep -v dist | grep -v __tests__ | grep -v
  '\.test\.'` returns ONLY internal references inside the
  `@claude-flow/embeddings` package itself plus one doc-comment in
  `plugins/examples/ruvector-plugins/reasoning-bank.ts:313`. Live
  consumers (`mcp-tools/embeddings-tools.ts`, `memory-router.ts`,
  `controller-registry.ts`, `cli/.claude/helpers/learning-service.mjs`)
  all import from `@claude-flow/memory/embedding-adapter` or
  `@claude-flow/memory/embedding-pipeline`.
- Matches the May-19 audit's cross-cutting pattern: parallel
  implementation, wrong one wired (here, the parallel one is the
  richer-featured one that includes CVE protection, persistent cache,
  hyperbolic geometry, and a defendable test surface — but it's the
  dead path).
- Suggestion: Either migrate `embedding-adapter`/`embedding-pipeline`
  to consume `@claude-flow/embeddings`'s `TransformersEmbeddingService`
  + `transformers-loader.ts` (gaining CVE protection, queue, persistent
  cache), OR delete the package and absorb the few useful pieces
  (chunking, hyperbolic) into `@claude-flow/memory`. Currently we
  maintain both and bug-fix neither.

### F-08-012 [LOW] PersistentEmbeddingCache hash key has no dim namespace

- File: `/Users/henrik/source/forks/ruflo/v3/@claude-flow/embeddings/src/persistent-cache.ts:174-182`
- Sound: PARTIAL — cache key shape is `emb_<fnv-hex>_<length>`. The
  `length` suffix is the text length, NOT the embedding dimension.
  A cache file written by a 384-dim mpnet test run can be read back
  by a 768-dim production run; the `dimensions` column on disk would
  flag the mismatch IF the caller checks `embedding.length` after
  deserialize — `PersistentEmbeddingCache.get()` does NOT verify
  (line 194-199 just deserializes against the stored dim).
- Compounds F-08-001 default-dim drift.
- Suggestion: Either include the configured pipeline dim in the cache
  key prefix (`emb_d768_<fnv>_<length>`), or refuse to load entries
  whose stored `dimensions` field does not match the configured dim.

### F-08-013 [LOW] ruvector branch does not normalise

- File: `/Users/henrik/source/forks/ruflo/v3/@claude-flow/memory/src/embedding-pipeline.ts:232-240`
- Sound: PARTIAL — when `provider === 'ruvector'`, the pipeline
  returns `model.embed(text)` directly. ruvector's `embed` may or may
  not return a unit vector; the pipeline does not enforce it. The
  cosine-direct path per ADR-0073 amendment / RVF-cosine-metric
  recovery assumes unit vectors. Hash-fallback (line 86-95) and
  transformers.js (`normalize: true`) both produce unit vectors;
  ruvector is the odd one out.
- Today this is latent — the ruvector branch is reachable only when
  transformers.js fails first AND ruvector is installed AND exports
  an `embed` function (line 159). But once reached, the resulting
  vectors silently lose comparability with cached transformers.js
  vectors written under the same RVF substrate.
- Suggestion: Always L2-normalise at `embedInternal` boundary
  regardless of provider. Document `EmbeddingPipeline.embed()` as
  "returns unit-norm vector".

## Cross-cutting Patterns

1. **Three parallel implementations of the same subsystem**, wrong
   one wired — same pattern flagged across hooks (F-01-002), MCP
   server (F-09-*), daemon (F-10-*) in the May-19 audit. Here:
   `@claude-flow/memory/embedding-{pipeline,adapter}.ts` (live) vs
   `@claude-flow/embeddings/embedding-service.ts` (dead, richer) vs
   `learning-service.mjs` (third hand-rolled). CVE-mitigated loader
   (`transformers-loader.ts`) is in the dead path.

2. **Silent hash fallback at three layers**:
   `embedding-pipeline._doInitialize` (F-08-002),
   `memory-router.ts:880` wrapper (F-08-002),
   `learning-service.mjs:484-512` (F-08-005). All log to stderr only;
   none surface programmatically. Caller can't tell whether searches
   returned poor results because of low corpus relevance or because
   the entire embedding subsystem fell back to hash.

3. **Silent input truncation at multiple layers** — F-08-005 (200-char
   cache key + 500-char model input in learning-service) compounds
   the transformers.js default `truncation: true` (F-08-010). User
   asks for an embedding of a 10kB document, gets a vector representing
   the first ~2k chars, with no warning.

4. **Cache key collisions in two distinct caches**: `RvfEmbeddingCache`
   uses 32-bit FNV-1a (F-08-004), `learning-service.mjs` uses
   200-char prefix (F-08-005). Both return cached entries WITHOUT
   verifying the stored text matches the requested text. Both have
   probability >0 of silent wrong-answer regression.

5. **Per-tier and per-tool config-default drift** — RVF default dim
   384 vs canonical 768 (F-08-001), `embeddings_search` MCP threshold
   default 0.5 vs adaptive 0.15 (F-08-003). The init template
   (`config-template.ts:84-89`) correctly writes the canonical
   `embedding: { provider: 'onnx', model: 'Xenova/all-mpnet-base-v2',
   dimension: 768 }`; defaults in downstream code paths drift below
   that.

6. **"use real mpnet vs use hash-fallback" decision is inconsistent
   across surfaces**:
   - Live `EmbeddingPipeline` — defaults to mpnet, silently falls back
     to hash on any error (F-08-002).
   - `learning-service.mjs` — checks for `agentic-flow/dist/...`
     file existence; if missing, sets `useAgenticFlow=false` silently
     and uses hash thereafter (F-08-005).
   - `createEmbeddingServiceAsync('auto')` (V3, unwired) — prefers
     hash over neural by code order (F-08-001).
   - `embeddings_status` MCP — does not report which one is live
     (F-08-008).

## Out of Scope

- Hyperbolic geometry / Poincaré projections — `hyperbolic.ts` (458
  LOC) and `embeddings_hyperbolic` MCP tool. Not on the embedding
  hot-path the audit was scoped to.
- HNSW index parameters (M=23, efC=100, efS=50) — covered by slice 04
  May-19 audit; the contract lives in `config-template.ts` /
  `HNSWLibBackend`, not the embedding pipeline.
- Persistent cache schema migration — `PersistentEmbeddingCache`
  (sql.js) vs `RvfEmbeddingCache` (binary file) coexist with no
  defined migration; orthogonal to the live pipeline.
- agentdb-side `applyTaskPrefix` correctness — slice 04 territory.
- ADR-0227 floor calibration math — accepted; only the wiring at the
  MCP `embeddings_search` entrypoint is in scope (F-08-003).
- `neural-integration.ts` (340 LOC, includes `downloadEmbeddingModel`
  with #1700 / #1468 handling) — touched only enough to confirm it
  imports from the dead `@claude-flow/embeddings` path and is itself
  exported but not consumed by the live MCP pipeline.
