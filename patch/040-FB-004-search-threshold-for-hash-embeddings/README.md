# FB-004: Lower search threshold for hash-based embeddings

**Severity**: Medium

## Root Cause
The default search threshold (0.3) is tuned for ONNX/transformer embeddings (384-dim, high cosine similarity). When using hash-based embeddings (the fallback when agentic-flow is not installed), cosine similarity between related texts rarely exceeds 0.28. This causes most search results to be filtered out, making search effectively broken for hash embeddings.

## Fix
1. Lower the default threshold in `bridgeSearchEntries` from 0.3 to 0.1
2. Lower the default threshold in `searchEntries` (memory-initializer.js) from 0.3 to 0.1
3. Hash embeddings still produce meaningful relative ordering — lowering threshold surfaces results that BM25+semantic hybrid scoring can rank

## Files Patched
- memory/memory-bridge.js (bridgeSearchEntries default threshold)
- memory/memory-initializer.js (searchEntries default threshold)

## ADR

[ADR-0004](../../docs/adr/0004-search-threshold-for-hash-embeddings.md)

## Ops
4 ops in fix.py
