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
- Work handoff protocol and git worktree isolation
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
POST /api/beads/:id/test          { testStatus, testOutput?, command? } - Record test results
GET /api/beads/next/available

# Agents
GET /api/agents
POST /api/agents/spawn             { workspaceId, name, role, model, prompt, ownedPaths?, useWorktree?, branchName? }
GET/DELETE /api/agents/:id
PATCH /api/agents/:id/status       { status, event, workspaceId } - Lifecycle hook endpoint

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

# Bootstrap (Project Context)
GET /api/bootstrap                Get cached bootstrap results
POST /api/bootstrap               Re-run bootstrap exploration

# Skills (On-Demand Knowledge)
GET /api/skills                   List all skills (metadata only)
GET /api/skills/:name             Read a specific skill
GET /api/skills/search/:query     Search skills by keyword

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

## File Ownership (Optional)

Agents can optionally declare files they're working on via `ownedPaths` when spawned. This is **purely informational** - agents are free to modify any files as they discover what needs changing. Git worktrees provide the actual isolation between agents.

The `/api/ownership` endpoints exist for visibility only - they don't restrict agent behavior.

## Agent Lifecycle Hooks

Agents automatically report their status via Claude Code hooks. When an agent is spawned, the server writes `.claude/settings.json` with lifecycle hooks that call the orchestrator API:

- **SessionStart**: Updates agent status to `working`, sends `[HOOK]` message to mayor
- **Stop**: Updates agent status to `offline`, sends `[HOOK]` message to mayor

Hook messages appear in the Messages panel prefixed with `[HOOK]` for easy identification.

### Manual Status Update

Agents can also manually update their status:

```bash
# Set status to idle (between tasks)
curl -X PATCH http://localhost:3001/api/agents/{id}/status \
  -H "Content-Type: application/json" \
  -d '{"status": "idle", "event": "idle", "workspaceId": "..."}'

# Available statuses: idle, working, blocked, offline, starting
```

The endpoint automatically:
1. Updates the agent's status field
2. Sends a `[HOOK]` message to the mayor
3. Sends a `[HOOK]` message to the deacon (if running)
4. Broadcasts WebSocket update to all connected clients

## Merge Queue

When agents complete work in their worktrees, they submit to a merge queue instead of merging directly. This enables:
- Sequential merge strategy to avoid conflicts
- Automatic rebase notifications when merges happen
- Conflict detection based on file overlap
- Position tracking in the queue
- **Review Gate**: Requires `reviewStatus: approved` and `buildStatus: passed` before merge

### Review Gate

MRs cannot be merged until:
1. A **reviewer** sets `reviewStatus: "approved"`
2. Build verification passes (`buildStatus: "passed"`)

```bash
# Reviewer approves an MR
curl -X PATCH http://localhost:3001/api/merge-queue/MR-001 \
  -d '{"reviewStatus": "approved", "reviewedBy": "code-reviewer", "buildStatus": "passed"}'

# Attempting merge without approval will fail
curl -X PATCH http://localhost:3001/api/merge-queue/MR-001 \
  -d '{"status": "merged"}'
# Returns: {"error": "Merge blocked by quality gate", "gateFailures": [...]}
```

## Bootstrap Protocol

When a workspace starts, the server automatically explores the project structure and caches the results. This gives the Mayor immediate context about:
- Project type (npm, cargo, go, python)
- Directory structure and key files
- Entry points and build/test commands
- Git status and conventions (CLAUDE.md, skills, docs, tests)

Query bootstrap data: `GET /api/bootstrap?workspaceId=...`
Re-run bootstrap: `POST /api/bootstrap?workspaceId=...`

## Skills System

Skills are documented solutions stored in `.claude/skills/`. Agents query skills before tackling unfamiliar tasks.

- **List skills**: `GET /api/skills` - Returns metadata only (lightweight)
- **Read skill**: `GET /api/skills/:name` - Returns full content
- **Search**: `GET /api/skills/search/:query` - Search by name, description, or tags

### Creating New Skills

Document a skill when you solve a challenging problem, discover a non-obvious pattern, or complete a repeatable process. See `.claude/skills/creating-skills.md` for the template.

## Test Verification

Beads have test verification to ensure quality before completion:

- `requiresTests` (default: true) - Whether tests must pass before marking done
- `testStatus` - pending, running, passed, failed, skipped
- `testOutput` - Last test output/error message

Record test results: `POST /api/beads/:id/test { testStatus, testOutput?, command? }`

When marking a bead as "done" without passing tests, the API returns a warning. Use `skipTestCheck: true` to override.

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

# Manually send message to stuck agent (reliable nudge pattern)
# Step 1: Send text in literal mode
tmux -S /tmp/orchestrator-tmux.sock send-keys -t {session-name} -l "Your message here"
# Step 2: Wait for paste, then send Enter
sleep 0.5 && tmux -S /tmp/orchestrator-tmux.sock send-keys -t {session-name} Enter

# Attach to session interactively
tmux -S /tmp/orchestrator-tmux.sock attach -t {session-name}
```

**IMPORTANT**: Always use `-l` literal mode and send Enter separately. Never use `C-m` or combine message with Enter in a single command.

If agents sit idle: check server logs for "Failed to send initial message" errors.
