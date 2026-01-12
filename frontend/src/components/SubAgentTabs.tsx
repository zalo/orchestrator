import { Agent } from '../types';

interface SubAgentTabsProps {
  agents: Agent[];
  activeAgentId: string | null;
  onSelectAgent: (id: string | null) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export default function SubAgentTabs({
  agents,
  activeAgentId,
  onSelectAgent,
  collapsed,
  onToggleCollapse
}: SubAgentTabsProps) {
  // Filter out mayor - only show sub-agents
  const subAgents = agents.filter(a => a.role !== 'mayor');

  if (subAgents.length === 0) {
    return null;
  }

  return (
    <div className="bg-charcoal-light border-t border-charcoal-lighter shrink-0">
      <div className="flex items-center gap-1 px-2 py-1.5 overflow-x-auto">
        {/* Collapse/Expand all button */}
        <button
          onClick={onToggleCollapse}
          className="flex items-center gap-1 px-2 py-1 text-xs text-slate-500 hover:text-slate-300 transition-colors shrink-0"
          title={collapsed ? 'Show agent terminals' : 'Hide agent terminals'}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className={`h-3.5 w-3.5 transition-transform ${collapsed ? '' : 'rotate-180'}`}
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
          {collapsed ? 'Show' : 'Hide'}
        </button>

        <div className="w-px h-4 bg-charcoal-lighter mx-1 shrink-0" />

        {/* Agent tabs */}
        {subAgents.map(agent => (
          <button
            key={agent.id}
            onClick={() => onSelectAgent(activeAgentId === agent.id ? null : agent.id)}
            className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs font-medium transition-colors shrink-0 ${
              activeAgentId === agent.id
                ? 'bg-cyan/20 text-cyan'
                : 'text-slate-400 hover:text-slate-200 hover:bg-charcoal-lighter'
            }`}
          >
            <span className={`status-dot status-${agent.status}`} />
            <span>{agent.name}</span>
            <span className={`px-1 py-0.5 rounded text-[10px] ${
              agent.model === 'opus' ? 'bg-purple/20 text-purple' :
              agent.model === 'sonnet' ? 'bg-cyan/20 text-cyan' :
              'bg-emerald/20 text-emerald'
            }`}>
              {agent.model}
            </span>
          </button>
        ))}

        {/* Agent count */}
        <span className="text-xs text-slate-500 ml-auto shrink-0">
          {subAgents.filter(a => a.status === 'working').length}/{subAgents.length} working
        </span>
      </div>
    </div>
  );
}
