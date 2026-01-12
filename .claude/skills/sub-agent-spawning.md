# Sub-Agent Spawning

## Overview
Sub-agents are Claude Code instances spawned in tmux sessions to work on tasks in parallel with the Mayor.

## How Spawning Works

### Server-Side (`server/src/server.ts`)

1. **API Endpoint**: `POST /api/agents/spawn`
   ```json
   {
     "name": "agent-name",
     "role": "specialist",  // specialist | reviewer | explorer
     "model": "sonnet",     // sonnet | haiku (opus reserved for mayor)
     "prompt": "Your task description..."
   }
   ```

2. **Tmux Session Creation**:
   - Session name: `agent-{name}`
   - Created in workspace directory
   - Claude launched with `--dangerously-skip-permissions --append-system-prompt`

3. **Initial Message (CRITICAL)**:
   After Claude starts, an initial message MUST be sent to kick off the agent:
   ```javascript
   setTimeout(() => {
     const initialMessage = agent.role === 'mayor'
       ? 'Please greet the user...'
       : 'Begin working on your assigned task now. Start by reading the relevant files, then make the required changes. Log your progress via the API as you work.';
     execSync(`tmux send-keys -t '${sessionName}' '${initialMessage}' C-m`);
   }, 3000);
   ```

   **Bug Fixed 2026-01-11**: Previously only the Mayor received an initial message. Sub-agents would start but sit idle at the Claude prompt. Fixed by sending initial message to ALL agents.

   **Bug Fixed 2026-01-12**: Initial message and Enter key were sent together in a single tmux send-keys command, which sometimes failed due to shell quoting issues. Fixed by:
   1. Escaping single quotes in the message
   2. Sending message and C-m (Enter) as separate tmux send-keys commands
   3. Increased timeout from 3s to 5s for more reliable Claude initialization

## Sub-Agent Prompt Template

The `generateSubAgentPrompt()` function wraps the custom prompt with:
- Workspace info
- API reference (beads, progress, messages)
- Workflow instructions
- Completion protocol

## Monitoring Sub-Agents

From Mayor terminal:
```bash
# Check agent tmux sessions
tmux list-sessions | grep agent-

# View agent output
tmux capture-pane -t agent-{name} -p | tail -50

# Manually send message to stuck agent
tmux send-keys -t agent-{name} 'Your message here' Enter
```

## Common Issues

### Agent Sits Idle at Prompt
**Cause**: Initial message not sent or not submitted
**Fix**:
1. Check server logs for "Failed to send initial message" errors
2. Manually send: `tmux send-keys -t agent-{name} 'Begin working...' Enter`

### Agent Not Reporting Progress
**Cause**: Agent not calling progress API
**Fix**: Include explicit API examples in agent prompt

### File Conflicts Between Agents
**Cause**: Multiple agents editing same files
**Fix**: Clearly specify file ownership in agent prompts:
```
FILES YOU OWN (only edit these):
- path/to/file1.ts
- path/to/directory/
```

## Best Practices

1. **One focused task per agent** - Don't overload prompts
2. **Clear file ownership** - Prevent merge conflicts
3. **Include API examples** - Show exact curl commands
4. **Specify completion protocol** - How to report done
5. **Use haiku for simple tasks** - Faster and cheaper

## Last Updated
2026-01-11 - Fixed sub-agent initial message bug
