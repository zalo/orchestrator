#!/bin/bash
# collect-logs.sh - Collect all evaluation data from orchestrator APIs and logs

set -e

WORKSPACE_ID=$1
RUN_LABEL=${2:-""}
API_BASE=${3:-"http://localhost:3001"}

if [ -z "$WORKSPACE_ID" ]; then
  echo "Usage: ./collect-logs.sh <workspace-id> [run-label] [api-base-url]"
  echo ""
  echo "Examples:"
  echo "  ./collect-logs.sh 80acc8ce-7ebe-4cc8-96f6-02e16400545e"
  echo "  ./collect-logs.sh 80acc8ce-7ebe-4cc8-96f6-02e16400545e baseline"
  echo "  ./collect-logs.sh 80acc8ce-7ebe-4cc8-96f6-02e16400545e after-review-gate"
  echo ""
  echo "Run labels help identify and compare evaluation runs."
  exit 1
fi

# Create output directory with timestamp and optional label
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
if [ -n "$RUN_LABEL" ]; then
  OUTPUT_DIR="./eval-output/${TIMESTAMP}_${RUN_LABEL}"
else
  OUTPUT_DIR="./eval-output/${TIMESTAMP}"
fi
mkdir -p "$OUTPUT_DIR"

echo "Collecting evaluation data..."
echo "Workspace ID: $WORKSPACE_ID"
echo "Output directory: $OUTPUT_DIR"
echo ""

# Collect JSON data from APIs
echo "Fetching beads..."
curl -s "${API_BASE}/api/beads?workspaceId=${WORKSPACE_ID}" > "$OUTPUT_DIR/beads.json"

echo "Fetching agents..."
curl -s "${API_BASE}/api/agents?workspaceId=${WORKSPACE_ID}" > "$OUTPUT_DIR/agents.json"

echo "Fetching progress (limit 2000)..."
curl -s "${API_BASE}/api/progress?workspaceId=${WORKSPACE_ID}&limit=2000" > "$OUTPUT_DIR/progress.json"

echo "Fetching messages..."
curl -s "${API_BASE}/api/messages?workspaceId=${WORKSPACE_ID}" > "$OUTPUT_DIR/messages.json"

echo "Fetching merge queue..."
curl -s "${API_BASE}/api/merge-queue?workspaceId=${WORKSPACE_ID}" > "$OUTPUT_DIR/merge-queue.json"

echo "Fetching stats..."
curl -s "${API_BASE}/api/stats?workspaceId=${WORKSPACE_ID}" > "$OUTPUT_DIR/stats.json"

echo "Fetching workspace info..."
curl -s "${API_BASE}/api/workspaces/${WORKSPACE_ID}" > "$OUTPUT_DIR/workspace.json"

# Find and copy tmux logs
DATA_DIR="./data/workspaces/${WORKSPACE_ID}"
LOGS_DIR="${DATA_DIR}/logs"

if [ -d "$LOGS_DIR" ]; then
  echo "Copying terminal logs..."
  mkdir -p "$OUTPUT_DIR/terminal-logs"
  cp "$LOGS_DIR"/*.log "$OUTPUT_DIR/terminal-logs/" 2>/dev/null || echo "No logs found"

  # Create log manifest
  echo "Creating log manifest..."
  ls -la "$OUTPUT_DIR/terminal-logs/" > "$OUTPUT_DIR/terminal-logs/manifest.txt" 2>/dev/null || true
else
  echo "No logs directory found at $LOGS_DIR"
  mkdir -p "$OUTPUT_DIR/terminal-logs"
fi

# Copy prompts if they exist
PROMPTS_DIR="${DATA_DIR}/prompts"
if [ -d "$PROMPTS_DIR" ]; then
  echo "Copying agent prompts..."
  mkdir -p "$OUTPUT_DIR/prompts"
  cp "$PROMPTS_DIR"/*.md "$OUTPUT_DIR/prompts/" 2>/dev/null || echo "No prompts found"
fi

# Create metadata file
echo "Creating metadata..."
cat > "$OUTPUT_DIR/metadata.json" << EOF
{
  "workspaceId": "${WORKSPACE_ID}",
  "runLabel": "${RUN_LABEL}",
  "collectedAt": "$(date -Iseconds)",
  "apiBase": "${API_BASE}",
  "outputDir": "${OUTPUT_DIR}"
}
EOF

# Summary
echo ""
echo "============================================"
echo "Collection complete!"
echo "Output: $OUTPUT_DIR"
echo ""
echo "Files collected:"
ls -la "$OUTPUT_DIR"
echo ""
echo "To analyze, run:"
echo "  npx ts-node eval/analyze.ts $OUTPUT_DIR"
