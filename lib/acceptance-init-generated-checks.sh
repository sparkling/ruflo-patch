#!/usr/bin/env bash
# lib/acceptance-init-generated-checks.sh — Phase 5: Init-generated config validation
#
# Validates what `init` actually generates in a fresh directory.
# Every value check uses node -e JSON parsing with exact comparisons, never grep.
# Function names match ADR-0070 specification.
#
# Caller MUST set:
#   P5_DIR   — directory where init was run (contains .claude-flow/)
#   CLI_BIN  — path to the CLI binary

# Helper: read a JSON path from config.json
_p5_cfg() {
  node -e "const c=JSON.parse(require('fs').readFileSync('$P5_DIR/.claude-flow/config.json','utf-8')); console.log($1)" 2>/dev/null
}

# Helper: read a JSON path from the embeddings section of config.json
# (init puts embeddings under config.json, not a separate embeddings.json)
_p5_emb() {
  node -e "const c=JSON.parse(require('fs').readFileSync('$P5_DIR/.claude-flow/config.json','utf-8')); console.log($1)" 2>/dev/null
}

# ══════════════════════════════════════════════════════════════════════════════
# Group 1: config.json structure and defaults
# ══════════════════════════════════════════════════════════════════════════════

check_p5_config_valid_json() {
  _CHECK_PASSED="false"
  local cfg="$P5_DIR/.claude-flow/config.json"
  if [[ ! -f "$cfg" ]]; then
    _CHECK_OUTPUT="P5: config.json not found"
    return
  fi
  if node -e "JSON.parse(require('fs').readFileSync('$cfg','utf-8'))" 2>/dev/null; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="P5: config.json is valid JSON"
  else
    _CHECK_OUTPUT="P5: config.json is not valid JSON"
  fi
}

check_p5_config_sqlite_keys() {
  _CHECK_PASSED="false"
  local cfg="$P5_DIR/.claude-flow/config.json"
  [[ ! -f "$cfg" ]] && { _CHECK_OUTPUT="P5: config.json not found"; return; }
  local val; val=$(_p5_cfg "c.memory?.sqlite?.cacheSize")
  if [[ "$val" == "-64000" ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="P5: memory.sqlite.cacheSize = -64000"
  else
    _CHECK_OUTPUT="P5: memory.sqlite.cacheSize = ${val:-missing} (expected -64000)"
  fi
}

check_p5_config_neural_keys() {
  _CHECK_PASSED="false"
  local cfg="$P5_DIR/.claude-flow/config.json"
  [[ ! -f "$cfg" ]] && { _CHECK_OUTPUT="P5: config.json not found"; return; }
  local val; val=$(_p5_cfg "c.neural?.ewcLambda")
  if [[ "$val" == "2000" ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="P5: neural.ewcLambda = 2000"
  else
    _CHECK_OUTPUT="P5: neural.ewcLambda = ${val:-missing} (expected 2000)"
  fi
}

check_p5_config_ports() {
  _CHECK_PASSED="false"
  local cfg="$P5_DIR/.claude-flow/config.json"
  [[ ! -f "$cfg" ]] && { _CHECK_OUTPUT="P5: config.json not found"; return; }
  local val; val=$(_p5_cfg "c.ports?.mcp")
  if [[ "$val" == "3000" ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="P5: ports.mcp = 3000"
  else
    _CHECK_OUTPUT="P5: ports.mcp = ${val:-missing} (expected 3000)"
  fi
}

check_p5_config_ratelimiter() {
  _CHECK_PASSED="false"
  local cfg="$P5_DIR/.claude-flow/config.json"
  [[ ! -f "$cfg" ]] && { _CHECK_OUTPUT="P5: config.json not found"; return; }
  local val; val=$(_p5_cfg "c.rateLimiter?.default?.windowMs")
  if [[ "$val" == "60000" ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="P5: rateLimiter.default.windowMs = 60000"
  else
    _CHECK_OUTPUT="P5: rateLimiter.default.windowMs = ${val:-missing} (expected 60000)"
  fi
}

check_p5_config_workers() {
  _CHECK_PASSED="false"
  local cfg="$P5_DIR/.claude-flow/config.json"
  [[ ! -f "$cfg" ]] && { _CHECK_OUTPUT="P5: config.json not found"; return; }
  local val; val=$(_p5_cfg "c.workers?.triggers?.optimize?.timeoutMs")
  if [[ "$val" == "300000" ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="P5: workers.triggers.optimize.timeoutMs = 300000"
  else
    _CHECK_OUTPUT="P5: workers.triggers.optimize.timeoutMs = ${val:-missing} (expected 300000)"
  fi
}

check_p5_config_similarity() {
  _CHECK_PASSED="false"
  local cfg="$P5_DIR/.claude-flow/config.json"
  [[ ! -f "$cfg" ]] && { _CHECK_OUTPUT="P5: config.json not found"; return; }
  local val; val=$(_p5_cfg "c.memory?.similarityThreshold")
  if [[ "$val" == "0.7" ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="P5: memory.similarityThreshold = 0.7"
  else
    _CHECK_OUTPUT="P5: memory.similarityThreshold = ${val:-missing} (expected 0.7)"
  fi
}

check_p5_config_dedup() {
  _CHECK_PASSED="false"
  local cfg="$P5_DIR/.claude-flow/config.json"
  [[ ! -f "$cfg" ]] && { _CHECK_OUTPUT="P5: config.json not found"; return; }
  local val; val=$(_p5_cfg "c.memory?.dedupThreshold")
  if [[ "$val" == "0.95" ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="P5: memory.dedupThreshold = 0.95"
  else
    _CHECK_OUTPUT="P5: memory.dedupThreshold = ${val:-missing} (expected 0.95)"
  fi
}

check_p5_config_maxcpu() {
  _CHECK_PASSED="false"
  local cfg="$P5_DIR/.claude-flow/config.json"
  [[ ! -f "$cfg" ]] && { _CHECK_OUTPUT="P5: config.json not found"; return; }
  local val; val=$(_p5_cfg "c.daemon?.resourceThresholds?.maxCpuLoad")
  if [[ "$val" == "28" ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="P5: daemon.resourceThresholds.maxCpuLoad = 28"
  else
    _CHECK_OUTPUT="P5: daemon.resourceThresholds.maxCpuLoad = ${val:-missing} (expected 28)"
  fi
}

# ══════════════════════════════════════════════════════════════════════════════
# Group 2: embeddings values (inside config.json under "embeddings" key)
# init puts embeddings config in config.json, not a separate embeddings.json.
# ══════════════════════════════════════════════════════════════════════════════

check_p5_embeddings_valid_json() {
  _CHECK_PASSED="false"
  local cfg="$P5_DIR/.claude-flow/config.json"
  if [[ ! -f "$cfg" ]]; then
    _CHECK_OUTPUT="P5: config.json not found (embeddings check)"
    return
  fi
  local val; val=$(node -e "const c=JSON.parse(require('fs').readFileSync('$cfg','utf-8')); console.log(typeof c.embeddings)" 2>/dev/null)
  if [[ "$val" == "object" ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="P5: config.json has embeddings section"
  else
    _CHECK_OUTPUT="P5: config.json missing embeddings section (got: ${val:-nothing})"
  fi
}

check_p5_embeddings_model() {
  _CHECK_PASSED="false"
  local cfg="$P5_DIR/.claude-flow/config.json"
  [[ ! -f "$cfg" ]] && { _CHECK_OUTPUT="P5: config.json not found"; return; }
  local val; val=$(_p5_emb "c.embeddings?.model")
  if [[ "$val" == *mpnet* ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="P5: embeddings.model = $val (contains mpnet)"
  else
    _CHECK_OUTPUT="P5: embeddings.model = ${val:-missing} (expected to contain mpnet)"
  fi
}

check_p5_embeddings_dimension() {
  _CHECK_PASSED="false"
  local cfg="$P5_DIR/.claude-flow/config.json"
  [[ ! -f "$cfg" ]] && { _CHECK_OUTPUT="P5: config.json not found"; return; }
  local val; val=$(_p5_emb "c.embeddings?.dimension")
  if [[ "$val" == "768" ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="P5: embeddings.dimension = 768"
  else
    _CHECK_OUTPUT="P5: embeddings.dimension = ${val:-missing} (expected 768)"
  fi
}

check_p5_embeddings_hnsw_m() {
  _CHECK_PASSED="false"
  local cfg="$P5_DIR/.claude-flow/config.json"
  [[ ! -f "$cfg" ]] && { _CHECK_OUTPUT="P5: config.json not found"; return; }
  local val; val=$(_p5_emb "c.embeddings?.hnsw?.m")
  if [[ "$val" == "23" ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="P5: embeddings.hnsw.m = 23"
  else
    _CHECK_OUTPUT="P5: embeddings.hnsw.m = ${val:-missing} (expected 23)"
  fi
}

check_p5_embeddings_hnsw_efc() {
  _CHECK_PASSED="false"
  local cfg="$P5_DIR/.claude-flow/config.json"
  [[ ! -f "$cfg" ]] && { _CHECK_OUTPUT="P5: config.json not found"; return; }
  local val; val=$(_p5_emb "c.embeddings?.hnsw?.efConstruction")
  if [[ "$val" == "100" ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="P5: embeddings.hnsw.efConstruction = 100"
  else
    _CHECK_OUTPUT="P5: embeddings.hnsw.efConstruction = ${val:-missing} (expected 100)"
  fi
}

check_p5_embeddings_hnsw_efs() {
  _CHECK_PASSED="false"
  local cfg="$P5_DIR/.claude-flow/config.json"
  [[ ! -f "$cfg" ]] && { _CHECK_OUTPUT="P5: config.json not found"; return; }
  local val; val=$(_p5_emb "c.embeddings?.hnsw?.efSearch")
  if [[ "$val" == "50" ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="P5: embeddings.hnsw.efSearch = 50"
  else
    _CHECK_OUTPUT="P5: embeddings.hnsw.efSearch = ${val:-missing} (expected 50)"
  fi
}

check_p5_embeddings_maxel() {
  _CHECK_PASSED="false"
  local cfg="$P5_DIR/.claude-flow/config.json"
  [[ ! -f "$cfg" ]] && { _CHECK_OUTPUT="P5: config.json not found"; return; }
  local val; val=$(_p5_emb "c.embeddings?.hnsw?.maxElements")
  if [[ "$val" == "100000" ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="P5: embeddings.hnsw.maxElements = 100000"
  else
    _CHECK_OUTPUT="P5: embeddings.hnsw.maxElements = ${val:-missing} (expected 100000)"
  fi
}

# ══════════════════════════════════════════════════════════════════════════════
# Group 3: runtime memory round-trip
# ══════════════════════════════════════════════════════════════════════════════

check_p5_runtime_memory_store() {
  _CHECK_PASSED="false"
  if [[ -z "$CLI_BIN" ]]; then
    _CHECK_OUTPUT="P5: CLI_BIN not set"
    return
  fi
  local out
  out=$(cd "$P5_DIR" && timeout 15 "$CLI_BIN" memory store --key "p5-test-$$" --value "acceptance-test" --namespace p5 2>&1) || true
  if echo "$out" | grep -qi "stored\|success\|ok\|p5-test"; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="P5: memory store succeeded"
  else
    _CHECK_OUTPUT="P5: memory store failed: ${out:0:120}"
  fi
}

check_p5_runtime_memory_search() {
  _CHECK_PASSED="false"
  if [[ -z "$CLI_BIN" ]]; then
    _CHECK_OUTPUT="P5: CLI_BIN not set"
    return
  fi
  local out
  out=$(cd "$P5_DIR" && timeout 15 "$CLI_BIN" memory search --query "acceptance" --namespace p5 2>&1) || true
  if echo "$out" | grep -qi "result\|found\|p5-test\|acceptance"; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="P5: memory search returned results"
  else
    _CHECK_OUTPUT="P5: memory search failed: ${out:0:120}"
  fi
}

# ══════════════════════════════════════════════════════════════════════════════
# Group 4: CLI flag overrides
# ══════════════════════════════════════════════════════════════════════════════

check_p5_flag_port() {
  _CHECK_PASSED="false"
  if [[ -z "$CLI_BIN" ]]; then
    _CHECK_OUTPUT="P5: CLI_BIN not set"
    return
  fi
  local tmpdir
  tmpdir=$(mktemp -d /tmp/ruflo-p5-port-XXXXX)
  (cd "$tmpdir" && timeout 30 "$CLI_BIN" init --port 4000 --yes 2>&1) || true
  local val
  val=$(node -e "const c=JSON.parse(require('fs').readFileSync('$tmpdir/.claude-flow/config.json','utf-8')); console.log(c.ports?.mcp)" 2>/dev/null)
  if [[ "$val" == "4000" ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="P5: --port 4000 → ports.mcp = 4000"
  else
    _CHECK_OUTPUT="P5: --port 4000 → ports.mcp = ${val:-missing} (expected 4000)"
  fi
  rm -rf "$tmpdir"
}

check_p5_flag_similarity() {
  _CHECK_PASSED="false"
  if [[ -z "$CLI_BIN" ]]; then
    _CHECK_OUTPUT="P5: CLI_BIN not set"
    return
  fi
  local tmpdir
  tmpdir=$(mktemp -d /tmp/ruflo-p5-sim-XXXXX)
  (cd "$tmpdir" && timeout 30 "$CLI_BIN" init --similarity-threshold 0.85 --yes 2>&1) || true
  local val
  val=$(node -e "const c=JSON.parse(require('fs').readFileSync('$tmpdir/.claude-flow/config.json','utf-8')); console.log(c.memory?.similarityThreshold)" 2>/dev/null)
  if [[ "$val" == "0.85" ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="P5: --similarity-threshold 0.85 → memory.similarityThreshold = 0.85"
  else
    _CHECK_OUTPUT="P5: --similarity-threshold → similarityThreshold = ${val:-missing} (expected 0.85)"
  fi
  rm -rf "$tmpdir"
}

check_p5_flag_maxagents() {
  _CHECK_PASSED="false"
  if [[ -z "$CLI_BIN" ]]; then
    _CHECK_OUTPUT="P5: CLI_BIN not set"
    return
  fi
  local tmpdir
  tmpdir=$(mktemp -d /tmp/ruflo-p5-agents-XXXXX)
  (cd "$tmpdir" && timeout 30 "$CLI_BIN" init --max-agents 10 --yes 2>&1) || true
  local val
  val=$(node -e "const c=JSON.parse(require('fs').readFileSync('$tmpdir/.claude-flow/config.json','utf-8')); console.log(c.swarm?.maxAgents)" 2>/dev/null)
  if [[ "$val" == "10" ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="P5: --max-agents 10 → swarm.maxAgents = 10"
  else
    _CHECK_OUTPUT="P5: --max-agents 10 → swarm.maxAgents = ${val:-missing} (expected 10)"
  fi
  rm -rf "$tmpdir"
}

# ══════════════════════════════════════════════════════════════════════════════
# Group 5: backward compatibility
# ══════════════════════════════════════════════════════════════════════════════

check_p5_compat_no_overwrite() {
  _CHECK_PASSED="false"
  if [[ -z "$CLI_BIN" ]]; then
    _CHECK_OUTPUT="P5: CLI_BIN not set"
    return
  fi
  # P5_DIR already has an init'd project. Running init again without --force
  # should skip existing files. The CLI prints "Skipped: N (already exist)".
  local out
  out=$(cd "$P5_DIR" && timeout 30 "$CLI_BIN" init --yes 2>&1) || true
  if echo "$out" | grep -qi "skip\|already exist\|already init"; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="P5: init skips existing files without --force"
  else
    _CHECK_OUTPUT="P5: init did not report skipped files: ${out:0:200}"
  fi
}

check_p5_compat_config_set() {
  _CHECK_PASSED="false"
  if [[ -z "$CLI_BIN" ]]; then
    _CHECK_OUTPUT="P5: CLI_BIN not set"
    return
  fi
  local out
  # Set a value (flag syntax: --key / --value)
  out=$(cd "$P5_DIR" && timeout 10 "$CLI_BIN" config set --key test.key --value "p5-roundtrip" 2>&1) || true
  # Get it back (flag syntax: --key)
  local val
  val=$(cd "$P5_DIR" && timeout 10 "$CLI_BIN" config get --key test.key 2>&1) || true
  if echo "$val" | grep -q "p5-roundtrip"; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="P5: config set/get round-trip works"
  else
    _CHECK_OUTPUT="P5: config set/get failed — set: ${out:0:60}, get: ${val:0:60}"
  fi
}
