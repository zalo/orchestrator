/**
 * Evaluation Metrics Types
 * All metrics are continuous values for trend analysis across runs
 */

// ============ Raw Data Types (from APIs) ============

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
  requiresTests: boolean;
  testStatus: 'pending' | 'running' | 'passed' | 'failed' | 'skipped' | null;
  testOutput: string | null;
  testRunAt: string | null;
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
  role: 'mayor' | 'specialist' | 'reviewer' | 'explorer' | 'witness' | 'refinery' | 'deacon';
  model: 'opus' | 'sonnet' | 'haiku';
  status: 'idle' | 'working' | 'blocked' | 'offline' | 'starting';
  currentTask: string | null;
  worktree: string | null;
  worktreeBranch: string | null;
  ownedPaths: string[];
  tmuxSession: string | null;
  pid: number | null;
  lastSeen: string;
  created: string;
  workspaceId: string;
  parentAgentId: string | null;
  canSpawnAgents: boolean;
  spawnedAgentIds: string[];
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

export interface MergeRequest {
  id: string;
  agentId: string;
  agentName: string;
  branch: string;
  targetBranch: string;
  title: string;
  description: string;
  status: 'pending' | 'in_queue' | 'merging' | 'merged' | 'failed' | 'conflict';
  position: number;
  created: string;
  updated: string;
  mergedAt: string | null;
  conflictsWith: string[];
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

// ============ Collected Evaluation Data ============

export interface EvalData {
  workspaceId: string;
  collectedAt: string;
  evalStartTime: string;
  evalEndTime: string;
  beads: Bead[];
  agents: Agent[];
  progress: ProgressEntry[];
  messages: Message[];
  mergeQueue: MergeRequest[];
  terminalLogs: TerminalLog[];
}

export interface TerminalLog {
  agentName: string;
  filePath: string;
  capturedAt: string;
  lineCount: number;
  content?: string; // Optional - may be large
}

// ============ Computed Metrics ============

export interface TimingMetrics {
  /** Wall clock seconds from eval start to final completion */
  totalElapsedSeconds: number;
  /** Seconds until Mayor created first bead */
  timeToFirstBeadSeconds: number;
  /** Mean seconds from agent spawn request to "working" status */
  avgAgentSpawnLatencySeconds: number;
  /** Mean minutes per bead completion */
  avgTaskDurationMinutes: number;
  /** Mean minutes MRs spend in queue before merge */
  mergeQueueWaitMinutes: number;
}

export interface CompletionMetrics {
  /** done / total beads (0.0-1.0) */
  beadCompletionRatio: number;
  /** Agents completing cleanly / total agents (0.0-1.0) */
  agentSuccessRatio: number;
  /** Tasks completed without blocker messages / total tasks (0.0-1.0) */
  firstPassRatio: number;
  /** Beads with passing tests / beads requiring tests (0.0-1.0) */
  testPassRatio: number;
  /** Raw counts */
  beadsTotal: number;
  beadsDone: number;
  beadsBlocked: number;
  agentsTotal: number;
  agentsSucceeded: number;
}

export interface CoordinationMetrics {
  /** Total inter-agent messages */
  totalMessages: number;
  /** Mean messages sent per agent */
  messagesPerAgent: number;
  /** Blocker messages / total messages (0.0-1.0) */
  blockerRatio: number;
  /** Completion messages / total messages */
  completionRatio: number;
  /** Mean seconds between action_required and response */
  avgResponseTimeSeconds: number;
  /** Messages to mayor / total messages (lower = better hierarchy) */
  escalationRatio: number;
  /** Messages by type */
  messagesByType: Record<string, number>;
}

export interface HierarchyMetrics {
  /** Deepest parentAgentId chain */
  maxSpawnDepth: number;
  /** Agents with parents / total agents */
  hierarchicalRatio: number;
  /** Mean specialists spawned per witness */
  witnessSpawnCount: number;
  /** Specialist completions / specialist spawns */
  delegationSuccessRatio: number;
  /** Agents by role */
  agentsByRole: Record<string, number>;
}

export interface RoleMetrics {
  role: string;
  agentCount: number;
  avgDurationMinutes: number;
  completionRatio: number;
  messagesReceived: number;
  messagesSent: number;
  progressUpdates: number;
  /** Role-specific metrics */
  custom: Record<string, number>;
}

// ============ Final Evaluation Report ============

export interface EvalReport {
  /** Evaluation metadata */
  meta: {
    workspaceId: string;
    workspaceName: string;
    evalStartTime: string;
    evalEndTime: string;
    generatedAt: string;
    projectDescription: string;
  };

  /** Timing metrics */
  timing: TimingMetrics;

  /** Completion metrics */
  completion: CompletionMetrics;

  /** Coordination metrics */
  coordination: CoordinationMetrics;

  /** Hierarchy metrics */
  hierarchy: HierarchyMetrics;

  /** Per-role breakdown */
  roleMetrics: RoleMetrics[];

  /** Timeline of key events */
  timeline: TimelineEvent[];

  /** Strengths identified */
  strengths: string[];

  /** Weaknesses/issues identified */
  weaknesses: string[];

  /** Raw data summary */
  rawDataSummary: {
    beadCount: number;
    agentCount: number;
    progressEntryCount: number;
    messageCount: number;
    mergeRequestCount: number;
    terminalLogCount: number;
  };
}

export interface TimelineEvent {
  timestamp: string;
  elapsedSeconds: number;
  event: string;
  agent?: string;
  beadId?: string;
  details?: string;
}
