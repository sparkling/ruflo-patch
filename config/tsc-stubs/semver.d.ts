// Ambient stub for semver — version comparison.
// Real types ship with @types/semver; this stub satisfies tsc in the
// release toolchain (no node_modules in /tmp/ruflo-build).
declare module 'semver' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const semver: any;
  export default semver;
  export function valid(v: string | null | undefined): string | null;
  export function clean(v: string): string | null;
  export function satisfies(v: string, range: string): boolean;
  export function gt(a: string, b: string): boolean;
  export function gte(a: string, b: string): boolean;
  export function lt(a: string, b: string): boolean;
  export function lte(a: string, b: string): boolean;
  export function eq(a: string, b: string): boolean;
  export function compare(a: string, b: string): -1 | 0 | 1;
  export function major(v: string): number;
  export function minor(v: string): number;
  export function patch(v: string): number;
  export function prerelease(v: string): readonly string[] | null;
  export function inc(v: string, release: string): string | null;
  export function parse(v: string): { version: string; major: number; minor: number; patch: number; prerelease: readonly string[]; build: readonly string[]; raw: string } | null;
  export function coerce(v: unknown): { version: string } | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const SemVer: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export type SemVer = any;
}
