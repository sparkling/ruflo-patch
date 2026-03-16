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
