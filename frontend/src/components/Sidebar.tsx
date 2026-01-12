import { useState } from 'react';
import { Workspace, Bead, Agent, ProgressEntry, Message } from '../types';

interface SidebarProps {
  workspace: Workspace;
  beads: Bead[];
  agents: Agent[];
  progress: ProgressEntry[];
  messages: Message[];
  collapsed: boolean;
  onToggleCollapse: () => void;
  onSelectAgent: (agent: Agent) => void;
}

function formatTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return date.toLocaleDateString();
}

export default function Sidebar({
  workspace,
  beads,
  agents,
  progress,
  messages,
  collapsed,
  onToggleCollapse,
  onSelectAgent
}: SidebarProps) {
  const [expandedSections, setExpandedSections] = useState({
    workspace: true,
    beads: true,
    agents: true,
    activity: true,
    messages: false
  });

  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const subAgents = agents.filter(a => a.role !== 'mayor');
  const mayor = agents.find(a => a.role === 'mayor');
  const recentProgress = progress.slice(-5).reverse();
  const unreadMessages = messages.filter(m => !m.read);
  const recentMessages = messages.slice(-5).reverse();

  const beadCounts = {
    todo: beads.filter(b => b.status === 'todo').length,
    inProgress: beads.filter(b => b.status === 'in_progress').length,
    done: beads.filter(b => b.status === 'done').length,
    blocked: beads.filter(b => b.status === 'blocked').length
  };

  // When collapsed, render nothing - toggle is in the header bar
  if (collapsed) {
    return null;
  }

  return (
    <div className="w-72 bg-charcoal-light border-r border-charcoal-lighter flex flex-col shrink-0 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-charcoal-lighter shrink-0">
        <span className="text-sm font-medium text-slate-300">Status</span>
        <button
          onClick={onToggleCollapse}
          className="text-slate-500 hover:text-slate-300 transition-colors p-1"
          title="Collapse sidebar"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
        </button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        {/* Workspace Section */}
        <div className="border-b border-charcoal-lighter">
          <button
            onClick={() => toggleSection('workspace')}
            className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-charcoal-lighter/50"
          >
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">Workspace</span>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className={`h-4 w-4 text-slate-500 transition-transform ${expandedSections.workspace ? 'rotate-180' : ''}`}
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
          {expandedSections.workspace && (
            <div className="px-3 pb-3 space-y-2">
              <div className="text-xs text-slate-500 truncate" title={workspace.workingDirectory}>
                {workspace.workingDirectory}
              </div>
              <div className="flex items-center gap-2">
                <span className={`status-dot ${mayor?.status === 'working' ? 'status-working' : mayor?.status === 'starting' ? 'status-starting' : 'status-offline'}`} />
                <span className="text-xs text-slate-400">
                  Orchestrator: {mayor?.status || 'starting...'}
                </span>
              </div>
              <div className="text-xs text-slate-500">
                Active {formatRelativeTime(workspace.lastActivity)}
              </div>
            </div>
          )}
        </div>

        {/* Beads Section */}
        <div className="border-b border-charcoal-lighter">
          <button
            onClick={() => toggleSection('beads')}
            className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-charcoal-lighter/50"
          >
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
              Beads ({beads.length})
            </span>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className={`h-4 w-4 text-slate-500 transition-transform ${expandedSections.beads ? 'rotate-180' : ''}`}
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
          {expandedSections.beads && (
            <div className="px-3 pb-3">
              {beads.length === 0 ? (
                <p className="text-xs text-slate-500 italic">No beads yet</p>
              ) : (
                <>
                  {/* Status summary */}
                  <div className="grid grid-cols-4 gap-1 mb-3">
                    <div className="text-center p-1.5 bg-charcoal rounded">
                      <div className="text-sm font-bold text-slate-400">{beadCounts.todo}</div>
                      <div className="text-[10px] text-slate-500">Todo</div>
                    </div>
                    <div className="text-center p-1.5 bg-charcoal rounded">
                      <div className="text-sm font-bold text-cyan">{beadCounts.inProgress}</div>
                      <div className="text-[10px] text-slate-500">Active</div>
                    </div>
                    <div className="text-center p-1.5 bg-charcoal rounded">
                      <div className="text-sm font-bold text-emerald">{beadCounts.done}</div>
                      <div className="text-[10px] text-slate-500">Done</div>
                    </div>
                    <div className="text-center p-1.5 bg-charcoal rounded">
                      <div className="text-sm font-bold text-amber">{beadCounts.blocked}</div>
                      <div className="text-[10px] text-slate-500">Blocked</div>
                    </div>
                  </div>

                  {/* Active beads list */}
                  <div className="space-y-1.5 max-h-32 overflow-y-auto">
                    {beads
                      .filter(b => b.status === 'in_progress' || b.status === 'blocked')
                      .slice(0, 5)
                      .map(bead => (
                        <div
                          key={bead.id}
                          className="p-2 bg-charcoal rounded text-xs"
                          title={bead.description}
                        >
                          <div className="flex items-center gap-1.5">
                            <span className={`status-dot ${bead.status === 'in_progress' ? 'status-in_progress' : 'status-blocked'}`} />
                            <span className="font-mono text-slate-500">{bead.id}</span>
                          </div>
                          <div className="text-slate-300 truncate mt-1">{bead.title}</div>
                          {bead.assignee && (
                            <div className="text-slate-500 text-[10px] mt-0.5">
                              Assigned: {bead.assignee}
                            </div>
                          )}
                        </div>
                      ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Sub-Agents Section */}
        <div className="border-b border-charcoal-lighter">
          <button
            onClick={() => toggleSection('agents')}
            className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-charcoal-lighter/50"
          >
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
              Sub-Agents ({subAgents.length})
            </span>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className={`h-4 w-4 text-slate-500 transition-transform ${expandedSections.agents ? 'rotate-180' : ''}`}
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
          {expandedSections.agents && (
            <div className="px-3 pb-3">
              {subAgents.length === 0 ? (
                <p className="text-xs text-slate-500 italic">No sub-agents spawned</p>
              ) : (
                <div className="space-y-1.5">
                  {subAgents.map(agent => (
                    <button
                      key={agent.id}
                      onClick={() => onSelectAgent(agent)}
                      className="w-full p-2 bg-charcoal rounded text-xs text-left hover:bg-charcoal-lighter transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <span className={`status-dot status-${agent.status}`} />
                          <span className="text-slate-300 font-medium">{agent.name}</span>
                        </div>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                          agent.model === 'opus' ? 'bg-purple/20 text-purple' :
                          agent.model === 'sonnet' ? 'bg-cyan/20 text-cyan' :
                          'bg-emerald/20 text-emerald'
                        }`}>
                          {agent.model}
                        </span>
                      </div>
                      <div className="text-slate-500 text-[10px] mt-1 capitalize">
                        {agent.role} - {agent.status}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Activity Section */}
        <div className="border-b border-charcoal-lighter">
          <button
            onClick={() => toggleSection('activity')}
            className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-charcoal-lighter/50"
          >
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
              Recent Activity
            </span>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className={`h-4 w-4 text-slate-500 transition-transform ${expandedSections.activity ? 'rotate-180' : ''}`}
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
          {expandedSections.activity && (
            <div className="px-3 pb-3">
              {recentProgress.length === 0 ? (
                <p className="text-xs text-slate-500 italic">No activity yet</p>
              ) : (
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {recentProgress.map(entry => (
                    <div key={entry.id} className="text-xs">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400 font-medium">{entry.agentName}</span>
                        <span className="text-slate-500 text-[10px]">{formatTime(entry.timestamp)}</span>
                      </div>
                      <div className="text-slate-500 mt-0.5">{entry.status}</div>
                      {entry.completed.length > 0 && (
                        <div className="text-emerald text-[10px] mt-0.5">
                          Completed: {entry.completed.slice(0, 2).join(', ')}
                          {entry.completed.length > 2 && ` +${entry.completed.length - 2}`}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Messages Section */}
        <div>
          <button
            onClick={() => toggleSection('messages')}
            className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-charcoal-lighter/50"
          >
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
              Messages {unreadMessages.length > 0 && (
                <span className="ml-1 px-1.5 py-0.5 bg-rose text-white rounded-full text-[10px]">
                  {unreadMessages.length}
                </span>
              )}
            </span>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className={`h-4 w-4 text-slate-500 transition-transform ${expandedSections.messages ? 'rotate-180' : ''}`}
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
          {expandedSections.messages && (
            <div className="px-3 pb-3">
              {recentMessages.length === 0 ? (
                <p className="text-xs text-slate-500 italic">No messages yet</p>
              ) : (
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {recentMessages.map(msg => (
                    <div
                      key={msg.id}
                      className={`text-xs p-2 rounded ${
                        msg.type === 'blocker' ? 'bg-rose/10 border border-rose/30' :
                        msg.type === 'completion' ? 'bg-emerald/10 border border-emerald/30' :
                        msg.type === 'action_required' ? 'bg-amber/10 border border-amber/30' :
                        'bg-charcoal'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">{msg.from} → {msg.to}</span>
                        <span className="text-slate-500 text-[10px]">{formatTime(msg.timestamp)}</span>
                      </div>
                      <div className="text-slate-300 mt-1 line-clamp-2">{msg.content}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
