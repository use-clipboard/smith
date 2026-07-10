'use client';

import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Folder, ChevronRight, Loader2, HardDrive, Check, FileText } from 'lucide-react';

interface DriveItem { id: string; name: string; type: string }
interface Crumb { id: string; name: string; isSharedDrive: boolean; driveId?: string }

interface Props {
  open: boolean;
  /** The firm's default Drive folder ("Agent Smith Files") — offered as a one-tap shortcut. */
  firmFolder?: { id: string; name: string } | null;
  /** The oversize file(s) that triggered the picker — shown so the user knows what's being uploaded. */
  files?: { name: string; size: number }[];
  /** 'upload' (default) = choosing a destination for a new file; 'move' = relocating an existing one. */
  mode?: 'upload' | 'move';
  onCancel: () => void;
  onSelect: (folder: { id: string; name: string }) => void;
}

/**
 * Compact Google Drive folder browser for choosing where a large email
 * attachment should be uploaded. Drills down through My Drive / shared drives
 * via /api/google-drive/browse and lets the user pick the current folder.
 */
export default function DriveFolderPicker({ open, firmFolder, files, mode = 'upload', onCancel, onSelect }: Props) {
  const isMove = mode === 'move';
  // Breadcrumb trail. The first entry is a virtual root that lists My Drive +
  // shared drives (parentId omitted). Deeper entries carry the folder id.
  const [trail, setTrail] = useState<Crumb[]>([{ id: 'root-list', name: 'Drives', isSharedDrive: false }]);
  const [items, setItems] = useState<DriveItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const current = trail[trail.length - 1];
  // The virtual root ("Drives") isn't a real folder you can upload into.
  const canSelectHere = current.id !== 'root-list';

  const load = useCallback(async (crumb: Crumb) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (crumb.id !== 'root-list') params.set('parentId', crumb.id);
      if (crumb.isSharedDrive) params.set('isSharedDrive', 'true');
      if (crumb.driveId) params.set('driveId', crumb.driveId);
      const res = await fetch(`/api/google-drive/browse?${params.toString()}`);
      if (!res.ok) {
        const e = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(e.error ?? 'Failed to browse Drive');
      }
      const data = await res.json() as { items: DriveItem[] };
      setItems(data.items ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to browse Drive');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // (Re)load whenever the window opens or we navigate to a new crumb.
  useEffect(() => {
    if (!open) return;
    load(current);
  }, [open, current, load]);

  // Reset the trail each time the picker is opened fresh.
  useEffect(() => {
    if (open) setTrail([{ id: 'root-list', name: 'Drives', isSharedDrive: false }]);
  }, [open]);

  if (!open || typeof document === 'undefined') return null;

  function openItem(item: DriveItem) {
    if (item.type === 'shared_drive') {
      setTrail(t => [...t, { id: item.id, name: item.name, isSharedDrive: true, driveId: item.id }]);
    } else {
      // 'root' (My Drive) or a regular folder. Carry the driveId of a shared
      // drive down so nested listing stays scoped to it.
      setTrail(t => [...t, { id: item.id, name: item.name, isSharedDrive: false, driveId: current.driveId }]);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onClick={onCancel}>
      <div
        className="w-full max-w-md bg-[var(--bg-card-solid)] rounded-xl shadow-2xl border border-[var(--border-card)] flex flex-col overflow-hidden"
        style={{ maxHeight: '70vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] bg-[var(--bg-nav)]">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
            <HardDrive size={15} className="text-blue-500" /> {isMove ? 'Move file in Google Drive' : 'Choose a Google Drive folder'}
          </h3>
          <button onClick={onCancel} aria-label="Cancel" className="p-1 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--border)]/40">
            <X size={16} />
          </button>
        </div>

        {/* Why this popped up */}
        <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--accent-light)]/30 text-xs text-[var(--text-secondary)] leading-relaxed">
          <p>
            {isMove ? (
              <>
                <span className="font-medium text-[var(--text-primary)]">Choose a new folder for this file.</span>{' '}
                The link in your email stays the same — only where the file lives in your Drive changes.
              </>
            ) : (
              <>
                <span className="font-medium text-[var(--text-primary)]">This file can’t be attached — it would take the email over Gmail’s 25&nbsp;MB limit.</span>{' '}
                It will be uploaded to Google Drive and shared as a link in your email, so your recipient can view and download it.
                Choose where to save it:
              </>
            )}
          </p>
          {files && files.length > 0 && (
            <ul className="mt-2 space-y-0.5">
              {files.map((f, i) => (
                <li key={i} className="flex items-center gap-1.5 text-[var(--text-muted)]">
                  <FileText size={11} className="shrink-0" />
                  <span className="truncate">{f.name}</span>
                  <span className="shrink-0">({(f.size / 1048576).toFixed(1)}&nbsp;MB)</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Firm-folder shortcut */}
        {firmFolder?.id && (
          <button
            onClick={() => onSelect({ id: firmFolder.id, name: firmFolder.name })}
            className="flex items-center gap-2 px-4 py-2.5 text-sm text-left border-b border-[var(--border)] hover:bg-[var(--accent-light)]/40 text-[var(--text-primary)]"
          >
            <Folder size={14} className="text-[var(--accent)] shrink-0" />
            <span className="flex-1 truncate">Firm folder — <span className="font-medium">{firmFolder.name}</span></span>
            <span className="text-xs text-[var(--text-muted)]">Recommended</span>
          </button>
        )}

        {/* Breadcrumb */}
        <div className="flex items-center gap-1 px-4 py-2 text-xs text-[var(--text-muted)] border-b border-[var(--border)] overflow-x-auto whitespace-nowrap">
          {trail.map((c, i) => (
            <span key={`${c.id}-${i}`} className="flex items-center gap-1 shrink-0">
              {i > 0 && <ChevronRight size={11} className="opacity-60" />}
              <button
                onClick={() => setTrail(t => t.slice(0, i + 1))}
                className={i === trail.length - 1 ? 'text-[var(--text-primary)] font-medium' : 'hover:text-[var(--accent)]'}
              >
                {c.name}
              </button>
            </span>
          ))}
        </div>

        {/* Folder list */}
        <div className="flex-1 overflow-y-auto min-h-[140px]">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-[var(--text-muted)]">
              <Loader2 size={18} className="animate-spin" />
            </div>
          ) : error ? (
            <div className="px-4 py-8 text-center text-sm text-red-600 dark:text-red-400">{error}</div>
          ) : items.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-[var(--text-muted)]">No sub-folders here.</div>
          ) : (
            items.map(item => (
              <button
                key={item.id}
                onClick={() => openItem(item)}
                className="flex items-center gap-2 w-full px-4 py-2 text-sm text-left hover:bg-[var(--bg-nav-hover)] text-[var(--text-primary)]"
              >
                {item.type === 'shared_drive' ? <HardDrive size={14} className="text-[var(--text-muted)] shrink-0" /> : <Folder size={14} className="text-amber-500 shrink-0" />}
                <span className="flex-1 truncate">{item.name}</span>
                <ChevronRight size={13} className="text-[var(--text-muted)] shrink-0" />
              </button>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-[var(--border)] bg-[var(--bg-nav-hover)]">
          <span className="text-xs text-[var(--text-muted)] truncate">
            {canSelectHere ? <>{isMove ? 'Move into' : 'Upload into'} <span className="font-medium text-[var(--text-secondary)]">{current.name}</span></> : 'Pick a drive or folder'}
          </span>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={onCancel} className="text-xs px-3 py-1.5 rounded-lg border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--border)]/30">
              Cancel
            </button>
            <button
              onClick={() => canSelectHere && onSelect({ id: current.id, name: current.name })}
              disabled={!canSelectHere}
              className="text-xs flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-40 font-medium"
            >
              <Check size={12} /> {isMove ? 'Move here' : 'Upload here'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
