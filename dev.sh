#!/bin/bash

# Development script for Agent Orchestrator
# Runs both server and frontend with hot reload

cd "$(dirname "$0")"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}Starting Agent Orchestrator in development mode...${NC}"

# Check if node_modules exist
if [ ! -d "server/node_modules" ]; then
    echo -e "${CYAN}Installing server dependencies...${NC}"
    (cd server && npm install)
fi

if [ ! -d "frontend/node_modules" ]; then
    echo -e "${CYAN}Installing frontend dependencies...${NC}"
    (cd frontend && npm install)
fi

# Start server in background
echo -e "${GREEN}Starting backend server on port 3001...${NC}"
(cd server && PORT=3001 npm run dev) &
SERVER_PID=$!

# Wait for server to be ready
sleep 2

# Start frontend
echo -e "${GREEN}Starting frontend dev server on port 3003...${NC}"
(cd frontend && npm run dev -- --host 0.0.0.0 --port 3003) &
FRONTEND_PID=$!

# Trap to clean up on exit
cleanup() {
    echo -e "\n${RED}Shutting down...${NC}"
    kill $SERVER_PID 2>/dev/null
    kill $FRONTEND_PID 2>/dev/null
    exit 0
}

trap cleanup SIGINT SIGTERM

echo -e "${GREEN}Development servers running!${NC}"
echo -e "  Frontend: http://localhost:3003"
echo -e "  Backend:  http://localhost:3001"
echo -e "Press Ctrl+C to stop."

wait
