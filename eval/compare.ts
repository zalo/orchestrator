#!/usr/bin/env npx ts-node
/**
 * compare.ts - Compare multiple evaluation runs
 * Usage: npx ts-node eval/compare.ts ./eval-output/run1/ ./eval-output/run2/ [./eval-output/run3/...]
 */

import * as fs from 'fs';
import * as path from 'path';

interface EvalReport {
  meta: {
    workspaceId: string;
    workspaceName: string;
    evalStartTime: string;
    evalEndTime: string;
    generatedAt: string;
  };
  timing: {
    totalElapsedSeconds: number;
    timeToFirstBeadSeconds: number;
    avgAgentSpawnLatencySeconds: number;
    avgTaskDurationMinutes: number;
    mergeQueueWaitMinutes: number;
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
    avgResponseTimeSeconds: number;
    escalationRatio: number;
  };
  hierarchy: {
    maxSpawnDepth: number;
    hierarchicalRatio: number;
    witnessSpawnCount: number;
    delegationSuccessRatio: number;
    agentsByRole: Record<string, number>;
  };
  strengths: string[];
  weaknesses: string[];
}

interface RunData {
  dir: string;
  label: string;
  report: EvalReport;
}

function loadRun(dir: string): RunData {
  const reportPath = path.join(dir, 'report.json');
  const metadataPath = path.join(dir, 'metadata.json');

  if (!fs.existsSync(reportPath)) {
    throw new Error(`No report.json found in ${dir}. Run analyze.ts first.`);
  }

  const report: EvalReport = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));

  let label = path.basename(dir);
  if (fs.existsSync(metadataPath)) {
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
    if (metadata.runLabel) {
      label = metadata.runLabel;
    }
  }

  return { dir, label, report };
}

function formatPercent(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

function formatDelta(current: number, baseline: number, isRatio = false): string {
  const delta = current - baseline;
  if (Math.abs(delta) < 0.001) return '=';

  const sign = delta > 0 ? '+' : '';
  if (isRatio) {
    return `${sign}${(delta * 100).toFixed(1)}%`;
  }
  return `${sign}${delta.toFixed(1)}`;
}

function compare(runs: RunData[]): void {
  const baseline = runs[0];

  console.log('# Evaluation Comparison Report\n');
  console.log(`Comparing ${runs.length} runs:\n`);

  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    const marker = i === 0 ? ' (baseline)' : '';
    console.log(`${i + 1}. **${run.label}**${marker} - ${run.dir}`);
  }

  console.log('\n---\n');

  // Timing comparison
  console.log('## Timing Metrics\n');
  console.log('| Metric | ' + runs.map(r => r.label).join(' | ') + ' |');
  console.log('|--------|' + runs.map(() => '------').join('|') + '|');

  const timingMetrics: [string, keyof EvalReport['timing'], string][] = [
    ['Total Duration', 'totalElapsedSeconds', 'sec'],
    ['Time to First Bead', 'timeToFirstBeadSeconds', 'sec'],
    ['Avg Spawn Latency', 'avgAgentSpawnLatencySeconds', 'sec'],
    ['Avg Task Duration', 'avgTaskDurationMinutes', 'min'],
    ['Merge Queue Wait', 'mergeQueueWaitMinutes', 'min'],
  ];

  for (const [name, key, unit] of timingMetrics) {
    const values = runs.map((r, i) => {
      const val = r.report.timing[key];
      if (i === 0) return `${val.toFixed(1)} ${unit}`;
      const delta = formatDelta(val, baseline.report.timing[key]);
      return `${val.toFixed(1)} ${unit} (${delta})`;
    });
    console.log(`| ${name} | ${values.join(' | ')} |`);
  }

  // Completion comparison
  console.log('\n## Completion Metrics\n');
  console.log('| Metric | ' + runs.map(r => r.label).join(' | ') + ' |');
  console.log('|--------|' + runs.map(() => '------').join('|') + '|');

  const completionMetrics: [string, keyof EvalReport['completion']][] = [
    ['Bead Completion', 'beadCompletionRatio'],
    ['Agent Success', 'agentSuccessRatio'],
    ['First-Pass Success', 'firstPassRatio'],
    ['Test Pass Rate', 'testPassRatio'],
  ];

  for (const [name, key] of completionMetrics) {
    const values = runs.map((r, i) => {
      const val = r.report.completion[key] as number;
      if (i === 0) return formatPercent(val);
      const delta = formatDelta(val, baseline.report.completion[key] as number, true);
      return `${formatPercent(val)} (${delta})`;
    });
    console.log(`| ${name} | ${values.join(' | ')} |`);
  }

  // Coordination comparison
  console.log('\n## Coordination Metrics\n');
  console.log('| Metric | ' + runs.map(r => r.label).join(' | ') + ' |');
  console.log('|--------|' + runs.map(() => '------').join('|') + '|');

  console.log(`| Total Messages | ${runs.map((r, i) => {
    const val = r.report.coordination.totalMessages;
    if (i === 0) return val;
    return `${val} (${formatDelta(val, baseline.report.coordination.totalMessages)})`;
  }).join(' | ')} |`);

  console.log(`| Blocker Ratio | ${runs.map((r, i) => {
    const val = r.report.coordination.blockerRatio;
    if (i === 0) return formatPercent(val);
    return `${formatPercent(val)} (${formatDelta(val, baseline.report.coordination.blockerRatio, true)})`;
  }).join(' | ')} |`);

  console.log(`| Escalation Ratio | ${runs.map((r, i) => {
    const val = r.report.coordination.escalationRatio;
    if (i === 0) return formatPercent(val);
    return `${formatPercent(val)} (${formatDelta(val, baseline.report.coordination.escalationRatio, true)})`;
  }).join(' | ')} |`);

  // Hierarchy comparison
  console.log('\n## Hierarchy Metrics\n');
  console.log('| Metric | ' + runs.map(r => r.label).join(' | ') + ' |');
  console.log('|--------|' + runs.map(() => '------').join('|') + '|');

  console.log(`| Max Spawn Depth | ${runs.map(r => r.report.hierarchy.maxSpawnDepth).join(' | ')} |`);
  console.log(`| Delegation Success | ${runs.map((r, i) => {
    const val = r.report.hierarchy.delegationSuccessRatio;
    if (i === 0) return formatPercent(val);
    return `${formatPercent(val)} (${formatDelta(val, baseline.report.hierarchy.delegationSuccessRatio, true)})`;
  }).join(' | ')} |`);

  // Roles used
  console.log('\n## Roles Used\n');
  console.log('| Role | ' + runs.map(r => r.label).join(' | ') + ' |');
  console.log('|------|' + runs.map(() => '------').join('|') + '|');

  const allRoles = new Set<string>();
  runs.forEach(r => Object.keys(r.report.hierarchy.agentsByRole).forEach(role => allRoles.add(role)));

  for (const role of Array.from(allRoles).sort()) {
    const counts = runs.map(r => r.report.hierarchy.agentsByRole[role] || 0);
    console.log(`| ${role} | ${counts.join(' | ')} |`);
  }

  // Summary
  console.log('\n## Summary\n');

  console.log('### Improvements (higher is better)\n');
  const improvements: string[] = [];
  const regressions: string[] = [];

  for (let i = 1; i < runs.length; i++) {
    const run = runs[i];
    const b = baseline.report;
    const r = run.report;

    if (r.completion.beadCompletionRatio > b.completion.beadCompletionRatio) {
      improvements.push(`${run.label}: Bead completion improved ${formatDelta(r.completion.beadCompletionRatio, b.completion.beadCompletionRatio, true)}`);
    } else if (r.completion.beadCompletionRatio < b.completion.beadCompletionRatio) {
      regressions.push(`${run.label}: Bead completion regressed ${formatDelta(r.completion.beadCompletionRatio, b.completion.beadCompletionRatio, true)}`);
    }

    if (r.completion.firstPassRatio > b.completion.firstPassRatio) {
      improvements.push(`${run.label}: First-pass success improved ${formatDelta(r.completion.firstPassRatio, b.completion.firstPassRatio, true)}`);
    }

    if (r.coordination.blockerRatio < b.coordination.blockerRatio) {
      improvements.push(`${run.label}: Blocker ratio decreased ${formatDelta(r.coordination.blockerRatio, b.coordination.blockerRatio, true)}`);
    } else if (r.coordination.blockerRatio > b.coordination.blockerRatio) {
      regressions.push(`${run.label}: Blocker ratio increased ${formatDelta(r.coordination.blockerRatio, b.coordination.blockerRatio, true)}`);
    }

    if (r.hierarchy.delegationSuccessRatio > b.hierarchy.delegationSuccessRatio) {
      improvements.push(`${run.label}: Delegation success improved ${formatDelta(r.hierarchy.delegationSuccessRatio, b.hierarchy.delegationSuccessRatio, true)}`);
    }
  }

  if (improvements.length > 0) {
    improvements.forEach(i => console.log(`- ${i}`));
  } else {
    console.log('- No significant improvements detected');
  }

  console.log('\n### Regressions (needs attention)\n');
  if (regressions.length > 0) {
    regressions.forEach(r => console.log(`- ${r}`));
  } else {
    console.log('- No regressions detected');
  }
}

// CLI Entry Point
const args = process.argv.slice(2);

if (args.length < 2) {
  console.log('Usage: npx ts-node eval/compare.ts <run1-dir> <run2-dir> [run3-dir...]');
  console.log('');
  console.log('Example:');
  console.log('  npx ts-node eval/compare.ts ./eval-output/20260112_baseline ./eval-output/20260112_after-review-gate');
  console.log('');
  console.log('The first run is used as the baseline for comparison.');
  process.exit(1);
}

try {
  const runs = args.map(loadRun);
  compare(runs);
} catch (e) {
  console.error('Error:', (e as Error).message);
  process.exit(1);
}
