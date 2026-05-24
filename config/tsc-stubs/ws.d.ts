// Ambient stub for ws — runtime-optional WebSocket transport for MCP.
// Real types ship with @types/ws; this stub satisfies tsc in the release
// toolchain (no node_modules in /tmp/ruflo-build).
declare module 'ws' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const WebSocket: any;
  export default WebSocket;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const WebSocketServer: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export type WebSocketServer = any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export type Server = any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export type ServerOptions = any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export type RawData = any;
}
