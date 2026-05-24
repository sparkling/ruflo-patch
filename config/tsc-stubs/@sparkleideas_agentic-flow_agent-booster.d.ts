// Codemod-rebranded form of `agentic-flow/agent-booster`.
declare module '@sparkleideas/agentic-flow/agent-booster' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export class EnhancedAgentBooster { constructor(...args: any[]); }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function getEnhancedBooster(...args: any[]): any;
  export function enhancedApply(opts: { code: string; edit: string; language?: string }): Promise<{ confidence: number; output: string }>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function benchmark(...args: any[]): Promise<any>;
}
