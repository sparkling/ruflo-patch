# FB-001: Instrument upstream fallback paths with debug logging

**Severity**: High

## Root Cause
Multiple fallback code paths in @claude-flow/cli silently degrade functionality without logging. ONNX embeddings fall back to hash-based, HNSW falls back to brute-force, ControllerRegistry fails silently, and agentic-flow modules load as null — all without debug data.

## Fix
Add `console.warn('[RUFLO-FALLBACK] FB-001-XX: ...')` with JSON debug data at each fallback point.

## Files Patched
- memory/memory-initializer.js (embedding chain, HNSW fallback, keyword fallback, generateEmbedding fallback)
- memory/memory-bridge.js (ControllerRegistry init, path traversal)
- services/agentic-flow-bridge.js (module loading)
- mcp-tools/embeddings-tools.js (ONNX fallback)

## ADR

[ADR-0002](../../docs/adr/0002-fallback-instrumentation.md)

## Ops
10 ops in fix.py
