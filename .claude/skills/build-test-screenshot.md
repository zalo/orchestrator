# Build, Test, and Screenshot Skill

## Purpose

Spawn a native sub-agent to verify your work before submitting to the merge queue. This agent will:
1. Build the project
2. Start the dev server and monitor server logs for errors
3. Test the page in Playwright
4. Check for browser console errors and network failures
5. Take a screenshot for visual verification
6. Report results back to you

## When to Use

**REQUIRED** before submitting to merge queue:
- After implementing a new feature
- After fixing a bug
- After making UI changes
- Before marking a bead as complete

## How to Spawn the Verification Agent

Use Claude Code's native Task tool to spawn a sub-agent:

```
Use the Task tool with subagent_type="Explore" to verify my changes:

Prompt: "Verify the build and test the web application:

1. BUILD: Run 'npm run build' and report any errors
2. START SERVER: Run 'npm run dev 2>&1 | tee /tmp/server.log &' to capture server output
3. WAIT: Sleep 3-5 seconds for server to initialize
4. CHECK SERVER LOGS: Read /tmp/server.log and check for errors, warnings, or stack traces
5. NAVIGATE: Use Playwright to navigate to http://localhost:5173 (or appropriate port)
6. CHECK CONSOLE: Use browser_console_messages to get all console errors/warnings
7. CHECK NETWORK: Use browser_network_requests to find any failed requests
8. SCREENSHOT: Use browser_take_screenshot to capture the current state
9. CLEANUP: Kill the dev server (pkill -f vite)
10. REPORT: Summarize findings - build status, server errors, console errors, network failures, screenshot path

If there are errors, list them clearly so they can be fixed."
```

## Alternative: Direct Playwright Commands

If you prefer to run verification yourself instead of spawning an agent:

### 1. Build
```bash
npm run build
```

### 2. Start Dev Server with Log Capture
```bash
# Start server and capture output to log file
npm run dev 2>&1 | tee /tmp/server.log &
sleep 3  # Wait for server to start
```

### 3. Check Server Logs for Errors
```bash
# Look for errors, warnings, stack traces in server output
grep -iE "(error|warn|exception|failed|stack)" /tmp/server.log || echo "No server errors found"
```

### 4. Navigate and Test with Playwright MCP
```
# Navigate to the page
mcp__plugin_playwright_playwright__browser_navigate: url="http://localhost:5173"

# Wait for page to load
mcp__plugin_playwright_playwright__browser_wait_for: time=2

# Check console for errors
mcp__plugin_playwright_playwright__browser_console_messages: level="error"

# Check network for failures
mcp__plugin_playwright_playwright__browser_network_requests

# Take screenshot
mcp__plugin_playwright_playwright__browser_take_screenshot: filename="verification.png"

# Get page snapshot for accessibility check
mcp__plugin_playwright_playwright__browser_snapshot
```

### 5. Kill Dev Server and Cleanup
```bash
pkill -f "vite"  # or appropriate process
rm -f /tmp/server.log
```

## What to Check For

### Server Log Errors (Critical)
- Compilation errors during startup
- Module resolution failures
- Port already in use
- Unhandled exceptions/stack traces
- TypeScript/ESLint errors in watch mode

### Console Errors (Critical)
- JavaScript runtime errors
- React/Vue/framework errors
- Failed module imports
- Uncaught exceptions

### Network Failures (Critical)
- 4xx/5xx HTTP responses
- Failed API calls
- Missing assets (404s)
- CORS errors

### Warnings (Review)
- Deprecation warnings
- React key warnings
- Accessibility warnings
- Server-side warnings

## Handling Results

### If Build Fails
1. Read the error output carefully
2. Fix the TypeScript/compilation errors
3. Re-run the build
4. Do NOT proceed until build passes

### If Server Log Errors Found
1. Check /tmp/server.log for the full error
2. Common issues:
   - Port in use → kill existing process or use different port
   - Module not found → check imports and install dependencies
   - TypeScript errors → fix type issues
3. Fix the issue and restart the server
4. Re-run verification

### If Console Errors Found
1. Note the error message and stack trace
2. Fix the runtime error in your code
3. Re-run verification
4. Do NOT submit to merge queue until clean

### If Network Failures Found
1. Check if the endpoint exists
2. Verify API is running (if applicable)
3. Fix any broken imports/assets
4. Re-run verification

### If All Clear
1. Proceed to submit to merge queue
2. Include screenshot path in your completion message
3. Note "Build passed, no console errors" in your message

## Example Completion Message

After successful verification:
```
BEAD-003 COMPLETE: Implemented search modal with Ctrl+K shortcut.

Verification Results:
- Build: PASSED
- Server Logs: Clean (no errors)
- Console Errors: None
- Network Failures: None
- Screenshot: verification-search-modal.png

Files changed: src/components/SearchModal.tsx, src/hooks/useKeyboardShortcut.ts
Submitted to merge queue as MR-003.
```

## Integration with Workflow

### For Specialists (Pre-Merge)
```
[Code Changes]
     │
     ▼
[Run Build-Test-Screenshot] ◄── SPECIALIST VERIFIES
     │
     ├── Errors? ──► Fix and retry
     │
     ▼
[Submit to Merge Queue]
     │
     ▼
[Code Review]
     │
     ▼
[Merge by Refinery]
     │
     ▼
[Run Build-Test-Screenshot] ◄── REFINERY VERIFIES POST-MERGE
     │
     ├── Errors? ──► Revert or fix
     │
     ▼
[Notify Next Agent to Rebase]
```

### For Refinery (Post-Merge)
After each successful merge, the refinery MUST run verification to ensure:
1. The merged code builds successfully
2. No server errors introduced
3. No console errors in browser
4. Application still functions correctly

If post-merge verification fails:
1. Revert the merge immediately
2. Notify the original author via message
3. Mark the MR as "conflict" or "failed"
4. Continue with next item in queue

## Tags

verification, testing, playwright, build, screenshot, quality-gate, pre-merge, post-merge, refinery
