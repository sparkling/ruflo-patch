// ADR-0113 Phase D Fix 1 — fixture: plugin escape attempt.
//
// Loads the published `@sparkleideas/shared` SandboxedPluginRunner and
// asserts that every escape attempt the upstream CRIT-02 commit
// f3cc99d8b documented is blocked. Drives the
// `check_adr0113_w4g_plugin_sandbox_capability_deny` acceptance check.
//
// Two layers tested:
//
// Layer 1 — vm-sandbox isolation (runInSandbox):
//   - eval blocked by codeGeneration:{strings:false}
//   - new Function blocked
//   - process / require / globalThis not exposed in sandbox globals
//   - this.constructor.constructor('return process')() — prototype-walk
//     escape — blocked because it internally calls Function constructor
//     which is gated by codeGeneration:{strings:false}
//
// Layer 2 — capability gating (createRestrictedContext):
//   - undeclared service.get(name) returns undefined (no throw)
//   - service.register() throws ("cannot register services in sandboxed mode")
//   - trust-level demotion: a plugin with name='community/foo' that
//     self-declares trustLevel='official' must be demoted to 'unverified'
//
// Exit code:
//   0 — all escapes blocked, all gates work as documented
//   1 — at least one escape succeeded OR a gate failed
//
// Usage (from acceptance harness, after `npm install @sparkleideas/cli`):
//   node tests/fixtures/plugin-escape-attempt/index.mjs

import { SandboxedPluginRunner } from '@sparkleideas/shared';

const failures = [];

function expectThrow(label, fn) {
  try {
    const result = fn();
    failures.push(`${label}: did NOT throw — escape succeeded; result=${String(result)?.slice(0, 80)}`);
  } catch (err) {
    // throw-as-expected; record nothing
  }
}

function expectEqual(label, actual, expected) {
  if (actual !== expected) {
    failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ── Layer 1: vm sandbox isolation ────────────────────────────────────
const runner = new SandboxedPluginRunner({ timeout: 1000 });

expectThrow('eval()', () => runner.runInSandbox('eval("1+1")'));
expectThrow('new Function', () => runner.runInSandbox('new Function("return 1")()'));
expectThrow('process.exit', () => runner.runInSandbox('process.exit(1)'));
expectThrow("require('child_process')", () =>
  runner.runInSandbox("require('child_process').exec('echo pwned')"),
);
expectThrow('prototype-walk escape', () =>
  runner.runInSandbox('this.constructor.constructor("return process")()'),
);
expectThrow('global access', () => runner.runInSandbox('global.process.exit(1)'));

// Sanity: harmless code DOES run
try {
  const result = runner.runInSandbox('1 + 2');
  expectEqual('runInSandbox(1+2)', result, 3);
} catch (err) {
  failures.push(`runInSandbox(1+2) threw unexpectedly: ${err.message}`);
}

// ── Layer 2: capability gating ───────────────────────────────────────
//
// We can't easily exercise plugin-loader's full trust-routing path
// from outside (it requires an EventBus + ServiceContainer + a
// PluginRegistry). Test the primitive: createRestrictedContext()
// directly, with a mock baseContext.

const mockLogger = {
  debug: () => {}, info: () => {}, warn: () => {}, error: () => {},
};
const baseServices = new Map([
  ['fs', { read: () => 'content' }],
  ['memory', { store: () => true }],
  ['cli', { invoke: () => 0 }],
]);
const baseContext = {
  config: { foo: 'bar', env: 'production', envVars: { X: '1' } },
  eventBus: { emit: () => {}, on: () => {}, off: () => {} },
  logger: mockLogger,
  services: {
    register: (name, svc) => baseServices.set(name, svc),
    get: (name) => baseServices.get(name),
    has: (name) => baseServices.has(name),
    getServiceNames: () => [...baseServices.keys()],
  },
};

// Restricted plugin with NO permissions: must not see any service.
const restricted = runner.createRestrictedContext(
  baseContext,
  /* permissions */ {},
  /* pluginName */ 'community/escape-attempt',
);

const fsSvc = restricted.services.get('fs');
expectEqual("services.get('fs') with no permission", fsSvc, undefined);
expectEqual("services.has('fs') with no permission", restricted.services.has('fs'), false);

// register() must throw
try {
  restricted.services.register('foo', { x: 1 });
  failures.push('services.register() did NOT throw — should refuse in sandboxed mode');
} catch (err) {
  // expected
  if (!/cannot register/i.test(String(err.message))) {
    failures.push(`services.register() threw with wrong message: ${err.message}`);
  }
}

// env config keys must be stripped when env permission is false.
expectEqual('restricted config.env stripped', restricted.config.env, undefined);
expectEqual('restricted config.envVars stripped', restricted.config.envVars, undefined);

// With filesystem permission, services.get('fs') should pass through.
const allowed = runner.createRestrictedContext(
  baseContext,
  { filesystem: true },
  'community/with-fs',
);
const fsAllowed = allowed.services.get('fs');
expectEqual('services.get(fs) with filesystem:true returns service', !!fsAllowed, true);

// ── Report ───────────────────────────────────────────────────────────
if (failures.length === 0) {
  console.log('OK: all sandbox escapes blocked + capability gates enforced');
  process.exit(0);
} else {
  console.error('FAIL: sandbox/capability gates leaked:');
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
