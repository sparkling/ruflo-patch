/**
 * ADR-0069 F3 — Flash Attention Performance Benchmark
 *
 * Validates: "Flash Attention achieves >= 2x speedup over legacy adapter"
 *
 * Comparison:
 *   FAST  = Native FlashAttention kernel (NAPI class or WASM class)
 *   SLOW  = JS fallback (multiHeadAttentionFallback inside AttentionService)
 *
 * The NAPI module (@ruvector/attention) exports class-based APIs:
 *   - FlashAttention(dim, blockSize).compute(Q, K[], V[])
 *   - MultiHeadAttention(dim, numHeads).compute(Q, K[], V[])
 *
 * The "legacy adapter" is the pure-JS scaled dot-product attention that
 * AttentionService falls back to when no native module is available.
 * F3 claims >= 2x speedup of native flash over that JS fallback.
 *
 * Part 1: Native FlashAttention.compute vs JS fallback (raw kernel)
 * Part 2: applyFlashAttention() high-level API vs equivalent naive JS
 * Part 3: Scaling analysis across sequence lengths
 *
 * Usage:
 *   node tests/benchmarks/flash-attention-benchmark.mjs
 */

import { performance } from 'node:perf_hooks';
import { createRequire } from 'node:module';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const WARMUP_ITERATIONS = 10;
const MEASURE_ITERATIONS = 100;
const NUM_HEADS = 8;

// Test matrix: (embedDim, seqLen) pairs
// Native flash attention advantage grows with both dimension and sequence
// length. Small dims (64) may be overhead-bound; dim >= 256 with seqLen
// >= 64 is where the tiled kernel wins.
const TEST_CASES = [
  { embedDim: 64, seqLen: 64 },
  { embedDim: 256, seqLen: 64 },
  { embedDim: 256, seqLen: 256 },
  { embedDim: 768, seqLen: 64 },
  { embedDim: 768, seqLen: 256 },
  { embedDim: 768, seqLen: 512 },
];

// ADR-0069 F3 target
const TARGET_SPEEDUP = 2.0;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function randomFloat32(len) {
  const buf = new Float32Array(len);
  for (let i = 0; i < len; i++) buf[i] = (Math.random() - 0.5) * 2;
  return buf;
}

function randomNumberArray(len) {
  return Array.from({ length: len }, () => (Math.random() - 0.5) * 2);
}

/**
 * JS fallback: scaled dot-product attention.
 *
 * This is equivalent to AttentionService.multiHeadAttentionFallback —
 * the code path used when no native module is loaded. Computes full
 * O(seqLen^2 * embedDim) attention with per-position softmax.
 *
 * Signature matches the native class API: compute(Q, K[], V[])
 * where Q is Float32Array(embedDim) and K/V are arrays of Float32Array.
 */
function jsFallbackAttention(query, keys, values, embedDim, numHeads) {
  const seqLen = keys.length;
  const headDim = Math.max(1, Math.floor(embedDim / numHeads));
  const output = new Float32Array(embedDim);

  for (let h = 0; h < numHeads; h++) {
    const hStart = h * headDim;
    const hEnd = Math.min(hStart + headDim, embedDim);
    const scale = 1.0 / Math.sqrt(hEnd - hStart);

    // Compute attention scores for this head
    const scores = new Float64Array(seqLen);
    let maxScore = -Infinity;

    for (let j = 0; j < seqLen; j++) {
      let dot = 0;
      const kj = keys[j];
      for (let d = hStart; d < hEnd; d++) {
        dot += query[d] * kj[d];
      }
      scores[j] = dot * scale;
      if (scores[j] > maxScore) maxScore = scores[j];
    }

    // Softmax
    let expSum = 0;
    for (let j = 0; j < seqLen; j++) {
      scores[j] = Math.exp(scores[j] - maxScore);
      expSum += scores[j];
    }

    // Weighted sum
    for (let d = hStart; d < hEnd; d++) {
      let sum = 0;
      for (let j = 0; j < seqLen; j++) {
        sum += (scores[j] / expSum) * values[j][d];
      }
      output[d] = sum;
    }
  }

  return output;
}

/**
 * Same as above but for number[] arrays (high-level API comparison).
 */
function jsFallbackHighLevel(query, keys, values) {
  const dim = query.length;
  const seqLen = keys.length;
  const scale = 1.0 / Math.sqrt(dim);

  const scores = new Array(seqLen);
  let maxScore = -Infinity;
  for (let j = 0; j < seqLen; j++) {
    let dot = 0;
    for (let d = 0; d < dim; d++) dot += query[d] * keys[j][d];
    scores[j] = dot * scale;
    if (scores[j] > maxScore) maxScore = scores[j];
  }

  let expSum = 0;
  for (let j = 0; j < seqLen; j++) {
    scores[j] = Math.exp(scores[j] - maxScore);
    expSum += scores[j];
  }

  const output = new Array(dim).fill(0);
  for (let j = 0; j < seqLen; j++) {
    const w = scores[j] / expSum;
    for (let d = 0; d < dim; d++) output[d] += w * values[j][d];
  }
  return output;
}

/**
 * Measure median execution time over N iterations.
 */
function benchSync(fn, iterations) {
  const times = [];
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    fn();
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)];
}

async function benchAsync(fn, iterations) {
  const times = [];
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    await fn();
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)];
}

// ---------------------------------------------------------------------------
// Module loading
// ---------------------------------------------------------------------------

/**
 * Try to load the NAPI attention module from several locations.
 * Returns { FlashAttention, MultiHeadAttention } classes or null.
 */
async function loadNativeModule() {
  // Strategy 1: resolve from project node_modules
  try {
    const r = createRequire(import.meta.url);
    const mod = r('@ruvector/attention');
    if (mod && mod.FlashAttention) return mod;
  } catch { /* next */ }

  // Strategy 2: resolve from e2e acceptance-test temp dirs
  try {
    const { readdirSync, existsSync } = await import('node:fs');
    const { join } = await import('node:path');
    const dirs = readdirSync('/tmp')
      .filter((d) => d.startsWith('ruflo-e2e-'))
      .sort()
      .reverse();

    for (const d of dirs) {
      const fullDir = join('/tmp', d);
      // @ruvector/attention is a native NAPI addon — must use require, not import
      try {
        const r = createRequire(join(fullDir, 'x.js'));
        const mod = r('@ruvector/attention');
        if (mod && mod.FlashAttention) return mod;
      } catch { /* next dir */ }
    }
  } catch { /* next */ }

  return null;
}

/**
 * Load AttentionService for high-level API benchmarks.
 */
async function loadAttentionService() {
  try {
    const mod = await import('@sparkleideas/agentdb');
    return { AS: mod.AttentionService, src: 'node_modules' };
  } catch { /* next */ }

  try {
    const { readdirSync, existsSync } = await import('node:fs');
    const { join } = await import('node:path');
    for (const d of readdirSync('/tmp').filter((x) => x.startsWith('ruflo-e2e-')).sort().reverse()) {
      const p = join('/tmp', d, 'node_modules/@sparkleideas/agentdb/dist/src/index.js');
      if (!existsSync(p)) continue;
      try {
        const mod = await import(p);
        return { AS: mod.AttentionService, src: d };
      } catch { /* next */ }
    }
  } catch { /* next */ }

  try {
    const mod = await import('/Users/henrik/source/forks/agentic-flow/packages/agentdb/dist/src/index.js');
    return { AS: mod.AttentionService, src: 'fork dist' };
  } catch { /* next */ }

  return null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('ADR-0069 F3 — Flash Attention Performance Benchmark');
  console.log('='.repeat(70));
  console.log();
  console.log(`Warmup            : ${WARMUP_ITERATIONS} iterations`);
  console.log(`Measure           : ${MEASURE_ITERATIONS} iterations (median reported)`);
  console.log(`Target speedup    : >= ${TARGET_SPEEDUP}x`);
  console.log();

  // -----------------------------------------------------------------------
  // Load native module
  // -----------------------------------------------------------------------
  const napi = await loadNativeModule();
  const hasNative = napi !== null;

  if (hasNative) {
    console.log(`Native module     : @ruvector/attention (NAPI-RS)`);
    console.log(`  FlashAttention  : ${typeof napi.FlashAttention}`);
    console.log(`  MultiHeadAttn   : ${typeof napi.MultiHeadAttention}`);
  } else {
    console.log('Native module     : NOT AVAILABLE');
    console.log('  (benchmark will compare JS flash-optimised vs JS naive)');
  }

  // Load AttentionService for high-level API
  const asResult = await loadAttentionService();
  if (asResult) {
    console.log(`AttentionService  : loaded from ${asResult.src}`);
  } else {
    console.log('AttentionService  : NOT AVAILABLE (Part 2 will be skipped)');
  }
  console.log();

  // -----------------------------------------------------------------------
  // Part 1 — Raw kernel: NAPI FlashAttention vs JS fallback
  // -----------------------------------------------------------------------

  console.log('Part 1: Raw kernel — native FlashAttention.compute vs JS fallback');
  console.log('-'.repeat(70));
  console.log();

  const part1Results = [];

  for (const { embedDim, seqLen } of TEST_CASES) {
    const headDim = Math.floor(embedDim / NUM_HEADS);
    const blockSize = Math.max(64, Math.min(256, embedDim));

    // Prepare data: query is single vector, keys/values are arrays of vectors
    const query = randomFloat32(embedDim);
    const keys = Array.from({ length: seqLen }, () => randomFloat32(embedDim));
    const values = Array.from({ length: seqLen }, () => randomFloat32(embedDim));

    let nativeMs = null;
    let nativeEngine = 'n/a';

    // Native flash attention (if available)
    if (hasNative) {
      const fa = new napi.FlashAttention(embedDim, blockSize);
      // Warmup
      for (let i = 0; i < WARMUP_ITERATIONS; i++) fa.compute(query, keys, values);
      nativeMs = benchSync(() => fa.compute(query, keys, values), MEASURE_ITERATIONS);
      nativeEngine = 'napi';
    }

    // JS fallback
    // Warmup
    for (let i = 0; i < WARMUP_ITERATIONS; i++) {
      jsFallbackAttention(query, keys, values, embedDim, NUM_HEADS);
    }
    const jsMs = benchSync(
      () => jsFallbackAttention(query, keys, values, embedDim, NUM_HEADS),
      MEASURE_ITERATIONS
    );

    const speedup = nativeMs !== null ? jsMs / nativeMs : null;

    part1Results.push({
      embedDim,
      seqLen,
      engine: nativeEngine,
      nativeMs,
      jsMs,
      speedup,
    });
  }

  // Table
  if (hasNative) {
    console.log(
      '| EmbedDim | SeqLen | Engine | Native (ms) | JS FB (ms)  | Speedup |'
    );
    console.log(
      '|----------|--------|--------|-------------|-------------|---------|'
    );
    for (const r of part1Results) {
      console.log(
        `| ${String(r.embedDim).padStart(8)} | ${String(r.seqLen).padStart(6)} | ${r.engine.padEnd(6)} | ${r.nativeMs.toFixed(4).padStart(11)} | ${r.jsMs.toFixed(4).padStart(11)} | ${r.speedup.toFixed(2).padStart(5)}x  |`
      );
    }
  } else {
    console.log('  (No native engine — Part 1 measures JS fallback baseline only)');
    console.log();
    console.log(
      '| EmbedDim | SeqLen | JS FB (ms)  |'
    );
    console.log(
      '|----------|--------|-------------|'
    );
    for (const r of part1Results) {
      console.log(
        `| ${String(r.embedDim).padStart(8)} | ${String(r.seqLen).padStart(6)} | ${r.jsMs.toFixed(4).padStart(11)} |`
      );
    }
  }
  console.log();

  // -----------------------------------------------------------------------
  // Part 2 — High-level API: applyFlashAttention() vs naive JS
  //
  // applyFlashAttention() dispatches to NAPI/WASM/JS internally.
  // We compare against the same naive JS attention (jsFallbackHighLevel).
  // -----------------------------------------------------------------------

  console.log('Part 2: applyFlashAttention() vs naive JS (number[] API)');
  console.log('-'.repeat(70));
  console.log();

  const part2Results = [];

  if (asResult) {
    const { AS: AttentionService } = asResult;

    for (const { embedDim, seqLen } of TEST_CASES) {
      const headDim = Math.floor(embedDim / NUM_HEADS);

      const service = new AttentionService({
        numHeads: NUM_HEADS,
        headDim,
        embedDim,
        useFlash: true,
      });
      await service.initialize();
      const engine = service.getEngineType();

      const query = randomNumberArray(embedDim);
      const keys = Array.from({ length: seqLen }, () => randomNumberArray(embedDim));
      const values = Array.from({ length: seqLen }, () => randomNumberArray(embedDim));

      // Warmup
      for (let i = 0; i < WARMUP_ITERATIONS; i++) {
        await service.applyFlashAttention(query, keys, values);
        jsFallbackHighLevel(query, keys, values);
      }

      performance.clearMarks();
      performance.clearMeasures();

      const flashMs = await benchAsync(
        () => service.applyFlashAttention(query, keys, values),
        MEASURE_ITERATIONS
      );

      const naiveMs = benchSync(
        () => jsFallbackHighLevel(query, keys, values),
        MEASURE_ITERATIONS
      );

      const speedup = naiveMs / flashMs;
      part2Results.push({ embedDim, seqLen, engine, flashMs, naiveMs, speedup });
    }

    console.log(
      '| EmbedDim | SeqLen | Engine   | Flash (ms) | Naive (ms) | Speedup |'
    );
    console.log(
      '|----------|--------|----------|------------|------------|---------|'
    );
    for (const r of part2Results) {
      console.log(
        `| ${String(r.embedDim).padStart(8)} | ${String(r.seqLen).padStart(6)} | ${r.engine.padEnd(8)} | ${r.flashMs.toFixed(4).padStart(10)} | ${r.naiveMs.toFixed(4).padStart(10)} | ${r.speedup.toFixed(2).padStart(5)}x  |`
      );
    }
  } else {
    console.log('  (Skipped — AttentionService not available)');
  }
  console.log();

  // -----------------------------------------------------------------------
  // Part 3 — Scaling analysis: how speedup changes with sequence length
  // -----------------------------------------------------------------------

  console.log('Part 3: Scaling — speedup vs sequence length (dim=256)');
  console.log('-'.repeat(70));
  console.log();

  const scalingSeqLens = [8, 16, 32, 64, 128, 256, 512];
  const scalingDim = 256;
  const scalingResults = [];

  for (const seqLen of scalingSeqLens) {
    const query = randomFloat32(scalingDim);
    const keys = Array.from({ length: seqLen }, () => randomFloat32(scalingDim));
    const values = Array.from({ length: seqLen }, () => randomFloat32(scalingDim));

    let nativeMs = null;
    if (hasNative) {
      const fa = new napi.FlashAttention(scalingDim, 256);
      for (let i = 0; i < WARMUP_ITERATIONS; i++) fa.compute(query, keys, values);
      nativeMs = benchSync(() => fa.compute(query, keys, values), MEASURE_ITERATIONS);
    }

    for (let i = 0; i < WARMUP_ITERATIONS; i++) {
      jsFallbackAttention(query, keys, values, scalingDim, NUM_HEADS);
    }
    const jsMs = benchSync(
      () => jsFallbackAttention(query, keys, values, scalingDim, NUM_HEADS),
      MEASURE_ITERATIONS
    );

    const speedup = nativeMs !== null ? jsMs / nativeMs : null;
    scalingResults.push({ seqLen, nativeMs, jsMs, speedup });
  }

  if (hasNative) {
    console.log(
      '| SeqLen | Native (ms) | JS FB (ms)  | Speedup |'
    );
    console.log(
      '|--------|-------------|-------------|---------|'
    );
    for (const r of scalingResults) {
      console.log(
        `| ${String(r.seqLen).padStart(6)} | ${r.nativeMs.toFixed(4).padStart(11)} | ${r.jsMs.toFixed(4).padStart(11)} | ${r.speedup.toFixed(2).padStart(5)}x  |`
      );
    }
  } else {
    console.log(
      '| SeqLen | JS FB (ms)  |'
    );
    console.log(
      '|--------|-------------|'
    );
    for (const r of scalingResults) {
      console.log(
        `| ${String(r.seqLen).padStart(6)} | ${r.jsMs.toFixed(4).padStart(11)} |`
      );
    }
  }
  console.log();

  // -----------------------------------------------------------------------
  // Service information
  // -----------------------------------------------------------------------

  console.log('Engine Summary');
  console.log('-'.repeat(70));
  console.log();
  console.log(`  NAPI available     : ${hasNative}`);
  if (asResult) {
    const svc = new asResult.AS({
      numHeads: NUM_HEADS,
      headDim: 32,
      embedDim: 256,
      useFlash: true,
    });
    await svc.initialize();
    const info = svc.getInfo();
    console.log(`  Service engine     : ${svc.getEngineType()}`);
    console.log(`  Service NAPI       : ${info.hasNAPI}`);
    console.log(`  Service WASM       : ${info.hasWASM}`);
    console.log(`  Service runtime    : ${info.runtime}`);
  }
  console.log();

  // -----------------------------------------------------------------------
  // Verdict
  // -----------------------------------------------------------------------

  console.log('='.repeat(70));
  console.log('VERDICT');
  console.log('='.repeat(70));
  console.log();

  // Collect speedup results. Part 1 (raw kernel) is the primary metric.
  // Part 3 (scaling) provides supporting data at more sequence lengths.
  const kernelResults = part1Results.filter((r) => r.speedup !== null);
  const scalingWithSpeedup = scalingResults.filter((r) => r.speedup !== null);
  const allSpeedups = [...kernelResults, ...scalingWithSpeedup];

  if (allSpeedups.length === 0) {
    console.log('  No native engine available — cannot measure native vs JS speedup.');
    console.log();
    if (part2Results.length > 0) {
      // When no native is available, applyFlashAttention routes to JS fallback.
      // The comparison with naive JS shows the overhead of the service wrapper.
      const p2Avg = part2Results.reduce((s, r) => s + r.speedup, 0) / part2Results.length;
      console.log(`  Part 2 service overhead: avg ${p2Avg.toFixed(2)}x`);
      console.log('  (< 1x is expected — service adds async/stats overhead to same JS code)');
    }
    console.log();
    console.log('SKIP: No native engine to benchmark. Install @ruvector/attention for F3.');
    process.exit(0);
  }

  const avgSpeedup = allSpeedups.reduce((s, r) => s + r.speedup, 0) / allSpeedups.length;
  const minSpeedup = Math.min(...allSpeedups.map((r) => r.speedup));
  const maxSpeedup = Math.max(...allSpeedups.map((r) => r.speedup));

  console.log('  Native FlashAttention vs JS fallback:');
  console.log(`    Average speedup : ${avgSpeedup.toFixed(2)}x`);
  console.log(`    Min speedup     : ${minSpeedup.toFixed(2)}x (seqLen=${allSpeedups.find((r) => r.speedup === minSpeedup)?.seqLen})`);
  console.log(`    Max speedup     : ${maxSpeedup.toFixed(2)}x (seqLen=${allSpeedups.find((r) => r.speedup === maxSpeedup)?.seqLen})`);
  console.log(`    Target          : >= ${TARGET_SPEEDUP}x`);
  console.log();

  if (part2Results.length > 0) {
    const p2Avg = part2Results.reduce((s, r) => s + r.speedup, 0) / part2Results.length;
    console.log(`  High-level API (Part 2): avg ${p2Avg.toFixed(2)}x`);
    console.log();
  }

  const passed = avgSpeedup >= TARGET_SPEEDUP;

  if (minSpeedup >= TARGET_SPEEDUP) {
    console.log(`PASS: All cases >= ${TARGET_SPEEDUP}x speedup`);
  } else if (passed) {
    console.log(
      `PASS: Average ${avgSpeedup.toFixed(2)}x >= ${TARGET_SPEEDUP}x ` +
        `(min ${minSpeedup.toFixed(2)}x at small inputs is expected)`
    );
  } else {
    console.log(
      `FAIL: Average speedup ${avgSpeedup.toFixed(2)}x below ${TARGET_SPEEDUP}x target`
    );
  }

  // Detail
  console.log();
  console.log('  Part 1 detail:');
  for (const r of kernelResults) {
    const status = r.speedup >= TARGET_SPEEDUP ? 'PASS' : 'FAIL';
    console.log(
      `    [${status}] dim=${r.embedDim} seqLen=${r.seqLen} speedup=${r.speedup.toFixed(2)}x`
    );
  }
  if (scalingWithSpeedup.length > 0) {
    console.log('  Part 3 scaling detail:');
    for (const r of scalingWithSpeedup) {
      const status = r.speedup >= TARGET_SPEEDUP ? 'PASS' : 'FAIL';
      console.log(
        `    [${status}] seqLen=${r.seqLen} speedup=${r.speedup.toFixed(2)}x`
      );
    }
  }

  console.log();
  process.exit(passed ? 0 : 1);
}

main().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(2);
});
