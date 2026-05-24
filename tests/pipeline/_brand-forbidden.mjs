// ADR-0235 shared helper — forbidden-string set for umbrella-plugin brand lint.
//
// Used by:
//   - umbrella-plugin-brand.test.mjs (ADR-0235) — scans
//     forks/ruflo/.claude-plugin/**/*.{json,sh,md}
//   - reused by [[ADR-0248]] for adjacent brand-string lints
//
// Each entry is an EXACT substring. The lint fails if ANY entry appears in
// any file under UMBRELLA_FORBIDDEN_GLOB. There is NO operator-accept path
// (no UPDATE_GOLDEN-style escape hatch) — per [[feedback-no-fallbacks]] and
// [[feedback-no-squelch-tests]]. The only way to clear a hit is to fix the
// source content.
//
// Pattern note: `mcp add claude-flow ` carries a TRAILING SPACE to exclude
// false-positives in prose like "mcp add claude-flow-style helpers". The
// match window is the CLI argument position only (where a server key would
// follow).

export const UMBRELLA_FORBIDDEN_STRINGS = [
  '"name": "claude-flow"',
  '"version": "2.5.0"',
  '"name": "rUv"',
  'ruv@ruv.net',
  'npx claude-flow@alpha',
  'mcp add claude-flow ',
  'https://github.com/ruvnet/claude-flow',
];

// Path scope: only .claude-plugin/. The brand strings can exist in
// docs/adr/ (ADR text quoting), in upstream/ (raw upstream copies),
// or in audit transcripts — those are NOT subject to this lint.
export const UMBRELLA_FORBIDDEN_DIR = '.claude-plugin';

// Allowed file extensions inside UMBRELLA_FORBIDDEN_DIR.
// Per ADR-0235 §Decision §3 confirmation #5.
export const UMBRELLA_FORBIDDEN_EXTENSIONS = new Set(['.json', '.sh', '.md']);
