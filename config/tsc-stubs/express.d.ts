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
