/**
 * ADR-0238 Surface 4 quarantine-header template.
 *
 * Applies a uniform `// QUARANTINED` file-header comment to a set of
 * .ts files (4 files in `forks/ruflo/v3/@claude-flow/swarm/src/consensus/`)
 * announcing the quarantine disposition for ADR-0238 Surface 4. The header
 * cites upstream commit `22ca3b018` (ADR-095 G2 step 1, 2026-05-11) per
 * the swarm review's Confirmation amendment, so future upstream-sync
 * agents see the live evidence of why the subtree is retained.
 *
 * Idempotent: re-running detects the existing header and is a no-op. The
 * marker is the string literal `ADR-0238 Surface 4 quarantine`.
 *
 * Usage:
 *   import { applyQuarantineHeader, QUARANTINE_HEADER } from
 *     '../../ruflo-patch/lib/adr0238-quarantine-header.mjs';
 *   import { readFileSync, writeFileSync } from 'node:fs';
 *   for (const path of files) {
 *     const before = readFileSync(path, 'utf8');
 *     const after = applyQuarantineHeader(before);
 *     if (after !== before) writeFileSync(path, after);
 *   }
 */

export const QUARANTINE_MARKER = 'ADR-0238 Surface 4 quarantine';

export const QUARANTINE_HEADER = `/**
 * ${QUARANTINE_MARKER}: NO NEW imports from this directory.
 *
 * Consensus implementation in this subtree is fork-internal stub state;
 * production consensus routes through
 * \`cli/src/mcp-tools/hive-mind-tools.ts\` → archivist dispatch →
 * \`forks/agentdb/src/archivist/handlers/hive-mind/consensus/*\`. New code
 * MUST import from there. Arch-test
 * (\`__tests__/no-new-consensus-imports.test.ts\`) enforces no new in-tree
 * importers beyond the baseline allowlist (\`unified-coordinator.ts\` +
 * \`index.ts\` re-exports).
 *
 * Retained (not deleted) because upstream is actively extending this
 * surface — see ruvnet/ruflo commit 22ca3b018 (ADR-095 G2 step 1 —
 * pluggable ConsensusTransport + Ed25519 message signing, 2026-05-11).
 * Delete-or-quarantine decision dispatched per ADR-0238 quarantine
 * disposition (per swarm review Confirmation amendment).
 */

`;

/**
 * Prepend the quarantine header to a TypeScript file's contents if it
 * isn't already present. Idempotent on the marker string.
 *
 * @param {string} source - Current file contents
 * @returns {string} Updated contents (unchanged if marker present)
 */
export function applyQuarantineHeader(source) {
  if (typeof source !== 'string') {
    throw new Error('applyQuarantineHeader: source must be a string');
  }
  if (source.includes(QUARANTINE_MARKER)) {
    return source;
  }
  return QUARANTINE_HEADER + source;
}
