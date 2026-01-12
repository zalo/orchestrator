import { useState, useEffect, useCallback, useRef } from 'react';
import { Workspace, Bead, Agent, ProgressEntry, Message } from './types';
import HomeScreen from './components/HomeScreen';
import CreateWorkspace from './components/CreateWorkspace';
import MayorView from './components/MayorView';

type ViewState = 'home' | 'workspace';

// Slugify workspace name to match server-side logic
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 30);
}

// Get workspace name from URL path
function getWorkspaceNameFromUrl(): string | null {
  const path = window.location.pathname;
  if (path === '/' || path === '') return null;
  // Remove leading slash and decode
  return decodeURIComponent(path.slice(1));
}

// Update URL to reflect current workspace
function updateUrl(workspaceName: string | null) {
  const newPath = workspaceName ? `/${encodeURIComponent(slugify(workspaceName))}` : '/';
  if (window.location.pathname !== newPath) {
    window.history.pushState({}, '', newPath);
  }
}

function App() {
  // Multi-workspace state
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [view, setView] = useState<ViewState>('home');
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [initialUrlChecked, setInitialUrlChecked] = useState(false);

  // Active workspace data
  const [beads, setBeads] = useState<Bead[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [progress, setProgress] = useState<ProgressEntry[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);

  // UI state
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [stopping, setStopping] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  // Get active workspace
  const activeWorkspace = workspaces.find(w => w.id === activeWorkspaceId) || null;

  // Fetch all workspaces on mount
  const fetchWorkspaces = useCallback(async () => {
    try {
      const res = await fetch('/api/workspaces');
      if (res.ok) {
        const data = await res.json();
        setWorkspaces(data);
        return data as Workspace[];
      }
    } catch (err) {
      console.error('Failed to fetch workspaces:', err);
    } finally {
      setLoading(false);
    }
    return [];
  }, []);

  // Check URL for workspace name on initial load
  useEffect(() => {
    const initFromUrl = async () => {
      const fetchedWorkspaces = await fetchWorkspaces();
      const urlWorkspaceName = getWorkspaceNameFromUrl();

      if (urlWorkspaceName && fetchedWorkspaces.length > 0) {
        // Try to find workspace by slug
        const workspace = fetchedWorkspaces.find(
          w => slugify(w.name) === urlWorkspaceName
        );

        if (workspace) {
          // Found workspace - fetch its data including updated agent statuses
          try {
            const res = await fetch(`/api/workspaces/by-name/${encodeURIComponent(urlWorkspaceName)}`);
            if (res.ok) {
              const data = await res.json();
              // Update workspace in list with fresh data
              setWorkspaces(prev => prev.map(w => w.id === data.id ? { ...w, ...data } : w));
              // If agents are included, update them
              if (data.agents) {
                setAgents(data.agents);
              }
              setActiveWorkspaceId(workspace.id);
              setView('workspace');
            }
          } catch (err) {
            console.error('Failed to fetch workspace by name:', err);
          }
        }
      }
      setInitialUrlChecked(true);
    };

    initFromUrl();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle browser back/forward navigation
  useEffect(() => {
    const handlePopState = () => {
      const urlWorkspaceName = getWorkspaceNameFromUrl();
      if (urlWorkspaceName) {
        const workspace = workspaces.find(w => slugify(w.name) === urlWorkspaceName);
        if (workspace) {
          setActiveWorkspaceId(workspace.id);
          setView('workspace');
        }
      } else {
        setActiveWorkspaceId(null);
        setView('home');
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [workspaces]);

  // Fetch workspace-specific data when active workspace changes
  const fetchWorkspaceData = useCallback(async (workspaceId: string) => {
    try {
      const [beadsRes, agentsRes, progressRes, messagesRes] = await Promise.all([
        fetch(`/api/beads?workspaceId=${workspaceId}`),
        fetch(`/api/agents?workspaceId=${workspaceId}`),
        fetch('/api/progress'),
        fetch('/api/messages')
      ]);
      setBeads(await beadsRes.json());
      setAgents(await agentsRes.json());
      setProgress(await progressRes.json());
      setMessages(await messagesRes.json());
    } catch (err) {
      console.error('Failed to fetch workspace data:', err);
    }
  }, []);

  useEffect(() => {
    if (activeWorkspaceId) {
      fetchWorkspaceData(activeWorkspaceId);
    }
  }, [activeWorkspaceId, fetchWorkspaceData]);

  // WebSocket connection
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      // Subscribe to active workspace if one is set
      if (activeWorkspaceId) {
        ws.send(JSON.stringify({ type: 'subscribe', workspaceId: activeWorkspaceId }));
      }
    };

    ws.onclose = () => {
      setConnected(false);
      // Attempt reconnection
      setTimeout(() => {
        if (wsRef.current?.readyState === WebSocket.CLOSED) {
          window.location.reload();
        }
      }, 5000);
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);

      switch (msg.type) {
        case 'init':
          // Initial state from server - may include workspaces
          if (msg.data.workspaces) {
            setWorkspaces(msg.data.workspaces);
          }
          if (msg.data.workspace) {
            // Legacy single-workspace support
            setWorkspaces(prev => {
              const exists = prev.find(w => w.id === msg.data.workspace.id);
              if (exists) return prev;
              return [...prev, msg.data.workspace];
            });
          }
          // Only update workspace-specific data if provided (not in init)
          if (msg.data.beads) setBeads(msg.data.beads);
          if (msg.data.agents) setAgents(msg.data.agents);
          if (msg.data.progress) setProgress(msg.data.progress);
          if (msg.data.messages) setMessages(msg.data.messages);
          break;

        // Workspace events
        case 'workspace:created':
          setWorkspaces(prev => [...prev, msg.data]);
          break;

        case 'workspace:started':
        case 'workspace:updated':
          setWorkspaces(prev => {
            const idx = prev.findIndex(w => w.id === msg.data.id);
            if (idx >= 0) {
              const updated = [...prev];
              updated[idx] = msg.data;
              return updated;
            }
            return [...prev, msg.data];
          });
          break;

        case 'workspace:stopped':
          setWorkspaces(prev => {
            const idx = prev.findIndex(w => w.id === msg.data.id);
            if (idx >= 0) {
              const updated = [...prev];
              updated[idx] = msg.data;
              return updated;
            }
            return prev;
          });
          break;

        case 'workspace:deleted':
          setWorkspaces(prev => prev.filter(w => w.id !== msg.data.id));
          // If deleted workspace was active, go back to home
          if (activeWorkspaceId === msg.data.id) {
            setActiveWorkspaceId(null);
            setView('home');
          }
          break;

        // Legacy mayor events (map to workspace events)
        case 'mayor:started':
          if (msg.data.workspace) {
            setWorkspaces(prev => {
              const idx = prev.findIndex(w => w.id === msg.data.workspace.id);
              if (idx >= 0) {
                const updated = [...prev];
                updated[idx] = msg.data.workspace;
                return updated;
              }
              return [...prev, msg.data.workspace];
            });
          }
          if (msg.data.mayor) {
            setAgents(prev => {
              const exists = prev.find(a => a.id === msg.data.mayor.id);
              if (exists) return prev;
              return [...prev, msg.data.mayor];
            });
          }
          break;

        case 'mayor:stopped':
          if (msg.data.workspace) {
            setWorkspaces(prev => {
              const idx = prev.findIndex(w => w.id === msg.data.workspace.id);
              if (idx >= 0) {
                const updated = [...prev];
                updated[idx] = msg.data.workspace;
                return updated;
              }
              return prev;
            });
          }
          break;

        // Bead events
        case 'bead:created':
        case 'bead:updated':
          setBeads(prev => {
            const idx = prev.findIndex(b => b.id === msg.data.id);
            if (idx >= 0) {
              const updated = [...prev];
              updated[idx] = msg.data;
              return updated;
            }
            return [...prev, msg.data];
          });
          break;

        case 'bead:deleted':
          setBeads(prev => prev.filter(b => b.id !== msg.data.id));
          break;

        // Agent events
        case 'agent:created':
        case 'agent:updated':
          setAgents(prev => {
            const idx = prev.findIndex(a => a.id === msg.data.id);
            if (idx >= 0) {
              const updated = [...prev];
              updated[idx] = { ...updated[idx], ...msg.data };
              return updated;
            }
            if (msg.type === 'agent:created') {
              return [...prev, msg.data];
            }
            return prev;
          });
          break;

        case 'agent:deleted':
          setAgents(prev => prev.filter(a => a.id !== msg.data.id));
          break;

        // Progress and messages
        case 'progress:new':
          setProgress(prev => [...prev, msg.data]);
          break;

        case 'message:new':
          setMessages(prev => [...prev, msg.data]);
          break;
      }
    };

    return () => ws.close();
  }, [activeWorkspaceId]);

  // Send subscribe message when active workspace changes
  useEffect(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN && activeWorkspaceId) {
      wsRef.current.send(JSON.stringify({ type: 'subscribe', workspaceId: activeWorkspaceId }));
    }
  }, [activeWorkspaceId]);

  // Handle opening a workspace
  const handleOpenWorkspace = async (id: string) => {
    const workspace = workspaces.find(w => w.id === id);
    if (!workspace) return;

    // If stopped, start it first
    if (workspace.status === 'stopped') {
      try {
        const res = await fetch(`/api/workspaces/${id}/start`, { method: 'POST' });
        if (!res.ok) {
          const data = await res.json();
          console.error('Failed to start workspace:', data.error);
          return;
        }
        const { workspace: startedWorkspace, mayor } = await res.json();
        setWorkspaces(prev => {
          const idx = prev.findIndex(w => w.id === id);
          if (idx >= 0) {
            const updated = [...prev];
            updated[idx] = startedWorkspace;
            return updated;
          }
          return prev;
        });
        // Add the new mayor agent to agents list
        if (mayor) {
          setAgents(prev => {
            const exists = prev.find(a => a.id === mayor.id);
            if (exists) return prev;
            return [...prev, mayor];
          });
        }
      } catch (err) {
        console.error('Failed to start workspace:', err);
        return;
      }
    }

    setActiveWorkspaceId(id);
    setView('workspace');
    updateUrl(workspace.name);
  };

  // Handle stopping a workspace
  const handleStopWorkspace = async (id: string) => {
    setStopping(true);
    try {
      const res = await fetch(`/api/workspaces/${id}/stop`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json();
        console.error('Failed to stop workspace:', data.error);
        return;
      }
      const { workspace: stoppedWorkspace } = await res.json();
      setWorkspaces(prev => {
        const idx = prev.findIndex(w => w.id === id);
        if (idx >= 0) {
          const updated = [...prev];
          updated[idx] = stoppedWorkspace;
          return updated;
        }
        return prev;
      });
    } catch (err) {
      console.error('Failed to stop workspace:', err);
    } finally {
      setStopping(false);
    }
  };

  // Handle deleting a workspace
  const handleDeleteWorkspace = async (id: string) => {
    if (!confirm('Are you sure you want to delete this workspace?')) return;

    try {
      const res = await fetch(`/api/workspaces/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        console.error('Failed to delete workspace:', data.error);
        return;
      }
      setWorkspaces(prev => prev.filter(w => w.id !== id));
    } catch (err) {
      console.error('Failed to delete workspace:', err);
    }
  };

  // Handle workspace created
  const handleWorkspaceCreated = (workspace: Workspace) => {
    setWorkspaces(prev => [...prev, workspace]);
    setShowCreateModal(false);
    // Auto-open the new workspace
    setActiveWorkspaceId(workspace.id);
    setView('workspace');
    updateUrl(workspace.name);
  };

  // Handle stop from within MayorView
  const handleStopFromView = async () => {
    if (!activeWorkspaceId) return;
    await handleStopWorkspace(activeWorkspaceId);
    // Go back to home
    setActiveWorkspaceId(null);
    setView('home');
  };

  if (loading || !initialUrlChecked) {
    return (
      <div className="h-dvh flex items-center justify-center bg-charcoal">
        <div className="text-center">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan to-purple flex items-center justify-center mx-auto mb-4 animate-pulse">
            <span className="text-charcoal font-bold text-xl">O</span>
          </div>
          <p className="text-slate-400">Loading...</p>
        </div>
      </div>
    );
  }

  // Handle back to home from MayorView
  const handleBackToHome = () => {
    setActiveWorkspaceId(null);
    setView('home');
    updateUrl(null);
  };

  // Workspace view
  if (view === 'workspace' && activeWorkspace) {
    return (
      <div className="h-dvh flex flex-col bg-charcoal">
        <MayorView
          workspace={activeWorkspace}
          beads={beads}
          agents={agents}
          progress={progress}
          messages={messages}
          onStop={handleStopFromView}
          onBack={handleBackToHome}
          stopping={stopping}
          connected={connected}
        />
      </div>
    );
  }

  // Home view with workspace list
  return (
    <div className="h-dvh flex flex-col bg-charcoal">
      {/* Header */}
      <header className="bg-charcoal-light border-b border-charcoal-lighter px-4 py-2 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan to-purple flex items-center justify-center">
            <span className="text-charcoal font-bold text-sm">O</span>
          </div>
          <div>
            <h1 className="text-lg font-semibold text-slate-100">Orchestrator</h1>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`status-dot ${connected ? 'status-working' : 'status-offline'}`} />
          <span className="text-sm text-slate-400">{connected ? 'Connected' : 'Disconnected'}</span>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-hidden">
        <HomeScreen
          workspaces={workspaces}
          onOpen={handleOpenWorkspace}
          onStop={handleStopWorkspace}
          onDelete={handleDeleteWorkspace}
          onCreate={() => setShowCreateModal(true)}
        />
      </main>

      {/* Create Workspace Modal */}
      <CreateWorkspace
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreated={handleWorkspaceCreated}
      />
    </div>
  );
}

export default App;
