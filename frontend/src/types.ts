export interface Workspace {
  id: string;
  name: string;
  workingDirectory: string;
  status: 'active' | 'stopped';
  mayorId: string | null;
  created: string;
  lastActivity: string;
}

export interface FilesystemEntry {
  name: string;
  type: 'directory' | 'file';
  size?: number;
  modified?: string;
}

export interface FilesystemResponse {
  path: string;
  parent: string | null;
  entries: FilesystemEntry[];
}

export interface Bead {
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

export interface AuditEntry {
  time: string;
  action: string;
  by: string;
  details?: Record<string, unknown>;
}

export interface Agent {
  id: string;
  name: string;
  role: 'mayor' | 'specialist' | 'reviewer' | 'explorer';
  model: 'opus' | 'sonnet' | 'haiku';
  status: 'idle' | 'working' | 'blocked' | 'offline' | 'starting';
  currentTask: string | null;
  worktree: string | null;
  tmuxSession: string | null;
  lastSeen: string;
  created: string;
}

export interface ProgressEntry {
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

export interface Message {
  id: string;
  from: string;
  to: string;
  timestamp: string;
  content: string;
  read: boolean;
  type: 'info' | 'action_required' | 'completion' | 'blocker';
}

export interface Stats {
  beads: {
    total: number;
    todo: number;
    inProgress: number;
    done: number;
    blocked: number;
  };
  agents: {
    total: number;
    working: number;
    idle: number;
    blocked: number;
    offline: number;
  };
  messages: {
    total: number;
    unread: number;
  };
  progressEntries: number;
}
