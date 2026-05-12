#!/usr/bin/env bash
# lib/acceptance-adr0177-checks.sh — ADR-0177 Phase 1.6 (f) config-chain wiring
#
# Validates the end-to-end embedding config chain:
#   ruflo init  →  .claude-flow/config.json  →  AgentDB / RvfBackend
#
# Three scenarios:
#   (1) Default init writes embedding.* + index.hnsw.* with canonical values
#       (768-dim mpnet) and AgentDB round-trips an embedding at that dimension.
#   (2) `ruflo init --embedding-model Xenova/bge-base-en-v1.5` writes the
#       alternative 768-dim model into config AND the RvfBackend's segment is
#       written with dim=768.
#   (3) `ruflo init --embedding-model Xenova/all-MiniLM-L6-v2` auto-adjusts
#       dimension to 384 in config AND a fresh RVF segment is created at 384.
#
# Caller MUST set: CLI_BIN, REGISTRY, TEMP_DIR
#
# Each scenario uses its own mktemp dir; the `_run_and_kill` helper handles the
# CLI hanging on open SQLite handles per ADR-0039 T1.
#
# Catalog naming: check_adr0177_* is L7-accepted via the adr-NNNN filename tag.

# ── helpers ─────────────────────────────────────────────────────────────────

# Read a JSON path from a config.json with node. Returns the value or "" on
# error. The bash variable name `cfg` carries the file path; the expression is
# expanded as `$1` against a parsed `c`.
_adr0177_cfg() {
  local file="$1" expr="$2"
  node -e "try{const c=JSON.parse(require('fs').readFileSync('${file}','utf-8'));console.log(${expr})}catch(e){}" 2>/dev/null
}

# Read a JSON path from .claude-flow/embeddings.json — the runtime-canonical
# file that agentdb's config-chain accessor (`getConfig()` in
# forks/agentdb/src/core/config-chain.ts) consumes. Distinct shape from
# config.json: top-level `model`/`dimension`/`provider` instead of nested
# `embedding.*`. Per executor.ts:1399-1476 the file is always written when
# `--with-embeddings` is passed; the integration tests assert against
# config.json, but at runtime the substrate reads embeddings.json. Asserting
# both surfaces ensures the chain works end-to-end (write + read).
_adr0177_emb() {
  local file="$1" expr="$2"
  node -e "try{const e=JSON.parse(require('fs').readFileSync('${file}','utf-8'));console.log(${expr})}catch(e){}" 2>/dev/null
}

# Run `ruflo init` into $1 with optional --embedding-model $2. Captures
# combined stdout/stderr to $1/.init-log.txt. Honours the 120s ceiling used
# in the global harness (init is the long pole — full model warm-up).
#
# The CLI hangs after `init` finishes (open SQLite handles), so we use
# _run_and_kill from acceptance-checks.sh which detects completion via the
# `__RUFLO_DONE__` sentinel.
_adr0177_run_init() {
  local dir="$1" model="${2:-}"
  local model_flag=""
  [[ -n "$model" ]] && model_flag="--embedding-model ${model}"
  local log="${dir}/.init-log.txt"
  _run_and_kill \
    "cd '${dir}' && NPM_CONFIG_REGISTRY='${REGISTRY}' '${CLI_BIN}' init --full --force --with-embeddings ${model_flag}" \
    "$log" \
    120
}

# Read the RvfBackend's stored dimension from `dir`'s .claude-flow/memory.rvf
# segment. Uses the published @sparkleideas/memory package (RvfBackend.
# getStoredDimension) so the header parsing stays honest to upstream. Returns
# integer dim or "" on failure. Also resolves .swarm/memory.rvf as a fallback
# since some configs land the segment under .swarm/.
_adr0177_stored_dim() {
  local dir="$1"
  # Resolve which segment exists. Both paths are produced by different init
  # variants and the storage resolver may pick either; prefer whichever has
  # bytes.
  local rvf=""
  for cand in "${dir}/.claude-flow/memory.rvf" "${dir}/.swarm/memory.rvf"; do
    if [[ -s "$cand" ]]; then rvf="$cand"; break; fi
  done
  [[ -z "$rvf" ]] && { echo ""; return; }

  # The probe script must live inside $dir so node module resolution walks up
  # to $dir/node_modules. ${TEMP_DIR}/node_modules is symlinked into init'd
  # projects by harness layout — but for fresh mktemp dirs we instead point
  # NODE_PATH at TEMP_DIR/node_modules so @sparkleideas/memory resolves.
  local probe="${dir}/.adr0177-probe.mjs"
  cat > "$probe" << 'PROBE_SCRIPT'
import { RvfBackend } from '@sparkleideas/memory';
const rvfPath = process.argv[2];
// The dim arg is ignored by getStoredDimension — it reads the on-disk header.
const backend = new RvfBackend({ databasePath: rvfPath, dimensions: 768, autoPersistInterval: 0 });
try {
  await backend.initialize();
  const dim = await backend.getStoredDimension();
  console.log('DIM:' + dim);
  await backend.shutdown();
} catch (e) {
  console.log('ERR:' + e.message);
}
PROBE_SCRIPT
  local out
  out=$(NODE_PATH="${TEMP_DIR}/node_modules" node "$probe" "$rvf" 2>&1) || true
  rm -f "$probe"
  echo "$out" | grep -E '^DIM:[0-9]+' | head -1 | sed 's/^DIM://'
}

# ── (1) default init: 7 keys + 768-dim round-trip ───────────────────────────

# check_adr0177_default_config_keys — assert all 7 canonical defaults land in
# .claude-flow/config.json after a bare `ruflo init --full`.
#
# Per Phase 1.6 (a) + (b) the init template writes:
#   embedding.provider       == "onnx"
#   embedding.model          == "Xenova/all-mpnet-base-v2"
#   embedding.dimension      == 768
#   embedding.allowPaidProvider == false
#   index.hnsw.m             == 23
#   index.hnsw.efConstruction == 100
#   index.hnsw.efSearch       == 50
check_adr0177_default_config_keys() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local dir; dir=$(mktemp -d /tmp/ruflo-adr0177-default-XXXXX)
  # shellcheck disable=SC2064
  trap "rm -rf '$dir' 2>/dev/null; trap - RETURN INT TERM" RETURN INT TERM

  _adr0177_run_init "$dir"

  local cfg="${dir}/.claude-flow/config.json"
  if [[ ! -f "$cfg" ]]; then
    _CHECK_OUTPUT="default-config: ${cfg} not found after init (init log: $(tail -3 ${dir}/.init-log.txt 2>/dev/null | tr '\n' ' '))"
    return
  fi

  local mismatches=""
  local v

  v=$(_adr0177_cfg "$cfg" "c.embedding?.provider")
  [[ "$v" != "onnx" ]] && mismatches="${mismatches} embedding.provider=${v:-missing}(want:onnx);"

  v=$(_adr0177_cfg "$cfg" "c.embedding?.model")
  [[ "$v" != "Xenova/all-mpnet-base-v2" ]] && mismatches="${mismatches} embedding.model=${v:-missing}(want:Xenova/all-mpnet-base-v2);"

  v=$(_adr0177_cfg "$cfg" "c.embedding?.dimension")
  [[ "$v" != "768" ]] && mismatches="${mismatches} embedding.dimension=${v:-missing}(want:768);"

  v=$(_adr0177_cfg "$cfg" "c.embedding?.allowPaidProvider")
  [[ "$v" != "false" ]] && mismatches="${mismatches} embedding.allowPaidProvider=${v:-missing}(want:false);"

  v=$(_adr0177_cfg "$cfg" "c.index?.hnsw?.m ?? c.index?.hnsw?.M")
  [[ "$v" != "23" ]] && mismatches="${mismatches} index.hnsw.m=${v:-missing}(want:23);"

  v=$(_adr0177_cfg "$cfg" "c.index?.hnsw?.efConstruction")
  [[ "$v" != "100" ]] && mismatches="${mismatches} index.hnsw.efConstruction=${v:-missing}(want:100);"

  v=$(_adr0177_cfg "$cfg" "c.index?.hnsw?.efSearch")
  [[ "$v" != "50" ]] && mismatches="${mismatches} index.hnsw.efSearch=${v:-missing}(want:50);"

  if [[ -n "$mismatches" ]]; then
    _CHECK_OUTPUT="default-config: 7-key invariant violated:${mismatches}"
    return
  fi

  # Companion assertion: .claude-flow/embeddings.json — runtime-canonical
  # file consumed by agentdb's config-chain accessor. Same model/dimension
  # must land here; provider is the raw `transformers.js` (normalized to
  # `onnx` inside the accessor, see config-chain.ts:170).
  local emb="${dir}/.claude-flow/embeddings.json"
  if [[ ! -f "$emb" ]]; then
    _CHECK_OUTPUT="default-config: 7-key invariant OK in config.json but ${emb} missing — agentdb accessor will not see init settings"
    return
  fi
  local emb_mismatches=""
  v=$(_adr0177_emb "$emb" "e.model")
  [[ "$v" != "Xenova/all-mpnet-base-v2" ]] && emb_mismatches="${emb_mismatches} embeddings.json.model=${v:-missing}(want:Xenova/all-mpnet-base-v2);"
  v=$(_adr0177_emb "$emb" "e.dimension")
  [[ "$v" != "768" ]] && emb_mismatches="${emb_mismatches} embeddings.json.dimension=${v:-missing}(want:768);"
  # Provider is normalized to `onnx` by the accessor; accept either raw
  # `transformers.js` (current executor output) or canonical `onnx`.
  v=$(_adr0177_emb "$emb" "e.provider")
  if [[ "$v" != "transformers.js" && "$v" != "transformers" && "$v" != "onnx" ]]; then
    emb_mismatches="${emb_mismatches} embeddings.json.provider=${v:-missing}(want:transformers.js|onnx);"
  fi

  if [[ -n "$emb_mismatches" ]]; then
    _CHECK_OUTPUT="default-config: config.json OK but embeddings.json mismatches (agentdb runtime read):${emb_mismatches}"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="default-config: 7 keys in config.json + matching model/dim in embeddings.json (runtime canonical)"
}

# check_adr0177_default_roundtrip — store + retrieve a memory entry, then
# verify the RvfBackend segment carries the 768-dim header that config
# promised. Exercises AgentDB construction via the CLI (which in turn opens
# AgentDB → RvfBackend).
check_adr0177_default_roundtrip() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local dir; dir=$(mktemp -d /tmp/ruflo-adr0177-rt-XXXXX)
  # shellcheck disable=SC2064
  trap "rm -rf '$dir' 2>/dev/null; trap - RETURN INT TERM" RETURN INT TERM

  _adr0177_run_init "$dir"
  if [[ ! -f "${dir}/.claude-flow/config.json" ]]; then
    _CHECK_OUTPUT="roundtrip-default: init failed (no config.json)"
    return
  fi

  # Store an entry, then search for it. Both operations open AgentDB end-to-
  # end; if either fails on the config-chain wiring the assertion will catch
  # it. Per-op timeout 30s — slow path is model warm.
  _run_and_kill \
    "cd '${dir}' && NPM_CONFIG_REGISTRY='${REGISTRY}' '${CLI_BIN}' memory init --force" \
    "" 30
  _run_and_kill \
    "cd '${dir}' && NPM_CONFIG_REGISTRY='${REGISTRY}' '${CLI_BIN}' memory store --key 'adr0177-rt' --value 'phase 1.6 default roundtrip probe' --namespace adr0177" \
    "" 30
  local store_out="$_RK_OUT"

  _run_and_kill \
    "cd '${dir}' && NPM_CONFIG_REGISTRY='${REGISTRY}' '${CLI_BIN}' memory search --query 'phase 1.6 default' --namespace adr0177" \
    "" 30
  local search_out="$_RK_OUT"

  if ! echo "$store_out" | grep -qi 'stored\|success\|adr0177-rt'; then
    _CHECK_OUTPUT="roundtrip-default: memory store failed: $(echo "$store_out" | tail -3 | tr '\n' ' ')"
    return
  fi
  if ! echo "$search_out" | grep -qi 'adr0177-rt\|phase 1.6 default'; then
    _CHECK_OUTPUT="roundtrip-default: memory search did not return seeded entry: $(echo "$search_out" | tail -3 | tr '\n' ' ')"
    return
  fi

  # Now check the RVF segment's on-disk dim header.
  local stored_dim; stored_dim=$(_adr0177_stored_dim "$dir")
  if [[ "$stored_dim" != "768" ]]; then
    _CHECK_OUTPUT="roundtrip-default: store+search succeeded but RvfBackend segment dim=${stored_dim:-unknown} (want 768)"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="roundtrip-default: store+search OK; RvfBackend segment dim=768"
}

# ── (2) `--embedding-model Xenova/bge-base-en-v1.5` (768d alternative) ──────

# check_adr0177_flag_bge_768 — verify the alternative 768-dim model lands in
# config AND in the RvfBackend's segment dim.
check_adr0177_flag_bge_768() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local dir; dir=$(mktemp -d /tmp/ruflo-adr0177-bge-XXXXX)
  # shellcheck disable=SC2064
  trap "rm -rf '$dir' 2>/dev/null; trap - RETURN INT TERM" RETURN INT TERM

  _adr0177_run_init "$dir" "Xenova/bge-base-en-v1.5"

  local cfg="${dir}/.claude-flow/config.json"
  if [[ ! -f "$cfg" ]]; then
    _CHECK_OUTPUT="flag-bge: ${cfg} not found after init --embedding-model bge"
    return
  fi

  local model dim
  model=$(_adr0177_cfg "$cfg" "c.embedding?.model")
  dim=$(_adr0177_cfg "$cfg" "c.embedding?.dimension")

  if [[ "$model" != "Xenova/bge-base-en-v1.5" ]]; then
    _CHECK_OUTPUT="flag-bge: embedding.model=${model:-missing} (want:Xenova/bge-base-en-v1.5)"
    return
  fi
  if [[ "$dim" != "768" ]]; then
    _CHECK_OUTPUT="flag-bge: embedding.dimension=${dim:-missing} (want:768)"
    return
  fi

  # Verify embeddings.json (runtime-canonical) matches.
  local emb="${dir}/.claude-flow/embeddings.json"
  if [[ -f "$emb" ]]; then
    local em ed
    em=$(_adr0177_emb "$emb" "e.model")
    ed=$(_adr0177_emb "$emb" "e.dimension")
    if [[ "$em" != "Xenova/bge-base-en-v1.5" || "$ed" != "768" ]]; then
      _CHECK_OUTPUT="flag-bge: config.json OK but embeddings.json {model=${em:-missing}, dimension=${ed:-missing}} disagrees (want:bge,768)"
      return
    fi
  fi

  # Drive a store so the RvfBackend writes its segment with the configured dim.
  _run_and_kill \
    "cd '${dir}' && NPM_CONFIG_REGISTRY='${REGISTRY}' '${CLI_BIN}' memory init --force" \
    "" 30
  _run_and_kill \
    "cd '${dir}' && NPM_CONFIG_REGISTRY='${REGISTRY}' '${CLI_BIN}' memory store --key 'adr0177-bge' --value 'bge probe' --namespace adr0177" \
    "" 30

  local stored_dim; stored_dim=$(_adr0177_stored_dim "$dir")
  if [[ "$stored_dim" != "768" ]]; then
    _CHECK_OUTPUT="flag-bge: config dim=768 but RvfBackend segment dim=${stored_dim:-unknown}"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="flag-bge: model=Xenova/bge-base-en-v1.5, dim=768 propagated to config + RvfBackend"
}

# ── (3) `--embedding-model Xenova/all-MiniLM-L6-v2` (384d auto-adjust) ──────

# check_adr0177_flag_minilm_384 — verify the dimension auto-adjusts to 384 in
# config AND a new RVF segment is created at that dim. This is the strongest
# signal of the lookup-table wiring per Phase 1.6 (b) (init validates against
# memory-initializer.ts's known-dim table).
check_adr0177_flag_minilm_384() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local dir; dir=$(mktemp -d /tmp/ruflo-adr0177-minilm-XXXXX)
  # shellcheck disable=SC2064
  trap "rm -rf '$dir' 2>/dev/null; trap - RETURN INT TERM" RETURN INT TERM

  _adr0177_run_init "$dir" "Xenova/all-MiniLM-L6-v2"

  local cfg="${dir}/.claude-flow/config.json"
  if [[ ! -f "$cfg" ]]; then
    _CHECK_OUTPUT="flag-minilm: ${cfg} not found after init --embedding-model minilm"
    return
  fi

  local model dim
  model=$(_adr0177_cfg "$cfg" "c.embedding?.model")
  dim=$(_adr0177_cfg "$cfg" "c.embedding?.dimension")

  if [[ "$model" != "Xenova/all-MiniLM-L6-v2" ]]; then
    _CHECK_OUTPUT="flag-minilm: embedding.model=${model:-missing} (want:Xenova/all-MiniLM-L6-v2)"
    return
  fi
  if [[ "$dim" != "384" ]]; then
    _CHECK_OUTPUT="flag-minilm: embedding.dimension=${dim:-missing} (want:384 — auto-adjust failed; lookup table not consulted?)"
    return
  fi

  # Verify embeddings.json (runtime-canonical) matches.
  local emb="${dir}/.claude-flow/embeddings.json"
  if [[ -f "$emb" ]]; then
    local em ed
    em=$(_adr0177_emb "$emb" "e.model")
    ed=$(_adr0177_emb "$emb" "e.dimension")
    if [[ "$em" != "Xenova/all-MiniLM-L6-v2" || "$ed" != "384" ]]; then
      _CHECK_OUTPUT="flag-minilm: config.json OK but embeddings.json {model=${em:-missing}, dimension=${ed:-missing}} disagrees (want:miniLM,384)"
      return
    fi
  fi

  # Drive a store so the RvfBackend writes a fresh segment at 384.
  _run_and_kill \
    "cd '${dir}' && NPM_CONFIG_REGISTRY='${REGISTRY}' '${CLI_BIN}' memory init --force" \
    "" 30
  _run_and_kill \
    "cd '${dir}' && NPM_CONFIG_REGISTRY='${REGISTRY}' '${CLI_BIN}' memory store --key 'adr0177-mini' --value 'minilm probe' --namespace adr0177" \
    "" 30

  local stored_dim; stored_dim=$(_adr0177_stored_dim "$dir")
  if [[ "$stored_dim" != "384" ]]; then
    _CHECK_OUTPUT="flag-minilm: config dim=384 but RvfBackend segment dim=${stored_dim:-unknown} (segment not re-created at new dim)"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="flag-minilm: model=Xenova/all-MiniLM-L6-v2, dim auto-adjusted to 384 in config + RvfBackend segment"
}
