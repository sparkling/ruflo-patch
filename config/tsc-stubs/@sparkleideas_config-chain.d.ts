// Type stub for @sparkleideas/config-chain (ADR-0177 Phase 1.6).
// Used by gen-tsconfig.mjs when building cross-repo packages (e.g. agentdb)
// that import from @sparkleideas/config-chain but don't have it in node_modules.
declare module '@sparkleideas/config-chain' {
  export interface EmbeddingChainConfig {
    readonly model: string | undefined;
    readonly dimension: number;
    readonly provider: string;
    readonly allowPaidProvider: boolean;
  }
  export interface ConfigChain {
    readonly embedding: EmbeddingChainConfig;
  }
  export class ConfigChainValidationError extends Error {
    constructor(message: string);
  }
  export class EmbeddingDimensionMismatchError extends Error {
    readonly model: string;
    readonly expected: number;
    readonly actual: number;
    constructor(model: string, expected: number, actual: number);
  }
  export function getConfig(): ConfigChain;
  export function getEmbeddingConfig(): {
    model: string | undefined;
    dimension: number;
    provider: string;
    allowPaidProvider: boolean;
  };
  export function resetConfig(): void;
  export function isConfigOnDisk(): boolean;
  export function validateBoot(chain?: ConfigChain): void;
}
