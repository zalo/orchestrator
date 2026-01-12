import { useState } from 'react';

interface StartMayorProps {
  onStart: (workingDirectory: string) => Promise<void>;
  loading: boolean;
  error: string | null;
}

export default function StartMayor({ onStart, loading, error }: StartMayorProps) {
  const [workingDirectory, setWorkingDirectory] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (workingDirectory.trim()) {
      await onStart(workingDirectory.trim());
    }
  };

  return (
    <div className="h-full flex items-center justify-center p-8">
      <div className="max-w-lg w-full">
        <div className="text-center mb-8">
          <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-cyan to-purple flex items-center justify-center mx-auto mb-4">
            <span className="text-charcoal font-bold text-3xl">M</span>
          </div>
          <h1 className="text-3xl font-bold text-slate-100 mb-2">Mayor Orchestrator</h1>
          <p className="text-slate-400">
            Start the Mayor to begin orchestrating your workspace.
            The Mayor will help you plan, delegate, and coordinate work.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="workingDirectory" className="block text-sm font-medium text-slate-300 mb-2">
              Working Directory
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                </svg>
              </span>
              <input
                type="text"
                id="workingDirectory"
                value={workingDirectory}
                onChange={(e) => setWorkingDirectory(e.target.value)}
                placeholder="/path/to/your/project"
                className="w-full bg-charcoal-lighter border border-charcoal-lighter rounded-lg px-10 py-3 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan focus:border-transparent"
                disabled={loading}
                autoFocus
              />
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Enter the absolute path to your project directory
            </p>
          </div>

          {error && (
            <div className="bg-rose/10 border border-rose/30 rounded-lg p-3 text-rose text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !workingDirectory.trim()}
            className="w-full bg-gradient-to-r from-cyan to-purple text-charcoal font-semibold py-3 px-6 rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Starting Mayor...
              </>
            ) : (
              <>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                </svg>
                Start Mayor
              </>
            )}
          </button>
        </form>

        <div className="mt-8 p-4 bg-charcoal-light rounded-xl border border-charcoal-lighter">
          <h3 className="text-sm font-medium text-slate-300 mb-2">What happens next?</h3>
          <ul className="text-xs text-slate-500 space-y-1">
            <li className="flex items-start gap-2">
              <span className="text-cyan">1.</span>
              <span>Mayor starts in a tmux session with full workspace access</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-cyan">2.</span>
              <span>You'll chat with the Mayor through the terminal</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-cyan">3.</span>
              <span>Mayor creates beads (tasks) and spawns sub-agents as needed</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-cyan">4.</span>
              <span>Monitor progress in the sidebar while you work</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
