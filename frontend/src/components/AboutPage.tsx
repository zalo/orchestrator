import { useState } from 'react';

interface EvalReport {
  meta: {
    workspaceName: string;
    evalStartTime: string;
    evalEndTime: string;
    generatedAt: string;
    projectDescription: string;
  };
  timing: {
    totalElapsedSeconds: number;
    timeToFirstBeadSeconds: number;
    avgAgentSpawnLatencySeconds: number;
  };
  completion: {
    beadCompletionRatio: number;
    agentSuccessRatio: number;
    firstPassRatio: number;
    testPassRatio: number;
    beadsTotal: number;
    beadsDone: number;
    agentsTotal: number;
  };
  coordination: {
    totalMessages: number;
    messagesPerAgent: number;
    blockerRatio: number;
    completionRatio: number;
  };
  hierarchy: {
    maxSpawnDepth: number;
    witnessSpawnCount: number;
    delegationSuccessRatio: number;
    agentsByRole: Record<string, number>;
  };
  strengths: string[];
  weaknesses: string[];
}

interface EvalRun {
  label: string;
  timestamp: string;
  report: EvalReport;
}

// Hardcoded eval data - in production this could come from an API
const evalRuns: EvalRun[] = [
  {
    label: 'Initial Run',
    timestamp: '2026-01-12T02:20:56',
    report: {
      meta: {
        workspaceName: 'eval-docportal',
        evalStartTime: '2026-01-12T10:06:57.149Z',
        evalEndTime: '2026-01-12T10:20:42.803Z',
        generatedAt: '2026-01-12T10:21:12.503Z',
        projectDescription: 'Agent Orchestration Evaluation',
      },
      timing: {
        totalElapsedSeconds: 825.654,
        timeToFirstBeadSeconds: 37.639,
        avgAgentSpawnLatencySeconds: 41.296,
      },
      completion: {
        beadCompletionRatio: 0,
        agentSuccessRatio: 0,
        firstPassRatio: 1,
        testPassRatio: 0,
        beadsTotal: 4,
        beadsDone: 0,
        agentsTotal: 9,
      },
      coordination: {
        totalMessages: 35,
        messagesPerAgent: 3.5,
        blockerRatio: 0.114,
        completionRatio: 0.171,
      },
      hierarchy: {
        maxSpawnDepth: 1,
        witnessSpawnCount: 2,
        delegationSuccessRatio: 1,
        agentsByRole: { mayor: 1, deacon: 1, refinery: 1, reviewer: 1, witness: 2, specialist: 4 },
      },
      strengths: ['Good first-pass success (100.0%)', 'Witness delegation highly effective', 'Good role diversity (6 roles used)'],
      weaknesses: ['Low bead completion (0.0%)'],
    },
  },
  {
    label: 'After Review Gate',
    timestamp: '2026-01-12T09:38:20',
    report: {
      meta: {
        workspaceName: 'eval-docportal',
        evalStartTime: '2026-01-12T17:19:36.885Z',
        evalEndTime: '2026-01-12T17:37:40.567Z',
        generatedAt: '2026-01-12T17:38:26.410Z',
        projectDescription: 'Agent Orchestration Evaluation',
      },
      timing: {
        totalElapsedSeconds: 1083.682,
        timeToFirstBeadSeconds: 70.705,
        avgAgentSpawnLatencySeconds: 58.8,
      },
      completion: {
        beadCompletionRatio: 0.714,
        agentSuccessRatio: 0,
        firstPassRatio: 1,
        testPassRatio: 0.571,
        beadsTotal: 7,
        beadsDone: 5,
        agentsTotal: 10,
      },
      coordination: {
        totalMessages: 40,
        messagesPerAgent: 3.64,
        blockerRatio: 0.15,
        completionRatio: 0.275,
      },
      hierarchy: {
        maxSpawnDepth: 1,
        witnessSpawnCount: 2,
        delegationSuccessRatio: 0.75,
        agentsByRole: { mayor: 1, explorer: 1, witness: 2, deacon: 1, reviewer: 1, refinery: 1, specialist: 4 },
      },
      strengths: ['Good first-pass success (100.0%)', 'Good role diversity (7 roles used)'],
      weaknesses: [],
    },
  },
];

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}m ${secs}s`;
}

function formatPercent(ratio: number): string {
  return `${(ratio * 100).toFixed(0)}%`;
}

function MetricCard({ label, value, subtext, trend }: { label: string; value: string; subtext?: string; trend?: 'up' | 'down' | 'neutral' }) {
  return (
    <div className="bg-charcoal border border-charcoal-lighter rounded-lg p-4">
      <div className="text-slate-400 text-sm mb-1">{label}</div>
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-bold text-slate-100">{value}</span>
        {trend && (
          <span className={trend === 'up' ? 'text-emerald' : trend === 'down' ? 'text-rose' : 'text-slate-500'}>
            {trend === 'up' ? '↑' : trend === 'down' ? '↓' : '→'}
          </span>
        )}
      </div>
      {subtext && <div className="text-slate-500 text-xs mt-1">{subtext}</div>}
    </div>
  );
}

function EvalRunCard({ run, isLatest, previousRun }: { run: EvalRun; isLatest: boolean; previousRun?: EvalRun }) {
  const r = run.report;
  const prev = previousRun?.report;

  const getCompletionTrend = () => {
    if (!prev) return 'neutral';
    return r.completion.beadCompletionRatio > prev.completion.beadCompletionRatio ? 'up' : 'neutral';
  };

  const getTestTrend = () => {
    if (!prev) return 'neutral';
    return r.completion.testPassRatio > prev.completion.testPassRatio ? 'up' : 'neutral';
  };

  return (
    <div className={`bg-charcoal-light border rounded-xl p-5 ${isLatest ? 'border-cyan/50' : 'border-charcoal-lighter'}`}>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-slate-100">{run.label}</h3>
          <p className="text-sm text-slate-500">{new Date(run.timestamp).toLocaleDateString()}</p>
        </div>
        {isLatest && (
          <span className="px-2 py-1 text-xs font-medium bg-cyan/20 text-cyan rounded">Latest</span>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <MetricCard
          label="Bead Completion"
          value={formatPercent(r.completion.beadCompletionRatio)}
          subtext={`${r.completion.beadsDone}/${r.completion.beadsTotal} beads`}
          trend={getCompletionTrend()}
        />
        <MetricCard
          label="Test Pass Rate"
          value={formatPercent(r.completion.testPassRatio)}
          trend={getTestTrend()}
        />
        <MetricCard
          label="First Pass"
          value={formatPercent(r.completion.firstPassRatio)}
        />
        <MetricCard
          label="Duration"
          value={formatDuration(r.timing.totalElapsedSeconds)}
        />
      </div>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <h4 className="text-sm font-medium text-slate-300 mb-2">Coordination</h4>
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-500">Messages</span>
              <span className="text-slate-300">{r.coordination.totalMessages}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Per Agent</span>
              <span className="text-slate-300">{r.coordination.messagesPerAgent.toFixed(1)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Agents</span>
              <span className="text-slate-300">{r.completion.agentsTotal}</span>
            </div>
          </div>
        </div>
        <div>
          <h4 className="text-sm font-medium text-slate-300 mb-2">Hierarchy</h4>
          <div className="flex flex-wrap gap-1">
            {Object.entries(r.hierarchy.agentsByRole).map(([role, count]) => (
              <span key={role} className="px-2 py-0.5 text-xs bg-charcoal-lighter rounded text-slate-400">
                {role}: {count}
              </span>
            ))}
          </div>
        </div>
      </div>

      {(r.strengths.length > 0 || r.weaknesses.length > 0) && (
        <div className="border-t border-charcoal-lighter pt-3">
          {r.strengths.length > 0 && (
            <div className="mb-2">
              <span className="text-emerald text-xs font-medium">Strengths: </span>
              <span className="text-slate-400 text-xs">{r.strengths.join(' | ')}</span>
            </div>
          )}
          {r.weaknesses.length > 0 && (
            <div>
              <span className="text-amber text-xs font-medium">Areas to Improve: </span>
              <span className="text-slate-400 text-xs">{r.weaknesses.join(' | ')}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EvalHistorySection() {
  const sortedRuns = [...evalRuns].reverse(); // Latest first

  return (
    <section className="mb-10">
      <h2 className="text-xl font-bold text-slate-100 mb-4 flex items-center gap-2">
        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-purple" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M3 3a1 1 0 000 2v8a2 2 0 002 2h2.586l-1.293 1.293a1 1 0 101.414 1.414L10 15.414l2.293 2.293a1 1 0 001.414-1.414L12.414 15H15a2 2 0 002-2V5a1 1 0 100-2H3zm11.707 4.707a1 1 0 00-1.414-1.414L10 9.586 8.707 8.293a1 1 0 00-1.414 0l-2 2a1 1 0 101.414 1.414L8 10.414l1.293 1.293a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
        </svg>
        Evaluation History
      </h2>
      <p className="text-slate-400 text-sm mb-4">
        Track improvements in orchestrator performance across evaluation runs.
      </p>
      <div className="space-y-4">
        {sortedRuns.map((run, idx) => (
          <EvalRunCard
            key={run.timestamp}
            run={run}
            isLatest={idx === 0}
            previousRun={idx < sortedRuns.length - 1 ? sortedRuns[idx + 1] : undefined}
          />
        ))}
      </div>
    </section>
  );
}

function PhilosophySection() {
  const [expanded, setExpanded] = useState<string | null>(null);

  const toggle = (section: string) => {
    setExpanded(expanded === section ? null : section);
  };

  return (
    <section>
      <h2 className="text-xl font-bold text-slate-100 mb-4 flex items-center gap-2">
        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-cyan" viewBox="0 0 20 20" fill="currentColor">
          <path d="M9 4.804A7.968 7.968 0 005.5 4c-1.255 0-2.443.29-3.5.804v10A7.969 7.969 0 015.5 14c1.669 0 3.218.51 4.5 1.385A7.962 7.962 0 0114.5 14c1.255 0 2.443.29 3.5.804v-10A7.968 7.968 0 0014.5 4c-1.255 0-2.443.29-3.5.804V12a1 1 0 11-2 0V4.804z" />
        </svg>
        Philosophy & Architecture
      </h2>

      {/* Executive Summary */}
      <div className="bg-gradient-to-r from-cyan/10 to-purple/10 border border-cyan/20 rounded-xl p-5 mb-6">
        <h3 className="text-lg font-semibold text-slate-100 mb-3">Executive Summary</h3>
        <p className="text-slate-300 leading-relaxed">
          The modern approach to scaling AI coding agents centers on three fundamental innovations:
        </p>
        <ul className="mt-3 space-y-2">
          <li className="flex items-start gap-2 text-slate-300">
            <span className="text-cyan font-bold">1.</span>
            <span><strong className="text-slate-100">Addressable Work Items</strong> - Every task gets an ID, dependencies, and audit trail</span>
          </li>
          <li className="flex items-start gap-2 text-slate-300">
            <span className="text-cyan font-bold">2.</span>
            <span><strong className="text-slate-100">Workspace Isolation</strong> - Git worktrees provide each agent with independent file state</span>
          </li>
          <li className="flex items-start gap-2 text-slate-300">
            <span className="text-cyan font-bold">3.</span>
            <span><strong className="text-slate-100">Graceful Degradation</strong> - Every component works independently; the system scales up or down fluidly</span>
          </li>
        </ul>
      </div>

      {/* Core Principles */}
      <div className="space-y-3">
        {/* The Propulsion Principle */}
        <div className="bg-charcoal-light border border-charcoal-lighter rounded-lg overflow-hidden">
          <button
            onClick={() => toggle('propulsion')}
            className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-charcoal-lighter/50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <span className="text-2xl">⚡</span>
              <span className="font-semibold text-slate-100">The Propulsion Principle (GUPP)</span>
            </div>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className={`h-5 w-5 text-slate-400 transition-transform ${expanded === 'propulsion' ? 'rotate-180' : ''}`}
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
          {expanded === 'propulsion' && (
            <div className="px-4 pb-4 text-slate-300 text-sm space-y-3">
              <p>
                <strong className="text-emerald">Gas Town Universal Propulsion Principle:</strong> When an agent finds work, they EXECUTE. No confirmation. No waiting.
              </p>
              <p className="text-slate-400">
                The system is a steam engine. Every agent is a piston, flywheel, or gearbox. The failure mode we're preventing:
              </p>
              <ol className="list-decimal list-inside text-slate-400 space-y-1">
                <li>Agent starts</li>
                <li>Agent announces itself with lengthy preamble</li>
                <li>Agent waits for "go ahead"</li>
                <li>Work sits idle. Throughput drops to zero.</li>
              </ol>
              <p className="text-slate-300 font-medium">
                Startup behavior: Check for work → If work exists → EXECUTE immediately
              </p>
            </div>
          )}
        </div>

        {/* The Capability Ledger */}
        <div className="bg-charcoal-light border border-charcoal-lighter rounded-lg overflow-hidden">
          <button
            onClick={() => toggle('ledger')}
            className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-charcoal-lighter/50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <span className="text-2xl">📜</span>
              <span className="font-semibold text-slate-100">The Capability Ledger</span>
            </div>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className={`h-5 w-5 text-slate-400 transition-transform ${expanded === 'ledger' ? 'rotate-180' : ''}`}
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
          {expanded === 'ledger' && (
            <div className="px-4 pb-4 text-slate-300 text-sm space-y-3">
              <p>
                Every completion is recorded. Every handoff is logged. Every bead closed becomes part of a permanent audit trail.
              </p>
              <ul className="space-y-2 text-slate-400">
                <li><strong className="text-slate-300">Work is visible</strong> - The beads system tracks what actually happened, not claims</li>
                <li><strong className="text-slate-300">Quality accumulates</strong> - Consistent good work builds trajectory over time</li>
                <li><strong className="text-slate-300">Every completion is evidence</strong> - Each success proves autonomous execution works at scale</li>
                <li><strong className="text-slate-300">Reputation is earned</strong> - The ledger is each agent's professional record</li>
              </ul>
            </div>
          )}
        </div>

        {/* Agent Abstraction Tiers */}
        <div className="bg-charcoal-light border border-charcoal-lighter rounded-lg overflow-hidden">
          <button
            onClick={() => toggle('tiers')}
            className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-charcoal-lighter/50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <span className="text-2xl">🏗️</span>
              <span className="font-semibold text-slate-100">Agent Abstraction Tiers</span>
            </div>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className={`h-5 w-5 text-slate-400 transition-transform ${expanded === 'tiers' ? 'rotate-180' : ''}`}
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
          {expanded === 'tiers' && (
            <div className="px-4 pb-4 text-slate-300 text-sm space-y-4">
              <div className="grid gap-3">
                <div className="p-3 bg-charcoal rounded-lg border-l-2 border-emerald">
                  <h4 className="font-semibold text-slate-100 mb-1">Tier 1: Subagents (Direct Buff)</h4>
                  <p className="text-slate-400 text-xs">Spawning specialized child agents to handle focused tasks. Prevents context rot in the parent. Captures ~50% of multi-agent value at ~10% complexity.</p>
                </div>
                <div className="p-3 bg-charcoal rounded-lg border-l-2 border-cyan">
                  <h4 className="font-semibold text-slate-100 mb-1">Tier 2: Metaprompting (Direct Buff)</h4>
                  <p className="text-slate-400 text-xs">Expanding brief task requests into comprehensive prompt files. 3 minutes of prompting can structure a 20-minute task effectively.</p>
                </div>
                <div className="p-3 bg-charcoal rounded-lg border-l-2 border-purple">
                  <h4 className="font-semibold text-slate-100 mb-1">Tier 3: Front-loaded Questioning</h4>
                  <p className="text-slate-400 text-xs">Agents ask clarifying questions at the start. Catches misaligned assumptions before wasted work.</p>
                </div>
                <div className="p-3 bg-charcoal rounded-lg border-l-2 border-slate-500">
                  <h4 className="font-semibold text-slate-100 mb-1">Tier 4: Extended Thinking</h4>
                  <p className="text-slate-400 text-xs">Prompts encouraging longer reasoning chains. Being phased out as models improve at implicit reasoning.</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Role Hierarchy */}
        <div className="bg-charcoal-light border border-charcoal-lighter rounded-lg overflow-hidden">
          <button
            onClick={() => toggle('roles')}
            className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-charcoal-lighter/50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <span className="text-2xl">👑</span>
              <span className="font-semibold text-slate-100">Role Hierarchy</span>
            </div>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className={`h-5 w-5 text-slate-400 transition-transform ${expanded === 'roles' ? 'rotate-180' : ''}`}
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
          {expanded === 'roles' && (
            <div className="px-4 pb-4 text-slate-300 text-sm">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {[
                  { role: 'Mayor', model: 'Opus', desc: 'Primary coordinator' },
                  { role: 'Witness', model: 'Sonnet', desc: 'Monitors activity' },
                  { role: 'Deacon', model: 'Sonnet', desc: 'Agent patrol' },
                  { role: 'Specialist', model: 'Sonnet', desc: 'Implementation' },
                  { role: 'Reviewer', model: 'Opus', desc: 'Quality gate' },
                  { role: 'Refinery', model: 'Sonnet', desc: 'Merge processing' },
                  { role: 'Explorer', model: 'Haiku', desc: 'Reconnaissance' },
                ].map((r) => (
                  <div key={r.role} className="p-2 bg-charcoal rounded text-center">
                    <div className="font-medium text-slate-100">{r.role}</div>
                    <div className="text-xs text-slate-500">{r.model}</div>
                    <div className="text-xs text-slate-400">{r.desc}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Attribution */}
      <div className="mt-6 text-center text-slate-500 text-xs">
        Synthesized from <a href="https://github.com/steveyegge/gastown" className="text-cyan hover:underline">Gas Town</a>, <a href="https://github.com/steveyegge/beads" className="text-cyan hover:underline">Beads</a>, and the Agent Orchestration Blueprint
      </div>
    </section>
  );
}

export default function AboutPage() {
  return (
    <div className="h-full overflow-auto p-4 sm:p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-100 mb-2">About Mayor Orchestrator</h1>
          <p className="text-slate-400">
            A web interface for orchestrating multi-agent Claude Code workflows
          </p>
        </div>

        <EvalHistorySection />
        <PhilosophySection />
      </div>
    </div>
  );
}
