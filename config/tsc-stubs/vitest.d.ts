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
