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

# Helper: read a JSON path from the dedicated embeddings.json file.
# ADR-0070 / ADR-0080: executor.ts writes .claude-flow/embeddings.json as the
# source of truth for embeddings config. config.json has a mirror under
# memory.embeddings (for source-inspection tests), but the canonical file is
# embeddings.json — that's where fields like hnsw.maxElements live.
# The JS variable name is kept as `c` for historical compatibility with how
# callers write expressions (e.g. `c.embeddings?.hnsw?.M`). The `embeddings`
# wrapper normalises both real-world shapes: this file is flat at top-level,
# but callers think in terms of `c.embeddings.*`.
_p5_emb() {
  node -e "const e=JSON.parse(require('fs').readFileSync('$P5_DIR/.claude-flow/embeddings.json','utf-8')); const c={embeddings:e}; console.log($1)" 2>/dev/null
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
# Group 2: embeddings values (in .claude-flow/embeddings.json)
# ADR-0070 / ADR-0080: executor.ts writes .claude-flow/embeddings.json as the
# source of truth for embeddings config. config.json has a mirror under
# memory.embeddings (used by source-inspection tests), but these runtime
# checks read the canonical embeddings.json file.
# ══════════════════════════════════════════════════════════════════════════════

check_p5_embeddings_valid_json() {
  _CHECK_PASSED="false"
  local emb="$P5_DIR/.claude-flow/embeddings.json"
  if [[ ! -f "$emb" ]]; then
    _CHECK_OUTPUT="P5: embeddings.json not found (init --with-embeddings failed?)"
    return
  fi
  # Verify valid JSON AND that the canonical top-level fields exist (model,
  # dimension, hnsw). The fork's executor.ts writes all three.
  local val; val=$(node -e "
    const e=JSON.parse(require('fs').readFileSync('$emb','utf-8'));
    console.log(typeof e === 'object' && typeof e.hnsw === 'object' && typeof e.model === 'string' ? 'object' : typeof e);
  " 2>/dev/null)
  if [[ "$val" == "object" ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="P5: embeddings.json is valid JSON with model/hnsw keys"
  else
    _CHECK_OUTPUT="P5: embeddings.json missing expected structure (got: ${val:-nothing})"
  fi
}

check_p5_embeddings_model() {
  _CHECK_PASSED="false"
  local emb="$P5_DIR/.claude-flow/embeddings.json"
  [[ ! -f "$emb" ]] && { _CHECK_OUTPUT="P5: embeddings.json not found"; return; }
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
  local emb="$P5_DIR/.claude-flow/embeddings.json"
  [[ ! -f "$emb" ]] && { _CHECK_OUTPUT="P5: embeddings.json not found"; return; }
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
  local emb="$P5_DIR/.claude-flow/embeddings.json"
  [[ ! -f "$emb" ]] && { _CHECK_OUTPUT="P5: embeddings.json not found"; return; }
  # ADR-0065 canonical casing is uppercase `M`. Unit tests reject lowercase.
  # Accept both here for defensive reading.
  local val; val=$(_p5_emb "c.embeddings?.hnsw?.M ?? c.embeddings?.hnsw?.m")
  if [[ "$val" == "23" ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="P5: embeddings.hnsw.M = 23"
  else
    _CHECK_OUTPUT="P5: embeddings.hnsw.M = ${val:-missing} (expected 23)"
  fi
}

check_p5_embeddings_hnsw_efc() {
  _CHECK_PASSED="false"
  local emb="$P5_DIR/.claude-flow/embeddings.json"
  [[ ! -f "$emb" ]] && { _CHECK_OUTPUT="P5: embeddings.json not found"; return; }
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
  local emb="$P5_DIR/.claude-flow/embeddings.json"
  [[ ! -f "$emb" ]] && { _CHECK_OUTPUT="P5: embeddings.json not found"; return; }
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
  local emb="$P5_DIR/.claude-flow/embeddings.json"
  [[ ! -f "$emb" ]] && { _CHECK_OUTPUT="P5: embeddings.json not found"; return; }
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
  # Store our own entry first — this check runs in a parallel subshell, so it
  # cannot rely on p5-rt-store having finished.  Using a unique key avoids
  # collision with the store check.
  local store_out
  store_out=$(cd "$P5_DIR" && timeout 15 "$CLI_BIN" memory store --key "p5-search-$$" --value "search-roundtrip" --namespace p5 2>&1) || true
  local out
  out=$(cd "$P5_DIR" && timeout 15 "$CLI_BIN" memory search --query "search-roundtrip" --namespace p5 2>&1) || true
  if echo "$out" | grep -qi "p5-search\|search-roundtrip"; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="P5: memory search returned results"
  else
    _CHECK_OUTPUT="P5: memory search failed (store: ${store_out:0:60}): ${out:0:120}"
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
  (cd "$tmpdir" && timeout 30 "$CLI_BIN" init --port 4000 --force 2>&1) || true
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
  (cd "$tmpdir" && timeout 30 "$CLI_BIN" init --similarity-threshold 0.85 --force 2>&1) || true
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
  (cd "$tmpdir" && timeout 30 "$CLI_BIN" init --max-agents 10 --force 2>&1) || true
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
  # P5_DIR already has an init'd project. Running init again WITHOUT --force
  # should detect existing files and either skip, warn, or exit non-zero.
  local out
  out=$(cd "$P5_DIR" && timeout 30 "$CLI_BIN" init 2>&1) || true
  if echo "$out" | grep -qi "skip\|already exist\|already init\|overwrite\|--force\|reinitialize"; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="P5: init detects existing project without --force"
  else
    _CHECK_OUTPUT="P5: init did not detect existing project: ${out:0:200}"
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
  out=$(cd "$P5_DIR" && timeout 10 "$CLI_BIN" config set --key test.p5key --value "p5-roundtrip" 2>&1) || true
  # ADR-0082: CLI output alone does not prove the round-trip — require file-level
  # evidence. Silent-pass fallbacks on file-missing or value-mismatch are
  # exactly what this check is meant to catch.
  if ! echo "$out" | grep -qi "p5-roundtrip\|set.*test.p5key\|success"; then
    _CHECK_OUTPUT="P5: config set CLI failed — output: ${out:0:120}"
    return
  fi
  local cfg="$P5_DIR/.claude-flow/config.json"
  if [[ ! -f "$cfg" ]]; then
    _CHECK_OUTPUT="P5: CLI reported set-success but $cfg does not exist"
    return
  fi
  local val
  val=$(node -e "const c=JSON.parse(require('fs').readFileSync('$cfg','utf-8')); console.log(c.test?.p5key)" 2>/dev/null)
  if [[ "$val" == "p5-roundtrip" ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="P5: config set round-trip works (file verified: test.p5key=$val)"
  else
    _CHECK_OUTPUT="P5: CLI reported success but file value mismatch (expected 'p5-roundtrip', got '${val:-<missing>}')"
  fi
}
