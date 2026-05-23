// @tier pipeline
// ADR-0207 — daemon-state contract + daemon restart flow (source-contract tests).
//
// Closes the R1 fix-forward coverage gap. R1 (fe6f7f878 + 0799eb19f) landed
// the source-side ADR-0207 changes, but three confirmations had no test:
//
//   Gap A.1 — Confirmation #3: `saveState()` writes ADR-0207's new authoritative
//             signals (`aiMode`, `uptimeSec`, `lastTick`) to daemon-state.json.
//             The `daemon status` CLI reads these instead of re-running
//             `which claude` in the CLI process (F-10-006 fix).
//
//   Gap A.2 — Confirmation #4: status reader is `bgRunning`-gated. When the
//             daemon is alive, read aiMode from daemon-state.json; when dead,
//             fall through to the live `which claude` probe so a stale state
//             file is NEVER reported as current.
//
//   Gap B   — Confirmation #2: `daemon restart` (F-10-004) is CLI-side
//             stop+start: capture `oldPid` from the PID file, stop, grace
//             window, `startBackgroundDaemon`, log `oldPid → newPid`.
//             No in-daemon RPC, no self-restart-before-exit window.
//
// Pipeline-tier source-contract style (same pattern as
// `daemon-queue-lifecycle.test.mjs`'s producer↔consumer contract checks):
// read the fork source via fs + regex/string-match. No `WorkerDaemon` import
// (the pre-existing agentdb/archivist resolution blocker is sidestepped).
//
// Mutation evidence (run before commit, NOT committed):
//   * Removing `aiMode` from saveState() write block → Gap A.1 RED.
//   * Replacing the `bgRunning` gate with `true` in status reader → Gap A.2 RED.
//   * Commenting out `startBackgroundDaemon(...)` in restartCommand → Gap B RED.
// All three mutations were verified RED and restored before commit.

import { describe, it, before } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PATCH_ROOT = resolve(__dirname, '..', '..');
// Fork source roots (siblings of ruflo-patch on disk).
const FORK_ROOT = resolve(PATCH_ROOT, '..', 'forks', 'ruflo');
const WORKER_DAEMON_SRC = resolve(
  FORK_ROOT,
  'v3', '@claude-flow', 'cli', 'src', 'services', 'worker-daemon.ts',
);
const CMD_DAEMON_SRC = resolve(
  FORK_ROOT,
  'v3', '@claude-flow', 'cli', 'src', 'commands', 'daemon.ts',
);

// ---------------------------------------------------------------------------
// Helper: extract a function body by name. Returns the substring from the
// opening `{` of the matching signature to the (best-effort) matching `}`.
//
// We match by signature pattern and then walk brace depth to find the
// terminator. This keeps the regexes simple while still scoping each
// assertion to the *intended* function body, so a coincidental match in
// some unrelated function elsewhere in the same file cannot accidentally
// keep an assertion green.
// ---------------------------------------------------------------------------
function extractFnBody(source, signatureRegex) {
  const sigMatch = source.match(signatureRegex);
  if (!sigMatch) return null;
  const openIdx = source.indexOf('{', sigMatch.index + sigMatch[0].length - 1);
  if (openIdx === -1) return null;
  let depth = 0;
  for (let i = openIdx; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return source.slice(openIdx + 1, i);
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Gap A.1 — saveState() writes the ADR-0207 fields (Confirmation #3).
// ---------------------------------------------------------------------------

describe('ADR-0207 Confirmation #3 — saveState() persists aiMode + uptimeSec + lastTick', () => {
  let saveStateBody = '';

  before(() => {
    assert.ok(existsSync(WORKER_DAEMON_SRC), `source not found: ${WORKER_DAEMON_SRC}`);
    const src = readFileSync(WORKER_DAEMON_SRC, 'utf-8');
    // Match `private saveState(): void {` (and variants).
    const body = extractFnBody(src, /private\s+saveState\s*\([^)]*\)\s*:\s*\w+\s*\{/);
    assert.ok(body, 'saveState() body must be locatable in worker-daemon.ts');
    saveStateBody = body;
  });

  it('saveState() write block names `aiMode` as a serialized field', () => {
    // The state object literal carries the new field; regex matches the
    // object-property shape `aiMode:` so a mere `_aiMode` reference (in a
    // log line or comment) cannot keep the test green.
    assert.match(
      saveStateBody,
      /\baiMode\s*:/,
      'ADR-0207 Confirmation #3: saveState() must write `aiMode` into daemon-state.json',
    );
  });

  it('saveState() write block names `uptimeSec` as a serialized field', () => {
    assert.match(
      saveStateBody,
      /\buptimeSec\b/,
      'ADR-0207 Confirmation #3: saveState() must compute + write `uptimeSec`',
    );
  });

  it('saveState() write block names `lastTick` as a serialized field', () => {
    assert.match(
      saveStateBody,
      /\blastTick\s*:/,
      'ADR-0207 Confirmation #3: saveState() must write `lastTick` into daemon-state.json',
    );
  });

  it('saveState() still writes through an atomic tmp+rename (regression guard)', () => {
    // Not the gap-A concern, but the new fields are only useful if persistence
    // remains atomic. One assertion guards the surrounding contract.
    assert.match(
      saveStateBody,
      /\.tmp/,
      'saveState() must write to a .tmp file (atomic rename pattern)',
    );
    assert.match(
      saveStateBody,
      /renameSync/,
      'saveState() must rename(.tmp -> stateFile) to commit atomically',
    );
  });
});

// ---------------------------------------------------------------------------
// Gap A.2 — status reader is bgRunning-gated; stale state file is NEVER trusted
//           when the daemon is dead (Confirmation #4).
// ---------------------------------------------------------------------------

describe('ADR-0207 Confirmation #4 — status reader gates on bgRunning, falls through when dead', () => {
  let statusBody = '';

  before(() => {
    assert.ok(existsSync(CMD_DAEMON_SRC), `source not found: ${CMD_DAEMON_SRC}`);
    const src = readFileSync(CMD_DAEMON_SRC, 'utf-8');
    // The status reader lives in `statusCommand`'s action — we scope to that.
    // The signature is `const statusCommand: Command = { ... action: async (...) => { ... } }`.
    // The aiMode-resolution block is inside that action; extracting the whole
    // statusCommand object literal gives us a tight scope.
    const idx = src.indexOf('const statusCommand');
    assert.ok(idx >= 0, 'statusCommand declaration must exist in daemon.ts');
    // Slice from statusCommand to the next top-level `const ` declaration to
    // bound the scope. The file uses one top-level `const <name>: Command` per
    // subcommand, so the next match terminates the slice cleanly.
    const tail = src.slice(idx + 'const statusCommand'.length);
    const nextDecl = tail.search(/\n(?:const|function|export)\s/);
    statusBody = nextDecl === -1 ? tail : tail.slice(0, nextDecl);
  });

  it('status reader gates the state-file read on `bgRunning` (conditional, not unconditional)', () => {
    // The contract: `daemon-state.json` is only read when the daemon process
    // is alive (`bgRunning`). The gate must be a CONDITIONAL `if (bgRunning)`
    // (or `else if (bgRunning)`) — not `if (true)`, not unconditional, not
    // a different variable.
    assert.match(
      statusBody,
      /\bbgRunning\b/,
      'ADR-0207 Confirmation #4: status reader must check `bgRunning` before reading state file',
    );
    assert.match(
      statusBody,
      /daemon-state\.json/,
      'status reader must reference daemon-state.json by name',
    );
    // Pin the conditional gate shape exactly: `else if (bgRunning) {`.
    assert.match(
      statusBody,
      /\belse\s+if\s*\(\s*bgRunning\s*\)\s*\{/,
      'ADR-0207 Confirmation #4: the state-file branch must be guarded by `else if (bgRunning) { ... }` (not a constant gate, not unconditional)',
    );
    // Pin that the state-file READ happens INSIDE the `else if (bgRunning)`
    // block — i.e. between the gate's opening `{` and the matching `}`.
    // Walk brace depth from the gate's `{` and assert daemon-state.json
    // appears before depth returns to 0. This catches a mutation that
    // moves the read outside the gate (e.g. above it, or into an unrelated
    // else branch).
    const gateMatch = statusBody.match(/\belse\s+if\s*\(\s*bgRunning\s*\)\s*\{/);
    assert.ok(gateMatch, 'gate match must succeed for brace-walk');
    const gateStart = gateMatch.index + gateMatch[0].length;
    let depth = 1;
    let sawFile = false;
    for (let i = gateStart; i < statusBody.length && depth > 0; i++) {
      const ch = statusBody[i];
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      if (depth > 0 && statusBody.startsWith('daemon-state.json', i)) {
        sawFile = true;
      }
    }
    assert.ok(
      sawFile,
      'ADR-0207 Confirmation #4: `daemon-state.json` read must live INSIDE the `else if (bgRunning) {...}` block',
    );
  });

  it('status reader falls through to live `which claude` probe when daemon is dead', () => {
    // The fall-through branch runs `which claude` via execSync — when no live
    // daemon, we DO NOT trust a stale state file. The probe must be present
    // OUTSIDE the bgRunning branch (i.e. in the else / fall-through).
    assert.match(
      statusBody,
      /which claude/,
      'ADR-0207 Confirmation #4: status reader must fall through to `which claude` probe when daemon is dead',
    );
    assert.match(
      statusBody,
      /execSync/,
      'fall-through probe must invoke execSync to run the live probe',
    );
    // The reader must have at least TWO occurrences of the live-probe pattern:
    // one inside the bgRunning branch (when state file is unreadable) and one
    // in the else (no-live-daemon) branch. ADR-0207 calls out both: the inner
    // catch falls through, and the outer else does the same. The shape is:
    //   if (status.running && ...) { ... }
    //   else if (bgRunning) { try { read state } catch { which claude } if (state==null) which claude }
    //   else { which claude }
    // Two distinct execSync('which claude') call sites is the lower bound.
    const probeMatches = statusBody.match(/execSync\(\s*['"]which claude['"]/g) || [];
    assert.ok(
      probeMatches.length >= 2,
      `expected ≥2 execSync('which claude') sites (bgRunning fall-through + dead-daemon else), found ${probeMatches.length}`,
    );
  });

  it('status reader treats unparseable state file as missing (defensive read)', () => {
    // The `try { … } catch { /* fall through */ }` around the readFileSync +
    // JSON.parse is critical: a partial write or corrupt file must NOT crash
    // the status command. ADR-0207 docblock calls this out explicitly.
    assert.match(
      statusBody,
      /readFileSync[\s\S]{0,200}JSON\.parse/,
      'state file read must combine readFileSync + JSON.parse (defensive shape)',
    );
    assert.match(
      statusBody,
      /try\s*\{[\s\S]*?readFileSync[\s\S]*?\}\s*catch/,
      'state file read must be wrapped in try/catch (unreadable state ≠ crash)',
    );
  });
});

// ---------------------------------------------------------------------------
// Gap B — daemon restart flow: oldPid → stop → grace → start → newPid
//         (Confirmation #2).
// ---------------------------------------------------------------------------

// Strip single-line and block comments from TS source. The Gap B assertions
// look for executable call sites — a commented-out call is a regression and
// must NOT keep the assertion green. (Same shape as the comment-stripper in
// adr0088-dead-code-removal.test.mjs T4.)
function stripComments(src) {
  // Remove /* ... */ block comments first (non-greedy, multi-line).
  let out = src.replace(/\/\*[\s\S]*?\*\//g, '');
  // Then strip // comments to end-of-line.
  out = out
    .split('\n')
    .map(line => {
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) return '';
      const idx = line.indexOf('//');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n');
  return out;
}

describe('ADR-0207 Confirmation #2 — daemon restart is CLI-side stop+start with PID rotation', () => {
  let restartBody = '';

  before(() => {
    assert.ok(existsSync(CMD_DAEMON_SRC), `source not found: ${CMD_DAEMON_SRC}`);
    const src = readFileSync(CMD_DAEMON_SRC, 'utf-8');
    const idx = src.indexOf('const restartCommand');
    assert.ok(idx >= 0, 'restartCommand declaration must exist in daemon.ts');
    const tail = src.slice(idx + 'const restartCommand'.length);
    const nextDecl = tail.search(/\n(?:const|function|export)\s/);
    const rawBody = nextDecl === -1 ? tail : tail.slice(0, nextDecl);
    // Assertions look for EXECUTABLE call sites — strip comments so a
    // commented-out call cannot keep an assertion green.
    restartBody = stripComments(rawBody);
  });

  it('captures `oldPid` from the PID file before stopping', () => {
    // `getBackgroundDaemonPid(projectRoot)` reads the daemon's PID file. The
    // restart flow must call this BEFORE stopping (the PID file is unlinked
    // by the stop sequence; capturing after stop would always return null).
    assert.match(
      restartBody,
      /\boldPid\s*=\s*getBackgroundDaemonPid\s*\(/,
      'ADR-0207 Confirmation #2: restart must assign `oldPid = getBackgroundDaemonPid(...)` (capture BEFORE stop)',
    );
  });

  it('runs the existing stop sequence (stopDaemon + killBackgroundDaemon + killStaleDaemons)', () => {
    // Mirrors stopCommand's path — keeps the surface unchanged.
    assert.match(
      restartBody,
      /\bstopDaemon\s*\(/,
      'restart flow must call stopDaemon() (in-process stop)',
    );
    assert.match(
      restartBody,
      /\bkillBackgroundDaemon\s*\(/,
      'restart flow must call killBackgroundDaemon(projectRoot)',
    );
    assert.match(
      restartBody,
      /\bkillStaleDaemons\s*\(/,
      'restart flow must call killStaleDaemons(projectRoot, ...)',
    );
  });

  it('waits a configurable grace window between stop and start', () => {
    // Grace window: setTimeout-based promise. The flag is `--grace-ms`; the
    // implementation parses it as `graceMs` and awaits a setTimeout-promise.
    assert.match(
      restartBody,
      /\bgraceMs\b/,
      'restart must declare/parse `graceMs` (the configurable grace window)',
    );
    assert.match(
      restartBody,
      /setTimeout\s*\(/,
      'restart must `setTimeout(...)` for the grace window',
    );
    // The wait must be `await`ed (a fire-and-forget setTimeout would not
    // create the serialization the ADR requires).
    assert.match(
      restartBody,
      /await\s+new\s+Promise[\s\S]{0,80}setTimeout/,
      'grace window must be `await new Promise(resolve => setTimeout(resolve, graceMs))`',
    );
  });

  it('spawns a fresh background daemon via startBackgroundDaemon', () => {
    // The startBackgroundDaemon call is the actual "new daemon" step. This is
    // the load-bearing assertion: if the call is removed (mutation 3), the
    // restart flow silently stops without starting and the test must go RED.
    assert.match(
      restartBody,
      /\bstartBackgroundDaemon\s*\(/,
      'ADR-0207 Confirmation #2: restart must call startBackgroundDaemon(...) to spawn the new daemon',
    );
  });

  it('captures `newPid` after start and logs both oldPid + newPid', () => {
    assert.match(
      restartBody,
      /\bnewPid\s*=\s*getBackgroundDaemonPid\s*\(/,
      'restart must assign `newPid = getBackgroundDaemonPid(...)` (capture AFTER start)',
    );
    // The success report MUST surface both PIDs — that's how the user / the
    // caller verifies the rotation actually happened.
    assert.match(
      restartBody,
      /oldPid[\s\S]{0,80}newPid/,
      'restart success message must reference both oldPid and newPid (PID rotation)',
    );
  });

  it('does NOT introduce a self-restart-before-exit window (regression guard)', () => {
    // ADR-0207 explicitly states: "no in-daemon RPC, no socket" — the restart
    // is CLI-side. A self-restart channel would re-introduce the F-10-007
    // spawn-race surface. Negative assertion: no daemon-side restart RPC.
    assert.doesNotMatch(
      restartBody,
      /daemon-ipc/i,
      'restart must NOT route through daemon-ipc (the deleted IPC layer)',
    );
    assert.doesNotMatch(
      restartBody,
      /DaemonIPCServer/,
      'restart must NOT reference DaemonIPCServer (deleted class per ADR-0207)',
    );
  });
});
