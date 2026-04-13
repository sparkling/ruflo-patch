#!/usr/bin/env node
/**
 * ADR-0087 Phase 1: Adversarial Prompting Before Implementation
 *
 * Classifies incoming prompts as trivial vs. non-trivial and emits
 * an advisory when an adversarial review pass is warranted.
 *
 * Precedence: architectural wins over trivial. The cost of a missed
 * advisory (shipping bad architecture) far exceeds the cost of an
 * unnecessary one (5 minutes of review). Trivial patterns only apply
 * when NO architectural pattern matches.
 *
 * Integrated into the `route` handler in hook-handler.cjs so the
 * advisory appears as a system-reminder before the AI starts work.
 */

// Patterns that indicate architectural / non-trivial changes.
// Each entry: [regex, label used in trigger output]
const ARCHITECTURAL_PATTERNS = [
  [/\b(?:architect(?:ure)?|system\s+design)\b/i, 'architecture'],
  [/\b(?:implement|build|create|add|introduce)\s+(?:a\s+)?(?:new\s+)?(?:feature|module|service|system|layer|abstraction)/i, 'new-feature'],
  [/\b(?:refactor|restructure|rewrite|migrate|overhaul|replace|split|move|deprecate)/i, 'refactor'],
  [/\badr[- ]?\d{2,4}\b/i, 'adr-reference'],
  [/\bphase\s+\d/i, 'phased-work'],
  [/\bmulti[- ]?(?:file|module|package|repo)\b/i, 'multi-scope'],
  [/\bcross[- ]?(?:cutting|module|package)\b/i, 'cross-cutting'],
  [/\b(?:data\s*model|schema|storage)\s+(?:change|migration|redesign|overhaul)/i, 'data-model'],
  [/\b(?:api|interface)\s+(?:change|breaking|redesign|overhaul)/i, 'api-change'],
  [/\b(?:delete|remove|rip\s+out|eliminate)\s+(?:\w+\s+)*(?:module|service|controller|layer|abstraction)\b/i, 'removal'],
];

// Patterns that indicate trivial changes — only checked when no
// architectural pattern matches (architectural takes precedence).
const TRIVIAL_PATTERNS = [
  /\b(?:fix\s+typo|update\s+version|bump\s+version)\b/i,
  /\b(?:update|edit)\s+(?:readme|docs|changelog|comment)\b/i,
  /\b(?:run|execute|check)\s+(?:tests?|status|lint|preflight)\b/i,
  /\b(?:config(?:uration)?)\s+(?:change|update|tweak|fix)\b/i,
  /\b(?:lint|format|style|prettier|eslint)\b/i,
  /\b(?:commit|push|merge|rebase|cherry-?pick)\b/i,
];

/**
 * Classify a prompt as requiring adversarial review or not.
 *
 * Precedence: architectural first. A prompt that matches both
 * architectural and trivial patterns is classified as architectural.
 * Trivial patterns are only consulted when nothing architectural matches.
 *
 * @param {string} prompt  The user's prompt text
 * @returns {{ adversarial: boolean, reason?: string, triggers?: string[] }}
 */
function classify(prompt) {
  if (!prompt || prompt.length < 10) {
    return { adversarial: false, reason: 'too-short' };
  }

  // Architectural check FIRST — these take precedence
  const triggers = [];
  for (const [pattern, label] of ARCHITECTURAL_PATTERNS) {
    if (pattern.test(prompt)) {
      triggers.push(label);
    }
  }

  if (triggers.length > 0) {
    return { adversarial: true, reason: 'architectural', triggers };
  }

  // Trivial check — only when nothing architectural matched
  for (const pattern of TRIVIAL_PATTERNS) {
    if (pattern.test(prompt)) {
      return { adversarial: false, reason: 'trivial' };
    }
  }

  return { adversarial: false, reason: 'no-match' };
}

/**
 * Build an advisory string from a classification result.
 * Returns null when no advisory is needed.
 * @param {{ adversarial: boolean, triggers?: string[] }} result
 * @returns {string|null}
 */
function advisory(result) {
  if (!result || !result.adversarial) return null;

  const triggerList = (result.triggers && result.triggers.length > 0)
    ? result.triggers.join(', ')
    : 'unknown';

  return `[ADR-0087] Adversarial review recommended (${triggerList}): describe approach, find 3 flaws, consider 3-year hindsight, then implement`;
}

module.exports = { classify, advisory, ARCHITECTURAL_PATTERNS, TRIVIAL_PATTERNS };
