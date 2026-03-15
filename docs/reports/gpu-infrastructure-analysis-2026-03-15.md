# GPU Infrastructure Analysis Report

**Date**: 2026-03-15
**Package**: `@sparkleideas/cli@3.5.15-patch.25`
**Server**: AMD Ryzen 9 7950X3D, 187 GB RAM, 3.5 TB NVMe, No discrete GPU
**Related**: ADR-0030 (Memory System Optimization & GPU Readiness)

---

## Executive Summary

Research across all upstream forks (`ruflo`, `agentic-flow`, `ruv-FANN`, `ruvector`) revealed **20,000+ lines of real GPU code** spanning WebGPU, CUDA, OpenCL, and Vulkan backends. This code is currently dormant — no discrete GPU is installed and most GPU features are behind compile-time feature flags. The infrastructure is production-quality (real shaders, real training loops, real memory management) but not yet connected to the main `@sparkleideas/cli` pipeline.

---

## 1. ruv-FANN: Full WebGPU Neural Training (15,541 LOC)

### 1.1 WebGPU Compute Backend

| File | LOC | Description |
|------|-----|-------------|
| `src/webgpu/backend.rs` | 734 | Main WebGPU runtime with `ComputeBackend<T>` trait |
| `src/webgpu/autonomous_gpu_resource_manager.rs` | 3,839 | GPU memory management, buffer allocation |
| `src/webgpu/wasm_gpu_bridge.rs` | 1,441 | Bridge between WASM and WebGPU |
| `src/webgpu/pressure_monitor.rs` | 1,113 | GPU resource monitoring and throttling |
| `src/webgpu/compute_context.rs` | 785 | Compute context management |

### 1.2 ComputeBackend Trait

```rust
pub trait ComputeBackend<T: Float>: Send + Sync {
    fn matrix_vector_multiply(...) -> Result<Vec<T>, ComputeError>
    fn batch_matrix_vector_multiply(...) -> Result<Vec<Vec<T>>, ComputeError>
    fn apply_activation_function(...) -> Result<Vec<T>, ComputeError>
    fn vector_operations(&self) -> &dyn VectorOps<T>
    fn memory_manager(&self) -> &dyn MemoryManager<T>
}

pub enum BackendType {
    WebGPU,   // Primary GPU backend
    Simd,     // SIMD acceleration
    Cpu,      // CPU fallback
}
```

### 1.3 GPU Training Pipelines

| Optimizer | File | Features |
|-----------|------|----------|
| `GpuAdam<T>` | `src/training/gpu_training.rs` | GPU momentum/variance buffers, performance stats |
| `GpuAdamW<T>` | `src/training/gpu_optimized_training.rs` | Weight decay on GPU |
| `GpuBatchBackprop<T>` | `src/training/gpu_batch_training.rs` | Batched backpropagation |
| `GpuBackprop<T>` | `src/training/gpu_backprop.rs` | GPU gradient computation |

### 1.4 WGSL Compute Shaders (9 files)

| Shader | Purpose |
|--------|---------|
| `batch_matrix_vector_multiply.wgsl` | Batched matrix ops, 32-thread workgroups, 4x unrolled |
| `activation_functions.wgsl` | GPU activation kernels (ReLU, Sigmoid, Tanh, GELU) |
| `adam_optimizer.wgsl` | Adam parameter updates on GPU |
| `matrix_ops.wgsl` | Core matrix algebra |
| `gradient_operations.wgsl` | Backprop gradient computation |

### 1.5 Cargo.toml Dependencies

```toml
wgpu = { version = "0.19", optional = true }
tokio = { version = "1.0", features = ["rt", "sync", "time"], optional = true }
async-trait = { version = "0.1", optional = true }
bytemuck = { version = "1.14", features = ["derive"], optional = true }
```

Feature flags: `gpu`, `webgpu`, `wasm-gpu`

### 1.6 Performance Stats Tracking

```rust
pub struct GpuPerformanceStats {
    total_gpu_time_ms: f64,
    memory_transfer_time_ms: f64,
    kernel_launches: u64,
    avg_batch_time_ms: f64,
    gpu_memory_used_bytes: u64,
    speedup_vs_cpu: f64,
}
```

---

## 2. CUDA-WASM Transpiler

### 2.1 Overview

CUDA-to-WebGPU/Rust transpiler that converts CUDA C++ kernels to WebAssembly/WebGPU for browser execution.

**Location**: `ruv-FANN/cuda-wasm/`

### 2.2 Backend Support

```toml
# cuda-wasm/Cargo.toml
cuda-sys = { version = "0.2", optional = true }     # Direct CUDA
opencl3 = { version = "0.9", optional = true }       # OpenCL
vulkano = { version = "0.34", optional = true }       # Vulkan
wgpu = { version = "0.19" }                           # WebGPU (default)
```

Build script links `libcublas` for NVIDIA CUDA:
```rust
// cuda-wasm/build.rs:142
println!("cargo:rustc-link-lib=cublas");
```

### 2.3 Native GPU Backend

```rust
pub struct WebGPUBackend {
    capabilities: BackendCapabilities {
        supports_webgpu: true,
        supports_cuda: false,    // Via transpilation, not native
        supports_opencl: false,
        supports_vulkan: false,
    },
    device: wgpu::Device,
    queue: wgpu::Queue,
    pipelines: HashMap<u64, wgpu::ComputePipeline>,
    buffers: HashMap<usize, (wgpu::Buffer, usize)>,
}
```

### 2.4 Status

- **WebGPU backend**: Implemented
- **CUDA parser**: Stub (returns hardcoded AST, per ADR-001)
- **Build targets**: `build:rust:native` (native GPU), `build:wasm:simd` (WASM SIMD)

---

## 3. RuVector: GPU-Accelerated Vector Operations

### 3.1 GPU Configuration

```rust
pub struct GpuConfig {
    mode: GpuMode,                      // Auto, WebGpu, CudaWasm, CpuOnly
    power_preference: PowerPreference,  // HighPerformance, LowPower, None
    max_memory: u64,                    // Bytes (0 = unlimited)
    workgroup_size: u32,                // 256 (WebGPU) or 512 (high-perf)
    async_compute: bool,
    min_batch_size: usize,              // GPU threshold
    min_dimension: usize,               // GPU threshold
    cache_shaders: bool,
    enable_profiling: bool,
    fallback_to_cpu: bool,              // Graceful degradation
    device_index: u32,                  // Multi-GPU support
}
```

**Presets**:
- `GpuConfig::auto()` — auto-detect best backend
- `GpuConfig::high_performance()` — workgroup 512, discrete GPU
- `GpuConfig::low_power()` — integrated GPU, async disabled
- `GpuConfig::cpu_only()` — disable GPU entirely
- `GpuConfig::webgpu()` — WebGPU-specific
- `GpuConfig::cuda_wasm()` — CUDA transpilation path

### 3.2 GPU Shaders (11 WGSL files)

| Shader | Operation | Documented Speedup |
|--------|-----------|-------------------|
| `cosine_similarity.wgsl` | Single/batch cosine similarity | 3.7x |
| `mean_pool.wgsl` | Mean pooling | 4.0x |
| `l2_normalize.wgsl` | L2 normalization | 3.8x |
| `top_k_similar.wgsl` | Top-K similarity search | 3.5x |
| `dot_product.wgsl` | Batch dot product | — |
| `euclidean_distance.wgsl` | Batch distance | — |
| `max_pool.wgsl` | Max pooling | — |
| `cls_pool.wgsl` | CLS token extraction | — |
| `matmul.wgsl` | Matrix-vector multiply | — |
| `vector_add.wgsl` | Vector addition | — |
| `vector_scale.wgsl` | Vector scaling | — |

### 3.3 Prime-Radiant GPU Shaders

| Shader | Purpose |
|--------|---------|
| `sheaf_attention.wgsl` | Energy-based sheaf attention on GPU |
| `sparse_mask.wgsl` | Sparse matrix masking |
| `token_routing.wgsl` | MoE token routing |
| `compute_residuals.wgsl` | Residual computation |
| `compute_energy.wgsl` | Energy calculations |

### 3.4 Device Detection

```rust
pub struct GpuInfo {
    name: String,
    vendor: String,
    backend: String,           // WebGPU, CUDA, Vulkan
    total_memory: u64,
    max_workgroup_size: u32,
    supports_compute: bool,
    supports_f16: bool,
}
```

---

## 4. AgentDB-ONNX: GPU Embedding Provider

### 4.1 Configuration

```typescript
// agentdb-onnx/src/services/ONNXEmbeddingService.ts
executionProviders: Array<'cuda' | 'dml' | 'coreml' | 'cpu'>

// Platform detection (lines 197-216):
Linux:   ['cuda', 'cpu']      // CUDA first, CPU fallback
Windows: ['dml', 'cpu']       // DirectML first
macOS:   ['coreml', 'cpu']    // CoreML first
```

### 4.2 Features

- **LRU Cache**: Smart caching for embedding results (default: 10,000 entries)
- **Batch processing**: 3-4x speedup vs sequential
- **Model warmup**: Pre-JIT compilation for consistent latency
- **Quantization**: `'none' | 'int8' | 'fp16'`

### 4.3 CLI

```bash
npx agentdb-onnx init ./db.db --model Xenova/all-MiniLM-L6-v2 --gpu
```

### 4.4 Status

**Stub**: Line 173 throws `'ONNX Runtime requires pre-converted models. Using Transformers.js fallback.'`

The plumbing is wired but ONNX model pre-conversion step is missing. Fix: convert model to ONNX format, remove error throw.

---

## 5. Flash Attention

### 5.1 ADR-008 Specification

```
Standard Attention: O(N^2) memory, O(N^2 * d) compute
Flash Attention:    O(N) memory,  O(N^2/M) HBM accesses

For 128K context:
  Standard: 65 GB memory, ~65 TB HBM I/O
  Flash:    ~2 GB memory, ~200 GB HBM I/O
  Speedup:  300x reduction in memory I/O
```

### 5.2 Block Sizes by Hardware

| Hardware | SRAM | B_r | B_c | Tiles/SM |
|----------|------|-----|-----|----------|
| NVIDIA A100 | 192 KB | 128 | 64 | 4 |
| NVIDIA H100 | 256 KB | 128 | 128 | 8 |
| Apple M4 GPU | 96 KB | 64 | 64 | 2 |
| CPU L2 cache | 256 KB | 256 | 128 | — |
| **7950X3D L2+3D V-Cache** | **96 MB** | **512+** | **256+** | **—** |

The 7950X3D's 96 MB 3D V-Cache is 375x larger than an A100's SRAM, making CPU Flash Attention potentially competitive with GPU for moderate sequence lengths.

### 5.3 Implementation Status

- **Algorithm**: Documented (ADR-003, ADR-008)
- **CPU implementation**: In progress (Rust)
- **GPU shaders**: Not yet started
- **JS stub**: Type definitions only in `swarm/src/attention-coordinator.ts`

---

## 6. SIMD Optimization (Non-GPU Acceleration)

### 6.1 Supported Architectures

| Architecture | Instructions | Register Width | Status |
|-------------|-------------|---------------|--------|
| ARM64 (Apple Silicon) | NEON | 128-bit | Implemented |
| x86_64 (Intel/AMD) | AVX2 | 256-bit | Implemented |
| x86_64 (Intel/AMD) | AVX-512 | 512-bit | Implemented |
| WebAssembly | SIMD128 | 128-bit | Implemented |

### 6.2 Documented Speedups

| Operation | SIMD Speedup |
|-----------|-------------|
| Vector operations | 6.2x |
| Matrix operations | 8.7x |
| Neural inference | 3.5x |
| Memory throughput | 4.1x |

### 6.3 Build Flags for 7950X3D

```bash
RUSTFLAGS="-C target-cpu=native -C target-feature=+avx2,+fma" cargo build --release
```

The 7950X3D supports AVX2 and FMA but not AVX-512.

---

## 7. Attention Mechanisms (ruflo)

### 7.1 Overview

39 attention mechanisms implemented in TypeScript with PostgreSQL SQL generation:

```typescript
export type AttentionCategory =
    | 'core'           // Standard multi-head attention
    | 'efficient'      // Linear, sparse, etc.
    | 'positional'     // Positional encoding variants
    | 'sparse'         // Sparse attention
    | 'linear'         // Linear attention approximations
```

**File**: `ruflo/v3/@claude-flow/plugins/src/integrations/ruvector/attention.ts`

### 7.2 Configuration

```typescript
export interface AttentionOptions {
    numHeads?: number,
    headDim?: number,
    dropout?: number,
    causal?: boolean,
    scale?: number,
    maxSeqLen?: number,
    params?: AttentionParams,
}
```

---

## 8. ARM/Mobile GPU Support (ADR-005)

### 8.1 Platform-Specific GPU Capabilities

| Platform | GPU | API | Max Workgroup |
|----------|-----|-----|--------------|
| Android (Qualcomm Adreno) | Adreno | Vulkan | 128-1024 |
| Android (ARM Mali) | Mali | Vulkan | 64-256 |
| Android (Samsung Xclipse) | RDNA2 | Vulkan | 1024 |
| macOS/iOS (Apple Silicon) | Apple GPU | Metal | 1024 |
| iOS | Apple GPU | Metal | 512-1024 |
| NVIDIA Jetson | NVIDIA | Vulkan | 1024 |
| Raspberry Pi 5 | VideoCore VII | Vulkan | 16-64 |
| Linux (AMD RDNA/CDNA) | AMD | Vulkan | 1024 |

### 8.2 Backend Selection Chain

1. Try direct CUDA (if available and requested)
2. Try wgpu-native (Vulkan/Metal/DX12)
3. CPU fallback (scalar)

---

## 9. Native Modules

### 9.1 Compiled Binaries

| Module | Platforms | Format |
|--------|-----------|--------|
| `ruvector.node` | darwin-x64, darwin-arm64, linux-x64-gnu, linux-arm64-gnu, win32-x64-msvc | Native Node addon |
| `rvf-node.*.node` | Same 5 platforms | RVF solver binding |
| `agentic_jujutsu.linux-x64-gnu.node` | Linux x64 | Agentic-jujutsu |
| `spiking-neural` | Via binding.gyp | Spiking neural network |

### 9.2 WASM Modules (22+)

| Module | Location |
|--------|----------|
| `reasoningbank_wasm_bg.wasm` | `agentic-flow/wasm/reasoningbank/` |
| `ruv-fann.wasm` | `ruv-FANN/ruv-swarm/npm/wasm/` |
| `ruvector_onnx_embeddings_wasm_bg.wasm` | `ruvector/npm/packages/ruvector/src/core/onnx/pkg/` |

---

## 10. Summary: GPU Capability Matrix

| Subsystem | GPU Feature | Implementation | Status | Activation |
|-----------|------------|---------------|--------|------------|
| ruv-FANN WebGPU | Neural training (Adam/AdamW/backprop) | Rust + WGSL | **Real** | `--features gpu` |
| ruv-FANN CUDA | Direct CUDA via cuda-sys | Rust | **Real** | `--features native-gpu` |
| RuVector Shaders | Similarity, pooling, attention (11 shaders) | WGSL | **Real** | `GpuConfig::auto()` |
| Prime-Radiant | Sheaf attention, MoE routing (5 shaders) | WGSL | **Real** | Build flag |
| AgentDB-ONNX | CUDA/DirectML/CoreML embeddings | TypeScript | **Stub** | `--gpu` flag, needs model conversion |
| Flash Attention | Tiled attention algorithm | Spec + partial CPU | **In progress** | N/A |
| HNSW Search | GPU-accelerated similarity | Planned | **Not started** | — |
| Attention Mechanisms | 39 variants | TypeScript (CPU) | **Real (CPU only)** | — |
| SIMD | AVX2, AVX-512, NEON, WASM SIMD128 | Rust | **Real** | Auto-detected |

---

## 11. Recommendations

### Immediate (No GPU Required)

1. Build RuVector and ruv-FANN with `-C target-cpu=native` for AVX2 optimization on 7950X3D
2. Install `@xenova/transformers` + `onnxruntime-node` for 768-dim ONNX embeddings
3. Apply optimized config from ADR-0030

### With GPU (RTX 4060 Ti or similar)

1. Install `onnxruntime-gpu` — enables CUDA execution provider for embeddings
2. Build ruv-FANN with `--features gpu` — activates WebGPU via Vulkan on Linux
3. Build RuVector with GPU features — activates 11 similarity shaders
4. Set `agentdb.useGPU: true` and `neural.executionProviders: ["cuda", "cpu"]`

### Development Needed

1. Fix AgentDB-ONNX stub (line 173) — convert model, remove error throw
2. Wire Prime-Radiant shaders to main pipeline
3. Implement GPU Flash Attention shaders (CPU block sizes for 7950X3D documented)
4. Connect MoE `token_routing.wgsl` to JS MoE router
