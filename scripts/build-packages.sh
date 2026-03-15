#!/usr/bin/env bash
# scripts/build-packages.sh — TypeScript compile + WASM build (ADR-0038)
#
# Standalone build script extracted from sync-and-build.sh.
# Compiles TypeScript packages in dependency order, builds WASM.
#
# Usage: bash scripts/build-packages.sh [build-dir]
#
# Environment:
#   TEMP_DIR                Build directory (default: /tmp/ruflo-build)
#   CHANGED_PACKAGES_JSON   JSON array of changed packages (default: "all")
#   NEW_RUFLO_HEAD          Fork HEAD SHAs for build manifest
#   NEW_AGENTIC_HEAD
#   NEW_FANN_HEAD
#   NEW_RUVECTOR_HEAD

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Source shared utilities
source "${PROJECT_DIR}/lib/pipeline-utils.sh"

TEMP_DIR="${1:-${TEMP_DIR:-/tmp/ruflo-build}}"
mkdir -p "${TEMP_DIR}"

# Initialise timing files (idempotent — don't clobber if already populated)
: >> "$TIMING_CMDS_FILE"
: >> "$TIMING_BUILD_PKGS_FILE"

: "${CHANGED_PACKAGES_JSON:=all}"
: "${NEW_RUFLO_HEAD:=}"
: "${NEW_AGENTIC_HEAD:=}"
: "${NEW_FANN_HEAD:=}"
: "${NEW_RUVECTOR_HEAD:=}"
BUILD_COMPILED_COUNT=""
BUILD_TOTAL_COUNT=""

# ---------------------------------------------------------------------------
# Codemod wrapper
# ---------------------------------------------------------------------------

run_codemod() {
  log "Running codemod: @claude-flow/* -> @sparkleideas/*"
  local _cm_start _cm_end
  _cm_start=$(date +%s%N 2>/dev/null || echo 0)
  node "${SCRIPT_DIR}/codemod.mjs" "${TEMP_DIR}"
  _cm_end=$(date +%s%N 2>/dev/null || echo 0)
  if [[ "$_cm_start" != "0" && "$_cm_end" != "0" ]]; then
    local _cm_ms=$(( (_cm_end - _cm_start) / 1000000 ))
    log "  Codemod completed in ${_cm_ms}ms"
    add_cmd_timing "codemod" "node codemod.mjs" "${_cm_ms}"
  fi

  # Strip publish bloat from agentic-jujutsu (~58MB of native binaries, nested
  # tarballs, tests, docs). The upstream files field includes the whole directory
  # but consumers only need index.js, *.d.ts, bin/, pkg/, and package.json.
  local jj_dir="${TEMP_DIR}/cross-repo/agentic-flow/packages/agentic-jujutsu"
  if [[ -d "$jj_dir" ]]; then
    local _jj_before _jj_after
    _jj_before=$(du -sm "$jj_dir" 2>/dev/null | cut -f1) || _jj_before=0
    rm -f "$jj_dir"/*.node "$jj_dir"/*.tgz 2>/dev/null || true
    rm -rf "$jj_dir"/{tests,docs,benchmarks,benches,examples,test-repo,target,src,typescript,helpers,scripts} 2>/dev/null || true
    _jj_after=$(du -sm "$jj_dir" 2>/dev/null | cut -f1) || _jj_after=0
    local _jj_saved=$(( _jj_before - _jj_after ))
    if [[ $_jj_saved -gt 0 ]]; then
      log "  Stripped ${_jj_saved}MB publish bloat from agentic-jujutsu (${_jj_before}MB -> ${_jj_after}MB)"
    fi
  fi
}

# ---------------------------------------------------------------------------
# Build (TypeScript compilation)
# ---------------------------------------------------------------------------

run_build() {
  # Remove .npmignore and .gitignore so npm publish uses "files" from package.json (single find)
  find "${TEMP_DIR}" \( -name ".npmignore" -o -name ".gitignore" \) -not -path "*/node_modules/*" -delete 2>/dev/null || true

  local v3_dir="${TEMP_DIR}/v3"
  if [[ ! -d "$v3_dir" ]]; then
    log "No v3/ directory found — skipping TypeScript build"
    return 0
  fi

  # Install TypeScript in a persistent directory (cached across runs)
  local tsc_dir="/tmp/ruflo-tsc-toolchain"
  if [[ ! -x "${tsc_dir}/node_modules/.bin/tsc" ]] || \
     [[ $(find "${tsc_dir}" -maxdepth 0 -mmin +1440 -print 2>/dev/null | wc -l) -gt 0 ]]; then
    rm -rf "${tsc_dir}"
    mkdir -p "${tsc_dir}" "${tsc_dir}/stubs"
    (cd "$tsc_dir" && echo '{"private":true}' > package.json \
      && npm install typescript@5 zod@3 @types/express @types/cors @types/fs-extra --save-exact 2>&1) | tail -1
    # Create type stubs for optional modules (ADR-0028)
    cat > "${tsc_dir}/stubs/agentic-flow_embeddings.d.ts" << 'TSSTUB'
declare module 'agentic-flow/embeddings' {
  export function getOptimizedEmbedder(opts: any): any;
  export function getNeuralSubstrate(opts?: any): any;
  export function listAvailableModels(): Array<{ id: string; dimension: number; size: string; quantized: boolean; downloaded: boolean; }>;
  export function downloadModel(modelId: string): Promise<void>;
  export class OptimizedEmbedder { embed(text: string): Promise<Float32Array>; embedBatch(texts: string[]): Promise<Float32Array[]>; init(): Promise<void>; }
}
TSSTUB
    cat > "${tsc_dir}/stubs/onnxruntime-node.d.ts" << 'TSSTUB'
declare module 'onnxruntime-node' {
  export class InferenceSession { static create(path: string, opts?: any): Promise<InferenceSession>; run(feeds: any): Promise<any>; }
  export class Tensor { constructor(type: string, data: any, dims?: number[]); data: any; dims: number[]; }
}
TSSTUB
    cat > "${tsc_dir}/stubs/bcrypt.d.ts" << 'TSSTUB'
declare module 'bcrypt' {
  export function hash(data: string, saltOrRounds: string | number): Promise<string>;
  export function compare(data: string, encrypted: string): Promise<boolean>;
  export function genSalt(rounds?: number): Promise<string>;
}
TSSTUB
    cat > "${tsc_dir}/stubs/express.d.ts" << 'TSSTUB'
declare module 'express' {
  export interface Request { body: any; params: any; query: any; headers: any; method: string; url: string; path: string; }
  export interface Response { status(code: number): Response; json(body: any): Response; send(body?: any): Response; set(field: string, value: string): Response; end(): void; }
  export interface NextFunction { (err?: any): void; }
  export interface Express { use(...args: any[]): any; get(...args: any[]): any; post(...args: any[]): any; listen(...args: any[]): any; }
  export interface Router { use(...args: any[]): any; get(...args: any[]): any; post(...args: any[]): any; }
  function express(): Express;
  namespace express { function Router(): Router; function json(opts?: any): any; function urlencoded(opts?: any): any; function static(root: string): any; }
  export = express;
}
TSSTUB
    cat > "${tsc_dir}/stubs/cors.d.ts" << 'TSSTUB'
declare module 'cors' {
  function cors(options?: any): any;
  export = cors;
}
TSSTUB
    cat > "${tsc_dir}/stubs/fs-extra.d.ts" << 'TSSTUB'
declare module 'fs-extra' {
  export function ensureDir(path: string): Promise<void>;
  export function ensureDirSync(path: string): void;
  export function readJson(path: string): Promise<any>;
  export function writeJson(path: string, data: any, opts?: any): Promise<void>;
  export function copy(src: string, dest: string, opts?: any): Promise<void>;
  export function remove(path: string): Promise<void>;
  export function pathExists(path: string): Promise<boolean>;
  export function pathExistsSync(path: string): boolean;
  export function stat(path: string): Promise<any>;
  export function readFile(path: string, encoding?: string): Promise<any>;
  export function writeFile(path: string, data: any, opts?: any): Promise<void>;
  export function readdir(path: string): Promise<string[]>;
  export function mkdir(path: string, opts?: any): Promise<void>;
  export function mkdirp(path: string): Promise<void>;
  export function existsSync(path: string): boolean;
  export function outputFile(path: string, data: any): Promise<void>;
}
TSSTUB
    cat > "${tsc_dir}/stubs/vitest.d.ts" << 'TSSTUB'
declare module 'vitest' {
  export function describe(name: string, fn: () => void): void;
  export function it(name: string, fn: () => void | Promise<void>): void;
  export function test(name: string, fn: () => void | Promise<void>): void;
  export const expect: ((value: any) => any) & { extend(matchers: Record<string, any>): void };
  export function beforeEach(fn: () => void | Promise<void>): void;
  export function afterEach(fn: () => void | Promise<void>): void;
  export function beforeAll(fn: () => void | Promise<void>): void;
  export function afterAll(fn: () => void | Promise<void>): void;
  export const vi: any;
  export type Mock<T = any> = ((...args: any[]) => T) & { mock: { calls: any[][]; results: any[]; instances: any[]; invocationCallOrder: number[]; lastCall: any[] }; mockReturnValue(v: any): Mock<T>; mockResolvedValue(v: any): Mock<T>; mockRejectedValue(v: any): Mock<T>; mockImplementation(fn: (...args: any[]) => any): Mock<T>; mockReturnValueOnce(v: any): Mock<T>; mockResolvedValueOnce(v: any): Mock<T>; mockRejectedValueOnce(v: any): Mock<T>; getMockImplementation(): ((...args: any[]) => any) | undefined; mockClear(): void; mockReset(): void; mockRestore(): void; };
  export type ExpectStatic = typeof expect;
}
TSSTUB
    cat > "${tsc_dir}/stubs/@ruvector_attention.d.ts" << 'TSSTUB'
declare module '@ruvector/attention' {
  export interface AttentionConfig { dim: number; numHeads?: number; dropout?: number; }
  export function scaledDotProductAttention(q: Float32Array, k: Float32Array[], v: Float32Array[]): Float32Array;
  export function multiHeadAttention(q: Float32Array, k: Float32Array[], v: Float32Array[], c: AttentionConfig): Float32Array;
  export function flashAttention(q: Float32Array, k: Float32Array[], v: Float32Array[], bs?: number): Float32Array;
  export function hyperbolicAttention(q: Float32Array, k: Float32Array[], v: Float32Array[], c?: number): Float32Array;
  export type ArrayInput = Float32Array | number[];
  export interface BenchmarkResult { name: string; ops: number; mean: number; median: number; stddev: number; min: number; max: number; }
  export class FlashAttention { constructor(dim: number, numHeads: number); constructor(c?: any); compute(q: Float32Array, k: Float32Array[], v: Float32Array[]): Float32Array; computeRaw(q: Float32Array, k: Float32Array[], v: Float32Array[]): Float32Array; }
  export class DotProductAttention { constructor(dim: number, numHeads: number); constructor(c?: any); compute(q: Float32Array, k: Float32Array[], v: Float32Array[]): Float32Array; computeRaw(q: Float32Array, k: Float32Array[], v: Float32Array[]): Float32Array; }
  export class MultiHeadAttention { constructor(dim: number, numHeads: number); constructor(c?: any); compute(q: Float32Array, k: Float32Array[], v: Float32Array[]): Float32Array; }
  export class LinearAttention { constructor(dim: number, seqLen: number); constructor(c?: any); compute(q: Float32Array, k: Float32Array[], v: Float32Array[]): Float32Array; }
  export class HyperbolicAttention { constructor(dim: number, numHeads: number); constructor(c?: any); compute(q: Float32Array, k: Float32Array[], v: Float32Array[]): Float32Array; }
  export class MoEAttention { constructor(c?: any); compute(q: Float32Array, k: Float32Array[], v: Float32Array[]): Float32Array; }
  export class InfoNceLoss { constructor(c?: any); compute(a: Float32Array[], p: Float32Array[], n?: Float32Array[]): number; }
  export class AdamWOptimizer { constructor(c?: any); step(p: Float32Array, g: Float32Array): Float32Array; }
}
TSSTUB
    cat > "${tsc_dir}/stubs/@ruvector_attention-wasm.d.ts" << 'TSSTUB'
declare module '@ruvector/attention-wasm' {
  const m: any;
  export default m;
  export = m;
}
TSSTUB
    cat > "${tsc_dir}/stubs/@ruvector_cognitum-gate-kernel.d.ts" << 'TSSTUB'
declare module '@ruvector/cognitum-gate-kernel' {
  const m: any;
  export default m;
  export = m;
}
TSSTUB
    cat > "${tsc_dir}/stubs/@ruvector_exotic-wasm.d.ts" << 'TSSTUB'
declare module '@ruvector/exotic-wasm' {
  const m: any;
  export default m;
  export = m;
}
TSSTUB
    cat > "${tsc_dir}/stubs/@ruvector_gnn-wasm.d.ts" << 'TSSTUB'
declare module '@ruvector/gnn-wasm' {
  const m: any;
  export default m;
  export = m;
}
TSSTUB
    cat > "${tsc_dir}/stubs/@ruvector_micro-hnsw-wasm.d.ts" << 'TSSTUB'
declare module '@ruvector/micro-hnsw-wasm' {
  const m: any;
  export default m;
  export = m;
}
TSSTUB
    cat > "${tsc_dir}/stubs/@ruvector_hyperbolic-hnsw-wasm.d.ts" << 'TSSTUB'
declare module '@ruvector/hyperbolic-hnsw-wasm' {
  const m: any;
  export default m;
  export = m;
}
TSSTUB
    cat > "${tsc_dir}/stubs/@ruvnet_bmssp.d.ts" << 'TSSTUB'
declare module '@ruvnet/bmssp' {
  export default function init(): Promise<void>;
  export class WasmNeuralBMSSP { constructor(c?: any); [key: string]: any; }
  export class WasmGraph { constructor(c?: any); [key: string]: any; }
}
TSSTUB
    cat > "${tsc_dir}/stubs/prime-radiant-advanced-wasm.d.ts" << 'TSSTUB'
declare module 'prime-radiant-advanced-wasm' {
  const m: any;
  export default m;
  export = m;
}
TSSTUB
    log "TypeScript toolchain installed at ${tsc_dir}"
  else
    log "TypeScript toolchain cached at ${tsc_dir}"
  fi
  local tsc_bin="${tsc_dir}/node_modules/.bin/tsc"

  # Build order: shared first, then the rest
  local build_order=(
    shared
    memory embeddings codex aidefence
    neural hooks browser plugins providers claims
    guidance mcp integration deployment swarm security performance
    cli testing
  )

  # Parse CHANGED_PACKAGES_JSON (full transitive set) into a lookup set for
  # selective builds. We must rebuild ALL dependents, not just directly changed
  # packages — dependents import from dist/ output which may have changed.
  local -A changed_set
  local selective_build=false
  if [[ -n "${CHANGED_PACKAGES_JSON:-}" && "${CHANGED_PACKAGES_JSON}" != "all" && "${CHANGED_PACKAGES_JSON}" != "[]" ]]; then
    selective_build=true
    # Extract package short names from JSON array of @sparkleideas/* names
    for full_name in $(echo "${CHANGED_PACKAGES_JSON}" | node -e "
      const d=require('fs').readFileSync(0,'utf8');try{JSON.parse(d).forEach(n=>console.log(n.replace('@sparkleideas/','')))}catch{}
    " 2>/dev/null); do
      changed_set["$full_name"]=1
    done
  fi

  local built=0
  local failed=0
  local skipped=0

  # Build one package (called from parallel group below)
  build_one_pkg() {
    local pkg_name="$1"
    # Accept either a bare name (resolved under v3/@claude-flow/) or a full path
    local pkg_dir
    if [[ "$pkg_name" == /* ]]; then
      pkg_dir="$pkg_name"
      pkg_name="$(basename "$pkg_dir")"
    else
      pkg_dir="$v3_dir/@claude-flow/${pkg_name}"
    fi
    local pkg_build_start
    pkg_build_start=$(date +%s%N 2>/dev/null || echo 0)

    # Create a standalone tsconfig that doesn't require project references.
    # Fixes: remove composite, exclude test files, stub missing modules.
    # See ADR-0028 for the full rationale.
    local tmp_tsconfig="$pkg_dir/tsconfig.build.json"
    node -e "
      const fs = require('fs'), path = require('path');
      const ts = JSON.parse(fs.readFileSync('$pkg_dir/tsconfig.json', 'utf-8'));

      // Strip project references (we build standalone)
      delete ts.references;
      delete ts.compilerOptions?.composite;
      if (ts.extends) {
        try {
          const base = JSON.parse(fs.readFileSync(path.resolve('$pkg_dir', ts.extends), 'utf-8'));
          ts.compilerOptions = { ...base.compilerOptions, ...ts.compilerOptions };
          delete ts.extends;
        } catch {}
      }
      delete ts.compilerOptions.composite;
      ts.compilerOptions.skipLibCheck = true;
      ts.compilerOptions.noEmit = false;

      // Preserve original rootDir if set (e.g. './src' -> dist/index.js)
      if (!ts.compilerOptions.rootDir) ts.compilerOptions.rootDir = '.';

      // Exclude test files from compilation (they import vitest which isn't installed)
      if (!ts.exclude) ts.exclude = [];
      ts.exclude.push('**/*.test.ts', '**/*.spec.ts', '**/__tests__/**');

      // Map sibling @sparkleideas/* packages to their dist/ declarations.
      // IMPORTANT: use dist/*.d.ts (not src/*.ts) to avoid rootDir violations
      // when paths resolve to files outside this package's rootDir.
      const v3cf = path.resolve('$pkg_dir', '..'); // v3/@claude-flow parent
      if (fs.existsSync(v3cf)) {
        if (!ts.compilerOptions.paths) ts.compilerOptions.paths = {};
        if (!ts.compilerOptions.baseUrl) ts.compilerOptions.baseUrl = '.';
        for (const sibling of fs.readdirSync(v3cf)) {
          const sibDir = path.join(v3cf, sibling);
          const sibPkg = path.join(sibDir, 'package.json');
          if (!fs.existsSync(sibPkg)) continue;
          try {
            const sp = JSON.parse(fs.readFileSync(sibPkg, 'utf-8'));
            if (sp.name && sp.name.startsWith('@sparkleideas/')) {
              // Prefer dist/ declarations (avoids rootDir violations)
              const distIndex = path.join(sibDir, 'dist', 'index.d.ts');
              const distSrcIndex = path.join(sibDir, 'dist', 'src', 'index.d.ts');
              if (fs.existsSync(distIndex)) {
                ts.compilerOptions.paths[sp.name] = [path.relative('$pkg_dir', distIndex)];
              } else if (fs.existsSync(distSrcIndex)) {
                ts.compilerOptions.paths[sp.name] = [path.relative('$pkg_dir', distSrcIndex)];
              }
              else {
                // No dist/ yet — skip mapping (deps build first in build_order, dist/ persists in stable dir)
              }
            }
          } catch {}
        }
      }

      // Stub commonly missing optional modules.
      // Filename convention: module_name.d.ts -> module/name
      //   agentic-flow_embeddings.d.ts -> agentic-flow/embeddings
      //   @ruvector_attention -> prefix @ then: ruvector/attention
      // Scoped packages: filename starts with @ (e.g. @ruvector_attention.d.ts)
      const stubDir = '$tsc_dir/stubs';
      if (fs.existsSync(stubDir)) {
        for (const stub of fs.readdirSync(stubDir).filter(f => f.endsWith('.d.ts'))) {
          let modName = stub.replace('.d.ts', '');
          // Split on first _ to get scope/name for scoped packages
          const firstUnderscore = modName.indexOf('_');
          if (firstUnderscore > 0) {
            modName = modName.substring(0, firstUnderscore) + '/' + modName.substring(firstUnderscore + 1).replace(/_/g, '/');
          }
          if (!ts.compilerOptions.paths[modName]) {
            ts.compilerOptions.paths[modName] = [path.resolve(stubDir, stub)];
          }
        }
      }

      // Add @types from tsc toolchain (express, cors, fs-extra, zod@3)
      if (!ts.compilerOptions.typeRoots) ts.compilerOptions.typeRoots = [];
      ts.compilerOptions.typeRoots.push('$tsc_dir/node_modules/@types');
      ts.compilerOptions.typeRoots.push('./node_modules/@types');

      // Resolve zod from tsc toolchain (v3) instead of /tmp/node_modules (v4)
      ts.compilerOptions.paths['zod'] = ['$tsc_dir/node_modules/zod/index.d.ts'];

      // Enable downlevelIteration for MapIterator support
      ts.compilerOptions.downlevelIteration = true;

      // Note: moduleResolution stays as 'bundler' (original). Bare specifier stubs
      // (express, cors, etc.) are installed as real @types in the tsc toolchain.

      fs.writeFileSync('$tmp_tsconfig', JSON.stringify(ts, null, 2));
    " 2>/dev/null

    local ok=0
    local tsc_log="$pkg_dir/.tsc-build.log"
    if "$tsc_bin" -p "$tmp_tsconfig" --skipLibCheck 2>"$tsc_log"; then
      ok=1
    elif "$tsc_bin" -p "$tmp_tsconfig" --skipLibCheck --noCheck 2>"$tsc_log"; then
      ok=1
    elif "$tsc_bin" -p "$tmp_tsconfig" --skipLibCheck --noCheck --isolatedModules 2>"$tsc_log"; then
      ok=1
    fi
    # Log failures instead of swallowing them
    if [[ $ok -eq 0 && -s "$tsc_log" ]]; then
      log "    tsc failed for ${pkg_name}: $(head -3 "$tsc_log" | tr '\n' ' ')"
    fi
    rm -f "$tmp_tsconfig" "$tsc_log"

    local pkg_build_end
    pkg_build_end=$(date +%s%N 2>/dev/null || echo 0)
    local _bms=0
    if [[ "$pkg_build_start" != "0" && "$pkg_build_end" != "0" ]]; then
      _bms=$(( (pkg_build_end - pkg_build_start) / 1000000 ))
    fi
    # Write result to a temp file so the parent can collect it
    echo "${pkg_name} ${ok} ${_bms}" >> "${TEMP_DIR}/.build-results"
  }

  # Group packages by dependency level for parallel builds
  # Packages within the same group have no inter-dependencies
  local -a group_0=(shared)
  local -a group_1=(memory embeddings codex aidefence)
  local -a group_2=(neural hooks browser plugins providers claims)
  local -a group_3=(guidance mcp integration deployment swarm security performance testing)
  local -a group_4=(cli)
  local -a all_groups=("group_0" "group_1" "group_2" "group_3" "group_4")

  : > "${TEMP_DIR}/.build-results"

  local _group_idx=0
  for group_var in "${all_groups[@]}"; do
    local -n group_ref="$group_var"
    local -a bg_pids=()
    local _grp_start _grp_end _grp_count=0

    _grp_start=$(date +%s%N 2>/dev/null || echo 0)
    for pkg_name in "${group_ref[@]}"; do
      local pkg_dir="$v3_dir/@claude-flow/${pkg_name}"
      [[ -d "$pkg_dir" ]] || continue
      [[ -f "$pkg_dir/tsconfig.json" ]] || continue

      if [[ "$selective_build" == "true" && -z "${changed_set[$pkg_name]:-}" ]]; then
        skipped=$((skipped + 1))
        continue
      fi

      build_one_pkg "$pkg_name" &
      bg_pids+=($!)
      _grp_count=$((_grp_count + 1))
    done

    # Wait for all packages in this group before starting the next
    for pid in "${bg_pids[@]}"; do
      wait "$pid" 2>/dev/null || true
    done
    _grp_end=$(date +%s%N 2>/dev/null || echo 0)
    if [[ "$_grp_start" != "0" && "$_grp_end" != "0" && $_grp_count -gt 0 ]]; then
      local _grp_ms=$(( (_grp_end - _grp_start) / 1000000 ))
      log "  GROUP ${_group_idx} (${_grp_count} pkgs): ${_grp_ms}ms wall-clock"
      add_cmd_timing "build" "group_${_group_idx} (${_grp_count} pkgs)" "${_grp_ms}"
    fi
    _group_idx=$((_group_idx + 1))
  done

  # Build packages outside v3/@claude-flow/ (cross-repo, v3/plugins/*)
  local -a extra_pkg_dirs=()
  # Cross-repo packages (agentic-flow fork)
  for extra_dir in \
    "${TEMP_DIR}/cross-repo/agentic-flow/packages/agentdb" \
    "${TEMP_DIR}/cross-repo/agentic-flow/packages/agentdb-onnx"; do
    [[ -d "$extra_dir" && -f "$extra_dir/tsconfig.json" ]] && extra_pkg_dirs+=("$extra_dir")
  done
  # agentic-flow root uses config/tsconfig.json — compile it directly
  local af_dir="${TEMP_DIR}/cross-repo/agentic-flow/agentic-flow"
  if [[ -f "${af_dir}/config/tsconfig.json" && ! -f "${af_dir}/dist/index.js" ]]; then
    log "  Building agentic-flow (config/tsconfig.json)..."
    local _af_start
    _af_start=$(date +%s%N 2>/dev/null || echo 0)
    "$tsc_bin" -p "${af_dir}/config/tsconfig.json" --skipLibCheck --noCheck 2>/dev/null || true
    local _af_end
    _af_end=$(date +%s%N 2>/dev/null || echo 0)
    local _af_ms=0
    [[ "$_af_start" != "0" && "$_af_end" != "0" ]] && _af_ms=$(( (_af_end - _af_start) / 1000000 ))
    if [[ -f "${af_dir}/dist/index.js" ]]; then
      log "  BUILD: agentic-flow ${_af_ms}ms"
      echo "agentic-flow 1 ${_af_ms}" >> "${TEMP_DIR}/.build-results"
    else
      log "  FAIL: agentic-flow ${_af_ms}ms"
      echo "agentic-flow 0 ${_af_ms}" >> "${TEMP_DIR}/.build-results"
    fi
  fi
  # v3/plugins/* (all plugin packages with tsconfig)
  for extra_dir in "${TEMP_DIR}"/v3/plugins/*/; do
    [[ -d "$extra_dir" && -f "$extra_dir/tsconfig.json" ]] && extra_pkg_dirs+=("$extra_dir")
  done
  if [[ ${#extra_pkg_dirs[@]} -gt 0 ]]; then
    local -a extra_pids=()
    local _extra_start
    _extra_start=$(date +%s%N 2>/dev/null || echo 0)
    for extra_dir in "${extra_pkg_dirs[@]}"; do
      build_one_pkg "$extra_dir" &
      extra_pids+=($!)
    done
    for pid in "${extra_pids[@]}"; do
      wait "$pid" 2>/dev/null || true
    done
    local _extra_end
    _extra_end=$(date +%s%N 2>/dev/null || echo 0)
    if [[ "$_extra_start" != "0" && "$_extra_end" != "0" ]]; then
      local _extra_ms=$(( (_extra_end - _extra_start) / 1000000 ))
      log "  EXTRA (${#extra_pkg_dirs[@]} pkgs): ${_extra_ms}ms wall-clock"
      add_cmd_timing "build" "extra (${#extra_pkg_dirs[@]} pkgs)" "${_extra_ms}"
    fi
  fi

  # Collect results from parallel builds
  while IFS=' ' read -r pkg_name ok _bms; do
    [[ -z "$pkg_name" ]] && continue
    if [[ "$ok" == "1" ]]; then
      built=$((built + 1))
    else
      log_error "TypeScript build failed for ${pkg_name}"
      failed=$((failed + 1))
    fi
    log "  BUILD: ${pkg_name} ${_bms}ms"
    add_build_pkg_timing "${pkg_name}" "${_bms}"
    add_cmd_timing "build" "tsc ${pkg_name}" "${_bms}"
  done < "${TEMP_DIR}/.build-results"
  rm -f "${TEMP_DIR}/.build-results"

  # Build cross-repo packages
  local cross_repo_builds=(
    "cross-repo/agentic-flow/packages/agent-booster"
  )
  for rel_path in "${cross_repo_builds[@]}"; do
    local pkg_dir="${TEMP_DIR}/${rel_path}"
    [[ -d "$pkg_dir" && -f "$pkg_dir/tsconfig.json" ]] || continue

    log "  Building cross-repo: ${rel_path}"
    local _xr_start _xr_end
    _xr_start=$(date +%s%N 2>/dev/null || echo 0)

    # Build WASM and TypeScript in parallel (independent processes)
    local crate_dir="$pkg_dir/crates/agent-booster-wasm"
    local wasm_pid=""
    local _wasm_start=""
    local wasm_cache="/tmp/ruflo-build/.wasm-cache.json"
    local should_rebuild_wasm=true

    if [[ -d "$crate_dir" ]] && command -v wasm-pack &>/dev/null; then
      # Check WASM cache: hash all Rust source files, skip if unchanged
      local parent_crate_dir="$crate_dir/../agent-booster"
      # Compute hash of all WASM-relevant source files
      local current_wasm_hash
      current_wasm_hash=$(cat \
        "$crate_dir/Cargo.toml" \
        "$crate_dir/src/lib.rs" \
        "$parent_crate_dir/Cargo.toml" \
        $(find "$parent_crate_dir/src" -name "*.rs" -type f 2>/dev/null | sort) \
        2>/dev/null | sha256sum | cut -d' ' -f1) || current_wasm_hash=""

      if [[ -n "$current_wasm_hash" && -f "$wasm_cache" && -f "$pkg_dir/wasm/agent_booster_wasm.js" ]]; then
        local cached_wasm_hash
        cached_wasm_hash=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$wasm_cache','utf-8')).wasm_source_hash||'')" 2>/dev/null) || cached_wasm_hash=""
        if [[ "$current_wasm_hash" == "$cached_wasm_hash" ]]; then
          log "  WASM cache hit — skipping wasm-pack (hash=${current_wasm_hash:0:12})"
          should_rebuild_wasm=false
          add_cmd_timing "build" "wasm-pack (cache hit)" "0"
        fi
      fi

      if [[ "$should_rebuild_wasm" == "true" ]]; then
        log "  Building WASM: ${rel_path}/crates/agent-booster-wasm"
        _wasm_start=$(date +%s%N 2>/dev/null || echo 0)
        (
          wasm_out=$(wasm-pack build "$crate_dir" --target nodejs --out-dir "$pkg_dir/wasm" 2>&1) || {
            echo "WARN: WASM build failed for ${rel_path}" >&2
            echo "$wasm_out" | tail -5 >&2
          }
          if [[ -f "$pkg_dir/wasm/agent_booster_wasm.js" ]]; then
            rm -f "$pkg_dir/wasm/package.json" "$pkg_dir/wasm/.gitignore"
            # Write WASM cache on success
            cat > "$wasm_cache" <<WASMCACHE
{"wasm_source_hash":"${current_wasm_hash}","built_at":"$(date -u '+%Y-%m-%dT%H:%M:%SZ')"}
WASMCACHE
          fi
        ) &
        wasm_pid=$!
      fi
    fi

    local _xr_tsc_start _xr_tsc_end
    _xr_tsc_start=$(date +%s%N 2>/dev/null || echo 0)
    if "$tsc_bin" -p "$pkg_dir/tsconfig.json" --skipLibCheck 2>/dev/null; then
      built=$((built + 1))
    else
      log "WARN: TypeScript build failed for ${rel_path}"
      failed=$((failed + 1))
    fi
    _xr_tsc_end=$(date +%s%N 2>/dev/null || echo 0)
    if [[ "$_xr_tsc_start" != "0" && "$_xr_tsc_end" != "0" ]]; then
      local _xr_tsc_ms=$(( (_xr_tsc_end - _xr_tsc_start) / 1000000 ))
      log "  cross-repo TSC: ${_xr_tsc_ms}ms"
      add_cmd_timing "build" "tsc cross-repo/agent-booster" "${_xr_tsc_ms}"
    fi

    # Wait for WASM build to finish
    if [[ -n "$wasm_pid" ]]; then
      wait "$wasm_pid" 2>/dev/null && {
        local _wasm_end
        _wasm_end=$(date +%s%N 2>/dev/null || echo 0)
        if [[ -n "$_wasm_start" && "$_wasm_start" != "0" && "$_wasm_end" != "0" ]]; then
          local _wasm_ms=$(( (_wasm_end - _wasm_start) / 1000000 ))
          log "  WASM build: ${_wasm_ms}ms"
          add_cmd_timing "build" "wasm-pack agent-booster" "${_wasm_ms}"
        fi
        log "  WASM build succeeded"
      } || true
    fi

    _xr_end=$(date +%s%N 2>/dev/null || echo 0)
    if [[ "$_xr_start" != "0" && "$_xr_end" != "0" ]]; then
      local _xr_ms=$(( (_xr_end - _xr_start) / 1000000 ))
      add_cmd_timing "build" "cross-repo total" "${_xr_ms}"
    fi
  done

  log "Build complete: ${built} built, ${skipped} skipped, ${failed} failed"

  # Single combined scan (avoids running find twice for the same data)
  local total_packages compiled_packages pre_built_packages _scan_start _scan_end
  _scan_start=$(date +%s%N 2>/dev/null || echo 0)
  compiled_packages=$(find "${TEMP_DIR}" -name "dist" -type d 2>/dev/null | wc -l)
  total_packages=$(find "${TEMP_DIR}" -name "package.json" -not -path "*/node_modules/*" -not -path "*/.tsc-toolchain/*" -exec grep -l '"@sparkleideas/' {} + 2>/dev/null | wc -l)
  pre_built_packages=$((total_packages - compiled_packages))
  _scan_end=$(date +%s%N 2>/dev/null || echo 0)
  if [[ "$_scan_start" != "0" && "$_scan_end" != "0" ]]; then
    local _scan_ms=$(( (_scan_end - _scan_start) / 1000000 ))
    log "  post-build scan: ${_scan_ms}ms"
    add_cmd_timing "build" "find scan" "${_scan_ms}"
  fi
  log "Build directory contains ${total_packages} publishable packages (${compiled_packages} compiled, ${pre_built_packages} pre-built)"
  if [[ $failed -gt 0 ]]; then
    log_error "Some packages failed to build — published packages may be broken"
  fi

  # Export build stats for manifest (written by write_build_manifest after build completes)
  BUILD_COMPILED_COUNT=$compiled_packages
  BUILD_TOTAL_COUNT=$total_packages
}

write_build_manifest() {
  local manifest="${TEMP_DIR}/.build-manifest.json"
  local _wm_start _wm_end
  _wm_start=$(date +%s%N 2>/dev/null || echo 0)
  local codemod_hash
  codemod_hash=$(sha256sum "${SCRIPT_DIR}/codemod.mjs" 2>/dev/null | cut -d' ' -f1) || codemod_hash=""

  # Use pre-computed counts from run_build if available, else scan (for --build-only without run_build)
  local compiled_count="${BUILD_COMPILED_COUNT:-}"
  local total_count="${BUILD_TOTAL_COUNT:-}"
  if [[ -z "$compiled_count" ]]; then
    compiled_count=$(find "${TEMP_DIR}" -name "dist" -type d 2>/dev/null | wc -l)
  fi
  if [[ -z "$total_count" ]]; then
    total_count=$(find "${TEMP_DIR}" -name "package.json" -not -path "*/node_modules/*" -not -path "*/.tsc-toolchain/*" -exec grep -l '"@sparkleideas/' {} + 2>/dev/null | wc -l)
  fi

  cat > "$manifest" <<MANIFESTEOF
{
  "version": 2,
  "built_at": "$(date -u '+%Y-%m-%dT%H:%M:%SZ')",
  "ruflo_head": "${NEW_RUFLO_HEAD:-}",
  "agentic_head": "${NEW_AGENTIC_HEAD:-}",
  "fann_head": "${NEW_FANN_HEAD:-}",
  "ruvector_head": "${NEW_RUVECTOR_HEAD:-}",
  "codemod_hash": "${codemod_hash}",
  "packages_compiled": ${compiled_count},
  "packages_total": ${total_count}
}
MANIFESTEOF
  _wm_end=$(date +%s%N 2>/dev/null || echo 0)
  if [[ "$_wm_start" != "0" && "$_wm_end" != "0" ]]; then
    local _wm_ms=$(( (_wm_end - _wm_start) / 1000000 ))
    log "  Build manifest written in ${_wm_ms}ms"
    add_cmd_timing "build" "write-manifest" "${_wm_ms}"
  fi
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

run_build
write_build_manifest
log "Build packages complete"
