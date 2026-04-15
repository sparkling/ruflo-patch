#!/usr/bin/env node
/**
 * ADR-0087: Adversarial Prompting Workflow
 *
 * Phase 1: Classifies incoming prompts as trivial vs. non-trivial and emits
 *          an advisory when an adversarial review pass is warranted.
 * Phase 2: Recommends parallel thinking sessions (implementation,
 *          adversarial-review, test-generation, documentation, simplification)
 *          based on the classification triggers.
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
  [/\b(?:delete|remove|rip\s+out|eliminate)\s+(?:\w+\s+){0,5}(?:module|service|controller|layer|abstraction)\b/i, 'removal'],
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

// ============================================================================
// Phase 2: Parallel Thinking Sessions
//
// Maps classification triggers to recommended thinking session types.
// Topology-agnostic — recommends thinking types, not specific agent names.
// CLAUDE.md defines actual agent mappings; this just advises which parallel
// thinking sessions are worth running.
// ============================================================================

const THINKING_SESSIONS = Object.freeze([
  'implementation',
  'adversarial-review',
  'test-generation',
  'documentation',
  'simplification',
]);

// Default: all triggers get all 5 sessions. Subtracting sessions proved wrong
// in adversarial review — refactors need docs (existing docs go stale), phased
// work needs simplification (cruft accumulates between phases). Individual
// entries can still override to fewer if a clear reason exists.
const SESSION_MAP = Object.freeze({
  'architecture':   Object.freeze(THINKING_SESSIONS.slice()),
  'new-feature':    Object.freeze(THINKING_SESSIONS.slice()),
  'data-model':     Object.freeze(THINKING_SESSIONS.slice()),
  'api-change':     Object.freeze(THINKING_SESSIONS.slice()),
  'multi-scope':    Object.freeze(THINKING_SESSIONS.slice()),
  'cross-cutting':  Object.freeze(THINKING_SESSIONS.slice()),
  'refactor':       Object.freeze(THINKING_SESSIONS.slice()),
  'removal':        Object.freeze(THINKING_SESSIONS.slice()),
  'adr-reference':  Object.freeze(THINKING_SESSIONS.slice()),
  'phased-work':    Object.freeze(THINKING_SESSIONS.slice()),
});

/**
 * Recommend parallel thinking sessions for a classified prompt.
 *
 * Returns sessions in canonical order (THINKING_SESSIONS order),
 * de-duplicated across all triggers. Returns [] for non-adversarial prompts.
 *
 * @param {{ adversarial: boolean, triggers?: string[] }} classifyResult
 * @returns {string[]}
 */
function recommendSessions(classifyResult) {
  if (!classifyResult || !classifyResult.adversarial) return [];

  const triggers = classifyResult.triggers || [];
  const sessionSet = new Set();

  for (const trigger of triggers) {
    const sessions = SESSION_MAP[trigger];
    if (sessions) {
      for (const s of sessions) sessionSet.add(s);
    }
  }

  // Return in canonical order
  return THINKING_SESSIONS.filter(s => sessionSet.has(s));
}

/**
 * Build a session advisory string from recommended sessions.
 * Returns null when no sessions are recommended.
 *
 * @param {string[]} sessions
 * @returns {string|null}
 */
function sessionAdvisory(sessions) {
  if (!Array.isArray(sessions) || sessions.length === 0) return null;
  return `[ADR-0087] Parallel sessions: ${sessions.join(', ')}`;
}

// ============================================================================
// Phase 3: AI-First Review
//
// Maps classification triggers to review focus areas. The bottleneck in
// AI-assisted development is reviewing code, not writing it. AI performs
// first-pass review before any human sees the code:
//   - Style/convention violations
//   - Missing edge cases
//   - Architectural concerns
//   - Reduces human review to judgment calls only
//
// Emitted in the route hook after session advisory, so the AI knows what
// to check before it starts work. Static checklists are a stepping stone —
// the hook plumbing is the durable value.
// ============================================================================

const REVIEW_CATEGORIES = Object.freeze([
  'conventions',
  'edge-cases',
  'architecture',
  'security',
  'test-coverage',
  'compatibility',
]);

// Maps classification triggers to relevant review focus areas.
// Each trigger gets the categories most likely to catch issues for that
// type of change. Every entry uses only IDs from REVIEW_CATEGORIES.
const TRIGGER_REVIEWS = Object.freeze({
  'architecture':   Object.freeze(['conventions', 'architecture', 'security', 'test-coverage']),
  'new-feature':    Object.freeze(['conventions', 'edge-cases', 'security', 'test-coverage']),
  'refactor':       Object.freeze(['conventions', 'architecture', 'compatibility', 'test-coverage']),
  'data-model':     Object.freeze(['edge-cases', 'security', 'compatibility', 'test-coverage']),
  'api-change':     Object.freeze(['edge-cases', 'security', 'compatibility', 'test-coverage']),
  'multi-scope':    Object.freeze(['conventions', 'architecture', 'test-coverage']),
  'cross-cutting':  Object.freeze(['conventions', 'architecture', 'test-coverage']),
  'removal':        Object.freeze(['compatibility', 'test-coverage']),
  'adr-reference':  Object.freeze(['conventions', 'architecture', 'test-coverage']),
  'phased-work':    Object.freeze(['conventions', 'compatibility', 'test-coverage']),
});

/**
 * Build a review checklist from a classification result.
 *
 * Returns review category IDs in canonical order (REVIEW_CATEGORIES order),
 * de-duplicated across all triggers. Returns [] for non-adversarial prompts.
 *
 * @param {{ adversarial: boolean, triggers?: string[] }} classifyResult
 * @returns {string[]}
 */
function reviewChecklist(classifyResult) {
  if (!classifyResult || !classifyResult.adversarial) return [];

  const triggers = classifyResult.triggers || [];
  const categorySet = new Set();

  for (const trigger of triggers) {
    const cats = TRIGGER_REVIEWS[trigger];
    if (cats) {
      for (const c of cats) categorySet.add(c);
    }
  }

  // Return in canonical order
  return REVIEW_CATEGORIES.filter(c => categorySet.has(c));
}

/**
 * Build a review advisory string from a checklist.
 * Returns null when no review categories are recommended.
 *
 * @param {string[]} checklist
 * @returns {string|null}
 */
function reviewAdvisory(checklist) {
  if (!Array.isArray(checklist) || checklist.length === 0) return null;
  return `[ADR-0087] AI-first review: ${checklist.join(', ')}`;
}

module.exports = {
  classify, advisory,
  recommendSessions, sessionAdvisory,
  reviewChecklist, reviewAdvisory,
  ARCHITECTURAL_PATTERNS, TRIVIAL_PATTERNS,
  THINKING_SESSIONS, SESSION_MAP,
  REVIEW_CATEGORIES, TRIGGER_REVIEWS,
};
