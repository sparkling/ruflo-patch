// lib/fork-paths.mjs — Node-importable fork-path single source of truth (ADR-0245)
//
// Mirrors lib/fork-paths.sh for .mjs/.js consumers. Both read the same
// config/upstream-branches.json, ensuring single-source-of-truth and
// composability with ADR-0236 R3 pattern.
//
// Env-var override (per ADR-0245 §F-02-006): each FORK_DIR_* can be
// overridden via the matching env var (FORK_DIR_RUFLO, FORK_DIR_AGENTIC,
// etc.) so callsites stay portable across machines.
//
// Usage:
//   import { FORK_DIR_RUFLO, FORK_DIR_AGENTIC, FORK_PATHS } from "../lib/fork-paths.mjs";
//
// Or for env-overridable shape (preferred at callsite per ADR-0245 step 3):
//   const FORK_DIR_AGENTDB = process.env.FORK_DIR_AGENTDB ?? FORK_PATHS.agentdb.dir;

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const _CONFIG = resolve(__dirname, "..", "config", "upstream-branches.json");

const _raw = JSON.parse(readFileSync(_CONFIG, "utf8"));

// Short-name mapping (matches lib/fork-paths.sh _FORK_HEAD_PREFIX)
const _SHORT = {
  "ruflo": "RUFLO",
  "agentic-flow": "AGENTIC",
  "ruv-FANN": "FANN",
  "ruvector": "RUVECTOR",
  "agentdb": "AGENTDB",
};

/**
 * FORK_PATHS — by-name fork metadata (dir, branch, url).
 *
 * Example:
 *   FORK_PATHS.ruflo.dir          // "/Users/henrik/source/forks/ruflo"
 *   FORK_PATHS["agentic-flow"]    // { dir, branch, url, ... }
 */
export const FORK_PATHS = _raw;

/**
 * Per-fork directory constants. Env-var override takes precedence
 * (process.env.FORK_DIR_*) so machines without the default layout work.
 */
export const FORK_DIR_RUFLO =
  process.env.FORK_DIR_RUFLO ?? _raw.ruflo.dir;
export const FORK_DIR_AGENTIC =
  process.env.FORK_DIR_AGENTIC ?? _raw["agentic-flow"].dir;
export const FORK_DIR_FANN =
  process.env.FORK_DIR_FANN ?? _raw["ruv-FANN"].dir;
export const FORK_DIR_RUVECTOR =
  process.env.FORK_DIR_RUVECTOR ?? _raw.ruvector.dir;
export const FORK_DIR_AGENTDB =
  process.env.FORK_DIR_AGENTDB ?? _raw.agentdb.dir;

/**
 * Resolve a fork directory by its canonical name (matches keys in
 * config/upstream-branches.json). Honours env-var override.
 *
 * Returns undefined for unknown names (caller decides whether to throw).
 */
export function getForkDir(name) {
  const short = _SHORT[name];
  if (short) {
    const env = process.env[`FORK_DIR_${short}`];
    if (env) return env;
  }
  return _raw[name]?.dir;
}

/**
 * Array of all known fork names (canonical config keys).
 */
export const FORK_NAMES = Object.keys(_raw);
