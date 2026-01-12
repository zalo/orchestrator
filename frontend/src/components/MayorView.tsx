import { useState, useCallback } from 'react';
import { Workspace, Bead, Agent, ProgressEntry, Message } from '../types';
import EmbeddedTerminal from './EmbeddedTerminal';
import Sidebar from './Sidebar';
import SubAgentTabs from './SubAgentTabs';
import SubAgentPanel from './SubAgentPanel';

interface TerminalRef {
  sendInput: (data: string) => void;
  focus: () => void;
  copySelection: () => Promise<void>;
  hasSelection: () => boolean;
}

interface MayorViewProps {
  workspace: Workspace;
  beads: Bead[];
  agents: Agent[];
  progress: ProgressEntry[];
  messages: Message[];
  onStop: () => void;
  onBack: () => void;
  stopping: boolean;
  connected: boolean;
}

export default function MayorView({
  workspace,
  beads,
  agents,
  progress,
  messages,
  onStop,
  onBack,
  stopping,
  connected
}: MayorViewProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [subAgentsPanelCollapsed, setSubAgentsPanelCollapsed] = useState(true);
  const [activeSubAgentId, setActiveSubAgentId] = useState<string | null>(null);
  const [terminalRef, setTerminalRef] = useState<TerminalRef | null>(null);

  const mayor = agents.find(a => a.role === 'mayor');
  const subAgents = agents.filter(a => a.role !== 'mayor');
  const activeSubAgent = subAgents.find(a => a.id === activeSubAgentId);
  const unreadMessages = messages.filter(m => !m.read);
  const beadCounts = {
    inProgress: beads.filter(b => b.status === 'in_progress').length,
  };

  const handleSelectAgentFromSidebar = (agent: Agent) => {
    setActiveSubAgentId(agent.id);
    setSubAgentsPanelCollapsed(false);
  };

  const handleTerminalReady = useCallback((ref: TerminalRef) => {
    setTerminalRef(ref);
  }, []);

  const handleKey = useCallback((key: string) => {
    if (terminalRef) {
      terminalRef.sendInput(key);
      terminalRef.focus();
    }
  }, [terminalRef]);

  const handleCopy = useCallback(async () => {
    if (terminalRef) {
      await terminalRef.copySelection();
    }
  }, [terminalRef]);

  const handlePaste = useCallback(async () => {
    if (terminalRef) {
      try {
        const text = await navigator.clipboard.readText();
        terminalRef.sendInput(text);
        terminalRef.focus();
      } catch (e) {
        console.error('Failed to paste:', e);
      }
    }
  }, [terminalRef]);

  const sendCtrlKey = useCallback((char: string) => {
    const code = char.toUpperCase().charCodeAt(0) - 64;
    handleKey(String.fromCharCode(code));
  }, [handleKey]);

  return (
    <div className="h-full flex flex-col">
      {/* Unified header bar */}
      <header className="bg-charcoal-light border-b border-charcoal-lighter px-2 py-1.5 flex items-center gap-2 shrink-0">
        {/* Sidebar toggle */}
        <button
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          className="control-btn relative"
          title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            {sidebarCollapsed ? (
              <path fillRule="evenodd" d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 15a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
            ) : (
              <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
            )}
          </svg>
          {/* Badge indicators when collapsed */}
          {sidebarCollapsed && (beadCounts.inProgress > 0 || subAgents.length > 0 || unreadMessages.length > 0) && (
            <div className="absolute -top-0.5 -right-0.5 flex gap-0.5">
              {beadCounts.inProgress > 0 && <span className="w-1.5 h-1.5 rounded-full bg-cyan" />}
              {subAgents.length > 0 && <span className="w-1.5 h-1.5 rounded-full bg-purple" />}
              {unreadMessages.length > 0 && <span className="w-1.5 h-1.5 rounded-full bg-rose" />}
            </div>
          )}
        </button>

        {/* Back button */}
        <button
          onClick={onBack}
          className="control-btn"
          title="Back to workspaces"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
        </button>

        {/* Workspace name */}
        <span className="text-sm font-medium text-slate-300 truncate max-w-[150px]" title={workspace.name || workspace.workingDirectory}>
          {workspace.name || workspace.workingDirectory.split('/').pop()}
        </span>

        {/* Divider */}
        <div className="w-px h-6 bg-charcoal-lighter" />

        {/* Terminal controls: X, up, down, copy, paste */}
        <button
          className="control-btn bg-rose/20 hover:bg-rose/30 border-rose/50"
          onClick={() => sendCtrlKey('C')}
          title="Terminate (Ctrl+C)"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        <button
          className="control-btn"
          onClick={() => handleKey('\x1b[A')}
          title="Up arrow"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
          </svg>
        </button>
        <button
          className="control-btn"
          onClick={() => handleKey('\x1b[B')}
          title="Down arrow"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        <button className="control-btn" onClick={handleCopy} title="Copy">
          Copy
        </button>
        <button className="control-btn" onClick={handlePaste} title="Paste">
          Paste
        </button>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Status and stop */}
        <div className="flex items-center gap-2">
          <span className={`status-dot ${connected ? 'status-working' : 'status-offline'}`} />
          <span className="text-xs text-slate-400 hidden sm:inline">
            {mayor?.status || 'starting...'}
          </span>
          <button
            onClick={onStop}
            disabled={stopping}
            className="px-2 py-1 bg-rose/20 text-rose text-xs font-medium rounded hover:bg-rose/30 transition-colors disabled:opacity-50"
          >
            {stopping ? 'Stop...' : 'Stop'}
          </button>
        </div>
      </header>

      {/* Main content area */}
      <div className="flex-1 flex min-h-0 relative">
        {/* Sidebar - now on the left, no floating button */}
        <Sidebar
          workspace={workspace}
          beads={beads}
          agents={agents}
          progress={progress}
          messages={messages}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
          onSelectAgent={handleSelectAgentFromSidebar}
        />

        {/* Mayor terminal */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Terminal area */}
          <div className="flex-1 min-h-0 p-1">
            {mayor?.tmuxSession ? (
              <EmbeddedTerminal
                sessionName={mayor.tmuxSession}
                className="h-full"
                onReady={handleTerminalReady}
              />
            ) : (
              <div className="h-full bg-charcoal rounded-xl flex items-center justify-center">
                <div className="text-center">
                  <p className="text-slate-400 mb-2">Terminal not available</p>
                  <p className="text-xs text-slate-500">Status: {mayor?.status || 'starting...'}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Sub-agent tabs */}
      {subAgents.length > 0 && (
        <SubAgentTabs
          agents={agents}
          activeAgentId={activeSubAgentId}
          onSelectAgent={setActiveSubAgentId}
          collapsed={subAgentsPanelCollapsed}
          onToggleCollapse={() => setSubAgentsPanelCollapsed(!subAgentsPanelCollapsed)}
        />
      )}

      {/* Sub-agent panel */}
      {!subAgentsPanelCollapsed && activeSubAgent && (
        <div className="shrink-0 p-2 border-t border-charcoal-lighter bg-charcoal-light">
          <SubAgentPanel
            agent={activeSubAgent}
            onClose={() => setActiveSubAgentId(null)}
          />
        </div>
      )}
    </div>
  );
}
