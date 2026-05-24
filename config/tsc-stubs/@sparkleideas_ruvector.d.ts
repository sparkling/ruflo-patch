// Codemod-rebranded form of `ruvector` and `@ruvector/core` (root package).
// See config/package-map.json: ruvector → @sparkleideas/ruvector.
declare module '@sparkleideas/ruvector' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m: any;
  export default m;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const VectorDB: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const VectorDb: any;
  export function isWasm(): boolean;
  export function initOnnxEmbedder(): Promise<void>;
  export function isOnnxAvailable(): boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function getOptimizedOnnxEmbedder(): any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const AdaptiveEmbedder: any;
}
