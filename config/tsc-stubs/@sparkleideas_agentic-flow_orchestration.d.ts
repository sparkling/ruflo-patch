// Codemod-rebranded form of `agentic-flow/orchestration`.
// See config/package-map.json: agentic-flow → @sparkleideas/agentic-flow.
declare module '@sparkleideas/agentic-flow/orchestration' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function createOrchestrator(...args: any[]): any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function createOrchestrationClient(...args: any[]): any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function seedMemory(...args: any[]): Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function searchMemory(...args: any[]): Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function harvestMemory(...args: any[]): Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function recordLearning(...args: any[]): Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function getRunStatus(id: string): Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function getRunArtifacts(id: string): Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function cancelRun(id: string): Promise<any>;
}
