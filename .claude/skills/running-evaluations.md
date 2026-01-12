# Running Agent Orchestration Evaluations

## Evaluation Goal

**Objective**: Measure how effectively the agent orchestration system uses its parallel roles to complete a coordinated software development task.

**What We're Testing**:
1. **Role Coverage** - Are all 6 roles (specialist, reviewer, explorer, witness, refinery, deacon) being utilized?
2. **Hierarchical Delegation** - Do witnesses successfully spawn and manage specialists?
3. **Coordination Quality** - Do agents communicate effectively via messages?
4. **Work Tracking** - Are beads being claimed, updated, and completed?
5. **Quality Gates** - Does the review gate prevent bad merges?
6. **Merge Queue** - Are conflicts detected and handled correctly?

**Success Criteria**:
- All 6 roles exercised
- Hierarchical delegation working (parentAgentId chains)
- First-pass success rate > 80%
- Bead completion rate > 80%
- No merges without review approval

## Overview

This skill documents how to run evaluations of the agent orchestration system to measure how effectively agents use their parallel roles.

## Prerequisites

- Orchestrator server running (`./dev.sh` or `npm run dev` in server/)
- A test project to build (or create one)

## Quick Start

```bash
# 1. Create a test workspace
curl -X POST http://localhost:3001/api/workspaces \
  -H "Content-Type: application/json" \
  -d '{"name": "eval-project", "workingDirectory": "/path/to/test/project"}'

# 2. Start the workspace (spawns Mayor)
curl -X POST http://localhost:3001/api/workspaces/{WORKSPACE_ID}/start

# 3. Send evaluation task to Mayor
curl -X POST http://localhost:3001/api/messages \
  -H "Content-Type: application/json" \
  -d '{
    "workspaceId": "{WORKSPACE_ID}",
    "from": "orchestrator",
    "to": "mayor",
    "type": "action_required",
    "content": "EVALUATION RUN: Build [description]. Deploy full agent hierarchy with all roles."
  }'

# 4. Prompt Mayor to check messages
tmux -S /tmp/orchestrator-tmux.sock send-keys -t {workspace}-mayor \
  "Check your messages and begin the evaluation task." C-m

# 5. Monitor progress
curl "http://localhost:3001/api/agents?workspaceId={WORKSPACE_ID}"
curl "http://localhost:3001/api/progress?workspaceId={WORKSPACE_ID}"
curl "http://localhost:3001/api/messages?workspaceId={WORKSPACE_ID}"

# 6. When complete, stop workspace (saves logs)
curl -X POST http://localhost:3001/api/workspaces/{WORKSPACE_ID}/stop

# 7. Collect and analyze logs (with optional run label)
./eval/collect-logs.sh {WORKSPACE_ID} baseline
cd server && npx tsx ../eval/analyze.ts ../eval-output/{TIMESTAMP}_baseline/

# 8. Run another evaluation after making changes
./eval/collect-logs.sh {WORKSPACE_ID} after-review-gate
cd server && npx tsx ../eval/analyze.ts ../eval-output/{TIMESTAMP}_after-review-gate/

# 9. Compare runs
cd server && npx tsx ../eval/compare.ts ../eval-output/{RUN1}/ ../eval-output/{RUN2}/
```

## Evaluation Infrastructure

### Files

| File | Purpose |
|------|---------|
| `eval/collect-logs.sh` | Collects all API data and terminal logs |
| `eval/analyze.ts` | Computes metrics and generates report |
| `eval/compare.ts` | Compares multiple evaluation runs |
| `eval/metrics.ts` | Type definitions for evaluation metrics |
| `eval/intervention-log.md` | Manual intervention tracking template |

### Output Directory

After running `collect-logs.sh`, data is saved to:
```
eval-output/{TIMESTAMP}_{LABEL}/   # e.g., 20260112_143022_baseline/
  ├── agents.json        # All agents
  ├── beads.json         # Work items
  ├── messages.json      # Inter-agent messages
  ├── progress.json      # Progress entries
  ├── merge-queue.json   # Merge requests
  ├── stats.json         # Summary statistics
  ├── workspace.json     # Workspace info
  ├── terminal-logs/     # Captured tmux session output
  │   └── {agent}-{timestamp}.log
  ├── prompts/           # Agent prompts
  ├── report.json        # Computed metrics (after analysis)
  └── report.md          # Human-readable report
```

## Agent Hierarchy for Evaluation

Deploy this hierarchy to exercise all roles:

```
MAYOR (Opus)
    ├── EXPLORER (Haiku) - Scout codebase first
    ├── WITNESS (Sonnet) - Monitor specialists, can spawn
    │       ├── SPECIALIST (Sonnet) - Implementation
    │       ├── SPECIALIST (Sonnet) - Implementation
    │       └── SPECIALIST (Haiku) - Simple tasks
    ├── WITNESS (Sonnet) - Another domain
    │       └── SPECIALIST (Sonnet) - Implementation
    ├── DEACON (Sonnet) - Monitor agent health
    ├── REVIEWER (Sonnet) - Code review gate
    └── REFINERY (Sonnet) - Process merge queue
```

## Metrics Collected

### Timing (seconds/minutes)
- `totalElapsedSeconds` - Wall clock duration
- `timeToFirstBeadSeconds` - Time to create first work item
- `avgAgentSpawnLatencySeconds` - Spawn to working latency
- `avgTaskDurationMinutes` - Mean task completion time
- `mergeQueueWaitMinutes` - Mean MR queue time

### Completion (ratios 0.0-1.0)
- `beadCompletionRatio` - done / total beads
- `agentSuccessRatio` - Successful agents / total
- `firstPassRatio` - Tasks without blockers / total
- `testPassRatio` - Passed tests / required tests

### Coordination
- `totalMessages` - Inter-agent message count
- `messagesPerAgent` - Mean messages per agent
- `blockerRatio` - Blocker messages / total
- `escalationRatio` - Messages to mayor / total

### Hierarchy
- `maxSpawnDepth` - Deepest parent chain
- `hierarchicalRatio` - Agents with parents / total
- `witnessSpawnCount` - Mean specialists per witness
- `delegationSuccessRatio` - Specialist completions / spawns

## Standard Evaluation Task (Repeatable)

For consistent benchmarking, use this standard task:

### Documentation Portal

**Project**: Build a technical documentation portal with React + TypeScript + Tailwind

**Features to Implement**:
1. Homepage with hero section and feature cards
2. Documentation pages with markdown rendering
3. Search functionality with keyboard shortcuts (Ctrl+K)
4. Dark/light theme toggle with localStorage persistence
5. API reference section with code examples

**Setup**:
```bash
# Create project scaffold
mkdir -p /path/to/eval-docportal
cd /path/to/eval-docportal
npm create vite@latest . -- --template react-ts
npm install
npm install tailwindcss @tailwindcss/typography
mkdir -p src/{pages,components,hooks,contexts,styles,data}
git init && git add . && git commit -m "Initial scaffold"
```

**CLAUDE.md for test project**:
```markdown
# Documentation Portal - Evaluation Project

## Build Commands
- npm run dev - Start dev server
- npm run build - Production build

## Structure
- src/pages/ - Page components
- src/components/ - UI components
- src/hooks/ - Custom hooks
- src/contexts/ - React contexts
- src/data/ - Static content

## Required Features
1. Homepage with hero and feature cards
2. Docs pages with sidebar navigation
3. Search with Ctrl+K shortcut
4. Theme toggle (dark/light)
5. API reference section
```

**Why This Task**:
- Requires 4 parallel specialists (homepage, docs, search, theme)
- Has clear deliverables for review
- Multiple files = potential merge conflicts
- Web UI enables Playwright testing
- ~15 minute target per specialist

### Task Message to Mayor

Send this exact message to start a consistent evaluation:

```
EVALUATION RUN: Build the documentation portal exercising ALL agent roles.

Deploy this hierarchy:
1. EXPLORER (haiku) project-scout - Analyze codebase first
2. WITNESS (sonnet) frontend-witness - Spawn specialists for homepage, docs, search
3. WITNESS (sonnet) styling-witness - Spawn specialist for theme
4. DEACON (sonnet) agent-patrol - Monitor agent health
5. REVIEWER (sonnet) code-reviewer - Review completed work
6. REFINERY (sonnet) merge-processor - Process merge queue

All agents must:
- Claim beads before starting work
- Log progress every 3-5 minutes via /api/progress
- Send completion messages when done
- Submit to merge queue before completion
- Wait for review approval before merge

This is an evaluation run - all logs will be analyzed.
```

## Alternative Test Projects

For variety, these also work well:

1. **CLI Tool** - Commands, help system, config parsing
2. **API Server** - Multiple endpoints, auth, validation
3. **Component Library** - Multiple UI components, themes, storybook

Requirements for any evaluation project:
- Enough scope for 3-4 specialists working in parallel
- Clear deliverables for reviewer to check
- Potential for merge conflicts (shared files like App.tsx)
- Testable output (web UI or CLI)

## Tracking Manual Interventions

Create `eval/intervention-log.md` for each run:

```markdown
# Manual Intervention Log - [DATE]

## Interventions
### 1. [Timestamp] [Issue]
**Intervention**: What you did
**Root Cause**: Why it was needed
**Improvement**: Suggested fix

## Issues Discovered
### [Issue Name]
**Observed**: When
**Impact**: Effect
**Improvement Needed**: Fix

## Final Results
[Summary metrics and findings]
```

## Interpreting Results

### Good Signs
- First-pass success > 80%
- Delegation success > 90%
- Escalation ratio < 30%
- All roles exercised

### Warning Signs
- Bead completion 0% - Agents not using bead tracking
- High blocker ratio > 30% - Coordination issues
- High escalation ratio > 70% - Hierarchy underutilized
- Build errors merged - Review gate not enforced

## Comparing Multiple Runs

Use the comparison tool to track improvements across evaluation runs.

### Workflow for A/B Comparison

```bash
# 1. Run baseline evaluation
./eval/collect-logs.sh {WORKSPACE_ID} baseline
cd server && npx tsx ../eval/analyze.ts ../eval-output/20260112_143022_baseline/

# 2. Make changes to prompts, roles, or system

# 3. Run evaluation again (same or fresh workspace)
./eval/collect-logs.sh {WORKSPACE_ID} after-changes
cd server && npx tsx ../eval/analyze.ts ../eval-output/20260112_150000_after-changes/

# 4. Compare runs
cd server && npx tsx ../eval/compare.ts \
  ../eval-output/20260112_143022_baseline/ \
  ../eval-output/20260112_150000_after-changes/
```

### Comparison Output

The comparison tool shows:
- **Timing metrics** with deltas (faster = better)
- **Completion metrics** with percentage changes (higher = better)
- **Coordination metrics** (lower blocker/escalation = better)
- **Hierarchy metrics** (higher delegation success = better)
- **Roles used** across each run
- **Summary** of improvements and regressions

### Example Comparison

```
## Completion Metrics

| Metric | baseline | after-review-gate |
|--------|----------|-------------------|
| Bead Completion | 0.0% | 80.0% (+80.0%) |
| First-Pass Success | 100.0% | 100.0% (=) |

## Summary

### Improvements (higher is better)
- after-review-gate: Bead completion improved +80.0%
- after-review-gate: Delegation success improved +15.0%

### Regressions (needs attention)
- No regressions detected
```

### Run Labels

Use descriptive labels for easy identification:
- `baseline` - Initial system state
- `after-review-gate` - After implementing review enforcement
- `v2-prompts` - Testing new prompt templates
- `opus-vs-sonnet` - Model comparison

## Improvements Made (Jan 2026)

Based on evaluation findings:

1. **Review Gate** - MRs now require `reviewStatus: approved` and `buildStatus: passed`
2. **Bead Tracking** - Sub-agent prompts now require claiming beads
3. **Role Instructions** - Reviewer and Refinery have specific gate instructions
4. **Tmux Fix** - Changed `Enter` to `C-m` for reliability

## Tags
evaluation, testing, metrics, analysis, quality, comparison, benchmarking
