# Mobile UI Architecture

## Overview
The orchestrator frontend has been optimized for mobile use with a compact, touch-friendly interface.

## Key Design Decisions

### 1. Single Unified Header Bar
Instead of multiple header bars (App header + terminal header + control bar), we use a **single compact header** in `MayorView.tsx` containing:
- Sidebar toggle (hamburger icon) with badge indicators
- Terminal controls: X (Ctrl+C), Up arrow, Down arrow, Copy, Paste
- Status indicator and Stop button

The App.tsx header is only shown for the StartMayor view, not when workspace is active.

### 2. Sidebar Behavior
- **Collapsed by default** (`sidebarCollapsed = useState(true)`)
- **Sidebar on LEFT side** of the terminal
- When collapsed: renders `null` (no DOM element, no width consumed)
- Toggle button is in the header bar, not floating
- Badge indicators on toggle show: beads in progress (cyan), agents (purple), unread messages (rose)

### 3. Tall Scrollable Terminal
Uses the pattern from `../terminal` project:
- `TERMINAL_ROWS = 200` for tall terminal buffer
- Native scroll via `.terminal-scroll-container` wrapper
- `scrollback: 0` (uses container scroll instead of xterm internal scroll)
- Viewport height tracking for mobile keyboard handling
- CSS classes: `terminal-scroll-container`, `terminal-inner`

### 4. Touch-Friendly Controls
- Minimal button set: only X, up, down, Copy, Paste
- Removed: Tab, Esc, Ctrl, Alt, Shift modifier buttons (too complex for mobile)
- Uses `.control-btn` CSS class for consistent touch targets (min 44px)

## File Structure

```
frontend/src/
├── App.tsx                    # Shows header only for StartMayor, passes `connected` to MayorView
├── components/
│   ├── MayorView.tsx          # Unified header + terminal + sidebar integration
│   ├── Sidebar.tsx            # Returns null when collapsed
│   ├── EmbeddedTerminal.tsx   # Tall scrollable terminal with onReady callback
│   └── ...
└── index.css                  # Contains .terminal-scroll-container, .terminal-inner, .control-btn
```

## MayorView Props
```typescript
interface MayorViewProps {
  workspace: Workspace;
  beads: Bead[];
  agents: Agent[];
  progress: ProgressEntry[];
  messages: Message[];
  onStop: () => void;
  stopping: boolean;
  connected: boolean;  // Added for status indicator
}
```

## EmbeddedTerminal onReady Callback
```typescript
interface TerminalRef {
  sendInput: (data: string) => void;
  focus: () => void;
  copySelection: () => Promise<void>;
  hasSelection: () => boolean;
}

// Usage in MayorView:
<EmbeddedTerminal
  sessionName={mayor.tmuxSession}
  className="h-full"
  onReady={handleTerminalReady}  // Returns TerminalRef
/>
```

## CSS Requirements
```css
.terminal-scroll-container {
  width: 100%;
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  background-color: var(--color-charcoal);
  -webkit-overflow-scrolling: touch;
}

.terminal-inner {
  width: 100%;
  min-height: 100%;
  background-color: var(--color-charcoal);
}

.control-btn {
  min-width: 44px;
  min-height: 44px;
  /* ... touch-friendly styles */
}
```

## Testing
Test mobile layout with Playwright:
```javascript
await page.setViewportSize({ width: 375, height: 812 }); // iPhone X
await page.goto('http://localhost:3003');
await page.screenshot({ path: 'phone-layout.png' });
```

## Last Updated
2026-01-11 - Initial mobile optimization complete
