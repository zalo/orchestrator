import { useState, useEffect, useCallback } from 'react';
import { FilesystemEntry, FilesystemResponse } from '../types';

interface FolderBrowserProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (path: string) => void;
  initialPath?: string;
}

export default function FolderBrowser({ isOpen, onClose, onSelect, initialPath }: FolderBrowserProps) {
  const [currentPath, setCurrentPath] = useState(initialPath || '/home');
  const [entries, setEntries] = useState<FilesystemEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [creating, setCreating] = useState(false);

  const fetchDirectory = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/filesystem?path=${encodeURIComponent(path)}`);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to load directory');
      }
      const data: FilesystemResponse = await res.json();
      setCurrentPath(data.path);
      // Filter to only show directories
      setEntries(data.entries.filter(e => e.type === 'directory').sort((a, b) => a.name.localeCompare(b.name)));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      fetchDirectory(currentPath);
    }
  }, [isOpen, fetchDirectory]); // Only on open, not on currentPath changes

  const navigateTo = (path: string) => {
    setCurrentPath(path);
    fetchDirectory(path);
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;

    setCreating(true);
    try {
      const newPath = `${currentPath}/${newFolderName.trim()}`;
      const res = await fetch('/api/filesystem/mkdir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: newPath })
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to create folder');
      }

      // Refresh the listing and navigate to new folder
      setNewFolderName('');
      setShowNewFolder(false);
      navigateTo(newPath);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  };

  // Parse path into breadcrumb segments
  const pathSegments = currentPath.split('/').filter(Boolean);
  const breadcrumbs = [
    { name: '/', path: '/' },
    ...pathSegments.map((segment, idx) => ({
      name: segment,
      path: '/' + pathSegments.slice(0, idx + 1).join('/')
    }))
  ];

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-charcoal-light border border-charcoal-lighter rounded-xl w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3 border-b border-charcoal-lighter shrink-0">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-slate-100">Select Folder</h2>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-200 p-1"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
          </div>

          {/* Breadcrumbs */}
          <div className="flex items-center gap-1 text-sm overflow-x-auto pb-1">
            {breadcrumbs.map((crumb, idx) => (
              <div key={crumb.path} className="flex items-center shrink-0">
                {idx > 0 && <span className="text-slate-600 mx-1">/</span>}
                <button
                  onClick={() => navigateTo(crumb.path)}
                  className={`hover:text-cyan transition-colors ${
                    idx === breadcrumbs.length - 1
                      ? 'text-cyan font-medium'
                      : 'text-slate-400'
                  }`}
                >
                  {crumb.name}
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Directory Listing */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <svg className="animate-spin h-6 w-6 text-cyan" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            </div>
          ) : error ? (
            <div className="p-4 text-center">
              <div className="text-rose text-sm mb-2">{error}</div>
              <button
                onClick={() => fetchDirectory(currentPath)}
                className="text-cyan text-sm hover:underline"
              >
                Retry
              </button>
            </div>
          ) : entries.length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-sm">
              No subdirectories
            </div>
          ) : (
            <div className="p-2">
              {entries.map((entry) => (
                <button
                  key={entry.name}
                  onClick={() => navigateTo(`${currentPath}/${entry.name}`)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-charcoal-lighter transition-colors text-left min-h-[44px]"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-amber shrink-0" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                  </svg>
                  <span className="text-slate-200 truncate">{entry.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* New Folder Input */}
        {showNewFolder && (
          <div className="px-4 py-3 border-t border-charcoal-lighter shrink-0">
            <div className="flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-amber shrink-0" viewBox="0 0 20 20" fill="currentColor">
                <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
              </svg>
              <input
                type="text"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="New folder name"
                className="flex-1 bg-charcoal border border-charcoal-lighter rounded-lg px-3 py-2 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan focus:border-transparent text-sm"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreateFolder();
                  if (e.key === 'Escape') {
                    setShowNewFolder(false);
                    setNewFolderName('');
                  }
                }}
                disabled={creating}
              />
              <button
                onClick={handleCreateFolder}
                disabled={creating || !newFolderName.trim()}
                className="bg-cyan/20 text-cyan px-3 py-2 rounded-lg hover:bg-cyan/30 transition-colors disabled:opacity-50 text-sm min-h-[40px]"
              >
                {creating ? '...' : 'Create'}
              </button>
              <button
                onClick={() => {
                  setShowNewFolder(false);
                  setNewFolderName('');
                }}
                className="text-slate-400 hover:text-slate-200 px-2 py-2"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            </div>
          </div>
        )}

        {/* Footer Actions */}
        <div className="px-4 py-3 border-t border-charcoal-lighter flex items-center justify-between shrink-0">
          <button
            onClick={() => setShowNewFolder(true)}
            disabled={showNewFolder}
            className="flex items-center gap-1.5 text-slate-400 hover:text-slate-200 text-sm transition-colors disabled:opacity-50 min-h-[44px] px-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
            </svg>
            New Folder
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-slate-400 hover:text-slate-200 transition-colors min-h-[44px]"
            >
              Cancel
            </button>
            <button
              onClick={() => onSelect(currentPath)}
              className="bg-gradient-to-r from-cyan to-purple text-charcoal font-semibold py-2 px-4 rounded-lg hover:opacity-90 transition-opacity min-h-[44px]"
            >
              Select This Folder
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
