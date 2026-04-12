# ADR-0081: M5 Max Configuration Profile

- **Status**: Implemented
- **Date**: 2026-04-12
- **Deciders**: Henrik Pettersen
- **Methodology**: Hive deliberation (Queen + 4 experts + Devil's Advocate)
- **Depends on**: ADR-0080 (Storage Consolidation)

## Context

A 5-agent hive council analysed the SONA learning system and all storage/embedding
settings to determine optimal values for the development machine:

**Machine**: M5 Max MacBook Pro, 36GB unified RAM, macOS Tahoe
**Use case**: Single-user CLI tool, daily developer workflow, code analysis + memory ops

## M5 Max AI Hardware Capabilities

The Apple M5 Max introduces architecture changes relevant to SONA/ONNX workloads:

- **GPU Neural Accelerators**: Dedicated neural accelerators built into each GPU core.
  AI tasks can run directly on GPU hardware instead of routing through the Neural Engine.
  Up to **4x faster AI performance** vs M4, with **4x speedup on time-to-first-token**
  for language models.
- **16-Core Neural Engine**: Optimized for faster, more energy-efficient inference.
- **Distributed processing**: CPU, GPU, and Neural Accelerators process AI workloads
  simultaneously — different silicon blocks handle whatever workload type they're best
  suited for.
- **153 GB/s memory bandwidth** (30% more than M4): Unified memory lets the entire chip
  share one pool. Critical for large embedding models and HNSW indices that benefit from
  fast random access across vector data.
- **Core ML / Metal 4**: Apps using Core ML and Metal Performance Shaders automatically
  benefit. ONNX Runtime on macOS uses the CoreML execution provider, which routes to the
  GPU (not the Neural Engine directly — ONNX models are not compiled for ANE format).

**Implication for SONA**: When `@claude-flow/neural` is enabled, the M5 Max can handle
`research` mode (LoRA rank 16, 100MB budget, 100ms latency) with negligible resource
impact. The 36GB unified memory and 153 GB/s bandwidth make even the most demanding
mode trivial. The GPU Neural Accelerators would accelerate ONNX embedding inference
if routed through Metal, though the current `@xenova/transformers` pipeline uses the
CoreML WASM path.

## Critical Finding: Neural System Is Dead Code

`@claude-flow/neural` is not installed as a dependency of `@claude-flow/memory`.
The `LearningBridge` attempts `import('@claude-flow/neural')` with a silent catch —
`this.neural` is always `null`. All SONA mode, LoRA, EWC, and trajectory learning
paths are gated on `if (this.neural)` and never execute.

Only two functions actually run (no neural gate):
- `decayConfidences()` — reduces pattern confidence over time (SQLite metadata)
- `onInsightAccessed()` — boosts confidence on access (SQLite metadata)

## Decision

### Part A: Values That Matter Now (confidence lifecycle)

These run today via plain SQLite operations, regardless of neural system status.

| Setting | Value | Rationale |
|---------|-------|-----------|
| `confidenceDecayRate` | **0.0008** /hour | ~36 day half-life. Patterns from last month stay usable (>0.5). Patterns from 3+ months fade near floor (0.17) but aren't lost. Matches daily developer workflow with occasional multi-week gaps. |
| `accessBoostAmount` | **0.05** | +5% per access. 18-20 accesses to reach max from min. Rewards genuine repetition without inflating one-off patterns. A daily-used pattern reaches max confidence in ~3 weeks. |
| `maxConfidence` | **1.0** | Standard ceiling. |
| `minConfidence` | **0.1** | Patterns never fully forgotten. Search threshold (0.7) filters dormant patterns from active recall. Enables re-boosting when revisiting old projects. |

All four values are aligned across:
- `learning-bridge.ts` DEFAULT_CONFIG
- `config-template.ts` (init --full output)
- `settings-generator.ts` (settings.json output)

### Part B: Values For When Neural Is Enabled (future)

When `@claude-flow/neural` is added as a dependency, these values should be applied
for the M5 Max:

| Setting | Default | M5 Max Optimal | Rationale |
|---------|---------|---------------|-----------|
| `sonaMode` | `balanced` | **`research`** | 100MB memory budget is 0.27% of 36GB RAM. LoRA rank 16 gives 4x adapter capacity vs rank 4. 100ms latency invisible for CLI (shell rendering takes 10-30ms). Quality threshold 0.2 lets emerging patterns accumulate evidence. |
| `ewcLambda` | 2000 | **2000** | Conservative — prevents catastrophic forgetting. System learns new patterns through confidence/boost; EWC protects consolidated weights. |
| `consolidationThreshold` | 8 | **6** | Fire once per active session (4-8 trajectories typical) rather than deferring to next session. |

### Part C: SONA Mode Reference (all 5 modes)

| Mode | LoRA | LR | Batch | Trajectories | Quality | Latency | Memory | Best For |
|------|------|----|-------|-------------|---------|---------|--------|----------|
| `real-time` | 2 | 0.001 | 32 | 1,000 | 0.7 | 0.5ms | 25MB | Hot-path middleware, autocomplete — NOT for learning pipeline (quality 0.7 drops emerging patterns) |
| `balanced` | 4 | 0.002 | 32 | 3,000 | 0.5 | 18ms | 50MB | Default for most machines. Good balance. |
| `research` | 16 | 0.002 | 64 | 10,000 | 0.2 | 100ms | 100MB | Developer workstations with >8GB RAM. Best pattern retention. Recommended for M5 Max. |
| `edge` | 1 | 0.001 | 16 | 200 | 0.8 | 1ms | 5MB | Raspberry Pi, CI containers, 64MB memory cap. Irrelevant for M5 Max. |
| `batch` | 8 | 0.002 | 128 | 5,000 | 0.4 | 50ms | 75MB | Offline bulk processing: codebase import, git history replay, scheduled maintenance. Not interactive. |

### Part D: `adaptive` Is Invalid

The `SONAMode` type union defines: `real-time`, `balanced`, `research`, `edge`, `batch`.
`adaptive` is **not a valid mode** — it was aspirational and never implemented.
All references to `sonaMode: 'adaptive'` were corrected to `'balanced'` in ADR-0080.

## Hive Council Positions

### Modes Expert
`balanced` is the correct default for general use. 18ms latency imperceptible. Quality
threshold 0.5 lets patterns emerge. `research` for explicit deep analysis only.
`real-time` quality 0.7 actively harms learning by dropping weak emerging patterns.

### Hardware Expert
`research` mode recommended for M5 Max. 100MB is negligible. LoRA rank 16 gives
materially better pattern retention. Latency irrelevant for CLI. ONNX uses CoreML
GPU Neural Accelerators on M5 (4x faster than M4). The 153 GB/s memory
bandwidth makes 768-dim vector operations trivial.

### Decay Expert
Current confidence values (0.0008 decay, 0.05 boost) are well-tuned. 36-day half-life
matches daily use. Only marginal change: `consolidationThreshold` 8 -> 6. All other
values correct.

### Devil's Advocate
The neural system (`@claude-flow/neural`) is not installed. `this.neural` is always
`null`. LoRA, EWC, SONA modes are all dead branches. Only `confidenceDecayRate` and
`accessBoostAmount` matter today. Optimising mode selection is tuning a system that
is provably not running.

### Queen's Synthesis
Devil wins on current state. Confidence values are correct and aligned. Mode selection
is deferred until neural is enabled. When it is, use `research` on M5 Max.

## Prerequisites For Enabling Neural

1. Add `@claude-flow/neural` as `optionalDependency` in `@claude-flow/memory/package.json`
2. Change `sonaMode` default from `'balanced'` to `'research'` in this machine's config
3. Set `consolidationThreshold` to 6
4. Verify the neural system initialises without errors
5. Run a pattern learning test: store 50+ entries, consolidate, verify patterns learned

## Consequences

- Part A values are live and confirmed working via SQLite
- Part B values are documented for future activation
- No code changes needed — this ADR records the analysis and decision
- The M5 Max has sufficient resources for any SONA mode including `research`
- `adaptive` mode is permanently ruled out (invalid, never implemented)
