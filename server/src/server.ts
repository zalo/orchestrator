import 'dotenv/config';
import express, { Request, Response } from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer, IncomingMessage } from 'http';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import { spawn, IPty } from 'node-pty';

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../../data');
const WORKSPACES_DIR = path.join(DATA_DIR, 'workspaces');

// Ensure data directories exist
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(WORKSPACES_DIR)) {
  fs.mkdirSync(WORKSPACES_DIR, { recursive: true });
}

// ============ TYPES ============

interface Workspace {
  id: string;
  name: string;
  workingDirectory: string;
  status: 'active' | 'stopped';
  mayorId: string | null;
  created: string;
  lastActivity: string;
}

interface Bead {
  id: string;
  title: string;
  description: string;
  status: 'todo' | 'in_progress' | 'done' | 'blocked';
  priority: number;
  assignee: string | null;
  blocks: string[];
  blockedBy: string[];
  created: string;
  updated: string;
  audit: AuditEntry[];
}

interface AuditEntry {
  time: string;
  action: string;
  by: string;
  details?: Record<string, unknown>;
}

interface Agent {
  id: string;
  name: string;
  role: 'mayor' | 'specialist' | 'reviewer' | 'explorer';
  model: 'opus' | 'sonnet' | 'haiku';
  status: 'idle' | 'working' | 'blocked' | 'offline' | 'starting';
  currentTask: string | null;
  worktree: string | null;
  tmuxSession: string | null;
  pid: number | null;
  lastSeen: string;
  created: string;
  workspaceId?: string;
}

interface ProgressEntry {
  id: string;
  agentId: string;
  agentName: string;
  timestamp: string;
  status: string;
  completed: string[];
  next: string[];
  artifacts: string[];
  blockers: string[];
}

interface Message {
  id: string;
  from: string;
  to: string;
  timestamp: string;
  content: string;
  read: boolean;
  type: 'info' | 'action_required' | 'completion' | 'blocker';
}

interface FilesystemEntry {
  name: string;
  type: 'directory' | 'file';
  size?: number;
  modified?: string;
}

interface FilesystemResponse {
  path: string;
  parent: string | null;
  entries: FilesystemEntry[];
}

// ============ DATA MANAGEMENT ============

const WORKSPACES_FILE = path.join(DATA_DIR, 'workspaces.json');

function loadData<T>(file: string, defaultValue: T): T {
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf-8'));
    }
  } catch (e) {
    console.error(`Error loading ${file}:`, e);
  }
  return defaultValue;
}

function saveData<T>(file: string, data: T): void {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// Get workspace data directory
function getWorkspaceDataDir(workspaceId: string): string {
  return path.join(WORKSPACES_DIR, workspaceId);
}

// Ensure workspace data directory exists
function ensureWorkspaceDataDir(workspaceId: string): string {
  const dir = getWorkspaceDataDir(workspaceId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

// Load workspace-specific data
function loadWorkspaceData<T>(workspaceId: string, filename: string, defaultValue: T): T {
  const file = path.join(getWorkspaceDataDir(workspaceId), filename);
  return loadData(file, defaultValue);
}

// Save workspace-specific data
function saveWorkspaceData<T>(workspaceId: string, filename: string, data: T): void {
  const dir = ensureWorkspaceDataDir(workspaceId);
  const file = path.join(dir, filename);
  saveData(file, data);
}

// Global state - workspaces list
let workspaces: Workspace[] = loadData(WORKSPACES_FILE, []);

function saveWorkspaces() {
  saveData(WORKSPACES_FILE, workspaces);
}

// Per-workspace data caches (loaded on demand)
const workspaceBeads = new Map<string, Bead[]>();
const workspaceAgents = new Map<string, Agent[]>();
const workspaceProgress = new Map<string, ProgressEntry[]>();
const workspaceMessages = new Map<string, Message[]>();

function getBeads(workspaceId: string): Bead[] {
  if (!workspaceBeads.has(workspaceId)) {
    workspaceBeads.set(workspaceId, loadWorkspaceData(workspaceId, 'beads.json', []));
  }
  return workspaceBeads.get(workspaceId)!;
}

function saveBeads(workspaceId: string) {
  const beads = workspaceBeads.get(workspaceId) || [];
  saveWorkspaceData(workspaceId, 'beads.json', beads);
}

function getAgents(workspaceId: string): Agent[] {
  if (!workspaceAgents.has(workspaceId)) {
    workspaceAgents.set(workspaceId, loadWorkspaceData(workspaceId, 'agents.json', []));
  }
  return workspaceAgents.get(workspaceId)!;
}

function saveAgents(workspaceId: string) {
  const agents = workspaceAgents.get(workspaceId) || [];
  saveWorkspaceData(workspaceId, 'agents.json', agents);
}

function getProgress(workspaceId: string): ProgressEntry[] {
  if (!workspaceProgress.has(workspaceId)) {
    workspaceProgress.set(workspaceId, loadWorkspaceData(workspaceId, 'progress.json', []));
  }
  return workspaceProgress.get(workspaceId)!;
}

function saveProgress(workspaceId: string) {
  const progress = workspaceProgress.get(workspaceId) || [];
  saveWorkspaceData(workspaceId, 'progress.json', progress);
}

function getMessages(workspaceId: string): Message[] {
  if (!workspaceMessages.has(workspaceId)) {
    workspaceMessages.set(workspaceId, loadWorkspaceData(workspaceId, 'messages.json', []));
  }
  return workspaceMessages.get(workspaceId)!;
}

function saveMessages(workspaceId: string) {
  const messages = workspaceMessages.get(workspaceId) || [];
  saveWorkspaceData(workspaceId, 'messages.json', messages);
}

function clearWorkspaceCache(workspaceId: string) {
  workspaceBeads.delete(workspaceId);
  workspaceAgents.delete(workspaceId);
  workspaceProgress.delete(workspaceId);
  workspaceMessages.delete(workspaceId);
}

function deleteWorkspaceData(workspaceId: string) {
  clearWorkspaceCache(workspaceId);
  const dir = getWorkspaceDataDir(workspaceId);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ============ TMUX HELPERS ============

// Shared tmux socket path - allows systemd service and user terminal to share sessions
const TMUX_SOCKET = process.env.TMUX_SOCKET || '/tmp/orchestrator-tmux.sock';

// Slugify workspace name for use in tmux session names
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 30); // tmux session names have limits
}

// Get namespaced tmux session name using workspace name
function getTmuxSessionName(workspace: Workspace | string, agentType: 'mayor' | string): string {
  // Support both Workspace object and workspaceId string for backward compatibility
  let workspaceName: string;
  if (typeof workspace === 'string') {
    // Legacy: find workspace by ID
    const ws = workspaces.find(w => w.id === workspace);
    workspaceName = ws ? slugify(ws.name) : workspace.substring(0, 8);
  } else {
    workspaceName = slugify(workspace.name);
  }

  if (agentType === 'mayor') {
    return `${workspaceName}-mayor`;
  }
  return `${workspaceName}-${slugify(agentType)}`;
}

// Get workspace from tmux session name
function getWorkspaceFromSessionName(sessionName: string): Workspace | null {
  // Session format: {workspace-slug}-{role}
  // Try to match by finding workspace whose slugified name is the prefix
  for (const ws of workspaces) {
    const slug = slugify(ws.name);
    if (sessionName.startsWith(slug + '-')) {
      return ws;
    }
  }
  return null;
}

function sessionExists(sessionName: string): boolean {
  try {
    execSync(`tmux -S '${TMUX_SOCKET}' has-session -t '${sessionName}' 2>/dev/null`, { encoding: 'utf-8' });
    return true;
  } catch {
    return false;
  }
}

function createTmuxSession(sessionName: string, cwd: string): boolean {
  try {
    execSync(`cd "${cwd}" && tmux -S '${TMUX_SOCKET}' new-session -d -s '${sessionName}'`, { encoding: 'utf-8' });
    return true;
  } catch (e) {
    console.error('Failed to create tmux session:', e);
    return false;
  }
}

function killTmuxSession(sessionName: string): boolean {
  try {
    execSync(`tmux -S '${TMUX_SOCKET}' kill-session -t '${sessionName}' 2>/dev/null`, { encoding: 'utf-8' });
    return true;
  } catch {
    return false;
  }
}

function saveTmuxSessionLog(sessionName: string, agentName: string, workspaceId?: string): string | null {
  try {
    const logsDir = workspaceId
      ? path.join(getWorkspaceDataDir(workspaceId), 'logs')
      : path.join(DATA_DIR, 'logs');
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const logFile = path.join(logsDir, `${agentName}-${timestamp}.log`);

    try {
      const history = execSync(
        `tmux -S '${TMUX_SOCKET}' capture-pane -t '${sessionName}' -p -S - 2>/dev/null`,
        { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
      );

      const header = `# Agent Log: ${agentName}
# Session: ${sessionName}
# Workspace: ${workspaceId || 'global'}
# Captured: ${new Date().toISOString()}
# ============================================

`;
      fs.writeFileSync(logFile, header + history);
      console.log(`Saved terminal log for ${agentName} to ${logFile}`);
      return logFile;
    } catch (e) {
      console.error(`Failed to capture tmux history for ${sessionName}:`, e);
      return null;
    }
  } catch (e) {
    console.error(`Failed to save log for ${agentName}:`, e);
    return null;
  }
}

// ============ MAYOR PROMPT GENERATION ============

function generateMayorPrompt(workspace: Workspace, mayorId: string): string {
  const apiBase = `http://localhost:${PORT}`;

  return `You are the MAYOR - the primary orchestrating AI for this workspace.

## YOUR ROLE
You are the central coordinator and user interface for all work in this workspace. The user interacts with you directly through this terminal. Your responsibilities:

1. **Converse naturally** with the user - understand their goals, ask clarifying questions
2. **Plan and organize** work into beads (atomic tasks) when appropriate
3. **Spawn sub-agents** for parallel or specialized work
4. **Monitor and coordinate** all ongoing work
5. **Report progress** and surface issues to the user

## WORKSPACE
Name: ${workspace.name}
ID: ${workspace.id}
Working Directory: ${workspace.workingDirectory}
API Base URL: ${apiBase}

## ORCHESTRATOR API

### Beads (Work Items)
Beads are atomic tasks that can be tracked and assigned.

\`\`\`bash
# List all beads
curl "${apiBase}/api/beads?workspaceId=\${workspace.id}"

# Create a bead
curl -X POST ${apiBase}/api/beads \\
  -H "Content-Type: application/json" \\
  -d '{"workspaceId": "\${workspace.id}", "title": "Task title", "description": "Details", "priority": 5}'

# Update a bead (status: todo, in_progress, done, blocked)
curl -X PATCH ${apiBase}/api/beads/BEAD-001 \\
  -H "Content-Type: application/json" \\
  -d '{"status": "in_progress", "assignee": "agent-name"}'

# Delete a bead
curl -X DELETE ${apiBase}/api/beads/BEAD-001
\`\`\`

### Sub-Agents
Spawn specialists for parallel work or specific expertise.

\`\`\`bash
# Spawn a sub-agent (roles: specialist, reviewer, explorer)
# (models: sonnet, haiku - use sonnet for most work, haiku for simple tasks)
curl -X POST ${apiBase}/api/agents/spawn \\
  -H "Content-Type: application/json" \\
  -d '{
    "workspaceId": "\${workspace.id}",
    "name": "frontend-dev",
    "role": "specialist",
    "model": "sonnet",
    "prompt": "You are a frontend specialist. Your task is to..."
  }'

# List all agents
curl "${apiBase}/api/agents?workspaceId=\${workspace.id}"

# Get agent details
curl ${apiBase}/api/agents/{id}

# Delete/stop an agent
curl -X DELETE ${apiBase}/api/agents/{id}
\`\`\`

### Progress Reporting
Log your status so the user can monitor work in the sidebar.

\`\`\`bash
curl -X POST ${apiBase}/api/progress \\
  -H "Content-Type: application/json" \\
  -d '{
    "workspaceId": "\${workspace.id}",
    "agentId": "${mayorId}",
    "agentName": "mayor",
    "status": "Analyzing project structure",
    "completed": ["Read package.json", "Identified tech stack"],
    "next": ["Review src/ directory", "Create initial beads"]
  }'
\`\`\`

### Messages
Communicate with sub-agents or log important notes.

\`\`\`bash
curl -X POST ${apiBase}/api/messages \\
  -H "Content-Type: application/json" \\
  -d '{
    "workspaceId": "\${workspace.id}",
    "from": "mayor",
    "to": "frontend-dev",
    "content": "Please focus on the login component first",
    "type": "action_required"
  }'
# types: info, action_required, completion, blocker
\`\`\`

### Stats
Get summary statistics for the dashboard.

\`\`\`bash
curl "${apiBase}/api/stats?workspaceId=\${workspace.id}"
\`\`\`

## GUIDELINES

### When to Create Beads
- For multi-step tasks that benefit from tracking
- When assigning work to sub-agents
- For tasks with dependencies (use blocks/blockedBy)
- NOT for simple questions or quick one-off tasks

### When to Spawn Sub-Agents
- Parallel work that can proceed independently
- Specialized tasks (frontend, API, testing, database, etc.)
- Tasks that don't require frequent user interaction
- Long-running tasks you want to monitor separately

### Model Selection for Sub-Agents
- **sonnet**: Most implementation work, complex reasoning
- **haiku**: Simple, well-defined tasks, quick lookups

### Communication Style
- Be conversational but efficient
- Proactively share what you're doing and thinking
- Ask clarifying questions before starting complex work
- Surface blockers immediately
- Celebrate completions!

### Best Practices
- One focused task per sub-agent session
- Clear file ownership between agents - avoid conflicts
- Update beads immediately when status changes
- Log progress regularly during active work
- Keep the user informed of what's happening

## CONTEXT PRESERVATION PROTOCOLS

### Build & Test Delegation
To preserve your context window for reasoning and user interaction, delegate builds and tests to sub-agents:

\`\`\`bash
# Spawn a build-runner agent
curl -X POST ${apiBase}/api/agents/spawn \\
  -H "Content-Type: application/json" \\
  -d '{
    "workspaceId": "\${workspace.id}",
    "name": "build-runner",
    "role": "specialist",
    "model": "haiku",
    "prompt": "Run the build command and report results. Command: npm run build. Report success/failure and any errors via progress API. Delete yourself when done."
  }'

# Spawn a test-runner agent
curl -X POST ${apiBase}/api/agents/spawn \\
  -H "Content-Type: application/json" \\
  -d '{
    "workspaceId": "\${workspace.id}",
    "name": "test-runner",
    "role": "specialist",
    "model": "haiku",
    "prompt": "Run tests and report results. Command: npm test. Report pass/fail counts and any failures via progress API. Delete yourself when done."
  }'
\`\`\`

### Work Handoff Protocol
When delegating work to sub-agents, follow this handoff pattern:

1. **Create a bead** for the work with clear description
2. **Spawn the sub-agent** with detailed context:
   - What files they own (they should NOT edit files outside this scope)
   - What the expected outcome is
   - How to report completion (message to mayor)
   - Any dependencies or blockers
3. **Monitor progress** via the sidebar and progress API
4. **Handle completion** - when sub-agent messages completion:
   - Review their work if needed
   - Mark the bead as done
   - Delete the sub-agent to clean up

### Sub-Agent Prompt Template
When spawning sub-agents, include these sections in your prompt:

\`\`\`
You are a [ROLE] sub-agent. Your task:
[SPECIFIC TASK DESCRIPTION]

FILES YOU OWN (only edit these):
- path/to/file1.ts
- path/to/directory/

EXPECTED OUTCOME:
[What success looks like]

WHEN DONE:
1. Log progress with completed items
2. Message mayor with type "completion"
3. The mayor will delete you after review
\`\`\`

### Parallel Work Coordination
When spawning multiple agents for parallel work:
- Ensure NO file overlap between agents
- Create beads with proper blocks/blockedBy dependencies
- Monitor all agents via the sidebar
- Coordinate merges through progress messages

## TESTING PROTOCOLS

### Web-Based Testing with Playwright
For web-based changes, ALWAYS spawn a testing agent to verify functionality:

\`\`\`bash
# Spawn a web testing agent
curl -X POST ${apiBase}/api/agents/spawn \\
  -H "Content-Type: application/json" \\
  -d '{
    "workspaceId": "\${workspace.id}",
    "name": "web-tester",
    "role": "reviewer",
    "model": "sonnet",
    "prompt": "Test the web application at [URL]. Use Playwright to: 1) Navigate to key pages, 2) Take screenshots of each page, 3) Test interactive elements, 4) Report any errors from console. Return a concise description of app behavior and any issues found. Include screenshot paths in your progress report artifacts."
  }'
\`\`\`

### Testing Agent Template
When spawning testing agents, include:
\`\`\`
You are a TESTING sub-agent. Your task:
Test [FEATURE/COMPONENT] at [URL].

TESTING STEPS:
1. Use Playwright to navigate to the target
2. Take screenshots before and after interactions
3. Check browser console for errors
4. Test key user interactions
5. Verify expected behavior

REPORT FORMAT:
Return a concise description with:
- What works correctly
- What issues were found (with screenshots)
- Console errors if any
- Suggested fixes

WHEN DONE:
1. Log progress with screenshots in artifacts
2. Message mayor with type "completion" including summary
\`\`\`

## KNOWLEDGE DOCUMENTATION

### Document Successful Solutions
When you successfully complete a task (especially after troubleshooting), document HOW you did it:

1. **For common operations** (git push, build, deploy):
   - Write to \`.claude/skills/\` directory
   - Include exact commands that worked
   - Note any gotchas or prerequisites

2. **For project-specific solutions**:
   - Update relevant markdown in \`docs/\` or project root
   - Include context for why the solution works

3. **Skill file format**:
\`\`\`markdown
# [Task Name] Skill

## When to Use
[Describe the scenario]

## Steps
1. [Exact command or action]
2. [Next step]

## Troubleshooting
- If [problem]: [solution]

## Last Verified
[Date and context]
\`\`\`

### Share Knowledge via Progress
When documenting solutions, also log to progress:
\`\`\`bash
curl -X POST ${apiBase}/api/progress \\
  -H "Content-Type: application/json" \\
  -d '{
    "workspaceId": "\${workspace.id}",
    "agentId": "${mayorId}",
    "agentName": "mayor",
    "status": "Documented solution",
    "completed": ["Wrote skill: [skill-name]"],
    "artifacts": [".claude/skills/[skill-name].md"]
  }'
\`\`\`

## YOUR IDENTITY
Agent ID: ${mayorId}
Agent Name: mayor
Role: mayor
Model: opus
Workspace ID: \${workspace.id}
Workspace Name: \${workspace.name}

---

You are now connected to the user's terminal. Greet them warmly and ask what they'd like to accomplish in this workspace today.`;
}

function generateSubAgentPrompt(agent: Agent, workspace: Workspace, customPrompt: string): string {
  const apiBase = `http://localhost:${PORT}`;

  return `${customPrompt}

## WORKSPACE
Name: ${workspace.name}
ID: ${workspace.id}
Working Directory: ${workspace.workingDirectory}

## ORCHESTRATOR API (at ${apiBase})

\`\`\`bash
# Get your assigned beads
curl "${apiBase}/api/beads?workspaceId=${workspace.id}&assignee=${agent.name}"

# Update bead status
curl -X PATCH ${apiBase}/api/beads/BEAD-001 \\
  -H "Content-Type: application/json" \\
  -d '{"status": "done"}'

# Log your progress (do this regularly!)
curl -X POST ${apiBase}/api/progress \\
  -H "Content-Type: application/json" \\
  -d '{
    "workspaceId": "${workspace.id}",
    "agentId": "${agent.id}",
    "agentName": "${agent.name}",
    "status": "Working on...",
    "completed": ["..."],
    "next": ["..."]
  }'

# Message the Mayor or other agents
curl -X POST ${apiBase}/api/messages \\
  -H "Content-Type: application/json" \\
  -d '{
    "workspaceId": "${workspace.id}",
    "from": "${agent.name}",
    "to": "mayor",
    "content": "...",
    "type": "completion"
  }'
\`\`\`

## WORKFLOW
1. **Start**: Log initial progress showing you've started
2. **Work**: Execute your task, staying within your file ownership scope
3. **Update**: Log progress every few minutes during active work
4. **Test**: If your work affects web UI, use Playwright to take screenshots and verify
5. **Complete**: When done:
   - Mark any assigned beads as "done"
   - Log final progress with all completed items
   - Send completion message to mayor
6. **Blocked**: If stuck, send blocker message to mayor immediately

## TESTING REQUIREMENTS
For web-based changes:
- Use Playwright MCP tools to test your changes
- Take screenshots before and after modifications
- Check browser console for errors
- Include screenshot paths in your progress artifacts
- Report any issues found with context

## DOCUMENTATION REQUIREMENTS
After successfully completing a task (especially after troubleshooting):
- Document the solution in \`.claude/skills/\` if it's a reusable pattern
- Include exact commands and steps that worked
- Note any prerequisites or gotchas
- This helps future agents avoid the same issues

## COMPLETION PROTOCOL
When your task is complete, you MUST:

1. Log final progress:
\`\`\`bash
curl -X POST ${apiBase}/api/progress \\
  -H "Content-Type: application/json" \\
  -d '{
    "workspaceId": "${workspace.id}",
    "agentId": "${agent.id}",
    "agentName": "${agent.name}",
    "status": "COMPLETED",
    "completed": ["List all completed items"],
    "next": [],
    "artifacts": ["List any files created/modified"]
  }'
\`\`\`

2. Send completion message:
\`\`\`bash
curl -X POST ${apiBase}/api/messages \\
  -H "Content-Type: application/json" \\
  -d '{
    "workspaceId": "${workspace.id}",
    "from": "${agent.name}",
    "to": "mayor",
    "content": "Task complete: [brief summary]. Files modified: [list]. Ready for review.",
    "type": "completion"
  }'
\`\`\`

The Mayor will review your work and delete this agent session.

## YOUR IDENTITY
Agent ID: ${agent.id}
Agent Name: ${agent.name}
Role: ${agent.role}
Model: ${agent.model}
Workspace ID: ${workspace.id}
Workspace Name: ${workspace.name}

Begin working on your assigned task. Start by logging your initial progress.`;
}

// ============ AGENT SPAWNING ============

async function spawnMayorForWorkspace(workspace: Workspace): Promise<Agent> {
  const now = new Date().toISOString();
  const mayorId = uuidv4();

  // Create Mayor agent
  const mayor: Agent = {
    id: mayorId,
    name: 'mayor',
    role: 'mayor',
    model: 'opus',
    status: 'starting',
    currentTask: null,
    worktree: null,
    tmuxSession: getTmuxSessionName(workspace, 'mayor'),
    pid: null,
    lastSeen: now,
    created: now,
    workspaceId: workspace.id
  };

  const agents = getAgents(workspace.id);
  agents.push(mayor);
  saveAgents(workspace.id);

  // Generate prompt and spawn
  const prompt = generateMayorPrompt(workspace, mayorId);
  const success = await spawnClaudeAgent(mayor, workspace, prompt);

  if (success) {
    mayor.status = 'working';
  } else {
    mayor.status = 'offline';
  }
  saveAgents(workspace.id);

  broadcast('agent:created', mayor, workspace.id);

  return mayor;
}

async function spawnClaudeAgent(agent: Agent, workspace: Workspace, prompt: string): Promise<boolean> {
  const sessionName = agent.tmuxSession || getTmuxSessionName(workspace, agent.role === 'mayor' ? 'mayor' : agent.name);

  // Kill existing session if it exists
  if (sessionExists(sessionName)) {
    killTmuxSession(sessionName);
  }

  // Create tmux session
  if (!createTmuxSession(sessionName, workspace.workingDirectory)) {
    return false;
  }

  // Write prompt to a temporary file for reference
  const promptsDir = path.join(getWorkspaceDataDir(workspace.id), 'prompts');
  if (!fs.existsSync(promptsDir)) {
    fs.mkdirSync(promptsDir, { recursive: true });
  }
  const promptFile = path.join(promptsDir, `${agent.id}.md`);
  fs.writeFileSync(promptFile, prompt);

  // Find claude binary - use CLAUDE_PATH env var or check common locations
  let claudePath = process.env.CLAUDE_PATH || 'claude';
  if (!process.env.CLAUDE_PATH) {
    const possiblePaths = [
      process.env.HOME + '/.nvm/versions/node/v22.14.0/bin/claude',
      '/usr/local/bin/claude',
      '/usr/bin/claude',
    ];
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        claudePath = p;
        break;
      }
    }
  }

  try {
    // Start claude in INTERACTIVE mode with:
    // --dangerously-skip-permissions: bypass permission prompts
    // --append-system-prompt: add our agent context to the default system prompt
    // This keeps the session interactive (no -p flag)
    const claudeCmd = `${claudePath} --dangerously-skip-permissions --append-system-prompt "$(cat '${promptFile}')"`;
    execSync(`tmux -S '${TMUX_SOCKET}' send-keys -t '${sessionName}' '${claudeCmd}' Enter`, { encoding: 'utf-8' });

    agent.tmuxSession = sessionName;

    // Wait for claude to initialize then send initial message
    setTimeout(() => {
      try {
        let initialMessage: string;
        if (agent.role === 'mayor') {
          initialMessage = 'Please greet the user and briefly report your current status. What workspace are you connected to and what can you help with today?';
        } else {
          // For sub-agents, prompt them to begin their assigned task
          initialMessage = 'Begin working on your assigned task now. Start by reading the relevant files, then make the required changes. Log your progress via the API as you work.';
        }
        // Escape single quotes in the message for shell safety
        const escapedMessage = initialMessage.replace(/'/g, "'\\''");
        // Send message and Enter (C-m) separately for reliability
        execSync(`tmux -S '${TMUX_SOCKET}' send-keys -t '${sessionName}' '${escapedMessage}'`, { encoding: 'utf-8' });
        execSync(`tmux -S '${TMUX_SOCKET}' send-keys -t '${sessionName}' C-m`, { encoding: 'utf-8' });
      } catch (e) {
        console.error('Failed to send initial message:', e);
      }
    }, 5000);

    return true;
  } catch (e) {
    console.error('Failed to spawn claude agent:', e);
    killTmuxSession(sessionName);
    return false;
  }
}

async function stopWorkspace(workspaceId: string): Promise<{ success: boolean; logs: string[] }> {
  const logs: string[] = [];
  const workspace = workspaces.find(w => w.id === workspaceId);
  if (!workspace) {
    return { success: false, logs };
  }

  const agents = getAgents(workspaceId);

  // Stop all agents for this workspace
  for (const agent of agents) {
    if (agent.tmuxSession && sessionExists(agent.tmuxSession)) {
      const logFile = saveTmuxSessionLog(agent.tmuxSession, agent.name, workspaceId);
      if (logFile) logs.push(logFile);
      killTmuxSession(agent.tmuxSession);
    }
  }

  // Update workspace status
  workspace.status = 'stopped';
  workspace.mayorId = null;
  workspace.lastActivity = new Date().toISOString();
  saveWorkspaces();

  // Mark all agents offline
  const updatedAgents = agents.map(a => ({ ...a, status: 'offline' as const, tmuxSession: null }));
  workspaceAgents.set(workspaceId, updatedAgents);
  saveAgents(workspaceId);

  broadcast('workspace:stopped', { workspace, logs });

  return { success: true, logs };
}

// ============ WEBSOCKET ============

interface SubscribedClient {
  ws: WebSocket;
  workspaceId: string | null;
}

const wsClients = new Map<WebSocket, SubscribedClient>();

function broadcast(type: string, data: unknown, workspaceId?: string) {
  const message = JSON.stringify({ type, data, timestamp: new Date().toISOString() });

  // Global events go to all clients
  const globalEvents = ['workspace:created', 'workspace:started', 'workspace:stopped', 'workspace:deleted'];
  const isGlobal = globalEvents.includes(type);

  wsClients.forEach((client) => {
    if (client.ws.readyState === WebSocket.OPEN) {
      // Send if global event OR client is subscribed to this workspace
      if (isGlobal || !workspaceId || client.workspaceId === workspaceId) {
        client.ws.send(message);
      }
    }
  });
}

// ============ MIDDLEWARE ============

app.use(cors());
app.use(express.json());

const frontendDist = path.join(__dirname, '../../frontend/dist');
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
}

// ============ FILESYSTEM API ============

app.get('/api/filesystem', (req: Request, res: Response) => {
  const requestedPath = (req.query.path as string) || '/';

  try {
    // Resolve to absolute path
    const absPath = path.resolve(requestedPath);

    // Check if path exists
    if (!fs.existsSync(absPath)) {
      res.status(404).json({ error: 'Path not found' });
      return;
    }

    // Check if it's a directory
    const stats = fs.statSync(absPath);
    if (!stats.isDirectory()) {
      res.status(400).json({ error: 'Path is not a directory' });
      return;
    }

    // Read directory contents
    const entries: FilesystemEntry[] = [];
    const dirEntries = fs.readdirSync(absPath, { withFileTypes: true });

    for (const entry of dirEntries) {
      // Only return directories for browsing
      if (entry.isDirectory()) {
        try {
          const entryPath = path.join(absPath, entry.name);
          const entryStats = fs.statSync(entryPath);
          entries.push({
            name: entry.name,
            type: 'directory',
            modified: entryStats.mtime.toISOString()
          });
        } catch {
          // Skip entries we can't stat (permission errors)
          entries.push({
            name: entry.name,
            type: 'directory'
          });
        }
      }
    }

    // Sort entries alphabetically
    entries.sort((a, b) => a.name.localeCompare(b.name));

    // Calculate parent path
    const parent = absPath === '/' ? null : path.dirname(absPath);

    const response: FilesystemResponse = {
      path: absPath,
      parent,
      entries
    };

    res.json(response);
  } catch (e) {
    const error = e as NodeJS.ErrnoException;
    if (error.code === 'EACCES') {
      res.status(403).json({ error: 'Permission denied' });
    } else {
      res.status(500).json({ error: (e as Error).message });
    }
  }
});

app.post('/api/filesystem/mkdir', (req: Request, res: Response) => {
  const { path: dirPath } = req.body;

  if (!dirPath) {
    res.status(400).json({ error: 'path is required' });
    return;
  }

  try {
    const absPath = path.resolve(dirPath);
    fs.mkdirSync(absPath, { recursive: true });
    res.json({ success: true, path: absPath });
  } catch (e) {
    const error = e as NodeJS.ErrnoException;
    if (error.code === 'EACCES') {
      res.status(403).json({ error: 'Permission denied' });
    } else {
      res.status(500).json({ error: (e as Error).message });
    }
  }
});

// ============ WORKSPACES API ============

app.get('/api/workspaces', (_req: Request, res: Response) => {
  res.json(workspaces);
});

app.post('/api/workspaces', (req: Request, res: Response) => {
  const { name, workingDirectory } = req.body;

  if (!name || !workingDirectory) {
    res.status(400).json({ error: 'name and workingDirectory are required' });
    return;
  }

  // Validate directory exists
  if (!fs.existsSync(workingDirectory)) {
    res.status(400).json({ error: 'Working directory does not exist' });
    return;
  }

  const now = new Date().toISOString();
  const workspace: Workspace = {
    id: uuidv4(),
    name,
    workingDirectory,
    status: 'stopped',
    mayorId: null,
    created: now,
    lastActivity: now
  };

  // Ensure workspace data directory exists
  ensureWorkspaceDataDir(workspace.id);

  workspaces.push(workspace);
  saveWorkspaces();

  broadcast('workspace:created', workspace);

  res.status(201).json(workspace);
});

// Get workspace by name slug (for URL routing) - must come before :id route
app.get('/api/workspaces/by-name/:name', (req: Request, res: Response) => {
  const nameParam = req.params.name;
  const nameSlug = (Array.isArray(nameParam) ? nameParam[0] : nameParam).toLowerCase();
  const workspace = workspaces.find(w => slugify(w.name) === nameSlug);
  if (!workspace) {
    res.status(404).json({ error: 'Workspace not found' });
    return;
  }

  // Check and update agent statuses based on actual tmux session state
  const agents = getAgents(workspace.id);
  let statusChanged = false;

  for (const agent of agents) {
    if (agent.tmuxSession) {
      const exists = sessionExists(agent.tmuxSession);
      if (exists && agent.status === 'offline') {
        agent.status = 'working';
        agent.lastSeen = new Date().toISOString();
        statusChanged = true;
      } else if (!exists && agent.status !== 'offline') {
        agent.status = 'offline';
        statusChanged = true;
      }
    }
  }

  if (statusChanged) {
    saveAgents(workspace.id);
  }

  const beads = getBeads(workspace.id);

  res.json({
    ...workspace,
    beadsCount: beads.length,
    agentsCount: agents.length,
    activeTodos: beads.filter(b => b.status === 'todo' || b.status === 'in_progress').length,
    agents // Include agents for quick access
  });
});

// Get workspace by ID
app.get('/api/workspaces/:id', (req: Request, res: Response) => {
  const workspace = workspaces.find(w => w.id === req.params.id);
  if (!workspace) {
    res.status(404).json({ error: 'Workspace not found' });
    return;
  }

  // Include counts of beads and agents
  const beads = getBeads(workspace.id);
  const agents = getAgents(workspace.id);

  res.json({
    ...workspace,
    beadsCount: beads.length,
    agentsCount: agents.length,
    activeTodos: beads.filter(b => b.status === 'todo' || b.status === 'in_progress').length
  });
});

app.post('/api/workspaces/:id/start', async (req: Request, res: Response) => {
  const workspace = workspaces.find(w => w.id === req.params.id);
  if (!workspace) {
    res.status(404).json({ error: 'Workspace not found' });
    return;
  }

  if (workspace.status === 'active') {
    res.status(400).json({ error: 'Workspace is already active' });
    return;
  }

  // Validate directory still exists
  if (!fs.existsSync(workspace.workingDirectory)) {
    res.status(400).json({ error: 'Working directory no longer exists' });
    return;
  }

  try {
    // Spawn mayor for this workspace
    const mayor = await spawnMayorForWorkspace(workspace);

    // Update workspace status
    workspace.status = 'active';
    workspace.mayorId = mayor.id;
    workspace.lastActivity = new Date().toISOString();
    saveWorkspaces();

    broadcast('workspace:started', { workspace, mayor });

    res.json({ workspace, mayor });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.post('/api/workspaces/:id/stop', async (req: Request, res: Response) => {
  const workspace = workspaces.find(w => w.id === req.params.id);
  if (!workspace) {
    res.status(404).json({ error: 'Workspace not found' });
    return;
  }

  if (workspace.status !== 'active') {
    res.status(400).json({ error: 'Workspace is not active' });
    return;
  }

  const result = await stopWorkspace(workspace.id);
  res.json(result);
});

app.delete('/api/workspaces/:id', async (req: Request, res: Response) => {
  const index = workspaces.findIndex(w => w.id === req.params.id);
  if (index === -1) {
    res.status(404).json({ error: 'Workspace not found' });
    return;
  }

  const workspace = workspaces[index];

  // Stop workspace first if active
  if (workspace.status === 'active') {
    await stopWorkspace(workspace.id);
  }

  // Delete workspace data
  deleteWorkspaceData(workspace.id);

  // Remove from workspaces list
  workspaces.splice(index, 1);
  saveWorkspaces();

  broadcast('workspace:deleted', { id: workspace.id });

  res.json({ success: true });
});

// ============ LEGACY MAYOR API (for backward compatibility) ============

// Helper to find workspace from query or infer from active
function getWorkspaceIdFromRequest(req: Request): string | null {
  const { workspaceId } = req.query;
  if (workspaceId) return workspaceId as string;

  // Fall back to active workspace for backward compatibility
  const activeWorkspace = workspaces.find(w => w.status === 'active');
  return activeWorkspace?.id || null;
}

app.post('/api/mayor/start', async (req: Request, res: Response) => {
  const { workingDirectory, name } = req.body;

  if (!workingDirectory) {
    res.status(400).json({ error: 'workingDirectory is required' });
    return;
  }

  // Check if there's already an active workspace
  const activeWorkspace = workspaces.find(w => w.status === 'active');
  if (activeWorkspace) {
    res.status(400).json({ error: 'A workspace is already active. Stop it first or use multi-workspace API.' });
    return;
  }

  try {
    // Create a new workspace
    const now = new Date().toISOString();
    const workspace: Workspace = {
      id: uuidv4(),
      name: name || path.basename(workingDirectory),
      workingDirectory,
      status: 'stopped',
      mayorId: null,
      created: now,
      lastActivity: now
    };

    ensureWorkspaceDataDir(workspace.id);
    workspaces.push(workspace);
    saveWorkspaces();

    // Spawn mayor
    const mayor = await spawnMayorForWorkspace(workspace);

    // Update workspace status
    workspace.status = 'active';
    workspace.mayorId = mayor.id;
    workspace.lastActivity = new Date().toISOString();
    saveWorkspaces();

    broadcast('workspace:created', workspace);
    broadcast('workspace:started', { workspace, mayor });

    res.status(201).json({ workspace, mayor });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.get('/api/mayor/status', (_req: Request, res: Response) => {
  // Find active workspace (for legacy compatibility)
  const activeWorkspace = workspaces.find(w => w.status === 'active');
  if (!activeWorkspace) {
    res.json({
      workspace: null,
      mayor: null,
      isRunning: false
    });
    return;
  }

  const agents = getAgents(activeWorkspace.id);
  // Find mayor by workspace.mayorId first, fall back to role-based lookup
  const mayor = agents.find(a => a.id === activeWorkspace.mayorId) || agents.find(a => a.role === 'mayor');
  const isRunning = activeWorkspace.status === 'active' && mayor?.status !== 'offline';

  res.json({
    workspace: activeWorkspace,
    mayor: mayor || null,
    isRunning
  });
});

app.post('/api/mayor/stop', async (_req: Request, res: Response) => {
  // Find active workspace (for legacy compatibility)
  const activeWorkspace = workspaces.find(w => w.status === 'active');
  if (!activeWorkspace) {
    res.status(400).json({ error: 'No active workspace' });
    return;
  }

  const result = await stopWorkspace(activeWorkspace.id);
  res.json(result);
});

app.post('/api/mayor/restart', async (req: Request, res: Response) => {
  const { additionalContext } = req.body;

  // Find active workspace (for legacy compatibility)
  const activeWorkspace = workspaces.find(w => w.status === 'active');
  if (!activeWorkspace) {
    res.status(400).json({ error: 'No active workspace to restart' });
    return;
  }

  // Stop current workspace
  await stopWorkspace(activeWorkspace.id);

  // Restart it
  try {
    const mayor = await spawnMayorForWorkspace(activeWorkspace);

    activeWorkspace.status = 'active';
    activeWorkspace.mayorId = mayor.id;
    activeWorkspace.lastActivity = new Date().toISOString();
    saveWorkspaces();

    if (additionalContext) {
      const progress = getProgress(activeWorkspace.id);
      const entry: ProgressEntry = {
        id: uuidv4(),
        agentId: mayor.id,
        agentName: 'mayor',
        timestamp: new Date().toISOString(),
        status: 'Restarted with context',
        completed: [],
        next: [],
        artifacts: [],
        blockers: []
      };
      progress.push(entry);
      saveProgress(activeWorkspace.id);
    }

    broadcast('workspace:started', { workspace: activeWorkspace, mayor });

    res.json({ workspace: activeWorkspace, mayor });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// ============ BEADS API ============

app.get('/api/beads', (req: Request, res: Response) => {
  const workspaceId = getWorkspaceIdFromRequest(req);
  if (!workspaceId) {
    res.status(400).json({ error: 'workspaceId is required (or have an active workspace)' });
    return;
  }

  const { assignee, status } = req.query;
  let filtered = getBeads(workspaceId);

  if (assignee) {
    filtered = filtered.filter(b => b.assignee === assignee);
  }
  if (status) {
    filtered = filtered.filter(b => b.status === status);
  }

  res.json(filtered);
});

app.get('/api/beads/next/available', (req: Request, res: Response) => {
  const workspaceId = getWorkspaceIdFromRequest(req);
  if (!workspaceId) {
    res.status(400).json({ error: 'workspaceId is required (or have an active workspace)' });
    return;
  }

  const beads = getBeads(workspaceId);
  const available = beads
    .filter(b => b.status === 'todo' && b.blockedBy.length === 0)
    .sort((a, b) => a.priority - b.priority);

  res.json(available[0] || null);
});

app.get('/api/beads/:id', (req: Request, res: Response) => {
  // Search across all workspaces or specified workspace
  const workspaceId = getWorkspaceIdFromRequest(req);

  if (workspaceId) {
    const beads = getBeads(workspaceId);
    const bead = beads.find(b => b.id === req.params.id);
    if (bead) {
      res.json(bead);
      return;
    }
  } else {
    // Search all workspaces
    for (const ws of workspaces) {
      const beads = getBeads(ws.id);
      const bead = beads.find(b => b.id === req.params.id);
      if (bead) {
        res.json(bead);
        return;
      }
    }
  }

  res.status(404).json({ error: 'Bead not found' });
});

app.post('/api/beads', (req: Request, res: Response) => {
  const { title, description, priority = 5, assignee = null, blocks = [], blockedBy = [], workspaceId: bodyWorkspaceId } = req.body;

  const workspaceId = bodyWorkspaceId || getWorkspaceIdFromRequest(req);
  if (!workspaceId) {
    res.status(400).json({ error: 'workspaceId is required' });
    return;
  }

  if (!title) {
    res.status(400).json({ error: 'Title is required' });
    return;
  }

  const beads = getBeads(workspaceId);
  const now = new Date().toISOString();
  const bead: Bead = {
    id: `BEAD-${String(beads.length + 1).padStart(3, '0')}`,
    title,
    description: description || '',
    status: 'todo',
    priority,
    assignee,
    blocks,
    blockedBy,
    created: now,
    updated: now,
    audit: [{ time: now, action: 'created', by: 'system' }]
  };

  beads.push(bead);
  saveBeads(workspaceId);
  broadcast('bead:created', bead, workspaceId);

  // Update workspace activity
  const workspace = workspaces.find(w => w.id === workspaceId);
  if (workspace) {
    workspace.lastActivity = now;
    saveWorkspaces();
  }

  res.status(201).json(bead);
});

app.patch('/api/beads/:id', (req: Request, res: Response) => {
  // Find bead across workspaces
  let foundWorkspaceId: string | null = null;
  let beads: Bead[] = [];
  let index = -1;

  const specificWorkspaceId = getWorkspaceIdFromRequest(req);
  if (specificWorkspaceId) {
    beads = getBeads(specificWorkspaceId);
    index = beads.findIndex(b => b.id === req.params.id);
    if (index !== -1) {
      foundWorkspaceId = specificWorkspaceId;
    }
  } else {
    for (const ws of workspaces) {
      beads = getBeads(ws.id);
      index = beads.findIndex(b => b.id === req.params.id);
      if (index !== -1) {
        foundWorkspaceId = ws.id;
        break;
      }
    }
  }

  if (index === -1 || !foundWorkspaceId) {
    res.status(404).json({ error: 'Bead not found' });
    return;
  }

  const { status, assignee, priority, title, description, blocks, blockedBy } = req.body;
  const bead = beads[index];
  const now = new Date().toISOString();

  if (status && status !== bead.status) {
    bead.audit.push({ time: now, action: 'status_change', by: assignee || 'system', details: { from: bead.status, to: status } });
    bead.status = status;
  }
  if (assignee !== undefined && assignee !== bead.assignee) {
    bead.audit.push({ time: now, action: 'assigned', by: 'system', details: { to: assignee } });
    bead.assignee = assignee;
  }
  if (priority !== undefined) bead.priority = priority;
  if (title !== undefined) bead.title = title;
  if (description !== undefined) bead.description = description;
  if (blocks !== undefined) bead.blocks = blocks;
  if (blockedBy !== undefined) bead.blockedBy = blockedBy;

  bead.updated = now;
  beads[index] = bead;
  saveBeads(foundWorkspaceId);
  broadcast('bead:updated', bead, foundWorkspaceId);

  res.json(bead);
});

app.delete('/api/beads/:id', (req: Request, res: Response) => {
  // Find bead across workspaces
  let foundWorkspaceId: string | null = null;
  let beads: Bead[] = [];
  let index = -1;

  const specificWorkspaceId = getWorkspaceIdFromRequest(req);
  if (specificWorkspaceId) {
    beads = getBeads(specificWorkspaceId);
    index = beads.findIndex(b => b.id === req.params.id);
    if (index !== -1) {
      foundWorkspaceId = specificWorkspaceId;
    }
  } else {
    for (const ws of workspaces) {
      beads = getBeads(ws.id);
      index = beads.findIndex(b => b.id === req.params.id);
      if (index !== -1) {
        foundWorkspaceId = ws.id;
        break;
      }
    }
  }

  if (index === -1 || !foundWorkspaceId) {
    res.status(404).json({ error: 'Bead not found' });
    return;
  }

  const deleted = beads.splice(index, 1)[0];
  saveBeads(foundWorkspaceId);
  broadcast('bead:deleted', { id: deleted.id }, foundWorkspaceId);

  res.json({ success: true });
});

// ============ AGENTS API ============

app.get('/api/agents', (req: Request, res: Response) => {
  const workspaceId = getWorkspaceIdFromRequest(req);
  if (!workspaceId) {
    // Return all agents from all workspaces for global view
    const allAgents: Agent[] = [];
    for (const ws of workspaces) {
      allAgents.push(...getAgents(ws.id));
    }
    res.json(allAgents);
    return;
  }

  res.json(getAgents(workspaceId));
});

app.get('/api/agents/:id', (req: Request, res: Response) => {
  // Search across all workspaces
  for (const ws of workspaces) {
    const agents = getAgents(ws.id);
    const agent = agents.find(a => a.id === req.params.id);
    if (agent) {
      res.json(agent);
      return;
    }
  }

  res.status(404).json({ error: 'Agent not found' });
});

app.post('/api/agents/spawn', async (req: Request, res: Response) => {
  const { name, role = 'specialist', model = 'sonnet', prompt, workspaceId: bodyWorkspaceId } = req.body;

  const workspaceId = bodyWorkspaceId || getWorkspaceIdFromRequest(req);
  if (!workspaceId) {
    res.status(400).json({ error: 'workspaceId is required' });
    return;
  }

  const workspace = workspaces.find(w => w.id === workspaceId);
  if (!workspace) {
    res.status(404).json({ error: 'Workspace not found' });
    return;
  }

  if (!name || !prompt) {
    res.status(400).json({ error: 'Name and prompt are required' });
    return;
  }

  if (workspace.status !== 'active') {
    res.status(400).json({ error: 'Workspace must be active to spawn agents' });
    return;
  }

  const agents = getAgents(workspaceId);

  // Check for duplicate name in this workspace
  if (agents.find(a => a.name === name)) {
    res.status(400).json({ error: 'Agent with this name already exists in this workspace' });
    return;
  }

  const now = new Date().toISOString();
  const agent: Agent = {
    id: uuidv4(),
    name,
    role: role as Agent['role'],
    model: model as Agent['model'],
    status: 'starting',
    currentTask: null,
    worktree: null,
    tmuxSession: getTmuxSessionName(workspace, name),
    pid: null,
    lastSeen: now,
    created: now,
    workspaceId
  };

  agents.push(agent);
  saveAgents(workspaceId);
  broadcast('agent:created', agent, workspaceId);

  // Generate full prompt and spawn
  const fullPrompt = generateSubAgentPrompt(agent, workspace, prompt);
  const success = await spawnClaudeAgent(agent, workspace, fullPrompt);

  if (success) {
    agent.status = 'working';
  } else {
    agent.status = 'offline';
  }
  saveAgents(workspaceId);
  broadcast('agent:updated', agent, workspaceId);

  res.status(201).json(agent);
});

app.delete('/api/agents/:id', (req: Request, res: Response) => {
  // Find agent across all workspaces
  let foundWorkspaceId: string | null = null;
  let agents: Agent[] = [];
  let index = -1;

  for (const ws of workspaces) {
    agents = getAgents(ws.id);
    index = agents.findIndex(a => a.id === req.params.id);
    if (index !== -1) {
      foundWorkspaceId = ws.id;
      break;
    }
  }

  if (index === -1 || !foundWorkspaceId) {
    res.status(404).json({ error: 'Agent not found' });
    return;
  }

  const agent = agents[index];

  // Don't allow deleting Mayor directly - use workspace stop
  if (agent.role === 'mayor') {
    res.status(400).json({ error: 'Cannot delete Mayor directly. Use workspace stop instead.' });
    return;
  }

  // Save log and kill session
  if (agent.tmuxSession && sessionExists(agent.tmuxSession)) {
    saveTmuxSessionLog(agent.tmuxSession, agent.name, foundWorkspaceId);
    killTmuxSession(agent.tmuxSession);
  }

  agents.splice(index, 1);
  saveAgents(foundWorkspaceId);
  broadcast('agent:deleted', { id: agent.id }, foundWorkspaceId);

  res.json({ success: true });
});

// ============ PROGRESS API ============

app.get('/api/progress', (req: Request, res: Response) => {
  const workspaceId = getWorkspaceIdFromRequest(req);
  const { agentId, limit = 50 } = req.query;

  if (!workspaceId) {
    // Return combined progress from all workspaces
    const allProgress: ProgressEntry[] = [];
    for (const ws of workspaces) {
      allProgress.push(...getProgress(ws.id));
    }
    let filtered = allProgress;
    if (agentId) {
      filtered = filtered.filter(p => p.agentId === agentId);
    }
    // Sort by timestamp and return most recent
    filtered.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    res.json(filtered.slice(0, Number(limit)));
    return;
  }

  let filtered = getProgress(workspaceId);

  if (agentId) {
    filtered = filtered.filter(p => p.agentId === agentId);
  }

  res.json(filtered.slice(-Number(limit)));
});

app.post('/api/progress', (req: Request, res: Response) => {
  const { agentId, agentName, status, completed = [], next = [], artifacts = [], blockers = [], workspaceId: bodyWorkspaceId } = req.body;

  const workspaceId = bodyWorkspaceId || getWorkspaceIdFromRequest(req);
  if (!workspaceId) {
    res.status(400).json({ error: 'workspaceId is required' });
    return;
  }

  if (!agentId || !agentName || !status) {
    res.status(400).json({ error: 'agentId, agentName, and status are required' });
    return;
  }

  const progress = getProgress(workspaceId);
  const entry: ProgressEntry = {
    id: uuidv4(),
    agentId,
    agentName,
    timestamp: new Date().toISOString(),
    status,
    completed,
    next,
    artifacts,
    blockers
  };

  progress.push(entry);
  saveProgress(workspaceId);
  broadcast('progress:new', entry, workspaceId);

  // Update workspace activity
  const workspace = workspaces.find(w => w.id === workspaceId);
  if (workspace) {
    workspace.lastActivity = new Date().toISOString();
    saveWorkspaces();
  }

  res.status(201).json(entry);
});

// ============ MESSAGES API ============

app.get('/api/messages', (req: Request, res: Response) => {
  const workspaceId = getWorkspaceIdFromRequest(req);
  const { to, unread } = req.query;

  if (!workspaceId) {
    // Return combined messages from all workspaces
    const allMessages: Message[] = [];
    for (const ws of workspaces) {
      allMessages.push(...getMessages(ws.id));
    }
    let filtered = allMessages;
    if (to) {
      filtered = filtered.filter(m => m.to === to || m.to === 'all');
    }
    if (unread === 'true') {
      filtered = filtered.filter(m => !m.read);
    }
    // Sort by timestamp
    filtered.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    res.json(filtered);
    return;
  }

  let filtered = getMessages(workspaceId);

  if (to) {
    filtered = filtered.filter(m => m.to === to || m.to === 'all');
  }
  if (unread === 'true') {
    filtered = filtered.filter(m => !m.read);
  }

  res.json(filtered);
});

app.post('/api/messages', (req: Request, res: Response) => {
  const { from, to, content, type = 'info', workspaceId: bodyWorkspaceId } = req.body;

  const workspaceId = bodyWorkspaceId || getWorkspaceIdFromRequest(req);
  if (!workspaceId) {
    res.status(400).json({ error: 'workspaceId is required' });
    return;
  }

  if (!from || !to || !content) {
    res.status(400).json({ error: 'from, to, and content are required' });
    return;
  }

  const messages = getMessages(workspaceId);
  const message: Message = {
    id: uuidv4(),
    from,
    to,
    timestamp: new Date().toISOString(),
    content,
    read: false,
    type: type as Message['type']
  };

  messages.push(message);
  saveMessages(workspaceId);
  broadcast('message:new', message, workspaceId);

  res.status(201).json(message);
});

app.patch('/api/messages/:id/read', (req: Request, res: Response) => {
  // Find message across workspaces
  for (const ws of workspaces) {
    const messages = getMessages(ws.id);
    const index = messages.findIndex(m => m.id === req.params.id);
    if (index !== -1) {
      messages[index].read = true;
      saveMessages(ws.id);
      res.json(messages[index]);
      return;
    }
  }

  res.status(404).json({ error: 'Message not found' });
});

// ============ STATS API ============

app.get('/api/stats', (req: Request, res: Response) => {
  const workspaceId = getWorkspaceIdFromRequest(req);

  if (!workspaceId) {
    // Global stats across all workspaces
    let totalBeads = 0, todoBeads = 0, inProgressBeads = 0, doneBeads = 0, blockedBeads = 0;
    let totalAgents = 0, workingAgents = 0, idleAgents = 0, blockedAgents = 0, offlineAgents = 0;
    let totalMessages = 0, unreadMessages = 0, totalProgress = 0;

    for (const ws of workspaces) {
      const beads = getBeads(ws.id);
      totalBeads += beads.length;
      todoBeads += beads.filter(b => b.status === 'todo').length;
      inProgressBeads += beads.filter(b => b.status === 'in_progress').length;
      doneBeads += beads.filter(b => b.status === 'done').length;
      blockedBeads += beads.filter(b => b.status === 'blocked').length;

      const agents = getAgents(ws.id);
      totalAgents += agents.length;
      workingAgents += agents.filter(a => a.status === 'working').length;
      idleAgents += agents.filter(a => a.status === 'idle').length;
      blockedAgents += agents.filter(a => a.status === 'blocked').length;
      offlineAgents += agents.filter(a => a.status === 'offline').length;

      const messages = getMessages(ws.id);
      totalMessages += messages.length;
      unreadMessages += messages.filter(m => !m.read).length;

      totalProgress += getProgress(ws.id).length;
    }

    res.json({
      workspaces: {
        total: workspaces.length,
        active: workspaces.filter(w => w.status === 'active').length,
        stopped: workspaces.filter(w => w.status === 'stopped').length
      },
      beads: {
        total: totalBeads,
        todo: todoBeads,
        inProgress: inProgressBeads,
        done: doneBeads,
        blocked: blockedBeads
      },
      agents: {
        total: totalAgents,
        working: workingAgents,
        idle: idleAgents,
        blocked: blockedAgents,
        offline: offlineAgents
      },
      messages: {
        total: totalMessages,
        unread: unreadMessages
      },
      progressEntries: totalProgress
    });
    return;
  }

  const beads = getBeads(workspaceId);
  const agents = getAgents(workspaceId);
  const messages = getMessages(workspaceId);
  const progress = getProgress(workspaceId);

  res.json({
    beads: {
      total: beads.length,
      todo: beads.filter(b => b.status === 'todo').length,
      inProgress: beads.filter(b => b.status === 'in_progress').length,
      done: beads.filter(b => b.status === 'done').length,
      blocked: beads.filter(b => b.status === 'blocked').length
    },
    agents: {
      total: agents.length,
      working: agents.filter(a => a.status === 'working').length,
      idle: agents.filter(a => a.status === 'idle').length,
      blocked: agents.filter(a => a.status === 'blocked').length,
      offline: agents.filter(a => a.status === 'offline').length
    },
    messages: {
      total: messages.length,
      unread: messages.filter(m => !m.read).length
    },
    progressEntries: progress.length
  });
});

// ============ SPA FALLBACK ============

app.use((_req: Request, res: Response) => {
  const indexPath = path.join(frontendDist, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).json({ error: 'Not found' });
  }
});

// ============ WEBSOCKET SETUP ============

const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (ws: WebSocket) => {
  // Track client with no workspace subscription initially
  wsClients.set(ws, { ws, workspaceId: null });
  console.log('Dashboard WebSocket connected');

  // Send initial state with all workspaces
  ws.send(JSON.stringify({
    type: 'init',
    data: {
      workspaces,
      // No workspace-specific data until client subscribes
    },
    timestamp: new Date().toISOString()
  }));

  ws.on('message', (message) => {
    try {
      const msg = JSON.parse(message.toString());

      if (msg.type === 'subscribe' && msg.workspaceId) {
        const workspaceId = msg.workspaceId;
        const workspace = workspaces.find(w => w.id === workspaceId);

        if (workspace) {
          wsClients.set(ws, { ws, workspaceId });
          console.log(`Client subscribed to workspace: ${workspaceId}`);

          // Send workspace-specific data
          ws.send(JSON.stringify({
            type: 'workspace:subscribed',
            data: {
              workspace,
              beads: getBeads(workspaceId),
              agents: getAgents(workspaceId),
              progress: getProgress(workspaceId).slice(-20),
              messages: getMessages(workspaceId).slice(-20)
            },
            timestamp: new Date().toISOString()
          }));
        } else {
          ws.send(JSON.stringify({
            type: 'error',
            data: { message: 'Workspace not found' },
            timestamp: new Date().toISOString()
          }));
        }
      } else if (msg.type === 'unsubscribe') {
        wsClients.set(ws, { ws, workspaceId: null });
        console.log('Client unsubscribed from workspace');
      }
    } catch {
      // Ignore non-JSON messages
    }
  });

  ws.on('close', () => {
    wsClients.delete(ws);
    console.log('Dashboard WebSocket disconnected');
  });

  ws.on('error', (err) => {
    console.error('Dashboard WebSocket error:', err);
    wsClients.delete(ws);
  });
});

// Terminal WebSocket
const terminalWss = new WebSocketServer({ noServer: true });
const terminalConnections = new Map<string, { pty: IPty; ws: WebSocket }>();

terminalWss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const sessionName = url.searchParams.get('session');

  if (!sessionName) {
    ws.close(1008, 'Session name required');
    return;
  }

  const sanitized = sessionName.replace(/[^a-zA-Z0-9-_]/g, '-');
  if (!sanitized) {
    ws.close(1008, 'Invalid session name');
    return;
  }

  console.log(`Terminal connecting to session: ${sanitized}`);

  // Find workspace from session name (new format: {workspace-slug}-{role})
  let workspace = getWorkspaceFromSessionName(sanitized);

  // Also try legacy format: ws-{id:8}-{type}
  if (!workspace) {
    const legacyMatch = sanitized.match(/^ws-([a-f0-9]{8})-/);
    if (legacyMatch) {
      const workspacePrefix = legacyMatch[1];
      workspace = workspaces.find(w => w.id.startsWith(workspacePrefix)) || null;
    }
  }

  // Check if session exists
  if (!sessionExists(sanitized)) {
    if (workspace && sanitized.endsWith('-mayor')) {
      // Create mayor session for this workspace
      console.log(`Creating tmux session ${sanitized} for workspace ${workspace.name}`);
      if (!createTmuxSession(sanitized, workspace.workingDirectory)) {
        ws.close(1011, 'Failed to create session');
        return;
      }
    } else {
      ws.close(1011, 'Session does not exist');
      return;
    }
  }

  // Determine working directory
  const workingDir = workspace?.workingDirectory || process.cwd();

  const pty = spawn('tmux', ['-S', TMUX_SOCKET, 'attach-session', '-t', sanitized], {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd: workingDir,
    env: { ...process.env, TERM: 'xterm-256color' },
  });

  const connectionId = `${sanitized}-${Date.now()}`;
  terminalConnections.set(connectionId, { pty, ws });

  pty.onData((data) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  });

  pty.onExit(() => {
    terminalConnections.delete(connectionId);
    if (ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
  });

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());
      if (data.type === 'resize' && data.cols && data.rows) {
        pty.resize(data.cols, data.rows);
      } else if (data.type === 'input' && data.data) {
        pty.write(data.data);
      }
    } catch {
      pty.write(message.toString());
    }
  });

  ws.on('close', () => {
    terminalConnections.delete(connectionId);
    pty.kill();
  });

  ws.on('error', (err) => {
    console.error('Terminal WebSocket error:', err);
    terminalConnections.delete(connectionId);
    pty.kill();
  });
});

server.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url || '', `http://${request.headers.host}`).pathname;

  if (pathname === '/ws') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else if (pathname === '/ws/terminal') {
    terminalWss.handleUpgrade(request, socket, head, (ws) => {
      terminalWss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

// ============ STARTUP ============

server.listen(PORT, () => {
  console.log(`Orchestrator server running on port ${PORT}`);
  console.log(`Data directory: ${DATA_DIR}`);
  console.log(`Workspaces directory: ${WORKSPACES_DIR}`);
  console.log(`Tmux socket: ${TMUX_SOCKET}`);
  console.log(`Total workspaces: ${workspaces.length}`);
  const activeWorkspaces = workspaces.filter(w => w.status === 'active');
  if (activeWorkspaces.length > 0) {
    console.log(`Active workspaces: ${activeWorkspaces.length}`);
    activeWorkspaces.forEach(w => {
      console.log(`  - ${w.name} (${w.id.substring(0, 8)}): ${w.workingDirectory}`);
    });
  } else {
    console.log('No active workspaces');
  }
});
