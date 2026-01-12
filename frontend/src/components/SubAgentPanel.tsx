import { Agent } from '../types';
import EmbeddedTerminal from './EmbeddedTerminal';

interface SubAgentPanelProps {
  agent: Agent;
  onClose: () => void;
}

export default function SubAgentPanel({ agent, onClose }: SubAgentPanelProps) {
  if (!agent.tmuxSession) {
    return (
      <div className="h-64 bg-charcoal rounded-xl flex items-center justify-center">
        <div className="text-center">
          <p className="text-slate-500 mb-2">No terminal session for {agent.name}</p>
          <p className="text-xs text-slate-600">Agent status: {agent.status}</p>
        </div>
      </div>
    );
  }

  return (
    <EmbeddedTerminal
      sessionName={agent.tmuxSession}
      className="h-64"
      showHeader={true}
      title={`${agent.name} (${agent.model})`}
      onClose={onClose}
    />
  );
}
