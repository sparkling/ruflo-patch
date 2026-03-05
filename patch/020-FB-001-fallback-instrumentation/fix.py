# FB-001: Instrument upstream fallback paths with debug logging

# Local path definitions (also in common.py, duplicated for safety)
AF_BRIDGE = base + "/services/agentic-flow-bridge.js" if base else ""
SEMANTIC_ROUTER = base + "/ruvector/semantic-router.js" if base else ""

# --- FB-001-01: memory-initializer.js — ONNX to hash-based embedding fallback ---
# When no ONNX model (xenova, reasoningbank, agentic-flow) is available, falls back to hash.
patch("FB-001-01: log ONNX→hash embedding fallback in loadEmbeddingModel",
    MI,
    """        // No ONNX model available - use fallback
        embeddingModelState = {
            loaded: true,
            model: null, // Will use simple hash-based fallback
            tokenizer: null,
            dimensions: 128 // Smaller fallback dimensions
        };
        return {
            success: true,
            dimensions: 128,
            modelName: 'hash-fallback',
            loadTime: Date.now() - startTime
        };""",
    """        // No ONNX model available - use fallback
        console.warn('[RUFLO-FALLBACK] FB-001-01: ONNX→hash embedding fallback activated', JSON.stringify({ ts: new Date().toISOString(), primary: 'xenova/reasoningbank/agentic-flow ONNX', fallback: 'hash-based 128-dim', reason: 'no embedding model available', impact: 'CRITICAL: semantic search quality severely degraded' }));
        embeddingModelState = {
            loaded: true,
            model: null, // Will use simple hash-based fallback
            tokenizer: null,
            dimensions: 128 // Smaller fallback dimensions
        };
        return {
            success: true,
            dimensions: 128,
            modelName: 'hash-fallback',
            loadTime: Date.now() - startTime
        };""")

# --- FB-001-02: memory-initializer.js — generateEmbedding ONNX runtime failure ---
# When ONNX model is loaded but fails at runtime, falls through to hash embedding.
patch("FB-001-02: log generateEmbedding ONNX runtime fallback",
    MI,
    """        catch {
            // Fall through to fallback
        }
    }
    // Deterministic hash-based fallback (for testing/demo without ONNX)
    const embedding = generateHashEmbedding(text, state.dimensions);
    return {
        embedding,
        dimensions: state.dimensions,
        model: 'hash-fallback'
    };""",
    """        catch (e) {
            console.warn('[RUFLO-FALLBACK] FB-001-02: generateEmbedding ONNX runtime failure', JSON.stringify({ ts: new Date().toISOString(), primary: 'ONNX model inference', fallback: 'hash-based embedding', error: e?.message || String(e), textLen: text?.length }));
        }
    }
    // Deterministic hash-based fallback (for testing/demo without ONNX)
    console.warn('[RUFLO-FALLBACK] FB-001-02b: using hash-fallback for embedding', JSON.stringify({ ts: new Date().toISOString(), dimensions: state.dimensions, modelLoaded: !!state.model, textLen: text?.length }));
    const embedding = generateHashEmbedding(text, state.dimensions);
    return {
        embedding,
        dimensions: state.dimensions,
        model: 'hash-fallback'
    };""")

# --- FB-001-03: memory-initializer.js — HNSW to brute-force fallback ---
patch("FB-001-03: log HNSW→brute-force search fallback",
    MI,
    """        // Fall back to brute-force SQLite search
        const initSqlJs = (await import('sql.js')).default;""",
    """        // Fall back to brute-force SQLite search
        console.warn('[RUFLO-FALLBACK] FB-001-03: HNSW→brute-force SQLite search', JSON.stringify({ ts: new Date().toISOString(), primary: 'HNSW index search', fallback: 'brute-force SQL scan', hnswResultCount: hnswResults?.length ?? 0, query: query?.substring(0, 50), namespace, impact: 'MEDIUM: 150-12500x slower search' }));
        const initSqlJs = (await import('sql.js')).default;""")

# --- FB-001-04: memory-initializer.js — vector to keyword matching fallback ---
patch("FB-001-04: log vector→keyword matching fallback",
    MI,
    """                // Fallback to keyword matching
                if (score < threshold) {""",
    """                // Fallback to keyword matching
                if (score < threshold) {
                    console.warn('[RUFLO-FALLBACK] FB-001-04: vector→keyword matching', JSON.stringify({ ts: new Date().toISOString(), primary: 'cosine similarity', fallback: 'keyword matching', score, threshold, hasEmbedding: !!embeddingJson, id: String(id).substring(0, 12) }));""")

# --- FB-001-05: memory-bridge.js — ControllerRegistry init failure (SILENT) ---
patch("FB-001-05: log ControllerRegistry init fallback",
    MEMORY_BRIDGE,
    """            catch {
                bridgeAvailable = false;
                registryPromise = null;
                return null;
            }""",
    """            catch (e) {
                console.warn('[RUFLO-FALLBACK] FB-001-05: ControllerRegistry init failed', JSON.stringify({ ts: new Date().toISOString(), primary: '@claude-flow/memory ControllerRegistry', fallback: 'raw sql.js (no AgentDB bridge)', error: e?.message || String(e), dbPath: dbPath || 'default', impact: 'MEDIUM: loses AgentDB optimizations, no RVF storage' }));
                bridgeAvailable = false;
                registryPromise = null;
                return null;
            }""")

# --- FB-001-06: memory-bridge.js — path traversal protection fallback ---
patch("FB-001-06: log path traversal protection fallback",
    MEMORY_BRIDGE,
    """    if (!resolved.startsWith(cwd)) {
        return path.join(swarmDir, 'memory.db'); // fallback to safe default""",
    """    if (!resolved.startsWith(cwd)) {
        console.warn('[RUFLO-FALLBACK] FB-001-06: path traversal blocked', JSON.stringify({ ts: new Date().toISOString(), primary: 'custom path', fallback: 'safe default .swarm/memory.db', attempted: resolved, cwd, impact: 'LOW: security protection' }));
        return path.join(swarmDir, 'memory.db'); // fallback to safe default""")

# --- FB-001-07: agentic-flow-bridge.js — ReasoningBank module loading (SILENT) ---
patch("FB-001-07: log ReasoningBank module loading fallback",
    AF_BRIDGE,
    """        _reasoningBankP = import('agentic-flow/reasoningbank').catch(() => null);""",
    """        _reasoningBankP = import('agentic-flow/reasoningbank').catch((e) => { console.warn('[RUFLO-FALLBACK] FB-001-07: agentic-flow/reasoningbank unavailable', JSON.stringify({ ts: new Date().toISOString(), primary: 'agentic-flow/reasoningbank', fallback: 'null (no ReasoningBank)', error: e?.message || String(e), impact: 'MEDIUM: no ONNX embeddings, no trajectory learning' })); return null; });""")

# --- FB-001-08: agentic-flow-bridge.js — Router module loading (SILENT) ---
patch("FB-001-08: log Router module loading fallback",
    AF_BRIDGE,
    """        _routerP = import('agentic-flow/router').catch(() => null);""",
    """        _routerP = import('agentic-flow/router').catch((e) => { console.warn('[RUFLO-FALLBACK] FB-001-08: agentic-flow/router unavailable', JSON.stringify({ ts: new Date().toISOString(), primary: 'agentic-flow/router', fallback: 'null (no ModelRouter)', error: e?.message || String(e) })); return null; });""")

# --- FB-001-09: agentic-flow-bridge.js — Orchestration module loading (SILENT) ---
patch("FB-001-09: log Orchestration module loading fallback",
    AF_BRIDGE,
    """        _orchestrationP = import('agentic-flow/orchestration').catch(() => null);""",
    """        _orchestrationP = import('agentic-flow/orchestration').catch((e) => { console.warn('[RUFLO-FALLBACK] FB-001-09: agentic-flow/orchestration unavailable', JSON.stringify({ ts: new Date().toISOString(), primary: 'agentic-flow/orchestration', fallback: 'null (no workflow engine)', error: e?.message || String(e) })); return null; });""")

# --- FB-001-10: embeddings-tools.js — ONNX embedding fallback ---
patch("FB-001-10: log embeddings-tools ONNX fallback",
    EMB_TOOLS,
    """    // Fallback: deterministic hash-based (only if ONNX truly unavailable)
    console.warn('[MCP] ONNX unavailable, using fallback embedding');""",
    """    // Fallback: deterministic hash-based (only if ONNX truly unavailable)
    console.warn('[RUFLO-FALLBACK] FB-001-10: embeddings-tools ONNX→hash fallback', JSON.stringify({ ts: new Date().toISOString(), primary: 'ONNX/Transformers.js/ReasoningBank', fallback: 'deterministic hash embedding', dimension, textLen: text?.length, impact: 'CRITICAL: no semantic meaning in embeddings' }));""")
