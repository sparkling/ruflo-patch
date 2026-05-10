// @tier unit
// ADR-0156: `memory init --force` actually resets the canonical RVF
// sibling set; `init` reports the real backend + path.
//
// This file pins the post-ADR-0156 contract via:
//   1. Source-structural assertions on commands/memory.ts (the action's
//      shape: --force is wired, hardcoded '.swarm/memory.db' is gone,
//      fabricated tablesCreated/indexesCreated/success removed,
//      migrate-tool referenced in examples).
//   2. Source-structural assertions on memory-router.ts (new exports:
//      RVF_CANONICAL_EXTENSIONS, getActiveBackendPath,
//      getActiveSiblingPaths; _databasePath cleared in resetRouter).
//   3. Behavioral assertions on the dispatcher + sibling enumeration —
//      gated on dist freshness so the unit tier doesn't false-fail
//      between source edits and the next pipeline build.
//
// Per `feedback-no-squelch-tests`, every assertion must be observable.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';

const FORK_CLI_SRC    = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src';
const FORK_MEMORY_SRC = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/memory/src';

const MEMORY_CMD_SRC  = `${FORK_CLI_SRC}/commands/memory.ts`;
const ROUTER_SRC      = `${FORK_CLI_SRC}/memory/memory-router.ts`;

assert.ok(existsSync(MEMORY_CMD_SRC), `memory.ts missing at ${MEMORY_CMD_SRC}`);
assert.ok(existsSync(ROUTER_SRC),     `memory-router.ts missing at ${ROUTER_SRC}`);

const cmdSrc    = readFileSync(MEMORY_CMD_SRC, 'utf8');
const routerSrc = readFileSync(ROUTER_SRC, 'utf8');

describe('ADR-0156 — memory-router exposes the canonical-path getters', () => {
  it('exports RVF_CANONICAL_EXTENSIONS as the centralised sibling list', () => {
    assert.match(routerSrc, /export\s+const\s+RVF_CANONICAL_EXTENSIONS\s*=\s*\[/,
      'memory-router.ts must export RVF_CANONICAL_EXTENSIONS as the centralised canonical sibling list');
    // Pin the exact 6-entry shape so file-enumeration drift is caught.
    assert.match(routerSrc, /RVF_CANONICAL_EXTENSIONS\s*=\s*\[\s*''\s*,/,
      'first entry must be empty string (the main path)');
    for (const ext of ['.meta', '.wal', '.lock', '.jslock', '.ingestlock']) {
      assert.ok(routerSrc.includes(`'${ext}'`),
        `RVF_CANONICAL_EXTENSIONS must include '${ext}'`);
    }
  });

  it('exports getActiveBackendPath returning the resolved databasePath', () => {
    assert.match(routerSrc, /export\s+function\s+getActiveBackendPath\s*\(\s*\)\s*:\s*string\s*\|\s*null/,
      'getActiveBackendPath() must be exported with signature () => string | null');
  });

  it('exports getActiveSiblingPaths deriving from RVF_CANONICAL_EXTENSIONS', () => {
    assert.match(routerSrc, /export\s+function\s+getActiveSiblingPaths\s*\(\s*\)\s*:\s*string\[\]/,
      'getActiveSiblingPaths() must be exported with signature () => string[]');
    // The implementation must use the centralised constant, not re-list.
    const fnMatch = routerSrc.match(/function\s+getActiveSiblingPaths[^}]+\}/);
    assert.ok(fnMatch, 'getActiveSiblingPaths body must be locatable');
    assert.match(fnMatch[0], /RVF_CANONICAL_EXTENSIONS/,
      'getActiveSiblingPaths must derive from RVF_CANONICAL_EXTENSIONS, not a parallel list');
  });

  it('captures _databasePath in _doInit and clears it in resetRouter', () => {
    assert.match(routerSrc, /let\s+_databasePath\s*:\s*string\s*\|\s*null\s*=\s*null/,
      '_databasePath module-level variable must exist');
    assert.match(routerSrc, /_databasePath\s*=\s*databasePath\s*;/,
      '_doInit must capture databasePath into _databasePath');
    // resetRouter() must clear it.
    const resetMatch = routerSrc.match(/export\s+function\s+resetRouter[^}]+\}/);
    assert.ok(resetMatch, 'resetRouter body must be locatable');
    assert.match(resetMatch[0], /_databasePath\s*=\s*null/,
      'resetRouter must clear _databasePath so the next ensureRouter() recaptures it');
  });
});

describe('ADR-0156 — memory init action wires --force + honest dbPath', () => {
  it('imports resetRouter + getActiveBackendPath + getActiveSiblingPaths + RVF_CANONICAL_EXTENSIONS', () => {
    // The init action must import the new symbols. Loose multi-line match.
    assert.match(cmdSrc, /resetRouter[\s\S]{0,300}getActiveBackendPath/,
      'init action must import resetRouter + getActiveBackendPath');
    assert.match(cmdSrc, /getActiveSiblingPaths/,
      'init action must import getActiveSiblingPaths');
    assert.match(cmdSrc, /RVF_CANONICAL_EXTENSIONS/,
      'init action must import RVF_CANONICAL_EXTENSIONS');
  });

  it('wires --force: lock-acquire check + symlink-safe unlink + resetRouter', () => {
    // The action body must reference all three steps, not just collect
    // the flag. We grep for distinctive markers to avoid false positives.
    assert.match(cmdSrc, /if\s*\(\s*force\s*\)\s*\{/,
      '--force must guard a real branch, not be unused');
    assert.match(cmdSrc, /isSymbolicLink/,
      '--force unlink loop must be symlink-safe (use lstatSync.isSymbolicLink check)');
    assert.match(cmdSrc, /process\.kill\s*\(\s*recordedPid\s*,\s*0\s*\)/,
      '--force lock-acquire check must verify peer PID liveness with signal 0');
    assert.match(cmdSrc, /resetRouter\s*\(\s*\)/,
      '--force must call resetRouter() to clear the in-process cache');
  });

  it('drops hardcoded ".swarm/memory.db" path from the result object', () => {
    // The pre-ADR-0156 code was: `dbPath: customPath || '.swarm/memory.db'`
    // The post-ADR-0156 form pulls from getActiveBackendPath().
    assert.doesNotMatch(cmdSrc, /dbPath:\s*customPath\s*\|\|\s*['"]\.swarm\/memory\.db['"]/,
      'hardcoded .swarm/memory.db fallback must be removed (use getActiveBackendPath())');
    assert.match(cmdSrc, /getActiveBackendPath\s*\(\s*\)/,
      'init action must call getActiveBackendPath() for the dbPath display');
  });

  // Helper: extract the body of the initMemoryCommand action. The init
  // subcommand is defined at `Init subcommand` and the next subcommand
  // is the migrate command (`// Migrate command — ADR-0030...`).
  function initActionBody() {
    const initActionStart = cmdSrc.indexOf('// Init subcommand');
    const initActionEnd = cmdSrc.indexOf('// Migrate command', initActionStart);
    assert.ok(initActionStart >= 0 && initActionEnd > initActionStart,
      `init action delimiters must be locatable (start=${initActionStart}, end=${initActionEnd})`);
    return cmdSrc.slice(initActionStart, initActionEnd);
  }

  it('drops fabricated tablesCreated / indexesCreated from the result object', () => {
    const initBody = initActionBody();
    // The pre-ADR-0156 code synthesised these as empty arrays. Post-ADR-0156
    // they must NOT appear in the init action's result construction.
    assert.doesNotMatch(initBody, /tablesCreated:\s*\[\]/,
      'fabricated tablesCreated: [] field must be removed from init result');
    assert.doesNotMatch(initBody, /indexesCreated:\s*\[\]/,
      'fabricated indexesCreated: [] field must be removed from init result');
    assert.doesNotMatch(initBody, /result\.tablesCreated/,
      'init must not read result.tablesCreated (display block must be removed)');
    assert.doesNotMatch(initBody, /result\.indexesCreated/,
      'init must not read result.indexesCreated (display block must be removed)');
  });

  it('drops fabricated literal "success: true as boolean" from result', () => {
    const initBody = initActionBody();
    // The pre-ADR-0156 form had `success: true as boolean`.
    assert.doesNotMatch(initBody, /success:\s*true\s+as\s+boolean/,
      'fabricated `success: true as boolean` must be removed; success is implicit on ensureRouter return');
  });

  it('references the migrate alternative in --help examples (ADR-0156 acceptance #7)', () => {
    // Pre-deletion warning + --help examples must point users at the
    // non-destructive migrate path.
    assert.ok(
      /migrate-meta-to-segments/.test(cmdSrc) || /memory migrate/.test(cmdSrc),
      'init --help examples or pre-deletion warning must reference the non-destructive migrate alternative',
    );
  });

  it('uses ruflo (not claude-flow) brand in --help examples (ADR-0143 + ADR-0155)', () => {
    const initActionStart = cmdSrc.indexOf('Init subcommand');
    const initExamplesEnd = cmdSrc.indexOf("'init',", initActionStart) + 200; // approximate examples block end
    // Check the examples block.
    const examplesStart = cmdSrc.indexOf('examples:', initActionStart);
    const examplesEnd = cmdSrc.indexOf('action:', examplesStart);
    assert.ok(examplesStart > 0 && examplesEnd > examplesStart, 'examples block must be locatable');
    const examplesBody = cmdSrc.slice(examplesStart, examplesEnd);
    assert.doesNotMatch(examplesBody, /'claude-flow memory init'/,
      'init --help examples must not use the bare claude-flow brand (ADR-0143)');
    assert.match(examplesBody, /ruflo memory init/,
      'init --help examples must use the ruflo brand');
  });
});

describe('ADR-0156 — behavioural smoke (gated on codemod build presence)', () => {
  // These behavioural tests run against the codemod'd build at /tmp/ruflo-build —
  // the same artifact the pipeline publishes. This is more meaningful than the
  // fork's own dist (which is never updated by `npm run build`). The original
  // fork-dist freshness gate caused spurious skips whenever fork source was
  // edited without rebuilding locally; the codemod dist is always rebuilt by
  // `npm run release` before publish.
  //
  // If /tmp/ruflo-build is absent (clean CI before first build), the test fails
  // loudly with a clear message — per feedback-no-fallbacks, skips are not
  // acceptable for working features.
  const distRouterPath = '/tmp/ruflo-build/v3/@claude-flow/cli/dist/src/memory/memory-router.js';

  it('imported router exposes getActiveBackendPath as a callable', async () => {
    assert.ok(existsSync(distRouterPath),
      `codemod dist missing at ${distRouterPath} — run npm run release to build`);
    const mod = await import(distRouterPath);
    assert.equal(typeof mod.getActiveBackendPath, 'function',
      'memory-router dist must export getActiveBackendPath as a function');
    assert.equal(typeof mod.getActiveSiblingPaths, 'function',
      'memory-router dist must export getActiveSiblingPaths as a function');
    assert.ok(Array.isArray(mod.RVF_CANONICAL_EXTENSIONS),
      'memory-router dist must export RVF_CANONICAL_EXTENSIONS as an array');
    assert.equal(mod.RVF_CANONICAL_EXTENSIONS.length, 6,
      'RVF_CANONICAL_EXTENSIONS must have 6 entries (main + 5 sibling exts)');
  });

  it('getActiveBackendPath returns null before init', async () => {
    assert.ok(existsSync(distRouterPath),
      `codemod dist missing at ${distRouterPath} — run npm run release to build`);
    const mod = await import(distRouterPath);
    // Reset to ensure a clean pre-init state.
    if (typeof mod.resetRouter === 'function') mod.resetRouter();
    assert.equal(mod.getActiveBackendPath(), null,
      'getActiveBackendPath() must return null before any ensureRouter() call');
    assert.deepEqual(mod.getActiveSiblingPaths(), [],
      'getActiveSiblingPaths() must return empty array before init');
  });
});
