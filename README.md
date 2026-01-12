# Agent Orchestrator

A web interface for managing multi-agent Claude Code workflows, based on the Agent Orchestration Blueprint.

## Blueprint Adherence

| Blueprint Area | Status | Implementation |
|---------------|--------|----------------|
| **Beads (Work Items)** | ✅ Full | ID, status, priority, dependencies, assignee, audit trail |
| **Git Worktrees** | ✅ Full | Auto-created per sub-agent, isolated branches |
| **Merge Queue** | ✅ Full | Sequential merge, rebase notifications, conflict detection |
| **Agent Roles** | ✅ Full | Mayor (Opus), Specialist, Reviewer, Explorer |
| **Model Allocation** | ✅ Full | Opus/Sonnet/Haiku by cognitive demand |
| **CLAUDE.md** | ✅ Full | Project conventions, build commands, architecture |
| **Skills System** | ✅ Full | On-demand knowledge in `.claude/skills/` |
| **Bootstrap Protocol** | ✅ Full | Auto project exploration, cached context |
| **Inter-Agent Messaging** | ✅ Full | Typed messages (info, action_required, completion, blocker) |
| **Progress Coordination** | ✅ Full | Shared log with status, completed, next, artifacts |
| **Test Verification** | ✅ Full | Required test pass before bead completion |
| **Hierarchical Delegation** | ⚠️ Partial | Flat sub-agents only (no nested spawning) |
| **File Ownership** | ⚠️ Partial | Informational tracking (worktrees provide isolation) |
| **Gas Town 7 Roles** | ❌ None | Using simplified 4-role model instead |
| **Context Compaction** | ❌ None | Relies on sub-agent delegation |
| **Beads CLI (`bd`)** | ❌ None | REST API only (no CLI integration) |

See [docs/agent-orchestration-blueprint.md](docs/agent-orchestration-blueprint.md) for the full blueprint.

## Features

- **Beads Management**: Track work items with priorities, dependencies, and audit trails
- **Agent Registry**: Register and manage agents with roles (orchestrator, specialist, reviewer, explorer) and models (opus, sonnet, haiku)
- **Live Terminals**: Open tmux-backed terminal sessions for each agent
- **Progress Log**: Timeline of agent activity with completed items, next steps, and blockers
- **Inter-agent Messaging**: Send messages between agents with different types (info, action_required, completion, blocker)
- **Real-time Updates**: WebSocket connection for live dashboard updates

## Prerequisites

- Node.js 20+
- tmux
- npm

## Installation

```bash
cd /home/selstad/Desktop/terminal-workspace/orchestrator

# Install server dependencies
cd server
npm install --include=dev
npm run build
cd ..

# Install frontend dependencies
cd frontend
npm install --include=dev
npm run build
cd ..
```

## Running

### Development Mode

```bash
./dev.sh
```

This starts:
- Backend server on port 3001
- Frontend dev server on port 3003 with hot reload

Access at http://localhost:3003

### Production Mode

```bash
cd server
PORT=3001 DATA_DIR=/home/selstad/Desktop/terminal-workspace/orchestrator/data node dist/server.js
```

The server serves the built frontend from `frontend/dist/`.

Access at http://localhost:3001

### As a Systemd Service

```bash
# Copy service file
sudo cp orchestrator-server.service /etc/systemd/system/

# Reload systemd
sudo systemctl daemon-reload

# Enable and start
sudo systemctl enable --now orchestrator-server

# Check status
sudo systemctl status orchestrator-server

# View logs
journalctl -u orchestrator-server -f
```

## Cloudflare Tunnel

The orchestrator is configured to be accessible via `orchestrator.sels.tech` through Cloudflare Tunnel.

The tunnel configuration in `~/.cloudflared/config.yml` includes:

```yaml
- hostname: orchestrator.sels.tech
  service: http://localhost:3001
```

After updating the config, restart the cloudflared tunnel:

```bash
# If running as a service
sudo systemctl restart cloudflared

# Or manually restart the tunnel process
```

## API Endpoints

### Beads

- `GET /api/beads` - List all beads
- `GET /api/beads/:id` - Get single bead
- `GET /api/beads/next/available` - Get next available (unblocked, todo) bead
- `POST /api/beads` - Create bead
- `PATCH /api/beads/:id` - Update bead
- `DELETE /api/beads/:id` - Delete bead

### Agents

- `GET /api/agents` - List all agents
- `GET /api/agents/:id` - Get single agent
- `POST /api/agents` - Register agent
- `PATCH /api/agents/:id` - Update agent
- `POST /api/agents/:id/heartbeat` - Agent heartbeat
- `DELETE /api/agents/:id` - Delete agent

### Progress

- `GET /api/progress` - Get progress log (supports `?agentId=` and `?limit=` query params)
- `POST /api/progress` - Add progress entry

### Messages

- `GET /api/messages` - Get messages (supports `?to=` and `?unread=true` query params)
- `POST /api/messages` - Send message
- `PATCH /api/messages/:id/read` - Mark message as read

### Stats

- `GET /api/stats` - Get dashboard statistics

## WebSocket Endpoints

- `/ws` - Dashboard real-time updates (beads, agents, progress, messages)
- `/ws/terminal?session=<name>` - Terminal WebSocket for tmux sessions

## Data Storage

Data is stored as JSON files in the `data/` directory:

- `beads.json` - Work items
- `agents.json` - Agent registry
- `progress.json` - Progress log entries
- `messages.json` - Inter-agent messages

## Environment Variables

- `PORT` - Server port (default: 3001)
- `DATA_DIR` - Data directory path (default: `./data`)

## Project Structure

```
orchestrator/
├── server/
│   ├── src/
│   │   └── server.ts          # Express server with WebSocket
│   ├── dist/                  # Compiled output
│   ├── package.json
│   └── tsconfig.json
├── frontend/
│   ├── src/
│   │   ├── App.tsx           # Main application
│   │   ├── types.ts          # TypeScript types
│   │   └── components/
│   │       ├── Dashboard.tsx      # Stats overview
│   │       ├── BeadsList.tsx      # Work item management
│   │       ├── AgentsList.tsx     # Agent registry
│   │       ├── ProgressLog.tsx    # Activity timeline
│   │       ├── MessagesView.tsx   # Inter-agent messaging
│   │       └── Terminal.tsx       # xterm.js terminal
│   ├── dist/                 # Built frontend
│   ├── package.json
│   └── vite.config.ts
├── data/                     # Persistent JSON storage
├── dev.sh                    # Development script
├── orchestrator-server.service  # Systemd service file
└── README.md
```

## Related

This project is a sequel to the [Mobile Terminal](../terminal/) project and implements concepts from the Agent Orchestration Blueprint.
