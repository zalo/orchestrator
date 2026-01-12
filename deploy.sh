#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_NAME="orchestrator-server"

echo "=== Deploying Orchestrator Server ==="

# Build the server
echo "Building server..."
cd "$SCRIPT_DIR/server"
npm install --include=dev
npm run build

# Build the frontend
echo "Building frontend..."
cd "$SCRIPT_DIR/frontend"
npm install --include=dev
npm run build

# Install systemd service
echo "Installing systemd service..."
sudo cp "$SCRIPT_DIR/orchestrator-server.service" /etc/systemd/system/
sudo systemctl daemon-reload

# Enable and restart the service
echo "Starting service..."
sudo systemctl enable "$SERVICE_NAME"
sudo systemctl restart "$SERVICE_NAME"

# Ensure cloudflared tunnel is running (user service, no sudo needed)
echo "Restarting cloudflared tunnel..."
systemctl --user restart cloudflared-terminal.service

# Show status
echo ""
echo "=== Deployment Complete ==="
sudo systemctl status "$SERVICE_NAME" --no-pager
echo ""
systemctl --user status cloudflared-terminal.service --no-pager

echo ""
echo "View logs with: journalctl -u $SERVICE_NAME -f"
echo "Site available at: https://orchestrator.sels.tech"
