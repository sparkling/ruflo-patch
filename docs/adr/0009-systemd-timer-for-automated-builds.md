# ADR-0009: systemd timer for automated builds

## Status

Implemented

## Context

### Specification (SPARC-S)

The ruflo build pipeline needs to run automatically to keep packages current with upstream changes across multiple repos (`ruvnet/ruflo`, `ruvnet/agentic-flow`, `ruvnet/ruv-FANN`). The build server has 32 cores and 200GB RAM — more powerful than any hosted CI runner. The pipeline is a single linear sequence: poll upstream, pull, codemod, patch, build, test, publish, notify.

The requirements are:
- Run every 6 hours unattended
- Zero ongoing cost
- Build logs accessible for debugging
- Failure handling (don't silently break)
- Resource limits to prevent runaway builds
- No external service dependencies

### Pseudocode (SPARC-P)

```
EVERY 6 hours:
  systemd timer activates ruflo-sync.service
  -> ExecStart runs scripts/sync-and-build.sh as user claude
  -> script checks for upstream/local changes
  -> if changes found: pull, codemod, patch, build, test, publish, notify
  -> if no changes: exit 0
  -> on failure: journalctl captures full output
```

## Decision

### Architecture (SPARC-A)

> **Note (2026-03-16):** `sync-and-build.sh` was split into `ruflo-sync.sh` and `ruflo-publish.sh` per ADR-0038/0039. The systemd unit now calls these directly.

Use a systemd timer and a oneshot service to trigger the build script on a 6-hour cadence. No external CI system.

```ini
# /etc/systemd/system/ruflo-sync.timer
[Unit]
Description=Check upstream ruflo repos for changes

[Timer]
OnCalendar=*-*-* 00/6:00:00
Persistent=true

[Install]
WantedBy=timers.target
```

```ini
# /etc/systemd/system/ruflo-sync.service
[Unit]
Description=Sync and build ruflo from upstream
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=claude
WorkingDirectory=/home/claude/src/ruflo-patch
EnvironmentFile=/home/claude/.config/ruflo/secrets.env
ExecStart=/home/claude/src/ruflo-patch/scripts/sync-and-build.sh
CPUQuota=800%
TimeoutStartSec=3600
MemoryMax=32G
```

Activation:

```bash
systemctl enable --now ruflo-sync.timer
journalctl -u ruflo-sync     # view build logs
```

The bash script (`scripts/sync-and-build.sh`) handles the entire pipeline: polling upstream with `git ls-remote`, pulling, running the codemod, applying patches, building, testing, publishing to npm under the `prerelease` tag, and creating a GitHub prerelease for notification. See ADR-0010 for the publish gate, ADR-0011 for the dual trigger mechanism, and ADR-0018 for initial setup including secret management and disaster recovery.

### Considered Alternatives

1. **GitHub Actions self-hosted runner** — Rejected. Self-hosted runners now cost money. Our server is already running and more powerful than any GitHub-provided runner. Adding a runner agent is an unnecessary dependency on GitHub infrastructure.
2. **GitHub Actions hosted runners** — Rejected. Costs money per minute. Our 32-core server builds TypeScript in minutes. Paying for cloud compute we already own makes no sense.
3. **Woodpecker CI** — Rejected. Another service to install, configure, update, and monitor. Overkill for a single linear pipeline that a bash script handles.
4. **Forgejo + Actions** — Rejected. Running a full git forge just for CI is excessive when we already use GitHub for hosting and only need a timer.
5. **Cron** — Rejected. Works, but systemd timers provide better logging (`journalctl`), failure tracking (`systemctl status`), resource limits (`CPUQuota`), `Persistent=true` for missed runs, and calendar scheduling that doesn't require crontab syntax.
6. **Jenkins** — Rejected. Heavyweight Java application. Requires its own JVM, web server, plugin ecosystem. Massive operational overhead for a single pipeline.

## Consequences

### Refinement (SPARC-R)

**Positive:**

- Zero cost — uses existing hardware with no external services
- Zero external dependencies — no GitHub runner agent, no CI server, no cloud accounts
- Build logs are available via `journalctl -u ruflo-sync` with full systemd journal features (timestamps, filtering, persistence)
- `Persistent=true` ensures builds that were missed (e.g., server was off) run immediately on next boot
- `CPUQuota=800%` limits the build to 8 cores, leaving the remaining 24 cores available for other work
- `Type=oneshot` means systemd tracks the full lifecycle — `systemctl status` shows last run time, exit code, and duration
- Manual trigger is trivial: `sudo systemctl start ruflo-sync.service`

**Negative:**

- No web dashboard — you cannot view build history in a browser. Mitigation: the publish gate (ADR-0010) uses GitHub prereleases as a review UI, and `journalctl` is sufficient for debugging
- Tied to this specific server — if the server goes down, builds stop. Mitigation: `Persistent=true` catches up on reboot, and the publish gate means users on `@latest` are unaffected by downtime
- Requires root access to install the timer initially (one-time `systemctl enable`)

**Edge cases:**

- If the build script hangs (e.g., network timeout during `git ls-remote`), systemd does not enforce a timeout by default. The service unit should include `TimeoutStartSec=3600` to kill builds that exceed 1 hour
- If multiple timer events queue while a build is running, systemd will only run one instance at a time (oneshot services are not re-entrant). Queued events are collapsed into a single run. This means no additional lock file or concurrent run prevention mechanism is needed — `Type=oneshot` combined with the timer naturally prevents overlapping runs

### Completion (SPARC-C)

Acceptance criteria:

- [x] `ruflo-sync.timer` and `ruflo-sync.service` unit files installed in `/etc/systemd/system/`
- [x] `systemctl enable --now ruflo-sync.timer` activates the timer
- [x] `systemctl list-timers` shows next scheduled run
- [x] `journalctl -u ruflo-sync` captures build output
- [x] `systemctl start ruflo-sync.service` triggers an immediate manual build
- [x] Build completes without interactive prompts (fully unattended)
- [x] `CPUQuota=800%` verified via `systemd-cgtop` during a build
