#!/usr/bin/env bash
#
# install-systemd.sh — Install ruflo-pipeline systemd timer and service units.
#
# Must be run as root (or via sudo).
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

TIMER_SRC="$REPO_DIR/config/ruflo-pipeline.timer"
SERVICE_SRC="$REPO_DIR/config/ruflo-pipeline.service"
SYSTEMD_DIR="/etc/systemd/system"

SECRETS_DIR="/home/claude/.config/ruflo"
SECRETS_FILE="$SECRETS_DIR/secrets.env"

# Unit names (installed under these names regardless of source filename)
UNIT_TIMER="ruflo-pipeline.timer"
UNIT_SERVICE="ruflo-pipeline.service"

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

# ── 3. Stop old units if they exist (migration from ruflo-sync → ruflo-pipeline)

for old_unit in ruflo-sync.timer ruflo-sync.service; do
    if systemctl is-active --quiet "$old_unit" 2>/dev/null; then
        echo "Stopping old unit: $old_unit"
        systemctl stop "$old_unit"
    fi
    if systemctl is-enabled --quiet "$old_unit" 2>/dev/null; then
        echo "Disabling old unit: $old_unit"
        systemctl disable "$old_unit"
    fi
    [[ -f "$SYSTEMD_DIR/$old_unit" ]] && rm -f "$SYSTEMD_DIR/$old_unit"
done

# ── 4. Copy unit files to systemd ───────────────────────────────────────────

echo "Copying unit files to $SYSTEMD_DIR/ ..."
cp "$TIMER_SRC"   "$SYSTEMD_DIR/$UNIT_TIMER"
cp "$SERVICE_SRC" "$SYSTEMD_DIR/$UNIT_SERVICE"
chmod 644 "$SYSTEMD_DIR/$UNIT_TIMER"
chmod 644 "$SYSTEMD_DIR/$UNIT_SERVICE"
echo "  OK"

# ── 5. Create secrets directory ─────────────────────────────────────────────

NEEDS_SECRETS=false

echo "Ensuring secrets directory exists at $SECRETS_DIR ..."
mkdir -p "$SECRETS_DIR"
chown claude:claude "$SECRETS_DIR"
chmod 700 "$SECRETS_DIR"
echo "  OK"

# ── 6. Create secrets template if missing ───────────────────────────────────

if [[ ! -f "$SECRETS_FILE" ]]; then
    NEEDS_SECRETS=true
    echo "WARNING: $SECRETS_FILE does not exist. Creating template..."
    cat > "$SECRETS_FILE" <<'TMPL'
# ruflo secrets — loaded by ruflo-pipeline.service via EnvironmentFile=
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

# ── 7. Reload systemd and enable timer ──────────────────────────────────────

echo "Reloading systemd daemon ..."
systemctl daemon-reload
echo "  OK"

echo "Enabling $UNIT_TIMER ..."
systemctl enable --now "$UNIT_TIMER"
echo "  OK"

# ── 8. Show timer status ───────────────────────────────────────────────────

echo ""
echo "Timer status:"
systemctl list-timers ruflo-pipeline*
echo ""

# ── 9. Print next steps if secrets need configuration ───────────────────────

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
    echo "     sudo systemctl start $UNIT_SERVICE"
    echo "     journalctl -u ruflo-pipeline -f"
    echo ""
else
    echo "Installation complete. The timer will fire every 6 hours."
    echo "To trigger a manual run: sudo systemctl start $UNIT_SERVICE"
    echo "To view logs:           journalctl -u ruflo-pipeline"
fi
