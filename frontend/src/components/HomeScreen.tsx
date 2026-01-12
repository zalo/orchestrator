import { useState } from 'react';
import { Workspace } from '../types';
import AboutPage from './AboutPage';

interface HomeScreenProps {
  workspaces: Workspace[];
  onOpen: (id: string) => void;
  onStop: (id: string) => void;
  onDelete: (id: string) => void;
  onCreate: () => void;
}

type Tab = 'workspaces' | 'about';

function formatTimeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function truncatePath(path: string, maxLen = 40): string {
  if (path.length <= maxLen) return path;
  const parts = path.split('/');
  if (parts.length <= 3) return '...' + path.slice(-maxLen + 3);
  return '.../' + parts.slice(-2).join('/');
}

export default function HomeScreen({ workspaces, onOpen, onStop, onDelete, onCreate }: HomeScreenProps) {
  const [activeTab, setActiveTab] = useState<Tab>('workspaces');

  if (activeTab === 'about') {
    return (
      <div className="h-full flex flex-col">
        {/* Tab Navigation */}
        <div className="border-b border-charcoal-lighter px-4 sm:px-6">
          <div className="max-w-4xl mx-auto flex gap-1">
            <button
              onClick={() => setActiveTab('workspaces')}
              className="px-4 py-3 text-sm font-medium text-slate-400 hover:text-slate-200 transition-colors relative"
            >
              Workspaces
            </button>
            <button
              onClick={() => setActiveTab('about')}
              className="px-4 py-3 text-sm font-medium text-slate-100 transition-colors relative"
            >
              About
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-cyan to-purple" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-hidden">
          <AboutPage />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Tab Navigation */}
      <div className="border-b border-charcoal-lighter px-4 sm:px-6">
        <div className="max-w-4xl mx-auto flex gap-1">
          <button
            onClick={() => setActiveTab('workspaces')}
            className="px-4 py-3 text-sm font-medium text-slate-100 transition-colors relative"
          >
            Workspaces
            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-cyan to-purple" />
          </button>
          <button
            onClick={() => setActiveTab('about')}
            className="px-4 py-3 text-sm font-medium text-slate-400 hover:text-slate-200 transition-colors relative"
          >
            About
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4 sm:p-6">
        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold text-slate-100">Workspaces</h1>
              <p className="text-slate-400 text-sm mt-1">
                {workspaces.length === 0
                  ? 'Create your first workspace to get started'
                  : `${workspaces.length} workspace${workspaces.length !== 1 ? 's' : ''}`
                }
              </p>
            </div>
            <button
              onClick={onCreate}
              className="flex items-center gap-2 bg-gradient-to-r from-cyan to-purple text-charcoal font-semibold py-2.5 px-4 rounded-lg hover:opacity-90 transition-opacity min-h-[44px]"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
              </svg>
              <span className="hidden sm:inline">Create Workspace</span>
              <span className="sm:hidden">New</span>
            </button>
          </div>

        {/* Workspace Grid */}
        {workspaces.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-20 h-20 rounded-2xl bg-charcoal-light border border-charcoal-lighter flex items-center justify-center mx-auto mb-4">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-slate-500" viewBox="0 0 20 20" fill="currentColor">
                <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
              </svg>
            </div>
            <h3 className="text-lg font-medium text-slate-300 mb-2">No workspaces yet</h3>
            <p className="text-slate-500 text-sm mb-6 max-w-sm mx-auto">
              Create a workspace to start orchestrating your projects with the Mayor agent.
            </p>
            <button
              onClick={onCreate}
              className="inline-flex items-center gap-2 bg-gradient-to-r from-cyan to-purple text-charcoal font-semibold py-3 px-6 rounded-lg hover:opacity-90 transition-opacity"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
              </svg>
              Create Your First Workspace
            </button>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {workspaces.map((workspace) => (
              <div
                key={workspace.id}
                className="bg-charcoal-light border border-charcoal-lighter rounded-xl p-4 card-hover"
              >
                {/* Card Header */}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                      workspace.status === 'active'
                        ? 'bg-emerald/20'
                        : 'bg-charcoal-lighter'
                    }`}>
                      <svg xmlns="http://www.w3.org/2000/svg" className={`h-5 w-5 ${
                        workspace.status === 'active' ? 'text-emerald' : 'text-slate-500'
                      }`} viewBox="0 0 20 20" fill="currentColor">
                        <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                      </svg>
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold text-slate-100 truncate">{workspace.name}</h3>
                      <p className="text-xs text-slate-500 truncate" title={workspace.workingDirectory}>
                        {truncatePath(workspace.workingDirectory)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className={`status-dot ${
                      workspace.status === 'active' ? 'status-working' : 'status-offline'
                    }`} />
                    <span className={`text-xs ${
                      workspace.status === 'active' ? 'text-emerald' : 'text-slate-500'
                    }`}>
                      {workspace.status === 'active' ? 'Active' : 'Stopped'}
                    </span>
                  </div>
                </div>

                {/* Last Activity */}
                <div className="text-xs text-slate-500 mb-4">
                  Last activity: {formatTimeAgo(workspace.lastActivity)}
                </div>

                {/* Actions */}
                <div className="flex gap-2">
                  {workspace.status === 'active' ? (
                    <>
                      <button
                        onClick={() => onOpen(workspace.id)}
                        className="flex-1 flex items-center justify-center gap-1.5 bg-emerald/20 text-emerald font-medium py-2 px-3 rounded-lg hover:bg-emerald/30 transition-colors min-h-[44px]"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                          <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
                          <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
                        </svg>
                        Open
                      </button>
                      <button
                        onClick={() => onStop(workspace.id)}
                        className="flex items-center justify-center gap-1.5 bg-rose/20 text-rose font-medium py-2 px-3 rounded-lg hover:bg-rose/30 transition-colors min-h-[44px]"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1V8a1 1 0 00-1-1H8z" clipRule="evenodd" />
                        </svg>
                        Stop
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => onOpen(workspace.id)}
                        className="flex-1 flex items-center justify-center gap-1.5 bg-cyan/20 text-cyan font-medium py-2 px-3 rounded-lg hover:bg-cyan/30 transition-colors min-h-[44px]"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                        </svg>
                        Start
                      </button>
                      <button
                        onClick={() => onDelete(workspace.id)}
                        className="flex items-center justify-center bg-charcoal-lighter text-slate-400 font-medium py-2 px-3 rounded-lg hover:bg-rose/20 hover:text-rose transition-colors min-h-[44px]"
                        title="Delete workspace"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        </div>
      </div>
    </div>
  );
}
