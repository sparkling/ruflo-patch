#!/usr/bin/env node
/**
 * Claude Flow Hook Handler (Cross-Platform, ESM)
 * Dispatches hook events to the appropriate helper modules.
 *
 * ADR-0085: Converted from CJS to ESM to unblock intelligence.cjs
 * from using dynamic import() for direct SQLite access, eliminating
 * the auto-memory-store.json sidecar file.
 *
 * Usage: node hook-handler.mjs <command> [args...]
 *
 * Commands:
 *   route          - Route a task to optimal agent (reads PROMPT from env/stdin)
 *   pre-bash       - Validate command safety before execution
 *   post-edit      - Record edit outcome for learning
 *   session-restore - Restore previous session state
 *   session-end    - End session and persist state
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const helpersDir = __dirname;

// Safe import with stdout suppression — helper modules may have side effects.
// ESM import() is async, which is fine since main() is already async.
async function safeImport(modulePath) {
  try {
    if (fs.existsSync(modulePath)) {
      const origLog = console.log;
      const origError = console.error;
      console.log = () => {};
      console.error = () => {};
      try {
        const mod = await import(modulePath);
        return mod.default || mod;
      } finally {
        console.log = origLog;
        console.error = origError;
      }
    }
  } catch {
    // silently fail
  }
  return null;
}

// ADR-0312: prefer .cjs (explicit CommonJS), fall back to legacy .js.
const resolveHelper = (base) => {
  const cjs = path.join(helpersDir, base + '.cjs');
  return fs.existsSync(cjs) ? cjs : path.join(helpersDir, base + '.js');
};
const router = await safeImport(resolveHelper('router'));
const session = await safeImport(resolveHelper('session'));
const memory = await safeImport(resolveHelper('memory'));
const intelligence = await safeImport(path.join(helpersDir, 'intelligence.cjs'));

// ── Intelligence timeout protection (fixes #1530, #1531) ───────────────────
const INTELLIGENCE_TIMEOUT_MS = 3000;
function runWithTimeout(fn, label) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      process.stderr.write("[WARN] " + label + " timed out after " + INTELLIGENCE_TIMEOUT_MS + "ms, skipping\n");
      resolve(null);
    }, INTELLIGENCE_TIMEOUT_MS);
    try {
      const result = fn();
      clearTimeout(timer);
      resolve(result);
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
}


// Get the command from argv
const [,, command, ...args] = process.argv;

// Read stdin with timeout — Claude Code sends hook data as JSON via stdin.
async function readStdin() {
  if (process.stdin.isTTY) return '';
  return new Promise((resolve) => {
    let data = '';
    const timer = setTimeout(() => {
      process.stdin.removeAllListeners();
      process.stdin.pause();
      resolve(data);
    }, 500);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => { clearTimeout(timer); resolve(data); });
    process.stdin.on('error', () => { clearTimeout(timer); resolve(data); });
    process.stdin.resume();
  });
}

async function main() {
  // Global safety timeout: hooks must NEVER hang (#1530, #1531)
  const safetyTimer = setTimeout(() => {
    process.stderr.write("[WARN] Hook handler global timeout (5s), forcing exit\n");
    process.exit(0);
  }, 5000);
  safetyTimer.unref();

  let stdinData = '';
  try { stdinData = await readStdin(); } catch { /* ignore stdin errors */ }

  let hookInput = {};
  if (stdinData.trim()) {
    try { hookInput = JSON.parse(stdinData); } catch { /* ignore parse errors */ }
  }

  const toolInput = hookInput.toolInput || hookInput.tool_input || {};
  const toolName = hookInput.toolName || hookInput.tool_name || '';

  // Merge stdin data into prompt resolution: prefer stdin fields, then env, then argv.
  // `toolInput` is an object (e.g. {command:"ls"}) — it's truthy but not a string,
  // so falling back to it directly bound `prompt` to the object and tripped
  // `.toLowerCase()` / `.substring()` on every Bash hook (#1944). Use the
  // `.command` field instead, which is the actual string the hook needs.
  const prompt = hookInput.prompt || hookInput.command || toolInput.command
    || process.env.PROMPT || process.env.TOOL_INPUT_command || args.join(' ') || '';

const handlers = {
  'route': () => {
    if (intelligence && intelligence.getContext) {
      try {
        const ctx = intelligence.getContext(prompt);
        if (ctx) console.log(ctx);
      } catch { /* non-fatal */ }
    }
    if (router && router.routeTask) {
      const result = router.routeTask(prompt);
      const output = [
        `[INFO] Routing task: ${prompt.substring(0, 80) || '(no prompt)'}`,
        '',
        '+------------------- Primary Recommendation -------------------+',
        `| Agent: ${result.agent.padEnd(53)}|`,
        `| Confidence: ${(result.confidence * 100).toFixed(1)}%${' '.repeat(44)}|`,
        `| Reason: ${(result.reason || '').substring(0, 53).padEnd(53)}|`,
        '+--------------------------------------------------------------+',
      ];
      console.log(output.join('\n'));
    } else {
      console.log('[INFO] Router not available, using default routing');
    }
  },

  'pre-bash': () => {
    const cmd = (hookInput.command || prompt).toLowerCase();
    const dangerous = ['rm -rf /', 'format c:', 'del /s /q c:\\', ':(){:|:&};:'];
    for (const d of dangerous) {
      if (cmd.includes(d)) {
        console.error(`[BLOCKED] Dangerous command detected: ${d}`);
        process.exit(1);
      }
    }
    console.log('[OK] Command validated');
  },

  'post-edit': () => {
    if (session && session.metric) {
      try { session.metric('edits'); } catch { /* no active session */ }
    }
    if (intelligence && intelligence.recordEdit) {
      try {
        const file = hookInput.file_path || toolInput.file_path
          || process.env.TOOL_INPUT_file_path || args[0] || '';
        intelligence.recordEdit(file);
      } catch { /* non-fatal */ }
    }
    console.log('[OK] Edit recorded');
  },

  'session-restore': async () => {
    if (session) {
      const existing = session.restore && session.restore();
      if (!existing) {
        session.start && session.start();
      }
    } else {
      const sessionId = `session-${Date.now()}`;
      console.log(`[INFO] Restoring session: %SESSION_ID%`);
      console.log('');
      console.log(`[OK] Session restored from %SESSION_ID%`);
      console.log(`New session ID: ${sessionId}`);
      console.log('');
      console.log('Restored State');
      console.log('+----------------+-------+');
      console.log('| Item           | Count |');
      console.log('+----------------+-------+');
      console.log('| Tasks          |     0 |');
      console.log('| Agents         |     0 |');
      console.log('| Memory Entries |     0 |');
      console.log('+----------------+-------+');
    }
    if (intelligence && intelligence.init) {
      const initResult = await runWithTimeout(() => intelligence.init(), 'intelligence.init()');
      if (initResult && initResult.nodes > 0) {
        console.log(`[INTELLIGENCE] Loaded ${initResult.nodes} patterns, ${initResult.edges} edges`);
      }
    }
  },

  'session-end': async () => {
    if (intelligence && intelligence.consolidate) {
      const consResult = await runWithTimeout(() => intelligence.consolidate(), 'intelligence.consolidate()');
      if (consResult && consResult.entries > 0) {
        console.log(`[INTELLIGENCE] Consolidated: ${consResult.entries} entries, ${consResult.edges} edges${consResult.newEntries > 0 ? `, ${consResult.newEntries} new` : ''}, PageRank recomputed`);
      }
    }
    if (session && session.end) {
      session.end();
    } else {
      console.log('[OK] Session ended');
    }
  },

  'pre-task': () => {
    if (session && session.metric) {
      try { session.metric('tasks'); } catch { /* no active session */ }
    }
    if (router && router.routeTask && prompt) {
      const result = router.routeTask(prompt);
      console.log(`[INFO] Task routed to: ${result.agent} (confidence: ${result.confidence})`);
    } else {
      console.log('[OK] Task started');
    }
  },

  'post-task': () => {
    // ADR-0211 F-02-009 (parity with the init-generated template): derive the
    // outcome from the PostToolUse(Task) tool_response payload — never
    // fabricate success.
    const toolResponse = hookInput.tool_response || hookInput.toolResponse || null;
    let outcome = null;
    if (toolResponse && typeof toolResponse === 'object') {
      if (typeof toolResponse.success === 'boolean') outcome = toolResponse.success;
      else if (toolResponse.error || toolResponse.is_error) outcome = false;
      else if (toolResponse.status === 'completed' || toolResponse.status === 'success') outcome = true;
      else if (toolResponse.status === 'failed' || toolResponse.status === 'error') outcome = false;
    }
    if (intelligence && intelligence.feedback) {
      if (outcome === null) {
        console.error('[WARN] hook-handler.post-task: tool_response missing outcome; feedback skipped (no fabrication)');
      } else {
        try {
          intelligence.feedback(outcome);
        } catch { /* non-fatal */ }
      }
    }
    // ADR-0290 Phase 1: drive the episode-capture pipeline from the live
    // file-based hook — the trigger ADR-0287 F10 found missing. A detached
    // fire-and-forget `hooks post-task` CLI invocation records the
    // METADATA-ONLY episode (CLI-derived task_type + action + reward +
    // success + session_id; the description is consumed for derivation and
    // never stored) that feeds NightlyLearner -> action-values -> routing.
    // Never blocks or fails the hook; only fires when the outcome is
    // derivable (no fabrication). RUFLO_DISABLE_TASK_CAPTURE=1 disables;
    // RUFLO_TASK_CAPTURE_CMD overrides the CLI binary (test isolation).
    if (outcome !== null && process.env.RUFLO_DISABLE_TASK_CAPTURE !== '1') {
      try {
        const ti = hookInput.tool_input || hookInput.toolInput || {};
        const captureArgs = [
          'hooks', 'post-task',
          '--task-id', String(hookInput.tool_use_id || ('task_' + Date.now())),
          '--success', outcome ? 'true' : 'false',
        ];
        if (ti.subagent_type) captureArgs.push('--agent', String(ti.subagent_type));
        if (ti.description) captureArgs.push('--task', String(ti.description));
        if (hookInput.session_id) captureArgs.push('--session', String(hookInput.session_id));
        let logFd = 'ignore';
        try {
          const metricsDir = path.join('.claude-flow', 'metrics');
          if (!fs.existsSync(metricsDir)) fs.mkdirSync(metricsDir, { recursive: true });
          logFd = fs.openSync(path.join(metricsDir, 'post-task-capture.log'), 'a');
        } catch { logFd = 'ignore'; }
        const captureCmd = process.env.RUFLO_TASK_CAPTURE_CMD || '';
        const child = captureCmd
          ? spawn(captureCmd, captureArgs, { detached: true, stdio: ['ignore', logFd, logFd] })
          : spawn('npx', ['-y', '@sparkleideas/cli@latest'].concat(captureArgs), { detached: true, stdio: ['ignore', logFd, logFd] });
        child.on('error', () => { /* best-effort capture; never fail the hook */ });
        child.unref();
        if (typeof logFd === 'number') { try { fs.closeSync(logFd); } catch { /* child holds its dup */ } }
        console.log('[ADR-0290] episode capture dispatched (agent=' + (ti.subagent_type || 'unknown') + ')');
      } catch (e) {
        console.error(`[FAIL] hook-handler.post-task.capture: ${e?.message || e}`);
      }
    }
    console.log('[OK] Task completed: outcome=' + (outcome === null ? 'unknown' : outcome));
  },

  'stats': () => {
    if (intelligence && intelligence.stats) {
      intelligence.stats(args.includes('--json'));
    } else {
      console.log('[WARN] Intelligence module not available. Run session-restore first.');
    }
  },
};

  if (command && handlers[command]) {
    try {
      await Promise.resolve(handlers[command]());
    } catch (e) {
      console.log(`[WARN] Hook ${command} encountered an error: ${e.message}`);
    }
  } else if (command) {
    console.log(`[OK] Hook: ${command}`);
  } else {
    console.log('Usage: hook-handler.mjs <route|pre-bash|post-edit|session-restore|session-end|pre-task|post-task|stats>');
  }
}

// Hooks must ALWAYS exit 0
process.exitCode = 0;
main().catch((e) => {
  try { console.log(`[WARN] Hook handler error: ${e.message}`); } catch {}
}).finally(() => {
  process.exit(0);
});
