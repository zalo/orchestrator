import { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';

const TERMINAL_ROWS = 200; // Tall terminal for scrollback history

interface TerminalRef {
  sendInput: (data: string) => void;
  focus: () => void;
  copySelection: () => Promise<void>;
  hasSelection: () => boolean;
}

interface EmbeddedTerminalProps {
  sessionName: string;
  className?: string;
  showHeader?: boolean;
  title?: string;
  onClose?: () => void;
  onReady?: (ref: TerminalRef) => void;
}

export default function EmbeddedTerminal({
  sessionName,
  className = '',
  showHeader = false,
  title,
  onClose,
  onReady
}: EmbeddedTerminalProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<HTMLDivElement>(null);
  const terminalInstanceRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const manualScrollRef = useRef(false);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(true);
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);

  const sendInput = useCallback((data: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'input', data }));
      manualScrollRef.current = false;
    }
  }, []);

  const focus = useCallback(() => {
    terminalInstanceRef.current?.focus();
  }, []);

  const copySelection = useCallback(async () => {
    if (terminalInstanceRef.current) {
      const selection = terminalInstanceRef.current.getSelection();
      if (selection) {
        try {
          await navigator.clipboard.writeText(selection);
        } catch (e) {
          console.error('Failed to copy:', e);
        }
      }
    }
  }, []);

  const hasSelection = useCallback(() => {
    return terminalInstanceRef.current?.hasSelection() || false;
  }, []);

  // Handle visual viewport changes (keyboard appearing/disappearing)
  useEffect(() => {
    const updateViewportHeight = () => {
      if (window.visualViewport) {
        setViewportHeight(window.visualViewport.height);
      }
    };

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', updateViewportHeight);
      updateViewportHeight();
    }

    return () => {
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', updateViewportHeight);
      }
    };
  }, []);

  // Scroll to cursor position when viewport height changes (keyboard appears)
  useEffect(() => {
    if (manualScrollRef.current) return;

    if (scrollContainerRef.current && terminalInstanceRef.current && viewportHeight !== null) {
      const container = scrollContainerRef.current;
      const terminal = terminalInstanceRef.current;

      const cursorY = terminal.buffer.active.cursorY;
      const baseY = terminal.buffer.active.baseY;
      const cursorRow = baseY + cursorY;

      const rowHeight = 17;
      const cursorPixelPosition = cursorRow * rowHeight;

      const scrollTop = container.scrollTop;
      const containerHeight = container.clientHeight;
      const cursorVisible = cursorPixelPosition >= scrollTop &&
                           cursorPixelPosition < scrollTop + containerHeight - rowHeight;

      if (!cursorVisible) {
        const targetScroll = Math.max(0, cursorPixelPosition - containerHeight + rowHeight * 3 + 200);
        container.scrollTop = targetScroll;
      }
    }
  }, [viewportHeight]);

  const connectWebSocket = useCallback(() => {
    if (!sessionName) return;

    setConnecting(true);
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/terminal?session=${encodeURIComponent(sessionName)}`);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      setConnecting(false);

      // Send initial size with tall rows
      if (scrollContainerRef.current && terminalInstanceRef.current) {
        const containerWidth = scrollContainerRef.current.clientWidth - 16;
        const charWidth = 8.4;
        const cols = Math.floor(containerWidth / charWidth);
        ws.send(JSON.stringify({ type: 'resize', cols: Math.max(cols, 40), rows: TERMINAL_ROWS }));
      }
    };

    ws.onmessage = (event) => {
      if (terminalInstanceRef.current) {
        terminalInstanceRef.current.write(event.data);
      }
    };

    ws.onclose = () => {
      setConnected(false);
      setConnecting(false);

      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      reconnectTimeoutRef.current = window.setTimeout(() => {
        if (wsRef.current?.readyState === WebSocket.CLOSED) {
          connectWebSocket();
        }
      }, 2000);
    };

    ws.onerror = () => {
      setConnected(false);
      setConnecting(false);
    };
  }, [sessionName]);

  useEffect(() => {
    if (!terminalRef.current || !sessionName) return;

    // Create terminal instance with tall rows
    const terminal = new Terminal({
      theme: {
        background: '#1a1a2e',
        foreground: '#e2e8f0',
        cursor: '#4fd1c5',
        cursorAccent: '#1a1a2e',
        selectionBackground: '#4fd1c580',
        black: '#1a1a2e',
        red: '#f56565',
        green: '#48bb78',
        yellow: '#f6ad55',
        blue: '#4299e1',
        magenta: '#9f7aea',
        cyan: '#4fd1c5',
        white: '#e2e8f0',
        brightBlack: '#4a5568',
        brightRed: '#fc8181',
        brightGreen: '#68d391',
        brightYellow: '#fbd38d',
        brightBlue: '#63b3ed',
        brightMagenta: '#b794f4',
        brightCyan: '#76e4f7',
        brightWhite: '#f7fafc',
      },
      cursorBlink: true,
      fontFamily: '"Fira Code", "JetBrains Mono", "SF Mono", Menlo, monospace',
      fontSize: 14,
      lineHeight: 1.2,
      rows: TERMINAL_ROWS,
      cols: 80,
      scrollback: 0, // Disable internal scrollback since we're using container scroll
      allowProposedApi: true,
    });

    terminalInstanceRef.current = terminal;

    // Add fit addon
    const fitAddon = new FitAddon();
    fitAddonRef.current = fitAddon;
    terminal.loadAddon(fitAddon);

    // Add web links addon
    terminal.loadAddon(new WebLinksAddon());

    // Open terminal
    terminal.open(terminalRef.current);

    // Try WebGL addon
    try {
      const webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => {
        webglAddon.dispose();
      });
      terminal.loadAddon(webglAddon);
    } catch {
      // WebGL not available, fall back to canvas
    }

    // Update columns based on container width
    const updateCols = () => {
      if (scrollContainerRef.current) {
        const containerWidth = scrollContainerRef.current.clientWidth - 16;
        const charWidth = 8.4;
        const cols = Math.floor(containerWidth / charWidth);
        terminal.resize(Math.max(cols, 40), TERMINAL_ROWS);
      }
    };

    requestAnimationFrame(updateCols);

    // Handle input
    terminal.onData((data) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'input', data }));
      }
    });

    // Connect WebSocket
    connectWebSocket();

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      updateCols();
      if (wsRef.current?.readyState === WebSocket.OPEN && scrollContainerRef.current) {
        const containerWidth = scrollContainerRef.current.clientWidth - 16;
        const charWidth = 8.4;
        const cols = Math.floor(containerWidth / charWidth);
        wsRef.current.send(JSON.stringify({ type: 'resize', cols: Math.max(cols, 40), rows: TERMINAL_ROWS }));
      }
    });
    if (scrollContainerRef.current) {
      resizeObserver.observe(scrollContainerRef.current);
    }

    // Call onReady with terminal methods
    if (onReady) {
      onReady({ sendInput, focus, copySelection, hasSelection });
    }

    // Scroll to cursor position initially
    if (scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      const rowHeight = 17;
      const cursorY = terminal.buffer.active.cursorY;
      const baseY = terminal.buffer.active.baseY;
      const cursorRow = baseY + cursorY;
      const cursorPixelPosition = cursorRow * rowHeight;
      const containerHeight = container.clientHeight;
      const targetScroll = Math.max(0, cursorPixelPosition - containerHeight + rowHeight * 3 + 200);
      container.scrollTop = targetScroll;
    }

    return () => {
      resizeObserver.disconnect();
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      wsRef.current?.close();
      terminal.dispose();
    };
  }, [sessionName, connectWebSocket, onReady, sendInput, focus, copySelection, hasSelection]);

  // Calculate container height based on viewport
  const containerStyle: React.CSSProperties = viewportHeight
    ? { height: `${viewportHeight - 140}px` }
    : { height: '100%' };

  return (
    <div className={`flex flex-col bg-charcoal rounded-xl overflow-hidden ${className}`}>
      {showHeader && (
        <div className="flex items-center justify-between px-3 py-2 bg-charcoal-light border-b border-charcoal-lighter shrink-0">
          <div className="flex items-center gap-2">
            <span className={`status-dot ${connected ? 'status-working' : connecting ? 'status-starting' : 'status-offline'}`} />
            <span className="text-sm text-slate-300 font-medium">
              {title || sessionName}
            </span>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="text-slate-500 hover:text-slate-300 transition-colors p-1"
              title="Close terminal"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
          )}
        </div>
      )}
      <div
        ref={scrollContainerRef}
        className="terminal-scroll-container flex-1 min-h-0"
        style={containerStyle}
      >
        <div
          ref={terminalRef}
          className="terminal-inner"
        />
      </div>
    </div>
  );
}
