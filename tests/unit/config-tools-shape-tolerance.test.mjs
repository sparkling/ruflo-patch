// @tier unit
// ADR-0094 Phase 8 / INV-6: config_set ↔ config_get round-trip tolerance
//
// Context: `init` / `config-template.ts` writes a NESTED config.json:
//
//     { "version":"3.0.0", "swarm":{ "topology":"hierarchical-mesh", ...}, ... }
//
// The MCP tools in src/mcp-tools/config-tools.ts historically assumed a FLAT
// top-level shape `{values:{…}, scopes:{…}, version, updatedAt}` and indexed
// `store.values[key]`, which threw / returned undefined on every init-generated
// config. Phase 8 INV-6 (config_set → config_get round-trip) fails as a result.
//
// The fix makes `loadConfigStore()` tolerant of both shapes, records the
// detected shape on the store (`__shape`), and `saveConfigStore()` writes back
// in the SAME shape it loaded. Handlers use nested `setNestedValue` /
// `getNestedValue` when operating on a legacy tree, and flat key access when
// operating on an MCP-shape store.
//
// This test file exercises:
//   • Unit:         loadConfigStore shape detection (legacy vs mcp vs default)
//   • Unit:         saveConfigStore preserves original shape, does not leak
//                   `__shape` bookkeeping or an MCP wrapper into legacy trees
//   • Integration:  config_set + config_get handlers round-trip a dotted key
//                   through a nested init-generated config.json
//   • Integration:  handlers round-trip through a flat MCP-shape config.json
//   • Integration:  test.p5key regression (the exact case
//                   `check_p5_compat_config_set` in
//                   lib/acceptance-init-generated-checks.sh asserts against)
//   • Static:       fork source contains the shape-tolerant logic (regression
//                   guard against reversion)

import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  existsSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

// ============================================================================
// Constants — fork paths (pattern matches adr0074-silo-fix.test.mjs)
// ============================================================================

const FORK_ROOT = '/Users/henrik/source/forks/ruflo/v3';
const CONFIG_TOOLS_SRC = resolve(
  FORK_ROOT,
  '@claude-flow/cli/src/mcp-tools/config-tools.ts',
);
const CONFIG_TOOLS_DIST = resolve(
  FORK_ROOT,
  '@claude-flow/cli/dist/src/mcp-tools/config-tools.js',
);

// ============================================================================
// Helpers — isolate the config dir per test via CLAUDE_FLOW_CWD
// ============================================================================

/**
 * Each test gets its own tmp dir. `getProjectCwd()` honours
 * `CLAUDE_FLOW_CWD`, so the handlers write to the isolated dir and never
 * touch the repo they happen to run from.
 */
function makeIsoCwd(label) {
  const dir = mkdtempSync(join(tmpdir(), `cfgtools-${label}-`));
  mkdirSync(join(dir, '.claude-flow'), { recursive: true });
  return dir;
}

async function loadHandlersUnderCwd(cwd) {
  const prev = process.env.CLAUDE_FLOW_CWD;
  process.env.CLAUDE_FLOW_CWD = cwd;
  // `loadConfigStore` reads getProjectCwd() eagerly inside the handler call,
  // so it's sufficient to set the env var before invoking handlers. We also
  // bust the import cache by appending a cache-buster query — node:test
  // re-imports the module across tests.
  const mod = await import(`${CONFIG_TOOLS_DIST}?t=${Date.now()}-${Math.random()}`);
  return {
    mod,
    restore() {
      if (prev === undefined) delete process.env.CLAUDE_FLOW_CWD;
      else process.env.CLAUDE_FLOW_CWD = prev;
    },
  };
}

function getHandler(mod, name) {
  const tool = mod.configTools.find((t) => t.name === name);
  if (!tool) throw new Error(`tool ${name} missing from configTools`);
  return tool.handler;
}

function cfgPath(cwd) {
  return join(cwd, '.claude-flow', 'config.json');
}

function writeInitShape(cwd) {
  // Exact shape emitted by getMinimalConfigTemplate — mirrors what real
  // `init --minimal` writes to .claude-flow/config.json.
  const tree = {
    version: '3.0.0',
    swarm: {
      topology: 'hierarchical-mesh',
      maxAgents: 15,
      autoScale: { enabled: true },
      coordinationStrategy: 'consensus',
    },
    memory: {
      backend: 'hybrid',
      similarityThreshold: 0.7,
    },
    neural: {
      enabled: true,
      modelPath: '.claude-flow/neural',
    },
    mcp: {},
    ports: { mcp: 3000 },
    hooks: { enabled: true, autoExecute: true },
  };
  writeFileSync(cfgPath(cwd), JSON.stringify(tree, null, 2), 'utf-8');
  return tree;
}

function writeMcpShape(cwd) {
  const store = {
    values: {
      'swarm.topology': 'mesh',
      'memory.persistInterval': 60000,
    },
    scopes: {
      project: { 'logging.level': 'debug' },
    },
    version: '3.0.0',
    updatedAt: new Date().toISOString(),
  };
  writeFileSync(cfgPath(cwd), JSON.stringify(store, null, 2), 'utf-8');
  return store;
}

function readConfigJson(cwd) {
  return JSON.parse(readFileSync(cfgPath(cwd), 'utf-8'));
}

// ============================================================================
// 1. Unit: loadConfigStore() shape detection
// ============================================================================

describe('INV-6 loadConfigStore shape detection', () => {
  let cwd;
  let handle;

  beforeEach(() => {
    cwd = makeIsoCwd('load');
  });
  afterEach(() => {
    try { handle?.restore(); } catch {}
    try { rmSync(cwd, { recursive: true, force: true }); } catch {}
  });

  it('detects shape="legacy" when parsed JSON lacks values+scopes', async () => {
    writeInitShape(cwd);
    handle = await loadHandlersUnderCwd(cwd);
    const store = handle.mod.loadConfigStore();
    assert.equal(store.__shape, 'legacy',
      'init-generated nested tree must load as shape="legacy"');
    // In legacy mode, `store.values` IS the nested tree itself — not
    // wrapped, so nested walks against it find real values.
    assert.equal(
      (store.values.swarm).topology,
      'hierarchical-mesh',
      'legacy store.values must expose the nested tree directly',
    );
    // `scopes` is present but empty (init configs have no scope concept).
    assert.deepEqual(store.scopes, {},
      'legacy shape must synthesize an empty scopes map for handler compat');
  });

  it('detects shape="mcp" when parsed JSON has both values + scopes', async () => {
    writeMcpShape(cwd);
    handle = await loadHandlersUnderCwd(cwd);
    const store = handle.mod.loadConfigStore();
    assert.equal(store.__shape, 'mcp',
      'flat {values, scopes} config must load as shape="mcp"');
    assert.equal(store.values['swarm.topology'], 'mesh',
      'MCP values keyed by dotted string must survive round-trip');
    assert.equal(store.scopes.project['logging.level'], 'debug',
      'MCP scopes must be preserved verbatim');
  });

  it('returns shape="mcp" defaults when no config file exists', async () => {
    // No config.json on disk; loader must synthesize defaults in MCP shape
    handle = await loadHandlersUnderCwd(cwd);
    const store = handle.mod.loadConfigStore();
    assert.equal(store.__shape, 'mcp',
      'default-synthesized store must be MCP shape (matches pre-fix behaviour)');
    assert.equal(store.values['swarm.topology'], 'mesh',
      'defaults must include swarm.topology');
    assert.deepEqual(store.scopes, {},
      'default scopes must be an empty plain object');
  });

  it('treats a values-only-no-scopes shape as legacy (not mcp)', async () => {
    // A user who hand-wrote a config with only `values` (no scopes) looks
    // much more like a random tree than an MCP-store. Only BOTH keys being
    // present triggers the mcp branch. If one day this decision changes,
    // re-assess — but for now test the current heuristic.
    writeFileSync(
      cfgPath(cwd),
      JSON.stringify({ values: { a: 1 }, someOtherKey: true }, null, 2),
    );
    handle = await loadHandlersUnderCwd(cwd);
    const store = handle.mod.loadConfigStore();
    assert.equal(store.__shape, 'legacy',
      'values without scopes must load as legacy (the whole tree IS the values)');
  });
});

// ============================================================================
// 2. Unit: saveConfigStore() shape preservation
// ============================================================================

describe('INV-6 saveConfigStore shape preservation', () => {
  let cwd;
  let handle;

  beforeEach(() => { cwd = makeIsoCwd('save'); });
  afterEach(() => {
    try { handle?.restore(); } catch {}
    try { rmSync(cwd, { recursive: true, force: true }); } catch {}
  });

  it('legacy store round-trips to a nested JSON without a {values} wrapper', async () => {
    writeInitShape(cwd);
    handle = await loadHandlersUnderCwd(cwd);
    const store = handle.mod.loadConfigStore();
    assert.equal(store.__shape, 'legacy');
    // Mutate through the handler path: set a new nested key directly on
    // store.values (which IS the tree).
    store.values.newTopLevel = { subKey: 'saved-ok' };
    handle.mod.saveConfigStore(store);

    const persisted = readConfigJson(cwd);
    assert.equal(persisted.newTopLevel?.subKey, 'saved-ok',
      'legacy save must persist the nested mutation');
    assert.ok(!('values' in persisted && 'scopes' in persisted),
      `legacy save must NOT wrap the tree in {values, scopes}; got: ${Object.keys(persisted).join(',')}`);
    assert.ok(persisted.swarm?.topology === 'hierarchical-mesh',
      'legacy save must preserve unrelated nested keys');
    assert.ok(!('__shape' in persisted),
      'legacy save must NOT leak the __shape bookkeeping marker to disk');
  });

  it('mcp store round-trips to a flat {values, scopes} JSON', async () => {
    writeMcpShape(cwd);
    handle = await loadHandlersUnderCwd(cwd);
    const store = handle.mod.loadConfigStore();
    assert.equal(store.__shape, 'mcp');
    store.values['logging.level'] = 'trace';
    handle.mod.saveConfigStore(store);

    const persisted = readConfigJson(cwd);
    assert.ok('values' in persisted && 'scopes' in persisted,
      `mcp save must preserve the flat wrapper; got keys: ${Object.keys(persisted).join(',')}`);
    assert.equal(persisted.values['logging.level'], 'trace',
      'mcp save must persist the mutated flat value');
    assert.ok(!('__shape' in persisted),
      'mcp save must NOT leak the __shape bookkeeping marker to disk');
  });

  it('default-synthesized store persists as mcp shape', async () => {
    // No file on disk → defaults (mcp shape) → save should produce an
    // MCP-shaped file.
    handle = await loadHandlersUnderCwd(cwd);
    const store = handle.mod.loadConfigStore();
    assert.equal(store.__shape, 'mcp');
    store.values['swarm.topology'] = 'star';
    handle.mod.saveConfigStore(store);

    const persisted = readConfigJson(cwd);
    assert.ok('values' in persisted && 'scopes' in persisted,
      `defaulted save must emit MCP wrapper; got keys: ${Object.keys(persisted).join(',')}`);
    assert.equal(persisted.values['swarm.topology'], 'star');
  });
});

// ============================================================================
// 3. Integration: config_set → config_get round-trips through a nested tree
// ============================================================================

describe('INV-6 integration — nested init-generated config.json round-trip', () => {
  let cwd;
  let handle;

  beforeEach(() => { cwd = makeIsoCwd('inv6-nested'); });
  afterEach(() => {
    try { handle?.restore(); } catch {}
    try { rmSync(cwd, { recursive: true, force: true }); } catch {}
  });

  it('config_set foo.bar=baz writes into the nested tree and config_get reads it back', async () => {
    writeInitShape(cwd);
    handle = await loadHandlersUnderCwd(cwd);
    const setHandler = getHandler(handle.mod, 'config_set');
    const getHandler_ = getHandler(handle.mod, 'config_get');

    const setResult = await setHandler({ key: 'foo.bar', value: 'baz-inv6' });
    assert.equal(setResult.success, true, 'config_set must succeed');
    assert.equal(setResult.shape, 'legacy',
      'config_set must report shape=legacy so callers know the wire shape');

    const getResult = await getHandler_({ key: 'foo.bar' });
    assert.equal(getResult.value, 'baz-inv6',
      `config_get must return the value that config_set wrote (round-trip), got: ${JSON.stringify(getResult)}`);
    assert.equal(getResult.exists, true, 'config_get exists flag must be true');
    assert.equal(getResult.source, 'stored',
      'config_get must report source="stored" when the value was explicitly set');
  });

  it('the persisted file stays nested — no {values:..} wrapper, foo.bar is a real subtree', async () => {
    writeInitShape(cwd);
    handle = await loadHandlersUnderCwd(cwd);
    const setHandler = getHandler(handle.mod, 'config_set');
    await setHandler({ key: 'foo.bar', value: 'baz-inv6' });

    const persisted = readConfigJson(cwd);
    assert.ok(!('values' in persisted && 'scopes' in persisted),
      `nested config must NOT be re-written as {values, scopes}; got keys: ${Object.keys(persisted).join(',')}`);
    assert.equal(persisted.foo?.bar, 'baz-inv6',
      'config_set must write foo.bar as a real nested subtree, not a flat "foo.bar" key');
    assert.equal(persisted.swarm?.topology, 'hierarchical-mesh',
      'config_set must preserve unrelated init-generated values');
  });

  it('config_get on a pre-existing nested init key (swarm.topology) returns its value', async () => {
    // This path previously failed because loadConfigStore assumed flat,
    // so `store.values["swarm.topology"]` was undefined on the nested tree.
    writeInitShape(cwd);
    handle = await loadHandlersUnderCwd(cwd);
    const getHandler_ = getHandler(handle.mod, 'config_get');

    const result = await getHandler_({ key: 'swarm.topology' });
    assert.equal(result.value, 'hierarchical-mesh',
      'config_get must resolve dotted paths against the nested tree (regression fix)');
    assert.equal(result.exists, true);
  });

  it('config_get on a deep nested key (swarm.autoScale.enabled) resolves true', async () => {
    writeInitShape(cwd);
    handle = await loadHandlersUnderCwd(cwd);
    const getHandler_ = getHandler(handle.mod, 'config_get');
    const result = await getHandler_({ key: 'swarm.autoScale.enabled' });
    assert.equal(result.value, true,
      'getNestedValue must walk >1 level into the init tree');
  });

  it('config_set on an existing nested key overwrites the leaf, not the parent', async () => {
    writeInitShape(cwd);
    handle = await loadHandlersUnderCwd(cwd);
    const setHandler = getHandler(handle.mod, 'config_set');
    await setHandler({ key: 'swarm.maxAgents', value: 42 });

    const persisted = readConfigJson(cwd);
    assert.equal(persisted.swarm?.maxAgents, 42);
    assert.equal(persisted.swarm?.topology, 'hierarchical-mesh',
      'sibling keys must survive the set');
    assert.equal(persisted.swarm?.coordinationStrategy, 'consensus',
      'all sibling keys must survive the set');
  });
});

// ============================================================================
// 4. Integration: config_set → config_get round-trips through MCP-flat config
// ============================================================================

describe('INV-6 integration — flat MCP-shape config.json round-trip', () => {
  let cwd;
  let handle;

  beforeEach(() => { cwd = makeIsoCwd('inv6-mcp'); });
  afterEach(() => {
    try { handle?.restore(); } catch {}
    try { rmSync(cwd, { recursive: true, force: true }); } catch {}
  });

  it('config_set + config_get round-trips a flat dotted key under MCP shape', async () => {
    writeMcpShape(cwd);
    handle = await loadHandlersUnderCwd(cwd);
    const setHandler = getHandler(handle.mod, 'config_set');
    const getHandler_ = getHandler(handle.mod, 'config_get');

    const setResult = await setHandler({ key: 'my.custom.key', value: 'mcp-val' });
    assert.equal(setResult.success, true);
    assert.equal(setResult.shape, 'mcp',
      'config_set on an MCP-shape file must preserve shape=mcp');

    const getResult = await getHandler_({ key: 'my.custom.key' });
    assert.equal(getResult.value, 'mcp-val',
      `mcp round-trip must return the value; got: ${JSON.stringify(getResult)}`);
  });

  it('MCP-shape file retains {values, scopes} after a write', async () => {
    writeMcpShape(cwd);
    handle = await loadHandlersUnderCwd(cwd);
    const setHandler = getHandler(handle.mod, 'config_set');
    await setHandler({ key: 'my.custom.key', value: 'mcp-val' });

    const persisted = readConfigJson(cwd);
    assert.ok('values' in persisted && 'scopes' in persisted,
      `MCP config must keep its {values, scopes} wrapper; got keys: ${Object.keys(persisted).join(',')}`);
    assert.equal(persisted.values['my.custom.key'], 'mcp-val',
      'MCP values must store dotted keys flat (not as a nested subtree) to preserve existing semantics');
  });

  it('pre-existing MCP values remain resolvable after a set', async () => {
    writeMcpShape(cwd);
    handle = await loadHandlersUnderCwd(cwd);
    const setHandler = getHandler(handle.mod, 'config_set');
    const getHandler_ = getHandler(handle.mod, 'config_get');

    await setHandler({ key: 'new.key', value: 'added' });
    const topology = await getHandler_({ key: 'swarm.topology' });
    assert.equal(topology.value, 'mesh',
      'pre-existing flat MCP values must survive subsequent writes');
  });
});

// ============================================================================
// 5. Regression: check_p5_compat_config_set scenario
//   (init'd project + `config set test.p5key=p5-roundtrip` + verify file)
// ============================================================================

describe('INV-6 regression — check_p5_compat_config_set', () => {
  let cwd;
  let handle;

  beforeEach(() => { cwd = makeIsoCwd('p5-compat'); });
  afterEach(() => {
    try { handle?.restore(); } catch {}
    try { rmSync(cwd, { recursive: true, force: true }); } catch {}
  });

  it('setting test.p5key=p5-roundtrip on an init-shape file produces c.test.p5key', async () => {
    // Exactly mirrors the node one-liner in
    // lib/acceptance-init-generated-checks.sh:387
    //   node -e "const c=JSON.parse(require('fs').readFileSync('$cfg','utf-8'));
    //            console.log(c.test?.p5key)"
    // After the fix, that one-liner must print "p5-roundtrip".
    writeInitShape(cwd);
    handle = await loadHandlersUnderCwd(cwd);
    const setHandler = getHandler(handle.mod, 'config_set');
    await setHandler({ key: 'test.p5key', value: 'p5-roundtrip' });

    const c = readConfigJson(cwd);
    assert.equal(c.test?.p5key, 'p5-roundtrip',
      'check_p5_compat_config_set must observe c.test.p5key after the set');

    // The acceptance check also runs `config get` via the CLI — MCP
    // config_get must read the value back through the nested walk.
    const getHandler_ = getHandler(handle.mod, 'config_get');
    const r = await getHandler_({ key: 'test.p5key' });
    assert.equal(r.value, 'p5-roundtrip',
      'MCP config_get must see test.p5key after set — closes Phase 8 INV-6');
  });

  it('repeated set-get round-trips stay stable (no shape drift)', async () => {
    writeInitShape(cwd);
    handle = await loadHandlersUnderCwd(cwd);
    const setHandler = getHandler(handle.mod, 'config_set');
    const getHandler_ = getHandler(handle.mod, 'config_get');

    await setHandler({ key: 'a.b', value: 'v1' });
    await setHandler({ key: 'a.c', value: 'v2' });
    await setHandler({ key: 'd', value: 'v3' });

    const ab = await getHandler_({ key: 'a.b' });
    const ac = await getHandler_({ key: 'a.c' });
    const d = await getHandler_({ key: 'd' });
    assert.equal(ab.value, 'v1');
    assert.equal(ac.value, 'v2');
    assert.equal(d.value, 'v3');

    const c = readConfigJson(cwd);
    assert.deepEqual(
      { b: c.a?.b, c: c.a?.c },
      { b: 'v1', c: 'v2' },
      'siblings a.b / a.c must co-exist under the a subtree',
    );
    assert.equal(c.d, 'v3', 'top-level non-dotted key must be a scalar leaf');
    assert.ok(!('values' in c && 'scopes' in c),
      'repeated writes must never transform a legacy tree into MCP shape');
  });
});

// ============================================================================
// 6. Static source guards (regression fence)
// ============================================================================

describe('INV-6 static source guards — config-tools.ts shape logic', () => {
  const src = readFileSync(CONFIG_TOOLS_SRC, 'utf-8');

  it('detects both "mcp" and "legacy" shape identifiers', () => {
    assert.match(src, /['"]mcp['"]/,
      'source must reference the "mcp" shape literal');
    assert.match(src, /['"]legacy['"]/,
      'source must reference the "legacy" shape literal');
  });

  it('exports loadConfigStore and saveConfigStore (tests hook into them)', () => {
    assert.match(src, /export function loadConfigStore/,
      'loadConfigStore must be exported so tests can drive shape detection');
    assert.match(src, /export function saveConfigStore/,
      'saveConfigStore must be exported so tests can verify persisted shape');
  });

  it('records __shape on the returned store', () => {
    assert.match(src, /__shape:\s*['"]legacy['"]/,
      'loadConfigStore must set __shape="legacy" on legacy tree loads');
    assert.match(src, /__shape:\s*['"]mcp['"]/,
      'loadConfigStore must set __shape="mcp" on MCP-shape loads');
  });

  it('saveConfigStore branches on the legacy shape to avoid the {values,scopes} wrapper', () => {
    // The persistence branch must strip __shape and persist a bare tree
    // when shape === 'legacy'. Grep for a legacy branch that writes
    // store.values directly.
    assert.match(
      src,
      /shape\s*===?\s*['"]legacy['"][\s\S]*?\.\.\.store\.values|payload\s*=\s*\{\s*\.\.\.store\.values\s*\}/,
      'saveConfigStore must have a legacy branch that spreads store.values (no wrapper)',
    );
  });

  it('getNestedValue and setNestedValue are actually used (not orphaned)', () => {
    // Pre-fix: both helpers existed but no handler called them. The fix
    // must wire them in. Quick call-count check (>= 1 call in handler code).
    const getNestedCalls = (src.match(/getNestedValue\(/g) || []).length;
    const setNestedCalls = (src.match(/setNestedValue\(/g) || []).length;
    assert.ok(getNestedCalls >= 2,
      `getNestedValue must be called from handlers (found ${getNestedCalls} calls)`);
    assert.ok(setNestedCalls >= 2,
      `setNestedValue must be called from handlers (found ${setNestedCalls} calls)`);
  });

  it('does not leak __shape into persisted JSON (regression guard)', () => {
    // Grep: no top-level payload literal should include `__shape:`. The
    // legacy branch spreads `store.values` (pure tree, no bookkeeping),
    // and the MCP branch builds a fresh payload object that names its
    // keys explicitly — neither path serialises __shape.
    // We assert the explicit MCP payload shape whitelist.
    const mcpPayloadLit = src.match(/payload\s*=\s*\{[^}]*values:\s*store\.values[^}]*\}/);
    if (mcpPayloadLit) {
      assert.ok(!mcpPayloadLit[0].includes('__shape'),
        'MCP payload literal must not include __shape key');
    }
  });

  it('compiled dist exists and is fresher than the source (build artifact present)', () => {
    assert.ok(existsSync(CONFIG_TOOLS_DIST),
      `compiled dist must exist for integration tests to work: ${CONFIG_TOOLS_DIST}`);
    const distContent = readFileSync(CONFIG_TOOLS_DIST, 'utf-8');
    assert.match(distContent, /__shape/,
      'compiled dist must contain the shape-tolerant logic — rebuild after editing the .ts source');
  });
});

// ============================================================================
// 7. INV-6 follow-up — scope writes + reset on legacy shape (Phase 8 nits)
//   Researcher plan: docs/plans/adr0094-hive-20260417/phase8-review-nits-plan.md
//   BUG-A fix A2: scoped writes against a legacy (init-generated) config.json
//     fail loudly — legacy save cannot persist `store.scopes`, so silent
//     "success" would drop data on the next reload.
//   BUG-B fix B1: config_reset({}) on a legacy tree rebuilds defaults via
//     setNestedValue — no flat dotted top-level keys leak into the tree.
// ============================================================================

describe('INV-6 follow-up — scope + reset on legacy shape', () => {
  let cwd;
  let handle;

  beforeEach(() => { cwd = makeIsoCwd('inv6-nits'); });
  afterEach(() => {
    try { handle?.restore(); } catch {}
    try { rmSync(cwd, { recursive: true, force: true }); } catch {}
  });

  // --------------------------------------------------------------------------
  // BUG-A: scoped writes on legacy shape must fail loudly, not silently drop
  // --------------------------------------------------------------------------

  it('BUG-A #1: config_set scope=user on legacy returns success:false with scope error and does NOT touch the file', async () => {
    writeInitShape(cwd);
    const beforeBytes = readFileSync(cfgPath(cwd));
    handle = await loadHandlersUnderCwd(cwd);
    const setHandler = getHandler(handle.mod, 'config_set');

    const result = await setHandler({
      key: 'scoped.key',
      value: 'scopeval',
      scope: 'user',
    });
    assert.equal(result.success, false,
      'scoped write on legacy shape must fail loudly — saveConfigStore cannot persist store.scopes in legacy branch');
    assert.ok(
      typeof result.error === 'string' && /scope/i.test(result.error),
      `error message must mention scope; got: ${JSON.stringify(result)}`,
    );
    assert.equal(result.shape, 'legacy',
      'failing response must still report the detected shape so callers can remediate');

    // File bytes must be unchanged — the handler refused to write.
    const afterBytes = readFileSync(cfgPath(cwd));
    assert.ok(beforeBytes.equals(afterBytes),
      'legacy scoped-write refusal must NOT write anything to disk (byte-exact comparison)');

    // Belt-and-suspenders: the value must also not leak through config_get.
    const getHandler_ = getHandler(handle.mod, 'config_get');
    const getResult = await getHandler_({ key: 'scoped.key', scope: 'user' });
    assert.equal(getResult.exists, false,
      'refused scoped write must not materialize in-memory either');
  });

  it('BUG-A #2 (regression fence): config_set scope=default on legacy still succeeds', async () => {
    // Anti-regression: making scoped writes fail loudly must not break the
    // existing default-scope legacy happy-path.
    writeInitShape(cwd);
    handle = await loadHandlersUnderCwd(cwd);
    const setHandler = getHandler(handle.mod, 'config_set');

    const result = await setHandler({ key: 'foo.bar', value: 'baz-default' });
    assert.equal(result.success, true,
      'default-scope writes on legacy shape must continue to succeed');
    assert.equal(result.shape, 'legacy');

    const persisted = readConfigJson(cwd);
    assert.equal(persisted.foo?.bar, 'baz-default',
      'default-scope legacy write must persist nested');
  });

  it('BUG-A #3: config_set scope=user on MCP shape persists and reloads', async () => {
    // The fix only rejects scoped writes on LEGACY shape. MCP shape must
    // continue to accept scoped writes end-to-end (handler → save → reload).
    // Note: the handler writes dotted keys under a scope via setNestedValue,
    // so the on-disk shape is `scopes.user.api.endpoint`, not
    // `scopes.user["api.endpoint"]`. config_get recovers the value via the
    // same nested walk — so the contract users rely on is symmetrical set/get.
    writeMcpShape(cwd);
    handle = await loadHandlersUnderCwd(cwd);
    const setHandler = getHandler(handle.mod, 'config_set');
    const getHandler_ = getHandler(handle.mod, 'config_get');

    const setResult = await setHandler({
      key: 'api.endpoint',
      value: 'https://mcp.example.com',
      scope: 'user',
    });
    assert.equal(setResult.success, true,
      'scoped writes on MCP shape must still succeed (non-regression)');

    const persisted = readConfigJson(cwd);
    // Dotted-key scoped writes land as a nested subtree under the scope
    // (see config-tools.ts `if (key.includes('.')) setNestedValue(...)`).
    assert.equal(
      persisted.scopes?.user?.api?.endpoint,
      'https://mcp.example.com',
      'MCP scoped dotted-key write must persist as a nested subtree under scopes.user',
    );
    // MCP wrapper preservation sanity check.
    assert.ok('values' in persisted && 'scopes' in persisted,
      `MCP scoped write must keep the flat wrapper; got keys: ${Object.keys(persisted).join(',')}`);

    // Reload through the handler — config_get uses getNestedValue under the
    // scope, so the round-trip recovers the value end-to-end.
    const getResult = await getHandler_({ key: 'api.endpoint', scope: 'user' });
    assert.equal(getResult.value, 'https://mcp.example.com',
      `MCP scoped write must reload after persist (end-to-end round-trip); got: ${JSON.stringify(getResult)}`);
    assert.equal(getResult.source, 'scope',
      'config_get must report source="scope" when value was written to a named scope');

    // Non-dotted scoped write lands flat under scope (different code path).
    const flatResult = await setHandler({
      key: 'flatKey',
      value: 'flatVal',
      scope: 'user',
    });
    assert.equal(flatResult.success, true);
    const persisted2 = readConfigJson(cwd);
    assert.equal(persisted2.scopes?.user?.flatKey, 'flatVal',
      'non-dotted scoped writes must land flat under scope (unchanged semantics)');
  });

  // --------------------------------------------------------------------------
  // BUG-B: config_reset on legacy shape must produce a NESTED defaults tree
  // --------------------------------------------------------------------------

  it('BUG-B #1: config_reset({}) on legacy produces NESTED defaults (no dotted top-level keys)', async () => {
    writeInitShape(cwd);
    handle = await loadHandlersUnderCwd(cwd);
    const resetHandler = getHandler(handle.mod, 'config_reset');

    const result = await resetHandler({});
    assert.equal(result.success, true, 'config_reset must succeed');

    const persisted = readConfigJson(cwd);

    // The file must NOT have wrapper keys (still legacy shape).
    assert.ok(!('values' in persisted && 'scopes' in persisted),
      `config_reset must preserve legacy shape; got keys: ${Object.keys(persisted).join(',')}`);

    // Top-level keys must be identifiers — NEVER dotted strings like "swarm.topology".
    const dottedTopKeys = Object.keys(persisted).filter((k) => k.includes('.'));
    assert.deepEqual(
      dottedTopKeys,
      [],
      `config_reset must rebuild nested; found dotted top-level keys: ${dottedTopKeys.join(',')}`,
    );

    // Key values from DEFAULT_CONFIG must be reachable via nested walk.
    assert.equal(persisted.swarm?.topology, 'mesh',
      'DEFAULT_CONFIG "swarm.topology"="mesh" must land at c.swarm.topology (nested)');
    assert.equal(persisted.memory?.persistInterval, 60000,
      'DEFAULT_CONFIG "memory.persistInterval"=60000 must land at c.memory.persistInterval');
    assert.equal(persisted.security?.sandboxEnabled, true,
      'DEFAULT_CONFIG "security.sandboxEnabled"=true must land at c.security.sandboxEnabled');
  });

  it('BUG-B #2 (regression fence): config_reset({}) on MCP shape stays flat under {values}', async () => {
    // Anti-regression: the legacy-specific rebuild must not change the
    // existing MCP behaviour where values is a flat dotted map.
    writeMcpShape(cwd);
    handle = await loadHandlersUnderCwd(cwd);
    const resetHandler = getHandler(handle.mod, 'config_reset');

    const result = await resetHandler({});
    assert.equal(result.success, true);

    const persisted = readConfigJson(cwd);
    assert.ok('values' in persisted && 'scopes' in persisted,
      `MCP reset must preserve the {values, scopes} wrapper; got: ${Object.keys(persisted).join(',')}`);
    // MCP values keeps dotted keys flat — that's the pre-existing semantics.
    assert.equal(persisted.values['swarm.topology'], 'mesh',
      'MCP reset must keep flat dotted keys under values');
    assert.equal(persisted.values['memory.persistInterval'], 60000,
      'MCP reset must keep all DEFAULT_CONFIG entries under values');
  });

  it('BUG-B #3 (round-trip): config_get("swarm.topology") after legacy reset returns "mesh" via nested walk', async () => {
    // End-to-end: a legacy reset rebuilds nested, and the nested walk in
    // resolveValue (via getNestedValue) must find the defaulted value.
    writeInitShape(cwd);
    handle = await loadHandlersUnderCwd(cwd);
    const resetHandler = getHandler(handle.mod, 'config_reset');
    const getHandler_ = getHandler(handle.mod, 'config_get');

    await resetHandler({});

    const result = await getHandler_({ key: 'swarm.topology' });
    assert.equal(result.value, 'mesh',
      `post-reset nested-walk lookup must find swarm.topology="mesh"; got: ${JSON.stringify(result)}`);
    assert.equal(result.exists, true,
      'config_get must report exists=true for defaulted nested values');
    assert.equal(result.source, 'stored',
      'reset-seeded value should be read from the stored tree, not the legacy default map');

    // Also check a second key to confirm the rebuild covers the whole map.
    const logging = await getHandler_({ key: 'logging.format' });
    assert.equal(logging.value, 'json',
      'all DEFAULT_CONFIG keys must be reachable via nested walk post-reset');
  });

  // --------------------------------------------------------------------------
  // Edge case: reset on already-reset store is idempotent
  // --------------------------------------------------------------------------

  it('edge: repeated config_reset({}) on legacy is idempotent (byte-stable after the first reset)', async () => {
    // Idempotence guard: running reset twice in a row must produce a
    // byte-identical config.json (only updatedAt may differ, but legacy
    // persistence strips internal bookkeeping and the tree itself is a
    // pure function of DEFAULT_CONFIG).
    writeInitShape(cwd);
    handle = await loadHandlersUnderCwd(cwd);
    const resetHandler = getHandler(handle.mod, 'config_reset');

    await resetHandler({});
    const afterFirst = readConfigJson(cwd);

    await resetHandler({});
    const afterSecond = readConfigJson(cwd);

    assert.deepEqual(afterSecond, afterFirst,
      'repeated reset must yield the exact same nested tree (idempotent semantics)');
    // And the nested-key invariant still holds.
    assert.equal(afterSecond.swarm?.topology, 'mesh');
    assert.equal(
      Object.keys(afterSecond).filter((k) => k.includes('.')).length,
      0,
      'second reset must also produce zero dotted top-level keys',
    );
  });
});

// ============================================================================
// 8. INV-6 follow-up — source guards for BUG-A / BUG-B fixes
// ============================================================================

describe('INV-6 follow-up static guards — BUG-A + BUG-B source pins', () => {
  const src = readFileSync(CONFIG_TOOLS_SRC, 'utf-8');

  it('BUG-A: handler has a legacy+non-default-scope refusal branch', () => {
    // Any wording is fine as long as the refusal returns success:false with
    // an error mentioning "scope" AND is gated on __shape === 'legacy' AND
    // scope !== 'default'.
    assert.match(
      src,
      /scope\s*!==?\s*['"]default['"][\s\S]{0,200}__shape\s*===?\s*['"]legacy['"][\s\S]{0,400}success:\s*false/,
      'config_set must refuse legacy + non-default scope with success:false (BUG-A fix A2)',
    );
    assert.match(
      src,
      /error:\s*['"][^'"]*scope[^'"]*['"]/i,
      'refusal must include an error string mentioning "scope"',
    );
  });

  it('BUG-B: legacy reset rebuilds via setNestedValue (not Object.assign of flat DEFAULT_CONFIG)', () => {
    // The post-fix source must contain a loop that calls setNestedValue
    // with DEFAULT_CONFIG entries — AND the old flat Object.assign path
    // must be gone.
    assert.match(
      src,
      /for\s*\(\s*const\s*\[\s*k\s*,\s*v\s*\]\s*of\s*Object\.entries\(DEFAULT_CONFIG\)\)[\s\S]{0,200}setNestedValue\(store\.values,\s*k,\s*v\)/,
      'legacy reset branch must iterate DEFAULT_CONFIG with setNestedValue (BUG-B fix B1)',
    );
    assert.doesNotMatch(
      src,
      /Object\.assign\(store\.values,\s*DEFAULT_CONFIG\)/,
      'legacy reset must NOT use Object.assign(store.values, DEFAULT_CONFIG) — that injects flat dotted top-level keys',
    );
  });

  it('BUG-C: resolveValue JSDoc documents literal-dotted-key shadow precedence', () => {
    // One-line bundle: the @remarks block must call out the intentional
    // precedence so a future reader does not "fix" it.
    assert.match(
      src,
      /@remarks[\s\S]{0,300}literal dotted key[\s\S]{0,200}shadow[\s\S]{0,200}nested/i,
      'resolveValue JSDoc must document literal-dotted-key shadows nested walk (review §3)',
    );
  });
});

// ============================================================================
// 9. INV-6 follow-up — config_import legacy-shape rejection (BUG-A mirror)
//   Researcher plan: docs/plans/adr0094-hive-20260417/phase8-followups-plan.md
//   ITEM 1: config_import had the exact same class of bug as config_set BUG-A
//     — saveConfigStore's legacy branch persists only `store.values`, so a
//     scoped import against a legacy file would silently drop data on reload,
//     and a default-scope import carrying a top-level `scopes` key would
//     corrupt the nested tree. Fail loudly with success:false (ADR-0082).
// ============================================================================

describe('INV-6 follow-up — config_import rejects legacy+scope / legacy+scopes payload', () => {
  let cwd;
  let handle;

  beforeEach(() => { cwd = makeIsoCwd('inv6-import'); });
  afterEach(() => {
    try { handle?.restore(); } catch {}
    try { rmSync(cwd, { recursive: true, force: true }); } catch {}
  });

  it('ITEM-1 #1: config_import scope=user on legacy returns success:false and does NOT touch the file', async () => {
    writeInitShape(cwd);
    const beforeBytes = readFileSync(cfgPath(cwd));
    handle = await loadHandlersUnderCwd(cwd);
    const importHandler = getHandler(handle.mod, 'config_import');

    const result = await importHandler({
      config: { foo: 'bar' },
      scope: 'user',
    });
    assert.equal(result.success, false,
      'scoped import on legacy shape must fail loudly — saveConfigStore cannot persist store.scopes in legacy branch');
    assert.ok(
      typeof result.error === 'string' && /scope/i.test(result.error),
      `error message must mention scope; got: ${JSON.stringify(result)}`,
    );
    assert.equal(result.shape, 'legacy',
      'failing response must still report the detected shape so callers can remediate');

    // Byte-exact compare — the handler must not have written anything.
    const afterBytes = readFileSync(cfgPath(cwd));
    assert.ok(beforeBytes.equals(afterBytes),
      'legacy scoped-import refusal must NOT write anything to disk (byte-exact comparison)');
  });

  it('ITEM-1 #2: config_import scope=default on legacy WITHOUT scopes/values keys merges successfully', async () => {
    // The happy path: legacy + default scope + plain top-level config payload
    // should continue to work (Object.assign into store.values, which IS the
    // nested tree). This is the non-regression fence for the fix.
    writeInitShape(cwd);
    handle = await loadHandlersUnderCwd(cwd);
    const importHandler = getHandler(handle.mod, 'config_import');

    const result = await importHandler({
      config: { customTop: { nestedKey: 'imported-value' }, anotherKey: 42 },
    });
    assert.equal(result.success, true,
      'default-scope legacy import without scopes/values keys must continue to succeed');
    assert.equal(result.imported, 2, 'both top-level keys should count as imported');

    const persisted = readConfigJson(cwd);
    // Must stay nested (no {values, scopes} wrapper leaked in).
    assert.ok(!('values' in persisted && 'scopes' in persisted),
      `legacy import must preserve legacy shape; got keys: ${Object.keys(persisted).join(',')}`);
    assert.equal(persisted.customTop?.nestedKey, 'imported-value',
      'imported nested value must land in the tree');
    assert.equal(persisted.anotherKey, 42,
      'imported scalar must land at top level of the tree');
    // Unrelated init keys must survive the merge.
    assert.equal(persisted.swarm?.topology, 'hierarchical-mesh',
      'original init keys must survive the import merge');
  });

  it('ITEM-1 #3: config_import on MCP shape WITH scopes key in payload merges into store.scopes', async () => {
    // The fix only rejects `scopes`-carrying payloads when the on-disk shape is
    // LEGACY. An MCP-shape file can absorb a payload that includes a `scopes`
    // key; Object.assign at the store.values level handles it (pre-existing
    // MCP semantics — this test is the positive-direction regression fence).
    writeMcpShape(cwd);
    handle = await loadHandlersUnderCwd(cwd);
    const importHandler = getHandler(handle.mod, 'config_import');

    const result = await importHandler({
      config: {
        'new.mcp.key': 'mcp-val',
        scopes: { project: { 'extra.key': 'extra-val' } },
      },
    });
    assert.equal(result.success, true,
      'MCP-shape import must accept payloads even when they carry a literal "scopes" key at top level');

    const persisted = readConfigJson(cwd);
    // The MCP wrapper must stay.
    assert.ok('values' in persisted && 'scopes' in persisted,
      `MCP import must keep the flat wrapper; got keys: ${Object.keys(persisted).join(',')}`);
    // The new flat dotted key must have landed under values (Object.assign).
    assert.equal(persisted.values['new.mcp.key'], 'mcp-val',
      'MCP import must merge flat dotted keys into store.values');
    // The literal "scopes" key in the payload lands as a top-level values
    // entry under MCP semantics (pre-existing behaviour — documented here so
    // a future reader knows this is the MCP contract, distinct from legacy).
    assert.ok(persisted.values.scopes,
      'MCP import with a top-level "scopes" key in the payload lands it under store.values (pre-existing semantics)');
  });

  it('ITEM-1 #4: config_import scope=default on legacy WITH scopes key in payload refuses loudly', async () => {
    // The second failure mode (per researcher): a default-scope import whose
    // payload happens to carry a literal `scopes` key would otherwise get
    // Object.assign'd into the nested legacy tree as a top-level "scopes"
    // entry — corrupting the next shape-detect round and producing silent
    // drift. Refuse loudly so the caller knows to switch to MCP shape.
    writeInitShape(cwd);
    const beforeBytes = readFileSync(cfgPath(cwd));
    handle = await loadHandlersUnderCwd(cwd);
    const importHandler = getHandler(handle.mod, 'config_import');

    const result = await importHandler({
      config: { scopes: { user: { foo: 'bar' } } },
    });
    assert.equal(result.success, false,
      'legacy default-scope import with a "scopes" top-level key must fail loudly — would corrupt the nested tree');
    assert.equal(result.shape, 'legacy');
    assert.ok(
      typeof result.error === 'string' && /scope/i.test(result.error),
      `error message must mention scope; got: ${JSON.stringify(result)}`,
    );

    // Byte-exact: file unchanged.
    const afterBytes = readFileSync(cfgPath(cwd));
    assert.ok(beforeBytes.equals(afterBytes),
      'legacy import-refusal must NOT write anything to disk (byte-exact comparison)');
  });
});
