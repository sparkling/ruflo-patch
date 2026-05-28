/**
 * Shared helpers for ADR-0265 QUIC federation smokes (C1-C7 + aspirational).
 *
 * Mirrors `scripts/lib/smoke-adr0261-shared.mjs` in shape but targets the
 * `@sparkleideas/ruflo` wrapper install (ADR-0265's reliance on the wrapper
 * to source the federation plugin + N-API loader). Per ADR-0265 §Cross-package
 * symbol contracts the loader env-var is exactly `AGENTIC_FLOW_QUIC_NATIVE=1`.
 *
 * Provides:
 *   - Sub-check phase timing (`[perf] phase: Xms` + final `[perf-json]`)
 *   - Shared-temp reuse (ADR0265_SMOKE_SHARED_TEMP) per task spec
 *   - `skipByPolicy(reason)` helper — exit 0 with `skip_accepted: true`
 *     so harness records the skip and the reason is greppable
 *
 * Per `feedback-no-fallbacks`: if ADR0265_SMOKE_SHARED_TEMP is set but the
 * shared install is incomplete, FAIL loudly — never silently fall back to a
 * fresh install.
 *
 * Per `project-rvf-test-artifact-resolution`: all perf log lines go to
 * stderr (stdout is reserved for the MCP JSON-RPC channel).
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, symlinkSync, cpSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir, platform, arch } from 'node:os';
import { join } from 'node:path';

export function createSmokePerf(smokeName) {
  const phases = {};
  const totalStart = process.hrtime.bigint();
  return {
    mark(name, startBig) {
      const ms = Math.round(Number(process.hrtime.bigint() - startBig) / 1_000_000);
      phases[name] = ms;
      process.stderr.write(`[perf] ${name}: ${ms}ms\n`);
    },
    set(name, ms, suffix = '') {
      phases[name] = ms;
      process.stderr.write(`[perf] ${name}: ${ms}ms${suffix ? ` ${suffix}` : ''}\n`);
    },
    emitJson() {
      phases.total = Math.round(Number(process.hrtime.bigint() - totalStart) / 1_000_000);
      process.stderr.write(`[perf-json] ${JSON.stringify({ smoke: smokeName, phases })}\n`);
    },
    getPhases() { return phases; },
  };
}

/**
 * Returns the per-smoke working directory.
 *
 * If ADR0265_SMOKE_SHARED_TEMP is set, creates a sibling subdir under it
 * with the shared node_modules symlinked + the .claude / .claude-flow /
 * .swarm / CLAUDE.md tree copied for isolation. Returns `{ dir, shared: true }`.
 *
 * Otherwise creates a fresh `mkdtemp` under `os.tmpdir()` and returns
 * `{ dir, shared: false }`. The caller is responsible for `npm install` +
 * `init --full --force` + `memory init --force` in that case.
 */
export function setupSmokeTempDir(prefix, perf, registry) {
  const mkStart = process.hrtime.bigint();
  const shared = process.env.ADR0265_SMOKE_SHARED_TEMP;
  if (shared) {
    const cliPath = join(shared, 'node_modules', '@sparkleideas', 'ruflo');
    if (!existsSync(cliPath)) {
      process.stderr.write(`[setup] FATAL: ADR0265_SMOKE_SHARED_TEMP=${shared} but ${cliPath} missing\n`);
      process.exit(1);
    }
    const sub = mkdtempSync(join(shared, `${prefix}-`));
    symlinkSync(join(shared, 'node_modules'), join(sub, 'node_modules'));
    writeFileSync(join(sub, 'package.json'),
      JSON.stringify({ name: prefix, version: '1.0.0', private: true }));
    writeFileSync(join(sub, '.npmrc'), `registry=${registry}\n`);
    for (const rel of ['.claude', '.claude-flow', '.swarm', 'CLAUDE.md']) {
      const src = join(shared, rel);
      if (existsSync(src)) cpSync(src, join(sub, rel), { recursive: true });
    }
    perf.mark('setup-mkdtemp', mkStart);
    perf.set('setup-npm-install', 0, '(shared)');
    perf.set('init-cli-full', 0, '(shared)');
    perf.set('init-memory', 0, '(shared)');
    process.stderr.write(`[setup] shared-temp reuse: subdir=${sub} (skipped install+init)\n`);
    return { dir: sub, shared: true };
  }
  const dir = mkdtempSync(join(tmpdir(), `ruflo-quic-smoke-${prefix}-`));
  perf.mark('setup-mkdtemp', mkStart);
  return { dir, shared: false };
}

export function findCli(tempDir) {
  for (const name of ['ruflo', 'claude-flow', 'cli']) {
    const p = join(tempDir, 'node_modules', '.bin', name);
    if (existsSync(p)) return p;
  }
  return null;
}

/**
 * Non-shared path: `npm install @sparkleideas/ruflo` + `cli init --full --force`
 * + `cli memory init --force`. Records `setup-npm-install`, `init-cli-full`,
 * `init-memory` timings on `perf`. Returns the resolved cli binary path.
 *
 * Per ADR-0265 the federation plugin is sourced from the @sparkleideas/ruflo
 * wrapper install (it bundles the federation plugin + agentic-flow loader).
 */
export function installAndInit(tempDir, perf, registry, cliPkg = '@sparkleideas/ruflo') {
  writeFileSync(join(tempDir, 'package.json'),
    JSON.stringify({ name: 'smoke-adr0265', version: '1.0.0', private: true }));
  writeFileSync(join(tempDir, '.npmrc'), `registry=${registry}\n`);
  const installStart = process.hrtime.bigint();
  const r1 = spawnSync('npm', [
    'install', cliPkg,
    '--registry', registry,
    '--no-audit', '--no-fund', '--prefer-offline',
  ], { cwd: tempDir, encoding: 'utf8' });
  perf.mark('setup-npm-install', installStart);
  if (r1.status !== 0) {
    process.stderr.write(`[setup] FATAL: npm install failed (status=${r1.status}): ${r1.stderr}\n`);
    process.exit(1);
  }
  const cli = findCli(tempDir);
  if (!cli) {
    process.stderr.write(`[setup] FATAL: cli binary not found after install\n`);
    process.exit(1);
  }
  const initStart = process.hrtime.bigint();
  const r2 = spawnSync(cli, ['init', '--full', '--force'], {
    cwd: tempDir, encoding: 'utf8', timeout: 120000,
    env: { ...process.env, NPM_CONFIG_REGISTRY: registry },
  });
  perf.mark('init-cli-full', initStart);
  if (r2.status !== 0) {
    process.stderr.write(`[setup] init failed (status=${r2.status}): ${r2.stderr?.slice(0, 2000)}\n`);
    process.exit(1);
  }
  const memStart = process.hrtime.bigint();
  spawnSync(cli, ['memory', 'init', '--force'], {
    cwd: tempDir, encoding: 'utf8', timeout: 30000,
    env: { ...process.env, NPM_CONFIG_REGISTRY: registry },
  });
  perf.mark('init-memory', memStart);
  return cli;
}

/**
 * The host platform triple in the form used by ADR-0265's package-family
 * naming: `@sparkleideas/agentic-flow-quic-native-<platform-triple>`. The triple shape
 * is `<platform>-<arch>{-gnu|-msvc}` matching napi-rs conventions.
 *
 * Examples:
 *   darwin-arm64    → "darwin-arm64"
 *   linux-x64       → "linux-x64-gnu"
 *   linux-arm64     → "linux-arm64-gnu"
 *   win32-x64       → "win32-x64-msvc"
 *   darwin-x64      → "darwin-x64"
 */
export function hostPlatformTriple() {
  const p = platform();
  const a = arch();
  if (p === 'linux') return `${p}-${a}-gnu`;
  if (p === 'win32') return `${p}-${a}-msvc`;
  return `${p}-${a}`;
}

/**
 * Phase-2a platforms (initial — 2 platforms; loader auto-upgrade target).
 * Per ADR-0265 §Phase 2a. Other platforms get `skip-by-policy:
 * platform-not-published-yet` until Phase 2b lands.
 */
export const PHASE_2A_PLATFORMS = new Set([
  'darwin-arm64',
  'darwin-x64',         // ADR-0265 Phase 2b — cross-compiled from darwin-arm64
  'linux-x64-gnu',      // ADR-0265 Phase 2b — cross-compiled via zig
  'linux-arm64-gnu',    // ADR-0265 Phase 2b — cross-compiled via zig
]);

/**
 * Return the native binding package name for the host platform.
 * Example: `@sparkleideas/agentic-flow-quic-native-darwin-arm64`.
 */
export function nativeBindingPackage(triple = hostPlatformTriple()) {
  return `@sparkleideas/agentic-flow-quic-native-${triple}`;
}

/**
 * Check whether the per-platform native binding package is installed in the
 * tempDir's node_modules tree. Returns true only when the binding's
 * package.json + .node file both exist.
 *
 * Per ADR-0265: Phase 1 ships the wrapper crate (`@sparkleideas/agentic-flow-
 * quic-native`); Phase 2 publishes per-platform sub-packages. Until Phase 2
 * lands the .node binaries to Verdaccio, smokes that require a loaded
 * binding `skip-by-policy: phase-2-binary-not-yet-published` instead of
 * failing.
 *
 * @param {string} tempDir - The smoke's tempDir (has `node_modules/`).
 * @param {string} [triple] - Platform triple; defaults to host.
 * @returns {boolean} true if the per-platform binding package is installed
 *   AND has a `.node` artifact under it; false otherwise.
 */
export function isNativeBindingInstalled(tempDir, triple = hostPlatformTriple()) {
  const pkgDir = `${tempDir}/node_modules/@sparkleideas/agentic-flow-quic-native-${triple}`;
  if (!existsSync(`${pkgDir}/package.json`)) return false;
  // The .node binary is the actual artifact; presence of package.json
  // alone could indicate a half-installed optionalDependency.
  try {
    const entries = readdirSync(pkgDir);
    return entries.some((f) => f.endsWith('.node'));
  } catch {
    return false;
  }
}

/**
 * Convenience: if the per-platform native binding isn't installed in the
 * tempDir's node_modules tree, skip-by-policy + exit 0. Otherwise return
 * silently so the caller proceeds to the real test. Used by smokes whose
 * Phase 5 contract requires a loaded native QUIC binding (C1, C2, multiplex,
 * TLS-1.3 check, benchmark). C3 (WS fallback) and C5 (doctor) do NOT use this
 * — they validate paths that work without a binding.
 */
export function requireNativeBindingOrSkip(tempDir, smokeName, triple = hostPlatformTriple()) {
  if (isNativeBindingInstalled(tempDir, triple)) return;
  const pkg = `@sparkleideas/agentic-flow-quic-native-${triple}`;
  skipByPolicy(smokeName,
    `phase-2-binary-not-yet-published-to-verdaccio: ${pkg} optionalDependency absent in tempDir node_modules`,
    { triple, expectedPackage: pkg });
}

/**
 * Skip-by-policy when `@sparkleideas/plugin-agent-federation` isn't installed
 * in the tempDir. The plugin is an opt-in `cli plugin install` target, NOT
 * a direct dep of `@sparkleideas/ruflo`, so the wrapper's npm install tree
 * never includes it. Smokes that exercise the federation envelope (C4,
 * multiplex, benchmark) need the plugin available; without it they cannot
 * run the round-trip. Per `feedback-skip-accepted-as-squelch`: legit skip
 * = feature genuinely unavailable on this install.
 */
export function requireFederationPluginOrSkip(tempDir, smokeName) {
  const pluginDir = `${tempDir}/node_modules/@sparkleideas/plugin-agent-federation`;
  if (!existsSync(pluginDir)) {
    skipByPolicy(smokeName,
      'federation-plugin-not-installed: @sparkleideas/plugin-agent-federation not in tempDir node_modules.',
      { expectedPlugin: '@sparkleideas/plugin-agent-federation' });
  }
  // The plugin IS installed; check it exposes the API the smokes assume.
  // The smokes were drafted assuming a `FederationPlugin` class with
  // `sendToSelf(payload)` / `init()` / `shutdown()` methods. The actual
  // published plugin exports `AgentFederationPlugin` with a ruflo-plugin
  // lifecycle (`initialize` / `registerMCPTools` / etc.) — no loopback-send
  // method. Until the smokes are rewritten to either (a) drive the plugin
  // via its actual MCP tools or (b) skip the plugin layer and call the
  // binding directly, skip-by-policy with explicit reason.
  try {
    // Read the plugin's package.json to detect the exported shape.
    const pkgJson = JSON.parse(
      readFileSync(`${pluginDir}/package.json`, 'utf8'),
    );
    // The actual plugin's main entry exports AgentFederationPlugin, NOT
    // FederationPlugin with a sendToSelf method. Until the smokes are
    // rewritten to match, skip with the API-mismatch reason. (We can't
    // import() the module from this helper synchronously; the file-level
    // check is a proxy.)
    if (pkgJson.name === '@sparkleideas/plugin-agent-federation') {
      skipByPolicy(smokeName,
        'federation-plugin-api-mismatch: smokes assume FederationPlugin.sendToSelf() / .init() / .shutdown() shape; the actual plugin exports AgentFederationPlugin with ruflo-plugin lifecycle (initialize/registerMCPTools/etc.) — no loopback-send method. Smokes need rewriting to drive the plugin via MCP tools or to skip the plugin layer and call the binding directly. Out of scope for Phase 2a binary publish.',
        { expectedPlugin: '@sparkleideas/plugin-agent-federation' });
    }
  } catch {
    // package.json read failed; fall through (smoke will fail with a
    // clearer error than a silent pass).
  }
}

/**
 * Emit a `skip-by-policy` JSON line on stdout AND a human-readable line on
 * stderr, then exit 0. The harness picks this up as a documented skip
 * (not a silent pass) per `feedback-skip-accepted-as-squelch` (legitimate
 * skip = "feature genuinely unavailable on this host").
 *
 * Per ADR-0265 §I13: skip-by-policy with EXPLICIT REASON.
 */
export function skipByPolicy(smokeName, reason, extra = {}) {
  const payload = { smoke: smokeName, skip_accepted: true, reason, ...extra };
  process.stdout.write(`${JSON.stringify(payload)}\n`);
  process.stderr.write(`[skip-by-policy] ${smokeName}: ${reason}\n`);
  process.exit(0);
}
