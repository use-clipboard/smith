'use client';

import { useState, useEffect } from 'react';
import { X, RefreshCw, FolderOpen, ChevronRight } from 'lucide-react';

interface DriveFolder { id: string; name: string; }

interface DriveFolderPickerProps {
  onSelect: (folder: DriveFolder, path: string) => void;
  onClose: () => void;
}

export default function DriveFolderPicker({ onSelect, onClose }: DriveFolderPickerProps) {
  const [stack, setStack]       = useState<{ id: string; name: string }[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [folders, setFolders]   = useState<DriveFolder[]>([]);
  const [loading, setLoading]   = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName]   = useState('');
  const [error, setError]       = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const url = currentId ? `/api/vault/folders?parent_id=${currentId}` : '/api/vault/folders';
    fetch(url)
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then(data => {
        setFolders(data.folders ?? []);
        if (stack.length === 0 && data.rootFolderId) {
          setStack([{ id: data.rootFolderId, name: data.parentName ?? 'Drive' }]);
          if (!currentId) setCurrentId(data.rootFolderId);
        }
      })
      .catch(() => setError('Failed to load folders'))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId]);

  function navigateInto(folder: DriveFolder) {
    setStack(s => [...s, folder]);
    setCurrentId(folder.id);
  }

  function navigateTo(index: number) {
    const entry = stack[index];
    setStack(s => s.slice(0, index + 1));
    setCurrentId(entry.id);
  }

  async function handleCreate() {
    if (!newName.trim() || !currentId) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch('/api/vault/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), parent_id: currentId }),
      });
      if (!res.ok) throw new Error('Failed to create folder');
      const created: DriveFolder = await res.json();
      setFolders(prev => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      setNewName('');
    } catch {
      setError('Could not create folder');
    } finally {
      setCreating(false);
    }
  }

  function handleSelect(folder: DriveFolder) {
    const path = [...stack.map(s => s.name), folder.name].join(' / ');
    onSelect(folder, path);
  }

  function handleSelectCurrent() {
    if (!stack.length) return;
    const current = stack[stack.length - 1];
    const path = stack.map(s => s.name).join(' / ');
    onSelect(current, path);
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
      <div className="bg-[var(--bg-card-solid)] border border-[var(--border)] rounded-xl shadow-2xl w-full max-w-md mx-4 flex flex-col max-h-[70vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] shrink-0">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Choose Drive Folder</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-[var(--bg-page)] text-[var(--text-muted)]">
            <X size={14} />
          </button>
        </div>

        {/* Breadcrumb */}
        {stack.length > 0 && (
          <div className="flex items-center gap-1 px-4 py-2 border-b border-[var(--border)] text-xs text-[var(--text-muted)] overflow-x-auto shrink-0 flex-wrap">
            {stack.map((entry, i) => (
              <span key={entry.id} className="flex items-center gap-1">
                {i > 0 && <ChevronRight size={10} className="shrink-0" />}
                <button
                  onClick={() => navigateTo(i)}
                  className={`hover:text-[var(--accent)] transition-colors truncate max-w-[120px] ${i === stack.length - 1 ? 'text-[var(--text-primary)] font-medium' : ''}`}
                >
                  {entry.name}
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Folder list */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <RefreshCw size={16} className="animate-spin text-[var(--text-muted)]" />
            </div>
          ) : error ? (
            <p className="px-4 py-3 text-sm text-red-600">{error}</p>
          ) : folders.length === 0 ? (
            <p className="px-4 py-6 text-sm text-center text-[var(--text-muted)]">No subfolders here</p>
          ) : (
            <ul className="py-1">
              {folders.map(f => (
                <li key={f.id}>
                  <button
                    onClick={() => navigateInto(f)}
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-page)] transition-colors text-left"
                  >
                    <FolderOpen size={14} className="text-amber-500 shrink-0" />
                    <span className="flex-1 truncate">{f.name}</span>
                    <ChevronRight size={12} className="text-[var(--text-muted)] shrink-0" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* New folder input */}
        <div className="px-4 py-3 border-t border-[var(--border)] shrink-0">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void handleCreate(); }}
              placeholder="New folder name…"
              className="flex-1 text-xs px-3 py-1.5 rounded border border-[var(--border)] bg-[var(--bg-page)] text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none focus:border-[var(--accent)]"
            />
            <button
              onClick={() => void handleCreate()}
              disabled={!newName.trim() || creating}
              className="px-3 py-1.5 text-xs rounded bg-[var(--bg-page)] border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--accent)]/10 disabled:opacity-40 whitespace-nowrap"
            >
              {creating ? '…' : '+ Create'}
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--border)] shrink-0">
          <button onClick={onClose} className="px-3 py-1.5 text-xs rounded border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-page)]">
            Cancel
          </button>
          <button
            onClick={handleSelectCurrent}
            disabled={stack.length === 0}
            className="px-4 py-1.5 text-xs rounded bg-[var(--accent)] text-white font-medium hover:bg-[var(--accent-hover)] disabled:opacity-50"
          >
            Select &ldquo;{stack[stack.length - 1]?.name}&rdquo;
          </button>
        </div>
      </div>
    </div>
  );
}
