# 10 — Daemon soundness audit

## Summary
- Subcommands audited: 7 (start, stop, status, trigger, enable, install-supervisor, uninstall-supervisor) on `daemonCommand`, plus 1 standalone stub (`process daemon`)
- Findings: 13 total / 4 critical / 6 warning / 3 note
- Soundness verdict: PARTIAL
- Completeness verdict: PARTIAL
- Bottom line: The headline `ruflo daemon` family is functionally implemented (real spawn, real PID lifecycle, real worker scheduler, crash-recovery, supervisor units) but the advertised IPC layer is fully dead — `DaemonIPCServer` is constructed, the Unix socket is created with mode 0600, and zero handlers are registered, so any client connection receives `Method not found` for every method. A parallel `process daemon` subcommand is a pure stub that only writes a PID file containing the CLI's own short-lived PID (and trips its own restart path because there is nothing to restart). There is no `daemon restart` subcommand on the headline family.

## Findings

### F-10-001 [CRITICAL] DaemonIPCServer has zero method handlers
- Location: `/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/services/worker-daemon.ts:868-883` (construction site) and `/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/services/daemon-ipc.ts:67-69` (`registerMethod`)
- Issue: `WorkerDaemon.start()` instantiates `DaemonIPCServer`, calls `start()` which opens `.claude-flow/daemon.sock` with mode 0600, logs "IPC server listening on …", and then never calls `registerMethod()`. Cross-tree grep finds **zero** call sites for `registerMethod` and **zero** clients calling `net.createConnection` against the socket. Any client request would hit `processMessage` → `this.handlers.get(req.method)` → undefined → `sendError(socket, id, -32601, 'Method not found: ${req.method}')` for every method.
- Evidence:
  ```ts
  // worker-daemon.ts:868-883
  // ADR-0088: IPC server stays up for future non-memory RPC methods, but
  // memory.* handlers and the pre-warm step are gone — memory ops are
  // in-process only per ADR-050/ADR-0086. No handlers are currently
  // registered; add them via this.ipcServer.registerMethod() when a
  // concrete non-memory use case arrives.
  try {
    this.ipcServer = new DaemonIPCServer({ … });
    await this.ipcServer.start();
    this.log('info', `IPC server listening on ${this.ipcServer.socketPath}`);
  } catch (err: any) {
    this.log('warn', `IPC server failed to start: ${err.message}`);
    // Non-fatal: daemon scheduler still runs without IPC
  }
  ```
  No `registerMethod` callers in `/Users/henrik/source/forks/ruflo/v3` outside the class definition itself.
- Impact: The Unix domain socket is a placebo — it consumes a file-descriptor slot, requires socket-file cleanup logic, and advertises "listening" in the daemon log, but cannot service any real RPC. The class header comment ("Hooks delegate memory writes to the daemon … Fallback: if daemon is not running, hooks write RVF directly") is now factually wrong since ADR-0088 removed the handlers. This contradicts [[feedback-no-fallbacks]] because the server appears functional, yet every call would silently fail with -32601. Anyone reviving the IPC path will not find `registerMethod` callers via grep and will assume the protocol works.

### F-10-002 [CRITICAL] `daemon-ipc.ts` header advertises a Phase 4 memory-write protocol that does not exist
- Location: `/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/services/daemon-ipc.ts:1-8` (file header) and `:206-208` (ADR-0088 client removal comment)
- Issue: The file header says "ADR-0059 Phase 4: Hooks delegate memory writes to the daemon (single writer). Fallback: if daemon is not running, hooks write RVF directly (Phase 1 behavior)." but ADR-0088 explicitly removed the client class (`// ADR-0088: client class removed. It had zero in-tree callers and contradicted ADR-050 (hot path is file-based, no daemon).`). The header and the ADR-0088 trailer comment are inconsistent — file header still claims the Phase 4 contract.
- Evidence:
  ```ts
  // daemon-ipc.ts:1-8 (top of file)
  /**
   * Daemon IPC — Unix domain socket server + client for hook<->daemon communication.
   * ADR-0059 Phase 4: Hooks delegate memory writes to the daemon (single writer).
   * Fallback: if daemon is not running, hooks write RVF directly (Phase 1 behavior).
   * …
   */

  // daemon-ipc.ts:206-208 (bottom of file)
  // ADR-0088: client class removed. It had zero in-tree callers and contradicted
  // ADR-050 (hot path is file-based, no daemon). The server class above remains
  // for future non-memory RPC methods; memory ops are in-process only via
  // memory-router.ts per ADR-0086.
  ```
- Impact: Reader-grade soundness violation. New maintainers will read the header, assume hooks rely on the daemon for memory writes, and either add fallback paths "just in case" or remove the no-longer-needed server. The truth is the server is now both unused and undocumented as such at the top of the file.

### F-10-003 [CRITICAL] `process daemon` subcommand is a stub that does NOT spawn a daemon
- Location: `/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/commands/process.ts:48-203`
- Issue: `process daemon --action start` writes a PID file with `process.pid` (the CLI process itself), then immediately returns. No `spawn`, `fork`, or `child_process` call. The CLI exits, the PID file points at a dead PID, but the next `process daemon --action status` reads the PID file and prints `"Status: 🟢 running"` with fabricated "Services: ├─ MCP Server: listening, ├─ Agent Pool: initialized (0 agents), …" lines (lines 133-138). The `restart` case does the same fake teardown + re-write (line 159-174).
- Evidence:
  ```ts
  // process.ts:118-138
  console.log('\n🚀 Starting claude-flow daemon...\n');
  const newPid = process.pid; // Use actual process PID
  daemonState.status = 'running';
  daemonState.pid = newPid;
  …
  writePidFile(pidFile, newPid, port);
  console.log('  ✅ Daemon started successfully');
  …
  console.log('\n  Services:');
  console.log('    ├─ MCP Server: listening');
  console.log('    ├─ Agent Pool: initialized (0 agents)');
  console.log('    ├─ Memory Service: connected');
  console.log('    ├─ Task Queue: ready');
  console.log('    └─ Swarm Coordinator: standby');
  ```
  No `spawn`/`fork` anywhere in this file (lines 1-739; only `workers --action spawn` exists, unrelated).
- Impact: Two `daemon.pid` paths collide. `daemonCommand.start` writes `.claude-flow/daemon.pid` with a real long-running spawned PID; `process daemon --action start` (same default `--pid-file .claude-flow/daemon.pid`) overwrites it with the calling CLI's PID, which dies on exit. Worse, the lying status output (hard-coded green-light "Services: …") deceives any operator who runs it. This is a [[feedback-no-squelch-tests]] / [[feedback-no-fallbacks]] equivalent at the user-output layer.

### F-10-004 [CRITICAL] No `daemon restart` subcommand on the headline family
- Location: `/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/commands/daemon.ts:1036-1099` (subcommand list)
- Issue: The task brief lists `ruflo daemon restart` as an audit target; `daemonCommand.subcommands` is `[startCommand, stopCommand, statusCommand, triggerCommand, enableCommand, installSupervisorCommand, uninstallSupervisorCommand]`. Restart is only present on the stub `process daemon` action enum (`choices: ['start', 'stop', 'restart', 'status']` at process.ts:56), which doesn't actually do anything (see F-10-003). Operators wanting graceful restart must run `daemon stop && daemon start` manually.
- Evidence:
  ```ts
  // daemon.ts:1039-1047
  subcommands: [
    startCommand,
    stopCommand,
    statusCommand,
    triggerCommand,
    enableCommand,
    installSupervisorCommand,
    uninstallSupervisorCommand,
  ],
  ```
- Impact: Restart is the standard daemon affordance; its absence forces operators into a stop+start sequence that races (stop is async, may take >1s due to the SIGTERM-then-SIGKILL grace window at daemon.ts:407-419). With the supervisor unit (launchd/systemd-user) installed, the supervisor handles auto-restart on crash, but there is no hot-config-reload path either — the only way to apply a config change is a manual stop + start. Document or implement.

### F-10-005 [WARN] `setupShutdownHandlers` registers SIGHUP shutdown — contradicts the SIGHUP-ignore in `daemon.ts`
- Location: `/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/services/worker-daemon.ts:464-474` and `/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/commands/daemon.ts:119-122`
- Issue: The foreground-mode CLI registers `process.on('SIGHUP', () => { /* ignore — keep running */ })` (daemon.ts:121) explicitly to survive terminal close (#1283 fix). But the inner `WorkerDaemon.setupShutdownHandlers()` then attaches `process.on('SIGHUP', shutdown)` which calls `this.stop(); process.exit(0)`. Node handlers run in registration order, so both fire on SIGHUP. The behavior depends on whose handler is registered last — the WorkerDaemon constructor runs inside `startDaemon()`, which is called after the daemon.ts SIGHUP handler is registered (daemon.ts:121 then daemon.ts:128 `startDaemon` → `new WorkerDaemon(...)` → `setupShutdownHandlers()`). So WorkerDaemon's `shutdown` handler runs AFTER the no-op handler, killing the process despite the deliberate-ignore comment.
- Evidence:
  ```ts
  // daemon.ts:119-122 (registered first)
  if (process.platform !== 'win32') {
    process.on('SIGHUP', () => { /* ignore — keep running */ });
  }
  …
  // worker-daemon.ts:464-474 (registered after, by constructor)
  private setupShutdownHandlers(): void {
    const shutdown = async () => {
      this.log('info', 'Received shutdown signal, stopping daemon...');
      await this.stop();
      process.exit(0);
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
    process.on('SIGHUP', shutdown);
  }
  ```
- Impact: The terminal-close-survival code at daemon.ts:121 is silently negated by the WorkerDaemon constructor. #1283's promise may be broken in the foreground-on-tty case (background daemons detach so SIGHUP is intercepted by the launchpad, masking the bug). Either WorkerDaemon should not register SIGHUP, or daemon.ts should attach the no-op handler AFTER `startDaemon()`.

### F-10-006 [WARN] Status command's `aiMode` probe shells out to `which claude` from the CLI process for background daemons
- Location: `/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/commands/daemon.ts:606-618`
- Issue: When the daemon is running in the background (separate PID), `daemon status` cannot read the daemon's `_aiMode` field, so it re-runs `execSync('which claude', ...)` from the status process itself. This means status reports the CLI process's view of PATH, not the background daemon's view. If the user installed Claude Code after spawning the background daemon, status will say `aiMode: headless` while the daemon is still in `local` mode internally (and vice versa if Claude was uninstalled).
- Evidence:
  ```ts
  // daemon.ts:606-618
  let aiMode: 'headless' | 'local';
  if (status.running && typeof (daemon as any).aiMode === 'string') {
    aiMode = (daemon as any).aiMode;  // only reachable when this CLI process IS the daemon (foreground or same-process)
  } else {
    try {
      const { execSync } = require('node:child_process');
      execSync('which claude', { stdio: 'ignore' });
      aiMode = 'headless';
    } catch {
      aiMode = 'local';
    }
  }
  ```
- Impact: Status output disagrees with daemon behavior. This is exactly the gap that an IPC layer with one query method (`getStatus`) would close. As a UX fix-up, the comment at line 605 (`when the daemon runs in the background, re-run the capability check so the answer reflects current PATH state`) tries to claim this as a feature, but "current PATH state" is the wrong state to report — daemon's PATH at spawn time is what matters.

### F-10-007 [WARN] Stop path races the unref + 500ms wait + PID-file fallback write
- Location: `/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/commands/daemon.ts:301-325`
- Issue: `startBackgroundDaemon` spawns the child with `--foreground`, calls `child.unref()`, sleeps 500ms, then writes the PID file as a fallback `if (!fs.existsSync(pidFile))`. This relies on the child's `WorkerDaemon.writePidFile` having executed within 500ms. On macOS / Node 25 there's a real race (acknowledged at worker-daemon.ts:751-759 #1853 comment): the child reads its own PID back from the parent-written file, decides "another daemon is already running", and exits silently. The current fix is `checkExistingDaemon()` returning `null` on self-PID match — but that fix only works because the parent is writing the child's PID. If the parent ever wrote a different PID (e.g. its own PID by mistake, or a stale PID from before the spawn), the child would still exit early.
- Evidence:
  ```ts
  // daemon.ts:313-325
  child.unref();
  await new Promise(resolve => setTimeout(resolve, 500));
  if (!fs.existsSync(pidFile)) {
    fs.writeFileSync(pidFile, String(pid));
  }
  ```
  And the fragile guard at worker-daemon.ts:765-767:
  ```ts
  if (pid === process.pid) return null;  // #1853 self-PID workaround
  ```
- Impact: Two writers (parent fallback + child `writePidFile()`) and one reader (child's `checkExistingDaemon`) coordinate through a file with no fsync, no flock, just a hope-and-pray 500ms window. The unit tests likely cover the success path but not "parent writes wrong PID" / "child boots in >500ms". Worktrees with cold filesystem caches (per [[reference-ruflo-worktree-start]]) are exactly where this latency stretches.

### F-10-008 [WARN] Status falls back to a fabricated "NOT INITIALIZED" frame on any thrown error
- Location: `/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/commands/daemon.ts:702-715`
- Issue: The `try/catch` in `statusCommand.action` catches **any** error from `getDaemon(projectRoot)` / `daemon.getStatus()` and prints a hardcoded "NOT INITIALIZED — Run 'claude-flow daemon start' to start the daemon" box, then returns `{ success: true }`. A bad config file, a corrupt `daemon-state.json` (which initializeWorkerStates parses on construct), or any other exception is rendered as "daemon not initialized". This is a textbook [[feedback-no-fallbacks]] violation — failures are masked behind a misleading success-coded message.
- Evidence:
  ```ts
  // daemon.ts:702-715
  } catch (error) {
    // Daemon not initialized
    output.writeln();
    output.printBox([
      `Status: ${output.error('○')} ${output.error('NOT INITIALIZED')}`,
      '',
      'Run "claude-flow daemon start" to start the daemon',
    ].join('\n'), 'RuFlo Daemon');
    return { success: true };
  }
  ```
  Note: `success: true` despite the error.
- Impact: A corrupt config or state file silently masquerades as "stopped". The same code path that should surface "config.json line 23: invalid JSON" instead tells the operator to run `daemon start` (which would then re-throw the same error on its own catch path — that one DOES return exit 1 at least).

### F-10-009 [WARN] `WorkerDaemon.stop()` flushes state + Archivist, but the `daemon stop` CLI command kills the BG daemon by SIGTERM before in-process `stop()` runs
- Location: `/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/commands/daemon.ts:356-369` (CLI stop), `/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/services/worker-daemon.ts:1026-1071` (in-process stop)
- Issue: The CLI `stop` command calls `stopDaemon()` first (which is the **in-process** singleton — a no-op in a fresh CLI invocation that did not spawn anything), THEN calls `killBackgroundDaemon(projectRoot)` which sends SIGTERM to the background-daemon PID. The graceful flush at worker-daemon.ts:1052-1068 (IPC stop → memory router shutdown → archivist drop → removePidFile → saveState) only runs in the background daemon process, which receives the SIGTERM and runs `setupShutdownHandlers().shutdown` → `await this.stop()` → `process.exit(0)`. The CLI process does not wait for the background daemon to finish that flush — it only sleeps 1s before SIGKILL fallback (daemon.ts:410-418). On a slow flush (Archivist substrate sync, state file write race), SIGKILL truncates the flush. Result: on slow systems, state persistence is best-effort.
- Evidence:
  ```ts
  // daemon.ts:407-418
  process.kill(pid, 'SIGTERM');
  await new Promise(resolve => setTimeout(resolve, 1000));
  try {
    process.kill(pid, 0);
    process.kill(pid, 'SIGKILL');  // forced after 1s regardless of flush progress
  } catch { /* Process terminated */ }
  ```
  And worker-daemon.ts:1052-1068 expects to:
  1. `await this.ipcServer.stop()` (close all sockets, unlink socket file)
  2. `await router.shutdownRouter()` (close memory router and underlying RVF/SQLite)
  3. drop `this.archivist`
  4. `removePidFile()` + `saveState()`
  Steps 1-3 are async; step 4 is sync but happens last. 1 second is plenty in the happy path but offers no headroom under load.
- Impact: Mostly a [[feedback-no-fallbacks]] / robustness concern. The shutdown sequence assumes the flush completes inside 1s. If RVF or Archivist flush takes longer (cold-cache, large state), SIGKILL may truncate state. Document or extend the grace window proportional to active worker count.

### F-10-010 [WARN] `killStaleDaemons` swallows every `ps`/`tasklist` error silently
- Location: `/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/commands/daemon.ts:447-477` (POSIX) and `:488-533` (Windows)
- Issue: Both stale-daemon cleaners wrap the entire body in an outer `try { … } catch { /* ps not available or failed — skip stale cleanup */ }`. A real failure (e.g. `ps` exits non-zero, command timeout, parse error in tasklist's CSV format) leaves stale daemons alive without any operator notification. The "tooling failure" justification only covers literal tool-absence; output-parsing exceptions in the loop body (e.g. an `isNaN` followed by some unexpected throw on a malformed pidStr) would also be swallowed.
- Evidence:
  ```ts
  // daemon.ts:475-478 (POSIX)
  } catch {
    // ps not available or failed — skip stale cleanup
  }
  // daemon.ts:528-533 (Windows)
  } catch {
    // tasklist not available or failed — skip stale cleanup. Defensive
    // shape matches the POSIX path. Not tested on Windows by the
    // maintainer; please report regressions on the issue tracker.
  }
  ```
- Impact: [[feedback-best-effort-must-rethrow-fatals]] — best-effort wrappers must discriminate. A real "ps failed" should at minimum log at info, not be invisible. Operators debugging "why didn't `daemon start` kill the stale daemon?" have no signal in the daemon log either (this code path runs in the parent CLI process, not the daemon log).

### F-10-011 [WARN] `processDispatchQueue` polls the FS every 5s for queued workers — file-based RPC alternative to the dead IPC
- Location: `/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/services/worker-daemon.ts:893-1021`
- Issue: Per #1845 (comment), MCP `worker-dispatch` writes JSON files into `.claude-flow/daemon-queue/<id>.json` and the daemon polls the directory every 5s with `readdirSync`. This is the real cross-process dispatch mechanism in current code. With the dead IPC (F-10-001), file polling has become the de-facto IPC. This works but: (a) 5s polling means worst-case 5s latency on dispatch, (b) `readdirSync` on a hot tmpfs path can race with the writer's atomic-rename, (c) `.processed/` directory grows unbounded with no rotation policy in the surrounding code.
- Evidence:
  ```ts
  // worker-daemon.ts:893-901
  this.queuePollTimer = setInterval(() => {
    void this.processDispatchQueue();
  }, 5_000);
  if (typeof this.queuePollTimer.unref === 'function') {
    this.queuePollTimer.unref();
  }
  ```
- Impact: System works. But the existence of the IPC server while the actual cross-process channel is `daemon-queue/*.json` files is architecturally redundant. Either kill the IPC server (it's already dead per F-10-001) or move queue dispatch through the socket once a real method is registered.

### F-10-012 [NOTE] `install-supervisor --load` uses `default = 'true'` (string) instead of `true` (boolean)
- Location: `/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/commands/daemon.ts:832-836`
- Issue: The option defaults are declared as strings (`default: 'false'`, `default: 'true'`) rather than booleans. The action parser handles this via `ctx.flags.force === true` truthiness check, so the runtime behavior is correct — but the type system declares them as boolean defaults with string values. Other Command definitions in this file use `default: true/false` correctly (e.g. startCommand's background flag at line 25).
- Evidence:
  ```ts
  // daemon.ts:832-836
  options: [
    { name: 'force', short: 'f', type: 'boolean', description: 'Overwrite existing unit file', default: 'false' },
    { name: 'load', type: 'boolean', description: 'Load/enable the unit immediately', default: 'true' },
    { name: 'dry-run', type: 'boolean', description: 'Print the unit file content without writing', default: 'false' },
  ],
  ```
- Impact: Cosmetic / type-soundness. If the option-parser ever begins enforcing the declared type, these will trip validation.

### F-10-013 [NOTE] Worktree caveat per [[reference-ruflo-worktree-start]] confirmed in code
- Location: `/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/init/executor.ts:1556` and `:1704-2013`
- Issue: The init script generates a `daemon start` line in the bootstrap, but in a worktree where `.claude/` is committed, the init/--start-all path is forbidden by user memory. The memory says use `memory init` + `daemon start` + `swarm init` instead. Code review confirms there is no special-case handling in `daemonCommand.start` for "already initialized via init --start-all" vs "init avoided in worktree" — the start command works the same either way, so the caveat is purely about init ordering, not daemon behavior. No daemon-side bug; documenting the cross-reference.
- Evidence: No daemon code references worktree state. `process.cwd()` is the only context, and `findProjectRoot()` is only called for the supervisor unit (`install-supervisor`, line 849).
- Impact: None on daemon. The worktree caveat applies to init, not daemon start.

## Daemon inventory

| Component | File | LOC | Sound | Complete | Notes |
|---|---|---|---|---|---|
| `daemonCommand` (start/stop/status/trigger/enable/install-supervisor/uninstall-supervisor) | `forks/ruflo/v3/@claude-flow/cli/src/commands/daemon.ts` | 1101 | PARTIAL | PARTIAL | No restart subcommand (F-10-004); status fallback masks errors (F-10-008); aiMode probe disagrees with daemon (F-10-006); SIGHUP collision (F-10-005); stop SIGKILL after 1s (F-10-009) |
| `WorkerDaemon` (scheduler, PID, state, IPC wrapper, queue poller, Archivist, crash recovery) | `forks/ruflo/v3/@claude-flow/cli/src/services/worker-daemon.ts` | 1790 | PARTIAL | YES | Lifecycle real; IPC dead-wired (F-10-001); SIGHUP collision (F-10-005); FS-poll dispatch (F-10-011); crash + reap + mid-flight detection all implemented |
| `DaemonIPCServer` | `forks/ruflo/v3/@claude-flow/cli/src/services/daemon-ipc.ts` | 209 | PARTIAL | PARTIAL | Server class fully implemented but has zero handlers registered anywhere; client class removed; file header still advertises Phase-4 contract that no longer exists (F-10-001, F-10-002) |
| `DaemonManager` / `MetricsDaemon` / `SwarmMonitorDaemon` / `HooksLearningDaemon` | `forks/ruflo/v3/@claude-flow/hooks/src/daemons/index.ts` | 566 | YES | YES | Pure in-process `setInterval`-based "daemons" — share `process.pid` with caller; never spawn. Bootstrapped by `hooks/src/index.ts:188-205` when `options.enableDaemons !== false` |
| `process daemon` (parallel stub) | `forks/ruflo/v3/@claude-flow/cli/src/commands/process.ts:48-203` | 156 | NO | NO | Stub: writes PID file with `process.pid` then returns; never spawns anything; lies in status with hardcoded "Services:" output (F-10-003) |
| `doctor` daemon-pid health check | `forks/ruflo/v3/@claude-flow/cli/src/commands/doctor.ts:163-180` | 17 | YES | YES | Reads `.claude-flow/daemon.pid`, sends signal 0 to check liveness, returns `pass`/`warn` |
| `init` daemon bootstrap | `forks/ruflo/v3/@claude-flow/cli/src/init/{settings-generator,executor}.ts` (multiple) | n/a | YES | YES | Generates `npx @sparkleideas/cli@latest daemon start` lines in user-facing scaffolding; per [[feedback-always-npx-for-ruflo]] should arguably be `@sparkleideas/ruflo`, but that's an init audit, not daemon |
| Supervisor (launchd plist / systemd-user unit) | `forks/ruflo/v3/@claude-flow/cli/src/commands/daemon.ts:825-1033` | 208 | YES | YES | Real units, real launchctl/systemctl invocation; Windows path is a documented stub returning exit 1; minor cosmetic type bug (F-10-012) |

## Method

### Commands run
```
ls /Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/commands/daemon.ts \
   /Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/services/daemon-ipc.ts
ls -la /Users/henrik/source/forks/ruflo/v3/@claude-flow/hooks/src/daemons/
wc -l <four-files>
grep -rn "registerMethod\|DaemonIPCServer\|new DaemonIPCServer" .../src
grep -n "async stop\|writePidFile\|checkExistingDaemon\|saveState\|reapOrphanedChildren\|detectMidFlightFailures" worker-daemon.ts
grep -n "restart\|getStatus\|on('exit'\|on('SIGINT'\|on('SIGTERM'\|on('SIGHUP'" worker-daemon.ts
grep -rn "daemon-children\|daemon-queue\|daemon.sock\|daemon.pid\|daemon.lock\|daemon-state\|daemon.log\|crash.log\|supervisor.out\|supervisor.err" .../src
grep -n "spawn\|fork\|exec\|child_process" process.ts
grep -rn "daemonCommand\|name: 'daemon'" .../commands
grep -rn "DaemonManager\|HooksLearningDaemon\|MetricsDaemon\|SwarmMonitorDaemon" .../v3 --include="*.ts"
grep -rn "daemon-ipc\|DaemonIPCServer\|DaemonIPCClient" .../v3 --include="*.ts"
grep -rn "net.createConnection\|connect(.*\.sock\|connect(daemon" .../v3/@claude-flow --include="*.ts"
grep -rn "registerMethod" .../v3 --include="*.ts"
```

### Files read in full or in load-bearing chunks
- `/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/commands/daemon.ts` (lines 1-1101 — full file)
- `/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/services/daemon-ipc.ts` (lines 1-209 — full file)
- `/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/services/worker-daemon.ts` (lines 1-200, 200-440, 440-640, 740-820, 820-920, 1020-1150, 1690-1789)
- `/Users/henrik/source/forks/ruflo/v3/@claude-flow/hooks/src/daemons/index.ts` (lines 1-567 — full file)
- `/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/commands/process.ts` (lines 1-203 — daemon subcommand block)
- `/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/commands/doctor.ts` (lines 160-185 — daemon health check)
- `/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/commands/start.ts` (lines 155-205 — daemon-pid sidechannel)
- `/Users/henrik/source/forks/ruflo/v3/@claude-flow/hooks/src/index.ts` (lines 180-210 — `setupHooks` daemon wiring)

## Recommendations (DO NOT IMPLEMENT)
1. **F-10-001/002**: Either (a) delete `DaemonIPCServer` and the socket-lifecycle code entirely (the dispatch queue handles cross-process work), and rewrite the `daemon-ipc.ts` header to be a deletion candidate, or (b) actually wire at least one method (e.g. `daemon.status` returning the real `getStatus()` snapshot) so the abstraction earns its keep. Pick one.
2. **F-10-003**: Replace `process daemon` with an alias to `daemonCommand` or delete it. The current stub actively lies in `status` output and overwrites the real daemon's PID file. Pre-existing UX bug.
3. **F-10-004**: Add `daemon restart` to `daemonCommand.subcommands`. Implement as stop + start with a configurable inter-stop grace window. Document the supervisor unit as the auto-restart-on-crash path.
4. **F-10-005**: Resolve the SIGHUP handler collision: either remove the SIGHUP handler from `WorkerDaemon.setupShutdownHandlers`, or move daemon.ts's ignore handler to be registered last (after `startDaemon()` returns).
5. **F-10-006**: The `daemon status` `aiMode` mismatch is real but small. Either (a) read aiMode through the queue (write a no-op file, daemon writes back to a response file), (b) wire it via the IPC method per recommendation #1, or (c) document the disagreement explicitly in the status output ("aiMode: headless [from current CLI's PATH, may differ from running daemon]").
6. **F-10-007**: Replace the unref + 500ms wait + fallback-write with a proper handshake: child writes the PID, parent polls with timeout (`while (!exists && elapsed<5s) sleep(50)`), then proceeds. Removes the #1853 self-PID workaround.
7. **F-10-008**: Distinguish "daemon not initialized" (genuine: no state file, no PID file, no .claude-flow dir) from "config corrupt" / "state corrupt". Surface the latter as a non-zero exit and a real error message.
8. **F-10-009**: Configurable shutdown grace window, or wait until `daemon-state.json.tmp` no longer exists before SIGKILL. Currently 1s is enough for ~99% of cases but is unbounded in the worst case.
9. **F-10-010**: `killStaleDaemons` should at least log when `execFileSync` succeeds but parse fails. Tool-absence (ENOENT for `ps`/`tasklist`) is one branch; everything else is a programming error or environment quirk worth surfacing.
10. **F-10-011**: If keeping the FS-based dispatch queue, add a rotation policy for `.processed/` (size-based or age-based) and document that this is the cross-process channel, not the dead socket.
11. **F-10-012**: Convert `default: 'true'` → `default: true` (boolean) and `default: 'false'` → `default: false` on the install-supervisor options. Pure cosmetic.
