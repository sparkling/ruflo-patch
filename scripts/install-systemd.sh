#!/usr/bin/env bash
#
# install-systemd.sh — Install ruflo-sync systemd timer and service units.
#
# Must be run as root (or via sudo).
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

TIMER_SRC="$REPO_DIR/config/ruflo-sync.timer"
SERVICE_SRC="$REPO_DIR/config/ruflo-sync.service"
SYSTEMD_DIR="/etc/systemd/system"

SECRETS_DIR="/home/claude/.config/ruflo"
SECRETS_FILE="$SECRETS_DIR/secrets.env"

# ── 1. Check for root privileges ────────────────────────────────────────────

if [[ $EUID -ne 0 ]]; then
    echo "ERROR: This script must be run as root (or with sudo)."
    exit 1
fi

# ── 2. Verify source files exist ────────────────────────────────────────────

for f in "$TIMER_SRC" "$SERVICE_SRC"; do
    if [[ ! -f "$f" ]]; then
        echo "ERROR: Missing unit file: $f"
        exit 1
    fi
done

# ── 3. Copy unit files to systemd ───────────────────────────────────────────

echo "Copying unit files to $SYSTEMD_DIR/ ..."
cp "$TIMER_SRC"   "$SYSTEMD_DIR/ruflo-sync.timer"
cp "$SERVICE_SRC" "$SYSTEMD_DIR/ruflo-sync.service"
chmod 644 "$SYSTEMD_DIR/ruflo-sync.timer"
chmod 644 "$SYSTEMD_DIR/ruflo-sync.service"
echo "  OK"

# ── 4. Create secrets directory ─────────────────────────────────────────────

NEEDS_SECRETS=false

echo "Ensuring secrets directory exists at $SECRETS_DIR ..."
mkdir -p "$SECRETS_DIR"
chown claude:claude "$SECRETS_DIR"
chmod 700 "$SECRETS_DIR"
echo "  OK"

# ── 5. Create secrets template if missing ───────────────────────────────────

if [[ ! -f "$SECRETS_FILE" ]]; then
    NEEDS_SECRETS=true
    echo "WARNING: $SECRETS_FILE does not exist. Creating template..."
    cat > "$SECRETS_FILE" <<'TMPL'
# ruflo secrets — loaded by ruflo-sync.service via EnvironmentFile=
# Replace placeholder values with real tokens before enabling the timer.
#
# npm automation token (bypasses 2FA): npm token create --type=automation
NPM_TOKEN=npm_REPLACE_ME
#
# GitHub PAT with repo and write:packages scopes
GH_TOKEN=ghp_REPLACE_ME
TMPL
    chown claude:claude "$SECRETS_FILE"
    chmod 600 "$SECRETS_FILE"
    echo "  Template created at $SECRETS_FILE"
else
    echo "  $SECRETS_FILE already exists — skipping"
fi

# ── 6. Reload systemd and enable timer ──────────────────────────────────────

echo "Reloading systemd daemon ..."
systemctl daemon-reload
echo "  OK"

echo "Enabling ruflo-sync.timer ..."
systemctl enable --now ruflo-sync.timer
echo "  OK"

# ── 7. Show timer status ───────────────────────────────────────────────────

echo ""
echo "Timer status:"
systemctl list-timers ruflo-sync*
echo ""

# ── 8. Print next steps if secrets need configuration ───────────────────────

if [[ "$NEEDS_SECRETS" == "true" ]]; then
    echo "================================================================"
    echo "  NEXT STEPS: Configure secrets before the first timer run"
    echo "================================================================"
    echo ""
    echo "  1. Edit $SECRETS_FILE"
    echo "     - Set NPM_TOKEN to a valid npm automation token"
    echo "     - Set GH_TOKEN to a GitHub PAT with repo + write:packages"
    echo ""
    echo "  2. Verify permissions:"
    echo "     ls -la $SECRETS_FILE"
    echo "     (should show -rw------- claude claude)"
    echo ""
    echo "  3. Test the service manually:"
    echo "     sudo systemctl start ruflo-sync.service"
    echo "     journalctl -u ruflo-sync -f"
    echo ""
else
    echo "Installation complete. The timer will fire every 6 hours."
    echo "To trigger a manual run: sudo systemctl start ruflo-sync.service"
    echo "To view logs:           journalctl -u ruflo-sync"
fi
