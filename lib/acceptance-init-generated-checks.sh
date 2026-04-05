#!/usr/bin/env bash
# lib/acceptance-init-generated-checks.sh — Phase 5: Init-generated config validation
#
# Validates what `init` actually generates in a fresh directory.
# Every value check uses node -e JSON parsing with exact comparisons, never grep.
#
# Caller MUST set:
#   P5_DIR  — directory where init was run (contains .claude-flow/)

# ══════════════════════════════════════════════════════════════════════════════
# Group 1: config.json exact values
# ══════════════════════════════════════════════════════════════════════════════

check_p5_ewc_lambda() {
  _CHECK_PASSED="false"
  local cfg="$P5_DIR/.claude-flow/config.json"
  if [[ ! -f "$cfg" ]]; then
    _CHECK_OUTPUT="P5: config.json not found"
    return
  fi
  local val
  val=$(node -e "const c=JSON.parse(require('fs').readFileSync('$cfg','utf-8')); console.log(c.neural?.ewcLambda)" 2>/dev/null)
  if [[ "$val" == "2000" ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="P5: neural.ewcLambda = 2000"
  else
    _CHECK_OUTPUT="P5: neural.ewcLambda = ${val:-missing} (expected 2000)"
  fi
}

check_p5_cache_size() {
  _CHECK_PASSED="false"
  local cfg="$P5_DIR/.claude-flow/config.json"
  if [[ ! -f "$cfg" ]]; then
    _CHECK_OUTPUT="P5: config.json not found"
    return
  fi
  local val
  val=$(node -e "const c=JSON.parse(require('fs').readFileSync('$cfg','utf-8')); console.log(c.memory?.sqlite?.cacheSize)" 2>/dev/null)
  if [[ "$val" == "-64000" ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="P5: memory.sqlite.cacheSize = -64000"
  else
    _CHECK_OUTPUT="P5: memory.sqlite.cacheSize = ${val:-missing} (expected -64000)"
  fi
}

check_p5_mcp_port() {
  _CHECK_PASSED="false"
  local cfg="$P5_DIR/.claude-flow/config.json"
  if [[ ! -f "$cfg" ]]; then
    _CHECK_OUTPUT="P5: config.json not found"
    return
  fi
  local val
  val=$(node -e "const c=JSON.parse(require('fs').readFileSync('$cfg','utf-8')); console.log(c.ports?.mcp)" 2>/dev/null)
  if [[ "$val" == "3000" ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="P5: ports.mcp = 3000"
  else
    _CHECK_OUTPUT="P5: ports.mcp = ${val:-missing} (expected 3000)"
  fi
}

check_p5_window_ms() {
  _CHECK_PASSED="false"
  local cfg="$P5_DIR/.claude-flow/config.json"
  if [[ ! -f "$cfg" ]]; then
    _CHECK_OUTPUT="P5: config.json not found"
    return
  fi
  local val
  val=$(node -e "const c=JSON.parse(require('fs').readFileSync('$cfg','utf-8')); console.log(c.rateLimiter?.default?.windowMs)" 2>/dev/null)
  if [[ "$val" == "60000" ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="P5: rateLimiter.default.windowMs = 60000"
  else
    _CHECK_OUTPUT="P5: rateLimiter.default.windowMs = ${val:-missing} (expected 60000)"
  fi
}

check_p5_optimize_timeout() {
  _CHECK_PASSED="false"
  local cfg="$P5_DIR/.claude-flow/config.json"
  if [[ ! -f "$cfg" ]]; then
    _CHECK_OUTPUT="P5: config.json not found"
    return
  fi
  local val
  val=$(node -e "const c=JSON.parse(require('fs').readFileSync('$cfg','utf-8')); console.log(c.workers?.triggers?.optimize?.timeoutMs)" 2>/dev/null)
  if [[ "$val" == "300000" ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="P5: workers.triggers.optimize.timeoutMs = 300000"
  else
    _CHECK_OUTPUT="P5: workers.triggers.optimize.timeoutMs = ${val:-missing} (expected 300000)"
  fi
}

check_p5_similarity_threshold() {
  _CHECK_PASSED="false"
  local cfg="$P5_DIR/.claude-flow/config.json"
  if [[ ! -f "$cfg" ]]; then
    _CHECK_OUTPUT="P5: config.json not found"
    return
  fi
  local val
  val=$(node -e "const c=JSON.parse(require('fs').readFileSync('$cfg','utf-8')); console.log(c.memory?.similarityThreshold)" 2>/dev/null)
  if [[ "$val" == "0.7" ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="P5: memory.similarityThreshold = 0.7"
  else
    _CHECK_OUTPUT="P5: memory.similarityThreshold = ${val:-missing} (expected 0.7)"
  fi
}

check_p5_dedup_threshold() {
  _CHECK_PASSED="false"
  local cfg="$P5_DIR/.claude-flow/config.json"
  if [[ ! -f "$cfg" ]]; then
    _CHECK_OUTPUT="P5: config.json not found"
    return
  fi
  local val
  val=$(node -e "const c=JSON.parse(require('fs').readFileSync('$cfg','utf-8')); console.log(c.memory?.dedupThreshold)" 2>/dev/null)
  if [[ "$val" == "0.95" ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="P5: memory.dedupThreshold = 0.95"
  else
    _CHECK_OUTPUT="P5: memory.dedupThreshold = ${val:-missing} (expected 0.95)"
  fi
}

check_p5_cpu_load() {
  _CHECK_PASSED="false"
  local cfg="$P5_DIR/.claude-flow/config.json"
  if [[ ! -f "$cfg" ]]; then
    _CHECK_OUTPUT="P5: config.json not found"
    return
  fi
  local val
  val=$(node -e "const c=JSON.parse(require('fs').readFileSync('$cfg','utf-8')); console.log(c.daemon?.resourceThresholds?.maxCpuLoad)" 2>/dev/null)
  if [[ "$val" == "28" ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="P5: daemon.resourceThresholds.maxCpuLoad = 28"
  else
    _CHECK_OUTPUT="P5: daemon.resourceThresholds.maxCpuLoad = ${val:-missing} (expected 28)"
  fi
}

check_p5_max_elements() {
  _CHECK_PASSED="false"
  local cfg="$P5_DIR/.claude-flow/config.json"
  if [[ ! -f "$cfg" ]]; then
    _CHECK_OUTPUT="P5: config.json not found"
    return
  fi
  local val
  val=$(node -e "const c=JSON.parse(require('fs').readFileSync('$cfg','utf-8')); console.log(c.memory?.maxElements)" 2>/dev/null)
  if [[ "$val" == "100000" ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="P5: memory.maxElements = 100000"
  else
    _CHECK_OUTPUT="P5: memory.maxElements = ${val:-missing} (expected 100000)"
  fi
}

# ══════════════════════════════════════════════════════════════════════════════
# Group 2: embeddings.json values
# ══════════════════════════════════════════════════════════════════════════════

check_p5_emb_model() {
  _CHECK_PASSED="false"
  local emb="$P5_DIR/.claude-flow/embeddings.json"
  if [[ ! -f "$emb" ]]; then
    _CHECK_OUTPUT="P5: embeddings.json not found"
    return
  fi
  local val
  val=$(node -e "const c=JSON.parse(require('fs').readFileSync('$emb','utf-8')); console.log(c.model)" 2>/dev/null)
  if [[ "$val" == *mpnet* ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="P5: model = $val (contains mpnet)"
  else
    _CHECK_OUTPUT="P5: model = ${val:-missing} (expected to contain mpnet, not MiniLM)"
  fi
}

check_p5_emb_dimension() {
  _CHECK_PASSED="false"
  local emb="$P5_DIR/.claude-flow/embeddings.json"
  if [[ ! -f "$emb" ]]; then
    _CHECK_OUTPUT="P5: embeddings.json not found"
    return
  fi
  local val
  val=$(node -e "const c=JSON.parse(require('fs').readFileSync('$emb','utf-8')); console.log(c.dimension)" 2>/dev/null)
  if [[ "$val" == "768" ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="P5: dimension = 768"
  else
    _CHECK_OUTPUT="P5: dimension = ${val:-missing} (expected 768)"
  fi
}

check_p5_emb_hnsw_m() {
  _CHECK_PASSED="false"
  local emb="$P5_DIR/.claude-flow/embeddings.json"
  if [[ ! -f "$emb" ]]; then
    _CHECK_OUTPUT="P5: embeddings.json not found"
    return
  fi
  local val
  val=$(node -e "const c=JSON.parse(require('fs').readFileSync('$emb','utf-8')); console.log(c.hnsw?.m)" 2>/dev/null)
  if [[ "$val" == "23" ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="P5: hnsw.m = 23"
  else
    _CHECK_OUTPUT="P5: hnsw.m = ${val:-missing} (expected 23)"
  fi
}

check_p5_emb_ef_construction() {
  _CHECK_PASSED="false"
  local emb="$P5_DIR/.claude-flow/embeddings.json"
  if [[ ! -f "$emb" ]]; then
    _CHECK_OUTPUT="P5: embeddings.json not found"
    return
  fi
  local val
  val=$(node -e "const c=JSON.parse(require('fs').readFileSync('$emb','utf-8')); console.log(c.hnsw?.efConstruction)" 2>/dev/null)
  if [[ "$val" == "100" ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="P5: hnsw.efConstruction = 100"
  else
    _CHECK_OUTPUT="P5: hnsw.efConstruction = ${val:-missing} (expected 100)"
  fi
}

check_p5_emb_ef_search() {
  _CHECK_PASSED="false"
  local emb="$P5_DIR/.claude-flow/embeddings.json"
  if [[ ! -f "$emb" ]]; then
    _CHECK_OUTPUT="P5: embeddings.json not found"
    return
  fi
  local val
  val=$(node -e "const c=JSON.parse(require('fs').readFileSync('$emb','utf-8')); console.log(c.hnsw?.efSearch)" 2>/dev/null)
  if [[ "$val" == "50" ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="P5: hnsw.efSearch = 50"
  else
    _CHECK_OUTPUT="P5: hnsw.efSearch = ${val:-missing} (expected 50)"
  fi
}

check_p5_emb_max_elements() {
  _CHECK_PASSED="false"
  local emb="$P5_DIR/.claude-flow/embeddings.json"
  if [[ ! -f "$emb" ]]; then
    _CHECK_OUTPUT="P5: embeddings.json not found"
    return
  fi
  local val
  val=$(node -e "const c=JSON.parse(require('fs').readFileSync('$emb','utf-8')); console.log(c.hnsw?.maxElements)" 2>/dev/null)
  if [[ "$val" == "100000" ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="P5: hnsw.maxElements = 100000"
  else
    _CHECK_OUTPUT="P5: hnsw.maxElements = ${val:-missing} (expected 100000)"
  fi
}

check_p5_emb_hash_fallback() {
  _CHECK_PASSED="false"
  local emb="$P5_DIR/.claude-flow/embeddings.json"
  if [[ ! -f "$emb" ]]; then
    _CHECK_OUTPUT="P5: embeddings.json not found"
    return
  fi
  local val
  val=$(node -e "const c=JSON.parse(require('fs').readFileSync('$emb','utf-8')); console.log(c.hashFallbackDimension)" 2>/dev/null)
  if [[ "$val" == "128" ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="P5: hashFallbackDimension = 128"
  else
    _CHECK_OUTPUT="P5: hashFallbackDimension = ${val:-missing} (expected 128)"
  fi
}
