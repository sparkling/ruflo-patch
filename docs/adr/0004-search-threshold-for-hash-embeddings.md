# ADR-0004: Lower search threshold for hash-based embeddings

## Status

Implemented

## Context

### Specification (SPARC-S)

The `@claude-flow/cli` memory system uses cosine similarity to rank search results against a configurable threshold. Results below the threshold are discarded. The default threshold is `0.3`, hardcoded in four locations across the codebase.

This threshold was tuned for ONNX/transformer embeddings (384-dimensional vectors from models like Xenova or ReasoningBank), which produce cosine similarity scores of ~0.6–0.95 between semantically related texts. However, when the ONNX runtime is unavailable — which is the common case, since `agentic-flow` is an optional dependency — the system falls back to `generateHashEmbedding`, a deterministic hash-based embedding algorithm (see FB-001-01, FB-001-02).

Hash embeddings produce cosine similarity scores of ~0.1–0.28 for related texts. With a threshold of `0.3`, **every hash-based search result is filtered out**, making memory search effectively non-functional for the majority of installations that lack the ONNX runtime.

The problem is compounded by the threshold being hardcoded in four independent locations, so a caller cannot fix it from a single entry point.

### Pseudocode (SPARC-P)

```
FOR each location where threshold defaults to 0.3:
  REPLACE default 0.3 with 0.1
  PRESERVE caller override capability (threshold parameter still accepted)
```

## Decision

### Architecture (SPARC-A)

Lower the default similarity threshold from `0.3` to `0.1` in all four locations where it is hardcoded. The threshold remains a parameter — callers who pass an explicit value are unaffected.

The value `0.1` was chosen empirically: hash embeddings for related texts produce similarities in the 0.1–0.28 range, so `0.1` admits meaningful results while still filtering noise. The relative ordering of results remains valid — hash embeddings produce consistent rankings even if absolute scores are lower — so downstream hybrid scoring (BM25 + semantic) can still rank effectively.

### Considered Alternatives

1. **Dynamic threshold based on embedding type** — Rejected. Would require threading the embedding model type through four call sites and all their callers. High complexity for a default that callers can already override.
2. **Normalize hash embeddings to match ONNX score ranges** — Rejected. Hash embeddings lack semantic meaning by design; inflating scores would create false confidence without improving ranking quality.
3. **Remove threshold entirely (return all results)** — Rejected. Without any filtering, brute-force searches over large databases return excessive noise. A lower threshold still provides useful filtering.
4. **Set threshold to 0.0** — Rejected. Would return all stored entries including completely unrelated ones, defeating the purpose of similarity search.

### Scope

| Op | File | Change |
|----|------|--------|
| FB-004a | memory/memory-bridge.js | `bridgeSearchEntries` default threshold 0.3 to 0.1 |
| FB-004b | memory/memory-initializer.js | `searchEntries` default threshold 0.3 to 0.1 |
| FB-004c | commands/memory.js | CLI `memory search` default threshold 0.3 to 0.1 |
| FB-004d | mcp-tools/memory-tools.js | MCP `memory_search` default threshold 0.3 to 0.1 |

## Consequences

### Refinement (SPARC-R)

**Positive:**

- Memory search returns results when using hash-based embeddings, restoring functionality for installations without ONNX
- The fix is minimal (4 single-line changes) and easy to reason about
- Callers who explicitly pass `threshold` are completely unaffected
- Hash embeddings still produce meaningful relative ordering, so hybrid BM25+semantic scoring ranks results correctly even with lower absolute similarity scores

**Negative:**

- Installations with ONNX embeddings may see slightly more low-confidence results in search output (scores 0.1–0.3 that were previously filtered)
- The threshold is a compromise — too low for ONNX-quality filtering, but necessary for hash embedding viability

**Neutral:**

- Does not change the hash embedding algorithm itself
- Does not affect storage, only retrieval filtering
- A future upstream fix could implement per-model-type thresholds, making this patch unnecessary

### Completion (SPARC-C)

- All 4 ops implemented and verified via `bash patch-all.sh --global`
- Idempotency confirmed (second apply reports "already present")
- `bash check-patches.sh` passes
- `npm run preflight` passes

## Patch Reference

- **Defect ID**: FB-004
- **Patch directory**: `patch/040-FB-004-search-threshold-for-hash-embeddings/`
- **Target files**: `memory-bridge.js`, `memory-initializer.js`, `commands/memory.js`, `mcp-tools/memory-tools.js`
- **Empirical data**: Hash embeddings produce cosine similarity ~0.1–0.28 for related texts vs ONNX ~0.6–0.95
- **Patch**: `patch/040-FB-004-search-threshold-for-hash-embeddings/`
