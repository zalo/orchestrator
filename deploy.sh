#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_NAME="orchestrator-server"

echo "=== Deploying Orchestrator Server ==="

# If called with --install-only, skip builds and require root
if [[ "$1" == "--install-only" ]]; then
    if [[ $EUID -ne 0 ]]; then
        echo "Error: --install-only requires root"
        exit 1
    fi
else
    # Build steps run as regular user (npm may not be in root's PATH)
    echo "Building server..."
    cd "$SCRIPT_DIR/server"
    npm install --include=dev
    npm run build

    # Build the frontend
    echo "Building frontend..."
    cd "$SCRIPT_DIR/frontend"
    npm install --include=dev
    npm run build

    # Check for root for systemd operations
    if [[ $EUID -ne 0 ]]; then
        echo ""
        echo "Build complete. Re-running with sudo for systemd operations..."
        exec sudo "$SCRIPT_DIR/deploy.sh" --install-only
    fi
fi

# Install systemd service (requires root)
echo "Installing systemd service..."
cp "$SCRIPT_DIR/orchestrator-server.service" /etc/systemd/system/
systemctl daemon-reload

# Enable and restart the service
echo "Starting service..."
systemctl enable "$SERVICE_NAME"
systemctl restart "$SERVICE_NAME"

# Ensure cloudflared tunnel is running (user service, run as original user)
echo "Restarting cloudflared tunnel..."
sudo -u "$SUDO_USER" XDG_RUNTIME_DIR="/run/user/$(id -u "$SUDO_USER")" systemctl --user restart cloudflared-terminal.service

# Show status
echo ""
echo "=== Deployment Complete ==="
systemctl status "$SERVICE_NAME" --no-pager
echo ""
sudo -u "$SUDO_USER" XDG_RUNTIME_DIR="/run/user/$(id -u "$SUDO_USER")" systemctl --user status cloudflared-terminal.service --no-pager

echo ""
echo "View logs with: journalctl -u $SERVICE_NAME -f"
echo "Site available at: https://orchestrator.sels.tech"
