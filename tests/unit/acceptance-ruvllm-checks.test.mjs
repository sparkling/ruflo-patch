// @tier unit
// W2-I2: tests for lib/acceptance-ruvllm-checks.sh
//
// Covers:
//   1. Static contract — the library defines the expected checks and helpers,
//      no longer accepts "Router not found" / "SONA not found" / "MicroLoRA
//      not found" as PASS, and uses the canonical _mcp_invoke_tool helper.
//   2. ID-extraction helpers (_extract_router_id / _extract_sona_id /
//      _extract_lora_id) parse the create-tool output correctly.
//   3. End-to-end lifecycle: with a stubbed CLI that mimics the persisted
//      HNSW router, a create → add → route sequence passes and mutates the
//      store file on disk.
//
// Strategy: stub `cli mcp exec --tool …` with a bash shim keyed by tool name.
// The shim writes a `.claude-flow/ruvllm/hnsw-store.json` so the check's
// presence-of-store-file assertion passes, and returns shaped JSON bodies
// for each tool. No real build artifacts are required.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const LIB_DIR = resolve(ROOT, 'lib');
const RUVLLM_FILE = resolve(LIB_DIR, 'acceptance-ruvllm-checks.sh');
const HARNESS_FILE = resolve(LIB_DIR, 'acceptance-harness.sh');

// ───────────────────────────────────────────────────────────────
// Static contract
// ───────────────────────────────────────────────────────────────

describe('W2-I2 — ruvllm-checks static contract', () => {
  const src = readFileSync(RUVLLM_FILE, 'utf-8');

  it('defines all 10 check functions', () => {
    const expected = [
      'check_adr0094_p5_ruvllm_status',
      'check_adr0094_p5_ruvllm_hnsw_create',
      'check_adr0094_p5_ruvllm_hnsw_add',
      'check_adr0094_p5_ruvllm_hnsw_route',
      'check_adr0094_p5_ruvllm_sona_create',
      'check_adr0094_p5_ruvllm_sona_adapt',
      'check_adr0094_p5_ruvllm_microlora_create',
      'check_adr0094_p5_ruvllm_microlora_adapt',
      'check_adr0094_p5_ruvllm_generate_config',
      'check_adr0094_p5_ruvllm_chat_format',
    ];
    for (const name of expected) {
      assert.match(src, new RegExp(`^${name}\\(\\)\\s*\\{`, 'm'),
        `missing check function ${name}`);
    }
  });

  it('uses the canonical _mcp_invoke_tool (not a custom probe)', () => {
    assert.match(src, /_mcp_invoke_tool /);
  });

  it('does NOT accept "Router not found" / "SONA not found" / "MicroLoRA not found" as PASS', () => {
    // The previous version had regex literals like 'router not found' in the
    // expected-pattern arg for hnsw_add/route; those were the ADR-0082
    // violation W2-I2 removes. We accept those strings inside comments
    // (they explain the motivation) but not inside regex-alternation
    // expressions passed to _mcp_invoke_tool / _ruvllm_invoke_tool.
    //
    // The old pattern looked like:
    //   '\[OK\]|content|result|index|hnsw|added|success|router not found|patternCount'
    // so we scan for the exact "|...not found" alternation form.
    assert.ok(!/\|[^|'"`]*router\s+not\s+found/i.test(src),
      'regex ALTERNATIVE "router not found" must not PASS');
    assert.ok(!/\|[^|'"`]*sona\s+not\s+found/i.test(src),
      'regex ALTERNATIVE "sona not found" must not PASS');
    assert.ok(!/\|[^|'"`]*microlora\s+not\s+found/i.test(src),
      'regex ALTERNATIVE "microlora not found" must not PASS');
  });

  it('asserts persistence files exist on disk after create', () => {
    assert.match(src, /hnsw-store\.json/,
      'must assert hnsw-store.json exists after create');
    assert.match(src, /sona-store\.json/);
    assert.match(src, /microlora-store\.json/);
  });

  it('uses _with_iso_cleanup for stateful lifecycles', () => {
    assert.match(src, /_with_iso_cleanup /);
  });

  it('defines ID-extraction helpers', () => {
    assert.match(src, /^_extract_router_id\(\)/m);
    assert.match(src, /^_extract_sona_id\(\)/m);
    assert.match(src, /^_extract_lora_id\(\)/m);
  });
});

// ───────────────────────────────────────────────────────────────
// End-to-end: stubbed CLI + real shell lifecycle body
// ───────────────────────────────────────────────────────────────

/**
 * Build a CLI stub that acts like a persistence-aware MCP driver.
 *
 * For hnsw_create: writes the hnsw-store.json with a fresh routerId and
 * returns a body containing that routerId.
 * For hnsw_add: reads the store, appends to the journal (in-stub), echoes
 * {success:true, patternCount:N}.
 * For hnsw_route: reads the store, returns {results:[{name:"alpha",...}]}
 * if any pattern was added.
 */
function writeRuvllmStub(dir) {
  const shim = join(dir, 'cli');
  const script = String.raw`#!/usr/bin/env bash
# Tiny stub that mimics a persistence-aware MCP runtime for 3 tools.
set +e
# Parse: cli mcp exec --tool <name> [--params '<json>']
tool=""; params="{}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    mcp) shift ;;
    exec) shift ;;
    --tool) tool="$2"; shift 2 ;;
    --params) params="$2"; shift 2 ;;
    *) shift ;;
  esac
done

cwd="$PWD"
store_dir="$cwd/.claude-flow/ruvllm"
hnsw_store="$store_dir/hnsw-store.json"
sona_store="$store_dir/sona-store.json"
lora_store="$store_dir/microlora-store.json"
mkdir -p "$store_dir"

emit_body() {
  echo "[AgentDB] Telemetry disabled"
  echo "[INFO] Executing tool: $tool"
  echo "[OK] Tool executed in 1ms"
  echo "Result:"
  printf '%s\n' "$1"
}

case "$tool" in
  ruvllm_hnsw_create)
    rid="hnsw-stub-$(date +%s%N | tr -d '\n' | head -c 14)"
    # Write the persistence file (shaped like ruvllm-store.ts output)
    cat > "$hnsw_store" <<EOF
{"version":"1","routers":{"$rid":{"id":"$rid","createdAt":"2026-04-17","config":{"dimensions":4,"maxPatterns":8},"journal":[]}}}
EOF
    emit_body "{\"success\":true,\"routerId\":\"$rid\",\"dimensions\":4,\"maxPatterns\":8,\"persisted\":true}"
    ;;
  ruvllm_hnsw_add)
    # Extract routerId from params using node (avoids jq dep)
    rid=$(node -e "try{const j=JSON.parse(process.argv[1]);process.stdout.write(j.routerId||'')}catch{}" -- "$params")
    if [[ -z "$rid" ]]; then
      emit_body "{\"error\":\"missing routerId\"}"
      exit 1
    fi
    if [[ ! -f "$hnsw_store" ]]; then
      emit_body "{\"error\":\"Router not found: $rid\"}"
      exit 1
    fi
    # Cheap patternCount bump via a marker file
    count_file="$store_dir/.count-$rid"
    prev=$(cat "$count_file" 2>/dev/null || echo 0)
    new=$((prev + 1))
    echo "$new" > "$count_file"
    emit_body "{\"success\":true,\"patternCount\":$new}"
    ;;
  ruvllm_hnsw_route)
    rid=$(node -e "try{const j=JSON.parse(process.argv[1]);process.stdout.write(j.routerId||'')}catch{}" -- "$params")
    if [[ -z "$rid" || ! -f "$hnsw_store" ]]; then
      emit_body "{\"error\":\"Router not found: $rid\"}"
      exit 1
    fi
    count_file="$store_dir/.count-$rid"
    cnt=$(cat "$count_file" 2>/dev/null || echo 0)
    if [[ "$cnt" -gt 0 ]]; then
      emit_body "{\"results\":[{\"name\":\"alpha\",\"score\":0.99}],\"patternCount\":$cnt}"
    else
      emit_body "{\"results\":[],\"patternCount\":0}"
    fi
    ;;
  ruvllm_sona_create)
    sid="sona-stub-$(date +%s%N | tr -d '\n' | head -c 14)"
    cat > "$sona_store" <<EOF
{"version":"1","instances":{"$sid":{"id":"$sid","createdAt":"2026-04-17","config":{"hiddenDim":16,"learningRate":0.1},"journal":[]}}}
EOF
    emit_body "{\"success\":true,\"sonaId\":\"$sid\",\"persisted\":true}"
    ;;
  ruvllm_sona_adapt)
    sid=$(node -e "try{const j=JSON.parse(process.argv[1]);process.stdout.write(j.sonaId||'')}catch{}" -- "$params")
    if [[ -z "$sid" || ! -f "$sona_store" ]]; then
      emit_body "{\"error\":\"SONA not found: $sid\"}"
      exit 1
    fi
    emit_body "{\"success\":true,\"stats\":\"{\\\"adaptations\\\":1}\",\"statsChanged\":true}"
    ;;
  ruvllm_microlora_create)
    lid="lora-stub-$(date +%s%N | tr -d '\n' | head -c 14)"
    cat > "$lora_store" <<EOF
{"version":"1","instances":{"$lid":{"id":"$lid","createdAt":"2026-04-17","config":{"inputDim":8,"outputDim":4,"rank":2},"journal":[]}}}
EOF
    emit_body "{\"success\":true,\"loraId\":\"$lid\",\"persisted\":true}"
    ;;
  ruvllm_microlora_adapt)
    lid=$(node -e "try{const j=JSON.parse(process.argv[1]);process.stdout.write(j.loraId||'')}catch{}" -- "$params")
    if [[ -z "$lid" || ! -f "$lora_store" ]]; then
      emit_body "{\"error\":\"MicroLoRA not found: $lid\"}"
      exit 1
    fi
    emit_body "{\"success\":true,\"stats\":\"{\\\"adaptations\\\":1}\",\"statsChanged\":true}"
    ;;
  *)
    emit_body "{\"error\":\"unknown tool in stub: $tool\"}"
    exit 1
    ;;
esac
exit 0
`;
  writeFileSync(shim, script, { mode: 0o755 });
  return shim;
}

function runLifecycle(checkName) {
  const tempDir = mkdtempSync(join(tmpdir(), 'ruvllm-check-'));
  try {
    const stubDir = join(tempDir, 'stubs');
    mkdirSync(stubDir, { recursive: true });
    const cliStub = writeRuvllmStub(stubDir);
    const e2eDir = join(tempDir, 'e2e');
    mkdirSync(join(e2eDir, '.claude-flow'), { recursive: true });

    const driverPath = join(tempDir, 'driver.sh');
    const driver = [
      '#!/usr/bin/env bash',
      'set +e',
      'set +u',
      `export PATH="${stubDir}:$PATH"`,
      `export E2E_DIR="${e2eDir}"`,
      'export REGISTRY="http://test-registry.invalid"',
      'export TEMP_DIR="/tmp"',
      'export PKG="stub"',
      // Standard harness stubs
      '_ns() { echo 0; }',
      '_elapsed_ms() { echo 0; }',
      'log() { :; }',
      `_cli_cmd() { echo "${cliStub}"; }`,
      '_run_and_kill() {',
      '  local cmd="$1" out="${2:-}" maxw="${3:-5}"',
      '  if [[ -n "$out" ]]; then eval "$cmd" > "$out" 2>&1; else eval "$cmd" > /dev/null 2>&1; fi',
      '  _RK_EXIT=$?',
      '  _RK_OUT=$(cat "$out" 2>/dev/null || echo "")',
      '}',
      '_run_and_kill_ro() { _run_and_kill "$@"; }',
      // Stub _e2e_isolate to produce a fresh subdir under E2E_DIR
      '_e2e_isolate() {',
      '  local cid="$1"',
      '  local iso="$E2E_DIR/.iso-$cid-$$"',
      '  mkdir -p "$iso"',
      '  cp -r "$E2E_DIR/.claude-flow" "$iso/" 2>/dev/null || true',
      '  echo "$iso"',
      '}',
      // Source harness + ruvllm checks
      `source "${HARNESS_FILE}"`,
      `source "${RUVLLM_FILE}"`,
      // Run the requested check
      `${checkName}`,
      'echo "::PASSED::${_CHECK_PASSED:-<unset>}"',
      'echo "::OUTPUT_START::"',
      'echo "${_CHECK_OUTPUT:-}"',
      'echo "::OUTPUT_END::"',
    ].join('\n');
    writeFileSync(driverPath, driver, { mode: 0o755 });

    const result = spawnSync('bash', [driverPath], { encoding: 'utf8', timeout: 30000 });
    const out = (result.stdout || '') + (result.stderr || '');
    const passed = (out.match(/::PASSED::(.*)/) || [])[1]?.trim() || '<unparsed>';
    const checkOutput = (out.match(/::OUTPUT_START::\n([\s\S]*?)\n::OUTPUT_END::/) || [])[1] || '';
    return { passed, output: checkOutput, raw: out, tempDir, e2eDir };
  } finally {
    try { rmSync(tempDir, { recursive: true, force: true }); } catch {}
  }
}

describe('W2-I2 — ruvllm hnsw lifecycle (stubbed CLI)', () => {
  it('check_adr0094_p5_ruvllm_hnsw_create runs full create->add->route and passes', () => {
    const r = runLifecycle('check_adr0094_p5_ruvllm_hnsw_create');
    assert.equal(r.passed, 'true',
      `expected passed=true. output=${r.output}\nraw=${r.raw.slice(-600)}`);
    assert.match(r.output, /create.*add.*route|succeeded with persistence/i);
  });

  it('check_adr0094_p5_ruvllm_hnsw_add validates the same lifecycle', () => {
    const r = runLifecycle('check_adr0094_p5_ruvllm_hnsw_add');
    assert.equal(r.passed, 'true',
      `expected passed=true. output=${r.output}\nraw=${r.raw.slice(-600)}`);
  });

  it('check_adr0094_p5_ruvllm_hnsw_route validates the same lifecycle', () => {
    const r = runLifecycle('check_adr0094_p5_ruvllm_hnsw_route');
    assert.equal(r.passed, 'true',
      `expected passed=true. output=${r.output}\nraw=${r.raw.slice(-600)}`);
  });
});

describe('W2-I2 — ruvllm sona lifecycle (stubbed CLI)', () => {
  it('check_adr0094_p5_ruvllm_sona_create passes end-to-end', () => {
    const r = runLifecycle('check_adr0094_p5_ruvllm_sona_create');
    assert.equal(r.passed, 'true',
      `expected passed=true. output=${r.output}\nraw=${r.raw.slice(-600)}`);
  });

  it('check_adr0094_p5_ruvllm_sona_adapt passes end-to-end', () => {
    const r = runLifecycle('check_adr0094_p5_ruvllm_sona_adapt');
    assert.equal(r.passed, 'true',
      `expected passed=true. output=${r.output}\nraw=${r.raw.slice(-600)}`);
  });
});

describe('W2-I2 — ruvllm microlora lifecycle (stubbed CLI)', () => {
  it('check_adr0094_p5_ruvllm_microlora_create passes end-to-end', () => {
    const r = runLifecycle('check_adr0094_p5_ruvllm_microlora_create');
    assert.equal(r.passed, 'true',
      `expected passed=true. output=${r.output}\nraw=${r.raw.slice(-600)}`);
  });

  it('check_adr0094_p5_ruvllm_microlora_adapt passes end-to-end', () => {
    const r = runLifecycle('check_adr0094_p5_ruvllm_microlora_adapt');
    assert.equal(r.passed, 'true',
      `expected passed=true. output=${r.output}\nraw=${r.raw.slice(-600)}`);
  });
});
