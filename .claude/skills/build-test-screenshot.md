# Build, Test, and Screenshot Skill

## Purpose

Spawn a sub-agent to verify your work before submitting to the merge queue. This agent will:
1. Build the project
2. Start the application and monitor logs for errors
3. Visually verify the application (if applicable)
4. Check for runtime errors and failures
5. Take a screenshot for visual verification (if applicable)
6. Report results back to you

## When to Use

**REQUIRED** before submitting to merge queue:
- After implementing a new feature
- After fixing a bug
- After making changes that affect the application
- Before marking a bead as complete

## How to Spawn the Verification Agent

Use Claude Code's native Task tool to spawn a sub-agent:

```
Use the Task tool with subagent_type="Explore" to verify my changes:

Prompt: "Verify the build and test the application:

1. BUILD: Run the project's build command (check package.json, Makefile, Cargo.toml, etc.) and report any errors
2. START APPLICATION: Start the dev server/application with output captured to /tmp/server.log
3. WAIT: Allow time for the application to initialize
4. CHECK SERVER LOGS: Read /tmp/server.log and check for errors, warnings, or stack traces
5. VISUAL VERIFICATION (if web app):
   - Navigate to the application URL using browser tools
   - Check for console errors using browser_console_messages
   - Check for network failures using browser_network_requests
   - Take a screenshot using browser_take_screenshot
6. CLEANUP: Stop the application
7. REPORT: Summarize findings - build status, server errors, runtime errors, screenshot path (if applicable)

If there are errors, list them clearly so they can be fixed."
```

## Alternative: Direct Verification

If you prefer to run verification yourself instead of spawning an agent:

### 1. Build
```bash
# Use the appropriate build command for your project:
# - Node.js: npm run build / yarn build
# - Rust: cargo build
# - Go: go build
# - Python: python -m py_compile / pytest
# - etc.
```

### 2. Start Application with Log Capture
```bash
# Start the application and capture output to a log file
# Example: <start-command> 2>&1 | tee /tmp/server.log &
# Wait for startup to complete
sleep 3
```

### 3. Check Server Logs for Errors
```bash
# Look for errors, warnings, stack traces in server output
grep -iE "(error|warn|exception|failed|stack|panic)" /tmp/server.log || echo "No server errors found"
```

### 4. Visual Verification (if applicable)
If the application has a UI (web, desktop, etc.), use available browser/UI tools to:
- Navigate to the application
- Check for console/runtime errors
- Check for failed network requests or API calls
- Take a screenshot for visual verification

### 5. Cleanup
```bash
# Stop the application process
# Remove temporary log files
rm -f /tmp/server.log
```

## What to Check For

### Server/Application Log Errors (Critical)
- Compilation errors during startup
- Module/dependency resolution failures
- Port or resource conflicts
- Unhandled exceptions or stack traces
- Configuration errors

### Runtime Errors (Critical)
- Application crashes or panics
- Unhandled exceptions
- Failed assertions
- Memory or resource errors

### UI/Browser Errors (if applicable)
- Console errors
- Failed network requests (4xx/5xx responses)
- Missing assets or resources
- CORS or security errors

### Warnings (Review)
- Deprecation warnings
- Performance warnings
- Configuration warnings

## Handling Results

### If Build Fails
1. Read the error output carefully
2. Fix compilation/build errors
3. Re-run the build
4. Do NOT proceed until build passes

### If Server Log Errors Found
1. Check /tmp/server.log for the full error
2. Common issues:
   - Port in use → kill existing process or use different port
   - Missing dependency → install required packages
   - Configuration error → check config files
3. Fix the issue and restart
4. Re-run verification

### If Runtime/UI Errors Found
1. Note the error message and context
2. Fix the error in your code
3. Re-run verification
4. Do NOT submit to merge queue until clean

### If All Clear
1. Proceed to submit to merge queue
2. Include screenshot path in your completion message (if applicable)
3. Note "Build passed, verification clean" in your message

## Example Completion Message

After successful verification:
```
BEAD-003 COMPLETE: Implemented [feature description].

Verification Results:
- Build: PASSED
- Server Logs: Clean (no errors)
- Runtime Errors: None
- Screenshot: verification.png (if applicable)

Files changed: [list of files]
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
2. No server/application errors introduced
3. No runtime errors
4. Application still functions correctly (if applicable)

If post-merge verification fails:
1. Revert the merge immediately
2. Notify the original author via message
3. Mark the MR as "conflict" or "failed"
4. Continue with next item in queue

## Tags

verification, testing, build, screenshot, quality-gate, pre-merge, post-merge, refinery
