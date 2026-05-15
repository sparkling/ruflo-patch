// @tier unit
// ADR-0181 Phase 7 r2 — `ensureSqliteWired` shares cli's controller-registry
// AgentDB handle, plus write-dispatch wiring.
//
// Phase 7 collapses the split-brain SQLite substrate that pre-Phase-7
// `ensureSqliteWired()` introduced. Pre-Phase-7 the cli archivist opened a
// SEPARATE empty file at `<projectRoot>/.claude-flow/archivist.db` while
// the cli's AgentDB controllers (ReflexionMemory, SkillLibrary,
// HierarchicalMemory) wrote to `<projectRoot>/.swarm/memory.db` via
// `agentdb.initialize() → loadSchemas()`. Reads dispatched through the
// archivist therefore queried an empty handle while the controller writes
// landed in a different file — round-trip FAIL on every dispatched write.
//
// Phase 7 r1 attempted a path-repoint (open a fresh `BetterSqlite3` on
// `<root>/.swarm/memory.db`). That hit a startup-ordering bug — in fresh
// CLI subprocesses the agentdb_* MCP tool dispatch is the FIRST agentdb_*
// touch-point, and `ensureSqliteWired` ran BEFORE AgentDB.initialize had
// created the file. The r1 fail-loud guard caught this, but converted what
// should be a working dispatch into 5 acceptance-suite failures.
//
// Phase 7 r2 — current — shares the cli's existing ControllerRegistry
// AgentDB handle. The accessor `getControllerRegistryAgentDb()` in
// memory-router.ts calls `ensureRegistry()` (which triggers
// AgentDB.initialize → loadSchemas, creating the file as a side-effect of
// the lookup), then returns the live `database` field. The archivist
// receives the SAME `BetterSqlite3.Database` handle the carve-out
// controllers use — one fd, one statement cache, no path-existence race.
//
// Phase 7 makes 2 source-level changes:
//
//   1. `forks/ruflo/v3/@claude-flow/cli/src/memory/archivist-init.ts`:
//      `ensureSqliteWired()` shares the controller-registry's AgentDB
//      handle via `getControllerRegistryAgentDb()` (NOT a `new
//      BetterSqlite3()` open). Doc-comment + carve-out probe still
//      reference the `.swarm/memory.db` path it ends up on.
//
//   2. `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/agentdb-tools.ts`:
//      The 3 write dispatch sites for `agentdb_reflexion_store`,
//      `agentdb_skill_create`, and `agentdb_hierarchical_store` gate
//      behind `ensureSqliteWired()` (NOT `ensureRvfWired()`), mirroring
//      the read-side pattern used by `agentdb_reflexion_retrieve` and
//      `agentdb_causal_recall` (which also write to the SQLite carve-out).
//
// Behavioural correctness lives in the acceptance suite. This .mjs test is
// a belt-and-suspenders pipeline gate that catches a regression which
// re-introduces a fresh `new BetterSqlite3(...)` open inside
// ensureSqliteWired or reverts a write site to `ensureRvfWired()`.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const FORK_ROOT = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli';
const ARCHIVIST_INIT = `${FORK_ROOT}/src/memory/archivist-init.ts`;
const MEMORY_ROUTER = `${FORK_ROOT}/src/memory/memory-router.ts`;
const AGENTDB_TOOLS = `${FORK_ROOT}/src/mcp-tools/agentdb-tools.ts`;

function read(p) {
  return readFileSync(p, 'utf8');
}

describe('ADR-0181 Phase 7 r2 — ensureSqliteWired shares controller-registry handle', () => {
  it('memory-router exports getControllerRegistryAgentDb accessor', () => {
    const src = read(MEMORY_ROUTER);
    assert.match(
      src,
      /export\s+async\s+function\s+getControllerRegistryAgentDb\s*\(/,
      'memory-router.ts must export `getControllerRegistryAgentDb` for archivist-init to call',
    );
    // The accessor must call ensureRegistry() (otherwise the file isn't
    // created and the handle isn't live).
    const fnStart = src.indexOf('export async function getControllerRegistryAgentDb');
    assert.ok(fnStart > -1, 'getControllerRegistryAgentDb must be exported');
    const fnSlice = src.slice(fnStart, fnStart + 3000);
    assert.match(
      fnSlice,
      /await\s+ensureRegistry\(\)/,
      'getControllerRegistryAgentDb must await ensureRegistry() to trigger AgentDB.initialize',
    );
    // It must extract the handle via getAgentDB().database (not from any
    // other surface — the public ControllerRegistry method is getAgentDB()).
    assert.match(
      fnSlice,
      /getAgentDB\(\)/,
      'getControllerRegistryAgentDb must call _registryInstance.getAgentDB() — the public API',
    );
    assert.match(
      fnSlice,
      /\.database/,
      'getControllerRegistryAgentDb must surface the .database field as the BetterSqlite3 handle',
    );
  });

  it('ensureSqliteWired shares the registry handle (no `new BetterSqlite3` open)', () => {
    const src = read(ARCHIVIST_INIT);
    const fnStart = src.indexOf('export async function ensureSqliteWired');
    assert.ok(fnStart > -1, 'ensureSqliteWired must be exported');
    const fnSlice = src.slice(fnStart, fnStart + 4000);
    // Must call the memory-router accessor.
    assert.match(
      fnSlice,
      /getControllerRegistryAgentDb/,
      'ensureSqliteWired must call getControllerRegistryAgentDb() — the r2 handle-share accessor',
    );
    // Must NOT construct its own BetterSqlite3 handle inside the function.
    // Strip line comments + block comments first so a comment that says
    // "no `new BetterSqlite3()` open here" doesn't false-trip the regex.
    // (The type import `import type BetterSqlite3 from 'better-sqlite3'`
    // at the top of the file is fine — that's erased at TS emit. We're
    // checking for a runtime `new BetterSqlite3(...)` constructor call.)
    const codeOnly = fnSlice
      .replace(/\/\*[\s\S]*?\*\//g, '') // strip /* … */
      .replace(/\/\/[^\n]*/g, '');       // strip // … to EOL
    assert.doesNotMatch(
      codeOnly,
      /new\s+BetterSqlite3\s*\(/,
      'ensureSqliteWired must NOT call `new BetterSqlite3(...)` — share the registry handle, do not open a second one',
    );
    // And must not dynamic-import 'better-sqlite3' inside the function.
    assert.doesNotMatch(
      codeOnly,
      /import\(\s*['"]better-sqlite3['"]\s*\)/,
      'ensureSqliteWired must not dynamic-import better-sqlite3 — handle comes from the registry',
    );
  });

  it('archivist-init.ts no longer references .claude-flow/archivist.db at runtime', () => {
    // The pre-Phase-7 path. Doc-comment mentions explaining the migration
    // are permitted; runtime composition is not. Strip comments before
    // matching so doc-comment narrative doesn't false-trip the regex.
    const src = read(ARCHIVIST_INIT);
    const fnStart = src.indexOf('export async function ensureSqliteWired');
    const fnSlice = src.slice(fnStart, fnStart + 4000);
    const codeOnly = fnSlice
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    assert.doesNotMatch(
      codeOnly,
      /join\([^)]*['"]archivist\.db['"]/,
      'ensureSqliteWired must NOT compose a runtime path that ends in archivist.db',
    );
    assert.doesNotMatch(
      codeOnly,
      /join\([^)]*['"]\.claude-flow['"][^)]*['"]archivist\.db['"]/,
      'ensureSqliteWired must NOT join .claude-flow/archivist.db at the open site',
    );
  });

  it('archivist-init.ts does not auto-create directories (no mkdirSync)', () => {
    // r2 inherits r1's no-auto-create posture. The handle comes from the
    // registry — if the registry init fails to create the file, that is a
    // registry bug, not something archivist-init should paper over. Strip
    // comments before matching the function body so doc-comment mentions
    // ("we do NOT mkdirSync") don't false-trip the regex.
    const src = read(ARCHIVIST_INIT);
    assert.doesNotMatch(
      src,
      /^import\s*\{[^}]*mkdirSync[^}]*\}\s*from\s*['"]fs['"]/m,
      'archivist-init.ts must not import mkdirSync after the Phase 7 repoint',
    );
    const fnStart = src.indexOf('export async function ensureSqliteWired');
    const fnSlice = src.slice(fnStart, fnStart + 4000);
    const codeOnly = fnSlice
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    assert.doesNotMatch(
      codeOnly,
      /mkdirSync\(/,
      'ensureSqliteWired must NOT call mkdirSync — feedback-no-fallbacks',
    );
  });

  it('emits the carve-out table probe to stderr on first wire (Queen falsifier)', () => {
    // Still-required: list the visible carve-out tables (`episodes`,
    // `skills`, `skill_embeddings`, `hierarchical_memory`) on first wire
    // and write the result to process.stderr. In r2 this runs against the
    // shared handle — and `loadSchemas()` JUST installed those tables, so
    // the probe is provably true. If it prints zero of these names, the
    // schema set is wrong, not the wiring.
    const src = read(ARCHIVIST_INIT);
    const fnStart = src.indexOf('export async function ensureSqliteWired');
    const fnSlice = src.slice(fnStart, fnStart + 4000);
    assert.match(
      fnSlice,
      /sqlite_master[\s\S]*?episodes[\s\S]*?skills[\s\S]*?skill_embeddings[\s\S]*?hierarchical_memory/,
      'ensureSqliteWired must SELECT the 4 carve-out table names from sqlite_master',
    );
    assert.match(
      fnSlice,
      /process\.stderr\.write/,
      'ensureSqliteWired must write the probe result to process.stderr',
    );
  });
});

describe('ADR-0181 Phase 7 — write-dispatch sites gate behind ensureSqliteWired', () => {
  // The 3 write storeIds reclassified from RVF→SQLite-carve-out by Step 1
  // (substrate-registry roster). The cli's mcp-tool dispatch site for each
  // must `await ensureSqliteWired()` before `getProcessArchivist().dispatch(...)`,
  // mirroring the read-side pattern at:
  //   - reflexion-retrieve  (~L1053)
  //   - causal-recall       (~L1285)
  //
  // and matching the Phase 7 archivist substrate-resolution which now
  // expects the SQLite handle to be wired BEFORE the SQLite-carve-out
  // dispatch reaches `substrate.withWrite`.
  const sites = [
    {
      tool: 'agentdb_reflexion_store',
      dispatchKey: "'agentdb_reflexion_store'",
    },
    {
      tool: 'agentdb_skill_create',
      dispatchKey: "'agentdb_skill_create'",
    },
    {
      tool: 'agentdb_hierarchical_store',
      dispatchKey: "'agentdb_hierarchical_store'",
    },
  ];

  for (const s of sites) {
    describe(s.tool, () => {
      it(`calls ensureSqliteWired() before dispatch(${s.tool})`, () => {
        const src = read(AGENTDB_TOOLS);
        const dispatchIdx = src.indexOf(`.dispatch(${s.dispatchKey}`);
        assert.ok(
          dispatchIdx > -1,
          `dispatch(${s.dispatchKey}) call site must exist in agentdb-tools.ts`,
        );
        // Look back ~1500 chars for the gate. The pattern: an
        // `await ensureSqliteWired();` immediately precedes the dispatch.
        const window = src.slice(Math.max(0, dispatchIdx - 1500), dispatchIdx);
        assert.match(
          window,
          /await\s+ensureSqliteWired\(\)\s*;/,
          `${s.tool} dispatch must be gated behind await ensureSqliteWired()`,
        );
        // And it must NOT be gated by ensureRvfWired() — the prior
        // Phase 5/6 wiring used that, but Phase 7 reclassified these
        // storeIds to the SQLite carve-out.
        assert.doesNotMatch(
          window,
          /await\s+ensureRvfWired\(\)\s*;/,
          `${s.tool} dispatch must NOT call ensureRvfWired() (Phase 7 reclassified to SQLite carve-out)`,
        );
      });
    });
  }
});

describe('ADR-0181 Phase 7 r3 — read-side dispatch sites also gate behind ensureSqliteWired', () => {
  // Phase 7's axis-flip moved BOTH halves of the carve-out storeIds from RVF
  // to the SQLite carve-out. The WRITE sites are covered by the previous
  // describe block; this block covers the READ sites whose handlers now do
  // ctx.substrate.query against the shared .swarm/memory.db handle.
  //
  // Phase 7 r3 fix: agentdb_hierarchical_recall was previously gated behind
  // ensureRvfWired (read-side miss when its WRITE peer was repointed in r2).
  // The handler at handlers/agentdb/hierarchical-recall.ts now runs
  // `SELECT FROM hierarchical_memory ORDER BY importance DESC LIMIT topK` —
  // ensureRvfWired() would leave the SQLite handle unset and the dispatched
  // read would throw / return empty (the adr0112-27-4-rt-hierarchical
  // acceptance failure pre-r3).
  //
  // Note: agentdb_reflexion_retrieve and agentdb_causal_recall already gate
  // behind ensureSqliteWired in the source today (lines ~1055 and ~1291) —
  // they were correct in pre-Phase-7 because those handlers always read from
  // the SQLite carve-out via ReflexionMemory / CausalRecall (substrate-
  // registry PERMANENT_SQLITE_CARVE_OUT). Including them here keeps the
  // wiring gate covered against future drift.
  const readSites = [
    {
      tool: 'agentdb_hierarchical_recall',
      dispatchKey: "'agentdb_hierarchical_recall'",
    },
    {
      tool: 'agentdb_reflexion_retrieve',
      dispatchKey: "'agentdb_reflexion_retrieve'",
    },
    {
      tool: 'agentdb_causal_recall',
      dispatchKey: "'agentdb_causal_recall'",
    },
  ];

  for (const s of readSites) {
    describe(s.tool, () => {
      it(`calls ensureSqliteWired() before dispatchRead(${s.tool})`, () => {
        const src = read(AGENTDB_TOOLS);
        const dispatchIdx = src.indexOf(`.dispatchRead(${s.dispatchKey}`);
        assert.ok(
          dispatchIdx > -1,
          `dispatchRead(${s.dispatchKey}) call site must exist in agentdb-tools.ts`,
        );
        const window = src.slice(Math.max(0, dispatchIdx - 1500), dispatchIdx);
        assert.match(
          window,
          /await\s+ensureSqliteWired\(\)\s*;/,
          `${s.tool} dispatchRead must be gated behind await ensureSqliteWired()`,
        );
        assert.doesNotMatch(
          window,
          /await\s+ensureRvfWired\(\)\s*;/,
          `${s.tool} dispatchRead must NOT call ensureRvfWired() (Phase 7 reclassified to SQLite carve-out)`,
        );
      });
    });
  }
});
