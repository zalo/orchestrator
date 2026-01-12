# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Mayor Orchestrator is a web interface for orchestrating multi-agent Claude Code workflows. A single "Mayor" agent (Opus model) runs in each workspace as the primary interface, conversing with users while creating beads (tasks), spawning sub-agents, and coordinating work.

Key concepts:
- **Workspace**: Container for a working directory with its own Mayor, agents, beads, and data
- **Mayor**: Primary Opus coordinator running in tmux, converses with user naturally
- **Beads**: Atomic work items with status (todo/in_progress/done/blocked), priority, dependencies
- **Sub-agents**: Specialists spawned by Mayor for parallel work (sonnet/haiku models)
- **Context preservation**: Mayor delegates builds/tests to sub-agents to preserve context window

## Prerequisites

- Node.js 20+
- tmux
- Claude CLI (`claude` command available in PATH)

## Commands

### Development
```bash
./dev.sh                    # Start both servers with hot reload (frontend: 3003, backend: 3001)
```

### Server
```bash
cd server
npm install --include=dev
npm run build              # TypeScript compile
npm run dev                # Development with hot reload (tsx watch)
npm run start              # Production (requires build first)
```

### Frontend
```bash
cd frontend
npm install --include=dev
npm run build              # TypeScript compile + Vite build
npm run dev                # Vite dev server
npm run lint               # ESLint
```

## Architecture

### Backend (server/src/server.ts)
- **Single-file Express 5 server** (~2100 lines) with all routes, WebSocket handlers, and business logic
- **Multi-workspace support**: Each workspace has isolated data in `data/workspaces/{id}/`
- **Two WebSocket endpoints**:
  - `/ws` - Dashboard updates with workspace subscription (`subscribe`/`unsubscribe` messages)
  - `/ws/terminal?session={name}` - xterm.js terminal connected to tmux sessions via node-pty
- **Global JSON storage** in `data/`: `workspaces.json`
- **Per-workspace JSON storage** in `data/workspaces/{id}/`: `beads.json`, `agents.json`, `progress.json`, `messages.json`
- **Agent spawning**: `spawnClaudeAgent()` creates tmux sessions and launches `claude --dangerously-skip-permissions --append-system-prompt`

### Frontend (frontend/src/)
- **React 19 + TypeScript + Vite + Tailwind CSS 4**
- **App.tsx**: Multi-workspace state management, WebSocket connection, URL-based routing
- **HomeScreen.tsx**: Workspace list and creation
- **MayorView.tsx**: Main workspace view with Mayor terminal, sidebar, and sub-agent panels
- **EmbeddedTerminal.tsx**: xterm.js terminal component with WebGL renderer, 200-row buffer
- **Sidebar.tsx**: Collapsible panel showing workspace, beads, agents, activity, messages
- **SubAgentTabs.tsx + SubAgentPanel.tsx**: Collapsible sub-agent terminal panels

### Key Types (defined in both server and frontend/src/types.ts)
- **Workspace**: Contains id, name, workingDirectory, status (active/stopped), mayorId
- **Bead**: Work item with status, priority, assignee, blocks/blockedBy dependencies, audit trail
- **Agent**: Claude instance with role (mayor/specialist/reviewer/explorer), model (opus/sonnet/haiku), tmuxSession
- **ProgressEntry**: Agent status update with completed items, next steps, artifacts, blockers
- **Message**: Inter-agent communication with type (info/action_required/completion/blocker)

### Data Flow
1. User creates or opens a workspace from HomeScreen
2. Server spawns Mayor agent (Opus) in tmux session with comprehensive system prompt
3. User interacts with Mayor through embedded terminal
4. Mayor creates beads, spawns sub-agents via REST API
5. All changes broadcast via WebSocket to subscribed clients
6. Sub-agents report progress and completion via API
7. Mayor coordinates work and cleans up completed agents

### Mayor Prompt Generation
`generateMayorPrompt()` and `generateSubAgentPrompt()` create comprehensive prompts including:
- Full API reference with curl examples for beads, agents, progress, messages
- Context preservation protocols (delegate builds/tests to sub-agents)
- Work handoff protocol with file ownership boundaries
- Testing protocols with Playwright
- Knowledge documentation guidelines

## API Structure
```
# Workspaces (multi-workspace API)
GET    /api/workspaces
POST   /api/workspaces             { name, workingDirectory }
GET    /api/workspaces/:id
GET    /api/workspaces/by-name/:slug
POST   /api/workspaces/:id/start
POST   /api/workspaces/:id/stop
DELETE /api/workspaces/:id

# Legacy Mayor API (single active workspace)
POST /api/mayor/start              { workingDirectory, name? }
GET  /api/mayor/status
POST /api/mayor/stop
POST /api/mayor/restart

# Beads (all require workspaceId query param or active workspace)
GET/POST /api/beads
GET/PATCH/DELETE /api/beads/:id
GET /api/beads/next/available

# Agents
GET /api/agents
POST /api/agents/spawn             { workspaceId, name, role, model, prompt, ownedPaths?, useWorktree?, branchName? }
GET/DELETE /api/agents/:id

# Progress & Messages
GET/POST /api/progress
GET/POST /api/messages
PATCH /api/messages/:id/read

# Merge Queue
GET /api/merge-queue              List merge queue
POST /api/merge-queue             { workspaceId, agentId, agentName, branch, title, description?, filesChanged? }
PATCH /api/merge-queue/:id        { status?, position? }
DELETE /api/merge-queue/:id

# Worktrees & Ownership
GET /api/worktrees                List git worktrees
GET /api/ownership                Get file ownership map
POST /api/ownership/check         { paths, excludeAgentId? } - Check for conflicts

# Filesystem (for workspace creation UI)
GET /api/filesystem?path=/
POST /api/filesystem/mkdir

# Stats
GET /api/stats
```

## Git Worktrees

Sub-agents automatically get their own git worktree when spawned (if the workspace is a git repo). This isolates their changes from other agents.

- Worktrees are stored in `../.{workspace-name}-worktrees/{agent-name}/`
- Each agent gets a branch named `agent/{agent-name}/{branch-name}`
- Worktrees are automatically cleaned up when agents are deleted
- Set `useWorktree: false` in spawn request to disable

## File Ownership

Agents can declare which files they own via `ownedPaths` when spawned. The system:
- Prevents spawning agents with conflicting file ownership
- Returns 409 Conflict if ownership overlap is detected
- Tracks ownership across active agents only (offline agents don't count)

Ownership patterns support globs:
- `src/auth/**` - all files under src/auth
- `src/components/Button.tsx` - specific file
- `*.test.ts` - pattern matching

## Merge Queue

When agents complete work in their worktrees, they submit to a merge queue instead of merging directly. This enables:
- Sequential merge strategy to avoid conflicts
- Automatic rebase notifications when merges happen
- Conflict detection based on file overlap
- Position tracking in the queue

## Environment Variables
- `PORT` - Server port (default: 3001)
- `DATA_DIR` - Data directory path (default: `./data`)

## Mobile UI Architecture

The frontend is optimized for mobile with a compact, touch-friendly interface:

- **Single unified header bar** containing sidebar toggle, terminal controls (X, up, down, Copy, Paste), status, and Stop button
- **Sidebar on LEFT**, collapsed by default, returns `null` when collapsed (no width consumed)
- **Tall scrollable terminal** using 200-row buffer with native scroll container
- **Touch-friendly controls** with 44px minimum touch targets

Key terminal patterns (from `EmbeddedTerminal.tsx`):
- `TERMINAL_ROWS = 200` constant for tall terminal buffer
- Native scroll via `.terminal-scroll-container` wrapper
- `scrollback: 0` (uses container scroll instead of xterm internal scroll)
- `onReady` callback exposing `sendInput`, `focus`, `copySelection`, `hasSelection`

## Tmux Session Naming

Sessions use slugified workspace name + role: `{workspace-slug}-{role}`
- Mayor: `my-project-mayor`
- Sub-agents: `my-project-frontend-dev`

`slugify()` function (in both server and frontend) converts names to URL-safe slugs.

### Shared Tmux Socket

The server uses a shared tmux socket at `/tmp/orchestrator-tmux.sock` (configurable via `TMUX_SOCKET` env var). This allows the systemd service and user terminal to share sessions.

To interact with orchestrator tmux sessions from your terminal:
```bash
tmux -S /tmp/orchestrator-tmux.sock list-sessions
tmux -S /tmp/orchestrator-tmux.sock attach -t {session-name}
```

## Skills Directory

Reusable knowledge documented in `.claude/skills/`:
- `mobile-ui-architecture.md` - Mobile layout patterns and component structure
- `sub-agent-spawning.md` - How to spawn and debug sub-agents

## Debugging Sub-Agents

Sub-agents require an initial message to start working (sent automatically after 5 seconds).

From terminal (use the shared socket):
```bash
# Check agent tmux sessions
tmux -S /tmp/orchestrator-tmux.sock list-sessions

# View agent output
tmux -S /tmp/orchestrator-tmux.sock capture-pane -t {session-name} -p | tail -50

# Manually send message to stuck agent
tmux -S /tmp/orchestrator-tmux.sock send-keys -t {session-name} 'Your message here' Enter

# Attach to session interactively
tmux -S /tmp/orchestrator-tmux.sock attach -t {session-name}
```

If agents sit idle: check server logs for "Failed to send initial message" errors.
