# ADR-0070: Init-Generated Config Acceptance Tests

- **Status**: Implemented (fully wired 2026-04-06)
- **Date**: 2026-04-05
- **Updated**: 2026-04-06 (function naming, config format, CLI flag fixes — see ADR-0071)
- **Depends on**: ADR-0069 (config chain), ADR-0068 (controller wiring)
- **Deciders**: Henrik Pettersen
- **Relates to**: ADR-0038 (Cascading Pipeline), ADR-0071 (native binary bundling)

## Context

ADR-0069 added 16+ config.json keys and a config template module. However, no
acceptance test validates that `init --full` generates correct DEFAULT VALUES.
The existing tests either:

- Grep published package source for code patterns (not runtime values)
- Check key presence without value assertion
- Use harness-stamped config (embeddings.json overwritten after init)

The harness in `test-acceptance.sh` lines 236-249 explicitly overwrites
`embeddings.json` with hardcoded values after init runs, then later checks
confirm those same stamped values pass. This proves the harness works, not the
product.

A wrong default (e.g., ewcLambda=1 instead of 2000) would pass all 126 existing
acceptance checks. Three categories of gap exist:

1. **Harness-stamped config** -- embeddings.json is overwritten by the harness
   before checks run (lines 236-249 of test-acceptance.sh)
2. **Grep-only checks** -- ADR-0069 init checks (lib/acceptance-adr0069-init-checks.sh)
   verify that keys *exist* with grep, but never check *values*
3. **No CLI flag coverage** -- `init --port`, `--similarity-threshold`,
   `--max-agents` are untested

## Decision

Add a new acceptance check library (`lib/acceptance-init-generated-checks.sh`)
and wire it as a Phase 5 group in the main harness. The checks use a completely
fresh temp directory, run `init` without any harness stamping, and validate the
raw generated output.

### Design: Phase 5 in the main harness, not a separate script

**Rationale:**
- It must run as part of every `npm run test:acceptance` to catch regressions
- It reuses `CLI_BIN` from the installed packages (no reinstall)
- It runs after Phase 4 (daemon IPC) and before results reporting
- Estimated wall time: 20-30s (one `init --full` at ~10s, three `init --flag`
  at ~5s each, memory store+search at ~5s total)
- Also wired into `test-acceptance-fast.sh` as group `p5`

### Check functions and expected values

All checks follow the existing pattern: set `_CHECK_PASSED` and `_CHECK_OUTPUT`.
Each operates on `_P5_DIR`, a fresh mktemp directory created at Phase 5 start.

#### Group 1: config.json structure and defaults (parallel)

| ID | Function | What it validates |
|----|----------|-------------------|
| `p5-cfg-valid-json` | `check_p5_config_valid_json` | `$_P5_DIR/.claude-flow/config.json` exists and parses as valid JSON |
| `p5-cfg-sqlite` | `check_p5_config_sqlite_keys` | `memory.sqlite.cacheSize == -64000` (exact value, not just key existence) |
| `p5-cfg-neural` | `check_p5_config_neural_keys` | `neural.ewcLambda == 2000`, `neural.learningRates` object exists |
| `p5-cfg-ports` | `check_p5_config_ports` | `ports.mcp == 3000` |
| `p5-cfg-ratelimiter` | `check_p5_config_ratelimiter` | `rateLimiter.default.windowMs == 60000` |
| `p5-cfg-workers` | `check_p5_config_workers` | `workers.triggers.optimize.timeoutMs == 300000` |
| `p5-cfg-similarity` | `check_p5_config_similarity` | `memory.similarityThreshold == 0.7` |
| `p5-cfg-dedup` | `check_p5_config_dedup` | `memory.dedupThreshold == 0.95` |
| `p5-cfg-maxcpu` | `check_p5_config_maxcpu` | `daemon.resourceThresholds.maxCpuLoad == 28` |

#### Group 2: embeddings.json without harness stamping (parallel)

| ID | Function | What it validates |
|----|----------|-------------------|
| `p5-emb-valid-json` | `check_p5_embeddings_valid_json` | `$_P5_DIR/.claude-flow/embeddings.json` exists and parses |
| `p5-emb-model` | `check_p5_embeddings_model` | `model == "all-mpnet-base-v2"` (not MiniLM) |
| `p5-emb-dim` | `check_p5_embeddings_dimension` | `dimension == 768` |
| `p5-emb-hnsw-m` | `check_p5_embeddings_hnsw_m` | `hnsw.m == 23` |
| `p5-emb-hnsw-efc` | `check_p5_embeddings_hnsw_efc` | `hnsw.efConstruction == 100` |
| `p5-emb-hnsw-efs` | `check_p5_embeddings_hnsw_efs` | `hnsw.efSearch == 50` |
| `p5-emb-maxel` | `check_p5_embeddings_maxel` | `hnsw.maxElements == 100000` |

#### Group 3: Runtime integration (sequential -- data dependencies)

| ID | Function | What it validates |
|----|----------|-------------------|
| `p5-rt-memory-store` | `check_p5_runtime_memory_store` | `memory store --key p5-test --value "hello world" --namespace p5` succeeds |
| `p5-rt-memory-search` | `check_p5_runtime_memory_search` | `memory search --query "hello world" --namespace p5` returns p5-test |

#### Group 4: CLI flag override (sequential -- each needs fresh init)

Each creates a sub-directory under `$_P5_DIR` and runs init with specific flags.

| ID | Function | What it validates |
|----|----------|-------------------|
| `p5-flag-port` | `check_p5_flag_port` | `init --port 4000` -> `config.json` has `ports.mcp == 4000` |
| `p5-flag-similarity` | `check_p5_flag_similarity` | `init --similarity-threshold 0.8` -> `memory.similarityThreshold == 0.8` |
| `p5-flag-maxagents` | `check_p5_flag_maxagents` | `init --max-agents 10` -> `swarm.maxAgents == 10` |

#### Group 5: Backward compatibility (sequential)

| ID | Function | What it validates |
|----|----------|-------------------|
| `p5-compat-no-overwrite` | `check_p5_compat_no_overwrite` | Existing config.yaml project: `init` without `--force` does NOT overwrite |
| `p5-compat-config-set` | `check_p5_compat_config_set` | `config set neural.ewcLambda 1500` then `config get neural.ewcLambda` returns 1500 |

### Total: 23 checks (all passing as of 2026-04-06)

### Implementation structure

```
lib/acceptance-init-generated-checks.sh    # All 23 check functions
```

### Fixes applied 2026-04-06 (ADR-0071 session)

The original implementation had several issues discovered during acceptance testing:

1. **Function name mismatch**: lib defined `check_p5_ewc_lambda` etc., but `test-acceptance.sh`
   called `check_p5_config_neural_keys` etc. (ADR-0070 names). Renamed all lib functions to match ADR.
2. **Config format**: init generates `config.json` (not `config.yaml`). Embeddings are under
   `config.json` `embeddings` key, not a separate `embeddings.json`. All checks updated.
3. **P5 harness**: used `npx` (crashed on missing optional WASM deps). Fixed to use `$CLI_BIN`.
   `2>/dev/null || true` masked init failures — now logs to `$_P5_INIT_LOG`.
4. **CLI flag parsing**: `ctx.flags` uses camelCase (`similarityThreshold`), not kebab-case.
   Fixed in fork's `init.ts`. Added `memory.similarityThreshold` to settings-generator.
5. **config set syntax**: CLI requires `--key`/`--value` flags, not positional args.
6. **Model name**: Must use `Xenova/all-mpnet-base-v2` (full canonical, ADR-0069).

### Wiring into test-acceptance.sh

Insert after Phase 4 (line ~917) and before the results section (line ~919):

```bash
# ================================================================
# Phase 5: Init-generated config validation (ADR-0070)
# Fresh directory, no harness stamping, raw init output
# ================================================================
_p5_start=$(_ns)
log "-- Phase 5: Init-generated config (fresh dir, no stamping) --"

_P5_DIR=$(mktemp -d /tmp/ruflo-p5-XXXXX)

# Run init --full --with-embeddings in the fresh directory
log "  Running init --full --with-embeddings in $_P5_DIR"
(cd "$_P5_DIR" && NPM_CONFIG_REGISTRY="$REGISTRY" _timeout 120 "$CLI_BIN" \
  init --full --force --with-embeddings \
  --embedding-model all-mpnet-base-v2 2>&1) || true

# Parallel wave: config.json + embeddings.json checks
PARALLEL_DIR=$(mktemp -d /tmp/ruflo-accept-par-XXXXX)

run_check_bg "p5-cfg-valid-json"  "P5 config valid JSON"       check_p5_config_valid_json       "p5-config"
run_check_bg "p5-cfg-sqlite"      "P5 sqlite cacheSize"        check_p5_config_sqlite_keys      "p5-config"
run_check_bg "p5-cfg-neural"      "P5 neural keys"             check_p5_config_neural_keys      "p5-config"
run_check_bg "p5-cfg-ports"       "P5 ports.mcp"               check_p5_config_ports            "p5-config"
run_check_bg "p5-cfg-ratelimiter" "P5 rateLimiter windowMs"    check_p5_config_ratelimiter      "p5-config"
run_check_bg "p5-cfg-workers"     "P5 workers timeoutMs"       check_p5_config_workers          "p5-config"
run_check_bg "p5-cfg-similarity"  "P5 similarityThreshold"     check_p5_config_similarity       "p5-config"
run_check_bg "p5-cfg-dedup"       "P5 dedupThreshold"          check_p5_config_dedup            "p5-config"
run_check_bg "p5-cfg-maxcpu"      "P5 maxCpuLoad"              check_p5_config_maxcpu           "p5-config"
run_check_bg "p5-emb-valid-json"  "P5 embeddings valid JSON"   check_p5_embeddings_valid_json   "p5-embeddings"
run_check_bg "p5-emb-model"       "P5 embeddings model"        check_p5_embeddings_model        "p5-embeddings"
run_check_bg "p5-emb-dim"         "P5 embeddings dimension"    check_p5_embeddings_dimension    "p5-embeddings"
run_check_bg "p5-emb-hnsw-m"     "P5 HNSW m"                  check_p5_embeddings_hnsw_m       "p5-embeddings"
run_check_bg "p5-emb-hnsw-efc"   "P5 HNSW efConstruction"     check_p5_embeddings_hnsw_efc     "p5-embeddings"
run_check_bg "p5-emb-hnsw-efs"   "P5 HNSW efSearch"           check_p5_embeddings_hnsw_efs     "p5-embeddings"
run_check_bg "p5-emb-maxel"      "P5 HNSW maxElements"        check_p5_embeddings_maxel        "p5-embeddings"

collect_parallel "p5" \
  "p5-cfg-valid-json|P5 config valid JSON" \
  "p5-cfg-sqlite|P5 sqlite cacheSize" \
  "p5-cfg-neural|P5 neural keys" \
  "p5-cfg-ports|P5 ports.mcp" \
  "p5-cfg-ratelimiter|P5 rateLimiter windowMs" \
  "p5-cfg-workers|P5 workers timeoutMs" \
  "p5-cfg-similarity|P5 similarityThreshold" \
  "p5-cfg-dedup|P5 dedupThreshold" \
  "p5-cfg-maxcpu|P5 maxCpuLoad" \
  "p5-emb-valid-json|P5 embeddings valid JSON" \
  "p5-emb-model|P5 embeddings model" \
  "p5-emb-dim|P5 embeddings dimension" \
  "p5-emb-hnsw-m|P5 HNSW m" \
  "p5-emb-hnsw-efc|P5 HNSW efConstruction" \
  "p5-emb-hnsw-efs|P5 HNSW efSearch" \
  "p5-emb-maxel|P5 HNSW maxElements"

# Sequential: runtime integration
run_check "p5-rt-memory-store"  "P5 memory store"   check_p5_runtime_memory_store   "p5-runtime"
run_check "p5-rt-memory-search" "P5 memory search"  check_p5_runtime_memory_search  "p5-runtime"

# Sequential: CLI flag overrides (each needs fresh sub-dir + init)
run_check "p5-flag-port"       "P5 --port override"       check_p5_flag_port       "p5-flags"
run_check "p5-flag-similarity" "P5 --similarity override"  check_p5_flag_similarity "p5-flags"
run_check "p5-flag-maxagents"  "P5 --max-agents override"  check_p5_flag_maxagents  "p5-flags"

# Sequential: backward compatibility
run_check "p5-compat-no-overwrite" "P5 no overwrite without --force" check_p5_compat_no_overwrite "p5-compat"
run_check "p5-compat-config-set"   "P5 config set/get"              check_p5_compat_config_set   "p5-compat"

# Cleanup
rm -rf "$_P5_DIR" "$PARALLEL_DIR"; _P5_DIR=""; PARALLEL_DIR=""
_record_phase "phase5-init-generated" "$(_elapsed_ms "$_p5_start" "$(_ns)")"
```

### Wiring into test-acceptance-fast.sh

Add after the `adr0059` block:

```bash
if [[ "$_FAST_RUN_GROUPS" == *"p5"* || "$_FAST_RUN_GROUPS" == "all" ]]; then
  source "$PROJECT_DIR/lib/acceptance-init-generated-checks.sh"
  echo "-- Phase 5 (init-generated config) --"

  _P5_DIR=$(mktemp -d /tmp/ruflo-p5-XXXXX)
  (cd "$_P5_DIR" && NPM_CONFIG_REGISTRY="$REGISTRY" timeout 120 "$CLI_BIN" \
    init --full --force --with-embeddings \
    --embedding-model all-mpnet-base-v2 2>&1) || true

  # config.json
  _fast_run "p5-cfg-valid-json"  check_p5_config_valid_json
  _fast_run "p5-cfg-sqlite"      check_p5_config_sqlite_keys
  _fast_run "p5-cfg-neural"      check_p5_config_neural_keys
  _fast_run "p5-cfg-ports"       check_p5_config_ports
  _fast_run "p5-cfg-ratelimiter" check_p5_config_ratelimiter
  _fast_run "p5-cfg-workers"     check_p5_config_workers
  _fast_run "p5-cfg-similarity"  check_p5_config_similarity
  _fast_run "p5-cfg-dedup"       check_p5_config_dedup
  _fast_run "p5-cfg-maxcpu"      check_p5_config_maxcpu

  # embeddings.json
  _fast_run "p5-emb-valid-json"  check_p5_embeddings_valid_json
  _fast_run "p5-emb-model"       check_p5_embeddings_model
  _fast_run "p5-emb-dim"         check_p5_embeddings_dimension
  _fast_run "p5-emb-hnsw-m"     check_p5_embeddings_hnsw_m
  _fast_run "p5-emb-hnsw-efc"   check_p5_embeddings_hnsw_efc
  _fast_run "p5-emb-hnsw-efs"   check_p5_embeddings_hnsw_efs
  _fast_run "p5-emb-maxel"      check_p5_embeddings_maxel

  # runtime
  _fast_run "p5-rt-store"   check_p5_runtime_memory_store
  _fast_run "p5-rt-search"  check_p5_runtime_memory_search

  # flag overrides
  _fast_run "p5-flag-port"       check_p5_flag_port
  _fast_run "p5-flag-similarity" check_p5_flag_similarity
  _fast_run "p5-flag-maxagents"  check_p5_flag_maxagents

  # compat
  _fast_run "p5-compat-no-overwrite" check_p5_compat_no_overwrite
  _fast_run "p5-compat-config-set"   check_p5_compat_config_set

  rm -rf "$_P5_DIR"; _P5_DIR=""
fi
```

### Check function implementation sketch

Each function uses `node -e` to parse JSON and extract exact values, never grep.

```bash
# Example: check_p5_config_sqlite_keys
check_p5_config_sqlite_keys() {
  _CHECK_PASSED="false"; _CHECK_OUTPUT=""
  local cfg="$_P5_DIR/.claude-flow/config.json"
  [[ -f "$cfg" ]] || { _CHECK_OUTPUT="config.json not found"; return; }

  local val
  val=$(node -e "
    const c=JSON.parse(require('fs').readFileSync('$cfg','utf8'));
    console.log(JSON.stringify({
      cacheSize: (c.memory||{}).sqlite?.cacheSize
    }));
  " 2>/dev/null) || { _CHECK_OUTPUT="node parse failed"; return; }

  local cache
  cache=$(echo "$val" | node -e "
    const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    console.log(d.cacheSize);
  " 2>/dev/null)

  if [[ "$cache" == "-64000" ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="memory.sqlite.cacheSize = -64000"
  else
    _CHECK_OUTPUT="memory.sqlite.cacheSize = ${cache} (expected -64000)"
  fi
}
```

The pattern for every config value check is identical: parse with node, compare
exact value, fail with actual-vs-expected message. The embeddings checks do the
same against `embeddings.json`.

Runtime checks use `_run_and_kill` with the CLI binary. Flag override checks
create `$_P5_DIR/flag-{name}`, run init there, and validate.

## Timing estimate

| Phase 5 section | Estimated time |
|-----------------|---------------|
| init --full --with-embeddings | ~10s |
| 16 parallel config/embedding checks | ~1s (node -e, no I/O) |
| 2 sequential runtime checks (memory store + search) | ~5s |
| 3 sequential flag override checks (3 x init) | ~15s |
| 2 sequential compat checks | ~5s |
| **Total** | **~36s** |

This adds ~36s to the ~120s current acceptance run (30% increase). Acceptable
because it catches a class of bug that no existing test covers.

## Bugs Found During Implementation

- **Model name inconsistency**: config.json uses `"Xenova/all-mpnet-base-v2"`
  while embeddings.json uses `"all-mpnet-base-v2"`. The Phase 5 embeddings check
  validates the canonical short form (`all-mpnet-base-v2`).
- **cacheSize disagreement**: embeddings.json had `cacheSize: 256` while
  config.json uses `cacheSize: -64000` (SQLite page-cache pragma). These are
  different caches serving different purposes, but the naming collision is
  confusing.
- **Memory persistence bug**: CLI `memory store` does not persist between
  invocations in some environments. The Phase 5 runtime checks (`p5-rt-*`)
  exercise this path and will catch regressions.

## Consequences

- **Positive**: Every config default is now regression-tested
- **Positive**: Init output is tested without harness contamination
- **Positive**: CLI flag overrides get first-ever acceptance coverage
- **Positive**: Backward compatibility (no-overwrite, config set/get) is verified
- **Positive**: Init template changes that break defaults are caught before publishing
- **Negative**: ~36s added to acceptance run time
- **Migration**: Existing ADR-0069 init checks (`adr0069-init-*`) continue
  running; they serve as a fast sanity check in the mega-parallel wave. Phase 5
  checks are the authoritative source of truth for init output correctness.
