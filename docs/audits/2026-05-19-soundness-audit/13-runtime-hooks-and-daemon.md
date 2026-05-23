# 13 — Runtime: hooks + daemon validation

## Summary

- **Daemon lifecycle** — `start` PASS / `status` (before) MISLEADING (reports STOPPED but PID 39011 of an unrelated process) / `status` (after) PASS / `double-start` PASS (correctly refused with WARN, no second process) / `stop` PASS (process gone)
- **IPC probes** — `daemon ping`, `daemon info`, `daemon list-services` all return the SAME generic help text (none are real subcommands; `--help` would have been clearer). `daemon trigger -w audit` PASS — actually triggers and returns JSON output.
- **Hooks fired** — `pre-task` PASS (succeeded before lock contention), `post-edit` first invocation PASS / second invocation FAIL (LockHeld after daemon held RVF), `session-start` PASS, `pre-command` PASS, `post-command` FAIL (LockHeld), `post-task` FAIL (LockHeld), `route` HANG (never returned in 60s+)
- **Side-effects observed** — Hooks do NOT update `.claude-flow/metrics/learning.json` (still `decisions: 0` after firing pre-task). `archivist-audit.jsonl` was last written at 22:25:58 by PID 43251 (a hook-spawned process) — so audit log captured `memory_store` events transiently, then nothing once daemon took the lock.
- **HookExecutor architecture** — DEAD. Zero `HookExecutor` references in the entire installed `dist/` tree. `dist/src/commands/hooks.js` uses `callMCPTool` (34 references) to call MCP tool functions in `dist/src/mcp-tools/hooks-tools.js`. Prior-recon claim CONFIRMED.
- **ESM bug confirmed/refuted** — REFUTED at the surface I could test. No `ReferenceError: require is not defined` was triggered by any hook subcommand. The prior recon's `hooks/src/index.ts:233` is in a different layer (fork source), not in the installed dist `commands/hooks.js`. If the bug exists, it's gated behind a code path my hook invocations did not reach. (No `hooks/src/index.ts` or `dist/cli/hooks/` directory exists in the installed package — the only hooks dist files are `dist/src/commands/hooks.js` + `dist/src/mcp-tools/hooks-tools.js`.)
- **Bottom line** — Daemon works for start/stop/trigger but has THREE reporting bugs (stale "PID 39011" in pre-start status; "Logs:" path message points to wrong file location; `daemon-state.json.running` not updated on stop). Hooks work IN ISOLATION but are STRUCTURALLY INCOMPATIBLE WITH A RUNNING DAEMON — the daemon's Memory Archivist holds the RVF lock continuously, causing every post-task / post-edit / post-command hook fired AFTER daemon start to fail with `LockHeld`, and `hooks route` hangs indefinitely waiting for the lock. The CLI swallows the error to exit 0, hiding the failure.

## Daemon step-by-step

### Pre-start status (Step 7)

```
+---- RuFlo Daemon ----+
| Status: ○ STOPPED    |
| PID: 39011           |   <-- BUG: PID shown even when stopped
| Workers Enabled: 6   |
| Max Concurrent: 2    |
| Max CPU Load: 14.4   |
| Min Free Memory: 5%  |
| AI Mode:       local |
+----------------------+
EXIT: 0
```

Status correctly reports STOPPED, but the "PID: 39011" line is meaningless — PID 39011 is not a real daemon. (Earlier inspection shows this is likely the PID of the status-command process itself, not a daemon.)

### Start (Step 8)

```
[WARN] Killed stale daemon process (PID: 25248)
[INFO] Cleaned up 1 stale daemon process(es)
[OK] Daemon started in background (PID: 39589)
[INFO] Logs: /private/tmp/ruflo-audit-hooks-daemon-21111/.claude-flow/daemon.log
EXIT: 0
```

`ps aux | grep` confirmed PID 39589 alive:

```
node /Users/henrik/.local/share/mise/installs/node/24.14.1/bin/node \
  /private/tmp/ruflo-audit-hooks-daemon-21111/node_modules/@sparkleideas/cli/bin/cli.js \
  daemon start --foreground --quiet
```

**Bug**: The "Logs: …/.claude-flow/daemon.log" path is WRONG — actual log is at `.claude-flow/logs/daemon.log` (subdir `logs/`). `.claude-flow/daemon.log` does not exist.

Also notable: the auto-kill of "stale daemon process (PID: 25248)" reached OUTSIDE the sandbox to kill another developer's process. Cross-sandbox kill is concerning if multiple users on the same host. (Worth a separate investigation; PID 25248 may have been a residual from a prior audit slice or another shell.)

### Post-start status (Step 9)

```
+--------- RuFlo Daemon ---------+
| Status: ● RUNNING (background) |
| PID: 39589                     |
| Workers Enabled: 6             |
| Max Concurrent: 2              |
+--------------------------------+
```

PID matches; worker `map` ran once successfully.

### IPC probes (Step 10)

| Subcommand | Result |
|---|---|
| `daemon ping` | Returned generic help text (NOT a real subcommand) |
| `daemon info` | Same generic help text |
| `daemon list-services` | Same generic help text |
| `daemon trigger -w audit` | PASS — actually executed audit worker, returned valid JSON |

The first three are NOT real IPC subcommands. The CLI silently falls through to a generic help display rather than rejecting with "unknown subcommand". Documented subcommands are only: `start | stop | status | trigger | enable | install-supervisor | uninstall-supervisor`.

IPC socket exists: `.claude-flow/daemon.sock` (Unix domain socket), and daemon.log confirms:

```
[INFO] IPC server listening on /private/tmp/.../.claude-flow/daemon.sock
```

But no CLI subcommand exposes the IPC for client probing. `trigger` invokes a worker but does not appear to actually round-trip through the socket (worker completed "in 0ms" with placeholder JSON, suggesting in-process execution).

### Double-start (Step 11)

```
[WARN] Daemon already running in background (PID: 39589). Stop it first with: daemon stop
EXIT: 0
```

PASS — correctly refused, no second daemon spawned. (Exit code 0 on WARN may be debatable; some would expect non-zero.)

### Stop (Step 12)

```
... Stopping worker daemon...... Stopping worker daemon.....: Stopping worker daemon....::
Stopping worker daemon...::: Stopping worker daemon...::. Stopping worker daemon...:..
Stopping worker daemon...... Stopping worker daemon.....: Stopping worker daemon....::
Stopping worker daemon...                                   Worker daemon stopped
EXIT: 0
```

Process gone (verified by `ps -p 39589`). Output is garbled (progress dots/colons not properly cleared between updates) — minor cosmetic issue.

### Post-stop status (Step 13)

```
+---- RuFlo Daemon ----+
| Status: ○ STOPPED    |
| PID: 70890           |
+----------------------+
```

Status correctly says STOPPED. But "PID: 70890" is again misleading — that's the status-command's own PID, not a daemon. And critically, `.claude-flow/daemon-state.json` still reports `"running": true`:

```json
{ "running": true }
```

So the persisted state file is **never updated on stop**. Inconsistency between CLI status output (which uses live PID-check) and the JSON state file (which the daemon would write on shutdown but apparently doesn't).

Stale `.claude-flow/daemon.sock` is also left behind:

```
srw-------  1 henrik  wheel  0 19 May 23:25 .claude-flow/daemon.sock
```

## Hooks step-by-step

### Step 14: hooks.json inspection

No `hooks.json` exists — hooks are configured in `.claude/settings.json` under top-level `hooks` key. 11 hook types defined: `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `SessionStart`, `SessionEnd`, `Stop`, `PreCompact`, `SubagentStart`, `SubagentStop`, `PostToolUseFailure`, `Notification`.

All hook handlers reference `${CLAUDE_PROJECT_DIR:-.}/.claude/helpers/hook-handler.mjs` with fallback to `$HOME/.claude/helpers/hook-handler.mjs`. Both targets exist (14278B and 9303B respectively). Handlers are executable (`-rwxr-xr-x`).

`hooks` config block in `.claude-flow/config.json` is minimal:

```json
"hooks": {
  "enabled": true,
  "autoExecute": true
}
```

No `bridgeFallback` setting (which is the documented fix for the LockHeld failure mode).

### Step 15: hooks CLI discovery

`ruflo hooks --help` lists 30+ subcommands. Notable: `pre-edit`, `post-edit`, `pre-command`, `post-command`, `pre-task`, `post-task`, `route`, `explain`, `session-start`, `session-end`, `session-restore`, `notify`, `list`, `metrics`, `pretrain`, `route-task` (DEPRECATED), `session-start` (DEPRECATED), `pre-bash` (ALIAS), `post-bash` (ALIAS), `intelligence_*` family.

`hooks list` reports 26 registered hooks, 6 enabled. Output:

```
[INFO] Total: 26 hooks
```

But "Executions" and "Last Executed" are blank for ALL hooks even after firing them — the list command doesn't reflect actual hook runs.

### Step 16: pre-task fire

```
[INFO] Starting task: task-mpd7c3ve
+---- Task Registered -----+
| Task ID: task-mpd7c3ve   |
| Description: test        |
| Complexity: LOW          |
| Est. Duration: 10-30 min |
+--------------------------+

Suggested Agents
| tester     |      95.0% | ... |
| reviewer   |      90.0% | ... |

Intelligent Model Routing
  Tier 2: HAIKU
  Complexity: 18%
  Est. Latency: 500ms | Cost: $0.0002
EXIT: 0
```

PASS (this was run BEFORE daemon was started, so RVF lock was free).

### Step 17: post-edit fire (first invocation, daemon not yet started)

```
[INFO] Recording outcome for: /tmp/ruflo-audit-hooks-daemon-21111/dummy.txt
[OK] Outcome recorded for /tmp/ruflo-audit-hooks-daemon-21111/dummy.txt
EXIT: 0
```

PASS. `archivist-audit.jsonl` was written:

```json
{"auditId":"eb111e99-...","originatingTool":"memory_store","processId":{"pid":43251,"role":"cli"},
 "timestamp":1779229558756,"state":"intent"}
{"auditId":"eb111e99-...","state":"applied",
 "invariantVerdicts":[{"name":"namespaceNonEmpty","verdict":"pass"},
                      {"name":"contentEquality","verdict":"pass"}, ...]}
```

So when the lock IS free, hooks do persist memory writes via the archivist guard.

### Step 18: session-start fire

```
[INFO] Restoring session: latest
[OK] Session restored from session-1779143165531
New session ID: session-1779229565531

Restored State
| Tasks          |     0 |
| Agents         |     0 |
| Memory Entries |     0 |
```

PASS. But "Memory Entries: 0" suggests the restore is shallow (or the test sandbox truly has no prior state — likely the latter).

`.claude-flow/sessions/` directory is EMPTY. No session file was actually written despite the "New session ID: session-1779229565531" claim. The session-start command names a new session but doesn't persist it.

### Step 17b: post-edit fire (second invocation, AFTER daemon started)

```
[ERROR] Post-edit hook failed: Failed to execute MCP tool 'hooks_post-edit':
  HK-002a: store via memory-router failed: Storage initialization failed:
  [StorageFactory] Failed to create storage backend (unknown).
  Path: /private/tmp/.../.swarm/memory.rvf
  Dimensions: 768
  Underlying: RVF storage ... is corrupt: native file has SFVR magic but
  RvfDatabase.open failed after 1 attempt(s) over 30120ms (budget 30000ms):
  RVF error 0x0300: LockHeld. ...
  Both native Rust HNSW and pure-TS fallback failed.
Fix: set "hooks.bridgeFallback": true in .claude-flow/config.json
EXIT: 0
```

FAIL — but exit code 0 hides it. The error message is also misleading: it claims the file has "SFVR magic" but my hexdump of the file shows `RVFROOT` (not SFVR):

```
00000000  52 56 46 52 4f 4f 54        |RVFROOT|
```

So the error message text references an outdated magic format. The actual issue is just lock contention from the daemon, NOT file corruption.

`lsof` confirmed:

```
node  39589 henrik  16u  REG  1,16  5627  281367977 .swarm/memory.rvf
node  39589 henrik  15u  REG  1,16  0     281367976 .swarm/memory.rvf.lock
```

Daemon (PID 39589) holds both the file and the lock. CLI hook process (PID 64550 from a later invocation) tries to acquire the lock, waits 30 seconds, gives up.

### Step: post-command fire (AFTER daemon started)

```
[ERROR] Post-command hook failed: Failed to execute MCP tool 'hooks_post-command':
  HK-002b: store via memory-router failed: ...LockHeld...
Fix: set "hooks.bridgeFallback": true in .claude-flow/config.json
EXIT: 0
```

FAIL (exit 0 hides). Same root cause.

### Step: post-task fire (AFTER daemon started)

```
[ERROR] Post-task hook failed: Failed to execute MCP tool 'hooks_post-task':
  routeFeedbackOp failed: ...LockHeld...
Fix: set "hooks.bridgeFallback": true in .claude-flow/config.json
to allow degraded routing
EXIT: 0
```

FAIL (exit 0 hides). Same root cause.

### Step: pre-command fire (AFTER daemon started)

```
[INFO] Analyzing command: ls
+-- Risk Assessment --+
| Risk Level: LOW     |
| Should Proceed: Yes |
+---------------------+
EXIT: 0
```

PASS. Pre-command does not write to memory.rvf, so no lock contention.

### Step: hooks route (AFTER daemon started)

```
[INFO] Routing task: fix the auth bug
[HANGS — no output for 60+ seconds]
```

`ruflo hooks route` reliably hangs. Two separate invocations both hung. Killing with SIGTERM did not immediately stop the process (had to SIGKILL). The route command tries to acquire the RVF lock but blocks indefinitely rather than timing out.

Note: pre-task DID return successfully BEFORE daemon was running. So the underlying memory-router path works; it's the lock-contention with a running daemon that breaks it.

## Findings

### F-13-001 [CRITICAL] Daemon holds RVF lock continuously, breaking all hooks that write memory

- **Component**: `dist/src/commands/daemon.js` (Memory Archivist) + `dist/src/mcp-tools/hooks-tools.js`
- **Issue**: Once `daemon start` succeeds, the daemon's Memory Archivist holds `.swarm/memory.rvf` and `.swarm/memory.rvf.lock` open for the daemon's entire lifetime. Subsequent CLI hook invocations (`post-edit`, `post-command`, `post-task`, `route`) attempt to acquire the lock, wait 30s, then fail with `RVF error 0x0300: LockHeld`. Exit code is still 0, hiding the failure.
- **Evidence**:

  ```
  $ lsof .swarm/memory.rvf
  COMMAND   PID   USER   FD   TYPE   NODE  NAME
  node    39589 henrik   16u   REG   281367977 .swarm/memory.rvf

  $ ruflo hooks post-task --task-id task-X --result success
  [ERROR] Post-task hook failed: ...RVF error 0x0300: LockHeld...
  EXIT: 0
  ```

- **Impact**: HIGH. This is the documented "primary path" — `ruflo daemon start` runs background workers AND `ruflo hooks post-edit` writes memory. They are mutually exclusive in the current architecture. The user prompt (Claude Code session) fires hooks via `settings.json`, so EVERY hook fire that writes memory after `daemon start` silently fails. The system appears to be working (exit 0, success messages absent) but is not actually learning.
- **Suggested fix mentioned by error**: `"hooks.bridgeFallback": true` — but this enables a degraded path, not the primary path. Real fix: daemon should not hold the lock between writes (use lease/transaction pattern) OR the CLI hook commands should route memory writes THROUGH the daemon via IPC.

### F-13-002 [CRITICAL] `ruflo hooks route` hangs indefinitely when daemon holds lock

- **Component**: `dist/src/commands/hooks.js` (route subcommand)
- **Issue**: While `post-*` hooks at least timeout after 30s with a `LockHeld` error, `hooks route` simply hangs. No output, no exit. Killing with SIGTERM does not stop it (requires SIGKILL).
- **Evidence**:

  ```
  $ timeout 60 ./node_modules/.bin/ruflo hooks route -t "fix the auth bug"
  [AgentDB] Telemetry disabled
  [INFO] Routing task: fix the auth bug
  [60s elapsed, no further output, process still running, must SIGKILL]
  ```

- **Impact**: HIGH. Any UserPromptSubmit hook configured to call `hooks route` will block Claude Code's prompt processing. The settings.json default includes:

  ```json
  "UserPromptSubmit": [{
    "hooks": [{ "command": "...exec node $D/.claude/helpers/hook-handler.mjs route", "timeout": 10000 }]
  }]
  ```

  With a 10s timeout. So Claude Code itself would not hang — but every prompt submission times out and the routing hook silently fails. (Behaviour worth verifying separately.)

### F-13-003 [WARN] `daemon status` reports nonsense PID when not running

- **Component**: `dist/src/commands/daemon.js` status subcommand
- **Issue**: Pre-start, status shows `PID: 39011`. Post-stop, status shows `PID: 70890`. Neither is a real daemon. The displayed PID is likely the status-command's own PID, leaked into the rendering.
- **Evidence**:

  ```
  $ ruflo daemon status   # before any daemon was ever started in this sandbox
  +---- RuFlo Daemon ----+
  | Status: ○ STOPPED    |
  | PID: 39011           |   <-- garbage
  ...
  ```

- **Impact**: MEDIUM (cosmetic, but actively misleading). Users may believe there's a stale daemon process.

### F-13-004 [WARN] `daemon-state.json` not updated on `daemon stop`

- **Component**: `dist/src/commands/daemon.js` stop subcommand
- **Issue**: After clean `daemon stop`, the on-disk `daemon-state.json` still reports `"running": true`. CLI status reads `STOPPED` (via live PID check), but persistent state desynchronises from reality.
- **Evidence**:

  ```
  $ ruflo daemon stop
  ... Worker daemon stopped
  EXIT: 0

  $ cat .claude-flow/daemon-state.json
  { "running": true, ... }
  ```

- **Impact**: MEDIUM. If any consumer reads `daemon-state.json` instead of live-probing, they'll see incorrect state. Also a sign of incomplete stop logic — pid file gets removed (`.claude-flow/daemon.pid` is gone) but JSON state doesn't.

### F-13-005 [WARN] `daemon start` log message points to wrong path

- **Component**: `dist/src/commands/daemon.js` start subcommand
- **Issue**: Says `Logs: /.../.claude-flow/daemon.log`. Actual log file is at `.claude-flow/logs/daemon.log`. The path in the message does not exist.
- **Evidence**:

  ```
  [INFO] Logs: /private/tmp/ruflo-audit-hooks-daemon-21111/.claude-flow/daemon.log

  $ ls .claude-flow/daemon.log
  ls: .claude-flow/daemon.log: No such file or directory

  $ ls .claude-flow/logs/daemon.log
  .claude-flow/logs/daemon.log
  ```

- **Impact**: LOW. Misleading docs/log message.

### F-13-006 [WARN] `daemon ping`, `daemon info`, `daemon list-services` silently return help text

- **Component**: `dist/src/commands/daemon.js`
- **Issue**: Unknown subcommands fall through to a generic help printout instead of being rejected with "unknown subcommand". Tested: `ping`, `info`, `list-services` all returned the same text.
- **Evidence**:

  ```
  $ ruflo daemon ping
  RuFlo Daemon - Background Task Management
  Node.js-based background worker system...
  Available Workers
    - map         - Codebase mapping...
  EXIT: 0
  ```

  Identical output for `daemon info` and `daemon list-services`.

- **Impact**: LOW. Confusing — looks like the subcommand "succeeded" but did nothing.

### F-13-007 [WARN] Stale daemon process auto-killed across sandboxes

- **Component**: `dist/src/commands/daemon.js` start subcommand
- **Issue**: `daemon start` killed "stale daemon process (PID: 25248)" — which was not in this sandbox. The PID belongs to a separate prior test/audit run.
- **Evidence**:

  ```
  [WARN] Killed stale daemon process (PID: 25248)
  [INFO] Cleaned up 1 stale daemon process(es)
  ```

- **Impact**: MEDIUM. Concurrent users / parallel test sandboxes on the same machine will interfere with each other. Worth verifying scope of "stale" detection — does it match by binary path, PID file, or wider?

### F-13-008 [WARN] Misleading "SFVR magic" error message

- **Component**: `dist/src/mcp-tools/hooks-tools.js` storage initialization
- **Issue**: Error claims `native file has SFVR magic but RvfDatabase.open failed`. Actual file magic is `RVFROOT` (52 56 46 52 4f 4f 54). The error message references an old magic format.
- **Evidence**:

  ```
  $ head -c 7 .swarm/memory.rvf | hexdump -C
  00000000  52 56 46 52 4f 4f 54    |RVFROOT|
  ```

- **Impact**: LOW. User sees "file has SFVR magic" and may panic about corruption when the real issue is lock contention.

### F-13-009 [WARN] Hook failures return exit code 0

- **Component**: `dist/src/commands/hooks.js`
- **Issue**: When post-edit / post-task / post-command fail with LockHeld, they print `[ERROR]` to stderr but return exit code 0. Caller scripts that check `$?` cannot detect failure.
- **Evidence**:

  ```
  $ ruflo hooks post-task --task-id X --result success
  [ERROR] Post-task hook failed: ...LockHeld...
  EXIT: 0
  ```

- **Impact**: HIGH-MEDIUM. Combined with F-13-001, this means hooks invoked from `settings.json` will appear to succeed but no learning will occur. Users will not realise their system is silently broken.

### F-13-010 [NOTE] HookExecutor architecture confirmed dead

- **Component**: `dist/src/commands/hooks.js` execution architecture
- **Issue**: Prior recon's claim — that `HookExecutor` is dead architecture and the CLI uses `callMCPTool` instead — is CONFIRMED.
- **Evidence**:

  ```
  $ grep -c "HookExecutor" node_modules/@sparkleideas/cli/dist/src/commands/hooks.js
  0
  $ grep -c "callMCPTool" node_modules/@sparkleideas/cli/dist/src/commands/hooks.js
  34
  $ grep -rn "class HookExecutor" node_modules/@sparkleideas/cli/dist
  (no matches)
  ```

- **Impact**: NOTE. Confirms an existing architectural finding; suggests dead `HookExecutor` code in source could be removed.

### F-13-011 [NOTE] Hook metrics not updated

- **Component**: `dist/src/commands/hooks.js` + `.claude-flow/metrics/learning.json`
- **Issue**: After firing `hooks pre-task`, `hooks list` shows "Executions: blank" for all hooks. `.claude-flow/metrics/learning.json` shows `routing.decisions: 0`. Metrics file is initialized at `init` time but not updated by hook fires.
- **Evidence**:

  ```
  $ cat .claude-flow/metrics/learning.json
  { "initialized": "2026-05-19T22:24:47.775Z",
    "routing": { "accuracy": 0, "decisions": 0 },
    "patterns": { "shortTerm": 0, "longTerm": 0 },
    "sessions": { "total": 0, "current": null } }
  ```

- **Impact**: LOW-MEDIUM. The `hooks metrics` dashboard subcommand will not reflect actual usage. Telemetry is incomplete.

## Installed vs source distinction

- **Installed version**: `@sparkleideas/ruflo@3.1.0-alpha.14-patch.208` → dispatches to `@sparkleideas/cli@3.7.0-alpha.10-patch.237`
- **Issue in installed**: YES — all daemon/hooks findings observable in installed `dist/`
- **Issue in source**: PROBABLY YES (since fresh install of `@latest` shows them). Cannot easily compare against fork source — no `forks/` dir in this clone. The `dist/src/commands/hooks.js` and `dist/src/commands/daemon.js` files are the codemod-renamed dist of the upstream `claude-flow` source; the actual fork commits live in `forks/ruflo/` outside this repo.
- **Diagnosis**:
  - F-13-001 (lock contention) and F-13-002 (route hang): **needs-new-release after architectural fix** (require redesign of memory-router to coexist with daemon).
  - F-13-003/4/5/6/8 (cosmetic/messaging bugs): **needs-new-patch** (small fixes).
  - F-13-007 (cross-sandbox kill): **needs investigation** before fix.
  - F-13-009 (exit code 0 on error): **needs-new-patch**.
  - F-13-010 (dead HookExecutor): **NOTE only**, no action required (or cleanup-patch).
  - F-13-011 (metrics not updated): **needs-new-patch**.

## Method

### All commands run (in order)

1. `curl -sf http://localhost:4873/-/ping` — Verdaccio precondition PASS
2. `mkdir -p $SANDBOX && cd $SANDBOX && npm init -y`
3. `npm install --registry=http://localhost:4873 --no-audit --no-fund @sparkleideas/ruflo@latest`
4. `cat node_modules/@sparkleideas/ruflo/package.json` — version 3.1.0-alpha.14-patch.208
5. `./node_modules/.bin/ruflo init --force --no-global`
6. `./node_modules/.bin/ruflo daemon --help`
7. `./node_modules/.bin/ruflo daemon status` (pre-start)
8. `./node_modules/.bin/ruflo daemon start`
9. `./node_modules/.bin/ruflo daemon status` (post-start)
10. `./node_modules/.bin/ruflo daemon ping`, `daemon info`, `daemon list-services`, `daemon trigger -w audit`
11. `./node_modules/.bin/ruflo daemon start` (double-start refused)
12. `./node_modules/.bin/ruflo hooks --help`
13. `./node_modules/.bin/ruflo hooks list`
14. `./node_modules/.bin/ruflo hooks notify --message "test notify"`
15. `./node_modules/.bin/ruflo hooks pre-task --description test --task "echo hello"` — PRE-DAEMON, PASS
16. `./node_modules/.bin/ruflo hooks post-edit --file ${SANDBOX}/dummy.txt` — PRE-DAEMON, PASS
17. `./node_modules/.bin/ruflo hooks session-start` — PASS
18. `./node_modules/.bin/ruflo hooks route -t "fix the auth bug"` — HANG, killed
19. `./node_modules/.bin/ruflo hooks pre-command --command "ls"` — PASS
20. `./node_modules/.bin/ruflo hooks post-command --command "ls" --exit-code 0` — FAIL (LockHeld), exit 0
21. `./node_modules/.bin/ruflo hooks post-task --task-id X --result success` — FAIL (LockHeld), exit 0
22. `./node_modules/.bin/ruflo hooks post-edit --file dummy.txt` (second fire) — FAIL (LockHeld), exit 0
23. `./node_modules/.bin/ruflo daemon stop`
24. `./node_modules/.bin/ruflo daemon status` (post-stop)
25. Source inspection: `grep callMCPTool|HookExecutor node_modules/@sparkleideas/cli/dist/src/commands/hooks.js`
26. Lock state: `lsof .swarm/memory.rvf .swarm/memory.rvf.lock`
27. File magic: `head -c 7 .swarm/memory.rvf | hexdump -C` — `RVFROOT` not `SFVR`
28. Persisted state: `cat .claude-flow/daemon-state.json`

### All logs captured

All outputs tee'd to `${SANDBOX}/<step>.log`:

- `install.log`, `init.log`, `daemon-help.log`, `daemon-status-pre.log`, `daemon-start.log`, `ps-after-start.log`, `daemon-status-after.log`, `daemon-double-start.log`, `daemon-stop.log`, `daemon-status-final.log`
- `hooks-help.log`, `hooks-list.log`, `hooks-notify.log`, `hooks-pre-task.log`, `hooks-post-edit.log`, `hooks-session-start.log`, `hooks-route.log`, `hooks-route-retry.log`, `hooks-route-final.log`, `hooks-pre-command.log`, `hooks-post-command.log`, `hooks-post-task.log`, `hooks-post-edit-2.log`

## Recommendations

1. **CRITICAL — Redesign memory access from CLI hooks**. The daemon should not hold an exclusive RVF lock for its entire lifetime. Options:
   - Route hook memory writes through the daemon via the existing IPC socket (`.claude-flow/daemon.sock`).
   - Use shared/lease-based locking on RVF.
   - Use a write-ahead-log pattern where multiple writers can append.
2. **CRITICAL — Make hook commands fail-loud**. When `hooks post-*` fails with LockHeld, exit code MUST be non-zero. Per `feedback-no-fallbacks.md`: "tests must FAIL when features are broken, not pass via catch/fallback branches". Current behaviour (exit 0 with [ERROR] log) violates this principle.
3. **HIGH — Fix `hooks route` hang**. Either time out cleanly or fail fast on lock contention. Should never block indefinitely.
4. **MEDIUM — Fix `daemon status` PID display**. Don't print a misleading PID when daemon is STOPPED.
5. **MEDIUM — Fix `daemon stop` to update `daemon-state.json`**. Synchronise persisted state with reality.
6. **LOW — Fix log path message**. `Logs: ...` should point to `.claude-flow/logs/daemon.log`.
7. **LOW — Reject unknown daemon subcommands**. Don't silently return help text for `daemon ping`/`daemon info`/`daemon list-services`.
8. **LOW — Fix SFVR/RVFROOT magic message** to match current format.
9. **LOW — Investigate cross-sandbox PID killing**. `daemon start` killed PID 25248 outside the sandbox — needs scoping rules.
10. **NOTE — Remove dead HookExecutor code** in source (zero references in dist).
11. **NOTE — Wire hook metrics writes**. `.claude-flow/metrics/learning.json` should be updated when hooks fire.
