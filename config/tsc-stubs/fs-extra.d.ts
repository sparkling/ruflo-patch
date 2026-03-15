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
