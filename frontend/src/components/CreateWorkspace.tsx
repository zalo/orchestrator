import { useState } from 'react';
import { Workspace } from '../types';
import FolderBrowser from './FolderBrowser';

interface CreateWorkspaceProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (workspace: Workspace) => void;
}

export default function CreateWorkspace({ isOpen, onClose, onCreated }: CreateWorkspaceProps) {
  const [name, setName] = useState('');
  const [workingDirectory, setWorkingDirectory] = useState('');
  const [showFolderBrowser, setShowFolderBrowser] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!name.trim() || !workingDirectory.trim()) return;

    setCreating(true);
    setError(null);

    try {
      // Step 1: Create the workspace
      const createRes = await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          workingDirectory: workingDirectory.trim()
        })
      });

      if (!createRes.ok) {
        const data = await createRes.json();
        throw new Error(data.error || 'Failed to create workspace');
      }

      const workspace: Workspace = await createRes.json();

      // Step 2: Start the workspace (start the Mayor)
      const startRes = await fetch(`/api/workspaces/${workspace.id}/start`, {
        method: 'POST'
      });

      if (!startRes.ok) {
        const data = await startRes.json();
        throw new Error(data.error || 'Workspace created but failed to start');
      }

      const startedWorkspace: Workspace = (await startRes.json()).workspace;

      // Reset form
      setName('');
      setWorkingDirectory('');

      // Notify parent
      onCreated(startedWorkspace);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const handleClose = () => {
    if (!creating) {
      setName('');
      setWorkingDirectory('');
      setError(null);
      onClose();
    }
  };

  const handleFolderSelect = (path: string) => {
    setWorkingDirectory(path);
    setShowFolderBrowser(false);
    // Auto-fill name from folder name if empty
    if (!name.trim()) {
      const folderName = path.split('/').filter(Boolean).pop();
      if (folderName) {
        setName(folderName);
      }
    }
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
        <div className="bg-charcoal-light border border-charcoal-lighter rounded-xl w-full max-w-md overflow-hidden">
          {/* Header */}
          <div className="px-4 py-3 border-b border-charcoal-lighter flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-100">Create Workspace</h2>
            <button
              onClick={handleClose}
              disabled={creating}
              className="text-slate-400 hover:text-slate-200 p-1 disabled:opacity-50"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
          </div>

          {/* Form */}
          <div className="p-4 space-y-4">
            {/* Name Input */}
            <div>
              <label htmlFor="workspace-name" className="block text-sm font-medium text-slate-300 mb-2">
                Workspace Name
              </label>
              <input
                type="text"
                id="workspace-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My Project"
                className="w-full bg-charcoal border border-charcoal-lighter rounded-lg px-3 py-2.5 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan focus:border-transparent"
                disabled={creating}
                autoFocus
              />
            </div>

            {/* Folder Selector */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Working Directory
              </label>
              <div className="flex gap-2">
                <div className="flex-1 relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                      <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                    </svg>
                  </span>
                  <input
                    type="text"
                    value={workingDirectory}
                    onChange={(e) => setWorkingDirectory(e.target.value)}
                    placeholder="/path/to/project"
                    className="w-full bg-charcoal border border-charcoal-lighter rounded-lg pl-10 pr-3 py-2.5 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan focus:border-transparent"
                    disabled={creating}
                  />
                </div>
                <button
                  onClick={() => setShowFolderBrowser(true)}
                  disabled={creating}
                  className="bg-charcoal-lighter text-slate-300 px-3 py-2.5 rounded-lg hover:bg-charcoal transition-colors disabled:opacity-50 min-h-[44px]"
                  title="Browse folders"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 6.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 5.414V13a1 1 0 11-2 0V5.414L7.707 6.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>
              <p className="mt-1.5 text-xs text-slate-500">
                Select the root directory of your project
              </p>
            </div>

            {/* Error Message */}
            {error && (
              <div className="bg-rose/10 border border-rose/30 rounded-lg p-3 text-rose text-sm">
                {error}
              </div>
            )}
          </div>

          {/* Footer Actions */}
          <div className="px-4 py-3 border-t border-charcoal-lighter flex items-center justify-end gap-2">
            <button
              onClick={handleClose}
              disabled={creating}
              className="px-4 py-2 text-slate-400 hover:text-slate-200 transition-colors min-h-[44px] disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={creating || !name.trim() || !workingDirectory.trim()}
              className="bg-gradient-to-r from-cyan to-purple text-charcoal font-semibold py-2 px-6 rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px] flex items-center gap-2"
            >
              {creating ? (
                <>
                  <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Creating...
                </>
              ) : (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                  </svg>
                  Create & Start
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Folder Browser Modal (higher z-index) */}
      <FolderBrowser
        isOpen={showFolderBrowser}
        onClose={() => setShowFolderBrowser(false)}
        onSelect={handleFolderSelect}
        initialPath={workingDirectory || '/home'}
      />
    </>
  );
}
