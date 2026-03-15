declare module 'onnxruntime-node' {
  export class InferenceSession { static create(path: string, opts?: any): Promise<InferenceSession>; run(feeds: any): Promise<any>; }
  export class Tensor { constructor(type: string, data: any, dims?: number[]); data: any; dims: number[]; }
}
