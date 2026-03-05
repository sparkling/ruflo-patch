# ADR-0018: Initial Setup Runbook

## Status

Accepted

## Context

### Specification (SPARC-S)

The ruflo build pipeline requires one-time setup: GitHub forks, an npm scope, authentication tokens, systemd units, and local state files. No ADR documented this setup, leaving it as tribal knowledge. If the build server is lost, a new maintainer would need to reconstruct the entire environment from scratch with no guide.

The bus factor is 1 (sole maintainer, sole server). Disaster recovery requires that every setup step be documented, version-controlled, and repeatable. Secret management must be explicit -- where tokens are stored, how they are loaded into the build, and how they are rotated.

This addresses review issues O1 (disaster recovery), C5 (secret management), and the missing setup documentation identified in the ADR review report.

### Pseudocode (SPARC-P)

```
# One-time setup sequence

STEP 1 — Prerequisites:
  VERIFY node >= 20, pnpm >= 8, gh CLI, npm CLI, git

STEP 2 — GitHub forks:
  gh repo fork ruvnet/ruflo --clone=false --remote-name upstream
  gh repo fork ruvnet/agentic-flow --clone=false --remote-name upstream
  gh repo fork ruvnet/ruv-FANN --clone=false --remote-name upstream
  git clone <your-fork-of-ruflo> /home/claude/src/upstream/ruflo
  git clone <your-fork-of-agentic-flow> /home/claude/src/upstream/agentic-flow
  git clone <your-fork-of-ruv-FANN> /home/claude/src/upstream/ruv-FANN

STEP 3 — npm scope:
  npm org create sparkleideas
  npm token create --type=automation  # bypasses 2FA
  STORE token in secrets.env

STEP 4 — Secrets file:
  mkdir -p /home/claude/.config/ruflo
  WRITE secrets.env with NPM_TOKEN and GH_TOKEN
  chmod 600 secrets.env

STEP 5 — systemd units:
  INSTALL ruflo-sync.timer and ruflo-sync.service
  systemctl daemon-reload
  systemctl enable --now ruflo-sync.timer

STEP 6 — Initial state:
  WRITE scripts/.last-build-state with current upstream HEADs

STEP 7 — First build:
  ./scripts/sync-and-build.sh
  npm dist-tag add ruflo@{VERSION} latest  # first publish bootstrap

STEP 8 — Verify:
  npx ruflo --version
```

## Decision

### Architecture (SPARC-A)

Document the complete setup procedure as a version-controlled ADR so it is reviewable and reproducible. The runbook covers seven areas: prerequisites, GitHub forks, npm scope, secret management, systemd configuration, initial state, and first build.

**1. Prerequisites**

The build server requires:

- Node.js >= 20 (LTS)
- pnpm >= 8
- `gh` CLI (authenticated with a GitHub account that owns the forks)
- `npm` CLI (included with Node.js)
- `git` >= 2.30
- `jq` (used by build scripts for JSON manipulation)
- `python3` >= 3.8 (used by `patch/*/fix.py` scripts)

**2. GitHub Forks**

Fork the following upstream repos as clean mirrors. No modifications are ever committed to the forks (per ADR-0005):

- `ruvnet/ruflo` -- the main monorepo (20 `@claude-flow/*` packages, CLI, ruflo wrapper)
- `ruvnet/agentic-flow` -- `agentic-flow` and `agentdb` packages
- `ruvnet/ruv-FANN` -- `ruv-swarm` package

Clone each fork locally:

```
/home/claude/src/upstream/ruflo
/home/claude/src/upstream/agentic-flow
/home/claude/src/upstream/ruv-FANN
```

Each clone must have the upstream remote configured for change detection:

```bash
cd /home/claude/src/upstream/ruflo
git remote add upstream https://github.com/ruvnet/ruflo.git
```

**3. npm Scope**

Register the `@sparkleideas` organization on npmjs.com. This requires an npm account with a verified email. Create an automation token (which bypasses 2FA for CI use):

```bash
npm token create --type=automation
```

**4. Secret Management**

All secrets are stored in a single file with restricted permissions:

```
/home/claude/.config/ruflo/secrets.env
```

Contents:

```bash
NPM_TOKEN=npm_xxxxx
GH_TOKEN=ghp_xxxxx
```

Permissions: `chmod 600 /home/claude/.config/ruflo/secrets.env`, owned by the `claude` user. The directory itself is `chmod 700`.

The systemd service loads this file via `EnvironmentFile=`. The build script reads `NPM_TOKEN` for `npm publish` and `GH_TOKEN` for `gh release create` and `gh issue create`. No secrets are passed as command-line arguments (which would be visible in `/proc`).

**Secret rotation procedure:**

- **npm token**: Log into npmjs.com, revoke the old token, create a new automation token. Update `secrets.env` with the new value. No service restart needed -- the next timer run reads the file fresh.
- **GitHub token**: Log into github.com, revoke the old PAT, create a new one with `repo` and `write:packages` scopes. Update `secrets.env`. No service restart needed.
- **Rotation frequency**: Rotate both tokens at least annually, or immediately if a compromise is suspected.

**5. systemd Configuration**

Install two unit files:

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
WorkingDirectory=/home/claude/src/ruflo
EnvironmentFile=/home/claude/.config/ruflo/secrets.env
ExecStart=/home/claude/src/ruflo/scripts/sync-and-build.sh
TimeoutStartSec=3600
MemoryMax=32G
CPUQuota=800%
```

Enable with:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now ruflo-sync.timer
```

**6. Initial State**

Create the build state file so the first run has a baseline to compare against:

```bash
mkdir -p /home/claude/src/ruflo/scripts
cat > /home/claude/src/ruflo/scripts/.last-build-state <<EOF
RUFLO_HEAD=$(git -C /home/claude/src/upstream/ruflo rev-parse HEAD)
AGENTIC_HEAD=$(git -C /home/claude/src/upstream/agentic-flow rev-parse HEAD)
FANN_HEAD=$(git -C /home/claude/src/upstream/ruv-FANN rev-parse HEAD)
PATCH_HEAD=$(git -C /home/claude/src/ruflo rev-parse HEAD)
LAST_VERSION=0.0.0-patch.0
PATCH_ITERATION=0
EOF
```

**7. First Build and Bootstrap**

Run the build script manually for the first time:

```bash
./scripts/sync-and-build.sh
```

The first `npm publish` is special (per ADR-0015): it must set the `latest` dist-tag. The build script detects that no previous version exists on npm and publishes without `--tag prerelease`:

```bash
npm publish   # sets latest automatically on first publish
```

All subsequent publishes use `--tag prerelease` as specified in ADR-0010.

Verify the publish succeeded:

```bash
npx ruflo --version   # should print the published version
npm view ruflo dist-tags   # should show latest
```

### Considered Alternatives

1. **Store secrets in environment variables set in `.bashrc`** -- Rejected. Environment variables persist across all processes for the user, increasing exposure surface. A dedicated `EnvironmentFile` loaded only by the systemd service limits exposure to the build process.

2. **Use a secrets manager (HashiCorp Vault, AWS Secrets Manager)** -- Rejected. Adds infrastructure complexity disproportionate to the scale (2 tokens, 1 server, 1 maintainer). A `chmod 600` file on a single-user server provides adequate protection. If the project grows to multiple maintainers or servers, revisit this decision.

3. **Document setup in a README instead of an ADR** -- Rejected. ADRs are the established format for decisions in this project. A runbook is a decision about how setup is performed. Keeping it in the ADR series ensures it is reviewed alongside other architectural decisions and benefits from the SPARC structure.

4. **Automate setup with a bootstrap script** -- Considered for future work. The manual steps described here are a prerequisite for writing such a script. Once the runbook is validated by performing setup at least once, the steps can be automated. Premature automation of an untested procedure creates a script that encodes mistakes.

## Consequences

### Refinement (SPARC-R)

**Positive:**

- A new maintainer can reconstruct the entire build environment from this document alone
- Secret management is explicit -- where tokens live, how they are loaded, how to rotate them
- systemd configuration includes production hardening (`TimeoutStartSec`, `MemoryMax`, `After=network-online.target`) that was missing from earlier ADRs
- The runbook is version-controlled, so changes to the setup procedure are tracked in git history

**Negative:**

- The runbook must be updated whenever the setup procedure changes (new prerequisites, new repos, new secrets)
- Token values are not in version control (by design), so the `secrets.env` file must be recreated from the npm and GitHub accounts if the server is lost
- The bus factor remains 1 for account access -- only the account owner can regenerate tokens

**Edge cases:**

- If the npm `@sparkleideas` org is deleted or the owning account is lost, a new org must be registered and all packages republished under it. Package names on npm are globally unique; if the org name is taken, a different scope must be chosen, requiring updates to the codemod mapping
- If GitHub forks are deleted, re-forking is trivial (`gh repo fork`), but the local clones must be re-pointed to the new fork URLs
- If the build server changes architecture (e.g., x86 to ARM), `better-sqlite3` and any native addons must be rebuilt. The build script handles this via `pnpm install` which triggers native compilation

### Completion (SPARC-C)

Acceptance criteria:

- [ ] A fresh server can be set up from scratch following only this document and the referenced ADRs
- [ ] `secrets.env` exists at the documented path with `chmod 600`
- [ ] systemd timer is active and fires every 6 hours
- [ ] systemd service includes `After=network-online.target`, `TimeoutStartSec=3600`, `MemoryMax=32G`
- [ ] `EnvironmentFile` is the sole mechanism for providing secrets to the build
- [ ] First build completes successfully and publishes to npm
- [ ] `npx ruflo --version` returns the expected version after first build
- [ ] Secret rotation can be performed without service downtime
- [ ] `.last-build-state` is created with valid upstream HEADs
