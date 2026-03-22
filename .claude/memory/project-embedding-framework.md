---
name: Embedding config framework
description: Config-driven embedding model selection — single source of truth in agentdb/src/config/embedding-config.ts
type: project
---

## Embedding Config Framework (ADR-0052)

The embedding system is now config-driven. Changing models = editing `embeddings.json`, no code changes.

**Single source of truth**: `agentdb/src/config/embedding-config.ts`
- `getEmbeddingConfig()` — layered resolution: overrides > env vars > embeddings.json > MODEL_REGISTRY > defaults
- `MODEL_REGISTRY` — 19 models with dimension, context window, task prefixes, provider
- `deriveHNSWParams(dim)` — auto M/efConstruction/efSearch from dimension
- `applyTaskPrefix(text, intent)` — model-specific query/document prefixes

**Why:** The predecessor project (claude-flow-patch) was blocked by a P0 "dimension war" — 384 vs 768 hardcoded in 20+ files. ADR-0052 resolved this by centralizing config.

**How to apply:** When embedding-related code needs a dimension, model name, or provider — import from `agentdb` config, never hardcode.

**Config methods:**
- File: `.claude-flow/embeddings.json` (`model`, `dimension`, `provider`, `taskPrefixQuery`, `taskPrefixIndex`)
- Env: `AGENTDB_EMBEDDING_MODEL`, `AGENTDB_EMBEDDING_DIM`, `AGENTDB_EMBEDDING_PROVIDER`
- Code: `getEmbeddingConfig({ model: '...', dimension: N })` for explicit overrides

**Current default**: `nomic-ai/nomic-embed-text-v1.5` at 768-dim (86% retrieval, 8K context, Matryoshka)

**Server**: Dedicated Ryzen 9 7950X3D / 187GB — ceiling 160GB, rate limits 10x, cache 500K, SONA real-time mode
