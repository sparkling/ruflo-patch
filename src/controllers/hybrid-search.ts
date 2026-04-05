/**
 * HybridSearch Controller — BM25 + HNSW Fusion
 *
 * Combines lexical BM25 text scoring with HNSW vector similarity
 * using reciprocal rank fusion (RRF). Routes all storage operations
 * through the IMemoryBackend abstraction — never calls better-sqlite3 directly.
 *
 * ADR-0068 Wave 4 stub controller.
 *
 * @module ruflo-patch/controllers/hybrid-search
 */

// ===== Types (mirrors @claude-flow/memory/src/types.ts contracts) =====

/** Subset of IMemoryBackend used by HybridSearch */
interface IMemoryBackend {
  query(query: MemoryQuery): Promise<MemoryEntry[]>;
  search(embedding: Float32Array, options: SearchOptions): Promise<SearchResult[]>;
}

interface MemoryEntry {
  id: string;
  key: string;
  content: string;
  embedding?: Float32Array;
  namespace: string;
  tags: string[];
  metadata: Record<string, unknown>;
  [k: string]: unknown;
}

interface MemoryQuery {
  type: 'semantic' | 'exact' | 'prefix' | 'tag' | 'hybrid';
  content?: string;
  namespace?: string;
  tags?: string[];
  limit: number;
  [k: string]: unknown;
}

interface SearchOptions {
  k: number;
  ef?: number;
  threshold?: number;
  filters?: MemoryQuery;
}

interface SearchResult {
  entry: MemoryEntry;
  score: number;
  distance: number;
}

// ===== BM25 Helpers =====

/** Simple BM25 term-frequency scoring (no IDF — single-document context) */
function bm25Score(
  query: string,
  document: string,
  k1 = 1.2,
  b = 0.75,
  avgDl = 100,
): number {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const docTerms = document.toLowerCase().split(/\s+/).filter(Boolean);
  const dl = docTerms.length;

  if (terms.length === 0 || dl === 0) return 0;

  // Build term frequency map for the document
  const tf = new Map<string, number>();
  for (const t of docTerms) {
    tf.set(t, (tf.get(t) ?? 0) + 1);
  }

  let score = 0;
  for (const term of terms) {
    const freq = tf.get(term) ?? 0;
    if (freq === 0) continue;
    // BM25 term score (IDF assumed 1.0 — single-collection approximation)
    score += (freq * (k1 + 1)) / (freq + k1 * (1 - b + b * (dl / avgDl)));
  }

  return score;
}

// ===== Reciprocal Rank Fusion =====

interface RankedItem {
  id: string;
  entry: MemoryEntry;
}

/**
 * Reciprocal Rank Fusion merges two ranked lists.
 * RRF(d) = sum over lists L of 1 / (k + rank_L(d))
 * where k is a constant (default 60).
 */
function reciprocalRankFusion(
  listA: RankedItem[],
  listB: RankedItem[],
  k = 60,
): Array<{ entry: MemoryEntry; score: number }> {
  const scores = new Map<string, { entry: MemoryEntry; score: number }>();

  for (let i = 0; i < listA.length; i++) {
    const item = listA[i];
    const existing = scores.get(item.id);
    const rrf = 1 / (k + i + 1);
    if (existing) {
      existing.score += rrf;
    } else {
      scores.set(item.id, { entry: item.entry, score: rrf });
    }
  }

  for (let i = 0; i < listB.length; i++) {
    const item = listB[i];
    const existing = scores.get(item.id);
    const rrf = 1 / (k + i + 1);
    if (existing) {
      existing.score += rrf;
    } else {
      scores.set(item.id, { entry: item.entry, score: rrf });
    }
  }

  return Array.from(scores.values()).sort((a, b) => b.score - a.score);
}

// ===== HybridSearch Controller =====

export interface HybridSearchOptions {
  /** Text query for BM25 scoring */
  query: string;
  /** Pre-computed embedding for HNSW search */
  embedding: Float32Array;
  /** Namespace filter */
  namespace?: string;
  /** Maximum results (default: 10) */
  limit?: number;
  /** BM25 weight in weighted combination (0-1, default: 0.4) */
  bm25Weight?: number;
  /** Minimum score threshold (default: 0) */
  threshold?: number;
  /** HNSW ef search parameter */
  ef?: number;
}

export interface HybridSearchResult {
  entry: MemoryEntry;
  /** Fused score from RRF */
  score: number;
  /** Individual BM25 score */
  bm25Score: number;
  /** Individual HNSW similarity score */
  hnswScore: number;
}

export class HybridSearchController {
  private readonly backend: IMemoryBackend;

  constructor(backend: IMemoryBackend) {
    this.backend = backend;
  }

  /**
   * Execute a hybrid search combining BM25 text scoring with HNSW vector similarity.
   * Uses reciprocal rank fusion to merge the two ranked lists.
   */
  async search(options: HybridSearchOptions): Promise<HybridSearchResult[]> {
    const {
      query,
      embedding,
      namespace,
      limit = 10,
      threshold = 0,
      ef,
    } = options;

    // Fetch more candidates than needed for fusion quality
    const candidateLimit = Math.max(limit * 3, 30);

    // Run BM25 (text) and HNSW (vector) searches in parallel
    const [textResults, vectorResults] = await Promise.all([
      this.backend.query({
        type: 'hybrid',
        content: query,
        namespace,
        limit: candidateLimit,
      }),
      this.backend.search(embedding, {
        k: candidateLimit,
        ef,
        threshold,
        filters: namespace ? { type: 'hybrid', namespace, limit: candidateLimit } : undefined,
      }),
    ]);

    // Score BM25 results
    const bm25Scored = textResults
      .map((entry) => ({
        id: entry.id,
        entry,
        bm25: bm25Score(query, entry.content),
      }))
      .sort((a, b) => b.bm25 - a.bm25);

    // Build HNSW ranked list
    const hnswRanked: Array<RankedItem & { hnswScore: number }> = vectorResults.map((r) => ({
      id: r.entry.id,
      entry: r.entry,
      hnswScore: r.score,
    }));

    // Reciprocal rank fusion
    const fused = reciprocalRankFusion(
      bm25Scored.map((r) => ({ id: r.id, entry: r.entry })),
      hnswRanked.map((r) => ({ id: r.id, entry: r.entry })),
    );

    // Build lookup maps for individual scores
    const bm25Map = new Map(bm25Scored.map((r) => [r.id, r.bm25]));
    const hnswMap = new Map(hnswRanked.map((r) => [r.id, r.hnswScore]));

    return fused
      .filter((r) => r.score >= threshold)
      .slice(0, limit)
      .map((r) => ({
        entry: r.entry,
        score: r.score,
        bm25Score: bm25Map.get(r.entry.id) ?? 0,
        hnswScore: hnswMap.get(r.entry.id) ?? 0,
      }));
  }
}

export default HybridSearchController;
