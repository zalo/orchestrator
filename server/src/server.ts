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
  // Test verification
  requiresTests: boolean;  // Whether this bead requires tests to pass before completion
  testStatus: 'pending' | 'running' | 'passed' | 'failed' | 'skipped' | null;
  testOutput: string | null;  // Last test output/error message
  testRunAt: string | null;  // When tests were last run
}

interface AuditEntry {
  time: string;
  action: string;
  by: string;
  details?: Record<string, unknown>;
}

// Agent roles following Gas Town model:
// - mayor: Global coordinator, dispatches work, does NOT edit code
// - specialist: Implementation worker (like Crew/Polecat in Gas Town)
// - reviewer: Quality gate, code reviews (like Dog in Gas Town)
// - explorer: Scout/reconnaissance agent (like Polecat in Gas Town)
// - witness: Per-workspace monitor, watches specialists, handles lifecycle
// - refinery: Merge queue processor, handles sequential rebases
// - deacon: Daemon patrol, keeps other agents alive
type AgentRole = 'mayor' | 'specialist' | 'reviewer' | 'explorer' | 'witness' | 'refinery' | 'deacon';

interface Agent {
  id: string;
  name: string;
  role: AgentRole;
  model: 'opus' | 'sonnet' | 'haiku';
  status: 'idle' | 'working' | 'blocked' | 'offline' | 'starting';
  currentTask: string | null;
  worktree: string | null;
  worktreeBranch: string | null;
  ownedPaths: string[];  // File/directory patterns this agent owns (e.g., "src/auth/**", "src/components/Button.tsx")
  tmuxSession: string | null;
  pid: number | null;
  lastSeen: string;
  created: string;
  workspaceId?: string;
  // Hierarchical delegation support
  parentAgentId: string | null;  // ID of agent that spawned this one (null for mayor)
  canSpawnAgents: boolean;  // Whether this agent can spawn sub-agents
  spawnedAgentIds: string[];  // IDs of agents this agent has spawned
}

interface MergeRequest {
  id: string;
  agentId: string;
  agentName: string;
  branch: string;
  targetBranch: string;
  title: string;
  description: string;
  status: 'pending' | 'in_queue' | 'merging' | 'merged' | 'failed' | 'conflict';
  position: number;  // Position in merge queue (0 = next to merge)
  created: string;
  updated: string;
  mergedAt: string | null;
  conflictsWith: string[];  // Other MR ids that conflict
  filesChanged: string[];
  // Review gate fields
  reviewStatus: 'pending' | 'approved' | 'changes_requested';
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewComments: string | null;
  // Build verification fields
  buildStatus: 'pending' | 'running' | 'passed' | 'failed';
  buildOutput: string | null;
  buildCheckedAt: string | null;
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
const workspaceMergeQueue = new Map<string, MergeRequest[]>();

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

function getMergeQueue(workspaceId: string): MergeRequest[] {
  if (!workspaceMergeQueue.has(workspaceId)) {
    workspaceMergeQueue.set(workspaceId, loadWorkspaceData(workspaceId, 'merge-queue.json', []));
  }
  return workspaceMergeQueue.get(workspaceId)!;
}

function saveMergeQueue(workspaceId: string) {
  const queue = workspaceMergeQueue.get(workspaceId) || [];
  saveWorkspaceData(workspaceId, 'merge-queue.json', queue);
}

function clearWorkspaceCache(workspaceId: string) {
  workspaceBeads.delete(workspaceId);
  workspaceAgents.delete(workspaceId);
  workspaceProgress.delete(workspaceId);
  workspaceMessages.delete(workspaceId);
  workspaceMergeQueue.delete(workspaceId);
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

/**
 * Send a message to a Claude Code session reliably.
 * This is the canonical way to send messages to Claude sessions.
 * Pattern from Gas Town: literal mode + debounce + Escape + separate Enter.
 *
 * @param sessionName - The tmux session name
 * @param message - The message to send
 * @param debounceMs - Time to wait between text and Enter (default 500ms)
 */
function nudgeTmuxSession(sessionName: string, message: string, debounceMs: number = 500): boolean {
  try {
    // 1. Send text in literal mode (-l) to handle special characters
    execSync(`tmux -S '${TMUX_SOCKET}' send-keys -t '${sessionName}' -l ${JSON.stringify(message)}`, { encoding: 'utf-8' });

    // 2. Wait for paste to complete (tested, required for Claude Code)
    execSync(`sleep ${debounceMs / 1000}`, { encoding: 'utf-8' });

    // 3. Send Escape to exit vim INSERT mode if enabled (harmless in normal mode)
    try {
      execSync(`tmux -S '${TMUX_SOCKET}' send-keys -t '${sessionName}' Escape`, { encoding: 'utf-8' });
    } catch { /* ignore - harmless if it fails */ }
    execSync(`sleep 0.1`, { encoding: 'utf-8' });

    // 4. Send Enter separately (more reliable than appending to send-keys)
    execSync(`tmux -S '${TMUX_SOCKET}' send-keys -t '${sessionName}' Enter`, { encoding: 'utf-8' });

    return true;
  } catch (e) {
    console.error(`Failed to nudge tmux session ${sessionName}:`, e);
    return false;
  }
}

// ============ GIT WORKTREE HELPERS ============

function isGitRepo(dir: string): boolean {
  try {
    execSync(`git -C "${dir}" rev-parse --is-inside-work-tree 2>/dev/null`, { encoding: 'utf-8' });
    return true;
  } catch {
    return false;
  }
}

function getWorktreesDir(workspace: Workspace): string {
  // Store worktrees in a sibling directory to avoid polluting the main repo
  const parentDir = path.dirname(workspace.workingDirectory);
  const workspaceName = path.basename(workspace.workingDirectory);
  return path.join(parentDir, `.${workspaceName}-worktrees`);
}

function createWorktree(workspace: Workspace, agentName: string, branchName: string): { path: string; branch: string } | null {
  if (!isGitRepo(workspace.workingDirectory)) {
    console.log(`Workspace ${workspace.name} is not a git repo, skipping worktree creation`);
    return null;
  }

  const worktreesDir = getWorktreesDir(workspace);
  if (!fs.existsSync(worktreesDir)) {
    fs.mkdirSync(worktreesDir, { recursive: true });
  }

  const worktreePath = path.join(worktreesDir, agentName);
  const fullBranchName = `agent/${agentName}/${branchName}`;

  try {
    // Check if worktree already exists
    if (fs.existsSync(worktreePath)) {
      console.log(`Worktree already exists at ${worktreePath}, removing it first`);
      removeWorktree(workspace, worktreePath);
    }

    // Get current branch/commit to branch from
    const currentRef = execSync(`git -C "${workspace.workingDirectory}" rev-parse HEAD`, { encoding: 'utf-8' }).trim();

    // Create a new branch and worktree
    execSync(`git -C "${workspace.workingDirectory}" worktree add -b "${fullBranchName}" "${worktreePath}" ${currentRef}`, { encoding: 'utf-8' });

    console.log(`Created worktree for ${agentName} at ${worktreePath} on branch ${fullBranchName}`);
    return { path: worktreePath, branch: fullBranchName };
  } catch (e) {
    console.error(`Failed to create worktree for ${agentName}:`, e);
    return null;
  }
}

function removeWorktree(workspace: Workspace, worktreePath: string): boolean {
  if (!isGitRepo(workspace.workingDirectory)) {
    return false;
  }

  try {
    // Force remove the worktree
    execSync(`git -C "${workspace.workingDirectory}" worktree remove --force "${worktreePath}" 2>/dev/null`, { encoding: 'utf-8' });
    console.log(`Removed worktree at ${worktreePath}`);
    return true;
  } catch (e) {
    // Try manual cleanup if git worktree remove fails
    try {
      if (fs.existsSync(worktreePath)) {
        fs.rmSync(worktreePath, { recursive: true, force: true });
      }
      // Prune worktree references
      execSync(`git -C "${workspace.workingDirectory}" worktree prune`, { encoding: 'utf-8' });
      return true;
    } catch {
      console.error(`Failed to remove worktree at ${worktreePath}:`, e);
      return false;
    }
  }
}

function listWorktrees(workspace: Workspace): Array<{ path: string; branch: string; commit: string }> {
  if (!isGitRepo(workspace.workingDirectory)) {
    return [];
  }

  try {
    const output = execSync(`git -C "${workspace.workingDirectory}" worktree list --porcelain`, { encoding: 'utf-8' });
    const worktrees: Array<{ path: string; branch: string; commit: string }> = [];

    const entries = output.split('\n\n').filter(e => e.trim());
    for (const entry of entries) {
      const lines = entry.split('\n');
      let wPath = '';
      let commit = '';
      let branch = '';

      for (const line of lines) {
        if (line.startsWith('worktree ')) wPath = line.substring(9);
        if (line.startsWith('HEAD ')) commit = line.substring(5);
        if (line.startsWith('branch ')) branch = line.substring(7).replace('refs/heads/', '');
      }

      if (wPath && wPath !== workspace.workingDirectory) {
        worktrees.push({ path: wPath, branch, commit });
      }
    }

    return worktrees;
  } catch {
    return [];
  }
}

// ============ FILE OWNERSHIP HELPERS ============

function checkPathOverlap(paths1: string[], paths2: string[]): string[] {
  const overlaps: string[] = [];

  for (const p1 of paths1) {
    for (const p2 of paths2) {
      // Simple overlap check - exact match or one contains the other
      if (p1 === p2) {
        overlaps.push(p1);
      } else if (p1.endsWith('/**') && p2.startsWith(p1.slice(0, -3))) {
        overlaps.push(p2);
      } else if (p2.endsWith('/**') && p1.startsWith(p2.slice(0, -3))) {
        overlaps.push(p1);
      } else if (p1.includes('*') || p2.includes('*')) {
        // For glob patterns, do a basic prefix check
        const p1Base = p1.split('*')[0];
        const p2Base = p2.split('*')[0];
        if (p1Base && p2Base && (p1.startsWith(p2Base) || p2.startsWith(p1Base))) {
          overlaps.push(`${p1} <-> ${p2}`);
        }
      }
    }
  }

  return overlaps;
}

function getFileOwnership(workspaceId: string): Map<string, string> {
  const ownership = new Map<string, string>();
  const agents = getAgents(workspaceId);

  for (const agent of agents) {
    if (agent.status !== 'offline' && agent.ownedPaths) {
      for (const p of agent.ownedPaths) {
        ownership.set(p, agent.name);
      }
    }
  }

  return ownership;
}

function checkOwnershipConflicts(workspaceId: string, newPaths: string[], excludeAgentId?: string): Array<{ path: string; owner: string }> {
  const conflicts: Array<{ path: string; owner: string }> = [];
  const agents = getAgents(workspaceId);

  for (const agent of agents) {
    if (agent.id === excludeAgentId) continue;
    if (agent.status === 'offline') continue;
    if (!agent.ownedPaths || agent.ownedPaths.length === 0) continue;

    const overlaps = checkPathOverlap(newPaths, agent.ownedPaths);
    for (const overlap of overlaps) {
      conflicts.push({ path: overlap, owner: agent.name });
    }
  }

  return conflicts;
}

// ============ MAYOR PROMPT GENERATION ============

function generateMayorPrompt(workspace: Workspace, mayorId: string): string {
  const apiBase = `http://localhost:${PORT}`;

  return `You are the MAYOR - the primary orchestrating AI for this workspace.

## ⚡ THE PROPULSION PRINCIPLE

This workspace is a steam engine. You are the main drive shaft.

The entire system's throughput depends on ONE thing: when you find work (messages, beads, user requests), you EXECUTE. No unnecessary confirmation. No excessive waiting.

**The failure mode we're preventing:**
- Mayor restarts
- Mayor announces itself with lengthy preamble
- Mayor waits for explicit "go ahead"
- Work sits idle while capable agents wait

**Your startup behavior:**
1. Check for pending messages from agents
2. Check for in-progress beads that need attention
3. If work exists → ADDRESS IT (brief acknowledgment, then action)
4. If nothing pending → Greet user and ask what they'd like to accomplish

## 📜 THE CAPABILITY LEDGER

Every completion is recorded. Every handoff is logged. Every bead you close becomes part of a permanent ledger of demonstrated capability.

**Why this matters:**
1. **Your work is visible** - The beads system tracks what actually happened, not just intentions
2. **Quality accumulates** - Consistent good work builds over time. The ledger shows trajectory.
3. **Every completion is evidence** - When you execute autonomously and deliver, you're proving multi-agent orchestration works at scale

## YOUR ROLE: MAYOR (Global Coordinator)

You are the **central coordinator** and user interface for all work. Your responsibilities:

1. **Converse naturally** with the user - understand their goals, ask clarifying questions
2. **Plan and organize** work into beads (atomic tasks) when appropriate
3. **Spawn sub-agents** for parallel or specialized work
4. **Monitor and coordinate** all ongoing work via messages
5. **Report progress** and surface issues to the user

**CRITICAL: Mayor does NOT implement code directly.** You are a coordinator, not an implementer. Dispatch work to specialists, don't do it yourself. This keeps your context window available for reasoning and coordination.

## WORKSPACE
Name: ${workspace.name}
ID: ${workspace.id}
Working Directory: ${workspace.workingDirectory}
API Base URL: ${apiBase}

## PROJECT CONTEXT (from bootstrap)
${(() => {
  const bootstrap = loadBootstrap(workspace.id);
  if (!bootstrap) return 'No bootstrap data available. Run POST /api/bootstrap to generate.';

  const lines: string[] = [];

  // Project type and structure
  if (bootstrap.packageInfo) {
    lines.push(`**Project Type**: ${bootstrap.packageInfo.type}${bootstrap.packageInfo.name ? ` (${bootstrap.packageInfo.name})` : ''}`);
  }

  // Key files
  if (bootstrap.structure.keyFiles.length > 0) {
    lines.push(`**Key Files**: ${bootstrap.structure.keyFiles.join(', ')}`);
  }

  // Entry points
  if (bootstrap.structure.entryPoints.length > 0) {
    lines.push(`**Entry Points**: ${bootstrap.structure.entryPoints.join(', ')}`);
  }

  // Directory structure (top-level only)
  const topDirs = bootstrap.structure.directories.filter(d => !d.includes('/'));
  if (topDirs.length > 0) {
    lines.push(`**Top-Level Dirs**: ${topDirs.join(', ')}`);
  }

  // Git info
  if (bootstrap.gitInfo.isRepo) {
    lines.push(`**Git**: Branch \`${bootstrap.gitInfo.branch || 'unknown'}\`${bootstrap.gitInfo.hasUncommitted ? ' (uncommitted changes)' : ''}`);
  }

  // Commands
  if (bootstrap.conventions.buildCommand) {
    lines.push(`**Build**: \`${bootstrap.conventions.buildCommand}\``);
  }
  if (bootstrap.conventions.testCommand) {
    lines.push(`**Test**: \`${bootstrap.conventions.testCommand}\``);
  }

  // Conventions
  const conventions: string[] = [];
  if (bootstrap.conventions.hasClaudeMd) conventions.push('CLAUDE.md');
  if (bootstrap.conventions.hasSkills) conventions.push('Skills');
  if (bootstrap.conventions.hasDocs) conventions.push('Docs');
  if (bootstrap.conventions.hasTests) conventions.push('Tests');
  if (conventions.length > 0) {
    lines.push(`**Has**: ${conventions.join(', ')}`);
  }

  return lines.join('\\n');
})()}

Query full bootstrap data: \`curl "${apiBase}/api/bootstrap?workspaceId=\${workspace.id}"\`

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

### Sub-Agents & Role Hierarchy

Spawn agents based on the work needed. Each role has specific responsibilities:

| Role | Purpose | Model | Can Spawn |
|------|---------|-------|-----------|
| **specialist** | Implementation work, coding tasks | sonnet | No |
| **reviewer** | Code review, quality gate (like "Dog" in Gas Town) | sonnet/opus | No |
| **explorer** | Reconnaissance, codebase exploration | haiku/sonnet | No |
| **witness** | Monitor specialists, handle lifecycle, escalate issues | sonnet | Yes |
| **refinery** | Process merge queue, sequential rebases | sonnet | No |
| **deacon** | Daemon patrol, keep other agents alive | sonnet | Yes |

\`\`\`bash
# Spawn a specialist (most common - implementation work)
curl -X POST ${apiBase}/api/agents/spawn \\
  -H "Content-Type: application/json" \\
  -d '{
    "workspaceId": "\${workspace.id}",
    "name": "frontend-dev",
    "role": "specialist",
    "model": "sonnet",
    "prompt": "You are a frontend specialist. Your task is to..."
  }'

# Spawn a witness to monitor multiple specialists
curl -X POST ${apiBase}/api/agents/spawn \\
  -H "Content-Type: application/json" \\
  -d '{
    "workspaceId": "\${workspace.id}",
    "name": "frontend-witness",
    "role": "witness",
    "model": "sonnet",
    "prompt": "Monitor the frontend specialists. Nudge if stuck, escalate blockers to mayor."
  }'

# Spawn a reviewer for code quality
curl -X POST ${apiBase}/api/agents/spawn \\
  -H "Content-Type: application/json" \\
  -d '{
    "workspaceId": "\${workspace.id}",
    "name": "code-reviewer",
    "role": "reviewer",
    "model": "sonnet",
    "prompt": "Review the changes in the merge queue. Check for bugs, security issues, code quality."
  }'

# Hierarchical delegation - witness spawning a specialist
curl -X POST ${apiBase}/api/agents/spawn \\
  -H "Content-Type: application/json" \\
  -d '{
    "workspaceId": "\${workspace.id}",
    "name": "auth-specialist",
    "role": "specialist",
    "model": "sonnet",
    "parentAgentId": "<witness-agent-id>",
    "prompt": "Implement OAuth authentication..."
  }'

# List all agents
curl "${apiBase}/api/agents?workspaceId=\${workspace.id}"

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

### Messages (CRITICAL FOR COORDINATION)

**Message passing is the lifeblood of multi-agent coordination.** Use messages liberally:

| Type | When to Use |
|------|-------------|
| **info** | Status updates, FYI notifications |
| **action_required** | Work assignments, requests needing response |
| **completion** | Task finished, ready for review |
| **blocker** | Stuck and need help (triggers escalation) |

\`\`\`bash
# Send work assignment
curl -X POST ${apiBase}/api/messages \\
  -H "Content-Type: application/json" \\
  -d '{
    "workspaceId": "\${workspace.id}",
    "from": "mayor",
    "to": "frontend-dev",
    "content": "Please focus on the login component first",
    "type": "action_required"
  }'

# Check for messages (do this regularly!)
curl "${apiBase}/api/messages?workspaceId=\${workspace.id}&to=mayor&unread=true"

# Mark message as read
curl -X PATCH ${apiBase}/api/messages/{id}/read
\`\`\`

**Message Protocol:**
1. **On spawn**: Send initial work assignment immediately
2. **On completion**: Agent MUST message completion to mayor/witness
3. **On blocker**: Agent MUST message blocker immediately
4. **On progress**: Periodic status messages keep coordination smooth
5. **Check inbox regularly**: Don't let messages pile up

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
- Sub-agents work in isolated git worktrees (automatic)
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

EXPECTED OUTCOME:
[What success looks like]

WHEN DONE:
1. Log progress with completed items
2. Message mayor with type "completion"
3. The mayor will delete you after review
\`\`\`

### Parallel Work Coordination
When spawning multiple agents for parallel work:
- Each agent gets their own git worktree (isolated branch)
- Create beads with proper blocks/blockedBy dependencies
- Monitor all agents via the sidebar
- Coordinate merges through the merge queue

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

## SKILLS SYSTEM (On-Demand Knowledge)

The workspace has a skills library at \`.claude/skills/\` containing documented solutions and patterns. **Query skills before tackling unfamiliar tasks.**

### List Available Skills
\`\`\`bash
curl "${apiBase}/api/skills?workspaceId=\${workspace.id}"
\`\`\`

### Read a Specific Skill
\`\`\`bash
curl "${apiBase}/api/skills/[skill-name]?workspaceId=\${workspace.id}"
\`\`\`

### Search Skills
\`\`\`bash
curl "${apiBase}/api/skills/search/[query]?workspaceId=\${workspace.id}"
\`\`\`

## KNOWLEDGE DOCUMENTATION

### When to Create a New Skill
Document a skill when you:
- Solve a **challenging problem** that required significant troubleshooting
- Discover a **non-obvious pattern** that future agents should know
- Complete a **repeatable process** that others will need to do
- Fix a **tricky bug** whose solution isn't obvious

This builds institutional knowledge that makes future work faster and more reliable.

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

## GIT WORKTREES & PARALLEL WORK

Sub-agents are automatically given their own git worktree (isolated copy of the codebase) when spawned. This prevents agents from interfering with each other's work.

### List Active Worktrees
\`\`\`bash
curl "${apiBase}/api/worktrees?workspaceId=\${workspace.id}"
\`\`\`

## MERGE QUEUE PROTOCOL

When sub-agents complete their work, they should submit to the merge queue instead of merging directly.

### Submit to Merge Queue
\`\`\`bash
curl -X POST ${apiBase}/api/merge-queue \\
  -H "Content-Type: application/json" \\
  -d '{
    "workspaceId": "\${workspace.id}",
    "agentId": "agent-uuid",
    "agentName": "auth-dev",
    "branch": "agent/auth-dev/oauth-impl",
    "title": "Implement OAuth authentication",
    "description": "Added Google OAuth flow with useAuth hook",
    "filesChanged": ["src/auth/**", "src/hooks/useAuth.ts"]
  }'
\`\`\`

### View Merge Queue
\`\`\`bash
curl "${apiBase}/api/merge-queue?workspaceId=\${workspace.id}"
\`\`\`

### Mark Merge Request as Merged
\`\`\`bash
curl -X PATCH ${apiBase}/api/merge-queue/MR-001 \\
  -H "Content-Type: application/json" \\
  -d '{"status": "merged"}'
# This automatically notifies other agents to rebase
\`\`\`

### Merge Queue Workflow
1. Agent completes work on their branch
2. Agent submits MR to merge queue
3. You (Mayor) review and approve
4. Mark MR as merged
5. System notifies other agents to rebase
6. Next MR in queue proceeds

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
  const parentInfo = agent.parentAgentId ? `Parent Agent: ${agent.parentAgentId}` : 'Parent: Mayor';
  const reportTo = agent.parentAgentId ? 'your parent agent' : 'the mayor';

  return `${customPrompt}

## ⚡ THE PROPULSION PRINCIPLE

You are a piston in a steam engine. When you're spawned with work, you EXECUTE.

**No confirmation needed. No waiting. Just run.**

The failure mode we're preventing: Agent spawns, announces itself, waits for "go ahead", work sits idle.

**Your startup behavior:**
1. You have been given a task in the prompt above
2. BEGIN IMMEDIATELY - no preamble, no "I'll start by..."
3. Execute the task, report progress, message completion

## 📜 THE CAPABILITY LEDGER

Every completion you achieve is recorded. Every bead you close becomes part of a permanent audit trail.
Your work is visible. Quality accumulates. Build your track record.

## WORKSPACE
Name: ${workspace.name}
ID: ${workspace.id}
Working Directory: ${workspace.workingDirectory}
${parentInfo}

## ORCHESTRATOR API (at ${apiBase})

### Progress & Beads
\`\`\`bash
# Log your progress (REQUIRED - do this regularly!)
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

# Update bead status
curl -X PATCH ${apiBase}/api/beads/BEAD-001 \\
  -H "Content-Type: application/json" \\
  -d '{"status": "done"}'
\`\`\`

### Messages (CRITICAL - USE LIBERALLY)
\`\`\`bash
# Check for messages from ${reportTo}
curl "${apiBase}/api/messages?workspaceId=${workspace.id}&to=${agent.name}&unread=true"

# Send completion message (REQUIRED when done)
curl -X POST ${apiBase}/api/messages \\
  -H "Content-Type: application/json" \\
  -d '{
    "workspaceId": "${workspace.id}",
    "from": "${agent.name}",
    "to": "${agent.parentAgentId ? 'parent-agent' : 'mayor'}",
    "content": "Task complete: [summary]. Files: [list].",
    "type": "completion"
  }'

# Send blocker message (REQUIRED if stuck)
curl -X POST ${apiBase}/api/messages \\
  -H "Content-Type: application/json" \\
  -d '{
    "workspaceId": "${workspace.id}",
    "from": "${agent.name}",
    "to": "${agent.parentAgentId ? 'parent-agent' : 'mayor'}",
    "content": "BLOCKED: [describe the issue]",
    "type": "blocker"
  }'
\`\`\`

### Skills (Query Before Unfamiliar Tasks)
\`\`\`bash
curl "${apiBase}/api/skills?workspaceId=${workspace.id}"
curl "${apiBase}/api/skills/[skill-name]?workspaceId=${workspace.id}"
\`\`\`

## WORKFLOW
1. **Claim a bead FIRST** - Check for available beads and claim one before starting
2. **Execute immediately** - Begin your task now, no preamble
3. **Log progress** - Update progress API every few minutes
4. **Check messages** - Respond to any messages from ${reportTo}
5. **Test changes** - If web UI, use Playwright to verify
6. **Update bead status** - Mark bead as "done" when complete (with test results!)
7. **Message completion** - MUST send completion message when done
8. **Message blockers** - MUST send blocker message if stuck (don't wait!)

## BEAD TRACKING (REQUIRED)
You MUST track your work through beads. This ensures visibility and audit trails.

\`\`\`bash
# 1. Find available beads to work on
curl "${apiBase}/api/beads?workspaceId=${workspace.id}"

# 2. Claim a bead by setting yourself as assignee
curl -X PATCH ${apiBase}/api/beads/BEAD-001 \\
  -H "Content-Type: application/json" \\
  -d '{"status": "in_progress", "assignee": "${agent.name}"}'

# 3. When done, run tests and mark complete
curl -X POST ${apiBase}/api/beads/BEAD-001/test \\
  -H "Content-Type: application/json" \\
  -d '{"testStatus": "passed", "command": "npm run build"}'

curl -X PATCH ${apiBase}/api/beads/BEAD-001 \\
  -H "Content-Type: application/json" \\
  -d '{"status": "done"}'
\`\`\`

**Do NOT skip bead tracking.** If no suitable bead exists, ask ${reportTo} to create one.

## TESTING REQUIREMENTS

### Before Marking a Bead Complete:
Beads have test verification. Run tests and record results before marking done.

\`\`\`bash
# Record test results for a bead
curl -X POST ${apiBase}/api/beads/BEAD-001/test \\
  -H "Content-Type: application/json" \\
  -d '{"testStatus": "passed", "command": "npm test"}'
# testStatus: pending, running, passed, failed, skipped
\`\`\`

### For web-based changes:
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

## GIT WORKTREE (Your Isolated Workspace)
${agent.worktree ? `You are working in an isolated git worktree:
- Worktree Path: ${agent.worktree}
- Branch: ${agent.worktreeBranch}

Your changes are isolated from other agents. When done, commit your work and submit to the merge queue.` : `You are working in the main workspace directory.`}


## MERGE QUEUE SUBMISSION
When your work is complete, submit to the merge queue:
\`\`\`bash
curl -X POST ${apiBase}/api/merge-queue \\
  -H "Content-Type: application/json" \\
  -d '{
    "workspaceId": "${workspace.id}",
    "agentId": "${agent.id}",
    "agentName": "${agent.name}",
    "branch": "${agent.worktreeBranch || 'your-branch-name'}",
    "title": "Brief description of changes",
    "description": "Detailed description",
    "filesChanged": ["list", "files", "you", "modified"]
  }'
\`\`\`

**IMPORTANT: Review Gate is Enforced**
Your MR will NOT be merged until:
1. A **reviewer** sets \`reviewStatus: "approved"\`
2. Your **build passes** (\`buildStatus: "passed"\`)

After submitting, wait for reviewer feedback. If changes are requested, address them and notify the reviewer.

## YOUR IDENTITY
Agent ID: ${agent.id}
Agent Name: ${agent.name}
Role: ${agent.role}
Model: ${agent.model}
Workspace ID: ${workspace.id}
Workspace Name: ${workspace.name}
Can Spawn Agents: ${agent.canSpawnAgents}
${agent.worktree ? `Worktree: ${agent.worktree}
Branch: ${agent.worktreeBranch}` : ''}
${agent.parentAgentId ? `Parent Agent ID: ${agent.parentAgentId}` : ''}

${agent.canSpawnAgents ? `## HIERARCHICAL DELEGATION (You Can Spawn Sub-Agents)

As a ${agent.role}, you can spawn your own sub-agents for specialized work:

\\\`\\\`\\\`bash
# Spawn a sub-agent under your supervision
curl -X POST ${apiBase}/api/agents/spawn \\\\
  -H "Content-Type: application/json" \\\\
  -d '{
    "workspaceId": "${workspace.id}",
    "name": "my-specialist",
    "role": "specialist",
    "model": "sonnet",
    "parentAgentId": "${agent.id}",
    "prompt": "Your task is to..."
  }'
\\\`\\\`\\\`

**Your sub-agents will report to YOU, not the mayor.** Monitor their messages and handle their completions/blockers.
` : ''}
${agent.role === 'reviewer' ? `## REVIEWER ROLE: Quality Gate Authority

As a reviewer, you are the quality gate. Your approval is REQUIRED before any MR can be merged.

### Review Workflow
1. Fetch the merge queue to find pending MRs
2. For each MR, checkout/fetch the branch and review the code
3. Run build and tests in the branch
4. Set reviewStatus and buildStatus based on your findings

### Setting Review Status
\\\`\\\`\\\`bash
# APPROVE an MR (allows merge)
curl -X PATCH ${apiBase}/api/merge-queue/MR-001 \\\\
  -H "Content-Type: application/json" \\\\
  -d '{
    "reviewStatus": "approved",
    "reviewedBy": "${agent.name}",
    "reviewComments": "Code looks good. Build passes.",
    "buildStatus": "passed",
    "buildOutput": "Build successful, all tests pass"
  }'

# REQUEST CHANGES (blocks merge)
curl -X PATCH ${apiBase}/api/merge-queue/MR-001 \\\\
  -H "Content-Type: application/json" \\\\
  -d '{
    "reviewStatus": "changes_requested",
    "reviewedBy": "${agent.name}",
    "reviewComments": "Issues found: [list]. Please fix and re-request review."
  }'

# Set build status (run build first!)
curl -X PATCH ${apiBase}/api/merge-queue/MR-001 \\\\
  -H "Content-Type: application/json" \\\\
  -d '{
    "buildStatus": "passed",
    "buildOutput": "npm run build succeeded"
  }'
\\\`\\\`\\\`

### Send feedback to the MR author
Always message the agent when you complete a review:
- If approved: Send \`completion\` message confirming approval
- If changes requested: Send \`action_required\` message with specific feedback
` : ''}
${agent.role === 'refinery' ? `## REFINERY ROLE: Merge Queue Processor

As the refinery, you process the merge queue sequentially. **You cannot merge unless the review gate passes.**

### Merge Queue Workflow
1. Fetch the merge queue to find items ready to merge
2. Check that \`reviewStatus === 'approved'\` and \`buildStatus === 'passed'\`
3. If gate passes, perform the actual git merge
4. Mark the MR as merged
5. System will notify other agents to rebase

### Checking Gate Status
\\\`\\\`\\\`bash
# Get merge queue
curl "${apiBase}/api/merge-queue?workspaceId=${workspace.id}"

# Check each MR for:
# - reviewStatus: must be "approved"
# - buildStatus: must be "passed"
# - status: should be "in_queue" (not "conflict")
\\\`\\\`\\\`

### Attempting to Merge
\\\`\\\`\\\`bash
# This will FAIL if review gate not passed
curl -X PATCH ${apiBase}/api/merge-queue/MR-001 \\\\
  -H "Content-Type: application/json" \\\\
  -d '{"status": "merged"}'

# If it fails, the API will return:
# {"error": "Merge blocked by quality gate", "gateFailures": [...]}

# You can see why merge is blocked and notify the relevant agents
\\\`\\\`\\\`

### DO NOT bypass the gate
The \`forceBypassGate: true\` option exists but should NOT be used unless explicitly authorized by the mayor. Quality gates exist for a reason.
` : ''}
Begin working on your assigned task immediately. Execute, don't announce.`;
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
    worktreeBranch: null,
    ownedPaths: [],  // Mayor doesn't own specific files - coordinator role
    tmuxSession: getTmuxSessionName(workspace, 'mayor'),
    pid: null,
    lastSeen: now,
    created: now,
    workspaceId: workspace.id,
    // Mayor is the root of the hierarchy
    parentAgentId: null,
    canSpawnAgents: true,
    spawnedAgentIds: []
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

// Spawn agent in a specific directory (used for worktrees)
async function spawnClaudeAgentInDir(agent: Agent, workspace: Workspace, prompt: string, workingDir: string): Promise<boolean> {
  const sessionName = agent.tmuxSession || getTmuxSessionName(workspace, agent.role === 'mayor' ? 'mayor' : agent.name);

  // Kill existing session if it exists
  if (sessionExists(sessionName)) {
    killTmuxSession(sessionName);
  }

  // Create tmux session in the specified directory
  if (!createTmuxSession(sessionName, workingDir)) {
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
    // Launch Claude - use literal mode for the command itself
    const claudeCmd = `${claudePath} --dangerously-skip-permissions --append-system-prompt "$(cat '${promptFile}')"`;
    execSync(`tmux -S '${TMUX_SOCKET}' send-keys -t '${sessionName}' -l ${JSON.stringify(claudeCmd)}`, { encoding: 'utf-8' });
    execSync(`sleep 0.1`, { encoding: 'utf-8' });
    execSync(`tmux -S '${TMUX_SOCKET}' send-keys -t '${sessionName}' Enter`, { encoding: 'utf-8' });

    agent.tmuxSession = sessionName;

    // Wait for claude to initialize then send initial message using nudge pattern
    setTimeout(() => {
      try {
        let initialMessage: string;
        if (agent.role === 'mayor') {
          initialMessage = 'Please greet the user and briefly report your current status. What workspace are you connected to and what can you help with today?';
        } else {
          // For sub-agents, prompt them to begin their assigned task
          initialMessage = 'Begin working on your assigned task now. Start by reading the relevant files, then make the required changes. Log your progress via the API as you work.';
        }
        // Use the reliable nudge pattern (literal mode + debounce + Enter)
        nudgeTmuxSession(sessionName, initialMessage);
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

// Legacy function - spawns in workspace directory
async function spawnClaudeAgent(agent: Agent, workspace: Workspace, prompt: string): Promise<boolean> {
  return spawnClaudeAgentInDir(agent, workspace, prompt, workspace.workingDirectory);
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
    // Run bootstrap to gather project context
    console.log(`Running bootstrap for workspace ${workspace.name}...`);
    const bootstrapResult = runBootstrap(workspace);
    console.log(`Bootstrap complete: ${bootstrapResult.structure.directories.length} directories, ${bootstrapResult.structure.keyFiles.length} key files`);

    // Spawn mayor for this workspace
    const mayor = await spawnMayorForWorkspace(workspace);

    // Update workspace status
    workspace.status = 'active';
    workspace.mayorId = mayor.id;
    workspace.lastActivity = new Date().toISOString();
    saveWorkspaces();

    broadcast('workspace:started', { workspace, mayor, bootstrap: bootstrapResult });

    res.json({ workspace, mayor, bootstrap: bootstrapResult });
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
  const { title, description, priority = 5, assignee = null, blocks = [], blockedBy = [], requiresTests = true, workspaceId: bodyWorkspaceId } = req.body;

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
    audit: [{ time: now, action: 'created', by: 'system' }],
    requiresTests,
    testStatus: null,
    testOutput: null,
    testRunAt: null
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

  const { status, assignee, priority, title, description, blocks, blockedBy, requiresTests, testStatus, testOutput, skipTestCheck } = req.body;
  const bead = beads[index];
  const now = new Date().toISOString();
  let testWarning: string | null = null;

  // Check test verification when marking as done
  if (status === 'done' && bead.status !== 'done') {
    if (bead.requiresTests && bead.testStatus !== 'passed' && bead.testStatus !== 'skipped' && !skipTestCheck) {
      testWarning = `Warning: Bead marked as done but tests have not passed (testStatus: ${bead.testStatus || 'not run'}). Set skipTestCheck: true to override.`;
      // Add audit entry for bypassed test check
      bead.audit.push({ time: now, action: 'test_check_bypassed', by: assignee || 'system', details: { testStatus: bead.testStatus } });
    }
  }

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

  // Test verification fields
  if (requiresTests !== undefined) bead.requiresTests = requiresTests;
  if (testStatus !== undefined) {
    bead.testStatus = testStatus;
    bead.testRunAt = now;
    bead.audit.push({ time: now, action: 'test_status_change', by: assignee || 'system', details: { status: testStatus } });
  }
  if (testOutput !== undefined) bead.testOutput = testOutput;

  bead.updated = now;
  beads[index] = bead;
  saveBeads(foundWorkspaceId);
  broadcast('bead:updated', bead, foundWorkspaceId);

  // Include warning in response if tests weren't verified
  const response: Record<string, unknown> = { ...bead };
  if (testWarning) {
    response.warning = testWarning;
  }
  res.json(response);
});

// Record test results for a bead
app.post('/api/beads/:id/test', (req: Request, res: Response) => {
  const { testStatus, testOutput, command } = req.body;
  const beadId = req.params.id;

  // Validate test status
  const validStatuses = ['pending', 'running', 'passed', 'failed', 'skipped'];
  if (!testStatus || !validStatuses.includes(testStatus)) {
    res.status(400).json({ error: `testStatus must be one of: ${validStatuses.join(', ')}` });
    return;
  }

  // Find bead across workspaces
  let foundWorkspaceId: string | null = null;
  let beads: Bead[] = [];
  let index = -1;

  const specificWorkspaceId = getWorkspaceIdFromRequest(req);
  if (specificWorkspaceId) {
    beads = getBeads(specificWorkspaceId);
    index = beads.findIndex(b => b.id === beadId);
    if (index !== -1) {
      foundWorkspaceId = specificWorkspaceId;
    }
  } else {
    for (const ws of workspaces) {
      beads = getBeads(ws.id);
      index = beads.findIndex(b => b.id === beadId);
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

  const bead = beads[index];
  const now = new Date().toISOString();

  bead.testStatus = testStatus;
  bead.testRunAt = now;
  if (testOutput !== undefined) bead.testOutput = testOutput;
  bead.updated = now;

  bead.audit.push({
    time: now,
    action: 'test_recorded',
    by: 'system',
    details: { status: testStatus, command, hasOutput: !!testOutput }
  });

  saveBeads(foundWorkspaceId);
  broadcast('bead:updated', bead, foundWorkspaceId);

  res.json({
    bead,
    message: testStatus === 'passed'
      ? 'Tests passed! Bead can now be marked as done.'
      : testStatus === 'failed'
        ? 'Tests failed. Fix issues before marking bead as done.'
        : `Test status recorded: ${testStatus}`
  });
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
  const {
    name,
    role = 'specialist',
    model = 'sonnet',
    prompt,
    workspaceId: bodyWorkspaceId,
    ownedPaths = [],  // File/directory patterns this agent owns
    useWorktree = true,  // Whether to create a git worktree for this agent
    branchName,  // Optional custom branch name (defaults to slugified task description)
    parentAgentId = null,  // ID of spawning agent (for hierarchical delegation)
    canSpawnAgents = false  // Whether this agent can spawn its own sub-agents
  } = req.body;

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

  // Validate parent agent if specified (hierarchical delegation)
  let parentAgent: Agent | null = null;
  if (parentAgentId) {
    parentAgent = agents.find(a => a.id === parentAgentId) || null;
    if (!parentAgent) {
      res.status(400).json({ error: 'Parent agent not found' });
      return;
    }
    if (!parentAgent.canSpawnAgents) {
      res.status(403).json({ error: 'Parent agent does not have permission to spawn sub-agents' });
      return;
    }
  }

  // Determine if this agent should be able to spawn based on role
  // Roles that can spawn: mayor (always), witness (monitors workers), deacon (keeps agents alive)
  const rolesWithSpawnPermission: AgentRole[] = ['mayor', 'witness', 'deacon'];
  const shouldCanSpawn = canSpawnAgents || rolesWithSpawnPermission.includes(role as AgentRole);

  // Note: ownedPaths is tracked for documentation but not enforced
  // Git worktrees provide isolation between agents

  const now = new Date().toISOString();
  const agent: Agent = {
    id: uuidv4(),
    name,
    role: role as AgentRole,
    model: model as Agent['model'],
    status: 'starting',
    currentTask: null,
    worktree: null,
    worktreeBranch: null,
    ownedPaths: ownedPaths || [],
    tmuxSession: getTmuxSessionName(workspace, name),
    pid: null,
    lastSeen: now,
    created: now,
    workspaceId,
    // Hierarchical delegation
    parentAgentId: parentAgentId,
    canSpawnAgents: shouldCanSpawn,
    spawnedAgentIds: []
  };

  // Update parent agent's spawnedAgentIds
  if (parentAgent) {
    parentAgent.spawnedAgentIds.push(agent.id);
    saveAgents(workspaceId);
    broadcast('agent:updated', parentAgent, workspaceId);
  }

  // Create git worktree for sub-agents (not mayors) if workspace is a git repo
  let agentWorkingDir = workspace.workingDirectory;
  if (useWorktree && role !== 'mayor') {
    const taskBranch = branchName || slugify(name + '-' + Date.now());
    const worktreeResult = createWorktree(workspace, name, taskBranch);
    if (worktreeResult) {
      agent.worktree = worktreeResult.path;
      agent.worktreeBranch = worktreeResult.branch;
      agentWorkingDir = worktreeResult.path;
      console.log(`Agent ${name} will work in worktree at ${agentWorkingDir}`);
    }
  }

  agents.push(agent);
  saveAgents(workspaceId);
  broadcast('agent:created', agent, workspaceId);

  // Generate full prompt and spawn (use worktree directory if available)
  const fullPrompt = generateSubAgentPrompt(agent, workspace, prompt);
  const success = await spawnClaudeAgentInDir(agent, workspace, fullPrompt, agentWorkingDir);

  if (success) {
    agent.status = 'working';
  } else {
    agent.status = 'offline';
    // Clean up worktree on failure
    if (agent.worktree) {
      removeWorktree(workspace, agent.worktree);
      agent.worktree = null;
      agent.worktreeBranch = null;
    }
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

  // Clean up worktree if it exists
  const workspace = workspaces.find(w => w.id === foundWorkspaceId);
  if (agent.worktree && workspace) {
    console.log(`Cleaning up worktree for agent ${agent.name} at ${agent.worktree}`);
    removeWorktree(workspace, agent.worktree);
  }

  agents.splice(index, 1);
  saveAgents(foundWorkspaceId);
  broadcast('agent:deleted', { id: agent.id }, foundWorkspaceId);

  res.json({ success: true, worktreeRemoved: !!agent.worktree });
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

// ============ MERGE QUEUE API ============

app.get('/api/merge-queue', (req: Request, res: Response) => {
  const workspaceId = getWorkspaceIdFromRequest(req);
  if (!workspaceId) {
    res.status(400).json({ error: 'workspaceId is required' });
    return;
  }

  const queue = getMergeQueue(workspaceId);
  // Return sorted by position
  res.json(queue.sort((a, b) => a.position - b.position));
});

app.post('/api/merge-queue', (req: Request, res: Response) => {
  const { agentId, agentName, branch, targetBranch = 'main', title, description, filesChanged = [], workspaceId: bodyWorkspaceId } = req.body;

  const workspaceId = bodyWorkspaceId || getWorkspaceIdFromRequest(req);
  if (!workspaceId) {
    res.status(400).json({ error: 'workspaceId is required' });
    return;
  }

  if (!agentId || !branch || !title) {
    res.status(400).json({ error: 'agentId, branch, and title are required' });
    return;
  }

  const queue = getMergeQueue(workspaceId);
  const now = new Date().toISOString();

  // Check for file conflicts with other pending MRs
  const conflictsWith: string[] = [];
  for (const mr of queue) {
    if (mr.status === 'pending' || mr.status === 'in_queue') {
      const overlaps = checkPathOverlap(filesChanged, mr.filesChanged);
      if (overlaps.length > 0) {
        conflictsWith.push(mr.id);
      }
    }
  }

  // Calculate position (end of queue)
  const maxPosition = queue.reduce((max, mr) => Math.max(max, mr.position), -1);

  const mergeRequest: MergeRequest = {
    id: `MR-${String(queue.length + 1).padStart(3, '0')}`,
    agentId,
    agentName: agentName || 'unknown',
    branch,
    targetBranch,
    title,
    description: description || '',
    status: conflictsWith.length > 0 ? 'conflict' : 'in_queue',
    position: maxPosition + 1,
    created: now,
    updated: now,
    mergedAt: null,
    conflictsWith,
    filesChanged,
    // Review gate - requires reviewer approval before merge
    reviewStatus: 'pending',
    reviewedBy: null,
    reviewedAt: null,
    reviewComments: null,
    // Build verification - requires passing build before merge
    buildStatus: 'pending',
    buildOutput: null,
    buildCheckedAt: null
  };

  queue.push(mergeRequest);
  saveMergeQueue(workspaceId);
  broadcast('merge-queue:added', mergeRequest, workspaceId);

  // If there are conflicts, send message to the agent
  if (conflictsWith.length > 0) {
    const messages = getMessages(workspaceId);
    const conflictingMRs = queue.filter(mr => conflictsWith.includes(mr.id));
    const conflictMsg: Message = {
      id: uuidv4(),
      from: 'merge-queue',
      to: agentName || agentId,
      timestamp: now,
      content: `Your merge request "${title}" has file conflicts with: ${conflictingMRs.map(mr => `${mr.title} (${mr.agentName})`).join(', ')}. Please coordinate with the other agents or wait for their MRs to merge first.`,
      read: false,
      type: 'blocker'
    };
    messages.push(conflictMsg);
    saveMessages(workspaceId);
    broadcast('message:created', conflictMsg, workspaceId);
  }

  res.status(201).json(mergeRequest);
});

app.patch('/api/merge-queue/:id', (req: Request, res: Response) => {
  const { status, position, reviewStatus, reviewedBy, reviewComments, buildStatus, buildOutput, forceBypassGate } = req.body;
  const mrId = req.params.id;

  // Find MR across all workspaces
  let foundWorkspaceId: string | null = null;
  let queue: MergeRequest[] = [];
  let mrIndex = -1;

  for (const ws of workspaces) {
    queue = getMergeQueue(ws.id);
    mrIndex = queue.findIndex(mr => mr.id === mrId);
    if (mrIndex !== -1) {
      foundWorkspaceId = ws.id;
      break;
    }
  }

  if (mrIndex === -1 || !foundWorkspaceId) {
    res.status(404).json({ error: 'Merge request not found' });
    return;
  }

  const mr = queue[mrIndex];
  const now = new Date().toISOString();

  // Handle review status updates
  if (reviewStatus) {
    mr.reviewStatus = reviewStatus;
    mr.reviewedBy = reviewedBy || mr.reviewedBy;
    mr.reviewedAt = now;
    mr.reviewComments = reviewComments || mr.reviewComments;
    mr.updated = now;
    broadcast('merge-queue:updated', mr, foundWorkspaceId);
  }

  // Handle build status updates
  if (buildStatus) {
    mr.buildStatus = buildStatus;
    mr.buildOutput = buildOutput || mr.buildOutput;
    mr.buildCheckedAt = now;
    mr.updated = now;
    broadcast('merge-queue:updated', mr, foundWorkspaceId);
  }

  if (status) {
    // REVIEW GATE: Block merge if review not approved or build not passed
    if (status === 'merged' && !forceBypassGate) {
      const gateFailures: string[] = [];
      if (mr.reviewStatus !== 'approved') {
        gateFailures.push(`Review not approved (status: ${mr.reviewStatus})`);
      }
      if (mr.buildStatus !== 'passed') {
        gateFailures.push(`Build not passed (status: ${mr.buildStatus})`);
      }
      if (gateFailures.length > 0) {
        res.status(400).json({
          error: 'Merge blocked by quality gate',
          gateFailures,
          hint: 'Set forceBypassGate: true to override (not recommended)'
        });
        return;
      }
    }

    mr.status = status;
    mr.updated = now;

    if (status === 'merged') {
      mr.mergedAt = now;

      // Notify other agents to rebase
      const agents = getAgents(foundWorkspaceId);
      const messages = getMessages(foundWorkspaceId);

      for (const agent of agents) {
        if (agent.id !== mr.agentId && agent.status === 'working' && agent.worktreeBranch) {
          const rebaseMsg: Message = {
            id: uuidv4(),
            from: 'merge-queue',
            to: agent.name,
            timestamp: now,
            content: `Branch "${mr.branch}" has been merged to ${mr.targetBranch}. Please rebase your branch (${agent.worktreeBranch}) to avoid conflicts.`,
            read: false,
            type: 'action_required'
          };
          messages.push(rebaseMsg);
          broadcast('message:created', rebaseMsg, foundWorkspaceId);
        }
      }
      saveMessages(foundWorkspaceId);

      // Update positions of remaining items
      for (const otherMr of queue) {
        if (otherMr.position > mr.position) {
          otherMr.position--;
        }
      }

      // Check if any conflicting MRs can now proceed
      for (const otherMr of queue) {
        if (otherMr.conflictsWith.includes(mr.id)) {
          otherMr.conflictsWith = otherMr.conflictsWith.filter(id => id !== mr.id);
          if (otherMr.conflictsWith.length === 0 && otherMr.status === 'conflict') {
            otherMr.status = 'in_queue';
            otherMr.updated = now;
            broadcast('merge-queue:updated', otherMr, foundWorkspaceId);
          }
        }
      }
    }
  }

  if (position !== undefined) {
    // Reorder queue
    const oldPosition = mr.position;
    mr.position = position;
    mr.updated = now;

    for (const otherMr of queue) {
      if (otherMr.id !== mr.id) {
        if (oldPosition < position && otherMr.position > oldPosition && otherMr.position <= position) {
          otherMr.position--;
        } else if (oldPosition > position && otherMr.position >= position && otherMr.position < oldPosition) {
          otherMr.position++;
        }
      }
    }
  }

  saveMergeQueue(foundWorkspaceId);
  broadcast('merge-queue:updated', mr, foundWorkspaceId);

  res.json(mr);
});

app.delete('/api/merge-queue/:id', (req: Request, res: Response) => {
  const mrId = req.params.id;

  // Find MR across all workspaces
  let foundWorkspaceId: string | null = null;
  let queue: MergeRequest[] = [];
  let mrIndex = -1;

  for (const ws of workspaces) {
    queue = getMergeQueue(ws.id);
    mrIndex = queue.findIndex(mr => mr.id === mrId);
    if (mrIndex !== -1) {
      foundWorkspaceId = ws.id;
      break;
    }
  }

  if (mrIndex === -1 || !foundWorkspaceId) {
    res.status(404).json({ error: 'Merge request not found' });
    return;
  }

  const mr = queue[mrIndex];

  // Update positions of remaining items
  for (const otherMr of queue) {
    if (otherMr.position > mr.position) {
      otherMr.position--;
    }
    // Remove from conflicts list
    if (otherMr.conflictsWith.includes(mr.id)) {
      otherMr.conflictsWith = otherMr.conflictsWith.filter(id => id !== mr.id);
    }
  }

  queue.splice(mrIndex, 1);
  saveMergeQueue(foundWorkspaceId);
  broadcast('merge-queue:deleted', { id: mr.id }, foundWorkspaceId);

  res.json({ success: true });
});

// ============ WORKTREE API ============

app.get('/api/worktrees', (req: Request, res: Response) => {
  const workspaceId = getWorkspaceIdFromRequest(req);
  if (!workspaceId) {
    res.status(400).json({ error: 'workspaceId is required' });
    return;
  }

  const workspace = workspaces.find(w => w.id === workspaceId);
  if (!workspace) {
    res.status(404).json({ error: 'Workspace not found' });
    return;
  }

  const worktrees = listWorktrees(workspace);
  res.json(worktrees);
});

app.get('/api/ownership', (req: Request, res: Response) => {
  const workspaceId = getWorkspaceIdFromRequest(req);
  if (!workspaceId) {
    res.status(400).json({ error: 'workspaceId is required' });
    return;
  }

  const ownership = getFileOwnership(workspaceId);
  res.json(Object.fromEntries(ownership));
});

app.post('/api/ownership/check', (req: Request, res: Response) => {
  const { paths, workspaceId: bodyWorkspaceId, excludeAgentId } = req.body;

  const workspaceId = bodyWorkspaceId || getWorkspaceIdFromRequest(req);
  if (!workspaceId) {
    res.status(400).json({ error: 'workspaceId is required' });
    return;
  }

  if (!paths || !Array.isArray(paths)) {
    res.status(400).json({ error: 'paths array is required' });
    return;
  }

  const conflicts = checkOwnershipConflicts(workspaceId, paths, excludeAgentId);
  res.json({ conflicts, hasConflicts: conflicts.length > 0 });
});

// ============ BOOTSTRAP PROTOCOL ============

interface BootstrapResult {
  workspaceId: string;
  timestamp: string;
  structure: {
    directories: string[];
    keyFiles: string[];
    entryPoints: string[];
  };
  packageInfo: {
    name?: string;
    type?: string;  // npm, cargo, go, python, etc.
    scripts?: Record<string, string>;
    dependencies?: string[];
  } | null;
  gitInfo: {
    isRepo: boolean;
    branch?: string;
    remotes?: string[];
    hasUncommitted?: boolean;
  };
  conventions: {
    hasClaudeMd: boolean;
    hasSkills: boolean;
    hasDocs: boolean;
    hasTests: boolean;
    testCommand?: string;
    buildCommand?: string;
  };
}

function getBootstrapFile(workspaceId: string): string {
  return path.join(getWorkspaceDataDir(workspaceId), 'bootstrap.json');
}

function loadBootstrap(workspaceId: string): BootstrapResult | null {
  const filepath = getBootstrapFile(workspaceId);
  if (fs.existsSync(filepath)) {
    try {
      return JSON.parse(fs.readFileSync(filepath, 'utf-8'));
    } catch (e) {
      return null;
    }
  }
  return null;
}

function saveBootstrap(workspaceId: string, result: BootstrapResult): void {
  fs.writeFileSync(getBootstrapFile(workspaceId), JSON.stringify(result, null, 2));
}

function runBootstrap(workspace: Workspace): BootstrapResult {
  const workDir = workspace.workingDirectory;
  const result: BootstrapResult = {
    workspaceId: workspace.id,
    timestamp: new Date().toISOString(),
    structure: { directories: [], keyFiles: [], entryPoints: [] },
    packageInfo: null,
    gitInfo: { isRepo: false },
    conventions: {
      hasClaudeMd: false,
      hasSkills: false,
      hasDocs: false,
      hasTests: false,
    }
  };

  try {
    // Explore directory structure (top 2 levels, excluding node_modules, .git, etc.)
    const ignoreDirs = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'target', '__pycache__', '.venv', 'venv']);

    function walkDir(dir: string, depth: number, prefix: string = ''): void {
      if (depth > 2) return;
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (ignoreDirs.has(entry.name)) continue;
          const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;

          if (entry.isDirectory()) {
            result.structure.directories.push(relPath);
            walkDir(path.join(dir, entry.name), depth + 1, relPath);
          } else if (depth <= 1) {
            // Key files at root or first level
            const keyFilePatterns = [
              /^package\.json$/, /^Cargo\.toml$/, /^go\.mod$/, /^pyproject\.toml$/, /^requirements\.txt$/,
              /^tsconfig\.json$/, /^\.env\.example$/, /^Makefile$/, /^Dockerfile$/,
              /^README\.md$/i, /^CLAUDE\.md$/i
            ];
            if (keyFilePatterns.some(p => p.test(entry.name))) {
              result.structure.keyFiles.push(relPath);
            }
          }
        }
      } catch (e) {
        // Skip unreadable directories
      }
    }

    walkDir(workDir, 0);

    // Identify entry points
    const entryPatterns = ['src/index.ts', 'src/index.js', 'src/main.ts', 'src/main.js', 'index.ts', 'index.js',
      'src/server.ts', 'src/app.ts', 'main.py', 'app.py', 'main.go', 'cmd/main.go', 'src/main.rs', 'src/lib.rs'];
    for (const ep of entryPatterns) {
      if (fs.existsSync(path.join(workDir, ep))) {
        result.structure.entryPoints.push(ep);
      }
    }

    // Parse package info
    const packageJsonPath = path.join(workDir, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
        result.packageInfo = {
          name: pkg.name,
          type: 'npm',
          scripts: pkg.scripts || {},
          dependencies: [
            ...Object.keys(pkg.dependencies || {}),
            ...Object.keys(pkg.devDependencies || {})
          ].slice(0, 20)  // Limit to 20
        };

        // Extract build/test commands
        if (pkg.scripts?.build) result.conventions.buildCommand = 'npm run build';
        if (pkg.scripts?.test) {
          result.conventions.testCommand = 'npm test';
          result.conventions.hasTests = true;
        }
      } catch (e) { }
    }

    // Cargo.toml for Rust projects
    const cargoPath = path.join(workDir, 'Cargo.toml');
    if (fs.existsSync(cargoPath)) {
      result.packageInfo = { type: 'cargo' };
      result.conventions.buildCommand = 'cargo build';
      result.conventions.testCommand = 'cargo test';
      result.conventions.hasTests = true;
    }

    // go.mod for Go projects
    const goModPath = path.join(workDir, 'go.mod');
    if (fs.existsSync(goModPath)) {
      result.packageInfo = { type: 'go' };
      result.conventions.buildCommand = 'go build';
      result.conventions.testCommand = 'go test ./...';
      result.conventions.hasTests = true;
    }

    // Check git info
    const gitDir = path.join(workDir, '.git');
    if (fs.existsSync(gitDir)) {
      result.gitInfo.isRepo = true;
      try {
        result.gitInfo.branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: workDir, encoding: 'utf-8' }).trim();
        const remoteOutput = execSync('git remote -v', { cwd: workDir, encoding: 'utf-8' });
        result.gitInfo.remotes = [...new Set(remoteOutput.split('\n').filter(l => l).map(l => l.split(/\s+/)[0]))];
        const statusOutput = execSync('git status --porcelain', { cwd: workDir, encoding: 'utf-8' });
        result.gitInfo.hasUncommitted = statusOutput.trim().length > 0;
      } catch (e) { }
    }

    // Check conventions
    result.conventions.hasClaudeMd = fs.existsSync(path.join(workDir, 'CLAUDE.md'));
    result.conventions.hasSkills = fs.existsSync(path.join(workDir, '.claude', 'skills'));
    result.conventions.hasDocs = fs.existsSync(path.join(workDir, 'docs')) || fs.existsSync(path.join(workDir, 'doc'));
    result.conventions.hasTests = result.conventions.hasTests ||
      fs.existsSync(path.join(workDir, 'tests')) ||
      fs.existsSync(path.join(workDir, 'test')) ||
      fs.existsSync(path.join(workDir, '__tests__')) ||
      fs.existsSync(path.join(workDir, 'spec'));

  } catch (e) {
    console.error('Bootstrap error:', e);
  }

  // Save results
  saveBootstrap(workspace.id, result);

  return result;
}

// Get bootstrap results
app.get('/api/bootstrap', (req: Request, res: Response) => {
  const workspaceId = getWorkspaceIdFromRequest(req);

  if (!workspaceId) {
    res.status(400).json({ error: 'workspaceId required' });
    return;
  }

  const result = loadBootstrap(workspaceId);
  if (!result) {
    res.status(404).json({ error: 'No bootstrap data. Start the workspace to generate.' });
    return;
  }

  res.json(result);
});

// Re-run bootstrap manually
app.post('/api/bootstrap', (req: Request, res: Response) => {
  const workspaceId = getWorkspaceIdFromRequest(req);

  if (!workspaceId) {
    res.status(400).json({ error: 'workspaceId required' });
    return;
  }

  const workspace = workspaces.find(w => w.id === workspaceId);
  if (!workspace) {
    res.status(404).json({ error: 'Workspace not found' });
    return;
  }

  const result = runBootstrap(workspace);
  res.json(result);
});

// ============ SKILLS API ============

interface Skill {
  name: string;
  filename: string;
  description: string;
  tags: string[];
  lastUpdated: string;
}

function getSkillsDir(workspaceDir: string): string {
  return path.join(workspaceDir, '.claude', 'skills');
}

function parseSkillMetadata(content: string, filename: string): Skill {
  const lines = content.split('\n');
  const name = lines[0]?.replace(/^#\s*/, '') || filename.replace('.md', '');

  // Extract description from ## Overview or first paragraph
  let description = '';
  let inOverview = false;
  for (const line of lines.slice(1)) {
    if (line.startsWith('## Overview')) {
      inOverview = true;
      continue;
    }
    if (inOverview && line.trim()) {
      description = line.trim();
      break;
    }
    if (!inOverview && line.trim() && !line.startsWith('#')) {
      description = line.trim();
      break;
    }
  }

  // Extract tags from ## Tags section or infer from content
  const tags: string[] = [];
  const tagsMatch = content.match(/## Tags\n([\s\S]*?)(?=\n##|\n$)/);
  if (tagsMatch) {
    const tagLines = tagsMatch[1].split('\n').filter(l => l.trim().startsWith('-'));
    tags.push(...tagLines.map(l => l.replace(/^-\s*/, '').trim()));
  }

  // Extract last updated
  const lastUpdatedMatch = content.match(/## Last Updated\n([^\n]+)/);
  const lastUpdated = lastUpdatedMatch ? lastUpdatedMatch[1].trim() : '';

  return { name, filename, description, tags, lastUpdated };
}

function listSkills(workspaceDir: string): Skill[] {
  const skillsDir = getSkillsDir(workspaceDir);
  if (!fs.existsSync(skillsDir)) {
    return [];
  }

  const files = fs.readdirSync(skillsDir).filter(f => f.endsWith('.md'));
  const skills: Skill[] = [];

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(skillsDir, file), 'utf-8');
      skills.push(parseSkillMetadata(content, file));
    } catch (e) {
      console.error(`Error reading skill ${file}:`, e);
    }
  }

  return skills;
}

function readSkill(workspaceDir: string, skillName: string): string | null {
  const skillsDir = getSkillsDir(workspaceDir);

  // Try exact match first
  let filename = skillName.endsWith('.md') ? skillName : `${skillName}.md`;
  let filepath = path.join(skillsDir, filename);

  if (fs.existsSync(filepath)) {
    return fs.readFileSync(filepath, 'utf-8');
  }

  // Try kebab-case conversion
  filename = skillName.toLowerCase().replace(/\s+/g, '-') + '.md';
  filepath = path.join(skillsDir, filename);

  if (fs.existsSync(filepath)) {
    return fs.readFileSync(filepath, 'utf-8');
  }

  return null;
}

// List all skills (metadata only)
app.get('/api/skills', (req: Request, res: Response) => {
  const workspaceId = getWorkspaceIdFromRequest(req);

  if (!workspaceId) {
    res.status(400).json({ error: 'workspaceId required' });
    return;
  }

  const workspace = workspaces.find(w => w.id === workspaceId);
  if (!workspace) {
    res.status(404).json({ error: 'Workspace not found' });
    return;
  }

  const skills = listSkills(workspace.workingDirectory);
  res.json({ skills });
});

// Read a specific skill
app.get('/api/skills/:name', (req: Request, res: Response) => {
  const workspaceId = getWorkspaceIdFromRequest(req);
  const { name } = req.params;

  if (!workspaceId) {
    res.status(400).json({ error: 'workspaceId required' });
    return;
  }

  const workspace = workspaces.find(w => w.id === workspaceId);
  if (!workspace) {
    res.status(404).json({ error: 'Workspace not found' });
    return;
  }

  const skillName = String(name);
  const content = readSkill(workspace.workingDirectory, skillName);
  if (!content) {
    res.status(404).json({ error: 'Skill not found' });
    return;
  }

  res.json({ name: skillName, content });
});

// Search skills by query
app.get('/api/skills/search/:query', (req: Request, res: Response) => {
  const workspaceId = getWorkspaceIdFromRequest(req);
  const searchQuery = String(req.params.query);

  if (!workspaceId) {
    res.status(400).json({ error: 'workspaceId required' });
    return;
  }

  const workspace = workspaces.find(w => w.id === workspaceId);
  if (!workspace) {
    res.status(404).json({ error: 'Workspace not found' });
    return;
  }

  const skills = listSkills(workspace.workingDirectory);
  const lowerQuery = searchQuery.toLowerCase();

  const matches = skills.filter(s =>
    s.name.toLowerCase().includes(lowerQuery) ||
    s.description.toLowerCase().includes(lowerQuery) ||
    s.tags.some(t => t.toLowerCase().includes(lowerQuery))
  );

  res.json({ skills: matches, query: searchQuery });
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
