# Build, Test, and Screenshot Skill

## Purpose

Spawn a native sub-agent to verify your work before submitting to the merge queue. This agent will:
1. Build the project
2. Start the dev server and test the page in Playwright
3. Check for console errors and network failures
4. Take a screenshot for visual verification
5. Report results back to you

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
2. START SERVER: Run 'npm run dev' in background, wait for it to be ready
3. NAVIGATE: Use Playwright to navigate to http://localhost:5173 (or appropriate port)
4. CHECK CONSOLE: Use browser_console_messages to get all console errors/warnings
5. CHECK NETWORK: Use browser_network_requests to find any failed requests
6. SCREENSHOT: Use browser_take_screenshot to capture the current state
7. REPORT: Summarize findings - build status, console errors, network failures, screenshot path

If there are errors, list them clearly so they can be fixed."
```

## Alternative: Direct Playwright Commands

If you prefer to run verification yourself instead of spawning an agent:

### 1. Build
```bash
npm run build
```

### 2. Start Dev Server (background)
```bash
npm run dev &
sleep 3  # Wait for server to start
```

### 3. Navigate and Test with Playwright MCP
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

### 4. Kill Dev Server
```bash
pkill -f "vite"  # or appropriate process
```

## What to Check For

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

## Handling Results

### If Build Fails
1. Read the error output carefully
2. Fix the TypeScript/compilation errors
3. Re-run the build
4. Do NOT proceed until build passes

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
- Console Errors: None
- Network Failures: None
- Screenshot: verification-search-modal.png

Files changed: src/components/SearchModal.tsx, src/hooks/useKeyboardShortcut.ts
Submitted to merge queue as MR-003.
```

## Integration with Workflow

```
[Code Changes]
     │
     ▼
[Run Build-Test-Screenshot Skill] ◄── YOU ARE HERE
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
[Merge]
```

## Tags

verification, testing, playwright, build, screenshot, quality-gate, pre-merge
