/**
 * Stub controllers for ADR-0068 Wave 4
 *
 * These controllers are implemented in the ruflo-patch repo and wired
 * into the controller-registry via config.json's controllers.enabled map.
 *
 * - agentMemoryScope: Re-exported from @claude-flow/memory (upstream)
 * - hybridSearch: BM25 + HNSW reciprocal rank fusion
 * - federatedSession: Shared session transport for cross-agent state sync
 *
 * @module ruflo-patch/controllers
 */

export { HybridSearchController } from './hybrid-search.js';
export type { HybridSearchOptions, HybridSearchResult } from './hybrid-search.js';

export { FederatedSessionController } from './federated-session.js';
export type { SessionInfo, JoinResult, SyncResult } from './federated-session.js';

// agentMemoryScope is already exported from @claude-flow/memory:
// import { createAgentBridge, resolveAgentMemoryDir, listAgentScopes } from '@claude-flow/memory';
// No re-export needed — it is wired via the controller-registry, not this barrel.
