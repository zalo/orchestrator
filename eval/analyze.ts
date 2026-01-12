#!/usr/bin/env npx ts-node
/**
 * analyze.ts - Compute evaluation metrics from collected data
 * Usage: npx ts-node eval/analyze.ts ./eval-output/TIMESTAMP/
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
  EvalData,
  EvalReport,
  TimingMetrics,
  CompletionMetrics,
  CoordinationMetrics,
  HierarchyMetrics,
  RoleMetrics,
  TimelineEvent,
  Bead,
  Agent,
  ProgressEntry,
  Message,
  MergeRequest,
  TerminalLog,
} from './metrics';

// ============ Data Loading ============

function loadJson<T>(filePath: string): T {
  const content = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(content);
}

function loadEvalData(dataDir: string): EvalData {
  const metadata = loadJson<{ workspaceId: string; collectedAt: string }>(
    path.join(dataDir, 'metadata.json')
  );

  const beads = loadJson<Bead[]>(path.join(dataDir, 'beads.json'));
  const agents = loadJson<Agent[]>(path.join(dataDir, 'agents.json'));
  const progress = loadJson<ProgressEntry[]>(path.join(dataDir, 'progress.json'));
  const messages = loadJson<Message[]>(path.join(dataDir, 'messages.json'));
  const mergeQueue = loadJson<MergeRequest[]>(path.join(dataDir, 'merge-queue.json'));

  // Load terminal logs manifest
  const logsDir = path.join(dataDir, 'terminal-logs');
  const terminalLogs: TerminalLog[] = [];

  if (fs.existsSync(logsDir)) {
    const logFiles = fs.readdirSync(logsDir).filter((f) => f.endsWith('.log'));
    for (const logFile of logFiles) {
      const filePath = path.join(logsDir, logFile);
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');

      // Parse agent name from filename: {agentName}-{timestamp}.log
      const agentName = logFile.replace(/-\d{4}-\d{2}-\d{2}T.*\.log$/, '');

      terminalLogs.push({
        agentName,
        filePath,
        capturedAt: metadata.collectedAt,
        lineCount: lines.length,
        content,
      });
    }
  }

  // Determine eval time range from data
  const allTimestamps = [
    ...beads.map((b) => b.created),
    ...agents.map((a) => a.created),
    ...progress.map((p) => p.timestamp),
    ...messages.map((m) => m.timestamp),
  ]
    .filter(Boolean)
    .sort();

  return {
    workspaceId: metadata.workspaceId,
    collectedAt: metadata.collectedAt,
    evalStartTime: allTimestamps[0] || metadata.collectedAt,
    evalEndTime: allTimestamps[allTimestamps.length - 1] || metadata.collectedAt,
    beads,
    agents,
    progress,
    messages,
    mergeQueue,
    terminalLogs,
  };
}

// ============ Metric Calculations ============

function calculateTimingMetrics(data: EvalData): TimingMetrics {
  const startTime = new Date(data.evalStartTime).getTime();
  const endTime = new Date(data.evalEndTime).getTime();
  const totalElapsedSeconds = (endTime - startTime) / 1000;

  // Time to first bead
  const firstBead = data.beads.sort(
    (a, b) => new Date(a.created).getTime() - new Date(b.created).getTime()
  )[0];
  const timeToFirstBeadSeconds = firstBead
    ? (new Date(firstBead.created).getTime() - startTime) / 1000
    : 0;

  // Agent spawn latency (from created to first progress entry with "working" implied)
  const spawnLatencies: number[] = [];
  for (const agent of data.agents) {
    if (agent.role === 'mayor') continue;
    const firstProgress = data.progress
      .filter((p) => p.agentId === agent.id || p.agentName === agent.name)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())[0];
    if (firstProgress) {
      const latency =
        (new Date(firstProgress.timestamp).getTime() - new Date(agent.created).getTime()) / 1000;
      if (latency > 0 && latency < 600) {
        // Ignore outliers > 10 min
        spawnLatencies.push(latency);
      }
    }
  }
  const avgAgentSpawnLatencySeconds =
    spawnLatencies.length > 0
      ? spawnLatencies.reduce((a, b) => a + b, 0) / spawnLatencies.length
      : 0;

  // Task duration (from bead created/assigned to done)
  const taskDurations: number[] = [];
  for (const bead of data.beads.filter((b) => b.status === 'done')) {
    const doneAudit = bead.audit.find(
      (a) => a.action === 'status_change' && a.details?.to === 'done'
    );
    if (doneAudit) {
      const duration =
        (new Date(doneAudit.time).getTime() - new Date(bead.created).getTime()) / 1000 / 60;
      if (duration > 0 && duration < 120) {
        // Ignore outliers > 2 hours
        taskDurations.push(duration);
      }
    }
  }
  const avgTaskDurationMinutes =
    taskDurations.length > 0
      ? taskDurations.reduce((a, b) => a + b, 0) / taskDurations.length
      : 0;

  // Merge queue wait time
  const mergeWaits: number[] = [];
  for (const mr of data.mergeQueue.filter((m) => m.status === 'merged' && m.mergedAt)) {
    const waitMinutes =
      (new Date(mr.mergedAt!).getTime() - new Date(mr.created).getTime()) / 1000 / 60;
    if (waitMinutes > 0 && waitMinutes < 60) {
      mergeWaits.push(waitMinutes);
    }
  }
  const mergeQueueWaitMinutes =
    mergeWaits.length > 0 ? mergeWaits.reduce((a, b) => a + b, 0) / mergeWaits.length : 0;

  return {
    totalElapsedSeconds,
    timeToFirstBeadSeconds,
    avgAgentSpawnLatencySeconds,
    avgTaskDurationMinutes,
    mergeQueueWaitMinutes,
  };
}

function calculateCompletionMetrics(data: EvalData): CompletionMetrics {
  const beadsTotal = data.beads.length;
  const beadsDone = data.beads.filter((b) => b.status === 'done').length;
  const beadsBlocked = data.beads.filter((b) => b.status === 'blocked').length;

  const agentsTotal = data.agents.filter((a) => a.role !== 'mayor').length;
  const agentsSucceeded = data.agents.filter(
    (a) => a.role !== 'mayor' && a.status !== 'offline' && a.status !== 'blocked'
  ).length;

  // First pass ratio - tasks completed without blocker messages
  const agentsWithBlockers = new Set(
    data.messages.filter((m) => m.type === 'blocker').map((m) => m.from)
  );
  const agentsWithCompletions = new Set(
    data.messages.filter((m) => m.type === 'completion').map((m) => m.from)
  );
  const firstPassCount = [...agentsWithCompletions].filter(
    (a) => !agentsWithBlockers.has(a)
  ).length;
  const firstPassRatio =
    agentsWithCompletions.size > 0 ? firstPassCount / agentsWithCompletions.size : 0;

  // Test pass ratio
  const beadsRequiringTests = data.beads.filter((b) => b.requiresTests);
  const beadsWithPassingTests = beadsRequiringTests.filter((b) => b.testStatus === 'passed');
  const testPassRatio =
    beadsRequiringTests.length > 0 ? beadsWithPassingTests.length / beadsRequiringTests.length : 1;

  return {
    beadCompletionRatio: beadsTotal > 0 ? beadsDone / beadsTotal : 0,
    agentSuccessRatio: agentsTotal > 0 ? agentsSucceeded / agentsTotal : 0,
    firstPassRatio,
    testPassRatio,
    beadsTotal,
    beadsDone,
    beadsBlocked,
    agentsTotal,
    agentsSucceeded,
  };
}

function calculateCoordinationMetrics(data: EvalData): CoordinationMetrics {
  const totalMessages = data.messages.length;
  const agentCount = data.agents.length;
  const messagesPerAgent = agentCount > 0 ? totalMessages / agentCount : 0;

  // Messages by type
  const messagesByType: Record<string, number> = {};
  for (const msg of data.messages) {
    messagesByType[msg.type] = (messagesByType[msg.type] || 0) + 1;
  }

  const blockerCount = messagesByType['blocker'] || 0;
  const completionCount = messagesByType['completion'] || 0;
  const blockerRatio = totalMessages > 0 ? blockerCount / totalMessages : 0;
  const completionRatio = totalMessages > 0 ? completionCount / totalMessages : 0;

  // Response time for action_required messages
  const actionRequiredMsgs = data.messages.filter((m) => m.type === 'action_required');
  const responseTimes: number[] = [];
  for (const arMsg of actionRequiredMsgs) {
    // Find next message from the recipient
    const response = data.messages.find(
      (m) =>
        m.from === arMsg.to &&
        new Date(m.timestamp).getTime() > new Date(arMsg.timestamp).getTime()
    );
    if (response) {
      const responseTime =
        (new Date(response.timestamp).getTime() - new Date(arMsg.timestamp).getTime()) / 1000;
      if (responseTime > 0 && responseTime < 1800) {
        // < 30 min
        responseTimes.push(responseTime);
      }
    }
  }
  const avgResponseTimeSeconds =
    responseTimes.length > 0
      ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
      : 0;

  // Escalation ratio - messages to mayor vs total
  const messagesToMayor = data.messages.filter((m) => m.to === 'mayor').length;
  const escalationRatio = totalMessages > 0 ? messagesToMayor / totalMessages : 0;

  return {
    totalMessages,
    messagesPerAgent,
    blockerRatio,
    completionRatio,
    avgResponseTimeSeconds,
    escalationRatio,
    messagesByType,
  };
}

function calculateHierarchyMetrics(data: EvalData): HierarchyMetrics {
  // Agent hierarchy depth
  const agentMap = new Map(data.agents.map((a) => [a.id, a]));

  function getDepth(agent: Agent): number {
    if (!agent.parentAgentId) return 0;
    const parent = agentMap.get(agent.parentAgentId);
    return parent ? 1 + getDepth(parent) : 1;
  }

  const depths = data.agents.map(getDepth);
  const maxSpawnDepth = Math.max(...depths, 0);

  // Hierarchical ratio
  const agentsWithParents = data.agents.filter((a) => a.parentAgentId).length;
  const hierarchicalRatio =
    data.agents.length > 0 ? agentsWithParents / data.agents.length : 0;

  // Witness spawn count
  const witnesses = data.agents.filter((a) => a.role === 'witness');
  const witnessSpawns = witnesses.map((w) => w.spawnedAgentIds?.length || 0);
  const witnessSpawnCount =
    witnessSpawns.length > 0
      ? witnessSpawns.reduce((a, b) => a + b, 0) / witnessSpawns.length
      : 0;

  // Delegation success - specialists spawned by witnesses that completed
  const specialistsFromWitnesses = data.agents.filter(
    (a) => a.role === 'specialist' && a.parentAgentId
  );
  const completedSpecialists = specialistsFromWitnesses.filter((a) => {
    const completionMsg = data.messages.find(
      (m) => m.from === a.name && m.type === 'completion'
    );
    return !!completionMsg;
  });
  const delegationSuccessRatio =
    specialistsFromWitnesses.length > 0
      ? completedSpecialists.length / specialistsFromWitnesses.length
      : 0;

  // Agents by role
  const agentsByRole: Record<string, number> = {};
  for (const agent of data.agents) {
    agentsByRole[agent.role] = (agentsByRole[agent.role] || 0) + 1;
  }

  return {
    maxSpawnDepth,
    hierarchicalRatio,
    witnessSpawnCount,
    delegationSuccessRatio,
    agentsByRole,
  };
}

function calculateRoleMetrics(data: EvalData): RoleMetrics[] {
  const roles = ['mayor', 'specialist', 'reviewer', 'explorer', 'witness', 'refinery', 'deacon'];
  const metrics: RoleMetrics[] = [];

  for (const role of roles) {
    const roleAgents = data.agents.filter((a) => a.role === role);
    if (roleAgents.length === 0) continue;

    const agentNames = new Set(roleAgents.map((a) => a.name));

    // Duration - from created to last progress
    const durations: number[] = [];
    for (const agent of roleAgents) {
      const agentProgress = data.progress
        .filter((p) => p.agentId === agent.id || p.agentName === agent.name)
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      if (agentProgress.length > 0) {
        const duration =
          (new Date(agentProgress[0].timestamp).getTime() -
            new Date(agent.created).getTime()) /
          1000 /
          60;
        if (duration > 0) durations.push(duration);
      }
    }

    // Completion ratio
    const completions = data.messages.filter(
      (m) => agentNames.has(m.from) && m.type === 'completion'
    ).length;

    // Messages
    const messagesReceived = data.messages.filter((m) => agentNames.has(m.to)).length;
    const messagesSent = data.messages.filter((m) => agentNames.has(m.from)).length;

    // Progress updates
    const progressUpdates = data.progress.filter(
      (p) => agentNames.has(p.agentName) || roleAgents.some((a) => a.id === p.agentId)
    ).length;

    // Role-specific custom metrics
    const custom: Record<string, number> = {};

    if (role === 'mayor') {
      custom.beadsCreated = data.beads.length;
      custom.agentsSpawned = data.agents.filter((a) => a.role !== 'mayor').length;
    } else if (role === 'specialist') {
      const blockers = data.messages.filter(
        (m) => agentNames.has(m.from) && m.type === 'blocker'
      ).length;
      custom.blockersSent = blockers;
    } else if (role === 'reviewer') {
      custom.reviewsCompleted = completions;
    } else if (role === 'witness') {
      custom.agentsMonitored = roleAgents.reduce(
        (sum, a) => sum + (a.spawnedAgentIds?.length || 0),
        0
      );
    }

    metrics.push({
      role,
      agentCount: roleAgents.length,
      avgDurationMinutes:
        durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0,
      completionRatio: roleAgents.length > 0 ? completions / roleAgents.length : 0,
      messagesReceived,
      messagesSent,
      progressUpdates,
      custom,
    });
  }

  return metrics;
}

function buildTimeline(data: EvalData): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  const startTime = new Date(data.evalStartTime).getTime();

  // Agent spawns
  for (const agent of data.agents) {
    events.push({
      timestamp: agent.created,
      elapsedSeconds: (new Date(agent.created).getTime() - startTime) / 1000,
      event: `Agent spawned: ${agent.name} (${agent.role})`,
      agent: agent.name,
    });
  }

  // Bead creations
  for (const bead of data.beads) {
    events.push({
      timestamp: bead.created,
      elapsedSeconds: (new Date(bead.created).getTime() - startTime) / 1000,
      event: `Bead created: ${bead.id}`,
      beadId: bead.id,
      details: bead.title,
    });
  }

  // Bead completions
  for (const bead of data.beads.filter((b) => b.status === 'done')) {
    const doneAudit = bead.audit.find(
      (a) => a.action === 'status_change' && a.details?.to === 'done'
    );
    if (doneAudit) {
      events.push({
        timestamp: doneAudit.time,
        elapsedSeconds: (new Date(doneAudit.time).getTime() - startTime) / 1000,
        event: `Bead completed: ${bead.id}`,
        beadId: bead.id,
        agent: doneAudit.by,
      });
    }
  }

  // Completion messages
  for (const msg of data.messages.filter((m) => m.type === 'completion')) {
    events.push({
      timestamp: msg.timestamp,
      elapsedSeconds: (new Date(msg.timestamp).getTime() - startTime) / 1000,
      event: `Completion: ${msg.from}`,
      agent: msg.from,
      details: msg.content.substring(0, 100),
    });
  }

  // Blocker messages
  for (const msg of data.messages.filter((m) => m.type === 'blocker')) {
    events.push({
      timestamp: msg.timestamp,
      elapsedSeconds: (new Date(msg.timestamp).getTime() - startTime) / 1000,
      event: `BLOCKER: ${msg.from}`,
      agent: msg.from,
      details: msg.content.substring(0, 100),
    });
  }

  // Sort by timestamp
  events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  return events;
}

function identifyStrengthsAndWeaknesses(
  data: EvalData,
  timing: TimingMetrics,
  completion: CompletionMetrics,
  coordination: CoordinationMetrics,
  hierarchy: HierarchyMetrics
): { strengths: string[]; weaknesses: string[] } {
  const strengths: string[] = [];
  const weaknesses: string[] = [];

  // Completion analysis
  if (completion.beadCompletionRatio > 0.9) {
    strengths.push(`High bead completion (${(completion.beadCompletionRatio * 100).toFixed(1)}%)`);
  } else if (completion.beadCompletionRatio < 0.5) {
    weaknesses.push(
      `Low bead completion (${(completion.beadCompletionRatio * 100).toFixed(1)}%)`
    );
  }

  if (completion.firstPassRatio > 0.8) {
    strengths.push(`Good first-pass success (${(completion.firstPassRatio * 100).toFixed(1)}%)`);
  } else if (completion.firstPassRatio < 0.5) {
    weaknesses.push(`Many blockers encountered (first-pass: ${(completion.firstPassRatio * 100).toFixed(1)}%)`);
  }

  // Coordination analysis
  if (coordination.blockerRatio < 0.1) {
    strengths.push('Low blocker rate - agents worked smoothly');
  } else if (coordination.blockerRatio > 0.3) {
    weaknesses.push(`High blocker rate (${(coordination.blockerRatio * 100).toFixed(1)}%)`);
  }

  if (coordination.escalationRatio < 0.3 && hierarchy.maxSpawnDepth > 1) {
    strengths.push('Effective hierarchical delegation - low escalation to mayor');
  } else if (coordination.escalationRatio > 0.7) {
    weaknesses.push('High escalation ratio - hierarchy underutilized');
  }

  // Hierarchy analysis
  if (hierarchy.maxSpawnDepth >= 2) {
    strengths.push(`Multi-level hierarchy utilized (depth: ${hierarchy.maxSpawnDepth})`);
  }

  if (hierarchy.delegationSuccessRatio > 0.8) {
    strengths.push('Witness delegation highly effective');
  } else if (hierarchy.delegationSuccessRatio < 0.5 && hierarchy.witnessSpawnCount > 0) {
    weaknesses.push('Witness delegation struggling');
  }

  // Timing analysis
  if (timing.avgAgentSpawnLatencySeconds < 30) {
    strengths.push('Fast agent startup');
  } else if (timing.avgAgentSpawnLatencySeconds > 120) {
    weaknesses.push('Slow agent startup - high spawn latency');
  }

  // Role coverage
  const rolesCovered = Object.keys(hierarchy.agentsByRole).length;
  if (rolesCovered >= 5) {
    strengths.push(`Good role diversity (${rolesCovered} roles used)`);
  } else if (rolesCovered < 3) {
    weaknesses.push(`Limited role diversity (only ${rolesCovered} roles)`);
  }

  return { strengths, weaknesses };
}

// ============ Main Analysis ============

function analyze(dataDir: string): EvalReport {
  console.log(`Loading data from: ${dataDir}`);
  const data = loadEvalData(dataDir);

  console.log('Calculating timing metrics...');
  const timing = calculateTimingMetrics(data);

  console.log('Calculating completion metrics...');
  const completion = calculateCompletionMetrics(data);

  console.log('Calculating coordination metrics...');
  const coordination = calculateCoordinationMetrics(data);

  console.log('Calculating hierarchy metrics...');
  const hierarchy = calculateHierarchyMetrics(data);

  console.log('Calculating role metrics...');
  const roleMetrics = calculateRoleMetrics(data);

  console.log('Building timeline...');
  const timeline = buildTimeline(data);

  console.log('Identifying strengths and weaknesses...');
  const { strengths, weaknesses } = identifyStrengthsAndWeaknesses(
    data,
    timing,
    completion,
    coordination,
    hierarchy
  );

  // Load workspace info if available
  let workspaceName = 'Unknown';
  try {
    const workspace = loadJson<{ name: string }>(path.join(dataDir, 'workspace.json'));
    workspaceName = workspace.name;
  } catch {
    // Ignore
  }

  const report: EvalReport = {
    meta: {
      workspaceId: data.workspaceId,
      workspaceName,
      evalStartTime: data.evalStartTime,
      evalEndTime: data.evalEndTime,
      generatedAt: new Date().toISOString(),
      projectDescription: 'Agent Orchestration Evaluation',
    },
    timing,
    completion,
    coordination,
    hierarchy,
    roleMetrics,
    timeline,
    strengths,
    weaknesses,
    rawDataSummary: {
      beadCount: data.beads.length,
      agentCount: data.agents.length,
      progressEntryCount: data.progress.length,
      messageCount: data.messages.length,
      mergeRequestCount: data.mergeQueue.length,
      terminalLogCount: data.terminalLogs.length,
    },
  };

  return report;
}

function formatReport(report: EvalReport): string {
  const lines: string[] = [];

  lines.push('# Agent Orchestration Evaluation Report');
  lines.push('');
  lines.push(`**Workspace:** ${report.meta.workspaceName} (${report.meta.workspaceId})`);
  lines.push(`**Generated:** ${report.meta.generatedAt}`);
  lines.push(`**Duration:** ${(report.timing.totalElapsedSeconds / 60).toFixed(1)} minutes`);
  lines.push('');

  lines.push('## Summary');
  lines.push('');
  lines.push('### Strengths');
  for (const s of report.strengths) {
    lines.push(`- ${s}`);
  }
  lines.push('');
  lines.push('### Weaknesses');
  for (const w of report.weaknesses) {
    lines.push(`- ${w}`);
  }
  lines.push('');

  lines.push('## Timing Metrics');
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Total Elapsed | ${(report.timing.totalElapsedSeconds / 60).toFixed(1)} min |`);
  lines.push(`| Time to First Bead | ${report.timing.timeToFirstBeadSeconds.toFixed(1)} sec |`);
  lines.push(`| Avg Agent Spawn Latency | ${report.timing.avgAgentSpawnLatencySeconds.toFixed(1)} sec |`);
  lines.push(`| Avg Task Duration | ${report.timing.avgTaskDurationMinutes.toFixed(1)} min |`);
  lines.push(`| Avg Merge Queue Wait | ${report.timing.mergeQueueWaitMinutes.toFixed(1)} min |`);
  lines.push('');

  lines.push('## Completion Metrics');
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Bead Completion | ${(report.completion.beadCompletionRatio * 100).toFixed(1)}% (${report.completion.beadsDone}/${report.completion.beadsTotal}) |`);
  lines.push(`| Agent Success | ${(report.completion.agentSuccessRatio * 100).toFixed(1)}% (${report.completion.agentsSucceeded}/${report.completion.agentsTotal}) |`);
  lines.push(`| First-Pass Success | ${(report.completion.firstPassRatio * 100).toFixed(1)}% |`);
  lines.push(`| Test Pass Rate | ${(report.completion.testPassRatio * 100).toFixed(1)}% |`);
  lines.push('');

  lines.push('## Coordination Metrics');
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Total Messages | ${report.coordination.totalMessages} |`);
  lines.push(`| Messages/Agent | ${report.coordination.messagesPerAgent.toFixed(1)} |`);
  lines.push(`| Blocker Ratio | ${(report.coordination.blockerRatio * 100).toFixed(1)}% |`);
  lines.push(`| Completion Ratio | ${(report.coordination.completionRatio * 100).toFixed(1)}% |`);
  lines.push(`| Avg Response Time | ${report.coordination.avgResponseTimeSeconds.toFixed(1)} sec |`);
  lines.push(`| Escalation Ratio | ${(report.coordination.escalationRatio * 100).toFixed(1)}% |`);
  lines.push('');

  lines.push('## Hierarchy Metrics');
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Max Spawn Depth | ${report.hierarchy.maxSpawnDepth} |`);
  lines.push(`| Hierarchical Ratio | ${(report.hierarchy.hierarchicalRatio * 100).toFixed(1)}% |`);
  lines.push(`| Avg Witness Spawn Count | ${report.hierarchy.witnessSpawnCount.toFixed(1)} |`);
  lines.push(`| Delegation Success | ${(report.hierarchy.delegationSuccessRatio * 100).toFixed(1)}% |`);
  lines.push('');

  lines.push('### Agents by Role');
  lines.push('');
  for (const [role, count] of Object.entries(report.hierarchy.agentsByRole)) {
    lines.push(`- **${role}**: ${count}`);
  }
  lines.push('');

  lines.push('## Role Performance');
  lines.push('');
  lines.push(`| Role | Count | Avg Duration | Completion | Messages Sent | Progress Updates |`);
  lines.push(`|------|-------|--------------|------------|---------------|------------------|`);
  for (const rm of report.roleMetrics) {
    lines.push(
      `| ${rm.role} | ${rm.agentCount} | ${rm.avgDurationMinutes.toFixed(1)} min | ${(rm.completionRatio * 100).toFixed(0)}% | ${rm.messagesSent} | ${rm.progressUpdates} |`
    );
  }
  lines.push('');

  lines.push('## Timeline (Key Events)');
  lines.push('');
  const keyEvents = report.timeline.filter(
    (e) =>
      e.event.includes('spawned') ||
      e.event.includes('Completion') ||
      e.event.includes('BLOCKER')
  );
  for (const event of keyEvents.slice(0, 30)) {
    const mins = (event.elapsedSeconds / 60).toFixed(1);
    lines.push(`- **${mins} min**: ${event.event}`);
  }
  lines.push('');

  lines.push('## Raw Data Summary');
  lines.push('');
  lines.push(`- Beads: ${report.rawDataSummary.beadCount}`);
  lines.push(`- Agents: ${report.rawDataSummary.agentCount}`);
  lines.push(`- Progress Entries: ${report.rawDataSummary.progressEntryCount}`);
  lines.push(`- Messages: ${report.rawDataSummary.messageCount}`);
  lines.push(`- Merge Requests: ${report.rawDataSummary.mergeRequestCount}`);
  lines.push(`- Terminal Logs: ${report.rawDataSummary.terminalLogCount}`);

  return lines.join('\n');
}

// ============ CLI Entry Point ============

const args = process.argv.slice(2);
if (args.length < 1) {
  console.log('Usage: npx ts-node eval/analyze.ts <data-directory>');
  console.log('Example: npx ts-node eval/analyze.ts ./eval-output/20260112_143022/');
  process.exit(1);
}

const dataDir = args[0];
if (!fs.existsSync(dataDir)) {
  console.error(`Directory not found: ${dataDir}`);
  process.exit(1);
}

const report = analyze(dataDir);

// Save JSON report
const jsonPath = path.join(dataDir, 'report.json');
fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
console.log(`\nJSON report saved to: ${jsonPath}`);

// Save markdown report
const mdPath = path.join(dataDir, 'report.md');
fs.writeFileSync(mdPath, formatReport(report));
console.log(`Markdown report saved to: ${mdPath}`);

// Print summary to console
console.log('\n' + '='.repeat(60));
console.log(formatReport(report));
