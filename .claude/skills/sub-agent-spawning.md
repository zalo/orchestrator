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
   After Claude starts, an initial message MUST be sent to kick off the agent.
   Uses the reliable "nudge" pattern from Gas Town:
   ```javascript
   // 1. Send text in literal mode (-l) to handle special characters
   execSync(`tmux send-keys -t '${sessionName}' -l ${JSON.stringify(message)}`);
   // 2. Wait 500ms for paste to complete
   execSync('sleep 0.5');
   // 3. Send Escape (for vim mode users - harmless in normal mode)
   execSync(`tmux send-keys -t '${sessionName}' Escape`);
   execSync('sleep 0.1');
   // 4. Send Enter separately (more reliable)
   execSync(`tmux send-keys -t '${sessionName}' Enter`);
   ```

   **Bug Fixed 2026-01-11**: Previously only the Mayor received an initial message. Sub-agents would start but sit idle at the Claude prompt. Fixed by sending initial message to ALL agents.

   **Bug Fixed 2026-01-12**: Adopted Gas Town's reliable nudge pattern:
   1. Use `-l` literal mode for the message (handles special characters)
   2. Wait 500ms debounce for paste to complete
   3. Send Escape for vim mode (harmless in normal mode)
   4. Send Enter separately (not C-m, and not combined with message)

## Sub-Agent Prompt Template

The `generateSubAgentPrompt()` function wraps the custom prompt with:
- Workspace info
- API reference (beads, progress, messages)
- Workflow instructions
- Completion protocol

## Sending Messages to Claude Sessions

**IMPORTANT**: Always use the reliable nudge pattern. Never use raw `tmux send-keys` with C-m.

### From Shell (manual nudge):
```bash
# 1. Send text in literal mode
tmux -S /tmp/orchestrator-tmux.sock send-keys -t {session-name} -l "Your message here"
# 2. Wait 500ms for paste
sleep 0.5
# 3. Send Escape (for vim mode)
tmux -S /tmp/orchestrator-tmux.sock send-keys -t {session-name} Escape
# 4. Wait 100ms
sleep 0.1
# 5. Send Enter separately
tmux -S /tmp/orchestrator-tmux.sock send-keys -t {session-name} Enter
```

### Quick One-Liner (less reliable but often works):
```bash
tmux -S /tmp/orchestrator-tmux.sock send-keys -t {session-name} -l "Message" && sleep 0.5 && tmux -S /tmp/orchestrator-tmux.sock send-keys -t {session-name} Enter
```

## Monitoring Sub-Agents

From Mayor terminal:
```bash
# Check agent tmux sessions
tmux -S /tmp/orchestrator-tmux.sock list-sessions

# View agent output
tmux -S /tmp/orchestrator-tmux.sock capture-pane -t {session-name} -p | tail -50

# Attach interactively (for debugging)
tmux -S /tmp/orchestrator-tmux.sock attach -t {session-name}
```

## Common Issues

### Agent Sits Idle at Prompt
**Cause**: Initial message not sent or not submitted properly
**Fix**:
1. Check server logs for "Failed to send initial message" errors
2. Use the reliable nudge pattern (see "Sending Messages" above)

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
6. **Always use nudge pattern** - Never send message+C-m together

## Last Updated
2026-01-12 - Adopted Gas Town nudge pattern for reliable message delivery
