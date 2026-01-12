# Agent Orchestration Blueprint
## A Comprehensive Guide to Multi-Agent Systems for Claude Code

*Synthesized from leading orchestration solutions: Beads, Gas Town, CC Mirror, Claude Flow, Claude Squad, Conductor, and more.*

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Core Principles](#core-principles)
3. [Agent Abstraction Tiers](#agent-abstraction-tiers)
4. [Agent Roles & Hierarchy](#agent-roles--hierarchy)
5. [Persistent Memory & Context](#persistent-memory--context)
6. [Work Tracking with Beads](#work-tracking-with-beads)
7. [Git Worktrees for Parallelization](#git-worktrees-for-parallelization)
8. [Merge Queue Protocols](#merge-queue-protocols)
9. [Hierarchical Delegation](#hierarchical-delegation)
10. [Knowledge Gathering & Bootstrap](#knowledge-gathering--bootstrap)
11. [Context Management & Compaction](#context-management--compaction)
12. [Communication Protocols](#communication-protocols)
13. [Building & Testing Infrastructure](#building--testing-infrastructure)
14. [Tool Comparison Matrix](#tool-comparison-matrix)
15. [Implementation Roadmap](#implementation-roadmap)

---

## Executive Summary

The modern approach to scaling AI coding agents centers on three fundamental innovations:

1. **Addressable Work Items** - Every task gets an ID, dependencies, and audit trail (not scattered markdown)
2. **Workspace Isolation** - Git worktrees provide each agent with independent file state
3. **Graceful Degradation** - Every component works independently; the system scales up or down fluidly

The key insight from Steve Yegge's work: **"Beads isn't for future planning or past documentation. It magnifies current work."** The problem isn't helping agents remember the past—it's giving them the right context for the present.

---

## Core Principles

### The "50 First Dates" Problem

Coding agents wake up with no memory of what happened yesterday. Each session lasts roughly 10-15 minutes before context becomes stale or overloaded. The solution is **external memory** stored in Git—addressable, queryable, and versioned.

### Atomic Units of Work

Work should be decomposed into **beads**—small, addressable units with:
- Unique ID
- Description
- Status (todo, in_progress, done, blocked)
- Dependencies (blocks/blocked-by)
- Assignee (agent or human)
- Audit trail

### Progressive Disclosure

Don't front-load agents with everything they could possibly need. Instead:
- Tell them **how to find** information
- Let them query for context **on demand**
- Keep active context focused on the current task

### Graceful Degradation

Every worker should function independently. The system should work:
- With full orchestration (20+ agents)
- With partial orchestration (a few agents)
- With no orchestration (single Claude Code session)
- With or without tmux/terminal multiplexers

### The Propulsion Principle (GUPP)

**Gas Town Universal Propulsion Principle**: When an agent finds work, they EXECUTE. No confirmation. No waiting.

The system is a steam engine. Every agent is a piston, flywheel, or gearbox. The failure mode we're preventing:
1. Agent starts
2. Agent announces itself with lengthy preamble
3. Agent waits for "go ahead"
4. Work sits idle. Throughput drops to zero.

**Startup behavior for all agents:**
1. Check for hooked/assigned work
2. If work exists → EXECUTE immediately
3. If nothing assigned → Check messages, then wait

This principle applies recursively: sub-agents spawned by witnesses should also execute immediately.

### The Capability Ledger

Every completion is recorded. Every handoff is logged. Every bead closed becomes part of a permanent audit trail.

**Why this matters:**
1. **Work is visible** - The beads system tracks what actually happened, not claims
2. **Quality accumulates** - Consistent good work builds trajectory over time
3. **Every completion is evidence** - Each success proves autonomous execution works at scale
4. **Reputation is earned** - The ledger is each agent's professional record

This isn't just about the current task—it's about building demonstrated capability over time.

---

## Agent Abstraction Tiers

Understanding which agent abstractions provide the most value helps prioritize implementation efforts. Based on practitioner experience, here's a tiered ranking from most to least effective:

### Tier 1: Subagents (Direct Buff)

**What it is:** Spawning specialized child agents to handle focused tasks, preventing context rot in the parent.

**Why it works:**
- Prevents context window degradation from accumulated tool outputs
- Enables ad-hoc specialization without predefined roles
- Scales naturally—as agents get smarter, they allocate subagents more effectively
- Bitter lesson adjacent: simple mechanism that compounds with capability improvements

**Implementation guidance:** "Use subagents when needed" is sufficient. No complex configuration required.

**Trade-off:** Delivers roughly half the value of full multi-agent orchestration for dramatically less complexity. Start here before adding hierarchy.

### Subagent Usage by Role

**Critical distinction:** There are two types of agent spawning:
1. **Native subagents** (Task tool) - Temporary, session-scoped, any agent can use
2. **Persistent agents** (Orchestrator API) - Long-lived, role'd, only Mayor/Witness/Deacon can spawn

| Role | Can Spawn Persistent Agents? | Native Subagent Usage |
|------|------------------------------|----------------------|
| **Mayor** | Yes - be LIBERAL | Delegate to persistent agents instead |
| **Witness** | Yes | Moderate - spawn specialists for work |
| **Deacon** | Yes | Moderate - spawn as needed |
| **Specialist** | No | **HEAVY** - compensate by using Task tool liberally |
| **Reviewer** | No | **HEAVY** - spawn explorers for deep dives |
| **Explorer** | No | Moderate - focused reconnaissance |
| **Refinery** | No | **HEAVY** - parallelize processing |

**For Mayor:** Be liberal with hierarchical agent allocation. Your job is coordination, not implementation. When work comes in:
- Spawn persistent specialists for implementation tasks
- Spawn witnesses to monitor complex parallel work
- Use the full role hierarchy—that's what it's for
- Reserve native subagents for quick queries you need answered immediately

**For non-spawning roles (Specialists, Reviewers, Refinery):** You cannot create persistent workers, so compensate by using Claude's native Task tool aggressively:
- Spawn explore subagents for codebase reconnaissance
- Spawn research subagents for documentation lookups
- Spawn verification subagents to check your work
- Don't let context rot—offload anything that doesn't need your direct attention

The goal: **Every agent should be delegating constantly.** Mayor delegates to persistent agents. Everyone else delegates to native subagents. Work flows downward; only results and blockers flow up.

### Tier 2: Metaprompting (Direct Buff)

**What it is:** Expanding brief task requests into comprehensive prompt files with context, constraints, and scratchpad space.

**Why it works:**
- 3 minutes of prompting can structure a 20-minute task effectively
- Sanity-checks assumptions before execution begins
- Improves stability by making implicit requirements explicit
- Creates reusable patterns for similar tasks

**Implementation guidance:** Create a `/metaprompt` skill or command that:
1. Takes a brief task description
2. Asks clarifying questions
3. Generates a structured prompt with:
   - Context summary
   - Success criteria
   - Constraints and boundaries
   - Scratchpad for working notes
4. Returns plan for review before execution

**Trade-off:** You should review the generated metaprompt, but even without review it improves stability.

### Tier 3: Front-loaded Questioning (Conditional Buff)

**What it is:** Agents ask clarifying questions at the start rather than making assumptions.

**Why it works:**
- Catches misaligned assumptions before wasted work
- Surfaces ambiguity in requirements early
- Builds shared understanding

**Limitations:**
- Requires user engagement in plan mode
- Non-transparent: hard to tell if silence means understanding, disabled feature, or no questions
- Can slow down obvious tasks unnecessarily

**Implementation guidance:** Use plan mode with explicit question prompts. Make it clear when the agent has no questions vs. skipped asking.

### Tier 4: Extended Thinking (Diminishing Returns)

**What it is:** Prompts that encourage longer reasoning chains before action.

**Trade-offs:**
- Easy to add, generally helpful
- Non-transparent: you can't see the reasoning
- Being phased out as models improve at implicit reasoning
- May become unnecessary as base capabilities advance

**Implementation guidance:** Include when helpful, but don't depend on it. Monitor whether it actually improves outcomes in your specific use cases.

### The Complexity vs. Value Curve

```
Value
  │
  │     ┌─ Full multi-agent orchestration (Gas Town, etc.)
  │    /
  │   /
  │  ╱  ┌─ Subagents alone (this level!)
  │ ╱  /
  │╱  /
  ├──/───────────────────────────────────
  │ │
  │ │
  └─┴────────────────────────────────────→ Complexity

Key insight: Subagents alone capture ~50% of multi-agent value
at ~10% of the complexity. Start simple, add complexity only
when you've exhausted the value from simpler abstractions.
```

### Practical Implications

1. **For new projects:** Start with subagents + metaprompting. Don't over-engineer.
2. **For scaling up:** Add hierarchy (Gas Town roles) only after subagents hit limits.
3. **For stability:** Front-loaded questioning helps but requires user participation.
4. **For transparency:** Document when agents choose NOT to ask questions.

---

## Agent Roles & Hierarchy

### Gas Town's Seven Roles Model

Steve Yegge's Gas Town defines a sophisticated role hierarchy:

| Role | Function | Model Recommendation |
|------|----------|---------------------|
| **Mayor** | Primary coordinator. Full workspace context. Entry point for all requests. | Opus |
| **Crew** | Per-rig coding agents with long-lived identities. You choose their names. | Sonnet |
| **Witness** | Monitors and records activity across all agents | Sonnet |
| **Polecats** | Scout agents for exploration and reconnaissance | Haiku |
| **Refinery** | Processes raw output into refined deliverables | Sonnet |
| **Deacon** | Handles communications and documentation | Sonnet |
| **Dogs** | Guard agents for quality checks and reviews | Opus |

### Simplified Three-Tier Model

For smaller deployments:

```
┌─────────────────────────────────────────────────┐
│                 ORCHESTRATOR                     │
│    (Conductor/Mayor - Full context, planning)    │
└─────────────────────┬───────────────────────────┘
                      │
       ┌──────────────┼──────────────┐
       │              │              │
       ▼              ▼              ▼
┌─────────────┐ ┌─────────────┐ ┌─────────────┐
│  SPECIALIST │ │  SPECIALIST │ │  SPECIALIST │
│  (Frontend) │ │  (Backend)  │ │   (Tests)   │
└─────────────┘ └─────────────┘ └─────────────┘
       │              │              │
       └──────────────┼──────────────┘
                      │
                      ▼
            ┌─────────────────┐
            │    REVIEWER     │
            │ (Quality gate)  │
            └─────────────────┘
```

### Model Allocation by Cognitive Demand

- **Opus**: Strategic roles, complex planning, final review, orchestration
- **Sonnet**: Implementation, standard coding tasks, documentation
- **Haiku**: Quick lookups, file discovery, simple queries, status checks

---

## Persistent Memory & Context

### The Three Pillars of Project Context

1. **CLAUDE.md** - Universal conventions and standards
   - Keep it minimal (instructions that apply to EVERY session)
   - Reference paths to deeper documentation
   - Build commands, test commands, project structure

2. **Skills** - On-demand domain expertise
   - Loaded when needed, not always
   - Bundle utility scripts for zero-context execution
   - Metadata loaded at startup; full content read on demand

3. **Beads/Issue Tracker** - External working memory
   - Current tasks with dependencies
   - Audit trail of completed work
   - Queryable by any agent at any time

### CLAUDE.md Best Practices

```markdown
# Project: MyApp

## Build Commands
- `npm run build` - Production build
- `npm test` - Run tests
- `npm run lint` - Lint code

## Architecture
See docs/ARCHITECTURE.md for detailed system design.

## Conventions
- Use TypeScript strict mode
- Component files: PascalCase
- Utility files: kebab-case
- Always run tests before committing

## Finding Information
- API documentation: docs/api/
- Component library: src/components/README.md
- Database schema: prisma/schema.prisma
```

### Agent Memory Protocol

Create `.claude/agent-memory.md` for cross-session coordination:

```markdown
# Agent Memory Protocol

## Active Work Registry
| Agent | Task | Status | Branch | Last Update |
|-------|------|--------|--------|-------------|
| auth-agent | Implement OAuth | in_progress | feat/oauth | 2025-01-11 |
| ui-agent | Dashboard redesign | blocked | feat/dashboard | 2025-01-11 |

## Completed Today
- [x] Database migration for user preferences (db-agent)
- [x] API endpoint for /users/settings (api-agent)

## Blocking Issues
- Dashboard redesign blocked on OAuth completion
```

---

## Work Tracking with Beads

### Installation & Setup

```bash
# Install Beads CLI
brew tap steveyegge/beads
brew install beads

# Or with Bun
bun add beads

# Initialize in project
bd init
```

### Bead Structure

```json
{
  "id": "BEAD-001",
  "title": "Implement user authentication",
  "description": "Add OAuth2 flow with Google provider",
  "status": "in_progress",
  "priority": 1,
  "assignee": "auth-agent",
  "blocks": ["BEAD-002", "BEAD-003"],
  "blocked_by": [],
  "created": "2025-01-11T10:00:00Z",
  "updated": "2025-01-11T14:30:00Z",
  "audit": [
    {"time": "...", "action": "created", "by": "human"},
    {"time": "...", "action": "assigned", "to": "auth-agent"},
    {"time": "...", "action": "status_change", "from": "todo", "to": "in_progress"}
  ]
}
```

### Best Practices

1. **One Task Per Session** - Complete a bead, kill the process, start fresh
2. **File Beads Proactively** - Ask agents to file beads for any work >2 minutes
3. **Code Reviews Generate Beads** - Much more actionable than prose feedback
4. **Query Before Starting** - Agent should check `bd next` for highest priority unblocked work
5. **Update on Completion** - Always mark beads done before session ends

### Beads CLI Commands

```bash
bd init                    # Initialize beads in project
bd add "Task description"  # Create new bead
bd list                    # Show all beads
bd next                    # Get highest priority unblocked bead
bd start BEAD-001          # Mark bead in progress
bd done BEAD-001           # Mark bead complete
bd block BEAD-001 BEAD-002 # BEAD-001 blocks BEAD-002
bd query "auth"            # Search beads
```

---

## Git Worktrees for Parallelization

### Why Worktrees?

Each worktree has independent file state. Changes in one worktree don't affect others. This prevents agents from interfering with each other or overwriting each other's work.

### Setup Workflow

```bash
# Create worktrees for parallel agents
git worktree add ../project-auth feat/auth
git worktree add ../project-dashboard feat/dashboard
git worktree add ../project-api feat/api

# List worktrees
git worktree list

# Remove when done
git worktree remove ../project-auth
```

### Directory Structure

```
~/projects/
├── myapp/                    # Main worktree (main branch)
│   ├── .git/                 # Shared git directory
│   ├── src/
│   └── ...
├── myapp-auth/               # Worktree for auth agent
│   ├── src/
│   └── ...
├── myapp-dashboard/          # Worktree for dashboard agent
│   ├── src/
│   └── ...
└── myapp-api/                # Worktree for API agent
    ├── src/
    └── ...
```

### Launching Parallel Agents

**With Claude Squad:**
```bash
# Install claude-squad
brew install smtg-ai/tap/claude-squad

# Launch multiple agents
cs new auth-agent --worktree ../project-auth
cs new dashboard-agent --worktree ../project-dashboard
cs list
```

**With Conductor:**
```bash
# Conductor creates worktrees automatically
conductor launch --agents 3 --tasks tasks.json
```

**With Crystal:**
```bash
# Crystal provides GUI for managing parallel sessions
crystal
# Then create sessions from the UI
```

### Critical Rule: File Ownership

**Never have two agents work on the same file.** If they do:
- They'll overwrite each other's edits
- They'll corrupt each other's context
- Merge conflicts become nightmares

**Solution: Clear task boundaries**
- Agent A owns `src/auth/**`
- Agent B owns `src/dashboard/**`
- Agent C owns `src/api/**`

---

## Merge Queue Protocols

### Sequential Merge Strategy

```
1. Agent completes work on branch
2. Agent creates PR
3. PR enters merge queue
4. CI runs on rebased branch
5. If CI passes, merge to main
6. Other agents rebase their branches
7. Next PR in queue
```

### Merge Queue Manager Role

Designate an agent or process to manage merges:

```markdown
## Merge Queue Protocol

### On PR Completion:
1. Notify merge-manager: "PR #123 ready for review"
2. Wait for merge-manager approval
3. Do NOT merge directly

### Merge Manager Actions:
1. Review PR for conflicts
2. Run CI on rebased branch
3. Check for logical conflicts with other pending PRs
4. Merge or request changes
5. Notify other agents to rebase
```

### Handling Merge Conflicts

```markdown
## Conflict Resolution Protocol

### When Conflict Detected:
1. Stop both conflicting agents
2. Human reviews conflicts
3. Determine which changes take priority
4. Apply resolution
5. Resume lower-priority agent with context:
   "The following files were modified by another agent: [list]
    Your version was superseded. Please review and continue."
```

### Automated Rebase Notifications

```bash
# progress.md serves as shared log
# Each agent appends what it did

## Progress Log

### 2025-01-11 14:30 - auth-agent
- Completed OAuth implementation
- Merged to main
- **ACTION REQUIRED**: dashboard-agent, api-agent please rebase

### 2025-01-11 14:45 - dashboard-agent
- Rebased on main
- Continuing dashboard work
```

---

## Hierarchical Delegation

### Enabling True Hierarchy

Claude Code's native subagent system is flat—subagents cannot spawn other subagents. However, with external orchestration (like Mayor Orchestrator), true hierarchy is possible.

**Key enablers:**
- `parentAgentId` field tracks who spawned whom
- `canSpawnAgents` permission controls delegation rights
- Sub-agents report to their parent, not directly to mayor
- Parent agents handle completions and blockers from their children

**Roles with spawn permission:**
- **Mayor** - Always can spawn
- **Witness** - Monitors workers, can spawn specialists
- **Deacon** - Keeps agents alive, can spawn as needed

**Example: Witness spawning a specialist:**
```bash
curl -X POST http://localhost:3001/api/agents/spawn \
  -H "Content-Type: application/json" \
  -d '{
    "workspaceId": "...",
    "name": "auth-specialist",
    "role": "specialist",
    "model": "sonnet",
    "parentAgentId": "<witness-id>",
    "prompt": "Implement OAuth authentication..."
  }'
```

### The Manager-Worker Pattern

```
┌─────────────────────────────────────────┐
│            ORCHESTRATOR                  │
│    (Full project context, planning)      │
│    Tools: Plan, Delegate, Review         │
└──────────────────┬──────────────────────┘
                   │
     ┌─────────────┼─────────────┐
     │             │             │
     ▼             ▼             ▼
┌─────────┐  ┌─────────┐  ┌─────────┐
│ MANAGER │  │ MANAGER │  │ MANAGER │
│ Backend │  │Frontend │  │  DevOps │
└────┬────┘  └────┬────┘  └────┬────┘
     │            │            │
   ┌─┴─┐       ┌──┴──┐       ┌─┴─┐
   │   │       │     │       │   │
   ▼   ▼       ▼     ▼       ▼   ▼
  [W] [W]     [W]   [W]     [W] [W]
Workers     Workers       Workers
```

### Implementation with Claude Flow

```bash
# Install Claude Flow
npm install claude-flow@v3alpha

# Define swarm configuration
cat > swarm.yaml << 'EOF'
swarm:
  name: project-alpha
  queen:
    model: opus
    role: orchestrator
  workers:
    - name: backend-lead
      model: sonnet
      workers:
        - name: api-worker-1
          model: sonnet
        - name: db-worker
          model: sonnet
    - name: frontend-lead
      model: sonnet
      workers:
        - name: ui-worker-1
          model: sonnet
        - name: ui-worker-2
          model: sonnet
EOF

# Launch swarm
claude-flow swarm start --config swarm.yaml
```

### Custom Subagent Definitions

Create `.claude/agents/` directory with agent definitions:

```markdown
<!-- .claude/agents/backend-specialist.md -->
# Backend Specialist Agent

## Role
You are a backend development specialist focused on API design, database operations, and server-side logic.

## Capabilities
- Design and implement REST/GraphQL APIs
- Write database migrations and queries
- Implement authentication and authorization
- Write integration tests

## Constraints
- Do not modify frontend code
- Always include error handling
- Follow OpenAPI specification for API design
- Write tests for all new endpoints

## Tools Available
- Read, Write, Edit for backend files
- Bash for running tests and migrations
- Grep for code search

## Reporting
After completing each task, update `.claude/progress.md` with:
- What was completed
- Files modified
- Any blocking issues
- Next steps for dependent agents
```

---

## Knowledge Gathering & Bootstrap

### Initial Project Exploration

Before any work begins, an orchestrator should gather comprehensive project knowledge:

```markdown
## Bootstrap Protocol

### Phase 1: Structure Discovery
1. Run `tree -L 3` to understand directory structure
2. Read package.json / Cargo.toml / go.mod for dependencies
3. Identify entry points (main files, index files)
4. Map the architecture layers

### Phase 2: Pattern Recognition
1. Find existing tests to understand testing patterns
2. Identify coding conventions from existing code
3. Locate configuration files
4. Find documentation

### Phase 3: Knowledge Compilation
1. Generate ARCHITECTURE.md with findings
2. Update CLAUDE.md with project-specific conventions
3. Create component map
4. Document API contracts
```

### The Explore Subagent Strategy

Use built-in Explore subagent for thorough codebase analysis:

```markdown
## Exploration Thoroughness Levels

### Quick (for targeted lookups)
- Find specific file or function
- Check if pattern exists
- Locate configuration

### Medium (for balanced exploration)
- Understand a module
- Trace a feature's implementation
- Map dependencies for a component

### Very Thorough (for comprehensive analysis)
- Full codebase understanding
- Architecture documentation
- Cross-cutting concern analysis
```

### Parallel Bootstrap with Multiple Subagents

```markdown
## Parallel Exploration Protocol

Launch 5-10 subagents simultaneously, each exploring a different aspect:

1. **Structure Explorer** - Directory layout, file organization
2. **Dependency Explorer** - External packages, versions, usage
3. **Test Explorer** - Testing patterns, coverage, frameworks
4. **API Explorer** - Endpoints, contracts, authentication
5. **Database Explorer** - Schema, migrations, queries
6. **Config Explorer** - Environment, feature flags, secrets
7. **CI/CD Explorer** - Build process, deployment, pipelines

Each explorer produces a focused report. Orchestrator synthesizes into unified knowledge base.
```

### cc-bootstrap Tool

```bash
# Use cc-bootstrap for automated setup
pip install cc-bootstrap

# Analyze project and generate CLAUDE.md
cc-bootstrap init --project-plan plan.md --sample-files

# With external research
cc-bootstrap init --research --perplexity-key $PERPLEXITY_KEY
```

---

## Context Management & Compaction

### The Context Crisis

Long-running tasks exceed context limits. Tool-heavy workflows consume tokens rapidly. The solution is proactive context management.

### Compaction Strategies

**Reactive (Traditional):**
- Sliding Window: Drop oldest messages when limit exceeded
- On-demand Summarization: Pause to summarize when overflow occurs

**Proactive (Modern):**
- Background summarization processes
- Pre-computed summaries ready when needed
- No pause in user workflow

### Session-Based Architecture

```markdown
## Session Management Protocol

### Short Sessions (10-15 min)
- One bead per session
- Complete task, document result, exit
- Fresh context for next task
- Beads provide continuity between sessions

### Session Handoff
1. Before ending session:
   - Update progress.md with status
   - Mark completed beads as done
   - Note any blockers or next steps

2. Starting new session:
   - Query beads for highest priority work
   - Read progress.md for context
   - Check for messages from other agents
```

### Context Preservation Techniques

1. **Todo and Plan Files**: Persisted during compaction
2. **External Memory (Beads)**: Queryable state outside context
3. **Progress Log**: Shared understanding across agents
4. **Subagent Delegation**: Offload research to separate contexts

### What to Keep vs. Compress

**Keep:**
- Current task description
- Relevant file contents being edited
- Error messages and their resolution
- User instructions

**Compress/Summarize:**
- Historical exploration results
- Previously viewed files
- Earlier conversation turns
- Completed subtask details

---

## Communication Protocols

### The Lifeblood of Multi-Agent Systems

**Message passing is critical.** Without it, agents work in isolation and coordination fails.

| Message Type | When to Send | Priority |
|-------------|--------------|----------|
| **info** | Status updates, FYI notifications | Low |
| **action_required** | Work assignments, decisions needed | High |
| **completion** | Task finished, ready for review | High |
| **blocker** | Stuck, need help immediately | Critical |

**Message Protocol (MANDATORY):**
1. **On spawn**: Parent sends initial work assignment immediately
2. **On completion**: Agent MUST message completion to parent/mayor
3. **On blocker**: Agent MUST message blocker immediately (don't wait!)
4. **On progress**: Periodic status messages keep coordination smooth
5. **Check inbox**: Every agent should check for messages regularly

### Mayor Nudge Protocol

The Mayor is the main drive shaft - if it stalls, the entire system stops. Roles with spawn permission should monitor and nudge the Mayor when it appears idle.

**Who Can Nudge Mayor:**
- **Deacon** (primary): Agent patrol role - should send periodic propulsion checks
- **Witness**: If specialists are blocked waiting on Mayor response
- **External evaluator**: For evaluation runs

**Nudge Message Template:**
```
PROPULSION CHECK: You are the Mayor - the main drive shaft.
Check for pending work:
1. Unread messages (especially blockers and completions)
2. Beads needing attention (blocked, unassigned)
3. Merge queue status
4. Agent health (any offline?)

If work exists, EXECUTE immediately. Status report and next actions?
```

**Nudge Triggers:**
- Mayor hasn't sent a message in 5+ minutes during active work
- Blockers sitting unaddressed for 3+ minutes
- Completion messages not acknowledged
- Merge queue items waiting for Mayor decision

**Deacon Patrol Protocol:**
```markdown
## Deacon Propulsion Check Cycle

Every 5 minutes during active work:
1. Query messages for recent Mayor activity
2. Check for unaddressed blockers
3. Check for pending completions without acknowledgment
4. If Mayor appears stalled:
   - Send nudge message to Mayor
   - Log the nudge in progress
5. If Mayor unresponsive after 2 nudges:
   - Escalate to external evaluator/user
   - Log escalation event
```

### Inter-Agent Messaging

**File-Based (Simple):**
```markdown
<!-- .claude/messages/inbox-dashboard-agent.md -->

## Messages for Dashboard Agent

### From: auth-agent | 2025-01-11 14:30
OAuth implementation complete. You can now use:
- `useAuth()` hook for authentication state
- `<AuthProvider>` wrapper component
- `api/auth/*` endpoints

### From: orchestrator | 2025-01-11 14:00
Priority change: Complete user profile before settings page.
```

**Event-Based (Gas Town):**
```json
{
  "type": "task_complete",
  "from": "auth-agent",
  "timestamp": "2025-01-11T14:30:00Z",
  "payload": {
    "bead_id": "BEAD-001",
    "summary": "OAuth implementation complete",
    "artifacts": ["src/auth/**", "src/hooks/useAuth.ts"]
  }
}
```

### Progress Coordination

Shared `progress.md` file that all agents update:

```markdown
# Progress Log

## Active Agents
| Agent | Task | Status | ETA |
|-------|------|--------|-----|
| auth-agent | OAuth | Complete | - |
| dashboard-agent | User Dashboard | In Progress | - |
| api-agent | REST endpoints | Blocked | - |

## Timeline

### 2025-01-11 15:00 - dashboard-agent
**Status**: In Progress
**Completed**:
- Created dashboard layout
- Implemented user stats component
**Next**: Profile section (waiting on auth-agent)

### 2025-01-11 14:30 - auth-agent
**Status**: Complete
**Completed**:
- OAuth flow with Google
- useAuth hook
- AuthProvider component
**Artifacts**: src/auth/**, src/hooks/useAuth.ts
**Unblocks**: dashboard-agent, api-agent
```

### Coordination Check-Ins

```markdown
## Check-In Protocol (Every 30 Minutes)

1. Read progress.md for updates from other agents
2. Check messages/inbox-[your-name].md
3. Update your status in progress.md
4. Check if your blockers are resolved
5. Notify blocked agents if you've completed their dependency
```

---

## Building & Testing Infrastructure

### Continuous Integration for Agents

```yaml
# .github/workflows/agent-ci.yml
name: Agent CI

on:
  push:
    branches: [ 'feat/*' ]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Install dependencies
        run: npm ci

      - name: Type check
        run: npm run typecheck

      - name: Lint
        run: npm run lint

      - name: Test
        run: npm test

      - name: Build
        run: npm run build
```

### Pre-Commit Hooks for Agents

```bash
#!/bin/bash
# .git/hooks/pre-commit

# Type check
npm run typecheck
if [ $? -ne 0 ]; then
  echo "Type check failed. Fix errors before committing."
  exit 1
fi

# Lint
npm run lint
if [ $? -ne 0 ]; then
  echo "Lint failed. Fix errors before committing."
  exit 1
fi

# Test affected files
npm test -- --findRelatedTests $(git diff --cached --name-only)
```

### Agent Testing Protocol

```markdown
## Testing Requirements

### Before Marking Bead Complete:
1. All new code has tests
2. All tests pass locally
3. Type check passes
4. Lint passes
5. No regressions in existing tests

### Test Commands by Type:
- Unit tests: `npm test -- --grep "unit"`
- Integration tests: `npm test -- --grep "integration"`
- E2E tests: `npm run test:e2e`
- Full suite: `npm test`

### On Test Failure:
1. Do NOT mark bead complete
2. File new bead for test fix
3. Document failure in progress.md
4. If blocked, notify orchestrator
```

### Build Verification

```markdown
## Build Verification Protocol

### After Any Significant Change:
1. Run full build: `npm run build`
2. Check for warnings (treat as errors)
3. Verify output size is reasonable
4. Test build output locally if possible

### Build Failure Protocol:
1. Do NOT push broken builds
2. Revert or fix immediately
3. Document issue in progress.md
4. Notify affected agents
```

---

## Tool Comparison Matrix

| Tool | Type | Isolation | Memory | Hierarchy | Complexity |
|------|------|-----------|--------|-----------|------------|
| **Beads** | Memory System | Via Git | JSON/Git | Flat | Low |
| **Gas Town** | Full Orchestrator | Worktrees | Beads | 7 Roles | High |
| **CC Mirror** | Claude Extension | Background Tasks | JSON Files | Fan-Out/Pipeline | Medium |
| **Claude Flow** | Enterprise Platform | Configurable | SQLite | Swarm/Hive | High |
| **Claude Squad** | Terminal Manager | tmux + Worktrees | None | Flat | Low |
| **Conductor** | Dashboard Tool | Auto Worktrees | None | Flat | Low |
| **Crystal** | Desktop App | Worktrees | None | Flat | Low |
| **CCManager** | CLI Manager | Worktrees | None | Flat | Low |
| **ccswarm** | Rust Framework | Channels | None | Configurable | High |
| **CAO (AWS)** | Enterprise | Configurable | Configurable | Supervisor/Worker | High |

### When to Use What

- **Just starting?** → Beads + Claude Squad
- **Need hierarchy?** → Gas Town or Claude Flow
- **Want simplicity?** → CC Mirror's native orchestration
- **Enterprise scale?** → Claude Flow or CAO
- **Desktop GUI?** → Crystal or Conductor

---

## Implementation Roadmap

### Phase 1: Foundation (Week 1)

1. **Set up Beads**
   - Install `bd` CLI
   - Initialize in project: `bd init`
   - Update CLAUDE.md to reference Beads
   - Train yourself to file beads for all work

2. **Configure CLAUDE.md**
   - Minimal, universal instructions
   - Build/test commands
   - Paths to deeper documentation
   - Agent coordination protocols

3. **Create Progress Log**
   - Set up `.claude/progress.md`
   - Define update format
   - Add to CLAUDE.md instructions

### Phase 2: Parallelization (Week 2)

4. **Set up Git Worktrees**
   - Create worktree creation script
   - Define naming conventions
   - Document cleanup process

5. **Install Agent Manager**
   - Choose: Claude Squad / Conductor / Crystal
   - Configure for your workflow
   - Test with 2-3 parallel agents

6. **Define Task Boundaries**
   - Map code ownership
   - Create file/directory ownership rules
   - Document in CLAUDE.md

### Phase 3: Orchestration (Week 3)

7. **Implement Merge Queue**
   - Define merge protocol
   - Create rebase notification system
   - Test conflict resolution

8. **Add Hierarchical Delegation**
   - Choose orchestration tool
   - Define agent roles
   - Create custom subagent definitions

9. **Set up Communication**
   - Implement message inbox system
   - Configure check-in protocol
   - Test inter-agent messaging

### Phase 4: Optimization (Ongoing)

10. **Context Management**
    - Monitor context usage
    - Implement session handoff protocol
    - Tune compaction settings

11. **Testing & CI**
    - Set up branch CI
    - Configure pre-commit hooks
    - Define testing requirements

12. **Documentation**
    - Document all protocols
    - Create agent onboarding guide
    - Maintain architecture docs

---

## Appendix: Quick Reference

### Essential Commands

```bash
# Beads
bd init                  # Initialize
bd add "task"            # Create bead
bd next                  # Get next task
bd done BEAD-001         # Complete task

# Worktrees
git worktree add ../name branch  # Create
git worktree list                # List
git worktree remove ../name      # Remove

# Claude Squad
cs new agent-name --worktree path  # Launch
cs list                            # List agents
cs attach agent-name               # Attach to agent

# Claude Flow
claude-flow swarm start            # Start swarm
claude-flow status                 # Check status
```

### File Locations

```
.claude/
├── CLAUDE.md              # Project instructions
├── progress.md            # Shared progress log
├── agent-memory.md        # Coordination state
├── messages/              # Inter-agent messages
│   ├── inbox-agent-1.md
│   └── inbox-agent-2.md
└── agents/                # Custom subagent definitions
    ├── backend-specialist.md
    └── frontend-specialist.md

.beads/
├── beads.jsonl            # Bead database
└── config.json            # Beads configuration
```

### Key Principles Checklist

- [ ] Every task is a bead with an ID
- [ ] Each agent has its own worktree
- [ ] No two agents edit the same file
- [ ] Progress is logged after every action
- [ ] Sessions are short (10-15 min)
- [ ] Context is queried, not front-loaded
- [ ] Merge queue is respected
- [ ] Tests pass before marking complete

---

## Sources & Further Reading

### Primary Sources
- [Beads GitHub](https://github.com/steveyegge/beads) - Steve Yegge's memory system
- [Gas Town GitHub](https://github.com/steveyegge/gastown) - Multi-agent workspace manager
- [CC Mirror GitHub](https://github.com/numman-ali/cc-mirror) - Native orchestration unlock
- [Claude Flow GitHub](https://github.com/ruvnet/claude-flow) - Enterprise swarm platform
- [Claude Squad GitHub](https://github.com/smtg-ai/claude-squad) - Terminal multiplexer

### Articles & Guides
- [Introducing Beads](https://steve-yegge.medium.com/introducing-beads-a-coding-agent-memory-system-637d7d92514a)
- [Welcome to Gas Town](https://steve-yegge.medium.com/welcome-to-gas-town-4f25ee16dd04)
- [Beads Best Practices](https://steve-yegge.medium.com/beads-best-practices-2db636b9760c)
- [The Future of Coding Agents](https://steve-yegge.medium.com/the-future-of-coding-agents-e9451a84207c)
- [Claude Code Official Docs](https://code.claude.com/docs)
- [Git Worktrees with Claude Code](https://incident.io/blog/shipping-faster-with-claude-code-and-git-worktrees)
- [Parallel AI Coding](https://simonwillison.net/2025/Oct/5/parallel-coding-agents/)
- [AWS CLI Agent Orchestrator](https://aws.amazon.com/blogs/opensource/introducing-cli-agent-orchestrator-transforming-developer-cli-tools-into-a-multi-agent-powerhouse/)

### Tools & Frameworks
- [Conductor](https://www.vibesparking.com/en/blog/ai/claude-code/conductor/)
- [Crystal](https://github.com/stravu/crystal)
- [CCManager](https://github.com/kbwo/ccmanager)
- [ccswarm](https://github.com/nwiizo/ccswarm)
- [Claude Code Agents Orchestra](https://github.com/0ldh/claude-code-agents-orchestra)

---

*This blueprint synthesizes insights from the leading agent orchestration solutions as of January 2025. The field is evolving rapidly—check the source repositories for the latest updates.*
