/**
 * ADR-0238 Surface 8 codemod.
 *
 * Adds `advisory: true` to the frontmatter of consensus agent Markdown
 * files and prepends a one-paragraph "Advisory roleplay only" notice
 * after the frontmatter. Idempotent on both fronts:
 *   - re-running with `advisory: true` already in frontmatter is a no-op
 *     for the frontmatter mutation;
 *   - re-running with the body marker already present is a no-op for the
 *     paragraph mutation.
 *
 * Per ADR-0238 Decision row 8 (quorum-majority 5/6 adoption): the agent
 * Markdown files have value as cognitive scaffolds for the LLM, so we
 * label them advisory rather than deleting. Real consensus dispatch goes
 * through `claude-flow hive-mind --consensus <mode>` →
 * `forks/agentdb/src/archivist/handlers/hive-mind/consensus/*`.
 *
 * Usage:
 *   import { applySurface8, BODY_MARKER, FRONTMATTER_KEY } from
 *     '../../ruflo-patch/lib/adr0238-surface8.mjs';
 *   import { readFileSync, writeFileSync } from 'node:fs';
 *   for (const path of files) {
 *     const before = readFileSync(path, 'utf8');
 *     const after = applySurface8(before);
 *     if (after !== before) writeFileSync(path, after);
 *   }
 */

export const FRONTMATTER_KEY = 'advisory: true';
export const BODY_MARKER = '**Advisory roleplay only (ADR-0238 S8).**';

export const ADVISORY_PARAGRAPH = `${BODY_MARKER} This agent's prompt describes distributed-consensus mechanisms (PBFT, Raft, gossip, CRDT, quorum, cryptographic security) but spawning it does NOT enforce them. Real consensus dispatch goes through \`claude-flow hive-mind --consensus <mode>\` → \`cli/src/mcp-tools/hive-mind-tools.ts\` → archivist → \`forks/agentdb/src/archivist/handlers/hive-mind/consensus/*\` (single-process state-merge with per-strategy threshold arithmetic). The agent name (\`byzantine-coordinator\`, \`raft-manager\`, etc.) does not connect to any PBFT three-phase / Raft leader-election / Ed25519-signed message-authentication implementation in this repo. Use the prompt as a reasoning scaffold; treat the protocol vocabulary as advisory, not enforced.

`;

/**
 * Insert a frontmatter key idempotently before the closing `---`.
 * Returns the unchanged source if the key is already present.
 */
function injectFrontmatterKey(source) {
  if (source.includes(FRONTMATTER_KEY)) {
    return source;
  }
  // Locate frontmatter block: must start with --- on line 1, end with ---
  if (!source.startsWith('---\n')) {
    throw new Error(
      `injectFrontmatterKey: file does not begin with '---\\n' frontmatter block`,
    );
  }
  // Find the closing --- (second occurrence)
  const closeIdx = source.indexOf('\n---\n', 4);
  if (closeIdx === -1) {
    throw new Error(
      `injectFrontmatterKey: closing '---' not found after frontmatter`,
    );
  }
  // Insert the key on its own line before the closing ---
  return (
    source.slice(0, closeIdx) +
    '\n' +
    FRONTMATTER_KEY +
    source.slice(closeIdx)
  );
}

/**
 * Insert the advisory paragraph immediately after the frontmatter block.
 * Returns the unchanged source if the body marker is already present.
 */
function injectAdvisoryParagraph(source) {
  if (source.includes(BODY_MARKER)) {
    return source;
  }
  const closeIdx = source.indexOf('\n---\n', 4);
  if (closeIdx === -1) {
    throw new Error(
      `injectAdvisoryParagraph: closing '---' not found after frontmatter`,
    );
  }
  // Insertion point is right after the closing `---\n` line.
  const afterClose = closeIdx + '\n---\n'.length;
  // Preserve any existing leading blank line; ensure a blank line before
  // the advisory paragraph so the rendered Markdown has clean separation.
  const tail = source.slice(afterClose);
  const leadingBlank = tail.startsWith('\n') ? '' : '\n';
  return source.slice(0, afterClose) + leadingBlank + ADVISORY_PARAGRAPH + tail;
}

/**
 * Apply both mutations idempotently.
 *
 * @param {string} source - Current file contents
 * @returns {string} Updated contents (unchanged if both mutations are no-ops)
 */
export function applySurface8(source) {
  if (typeof source !== 'string') {
    throw new Error('applySurface8: source must be a string');
  }
  return injectAdvisoryParagraph(injectFrontmatterKey(source));
}
