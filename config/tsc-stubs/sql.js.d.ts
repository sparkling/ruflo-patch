// Ambient stub for sql.js — dynamically imported, runtime-optional.
// Real types ship with @types/sql.js; this stub satisfies tsc in the
// release toolchain (no node_modules in /tmp/ruflo-build).
declare module 'sql.js' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const initSqlJs: any;
  export default initSqlJs;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export type Database = any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export type SqlValue = any;
}
